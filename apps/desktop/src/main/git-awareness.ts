import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { access } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 1_500;
const GIT_OUTPUT_LIMIT = 16 * 1024;

export interface GitAwarenessSnapshot {
  repository: string;
  branch?: string;
  head?: string;
  staged: "clean" | "changed";
  fingerprint: string;
}

export interface GitMetadataSubscription {
  close(): void;
}

export interface GitAwarenessCheckpoint {
  eventType: "artifact_produced" | "work_progressed";
  clientEventId: string;
  workstreamKey: string;
  workstreamTitle: string;
  currentFocus: string;
  completedOutcome: string;
  nextStep: string;
  evidence: string[];
}

interface GitMetadataTarget {
  directory: string;
  names: ReadonlySet<string>;
}

/**
 * Read only the bounded repository facts Intero is allowed to publish.
 *
 * This deliberately avoids `git status`, file names, diffs, working-tree
 * contents, and absolute paths. The staged check only observes git's exit
 * status and never captures diff output.
 */
export async function readGitAwarenessSnapshot(
  repositoryPath: string,
): Promise<GitAwarenessSnapshot | undefined> {
  try {
    const [root, branch, head, staged] = await Promise.all([
      gitValue(repositoryPath, ["rev-parse", "--show-toplevel"]),
      gitOptionalValue(repositoryPath, [
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ]),
      gitOptionalValue(repositoryPath, [
        "rev-parse",
        "--verify",
        "--short=12",
        "HEAD",
      ]),
      readStagedState(repositoryPath),
    ]);
    if (!root) return undefined;
    const fingerprint = `${branch ?? ""}\n${head ?? ""}\n${staged}`;
    return {
      repository: basename(root).slice(0, 160) || "repository",
      ...(branch ? { branch: branch.slice(0, 160) } : {}),
      ...(head ? { head: head.slice(0, 64) } : {}),
      staged,
      fingerprint,
    };
  } catch {
    return undefined;
  }
}

/**
 * Watch Git metadata rather than polling the worktree. A burst of HEAD/index/
 * ref events results in one debounced snapshot callback, after which the
 * watched ref is rebound in case the active branch changed.
 */
export async function watchGitMetadata(input: {
  repositoryPath: string;
  onChange: () => Promise<void> | void;
  debounceMs?: number;
}): Promise<GitMetadataSubscription> {
  const debounceMs = input.debounceMs ?? 450;
  let closed = false;
  let timer: NodeJS.Timeout | undefined;
  let watchers: FSWatcher[] = [];

  const closeWatchers = () => {
    for (const watcher of watchers) watcher.close();
    watchers = [];
  };

  const bind = async () => {
    closeWatchers();
    if (closed) return;
    const targets = await resolveGitMetadataTargets(input.repositoryPath);
    for (const target of targets) {
      try {
        await access(target.directory);
        const watcher = watch(
          target.directory,
          { persistent: false },
          (_eventType, fileName) => {
            if (fileName !== null && !target.names.has(fileName.toString())) {
              return;
            }
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = undefined;
              if (closed) return;
              void (async () => {
                try {
                  await input.onChange();
                } finally {
                  if (!closed) await bind().catch(() => undefined);
                }
              })().catch(() => undefined);
            }, debounceMs);
          },
        );
        watcher.on("error", () => {
          watcher.close();
        });
        watchers.push(watcher);
      } catch {
        // A packed ref may not have an unpacked directory yet. HEAD and index
        // remain watched, and the next relevant event will rebind the targets.
      }
    }
  };

  await bind();
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      closeWatchers();
    },
  };
}

