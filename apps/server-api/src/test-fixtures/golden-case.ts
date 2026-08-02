import {
  OrganizationId,
  type PilotAgentBinding,
  type PilotCheckpointInput,
  PrincipalId,
  ProjectId,
  roomInteroPrincipalId,
  type ThreadId,
  type ThreadMessage,
} from "@intero/domain";

import { CoordinationKernel } from "../coordination-kernel.js";
import type { ModelGateway } from "../pilot-ports.js";
import {
  InlineInteroRequestJobRunner,
  PilotInteroRequestProcessor,
  PilotInteroRequestService,
} from "../intero-request-service.js";
import { InMemoryPilotStore } from "../pilot-store.js";
import { InMemoryPlatformStore } from "../store.js";

export const GOLDEN_CASE_IDS = {
  organization: OrganizationId.parse("019fc000-0000-7000-8000-000000000001"),
  team: "019fc000-0000-7000-8000-000000000002",
  alex: PrincipalId.parse("019fc000-0000-7000-8000-000000000003"),
  priya: PrincipalId.parse("019fc000-0000-7000-8000-000000000004"),
  authProject: ProjectId.parse("019fc000-0000-7000-8000-000000000005"),
  mobileProject: ProjectId.parse("019fc000-0000-7000-8000-000000000006"),
  room: "019fc000-0000-7000-8000-000000000007" as ThreadId,
  authBinding: "019fc000-0000-7000-8000-000000000008",
  mobileBinding: "019fc000-0000-7000-8000-000000000009",
  authWorkspace: "019fc000-0000-7000-8000-000000000010",
  mobileWorkspace: "019fc000-0000-7000-8000-000000000011",
  sourceMessage: "019fc000-0000-7000-8000-000000000012" as ThreadMessage["id"],
  invitation: "019fc000-0000-7000-8000-000000000013",
} as const;

export interface GoldenCaseFixture {
  pilotStore: InMemoryPilotStore;
  conversations: InMemoryPlatformStore;
  kernel: CoordinationKernel;
  processor: PilotInteroRequestProcessor;
  service: PilotInteroRequestService;
  interoId: PrincipalId;
  sendSourceMessage(body: string): Promise<ThreadMessage>;
  triggerProactiveConflict(
    kernel?: CoordinationKernel,
  ): Promise<Awaited<ReturnType<CoordinationKernel["reconcile"]>>>;
  correctConflictWithCompatibleEvidence(): Promise<
    Awaited<ReturnType<CoordinationKernel["reconcile"]>>
  >;
  withdrawAuthConflictEvidence(): Promise<
    Awaited<ReturnType<InMemoryPilotStore["withdrawPulseEntry"]>>
  >;
}

/**
 * Fixed clean-state Golden Case. It seeds only people, Team, Projects, Room,
 * bindings, Work State, and Claims. Expected requests and conflict artifacts
 * are always produced by the real services under test.
 */
