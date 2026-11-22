import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { AbilitySchema, BossSchema } from "../src/entity-runtime"
import { AbilityAssetDocumentSchema } from "../src/ability-asset"
import { appendageDesignHints, castDesignHints, creatureDesignHints, hint, visualDesignHint } from "../src/combat-design"
import { defaultWarningPaint } from "../src/warn-paint"
import { EmittersSchema } from "../src/particle-emission"
import { WorkspaceAssetSchema } from "../src/workspace"
import { assetDesignNotes, combatParticleCounts, particleReport } from "../src/combat-particles"
import { reviewAsset } from "../src/acceptance"
import { createProject } from "../src/project"
import { ModelShapeSchema } from "@minemods/studio-ai/contracts"
import { EffectDocumentSchema } from "../src/effect"
import { emberParticle } from "../script/target-ability-sample"
import { golemEffects } from "../script/data-gameplay-sample"
import { stormAbility } from "../script/target-weather-sample"
import { rayAbility } from "../script/target-groundfx-sample"
import { HEAVY_DAMAGE } from "../src/combat-design-words"

const uid = "00000000-0000-4000-8000-000000000042"
const at = 0.5
const sound = { type: "sound", at, sound: "entity.player.attack.sweep", volume: 1, pitch: 1 }
const particle = { type: "particle", at, particle: "crit", count: 8, forward: 0, up: 0, left: 0, spread: 0.2 }
const shape = { type: "effect", at, effect: uid, where: "hit", hit: 0, forward: 0, up: 0, left: 0, count: 1, layout: "line", spread: 0 }
const shake = { type: "shake", at, strength: 1, radius: 10, seconds: 0.5 }
const area = { type: "area", at, shape: { type: "arc", reach: 2, angle: 90, low: 0, high: 2 }, damage: 4, hits: "everyone", knockback: 0, effects: [] }
const creature = { name: "青铜哨卫" }
const move = (changes: Record<string, unknown> = {}) => AbilitySchema.parse({
  id: "sting", name: "尾尖点刺", clip: "sting", windup: at, length: 1.5, facing: "lock", hits: [area], moves: [],
  start: { min_distance: 0, max_distance: 2, line_of_sight: true, cooldown: 0, weight: 1 },
  stopped_by_hurt: false, events: [{ ...sound, at: 0.1 }, sound, particle, shape], ...changes,
})
const finds = (...moves: ReturnType<typeof move>[]) => creatureDesignHints(creature, moves)
const has = (rule: string, ...moves: ReturnType<typeof move>[]) => finds(...moves).some((issue) => issue.rule === rule)

