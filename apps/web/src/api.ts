import type {
  ActionEnvelope,
  ActionInboxItem,
  Attachment,
  AuthorizedSearchResult,
  ActivityEvent,
  ConversationThread,
  DecisionRecord,
  Epic,
  Feature,
  KanbanCard,
  KanbanCardId,
  KanbanColumn,
  NotificationPreferences,
  ProjectAutomationAudit,
  ProjectAutomationPolicy,
  ProjectAutomationSignal,
  ProjectAutomationSignalKind,
  Project,
  ProgramIncrement,
  PublicWorkProjection,
  ReviewResponseKind,
  Spec,
  SpecComment,
  SpecCommentThread,
  SpecConfirmation,
  SpecReviewPolicy,
  SpecRevision,
  SpecReviewResponse,
  ThreadMessage,
  Sprint,
  WorkCodeReference,
  WorkComment,
  WorkHistoryEntry,
  WorkItem,
  WorkRelation,
} from "@intero/domain";

import {
  handleAuthenticationFailure,
  PILOT_IDENTITY_STORAGE_KEY,
} from "./pilot/auth-state.js";
import { INTERO_API_URL } from "./api-url.js";
import { createClientUuid } from "./client-id.js";

const API_URL = INTERO_API_URL;
type ConversationAttachment = Omit<Attachment, "objectKey">;

export interface TeamPulsePayload {
  generatedAt: string;
  projections: PublicWorkProjection[];
  principals: PrincipalSummary[];
  staleAfterSeconds: number;
}

export interface PrincipalSummary {
  id: string;
  displayName: string;
  kind: "human" | "stand_in" | "service";
  preferredLanguage?: "zh-CN" | "en-US";
}

export interface BootstrapPayload {
  organization: { id: string; name: string };
  currentPrincipal: PrincipalSummary;
  standInPrincipal: PrincipalSummary;
  adapters?: {
    realtime: "polling" | "centrifugo";
  };
}

export interface RealtimeSessionPayload {
  token: string;
  expiresAt: string;
  transports: Array<{
    transport: "websocket" | "sse";
    endpoint: string;
  }>;
  emulationEndpoint: string;
}

export interface RealtimeSubscriptionPayload {
  channel: string;
  token: string;
  expiresAt: string;
  accessVersion: number;
}

export interface ThreadPayload {
  thread: ConversationThread;
  messages: ThreadMessage[];
  /** Messages after your read marker that you did not send. */
  unreadCount?: number;
  /** Unread messages that explicitly target the current principal. */
  mentionCount?: number;
  lastReadSequence?: number;
  /** Client-only marker: the user explicitly paged beyond the bounded tail. */
  historyExpanded?: boolean;
  principals: PrincipalSummary[];
  actions: Array<{ envelope: ActionEnvelope; status: "resolved" }>;
}

export interface SpecPayload {
  spec: Spec;
  revisions: SpecRevision[];
  reviews: SpecReviewResponse[];
  principals: PrincipalSummary[];
}

export interface KanbanPayload {
  projects: Project[];
  selectedProjectId?: string;
  cards: KanbanCard[];
  workstreams: PublicWorkProjection[];
  principals: PrincipalSummary[];
}

export interface ProjectWorkPayload {
  project: { id: string; name: string; timezone: string };
  epics: Epic[];
  features: Feature[];
  workItems: WorkItem[];
  relations: WorkRelation[];
  codeReferences: WorkCodeReference[];
  comments: WorkComment[];
  history: WorkHistoryEntry[];
  programIncrements: Array<ProgramIncrement & { status: string }>;
  sprints: Array<Sprint & { status: string }>;
}

export interface ProjectSpecPayload {
  spec: Spec;
  revisions: SpecRevision[];
  commentThreads: Array<SpecCommentThread & { comments: SpecComment[] }>;
  confirmations: SpecConfirmation[];
  nominatedReviewerIds: string[];
  policy: SpecReviewPolicy;
}

export interface ProjectAutomationPayload {
  policy: ProjectAutomationPolicy;
  signals: Array<{
    signal: ProjectAutomationSignal;
    audit: ProjectAutomationAudit[];
  }>;
  canManage: boolean;
}

