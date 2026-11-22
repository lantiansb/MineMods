import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { ItemSchema, compileContent } from "../src/content"
import { ItemDisplaySchema, exportItemDisplay, itemDisplayPose, itemDisplayTransform } from "../src/item-display"
import { compileItemModel } from "../src/item-model"
import { applyContent, applyWorkspaceAsset, builtWorkspaceAssets, WorkspaceAssetSchema, WorkspaceSchema } from "../src/workspace"
import { createProject, openProject, saveProject, withProjectLock } from "../src/project"
import { persistWorkspaceModelUnlocked } from "../src/workspace-model"
import { exportProjectSource } from "../src/build"

const roots: string[] = []
afterEach(() => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))
const modelId = "11111111-1111-4111-8111-111111111111"
const design = ModelDesignSchema.parse({
  name: "Test sword", texture_size: 64,
  bones: [{ name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [
    { name: "blade", origin: [-1, 7, -1], size: [2, 15, 2], faces: { north: "#5599bb", south: "#336688", east: "#aaccee", west: "#778899", up: "#ffffff", down: "#335566" }, surface_details: [] },
    { name: "grip", origin: [-1, 0, -1], size: [2, 7, 2], faces: { north: "#664433", south: "#664433", east: "#886644", west: "#886644", up: "#664433", down: "#664433" }, surface_details: [] },
  ] }],
  animations: ["idle", "walk", "hurt"].map(name => ({ name, length: 1, loop: true, channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] })),
})
const display = ItemDisplaySchema.parse({ firstperson_righthand: { translation: [2, 3, -4], rotation: [15, 25, 35], scale: [0.5, 0.75, 1] }, thirdperson_lefthand: { translation: [4, 5, 6], rotation: [-15, -25, -35], scale: [0.8, 0.8, 0.8] } })
const item = ItemSchema.parse({ id: "22222222-2222-4222-8222-222222222222", identifier: "test_sword", name: "测试剑", max_stack: 1, color: "#5599bb", model_asset_id: modelId, display })
const timestamp = new Date().toISOString()
const modelAsset = WorkspaceAssetSchema.parse({ id: modelId, module: "model", title: "测试剑模型", revision: 1, created_at: timestamp, updated_at: timestamp, prompt: "静态剑", dependencies: [], provenance: { model: null, request_id: null }, document: { kind: "model", ...design }, status: "design" })

test("validates finite display transforms and applies left-hand mirror once without changing saved values", () => {
  expect(ItemDisplaySchema.safeParse({ firstperson_righthand: { ...display.firstperson_righthand, scale: [-1, 1, 1] } }).success).toBe(false)
  expect(ItemDisplaySchema.safeParse({ firstperson_righthand: { ...display.firstperson_righthand, translation: [NaN, 0, 0] } }).success).toBe(false)
  const left = itemDisplayPose(display.thirdperson_lefthand!, "thirdperson_lefthand")
  expect(left.translation).toEqual([-4, 5, 6])
  expect(left.rotation[1]).toBeCloseTo(25 * Math.PI / 180)
  expect(exportItemDisplay(display, false, true).thirdperson_lefthand).toEqual(display.thirdperson_lefthand!)
  expect(itemDisplayTransform(undefined, "firstperson_lefthand", true).rotation).toEqual([0, 90, -25])
})

test("exports actual item geometry, painted PNG and all display contexts without changing legacy items", () => {
  const files = compileContent({ mod_id: "test_mod", package_name: "test.content", items: [item], blocks: [], recipes: [], logic: [], item_models: { [modelId]: design } })
  const json = JSON.parse(String(files["src/main/resources/assets/test_mod/models/item/test_sword.json"]))
  expect(json.elements).toHaveLength(2)
  expect(json.elements[0].from).toEqual([7, 7, 7])
  expect(json.elements[0].to).toEqual([9, 22, 9])
  expect(json.display.firstperson_righthand).toEqual(display.firstperson_righthand)
  expect(json.display.thirdperson_lefthand).toEqual(display.thirdperson_lefthand)
  expect(Object.keys(json.display)).toHaveLength(4)
  expect(files["src/main/resources/assets/test_mod/textures/item/test_sword.png"]).toBeInstanceOf(Uint8Array)
  const plain = compileContent({ mod_id: "test_mod", package_name: "test.content", items: [{ ...item, model_asset_id: undefined, display: undefined }], blocks: [], recipes: [], logic: [] })
  expect(JSON.parse(String(plain["src/main/resources/assets/test_mod/models/item/test_sword.json"]))).toEqual({ parent: "minecraft:item/generated", textures: { layer0: "test_mod:item/test_sword" } })
  expect(() => compileContent({ mod_id: "test_mod", package_name: "test.content", items: [item], blocks: [], recipes: [], logic: [] })).toThrow("缺少关联模型")
})

test("rejects unsupported model transforms rather than silently discarding them", () => {
  const rotated = structuredClone(design)
  rotated.bones[0]!.rotation[1] = 45
  expect(() => compileItemModel(rotated)).toThrow("旋转骨骼")
  const moving = structuredClone(design)
  moving.animations[0]!.channels[0]!.keyframes[0]!.rotation[2] = 15
  expect(() => compileItemModel(moving)).toThrow("动画运动")
  const oversized = structuredClone(design)
  oversized.bones[0]!.cubes[0]!.origin[1] = 30
  expect(() => compileItemModel(oversized)).toThrow("坐标范围")
})

