import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildProjectOverview } from "../src/asset-overview"
import { EXISTING_REFUSALS, existingRefusal, existingThings } from "../src/blueprint-existing"
import { nextBlueprintBatch, validateBlueprint, type Blueprint } from "../src/blueprint"
import { nextProductionBatch, redoBatch } from "../src/blueprint-production"
import { blueprintPlannerInstructions } from "../src/blueprint-planner"
import { codedParts, codedWords } from "../src/coded-errors"
import { adoptLegacy, legacyTargets, legacyThings } from "../src/legacy-content"
import { createEntity, createProject, ProjectSchema, saveProject, type Project } from "../src/project"
import { putModelAsset } from "../src/assets"
import { WorkspaceAssetSchema, mirrorContent } from "../src/workspace"
import { validateRoutePlan } from "../src/workspace-runs"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { leaked } from "./fixtures/acceptance/names"

const TARGET = "fabric-1.21.1"
const at = "2026-10-14T08:00:00.000Z"
const uuid = () => crypto.randomUUID()

const deer = createEntity({ name: "苔叶鹿", description: "林子里的一只鹿", health: 14 })
const block = { id: uuid(), identifier: "moss_brick", name: "苔砖", hardness: 2, luminance: 0, tool: "pickaxe" as const, drop: "self" as const, color: "#556644" }
const item = { id: uuid(), identifier: "leaf_charm", name: "叶片护符", max_stack: 16, color: "#88aa66" }

const base = (extra: Record<string, unknown> = {}): Project =>
  ProjectSchema.parse({ schema_version: 1, id: uuid(), name: "手做", description: "", mod_id: "handmade", target: TARGET, revision: 3, created_at: at, updated_at: at, entities: [deer], assets: [], blocks: [block], items: [item], recipes: [], logic: [], ...extra })

// A creature that has a model of its own, the way the project file records one: the entity names it and `assets` holds its reference.
const modelled = () => {
  const model = uuid()
  return { entities: [{ ...deer, model_asset_id: model }], assets: [{ id: model, entity_id: deer.id, revision: 1, origin: "manual", created_at: at, sha256: "a".repeat(64) }] }
}

const entry = (key: string, kind: string, extra: Record<string, unknown> = {}) =>
  ({ key, kind, title: `${key} 标题`, brief: `做一个 ${key}`, owner: null, needs: [], out_of_scope: null, ...extra }) as unknown as Blueprint["entries"][number]
const confirmed = (entries: Blueprint["entries"]) =>
  validateBlueprint({ request: "把苔叶鹿做完", style: { palette: [], shape: "", naming: "", world: "" }, entries: entries.map((value) => ({ ...value, asset_id: value.asset_id ?? null })), questions: [], revision: 1, state: "confirmed" }, TARGET)

test("手动做的生物、方块、物品列在 existing 里，带 hand 标记和怎么改的说明；有了资产的不再重复列", () => {
  const things = existingThings(base())
  expect(things.map((value) => [value.kind, value.title, value.hand])).toEqual([["entity", "苔叶鹿", true], ["block", "苔砖", true], ["item", "叶片护符", true]])
  expect(things[0]).toMatchObject({ id: deer.id })
  expect(things[0]!.note).toContain("还没有模型")
  // A creature with a model of its own says that, so the AI knows it is changing a model that is there.
  expect(existingThings(base(modelled()))[0]!.note).toContain("已经有模型")
  // Once a workspace model carries the creature's id, the model is listed as itself and the bare creature is not listed twice.
  const model = WorkspaceAssetSchema.parse({ id: deer.id, module: "model", title: "鹿模型", revision: 1, created_at: at, updated_at: at, prompt: "鹿", dependencies: [], document: { kind: "model", ...modelDesign() }, provenance: { model: null, request_id: null }, status: "ready" })
  const held = base({ workspace: { assets: [model] } })
  expect(existingThings(held).filter((value) => value.id === deer.id).map((value) => value.kind)).toEqual(["model"])
  // Content that has its asset is listed once, as the asset.
  expect(existingThings(mirrorContent(base(), new Set([block.id]))).filter((value) => value.id === block.id).map((value) => value.hand)).toEqual([undefined])
})

