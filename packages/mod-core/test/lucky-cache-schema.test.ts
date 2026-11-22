import { expect, test } from "bun:test"
import { BlockSchema, validateContent } from "../src/content"
import { DeathDropSchema, EntityRuntimeSchema } from "../src/entity-runtime"
import { LuckyCacheSchema } from "../src/lucky-cache"
import { ProjectSchema } from "../src/project"
import { mushroomCowDesign } from "../src/example"
import { WorkspaceAssetSchema, applyWorkspaceAsset } from "../src/workspace"

const outcome = {
  weight: 60,
  items: [{ item: "minecraft:apple" as const, min: 1, max: 2 }],
  effects: [],
}

const lucky = {
  max_stack: 16,
  outcomes: [outcome, { weight: 40, items: [], effects: [{ effect: "slowness" as const, duration_ticks: 40, amplifier: 1 }] }],
}

const block = {
  id: "11111111-1111-4111-8111-111111111111",
  identifier: "lucky_box",
  name: "幸运盒",
  hardness: 1,
  luminance: 0,
  tool: "pickaxe" as const,
  drop: "self" as const,
  color: "#c77a45",
  lucky,
}

test("legacy content and entity runtime remain valid without lucky fields", () => {
  expect(validateContent({ mod_id: "demo", package_name: "com.example.demo", blocks: [], items: [], recipes: [], logic: [] })).toEqual({ blocks: [], items: [], recipes: [], logic: [] })
  const { lucky: _lucky, ...legacyBlockInput } = block
  const legacyBlock = BlockSchema.parse(legacyBlockInput)
  const legacyRuntime = EntityRuntimeSchema.parse({ spawn: null, explosion: null, movement: "direct", armor: 1, charging_armor: 2, texture_asset_id: null })
  expect("lucky" in legacyBlock).toBe(false)
  expect("death_drop" in legacyRuntime).toBe(false)
})

test("accepts a bounded lucky cache and death drop", () => {
  expect(LuckyCacheSchema.parse(lucky)).toEqual(lucky)
  expect(DeathDropSchema.parse({ block_identifier: "lucky_box", chance: 0.35 })).toEqual({ block_identifier: "lucky_box", chance: 0.35 })
  expect(validateContent({ mod_id: "demo", package_name: "com.example.demo", blocks: [block], items: [], recipes: [], logic: [] }).blocks[0]).toMatchObject({ lucky })
})

test("rejects invalid lucky weights, ranges, rewards, effects, and items", () => {
  expect(LuckyCacheSchema.safeParse({ ...lucky, outcomes: [{ ...outcome, weight: 98 }, { ...lucky.outcomes[1], weight: 1 }] }).success).toBe(false)
  expect(LuckyCacheSchema.safeParse({ ...lucky, outcomes: [{ ...outcome, items: [{ item: "minecraft:apple", min: 3, max: 2 }] }, lucky.outcomes[1]] }).success).toBe(false)
  expect(LuckyCacheSchema.safeParse({ ...lucky, outcomes: [{ weight: 100, items: [], effects: [] }] }).success).toBe(false)
  expect(LuckyCacheSchema.safeParse({ ...lucky, outcomes: [{ weight: 100, items: [], effects: [{ effect: "slowness", duration_ticks: 1, amplifier: 0 }, { effect: "slowness", duration_ticks: 2, amplifier: 0 }] }] }).success).toBe(false)
  expect(LuckyCacheSchema.safeParse({ ...lucky, outcomes: [{ ...outcome, items: [{ item: "minecraft:stick", min: 1, max: 1 }] }, lucky.outcomes[1]] }).success).toBe(false)
})

test("rejects death drops that reference a missing or non-lucky block", () => {
  const runtime = { spawn: null, explosion: null, movement: "direct" as const, armor: 1, charging_armor: 2, texture_asset_id: null, death_drop: { block_identifier: "missing", chance: 0.35 } }
  expect(() => ProjectSchema.parse({ schema_version: 1, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "demo", description: "", mod_id: "demo", target: "fabric-1.21.1", revision: 0, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", entities: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "实体", description: "", health: 20, speed: 0.25, attack_damage: 2, behavior: "hostile", model_asset_id: null, runtime }], assets: [], blocks: [{ ...block, lucky: null }], items: [], recipes: [], logic: [], workspace: { assets: [] } })).toThrow(/death|block|lucky/i)
})

test("accepts a valid workspace entity dependency and rejects disabling its lucky block", () => {
  const entityId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  const blockAssetId = block.id
  const entityAssetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  const modelAsset = WorkspaceAssetSchema.parse({ id: entityId, module: "model", title: "模型", revision: 1, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", prompt: "model", dependencies: [], document: { kind: "model", ...mushroomCowDesign }, provenance: { model: null, request_id: null }, status: "ready" })
  const blockAsset = WorkspaceAssetSchema.parse({ id: blockAssetId, module: "block", title: block.name, revision: 1, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", prompt: "block", dependencies: [], document: { kind: "block", identifier: block.identifier, name: block.name, hardness: block.hardness, luminance: block.luminance, tool: block.tool, drop: block.drop, color: block.color, texture: null, lucky }, provenance: { model: null, request_id: null }, status: "ready" })
  const runtime = { spawn: null, explosion: null, movement: "direct" as const, armor: 1, charging_armor: 2, texture_asset_id: null, death_drop: { block_identifier: block.identifier, chance: 0.35 } }
  const entityAsset = WorkspaceAssetSchema.parse({ id: entityAssetId, module: "entity", title: "实体", revision: 1, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", prompt: "entity", dependencies: [entityId, blockAssetId], document: { kind: "entity", name: "实体", description: "", health: 20, speed: 0.25, attack_damage: 2, behavior: "hostile", model_asset_id: entityId, runtime }, provenance: { model: null, request_id: null }, status: "ready" })
  const project = ProjectSchema.parse({ schema_version: 1, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "demo", description: "", mod_id: "demo", target: "fabric-1.21.1", revision: 0, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", entities: [{ id: entityId, name: "实体", description: "", health: 20, speed: 0.25, attack_damage: 2, behavior: "hostile", model_asset_id: null, runtime }], assets: [], blocks: [block], items: [], recipes: [], logic: [], workspace: { assets: [modelAsset, blockAsset, entityAsset] } })
  expect(project.workspace.assets.find((asset) => asset.id === entityAssetId)?.dependencies).toContain(blockAssetId)
  const disabledBlock = { ...blockAsset, document: { kind: "block" as const, identifier: block.identifier, name: block.name, hardness: block.hardness, luminance: block.luminance, tool: block.tool, drop: block.drop, color: block.color, texture: null, lucky: null } }
  expect(() => applyWorkspaceAsset(project, disabledBlock)).toThrow(/lucky|death|depend/i)
})
