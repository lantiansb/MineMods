import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ABILITY_LIMITS, COMBO_LIMITS, comboTimeline, EPIC_LIMITS } from "../src/ability-words"
import { bossPhaseIds, bossPhaseIssues } from "../src/boss-words"
import { COMBO_INSTRUCTIONS, abilityIssues, comboIssues, comboPlan, comboWords } from "../src/creature-abilities"
import { BOSS_INSTRUCTIONS, BOSS_VALUE_GUIDE, bossMasks, bossModelIssues, bossPlan, bossWords } from "../src/creature-boss"
import { CREATURE_LIFE_INSTRUCTIONS } from "../src/creature-life"
import { AbilitySchema, BossSchema, ComboSchema, EntitySchema, FlightSchema, type Ability, type Boss, type Combo } from "../src/entity-runtime"
import { compileBossRuntime } from "../src/fabric/boss-runtime"
import { compileEntity } from "../src/fabric/entity"
import { fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

/**
 * Phase rules written as a change of the phase before (`add` / `remove`) and combos (连招), 2026-11-14 (任务二 §5).
 * What an old document generates is pinned to the byte: the hashes below were taken from the generator before either existed.
 */

const [slam, burst] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability, Ability]
// A third move on the slam's own motion, so a combo has three steps to play.
const sweep: Ability = AbilitySchema.parse({ ...golemAbilities[0], id: "sweep", name: "横扫", windup: 0.3, length: 0.9, hits: [{ ...golemAbilities[0]!.hits[0], at: 0.45, damage: 5 }], start: { ...golemAbilities[0]!.start, cooldown: 1 } })
const entityPath = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const java = (files: Record<string, string | Uint8Array>) => String(files[entityPath])
const sha = (text: string) => createHash("sha256").update(text).digest("hex")
const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const runtime = { spawn: null, explosion: null, movement: "direct" as const, armor: 0, charging_armor: 0, texture_asset_id: null }
const oldBoss = BossSchema.parse({
  bar: { color: "purple", style: "notched_10", darken_sky: true },
  intro: { wake_distance: 16, clip: "roar", seconds: 0.8, sound: "entity.iron_golem.attack", opening: "burst" },
  phases: [
    { below: 0.66, clip: "wave", seconds: 1, bar_color: "red", speed: 1.15, damage: 1.3, abilities: ["slam"] },
    { below: 0.33, clip: "wave", seconds: 1, bar_color: null, speed: 1.3, damage: 1.6, abilities: [] },
  ],
  death: { seconds: 4, xp_bursts: 6, explosion: true },
  leash: { distance: 48, reset_seconds: 30 },
})
const flight = FlightSchema.parse({ style: "hover", speed: 12, altitude: { min: 2, max: 6 }, turn: 80, climb: 40, bank: 28, air_share: 0.6, takeoff: { clip: "roar", seconds: 0.8 }, land: { clip: "wave", seconds: 1 }, clips: { fly: "walk", glide: null, hover: "idle" } })
const combo: Combo = ComboSchema.parse({ id: "triple", name: "三连击", steps: ["sweep", "slam", "burst"], gap_ticks: 2, damage_scale: 1.2, start: { min_distance: 0, max_distance: 2.8, line_of_sight: true, cooldown: 10, weight: 2 } })
const old = { id: "11111111-1111-4111-8111-111111111111", name: "石像", description: "", health: 200, speed: 0.25, attack_damage: 3, behavior: "hostile", model_asset_id: null }
const said = (document: Record<string, unknown>) => EntitySchema.safeParse({ ...old, ...document }).error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n") ?? ""
const phase = (change: Record<string, unknown>) => ({ below: 0.5, clip: null, seconds: 1, bar_color: null, speed: 1, damage: 1, ...change })
const withPhases = (phases: Record<string, unknown>[]): Boss => BossSchema.parse({ ...oldBoss, intro: null, phases })

// ---- old documents are generated exactly as before ----

