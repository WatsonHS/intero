import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import type { FastifyInstance } from "fastify";
import { expect, test, type Page } from "@playwright/test";

import { buildTestApp } from "../../apps/server-api/src/test-app.js";
import {
  createGoldenCaseFixture,
  GOLDEN_CASE_IDS,
  type GoldenCaseFixture,
} from "../../apps/server-api/src/test-fixtures/golden-case.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const evidenceRoot = resolve(repositoryRoot, "output/playwright/golden-case");
const projectStorageKey = "intero.pilot.project.v1";
const teamStorageKey = "intero.pilot.team.v1";
const identityStorageKey = "intero.pilot.identity.v1";
const rendererUrl =
  process.env.INTERO_E2E_RENDERER_URL ?? "http://127.0.0.1:5183";
let rendererProcess: ChildProcess | undefined;

test.use({ trace: "off", screenshot: "off" });

test.describe("Golden Case acceptance matrix", () => {
  test.beforeAll(async () => {
    await mkdir(evidenceRoot, { recursive: true });
    rendererProcess = await ensureRenderer();
  });

  test.afterAll(async () => {
    rendererProcess?.kill("SIGTERM");
  });

  test("compatible control answers once without opening coordination", async ({
    page,
  }) => {
    const harness = await createHarness("compatible");
    try {
      await attachFixtureApi(page, harness.app, GOLDEN_CASE_IDS.alex);
      await openEngineeringRoom(page);
      await assertInteroMentionPicker(page, harness.fixture);
      await sendInteroMessage(
        page,
        "compare Auth Platform and Mobile App on retryDelayMs.",
      );

      const summary = page.locator('[data-testid^="coordination-summary-"]');
      await expect(summary).toHaveCount(1);
      await expect(summary).toContainText(/compatible|兼容/i);
      await expect(page.getByTestId("coordination-layered-brief")).toHaveCount(
        0,
      );
      expect(
        await harness.fixture.pilotStore.listCoordination(
          GOLDEN_CASE_IDS.authProject,
          GOLDEN_CASE_IDS.alex,
        ),
      ).toEqual([]);
      expect(
        harness.fixture.conversations.listThreads(
          "coordination",
          GOLDEN_CASE_IDS.alex,
        ),
      ).toEqual([]);
      await page.screenshot({
        path: resolve(evidenceRoot, "01-compatible-control.png"),
        fullPage: true,
      });
    } finally {
      await harness.app.close();
    }
  });

  test("ambiguous scope stays bounded and corrects the same Intero entry", async ({
    page,
  }) => {
    const harness = await createHarness("conflict");
    await seedRestrictedProject(harness.fixture);
    try {
      await attachFixtureApi(page, harness.app, GOLDEN_CASE_IDS.priya);
      await openEngineeringRoom(page);
      await sendInteroMessage(page, "can you check this?");

      const summary = page.locator('[data-testid^="coordination-summary-"]');
      const summaryId = await summary.getAttribute("data-testid");
      const correction = page.locator(
        '[data-testid^="intero-scope-correction-"]',
      );
      await expect(summary).toHaveCount(1);
      await expect(correction).toBeVisible();
      await expect(correction.getByRole("button")).toHaveCount(4);
      await expect(correction).toContainText("Auth Platform");
      await expect(correction).toContainText("Mobile App");
      await expect(correction).not.toContainText("Secret Phoenix");
      expect(
        await harness.fixture.pilotStore.listCoordination(
          GOLDEN_CASE_IDS.authProject,
          GOLDEN_CASE_IDS.priya,
        ),
      ).toEqual([]);

      const teamScope = correction.getByTestId("intero-scope-team");
      await teamScope.click();
      await expect(teamScope).toHaveAttribute("aria-pressed", "true");
      await correction
        .getByRole("button", { name: /应用范围|Apply scope/ })
        .click();
      await expect(
        page.getByTestId("coordination-layered-brief"),
      ).toBeVisible();
      await expect(summary).toHaveAttribute("data-testid", summaryId!);
      await expect(summary).toHaveCount(1);
      const room = harness.fixture.conversations.getThread(
        GOLDEN_CASE_IDS.room,
        GOLDEN_CASE_IDS.priya,
      )!;
      expect(
        room.messages.filter(
          (message) => message.kind === "coordination_summary",
        ),
      ).toHaveLength(1);
      const sourceMessage = room.messages.find(
        (message) =>
          message.kind === "message" &&
          message.senderId === GOLDEN_CASE_IDS.priya,
      )!;
      const request =
        await harness.fixture.pilotStore.getInteroRequestBySourceMessage(
          sourceMessage.id,
        );
      expect(request).toMatchObject({
        status: "answered",
        scopeRevision: 2,
        scopeResolution: {
          kind: "team",
          projectIds: [
            GOLDEN_CASE_IDS.authProject,
            GOLDEN_CASE_IDS.mobileProject,
          ],
        },
      });
      expect(
        await harness.fixture.pilotStore.listCoordination(
          GOLDEN_CASE_IDS.authProject,
          GOLDEN_CASE_IDS.priya,
        ),
      ).toHaveLength(1);
      expect(
        harness.fixture.conversations.listThreads(
          "coordination",
          GOLDEN_CASE_IDS.priya,
        ),
      ).toHaveLength(1);
      await page.screenshot({
        path: resolve(evidenceRoot, "02-scope-corrected-in-place.png"),
        fullPage: true,
      });
    } finally {
      await harness.app.close();
    }
  });

  test("prompted conflict supports relevance, replay, and one human closure", async ({
    browser,
  }) => {
    const harness = await createHarness("conflict");
    const alexContext = await browser.newContext({ reducedMotion: "reduce" });
    const priyaContext = await browser.newContext({ reducedMotion: "reduce" });
    const alex = await alexContext.newPage();
    const priya = await priyaContext.newPage();
    try {
      await attachFixtureApi(alex, harness.app, GOLDEN_CASE_IDS.alex);
      await attachFixtureApi(priya, harness.app, GOLDEN_CASE_IDS.priya);
      await openEngineeringRoom(alex);
      await sendInteroMessage(
        alex,
        "coordinate Auth Platform and Mobile App on retryDelayMs.",
      );

      const summary = alex.locator('[data-testid^="coordination-summary-"]');
      await expect(summary).toHaveCount(1);
      await expect(
        alex.getByTestId("coordination-layered-brief"),
      ).toBeVisible();
      await expect(
        alex.getByTestId("coordination-layered-brief"),
      ).toContainText("retryDelayMs");
      await openEngineeringRoom(priya);
      await expect(
        priya.getByTestId("coordination-layered-brief"),
      ).toBeVisible();
      await expect(
        priya.getByTestId("coordination-layered-brief"),
      ).toContainText("retryDelayMs");
      const coordination = (
        await harness.fixture.pilotStore.listCoordination(
          GOLDEN_CASE_IDS.authProject,
          GOLDEN_CASE_IDS.alex,
        )
      )[0]!;
      expect(coordination.projectIds).toEqual([
        GOLDEN_CASE_IDS.authProject,
        GOLDEN_CASE_IDS.mobileProject,
      ]);

      const sourceMessage = harness.fixture.conversations
        .getThread(GOLDEN_CASE_IDS.room, GOLDEN_CASE_IDS.alex)!
        .messages.find(
          (message) =>
            message.kind === "message" &&
            message.senderId === GOLDEN_CASE_IDS.alex,
        )!;
      const request =
        await harness.fixture.pilotStore.getInteroRequestBySourceMessage(
          sourceMessage.id,
        );
      await harness.fixture.processor.handle({
        schemaVersion: 1,
        organizationId: GOLDEN_CASE_IDS.organization,
        requestId: request!.id,
        scopeRevision: request!.scopeRevision,
      });
      expect(
        harness.fixture.conversations
          .getThread(GOLDEN_CASE_IDS.room, GOLDEN_CASE_IDS.alex)!
          .messages.filter(
            (message) => message.kind === "coordination_summary",
          ),
      ).toHaveLength(1);

      await alex.reload();
      await openEngineeringRoom(alex);
      const relevance = alex.getByTestId("coordination-relevance-prompt");
      await expect(relevance).toBeVisible();
      await relevance.getByRole("button", { name: /忽略|Dismiss/ }).click();
      await expect(relevance).toHaveCount(0);
      await openCoordination(alex, coordination.id);
      await alex
        .getByRole("button", {
          name: /恢复相关性提示|Restore relevance prompt/,
        })
        .click();
      await openEngineeringRoom(alex);
      await expect(
        alex.getByTestId("coordination-relevance-prompt"),
      ).toBeVisible();
      await alex
        .getByTestId("coordination-relevance-prompt")
        .getByRole("button", { name: /静音|Mute/ })
        .click();
      await expect(
        alex.getByTestId("coordination-relevance-prompt"),
      ).toHaveCount(0);
      await openCoordination(alex, coordination.id);
      await alex
        .getByRole("button", {
          name: /恢复相关性提示|Restore relevance prompt/,
        })
        .click();
      await openEngineeringRoom(alex);
      await expect(
        alex.getByTestId("coordination-relevance-prompt"),
      ).toBeVisible();
      const afterRelevance = await harness.fixture.pilotStore.getCoordination(
        coordination.id,
      );
      expect(afterRelevance).toMatchObject({ status: "open" });
      expect(afterRelevance).not.toHaveProperty("decisionId");

      await openCoordination(alex, coordination.id);
      const conclusion =
        "Keep retryDelayMs for one compatibility window, then cut over together.";
      await alex.getByTestId("pilot-coordination-conclusion").fill(conclusion);
      await alex
        .getByLabel(/负责人|Responsible person/)
        .selectOption(GOLDEN_CASE_IDS.priya);
      await alex.getByTestId("pilot-coordination-propose").click();

      await openCoordination(priya, coordination.id);
      await priya.getByTestId("pilot-coordination-confirm").click();
      await expect(
        priya.getByTestId("pilot-coordination-resolved-conclusion"),
      ).toContainText(conclusion);

      const decisions = harness.fixture.conversations.listDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        outcome: conclusion,
        decidedBy: [GOLDEN_CASE_IDS.priya],
      });
      const resolved = (
        await harness.fixture.pilotStore.listCoordination(
          GOLDEN_CASE_IDS.authProject,
          GOLDEN_CASE_IDS.alex,
        )
      )[0]!;
      expect(resolved).toMatchObject({
        status: "resolved",
        decisionId: decisions[0]!.id,
        brief: { humanDecision: { outcome: conclusion } },
      });

      await alex.reload();
      await openEngineeringRoom(alex);
      await expect(
        alex.getByTestId("coordination-human-decision"),
      ).toContainText(conclusion);
      await expect(
        alex.locator('[data-testid^="coordination-summary-"]'),
      ).toHaveCount(1);
      await alex.screenshot({
        path: resolve(evidenceRoot, "03-confirmed-shared-result.png"),
        fullPage: true,
      });
    } finally {
      await Promise.all([alexContext.close(), priyaContext.close()]);
      await harness.app.close();
    }
  });

  test("unprompted high-confidence conflict converges with a later prompt", async ({
    page,
  }) => {
    const harness = await createHarness("conflict");
    try {
      const proactive = await harness.fixture.triggerProactiveConflict();
      expect(proactive).toHaveLength(1);
      await attachFixtureApi(page, harness.app, GOLDEN_CASE_IDS.alex);
      await openEngineeringRoom(page);
      await expect(
        page.locator('[data-testid^="coordination-summary-"]'),
      ).toHaveCount(1);
      await sendInteroMessage(
        page,
        "coordinate Auth Platform and Mobile App on retryDelayMs.",
      );
      await expect(
        page.locator('[data-testid^="coordination-summary-"]'),
      ).toHaveCount(1);
      expect(
        await harness.fixture.pilotStore.listCoordination(
          GOLDEN_CASE_IDS.authProject,
          GOLDEN_CASE_IDS.alex,
        ),
      ).toHaveLength(1);
      await page.screenshot({
        path: resolve(evidenceRoot, "04-proactive-prompt-dedupe.png"),
        fullPage: true,
      });
    } finally {
      await harness.app.close();
    }
  });

  test("corrected evidence clears the same visible path without a false Decision", async ({
    page,
  }) => {
    const harness = await createHarness("conflict");
    try {
      await attachFixtureApi(page, harness.app, GOLDEN_CASE_IDS.alex);
      await openEngineeringRoom(page);
      await sendInteroMessage(
        page,
        "coordinate Auth Platform and Mobile App on retryDelayMs.",
      );
      const summary = page.locator('[data-testid^="coordination-summary-"]');
      const summaryId = await summary.getAttribute("data-testid");
      const before = (
        await harness.fixture.pilotStore.listCoordination(
          GOLDEN_CASE_IDS.authProject,
          GOLDEN_CASE_IDS.alex,
        )
      )[0]!;

      await harness.fixture.correctConflictWithCompatibleEvidence();
      await page.reload();
      await openEngineeringRoom(page);

      await expect(summary).toHaveCount(1);
      await expect(summary).toHaveAttribute("data-testid", summaryId!);
      await expect(summary).toContainText(
        /Conflict cleared|no longer supports|冲突已消除/i,
      );
      expect(harness.fixture.conversations.listDecisions()).toEqual([]);
      const after = await harness.fixture.pilotStore.getCoordination(before.id);
      expect(after).toMatchObject({
        id: before.id,
        conversationThreadId: before.conversationThreadId,
        summaryMessageId: before.summaryMessageId,
        status: "resolved",
      });
      expect(after).not.toHaveProperty("decisionId");
      await page.screenshot({
        path: resolve(
          evidenceRoot,
          "05-corrected-evidence-closed-in-place.png",
        ),
        fullPage: true,
      });
    } finally {
      await harness.app.close();
    }
  });
});

