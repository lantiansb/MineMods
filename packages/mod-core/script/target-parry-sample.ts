import path from "node:path"
import { putModelAsset } from "../src/assets"
import { AbilitySchema } from "../src/entity-runtime"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign } from "./data-gameplay-sample"

/**
 * Boss 能力 14 (夺兵) in one project with a Chinese name, for Fabric 1.21.1, Forge 1.20.1 and NeoForge 1.21.1:
 * - 「兵主」, a hostile creature with two abilities:
 *   - 夺兵 `disarm`: started by a melee blow (30% of the blows that may, 1 second's wait after it ends, the attacker within 5 blocks): the blow is parried (it does nothing),
 *     sparks and a clang at that moment, the player who struck is disarmed for 3 seconds, and 0.6 seconds later a counter swing in front of it (4 damage, the one who struck);
 *   - 重锤 `slam`: an ordinary swing chosen by distance (0–3 blocks, every 6 seconds).
 * - 「蚩尤」, a boss whose second phase (below two thirds of its life) adds the same parry (`add`), with a longer wait: in the first phase no blow is parried.
 *
 *   bun packages/mod-core/script/target-parry-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
export const parryAbility = AbilitySchema.parse({
  id: "disarm",
  name: "夺兵",
  clip: "wave",
  windup: 0.3,
  length: 1,
  facing: "track",
  hits: [{ type: "area", at: 0.6, shape: { type: "arc", reach: 4, angle: 120, low: -0.5, high: 3 }, hits: "target", damage: 4, knockback: 0.5, effects: [] }],
  moves: [],
  start: { min_distance: 0, max_distance: 5, line_of_sight: false, cooldown: 0, weight: 1 },
  stopped_by_hurt: false,
  events: [
    { type: "particle", at: 0, particle: "crit", count: 24, forward: 1, up: 1.6, left: 0, spread: 0.6 },
    { type: "sound", at: 0, sound: "entity.zombie.attack_iron_door", volume: 1, pitch: 1.4 },
  ],
  on_hurt: { chance: 0.3, cooldown: 1, by: "melee", block: true, disarm: { seconds: 3 } },
})

export const slamAbility = AbilitySchema.parse({
  id: "slam",
  name: "重锤",
  clip: "slam",
  windup: 0.5,
  length: 1.2,
  facing: "track",
  hits: [{ type: "area", at: 0.7, shape: { type: "arc", reach: 3, angle: 120, low: -0.5, high: 2.5 }, hits: "everyone", damage: 3, knockback: 0.5, effects: [] }],
  moves: [],
  start: { min_distance: 0, max_distance: 3, line_of_sight: true, cooldown: 6, weight: 1 },
  stopped_by_hurt: false,
  events: [],
})

/** The boss's parry: the same, with the wait of the move table (8 seconds) and its chance (15%). */
export const bossParryAbility = AbilitySchema.parse({ ...parryAbility, on_hurt: { chance: 0.15, cooldown: 8, by: "melee", block: true, disarm: { seconds: 3 } } })

export async function createTargetParrySample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "涿鹿夺兵", description: "兵主架住近身的一击、反手还击，打它的人兵器被夺。", mod_id: "war_lord_parry", target })
  const lord = EntitySchema.parse({
    ...createEntity({ name: "兵主", description: "架住近身的一击，反手还击。", health: 400, speed: 0.22, attack_damage: 4, behavior: "hostile" }),
    name_en: "War Lord",
    abilities: [parryAbility, slamAbility],
  })
  const chiyou = EntitySchema.parse({
    ...createEntity({ name: "蚩尤", description: "二阶段起会夺兵。", health: 300, speed: 0.22, attack_damage: 6, behavior: "hostile" }),
    name_en: "Chiyou",
    abilities: [bossParryAbility, slamAbility],
    boss: {
      bar: { color: "red", style: "notched_6", darken_sky: false },
      intro: null,
      phases: [{ below: 0.66, clip: null, seconds: 0.5, bar_color: "purple", speed: 1, damage: 1.2, add: ["disarm"] }],
      death: { seconds: 1, xp_bursts: 0, explosion: false },
      leash: null,
    },
  })
  let project = await saveProject(directory, { ...created, entities: [lord, chiyou] }, created.revision)
  for (const entity of [lord, chiyou]) project = (await putModelAsset(directory, { entity_id: entity.id, data: { design: fightingGolemDesign }, origin: "example", expectedRevision: project.revision })).project
  return project
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-parry-sample.ts <empty directory> [target]")
  const project = await createTargetParrySample(path.resolve(directory), target as TargetId)
  console.log(`Parry project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}
