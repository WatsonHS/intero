import {
  type PilotProject,
  type PilotSharedBoundaryClaim,
  OrganizationId,
  PrincipalId,
  ProjectId,
  uuidv7,
} from "@intero/domain";
import { describe, expect, it } from "vitest";

import { resolveInteroScope } from "./intero-scope.js";

const TEAM_ID = uuidv7();
const ORGANIZATION_ID = OrganizationId.parse(uuidv7());
const ALEX = PrincipalId.parse(uuidv7());
const AUTH = ProjectId.parse(uuidv7());
const MOBILE = ProjectId.parse(uuidv7());
const RESTRICTED = ProjectId.parse(uuidv7());
const NOW = "2026-08-01T08:00:00.000Z";

const projects = [
  project(AUTH, "Auth Platform"),
  project(MOBILE, "Mobile App"),
];

describe("Intero Team-Room scope resolver", () => {
  it.each([
    {
      name: "single Project",
      messageBody: "Please check Auth Platform.",
      expected: { kind: "single_project", projectIds: [AUTH] },
    },
    {
      name: "cross Project",
      messageBody:
        "@Intero coordinate Auth Platform and Mobile App around retryDelayMs.",
      expected: { kind: "cross_project", projectIds: [AUTH, MOBILE] },
    },
    {
      name: "whole Team",
      messageBody: "@Intero review this whole team.",
      expected: { kind: "team", projectIds: [AUTH, MOBILE] },
    },
    {
      name: "ambiguous",
      messageBody: "@Intero can you check this?",
      expected: { kind: "ambiguous" },
    },
  ])(
    "resolves $name without provider inference",
    ({ messageBody, expected }) => {
      expect(
        resolveInteroScope({
          teamId: TEAM_ID,
          messageBody,
          eligibleProjects: projects,
          authorizedClaims: [
            claim(AUTH, "changing", "replace retryDelayMs"),
            claim(MOBILE, "depending_on", "retryDelayMs"),
          ],
        }),
      ).toMatchObject(expected);
    },
  );

  it("uses the Room Project when a shared Room is explicitly Project-bound", () => {
    expect(
      resolveInteroScope({
        teamId: TEAM_ID,
        messageBody: "@Intero summarize the current risk.",
        eligibleProjects: projects,
        roomProjectId: AUTH,
      }),
    ).toMatchObject({ kind: "single_project", projectIds: [AUTH] });
  });

  it("uses a mentioned participant's authorized Work State without widening the eligible set", () => {
    const priya = PrincipalId.parse(uuidv7());
    const mobileClaim = {
      ...claim(MOBILE, "depending_on", "retryDelayMs"),
      ownerId: priya,
    };
    const result = resolveInteroScope({
      teamId: TEAM_ID,
      messageBody: "@Intero check the work Priya just reported.",
      eligibleProjects: projects,
      authorizedClaims: [mobileClaim],
      mentionedPrincipalIds: [priya],
    });

    expect(result).toMatchObject({
      kind: "single_project",
      projectIds: [MOBILE],
      evidence: [
        {
          kind: "participant_work_state",
          projectId: MOBILE,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(RESTRICTED);
  });

  it("accepts an authorized correction and rejects scope widening", () => {
    expect(
      resolveInteroScope({
        teamId: TEAM_ID,
        messageBody: "unused after correction",
        eligibleProjects: projects,
        correctedProjectIds: [AUTH, MOBILE],
      }),
    ).toMatchObject({ kind: "cross_project", projectIds: [AUTH, MOBILE] });

    expect(() =>
      resolveInteroScope({
        teamId: TEAM_ID,
        messageBody: "unused after correction",
        eligibleProjects: projects,
        correctedProjectIds: [AUTH, RESTRICTED],
      }),
    ).toThrow("ineligible Project");
  });

  it("never exposes candidates that were removed by authorization", () => {
    const result = resolveInteroScope({
      teamId: TEAM_ID,
      messageBody: "@Intero can you check this?",
      eligibleProjects: projects,
    });
    expect(JSON.stringify(result)).not.toContain(RESTRICTED);
  });

  it("asks the bounded scope question in the request language", () => {
    expect(
      resolveInteroScope({
        teamId: TEAM_ID,
        messageBody: "@Intero 帮我看一下",
        preferredLanguage: "zh-CN",
        eligibleProjects: projects,
      }),
    ).toMatchObject({
      kind: "ambiguous",
      question: "这次请求需要 Intero 使用哪个或哪些项目？",
    });
  });
});

function project(id: ProjectId, name: string): PilotProject {
  return {
    id,
    organizationId: ORGANIZATION_ID,
    name,
    ownerId: ALEX,
    primaryTeamId: TEAM_ID,
    participatingTeamIds: [TEAM_ID],
    posture: "collaborative",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function claim(
  projectId: ProjectId,
  relation: PilotSharedBoundaryClaim["relation"],
  assumption: string,
): PilotSharedBoundaryClaim {
  return {
    id: uuidv7(),
    projectId,
    workStateId: uuidv7(),
    ownerId: projectId === AUTH ? ALEX : PrincipalId.parse(uuidv7()),
    bindingId: uuidv7(),
    checkpointClientEventId: `golden-${uuidv7()}`,
    key: "api:retry-config/retryDelayMs",
    kind: "api",
    relation,
    assumption,
    change: relation === "changing" ? "breaking" : "unknown",
    preserves: [],
    revision: 1,
    observedAt: NOW,
    createdAt: NOW,
  };
}