test("a creature written before phase rules and combos generates the Java it always did, to the byte", () => {
  // Taken at 16b48ee, before any of this: an ability creature without a runtime block, with one, a boss with a named first attack and a phase that lists none, and the same boss flying.
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(java(compileEntity({ ...plain, abilities: [slam, burst] })))).toBe("d57e3d0dd8c4c5f0358bd0673f92ad7f4d40fb47c470ad85127635cc91563871")
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(java(compileEntity({ ...plain, runtime, abilities: [slam, burst] })))).toBe("408f2aaa3f7dae1918a83ccc80430b3991bfee356ade31950295d70ed9994179")
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(java(compileEntity({ ...plain, runtime, abilities: [slam, burst], boss: oldBoss })))).toBe("5882ca33000a2b4da1100aad6bfa8ca27e3cfb0ed585ffdb133f9d34b7963fe2")
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(java(compileEntity({ ...plain, abilities: [slam, burst], boss: oldBoss, flight })))).toBe("2c4a1e5a1a497159f223f67e45cb44e0e67d241f83b09ad1ed1c3c02ba4125df")
  // An empty list of combos is no combo at all.
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(java(compileEntity({ ...plain, runtime, abilities: [slam, burst], boss: oldBoss, combos: [] })))).toBe("5882ca33000a2b4da1100aad6bfa8ca27e3cfb0ed585ffdb133f9d34b7963fe2")
})

test("the limits are raised for a boss with many moves: 16 abilities, 24 events each", () => {
  expect(ABILITY_LIMITS.abilities).toBe(16)
  expect(ABILITY_LIMITS.events).toBe(24)
  const many = Array.from({ length: 16 }, (_, index) => ({ ...slam, id: `move_${index}` }))
  expect(said({ abilities: many })).toBe("")
  // 第 3 步: the schema takes an epic creature's 24; any other tier is held to 16 when its project is checked against its blueprint (`tierLimitIssues`, ability-tactics.test.ts).
  const epic = Array.from({ length: EPIC_LIMITS.abilities }, (_, index) => ({ ...slam, id: `move_${index}` }))
  expect(said({ abilities: epic })).toBe("")
  expect(said({ abilities: [...epic, { ...slam, id: "move_24" }] })).not.toBe("")
  const sound = slam.events[0]!
  expect(AbilitySchema.safeParse({ ...slam, events: Array.from({ length: 24 }, () => sound) }).success).toBe(true)
  expect(AbilitySchema.safeParse({ ...slam, events: Array.from({ length: 25 }, () => sound) }).success).toBe(false)
  // Sixteen abilities and four combos are twenty bits of a phase's mask, well inside a Java int; an epic creature's 24 and 8 are its 32 bits.
  expect(ABILITY_LIMITS.abilities + COMBO_LIMITS.combos).toBeLessThan(31)
  expect(EPIC_LIMITS.abilities + EPIC_LIMITS.combos).toBe(32)
  const masks = bossMasks(withPhases([phase({ abilities: ["move_15"] })]), many)
  expect(masks).toEqual([(1 << 15) - 1, 1 << 15])
})

// ---- A. phase rules ----

test("a phase written as add / remove works out to the phase before with the change, and gives the masks a whole list would", () => {
  const ids = ["slam", "burst", "sweep"]
  // 「原有两招之外再加一招」: the first phase uses the two no phase names, the second adds the third.
  expect(bossPhaseIds([{ add: ["sweep"] }], ids)).toEqual([["slam", "burst"], ["slam", "burst", "sweep"]])
  // The same as writing the whole list out: the masks of that phase agree.
  const relative = withPhases([phase({ add: ["sweep"] })])
  const whole = withPhases([phase({ abilities: ["slam", "burst", "sweep"] })])
  expect(bossMasks(relative, [slam, burst, sweep])).toEqual([0b011, 0b111])
  // (Its first phase differs: a whole list names every one of them, so the first phase has them all.)
  expect(bossMasks(relative, [slam, burst, sweep])[1]).toBe(bossMasks(whole, [slam, burst, sweep])[1]!)
  // A change after a whole list, and a removal (every one is named by some phase, so the first phase has them all).
  expect(bossPhaseIds([{ abilities: ["slam"] }, { add: ["burst"] }, { remove: ["slam"], add: ["sweep"] }], ids)).toEqual([ids, ["slam"], ["slam", "burst"], ["burst", "sweep"]])
  // Old rules are what they were: a phase with an empty list or none uses all of them.
  expect(bossPhaseIds([{ abilities: [] }, {}], ids)).toEqual([ids, ids, ids])
  expect(bossPhaseIds([{ abilities: ["burst"] }], ids)).toEqual([["slam", "sweep"], ["burst"]])
  // A plan reads the same masks.
  expect(bossPlan(relative, [slam, burst, sweep]).masks).toEqual([0b011, 0b111])
})

