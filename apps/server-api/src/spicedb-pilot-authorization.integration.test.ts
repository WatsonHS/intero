import {
  OrganizationId,
  type PilotOrganization,
  type PilotProject,
  PrincipalId,
  ProjectId,
  uuidv7,
} from "@intero/domain";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  evaluatePilotAuthorizationContract,
  expectedPilotAuthorizationContract,
} from "./pilot-authorization.contract.js";
import { InMemoryPilotStore } from "./pilot-store.js";
import { SpiceDbAuthorization } from "./spicedb-authorization.js";
import { SpiceDbPilotAuthorization } from "./spicedb-pilot-authorization.js";

const endpoint = process.env.INTERO_SPICEDB_ENDPOINT;
const token = process.env.INTERO_SPICEDB_TOKEN;
const integrationSuite = endpoint && token ? describe : describe.skip;

integrationSuite("SpiceDB Pilot AuthorizationPort contract", () => {
  const organizationId = OrganizationId.parse(uuidv7());
  const administratorId = PrincipalId.parse(uuidv7());
  const memberId = PrincipalId.parse(uuidv7());
  const outsiderId = PrincipalId.parse(uuidv7());
  const teamId = uuidv7();
  const projectId = ProjectId.parse(uuidv7());
  const store = new InMemoryPilotStore();
  let spiceDb: SpiceDbAuthorization;

  beforeAll(async () => {
    await seedStore(store, {
      organizationId,
      administratorId,
      memberId,
      teamId,
      projectId,
    });
    spiceDb = new SpiceDbAuthorization({
      endpoint: endpoint!,
      token: token!,
      insecureLocalhost: true,
      timeoutMs: 2_000,
    });
    const schema = await readFile(
      new URL("../../../infra/spicedb/schema.zed", import.meta.url),
      "utf8",
    );
    await spiceDb.writeSchema(schema);
  });

  afterAll(() => spiceDb?.close());

  it("passes the same Pilot authorization contract as membership", async () => {
    await expect(
      evaluatePilotAuthorizationContract(
        new SpiceDbPilotAuthorization(store, spiceDb),
        {
          organizationId,
          teamId,
          projectId,
          administratorId,
          memberId,
          outsiderId,
        },
      ),
    ).resolves.toEqual(expectedPilotAuthorizationContract);
  });

  it("fails closed during outage and self-heals when SpiceDB recovers", async () => {
    const unavailable = new SpiceDbAuthorization({
      endpoint: "127.0.0.1:59999",
      token: "unused",
      insecureLocalhost: true,
      timeoutMs: 250,
    });
    await expect(
      new SpiceDbPilotAuthorization(store, unavailable).check({
        principalId: memberId,
        resourceType: "project",
        resourceId: projectId,
        permission: "participate",
      }),
    ).resolves.toEqual({ allowed: false });
    await expect(unavailable.checkReadiness()).resolves.toEqual({
      status: "unavailable",
      detail: "spicedb_unavailable",
    });
    unavailable.close();

    await expect(spiceDb.checkReadiness()).resolves.toEqual({
      status: "ready",
    });
    await expect(
      new SpiceDbPilotAuthorization(store, spiceDb).check({
        principalId: memberId,
        resourceType: "project",
        resourceId: projectId,
        permission: "participate",
      }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it("does not let a stale SpiceDB tuple widen normalized membership", async () => {
    await spiceDb.touchRelationship({
      resourceType: "project",
      resourceId: projectId,
      relation: "member",
      principalId: outsiderId,
    });
    await expect(
      new SpiceDbPilotAuthorization(store, spiceDb).check({
        principalId: outsiderId,
        resourceType: "project",
        resourceId: projectId,
        permission: "participate",
      }),
    ).resolves.toEqual({ allowed: false });
  });
});

async function seedStore(
  store: InMemoryPilotStore,
  fixture: {
    organizationId: OrganizationId;
    administratorId: PrincipalId;
    memberId: PrincipalId;
    teamId: string;
    projectId: ProjectId;
  },
): Promise<void> {
  const organization: PilotOrganization = {
    id: fixture.organizationId,
    name: "SpiceDB contract",
    deploymentBaseUrl: "http://127.0.0.1:4310",
    deploymentValidatedAt: "2026-07-26T03:00:00.000Z",
    provider: { configured: false },
  };
  await store.setupOrganization({
    organization,
    administratorId: fixture.administratorId,
    initialTeam: {
      id: fixture.teamId,
      organizationId: fixture.organizationId,
      name: "Platform",
      createdAt: "2026-07-26T03:00:00.000Z",
    },
  });
  const codeHash = fixture.organizationId.replaceAll("-", "").padEnd(64, "0");
  await store.createJoinLink(
    {
      id: uuidv7(),
      teamId: fixture.teamId,
      createdBy: fixture.administratorId,
      useCount: 0,
      createdAt: "2026-07-26T03:00:01.000Z",
    },
    codeHash,
    fixture.administratorId,
  );
  await store.redeemJoinLink(
    codeHash,
    fixture.memberId,
    "2026-07-26T03:00:02.000Z",
  );
  const project: PilotProject = {
    id: fixture.projectId,
    organizationId: fixture.organizationId,
    name: "Reliable collaboration",
    ownerId: fixture.administratorId,
    primaryTeamId: fixture.teamId,
    participatingTeamIds: [fixture.teamId],
    posture: "collaborative",
    createdAt: "2026-07-26T03:00:03.000Z",
    updatedAt: "2026-07-26T03:00:03.000Z",
  };
  await store.createProject(project);
}
