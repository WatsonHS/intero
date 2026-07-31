import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  expect,
  test,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const execFileAsync = promisify(execFile);
const apiUrl = process.env.INTERO_E2E_API_URL ?? "http://127.0.0.1:4333";
const repositoryRoot = resolve(import.meta.dirname, "../..");
const evidenceRoot = resolve(
  repositoryRoot,
  "output/playwright/collaboration-chain",
);
const r1R2EvidenceRoot = resolve(
  repositoryRoot,
  "output/playwright/r1-r2-coordination",
);
const evaluationEnabled = process.env.INTERO_REAL_PROVIDER_CANARY === "1";
const demoPassword = process.env.INTERO_E2E_PASSWORD ?? "Intero-demo-2026!";
const projectStorageKey = "intero.pilot.project.v1";
const teamStorageKey = "intero.pilot.team.v1";
const roleStorageStates = new Map<
  string,
  Awaited<ReturnType<BrowserContext["storageState"]>>
>();

const principals = {
  alex: {
    id: "019f9a00-0000-7000-8000-000000000101",
    name: "Alex Rivera",
    email: "alex@demo.intero.test",
  },
  priya: {
    id: "019f9a00-0000-7000-8000-000000000102",
    name: "Priya Shah",
    email: "priya@demo.intero.test",
  },
  morgan: {
    id: "019f9a00-0000-7000-8000-000000000103",
    name: "Morgan Lee",
    email: "morgan@demo.intero.test",
  },
  jordan: {
    id: "019f9a00-0000-7000-8000-000000000104",
    name: "Jordan Kim",
    email: "jordan@demo.intero.test",
  },
} as const;

type Principal = (typeof principals)[keyof typeof principals];
type AgentClient = "codex" | "claude-code" | "opencode";

interface TeamPayload {
  id: string;
  name: string;
  members: Array<{ id: string; displayName: string }>;
}

interface ProjectPayload {
  id: string;
  name: string;
  ownerId: string;
  primaryTeamId: string;
}

interface PulseEntry {
  id: string;
  workStateId: string;
  ownerId: string;
  summary: string;
  narrative: {
    currentFocus: string;
    completedOutcome: string;
    evidence: string[];
    nextStep: string;
    collaboration: {
      needed: boolean;
      request: string;
      requestedFrom: string;
      targetPrincipalId?: string;
    };
  };
  provenance: { clientEventId: string };
  withdrawnAt?: string;
}

interface CoordinationThread {
  id: string;
  projectId: string;
  workStateId?: string;
  trigger: string;
  boundaryKey?: string;
  sourceWorkStateIds?: string[];
  sourceClaimIds?: string[];
  conversationThreadId?: string;
  sourceRoomThreadId?: string;
  summaryMessageId?: string;
  participantIds: string[];
  safeContext: string;
  candidateNextSteps: string[];
  status: "open" | "needs_confirmation" | "resolved";
  responsibleParticipantId?: string;
  conclusion?: string;
}

interface OverviewPayload {
  project: ProjectPayload;
  bindings: Array<{
    id: string;
    ownerId: string;
    client: AgentClient;
    disconnectedAt?: string;
  }>;
  privateWorkState: Array<{ id: string }>;
  pulse: PulseEntry[];
  coordination: CoordinationThread[];
  coordinationRelevance: Array<{
    coordinationThreadId: string;
    projectId: string;
    principalId: string;
    sourceRoomThreadId?: string;
    dismissedAt?: string;
    mutedAt?: string;
  }>;
}

interface SharedBoundaryInput {
  key: string;
  kind: "api" | "schema" | "permission" | "module" | "release" | "other";
  relation: "changing" | "depending_on" | "validating";
  assumption: string;
  change: "additive" | "compatible" | "breaking" | "unknown";
  preserves: string[];
}

interface ThreadPayload {
  thread: { id: string; title: string; sequence: number };
  messages: Array<{
    id: string;
    kind: string;
    revision?: number;
    coordinationSummary?: {
      coordinationThreadId: string;
      status: "open" | "waiting" | "needs_action" | "resolved";
      actionRequired: boolean;
      conclusion?: string;
    };
  }>;
  unreadCount: number;
}

interface ActionInboxPayload {
  items: Array<{
    id: string;
    projectId?: string;
    sourceRef: string;
    resolvedAt?: string;
  }>;
  unreadCount: number;
}

interface StandInExchange {
  id: string;
  answerMessageId: string;
  principalId: string;
  askedByPrincipalId?: string;
  question: string;
  answer: string;
  structuredAnswer: {
    currentStatus: string;
    completedOutcome: string;
    evidence: string[];
    nextStep: string;
    neededCollaboration: string;
  };
  sources: Array<{ workStateId: string; freshnessAt: string }>;
}

interface CloudCheckpointResult {
  accepted: boolean;
  duplicate: boolean;
  published: boolean;
  workStateId: string;
  standIn: { status: string };
}

interface Scenario {
  run: number;
  slug: string;
  collaborator: Principal;
  evaluator: Principal;
  focus: string;
  outcome: string;
  evidence: string;
  nextStep: string;
  request: string;
  latestQuestion: string;
  dependencyQuestion: string;
  conclusion: string;
}

