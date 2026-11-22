import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { exportProjectArchive, importProjectArchive, inspectProjectArchive } from "../src/container"
import { BlockSchema } from "../src/content"
import { mushroomCowDesign } from "../src/example"
import { createEntity, createProject, openProject, saveProject } from "../src/project"
import { loadModelAsset, putModelAsset, putModelAssetUnlocked } from "../src/assets"
import { persistWorkspaceModel } from "../src/workspace-model"
import { MODULES, ModuleDocumentSchema, WorkspaceAssetSchema, WorkspaceSchema, applyWorkspaceAsset, compileWorkspaceTexture } from "../src/workspace"
import { designToBlockbench } from "../src/blockbench"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"

const directories: string[] = []
const uuid = () => crypto.randomUUID()
const timestamp = () => new Date().toISOString()
const asset = (document: Record<string, unknown>, module: string, overrides: Record<string, unknown> = {}) => WorkspaceAssetSchema.parse({
  id: uuid(), module, title: String(document.name ?? document.title ?? module), revision: 1, created_at: timestamp(), updated_at: timestamp(),
  prompt: `设计 ${module}`, dependencies: [], document, provenance: { model: null, request_id: null }, status: "design", ...overrides,
})

async function directory() {
  const value = await mkdtemp(path.join(os.tmpdir(), "minemods-workspace-"))
  directories.push(value)
  return value
}

afterEach(async () => Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true }))))

test("module registry is fixed and documents reject unknown or unstructured modules", () => {
  // The twelve original kinds, in their saved order, plus gesture, gameplay, effect, sound, music, particle, the boss bar, the arena fixture, the ability asset and the book.
  expect(Object.keys(MODULES)).toEqual(["model", "texture", "animation", "entity", "block", "item", "recipe", "logic", "worldview", "biome", "dimension", "terrain", "gesture", "gameplay", "effect", "sound", "music", "particle", "bossbar", "fixture", "ability", "book"])
  expect(ModuleDocumentSchema.safeParse({ kind: "unknown", text: "free form" }).success).toBe(false)
  expect(WorkspaceAssetSchema.safeParse({ module: "unknown" }).success).toBe(false)
  expect(WorkspaceAssetSchema.safeParse({ ...asset({ kind: "worldview", title: "世界", summary: "摘要", entries: [] }, "worldview"), prompt: "x".repeat(20001) }).success).toBe(false)
  const texture = asset({ kind: "texture", width: 2, height: 1, palette: ["#112233", "#aabbcc"], pixels: [0, 1] }, "texture")
  expect(compileWorkspaceTexture(texture)[0]).toBe(0x89)
  const validAnimation = asset({ kind: "animation", name: "idle", length: 1, loop: true, channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] }, "animation")
  expect(WorkspaceAssetSchema.safeParse({ ...validAnimation, document: { ...validAnimation.document, channels: [{ bone: "root", keyframes: [{ time: 0.8, rotation: [0, 0, 0] }, { time: 0.4, rotation: [0, 0, 0] }] }, { bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] } }).success).toBe(false)
})

test("workspace validates duplicate and missing cross references", () => {
  const first = asset({ kind: "worldview", title: "世界", summary: "摘要", entries: [] }, "worldview")
  expect(WorkspaceSchema.safeParse({ assets: [{ ...first, dependencies: [uuid()] }] }).success).toBe(false)
  expect(WorkspaceSchema.safeParse({ assets: [first, first] }).success).toBe(false)
  expect(WorkspaceSchema.safeParse({ assets: [{ ...first, dependencies: [first.id] }] }).success).toBe(false)
  const second = asset({ kind: "worldview", title: "第二", summary: "摘要", entries: [] }, "worldview", { dependencies: [first.id] })
  expect(WorkspaceSchema.safeParse({ assets: [{ ...first, dependencies: [second.id] }, second] }).success).toBe(false)
})

