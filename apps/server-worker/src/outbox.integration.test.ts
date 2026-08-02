import {
  type OrganizationId,
  type PrincipalId,
  type ProjectId,
  type WorkspaceId,
  type WorkstreamId,
  uuidv7,
} from "@intero/domain";
import { createHmac } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { exerciseRealtimeContract } from "../../server-api/src/pilot-realtime.contract.js";
import {
  CentrifugoRealtime,
  OutboxDispatcher,
  PostgresOutboxRepository,
} from "./outbox.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const centrifugoUrl = process.env.INTERO_CENTRIFUGO_API_URL;
const centrifugoApiKey =
  process.env.INTERO_CENTRIFUGO_API_KEY ??
  "intero-development-realtime-api-key-v1";
const centrifugoTokenSecret =
  process.env.INTERO_CENTRIFUGO_TOKEN_SECRET ??
  "intero-development-realtime-token-secret-v1";
const integrationSuite =
  databaseUrl && databaseAppUrl && centrifugoUrl ? describe : describe.skip;

integrationSuite("PostgreSQL outbox to Centrifugo", () => {
  const organizationId = uuidv7() as OrganizationId;
  const ownerId = uuidv7() as PrincipalId;
  const workstreamId = uuidv7() as WorkstreamId;
  const projectId = uuidv7() as ProjectId;
  const outboxPool = new Pool({ connectionString: databaseAppUrl });
  const adminPool = new Pool({ connectionString: databaseUrl });
  const repository = new PostgresOutboxRepository(outboxPool, organizationId);
  const operationId = uuidv7();
  const channel = `intero:project:${projectId}`;

  beforeAll(async () => {
    await adminPool.query(
      "INSERT INTO organizations (id, name) VALUES ($1, 'Outbox integration fixture')",
      [organizationId],
    );
    await adminPool.query(
      "INSERT INTO principals (id, display_name, kind) VALUES ($1, 'Outbox owner', 'human')",
      [ownerId],
    );
    const workspaceId = uuidv7() as WorkspaceId;
    await adminPool.query(
      `INSERT INTO workstreams
        (id, organization_id, owner_id, title, phase, resolved_state,
         freshness_at, confidence_basis_points, version)
       VALUES ($1, $2, $3, 'Centrifugo outbox fixture', 'planning', $4,
               now(), 8000, 0)`,
      [
        workstreamId,
        organizationId,
        ownerId,
        {
          id: workstreamId,
          workspaceId,
          ownerId,
          title: "Centrifugo outbox fixture",
          phase: "planning",
        },
      ],
    );
    const activity = await adminPool.query<{ sequence: number }>(
      `INSERT INTO activity_events
        (organization_id, operation_id, actor_id, aggregate_type, aggregate_id,
         event_type, metadata)
       VALUES ($1, $2, $3, 'workstream', $4, 'workstream.created', '{}')
       RETURNING sequence`,
      [organizationId, operationId, ownerId, workstreamId],
    );
    await adminPool.query(
      `INSERT INTO outbox
        (operation_id, organization_id, topic, payload, attempts, available_at)
       VALUES ($1, $2, 'workstream.created', $3, 0, now())`,
      [
        operationId,
        organizationId,
        {
          projectId,
          aggregateId: workstreamId,
          sequence: activity.rows[0]!.sequence,
          eventType: "workstream.created",
        },
      ],
    );
  });

  afterAll(async () => {
    await repository.close();
    await adminPool.query("DELETE FROM outbox WHERE organization_id = $1", [
      organizationId,
    ]);
    await adminPool.query(
      "DELETE FROM activity_events WHERE organization_id = $1",
      [organizationId],
    );
    await adminPool.query(
      "DELETE FROM workstreams WHERE organization_id = $1",
      [organizationId],
    );
    await adminPool.query("DELETE FROM principals WHERE id = $1", [ownerId]);
    await adminPool.query("DELETE FROM organizations WHERE id = $1", [
      organizationId,
    ]);
    await adminPool.end();
  });

  it("recovers after an outage and fans out to two independent clients", async () => {
    const clientToken = createClientToken(ownerId, centrifugoTokenSecret);
    const subscriptionToken = createSubscriptionToken(
      ownerId,
      channel,
      centrifugoTokenSecret,
    );
    const clientA = await subscribeClient(
      centrifugoUrl!,
      channel,
      clientToken,
      subscriptionToken,
    );
    const clientB = await subscribeClient(
      centrifugoUrl!,
      channel,
      clientToken,
      subscriptionToken,
    );
    try {
      const unavailable = new OutboxDispatcher(
        organizationId,
        repository,
        new CentrifugoRealtime("http://127.0.0.1:59998"),
      );
      await expect(unavailable.dispatch()).rejects.toThrow();
      const retained = await adminPool.query<{
        completed_at: Date | null;
        last_error_code: string;
      }>(
        `SELECT completed_at, last_error_code
         FROM outbox
         WHERE operation_id = $1`,
        [operationId],
      );
      expect(retained.rows[0]).toMatchObject({
        completed_at: null,
        last_error_code: expect.stringContaining("fetch"),
      });
      await adminPool.query(
        "UPDATE outbox SET available_at = now() WHERE operation_id = $1",
        [operationId],
      );

      await expect(
        exerciseRealtimeContract(
          new CentrifugoRealtime(centrifugoUrl!, centrifugoApiKey),
          channel,
        ),
      ).resolves.toBeUndefined();
      const messageA = waitForPublication(clientA.socket, operationId);
      const messageB = waitForPublication(clientB.socket, operationId);
      const recovered = new OutboxDispatcher(
        organizationId,
        repository,
        new CentrifugoRealtime(centrifugoUrl!, centrifugoApiKey),
      );
      await expect(recovered.dispatch()).resolves.toBe(1);
      await expect(Promise.all([messageA, messageB])).resolves.toEqual([
        expect.objectContaining({ operationId }),
        expect.objectContaining({ operationId }),
      ]);

      const completed = await adminPool.query<{
        completed_at: Date;
        payload: { sequence: number };
      }>("SELECT completed_at, payload FROM outbox WHERE operation_id = $1", [
        operationId,
      ]);
      expect(completed.rows[0]?.completed_at).toBeInstanceOf(Date);
      expect(completed.rows[0]?.payload.sequence).toBeGreaterThan(0);

      const history = (await fetch(`${centrifugoUrl}/api/history`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-centrifugo-error-mode": "transport",
          "x-api-key": centrifugoApiKey,
        },
        body: JSON.stringify({ channel, limit: 10 }),
      }).then((response) => response.json())) as {
        result: {
          publications: Array<{
            data: { operationId: string; sequence: number };
          }>;
        };
      };
      expect(
        history.result.publications.map((item) => item.data.operationId),
      ).toContain(operationId);
    } finally {
      clientA.socket.close();
      clientB.socket.close();
    }
  }, 15_000);

  it("fans one content-free publication to a configurable client cohort within the visibility SLO", async () => {
    const clientCount = Math.max(
      1,
      Math.min(
        10_000,
        Number(process.env.INTERO_REALTIME_CAPACITY_CLIENTS ?? 32),
      ),
    );
    const connectConcurrency = Math.max(
      1,
      Math.min(
        1_000,
        Number(process.env.INTERO_REALTIME_CONNECT_CONCURRENCY ?? 128),
      ),
    );
    const connectStartedAt = performance.now();
    const clients = await openClientCohort({
      apiUrl: centrifugoUrl!,
      channel,
      clientCount,
      concurrency: connectConcurrency,
      clientToken: createClientToken(ownerId, centrifugoTokenSecret),
      subscriptionToken: createSubscriptionToken(
        ownerId,
        channel,
        centrifugoTokenSecret,
      ),
    });
    const connectDurationMs = performance.now() - connectStartedAt;
    console.info(
      JSON.stringify({
        gate: "realtime_connection_capacity",
        clientCount,
        connectConcurrency,
        connectDurationMs: Math.round(connectDurationMs),
      }),
    );
    const probeId = uuidv7();
    try {
      const startedAt = performance.now();
      const visibilityTimeoutMs = 5_000;
      const received = clients.map(async (client) => {
        await waitForPublication(client.socket, probeId, visibilityTimeoutMs);
        return performance.now() - startedAt;
      });
      await new CentrifugoRealtime(centrifugoUrl!, centrifugoApiKey).publish(
        channel,
        {
          operationId: probeId,
          eventType: "realtime.capacity_probe",
          sequence: 1,
        },
      );
      const visibility = await Promise.allSettled(received);
      const deliveredLatencies = visibility.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const deliveryCount = deliveredLatencies.length;
      const deliveryRate = deliveryCount / clientCount;
      const latencyPopulation = [
        ...deliveredLatencies,
        ...Array.from(
          { length: clientCount - deliveryCount },
          () => visibilityTimeoutMs,
        ),
      ];
      const visibilityP95Ms = percentile(latencyPopulation, 0.95);
      const visibilityP99Ms = percentile(latencyPopulation, 0.99);
      console.info(
        JSON.stringify({
          gate: "realtime_fanout_visibility",
          clientCount,
          deliveryCount,
          deliveryRate,
          visibilityP95Ms: Math.round(visibilityP95Ms),
          visibilityP99Ms: Math.round(visibilityP99Ms),
          visibilityMaxMs: Math.round(Math.max(...latencyPopulation)),
        }),
      );
      expect(deliveryRate).toBeGreaterThanOrEqual(0.99);
      expect(visibilityP95Ms).toBeLessThan(1_000);
      expect(visibilityP99Ms).toBeLessThan(3_000);
    } finally {
      await closeClientCohort(clients);
    }
  }, 180_000);

  it("accepts a configurable content-free publication cohort within the throughput gate", async () => {
    const publicationCount = Math.max(
      1,
      Math.min(
        5_000,
        Number(process.env.INTERO_REALTIME_CAPACITY_PUBLICATIONS ?? 25),
      ),
    );
    const throughputChannel = `intero:project:${uuidv7()}`;
    const startedAt = performance.now();
    await publishBatch(
      centrifugoUrl!,
      centrifugoApiKey,
      throughputChannel,
      publicationCount,
    );
    const durationMs = performance.now() - startedAt;
    const publicationsPerSecond = publicationCount / (durationMs / 1_000);
    console.info(
      JSON.stringify({
        gate: "realtime_publication_throughput",
        publicationCount,
        durationMs: Math.round(durationMs),
        publicationsPerSecond: Math.round(publicationsPerSecond),
      }),
    );
    expect(publicationsPerSecond).toBeGreaterThanOrEqual(
      Math.min(publicationCount, 1_000),
    );
  }, 30_000);
});

