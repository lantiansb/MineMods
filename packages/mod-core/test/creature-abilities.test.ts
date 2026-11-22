import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ABILITY_EFFECTS, ABILITY_LIMITS, ABILITY_PARTICLES, ABILITY_SOUNDS, EPIC_LIMITS } from "../src/ability-words"
import { assembleBuildSource } from "../src/build-source"
import { abilityFault } from "@minemods/studio-ai/making"
import { ABILITY_INSTRUCTIONS, abilityFaultName, abilityWords, NEVER_PLAYED, STRIKE_TOLERANCE, abilityHitShapes, abilityIdle, abilityIssues, abilityPlace, abilityPlan, abilityStep, abilityTick, abilityTimingIssues, bindingLines, creatureBindings, hitDisagrees, hitLines, shapeGap, type AbilityRun } from "../src/creature-abilities"
import { modGuide } from "../src/guide"
import { gameplayContract, readGeneratedCreature } from "../src/creature-contract"
import { creatureClipFindings, creatureFacets } from "../src/creature-life"
import { soundConstant } from "../src/data-words"
import { AbilitySchema, EntitySchema, type Ability } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { playedAnimations, reconcile } from "../src/reconcile"
import type { ModuleDocument } from "../src/workspace"
import { MODULES } from "../src/workspace-modules"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities, livingGolemDesign } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac, targetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-abilities-"))
  roots.push(root)
  return root
}

const [slam, burst] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability, Ability]
const runtime = { spawn: null, explosion: null, movement: "direct" as const, armor: 0, charging_armor: 0, texture_asset_id: null }
const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const java = (files: Record<string, string | Uint8Array>) => String(files["src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"])
const refused = (change: Record<string, unknown>) => AbilitySchema.safeParse({ ...golemAbilities[0], ...change }).error?.issues.map((issue) => issue.message).join(" ") ?? ""

// ---- the data ----

