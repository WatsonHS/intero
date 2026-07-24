import { readFile } from "node:fs/promises";

import { SpiceDbAuthorization } from "./spicedb-authorization.js";

const endpoint = process.env.INTERO_SPICEDB_ENDPOINT ?? "127.0.0.1:50051";
const token = process.env.INTERO_SPICEDB_TOKEN ?? "intero-development";
const schema = await readFile(
  new URL("../../../infra/spicedb/schema.zed", import.meta.url),
  "utf8",
);
const authorization = new SpiceDbAuthorization({
  endpoint,
  token,
  insecureLocalhost: process.env.INTERO_SPICEDB_INSECURE !== "false",
  timeoutMs: 5_000,
});
try {
  const consistencyToken = await authorization.writeSchema(schema);
  process.stdout.write(
    `${JSON.stringify({ migrated: true, consistencyToken: consistencyToken ?? null })}\n`,
  );
} finally {
  authorization.close();
}