describe("招式设计建议只提供可改的提醒", () => {
  test("每一下都看三层，重招另外看震屏或碎块，按生物合并", () => {
    const recipe = {type:"hit_fx", at, where:"hit", hit:0, color:"#ffee66", level:"heavy"}
    expect(has("hit_feedback", move({hits:[{...area, damage:HEAVY_DAMAGE}], events:[recipe]}))).toBe(false)
    expect(() => move({events:[{...recipe, hit:3}]})).toThrow("命中反馈要指向已有的出手")
    const thin = move({ hits: [{ ...area, damage: HEAVY_DAMAGE }], events: [particle] })
    const thick = move({ hits: thin.hits, events: [...move().events, shake] })
    expect(has("hit_feedback", thick)).toBe(false)
    // A weapon trail drawn across the hit is its visible shape, wherever in the swing it began; one that ended before the hit is not.
    const trail = { type: "trail", at: 0.2, until: 0.6, bone: "arm", color: "#66ccff", width: 0.4, fade_ticks: 6 }
    expect(has("hit_feedback", move({ events: [{ ...sound, at: 0.1 }, sound, particle, trail] }))).toBe(false)
    expect(has("hit_feedback", move({ events: [{ ...sound, at: 0.1 }, sound, particle, { ...trail, until: 0.3 }] }))).toBe(true)
    expect(has("hit_feedback", move({ hits: [area, { ...area, at: 0.8 }] }))).toBe(true)
    const hints = finds(thin, { ...thin, id: "iron_crush", name: "碎甲" }).filter((issue) => issue.rule === "hit_feedback")
    expect(hints).toHaveLength(1)
    expect(hints[0]?.stops).toBe(false)
    expect(hints[0]!.text).toContain("有 2 招")
    expect(hints[0]!.text).toContain("震屏或碎块")
  })
  test("长提醒按打包结果存得下的长度收尾", () => {
    const issue = hint("hit_feedback", "声音或形状".repeat(200))
    expect(issue.text).toHaveLength(600)
    expect(issue.text.endsWith("…")).toBe(true)
    expect(issue.stops).toBe(false)
  })
  test("起手声必须先于出手，命中当刻的音效不能算", () => {
    expect(has("windup_sound", move({ events: [sound, particle, shape] }))).toBe(true)
    expect(has("windup_sound", move())).toBe(false)
    expect(finds(stormAbility).every((issue) => issue.stops === false)).toBe(true)
  })
  test("单击收招的最小值是起手的一半，多段、光束不套用", () => {
    expect(has("recovery_ratio", move({ length: 0.7 }))).toBe(true)
    expect(has("recovery_ratio", move({ length: 0.75 }))).toBe(false)
    expect(has("recovery_ratio", move({ length: 0.7, hits: [area, { ...area, at: 0.65 }] }))).toBe(false)
    expect(has("recovery_ratio", rayAbility)).toBe(false)
  })
  test("默认追到出手才锁会提醒，提前一刻或从头锁则通过", () => {
    expect(has("facing_lock", move({ facing: "track" }))).toBe(true)
    expect(has("facing_lock", move({ facing: "track", track_until: 0.4 }))).toBe(false)
    expect(has("facing_lock", move())).toBe(false)
  })
  test("重招需要反击窗口，有其他可用动作时单招冷却不算停顿", () => {
    const hit = { ...area, damage: HEAVY_DAMAGE }
    expect(has("counter_window", move({ length: 0.8, hits: [hit] }))).toBe(true)
    expect(has("counter_window", move({ hits: [hit] }))).toBe(false)
    const cooling = move({ length: 0.8, hits: [hit], start: { ...move().start, cooldown: 2 } })
    expect(has("counter_window", cooling)).toBe(false)
    expect(has("counter_window", cooling, { ...move(), id: "other" })).toBe(true)
  })
})

