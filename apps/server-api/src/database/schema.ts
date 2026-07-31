import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
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
  avatarTone: text("avatar_tone", {
    enum: ["accent", "green", "amber", "cool"],
  })
    .notNull()
    .default("accent"),
  preferredLanguage: text("preferred_language", {
    enum: ["zh-CN", "en-US"],
  }),
  kind: text("kind", {
    enum: ["human", "stand_in", "service"],
  }).notNull(),
  ...timestamps,
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  ...timestamps,
});

export const pilotState = pgTable("pilot_state", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id),
  state: jsonb("state").notNull(),
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
    projectId: uuid("project_id").references(() => projects.id),
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
    timezone: text("timezone").notNull().default("UTC"),
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
    accessVersion: integer("access_version").notNull().default(1),
    latestMessageAt: timestamp("latest_message_at", { withTimezone: true }),
    /** Optional owning team. A thread may deliberately belong to no team. */
    teamId: uuid("team_id"),
    /** Set when this thread was branched out of another conversation. */
    parentThreadId: uuid("parent_thread_id"),
    concludedAt: timestamp("concluded_at", { withTimezone: true }),
    concludedBy: uuid("concluded_by").references(() => principals.id),
    ...timestamps,
  },
  (table) => [
    index("threads_org_project_idx").on(table.organizationId, table.projectId),
    index("threads_parent_idx").on(table.parentThreadId),
    index("threads_team_idx").on(table.organizationId, table.teamId),
  ],
);

/**
 * Per-person read position in a thread. Unread counts derive from this plus the
 * message sequence, so there is no counter to fall out of sync.
 */
export const threadReads = pgTable(
  "thread_reads",
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
    lastReadSequence: integer("last_read_sequence").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.principalId] }),
    index("thread_reads_principal_idx").on(
      table.organizationId,
      table.principalId,
    ),
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
    standIn: boolean("stand_in").notNull().default(false),
    visibleFromSequence: integer("visible_from_sequence").notNull().default(1),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
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
    clientMessageId: uuid("client_message_id").notNull(),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(),
    body: text("body"),
    encryptedBody: text("encrypted_body"),
    serverReadable: boolean("server_readable").notNull(),
    mentionedPrincipalIds: uuid("mentioned_principal_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    attachments: jsonb("attachments").notNull().default([]),
    metadata: jsonb("metadata").notNull().default({}),
    streamState: text("stream_state", {
      enum: ["pending", "streaming", "complete", "failed"],
    })
      .notNull()
      .default("complete"),
    revision: integer("revision").notNull().default(1),
    reactions: jsonb("reactions").notNull().default([]),
    replyToMessageId: uuid("reply_to_message_id").references(
      (): AnyPgColumn => messages.id,
    ),
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
    uniqueIndex("messages_thread_sender_client_id_idx").on(
      table.threadId,
      table.senderId,
      table.clientMessageId,
    ),
    index("messages_thread_sequence_desc_idx").on(
      table.threadId,
      table.sequence,
    ),
    index("messages_org_idx").on(table.organizationId),
    index("messages_mentions_idx").using("gin", table.mentionedPrincipalIds),
    index("messages_reply_to_message_idx").on(table.replyToMessageId),
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
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
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

export const objectStoreObjects = pgTable(
  "object_store_objects",
  {
    objectId: uuid("object_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    purpose: text("purpose", {
      enum: ["artifact", "authorized_raw"],
    }).notNull(),
    objectKey: text("object_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    encrypted: boolean("encrypted").notNull(),
    encryptionMode: text("encryption_mode").notNull(),
    state: text("state", {
      enum: [
        "pending_upload",
        "uploaded",
        "available",
        "quarantined",
        "failed",
        "deleted",
      ],
    }).notNull(),
    failureCode: text("failure_code"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("object_store_objects_org_state_idx").on(
      table.organizationId,
      table.state,
      table.updatedAt,
    ),
    index("object_store_objects_cleanup_idx")
      .on(table.expiresAt)
      .where(
        sql`${table.state} IN ('pending_upload', 'quarantined', 'failed')`,
      ),
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
    projectId: uuid("project_id").references(() => projects.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    sourceRef: text("source_ref").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
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

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    mutedKinds: jsonb("muted_kinds").notNull().default([]),
    muteUntil: timestamp("mute_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.principalId] }),
  ],
);

export const authActivationAttempts = pgTable(
  "auth_activation_attempts",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    keyHash: text("key_hash").notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    attempts: integer("attempts").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.keyHash] })],
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

export const publicStandInRuns = pgTable(
  "public_stand_in_runs",
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
    reviewRequestedAt: timestamp("review_requested_at", {
      withTimezone: true,
    }),
    confirmedRevisionId: uuid("confirmed_revision_id"),
    freshnessAt: timestamp("freshness_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    ...timestamps,
  },
  (table) => [
    index("public_stand_in_runs_status_idx").on(table.status, table.createdAt),
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
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("spec_revisions_spec_revision_idx").on(
      table.specId,
      table.revision,
    ),
  ],
);

export const projectEpics = pgTable(
  "project_epics",
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
    ...timestamps,
  },
  (table) => [index("project_epics_project_idx").on(table.projectId)],
);

