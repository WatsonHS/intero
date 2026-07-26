import { describe, expect, it } from "vitest";

import { expectedDemoConfirmation, requireDemoTarget } from "./demo-data.js";

const databaseUrl = "postgres://intero:intero@127.0.0.1:5432/intero_demo";
const confirmation = "INTERO_DEMO_DISPOSABLE:127.0.0.1:5432/intero_demo";

describe("Demo data safety boundary", () => {
  it("accepts an explicitly confirmed loopback development database", () => {
    expect(
      requireDemoTarget({
        databaseUrl,
        confirmation,
        nodeEnv: "development",
        demoEnabled: "true",
      }),
    ).toMatchObject({
      databaseName: "intero_demo",
      host: "127.0.0.1",
      port: "5432",
      confirmation,
    });
    expect(expectedDemoConfirmation(databaseUrl)).toBe(confirmation);
  });

  it("accepts the IPv6 loopback form", () => {
    const ipv6Url = "postgres://intero:intero@[::1]:5432/intero_validation";
    const ipv6Confirmation =
      "INTERO_DEMO_DISPOSABLE:[::1]:5432/intero_validation";
    expect(
      requireDemoTarget({
        databaseUrl: ipv6Url,
        confirmation: ipv6Confirmation,
        nodeEnv: "test",
        demoEnabled: "true",
      }),
    ).toMatchObject({ host: "[::1]", confirmation: ipv6Confirmation });
  });

  it.each([
    {
      name: "production runtime",
      input: {
        databaseUrl,
        confirmation,
        nodeEnv: "production",
        demoEnabled: "true",
      },
    },
    {
      name: "missing explicit gate",
      input: {
        databaseUrl,
        confirmation,
        nodeEnv: "development",
      },
    },
    {
      name: "remote host",
      input: {
        databaseUrl: "postgres://intero:intero@db.internal:5432/intero_demo",
        confirmation: "INTERO_DEMO_DISPOSABLE:db.internal:5432/intero_demo",
        nodeEnv: "test",
        demoEnabled: "true",
      },
    },
    {
      name: "non-disposable database name",
      input: {
        databaseUrl: "postgres://intero:intero@localhost:5432/intero",
        confirmation: "INTERO_DEMO_DISPOSABLE:localhost:5432/intero",
        nodeEnv: "test",
        demoEnabled: "true",
      },
    },
    {
      name: "wrong target confirmation",
      input: {
        databaseUrl,
        confirmation: "INTERO_DEMO_DISPOSABLE:127.0.0.1:5432/other_demo",
        nodeEnv: "test",
        demoEnabled: "true",
      },
    },
  ])("rejects $name", ({ input }) => {
    expect(() => requireDemoTarget(input)).toThrow();
  });
});
