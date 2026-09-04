import type { PrincipalId } from "@intero/domain";
import { uuidv7 } from "@intero/domain";
import { decodeJwt } from "jose";
import { TokenVerifier } from "livekit-server-sdk";
import { afterEach, describe, expect, it } from "vitest";

import {
  CentrifugoCallEventPublisher,
  LiveKitCallTokenIssuer,
} from "./call-routes.js";
import { InMemoryPlatformStore } from "./store.js";
import { buildTestApp } from "./test-app.js";

const ALEX = "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;
const PRIYA = "019b5ac0-7600-7000-8000-000000000004" as PrincipalId;

describe("call routes", () => {
  const apps: Array<Awaited<ReturnType<typeof buildTestApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("mints a LiveKit credential only for a human thread participant", async () => {
    const issued: unknown[] = [];
    const app = await buildTestApp({
      store: new InMemoryPlatformStore(),
      logger: false,
      callTokenIssuer: {
        async issue(input) {
          issued.push(input);
          return {
            serverUrl: "wss://calls.example.test",
            roomName: `intero-call-${input.callId}`,
            token: "livekit-token",
          };
        },
      },
      callEventPublisher: { async publish() {} },
    });
    apps.push(app);
    const threadId = await createThread(app, [ALEX]);
    const callId = uuidv7();

    const accepted = await app.inject({
      method: "POST",
      url: "/v1/calls/token",
      headers: auth(ALEX),
      payload: { threadId, callId },
    });
    const hidden = await app.inject({
      method: "POST",
      url: "/v1/calls/token",
      headers: auth(PRIYA),
      payload: { threadId, callId },
    });

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({
      serverUrl: "wss://calls.example.test",
      roomName: `intero-call-${callId}`,
      token: "livekit-token",
    });
    expect(issued).toEqual([
      {
        callId,
        threadId,
        principal: { id: ALEX, displayName: "Intero User" },
      },
    ]);
    expect(hidden.statusCode).toBe(404);
  });

  it("rejects unauthenticated token requests", async () => {
    const app = await buildTestApp({
      store: new InMemoryPlatformStore(),
      logger: false,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/calls/token",
      payload: { threadId: uuidv7(), callId: uuidv7() },
    });

    expect(response.statusCode).toBe(401);
  });

  it("publishes invitations to the thread and each other human participant", async () => {
    const published: Array<{
      channel: string;
      event: Record<string, unknown>;
    }> = [];
    const app = await buildTestApp({
      store: new InMemoryPlatformStore(),
      logger: false,
      callTokenIssuer: {
        async issue() {
          throw new Error("not used");
        },
      },
      callEventPublisher: {
        async publish(channel, event) {
          published.push({ channel, event });
        },
      },
    });
    apps.push(app);
    const threadId = await createThread(app, [ALEX, PRIYA]);
    const callId = uuidv7();
    const eventId = uuidv7();

    const response = await app.inject({
      method: "POST",
      url: "/v1/calls/events",
      headers: auth(ALEX),
      payload: {
        eventId,
        threadId,
        callId,
        senderId: PRIYA,
        event: { kind: "invite", mode: "video" },
      },
    });

    expect(response.statusCode).toBe(400);

    const accepted = await app.inject({
      method: "POST",
      url: "/v1/calls/events",
      headers: auth(ALEX),
      payload: {
        eventId,
        threadId,
        callId,
        event: { kind: "invite", mode: "video" },
      },
    });
    expect(accepted.statusCode).toBe(202);
    expect(published.map(({ channel }) => channel)).toEqual([
      `intero:thread:${threadId}`,
      `intero:user:${PRIYA}`,
    ]);
    expect(published[0]?.event).toMatchObject({
      schemaVersion: 1,
      type: "conversation.call.event",
      eventId,
      threadId,
      callId,
      senderId: ALEX,
      event: { kind: "invite", mode: "video" },
    });
  });

  it("publishes decline onto the caller's personal channel", async () => {
    const published: Array<{
      channel: string;
      event: Record<string, unknown>;
    }> = [];
    const app = await buildTestApp({
      store: new InMemoryPlatformStore(),
      logger: false,
      callTokenIssuer: {
        async issue() {
          throw new Error("not used");
        },
      },
      callEventPublisher: {
        async publish(channel, event) {
          published.push({ channel, event });
        },
      },
    });
    apps.push(app);
    const threadId = await createThread(app, [ALEX, PRIYA]);
    const callId = uuidv7();
    const eventId = uuidv7();

    const accepted = await app.inject({
      method: "POST",
      url: "/v1/calls/events",
      headers: auth(PRIYA),
      payload: {
        eventId,
        threadId,
        callId,
        event: { kind: "decline" },
      },
    });

    expect(accepted.statusCode).toBe(202);
    expect(published.map(({ channel }) => channel)).toEqual([
      `intero:thread:${threadId}`,
      `intero:user:${ALEX}`,
    ]);
    expect(published[0]?.event).toMatchObject({
      type: "conversation.call.event",
      senderId: PRIYA,
      event: { kind: "decline" },
    });
  });
});

describe("LiveKit call adapters", () => {
  it("creates a short-lived room-scoped participant token", async () => {
    const issuer = new LiveKitCallTokenIssuer(
      "wss://calls.example.test",
      "api-key",
      "api-secret-with-enough-entropy",
    );
    const threadId = uuidv7() as never;
    const callId = uuidv7();

    const result = await issuer.issue({
      callId,
      threadId,
      principal: { id: ALEX, displayName: "Alex" },
    });
    const claims = await new TokenVerifier(
      "api-key",
      "api-secret-with-enough-entropy",
    ).verify(result.token);

    expect(result).toMatchObject({
      serverUrl: "wss://calls.example.test",
      roomName: `intero-call-${callId}`,
    });
    expect(claims).toMatchObject({
      sub: ALEX,
      name: "Alex",
      metadata: JSON.stringify({ threadId }),
      video: {
        room: `intero-call-${callId}`,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
      },
    });
    const rawClaims = decodeJwt(result.token);
    expect(rawClaims.exp! - rawClaims.nbf!).toBe(600);
  });

  it("publishes call events through the Centrifugo API", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const publisher = new CentrifugoCallEventPublisher(
      "https://realtime.example.test",
      "private-api-key",
      (async (input, init) => {
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(JSON.stringify({ result: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    );

    await publisher.publish("intero:thread:test", {
      type: "conversation.call.event",
    });

    expect(requests).toEqual([
      {
        url: "https://realtime.example.test/api/publish",
        body: {
          channel: "intero:thread:test",
          data: { type: "conversation.call.event" },
        },
      },
    ]);
  });
});

async function createThread(
  app: Awaited<ReturnType<typeof buildTestApp>>,
  participantIds: PrincipalId[],
) {
  const threadId = uuidv7();
  const response = await app.inject({
    method: "POST",
    url: "/v1/threads",
    headers: auth(ALEX),
    payload: {
      id: threadId,
      kind: "human_direct",
      title: "Call",
      participantIds,
      standInIds: [],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      createdAt: new Date().toISOString(),
    },
  });
  expect(response.statusCode).toBe(201);
  return threadId;
}

function auth(principalId: PrincipalId) {
  return { "x-intero-dev-principal-id": principalId };
}
