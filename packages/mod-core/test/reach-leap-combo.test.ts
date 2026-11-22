import { expect, test } from "bun:test"
import { abilityIssues } from "../src/creature-abilities"
import { AbilitySchema, ComboSchema, type Ability } from "../src/entity-runtime"

/**
 * r29 修补乙 第 3 件: two reach warnings that were the check's own mistake (a small beast of the mountains, r27):
 * - a pounce that leaps up to 7 blocks onto its target was told it only reaches 1.7 (the leap was not counted);
 * - a tail sweep that its own start never picks (weight 0 at every health) and that only a combo plays was held to its own start window.
 * What really cannot reach is still said.
 */

const pounce = AbilitySchema.parse({
  id: "pounce", name: "扑击", clip: "crouch", windup: 0.8, length: 2.05, facing: "track",
  hits: [{ type: "area", at: 1.35, shape: { type: "sphere", forward: 0.3, up: 0, left: 0, radius: 1.4 }, hits: "target", damage: 6, knockback: 0.6, effects: [] }],
  moves: [{ type: "leap", at: 0.85, land: 1.35, height: 1.5, aim: "target", max_distance: 7, short: 0 }],
  start: { weight_when: [{ if: "health_above", share: 0.05, scale: 0 }, { if: "health_below", share: 0.05, scale: 0 }], min_distance: 3, max_distance: 7, line_of_sight: true, cooldown: 4, weight: 1 },
  stopped_by_hurt: false, events: [],
})
const sweep = AbilitySchema.parse({
  id: "sweep", name: "甩尾", clip: "thrash", windup: 0.3, length: 1.5, facing: "lock",
  hits: [{ type: "area", at: 0.35, shape: { type: "arc", reach: 2, angle: 360, low: -0.5, high: 1.5 }, hits: "target", damage: 0, knockback: 0.3, effects: [] }],
  moves: [],
  start: { weight_when: [{ if: "health_above", share: 0.05, scale: 0 }, { if: "health_below", share: 0.05, scale: 0 }], min_distance: 0, max_distance: 7, line_of_sight: false, cooldown: 4, weight: 1 },
  stopped_by_hurt: false, events: [],
})
const claw = AbilitySchema.parse({
  id: "claw", name: "爪击", clip: "claw", windup: 0.25, length: 0.8, facing: "track",
  hits: [{ type: "area", at: 0.32, shape: { type: "arc", reach: 2.2, angle: 110, low: -0.5, high: 1.6 }, hits: "target", damage: 4, knockback: 0.4, effects: [] }],
  moves: [], start: { min_distance: 0, max_distance: 2.2, line_of_sight: true, cooldown: 2, weight: 4 }, stopped_by_hurt: false, events: [],
})
const combo = ComboSchema.parse({ id: "pounce_sweep", name: "扑击", steps: ["pounce", "sweep"], gap_ticks: 0, damage_scale: 1, start: { min_distance: 3, max_distance: 7, line_of_sight: true, cooldown: 4, weight: 6 } })

const reach = (abilities: Ability[], combos = [combo]) =>
  abilityIssues({ name: "扑击兽", behavior: "hostile", abilities, combos }, null).filter((issue) => issue.rule === "ability_reach").map((issue) => issue.ability)

test("a leap toward the target counts: a pounce of 7 blocks reaches whoever stands 3 to 7 away", () => {
  expect(reach([pounce, sweep, claw])).toEqual([])
  // Alone too (picked by its own start), the leap still carries it there.
  const alone = { ...pounce, start: { ...pounce.start, weight_when: undefined } }
  expect(reach([alone, claw], [])).toEqual([])
})

test("an ability only a combo plays is not held to its own start window; one that its own start picks still is", () => {
  expect(reach([pounce, sweep, claw])).not.toContain("sweep")
  // Picked by its own start (no weight rules), the sweep of 2 blocks at 7 is said again.
  const picked = { ...sweep, start: { ...sweep.start, weight_when: undefined } }
  expect(reach([pounce, picked, claw])).toEqual(["sweep"])
  // Zero only when the target is out of sight: still picked when it is seen, still said.
  const sometimes = { ...sweep, start: { ...sweep.start, weight_when: [{ if: "no_sight", scale: 0 }] } } as Ability
  expect(reach([pounce, sometimes, claw])).toEqual(["sweep"])
  // Zero at every health but in no combo: nothing plays it, and its window is said as before.
  expect(reach([pounce, sweep, claw], [])).toContain("sweep")
})

test("what really cannot reach is still said, with the leap counted in the words", () => {
  // A hop of 2 blocks toward someone 6 away leaves 4 between them; the hit reaches 1.7.
  const hop = { ...pounce, moves: [{ ...pounce.moves[0]!, max_distance: 2 }], start: { ...pounce.start, weight_when: undefined, min_distance: 6, max_distance: 8 } } as Ability
  const issues = abilityIssues({ name: "扑击兽", behavior: "hostile", abilities: [hop, claw], combos: [] }, null).filter((issue) => issue.rule === "ability_reach")
  expect(issues.map((issue) => issue.ability)).toEqual(["pounce"])
  expect(issues[0]!.text).toContain("算上跳扑，落地时离目标还有 4 格")
  // Stopping short of the target counts as well: 3 blocks short, a reach of 1.7 never gets there.
  const shy = { ...pounce, moves: [{ ...pounce.moves[0]!, short: 3 }], start: { ...pounce.start, weight_when: undefined } } as Ability
  expect(reach([shy, claw], [])).toEqual(["pounce"])
  // A leap that leaves the ground after the hit does not carry the hit.
  const late = { ...pounce, hits: [{ ...pounce.hits[0]!, at: 0.8 }], start: { ...pounce.start, weight_when: undefined } } as Ability
  expect(reach([late, claw], [])).toEqual(["pounce"])
  // Without a leap nothing changed: a standing swing of 1.7 at 3–7 is said, as before.
  const standing = { ...pounce, moves: [], start: { ...pounce.start, weight_when: undefined } } as Ability
  expect(reach([standing, claw], [])).toEqual(["pounce"])
})
