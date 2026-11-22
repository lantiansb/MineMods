import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AbilitySchema, type Ability } from "../src/entity-runtime"
import { STEADY_INSTRUCTIONS } from "../src/creature-steady"
import type { Project } from "../src/project"
import { reconcile } from "../src/reconcile"
import { createDataGameplaySample } from "../script/data-gameplay-sample"

/**
 * r29c 乙 第 4 件 (a fog beast, r28 第 3 包): a pounce written aim "target", short 0, max_distance 9 at a player 7.5 away landed more than a block off. Its cause is not the
 * movement speed (the leap's landing never reads it) nor the landing being blocked: a steady creature leaves along its body as turned by then (`abilityLeapStart`, 6° in the
 * tick it leaves at 120°/s), as far as its target is, and `keep_heading` with `lock` let it start facing elsewhere. The build now says so, with the ways to aim it.
 */

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const pounce = AbilitySchema.parse({
  id: "pounce", name: "扑咬", clip: "roar", windup: 0.45, length: 2.4, facing: "lock", stopped_by_hurt: false, events: [],
  hits: [{ type: "area", at: 0.8, shape: { type: "sphere", forward: 0, up: 0.4, left: 0, radius: 1.3 }, hits: "everyone", damage: 6, knockback: 0.2, effects: [] }],
  moves: [{ type: "leap", at: 0.45, land: 0.8, height: 1.2, aim: "target", max_distance: 9, short: 0 }],
  start: { keep_heading: true, min_distance: 2, max_distance: 8, line_of_sight: true, cooldown: 3.5, weight: 40 },
})

async function advice(ability: Ability, steady: unknown = { preset: "large", ability_turn: 120 }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-leap-"))
  roots.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"))
  const golem = project.entities[0]!
  const changed = { ...project, entities: [{ ...golem, behavior: "hostile", steady, hitbox: { core: { width: 0.9, height: 1 } }, abilities: [ability] }, ...project.entities.slice(1)] } as Project
  return reconcile(changed, { animations: { [golem.id]: ["idle", "walk", "hurt", "roar", "wave"] } }).filter((finding) => finding.rule === "steady_advice" && finding.text.includes("跳扑"))
}

test("a steady pounce that may start facing elsewhere and cannot turn round before it leaves is said, with how to aim it", async () => {
  const said = await advice(pounce)
  expect(said).toHaveLength(1)
  expect(said[0]!.text).toContain("最多只转 6°")
  expect(said[0]!.fix).toContain("keep_heading")
  expect(said[0]!.fix).toContain('place:"target"')
  // Tracking through its wind-up at the preset's 120°/s it turns 60° more: still not round.
  expect((await advice({ ...pounce, facing: "track" } as Ability))[0]!.text).toContain("最多只转 60°")
})

test("a pounce that faces its target first, turns round in time, or belongs to a creature that is not steady is not said", async () => {
  expect(await advice({ ...pounce, start: { ...pounce.start, keep_heading: undefined } } as Ability)).toEqual([])
  expect(await advice({ ...pounce, facing: "track", turn_speed: 1200 } as Ability)).toEqual([])
  expect(await advice(pounce, null)).toEqual([])
  expect(STEADY_INSTRUCTIONS).toContain("写了 keep_heading 的招身体可能还没对准，跳扑会落在目标旁边")
})
