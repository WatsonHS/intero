import {
  PilotAgentClient,
  PreferredLanguage,
  ProjectId,
  uuidv7,
} from "@intero/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AGENT_SETUP_PATH, buildConnectPrompt } from "./agent-setup.js";
import { buildTestApp } from "./test-app.js";

describe("public Agent setup documents", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    // No organization, project, or authenticated identity is needed to read.
    app = await buildTestApp({ logger: false });
  });
  afterAll(async () => {
    await app.close();
  });

  const cases = PilotAgentClient.options.flatMap((client) =>
    (["web_cli", "desktop_bridge", "standard_plugin"] as const).flatMap(
      (mode) =>
        PreferredLanguage.options.map((language) => ({
          client,
          mode,
          language,
        })),
    ),
  );

  it.each(cases)(
    "serves $client / $mode / $language without connection data",
    async ({ client, mode, language }) => {
      const project = {
        id: ProjectId.parse(uuidv7()),
        name: 'Private project "name"\nwith a newline',
      };
      const ticket = "ticket_private_connection_test_123456789";
      const expectedBindingId = uuidv7();
      const expectedWorkspaceId = uuidv7();
      const prompt = buildConnectPrompt(
        client,
        "https://intero.example:8443/",
        ticket,
        "2026-09-07T10:00:00.000Z",
        project,
        language,
        expectedBindingId,
        mode,
        expectedWorkspaceId,
      );
      expect(prompt.length).toBeLessThan(1_200);
      expect(prompt).not.toContain("connectArguments");
      expect(prompt).not.toContain("pending_gui_validation");
      const url = new URL(prompt.match(/^https:\/\/\S+\/README\.md$/m)![0]);
      expect(url.origin).toBe("https://intero.example:8443");
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
      const effectiveMode =
        mode === "standard_plugin" && !["codex", "cursor"].includes(client)
          ? "web_cli"
          : mode;
      expect(url.pathname).toBe(
        AGENT_SETUP_PATH + "/" + client + "/" + effectiveMode + "/README.md",
      );
      const parameters = JSON.parse(prompt.match(/```json\n([^]*?)\n```/)![1]!);
      expect(parameters).toEqual({
        project,
        client,
        ticket,
        expiresAt: "2026-09-07T10:00:00.000Z",
        preferredLanguage: language,
        expectedBindingId,
        expectedWorkspaceId,
      });
      const response = await app.inject({ method: "GET", url: url.pathname });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe(
        "text/markdown; charset=utf-8",
      );
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.body).toContain("{{ticket}}");
      expect(response.body).toContain(
        '"preferredLanguage":"{{preferredLanguage}}"',
      );
      expect(response.body).not.toMatch(/[\u4e00-\u9fff]/);
      expect(response.body).toContain("{{expectedBindingId}}");
      expect(response.body).toContain("{{expectedWorkspaceId}}");
      expect(response.body).toContain("intero.connection_status");
      expect(response.body).toContain('"configuration":{"version":');
      for (const privateValue of [
        ticket,
        project.id,
        project.name,
        expectedBindingId,
        expectedWorkspaceId,
      ]) {
        expect(url.href).not.toContain(privateValue);
        expect(response.body).not.toContain(privateValue);
      }
    },
  );

  it("rejects unknown versions and invalid variants instead of serving another guide", async () => {
    const stale = await app.inject({
      method: "GET",
      url: "/v1/pilot/agent/setup/v0/codex/web_cli/README.md",
    });
    expect(stale.statusCode).toBe(404);
    for (const variant of ["unknown/web_cli", "codex/unknown"]) {
      const result = await app.inject({
        method: "GET",
        url: AGENT_SETUP_PATH + "/" + variant + "/README.md",
      });
      expect(result.statusCode).toBe(400);
    }
    const query = await app.inject({
      method: "GET",
      url: AGENT_SETUP_PATH + "/codex/web_cli/README.md?ticket=private",
    });
    expect(query.statusCode).toBe(400);
  });

  it("keeps optional binding and workspace parameters out of an ordinary attachment", async () => {
    const project = {
      id: ProjectId.parse(uuidv7()),
      name: "Intero",
      internalMetadata: "not-for-the-connection-prompt",
    };
    const prompt = buildConnectPrompt(
      "codex",
      "https://intero.example",
      "ticket_test_123456789012345",
      "2026-09-07T10:00:00.000Z",
      project,
      "en-US",
    );
    expect(prompt).not.toContain("expectedBindingId");
    expect(prompt).not.toContain("expectedWorkspaceId");
    expect(prompt).not.toContain(project.internalMetadata);
    const response = await app.inject({
      method: "GET",
      url: AGENT_SETUP_PATH + "/codex/desktop_bridge/README.md",
    });
    expect(response.body).toContain("omit their JSON fields when absent");
    expect(response.body).toContain("omit --workspace-id and its value");
  });
});
