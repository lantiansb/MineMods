import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: ["project-import.spec.ts"],
  timeout: 240000,
  expect: { timeout: 20000 },
  workers: 1,
  reporter: "list",
  outputDir: "../../.artifacts/studio/project-import-results",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
})
