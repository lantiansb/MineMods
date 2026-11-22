import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { designToBlockbench } from "@minemods/mod-core/blockbench"
import { loadModelAsset } from "@minemods/mod-core/assets"
import { mushroomCowDesign } from "@minemods/mod-core/example"
import { createStudioService, publicError } from "../src/main/service"
import { modelImportFailure } from "../src/main/model-import-words"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function openExample() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-bbmodel-"))
  directories.push(directory)
  const service = await createStudioService({
    workspaceDirectory: path.join(directory, "projects"),
    runtimeDirectory: path.join(directory, "runtime"),
    templateDirectory: path.join(directory, "templates"),
    ai: {},
  })
  const created = await service.createProject({ name: "蘑菇牛", description: "" })
  const example = await service.useExample({ projectId: created.project.id, expectedRevision: created.project.revision })
  return { service, example, entityId: example.project.entities[0]!.id }
}

test("the bundled example, exported as a .bbmodel, imports back into Studio", async () => {
  const { service, example, entityId } = await openExample()
  // What the model workspace's export button writes is what its import button reads: the example repeats box names across bones.
  const snapshot = await service.loadBlockbench({ projectId: example.project.id, entityId })
  const imported = await service.saveBlockbench({ projectId: example.project.id, expectedRevision: example.project.revision, entityId, snapshot: JSON.parse(JSON.stringify(snapshot)) })
  expect(imported.model_origin).toBe("manual")
  const saved = await loadModelAsset(imported.directory, imported.project.entities[0]!.model_asset_id!)
  const design = (saved.data as { design: typeof mushroomCowDesign }).design
  expect(design.bones.map((bone) => [bone.name, bone.parent, bone.cubes.map((cube) => cube.name)])).toEqual(
    mushroomCowDesign.bones.map((bone) => [bone.name, bone.parent, bone.cubes.map((cube) => cube.name)]),
  )
})

test("a file Studio cannot take in is refused with a sentence that names what is wrong, and the saved model stays", async () => {
  const { service, example, entityId } = await openExample()
  const before = example.project.entities[0]!.model_asset_id
  const twoRoots = designToBlockbench(mushroomCowDesign) as Record<string, unknown>
  ;(twoRoots.outliner as unknown[]).push({ uuid: "second-root", name: "spare", origin: [0, 0, 0], rotation: [0, 0, 0], children: [] })
  const error = await service.saveBlockbench({ projectId: example.project.id, expectedRevision: example.project.revision, entityId, snapshot: twoRoots }).catch((cause: unknown) => cause)
  const words = publicError(error)
  expect(words).toContain("最外层有 2 个组（「body」、「spare」）")
  expect(words).not.toContain("操作未完成")
  expect((await service.openProject(example.project.id)).project.entities[0]!.model_asset_id).toBe(before)

  const fraction = designToBlockbench(mushroomCowDesign) as { elements: { to: number[] }[] }
  fraction.elements[0]!.to[0] = fraction.elements[0]!.to[0]! + 0.5
  const fractional = await service.saveBlockbench({ projectId: example.project.id, expectedRevision: example.project.revision, entityId, snapshot: fraction as never }).catch((cause: unknown) => cause)
  expect(publicError(fractional)).toContain("只能是 1 到 256 之间的整数")
})

test("a saved design that no longer matches its file says which bone, and a detail after a code is taken off so the code's own sentence is found", () => {
  const mismatch = modelImportFailure(new Error("MODEL_HIERARCHY_DESIGN_MISMATCH:parent:leg"))
  expect(mismatch).toEqual({ words: expect.stringContaining("骨骼「leg」挂在哪一根骨骼下面") })
  expect(modelImportFailure(new Error("MODEL_MULTI_TEXTURE:不支持多贴图"))).toEqual({ code: "MODEL_MULTI_TEXTURE" })
  expect(modelImportFailure(new Error("EEXIST"))).toBeNull()
})
