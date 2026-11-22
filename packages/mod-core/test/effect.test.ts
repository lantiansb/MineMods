import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { posedCorners } from "@minemods/studio-ai/model-motion"
import { ModelDesignSchema, ModelShapeSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import { LOOKED_KINDS } from "@minemods/studio-ai/making"
import { textureSizes } from "@minemods/studio-ai/budget"
import { TEXTURE_SPACE_ERROR, modelAtlas } from "@minemods/studio-ai/model-paint"
import { z } from "zod"
import { createHash } from "node:crypto"
import { EFFECT_LIMITS, EFFECT_ZONE_TOLERANCE } from "../src/ability-words"
import { reviewAsset } from "../src/acceptance"
import { assembleBuildSource } from "../src/build-source"
import { ABILITY_INSTRUCTIONS, creatureBindings } from "../src/creature-abilities"
import { gameplayContract } from "../src/creature-contract"
import { creatureFacets } from "../src/creature-life"
import { EFFECT_FLAW_LINE, EFFECT_INSTRUCTIONS, EFFECT_SUMMARY, EFFECT_TEXTURE_REFUSAL, EFFECT_TEXTURE_SIZES, EFFECT_UNPLAYED_MARK, EffectDocumentSchema, effectLines, effectMeasure, effectModel, effectName, effectPlan, effectStep, effectTexture, effectTicks, effectUnplayed, effectUnplayedLine, type EffectDocument } from "../src/effect"
import { compileEffectModel, effectBuildFault } from "../src/effect-build"
import { abilityEffectIssues, abilityEffectLines, abilityEffectPlan, effectCorners, effectDisagrees, effectEvents, effectLookup, effectPlaces, effectsAlive, effectsShown, hitCentre, stagedDesign, type EffectEvent } from "../src/effect-abilities"
import { AbilitySchema, type Ability } from "../src/entity-runtime"
import { compileEffects } from "../src/fabric/effect"
import { compileEntity } from "../src/fabric/entity"
import { compileAbilities } from "../src/fabric/entity-abilities"
import { projectContentSource } from "../src/fabric/gameplay"
import { gameplayThings } from "../src/gameplay"
import { checkGameplayReferences } from "../src/gameplay-references"
import { appliesTo } from "../src/playable"
import { decodeRgbaPng } from "../src/png-decode"
import { ProjectSchema } from "../src/project"
import { reconcile } from "../src/reconcile"
import { WorkspaceSchema, type ModuleDocument } from "../src/workspace"
import { MODULES } from "../src/workspace-modules"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities, golemAbilitiesWithEffects, golemEffects } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac, targetJavac } from "./target-javac"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const IDS = { mark: "11111111-1111-4111-8111-aaaaaaaaaaaa", spike: "11111111-1111-4111-8111-bbbbbbbbbbbb" }
const mark = EffectDocumentSchema.parse(golemEffects.mark.document)
const spike = EffectDocumentSchema.parse(golemEffects.spike.document)
const lookup = (id: string) => (id === IDS.mark ? { title: golemEffects.mark.title, document: mark } : id === IDS.spike ? { title: golemEffects.spike.title, document: spike } : null)
const [slam, burst] = golemAbilitiesWithEffects(IDS).map((ability) => AbilitySchema.parse(ability)) as [Ability, Ability]
const shows = (ability: Ability, change: Partial<EffectEvent>) => AbilitySchema.parse({ ...ability, events: ability.events.map((event) => (event.type === "effect" ? { ...event, ...change } : event)) })
const refused = (change: Record<string, unknown>) => EffectDocumentSchema.safeParse({ ...golemEffects.mark.document, ...change }).error?.issues.map((issue) => issue.message).join(" ") ?? ""

// ---- the document ----

test("an effect is a small model with a life of its own: bounded, and refused in plain words", () => {
  expect(mark.animations.map((clip) => clip.name)).toEqual(["open"])
  // Round 17: it has none of a creature's three motions, and nothing that draws or compiles it is handed them: whoever lists its motions sees the one it plays.
  expect(effectModel(mark).animations.map((clip) => clip.name)).toEqual(["open"])
  expect(refused({ play: { ...golemEffects.mark.document.play, clip: "close" } })).toContain("这个效果自己的动作里没有它（有：open）")
  expect(refused({ play: { ...golemEffects.mark.document.play, lifetime: EFFECT_LIMITS.seconds + 1 } })).not.toBe("")
  expect(refused({ play: { ...golemEffects.mark.document.play, opacity: 0.05 } })).not.toBe("")
  const cube = golemEffects.mark.document.bones[0].cubes[0]
  expect(refused({ bones: [{ ...golemEffects.mark.document.bones[0], cubes: Array.from({ length: EFFECT_LIMITS.cubes + 1 }, (_, index) => ({ ...cube, name: `cube${index}` })) }] })).toContain(`一个效果最多 ${EFFECT_LIMITS.cubes} 个方块`)
  expect(refused({ bones: Array.from({ length: EFFECT_LIMITS.bones + 1 }, (_, index) => ({ name: `bone${index}`, parent: index ? "bone0" : null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: index ? [] : [cube] })) })).toContain(`一个效果最多 ${EFFECT_LIMITS.bones} 根骨骼`)
  // What a model document checks about its own structure holds here too.
  expect(refused({ bones: [golemEffects.mark.document.bones[0], { ...golemEffects.mark.document.bones[1], parent: null }] })).toContain("Exactly one root bone is required")
  expect(effectName(IDS.mark)).toBe("effect_11111111111141118111aaaaaaaaaaaa")
})

