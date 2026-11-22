import { test, expect } from "@playwright/test"
import { execFile } from "node:child_process"
import path from "node:path"

test("Project conception and model core acceptance", async () => {
  test.setTimeout(500000)
  const root = path.resolve("../..")
  const env = { ...process.env, STUDIO_PACKAGED_EXECUTABLE: process.env.STUDIO_PACKAGED_EXECUTABLE ?? "" }
  const run = (name: string) => new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = execFile(process.execPath, [path.join(root, "packages/studio/test/e2e", name)], { cwd: root, env, timeout: 150000, windowsHide: true }, (error, stdout, stderr) => resolve({ code: error?.code ? Number(error.code) : error ? 1 : 0, output: `${stdout}\n${stderr}` }))
    child.stdout?.on("data", (chunk) => process.stdout.write(chunk))
    child.stderr?.on("data", (chunk) => process.stderr.write(chunk))
  })
  for (const helper of ["project-workflow.cjs", "model-core-preview.cjs", "model-stream-preview.cjs"]) {
    const result = await run(helper)
    expect(result.code, `${helper}\n${result.output}`).toBe(0)
  }
})
