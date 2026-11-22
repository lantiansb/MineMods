import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { mushroomCowDesign } from "../src/example"
import { createProject, openProject, saveProject } from "../src/project"
import { persistWorkspaceModel } from "../src/workspace-model"
import { EntityRuntimeSchema } from "../src/entity-runtime"
import { ModuleDocumentSchema, WorkspaceAssetSchema, applyWorkspaceAsset, compileWorkspaceTexture } from "../src/workspace"
import { assembleBuildSource } from "../src/build"

const directories: string[] = []

const uuid = () => crypto.randomUUID()
const timestamp = () => new Date().toISOString()
const workspaceAsset = (document: Record<string, unknown>, module: string, overrides: Record<string, unknown> = {}) =>
  WorkspaceAssetSchema.parse({
    id: uuid(),
    module,
    title: String(document.name ?? module),
    revision: 1,
    created_at: timestamp(),
    updated_at: timestamp(),
    prompt: `设计 ${module}`,
    dependencies: [],
    document,
    provenance: { model: null, request_id: null },
    status: "design",
    ...overrides,
  })

async function directory() {
  const value = await mkdtemp(path.join(os.tmpdir(), "minemods-entity-runtime-"))
  directories.push(value)
  return value
}

afterEach(async () => Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true }))))

const runtime = EntityRuntimeSchema.parse({
  spawn: {
    biomes: ["minecraft:plains", "minecraft:forest"],
    weight: 10,
    min: 1,
    max: 3,
  },
  explosion: {
    fuse_ticks: 20,
    radius: 2,
    damage_blocks: false,
    effects: [{ effect: "slowness", duration_ticks: 40, amplifier: 1 }],
  },
  movement: "stalk",
  armor: 3,
  charging_armor: 5,
  texture_asset_id: uuid(),
})

test("entity runtime accepts the bounded 1.21.1 contract and rejects unknown enums", () => {
  expect(EntityRuntimeSchema.parse(runtime)).toEqual(runtime)
  expect(EntityRuntimeSchema.safeParse({ ...runtime, spawn: { ...runtime.spawn, biomes: ["minecraft:not_a_biome"] } }).success).toBe(false)
  expect(EntityRuntimeSchema.safeParse({ ...runtime, explosion: { ...runtime.explosion, effects: [{ effect: "speed", duration_ticks: 1, amplifier: 0 }] } }).success).toBe(false)
  expect(EntityRuntimeSchema.safeParse({ ...runtime, spawn: { ...runtime.spawn, min: 4, max: 3 } }).success).toBe(false)
})

test("legacy project entities remain readable without runtime", async () => {
  const root = await directory()
  const project = await createProject({ directory: root, name: "兼容工程" })
  expect((await openProject(root)).entities).toEqual([])
  expect(ModuleDocumentSchema.safeParse({ kind: "entity", name: "旧实体", description: "", health: 20, speed: 0.25, attack_damage: 2, behavior: "passive", model_asset_id: uuid(), runtime }).success).toBe(true)
  expect(project.schema_version).toBe(1)
})

test("entity workspace assets require model and texture dependencies and update the bridged entity", async () => {
  const root = await directory()
  const created = await createProject({ directory: root, name: "实体绑定" })
  const model = workspaceAsset({ kind: "model", ...mushroomCowDesign }, "model", { status: "design" })
  const staged = applyWorkspaceAsset(created, model)
  await saveProject(root, staged, created.revision)
  const persisted = await persistWorkspaceModel(root, model.id)
  if (!persisted.asset) throw new Error("Entity model persistence must return its disk model asset")
  const texture = workspaceAsset({ kind: "texture", width: mushroomCowDesign.texture_size, height: mushroomCowDesign.texture_size, palette: ["#112233"], pixels: [0].concat(Array(mushroomCowDesign.texture_size * mushroomCowDesign.texture_size - 1).fill(0)) }, "texture")
  const withTexture = applyWorkspaceAsset(persisted.project, texture)
  const entityAsset = workspaceAsset({ kind: "entity", name: "强化月鹿", description: "会追踪玩家", health: 30, speed: 0.35, attack_damage: 7, behavior: "hostile", model_asset_id: model.id, runtime: { ...runtime, texture_asset_id: texture.id } }, "entity", { dependencies: [model.id, texture.id], status: "ready" })
  const updated = applyWorkspaceAsset(withTexture, entityAsset)
  expect(updated.entities.find((entity) => entity.id === model.id)).toMatchObject({ name: "强化月鹿", health: 30, model_asset_id: persisted.asset.id, runtime: { movement: "stalk", texture_asset_id: texture.id } })
  expect(updated.workspace.assets.find((asset) => asset.id === entityAsset.id)?.status).toBe("ready")
})