async function createHarness(
  classification: "compatible" | "conflict",
): Promise<{ fixture: GoldenCaseFixture; app: FastifyInstance }> {
  const fixture = await createGoldenCaseFixture({ classification });
  const app = await buildTestApp({
    logger: false,
    allowDevelopmentIdentity: true,
    store: fixture.conversations,
    pilotStore: fixture.pilotStore,
    organization: {
      id: GOLDEN_CASE_IDS.organization,
      name: "Intero Lab",
    },
    pilotIdentities: [
      { id: GOLDEN_CASE_IDS.alex, displayName: "Alex", kind: "human" },
      { id: GOLDEN_CASE_IDS.priya, displayName: "Priya", kind: "human" },
    ],
    interoRequestJobs: {
      mode: "inline",
      dispatch: (reference) => fixture.processor.handle(reference),
    },
    providerEncryptionSecret: "golden-case-provider-secret",
    deploymentProbe: async () => true,
  });
  await app.ready();
  return { fixture, app };
}

async function attachFixtureApi(
  page: Page,
  app: FastifyInstance,
  principalId: string,
): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/action-inbox/events") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    if (!url.pathname.startsWith("/v1/") && url.pathname !== "/ready") {
      await route.continue();
      return;
    }
    const headers = {
      ...request.headers(),
      "x-intero-dev-principal-id": principalId,
    };
    delete headers.host;
    delete headers["content-length"];
    const response = await app.inject({
      method: request.method(),
      url: `${url.pathname}${url.search}`,
      headers,
      ...(request.postDataBuffer()
        ? { payload: request.postDataBuffer()! }
        : {}),
    });
    await route.fulfill({
      status: response.statusCode,
      contentType:
        typeof response.headers["content-type"] === "string"
          ? response.headers["content-type"]
          : "application/json",
      body: response.body,
    });
  });
  await page.addInitScript(
    ([identityKey, identityId, projectKey, projectId, teamKey, teamId]) => {
      window.localStorage.setItem(identityKey, identityId);
      window.localStorage.setItem(projectKey, projectId);
      window.localStorage.setItem(teamKey, teamId);
    },
    [
      identityStorageKey,
      principalId,
      projectStorageKey,
      GOLDEN_CASE_IDS.authProject,
      teamStorageKey,
      GOLDEN_CASE_IDS.team,
    ],
  );
  await page.goto("/");
  await expect(page.getByTitle(/Team Pulse|团队脉搏/)).toBeVisible();
}

