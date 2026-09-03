import { describe, expect, it, vi } from "vitest";

import {
  CentrifugoRealtime,
  OutboxDispatcher,
  type OutboxPublication,
  type OutboxRepository,
  type RealtimePublisher,
} from "./outbox.js";

class MemoryOutbox implements OutboxRepository {
  completed: string[] = [];
  failed: Array<{ operationId: string; errorCode: string }> = [];

  constructor(readonly pending: OutboxPublication[]) {}

  async claim(): Promise<OutboxPublication[]> {
    return this.pending;
  }

  async markCompleted(operationId: string): Promise<void> {
    this.completed.push(operationId);
  }

  async markFailed(operationId: string, errorCode: string): Promise<void> {
    this.failed.push({ operationId, errorCode });
  }
}

describe("Outbox dispatcher", () => {
  it("publishes the authoritative cursor before completing the row", async () => {
    const repository = new MemoryOutbox([
      {
        operationId: "operation-1",
        topic: "workstream.changed",
        payload: { sequence: 42, aggregateId: "workstream-1" },
        attempts: 1,
      },
    ]);
    const publications: unknown[] = [];
    const realtime: RealtimePublisher = {
      async publish(channel, event) {
        publications.push({ channel, event });
      },
    };
    const dispatcher = new OutboxDispatcher(
      "organization-1",
      repository,
      realtime,
    );
    await expect(dispatcher.dispatch()).resolves.toBe(1);
    expect(publications).toEqual([
      {
        channel: "intero:organization:organization-1",
        event: {
          operationId: "operation-1",
          topic: "workstream.changed",
          sequence: 42,
          aggregateId: "workstream-1",
        },
      },
    ]);
    expect(repository.completed).toEqual(["operation-1"]);
  });

  it("routes project-scoped events to the project channel", async () => {
    const repository = new MemoryOutbox([
      {
        operationId: "operation-project",
        topic: "pilot.stand_in.completed",
        payload: {
          projectId: "project-1",
          workStateId: "work-state-1",
        },
        attempts: 1,
      },
    ]);
    const publications: unknown[] = [];
    const dispatcher = new OutboxDispatcher("organization-1", repository, {
      async publish(channel, event) {
        publications.push({ channel, event });
      },
    });

    await expect(dispatcher.dispatch()).resolves.toBe(1);
    expect(publications).toEqual([
      {
        channel: "intero:project:project-1",
        event: {
          operationId: "operation-project",
          topic: "pilot.stand_in.completed",
          projectId: "project-1",
          workStateId: "work-state-1",
        },
      },
    ]);
  });

  it("publishes conversation hints without adding content or envelope fields", async () => {
    const event = {
      schemaVersion: 1,
      eventId: "019b5ac0-7600-7000-8000-000000000101",
      type: "conversation.changed",
      threadId: "019b5ac0-7600-7000-8000-000000000102",
      headSequence: 7,
      accessVersion: 2,
      reason: "message_appended",
      occurredAt: "2026-07-28T08:00:00.000Z",
    };
    const repository = new MemoryOutbox([
      {
        operationId: event.eventId,
        channel: `intero:thread:${event.threadId}`,
        topic: "conversation.changed",
        payload: event,
        attempts: 1,
      },
    ]);
    const publish = vi.fn(
      async (_channel: string, _event: Record<string, unknown>) => undefined,
    );
    const dispatcher = new OutboxDispatcher("organization-1", repository, {
      publish,
    });

    await expect(dispatcher.dispatch()).resolves.toBe(1);
    expect(publish).toHaveBeenCalledWith(
      `intero:thread:${event.threadId}`,
      event,
    );
    expect(publish.mock.calls[0]?.[1]).not.toHaveProperty("topic");
    expect(publish.mock.calls[0]?.[1]).not.toHaveProperty("operationId");
  });

  it("enqueues one conversation.changed callback per operation", async () => {
    const event = {
      schemaVersion: 1,
      eventId: "019b5ac0-7600-7000-8000-000000000201",
      type: "conversation.changed",
      threadId: "019b5ac0-7600-7000-8000-000000000202",
      headSequence: 4,
      accessVersion: 1,
      reason: "message_appended",
      occurredAt: "2026-07-28T08:00:00.000Z",
    };
    const onConversationChanged = vi.fn(async () => undefined);
    const dispatcher = new OutboxDispatcher(
      "organization-1",
      new MemoryOutbox([
        {
          operationId: event.eventId,
          channel: `intero:thread:${event.threadId}`,
          topic: "conversation.changed",
          payload: event,
          attempts: 1,
        },
        {
          operationId: event.eventId,
          channel: `intero:user:principal-1`,
          topic: "conversation.changed",
          payload: event,
          attempts: 1,
        },
      ]),
      { async publish() {} },
      onConversationChanged,
    );
    await expect(dispatcher.dispatch()).resolves.toBe(2);
    expect(onConversationChanged).toHaveBeenCalledTimes(1);
    expect(onConversationChanged).toHaveBeenCalledWith(event);
  });

  it("retains failed publications for retry", async () => {
    const repository = new MemoryOutbox([
      {
        operationId: "operation-2",
        topic: "workstream.changed",
        payload: { sequence: 43 },
        attempts: 1,
      },
    ]);
    const dispatcher = new OutboxDispatcher("organization-1", repository, {
      async publish() {
        throw new Error("centrifugo_503:unavailable");
      },
    });
    await expect(dispatcher.dispatch()).rejects.toThrow("centrifugo_503");
    expect(repository.completed).toEqual([]);
    expect(repository.failed).toEqual([
      { operationId: "operation-2", errorCode: "centrifugo_503" },
    ]);
  });

  it("reports an unavailable Centrifugo dependency without throwing", async () => {
    await expect(
      new CentrifugoRealtime("http://127.0.0.1:59998").checkReadiness(),
    ).resolves.toEqual({
      status: "unavailable",
      detail: "centrifugo_unavailable",
    });
  });
});
