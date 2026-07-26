import type {
  PilotAgentBinding,
  PilotAgentClient,
  PilotCollaborationPosture,
  PilotCoordinationThread,
  PilotDirectMessage,
  PilotDirectMessageThread,
  PilotOrganization,
  PilotPrivateWorkState,
  PilotProject,
  PilotPulseEntry,
  PilotStandInExchange,
  PilotTeam,
  PilotTeamRole,
  PilotOrganizationRole,
  PrincipalId,
} from "@intero/domain";

import type { PrincipalSummary } from "../api.js";

export const PILOT_API_URL =
  import.meta.env.VITE_INTERO_API_URL ?? "http://127.0.0.1:4310";

export const PILOT_IDENTITY_STORAGE_KEY = "intero.pilot.identity.v1";
export const PILOT_PROJECT_STORAGE_KEY = "intero.pilot.project.v1";
export const PILOT_TEAM_STORAGE_KEY = "intero.pilot.team.v1";

export interface PilotBootstrapPayload {
  authMode: "session" | "development_identity" | "unavailable";
  identityHeader?: string;
  identities: PrincipalSummary[];
  currentPrincipal?: PrincipalSummary & { email: string };
  standIn: PrincipalSummary;
  organization?: PilotOrganization;
  administratorId?: PrincipalId;
  organizationRole?: PilotOrganizationRole;
  dataPolicy: {
    structuredPrivateRetentionDays: number;
    rawContentRetentionDays: number;
    rawContentCaptureEnabled: boolean;
    publishedSummaries: string;
    modelUse: string;
  };
  adapters: {
    realtime: "polling";
    objectStorage: "disabled";
    jobs: "inline";
    coordination: "project-internal-v1";
    projectWork: "postgres" | "unavailable";
  };
}

export interface PilotTeamPayload extends PilotTeam {
  members: Array<
    Omit<PrincipalSummary, "id"> & {
      id: PrincipalId;
      email: string;
      teamRole: PilotTeamRole;
      organizationRole?: PilotOrganizationRole;
    }
  >;
}

export type PilotInvitationStatus =
  "pending" | "accepted" | "expired" | "revoked";

export interface PilotInvitationPayload {
  id: string;
  organizationId: string;
  teamId: string;
  displayName: string;
  email: string;
  createdBy: PrincipalId;
  expiresAt: string;
  acceptedAt?: string;
  acceptedBy?: PrincipalId;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
  status: PilotInvitationStatus;
}

export interface PilotOverviewPayload {
  project: PilotProject;
  bindings: Array<Omit<PilotAgentBinding, "credentialHash">>;
  privateWorkState: PilotPrivateWorkState[];
  pulse: PilotPulseEntry[];
  coordination: PilotCoordinationThread[];
  principals: PrincipalSummary[];
  organization?: PilotOrganization;
}

export interface PilotDmPayload {
  items: Array<{
    thread: PilotDirectMessageThread;
    messages: PilotDirectMessage[];
  }>;
  principals: PrincipalSummary[];
}

export interface PilotStandInPayload {
  exchanges: PilotStandInExchange[];
  standInOwner: PrincipalSummary;
  standIn: PrincipalSummary;
}

export class PilotApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function isPilotBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    !window.interoDesktop &&
    (import.meta.env.DEV || import.meta.env.VITE_INTERO_PILOT === "true")
  );
}

export function getPilotBootstrap(signal?: AbortSignal) {
  return request<PilotBootstrapPayload>("/v1/pilot/bootstrap", {
    ...(signal ? { signal } : {}),
  });
}

export function setupPilot(
  identityId: PrincipalId,
  input: {
    organizationName: string;
    teamName: string;
    deploymentBaseUrl: string;
  },
) {
  return request<{ organization: PilotOrganization; team: PilotTeam }>(
    "/v1/pilot/setup",
    { method: "POST", identityId, body: input },
  );
}

export function configurePilotProvider(
  identityId: PrincipalId,
  input: { endpoint: string; apiKey: string; defaultModel: string },
) {
  return request<{ organization: PilotOrganization }>(
    "/v1/pilot/setup/provider",
    { method: "PUT", identityId, body: input },
  );
}

export function updatePilotDeploymentEndpoint(deploymentBaseUrl: string) {
  return request<{ organization: PilotOrganization }>(
    "/v1/pilot/settings/deployment",
    { method: "PATCH", body: { deploymentBaseUrl } },
  );
}

export function getPilotProfile(signal?: AbortSignal) {
  return request<{
    profile: PrincipalSummary & {
      email: string;
      organizationRole?: PilotOrganizationRole;
      avatarTone?: "accent" | "green" | "amber" | "cool";
      preferredLanguage?: "zh-CN" | "en-US";
    };
  }>("/v1/pilot/profile", { ...(signal ? { signal } : {}) });
}

export function updatePilotProfile(input: {
  displayName?: string;
  avatarTone?: "accent" | "green" | "amber" | "cool";
  preferredLanguage?: "zh-CN" | "en-US";
}) {
  return request<{
    profile: PrincipalSummary & {
      email: string;
      avatarTone?: "accent" | "green" | "amber" | "cool";
      preferredLanguage?: "zh-CN" | "en-US";
    };
  }>("/v1/pilot/profile", {
    method: "PATCH",
    body: input,
  });
}

