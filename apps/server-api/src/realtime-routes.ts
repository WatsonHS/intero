import type { PrincipalId, ThreadId } from "@intero/domain";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";

import type { RequestAuth } from "./auth.js";
import type { PlatformStore } from "./platform-store.js";
import { PilotStoreError } from "./pilot-store.js";

export interface RealtimeRoutesOptions {
  store: PlatformStore;
  requestAuth: RequestAuth;
  publicUrl: string;
  publicOrigins?: string[];
  tokenSecret: string;
  tokenTtlSeconds?: number;
  rateLimiter?: RealtimeRateLimiter;
  rateLimitDatabase?: Pool;
  organizationId?: string;
}

export async function registerRealtimeRoutes(
  app: FastifyInstance,
  options: RealtimeRoutesOptions,
): Promise<void> {
  const signer = new RealtimeTokenSigner(
    options.tokenSecret,
    options.tokenTtlSeconds,
  );
  const rateLimiter =
    options.rateLimiter ??
    (options.rateLimitDatabase && options.organizationId
      ? new PostgresRealtimeRateLimiter(
          options.rateLimitDatabase,
          options.organizationId,
        )
      : new InMemoryRealtimeRateLimiter());

  app.post("/v1/realtime/session", async (request, reply) => {
    const principal = await options.requestAuth.resolve(request);
    const endpoints = transportEndpoints(
      realtimePublicUrlForOrigin(
        options.publicUrl,
        request.headers.origin,
        options.publicOrigins,
      ),
    );
    const retryAfter = await rateLimiter.consume(
      `session:${principal!.id}`,
      60,
      60_000,
    );
    if (retryAfter !== undefined) {
      return reply.header("retry-after", String(retryAfter)).status(429).send({
        code: "REALTIME_RATE_LIMITED",
        message: "Realtime session requests are temporarily rate limited.",
      });
    }
    const issued = await signer.connection(principal!.id);
    return {
      token: issued.token,
      expiresAt: issued.expiresAt,
      transports: [
        { transport: "websocket" as const, endpoint: endpoints.websocket },
        { transport: "sse" as const, endpoint: endpoints.sse },
      ],
      emulationEndpoint: endpoints.emulation,
    };
  });

  app.post("/v1/realtime/subscriptions", async (request, reply) => {
    const principal = await options.requestAuth.resolve(request);
    const retryAfter = await rateLimiter.consume(
      `subscription:${principal!.id}`,
      120,
      60_000,
    );
    if (retryAfter !== undefined) {
      return reply.header("retry-after", String(retryAfter)).status(429).send({
        code: "REALTIME_RATE_LIMITED",
        message: "Realtime subscription requests are temporarily rate limited.",
      });
    }
    const input = z.object({ threadId: z.uuid() }).strict().parse(request.body);
    const threadId = input.threadId as ThreadId;
    const accessVersion = await options.store.getThreadAccessVersion(
      threadId,
      principal!.id,
    );
    if (accessVersion === undefined) {
      throw new PilotStoreError(
        "THREAD_NOT_FOUND",
        404,
        "Thread was not found.",
      );
    }
    const channel = threadChannel(threadId);
    const issued = await signer.subscription(principal!.id, channel);
    return {
      channel,
      token: issued.token,
      expiresAt: issued.expiresAt,
      accessVersion,
    };
  });
}

function realtimePublicUrlForOrigin(
  configuredPublicUrl: string,
  requestOrigin: string | undefined,
  publicOrigins: string[] | undefined,
): string {
  if (!requestOrigin || !publicOrigins?.includes(requestOrigin)) {
    return configuredPublicUrl;
  }
  try {
    return new URL(requestOrigin).origin;
  } catch {
    return configuredPublicUrl;
  }
}

export interface RealtimeRateLimiter {
  consume(
    key: string,
    limit: number,
    windowMs: number,
    now?: number,
  ): Promise<number | undefined>;
}

export class InMemoryRealtimeRateLimiter implements RealtimeRateLimiter {
  private readonly buckets = new Map<
    string,
    { attempts: number; windowStartedAt: number }
  >();

  async consume(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): Promise<number | undefined> {
    const current = this.buckets.get(key);
    if (!current || current.windowStartedAt + windowMs <= now) {
      this.buckets.set(key, { attempts: 1, windowStartedAt: now });
      return undefined;
    }
    current.attempts += 1;
    if (current.attempts <= limit) return undefined;
    return Math.max(
      1,
      Math.ceil((current.windowStartedAt + windowMs - now) / 1_000),
    );
  }
}

