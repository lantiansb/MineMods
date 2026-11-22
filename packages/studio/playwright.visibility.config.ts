import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "studio-visibility.spec.cjs",
  outputDir: process.env.STUDIO_VISIBILITY_BASELINE
    ? "../../.artifacts/studio/visibility-before"
    : "../../.artifacts/studio/visibility-after",
  workers: 1,
  timeout: 600000,
  reporter: "list",
})
