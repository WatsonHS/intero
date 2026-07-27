import { expect, test, type Page } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";

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
  expect(promptText).toContain("[mcp_servers.intero]");
  expect(promptText).toContain(".codex/config.toml");
  expect(promptText).toContain("AGENTS.md");
  expect(promptText).toContain("enabled = true");
  expect(promptText).toContain("configured_waiting_for_oauth");
  expect(promptText).not.toContain('auth = "oauth"');
  expect(promptText).not.toContain("required = false");
  expect(promptText).not.toMatch(/ticket_|credential|verification|SDK|CLI/i);
  await expect(
    page.locator(
      '[data-testid^="pilot-agent-disconnect-"][data-client="codex"]',
    ),
  ).toHaveCount(1);
  await expect(page.getByText("等待 GUI OAuth 授权")).toBeVisible();

  const connection = await authorizeConnection(page, promptText);
  await initializeMcp(page, connection);

  const disconnectButton = page.getByTestId(
    `pilot-agent-disconnect-${connection.bindingId}`,
  );
  const status = disconnectButton.locator("xpath=..");
  await expect(status).toContainText("Codex repository");
  await expect(status).toContainText("OAuth 与原生 MCP 已验证");
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
  mcpUrl: string;
}

async function authorizeConnection(
  page: Page,
  prompt: string,
): Promise<TestAgentConnection> {
  const mcpUrl = prompt.match(/url = "([^"]+)"/)?.[1];
  expect(mcpUrl).toBeTruthy();
  const bindingId = new URL(mcpUrl!).pathname.match(
    /agent-connections\/([^/]+)\/mcp$/,
  )?.[1];
  expect(bindingId).toBeTruthy();

  const challenge = await page.request.post(mcpUrl!, {
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    data: initializePayload("oauth-challenge"),
  });
  expect(challenge.status()).toBe(401);
  const resourceMetadataUrl = challenge
    .headers()
    ["www-authenticate"]?.match(/resource_metadata="([^"]+)"/)?.[1];
  expect(resourceMetadataUrl).toBeTruthy();
  const metadata = await page.request.get(resourceMetadataUrl!);
  expect(metadata.ok()).toBe(true);
  const resource = (await metadata.json()) as {
    resource: string;
    authorization_servers: string[];
  };

  const registration = await page.request.post(
    `${resource.authorization_servers[0]}/oauth2/register`,
    {
      data: {
        client_name: "Codex E2E",
        redirect_uris: ["http://127.0.0.1:1455/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        type: "native",
        scope: "openid offline_access intero:mcp",
      },
    },
  );
  expect(registration.ok()).toBe(true);
  const client = (await registration.json()) as {
    client_id: string;
  };

  const verifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const authorizeUrl = new URL(
    `${resource.authorization_servers[0]}/oauth2/authorize`,
  );
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: "http://127.0.0.1:1455/callback",
    scope: "openid offline_access intero:mcp",
    state: "codex-e2e",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "consent",
  }).toString();
  const authorize = await page.request.get(authorizeUrl.toString(), {
    maxRedirects: 0,
    headers: { accept: "application/json" },
  });
  const authorizeBody = (await authorize.json()) as { url: string };
  const consentUrl = new URL(authorizeBody.url, apiUrl);
  const consent = await page.request.post(
    `${resource.authorization_servers[0]}/oauth2/consent`,
    {
      data: {
        accept: true,
        oauth_query: consentUrl.search.slice(1),
      },
      headers: { origin: apiUrl, accept: "application/json" },
    },
  );
  expect(consent.ok()).toBe(true);
  const consentBody = (await consent.json()) as {
    url?: string;
    redirect_uri?: string;
  };
  const callback = new URL(consentBody.url ?? consentBody.redirect_uri!);
  const code = callback.searchParams.get("code");
  expect(code).toBeTruthy();

  const token = await page.request.post(
    `${resource.authorization_servers[0]}/oauth2/token`,
    {
      form: {
        grant_type: "authorization_code",
        client_id: client.client_id,
        code: code!,
        code_verifier: verifier,
        redirect_uri: "http://127.0.0.1:1455/callback",
        resource: resource.resource,
      },
    },
  );
  const tokenText = await token.text();
  expect(token.ok(), tokenText).toBe(true);
  const tokenBody = JSON.parse(tokenText) as { access_token: string };
  return {
    bindingId: bindingId!,
    accessToken: tokenBody.access_token,
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
