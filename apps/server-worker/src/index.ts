import { loadWorkerServiceConfig, PrivacySafeMetrics } from "@intero/config";
import { OrganizationId } from "@intero/domain";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import {
  makeWorkerUtils,
  run,
  type JobHelpers,
  type TaskList,
} from "graphile-worker";
import { Pool } from "pg";

import { NormalizedPostgresPilotStore } from "../../server-api/src/normalized-postgres-pilot-store.js";
import { PostgresAutomationStore } from "../../server-api/src/automation-store.js";
import { PostgresPlatformStore } from "../../server-api/src/postgres-store.js";
import {
  InstrumentedModelGateway,
  MembershipAuthorizationAdapter,
  PollingRealtimeAdapter,
  ProjectInternalCoordinationTransport,
} from "../../server-api/src/pilot-ports.js";
import { PilotStandInJobHandler } from "../../server-api/src/pilot-service.js";
import { AesGcmProviderSecretCipher } from "../../server-api/src/provider-secrets.js";
import { SpiceDbAuthorization } from "../../server-api/src/spicedb-authorization.js";
import { SpiceDbPilotAuthorization } from "../../server-api/src/spicedb-pilot-authorization.js";
import { VercelAiModelGateway } from "../../server-api/src/vercel-model-gateway.js";
import {
  AUTOMATION_DETECT_TASK,
  AUTOMATION_DISPATCH_TASK,
  AUTOMATION_RECONCILE_TASK,
  AUTOMATION_SIGNAL_TASK,
  AutomationOutboxDispatcher,
  GraphileAutomationJobRunner,
  type AutomationJobReference,
} from "./automation-jobs.js";
import {
  CentrifugoRealtime,
  OutboxDispatcher,
  PostgresOutboxRepository,
} from "./outbox.js";
import {
  GraphileJobRunner,
  PILOT_DISPATCH_TASK,
  PILOT_RECONCILE_TASK,
  PILOT_STAND_IN_TASK,
  PilotJobOutboxDispatcher,
  type PilotJobReference,
  PostgresPilotJobRepository,
} from "./pilot-jobs.js";
import { PostgresPublicStandInRepository } from "./postgres-repository.js";
import { PublicStandInWorker, type PublicStandInRun } from "./runtime.js";
import {
  PILOT_STAND_IN_QUESTION_DISPATCH_TASK,
  PILOT_STAND_IN_QUESTION_TASK,
  PostgresStandInQuestionRepository,
  StandInQuestionHandler,
  StandInQuestionOutboxDispatcher,
  type StandInQuestionReference,
} from "./stand-in-questions.js";

const serviceConfig = loadWorkerServiceConfig();
const pilotAdapterConfig = serviceConfig.pilot;
const connectionString = pilotAdapterConfig.databaseUrl;
if (!connectionString) {
  throw new Error("INTERO_DATABASE_URL is required for server-worker.");
}
const queueConnectionString = serviceConfig.workerDatabaseUrl;
const organizationId = OrganizationId.parse(serviceConfig.organizationId);
const providerEncryptionSecret = pilotAdapterConfig.providerEncryptionKey;
if (!providerEncryptionSecret) {
  throw new Error(
    "INTERO_PROVIDER_ENCRYPTION_KEY is required for Stand-in jobs.",
  );
}

const workerId = `${hostname()}-${process.pid}-${randomUUID()}`;
const startedAt = new Date().toISOString();
const pilotStore = new NormalizedPostgresPilotStore(
  new Pool({ connectionString }),
  organizationId,
);
const spiceDbEndpoint = pilotAdapterConfig.spiceDbEndpoint;
const spiceDbToken = pilotAdapterConfig.spiceDbToken;
const spiceDb =
  pilotAdapterConfig.authorization === "spicedb" &&
  spiceDbEndpoint &&
  spiceDbToken
    ? new SpiceDbAuthorization({
        endpoint: spiceDbEndpoint,
        token: spiceDbToken,
        insecureLocalhost: serviceConfig.spiceDbInsecure,
      })
    : undefined;
const authorization = spiceDb
  ? new SpiceDbPilotAuthorization(pilotStore, spiceDb)
  : new MembershipAuthorizationAdapter(pilotStore);