export function buildGitAwarenessCheckpoint(
  repositoryPath: string,
  snapshot: GitAwarenessSnapshot,
  previous?: GitAwarenessSnapshot,
): GitAwarenessCheckpoint {
  const headChanged = snapshot.head !== previous?.head;
  const branchChanged = snapshot.branch !== previous?.branch;
  const stagedChanged = snapshot.staged !== previous?.staged;
  const eventId = createHash("sha256")
    .update(`${repositoryPath}:${snapshot.fingerprint}`)
    .digest("hex")
    .slice(0, 32);
  const workstreamId = createHash("sha256")
    .update(repositoryPath)
    .digest("hex")
    .slice(0, 20);
  return {
    eventType: headChanged ? "artifact_produced" : "work_progressed",
    clientEventId: `desktop-git:${eventId}`,
    workstreamKey: `desktop-git-${workstreamId}`,
    workstreamTitle: `Git · ${snapshot.repository}`,
    currentFocus: `桌面端在已授权仓库 ${snapshot.repository} 中检测到 Git 元数据变化。`,
    completedOutcome:
      headChanged && snapshot.head
        ? `当前提交已更新为 ${snapshot.head}。`
        : branchChanged && snapshot.branch
          ? `当前分支已切换为 ${snapshot.branch}。`
          : stagedChanged && snapshot.staged === "changed"
            ? "暂存区已有待提交变更。"
            : "暂存区已清空。",
    nextStep: "由 Coding Agent 在有意义的工作节点补充语义进展。",
    evidence: [
      `仓库：${snapshot.repository}`,
      ...(snapshot.branch ? [`分支：${snapshot.branch}`] : []),
      ...(snapshot.head ? [`提交：${snapshot.head}`] : []),
      `暂存区：${snapshot.staged === "clean" ? "无待提交变更" : "有待提交变更"}`,
    ],
  };
}

async function resolveGitMetadataTargets(
  repositoryPath: string,
): Promise<GitMetadataTarget[]> {
  const [gitDirectoryValue, commonDirectoryValue, symbolicRef] =
    await Promise.all([
      gitValue(repositoryPath, ["rev-parse", "--absolute-git-dir"]),
      gitValue(repositoryPath, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]),
      gitOptionalValue(repositoryPath, ["symbolic-ref", "--quiet", "HEAD"]),
    ]);
  const gitDirectory = resolveGitPath(repositoryPath, gitDirectoryValue);
  const commonDirectory = resolveGitPath(repositoryPath, commonDirectoryValue);
  const targets = new Map<string, Set<string>>();
  addTarget(targets, gitDirectory, [
    "HEAD",
    "index",
    "index.lock",
    "packed-refs",
  ]);
  addTarget(targets, commonDirectory, ["packed-refs"]);
  if (symbolicRef) {
    const refPath = resolve(commonDirectory, symbolicRef);
    addTarget(targets, dirname(refPath), [basename(refPath)]);
  }
  return Array.from(targets, ([directory, names]) => ({ directory, names }));
}

function addTarget(
  targets: Map<string, Set<string>>,
  directory: string,
  names: string[],
) {
  const current = targets.get(directory) ?? new Set<string>();
  for (const name of names) current.add(name);
  targets.set(directory, current);
}

function resolveGitPath(repositoryPath: string, value: string): string {
  return isAbsolute(value) ? value : resolve(repositoryPath, value);
}

async function readStagedState(
  repositoryPath: string,
): Promise<GitAwarenessSnapshot["staged"]> {
  try {
    await gitValue(repositoryPath, [
      "diff",
      "--cached",
      "--quiet",
      "--exit-code",
      "--",
    ]);
    return "clean";
  } catch (error) {
    if (gitExitCode(error) === 1) return "changed";
    // An unborn HEAD has no baseline. If the index itself exists, treating it
    // as changed is the bounded and useful state without enumerating paths.
    const gitDirectory = await gitValue(repositoryPath, [
      "rev-parse",
      "--absolute-git-dir",
    ]);
    try {
      await access(resolve(gitDirectory, "index"));
      return "changed";
    } catch {
      return "clean";
    }
  }
}

async function gitValue(
  repositoryPath: string,
  args: string[],
): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repositoryPath, ...args],
    {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_OUTPUT_LIMIT,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    },
  );
  return stdout.trim();
}

async function gitOptionalValue(
  repositoryPath: string,
  args: string[],
): Promise<string | undefined> {
  try {
    const value = await gitValue(repositoryPath, args);
    return value || undefined;
  } catch {
    return undefined;
  }
}

function gitExitCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "number" ? error.code : undefined;
}
