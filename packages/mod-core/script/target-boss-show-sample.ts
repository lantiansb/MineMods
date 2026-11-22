import path from "node:path"
import { putModelAsset } from "../src/assets"
import { BossSchema, type Boss } from "../src/entity-runtime"
import { createEntity, createProject, EntitySchema, ProjectSchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { WorkspaceAssetSchema } from "../src/workspace"
import { fightingGolemDesign, golemEffects } from "./data-gameplay-sample"
import { ABILITY_SAMPLE_IDS, emberParticle } from "./target-ability-sample"

/**
 * Boss 能力 15 (多步演出) in one project with a Chinese name, for all three targets: 「四目魔像」, a boss whose wake-up and death are rows of timed steps
 * (the shape of 蚩尤's: four eyes light one by one in a dark fog and it stamps out; its weapons fall from its hands one by one, it kneels, and a grove grows where it fell).
 * - Wake-up (4 seconds): the fight's sky darkens; its four eyes (bones hidden while it sleeps) are shown one by one while its own glow fades in; a roar; it stamps
 *   (a motion of the show), the screen shakes and dust rises; an effect asset marks the ground.
 * - Death (3 seconds): both arms (its weapons) come off one by one, it kneels (held), its eyes go out, it rains for the players of the fight, a ring of blocks is laid round
 *   it and three trees of the game's own grow where it fell (a particle of the project's own as it does).
 * The model is the fighting golem with four eye bones on its head (each painted to glow), and two more motions, `stomp` and `kneel`.
 *
 *   bun packages/mod-core/script/target-boss-show-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */

const flat = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })
const glowing = { type: "veins", face: null, shape: null, color: "#FF3A1A", color2: null, x: null, y: null, size: null, count: 1, glow: true, mirror: null }
const EYES = [
  ["eye_1", -3, 25],
  ["eye_2", 2, 25],
  ["eye_3", -3, 23],
  ["eye_4", 2, 23],
] as const

export const fourEyedDesign = {
  ...fightingGolemDesign,
  bones: [
    ...fightingGolemDesign.bones,
    ...EYES.map(([name, x, y]) => ({ name, parent: "head", pivot: [x + 0.5, y + 0.5, -4.5], rotation: [0, 0, 0], cubes: [{ name: `${name}_glow`, origin: [x, y, -5], size: [1, 1, 1], faces: flat("#FF3A1A"), features: [glowing] }] })),
  ],
  animations: [
    ...fightingGolemDesign.animations,
    {
      name: "stomp",
      length: 1,
      loop: false,
      channels: [
        { bone: "leg_right", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.4, rotation: [-50, 0, 0] }, { time: 0.6, rotation: [0, 0, 0] }, { time: 1, rotation: [0, 0, 0] }] },
        { bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.4, rotation: [-6, 0, 0] }, { time: 0.6, rotation: [8, 0, 0] }, { time: 1, rotation: [0, 0, 0] }] },
      ],
    },
    {
      name: "kneel",
      length: 1,
      loop: false,
      channels: [
        { bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [24, 0, 0] }] },
        { bone: "leg_left", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [-80, 0, 0] }] },
        { bone: "head", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [30, 0, 0] }] },
      ],
    },
  ],
}

/** The ring of blocks its death lays (whole blocks round where it fell, turned with it): eight red blocks of the game. */
const RING = [
  [2, 0], [2, 2], [0, 2], [-2, 2], [-2, 0], [-2, -2], [0, -2], [2, -2],
].map(([forward, left]) => ({ block: "minecraft:red_wool", forward: forward!, up: 0, left: left! }))