test("a creature without abilities is what it was; an ability is bounded and says what is wrong in plain words", () => {
  const old = { id: "11111111-1111-4111-8111-111111111111", name: "苔皮苦力怕", description: "", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile", model_asset_id: null }
  expect(JSON.stringify(EntitySchema.parse(old))).toBe(JSON.stringify(old))
  expect(EntitySchema.parse({ ...old, abilities: golemAbilities }).abilities).toHaveLength(2)
  expect(refused({})).toBe("")
  expect(refused({ clip: "walk" })).toContain("招式不能用 walk 这个动作")
  expect(refused({ windup: 0.9 })).toContain("不能比蓄力结束（windup）还早")
  expect(refused({ length: 0.6 })).toContain("不能比招式全长（length）还晚")
  expect(refused({ start: { ...slam.start, min_distance: 3 } })).toContain("最远距离（max_distance）要比最近距离（min_distance）大")
  expect(refused({ hits: [{ type: "shot", at: 0.7, projectile: "snowball", speed: 1.5, forward: 1, up: 1.5, damage: 3 }] })).toContain("雪球的伤害是原版定的")
  expect(refused({ hits: [{ type: "shot", at: 0.7, projectile: "arrow", speed: 1.5, forward: 1, up: 1.5, damage: null }] })).toContain("箭要写伤害")
  expect(refused({ events: [{ type: "sound", at: 0.7, sound: "entity.dragon.made_up", volume: 1, pitch: 1 }] })).not.toBe("")
  expect(EntitySchema.safeParse({ ...old, abilities: [golemAbilities[0], golemAbilities[0]] }).error?.issues[0]?.message).toContain("两个招式不能用同一个 id")
  // 第 3 步: the schema takes up to an epic creature's number; any other tier is held to ABILITY_LIMITS against its blueprint (`tierLimitIssues`).
  expect(EntitySchema.safeParse({ ...old, abilities: Array.from({ length: EPIC_LIMITS.abilities + 1 }, (_, index) => ({ ...golemAbilities[0], id: `a${index}` })) }).success).toBe(false)
})

// ---- timing ----

test("every moment of an ability is one server tick: hits never before the wind-up ends, nothing after the end", () => {
  expect([0, 0.05, 0.7, 1.1, 1.3, 0.024, 0.026].map(abilityTick)).toEqual([0, 1, 14, 22, 26, 0, 1])
  expect(abilityPlan(slam)).toMatchObject({ windup: 10, length: 24, cooldown: 50, hits: [{ index: 0, tick: 14 }], events: [{ tick: 14 }, { tick: 14 }] })
  expect(abilityPlan(burst)).toMatchObject({ windup: 16, length: 32, cooldown: 120, hits: [{ tick: 20 }, { tick: 26 }], events: [{ tick: 0 }, { tick: 20 }, { tick: 20 }, { tick: 26 }] })
  // 0.52 s rounds to tick 10, the wind-up of 0.54 s to tick 11: the hit waits for the wind-up.
  expect(abilityPlan({ ...slam, windup: 0.54, hits: [{ ...slam.hits[0]!, at: 0.54 }] }).hits[0]!.tick).toBe(11)
  expect(abilityPlan({ ...slam, length: 0.72, events: [{ ...slam.events[0]!, at: 0.72 }] })).toMatchObject({ length: 14, events: [{ tick: 14 }] })
})

// ---- the life of one run ----

const plans = [slam, burst].map((ability) => ({ ...abilityPlan(ability), stopped_by_hurt: ability.stopped_by_hurt }))
const quiet: { dead: boolean; target: boolean; hurt: boolean; start: number | null } = { dead: false, target: true, hurt: false, start: null }
/** Runs ticks from `age`, with what happens on some of them, and says on which tick of the run each hit landed and how it ended. */
function played(start: number, during: Record<number, Partial<typeof quiet>> = {}, from: AbilityRun = abilityIdle(2), age = 100) {
  const log = { hits: [] as number[], ended: null as string | null, at: 0 }
  const last = Array.from({ length: 60 }).reduce<AbilityRun>((run, _, tick) => {
    const stepped = abilityStep(plans, run, { ...quiet, age: age + tick, start: tick === 0 ? start : null, ...during[tick] })
    stepped.hits.forEach(() => log.hits.push(tick))
    if (stepped.ended && !log.ended) Object.assign(log, { ended: stepped.ended, at: tick })
    return stepped.run
  }, from)
  return { ...log, run: last }
}

test("an ability hits on its exact ticks, ends by itself, and waits its cooldown from where it ended", () => {
  expect(played(0)).toMatchObject({ hits: [14], ended: "done", at: 24, run: { running: null, ready_at: [174, 0] } })
  expect(played(1)).toMatchObject({ hits: [20, 26], ended: "done", at: 32, run: { ready_at: [0, 252] } })
  // Still waiting: asked to start again too early, nothing starts; one tick later than the wait, it does.
  expect(played(0, {}, { running: null, tick: 0, ready_at: [101, 0] }).hits).toEqual([])
  expect(played(0, {}, { running: null, tick: 0, ready_at: [100, 0] }).hits).toEqual([14])
  // While one runs, a goal asking for another changes nothing.
  expect(played(0, { 5: { start: 1 } })).toMatchObject({ hits: [14], ended: "done" })
})

test("cut short, an ability does nothing more: no hit on that tick or after", () => {
  expect(played(0, { 14: { dead: true } })).toMatchObject({ hits: [], ended: "death", at: 14, run: { ready_at: [164, 0] } })
  expect(played(0, { 9: { target: false } })).toMatchObject({ hits: [], ended: "target", at: 9 })
  // The burst says being hurt stops it: between its two thrusts, the second never lands.
  expect(played(1, { 22: { hurt: true } })).toMatchObject({ hits: [20], ended: "hurt", at: 22 })
  // The slam says it does not: hurt changes nothing.
  expect(played(0, { 3: { hurt: true }, 13: { hurt: true } })).toMatchObject({ hits: [14], ended: "done" })
  expect(abilityStep(plans, abilityIdle(2), { ...quiet, age: 5, dead: true, start: 0 }).run.running).toBeNull()
})

// ---- the generated creature ----

test("without abilities the generated creature is byte for byte what it was, with or without a runtime block", () => {
  ;[{}, { runtime }].forEach((shape) => {
    const before = compileEntity({ ...plain, ...shape, model: livingGolemDesign })
    ;[{ abilities: [] }, { abilities: null }].forEach((none) => expect(compileEntity({ ...plain, ...shape, model: livingGolemDesign, ...none })).toEqual(before))
    expect(java(before).toLowerCase()).not.toContain("ability")
    // A creature that fights nobody has nobody to use them on: nothing is generated for them.
    expect(java(compileEntity({ ...plain, ...shape, behavior: "passive", abilities: golemAbilities }))).toBe(java(compileEntity({ ...plain, ...shape, behavior: "passive" })))
  })
})

test("with abilities the class carries their ticks, starts them from its fighting goal and stops swinging at once", () => {
  const without = java(compileEntity({ ...plain, abilities: golemAbilities }))
  expect(without).toContain("private static final int[] ABILITY_WINDUP = {10, 16};")
  expect(without).toContain("private static final int[] ABILITY_LENGTH = {24, 32};")
  expect(without).toContain("private static final int[] ABILITY_COOLDOWN = {50, 120};")
  expect(without).toContain("if (!abilityInArc(victim, 2.5, 60.0, -0.5, 2.5) || !abilityStrike(victim, 9.0f, 1.2)) continue;")
  expect(without).toContain("goalSelector.addGoal(1, new AbilityGoal());")
  expect(without).not.toContain("MeleeAttackGoal")
  expect(without).toContain("targetSelector.addGoal(1, new NearestAttackableTargetGoal<>(this, Player.class, true));")
  // Only the burst is stopped by being hurt, and that is decided where the hurt arrives.
  expect(without).toContain("private static final boolean[] ABILITY_HURT_STOPS = {false, true};")
  expect(without).toContain("if (hurt && !level().isClientSide() && abilityIndex >= 0 && ABILITY_HURT_STOPS[abilityIndex]) stopAbility();")
  expect(without).toContain("if (getEntityData().get(ABILITY) != 0) return PlayState.STOP;\n            float amount = state.getLimbSwingAmount();")
  // The attack motion and doHurtTarget stay for gameplay code.
  expect(without).toContain('if (!level().isClientSide()) triggerAnim("attack", "attack");')
  const within = java(compileEntity({ ...plain, runtime, abilities: golemAbilities }))
  // The burst starts 2 blocks out or further: nearer than that and ready, the golem steps back into its window rather than walking up (epic game5).
  expect(within).toContain("if (abilityRunning() || startAbility(target) || abilityBackOff(target)) return;")
  expect(within).toContain("abilityFace(target);\n            // Backwards, not along a path: the vanilla pathfinder finds none for a body this wide (a body several blocks wide gets none and would stand still).\n            getNavigation().stop();\n            getMoveControl().strafe(-1.0f, 0.0f);")
  expect(within).not.toContain("moveTo(target.getX()")
  expect(within).toContain("if (false && runtimeAttackCooldown == 0 && isWithinMeleeAttackRange(target))")
  expect(within).toMatch(/tickRuntime\(\);\n {8}tickAbility\(\);/)
  expect(within).not.toContain("AbilityGoal")
  const facts = readGeneratedCreature(within, null)
  expect(facts.abilities).toEqual([
    // `effects`: the effect assets an ability shows (H3); these two show none. `level_hits` (J2): the ticks of beams kept level; the burst's aim at their target.
    { clip: "slam", windup: 10, length: 24, cooldown: 50, weight: 3, tracks: true, hurt_stops: false, hits: [14], handed: [], effects: [], level_hits: [] },
    { clip: "burst", windup: 16, length: 32, cooldown: 120, weight: 2, tracks: true, hurt_stops: true, hits: [20, 26], handed: [], effects: [], level_hits: [] },
  ])
  expect(facts).toMatchObject({ ability_starter: "RuntimeMovementGoal", ability_alone: true })
  expect(readGeneratedCreature(without, null).ability_starter).toBe("AbilityGoal")
  expect(readGeneratedCreature(without, null).inner).toEqual([{ type: "AbilityGoal", holds: ["MOVE", "LOOK"], seeks: false, wheat: false, lured: false, swings: false, chases: true, starts: true, picks: null }])
})

test("an ability that cannot be played on its model stops the build in the person's words; the rest are findings", () => {
  const made = (abilities: Ability[], model = fightingGolemDesign) => () => compileEntity({ ...plain, model, abilities })
  expect(made([slam], livingGolemDesign as typeof fightingGolemDesign)).toThrow("招式「重锤」要播「slam」这个动作，可是它的模型里没有这个动作")
  expect(made([{ ...slam, clip: "attack" }])).toThrow("全程 1.2 秒，可是它播的动作只有 0.5 秒")
  const clips = fightingGolemDesign.animations
  // The sample's burst hits with the same beam at 1.0 and 1.3 seconds: the second comes inside the game's half second of hurt and does nothing (epic game1).
  expect(abilityIssues({ name: "傀儡", behavior: "hostile", abilities: [slam, burst] }, clips).map((issue) => [issue.rule, issue.ability, issue.stops])).toEqual([["ability_rehit", "burst", false]])
  expect(abilityIssues({ name: "傀儡", behavior: "passive", abilities: [slam] }, clips).map((issue) => issue.rule)).toEqual(["ability_unused"])
  const far = abilityIssues({ name: "傀儡", behavior: "hostile", abilities: [burst, { ...slam, start: { ...slam.start, min_distance: 5, max_distance: 8 } }] }, null)
  // broad12: one that walks steps back into a window it stands nearer than (abilityBackOff), so it is not said to only stand and be hit; one that may not walk still is.
  expect(far.map((issue) => [issue.rule, issue.stops])).toEqual([["ability_rehit", false], ["ability_reach", false]])
  const rooted = abilityIssues({ name: "傀儡", behavior: "hostile", stationary: { reason: "守着" }, abilities: [burst, { ...slam, start: { ...slam.start, min_distance: 5, max_distance: 8 } }] }, null)
  expect(rooted.map((issue) => issue.rule)).toEqual(["ability_gap", "ability_rehit", "ability_reach"])
  expect(rooted[0]!.text).toContain("4 格以内")
  // broad9 w1: a dive flies to where the target stood by its first hit; its distance is closed by the flight, so it is not said to fall short.
  const diving = abilityIssues({ name: "傀儡", behavior: "hostile", abilities: [burst, { ...slam, dive: true, start: { ...slam.start, min_distance: 5, max_distance: 8 } }] }, null)
  expect(diving.map((issue) => issue.rule)).toEqual(["ability_rehit"])
  // Only dives: nothing it can step back for up close.
  expect(abilityIssues({ name: "傀儡", behavior: "hostile", abilities: [{ ...slam, dive: true, start: { ...slam.start, min_distance: 5, max_distance: 8 } }] }, null).map((issue) => issue.rule)).toContain("ability_gap")
  expect(far[1]!.text).toContain("要目标在 5 格以外才用，可是它最远只打得到 2.5 格")
  // A push forward closes the distance: then reaching is not said to be impossible.
  expect(abilityIssues({ name: "傀儡", behavior: "hostile", abilities: [{ ...slam, moves: [{ at: 0.5, forward: 1.2, up: 0.3 }], start: { ...slam.start, min_distance: 1, max_distance: 6 } }] }, null)).toEqual([])
})

test("the golem's sample says nothing of a start window that a bone's sphere cannot cover, and one that is written from an arm does (epic game5)", () => {
  const reach = (abilities: Ability[]) => abilityIssues({ name: "傀儡", behavior: "hostile", abilities }, fightingGolemDesign.animations, fightingGolemDesign as never).filter((issue) => issue.detail.includes("hits meet straight ahead"))
  // The sample hits from the feet: no bone, nothing to measure.
  expect(reach([slam, burst])).toEqual([])
  // The slam as a sphere of 1 held 3 blocks out from the arm (the arm is 0.38 ahead of the feet and 0.44 to the side), for someone 0 to 4 blocks away: straight ahead it meets only 2.5 to 4.2.
  const arm = AbilitySchema.parse({ ...slam, start: { ...slam.start, min_distance: 0, max_distance: 4 }, hits: [{ ...slam.hits[0]!, shape: { type: "sphere", forward: 3, up: 0, left: 0, radius: 1 }, bone: "arm_left" }] })
  const said = reach([arm])
  expect(said).toHaveLength(1)
  expect(said[0]!.stops).toBe(false)
  expect(said[0]!.text).toContain("写的是目标在 0–4 格时开始")
  expect(said[0]!.text).toContain("以「arm_left」为中心半径 1 格的球，正前方只够得到 2.48–4.27 格")
  expect(reach([{ ...arm, start: { ...arm.start, min_distance: 2, max_distance: 4 } }])).toEqual([])
})

// ---- where a hit lands ----

test("a hit shape is measured in the model's own space, and a motion is held against its hit moment", () => {
  const arc = { type: "arc" as const, reach: 2, angle: 90, low: 0, high: 2 }
  expect(abilityPlace(1, 2, 0.5)).toEqual([-8, 32, -16])
  expect(shapeGap(arc, abilityPlace(1, 1, 0))).toBe(0)
  expect(shapeGap(arc, abilityPlace(3, 1, 0))).toBeCloseTo(16)
  expect(shapeGap(arc, abilityPlace(1, 3, 0))).toBeCloseTo(16)
  expect(shapeGap(arc, abilityPlace(-1, 1, 0))).toBeCloseTo(16)
  expect(shapeGap({ type: "box", forward: 2, up: 1, left: 0, width: 2, height: 2, depth: 2 }, abilityPlace(4, 1, 0))).toBeCloseTo(16)
  expect(shapeGap({ type: "sphere", forward: 0, up: 1, left: 0, radius: 1 }, abilityPlace(0, 1, 3))).toBeCloseTo(32)
  expect(shapeGap({ type: "line", up: 1, length: 4, radius: 0.5 }, abilityPlace(6, 1, 0))).toBeCloseTo(24)
  expect(shapeGap({ type: "cone", up: 1, length: 4, angle: 90 }, abilityPlace(2, 1, 1))).toBe(0)

  const found = abilityHitShapes(slam, fightingGolemDesign as never)!
  expect(found).toHaveLength(1)
  expect(found[0]).toMatchObject({ at: 0.7, tick: 14, shot: false, gap: 0, windup: { seconds: 0.5, seen: true } })
  expect(found[0]!.part!.bone).toMatch(/^arm_/)
  expect(found[0]!.arrives).toBe(0.7)
  expect(STRIKE_TOLERANCE).toBe(0.1)
  expect(hitDisagrees(found[0]!)).toBe(false)
  expect(hitLines(slam, found[0]!).join("")).toContain("对得上")
  // Two thrusts, two hit moments: each is held against the thrust nearest to it in time.
  expect(abilityHitShapes(burst, fightingGolemDesign as never)!.map((hit) => hit.arrives)).toEqual([1, 1.3])

  // The damage counted long before the arms come down: said, with by how much and what to write instead.
  const early = { ...slam, windup: 0.1, hits: [{ ...slam.hits[0]!, at: 0.3 }] }
  const off = abilityHitShapes(early, fightingGolemDesign as never)![0]!
  expect(hitDisagrees(off)).toBe(true)
  expect(hitLines(early, off).at(-1)).toStartWith("对不上：动作朝判定范围挥过去的那一下在第 0.7 秒才到位，伤害却在第 0.3 秒就算了，动作晚了 0.4 秒（超过 0.1 秒，也就是两刻，玩家就看得出不同步）。把这一下的时刻（at）改成 0.7")
  // A wind-up nobody can see: the motion barely moves before the hit.
  const still = { ...fightingGolemDesign, animations: [...fightingGolemDesign.animations, { name: "twitch", length: 1.2, loop: false, channels: [{ bone: "head", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [0.3, 0, 0] }, { time: 0.7, rotation: [0, 0, 0] }] }] }] }
  const unseen = abilityHitShapes({ ...slam, clip: "twitch" }, still as never)![0]!
  expect(unseen.windup.seen).toBe(false)
  expect(hitLines({ ...slam, clip: "twitch" }, unseen).join("")).toContain("玩家看不到蓄力")
  expect(abilityHitShapes({ ...slam, clip: "nothing" }, fightingGolemDesign as never)).toBeNull()
  // The same two faults as findings for reconciliation and the card: neither stops a build.
  const named = (abilities: Ability[], design: unknown = fightingGolemDesign) => abilityTimingIssues({ name: "傀儡", behavior: "hostile", abilities }, design as never)
  expect(named([slam, burst])).toEqual([])
  expect(named([early])).toMatchObject([{ rule: "ability_timing", stops: false, fix: "把这一下的时刻（at）改成 0.7，或者改动作让它在第 0.3 秒打到。" }])
  expect(named([{ ...slam, clip: "twitch" }], still).map((issue) => issue.rule)).toEqual(["ability_windup"])
  expect(abilityTimingIssues({ name: "傀儡", behavior: "passive", abilities: [early] }, fightingGolemDesign as never)).toEqual([])
})