test("new projects persist an empty workspace and old manifests receive the default", async () => {
  const root = await directory()
  const project = await createProject({ directory: root, name: "工作区" })
  expect(project.workspace.assets).toEqual([])
  const legacy = JSON.parse(await readFile(path.join(root, "minemods.project.json"), "utf8")) as Record<string, unknown>
  delete legacy.workspace
  await writeFile(path.join(root, "minemods.project.json"), JSON.stringify(legacy))
  expect((await openProject(root)).workspace.assets).toEqual([])
})

test("runtime content assets are applied with strict content and reference validation", async () => {
  const root = await directory()
  const project = await createProject({ directory: root, name: "运行时内容", mod_id: "runtime_content" })
  const block = asset({ kind: "block", identifier: "moon_block", name: "月块", hardness: 1, luminance: 0, tool: "pickaxe", drop: "self", color: "#335577", texture: null }, "block")
  const updated = applyWorkspaceAsset(project, block)
  const { kind: _kind, ...blockDocument } = block.document
  expect(updated.blocks[0]).toEqual(BlockSchema.parse({ ...blockDocument, id: block.id, texture: undefined }))
  expect(updated.workspace.assets[0]?.id).toBe(block.id)
  const badRecipe = asset({ kind: "recipe", name: "坏配方", pattern: ["runtime_content:missing", null, null, null, null, null, null, null, null], result: "runtime_content:missing", count: 1 }, "recipe")
  expect(() => applyWorkspaceAsset(updated, badRecipe)).toThrow(/Unknown content reference/)
  await saveProject(root, updated, project.revision)
  expect((await openProject(root)).workspace.assets).toHaveLength(1)
})

test("workspace asset module identity is stable and unbridged runtime designs cannot claim ready", async () => {
  const project = await createProject({ directory: await directory(), name: "资产边界" })
  const model = asset({ kind: "model", ...mushroomCowDesign }, "model", { status: "ready" })
  const staged = applyWorkspaceAsset(project, model)
  expect(staged.workspace.assets[0]?.status).toBe("design")
  const texture = asset({ kind: "texture", width: 1, height: 1, palette: ["#112233"], pixels: [0] }, "texture", { id: model.id, status: "design" })
  expect(() => applyWorkspaceAsset(staged, texture)).toThrow(/module cannot change/)
})

