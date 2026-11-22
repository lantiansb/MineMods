import { defineConfig } from "@playwright/test"
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "entity-runtime.spec.ts",
  timeout: 600000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: "list",
  outputDir: "../../.artifacts/studio/entity-runtime-results",
  use: { trace: "retain-on-failure" },
})
