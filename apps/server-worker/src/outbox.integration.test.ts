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
    const clientA = await subscribeClient(centrifugoUrl!, channel, clientToken);
    const clientB = await subscribeClient(centrifugoUrl!, channel, clientToken);
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
});

async function subscribeClient(
  apiUrl: string,
  channel: string,
  token: string,
): Promise<{ socket: WebSocket }> {
  const socket = new WebSocket(
    `${apiUrl.replace(/^http/, "ws")}/connection/websocket`,
  );
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Centrifugo WebSocket open timeout.")),
      5_000,
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
  socket.send(JSON.stringify({ id: 1, connect: { token } }));
  await waitForReply(socket, 1);
  socket.send(JSON.stringify({ id: 2, subscribe: { channel } }));
  await waitForReply(socket, 2);
  return { socket };
}

async function waitForReply(socket: WebSocket, id: number): Promise<void> {
  await waitForSocketMessage(socket, (message) => {
    const reply = parseSocketMessage(message);
    return reply.id === id ? reply : undefined;
  });
}

async function waitForPublication(
  socket: WebSocket,
  operationId: string,
): Promise<Record<string, unknown>> {
  return waitForSocketMessage(socket, (message) => {
    const reply = parseSocketMessage(message);
    const data = reply.push?.pub?.data;
    return data?.operationId === operationId ? data : undefined;
  });
}

async function waitForSocketMessage<T>(
  socket: WebSocket,
  select: (message: MessageEvent) => T | undefined,
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
    }, 5_000);
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

function createClientToken(subject: string, secret: string): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub: subject,
    exp: Math.floor(Date.now() / 1_000) + 60,
  })}`;
  const signature = createHmac("sha256", secret)
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
}

function parseSocketMessage(message: MessageEvent): {
  id?: number;
  error?: { message?: string };
  push?: { pub?: { data?: Record<string, unknown> } };
} {
  const parsed = JSON.parse(String(message.data)) as {
    id?: number;
    error?: { message?: string };
    push?: { pub?: { data?: Record<string, unknown> } };
  };
  if (parsed.error) {
    throw new Error(parsed.error.message ?? "Centrifugo protocol error.");
  }
  return parsed;
}
