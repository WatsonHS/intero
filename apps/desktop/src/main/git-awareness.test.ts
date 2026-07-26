import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildGitAwarenessCheckpoint,
  readGitAwarenessSnapshot,
  watchGitMetadata,
  type GitMetadataSubscription,
} from "./git-awareness.js";

const execFileAsync = promisify(execFile);
const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("desktop Git awareness", () => {
  it("returns only bounded repository metadata", async () => {
    const repository = await createRepository();
    const snapshot = await readGitAwarenessSnapshot(repository);

    expect(snapshot).toMatchObject({
      repository: expect.stringMatching(/^intero-git-awareness-/),
      branch: "main",
      staged: "clean",
    });
    expect(snapshot?.head).toMatch(/^[0-9a-f]{12}$/);
    expect(snapshot).not.toHaveProperty("files");
    expect(snapshot).not.toHaveProperty("diff");
    expect(JSON.stringify(snapshot)).not.toContain(repository);
  });

  it("reacts to Git metadata changes without watching ordinary file writes", async () => {
    const repository = await createRepository();
    let changes = 0;
    let subscription: GitMetadataSubscription | undefined;
    try {
      subscription = await watchGitMetadata({
        repositoryPath: repository,
        debounceMs: 80,
        onChange: () => {
          changes += 1;
        },
      });
      await writeFile(join(repository, "work.txt"), "changed\n");
      await new Promise((resolve) => setTimeout(resolve, 220));
      expect(changes).toBe(0);

      await git(repository, ["add", "work.txt"]);
      await vi.waitFor(() => expect(changes).toBe(1), { timeout: 2_000 });
      expect((await readGitAwarenessSnapshot(repository))?.staged).toBe(
        "changed",
      );
    } finally {
      subscription?.close();
    }
  });

  it("builds a stable content-safe direct-cloud checkpoint", () => {
    const repositoryPath = "/private/work/customer-secret";
    const snapshot = {
      repository: "customer-secret",
      branch: "feature/checkout",
      head: "abcdef123456",
      staged: "changed" as const,
      fingerprint: "feature/checkout\nabcdef123456\nchanged",
    };
    const checkpoint = buildGitAwarenessCheckpoint(repositoryPath, snapshot, {
      ...snapshot,
      head: "123456abcdef",
      fingerprint: "feature/checkout\n123456abcdef\nchanged",
    });

    expect(checkpoint).toMatchObject({
      eventType: "artifact_produced",
      workstreamTitle: "Git · customer-secret",
      completedOutcome: "当前提交已更新为 abcdef123456。",
    });
    expect(JSON.stringify(checkpoint)).not.toContain(repositoryPath);
    expect(checkpoint.clientEventId).toMatch(/^desktop-git:[0-9a-f]{32}$/);
    expect(checkpoint.workstreamKey).toMatch(/^desktop-git-[0-9a-f]{20}$/);
  });
});

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "intero-git-awareness-"));
  cleanupPaths.push(repository);
  await git(repository, ["init", "--initial-branch=main"]);
  await git(repository, [
    "config",
    "user.email",
    "intero-test@example.invalid",
  ]);
  await git(repository, ["config", "user.name", "Intero Test"]);
  await writeFile(join(repository, "work.txt"), "initial\n");
  await git(repository, ["add", "work.txt"]);
  await git(repository, ["commit", "-m", "initial"]);
  return repository;
}

async function git(repository: string, args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", repository, ...args], {
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
}
