import type { OrganizationId } from "@intero/domain";
import { Pool, type PoolClient } from "pg";

import {
  emptyPilotSnapshot,
  type PilotMutationContext,
  type PilotSnapshot,
  SnapshotPilotStore,
} from "./pilot-store.js";

/**
 * The two-day pilot persists its cohesive setup/collaboration slice as one
 * tenant-scoped JSON document. The row is locked for every mutation, so ticket
 * redemption, idempotency, DM sequence allocation, and publication are atomic.
 * Mature surfaces can be normalized after the pilot contract is validated.
 */
export class PostgresPilotStore extends SnapshotPilotStore {
  constructor(
    private readonly pool: Pool,
    private readonly organizationId: OrganizationId,
  ) {
    super();
  }

  protected async readSnapshot(): Promise<PilotSnapshot> {
    return this.withClient("read", async (client) => {
      const result = await client.query<{ state: PilotSnapshot }>(
        "SELECT state FROM pilot_state WHERE organization_id = $1",
        [this.organizationId],
      );
      return result.rows[0]?.state ?? emptyPilotSnapshot();
    });
  }

  protected async updateSnapshot<T>(
    operation: (snapshot: PilotSnapshot) => T,
    _context?: PilotMutationContext,
  ): Promise<T> {
    return this.withClient("write", async (client) => {
      await client.query(
        `INSERT INTO pilot_state (organization_id, state)
         VALUES ($1, $2)
         ON CONFLICT (organization_id) DO NOTHING`,
        [this.organizationId, JSON.stringify(emptyPilotSnapshot())],
      );
      const result = await client.query<{ state: PilotSnapshot }>(
        `SELECT state FROM pilot_state
         WHERE organization_id = $1
         FOR UPDATE`,
        [this.organizationId],
      );
      const snapshot = result.rows[0]?.state ?? emptyPilotSnapshot();
      const value = operation(snapshot);
      await client.query(
        `UPDATE pilot_state
         SET state = $2, updated_at = now()
         WHERE organization_id = $1`,
        [this.organizationId, JSON.stringify(snapshot)],
      );
      return value;
    });
  }

  private async withClient<T>(
    mode: "read" | "write",
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(mode === "read" ? "BEGIN READ ONLY" : "BEGIN");
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
