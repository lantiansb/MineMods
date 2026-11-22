import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { applyConceptionPlan, conceptionFromPlan, ConceptionPlanSchema, ConceptionSchema, type Conception } from "../src/conception"
import { createProject, ProjectSchema } from "../src/project"

const id = "11111111-1111-4111-8111-111111111111"

function plan(): Conception {
  return ConceptionSchema.parse({
    brief: "一座会呼吸的月光森林。",
    plan: "先完成生物原型，再审阅方块与配方意图。",
    status: "reviewed",
    entries: [
      { id, kind: "entity", title: "月鹿", brief: "温和地跟随玩家，受到攻击后逃跑。", status: "reviewed" },
      {
        id: "22222222-2222-4222-8222-222222222222",
        kind: "recipe",
        title: "月光酿造",
        brief: "把月露封进玻璃瓶，夜间饮用会发光。", status: "reviewed",
        recipe: {
          recipe_type: "custom",
          input_names: ["月露", "玻璃瓶"],
          output_name: "月光药水",
          container_description: "一只带木塞的月光酿造台，四周有冷凝水。",
          intent: "需要一个安静、缓慢的酿造过程。",
        },
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        kind: "block",
        title: "会呼吸的树皮",
        brief: "长篇描述它的触感、声音、与森林的关系，以及玩家靠近时的变化。", status: "reviewed",
      },
    ],
  })
}

