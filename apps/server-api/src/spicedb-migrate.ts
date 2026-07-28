import { loadSpiceDbMigratorConfig } from "@intero/config";
import { readFile } from "node:fs/promises";

import {
  loadSpiceDbCertificate,
  SpiceDbAuthorization,
} from "./spicedb-authorization.js";

const config = loadSpiceDbMigratorConfig();
const schema = await readFile(
  new URL("../../../infra/spicedb/schema.zed", import.meta.url),
  "utf8",
);
const certificate = await loadSpiceDbCertificate(config.caPath);
const authorization = new SpiceDbAuthorization({
  endpoint: config.endpoint,
  token: config.token,
  insecureLocalhost: config.insecure,
  ...(certificate ? { certificate } : {}),
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
