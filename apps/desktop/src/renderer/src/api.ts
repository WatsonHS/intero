import type {
  ActionEnvelope,
  ActionInboxItem,
  ConversationThread,
  KanbanCard,
  KanbanCardId,
  KanbanColumn,
  Project,
  PublicWorkProjection,
  Spec,
  SpecRevision,
  SpecReviewResponse,
  ThreadMessage,
} from "@intero/domain";

const API_URL = import.meta.env.VITE_INTERO_API_URL ?? "http://localhost:4310";

export interface TeamPulsePayload {
  generatedAt: string;
  projections: PublicWorkProjection[];
  principals: PrincipalSummary[];
  staleAfterSeconds: number;
}

export interface PrincipalSummary {
  id: string;
  displayName: string;
  kind: "human" | "representative" | "service";
}

export interface BootstrapPayload {
  organization: { id: string; name: string };
  currentPrincipal: PrincipalSummary;
  representativePrincipal: PrincipalSummary;
}

export interface ThreadPayload {
  thread: ConversationThread;
  messages: ThreadMessage[];
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

export async function getActionInbox(
  signal?: AbortSignal,
): Promise<{ items: ActionInboxItem[] }> {
  return getJson<{ items: ActionInboxItem[] }>("/v1/action-inbox", signal);
}

export async function getOfflineStatus(signal?: AbortSignal): Promise<{
  localRuntime: "online" | "offline";
  fallback: "local" | "public";
  freshnessAt: string | null;
  stale: boolean;
  disclosure: string;
}> {
  return getJson("/v1/offline-status", signal);
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
    id: crypto.randomUUID(),
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
  senderId: string;
  body: string;
}): Promise<ThreadMessage> {
  return postJson(`/v1/threads/${input.threadId}/messages`, {
    id: crypto.randomUUID(),
    senderId: input.senderId,
    body: input.body,
    createdAt: new Date().toISOString(),
  });
}

export async function createConversationThread(input: {
  kind: ConversationThread["kind"];
  title: string;
  participantIds: string[];
  representativeIds: string[];
}): Promise<ConversationThread> {
  return postJson("/v1/threads", {
    id: crypto.randomUUID(),
    ...input,
    accessMode: "agent_readable",
    priorHistoryGranted: false,
    createdAt: new Date().toISOString(),
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

export async function getLocalRuntimeStatus(): Promise<LocalRuntimeStatus> {
  if (typeof window === "undefined" || !window.interoDesktop) {
    return { available: false, reason: "desktop_required" };
  }
  return window.interoDesktop.getLocalStatus();
}

export async function setModelEgress(
  mode: ModelEgressMode,
): Promise<{ modelEgress: ModelEgressMode }> {
  if (typeof window === "undefined" || !window.interoDesktop) {
    throw new Error("The local runtime bridge requires Intero Desktop.");
  }
  return window.interoDesktop.setModelEgress(mode);
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
  const response = await fetch(
    `${API_URL}${path}`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) {
    throw new Error(`Intero API returned ${response.status}.`);
  }
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Intero API returned ${response.status}.`);
  }
  return (await response.json()) as T;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Intero API returned ${response.status}.`);
  }
  return (await response.json()) as T;
}