// Owner's rule: a legitimate subject always has a legal way out. An aura, a thorn burst, a contact burn and a trap have no wind-up on purpose, and the schema allows a wind-up of 0.
test("a measured fault about an ability is answered by the creature's own justified: the reason stays in the sentence and the sentence is no longer a fault", () => {
  // The hit counts the moment it starts, though the arms of this motion come down at 0.7 s: both a missing wind-up and a stroke that lands late are measured.
  const instant = { ...slam, id: "thorns", windup: 0, hits: [{ ...slam.hits[0]!, at: 0 }] }
  const found = abilityHitShapes(instant, fightingGolemDesign as never)![0]!
  expect(found.windup).toMatchObject({ seconds: 0, seen: false })
  // Unanswered: faults as before, and each says how to answer it.
  const faulty = hitLines(instant, found)
  expect(faulty.filter(abilityFault)).toHaveLength(2)
  expect(faulty.find((line) => line.includes("没有蓄力"))).toStartWith("一开始就判定，没有蓄力：玩家来不及躲。")
  expect(faulty.join("")).toContain(`{"what":"thorns:windup","reason":"……"}`)
  expect(faulty.join("")).toContain(`{"what":"thorns:timing","reason":"……"}`)
  expect(abilityFaultName(instant, "windup")).toBe("thorns:windup")
  // Answered (the name written as a person may write it): said with the reason, and not marked as a fault any more.
  const reason = "荆棘一碰就刺，本来就不蓄力"
  const answered = hitLines(instant, found, [{ what: " Thorns：Windup ", reason }])
  expect(answered.filter(abilityFault)).toHaveLength(1)
  expect(answered.filter(abilityFault)[0]).toStartWith("对不上：")
  expect(answered.join("")).toContain(`一开始就判定，不蓄力（文档的 justified 里写了本来就该这样：${reason}）`)
  expect(hitLines(instant, found, [{ what: "thorns:windup", reason }, { what: "thorns:timing", reason: "判定一开始就算，动作随后才挥到" }]).filter(abilityFault)).toEqual([])
  // Another ability's name, another kind, or no reason at all answers nothing.
  expect(hitLines(instant, found, [{ what: "other:windup", reason }]).filter(abilityFault)).toHaveLength(2)
  expect(hitLines(instant, found, [{ what: "thorns:windup", reason: " " }]).filter(abilityFault)).toHaveLength(2)

  // A wind-up nobody can see (not 0) is answered the same way.
  const still = { ...fightingGolemDesign, animations: [...fightingGolemDesign.animations, { name: "twitch", length: 1.2, loop: false, channels: [{ bone: "head", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [0.3, 0, 0] }, { time: 0.7, rotation: [0, 0, 0] }] }] }] }
  const twitch = { ...slam, id: "twitchy", clip: "twitch" }
  const unseen = abilityHitShapes(twitch, still as never)![0]!
  expect(hitLines(twitch, unseen).filter(abilityFault)).toHaveLength(1)
  expect(hitLines(twitch, unseen, [{ what: "twitchy:windup", reason }]).filter(abilityFault)).toEqual([])

  // A stroke and a hit moment that disagree: answered by `<id>:timing`. The unanswered sentence still starts as it did.
  const early = { ...slam, id: "slam", windup: 0.1, hits: [{ ...slam.hits[0]!, at: 0.3 }] }
  const off = abilityHitShapes(early, fightingGolemDesign as never)![0]!
  expect(hitLines(early, off).filter(abilityFault)).toHaveLength(1)
  expect(hitLines(early, off).at(-1)).toContain('{"what":"slam:timing","reason":"……"}')
  const timed = hitLines(early, off, [{ what: "slam:timing", reason: "这一下故意先算伤害，动作随后才到" }])
  expect(timed.filter(abilityFault)).toEqual([])
  expect(timed.at(-1)).toContain("文档的 justified 里写了本来就该这样：这一下故意先算伤害，动作随后才到")

  // The warnings listed beside the card drop what is answered, and only that.
  const issues = (justified: { what: string; reason: string }[] | null, abilities: Ability[], design: unknown = fightingGolemDesign) => abilityTimingIssues({ name: "傀儡", behavior: "hostile", abilities, justified }, design as never).map((issue) => issue.rule)
  expect(issues(null, [instant])).toEqual(["ability_timing", "ability_windup"])
  expect(issues([{ what: "thorns:windup", reason }], [instant])).toEqual(["ability_timing"])
  expect(issues([{ what: "thorns:windup", reason }, { what: "thorns:timing", reason }], [instant])).toEqual([])
  expect(issues([{ what: "slam:windup", reason }], [early])).toEqual(["ability_timing"])
  expect(issues([{ what: "slam:timing", reason }], [early])).toEqual([])
})