test("each exported face samples the original model's distinct painted face without swapping east and west", () => {
  const model = compileItemModel(design)
  const cube = design.bones[0]!.cubes[0]!
  ;(["east", "west", "up", "down", "south", "north"] as const).forEach(face => {
    const uv = model.elements[0]!.faces[face]!.uv
    const x = Math.floor(uv[0]! * model.texture.size / 16)
    const y = Math.floor(uv[1]! * model.texture.size / 16)
    const pixel = model.texture.pixels.slice((y * model.texture.size + x) * 4, (y * model.texture.size + x) * 4 + 3)
    expect(`#${Array.from(pixel).map(value => value.toString(16).padStart(2, "0")).join("")}`).toBe(cube.faces[face])
  })
})

test("item model binding, rework, reopening and source export preserve one item without registering an entity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-item-display-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const project = await createProject({ directory, name: "测试武器", mod_id: "test_weapon" })
  const staged = applyWorkspaceAsset(project, modelAsset)
  const linked = applyContent(staged, { items: [item], blocks: [], recipes: [], logic: [] })
  expect(linked.workspace.assets.find(asset => asset.id === modelId)?.status).toBe("ready")
  expect(linked.workspace.assets.find(asset => asset.id === item.id)?.dependencies).toEqual([modelId])
  const saved = await saveProject(directory, linked, project.revision)
  const changed = structuredClone(modelAsset)
  if (changed.document.kind !== "model") throw new Error("Expected model")
  changed.document.bones[0]!.cubes[0]!.size[1] = 16
  changed.revision += 1
  const reworked = applyWorkspaceAsset(saved, changed)
  const persisted = await withProjectLock(directory, () => persistWorkspaceModelUnlocked(directory, reworked, modelId))
  expect(persisted.asset).toBeNull()
  expect(persisted.project.entities).toEqual([])
  expect(persisted.project.assets).toEqual([])
  const reopened = await openProject(directory)
  expect(reopened.items[0]).toEqual(item)
  expect(reopened.entities).toEqual([])
  expect(reopened.workspace.assets.find(asset => asset.id === modelId)?.status).toBe("ready")
  expect(builtWorkspaceAssets(reopened).map(asset => asset.id)).toContain(modelId)
  const destination = path.join(root, "export")
  await exportProjectSource(directory, destination, path.resolve(import.meta.dir, "../../../templates/fabric-1.21"))
  const json = JSON.parse(await readFile(path.join(destination, "src/main/resources/assets/test_weapon/models/item/test_sword.json"), "utf8"))
  expect(json.elements[0].to[1]).toBe(23)
  expect(json.display.firstperson_righthand).toEqual(display.firstperson_righthand)
  expect((await openProject(path.join(destination, "project-backup"))).items[0]?.model_asset_id).toBe(modelId)
  const missingDependency = reopened.workspace.assets.map(asset => asset.id === item.id ? { ...asset, dependencies: [] } : asset)
  expect(WorkspaceSchema.safeParse({ assets: missingDependency }).success).toBe(false)
})

test("workspace hand edits retain four display slots and require accurate model dependencies on binding, replacement and removal", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "item-hand-boundary-"))
  roots.push(directory)
  const project = await createProject({ directory, name: "手改持握" })
  const replacementId = "33333333-3333-4333-8333-333333333333"
  const material = { ...item, id: "44444444-4444-4444-8444-444444444444", identifier: "material", model_asset_id: undefined, display: undefined }
  const staged = applyWorkspaceAsset(applyWorkspaceAsset(project, modelAsset), { ...modelAsset, id: replacementId })
  const linked = applyContent(staged, { items: [item, material], blocks: [], recipes: [], logic: [] })
  const asset = linked.workspace.assets.find(value => value.id === item.id)!
  if (asset.document.kind !== "item") throw new Error("Expected item document")
  const poses = ItemDisplaySchema.parse({
    firstperson_righthand: { translation: [1, 2, 3], rotation: [10, 20, 30], scale: [0.5, 0.6, 0.7] },
    firstperson_lefthand: { translation: [4, 5, 6], rotation: [40, 50, 60], scale: [0.8, 0.9, 1] },
    thirdperson_righthand: { translation: [-1, -2, -3], rotation: [-10, -20, -30], scale: [1.1, 1.2, 1.3] },
    thirdperson_lefthand: { translation: [-4, -5, -6], rotation: [-40, -50, -60], scale: [1.4, 1.5, 1.6] },
  })
  const changed = { ...asset, revision: asset.revision + 1, dependencies: [replacementId, material.id], document: { ...asset.document, model_asset_id: replacementId, display: poses } }
  expect(() => applyWorkspaceAsset(linked, { ...changed, dependencies: [modelId, material.id] })).toThrow("must depend on")
  expect(() => applyWorkspaceAsset(linked, { ...changed, document: { ...changed.document, model_asset_id: material.id } })).toThrow()
  const swapped = applyWorkspaceAsset(linked, changed)
  expect(swapped.items.find(value => value.id === item.id)).toEqual({ ...item, model_asset_id: replacementId, display: poses })
  expect(swapped.workspace.assets.find(value => value.id === item.id)?.dependencies).toEqual([replacementId, material.id])
  expect(swapped.entities).toEqual([])
  await saveProject(directory, swapped, project.revision)
  expect((await openProject(directory)).items.find(value => value.id === item.id)?.display).toEqual(poses)
  const unbound = applyWorkspaceAsset(swapped, { ...changed, revision: changed.revision + 1, dependencies: [material.id], document: { ...changed.document, model_asset_id: null } })
  expect(unbound.items.find(value => value.id === item.id)).toEqual({ ...item, model_asset_id: null, display: poses })
  expect(unbound.workspace.assets.find(value => value.id === item.id)?.dependencies).toEqual([material.id])
  expect(unbound.items.find(value => value.id === material.id)).toEqual(linked.items.find(value => value.id === material.id))
})
