import {
  interoRequestIdFromMessage,
  interoResponseMessageId,
  type MessageId,
  type OrganizationId,
  type PilotInteroRequest,
  type PilotInteroProse,
  type PilotInteroScopeResolution,
  type PrincipalId,
  type ProjectId,
  type ThreadId,
  type ThreadMessage,
} from "@intero/domain";
import {
  evaluateAuthorizedSharedBoundaryClaims,
  resolveInteroScope,
} from "@intero/stand-in-core";

import type { CoordinationKernel } from "./coordination-kernel.js";
import type { InteroProseInput, ModelGateway } from "./pilot-ports.js";
import type { PilotStore } from "./pilot-store.js";
import { PilotStoreError } from "./pilot-store.js";
import type { PlatformStore } from "./platform-store.js";

export interface PilotInteroJobReference {
  schemaVersion: 1;
  organizationId: OrganizationId;
  requestId: string;
  scopeRevision: number;
}

export interface InteroRequestJobRunner {
  dispatch(
    reference: PilotInteroJobReference,
  ): Promise<{ status: "completed" | "queued" }>;
}

export class InlineInteroRequestJobRunner implements InteroRequestJobRunner {
  constructor(
    private readonly handler: (
      reference: PilotInteroJobReference,
    ) => Promise<void>,
  ) {}

  async dispatch(
    reference: PilotInteroJobReference,
  ): Promise<{ status: "completed" }> {
    await this.handler(reference);
    return { status: "completed" };
  }
}

export class TransactionalInteroRequestJobRunner implements InteroRequestJobRunner {
  async dispatch(): Promise<{ status: "queued" }> {
    return { status: "queued" };
  }
}

export class PilotInteroRequestService {
  constructor(
    private readonly pilotStore: PilotStore,
    private readonly conversations: PlatformStore,
    private readonly jobs: InteroRequestJobRunner,
  ) {}

