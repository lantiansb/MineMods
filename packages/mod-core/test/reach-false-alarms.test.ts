import { expect, test } from "bun:test"
import { abilityIssues } from "../src/creature-abilities"
import { AbilitySchema, type Ability } from "../src/entity-runtime"

/**
 * r29c 乙 第 1 件: three reach warnings that were the check's own mistake (a fog beast, r28):
 * - a cry that only plays a motion and a sound, with the one hit the tool asks for doing nothing (no damage, knockback, effect or force), was told it reaches 0.5 at 9 blocks;
 * - a retreat that carries itself backward was held to its window (16 blocks) as if it meant to strike;
 * - a swipe whose box lies beside and behind the body, started only with the target at its side or behind it (`target_bearing`), was measured straight ahead.
 * What really cannot reach is still said. Small samples of other subjects, not the beast itself.
 */

const base = { clip: "act", windup: 0.2, facing: "lock", stopped_by_hurt: false, events: [] }
const ability = (value: object) => AbilitySchema.parse({ ...base, ...value })
const start = (min: number, max: number, more: object = {}) => ({ min_distance: min, max_distance: max, line_of_sight: false, cooldown: 4, weight: 1, ...more })
const sphere = (radius: number) => ({ type: "sphere", forward: 0, up: 0.5, left: 0, radius })
const reach = (abilities: Ability[]) =>
  abilityIssues({ name: "样例", behavior: "hostile", abilities }, null).filter((issue) => issue.rule === "ability_reach")

// A lantern ghost's wail, a frog's croak: an ability that is all look and sound, with one hit that does nothing.
const wail = ability({ id: "wail", name: "哀嚎", length: 2, moves: [], start: start(9, 24), hits: [{ type: "area", at: 1, shape: sphere(0.5), hits: "target", damage: 0, knockback: 0, effects: [] }] })

test("a hit that does nothing has no reach to fall short of", () => {
  expect(reach([wail])).toEqual([])
  // With a hit that does something (a slow, a shove or damage) the window is measured as before.
  const slows = { ...wail, hits: [{ ...wail.hits[0]!, effects: [{ effect: "slowness", duration_ticks: 20, amplifier: 1 }] }] } as Ability
  const shoves = { ...wail, hits: [{ ...wail.hits[0]!, knockback: 0.4 }] } as Ability
  const hurts = { ...wail, hits: [{ ...wail.hits[0]!, damage: 2 }] } as Ability
  for (const said of [slows, shoves, hurts]) expect(reach([said]).map((issue) => issue.ability)).toEqual(["wail"])
  // A harmless hit beside one that hurts does not make the reach longer or shorter: the hurting one is measured.
  const both = { ...wail, hits: [{ ...wail.hits[0]!, shape: sphere(30) }, { ...wail.hits[0]!, at: 1.2, damage: 3 }] } as Ability
  expect(reach([both]).map((issue) => issue.ability)).toEqual(["wail"])
})

// A fox that springs back into the brush, a crab that scuttles away: pushes backward and nothing toward the target.
const retreat = ability({
  id: "back", name: "后撤", length: 1.6, facing: "track", start: start(0, 16),
  moves: [{ at: 0.6, forward: -0.55, up: 0.3 }, { at: 1.1, forward: -0.45, up: 0.25 }],
  hits: [{ type: "area", at: 0.55, shape: sphere(1.5), hits: "everyone", damage: 0, knockback: 0.5, effects: [] }],
})

test("an ability that only carries itself backward is not held to its window", () => {
  expect(reach([retreat])).toEqual([])
  // Standing still with the same hit, it is said again: the window is what it strikes with.
  expect(reach([{ ...retreat, moves: [] } as Ability]).map((issue) => issue.ability)).toEqual(["back"])
})

// A scorpion's tail flick, a mantis turning on what circles it: a box beside and behind the body, started only when the target is there.
const swipe = ability({
  id: "swipe", name: "回身扫", length: 0.8, moves: [],
  start: start(0, 2.5, { keep_heading: true, when: [{ if: "target_bearing", arc: [60, -60], seconds: 0.5 }] }),
  hits: [{ type: "area", at: 0.38, shape: { type: "box", forward: -0.5, up: 0, left: 0, width: 3.6, height: 1.6, depth: 2.6 }, hits: "everyone", damage: 4, knockback: 0.6, effects: [] }],
})

test("an ability started with the target at its side or behind it is measured that way", () => {
  expect(reach([swipe])).toEqual([])
  // Without the bearing it faces the target first and the box reaches 0.8 straight ahead: still said, in the old words.
  const ahead = reach([{ ...swipe, start: { ...swipe.start, when: undefined } } as Ability])
  expect(ahead.map((issue) => issue.ability)).toEqual(["swipe"])
  expect(ahead[0]!.text).toContain("正前方最远只打得到 0.8 格")
  // Behind it, but the box too small for the window: said, measured the ways the target may stand.
  const short = { ...swipe, start: { ...swipe.start, max_distance: 6 } } as Ability
  const said = reach([short])
  expect(said.map((issue) => issue.ability)).toEqual(["swipe"])
  expect(said[0]!.text).toContain("朝目标能站的那几个方向")
  expect(said[0]!.text).toContain("2.55 格")
  // A bearing that lets the target stand ahead too is measured straight ahead as before.
  const wide = { ...swipe, start: { ...swipe.start, when: [{ if: "target_bearing", arc: [-90, 90] }] } } as Ability
  expect(reach([wide]).map((issue) => issue.ability)).toEqual(["swipe"])
})
