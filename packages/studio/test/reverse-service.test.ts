import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { createStudioService } from "../src/main/service"
import { dispatchExternal } from "../src/main/external-dispatch"
import { ReversePlanSchema } from "../src/main/reverse-service"

const { zipSync, unzipSync } = createRequire(path.join(import.meta.dir, "../../mod-core/package.json"))("fflate") as {
  zipSync: (files: Record<string, Uint8Array>) => Uint8Array
  unzipSync: (archive: Uint8Array) => Record<string, Uint8Array>
}
const roots: string[] = []
const services: Awaited<ReturnType<typeof createStudioService>>[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

test("通用逆向服务贯通资源还原、结构化MCP修改、二进制编辑、归档导出和工程恢复", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-reverse-"))
  roots.push(root)
  const original = zipSync({
    "pack.mcmeta": Buffer.from('{"pack":{"pack_format":15,"description":"arbitrary fixture"}}'),
    "data/any_namespace/settings.json": Buffer.from('{"cooldown":20}'),
    "assets/any_namespace/textures/arbitrary.bin": Uint8Array.from([0, 255, 0, 240]),
  })
  const source = path.join(root, "arbitrary-pack.zip")
  await Bun.write(source, original)
  const service = await createStudioService({
    workspaceDirectory: path.join(root, "workspace"),
    runtimeDirectory: path.join(root, "runtime"),
    templateDirectory: path.join(root, "templates"),
    ai: { mode: "mcp" },
  })
  services.push(service)
  const scan = service.library.startImportSource(source)
  while (service.library.getLibraryTask(scan.id).state === "running") await Bun.sleep(20)
  const imported = service.library.getLibraryTask(scan.id)
  expect(imported.state, imported.error ?? "").toBe("completed")
  const id = imported.resultId!
  expect((await service.reverseService.state(id)).project).toBeNull()
  const preparing = await service.reverseService.prepare({ id })
  await expect(service.reverseService.prepare({ id })).rejects.toThrow()
  const deadline = Date.now() + 15000
  while (
    (await service.reverseService.state(id)).operations.find((operation) => operation.id === preparing.id)?.state ===
      "running" &&
    Date.now() < deadline
  )
    await Bun.sleep(20)
  const ready = await service.reverseService.state(id)
  expect(ready.operations[0]?.state, ready.operations[0]?.error ?? "").toBe("completed")
  expect(ready.project?.source.sha256).toBe(hash(original))
  const files = await service.reverseService.files({ id })
  const settingsPath = files.find((file) => file.path.endsWith("data/any_namespace/settings.json"))!.path
  const imagePath = files.find((file) => file.path.endsWith("textures/arbitrary.bin"))!.path
  const run = await service.reverseService.startModel({
    id,
    prompt: "将当前配置冷却修改为 45，并保留所有其他资源",
    external: true,
  })
  const task = await service.reverseService.task({ id, runId: run.id, paths: [settingsPath] })
  expect(task.instructions).toContain("不限模组名称")
  expect(task.outputSchema).toBeTruthy()
  const evidence = task.context.evidence.find((file) => file.path === settingsPath)!
  const result = ReversePlanSchema.parse({
    schemaVersion: 1,
    sourceSha256: task.context.project.source.sha256,
    summary: "根据已有配置修改冷却",
    findings: [{ text: "配置声明了冷却", evidencePaths: [settingsPath] }],
    neededPaths: [],
    changes: [
      {
        path: settingsPath,
        operation: "write",
        expectedSha256: evidence.sha256,
        encoding: "utf8",
        content: '{"cooldown":45}',
      },
    ],
    limitations: ["尚未进入游戏"],
    validationPlan: ["检查导出归档中的配置与二进制资源"],
  })
  await expect(service.reverseService.submit(id, run.id, { ...result, sourceSha256: "0".repeat(64) })).rejects.toThrow()
  await expect(
    service.reverseService.submit(id, run.id, {
      ...result,
      findings: [{ text: "虚构证据", evidencePaths: ["missing.java"] }],
    }),
  ).rejects.toThrow()
  await expect(service.reverseService.submit(id, run.id, { ...result, verified: true })).rejects.toThrow()
  await dispatchExternal(service, { method: "submitReverseTask", input: { id, runId: run.id, result } })
  expect((await service.reverseService.apply(id, run.id)).state).toBe("applied")
  const image = await service.reverseService.read({ id, path: imagePath })
  expect(image.encoding).toBe("base64")
  await service.reverseService.edit({
    id,
    changes: [
      {
        path: imagePath,
        operation: "write",
        expectedSha256: image.sha256,
        encoding: "base64",
        content: Buffer.from([0, 255, 88, 240]).toString("base64"),
      },
    ],
  })
  await expect(
    service.reverseService.edit({
      id,
      changes: [
        { path: imagePath, operation: "delete", expectedSha256: image.sha256, encoding: "base64", content: null },
      ],
    }),
  ).rejects.toThrow()
  await expect(service.reverseService.read({ id, path: "../manifest.json" })).rejects.toThrow()
  const exported = path.join(root, "result.zip")
  await service.reverseService.export({ id, destination: exported, kind: "archive" })
  const entries = unzipSync(new Uint8Array(await Bun.file(exported).arrayBuffer()))
  expect(Buffer.from(entries["data/any_namespace/settings.json"]!).toString()).toBe('{"cooldown":45}')
  expect(entries["assets/any_namespace/textures/arbitrary.bin"]).toEqual(Uint8Array.from([0, 255, 88, 240]))
  expect(hash(new Uint8Array(await Bun.file(source).arrayBuffer()))).toBe(hash(original))
  const bundle = path.join(root, "shared.modreverse")
  await service.reverseService.export({ id, destination: bundle, kind: "project" })
  const restore = service.library.startImportSource(bundle)
  while (service.library.getLibraryTask(restore.id).state === "running") await Bun.sleep(20)
  const restored = service.library.getLibraryTask(restore.id)
  expect(restored.state, restored.error ?? "").toBe("completed")
  expect(restored.resultId).not.toBe(id)
  const restoredState = await service.reverseService.state(restored.resultId!)
  expect(restoredState.project?.source.sha256).toBe(hash(original))
  const again = path.join(root, "restored.zip")
  await service.reverseService.export({ id: restored.resultId!, destination: again, kind: "archive" })
  const restoredEntries = unzipSync(new Uint8Array(await Bun.file(again).arrayBuffer()))
  expect(restoredEntries["data/any_namespace/settings.json"]).toEqual(entries["data/any_namespace/settings.json"])
}, 30000)
