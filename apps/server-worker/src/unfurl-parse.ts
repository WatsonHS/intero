/**
 * Hand-written meta extraction over the first 512 KB of HTML.
 *
 * Limits (intentional, not a full HTML parser):
 * - only inspects the bytes already fetched (capped at 512 KB)
 * - regex over tags; ignores comments, encoding, and JS-rendered OG
 * - prefers Open Graph, then Twitter card, then `<title>`
 * - image URLs are kept only when they are https
 */

const META_TAG =
  /<meta\b[^>]*\b(?:name|property)\s*=\s*["']([^"']+)["'][^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*>/giu;
const META_TAG_CONTENT_FIRST =
  /<meta\b[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*\b(?:name|property)\s*=\s*["']([^"']+)["'][^>]*>/giu;
const TITLE_TAG = /<title\b[^>]*>([\s\S]*?)<\/title>/iu;

export interface ParsedLinkPreview {
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
}

export function parseLinkPreviewHtml(
  html: string,
  pageUrl: URL,
): ParsedLinkPreview {
  const tags = new Map<string, string>();
  for (const match of html.matchAll(META_TAG)) {
    const key = match[1]?.trim().toLowerCase();
    const value = decodeHtmlEntities(match[2] ?? "").trim();
    if (key && value && !tags.has(key)) tags.set(key, value);
  }
  for (const match of html.matchAll(META_TAG_CONTENT_FIRST)) {
    const key = match[2]?.trim().toLowerCase();
    const value = decodeHtmlEntities(match[1] ?? "").trim();
    if (key && value && !tags.has(key)) tags.set(key, value);
  }
  const titleTag = TITLE_TAG.exec(html)?.[1];
  const title =
    firstText(tags.get("og:title"), tags.get("twitter:title")) ??
    (titleTag
      ? decodeHtmlEntities(titleTag).replaceAll(/\s+/gu, " ").trim()
      : undefined);
  const description = firstText(
    tags.get("og:description"),
    tags.get("twitter:description"),
    tags.get("description"),
  );
  const siteName =
    firstText(tags.get("og:site_name"), tags.get("application-name")) ??
    pageUrl.hostname;
  const image = httpsImageUrl(
    firstText(tags.get("og:image"), tags.get("twitter:image")),
    pageUrl,
  );
  return {
    ...(title ? { title: title.slice(0, 300) } : {}),
    ...(description ? { description: description.slice(0, 1_000) } : {}),
    ...(siteName ? { siteName: siteName.slice(0, 200) } : {}),
    ...(image ? { image } : {}),
  };
}

function firstText(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value && value.trim());
}

function httpsImageUrl(
  raw: string | undefined,
  pageUrl: URL,
): string | undefined {
  if (!raw) return undefined;
  try {
    const resolved = new URL(raw, pageUrl);
    return resolved.protocol === "https:" ? resolved.href : undefined;
  } catch {
    return undefined;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}
