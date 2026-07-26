import type {
  Feature,
  PublicWorkProjection,
  WorkHistoryEntry,
  WorkItem,
  WorkstreamPhase,
} from "@intero/domain";

import type { ProjectWorkPayload } from "../api.js";
import type { WorkLine } from "./work-lines.js";

/**
 * Project work (Work Items and Features) is a third source of Team Pulse
 * projections, alongside the cloud service and pilot pulse entries. Every
 * surface that shows what someone has in flight must merge all three, or a
 * person's parallel work silently loses whichever source it skipped.
 */

export type ProjectPulseContext = {
  kind: "work_item" | "feature";
  description: string;
  statusLabel: string;
  completedOutcome?: string;
  evidence?: string;
  blockers: string[];
  nextStep: string;
  source: string;
  updatedAt: string;
};

export function projectWorkToPulse(data: ProjectWorkPayload): {
  projections: PublicWorkProjection[];
  contexts: Map<string, ProjectPulseContext>;
} {
  const contexts = new Map<string, ProjectPulseContext>();
  const workItemTitles = new Map(
    data.workItems.map((item) => [item.id, item.title]),
  );
  const projections: PublicWorkProjection[] = [];
  for (const item of data.workItems) {
    if (!item.ownerId) continue;
    const blockers = blockersFor(item, data, workItemTitles);
    const latestHistory = data.history
      .filter((entry) => entry.workItemId === item.id)
      .at(-1);
    projections.push({
      id: item.id as unknown as PublicWorkProjection["id"],
      projectId: item.projectId,
      ownerId: item.ownerId,
      title: item.title,
      phase: blockers.length > 0 ? "blocked" : phaseForWorkItem(item.status),
      blockers,
      dependencies: [],
      decisions: [],
      artifactIds: [],
      freshnessAt: item.updatedAt,
      confidence: 1,
      contradictionClaimIds: [],
      version: data.history.filter((entry) => entry.workItemId === item.id)
        .length,
      changedFields: ["phase"],
      projectedAt: item.updatedAt,
    });
    contexts.set(item.id, {
      kind: "work_item",
      description: item.description,
      statusLabel: workItemStatusLabel(item.status),
      ...(item.status === "done" ? { completedOutcome: item.title } : {}),
      ...(item.completionEvidence ? { evidence: item.completionEvidence } : {}),
      blockers,
      nextStep: workItemNextStep(item.status),
      source: historySource(latestHistory),
      updatedAt: item.updatedAt,
    });
  }
  const parentFeatureIds = new Set(
    data.workItems.flatMap((item) => (item.featureId ? [item.featureId] : [])),
  );
  for (const feature of data.features) {
    if (!feature.ownerId || parentFeatureIds.has(feature.id)) continue;
    projections.push({
      id: feature.id as unknown as PublicWorkProjection["id"],
      projectId: feature.projectId,
      ownerId: feature.ownerId,
      title: feature.title,
      phase: phaseForFeature(feature.stage),
      blockers: [],
      dependencies: [],
      decisions: [],
      artifactIds: [],
      freshnessAt: feature.updatedAt,
      confidence: 1,
      contradictionClaimIds: [],
      version: 1,
      changedFields: ["phase"],
      projectedAt: feature.updatedAt,
    });
    contexts.set(feature.id, {
      kind: "feature",
      description: feature.description,
      statusLabel: feature.stage.replaceAll("_", " "),
      ...(feature.stage === "released"
        ? { completedOutcome: feature.title }
        : {}),
      blockers: [],
      nextStep:
        feature.stage === "planned"
          ? "开始开发"
          : feature.stage === "in_development"
            ? "完成并发布"
            : "观察发布结果",
      source: "Project Feature",
      updatedAt: feature.updatedAt,
    });
  }
  return { projections, contexts };
}

function blockersFor(
  item: WorkItem,
  data: ProjectWorkPayload,
  titles: Map<string, string>,
): string[] {
  return data.relations.flatMap((relation) => {
    if (relation.sourceId === item.id && relation.kind === "blocked_by") {
      return [`受 ${titles.get(relation.targetId) ?? "另一 Work Item"} 阻塞`];
    }
    if (relation.targetId === item.id && relation.kind === "blocks") {
      return [`受 ${titles.get(relation.sourceId) ?? "另一 Work Item"} 阻塞`];
    }
    return [];
  });
}

function phaseForWorkItem(status: WorkItem["status"]): WorkstreamPhase {
  if (status === "done") return "completed";
  if (status === "ready_for_test") return "validating";
  if (status === "in_progress") return "implementing";
  return "planning";
}

function phaseForFeature(stage: Feature["stage"]): WorkstreamPhase {
  if (stage === "released") return "completed";
  if (stage === "in_development") return "implementing";
  return "planning";
}

function workItemStatusLabel(status: WorkItem["status"]): string {
  if (status === "ready_for_test") return "等待测试";
  if (status === "in_progress") return "开发中";
  if (status === "done") return "已完成";
  return "待开始";
}

function workItemNextStep(status: WorkItem["status"]): string {
  if (status === "ready_for_test") return "由项目参与者完成验收";
  if (status === "in_progress") return "继续开发并提交验证依据";
  if (status === "done") return "观察结果或领取下一项工作";
  return "开始工作";
}

function historySource(history: WorkHistoryEntry | undefined): string {
  if (!history) return "Project Work";
  return history.actor.kind === "agent"
    ? "Connected Coding Agent"
    : "Intero member";
}

export function workLineFromProjectContext(
  context: ProjectPulseContext,
): WorkLine {
  return {
    focus: context.description || context.statusLabel,
    ...(context.completedOutcome ? { done: context.completedOutcome } : {}),
    ...(context.evidence ? { evidence: context.evidence } : {}),
    next: context.nextStep,
    ...(context.blockers.length > 0
      ? { collaboration: context.blockers.join("；") }
      : {}),
  };
}