async function openEngineeringRoom(page: Page): Promise<void> {
  await navigate(page, ["通讯", "Communications"]);
  await page.getByText("#engineering", { exact: true }).first().click();
  await expect(page.getByTestId("communications-composer")).toBeVisible();
}

async function assertInteroMentionPicker(
  page: Page,
  fixture: GoldenCaseFixture,
): Promise<void> {
  const composer = page.getByTestId("communications-composer");
  await composer.fill("@Int");
  const option = page.getByTestId(
    `communications-mention-option-${fixture.interoId}`,
  );
  await expect(option).toBeVisible();
  await expect(option).toContainText("Intero");
  await option.click();
  await expect(composer).toHaveValue("@Intero ");
}

async function sendInteroMessage(page: Page, request: string): Promise<void> {
  const composer = page.getByTestId("communications-composer");
  await composer.fill(`@Intero ${request}`);
  await composer.press("Enter");
  await expect(
    page.locator('[data-testid^="coordination-summary-"]'),
  ).toBeVisible();
}

async function openCoordination(
  page: Page,
  coordinationThreadId: string,
): Promise<void> {
  await navigate(page, ["协调", "Coordination"]);
  await page
    .getByTestId(`pilot-coordination-thread-${coordinationThreadId}`)
    .click();
}

