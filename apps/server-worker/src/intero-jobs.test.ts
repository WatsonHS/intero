import type { OrganizationId } from "@intero/domain";
import type { WorkerUtils } from "graphile-worker";
import { describe, expect, it, vi } from "vitest";

import type { PilotInteroJobReference } from "../../server-api/src/intero-request-service.js";
import {
  GraphileInteroJobRunner,
  InteroJobOutboxDispatcher,
  PILOT_INTERO_TASK,
  type InteroJobRunner,
  type InteroOutboxRepository,
} from "./intero-jobs.js";

const ORGANIZATION_ID =
  "019fb800-0000-7000-8000-000000000001" as OrganizationId;
const REFERENCE: PilotInteroJobReference = {
  schemaVersion: 1,
  organizationId: ORGANIZATION_ID,
  requestId: "019fb800-0000-7000-8000-000000000002",
  scopeRevision: 1,
};

describe("Intero durable request jobs", () => {
  it("deduplicates one request revision on its organization queue", async () => {
    const addJob = vi.fn().mockResolvedValue({});
    const runner = new GraphileInteroJobRunner(
      { addJob } as unknown as WorkerUtils,
      ORGANIZATION_ID,
    );

    await runner.enqueue(REFERENCE);

    expect(addJob).toHaveBeenCalledWith(PILOT_INTERO_TASK, REFERENCE, {
      jobKey: `pilot-intero:${ORGANIZATION_ID}:${REFERENCE.requestId}:1`,
      jobKeyMode: "unsafe_dedupe",
      queueName: `pilot-intero-${ORGANIZATION_ID}`,
      maxAttempts: 8,
    });
    await expect(
      runner.enqueue({
        ...REFERENCE,
        organizationId:
          "019fb800-0000-7000-8000-000000000099" as OrganizationId,
      }),
    ).rejects.toThrow("cross_organization_intero_job_reference");
  });

  it("marks the outbox complete only after Graphile accepts the job", async () => {
    const repository = repositoryStub();
    const runner: InteroJobRunner = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    };
    const dispatcher = new InteroJobOutboxDispatcher(repository, runner);

    await expect(dispatcher.dispatch()).resolves.toBe(1);
    expect(runner.enqueue).toHaveBeenCalledWith(REFERENCE);
    expect(repository.markCompleted).toHaveBeenCalledWith("operation-1");
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it("keeps a failed enqueue retryable with a stable error code", async () => {
    const repository = repositoryStub();
    const runner: InteroJobRunner = {
      enqueue: vi.fn().mockRejectedValue(new Error("queue_unavailable: down")),
    };
    const dispatcher = new InteroJobOutboxDispatcher(repository, runner);

    await expect(dispatcher.dispatch()).rejects.toThrow("queue_unavailable");
    expect(repository.markCompleted).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledWith(
      "operation-1",
      3,
      "queue_unavailable",
    );
  });
});

function repositoryStub(): InteroOutboxRepository {
  return {
    claimOutbox: vi.fn().mockResolvedValue([
      {
        operationId: "operation-1",
        payload: REFERENCE,
        attempts: 3,
      },
    ]),
    markCompleted: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
}
