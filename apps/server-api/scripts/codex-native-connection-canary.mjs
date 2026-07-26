import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const secrets = new Set();
let temporaryRoot;

try {
  const input = JSON.parse(await readStdin());
  if (typeof input.prompt !== "string") {
    throw new Error("Expected a JSON object with a tailored Codex prompt.");
  }
  const manifest = parseManifest(input.prompt);
  const desired = manifest.desiredState;
  if (desired?.agent?.client !== "codex") {
    throw new Error("The supplied setup prompt is not tailored for Codex.");
  }
  const ticket = requiredString(desired.setupAuthorization?.ticket, "ticket");
  secrets.add(ticket);
  const exchangeUrl = requiredUrl(
    desired.setupAuthorization?.exchangeUrl,
    "exchange URL",
  );
  const mcpUrl = requiredUrl(desired.mcp?.url, "MCP URL");
  const hookUrl = requiredUrl(desired.hooks?.endpoint, "Hook URL");
  const projectId = requiredString(desired.project?.id, "Project ID");
  const projectName = requiredString(desired.project?.name, "Project name");

  temporaryRoot = await mkdtemp(join(tmpdir(), "intero-codex-native-"));
  await execFileAsync("git", ["init", "-q", temporaryRoot]);
  const workspaceId = randomUUID();
  const repositoryName =
    typeof input.repositoryName === "string" && input.repositoryName
      ? input.repositoryName.slice(0, 80)
      : basename(temporaryRoot);
  const exchange = await fetch(exchangeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticket,
      client: "codex",
      name: `Codex · ${repositoryName}`,
      workspaceId,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  const exchangeBody = await exchange.json();
  if (!exchange.ok || typeof exchangeBody.credential !== "string") {
    throw new Error(
      exchangeBody.message ??
        `Agent setup authorization failed (${exchange.status}).`,
    );
  }
  const credential = exchangeBody.credential;
  secrets.add(credential);

  await writeNativeArtifacts({
    root: temporaryRoot,
    mcpUrl,
    hookUrl,
    credential,
    projectId,
    projectName,
    workspaceId,
  });
  const codexConfig = await validateCodexConfig(
    temporaryRoot,
    mcpUrl,
    credential,
  );

  const mcpClient = new Client({
    name: "intero-codex-native-canary",
    version: "1.0.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: { authorization: `Bearer ${credential}` },
    },
  });
  await mcpClient.connect(transport);
  const tools = await mcpClient.listTools();
  const requiredTools = [
    "intero.validate_connection",
    "stand_in.current_context",
    "stand_in.report_checkpoint",
  ];
  for (const tool of requiredTools) {
    if (!tools.tools.some((candidate) => candidate.name === tool)) {
      throw new Error(`Remote MCP is missing required tool ${tool}.`);
    }
  }
  const validation = await mcpClient.callTool({
    name: "intero.validate_connection",
    arguments: {},
  });
  const validationResult = textResult(validation);
  if (validationResult.status !== "connected") {
    throw new Error("The real MCP validation handshake did not connect.");
  }
  const context = textResult(
    await mcpClient.callTool({
      name: "stand_in.current_context",
      arguments: {},
    }),
  );
  await mcpClient.close();
  if (
    context.status !== "connected" ||
    context.projectId !== projectId ||
    context.client !== "codex"
  ) {
    throw new Error("The persisted Agent binding did not match the Project.");
  }

  const hook = await fetch(hookUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credential}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      clientEventId: `codex-canary-${randomUUID()}`,
      lifecycle: "session_started",
      workstreamKey: "intero-connection-canary",
      workstreamTitle: "Intero connection canary",
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!hook.ok) {
    throw new Error(`Codex Hook validation failed (${hook.status}).`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "connected",
        project: { id: projectId, name: projectName },
        agent: {
          client: "codex",
          bindingId: validationResult.bindingId,
          name: validationResult.name,
        },
        verification: {
          codexConfigParsed: codexConfig,
          remoteMcpTools: requiredTools,
          realHandshake: true,
          persistedContext: true,
          safeLifecycleHook: true,
        },
        disposableRepository: true,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  const message = redact(
    error instanceof Error ? error.message : "Codex canary failed.",
  );
  process.stderr.write(`${JSON.stringify({ status: "failed", message })}\n`);
  process.exitCode = 1;
} finally {
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function writeNativeArtifacts(input) {
  const codexDirectory = join(input.root, ".codex");
  const interoDirectory = join(input.root, ".intero");
  await Promise.all([
    mkdir(codexDirectory, { recursive: true }),
    mkdir(interoDirectory, { recursive: true }),
  ]);
  await writeFile(
    join(codexDirectory, "config.toml"),
    [
      "[mcp_servers.intero]",
      `url = ${JSON.stringify(input.mcpUrl)}`,
      `http_headers = { Authorization = ${JSON.stringify(
        `Bearer ${input.credential}`,
      )} }`,
      "required = true",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  await writeFile(
    join(codexDirectory, "hooks.json"),
    `${JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: "node .intero/hook.mjs session_started",
                  timeout: 10,
                },
              ],
            },
          ],
          SessionEnd: [
            {
              hooks: [
                {
                  type: "command",
                  command: "node .intero/hook.mjs session_ended",
                  timeout: 10,
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(input.root, "AGENTS.md"),
    [
      "<!-- >>> intero-managed -->",
      "# Intero coordination",
      "Use stand_in.report_checkpoint only at semantic branch points.",
      "Never send raw prompts, file contents, diffs, terminal output, tool logs, or secrets.",
      "<!-- <<< intero-managed -->",
      "",
    ].join("\n"),
  );
  const connectionPath = join(interoDirectory, "connection.json");
  await writeFile(
    connectionPath,
    `${JSON.stringify(
      {
        projectId: input.projectId,
        projectName: input.projectName,
        client: "codex",
        workspaceId: input.workspaceId,
        credential: input.credential,
        mcpUrl: input.mcpUrl,
        hookUrl: input.hookUrl,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await chmod(connectionPath, 0o600);
  await writeFile(
    join(interoDirectory, "hook.mjs"),
    [
      'import { createHash } from "node:crypto";',
      'import { readFile } from "node:fs/promises";',
      'const connection = JSON.parse(await readFile(new URL("./connection.json", import.meta.url), "utf8"));',
      'const lifecycle = process.argv[2] === "session_ended" ? "session_ended" : "session_started";',
      "const chunks = []; let size = 0;",
      "for await (const chunk of process.stdin) { size += chunk.length; if (size > 65536) process.exit(0); chunks.push(Buffer.from(chunk)); }",
      'let native = {}; try { native = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch {}',
      'const nativeId = String(native.hook_event_id ?? native.event_id ?? native.session_id ?? native.conversation_id ?? "event");',
      'const clientEventId = `hook:codex:${lifecycle}:${createHash("sha256").update(nativeId).digest("hex").slice(0, 32)}`;',
      "const response = await fetch(connection.hookUrl, {",
      '  method: "POST",',
      '  headers: { authorization: `Bearer ${connection.credential}`, "content-type": "application/json" },',
      '  body: JSON.stringify({ clientEventId, lifecycle, workstreamKey: "coding-agent", workstreamTitle: "Coding Agent work" })',
      "});",
      "if (!response.ok) process.exitCode = 0;",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(input.root, ".git", "info", "exclude"),
    [".codex/config.toml", ".intero/connection.json", ""].join("\n"),
  );
}

async function validateCodexConfig(root, mcpUrl, credential) {
  const codexHome = join(root, ".codex-canary-home");
  await mkdir(codexHome, { recursive: true });
  await writeFile(
    join(codexHome, "config.toml"),
    [
      "[mcp_servers.intero]",
      `url = ${JSON.stringify(mcpUrl)}`,
      `http_headers = { Authorization = ${JSON.stringify(
        `Bearer ${credential}`,
      )} }`,
      "required = true",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  const result = await execFileAsync("codex", ["mcp", "get", "intero"], {
    cwd: root,
    env: { ...process.env, CODEX_HOME: codexHome },
    timeout: 10_000,
    maxBuffer: 128 * 1024,
  });
  if (
    !result.stdout.includes("transport: streamable_http") ||
    !result.stdout.includes("http_headers: Authorization=*****") ||
    result.stdout.includes(credential)
  ) {
    throw new Error("Codex did not parse or redact the native MCP config.");
  }
  return true;
}

function parseManifest(prompt) {
  const match = prompt.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) throw new Error("The tailored prompt has no setup manifest.");
  return JSON.parse(match[1]);
}

function textResult(result) {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.find((item) => item?.type === "text")?.text;
  if (typeof text !== "string") {
    throw new Error("The MCP tool returned no text result.");
  }
  return JSON.parse(text);
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value) {
    throw new Error(`Missing ${name} in the setup manifest.`);
  }
  return value;
}

function requiredUrl(value, name) {
  return new URL(requiredString(value, name)).toString();
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function redact(message) {
  let safe = message;
  for (const secret of secrets) safe = safe.replaceAll(secret, "[redacted]");
  return safe;
}
