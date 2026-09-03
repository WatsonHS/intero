import type { PrincipalId } from "@intero/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildTestApp } from "./test-app.js";
import { InMemoryPlatformStore } from "./store.js";

const ALEX = "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;
const PRIYA = "019b5ac0-7600-7000-8000-000000000004" as PrincipalId;

const SUBSCRIPTION = {
  endpoint: "https://push.example/subscription/alex",
  keys: {
    p256dh:
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXgl1qOQFjGDn05CvjCJUjq5i4j1qAwozS",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
};

function auth(principalId: PrincipalId) {
  return { "x-intero-dev-principal-id": principalId };
}

describe("Web Push subscription routes", () => {
  let store: InMemoryPlatformStore;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    store = new InMemoryPlatformStore();
    app = await buildTestApp({
      store,
      logger: false,
      webPushPublicKey: "B".repeat(88),
      pilotIdentities: [
        { id: ALEX, displayName: "Alex Rivera", kind: "human" },
        { id: PRIYA, displayName: "Priya Shah", kind: "human" },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("requires authentication for config and subscription mutations", async () => {
    const config = await app.inject({
      method: "GET",
      url: "/v1/config/web-push",
    });
    expect(config.statusCode).toBe(401);

    const created = await app.inject({
      method: "POST",
      url: "/v1/me/push-subscriptions",
      payload: SUBSCRIPTION,
    });
    expect(created.statusCode).toBe(401);

    const removed = await app.inject({
      method: "DELETE",
      url: "/v1/me/push-subscriptions",
      payload: { endpoint: SUBSCRIPTION.endpoint },
    });
    expect(removed.statusCode).toBe(401);
  });

  it("stores a subscription for the authenticated principal and hides it from others", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/me/push-subscriptions",
      headers: auth(ALEX),
      payload: SUBSCRIPTION,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().subscription).toMatchObject({
      principalId: ALEX,
      endpoint: SUBSCRIPTION.endpoint,
    });
    expect(store.listWebPushSubscriptions(ALEX)).toHaveLength(1);
    expect(store.listWebPushSubscriptions(PRIYA)).toHaveLength(0);

    const stolen = await app.inject({
      method: "DELETE",
      url: "/v1/me/push-subscriptions",
      headers: auth(PRIYA),
      payload: { endpoint: SUBSCRIPTION.endpoint },
    });
    expect(stolen.statusCode).toBe(404);
    expect(store.listWebPushSubscriptions(ALEX)).toHaveLength(1);

    const removed = await app.inject({
      method: "DELETE",
      url: "/v1/me/push-subscriptions",
      headers: auth(ALEX),
      payload: { endpoint: SUBSCRIPTION.endpoint },
    });
    expect(removed.statusCode).toBe(200);
    expect(store.listWebPushSubscriptions(ALEX)).toHaveLength(0);
  });

  it("returns the VAPID public key only when Web Push is configured", async () => {
    const enabled = await app.inject({
      method: "GET",
      url: "/v1/config/web-push",
      headers: auth(ALEX),
    });
    expect(enabled.json()).toEqual({
      enabled: true,
      publicKey: "B".repeat(88),
    });

    await app.close();
    app = await buildTestApp({
      store,
      logger: false,
      pilotIdentities: [
        { id: ALEX, displayName: "Alex Rivera", kind: "human" },
      ],
    });
    const disabled = await app.inject({
      method: "GET",
      url: "/v1/config/web-push",
      headers: auth(ALEX),
    });
    expect(disabled.json()).toEqual({ enabled: false });
  });
});
