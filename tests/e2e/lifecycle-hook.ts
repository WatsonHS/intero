import { spawn } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");

export async function reportSessionStarted(
  client: "codex" | "claude-code" | "opencode",
  cloudDataDir: string,
): Promise<void> {
  const eventName = client === "opencode" ? "session.created" : "SessionStart";
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      "pnpm",
      [
        "--filter",
        "@intero/mcp-stdio",
        "exec",
        "tsx",
        "src/index.ts",
        "--hook-source",
        client,
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env, INTERO_CLOUD_DATA_DIR: cloudDataDir },
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(stderr || `lifecycle hook exited ${code}`));
    });
    child.stdin.end(
      JSON.stringify({
        hook_event_name: eventName,
        cwd: repositoryRoot,
        session_id: `e2e-session-${Date.now().toString(36)}`,
      }),
    );
  });
}
