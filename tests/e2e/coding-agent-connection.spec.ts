import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const apiUrl = process.env.INTERO_E2E_API_URL ?? "http://127.0.0.1:4310";
const password = process.env.INTERO_E2E_PASSWORD ?? "Intero-demo-2026!";

test("Web reflects authenticated MCP initialization and functional validation", async ({
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
  await expect(page.getByTestId("pilot-cloud-settings")).toBeVisible();
  await expect(page.getByText("桌面 Git 感知")).toHaveCount(0);
  await page.getByTestId("open-agent-connections").click();
  await expect(page.getByTestId("agent-connection-project")).toHaveValue(
    project.id,
  );

  await page.getByTestId("connect-agent-codex").click();
  await page.getByText("其他方式：查看完整连接任务").click();
  const prompt = page.getByTestId("agent-connect-prompt");
  await expect(prompt).toBeVisible();
  const promptText = (await prompt.textContent()) ?? "";
  expect(promptText).toContain('"transport": "streamable-http"');
  expect(promptText).toContain(".codex/config.toml");
  expect(promptText).toContain("AGENTS.md");
  expect(promptText).toContain(
    '"authorization": "Bearer credential returned by setup exchange"',
  );
  expect(promptText).toContain("pending_gui_validation");
  expect(promptText).not.toContain("required = false");
  expect(promptText).not.toMatch(/\b(?:SDK|CLI|stdio)\b/i);
  expect(promptText).not.toMatch(/不要|不得|禁止|never|do not/i);
  await expect(
    page.locator(
      '[data-testid^="pilot-agent-disconnect-"][data-client="codex"]',
    ),
  ).toHaveCount(0);
  await expect(page.getByText("等待原生 MCP 加载")).toBeVisible();

  const connection = await exchangeConnection(page, promptText);
  await initializeMcp(page, connection);

  const disconnectButton = page.getByTestId(
    `pilot-agent-disconnect-${connection.bindingId}`,
  );
  const status = disconnectButton.locator("xpath=..");
  await expect(status).toContainText("Codex E2E repository");
  await expect(status).toContainText("Bearer credential 与原生 MCP 已验证");
  await expect(page.getByTestId("agent-connection-success")).toBeVisible();
  await expect(page.getByTestId("connect-agent-codex")).toHaveText(
    "连接另一个 Codex 仓库",
  );

  const overview = await page.request.get(
    `${apiUrl}/v1/pilot/projects/${project.id}/overview`,
  );
  expect(overview.ok()).toBe(true);
  const overviewBody = (await overview.json()) as {
    bindings: Array<{
      id: string;
      client: string;
      mcpInitializedAt?: string;
      validatedAt?: string;
      disconnectedAt?: string;
    }>;
  };
  const binding = overviewBody.bindings.find(
    (candidate) => candidate.client === "codex" && !candidate.disconnectedAt,
  );
  expect(binding?.id).toBe(connection.bindingId);
  expect(binding?.mcpInitializedAt).toBeTruthy();
  expect(binding?.validatedAt).toBeTruthy();

  await disconnectButton.click();
  await expect(page.getByTestId("connect-agent-codex")).toHaveText(
    "连接 Codex",
  );
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByTestId("agent-connections-panel")).not.toBeVisible();
  await expect(page.getByTestId("pilot-cloud-settings")).toBeVisible();
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

interface TestAgentConnection {
  bindingId: string;
  accessToken: string;
  verificationCode: string;
  mcpUrl: string;
}

async function exchangeConnection(
  page: Page,
  prompt: string,
): Promise<TestAgentConnection> {
  const ticket = prompt.match(
    /"ticket":\s*"((?:ott|ticket)_[A-Za-z0-9_-]+)"/,
  )?.[1];
  const exchangeUrl = prompt.match(/"exchangeUrl":\s*"([^"]+)"/)?.[1];
  const mcpUrl = prompt.match(
    /"url":\s*"(https?:\/\/[^"]+\/v1\/pilot\/mcp)"/,
  )?.[1];
  expect(ticket).toBeTruthy();
  expect(exchangeUrl).toBeTruthy();
  expect(mcpUrl).toBeTruthy();
  const exchanged = await page.request.post(exchangeUrl!, {
    data: {
      ticket,
      client: "codex",
      name: "Codex E2E repository",
      workspaceId: randomUUID(),
    },
  });
  const exchangedText = await exchanged.text();
  expect(exchanged.ok(), exchangedText).toBe(true);
  const result = JSON.parse(exchangedText) as {
    credential: string;
    verification: { code: string };
    binding: { id: string };
  };
  return {
    bindingId: result.binding.id,
    accessToken: result.credential,
    verificationCode: result.verification.code,
    mcpUrl: mcpUrl!,
  };
}

async function initializeMcp(
  page: Page,
  connection: TestAgentConnection,
): Promise<void> {
  const response = await page.request.post(connection.mcpUrl, {
    headers: mcpHeaders(connection.accessToken),
    data: initializePayload("initialize-e2e"),
  });
  const responseText = await response.text();
  expect(response.ok(), responseText).toBe(true);
  const validation = await page.request.post(connection.mcpUrl, {
    headers: mcpHeaders(connection.accessToken),
    data: {
      jsonrpc: "2.0",
      id: "validate-e2e",
      method: "tools/call",
      params: {
        name: "intero.validate_connection",
        arguments: { verificationCode: connection.verificationCode },
      },
    },
  });
  const validationText = await validation.text();
  expect(validation.ok(), validationText).toBe(true);
  expect(validationText).toContain('"status":"connected"');
}

function mcpHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
}

function initializePayload(id: string) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "codex", version: "e2e" },
    },
  };
}