export class PostgresRealtimeRateLimiter implements RealtimeRateLimiter {
  constructor(
    private readonly database: Pool,
    private readonly organizationId: string,
  ) {}

  async consume(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): Promise<number | undefined> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('intero.organization_id',$1,true)",
        [this.organizationId],
      );
      const result = await client.query<{
        attempts: number;
        window_started_at: Date;
      }>(
        `INSERT INTO realtime_rate_limits
          (organization_id,key_hash,window_started_at,attempts)
         VALUES ($1,$2,to_timestamp($3 / 1000.0),1)
         ON CONFLICT (organization_id,key_hash) DO UPDATE SET
           attempts = CASE
             WHEN realtime_rate_limits.window_started_at
                    <= to_timestamp($3 / 1000.0) - ($4::double precision * interval '1 millisecond')
               THEN 1
             ELSE realtime_rate_limits.attempts + 1
           END,
           window_started_at = CASE
             WHEN realtime_rate_limits.window_started_at
                    <= to_timestamp($3 / 1000.0) - ($4::double precision * interval '1 millisecond')
               THEN to_timestamp($3 / 1000.0)
             ELSE realtime_rate_limits.window_started_at
           END,
           updated_at = now()
         RETURNING attempts,window_started_at`,
        [
          this.organizationId,
          createHash("sha256").update(key).digest("hex"),
          now,
          windowMs,
        ],
      );
      await client.query("COMMIT");
      const bucket = result.rows[0]!;
      if (bucket.attempts <= limit) return undefined;
      return Math.max(
        1,
        Math.ceil(
          (bucket.window_started_at.getTime() + windowMs - now) / 1_000,
        ),
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export class CentrifugoAccessRevoker {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async revoke(principalId: PrincipalId, threadId: ThreadId): Promise<void> {
    const response = await this.fetcher(
      new URL("/api/unsubscribe", this.apiUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "x-centrifugo-error-mode": "transport",
        },
        body: JSON.stringify({
          user: principalId,
          channel: threadChannel(threadId),
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`centrifugo_unsubscribe_${response.status}`);
    }
    const body = (await response.json()) as { error?: { code?: number } };
    if (body.error) {
      throw new Error(`centrifugo_unsubscribe_${body.error.code ?? "unknown"}`);
    }
  }
}

export class RealtimeTokenSigner {
  readonly #key: Uint8Array;
  readonly #ttlSeconds: number;

  constructor(secret: string, ttlSeconds = 300) {
    const encodedSecret = new TextEncoder().encode(secret);
    if (encodedSecret.byteLength < 32) {
      throw new Error("Realtime token secret must contain at least 32 bytes.");
    }
    this.#key = encodedSecret;
    this.#ttlSeconds = Math.max(60, Math.min(ttlSeconds, 900));
  }

  connection(principalId: PrincipalId) {
    return this.sign(principalId, {
      channels: [userChannel(principalId)],
    });
  }

  subscription(principalId: PrincipalId, channel: string) {
    return this.sign(principalId, { channel });
  }

  private async sign(
    principalId: PrincipalId,
    claims: Record<string, unknown>,
  ): Promise<{ token: string; expiresAt: string }> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = now + this.#ttlSeconds;
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(principalId)
      .setIssuer("intero-api")
      .setIssuedAt(now)
      .setExpirationTime(expiresAtSeconds)
      .sign(this.#key);
    return {
      token,
      expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
    };
  }
}

export function threadChannel(threadId: ThreadId): string {
  return `intero:thread:${threadId}`;
}

export function userChannel(principalId: PrincipalId): string {
  return `intero:user:${principalId}`;
}

function transportEndpoints(publicUrl: string): {
  websocket: string;
  sse: string;
  emulation: string;
} {
  const base = new URL(publicUrl);
  const websocket = new URL(base);
  websocket.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  websocket.pathname = "/connection/websocket";
  websocket.search = "";
  websocket.hash = "";

  const sse = new URL(base);
  sse.pathname = "/connection/sse";
  sse.search = "";
  sse.hash = "";

  const emulation = new URL(base);
  emulation.pathname = "/emulation";
  emulation.search = "";
  emulation.hash = "";
  return {
    websocket: websocket.toString(),
    sse: sse.toString(),
    emulation: emulation.toString(),
  };
}
