import { expect, test } from "bun:test"
import { posedCorners } from "@minemods/studio-ai/model-motion"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { EffectDocumentSchema } from "../src/effect"
import { abilityEffectFacts, abilityEffectIssues, abilityEffectLines, assumedTarget, diveArrived, diveFrame, diveOrigin, effectAtHit, effectCorners, effectPlaces, effectsShown, stagedEffect, type EffectEvent } from "../src/effect-abilities"
import { abilityPlace, diveReach, hitAnchors } from "../src/creature-abilities"
import { AbilitySchema, type Ability } from "../src/entity-runtime"
import { fightingGolemDesign, golemAbilitiesWithEffects, golemEffects } from "../script/data-gameplay-sample"
import { dragonAnchoredAbilities, dragonDesign } from "./giant-flier"

const IDS = { mark: "11111111-1111-4111-8111-aaaaaaaaaaaa", spike: "11111111-1111-4111-8111-bbbbbbbbbbbb" }
const mark = EffectDocumentSchema.parse(golemEffects.mark.document)
const spike = EffectDocumentSchema.parse(golemEffects.spike.document)
const lookup = (id: string) => (id === IDS.mark ? { title: golemEffects.mark.title, document: mark } : id === IDS.spike ? { title: golemEffects.spike.title, document: spike } : null)
const [slam, burst] = golemAbilitiesWithEffects(IDS).map((ability) => AbilitySchema.parse(ability)) as [Ability, Ability]
const apart = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((value, axis) => value - b[axis]!))

/** A dive of the giant flier whose two front feet strike at 1 second; the target is taken to stand 18 blocks ahead (the middle of 12 and 24). `at` are the moments the mark is laid on the target. */
const claws = (at: number[], where: EffectEvent["where"] = "target"): Ability =>
  AbilitySchema.parse({
    ...dragonAnchoredAbilities[3],
    id: "dive_claw",
    name: "俯冲抓击",
    clip: "stoop",
    windup: 0.5,
    length: 1.4,
    start: { min_distance: 12, max_distance: 24, line_of_sight: true, cooldown: 4, weight: 3 },
    hits: ["leg_front_left", "leg_front_right"].map((bone) => ({ type: "area", at: 1, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 2.3 }, hits: "everyone", damage: 10, knockback: 1, effects: [], bone })),
    events: at.map((time) => ({ type: "effect", at: time, effect: IDS.mark, where, hit: where === "hit" ? 0 : null, forward: 0, up: 0, left: 0, count: 1, layout: "ring", spread: 0 })),
  })

test("an effect staged as a model of its own stands exactly where the arithmetic puts it, wherever that is", () => {
  const apartFrom = (place: Parameters<typeof effectCorners>[1], age: number) => {
    const staged = stagedEffect({ document: spike, place, age })
    const clip = staged.design.animations[0]!
    // Its own coordinates stay small, around its own origin; the offset is where that origin lies.
    expect(staged.design.bones.every((bone) => bone.cubes.every((cube) => cube.origin.every((value) => Math.abs(value) <= 256)))).toBe(true)
    const own = posedCorners(staged.design, clip, 5).map((point) => point.map((value, axis) => value + staged.offset[axis]!))
    return Math.max(...effectCorners(spike, place, age).map((point, index) => apart(point, own[index]!)))
  }
  // Level, turned, and (J2) tilted and spun about its tilted upright: the same arithmetic as the picture with the creature, with the effect 40 blocks out where no creature's document could hold it.
  expect(apartFrom({ forward: 2, up: 0.5, left: 1, turn: 40, pitch: 0, spin: 0 }, 0.12)).toBeLessThan(1e-9)
  expect(apartFrom({ forward: 40, up: 1.5, left: -3, turn: 25, pitch: 30, spin: 70 }, 0.12)).toBeLessThan(1e-9)
  expect(stagedEffect({ document: spike, place: { forward: 40, up: 0, left: 0, turn: 0, pitch: 0, spin: 0 }, age: 0 }).offset).toEqual(abilityPlace(40, 0, 0))
  // The effect's own bones keep their places in the list: what was compiled from the effect alone fits.
  const staged = stagedEffect({ document: spike, place: { forward: 1, up: 0, left: 0, turn: 0, pitch: 10, spin: 0 }, age: 0 })
  expect(staged.design.bones.slice(0, spike.bones.length).map((bone) => bone.name)).toEqual(spike.bones.map((bone) => bone.name))
  expect(staged.design.bones).toHaveLength(spike.bones.length + 3)
})

