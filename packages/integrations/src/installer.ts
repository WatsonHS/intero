import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  open,
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
  created: boolean;
  baseHash: string;
  installedHash: string;
  managed: ManagedFile;
};

export type InstallManifest = {
  schemaVersion: 2;
  adapter: ManagedInstallPlan["adapter"];
  status: "installing" | "installed";
  allowedRoots: string[];
  entries: ManifestEntry[];
  beforeEntries?: ManifestEntry[];
  retiredEntries?: ManifestEntry[];
  installedAt: string;
};

type LegacyInstallManifest = {
  adapter: ManagedInstallPlan["adapter"];
  entries: Array<{ target: string; backup?: string; created: boolean }>;
  installedAt: string;
  migration?: {
    status: "cleaning" | "cleaned";
    changes: Array<{
      target: string;
      beforeHash: string | null;
      afterHash: string | null;
    }>;
  };
};

type PreparedWrite = {
  target: string;
  content: string;
  entry: ManifestEntry;
};

const LEGACY_INSTRUCTION_CONTENT = `# Intero coordination

Use the Intero MCP tools only at semantic branch points. Report an intent,
decision, blocker, dependency, meaningful scope change, artifact, validation
outcome, pause, or completion. Never send prompts, chain-of-thought, raw tool
input/output, terminal logs, secrets, or file contents as checkpoints.
`;

export async function applyManagedInstall(
  plan: ManagedInstallPlan,
  homeDirectory: string,
): Promise<InstallManifest> {
  const safeHome = resolve(homeDirectory);
  return withIntegrationLock(safeHome, plan.adapter, async () => {
    await migrateLegacyManifest(safeHome, plan.adapter);
    return applyManagedInstallUnlocked(plan, safeHome);
  });
}

