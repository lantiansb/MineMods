import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: ["reverse-project.spec.ts", "import-assets.spec.ts"],
  timeout: 90000,
  expect: { timeout: 20000 },
  workers: 1,
  reporter: "list",
  outputDir: "../../.artifacts/studio/reverse-results",
  use: { trace: "retain-on-failure" },
})
