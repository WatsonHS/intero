import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const usesSharedIntegrationServices = Boolean(
  process.env.DATABASE_URL ||
  process.env.INTERO_SPICEDB_ENDPOINT ||
  process.env.INTERO_OBJECT_STORAGE_ENDPOINT,
);

export default defineConfig({
  resolve: {
    alias: {
      "@intero/api-contracts": `${root}packages/api-contracts/src/index.ts`,
      "@intero/config": `${root}packages/config/src/index.ts`,
      "@intero/domain": `${root}packages/domain/src/index.ts`,
      "@intero/integrations": `${root}packages/integrations/src/index.ts`,
      "@intero/project-management": `${root}packages/project-management/src/index.ts`,
      "@intero/stand-in-core": `${root}packages/stand-in-core/src/index.ts`,
      "@intero/test-support": `${root}packages/test-support/src/index.ts`,
      "@intero/ui": `${root}packages/ui/src/index.ts`,
    },
  },
  test: {
    include: ["{apps,packages}/**/*.test.ts", "{apps,packages}/**/*.test.tsx"],
    // Real integration suites share one explicitly disposable PostgreSQL,
    // SpiceDB, and MinIO environment. Keep files ordered in that mode so a
    // schema migration/reset cannot race another contract assertion. Fast,
    // dependency-free unit runs remain parallel.
    fileParallelism: !usesSharedIntegrationServices,
    coverage: {
      reporter: ["text", "html"],
      exclude: ["**/generated/**", "**/dist/**"],
    },
  },
});
