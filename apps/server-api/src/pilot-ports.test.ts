import {
  OrganizationId,
  type PilotAgentBinding,
  type PilotCheckpointInput,
  type PilotOrganization,
  type PilotProject,
  PrincipalId,
  ProjectId,
  uuidv7,
} from "@intero/domain";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import {
  DisabledObjectStoreAdapter,
  InlineJobRunner,
  MembershipAuthorizationAdapter,
  PollingRealtimeAdapter,
  ProjectInternalCoordinationTransport,
  type PilotStandInJob,
} from "./pilot-ports.js";
import {
  evaluatePilotAuthorizationContract,
  expectedPilotAuthorizationContract,
} from "./pilot-authorization.contract.js";
import { exerciseRealtimeContract } from "./pilot-realtime.contract.js";
import { InMemoryPilotStore, type PilotStore } from "./pilot-store.js";
import { AesGcmProviderSecretCipher } from "./provider-secrets.js";
import { VercelAiModelGateway } from "./vercel-model-gateway.js";

const ADMIN = PrincipalId.parse("019b5ac0-7600-7000-8000-0000000000a1");
const MEMBER = PrincipalId.parse("019b5ac0-7600-7000-8000-0000000000b2");
const OUTSIDER = PrincipalId.parse("019b5ac0-7600-7000-8000-0000000000c3");
const ORGANIZATION_ID = OrganizationId.parse(
  "019b5ac0-7600-7000-8000-000000000001",
);

let server: Server | undefined;

afterEach(
  () =>
    new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => {
        server = undefined;
        resolve();
      });
    }),
);

