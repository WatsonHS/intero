import type { OrganizationId } from "@intero/domain";
import type { WorkerUtils } from "graphile-worker";
import { Pool, type PoolClient } from "pg";

import type { PilotInteroJobReference } from "../../server-api/src/intero-request-service.js";

export const PILOT_INTERO_TASK = "pilot_intero_request";
export const PILOT_INTERO_DISPATCH_TASK = "pilot_intero_dispatch";

export interface ClaimedInteroOutbox {
  operationId: string;
  payload: PilotInteroJobReference;
  attempts: number;
}

export interface InteroJobRunner {
  enqueue(reference: PilotInteroJobReference): Promise<void>;
}

export interface InteroOutboxRepository {
  claimOutbox(limit?: number): Promise<ClaimedInteroOutbox[]>;
  markCompleted(operationId: string): Promise<void>;
  markFailed(
    operationId: string,
    attempts: number,
    errorCode: string,
  ): Promise<void>;
}

export class GraphileInteroJobRunner {
  constructor(
    private readonly workerUtils: WorkerUtils,
    private readonly organizationId: OrganizationId,
  ) {}

  async enqueue(reference: PilotInteroJobReference): Promise<void> {
    if (reference.organizationId !== this.organizationId) {
      throw new Error("cross_organization_intero_job_reference");
    }
    await this.workerUtils.addJob(PILOT_INTERO_TASK, reference, {
      jobKey: `pilot-intero:${reference.organizationId}:${reference.requestId}:${reference.scopeRevision}`,
      jobKeyMode: "unsafe_dedupe",
      queueName: `pilot-intero-${reference.organizationId}`,
      maxAttempts: 8,
    });
  }
}

export class PostgresInteroJobRepository {
  constructor(
    private readonly pool: Pool,
    private readonly organizationId: OrganizationId,
  ) {}

  async claimOutbox(limit = 50): Promise<ClaimedInteroOutbox[]> {
    return this.write(async (client) => {
      const result = await client.query<{
        operation_id: string;
        payload: PilotInteroJobReference;
        attempts: number;
      }>(
        `WITH candidates AS (
           SELECT operation_id
           FROM outbox
           WHERE organization_id = $1
             AND topic = 'pilot.intero.enqueue'
             AND completed_at IS NULL
             AND available_at <= now()
           ORDER BY available_at, operation_id
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE outbox
         SET attempts = outbox.attempts + 1,
             available_at = now() + interval '30 seconds'
         FROM candidates
         WHERE outbox.operation_id = candidates.operation_id
         RETURNING outbox.operation_id, outbox.payload, outbox.attempts`,
        [this.organizationId, Math.max(1, Math.min(limit, 100))],
      );
      return result.rows.map((row) => ({
        operationId: row.operation_id,
        payload: parseReference(row.payload, this.organizationId),
        attempts: row.attempts,
      }));
    });
  }

  async markCompleted(operationId: string): Promise<void> {
    await this.write((client) =>
      client
        .query(
          `UPDATE outbox
         SET completed_at = now(), last_error_code = NULL
         WHERE organization_id = $1
           AND operation_id = $2
           AND topic = 'pilot.intero.enqueue'`,
          [this.organizationId, operationId],
        )
        .then(() => undefined),
    );
  }

  async markFailed(
    operationId: string,
    attempts: number,
    errorCode: string,
  ): Promise<void> {
    await this.write((client) =>
      client
        .query(
          `UPDATE outbox
         SET last_error_code = $3,
             available_at = now() + make_interval(
               secs => LEAST(300, GREATEST(1, power(2, LEAST($4, 8))::integer))
             ),
             completed_at = CASE WHEN $5 THEN now() ELSE NULL END
         WHERE organization_id = $1
           AND operation_id = $2
           AND topic = 'pilot.intero.enqueue'`,
          [
            this.organizationId,
            operationId,
            errorCode.slice(0, 120),
            attempts,
            attempts >= 20,
          ],
        )
        .then(() => undefined),
    );
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

export class InteroJobOutboxDispatcher {
  constructor(
    private readonly repository: InteroOutboxRepository,
    private readonly runner: InteroJobRunner,
  ) {}

  async dispatch(limit = 50): Promise<number> {
    const claimed = await this.repository.claimOutbox(limit);
    let firstError: Error | undefined;
    for (const entry of claimed) {
      try {
        await this.runner.enqueue(entry.payload);
        await this.repository.markCompleted(entry.operationId);
      } catch (error) {
        const normalized =
          error instanceof Error
            ? error
            : new Error("intero_request_enqueue_failed");
        await this.repository.markFailed(
          entry.operationId,
          entry.attempts,
          normalized.message.split(":")[0] ?? "intero_request_enqueue_failed",
        );
        firstError ??= normalized;
      }
    }
    if (firstError) throw firstError;
    return claimed.length;
  }
}

function parseReference(
  payload: PilotInteroJobReference,
  organizationId: OrganizationId,
): PilotInteroJobReference {
  if (
    payload?.schemaVersion !== 1 ||
    payload.organizationId !== organizationId ||
    typeof payload.requestId !== "string" ||
    !Number.isInteger(payload.scopeRevision) ||
    payload.scopeRevision < 1
  ) {
    throw new Error("invalid_intero_job_reference");
  }
  return payload;
}
