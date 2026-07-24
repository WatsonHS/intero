import { SocketDaemonClient, loadConnectionSettings } from "@intero/local-ipc";
import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { promisify } from "node:util";

const MAX_HOOK_BYTES = 64 * 1024;
const execFileAsync = promisify(execFile);

export async function runHook(
  source: "codex" | "claude-code" | "opencode",
  connectionFile?: string,
): Promise<void> {
  if (!hookShouldCollect()) return;
  try {
    const input = await readHookInput();
    const eventName =
      stringField(input, "hook_event_name") ?? stringField(input, "event_name");
    const cwd = stringField(input, "cwd");
    const sessionId =
      stringField(input, "session_id") ??
      stringField(input, "conversation_id") ??
      stringField(input, "transcript_id");
    if (
      !eventName ||
      !cwd ||
      !sessionId ||
      !isSupportedLifecycleEvent(source, eventName) ||
      cwd.length > 4_096 ||
      sessionId.length > 240
    ) {
      return;
    }
    const eventId =
      stringField(input, "hook_event_id") ??
      stringField(input, "event_id") ??
      stringField(input, "tool_use_id");

    const connection = await loadConnectionSettings({
      role: "hook",
      ...(connectionFile ? { descriptorPath: connectionFile } : {}),
    });
    if (
      !connection.workspaceAllowlistPath ||
      !(await isAllowedWorkspace(cwd, connection.workspaceAllowlistPath))
    ) {
      return;
    }
    const daemon = new SocketDaemonClient(
      connection.socketPath,
      connection.authToken,
    );
    await daemon.call("integration.ingest_lifecycle", {
      cwd,
      source,
      sourceEvent: eventName,
      sessionId,
      ...(eventId && eventId.length <= 240 ? { eventId } : {}),
      occurredAt: new Date().toISOString(),
      metadata: safeSemanticMetadata(eventName),
    });
  } catch {
    // Hooks are deliberately fail-open and silent so Agent content and local
    // paths cannot leak through diagnostics.
  }
}

export function hookShouldCollect(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.INTERO_INTEGRATION_PROBE !== "1";
}

export async function isAllowedWorkspace(
  cwd: string,
  allowlistPath: string,
): Promise<boolean> {
  try {
    const raw = await readFile(allowlistPath, "utf8");
    if (Buffer.byteLength(raw) > 1024 * 1024) return false;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as Record<string, unknown>).schemaVersion !== 1 ||
      !Array.isArray((parsed as Record<string, unknown>).workspaces)
    ) {
      return false;
    }
    const canonicalCwd = await realpath(cwd);
    const entries = (parsed as { workspaces: unknown[] }).workspaces.filter(
      (value): value is { root: string; repositoryIdentity: string } =>
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof (value as Record<string, unknown>).root === "string" &&
        typeof (value as Record<string, unknown>).repositoryIdentity ===
          "string",
    );
    if (entries.some((entry) => pathIsInside(canonicalCwd, entry.root))) {
      return true;
    }
    const { stdout } = await execFileAsync(
      "git",
      [
        "-C",
        canonicalCwd,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ],
      {
        timeout: 1_000,
        maxBuffer: 16 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      },
    );
    const common = await realpath(stdout.trim());
    const identity = `git-common-dir:${common}`;
    return entries.some((entry) => entry.repositoryIdentity === identity);
  } catch {
    return false;
  }
}

function pathIsInside(candidate: string, root: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) &&
      fromRoot !== ".." &&
      !isAbsolute(fromRoot))
  );
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
): Record<string, string> {
  const metadata: Record<string, string> = {
    phase: eventName.slice(0, 80),
  };
  if (
    eventName === "SessionEnd" ||
    eventName === "session.idle" ||
    eventName === "session.deleted"
  ) {
    metadata.checkpointKind = "pause";
  }
  return metadata;
}

function isSupportedLifecycleEvent(
  source: "codex" | "claude-code" | "opencode",
  eventName: string,
) {
  return source === "opencode"
    ? eventName === "session.created" ||
        eventName === "session.idle" ||
        eventName === "session.deleted"
    : eventName === "SessionStart" || eventName === "SessionEnd";
}
