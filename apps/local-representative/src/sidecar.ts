import {
  CanonicalWorkEvent,
  type CapabilityGrant,
  type ConversationThread,
  type CoordinationResult,
  type DecisionRecord,
  type PrincipalId,
  type EventSource,
  type PublicWorkProjection,
  type Spec,
  type WorkspaceId,
  type WorkstreamId,
  uuidv7,
} from "@intero/domain";
import { integrationAdapters } from "@intero/integrations";
import {
  type DaemonClient,
  SocketDaemonClient,
  loadConnectionSettings,
} from "@intero/local-ipc";

import { LocalRepresentativeRuntime } from "./runtime.js";

interface QueuedRequest {
  requestId: string;
  method: string;
  params: Record<string, unknown>;
}

export async function runSidecar(
  runtime: LocalRepresentativeRuntime,
): Promise<never> {
  const connection = await loadConnectionSettings();
  const daemon = new SocketDaemonClient(
    connection.socketPath,
    connection.authToken,
  );
  const health = (await daemon.call("system.health", {})) as {
    status?: string;
    protocolVersion?: number;
  };
  if (health.status !== "ok" || health.protocolVersion !== 1) {
    throw new Error("interod is incompatible with this Local Representative.");
  }
  await replayDurableEvents(daemon, runtime);
  for (;;) {
    const request = (await daemon.call(
      "representative.next_request",
      {},
    )) as QueuedRequest | null;
    if (!request) {
      await delay(250);
      continue;
    }
    try {
      await processQueuedRequest(daemon, runtime, request);
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify({
          level: "error",
          operation: "representative.request",
          requestId: request.requestId,
          error: error instanceof Error ? error.message : "unknown_error",
        })}\n`,
      );
      await delay(1_000);
    }
  }
}

export async function processQueuedRequest(
  daemon: DaemonClient,
  runtime: LocalRepresentativeRuntime,
  request: QueuedRequest,
): Promise<void> {
  const event = requestToEvent(request);
  let result: unknown;
  if (event) {
    const persisted = (await daemon.call("state.persist_event", { event })) as {
      inserted: boolean;
    };
    if (!persisted.inserted) {
      const replayedProjection = runtime.projections
        .toReversed()
        .find((projection) => projection.id === event.workstreamId);
      if (replayedProjection) await synchronizeProjection(replayedProjection);
      result = {
        accepted: true,
        duplicate: true,
        workstreamId: event.workstreamId,
        ...(replayedProjection ? { projection: replayedProjection } : {}),
      };
    } else {
      const reduced = await runtime.handle(event);
      if (reduced.projection) await synchronizeProjection(reduced.projection);
      result = {
        accepted: true,
        duplicate: false,
        workstreamId: reduced.workstream.id,
        claimId: runtime.claims.get(reduced.workstream.id)?.at(-1)?.id,
        ...(reduced.projection ? { projection: reduced.projection } : {}),
      };
    }
  } else {
    result = await handleSemanticRequest(runtime, request);
  }
  await daemon.call("representative.complete_request", {
    requestId: request.requestId,
    result,
  });
}

async function replayDurableEvents(
  daemon: DaemonClient,
  runtime: LocalRepresentativeRuntime,
): Promise<void> {
  const state = (await daemon.call("state.list_events", { limit: 10_000 })) as {
    events?: unknown[];
  };
  for (const candidate of state.events ?? []) {
    const event = CanonicalWorkEvent.safeParse(candidate);
    if (event.success) await runtime.handle(event.data);
  }
}

function requestToEvent(
  request: QueuedRequest,
): CanonicalWorkEvent | undefined {
  const workspaceId = stringParam(request.params, "workspaceId");
  const workstreamId = stringParam(request.params, "workstreamId");
  if (!workspaceId || !workstreamId) return undefined;

  if (request.method === "representative.ingest_adapter_event") {
    const source = stringParam(request.params, "source") as
      EventSource | undefined;
    const sourceEvent = stringParam(request.params, "sourceEvent");
    const adapter = integrationAdapters.find(
      (candidate) => candidate.kind === source,
    );
    if (!adapter || !sourceEvent) return undefined;
    const normalized = adapter.normalize({
      sourceEvent,
      workspaceId: workspaceId as WorkspaceId,
      workstreamId: workstreamId as WorkstreamId,
      ...(stringParam(request.params, "occurredAt")
        ? { occurredAt: stringParam(request.params, "occurredAt")! }
        : {}),
      ...(recordParam(request.params, "metadata")
        ? { metadata: recordParam(request.params, "metadata")! }
        : {}),
    });
    return normalized.success ? normalized.data : undefined;
  }

  if (request.method !== "representative.report_checkpoint") return undefined;
  const kind = stringParam(request.params, "kind");
  const summary = stringParam(request.params, "summary");
  const parsed = CanonicalWorkEvent.safeParse({
    id: uuidv7(),
    operationId: uuidv7(),
    schemaVersion: 1,
    source: "system",
    type: "CheckpointReported",
    occurredAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    workspaceId,
    workstreamId,
    privacy: "P1_REPRESENTATIVE_PRIVATE",
    payload: { checkpointKind: kind, summary },
    idempotencyKey: `mcp:${request.requestId}`,
  });
  return parsed.success ? parsed.data : undefined;
}

async function handleSemanticRequest(
  runtime: LocalRepresentativeRuntime,
  request: QueuedRequest,
): Promise<unknown> {
  switch (request.method) {
    case "representative.lookup_team_context":
      return lookupTeamContext(request.params);
    case "representative.lookup_decision":
      return lookupDecision(request.params);
    case "representative.check_scope":
      return checkScope(runtime, request.params);
    case "representative.request_coordination":
      return requestCoordination(runtime, request.params, request.requestId);
    case "representative.request_spec_review":
      return requestSpecReview(runtime, request.params, request.requestId);
    default:
      throw new Error(`Unsupported Representative request ${request.method}.`);
  }
}

async function lookupTeamContext(
  params: Record<string, unknown>,
): Promise<unknown> {
  const query = requiredString(params, "query").toLowerCase();
  const response = await apiRequest<{
    generatedAt: string;
    projections: PublicWorkProjection[];
    staleAfterSeconds: number;
  }>("/v1/team-pulse");
  const terms = query.split(/\s+/).filter(Boolean);
  const projections = response.projections
    .filter((projection) => {
      const searchable = [
        projection.title,
        projection.phase,
        ...projection.blockers,
        ...projection.dependencies,
        ...projection.decisions,
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((term) => searchable.includes(term));
    })
    .slice(0, 10);
  return {
    generatedAt: response.generatedAt,
    freshnessDisclosure: projections.some(
      (projection) =>
        Date.now() - Date.parse(projection.freshnessAt) >
        response.staleAfterSeconds * 1_000,
    )
      ? "Some matching public Work State is stale."
      : "Matching public Work State is within the freshness window.",
    workstreams: projections,
  };
}

async function lookupDecision(
  params: Record<string, unknown>,
): Promise<unknown> {
  const query = requiredString(params, "query").toLowerCase();
  const response = await apiRequest<{ items: DecisionRecord[] }>(
    "/v1/decisions",
  );
  const terms = query.split(/\s+/).filter(Boolean);
  return {
    decisions: response.items
      .filter((decision) => {
        const searchable =
          `${decision.title} ${decision.outcome} ${decision.affectedScopes.join(" ")}`.toLowerCase();
        return terms.every((term) => searchable.includes(term));
      })
      .slice(0, 10),
  };
}

function checkScope(
  runtime: LocalRepresentativeRuntime,
  params: Record<string, unknown>,
): unknown {
  const workstreamId = requiredString(params, "workstreamId") as WorkstreamId;
  const requested = stringArrayParam(params, "resourceScope");
  const workstream = runtime.workstreams.get(workstreamId);
  const allowedScope = workstream?.scope ?? [];
  const outside = requested.filter(
    (resource) =>
      !allowedScope.some(
        (allowed) => resource === allowed || resource.startsWith(`${allowed}/`),
      ),
  );
  return {
    allowed: outside.length === 0,
    workstreamId,
    allowedScope,
    outsideScope: outside,
    suggestedAgentAction: outside.length === 0 ? "continue" : "ask_human",
  };
}

async function requestCoordination(
  runtime: LocalRepresentativeRuntime,
  params: Record<string, unknown>,
  requestId: string,
): Promise<CoordinationResult> {
  const now = new Date();
  const workstreamId = requiredString(params, "workstreamId") as WorkstreamId;
  const reason = requiredString(params, "reason");
  const resourceScope = stringArrayParam(params, "resourceScope");
  const publicWorkstream = await isPublicWorkstream(workstreamId);
  const representativeId = localRepresentativeId();
  const threadId = requestId as ConversationThread["id"];
  const thread: Omit<ConversationThread, "sequence"> = {
    id: threadId,
    kind: "coordination",
    title: reason.slice(0, 200),
    participantIds: [runtime.principalId],
    representativeIds: [representativeId],
    accessMode: "agent_readable",
    priorHistoryGranted: false,
    createdAt: now.toISOString(),
  };
  await apiRequest("/v1/threads", { method: "POST", body: thread });

  const grant: CapabilityGrant = {
    id: requestId as CapabilityGrant["id"],
    principalId: representativeId,
    actions: [
      "read_public_state",
      "answer_status",
      "request_coordination",
      "register_dependency",
    ],
    organizationId: organizationId(),
    projectIds: [],
    workstreamIds: publicWorkstream ? [workstreamId] : [],
    resourceScopes: resourceScope,
    requiresConfirmation: [],
    expiresAt: new Date(now.getTime() + 60 * 60 * 1_000).toISOString(),
    policyVersion: "mvp-v1",
  };
  await apiRequest("/v1/capability-grants", { method: "POST", body: grant });
  const operationId =
    requestId as CoordinationResult["actionOperationIds"][number];
  const response = await apiRequest<{ result: CoordinationResult }>(
    "/v1/coordination",
    {
      method: "POST",
      body: {
        envelope: {
          schemaVersion: 1,
          operationId,
          action: "coordination_request",
          actorId: representativeId,
          authorityGrantId: grant.id,
          policyVersion: grant.policyVersion,
          threadId,
          ...(publicWorkstream ? { workstreamId } : {}),
          humanMessage: reason,
          resourceScope,
          relatedClaimIds: [],
          evidenceRefs: publicWorkstream ? [`workstream:${workstreamId}`] : [],
          requestedActions: ["request_coordination"],
          createdAt: now.toISOString(),
        },
      },
    },
  );
  return response.result;
}

async function requestSpecReview(
  runtime: LocalRepresentativeRuntime,
  params: Record<string, unknown>,
  requestId: string,
): Promise<unknown> {
  const workstreamId = requiredString(params, "workstreamId") as WorkstreamId;
  const title = requiredString(params, "title");
  const markdown = requiredString(params, "markdown");
  const affectedScopes = stringArrayParam(params, "affectedScopes");
  const representativeId = localRepresentativeId();
  const publicWorkstream = await isPublicWorkstream(workstreamId);
  const threadId = requestId as ConversationThread["id"];
  await apiRequest("/v1/threads", {
    method: "POST",
    body: {
      id: threadId,
      kind: "spec_review",
      title: `Review: ${title}`.slice(0, 200),
      participantIds: [runtime.principalId],
      representativeIds: [representativeId],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      createdAt: new Date().toISOString(),
    },
  });
  const specId = requestId as Spec["id"];
  const created = await apiRequest<{
    spec: Spec;
    revision: { id: string; revision: number; blocks: unknown[] };
  }>("/v1/specs", {
    method: "POST",
    body: {
      id: specId,
      title,
      reviewThreadId: threadId,
      relatedWorkstreamIds: publicWorkstream ? [workstreamId] : [],
      status: "in_review",
      markdown,
      changeSummary:
        "Review requested by a Coding Agent through its Representative.",
      affectedScopes,
      createdBy: runtime.principalId,
    },
  });
  return {
    specId: created.spec.id,
    revisionId: created.revision.id,
    revision: created.revision.revision,
    reviewThreadId: threadId,
    affectedBlockCount: created.revision.blocks.length,
    status: created.spec.status,
  };
}

async function synchronizeProjection(
  projection: PublicWorkProjection,
): Promise<void> {
  if (!process.env.INTERO_API_URL) return;
  await apiRequest("/v1/projections", {
    method: "POST",
    body: { projection },
  });
}

async function isPublicWorkstream(
  workstreamId: WorkstreamId,
): Promise<boolean> {
  const response = await apiRequest<{ projections: PublicWorkProjection[] }>(
    "/v1/team-pulse",
  );
  return response.projections.some(
    (projection) => projection.id === workstreamId,
  );
}

async function apiRequest<T = unknown>(
  path: string,
  options?: { method: "POST"; body: unknown },
): Promise<T> {
  const apiUrl = process.env.INTERO_API_URL;
  if (!apiUrl)
    throw new Error(
      "INTERO_API_URL is required for this Representative request.",
    );
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
    method: options?.method ?? "GET",
    ...(options
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(options.body),
        }
      : {}),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Intero API ${path} failed with ${response.status}: ${detail.slice(0, 500)}`,
    );
  }
  return (await response.json()) as T;
}

function stringParam(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof input[key] === "string" ? input[key] : undefined;
}

function recordParam(
  input: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = input[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = stringParam(input, key);
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function stringArrayParam(
  input: Record<string, unknown>,
  key: string,
): string[] {
  const value = input[key];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`${key} must be an array of strings.`);
  }
  return value;
}

function organizationId(): CapabilityGrant["organizationId"] {
  return (process.env.INTERO_ORGANIZATION_ID ??
    "019b5ac0-7600-7000-8000-000000000001") as CapabilityGrant["organizationId"];
}

function localRepresentativeId(): PrincipalId {
  return (process.env.INTERO_LOCAL_REPRESENTATIVE_ID ??
    "019b5ac0-7600-7000-8000-000000000003") as PrincipalId;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
