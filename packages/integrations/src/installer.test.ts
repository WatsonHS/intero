import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { codexAdapter, openCodeAdapter } from "./index";
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
});
