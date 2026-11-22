import path from "node:path"
import { putModelAsset } from "../src/assets"
import { AbilitySchema, HitboxSchema } from "../src/entity-runtime"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign } from "./data-gameplay-sample"

/**
 * Boss 能力 4 (位移类招式) in one project with a Chinese name, for Fabric 1.21.1, Forge 1.20.1 and NeoForge 1.21.1:
 * - 「铁额将」, a big body (a collision box 3 wide and 3.5 tall that steps up a block, and a way round when stuck):
 *   - 铁额撞 `ram`: 0.4 s of getting ready while it turns to the one it fights, then a dash of 20 blocks at 20 blocks a second that stops at a wall,
 *     a box ahead of it counted along the way (each one it holds struck once in the dash);
 *   - 旋涡 `vortex`: a ball at the feet of the one it fights, warned of, that pulls whoever it struck toward where it landed for 2 seconds.
 * - 「风伯」: 起风 `gale`, everything within 6 blocks round it carried to its own left at 5 blocks a second for 3 seconds, with no damage.
 *
 *   bun packages/mod-core/script/target-dash-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
export const ramAbilities = [
  AbilitySchema.parse({
    id: "ram",
    name: "铁额撞",
    clip: "burst",
    windup: 0.4,
    length: 1.6,
    facing: "track",
    hits: [{ type: "area", at: 0.4, shape: { type: "box", forward: 1, up: 1, left: 0, width: 2, height: 2.5, depth: 2 }, hits: "everyone", damage: 6, knockback: 0.5, effects: [] }],
    moves: [{ type: "dash", from: 0.4, to: 1.4, speed: 20, distance: 20, aim: "locked_at_windup", stop_at_wall: true, hit: 0 }],
    start: { min_distance: 4, max_distance: 20, line_of_sight: false, cooldown: 3, weight: 3 },
    stopped_by_hurt: false,
    events: [{ type: "sound", at: 0.4, sound: "entity.ravager.roar", volume: 1, pitch: 1 }],
  }),
  AbilitySchema.parse({
    id: "vortex",
    name: "旋涡",
    clip: "slam",
    windup: 0.5,
    length: 1.2,
    facing: "track",
    hits: [{ type: "area", at: 0.9, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 3 }, hits: "everyone", damage: 2, knockback: 0, effects: [], place: "target", warn: { seconds: 0.6, look: "ring", color: "purple" }, force: { kind: "pull", strength: 3, seconds: 2 } }],
    moves: [],
    start: { min_distance: 0, max_distance: 3, line_of_sight: false, cooldown: 4, weight: 1 },
    stopped_by_hurt: false,
    events: [],
  }),
]

export const galeAbilities = [
  AbilitySchema.parse({
    id: "gale",
    name: "起风",
    clip: "slam",
    windup: 0.5,
    length: 1.2,
    facing: "track",
    hits: [{ type: "area", at: 0.7, shape: { type: "arc", reach: 6, angle: 360, low: -1, high: 3 }, hits: "everyone", damage: 0, knockback: 0, effects: [], force: { kind: "side", strength: 5, seconds: 3 } }],
    moves: [],
    start: { min_distance: 0, max_distance: 6, line_of_sight: false, cooldown: 6, weight: 1 },
    stopped_by_hurt: false,
    events: [{ type: "particle", at: 0.7, particle: "cloud", count: 24, forward: 0, up: 0.5, left: 0, spread: 3 }],
  }),
]

/** The big body of the ram: 3 wide, 3.5 tall, it walks up a whole block, and goes round (or squeezes on) when stuck. */
export const ramHitbox = HitboxSchema.parse({ core: { width: 3, height: 3.5, step: 1 }, stuck: { seconds: 3, squeeze: true } })

export async function createTargetDashSample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "铁额关", description: "铁额将冲撞，风伯起风。", mod_id: "iron_brow_pass", target })
  const ram = EntitySchema.parse({
    ...createEntity({ name: "铁额将", description: "低头冲撞的大个子。", health: 200, speed: 0.22, attack_damage: 8, behavior: "hostile" }),
    name_en: "Iron Brow",
    hitbox: ramHitbox,
    abilities: ramAbilities,
  })
  const gale = EntitySchema.parse({
    ...createEntity({ name: "风伯", description: "把人吹到一边。", health: 80, speed: 0.22, attack_damage: 4, behavior: "hostile" }),
    name_en: "Wind Lord",
    abilities: galeAbilities,
  })
  let project = await saveProject(directory, { ...created, entities: [ram, gale] }, created.revision)
  for (const entity of [ram, gale]) project = (await putModelAsset(directory, { entity_id: entity.id, data: { design: fightingGolemDesign }, origin: "example", expectedRevision: project.revision })).project
  return project
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-dash-sample.ts <empty directory> [target]")
  const project = await createTargetDashSample(path.resolve(directory), target as TargetId)
  console.log(`Dash project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}
