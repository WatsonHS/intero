import type { PilotProject, PrincipalId } from "@intero/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeProvider } from "../../design/theme.js";
import { NotificationProvider } from "../../design/notifications.js";
import { I18nProvider } from "../../i18n/index.js";
import type {
  PilotOrganizationDirectoryPayload,
  PilotTeamPayload,
} from "../../pilot/api.js";
import { OrganizationTab } from "./OrganizationTab.js";
import { ownerForPrimaryTeam, ProjectsTab } from "./ProjectsTab.js";
import { TeamPicker } from "./TeamPicker.js";
import { TeamsTab } from "./TeamsTab.js";

const ALEX = "019b5ac0-7600-7000-8000-0000000000a1" as PrincipalId;
const PRIYA = "019b5ac0-7600-7000-8000-0000000000b2" as PrincipalId;
const PRODUCT = "019b5ac0-7600-7000-8000-000000000301";
const PLATFORM = "019b5ac0-7600-7000-8000-000000000302";

function render(node: ReactNode): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider>
          <NotificationProvider>{node}</NotificationProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const teams: PilotTeamPayload[] = [
  {
    id: PRODUCT,
    organizationId: "019b5ac0-7600-7000-8000-000000000001" as never,
    name: "产品体验",
    createdAt: "2026-07-01T00:00:00.000Z",
    members: [
      {
        id: ALEX,
        displayName: "Alex Rivera",
        kind: "human",
        email: "alex@intero.test",
        teamRole: "leader",
        organizationRole: "admin",
      },
    ],
  },
  {
    id: PLATFORM,
    organizationId: "019b5ac0-7600-7000-8000-000000000001" as never,
    name: "开发者平台",
    createdAt: "2026-07-02T00:00:00.000Z",
    members: [
      {
        id: PRIYA,
        displayName: "Priya Shah",
        kind: "human",
        email: "priya@intero.test",
        teamRole: "member",
      },
    ],
  },
];

const projects: PilotProject[] = [
  {
    id: "019b5ac0-7600-7000-8000-000000000401" as never,
    organizationId: "019b5ac0-7600-7000-8000-000000000001" as never,
    name: "协作链路",
    ownerId: ALEX,
    primaryTeamId: PRODUCT,
    participatingTeamIds: [PRODUCT, PLATFORM],
    posture: "paused",
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
  },
];

const directoryMembers: PilotOrganizationDirectoryPayload["members"] = [
  {
    id: ALEX,
    displayName: "Alex Rivera",
    kind: "human",
    email: "alex@intero.test",
    organizationRole: "admin",
    teamIds: [PRODUCT],
  },
  {
    id: PRIYA,
    displayName: "Priya Shah",
    kind: "human",
    email: "priya@intero.test",
    organizationRole: "member",
    teamIds: [PLATFORM],
  },
];