export async function createGoldenCaseFixture(
  input: {
    classification?: "compatible" | "conflict";
    proseGateway?: Pick<ModelGateway, "generateInteroProse">;
  } = {},
): Promise<GoldenCaseFixture> {
  const now = "2026-08-01T08:00:00.000Z";
  const pilotStore = new InMemoryPilotStore();
  await pilotStore.setupOrganization({
    organization: {
      id: GOLDEN_CASE_IDS.organization,
      name: "Intero Lab",
      deploymentBaseUrl: "http://127.0.0.1:4310",
      deploymentValidatedAt: now,
      provider: { configured: false },
    },
    administratorId: GOLDEN_CASE_IDS.alex,
    initialTeam: {
      id: GOLDEN_CASE_IDS.team,
      organizationId: GOLDEN_CASE_IDS.organization,
      name: "Engineering",
      createdAt: now,
    },
  });
  const invitationTokenHash = "b".repeat(64);
  await pilotStore.createInvitation(
    {
      id: GOLDEN_CASE_IDS.invitation,
      organizationId: GOLDEN_CASE_IDS.organization,
      teamId: GOLDEN_CASE_IDS.team,
      email: "priya@intero.test",
      tokenHash: invitationTokenHash,
      createdBy: GOLDEN_CASE_IDS.alex,
      expiresAt: "2026-08-08T08:00:00.000Z",
      createdAt: now,
      updatedAt: now,
    },
    GOLDEN_CASE_IDS.alex,
  );
  await pilotStore.acceptInvitation({
    tokenHash: invitationTokenHash,
    email: "priya@intero.test",
    principalId: GOLDEN_CASE_IDS.priya,
    now,
  });
  await pilotStore.configureProvider({
    administratorId: GOLDEN_CASE_IDS.alex,
    endpoint: "http://127.0.0.1:4312/v1",
    defaultModel: "golden-deterministic",
    encryptedApiKey: "fixture-only",
  });
  const projects = [
    {
      id: GOLDEN_CASE_IDS.authProject,
      name: "Auth Platform",
      ownerId: GOLDEN_CASE_IDS.alex,
    },
    {
      id: GOLDEN_CASE_IDS.mobileProject,
      name: "Mobile App",
      ownerId: GOLDEN_CASE_IDS.priya,
    },
  ];
  for (const project of projects) {
    await pilotStore.createProject({
      ...project,
      organizationId: GOLDEN_CASE_IDS.organization,
      primaryTeamId: GOLDEN_CASE_IDS.team,
      participatingTeamIds: [GOLDEN_CASE_IDS.team],
      posture: "collaborative",
      createdAt: now,
      updatedAt: now,
    });
  }

  await seedClaim(
    pilotStore,
    binding({
      id: GOLDEN_CASE_IDS.authBinding,
      workspaceId: GOLDEN_CASE_IDS.authWorkspace,
      projectId: GOLDEN_CASE_IDS.authProject,
      ownerId: GOLDEN_CASE_IDS.alex,
      client: "codex",
      name: "Alex Codex",
    }),
    checkpoint({
      clientEventId: "golden-auth-boundary-v1",
      projectId: GOLDEN_CASE_IDS.authProject,
      relation: "changing",
      assumption: "Replace retryDelayMs with retryAfterMs.",
      change: input.classification === "compatible" ? "compatible" : "breaking",
      preserves:
        input.classification === "compatible"
          ? ["retryDelayMs"]
          : ["retryAfterMs"],
    }),
    now,
  );
  await seedClaim(
    pilotStore,
    binding({
      id: GOLDEN_CASE_IDS.mobileBinding,
      workspaceId: GOLDEN_CASE_IDS.mobileWorkspace,
      projectId: GOLDEN_CASE_IDS.mobileProject,
      ownerId: GOLDEN_CASE_IDS.priya,
      client: "claude-code",
      name: "Priya Claude Code",
    }),
    checkpoint({
      clientEventId: "golden-mobile-boundary-v1",
      projectId: GOLDEN_CASE_IDS.mobileProject,
      relation: "depending_on",
      assumption: "retryDelayMs",
      change: "unknown",
      preserves: [],
    }),
    now,
  );

  const conversations = new InMemoryPlatformStore();
  const interoId = roomInteroPrincipalId(GOLDEN_CASE_IDS.room);
  conversations.upsertPrincipal({
    id: GOLDEN_CASE_IDS.alex,
    displayName: "Alex",
    kind: "human",
  });
  conversations.upsertPrincipal({
    id: GOLDEN_CASE_IDS.priya,
    displayName: "Priya",
    kind: "human",
  });
  conversations.upsertPrincipal({
    id: interoId,
    displayName: "Intero",
    kind: "service",
  });
  conversations.createThread({
    id: GOLDEN_CASE_IDS.room,
    kind: "room",
    title: "#engineering",
    participantIds: [GOLDEN_CASE_IDS.alex, GOLDEN_CASE_IDS.priya, interoId],
    standInIds: [],
    accessMode: "agent_readable",
    priorHistoryGranted: false,
    sequence: 0,
    teamId: GOLDEN_CASE_IDS.team,
    createdAt: now,
  });
  const kernel = new CoordinationKernel(pilotStore, conversations);
  const processor = new PilotInteroRequestProcessor(
    pilotStore,
    conversations,
    kernel,
    input.proseGateway,
    () => now,
  );
  const service = new PilotInteroRequestService(
    pilotStore,
    conversations,
    new InlineInteroRequestJobRunner((reference) =>
      processor.handle(reference),
    ),
  );
  return {
    pilotStore,
    conversations,
    kernel,
    processor,
    service,
    interoId,
    async sendSourceMessage(body) {
      const message = await conversations.appendMessage(GOLDEN_CASE_IDS.room, {
        id: GOLDEN_CASE_IDS.sourceMessage,
        senderId: GOLDEN_CASE_IDS.alex,
        body,
        mentionedPrincipalIds: [interoId],
        createdAt: now,
      });
      await service.requestFromMessage({
        roomThreadId: GOLDEN_CASE_IDS.room,
        sourceMessage: message,
        requestedByPrincipalId: GOLDEN_CASE_IDS.alex,
        interoPrincipalId: interoId,
        now,
      });
      return message;
    },
    async triggerProactiveConflict(targetKernel = kernel) {
      const agentBinding = (await pilotStore.findAgentBindingById(
        GOLDEN_CASE_IDS.authBinding,
      ))!;
      const project = (
        await pilotStore.listProjects(GOLDEN_CASE_IDS.alex)
      ).find((candidate) => candidate.id === GOLDEN_CASE_IDS.authProject)!;
      const currentClaim = (
        await pilotStore.listSharedBoundaryClaims(
          [GOLDEN_CASE_IDS.authProject],
          GOLDEN_CASE_IDS.alex,
        )
      )[0]!;
      return targetKernel.reconcile({
        project,
        binding: agentBinding,
        workStateId: currentClaim.workStateId,
        checkpoint: checkpoint({
          clientEventId: "golden-auth-proactive-conflict-v2",
          projectId: GOLDEN_CASE_IDS.authProject,
          relation: "changing",
          assumption: "Replace retryDelayMs with retryAfterMs.",
          change: "breaking",
          preserves: ["retryAfterMs"],
        }),
        now: "2026-08-01T08:10:00.000Z",
      });
    },
    async correctConflictWithCompatibleEvidence() {
      const agentBinding = (await pilotStore.findAgentBindingById(
        GOLDEN_CASE_IDS.authBinding,
      ))!;
      const project = (
        await pilotStore.listProjects(GOLDEN_CASE_IDS.alex)
      ).find((candidate) => candidate.id === GOLDEN_CASE_IDS.authProject)!;
      const report = checkpoint({
        clientEventId: "golden-auth-compatible-correction-v3",
        projectId: GOLDEN_CASE_IDS.authProject,
        relation: "changing",
        assumption: "Keep retryDelayMs during the compatibility window.",
        change: "compatible",
        preserves: ["retryDelayMs"],
      });
      const ingested = await pilotStore.ingestCheckpoint(
        agentBinding,
        report,
        "2026-08-01T08:20:00.000Z",
      );
      return kernel.reconcile({
        project,
        binding: agentBinding,
        workStateId: ingested.workState.id,
        checkpoint: report,
        now: "2026-08-01T08:20:00.000Z",
      });
    },
    async withdrawAuthConflictEvidence() {
      const agentBinding = (await pilotStore.findAgentBindingById(
        GOLDEN_CASE_IDS.authBinding,
      ))!;
      const currentClaim = (
        await pilotStore.listSharedBoundaryClaims(
          [GOLDEN_CASE_IDS.authProject],
          GOLDEN_CASE_IDS.alex,
        )
      ).find((claim) => !claim.supersededAt && !claim.withdrawnAt)!;
      const report = checkpoint({
        clientEventId: "golden-auth-withdrawal-source-v1",
        projectId: GOLDEN_CASE_IDS.authProject,
        relation: "changing",
        assumption: currentClaim.assumption,
        change:
          currentClaim.change === "additive"
            ? "compatible"
            : currentClaim.change,
        preserves: currentClaim.preserves,
      });
      await pilotStore.publishStandInSummary({
        binding: agentBinding,
        checkpoint: report,
        workStateId: currentClaim.workStateId,
        safeSummary: "Retry boundary evidence pending correction.",
        narrative: report.narrative,
        now: "2026-08-01T08:25:00.000Z",
      });
      const result = await pilotStore.withdrawPulseEntry(
        GOLDEN_CASE_IDS.authProject,
        currentClaim.workStateId,
        GOLDEN_CASE_IDS.alex,
        "golden-auth-withdrawal-20260801",
        "2026-08-01T08:26:00.000Z",
      );
      for (const thread of result.coordinationThreads) {
        await kernel.refresh(thread, thread.updatedAt, GOLDEN_CASE_IDS.alex);
      }
      return result;
    },
  };
}