// ---- which motion is started by what ----

test("the binding list says what starts every motion and what nothing does, and agrees with the generated class", () => {
  const rules = [{ trigger: "hurt", action: "play_animation", animation: "roar", enabled: true }]
  const bindings = creatureBindings({ abilities: [slam, burst] }, fightingGolemDesign.animations, rules)
  expect(bindings.clips.map((bound) => [bound.clip, bound.sources.map((source) => source.by)])).toEqual([["idle", ["idle"]], ["walk", ["walk"]], ["hurt", ["hurt"]], ["roar", ["rule"]], ["wave", []], ["death", ["death"]], ["attack", ["attack"]], ["slam", ["ability"]], ["burst", ["ability"]]])
  const lines = bindingLines(bindings)
  expect(lines).toContain(`动作 wave：${NEVER_PLAYED}`)
  expect(lines).toContain("动作 slam：招式「重锤」开始时从头播（蓄力到第 0.5 秒，第 0.7 秒出手，第 1.2 秒结束）")
  expect(lines).toContain("动作 attack：只有玩法代码调用它的 doHurtTarget 时才播（它自己出手用的是招式）")
  expect(lines).toContain("招式「重锤」：用到的都在——动作 slam（1.2 秒）、效果 变慢、声音「铁傀儡挥臂」、粒子 尘土")
  expect(bindingLines(bindings, true).join("\n")).toContain("［ability burst: wind-up to tick 16, hits at tick 20, 26, ends at tick 32］")
  expect(creatureBindings({ abilities: [slam] }, livingGolemDesign.animations).abilities[0]).toMatchObject({ missing: ["动作 slam（模型里没有）"] })
  // The same list read back out of the Java the build writes, with and without a runtime block.
  const logic = [{ id: "11111111-1111-4111-8111-111111111111", entity_id: "11111111-1111-4111-8111-111111111112", trigger: "hurt" as const, action: "play_animation" as const, animation: "roar", enabled: true }]
  ;[{}, { runtime }].forEach((shape) => {
    const read = readGeneratedCreature(java(compileEntity({ ...plain, ...shape, logic, abilities: golemAbilities })), null).plays
    expect(bindings.clips.flatMap((bound) => bound.sources.map((source) => `${bound.clip}:${source.by}`)).sort()).toEqual(read.map((played) => `${played.clip}:${played.by}`).sort())
  })
})