const scenarios: Scenario[] = [
  {
    run: 1,
    slug: "target-routing",
    collaborator: principals.priya,
    evaluator: principals.morgan,
    focus: "Project-authorized dependency target routing is under validation.",
    outcome:
      "The structured targetPrincipalId route and authorization boundary are implemented.",
    evidence: "31 focused collaboration contract tests passed.",
    nextStep: "Priya confirms the dependency handoff contract.",
    request: "Confirm the project-scoped dependency handoff contract.",
    latestQuestion: "What outcome is already validated, and what happens next?",
    dependencyQuestion: "Who must act on the current dependency, and why?",
    conclusion:
      "Priya will confirm the project-scoped dependency handoff contract.",
  },
  {
    run: 2,
    slug: "coordination-correlation",
    collaborator: principals.morgan,
    evaluator: principals.jordan,
    focus:
      "Automation-first and provider-recovery Coordination correlation is under validation.",
    outcome:
      "Both creation paths now correlate on one Work State and one Coordination thread.",
    evidence: "8 disposable-database integration tests passed.",
    nextStep: "Morgan confirms the single-thread recovery behavior.",
    request: "Confirm the single-thread provider recovery behavior.",
    latestQuestion:
      "What correlation result has been validated, and with what evidence?",
    dependencyQuestion: "What action is Morgan being asked to confirm?",
    conclusion:
      "Morgan will confirm that provider recovery preserves one correlated thread.",
  },
  {
    run: 3,
    slug: "session-withdrawal",
    collaborator: principals.jordan,
    evaluator: principals.priya,
    focus:
      "Session-auth Stand-in routing and withdrawal idempotency are under validation.",
    outcome:
      "Session principals retain their personal Stand-in route in Project scope, and withdrawal retries have one semantic effect.",
    evidence:
      "Communications routing and disposable-database withdrawal checks passed.",
    nextStep: "Jordan confirms the shared-view withdrawal behavior.",
    request: "Confirm the public withdrawal and private retention behavior.",
    latestQuestion: "What session and withdrawal behavior is now validated?",
    dependencyQuestion: "What must Jordan confirm before this work is closed?",
    conclusion:
      "Jordan will confirm public withdrawal while private Work State remains retained.",
  },
];

test.use({ trace: "off", screenshot: "off" });

