import type {
  LinkPreview,
  MessageId,
  OrganizationId,
  ThreadId,
} from "@intero/domain";
import { extractHttpUrls } from "@intero/domain";
import type { WorkerUtils } from "graphile-worker";
import { Pool, type PoolClient } from "pg";

import type { PlatformStore } from "../../server-api/src/platform-store.js";
import {
  assertSafeUnfurlTarget,
  defaultDnsLookup,
  loadUnfurlDenyHosts,
  UNFURL_MAX_BODY_BYTES,
  UNFURL_MAX_REDIRECTS,
  UNFURL_TIMEOUT_MS,
  UNFURL_USER_AGENT,
  UnfurlBlockedError,
  UnfurlFailedError,
  type DnsLookupFn,
} from "./unfurl-guard.js";
import { parseLinkPreviewHtml } from "./unfurl-parse.js";

export const CONVERSATION_UNFURL_TASK = "conversation_unfurl";
export const CONVERSATION_UNFURL_DISPATCH_TASK = "conversation_unfurl_dispatch";
export const UNFURL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export interface UnfurlJobReference {
  schemaVersion: 1;
  organizationId: OrganizationId;
  threadId: ThreadId;
  messageId: MessageId;
}

export interface ClaimedUnfurlOutbox {
  operationId: string;
  payload: UnfurlJobReference;
  attempts: number;
}

export interface UnfurlJobRunner {
  enqueue(reference: UnfurlJobReference): Promise<void>;
}

export class GraphileUnfurlJobRunner implements UnfurlJobRunner {
  constructor(
    private readonly workerUtils: WorkerUtils,
    private readonly organizationId: OrganizationId,
  ) {}

  async enqueue(reference: UnfurlJobReference): Promise<void> {
    if (reference.organizationId !== this.organizationId) {
      throw new Error("cross_organization_unfurl_job_reference");
    }
    await this.workerUtils.addJob(CONVERSATION_UNFURL_TASK, reference, {
      jobKey: `conversation-unfurl:${reference.organizationId}:${reference.messageId}`,
      jobKeyMode: "unsafe_dedupe",
      maxAttempts: 5,
    });
  }
}

export class PostgresUnfurlJobRepository {
  constructor(
    private readonly pool: Pool,
    private readonly organizationId: OrganizationId,
  ) {}

  async claimOutbox(limit = 50): Promise<ClaimedUnfurlOutbox[]> {
    return this.write(async (client) => {
      const result = await client.query<{
        operation_id: string;
        payload: UnfurlJobReference;
        attempts: number;
      }>(
        `WITH candidates AS (
           SELECT operation_id
           FROM outbox
           WHERE organization_id = $1
             AND topic = 'conversation.unfurl.enqueue'
             AND completed_at IS NULL
             AND available_at <= now()
           ORDER BY available_at, operation_id
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE outbox
         SET attempts = outbox.attempts + 1,
             available_at = now() + interval '30 seconds'
         FROM candidates
         WHERE outbox.operation_id = candidates.operation_id
         RETURNING outbox.operation_id, outbox.payload, outbox.attempts`,
        [this.organizationId, Math.max(1, Math.min(limit, 100))],
      );
      return result.rows.map((row) => ({
        operationId: row.operation_id,
        payload: parseUnfurlReference(row.payload, this.organizationId),
        attempts: row.attempts,
      }));
    });
  }

  async markCompleted(operationId: string): Promise<void> {
    await this.write((client) =>
      client.query(
        `UPDATE outbox
         SET completed_at = now(), last_error_code = NULL
         WHERE operation_id = $1
           AND topic = 'conversation.unfurl.enqueue'`,
        [operationId],
      ),
    );
  }

