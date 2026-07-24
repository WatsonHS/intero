import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DaemonClient {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ConnectionDescriptor {
  schemaVersion: 1;
  socketPath: string;
  authToken: string;
}

export class SocketDaemonClient implements DaemonClient {
  #id = 0;

  constructor(
    private readonly socketPath: string,
    private readonly authToken: string,
  ) {}

  async call(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const id = ++this.#id;
    const payload = Buffer.from(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
        auth_token: this.authToken,
      }),
    );
    if (payload.length > 2 * 1024 * 1024) {
      throw new Error("IPC request exceeds the 2 MiB safety limit.");
    }
    const frame = Buffer.allocUnsafe(payload.length + 4);
    frame.writeUInt32BE(payload.length, 0);
    payload.copy(frame, 4);

    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      const chunks: Buffer[] = [];
      let expectedLength: number | undefined;
      let settled = false;
      const settle = (operation: () => void) => {
        if (settled) return;
        settled = true;
        operation();
      };
      socket.once("connect", () => socket.write(frame));
      socket.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        const combined = Buffer.concat(chunks);
        if (expectedLength === undefined && combined.length >= 4) {
          expectedLength = combined.readUInt32BE(0);
          if (expectedLength > 2 * 1024 * 1024) {
            socket.destroy(
              new Error("IPC response exceeds the 2 MiB safety limit."),
            );
            return;
          }
        }
        if (
          expectedLength !== undefined &&
          combined.length >= expectedLength + 4
        ) {
          socket.end();
          try {
            const response = JSON.parse(
              combined.subarray(4, expectedLength + 4).toString("utf8"),
            ) as JsonRpcResponse;
            if (response.id !== id) {
              settle(() =>
                reject(
                  new Error("IPC response correlation ID does not match."),
                ),
              );
            } else if (response.error) {
              settle(() => reject(new Error(response.error!.message)));
            } else {
              settle(() => resolve(response.result));
            }
          } catch (error) {
            settle(() => reject(error));
          }
        }
      });
      socket.once("error", (error) => settle(() => reject(error)));
      socket.once("close", () => {
        if (!settled)
          settle(() =>
            reject(new Error("IPC connection closed before a response.")),
          );
      });
    });
  }
}

export async function loadConnectionSettings(): Promise<{
  socketPath: string;
  authToken: string;
}> {
  const environmentSocket = process.env.INTERO_SOCKET;
  const environmentToken = process.env.INTERO_LOCAL_TOKEN;
  if (environmentSocket && environmentToken) {
    return { socketPath: environmentSocket, authToken: environmentToken };
  }
  const descriptorPath =
    process.env.INTERO_CONNECTION_FILE ??
    join(
      process.env.INTERO_DATA_DIR ?? join(homedir(), ".intero"),
      "connection.json",
    );
  let descriptor: ConnectionDescriptor;
  try {
    descriptor = JSON.parse(
      await readFile(descriptorPath, "utf8"),
    ) as ConnectionDescriptor;
  } catch {
    throw new Error(
      `Intero connection descriptor is unavailable at ${descriptorPath}. Start interod first.`,
    );
  }
  if (
    descriptor.schemaVersion !== 1 ||
    typeof descriptor.socketPath !== "string" ||
    typeof descriptor.authToken !== "string" ||
    descriptor.authToken.length < 20
  ) {
    throw new Error("Intero connection descriptor is invalid.");
  }
  return {
    socketPath: environmentSocket ?? descriptor.socketPath,
    authToken: environmentToken ?? descriptor.authToken,
  };
}
