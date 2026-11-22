import { defineConfig } from "@playwright/test"
export default defineConfig({ testDir: "./test/e2e", testMatch: "ui-p3.spec.ts", timeout: 420000, expect: { timeout: 20000 }, workers: 1, reporter: "list", outputDir: "../../.artifacts/studio/p3-results", use: { trace: "retain-on-failure", screenshot: "only-on-failure" } })
