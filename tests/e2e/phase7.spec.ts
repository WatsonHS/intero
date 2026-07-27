import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { expect, test, type Page } from "@playwright/test";

const execFileAsync = promisify(execFile);
const apiUrl = process.env.INTERO_E2E_API_URL ?? "http://localhost:4333";
const projectId = "019f9a00-0000-7000-8000-000000000401";
const repositoryRoot = resolve(import.meta.dirname, "../..");

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("Intero-demo-2026!");
  await page.getByRole("button", { name: "使用邮箱和密码登录" }).click();
  await expect(page.getByTitle("Team Pulse")).toBeVisible();
}

async function runCloudClient(
  args: string[],
  cloudDataDir: string,
): Promise<string> {
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
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  return result.stdout;
}

test("two users see bounded Agent automation, confirm it, and observe a human revert", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString(36);
  const focus = `支付回调重放仍缺少幂等保护（${suffix}）`;
  const conclusion = `由 Priya 补齐幂等键验证，再由 Alex 决定是否继续发布（${suffix}）`;
  const cloudDataDir = await mkdtemp(resolve(tmpdir(), "intero-phase7-e2e-"));
  const adminContext = await browser.newContext({ reducedMotion: "reduce" });
  const leaderContext = await browser.newContext({ reducedMotion: "reduce" });
  const admin = await adminContext.newPage();
  const leader = await leaderContext.newPage();
  let connectedBindingId: string | undefined;
  let connectedClient: "codex" | "claude-code" | "opencode" | undefined;

  try {
    await Promise.all([
      signIn(admin, "alex@demo.intero.test"),
      signIn(leader, "priya@demo.intero.test"),
    ]);

    for (const page of [admin, leader]) {
      await page.getByTitle("通讯").click();
      await expect(page.getByText("产品体验 · 团队频道").first()).toBeVisible();
      await page.getByText("产品体验 · 团队频道").first().click();
      await expect(
        page.getByText(/大家早，今天产品体验组继续看统一发布控制台/),
      ).toBeVisible();
    }

    await admin.getByTitle("设置").click();
    await admin.getByTestId("settings-category-project").click();
    await expect(
      admin.getByTestId("project-automation-settings"),
    ).toBeVisible();
    await expect(admin.getByTestId("project-automation-enabled")).toBeVisible();
    await expect(
      admin.getByText("替身只识别已授权的结构化风险信号"),
    ).toBeVisible();
    await admin.getByTestId("settings-category-agent").click();
    await admin.getByTestId("open-agent-connections").click();

    const connectClients = ["claude-code", "opencode", "codex"] as const;
    let connectClient: (typeof connectClients)[number] | undefined;
    for (const candidate of connectClients) {
      if (await admin.getByTestId(`connect-agent-${candidate}`).isEnabled()) {
        connectClient = candidate;
        break;
      }
    }
    expect(connectClient).toBeTruthy();
    connectedClient = connectClient;
    await admin.getByTestId(`connect-agent-${connectClient}`).click();
    await admin.getByText("其他方式：查看完整连接任务").click();
    const prompt = admin.getByTestId("agent-connect-prompt");
    await expect(prompt).toBeVisible();
    const promptText = (await prompt.textContent()) ?? "";
    const ticket = promptText.match(
      /"ticket":\s*"((?:ott|ticket)_[A-Za-z0-9_-]+)"/,
    )?.[1];
    expect(ticket).toBeTruthy();

    const connectOutput = await runCloudClient(
      [
        "connect",
        "--client",
        connectClient!,
        "--cloud-url",
        apiUrl,
        "--connect-ticket",
        ticket!,
      ],
      cloudDataDir,
    );
    expect(connectOutput).toContain('"connected": true');

    const checkpointOutput = await runCloudClient(
      [
        "checkpoint",
        "--mcp-source",
        connectClient!,
        "--event-type",
        "blocker_raised",
        "--current-focus",
        focus,
        "--completed-outcome",
        "已完成回调签名校验，并用三组历史事件复现重复入账风险。",
        "--evidence",
        "验证记录 callback-replay-17",
        "--next-step",
        "补齐幂等键覆盖后重新执行回放验证。",
        "--needs-help",
        "--help-request",
        "请 Priya 确认幂等键边界与验收条件。",
        "--requested-from",
        "Priya Shah",
        "--client-event-id",
        `phase7-browser-${suffix}`,
        "--workstream-key",
        `payment-callback-${suffix}`,
        "--workstream-title",
        "支付回调可靠性",
        "--phase",
        "blocked",
      ],
      cloudDataDir,
    );
    expect(checkpointOutput).toMatch(/pending|queued/i);
    await admin.screenshot({
      path: "output/playwright/phase7/01-admin-agent-and-policy.png",
      fullPage: true,
    });

    await leader.getByRole("button", { name: "通知" }).click();
    const targetedItem = leader
      .locator("article")
      .filter({ hasText: focus })
      .first();
    await expect(targetedItem).toBeVisible({ timeout: 75_000 });
    await expect(
      leader.getByTestId("automation-portfolio-summary"),
    ).toContainText(focus);
    await leader.screenshot({
      path: "output/playwright/phase7/02-leader-targeted-inbox.png",
      fullPage: true,
    });

    await targetedItem.locator("button").first().click();
    const context = leader.getByTestId("automation-coordination-context");
    await expect(context).toContainText(focus);
    await expect(context).toContainText("补齐幂等键覆盖后重新执行回放验证");
    await leader.screenshot({
      path: "output/playwright/phase7/03-leader-bounded-coordination.png",
      fullPage: true,
    });

    await leader.getByTestId("pilot-coordination-conclusion").fill(conclusion);
    await leader.getByLabel("负责人").selectOption({ label: "Priya Shah" });
    await leader.getByTestId("pilot-coordination-propose").click();
    await expect(
      leader.getByTestId("pilot-coordination-confirm"),
    ).toBeVisible();
    await leader.getByTestId("pilot-coordination-confirm").click();
    await expect(leader.getByText(conclusion)).toBeVisible();

    const automationResponse = await admin.request.get(
      `${apiUrl}/v1/project-automation/${projectId}`,
    );
    expect(automationResponse.ok()).toBeTruthy();
    const automation = (await automationResponse.json()) as {
      signals: Array<{
        signal: {
          id: string;
          status: string;
          safeContext: string;
          coordinationThreadId?: string;
        };
      }>;
    };
    const created = automation.signals.find(
      ({ signal }) => signal.safeContext === focus,
    )?.signal;
    expect(created?.status).toBe("confirmed");
    expect(created?.coordinationThreadId).toBeTruthy();

    await admin.getByTitle("Coordination").click();
    await admin
      .getByTestId(`pilot-coordination-thread-${created!.coordinationThreadId}`)
      .click();
    await expect(
      admin.getByTestId("automation-coordination-context"),
    ).toContainText(focus);
    await admin.getByTestId("automation-coordination-revert").click();

    await expect
      .poll(
        async () => {
          const response = await leader.request.get(
            `${apiUrl}/v1/project-automation/${projectId}`,
          );
          const payload = (await response.json()) as typeof automation;
          return payload.signals.find(({ signal }) => signal.id === created!.id)
            ?.signal.status;
        },
        { timeout: 15_000 },
      )
      .toBe("reverted");
    await expect(
      leader.getByTestId("automation-coordination-context"),
    ).toContainText(focus);
    await expect(
      leader.getByTestId("automation-coordination-context"),
    ).toContainText("reverted");
    const propagatedContext = leader.getByTestId(
      "automation-coordination-context",
    );
    await propagatedContext.scrollIntoViewIfNeeded();
    const auditDetails = propagatedContext.locator("details");
    if (!(await auditDetails.getAttribute("open"))) {
      await auditDetails.locator("summary").click();
    }
    await expect(auditDetails).toContainText("reverted");
    await leader.screenshot({
      path: "output/playwright/phase7/04-revert-propagated-to-leader.png",
      fullPage: true,
    });
  } finally {
    if (admin.url() !== "about:blank") {
      const overview = await admin.request.get(
        `${apiUrl}/v1/pilot/projects/${projectId}/overview`,
      );
      if (overview.ok()) {
        const payload = (await overview.json()) as {
          bindings: Array<{
            id: string;
            client: "codex" | "claude-code" | "opencode";
            name: string;
            ownerId: string;
            disconnectedAt?: string;
          }>;
        };
        const connection = payload.bindings.find(
          (binding) =>
            binding.client === connectedClient &&
            !binding.name.startsWith("Demo ") &&
            !binding.disconnectedAt,
        );
        connectedBindingId = connection?.id;
      }
    }
    if (connectedBindingId) {
      await admin.request.post(
        `${apiUrl}/v1/pilot/agent-bindings/${connectedBindingId}/disconnect`,
        { data: {} },
      );
    }
    await Promise.all([adminContext.close(), leaderContext.close()]);
    await rm(cloudDataDir, { recursive: true, force: true });
  }
});
