import {
  type PilotAgentBinding,
  type PilotCheckpointInput,
  type PilotProject,
  ProjectId,
} from "@intero/domain";

import {
  ModelGatewayUnavailableError,
  type CoordinationTransport,
  type ModelGateway,
  type PilotStandInJob,
} from "./pilot-ports.js";
import type {
  PilotIngestResult,
  PilotStoredStandInJob,
  PilotStore,
} from "./pilot-store.js";
import { PilotStoreError } from "./pilot-store.js";
import type {
  AuthorizationPort,
  JobRunnerPort,
  RealtimePort,
} from "./ports.js";

export type StandInProcessing =
  | { status: "published" }
  | { status: "private" }
  | { status: "pending"; jobKey: string }
  | { status: "unavailable"; errorCode: string };

export type PilotCheckpointResult = PilotIngestResult & {
  standIn: StandInProcessing;
};

export class PilotCheckpointService {
  constructor(
    private readonly store: PilotStore,
    private readonly jobs: JobRunnerPort<PilotStandInJob>,
  ) {}

  async submit(
    binding: PilotAgentBinding,
    checkpoint: PilotCheckpointInput,
    receivedAt: string,
  ): Promise<PilotCheckpointResult> {
    const initial = await this.store.ingestCheckpoint(
      binding,
      checkpoint,
      receivedAt,
    );
    if (initial.duplicate) {
      return {
        ...initial,
        standIn: processingResult(initial),
      };
    }

    const dispatched = await this.jobs.dispatch(
      toStandInJob(initial.standInJob),
    );
    const current = await this.store.getIngestResult(initial.workState.id);
    if (dispatched.status === "failed") {
      return {
        ...current,
        standIn: {
          status: "unavailable",
          errorCode: dispatched.errorCode,
        },
      };
    }
    return {
      ...current,
      standIn:
        dispatched.status === "queued"
          ? {
              status: "pending",
              jobKey: current.standInJob.jobKey,
            }
          : processingResult(current),
    };
  }
}

export class PilotStandInJobHandler {
  constructor(
    private readonly store: PilotStore,
    private readonly authorization: AuthorizationPort,
    private readonly model: ModelGateway,
    private readonly coordination: CoordinationTransport,
    private readonly realtime: RealtimePort,
  ) {}

  async handle(
    job: PilotStandInJob,
    execution: {
      workerId: string;
      attempt: number;
      maxAttempts: number;
      now?: string;
    } = {
      workerId: "inline",
      attempt: 1,
      maxAttempts: 1,
    },
  ): Promise<void> {
    return this.handleJobKey(job.idempotencyKey, execution);
  }

