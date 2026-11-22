import path from "node:path"
import { putModelAsset } from "../src/assets"
import { AbilitySchema } from "../src/entity-runtime"
import { createEntity, createProject, EntitySchema, ProjectSchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { WorkspaceAssetSchema } from "../src/workspace"
import { fightingGolemDesign, golemEffects } from "./data-gameplay-sample"

/**
 * Boss 能力 2 (投射物) in one project with a Chinese name, for Forge 1.20.1, NeoForge 1.21.1 and Fabric 1.21.1:
 * - 「矛将」, a boss, throws its own spear (`lance`, 矛贯): the part `spear` of its model is thrown in an arc at the one it fights, sticks in the ground 5 s where it lands and flies back
 *   to its hand; the spear is hidden on it while it is out.
 * - 「雨师」 calls down a volley (`rain`, 兵器雨): twelve crystal spikes (the effect 「地面晶刺」) scattered within 6 blocks round the one it fights, each place warned by a red ring
 *   a second before they start to fall from 16 blocks up; each bursts into a few of the game's explosion particles where it comes down (落地炸开).
 * - 「回旋傀儡」 throws a crystal mark in a boomerang loop (`whirl`) and a fan of three that fly out and straight back (`fan`).
 *
 *   bun packages/mod-core/script/target-projectile-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
export const PROJECTILE_SAMPLE_IDS = { mark: "b2b2b2b2-0000-4000-8000-000000000001", spike: "b2b2b2b2-0000-4000-8000-000000000002" } as const

const flat = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })

/** The fighting golem with a spear in its right hand: a long thin part under the right arm, held level and pointing ahead at the height of the fist. */
export const spearGolemDesign = {
  ...fightingGolemDesign,
  name: "矛将",
  bones: [
    ...fightingGolemDesign.bones,
    { name: "spear", parent: "arm_right", pivot: [-7, 10, 0], rotation: [0, 0, 0], cubes: [{ name: "shaft", origin: [-8, 9, -14], size: [2, 2, 22], faces: flat("#8A6A3E") }, { name: "head", origin: [-8.5, 8.5, -18], size: [3, 3, 4], faces: flat("#C9D4DE") }] },
  ],
}

export const lanceAbility = AbilitySchema.parse({
  id: "lance",
  name: "矛贯",
  clip: "slam",
  windup: 0.5,
  length: 1.2,
  facing: "track",
  hits: [{ type: "projectile", at: 0.7, look: { bone: "spear" }, from: { bone: "spear" }, speed: 1, gravity: 0.05, path: "arc", damage: 8, knockback: 0.5, effects: [{ effect: "slowness", duration_ticks: 40, amplifier: 0 }], radius: 1.5, pin_seconds: 5, comes_back: { at: 0.7 } }],
  moves: [],
  start: { min_distance: 4, max_distance: 14, line_of_sight: true, cooldown: 8, weight: 1 },
  stopped_by_hurt: false,
  events: [{ type: "sound", at: 0.7, sound: "entity.arrow.shoot", volume: 1, pitch: 0.6 }],
})

export const rainAbility = AbilitySchema.parse({
  id: "rain",
  name: "兵器雨",
  clip: "burst",
  windup: 0.8,
  length: 1.6,
  facing: "track",
  hits: [{ type: "projectile", at: 1, look: { effect: PROJECTILE_SAMPLE_IDS.spike }, from: { sky: { over: { type: "around_target", count: 12, spread: 6 }, height: 16 } }, speed: 0.5, gravity: 0.06, path: "straight", damage: 5, knockback: 0.3, effects: [], radius: 1.5, pin_seconds: 2, warn: { seconds: 0.9, look: "ring", color: "red" }, impact: { particle: "explosion", count: 6, spread: 0.5 } }],
  moves: [],
  start: { min_distance: 0, max_distance: 20, line_of_sight: false, cooldown: 4, weight: 1 },
  stopped_by_hurt: false,
  events: [],
})

export const whirlAbilities = [
  AbilitySchema.parse({
    id: "whirl",
    name: "回旋",
    clip: "burst",
    windup: 0.8,
    length: 1.6,
    facing: "track",
    hits: [{ type: "projectile", at: 1, look: { effect: PROJECTILE_SAMPLE_IDS.mark }, from: { bone: "arm_left" }, speed: 0.8, gravity: 0, path: "boomerang", damage: 4, knockback: 0.4, effects: [], radius: 0 }],
    moves: [],
    start: { min_distance: 3, max_distance: 12, line_of_sight: true, cooldown: 3, weight: 1 },
    stopped_by_hurt: false,
    events: [],
  }),
  AbilitySchema.parse({
    id: "fan",
    name: "三连飞",
    clip: "slam",
    windup: 0.5,
    length: 1.2,
    facing: "lock",
    hits: [{ type: "projectile", at: 0.7, look: { effect: PROJECTILE_SAMPLE_IDS.spike }, from: { bone: "arm_right" }, speed: 1.2, gravity: 0, path: "return", damage: 3, knockback: 0.2, effects: [{ effect: "weakness", duration_ticks: 60, amplifier: 0 }], radius: 0, count: 3, spread: 40 }],
    moves: [],
    start: { min_distance: 3, max_distance: 10, line_of_sight: true, cooldown: 3, weight: 1 },
    stopped_by_hurt: false,
    events: [],
  }),
]

export async function createTargetProjectileSample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "矛将营", description: "矛将、雨师和回旋傀儡。", mod_id: "spear_camp", target })
  const lancer = EntitySchema.parse({
    ...createEntity({ name: "矛将", description: "扔出自己的矛、插在地上再收回来的 Boss。", health: 160, speed: 0.22, attack_damage: 6, behavior: "hostile" }),
    name_en: "Spear General",
    abilities: [lanceAbility],
    boss: { bar: { color: "red", style: "progress", darken_sky: false }, intro: null, phases: [{ below: 0.33, clip: "wave", seconds: 1, bar_color: null, speed: 1.2, damage: 1.3, model: { hide: ["spear"] } }], death: { seconds: 2, xp_bursts: 0, explosion: false }, leash: null },
  })
  const rainer = EntitySchema.parse({
    ...createEntity({ name: "雨师", description: "从天上落下一场兵器雨。", health: 120, speed: 0.22, attack_damage: 4, behavior: "hostile" }),
    name_en: "Rain Caller",
    abilities: [rainAbility],
  })
  const whirler = EntitySchema.parse({
    ...createEntity({ name: "回旋傀儡", description: "扔回旋镖和飞去飞回的三连飞。", health: 80, speed: 0.22, attack_damage: 4, behavior: "hostile" }),
    name_en: "Whirl Golem",
    abilities: whirlAbilities,
  })
  let project = await saveProject(directory, { ...created, entities: [lancer, rainer, whirler] }, created.revision)
  for (const [entity, design] of [[lancer, spearGolemDesign], [rainer, fightingGolemDesign], [whirler, fightingGolemDesign]] as const) project = (await putModelAsset(directory, { entity_id: entity.id, data: { design }, origin: "example", expectedRevision: project.revision })).project
  const now = new Date().toISOString()
  const saved = (id: string, module: string, title: string, document: unknown) => WorkspaceAssetSchema.parse({ id, module, title, revision: 1, created_at: now, updated_at: now, prompt: title, dependencies: [], document, provenance: { model: "example", request_id: null }, status: "ready" })
  return saveProject(
    directory,
    ProjectSchema.parse({
      ...project,
      workspace: {
        assets: [...project.workspace.assets, saved(PROJECTILE_SAMPLE_IDS.mark, "effect", golemEffects.mark.title, golemEffects.mark.document), saved(PROJECTILE_SAMPLE_IDS.spike, "effect", golemEffects.spike.title, golemEffects.spike.document)],
      },
    }),
    project.revision,
  )
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-projectile-sample.ts <empty directory> [target]")
  const project = await createTargetProjectileSample(path.resolve(directory), target as TargetId)
  console.log(`Projectile project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}
