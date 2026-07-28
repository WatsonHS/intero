import { createServer } from "node:net";

import { PILOT_AGENT_CONFIGURATION_VERSION } from "@intero/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { ACTIVATION_BOOTSTRAP_HEADER, createInteroAuth } from "./auth.js";
import { migrateDatabase } from "./database/migrate.js";
import { InMemoryPilotStore } from "./pilot-store.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const databaseSuite = databaseUrl && databaseAppUrl ? describe : describe.skip;

databaseSuite("Codex retryable ticket and Bearer MCP connection", () => {
  const pool = new Pool({ connectionString: databaseAppUrl });
  const authSecret = "intero-bearer-integration-secret-at-least-32-bytes";
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `bearer-mcp-${suffix}@intero.test`;
  let authUserId: string | undefined;
  let principalId: string | undefined;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let baseUrl = "";

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    const port = await reservePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const auth = createInteroAuth({
      publicUrl: baseUrl,
      secret: authSecret,
      rpId: "127.0.0.1",
      database: pool,
      trustedOrigins: [baseUrl],
    });
    app = await buildApp({
      logger: false,
      auth,
      authDatabase: pool,
      authPublicUrl: baseUrl,
      authActivationSecret: authSecret,
      pilotStore: new InMemoryPilotStore(),
      providerEncryptionSecret: "bearer-mcp-provider-encryption-secret",
      deploymentProbe: async () => true,
    });
    await app.listen({ host: "127.0.0.1", port });
  });

  afterAll(async () => {
    await app?.close();
    if (authUserId) {
      await pool.query('DELETE FROM "user" WHERE id = $1', [authUserId]);
    }
    if (principalId) {
      await pool.query("DELETE FROM principals WHERE id = $1", [principalId]);
    }
    await pool.end();
  });

  it("retries an opaque ticket until validation, then starts safely after disconnect", async () => {
    const signup = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        [ACTIVATION_BOOTSTRAP_HEADER]: authSecret,
      },
      body: JSON.stringify({
        name: "Bearer MCP fixture",
        email,
        password: "bearer-mcp-fixture-password-123",
      }),
    });
    expect(signup.status).toBe(200);
    const signupBody = (await signup.json()) as { user: { id: string } };
    authUserId = signupBody.user.id;
    const cookie = responseCookie(signup);
    expect(cookie).toContain("better-auth.session_token");

    const setup = await jsonRequest(
      `${baseUrl}/v1/pilot/setup`,
      {
        organizationName: "Bearer MCP",
        teamName: "Platform",
        deploymentBaseUrl: baseUrl,
      },
      cookie,
    );
    expect(setup.response.status).toBe(201);
    principalId = (
      await pool.query<{ principal_id: string }>(
        "SELECT principal_id FROM auth_principals WHERE auth_user_id = $1",
        [authUserId],
      )
    ).rows[0]?.principal_id;
    expect(principalId).toBeTruthy();

    const provider = await jsonRequest(
      `${baseUrl}/v1/pilot/setup/provider`,
      {
        endpoint: "https://models.example.test/v1",
        apiKey: "bearer-mcp-provider-key",
        defaultModel: "pilot-model",
      },
      cookie,
      "PUT",
    );
    expect(provider.response.status).toBe(200);
    const teams = await fetch(`${baseUrl}/v1/pilot/teams`, {
      headers: { cookie },
    }).then((response) => response.json());
    const teamId = teams.teams[0].id as string;
    const projectResult = await jsonRequest(
      `${baseUrl}/v1/pilot/projects`,
      {
        name: "Bearer Project",
        primaryTeamId: teamId,
        participatingTeamIds: [teamId],
        posture: "collaborative",
      },
      cookie,
    );
    expect(projectResult.response.status).toBe(201);
    const projectId = projectResult.body.project.id as string;

    const connectionResult = await jsonRequest(
      `${baseUrl}/v1/pilot/projects/${projectId}/agent-connections`,
      { client: "codex" },
      cookie,
    );
    expect(connectionResult.response.status).toBe(201);
    expect(connectionResult.body.mcpUrl).toBe(`${baseUrl}/v1/pilot/mcp`);
    const ticketId = connectionResult.body.ticket.id as string;
    const rawTicket = (connectionResult.body.connectPrompt as string).match(
      /"ticket":\s*"(ticket_[A-Za-z0-9_-]+)"/,
    )?.[1];
    expect(rawTicket).toBeTruthy();

    const workspaceId = "019d0000-0000-7000-8000-000000000001";
    const firstExchange = await jsonRequest(
      `${baseUrl}/v1/pilot/agent/connect`,
      {
        ticket: rawTicket,
        client: "codex",
        name: "Codex bearer integration",
        workspaceId,
      },
    );
    expect(firstExchange.response.status).toBe(201);
    const connected = await jsonRequest(`${baseUrl}/v1/pilot/agent/connect`, {
      ticket: rawTicket,
      client: "codex",
      name: "Codex bearer integration retry",
      workspaceId,
    });
    expect(connected.response.status).toBe(201);
    expect(connected.body.binding).toMatchObject({
      id: ticketId,
      projectId,
      ownerId: principalId,
      authMode: "project_bearer",
    });
    expect(connected.body.binding).not.toHaveProperty("credentialHash");
    const credential = connected.body.credential as string;
    const verificationCode = connected.body.verification.code as string;
    expect(credential).not.toBe(firstExchange.body.credential);

    const supersededCredential = await mcpRequest(
      `${baseUrl}/v1/pilot/mcp`,
      initializeRequest(),
      firstExchange.body.credential as string,
    );
    expect(supersededCredential.response.status).toBe(401);

    const initialized = await mcpRequest(
      `${baseUrl}/v1/pilot/mcp`,
      initializeRequest(),
      credential,
    );
    expect(initialized.response.status, initialized.text).toBe(200);
    const validated = await mcpRequest(
      `${baseUrl}/v1/pilot/mcp`,
      {
        jsonrpc: "2.0",
        id: "bearer-mcp-validate",
        method: "tools/call",
        params: {
          name: "intero.validate_connection",
          arguments: {
            verificationCode,
            configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
          },
        },
      },
      credential,
    );
    expect(validated.response.status, validated.text).toBe(200);
    const validationResult = JSON.parse(validated.text) as {
      result: { content: Array<{ type: string; text: string }> };
    };
    expect(
      JSON.parse(validationResult.result.content[0]?.text ?? "{}"),
    ).toMatchObject({
      status: "lifecycle_pending",
      connected: false,
      mcpConnected: true,
      lifecycleReady: false,
      ready: false,
      configurationCurrent: true,
      configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
      bindingId: ticketId,
      projectId,
    });

    const replay = await jsonRequest(`${baseUrl}/v1/pilot/agent/connect`, {
      ticket: rawTicket,
      client: "codex",
      name: "Codex replay after validation",
      workspaceId,
    });
    expect(replay.response.status).toBe(401);
    expect(replay.body.code).toBe("AGENT_TICKET_INVALID");

    const disconnected = await jsonRequest(
      `${baseUrl}/v1/pilot/agent-bindings/${ticketId}/disconnect`,
      {},
      cookie,
    );
    expect(disconnected.response.status).toBe(200);

    const afterDisconnect = await mcpRequest(
      `${baseUrl}/v1/pilot/mcp`,
      initializeRequest(),
      credential,
    );
    expect(afterDisconnect.response.status, afterDisconnect.text).toBe(200);
    const disconnectedTools = await mcpRequest(
      `${baseUrl}/v1/pilot/mcp`,
      {
        jsonrpc: "2.0",
        id: "bearer-mcp-disconnected-tools",
        method: "tools/list",
      },
      credential,
    );
    expect(disconnectedTools.response.status, disconnectedTools.text).toBe(200);
    expect(JSON.parse(disconnectedTools.text)).toMatchObject({
      result: {
        tools: [{ name: "intero.connection_status" }],
      },
    });
  });
});

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function jsonRequest(
  url: string,
  body: unknown,
  cookie?: string,
  method = "POST",
): Promise<{ response: Response; body: any }> {
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

async function mcpRequest(
  url: string,
  body: unknown,
  credential: string,
): Promise<{ response: Response; text: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credential}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { response, text: await response.text() };
}

function initializeRequest() {
  return {
    jsonrpc: "2.0",
    id: "bearer-mcp-initialize",
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "codex", version: "integration-test" },
    },
  };
}

function responseCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}
