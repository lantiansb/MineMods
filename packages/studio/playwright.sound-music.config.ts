import { defineConfig } from "@playwright/test"
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "sound-music.spec.cjs",
  workers: 1,
  timeout: 600000,
  reporter: "list",
  outputDir: "../../.artifacts/studio/sound-music",
})