async function navigate(page: Page, labels: string[]): Promise<void> {
  const title = new RegExp(
    `^(?:${labels.map((label) => escapeRegExp(label)).join("|")})$`,
  );
  const candidate = page.getByTitle(title).first();
  await expect(candidate).toBeVisible();
  await candidate.click();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function seedRestrictedProject(
  fixture: GoldenCaseFixture,
): Promise<void> {
  const now = "2026-08-01T08:01:00.000Z";
  const restrictedTeamId = "019fc000-0000-7000-8000-000000000090";
  await fixture.pilotStore.createTeam({
    team: {
      id: restrictedTeamId,
      organizationId: GOLDEN_CASE_IDS.organization,
      name: "Restricted Research",
      createdAt: now,
    },
    principalId: GOLDEN_CASE_IDS.alex,
  });
  await fixture.pilotStore.createProject({
    id: "019fc000-0000-7000-8000-000000000091",
    organizationId: GOLDEN_CASE_IDS.organization,
    name: "Secret Phoenix",
    ownerId: GOLDEN_CASE_IDS.alex,
    primaryTeamId: restrictedTeamId,
    participatingTeamIds: [restrictedTeamId],
    posture: "private",
    createdAt: now,
    updatedAt: now,
  });
}

async function ensureRenderer(): Promise<ChildProcess | undefined> {
  if (await rendererIsReady()) return undefined;
  if (process.env.INTERO_E2E_RENDERER_URL) {
    throw new Error(
      `The configured Golden Case renderer is unavailable at ${rendererUrl}.`,
    );
  }
  const url = new URL(rendererUrl);
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@intero/web",
      "exec",
      "vite",
      "--host",
      url.hostname,
      "--port",
      url.port,
      "--strictPort",
    ],
    { cwd: repositoryRoot, stdio: "ignore" },
  );
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error("The Golden Case Vite renderer exited before startup.");
    }
    if (await rendererIsReady()) return child;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  child.kill("SIGTERM");
  throw new Error("The Golden Case Vite renderer did not become ready.");
}

async function rendererIsReady(): Promise<boolean> {
  try {
    const response = await fetch(rendererUrl, {
      signal: AbortSignal.timeout(500),
    });
    return response.ok;
  } catch {
    return false;
  }
}
