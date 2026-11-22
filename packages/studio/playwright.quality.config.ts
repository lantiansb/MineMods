import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "model-quality.spec.ts",
  timeout: 180000,
  expect: { timeout: 20000 },
  workers: 1,
  reporter: "list",
  outputDir: "../../.artifacts/studio/model-quality-results",
  use: { trace: "retain-on-failure" },
})
