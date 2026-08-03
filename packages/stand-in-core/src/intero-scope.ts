import type {
  PilotInteroScopeEvidence,
  PilotInteroScopeResolution,
  PilotProject,
  PilotSharedBoundaryClaim,
  PrincipalId,
  ProjectId,
} from "@intero/domain";

import { normalizeSharedBoundaryKey } from "./shared-boundary.js";

export interface ResolveInteroScopeInput {
  teamId: string;
  messageBody: string;
  preferredLanguage?: "zh-CN" | "en-US";
  eligibleProjects: PilotProject[];
  authorizedClaims?: PilotSharedBoundaryClaim[];
  mentionedPrincipalIds?: PrincipalId[];
  roomProjectId?: ProjectId;
  correctedProjectIds?: ProjectId[];
  correctedScopeKind?: "team";
}

/**
 * Resolve scope only inside an authorization-filtered Project set. This pure
 * router never receives inaccessible candidates, so neither its result nor an
 * ambiguous question can reveal that such Projects exist.
 */
export function resolveInteroScope(
  input: ResolveInteroScopeInput,
): PilotInteroScopeResolution {
  const projects = uniqueProjects(input.eligibleProjects).filter((project) =>
    project.participatingTeamIds.includes(input.teamId),
  );
  const eligibleIds = new Set(projects.map((project) => project.id));
  const claims = (input.authorizedClaims ?? []).filter((claim) =>
    eligibleIds.has(claim.projectId),
  );

  if (input.correctedScopeKind === "team") {
    if (projects.length === 0) {
      return {
        kind: "ambiguous",
        teamId: input.teamId,
        candidates: [],
        question: scopeQuestion(input.preferredLanguage, false),
      };
    }
    return {
      kind: "team",
      teamId: input.teamId,
      projectIds: projects.map((project) => project.id),
      evidence: [
        {
          kind: "human_correction",
          detail:
            "A Room participant explicitly corrected this request to the authorized Team scope.",
        },
      ],
    };
  }

  if (input.correctedProjectIds) {
    const corrected = [...new Set(input.correctedProjectIds)].filter((id) =>
      eligibleIds.has(id),
    );
    if (corrected.length !== new Set(input.correctedProjectIds).size) {
      throw new Error(
        "Intero scope correction includes an ineligible Project.",
      );
    }
    return resolvedScope(
      input.teamId,
      corrected,
      corrected.map((projectId): PilotInteroScopeEvidence => ({
        kind: "human_correction",
        projectId,
        detail: "A Room participant explicitly corrected the Project scope.",
      })),
      input.preferredLanguage,
    );
  }

  const body = normalizeText(input.messageBody);
  const evidenceByProject = new Map<ProjectId, PilotInteroScopeEvidence[]>();
  const addEvidence = (
    projectId: ProjectId,
    evidence: PilotInteroScopeEvidence,
  ) => {
    const current = evidenceByProject.get(projectId) ?? [];
    if (
      !current.some(
        (item) =>
          item.kind === evidence.kind && item.detail === evidence.detail,
      )
    ) {
      current.push(evidence);
      evidenceByProject.set(projectId, current);
    }
  };

  const mentionedPrincipals = new Set(input.mentionedPrincipalIds ?? []);
  for (const claim of claims) {
    if (mentionedPrincipals.has(claim.ownerId)) {
      addEvidence(claim.projectId, {
        kind: "participant_work_state",
        projectId: claim.projectId,
        detail:
          "A mentioned Room participant has authorized Work State in this Project.",
      });
    }
  }

  for (const project of projects) {
    if (
      body.includes(normalizeText(project.id)) ||
      body.includes(normalizeText(project.name))
    ) {
      addEvidence(project.id, {
        kind: "exact_project",
        projectId: project.id,
        detail: `The Room message names ${project.name}.`,
      });
    }
  }
  for (const claim of claims) {
    const identifiers = [
      normalizeSharedBoundaryKey(claim.key),
      normalizeText(claim.assumption),
      ...claim.preserves.map(normalizeText),
    ].filter((value) => value.length >= 3);
    if (identifiers.some((identifier) => body.includes(identifier))) {
      addEvidence(claim.projectId, {
        kind: "exact_boundary",
        projectId: claim.projectId,
        detail: `The message references shared boundary ${normalizeSharedBoundaryKey(claim.key)}.`,
      });
    }
  }

  const explicitProjectIds = projects
    .filter((project) => evidenceByProject.has(project.id))
    .map((project) => project.id);
  if (explicitProjectIds.length > 0) {
    return resolvedScope(
      input.teamId,
      explicitProjectIds,
      explicitProjectIds.flatMap(
        (projectId) => evidenceByProject.get(projectId) ?? [],
      ),
      input.preferredLanguage,
    );
  }

  if (isExplicitTeamScope(body)) {
    return {
      kind: "team",
      teamId: input.teamId,
      projectIds: projects.map((project) => project.id),
      evidence: [
        {
          kind: "team_explicit",
          detail:
            "The Room message explicitly asks about the whole Team scope.",
        },
      ],
    };
  }

  if (input.roomProjectId && eligibleIds.has(input.roomProjectId)) {
    return {
      kind: "single_project",
      teamId: input.teamId,
      projectIds: [input.roomProjectId],
      evidence: [
        {
          kind: "room_project",
          projectId: input.roomProjectId,
          detail: "The source Room is explicitly bound to this Project.",
        },
      ],
    };
  }
  if (projects.length === 1) {
    return {
      kind: "single_project",
      teamId: input.teamId,
      projectIds: [projects[0]!.id],
      evidence: [
        {
          kind: "team_membership",
          projectId: projects[0]!.id,
          detail:
            "This is the only authorized Project participating in the Room Team.",
        },
      ],
    };
  }

  return {
    kind: "ambiguous",
    teamId: input.teamId,
    candidates: projects.map((project) => ({
      projectId: project.id,
      name: project.name,
      evidence: [
        {
          kind: "team_membership",
          projectId: project.id,
          detail: `${project.name} participates in the source Room Team.`,
        },
      ],
    })),
    question:
      projects.length > 0
        ? scopeQuestion(input.preferredLanguage, true)
        : scopeQuestion(input.preferredLanguage, false),
  };
}

