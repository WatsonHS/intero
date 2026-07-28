import type { ConversationChangedEvent as ConversationChangedEventPayload } from "@intero/domain";
import {
  Centrifuge,
  type PublicationContext,
  type Subscription,
  type TransportEndpoint,
} from "centrifuge";
import { z } from "zod";

import type {
  RealtimeSessionPayload,
  RealtimeSubscriptionPayload,
} from "../api.js";

const ConversationChangedHint = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().uuid(),
    type: z.literal("conversation.changed"),
    threadId: z.string().uuid(),
    headSequence: z.number().int().nonnegative(),
    accessVersion: z.number().int().positive(),
    reason: z.enum([
      "thread_created",
      "thread_updated",
      "message_appended",
      "message_updated",
      "read_cursor_changed",
      "access_changed",
      "thread_concluded",
    ]),
    messageId: z.string().uuid().optional(),
    occurredAt: z.string().datetime(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.reason === "message_updated" && !event.messageId) {
      context.addIssue({
        code: "custom",
        path: ["messageId"],
        message: "message_updated events require a messageId pointer.",
      });
    }
  });

export type ConversationRealtimeStatus =
  "disabled" | "connecting" | "live" | "degraded" | "offline";

export interface ConversationRealtimeDependencies {
  createSession: () => Promise<RealtimeSessionPayload>;
  createSubscription: (
    threadId: string,
  ) => Promise<RealtimeSubscriptionPayload>;
  onChange: (event: ConversationChangedEventPayload) => void;
  onRecoveryGap: (threadId?: string) => void;
  onStatus: (status: ConversationRealtimeStatus) => void;
  isOnline?: () => boolean;
}

/**
 * Owns the transport lifecycle. Publications are deliberately parsed as
 * content-free hints; authoritative messages are always repaired over HTTP.
 */
export class ConversationRealtimeCoordinator {
  readonly #dependencies: ConversationRealtimeDependencies;
  readonly #seenEventIds = new Set<string>();
  readonly #seenEventOrder: string[] = [];
  readonly #subscriptions = new Map<string, Subscription>();
  #client: Centrifuge | undefined;
  #stopped = false;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #retryAttempt = 0;

  constructor(dependencies: ConversationRealtimeDependencies) {
    this.#dependencies = dependencies;
  }

  start(): void {
    if (this.#client || this.#retryTimer || this.#stopped) return;
    this.#dependencies.onStatus(this.#online() ? "connecting" : "offline");
    if (!this.#online()) return;
    void this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    for (const subscription of this.#subscriptions.values()) {
      subscription.unsubscribe();
      this.#client?.removeSubscription(subscription);
    }
    this.#subscriptions.clear();
    this.#client?.disconnect();
    this.#client = undefined;
  }

  networkChanged(online: boolean): void {
    if (this.#stopped) return;
    if (!online) {
      this.#dependencies.onStatus("offline");
      return;
    }
    if (this.#client) {
      this.#dependencies.onStatus("connecting");
      this.#client.connect();
      return;
    }
    this.start();
  }

  async subscribeThread(threadId: string): Promise<() => void> {
    const client = this.#client;
    if (!client) {
      throw new Error("Realtime transport is not connected.");
    }
    const existing = this.#subscriptions.get(threadId);
    if (existing) {
      return () => this.unsubscribeThread(threadId, existing);
    }
    const initial = await this.#dependencies.createSubscription(threadId);
    if (this.#stopped || client !== this.#client) return () => undefined;
    const subscription = client.newSubscription(initial.channel, {
      token: initial.token,
      getToken: async () =>
        (await this.#dependencies.createSubscription(threadId)).token,
    });
    subscription.on("publication", (context) => this.#publication(context));
    subscription.on("subscribed", (context) => {
      if (context.wasRecovering && !context.recovered) {
        this.#dependencies.onRecoveryGap(threadId);
      }
    });
    subscription.on("error", () => {
      // The SDK retries temporary failures. HTTP repair remains the source of
      // truth after the realtime transport reconnects.
      this.#dependencies.onStatus(this.#online() ? "degraded" : "offline");
    });
    this.#subscriptions.set(threadId, subscription);
    subscription.subscribe();
    return () => this.unsubscribeThread(threadId, subscription);
  }

  async #connect(): Promise<void> {
    try {
      const session = await this.#dependencies.createSession();
      if (this.#stopped) return;
      const transports = session.transports as TransportEndpoint[];
      const client = new Centrifuge(transports, {
        token: session.token,
        getToken: async () => (await this.#dependencies.createSession()).token,
        emulationEndpoint: session.emulationEndpoint,
      });
      this.#client = client;
      client.on("connected", () => {
        this.#retryAttempt = 0;
        this.#dependencies.onStatus("live");
      });
      client.on("connecting", () => {
        this.#dependencies.onStatus(this.#online() ? "connecting" : "offline");
      });
      client.on("disconnected", () => {
        this.#dependencies.onStatus(this.#online() ? "degraded" : "offline");
      });
      client.on("publication", (context) => this.#publication(context));
      client.on("subscribed", (context) => {
        if (context.wasRecovering && !context.recovered) {
          this.#dependencies.onRecoveryGap();
        }
      });
      client.connect();
    } catch {
      if (this.#stopped) return;
      this.#dependencies.onStatus(this.#online() ? "degraded" : "offline");
      this.#scheduleRetry();
    }
  }

  #publication(context: PublicationContext): void {
    const parsed = ConversationChangedHint.safeParse(context.data);
    if (!parsed.success || this.#seenEventIds.has(parsed.data.eventId)) return;
    this.#seenEventIds.add(parsed.data.eventId);
    this.#seenEventOrder.push(parsed.data.eventId);
    if (this.#seenEventOrder.length > 512) {
      const expired = this.#seenEventOrder.shift();
      if (expired) this.#seenEventIds.delete(expired);
    }
    this.#dependencies.onChange(parsed.data as ConversationChangedEventPayload);
  }

  #scheduleRetry(): void {
    if (this.#retryTimer || this.#stopped || !this.#online()) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.#retryAttempt++);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      void this.#connect();
    }, delay);
  }

  private unsubscribeThread(
    threadId: string,
    subscription: Subscription,
  ): void {
    if (this.#subscriptions.get(threadId) !== subscription) return;
    this.#subscriptions.delete(threadId);
    subscription.unsubscribe();
    this.#client?.removeSubscription(subscription);
  }

  #online(): boolean {
    return this.#dependencies.isOnline?.() ?? true;
  }
}
