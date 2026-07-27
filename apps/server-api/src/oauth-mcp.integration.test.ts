import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";

import { uuidv7, type PrincipalId } from "@intero/domain";
import { Pool } from "pg";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { ACTIVATION_BOOTSTRAP_HEADER, createInteroAuth } from "./auth.js";
import { migrateDatabase } from "./database/migrate.js";
import { InMemoryPilotStore } from "./pilot-store.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const databaseSuite = databaseUrl && databaseAppUrl ? describe : describe.skip;

databaseSuite("Codex OAuth MCP connection", () => {
  const pool = new Pool({ connectionString: databaseAppUrl });
  const authSecret = "intero-oauth-integration-secret-at-least-32-bytes";
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `oauth-mcp-${suffix}@intero.test`;
  const principalId = uuidv7() as PrincipalId;
  let authUserId: string | undefined;
  let oauthClientId: string | undefined;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let auth: ReturnType<typeof createInteroAuth>;
  let pilotStore: InMemoryPilotStore;
  let baseUrl = "";

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    const port = await reservePort();
    baseUrl = `http://127.0.0.1:${port}`;
    auth = createInteroAuth({
      publicUrl: baseUrl,
      secret: authSecret,
      rpId: "127.0.0.1",
      database: pool,
      trustedOrigins: [baseUrl],
    });
    pilotStore = new InMemoryPilotStore();
    app = await buildApp({
      logger: false,
      auth,
      authDatabase: pool,
      authPublicUrl: baseUrl,
      authActivationSecret: authSecret,
      pilotStore,
      requestAuth: {
        mode: "session",
        developmentIdentities: [],
        async resolve() {
          return {
            id: principalId,
            displayName: "OAuth MCP fixture",
            kind: "human",
            email,
            ...(authUserId ? { authUserId } : {}),
            preferredLanguage: "en-US",
          };
        },
      },
      providerEncryptionSecret: "oauth-mcp-provider-encryption-secret",
      deploymentProbe: async () => true,
    });
    await app.listen({ host: "127.0.0.1", port });
  });

  afterAll(async () => {
    await app?.close();
    if (oauthClientId) {
      await pool.query('DELETE FROM "oauthClient" WHERE "clientId" = $1', [
        oauthClientId,
      ]);
    }
    if (authUserId) {
      await pool.query('DELETE FROM "user" WHERE id = $1', [authUserId]);
    }
    await pool.query("DELETE FROM principals WHERE id = $1", [principalId]);
    await pool.end();
  });

  it("verifies PKCE OAuth and removes Project access without breaking MCP startup on disconnect", async () => {
    const signup = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        [ACTIVATION_BOOTSTRAP_HEADER]: authSecret,
      },
      body: JSON.stringify({
        name: "OAuth MCP fixture",
        email,
        password: "oauth-mcp-fixture-password-123",
      }),
    });
    expect(signup.status).toBe(200);
    const signupBody = (await signup.json()) as { user: { id: string } };
    authUserId = signupBody.user.id;
    expect(responseCookie(signup)).toContain("better-auth.session_token");

    await pool.query(
      `INSERT INTO principals (id, display_name, kind)
       VALUES ($1, 'OAuth MCP fixture', 'human')`,
      [principalId],
    );
    await pool.query(
      `INSERT INTO auth_principals (auth_user_id, principal_id)
       VALUES ($1, $2)`,
      [authUserId, principalId],
    );

    const setup = await jsonRequest(`${baseUrl}/v1/pilot/setup`, {
      organizationName: "OAuth MCP",
      teamName: "Platform",
      deploymentBaseUrl: baseUrl,
    });
    expect(setup.response.status).toBe(201);
    const provider = await jsonRequest(
      `${baseUrl}/v1/pilot/setup/provider`,
      {
        endpoint: "https://models.example.test/v1",
        apiKey: "oauth-mcp-provider-key",
        defaultModel: "pilot-model",
      },
      "PUT",
    );
    expect(provider.response.status).toBe(200);
    const teams = await fetch(`${baseUrl}/v1/pilot/teams`).then((response) =>
      response.json(),
    );
    const teamId = teams.teams[0].id as string;
    const projectResult = await jsonRequest(`${baseUrl}/v1/pilot/projects`, {
      name: "OAuth Project",
      primaryTeamId: teamId,
      participatingTeamIds: [teamId],
      posture: "collaborative",
    });
    expect(projectResult.response.status).toBe(201);
    const projectId = projectResult.body.project.id as string;
    const connectionResult = await jsonRequest(
      `${baseUrl}/v1/pilot/projects/${projectId}/agent-connections`,
      { client: "codex" },
    );
    expect(connectionResult.response.status).toBe(201);
    const connectionId = connectionResult.body.connection.id as string;
    const mcpUrl = connectionResult.body.mcpUrl as string;

    const challengeResponse = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(initializeRequest()),
    });
    expect(challengeResponse.status).toBe(401);
    const authenticate = challengeResponse.headers.get("www-authenticate");
    expect(authenticate).toContain("oauth-protected-resource");
    expect(authenticate).toContain('scope="intero:mcp"');

    const metadataUrl = authenticate?.match(/resource_metadata="([^"]+)"/)?.[1];
    expect(metadataUrl).toBeTruthy();
    const resourceMetadata = await fetch(metadataUrl!).then((response) =>
      response.json(),
    );
    expect(resourceMetadata).toMatchObject({
      resource: `${baseUrl}/v1/pilot/mcp`,
      authorization_servers: [`${baseUrl}/api/auth`],
      scopes_supported: ["intero:mcp"],
    });
    const serverMetadata = await fetch(
      `${baseUrl}/.well-known/oauth-authorization-server/api/auth`,
    ).then((response) => response.json());
    expect(serverMetadata.authorization_endpoint).toBe(
      `${baseUrl}/api/auth/oauth2/authorize`,
    );
    expect(serverMetadata.registration_endpoint).toBe(
      `${baseUrl}/api/auth/oauth2/register`,
    );

    const registered = await fetch(`${baseUrl}/api/auth/oauth2/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Codex OAuth integration",
        redirect_uris: ["http://127.0.0.1:1455/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        type: "native",
        scope: "openid offline_access intero:mcp",
      }),
    });
    expect(registered.status).toBe(200);
    const client = (await registered.json()) as { client_id: string };
    oauthClientId = client.client_id;

    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorizeUrl = new URL(`${baseUrl}/api/auth/oauth2/authorize`);
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: oauthClientId,
      redirect_uri: "http://127.0.0.1:1455/callback",
      scope: "openid offline_access intero:mcp",
      state: "oauth-mcp-state",
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "consent",
    }).toString();
    const authorize = await fetch(authorizeUrl, {
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    expect(authorize.status).toBe(200);
    const authorizeBody = (await authorize.json()) as {
      url?: string;
      redirect_uri?: string;
    };
    const loginLocation =
      authorize.headers.get("location") ??
      authorizeBody?.url ??
      authorizeBody?.redirect_uri;
    expect(loginLocation).toContain("/?");

    const loginUrl = new URL(loginLocation!, baseUrl);
    const signIn = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        origin: baseUrl,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        password: "oauth-mcp-fixture-password-123",
        oauth_query: loginUrl.search.slice(1),
      }),
      redirect: "manual",
    });
    const signInText = await signIn.text();
    expect(signIn.status, signInText).toBe(200);
    const cookie = responseCookie(signIn);
    expect(cookie).toContain("better-auth.session_token");
    const signInBody = JSON.parse(signInText) as {
      url?: string;
      redirect_uri?: string;
    };
    const consentLocation =
      signIn.headers.get("location") ??
      signInBody.url ??
      signInBody.redirect_uri;
    expect(consentLocation).toContain("/oauth/consent?");

    const consentUrl = new URL(consentLocation!, baseUrl);
    const consent = await fetch(`${baseUrl}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: {
        cookie,
        origin: baseUrl,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accept: true,
        oauth_query: consentUrl.search.slice(1),
      }),
      redirect: "manual",
    });
    expect(consent.status).toBe(200);
    const consentBody = (await consent.json()) as {
      redirect?: boolean;
      url?: string;
      redirect_uri?: string;
    };
    const callbackUrl = new URL(
      consent.headers.get("location") ??
        consentBody.url ??
        consentBody.redirect_uri!,
    );
    expect(callbackUrl.searchParams.get("state")).toBe("oauth-mcp-state");
    const code = callbackUrl.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await fetch(`${baseUrl}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: oauthClientId,
        code: code!,
        code_verifier: verifier,
        redirect_uri: "http://127.0.0.1:1455/callback",
        resource: `${baseUrl}/v1/pilot/mcp`,
      }),
    });
    const tokenText = await token.text();
    expect(token.status, tokenText).toBe(200);
    const tokenBody = JSON.parse(tokenText) as {
      access_token: string;
      refresh_token?: string;
      scope: string;
    };
    expect(tokenBody.access_token).toBeTruthy();
    expect(tokenBody.refresh_token).toBeTruthy();
    expect(tokenBody.scope).toContain("intero:mcp");
    const accessClaims = JSON.parse(
      Buffer.from(tokenBody.access_token.split(".")[1]!, "base64url").toString(
        "utf8",
      ),
    ) as {
      aud?: string | string[];
      iss?: string;
      sub?: string;
      scope?: string;
    };
    expect(accessClaims).toMatchObject({
      aud: expect.arrayContaining([
        `${baseUrl}/v1/pilot/mcp`,
        `${baseUrl}/api/auth/oauth2/userinfo`,
      ]),
      iss: `${baseUrl}/api/auth`,
      sub: authUserId,
    });
    await expect(
      verifyJwsAccessToken(tokenBody.access_token, {
        jwksFetch: () => auth.api.getJwks(),
        jwksCacheKey: auth,
        verifyOptions: {
          audience: `${baseUrl}/v1/pilot/mcp`,
          issuer: `${baseUrl}/api/auth`,
        },
      }),
    ).resolves.toMatchObject({
      sub: authUserId,
      scope: expect.stringContaining("intero:mcp"),
    });
    await expect(
      pool.query(
        "SELECT principal_id FROM auth_principals WHERE auth_user_id = $1",
        [authUserId],
      ),
    ).resolves.toMatchObject({
      rows: [{ principal_id: principalId }],
    });
    await expect(
      pilotStore.findAgentBindingById(connectionId),
    ).resolves.toMatchObject({
      id: connectionId,
      projectId,
      ownerId: principalId,
      authMode: "oauth",
    });

    const initialize = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(initializeRequest()),
    });
    const initializeText = await initialize.text();
    expect(initialize.status, initializeText).toBe(200);

    const overview = await fetch(
      `${baseUrl}/v1/pilot/projects/${projectId}/overview`,
    ).then((response) => response.json());
    expect(
      overview.bindings.find(
        (binding: { id: string }) => binding.id === connectionId,
      ),
    ).toMatchObject({
      authMode: "oauth",
      mcpClientName: "codex",
      validatedAt: expect.any(String),
    });

    const disconnected = await jsonRequest(
      `${baseUrl}/v1/pilot/agent-bindings/${connectionId}/disconnect`,
      {},
    );
    expect(disconnected.response.status).toBe(200);
    const afterDisconnect = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(initializeRequest()),
    });
    const afterDisconnectText = await afterDisconnect.text();
    expect(afterDisconnect.status, afterDisconnectText).toBe(200);

    const disconnectedTools = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "oauth-mcp-disconnected-tools",
        method: "tools/list",
      }),
    });
    const disconnectedToolsText = await disconnectedTools.text();
    expect(disconnectedTools.status, disconnectedToolsText).toBe(200);
    expect(JSON.parse(disconnectedToolsText)).toMatchObject({
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
  method = "POST",
): Promise<{ response: Response; body: any }> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

function initializeRequest() {
  return {
    jsonrpc: "2.0",
    id: "oauth-mcp-initialize",
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
