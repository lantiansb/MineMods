import { afterEach, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { loadImportedModel } from "../src/imported-model"
import { MODEL_EXPORT, ModelExportRefusal, exportProjectModel, modelExportFolder } from "../src/model-export"
import { createEntity, openProject, saveProject, type Project } from "../src/project"
import { creatureName } from "../src/registry-name"
import { createDataGameplaySample } from "../script/data-gameplay-sample"

/**
 * r29b: `export_model`. A creature's geometry, motions and picture as the jar has them, written into a folder of the project; a model no creature wears yet,
 * as it is drawn; anything else refused in plain words. The geometry written is read back by the import's own reader.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
async function sample() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-export-"))
  roots.push(root)
  const directory = path.join(root, "矿洞")
  const project = await createDataGameplaySample(directory, { life: true })
  return { root, directory, project }
}
const refusal = (promise: Promise<unknown>) => promise.then(() => "", (error: unknown) => (error instanceof ModelExportRefusal ? error.message : `not a refusal: ${String(error)}`))

test("a creature's files are the jar's own, under its registry name, and the geometry is read back by the import's reader", async () => {
  const { root, directory, project } = await sample()
  const golem = project.entities[0]!
  const name = creatureName(golem)
  const setting = project.workspace.assets.find((asset) => asset.document.kind === "entity")!
  const exported = await exportProjectModel(directory, setting.id)
  expect(exported.folder).toBe(MODEL_EXPORT.folder)
  expect(exported.files.slice(0, 3)).toEqual([`${MODEL_EXPORT.folder}/${name}.geo.json`, `${MODEL_EXPORT.folder}/${name}.animation.json`, `${MODEL_EXPORT.folder}/${name}.png`])
  // By the creature's id or its model's, the same files.
  expect((await exportProjectModel(directory, golem.id, "导出/傀儡")).files[0]).toBe(`导出/傀儡/${name}.geo.json`)
  const out = path.join(root, "source")
  await mkdir(out)
  await assembleBuildSource(directory, out, TEMPLATE)
  const assets = path.join(out, "src/main/resources/assets", project.mod_id)
  for (const [file, built] of [[`${name}.geo.json`, `geo/${name}.geo.json`], [`${name}.animation.json`, `animations/${name}.animation.json`], [`${name}.png`, `textures/entity/${name}.png`]] as const)
    expect(Buffer.compare(await readFile(path.join(directory, MODEL_EXPORT.folder, file)), await readFile(path.join(assets, built)))).toBe(0)
  const read = await loadImportedModel({ entryPath: `${name}.geo.json`, paths: exported.files.map((file) => path.basename(file)), texturePath: `${name}.png`, readFile: (file) => readFile(path.join(directory, MODEL_EXPORT.folder, file)) })
  const drawn = (await openProject(directory)).workspace.assets.find((asset) => asset.id === golem.id)!.document as { bones: { name: string }[] }
  expect(read.model?.bones.map((bone) => bone.name)).toEqual(drawn.bones.map((bone) => bone.name))
  expect(read.preview?.textureDataUrl.startsWith("data:image/png")).toBe(true)
  const motions = JSON.parse(await readFile(path.join(directory, MODEL_EXPORT.folder, `${name}.animation.json`), "utf8"))
  expect(Object.keys(motions.animations).every((key) => key.startsWith(`animation.${name}.`))).toBe(true)
}, 240000)

test("a model no creature wears is exported as drawn; what is no model, not made, or not there is refused in plain words; nothing leaves the project", async () => {
  const { directory, project } = await sample()
  const model = project.workspace.assets.find((asset) => asset.document.kind === "model")!
  const loose = { ...model, id: randomUUID(), title: "空模型" }
  const drafted = { ...model, id: randomUUID(), title: "草稿模型", status: "design" as const }
  const bare = { ...createEntity({ name: "没模型的", health: 10, speed: 0.2, attack_damage: 0, behavior: "passive" }) }
  await saveProject(directory, { ...project, entities: [...project.entities, bare], workspace: { assets: [...project.workspace.assets, loose, drafted] } } as Project, project.revision)
  const exported = await exportProjectModel(directory, loose.id)
  expect(exported.name).toBe(`model_${loose.id.replaceAll("-", "")}`)
  expect((await readdir(path.join(directory, MODEL_EXPORT.folder))).sort()).toEqual([`${exported.name}.animation.json`, `${exported.name}.geo.json`, `${exported.name}.png`, `${exported.name}_glowmask.png`])
  expect(await refusal(exportProjectModel(directory, drafted.id))).toBe("模型「草稿模型」还没做好（还没通过检查存成正式的），现在导出的不会是游戏里的样子。等它做好再导出。")
  expect(await refusal(exportProjectModel(directory, bare.id))).toBe("「没模型的」还没有模型，没有可以导出的。先给它做好模型再导出。")
  const item = project.workspace.assets.find((asset) => asset.module === "item")!
  expect(await refusal(exportProjectModel(directory, item.id))).toContain(`「${item.title}」是物品，不是模型。`)
  const missing = randomUUID()
  expect(await refusal(exportProjectModel(directory, missing))).toContain(`这个工程里没有编号是 ${missing} 的东西`)
  for (const folder of ["../外面", "C:/Users", "/abs", ".minemods/assets", "generated", "a/../../b", "a:b"]) expect(() => modelExportFolder(folder)).toThrow("folder 要写工程文件夹里的一个子文件夹")
  expect(modelExportFolder("exports\\boss")).toEqual(["exports", "boss"])
}, 240000)
