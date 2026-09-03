import { z } from "zod";

import { MessageId, PrincipalId, ThreadId } from "./ids.js";

const DateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine((value) => {
    const [yearText, monthText, dayText] = value.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day)
    ) {
      return false;
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Date is not a real calendar day.");

export const SearchMessageFilters = z
  .object({
    text: z.string().max(200),
    inThreadId: ThreadId.optional(),
    inTitle: z.string().min(1).max(200).optional(),
    fromPrincipalId: PrincipalId.optional(),
    fromDisplayName: z.string().min(1).max(120).optional(),
    before: DateOnly.optional(),
    after: DateOnly.optional(),
    hasAttachment: z.boolean().optional(),
  })
  .strict();
export type SearchMessageFilters = z.infer<typeof SearchMessageFilters>;

export const MessageSearchCursor = z
  .object({
    rank: z.number(),
    createdAt: z.iso.datetime(),
    id: MessageId,
  })
  .strict();
export type MessageSearchCursor = z.infer<typeof MessageSearchCursor>;

export const AuthorizedSearchResult = z
  .object({
    id: z.string().min(1).max(300),
    projectId: z.string().uuid().optional(),
    projectName: z.string().min(1).max(240).optional(),
    type: z.enum([
      "work_item",
      "spec",
      "spec_version",
      "comment",
      "code_reference",
      "coordination",
      "stand_in_activity",
      "message",
    ]),
    title: z.string().min(1).max(300),
    snippet: z.string().max(500),
    sourceRef: z.string().max(400),
    updatedAt: z.iso.datetime(),
    threadId: ThreadId.optional(),
    messageId: MessageId.optional(),
    sequence: z.number().int().positive().optional(),
    senderId: PrincipalId.optional(),
    createdAt: z.iso.datetime().optional(),
  })
  .strict();
export type AuthorizedSearchResult = z.infer<typeof AuthorizedSearchResult>;

export const MessageSearchPage = z
  .object({
    items: z.array(AuthorizedSearchResult),
    nextCursor: z.string().max(800).optional(),
  })
  .strict();
export type MessageSearchPage = z.infer<typeof MessageSearchPage>;

const FILTER_TOKEN =
  /(?:^|\s)(in|from|before|after|has):(?:"([^"]*)"|(\S+))/giu;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSearchQuery(raw: string): SearchMessageFilters {
  const source = raw.trim();
  const consumed: Array<{ start: number; end: number }> = [];
  const next: SearchMessageFilters = { text: "" };
  FILTER_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILTER_TOKEN.exec(source))) {
    const key = match[1]!.toLowerCase();
    const value = (match[2] ?? match[3] ?? "").trim();
    consumed.push({ start: match.index, end: match.index + match[0].length });
    if (!value) continue;
    if (key === "in") assignInFilter(next, value);
    else if (key === "from") assignFromFilter(next, value);
    else if (key === "before" && DateOnly.safeParse(value).success) {
      next.before = value;
    } else if (key === "after" && DateOnly.safeParse(value).success) {
      next.after = value;
    } else if (key === "has" && value.toLowerCase() === "attachment") {
      next.hasAttachment = true;
    }
  }
  let remaining = source;
  for (const span of consumed.toReversed()) {
    remaining = remaining.slice(0, span.start) + remaining.slice(span.end);
  }
  next.text = remaining.replace(/\s+/g, " ").trim().slice(0, 200);
  return SearchMessageFilters.parse(next);
}

export function mergeSearchFilters(
  parsed: SearchMessageFilters,
  explicit: {
    in?: string | undefined;
    from?: string | undefined;
    before?: string | undefined;
    after?: string | undefined;
    has?: "attachment" | undefined;
  },
): SearchMessageFilters {
  const next: SearchMessageFilters = { ...parsed };
  if (explicit.in !== undefined && explicit.in.trim()) {
    delete next.inThreadId;
    delete next.inTitle;
    assignInFilter(next, explicit.in.trim());
  }
  if (explicit.from !== undefined && explicit.from.trim()) {
    delete next.fromPrincipalId;
    delete next.fromDisplayName;
    assignFromFilter(next, explicit.from.trim());
  }
  if (explicit.before !== undefined) {
    if (DateOnly.safeParse(explicit.before).success) {
      next.before = explicit.before;
    }
  }
  if (explicit.after !== undefined) {
    if (DateOnly.safeParse(explicit.after).success) next.after = explicit.after;
  }
  if (explicit.has === "attachment") next.hasAttachment = true;
  return SearchMessageFilters.parse(next);
}

export function encodeMessageSearchCursor(cursor: MessageSearchCursor): string {
  return utf8ToBase64Url(JSON.stringify(cursor));
}

export function decodeMessageSearchCursor(
  raw: string,
): MessageSearchCursor | undefined {
  try {
    const parsed = JSON.parse(base64UrlToUtf8(raw)) as unknown;
    const result = MessageSearchCursor.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export function stripSearchFilter(
  raw: string,
  key: "in" | "from" | "before" | "after" | "has",
): string {
  return raw
    .replace(new RegExp(`(?:^|\\s)${key}:(?:"[^"]*"|\\S+)`, "giu"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function applySearchFilter(
  raw: string,
  key: "in" | "from" | "before" | "after" | "has",
  value: string,
): string {
  const quoted = value.includes(" ") ? `"${value}"` : value;
  const next = stripSearchFilter(raw, key);
  return `${next} ${key}:${quoted}`.trim();
}

export function tokenizeSearchText(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

export function highlightSearchSnippet(
  body: string,
  queryTokens: readonly string[],
  maxLength = 180,
): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const lower = normalized.toLocaleLowerCase();
  let start = 0;
  for (const token of queryTokens) {
    const index = lower.indexOf(token);
    if (index >= 0) {
      start = Math.max(0, index - 40);
      break;
    }
  }
  const slice = normalized.slice(start, start + maxLength);
  const prefix = start > 0 ? "…" : "";
  const suffix = start + maxLength < normalized.length ? "…" : "";
  return `${prefix}${wrapSearchTokens(slice, queryTokens)}${suffix}`.slice(
    0,
    500,
  );
}

export function wrapSearchTokens(
  value: string,
  queryTokens: readonly string[],
): string {
  const escaped = escapeHtml(value);
  if (queryTokens.length === 0) return escaped;
  const unique = [...new Set(queryTokens)].filter((token) => token.length > 0);
  if (unique.length === 0) return escaped;
  const pattern = new RegExp(`(${unique.map(escapeRegExp).join("|")})`, "giu");
  return escaped.replace(pattern, "<b>$1</b>");
}

function assignInFilter(filters: SearchMessageFilters, value: string): void {
  if (UUID_RE.test(value)) filters.inThreadId = value as ThreadId;
  else filters.inTitle = value.slice(0, 200);
}

function assignFromFilter(filters: SearchMessageFilters, value: string): void {
  if (UUID_RE.test(value)) filters.fromPrincipalId = value as PrincipalId;
  else filters.fromDisplayName = value.slice(0, 120);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function utf8ToBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlToUtf8(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const pad =
    padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