export async function getPilotTeams(
  identityId: PrincipalId,
  signal?: AbortSignal,
) {
  return request<{ teams: PilotTeamPayload[] }>("/v1/pilot/teams", {
    identityId,
    ...(signal ? { signal } : {}),
  });
}

export function createPilotJoinLink(identityId: PrincipalId, teamId: string) {
  return request<{
    link: {
      id: string;
      expiresAt?: string;
      maxUses?: number;
      useCount: number;
    };
    code: string;
    joinPath: string;
  }>(`/v1/pilot/teams/${teamId}/join-links`, {
    method: "POST",
    identityId,
    body: {},
  });
}

export function getPilotInvitations(teamId: string, signal?: AbortSignal) {
  return request<{ invitations: PilotInvitationPayload[] }>(
    `/v1/pilot/teams/${teamId}/invitations`,
    { ...(signal ? { signal } : {}) },
  );
}

export function createPilotInvitation(
  teamId: string,
  input: { displayName: string; email: string; expiresInDays?: number },
) {
  return request<{
    invitation: PilotInvitationPayload;
    token: string;
    activationPath: string;
  }>(`/v1/pilot/teams/${teamId}/invitations`, {
    method: "POST",
    body: input,
  });
}

export function regeneratePilotInvitation(
  invitationId: string,
  expiresInDays = 7,
) {
  return request<{
    invitation: PilotInvitationPayload;
    token: string;
    activationPath: string;
  }>(`/v1/pilot/invitations/${invitationId}/regenerate`, {
    method: "POST",
    body: { expiresInDays },
  });
}

export function revokePilotInvitation(invitationId: string) {
  return request<{ invitation: PilotInvitationPayload }>(
    `/v1/pilot/invitations/${invitationId}/revoke`,
    { method: "POST", body: {} },
  );
}

export function getPilotInvitation(token: string, signal?: AbortSignal) {
  return request<{
    invitation: PilotInvitationPayload;
    organization: { id: string; name: string };
    team: { id: string; name: string };
    activationRequired: boolean;
  }>(`/v1/pilot/invitations/${encodeURIComponent(token)}`, {
    ...(signal ? { signal } : {}),
  });
}

export function activatePilotInvitation(
  token: string,
  input:
    | { credential: "passkey" }
    | { credential: "password" | "both"; password: string },
) {
  return request<{
    activated: true;
    credential: "passkey" | "password" | "both";
    passkeyEnrollmentRequired: boolean;
  }>(`/v1/pilot/invitations/${encodeURIComponent(token)}/activate`, {
    method: "POST",
    body: input,
  });
}