export const projectProgramIncrements = pgTable(
  "project_program_increments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    number: integer("number").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    timezone: text("timezone").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("project_program_increments_number_idx").on(
      table.projectId,
      table.number,
    ),
  ],
);

export const projectSprints = pgTable(
  "project_sprints",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    piId: uuid("pi_id")
      .notNull()
      .references(() => projectProgramIncrements.id),
    number: integer("number").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("project_sprints_number_idx").on(table.piId, table.number),
  ],
);

export const projectFeatures = pgTable(
  "project_features",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    epicId: uuid("epic_id").references(() => projectEpics.id),
    specId: uuid("spec_id").references(() => specs.id),
    sourceSpecRevisionId: uuid("source_spec_revision_id").references(
      () => specRevisions.id,
    ),
    sourceReferences: jsonb("source_references").notNull().default([]),
    automationPolicyVersion: text("automation_policy_version"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    stage: text("stage", {
      enum: ["planned", "in_development", "released"],
    }).notNull(),
    ownerId: uuid("owner_id").references(() => principals.id),
    piId: uuid("pi_id").references(() => projectProgramIncrements.id),
    sprintId: uuid("sprint_id").references(() => projectSprints.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("project_features_project_idx").on(table.projectId)],
);

export const projectWorkItems = pgTable(
  "project_work_items",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    featureId: uuid("feature_id").references(() => projectFeatures.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", {
      enum: ["todo", "in_progress", "ready_for_test", "done"],
    })
      .notNull()
      .default("todo"),
    ownerId: uuid("owner_id").references(() => principals.id),
    specId: uuid("spec_id").references(() => specs.id),
    sourceSpecRevisionId: uuid("source_spec_revision_id").references(
      () => specRevisions.id,
    ),
    sourceReferences: jsonb("source_references").notNull().default([]),
    automationPolicyVersion: text("automation_policy_version"),
    priority: text("priority", {
      enum: ["unset", "P0", "P1", "P2", "P3"],
    })
      .notNull()
      .default("P2"),
    points: numeric("points"),
    piId: uuid("pi_id").references(() => projectProgramIncrements.id),
    sprintId: uuid("sprint_id").references(() => projectSprints.id),
    sourceSprintId: uuid("source_sprint_id").references(
      () => projectSprints.id,
    ),
    carryover: boolean("carryover").notNull().default(false),
    completionEvidence: text("completion_evidence"),
    completedBy: jsonb("completed_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    coordinationThreadIds: jsonb("coordination_thread_ids")
      .notNull()
      .default([]),
    createdBy: jsonb("created_by").notNull(),
    ...timestamps,
  },
  (table) => [
    index("project_work_items_board_idx").on(
      table.projectId,
      table.status,
      table.updatedAt,
    ),
    index("project_work_items_owner_idx").on(
      table.projectId,
      table.ownerId,
      table.status,
    ),
  ],
);