async function applyManagedInstallUnlocked(
  plan: ManagedInstallPlan,
  safeHome: string,
): Promise<InstallManifest> {
  const stateDirectory = join(safeHome, ".intero", "integrations");
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const previous = await readManifest(safeHome, plan.adapter);
  const allowedRoots = managedRoots(safeHome, [
    ...plan.allowedRoots,
    ...(previous?.allowedRoots ?? []),
  ]);
  for (const root of allowedRoots) {
    await mkdir(root, { recursive: true, mode: 0o700 });
  }
  const previousAfterByTarget = new Map(
    previous?.entries.map((entry) => [entry.target, entry]),
  );
  const beforeEntries =
    previous?.status === "installing"
      ? (previous.beforeEntries ?? [])
      : (previous?.entries ?? []);
  const previousBeforeByTarget = new Map(
    beforeEntries.map((entry) => [entry.target, entry]),
  );
  const prepared: PreparedWrite[] = [];
  const plannedTargets = new Set<string>();

  for (const file of plan.files) {
    const target = await assertInsideAllowedRoots(file.path, allowedRoots);
    plannedTargets.add(target);
    const existing = await readOptional(target);
    const previousAfter = previousAfterByTarget.get(target);
    const previousBefore = previousBeforeByTarget.get(target);
    const withoutPrevious =
      previousAfter || previousBefore
        ? existing === undefined
          ? ""
          : recoverManagedBase(existing, previousAfter, previousBefore)
        : (existing ?? "");
    if (!previousAfter && !previousBefore && existing !== undefined) {
      assertAvailableOwnership(withoutPrevious, file);
    }
    const next = mergeManagedFile(withoutPrevious, file);
    prepared.push({
      target,
      content: next,
      entry: {
        target,
        created:
          previousBefore?.created ??
          previousAfter?.created ??
          existing === undefined,
        baseHash: sha256(withoutPrevious),
        installedHash: sha256(next),
        managed: file,
      },
    });
  }
  const retiredEntries = [
    ...(previous?.status === "installing"
      ? (previous.retiredEntries ?? [])
      : []),
    ...beforeEntries.filter((entry) => !plannedTargets.has(entry.target)),
    ...(previous?.entries ?? []).filter(
      (entry) => !plannedTargets.has(entry.target),
    ),
  ]
    .filter((entry) => !plannedTargets.has(entry.target))
    .filter(
      (entry, index, entries) =>
        entries.findIndex(
          (candidate) =>
            candidate.target === entry.target &&
            candidate.installedHash === entry.installedHash,
        ) === index,
    );
  const retiredTargets = [
    ...new Set(retiredEntries.map((entry) => entry.target)),
  ];
  const retired = await Promise.all(
    retiredTargets.map((target) =>
      prepareRemovalCandidates(
        retiredEntries.filter((entry) => entry.target === target),
        allowedRoots,
      ),
    ),
  );

  const installingManifest: InstallManifest = {
    schemaVersion: 2,
    adapter: plan.adapter,
    status: "installing",
    allowedRoots,
    entries: prepared.map(({ entry }) => entry),
    beforeEntries,
    retiredEntries,
    installedAt: new Date().toISOString(),
  };
  await writeAtomically(
    manifestPath(safeHome, plan.adapter),
    `${JSON.stringify(installingManifest, null, 2)}\n`,
  );

  for (const write of prepared) {
    await writeAtomically(write.target, write.content);
  }
  await applyRemovals(retired);

  const manifest: InstallManifest = {
    schemaVersion: 2,
    adapter: plan.adapter,
    status: "installed",
    allowedRoots,
    entries: prepared.map(({ entry }) => entry),
    installedAt: new Date().toISOString(),
  };
  await writeAtomically(
    manifestPath(safeHome, plan.adapter),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

function recoverManagedBase(
  existing: string,
  after: ManifestEntry | undefined,
  before: ManifestEntry | undefined,
): string {
  for (const entry of [after, before]) {
    if (!entry) continue;
    try {
      return removeManagedFile(existing, entry.managed);
    } catch {
      // An interrupted upgrade may leave either the old or new exact value.
    }
  }
  const managed = after?.managed ?? before?.managed;
  if (managed) return removeManagedFile(existing, managed, true);
  return existing;
}

function assertAvailableOwnership(existing: string, file: ManagedFile): void {
  if (file.format === "typescript") {
    throw new Error(
      `Refusing to replace an unmanaged ${file.marker} plugin file.`,
    );
  }
  if (file.format === "toml") {
    const table = file.content.match(/^\s*(\[[^\]]+\])/m)?.[1];
    if (table && existing.includes(table)) {
      throw new Error(
        `Refusing to replace an unmanaged ${table} configuration table.`,
      );
    }
    return;
  }
  if (file.format === "json" || file.format === "jsonc") {
    const current = existing.trim()
      ? (parse(existing) as unknown)
      : ({} as Record<string, unknown>);
    const desired = parseJsonObject(file.content);
    assertJsonLeavesAvailable(current, desired, file.marker);
  }
}

function assertJsonLeavesAvailable(
  current: unknown,
  desired: unknown,
  marker: string,
): void {
  if (Array.isArray(desired)) {
    if (
      Array.isArray(current) &&
      desired.some((item) =>
        current.some((candidate) => deepEqual(candidate, item)),
      )
    ) {
      throw new Error(`Refusing to adopt an unmanaged ${marker} array entry.`);
    }
    return;
  }
  if (!isRecord(desired) || !isRecord(current)) return;
  for (const [key, value] of Object.entries(desired)) {
    if (!(key in current)) continue;
    if (isRecord(value) && isRecord(current[key])) {
      assertJsonLeavesAvailable(current[key], value, marker);
    } else if (Array.isArray(value) && Array.isArray(current[key])) {
      assertJsonLeavesAvailable(current[key], value, marker);
    } else {
      throw new Error(
        `Refusing to replace an unmanaged ${marker} configuration value.`,
      );
    }
  }
}

export async function diagnoseManagedInstall(
  plan: ManagedInstallPlan,
  homeDirectory: string,
): Promise<Array<{ path: string; ok: boolean; detail: string }>> {
  const safeHome = resolve(homeDirectory);
  const allowedRoots = managedRoots(safeHome, plan.allowedRoots);
  const diagnostics = await Promise.all(
    plan.files.map(async (file) => {
      const target = await assertInsideAllowedRoots(file.path, allowedRoots);
      const content = await readOptional(target);
      const ok =
        content !== undefined &&
        (file.format === "toml" || file.format === "markdown"
          ? hasManagedBlock(content, file)
          : file.format === "typescript"
            ? content === normalizedContent(file.content)
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
  const manifest = await readManifest(safeHome, plan.adapter);
  if (manifest?.status === "installing") {
    diagnostics.push({
      path: manifestPath(safeHome, plan.adapter),
      ok: false,
      detail: "an interrupted integration journal requires repair",
    });
  }
  const lockPath = join(
    safeHome,
    ".intero",
    "integrations",
    `${plan.adapter}.lock`,
  );
  if ((await readOptionalStat(lockPath)) !== undefined) {
    diagnostics.push({
      path: lockPath,
      ok: false,
      detail: "an integration change is active or left a stale lock",
    });
  }
  return diagnostics;
}

export async function managedIntegrationHasState(
  adapter: ManagedInstallPlan["adapter"],
  homeDirectory: string,
): Promise<boolean> {
  return (
    (await readOptional(manifestPath(resolve(homeDirectory), adapter))) !==
    undefined
  );
}

export async function managedIntegrationTargets(
  plan: ManagedInstallPlan,
  homeDirectory: string,
): Promise<string[]> {
  const safeHome = resolve(homeDirectory);
  const targets = new Set<string>();
  const planRoots = managedRoots(safeHome, plan.allowedRoots);
  for (const file of plan.files) {
    targets.add(await assertInsideAllowedRoots(file.path, planRoots));
  }
  const raw = await readOptional(manifestPath(safeHome, plan.adapter));
  if (!raw) return [...targets].toSorted();
  const manifest = JSON.parse(raw) as InstallManifest | LegacyInstallManifest;
  if ("schemaVersion" in manifest) {
    const roots = manifest.allowedRoots ?? [safeHome];
    for (const entry of [
      ...manifest.entries,
      ...(manifest.beforeEntries ?? []),
      ...(manifest.retiredEntries ?? []),
    ]) {
      targets.add(await assertInsideAllowedRoots(entry.target, roots));
    }
  } else {
    for (const entry of manifest.entries) {
      targets.add(await assertInsideHome(entry.target, safeHome));
    }
  }
  return [...targets].toSorted();
}

export async function uninstallManagedIntegration(
  adapter: ManagedInstallPlan["adapter"],
  homeDirectory: string,
): Promise<void> {
  const safeHome = resolve(homeDirectory);
  return withIntegrationLock(safeHome, adapter, async () => {
    if (await migrateLegacyManifest(safeHome, adapter)) return;
    await uninstallManagedIntegrationUnlocked(adapter, safeHome);
  });
}

async function uninstallManagedIntegrationUnlocked(
  adapter: ManagedInstallPlan["adapter"],
  safeHome: string,
): Promise<void> {
  const path = manifestPath(safeHome, adapter);
  const manifest = await readManifest(safeHome, adapter);
  if (!manifest) return;
  const allowedRoots = manifest.allowedRoots ?? [safeHome];

  const allEntries =
    manifest.status === "installing"
      ? [
          ...manifest.entries,
          ...(manifest.beforeEntries ?? []),
          ...(manifest.retiredEntries ?? []),
        ]
      : manifest.entries;
  const targets = [...new Set(allEntries.map((entry) => entry.target))];
  const prepared = await Promise.all(
    targets.map((target) =>
      prepareRemovalCandidates(
        allEntries.filter((entry) => entry.target === target),
        allowedRoots,
      ),
    ),
  );
  await applyRemovals(prepared);
  await unlink(path);
}

async function prepareRemovalCandidates(
  entries: ManifestEntry[],
  allowedRoots: string[],
) {
  const first = entries[0];
  if (!first) throw new Error("Managed removal has no ownership entry.");
  const target = await assertInsideAllowedRoots(first.target, allowedRoots);
  const existing = await readOptional(target);
  if (existing === undefined) return { target, remove: false };
  for (const entry of entries) {
    if (!entry.created && sha256(existing) === entry.baseHash) {
      return { target, remove: false };
    }
    if (entry.created && sha256(existing) === entry.installedHash) {
      return { target, remove: true };
    }
    try {
      return {
        target,
        remove: false,
        content: removeManagedFile(existing, entry.managed),
      };
    } catch {
      // An interrupted upgrade can leave any journaled exact version.
    }
  }
  throw managedConflict(first.managed.marker);
}

async function applyRemovals(
  prepared: Array<{ target: string; remove: boolean; content?: string }>,
) {
  for (const change of prepared) {
    if (change.remove) {
      await unlink(change.target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    } else if (change.content !== undefined) {
      await writeAtomically(change.target, change.content);
    }
  }
}

function mergeManagedFile(existing: string, file: ManagedFile): string {
  if (file.format === "toml" || file.format === "markdown") {
    const start = managedStart(file);
    const end = managedEnd(file);
    const withoutOld = removeManagedBlock(existing, start, end).trimEnd();
    return `${withoutOld}${withoutOld ? "\n\n" : ""}${start}\n${file.content.trim()}\n${end}\n`;
  }
  if (file.format === "json") {
    const current = existing.trim() ? parseJsonObject(existing) : {};
    const desired = parseJsonObject(file.content);
    return `${JSON.stringify(deepMerge(current, desired), null, 2)}\n`;
  }
  if (file.format === "jsonc") {
    let current = existing.trim() ? existing : "{}\n";
    const desired = parseJsonObject(file.content);
    for (const [key, value] of Object.entries(desired)) {
      const currentValue = parse(current)?.[key] as unknown;
      const merged =
        Array.isArray(currentValue) && Array.isArray(value)
          ? mergeArrays(currentValue, value)
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
    return normalizedContent(current);
  }
  return normalizedContent(file.content);
}

function removeManagedFile(
  existing: string,
  file: ManagedFile,
  allowMissing = false,
): string {
  if (file.format === "toml" || file.format === "markdown") {
    if (!hasManagedBlock(existing, file)) {
      const hasEitherMarker =
        existing.includes(managedStart(file)) ||
        existing.includes(managedEnd(file));
      if (allowMissing && !hasEitherMarker) return existing;
      throw new Error(
        `Managed ${file.marker} block is missing or was changed; repair is required before uninstall.`,
      );
    }
    return normalizedContent(
      removeManagedBlock(existing, managedStart(file), managedEnd(file)).trim(),
    );
  }
  if (file.format === "typescript") {
    if (existing !== normalizedContent(file.content)) {
      throw new Error(
        `Managed ${file.marker} file was changed; refusing to overwrite user edits.`,
      );
    }
    return "";
  }
  if (file.format === "jsonc") {
    return removeDesiredJsonc(
      existing,
      parseJsonObject(file.content),
      file.marker,
      allowMissing,
    );
  }

  const current = parse(existing) as unknown;
  const desired = parseJsonObject(file.content);
  const next = removeDesired(current, desired, file.marker, allowMissing);
  return `${JSON.stringify(next ?? {}, null, 2)}\n`;
}

function removeDesiredJsonc(
  existing: string,
  desired: Record<string, unknown>,
  marker: string,
  allowMissing: boolean,
): string {
  let current = existing;
  for (const [key, value] of Object.entries(desired)) {
    current = removeJsoncValue(current, [key], value, marker, allowMissing);
  }
  return normalizedContent(current);
}

function removeJsoncValue(
  document: string,
  path: Array<string | number>,
  desired: unknown,
  marker: string,
  allowMissing: boolean,
): string {
  const current = valueAtPath(parse(document), path);
  if (Array.isArray(desired)) {
    if (current === undefined && allowMissing) return document;
    if (!Array.isArray(current)) throw managedConflict(marker);
    const remaining = [...current];
    for (const desiredItem of desired) {
      const index = remaining.findIndex((item) => deepEqual(item, desiredItem));
      if (index < 0) {
        if (allowMissing) {
          if (remaining.some(looksInteroManaged)) throw managedConflict(marker);
          continue;
        }
        throw managedConflict(marker);
      }
      remaining.splice(index, 1);
    }
    return editJsonc(
      document,
      path,
      remaining.length === 0 ? undefined : remaining,
    );
  }
  if (isRecord(desired)) {
    if (current === undefined && allowMissing) return document;
    if (!isRecord(current)) throw managedConflict(marker);
    let next = document;
    for (const [key, value] of Object.entries(desired)) {
      next = removeJsoncValue(
        next,
        [...path, key],
        value,
        marker,
        allowMissing,
      );
    }
    const remaining = valueAtPath(parse(next), path);
    return isRecord(remaining) && Object.keys(remaining).length === 0
      ? editJsonc(next, path, undefined)
      : next;
  }
  if (current === undefined && allowMissing) return document;
  if (!deepEqual(current, desired)) throw managedConflict(marker);
  return editJsonc(document, path, undefined);
}

function editJsonc(
  document: string,
  path: Array<string | number>,
  value: unknown,
): string {
  return applyEdits(
    document,
    modify(document, path, value, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  );
}

function valueAtPath(value: unknown, path: Array<string | number>): unknown {
  return path.reduce<unknown>((current, key) => {
    if (typeof key === "number" && Array.isArray(current)) return current[key];
    if (typeof key === "string" && isRecord(current)) return current[key];
    return undefined;
  }, value);
}

function removeDesired(
  current: unknown,
  desired: unknown,
  marker: string,
  allowMissing = false,
): unknown {
  if (Array.isArray(desired)) {
    if (current === undefined && allowMissing) return current;
    if (!Array.isArray(current)) throw managedConflict(marker);
    const remaining = [...current];
    for (const desiredItem of desired) {
      const index = remaining.findIndex((item) => deepEqual(item, desiredItem));
      if (index < 0) {
        if (allowMissing) {
          if (remaining.some(looksInteroManaged)) throw managedConflict(marker);
          continue;
        }
        throw managedConflict(marker);
      }
      remaining.splice(index, 1);
    }
    return remaining;
  }
  if (isRecord(desired)) {
    if (current === undefined && allowMissing) return current;
    if (!isRecord(current)) throw managedConflict(marker);
    const result = { ...current };
    for (const [key, desiredValue] of Object.entries(desired)) {
      if (!(key in result)) {
        if (allowMissing) continue;
        throw managedConflict(marker);
      }
      if (isRecord(desiredValue) || Array.isArray(desiredValue)) {
        const nested = removeDesired(
          result[key],
          desiredValue,
          marker,
          allowMissing,
        );
        if (
          (isRecord(nested) && Object.keys(nested).length === 0) ||
          (Array.isArray(nested) && nested.length === 0)
        ) {
          delete result[key];
        } else {
          result[key] = nested;
        }
      } else if (deepEqual(result[key], desiredValue)) {
        delete result[key];
      } else {
        throw managedConflict(marker);
      }
    }
    return result;
  }
  if (current === undefined && allowMissing) return current;
  if (!deepEqual(current, desired)) throw managedConflict(marker);
  return undefined;
}

function managedConflict(marker: string): Error {
  return new Error(
    `Managed ${marker} configuration was changed; refusing to overwrite user edits.`,
  );
}

function hasManagedBlock(existing: string, file: ManagedFile): boolean {
  const start = managedStart(file);
  const end = managedEnd(file);
  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return false;
  const body = existing.slice(startIndex + start.length, endIndex).trim();
  return body === file.content.trim();
}

function managedStart(file: ManagedFile): string {
  return file.format === "markdown"
    ? `<!-- >>> ${file.marker} -->`
    : `# >>> ${file.marker}`;
}

function managedEnd(file: ManagedFile): string {
  return file.format === "markdown"
    ? `<!-- <<< ${file.marker} -->`
    : `# <<< ${file.marker}`;
}

function hasDesiredJson(existing: string, file: ManagedFile): boolean {
  try {
    const current = parse(existing) as Record<string, unknown>;
    const desired = parseJsonObject(file.content);
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
        ? mergeArrays(result[key] as unknown[], value)
        : isRecord(result[key]) && isRecord(value)
          ? deepMerge(result[key] as object, value)
          : value;
  }
  return result as T;
}

function mergeArrays(base: unknown[], update: unknown[]): unknown[] {
  return [
    ...new Map(
      [...base, ...update].map((item) => [JSON.stringify(item), item]),
    ).values(),
  ];
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) throw new Error("Managed JSON must be an object.");
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function looksInteroManaged(value: unknown): boolean {
  return JSON.stringify(value).toLowerCase().includes("intero");
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

async function assertInsideAllowedRoots(
  path: string,
  allowedRoots: string[],
): Promise<string> {
  const target = resolve(path);
  for (const root of allowedRoots.map((candidate) => resolve(candidate))) {
    if (!isInside(target, root)) continue;
    if ((await readOptionalStat(root)) === undefined) {
      if ((await readOptionalStat(target)) === undefined) return target;
      continue;
    }
    return assertInsideHome(target, root);
  }
  throw new Error(
    "Managed integration path escapes the selected configuration roots.",
  );
}

function managedRoots(
  homeDirectory: string,
  requestedRoots: string[],
): string[] {
  const safeHome = resolve(homeDirectory);
  return [
    safeHome,
    ...new Set(
      requestedRoots
        .map((root) => resolve(root))
        .filter((root) => !isInside(root, safeHome)),
    ),
  ];
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

async function withIntegrationLock<T>(
  homeDirectory: string,
  adapter: ManagedInstallPlan["adapter"],
  operation: () => Promise<T>,
): Promise<T> {
  const stateDirectory = join(homeDirectory, ".intero", "integrations");
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const lockPath = join(stateDirectory, `${adapter}.lock`);
  const lock = await acquireIntegrationLock(lockPath, adapter);
  try {
    return await operation();
  } finally {
    await lock.handle.close();
    await releaseOwnedLock(lockPath, lock.nonce);
  }
}

async function acquireIntegrationLock(
  lockPath: string,
  adapter: ManagedInstallPlan["adapter"],
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      const nonce = randomUUID();
      const processStartIdentity = await readProcessStartIdentity(process.pid);
      try {
        if (!processStartIdentity) {
          throw new Error(
            "Intero could not verify the installer process identity.",
          );
        }
        await handle.writeFile(
          `${JSON.stringify({
            pid: process.pid,
            nonce,
            processStartIdentity,
            startedAt: new Date().toISOString(),
          })}\n`,
        );
        return { handle, nonce };
      } catch (error) {
        await handle.close();
        await unlink(lockPath).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "EEXIST" &&
        attempt === 0 &&
        (await integrationLockIsStale(lockPath))
      ) {
        await reclaimStaleLock(lockPath, adapter);
        continue;
      }
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(
          `Another ${adapter} integration change is already in progress.`,
        );
      }
      throw error;
    }
  }
  throw new Error(`Could not acquire the ${adapter} integration lock.`);
}

async function reclaimStaleLock(
  lockPath: string,
  adapter: ManagedInstallPlan["adapter"],
): Promise<void> {
  const reclaimPath = `${lockPath}.reclaim`;
  let claim:
    { handle: Awaited<ReturnType<typeof open>>; nonce: string } | undefined;
  for (let attempt = 0; attempt < 2 && !claim; attempt += 1) {
    try {
      const handle = await open(reclaimPath, "wx", 0o600);
      const nonce = randomUUID();
      const processStartIdentity = await readProcessStartIdentity(process.pid);
      try {
        if (!processStartIdentity) {
          throw new Error(
            "Intero could not verify the lock recovery process identity.",
          );
        }
        await handle.writeFile(
          `${JSON.stringify({
            pid: process.pid,
            nonce,
            processStartIdentity,
            startedAt: new Date().toISOString(),
          })}\n`,
        );
      } catch (error) {
        await handle.close();
        await unlink(reclaimPath).catch(() => undefined);
        throw error;
      }
      claim = { handle, nonce };
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "EEXIST" &&
        attempt === 0 &&
        (await integrationLockIsStale(reclaimPath))
      ) {
        await unlink(reclaimPath).catch(() => undefined);
        continue;
      }
      throw new Error(
        `Another ${adapter} integration change is already in progress.`,
      );
    }
  }
  if (!claim) {
    throw new Error(
      `Another ${adapter} integration change is already in progress.`,
    );
  }
  try {
    if (!(await integrationLockIsStale(lockPath))) {
      throw new Error(
        `Another ${adapter} integration change is already in progress.`,
      );
    }
    await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  } finally {
    await claim.handle.close();
    await releaseOwnedLock(reclaimPath, claim.nonce);
  }
}

async function releaseOwnedLock(
  lockPath: string,
  nonce: string,
): Promise<void> {
  const raw = await readOptional(lockPath);
  if (!raw) return;
  try {
    const lock = JSON.parse(raw) as { nonce?: unknown };
    if (lock.nonce !== nonce) return;
  } catch {
    return;
  }
  await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function integrationLockIsStale(lockPath: string): Promise<boolean> {
  try {
    const [raw, metadata] = await Promise.all([
      readFile(lockPath, "utf8"),
      stat(lockPath),
    ]);
    const lock = JSON.parse(raw) as {
      pid?: unknown;
      processStartIdentity?: unknown;
      startedAt?: unknown;
    };
    const age = Date.now() - metadata.mtimeMs;
    if (
      typeof lock.pid !== "number" ||
      !Number.isSafeInteger(lock.pid) ||
      lock.pid <= 0 ||
      typeof lock.startedAt !== "string"
    ) {
      return age > 30_000;
    }
    try {
      process.kill(lock.pid, 0);
      const currentIdentity = await readProcessStartIdentity(lock.pid);
      if (
        typeof lock.processStartIdentity === "string" &&
        currentIdentity !== undefined
      ) {
        return currentIdentity !== lock.processStartIdentity;
      }
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    try {
      const metadata = await stat(lockPath);
      return Date.now() - metadata.mtimeMs > 30_000;
    } catch (statError) {
      return (statError as NodeJS.ErrnoException).code === "ENOENT";
    }
  }
}

async function readProcessStartIdentity(
  pid: number,
): Promise<string | undefined> {
  try {
    if (process.platform === "linux") {
      const statLine = await readFile(`/proc/${pid}/stat`, "utf8");
      const afterCommand = statLine.slice(statLine.lastIndexOf(")") + 2);
      const fields = afterCommand.split(/\s+/);
      return fields[19];
    }
    if (process.platform === "darwin") {
      const value = execFileSync(
        "/bin/ps",
        ["-o", "lstart=", "-p", String(pid)],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1_000,
        },
      ).trim();
      return value || undefined;
    }
    if (process.platform === "win32") {
      const value = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks`,
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1_500,
        },
      ).trim();
      return value || undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function migrateLegacyManifest(
  homeDirectory: string,
  adapter: ManagedInstallPlan["adapter"],
): Promise<boolean> {
  const path = manifestPath(homeDirectory, adapter);
  const raw = await readOptional(path);
  if (!raw) return false;
  const parsed = JSON.parse(raw) as InstallManifest | LegacyInstallManifest;
  if ("schemaVersion" in parsed) return false;
  if (parsed.adapter !== adapter || !Array.isArray(parsed.entries)) {
    throw new Error("Legacy integration manifest is malformed or mismatched.");
  }
  if (parsed.migration?.status === "cleaned") {
    await cleanupLegacyBackups(parsed, homeDirectory);
    await unlink(path);
    return true;
  }

  // Legacy manifests did not record the installed executable. Current Agent
  // files are mutable and cannot prove their own original value, so any
  // executable-bearing legacy node fails closed unless a prior migration
  // journal already proves the post-cleanup hash.
  const legacyExecutable = undefined;
  const prepared = [];
  for (const entry of parsed.entries) {
    const target = await assertInsideHome(entry.target, homeDirectory);
    const current = await readOptional(target);
    const journaled = parsed.migration?.changes.find(
      (change) => resolve(change.target) === target,
    );
    const currentHash = current === undefined ? null : sha256(current);
    if (journaled && currentHash === journaled.afterHash) {
      prepared.push({ target, content: undefined, remove: false, journaled });
      continue;
    }
    if (journaled && currentHash !== journaled.beforeHash) {
      throw new Error(
        "Legacy managed configuration changed during migration; refusing recovery.",
      );
    }
    const next = await prepareLegacyMigration(
      entry,
      target,
      current,
      homeDirectory,
      legacyExecutable,
    );
    const change = {
      target,
      beforeHash: currentHash,
      afterHash: next.content === undefined ? null : sha256(next.content),
    };
    if (
      journaled &&
      (journaled.beforeHash !== change.beforeHash ||
        journaled.afterHash !== change.afterHash)
    ) {
      throw new Error("Legacy migration journal does not match the target.");
    }
    prepared.push({ ...next, target, journaled: journaled ?? change });
  }

  const migration = {
    status: "cleaning" as const,
    changes: prepared.map(({ journaled }) => journaled),
  };
  await writeAtomically(
    path,
    `${JSON.stringify({ ...parsed, migration }, null, 2)}\n`,
  );
  for (const change of prepared) {
    if (change.content !== undefined) {
      await writeAtomically(change.target, change.content);
    } else if (change.remove) {
      await unlink(change.target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  await writeAtomically(
    path,
    `${JSON.stringify(
      { ...parsed, migration: { ...migration, status: "cleaned" } },
      null,
      2,
    )}\n`,
  );
  await cleanupLegacyBackups(parsed, homeDirectory);
  await unlink(path);
  return true;
}

async function prepareLegacyMigration(
  entry: LegacyInstallManifest["entries"][number],
  target: string,
  current: string | undefined,
  homeDirectory: string,
  legacyExecutable: string | undefined,
): Promise<{ content?: string; remove: boolean }> {
  if (current === undefined) {
    if (entry.created) return { remove: false };
    if (!entry.backup) {
      throw new Error("Legacy integration entry cannot be safely migrated.");
    }
    const backup = await assertInsideHome(entry.backup, homeDirectory);
    const baseline = await readOptional(backup);
    if (baseline === undefined) {
      throw new Error("Legacy integration backup is missing.");
    }
    return { content: baseline, remove: false };
  }
  if (entry.created) {
    const cleaned = removeLegacyManagedContent(
      current,
      target.endsWith(".json") || target.endsWith(".jsonc") ? "{}\n" : "",
      target,
      legacyExecutable,
    );
    if (cleaned.trim() === "" || cleaned.trim() === "{}") {
      return { remove: true };
    }
    return { content: cleaned, remove: false };
  }
  if (!entry.backup) {
    throw new Error("Legacy integration entry cannot be safely migrated.");
  }
  const backup = await assertInsideHome(entry.backup, homeDirectory);
  const baseline = await readOptional(backup);
  if (baseline === undefined) {
    throw new Error("Legacy integration backup is missing.");
  }
  return {
    content: removeLegacyManagedContent(
      current,
      baseline,
      target,
      legacyExecutable,
    ),
    remove: false,
  };
}

async function cleanupLegacyBackups(
  manifest: LegacyInstallManifest,
  homeDirectory: string,
): Promise<void> {
  for (const entry of manifest.entries) {
    if (!entry.backup) continue;
    const backup = await assertInsideHome(entry.backup, homeDirectory);
    await unlink(backup).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

function removeLegacyManagedContent(
  current: string,
  baseline: string,
  target: string,
  legacyExecutable?: string,
): string {
  if (target.endsWith(".toml")) {
    const start = "# >>> intero-managed";
    const end = "# <<< intero-managed";
    if (!current.includes(start) || !current.includes(end)) {
      throw new Error(
        "Legacy Intero TOML block changed; refusing automatic migration.",
      );
    }
    const startIndex = current.indexOf(start) + start.length;
    const endIndex = current.indexOf(end, startIndex);
    const expected = legacyExecutable
      ? `[mcp_servers.intero]\ncommand = ${JSON.stringify(
          legacyExecutable,
        )}\nrequired = false`
      : undefined;
    if (!expected || current.slice(startIndex, endIndex).trim() !== expected) {
      throw new Error(
        "Legacy Intero TOML block was edited; refusing automatic migration.",
      );
    }
    return normalizedContent(removeManagedBlock(current, start, end).trim());
  }
  if (target.endsWith(".jsonc")) {
    return removeLegacyOpenCodeJsonc(current, baseline, legacyExecutable);
  }
  if (target.endsWith(".json")) {
    const next = removeLegacyJsonAdditions(
      parse(current) as unknown,
      parse(baseline) as unknown,
      legacyExecutable,
    );
    return `${JSON.stringify(next ?? {}, null, 2)}\n`;
  }
  const normalized = normalizedContent(current);
  if (
    target.endsWith("/intero.md") &&
    normalized === LEGACY_INSTRUCTION_CONTENT
  ) {
    return "";
  }
  if (
    target.endsWith("/intero.ts") &&
    legacyExecutable !== undefined &&
    isExactLegacyOpenCodePlugin(normalized, legacyExecutable)
  ) {
    return "";
  }
  throw new Error(
    "Legacy dedicated Intero file was edited; refusing automatic migration.",
  );
}

function isExactLegacyOpenCodePlugin(
  current: string,
  expectedExecutable: string,
): boolean {
  const match = current.match(/^const executable = (.+);$/m);
  if (!match) return false;
  let executable: unknown;
  try {
    executable = JSON.parse(match[1]!);
  } catch {
    return false;
  }
  return (
    executable === expectedExecutable &&
    current === legacyOpenCodePlugin(expectedExecutable)
  );
}

function legacyOpenCodePlugin(executable: string): string {
  return `import { spawn } from "node:child_process";
import { once } from "node:events";
import type { Plugin } from "@opencode-ai/plugin";

const executable = ${JSON.stringify(executable)};
const forwarded = new Set([
  "session.created",
  "session.idle",
  "session.deleted",
  "file.edited",
  "file.watcher.updated",
  "todo.updated",
  "lsp.client.diagnostics",
  "tool.execute.after"
]);

export const InteroPlugin: Plugin = async ({ directory, worktree }) => ({
  event: async ({ event }) => {
    if (!forwarded.has(event.type)) return;
    const properties = event.properties as Record<string, unknown>;
    const sessionId =
      typeof properties.sessionID === "string"
        ? properties.sessionID
        : typeof properties.sessionId === "string"
          ? properties.sessionId
          : "opencode-global";
    const child = spawn(executable, ["--hook-source", "opencode"], {
      stdio: ["pipe", "ignore", "ignore"]
    });
    child.stdin.end(
      JSON.stringify({
        hook_event_name: event.type,
        cwd: worktree || directory,
        session_id: sessionId
      })
    );
    await once(child, "close");
  }
});
`;
}

function removeLegacyJsonAdditions(
  current: unknown,
  baseline: unknown,
  legacyExecutable?: string,
): unknown {
  if (Array.isArray(current)) {
    const baselineItems = Array.isArray(baseline) ? baseline : [];
    return current.filter(
      (item) =>
        baselineItems.some((candidate) => deepEqual(candidate, item)) ||
        !isExactLegacyJsonAddition(item, legacyExecutable),
    );
  }
  if (isRecord(current)) {
    const baselineObject = isRecord(baseline) ? baseline : {};
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(current)) {
      if (!(key in baselineObject)) {
        if (key.toLowerCase() === "intero") {
          if (!isExactLegacyJsonAddition(value, legacyExecutable)) {
            throw new Error(
              "Legacy Intero JSON node was edited; refusing migration.",
            );
          }
          continue;
        }
        const cleaned = removeLegacyJsonAdditions(
          value,
          undefined,
          legacyExecutable,
        );
        if (!isEmptyContainer(cleaned)) next[key] = cleaned;
        continue;
      }
      if (
        key.toLowerCase() === "intero" &&
        !deepEqual(value, baselineObject[key])
      ) {
        throw new Error(
          "A pre-existing Intero JSON node changed; refusing migration.",
        );
      }
      next[key] = removeLegacyJsonAdditions(
        value,
        baselineObject[key],
        legacyExecutable,
      );
    }
    return next;
  }
  return current;
}

function isExactLegacyJsonAddition(
  value: unknown,
  legacyExecutable?: string,
): boolean {
  if (value === "intero.md") return true;
  if (Array.isArray(value)) {
    return (
      value.length === 1 &&
      isRecord(value[0]) &&
      Object.keys(value[0]).length === 1 &&
      Array.isArray(value[0].hooks) &&
      value[0].hooks.length === 1 &&
      isRecord(value[0].hooks[0]) &&
      value[0].hooks[0].type === "command" &&
      typeof value[0].hooks[0].command === "string" &&
      legacyExecutable !== undefined &&
      ["codex", "claude-code"].some(
        (source) =>
          value[0]!.hooks[0]!.command ===
          `${legacyShellQuote(legacyExecutable)} --hook-source ${source}`,
      ) &&
      (value[0].hooks[0].timeout === undefined ||
        value[0].hooks[0].timeout === 10)
    );
  }
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  if (
    deepEqual(keys, ["command"]) &&
    legacyExecutable !== undefined &&
    value.command === legacyExecutable
  ) {
    return true;
  }
  return (
    deepEqual(keys, ["command", "enabled", "type"]) &&
    value.type === "local" &&
    value.enabled === true &&
    Array.isArray(value.command) &&
    value.command.length === 1 &&
    value.command[0] === legacyExecutable
  );
}

function legacyShellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isEmptyContainer(value: unknown): boolean {
  return (
    (Array.isArray(value) && value.length === 0) ||
    (isRecord(value) && Object.keys(value).length === 0)
  );
}

function removeLegacyOpenCodeJsonc(
  current: string,
  baseline: string,
  legacyExecutable?: string,
): string {
  const currentValue = parse(current) as unknown;
  const baselineValue = parse(baseline) as unknown;
  let next = current;
  const currentMcp = valueAtPath(currentValue, ["mcp", "intero"]);
  const baselineMcp = valueAtPath(baselineValue, ["mcp", "intero"]);
  if (currentMcp !== undefined) {
    if (baselineMcp !== undefined) {
      throw new Error(
        "A pre-existing OpenCode Intero MCP node prevents safe migration.",
      );
    }
    if (!isExactLegacyJsonAddition(currentMcp, legacyExecutable)) {
      throw new Error(
        "Legacy OpenCode Intero MCP node was edited; refusing migration.",
      );
    }
    next = editJsonc(next, ["mcp", "intero"], undefined);
  }
  const instructions = valueAtPath(parse(next), ["instructions"]);
  const baselineInstructions = valueAtPath(baselineValue, ["instructions"]);
  if (Array.isArray(instructions)) {
    const baselineItems = Array.isArray(baselineInstructions)
      ? baselineInstructions
      : [];
    next = editJsonc(
      next,
      ["instructions"],
      instructions.filter(
        (item) =>
          baselineItems.some((candidate) => deepEqual(candidate, item)) ||
          item !== "intero.md",
      ),
    );
  }
  return normalizedContent(next);
}

async function readManifest(
  homeDirectory: string,
  adapter: ManagedInstallPlan["adapter"],
): Promise<InstallManifest | undefined> {
  const raw = await readOptional(manifestPath(homeDirectory, adapter));
  if (!raw) return undefined;
  const manifest = JSON.parse(raw) as InstallManifest;
  if (
    manifest.schemaVersion !== 2 ||
    manifest.adapter !== adapter ||
    (manifest.status !== undefined &&
      manifest.status !== "installing" &&
      manifest.status !== "installed")
  ) {
    throw new Error("Integration manifest is unsupported or mismatched.");
  }
  return {
    ...manifest,
    status: manifest.status ?? "installed",
    allowedRoots: manifest.allowedRoots ?? [resolve(homeDirectory)],
  };
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
  const temporary = `${path}.intero-tmp-${randomUUID()}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function normalizedContent(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
