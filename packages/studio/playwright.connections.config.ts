import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "connections-themes.spec.ts",
  timeout: 180000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: "list",
  outputDir: "../../.artifacts/studio/connections-e2e-results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
})
