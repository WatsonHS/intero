import type { PrincipalId } from "@intero/domain";
import { uuidv7 } from "@intero/domain";
import { decodeJwt, jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildTestApp } from "./test-app.js";
import { InMemoryPlatformStore } from "./store.js";

const ALEX = "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;
const PRIYA = "019b5ac0-7600-7000-8000-000000000004" as PrincipalId;
const TOKEN_SECRET = "production-realtime-test-secret-32-bytes";

describe("Realtime authorization routes", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    app = await buildTestApp({
      store: new InMemoryPlatformStore(),
      logger: false,
      realtimeConfig: {
        publicUrl: "https://intero.example.test",
        tokenSecret: TOKEN_SECRET,
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("issues a short-lived connection token limited to the personal channel", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/realtime/session",
      headers: auth(ALEX),
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      transports: [
        {
          transport: "websocket",
          endpoint: "wss://intero.example.test/connection/websocket",
        },
        {
          transport: "sse",
          endpoint: "https://intero.example.test/connection/sse",
        },
      ],
      emulationEndpoint: "https://intero.example.test/emulation",
    });
    const verified = await jwtVerify(
      response.json().token,
      new TextEncoder().encode(TOKEN_SECRET),
      { issuer: "intero-api", algorithms: ["HS256"] },
    );
    expect(verified.payload).toMatchObject({
      sub: ALEX,
      channels: [`intero:user:${ALEX}`],
    });
    expect(verified.payload.exp! - verified.payload.iat!).toBe(300);
  });

  it("authorizes a thread subscription at mint time and hides inaccessible threads", async () => {
    const threadId = uuidv7();
    await app.inject({
      method: "POST",
      url: "/v1/threads",
      headers: auth(ALEX),
      payload: {
        id: threadId,
        kind: "human_direct",
        title: "Authorized realtime",
        participantIds: [ALEX],
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        createdAt: new Date().toISOString(),
      },
    });

    const allowed = await app.inject({
      method: "POST",
      url: "/v1/realtime/subscriptions",
      headers: auth(ALEX),
      payload: { threadId },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({
      channel: `intero:thread:${threadId}`,
      accessVersion: 1,
    });
    expect(decodeJwt(allowed.json().token)).toMatchObject({
      sub: ALEX,
      channel: `intero:thread:${threadId}`,
    });

    const denied = await app.inject({
      method: "POST",
      url: "/v1/realtime/subscriptions",
      headers: auth(PRIYA),
      payload: { threadId },
    });
    const missing = await app.inject({
      method: "POST",
      url: "/v1/realtime/subscriptions",
      headers: auth(PRIYA),
      payload: { threadId: uuidv7() },
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json()).toMatchObject({ code: "THREAD_NOT_FOUND" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "THREAD_NOT_FOUND" });
  });

  it("never mints realtime credentials without authentication", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/realtime/session",
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });
});

function auth(principalId: PrincipalId) {
  return { "x-intero-dev-principal-id": principalId };
}
