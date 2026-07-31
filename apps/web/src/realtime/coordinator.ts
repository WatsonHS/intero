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
import type { CallEventEnvelope } from "../calls/types.js";

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

const CallEventHint = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal("conversation.call.event"),
    eventId: z.string().uuid(),
    threadId: z.string().uuid(),
    callId: z.string().uuid(),
    senderId: z.string().uuid(),
    event: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("invite"),
          mode: z.enum(["audio", "video"]),
        })
        .strict(),
      z.object({ kind: z.literal("decline") }).strict(),
      z.object({ kind: z.literal("hangup") }).strict(),
    ]),
    occurredAt: z.string().datetime(),
  })
  .strict();

export type ConversationRealtimeStatus =
  "disabled" | "connecting" | "live" | "degraded" | "offline";

export interface ConversationRealtimeDependencies {
  createSession: () => Promise<RealtimeSessionPayload>;
  createSubscription: (
    threadId: string,
  ) => Promise<RealtimeSubscriptionPayload>;
  onChange: (event: ConversationChangedEventPayload) => void;
  onCallEvent?: (event: CallEventEnvelope) => void;
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
  readonly #subscriptions = new Map<
    string,
    { subscription: Subscription; consumers: number }
  >();
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
    for (const entry of this.#subscriptions.values()) {
      entry.subscription.unsubscribe();
      this.#client?.removeSubscription(entry.subscription);
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
      existing.consumers += 1;
      return () => this.unsubscribeThread(threadId, existing.subscription);
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
    this.#subscriptions.set(threadId, { subscription, consumers: 1 });
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
        if (client !== this.#client || this.#stopped) return;
        if (this.#retryTimer) {
          clearTimeout(this.#retryTimer);
          this.#retryTimer = undefined;
        }
        this.#retryAttempt = 0;
        this.#dependencies.onStatus("live");
      });
      client.on("connecting", () => {
        if (client !== this.#client || this.#stopped) return;
        this.#dependencies.onStatus(this.#online() ? "connecting" : "offline");
      });
      client.on("disconnected", () => {
        if (client !== this.#client || this.#stopped) return;
        this.#client = undefined;
        this.#dependencies.onStatus(this.#online() ? "degraded" : "offline");
        this.#scheduleRetry();
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
    if (!parsed.success) {
      const callEvent = CallEventHint.safeParse(context.data);
      if (!callEvent.success || this.#seenEventIds.has(callEvent.data.eventId))
        return;
      this.#rememberEvent(callEvent.data.eventId);
      this.#dependencies.onCallEvent?.(callEvent.data as CallEventEnvelope);
      return;
    }
    if (this.#seenEventIds.has(parsed.data.eventId)) return;
    this.#rememberEvent(parsed.data.eventId);
    this.#dependencies.onChange(parsed.data as ConversationChangedEventPayload);
  }

  #rememberEvent(eventId: string): void {
    this.#seenEventIds.add(eventId);
    this.#seenEventOrder.push(eventId);
    if (this.#seenEventOrder.length > 512) {
      const expired = this.#seenEventOrder.shift();
      if (expired) this.#seenEventIds.delete(expired);
    }
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
    const entry = this.#subscriptions.get(threadId);
    if (!entry || entry.subscription !== subscription) return;
    entry.consumers -= 1;
    if (entry.consumers > 0) return;
    this.#subscriptions.delete(threadId);
    subscription.unsubscribe();
    this.#client?.removeSubscription(subscription);
  }

  #online(): boolean {
    return this.#dependencies.isOnline?.() ?? true;
  }
}