export function acceptPilotInvitation(token: string) {
  return request<{
    invitation: PilotInvitationPayload;
    team: PilotTeam;
    profile: PrincipalSummary & { email: string };
    projects: PilotProject[];
  }>(`/v1/pilot/invitations/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    body: {},
  });
}

export function updatePilotMember(
  teamId: string,
  memberId: PrincipalId,
  input: {
    teamRole?: PilotTeamRole;
    organizationRole?: PilotOrganizationRole;
  },
) {
  return request<unknown>(`/v1/pilot/teams/${teamId}/members/${memberId}`, {
    method: "PATCH",
    body: input,
  });
}

export function removePilotMember(teamId: string, memberId: PrincipalId) {
  return request<void>(`/v1/pilot/teams/${teamId}/members/${memberId}`, {
    method: "DELETE",
  });
}

export function signOut() {
  return requestAuth<unknown>("/api/auth/sign-out", {
    method: "POST",
    body: {},
  });
}

export function joinPilotTeam(identityId: PrincipalId, code: string) {
  return request<{ team: PilotTeam }>(
    `/v1/pilot/join/${encodeURIComponent(normalizeJoinCode(code))}`,
    { method: "POST", identityId, body: {} },
  );
}

export async function getPilotProjects(
  identityId: PrincipalId,
  signal?: AbortSignal,
) {
  return request<{ projects: PilotProject[] }>("/v1/pilot/projects", {
    identityId,
    ...(signal ? { signal } : {}),
  });
}

export function createPilotProject(
  identityId: PrincipalId,
  input: {
    name: string;
    primaryTeamId: string;
    participatingTeamIds: string[];
    posture: PilotCollaborationPosture;
  },
) {
  return request<{ project: PilotProject }>("/v1/pilot/projects", {
    method: "POST",
    identityId,
    body: input,
  });
}

export function getPilotOverview(
  identityId: PrincipalId,
  projectId: string,
  signal?: AbortSignal,
) {
  return request<PilotOverviewPayload>(
    `/v1/pilot/projects/${projectId}/overview`,
    { identityId, ...(signal ? { signal } : {}) },
  );
}

export function updatePilotPosture(
  identityId: PrincipalId,
  projectId: string,
  posture: PilotCollaborationPosture,
) {
  return request<{ project: PilotProject }>(
    `/v1/pilot/projects/${projectId}/posture`,
    { method: "PATCH", identityId, body: { posture } },
  );
}

export function withdrawPilotPulse(
  identityId: PrincipalId,
  projectId: string,
  workStateId: string,
) {
  return request<{ entry: PilotPulseEntry; duplicate: boolean }>(
    `/v1/pilot/projects/${projectId}/pulse/${workStateId}/withdraw`,
    {
      method: "POST",
      identityId,
      idempotencyKey: `pulse-withdraw:${projectId}:${workStateId}`,
      body: {},
    },
  );
}

export function getPilotDms(identityId: PrincipalId, signal?: AbortSignal) {
  return request<PilotDmPayload>("/v1/pilot/dms", {
    identityId,
    ...(signal ? { signal } : {}),
  });
}

export function createPilotDm(
  identityId: PrincipalId,
  input: { teamId: string; peerId: PrincipalId },
) {
  return request<{ thread: PilotDirectMessageThread }>("/v1/pilot/dms", {
    method: "POST",
    identityId,
    body: input,
  });
}

export function sendPilotDm(
  identityId: PrincipalId,
  threadId: string,
  body: string,
) {
  return request<{ message: PilotDirectMessage }>(
    `/v1/pilot/dms/${threadId}/messages`,
    { method: "POST", identityId, body: { body } },
  );
}

export function addPilotStandIn(identityId: PrincipalId, threadId: string) {
  return request<{ thread: PilotDirectMessageThread }>(
    `/v1/pilot/dms/${threadId}/stand-in`,
    { method: "POST", identityId, body: {} },
  );
}

export function getPilotStandIn(
  identityId: PrincipalId,
  projectId: string,
  standInOwnerId: PrincipalId,
  signal?: AbortSignal,
) {
  return request<PilotStandInPayload>(
    `/v1/pilot/projects/${projectId}/stand-in?${new URLSearchParams({
      standInOwnerId,
    })}`,
    { identityId, ...(signal ? { signal } : {}) },
  );
}

export function askPilotStandIn(
  identityId: PrincipalId,
  projectId: string,
  standInOwnerId: PrincipalId,
  question: string,
) {
  return request<{
    exchange: PilotStandInExchange;
    standInOwner: PrincipalSummary;
    standIn: PrincipalSummary;
  }>(
    `/v1/pilot/projects/${projectId}/stand-in`,
    {
      method: "POST",
      identityId,
      body: { question, standInOwnerId },
    },
  );
}

export function createPilotAgentTicket(
  identityId: PrincipalId,
  projectId: string,
  client: PilotAgentClient,
) {
  return request<{
    ticket: { id: string; client: PilotAgentClient; expiresAt: string };
    connectPrompt: string;
  }>(`/v1/pilot/projects/${projectId}/agent-tickets`, {
    method: "POST",
    identityId,
    body: { client },
  });
}

export function disconnectPilotAgent(
  identityId: PrincipalId,
  bindingId: string,
) {
  return request<{ binding: Omit<PilotAgentBinding, "credentialHash"> }>(
    `/v1/pilot/agent-bindings/${bindingId}/disconnect`,
    { method: "POST", identityId, body: {} },
  );
}

export function proposePilotConclusion(
  identityId: PrincipalId,
  threadId: string,
  input: { conclusion: string; responsibleParticipantId: PrincipalId },
) {
  return request<{ thread: PilotCoordinationThread }>(
    `/v1/pilot/coordination/${threadId}/conclusion`,
    { method: "POST", identityId, body: input },
  );
}

export function confirmPilotConclusion(
  identityId: PrincipalId,
  threadId: string,
) {
  return request<{ thread: PilotCoordinationThread }>(
    `/v1/pilot/coordination/${threadId}/confirm`,
    { method: "POST", identityId, body: {} },
  );
}

function normalizeJoinCode(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("join") ?? trimmed;
  } catch {
    return trimmed.replace(/^.*[?&]join=/, "");
  }
}

async function request<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    identityId?: PrincipalId;
    idempotencyKey?: string;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const response = await fetch(`${PILOT_API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.identityId
        ? { "x-intero-dev-principal-id": options.identityId }
        : {}),
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...(options.idempotencyKey
        ? { "idempotency-key": options.idempotencyKey }
        : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
    ...(options.signal ? { signal: options.signal } : {}),
    credentials: "include",
  });
  const body = (await response.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new PilotApiError(
      body.code ?? "PILOT_API_ERROR",
      response.status,
      body.message ?? `Intero API returned ${response.status}.`,
    );
  }
  return body as T;
}

async function requestAuth<T>(
  path: string,
  options: { method: "POST"; body: unknown },
): Promise<T> {
  const response = await fetch(`${PILOT_API_URL}${path}`, {
    method: options.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options.body),
    credentials: "include",
  });
  const body = (await response.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new PilotApiError(
      body.code ?? "AUTH_ERROR",
      response.status,
      body.message ?? `Authentication returned ${response.status}.`,
    );
  }
  return body as T;
}