test("what is wrong with a phase rule is said in plain words: an id it lacks, adding one it has, removing one it lacks, both ways at once, nothing left", () => {
  const abilities = [slam, burst, sweep]
  const bossWith = (phases: Record<string, unknown>[]) => said({ abilities, boss: { ...oldBoss, intro: null, phases: phases.map((change, index) => phase({ below: 0.6 - index * 0.2, ...change })) } })
  expect(bossWith([{ add: ["sweep"] }])).toBe("")
  expect(bossWith([{ add: ["nothing"] }])).toContain("boss.phases.0.add.0: 第 1 个阶段的 add 里写的 nothing 在这个生物的招式（abilities）和连招（combos）里都找不到")
  expect(bossWith([{ abilities: ["slam"] }, { add: ["slam"] }])).toContain("第 2 个阶段 add 了 slam，可是上一阶段已经能用它了")
  expect(bossWith([{ abilities: ["slam"] }, { remove: ["burst"] }])).toContain("第 2 个阶段 remove 了 burst，可是上一阶段本来就不能用它")
  expect(bossWith([{ abilities: ["slam"], add: ["burst"] }])).toContain("同时写了整份名单（abilities）和增减（add / remove）：二选一")
  expect(bossWith([{ abilities: ["slam"] }, { remove: ["slam"] }])).toContain("remove 之后一招都不剩了")
  expect(bossWith([{ add: ["sweep", "sweep"] }])).toContain("不要把 sweep 写两遍")
  expect(bossWith([{ abilities: ["slam"] }, { add: ["burst"], remove: ["burst"] }])).toContain("既写进 add 又写进 remove")
  // An empty list with a change is the change: "abilities": [] is what older documents always wrote.
  expect(bossWith([{ abilities: [], add: ["sweep"] }])).toBe("")
  // The same checks, outside the schema.
  expect(bossPhaseIssues([{ add: ["slam"] }], ["slam"]).map((issue) => issue.path.join("."))).toEqual(["boss.phases.0.add.0"])
  // The first attack is checked against the first phase worked out: one only a later phase adds cannot be it.
  expect(said({ abilities, boss: { ...oldBoss, phases: [phase({ add: ["burst"] })] } })).toContain("登场以后的第一招「晶刺喷射」在第一阶段用不了")
  // The model check takes the same ids, whichever way a phase names them.
  expect(bossModelIssues({ name: "石像", behavior: "hostile", abilities, boss: withPhases([phase({ add: ["ghost"] })]) }, null).map((issue) => issue.rule)).toEqual(["boss_ability"])
})

test("the reviewer reads, per phase, what it may start, worked out; the AI is told how to write a change", () => {
  const boss = withPhases([phase({ below: 0.66, abilities: ["slam"] }), phase({ below: 0.33, add: ["burst", "sweep"] })])
  const lines = bossWords.summary(boss, [slam, burst, sweep], "\n").split("\n")
  // Every one of them is named by some phase, so the first phase uses all of them (the old rule).
  expect(lines).toContain("第一阶段（血量掉到第一条线之前）用的招式：「重锤」、「晶刺喷射」、「横扫」")
  expect(lines.find((line) => line.startsWith("血量掉到 66%"))).toContain("这一阶段用的招式：「重锤」")
  expect(lines.find((line) => line.startsWith("血量掉到 33%"))).toContain("这一阶段用的招式：「重锤」、「晶刺喷射」、「横扫」（在上一阶段的基础上加上「晶刺喷射」「横扫」）")
  // A phase that lists nothing now says what that means.
  expect(bossWords.summary(withPhases([phase({ abilities: [] })]), [slam, burst], "\n")).toContain("这一阶段用的招式：「重锤」、「晶刺喷射」")
  for (const word of ["add 写这一阶段新加的招式", "remove 写这一阶段不再用的招式", "原有两招之外再加一招", "二选一"]) expect(BOSS_INSTRUCTIONS).toContain(word)
  expect(BOSS_VALUE_GUIDE).toContain('{"add":["quake"]}')
  // The example the AI is given writes its last phase as a change and still parses.
  const example = BossSchema.parse(JSON.parse(/例：(\{"bar".*\})。$/.exec(BOSS_INSTRUCTIONS)![1]!))
  expect(example.phases[1]!.add).toEqual(["quake"])
  expect(bossPhaseIds(example.phases, ["slam", "roar", "quake"])).toEqual([["slam", "roar", "quake"], ["slam", "roar"], ["slam", "roar", "quake"]])
})

