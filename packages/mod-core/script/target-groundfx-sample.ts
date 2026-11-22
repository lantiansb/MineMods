import path from "node:path"
import { putModelAsset } from "../src/assets"
import { AbilitySchema } from "../src/entity-runtime"
import { createEntity, createProject, EntitySchema, ProjectSchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { WorkspaceAssetSchema } from "../src/workspace"
import { fightingGolemDesign, golemEffects } from "./data-gameplay-sample"

/**
 * 第 4 步 (效果和表现) in one project with a Chinese name, for Forge 1.20.1, NeoForge 1.21.1 and Fabric 1.21.1:
 * - 「炎魔」, a boss: 焚地 (`scorch`) slams the ground: a burning hazard at its feet (hurts every half second, sets on fire, sends up flames), a glowing crack under the one it fights
 *   that grows out from the middle, and a shockwave ring that goes out from its feet to 10 blocks with a low wall and strikes whoever it passes; 炎光 (`ray`) is a beam from its head at
 *   the one it fights, turning after them at 3 degrees a tick, for 1.1 seconds, going on through the switch to its strike's own motion halfway.
 * - 「虚空雨师」 calls down glowing spikes (an effect drawn added to what is behind it, `blend: "additive"`) round the one it fights; each leaves a void pool and a dark crack where it
 *   comes down (落地炸开 `impact.ground`), and the ground under it sweeps a beam straight ahead (`aim: "ahead"`).
 *
 *   bun packages/mod-core/script/target-groundfx-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
export const GROUND_FX_SAMPLE_IDS = { spike: "b2b2b2b2-0000-4000-8000-0000000000f4" } as const

export const scorchAbility = AbilitySchema.parse({
  id: "scorch",
  name: "焚地",
  clip: "slam",
  windup: 0.5,
  length: 1.2,
  facing: "track",
  hits: [{ type: "area", at: 0.7, shape: { type: "sphere", forward: 1.5, up: 0.5, left: 0, radius: 2.5 }, hits: "everyone", damage: 8, knockback: 0.8, effects: [] }],
  moves: [],
  start: { min_distance: 0, max_distance: 8, line_of_sight: true, cooldown: 5, weight: 2 },
  stopped_by_hurt: false,
  events: [
    { type: "hazard", at: 0.7, where: "self", hit: null, forward: 1.5, left: 0, radius: 3, seconds: 5, color: "#ff5a1a", glow: true, damage: 2, hits: "everyone", effects: [], every_ticks: 10, burn_seconds: 3, particle: "flame", count: 6 },
    { type: "crack", at: 0.7, where: "target", hit: null, forward: 0, left: 0, radius: 4, seconds: 6, grow_seconds: 0.5, color: "#ff7a2a", glow: true },
    { type: "shockwave", at: 0.7, where: "hit", hit: 0, forward: 0, left: 0, from_radius: 0.5, to_radius: 10, seconds: 1.2, width: 1.5, height: 1.2, color: "#ffb040", glow: true, damage: 4, knockback: 1, hits: "everyone", effects: [] },
    { type: "shake", at: 0.7, strength: 2, radius: 16, seconds: 0.8 },
  ],
})

export const rayAbility = AbilitySchema.parse({
  id: "ray",
  name: "炎光",
  clip: "burst",
  windup: 0.5,
  length: 1.6,
  facing: "track",
  hits: [{ type: "area", at: 0.5, shape: { type: "sphere", forward: 0, up: 1, left: 0, radius: 0.5 }, hits: "target", damage: 0, knockback: 0, effects: [] }],
  moves: [],
  start: { min_distance: 4, max_distance: 20, line_of_sight: true, cooldown: 6, weight: 1 },
  stopped_by_hurt: true,
  // 第 3 步's stages: halfway through the beam it switches to a motion of its own; the beam belongs to the run of the ability, not to the motion, and goes on.
  stages: [
    { kind: "windup", until: 0.5 },
    { kind: "loop", until: 1, clip: "burst", end: { touch: true } },
    { kind: "strike", until: 1.6, clip: "slam" },
  ],
  events: [{ type: "beam", at: 0.5, until: 1.6, bone: "head", forward: 0.4, up: 0, left: 0, aim: "target", turn: 3, length: 24, width: 0.6, color: "#ff3010", damage: 3, hits: "everyone", effects: [{ effect: "weakness", duration_ticks: 60, amplifier: 0 }], every_ticks: 5 }],
})

export const voidRainAbility = AbilitySchema.parse({
  id: "void_rain",
  name: "虚空雨",
  clip: "burst",
  windup: 0.8,
  length: 1.6,
  facing: "track",
  hits: [
    {
      type: "projectile",
      at: 1,
      look: { effect: GROUND_FX_SAMPLE_IDS.spike },
      from: { sky: { over: { type: "around_target", count: 4, spread: 5 }, height: 14 } },
      speed: 0.5,
      gravity: 0.06,
      path: "straight",
      damage: 4,
      knockback: 0.3,
      effects: [],
      radius: 1.5,
      warn: { seconds: 0.9, look: "ring", color: "purple" },
      impact: {
        particle: "witch",
        count: 12,
        spread: 1,
        ground: [
          { type: "hazard", radius: 2, seconds: 4, color: "#7a2cff", glow: true, damage: 1, hits: "everyone", effects: [{ effect: "poison", duration_ticks: 40, amplifier: 0 }], every_ticks: 20, particle: "dragon_breath", count: 4 },
          { type: "crack", radius: 2.5, seconds: 5, grow_seconds: 0.2, color: "#1c1420", glow: false },
        ],
      },
    },
  ],
  moves: [],
  start: { min_distance: 0, max_distance: 20, line_of_sight: false, cooldown: 4, weight: 1 },
  stopped_by_hurt: false,
  events: [{ type: "beam", at: 0.8, until: 1.5, forward: 1, up: 1.2, left: 0, aim: "ahead", turn: 0, length: 12, width: 0.4, color: "#b070ff", damage: 0, hits: "target", effects: [], every_ticks: 10 }],
})

export async function createTargetGroundFxSample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "地火营", description: "炎魔和虚空雨师。", mod_id: "ground_fire_camp", target })
  const flame = EntitySchema.parse({
    ...createEntity({ name: "炎魔", description: "砸地留火、裂地、冲击波和光束的 Boss。", health: 200, speed: 0.22, attack_damage: 6, behavior: "hostile" }),
    name_en: "Flame Fiend",
    abilities: [scorchAbility, rayAbility],
    boss: { bar: { color: "red", style: "progress", darken_sky: false }, intro: null, phases: [{ below: 0.5, clip: "roar", seconds: 1, bar_color: null, speed: 1.2, damage: 1.3 }], death: { seconds: 2, xp_bursts: 0, explosion: false }, leash: null },
  })
  const rainer = EntitySchema.parse({
    ...createEntity({ name: "虚空雨师", description: "落下的晶刺留下虚空池和地裂。", health: 120, speed: 0.22, attack_damage: 4, behavior: "hostile" }),
    name_en: "Void Rain Caller",
    abilities: [voidRainAbility],
  })
  let project = await saveProject(directory, { ...created, entities: [flame, rainer] }, created.revision)
  for (const entity of [flame, rainer]) project = (await putModelAsset(directory, { entity_id: entity.id, data: { design: fightingGolemDesign }, origin: "example", expectedRevision: project.revision })).project
  const now = new Date().toISOString()
  // The spike, drawn added to what is behind it (第 4 步's glow): the thrown things that look like it glow too.
  const spike = { ...golemEffects.spike.document, play: { ...golemEffects.spike.document.play, blend: "additive" } }
  const saved = WorkspaceAssetSchema.parse({ id: GROUND_FX_SAMPLE_IDS.spike, module: "effect", title: "发光晶刺", revision: 1, created_at: now, updated_at: now, prompt: "发光晶刺", dependencies: [], document: spike, provenance: { model: "example", request_id: null }, status: "ready" })
  return saveProject(directory, ProjectSchema.parse({ ...project, workspace: { assets: [...project.workspace.assets, saved] } }), project.revision)
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-groundfx-sample.ts <empty directory> [target]")
  const project = await createTargetGroundFxSample(path.resolve(directory), target as TargetId)
  console.log(`Ground effects project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}