async function publishBatch(
  apiUrl: string,
  apiKey: string,
  channel: string,
  publicationCount: number,
): Promise<void> {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/batch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      parallel: true,
      commands: Array.from({ length: publicationCount }, (_, index) => ({
        publish: {
          channel,
          data: {
            operationId: uuidv7(),
            eventType: "realtime.throughput_probe",
            sequence: index + 1,
          },
        },
      })),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json()) as {
    replies?: Array<{ error?: { code?: number; message?: string } }>;
  };
  const failed = body.replies?.find((reply) => reply.error)?.error;
  if (!response.ok || body.replies?.length !== publicationCount || failed) {
    throw new Error(
      `centrifugo_batch_${failed?.code ?? response.status}:${failed?.message ?? "incomplete_batch"}`,
    );
  }
}

async function openClientCohort(input: {
  apiUrl: string;
  channel: string;
  clientCount: number;
  concurrency: number;
  clientToken: string;
  subscriptionToken: string;
}): Promise<Array<{ socket: WebSocket }>> {
  const clients: Array<{ socket: WebSocket }> = [];
  try {
    for (
      let offset = 0;
      offset < input.clientCount;
      offset += input.concurrency
    ) {
      const batchSize = Math.min(input.concurrency, input.clientCount - offset);
      const settled = await Promise.allSettled(
        Array.from({ length: batchSize }, () =>
          subscribeClient(
            input.apiUrl,
            input.channel,
            input.clientToken,
            input.subscriptionToken,
            20_000,
          ),
        ),
      );
      for (const result of settled) {
        if (result.status === "fulfilled") clients.push(result.value);
      }
      const failed = settled.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failed) throw failed.reason;
    }
    return clients;
  } catch (error) {
    await closeClientCohort(clients).catch(() => undefined);
    throw error;
  }
}