test("同名检查也看手动做的内容：同名新条目、说明里写着要改它都被退回并给出它的 id；change 放行，模型条目不能指生物", () => {
  const project = base()
  expect(existingRefusal(project, { entries: [entry("deer", "entity", { title: "苔叶鹿" })] })).toBe(EXISTING_REFUSALS.clash("苔叶鹿", { id: deer.id, kind: "entity", title: "苔叶鹿" }, "name"))
  expect(existingRefusal(project, { entries: [entry("deer", "entity", { title: "银鹿", brief: "把苔叶鹿改成银色的鹿。" })] })).toContain(deer.id)
  expect(existingRefusal(project, { entries: [entry("charm", "item", { title: "叶片护符" })] })).toContain(item.id)
  expect(existingRefusal(project, { entries: [entry("wall", "block", { title: "苔砖" })] })).toContain(block.id)
  // The same words for a different kind are no clash.
  expect(existingRefusal(project, { entries: [entry("deer_item", "item", { title: "苔叶鹿" })] })).toBeNull()
  expect(existingRefusal(project, { entries: [entry("deer", "entity", { title: "苔叶鹿", existing: { id: deer.id, action: "change" } })] })).toBeNull()
  expect(existingRefusal(project, { entries: [entry("charm", "item", { title: "叶片护符", existing: { id: item.id, action: "change" } })] })).toBeNull()
  expect(existingRefusal(project, { entries: [entry("deer", "entity", { title: "苔叶鹿", existing: { id: deer.id, action: "separate", why: "这是夜里才出现的另一种鹿" } })] })).toBeNull()
  // The model entry of the creature does not carry `existing`: it is told so, in the words for the AI.
  expect(existingRefusal(project, { entries: [entry("deer_model", "model", { title: "苔叶鹿的模型", existing: { id: deer.id, action: "change" } })] })).toBe(EXISTING_REFUSALS.creatureModel("苔叶鹿的模型", "苔叶鹿"))
})

test("生物做完以后，同一个计划再交一次（existing 还写着）不被退回，因为它的规则资产就是那只生物", () => {
  const rules = WorkspaceAssetSchema.parse({ id: uuid(), module: "entity", title: "苔叶鹿", revision: 1, created_at: at, updated_at: at, prompt: "鹿", dependencies: [], document: entityDocument(deer.id), provenance: { model: null, request_id: null }, status: "ready" })
  const blueprint = confirmed([entry("deer_model", "model", { owner: "deer", asset_id: deer.id }), entry("deer", "entity", { title: "苔叶鹿", needs: ["deer_model"], existing: { id: deer.id, action: "change" }, asset_id: rules.id })])
  const project = { ...base(), workspace: { assets: [rules] }, blueprint }
  expect(existingRefusal(project, { entries: [entry("deer", "entity", { title: "苔叶鹿", existing: { id: deer.id, action: "change" } })] })).toBeNull()
  // But an entry made as something else cannot be pointed at other content.
  expect(existingRefusal(project, { entries: [entry("deer", "entity", { title: "苔叶鹿", existing: { id: block.id, action: "change" } })] })).toContain("找不到这一样")
})

test("改手动做的生物：生物条目自己做新的规则资产，它需要的模型任务拿生物的 id；没有 rules 时和以前完全一样", () => {
  const blueprint = confirmed([
    entry("deer_model", "model", { title: "苔叶鹿的模型", owner: "deer" }),
    entry("deer", "entity", { title: "苔叶鹿", needs: ["deer_model"], existing: { id: deer.id, action: "change" } }),
    entry("fresh", "item"),
  ])
  const plan = nextBlueprintBatch(blueprint, [], [], new Set())!
  expect(plan.tasks.map((task) => [task.key, task.target_id])).toEqual([["deer_model", deer.id], ["deer", null], ["fresh", null]])
  expect(plan.tasks[0]!.prompt).toContain("手动做的生物「deer 标题」".replace("deer 标题", "苔叶鹿"))
  expect(plan.tasks[1]!.prompt).toContain(deer.id)
  expect(plan.tasks[2]!.prompt).not.toContain("手动做")
  // What the AI is told here carries no rule names.
  expect(leaked(plan.tasks.map((task) => task.prompt).join("\n"))).toEqual([])
  // An older caller that does not say what the workspace holds gets the plain reading: `existing` is an asset id.
  expect(nextBlueprintBatch(blueprint, [])!.tasks.map((task) => task.target_id)).toEqual([null, deer.id, null])
  // The production reading passes the assets: only a creature's rules asset makes an `existing` id an asset.
  const model = WorkspaceAssetSchema.parse({ id: deer.id, module: "model", title: "鹿模型", revision: 1, created_at: at, updated_at: at, prompt: "鹿", dependencies: [], document: { kind: "model", ...modelDesign() }, provenance: { model: null, request_id: null }, status: "ready" })
  const afterModel = { ...blueprint, entries: blueprint.entries.map((value) => (value.key === "deer_model" ? { ...value, asset_id: deer.id } : value)) }
  const second = nextProductionBatch({ blueprint: afterModel, assets: [model], runs: [], record: null })!
  expect(second.tasks.map((task) => [task.key, task.target_id])).toEqual([["deer", null], ["fresh", null]])
  // An entity entry that changes an asset-made creature still edits that asset.
  const made = confirmed([entry("deer_model", "model", { owner: "deer" }), entry("deer", "entity", { needs: ["deer_model"], existing: { id: model.id, action: "change" } })])
  const rules = WorkspaceAssetSchema.parse({ id: model.id, module: "entity", title: "鹿", revision: 1, created_at: at, updated_at: at, prompt: "鹿", dependencies: [model.id], document: entityDocument(model.id), provenance: { model: null, request_id: null }, status: "ready" })
  expect(nextProductionBatch({ blueprint: made, assets: [rules], runs: [], record: null })!.tasks.map((task) => task.target_id)).toEqual([null, model.id])
})