test("round trips a conception plan with free-form recipe and block intent", () => {
  const parsed = ConceptionSchema.parse(plan())
  expect(ConceptionSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  expect(parsed.entries[1]?.kind).toBe("recipe")
})

test("project defaults conception for new and legacy manifests", async () => {
  const project = await createProject({ directory: await mkdtemp(path.join(os.tmpdir(), "minemods-conception-")), name: "Moon" })
  expect(project.conception.entries).toEqual([])
  const legacy = { ...project }
  delete (legacy as Partial<typeof project>).conception
  expect(ProjectSchema.parse(legacy).conception.status).toBe("draft")
})

test("imports entities and keeps non-compilable intentions as draft links", () => {
  const project = ProjectSchema.parse({
    schema_version: 1,
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Moon",
    description: "",
    mod_id: "moon",
    target: "fabric-1.21.1",
    revision: 0,
    created_at: "2026-09-15T00:00:00.000Z",
    updated_at: "2026-09-15T00:00:00.000Z",
    entities: [], assets: [], blocks: [], items: [], recipes: [], logic: [],
    conception: plan(),
  })
  const result = applyConceptionPlan(project, plan())
  expect(result.project.entities).toHaveLength(1)
  expect(result.project.entities[0]?.name).toBe("月鹿")
  expect(result.draft_links.map((link) => link.kind)).toEqual(["recipe", "block"])
  expect(result.project.conception.entries.find((entry) => entry.id === id)?.status).toBe("imported")
  expect(result.project.conception.entries.find((entry) => entry.id !== id)?.status).toBe("reviewed")
  expect(applyConceptionPlan(project, plan()).project.entities).toEqual(result.project.entities)
})

test("keeps nine empty crafting slots as a draft and restores custom names", () => {
  const parsed = ConceptionSchema.parse({ ...plan(), entries: [{ ...plan().entries[1]!, kind: "recipe", recipe: { recipe_type: "crafting", input_names: Array(9).fill(""), output_name: "月光药水", output_names: ["月光药水"], count: 2, fuel: "", duration: "", intent: "自由描述" } }] })
  expect(parsed.entries[0]?.kind).toBe("recipe")
  expect(parsed.entries[0]?.kind === "recipe" ? parsed.entries[0].recipe.input_names : []).toHaveLength(9)
  expect(parsed.entries[0]?.kind === "recipe" ? parsed.entries[0].recipe.output_names : []).toEqual(["月光药水"])
  expect(() => applyConceptionPlan(ProjectSchema.parse({ ...baseProject(), conception: parsed }), parsed)).not.toThrow()
})

test("rejects incomplete recipe layouts only when importing", () => {
  const recipe = { ...plan(), entries: [{ ...plan().entries[1]!, kind: "recipe" as const, recipe: { recipe_type: "crafting" as const, input_names: ["月露"], output_name: "药水", intent: "需要九格配方" } }] }
  const draft = ConceptionSchema.parse(recipe)
  expect(() => applyConceptionPlan(ProjectSchema.parse({ ...baseProject(), conception: draft }), draft)).toThrow(/crafting/i)
})

test("does not merge entries with the same key across different kinds", () => {
  const project = ProjectSchema.parse({ ...baseProject(), conception: ConceptionSchema.parse({ ...plan(), entries: [ { ...plan().entries[0]!, key: "moon" }, { ...plan().entries[2]!, key: "moon" } ] }) })
  const input = ConceptionPlanSchema.parse({ name: "Moon", worldview: "世界", questions: [], entries: [{ key: "moon", kind: "block", title: "月石更新", brief: "方块", relationships: [] }] })
  const result = conceptionFromPlan(project, input)
  expect(result.entries).toHaveLength(2)
  expect(result.entries.find(entry => entry.kind === "entity")?.title).toBe("月鹿")
  expect(result.entries.find(entry => entry.kind === "block")?.title).toBe("月石更新")
})

test("preserves an existing entity link when a plan is regenerated", () => {
  const project = ProjectSchema.parse({ ...baseProject(), conception: plan() })
  const entity = project.entities[0] ?? { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "月鹿", description: "", health: 20, speed: .25, attack_damage: 2, behavior: "passive" as const, model_asset_id: null }
  const source = ProjectSchema.parse({ ...project, entities: [entity], conception: { ...project.conception, entries: project.conception.entries.map(entry => entry.kind === "entity" ? { ...entry, entity_id: entity.id, status: "imported" as const } : entry) } })
  const input = ConceptionPlanSchema.parse({ name: "Moon", worldview: "更新世界", questions: [], entries: [{ key: "moon_deer", kind: "entity", title: "月鹿新名", brief: "保留既有实体", relationships: [] }] })
  const result = conceptionFromPlan(source, input)
  expect(result.entries.find(entry => entry.kind === "entity")?.entity_id).toBe(entity.id)
})

test("accepts historical confirmed model assets for an entity", () => {
  const entityId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const assetId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  const project = ProjectSchema.parse({ ...baseProject(), entities: [{ id: entityId, name: "月鹿", description: "", health: 20, speed: .25, attack_damage: 2, behavior: "passive", model_asset_id: null }], assets: [{ id: assetId, entity_id: entityId, revision: 1, origin: "manual", created_at: "2026-09-15T00:00:00.000Z", sha256: "a".repeat(64) }], conception: ConceptionSchema.parse({ ...plan(), entries: [{ ...plan().entries[0]!, entity_id: entityId, model_confirmed_asset_id: assetId }] }) })
  expect(project.conception.entries[0]?.model_confirmed_asset_id).toBe(assetId)
})

test("rejects conception links to missing entities or unrelated assets", () => {
  const missingEntity = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  expect(() => ProjectSchema.parse({ ...baseProject(), conception: ConceptionSchema.parse({ ...plan(), entries: [{ ...plan().entries[0]!, entity_id: missingEntity }] }) })).toThrow(/missing entity/i)
  const entityId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const otherEntity = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
  const assetId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  expect(() => ProjectSchema.parse({ ...baseProject(), entities: [{ id: entityId, name: "鹿", description: "", health: 20, speed: .25, attack_damage: 2, behavior: "passive", model_asset_id: null }, { id: otherEntity, name: "鸮", description: "", health: 20, speed: .25, attack_damage: 2, behavior: "passive", model_asset_id: null }], assets: [{ id: assetId, entity_id: otherEntity, revision: 1, origin: "manual", created_at: "2026-09-15T00:00:00.000Z", sha256: "a".repeat(64) }], conception: ConceptionSchema.parse({ ...plan(), entries: [{ ...plan().entries[0]!, entity_id: entityId, model_confirmed_asset_id: assetId }] }) })).toThrow(/belong/i)
})

test("imports a complete world plan while retaining a free-form recipe draft", () => {
  const complete = ConceptionSchema.parse({ brief: "完整世界", plan: "世界观", status: "reviewed", entries: [
    { id: "11111111-1111-4111-8111-111111111111", key: "deer", kind: "entity", title: "月鹿", brief: "生物", status: "reviewed" },
    { id: "22222222-2222-4222-8222-222222222222", key: "bark", kind: "block", title: "树皮", brief: "方块", status: "reviewed" },
    { id: "33333333-3333-4333-8333-333333333333", key: "sap", kind: "item", title: "树液", brief: "物品", status: "reviewed" },
    { id: "44444444-4444-4444-8444-444444444444", key: "brew", kind: "recipe", title: "酿造", brief: "配方意图", status: "reviewed", recipe: { recipe_type: "crafting", input_names: Array(9).fill(""), output_name: "月光药水", intent: "未知材料由玩家补充" } },
    { id: "55555555-5555-4555-8555-555555555555", key: "mist", kind: "biome", title: "雾林", brief: "群系", status: "reviewed" },
    { id: "66666666-6666-4666-8666-666666666666", key: "moon", kind: "dimension", title: "月界", brief: "维度", status: "reviewed" },
  ] })
  const result = applyConceptionPlan(ProjectSchema.parse({ ...baseProject(), conception: complete }), complete)
  expect(result.project.entities).toHaveLength(1)
  expect(result.draft_links.map(link => link.kind)).toEqual(["block", "item", "recipe", "biome", "dimension"])
  expect(result.project.conception.entries.find(entry => entry.kind === "recipe")?.kind).toBe("recipe")
})

function baseProject() {
  return { schema_version: 1 as const, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Moon", description: "", mod_id: "moon", target: "fabric-1.21.1" as const, revision: 0, created_at: "2026-09-15T00:00:00.000Z", updated_at: "2026-09-15T00:00:00.000Z", entities: [], assets: [], blocks: [], items: [], recipes: [], logic: [] }
}