/** The living sample whose golem fights with the two abilities. */
async function fighting() {
  const root = await temporary()
  const directory = path.join(root, "project")
  const project = await createDataGameplaySample(directory, { life: true, abilities: true })
  const source = path.join(root, "source")
  await mkdir(source)
  return { root, directory, project, source, built: await assembleBuildSource(directory, source, TEMPLATE) }
}
const document = <Kind extends ModuleDocument["kind"]>(project: Awaited<ReturnType<typeof fighting>>["project"], kind: Kind) => project.workspace.assets.flatMap((asset) => (asset.document.kind === kind ? [asset.document as Extract<ModuleDocument, { kind: Kind }>] : []))[0]!

test("the sample golem fights with two abilities: the build, the findings, the reviewer's lines and the four questions all say so", async () => {
  const made = await fighting()
  const golem = made.project.entities[0]!
  expect(golem.abilities?.map((ability) => ability.id)).toEqual(["slam", "burst"])
  // Their motions are played, so the one motion nothing starts is still the only one reported.
  expect(playedAnimations(made.project, golem.id, fightingGolemDesign.animations.map((clip) => clip.name))).toEqual(expect.arrayContaining(["slam", "burst"]))
  expect(made.built.findings.filter((finding) => finding.rule === "animation_unplayed").map((finding) => finding.detail)).toEqual([expect.stringContaining("never played: wave;")])
  expect(made.built.findings.filter((finding) => finding.rule.startsWith("ability_")).map((finding) => finding.rule)).toEqual(["ability_rehit"])
  // A model that lost the motion: said by reconciliation as something the build stops on.
  const lost = reconcile({ ...made.project, entities: [{ ...golem, abilities: [{ ...slam, clip: "smash" }] }] }, { animations: { [golem.id]: fightingGolemDesign.animations.map((clip) => clip.name) } })
  expect(lost.filter((finding) => finding.rule === "ability_clip")).toMatchObject([{ stops: true, about: { kind: "entity", id: golem.id } }])
  const mistimed = reconcile({ ...made.project, entities: [{ ...golem, abilities: [{ ...slam, windup: 0.1, hits: [{ ...slam.hits[0]!, at: 0.3 }] }] }] }, { animations: { [golem.id]: fightingGolemDesign.animations.map((clip) => clip.name) } })
  expect(mistimed.filter((finding) => finding.rule === "ability_timing")).toMatchObject([{ stops: false, text: expect.stringContaining("在第 0.7 秒才到位，伤害却在第 0.3 秒就算了") }])
  const contract = (await gameplayContract(made.directory, document(made.project, "gameplay").uses)).join("\n")
  expect(contract).toContain("招式：它有 2 个招式，全部由生成的类在服务端运行")
  expect(contract).toContain("招式「晶刺喷射」：开始时从头播 burst 动作；前 0.8 秒是蓄力，一直转向目标，第 1、1.3 秒出手（第 20、26 刻")
  expect(contract).toContain("wave——没有任何地方会播放它")
  // The sample's gameplay rules on whom the golem fights, so its class goes after its target alone and an ability ends with the target.
  expect(contract).toContain("1 RuntimeMovementGoal（Studio 生成的：有目标时追上去（目标由 targetSelector 或玩法代码定），当下有能用的招式就开始一个，不调用 doHurtTarget；占 MOVE、LOOK）")
  expect(contract).toContain("去打人的行为随后一两刻内停下，进行到一半的招式当刻中断、之后的判定都不会发生。")
  expect(contract).not.toContain("没有读到")
  const reaction = creatureFacets(document(made.project, "entity"), made.project).find((facet) => facet.question === "reaction")!
  expect(reaction).toMatchObject({ answered: true })
  expect(reaction.words).toContain("出手用招式：「重锤」（目标在 0–2.8 格、看得见的时候）、「晶刺喷射」（目标在 4–10 格、看得见的时候）")
  expect(reaction.detail).toContain("动作 wave：没有任何地方会播放它")
  // The needed motions follow from the abilities: a model without them is told which, with their timing.
  expect(creatureClipFindings(golem, livingGolemDesign.animations.map((clip) => clip.name)).map((finding) => finding.clip)).toEqual(["slam", "burst"])
  expect(creatureClipFindings(golem, livingGolemDesign.animations.map((clip) => clip.name))[0]!.fix).toContain("打到的那一下落在第 0.7 秒")
})