export const projectWorkRelations = pgTable(
  "project_work_relations",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => projectWorkItems.id),
    targetId: uuid("target_id")
      .notNull()
      .references(() => projectWorkItems.id),
    kind: text("kind", {
      enum: ["blocks", "blocked_by", "related", "duplicate", "duplicated_by"],
    }).notNull(),
    specId: uuid("spec_id").references(() => specs.id),
    sourceSpecRevisionId: uuid("source_spec_revision_id").references(
      () => specRevisions.id,
    ),
    sourceReferences: jsonb("source_references").notNull().default([]),
    automationPolicyVersion: text("automation_policy_version"),
    idempotencyKey: text("idempotency_key"),
    createdBy: jsonb("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.sourceId, table.targetId, table.kind] }),
    uniqueIndex("project_work_relations_idempotency_idx")
      .on(table.organizationId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index("project_work_relations_source_spec_idx").on(
      table.specId,
      table.sourceSpecRevisionId,
    ),
  ],
);

export const projectWorkCodeRefs = pgTable("project_work_code_refs", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  workItemId: uuid("work_item_id")
    .notNull()
    .references(() => projectWorkItems.id),
  kind: text("kind", {
    enum: ["pull_request", "commit", "branch"],
  }).notNull(),
  label: text("label").notNull(),
  url: text("url"),
  repository: text("repository"),
  value: text("value").notNull(),
  reportedBy: jsonb("reported_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projectWorkComments = pgTable(
  "project_work_comments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => projectWorkItems.id),
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
    specId: uuid("spec_id").references(() => specs.id),
    sourceSpecRevisionId: uuid("source_spec_revision_id").references(
      () => specRevisions.id,
    ),
    sourceReferences: jsonb("source_references").notNull().default([]),
    automationPolicyVersion: text("automation_policy_version"),
    idempotencyKey: text("idempotency_key"),
    author: jsonb("author").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("project_work_comments_item_idx").on(
      table.workItemId,
      table.createdAt,
    ),
    uniqueIndex("project_work_comments_idempotency_idx")
      .on(table.organizationId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index("project_work_comments_source_spec_idx").on(
      table.specId,
      table.sourceSpecRevisionId,
    ),
  ],
);

export const projectWorkHistory = pgTable(
  "project_work_history",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => projectWorkItems.id),
    idempotencyKey: text("idempotency_key"),
    action: text("action").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    actor: jsonb("actor").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revertedEntryId: uuid("reverted_entry_id"),
  },
  (table) => [
    uniqueIndex("project_work_history_idempotency_idx").on(
      table.projectId,
      table.idempotencyKey,
    ),
  ],
);

export const projectFeatureHistory = pgTable(
  "project_feature_history",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    featureId: uuid("feature_id")
      .notNull()
      .references(() => projectFeatures.id),
    idempotencyKey: text("idempotency_key"),
    action: text("action").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    actor: jsonb("actor").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revertedEntryId: uuid("reverted_entry_id"),
  },
  (table) => [
    uniqueIndex("project_feature_history_idempotency_idx").on(
      table.projectId,
      table.idempotencyKey,
    ),
  ],
);

export const projectSpecReviewPolicies = pgTable(
  "project_spec_review_policies",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => projects.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    requiredConfirmations: integer("required_confirmations")
      .notNull()
      .default(1),
    otherMemberAgentsCount: boolean("other_member_agents_count")
      .notNull()
      .default(true),
    authorSelfConfirmation: boolean("author_self_confirmation")
      .notNull()
      .default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const projectSpecReviewerNominations = pgTable(
  "project_spec_reviewer_nominations",
  {
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.revisionId, table.reviewerId] })],
);

export const projectSpecCommentThreads = pgTable(
  "project_spec_comment_threads",
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
    lineStart: integer("line_start").notNull(),
    lineEnd: integer("line_end").notNull(),
    /** Offsets into the anchored block's rendered text, when the reader
        selected a run rather than the whole block. */
    charStart: integer("char_start"),
    charEnd: integer("char_end"),
    selection: text("selection"),
    status: text("status", { enum: ["open", "resolved"] })
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("project_spec_threads_revision_idx").on(
      table.revisionId,
      table.createdAt,
    ),
  ],
);