async function seedClaim(
  store: InMemoryPilotStore,
  agentBinding: PilotAgentBinding,
  report: PilotCheckpointInput,
  now: string,
): Promise<void> {
  await store.createAgentBinding(agentBinding);
  const ingested = await store.ingestCheckpoint(agentBinding, report, now);
  await store.reconcileSharedBoundaries({
    project: (await store.listProjects(agentBinding.ownerId)).find(
      (project) => project.id === agentBinding.projectId,
    )!,
    binding: agentBinding,
    workStateId: ingested.workState.id,
    checkpoint: report,
    now,
  });
}

function binding(
  input: Pick<
    PilotAgentBinding,
    "id" | "workspaceId" | "projectId" | "ownerId" | "client" | "name"
  >,
): PilotAgentBinding {
  return {
    ...input,
    preferredLanguage: "en-US",
    credentialHash: "a".repeat(64),
    createdAt: "2026-08-01T08:00:00.000Z",
    validatedAt: "2026-08-01T08:00:00.000Z",
  };
}

function checkpoint(input: {
  clientEventId: string;
  projectId: ProjectId;
  relation: "changing" | "depending_on";
  assumption: string;
  change: "compatible" | "breaking" | "unknown";
  preserves: string[];
}): PilotCheckpointInput {
  return {
    schemaVersion: 2,
    clientEventId: input.clientEventId,
    projectId: input.projectId,
    occurredAt: "2026-08-01T07:55:00.000Z",
    eventType: "coordination_requested",
    workstream: {
      key: `retry-${input.projectId}`,
      title: "Retry configuration",
      phase: "implementing",
    },
    narrative: {
      currentFocus: input.assumption,
      completedOutcome: "",
      evidence: ["Boundary contract test recorded."],
      nextStep: "Coordinate the compatibility window.",
      collaboration: {
        needed: true,
        request: "Coordinate retry configuration.",
        requestedFrom: "Engineering",
      },
    },
    evidenceRefs: ["golden:retry-contract"],
    sharedBoundaries: [
      {
        key: "api:retry-config/retryDelayMs",
        kind: "api",
        relation: input.relation,
        assumption: input.assumption,
        change: input.change,
        preserves: input.preserves,
      },
    ],
  };
}
