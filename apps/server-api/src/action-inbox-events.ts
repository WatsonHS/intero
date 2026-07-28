import type { OrganizationId, PrincipalId } from "@intero/domain";
import type { Notification, Pool, PoolClient } from "pg";

export const ACTION_INBOX_EVENT_CHANNEL = "intero_action_inbox_events";

export interface ActionInboxChangedEvent {
  organizationId: OrganizationId;
  principalId: PrincipalId;
  reason: "action_inbox" | "notification_preferences" | "automation_summary";
  occurredAt: string;
}

export type ActionInboxEventListener = (event: ActionInboxChangedEvent) => void;

export interface ActionInboxEventSource {
  subscribe(
    principalId: PrincipalId,
    listener: ActionInboxEventListener,
  ): () => void;
}

export class NoopActionInboxEventSource implements ActionInboxEventSource {
  subscribe(): () => void {
    return () => undefined;
  }
}

/**
 * One PostgreSQL LISTEN connection per API process fans durable database
 * changes out to all connected browsers. NOTIFY is only a wake-up hint; the
 * browser still reloads the authorized Inbox representation over HTTP.
 */
export class PostgresActionInboxEventSource implements ActionInboxEventSource {
  private readonly listeners = new Map<string, Set<ActionInboxEventListener>>();
  private client: PoolClient | undefined;
  private connecting: Promise<void> | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(
    private readonly pool: Pool,
    private readonly organizationId: OrganizationId,
  ) {}

  async start(): Promise<void> {
    if (this.closed || this.client || this.connecting) return this.connecting;
    this.connecting = this.connect()
      .catch(() => {
        this.scheduleReconnect();
      })
      .finally(() => {
        this.connecting = undefined;
      });
    return this.connecting;
  }

  subscribe(
    principalId: PrincipalId,
    listener: ActionInboxEventListener,
  ): () => void {
    const key = principalId as string;
    const listeners =
      this.listeners.get(key) ?? new Set<ActionInboxEventListener>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(key);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const client = this.client;
    this.client = undefined;
    if (client) {
      client.removeAllListeners("notification");
      client.removeAllListeners("error");
      await client.query(`UNLISTEN ${ACTION_INBOX_EVENT_CHANNEL}`).catch(() => {
        // A broken listener connection can only be discarded.
      });
      client.release();
    }
    this.listeners.clear();
  }

  private async connect(): Promise<void> {
    const client = await this.pool.connect();
    if (this.closed) {
      client.release();
      return;
    }
    const onNotification = (notification: Notification) => {
      if (notification.channel !== ACTION_INBOX_EVENT_CHANNEL) return;
      const event = parseActionInboxChangedEvent(notification.payload);
      if (!event || event.organizationId !== this.organizationId) return;
      for (const listener of this.listeners.get(event.principalId) ?? []) {
        listener(event);
      }
    };
    const onError = () => {
      if (this.client !== client) return;
      this.client = undefined;
      client.removeListener("notification", onNotification);
      client.removeListener("error", onError);
      client.release(true);
      this.scheduleReconnect();
    };
    client.on("notification", onNotification);
    client.on("error", onError);
    try {
      await client.query(`LISTEN ${ACTION_INBOX_EVENT_CHANNEL}`);
      this.client = client;
    } catch (error) {
      client.removeListener("notification", onNotification);
      client.removeListener("error", onError);
      client.release(true);
      throw error;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.start();
    }, 3_000);
    this.reconnectTimer.unref();
  }
}

export function parseActionInboxChangedEvent(
  payload: string | undefined,
): ActionInboxChangedEvent | undefined {
  if (!payload) return undefined;
  try {
    const candidate = JSON.parse(payload) as Record<string, unknown>;
    if (
      typeof candidate.organizationId !== "string" ||
      typeof candidate.principalId !== "string" ||
      typeof candidate.occurredAt !== "string" ||
      ![
        "action_inbox",
        "notification_preferences",
        "automation_summary",
      ].includes(String(candidate.reason))
    ) {
      return undefined;
    }
    return candidate as unknown as ActionInboxChangedEvent;
  } catch {
    return undefined;
  }
}
