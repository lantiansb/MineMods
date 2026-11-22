import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  blueprintFromConception,
  blueprintNeedAssetIds,
  blueprintSource,
  blueprintTaskSources,
  BlueprintSchema,
  confirmBlueprint,
  linkBlueprintEntry,
  linkBlueprintTask,
  nextBlueprintBatch,
  replaceBlueprint,
  validateBlueprint,
  type BlueprintDraft,
} from "../src/blueprint"
import { ProjectSchema } from "../src/project"
import { applyContent } from "../src/workspace"
import { PROJECT_RUN_LIMITS, RouteTaskSchema, validateRoutePlan } from "../src/workspace-runs"

const legacy = async () => ProjectSchema.parse(JSON.parse(await readFile(path.join(import.meta.dir, "fixtures", "pre-0a", "project.json"), "utf8")))
const style = { palette: ["#335533", "#88aa66"], shape: "圆润、矮胖", naming: "中文名加英文标识", world: "潮湿的北方森林" }
const entry = (key: string, kind: string, extra: Record<string, unknown> = {}) => ({ key, kind, title: `${key} 标题`, brief: `${key} 说明`, owner: null, needs: [], out_of_scope: null, ...extra })
const draft = (entries: unknown[]) => ({ request: "做一个苔原模组", style, entries, questions: [] }) as BlueprintDraft
const creature = [
  entry("fox_model", "model", { owner: "fox" }),
  entry("fox_skin", "texture", { owner: "fox", needs: ["fox_model"] }),
  entry("fox", "entity", { needs: ["fox_model", "fox_skin"] }),
  entry("fox_look", "logic", { owner: "fox", needs: ["fox_model"] }),
]
const stored = (entries: unknown[]) => ({ ...draft(entries), revision: 1, state: "draft", entries: (entries as Record<string, unknown>[]).map((value) => ({ ...value, asset_id: null })) })

test("the stored shape is strictly bounded", () => {
  expect(BlueprintSchema.safeParse(stored(creature)).success).toBe(true)
  expect(BlueprintSchema.safeParse({ ...stored(creature), extra: true }).success).toBe(false)
  expect(BlueprintSchema.safeParse({ ...stored(creature), style: { ...style, palette: Array(13).fill("#000000") } }).success).toBe(false)
  expect(BlueprintSchema.safeParse({ ...stored(creature), style: { ...style, palette: ["red"] } }).success).toBe(false)
  expect(BlueprintSchema.safeParse(stored(Array.from({ length: 201 }, (_, index) => entry(`item_${index}`, "item")))).success).toBe(false)
  expect(BlueprintSchema.safeParse(stored([entry("spell", "spell")])).success).toBe(false)
  expect(BlueprintSchema.safeParse(stored([entry("Bad Key", "item")])).success).toBe(false)
  expect(BlueprintSchema.safeParse(stored([entry("item", "item", { brief: "x".repeat(4001) })])).success).toBe(false)
})

test("蓝图和任务单个条目都能持有 64 项依赖", () => {
  const keys = Array.from({ length: 65 }, (_, index) => `sound_${index}`)
  const assets = keys.map((key) => entry(key, "sound"))
  const blueprint = (needs: string[]) => stored([...assets, entry("creature", "entity", { needs })])
  expect(BlueprintSchema.safeParse(blueprint(keys.slice(1))).success).toBe(true)
  expect(BlueprintSchema.safeParse(blueprint(keys)).success).toBe(false)
  const task = { key: "creature", module: "entity", title: "石卫", prompt: "做石卫", source: "做石卫", target_id: null }
  expect(RouteTaskSchema.safeParse({ ...task, dependencies: keys.slice(1) }).success).toBe(true)
  expect(RouteTaskSchema.safeParse({ ...task, dependencies: keys }).success).toBe(false)
})

