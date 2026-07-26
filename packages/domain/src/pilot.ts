import { z } from "zod";

import { OrganizationId, PrincipalId, ProjectId } from "./ids.js";
import { PreferredLanguage } from "./platform.js";
import { WorkstreamPhase } from "./work-state.js";

export const PilotCollaborationPosture = z.enum([
  "collaborative",
  "paused",
  "private",
]);
export type PilotCollaborationPosture = z.infer<
  typeof PilotCollaborationPosture
>;

export const PilotCheckpointEventType = z.enum([
  "work_started",
  "work_progressed",
  "decision_recorded",
  "dependency_declared",
  "blocker_raised",
  "review_requested",
  "work_completed",
  "coordination_requested",
  "artifact_produced",
  "validation_completed",
]);
export type PilotCheckpointEventType = z.infer<typeof PilotCheckpointEventType>;

export const PilotOrganization = z
  .object({
    id: OrganizationId,
    name: z.string().min(1).max(160),
    deploymentBaseUrl: z.url(),
    deploymentValidatedAt: z.iso.datetime(),
    provider: z
      .object({
        configured: z.boolean(),
        endpoint: z.url().optional(),
        defaultModel: z.string().min(1).max(160).optional(),
      })
      .strict(),
  })
  .strict();
export type PilotOrganization = z.infer<typeof PilotOrganization>;

