import path from "node:path"
import { putModelAsset } from "../src/assets"
import { AbilitySchema } from "../src/entity-runtime"
import { FixtureDocumentSchema } from "../src/fixture"
import { createEntity, createProject, EntitySchema, ProjectSchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { WorkspaceAssetSchema } from "../src/workspace"
import { fightingGolemDesign, golemEffects } from "./data-gameplay-sample"
import { emberParticle } from "./target-ability-sample"

/**
 * Boss 能力 12 (场地物件 + 雾) and 13 (涿鹿) in one project with a Chinese name, for Forge 1.20.1, NeoForge 1.21.1 and Fabric 1.21.1:
 * - 「蚩尤」, a boss (its glowing eyes and veins stay visible in the fog), fights from the start; its arena puts four 「指南车」 down on a ring of 10 blocks round its home
 *   (held 1 s to light, lit 30 s, clearing 6 blocks round them, 3 s before one may be lit again), and its fog (6 blocks, 1 s to come down, its blows on a player in it ×1.5,
 *   that player's on it ×0.5) lifts once all four have been lit.
 * - 「起雾」 brings the fog down. 「涿鹿」: it leaves the field (up 16 blocks) at 0.4 s; a comet (the effect 「地面晶刺」 drawn 3 times as large) falls on the arena's middle from 24
 *   blocks up, warned 2 s before, and bursts where it lands (落地炸开: the spike painted to glow, 24 of the project's own 「余烬」 within 2 blocks, the screens within 32 blocks shaken);
 *   at 4 s the whole arena is struck for 20 (warned 2 s before) but 4 blocks round every lit fixture; at 8 s it is back at the arena's middle.
 *   Its leash ends a fight after 5 seconds with nobody within the battle range (so a fight left while it is away is reset while it is away).
 *
 *   bun packages/mod-core/script/target-arena-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
export const ARENA_SAMPLE_IDS = { compass: "c3c3c3c3-0000-4000-8000-000000000001", spike: "c3c3c3c3-0000-4000-8000-000000000002", ember: "c3c3c3c3-0000-4000-8000-000000000003", flare: "c3c3c3c3-0000-4000-8000-000000000004" } as const

/**
 * 「赤焰晶刺」: the spike painted to glow, the comet's burst. Beside the plain spike (the comet itself) it makes a mod whose effects glow and do not glow at
 * once: the shared effect renderer must glow only the one that has a glow picture (an empty one crashed GeckoLib, the 蚩尤 run of 2026-11-16).
 */
export const flareEffect = {
  ...golemEffects.spike.document,
  bones: golemEffects.spike.document.bones.map((bone) => ({ ...bone, cubes: bone.cubes.map((cube) => ({ ...cube, paint: { material: "crystal", base: "#FF6A2A" }, features: [{ type: "veins", face: "all", glow: true }] })) })),
}

const flat = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })
const feature = (type: string, extra: Record<string, unknown> = {}) => ({ type, face: null, shape: null, color: null, color2: null, x: null, y: null, size: null, count: null, glow: null, mirror: null, ...extra })

/** 「指南车」: a stone base, a pole and a little bronze figure whose pointing arm turns once lit; a lamp on its chest glows while it is lit. */
export const compassFixture = FixtureDocumentSchema.parse({
  kind: "fixture",
  name: "compass_cart",
  texture_size: 64,
  bones: [
    { name: "base", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ name: "stone", origin: [-7, 0, -7], size: [14, 4, 14], faces: flat("#6F6A61") }, { name: "pole", origin: [-1, 4, -1], size: [2, 10, 2], faces: flat("#5B4A33") }] },
    {
      name: "figure",
      parent: "base",
      pivot: [0, 14, 0],
      rotation: [0, 0, 0],
      cubes: [{ name: "body", origin: [-2, 14, -2], size: [4, 7, 4], faces: flat("#B08A4A"), features: [feature("eyes", { face: "north", shape: "dot", color: "#FFD36B", x: 0.5, y: 0.4, glow: true })] }, { name: "arm", origin: [-0.5, 19, -7], size: [1, 1, 5], faces: flat("#C49A55") }],
    },
  ],
  animations: [
    { name: "dark", length: 4, loop: true, channels: [{ bone: "figure", keyframes: [{ time: 0, rotation: [0, -4, 0] }, { time: 2, rotation: [0, 4, 0] }, { time: 4, rotation: [0, -4, 0] }] }] },
    { name: "lit", length: 2, loop: true, channels: [{ bone: "figure", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [0, 180, 0] }, { time: 2, rotation: [0, 360, 0] }] }] },
  ],
  play: { unlit: "dark", lit: "lit", glow: "lit" },
})

