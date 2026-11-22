import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildWarnings } from "../src/build-warnings"
import { CREATURE_LIFE_INSTRUCTIONS } from "../src/creature-life"
import { EntitySchema } from "../src/entity-runtime"
import type { Project } from "../src/project"
import { reconcile } from "../src/reconcile"
import { createDataGameplaySample } from "../script/data-gameplay-sample"

/**
 * r29c 乙 第 2 件 (a fog beast's circling motion, a bird's four flight motions, r28/r29): a motion of the model kept for a behaviour still to come
 * (`later_clips`) is said as something to look at, apart from a motion nothing plays, which is still one to mend.
 */

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function sample() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-later-"))
  roots.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"))
  return { project, golem: project.entities[0]! }
}
const keep = (project: Project, later: unknown): Project => ({ ...project, entities: project.entities.map((entity, index) => (index === 0 ? { ...entity, later_clips: later } : entity)) }) as Project

test("a motion kept for later is said as advice with its reason; one nothing plays and nobody kept is still a defect", async () => {
  const { project, golem } = await sample()
  const animations = { [golem.id]: ["idle", "walk", "hurt", "roar", "wave", "circle"] }
  const warnings = (changed: Project) => buildWarnings(reconcile(changed, { animations })).filter((warning) => warning.rule.startsWith("animation_"))
  // As it always was: both are said to be never played, as one to mend.
  expect(warnings(project).map((warning) => [warning.rule, warning.severity])).toEqual([["animation_unplayed", "defect"]])
  expect(warnings(project)[0]!.text).toContain("2 个动作")
  const kept = warnings(keep(project, [{ clip: "circle", reason: "留给以后绕着光走的行为" }]))
  expect(kept.map((warning) => [warning.rule, warning.severity])).toEqual([["animation_unplayed", "defect"], ["animation_later", "advice"]])
  expect(kept[0]!.text).toContain("1 个动作")
  expect(kept[1]!.text).toContain("留给以后的行为")
  expect(kept[1]!.text).toContain("留给以后绕着光走的行为")
  expect(kept[1]!.refs?.filter((ref) => ref.kind === "clip").map((ref) => ref.id)).toEqual(["circle"])
  // Both kept: nothing left to mend.
  const both = warnings(keep(project, [{ clip: "circle", reason: "留给以后绕着光走的行为" }, { clip: "wave", reason: "留给以后打招呼" }]))
  expect(both.map((warning) => warning.rule)).toEqual(["animation_later"])
  // A kept motion that something plays now is not said at all; a name the model lacks is said, with how to mend it.
  const played = warnings(keep(project, [{ clip: "roar", reason: "以后换成别的吼" }]))
  expect(played.map((warning) => warning.rule)).toEqual(["animation_unplayed"])
  const stray = warnings(keep(project, [{ clip: "cirlce", reason: "拼错了" }]))
  expect(stray.map((warning) => warning.rule)).toEqual(["animation_unplayed", "animation_later"])
  expect(stray[1]!.text).toContain("模型里没有")
  expect(stray[1]!.fix).toContain("later_clips")
})

test("later_clips is bounded and told to an outside AI", () => {
  const base = EntitySchema.parse({ id: "10000000-0000-4000-8000-000000000001", name: "雾兽", description: "", health: 10, speed: 0.2, attack_damage: 2, behavior: "hostile", model_asset_id: null })
  expect(EntitySchema.safeParse({ ...base, later_clips: [{ clip: "circle", reason: "留给以后" }] }).success).toBe(true)
  expect(EntitySchema.safeParse({ ...base, later_clips: [{ clip: "circle", reason: " " }] }).success).toBe(false)
  expect(EntitySchema.safeParse({ ...base, later_clips: [{ clip: "绕圈", reason: "留给以后" }] }).success).toBe(false)
  expect(EntitySchema.safeParse({ ...base, later_clips: Array.from({ length: 33 }, () => ({ clip: "circle", reason: "留给以后" })) }).success).toBe(false)
  expect(CREATURE_LIFE_INSTRUCTIONS).toContain('later_clips 可以不写')
})
