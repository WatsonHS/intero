import { uuidv7 } from "@intero/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeTransport = vi.hoisted(() => {
  class Emitter {
    handlers = new Map<string, Array<(context: never) => void>>();

    on(event: string, handler: (context: never) => void) {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
      return this;
    }

    emit(event: string, context: unknown) {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(context as never);
      }
    }
  }

  class Subscription extends Emitter {
    subscribed = false;

    subscribe() {
      this.subscribed = true;
    }

    unsubscribe() {
      this.subscribed = false;
    }
  }

  class Centrifuge extends Emitter {
    static instances: Centrifuge[] = [];
    subscriptions: Subscription[] = [];
    disconnected = false;

    constructor() {
      super();
      Centrifuge.instances.push(this);
    }

    connect() {
      this.emit("connected", {
        client: "test-client",
        transport: "websocket",
      });
    }

    disconnect() {
      this.disconnected = true;
    }

    newSubscription() {
      const subscription = new Subscription();
      this.subscriptions.push(subscription);
      return subscription;
    }

    removeSubscription(subscription: Subscription) {
      this.subscriptions = this.subscriptions.filter(
        (candidate) => candidate !== subscription,
      );
    }
  }

  return { Centrifuge };
});

vi.mock("centrifuge", () => ({
  Centrifuge: fakeTransport.Centrifuge,
}));

import { ConversationRealtimeCoordinator } from "./coordinator.js";

describe("ConversationRealtimeCoordinator", () => {
  beforeEach(() => {
    fakeTransport.Centrifuge.instances = [];
  });

  it("deduplicates content-free hints across personal and thread channels", async () => {
    const statuses: string[] = [];
    const changes: unknown[] = [];
    const threadId = uuidv7();
    const event = {
      schemaVersion: 1 as const,
      eventId: uuidv7(),
      type: "conversation.changed" as const,
      threadId,
      headSequence: 4,
      accessVersion: 1,
      reason: "message_appended" as const,
      occurredAt: new Date().toISOString(),
    };
    const coordinator = new ConversationRealtimeCoordinator({
      createSession: async () => ({
        token: "connection-token",
        expiresAt: new Date().toISOString(),
        transports: [
          { transport: "websocket", endpoint: "wss://example.test/ws" },
        ],
        emulationEndpoint: "https://example.test/emulation",
      }),
      createSubscription: async () => ({
        channel: `intero:thread:${threadId}`,
        token: "subscription-token",
        expiresAt: new Date().toISOString(),
        accessVersion: 1,
      }),
      onStatus: (status) => statuses.push(status),
      onChange: (change) => changes.push(change),
      onRecoveryGap: vi.fn(),
    });

    coordinator.start();
    await vi.waitFor(() =>
      expect(fakeTransport.Centrifuge.instances).toHaveLength(1),
    );
    const client = fakeTransport.Centrifuge.instances[0]!;
    const release = await coordinator.subscribeThread(threadId);
    const subscription = client.subscriptions[0]!;
    client.emit("publication", {
      channel: `intero:user:test`,
      data: event,
    });
    subscription.emit("publication", {
      channel: `intero:thread:${threadId}`,
      data: event,
    });

    expect(statuses).toEqual(["connecting", "live"]);
    expect(changes).toEqual([event]);
    release();
    expect(subscription.subscribed).toBe(false);
    coordinator.stop();
    expect(client.disconnected).toBe(true);
  });

  it("requests HTTP repair when Centrifugo cannot recover a thread gap", async () => {
    const onRecoveryGap = vi.fn();
    const threadId = uuidv7();
    const coordinator = new ConversationRealtimeCoordinator({
      createSession: async () => ({
        token: "connection-token",
        expiresAt: new Date().toISOString(),
        transports: [
          { transport: "websocket", endpoint: "wss://example.test/ws" },
        ],
        emulationEndpoint: "https://example.test/emulation",
      }),
      createSubscription: async () => ({
        channel: `intero:thread:${threadId}`,
        token: "subscription-token",
        expiresAt: new Date().toISOString(),
        accessVersion: 1,
      }),
      onStatus: vi.fn(),
      onChange: vi.fn(),
      onRecoveryGap,
    });
    coordinator.start();
    await vi.waitFor(() =>
      expect(fakeTransport.Centrifuge.instances).toHaveLength(1),
    );
    await coordinator.subscribeThread(threadId);
    fakeTransport.Centrifuge.instances[0]!.subscriptions[0]!.emit(
      "subscribed",
      {
        channel: `intero:thread:${threadId}`,
        wasRecovering: true,
        recovered: false,
      },
    );
    expect(onRecoveryGap).toHaveBeenCalledWith(threadId);
    coordinator.stop();
  });
});