export const PilotTeam = z
  .object({
    id: z.uuid(),
    organizationId: OrganizationId,
    name: z.string().min(1).max(160),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type PilotTeam = z.infer<typeof PilotTeam>;

export const PilotTeamRole = z.enum(["member", "leader"]);
export type PilotTeamRole = z.infer<typeof PilotTeamRole>;

export const PilotOrganizationRole = z.enum(["member", "admin"]);
export type PilotOrganizationRole = z.infer<typeof PilotOrganizationRole>;

export const PilotTeamMembership = z
  .object({
    teamId: z.uuid(),
    principalId: PrincipalId,
    role: PilotTeamRole,
    joinedAt: z.iso.datetime(),
  })
  .strict();
export type PilotTeamMembership = z.infer<typeof PilotTeamMembership>;

export const PilotOrganizationMembership = z
  .object({
    principalId: PrincipalId,
    role: PilotOrganizationRole,
    joinedAt: z.iso.datetime(),
  })
  .strict();
export type PilotOrganizationMembership = z.infer<
  typeof PilotOrganizationMembership
>;

export const PilotInvitationStatus = z.enum([
  "pending",
  "accepted",
  "expired",
  "revoked",
]);
export type PilotInvitationStatus = z.infer<typeof PilotInvitationStatus>;

export const PilotTeamInvitation = z
  .object({
    id: z.uuid(),
    organizationId: OrganizationId,
    teamId: z.uuid(),
    displayName: z.string().min(1).max(160),
    email: z.email().max(320),
    tokenHash: z.string().length(64),
    createdBy: PrincipalId,
    expiresAt: z.iso.datetime(),
    acceptedAt: z.iso.datetime().optional(),
    acceptedBy: PrincipalId.optional(),
    revokedAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type PilotTeamInvitation = z.infer<typeof PilotTeamInvitation>;

export const PilotJoinLink = z
  .object({
    id: z.uuid(),
    teamId: z.uuid(),
    createdBy: PrincipalId,
    expiresAt: z.iso.datetime().optional(),
    maxUses: z.number().int().positive().max(10_000).optional(),
    useCount: z.number().int().nonnegative(),
    revokedAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type PilotJoinLink = z.infer<typeof PilotJoinLink>;

export const PilotProject = z
  .object({
    id: ProjectId,
    organizationId: OrganizationId,
    name: z.string().min(1).max(160),
    ownerId: PrincipalId,
    primaryTeamId: z.uuid(),
    participatingTeamIds: z.array(z.uuid()).min(1).max(50),
    posture: PilotCollaborationPosture,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type PilotProject = z.infer<typeof PilotProject>;

export const PilotDirectMessageThread = z
  .object({
    id: z.uuid(),
    teamId: z.uuid(),
    participantIds: z.tuple([PrincipalId, PrincipalId]),
    standInId: PrincipalId.optional(),
    standInAddedAfterSequence: z.number().int().nonnegative().optional(),
    sequence: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type PilotDirectMessageThread = z.infer<typeof PilotDirectMessageThread>;

export const PilotDirectMessage = z
  .object({
    id: z.uuid(),
    threadId: z.uuid(),
    senderId: PrincipalId,
    sequence: z.number().int().positive(),
    body: z.string().min(1).max(4_000),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type PilotDirectMessage = z.infer<typeof PilotDirectMessage>;

export const PilotCoordinationStatus = z.enum([
  "open",
  "needs_confirmation",
  "resolved",
]);
export type PilotCoordinationStatus = z.infer<typeof PilotCoordinationStatus>;

export const PilotCoordinationThread = z
  .object({
    id: z.uuid(),
    projectId: ProjectId,
    workStateId: z.uuid().optional(),
    trigger: z.enum([
      "dependency_declared",
      "blocker_raised",
      "review_requested",
      "coordination_requested",
    ]),
    sourceBindingId: z.uuid().optional(),
    automationSignalId: z.uuid().optional(),
    automationKind: z
      .enum([
        "blocker",
        "dependency_change",
        "spec_review_stale",
        "coordination_unresolved",
        "project_work_risk",
      ])
      .optional(),
    participantIds: z.array(PrincipalId).min(1).max(20),
    safeContext: z.string().min(1).max(600),
    candidateNextSteps: z.array(z.string().min(1).max(300)).max(5),
    status: PilotCoordinationStatus,
    conclusion: z.string().min(1).max(600).optional(),
    responsibleParticipantId: PrincipalId.optional(),
    confirmedAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type PilotCoordinationThread = z.infer<typeof PilotCoordinationThread>;

export const PilotAgentClient = z.enum(["codex", "claude-code", "opencode"]);
export type PilotAgentClient = z.infer<typeof PilotAgentClient>;

export const PilotAgentTicket = z
  .object({
    id: z.uuid(),
    projectId: ProjectId,
    ownerId: PrincipalId,
    client: PilotAgentClient,
    preferredLanguage: PreferredLanguage,
    ticketHash: z.string().length(64),
    expiresAt: z.iso.datetime(),
    usedAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type PilotAgentTicket = z.infer<typeof PilotAgentTicket>;

export const PilotAgentBinding = z
  .object({
    id: z.uuid(),
    projectId: ProjectId,
    ownerId: PrincipalId,
    client: PilotAgentClient,
    name: z.string().min(1).max(120),
    workspaceId: z.uuid(),
    preferredLanguage: PreferredLanguage,
    credentialHash: z.string().length(64),
    createdAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime().optional(),
    disconnectedAt: z.iso.datetime().optional(),
  })
  .strict();
export type PilotAgentBinding = z.infer<typeof PilotAgentBinding>;

/**
 * A safe, human-readable account of an Agent's work. These fields describe
 * outcomes and coordination needs without carrying raw prompts, files, diffs,
 * terminal output, or tool logs.
 */
export const PilotWorkNarrative = z
  .object({
    currentFocus: z.string().min(1).max(600),
    completedOutcome: z.string().max(600),
    evidence: z.array(z.string().min(1).max(300)).max(5),
    nextStep: z.string().max(600),
    collaboration: z
      .object({
        needed: z.boolean(),
        request: z.string().max(600),
        requestedFrom: z.string().max(160),
      })
      .strict(),
  })
  .strict();
export type PilotWorkNarrative = z.infer<typeof PilotWorkNarrative>;

export const PilotCheckpointInput = z
  .object({
    schemaVersion: z.literal(2),
    clientEventId: z.string().min(8).max(200),
    projectId: ProjectId,
    occurredAt: z.iso.datetime(),
    eventType: PilotCheckpointEventType,
    workstream: z
      .object({
        key: z.string().min(1).max(160),
        title: z.string().min(1).max(160),
        phase: WorkstreamPhase,
      })
      .strict(),
    narrative: PilotWorkNarrative,
    evidenceRefs: z.array(z.string().max(200)).max(10).default([]),
  })
  .strict();
export type PilotCheckpointInput = z.infer<typeof PilotCheckpointInput>;

export const PilotPrivateClaim = z
  .object({
    id: z.uuid(),
    clientEventId: z.string().min(8).max(200),
    eventType: PilotCheckpointEventType,
    value: z.string().min(1).max(600),
    narrative: PilotWorkNarrative,
    evidenceRefs: z.array(z.string().max(200)).max(10),
    source: z.literal("direct_cloud_mcp"),
    sourceBindingId: z.uuid(),
    sourceClient: PilotAgentClient,
    observedAt: z.iso.datetime(),
    receivedAt: z.iso.datetime(),
  })
  .strict();
export type PilotPrivateClaim = z.infer<typeof PilotPrivateClaim>;

export const PilotStandInJobStatus = z.enum([
  "pending",
  "processing",
  "retrying",
  "published",
  "private",
  "failed",
]);
export type PilotStandInJobStatus = z.infer<typeof PilotStandInJobStatus>;

export const PilotStandInProcessingState = z
  .object({
    jobId: z.uuid(),
    jobKey: z.string().min(8).max(240),
    status: PilotStandInJobStatus,
    attempts: z.number().int().nonnegative(),
    queuedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    startedAt: z.iso.datetime().optional(),
    completedAt: z.iso.datetime().optional(),
    nextAttemptAt: z.iso.datetime().optional(),
    lastErrorCode: z.string().min(1).max(120).optional(),
    deadLetteredAt: z.iso.datetime().optional(),
    workerId: z.string().min(1).max(160).optional(),
  })
  .strict();
export type PilotStandInProcessingState = z.infer<
  typeof PilotStandInProcessingState
>;

export const PilotPrivateWorkState = z
  .object({
    id: z.uuid(),
    projectId: ProjectId,
    ownerId: PrincipalId,
    bindingId: z.uuid(),
    workstreamKey: z.string().min(1).max(160),
    title: z.string().min(1).max(160),
    phase: WorkstreamPhase,
    narrative: PilotWorkNarrative,
    claims: z.array(PilotPrivateClaim).max(200),
    standIn: PilotStandInProcessingState,
    freshnessAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type PilotPrivateWorkState = z.infer<typeof PilotPrivateWorkState>;

export const PilotPulseEntry = z
  .object({
    id: z.uuid(),
    projectId: ProjectId,
    workStateId: z.uuid(),
    ownerId: PrincipalId,
    title: z.string().min(1).max(160),
    phase: WorkstreamPhase,
    eventType: PilotCheckpointEventType,
    summary: z.string().min(1).max(600),
    narrative: PilotWorkNarrative,
    freshnessAt: z.iso.datetime(),
    provenance: z
      .object({
        source: z.literal("direct_cloud_mcp"),
        client: PilotAgentClient,
        connectionName: z.string().min(1).max(120),
        clientEventId: z.string().min(8).max(200),
        occurredAt: z.iso.datetime(),
        receivedAt: z.iso.datetime(),
      })
      .strict(),
    publishedAt: z.iso.datetime(),
    withdrawnAt: z.iso.datetime().optional(),
  })
  .strict();
export type PilotPulseEntry = z.infer<typeof PilotPulseEntry>;

/**
 * Model-neutral output contract for the StandIn projection step.
 *
 * The input to this contract is already a structured semantic checkpoint.
 * Implementations must never add raw prompts, files, diffs, terminal output,
 * tool logs, or secrets to this output.
 */
export const PilotStandInOutput = z
  .object({
    safeSummary: z.string().min(1).max(600),
    narrative: PilotWorkNarrative,
    coordination: z
      .object({
        shouldOpen: z.boolean(),
        safeContext: z.string().max(600),
        candidateNextSteps: z.array(z.string().min(1).max(300)).max(5),
      })
      .strict(),
  })
  .strict();
export type PilotStandInOutput = z.infer<typeof PilotStandInOutput>;

export const PilotStandInAnswer = z
  .object({
    answer: z.string().min(1).max(2_000),
    currentStatus: z.string().min(1).max(600),
    completedOutcome: z.string().max(600),
    evidence: z.array(z.string().min(1).max(300)).max(5),
    nextStep: z.string().max(600),
    neededCollaboration: z.string().max(600),
    sourceWorkStateIds: z.array(z.uuid()).min(1).max(10),
  })
  .strict();
export type PilotStandInAnswer = z.infer<typeof PilotStandInAnswer>;

export const PilotStandInAnswerDetail = PilotStandInAnswer.omit({
  sourceWorkStateIds: true,
});
export type PilotStandInAnswerDetail = z.infer<typeof PilotStandInAnswerDetail>;

export const PilotStandInSource = z
  .object({
    workStateId: z.uuid(),
    title: z.string().min(1).max(160),
    eventType: PilotCheckpointEventType,
    summary: z.string().min(1).max(600),
    narrative: PilotWorkNarrative,
    freshnessAt: z.iso.datetime(),
    provenance: z
      .object({
        source: z.literal("direct_cloud_mcp"),
        client: PilotAgentClient,
        connectionName: z.string().min(1).max(120),
        occurredAt: z.iso.datetime(),
      })
      .strict(),
  })
  .strict();
export type PilotStandInSource = z.infer<typeof PilotStandInSource>;

export const PilotStandInExchange = z
  .object({
    id: z.uuid(),
    questionMessageId: z.uuid(),
    answerMessageId: z.uuid(),
    projectId: ProjectId,
    principalId: PrincipalId,
    question: z.string().min(1).max(2_000),
    answer: z.string().min(1).max(2_000),
    structuredAnswer: PilotStandInAnswerDetail,
    sources: z.array(PilotStandInSource).min(1).max(10),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type PilotStandInExchange = z.infer<typeof PilotStandInExchange>;

export const PILOT_DATA_POLICY = {
  structuredPrivateRetentionDays: 180,
  rawContentRetentionDays: 30,
  rawContentCaptureEnabled: false,
  publishedSummaries: "project_lifetime_withdrawable",
  modelUse: "workspace_processing_only_no_training_or_cross_workspace_reuse",
} as const;