  async markFailed(
    operationId: string,
    attempts: number,
    errorCode: string,
  ): Promise<void> {
    await this.write((client) =>
      client.query(
        `UPDATE outbox
         SET last_error_code = $2,
             available_at = now() + make_interval(
               secs => LEAST(300, GREATEST(1, power(2, LEAST($3, 8))::integer))
             )
         WHERE operation_id = $1
           AND topic = 'conversation.unfurl.enqueue'`,
        [operationId, errorCode.slice(0, 80), attempts],
      ),
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async write<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('intero.organization_id', $1, true)",
        [this.organizationId],
      );
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class UnfurlJobOutboxDispatcher {
  constructor(
    private readonly repository: PostgresUnfurlJobRepository,
    private readonly runner: UnfurlJobRunner,
  ) {}

  async dispatch(limit = 50): Promise<number> {
    const claimed = await this.repository.claimOutbox(limit);
    let firstError: Error | undefined;
    for (const entry of claimed) {
      try {
        await this.runner.enqueue(entry.payload);
        await this.repository.markCompleted(entry.operationId);
      } catch (error) {
        const normalized =
          error instanceof Error ? error : new Error("unfurl_enqueue_failed");
        await this.repository.markFailed(
          entry.operationId,
          entry.attempts,
          normalized.message.split(":")[0] ?? "unfurl_enqueue_failed",
        );
        firstError ??= normalized;
      }
    }
    if (firstError) throw firstError;
    return claimed.length;
  }
}

export interface UnfurlHandlerOptions {
  conversations: Pick<
    PlatformStore,
    | "getThread"
    | "getStoredThreadMessage"
    | "getLinkPreviews"
    | "putLinkPreview"
    | "attachMessagePreviewUrls"
  >;
  fetch?: typeof fetch;
  lookup?: DnsLookupFn;
  denyHosts?: ReadonlySet<string>;
  now?: () => Date;
}

export class UnfurlJobHandler {
  constructor(private readonly options: UnfurlHandlerOptions) {}

  async handle(reference: UnfurlJobReference): Promise<void> {
    const thread = await this.options.conversations.getThread(
      reference.threadId,
    );
    if (!thread || thread.thread.accessMode === "human_only_e2ee") return;
    const message = await this.options.conversations.getStoredThreadMessage(
      reference.threadId,
      reference.messageId,
    );
    if (!message?.serverReadable) return;
    const urls = message.previewUrls?.length
      ? message.previewUrls
      : extractHttpUrls(message.body);
    if (urls.length === 0) return;

    const now = this.options.now?.() ?? new Date();
    const cached = await this.options.conversations.getLinkPreviews(urls, now);
    const cachedByUrl = new Map(
      cached.map((preview) => [preview.url, preview]),
    );
    for (const url of urls) {
      if (cachedByUrl.has(url)) continue;
      const preview = await this.fetchPreview(url, now);
      await this.options.conversations.putLinkPreview(preview);
    }
    await this.options.conversations.attachMessagePreviewUrls(
      reference.threadId,
      reference.messageId,
      urls,
    );
  }

  private async fetchPreview(url: string, now: Date): Promise<LinkPreview> {
    const expiresAt = new Date(
      now.getTime() + UNFURL_CACHE_TTL_MS,
    ).toISOString();
    const fetchedAt = now.toISOString();
    try {
      const html = await fetchUnfurlHtml(url, {
        fetch: this.options.fetch ?? fetch,
        lookup: this.options.lookup ?? defaultDnsLookup,
        denyHosts: this.options.denyHosts ?? loadUnfurlDenyHosts(),
      });
      const parsed = parseLinkPreviewHtml(html, new URL(url));
      return {
        url,
        status: "ok",
        ...parsed,
        fetchedAt,
        expiresAt,
      };
    } catch (error) {
      if (error instanceof UnfurlBlockedError) {
        return { url, status: "blocked", fetchedAt, expiresAt };
      }
      if (error instanceof UnfurlFailedError) {
        return { url, status: "failed", fetchedAt, expiresAt };
      }
      throw error;
    }
  }
}

export async function fetchUnfurlHtml(
  raw: string,
  options: {
    fetch: typeof fetch;
    lookup: DnsLookupFn;
    denyHosts: ReadonlySet<string>;
  },
): Promise<string> {
  let current = raw;
  for (let hop = 0; hop <= UNFURL_MAX_REDIRECTS; hop += 1) {
    const url = await assertSafeUnfurlTarget(current, options);
    const response = await options.fetch(url.href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(UNFURL_TIMEOUT_MS),
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": UNFURL_USER_AGENT,
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new UnfurlBlockedError("redirect_missing");
      if (hop === UNFURL_MAX_REDIRECTS) {
        throw new UnfurlBlockedError("redirect_limit");
      }
      current = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      throw new UnfurlFailedError("unfurl_http_failed");
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      throw new UnfurlFailedError("unfurl_not_html");
    }
    return readCappedBody(response);
  }
  throw new UnfurlBlockedError("redirect_limit");
}

async function readCappedBody(response: Response): Promise<string> {
  if (!response.body) {
    return (await response.text()).slice(0, UNFURL_MAX_BODY_BYTES);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < UNFURL_MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const remaining = UNFURL_MAX_BODY_BYTES - received;
    chunks.push(
      value.byteLength > remaining ? value.slice(0, remaining) : value,
    );
    received += Math.min(value.byteLength, remaining);
    if (value.byteLength > remaining) break;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
    "utf8",
  );
}

function parseUnfurlReference(
  payload: UnfurlJobReference,
  organizationId: OrganizationId,
): UnfurlJobReference {
  if (
    payload?.schemaVersion !== 1 ||
    payload.organizationId !== organizationId ||
    typeof payload.threadId !== "string" ||
    typeof payload.messageId !== "string"
  ) {
    throw new Error("invalid_unfurl_job_reference");
  }
  return payload;
}
