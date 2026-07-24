import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { claudeCodeAdapter, codexAdapter, openCodeAdapter } from "./index";
import {
  applyManagedInstall,
  diagnoseManagedInstall,
  uninstallManagedIntegration,
} from "./installer";

describe("managed integration installer", () => {
  it("preserves existing Codex config and restores it byte-for-byte", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-codex-"));
    await mkdir(join(home, ".codex"), { recursive: true });
    const configPath = join(home, ".codex", "config.toml");
    const original = 'model = "gpt-5"\n';
    await writeFile(configPath, original);
    const plan = codexAdapter.installPlan(home, "/opt/intero/mcp-stdio");

    await applyManagedInstall(plan, home);
    const installed = await readFile(configPath, "utf8");
    expect(installed).toContain('model = "gpt-5"');
    expect(installed).toContain("# >>> intero-managed");
    expect(
      (await diagnoseManagedInstall(plan, home)).every((item) => item.ok),
    ).toBe(true);

    await applyManagedInstall(plan, home);
    await uninstallManagedIntegration("codex", home);
    expect(await readFile(configPath, "utf8")).toBe(original);
  });

  it("merges OpenCode JSONC without dropping unrelated settings", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-opencode-"));
    const configDirectory = join(home, ".config", "opencode");
    await mkdir(configDirectory, { recursive: true });
    const configPath = join(configDirectory, "opencode.json");
    const original = '{\n  // keep this setting\n  "theme": "system"\n}\n';
    await writeFile(configPath, original);

    await applyManagedInstall(
      openCodeAdapter.installPlan(home, "/opt/intero/mcp-stdio"),
      home,
    );
    const installed = await readFile(configPath, "utf8");
    expect(installed).toContain('"theme": "system"');
    expect(installed).toContain('"intero"');

    await uninstallManagedIntegration("opencode", home);
    expect(await readFile(configPath, "utf8")).toBe(original);
  });

  it("rejects managed paths that escape through a symlink", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-home-"));
    const outside = await mkdtemp(join(tmpdir(), "intero-outside-"));
    await symlink(outside, join(home, ".codex"), "dir");

    await expect(
      applyManagedInstall(
        codexAdapter.installPlan(home, "/opt/intero/mcp-stdio"),
        home,
      ),
    ).rejects.toThrow("symlink outside");
  });

  it("never copies credentials from an existing Agent config into Intero state", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-credential-canary-"));
    const canary = "sk-private-canary-12345678901234567890";
    await writeFile(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          privateServer: {
            command: "private",
            env: { API_KEY: canary },
          },
        },
      }),
    );

    await applyManagedInstall(
      claudeCodeAdapter.installPlan(home, "/opt/intero/mcp-stdio"),
      home,
    );

    const state = await allFileContents(join(home, ".intero"));
    expect(state).not.toContain(canary);
    expect(await readFile(join(home, ".claude.json"), "utf8")).toContain(
      canary,
    );
  });

  it("refuses to overwrite a user change to an Intero-owned node", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-conflict-"));
    const plan = codexAdapter.installPlan(home, "/opt/intero/mcp-stdio");
    await applyManagedInstall(plan, home);
    const hooksPath = join(home, ".codex", "hooks.json");
    const changed = (await readFile(hooksPath, "utf8")).replaceAll(
      "/opt/intero/mcp-stdio",
      "/user/changed/intero",
    );
    await writeFile(hooksPath, changed);

    await expect(applyManagedInstall(plan, home)).rejects.toThrow(
      "refusing to overwrite user edits",
    );
    await expect(uninstallManagedIntegration("codex", home)).rejects.toThrow(
      "refusing to overwrite user edits",
    );
    expect(await readFile(hooksPath, "utf8")).toContain("/user/changed/intero");
  });

  it("repairs files missing after an interrupted installing journal", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-repair-journal-"));
    const plan = codexAdapter.installPlan(home, "/opt/intero/mcp-stdio");
    await applyManagedInstall(plan, home);
    await unlink(join(home, ".codex", "AGENTS.md"));
    const manifestPath = join(home, ".intero", "integrations", "codex.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.status = "installing";
    await writeFile(manifestPath, JSON.stringify(manifest));

    await applyManagedInstall(plan, home);

    expect(
      (await diagnoseManagedInstall(plan, home)).every((item) => item.ok),
    ).toBe(true);
    expect(JSON.parse(await readFile(manifestPath, "utf8")).status).toBe(
      "installed",
    );
  });

  it("fails closed when a legacy manifest lacks immutable executable evidence", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-legacy-manifest-"));
    const target = join(home, ".codex", "config.toml");
    const stateDirectory = join(home, ".intero", "integrations");
    const backup = join(stateDirectory, "codex-0.backup");
    const hooks = join(home, ".codex", "hooks.json");
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(backup, 'model = "gpt-5"\n');
    await writeFile(
      target,
      'model = "gpt-5"\n\n# >>> intero-managed\n[mcp_servers.intero]\ncommand = "old"\nrequired = false\n# <<< intero-managed\n\nuser_added_after_install = true\n',
    );
    await writeFile(
      hooks,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: "'old' --hook-source codex",
                  timeout: 10,
                },
              ],
            },
          ],
        },
      }),
    );
    await writeFile(
      join(stateDirectory, "codex.json"),
      JSON.stringify({
        adapter: "codex",
        entries: [
          { target, backup, created: false },
          { target: hooks, created: true },
        ],
        installedAt: "2026-07-24T00:00:00.000Z",
      }),
    );
    const fullPlan = codexAdapter.installPlan(home, "/opt/intero/mcp-stdio");
    const plan = {
      ...fullPlan,
      files: fullPlan.files.filter((file) => file.path === target),
    };

    await expect(applyManagedInstall(plan, home)).rejects.toThrow(
      "Legacy Intero TOML block was edited",
    );

    const next = await readFile(target, "utf8");
    expect(next).toContain('model = "gpt-5"');
    expect(next).toContain("user_added_after_install = true");
    expect(next).toContain('command = "old"');
    await expect(stat(backup)).resolves.toBeDefined();
  });

  it("recovers an interrupted executable upgrade from old or new target values", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-upgrade-journal-"));
    const oldPlan = codexAdapter.installPlan(home, "/opt/intero/old");
    const newPlan = codexAdapter.installPlan(home, "/opt/intero/new");
    await applyManagedInstall(oldPlan, home);
    const configPath = join(home, ".codex", "config.toml");
    const oldConfig = await readFile(configPath, "utf8");
    const manifestPath = join(home, ".intero", "integrations", "codex.json");
    const oldManifest = JSON.parse(await readFile(manifestPath, "utf8"));

    await applyManagedInstall(newPlan, home);
    const newManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    newManifest.status = "installing";
    newManifest.beforeEntries = oldManifest.entries;
    newManifest.retiredEntries = [];
    await writeFile(manifestPath, JSON.stringify(newManifest));
    await writeFile(configPath, oldConfig);

    await applyManagedInstall(newPlan, home);

    expect(await readFile(configPath, "utf8")).toContain(
      'command = "/opt/intero/new"',
    );
    expect(JSON.parse(await readFile(manifestPath, "utf8")).status).toBe(
      "installed",
    );
  });

  it("does not retire a target that reappears in a recovered plan", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-retired-reappears-"));
    const plan = codexAdapter.installPlan(home, "/opt/intero/mcp-stdio");
    await applyManagedInstall(plan, home);
    const manifestPath = join(home, ".intero", "integrations", "codex.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.status = "installing";
    manifest.beforeEntries = manifest.entries;
    manifest.retiredEntries = manifest.entries;
    await writeFile(manifestPath, JSON.stringify(manifest));

    await applyManagedInstall(plan, home);

    expect(
      (await diagnoseManagedInstall(plan, home)).every((item) => item.ok),
    ).toBe(true);
  });

  it("reclaims a lock whose owner process no longer exists", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-stale-lock-"));
    const plan = codexAdapter.installPlan(home, "/opt/intero/mcp-stdio");
    const stateDirectory = join(home, ".intero", "integrations");
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(
      join(stateDirectory, "codex.lock"),
      JSON.stringify({
        pid: 2_147_483_647,
        startedAt: "2026-07-24T00:00:00.000Z",
      }),
    );

    await expect(applyManagedInstall(plan, home)).resolves.toMatchObject({
      status: "installed",
    });
  });

  it("reclaims an orphaned lock after its PID has been reused", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-reused-pid-lock-"));
    const plan = codexAdapter.installPlan(home, "/opt/intero/mcp-stdio");
    const stateDirectory = join(home, ".intero", "integrations");
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(
      join(stateDirectory, "codex.lock"),
      JSON.stringify({
        pid: process.pid,
        processStartIdentity: "a-different-process-start",
        startedAt: new Date().toISOString(),
      }),
    );

    await expect(applyManagedInstall(plan, home)).resolves.toMatchObject({
      status: "installed",
    });
  });

  it("supports an explicitly configured Agent root outside the user home", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-custom-home-"));
    const claudeRoot = await mkdtemp(join(tmpdir(), "intero-claude-root-"));
    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeRoot;
    try {
      const plan = claudeCodeAdapter.installPlan(home, "/opt/intero/mcp-stdio");
      await applyManagedInstall(plan, home);
      expect(
        await readFile(join(claudeRoot, ".claude.json"), "utf8"),
      ).toContain('"intero"');
      expect(
        await readFile(join(claudeRoot, "rules", "intero.md"), "utf8"),
      ).toContain("Intero coordination");
      await uninstallManagedIntegration("claude-code", home);
      await expect(
        stat(join(claudeRoot, "rules", "intero.md")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    }
  });

  it("retires a previous external Agent root when the configured root changes", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-root-move-home-"));
    const firstRoot = await mkdtemp(join(tmpdir(), "intero-root-move-a-"));
    const secondRoot = await mkdtemp(join(tmpdir(), "intero-root-move-b-"));
    const previous = process.env.CLAUDE_CONFIG_DIR;
    try {
      process.env.CLAUDE_CONFIG_DIR = firstRoot;
      await applyManagedInstall(
        claudeCodeAdapter.installPlan(home, "/opt/intero/mcp-stdio"),
        home,
      );
      process.env.CLAUDE_CONFIG_DIR = secondRoot;
      await applyManagedInstall(
        claudeCodeAdapter.installPlan(home, "/opt/intero/mcp-stdio"),
        home,
      );
      await expect(
        stat(join(firstRoot, "rules", "intero.md")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        await readFile(join(secondRoot, "rules", "intero.md"), "utf8"),
      ).toContain("Intero coordination");
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    }
  });

  it("preserves an edited legacy dedicated file and fails closed", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-legacy-edited-"));
    const target = join(home, ".codex", "intero.md");
    const stateDirectory = join(home, ".intero", "integrations");
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(stateDirectory, { recursive: true });
    const edited =
      "# Intero coordination\n\nUse Intero.\n\nMy private custom instruction.\n";
    await writeFile(target, edited);
    await writeFile(
      join(stateDirectory, "codex.json"),
      JSON.stringify({
        adapter: "codex",
        entries: [{ target, created: true }],
        installedAt: "2026-07-24T00:00:00.000Z",
      }),
    );

    await expect(
      applyManagedInstall(
        codexAdapter.installPlan(home, "/opt/intero/mcp-stdio"),
        home,
      ),
    ).rejects.toThrow("edited");
    expect(await readFile(target, "utf8")).toBe(edited);
  });

  it("resumes a legacy migration after the target was cleaned", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-legacy-resume-"));
    const target = join(home, ".codex", "config.toml");
    const stateDirectory = join(home, ".intero", "integrations");
    const backup = join(stateDirectory, "codex-0.backup");
    const baseline = 'model = "gpt-5"\n';
    const installed =
      `${baseline}\n# >>> intero-managed\n[mcp_servers.intero]\n` +
      'command = "old"\n# <<< intero-managed\n';
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(target, baseline);
    await writeFile(backup, baseline);
    await writeFile(
      join(stateDirectory, "codex.json"),
      JSON.stringify({
        adapter: "codex",
        entries: [{ target, backup, created: false }],
        installedAt: "2026-07-24T00:00:00.000Z",
        migration: {
          status: "cleaning",
          changes: [
            {
              target,
              beforeHash: createHash("sha256").update(installed).digest("hex"),
              afterHash: createHash("sha256").update(baseline).digest("hex"),
            },
          ],
        },
      }),
    );

    await applyManagedInstall(
      codexAdapter.installPlan(home, "/opt/intero/mcp-stdio"),
      home,
    );

    expect(await readFile(target, "utf8")).toContain(
      'command = "/opt/intero/mcp-stdio"',
    );
    await expect(stat(backup)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves legacy Claude nodes whose original executable was not journaled", async () => {
    const home = await mkdtemp(join(tmpdir(), "intero-legacy-claude-"));
    const stateDirectory = join(home, ".intero", "integrations");
    const config = join(home, ".claude.json");
    const settings = join(home, ".claude", "settings.json");
    const backup = join(stateDirectory, "claude-code-0.backup");
    const executable = "/opt/intero/legacy-mcp";
    await mkdir(join(home, ".claude"), { recursive: true });
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(backup, "{}\n");
    await writeFile(
      config,
      JSON.stringify({ mcpServers: { intero: { command: executable } } }),
    );
    await writeFile(
      settings,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: `'${executable}' --hook-source claude-code`,
                  timeout: 10,
                },
              ],
            },
          ],
        },
      }),
    );
    await writeFile(
      join(stateDirectory, "claude-code.json"),
      JSON.stringify({
        adapter: "claude-code",
        entries: [
          { target: config, backup, created: false },
          { target: settings, created: true },
        ],
        installedAt: "2026-07-24T00:00:00.000Z",
      }),
    );

    await expect(
      applyManagedInstall(
        claudeCodeAdapter.installPlan(home, "/opt/intero/new-mcp"),
        home,
      ),
    ).rejects.toThrow("edited");

    expect(await readFile(config, "utf8")).toContain(executable);
  });
});

async function allFileContents(root: string): Promise<string> {
  const entries = await readdir(root, { recursive: true });
  const contents: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    if ((await stat(path)).isFile())
      contents.push(await readFile(path, "utf8"));
  }
  return contents.join("\n");
}