async function closeClientCohort(
  clients: Array<{ socket: WebSocket }>,
): Promise<void> {
  for (const client of clients) client.socket.close();
  const deadline = performance.now() + 5_000;
  while (
    clients.some((client) => client.socket.readyState !== WebSocket.CLOSED)
  ) {
    if (performance.now() >= deadline) {
      const closingClientCount = clients.filter(
        (client) => client.socket.readyState !== WebSocket.CLOSED,
      ).length;
      console.info(
        JSON.stringify({
          gate: "realtime_client_cleanup",
          clientCount: clients.length,
          closingClientCount,
        }),
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function subscribeClient(
  apiUrl: string,
  channel: string,
  clientToken: string,
  subscriptionToken: string,
  openTimeoutMs = 5_000,
): Promise<{ socket: WebSocket }> {
  const socket = new WebSocket(
    `${apiUrl.replace(/^http/, "ws")}/connection/websocket`,
  );
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Centrifugo WebSocket open timeout.")),
      openTimeoutMs,
    );
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        reject(new Error("Centrifugo WebSocket connection failed."));
      },
      { once: true },
    );
  });
  const onProtocolPing = (message: MessageEvent) => {
    const frames = String(message.data).trim().split("\n");
    if (frames.includes("{}") && socket.readyState === WebSocket.OPEN) {
      socket.send("{}");
    }
  };
  socket.addEventListener("message", onProtocolPing);
  socket.addEventListener(
    "close",
    () => socket.removeEventListener("message", onProtocolPing),
    { once: true },
  );
  socket.send(JSON.stringify({ id: 1, connect: { token: clientToken } }));
  await waitForReply(socket, 1);
  socket.send(
    JSON.stringify({
      id: 2,
      subscribe: { channel, token: subscriptionToken },
    }),
  );
  await waitForReply(socket, 2);
  return { socket };
}

