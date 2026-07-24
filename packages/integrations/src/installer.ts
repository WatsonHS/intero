import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { applyEdits, modify, parse } from "jsonc-parser";

import type { ManagedFile, ManagedInstallPlan } from "./index.js";

type ManifestEntry = {
  target: string;
  backup?: string;
  created: boolean;
};

type InstallManifest = {
  adapter: ManagedInstallPlan["adapter"];
  entries: ManifestEntry[];
  installedAt: string;
};

export async function applyManagedInstall(
  plan: ManagedInstallPlan,
  homeDirectory: string,
): Promise<InstallManifest> {
  const safeHome = resolve(homeDirectory);
  const stateDirectory = join(safeHome, ".intero", "integrations");
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const previousRaw = await readOptional(manifestPath(safeHome, plan.adapter));
  const previous = previousRaw
    ? (JSON.parse(previousRaw) as InstallManifest)
    : undefined;
  const previousByTarget = new Map(
    previous?.entries.map((entry) => [entry.target, entry]),
  );
  const entries: ManifestEntry[] = [];

  for (const file of plan.files) {
    const target = await assertInsideHome(file.path, safeHome);
    await mkdir(dirname(target), { recursive: true });
    const existing = await readOptional(target);
    const previousEntry = previousByTarget.get(target);
    const created = previousEntry?.created ?? existing === undefined;
    const backup =
      previousEntry?.backup ??
      (created
        ? undefined
        : join(stateDirectory, `${plan.adapter}-${entries.length}.backup`));
    if (backup && !previousEntry) await copyFile(target, backup);

    const next = mergeManagedFile(existing ?? "", file);
    await writeAtomically(target, next);
    entries.push({ target, created, ...(backup ? { backup } : {}) });
  }

  const manifest: InstallManifest = {
    adapter: plan.adapter,
    entries,
    installedAt: new Date().toISOString(),
  };
  await writeAtomically(
    manifestPath(safeHome, plan.adapter),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export async function diagnoseManagedInstall(
  plan: ManagedInstallPlan,
  homeDirectory: string,
): Promise<Array<{ path: string; ok: boolean; detail: string }>> {
  const safeHome = resolve(homeDirectory);
  return Promise.all(
    plan.files.map(async (file) => {
      const target = await assertInsideHome(file.path, safeHome);
      const content = await readOptional(target);
      const ok =
        content !== undefined &&
        (file.format === "toml"
          ? content.includes(`# >>> ${file.marker}`)
          : file.format === "markdown" || file.format === "typescript"
            ? content.includes(file.content.trim())
            : hasDesiredJson(content, file));
      return {
        path: target,
        ok,
        detail: ok
          ? "managed content is present"
          : "managed content is missing or changed",
      };
    }),
  );
}

export async function uninstallManagedIntegration(
  adapter: ManagedInstallPlan["adapter"],
  homeDirectory: string,
): Promise<void> {
  const safeHome = resolve(homeDirectory);
  const path = manifestPath(safeHome, adapter);
  const raw = await readOptional(path);
  if (!raw) return;
  const manifest = JSON.parse(raw) as InstallManifest;
  if (manifest.adapter !== adapter) {
    throw new Error(
      "Integration manifest does not match the requested adapter.",
    );
  }

  for (const entry of manifest.entries) {
    const target = await assertInsideHome(entry.target, safeHome);
    if (entry.created) {
      await unlink(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    } else if (entry.backup) {
      const backup = await assertInsideHome(entry.backup, safeHome);
      await rename(backup, target);
    }
  }
  await unlink(path);
}

function mergeManagedFile(existing: string, file: ManagedFile): string {
  if (file.format === "toml") {
    const start = `# >>> ${file.marker}`;
    const end = `# <<< ${file.marker}`;
    const withoutOld = removeManagedBlock(existing, start, end).trimEnd();
    return `${withoutOld}${withoutOld ? "\n\n" : ""}${start}\n${file.content.trim()}\n${end}\n`;
  }
  if (file.format === "json") {
    const current = existing.trim() ? (JSON.parse(existing) as object) : {};
    const desired = JSON.parse(file.content) as object;
    return `${JSON.stringify(deepMerge(current, desired), null, 2)}\n`;
  }
  if (file.format === "jsonc") {
    let current = existing.trim() ? existing : "{}\n";
    const desired = JSON.parse(file.content) as Record<string, unknown>;
    for (const [key, value] of Object.entries(desired)) {
      const currentValue = parse(current)?.[key] as unknown;
      const merged =
        key === "instructions" &&
        Array.isArray(currentValue) &&
        Array.isArray(value)
          ? [...new Set([...currentValue, ...value])]
          : isRecord(currentValue) && isRecord(value)
            ? deepMerge(currentValue, value)
            : value;
      current = applyEdits(
        current,
        modify(current, [key], merged, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        }),
      );
    }
    return current.endsWith("\n") ? current : `${current}\n`;
  }
  return file.content.endsWith("\n") ? file.content : `${file.content}\n`;
}

function hasDesiredJson(existing: string, file: ManagedFile): boolean {
  try {
    const current = parse(existing) as Record<string, unknown>;
    const desired = JSON.parse(file.content) as Record<string, unknown>;
    return containsDesired(current, desired);
  } catch {
    return false;
  }
}

function containsDesired(current: unknown, desired: unknown): boolean {
  if (Array.isArray(desired)) {
    return (
      Array.isArray(current) &&
      desired.every((item) =>
        current.some((candidate) => containsDesired(candidate, item)),
      )
    );
  }
  if (isRecord(desired)) {
    return (
      isRecord(current) &&
      Object.entries(desired).every(([key, value]) =>
        containsDesired(current[key], value),
      )
    );
  }
  return Object.is(current, desired);
}

function deepMerge<T extends object>(base: T, update: object): T {
  const result = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(update)) {
    result[key] =
      Array.isArray(result[key]) && Array.isArray(value)
        ? [
            ...new Map(
              [...(result[key] as unknown[]), ...value].map((item) => [
                JSON.stringify(item),
                item,
              ]),
            ).values(),
          ]
        : isRecord(result[key]) && isRecord(value)
          ? deepMerge(result[key] as object, value)
          : value;
  }
  return result as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function removeManagedBlock(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  if (startIndex < 0) return value;
  const endIndex = value.indexOf(end, startIndex);
  if (endIndex < 0) {
    throw new Error("Managed integration block is missing its closing marker.");
  }
  return `${value.slice(0, startIndex)}${value.slice(endIndex + end.length)}`;
}

async function assertInsideHome(
  path: string,
  homeDirectory: string,
): Promise<string> {
  const target = resolve(path);
  if (!isInside(target, homeDirectory)) {
    throw new Error(
      "Managed integration path escapes the selected home directory.",
    );
  }
  let existingAncestor = target;
  while ((await readOptionalStat(existingAncestor)) === undefined) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }
  const resolvedAncestor = await realpath(existingAncestor);
  const canonicalHome = await realpath(homeDirectory);
  if (!isInside(resolvedAncestor, canonicalHome)) {
    throw new Error(
      "Managed integration path traverses a symlink outside the selected home.",
    );
  }
  return target;
}

function isInside(target: string, root: string): boolean {
  const pathFromRoot = relative(root, target);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) &&
      pathFromRoot !== ".." &&
      !isAbsolute(pathFromRoot))
  );
}

function manifestPath(
  homeDirectory: string,
  adapter: ManagedInstallPlan["adapter"],
) {
  return join(homeDirectory, ".intero", "integrations", `${adapter}.json`);
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    await stat(path);
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readOptionalStat(path: string) {
  try {
    return await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeAtomically(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.intero-tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}