describe("pilot adapter contracts", () => {
  it("keeps authorization derived from organization, team, and project membership", async () => {
    const { store, teamId, project } = await seededStore();
    const authorization = new MembershipAuthorizationAdapter(store);

    await expect(
      authorization.check({
        principalId: ADMIN,
        permission: "admin",
        resourceType: "organization",
        resourceId: ORGANIZATION_ID,
      }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      authorization.check({
        principalId: MEMBER,
        permission: "manage_members",
        resourceType: "team",
        resourceId: teamId,
      }),
    ).resolves.toEqual({ allowed: false });
    await store.updateTeamMemberRole({
      teamId,
      memberId: MEMBER,
      role: "leader",
      principalId: ADMIN,
      now: "2026-07-26T03:00:04.000Z",
    });
    await expect(
      authorization.check({
        principalId: MEMBER,
        permission: "manage_members",
        resourceType: "team",
        resourceId: teamId,
      }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      authorization.check({
        principalId: ADMIN,
        permission: "manage_members",
        resourceType: "team",
        resourceId: teamId,
      }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      authorization.check({
        principalId: MEMBER,
        permission: "participate",
        resourceType: "team",
        resourceId: teamId,
      }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      authorization.check({
        principalId: MEMBER,
        permission: "participate",
        resourceType: "project",
        resourceId: project.id,
      }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      authorization.check({
        principalId: MEMBER,
        permission: "manage_collaboration",
        resourceType: "project",
        resourceId: project.id,
      }),
    ).resolves.toEqual({ allowed: false });
    await expect(
      authorization.check({
        principalId: OUTSIDER,
        permission: "participate",
        resourceType: "project",
        resourceId: project.id,
      }),
    ).resolves.toEqual({ allowed: false });
    await expect(
      evaluatePilotAuthorizationContract(authorization, {
        organizationId: ORGANIZATION_ID,
        teamId,
        projectId: project.id,
        administratorId: ADMIN,
        memberId: MEMBER,
        outsiderId: OUTSIDER,
      }),
    ).resolves.toEqual(expectedPilotAuthorizationContract);
  });

  it("exposes polling realtime and disabled object storage behind stable ports", async () => {
    const realtime = new PollingRealtimeAdapter();
    await expect(exerciseRealtimeContract(realtime)).resolves.toBeUndefined();
    expect(realtime.mode).toBe("polling");

    const objectStore = new DisabledObjectStoreAdapter();
    await expect(
      objectStore.createUpload({
        objectId: uuidv7(),
        purpose: "artifact",
        checksumSha256: "0".repeat(64),
        byteSize: 1,
        contentType: "text/plain",
        encrypted: true,
      }),
    ).rejects.toMatchObject({ code: "OBJECT_STORAGE_DISABLED" });
  });

  it("runs jobs inline and reports failures without throwing through ingress", async () => {
    const completed: string[] = [];
    const runner = new InlineJobRunner(async (job) => {
      completed.push(job.id);
    });
    const job = standInJob();
    await expect(runner.dispatch(job)).resolves.toEqual({
      status: "completed",
    });
    expect(completed).toEqual([job.id]);

    const failing = new InlineJobRunner(async () => {
      throw new Error("worker failed");
    });
    await expect(failing.dispatch(job)).resolves.toEqual({
      status: "failed",
      errorCode: "STAND_IN_JOB_FAILED",
    });
  });

  it("keeps coordination project-internal and bounded", async () => {
    const { store, project, binding, checkpoint, workStateId } =
      await seededCheckpoint();
    const transport = new ProjectInternalCoordinationTransport(store);
    const opened = await transport.openOrRefresh({
      project,
      binding,
      checkpoint,
      workStateId,
      safeContext: "Schema ownership needs confirmation.",
      candidateNextSteps: [
        "Confirm the responsible owner",
        "Agree on the handoff boundary",
      ],
      now: "2026-07-25T08:01:00.000Z",
    });
    expect(opened).toMatchObject({
      projectId: project.id,
      trigger: "blocker_raised",
      status: "open",
      candidateNextSteps: [
        "Confirm the responsible owner",
        "Agree on the handoff boundary",
      ],
    });
    await expect(transport.list(project.id, MEMBER)).resolves.toHaveLength(1);
    await expect(transport.list(project.id, OUTSIDER)).rejects.toMatchObject({
      code: "PROJECT_PARTICIPATION_REQUIRED",
    });
  });

  it("uses the Vercel AI SDK through the model-neutral gateway contract", async () => {
    const output = {
      safeSummary: "Checkpoint is ready for team review.",
      narrative: {
        currentFocus: "Preparing the checkpoint for team review.",
        completedOutcome: "The checkpoint is ready for team review.",
        evidence: ["The contract suite passed."],
        nextStep: "Assign a responsible reviewer.",
        collaboration: {
          needed: true,
          request: "Confirm a responsible reviewer.",
          requestedFrom: "Project owner",
        },
      },
      coordination: {
        shouldOpen: true,
        safeContext: "Review ownership needs confirmation.",
        candidateNextSteps: ["Confirm a responsible reviewer"],
      },
    };
    const sourceWorkStateId = uuidv7();
    let requestCount = 0;
    const requestBodies: Array<Record<string, unknown>> = [];
    server = createServer((request, response) => {
      if (request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requestBodies.push(
          JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
            string,
            unknown
          >,
        );
        response.setHeader("content-type", "application/json");
        requestCount += 1;
        const responseOutput =
          requestCount === 1
            ? output
            : {
                answer: "The checkpoint is ready for team review.",
                currentStatus: "The checkpoint is ready for review.",
                completedOutcome: "The checkpoint contract is complete.",
                evidence: ["The contract suite passed."],
                nextStep: "Assign a responsible reviewer.",
                neededCollaboration:
                  "The project owner should confirm a reviewer.",
                sourceWorkStateIds: [sourceWorkStateId],
              };
        response.end(
          JSON.stringify({
            id: "chatcmpl-intero-pilot",
            object: "chat.completion",
            created: 1,
            model: "pilot-model",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify(responseOutput),
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test provider failed to bind.");
    }
    const secrets = new AesGcmProviderSecretCipher("adapter-contract-secret");
    const gateway = new VercelAiModelGateway(
      async () => ({
        endpoint: `http://127.0.0.1:${address.port}/v1`,
        defaultModel: "pilot-model",
        encryptedApiKey: secrets.encrypt("server-only-api-key"),
      }),
      secrets,
    );

    await expect(
      gateway.generateStandInOutput({
        organizationId: ORGANIZATION_ID,
        project: {
          id: ProjectId.parse("019b5ac0-7600-7000-8000-000000000011"),
          name: "Intero Pilot",
          posture: "collaborative",
        },
        ownerId: ADMIN,
        binding: {
          id: uuidv7(),
          client: "codex",
          name: "Codex Pilot",
        },
        checkpoint: checkpointFor(
          ProjectId.parse("019b5ac0-7600-7000-8000-000000000011"),
        ),
      }),
    ).resolves.toEqual(output);

    await expect(
      gateway.answerStandInQuestion({
        organizationId: ORGANIZATION_ID,
        project: {
          id: ProjectId.parse("019b5ac0-7600-7000-8000-000000000011"),
          name: "Intero Pilot",
          posture: "collaborative",
        },
        principalId: MEMBER,
        question: "What is the current status?",
        sources: [
          {
            id: uuidv7(),
            projectId: ProjectId.parse("019b5ac0-7600-7000-8000-000000000011"),
            workStateId: sourceWorkStateId,
            ownerId: ADMIN,
            title: "Cloud MCP",
            phase: "implementing",
            eventType: "work_progressed",
            summary: "The checkpoint is ready for team review.",
            narrative: output.narrative,
            freshnessAt: "2026-07-25T08:00:00.000Z",
            provenance: {
              source: "direct_cloud_mcp",
              client: "codex",
              connectionName: "Codex Pilot",
              clientEventId: "client-event-grounded-answer-0001",
              occurredAt: "2026-07-25T08:00:00.000Z",
              receivedAt: "2026-07-25T08:00:01.000Z",
            },
            publishedAt: "2026-07-25T08:00:01.000Z",
          },
        ],
      }),
    ).resolves.toEqual({
      answer: "The checkpoint is ready for team review.",
      currentStatus: "The checkpoint is ready for review.",
      completedOutcome: "The checkpoint contract is complete.",
      evidence: ["The contract suite passed."],
      nextStep: "Assign a responsible reviewer.",
      neededCollaboration: "The project owner should confirm a reviewer.",
      sourceWorkStateIds: [sourceWorkStateId],
    });
    expect(requestBodies).toHaveLength(2);
    for (const body of requestBodies) {
      expect(body.response_format).toEqual({ type: "json_object" });
      const systemMessage = (
        body.messages as Array<{ role: string; content: string }>
      ).find((message) => message.role === "system");
      expect(systemMessage?.content).toContain(
        "Return exactly one JSON object",
      );
    }
  });

  it("encrypts and decrypts provider credentials only through the server cipher", () => {
    const cipher = new AesGcmProviderSecretCipher("provider-contract-secret");
    const encrypted = cipher.encrypt("provider-key-value");
    expect(encrypted).not.toContain("provider-key-value");
    expect(cipher.decrypt(encrypted)).toBe("provider-key-value");
  });
});

async function seededStore(): Promise<{
  store: PilotStore;
  teamId: string;
  project: PilotProject;
}> {
  const store = new InMemoryPilotStore();
  const now = "2026-07-25T08:00:00.000Z";
  const organization: PilotOrganization = {
    id: ORGANIZATION_ID,
    name: "Intero Pilot",
    deploymentBaseUrl: "http://127.0.0.1:4310",
    deploymentValidatedAt: now,
    provider: { configured: false },
  };
  const teamId = uuidv7();
  await store.setupOrganization({
    organization,
    administratorId: ADMIN,
    initialTeam: {
      id: teamId,
      organizationId: ORGANIZATION_ID,
      name: "Platform",
      createdAt: now,
    },
  });
  const codeHash = "a".repeat(64);
  await store.createJoinLink(
    {
      id: uuidv7(),
      teamId,
      createdBy: ADMIN,
      useCount: 0,
      createdAt: now,
    },
    codeHash,
    ADMIN,
  );
  await store.redeemJoinLink(codeHash, MEMBER, now);
  const project: PilotProject = {
    id: ProjectId.parse("019b5ac0-7600-7000-8000-000000000011"),
    organizationId: ORGANIZATION_ID,
    name: "Intero Pilot",
    ownerId: ADMIN,
    primaryTeamId: teamId,
    participatingTeamIds: [teamId],
    posture: "collaborative",
    createdAt: now,
    updatedAt: now,
  };
  await store.createProject(project);
  return { store, teamId, project };
}

async function seededCheckpoint() {
  const fixture = await seededStore();
  const secrets = new AesGcmProviderSecretCipher("seeded-provider-secret");
  await fixture.store.configureProvider({
    administratorId: ADMIN,
    endpoint: "https://models.example.test/v1",
    defaultModel: "pilot-model",
    encryptedApiKey: secrets.encrypt("key"),
  });
  const binding: PilotAgentBinding = {
    id: uuidv7(),
    projectId: fixture.project.id,
    ownerId: ADMIN,
    client: "codex",
    name: "Codex Pilot",
    workspaceId: uuidv7(),
    credentialHash: "b".repeat(64),
    createdAt: "2026-07-25T08:00:00.000Z",
  };
  const ticketHash = "c".repeat(64);
  await fixture.store.createAgentTicket({
    id: uuidv7(),
    projectId: fixture.project.id,
    ownerId: ADMIN,
    client: "codex",
    ticketHash,
    expiresAt: "2026-07-25T09:00:00.000Z",
    createdAt: "2026-07-25T08:00:00.000Z",
  });
  await fixture.store.exchangeAgentTicket(
    ticketHash,
    binding,
    "2026-07-25T08:00:30.000Z",
  );
  const checkpoint = checkpointFor(fixture.project.id);
  const result = await fixture.store.ingestCheckpoint(
    binding,
    checkpoint,
    "2026-07-25T08:01:00.000Z",
  );
  return {
    ...fixture,
    binding,
    checkpoint,
    workStateId: result.workState.id,
  };
}

function checkpointFor(projectId: PilotProject["id"]): PilotCheckpointInput {
  return {
    schemaVersion: 2,
    clientEventId: "adapter-contract-event-0001",
    projectId,
    occurredAt: "2026-07-25T08:00:45.000Z",
    eventType: "blocker_raised",
    workstream: {
      key: "pilot-adapters",
      title: "Pilot adapter contracts",
      phase: "blocked",
    },
    narrative: {
      currentFocus: "Confirming schema ownership.",
      completedOutcome: "The adapter boundary is implemented.",
      evidence: ["The adapter contract suite reaches the boundary."],
      nextStep: "Confirm the responsible owner.",
      collaboration: {
        needed: true,
        request: "Schema ownership needs confirmation.",
        requestedFrom: "Project owner",
      },
    },
    evidenceRefs: [],
  };
}

function standInJob(): PilotStandInJob {
  return {
    id: uuidv7(),
    kind: "pilot.stand_in.project",
    idempotencyKey: "adapter-contract-event-0001",
    payload: {
      binding: {
        id: uuidv7(),
        projectId: ProjectId.parse("019b5ac0-7600-7000-8000-000000000011"),
        ownerId: ADMIN,
        client: "codex",
        name: "Codex Pilot",
        workspaceId: uuidv7(),
        credentialHash: "d".repeat(64),
        createdAt: "2026-07-25T08:00:00.000Z",
      },
      checkpoint: checkpointFor(
        ProjectId.parse("019b5ac0-7600-7000-8000-000000000011"),
      ),
      workStateId: uuidv7(),
      receivedAt: "2026-07-25T08:01:00.000Z",
    },
  };
}
