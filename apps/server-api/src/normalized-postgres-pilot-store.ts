import {
  DomainEventEnvelope,
  type OrganizationId,
  type PilotAgentBinding,
  type PilotAgentTicket,
  type PilotCoordinationThread,
  type PilotDirectMessage,
  type PilotDirectMessageThread,
  type PilotJoinLink,
  type PilotOrganization,
  type PilotOrganizationMembership,
  type PilotPrivateClaim,
  type PilotPrivateWorkState,
  type PilotProject,
  type PilotPulseEntry,
  type PilotStandInExchange,
  type PilotTeam,
  type PilotTeamInvitation,
  type PilotTeamMembership,
  type PrincipalId,
  uuidv7,
} from "@intero/domain";
import { Pool, type PoolClient } from "pg";

import {
  emptyPilotSnapshot,
  type PilotMutationContext,
  type PilotSnapshot,
  type PilotStoredStandInJob,
  SnapshotPilotStore,
  type PilotStoredProvider,
} from "./pilot-store.js";

interface DataRow<T> {
  data: T;
}

interface ProviderRow {
  endpoint: string;
  default_model: string;
  encrypted_api_key: string;
}

/**
 * Normalized PostgreSQL is the only durable Pilot source of truth.
 *
 * The validation-stage adapter deliberately reuses the pure SnapshotPilotStore
 * policy implementation, but persists each aggregate in its own relational
 * table. Mutations are serialized per Organization and commit domain rows,
 * an immutable Activity Event, and an outbox envelope atomically.
 */
export class NormalizedPostgresPilotStore extends SnapshotPilotStore {
  constructor(
    private readonly pool: Pool,
    private readonly organizationId: OrganizationId,
  ) {
    super();
  }

  async checkReadiness(): Promise<{
    status: "ready" | "unavailable";
    detail?: string;
  }> {
    try {
      await this.withClient("read", async (client) => {
        const result = await client.query<{ table_name: string | null }>(
          "SELECT to_regclass('public.pilot_deployment_settings')::text AS table_name",
        );
        if (!result.rows[0]?.table_name) {
          throw new Error("normalized_pilot_schema_missing");
        }
      });
      return { status: "ready" };
    } catch {
      return {
        status: "unavailable",
        detail: "normalized_pilot_store_unavailable",
      };
    }
  }