  async handleJobKey(
    jobKey: string,
    execution: {
      workerId: string;
      attempt: number;
      maxAttempts: number;
      now?: string;
    },
  ): Promise<void> {
    const now = execution.now ?? new Date().toISOString();
    const claimed = await this.store.claimStandInJob({
      jobKey,
      workerId: execution.workerId,
      attempt: execution.attempt,
      maxAttempts: execution.maxAttempts,
      now,
    });
    if (claimed.status === "completed") return;
    const stored = claimed.job;
    const { binding, checkpoint, workStateId, receivedAt } =
      toStandInJob(stored).payload;
    try {
      const allowed = await this.authorization.check({
        principalId: binding.ownerId,
        permission: "participate",
        resourceType: "project",
        resourceId: checkpoint.projectId,
      });
      if (!allowed.allowed) {
        throw new PilotStoreError(
          "PROJECT_PARTICIPATION_REQUIRED",
          403,
          "The Agent owner no longer participates in this project.",
        );
      }

      const project = await this.loadProject(
        checkpoint.projectId,
        binding.ownerId,
      );
      if (project.posture !== "collaborative") {
        await this.store.completeStandInJob({
          jobKey,
          workerId: execution.workerId,
          actorId: binding.ownerId,
          projectId: project.id,
          workStateId,
          output: {
            safeSummary:
              checkpoint.narrative.completedOutcome ||
              checkpoint.narrative.currentFocus,
            narrative: checkpoint.narrative,
            coordination: {
              shouldOpen: false,
              safeContext: "",
              candidateNextSteps: [],
            },
          },
          now: receivedAt,
        });
        return;
      }

      const output = await this.model.generateStandInOutput({
        organizationId: project.organizationId,
        project: {
          id: project.id,
          name: project.name,
          posture: project.posture,
        },
        ownerId: binding.ownerId,
        binding: {
          id: binding.id,
          client: binding.client,
          name: binding.name,
        },
        checkpoint,
      });

      const suggestion = this.coordination.plan({
        project,
        binding,
        workStateId,
        checkpoint,
        output,
        now: receivedAt,
      });
      const completed = await this.store.completeStandInJob({
        jobKey,
        workerId: execution.workerId,
        actorId: binding.ownerId,
        projectId: project.id,
        workStateId,
        output,
        ...(suggestion
          ? {
              coordination: {
                safeContext: suggestion.safeContext,
                candidateNextSteps: suggestion.candidateNextSteps,
              },
            }
          : {}),
        now: receivedAt,
      });

      await this.realtime
        .publish(`pilot:project:${project.id}`, {
          kind: "stand_in_projection_updated",
          projectId: project.id,
          workStateId,
          pulseEntryId: completed.pulseEntry?.id,
          coordinationThreadId: completed.coordinationThread?.id,
        })
        .catch(() => undefined);
    } catch (error) {
      const terminal = execution.attempt >= execution.maxAttempts;
      await this.store.failStandInJob({
        jobKey,
        workerId: execution.workerId,
        actorId: binding.ownerId,
        projectId: checkpoint.projectId,
        workStateId,
        errorCode: standInErrorCode(error),
        terminal,
        ...(!terminal
          ? { nextAttemptAt: retryAt(now, execution.attempt) }
          : {}),
        now,
      });
      throw error;
    }
  }

  private async loadProject(
    projectId: PilotCheckpointInput["projectId"],
    principalId: PilotAgentBinding["ownerId"],
  ): Promise<PilotProject> {
    const project = (await this.store.listProjects(principalId)).find(
      (item) => item.id === projectId,
    );
    if (!project) {
      throw new PilotStoreError(
        "PROJECT_NOT_FOUND",
        404,
        `Project ${ProjectId.parse(projectId)} was not found.`,
      );
    }
    return project;
  }
}

export class TransactionalOutboxJobRunner implements JobRunnerPort<PilotStandInJob> {
  async dispatch(): Promise<{ status: "queued" }> {
    return { status: "queued" };
  }
}

function toStandInJob(
  job: PilotStoredStandInJob,
): PilotStandInJob {
  return {
    id: job.id,
    kind: "pilot.stand_in.project",
    idempotencyKey: job.jobKey,
    payload: {
      binding: job.binding,
      checkpoint: job.checkpoint,
      workStateId: job.workStateId,
      receivedAt: job.receivedAt,
    },
  };
}

function processingResult(result: PilotIngestResult): StandInProcessing {
  const status = result.standInJob.status;
  if (status === "published") return { status: "published" };
  if (status === "private") return { status: "private" };
  if (status === "failed") {
    return {
      status: "unavailable",
      errorCode:
        result.standInJob.lastErrorCode ??
        "STAND_IN_JOB_DEAD_LETTERED",
    };
  }
  return {
    status: "pending",
    jobKey: result.standInJob.jobKey,
  };
}

function standInErrorCode(error: unknown): string {
  if (error instanceof ModelGatewayUnavailableError) return error.code;
  if (error instanceof PilotStoreError) return error.code;
  return "STAND_IN_JOB_FAILED";
}

function retryAt(now: string, attempt: number): string {
  const delaySeconds = Math.min(300, 2 ** Math.min(Math.max(attempt, 1), 8));
  return new Date(Date.parse(now) + delaySeconds * 1_000).toISOString();
}
