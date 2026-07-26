import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const apiUrl = process.env.INTERO_E2E_API_URL ?? "http://127.0.0.1:4310";
const repositoryRoot = resolve(import.meta.dirname, "../..");
const password = process.env.INTERO_E2E_PASSWORD ?? "Intero-demo-2026!";

test("Codex natively configures a clean Project and Web reflects the real cloud binding", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  const { project, team } = await createCleanProject(page);
  await page.evaluate(
    ({ projectId, teamId }) => {
      window.localStorage.setItem("intero.pilot.project.v1", projectId);
      window.localStorage.setItem("intero.pilot.team.v1", teamId);
    },
    { projectId: project.id, teamId: team.id },
  );
  await page.reload();

  await page.getByTitle("设置").click();
  await page.getByTestId("settings-category-agent").click();
  await expect(page.getByTestId("agent-connection-settings")).toBeVisible();
  await expect(page.getByText("桌面 Git 感知")).toHaveCount(0);

  await page.getByTestId("connect-agent-codex").click();
  const prompt = page.getByTestId("agent-connect-prompt");
  await expect(prompt).toBeVisible();
  const promptText = await prompt.inputValue();
  expect(promptText).toContain('"protocol": "intero-agent-setup/v1"');
  expect(promptText).toContain(".codex/config.toml");
  expect(promptText).toContain(".codex/hooks.json");
  expect(promptText).toContain("AGENTS.md");
  expect(promptText).toContain("intero.validate_connection");
  expect(promptText).not.toContain("intero-mcp");
  await expect(page.getByTestId("pilot-agent-disconnect-codex")).toHaveCount(0);
  await expect(page.getByTestId("connect-agent-codex")).not.toHaveText(
    "Codex 已连接",
  );

  const canary = await runCodexCanary(promptText);
  expect(canary).toMatchObject({
    status: "connected",
    project: { id: project.id, name: project.name },
    agent: { client: "codex" },
    verification: {
      codexConfigParsed: true,
      realHandshake: true,
      persistedContext: true,
      safeLifecycleHook: true,
    },
  });

  const status = page
    .getByTestId("pilot-agent-disconnect-codex")
    .locator("xpath=..");
  await expect(status).toContainText("Codex · connection-e2e");
  await expect(status).toContainText(project.name);
  await expect(status).toContainText("已连接");
  await expect(page.getByTestId("connect-agent-codex")).toHaveText(
    "Codex 已连接",
  );

  const overview = await page.request.get(
    `${apiUrl}/v1/pilot/projects/${project.id}/overview`,
  );
  expect(overview.ok()).toBe(true);
  const overviewBody = (await overview.json()) as {
    bindings: Array<{
      id: string;
      client: string;
      validatedAt?: string;
      disconnectedAt?: string;
    }>;
  };
  const binding = overviewBody.bindings.find(
    (candidate) => candidate.client === "codex" && !candidate.disconnectedAt,
  );
  expect(binding?.id).toBe(canary.agent.bindingId);
  expect(binding?.validatedAt).toBeTruthy();

  await page.getByTestId("pilot-agent-disconnect-codex").click();
  await expect(page.getByTestId("connect-agent-codex")).toHaveText(
    "重新连接 Codex",
  );
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByTestId("sign-in-email").fill("alex@demo.intero.test");
  await page.getByTestId("sign-in-password").fill(password);
  await page.getByTestId("sign-in-password-submit").click();
  await expect(page.getByTitle("Team Pulse")).toBeVisible();
}

async function createCleanProject(page: Page) {
  const teamsResponse = await page.request.get(`${apiUrl}/v1/pilot/teams`);
  expect(teamsResponse.ok()).toBe(true);
  const teamsBody = (await teamsResponse.json()) as {
    teams: Array<{
      id: string;
      name: string;
      members: Array<{ email: string }>;
    }>;
  };
  const team = teamsBody.teams.find((candidate) =>
    candidate.members.some(
      (member) => member.email === "alex@demo.intero.test",
    ),
  );
  expect(team).toBeDefined();
  const created = await page.request.post(`${apiUrl}/v1/pilot/projects`, {
    data: {
      name: `Connection canary ${Date.now().toString(36)}`,
      primaryTeamId: team!.id,
      participatingTeamIds: [team!.id],
      posture: "collaborative",
    },
  });
  const createdText = await created.text();
  expect(created.status(), createdText).toBe(201);
  const body = JSON.parse(createdText) as {
    project: { id: string; name: string };
  };
  const overview = await page.request.get(
    `${apiUrl}/v1/pilot/projects/${body.project.id}/overview`,
  );
  expect(overview.ok()).toBe(true);
  expect(await overview.json()).toMatchObject({
    bindings: [],
    privateWorkState: [],
    pulse: [],
    coordination: [],
  });
  return { project: body.project, team: team! };
}

async function runCodexCanary(prompt: string): Promise<{
  status: string;
  project: { id: string; name: string };
  agent: { client: string; bindingId: string; name: string };
  verification: {
    codexConfigParsed: boolean;
    realHandshake: boolean;
    persistedContext: boolean;
    safeLifecycleHook: boolean;
  };
}> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      "node",
      ["apps/server-api/scripts/codex-native-connection-canary.mjs"],
      {
        cwd: repositoryRoot,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Codex native connection canary failed (${code}): ${stderr}`,
          ),
        );
        return;
      }
      try {
        resolveResult(JSON.parse(stdout));
      } catch {
        reject(
          new Error("Codex native connection canary returned invalid JSON."),
        );
      }
    });
    child.stdin.end(
      JSON.stringify({
        prompt,
        repositoryName: "connection-e2e",
      }),
    );
  });
}
