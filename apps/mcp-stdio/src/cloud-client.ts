import {
  PILOT_AGENT_CONFIGURATION_VERSION,
  type PilotAgentClient,
  type PilotCheckpointEventType,
  type PilotSharedBoundaryInput,
  type PilotWorkNarrative,
  type PreferredLanguage,
  type WorkstreamPhase,
} from "@intero/domain";
import { cloudWorkspaceClientFiles } from "@intero/integrations";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const MAX_EVENTS = 10_000;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

interface CloudConnection {
  baseUrl: string;
  projectId: string;
  credential: string;
  binding: {
    id: string;
    client: PilotAgentClient;
    name: string;
    workspaceId: string;
    preferredLanguage: PreferredLanguage;
  };
}

interface CloudConnectionMetadata {
  schemaVersion: 1;
  projectId: string;
  bindingId: string;
  client: PilotAgentClient;
  workspaceId: string;
}

interface QueuedEvent {
  queuedAt: string;
  payload: Record<string, unknown>;
}

interface GapMarker {
  reason: "expired" | "overflow";
  droppedCount: number;
  recordedAt: string;
}

interface OutboxState {
  events: QueuedEvent[];
  gapMarkers: GapMarker[];
}

interface OutboxLimits {
  maxEvents: number;
  maxBytes: number;
  maxAgeMs: number;
}

const DEFAULT_OUTBOX_LIMITS: OutboxLimits = {
  maxEvents: MAX_EVENTS,
  maxBytes: MAX_BYTES,
  maxAgeMs: MAX_AGE_MS,
};

export interface CloudCheckpointInput {
  eventType: PilotCheckpointEventType;
  narrative: PilotWorkNarrative;
  evidenceRefs?: string[] | undefined;
  clientEventId?: string | undefined;
  workstreamKey?: string | undefined;
  workstreamTitle?: string | undefined;
  phase?: WorkstreamPhase | undefined;
  sharedBoundaries?: PilotSharedBoundaryInput[] | undefined;
}

export class CloudPilotClient {
  private constructor(
    private readonly connection: CloudConnection,
    private readonly outbox: EncryptedOutbox,
    private verificationCode?: string,
  ) {}

