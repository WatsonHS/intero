import { makeWorkerUtils, run, type TaskList } from "graphile-worker";
import { Pool } from "pg";

import {
  CentrifugoRealtime,
  OutboxDispatcher,
  PostgresOutboxRepository,
} from "./outbox.js";
import { PostgresPublicRepresentativeRepository } from "./postgres-repository.js";
import {
  PublicRepresentativeWorker,
  type PublicRepresentativeRun,
} from "./runtime.js";

const connectionString = process.env.INTERO_DATABASE_URL;
if (!connectionString) {
  throw new Error("INTERO_DATABASE_URL is required for server-worker.");
}
const queueConnectionString = process.env.INTERO_WORKER_DATABASE_URL;
if (!queueConnectionString) {
  throw new Error(
    "INTERO_WORKER_DATABASE_URL is required for the Graphile Worker queue.",
  );
}
const organizationId = process.env.INTERO_ORGANIZATION_ID;
const representativeId = process.env.INTERO_PUBLIC_REPRESENTATIVE_ID;
if (!organizationId || !representativeId) {
  throw new Error(
    "INTERO_ORGANIZATION_ID and INTERO_PUBLIC_REPRESENTATIVE_ID are required.",
  );
}
const repository = new PostgresPublicRepresentativeRepository(
  new Pool({ connectionString }),
  organizationId,
  representativeId,
);
const representative = new PublicRepresentativeWorker(repository);
const outboxRepository = new PostgresOutboxRepository(
  new Pool({ connectionString }),
  organizationId,
);
const outbox = new OutboxDispatcher(
  organizationId,
  outboxRepository,
  new CentrifugoRealtime(
    process.env.INTERO_CENTRIFUGO_API_URL ?? "http://127.0.0.1:8000",
    process.env.INTERO_CENTRIFUGO_API_KEY,
  ),
);
const tasks: TaskList = {
  public_representative_run: async (payload) => {
    await representative.run(payload as PublicRepresentativeRun);
  },
  dispatch_outbox: async (_payload, helpers) => {
    await outbox.dispatch();
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
  },
};

const workerUtils = await makeWorkerUtils({
  connectionString: queueConnectionString,
});
await workerUtils.addJob(
  "dispatch_outbox",
  {},
  {
    maxAttempts: 25,
    jobKey: "intero-outbox-dispatch-loop",
    jobKeyMode: "replace",
  },
);
await workerUtils.release();

await run(
  {
    connectionString: queueConnectionString,
    concurrency: Number(process.env.INTERO_WORKER_CONCURRENCY ?? 8),
    noHandleSignals: false,
  },
  tasks,
);
