import type {
  PilotAgentClient,
  PilotCheckpointEventType,
  PilotWorkNarrative,
  WorkstreamPhase,
} from "@intero/domain";
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
  };
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
}

export class CloudPilotClient {
  private constructor(
    private readonly connection: CloudConnection,
    private readonly outbox: EncryptedOutbox,
  ) {}

  static async connect(input: {
    baseUrl: string;
    ticket: string;
    client: PilotAgentClient;
    cwd: string;
    configDirectory?: string;
  }): Promise<CloudPilotClient> {
    const baseUrl = input.baseUrl.replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/v1/pilot/agent/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ticket: input.ticket,
        client: input.client,
        name: `${clientLabel(input.client)} · ${basename(input.cwd)}`,
        workspaceId: randomUUID(),
      }),
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json()) as {
      credential?: string;
      projectId?: string;
      binding?: CloudConnection["binding"];
      message?: string;
    };
    if (!response.ok || !body.credential || !body.projectId || !body.binding) {
      throw new Error(
        body.message ?? `Agent ticket exchange failed (${response.status}).`,
      );
    }
    const directory = cloudDirectory(input.configDirectory);
    const key = loadMasterKey(directory);
    const connection: CloudConnection = {
      baseUrl,
      projectId: body.projectId,
      credential: body.credential,
      binding: body.binding,
    };
    writeEncrypted(connectionPath(directory, input.client), connection, key);
    return new CloudPilotClient(
      connection,
      new EncryptedOutbox(outboxPath(directory, input.client), key),
    );
  }

  static load(input: {
    client: PilotAgentClient;
    configDirectory?: string;
  }): CloudPilotClient {
    const directory = cloudDirectory(input.configDirectory);
    const key = loadMasterKey(directory);
    const connection = readEncrypted<CloudConnection>(
      connectionPath(directory, input.client),
      key,
    );
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
      deploymentBaseUrl: this.connection.baseUrl,
    };
  }

  async reportConnectionCheck(): Promise<unknown> {
    return this.reportCheckpoint({
      eventType: "validation_completed",
      clientEventId: `connection-check-${this.connection.binding.id}`,
      workstreamKey: "intero-agent-connection-check",
      workstreamTitle: "Agent 连接验证",
      phase: "validating",
      narrative: {
        currentFocus: "验证 Coding Agent 与当前 Intero 项目的连接。",
        completedOutcome: `${clientLabel(this.connection.binding.client)} 已完成项目绑定。`,
        evidence: ["结构化测试动态已通过当前 Agent 连接发送。"],
        nextStep: "开始工作后，由 Agent 在有意义的节点更新实际工作状态。",
        collaboration: {
          needed: false,
          request: "",
          requestedFrom: "",
        },
      },
    });
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
          `Work in ${basename(process.cwd())}`,
        phase: input.phase ?? phaseForEvent(input.eventType),
      },
      narrative: input.narrative,
      evidenceRefs: input.evidenceRefs ?? [],
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
    const body = response.status === 204
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

function cloudDirectory(override?: string): string {
  const directory = resolve(
    override ??
      process.env.INTERO_CLOUD_DATA_DIR ??
      join(homedir(), ".intero", "cloud"),
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  return directory;
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
