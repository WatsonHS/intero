import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { mountAuth, type InteroAuth } from "./auth.js";

describe("Fastify Better Auth boundary", () => {
  it("replaces a client-supplied rate-limit identity with the socket address", async () => {
    const receivedAddresses: Array<string | null> = [];
    const auth = {
      handler: async (request: Request) => {
        receivedAddresses.push(request.headers.get("x-intero-client-ip"));
        return Response.json({ ok: true });
      },
    } as unknown as InteroAuth;
    const app = Fastify();
    mountAuth(app, auth);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      remoteAddress: "203.0.113.10",
      headers: {
        "x-intero-client-ip": "198.51.100.99",
        "x-forwarded-for": "198.51.100.98",
      },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(receivedAddresses).toEqual(["203.0.113.10"]);
  });
});