test.skipIf(!hasTargetJavac(OFFICIAL))("the sample's whole generated tree compiles against Minecraft 1.21.1 (Mojang's names) and GeckoLib 4.8.3", async () => {
  const made = await fighting()
  const compiled = (await compileTreeFor(OFFICIAL, made.source))!
  expect(compiled.output).not.toContain("error")
  expect(compiled.code).toBe(0)
}, 120000)

test.skipIf(!hasTargetJavac(OFFICIAL))("every shape, every projectile and every word of the vocabulary compiles against the game", async () => {
  const root = await temporary()
  const area = (shape: unknown, at: number) => ({ type: "area", at, shape, hits: "target", damage: 2, knockback: 0, effects: Object.keys(ABILITY_EFFECTS).map((effect) => ({ effect, duration_ticks: 20, amplifier: 0 })) })
  const every = [
    { ...golemAbilities[0], moves: [{ at: 0.5, forward: 0.8, up: 0.42 }], hits: [area({ type: "arc", reach: 3, angle: 360, low: 0, high: 2 }, 0.6), area({ type: "box", forward: 2, up: 1, left: 0, width: 2, height: 2, depth: 2 }, 0.7), area({ type: "sphere", forward: 2, up: 1, left: 0, radius: 2 }, 0.8), area({ type: "line", up: 1.5, length: 8, radius: 0.5 }, 0.9), area({ type: "cone", up: 1.5, length: 6, angle: 60 }, 1)] },
    { ...golemAbilities[1], facing: "lock", hits: (["arrow", "snowball", "small_fireball", "fireball"] as const).map((projectile, index) => ({ type: "shot", at: 0.8 + index * 0.2, projectile, speed: 1.6, forward: 1, up: 1.5, damage: projectile === "arrow" ? 6 : null })) },
  ]
  await Promise.all(
    [{}, { runtime }].map(async (shape, index) => {
      const files = compileEntity({ ...plain, ...shape, classSuffix: index ? "B" : "", abilities: every })
      await writeFile(path.join(root, `StudioCreature${index ? "B" : ""}.java`), String(Object.entries(files).find((entry) => entry[0].includes("/entity/StudioCreature"))![1]))
    }),
  )
  await writeFile(
    path.join(root, "Vocabulary.java"),
    `import net.minecraft.core.particles.ParticleOptions; import net.minecraft.core.particles.ParticleTypes; import net.minecraft.sounds.SoundEvent; import net.minecraft.sounds.SoundEvents;
final class Vocabulary {
    static final SoundEvent[] SOUNDS = { ${Object.keys(ABILITY_SOUNDS).map((id) => `SoundEvents.${soundConstant(id)}`).join(", ")} };
    static final ParticleOptions[] PARTICLES = { ${Object.keys(ABILITY_PARTICLES).map((id) => `ParticleTypes.${id.toUpperCase()}`).join(", ")} };
}
`,
  )
  const compiled = await targetJavac(OFFICIAL, root)
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 120000)

// ---- the words an AI is given ----

test("whoever writes a creature is told the fields, the units and what abilities cannot do", () => {
  expect(MODULES.entity.instructions).toContain(ABILITY_INSTRUCTIONS)
  ;["windup", "stopped_by_hurt", "0.05 秒", "line_of_sight", "要写玩法代码", "那一刻", '"type":"arc"'].forEach((word) => expect(ABILITY_INSTRUCTIONS).toContain(word))
  expect(MODULES.entity.summary).toContain("招式（abilities）")
  expect(MODULES.model.instructions).toContain("每个招式的 clip 都要在模型里有一个同名的、不循环的动作")
  // The example in the instructions is a document the schema takes.
  const example = /例：(\{"id":"slam".*\})。$/.exec(ABILITY_INSTRUCTIONS)?.[1]
  expect(AbilitySchema.safeParse(JSON.parse(example!)).success).toBe(true)
})

// ---- a hit that pulls (broad11 w4b: "the tongue pulls the player in" had to be faked, a knockback could only push) ----

const pulling = (knockback: number): Ability => ({ ...slam, hits: [{ ...(slam.hits[0] as Extract<Ability["hits"][number], { type: "area" }>), hits: "target", damage: 0, knockback, effects: [] }] })

test("a negative knockback is a pull: bounded like a push, said in plain words, and written into the class only when some hit has one", () => {
  expect(refused({ hits: [{ ...slam.hits[0], knockback: -ABILITY_LIMITS.knockback }] })).toBe("")
  expect(refused({ hits: [{ ...slam.hits[0], knockback: -ABILITY_LIMITS.knockback - 0.1 }] })).not.toBe("")
  expect(refused({ hits: [{ ...slam.hits[0], knockback: ABILITY_LIMITS.knockback + 0.1 }] })).not.toBe("")
  expect(abilityWords.hit(pulling(-0.8).hits[0]!)).toContain("被拉过去")
  expect(abilityWords.hit(pulling(-0.8).hits[0]!)).not.toContain("被打退")
  expect(abilityWords.hit(pulling(0.8).hits[0]!)).toContain("被打退")
  expect(ABILITY_INSTRUCTIONS).toContain("写负数就反过来，是把人朝它拉过来")
  // What the guide asks the person to look for is what the hits do.
  expect(abilityWords.felt(pulling(-0.8))).toBe("被拉过来")
  expect(abilityWords.felt(slam)).toBe("掉血、被推开、变慢")
  expect(abilityWords.felt(burst)).toContain("掉血")
  expect(abilityWords.felt({ ...pulling(0), hits: [{ ...(pulling(0).hits[0] as Extract<Ability["hits"][number], { type: "area" }>), effects: [{ effect: "poison", duration_ticks: 60, amplifier: 0 }] }] })).toBe("中毒")
  expect(abilityWords.felt(pulling(0))).toBeNull()
  const pulled = String(Object.entries(compileEntity({ ...plain, abilities: [pulling(-0.8)] })).find((entry) => entry[0].includes("/entity/StudioCreature"))![1])
  expect(pulled).toContain("abilityPull(victim, -knockback)")
  expect(pulled).toContain("victim.setDeltaMovement(")
  expect(pulled).toContain("victim.hurtMarked = true")
  // Creatures that only push are written exactly as before: no pull in them at all.
  for (const abilities of [[slam, burst], [pulling(0.8)], [pulling(0)]]) expect(java(compileEntity({ ...plain, abilities }))).not.toContain("abilityPull")
})

test.skipIf(!hasTargetJavac(OFFICIAL))("a class with a pulling hit compiles against the game, plain and living", async () => {
  const root = await temporary()
  await Promise.all(
    [{}, { runtime }].map(async (shape, index) => {
      const files = compileEntity({ ...plain, ...shape, classSuffix: index ? "B" : "", abilities: [pulling(-0.8), burst] })
      await writeFile(path.join(root, `StudioCreature${index ? "B" : ""}.java`), String(Object.entries(files).find((entry) => entry[0].includes("/entity/StudioCreature"))![1]))
    }),
  )
  const compiled = await targetJavac(OFFICIAL, root)
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 120000)

// broad11 w4b: every ability's test step said 「你掉血、被推开」, of a hit that did neither.
test("the guide's step for an ability asks the person to look for what that ability's hits do", async () => {
  const made = await fighting()
  const lines = made.built.guide.sections.flatMap((section: { lines: { text: string }[] }) => section.lines.map((line) => line.text)) as string[]
  const step = (name: string) => lines.find((line: string) => line.includes(`的招式「${name}」`)) ?? ""
  expect(step("重锤")).toContain(`和你${abilityWords.felt(slam)}，是不是同一刻`)
  expect(step("重锤")).toContain("掉血、被推开、变慢")
  expect(step("晶刺喷射")).toContain(`和你${abilityWords.felt(burst)}，是不是同一刻`)
  // A hit that only pulls, and one that does nothing to anybody, are not said to hurt or push.
  const named = { ...made.project, entities: [{ ...made.project.entities[0]!, abilities: [{ ...pulling(-0.8), name: "舌头" }, { ...pulling(0), id: "calm", name: "亮相" }] }] }
  const again = modGuide(named, { findings: [], animations: {}, glowing: [], built: false }).sections.flatMap((section) => section.lines.map((line) => line.text))
  const tongue = again.find((line) => line.includes("的招式「舌头」")) ?? ""
  expect(tongue).toContain("和你被拉过来，是不是同一刻")
  expect(tongue).not.toMatch(/掉血|被推开/)
  const calm = again.find((line) => line.includes("的招式「亮相」")) ?? ""
  expect(calm).toContain("这一招不会伤到你，也不会推你拉你")
  expect(calm).not.toContain("是不是同一刻")
})
