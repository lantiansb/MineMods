import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildWarnings } from "../src/build-warnings"
import { abilityIssues } from "../src/creature-abilities"
import { AbilitySchema, FlightSchema } from "../src/entity-runtime"
import type { Project } from "../src/project"
import { reconcile } from "../src/reconcile"
import { createDataGameplaySample } from "../script/data-gameplay-sample"

/**
 * r29c 乙 第 3 件: the two build warnings a small flier that only stoops got that were not so (a bird, r29):
 * - 「贴到 4 格内没有招式可用，只会站着挨打」: once it has a target it goes up and circles it, so nobody comes up to it standing;
 * - 「hover、dive、strike、stuck 永远不会播放」: motions named for a flight behaviour still to come; `later_clips` keeps them, and they are said as advice.
 * A hawk, a bat: small samples of other subjects.
 */

const flight = FlightSchema.parse({ style: "soar", speed: 8, altitude: { min: 6, max: 14 }, turn: 140, climb: 35, bank: 25, air_share: 0.15, takeoff: { clip: "takeoff", seconds: 1 }, land: { clip: "land", seconds: 1.1 }, clips: { fly: "flap", glide: "glide", hover: null } })
const stoop = AbilitySchema.parse({
  id: "stoop", name: "俯冲", clip: "swoop", windup: 0.6, length: 2, facing: "track", where: "air", dive: true, moves: [], stopped_by_hurt: false, events: [],
  hits: [{ type: "area", at: 1.4, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 1.2 }, hits: "target", damage: 4, knockback: 0.4, effects: [] }],
  start: { min_distance: 4, max_distance: 24, line_of_sight: true, cooldown: 6, weight: 1 },
})
const gaps = (creature: object) => abilityIssues({ name: "鹰", behavior: "hostile", abilities: [stoop], ...creature }, null).filter((issue) => issue.rule === "ability_gap")

test("a flier that only stoops is not said to stand and be hit up close; one that stays where it is still is", () => {
  expect(gaps({ flight })).toEqual([])
  // Kept in one place it does not go up after anyone: said as before.
  expect(gaps({ flight, stationary: { reason: "拴在架子上" } })).toHaveLength(1)
  // Without flight a stoop has nowhere to go up to: said as before.
  expect(gaps({})).toHaveLength(1)
})

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

test("a flier's motions kept for its flight still to come are advice, not defects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-flier-"))
  roots.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"))
  const bat = project.entities[0]!
  const kept = ["hover", "dive", "strike", "stuck"]
  const animations = { [bat.id]: ["idle", "walk", "hurt", "roar", "wave", ...kept] }
  const later = { ...project, entities: [{ ...bat, later_clips: [...kept, "wave"].map((clip) => ({ clip, reason: "留给以后的飞行一套" })) }, ...project.entities.slice(1)] } as Project
  const said = (changed: Project) => buildWarnings(reconcile(changed, { animations })).filter((warning) => warning.rule.startsWith("animation_")).map((warning) => [warning.rule, warning.severity])
  expect(said(project)).toEqual([["animation_unplayed", "defect"]])
  expect(said(later)).toEqual([["animation_later", "advice"]])
})
