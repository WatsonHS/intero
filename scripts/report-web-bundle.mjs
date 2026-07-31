import { readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const assetsDirectory = join(root, "apps/web/dist/assets");
const outputPath = join(root, "apps/web/dist/bundle-report.json");
const entryBudgetBytes = 300 * 1024;
const lazyBudgetBytes = 500 * 1024;
// livekit-client ships as one pre-bundled ESM module. It is loaded only after
// somebody starts or accepts a call, so keep a narrow dependency-only budget
// instead of raising the limit for every lazy application chunk.
const liveKitClientBudgetBytes = 550 * 1024;

const files = (await readdir(assetsDirectory))
  .filter((file) => file.endsWith(".js"))
  .toSorted();
const chunks = await Promise.all(
  files.map(async (file) => ({
    file,
    bytes: (await stat(join(assetsDirectory, file))).size,
    kind: file.startsWith("index-") ? "entry" : "lazy",
  })),
);
const violations = chunks.filter((chunk) => {
  const budget =
    chunk.kind === "entry"
      ? entryBudgetBytes
      : chunk.file.startsWith("vendor-livekit-client-")
        ? liveKitClientBudgetBytes
        : lazyBudgetBytes;
  return chunk.bytes > budget;
});
const report = {
  generatedAt: new Date().toISOString(),
  budgets: {
    entryBudgetBytes,
    lazyBudgetBytes,
    liveKitClientBudgetBytes,
  },
  chunks: chunks.toSorted((left, right) => right.bytes - left.bytes),
  violations,
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log("Web bundle budget");
for (const chunk of report.chunks.slice(0, 12)) {
  console.log(
    `${chunk.kind.padEnd(5)} ${String(Math.ceil(chunk.bytes / 1024)).padStart(4)} KiB  ${basename(chunk.file)}`,
  );
}
console.log(`Report: ${outputPath}`);

if (violations.length > 0) {
  console.error(
    `Bundle budget exceeded: ${violations.map((chunk) => chunk.file).join(", ")}`,
  );
  process.exitCode = 1;
}
