import type {
  OrganizationId,
  PilotAgentBinding,
  PilotCheckpointInput,
  PilotCoordinationThread,
  PilotProject,
  PilotPulseEntry,
  PilotStandInAnswer,
  PilotStandInOutput,
  PrincipalId,
  ProjectId,
} from "@intero/domain";
import type { PrivacySafeMetrics } from "@intero/config";

import type { PilotStore } from "./pilot-store.js";
import type {
  AuthorizationPort,
  JobDispatchResult,
  JobEnvelope,
  JobRunnerPort,
  ObjectStorePort,
  RealtimePort,
} from "./ports.js";

export interface StandInModelInput {
  organizationId: OrganizationId;
  project: Pick<PilotProject, "id" | "name" | "posture">;
  ownerId: PrincipalId;
  binding: Pick<
    PilotAgentBinding,
    "id" | "client" | "name" | "preferredLanguage"
  >;
  checkpoint: PilotCheckpointInput;
}

export interface ModelGateway {
  generateStandInOutput(input: StandInModelInput): Promise<PilotStandInOutput>;
  answerStandInQuestion(
    input: StandInQuestionInput,
  ): Promise<PilotStandInAnswer>;
}

export interface StandInQuestionInput {
  organizationId: OrganizationId;
  project: Pick<PilotProject, "id" | "name" | "posture">;
  principalId: PrincipalId;
  preferredLanguage: PilotAgentBinding["preferredLanguage"];
  question: string;
  sources: PilotPulseEntry[];
}

export class ModelGatewayUnavailableError extends Error {
  readonly code = "MODEL_GATEWAY_UNAVAILABLE";
}

export class InstrumentedModelGateway implements ModelGateway {
  constructor(
    private readonly inner: ModelGateway,
    private readonly metrics: PrivacySafeMetrics,
  ) {}

  async generateStandInOutput(
    input: StandInModelInput,
  ): Promise<PilotStandInOutput> {
    return this.observe("summary", () =>
      this.inner.generateStandInOutput(input),
    );
  }

  async answerStandInQuestion(
    input: StandInQuestionInput,
  ): Promise<PilotStandInAnswer> {
    return this.observe("answer", () =>
      this.inner.answerStandInQuestion(input),
    );
  }

  private async observe<T>(
    operation: "summary" | "answer",
    call: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await call();
      this.metrics.observeModel(
        operation,
        "success",
        performance.now() - startedAt,
      );
      return result;
    } catch (error) {
      this.metrics.observeModel(
        operation,
        error instanceof ModelGatewayUnavailableError ? "unavailable" : "error",
        performance.now() - startedAt,
      );
      throw error;
    }
  }
}

export interface PilotStandInJobPayload {
  binding: PilotAgentBinding;
  checkpoint: PilotCheckpointInput;
  workStateId: string;
  receivedAt: string;
}

export type PilotStandInJob = JobEnvelope<PilotStandInJobPayload> & {
  kind: "pilot.stand_in.project";
};

export interface CoordinationSuggestion {
  project: PilotProject;
  binding: PilotAgentBinding;
  workStateId: string;
  checkpoint: PilotCheckpointInput;
  safeContext: string;
  candidateNextSteps: string[];
  now: string;
}

export interface CoordinationTransport {
  plan(input: {
    project: PilotProject;
    binding: PilotAgentBinding;
    workStateId: string;
    checkpoint: PilotCheckpointInput;
    output: PilotStandInOutput;
    now: string;
  }): CoordinationSuggestion | undefined;
  list(
    projectId: ProjectId,
    principalId: PrincipalId,
  ): Promise<PilotCoordinationThread[]>;
  openOrRefresh(
    suggestion: CoordinationSuggestion,
  ): Promise<PilotCoordinationThread>;
  proposeConclusion(input: {
    threadId: string;
    principalId: PrincipalId;
    conclusion: string;
    responsibleParticipantId: PrincipalId;
    now: string;
  }): Promise<PilotCoordinationThread>;
  confirm(
    threadId: string,
    principalId: PrincipalId,
    now: string,
  ): Promise<PilotCoordinationThread>;
}

export class InlineJobRunner implements JobRunnerPort<PilotStandInJob> {
  readonly mode = "inline";

  constructor(
    private readonly handler: (job: PilotStandInJob) => Promise<void>,
  ) {}

  async dispatch(job: PilotStandInJob): Promise<JobDispatchResult> {
    try {
      await this.handler(job);
      return { status: "completed" };
    } catch (error) {
      return {
        status: "failed",
        errorCode:
          error instanceof ModelGatewayUnavailableError
            ? error.code
            : "STAND_IN_JOB_FAILED",
      };
    }
  }
}

/**
 * Browser clients poll durable project state. Publishing is intentionally a
 * no-op in the pilot, but all application calls still cross this stable port.
 */
