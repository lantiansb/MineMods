import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./test/e2e",
  // The start comes first: when the window cannot be drawn nothing after it means anything.
  testMatch: ["startup.spec.ts", "obsidian.spec.ts"],
  timeout: 330000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: "list",
  outputDir: "../../.artifacts/studio/e2e-results",
})