export const projectSpecComments = pgTable("project_spec_comments", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => projectSpecCommentThreads.id),
  parentId: uuid("parent_id"),
  authorId: uuid("author_id")
    .notNull()
    .references(() => principals.id),
  authorKind: text("author_kind", { enum: ["human", "agent"] }).notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projectSpecConfirmations = pgTable(
  "project_spec_confirmations",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    specId: uuid("spec_id")
      .notNull()
      .references(() => specs.id),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => specRevisions.id),
    confirmerId: uuid("confirmer_id")
      .notNull()
      .references(() => principals.id),
    confirmerKind: text("confirmer_kind", {
      enum: ["human", "agent"],
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.revisionId, table.confirmerId] })],
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

export const projectAutomationSummaryJobs = pgTable(
  "project_automation_summary_jobs",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    sourceFingerprint: text("source_fingerprint").notNull(),
    status: text("status", {
      enum: ["pending", "processing", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    summary: jsonb("summary"),
    freshnessAt: timestamp("freshness_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("project_automation_summary_active_key_idx")
      .on(table.organizationId, table.principalId, table.sourceFingerprint)
      .where(sql`${table.status} in ('pending','processing','completed')`),
    index("project_automation_summary_principal_idx").on(
      table.organizationId,
      table.principalId,
      table.completedAt,
    ),
    index("project_automation_summary_pending_idx")
      .on(table.organizationId, table.status, table.createdAt)
      .where(sql`${table.status} in ('pending','processing')`),
  ],
);

export const outboxPublications = pgTable(
  "outbox_publications",
  {
    operationId: uuid("operation_id")
      .notNull()
      .references(() => outbox.operationId, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    channel: text("channel").notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    primaryKey({ columns: [table.operationId, table.channel] }),
    index("outbox_publications_available_idx")
      .on(table.availableAt, table.operationId)
      .where(sql`${table.completedAt} is null`),
  ],
);

export const standInQuestionJobs = pgTable(
  "stand_in_question_jobs",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id),
    projectId: uuid("project_id").references(() => projects.id),
    standInOwnerId: uuid("stand_in_owner_id")
      .notNull()
      .references(() => principals.id),
    askedByPrincipalId: uuid("asked_by_principal_id")
      .notNull()
      .references(() => principals.id),
    questionMessageId: uuid("question_message_id")
      .notNull()
      .references(() => messages.id),
    answerMessageId: uuid("answer_message_id").notNull(),
    preferredLanguage: text("preferred_language", {
      enum: ["zh-CN", "en-US"],
    })
      .notNull()
      .default("en-US"),
    recordExchange: boolean("record_exchange").notNull().default(true),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    claimedBy: text("claimed_by"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("stand_in_question_jobs_source_owner_unique").on(
      table.questionMessageId,
      table.standInOwnerId,
    ),
    index("stand_in_question_jobs_available_idx")
      .on(table.availableAt, table.id)
      .where(sql`${table.status} IN ('pending', 'retrying')`),
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

export const pilotDeploymentSettings = pgTable(
  "pilot_deployment_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id),
    administratorId: uuid("administrator_id")
      .notNull()
      .references(() => principals.id),
    deploymentBaseUrl: text("deployment_base_url").notNull(),
    deploymentValidatedAt: timestamp("deployment_validated_at", {
      withTimezone: true,
    }).notNull(),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (table) => [index("pilot_deployment_admin_idx").on(table.administratorId)],
);

export const pilotTeams = pgTable(
  "pilot_teams",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (table) => [
    index("pilot_teams_org_name_idx").on(table.organizationId, table.name),
  ],
);

export const pilotTeamMemberships = pgTable(
  "pilot_team_memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamId: uuid("team_id")
      .notNull()
      .references(() => pilotTeams.id),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    role: text("role", { enum: ["member", "leader"] })
      .notNull()
      .default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.principalId] }),
    index("pilot_team_memberships_principal_idx").on(
      table.organizationId,
      table.principalId,
    ),
  ],
);

export const pilotTeamInvitations = pgTable(
  "pilot_team_invitations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamId: uuid("team_id")
      .notNull()
      .references(() => pilotTeams.id),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => principals.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => principals.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pilot_team_invitations_token_hash_idx").on(table.tokenHash),
    index("pilot_team_invitations_team_status_idx").on(
      table.organizationId,
      table.teamId,
      table.createdAt,
    ),
    index("pilot_team_invitations_email_idx").on(
      table.organizationId,
      table.email,
    ),
  ],
);