const coordination = new ProjectInternalCoordinationTransport(pilotStore);
const metrics = new PrivacySafeMetrics();
const model = new InstrumentedModelGateway(
  new VercelAiModelGateway(
    () => pilotStore.getProviderConfiguration(),
    new AesGcmProviderSecretCipher(providerEncryptionSecret),
  ),
  metrics,
);
const standInHandler = new PilotStandInJobHandler(
  pilotStore,
  authorization,
  model,
  coordination,
  new PollingRealtimeAdapter(),
);
const pilotJobRepository = new PostgresPilotJobRepository(
  new Pool({ connectionString }),
  organizationId,
);
const workerUtils = await makeWorkerUtils({
  connectionString: queueConnectionString,
});
const conversationPool = new Pool({ connectionString });
const conversations = new PostgresPlatformStore(
  conversationPool,
  organizationId,
);
const standInQuestionRepository = new PostgresStandInQuestionRepository(
  new Pool({ connectionString }),
  organizationId,
);
const standInQuestionHandler = new StandInQuestionHandler(
  standInQuestionRepository,
  pilotStore,
  conversations,
  model,
  organizationId,
);
const standInQuestionOutbox = new StandInQuestionOutboxDispatcher(
  standInQuestionRepository,
  workerUtils,
  organizationId,
);
const graphileJobs = new GraphileJobRunner(workerUtils, organizationId);
const pilotOutbox = new PilotJobOutboxDispatcher(
  pilotJobRepository,
  graphileJobs,
);
const automationStore = new PostgresAutomationStore(
  new Pool({ connectionString }),
  organizationId,
);
const automationJobs = new GraphileAutomationJobRunner(
  workerUtils,
  organizationId,
);
const automationOutbox = new AutomationOutboxDispatcher(
  automationStore,
  automationJobs,
);

const tasks: TaskList = {
  [PILOT_STAND_IN_QUESTION_TASK]: async (payload, helpers) => {
    await standInQuestionHandler.handle(
      payload as StandInQuestionReference,
      {
        workerId,
        attempt: helpers.job.attempts,
        maxAttempts: helpers.job.max_attempts,
      },
    );
  },
  [PILOT_STAND_IN_QUESTION_DISPATCH_TASK]: async (_payload, helpers) => {
    await standInQuestionOutbox.dispatch();
    await helpers.addJob(
      PILOT_STAND_IN_QUESTION_DISPATCH_TASK,
      {},
      {
        runAt: new Date(Date.now() + 1_000),
        maxAttempts: 25,
        jobKey: "intero-stand-in-question-dispatch-loop",
        jobKeyMode: "replace",
      },
    );
  },
  [AUTOMATION_SIGNAL_TASK]: async (payload: unknown) => {
    const reference = payload as AutomationJobReference;
    if (reference.organizationId !== organizationId || !reference.signalId) {
      throw new Error("invalid_automation_job_reference");
    }
    await automationStore.openCoordination(reference.signalId);
  },
  [AUTOMATION_DETECT_TASK]: async (_payload, helpers) => {
    await automationStore.detectMeaningfulSignals();
    await automationOutbox.dispatch();
    await helpers.addJob(
      AUTOMATION_DETECT_TASK,
      {},
      {
        runAt: new Date(Date.now() + 15_000),
        maxAttempts: 25,
        jobKey: "intero-project-automation-detect-loop",
        jobKeyMode: "replace",
      },
    );
  },
  [AUTOMATION_DISPATCH_TASK]: async (_payload, helpers) => {
    await automationOutbox.dispatch();
    await helpers.addJob(
      AUTOMATION_DISPATCH_TASK,
      {},
      {
        runAt: new Date(Date.now() + 1_000),
        maxAttempts: 25,
        jobKey: "intero-project-automation-dispatch-loop",
        jobKeyMode: "replace",
      },
    );
  },
  [AUTOMATION_RECONCILE_TASK]: async (_payload, helpers) => {
    await automationStore.reconcilePending();
    await automationOutbox.dispatch();
    await helpers.addJob(
      AUTOMATION_RECONCILE_TASK,
      {},
      {
        runAt: new Date(Date.now() + 30_000),
        maxAttempts: 25,
        jobKey: "intero-project-automation-reconcile-loop",
        jobKeyMode: "replace",
      },
    );
  },
  [PILOT_STAND_IN_TASK]: async (payload: unknown, helpers: JobHelpers) => {
    const reference = payload as PilotJobReference;
    try {
      await standInHandler.handleJobKey(reference.jobKey, {
        workerId,
        attempt: helpers.job.attempts,
        maxAttempts: helpers.job.max_attempts,
      });
      metrics.observeWorkerJob("success", helpers.job.attempts - 1);
    } catch (error) {
      metrics.observeWorkerJob(
        helpers.job.attempts >= helpers.job.max_attempts ? "failure" : "retry",
        helpers.job.attempts - 1,
      );
      throw error;
    }
  },
  [PILOT_DISPATCH_TASK]: async (_payload, helpers) => {
    await pilotOutbox.dispatch();
    await helpers.addJob(
      PILOT_DISPATCH_TASK,
      {},
      {
        runAt: new Date(Date.now() + 1_000),
        maxAttempts: 25,
        jobKey: "intero-pilot-stand-in-dispatch-loop",
        jobKeyMode: "replace",
      },
    );
  },
  [PILOT_RECONCILE_TASK]: async (_payload, helpers) => {
    const olderThan = new Date(Date.now() - 60_000).toISOString();
    await pilotJobRepository.reconcilePending(olderThan);
    await pilotOutbox.dispatch();
    await helpers.addJob(
      PILOT_RECONCILE_TASK,
      {},
      {
        runAt: new Date(Date.now() + 15_000),
        maxAttempts: 25,
        jobKey: "intero-pilot-stand-in-reconcile-loop",
        jobKeyMode: "replace",
      },
    );
  },
};

