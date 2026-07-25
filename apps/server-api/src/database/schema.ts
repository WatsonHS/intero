import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const principals = pgTable("principals", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull(),
  kind: text("kind", {
    enum: ["human", "representative", "service"],
  }).notNull(),
  ...timestamps,
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  ...timestamps,
});

export const memberships = pgTable(
  "memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    role: text("role", { enum: ["member", "admin", "owner"] }).notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.principalId] }),
  ],
);

export const authPrincipals = pgTable(
  "auth_principals",
  {
    authUserId: text("auth_user_id").primaryKey(),
    principalId: uuid("principal_id")
      .notNull()
      .unique()
      .references(() => principals.id),
    ...timestamps,
  },
  (table) => [index("auth_principals_principal_idx").on(table.principalId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    projectManagementEnabled: boolean("project_management_enabled")
      .notNull()
      .default(true),
    ...timestamps,
  },
  (table) => [index("projects_org_idx").on(table.organizationId)],
);

export const workstreams = pgTable(
  "workstreams",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id").references(() => projects.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => principals.id),
    title: text("title").notNull(),
    phase: text("phase").notNull(),
    resolvedState: jsonb("resolved_state").notNull(),
    freshnessAt: timestamp("freshness_at", { withTimezone: true }).notNull(),
    confidenceBasisPoints: integer("confidence_basis_points").notNull(),
    version: integer("version").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("workstreams_org_owner_idx").on(table.organizationId, table.ownerId),
    index("workstreams_project_idx").on(table.projectId),
  ],
);

export const kanbanCards = pgTable(
  "kanban_cards",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    column: text("column").notNull(),
    position: integer("position").notNull().default(0),
    ownerId: uuid("owner_id").references(() => principals.id),
    estimatePoints: integer("estimate_points"),
    ...timestamps,
  },
  (table) => [
    index("kanban_cards_project_column_idx").on(
      table.projectId,
      table.column,
      table.position,
    ),
    index("kanban_cards_owner_idx").on(table.ownerId),
  ],
);

export const kanbanCardWorkstreams = pgTable(
  "kanban_card_workstreams",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    cardId: uuid("card_id")
      .notNull()
      .references(() => kanbanCards.id),
    workstreamId: uuid("workstream_id")
      .notNull()
      .references(() => workstreams.id),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.workstreamId] }),
    index("kanban_card_workstreams_workstream_idx").on(table.workstreamId),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    workstreamId: uuid("workstream_id")
      .notNull()
      .references(() => workstreams.id),
    predicate: text("predicate").notNull(),
    value: text("value").notNull(),
    sourceType: text("source_type").notNull(),
    sourceRef: text("source_ref").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    confidenceBasisPoints: integer("confidence_basis_points").notNull(),
    privacy: text("privacy").notNull(),
    evidenceRefs: jsonb("evidence_refs").notNull().default([]),
    supersedes: uuid("supersedes"),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("claims_workstream_predicate_idx").on(
      table.workstreamId,
      table.predicate,
    ),
    index("claims_org_idx").on(table.organizationId),
  ],
);

export const publicProjections = pgTable(
  "public_work_projections",
  {
    workstreamId: uuid("workstream_id")
      .primaryKey()
      .references(() => workstreams.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projection: jsonb("projection").notNull(),
    version: integer("version").notNull(),
    freshnessAt: timestamp("freshness_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("public_projections_org_freshness_idx").on(
      table.organizationId,
      table.freshnessAt,
    ),
  ],
);

export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id").references(() => projects.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    accessMode: text("access_mode").notNull(),
    accessChangedAtSequence: integer("access_changed_at_sequence"),
    priorHistoryGranted: boolean("prior_history_granted")
      .notNull()
      .default(false),
    sequence: integer("sequence").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("threads_org_project_idx").on(table.organizationId, table.projectId),
  ],
);

export const threadParticipants = pgTable(
  "thread_participants",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    representative: boolean("representative").notNull().default(false),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.threadId, table.principalId] })],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => principals.id),
    operationId: uuid("operation_id"),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(),
    body: text("body"),
    encryptedBody: text("encrypted_body"),
    serverReadable: boolean("server_readable").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("messages_thread_sequence_idx").on(
      table.threadId,
      table.sequence,
    ),
    uniqueIndex("messages_operation_idx").on(
      table.organizationId,
      table.operationId,
    ),
    index("messages_org_idx").on(table.organizationId),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => principals.id),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    encryptionMode: text("encryption_mode").notNull(),
    objectKey: text("object_key").notNull().unique(),
    state: text("state").notNull(),
    scanErrorCode: text("scan_error_code"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("attachments_thread_state_idx").on(table.threadId, table.state),
    index("attachments_orphan_idx")
      .on(table.expiresAt)
      .where(sql`${table.state} = 'pending_upload'`),
  ],
);