// ---- B. combos: the document ----

test("a combo names abilities the creature has, once each, not another combo, and is bounded", () => {
  const abilities = [slam, burst, sweep]
  expect(said({ abilities, combos: [combo] })).toBe("")
  expect(said({ abilities, combos: [{ ...combo, steps: ["sweep", "ghost"] }] })).toContain("combos.0.steps.1: 连招「三连击」的第 2 步 ghost 在这个生物的招式（abilities）里找不到")
  expect(said({ abilities, combos: [combo, { ...combo, id: "outer", steps: ["slam", "triple"] }] })).toContain("是另一个连招：连招里只能写招式，不能套连招")
  expect(said({ abilities, combos: [{ ...combo, steps: ["slam", "slam"] }] })).toContain("招式 slam 写了两遍")
  expect(said({ abilities, combos: [combo, combo] })).toContain("两个连招不能用同一个 id（triple）")
  expect(said({ abilities, combos: [{ ...combo, id: "slam" }] })).toContain("连招的 id slam 和一个招式的 id 一样")
  expect(said({ abilities, combos: [{ ...combo, steps: ["slam"] }] })).not.toBe("")
  expect(said({ abilities, combos: [{ ...combo, gap_ticks: COMBO_LIMITS.gap + 1 }] })).not.toBe("")
  expect(said({ abilities, combos: [{ ...combo, damage_scale: 1.6 }] })).not.toBe("")
  expect(said({ abilities, combos: Array.from({ length: EPIC_LIMITS.combos + 1 }, (_, index) => ({ ...combo, id: `c${index}` })) })).not.toBe("")
  // Six ten-second steps are longer than a combo may run.
  const long = Array.from({ length: 6 }, (_, index) => ({ ...slam, id: `long_${index}`, length: 10 }))
  expect(said({ abilities: long, combos: [{ ...combo, steps: long.map((ability) => ability.id) }] })).toContain(`最长 ${COMBO_LIMITS.seconds} 秒`)
  // A flier has none yet (its flight decides by the ability that runs).
  expect(said({ abilities, combos: [combo], flight })).toContain("会飞的生物（写了 flight）现在还不能写连招")
  // A boss's phases and its first attack name a combo by its id.
  expect(said({ abilities, combos: [combo], boss: { ...oldBoss, intro: { ...oldBoss.intro, opening: null }, phases: [phase({ add: ["triple"] })] } })).toBe("")
  expect(said({ abilities, combos: [combo], boss: { ...oldBoss, intro: { ...oldBoss.intro, opening: "triple" }, phases: [] } })).toBe("")
  // Its choices are its abilities, then its combos: the combo is bit 3 of a phase's mask.
  expect(bossMasks(withPhases([phase({ add: ["triple"] })]), [slam, burst, sweep, combo])).toEqual([0b0111, 0b1111])
})

test("a combo's steps start one after another on the combo's own clock, with the gap between them", () => {
  // sweep 0.9 s (18 ticks), slam 1.2 s (24), burst 1.6 s (32); two ticks between: 0, 18 + 1 + 2 = 21, 21 + 24 + 3 = 48; the last tick is 48 + 32.
  expect(comboTimeline([0.9, 1.2, 1.6], 2)).toEqual({ starts: [0, 21, 48], ticks: [18, 24, 32], end: 80 })
  expect(comboTimeline([0.9, 1.2], 0).starts).toEqual([0, 19])
  const plan = comboPlan(combo, [slam, burst, sweep])
  expect(plan.steps.map((step) => [step.index, step.start])).toEqual([[2, 0], [0, 21], [1, 48]])
  expect(plan).toMatchObject({ end: 80, cooldown: 200, gap: 2, damage: 1.2 })
  const words = comboWords.summary(combo, [slam, burst, sweep], "\n")
  expect(words).toContain("依次出「横扫」→「重锤」→「晶刺喷射」，一招接一招不回待机，两招之间停 0.1 秒（2 刻）")
  expect(words).toContain("每一下的伤害 ×1.2")
  expect(words).toContain("整套 4.05 秒，之后歇 10 秒")
  expect(words).toContain("其中「晶刺喷射」中途挨打会被打断，打断了整套就停")
  expect(comboWords.timeline(combo, [slam, burst, sweep])).toContain("连招第 1.05 秒起「重锤」（它自己的第 0.7 秒出手，也就是连招的第 1.75 秒）")
})