describe("governance tabs", () => {
  it("lists every governed team with its lead, size and project count", () => {
    const output = render(
      <TeamsTab
        teams={teams}
        projects={projects}
        identityId={ALEX}
        canCreate
        canManage={() => true}
        canDelete
        scopedToOwnTeams={false}
        onOpenMembers={() => undefined}
        onChanged={() => undefined}
      />,
    );

    expect(output).toContain("产品体验");
    expect(output).toContain("开发者平台");
    expect(output).toContain("Lead：Alex Rivera");
    // The second team has no leader, and that is stated rather than blanked.
    expect(output).toContain("这个团队还没有指定 Lead");
    expect(output).toContain("新建团队");
    expect(output).toContain("1 个项目");
    expect(output).toContain("删除团队 产品体验");
    expect(output).not.toContain(">当前<");
    expect(output).not.toContain("切换过去");
  });

  it("hides the team-creating affordances from a Team Lead", () => {
    const output = render(
      <TeamsTab
        teams={[teams[0]!]}
        projects={projects}
        identityId={ALEX}
        canCreate={false}
        canManage={() => false}
        canDelete={false}
        scopedToOwnTeams
        onOpenMembers={() => undefined}
        onChanged={() => undefined}
      />,
    );

    expect(output).not.toContain("admin-create-team");
    expect(output).not.toContain(">重命名<");
    expect(output).not.toContain("删除团队 产品体验");
    expect(output).toContain("你所在的团队");
    // Reaching a roster is not a privilege — it is how you read the team.
    expect(output).toContain(">成员<");
  });

  it("offers the roster's team as a menu, and as a plain label when there is one", () => {
    const many = render(
      <TeamPicker teams={teams} value={teams[0]} onChange={() => undefined} />,
    );
    expect(many).toContain("admin-members-team-picker");
    expect(many).toContain("产品体验");

    const single = render(
      <TeamPicker
        teams={[teams[0]!]}
        value={teams[0]}
        onChange={() => undefined}
      />,
    );
    // One team is not a choice, so it must not look like one.
    expect(single).not.toContain("admin-members-team-picker");
    expect(single).toContain("产品体验");
  });

  it("shows a project's owning team, participants, posture and owner", () => {
    const output = render(
      <ProjectsTab
        projects={projects}
        teams={teams}
        ownTeamIds={[PRODUCT]}
        names={new Map([[ALEX, "Alex Rivera"]])}
        identityId={ALEX}
        canManage={() => true}
        onChanged={() => undefined}
      />,
    );

    expect(output).toContain("协作链路");
    expect(output).toContain("归属 产品体验");
    expect(output).toContain("开发者平台");
    expect(output).toContain("已暂停");
    expect(output).toContain("Alex Rivera");
    expect(output).toContain("编辑");
  });

  it("keeps a valid owner when changing teams and otherwise prefers the new team lead", () => {
    expect(ownerForPrimaryTeam(teams[0], ALEX)).toBe(ALEX);
    expect(ownerForPrimaryTeam(teams[0], PRIYA)).toBe(ALEX);
    expect(ownerForPrimaryTeam(teams[1], ALEX)).toBe(PRIYA);
  });

  it("keeps the project editor out of reach of someone who cannot govern it", () => {
    const output = render(
      <ProjectsTab
        projects={projects}
        teams={teams}
        ownTeamIds={[]}
        names={new Map()}
        identityId={PRIYA}
        canManage={() => false}
        onChanged={() => undefined}
      />,
    );

    expect(output).not.toContain("新建项目");
    expect(output).not.toContain(">编辑<");
  });

  it("names the organization and lists everyone across teams", () => {
    const output = render(
      <OrganizationTab
        organization={{
          id: "019b5ac0-7600-7000-8000-000000000001" as never,
          name: "Intero Pilot",
          deploymentBaseUrl: "https://intero.test",
          deploymentValidatedAt: "2026-07-01T00:00:00.000Z",
          provider: { configured: true },
        }}
        teams={teams}
        projects={projects}
        members={directoryMembers}
        identityId={ALEX}
        canManage
        onOpenService={() => undefined}
        onChanged={() => undefined}
      />,
    );

    expect(output).toContain("Intero Pilot");
    expect(output).toContain("https://intero.test");
    expect(output).toContain("Priya Shah");
    expect(output).toContain("priya@intero.test");
    expect(output).toContain("组织管理员");
    expect(output).toContain("重命名");
    // Counts come from the directory, not from the viewer's own memberships.
    expect(output).toContain(">2<");
  });

  it("makes the organization read-only for a viewer who cannot manage it", () => {
    const output = render(
      <OrganizationTab
        organization={undefined}
        teams={teams}
        projects={projects}
        members={directoryMembers}
        identityId={PRIYA}
        canManage={false}
        onOpenService={() => undefined}
        onChanged={() => undefined}
      />,
    );

    expect(output).toContain("只读");
    expect(output).not.toContain("重命名");
  });
});
