import { uuidv7 } from "@intero/domain";
import { Pool, type PoolClient } from "pg";

import type { PublicStandInRepository, PublicStandInRun } from "./runtime.js";

export class PostgresPublicStandInRepository implements PublicStandInRepository {
  constructor(
    private readonly pool: Pool,
    private readonly organizationId: string,
    private readonly standInId: string,
  ) {}

  async hasCompleted(operationId: string): Promise<boolean> {
    return this.read(async (client) => {
      const result = await client.query<{ status: string }>(
        "SELECT status FROM public_stand_in_runs WHERE operation_id = $1",
        [operationId],
      );
      return result.rows[0]?.status === "completed";
    });
  }

  async markCompleted(operationId: string): Promise<void> {
    await this.write(async (client) => {
      await client.query(
        `UPDATE public_stand_in_runs
         SET status = 'completed', completed_at = now(), updated_at = now()
         WHERE operation_id = $1`,
        [operationId],
      );
    });
  }

  async loadFreshness(workstreamId?: string): Promise<string | undefined> {
    return this.read(async (client) => {
      const result = workstreamId
        ? await client.query<{ freshness_at: Date }>(
            "SELECT freshness_at FROM public_work_projections WHERE workstream_id = $1",
            [workstreamId],
          )
        : await client.query<{ freshness_at: Date }>(
            "SELECT freshness_at FROM public_work_projections ORDER BY freshness_at DESC LIMIT 1",
          );
      return result.rows[0]?.freshness_at.toISOString();
    });
  }

  async appendVisibleMessage(input: {
    operationId: string;
    threadId: string;
    body: string;
    freshnessAt?: string;
  }): Promise<void> {
    await this.write(async (client) => {
      const claimed = await client.query(
        `INSERT INTO public_stand_in_runs
          (operation_id, organization_id, thread_id, status, freshness_at)
         VALUES ($1, $2, $3, 'processing', $4)
         ON CONFLICT (operation_id) DO NOTHING
         RETURNING operation_id`,
        [
          input.operationId,
          this.organizationId,
          input.threadId,
          input.freshnessAt ?? null,
        ],
      );
      if (claimed.rowCount === 0) return;

      await client.query(
        `INSERT INTO principals (id, display_name, kind)
         VALUES ($1, 'Public Stand-in', 'stand_in')
         ON CONFLICT (id) DO NOTHING`,
        [this.standInId],
      );
      const thread = await client.query<{ sequence: number }>(
        `UPDATE threads
         SET sequence = sequence + 1,
             latest_message_at = now(),
             updated_at = now()
         WHERE id = $1
         RETURNING sequence`,
        [input.threadId],
      );
      const sequence = thread.rows[0]?.sequence;
      if (!sequence) throw new Error("Stand-in Thread was not found.");
      await client.query(
        `INSERT INTO messages
          (id, organization_id, thread_id, sender_id, client_message_id,
           operation_id, sequence, kind, body, server_readable)
         VALUES ($1, $2, $3, $4, $5, $5, $6, 'message', $7, true)
         ON CONFLICT (organization_id, operation_id) DO NOTHING`,
        [
          uuidv7(),
          this.organizationId,
          input.threadId,
          this.standInId,
          input.operationId,
          sequence,
          input.body,
        ],
      );
      const participants = await client.query<{ principal_id: string }>(
        `SELECT principal_id
         FROM thread_participants
         WHERE thread_id = $1 AND revoked_at IS NULL`,
        [input.threadId],
      );
      const occurredAt = new Date().toISOString();
      const event = {
        schemaVersion: 1,
        eventId: input.operationId,
        type: "conversation.changed",
        threadId: input.threadId,
        headSequence: sequence,
        accessVersion: 1,
        reason: "message_appended",
        occurredAt,
      };
      await client.query(
        `INSERT INTO activity_events
          (organization_id, operation_id, actor_id, aggregate_type, aggregate_id,
           event_type, metadata, occurred_at)
         VALUES ($1, $2, $3, 'thread', $4, 'conversation.changed', $5, $6)
         ON CONFLICT (operation_id) DO NOTHING`,
        [
          this.organizationId,
          input.operationId,
          this.standInId,
          input.threadId,
          event,
          occurredAt,
        ],
      );
      await client.query(
        `INSERT INTO outbox
          (operation_id, organization_id, topic, payload)
         VALUES ($1, $2, 'conversation.changed', $3)
         ON CONFLICT (operation_id) DO NOTHING`,
        [input.operationId, this.organizationId, event],
      );
      const channels = new Set([
        `intero:thread:${input.threadId}`,
        ...participants.rows.map(
          (participant) => `intero:user:${participant.principal_id}`,
        ),
      ]);
      for (const channel of channels) {
        await client.query(
          `INSERT INTO outbox_publications
            (operation_id, organization_id, channel)
           VALUES ($1, $2, $3)
           ON CONFLICT (operation_id, channel) DO NOTHING`,
          [input.operationId, this.organizationId, channel],
        );
      }
    });
  }

  async registerRun(job: PublicStandInRun): Promise<void> {
    await this.write(async (client) => {
      await client.query(
        `INSERT INTO public_stand_in_runs
          (operation_id, organization_id, thread_id, workstream_id, status)
         VALUES ($1, $2, $3, $4, 'queued')
         ON CONFLICT (operation_id) DO NOTHING`,
        [
          job.operationId,
          this.organizationId,
          job.threadId,
          job.workstreamId ?? null,
        ],
      );
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async read<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await this.setTenant(client);
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

  private async write<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.setTenant(client);
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

  private async setTenant(client: PoolClient): Promise<void> {
    await client.query(
      "SELECT set_config('intero.organization_id', $1, true)",
      [this.organizationId],
    );
  }
}