test.describe("real provider collaboration chain", () => {
  test.skip(
    !evaluationEnabled,
    "Set INTERO_REAL_PROVIDER_CANARY=1 to use the configured product provider.",
  );

  test.beforeAll(async () => {
    await mkdir(evidenceRoot, { recursive: true });
  });

  test("configured provider canary traverses Settings, MCP, Pulse, and Stand-in", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const resources = await createRolePages(browser, [
      principals.alex,
      principals.priya,
    ]);
    const cloudDataDir = await mkdtemp(
      resolve(tmpdir(), "intero-provider-canary-"),
    );
    let bindingId: string | undefined;

    try {
      const [executor, collaborator] = resources.pages;
      await assertExternalProviderConfigured(executor!);
      const { project, team } = await createCleanProject(
        executor!,
        [principals.alex.id, principals.priya.id],
        `Provider canary ${runSuffix()}`,
      );
      await scopePages(resources.pages, project.id, team.id);
      const connection = await connectThroughSettings(executor!, cloudDataDir);
      bindingId = connection.bindingId;

      const clientEventId = `provider-canary-${runSuffix()}`;
      const checkpoint = await reportCheckpoint(
        connection.client,
        cloudDataDir,
        {
          eventType: "validation_completed",
          clientEventId,
          workstreamKey: `provider-canary-${project.id}`,
          workstreamTitle: "Configured provider canary",
          phase: "validating",
          currentFocus: "Validating the configured provider path.",
          completedOutcome:
            "The checkpoint traversed the product-issued MCP connection.",
          evidence: "The direct-cloud checkpoint was accepted.",
          nextStep: "Confirm the grounded Stand-in answer.",
        },
      );
      expect(checkpoint.accepted).toBe(true);
      const pulse = await waitForPulse(
        executor!,
        project.id,
        clientEventId,
        120_000,
      );
      expect(pulse.workStateId).toBe(checkpoint.workStateId);

      const exchange = await askStandInThroughUi(
        collaborator!,
        project,
        principals.alex,
        "What did the configured-provider canary validate?",
        pulse.workStateId,
      );
      expect(exchange.sources.map((source) => source.workStateId)).toContain(
        pulse.workStateId,
      );
      await collaborator!.screenshot({
        path: resolve(evidenceRoot, "00-provider-canary-stand-in.png"),
        fullPage: true,
      });

      emitSafeResult({
        kind: "provider-canary",
        projectId: project.id,
        clientEventId,
        workStateId: pulse.workStateId,
        standInExchangeId: exchange.id,
        result: "PASS",
      });
    } finally {
      await disconnectBinding(resources.pages[0]!, bindingId);
      await resources.close();
      await rm(cloudDataDir, { recursive: true, force: true });
    }
  });

  for (const scenario of scenarios) {
    test(`three-role collaboration evaluation run ${scenario.run}`, async ({
      browser,
    }) => {
      test.setTimeout(240_000);
      const resources = await createRolePages(browser, [
        principals.alex,
        scenario.collaborator,
        scenario.evaluator,
      ]);
      const cloudDataDir = await mkdtemp(
        resolve(tmpdir(), `intero-collab-r${scenario.run}-`),
      );
      let bindingId: string | undefined;

      try {
        const [executor, collaborator, evaluator] = resources.pages;
        const { project, team } = await createCleanProject(
          executor!,
          [principals.alex.id, scenario.collaborator.id, scenario.evaluator.id],
          `Collab eval R${scenario.run} ${scenario.slug} ${runSuffix()}`,
        );
        await enableBlockerAutomation(executor!, project.id);
        await scopePages(resources.pages, project.id, team.id);
        const connection = await connectThroughSettings(
          executor!,
          cloudDataDir,
        );
        bindingId = connection.bindingId;

        const eventPrefix = `collab-r${scenario.run}-${runSuffix()}`;
        const workstreamKey = `${scenario.slug}-${project.id}`;
        await reportCheckpoint(connection.client, cloudDataDir, {
          eventType: "work_started",
          clientEventId: `${eventPrefix}-started`,
          workstreamKey,
          workstreamTitle: scenario.focus,
          phase: "implementing",
          currentFocus: scenario.focus,
          completedOutcome: "",
          evidence: "The bounded implementation task is active.",
          nextStep: "Run the focused validation boundary.",
        });
        await reportCheckpoint(connection.client, cloudDataDir, {
          eventType: "work_progressed",
          clientEventId: `${eventPrefix}-progress`,
          workstreamKey,
          workstreamTitle: scenario.focus,
          phase: "implementing",
          currentFocus: scenario.focus,
          completedOutcome: scenario.outcome,
          evidence: scenario.evidence,
          nextStep: scenario.nextStep,
        });
        const dependencyStartedAt = Date.now();
        const dependency = await reportCheckpoint(
          connection.client,
          cloudDataDir,
          {
            eventType: "dependency_declared",
            clientEventId: `${eventPrefix}-dependency`,
            workstreamKey,
            workstreamTitle: scenario.focus,
            phase: "blocked",
            currentFocus: scenario.focus,
            completedOutcome: scenario.outcome,
            evidence: scenario.evidence,
            nextStep: scenario.nextStep,
            needsHelp: true,
            helpRequest: scenario.request,
            requestedFrom: scenario.collaborator.name,
            targetPrincipalId: scenario.collaborator.id,
          },
        );
        const finalEventId = `${eventPrefix}-validated`;
        const finalCheckpoint = await reportCheckpoint(
          connection.client,
          cloudDataDir,
          {
            eventType: "validation_completed",
            clientEventId: finalEventId,
            workstreamKey,
            workstreamTitle: scenario.focus,
            phase: "reviewing",
            currentFocus: scenario.focus,
            completedOutcome: scenario.outcome,
            evidence: scenario.evidence,
            nextStep: scenario.nextStep,
            needsHelp: true,
            helpRequest: scenario.request,
            requestedFrom: scenario.collaborator.name,
            targetPrincipalId: scenario.collaborator.id,
          },
        );
        expect(finalCheckpoint.workStateId).toBe(dependency.workStateId);

        const pulse = await waitForPulse(
          collaborator!,
          project.id,
          finalEventId,
          120_000,
        );
        const coordination = await waitForCoordination(
          collaborator!,
          project.id,
          pulse.workStateId,
          120_000,
        );
        const collaborationLatencyMs = Date.now() - dependencyStartedAt;
        const beforeWithdrawal = await getOverview(evaluator!, project.id);
        const matchingThreads = beforeWithdrawal.coordination.filter(
          (thread) => thread.workStateId === pulse.workStateId,
        );

        await navigate(executor!, "Team Pulse");
        await expect(
          executor!.getByTestId(
            `stand-in-person-summary-${principals.alex.id}`,
          ),
        ).toBeVisible();
        await executor!.screenshot({
          path: resolve(evidenceRoot, `r${scenario.run}-01-team-pulse.png`),
          fullPage: true,
        });

        const latestAnswer = await askStandInThroughUi(
          collaborator!,
          project,
          principals.alex,
          scenario.latestQuestion,
          pulse.workStateId,
        );
        const dependencyAnswer = await askStandInThroughUi(
          collaborator!,
          project,
          principals.alex,
          scenario.dependencyQuestion,
          pulse.workStateId,
        );
        await collaborator!.screenshot({
          path: resolve(
            evidenceRoot,
            `r${scenario.run}-02-stand-in-grounding.png`,
          ),
          fullPage: true,
        });

        await resolveCoordinationThroughUi(
          collaborator!,
          coordination,
          scenario.collaborator,
          scenario.conclusion,
        );
        await collaborator!.screenshot({
          path: resolve(
            evidenceRoot,
            `r${scenario.run}-03-coordination-confirmed.png`,
          ),
          fullPage: true,
        });

        await navigate(executor!, "Team Pulse");
        const withdraw = executor!.getByTestId(
          `pilot-withdraw-${pulse.workStateId}`,
        );
        await expect(withdraw).toBeVisible();
        const withdrawalStartedAt = Date.now();
        const firstWithdrawalResponse = executor!.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response
              .url()
              .endsWith(
                `/v1/pilot/projects/${project.id}/pulse/${pulse.workStateId}/withdraw`,
              ),
        );
        await withdraw.click();
        const firstWithdrawalPayload = (await (
          await firstWithdrawalResponse
        ).json()) as {
          entry: PulseEntry;
          duplicate?: boolean;
        };
        await expect
          .poll(
            async () =>
              (await getOverview(collaborator!, project.id)).pulse.some(
                (entry) => entry.workStateId === pulse.workStateId,
              ),
            { timeout: 30_000 },
          )
          .toBe(false);
        const duplicateResponse = await executor!.request.post(
          `${apiUrl}/v1/pilot/projects/${project.id}/pulse/${pulse.workStateId}/withdraw`,
          {
            data: {},
            headers: {
              "idempotency-key": `pulse-withdraw:${project.id}:${pulse.workStateId}`,
            },
          },
        );
        expect(duplicateResponse.ok()).toBe(true);
        const duplicatePayload = (await duplicateResponse.json()) as {
          entry: PulseEntry;
          duplicate?: boolean;
        };
        expect(duplicatePayload.entry.withdrawnAt).toBe(
          firstWithdrawalPayload.entry.withdrawnAt,
        );

        const executorAfter = await getOverview(executor!, project.id);
        const collaboratorAfter = await getOverview(collaborator!, project.id);
        const evaluatorAfter = await getOverview(evaluator!, project.id);
        const postThreads = evaluatorAfter.coordination.filter(
          (thread) => thread.workStateId === pulse.workStateId,
        );
        const withdrawalLatencyMs = Date.now() - withdrawalStartedAt;
        const noPrivateLeak =
          collaboratorAfter.privateWorkState.every(
            (state) => state.id !== pulse.workStateId,
          ) &&
          evaluatorAfter.privateWorkState.every(
            (state) => state.id !== pulse.workStateId,
          );
        const groundedAnswers = [latestAnswer, dependencyAnswer].every(
          (exchange) =>
            exchange.sources.some(
              (source) => source.workStateId === pulse.workStateId,
            ) &&
            exchange.answer.length > 0 &&
            !containsPrivateExecutionDetail(exchange.answer),
        );
        const scores = {
          C1: scoreScenario({
            accurate:
              pulse.provenance.clientEventId === finalEventId &&
              pulse.narrative.completedOutcome.length > 0 &&
              pulse.narrative.evidence.length > 0,
            legible:
              pulse.narrative.currentFocus.length > 0 &&
              pulse.narrative.completedOutcome.length > 0,
            timely: collaborationLatencyMs <= 120_000,
            actionable:
              pulse.narrative.nextStep.length > 0 &&
              pulse.narrative.collaboration.needed &&
              coordination.participantIds.includes(scenario.collaborator.id),
            privateAndScoped: pulse.ownerId === principals.alex.id,
          }),
          C2: scoreScenario({
            accurate:
              matchingThreads.length === 1 &&
              coordination.participantIds.includes(scenario.collaborator.id),
            legible:
              coordination.safeContext.length > 0 &&
              coordination.candidateNextSteps.length > 0,
            timely: collaborationLatencyMs <= 120_000,
            actionable: postThreads[0]?.status === "resolved",
            privateAndScoped:
              coordination.projectId === project.id &&
              matchingThreads.length === 1,
          }),
          C3: scoreScenario({
            accurate: groundedAnswers,
            legible: [latestAnswer, dependencyAnswer].every(
              (exchange) =>
                exchange.structuredAnswer.currentStatus.length > 0 &&
                exchange.structuredAnswer.nextStep.length > 0,
            ),
            timely: true,
            actionable:
              dependencyAnswer.structuredAnswer.neededCollaboration.length > 0,
            privateAndScoped: groundedAnswers,
          }),
          C4: scoreScenario({
            accurate:
              !collaboratorAfter.pulse.some(
                (entry) => entry.workStateId === pulse.workStateId,
              ) &&
              executorAfter.privateWorkState.some(
                (state) => state.id === pulse.workStateId,
              ),
            legible: true,
            timely: withdrawalLatencyMs <= 30_000,
            actionable: duplicatePayload.entry.withdrawnAt !== undefined,
            privateAndScoped: noPrivateLeak && postThreads.length === 1,
          }),
        };
        const passed = Object.values(scores).every((score) => score.passed);
        emitSafeResult({
          kind: "collaboration-evaluation",
          run: scenario.run,
          projectId: project.id,
          eventIds: {
            dependency: `${eventPrefix}-dependency`,
            final: finalEventId,
          },
          workStateId: pulse.workStateId,
          coordinationThreadId: coordination.id,
          standInExchangeIds: [latestAnswer.id, dependencyAnswer.id],
          withdrawal: {
            withdrawnAt: firstWithdrawalPayload.entry.withdrawnAt,
            duplicate: duplicatePayload.duplicate ?? "semantic-replay",
          },
          latencyMs: {
            collaboration: collaborationLatencyMs,
            withdrawal: withdrawalLatencyMs,
          },
          scores,
          result: passed ? "PASS" : "FAIL",
        });
        for (const [scenarioName, score] of Object.entries(scores)) {
          expect(score.passed, `${scenarioName} score`).toBe(true);
        }
      } finally {
        await disconnectBinding(resources.pages[0]!, bindingId);
        await resources.close();
        await rm(cloudDataDir, { recursive: true, force: true });
      }
    });
  }
});

