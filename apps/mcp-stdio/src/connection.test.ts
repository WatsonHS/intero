import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConnectionSettings } from "./connection";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("connection settings", () => {
  it("discovers a mode-agnostic daemon descriptor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "intero-connection-"));
    const descriptor = join(directory, "connection.json");
    await writeFile(
      descriptor,
      JSON.stringify({
        schemaVersion: 1,
        socketPath: "/tmp/interod-test.sock",
        authToken: "a-secure-local-token-for-tests",
      }),
    );
    delete process.env.INTERO_SOCKET;
    delete process.env.INTERO_LOCAL_TOKEN;
    process.env.INTERO_CONNECTION_FILE = descriptor;

    await expect(loadConnectionSettings()).resolves.toEqual({
      socketPath: "/tmp/interod-test.sock",
      authToken: "a-secure-local-token-for-tests",
    });
  });

  it("loads only the requested capability descriptor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "intero-capability-"));
    const descriptor = join(directory, "connection-mcp.json");
    await writeFile(
      descriptor,
      JSON.stringify({
        schemaVersion: 2,
        capability: "mcp",
        socketPath: "/tmp/interod-mcp.sock",
        authToken: "a-restricted-mcp-token-for-tests",
      }),
    );
    delete process.env.INTERO_SOCKET;
    delete process.env.INTERO_MCP_TOKEN;
    delete process.env.INTERO_CONNECTION_FILE;

    await expect(
      loadConnectionSettings({ role: "mcp", descriptorPath: descriptor }),
    ).resolves.toEqual({
      socketPath: "/tmp/interod-mcp.sock",
      authToken: "a-restricted-mcp-token-for-tests",
    });
    await expect(
      loadConnectionSettings({ role: "hook", descriptorPath: descriptor }),
    ).rejects.toThrow("invalid");
  });

  it("does not accept a legacy administrator descriptor for a restricted role", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "intero-legacy-capability-"),
    );
    const descriptor = join(directory, "connection.json");
    await writeFile(
      descriptor,
      JSON.stringify({
        schemaVersion: 1,
        socketPath: "/tmp/interod-test.sock",
        authToken: "a-legacy-administrator-token",
      }),
    );

    await expect(
      loadConnectionSettings({ role: "hook", descriptorPath: descriptor }),
    ).rejects.toThrow("invalid");
  });
});
