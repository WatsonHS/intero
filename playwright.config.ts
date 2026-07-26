import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.INTERO_E2E_RENDERER_URL ?? "http://127.0.0.1:5183",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    channel: "chrome",
  },
  outputDir: "output/playwright/phase6/test-results",
});
