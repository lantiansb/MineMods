import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { weaponFixture, WEAPON_ITEM_ID, WEAPON_MODEL_ID } from "../../studio/test/weapon-fixture"
import { createEntity, createProject } from "../src/project"
import { applyContent, applyWorkspaceAsset, WorkspaceAssetSchema } from "../src/workspace"
import { isItemOnlyModel, reviewStaticItemModel, STATIC_ITEM_MODEL_STANDARD } from "../src/item-model-quality"
import { reviewAsset } from "../src/acceptance"

const roots: string[] = []
afterEach(() => Promise.all(roots.splice(0).map(directory => rm(directory, { recursive: true, force: true }))))

test("the same weapon uses static gates only when its actual project use is item-only", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "static-item-gates-"))
  roots.push(directory)
  const project = await createProject({ directory, name: "静态物品验收" })
  const time = new Date().toISOString()
  const asset = WorkspaceAssetSchema.parse({ id: WEAPON_MODEL_ID, module: "model", title: "电锯剑", document: { kind: "model", ...weaponFixture() }, revision: 1, created_at: time, updated_at: time, prompt: "武器", dependencies: [], provenance: { model: null, request_id: null }, status: "design" })
  const staged = applyWorkspaceAsset(project, asset)
  const linked = applyContent(staged, { blocks: [], recipes: [], logic: [], items: [{ id: WEAPON_ITEM_ID, identifier: "chainsword", name: "电锯剑", max_stack: 1, color: "#aa7755", model_asset_id: WEAPON_MODEL_ID }] })
  expect(isItemOnlyModel(linked, asset.id)).toBe(true)
  const result = reviewAsset(linked, asset, { insisted: true, candidate: true })
  expect(result.passed).toBe(true)
  expect(result.spared).toBe(false)
  expect(result.findings).toEqual([])
  const dual = { ...linked, entities: [{ ...createEntity({ name: "共用模型的生物" }), id: asset.id }] }
  expect(isItemOnlyModel(dual, asset.id)).toBe(false)
  const creature = reviewAsset(dual, asset, { insisted: true, candidate: true })
  expect(creature.passed).toBe(false)
  expect(creature.findings.some(finding => finding.rule === "nothing_moves")).toBe(true)
  expect(STATIC_ITEM_MODEL_STANDARD.rules.some(rule => rule.id === "hidden_parts")).toBe(true)
  expect(STATIC_ITEM_MODEL_STANDARD.rules.some(rule => rule.id === "noisy_texture")).toBe(true)
})

test("static item review still refuses actual movement, rotated bones, bounds, hidden and floating geometry", () => {
  const motion = weaponFixture()
  motion.animations[0]!.channels[0]!.keyframes[0]!.rotation[0] = 10
  expect(reviewStaticItemModel(motion).passed).toBe(false)
  const rotated = weaponFixture()
  rotated.bones[0]!.rotation[1] = 45
  expect(reviewStaticItemModel(rotated).passed).toBe(false)
  const bounds = weaponFixture()
  bounds.bones.find(bone => bone.cubes.length)!.cubes[0]!.origin[1] = 50
  expect(reviewStaticItemModel(bounds).passed).toBe(false)
  const hidden = weaponFixture()
  const owner = hidden.bones.find(bone => bone.cubes.length)!
  owner.cubes.push({ ...structuredClone(owner.cubes[0]!), name: "buried", origin: [-0.5, 2, -0.5], size: [1, 1, 1] })
  expect(reviewStaticItemModel(hidden).findings.some(finding => finding.rule === "hidden_parts")).toBe(true)
  const floating = weaponFixture()
  const loose = floating.bones.find(bone => bone.cubes.length)!
  loose.cubes.push({ ...structuredClone(loose.cubes[0]!), name: "loose", origin: [20, 0, 0], size: [1, 1, 1] })
  expect(reviewStaticItemModel(floating).findings.some(finding => finding.rule === "floating_parts")).toBe(true)
  const justified = reviewStaticItemModel(floating, { justified: [{ what: "floating_parts", reason: "这是一颗刻意悬浮的魔法宝石" }] })
  expect(justified.findings.some(finding => finding.rule === "floating_parts")).toBe(false)
  expect(justified.answered?.some(answer => answer.rule === "floating_parts")).toBe(true)
  expect(reviewStaticItemModel(bounds, { justified: [{ what: "floating_parts", reason: "刻意悬浮" }] }).passed).toBe(false)
  const duplicated = weaponFixture()
  duplicated.bones[0]!.cubes.push({ ...structuredClone(duplicated.bones[0]!.cubes[0]!), name: "duplicate" })
  expect(reviewStaticItemModel(duplicated).findings.some(finding => finding.rule === "duplicate_geometry")).toBe(true)
})
