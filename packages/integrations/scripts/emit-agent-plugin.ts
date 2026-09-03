/**
 * Emits the published `intero` Agent Plugin from the adapter sources.
 *
 * The generated tree is byte-reproducible (ADR-0011 acceptance evidence 8):
 * running this script twice from an unchanged working tree writes identical
 * bytes, so CI can regenerate and diff it. One directory is emitted per
 * standard-capable client because the stdio bridge resolves encrypted
 * connection state per repository *and* client.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAgentPluginArtifact,
  standardPluginClients,
} from "../src/index.js";

const outputRoot = fileURLToPath(
  new URL("../dist/agent-plugin/", import.meta.url),
);

await rm(outputRoot, { recursive: true, force: true });
for (const client of standardPluginClients) {
  for (const [relativePath, content] of buildAgentPluginArtifact({ client })) {
    const target = join(outputRoot, client, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    process.stdout.write(`${target}\n`);
  }
}