// Round 17: 「动画为什么会有这么多个状态呢」. An effect made through the model contract showed idle, walk and hurt beside the one motion it plays.
test("an effect is asked for, compiled and drawn with only the motion it plays; a creature's three in one are motions nothing plays", () => {
  // The contract: a creature's model must carry the three; the same shape for anything else must not be asked for them.
  const { kind: _kind, play: _play, ...shape } = golemEffects.mark.document
  expect(ModelShapeSchema.safeParse(shape).success).toBe(true)
  expect(ModelDesignSchema.safeParse(shape).error?.issues.map((issue) => issue.message).join(" ")).toContain("Idle, walk and hurt animations are required")
  expect(ModelShapeSchema.safeParse({ ...shape, animations: [shape.animations[0], shape.animations[0]] }).error?.issues.map((issue) => issue.message)).toContain("Animation names must be unique")
  // What is built: the one motion, in a file that names no other.
  const built = compileEffects({ modId: "storm", packageName: "com.example.storm", effects: [{ id: IDS.mark, title: golemEffects.mark.title, document: mark }] }).files
  const motions = JSON.parse(built[`src/main/resources/assets/storm/animations/${effectName(IDS.mark)}.animation.json`] as string) as { animations: Record<string, unknown> }
  expect(Object.keys(motions.animations)).toEqual([`animation.${effectName(IDS.mark)}.open`])
  // What it is told: no word that asks for the three, and the one sentence that says what happens to a motion nothing plays.
  expect(EFFECT_INSTRUCTIONS).toContain("动作只写它要播的那一个")
  expect(EFFECT_SUMMARY).toContain("没有生物的 idle/walk/hurt")
  expect(effectUnplayed(mark)).toEqual([])
  expect(effectUnplayedLine(mark)).toBeNull()
  // An effect that carries them all the same (the one the owner saw, or one written by an AI that took the model contract's rule for its own):
  // it still parses and still builds (the same files; its own motions are written as they always were), and the three are named as what they are. No list of names decides it: any motion but the played one is one.
  const still = (name: string) => ({ name, length: 1, loop: true, channels: [{ bone: mark.bones[0]!.name, keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] })
  const carried = EffectDocumentSchema.parse({ ...golemEffects.mark.document, animations: [...golemEffects.mark.document.animations, still("idle"), still("walk"), still("hurt")] })
  expect(effectUnplayed(carried)).toEqual(["idle", "walk", "hurt"])
  expect(effectUnplayedLine(carried)).toStartWith(EFFECT_UNPLAYED_MARK)
  expect(effectUnplayedLine(carried)).toContain("只播 play.clip 写的「open」这一个")
  expect(effectUnplayed(EffectDocumentSchema.parse({ ...golemEffects.mark.document, animations: [...golemEffects.mark.document.animations, still("fade")] }))).toEqual(["fade"])
  const old = compileEffects({ modId: "storm", packageName: "com.example.storm", effects: [{ id: IDS.mark, title: golemEffects.mark.title, document: carried }] }).files
  expect(Object.keys(old).sort()).toEqual(Object.keys(built).sort())
  expect(Object.keys((JSON.parse(old[`src/main/resources/assets/storm/animations/${effectName(IDS.mark)}.animation.json`] as string) as { animations: Record<string, unknown> }).animations)).toHaveLength(4)
})

test("an effect has no picture in its document: the one it wears is painted from its cubes, the same pixels the build writes", () => {
  expect(JSON.stringify(mark)).not.toContain("data:image")
  const built = compileEffects({ modId: "storm", packageName: "com.example.storm", effects: [{ id: IDS.mark, title: golemEffects.mark.title, document: mark }] }).files
  const written = decodeRgbaPng(built[`src/main/resources/assets/storm/textures/entity/${effectName(IDS.mark)}.png`] as Uint8Array)
  const worn = effectTexture(mark)!
  expect([written.width, written.height]).toEqual([worn.size, worn.size])
  expect(Buffer.from(worn.pixels).equals(Buffer.from(written.pixels))).toBe(true)
  // Something is on it, and every face of every cube has its place.
  expect(worn.pixels.some((value) => value > 0)).toBe(true)
  expect(worn.islands).toHaveLength(mark.bones.reduce((sum, bone) => sum + bone.cubes.length, 0) * 6)
})

test("an ability names an effect by where it is put: its own feet, its target's, or the middle of one of its hits", () => {
  expect(effectEvents(slam).map((found) => found.event.where)).toEqual(["hit"])
  const wrong = (change: Partial<EffectEvent>) => AbilitySchema.safeParse({ ...golemAbilitiesWithEffects(IDS)[0], events: [{ ...effectEvents(slam)[0]!.event, ...change }] }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  expect(wrong({ hit: null })).toContain('where 写 "hit" 或者 along 写 "aim" 的时候用 hit 写是第几次出手')
  // J2: along a hit's aim only when that hit has one (the slam's arc has none).
  expect(wrong({ along: "aim" })).toContain("它没有瞄的方向")
  expect(wrong({ where: "self" })).toContain("其余时候 hit 写 null")
  expect(wrong({ hit: 1 })).toContain("这个招式只有 1 次出手")
  expect(wrong({ count: EFFECT_LIMITS.count + 1 })).not.toBe("")
  expect(wrong({ at: 2 })).toContain("不能比招式全长（length）还晚")
  // The middle of an arc is half its reach ahead, between its low and high; of a line, half its length along the aim.
  expect(hitCentre(slam.hits[0]!)).toEqual({ forward: 1.25, up: 1, left: 0, aimed: false })
  expect(hitCentre(burst.hits[0]!)).toEqual({ forward: 4.5, up: 1.2, left: 0, aimed: true })
})

// ---- where and when ----

test("places are plain arithmetic in the creature's own terms: a row ahead, a circle turned outward", () => {
  const row = effectEvents(burst)[0]!.event
  expect(effectPlaces(burst, row).map((place) => place.forward)).toEqual([1.5, 3, 4.5, 6, 7.5, 9])
  expect(effectPlaces(burst, row).every((place) => place.left === 0 && place.up === 0 && place.turn === 0)).toBe(true)
  const circle = effectPlaces(slam, { ...effectEvents(slam)[0]!.event, where: "self", hit: null, count: 4, layout: "ring", spread: 2 })
  // Ahead, to its left, behind, to its right: each turned the way it lies from the middle.
  expect(circle).toEqual([{ forward: 2, up: 0, left: 0, turn: 0 }, { forward: 0, up: 0, left: 2, turn: 90 }, { forward: -2, up: 0, left: 0, turn: 180 }, { forward: 0, up: 0, left: -2, turn: 270 }].map((place) => ({ ...place, pitch: 0, spin: 0 })))
  // One put on a hit stands at the hit's middle plus its own offsets; one that faces the target is turned to where the target is taken to stand.
  expect(effectPlaces(slam, effectEvents(slam)[0]!.event)).toEqual([{ forward: 1.25, up: 1, left: 0, turn: 0, pitch: 0, spin: 0 }])
  expect(effectPlaces(slam, { ...effectEvents(slam)[0]!.event, where: "self", hit: null, left: 1.4 }, "target")[0]!.turn).toBe(-45)
})

test("an effect's times are the ability's own ticks: when it appears, when it is gone, how many there are at once", () => {
  expect(effectTicks(0.8)).toBe(16)
  expect(effectTicks(0.01)).toBe(1)
  // The mark: appears on tick 2, eight ticks before getting ready ends and twelve before the hit; gone on tick 18.
  expect(abilityEffectPlan(slam, lookup)).toMatchObject([{ tick: 2, windup: 10, hit: { index: 0, tick: 14 }, gone: 18, count: 1, ends_with_owner: true }])
  // The spikes: six with each thrust, the first six still there when the second six appear.
  const spikes = abilityEffectPlan(burst, lookup)
  expect(spikes.map((plan) => [plan.tick, plan.gone, plan.hit.tick])).toEqual([[20, 30, 20], [26, 36, 26]])
  expect(effectsAlive(spikes)).toBe(12)
  expect(effectsShown(burst, lookup, 1.3).map((shown) => shown.age)).toEqual([...Array.from({ length: 6 }, () => 0.3), ...Array.from({ length: 6 }, () => 0)])
  expect(effectsShown(burst, lookup, 1.5).length).toBe(6)
  expect(effectsShown(burst, lookup, 0.9)).toEqual([])
  // An effect nobody made is not known to appear at all.
  expect(abilityEffectPlan(slam, () => null)).toMatchObject([{ gone: null, title: null }])
  const lines = abilityEffectLines(slam, lookup)
  expect(lines[0]).toContain("效果「落点标记」在第 0.1 秒出现：比蓄力结束早 0.4 秒，比第 0.7 秒的出手早 0.6 秒（玩家有这么长时间先看到它）；第 0.9 秒消失。招式被打断或者它自己死了，效果立刻消失。")
  expect(abilityEffectLines(burst, lookup).filter((line) => line.includes("秒出现"))[1]).toContain("第 1.8 秒消失，招式结束以后还留 0.2 秒。招式被打断它也照样留到时间结束。")
})

test("the life of one effect is a pure function: its time runs out, or what ends it with its owner does", () => {
  const plan = effectPlan(mark.play)
  expect(plan).toEqual({ ticks: 16, follow: true, ends_with_owner: true })
  const lived = (steps: number, input: Parameters<typeof effectStep>[2]) => Array.from({ length: steps }).reduce<ReturnType<typeof effectStep>>((state) => (state.ended ? state : effectStep(plan, state.lived, input)), { lived: 0, ended: null, follows: false })
  // It follows while it has someone alive to follow, and is gone on the tick its time is up.
  expect(lived(15, { owner: "alive", cut: false })).toEqual({ lived: 15, ended: null, follows: true })
  expect(lived(16, { owner: "alive", cut: false })).toEqual({ lived: 16, ended: "time", follows: false })
  expect(lived(40, { owner: "alive", cut: false }).lived).toBe(16)
  // Its owner gone, or the ability cut short: at once, when it is made to end with them.
  expect(effectStep(plan, 3, { owner: "gone", cut: false })).toEqual({ lived: 4, ended: "owner", follows: false })
  expect(effectStep(plan, 3, { owner: "alive", cut: true })).toEqual({ lived: 4, ended: "cut", follows: false })
  // One shown without an owner neither follows nor ends early; one not made to end with its owner lives out its time.
  expect(effectStep(plan, 3, { owner: "none", cut: false })).toEqual({ lived: 4, ended: null, follows: false })
  const stays = effectPlan(spike.play)
  expect(effectStep(stays, 3, { owner: "gone", cut: true })).toEqual({ lived: 4, ended: null, follows: false })
  expect(effectStep(stays, 9, { owner: "gone", cut: true })).toEqual({ lived: 10, ended: "time", follows: false })
})

// ---- what is measured ----

test("what an effect does over its life is measured and said: how long, whether it can be seen to change, how it comes and goes", () => {
  const found = effectMeasure(spike)!
  expect(found.ticks).toBe(10)
  expect(found.poses).toHaveLength(11)
  // The spike is at its fullest two ticks in, taller than it is built (it overshoots), and next to nothing at both ends.
  expect(found.peak.tick).toBe(2)
  expect(found.size.peak[1]).toBeGreaterThan(1.2)
  expect(found.across.first).toBeLessThan(found.across.most * 0.3)
  expect(found.motion.unseen).toBe(false)
  expect(effectLines(spike).join("")).not.toMatch(/没有长出来的过程|一下子不见|看不出任何变化/)
  // One that never changes is said to: it pops in whole and pops out whole.
  const still: EffectDocument = { ...mark, animations: [{ name: "open", length: 0.8, loop: false, channels: [{ bone: "frame", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.8, rotation: [0, 0, 0] }] }] }] }
  const told = effectLines(still).join("")
  expect(told).toContain("它从出现到消失看不出任何变化")
  expect(told).toContain("它一出现就是差不多完整的大小，没有长出来的过程。消失的那一刻它还是差不多完整的大小，会是一下子不见。")
  // A motion longer than the life is cut; a shorter one holds its last pose.
  expect(effectLines({ ...mark, play: { ...mark.play, lifetime: 0.5 } })[0]).toContain("动作还没播完它就消失了：最后 0.3 秒玩家看不到。")
  expect(effectLines({ ...mark, play: { ...mark.play, lifetime: 1.2 } })[0]).toContain("它保持最后的样子 0.4 秒才消失")
  // Nothing about an effect is refused by a measurement, and no playability question is asked of it: it is a part.
  expect(reviewAsset(ProjectSchema.parse(SHELL), { id: IDS.mark, module: "effect", document: still, dependencies: [] })).toMatchObject({ passed: true, findings: [] })
  expect(appliesTo("effect")).toEqual([])
})

