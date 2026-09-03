import type { PrincipalId } from "@intero/domain";
import { describe, expect, it } from "vitest";

import { InMemoryPresenceDirectory } from "./presence.js";

const ALEX = "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;

describe("in-memory presence directory", () => {
  it("marks a recent heartbeat online, idle connected as away, and stale as offline", () => {
    const directory = new InMemoryPresenceDirectory();
    const now = Date.parse("2026-09-03T12:00:00.000Z");
    expect(directory.heartbeat(ALEX, { now }).state).toBe("online");
    expect(
      directory.heartbeat(ALEX, { now: now + 4 * 60_000, active: false }).state,
    ).toBe("online");
    expect(
      directory.heartbeat(ALEX, { now: now + 5 * 60_000, active: false }).state,
    ).toBe("away");
    expect(directory.list([ALEX], now + 5 * 60_000 + 76_000)[0]?.state).toBe(
      "offline",
    );
  });
});
