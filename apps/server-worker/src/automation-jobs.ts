import type { OrganizationId, ProjectId } from "@intero/domain";
import type { WorkerUtils } from "graphile-worker";

import type {
  PortfolioSummaryJobReference,
  PostgresAutomationStore,
} from "../../server-api/src/automation-store.js";

export const AUTOMATION_SIGNAL_TASK = "project_automation_signal";
export const AUTOMATION_DETECT_TASK = "project_automation_detect";
export const AUTOMATION_DISPATCH_TASK = "project_automation_dispatch";
export const AUTOMATION_RECONCILE_TASK = "project_automation_reconcile";
export const AUTOMATION_SUMMARY_TASK = "project_automation_portfolio_summary";

export interface AutomationJobReference {
  schemaVersion: 1;
  organizationId: OrganizationId;
  projectId: ProjectId;
  signalId: string;
}

export class GraphileAutomationJobRunner {
  constructor(
    private readonly workerUtils: WorkerUtils,
    private readonly organizationId: OrganizationId,
  ) {}

  async enqueue(reference: AutomationJobReference): Promise<void> {
    if (reference.organizationId !== this.organizationId) {
      throw new Error("cross_organization_automation_job");
    }
    await this.workerUtils.addJob(AUTOMATION_SIGNAL_TASK, reference, {
      jobKey: `project-automation:${reference.organizationId}:${reference.signalId}`,
      jobKeyMode: "unsafe_dedupe",
      queueName: `pilot-project-${reference.projectId}`,
      maxAttempts: 12,
    });
  }
}

export class AutomationOutboxDispatcher {
  constructor(
    private readonly store: PostgresAutomationStore,
    private readonly runner: GraphileAutomationJobRunner,
  ) {}

  async dispatch(limit = 50): Promise<number> {
    const claimed = await this.store.claimOutbox(limit);
    let firstError: Error | undefined;
    for (const entry of claimed) {
      try {
        await this.runner.enqueue(entry.payload);
        await this.store.markOutboxCompleted(entry.operationId);
      } catch (error) {
        const normalized =
          error instanceof Error
            ? error
            : new Error("automation_enqueue_failed");
        await this.store.markOutboxFailed(
          entry.operationId,
          entry.attempts,
          normalized.message.split(":")[0] ?? "automation_enqueue_failed",
        );
        firstError ??= normalized;
      }
    }
    if (firstError) throw firstError;
    return claimed.length;
  }
}

export class GraphilePortfolioSummaryJobRunner {
  constructor(
    private readonly workerUtils: WorkerUtils,
    private readonly organizationId: OrganizationId,
  ) {}

  async enqueue(reference: PortfolioSummaryJobReference): Promise<void> {
    if (reference.organizationId !== this.organizationId) {
      throw new Error("cross_organization_portfolio_summary_job");
    }
    await this.workerUtils.addJob(AUTOMATION_SUMMARY_TASK, reference, {
      jobKey: `project-automation-summary:${reference.organizationId}:${reference.operationId}`,
      jobKeyMode: "unsafe_dedupe",
      queueName: `pilot-principal-${reference.principalId}`,
      maxAttempts: 12,
    });
  }
}

export class PortfolioSummaryOutboxDispatcher {
  constructor(
    private readonly store: PostgresAutomationStore,
    private readonly runner: GraphilePortfolioSummaryJobRunner,
  ) {}

  async dispatch(limit = 50): Promise<number> {
    const claimed = await this.store.claimPortfolioSummaryOutbox(limit);
    let firstError: Error | undefined;
    for (const entry of claimed) {
      try {
        await this.runner.enqueue(entry.payload);
        await this.store.markPortfolioSummaryOutboxCompleted(entry.operationId);
      } catch (error) {
        const normalized =
          error instanceof Error
            ? error
            : new Error("portfolio_summary_enqueue_failed");
        await this.store.markPortfolioSummaryOutboxFailed(
          entry.operationId,
          entry.attempts,
          normalized.message.split(":")[0] ??
            "portfolio_summary_enqueue_failed",
        );
        firstError ??= normalized;
      }
    }
    if (firstError) throw firstError;
    return claimed.length;
  }
}