export async function getProjectAutomation(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectAutomationPayload> {
  return getJson(`/v1/project-automation/${projectId}`, signal);
}

export async function updateProjectAutomation(
  projectId: string,
  input: {
    enabled: boolean;
    enabledSignals: ProjectAutomationSignalKind[];
    staleSpecReviewHours: number;
    unresolvedCoordinationHours: number;
    quietUntil?: string | null;
  },
): Promise<ProjectAutomationPolicy> {
  return putJson(`/v1/project-automation/${projectId}`, input);
}

export async function revertProjectAutomationSignal(
  projectId: string,
  signalId: string,
): Promise<ProjectAutomationSignal> {
  return postJson(
    `/v1/project-automation/${projectId}/signals/${signalId}/revert`,
    {},
  );
}

export async function getProjectWork(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectWorkPayload> {
  return getJson(`/v1/project-work/${projectId}`, signal);
}

export async function createWorkItem(
  projectId: string,
  input: Record<string, unknown>,
): Promise<WorkItem> {
  return postJson(`/v1/project-work/${projectId}/items`, input);
}

export async function createEpic(
  projectId: string,
  input: { title: string; description?: string },
): Promise<Epic> {
  return postJson(`/v1/project-work/${projectId}/epics`, input);
}

export async function createFeature(
  projectId: string,
  input: Record<string, unknown>,
): Promise<Feature> {
  return postJson(`/v1/project-work/${projectId}/features`, input);
}

export async function updateFeature(
  projectId: string,
  featureId: string,
  input: Record<string, unknown>,
): Promise<Feature> {
  return patchJson(
    `/v1/project-work/${projectId}/features/${featureId}`,
    input,
  );
}

export async function updateWorkItem(
  projectId: string,
  workItemId: string,
  input: Record<string, unknown>,
): Promise<WorkItem> {
  return patchJson(`/v1/project-work/${projectId}/items/${workItemId}`, input);
}

export async function addWorkComment(
  projectId: string,
  workItemId: string,
  input: { body: string; parentId?: string },
): Promise<WorkComment> {
  return postJson(
    `/v1/project-work/${projectId}/items/${workItemId}/comments`,
    input,
  );
}

export async function addWorkCodeReference(
  projectId: string,
  workItemId: string,
  input: Record<string, unknown>,
): Promise<WorkCodeReference> {
  return postJson(
    `/v1/project-work/${projectId}/items/${workItemId}/code-references`,
    input,
  );
}

export async function addWorkRelation(
  projectId: string,
  workItemId: string,
  input: { targetId: string; kind: WorkRelation["kind"] },
): Promise<WorkRelation> {
  return postJson(
    `/v1/project-work/${projectId}/items/${workItemId}/relations`,
    input,
  );
}

export async function removeWorkCodeReference(
  projectId: string,
  referenceId: string,
): Promise<void> {
  return deleteJson(
    `/v1/project-work/${projectId}/code-references/${referenceId}`,
  );
}

export async function createProgramIncrement(
  projectId: string,
  input: {
    startDate: string;
    sprintCount: number;
    sprintDurationWeeks: number;
    timezone: string;
  },
): Promise<{ pi: ProgramIncrement; sprints: Sprint[] }> {
  return postJson(`/v1/project-work/${projectId}/program-increments`, input);
}

export async function closeSprint(
  projectId: string,
  sprintId: string,
): Promise<{ closed: true }> {
  return postJson(
    `/v1/project-work/${projectId}/sprints/${sprintId}/close`,
    {},
  );
}

export async function closeProgramIncrement(
  projectId: string,
  piId: string,
): Promise<{ closed: true }> {
  return postJson(
    `/v1/project-work/${projectId}/program-increments/${piId}/close`,
    {},
  );
}

export async function updateProjectSpecReviewPolicy(
  projectId: string,
  input: {
    requiredConfirmations: number;
    otherMemberAgentsCount: boolean;
    authorSelfConfirmation: boolean;
  },
): Promise<SpecReviewPolicy> {
  return patchJson(`/v1/project-work/${projectId}/spec-review-policy`, input);
}

export async function getProjectSpecs(
  projectId: string,
  signal?: AbortSignal,
): Promise<{ items: ProjectSpecPayload[] }> {
  return getJson(
    `/v1/spec-reviews?projectId=${encodeURIComponent(projectId)}`,
    signal,
  );
}

export async function createProjectSpecVersion(
  projectId: string,
  input: {
    specId?: string;
    title: string;
    markdown: string;
    changeSummary?: string;
    affectedScopes?: string[];
  },
): Promise<ProjectSpecPayload> {
  const path = input.specId
    ? `/v1/project-work/${projectId}/specs/${input.specId}/versions`
    : `/v1/project-work/${projectId}/specs`;
  const { specId: _specId, ...body } = input;
  return postJson(path, body);
}

export async function requestProjectSpecReview(
  projectId: string,
  specId: string,
  reviewerIds: string[],
): Promise<ProjectSpecPayload> {
  return postJson(
    `/v1/project-work/${projectId}/specs/${specId}/request-review`,
    { reviewerIds },
  );
}

export async function addProjectSpecComment(
  projectId: string,
  specId: string,
  input: Record<string, unknown>,
): Promise<ProjectSpecPayload> {
  return postJson(
    `/v1/project-work/${projectId}/specs/${specId}/comments`,
    input,
  );
}

export async function setProjectSpecCommentStatus(
  projectId: string,
  threadId: string,
  status: "open" | "resolved",
): Promise<ProjectSpecPayload> {
  return patchJson(
    `/v1/project-work/${projectId}/spec-comment-threads/${threadId}`,
    { status },
  );
}

export async function confirmProjectSpec(
  projectId: string,
  specId: string,
): Promise<ProjectSpecPayload> {
  return postJson(`/v1/project-work/${projectId}/specs/${specId}/confirm`, {});
}

export async function getBootstrap(
  signal?: AbortSignal,
): Promise<BootstrapPayload> {
  return getJson<BootstrapPayload>("/v1/bootstrap", signal);
}

export async function getTeamPulse(
  signal?: AbortSignal,
): Promise<TeamPulsePayload> {
  return getJson<TeamPulsePayload>("/v1/team-pulse", signal);
}

export async function getActionInbox(signal?: AbortSignal): Promise<{
  items: ActionInboxItem[];
  preferences: NotificationPreferences;
  unreadCount: number;
  automationSummary: Array<{
    projectId: string;
    projectName: string;
    openSignalCount: number;
    confirmedSignalCount: number;
    latestSafeContext: string;
    updatedAt: string;
  }>;
}> {
  return getJson("/v1/action-inbox", signal);
}

export async function updateActionInbox(
  itemId: string,
  action: "read" | "unread" | "dismiss" | "restore" | "resolve",
) {
  return patchJson<{ item: ActionInboxItem }>(
    `/v1/action-inbox/${encodeURIComponent(itemId)}`,
    { action },
  );
}

export async function setNotificationPreferences(input: {
  mutedKinds: ActionInboxItem["kind"][];
  muteUntil?: string;
}) {
  return putJson<{ preferences: NotificationPreferences }>(
    "/v1/notification-preferences",
    input,
  );
}

export async function searchAuthorizedContent(
  input: {
    query: string;
    projectId?: string;
    types?: AuthorizedSearchResult["type"][];
  },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ q: input.query });
  if (input.projectId) params.set("projectId", input.projectId);
  if (input.types?.length) params.set("types", input.types.join(","));
  return getJson<{ items: AuthorizedSearchResult[] }>(
    `/v1/search?${params}`,
    signal,
  );
}

