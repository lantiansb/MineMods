import path from "node:path"
import { putModelAsset } from "../src/assets"
import { AbilitySchema, ComboSchema } from "../src/entity-runtime"
import { ParticleDocumentSchema } from "../src/particle"
import { encodePng } from "../src/png"
import { createEntity, createProject, EntitySchema, ProjectSchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { WorkspaceAssetSchema } from "../src/workspace"
import { fightingGolemDesign, golemAbilities, golemEffects } from "./data-gameplay-sample"

/**
 * The abilities group of the platform layer (平台层-移植清单.md, A 组) in one project with a Chinese name, for Forge 1.20.1 and NeoForge 1.21.1 (and Fabric 1.21.1):
 * - 「雷鸣傀儡」 (no runtime block: it fights whoever is its target) has three abilities and a combo of them:
 *   - 重锤 `slam`: an arc in front of it that slows; a lunge forward (`moves`); a weapon trail behind its right arm; embers of the project's own particle, vanilla dust;
 *     the effect 「落点标记」 on where the blow lands;
 *   - 晶刺喷射 `burst`: two thrusts along a line, each with a row of 「地面晶刺」 effects; stopped by being hurt;
 *   - 震地 `quake`: a ball at the feet of the one it fights, warned 0.8 s before by a red ring, and three balls scattered round them warned by yellow pillars;
 *   - the combo 三连击 `triple`: slam, burst, quake, one after another, harder, chosen far more often than any of them alone.
 * - 「投石傀儡」 (a runtime block; it picks the nearest player and fights whoever it is given as its target) throws: an arrow with its own damage, a snowball and a small fireball,
 *   a pull (negative knockback) from its left arm, and a pattern of three warned boxes ahead of it.
 * - A particle asset 「余烬」 (two pictures by age, glowing, falling upward, turning) and the two effect assets.
 *
 *   bun packages/mod-core/script/target-ability-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
export const ABILITY_SAMPLE_IDS = { ember: "a5a5a5a5-0000-4000-8000-000000000001", mark: "a5a5a5a5-0000-4000-8000-000000000002", spike: "a5a5a5a5-0000-4000-8000-000000000003" } as const

const dot = (side: number, colour: readonly [number, number, number]) => {
  const pixels = new Uint8Array(side * side * 4)
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) pixels.set(Math.hypot(x + 0.5 - side / 2, y + 0.5 - side / 2) < side / 3 ? [...colour, 255] : [0, 0, 0, 0], (y * side + x) * 4)
  return `data:image/png;base64,${Buffer.from(encodePng(pixels, side, side)).toString("base64")}`
}

export const emberParticle = ParticleDocumentSchema.parse({ kind: "particle", name: "ember", frames: [dot(8, [255, 255, 255]), dot(8, [255, 220, 160])], frames_by: "age", lifetime: 1, gravity: -0.2, size: { start: 0.2, end: 0.05 }, color: { start: "#ffcc66", end: "#ff3300" }, opacity: { start: 1, end: 0 }, emissive: true, spin: 90 })

const [slamBase, burstBase] = golemAbilities
export const thunderAbilities = [
  AbilitySchema.parse({
    ...slamBase,
    moves: [{ at: 0.5, forward: 0.6, up: 0 }],
    events: [
      // The golem's dust plume came with 1.20.3: a puff of smoke, which 1.20.1 has too.
      ...slamBase.events.map((event) => (event.type === "particle" && event.particle === "dust_plume" ? { ...event, particle: "poof" } : event)),
      { type: "trail", at: 0.5, until: 0.75, bone: "arm_right", color: "#66ccff", width: 0.4, fade_ticks: 6 },
      { type: "particle", at: 0.7, particle: { asset: ABILITY_SAMPLE_IDS.ember }, count: 8, forward: 1.2, up: 0.2, left: 0, spread: 0.4 },
      { type: "effect", at: 0.1, effect: ABILITY_SAMPLE_IDS.mark, where: "hit", hit: 0, forward: 0, up: 0, left: 0, count: 1, layout: "ring", spread: 0 },
    ],
  }),
  AbilitySchema.parse({ ...burstBase, events: [...burstBase.events, ...[1, 1.3].map((at) => ({ type: "effect", at, effect: ABILITY_SAMPLE_IDS.spike, where: "self", hit: null, forward: 1.5, up: 0, left: 0, count: 6, layout: "line", spread: 7.5 }))] }),
  AbilitySchema.parse({
    ...slamBase,
    id: "quake",
    name: "震地",
    hits: [
      { type: "area", at: 1, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 2.5 }, hits: "everyone", damage: 6, knockback: 0.6, effects: [], place: "target", warn: { seconds: 0.8, look: "ring", color: "red" } },
      { type: "area", at: 1.1, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 1.5 }, hits: "everyone", damage: 3, knockback: 0.3, effects: [{ effect: "weakness", duration_ticks: 60, amplifier: 0 }], place: { type: "around_target", count: 3, spread: 4 }, warn: { seconds: 0.9, look: "pillar", color: "yellow" } },
    ],
    events: [{ type: "particle", at: 1, particle: "explosion", count: 4, forward: 0, up: 0.2, left: 0, spread: 1 }],
  }),
]
export const thunderCombo = ComboSchema.parse({ id: "triple", name: "三连击", steps: ["slam", "burst", "quake"], gap_ticks: 2, damage_scale: 1.2, start: { min_distance: 0, max_distance: 10, line_of_sight: false, cooldown: 1, weight: 10 } })

export const throwerAbilities = [
  AbilitySchema.parse({
    id: "volley",
    name: "投掷",
    clip: "burst",
    windup: 0.8,
    length: 1.6,
    facing: "track",
    hits: [
      { type: "shot", at: 1, projectile: "arrow", speed: 1.6, forward: 0.8, up: 1.4, damage: 5 },
      { type: "shot", at: 1.1, projectile: "snowball", speed: 1.2, forward: 0.8, up: 1.4, damage: null },
      { type: "shot", at: 1.3, projectile: "small_fireball", speed: 1, forward: 0.8, up: 1.4, damage: null },
    ],
    moves: [],
    start: { min_distance: 3, max_distance: 16, line_of_sight: true, cooldown: 2, weight: 2 },
    stopped_by_hurt: false,
    events: [{ type: "sound", at: 1, sound: "entity.arrow.shoot", volume: 1, pitch: 1 }],
  }),
  AbilitySchema.parse({
    id: "grab",
    name: "拽人",
    clip: "slam",
    windup: 0.5,
    length: 1.2,
    facing: "lock",
    hits: [
      { type: "area", at: 0.7, shape: { type: "arc", reach: 4, angle: 90, low: -0.5, high: 2.5 }, hits: "target", damage: 2, knockback: -0.8, effects: [{ effect: "slowness", duration_ticks: 20, amplifier: 1 }], bone: "arm_left" },
      { type: "area", at: 1, shape: { type: "box", forward: 0, up: 0, left: 0, width: 2, height: 2, depth: 2 }, hits: "everyone", damage: 4, knockback: 0.4, effects: [], place: { type: "pattern", points: [{ forward: 2, left: 0 }, { forward: 4, left: 1.5 }, { forward: 4, left: -1.5 }] }, warn: { seconds: 0.5, look: "ring", color: "purple" } },
    ],
    moves: [{ at: 0.9, forward: -0.4, up: 0.3 }],
    start: { min_distance: 0, max_distance: 4, line_of_sight: true, cooldown: 3, weight: 1 },
    stopped_by_hurt: true,
    events: [{ type: "sound", at: 0.7, sound: "entity.iron_golem.attack", volume: 1, pitch: 0.8 }],
  }),
]

export async function createTargetAbilitySample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "雷鸣石窟", description: "雷鸣傀儡和投石傀儡守着石窟。", mod_id: "thunder_cave", target })
  const thunder = EntitySchema.parse({
    ...createEntity({ name: "雷鸣傀儡", description: "会连招的石头傀儡。", health: 120, speed: 0.22, attack_damage: 6, behavior: "hostile" }),
    name_en: "Thunder Golem",
    abilities: thunderAbilities,
    combos: [thunderCombo],
  })
  const thrower = EntitySchema.parse({
    ...createEntity({ name: "投石傀儡", description: "远远地扔东西的傀儡。", health: 60, speed: 0.22, attack_damage: 4, behavior: "hostile" }),
    name_en: "Thrower Golem",
    runtime: { spawn: null, explosion: null, movement: "direct", armor: 2, charging_armor: 2, texture_asset_id: null },
    // It picks the nearest player by itself, and fights whoever else it is given as its target.
    engagement: "any_player",
    abilities: throwerAbilities,
  })
  let project = await saveProject(directory, { ...created, entities: [thunder, thrower] }, created.revision)
  for (const entity of [thunder, thrower]) project = (await putModelAsset(directory, { entity_id: entity.id, data: { design: fightingGolemDesign }, origin: "example", expectedRevision: project.revision })).project
  const now = new Date().toISOString()
  const saved = (id: string, module: string, title: string, document: unknown) => WorkspaceAssetSchema.parse({ id, module, title, revision: 1, created_at: now, updated_at: now, prompt: title, dependencies: [], document, provenance: { model: "example", request_id: null }, status: "ready" })
  return saveProject(
    directory,
    ProjectSchema.parse({
      ...project,
      workspace: {
        assets: [
          ...project.workspace.assets,
          saved(ABILITY_SAMPLE_IDS.ember, "particle", "余烬", emberParticle),
          saved(ABILITY_SAMPLE_IDS.mark, "effect", golemEffects.mark.title, golemEffects.mark.document),
          saved(ABILITY_SAMPLE_IDS.spike, "effect", golemEffects.spike.title, golemEffects.spike.document),
        ],
      },
    }),
    project.revision,
  )
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-ability-sample.ts <empty directory> [target]")
  const project = await createTargetAbilitySample(path.resolve(directory), target as TargetId)
  console.log(`Ability project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}
