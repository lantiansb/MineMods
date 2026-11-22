import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "glass-acceptance.spec.ts",
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: "list",
  outputDir: "../../.artifacts/studio/glass-results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
})