export async function getThreads(
  kind?: ConversationThread["kind"],
  signal?: AbortSignal,
): Promise<{
  items: ThreadPayload[];
}> {
  return getJson(
    kind ? `/v1/threads?kind=${encodeURIComponent(kind)}` : "/v1/threads",
    signal,
  );
}

export async function createRealtimeSession(): Promise<RealtimeSessionPayload> {
  return postJson("/v1/realtime/session", {});
}

export async function createRealtimeSubscription(
  threadId: string,
): Promise<RealtimeSubscriptionPayload> {
  return postJson("/v1/realtime/subscriptions", { threadId });
}

export async function getKanban(
  projectId?: string,
  signal?: AbortSignal,
): Promise<KanbanPayload> {
  return getJson(
    projectId
      ? `/v1/kanban?projectId=${encodeURIComponent(projectId)}`
      : "/v1/kanban",
    signal,
  );
}

export async function createKanbanCard(input: {
  projectId: string;
  title: string;
  description: string;
  column: KanbanColumn;
  position: number;
  ownerId?: string;
  estimatePoints?: number;
  relatedWorkstreamIds: string[];
}): Promise<KanbanCard> {
  return postJson("/v1/kanban/cards", {
    id: createClientUuid(),
    ...input,
  });
}

export async function updateKanbanCard(
  cardId: KanbanCardId,
  input: Partial<{
    title: string;
    description: string;
    column: KanbanColumn;
    position: number;
    ownerId: string;
    estimatePoints: number;
    relatedWorkstreamIds: string[];
  }>,
): Promise<KanbanCard> {
  return patchJson(`/v1/kanban/cards/${cardId}`, input);
}

