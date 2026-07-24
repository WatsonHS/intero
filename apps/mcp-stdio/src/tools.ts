import { containsForbiddenEventField } from "@intero/domain";

import type { DaemonClient } from "./daemon-client.js";

const DEFAULT_MAX_BYTES = 64 * 1024;
const SPEC_REVIEW_MAX_BYTES = 512 * 1024;

export interface ToolHandlers {
  lookupTeamContext(input: {
    workspaceId: string;
    query: string;
    scope?: string[] | undefined;
  }): Promise<unknown>;
  requestCoordination(input: {
    workspaceId: string;
    workstreamId: string;
    reason: string;
    resourceScope: string[];
  }): Promise<unknown>;
  requestSpecReview(input: {
    workspaceId: string;
    workstreamId: string;
    title: string;
    markdown: string;
    affectedScopes: string[];
  }): Promise<unknown>;
  lookupDecision(input: {
    workspaceId: string;
    query: string;
  }): Promise<unknown>;
  checkScope(input: {
    workspaceId: string;
    workstreamId: string;
    resourceScope: string[];
  }): Promise<unknown>;
  reportCheckpoint(input: {
    workspaceId: string;
    workstreamId: string;
    kind: string;
    summary: string;
    evidenceRefs?: string[] | undefined;
  }): Promise<unknown>;
}

export function createToolHandlers(daemon: DaemonClient): ToolHandlers {
  return {
    lookupTeamContext: (input) =>
      invokeAndAwait(
        daemon,
        "representative.lookup_team_context",
        bounded(input),
      ),
    requestCoordination: (input) =>
      invokeAndAwait(
        daemon,
        "representative.request_coordination",
        bounded(input),
      ),
    requestSpecReview: (input) =>
      invokeAndAwait(
        daemon,
        "representative.request_spec_review",
        bounded(input, SPEC_REVIEW_MAX_BYTES),
      ),
    lookupDecision: (input) =>
      invokeAndAwait(daemon, "representative.lookup_decision", bounded(input)),
    checkScope: (input) =>
      invokeAndAwait(daemon, "representative.check_scope", bounded(input)),
    reportCheckpoint: (input) =>
      invokeAndAwait(
        daemon,
        "representative.report_checkpoint",
        bounded(input),
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