const standInId = process.env.INTERO_PUBLIC_STAND_IN_ID;
let publicRepository: PostgresPublicStandInRepository | undefined;
if (standInId) {
  publicRepository = new PostgresPublicStandInRepository(
    new Pool({ connectionString }),
    organizationId,
    standInId,
  );
  const publicStandIn = new PublicStandInWorker(publicRepository);
  tasks.public_stand_in_run = async (payload) => {
    await publicStandIn.run(payload as PublicStandInRun);
  };
}

const centrifugoApiUrl = pilotAdapterConfig.centrifugoApiUrl;
let realtimeOutboxRepository: PostgresOutboxRepository | undefined;
let centrifugoRealtime: CentrifugoRealtime | undefined;
if (centrifugoApiUrl) {
  realtimeOutboxRepository = new PostgresOutboxRepository(
    new Pool({ connectionString }),
    organizationId,
  );
  centrifugoRealtime = new CentrifugoRealtime(
    centrifugoApiUrl,
    pilotAdapterConfig.centrifugoApiKey,
  );
  const realtimeOutbox = new OutboxDispatcher(
    organizationId,
    realtimeOutboxRepository,
    centrifugoRealtime,
  );
  tasks.dispatch_outbox = async (_payload, helpers) => {
    await realtimeOutbox.dispatch();
    await helpers.addJob(
      "dispatch_outbox",
      {},
      {
        runAt: new Date(Date.now() + 1_000),
        maxAttempts: 25,
        jobKey: "intero-outbox-dispatch-loop",
        jobKeyMode: "replace",
      },
    );
  };
}

await pilotJobRepository.heartbeat({
  workerId,
  status: "starting",
  startedAt,
  now: startedAt,
  metadata: { runtime: "graphile-worker", concurrency: workerConcurrency() },
});
await Promise.all([
  workerUtils.addJob(
    PILOT_STAND_IN_QUESTION_DISPATCH_TASK,
    {},
    {
      maxAttempts: 25,
      jobKey: "intero-stand-in-question-dispatch-loop",
      jobKeyMode: "replace",
    },
  ),
  workerUtils.addJob(
    AUTOMATION_DETECT_TASK,
    {},
    {
      maxAttempts: 25,
      jobKey: "intero-project-automation-detect-loop",
      jobKeyMode: "replace",
    },
  ),
  workerUtils.addJob(
    AUTOMATION_DISPATCH_TASK,
    {},
    {
      maxAttempts: 25,
      jobKey: "intero-project-automation-dispatch-loop",
      jobKeyMode: "replace",
    },
  ),
  workerUtils.addJob(
    AUTOMATION_RECONCILE_TASK,
    {},
    {
      maxAttempts: 25,
      jobKey: "intero-project-automation-reconcile-loop",
      jobKeyMode: "replace",
    },
  ),
  workerUtils.addJob(
    PILOT_DISPATCH_TASK,
    {},
    {
      maxAttempts: 25,
      jobKey: "intero-pilot-stand-in-dispatch-loop",
      jobKeyMode: "replace",
    },
  ),
  workerUtils.addJob(
    PILOT_RECONCILE_TASK,
    {},
    {
      maxAttempts: 25,
      jobKey: "intero-pilot-stand-in-reconcile-loop",
      jobKeyMode: "replace",
    },
  ),
  ...(centrifugoApiUrl
    ? [
        workerUtils.addJob(
          "dispatch_outbox",
          {},
          {
            maxAttempts: 25,
            jobKey: "intero-outbox-dispatch-loop",
            jobKeyMode: "replace",
          },
        ),
      ]
    : []),
]);
await pilotJobRepository.heartbeat({
  workerId,
  status: "ready",
  startedAt,
  now: new Date().toISOString(),
  metadata: { runtime: "graphile-worker", concurrency: workerConcurrency() },
});

