import { describe, expect, it } from "vitest";

import {
  AUTHENTICATION_REQUIRED_EVENT,
  developmentIdentityToolEnabled,
  handleAuthenticationFailure,
  PILOT_IDENTITY_STORAGE_KEY,
  PILOT_PROJECT_STORAGE_KEY,
  PILOT_TEAM_STORAGE_KEY,
  resolveAuthenticationSurface,
} from "./auth-state.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("authentication failure state", () => {
  it("clears the complete effective scope and requests login on a 401", () => {
    const storage = new MemoryStorage();
    storage.setItem(PILOT_IDENTITY_STORAGE_KEY, "principal");
    storage.setItem(PILOT_PROJECT_STORAGE_KEY, "project");
    storage.setItem(PILOT_TEAM_STORAGE_KEY, "team");
    const eventTarget = new EventTarget();
    let events = 0;
    eventTarget.addEventListener(AUTHENTICATION_REQUIRED_EVENT, () => {
      events += 1;
    });

    expect(handleAuthenticationFailure(401, { storage, eventTarget })).toBe(
      true,
    );
    expect(storage.getItem(PILOT_IDENTITY_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(PILOT_PROJECT_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(PILOT_TEAM_STORAGE_KEY)).toBeNull();
    expect(events).toBe(1);
  });

  it("leaves the active scope in place for non-authentication failures", () => {
    const storage = new MemoryStorage();
    storage.setItem(PILOT_IDENTITY_STORAGE_KEY, "principal");
    const eventTarget = new EventTarget();
    let events = 0;
    eventTarget.addEventListener(AUTHENTICATION_REQUIRED_EVENT, () => {
      events += 1;
    });

    expect(handleAuthenticationFailure(503, { storage, eventTarget })).toBe(
      false,
    );
    expect(storage.getItem(PILOT_IDENTITY_STORAGE_KEY)).toBe("principal");
    expect(events).toBe(0);
  });
});

describe("authentication surface routing", () => {
  it("routes an invalid session directly to real login", () => {
    expect(
      resolveAuthenticationSurface({
        pilotEnabled: true,
        bootstrapPending: false,
        authMode: "session",
        effectiveIdentityId: undefined,
        authenticationRequired: true,
      }),
    ).toBe("login");
  });

  it("routes an invalid development identity directly to real login", () => {
    expect(
      resolveAuthenticationSurface({
        pilotEnabled: true,
        bootstrapPending: false,
        authMode: "development_identity",
        effectiveIdentityId: undefined,
        authenticationRequired: true,
      }),
    ).toBe("login");
  });

  it("keeps an authenticated identity in the application", () => {
    expect(
      resolveAuthenticationSurface({
        pilotEnabled: true,
        bootstrapPending: false,
        authMode: "development_identity",
        effectiveIdentityId: "principal",
        authenticationRequired: false,
      }),
    ).toBe("application");
  });
});

describe("development identity tooling boundary", () => {
  it("requires both a development build and the explicit tool URL", () => {
    expect(
      developmentIdentityToolEnabled({
        developmentBuild: true,
        locationHref: "http://localhost/?interoDevIdentity=1",
        authenticationRequired: false,
      }),
    ).toBe(true);
    expect(
      developmentIdentityToolEnabled({
        developmentBuild: false,
        locationHref: "http://localhost/?interoDevIdentity=1",
        authenticationRequired: false,
      }),
    ).toBe(false);
  });

  it("never shows the development tool after a 401", () => {
    expect(
      developmentIdentityToolEnabled({
        developmentBuild: true,
        locationHref: "http://localhost/?interoDevIdentity=1",
        authenticationRequired: true,
      }),
    ).toBe(false);
  });
});