// broad21 P2-03: a spike that moves up out of the ground and sinks back was said to have "no growing in and a sudden vanish", because its shape is the same size the whole time.
test("a thing that rises out of the ground by moving is not said to have no growing: the size of the whole shape and the part standing above the ground are two measures", () => {
  const rises = (extra: Partial<EffectDocument["play"]> = {}, depth = 17): EffectDocument => ({
    ...spike,
    animations: [
      {
        name: "rise",
        length: 0.5,
        loop: false,
        channels: [{ bone: "root", keyframes: [], position: [{ time: 0, position: [0, -depth, 0] }, { time: 0.15, position: [0, 0, 0] }, { time: 0.35, position: [0, 0, 0] }, { time: 0.5, position: [0, -depth, 0] }] }],
      },
    ],
    play: { ...spike.play, ...extra },
  })
  const found = effectMeasure(rises())!
  // The shape is as big at the first moment as at the fullest: the old measure alone said it pops in and vanishes.
  expect(found.across.first).toBeCloseTo(found.across.most, 1)
  expect(found.across.last).toBeCloseTo(found.across.most, 1)
  // What stands above the ground is nothing, then all of it, then nothing again.
  expect(found.base.under).toBe(true)
  expect(found.base.size.first[1]).toBe(0)
  expect(found.base.size.peak[1]).toBeGreaterThan(1)
  expect(found.base.size.last[1]).toBe(0)
  // The fullest moment is when it is risen, not the first tick the box is as large as it ever is.
  expect(found.peak.seconds).toBeGreaterThanOrEqual(0.15)
  expect(found.peak.seconds).toBeLessThanOrEqual(0.35)
  const told = effectLines(rises()).join("")
  expect(told).not.toMatch(/没有长出来的过程|一下子不见|不是从小变大出来的|不是缩小着消失的/)
  expect(told).toContain("其中露在地面上的部分：出现的那一刻 0×0×0 格")
  expect(told).toContain("整个形状的大小从头到尾差不多不变，它升起、缩回靠的是位置在动，不是在变大变小")
  // Not put on the ground: the part above the model's base plane, said as that, not as ground.
  expect(effectLines(rises({ on_ground: false })).join("")).toContain("其中高出它底面的部分")
  // Nothing in the card's notes for it (they pick out the defects only).
  expect(effectLines(rises()).filter((line) => EFFECT_FLAW_LINE.test(line))).toEqual([])
  // The same spike that never moves is all above the ground and the old words still hold: it pops in whole and out whole.
  const frozen = { ...rises(), animations: [{ name: "rise", length: 0.5, loop: false, channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] as [number, number, number] }] }] }] } as EffectDocument
  expect(effectMeasure(frozen)!.base.under).toBe(false)
  expect(effectLines(frozen).join("")).toContain("没有长出来的过程。消失的那一刻它还是差不多完整的大小，会是一下子不见。")
  // One that sinks partway and stays sunk under the ground the whole time never grows or shrinks either way: still said to pop.
  const sunk = { ...rises(), animations: [{ name: "rise", length: 0.5, loop: false, channels: [{ bone: "root", keyframes: [], position: [{ time: 0, position: [0, -6, 0] }, { time: 0.5, position: [0, -6, 0] }] }] }] } as EffectDocument
  expect(effectMeasure(sunk)!.base.under).toBe(true)
  expect(effectLines(sunk).join("")).toContain("没有长出来的过程")
  // One that slides sideways whole is not said to have "no growing": it does change, only not in size.
  const slides = effectLines({ ...rises(), animations: [{ name: "rise", length: 0.5, loop: false, channels: [{ bone: "root", keyframes: [], position: [{ time: 0, position: [0, 0, 0] }, { time: 0.5, position: [40, 0, 0] }] }] }] } as EffectDocument).join("")
  expect(slides).toContain("不是从小变大出来的（变的是位置或角度）")
  expect(slides).not.toContain("没有长出来的过程")
  // What an AI is told of making one counts moving out of the ground as growing.
  expect(EFFECT_INSTRUCTIONS).toContain("position 轨道让它从地面以下升出来再沉回去")
})

