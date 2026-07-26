import { Pool, type PoolClient } from "pg";

export interface OutboxPublication {
  operationId: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface OutboxRepository {
  claim(limit: number): Promise<OutboxPublication[]>;
  markCompleted(operationId: string): Promise<void>;
  markFailed(operationId: string, errorCode: string): Promise<void>;
}

export interface RealtimePublisher {
  publish(channel: string, event: Record<string, unknown>): Promise<void>;
}

export class PostgresOutboxRepository implements OutboxRepository {
  constructor(
    private readonly pool: Pool,
    private readonly organizationId: string,
  ) {}

  async claim(limit: number): Promise<OutboxPublication[]> {
    return this.write(async (client) => {
      const result = await client.query<{
        operation_id: string;
        topic: string;
        payload: Record<string, unknown>;
        attempts: number;
      }>(
        `WITH candidates AS (
           SELECT operation_id
           FROM outbox
           WHERE completed_at IS NULL
             AND available_at <= now()
             AND topic <> 'pilot.stand_in.enqueue'
           ORDER BY available_at, operation_id
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE outbox
         SET attempts = outbox.attempts + 1,
             available_at = now() + interval '30 seconds'
         FROM candidates
         WHERE outbox.operation_id = candidates.operation_id
         RETURNING outbox.operation_id, outbox.topic, outbox.payload, outbox.attempts`,
        [Math.max(1, Math.min(limit, 100))],
      );
      return result.rows.map((row) => ({
        operationId: row.operation_id,
        topic: row.topic,
        payload: row.payload,
        attempts: row.attempts,
      }));
    });
  }

  async markCompleted(operationId: string): Promise<void> {
    await this.write(async (client) => {
      await client.query(
        `UPDATE outbox SET completed_at = now(), last_error_code = NULL
         WHERE operation_id = $1`,
        [operationId],
      );
    });
  }

  async markFailed(operationId: string, errorCode: string): Promise<void> {
    await this.write(async (client) => {
      await client.query(
        `UPDATE outbox
         SET last_error_code = $2,
             available_at = now() + make_interval(
               secs => LEAST(300, GREATEST(1, power(2, LEAST(attempts, 8))::integer))
             )
         WHERE operation_id = $1`,
        [operationId, errorCode.slice(0, 120)],
      );
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async write<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('intero.organization_id', $1, true)",
        [this.organizationId],
      );
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class CentrifugoRealtime implements RealtimePublisher {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey?: string,
  ) {}

  async publish(
    channel: string,
    event: Record<string, unknown>,
  ): Promise<void> {
    const response = await fetch(
      `${this.apiUrl.replace(/\/$/, "")}/api/publish`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-centrifugo-error-mode": "transport",
          ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
        },
        body: JSON.stringify({ channel, data: event }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    const body = (await response.json()) as {
      error?: { code?: number; message?: string };
    };
    if (!response.ok || body.error) {
      throw new Error(
        `centrifugo_${body.error?.code ?? response.status}:${body.error?.message ?? "publish_failed"}`,
      );
    }
  }

  async checkReadiness(): Promise<{
    status: "ready" | "unavailable";
    detail?: string;
  }> {
    try {
      const response = await fetch(`${this.apiUrl.replace(/\/$/, "")}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok
        ? { status: "ready" }
        : { status: "unavailable", detail: "centrifugo_unhealthy" };
    } catch {
      return {
        status: "unavailable",
        detail: "centrifugo_unavailable",
      };
    }
  }
}

export class OutboxDispatcher {
  constructor(
    private readonly organizationId: string,
    private readonly repository: OutboxRepository,
    private readonly realtime: RealtimePublisher,
  ) {}

  async dispatch(limit = 50): Promise<number> {
    const publications = await this.repository.claim(limit);
    let firstError: Error | undefined;
    for (const publication of publications) {
      try {
        const projectId =
          typeof publication.payload.projectId === "string"
            ? publication.payload.projectId
            : undefined;
        await this.realtime.publish(
          projectId
            ? `intero:project:${projectId}`
            : `intero:organization:${this.organizationId}`,
          {
            operationId: publication.operationId,
            topic: publication.topic,
            ...publication.payload,
          },
        );
        await this.repository.markCompleted(publication.operationId);
      } catch (error) {
        const normalized =
          error instanceof Error ? error : new Error("realtime_publish_failed");
        await this.repository.markFailed(
          publication.operationId,
          normalized.message.split(":")[0] ?? "realtime_publish_failed",
        );
        firstError ??= normalized;
      }
    }
    if (firstError) throw firstError;
    return publications.length;
  }
}
