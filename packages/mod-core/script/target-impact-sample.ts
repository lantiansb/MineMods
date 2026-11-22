import path from "node:path"
import { EntitySchema, ProjectSchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { WorkspaceAssetSchema } from "../src/workspace"
import { oggDataUrl, oggVorbis } from "../test/ogg-sample"
import { AbilitySchema } from "../src/entity-runtime"
import { createTargetGroundFxSample, scorchAbility } from "./target-groundfx-sample"
import { samples } from "./target-particle-sample"

/**
 * r29: a bison that charges and is dazed when it runs into a wall, and the puff the game shows where a dead body goes, in one project of
 * the ground effects sample (`createTargetGroundFxSample`), for every target:
 * - 「炎魔」, the boss, puffs the project's own dust where its body goes (`builtin.death_poof`); 「撞墙野牛」 (the sample's second creature,
 *   turned into a bison) leaves no puff at all.
 * - 「撞墙野牛」 charges (冲撞: a loop that a wall ends in a daze, `end.collision[].result.impact`, and that touching somebody ends, `end.impact.touch`) and rams
 *   (撞门: a dash whose blow strikes each one it meets, `impact.touch`, and that a wall stops, `impact.wall`); its daze shows something as it begins (`stagger[].enter`).
 *   With `impacts: false` none of those moments is written: the same creature as r28 could write it (a wall that dazes it), nothing of r29.
 *
 *   bun packages/mod-core/script/target-impact-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
export const IMPACT_SAMPLE_IDS = { dust: "1a2b3c4d-0000-4000-8000-0000000000d1", thud: "1a2b3c4d-0000-4000-8000-0000000000d2" } as const

export async function createTargetImpactSample(directory: string, target: TargetId, options: { impacts?: boolean } = {}) {
  // Without the moments of impact: every `impact` and `enter` left out.
  const plain = <T>(value: T): T => (options.impacts === false ? JSON.parse(JSON.stringify(value, (key, field) => (key === "impact" || key === "enter" ? undefined : field))) : value)
  const project = await createTargetGroundFxSample(directory, target)
  const now = new Date().toISOString()
  const base = { revision: 1, created_at: now, updated_at: now, dependencies: [], provenance: { model: "example", request_id: null }, status: "ready" }
  const dust = WorkspaceAssetSchema.parse({ ...base, id: IMPACT_SAMPLE_IDS.dust, module: "particle", title: "土尘", prompt: "土尘", document: { ...samples[0]!, name: "earth_dust" } })
  const thud = WorkspaceAssetSchema.parse({ ...base, id: IMPACT_SAMPLE_IDS.thud, module: "sound", title: "闷响", prompt: "闷响", document: { kind: "sound", name: "dull_thud", files: [{ data: oggDataUrl(oggVorbis({ samples: 22050 })), duration: 0.5 }], subtitle: { zh: "闷响", en: "Dull thud" }, category: "hostile", volume: 1, pitch: 1 } })
  const own = (fx: Record<string, unknown>) => ({ sound: { asset: thud.id }, particle: { asset: dust.id }, ...fx })
  // 冲撞: gets ready, then charges in a loop until it runs into a wall (dazed, with a thud, earth dust and a shake where it hit) or into somebody (a knock where they met).
  const charge = AbilitySchema.parse(plain({
    ...scorchAbility, id: "charge", name: "冲撞", windup: 0.4, length: 1.2, events: [],
    hits: [{ type: "area", at: 0.45, shape: { type: "box", forward: 1, up: 1, left: 0, width: 1.5, height: 2, depth: 1.5 }, hits: "everyone", damage: 4, knockback: 1, effects: [] }],
    stages: [{ kind: "windup", until: 0.4 }, { kind: "loop", until: 1.2, end: {
      collision: [{ when: { if: "collision", with: "world" }, result: { stagger: "wall_daze", impact: own({ count: 16, shake: { strength: 1.5, radius: 12, seconds: 0.4 } }) } }],
      touch: true, impact: { touch: { sound: "entity.ravager.attack", particle: "crit", count: 6 } },
    } }],
    moves: [{ type: "dash", from: 0.4, to: 1.2, speed: 14, distance: 10, aim: "locked_at_windup", hit: null, stop_at_wall: true }],
    start: { min_distance: 4, max_distance: 16, line_of_sight: true, cooldown: 6, weight: 2 },
  }))
  // 撞门: a short dash whose blow strikes whoever it meets (a thud and dust on each) and that stops at a wall (a door's clang and a puff where it hit).
  const ram = AbilitySchema.parse(plain({
    ...scorchAbility, id: "ram", name: "撞门", windup: 0.4, length: 1.2, events: [],
    hits: [{ type: "area", at: 0.45, shape: { type: "box", forward: 1, up: 1, left: 0, width: 1.5, height: 2, depth: 1.5 }, hits: "everyone", damage: 5, knockback: 1, effects: [] }],
    moves: [{ type: "dash", from: 0.4, to: 1.0, speed: 10, distance: 6, aim: "locked_at_windup", hit: 0, stop_at_wall: true,
      impact: { wall: { sound: "entity.zombie.attack_iron_door", particle: "poof" }, touch: own({ count: 8 }) } }],
    start: { min_distance: 2, max_distance: 8, line_of_sight: true, cooldown: 4, weight: 1 },
  }))
  const entities = project.entities.map((entity, i) =>
    i === 0
      ? EntitySchema.parse({ ...entity, builtin: { death_poof: { particle: { asset: dust.id } } } })
      : EntitySchema.parse({
          ...entity, name: "撞墙野牛", name_en: "Wall Bison", builtin: { death_poof: { particle: "none" } }, abilities: [charge, ram],
          stagger: plain([{ id: "wall_daze", seconds: 2, damage_scale: 1.5, enter: { sound: "block.anvil.land", volume: 0.8, particle: "crit", count: 10, spread: 0.6 } }]),
        }),
  )
  return saveProject(directory, ProjectSchema.parse({ ...project, entities, workspace: { assets: [...project.workspace.assets, dust, thud] } }), project.revision)
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-impact-sample.ts <empty directory> [target]")
  const project = await createTargetImpactSample(path.resolve(directory), target as TargetId)
  console.log(`Impact project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}

