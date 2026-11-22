import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: ["import-storage.spec.ts", "import-modification.spec.ts"],
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: "list",
  outputDir: "../../.artifacts/studio/storage-results",
  use: { trace: "retain-on-failure" },
})
