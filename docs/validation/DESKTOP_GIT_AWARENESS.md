# Desktop Git-awareness validation

Date: 2026-07-26

Scope: optional Desktop enhancement only. The Web product and direct-cloud MCP
remain complete without the Desktop App.

## Automated checks

```bash
pnpm vitest run \
  apps/desktop/src/main/git-awareness.test.ts \
  apps/web/src/views/settings/GitAwarenessSettings.test.tsx

pnpm lint
pnpm --filter @intero/mcp-stdio build
pnpm --filter @intero/web build
pnpm --filter @intero/desktop build
```

The focused tests prove:

- bounded snapshot output contains repository name, branch, short commit, and
  staged-state only;
- absolute repository path, file names, and diff content are absent from the
  checkpoint;
- an ordinary working-tree write causes no callback;
- staging causes one debounced metadata callback;
- stable event and Workstream IDs do not expose the local path;
- browser rendering explains that repository access is Desktop-only.

## Actual Desktop smoke

The canonical Web application was launched inside Electron with an isolated
direct-cloud Codex binding and a disposable Git repository. The Desktop-only
preload bridge was present.

Observed sequence:

1. **Settings → Coding Agent → 桌面 Git 感知** showed explicit repository
   selection, Agent binding, enable/pause, and remove controls.
2. The trusted Desktop bridge configured the disposable repository against the
   isolated Codex binding. The renderer showed `main`, the 12-character commit,
   and clean staged state.
3. Writing an untracked working-tree file and waiting beyond the debounce
   window produced zero `desktop-git:*` idempotency rows.
4. Staging that file produced exactly one direct-cloud checkpoint:
   `desktop-git:e8a538e7b3df06c4978b6fa9e9b770a7`.
5. Persisted private Work State contained the structured Chinese narrative and
   repository/branch/commit/staged evidence. A database safety check found
   neither the absolute temporary path nor the test file name.
6. Reopening the category showed `暂存区：有变化` and the delivery time.
7. Pausing through the visible control, then committing, kept the checkpoint
   count at one.
8. The repository authorization was removed through the visible control, the
   test Agent binding was disconnected, temporary local directories were
   deleted, Electron exited, and no Electron/watcher process remained.

Evidence:

- `output/playwright/desktop-git-awareness/01-settings-git-awareness.png`
- `output/playwright/desktop-git-awareness/02-git-event-delivered.png`

## Exact boundary

The macOS native directory chooser itself was not driven by browser automation;
the smoke verified its visible button and exercised the same trusted
`configureGitAwareness` IPC boundary with a known disposable repository. The
main process validates an absolute readable Git repository and a real local
direct-cloud Agent connection before enabling it.

This smoke proves ingestion into private Work State, content minimization,
non-triggering ordinary edits, one metadata-triggered delivery, pause, cleanup,
and process shutdown. It does not by itself prove real-provider Stand-in
summarization or cross-user Team Pulse/Coordination behavior; those belong to
the separate Agent collaboration evaluation.