  static async connect(input: {
    baseUrl: string;
    ticket: string;
    client: PilotAgentClient;
    cwd: string;
    configDirectory?: string;
    expectedWorkspaceId?: string;
  }): Promise<CloudPilotClient> {
    const baseUrl = input.baseUrl.replace(/\/+$/, "");
    const directory = cloudDirectory(input.configDirectory, input.cwd);
    const workspaceId = loadWorkspaceId(directory, input.expectedWorkspaceId);
    const response = await fetch(`${baseUrl}/v1/pilot/agent/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ticket: input.ticket,
        client: input.client,
        name: `${clientLabel(input.client)} · ${basename(input.cwd)}`,
        workspaceId,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json()) as {
      credential?: string;
      projectId?: string;
      binding?: CloudConnection["binding"];
      verification?: { code?: string };
      message?: string;
    };
    if (
      !response.ok ||
      !body.credential ||
      !body.projectId ||
      !body.binding ||
      !body.verification?.code
    ) {
      throw new Error(
        body.message ?? `Agent ticket exchange failed (${response.status}).`,
      );
    }
    if (body.binding.workspaceId !== workspaceId) {
      throw new Error(
        "Agent connection returned a different workspace identity.",
      );
    }
    const key = loadMasterKey(directory);
    const connection: CloudConnection = {
      baseUrl,
      projectId: body.projectId,
      credential: body.credential,
      binding: body.binding,
    };
    writeEncrypted(connectionPath(directory, input.client), connection, key);
    writeConnectionMetadata(directory, connection);
    return new CloudPilotClient(
      connection,
      new EncryptedOutbox(outboxPath(directory, input.client), key),
      body.verification.code,
    );
  }

  static load(input: {
    client: PilotAgentClient;
    configDirectory?: string;
    cwd?: string;
  }): CloudPilotClient {
    const directory = cloudDirectory(input.configDirectory, input.cwd);
    const key = loadMasterKey(directory);
    const connection = readEncrypted<CloudConnection>(
      connectionPath(directory, input.client),
      key,
    );
    if (connection.binding.workspaceId !== loadWorkspaceId(directory)) {
      throw new Error(
        "The encrypted Agent connection belongs to a different workspace.",
      );
    }
    assertConnectionMetadata(directory, connection);
    return new CloudPilotClient(
      connection,
      new EncryptedOutbox(outboxPath(directory, input.client), key),
    );
  }

  context() {
    return {
      mode: "direct_cloud_mcp",
      projectId: this.connection.projectId,
      bindingId: this.connection.binding.id,
      client: this.connection.binding.client,
      workspaceId: this.connection.binding.workspaceId,
      preferredLanguage: this.connection.binding.preferredLanguage,
      deploymentBaseUrl: this.connection.baseUrl,
    };
  }

  async validateConnection(): Promise<unknown> {
    await this.mcpRequest({
      jsonrpc: "2.0",
      id: `initialize-${this.connection.binding.id}`,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: this.connection.binding.client,
          version: "0.1.0",
        },
      },
    });
    const body = await this.mcpRequest({
      jsonrpc: "2.0",
      id: `validate-${this.connection.binding.id}`,
      method: "tools/call",
      params: {
        name: "intero.validate_connection",
        arguments: {
          configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
          ...(this.verificationCode
            ? { verificationCode: this.verificationCode }
            : {}),
        },
      },
    });
    const result = parseMcpToolResult<{
      status?: string;
      mcpConnected?: boolean;
      configurationCurrent?: boolean;
    }>(body, "Connection validation");
    const validationComplete =
      result?.status === "connected" ||
      (result?.status === "lifecycle_pending" &&
        result.mcpConnected === true &&
        result.configurationCurrent === true);
    if (!validationComplete) {
      throw new Error("Agent connection validation did not complete.");
    }
    this.verificationCode = undefined;
    return result;
  }

  async currentContext(): Promise<unknown> {
    const body = await this.mcpRequest({
      jsonrpc: "2.0",
      id: `current-context-${randomUUID()}`,
      method: "tools/call",
      params: {
        name: "stand_in.current_context",
        arguments: {},
      },
    });
    return parseMcpToolResult(body, "Current context");
  }

  private async mcpRequest(request: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${this.connection.baseUrl}/v1/pilot/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.connection.credential}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(5_000),
    });
    const responseText = await response.text();
    let body: {
      error?: { message?: string };
    };
    try {
      body = JSON.parse(responseText) as typeof body;
    } catch {
      throw new Error(
        responseText ||
          `Agent MCP request returned an invalid response (${response.status}).`,
      );
    }
    if (!response.ok || body.error) {
      throw new Error(
        body.error?.message ?? `Agent MCP request failed (${response.status}).`,
      );
    }
    return body;
  }

  async reportConnectionCheck(): Promise<unknown> {
    const language = this.connection.binding.preferredLanguage;
    const chinese = language === "zh-CN";
    return this.reportCheckpoint({
      eventType: "validation_completed",
      clientEventId: `connection-check-${this.connection.binding.id}`,
      workstreamKey: "intero-agent-connection-check",
      workstreamTitle: chinese
        ? "Agent 连接验证"
        : "Agent connection validation",
      phase: "validating",
      narrative: {
        currentFocus: chinese
          ? "验证 Coding Agent 与当前 Intero 项目的连接。"
          : "Validate the Coding Agent connection to the current Intero project.",
        completedOutcome: chinese
          ? `${clientLabel(this.connection.binding.client)} 已完成项目绑定。`
          : `${clientLabel(this.connection.binding.client)} is now bound to the project.`,
        evidence: [
          chinese
            ? "结构化测试动态已通过当前 Agent 连接发送。"
            : "A structured validation update was sent through the current Agent connection.",
        ],
        nextStep: chinese
          ? "开始工作后，由 Agent 在有意义的节点更新实际工作状态。"
          : "Once work starts, report actual work state at meaningful checkpoints.",
        collaboration: {
          needed: false,
          request: "",
          requestedFrom: "",
        },
      },
    });
  }

  async reportLifecycle(input: {
    clientEventId: string;
    lifecycle: "session_started" | "session_ended";
    occurredAt?: string;
    workstreamKey: string;
    workstreamTitle: string;
    evidenceRefs?: string[];
  }): Promise<unknown> {
    const response = await fetch(
      `${this.connection.baseUrl}/v1/pilot/agent/hooks`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.connection.credential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          clientEventId: input.clientEventId,
          lifecycle: input.lifecycle,
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
          workstreamKey: input.workstreamKey,
          workstreamTitle: input.workstreamTitle,
          ...(input.evidenceRefs && input.evidenceRefs.length > 0
            ? { evidenceRefs: input.evidenceRefs }
            : {}),
        }),
        signal: AbortSignal.timeout(3_000),
      },
    );
    const body = (await response.json()) as { message?: string };
    if (!response.ok) {
      throw new Error(
        body.message ?? `Lifecycle delivery failed (${response.status}).`,
      );
    }
    return body;
  }

  async reportCheckpoint(input: CloudCheckpointInput): Promise<unknown> {
    const payload = {
      schemaVersion: 2,
      clientEventId: input.clientEventId ?? randomUUID(),
      projectId: this.connection.projectId,
      occurredAt: new Date().toISOString(),
      eventType: input.eventType,
      workstream: {
        key:
          input.workstreamKey ??
          process.env.INTERO_WORKSTREAM_KEY ??
          basename(process.cwd()),
        title:
          input.workstreamTitle ??
          process.env.INTERO_WORKSTREAM_TITLE ??
          (this.connection.binding.preferredLanguage === "zh-CN"
            ? `${basename(process.cwd())} 中的工作`
            : `Work in ${basename(process.cwd())}`),
        phase: input.phase ?? phaseForEvent(input.eventType),
      },
      narrative: input.narrative,
      evidenceRefs: input.evidenceRefs ?? [],
      sharedBoundaries: input.sharedBoundaries ?? [],
    };

    await this.flush();
    try {
      return await this.send(payload);
    } catch (error) {
      this.outbox.enqueue(payload);
      return {
        accepted: true,
        queued: true,
        clientEventId: payload.clientEventId,
        reason: "intero_service_unavailable",
        detail: error instanceof Error ? error.message : "Network failure",
      };
    }
  }

  async projectRequest(input: {
    path: string;
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: Record<string, unknown>;
    clientMutationId?: string;
  }): Promise<unknown> {
    await this.flush();
    const response = await fetch(
      `${this.connection.baseUrl}/v1/project-work/${this.connection.projectId}${input.path}`,
      {
        method: input.method ?? "GET",
        headers: {
          authorization: `Bearer ${this.connection.credential}`,
          ...(input.body ? { "content-type": "application/json" } : {}),
          ...(input.clientMutationId
            ? { "idempotency-key": input.clientMutationId }
            : {}),
        },
        ...(input.body ? { body: JSON.stringify(input.body) } : {}),
        signal: AbortSignal.timeout(5_000),
      },
    );
    const body =
      response.status === 204
        ? {}
        : ((await response.json()) as { message?: string });
    if (!response.ok) {
      throw new Error(
        body.message ?? `Project content request failed (${response.status}).`,
      );
    }
    return body;
  }

  async flush(): Promise<{ flushed: number; pending: number }> {
    let flushed = 0;
    while (true) {
      const next = this.outbox.peek();
      if (!next) break;
      try {
        await this.send(next.payload);
        this.outbox.shift();
        flushed += 1;
      } catch {
        break;
      }
    }
    return { flushed, pending: this.outbox.size() };
  }

  diagnostics() {
    return {
      ...this.context(),
      outbox: this.outbox.diagnostics(),
    };
  }

  private async send(payload: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(
      `${this.connection.baseUrl}/v1/pilot/agent/checkpoints`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.connection.credential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3_000),
      },
    );
    const body = (await response.json()) as { message?: string };
    if (!response.ok) {
      throw new Error(
        body.message ?? `Checkpoint delivery failed (${response.status}).`,
      );
    }
    return body;
  }
}

function parseMcpToolResult<T = unknown>(body: unknown, operation: string): T {
  const resultBody = body as {
    result?: {
      isError?: boolean;
      content?: Array<{ type?: string; text?: string }>;
    };
  };
  const text = resultBody.result?.content?.find(
    (item) => item.type === "text",
  )?.text;
  if (!text || resultBody.result?.isError) {
    throw new Error(`${operation} did not return a valid MCP tool result.`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${operation} returned invalid JSON.`);
  }
}

