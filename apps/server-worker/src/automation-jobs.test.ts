import { OrganizationId, PrincipalId, ProjectId, uuidv7 } from "@intero/domain";
import type { WorkerUtils } from "graphile-worker";
import { describe, expect, it, vi } from "vitest";

import type { PostgresAutomationStore } from "../../server-api/src/automation-store.js";
import {
  AUTOMATION_SIGNAL_TASK,
  AUTOMATION_SUMMARY_TASK,
  AutomationOutboxDispatcher,
  GraphileAutomationJobRunner,
  GraphilePortfolioSummaryJobRunner,
  PortfolioSummaryOutboxDispatcher,
} from "./automation-jobs.js";

describe("Phase 7 durable automation jobs", () => {
  const organizationId = OrganizationId.parse(uuidv7());
  const projectId = ProjectId.parse(uuidv7());
  const principalId = PrincipalId.parse(uuidv7());
  const signalId = uuidv7();

  it("deduplicates by signal and serializes jobs through the Project queue", async () => {
    const addJob = vi.fn().mockResolvedValue({});
    const runner = new GraphileAutomationJobRunner(
      { addJob } as unknown as WorkerUtils,
      organizationId,
    );
    const reference = {
      schemaVersion: 1 as const,
      organizationId,
      projectId,
      signalId,
    };
    await runner.enqueue(reference);
    await runner.enqueue(reference);

    expect(addJob).toHaveBeenCalledTimes(2);
    expect(addJob).toHaveBeenLastCalledWith(
      AUTOMATION_SIGNAL_TASK,
      reference,
      expect.objectContaining({
        jobKey: `project-automation:${organizationId}:${signalId}`,
        jobKeyMode: "unsafe_dedupe",
        queueName: `pilot-project-${projectId}`,
        maxAttempts: 12,
      }),
    );
  });

  it("completes only successfully enqueued outbox entries", async () => {
    const complete = vi.fn();
    const fail = vi.fn();
    const store = {
      claimOutbox: vi.fn().mockResolvedValue([
        {
          operationId: signalId,
          attempts: 1,
          payload: {
            schemaVersion: 1,
            organizationId,
            projectId,
            signalId,
          },
        },
      ]),
      markOutboxCompleted: complete,
      markOutboxFailed: fail,
    } as unknown as PostgresAutomationStore;
    const runner = {
      enqueue: vi.fn().mockRejectedValue(new Error("queue_unavailable")),
    } as unknown as GraphileAutomationJobRunner;

    await expect(
      new AutomationOutboxDispatcher(store, runner).dispatch(),
    ).rejects.toThrow("queue_unavailable");
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(signalId, 1, "queue_unavailable");
  });

  it("refreshes portfolio summaries through a principal-scoped durable job", async () => {
    const operationId = uuidv7();
    const reference = {
      schemaVersion: 1 as const,
      organizationId,
      principalId,
      operationId,
    };
    const addJob = vi.fn().mockResolvedValue({});
    const runner = new GraphilePortfolioSummaryJobRunner(
      { addJob } as unknown as WorkerUtils,
      organizationId,
    );
    await runner.enqueue(reference);
    expect(addJob).toHaveBeenCalledWith(
      AUTOMATION_SUMMARY_TASK,
      reference,
      expect.objectContaining({
        jobKey: `project-automation-summary:${organizationId}:${operationId}`,
        queueName: `pilot-principal-${principalId}`,
        maxAttempts: 12,
      }),
    );

    const complete = vi.fn();
    const store = {
      claimPortfolioSummaryOutbox: vi
        .fn()
        .mockResolvedValue([{ operationId, attempts: 1, payload: reference }]),
      markPortfolioSummaryOutboxCompleted: complete,
      markPortfolioSummaryOutboxFailed: vi.fn(),
    } as unknown as PostgresAutomationStore;
    const dispatchRunner = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as GraphilePortfolioSummaryJobRunner;
    expect(
      await new PortfolioSummaryOutboxDispatcher(
        store,
        dispatchRunner,
      ).dispatch(),
    ).toBe(1);
    expect(complete).toHaveBeenCalledWith(operationId);
  });
});
