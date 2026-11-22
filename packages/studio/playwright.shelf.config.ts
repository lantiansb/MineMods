import { defineConfig } from "@playwright/test"
export default defineConfig({ testDir: "./test/e2e", testMatch: "shelf-presence.spec.ts", timeout: 180000, expect: { timeout: 15000 }, workers: 1, reporter: "list", outputDir: "../../.artifacts/studio/shelf-results", use: { trace: "retain-on-failure", screenshot: "only-on-failure" } })