/** The golem with one motion long enough for its leave: arms up, held, down. */
export const chiyouDesign = {
  ...fightingGolemDesign,
  name: "蚩尤",
  animations: [
    ...fightingGolemDesign.animations,
    {
      name: "zhuolu",
      length: 9,
      loop: false,
      channels: [(["arm_left", "arm_right"] as const).map((bone, index) => ({ bone, keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.4, rotation: [-170, 0, index ? 15 : -15] }, { time: 8.5, rotation: [-170, 0, index ? 15 : -15] }, { time: 9, rotation: [0, 0, 0] }] }))].flat(),
    },
  ],
}

export const fogAbility = AbilitySchema.parse({
  id: "fog_call",
  name: "起雾",
  clip: "roar",
  windup: 0.3,
  length: 0.8,
  facing: "lock",
  hits: [{ type: "area", at: 0.4, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 0.5 }, hits: "target", damage: 0, knockback: 0, effects: [] }],
  moves: [],
  start: { min_distance: 0, max_distance: 32, line_of_sight: false, cooldown: 60, weight: 1 },
  stopped_by_hurt: false,
  events: [{ type: "fog", at: 0.4 }],
})

export const zhuoluAbility = AbilitySchema.parse({
  id: "zhuolu",
  name: "涿鹿",
  clip: "zhuolu",
  windup: 0.4,
  length: 9,
  facing: "lock",
  hits: [
    { type: "projectile", at: 3, look: { effect: ARENA_SAMPLE_IDS.spike }, size: 3, from: { sky: { over: "center", height: 24 } }, speed: 1.2, gravity: 0.04, path: "straight", damage: 0, knockback: 0, effects: [], radius: 0, warn: { seconds: 2, look: "pillar", color: "red" }, impact: { effect: ARENA_SAMPLE_IDS.flare, particle: { asset: ARENA_SAMPLE_IDS.ember }, count: 24, spread: 2, shake: { strength: 3, radius: 32, seconds: 1 } } },
    { type: "area", at: 4, shape: { type: "arena", low: -2, high: 6 }, hits: "everyone", damage: 20, knockback: 0.5, effects: [], warn: { seconds: 2, look: "ring", color: "red" }, safe: { around: "lit_fixtures", radius: 4 } },
  ],
  moves: [{ type: "leave", at: 0.4, rise: 16, back: { at: 8, place: "center" } }],
  start: { min_distance: 0, max_distance: 32, line_of_sight: false, cooldown: 30, weight: 1 },
  stopped_by_hurt: false,
  events: [{ type: "shake", at: 4, strength: 2, radius: 32, seconds: 1 }],
})

export async function createTargetArenaSample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "涿鹿之野", description: "蚩尤在涿鹿之野起雾，四座指南车破雾。", mod_id: "zhuolu_field", target })
  const chiyou = EntitySchema.parse({
    ...createEntity({ name: "蚩尤", description: "雾里只看得见它的眼睛和身上的光。", health: 400, speed: 0.22, attack_damage: 6, behavior: "hostile" }),
    name_en: "Chiyou",
    runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null },
    engagement: "any_player",
    abilities: [fogAbility, zhuoluAbility],
    boss: {
      bar: { color: "red", style: "notched_10", darken_sky: false },
      intro: null,
      phases: [],
      death: { seconds: 2, xp_bursts: 0, explosion: false },
      leash: { distance: 32, reset_seconds: 5 },
      arena: {
        fixtures: [{ id: "compass", look: { asset: ARENA_SAMPLE_IDS.compass }, place: { ring: { count: 4, radius: 10 } }, use: { seconds: 1, cooldown: 3 }, clear: { radius: 6, seconds: 30 } }],
        fog: { visibility: 6, fade_seconds: 1, boss_damage: 1.5, damage_taken: 0.5, lift: "all_lit_once" },
      },
    },
  })
  const project = await saveProject(directory, { ...created, entities: [chiyou] }, created.revision)
  const modelled = (await putModelAsset(directory, { entity_id: chiyou.id, data: { design: chiyouDesign }, origin: "example", expectedRevision: project.revision })).project
  const now = new Date().toISOString()
  const saved = (id: string, module: string, title: string, document: unknown) => WorkspaceAssetSchema.parse({ id, module, title, revision: 1, created_at: now, updated_at: now, prompt: title, dependencies: [], document, provenance: { model: "example", request_id: null }, status: "ready" })
  return saveProject(
    directory,
    ProjectSchema.parse({ ...modelled, workspace: { assets: [...modelled.workspace.assets, saved(ARENA_SAMPLE_IDS.compass, "fixture", "指南车", compassFixture), saved(ARENA_SAMPLE_IDS.spike, "effect", golemEffects.spike.title, golemEffects.spike.document), saved(ARENA_SAMPLE_IDS.ember, "particle", "余烬", emberParticle), saved(ARENA_SAMPLE_IDS.flare, "effect", "赤焰晶刺", flareEffect)] } }),
    modelled.revision,
  )
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-arena-sample.ts <empty directory> [target]")
  const project = await createTargetArenaSample(path.resolve(directory), target as TargetId)
  console.log(`Arena project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}
