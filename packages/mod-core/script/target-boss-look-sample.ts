import path from "node:path"
import { putModelAsset } from "../src/assets"
import { AbilitySchema, type Ability } from "../src/entity-runtime"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { WorkspaceAssetSchema } from "../src/workspace"
import { fightingGolemDesign, golemAbilities } from "./data-gameplay-sample"

/**
 * Boss 能力 8 and 10 in one project with a Chinese name, for all three targets: 「变身石魔」, a boss whose model changes with its phases.
 * - At 66% of its life it changes: its left arm comes off (it falls and lies 6 seconds) and its own glowing parts (veins, eyes) go dim and come up again in a second.
 * - At 33%: its head is hidden and a crown it did not show before appears, and a texture asset of its own (an orange band) fades in over two seconds.
 * - With `texture`: at 66% it puts on a cracked texture of its own, at 33% a burning one (texture assets the model's texture size), at once as each phase begins.
 * - With `abilities`: its slam (its dust a cloud, which 1.20.1 has too) shakes the screen the new way (strength 5, roll, a change of view, as strong in its whole radius,
 *   faster) and knocks its right arm off; its burst shakes as before.
 * The model is the fighting golem with one more bone, the crown (on the body, hidden until the last phase shows it).
 *
 *   bun packages/mod-core/script/target-boss-look-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
export const LOOK_GLOW_ID = "b0551ba7-0000-4000-8000-0000000000a1"
/** The cracked and the burning texture its phases put on with `texture`. */
export const LOOK_TEXTURE_IDS = ["b0551ba7-0000-4000-8000-0000000000b1", "b0551ba7-0000-4000-8000-0000000000b2"] as const

const flat = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })
export const crownedGolemDesign = {
  ...fightingGolemDesign,
  bones: [...fightingGolemDesign.bones, { name: "crown", parent: "body", pivot: [0, 27, 0], rotation: [0, 0, 0], cubes: [{ name: "band", origin: [-3, 27, -3], size: [6, 3, 6], faces: flat("#E8B649") }] }],
}

/** The boss's phases (and, with abilities, what its abilities add). */
export const changingBoss = {
  bar: { color: "purple", style: "notched_10", darken_sky: false },
  intro: null,
  phases: [
    { below: 0.66, clip: "wave", seconds: 1, bar_color: "red", speed: 1.1, damage: 1.2, model: { drop: [{ bone: "arm_left", stay_seconds: 6 }], glow: { texture: "emissive", from: 0.2, to: 1, seconds: 1 } } },
    { below: 0.33, clip: "wave", seconds: 1, bar_color: null, speed: 1.2, damage: 1.4, model: { hide: ["head"], show: ["crown"], glow: { texture: { asset: LOOK_GLOW_ID }, from: 0, to: 1, seconds: 2 } } },
  ],
  death: { seconds: 2, xp_bursts: 2, explosion: false },
  leash: { distance: 48, reset_seconds: 120 },
}

/** The slam that shakes the new way and knocks the right arm off, and the burst that shakes as before. */
export const changingAbilities: Ability[] = [
  AbilitySchema.parse({ ...golemAbilities[0], events: [...golemAbilities[0].events.map((event) => (event.type === "particle" ? { ...event, particle: "cloud" } : event)), { type: "shake", at: 0.7, strength: 5, radius: 16, seconds: 1.2, roll: 4, fov: 3, falloff: "none", frequency: 1.5 }, { type: "drop", at: 0.75, bone: "arm_right", stay_seconds: 5 }] }),
  AbilitySchema.parse({ ...golemAbilities[1], events: [...golemAbilities[1].events, { type: "shake", at: 1, strength: 1.5, radius: 12, seconds: 0.6 }] }),
]

/** An orange band across the model's texture (the rest black, which does not glow), the model's texture size a side. */
export function glowBand(side: number) {
  const pixels = Array.from({ length: side * side }, (_, index) => (Math.floor(index / side) % 16 < 4 ? 1 : 0))
  return { kind: "texture" as const, width: side, height: side, palette: ["#000000", "#FF7A1A"], pixels }
}

/** A whole texture of the model's texture size in stripes of two colours: what a phase puts on in place of the model's own. */
export function phaseSkin(side: number, colors: readonly [string, string]) {
  const pixels = Array.from({ length: side * side }, (_, index) => ((Math.floor(index / side) + (index % side)) % 7 === 0 ? 1 : 0))
  return { kind: "texture" as const, width: side, height: side, palette: [...colors], pixels }
}

export async function createTargetBossLookSample(directory: string, target: TargetId, options: { abilities?: boolean; texture?: boolean } = {}) {
  const created = await createProject({ directory, name: "石魔变身", description: "变身石魔每过一条血线就换一个样子。", mod_id: "stone_change", target })
  const boss = EntitySchema.parse({
    ...createEntity({ name: "变身石魔", description: "变身石魔，会掉胳膊、换头冠、发光。", health: 200, speed: 0.22, attack_damage: 8, behavior: "hostile" }),
    name_en: "Changing Golem",
    runtime: { spawn: null, explosion: null, movement: "direct", armor: 6, charging_armor: 6, texture_asset_id: null },
    experience: 40,
    boss: options.texture ? { ...changingBoss, phases: changingBoss.phases.map((phase, index) => ({ ...phase, model: { ...phase.model, texture: { asset: LOOK_TEXTURE_IDS[index]! } } })) } : changingBoss,
    ...(options.abilities ? { abilities: changingAbilities } : {}),
  })
  const now = new Date().toISOString()
  const glow = WorkspaceAssetSchema.parse({ id: LOOK_GLOW_ID, module: "texture", title: "变身石魔的发光带", revision: 1, created_at: now, updated_at: now, prompt: "一条橙色的发光带", dependencies: [], document: glowBand(crownedGolemDesign.texture_size), provenance: { model: null, request_id: null }, status: "ready" })
  const skins = options.texture
    ? (["#6B6B6B", "#3A2A1A"] as const).map((dark, index) =>
        WorkspaceAssetSchema.parse({ id: LOOK_TEXTURE_IDS[index], module: "texture", title: index ? "变身石魔烧红的样子" : "变身石魔裂开的样子", revision: 1, created_at: now, updated_at: now, prompt: index ? "烧红的石皮" : "裂开的石皮", dependencies: [], document: phaseSkin(crownedGolemDesign.texture_size, [dark, index ? "#FF5A1A" : "#1A1A1A"]), provenance: { model: null, request_id: null }, status: "ready" }),
      )
    : []
  let project = await saveProject(directory, { ...created, entities: [boss], workspace: { assets: [...created.workspace.assets, glow, ...skins] } }, created.revision)
  project = (await putModelAsset(directory, { entity_id: boss.id, data: { design: crownedGolemDesign }, origin: "example", expectedRevision: project.revision })).project
  return project
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-boss-look-sample.ts <empty directory> [target]")
  const project = await createTargetBossLookSample(path.resolve(directory), target as TargetId, { abilities: target === "fabric-1.21.1" })
  console.log(`Boss project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}
