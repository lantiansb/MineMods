import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "weapon-authoring.spec.ts",
  timeout: 300000,
  expect: { timeout: 20000 },
  workers: 1,
  reporter: "list",
  outputDir: "../../.artifacts/studio/weapon-authoring-results",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
})