test("entity workspace assets reject missing texture and duplicate model bindings", async () => {
  const project = await createProject({ directory: await directory(), name: "实体依赖" })
  const modelId = uuid()
  const textureId = uuid()
  const document = { kind: "entity" as const, name: "月鹿", description: "", health: 20, speed: 0.25, attack_damage: 2, behavior: "passive" as const, model_asset_id: modelId, runtime: { ...runtime, texture_asset_id: textureId } }
  const missingTexture = workspaceAsset(document, "entity", { dependencies: [modelId] })
  expect(() => applyWorkspaceAsset(project, missingTexture)).toThrow(/texture|depend/i)
})

test("entity runtime may reuse the model's compiled texture when texture binding is null", () => {
  const modelId = uuid()
  const document = { kind: "entity" as const, name: "月鹿", description: "", health: 20, speed: 0.25, attack_damage: 2, behavior: "passive" as const, model_asset_id: modelId, runtime: { ...runtime, texture_asset_id: null } }
  const asset = workspaceAsset(document, "entity", { dependencies: [modelId] })
  expect(asset.document.kind).toBe("entity")
  expect(asset.document.kind === "entity" ? asset.document.runtime.texture_asset_id : "invalid").toBeNull()
})

test("texture updates cannot break an existing entity UV binding", async () => {
  const root = await directory()
  const created = await createProject({ directory: root, name: "贴图绑定" })
  const model = workspaceAsset({ kind: "model", ...mushroomCowDesign }, "model")
  await saveProject(root, applyWorkspaceAsset(created, model), created.revision)
  const persisted = await persistWorkspaceModel(root, model.id)
  const texture = workspaceAsset({ kind: "texture", width: mushroomCowDesign.texture_size, height: mushroomCowDesign.texture_size, palette: ["#112233"], pixels: Array(mushroomCowDesign.texture_size * mushroomCowDesign.texture_size).fill(0) }, "texture")
  const withTexture = applyWorkspaceAsset(persisted.project, texture)
  const entityAsset = workspaceAsset({ kind: "entity", name: "贴图鹿", description: "", health: 20, speed: 0.25, attack_damage: 2, behavior: "passive", model_asset_id: model.id, runtime: { ...runtime, texture_asset_id: texture.id } }, "entity", { dependencies: [model.id, texture.id], status: "ready" })
  const bound = applyWorkspaceAsset(withTexture, entityAsset)
  const replacement = { ...texture, document: { ...texture.document, width: 128, height: 128, pixels: Array(128 * 128).fill(0) } }
  expect(() => applyWorkspaceAsset(bound, replacement)).toThrow(/dimension|texture/i)
})

test("build binds the entity texture PNG and records entity and texture revisions", async () => {
  const root = await directory()
  const project = await createProject({ directory: root, name: "构建贴图" })
  const model = workspaceAsset({ kind: "model", ...mushroomCowDesign }, "model")
  await saveProject(root, applyWorkspaceAsset(project, model), project.revision)
  const persisted = await persistWorkspaceModel(root, model.id)
  const texture = workspaceAsset({ kind: "texture", width: mushroomCowDesign.texture_size, height: mushroomCowDesign.texture_size, palette: ["#abcdef"], pixels: Array(mushroomCowDesign.texture_size * mushroomCowDesign.texture_size).fill(0) }, "texture")
  const withTexture = applyWorkspaceAsset(persisted.project, texture)
  await saveProject(root, withTexture, persisted.project.revision)
  const entityAsset = workspaceAsset({ kind: "entity", name: "彩纹牛", description: "", health: 20, speed: 0.25, attack_damage: 2, behavior: "passive", model_asset_id: model.id, runtime: { ...runtime, texture_asset_id: texture.id } }, "entity", { dependencies: [model.id, texture.id], status: "ready" })
  const bound = applyWorkspaceAsset(await openProject(root), entityAsset)
  await saveProject(root, bound, bound.revision)
  const source = path.join(root, "source")
  await assembleBuildSource(root, source, fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url)))
  const entityId = `creature_${model.id.replaceAll("-", "")}`
  expect(await Bun.file(path.join(source, `src/main/resources/assets/${bound.mod_id}/textures/entity/${entityId}.png`)).bytes()).toEqual(compileWorkspaceTexture(texture))
  const manifest = await Bun.file(path.join(source, "minemods-build.json")).json() as { entity_revisions: Array<number | null>; texture_asset_ids: Array<string | null>; texture_revisions: Array<number | null>; workspace_assets: { id: string; module: string; revision: number }[] }
  expect(manifest.entity_revisions).toEqual([entityAsset.revision])
  expect(manifest.texture_asset_ids).toEqual([texture.id])
  expect(manifest.texture_revisions).toEqual([texture.revision])
  // Every workspace asset that went into this build is listed with the revision that was built.
  expect(manifest.workspace_assets).toEqual(
    (await openProject(root)).workspace.assets.map((asset) => ({ id: asset.id, module: asset.module, revision: asset.revision })),
  )
  expect(manifest.workspace_assets.map((asset) => asset.module).sort()).toEqual(["entity", "model", "texture"])
})
