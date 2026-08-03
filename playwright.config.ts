import { defineConfig } from "@playwright/test";

const privacySafeG7 = process.env.INTERO_G7_PRIVACY_SAFE === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.INTERO_E2E_RENDERER_URL ?? "http://127.0.0.1:5183",
    screenshot: privacySafeG7 ? "off" : "only-on-failure",
    trace: privacySafeG7 ? "off" : "retain-on-failure",
    channel: "chrome",
  },
  outputDir:
    process.env.INTERO_PLAYWRIGHT_OUTPUT_DIR ??
    "output/playwright/phase6/test-results",
});
