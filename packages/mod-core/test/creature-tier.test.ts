import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { BlueprintDraftSchema, BlueprintSchema, nextBlueprintBatch, validateBlueprint, blueprintTaskPrompt, TASK_PROMPT_HEADINGS, type BlueprintDraft } from "../src/blueprint"
import { blueprintPlannerInstructions, blueprintPlanJsonSchema } from "../src/blueprint-planner"
import { redoRemark } from "../src/blueprint-production"
import { CREATURE_TIER_CAPABILITY, CREATURE_TIERS, CREATURE_TIER_LEVELS, CreatureTierSchema, DETAIL_WORDS, detailFor, detailForModel, effectiveDetail, governing, settleTiers, sixViewStyleFor, sizeNextToPlayer, TIER_HEADING, tierBudgetKept, tierBudgetRefusal, tierOf, tierReviewOf, tierTaskLines, type CreatureTier } from "../src/creature-tier"
import { MODEL_COMPLEXITY_PRESETS, modelComplexityInstructions, type ModelComplexity } from "@minemods/studio-ai/model-quality"
import { AbilitySchema } from "../src/entity-runtime"
import { ProjectSchema, type Project } from "../src/project"
import { reconcile } from "../src/reconcile"
import { golemAbilities } from "../script/data-gameplay-sample"