  async checkWorkerReadiness(maxAgeMs = 30_000): Promise<{
    status: "ready" | "unavailable";
    detail?: string;
  }> {
    try {
      return await this.withClient("read", async (client) => {
        const result = await client.query<{
          status: string;
          last_heartbeat_at: Date;
        }>(
          `SELECT status, last_heartbeat_at
           FROM pilot_worker_heartbeats
           WHERE organization_id = $1
           ORDER BY last_heartbeat_at DESC
           LIMIT 1`,
          [this.organizationId],
        );
        const heartbeat = result.rows[0];
        if (
          !heartbeat ||
          heartbeat.status !== "ready" ||
          Date.now() - heartbeat.last_heartbeat_at.getTime() > maxAgeMs
        ) {
          return {
            status: "unavailable" as const,
            detail: "stand_in_worker_stale",
          };
        }
        return { status: "ready" as const };
      });
    } catch {
      return {
        status: "unavailable",
        detail: "stand_in_worker_heartbeat_unavailable",
      };
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  protected async readSnapshot(): Promise<PilotSnapshot> {
    return this.withClient("read", (client) =>
      this.readSnapshotWithClient(client),
    );
  }

  protected async updateSnapshot<T>(
    operation: (snapshot: PilotSnapshot) => T,
    context?: PilotMutationContext,
  ): Promise<T> {
    return this.withClient("write", async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`intero:pilot:${this.organizationId}`],
      );
      const current = await this.readSnapshotWithClient(client);
      const next = structuredClone(current);
      const value = operation(next);
      if (JSON.stringify(current) === JSON.stringify(next)) {
        return structuredClone(value);
      }
      await this.persistSnapshot(client, next);
      if (context) await this.recordMutation(client, context);
      return structuredClone(value);
    });
  }

  private async readSnapshotWithClient(
    client: PoolClient,
  ): Promise<PilotSnapshot> {
    const snapshot = emptyPilotSnapshot();
    const deployment = await client.query<DataRow<PilotOrganization>>(
      `SELECT data
       FROM pilot_deployment_settings
       WHERE organization_id = $1`,
      [this.organizationId],
    );
    if (deployment.rows[0]) {
      snapshot.organization = deployment.rows[0].data;
    }
    const administrator = await client.query<{
      administrator_id: PrincipalId;
    }>(
      `SELECT administrator_id
       FROM pilot_deployment_settings
       WHERE organization_id = $1`,
      [this.organizationId],
    );
    if (administrator.rows[0]) {
      snapshot.administratorId = administrator.rows[0].administrator_id;
    }

    const provider = await client.query<ProviderRow>(
      `SELECT endpoint, default_model, encrypted_api_key
       FROM pilot_provider_configs
       WHERE organization_id = $1`,
      [this.organizationId],
    );
    if (provider.rows[0]) {
      snapshot.provider = {
        endpoint: provider.rows[0].endpoint,
        defaultModel: provider.rows[0].default_model,
        encryptedApiKey: provider.rows[0].encrypted_api_key,
      };
    }

    snapshot.teams = await this.readDataRows<PilotTeam>(
      client,
      "pilot_teams",
      "created_at, id",
    );
    snapshot.organizationMemberships = (
      await client.query<{
        principal_id: PrincipalId;
        role: "member" | "admin" | "owner";
        created_at: Date;
      }>(
        `SELECT principal_id, role, created_at
         FROM memberships
         WHERE organization_id = $1
         ORDER BY created_at, principal_id`,
        [this.organizationId],
      )
    ).rows.map((row): PilotOrganizationMembership => ({
      principalId: row.principal_id,
      role: row.role === "member" ? "member" : "admin",
      joinedAt: row.created_at.toISOString(),
    }));
    snapshot.memberships = (
      await client.query<{
        team_id: string;
        principal_id: PrincipalId;
        role: PilotTeamMembership["role"];
        joined_at: Date;
      }>(
        `SELECT team_id, principal_id, role, joined_at
         FROM pilot_team_memberships
         WHERE organization_id = $1
         ORDER BY team_id, principal_id`,
        [this.organizationId],
      )
    ).rows.map((row) => ({
      teamId: row.team_id,
      principalId: row.principal_id,
      role: row.role,
      joinedAt: row.joined_at.toISOString(),
    }));
    snapshot.invitations = await this.readDataRows<PilotTeamInvitation>(
      client,
      "pilot_team_invitations",
      "created_at, id",
    );
    snapshot.joinLinks = await this.readDataRows<
      PilotJoinLink & { codeHash: string }
    >(client, "pilot_team_join_links", "created_at, id");

    const projectRows = await this.readDataRows<PilotProject>(
      client,
      "pilot_project_settings",
      "created_at, project_id",
    );
    const projectTeams = await client.query<{
      project_id: string;
      team_id: string;
    }>(
      `SELECT project_id, team_id
       FROM pilot_project_teams
       WHERE organization_id = $1
       ORDER BY project_id, team_id`,
      [this.organizationId],
    );
    snapshot.projects = projectRows.map((project) => ({
      ...project,
      participatingTeamIds: projectTeams.rows
        .filter((row) => row.project_id === project.id)
        .map((row) => row.team_id),
    }));

    snapshot.dmThreads = await this.readDataRows<PilotDirectMessageThread>(
      client,
      "pilot_dm_threads",
      "created_at, id",
    );
    snapshot.dmMessages = await this.readDataRows<PilotDirectMessage>(
      client,
      "pilot_dm_messages",
      "created_at, sequence",
    );
    snapshot.agentTickets = await this.readDataRows<PilotAgentTicket>(
      client,
      "pilot_agent_tickets",
      "created_at, id",
    );
    snapshot.agentBindings = await this.readDataRows<PilotAgentBinding>(
      client,
      "pilot_agent_bindings",
      "created_at, id",
    );
    snapshot.standInJobs = await this.readDataRows<PilotStoredStandInJob>(
      client,
      "pilot_stand_in_jobs",
      "queued_at, id",
    );

    const workStates = await this.readDataRows<
      Omit<PilotPrivateWorkState, "claims"> & { claims?: PilotPrivateClaim[] }
    >(client, "pilot_work_states", "created_at, id");
    const claims = await client.query<
      DataRow<PilotPrivateClaim> & { work_state_id: string }
    >(
      `SELECT work_state_id, data
       FROM pilot_private_claims
       WHERE organization_id = $1
       ORDER BY observed_at, id`,
      [this.organizationId],
    );
    snapshot.workStates = workStates.map((state) => ({
      ...state,
      claims: claims.rows
        .filter((claim) => claim.work_state_id === state.id)
        .map((claim) => claim.data),
    }));
    snapshot.pulseEntries = await this.readDataRows<PilotPulseEntry>(
      client,
      "pilot_pulse_entries",
      "published_at, id",
    );

    const coordination = await this.readDataRows<PilotCoordinationThread>(
      client,
      "pilot_coordination_threads",
      "created_at, id",
    );
    const coordinationParticipants = await client.query<{
      thread_id: string;
      principal_id: PrincipalId;
    }>(
      `SELECT thread_id, principal_id
       FROM pilot_coordination_participants
       WHERE organization_id = $1
       ORDER BY thread_id, principal_id`,
      [this.organizationId],
    );
    snapshot.coordinationThreads = coordination.map((thread) => ({
      ...thread,
      participantIds: coordinationParticipants.rows
        .filter((participant) => participant.thread_id === thread.id)
        .map((participant) => participant.principal_id),
    }));
    snapshot.standInExchanges = await this.readDataRows<PilotStandInExchange>(
      client,
      "pilot_stand_in_exchanges",
      "created_at, id",
    );

    const idempotency = await client.query<{
      client_event_id: string;
      work_state_id: string;
    }>(
      `SELECT client_event_id, work_state_id
       FROM pilot_checkpoint_idempotency
       WHERE organization_id = $1 AND expires_at > now()
       ORDER BY client_event_id`,
      [this.organizationId],
    );
    snapshot.idempotency = Object.fromEntries(
      idempotency.rows.map((row) => [row.client_event_id, row.work_state_id]),
    );
    return snapshot;
  }

  private async readDataRows<T>(
    client: PoolClient,
    table: string,
    orderBy: string,
  ): Promise<T[]> {
    const result = await client.query<DataRow<T>>(
      `SELECT data FROM ${table}
       WHERE organization_id = $1
       ORDER BY ${orderBy}`,
      [this.organizationId],
    );
    return result.rows.map((row) => row.data);
  }

  private async persistSnapshot(
    client: PoolClient,
    snapshot: PilotSnapshot,
  ): Promise<void> {
    await this.ensureOrganizationAndPrincipals(client, snapshot);
    if (snapshot.organization && snapshot.administratorId) {
      await client.query(
        `INSERT INTO pilot_deployment_settings
          (organization_id, administrator_id, deployment_base_url,
           deployment_validated_at, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())
         ON CONFLICT (organization_id) DO UPDATE SET
           administrator_id = EXCLUDED.administrator_id,
           deployment_base_url = EXCLUDED.deployment_base_url,
           deployment_validated_at = EXCLUDED.deployment_validated_at,
           data = EXCLUDED.data,
           updated_at = now()`,
        [
          this.organizationId,
          snapshot.administratorId,
          snapshot.organization.deploymentBaseUrl,
          snapshot.organization.deploymentValidatedAt,
          json(snapshot.organization),
        ],
      );
    }
    if (snapshot.provider) {
      await this.persistProvider(client, snapshot.provider);
    }
    for (const membership of snapshot.organizationMemberships) {
      await client.query(
        `INSERT INTO memberships
          (organization_id, principal_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (organization_id, principal_id) DO UPDATE SET
           role = EXCLUDED.role,
           updated_at = now()`,
        [
          this.organizationId,
          membership.principalId,
          membership.role,
          membership.joinedAt,
        ],
      );
    }
    for (const team of snapshot.teams) {
      await client.query(
        `INSERT INTO pilot_teams
          (id, organization_id, name, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, data = EXCLUDED.data, updated_at = now()`,
        [team.id, this.organizationId, team.name, json(team), team.createdAt],
      );
    }
    await client.query(
      "DELETE FROM pilot_team_memberships WHERE organization_id = $1",
      [this.organizationId],
    );
    for (const membership of snapshot.memberships) {
      await client.query(
        `INSERT INTO pilot_team_memberships
          (organization_id, team_id, principal_id, role, joined_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          this.organizationId,
          membership.teamId,
          membership.principalId,
          membership.role,
          membership.joinedAt,
        ],
      );
    }
    for (const invitation of snapshot.invitations) {
      await client.query(
        `INSERT INTO pilot_team_invitations
          (id, organization_id, team_id, display_name, email, token_hash,
           created_by, expires_at, accepted_at, accepted_by, revoked_at, data,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET
           token_hash = EXCLUDED.token_hash,
           expires_at = EXCLUDED.expires_at,
           accepted_at = EXCLUDED.accepted_at,
           accepted_by = EXCLUDED.accepted_by,
           revoked_at = EXCLUDED.revoked_at,
           data = EXCLUDED.data,
           updated_at = EXCLUDED.updated_at`,
        [
          invitation.id,
          this.organizationId,
          invitation.teamId,
          invitation.displayName,
          invitation.email,
          invitation.tokenHash,
          invitation.createdBy,
          invitation.expiresAt,
          invitation.acceptedAt ?? null,
          invitation.acceptedBy ?? null,
          invitation.revokedAt ?? null,
          json(invitation),
          invitation.createdAt,
          invitation.updatedAt,
        ],
      );
    }
    for (const link of snapshot.joinLinks) {
      await client.query(
        `INSERT INTO pilot_team_join_links
          (id, organization_id, team_id, code_hash, expires_at, max_uses,
           use_count, revoked_at, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT (id) DO UPDATE SET
           expires_at = EXCLUDED.expires_at,
           max_uses = EXCLUDED.max_uses,
           use_count = EXCLUDED.use_count,
           revoked_at = EXCLUDED.revoked_at,
           data = EXCLUDED.data,
           updated_at = now()`,
        [
          link.id,
          this.organizationId,
          link.teamId,
          link.codeHash,
          link.expiresAt ?? null,
          link.maxUses ?? null,
          link.useCount,
          link.revokedAt ?? null,
          json(link),
          link.createdAt,
        ],
      );
    }
    for (const project of snapshot.projects) {
      await client.query(
        `INSERT INTO projects
          (id, organization_id, name, project_management_enabled)
         VALUES ($1, $2, $3, false)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, updated_at = now()`,
        [project.id, this.organizationId, project.name],
      );
      await client.query(
        `INSERT INTO pilot_project_settings
          (project_id, organization_id, owner_id, primary_team_id, posture,
           data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (project_id) DO UPDATE SET
           owner_id = EXCLUDED.owner_id,
           primary_team_id = EXCLUDED.primary_team_id,
           posture = EXCLUDED.posture,
           data = EXCLUDED.data,
           updated_at = EXCLUDED.updated_at`,
        [
          project.id,
          this.organizationId,
          project.ownerId,
          project.primaryTeamId,
          project.posture,
          json(project),
          project.createdAt,
          project.updatedAt,
        ],
      );
      for (const teamId of project.participatingTeamIds) {
        await client.query(
          `INSERT INTO pilot_project_teams
            (organization_id, project_id, team_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (project_id, team_id) DO NOTHING`,
          [this.organizationId, project.id, teamId],
        );
      }
    }
    await this.persistDirectMessages(client, snapshot);
    await this.persistAgents(client, snapshot);
    await this.persistWorkState(client, snapshot);
    await this.persistStandInJobs(client, snapshot);
    await this.persistCoordination(client, snapshot);
    await this.persistStandInExchanges(client, snapshot);
  }

  private async persistProvider(
    client: PoolClient,
    provider: PilotStoredProvider,
  ): Promise<void> {
    await client.query(
      `INSERT INTO pilot_provider_configs
        (organization_id, endpoint, default_model, encrypted_api_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id) DO UPDATE SET
         endpoint = EXCLUDED.endpoint,
         default_model = EXCLUDED.default_model,
         encrypted_api_key = EXCLUDED.encrypted_api_key,
         updated_at = now()`,
      [
        this.organizationId,
        provider.endpoint,
        provider.defaultModel,
        provider.encryptedApiKey,
      ],
    );
  }

  private async persistDirectMessages(
    client: PoolClient,
    snapshot: PilotSnapshot,
  ): Promise<void> {
    for (const thread of snapshot.dmThreads) {
      const participants = thread.participantIds.toSorted() as [
        PrincipalId,
        PrincipalId,
      ];
      await client.query(
        `INSERT INTO pilot_dm_threads
          (id, organization_id, team_id, participant_a_id, participant_b_id,
           sequence, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (id) DO UPDATE SET
           sequence = EXCLUDED.sequence, data = EXCLUDED.data, updated_at = now()`,
        [
          thread.id,
          this.organizationId,
          thread.teamId,
          participants[0],
          participants[1],
          thread.sequence,
          json(thread),
          thread.createdAt,
        ],
      );
    }
    for (const message of snapshot.dmMessages) {
      await client.query(
        `INSERT INTO pilot_dm_messages
          (id, organization_id, thread_id, sender_id, sequence, data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          message.id,
          this.organizationId,
          message.threadId,
          message.senderId,
          message.sequence,
          json(message),
          message.createdAt,
        ],
      );
    }
  }

  private async persistAgents(
    client: PoolClient,
    snapshot: PilotSnapshot,
  ): Promise<void> {
    for (const ticket of snapshot.agentTickets) {
      await client.query(
        `INSERT INTO pilot_agent_tickets
          (id, organization_id, project_id, owner_id, client, ticket_hash,
           expires_at, used_at, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT (id) DO UPDATE SET
           used_at = EXCLUDED.used_at, data = EXCLUDED.data, updated_at = now()`,
        [
          ticket.id,
          this.organizationId,
          ticket.projectId,
          ticket.ownerId,
          ticket.client,
          ticket.ticketHash,
          ticket.expiresAt,
          ticket.usedAt ?? null,
          json(ticket),
          ticket.createdAt,
        ],
      );
    }
    for (const binding of snapshot.agentBindings) {
      await client.query(
        `INSERT INTO pilot_agent_bindings
          (id, organization_id, project_id, owner_id, credential_hash,
           disconnected_at, last_seen_at, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (id) DO UPDATE SET
           disconnected_at = EXCLUDED.disconnected_at,
           last_seen_at = EXCLUDED.last_seen_at,
           data = EXCLUDED.data,
           updated_at = now()`,
        [
          binding.id,
          this.organizationId,
          binding.projectId,
          binding.ownerId,
          binding.credentialHash,
          binding.disconnectedAt ?? null,
          binding.lastSeenAt ?? null,
          json(binding),
          binding.createdAt,
        ],
      );
    }
  }

  private async persistWorkState(
    client: PoolClient,
    snapshot: PilotSnapshot,
  ): Promise<void> {
    for (const state of snapshot.workStates) {
      await client.query(
        `INSERT INTO pilot_work_states
          (id, organization_id, project_id, owner_id, binding_id,
           workstream_key, stand_in_job_id, stand_in_status,
           freshness_at, expires_at, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET
           stand_in_job_id = EXCLUDED.stand_in_job_id,
           stand_in_status = EXCLUDED.stand_in_status,
           freshness_at = EXCLUDED.freshness_at,
           expires_at = EXCLUDED.expires_at,
           data = EXCLUDED.data,
           updated_at = EXCLUDED.updated_at`,
        [
          state.id,
          this.organizationId,
          state.projectId,
          state.ownerId,
          state.bindingId,
          state.workstreamKey,
          state.standIn.jobId,
          state.standIn.status,
          state.freshnessAt,
          state.expiresAt,
          json({ ...state, claims: [] }),
          state.createdAt,
          state.updatedAt,
        ],
      );
      const claimIds = state.claims.map((claim) => claim.id);
      if (claimIds.length === 0) {
        await client.query(
          `DELETE FROM pilot_private_claims
           WHERE organization_id = $1 AND work_state_id = $2`,
          [this.organizationId, state.id],
        );
      } else {
        await client.query(
          `DELETE FROM pilot_private_claims
           WHERE organization_id = $1
             AND work_state_id = $2
             AND NOT (id = ANY($3::uuid[]))`,
          [this.organizationId, state.id, claimIds],
        );
      }
      for (const claim of state.claims) {
        await client.query(
          `INSERT INTO pilot_private_claims
            (id, organization_id, work_state_id, client_event_id, observed_at,
             received_at, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [
            claim.id,
            this.organizationId,
            state.id,
            claim.clientEventId,
            claim.observedAt,
            claim.receivedAt,
            json(claim),
          ],
        );
      }
    }
    for (const entry of snapshot.pulseEntries) {
      await client.query(
        `INSERT INTO pilot_pulse_entries
          (id, organization_id, project_id, work_state_id, owner_id,
           freshness_at, published_at, withdrawn_at, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           freshness_at = EXCLUDED.freshness_at,
           published_at = EXCLUDED.published_at,
           withdrawn_at = EXCLUDED.withdrawn_at,
           data = EXCLUDED.data,
           updated_at = now()`,
        [
          entry.id,
          this.organizationId,
          entry.projectId,
          entry.workStateId,
          entry.ownerId,
          entry.freshnessAt,
          entry.publishedAt,
          entry.withdrawnAt ?? null,
          json(entry),
        ],
      );
    }
    const expiryByState = new Map(
      snapshot.workStates.map((state) => [state.id, state.expiresAt]),
    );
    for (const [clientEventId, workStateId] of Object.entries(
      snapshot.idempotency,
    )) {
      await client.query(
        `INSERT INTO pilot_checkpoint_idempotency
          (organization_id, client_event_id, work_state_id, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id, client_event_id) DO NOTHING`,
        [
          this.organizationId,
          clientEventId,
          workStateId,
          expiryByState.get(workStateId) ??
            new Date(Date.now() + 180 * 86_400_000).toISOString(),
        ],
      );
    }
  }

  private async persistStandInJobs(
    client: PoolClient,
    snapshot: PilotSnapshot,
  ): Promise<void> {
    for (const job of snapshot.standInJobs) {
      await client.query(
        `INSERT INTO pilot_stand_in_jobs
          (id, organization_id, project_id, work_state_id, binding_id, job_key,
           status, attempts, max_attempts, queued_at, started_at,
           next_attempt_at, completed_at, dead_lettered_at, worker_id,
           last_error_code, data, created_at, updated_at)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           $14, $15, $16, $17, $18, $19)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           attempts = EXCLUDED.attempts,
           max_attempts = EXCLUDED.max_attempts,
           started_at = EXCLUDED.started_at,
           next_attempt_at = EXCLUDED.next_attempt_at,
           completed_at = EXCLUDED.completed_at,
           dead_lettered_at = EXCLUDED.dead_lettered_at,
           worker_id = EXCLUDED.worker_id,
           last_error_code = EXCLUDED.last_error_code,
           data = EXCLUDED.data,
           updated_at = EXCLUDED.updated_at`,
        [
          job.id,
          this.organizationId,
          job.projectId,
          job.workStateId,
          job.binding.id,
          job.jobKey,
          job.status,
          job.attempts,
          job.maxAttempts,
          job.queuedAt,
          job.startedAt ?? null,
          job.nextAttemptAt ?? null,
          job.completedAt ?? null,
          job.deadLetteredAt ?? null,
          job.workerId ?? null,
          job.lastErrorCode ?? null,
          json(job),
          job.queuedAt,
          job.updatedAt,
        ],
      );
      if (job.status === "pending" || job.status === "retrying") {
        await client.query(
          `INSERT INTO outbox
            (operation_id, organization_id, topic, payload, attempts, available_at)
           VALUES ($1, $2, 'pilot.stand_in.enqueue', $3, 0, $4)
           ON CONFLICT (operation_id) DO UPDATE SET
             completed_at = CASE
               WHEN outbox.completed_at IS NULL THEN NULL
               ELSE outbox.completed_at
             END`,
          [
            job.id,
            this.organizationId,
            json({
              schemaVersion: 1,
              organizationId: this.organizationId,
              jobId: job.id,
              jobKey: job.jobKey,
              projectId: job.projectId,
              workStateId: job.workStateId,
            }),
            job.nextAttemptAt ?? job.queuedAt,
          ],
        );
      }
    }
  }

  private async persistCoordination(
    client: PoolClient,
    snapshot: PilotSnapshot,
  ): Promise<void> {
    for (const thread of snapshot.coordinationThreads) {
      await client.query(
        `INSERT INTO pilot_coordination_threads
          (id, organization_id, project_id, work_state_id, source_binding_id,
           automation_signal_id, status, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           work_state_id = COALESCE(
             pilot_coordination_threads.work_state_id,
             EXCLUDED.work_state_id
           ),
           source_binding_id = COALESCE(
             pilot_coordination_threads.source_binding_id,
             EXCLUDED.source_binding_id
           ),
           automation_signal_id = COALESCE(
             pilot_coordination_threads.automation_signal_id,
             EXCLUDED.automation_signal_id
           ),
           status = EXCLUDED.status,
           data = EXCLUDED.data,
           updated_at = EXCLUDED.updated_at`,
        [
          thread.id,
          this.organizationId,
          thread.projectId,
          thread.workStateId ?? null,
          thread.sourceBindingId ?? null,
          thread.automationSignalId ?? null,
          thread.status,
          json(thread),
          thread.createdAt,
          thread.updatedAt,
        ],
      );
      for (const principalId of thread.participantIds) {
        await client.query(
          `INSERT INTO pilot_coordination_participants
            (organization_id, thread_id, principal_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (thread_id, principal_id) DO NOTHING`,
          [this.organizationId, thread.id, principalId],
        );
      }
    }
  }

  private async persistStandInExchanges(
    client: PoolClient,
    snapshot: PilotSnapshot,
  ): Promise<void> {
    for (const exchange of snapshot.standInExchanges) {
      await client.query(
        `INSERT INTO pilot_stand_in_exchanges
          (id, organization_id, project_id, principal_id, data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [
          exchange.id,
          this.organizationId,
          exchange.projectId,
          exchange.principalId,
          json(exchange),
          exchange.createdAt,
        ],
      );
    }
  }

  private async ensureOrganizationAndPrincipals(
    client: PoolClient,
    snapshot: PilotSnapshot,
  ): Promise<void> {
    if (snapshot.organization) {
      await client.query(
        `INSERT INTO organizations (id, name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
        [this.organizationId, snapshot.organization.name],
      );
    }
    const principalIds = collectPrincipalIds(snapshot);
    for (const principalId of principalIds) {
      await client.query(
        `INSERT INTO principals (id, display_name, kind)
         VALUES ($1, $2, 'human')
         ON CONFLICT (id) DO NOTHING`,
        [principalId, `Principal ${principalId.slice(0, 8)}`],
      );
    }
  }

  private async recordMutation(
    client: PoolClient,
    context: PilotMutationContext,
  ): Promise<void> {
    const operationId = uuidv7();
    const occurredAt = new Date().toISOString();
    const metadata = {
      adapter: "normalized_postgres",
      contractVersion: 1,
      persistenceVersion: 1,
      // Flattened with a prefix: ActivityEvent metadata is a flat map of
      // scalars, and prefixing keeps audit facts from colliding with it.
      ...(context.subjectId ? { "audit.subjectId": context.subjectId } : {}),
      ...Object.fromEntries(
        Object.entries(context.detail ?? {}).map(([key, value]) => [
          `audit.${key}`,
          value,
        ]),
      ),
    };
    const activity = await client.query<{ sequence: number }>(
      `INSERT INTO activity_events
        (organization_id, operation_id, actor_id, aggregate_type, aggregate_id,
         event_type, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING sequence`,
      [
        this.organizationId,
        operationId,
        context.actorId,
        context.aggregateType,
        context.aggregateId,
        context.eventType,
        json(metadata),
        occurredAt,
      ],
    );
    const envelope = DomainEventEnvelope.parse({
      schemaVersion: 1,
      operationId,
      organizationId: this.organizationId,
      actorId: context.actorId,
      aggregateType: context.aggregateType,
      aggregateId: context.aggregateId,
      eventType: context.eventType,
      visibility: context.visibility,
      ...(context.projectId ? { projectId: context.projectId } : {}),
      sequence: activity.rows[0]!.sequence,
      occurredAt,
      metadata,
    });
    await client.query(
      `INSERT INTO outbox
        (operation_id, organization_id, topic, payload, attempts, available_at)
       VALUES ($1, $2, $3, $4, 0, $5)`,
      [
        operationId,
        this.organizationId,
        context.eventType,
        json(envelope),
        occurredAt,
      ],
    );
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

function collectPrincipalIds(snapshot: PilotSnapshot): Set<PrincipalId> {
  const ids = new Set<PrincipalId>();
  if (snapshot.administratorId) ids.add(snapshot.administratorId);
  for (const membership of snapshot.memberships)
    ids.add(membership.principalId);
  for (const membership of snapshot.organizationMemberships)
    ids.add(membership.principalId);
  for (const invitation of snapshot.invitations) {
    ids.add(invitation.createdBy);
    if (invitation.acceptedBy) ids.add(invitation.acceptedBy);
  }
  for (const project of snapshot.projects) ids.add(project.ownerId);
  for (const link of snapshot.joinLinks) ids.add(link.createdBy);
  for (const thread of snapshot.dmThreads) {
    for (const participantId of thread.participantIds) ids.add(participantId);
    if (thread.standInId) ids.add(thread.standInId);
  }
  for (const message of snapshot.dmMessages) ids.add(message.senderId);
  for (const ticket of snapshot.agentTickets) ids.add(ticket.ownerId);
  for (const binding of snapshot.agentBindings) ids.add(binding.ownerId);
  for (const state of snapshot.workStates) ids.add(state.ownerId);
  for (const entry of snapshot.pulseEntries) ids.add(entry.ownerId);
  for (const thread of snapshot.coordinationThreads) {
    for (const participantId of thread.participantIds) ids.add(participantId);
    if (thread.responsibleParticipantId)
      ids.add(thread.responsibleParticipantId);
  }
  for (const exchange of snapshot.standInExchanges)
    ids.add(exchange.principalId);
  return ids;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}