test("the reviewer is told when a combo starts where its first step cannot reach, and when a step's hit lands in the game's half second", () => {
  const abilities = [slam, burst, sweep]
  expect(comboIssues({ name: "石像", abilities, combos: [combo] })).toEqual([])
  // Started from up to 9 blocks with a first step made for 2.8.
  const wide = comboIssues({ name: "石像", abilities, combos: [{ ...combo, start: { ...combo.start, max_distance: 9 } }] })
  expect(wide.map((issue) => [issue.rule, issue.stops])).toEqual([["combo_window", false]])
  expect(wide[0]!.text).toContain("它的第一招「横扫」是照 0–2.8 格做的")
  // Two quick hits back to back: the second step's hit lands 0.35 s after the first's, and is no heavier.
  const jab: Ability = { ...sweep, id: "jab", name: "刺", windup: 0, length: 0.2, hits: [{ ...sweep.hits[0]!, at: 0.2, damage: 5 } as Ability["hits"][number]] }
  const poke: Ability = { ...jab, id: "poke", name: "戳", hits: [{ ...jab.hits[0]!, at: 0.1 } as Ability["hits"][number]] }
  const quick = ComboSchema.parse({ ...combo, steps: ["jab", "poke"], gap_ticks: 0, damage_scale: 1 })
  const lost = comboIssues({ name: "石像", abilities: [jab, poke], combos: [quick] })
  expect(lost.map((issue) => issue.rule)).toEqual(["combo_rehit"])
  expect(lost[0]!.text).toContain("游戏刚让人受过伤的半秒里不再掉血")
  // A gap of half a second mends it; and the issues ride along with the abilities' own.
  expect(comboIssues({ name: "石像", abilities: [jab, poke], combos: [{ ...quick, gap_ticks: 10 }] })).toEqual([])
  expect(abilityIssues({ name: "石像", behavior: "hostile", abilities: [jab, poke], combos: [quick] }, null).map((issue) => issue.rule)).toContain("combo_rehit")
})

test("the AI is told how to write a combo, after the abilities' own text", () => {
  for (const word of ["combos 是连招", "steps", "gap_ticks", "damage_scale", "不能套连招", "不回待机", "会飞的生物（写了 flight）现在还不能写连招"]) expect(COMBO_INSTRUCTIONS).toContain(word)
  expect(CREATURE_LIFE_INSTRUCTIONS).toContain(COMBO_INSTRUCTIONS)
  const example = ComboSchema.parse(JSON.parse(/例：(\{"id":"triple".*\})。$/.exec(COMBO_INSTRUCTIONS)![1]!))
  expect(example.steps).toEqual(["sweep", "thrust", "slam"])
})

// ---- B. combos: the generated runtime ----

const volley: Ability = AbilitySchema.parse({ ...golemAbilities[1], id: "volley", name: "连射", stopped_by_hurt: false, hits: [{ type: "shot", at: 1, projectile: "arrow", forward: 0.5, up: 1.4, speed: 1.6, damage: 4 }], events: [] })
const comboBoss = BossSchema.parse({ ...oldBoss, intro: { ...oldBoss.intro, opening: "triple" }, phases: [{ below: 0.5, clip: "wave", seconds: 1, bar_color: null, speed: 1.2, damage: 1.3, add: ["burst"] }] })
const rain = ComboSchema.parse({ ...combo, id: "rain", name: "箭雨", steps: ["volley", "burst"], gap_ticks: 0, damage_scale: 0.8, start: { ...combo.start, min_distance: 4, max_distance: 10 } })
const comboShapes = [
  { classSuffix: "", runtime, abilities: [slam, burst, sweep], combos: [combo], boss: comboBoss },
  { classSuffix: "B", abilities: [slam, burst, sweep, volley], combos: [combo, rain] },
  { classSuffix: "C", runtime, abilities: [slam, burst], boss: oldBoss },
]

