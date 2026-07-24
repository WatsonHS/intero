import { containsForbiddenEventField } from "@intero/domain";

import type { DaemonClient } from "./daemon-client.js";

const DEFAULT_MAX_BYTES = 64 * 1024;
const SPEC_REVIEW_MAX_BYTES = 512 * 1024;

export interface ToolHandlers {
  currentContext(): Promise<unknown>;
  lookupTeamContext(input: {
    workspaceId?: string;
    query: string;
    scope?: string[] | undefined;
  }): Promise<unknown>;
  requestCoordination(input: {
    workspaceId?: string;
    workstreamId?: string;
    reason: string;
    resourceScope: string[];
  }): Promise<unknown>;
  requestSpecReview(input: {
    workspaceId?: string;
    workstreamId?: string;
    title: string;
    markdown: string;
    affectedScopes: string[];
  }): Promise<unknown>;
  lookupDecision(input: {
    workspaceId?: string;
    query: string;
  }): Promise<unknown>;
  checkScope(input: {
    workspaceId?: string;
    workstreamId?: string;
    resourceScope: string[];
  }): Promise<unknown>;
  reportCheckpoint(input: {
    workspaceId?: string;
    workstreamId?: string;
    kind: string;
    summary: string;
    evidenceRefs?: string[] | undefined;
  }): Promise<unknown>;
}

export interface McpBinding {
  source: "codex" | "claude-code" | "opencode";
  cwd: string;
  clientSessionId: string;
}

export function createToolHandlers(
  daemon: DaemonClient,
  binding?: McpBinding,
): ToolHandlers {
  const context = async () => {
    if (!binding) return undefined;
    return (await daemon.call("integration.current_context", {
      source: binding.source,
      cwd: binding.cwd,
      clientSessionId: binding.clientSessionId,
    })) as {
      workspaceId: string;
      workstreamId: string;
      source: McpBinding["source"];
      sessionId: string;
    };
  };
  const bound = async (
    input: Record<string, unknown>,
    includeWorkstream = true,
  ) => {
    const resolved = await context();
    if (!resolved) return input;
    return {
      ...input,
      workspaceId: resolved.workspaceId,
      ...(includeWorkstream ? { workstreamId: resolved.workstreamId } : {}),
    };
  };
  return {
    currentContext: async () => {
      const resolved = await context();
      if (!resolved) {
        throw new Error(
          "This MCP server was not started with an Agent binding.",
        );
      }
      return resolved;
    },
    lookupTeamContext: (input) =>
      bound(bounded(input), false).then((params) =>
        invokeAndAwait(daemon, "representative.lookup_team_context", params),
      ),
    requestCoordination: (input) =>
      bound(bounded(input)).then((params) =>
        invokeAndAwait(daemon, "representative.request_coordination", params),
      ),
    requestSpecReview: (input) =>
      bound(bounded(input, SPEC_REVIEW_MAX_BYTES)).then((params) =>
        invokeAndAwait(daemon, "representative.request_spec_review", params),
      ),
    lookupDecision: (input) =>
      bound(bounded(input), false).then((params) =>
        invokeAndAwait(daemon, "representative.lookup_decision", params),
      ),
    checkScope: (input) =>
      bound(bounded(input)).then((params) =>
        invokeAndAwait(daemon, "representative.check_scope", params),
      ),
    reportCheckpoint: (input) =>
      bound(bounded(input)).then((params) =>
        invokeAndAwait(daemon, "representative.report_checkpoint", params),
      ),
  };
}

async function invokeAndAwait(
  daemon: DaemonClient,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const accepted = await daemon.call(method, params);
  if (!isQueuedResult(accepted)) return accepted;
  const deadline =
    Date.now() + Number(process.env.INTERO_MCP_RESULT_TIMEOUT_MS ?? 20_000);
  while (Date.now() < deadline) {
    const state = await daemon.call("representative.request_result", {
      requestId: accepted.requestId,
      ...(typeof params.workspaceId === "string"
        ? { workspaceId: params.workspaceId }
        : {}),
    });
    if (
      state &&
      typeof state === "object" &&
      (state as Record<string, unknown>).status === "completed"
    ) {
      return (state as Record<string, unknown>).result;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Representative request ${accepted.requestId} did not complete within the MCP timeout.`,
  );
}

function isQueuedResult(value: unknown): value is { requestId: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).requestId === "string" &&
    (value as Record<string, unknown>).queued === true
  );
}

function bounded<T extends Record<string, unknown>>(
  input: T,
  maxBytes = DEFAULT_MAX_BYTES,
): T {
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new Error(
      `MCP tool input exceeds the ${maxBytes / 1024} KiB semantic payload limit.`,
    );
  }
  if (containsForbiddenEventField(input)) {
    throw new Error("MCP tool input contains a forbidden raw-content field.");
  }
  return input;
}