  async requestFromMessage(input: {
    roomThreadId: ThreadId;
    sourceMessage: ThreadMessage;
    requestedByPrincipalId: PrincipalId;
    interoPrincipalId: PrincipalId;
    now: string;
  }): Promise<{ request: PilotInteroRequest; duplicate: boolean }> {
    const visible = await this.conversations.getThread(
      input.roomThreadId,
      input.requestedByPrincipalId,
    );
    if (
      !visible ||
      visible.thread.kind !== "room" ||
      visible.thread.accessMode !== "agent_readable" ||
      !visible.thread.teamId
    ) {
      throw new PilotStoreError(
        "INTERO_ROOM_UNAVAILABLE",
        409,
        "Intero requires an Agent-readable Team Room.",
      );
    }
    if (
      input.sourceMessage.threadId !== input.roomThreadId ||
      input.sourceMessage.senderId !== input.requestedByPrincipalId ||
      !input.sourceMessage.mentionedPrincipalIds?.includes(
        input.interoPrincipalId,
      ) ||
      !visible.thread.participantIds.includes(input.interoPrincipalId)
    ) {
      throw new PilotStoreError(
        "INTERO_MENTION_REQUIRED",
        400,
        "The source message must explicitly mention this Room's Intero identity.",
      );
    }
    const organization = await this.pilotStore.getOrganization();
    if (!organization) {
      throw new PilotStoreError(
        "ORGANIZATION_NOT_CONFIGURED",
        409,
        "Configure the Intero Organization before invoking the shared Agent.",
      );
    }
    const request: PilotInteroRequest = {
      id: interoRequestIdFromMessage(input.sourceMessage.id),
      organizationId: organization.id,
      teamId: visible.thread.teamId,
      sourceRoomThreadId: input.roomThreadId,
      sourceMessageId: input.sourceMessage.id,
      requestedByPrincipalId: input.requestedByPrincipalId,
      interoPrincipalId: input.interoPrincipalId,
      status: "pending",
      scopeRevision: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
    const stored = await this.pilotStore.createInteroRequest(request);
    if (!stored.duplicate || stored.request.status === "pending") {
      await this.jobs.dispatch(toJobReference(stored.request));
    }
    return stored;
  }

  async correctScope(input: {
    requestId: string;
    principalId: PrincipalId;
    projectIds: ProjectId[];
    now: string;
  }): Promise<PilotInteroRequest> {
    const request = await this.pilotStore.getInteroRequest(input.requestId);
    if (!request)
      throw new PilotStoreError(
        "NOT_FOUND",
        404,
        "Intero request was not found.",
      );
    const room = await this.conversations.getThread(
      request.sourceRoomThreadId,
      input.principalId,
    );
    if (!room || !room.thread.participantIds.includes(input.principalId)) {
      throw new PilotStoreError(
        "INTERO_SCOPE_CORRECTION_FORBIDDEN",
        403,
        "Only an authorized Room participant can correct this scope.",
      );
    }
    const eligibleProjects = (
      await this.pilotStore.listProjects(input.principalId)
    ).filter((project) =>
      project.participatingTeamIds.includes(request.teamId),
    );
    const resolution = resolveInteroScope({
      teamId: request.teamId,
      messageBody: "",
      eligibleProjects,
      correctedProjectIds: input.projectIds,
    });
    if (resolution.kind === "ambiguous") {
      throw new PilotStoreError(
        "INTERO_SCOPE_REQUIRED",
        400,
        "Select at least one authorized Project.",
      );
    }
    const revised = await this.pilotStore.reviseInteroRequestScope({
      requestId: request.id,
      principalId: input.principalId,
      scopeResolution: resolution,
      now: input.now,
    });
    await this.jobs.dispatch(toJobReference(revised));
    return revised;
  }
}

export class PilotInteroRequestProcessor {
  constructor(
    private readonly pilotStore: PilotStore,
    private readonly conversations: PlatformStore,
    private readonly coordinationKernel: CoordinationKernel,
    private readonly model?: Pick<ModelGateway, "generateInteroProse">,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async handle(reference: PilotInteroJobReference): Promise<void> {
    const request = await this.pilotStore.getInteroRequest(reference.requestId);
    if (
      !request ||
      request.organizationId !== reference.organizationId ||
      request.scopeRevision !== reference.scopeRevision ||
      request.status === "answered" ||
      request.status === "needs_scope"
    ) {
      return;
    }
    const now = this.clock();
    try {
      const sourceRoom = await this.conversations.getThread(
        request.sourceRoomThreadId,
        request.requestedByPrincipalId,
      );
      const sourceMessage = await this.conversations.getThreadMessage(
        request.sourceRoomThreadId,
        request.requestedByPrincipalId,
        request.sourceMessageId,
      );
      if (
        !sourceRoom ||
        sourceRoom.thread.kind !== "room" ||
        sourceRoom.thread.accessMode !== "agent_readable" ||
        sourceRoom.thread.teamId !== request.teamId ||
        !sourceMessage ||
        !sourceMessage.mentionedPrincipalIds?.includes(
          request.interoPrincipalId,
        )
      ) {
        throw new PilotStoreError(
          "INTERO_REQUEST_SOURCE_UNAVAILABLE",
          409,
          "The authorized source Room or mention is no longer available.",
        );
      }
      const eligibleProjects = (
        await this.pilotStore.listProjects(request.requestedByPrincipalId)
      ).filter((project) =>
        project.participatingTeamIds.includes(request.teamId),
      );
      const eligibleProjectIds = eligibleProjects.map((project) => project.id);
      const claims = await this.pilotStore.listSharedBoundaryClaims(
        eligibleProjectIds,
        request.requestedByPrincipalId,
      );
      const resolution =
        request.scopeResolution ??
        resolveInteroScope({
          teamId: request.teamId,
          messageBody: sourceMessage.body,
          preferredLanguage: messageLanguage(sourceMessage.body),
          eligibleProjects,
          authorizedClaims: claims,
          mentionedPrincipalIds: sourceMessage.mentionedPrincipalIds,
          ...(sourceRoom.thread.projectId
            ? { roomProjectId: sourceRoom.thread.projectId }
            : {}),
        });
      if (resolution.kind === "ambiguous") {
        await this.writeScopeQuestion(request, resolution, now);
        return;
      }

      await this.pilotStore.updateInteroRequest({
        requestId: request.id,
        status: "coordinating",
        scopeResolution: resolution,
        now,
      });
      const scopedClaims = claims.filter((claim) =>
        resolution.projectIds.includes(claim.projectId),
      );
      const matches = evaluateAuthorizedSharedBoundaryClaims(
        scopedClaims,
        resolution.projectIds,
        now,
      );
      const conflict = matches.find(
        (match) => match.classification === "potential_conflict",
      );
      if (conflict) {
        const conflictClaims = scopedClaims.filter((claim) =>
          [conflict.producerClaimId, conflict.consumerClaimId].includes(
            claim.id,
          ),
        );
        const preparedProse = await this.prepareProse({
          request,
          resolution,
          eligibleProjects,
          scopedClaims: conflictClaims,
          classification: "potential_conflict",
          boundaryKey: conflict.boundaryKey,
          reason: conflict.reason,
          preferredLanguage: messageLanguage(sourceMessage.body),
        });
        const coordination = await this.pilotStore.openScopedCoordination({
          teamId: request.teamId,
          scopeKind: resolution.kind,
          projectIds: resolution.projectIds,
          sourceRoomThreadId: request.sourceRoomThreadId,
          sourceMessageId: request.sourceMessageId,
          interoRequestId: request.id,
          requestedByPrincipalId: request.requestedByPrincipalId,
          interoPrincipalId: request.interoPrincipalId,
          match: conflict,
          sourceClaims: conflictClaims,
          briefProse: preparedProse.prose,
          briefProseSource: preparedProse.source,
          now,
        });
        const materialized = await this.coordinationKernel.refresh(
          coordination,
          now,
        );
        await this.pilotStore.updateInteroRequest({
          requestId: request.id,
          status: "answered",
          scopeResolution: resolution,
          responseMessageId:
            (materialized.summaryMessageId as MessageId | undefined) ??
            interoResponseMessageId(request.sourceMessageId),
          coordinationThreadId: materialized.id,
          now,
        });
        return;
      }

      const compatibleMatch = matches.find(
        (match) => match.classification === "compatible",
      );
      const comparison = compatibleMatch ?? matches[0];
      const evaluatedClaims = comparison
        ? scopedClaims.filter((claim) =>
            [comparison.producerClaimId, comparison.consumerClaimId].includes(
              claim.id,
            ),
          )
        : [];
      const classification = compatibleMatch
        ? ("compatible" as const)
        : ("insufficient_evidence" as const);
      const boundaryKey = comparison?.boundaryKey ?? `scope:${request.teamId}`;
      const preparedProse = await this.prepareProse({
        request,
        resolution,
        eligibleProjects,
        scopedClaims: evaluatedClaims,
        classification,
        boundaryKey,
        reason:
          comparison?.reason ??
          (compatibleMatch
            ? "The current shared-boundary evidence is compatible."
            : "The current evidence is insufficient to assert a conflict."),
        preferredLanguage: messageLanguage(sourceMessage.body),
      });
      await this.writeBoundedAnswer(
        request,
        resolution,
        renderInteroProse(preparedProse.prose),
        boundaryKey,
        Math.max(1, evaluatedClaims.length),
        now,
      );
    } catch (error) {
      await this.pilotStore.updateInteroRequest({
        requestId: request.id,
        status: "failed",
        lastErrorCode:
          error instanceof PilotStoreError
            ? error.code
            : "INTERO_REQUEST_PROCESSING_FAILED",
        now,
      });
      throw error;
    }
  }

  private async prepareProse(input: {
    request: PilotInteroRequest;
    resolution: Exclude<PilotInteroScopeResolution, { kind: "ambiguous" }>;
    eligibleProjects: Array<{ id: ProjectId; name: string }>;
    scopedClaims: Array<{
      projectId: ProjectId;
      relation: "changing" | "depending_on" | "validating";
      assumption: string;
      change: "additive" | "compatible" | "breaking" | "unknown";
      revision: number;
    }>;
    classification: InteroProseInput["evaluation"]["classification"];
    boundaryKey: string;
    reason: string;
    preferredLanguage: "zh-CN" | "en-US";
  }): Promise<{
    prose: PilotInteroProse;
    source: "provider" | "deterministic_fallback";
  }> {
    const scopedProjects = input.resolution.projectIds.flatMap((projectId) => {
      const project = input.eligibleProjects.find(
        (candidate) => candidate.id === projectId,
      );
      return project ? [{ id: project.id, name: project.name }] : [];
    });
    const fallback = deterministicInteroProse({
      preferredLanguage: input.preferredLanguage,
      classification: input.classification,
      boundaryKey: input.boundaryKey,
      projectNames: scopedProjects.map((project) => project.name),
    });
    if (!this.model?.generateInteroProse) {
      return { prose: fallback, source: "deterministic_fallback" };
    }
    try {
      const prose = await this.model.generateInteroProse({
        organizationId: input.request.organizationId,
        preferredLanguage: input.preferredLanguage,
        scope: {
          kind: input.resolution.kind,
          projects: scopedProjects,
          evidence: input.resolution.evidence,
        },
        evaluation: {
          classification: input.classification,
          boundaryKey: input.boundaryKey,
          reason: input.reason,
          facts: input.scopedClaims.map((claim) => ({
            projectId: claim.projectId,
            relation: claim.relation,
            assumption: claim.assumption,
            change: claim.change,
            revision: claim.revision,
          })),
        },
      });
      return { prose, source: "provider" };
    } catch {
      return { prose: fallback, source: "deterministic_fallback" };
    }
  }

  private async writeScopeQuestion(
    request: PilotInteroRequest,
    resolution: Extract<PilotInteroScopeResolution, { kind: "ambiguous" }>,
    now: string,
  ): Promise<void> {
    const responseMessageId = interoResponseMessageId(request.sourceMessageId);
    await this.conversations.upsertCoordinationSummary({
      roomThreadId: request.sourceRoomThreadId,
      messageId: responseMessageId,
      senderId: request.interoPrincipalId,
      body: resolution.question,
      summary: {
        coordinationThreadId: request.id as ThreadId,
        interoRequestId: request.id,
        status: "waiting",
        situation: resolution.question,
        boundaryKey: `scope:${request.teamId}`,
        affectedPrincipalIds: [request.requestedByPrincipalId],
        conclusion: "",
        unresolvedQuestion: resolution.question,
        actionRequired: true,
        freshnessAt: now,
        sourceCount: 1,
        scope: {
          kind: "ambiguous",
          candidates: resolution.candidates.map((candidate) => ({
            projectId: candidate.projectId,
            name: candidate.name,
          })),
        },
      },
      at: request.createdAt,
    });
    await this.pilotStore.updateInteroRequest({
      requestId: request.id,
      status: "needs_scope",
      scopeResolution: resolution,
      responseMessageId,
      now,
    });
  }

  private async writeBoundedAnswer(
    request: PilotInteroRequest,
    resolution: Exclude<PilotInteroScopeResolution, { kind: "ambiguous" }>,
    body: string,
    boundaryKey: string,
    sourceCount: number,
    now: string,
  ): Promise<void> {
    const responseMessageId = interoResponseMessageId(request.sourceMessageId);
    await this.conversations.upsertCoordinationSummary({
      roomThreadId: request.sourceRoomThreadId,
      messageId: responseMessageId,
      senderId: request.interoPrincipalId,
      body,
      summary: {
        coordinationThreadId: request.id as ThreadId,
        interoRequestId: request.id,
        status: "resolved",
        situation: body,
        boundaryKey,
        affectedPrincipalIds: [request.requestedByPrincipalId],
        conclusion: body,
        unresolvedQuestion: "",
        actionRequired: false,
        freshnessAt: now,
        sourceCount,
        scope: {
          kind: resolution.kind,
          projectIds: resolution.projectIds,
        },
      },
      at: request.createdAt,
    });
    await this.pilotStore.updateInteroRequest({
      requestId: request.id,
      status: "answered",
      scopeResolution: resolution,
      responseMessageId,
      now,
    });
  }
}

function toJobReference(request: PilotInteroRequest): PilotInteroJobReference {
  return {
    schemaVersion: 1,
    organizationId: request.organizationId,
    requestId: request.id,
    scopeRevision: request.scopeRevision,
  };
}

function messageLanguage(body: string): "zh-CN" | "en-US" {
  return /[\u3400-\u9fff]/u.test(body) ? "zh-CN" : "en-US";
}

function deterministicInteroProse(input: {
  preferredLanguage: "zh-CN" | "en-US";
  classification: InteroProseInput["evaluation"]["classification"];
  boundaryKey: string;
  projectNames: string[];
}): PilotInteroProse {
  const scope = input.projectNames.join(", ") || input.boundaryKey;
  if (input.preferredLanguage === "zh-CN") {
    if (input.classification === "potential_conflict") {
      return {
        headline: `${input.boundaryKey} 可能存在冲突`,
        scopeExplanation: `本次仅使用已授权范围：${scope}。`,
        whatChanged: `当前 Work State 对共享边界 ${input.boundaryKey} 的假设不一致。`,
        whyItMatters:
          "若不先确定兼容窗口，其中一个项目可能依赖已经失效的约定。",
        needsFromYou: "请核对证据并由负责人确认兼容窗口。",
      };
    }
    if (input.classification === "compatible") {
      return {
        headline: `${input.boundaryKey} 当前兼容`,
        scopeExplanation: `本次仅使用已授权范围：${scope}。`,
        whatChanged: "当前共享边界证据显示双方约定仍然兼容。",
        whyItMatters: "目前不需要开启额外的协调讨论。",
        needsFromYou: "当前无需操作。",
      };
    }
    return {
      headline: `${input.boundaryKey} 证据不足`,
      scopeExplanation: `本次仅使用已授权范围：${scope}。`,
      whatChanged: "现有结构化证据不足以判断共享边界是否冲突。",
      whyItMatters: "Intero 不会在证据不足时推断冲突。",
      needsFromYou: "如需继续，请补充最新的共享边界 Work State。",
    };
  }
  if (input.classification === "potential_conflict") {
    return {
      headline: `Potential conflict on ${input.boundaryKey}`,
      scopeExplanation: `This uses only the authorized scope: ${scope}.`,
      whatChanged: `Current Work State contains incompatible assumptions about ${input.boundaryKey}.`,
      whyItMatters:
        "One Project could rely on a contract that the other Project is removing.",
      needsFromYou:
        "Review the evidence and have the responsible person confirm a compatibility window.",
    };
  }
  if (input.classification === "compatible") {
    return {
      headline: `${input.boundaryKey} is currently compatible`,
      scopeExplanation: `This uses only the authorized scope: ${scope}.`,
      whatChanged:
        "The current shared-boundary evidence shows compatible assumptions.",
      whyItMatters: "No additional coordination discussion is needed now.",
      needsFromYou: "No action is needed now.",
    };
  }
  return {
    headline: `Not enough evidence for ${input.boundaryKey}`,
    scopeExplanation: `This uses only the authorized scope: ${scope}.`,
    whatChanged:
      "The current structured evidence is insufficient to classify a shared-boundary conflict.",
    whyItMatters: "Intero will not infer a conflict without enough evidence.",
    needsFromYou:
      "Publish current shared-boundary Work State if this needs another review.",
  };
}

function renderInteroProse(prose: PilotInteroProse): string {
  return [
    prose.headline,
    prose.scopeExplanation,
    prose.whatChanged,
    prose.whyItMatters,
    prose.needsFromYou,
  ]
    .filter(Boolean)
    .join("\n\n");
}