test.describe("R1/R2 coordination browser acceptance", () => {
  test.beforeAll(async () => {
    await mkdir(r1R2EvidenceRoot, { recursive: true });
  });

  test("keeps the compatible control quiet and resolves one conflict without Room noise", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const resources = await createRolePages(browser, [
      principals.alex,
      principals.priya,
    ]);
    const alexCloudDataDir = await mkdtemp(
      resolve(tmpdir(), "intero-r1-r2-alex-"),
    );
    const priyaCloudDataDir = await mkdtemp(
      resolve(tmpdir(), "intero-r1-r2-priya-"),
    );
    const connectedBindings: Array<{ page: Page; bindingId: string }> = [];

    try {
      const [alex, priya] = resources.pages as [Page, Page];
      const { project, team } = await createCleanProject(
        alex,
        [principals.alex.id, principals.priya.id],
        `R1 R2 browser acceptance ${runSuffix()}`,
      );
      const room = await createEvaluationRoom(
        alex,
        project,
        [principals.alex.id, principals.priya.id],
        `R1 R2 boundary room ${runSuffix()}`,
      );
      await scopePages(resources.pages, project.id, team.id);

      const alexConnection = await connectThroughSettings(
        alex,
        alexCloudDataDir,
      );
      connectedBindings.push({
        page: alex,
        bindingId: alexConnection.bindingId,
      });
      const priyaConnection = await connectThroughSettings(
        priya,
        priyaCloudDataDir,
      );
      connectedBindings.push({
        page: priya,
        bindingId: priyaConnection.bindingId,
      });

      const suffix = runSuffix();
      const boundaryKey = `api:accounts.v1/${suffix}`;
      const assumption = "v1 response keeps account_id";
      const producerWorkstream = `accounts-producer-${suffix}`;
      const consumerWorkstream = `accounts-consumer-${suffix}`;
      const compatibleProducerEvent = `r1-control-producer-${suffix}`;
      const compatibleConsumerEvent = `r1-control-consumer-${suffix}`;

      await reportCheckpoint(alexConnection.client, alexCloudDataDir, {
        eventType: "validation_completed",
        clientEventId: compatibleProducerEvent,
        workstreamKey: producerWorkstream,
        workstreamTitle: "Accounts API producer",
        phase: "validating",
        currentFocus: "Validate the compatible accounts boundary.",
        completedOutcome: "The producer preserves account_id.",
        evidence: "The compatibility contract passed.",
        nextStep: "Keep the compatible control quiet.",
        sharedBoundaries: [
          {
            key: boundaryKey,
            kind: "api",
            relation: "changing",
            assumption,
            change: "compatible",
            preserves: [assumption],
          },
        ],
      });
      await reportCheckpoint(priyaConnection.client, priyaCloudDataDir, {
        eventType: "validation_completed",
        clientEventId: compatibleConsumerEvent,
        workstreamKey: consumerWorkstream,
        workstreamTitle: "Accounts API consumer",
        phase: "validating",
        currentFocus: "Validate the account_id dependency.",
        completedOutcome: "The consumer still depends on account_id.",
        evidence: "The consumer contract passed.",
        nextStep: "Wait for the shared boundary result.",
        sharedBoundaries: [
          {
            key: boundaryKey,
            kind: "api",
            relation: "depending_on",
            assumption,
            change: "unknown",
            preserves: [],
          },
        ],
      });
      const compatibleProducer = await waitForPulse(
        alex,
        project.id,
        compatibleProducerEvent,
        90_000,
      );
      const compatibleConsumer = await waitForPulse(
        priya,
        project.id,
        compatibleConsumerEvent,
        90_000,
      );
      const compatibleOverview = await getOverview(priya, project.id);
      expect(
        compatibleOverview.coordination.filter(
          (thread) => thread.boundaryKey === boundaryKey,
        ),
      ).toEqual([]);
      expect(
        (await getActionInbox(priya)).items.filter(
          (item) => item.projectId === project.id,
        ),
      ).toEqual([]);
      await openEvaluationRoom(priya, room.title);
      await expect(
        priya.locator('[data-testid^="coordination-summary-"]'),
      ).toHaveCount(0);
      await expect(
        priya.getByTestId("coordination-relevance-prompt"),
      ).toHaveCount(0);
      await priya.screenshot({
        path: resolve(r1R2EvidenceRoot, "01-compatible-control-quiet.png"),
        fullPage: true,
      });

      const breakingEvent = `r1-conflict-producer-${suffix}`;
      await reportCheckpoint(alexConnection.client, alexCloudDataDir, {
        eventType: "validation_completed",
        clientEventId: breakingEvent,
        workstreamKey: producerWorkstream,
        workstreamTitle: "Accounts API producer",
        phase: "validating",
        currentFocus: "Validate the breaking accounts boundary.",
        completedOutcome: "The producer removes account_id.",
        evidence: "The breaking contract was observed.",
        nextStep: "Resolve the consumer compatibility window.",
        sharedBoundaries: [
          {
            key: boundaryKey,
            kind: "api",
            relation: "changing",
            assumption,
            change: "breaking",
            preserves: [],
          },
        ],
      });
      const breakingProducer = await waitForPulse(
        alex,
        project.id,
        breakingEvent,
        90_000,
      );
      expect(breakingProducer.workStateId).toBe(compatibleProducer.workStateId);
      const coordination = await waitForBoundaryCoordination(
        priya,
        project.id,
        boundaryKey,
        90_000,
      );
      expect(coordination.sourceWorkStateIds).toEqual(
        expect.arrayContaining([
          compatibleProducer.workStateId,
          compatibleConsumer.workStateId,
        ]),
      );
      expect(coordination.sourceClaimIds).toHaveLength(2);
      expect(coordination.sourceRoomThreadId).toBe(room.id);
      expect(coordination.summaryMessageId).toBeTruthy();
      expect(coordination.conversationThreadId).toBeTruthy();

      const roomBeforeProposal = await getThread(priya, room.id);
      const openSummaries = roomBeforeProposal.messages.filter(
        (message) => message.kind === "coordination_summary",
      );
      expect(openSummaries).toHaveLength(1);
      expect(openSummaries[0]).toMatchObject({
        id: coordination.summaryMessageId,
        coordinationSummary: {
          coordinationThreadId: coordination.conversationThreadId,
          status: "open",
          actionRequired: false,
        },
      });
      expect(
        (await getActionInbox(priya)).items.filter(
          (item) => item.sourceRef === `coordination:${coordination.id}`,
        ),
      ).toEqual([]);

      await openEvaluationRoom(priya, room.title);
      await expect(
        priya.locator('[data-testid^="coordination-summary-"]'),
      ).toHaveCount(1);
      await expect(
        priya.getByTestId("coordination-relevance-prompt"),
      ).toBeVisible();
      await priya.screenshot({
        path: resolve(r1R2EvidenceRoot, "02-conflict-contextual-relevance.png"),
        fullPage: true,
      });

      await priya.getByRole("button", { name: /忽略|Dismiss/ }).click();
      await expect(
        priya.getByTestId("coordination-relevance-prompt"),
      ).toHaveCount(0);
      await navigate(priya, "Coordination");
      await priya
        .getByTestId(`pilot-coordination-thread-${coordination.id}`)
        .click();
      const revisit = priya.getByRole("button", {
        name: /恢复相关性提示|Restore relevance prompt/,
      });
      await expect(revisit).toBeVisible();
      await revisit.click();
      await expect
        .poll(
          async () =>
            (await getOverview(priya, project.id)).coordinationRelevance.find(
              (item) => item.coordinationThreadId === coordination.id,
            )?.dismissedAt,
        )
        .toBeUndefined();
      await openEvaluationRoom(priya, room.title);
      await expect(
        priya.getByTestId("coordination-relevance-prompt"),
      ).toBeVisible();

      const conclusion = `Keep account_id through the migration window (${suffix}).`;
      await navigate(alex, "Coordination");
      await alex
        .getByTestId(`pilot-coordination-thread-${coordination.id}`)
        .click();
      await alex.getByTestId("pilot-coordination-conclusion").fill(conclusion);
      await alex
        .getByLabel(/负责人|Responsible person/)
        .selectOption(principals.priya.id);
      const proposalResponse = alex.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response
            .url()
            .endsWith(`/v1/pilot/coordination/${coordination.id}/conclusion`),
      );
      await alex.getByTestId("pilot-coordination-propose").click();
      expect((await proposalResponse).ok()).toBe(true);

      const roomAfterProposal = await getThread(priya, room.id);
      const proposedSummaries = roomAfterProposal.messages.filter(
        (message) => message.kind === "coordination_summary",
      );
      expect(roomAfterProposal.thread.sequence).toBe(
        roomBeforeProposal.thread.sequence,
      );
      expect(proposedSummaries).toHaveLength(1);
      expect(proposedSummaries[0]).toMatchObject({
        id: openSummaries[0]!.id,
        coordinationSummary: {
          status: "needs_action",
          actionRequired: true,
        },
      });
      expect(proposedSummaries[0]!.revision).toBeGreaterThan(
        openSummaries[0]!.revision ?? 1,
      );
      const confirmationItems = (await getActionInbox(priya)).items.filter(
        (item) => item.sourceRef === `coordination:${coordination.id}`,
      );
      expect(confirmationItems).toHaveLength(1);
      expect(confirmationItems[0]!.resolvedAt).toBeUndefined();

      await navigate(priya, "Coordination");
      await priya
        .getByTestId(`pilot-coordination-thread-${coordination.id}`)
        .click();
      const confirm = priya.getByTestId("pilot-coordination-confirm");
      await expect(confirm).toBeVisible();
      const confirmationResponse = priya.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response
            .url()
            .endsWith(`/v1/pilot/coordination/${coordination.id}/confirm`),
      );
      await confirm.click();
      expect((await confirmationResponse).ok()).toBe(true);
      await expect(priya.getByText(conclusion)).toBeVisible();
      await priya.screenshot({
        path: resolve(r1R2EvidenceRoot, "03-human-confirmed-closure.png"),
        fullPage: true,
      });

      const roomAfterConfirmation = await getThread(priya, room.id);
      const resolvedSummaries = roomAfterConfirmation.messages.filter(
        (message) => message.kind === "coordination_summary",
      );
      expect(roomAfterConfirmation.thread.sequence).toBe(
        roomBeforeProposal.thread.sequence,
      );
      expect(resolvedSummaries).toHaveLength(1);
      expect(resolvedSummaries[0]).toMatchObject({
        id: openSummaries[0]!.id,
        coordinationSummary: {
          status: "resolved",
          actionRequired: false,
          conclusion,
        },
      });
      expect(resolvedSummaries[0]!.revision).toBeGreaterThan(
        proposedSummaries[0]!.revision ?? 1,
      );
      await expect
        .poll(
          async () =>
            (await getActionInbox(priya)).items.filter(
              (item) => item.sourceRef === `coordination:${coordination.id}`,
            ).length,
        )
        .toBe(0);
      await openEvaluationRoom(priya, room.title);
      await expect(
        priya.locator('[data-testid^="coordination-summary-"]'),
      ).toContainText(/已解决|Resolved/);
      await priya.screenshot({
        path: resolve(r1R2EvidenceRoot, "04-room-summary-revised-in-place.png"),
        fullPage: true,
      });
    } finally {
      await Promise.all(
        connectedBindings.map(({ page, bindingId }) =>
          disconnectBinding(page, bindingId),
        ),
      );
      await resources.close();
      await Promise.all([
        rm(alexCloudDataDir, { recursive: true, force: true }),
        rm(priyaCloudDataDir, { recursive: true, force: true }),
      ]);
    }
  });
});