export class EncryptedOutbox {
  constructor(
    private readonly path: string,
    private readonly key: Buffer,
    private readonly limits: OutboxLimits = DEFAULT_OUTBOX_LIMITS,
  ) {}

  enqueue(payload: Record<string, unknown>, now = new Date()): void {
    const state = this.load();
    this.prune(state, now);
    state.events.push({ queuedAt: now.toISOString(), payload });
    let dropped = 0;
    while (
      state.events.length > this.limits.maxEvents ||
      byteSize(state.events) > this.limits.maxBytes
    ) {
      state.events.shift();
      dropped += 1;
    }
    if (dropped > 0) {
      state.gapMarkers.push({
        reason: "overflow",
        droppedCount: dropped,
        recordedAt: now.toISOString(),
      });
    }
    this.save(state);
  }

  peek(now = new Date()): QueuedEvent | undefined {
    const state = this.load();
    if (this.prune(state, now)) this.save(state);
    return state.events[0];
  }

  shift(): void {
    const state = this.load();
    state.events.shift();
    this.save(state);
  }

  size(): number {
    return this.load().events.length;
  }

  diagnostics() {
    const state = this.load();
    return {
      pendingEvents: state.events.length,
      encryptedBytes: existsSync(this.path)
        ? Buffer.byteLength(readFileSync(this.path))
        : 0,
      limits: {
        events: this.limits.maxEvents,
        bytes: this.limits.maxBytes,
        ageDays: this.limits.maxAgeMs / (24 * 60 * 60 * 1_000),
      },
      gapMarkers: state.gapMarkers.slice(-20),
    };
  }

