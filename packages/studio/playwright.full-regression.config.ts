import { defineConfig } from "@playwright/test"
export default defineConfig({ testDir: "./test/e2e", testMatch: "**/*.spec.ts", timeout: 600000, expect: {timeout: 20000}, workers: 1, reporter: [["list"], ["json", {outputFile: process.env.E2E_RESULTS || "full-results.json"}]], outputDir: process.env.E2E_OUTPUT || "../../.artifacts/studio/full-suite-results", use: {trace: "retain-on-failure"} })