function resolvedScope(
  teamId: string,
  projectIds: ProjectId[],
  evidence: PilotInteroScopeEvidence[],
  preferredLanguage: "zh-CN" | "en-US" = "en-US",
): PilotInteroScopeResolution {
  if (projectIds.length === 0) {
    return {
      kind: "ambiguous",
      teamId,
      candidates: [],
      question: scopeQuestion(preferredLanguage, false),
    };
  }
  return projectIds.length === 1
    ? { kind: "single_project", teamId, projectIds, evidence }
    : { kind: "cross_project", teamId, projectIds, evidence };
}

function scopeQuestion(
  preferredLanguage: "zh-CN" | "en-US" = "en-US",
  plural: boolean,
): string {
  if (preferredLanguage === "zh-CN") {
    return plural
      ? "这次请求需要 Intero 使用哪个或哪些项目？"
      : "这次请求需要 Intero 使用哪个已授权项目？";
  }
  return plural
    ? "Which Project or Projects should Intero use for this request?"
    : "Which authorized Project should Intero use for this request?";
}

function uniqueProjects(projects: PilotProject[]): PilotProject[] {
  return [
    ...new Map(projects.map((project) => [project.id, project])).values(),
  ].toSorted((left, right) => left.name.localeCompare(right.name));
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function isExplicitTeamScope(body: string): boolean {
  return /(?:\bwhole team\b|\bteam-wide\b|\bthis team\b|整个团队|全团队|团队范围)/u.test(
    body,
  );
}
