import { SocketDaemonClient, loadConnectionSettings } from "@intero/local-ipc";

const MAX_HOOK_BYTES = 2 * 1024 * 1024;

export async function runHook(
  source: "codex" | "claude-code" | "opencode",
): Promise<void> {
  try {
    const input = await readHookInput();
    const eventName =
      stringField(input, "hook_event_name") ?? stringField(input, "event_name");
    const cwd = stringField(input, "cwd");
    const sessionId =
      stringField(input, "session_id") ??
      stringField(input, "conversation_id") ??
      stringField(input, "transcript_id");
    if (!eventName || !cwd || !sessionId) return;

    const connection = await loadConnectionSettings();
    const daemon = new SocketDaemonClient(
      connection.socketPath,
      connection.authToken,
    );
    const context = (await daemon.call("integration.resolve_context", {
      cwd,
      source,
      sessionId,
    })) as { workspaceId: string; workstreamId: string };
    await daemon.call("representative.ingest_adapter_event", {
      ...context,
      source,
      sourceEvent: eventName,
      occurredAt: new Date().toISOString(),
      metadata: safeSemanticMetadata(
        eventName,
        stringField(input, "tool_name"),
      ),
    });
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        level: "warn",
        operation: "integration.hook",
        source,
        error: error instanceof Error ? error.message : "hook_failed",
      })}\n`,
    );
  } finally {
    process.stdout.write("{}\n");
  }
}

async function readHookInput(): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_HOOK_BYTES)
      throw new Error("Hook input exceeds the 2 MiB limit.");
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Hook input must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function stringField(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof input[key] === "string" ? input[key] : undefined;
}

export function safeSemanticMetadata(
  eventName: string,
  toolName?: string,
): Record<string, string> {
  const metadata: Record<string, string> = {
    phase: eventName.slice(0, 80),
  };
  if (eventName === "SessionStart" || eventName === "session.created") {
    metadata.checkpointKind = "intent";
    metadata.summary = "Coding Agent session started in an enrolled Workspace.";
  } else if (eventName === "session.idle") {
    metadata.checkpointKind = "pause";
    metadata.summary = "Coding Agent session is idle.";
  } else if (eventName === "PostToolUseFailure") {
    metadata.checkpointKind = "validation";
    metadata.summary = "A Coding Agent tool reported a failure.";
    metadata.validationStatus = "failed";
  }
  if (toolName) metadata.resourceKind = resourceKindForTool(toolName);
  return metadata;
}

function resourceKindForTool(toolName: string) {
  const normalized = toolName.toLowerCase();
  if (
    normalized.includes("file") ||
    normalized.includes("write") ||
    normalized.includes("edit")
  ) {
    return "file" as const;
  }
  if (normalized.includes("test") || normalized.includes("lint"))
    return "artifact" as const;
  return "symbol" as const;
}
