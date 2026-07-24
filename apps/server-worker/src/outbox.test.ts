import { describe, expect, it } from "vitest";

import {
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
        channel: "intero:organization-1",
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
});