export const pilotTeamJoinLinks = pgTable(
  "pilot_team_join_links",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamId: uuid("team_id")
      .notNull()
      .references(() => pilotTeams.id),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxUses: integer("max_uses"),
    useCount: integer("use_count").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pilot_join_links_code_hash_idx").on(table.codeHash),
    index("pilot_join_links_team_idx").on(table.teamId, table.createdAt),
  ],
);

export const pilotProjectSettings = pgTable(
  "pilot_project_settings",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => projects.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => principals.id),
    primaryTeamId: uuid("primary_team_id")
      .notNull()
      .references(() => pilotTeams.id),
    posture: text("posture", {
      enum: ["collaborative", "paused", "private"],
    }).notNull(),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (table) => [
    index("pilot_project_settings_org_owner_idx").on(
      table.organizationId,
      table.ownerId,
    ),
  ],
);

export const pilotProjectTeams = pgTable(
  "pilot_project_teams",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    teamId: uuid("team_id")
      .notNull()
      .references(() => pilotTeams.id),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.teamId] }),
    index("pilot_project_teams_team_idx").on(table.teamId, table.projectId),
  ],
);

export const pilotProviderConfigs = pgTable("pilot_provider_configs", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id),
  endpoint: text("endpoint").notNull(),
  defaultModel: text("default_model").notNull(),
  encryptedApiKey: text("encrypted_api_key").notNull(),
  ...timestamps,
});

export const pilotAgentTickets = pgTable(
  "pilot_agent_tickets",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => principals.id),
    client: text("client").notNull(),
    ticketHash: text("ticket_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pilot_agent_tickets_hash_idx").on(table.ticketHash),
    index("pilot_agent_tickets_project_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const pilotAgentBindings = pgTable(
  "pilot_agent_bindings",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => principals.id),
    credentialHash: text("credential_hash").notNull(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pilot_agent_bindings_credential_idx").on(table.credentialHash),
    index("pilot_agent_bindings_project_idx").on(
      table.projectId,
      table.ownerId,
    ),
  ],
);

export const pilotDmThreads = pgTable(
  "pilot_dm_threads",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamId: uuid("team_id")
      .notNull()
      .references(() => pilotTeams.id),
    participantAId: uuid("participant_a_id")
      .notNull()
      .references(() => principals.id),
    participantBId: uuid("participant_b_id")
      .notNull()
      .references(() => principals.id),
    sequence: integer("sequence").notNull().default(0),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pilot_dm_threads_participants_idx").on(
      table.teamId,
      table.participantAId,
      table.participantBId,
    ),
    index("pilot_dm_threads_participant_a_idx").on(table.participantAId),
    index("pilot_dm_threads_participant_b_idx").on(table.participantBId),
  ],
);

export const pilotDmMessages = pgTable(
  "pilot_dm_messages",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => pilotDmThreads.id),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => principals.id),
    sequence: integer("sequence").notNull(),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("pilot_dm_messages_sequence_idx").on(
      table.threadId,
      table.sequence,
    ),
    index("pilot_dm_messages_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const pilotWorkStates = pgTable(
  "pilot_work_states",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => principals.id),
    bindingId: uuid("binding_id")
      .notNull()
      .references(() => pilotAgentBindings.id),
    workstreamKey: text("workstream_key").notNull(),
    standInJobId: uuid("stand_in_job_id"),
    standInStatus: text("stand_in_status", {
      enum: [
        "pending",
        "processing",
        "retrying",
        "published",
        "private",
        "failed",
      ],
    })
      .notNull()
      .default("pending"),
    freshnessAt: timestamp("freshness_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pilot_work_states_binding_workstream_idx").on(
      table.bindingId,
      table.workstreamKey,
    ),
    index("pilot_work_states_project_owner_idx").on(
      table.projectId,
      table.ownerId,
      table.freshnessAt,
    ),
  ],
);

