import { expect, test } from "bun:test"
import { ASSET_GROUPS, ASSET_KINDS, DEFAULT_TARGET, kindCapability, kindLabels, ModuleKindSchema, MODULES, savedStatus, TargetIdSchema } from "../src/workspace-modules"
import { kindGap } from "../src/platform/kind-gaps"
import { WorkspaceAssetSchema, WorkspaceSchema } from "../src/workspace"
import { mushroomCowDesign } from "../src/example"

const time = "2026-10-01T00:00:00.000Z"
const asset = (document: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  WorkspaceAssetSchema.parse({ id: crypto.randomUUID(), module: document.kind, title: "测试", revision: 1, created_at: time, updated_at: time, prompt: "测试", dependencies: [], document, provenance: { model: null, request_id: null }, status: "design", ...extra })
const entity = (modelId: string, textureId: string | null) => ({
  kind: "entity", name: "生物", description: "", health: 20, speed: 0.25, attack_damage: 2, behavior: "passive", model_asset_id: modelId,
  runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: textureId },
})

test("every kind is fully described, and its capability is the same on every target unless the target has a gap with a reason", () => {
  expect(ASSET_KINDS.map((kind) => kind.id)).toEqual(ModuleKindSchema.options)
  ASSET_KINDS.forEach((kind) => {
    expect(Object.values(ASSET_GROUPS)).toContain(kind.group)
    // One generator for every target: a kind is made into the game on each of them as it is on the default, unless `platform/kind-gaps.ts` says why not.
    TargetIdSchema.options.forEach((target) => expect(kindCapability(kind.id, target)).toBe(kindGap(kind.id, target) ? "design" : kind.capability))
    expect(kindCapability(kind.id, DEFAULT_TARGET)).toBe(kind.capability)
    expect(kind.verify).toEqual([])
    expect(kind.summary.length).toBeGreaterThan(0)
    kind.references.forEach((reference) => reference.kinds.forEach((value) => expect(ModuleKindSchema.options).toContain(value)))
  })
  // 书: a book is a thing the player holds and reads by itself.
  expect(ASSET_KINDS.filter((kind) => kind.owner).map((kind) => kind.id)).toEqual(["entity", "block", "item", "book"])
  expect(MODULES.entity.references.filter((reference) => reference.required).map((reference) => reference.field)).toEqual(["model_asset_id"])
})

test("no loader name appears in the structure of a kind", () => {
  ASSET_KINDS.forEach((kind) => {
    const { instructions: _instructions, summary: _summary, ...structure } = kind
    expect(JSON.stringify(structure)).not.toMatch(/fabric|forge/i)
  })
})

test("a standalone animation is honestly a design draft; nothing compiles it", () => {
  expect(MODULES.animation.capability).toBe("design")
  for (const target of TargetIdSchema.options) expect(kindLabels("design", target)).toEqual(["动画", "世界观", "群系", "维度", "地形"])
  expect(MODULES.animation.instructions).toContain("不进入构建")
})

test("the saved status of a new asset follows the registry and matches the previous fixed list", () => {
  // The first five are the list from before the registry; a gesture, then gameplay, then effects, then sounds (任务二 §9) and particles (Boss 能力 11) were added later and are built as soon as they are saved.
  for (const target of TargetIdSchema.options)
    expect(ModuleKindSchema.options.filter((kind) => savedStatus(kind, target) === "ready")).toEqual(["entity", "block", "item", "recipe", "logic", "gesture", "gameplay", "effect", "sound", "particle", "book"])
})

test("workspace validation enforces the references the registry declares, with the same messages as before", () => {
  const model = asset({ kind: "model", ...mushroomCowDesign })
  const texture = asset({ kind: "texture", width: 1, height: 1, palette: ["#112233"], pixels: [0] })
  const messages = (assets: unknown[]) => WorkspaceSchema.safeParse({ assets }).error?.issues.map((issue) => issue.message) ?? []
  expect(messages([model, texture, asset(entity(model.id, texture.id), { dependencies: [model.id, texture.id] })])).toEqual([])
  expect(messages([model, texture, asset(entity(model.id, texture.id))])).toEqual([
    "Entity asset must depend on its model workspace asset",
    "Entity asset must depend on a non-empty texture workspace asset",
  ])
  expect(messages([model, texture, asset(entity(texture.id, null), { dependencies: [texture.id] })])).toEqual(["Entity model dependency must be a model workspace asset"])
  expect(messages([model, asset(entity(model.id, null), { dependencies: [model.id] }), asset(entity(model.id, null), { dependencies: [model.id] })])).toEqual([
    "A model workspace asset can only have one entity asset; create a separate model for each variant",
    "A model workspace asset can only have one entity asset; create a separate model for each variant",
  ])
  // Logic names a creature, and creatures made by hand have no workspace model, so this link is not enforced here.
  expect(messages([asset({ kind: "logic", entity_id: crypto.randomUUID(), trigger: "player_near", action: "look", item: null, animation: null, enabled: true })])).toEqual([])
})
