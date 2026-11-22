import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { createStudioService } from "../src/main/service"
import { ImportAnalysisContextSchema } from "../src/main/import-ai"
import { applyImportChanges } from "@minemods/mod-core/import-edit"

const { strToU8, unzipSync, zipSync } = createRequire(path.join(import.meta.dir, "../../mod-core/package.json"))(
  "fflate",
) as {
  strToU8: (value: string) => Uint8Array
  unzipSync: (archive: Uint8Array) => Record<string, Uint8Array>
  zipSync: (files: Record<string, Uint8Array>) => Uint8Array
}
const roots: string[] = []
const services: Array<Awaited<ReturnType<typeof createStudioService>>> = []

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createService(root: string) {
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
  return service
}

async function scanJar(service: Awaited<ReturnType<typeof createStudioService>>, filename: string) {
  const task = service.library.startImportSource(filename)
  const deadline = Date.now() + 10_000
  let current = service.library.getLibraryTask(task.id)
  while (["running", "canceling"].includes(current.state) && Date.now() < deadline) {
    await Bun.sleep(20)
    current = service.library.getLibraryTask(task.id)
  }
  expect(current.state, current.error ?? current.detail).toBe("completed")
  expect(current.resultId).toBeTruthy()
  return current.resultId!
}

function plan(contextValue: unknown, pathName: string, fileContents: string) {
  const context = ImportAnalysisContextSchema.parse(contextValue)
  const evidence = context.evidence.find((item) => item.path === "config/settings.json")
  expect(evidence).toBeTruthy()
  return {
    schema_version: 1,
    analysis: {
      schema_version: 1,
      summary: "根据导入包配置证据提出一项可审阅的文本资源变更。",
      gameplay: [],
      extension_points: [],
      unknowns: [],
      needed_paths: [],
      requirements: [],
    },
    changeset: {
      schema_version: 1,
      id: crypto.randomUUID(),
      project_id: context.projectId,
      source_sha256: context.sourceSha256,
      summary: "新增 JSON 配置，不改动原有文件。",
      changes: [{ path: pathName, operation: "write", expected_sha256: null, content: fileContents }],
      warnings: ["该变更尚未构建或进入游戏验证。"],
    },
    evidence_map: [
      {
        path: pathName,
        evidence_ids: [evidence!.id],
        rationale: "依据已扫描的配置文件说明新增配置意图；具体技术建议与源文件事实分开表述。",
      },
    ],
    validation_plan: [],
    limitations: ["尚未执行构建或游戏内验证。"],
  }
}

test("MCP import analysis run persists through apply, export, restart, cancellation, and stale revision rejection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-import-analysis-service-"))
  roots.push(root)
  const sourcePath = path.join(root, "source.jar")
  await Bun.write(
    sourcePath,
    zipSync({
      "fabric.mod.json": strToU8(
        JSON.stringify({ schemaVersion: 1, id: "service_fixture", version: "1.0.0", name: "Service Fixture" }),
      ),
      "config/settings.json": strToU8('{"enabled":true}\n'),
    }),
  )

  let service = await createService(root)
  const id = await scanJar(service, sourcePath)
  const first = await service.importAnalysis.start({ id, prompt: "新增一个 JSON 设置文件", external: true })
  const stale = await service.importAnalysis.start({ id, prompt: "新增另一份 JSON 设置", external: true })
  const firstTask = await service.importAnalysis.task({ id, runId: first.id })
  expect(firstTask.run.kind).toBe("modify")
  expect(firstTask.instructions).toContain("不支持 .class")
  await service.importAnalysis.submit(
    id,
    first.id,
    plan(firstTask.context, "config/new-setting.json", '{"enabled":true}\n'),
  )
  const staleTask = await service.importAnalysis.task({ id, runId: stale.id })
  await service.importAnalysis.submit(
    id,
    stale.id,
    plan(staleTask.context, "config/another-setting.json", '{"mode":"safe"}\n'),
  )
  // Simulate a process exit after the immutable revision committed but before the run record was saved.
  const committed = await applyImportChanges({
    workspaceDirectory: path.join(root, "projects"),
    id,
    changeset: (await service.importAnalysis.get(id, first.id)).plan!.changeset,
    parentRevisionId: firstTask.context.revisionId,
  })
  await service.dispose()
  service = await createService(root)
  expect((await service.importAnalysis.get(id, first.id)).state).toBe("review")
  const applied = await service.importAnalysis.apply(id, first.id)
  expect(applied.state).toBe("applied")
  expect(applied.revisionId).toBe(committed.revisionId)
  await expect(service.importAnalysis.apply(id, stale.id)).rejects.toThrow("Import revision changed")

  const canceled = await service.importAnalysis.start({ id, external: true })
  expect((await service.importAnalysis.cancel(id, canceled.id)).state).toBe("canceled")
  await expect(
    service.importAnalysis.submit(id, canceled.id, {
      schema_version: 1,
      summary: "不应接受已取消任务的提交。",
      gameplay: [],
      extension_points: [],
      unknowns: [],
      needed_paths: [],
      requirements: [],
    }),
  ).rejects.toThrow("已结束或已取消")
  await expect(
    service.importAnalysis.task({ id, runId: canceled.id, paths: ["config/settings.json"] }),
  ).rejects.toThrow("此任务已经结束")

  await service.dispose()
  service = await createService(root)
  expect((await service.importAnalysis.get(id, first.id)).state).toBe("applied")
  expect((await service.importAnalysis.list(id)).map((run) => run.id)).toEqual(
    expect.arrayContaining([first.id, stale.id, canceled.id]),
  )
  const destination = path.join(root, "exported.jar")
  const exported = await service.importAnalysis.export({ id, runId: first.id, destination, kind: "archive" })
  expect(exported.path).toBe(destination)
  const entries = unzipSync(await Bun.file(destination).bytes())
  expect(new TextDecoder().decode(entries["config/new-setting.json"])).toBe('{"enabled":true}\n')
  expect(entries["config/another-setting.json"]).toBeUndefined()
  expect(await Bun.file(sourcePath).exists()).toBe(true)
})