test("validation rejects what the registry and the target cannot honour", () => {
  const check = (entries: unknown[]) => () => validateBlueprint(stored(entries), "fabric-1.21.1")
  expect(check(creature)).not.toThrow()
  expect(check([entry("a", "item"), entry("a", "block")])).toThrow("重复")
  expect(check([entry("a", "item", { owner: "ghost" })])).toThrow("所属的内容不存在")
  expect(check([entry("m", "model"), entry("a", "item", { owner: "m" })])).toThrow("所属的内容不存在")
  // A thing that names itself as its owner is told exactly that, and what owner is for.
  expect(check([entry("a", "entity", { owner: "a" })])).toThrow("的 owner 写的是它自己：一样东西不能属于它自己。owner 是给部件用的——模型、贴图、玩法这些属于某个生物、方块或物品的，才写那样东西的 key；生物、方块、物品自己通常不属于谁，owner 填 null。")
  expect(check([entry("m", "model", { owner: "m" })])).toThrow("它不属于别的东西时，owner 填 null。")
  expect(check([entry("a", "recipe", { needs: ["ghost"] })])).toThrow("依赖了不存在的条目")
  expect(check([entry("a", "recipe", { needs: ["a"] })])).toThrow("依赖了不存在的条目")
  // Kinds may only need what their references allow, and required references must be planned.
  expect(check([entry("i", "item"), entry("m", "model", { needs: ["i"] })])).toThrow("不能依赖")
  expect(check([entry("fox", "entity")])).toThrow("必须依赖一个模型条目")
  // Honest capability: a kind the target cannot build has to say so and is not made.
  expect(check([entry("lore", "worldview")])).toThrow("做不进游戏")
  expect(check([entry("dance", "animation")])).toThrow("做不进游戏")
  expect(check([entry("lore", "worldview", { out_of_scope: "只能保存为设计稿" })])).not.toThrow()
  expect(check([entry("lore", "worldview", { out_of_scope: "只能保存为设计稿" }), entry("i", "item", { needs: ["lore"] })])).toThrow("依赖了不制作的")
  // Today's kinds cannot legally form a loop, so the loop check runs first and is what a looping plan hits.
  expect(check([entry("a", "texture", { needs: ["b"] }), entry("b", "texture", { needs: ["a"] })])).toThrow("绕成了一个圈")
  const id = crypto.randomUUID()
  expect(() => validateBlueprint({ ...stored([]), entries: [{ ...entry("a", "item"), asset_id: id }, { ...entry("b", "item"), asset_id: id }] }, "fabric-1.21.1")).toThrow("同一个")
})

test("replace bumps the revision, returns to draft and keeps links by key and kind; confirm needs the shown revision", async () => {
  const project = await legacy()
  const first = replaceBlueprint(project, draft([entry("box", "block"), entry("dew", "item"), ...creature]))
  expect(first.blueprint).toMatchObject({ revision: 1, state: "draft", request: "做一个苔原模组" })
  expect(ProjectSchema.safeParse(first).success).toBe(true)
  expect(() => confirmBlueprint(project, 1)).toThrow("还没有蓝图")
  expect(() => confirmBlueprint(first, 2)).toThrow("请先查看最新版本")
  const confirmed = confirmBlueprint(first, 1)
  expect(confirmed.blueprint).toMatchObject({ revision: 1, state: "confirmed" })
  const block = project.workspace.assets.find((asset) => asset.module === "block")!
  const item = project.workspace.assets.find((asset) => asset.module === "item")!
  expect(() => linkBlueprintEntry(confirmed, "box", item.id)).toThrow("种类和条目不一致")
  expect(() => linkBlueprintEntry(confirmed, "ghost", block.id)).toThrow("没有这个条目")
  const linked = linkBlueprintEntry(linkBlueprintEntry(confirmed, "box", block.id), "dew", item.id)
  expect(linked.blueprint).toMatchObject({ revision: 1, state: "confirmed" })
  // "dew" changes kind, so it is a different thing and loses its asset; "box" is kept.
  const second = replaceBlueprint(linked, draft([entry("box", "block", { brief: "新的说明" }), entry("dew", "block")]))
  expect(second.blueprint).toMatchObject({ revision: 2, state: "draft" })
  expect(second.blueprint!.entries.map((value) => value.asset_id)).toEqual([block.id, null])
  expect(project.blueprint).toBeUndefined()
})

