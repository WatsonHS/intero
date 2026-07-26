#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

const mode = process.argv[2] ?? "seed";
const dataDirectory = resolve(
  process.env.INTERO_PHASE5_CLOUD_DATA_DIR ??
    "../../output/playwright/phase5/cloud-client",
);
const client = new Client({ name: "intero-phase5-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: "pnpm",
  args: [
    "--filter",
    "@intero/mcp-stdio",
    "exec",
    "tsx",
    "src/index.ts",
    "--mcp-source",
    "codex",
    "--cloud",
    "--cloud-data-dir",
    dataDirectory,
  ],
});

await client.connect(transport);
try {
  if (mode === "seed") {
    const work = await call("project.list_work", {});
    const currentSprint =
      work.sprints.find((sprint) => sprint.status === "active") ??
      work.sprints.find((sprint) => sprint.status === "planned");
    if (!currentSprint) {
      throw new Error("Create a PI/Sprint in the canonical Project UI first.");
    }
    const mutationPrefix =
      process.env.INTERO_PHASE5_E2E_KEY ?? "phase5-browser-acceptance";
    const item = await call("project.create_work_item", {
      title: "Refund rows in the signed invoice export",
      description:
        "Add refund rows to the finance CSV while preserving one signed record per invoice.",
      status: "in_progress",
      priority: "P1",
      ownerId: work.actor.principalId,
      piId: currentSprint.piId,
      sprintId: currentSprint.id,
      points: 3,
      clientMutationId: `${mutationPrefix}-work-item`,
    });
    await call("project.attach_code_reference", {
      workItemId: item.id,
      kind: "branch",
      label: "billing/refund-export",
      value: "billing/refund-export",
      repository: "commerce-platform",
    });
    const spec = await call("spec.create", {
      title: "Signed invoice export with refund rows",
      markdown: [
        "# Signed invoice export",
        "",
        "The export contains one signed row per invoice.",
        "Refunded invoices include a refund amount and refund timestamp.",
        "Consumers verify the signature before importing the CSV.",
      ].join("\n"),
      changeSummary: "Define refund-row behavior and signature validation.",
      affectedScopes: ["billing/export", "finance/import"],
      clientMutationId: `${mutationPrefix}-spec-v1`,
    });
    await call("spec.request_review", {
      specId: spec.spec.id,
      reviewerIds: [],
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          connectedMcp: true,
          projectId: work.project.id,
          workItemId: item.id,
          specId: spec.spec.id,
          specRevisionId: spec.spec.currentRevisionId,
          currentSprintId: currentSprint.id,
        },
        null,
        2,
      )}\n`,
    );
  } else if (mode === "respond") {
    const specId = requiredEnvironment("INTERO_PHASE5_SPEC_ID");
    const review = await call("spec.list_review_comments", {});
    const relevant = review.items.filter((item) => item.specId === specId);
    if (relevant.length === 0) {
      throw new Error("No current-version review comments were found.");
    }
    const confirmed = await call("spec.get_confirmed", { specId }).catch(
      () => undefined,
    );
    const mutationPrefix =
      process.env.INTERO_PHASE5_E2E_KEY ?? "phase5-browser-acceptance";
    const updated = await call("spec.update", {
      specId,
      title: "Signed invoice export with refund rows",
      markdown: [
        "# Signed invoice export",
        "",
        "The export contains one signed row per invoice.",
        "Refunded and partially refunded invoices include refund amount, currency, and refund timestamp.",
        "Consumers verify the signature before importing the CSV.",
        "",
        "## Validation",
        "",
        "The finance acceptance set covers full refunds, partial refunds, and mixed-currency rejection.",
      ].join("\n"),
      changeSummary:
        "Address review feedback for partial refunds, currency, and acceptance evidence.",
      affectedScopes: ["billing/export", "finance/import"],
      clientMutationId: `${mutationPrefix}-spec-v2`,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          connectedMcp: true,
          specId,
          previousConfirmedRevision:
            confirmed?.revision?.revision ?? null,
          addressedThreadIds: relevant.map((item) => item.thread.id),
          newRevisionId: updated.spec.currentRevisionId,
          versionCount: updated.revisions.length,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }
} finally {
  await client.close();
}

async function call(name, args) {
  const response = await client.callTool({ name, arguments: args });
  const text = response.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error(`${name} returned no JSON text.`);
  const parsed = JSON.parse(text);
  if (response.isError) {
    throw new Error(parsed.message ?? `${name} failed.`);
  }
  return parsed;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