test("an effect put on a hit that lies elsewhere is a finding with a named tolerance; the rest are facts", () => {
  expect(abilityEffectLines(slam, lookup).filter(effectDisagrees)).toEqual([])
  expect(abilityEffectLines(slam, lookup)[1]).toContain("中心都在第 1 次出手的判定范围里")
  const off = shows(slam, { forward: 2.6, left: 1.5 })
  const said = abilityEffectLines(off, lookup).filter(effectDisagrees)
  expect(said).toHaveLength(1)
  expect(said[0]).toContain(`它的中心在判定范围外面 1.63 格（超过 ${EFFECT_ZONE_TOLERANCE} 格`)
  // The same effect put at its own feet is nobody's mark of a hit: where it lies is only said.
  expect(abilityEffectLines(shows(slam, { where: "self", hit: null, forward: -4 }), lookup).filter(effectDisagrees)).toEqual([])
  expect(abilityEffectIssues({ name: "晶石傀儡", abilities: [off] }, lookup)).toMatchObject([{ ability: "slam", rule: "effect_zone", stops: false }])
  expect(abilityEffectIssues({ name: "晶石傀儡", abilities: [slam] }, () => null)).toMatchObject([{ rule: "effect_missing", stops: true }])
  // More at once than may exist round one creature: the rest would not appear.
  const crowd = AbilitySchema.parse({ ...burst, events: Array.from({ length: 3 }, () => ({ ...effectEvents(burst)[0]!.event, count: 12 })) })
  expect(abilityEffectIssues({ name: "晶石傀儡", abilities: [crowd] }, lookup).map((issue) => issue.rule)).toEqual(["effect_alive"])
  expect(abilityEffectIssues({ name: "晶石傀儡", abilities: [crowd] }, lookup)[0]!.text).toContain(`同一时间最多会有 36 个效果，一只生物身边最多同时有 ${EFFECT_LIMITS.alive} 个`)
})

test("the creature and its effects drawn as one model stand exactly where the arithmetic puts them", () => {
  const creature = fightingGolemDesign as unknown as ModelDesign
  const place = { forward: 2, up: 0.5, left: 1, turn: 40, pitch: 0, spin: 0 }
  const merged = stagedDesign(creature, "slam", [{ document: spike, place, age: 0.12 }])
  expect(merged.drawn).toBe(1)
  const clip = merged.design.animations.find((animation) => animation.name === "slam")!
  const all = posedCorners(merged.design, clip, 0.7)
  const own = posedCorners(creature, creature.animations.find((animation) => animation.name === "slam")!, 0.7)
  const apart = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((value, axis) => value - b[axis]!))
  // The creature is where it was, and every corner of the effect is where `effectCorners` says.
  expect(Math.max(...own.map((point, index) => apart(point, all[index]!)))).toBeLessThan(1e-9)
  expect(Math.max(...effectCorners(spike, place, 0.12).map((point, index) => apart(point, all[own.length + index]!)))).toBeLessThan(1e-9)
  // J2: one that is tilted and turned about its tilted upright stands where the same arithmetic says, turn inside tilt inside turn.
  const leaning = { forward: 2, up: 1.5, left: -1, turn: 25, pitch: 30, spin: 70 }
  const tilted = stagedDesign(creature, "slam", [{ document: spike, place: leaning, age: 0.12 }])
  expect(Math.max(...effectCorners(spike, leaning, 0.12).map((point, index) => apart(point, posedCorners(tilted.design, tilted.design.animations.find((animation) => animation.name === "slam")!, 0.7)[own.length + index]!)))).toBeLessThan(1e-9)
  // A model document holds only so much: what does not fit is counted, never half drawn.
  expect(stagedDesign(creature, "slam", Array.from({ length: 40 }, (_, index) => ({ document: spike, place: { ...place, forward: index * 0.2 }, age: 0.1 }))).drawn).toBeLessThan(40)
  expect(stagedDesign(creature, "slam", [{ document: spike, place: { ...place, forward: 40 }, age: 0.1 }]).drawn).toBe(0)
})

// ---- the generated mod ----

const SHELL = { schema_version: 1, id: "11111111-1111-4111-8111-000000000001", name: "空", description: "", mod_id: "shell_mod", target: "fabric-1.21.1", revision: 0, created_at: "2026-10-06T00:00:00.000Z", updated_at: "2026-10-06T00:00:00.000Z", entities: [], assets: [], blocks: [], items: [], recipes: [], logic: [] } as const

async function sample(effects: boolean) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-effects-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const project = await createDataGameplaySample(directory, { life: true, abilities: true, effects })
  const source = path.join(root, "source")
  await mkdir(source)
  return { directory, project, source, built: await assembleBuildSource(directory, source, TEMPLATE) }
}
const document = <Kind extends ModuleDocument["kind"]>(project: Awaited<ReturnType<typeof sample>>["project"], kind: Kind) => project.workspace.assets.flatMap((asset) => (asset.document.kind === kind ? [asset.document as Extract<ModuleDocument, { kind: Kind }>] : []))[0]!