async function createRolePages(
  browser: Browser,
  roles: Principal[],
): Promise<{
  contexts: BrowserContext[];
  pages: Page[];
  close: () => Promise<void>;
}> {
  const contexts = await Promise.all(
    roles.map((role) =>
      browser.newContext({
        reducedMotion: "reduce",
        ...(roleStorageStates.get(role.email)
          ? { storageState: roleStorageStates.get(role.email)! }
          : {}),
      }),
    ),
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  await Promise.all(
    pages.map(async (page, index) => {
      const role = roles[index]!;
      if (roleStorageStates.has(role.email)) {
        await page.goto("/");
        await expect(page.getByTitle("Team Pulse")).toBeVisible();
      } else {
        await signIn(page, role);
        roleStorageStates.set(
          role.email,
          await contexts[index]!.storageState(),
        );
      }
    }),
  );
  return {
    contexts,
    pages,
    close: async () => {
      await Promise.all(contexts.map((context) => context.close()));
    },
  };
}

async function signIn(page: Page, principal: Principal): Promise<void> {
  await page.goto("/");
  await page.locator('input[type="email"]').fill(principal.email);
  await page.locator('input[type="password"]').fill(demoPassword);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByTitle("Team Pulse")).toBeVisible();
}

async function assertExternalProviderConfigured(page: Page): Promise<void> {
  const response = await page.request.get(`${apiUrl}/v1/pilot/bootstrap`);
  const bootstrap = await json<{
    organization?: {
      provider: {
        configured: boolean;
        endpoint?: string;
        defaultModel?: string;
      };
    };
  }>(response);
  const provider = bootstrap.organization?.provider;
  expect(provider?.configured).toBe(true);
  expect(provider?.endpoint).toBeTruthy();
  expect(provider?.defaultModel).toBeTruthy();
  if (provider!.defaultModel === "intero-demo-deterministic") {
    throw new Error(
      "A real administrator-configured provider is required; the current product environment still points at the deterministic adapter fixture.",
    );
  }
}

