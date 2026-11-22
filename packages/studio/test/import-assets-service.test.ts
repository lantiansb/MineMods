import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { importProject } from "@minemods/mod-core/import-project"
import { createStudioService, publicError } from "../src/main/service"
import { dispatchExternal } from "../src/main/external-dispatch"
import { GraphAnalysisContextSchema } from "../src/main/import-asset-graph-ai"

const { zipSync, unzipSync } = createRequire(path.join(import.meta.dir, "../../mod-core/package.json"))("fflate") as {
  zipSync: (files: Record<string, Uint8Array>) => Uint8Array
  unzipSync: (archive: Uint8Array) => Record<string, Uint8Array>
}

test("资产图证据与预算错误保留可处理的中文说明", () => {
  expect(publicError(new Error("GRAPH_ANALYSIS_EVIDENCE_REFERENCE_INVALID:node_123"))).toContain("候选关系")
  expect(publicError(new Error("GRAPH_ANALYSIS_SUBGRAPH_TOO_LARGE:large"))).toContain("缩小范围")
})

test("分类资产经 MCP 选择、编辑、预览并导出为可追溯工程", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-asset-service-"))
  const workspaceDirectory = path.join(root, "workspace")
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64",
  )
  const original = zipSync({
    "overrides/kubejs/server_scripts/form.js": Buffer.from("// transformation skill\n"),
    "overrides/mods/sample.jar": zipSync({
      "assets/sample/models/block/crystal.json": Buffer.from(
        JSON.stringify({
          textures: { all: "sample:block/crystal" },
          elements: [
            {
              from: [0, 0, 0],
              to: [16, 16, 16],
              faces: Object.fromEntries(
                ["north", "south", "east", "west", "up", "down"].map((face) => [face, { texture: "#all" }]),
              ),
            },
          ],
        }),
      ),
      "assets/sample/textures/block/crystal.png": png,
    }),
  })
  const source = path.join(root, "sample.zip")
  await writeFile(source, original)
  const service = await createStudioService({
    workspaceDirectory,
    runtimeDirectory: path.join(root, "runtime"),
    templateDirectory: path.join(root, "templates"),
    ai: { mode: "mcp" },
  })
  try {
    const id = (await importProject({ workspaceDirectory, filename: source })).manifest.id
    const selection = await service.importAssets.selection({ id })
    const author = selection.groups.find((group) => group.kind === "author")!
    const mod = selection.groups.find((group) => group.kind === "mod")!
    await expect(
      dispatchExternal(service, { method: "extractImportAssets", input: { id, groupIds: [author.id] } }),
    ).resolves.toMatchObject({ assetCount: 1 })
    const script = (await service.importAssets.catalog({ id }))!.assets[0]!
    expect(script.origin).toBe("author")
    await dispatchExternal(service, {
      method: "saveImportedAssetFile",
      input: { id, assetId: script.id, expectedSha256: script.sha256, content: "// new transformation skill\n" },
    })
    await expect(
      dispatchExternal(service, {
        method: "saveImportedAssetFile",
        input: { id, assetId: script.id, expectedSha256: script.sha256, content: "// stale\n" },
      }),
    ).rejects.toThrow(/changed/)
    await service.importAssets.extract({ id, groupIds: [author.id, mod.id] })
    await expect(
      dispatchExternal(service, { method: "getImportedAssetCatalog", input: { id, query: "model", limit: 1 } }),
    ).resolves.toMatchObject({ total: 1, nextOffset: null })
    const catalog = (await service.importAssets.catalog({ id }))!
    const model = catalog.assets.find((asset) => asset.kind === "model")!
    const texture = catalog.assets.find((asset) => asset.kind === "texture")!
    const [preview, second] = await Promise.all([
      service.importAssets.preview({ id, assetId: model.id }),
      service.importAssets.preview({ id, assetId: model.id, texturePath: texture.path }),
    ])
    expect(preview.model?.bones[0]?.cubes).toHaveLength(1)
    expect(preview.preview?.textureDataUrl).toBe(`data:image/png;base64,${png.toString("base64")}`)
    expect(second.blockbench?.textures).toHaveLength(1)
    expect(preview.textures).toContain(texture.path)
    await expect(dispatchExternal(service, { method: "buildImportAssetGraph", input: { id } })).resolves.toMatchObject({
      projectId: id,
    })
    await expect(
      dispatchExternal(service, { method: "getImportAssetGraph", input: { id, kind: "model", limit: 1 } }),
    ).resolves.toMatchObject({ total: 1, nextOffset: null })
    const graph = await service.importAssets.graph({ id })
    const modelNode = graph.nodes.find((node) => node.sourceAssetId === model.id)!
    await dispatchExternal(service, { method: "startImportAssetGraphAnalysis", input: { id, nodeIds: [modelNode.id] } })
    const task = (await dispatchExternal(service, { method: "getImportAssetGraphAnalysis", input: { id } })) as {
      run: { context: unknown }
      structured_prompt: unknown
      response_schema: unknown
    }
    expect(task.structured_prompt).toBeDefined()
    expect(task.response_schema).toBeDefined()
    const context = GraphAnalysisContextSchema.parse(task.run.context)
    const evidenceId = context.evidenceRefs.find((ref) => ref.nodeIds.includes(modelNode.id))!.id
    await expect(
      dispatchExternal(service, {
        method: "submitImportAssetGraphAnalysis",
        input: {
          id,
          contextId: context.contextId,
          result: {
            schemaVersion: 1,
            projectId: id,
            contextId: context.contextId,
            catalogSha256: context.catalogSha256,
            entries: [
              {
                nodeId: modelNode.id,
                summary: "模拟模型：此模型使用目录中的贴图。",
                evidenceIds: [evidenceId],
                facts: [],
                unknowns: [],
                relatedEdgeIds: [],
              },
            ],
            unknowns: [],
          },
        },
      }),
    ).resolves.toMatchObject({ state: "review" })
    await service.importAssetGraphAnalysis.validateForExport({ id })
    const destination = path.join(root, "classified-assets.zip")
    await service.importAssets.export({ id, destination })
    const exported = unzipSync(await readFile(destination))
    expect(Buffer.from(exported[`files/${script.path}`]!).toString()).toBe("// new transformation skill\n")
    expect(exported[`models/${model.id}/model.bbmodel`]).toBeDefined()
    expect(exported["graph.json"]).toBeDefined()
    expect(JSON.parse(Buffer.from(exported["graph-analysis.json"]!).toString())).toMatchObject({ state: "review" })
    expect(JSON.parse(Buffer.from(exported[`models/${model.id}/asset.json`]!).toString())).toMatchObject({
      assetId: model.id,
      sourceSha256: catalog.sourceSha256,
      sourceAssetSha256: model.sha256,
    })
    expect(await readFile(source)).toEqual(Buffer.from(original))
    await service.importAssets.save({ id, assetId: model.id, expectedSha256: model.sha256, content: "{}" })
    await service.importAssets.export({ id, destination: path.join(root, "edited.zip") })
    const edited = unzipSync(await readFile(path.join(root, "edited.zip")))
    expect(Object.keys(edited).some((name) => name.endsWith("model.bbmodel"))).toBe(false)
    expect(service.importAssets.isBusy()).toBe(false)
  } finally {
    await service.dispose()
    if (path.resolve(path.dirname(root)) !== path.resolve(os.tmpdir())) throw new Error("Unexpected cleanup path")
    await rm(root, { recursive: true, force: true })
  }
})
