import path from "node:path"
import { putModelAsset } from "../src/assets"
import { AbilitySchema, BossSchema, HitboxSchema } from "../src/entity-runtime"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign } from "./data-gameplay-sample"

export const partAbility = AbilitySchema.parse({ id: "sweep", name: "挥兵器", clip: "slam", windup: 0.3, length: 1.2, facing: "lock", hits: [{ type: "area", at: 0.6, shape: { type: "sphere", forward: -8, up: 0, left: 0, radius: 0.2 }, hits: "everyone", damage: 0, knockback: 0, effects: [] }], moves: [], start: { min_distance: 0, max_distance: 6, line_of_sight: false, cooldown: 2, weight: 1 }, stopped_by_hurt: false, events: [] })
// damage_cap 25: a weak point that triples a 10-point blow (30) still takes only 25, the cap of the boss base being applied after the part's scale.
export const partBoss = BossSchema.parse({ bar: { color: "red", style: "progress", darken_sky: false }, intro: null, phases: [{ below: 0.66, clip: null, seconds: 0.5, bar_color: null, speed: 1, damage: 1 }, { below: 0.33, clip: null, seconds: 0.5, bar_color: null, speed: 1, damage: 1 }], death: { seconds: 1, xp_bursts: 0, explosion: false }, leash: null, damage_cap: 25 })
export const combatHitbox = HitboxSchema.parse({ core: { width: 1, height: 2 }, parts: [
  { name: "胸口", forward: 1.5, up: 1, left: 0, width: 1, height: 1, damage_scale: 2, phase_scales: [{ phase: 1, damage_scale: 0.25 }, { phase: 2, damage_scale: 3 }], weakpoint_sound: "entity.player.attack.crit" },
  { name: "硬甲", forward: 0, up: 1, left: 1.5, width: 1, height: 1, damage_scale: 0.25, weakpoint_sound: null },
  { name: "盾牌", forward: 0, up: 1, left: -1.5, width: 1, height: 1, damage_scale: 0 },
  { name: "兵器", forward: 2.5, up: 0, left: 0, width: 2, height: 2, bone: "arm_right", contact: [{ ability: "sweep", from: 0.3, to: 0.8, damage: 6, knockback: 0.6 }, { ability: "sweep", from: 0.9, damage: 3, knockback: 0 }] },
] })

export async function createTargetHitboxSample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "部位试炼", description: "胸口弱点、硬甲、盾牌和挥动的兵器。", mod_id: "parts_check", target })
  const entity = EntitySchema.parse({ ...createEntity({ name: "铁甲守卫", description: "用于部位战斗验证的 Boss。", health: 200, speed: 0.2, attack_damage: 0, behavior: "hostile" }), abilities: [partAbility], boss: partBoss, hitbox: combatHitbox })
  const project = await saveProject(directory, { ...created, entities: [entity] }, created.revision)
  return (await putModelAsset(directory, { entity_id: entity.id, data: { design: fightingGolemDesign }, origin: "example", expectedRevision: project.revision })).project
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun script/target-hitbox-sample.ts <empty directory> [target]")
  console.log(await createTargetHitboxSample(path.resolve(directory), target as TargetId))
}