test("abilities that show no effect generate no effect code at all", () => {
  const made = compileAbilities({ entity: "StudioCreature", model: "creature", abilities: golemAbilities.map((ability) => AbilitySchema.parse(ability)), hostile: true, runtime: false, death: true })
  expect(Object.values(made).join("\n")).not.toMatch(/abilityEffect|abilityCutEffects|StudioEffect|ArrayList/)
  const shown = compileAbilities({ entity: "StudioCreature", model: "creature", abilities: [slam, burst], hostile: true, runtime: false, death: true })
  expect(shown.methods).toContain(`abilityEffect("${IDS.mark}", abilityPoint(1.25, 1.0, 0.0), 0.0, 0.0, 0.0, 1, true, 0.0);`)
  expect(shown.methods).toContain(`abilityEffect("${IDS.spike}", abilityPoint(0.0, 0.0, 0.0), 1.5, 0.0, 0.0, 6, false, 7.5);`)
  // An effect on the middle of a beam is put along the aim, as the hit is: laid out along it by default (J2), or level from that middle when written so.
  expect(compileAbilities({ entity: "StudioCreature", model: "creature", abilities: [shows(burst, { where: "hit", hit: 1 })], hostile: true, runtime: false, death: true }).methods).toContain(`abilityEffectAimed("${IDS.spike}", abilityPoint(0.0, 1.2, 0.0), abilityDirection(1.2, 0.0), 6.0, 0.0, 0.0, 6, false, 7.5);`)
  expect(compileAbilities({ entity: "StudioCreature", model: "creature", abilities: [shows(burst, { where: "hit", hit: 1, along: "facing" })], hostile: true, runtime: false, death: true }).methods).toContain("abilityPoint(0.0, 1.2, 0.0).add(abilityDirection(1.2, 0.0).scale(4.5))")
  // The accessor of a project without effects is what it was.
  const accessor = { modId: "golem_mod", items: [], blocks: [], creatures: [] }
  expect(projectContentSource(accessor)).not.toContain("spawnEffect")
  expect(projectContentSource({ ...accessor, effects: false })).toBe(projectContentSource(accessor))
  expect(projectContentSource({ ...accessor, effects: true })).toContain("return com.minemods.content_golem_mod.entity.StudioEffects.spawn(id, world, pos, yaw, owner, null);")
})

