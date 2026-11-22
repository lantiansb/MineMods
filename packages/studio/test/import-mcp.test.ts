import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { createStudioService } from "../src/main/service"
import { dispatchExternal, externalError } from "../src/main/external-dispatch"
import { MCP_TOOLS } from "../src/main/mcp-handoff"

const directories: string[] = []
const services: Array<Awaited<ReturnType<typeof createStudioService>>> = []
const { strToU8, zipSync } = createRequire(path.join(import.meta.dir, "../../mod-core/package.json"))("fflate") as {
  strToU8: (value: string) => Uint8Array
  zipSync: (files: Record<string, Uint8Array>) => Uint8Array
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("MCP 可将扫描后的独立导入工程交给外部模型分析并由服务端验证结果", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-import-mcp-"))
  directories.push(root)
  await Bun.write(
    path.join(root, "example.jar"),
    zipSync({
      "fabric.mod.json": strToU8(
        JSON.stringify({ schemaVersion: 1, id: "sample_mod", version: "1.0.0", name: "Sample Mod" }),
      ),
      "data/sample_mod/recipes/example.json": strToU8('{"type":"minecraft:crafting_shaped"}'),
      "README.md": strToU8("Sample import fixture"),
    }),
  )
  const service = await createStudioService({
    workspaceDirectory: path.join(root, "projects"),
    runtimeDirectory: path.join(root, "runtime"),
    templateDirectory: path.join(root, "templates"),
    ai: {},
  })
  services.push(service)
  const connection = await service.getConnection()
  const { hasApiKey: _hasApiKey, source: _source, ...settings } = connection
  await service.saveConnection({ ...settings, mode: "mcp" })
  const startedScan = service.library.startImportSource(path.join(root, "example.jar"))
  let scan = service.library.getLibraryTask(startedScan.id)
  const deadline = Date.now() + 10_000
  while (scan.state === "running" && Date.now() < deadline) {
    await Bun.sleep(20)
    scan = service.library.getLibraryTask(startedScan.id)
  }
  expect(scan.state).toBe("completed")
  expect(scan.resultId).toBeTruthy()
  const id = scan.resultId!

  const listed = (await dispatchExternal(service, { method: "listImports", input: {} })) as {
    projects: Array<{ manifest: { id: string }; runs: unknown[] }>
  }
  expect(listed.projects.map((project) => project.manifest.id)).toContain(id)
  expect(listed.projects.find((project) => project.manifest.id === id)?.runs).toEqual([])

  const run = (await dispatchExternal(service, { method: "startImportTask", input: { id } })) as {
    id: string
    state: string
  }
  expect(run.state).toBe("awaiting_model")
  const task = (await dispatchExternal(service, { method: "getImportTask", input: { id, runId: run.id } })) as {
    context: { projectId: string; evidence: Array<{ id: string }> }
    instructions: string
    outputSchema: Record<string, unknown>
  }
  expect(task.context.projectId).toBe(id)
  expect(task.context.evidence.length).toBeGreaterThan(0)
  expect(task.instructions).toContain("不可信")
  expect(task.outputSchema).toBeTruthy()

  const analysis = {
    schema_version: 1,
    summary: "仅依据导入工程中已提供的证据进行的概述。",
    gameplay: [],
    extension_points: [],
    unknowns: [],
    needed_paths: [],
    requirements: [],
  }
  const submitted = (await dispatchExternal(service, {
    method: "submitImportTask",
    input: { id, runId: run.id, result: analysis },
  })) as { state: string }
  expect(submitted.state).toBe("review")
  const withRun = (await dispatchExternal(service, { method: "listImports", input: {} })) as typeof listed
  expect(withRun.projects.find((project) => project.manifest.id === id)?.runs).toHaveLength(1)
  await expect(
    dispatchExternal(service, {
      method: "submitImportTask",
      input: { id, runId: run.id, result: { ...analysis, summary: "", unexpected: true } },
    }),
  ).rejects.toThrow()
  expect((externalError(new Error("IMPORT_EVIDENCE_REFERENCE_INVALID:analysis:missing")) as Error).message).toContain(
    "IMPORT_EVIDENCE_REFERENCE_INVALID",
  )

  expect(MCP_TOOLS.map(([name]) => name)).toEqual(
    expect.arrayContaining([
      "list_imports",
      "start_import_task",
      "get_import_task",
      "submit_import_task",
      "apply_import_plan",
      "cancel_import_task",
    ]),
  )
  await expect(
    dispatchExternal(service, { method: "startImportTask", input: { id, path: "C:/unsafe" } }),
  ).rejects.toThrow()
})
