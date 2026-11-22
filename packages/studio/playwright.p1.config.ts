import { defineConfig } from "@playwright/test"
export default defineConfig({ testDir: "./test/e2e", testMatch: "making-p1.spec.ts", timeout: 480000, expect: { timeout: 20000 }, workers: 1, reporter: "list", outputDir: "../../.artifacts/studio/p1-results", use: { trace: "retain-on-failure", screenshot: "only-on-failure" } })