export class PollingRealtimeAdapter implements RealtimePort {
  readonly mode = "polling";

  async publish(
    _channel: string,
    _event: Record<string, unknown>,
  ): Promise<void> {}
}

export class DisabledObjectStoreAdapter implements ObjectStorePort {
  readonly mode = "disabled";

  async createUpload(_input: {
    objectId: string;
    purpose: "artifact" | "authorized_raw";
    checksumSha256: string;
    byteSize: number;
    contentType: string;
    encrypted: boolean;
  }): Promise<never> {
    throw new PilotPortUnavailableError(
      "OBJECT_STORAGE_DISABLED",
      "Attachments and raw-content storage are disabled for this pilot.",
    );
  }

  async markScanned(
    _objectId: string,
    _result: "clean" | "infected" | "failed",
  ): Promise<never> {
    throw new PilotPortUnavailableError(
      "OBJECT_STORAGE_DISABLED",
      "Attachments and raw-content storage are disabled for this pilot.",
    );
  }

  async completeUpload(_objectId: string): Promise<never> {
    throw new PilotPortUnavailableError(
      "OBJECT_STORAGE_DISABLED",
      "Attachments and raw-content storage are disabled for this pilot.",
    );
  }

  async cleanup(_now?: Date): Promise<number> {
    return 0;
  }

  async checkReadiness(): Promise<{
    status: "ready" | "unavailable";
    detail?: string;
  }> {
    return { status: "ready" };
  }
}

export class PilotPortUnavailableError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Current policy adapter. It derives access only from the pilot's durable
 * organization, team membership, and project association records.
 */
export class MembershipAuthorizationAdapter implements AuthorizationPort {
  constructor(private readonly store: PilotStore) {}

  async check(input: {
    principalId: string;
    permission: string;
    resourceType: string;
    resourceId: string;
  }): Promise<{ allowed: boolean }> {
    const principalId = input.principalId as PrincipalId;
    if (input.resourceType === "organization" && input.permission === "admin") {
      return {
        allowed:
          (await this.store.getOrganizationRole(principalId)) === "admin",
      };
    }
    if (input.resourceType === "team") {
      if (input.permission === "participate") {
        return {
          allowed: (await this.store.listTeams(principalId)).some(
            (team) => team.id === input.resourceId,
          ),
        };
      }
      if (input.permission === "manage_members") {
        return {
          allowed:
            (await this.store.getOrganizationRole(principalId)) === "admin" ||
            (await this.store.getTeamRole(input.resourceId, principalId)) ===
              "leader",
        };
      }
    }
    if (input.resourceType === "project") {
      const project = (await this.store.listProjects(principalId)).find(
        (item) => item.id === input.resourceId,
      );
      if (input.permission === "participate") {
        return { allowed: Boolean(project) };
      }
      if (input.permission === "manage_collaboration") {
        return { allowed: project?.ownerId === principalId };
      }
    }
    return { allowed: false };
  }
}

export class ProjectInternalCoordinationTransport implements CoordinationTransport {
  readonly protocol = "project-internal-v1";

  constructor(private readonly store: PilotStore) {}

  plan(input: {
    project: PilotProject;
    binding: PilotAgentBinding;
    workStateId: string;
    checkpoint: PilotCheckpointInput;
    output: PilotStandInOutput;
    now: string;
  }): CoordinationSuggestion | undefined {
    if (
      ![
        "dependency_declared",
        "blocker_raised",
        "review_requested",
        "coordination_requested",
      ].includes(input.checkpoint.eventType) ||
      !input.output.coordination.shouldOpen
    ) {
      return undefined;
    }
    return {
      project: input.project,
      binding: input.binding,
      workStateId: input.workStateId,
      checkpoint: input.checkpoint,
      safeContext:
        input.output.coordination.safeContext || input.output.safeSummary,
      candidateNextSteps: input.output.coordination.candidateNextSteps,
      now: input.now,
    };
  }

  list(
    projectId: ProjectId,
    principalId: PrincipalId,
  ): Promise<PilotCoordinationThread[]> {
    return this.store.listCoordination(projectId, principalId);
  }

  openOrRefresh(
    suggestion: CoordinationSuggestion,
  ): Promise<PilotCoordinationThread> {
    return this.store.upsertCoordinationSuggestion(suggestion);
  }

  proposeConclusion(input: {
    threadId: string;
    principalId: PrincipalId;
    conclusion: string;
    responsibleParticipantId: PrincipalId;
    now: string;
  }): Promise<PilotCoordinationThread> {
    return this.store.proposeCoordinationConclusion(input);
  }

  confirm(
    threadId: string,
    principalId: PrincipalId,
    now: string,
  ): Promise<PilotCoordinationThread> {
    return this.store.confirmCoordination(threadId, principalId, now);
  }
}