test("the effect tables are compiled from the documents: one row an effect, in the order of their ids", () => {
  const made = compileEffects({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", effects: [{ id: IDS.spike, title: golemEffects.spike.title, document: spike }, { id: IDS.mark, title: golemEffects.mark.title, document: mark }] })
  const table = String(made.files["src/main/java/com/minemods/content_golem_mod/entity/StudioEffects.java"])
  expect(made.manifest.map((entry) => [entry.id, entry.kind, entry.clip, entry.ticks])).toEqual([[IDS.mark, 0, "open", 16], [IDS.spike, 1, "rise", 10]])
  expect(table).toContain("public static final int[] LIFE = {16, 10};")
  expect(table).toContain("public static final boolean[] FOLLOWS = {true, false};")
  expect(table).toContain("public static final boolean[] ENDS_WITH_OWNER = {true, false};")
  expect(table).toContain("public static final float[] OPACITY = {0.65f, 1f};")
  expect(table).toContain(".noSave().noSummon()")
  const entity = String(made.files["src/main/java/com/minemods/content_golem_mod/entity/StudioEffect.java"])
  expect(entity).toContain("@Override public boolean shouldBeSaved() { return false; }")
  expect(entity).toContain("if (++lived >= StudioEffects.LIFE[kind()]) {")
  // Its own motions and nothing of a creature's: the stillness the compiler was handed is not written out.
  const motions = JSON.parse(String(made.files[`src/main/resources/assets/golem_mod/animations/${effectName(IDS.mark)}.animation.json`])) as { animations: Record<string, unknown> }
  expect(Object.keys(motions.animations)).toEqual([`animation.${effectName(IDS.mark)}.open`])
  expect(Object.keys(made.files).some((name) => name.endsWith("_glowmask.png"))).toBe(false)
  // Once one effect has texels that glow, the renderer draws glow masks, but only a glowing effect has one: GeckoLib refuses a picture without a single
  // visible pixel and crashes the game when it draws that effect (the 蚩尤 run of 2026-11-16, 0.6 s into its death show). The layer passes over the rest.
  const lit = { ...spike, bones: spike.bones.map((bone) => ({ ...bone, cubes: bone.cubes.map((cube) => ({ ...cube, paint: { material: "crystal" as const, base: "#49C6E8" }, features: [{ type: "veins" as const, face: "all" as const, glow: true }] })) })) }
  const glowing = compileEffects({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", effects: [{ id: IDS.spike, title: "发光的", document: EffectDocumentSchema.parse(lit) }, { id: IDS.mark, title: golemEffects.mark.title, document: mark }] })
  const masks = Object.keys(glowing.files).filter((name) => name.endsWith("_glowmask.png"))
  expect(masks).toEqual([`src/main/resources/assets/golem_mod/textures/entity/${effectName(IDS.spike)}_glowmask.png`])
  // The jar check asks for the same picture (as a jar path), and none when nothing glows.
  expect(glowing.glowMasks).toEqual(masks.map((name) => name.replace("src/main/resources/", "")))
  expect(made.glowMasks).toEqual([])
  const renderer = String(glowing.files["src/main/java/com/minemods/content_golem_mod/client/StudioEffectRenderer.java"])
  expect(renderer).toContain("addRenderLayer(new AutoGlowingGeoLayer<>(this) {")
  expect(renderer).toContain("if (StudioEffects.GLOWS[effect.kind()]) super.render(")
  const glowTable = String(glowing.files["src/main/java/com/minemods/content_golem_mod/entity/StudioEffects.java"])
  expect(glowTable).toContain(`GLOWS = {${[IDS.spike, IDS.mark].sort().map((id) => id === IDS.spike).join(", ")}}`)
  expect(String(made.files["src/main/java/com/minemods/content_golem_mod/entity/StudioEffects.java"])).not.toContain("GLOWS")
  expect(String(made.files["src/main/java/com/minemods/content_golem_mod/client/StudioEffectRenderer.java"])).not.toContain("AutoGlowingGeoLayer")
})

test("the sample golem shows two effects: saved as assets, linked, built, read back for the reviewer, and nothing found wrong", async () => {
  const made = await sample(true)
  const effects = made.project.workspace.assets.filter((asset) => asset.module === "effect")
  expect(effects.map((asset) => [asset.title, asset.status])).toEqual([["落点标记", "ready"], ["地面晶刺", "ready"]])
  const creature = made.project.workspace.assets.find((asset) => asset.module === "entity")!
  expect(effects.every((asset) => creature.dependencies.includes(asset.id))).toBe(true)
  // The link is a real one: a creature that shows an effect it does not depend on, or that is not an effect, is not a valid workspace.
  const loose = WorkspaceSchema.safeParse({ assets: made.project.workspace.assets.map((asset) => (asset.id === creature.id ? { ...asset, dependencies: asset.dependencies.filter((id) => id !== effects[0]!.id) } : asset)) })
  expect(loose.error?.issues.map((issue) => issue.message)).toContain("Entity asset must depend on every effect workspace asset its abilities show")
  expect(WorkspaceSchema.safeParse({ assets: made.project.workspace.assets.filter((asset) => asset.id !== effects[0]!.id) }).success).toBe(false)
  expect(made.built.effectFiles).toHaveLength(2)
  expect(made.built.findings.filter((finding) => finding.rule.startsWith("effect_"))).toEqual([])
  const metadata = JSON.parse(await readFile(path.join(made.source, "src/main/resources/fabric.mod.json"), "utf8")) as { entrypoints: { main: string[]; client: string[] } }
  expect(metadata.entrypoints.main.at(-1)).toBe("com.minemods.content_azure_sample.entity.StudioEffects")
  expect(metadata.entrypoints.client.at(-1)).toBe("com.minemods.content_azure_sample.client.StudioEffectClient")
  const record = JSON.parse(await readFile(path.join(made.source, "minemods-build.json"), "utf8")) as { effects: { title: string; ticks: number }[]; workspace_assets: { module: string }[] }
  expect(record.effects.map((entry) => [entry.title, entry.ticks]).sort()).toEqual([["地面晶刺", 10], ["落点标记", 16]])
  expect(record.workspace_assets.filter((asset) => asset.module === "effect")).toHaveLength(2)
  // What the reviewer of its gameplay is told is read back out of the generated class.
  const contract = (await gameplayContract(made.directory, document(made.project, "gameplay").uses)).join("\n")
  expect(contract).toContain("它会放出效果：第 0.1 秒「落点标记」。")
  expect(contract).toContain("它会放出效果：第 1 秒「地面晶刺」 ×6、第 1.3 秒「地面晶刺」 ×6。")
  expect(contract).toContain("招式被打断时，做成“随那一招结束”的效果当刻消失，其余的留到时间结束。")
  expect(contract).toContain('ProjectContent.spawnEffect("效果的 id", world, pos, yaw) 在服务端把这个工程的一个效果放到 pos')
  expect(contract).not.toContain("没有读到")
  const reaction = creatureFacets(document(made.project, "entity"), made.project).find((facet) => facet.question === "reaction")!
  expect(reaction.words).toContain("「重锤」（目标在 0–2.8 格、看得见的时候，会出现效果「落点标记」）")
  expect(reaction.detail).toContain("出现的效果「地面晶刺」")
  // The binding list names an effect the project lacks as missing.
  expect(creatureBindings({ abilities: [slam] }, fightingGolemDesign.animations, [], () => null).abilities[0]!.missing).toEqual([`出现的效果 ${IDS.mark}（工程里没有）`])
  // An effect that is gone is something the reconciliation stops the build on, and the build itself refuses.
  const golem = made.project.entities[0]!
  expect(reconcile({ ...made.project, entities: [{ ...golem, abilities: [slam] }] }, { animations: { [golem.id]: fightingGolemDesign.animations.map((clip) => clip.name) } }).filter((finding) => finding.rule === "effect_missing")).toMatchObject([{ stops: true, about: { kind: "entity", id: golem.id } }])
  // Gameplay code may show an effect by its asset id, once it lists it; an id that is no effect of this project is found.
  const thing = gameplayThings(made.project).find((value) => value.kind === "effect")!
  expect(thing.accessor).toBe(`ProjectContent.spawnEffect("${effects[0]!.id}", world, pos, yaw)`)
  const gameplay = document(made.project, "gameplay")
  const calling = (id: string, uses: string[]) => checkGameplayReferences(made.project, { ...gameplay, uses, sources: gameplay.sources.map((file) => (file.path === "Main.java" ? { ...file, content: file.content.replace(/\n}\s*$/, `\n    void show(net.minecraft.world.level.Level world, net.minecraft.world.phys.Vec3 pos) { ProjectContent.spawnEffect("${id}", world, pos, 0f); }\n}\n`) } : file)) }, made.project.workspace.assets.find((asset) => asset.module === "gameplay")!.id).map((finding) => finding.rule)
  expect(calling(effects[0]!.id, [...gameplay.uses, effects[0]!.id])).toEqual([])
  expect(calling(effects[0]!.id, gameplay.uses)).toEqual(["undeclared_use"])
  expect(calling("11111111-1111-4111-8111-cccccccccccc", gameplay.uses)).toEqual(["unknown_content"])
})

test("the same sample without the option has no trace of effects in what is built", async () => {
  const made = await sample(false)
  expect(made.built.effectFiles).toEqual([])
  const metadata = await readFile(path.join(made.source, "src/main/resources/fabric.mod.json"), "utf8")
  expect(metadata).not.toContain("StudioEffect")
  expect(await readFile(path.join(made.source, "minemods-build.json"), "utf8")).not.toContain('"effects"')
  expect(await readFile(path.join(made.source, "src/main/java/com/minemods/content_azure_sample/gameplay/api/ProjectContent.java"), "utf8")).not.toContain("spawnEffect")
  expect(await readFile(path.join(made.source, "src/main/java/com/minemods/content_azure_sample/entity/StudioCreature.java"), "utf8")).not.toMatch(/abilityEffect|StudioEffect/)
  expect(await readFile(path.join(made.source, "src/main/resources/assets/azure_sample/lang/zh_cn.json"), "utf8")).not.toContain("studio_effect")
})

test.skipIf(!hasTargetJavac("fabric-1.21.1-official"))("the sample's whole generated tree with effects compiles against Minecraft 1.21.1 (Mojang's names), Fabric API and GeckoLib 4.8.3", async () => {
  const made = await sample(true)
  const compiled = (await compileTreeFor("fabric-1.21.1-official", made.source))!
  expect(compiled.output).not.toContain("error")
  expect(compiled.code).toBe(0)
}, 120000)

test.skipIf(!hasTargetJavac("fabric-1.21.1-official"))("every way of putting an effect, every facing and a glowing one compile against the game", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-effects-"))
  roots.push(root)
  const event = effectEvents(slam)[0]!.event
  const area = (shape: unknown, at: number) => ({ type: "area", at, shape, hits: "target", damage: 2, knockback: 0, effects: [] })
  // Put at its own feet, at its target's, and on the middle of an arc, a box, a ball, a beam, a cone and a shot; alone, in a circle and in a row.
  const every = {
    ...golemAbilities[0],
    hits: [area({ type: "arc", reach: 3, angle: 360, low: 0, high: 2 }, 0.6), area({ type: "box", forward: 2, up: 1, left: 0, width: 2, height: 2, depth: 2 }, 0.7), area({ type: "sphere", forward: 2, up: 1, left: 0, radius: 2 }, 0.8), area({ type: "line", up: 1.5, length: 8, radius: 0.5 }, 0.9), area({ type: "cone", up: 1.5, length: 6, angle: 60 }, 1), { type: "shot", at: 1.1, projectile: "snowball", speed: 1.6, forward: 1, up: 1.5, damage: null }],
    stopped_by_hurt: true,
    events: [
      { ...event, where: "self", hit: null, count: 8, layout: "ring", spread: 2 },
      { ...event, where: "target", hit: null, effect: IDS.spike, count: 3, layout: "line", spread: 2 },
      ...Array.from({ length: 6 }, (_, hit) => ({ ...event, hit, at: 0.5 })),
    ],
  }
  const model = { ...fightingGolemDesign, bones: fightingGolemDesign.bones }
  const lit = EffectDocumentSchema.parse({ ...spike, bones: spike.bones.map((bone) => ({ ...bone, cubes: bone.cubes.map((cube) => ({ ...cube, paint: { material: "crystal", base: "#49C6E8" }, features: [{ type: "veins", face: "all", glow: true }] })) })), play: { ...spike.play, facing: "target" } })
  const files = {
    ...compileEntity({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile", model, abilities: [every] }),
    ...compileEffects({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", effects: [{ id: IDS.mark, title: "对着玩家的", document: { ...mark, play: { ...mark.play, facing: "camera" } } }, { id: IDS.spike, title: "朝着目标的", document: lit }] }).files,
  }
  // The creature's own content class leans on what Fabric opens up at build time; the three effect classes and the creature are what is compiled here.
  await Promise.all(Object.entries(files).filter((entry) => /\/(?:StudioCreature|StudioEffect\w*)\.java$/.test(entry[0])).map((entry) => writeFile(path.join(root, path.basename(entry[0])), String(entry[1]))))
  const compiled = await targetJavac("fabric-1.21.1-official", root)
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 120000)

// ---- what an AI is told ----

test("an effect is made by looking like a model, and whoever makes one or uses one is told what it is and what it is not", () => {
  expect(LOOKED_KINDS).toContain("effect")
  expect(MODULES.effect).toMatchObject({ label: "效果", capability: "runtime", staged: false })
  expect(MODULES.effect.instructions).toContain(EFFECT_INSTRUCTIONS)
  expect(MODULES.entity.references.some((reference) => reference.kinds.includes("effect" as never))).toBe(true)
  ;["clip", "lifetime", "follow", "facing", "on_ground", "ends_with_owner", "bright", "opacity"].forEach((field) => expect(EFFECT_INSTRUCTIONS).toContain(field))
  // Its limits and what it cannot do are said in so many words.
  expect(EFFECT_INSTRUCTIONS).toContain(`最多 ${EFFECT_LIMITS.bones} 根骨骼、${EFFECT_LIMITS.cubes} 个方块`)
  expect(EFFECT_INSTRUCTIONS).toContain(`同一只生物身边同时最多 ${EFFECT_LIMITS.alive} 个效果`)
  expect(EFFECT_INSTRUCTIONS).toContain("效果做不到的（要写玩法代码）：改变地形、放方块或者破坏方块、屏幕上的遮罩和文字、界面")
  expect(ABILITY_INSTRUCTIONS).toContain('{type:"effect", at, effect:"效果的资产 id", where, hit, along, forward, up, left, count, layout, spread}')
  // J2: which way a beam points, and in whose terms an effect is laid out, are said with what follows from each.
  expect(ABILITY_INSTRUCTIONS).toContain('再写 aim:"level"，它就一直水平')
  expect(ABILITY_INSTRUCTIONS).toContain('要写 along:"aim" 和 hit，否则目标一站高或者站低，看到的路线和打到的路线就分开了')
  expect(MODULES.entity.instructions).toContain(`差得超过 ${EFFECT_ZONE_TOLERANCE} 格会直接说对不上`)
  // Nothing an AI is told about effects names a subject.
  expect(`${EFFECT_INSTRUCTIONS}${MODULES.effect.summary}`).not.toMatch(/冰|火|雷|光环|晶刺|傀儡|标记圈|龙/)
  expect(effectLookup(ProjectSchema.parse(SHELL))(IDS.mark)).toBeNull()
})

// ---- the texture of an effect: what the build asks of it is asked when it is saved, and its sizes are the tier's ----

/** The mark with its frame's first cube made one wide slab: its top and bottom are 150×150 texels each at a texel to a model pixel, which no 256 sheet holds (the game's build packs them and fails). */
const slab = (change: Record<string, unknown> = {}, size: [number, number, number] = [150, 20, 150]) =>
  EffectDocumentSchema.parse({
    ...golemEffects.mark.document,
    ...change,
    bones: golemEffects.mark.document.bones.map((bone, index) => (index ? bone : { ...bone, cubes: [{ ...bone.cubes[0], origin: [-size[0] / 2, 0, -size[2] / 2], size }, ...bone.cubes.slice(1)] })),
  })
const built = (document: EffectDocument) => compileEffects({ modId: "storm", packageName: "com.example.storm", effects: [{ id: IDS.mark, title: "板", document }] })
const hashes = (files: Record<string, string | Uint8Array>) => Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, content]) => [name, createHash("sha256").update(content).digest("hex")]))

test("the texture sizes an effect may name are its tier's, in the schema it is offered and in the words that refuse any other", () => {
  // The tier is the default one: 256 at most, and the schema a maker reads offers exactly those sizes, not the 512 a model of a higher tier could name.
  expect(EFFECT_TEXTURE_SIZES).toEqual(textureSizes("standard"))
  expect(EFFECT_TEXTURE_SIZES).toEqual([64, 128, 256])
  const offered = (z.toJSONSchema(EffectDocumentSchema).properties as Record<string, { anyOf: { const: number }[] }>).texture_size!.anyOf.map((option) => option.const)
  expect(offered).toEqual([...EFFECT_TEXTURE_SIZES])
  ;[...EFFECT_TEXTURE_SIZES].forEach((size) => expect(EffectDocumentSchema.safeParse({ ...golemEffects.mark.document, texture_size: size }).success).toBe(true))
  // What is not offered is refused as the tier would, naming the largest and the two ways on.
  const words = refused({ texture_size: 512 })
  expect(words).toBe(EFFECT_TEXTURE_REFUSAL)
  expect(words).toContain("只能是 64、128 或 256")
  expect(words).toContain("最大的贴图是 256×256")
  expect(words).toContain("texel_size: 2 或 4")
  expect(refused({ texture_size: 100 })).toBe(EFFECT_TEXTURE_REFUSAL)
})

test("an effect whose faces fit no texture of its tier passes its schema and is refused by the build, in the same words everywhere it is asked", () => {
  const wide = slab()
  // The texture the app paints for it, the packing the build asks for and the build itself all find the same: nothing fits, at any size the tier has.
  expect(() => modelAtlas({ ...effectModel(wide), texture_size: 256 })).toThrow(TEXTURE_SPACE_ERROR)
  expect(effectTexture(wide)).toBeNull()
  expect(() => built(wide)).toThrow(TEXTURE_SPACE_ERROR)
  expect(() => compileEffectModel(wide, effectName(IDS.mark))).toThrow(TEXTURE_SPACE_ERROR)
  // What the save and the look ask is that same function: its answer is the build's message, to the letter.
  expect(effectBuildFault(wide)).toBe(TEXTURE_SPACE_ERROR)
  expect(effectBuildFault(wide, effectName(IDS.mark))).toBe(TEXTURE_SPACE_ERROR)
  expect(TEXTURE_SPACE_ERROR).toContain("texel_size: 2 或 4")
  // One that fits is not held back, and neither is one that fits only the next size up.
  expect(effectBuildFault(mark)).toBeNull()
  expect(effectBuildFault(slab({ texture_size: 64 }, [40, 4, 40]))).toBeNull()
  expect(compileEffectModel(slab({ texture_size: 64 }, [60, 4, 60]), "effect_check").design.texture_size).toBe(256)
})

test("an effect writes texel_size as a model does: one texel over 2×2 model pixels where the largest texture cannot hold it", () => {
  const wide = slab({ texel_size: 2 })
  expect(wide.texel_size).toBe(2)
  // The model it is carries it, and so does everything that draws or packs it.
  expect(effectModel(wide).texel_size).toBe(2)
  expect(effectBuildFault(wide)).toBeNull()
  const texture = effectTexture(wide)!
  expect(texture).not.toBeNull()
  const top = texture.islands.find((island) => island.cube === "edge_front" && island.face === "up")!
  expect([top.width, top.height]).toEqual([75, 75])
  expect(texture.size).toBe(256)
  // The build writes the same picture, and each face's own uv size in texels, so the game stretches a texel over 2×2 model pixels.
  const files = built(wide).files
  const written = decodeRgbaPng(files[`src/main/resources/assets/storm/textures/entity/${effectName(IDS.mark)}.png`] as Uint8Array)
  expect([written.width, written.height]).toEqual([256, 256])
  expect(Buffer.from(texture.pixels).equals(Buffer.from(written.pixels))).toBe(true)
  const geometry = JSON.parse(files[`src/main/resources/assets/storm/geo/${effectName(IDS.mark)}.geo.json`] as string) as { "minecraft:geometry": { bones: { cubes: { uv: Record<string, { uv_size: number[] }> }[] }[] }[] }
  expect(geometry["minecraft:geometry"][0]!.bones[0]!.cubes[0]!.uv.up!.uv_size).toEqual([75, 75])
  // A coarser texel than it needs is refused naming the one that holds it, and one on an effect that fits at a texel to a pixel is refused too.
  const four = EffectDocumentSchema.safeParse({ ...wide, texel_size: 4 })
  expect(four.error?.issues.map((issue) => issue.message).join(" ")).toContain("texel_size 4 用不着")
  expect(four.error?.issues.map((issue) => issue.message).join(" ")).toContain("把 texel_size 改成 2")
  const small = EffectDocumentSchema.safeParse({ ...golemEffects.mark.document, texel_size: 2 })
  expect(small.error?.issues.map((issue) => issue.message).join(" ")).toContain("改成 1（或者不写）")
  expect(EffectDocumentSchema.safeParse({ ...golemEffects.mark.document, texel_size: 3 }).success).toBe(false)
  // Surface details are counted in texels, as a model's are: 75 across, so a mark at 74 fits and one at 75 does not.
  const marked = (x: number) => EffectDocumentSchema.safeParse({ ...wide, bones: wide.bones.map((bone, index) => (index ? bone : { ...bone, cubes: [{ ...bone.cubes[0], surface_details: [{ face: "up", x, y: 0, width: 1, height: 1, color: "#ffffff" }] }, ...bone.cubes.slice(1)] })) })
  expect(marked(74).success).toBe(true)
  expect(marked(75).success).toBe(false)
  // It is said to whoever makes one.
  expect(EFFECT_INSTRUCTIONS).toContain("texel_size: 2 或 4")
  expect(EFFECT_INSTRUCTIONS).toContain("texture_size 只能是 64、128、256")
  expect(z.toJSONSchema(EffectDocumentSchema).properties).toHaveProperty("texel_size")
})

test("an effect that writes no texel_size is the model, the picture and the files it always was, byte for byte", () => {
  expect("texel_size" in mark).toBe(false)
  expect("texel_size" in effectModel(mark)).toBe(false)
  expect(Object.keys(effectModel(mark))).toEqual(["name", "texture_size", "bones", "animations"])
  const plain = hashes(compileEffects({ modId: "storm", packageName: "com.example.storm", effects: [{ id: IDS.mark, title: golemEffects.mark.title, document: mark }, { id: IDS.spike, title: golemEffects.spike.title, document: spike }] }).files)
  // Writing the one texel a model pixel has anyway (or null) builds exactly the same files.
  for (const texel of [1, null] as const) {
    const same = hashes(compileEffects({ modId: "storm", packageName: "com.example.storm", effects: [{ id: IDS.mark, title: golemEffects.mark.title, document: EffectDocumentSchema.parse({ ...golemEffects.mark.document, texel_size: texel }) }, { id: IDS.spike, title: golemEffects.spike.title, document: EffectDocumentSchema.parse({ ...golemEffects.spike.document, texel_size: texel }) }] }).files)
    expect(same).toEqual(plain)
  }
  // Pinned (measured on the code before effects could write texel_size): the picture each sample effect wears.
  const picture = (id: string) => plain[`src/main/resources/assets/storm/textures/entity/${effectName(id)}.png`]
  expect(picture(IDS.mark)).toBe("3f627b1b7710fd294a4805a116a5dbe694fc64a29106105733379096eb23365e")
  expect(picture(IDS.spike)).toBe("2fb750e3354f39ced71250b57380d3f7fe7ad919cccf9b30e20ab5c0c3b2dbc9")
  // And every file the two build to, geometry, motions, tables and classes included.
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(createHash("sha256").update(Object.entries(plain).map(([name, hash]) => name + hash).join("\n")).digest("hex")).toBe("d763a9691ebf4f75da83b40121899b79d3396f3951e7724a099c2e50891ca462")
})