export async function sendThreadMessage(input: {
  threadId: string;
  body?: string;
  mentionedPrincipalIds?: string[];
  attachmentIds?: string[];
  clientMessageId?: string;
}): Promise<ThreadMessage> {
  return postJson(`/v1/threads/${input.threadId}/messages`, {
    clientMessageId: input.clientMessageId ?? createClientUuid(),
    body: input.body ?? "",
    mentionedPrincipalIds: input.mentionedPrincipalIds ?? [],
    attachmentIds: input.attachmentIds ?? [],
  });
}

export async function getThreadMessage(
  threadId: string,
  messageId: string,
  signal?: AbortSignal,
): Promise<ThreadMessage> {
  return getJson(
    `/v1/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(
      messageId,
    )}`,
    signal,
  );
}

export async function createAttachmentUpload(input: {
  id: string;
  threadId: string;
  ownerId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  checksumSha256: string;
  encryptionMode: "client_e2ee" | "server_envelope";
}): Promise<{
  attachment: ConversationAttachment;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
}> {
  return postJson("/v1/attachments/uploads", input);
}

export async function completeAttachmentUpload(
  attachmentId: string,
): Promise<ConversationAttachment> {
  return postJson(
    `/v1/attachments/${encodeURIComponent(attachmentId)}/complete`,
    {},
  );
}

export async function getAttachmentDownload(
  attachmentId: string,
  signal?: AbortSignal,
): Promise<{ attachment: ConversationAttachment; downloadUrl: string }> {
  return getJson(`/v1/attachments/${encodeURIComponent(attachmentId)}`, signal);
}

export async function getThreadMessages(
  threadId: string,
  input: {
    afterSequence?: number;
    beforeSequence?: number;
    tail?: number;
    limit?: number;
  },
  signal?: AbortSignal,
): Promise<{
  items: ThreadMessage[];
  headSequence: number;
  accessVersion: number;
  hasMore: boolean;
}> {
  const query = new URLSearchParams();
  if (input.afterSequence !== undefined) {
    query.set("afterSequence", String(input.afterSequence));
  }
  if (input.beforeSequence !== undefined) {
    query.set("beforeSequence", String(input.beforeSequence));
  }
  if (input.tail !== undefined) query.set("tail", String(input.tail));
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  return getJson(
    `/v1/threads/${encodeURIComponent(threadId)}/messages?${query}`,
    signal,
  );
}

export async function createConversationThread(input: {
  kind: ConversationThread["kind"];
  title: string;
  participantIds: string[];
  standInIds: string[];
  /** Optional owning team — a conversation may deliberately have none. */
  teamId?: string;
  /** Set when branching a temporary discussion out of another conversation. */
  parentThreadId?: string;
}): Promise<ConversationThread> {
  return postJson("/v1/threads", {
    id: createClientUuid(),
    ...input,
    accessMode: "agent_readable",
    priorHistoryGranted: false,
    createdAt: new Date().toISOString(),
  });
}

export async function markThreadRead(input: {
  threadId: string;
  sequence: number;
}): Promise<void> {
  await postJson(`/v1/threads/${input.threadId}/read`, {
    sequence: input.sequence,
  });
}

export async function addStandInToThread(
  threadId: string,
  standInId: string,
): Promise<{ thread: ConversationThread; event: ThreadMessage }> {
  return postJson(`/v1/threads/${threadId}/stand-ins`, { standInId });
}

/** Post the branch's conclusion into its parent and close the branch. */
export async function concludeThread(input: {
  threadId: string;
  conclusion: string;
}): Promise<{ thread: ConversationThread; parentMessage: ThreadMessage }> {
  return postJson(`/v1/threads/${input.threadId}/conclusion`, {
    clientMessageId: createClientUuid(),
    conclusion: input.conclusion,
  });
}

export async function createSpec(input: {
  id: string;
  title: string;
  markdown: string;
  affectedScopes: string[];
  createdBy: string;
  changeSummary: string;
}): Promise<{
  spec: Spec;
  revision: SpecRevision;
}> {
  return postJson("/v1/specs", {
    ...input,
    relatedWorkstreamIds: [],
    status: "in_review",
  });
}

export async function createSpecRevision(input: {
  specId: string;
  revision: number;
  markdown: string;
  affectedScopes: string[];
  createdBy: string;
  changeSummary: string;
}): Promise<SpecRevision> {
  return postJson(`/v1/specs/${input.specId}/revisions`, {
    ...input,
  });
}

