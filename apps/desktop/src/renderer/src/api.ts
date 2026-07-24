import type {
  ActionInboxItem,
  ConversationThread,
  PublicWorkProjection,
  ThreadMessage,
} from "@intero/domain";

const API_URL = import.meta.env.VITE_INTERO_API_URL ?? "http://localhost:4310";

export interface TeamPulsePayload {
  generatedAt: string;
  projections: PublicWorkProjection[];
  staleAfterSeconds: number;
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
  kind: ConversationThread["kind"],
  signal?: AbortSignal,
): Promise<{
  items: Array<{ thread: ConversationThread; messages: ThreadMessage[] }>;
}> {
  return getJson(`/v1/threads?kind=${encodeURIComponent(kind)}`, signal);
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

export async function createSpec(input: {
  id: string;
  title: string;
  markdown: string;
  affectedScopes: string[];
  createdBy: string;
}): Promise<{
  spec: { id: string; status: string };
  revision: { id: string; revision: number };
}> {
  return postJson("/v1/specs", {
    ...input,
    relatedWorkstreamIds: [],
    status: "in_review",
    changeSummary: "Published from the Intero desktop Spec editor.",
  });
}

export async function createSpecRevision(input: {
  specId: string;
  revision: number;
  markdown: string;
  affectedScopes: string[];
  createdBy: string;
}): Promise<{ id: string; revision: number }> {
  return postJson(`/v1/specs/${input.specId}/revisions`, {
    ...input,
    changeSummary: "Material revision published from the Intero desktop.",
  });
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
