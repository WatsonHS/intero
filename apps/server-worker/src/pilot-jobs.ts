import type { OrganizationId, ProjectId } from "@intero/domain";
import type { WorkerUtils } from "graphile-worker";
import { Pool, type PoolClient } from "pg";

export const PILOT_STAND_IN_TASK = "pilot_stand_in_project";
export const PILOT_RECONCILE_TASK = "pilot_stand_in_reconcile";
export const PILOT_DISPATCH_TASK = "pilot_stand_in_dispatch";

export interface PilotJobReference {
  schemaVersion: 1;
  organizationId: OrganizationId;
  jobId: string;
  jobKey: string;
  projectId: ProjectId;
  workStateId: string;
}

interface ClaimedOutbox {
  operationId: string;
  payload: PilotJobReference;
  attempts: number;
}

export class GraphileJobRunner {
  constructor(
    private readonly workerUtils: WorkerUtils,
    private readonly organizationId: OrganizationId,
  ) {}

  async enqueue(reference: PilotJobReference): Promise<void> {
    if (reference.organizationId !== this.organizationId) {
      throw new Error("cross_organization_job_reference");
    }
    await this.workerUtils.addJob(PILOT_STAND_IN_TASK, reference, {
      jobKey: `pilot-stand-in:${reference.organizationId}:${reference.jobKey}`,
      jobKeyMode: "unsafe_dedupe",
      queueName: `pilot-project-${reference.projectId}`,
      maxAttempts: 8,
    });
  }
}

export class PostgresPilotJobRepository {
  constructor(
    private readonly pool: Pool,
    private readonly organizationId: OrganizationId,
  ) {}