test("conception entries map onto a valid draft blueprint and the conception is left alone", async () => {
  const project = await legacy()
  const next = blueprintFromConception(project)
  expect(next.conception).toEqual(project.conception)
  expect(next.blueprint).toMatchObject({ revision: 1, state: "draft", request: "潮湿森林里的苔皮生物" })
  expect(next.blueprint!.style.world).toBe("先做生物再做秘匣")
  const entries = Object.fromEntries(next.blueprint!.entries.map((value) => [value.key, value]))
  expect(Object.keys(entries)).toEqual(["moss_creeper_model", "moss_creeper", "mystery_box", "box_recipe"])
  // A creature is planned as its model plus its rules, linked to what already exists.
  expect(entries.moss_creeper_model).toMatchObject({ kind: "model", owner: "moss_creeper", asset_id: project.entities[0]!.id })
  expect(entries.moss_creeper).toMatchObject({ kind: "entity", needs: ["moss_creeper_model"], asset_id: project.workspace.assets.find((asset) => asset.module === "entity")!.id })
  expect(entries.mystery_box).toMatchObject({ kind: "block", asset_id: null, out_of_scope: null })
  expect(ProjectSchema.safeParse(next).success).toBe(true)
  const world = { ...project, conception: { ...project.conception, entries: [{ ...project.conception.entries[1]!, kind: "biome" as const, key: "苔原 Biome" }] } }
  const mapped = blueprintFromConception(ProjectSchema.parse(world)).blueprint!.entries[0]!
  expect(mapped.key).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
  expect(mapped.out_of_scope).toBe("目前只能保存为设计稿，做不进游戏。")
})

test("batches follow dependency order, stop at the run limit and continue from what is done", async () => {
  const project = await legacy()
  const many = [...creature, ...Array.from({ length: 14 }, (_, index) => entry(`item_${index}`, "item")), entry("lore", "worldview", { out_of_scope: "只能保存为设计稿" })]
  const planned = replaceBlueprint(project, draft([entry("recipe_last", "recipe", { needs: ["item_13"] }), ...many]))
  expect(() => nextBlueprintBatch(planned.blueprint!, [])).toThrow("还没有确认")
  const blueprint = confirmBlueprint(planned, 1).blueprint!
  const first = nextBlueprintBatch(blueprint, [])!
  expect(first.tasks).toHaveLength(PROJECT_RUN_LIMITS.tasks)
  expect(first.tasks.map((task) => task.key).slice(0, 4)).toEqual(["fox_model", "fox_skin", "fox", "fox_look"])
  expect(first.tasks.find((task) => task.key === "fox")).toMatchObject({ module: "entity", source: "blueprint:fox", dependencies: ["fox_model", "fox_skin"], target_id: null })
  expect(first.tasks[0]!.prompt).toContain("fox_model 说明")
  expect(first.tasks[0]!.prompt).toContain("造型：圆润、矮胖")
  expect(first.tasks.some((task) => task.key === "lore" || task.key === "recipe_last")).toBe(false)
  // The plan is a valid route plan only because its sources name entries of the confirmed blueprint.
  const sources = blueprintTaskSources(blueprint)
  expect(sources.some((source) => source.key === "lore")).toBe(false)
  expect(validateRoutePlan(first, { prompt: blueprint.request, assets: [], blueprint: sources }).tasks).toHaveLength(12)
  expect(() => validateRoutePlan(first, { prompt: blueprint.request, assets: [] })).toThrow("任务没有对应的原始需求")
  expect(() => validateRoutePlan(first, { prompt: blueprint.request, assets: [], blueprint: blueprintTaskSources(planned.blueprint) })).toThrow("任务没有对应的原始需求")
  expect(() => validateRoutePlan({ ...first, tasks: [{ ...first.tasks[0]!, module: "item" }] }, { prompt: blueprint.request, assets: [], blueprint: sources })).toThrow("任务没有对应的原始需求")
  const done = first.tasks.map((task) => task.key)
  const second = nextBlueprintBatch(blueprint, done)!
  expect(second.tasks.map((task) => task.key)).toEqual(["item_8", "item_9", "item_10", "item_11", "item_12", "item_13", "recipe_last"])
  expect(second.tasks.at(-1)).toMatchObject({ key: "recipe_last", dependencies: ["item_13"] })
  expect(nextBlueprintBatch(blueprint, [...done, ...second.tasks.map((task) => task.key)])).toBeNull()
})

