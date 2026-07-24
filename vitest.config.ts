import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@intero/api-contracts": `${root}packages/api-contracts/src/index.ts`,
      "@intero/config": `${root}packages/config/src/index.ts`,
      "@intero/domain": `${root}packages/domain/src/index.ts`,
      "@intero/integrations": `${root}packages/integrations/src/index.ts`,
      "@intero/project-management": `${root}packages/project-management/src/index.ts`,
      "@intero/representative-core": `${root}packages/representative-core/src/index.ts`,
      "@intero/test-support": `${root}packages/test-support/src/index.ts`,
      "@intero/ui": `${root}packages/ui/src/index.ts`,
    },
  },
  test: {
    include: ["{apps,packages}/**/*.test.ts", "{apps,packages}/**/*.test.tsx"],
    coverage: {
      reporter: ["text", "html"],
      exclude: ["**/generated/**", "**/dist/**"],
    },
  },
});