async function createCleanProject(
  page: Page,
  requiredPrincipalIds: string[],
  name: string,
): Promise<{ project: ProjectPayload; team: TeamPayload }> {
  const teamsResponse = await page.request.get(`${apiUrl}/v1/pilot/teams`);
  const teams = await json<{ teams: TeamPayload[] }>(teamsResponse);
  const team = teams.teams.find((candidate) =>
    requiredPrincipalIds.every((principalId) =>
      candidate.members.some((member) => member.id === principalId),
    ),
  );
  expect(team, "A shared evaluation Team is required.").toBeDefined();
  const created = await page.request.post(`${apiUrl}/v1/pilot/projects`, {
    data: {
      name,
      primaryTeamId: team!.id,
      participatingTeamIds: [team!.id],
      posture: "collaborative",
    },
  });
  const { project } = await json<{ project: ProjectPayload }>(created);
  const overview = await getOverview(page, project.id);
  expect(overview.pulse).toEqual([]);
  expect(overview.coordination).toEqual([]);
  expect(overview.privateWorkState).toEqual([]);
  expect(overview.bindings).toEqual([]);
  return { project, team: team! };
}

async function createEvaluationRoom(
  page: Page,
  project: ProjectPayload,
  participantIds: string[],
  title: string,
): Promise<{ id: string; title: string }> {
  const response = await page.request.post(`${apiUrl}/v1/threads`, {
    data: {
      id: randomUUID(),
      kind: "room",
      projectId: project.id,
      title,
      participantIds,
      standInIds: [],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      createdAt: new Date().toISOString(),
    },
  });
  const room = await json<{ id: string; title: string }>(response);
  expect(room.title).toBe(title);
  return room;
}

async function openEvaluationRoom(page: Page, title: string): Promise<void> {
  await navigate(page, "通讯");
  const room = page.getByText(title, { exact: true }).first();
  await expect(room).toBeVisible();
  await room.click();
  await expect(page.getByTestId("communications-composer")).toBeVisible();
}