  async claimOutbox(limit = 50): Promise<ClaimedOutbox[]> {
    return this.write(async (client) => {
      const result = await client.query<{
        operation_id: string;
        payload: PilotJobReference;
        attempts: number;
      }>(
        `WITH candidates AS (
           SELECT operation_id
           FROM outbox
           WHERE organization_id = $1
             AND topic = 'pilot.stand_in.enqueue'
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

  async markOutboxCompleted(operationId: string): Promise<void> {
    await this.write(async (client) => {
      await client.query(
        `UPDATE outbox
         SET completed_at = now(), last_error_code = NULL
         WHERE organization_id = $1
           AND operation_id = $2
           AND topic = 'pilot.stand_in.enqueue'`,
        [this.organizationId, operationId],
      );
    });
  }

  async markOutboxFailed(
    operationId: string,
    attempts: number,
    errorCode: string,
  ): Promise<void> {
    await this.write(async (client) => {
      const terminal = attempts >= 20;
      await client.query(
        `UPDATE outbox
         SET last_error_code = $3,
             available_at = now() + make_interval(
               secs => LEAST(300, GREATEST(1, power(2, LEAST($4, 8))::integer))
             ),
             completed_at = CASE WHEN $5 THEN now() ELSE NULL END
         WHERE organization_id = $1
           AND operation_id = $2
           AND topic = 'pilot.stand_in.enqueue'`,
        [
          this.organizationId,
          operationId,
          (terminal ? `dead_letter:${errorCode}` : errorCode).slice(0, 120),
          attempts,
          terminal,
        ],
      );
    });
  }

  async reconcilePending(olderThan: string, limit = 100): Promise<number> {
    return this.write(async (client) => {
      const inserted = await client.query(
        `INSERT INTO outbox
          (operation_id, organization_id, topic, payload, attempts, available_at)
         SELECT j.id, j.organization_id, 'pilot.stand_in.enqueue',
                jsonb_build_object(
                  'schemaVersion', 1,
                  'organizationId', j.organization_id,
                  'jobId', j.id,
                  'jobKey', j.job_key,
                  'projectId', j.project_id,
                  'workStateId', j.work_state_id
                ),
                0, now()
         FROM pilot_stand_in_jobs j
         WHERE j.organization_id = $1
           AND j.status IN ('pending', 'retrying', 'processing')
           AND j.updated_at <= $2
           AND NOT EXISTS (
             SELECT 1 FROM outbox o WHERE o.operation_id = j.id
           )
         ORDER BY j.queued_at
         LIMIT $3
         ON CONFLICT (operation_id) DO NOTHING`,
        [this.organizationId, olderThan, Math.max(1, Math.min(limit, 500))],
      );
      const reopened = await client.query(
        `WITH candidates AS (
           SELECT o.operation_id
           FROM outbox o
           JOIN pilot_stand_in_jobs j ON j.id = o.operation_id
           WHERE o.organization_id = $1
             AND o.topic = 'pilot.stand_in.enqueue'
             AND o.completed_at IS NOT NULL
             AND j.status IN ('pending', 'retrying', 'processing')
             AND j.updated_at <= $2
           ORDER BY j.queued_at
           LIMIT $3
         )
         UPDATE outbox o
         SET completed_at = NULL,
             available_at = now(),
             last_error_code = 'pending_job_reconciled'
         FROM candidates
         WHERE o.operation_id = candidates.operation_id`,
        [this.organizationId, olderThan, Math.max(1, Math.min(limit, 500))],
      );
      return (inserted.rowCount ?? 0) + (reopened.rowCount ?? 0);
    });
  }

  async heartbeat(input: {
    workerId: string;
    status: "starting" | "ready" | "stopping" | "stopped";
    startedAt: string;
    now: string;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<void> {
    await this.write(async (client) => {
      await client.query(
        `INSERT INTO pilot_worker_heartbeats
          (organization_id, worker_id, status, started_at, last_heartbeat_at,
           stopped_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (organization_id, worker_id) DO UPDATE SET
           status = EXCLUDED.status,
           last_heartbeat_at = EXCLUDED.last_heartbeat_at,
           stopped_at = EXCLUDED.stopped_at,
           metadata = EXCLUDED.metadata,
           updated_at = now()`,
        [
          this.organizationId,
          input.workerId,
          input.status,
          input.startedAt,
          input.now,
          input.status === "stopped" ? input.now : null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
    });
  }

  async getOperationalMetrics(): Promise<{
    standInQueueDepth: number;
    realtimeOutboxDepth: number;
    terminalFailures: number;
  }> {
    return this.write(async (client) => {
      const result = await client.query<{
        stand_in_queue_depth: string;
        realtime_outbox_depth: string;
        terminal_failures: string;
      }>(
        `SELECT
           (SELECT count(*)
            FROM pilot_stand_in_jobs
            WHERE organization_id = $1
              AND status IN ('pending', 'processing', 'retrying'))
             AS stand_in_queue_depth,
           (SELECT count(*)
            FROM outbox
            WHERE organization_id = $1
              AND completed_at IS NULL
              AND topic <> 'pilot.stand_in.enqueue')
             AS realtime_outbox_depth,
           (SELECT count(*)
            FROM pilot_stand_in_jobs
            WHERE organization_id = $1 AND status = 'failed')
             AS terminal_failures`,
        [this.organizationId],
      );
      const row = result.rows[0]!;
      return {
        standInQueueDepth: Number(row.stand_in_queue_depth),
        realtimeOutboxDepth: Number(row.realtime_outbox_depth),
        terminalFailures: Number(row.terminal_failures),
      };
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

export class PilotJobOutboxDispatcher {
  constructor(
    private readonly repository: PostgresPilotJobRepository,
    private readonly runner: GraphileJobRunner,
  ) {}

  async dispatch(limit = 50): Promise<number> {
    const claimed = await this.repository.claimOutbox(limit);
    let firstError: Error | undefined;
    for (const entry of claimed) {
      try {
        await this.runner.enqueue(entry.payload);
        await this.repository.markOutboxCompleted(entry.operationId);
      } catch (error) {
        const normalized =
          error instanceof Error
            ? error
            : new Error("stand_in_enqueue_failed");
        await this.repository.markOutboxFailed(
          entry.operationId,
          entry.attempts,
          normalized.message.split(":")[0] ?? "stand_in_enqueue_failed",
        );
        firstError ??= normalized;
      }
    }
    if (firstError) throw firstError;
    return claimed.length;
  }
}

function parseReference(
  payload: PilotJobReference,
  organizationId: OrganizationId,
): PilotJobReference {
  if (
    payload?.schemaVersion !== 1 ||
    payload.organizationId !== organizationId ||
    typeof payload.jobId !== "string" ||
    typeof payload.jobKey !== "string" ||
    typeof payload.projectId !== "string" ||
    typeof payload.workStateId !== "string"
  ) {
    throw new Error("invalid_stand_in_job_reference");
  }
  return payload;
}
