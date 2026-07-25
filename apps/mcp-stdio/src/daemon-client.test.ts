import { describe, expect, it } from "vitest";

import {
  DaemonRpcError,
  type DaemonClient,
  ReloadingDaemonClient,
} from "./daemon-client.js";

class StubDaemonClient implements DaemonClient {
  calls = 0;

  constructor(
    private readonly result: unknown,
    private readonly error?: Error,
  ) {}

  async call(): Promise<unknown> {
    this.calls += 1;
    if (this.error) {
      throw this.error;
    }
    return this.result;
  }
}

describe("ReloadingDaemonClient", () => {
  it("reloads the connection and retries once after authentication rotates", async () => {
    const expired = new StubDaemonClient(
      undefined,
      new DaemonRpcError(-32001, "Local authentication failed"),
    );
    const current = new StubDaemonClient({ accepted: true });
    const clients = [expired, current];
    let loads = 0;
    const daemon = new ReloadingDaemonClient(async () => clients[loads++]!);

    await expect(
      daemon.call("representative.report_checkpoint", {}),
    ).resolves.toEqual({ accepted: true });
    expect(loads).toBe(2);
    expect(expired.calls).toBe(1);
    expect(current.calls).toBe(1);
  });

  it("does not retry non-authentication failures", async () => {
    const rejected = new StubDaemonClient(
      undefined,
      new DaemonRpcError(-32004, "Workspace is not enrolled"),
    );
    let loads = 0;
    const daemon = new ReloadingDaemonClient(async () => {
      loads += 1;
      return rejected;
    });

    await expect(
      daemon.call("integration.current_context", {}),
    ).rejects.toThrow("Workspace is not enrolled");
    expect(loads).toBe(1);
    expect(rejected.calls).toBe(1);
  });

  it("stops after one retry when the refreshed credentials are also rejected", async () => {
    const rejected = new DaemonRpcError(-32001, "Local authentication failed");
    const first = new StubDaemonClient(undefined, rejected);
    const second = new StubDaemonClient(undefined, rejected);
    const clients = [first, second];
    let loads = 0;
    const daemon = new ReloadingDaemonClient(async () => clients[loads++]!);

    await expect(
      daemon.call("representative.report_checkpoint", {}),
    ).rejects.toThrow("Local authentication failed");
    expect(loads).toBe(2);
    expect(first.calls).toBe(1);
    expect(second.calls).toBe(1);
  });
});