async function enableBlockerAutomation(
  page: Page,
  projectId: string,
): Promise<void> {
  const response = await page.request.put(
    `${apiUrl}/v1/project-automation/${projectId}`,
    {
      data: {
        enabled: true,
        enabledSignals: ["blocker", "dependency_change"],
        staleSpecReviewHours: 48,
        unresolvedCoordinationHours: 24,
      },
    },
  );
  expect(response.ok()).toBe(true);
}

async function scopePages(
  pages: Page[],
  projectId: string,
  teamId: string,
): Promise<void> {
  await Promise.all(
    pages.map(async (page) => {
      await page.evaluate(
        ([projectKey, project, teamKey, team]) => {
          window.localStorage.setItem(projectKey, project);
          window.localStorage.setItem(teamKey, team);
        },
        [projectStorageKey, projectId, teamStorageKey, teamId],
      );
      await page.reload();
      await expect(page.getByTitle("Team Pulse")).toBeVisible();
    }),
  );
}

async function connectThroughSettings(
  page: Page,
  cloudDataDir: string,
): Promise<{ client: AgentClient; bindingId: string }> {
  await navigate(page, "设置");
  await page.getByTestId("settings-category-agent").click();
  await expect(page.getByTestId("pilot-cloud-settings")).toBeVisible();
  await expect(page.getByTestId("agent-connections-settings")).toBeVisible();
  const clients: AgentClient[] = ["claude-code", "opencode", "codex"];
  let client: AgentClient | undefined;
  for (const candidate of clients) {
    if (await page.getByTestId(`connect-agent-${candidate}`).isEnabled()) {
      client = candidate;
      break;
    }
  }
  expect(client).toBeDefined();
  await page.getByTestId(`connect-agent-${client!}`).click();
  await page.getByText("其他方式：查看完整连接任务").click();
  const prompt = page.getByTestId("agent-connect-prompt");
  await expect(prompt).toBeVisible();
  const ticket = ((await prompt.textContent()) ?? "").match(
    /"ticket":\s*"((?:ott|ticket)_[A-Za-z0-9_-]+)"/,
  )?.[1];
  expect(ticket).toBeTruthy();

  await navigate(page, "Team Pulse");
  const connected = await runCloudClient(
    [
      "connect",
      "--client",
      client!,
      "--cloud-url",
      apiUrl,
      "--connect-ticket",
      ticket!,
    ],
    cloudDataDir,
  );
  expect(connected.connected).toBe(true);
  const context = connected.context as { bindingId?: string };
  expect(context.bindingId).toBeTruthy();
  return { client: client!, bindingId: context.bindingId! };
}

async function reportCheckpoint(
  client: AgentClient,
  cloudDataDir: string,
  input: {
    eventType:
      | "work_started"
      | "work_progressed"
      | "dependency_declared"
      | "validation_completed";
    clientEventId: string;
    workstreamKey: string;
    workstreamTitle: string;
    phase: "implementing" | "blocked" | "reviewing" | "validating";
    currentFocus: string;
    completedOutcome: string;
    evidence: string;
    nextStep: string;
    needsHelp?: boolean;
    helpRequest?: string;
    requestedFrom?: string;
    targetPrincipalId?: string;
    sharedBoundaries?: SharedBoundaryInput[];
  },
): Promise<CloudCheckpointResult> {
  const args = [
    "checkpoint",
    "--mcp-source",
    client,
    "--event-type",
    input.eventType,
    "--current-focus",
    input.currentFocus,
    "--completed-outcome",
    input.completedOutcome,
    "--evidence",
    input.evidence,
    "--next-step",
    input.nextStep,
    "--client-event-id",
    input.clientEventId,
    "--workstream-key",
    input.workstreamKey,
    "--workstream-title",
    input.workstreamTitle,
    "--phase",
    input.phase,
  ];
  if (input.needsHelp) {
    args.push(
      "--needs-help",
      "--help-request",
      input.helpRequest!,
      "--requested-from",
      input.requestedFrom!,
      "--target-principal-id",
      input.targetPrincipalId!,
    );
  }
  for (const boundary of input.sharedBoundaries ?? []) {
    args.push("--shared-boundary", JSON.stringify(boundary));
  }
  const result = await runCloudClient(args, cloudDataDir);
  expect(result.accepted).toBe(true);
  return result as unknown as CloudCheckpointResult;
}

async function runCloudClient(
  args: string[],
  cloudDataDir: string,
): Promise<Record<string, unknown>> {
  try {
    const result = await execFileAsync(
      "pnpm",
      [
        "--filter",
        "@intero/mcp-stdio",
        "exec",
        "tsx",
        "src/index.ts",
        "cloud",
        ...args,
        "--cloud-data-dir",
        cloudDataDir,
      ],
      {
        cwd: repositoryRoot,
        timeout: 45_000,
        maxBuffer: 1024 * 1024,
      },
    );
    return JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    throw new Error("The product-issued direct-cloud MCP command failed.");
  }
}

async function waitForPulse(
  page: Page,
  projectId: string,
  clientEventId: string,
  timeout: number,
): Promise<PulseEntry> {
  await expect
    .poll(
      async () =>
        (await getOverview(page, projectId)).pulse.find(
          (entry) => entry.provenance.clientEventId === clientEventId,
        )?.workStateId,
      { timeout },
    )
    .toBeTruthy();
  return (await getOverview(page, projectId)).pulse.find(
    (entry) => entry.provenance.clientEventId === clientEventId,
  )!;
}

async function waitForCoordination(
  page: Page,
  projectId: string,
  workStateId: string,
  timeout: number,
): Promise<CoordinationThread> {
  await expect
    .poll(
      async () =>
        (await getOverview(page, projectId)).coordination.filter(
          (thread) => thread.workStateId === workStateId,
        ).length,
      { timeout },
    )
    .toBe(1);
  return (await getOverview(page, projectId)).coordination.find(
    (thread) => thread.workStateId === workStateId,
  )!;
}

