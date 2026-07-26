import type { AuthorizationPort } from "./ports.js";

export interface PilotAuthorizationContractFixture {
  organizationId: string;
  teamId: string;
  projectId: string;
  administratorId: string;
  memberId: string;
  outsiderId: string;
}

export async function evaluatePilotAuthorizationContract(
  authorization: AuthorizationPort,
  fixture: PilotAuthorizationContractFixture,
): Promise<Record<string, boolean>> {
  const cases = [
    {
      name: "administrator",
      principalId: fixture.administratorId,
      permission: "admin",
      resourceType: "organization",
      resourceId: fixture.organizationId,
    },
    {
      name: "team-member",
      principalId: fixture.memberId,
      permission: "participate",
      resourceType: "team",
      resourceId: fixture.teamId,
    },
    {
      name: "project-member",
      principalId: fixture.memberId,
      permission: "participate",
      resourceType: "project",
      resourceId: fixture.projectId,
    },
    {
      name: "member-cannot-manage",
      principalId: fixture.memberId,
      permission: "manage_collaboration",
      resourceType: "project",
      resourceId: fixture.projectId,
    },
    {
      name: "outsider-denied",
      principalId: fixture.outsiderId,
      permission: "participate",
      resourceType: "project",
      resourceId: fixture.projectId,
    },
  ] as const;
  return Object.fromEntries(
    await Promise.all(
      cases.map(async (contractCase) => [
        contractCase.name,
        (
          await authorization.check({
            principalId: contractCase.principalId,
            permission: contractCase.permission,
            resourceType: contractCase.resourceType,
            resourceId: contractCase.resourceId,
          })
        ).allowed,
      ]),
    ),
  );
}

export const expectedPilotAuthorizationContract = {
  administrator: true,
  "team-member": true,
  "project-member": true,
  "member-cannot-manage": false,
  "outsider-denied": false,
} as const;
