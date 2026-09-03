import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

import { CloudPilotClient } from "./cloud-client.js";

const MAX_HOOK_BYTES = 64 * 1024;
const execFileAsync = promisify(execFile);

/**
 * Coding-Agent lifecycle hooks are an optional direct-cloud enhancement. They
 * deliberately have no local daemon, socket, allowlist file, or persistent
 * workspace database dependency.
 */
export async function runHook(
  source: "codex" | "claude-code" | "opencode",
): Promise<void> {
  if (!hookShouldCollect()) return;
  try {
    await handleHookEvent(source, await readHookInput());
  } catch {
    // Hooks remain fail-open and silent. They must not block an Agent, expose
    // local paths, or turn a transient cloud failure into a coding failure.
  }
}

export async function handleHookEvent(
  source: "codex" | "claude-code" | "opencode",
  input: Record<string, unknown>,
  options?: { configDirectory?: string },
): Promise<void> {
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

  const client = CloudPilotClient.load({
    client: source,
    cwd,
    ...(options?.configDirectory
      ? { configDirectory: options.configDirectory }
      : {}),
  });
  const git = await readGitContext(cwd, client.context().preferredLanguage);
  await client.reportLifecycle({
    clientEventId: hashedSessionClientEventId(sessionId),
    lifecycle: isTerminalLifecycleEvent(eventName)
      ? "session_ended"
      : "session_started",
    workstreamKey: git.repository,
    workstreamTitle: git.repository,
    ...(git.refs.length > 0 ? { evidenceRefs: git.refs } : {}),
  });
}

export function hashedSessionClientEventId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

export function hookShouldCollect(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.INTERO_INTEGRATION_PROBE !== "1";
}

async function readGitContext(
  cwd: string,
  preferredLanguage: "zh-CN" | "en-US",
): Promise<{
  repository: string;
  evidence: string[];
  refs: string[];
}> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "rev-parse", "--show-toplevel"],
      {
        timeout: 1_000,
        maxBuffer: 16 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      },
    );
    const root = stdout.trim();
    const [branch, head] = await Promise.all([
      git(cwd, ["branch", "--show-current"]),
      git(cwd, ["rev-parse", "--short=12", "HEAD"]),
    ]);
    const repository = basename(root).slice(0, 160) || "repository";
    const chinese = preferredLanguage === "zh-CN";
    const evidence = [
      `${chinese ? "仓库" : "Repository"}: ${repository}`,
      ...(branch ? [`${chinese ? "分支" : "Branch"}: ${branch}`] : []),
      ...(head ? [`${chinese ? "提交" : "Commit"}: ${head}`] : []),
    ];
    return {
      repository,
      evidence,
      refs: [
        ...(branch ? [`git:branch:${branch}`] : []),
        ...(head ? [`git:commit:${head}`] : []),
      ],
    };
  } catch {
    return { repository: "repository", evidence: [], refs: [] };
  }
}

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
      timeout: 1_000,
      maxBuffer: 16 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    const value = stdout.trim();
    return value ? value.slice(0, 160) : undefined;
  } catch {
    return undefined;
  }
}

async function readHookInput(): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_HOOK_BYTES) throw new Error("Hook input is too large.");
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

function isTerminalLifecycleEvent(eventName: string): boolean {
  return (
    eventName === "SessionEnd" ||
    eventName === "session.idle" ||
    eventName === "session.deleted"
  );
}

function isSupportedLifecycleEvent(
  source: "codex" | "claude-code" | "opencode",
  eventName: string,
): boolean {
  return source === "opencode"
    ? eventName === "session.created" ||
        eventName === "session.idle" ||
        eventName === "session.deleted"
    : eventName === "SessionStart" || eventName === "SessionEnd";
}