test("a creature with combos carries them as choices after its abilities, and plays their steps one after another", () => {
  const source = java(compileEntity({ ...plain, ...comboShapes[0]! }))
  // Three abilities and one combo: four choices, the combo the last; its steps by the abilities' numbers.
  expect(source).toContain("private static final int[] ABILITY_WEIGHT = {3, 2, 3, 2};")
  expect(source).toContain("private final int[] abilityReadyAt = new int[4];")
  expect(source).toContain("private static final int[][] COMBO_STEPS = {{2, 0, 1}};")
  expect(source).toContain("private static final int[] COMBO_GAP = {2};")
  expect(source).toContain("private static final float[] COMBO_DAMAGE = {1.2f};")
  expect(source).toContain("private static final int[] COMBO_COOLDOWN = {200};")
  // The first phase may start slam, sweep and the combo (burst is added later); the second all four. The first attack is the combo, choice 3.
  expect(source).toContain("private static final int[] BOSS_MASKS = {13, 15};")
  expect(source).toContain("private static final int BOSS_OPENING = 3;")
  expect(source).toContain("case 3 -> distance >= 0.0 && distance <= 2.8 && hasLineOfSight(target);")
  // A step that ends goes on to the next one; between two the combo still runs, so the creature neither walks nor goes back to standing.
  expect(source).toContain("if (abilityIndex >= 0 && abilityTick >= ABILITY_LENGTH[abilityIndex]) comboFinished();")
  expect(source).toContain("private boolean abilityRunning() { return abilityIndex >= 0 || comboIndex >= 0; }")
  expect(source).toContain("if (comboGap-- > 0) return;")
  expect(source).toContain("damage * bossDamageScale() * abilityDamageScale()")
  expect(source).toContain("if (comboIndex >= 0) abilityReadyAt[3 + comboIndex] = tickCount + COMBO_COOLDOWN[comboIndex];")
  // An arrow a combo shoots is as much stronger as its hits are.
  expect(String(compileEntity({ ...plain, ...comboShapes[1]! })[entityPath.replace("StudioCreature", "StudioCreatureB")])).toContain("shot.setBaseDamage(2.5 * abilityDamageScale());")
  // A flier is refused, with the reason.
  expect(() => compileEntity({ ...plain, abilities: [slam, burst, sweep], combos: [combo], flight })).toThrow("会飞的生物现在还不能用连招")
  // A step it does not have is refused too (the document says so first).
  expect(() => compileEntity({ ...plain, abilities: [slam, burst], combos: [combo] })).toThrow("连招「三连击」里有一招，这只生物还没学会。")
})