export const pilotStandInJobs = pgTable(
  "pilot_stand_in_jobs",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    workStateId: uuid("work_state_id")
      .notNull()
      .references(() => pilotWorkStates.id),
    bindingId: uuid("binding_id")
      .notNull()
      .references(() => pilotAgentBindings.id),
    jobKey: text("job_key").notNull(),
    status: text("status", {
      enum: [
        "pending",
        "processing",
        "retrying",
        "published",
        "private",
        "failed",
      ],
    })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    workerId: text("worker_id"),
    lastErrorCode: text("last_error_code"),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pilot_stand_in_jobs_key_idx").on(
      table.organizationId,
      table.jobKey,
    ),
    index("pilot_stand_in_jobs_pending_idx").on(
      table.organizationId,
      table.status,
      table.nextAttemptAt,
      table.queuedAt,
    ),
    index("pilot_stand_in_jobs_project_idx").on(
      table.projectId,
      table.queuedAt,
    ),
  ],
);

export const pilotWorkerHeartbeats = pgTable(
  "pilot_worker_heartbeats",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    workerId: text("worker_id").notNull(),
    status: text("status", {
      enum: ["starting", "ready", "stopping", "stopped"],
    }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", {
      withTimezone: true,
    }).notNull(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.workerId] }),
    index("pilot_worker_heartbeats_freshness_idx").on(
      table.organizationId,
      table.lastHeartbeatAt,
    ),
  ],
);

export const pilotPrivateClaims = pgTable(
  "pilot_private_claims",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    workStateId: uuid("work_state_id")
      .notNull()
      .references(() => pilotWorkStates.id),
    clientEventId: text("client_event_id").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pilot_private_claims_event_idx").on(
      table.organizationId,
      table.clientEventId,
    ),
    index("pilot_private_claims_work_state_idx").on(
      table.workStateId,
      table.observedAt,
    ),
  ],
);

export const pilotSharedBoundaryClaims = pgTable(
  "pilot_shared_boundary_claims",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    workStateId: uuid("work_state_id")
      .notNull()
      .references(() => pilotWorkStates.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => principals.id),
    bindingId: uuid("binding_id")
      .notNull()
      .references(() => pilotAgentBindings.id),
    checkpointClientEventId: text("checkpoint_client_event_id").notNull(),
    boundaryKey: text("boundary_key").notNull(),
    revision: integer("revision").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pilot_shared_boundary_claim_revision_idx").on(
      table.workStateId,
      table.boundaryKey,
      table.revision,
    ),
    uniqueIndex("pilot_shared_boundary_claim_event_idx").on(
      table.organizationId,
      table.checkpointClientEventId,
      table.boundaryKey,
    ),
    index("pilot_shared_boundary_claim_match_idx").on(
      table.projectId,
      table.boundaryKey,
      table.observedAt,
    ),
  ],
);

export const pilotPulseEntries = pgTable(
  "pilot_pulse_entries",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    workStateId: uuid("work_state_id")
      .notNull()
      .references(() => pilotWorkStates.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => principals.id),
    freshnessAt: timestamp("freshness_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pilot_pulse_entries_work_state_idx").on(table.workStateId),
    index("pilot_pulse_entries_project_freshness_idx").on(
      table.projectId,
      table.freshnessAt,
    ),
  ],
);

