import type {
  CanonicalWorkEvent,
  Claim,
  PublicWorkProjection,
  Workstream,
} from "@intero/domain";

import { resolveWorkstream } from "./claim-resolver.js";
import { buildPublicProjection } from "./public-projection.js";

export interface RepresentativePorts {
  loadWorkstream(id: Workstream["id"]): Promise<Workstream>;
  loadClaims(id: Workstream["id"]): Promise<Claim[]>;
  eventToClaims(
    event: CanonicalWorkEvent,
    workstream: Workstream,
  ): Promise<Claim[]>;
  saveClaim(claim: Claim): Promise<void>;
  saveWorkstream(workstream: Workstream): Promise<void>;
  publishProjection(projection: PublicWorkProjection): Promise<void>;
  markProcessed(idempotencyKey: string): Promise<boolean>;
}

export async function processCanonicalEvent(
  event: CanonicalWorkEvent,
  ports: RepresentativePorts,
): Promise<{
  workstream: Workstream;
  projection?: PublicWorkProjection;
  duplicate: boolean;
}> {
  if (!event.workstreamId) {
    throw new Error(
      "A Canonical Work Event must be assigned to a Workstream before reduction.",
    );
  }
  const firstProcessing = await ports.markProcessed(event.idempotencyKey);
  const current = await ports.loadWorkstream(event.workstreamId);
  if (!firstProcessing) return { workstream: current, duplicate: true };

  const newClaims = await ports.eventToClaims(event, current);
  for (const claim of newClaims) await ports.saveClaim(claim);
  const claims = await ports.loadClaims(event.workstreamId);
  const next = resolveWorkstream({ workstream: current, claims });
  await ports.saveWorkstream(next);

  const projection = buildPublicProjection(current, next);
  if (projection) await ports.publishProjection(projection);
  return projection
    ? { workstream: next, projection, duplicate: false }
    : { workstream: next, duplicate: false };
}

export class KeyedSerialExecutor {
  readonly #tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.#tails.set(key, current);
    try {
      return await current;
    } finally {
      if (this.#tails.get(key) === current) this.#tails.delete(key);
    }
  }
}

export interface RunBudget {
  modelCalls: number;
  toolCalls: number;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  retries: number;
}

export type RunUsage = RunBudget;

const BUDGET_DIMENSIONS = [
  "modelCalls",
  "toolCalls",
  "steps",
  "inputTokens",
  "outputTokens",
  "retries",
] as const satisfies ReadonlyArray<keyof RunBudget>;

export class RunBudgetLedger {
  readonly #usage = new Map<string, RunUsage>();

  consume(principalId: string, budget: RunBudget, delta: RunUsage): RunUsage {
    const current = this.#usage.get(principalId) ?? zeroRunUsage();
    const next = Object.fromEntries(
      BUDGET_DIMENSIONS.map((dimension) => [
        dimension,
        current[dimension] + delta[dimension],
      ]),
    ) as unknown as RunUsage;
    for (const dimension of BUDGET_DIMENSIONS) {
      if (
        !Number.isSafeInteger(budget[dimension]) ||
        budget[dimension] < 0 ||
        !Number.isSafeInteger(next[dimension]) ||
        next[dimension] < 0 ||
        next[dimension] > budget[dimension]
      ) {
        throw new Error(`Representative run exceeded the ${dimension} budget.`);
      }
    }
    this.#usage.set(principalId, next);
    return next;
  }
}

export function zeroRunUsage(): RunUsage {
  return {
    modelCalls: 0,
    toolCalls: 0,
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    retries: 0,
  };
}