test("陷阱技能同样检查反馈、提示和反击，持续施法跳过单击比例", async () => {
  const input = {
    kind: "ability", name: "毒针陷阱", english_name: "Poison Needle", cast: { type: "instant", seconds: 0, cooldown: 0 },
    reach: 5, hits: [{ ...area, damage: HEAVY_DAMAGE }], events: [], moves: [], bindings: [{ type: "block", block: "poison_trap" }],
  }
  const bad = AbilityAssetDocumentSchema.parse(input)
  expect(castDesignHints(bad).map((issue) => issue.rule)).toEqual(["hit_feedback", "windup_sound", "recovery_ratio", "counter_window"])
  const good = AbilityAssetDocumentSchema.parse({
    ...input, cast: { ...input.cast, cooldown: 1 }, sounds: { start: sound.sound },
    events: [sound, { ...particle, where: "target" }, { type: "effect", at, effect: uid, where: "target", forward: 0, up: 0, left: 0 }, shake, { ...sound, at: 0.75 }],
  })
  expect(castDesignHints(good)).toEqual([])
  const streamed = AbilityAssetDocumentSchema.parse({ ...input, cast: { type: "channel", seconds: 3, cooldown: 3, tick_every: 14 } })
  expect(castDesignHints(streamed).some((issue) => issue.rule === "recovery_ratio")).toBe(false)
  const directory = await mkdtemp(path.join(os.tmpdir(), "minemods-combat-advice-"))
  try {
    const project = await createProject({ directory, name: "毒针", mod_id: "poison_needle" })
    const review = reviewAsset(project, { id: uid, document: bad, module: "ability", dependencies: [] })
    expect(review.passed).toBe(true)
    expect(review.findings).toEqual([])
    expect(review.advice).toHaveLength(4)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("短粒子的透度以及短模型效果的全亮和收尾", () => {
  expect(visualDesignHint({ ...emberParticle, emissive: false, opacity: { start: 1, end: 1 } })?.text).toContain("全亮和淡出")
  expect(visualDesignHint(emberParticle)).toBeNull()
  expect(visualDesignHint({ ...emberParticle, lifetime: 2, emissive: false })).toBeNull()
  const raw = EffectDocumentSchema.parse(golemEffects.mark.document)
  const effect = { ...raw, play: { ...raw.play, lifetime: 1 } }
  expect(visualDesignHint({ ...effect, play: { ...effect.play, bright: false, blend: "normal" } })?.text).toContain("没有全亮")
  const faded = EffectDocumentSchema.parse({
    ...effect,
    play: { ...effect.play, bright: true },
    animations: [{ name: effect.play.clip, length: 1, loop: false, channels: [{ bone: effect.bones[0]!.name, keyframes: [], scale: [{ time: 0, scale: [1, 1, 1] }, { time: 1, scale: [0.05, 0.05, 0.05] }] }] }],
  })
  expect(visualDesignHint(faded)).toBeNull()
})

test("附属物只认命名明确的单支，拆两节并挂起后消掉提醒", () => {
  const bone = (name: string, parent: string | null) => ({ name, parent, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [] })
  const body = bone("body", null)
  const single = { bones: [body, bone("tail", "body"), bone("weapon", "body")], follow: [] }
  const twice = { bones: [body, bone("tail_1", "body"), bone("tail_2", "tail_1"), bone("weapon", "body")], follow: [{ bone: "tail_2", mode: "spring" }] }
  const measure = (value: object) => z.object({ bones: ModelShapeSchema.shape.bones, follow: ModelShapeSchema.shape.follow }).parse(value)
  expect(appendageDesignHints("青铜蜥", measure(single))[0]?.rule).toBe("appendage_chain")
  expect(appendageDesignHints("青铜蜥", measure(twice))).toEqual([])
  expect(appendageDesignHints("青铜蜥", measure({ ...single, bones: [body, bone("weapon", "body")] }))).toEqual([])
})

test("统计的是引用处数，把内置生成分开，并只在指定档位原版过半时提醒", () => {
  const boss = BossSchema.parse({ bar: { color: "red", style: "progress", darken_sky: false }, intro: null, phases: [], death: { seconds: 1, xp_bursts: 0, explosion: true }, leash: null })
  const fighter = { ...creature, boss }
  const vanilla = move({ events: [particle, { ...particle, count: 12 }] })
  const handmade = move({ events: [particle, { ...particle, particle: { asset: uid } }] })
  expect(combatParticleCounts(fighter, [vanilla])).toMatchObject({ moves: { vanilla: 2, own: 0 }, particles: ["死亡爆炸的大爆炸", "死亡爆炸的一下闪光"], sounds: ["死亡爆炸的爆炸声"], builtin: [{ where: "死亡爆炸", kind: "particle", id: "EXPLOSION_EMITTER" }, { where: "死亡爆炸", kind: "particle", id: "FLASH" }, { where: "死亡爆炸", kind: "sound", id: "GENERIC_EXPLODE" }] })
  expect(particleReport(fighter, [vanilla], "boss")?.warning?.stops).toBe(false)
  expect(particleReport(fighter, [vanilla], "fine")?.warning).toBeNull()
  expect(particleReport(fighter, [handmade], "epic")?.warning).toBeNull()
})

test("新任务按档位选择预警画法，保留显式选择并提示仍用彩尘的位置", () => {
  const warning = { look:"ring", color:"red", seconds:0.25 }
  const draft = WorkspaceAssetSchema.shape.document.parse({
    kind:"entity", name:"哨卫", description:"看守林地", health:20, speed:0.2, attack_damage:3,
    behavior:"hostile", model_asset_id:uid, runtime:{spawn:null,explosion:null,movement:"direct",armor:0,charging_armor:0,texture_asset_id:null},
    abilities:[move({hits:[{...area,warn:warning},{...area,warn:{...warning,paint:"dust"}}]})],
  })
  if(draft.kind !== "entity") throw new Error("生物文档应可读")
  expect(defaultWarningPaint(draft,"fine")).toBe(draft)
  for(const tier of ["epic","boss"] as const) {
    const chosen=defaultWarningPaint(draft,tier)
    expect(chosen).toMatchObject({abilities:[{hits:[{warn:{paint:"mesh"}},{warn:{paint:"dust"}}]}]})
    if(chosen.kind === "entity") {
      const report=particleReport(chosen,chosen.abilities ?? [],tier)
      expect(report?.line).toContain("预警 1 处")
      // r29: the dust warning is a vanilla particle of the moves, counted with them (the mesh one is not).
      expect(report?.line).toContain("招式原版 2（其中预警的原版彩尘 1 处）")
      expect(report?.warning?.text).toContain("warn.effect")
    }
  }
  expect(draft.abilities?.[0]?.hits[0]).not.toMatchObject({warn:{paint:"mesh"}})
})

test("生物别名按实际来源统计，每个常驻发射和连续招式各算一处", () => {
  const particles = { 烟: "smoke" as const, 火: { asset: uid } }
  const emitters = EmittersSchema.parse(["烟", "火"].map(alias => ({ particle: { alias }, every_ticks: 4, count: 20 })))
  const fighter = { ...creature, particles, emitters }
  const attack = move({ events: [
    { ...particle, particle: { alias: "烟" }, until: 1.2, every_ticks: 3 },
    { ...particle, particle: { alias: "火" } },
  ] })
  expect(combatParticleCounts(fighter, [attack])).toMatchObject({ moves: { vanilla: 1, own: 1 }, emitters: { vanilla: 1, own: 1 } })
  expect(particleReport(fighter, [], "standard")?.line).toContain("常驻发射原版 1、自制 1")
})

test("技能的粒子和危险区依自己的别名计数，引用持续技能后仍按原文的处数", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "minemods-count-"))
  try {
    const project = await createProject({ directory, name: "火痕", mod_id: "ember_mark" })
    const ability = AbilityAssetDocumentSchema.parse({
      kind: "ability", name: "火痕", english_name: "Ember Mark", cast: { type: "channel", seconds: 2, tick_every: 16, cooldown: 1 },
      particles: { 火: { asset: uid }, 烟: "smoke" }, reach: 6, hits: [area], moves: [], bindings: [],
      events: [{ ...particle, particle: { alias: "火" } }, { type: "hazard", at: 0, where: "self", forward: 0, left: 0, radius: 1, seconds: 1, color: "#ff6633", glow: true, damage: 1, hits: "everyone", effects: [], every_ticks: 10, particle: { alias: "烟" }, count: 5 }],
    })
    const now = new Date().toISOString()
    const asset = WorkspaceAssetSchema.parse({ id: uid, title: "火痕", module: "ability", revision: 1, created_at: now, updated_at: now, prompt: "火痕", dependencies: [], document: ability, provenance: { model: "example", request_id: null }, status: "ready" })
    project.workspace.assets.push(asset)
    expect(assetDesignNotes(project, ability).facts).toEqual(["技能「火痕」的粒子使用处数：原版 1、自制 1。"])
    const shared = move()
    const use = { asset: uid, id: shared.id, clip: shared.clip, start: shared.start, facing: shared.facing, stopped_by_hurt: false }
    const owner = { ...creature, particles: { 火: "crit" as const }, shared_abilities: [use] }
    expect(combatParticleCounts(owner, [shared], project.workspace).moves).toEqual({ vanilla: 1, own: 1 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
