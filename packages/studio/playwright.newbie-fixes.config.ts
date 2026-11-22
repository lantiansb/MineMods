import { defineConfig } from "@playwright/test"
export default defineConfig({ testDir: "./test/e2e", testMatch: "ui-newbie-fixes.spec.ts", timeout: 180000, expect: { timeout: 20000 }, workers: 1, reporter: "list", outputDir: "../../.artifacts/studio/newbie-fixes-results", use: { trace: "retain-on-failure", screenshot: "only-on-failure" } })