test("a need finished in an earlier batch is handed over by asset id instead of as a task dependency", async () => {
  const project = await legacy()
  const model = project.workspace.assets.find((asset) => asset.module === "model")!
  const confirmed = confirmBlueprint(replaceBlueprint(project, draft(creature)), 1)
  const linked = linkBlueprintEntry(confirmed, "fox_model", model.id)
  const batch = nextBlueprintBatch(linked.blueprint!, ["fox_model"])!
  const skin = batch.tasks.find((task) => task.key === "fox_skin")!
  expect(skin.dependencies).toEqual([])
  expect(skin.prompt).toContain(model.id)
  expect(blueprintNeedAssetIds(linked.blueprint, skin.source)).toEqual([model.id])
  expect(blueprintNeedAssetIds(linked.blueprint, "做一张贴图")).toEqual([])
  expect(blueprintNeedAssetIds(undefined, skin.source)).toEqual([])
  // Redoing a finished entry edits the asset it already has.
  expect(nextBlueprintBatch(linked.blueprint!, [])!.tasks.find((task) => task.key === "fox_model")!.target_id).toBe(model.id)
})

test("saving a task made from an entry links the entry; other tasks and stale entries are left alone", async () => {
  const project = await legacy()
  const block = project.workspace.assets.find((asset) => asset.module === "block")!
  const item = project.workspace.assets.find((asset) => asset.module === "item")!
  const confirmed = confirmBlueprint(replaceBlueprint(project, draft([entry("box", "block"), entry("dew", "item")])), 1)
  const linked = linkBlueprintTask(confirmed, { source: blueprintSource("box"), module: "block" }, block.id)
  expect(linked.blueprint!.entries.find((value) => value.key === "box")!.asset_id).toBe(block.id)
  expect(ProjectSchema.safeParse(linked).success).toBe(true)
  expect(linkBlueprintTask(confirmed, { source: "创建秘匣", module: "block" }, block.id)).toBe(confirmed)
  expect(linkBlueprintTask(confirmed, { source: blueprintSource("gone"), module: "block" }, block.id)).toBe(confirmed)
  expect(linkBlueprintTask(confirmed, { source: blueprintSource("box"), module: "item" }, item.id)).toBe(confirmed)
  expect(linkBlueprintTask(project, { source: blueprintSource("box"), module: "block" }, block.id)).toBe(project)
  // Deleting the content in the editor clears the link instead of leaving it pointing at nothing.
  const deleted = applyContent(linkBlueprintTask(linked, { source: blueprintSource("dew"), module: "item" }, item.id), { blocks: project.blocks, items: [], recipes: [], logic: project.logic })
  expect(deleted.blueprint!.entries.map((value) => value.asset_id)).toEqual([block.id, null])
})

// Round 10 (J1)
test("a creature may need the thing it drops, and is then made after it: the order comes from the plan, not from luck", async () => {
  const project = await legacy()
  const entries = [entry("golem", "entity", { needs: ["golem_model", "core"] }), entry("golem_model", "model", { owner: "golem" }), entry("core", "item"), entry("pick", "item", { needs: ["core"] })]
  // Before the references table knew that a creature's loot names an item, this plan was refused: 「是生物，不能依赖物品」.
  const blueprint = confirmBlueprint(replaceBlueprint(project, draft(entries)), 1).blueprint!
  const first = nextBlueprintBatch(blueprint, [])!
  expect(first.tasks.map((task) => task.key)).toEqual(["golem_model", "core", "golem", "pick"])
  expect(first.tasks.find((task) => task.key === "golem")).toMatchObject({ module: "entity", dependencies: ["golem_model", "core"] })
  // Made in an earlier batch, the item is handed to the creature's task by its asset id, and becomes a dependency of the saved creature.
  const core = project.workspace.assets.find((asset) => asset.module === "item")!
  const linked = linkBlueprintEntry({ ...project, blueprint }, "core", core.id).blueprint!
  expect(blueprintNeedAssetIds(linked, blueprintSource("golem"))).toEqual([core.id])
  // What a kind cannot point at is still refused in the same words (an item may be held as a model of the project, but it has no texture of its own).
  expect(() => validateBlueprint(BlueprintSchema.parse(stored([entry("core", "item", { needs: ["golem_tex"] }), entry("golem_tex", "texture")])), "fabric-1.21.1")).toThrow("「core 标题」是物品，不能依赖贴图「golem_tex 标题」。")
})