async function waitForReply(socket: WebSocket, id: number): Promise<void> {
  await waitForSocketMessage(socket, (message) => {
    return parseSocketMessages(message).find((reply) => reply.id === id);
  });
}

async function waitForPublication(
  socket: WebSocket,
  operationId: string,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  return waitForSocketMessage(
    socket,
    (message) => {
      for (const reply of parseSocketMessages(message)) {
        const data = reply.push?.pub?.data;
        if (data?.operationId === operationId) return data;
      }
      return undefined;
    },
    timeoutMs,
  );
}

async function waitForSocketMessage<T>(
  socket: WebSocket,
  select: (message: MessageEvent) => T | undefined,
  timeoutMs = 5_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Centrifugo WebSocket message timeout."));
    }, timeoutMs);
    const onMessage = (message: MessageEvent) => {
      let selected: T | undefined;
      try {
        selected = select(message);
      } catch (error) {
        cleanup();
        reject(
          error instanceof Error
            ? error
            : new Error("Centrifugo WebSocket message handling failed."),
        );
        return;
      }
      if (selected === undefined) return;
      cleanup();
      resolve(selected);
    };
    const onClose = (event: CloseEvent) => {
      cleanup();
      reject(
        new Error(
          `Centrifugo WebSocket closed (${event.code}): ${event.reason || "no reason"}.`,
        ),
      );
    };
    const onError = () => {
      cleanup();
      reject(
        new Error("Centrifugo WebSocket failed while awaiting a message."),
      );
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose, { once: true });
    socket.addEventListener("error", onError, { once: true });
  });
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * quantile) - 1]!;
}

function createClientToken(subject: string, secret: string): string {
  return createRealtimeToken(subject, secret, {});
}

function createSubscriptionToken(
  subject: string,
  channel: string,
  secret: string,
): string {
  return createRealtimeToken(subject, secret, { channel });
}

function createRealtimeToken(
  subject: string,
  secret: string,
  claims: Record<string, unknown>,
): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub: subject,
    exp: Math.floor(Date.now() / 1_000) + 300,
    ...claims,
  })}`;
  const signature = createHmac("sha256", secret)
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
}

type CentrifugoReply = {
  id?: number;
  error?: { message?: string };
  push?: { pub?: { data?: Record<string, unknown> } };
};

function parseSocketMessages(message: MessageEvent): CentrifugoReply[] {
  const replies = String(message.data)
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((frame) => JSON.parse(frame) as CentrifugoReply);
  const failed = replies.find((reply) => reply.error)?.error;
  if (failed) {
    throw new Error(failed.message ?? "Centrifugo protocol error.");
  }
  return replies;
}
