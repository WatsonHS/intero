import { describe, expect, it } from "vitest";

import {
  PublicRepresentativeWorker,
  type PublicRepresentativeRepository,
} from "./runtime.js";

class MemoryRepository implements PublicRepresentativeRepository {
  readonly completed = new Set<string>();
  readonly messages: Array<{ operationId: string; body: string }> = [];

  async hasCompleted(operationId: string): Promise<boolean> {
    return this.completed.has(operationId);
  }

  async markCompleted(operationId: string): Promise<void> {
    this.completed.add(operationId);
  }

  async loadFreshness(): Promise<string> {
    return "2026-07-24T10:00:00.000Z";
  }

  async appendVisibleMessage(input: {
    operationId: string;
    body: string;
  }): Promise<void> {
    this.messages.push(input);
  }
}

describe("PublicRepresentativeWorker", () => {
  it("is idempotent and discloses synchronized-state freshness", async () => {
    const repository = new MemoryRepository();
    const worker = new PublicRepresentativeWorker(repository);
    const job = {
      operationId: "operation-1",
      threadId: "thread-1",
      workstreamId: "workstream-1",
      requestedAt: "2026-07-24T10:01:00.000Z",
    };
    await worker.run(job);
    await worker.run(job);
    expect(repository.messages).toHaveLength(1);
    expect(repository.messages[0]?.body).toContain("2026-07-24T10:00:00.000Z");
  });

  it("rejects work before side effects when a per-user run budget is exceeded", async () => {
    const repository = new MemoryRepository();
    const worker = new PublicRepresentativeWorker(repository);
    await expect(
      worker.run({
        operationId: "operation-budget",
        threadId: "thread-budget",
        principalId: "principal-1",
        requestedAt: "2026-07-24T10:01:00.000Z",
        budget: {
          modelCalls: 0,
          toolCalls: 0,
          steps: 1,
          inputTokens: 0,
          outputTokens: 0,
          retries: 0,
        },
        usage: {
          modelCalls: 1,
          toolCalls: 0,
          steps: 1,
          inputTokens: 0,
          outputTokens: 0,
          retries: 0,
        },
      }),
    ).rejects.toThrow("modelCalls budget");
    expect(repository.messages).toHaveLength(0);
  });
});