test("任务路由认手动做的内容：生物以模型任务为目标，方块物品以自己的种类；认不得的 id 照旧被退回", () => {
  const project = base()
  const legacy = legacyTargets(project)
  expect(legacy).toEqual([{ id: deer.id, module: "model" }, { id: block.id, module: "block" }, { id: item.id, module: "item" }])
  const route = (module: string, target_id: string) =>
    validateRoutePlan({ summary: "改", questions: [], tasks: [{ key: "t", module, title: "改", prompt: "改", source: "改一下", dependencies: [], target_id }] } as never, { prompt: "改一下", assets: [], legacy })
  expect(route("model", deer.id).tasks[0]!.target_id).toBe(deer.id)
  expect(route("item", item.id).tasks[0]!.target_id).toBe(item.id)
  expect(() => route("entity", deer.id)).toThrow("路由指向不存在或不同模块的资产")
  expect(() => route("model", uuid())).toThrow("路由指向不存在或不同模块的资产")
  expect(() => validateRoutePlan({ summary: "改", questions: [], tasks: [{ key: "t", module: "model", title: "改", prompt: "改", source: "改一下", dependencies: [], target_id: deer.id }] } as never, { prompt: "改一下", assets: [] })).toThrow()
})

test("总览如实说话：没有模型的生物不算做好，说清缺什么；有模型的才是做好了；被计划要改的只出现一次", () => {
  const input = (project: Project) => ({ project, runs: [], build: null, verification: null, production: null, producing: false })
  const view = buildProjectOverview(input(base()))
  const bare = view.items.find((value) => value.id === `entity:${deer.id}`)!
  expect(bare).toMatchObject({ status: "planned", status_label: "还没做", facts: { saved: false, built: false } })
  expect(bare.reason).toBe("「苔叶鹿」还没有模型：生物要先有模型，才能做进模组。")
  expect(view.production).toMatchObject({ total: 3, saved: 2 })
  const done = buildProjectOverview(input(base(modelled()))).items.find((value) => value.id === `entity:${deer.id}`)!
  expect(done).toMatchObject({ status: "saved", reason: null, facts: { saved: true } })
  // The plan entry that is to change it stands for it, until it is made.
  const blueprint = confirmed([entry("deer_model", "model", { title: "苔叶鹿的模型", owner: "deer" }), entry("deer", "entity", { title: "苔叶鹿", needs: ["deer_model"], existing: { id: deer.id, action: "change" } }), entry("charm", "item", { title: "叶片护符", existing: { id: item.id, action: "change" } })])
  const planned = buildProjectOverview(input({ ...base(), blueprint }))
  expect(planned.items.filter((value) => value.title === "苔叶鹿")).toHaveLength(1)
  expect(planned.items.filter((value) => value.title === "叶片护符")).toHaveLength(1)
  expect(planned.items.find((value) => value.title === "苔叶鹿")!.key).toBe("deer")
})