test("a dive that brings a bone to the target is measured where it strikes: the effect at the target lies in the hit, as it does in the game", () => {
  const ability = claws([0.2, 0.8])
  const anchors = hitAnchors([ability], dragonDesign)[0]!
  const reach = diveReach(ability, anchors)!
  const dive = diveFrame(ability, dragonDesign)!
  // The first hit is on tick 20; the feet go to where the target stands, 18 blocks ahead: the creature is moved by what is left of the 18 after its own reach.
  expect(dive.arrives).toBe(20)
  expect(dive.shift.forward).toBeCloseTo(assumedTarget(ability) - (reach[0]! + reach[3]!), 4)
  expect(dive.shift.left).toBeCloseTo(-(reach[2]! + reach[5]!), 4)
  expect(diveArrived(dive, 19)).toBe(false)
  expect(diveArrived(dive, 20)).toBe(true)
  // Its hit starts at its bone in that place, which is the target.
  expect(diveOrigin(dive, 0).forward).toBeCloseTo(assumedTarget(ability), 3)
  expect(diveOrigin(dive, 0).left).toBeCloseTo(0, 3)
  const stale = abilityEffectFacts(ability, lookup, 8).events[0]!.where!
  const struck = abilityEffectFacts(ability, lookup, 8, dive).events[0]!.where!
  // Counted from the origin the creature began at, the mark lies far from the hit (a gap the game does not have); counted where it strikes, it lies in it.
  expect(stale).toMatch(/中心离第 1 次出手的判定范围 1\d\.\d+ 格/)
  expect(struck).toContain("中心都在第 1 次出手的判定范围里")
  expect(struck).not.toMatch(/中心离/)
  // The card and the reconcile say it the same way when the model is known.
  expect(abilityEffectLines(ability, lookup, 8, dive).filter((line) => line.startsWith("对不上"))).toEqual([])
  expect(abilityEffectIssues({ name: "巨龙", abilities: [ability] }, lookup, 8, dragonDesign)).toEqual([])
  // The mark is laid on the target, which does not move with the creature: the same place before and after it arrives.
  expect(effectsShown(ability, lookup, 0.9, null, dive)[0]!.place).toEqual(effectsShown(ability, lookup, 0.9)[0]!.place)
  // What is put in the creature's own terms and appears after it has arrived is where it stands then; before, where it began.
  const self = claws([0.2, 1.1], "self")
  const [early, late] = [effectsShown(self, lookup, 0.5, null, diveFrame(self, dragonDesign))[0]!, effectsShown(self, lookup, 1.3, null, diveFrame(self, dragonDesign)).find((value) => value.age < 0.3)!]
  expect(early.place.forward).toBe(0)
  expect(late.place.forward).toBeCloseTo(dive.shift.forward, 3)
  // "Ahead of it" is counted from where the creature then stands: what is put on itself is as far ahead of it as ever, what is put on the target (18 blocks from where it began) only what is left.
  const reached = (ability: Ability, index: number) => effectAtHit(ability, ability.events[index] as EffectEvent, { document: mark }, null, null, { frame: diveFrame(ability, dragonDesign)!, hit: 0 })!.far
  const far = (ability: Ability, index: number) => effectAtHit(ability, ability.events[index] as EffectEvent, { document: mark }, null)!.far
  expect(reached(self, 1)).toBeCloseTo(far(self, 1), 6)
  const late_target = claws([0.2, 1.1])
  expect(reached(late_target, 0)).toBeCloseTo(far(late_target, 0), 6)
  expect(reached(late_target, 1)).toBeCloseTo(far(late_target, 1) - dive.shift.forward, 2)
})

test("what is not such a dive is measured and said exactly as it was", () => {
  const golem = fightingGolemDesign as unknown as ModelDesign
  // No bone to bring, or not a dive: no frame, and the sentences are the ones there were.
  for (const ability of [slam, burst, dragonAnchoredAbilities[3]!]) expect(diveFrame(ability, ability === dragonAnchoredAbilities[3] ? dragonDesign : golem)).toBeNull()
  expect(abilityEffectFacts(slam, lookup, 3, diveFrame(slam, golem))).toEqual(abilityEffectFacts(slam, lookup, 3))
  expect(abilityEffectFacts(burst, lookup, 3, diveFrame(burst, golem))).toEqual(abilityEffectFacts(burst, lookup, 3))
  expect(abilityEffectIssues({ name: "晶石傀儡", abilities: [slam, burst] }, lookup, 3, golem)).toEqual(abilityEffectIssues({ name: "晶石傀儡", abilities: [slam, burst] }, lookup, 3))
  expect(effectPlaces(slam, slam.events.find((event) => event.type === "effect") as EffectEvent, "owner", 7, null, null)).toEqual(effectPlaces(slam, slam.events.find((event) => event.type === "effect") as EffectEvent))
})