export const showBoss: Boss = BossSchema.parse({
  bar: { color: "red", style: "notched_10", darken_sky: false },
  intro: {
    wake_distance: 8,
    clip: null,
    seconds: 4,
    sound: null,
    steps: [
      { type: "weather", at: 0, weather: { rain: false, thunder: false, dark: 0.7 } },
      { type: "glow", at: 0.5, show: ["eye_1"], glow: { texture: "emissive", from: 0, to: 1, seconds: 2 } },
      { type: "glow", at: 1, show: ["eye_2"] },
      { type: "glow", at: 1.5, show: ["eye_3"] },
      { type: "glow", at: 2, show: ["eye_4"] },
      { type: "sound", at: 2.2, sound: "entity.ravager.roar", volume: 2, pitch: 0.8 },
      { type: "clip", at: 2.5, clip: "stomp" },
      { type: "shake", at: 2.9, strength: 2, radius: 16, seconds: 0.8 },
      { type: "particle", at: 2.9, particle: "cloud", count: 24, forward: 1, up: 0, left: 0, spread: 1.5 },
      { type: "effect", at: 3, effect: ABILITY_SAMPLE_IDS.mark, forward: 2, up: 0, left: 0, count: 1, layout: "ring", spread: 0 },
    ],
  },
  phases: [{ below: 0.5, clip: null, seconds: 1, bar_color: null, speed: 1.1, damage: 1.2 }],
  death: {
    seconds: 3,
    xp_bursts: 2,
    explosion: false,
    steps: [
      { type: "drop", at: 0.3, bone: "arm_right", stay_seconds: 20 },
      { type: "drop", at: 0.8, bone: "arm_left", stay_seconds: 20 },
      { type: "clip", at: 1, clip: "kneel" },
      { type: "weather", at: 1, weather: { rain: true, thunder: false, dark: 0.3 } },
      { type: "glow", at: 1.5, hide: ["eye_1", "eye_2", "eye_3", "eye_4"], glow: { texture: "emissive", from: 1, to: 0.2, seconds: 1 } },
      { type: "sound", at: 2, sound: "entity.warden.attack_impact", volume: 1.5, pitch: 1 },
      { type: "place_structure", at: 2.5, forward: 0, left: 0, structure: { blocks: RING } },
      { type: "place_structure", at: 2.6, forward: 0, left: 0, structure: { feature: "cherry", count: 3, spread: 6 } },
      { type: "particle", at: 2.6, particle: { asset: ABILITY_SAMPLE_IDS.ember }, count: 16, forward: 0, up: 1, left: 0, spread: 2 },
    ],
  },
  leash: { distance: 48, reset_seconds: 120 },
})

export async function createTargetBossShowSample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "四目演出", description: "四目魔像醒来时雾里四只眼睛一只一只亮起来，死的时候兵器一件件脱手。", mod_id: "four_eyes", target })
  const boss = EntitySchema.parse({
    ...createEntity({ name: "四目魔像", description: "四只眼睛的魔像，有登场和死亡演出。", health: 200, speed: 0.22, attack_damage: 8, behavior: "hostile" }),
    name_en: "Four-Eyed Golem",
    runtime: { spawn: null, explosion: null, movement: "direct", armor: 4, charging_armor: 4, texture_asset_id: null },
    experience: 40,
    boss: showBoss,
  })
  let project = await saveProject(directory, { ...created, entities: [boss] }, created.revision)
  project = (await putModelAsset(directory, { entity_id: boss.id, data: { design: fourEyedDesign }, origin: "example", expectedRevision: project.revision })).project
  const now = new Date().toISOString()
  const saved = (id: string, module: string, title: string, document: unknown) => WorkspaceAssetSchema.parse({ id, module, title, revision: 1, created_at: now, updated_at: now, prompt: title, dependencies: [], document, provenance: { model: "example", request_id: null }, status: "ready" })
  return saveProject(
    directory,
    ProjectSchema.parse({ ...project, workspace: { assets: [...project.workspace.assets, saved(ABILITY_SAMPLE_IDS.ember, "particle", "余烬", emberParticle), saved(ABILITY_SAMPLE_IDS.mark, "effect", golemEffects.mark.title, golemEffects.mark.document)] } }),
    project.revision,
  )
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-boss-show-sample.ts <empty directory> [target]")
  const project = await createTargetBossShowSample(path.resolve(directory), target as TargetId)
  console.log(`Boss show project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}