test("手动做的内容换成资产：方块物品得到同 id 的镜像资产；生物有模型时得到同 id 的模型资产，没有模型时什么也不加", async () => {
  const mirrored = mirrorContent(base(), new Set([block.id, item.id, deer.id]))
  expect(mirrored.workspace.assets.map((asset) => [asset.id, asset.module, asset.revision])).toEqual([[block.id, "block", 1], [item.id, "item", 1]])
  expect(mirrorContent(mirrored, new Set([block.id]))).toBe(mirrored)
  expect(legacyThings(mirrored).map((value) => value.id)).toEqual([deer.id])

  const directory = await mkdtemp(path.join(os.tmpdir(), "adopt-"))
  try {
    const created = await createProject({ directory, name: "收编", description: "" })
    const entity = createEntity({ name: "苔叶鹿" })
    const saved = await saveProject(directory, { ...created, entities: [entity] }, created.revision)
    // No model: nothing to adopt, and the same project comes back.
    expect(await adoptLegacy(directory, saved, [entity.id])).toBe(saved)
    const design = modelDesign()
    const put = await putModelAsset(directory, { entity_id: entity.id, data: { design, blockbench: {}, provenance: null }, origin: "manual", expectedRevision: saved.revision })
    const adopted = await adoptLegacy(directory, put.project, [entity.id])
    const model = adopted.workspace.assets.find((asset) => asset.id === entity.id)!
    expect(model).toMatchObject({ module: "model", status: "ready", revision: 1 })
    expect(model.document).toMatchObject({ kind: "model", name: design.name })
    // Adopting again changes nothing.
    expect((await adoptLegacy(directory, adopted, [entity.id])).workspace.assets).toHaveLength(1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("带 id 的错误码说成人话并点名；有办法到的话给出直达那张卡片的目标；不认识的原样放过", () => {
  const message = `SAVED_MODEL_REQUIRED:${deer.id}`
  expect(codedParts(message)).toEqual({ code: "SAVED_MODEL_REQUIRED", id: deer.id })
  expect(codedParts("SAVED_MODEL_REQUIRED")).toBeNull()
  expect(codedParts(`SOMETHING_ELSE:${deer.id}`)).toBeNull()
  const found = codedWords(message, (id) => (id === deer.id ? { kind: "entity", name: "苔叶鹿" } : null))!
  expect(found.text).toBe("「苔叶鹿」还没有模型，所以没有打包：生物要先有模型才能做进模组。打开它的卡片，让 AI 给它做模型，或者自己做一个，再打包。")
  expect(found.target).toEqual({ about: { kind: "entity", id: deer.id, name: "苔叶鹿" }, field: "", label: "打开「苔叶鹿」" })
  // The project cannot say which: still plain words, no way there.
  const unknown = codedWords(message, () => null)!
  expect(unknown.text).toContain("有一个生物还没有模型")
  expect(unknown.target).toBeNull()
  const play = codedWords(`GAMEPLAY_OUT_OF_BOUNDS:${item.id}`, () => ({ kind: "gameplay", name: "夜行" }))!
  expect(play.text).toContain("玩法「夜行」")
  expect(play.target?.about.kind).toBe("gameplay")
})

test("规划说明讲了手动做的内容怎么改，没有规则编号", () => {
  const text = blueprintPlannerInstructions(TARGET)
  expect(text).toContain("hand: true")
  expect(text).toContain("不会多出第二只")
  expect(leaked(text)).toEqual([])
})

test("再试一次的条目也认它要改的内容：改手动做的物品的条目没做成，再试时仍是在那个物品上改，不另做一个", () => {
  const blueprint = confirmed([entry("charm", "item", { title: "叶片护符", existing: { id: item.id, action: "change" } })])
  const again = redoBatch({ blueprint, assets: [], reviews: [], requests: [{ key: "charm", feedback: "亮一点", at: "2026-10-14T09:00:00.000Z" }], runs: [] })!
  expect(again.plan.tasks.map((task) => [task.key, task.target_id])).toEqual([["charm", item.id]])
  // A creature made by hand: the model entry takes the creature's id, its own entry makes the rules anew.
  const creature = confirmed([entry("deer_model", "model", { owner: "deer" }), entry("deer", "entity", { needs: ["deer_model"], existing: { id: deer.id, action: "change" } })])
  const first = redoBatch({ blueprint: creature, assets: [], reviews: [], requests: [{ key: "deer_model", feedback: "", at: "2026-10-14T09:00:00.000Z" }], runs: [] })!
  expect(first.plan.tasks.map((task) => [task.key, task.target_id])).toEqual([["deer_model", deer.id]])
})

function modelDesign() {
  return ModelDesignSchema.parse({
    name: "测试生物",
    texture_size: 64,
    bones: [{ name: "root", parent: null, pivot: [0, 8, 0], rotation: [0, 0, 0], cubes: [{ name: "body", origin: [-2, 4, -2], size: [4, 4, 4], faces: { north: "#aa6644", east: "#aa6644", south: "#aa6644", west: "#aa6644", up: "#ddaa77", down: "#664422" } }] }],
    animations: ["idle", "walk", "hurt"].map((name) => ({ name, length: 1, loop: name !== "hurt", channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [0, 0, 0] }] }] })),
  })
}

function entityDocument(modelId: string) {
  return { kind: "entity", name: "苔叶鹿", description: "", health: 14, speed: 0.25, attack_damage: 2, behavior: "passive", model_asset_id: modelId, runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null } }
}