test("unbound animations remain design assets while bound animations validate model bones", async () => {
  const project = await createProject({ directory: await directory(), name: "动画边界" })
  const model = asset({ kind: "model", ...mushroomCowDesign }, "model")
  const stagedModel = applyWorkspaceAsset(project, model)
  const unbound = asset({ kind: "animation", name: "idle", length: 1, loop: true, channels: [{ bone: "future_bone", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] }, "animation", { status: "ready" })
  expect(applyWorkspaceAsset(stagedModel, unbound).workspace.assets.find((value) => value.id === unbound.id)?.status).toBe("design")
  const bound = { ...unbound, id: crypto.randomUUID(), dependencies: [model.id], status: "design" as const }
  expect(() => applyWorkspaceAsset(stagedModel, bound)).toThrow(/bone does not exist/)
})

test("model workspace assets bridge to a stable entity and immutable model asset", async () => {
  const root = await directory()
  const created = await createProject({ directory: root, name: "模型桥接" })
  const model = asset({ kind: "model", ...mushroomCowDesign }, "model", { provenance: { model: "custom-model", request_id: uuid() } })
  const staged = applyWorkspaceAsset(created, model)
  await saveProject(root, staged, created.revision)
  const bridged = await persistWorkspaceModel(root, model.id)
  if (!bridged.asset) throw new Error("Entity model persistence must return its disk model asset")
  const assetId = bridged.asset.id
  expect(bridged.project.entities.some((entity) => entity.id === model.id && entity.model_asset_id === assetId)).toBe(true)
  expect(bridged.workspaceAsset.status).toBe("ready")
  expect(bridged.workspaceAsset.revision).toBe(model.revision)
  expect((await loadModelAsset(root, bridged.asset.id)).origin).toBe("ai")
  expect((await openProject(root)).workspace.assets.find((value) => value.id === model.id)?.status).toBe("ready")
})

test("model asset files are rolled back when the project transaction cannot commit", async () => {
  const root = await directory()
  const created = await createProject({ directory: root, name: "资产回滚" })
  const entity = createEntity({ name: "回滚实体" })
  const saved = await saveProject(root, { ...created, entities: [entity] }, created.revision)
  await rm(path.join(root, "minemods.project.json"))
  await expect(putModelAssetUnlocked(root, saved, {
    entity_id: entity.id,
    data: { design: mushroomCowDesign },
    origin: "manual",
    expectedRevision: saved.revision,
  })).rejects.toThrow()
  const assetsDirectory = path.join(root, ".minemods", "assets")
  expect((await readdir(assetsDirectory).catch(() => [])).length).toBe(0)
})

test("public model edits synchronize the workspace document without a second bridge revision", async () => {
  const root = await directory()
  const created = await createProject({ directory: root, name: "模型同步" })
  const model = asset({ kind: "model", ...mushroomCowDesign }, "model", { provenance: { model: "gpt-6-astra", request_id: uuid() } })
  const staged = applyWorkspaceAsset(created, model)
  const saved = await saveProject(root, staged, created.revision)
  const bridged = await persistWorkspaceModel(root, model.id)
  const initialWorkspace = bridged.project.workspace.assets.find(value => value.id === model.id)!
  const edited = ModelDesignSchema.parse({ ...mushroomCowDesign, name: "手工编辑模型" })
  const manual = await putModelAsset(root, {
    entity_id: model.id,
    expectedRevision: bridged.project.revision,
    origin: "manual",
    data: { design: edited, blockbench: designToBlockbench(edited), provenance: null },
  })
  const synchronized = manual.project.workspace.assets.find(value => value.id === model.id)!
  expect(synchronized.document.kind).toBe("model")
  expect(synchronized.document.kind === "model" ? synchronized.document.name : "").toBe("手工编辑模型")
  expect(synchronized.revision).toBe(initialWorkspace.revision + 1)
  expect(synchronized.status).toBe("ready")
  expect(synchronized.provenance).toEqual({ model: null, request_id: null })
  const bridgedAgain = await persistWorkspaceModel(root, model.id)
  const roundTripped = bridgedAgain.project.workspace.assets.find(value => value.id === model.id)!
  expect(roundTripped.revision).toBe(synchronized.revision)
  expect(roundTripped.updated_at).toBe(synchronized.updated_at)
  expect(bridgedAgain.project.revision).toBe(manual.project.revision + 1)
  const invalid = await putModelAsset(root, {
    entity_id: model.id,
    expectedRevision: bridgedAgain.project.revision,
    origin: "manual",
    data: { design: { malformed: true } },
  })
  const afterInvalid = invalid.project.workspace.assets.find(value => value.id === model.id)!
  expect(afterInvalid.document.kind === "model" ? afterInvalid.document.name : "").toBe("手工编辑模型")
  expect(afterInvalid.revision).toBe(roundTripped.revision)
  expect(saved.workspace.assets.find(value => value.id === model.id)?.revision).toBe(1)
})

test("workspace is embedded in archive manifests and survives roundtrip", async () => {
  const root = await directory()
  const source = path.join(root, "source")
  await mkdir(source)
  const created = await createProject({ directory: source, name: "归档工作区" })
  const worldview = asset({ kind: "worldview", title: "月雾", summary: "会呼吸的森林", entries: [{ title: "月鹿", body: "夜间出现" }] }, "worldview")
  const saved = applyWorkspaceAsset(created, worldview)
  await saveProject(source, saved, created.revision)
  const archive = path.join(root, "workspace.minemods")
  await exportProjectArchive({ directory: source, destination: archive })
  expect((await inspectProjectArchive(archive)).project.workspace.assets[0]?.id).toBe(worldview.id)
  const destination = path.join(root, "restored")
  const restored = await importProjectArchive({ archive, destination })
  expect(restored.project.workspace).toEqual(saved.workspace)
})
