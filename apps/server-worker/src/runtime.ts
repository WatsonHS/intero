import {
  KeyedSerialExecutor,
  RunBudgetLedger,
  type RunBudget,
  type RunUsage,
  zeroRunUsage,
} from "@intero/stand-in-core";

export interface PublicStandInRun {
  operationId: string;
  threadId: string;
  workstreamId?: string;
  requestedAt: string;
  principalId?: string;
  budget?: RunBudget;
  usage?: RunUsage;
}

export interface PublicStandInRepository {
  hasCompleted(operationId: string): Promise<boolean>;
  markCompleted(operationId: string): Promise<void>;
  loadFreshness(workstreamId?: string): Promise<string | undefined>;
  appendVisibleMessage(input: {
    operationId: string;
    threadId: string;
    body: string;
    freshnessAt?: string;
  }): Promise<void>;
}

export class PublicStandInWorker {
  readonly #serial = new KeyedSerialExecutor();
  readonly #budgets = new RunBudgetLedger();

  constructor(private readonly repository: PublicStandInRepository) {}

  async run(job: PublicStandInRun): Promise<void> {
    await this.#serial.run(`thread:${job.threadId}`, async () => {
      if (await this.repository.hasCompleted(job.operationId)) return;
      this.#budgets.consume(
        job.principalId ?? "public-fallback",
        job.budget ?? zeroRunUsage(),
        job.usage ?? zeroRunUsage(),
      );
      const freshnessAt = await this.repository.loadFreshness(job.workstreamId);
      const stale =
        !freshnessAt || Date.now() - Date.parse(freshnessAt) > 300_000;
      const body = freshnessAt
        ? `Public fallback is answering from synchronized Work State dated ${freshnessAt}${stale ? " (stale)" : ""}.`
        : "Public fallback has no synchronized Work State and cannot answer from private context.";
      await this.repository.appendVisibleMessage({
        operationId: job.operationId,
        threadId: job.threadId,
        body,
        ...(freshnessAt ? { freshnessAt } : {}),
      });
      await this.repository.markCompleted(job.operationId);
    });
  }
}