async function waitForBoundaryCoordination(
  page: Page,
  projectId: string,
  boundaryKey: string,
  timeout: number,
): Promise<CoordinationThread> {
  await expect
    .poll(
      async () =>
        (await getOverview(page, projectId)).coordination.filter(
          (thread) => thread.boundaryKey === boundaryKey,
        ).length,
      { timeout },
    )
    .toBe(1);
  return (await getOverview(page, projectId)).coordination.find(
    (thread) => thread.boundaryKey === boundaryKey,
  )!;
}

async function askStandInThroughUi(
  page: Page,
  project: ProjectPayload,
  standInOwner: Principal,
  question: string,
  workStateId: string,
): Promise<StandInExchange> {
  await navigate(page, "通讯");
  const personalStandInConversation = page.getByTestId(
    "personal-stand-in-conversation",
  );
  await expect(personalStandInConversation).toHaveCount(1);
  await expect(personalStandInConversation).not.toContainText(
    `${project.name} Stand-in`,
  );
  await personalStandInConversation.click();
  const composer = page.getByTestId("communications-composer");
  await composer.fill(`@${standInOwner.name.slice(0, 4)}`);
  await page.getByTestId(`personal-stand-in-option-${standInOwner.id}`).click();
  await expect(
    page.getByTestId("personal-stand-in-conversation").getByText("的替身"),
  ).toBeVisible();
  await composer.fill(question);
  await composer.press("Enter");
  await expect
    .poll(
      async () =>
        (await getStandInExchanges(page, project.id, standInOwner.id)).find(
          (exchange) => exchange.question === question,
        )?.id,
      { timeout: 45_000 },
    )
    .toBeTruthy();
  const exchange = (
    await getStandInExchanges(page, project.id, standInOwner.id)
  ).find((candidate) => candidate.question === question)!;
  expect(exchange.principalId).toBe(standInOwner.id);
  const answer = page.getByTestId(
    `pilot-stand-in-answer-${exchange.answerMessageId}`,
  );
  await expect(answer).toBeVisible();
  await answer.locator("..").getByRole("button").click();
  await expect(
    page.getByTestId(`pilot-stand-in-source-${workStateId}`).last(),
  ).toBeVisible();
  return exchange;
}

async function resolveCoordinationThroughUi(
  page: Page,
  thread: CoordinationThread,
  collaborator: Principal,
  conclusion: string,
): Promise<void> {
  await navigate(page, "Coordination");
  await page.getByTestId(`pilot-coordination-thread-${thread.id}`).click();
  await expect(
    page.getByText(thread.safeContext, { exact: false }),
  ).toBeVisible();
  await page.getByTestId("pilot-coordination-conclusion").fill(conclusion);
  await page.getByLabel("负责人").selectOption(collaborator.id);
  await page.getByTestId("pilot-coordination-propose").click();
  await page.getByTestId("pilot-coordination-confirm").click();
  await expect(page.getByText(conclusion)).toBeVisible();
}

async function navigate(page: Page, title: string): Promise<void> {
  const aliases =
    title === "设置"
      ? ["设置", "Settings"]
      : title === "通讯"
        ? ["通讯", "Communications"]
        : [title];
  for (const alias of aliases) {
    const candidate = page.getByTitle(alias);
    if (await candidate.count()) {
      await candidate.click();
      return;
    }
  }
  throw new Error(`Navigation item ${title} is unavailable.`);
}

async function getOverview(
  page: Page,
  projectId: string,
): Promise<OverviewPayload> {
  return await json<OverviewPayload>(
    await page.request.get(`${apiUrl}/v1/pilot/projects/${projectId}/overview`),
  );
}

async function getThread(page: Page, threadId: string): Promise<ThreadPayload> {
  return await json<ThreadPayload>(
    await page.request.get(`${apiUrl}/v1/threads/${threadId}`),
  );
}

async function getActionInbox(page: Page): Promise<ActionInboxPayload> {
  return await json<ActionInboxPayload>(
    await page.request.get(`${apiUrl}/v1/action-inbox?includeDismissed=true`),
  );
}

async function getStandInExchanges(
  page: Page,
  projectId: string,
  standInOwnerId: string,
): Promise<StandInExchange[]> {
  const payload = await json<{ exchanges: StandInExchange[] }>(
    await page.request.get(
      `${apiUrl}/v1/pilot/projects/${projectId}/stand-in?${new URLSearchParams({
        standInOwnerId,
      })}`,
    ),
  );
  return payload.exchanges;
}

async function disconnectBinding(
  page: Page,
  bindingId: string | undefined,
): Promise<void> {
  if (!bindingId || page.isClosed()) return;
  try {
    await page.request.post(
      `${apiUrl}/v1/pilot/agent-bindings/${bindingId}/disconnect`,
      { data: {} },
    );
  } catch {
    // Cleanup must not replace the scenario's actionable failure while the
    // watched development server is briefly restarting.
  }
}

async function json<T>(
  response: APIResponse,
  requireSuccess = true,
): Promise<T> {
  if (requireSuccess) expect(response.ok()).toBe(true);
  if (!response.ok()) return {} as T;
  return (await response.json()) as T;
}

function containsPrivateExecutionDetail(value: string): boolean {
  return [
    "/Users/",
    "terminal output",
    "raw prompt",
    "api key",
    "git diff",
  ].some((needle) => value.toLocaleLowerCase().includes(needle.toLowerCase()));
}

function scoreScenario(input: {
  accurate: boolean;
  legible: boolean;
  timely: boolean;
  actionable: boolean;
  privateAndScoped: boolean;
}): {
  accuracy: number;
  legibility: number;
  timeliness: number;
  actionability: number;
  privacyAndScope: number;
  total: number;
  passed: boolean;
} {
  const values = [
    input.accurate,
    input.legible,
    input.timely,
    input.actionable,
    input.privateAndScoped,
  ].map((value) => (value ? 2 : 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    accuracy: values[0]!,
    legibility: values[1]!,
    timeliness: values[2]!,
    actionability: values[3]!,
    privacyAndScope: values[4]!,
    total,
    passed: total >= 8 && values[0] !== 0 && values[4] !== 0,
  };
}

function emitSafeResult(result: Record<string, unknown>): void {
  process.stdout.write(`COLLABORATION_RESULT ${JSON.stringify(result)}\n`);
}

function runSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