export const capabilityGrants = pgTable(
  "capability_grants",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    grant: jsonb("grant").notNull(),
    policyVersion: text("policy_version").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("capability_grants_principal_idx").on(
      table.principalId,
      table.expiresAt,
    ),
  ],
);

export const actionEnvelopes = pgTable(
  "action_envelopes",
  {
    operationId: uuid("operation_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => principals.id),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id),
    workstreamId: uuid("workstream_id").references(() => workstreams.id),
    authorityGrantId: uuid("authority_grant_id")
      .notNull()
      .references(() => capabilityGrants.id),
    action: text("action").notNull(),
    envelope: jsonb("envelope").notNull(),
    ...timestamps,
  },
  (table) => [
    index("action_envelopes_thread_idx").on(table.threadId, table.createdAt),
  ],
);

export const actionInbox = pgTable(
  "action_inbox",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    sourceRef: text("source_ref").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("action_inbox_open_dedupe_idx")
      .on(table.organizationId, table.principalId, table.dedupeKey)
      .where(sql`${table.resolvedAt} is null`),
    index("action_inbox_principal_created_idx").on(
      table.principalId,
      table.createdAt,
    ),
  ],
);

export const canonicalEvents = pgTable(
  "canonical_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    operationId: uuid("operation_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    workstreamId: uuid("workstream_id").references(() => workstreams.id),
    source: text("source").notNull(),
    eventType: text("event_type").notNull(),
    privacy: text("privacy").notNull(),
    safePayload: jsonb("safe_payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("canonical_events_idempotency_idx").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("canonical_events_workstream_idx").on(
      table.workstreamId,
      table.occurredAt,
    ),
  ],
);

export const publicRepresentativeRuns = pgTable(
  "public_representative_runs",
  {
    operationId: uuid("operation_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id),
    workstreamId: uuid("workstream_id").references(() => workstreams.id),
    status: text("status").notNull(),
    freshnessAt: timestamp("freshness_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    ...timestamps,
  },
  (table) => [
    index("public_representative_runs_status_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const specs = pgTable(
  "specs",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id").references(() => projects.id),
    title: text("title").notNull(),
    currentRevisionId: uuid("current_revision_id"),
    reviewThreadId: uuid("review_thread_id").references(() => threads.id),
    relatedWorkstreamIds: jsonb("related_workstream_ids").notNull().default([]),
    status: text("status").notNull(),
    ...timestamps,
  },
  (table) => [
    index("specs_org_project_idx").on(table.organizationId, table.projectId),
  ],
);

export const specRevisions = pgTable(
  "spec_revisions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    specId: uuid("spec_id")
      .notNull()
      .references(() => specs.id),
    revision: integer("revision").notNull(),
    markdown: text("markdown").notNull(),
    blocks: jsonb("blocks").notNull(),
    changeSummary: text("change_summary").notNull(),
    affectedScopes: jsonb("affected_scopes").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => principals.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("spec_revisions_spec_revision_idx").on(
      table.specId,
      table.revision,
    ),
  ],
);

export const specReviews = pgTable(
  "spec_reviews",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    specId: uuid("spec_id")
      .notNull()
      .references(() => specs.id),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => specRevisions.id),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => principals.id),
    kind: text("kind").notNull(),
    affectedScopes: jsonb("affected_scopes").notNull(),
    body: text("body").notNull(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("spec_reviews_revision_idx").on(table.revisionId, table.reviewerId),
  ],
);

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    title: text("title").notNull(),
    outcome: text("outcome").notNull(),
    sourceSpecRevisionId: uuid("source_spec_revision_id").references(
      () => specRevisions.id,
    ),
    sourceThreadId: uuid("source_thread_id").references(() => threads.id),
    affectedScopes: jsonb("affected_scopes").notNull(),
    decidedBy: jsonb("decided_by").notNull(),
    supersedes: uuid("supersedes"),
    ...timestamps,
  },
  (table) => [
    index("decisions_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const activityEvents = pgTable(
  "activity_events",
  {
    sequence: integer("sequence").generatedAlwaysAsIdentity().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    operationId: uuid("operation_id").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => principals.id),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("activity_events_operation_idx").on(table.operationId),
    index("activity_events_org_sequence_idx").on(
      table.organizationId,
      table.sequence,
    ),
  ],
);

export const outbox = pgTable(
  "outbox",
  {
    operationId: uuid("operation_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    index("outbox_available_idx")
      .on(table.availableAt)
      .where(sql`${table.completedAt} is null`),
  ],
);

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  resultRef: text("result_ref").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