export const pilotCoordinationThreads = pgTable(
  "pilot_coordination_threads",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    workStateId: uuid("work_state_id").references(() => pilotWorkStates.id),
    sourceBindingId: uuid("source_binding_id").references(
      () => pilotAgentBindings.id,
    ),
    automationSignalId: uuid("automation_signal_id"),
    boundaryKey: text("boundary_key"),
    dedupeKey: text("dedupe_key"),
    conversationThreadId: uuid("conversation_thread_id").references(
      () => threads.id,
    ),
    sourceRoomThreadId: uuid("source_room_thread_id").references(
      () => threads.id,
    ),
    summaryMessageId: uuid("summary_message_id").references(() => messages.id),
    status: text("status", {
      enum: ["open", "needs_confirmation", "resolved"],
    }).notNull(),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (table) => [
    index("pilot_coordination_project_updated_idx").on(
      table.projectId,
      table.updatedAt,
    ),
    index("pilot_coordination_work_state_idx").on(table.workStateId),
    uniqueIndex("pilot_coordination_work_state_unique_idx")
      .on(table.workStateId)
      .where(sql`${table.workStateId} is not null`),
    uniqueIndex("pilot_coordination_dedupe_unique_idx")
      .on(table.organizationId, table.projectId, table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`),
  ],
);

export const projectAutomationPolicies = pgTable(
  "project_automation_policies",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => projects.id),
    enabled: boolean("enabled").notNull().default(false),
    enabledSignals: text("enabled_signals").array().notNull(),
    staleSpecReviewHours: integer("stale_spec_review_hours")
      .notNull()
      .default(48),
    unresolvedCoordinationHours: integer("unresolved_coordination_hours")
      .notNull()
      .default(24),
    quietUntil: timestamp("quiet_until", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => principals.id),
    ...timestamps,
  },
  (table) => [
    index("project_automation_policy_organization_idx").on(
      table.organizationId,
    ),
  ],
);

export const projectAutomationSignals = pgTable(
  "project_automation_signals",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    fingerprint: text("fingerprint").notNull(),
    sourceRef: text("source_ref").notNull(),
    safeContext: text("safe_context").notNull(),
    candidateNextSteps: jsonb("candidate_next_steps").notNull(),
    participantIds: uuid("participant_ids").array().notNull(),
    targetIds: uuid("target_ids").array().notNull(),
    coordinationThreadId: uuid("coordination_thread_id").references(
      () => pilotCoordinationThreads.id,
    ),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    uniqueIndex("project_automation_signal_fingerprint_idx").on(
      table.organizationId,
      table.projectId,
      table.fingerprint,
    ),
    index("project_automation_signal_queue_idx").on(
      table.status,
      table.detectedAt,
    ),
    index("project_automation_signal_project_idx").on(
      table.projectId,
      table.updatedAt,
    ),
  ],
);

export const projectAutomationAudit = pgTable(
  "project_automation_audit",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => projectAutomationSignals.id),
    action: text("action").notNull(),
    actorId: uuid("actor_id").references(() => principals.id),
    detail: text("detail").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("project_automation_audit_signal_idx").on(
      table.signalId,
      table.createdAt,
    ),
  ],
);

export const pilotCoordinationParticipants = pgTable(
  "pilot_coordination_participants",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => pilotCoordinationThreads.id, { onDelete: "cascade" }),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.principalId] }),
    index("pilot_coordination_participants_principal_idx").on(
      table.principalId,
    ),
  ],
);

export const pilotCoordinationSources = pgTable(
  "pilot_coordination_sources",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => pilotCoordinationThreads.id, { onDelete: "cascade" }),
    workStateId: uuid("work_state_id")
      .notNull()
      .references(() => pilotWorkStates.id),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => pilotSharedBoundaryClaims.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => principals.id),
    claimRevision: integer("claim_revision").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.claimId] }),
    index("pilot_coordination_sources_work_state_idx").on(table.workStateId),
  ],
);

export const pilotCoordinationRelevance = pgTable(
  "pilot_coordination_relevance",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => pilotCoordinationThreads.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    sourceRoomThreadId: uuid("source_room_thread_id").references(
      () => threads.id,
    ),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    reason: text("reason").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    mutedAt: timestamp("muted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.principalId] }),
    index("pilot_coordination_relevance_principal_idx").on(
      table.projectId,
      table.principalId,
    ),
  ],
);

export const pilotStandInExchanges = pgTable(
  "pilot_stand_in_exchanges",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("pilot_stand_in_exchanges_project_principal_idx").on(
      table.projectId,
      table.principalId,
      table.createdAt,
    ),
  ],
);

export const pilotCheckpointIdempotency = pgTable(
  "pilot_checkpoint_idempotency",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    clientEventId: text("client_event_id").notNull(),
    workStateId: uuid("work_state_id")
      .notNull()
      .references(() => pilotWorkStates.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.clientEventId] }),
    index("pilot_checkpoint_idempotency_expiry_idx").on(table.expiresAt),
  ],
);