export async function getSpecs(
  signal?: AbortSignal,
): Promise<{ items: SpecPayload[] }> {
  return getJson<{ items: SpecPayload[] }>("/v1/specs", signal);
}

export async function addSpecReview(input: {
  specId: string;
  review: {
    revisionId: string;
    reviewerId: string;
    kind: ReviewResponseKind;
    affectedScopes: string[];
    body: string;
  };
}): Promise<SpecReviewResponse> {
  return postJson(`/v1/specs/${input.specId}/reviews`, {
    ...input.review,
    createdAt: new Date().toISOString(),
  });
}

export async function createDecision(input: {
  title: string;
  outcome: string;
  sourceSpecRevisionId?: string;
  sourceThreadId?: string;
  affectedScopes: string[];
  decidedBy: string[];
}): Promise<DecisionRecord> {
  return postJson("/v1/decisions", input);
}

export async function getDecisions(
  signal?: AbortSignal,
): Promise<{ items: DecisionRecord[] }> {
  return getJson<{ items: DecisionRecord[] }>("/v1/decisions", signal);
}

export interface GovernanceAuditEntry {
  id: string;
  eventType: string;
  actorId: string;
  subjectId?: string;
  aggregateId: string;
  /** Structured facts only — role names and invitation addresses. */
  detail: Record<string, string | number | boolean | null>;
  occurredAt: string;
}

export async function getGovernanceAudit(signal?: AbortSignal): Promise<{
  entries: GovernanceAuditEntry[];
  principals: PrincipalSummary[];
}> {
  return getJson("/v1/governance-audit", signal);
}

export async function getActivity(
  after = 0,
  limit = 200,
  signal?: AbortSignal,
): Promise<{ items: ActivityEvent[]; nextCursor: number; hasMore: boolean }> {
  return getJson(`/v1/activity?after=${after}&limit=${limit}`, signal);
}

export async function getCodingAgentIntegrations(): Promise<
  CodingAgentIntegrationStatus[]
> {
  if (typeof window === "undefined" || !window.interoDesktop) return [];
  return window.interoDesktop.getIntegrationStatus();
}

export async function previewCodingAgentIntegration(input: {
  adapter: CodingAgentAdapter;
  action: CodingAgentIntegrationAction;
  locale: "zh-CN" | "en-US";
}): Promise<CodingAgentIntegrationPreview | null> {
  if (typeof window === "undefined" || !window.interoDesktop) {
    throw new Error("Integration management requires Intero Desktop.");
  }
  return window.interoDesktop.previewIntegration(
    input.adapter,
    input.action,
    input.locale,
  );
}

export async function manageCodingAgentIntegration(input: {
  adapter: CodingAgentAdapter;
  token: string;
}): Promise<CodingAgentIntegrationStatus[]> {
  if (typeof window === "undefined" || !window.interoDesktop) {
    throw new Error("Integration management requires Intero Desktop.");
  }
  return window.interoDesktop.manageIntegration(input.token);
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...(signal ? { signal } : {}),
    credentials: "include",
    headers: developmentIdentityHeaders(),
  });
  await ensureResponseOk(response);
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...developmentIdentityHeaders(),
    },
    body: JSON.stringify(body),
  });
  await ensureResponseOk(response);
  return (await response.json()) as T;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...developmentIdentityHeaders(),
    },
    body: JSON.stringify(body),
  });
  await ensureResponseOk(response);
  return (await response.json()) as T;
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...developmentIdentityHeaders(),
    },
    body: JSON.stringify(body),
  });
  await ensureResponseOk(response);
  return (await response.json()) as T;
}

async function deleteJson(path: string): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "DELETE",
    credentials: "include",
    headers: developmentIdentityHeaders(),
  });
  await ensureResponseOk(response);
}

async function ensureResponseOk(response: Response): Promise<void> {
  if (response.ok) return;
  handleAuthenticationFailure(response.status);
  const fallback = `Intero API returned ${response.status}.`;
  let body: { message?: unknown } | undefined;
  try {
    body = (await response.json()) as { message?: unknown };
  } catch {
    // Some proxies return an empty or non-JSON error response.
  }
  throw new Error(
    typeof body?.message === "string" && body.message.trim()
      ? body.message
      : fallback,
  );
}

function developmentIdentityHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const principalId = window.localStorage.getItem(PILOT_IDENTITY_STORAGE_KEY);
  return principalId ? { "x-intero-dev-principal-id": principalId } : {};
}