const TARGET = "fabric-1.21.1"
const style = { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" }
type Tiered = { key: string; kind: string; title: string; owner: null; tier?: CreatureTier }
const tier = (level: CreatureTier["level"], extra: Partial<CreatureTier> = {}): CreatureTier => ({ level, reason: `你说了要${level}`, by: "ai", ...extra })
const entry = (key: string, kind: string, extra: Record<string, unknown> = {}) => ({ key, kind, title: `${key} 标题`, brief: `${key} 说明`, owner: null, needs: [], out_of_scope: null, ...extra })
const creature = (extra: Record<string, unknown> = {}) => [
  entry("fox_model", "model", { owner: "fox" }),
  entry("fox_skin", "texture", { owner: "fox", needs: ["fox_model"] }),
  entry("fox", "entity", { needs: ["fox_model", "fox_skin"], ...extra }),
]
const stored = (entries: unknown[], state = "draft") => ({ request: "做一只狐狸", style, questions: [], revision: 1, state, entries: (entries as Record<string, unknown>[]).map((value) => ({ ...value, asset_id: null })) })
const blueprint = (entries: unknown[], state = "confirmed") => validateBlueprint(stored(entries, state), TARGET)

test("only a creature entry may carry a tier; its shape is strict; one without a tier is standard", () => {
  expect(() => blueprint(creature({ tier: tier("fine") }))).not.toThrow()
  // Not a creature: refused, and the reason is said in words (the entry's title is in it).
  const refused = (entries: unknown[]) => { try { blueprint(entries); return "accepted" } catch (error) { return (error as Error).message } }
  expect(refused([entry("gem", "item", { tier: tier("boss") })])).toBe("「gem 标题」不是生物，不能定档位：档位只给生物条目（简单、标准、精细、Boss、史诗）。")
  expect(refused(creature().map((value) => (value.key === "fox_model" ? { ...value, tier: tier("fine") } : value)))).toContain("不是生物，不能定档位")
  expect(CreatureTierSchema.safeParse(tier("fine")).success).toBe(true)
  for (const bad of [{ ...tier("fine"), level: "huge" }, { ...tier("fine"), by: "robot" }, { ...tier("fine"), reason: " " }, { ...tier("fine"), extra: 1 }, { level: "fine", by: "ai" }])
    expect(CreatureTierSchema.safeParse(bad).success).toBe(false)
  // Old blueprints have no tier at all: they open, they validate, and they mean standard.
  expect(BlueprintSchema.safeParse(stored(creature())).success).toBe(true)
  expect(() => blueprint(creature())).not.toThrow()
  expect(tierOf({}).level).toBe("standard")
  expect(tierOf(undefined).level).toBe("standard")
  expect(tierOf({ tier: tier("boss") }).level).toBe("boss")
  // What a planner is asked for lists it, and a draft keeps it through the schema.
  expect(JSON.stringify(blueprintPlanJsonSchema())).toContain("reason")
  const kept = BlueprintDraftSchema.parse({ request: "x", style, questions: [], entries: creature({ tier: tier("fine") }) } as BlueprintDraft)
  expect(kept.entries.find((value) => value.key === "fox")!.tier).toEqual(tier("fine"))
})

test("the public table says what each tier asks, from the spec", () => {
  expect(Object.values(CREATURE_TIERS).map((row) => [row.level, row.budget, row.complexity, row.death, row.attack, row.abilities, row.relaxes])).toEqual([
    ["simple", "standard", "low", false, false, 0, true],
    ["standard", "standard", "low", false, false, 0, true],
    ["fine", "fine", "high", true, true, 0, false],
    ["boss", "finest", "high", true, true, 2, false],
    ["epic", "epic", "high", true, true, 3, false],
  ])
  // 10-12 epic: the six views before anything, a hitbox of parts, and the strongest model said to both windows.
  expect(CREATURE_TIER_CAPABILITY.tiers.epic).toMatchObject({ geometry_budget: "epic", six_views_required: true, hitbox_required: true, recommended_models: expect.stringContaining("GPT 6 Astra") })
  expect(Object.values(CREATURE_TIERS).filter((row) => row.sixViewsRequired || row.hitbox || row.models).map((row) => row.level)).toEqual(["epic"])
  expect(CREATURE_TIER_CAPABILITY.tiers.boss).toMatchObject({ geometry_budget: "finest", required_clips: ["idle", "walk", "hurt", "death"], min_abilities_when_hostile: 2, review_relaxed_by_simple_wording: false })
  expect(CREATURE_TIER_CAPABILITY.tiers.simple).toMatchObject({ required_clips: ["idle", "walk", "hurt"], review_relaxed_by_simple_wording: true })
})

test("the planner is told how to choose a tier, to write by ai, and to keep the person's own", () => {
  const text = blueprintPlannerInstructions(TARGET)
  expect(text).toContain("12. 生物档位")
  for (const word of ["史诗", "超巨型", "最终考验", "Boss", "首领", "最终", "霸主", "精细", "高质量", "细节", "大型", "简单", "低模", 'by 一律写 "ai"', "questions", '输入的 current 里 by 为 "you" 的 tier 是用户自己选的，原样保留'])
    expect(text).toContain(word)
})

test("a task for a creature and for its model is told the tier; others and old blueprints are told nothing", () => {
  const plan = blueprint(creature({ tier: tier("fine", { reason: "你说了『精细的大狐狸』" }) }))
  const [model, , fox] = ["fox_model", "fox_skin", "fox"].map((key) => plan.entries.find((value) => value.key === key)!)
  const finished = new Set<string>()
  const forModel = blueprintTaskPrompt(plan, model!, finished)
  const forFox = blueprintTaskPrompt(plan, fox!, finished)
  for (const text of [forModel, forFox]) {
    expect(text).toContain(TIER_HEADING)
    expect(text).toContain("档位：「精细」（fine）")
    expect(text).toContain("你说了『精细的大狐狸』")
    expect(text).toContain("倒下（death）")
    expect(text).toContain("第一版就要把细节做好")
    expect(text).toContain("验收不会因为任务文字里出现「简单」而放宽")
  }
  // The model is told which budget its part sheet names, and to ask for the six views; the creature's own rules are not.
  expect(forModel).toContain('部件说明的 budget 至少写 "fine"')
  expect(forModel).toContain("六视图")
  expect(forModel).toContain("生物「fox 标题」的档位")
  expect(forFox).not.toContain("部件说明的 budget")
  // A texture, and a creature with no tier, get no tier text.
  expect(blueprintTaskPrompt(plan, plan.entries.find((value) => value.key === "fox_skin")!, finished)).not.toContain(TIER_HEADING)
  const old = blueprint(creature())
  expect(old.entries.map((value) => blueprintTaskPrompt(old, value, finished)).join("\n")).not.toContain(TIER_HEADING)
  // The person's own pick is said as theirs; a boss asks for the finest budget and its abilities.
  const mine = blueprint(creature({ tier: tier("boss", { by: "you", reason: "你选的" }) }))
  const bossModel = blueprintTaskPrompt(mine, mine.entries[0]!, finished)
  expect(bossModel).toContain("这是用户自己选的")
  expect(bossModel).toContain('部件说明的 budget 至少写 "finest"')
  expect(bossModel).toContain("至少要有 2 个招式")
  // broad5 w2: its moves are planned with the model, each with a windup and a held hit; a fine creature with no moves is not told so.
  expect(bossModel).toContain("打到底的姿势停住一小下")
  expect(forModel).not.toContain("打到底的姿势停住一小下")
  // A standard tier asks for no more than idle, walk and hurt and no higher budget.
  const plain = blueprint(creature({ tier: tier("standard") }))
  const plainModel = blueprintTaskPrompt(plain, plain.entries[0]!, finished)
  expect(plainModel).toContain("不用特意写高一档")
  expect(plainModel).not.toContain("倒下（death）")
  expect(plainModel).not.toContain("六视图")
  expect(plainModel).not.toContain("验收不会因为")
  // Batches carry it too, and a redo's remark still ends where the tier text begins.
  const batch = nextBlueprintBatch(plan, [])!
  expect(batch.tasks.find((task) => task.key === "fox_model")!.prompt).toContain(TIER_HEADING)
  expect(TASK_PROMPT_HEADINGS).toContain(TIER_HEADING)
  const redo = `${forModel.split("\n")[0]}\n\n玩家看过现在这一版，说：\n太方了\n请在现有文档的基础上照这个意见重做，没有被提到的地方保持不变。\n\n${TIER_HEADING}\n- 档位：…`
  expect(redoRemark(redo)).toBe("太方了")
})

test("a part sheet below the tier's geometry budget is refused in words that name the blueprint", () => {
  const plan = (level: CreatureTier["level"]) => blueprint(creature({ tier: tier(level) })).entries
  expect(tierBudgetRefusal(plan("fine"), "fox_model", "standard")).toContain("蓝图上把「fox 标题」定为「精细」档")
  expect(tierBudgetRefusal(plan("fine"), "fox_model", undefined)).toContain("现在没有写")
  expect(tierBudgetRefusal(plan("fine"), "fox_model", "fine")).toBeNull()
  expect(tierBudgetRefusal(plan("fine"), "fox_model", "finest")).toBeNull()
  expect(tierBudgetRefusal(plan("boss"), "fox_model", "fine")).toContain('至少要写 "finest"')
  expect(tierBudgetRefusal(plan("boss"), "fox_model", "finest")).toBeNull()
  // Nothing is asked for simple and standard, for old creatures, for what is not a model, or for something the blueprint does not name.
  for (const level of ["simple", "standard"] as const) expect(tierBudgetRefusal(plan(level), "fox_model", undefined)).toBeNull()
  expect(tierBudgetRefusal(blueprint(creature()).entries, "fox_model", undefined)).toBeNull()
  expect(tierBudgetRefusal(plan("boss"), "fox", undefined)).toBeNull()
  expect(tierBudgetRefusal(plan("boss"), "fox_skin", undefined)).toBeNull()
  expect(tierBudgetRefusal(plan("boss"), "ghost", undefined)).toBeNull()
  expect(governing(plan("boss"), "fox_skin")?.key).toBe("fox")
  expect(tierTaskLines(plan("boss"), "ghost")).toEqual([])
})

test("an AI's plan cannot speak for the person: its you is its own, and the person's pick is kept", () => {
  const held = [entry("fox", "entity", { tier: tier("boss", { by: "you", reason: "你选的" }) }), entry("wolf", "entity", { tier: tier("fine") }), entry("owl", "entity")] as never[]
  const written = (tiers: Record<string, CreatureTier | undefined>) => ["fox", "wolf", "owl", "bat"].map((key) => entry(key, "entity", tiers[key] ? { tier: tiers[key] } : {})) as never[]
  const settled = (entries: never[]) => Object.fromEntries(settleTiers(entries as Tiered[], held).map((value) => [value.key, value.tier]))
  // The person's tier stays when the AI changes it, drops it, or writes the same level again.
  expect(settled(written({ fox: tier("simple") })).fox).toEqual(tier("boss", { by: "you", reason: "你选的" }))
  expect(settled(written({})).fox).toEqual(tier("boss", { by: "you", reason: "你选的" }))
  expect(settled(written({ fox: tier("boss", { by: "you", reason: "AI 抄的" }) })).fox).toEqual(tier("boss", { by: "you", reason: "你选的" }))
  // Where the person chose nothing, "you" in an AI's hand becomes "ai", including for a level the person chose for another creature.
  expect(settled(written({ wolf: tier("boss", { by: "you" }), owl: tier("fine", { by: "you" }), bat: tier("simple", { by: "you" }) }))).toMatchObject({ wolf: { level: "boss", by: "ai" }, owl: { level: "fine", by: "ai" }, bat: { level: "simple", by: "ai" } })
  // The AI's own choice is the AI's to change.
  expect(settled(written({ wolf: tier("simple") })).wolf).toEqual(tier("simple"))
  expect(settled(written({})).wolf).toBeUndefined()
  // No held plan at all: everything the AI wrote as the person's becomes its own.
  expect(settleTiers([entry("fox", "entity", { tier: tier("fine", { by: "you" }) })] as unknown as Tiered[], undefined)[0]!.tier!.by).toBe("ai")
})

// ---- reconcile ----

async function fixture() {
  const project = ProjectSchema.parse(JSON.parse(await readFile(path.join(import.meta.dir, "fixtures", "pre-0a", "project.json"), "utf8")))
  const entity = project.entities[0]!
  return { project, entity }
}
const withTier = (project: Project, entity: Project["entities"][number], level: CreatureTier["level"] | null, change: Partial<Project["entities"][number]> = {}, state = "confirmed") => {
  const entries = [
    { ...entry("beast_model", "model", { owner: "beast" }), asset_id: entity.id },
    { ...entry("beast", "entity", { needs: ["beast_model"], ...(level ? { tier: tier(level) } : {}) }), asset_id: null },
  ]
  return { ...project, entities: [{ ...entity, runtime: { ...entity.runtime!, explosion: null }, ...change }], blueprint: { ...stored([]), state, entries } } as Project
}
const tierFindings = (project: Project, entity: Project["entities"][number], clips: string[]) => reconcile(project, { animations: { [entity.id]: clips } }).filter((finding) => finding.rule === "tier_motions")
const BASE = ["idle", "walk", "hurt"]

test("reconciliation says when a fine or boss creature's model lacks what its tier needs, and never stops the build", async () => {
  const { project, entity } = await fixture()
  const [slam, burst] = golemAbilities.map((ability) => AbilitySchema.parse(ability))
  // 精细: death, and attack for one that hits with its own body and has no abilities.
  const fine = tierFindings(withTier(project, entity, "fine"), entity, BASE)
  expect(fine).toHaveLength(1)
  expect(fine[0]).toMatchObject({ rule: "tier_motions", stops: false, about: { kind: "entity", id: entity.id, name: entity.name } })
  expect(fine[0]!.text).toBe(`蓝图上定的是「精细」档，可是「${entity.name}」的模型里没有：倒下（death）、攻击（attack）。`)
  expect(fine[0]!.fix).toContain("名叫 death 的动作")
  expect(fine[0]!.fix).toContain("名叫 attack 的动作")
  // Only what is missing is named.
  expect(tierFindings(withTier(project, entity, "fine"), entity, [...BASE, "death"])[0]!.text).toBe(`蓝图上定的是「精细」档，可是「${entity.name}」的模型里没有：攻击（attack）。`)
  expect(tierFindings(withTier(project, entity, "fine"), entity, [...BASE, "death", "attack"])).toEqual([])
  // A creature that does not hit with its body (passive) or that fights with abilities does not need an attack motion.
  expect(tierFindings(withTier(project, entity, "fine", { behavior: "passive" }), entity, [...BASE, "death"])).toEqual([])
  expect(tierFindings(withTier(project, entity, "fine", { abilities: [slam!, burst!] }), entity, [...BASE, "death"])).toEqual([])
  // Boss: a hostile one with fewer than two abilities is told so; with two (and their motions) it is complete.
  const boss = tierFindings(withTier(project, entity, "boss", { abilities: [slam!] }), entity, [...BASE, "death", slam!.clip])
  expect(boss).toHaveLength(1)
  expect(boss[0]!.text).toBe(`蓝图上定的是「Boss」档，可是「${entity.name}」的招式只有 1 个，这一档的敌对生物至少要有 2 个。`)
  expect(tierFindings(withTier(project, entity, "boss", { abilities: [slam!, burst!] }), entity, [...BASE, "death", slam!.clip, burst!.clip])).toEqual([])
  expect(tierFindings(withTier(project, entity, "boss", { behavior: "passive" }), entity, [...BASE, "death"])).toEqual([])
  const both = tierFindings(withTier(project, entity, "boss"), entity, BASE)[0]!
  expect(both.text).toBe(`蓝图上定的是「Boss」档，可是「${entity.name}」的模型里没有：倒下（death）、攻击（attack）；它的招式只有 0 个，这一档的敌对生物至少要有 2 个。`)
  // Standard, simple, no tier at all, and a plan not yet confirmed ask nothing.
  for (const level of ["standard", "simple", null] as const) expect(tierFindings(withTier(project, entity, level), entity, BASE)).toEqual([])
  expect(tierFindings(withTier(project, entity, "boss", {}, "draft"), entity, BASE)).toEqual([])
})

test("10-12 epic: what the spec calls required stops the build, the rest is only said, and the other tiers never stop", async () => {
  const { project, entity } = await fixture()
  const [slam] = golemAbilities.map((ability) => AbilitySchema.parse(ability))
  const all = (level: CreatureTier["level"], change: Partial<Project["entities"][number]> = {}) =>
    reconcile(withTier(project, entity, level, change), { animations: { [entity.id]: BASE } }).filter((finding) => finding.rule.startsWith("tier_"))
  // An epic hostile creature with none of it: the motions, the abilities and the hitbox are 必须 and stop; the Boss part is said and does not.
  const epic = all("epic")
  expect(epic.map((finding) => [finding.rule, finding.stops]).sort()).toEqual([["tier_boss", true], ["tier_motions", true], ["tier_steady", false]])
  for (const level of ["epic", "boss"] as const) {
    expect(all(level).filter(f => f.stops && f.rule.startsWith("tier_")).map(f => f.rule)).not.toContain("tier_steady")
    expect(all(level, { justified: [{ what: "steady", reason: "转身灵活的飞鸟" }] }).some(f => f.rule === "tier_steady")).toBe(false)
  }
  const motions = epic.find((finding) => finding.rule === "tier_motions")!
  expect(motions.fix).toContain("补齐以后才能打包")
  expect(motions.fix).not.toContain("不补也能打包")
  expect(motions.text).toContain("它的招式只有 0 个，这一档的敌对生物至少要有 3 个")
  const boxed = epic.find((finding) => finding.rule === "tier_boss")!
  expect(boxed.text).toContain("没有分部位的碰撞箱")
  expect(boxed.fix).toContain("碰撞箱必须补上才能打包")
  // The Boss part of it, which the spec's list for the tier does not call 必须, may be left: the fix says so, and says what is then missing instead of what the creature "is not".
  expect(boxed.fix).toContain("其余的不补也能打包，只是这些表现还没有")
  expect(boxed.fix).not.toContain("不是蓝图上说好的")
  expect(boxed.text).toStartWith("史诗档还缺这几项表现：")
  // With the hitbox in place the Boss part alone is only a warning.
  const withBox = all("epic", { hitbox: { core: { width: 4, height: 5 }, parts: [{ name: "头", forward: 1, up: 1, left: 0, width: 1, height: 1 }] } })
  expect(withBox.find((finding) => finding.rule === "tier_boss")).toMatchObject({ stops: false })
  expect(withBox.find((finding) => finding.rule === "tier_boss")!.fix).toContain("不补也能打包")
  // A passive epic creature has no Boss part, no abilities to ask for and so only the motions.
  expect(all("epic", { behavior: "passive", hitbox: { core: { width: 4, height: 5 }, parts: [{ name: "头", forward: 1, up: 1, left: 0, width: 1, height: 1 }] } }).map((finding) => [finding.rule, finding.stops])).toEqual([["tier_steady", false], ["tier_motions", true]])
  // Fine and Boss say the same things as before and never stop.
  for (const level of ["fine", "boss"] as const) expect(all(level, { abilities: [slam!] }).every((finding) => !finding.stops)).toBe(true)
})

test("10-12 epic: the model is told the six views come first and the strongest model; the creature a hitbox of parts and, hostile, a boss", () => {
  const plan = blueprint(creature({ tier: tier("epic", { reason: "你说了『超巨型的终极巨龙』" }) }))
  const finished = new Set<string>()
  const forModel = blueprintTaskPrompt(plan, plan.entries.find((value) => value.key === "fox_model")!, finished)
  const forFox = blueprintTaskPrompt(plan, plan.entries.find((value) => value.key === "fox")!, finished)
  expect(forModel).toContain("档位：「史诗」（epic）")
  expect(forModel).toContain("必须先有六视图")
  expect(forModel).toContain('budget 至少写 "epic"')
  expect(forModel).toContain("GPT 6 Astra")
  expect(forModel).toContain("打到底的姿势停住一小下")
  expect(forFox).toContain("写 hitbox：身体一个箱子（core）")
  expect(forFox).toContain("敌对的史诗档生物同时是整场战斗的 Boss")
  expect(forFox).toContain("GPT 6 Astra")
  expect(tierBudgetRefusal(plan.entries, "fox_model", "finest")).toContain('至少要写 "epic"')
  expect(tierBudgetRefusal(plan.entries, "fox_model", "epic")).toBeNull()
})

// broad11: the independent reviewer of a model is told the tier of its creature, as the maker is.
test("the reviewer of a model is told the tier of a 精细 or higher creature, with what the maker had to go by; 简单, 标准 and the rest are told nothing", () => {
  const none = { three_view: false, user: 0, concept: 0 }
  const entries = (level?: CreatureTier["level"], by: CreatureTier["by"] = "ai") => blueprint(creature(level ? { tier: tier(level, { by }) } : {})).entries
  const told = (level: CreatureTier["level"] | undefined, key: string, attached = none) => tierReviewOf(entries(level), key, attached)
  for (const level of ["simple", "standard", undefined] as const) for (const key of ["fox_model", "fox_skin", "fox"]) expect(told(level, key)).toBeNull()
  // Only the model is told; the creature's own review is about its abilities and the texture follows the model.
  for (const key of ["fox", "fox_skin", "ghost"]) expect(told("boss", key)).toBeNull()
  const boss = told("boss", "fox_model")!
  expect(boss).toMatchObject({ level: "boss", label: "Boss", creature: "fox 标题", reason: "你说了要boss", detail: CREATURE_TIERS.boss.detail })
  expect(boss.detail).toContain("体型要明显比玩家大")
  expect(boss.detail).toContain("不能做成另一种动物的比例")
  expect(told("boss", "fox_model", { three_view: true, user: 0, concept: 0 })!.views).toBe("人给了六视图，以它为准。")
  expect(told("boss", "fox_model", { three_view: false, user: 1, concept: 1 })!.views).toContain("人给了参考图")
  expect(told("boss", "fox_model", { three_view: false, user: 0, concept: 2 })!.views).toContain("制作者动手之前自己画了构想图")
  expect(boss.views).toContain("制作者也没有自己画构想图")
  // The person's own pick is said as theirs; 精细 and 史诗 are told as well, and each one's own sentence.
  expect(told("fine", "fox_model")).toMatchObject({ level: "fine", detail: CREATURE_TIERS.fine.detail })
  expect(told("epic", "fox_model")).toMatchObject({ level: "epic", detail: CREATURE_TIERS.epic.detail })
  expect(tierReviewOf(entries("boss", "you"), "fox_model", none)!.reason).toBe("用户自己选的这一档。")
})

test("a model's size is said in blocks next to the player (1.8 tall, 0.6 wide), from the model's own bounds", () => {
  // 48 pixels tall is three blocks; reaching 16 pixels out from the middle on each side is two blocks across.
  const cube = (name: string, origin: [number, number, number], size: [number, number, number]) => ({ name, origin, size, faces: {} })
  const design = { bones: [{ name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [cube("body", [-16, 0, -16], [32, 48, 32])] }] }
  const line = sizeNextToPlayer(design as never)
  expect(line).toContain("高 3 格、最宽处 2 格")
  expect(line).toContain("玩家高 1.8 格、宽 0.6 格")
  expect(line).toContain("是玩家的 1.7 倍")
  expect(line).toContain("16 像素一格")
  // A squat bird as tall as a player's chest reads as small next to one.
  expect(sizeNextToPlayer({ bones: [{ ...design.bones[0]!, cubes: [cube("body", [-6, 0, -6], [12, 20, 12])] }] } as never)).toContain("是玩家的 0.7 倍")
})

test("the sentence that keeps a model on its tier says what the tier allows and what the blueprint asks, each once and as itself", () => {
  const plan = (level: CreatureTier["level"]) => blueprint(creature({ tier: tier(level) })).entries
  const boss = tierBudgetKept(plan("boss"), "fox_model")!
  expect(boss.tier).toBe("finest")
  // The most blocks the geometry budget allows (a ceiling) and the least detail the blueprint expects (a floor, the tier's detail level) are two clauses, each said once;
  // no cube count is repeated here, so the only range the maker is given is the one in its instructions (broad20).
  expect(boss.reason).toBe("蓝图上把「fox 标题」定为「Boss」档：模型至少按「高」精细度做；部件说明里的几何预算写到「最精细」档，那只是方块数的上限，用不满不算错，所以方块少也不降档。")
  expect(boss.reason).not.toContain("下限")
  expect(boss.reason).not.toMatch(/\d/)
  expect(boss.reason.match(/上限/g)).toHaveLength(1)
  expect(tierBudgetKept(plan("fine"), "fox_model")!.reason).toContain("模型至少按「高」精细度做；部件说明里的几何预算写到「精细」档")
  // Nothing to keep for the default tier, for old creatures, and for what is not a model.
  expect(tierBudgetKept(plan("standard"), "fox_model")).toBeNull()
  expect(tierBudgetKept(blueprint(creature()).entries, "fox_model")).toBeNull()
  expect(tierBudgetKept(plan("boss"), "fox")).toBeNull()
})

// ---------------------------------------------------------------------------------------------------------------------------------
// broad20: a creature's tier raises the detail of its own model, never lowers the button, and the maker is told one range.
// ---------------------------------------------------------------------------------------------------------------------------------

const LEVELS: ModelComplexity[] = ["low", "medium", "high"]

test("effectiveDetail: the higher of the button and what the tier asks, never lower; no tier, the button", () => {
  // What each tier asks comes from the public table: 简单 and 标准 (the planner's default) follow the button; 精细 and above ask 高.
  expect(CREATURE_TIER_LEVELS.map((id) => CREATURE_TIERS[id].complexity)).toEqual(["low", "low", "high", "high", "high"])
  const table: Record<string, ModelComplexity[]> = {
    // button:        simple   standard  fine     boss     epic
    low: ["low", "low", "high", "high", "high"],
    medium: ["medium", "medium", "high", "high", "high"],
    high: ["high", "high", "high", "high", "high"],
  }
  for (const button of LEVELS) {
    expect(CREATURE_TIER_LEVELS.map((id) => effectiveDetail(button, id))).toEqual(table[button]!)
    // No tier (not a creature's model, an old blueprint): the button alone.
    expect(effectiveDetail(button)).toBe(button)
    expect(effectiveDetail(button, null)).toBe(button)
    // Never below the button, never below the tier's own level.
    for (const id of CREATURE_TIER_LEVELS) {
      const got = LEVELS.indexOf(effectiveDetail(button, id))
      expect(got).toBeGreaterThanOrEqual(LEVELS.indexOf(button))
      expect(got).toBeGreaterThanOrEqual(LEVELS.indexOf(CREATURE_TIERS[id].complexity))
    }
  }
})

test("a Boss's model under the button 低: one range for the maker, and it is the raised one; everything else keeps the button", () => {
  const plan = (level: CreatureTier["level"] | null, extra: unknown[] = []) => blueprint([...creature(level ? { tier: tier(level) } : {}), ...extra]).entries
  // The creature's own model is raised; the creature itself, its texture and an item's model are not (only the creature's model is made by detail).
  const boss = plan("boss", [entry("gem", "item"), entry("gem_model", "model", { owner: "gem" })])
  expect(detailFor(boss, "fox_model", "low")).toBe("high")
  expect(detailFor(boss, "fox", "low")).toBe("low")
  expect(detailFor(boss, "fox_skin", "low")).toBe("low")
  expect(detailFor(boss, "gem_model", "low")).toBe("low")
  expect(detailFor(boss, "nothing_here", "low")).toBe("low")
  // A tier at or below the button changes nothing; the button higher than the tier is followed.
  expect(detailFor(plan("fine"), "fox_model", "high")).toBe("high")
  expect(detailFor(plan("simple"), "fox_model", "high")).toBe("high")
  expect(detailFor(plan("simple"), "fox_model", "low")).toBe("low")
  expect(detailFor(plan("standard"), "fox_model", "medium")).toBe("medium")
  expect(detailFor(plan("standard"), "fox_model", "low")).toBe("low")
  // A creature that names no tier (an old blueprint) is not raised; a run with no button setting stays without one.
  expect(detailFor(plan(null), "fox_model", "low")).toBe("low")
  expect(detailFor(boss, "fox_model", null)).toBeNull()
  // What the maker reads is the instructions of the effective level: the 高 range, once, and nothing of 低's.
  const told = modelComplexityInstructions(detailFor(boss, "fox_model", "low")!)
  expect(told.match(/复杂度档位/g)).toHaveLength(1)
  expect(told).toContain(`复杂度档位：${MODEL_COMPLEXITY_PRESETS.high.label}`)
  expect(told).toContain(`${MODEL_COMPLEXITY_PRESETS.high.targetMinCubes}–${MODEL_COMPLEXITY_PRESETS.high.targetMaxCubes} 个体块`)
  expect(told).not.toContain(`${MODEL_COMPLEXITY_PRESETS.low.targetMinCubes}–${MODEL_COMPLEXITY_PRESETS.low.targetMaxCubes} 个体块`)
  expect(told).toContain(`至少 ${MODEL_COMPLEXITY_PRESETS.high.minUniqueCubes} 个看得见的体块`)
  // The task text names the tier's floor in words and sends the maker to that one sentence, with no cube count of its own.
  const model = blueprintTaskPrompt(blueprint(creature({ tier: tier("boss") })), blueprint(creature({ tier: tier("boss") })).entries[0]!, new Set())
  expect(model).toContain("这个生物的模型至少按「高」精细度做，顶部的「模型精细度」设得更高时按顶部的")
  expect(model).toContain("只看指令里「复杂度档位」那一句")
  expect(model).not.toMatch(/\d+[–-]\d+ 个体块/)
  // The creature's own task and an item's are not told a floor for a model.
  expect(blueprintTaskPrompt(blueprint(creature({ tier: tier("boss") })), blueprint(creature({ tier: tier("boss") })).entries[2]!, new Set())).not.toContain("精细程度：")
})

test("detailForModel finds the creature of a model asset the way the build does, and only on what it is given", () => {
  const entries = (blueprint(creature({ tier: tier("boss") })).entries as unknown as (Tiered & { asset_id: string | null })[]).map((value) => ({ ...value, asset_id: value.key === "fox" ? "entity-1" : value.key === "fox_model" ? "model-1" : null }))
  const assets = [{ id: "entity-1", document: { kind: "entity", model_asset_id: "model-9" } }]
  // Through the model entry's owner, and through the entity asset that wears the model.
  expect(detailForModel(entries, assets, "model-1", "low")).toBe("high")
  expect(detailForModel(entries, assets, "model-9", "low")).toBe("high")
  // The creature's own asset id, the same as the older single-creature path asks with.
  expect(detailForModel(entries, assets, "entity-1", "low")).toBe("high")
  // Another model, and no blueprint at all: the button.
  expect(detailForModel(entries, assets, "model-2", "low")).toBe("low")
  expect(detailForModel([], assets, "model-1", "low")).toBe("low")
  expect(detailForModel(entries, assets, "model-1", "high")).toBe("high")
})

test("the sentences beside the tier buttons and the top menu come from the tables and say the true relation", () => {
  const low = MODEL_COMPLEXITY_PRESETS.low.label
  const medium = MODEL_COMPLEXITY_PRESETS.medium.label
  const high = MODEL_COMPLEXITY_PRESETS.high.label
  // Beside the tier buttons: every tier with its least detail, in the tables' own names; the button above wins when it is higher.
  expect(DETAIL_WORDS.tier).toContain(`${CREATURE_TIERS.simple.label}、${CREATURE_TIERS.standard.label}档照顶部的设置`)
  expect(DETAIL_WORDS.tier).toContain(`${CREATURE_TIERS.fine.label}、${CREATURE_TIERS.boss.label}、${CREATURE_TIERS.epic.label}档至少按「${high}」`)
  expect(DETAIL_WORDS.tier).not.toContain(`「${low}」`)
  expect(DETAIL_WORDS.tier).toContain("顶部设得更高时按顶部")
  expect(DETAIL_WORDS.tier).toContain("招式和表现")
  // The phases are optional (0 to 3): the sentence beside the buttons does not promise more of them.
  expect(DETAIL_WORDS.tier).not.toContain("阶段")
  // At the top menu: a creature's tier may raise one creature's model; the example is the table's own Boss row.
  expect(DETAIL_WORDS.button).toContain("生物档位可能把某个生物的模型抬得更细")
  expect(DETAIL_WORDS.button).toContain(`${CREATURE_TIERS.boss.label} 档至少按「${MODEL_COMPLEXITY_PRESETS[CREATURE_TIERS.boss.complexity].label}」`)
  // Neither says the two are apart any more, and neither repeats a cube number (the range is the maker's, said once).
  for (const said of [DETAIL_WORDS.tier, DETAIL_WORDS.button]) {
    expect(said).not.toContain("两样分开算")
    expect(said).not.toMatch(/\d/)
    expect(said.replace(/Boss|AI/g, "")).not.toMatch(/[A-Za-z_]{2,}/)
  }
  // The text an outside AI reads says the same rule, and the capability list carries it.
  expect(DETAIL_WORDS.told).toContain("只抬不压")
  expect(CREATURE_TIER_CAPABILITY.effects.some((line) => line.includes(DETAIL_WORDS.told))).toBe(true)
})

// ---- broad21: what a tier asks is one list, said early and said as it is ----

test("what a tier asks is one list from the table: the card, the claimed task and the review read the same items, and the open ones are never required", async () => {
  const { tierAsks, tierAsksBrief, tierAskReviewOf, tierTaskLines } = await import("../src/creature-tier")
  const { BossSchema } = await import("../src/entity-runtime")
  const { BOSS_LIMITS } = await import("../src/boss-words")
  const boss = tierAsks("boss")
  const required = boss.filter((ask) => ask.required)
  const open = boss.filter((ask) => !ask.required)
  // Two moves, the boss settings the schema requires (a bar and a death show), a move that shakes or throws debris, a warning for each move.
  expect(required.map((ask) => ask.id)).toEqual(["motions", "abilities", "boss", "felt", "telegraph", "steady"])
  expect(required.find((ask) => ask.id === "abilities")!.full).toContain(`至少要有 ${CREATURE_TIERS.boss.abilities} 个招式`)
  // The phases (0 to BOSS_LIMITS.phases), the wake-up, the leash and the lair are open in the schema; the list says so in the schema's own number and never as a must.
  const extras = open.find(ask => ask.id === "boss_extras")!
  const pose = open.find(ask => ask.id === "model_pose")!
  expect(open.map((ask) => ask.id)).toEqual(["model_pose", "boss_extras"])
  expect(extras.full).toContain(`阶段（phases，0 到 ${BOSS_LIMITS.phases} 个）`)
  expect(required.map((ask) => ask.full).join("")).not.toContain("阶段")
  expect(BossSchema.shape.phases.safeParse([]).success).toBe(true)
  expect(BossSchema.shape.intro.safeParse(null).success).toBe(true)
  expect(BossSchema.shape.leash.safeParse(null).success).toBe(true)
  // The tiers below ask nothing of a boss; the table's flags decide, not the name of the tier.
  for (const level of ["simple", "standard", "fine"] as const) expect(tierAsks(level).map((ask) => ask.id)).toEqual(["motions"])
  expect(tierAsks("epic").map((ask) => ask.id)).toEqual(["motions", "abilities", "boss", "felt", "telegraph", "hitbox", "flight", "model_pose", "steady", "boss_extras"])
  expect(tierAsks("epic").find((ask) => ask.id === "abilities")!.full).toContain("至少要有 3 个招式")
  // 1. The blueprint card: short, plain, the open items said as open, no field names.
  const card = tierAsksBrief("boss")
  expect(card).toBe("Boss 档要有：动作要有待机、走路、受伤、倒下；至少 2 个招式，每个有自己的动作；Boss 的血条和死亡演出；至少一个招式晃屏或扬起碎块；每个招式出手前有看得见的预警；身体转身和看人要稳重。头要会看人，待机时耳朵、尾巴或胸口有小动作；登场、阶段（0–3 个）、离开重置可有可无。")
  expect(card).not.toMatch(/[a-z_]{4,}/)
  // 2. The claimed task of the creature: every required item in full, the open one marked as open; the model's task gets the motions only.
  const entries = [
    { key: "beast_model", kind: "model", title: "兽模型", owner: "beast" },
    { key: "beast", kind: "entity", title: "兽", owner: null, tier: tier("boss") },
  ]
  const task = tierTaskLines(entries, "beast")
  for (const ask of required) expect(task).toContain(`  · ${ask.full}`)
  expect(task).toContain(`  · （可有可无，没有也不算缺）${extras.full}`)
  const forModel = tierTaskLines(entries, "beast_model")
  expect(forModel).toContain(`  · ${required[0]!.full}`)
  expect(forModel.join("\n")).toContain(pose.full)
  expect(forModel.join("\n")).not.toContain("晃屏")
  // 3. The review of the creature: the same items, what is open said as open, what is measurably missing as a plain list.
  const hostile = { behavior: "hostile", abilities: [], boss: null, hitbox: null }
  const review = tierAskReviewOf(entries, "beast", hostile)!
  expect(review.tier).toBe("Boss 档")
  expect(review.required).toEqual(required.map((ask) => ask.full))
  expect(review.optional).toEqual([extras.full])
  expect(review.missing).toEqual(["还没有 Boss 设置（血条和死亡演出）", "没有一个招式在落地或吼叫时晃屏或扬起碎块", "缺稳重设置（steady）"])
  // Nothing is asked for what is not measured missing: a boss with no phases is complete, and a creature that does not fight is not asked to fight.
  const [slam] = golemAbilities.map((ability) => AbilitySchema.parse(ability))
  expect(tierAskReviewOf(entries, "beast", { behavior: "hostile", abilities: [{ ...slam!, events: [{ type: "shake", at: 0.2, strength: 1, radius: 12, seconds: 0.5 } as never] }], boss: { phases: [] }, steady: {} })!.missing).toEqual([])
  expect(tierAskReviewOf(entries, "beast", { behavior: "passive" })!.missing).toEqual(["缺稳重设置（steady）"])
  // Its model, a tier that relaxes and a tier whose list is only the motions are reviewed as before.
  expect(tierAskReviewOf(entries, "beast_model", hostile)).toBeNull()
  expect(tierAskReviewOf([entries[0]!, { ...entries[1]!, tier: tier("fine") }] as never, "beast", hostile)).toBeNull()
  expect(tierAskReviewOf([entries[0]!, { ...entries[1]!, tier: tier("standard") }] as never, "beast", hostile)).toBeNull()
  // The capability list carries the same list for an outside AI.
  expect(CREATURE_TIER_CAPABILITY.tiers.boss.asks).toEqual(required.map((ask) => ask.full))
  expect(CREATURE_TIER_CAPABILITY.tiers.boss.open).toEqual(open.map(ask => ask.full))
})


test("only epic defaults to sculpted six-view prompts and can roll back to blocky", () => {
  for (const level of CREATURE_TIER_LEVELS.filter((level) => level !== "epic")) {
    expect(sixViewStyleFor(level)).toBe("blocky")
    expect(sixViewStyleFor(level, "sculpted")).toBe("blocky")
  }
  expect(sixViewStyleFor()).toBe("blocky")
  expect(sixViewStyleFor("epic")).toBe("sculpted")
  expect(sixViewStyleFor("epic", "blocky")).toBe("blocky")
})