test.skipIf(!hasTargetJavac(OFFICIAL))("creatures with combos compile against Minecraft 1.21.1 (Mojang's names) and GeckoLib, beside one without", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-combo-"))
  try {
    await Promise.all(comboShapes.map(async (shape) => writeFile(path.join(root, `StudioCreature${shape.classSuffix}.java`), String(compileEntity({ ...plain, ...shape })[`src/main/java/com/minemods/content_golem_mod/entity/StudioCreature${shape.classSuffix}.java`]))))
    const support = compileBossRuntime({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", shake: false, debris: false })
    await Promise.all(Object.entries(support.files).map(async ([name, text]) => writeFile(path.join(root, path.basename(name)), String(text))))
    const compiled = await targetJavac(OFFICIAL, root)
    expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
    expect(compiled.code).toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 180000)

test("a saved creature's combos reach the built mod through the normal build (found missing in the real game, 2026-11-14)", async () => {
  const { assembleBuildSource } = await import("../src/build-source")
  const { saveProject } = await import("../src/project")
  const { createDataGameplaySample } = await import("../script/data-gameplay-sample")
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-连招-构建-"))
  try {
    const directory = path.join(root, "project")
    const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
    const golem = sample.entities[0]!
    const abilities = golem.abilities ?? []
    expect(abilities.length).toBeGreaterThanOrEqual(2)
    const combo = ComboSchema.parse({ id: "crush", name: "碎岩连击", steps: [abilities[0]!.id, abilities[1]!.id], gap_ticks: 4, damage_scale: 1.5, start: abilities[0]!.start })
    await saveProject(directory, { ...sample, entities: [{ ...golem, combos: [combo] }] }, sample.revision)
    const source = path.join(root, "source")
    const template = path.join(import.meta.dir, "..", "..", "..", "templates", "fabric-1.21")
    await assembleBuildSource(directory, source, template)
    const { readdir, readFile } = await import("node:fs/promises")
    const files = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && /StudioCreature\w*\.java$/.test(entry.name))
    const texts = await Promise.all(files.map((entry) => readFile(path.join(entry.parentPath, entry.name), "utf8")))
    expect(texts.some((text) => text.includes("COMBO_DAMAGE"))).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120000)

// ---- a phase that names a combo is built (急修 2026-11-17) ----
// Saving, the review and the reconcile before a pack all took a combo's id in a phase; the generator alone checked the phase against the abilities
// without the combos, so a boss whose phase named a combo was refused at the pack as「它没有这个招式」. Each way a phase names one, on every target.

const phaseShapes: [string, Boss, string][] = [
  ["a whole list", withPhases([phase({ abilities: ["slam", "triple"] })]), "{6, 9}"],
  ["add", withPhases([phase({ add: ["triple"] })]), "{7, 15}"],
  ["remove", withPhases([phase({ below: 0.6, abilities: ["slam", "triple"] }), phase({ below: 0.3, remove: ["triple"], add: ["burst"] })]), "{4, 9, 3}"],
]

test("a boss whose phase names a combo (a whole list, add, remove) is generated on all three targets, the combo a bit of the phase's mask", async () => {
  const { genTarget } = await import("../src/platform/target")
  // Without their events: the sample's dust is a particle Minecraft 1.20.1 does not have, which is another refusal than the one looked at here.
  const quiet = [slam, burst, sweep].map((ability) => ({ ...ability, events: [] }))
  for (const id of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const)
    for (const [way, boss, masks] of phaseShapes) {
      const files = compileEntity({ ...plain, runtime, abilities: quiet, combos: [combo], boss }, genTarget(id))
      const source = String(files[Object.keys(files).find((name) => name.endsWith("/StudioCreature.java"))!])
      expect([id, way, /BOSS_MASKS = (\{[^}]*\})/.exec(source)?.[1]]).toEqual([id, way, masks])
    }
  // An id that is neither an ability nor a combo is still refused, in the person's words.
  expect(() => compileEntity({ ...plain, runtime, abilities: [slam, burst, sweep], combos: [combo], boss: withPhases([phase({ add: ["ghost"] })]) })).toThrow("可是它没有这个招式")
})

const CLASSPATH = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" } as const

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: a saved boss whose phases name a combo goes through the pack's own path (reconciled, generated, nothing stops it) and the whole tree compiles`, async () => {
    const { assembleBuildSource } = await import("../src/build-source")
    const { saveProject } = await import("../src/project")
    const { createTargetBossLookSample } = await import("../script/target-boss-look-sample")
    const { readdir, readFile } = await import("node:fs/promises")
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-阶段连招-"))
    try {
      const directory = path.join(root, "project")
      const sample = await createTargetBossLookSample(directory, target, { abilities: true })
      const golem = sample.entities[0]!
      const [first, second] = golem.abilities ?? []
      const crush = ComboSchema.parse({ id: "crush", name: "碎岩连击", steps: [first!.id, second!.id], gap_ticks: 4, damage_scale: 1.5, start: first!.start })
      // The first line puts the combo on a whole list, the second takes it off and adds the other ability: all three ways in one saved document.
      const [upper, lower] = golem.boss!.phases
      const boss = { ...golem.boss!, phases: [{ ...upper!, abilities: [first!.id, "crush"] }, { ...lower!, remove: ["crush"], add: [second!.id] }] }
      await saveProject(directory, { ...sample, entities: [{ ...golem, combos: [crush], boss }] }, sample.revision)
      const source = path.join(root, "source")
      const assembled = await assembleBuildSource(directory, source, path.join(import.meta.dir, "..", "..", "..", "templates", "fabric-1.21"))
      expect(assembled.findings.filter((finding) => finding.stops)).toEqual([])
      const files = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && /StudioCreature\w*\.java$/.test(entry.name))
      const texts = await Promise.all(files.map((entry) => readFile(path.join(entry.parentPath, entry.name), "utf8")))
      // Two abilities and the combo, every one named by some phase, so the first phase has all three (7); then the first ability and the combo (5); then the two abilities (3).
      expect(texts.map((text) => /BOSS_MASKS = (\{[^}]*\})/.exec(text)?.[1]).filter(Boolean)).toEqual(["{7, 5, 3}"])
      expect(texts.some((text) => text.includes("COMBO_STEPS = {{0, 1}}"))).toBe(true)
      if (!hasTargetJavac(CLASSPATH[target])) return
      const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
      expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
      expect(compiled.code).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 240000)
}
