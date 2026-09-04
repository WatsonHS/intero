import type { PrincipalId } from "@intero/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildTestApp } from "./test-app.js";
import { InMemoryPlatformStore } from "./store.js";

const ALEX = "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;

function auth(principalId: PrincipalId) {
  return { "x-intero-dev-principal-id": principalId };
}

describe("GET/PUT /v1/me/preferences", () => {
  let store: InMemoryPlatformStore;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    store = new InMemoryPlatformStore();
    app = await buildTestApp({
      store,
      logger: false,
      pilotIdentities: [
        { id: ALEX, displayName: "Alex Rivera", kind: "human" },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("requires authentication", async () => {
    const read = await app.inject({
      method: "GET",
      url: "/v1/me/preferences",
    });
    expect(read.statusCode).toBe(401);

    const write = await app.inject({
      method: "PUT",
      url: "/v1/me/preferences",
      payload: { locale: "en-US" },
    });
    expect(write.statusCode).toBe(401);
  });

  it("round-trips locale through the in-memory principal directory", async () => {
    const initial = await app.inject({
      method: "GET",
      url: "/v1/me/preferences",
      headers: auth(ALEX),
    });
    expect(initial.statusCode).toBe(200);
    const initialBody = initial.json() as { locale?: "zh-CN" | "en-US" };
    expect(["zh-CN", "en-US"]).toContain(initialBody.locale);

    const written = await app.inject({
      method: "PUT",
      url: "/v1/me/preferences",
      headers: auth(ALEX),
      payload: { locale: "en-US" },
    });
    expect(written.statusCode).toBe(200);
    expect(written.json()).toEqual({ locale: "en-US" });

    const again = await app.inject({
      method: "GET",
      url: "/v1/me/preferences",
      headers: auth(ALEX),
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ locale: "en-US" });

    const chinese = await app.inject({
      method: "PUT",
      url: "/v1/me/preferences",
      headers: auth(ALEX),
      payload: { locale: "zh-CN" },
    });
    expect(chinese.json()).toEqual({ locale: "zh-CN" });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/me/preferences",
          headers: auth(ALEX),
        })
      ).json(),
    ).toEqual({ locale: "zh-CN" });
  });

  it("rejects an unknown locale", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/v1/me/preferences",
      headers: auth(ALEX),
      payload: { locale: "fr-FR" },
    });
    expect(response.statusCode).toBe(400);
  });
});
