#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TILE_SIZE = 64;
const GRID_COLUMNS = 20;
const MAX_SPRITE_ENTRIES = 400;
const SKIN_TONE_NAMES = new Map([
  ["", "Default"],
  ["1f3fb", "Light"],
  ["1f3fc", "Medium-Light"],
  ["1f3fd", "Medium"],
  ["1f3fe", "Medium-Dark"],
  ["1f3ff", "Dark"],
]);

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const sourceRoot = resolve(process.argv[2] ?? "");
const sourceAssets = join(sourceRoot, "assets");
const outputDirectory = join(repositoryRoot, "apps/web/public/fluent-emoji");
const manifestPath = join(
  repositoryRoot,
  "apps/web/src/emoji/fluent-emoji-manifest.ts",
);

if (!process.argv[2] || !existsSync(sourceAssets)) {
  throw new Error(
    "Usage: node scripts/generate-fluent-emoji-assets.mjs /path/to/microsoft/fluentui-emoji",
  );
}

const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: sourceRoot,
  encoding: "utf8",
}).trim();
const entries = readFluentEmojiEntries(sourceAssets);
const spriteGroups = groupSpriteEntries(entries);
const temporaryRoot = mkdtempSync(join(tmpdir(), "intero-fluent-emoji-"));
const spriteMetadata = [];
const emojiIndex = {};

rmSync(outputDirectory, { force: true, recursive: true });
mkdirSync(outputDirectory, { recursive: true });
mkdirSync(dirname(manifestPath), { recursive: true });

try {
  for (const [spriteIndex, group] of spriteGroups.entries()) {
    const spriteId = `${slugify(group.name)}-${group.page + 1}`;
    const inputDirectory = join(temporaryRoot, spriteId);
    const rows = Math.ceil(group.entries.length / GRID_COLUMNS);
    mkdirSync(inputDirectory, { recursive: true });

    group.entries.forEach((entry, index) => {
      symlinkSync(
        entry.imagePath,
        join(inputDirectory, `${String(index).padStart(4, "0")}.png`),
      );
      emojiIndex[entry.unicode] = [spriteIndex, index];
    });

    execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-framerate",
        "1",
        "-pattern_type",
        "glob",
        "-i",
        join(inputDirectory, "*.png"),
        "-vf",
        [
          `scale=${TILE_SIZE}:${TILE_SIZE}:force_original_aspect_ratio=decrease`,
          `pad=${TILE_SIZE}:${TILE_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
          `tile=${GRID_COLUMNS}x${rows}:nb_frames=${group.entries.length}`,
        ].join(","),
        "-frames:v",
        "1",
        "-c:v",
        "png",
        "-compression_level",
        "9",
        "-pix_fmt",
        "rgba",
        join(outputDirectory, `${spriteId}.png`),
      ],
      { stdio: "inherit" },
    );

    spriteMetadata.push({
      id: spriteId,
      columns: GRID_COLUMNS,
      rows,
    });
  }

  cpSync(join(sourceRoot, "LICENSE"), join(outputDirectory, "LICENSE"));
  writeFileSync(
    manifestPath,
    renderManifest({
      emojiIndex,
      sourceCommit,
      sprites: spriteMetadata,
    }),
  );
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

function readFluentEmojiEntries(assetsRoot) {
  const entries = [];
  for (const directoryName of readdirSync(assetsRoot).toSorted()) {
    const emojiDirectory = join(assetsRoot, directoryName);
    const metadataPath = join(emojiDirectory, "metadata.json");
    if (!existsSync(metadataPath)) continue;

    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    const imagePaths = find3dImages(emojiDirectory);
    const unicodes = metadata.unicodeSkintones ?? [metadata.unicode];
    if (imagePaths.length !== unicodes.length) {
      throw new Error(
        `${relative(assetsRoot, emojiDirectory)} has ${unicodes.length} Unicode entries but ${imagePaths.length} 3D assets.`,
      );
    }

    for (const unicode of unicodes) {
      const normalizedUnicode = normalizeUnicode(unicode);
      const tone = skinToneName(normalizedUnicode);
      const imagePath =
        imagePaths.find((candidate) =>
          tone === "Default"
            ? candidate.includes("/Default/") ||
              !candidate.match(
                /\/(?:Light|Medium-Light|Medium|Medium-Dark|Dark)\//,
              )
            : candidate.includes(`/${tone}/`),
        ) ?? imagePaths[0];
      if (!imagePath) {
        throw new Error(`No 3D asset found for ${metadata.cldr}.`);
      }
      entries.push({
        group: metadata.group,
        imagePath,
        unicode: normalizedUnicode,
        variant: tone === "Default" ? "base" : "tones",
      });
    }
  }
  return entries;
}

function find3dImages(directory) {
  const images = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      images.push(...find3dImages(entryPath));
    } else if (entry.name.endsWith(".png") && entryPath.includes("/3D/")) {
      images.push(entryPath);
    }
  }
  return images.toSorted();
}

function normalizeUnicode(value) {
  return value
    .trim()
    .split(/\s+/)
    .map((codepoint) => Number.parseInt(codepoint, 16).toString(16))
    .join("-");
}

function skinToneName(unicode) {
  const modifier =
    unicode.split("-").find((codepoint) => SKIN_TONE_NAMES.has(codepoint)) ??
    "";
  return SKIN_TONE_NAMES.get(modifier) ?? "Default";
}

function groupSpriteEntries(entries) {
  const buckets = new Map();
  for (const entry of entries) {
    const key = `${entry.group}:${entry.variant}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(entry);
    buckets.set(key, bucket);
  }

  const groups = [];
  for (const [name, bucket] of [...buckets].toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const sorted = bucket.toSorted((left, right) =>
      left.unicode.localeCompare(right.unicode),
    );
    for (let offset = 0; offset < sorted.length; offset += MAX_SPRITE_ENTRIES) {
      groups.push({
        name,
        page: offset / MAX_SPRITE_ENTRIES,
        entries: sorted.slice(offset, offset + MAX_SPRITE_ENTRIES),
      });
    }
  }
  return groups;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replaceAll("&", "and")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

function renderManifest({ emojiIndex, sourceCommit, sprites }) {
  const indexLines = Object.entries(emojiIndex)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(
      ([unicode, location]) =>
        `  ${JSON.stringify(unicode)}: [${location[0]}, ${location[1]}],`,
    )
    .join("\n");
  const spriteLines = sprites
    .map(
      (sprite) =>
        `  { id: ${JSON.stringify(sprite.id)}, columns: ${sprite.columns}, rows: ${sprite.rows} },`,
    )
    .join("\n");

  return `// Generated by scripts/generate-fluent-emoji-assets.mjs.
// Source: https://github.com/microsoft/fluentui-emoji/tree/${sourceCommit}

export const FLUENT_EMOJI_SOURCE_COMMIT =
  ${JSON.stringify(sourceCommit)};
export const FLUENT_EMOJI_TILE_SIZE = ${TILE_SIZE};

export const FLUENT_EMOJI_SPRITES = [
${spriteLines}
] as const;

export const FLUENT_EMOJI_INDEX: Readonly<
  Record<string, readonly [spriteIndex: number, tileIndex: number]>
> = {
${indexLines}
};
`;
}
