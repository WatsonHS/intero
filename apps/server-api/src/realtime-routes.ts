import type { PrincipalId, ThreadId } from "@intero/domain";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { z } from "zod";

import type { RequestAuth } from "./auth.js";
import type { PlatformStore } from "./platform-store.js";
import { PilotStoreError } from "./pilot-store.js";

export interface RealtimeRoutesOptions {
  store: PlatformStore;
  requestAuth: RequestAuth;
  publicUrl: string;
  tokenSecret: string;
  tokenTtlSeconds?: number;
}

export async function registerRealtimeRoutes(
  app: FastifyInstance,
  options: RealtimeRoutesOptions,
): Promise<void> {
  const signer = new RealtimeTokenSigner(
    options.tokenSecret,
    options.tokenTtlSeconds,
  );
  const endpoints = transportEndpoints(options.publicUrl);

  app.post("/v1/realtime/session", async (request) => {
    const principal = await options.requestAuth.resolve(request);
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

  app.post("/v1/realtime/subscriptions", async (request) => {
    const principal = await options.requestAuth.resolve(request);
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