let workerStatus: "starting" | "ready" | "stopping" = "ready";
let realtimeHealthy = true;
await updateOperationalHealth();
const metricsServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "intero-worker" }));
    return;
  }
  if (request.url === "/ready") {
    const status =
      workerStatus === "ready"
        ? realtimeHealthy
          ? "ready"
          : "degraded"
        : "unavailable";
    response.writeHead(workerStatus === "ready" ? 200 : 503, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        status,
        dependencies: {
          worker: workerStatus,
          realtime: realtimeHealthy ? "ready" : "unavailable",
        },
      }),
    );
    return;
  }
  if (request.url === "/metrics") {
    response.writeHead(200, {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
    });
    response.end(metrics.renderPrometheus());
    return;
  }
  response.writeHead(404).end();
});
await new Promise<void>((resolve, reject) => {
  metricsServer.once("error", reject);
  metricsServer.listen(
    serviceConfig.metricsPort,
    serviceConfig.metricsHost,
    resolve,
  );
});

const heartbeatTimer = setInterval(() => {
  void updateOperationalHealth().catch(() => undefined);
}, 5_000);
heartbeatTimer.unref();

let resolveStopRequested: ((signal: "SIGINT" | "SIGTERM") => void) | undefined;
const stopRequested = new Promise<"SIGINT" | "SIGTERM">((resolve) => {
  resolveStopRequested = resolve;
});
const handleSigint = () => resolveStopRequested?.("SIGINT");
const handleSigterm = () => resolveStopRequested?.("SIGTERM");
process.once("SIGINT", handleSigint);
process.once("SIGTERM", handleSigterm);

try {
  const runner = await run(
    {
      connectionString: queueConnectionString,
      concurrency: workerConcurrency(),
      noHandleSignals: true,
    },
    tasks,
  );
  const outcome = await Promise.race([
    runner.promise.then(() => ({ type: "completed" as const })),
    stopRequested.then((signal) => ({ type: "signal" as const, signal })),
  ]);
  if (outcome.type === "signal") {
    await runner.stop(outcome.signal);
  }
  await runner.promise;
} finally {
  process.off("SIGINT", handleSigint);
  process.off("SIGTERM", handleSigterm);
  clearInterval(heartbeatTimer);
  workerStatus = "stopping";
  await pilotJobRepository
    .heartbeat({
      workerId,
      status: "stopping",
      startedAt,
      now: new Date().toISOString(),
    })
    .catch(() => undefined);
  await workerUtils.release();
  await new Promise<void>((resolve, reject) =>
    metricsServer.close((error) => (error ? reject(error) : resolve())),
  );
  await publicRepository?.close();
  await realtimeOutboxRepository?.close();
  await standInQuestionRepository.close();
  await conversationPool.end();
  await automationStore.close();
  spiceDb?.close();
  await pilotStore.close();
  await pilotJobRepository
    .heartbeat({
      workerId,
      status: "stopped",
      startedAt,
      now: new Date().toISOString(),
    })
    .catch(() => undefined);
  await pilotJobRepository.close();
}

function workerConcurrency(): number {
  return serviceConfig.concurrency;
}

async function updateOperationalHealth(): Promise<void> {
  const operational = await pilotJobRepository.getOperationalMetrics();
  metrics.setQueueDepth("stand_in", operational.standInQueueDepth);
  metrics.setQueueDepth("realtime_outbox", operational.realtimeOutboxDepth);
  const realtimeReadiness = centrifugoRealtime
    ? await centrifugoRealtime.checkReadiness()
    : { status: "ready" as const };
  realtimeHealthy = realtimeReadiness.status === "ready";
  metrics.setRealtimeHealth(
    centrifugoRealtime ? "centrifugo" : "polling",
    realtimeHealthy,
  );
  await pilotJobRepository.heartbeat({
    workerId,
    status: "ready",
    startedAt,
    now: new Date().toISOString(),
    metadata: {
      runtime: "graphile-worker",
      concurrency: workerConcurrency(),
      standInQueueDepth: operational.standInQueueDepth,
      realtimeOutboxDepth: operational.realtimeOutboxDepth,
      terminalFailures: operational.terminalFailures,
      realtimeHealthy,
    },
  });
}
