import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SpiceDbAuthorization } from "./spicedb-authorization.js";

const endpoint = process.env.INTERO_SPICEDB_ENDPOINT;
const token = process.env.INTERO_SPICEDB_TOKEN;
const integrationSuite = endpoint && token ? describe : describe.skip;

describe("SpiceDB transport configuration", () => {
  it("rejects conflicting plaintext and custom-CA settings", () => {
    expect(
      () =>
        new SpiceDbAuthorization({
          endpoint: "spicedb:50051",
          token: "server-only-token",
          insecureLocalhost: true,
          certificate: Buffer.from("not-a-certificate"),
        }),
    ).toThrow("cannot use both insecure transport and a custom CA certificate");
  });
});

integrationSuite("SpiceDB Authorization port", () => {
  let authorization: SpiceDbAuthorization;
  const principalId = `principal-${Date.now()}`;
  const projectId = `project-${Date.now()}`;
  let consistencyToken: string | undefined;

  beforeAll(async () => {
    authorization = new SpiceDbAuthorization({
      endpoint: endpoint!,
      token: token!,
      insecureLocalhost: true,
      timeoutMs: 2_000,
    });
    const schema = await readFile(
      new URL("../../../infra/spicedb/schema.zed", import.meta.url),
      "utf8",
    );
    await authorization.writeSchema(schema);
    consistencyToken = await authorization.touchRelationship({
      resourceType: "project",
      resourceId: projectId,
      relation: "member",
      principalId,
    });
  });

  afterAll(() => authorization?.close());

  it("allows a related principal and denies an unrelated principal", async () => {
    await expect(
      authorization.check({
        principalId,
        resourceType: "project",
        resourceId: projectId,
        permission: "view",
        ...(consistencyToken ? { consistencyToken } : {}),
      }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      authorization.check({
        principalId: "unrelated-principal",
        resourceType: "project",
        resourceId: projectId,
        permission: "view",
      }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("retains concurrent relationship repairs before checking permissions", async () => {
    const relationships = Array.from({ length: 24 }, (_, index) => {
      const resourceType =
        index % 3 === 0 ? "organization" : index % 3 === 1 ? "team" : "project";
      return {
        resourceType,
        resourceId: `concurrent-${Date.now()}-${index}`,
        relation: resourceType === "organization" ? "admin" : "member",
        permission: resourceType === "organization" ? "manage" : "participate",
        principalId: `concurrent-principal-${Date.now()}-${index}`,
      };
    });
    const tokens = await Promise.all(
      relationships.map((relationship) =>
        authorization.touchRelationship(relationship),
      ),
    );
    const checks = await Promise.all(
      relationships.map((relationship, index) =>
        authorization.check({
          principalId: relationship.principalId,
          resourceType: relationship.resourceType,
          resourceId: relationship.resourceId,
          permission: relationship.permission,
          ...(tokens[index] ? { consistencyToken: tokens[index] } : {}),
        }),
      ),
    );

    expect(checks.every((check) => check.allowed)).toBe(true);
  });

  it("fails closed when SpiceDB is unavailable", async () => {
    const unavailable = new SpiceDbAuthorization({
      endpoint: "127.0.0.1:59999",
      token: "unused",
      insecureLocalhost: true,
      timeoutMs: 250,
    });
    await expect(
      unavailable.check({
        principalId,
        resourceType: "project",
        resourceId: projectId,
        permission: "view",
      }),
    ).resolves.toEqual({ allowed: false });
    unavailable.close();
  });
});