  private prune(state: OutboxState, now: Date): boolean {
    const threshold = now.getTime() - this.limits.maxAgeMs;
    const retained = state.events.filter(
      (entry) => Date.parse(entry.queuedAt) >= threshold,
    );
    const dropped = state.events.length - retained.length;
    if (dropped === 0) return false;
    state.events = retained;
    state.gapMarkers.push({
      reason: "expired",
      droppedCount: dropped,
      recordedAt: now.toISOString(),
    });
    return true;
  }

  private load(): OutboxState {
    if (!existsSync(this.path)) return { events: [], gapMarkers: [] };
    return readEncrypted<OutboxState>(this.path, this.key);
  }

  private save(state: OutboxState): void {
    writeEncrypted(this.path, state, this.key);
  }
}

export function defaultCloudDirectoryForWorkspace(
  cwd: string,
  homeDirectory = homedir(),
): string {
  return cloudWorkspaceClientFiles(homeDirectory, cwd, "codex").directory;
}

function cloudDirectory(override?: string, cwd = process.cwd()): string {
  const directory = resolve(
    override ??
      process.env.INTERO_CLOUD_DATA_DIR ??
      defaultCloudDirectoryForWorkspace(cwd),
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  return directory;
}

function loadWorkspaceId(
  directory: string,
  expectedWorkspaceId?: string,
): string {
  const path = join(directory, "workspace-id");
  if (!existsSync(path)) {
    if (expectedWorkspaceId) {
      throw new Error(
        "The Desktop-confirmed Intero workspace identity is missing from this repository.",
      );
    }
    try {
      writeFileSync(path, `${randomUUID()}\n`, { mode: 0o600, flag: "wx" });
    } catch (error) {
      if (!existsSync(path)) throw error;
    }
  }
  chmodSync(path, 0o600);
  const workspaceId = readFileSync(path, "utf8").trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      workspaceId,
    )
  ) {
    throw new Error("The local Intero workspace identity is invalid.");
  }
  if (expectedWorkspaceId && workspaceId !== expectedWorkspaceId) {
    throw new Error(
      "The Desktop Agent ticket belongs to a different local repository workspace.",
    );
  }
  return workspaceId;
}

