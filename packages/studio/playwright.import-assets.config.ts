import path from "node:path"

export default {
  testDir: "./test/e2e",
  testMatch: ["import-media.spec.ts", "import-asset-graph.spec.ts"],
  timeout: 120000,
  expect: { timeout: 20000 },
  workers: 1,
  reporter: "list",
  outputDir: path.resolve("../../.artifacts/studio/import-assets-e2e-results"),
}