function metadataPath(directory: string, client: PilotAgentClient): string {
  return join(directory, `${client}.metadata.json`);
}

function writeConnectionMetadata(
  directory: string,
  connection: CloudConnection,
): void {
  const metadata: CloudConnectionMetadata = {
    schemaVersion: 1,
    projectId: connection.projectId,
    bindingId: connection.binding.id,
    client: connection.binding.client,
    workspaceId: connection.binding.workspaceId,
  };
  const path = metadataPath(directory, connection.binding.client);
  writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(path, 0o600);
}

function assertConnectionMetadata(
  directory: string,
  connection: CloudConnection,
): void {
  const path = metadataPath(directory, connection.binding.client);
  let metadata: CloudConnectionMetadata;
  try {
    metadata = JSON.parse(
      readFileSync(path, "utf8"),
    ) as CloudConnectionMetadata;
  } catch {
    throw new Error(
      "The local Agent connection metadata is missing or invalid.",
    );
  }
  if (
    metadata.schemaVersion !== 1 ||
    metadata.projectId !== connection.projectId ||
    metadata.bindingId !== connection.binding.id ||
    metadata.client !== connection.binding.client ||
    metadata.workspaceId !== connection.binding.workspaceId
  ) {
    throw new Error(
      "The local Agent connection metadata does not match its credential.",
    );
  }
}

function loadMasterKey(directory: string): Buffer {
  const fromEnvironment = process.env.INTERO_OUTBOX_KEY;
  if (fromEnvironment) {
    return createHash("sha256").update(fromEnvironment).digest();
  }
  const account = createHash("sha256")
    .update(directory)
    .digest("hex")
    .slice(0, 24);
  if (process.platform === "darwin") {
    try {
      const existing = execFileSync(
        "security",
        [
          "find-generic-password",
          "-s",
          "com.intero.cloud-outbox",
          "-a",
          account,
          "-w",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      if (existing) return Buffer.from(existing, "base64url");
    } catch {
      const generated = randomBytes(32);
      try {
        execFileSync(
          "security",
          [
            "add-generic-password",
            "-U",
            "-s",
            "com.intero.cloud-outbox",
            "-a",
            account,
            "-w",
            generated.toString("base64url"),
          ],
          { stdio: "ignore" },
        );
        return generated;
      } catch {
        // Fall through to a permission-restricted local key file.
      }
    }
  }
  const keyPath = join(directory, ".outbox.key");
  if (existsSync(keyPath))
    return Buffer.from(readFileSync(keyPath, "utf8"), "base64url");
  const generated = randomBytes(32);
  writeFileSync(keyPath, generated.toString("base64url"), { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  return generated;
}

function writeEncrypted(path: string, value: unknown, key: Buffer): void {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    }),
    { mode: 0o600 },
  );
  chmodSync(path, 0o600);
}

function readEncrypted<T>(path: string, key: Buffer): T {
  const envelope = JSON.parse(readFileSync(path, "utf8")) as {
    version: number;
    iv: string;
    tag: string;
    ciphertext: string;
  };
  if (envelope.version !== 1)
    throw new Error("Unsupported Intero cloud data version.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

function connectionPath(directory: string, client: PilotAgentClient): string {
  return join(directory, `${client}.connection.enc`);
}

function outboxPath(directory: string, client: PilotAgentClient): string {
  return join(directory, `${client}.outbox.enc`);
}

function byteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function clientLabel(client: PilotAgentClient): string {
  return client === "claude-code"
    ? "Claude Code"
    : client === "opencode"
      ? "OpenCode"
      : client === "grok-build"
        ? "Grok Build"
        : client === "cursor"
          ? "Cursor"
          : "Codex";
}

function phaseForEvent(eventType: PilotCheckpointEventType): WorkstreamPhase {
  if (eventType === "work_completed") return "completed";
  if (eventType === "blocker_raised") return "blocked";
  if (eventType === "review_requested") return "reviewing";
  if (eventType === "validation_completed") return "validating";
  if (eventType === "work_started") return "planning";
  return "implementing";
}
