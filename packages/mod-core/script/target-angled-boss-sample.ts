import path from "node:path"
import { putModelAsset } from "../src/assets"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { WorkspaceAssetSchema } from "../src/workspace"
import { phaseSkin } from "./target-boss-look-sample"

/**
 * 第 1 步 (modelling and painting to the epic measure), one boss for all three targets: 「斜甲守卫」, a stone warden in angled armour.
 * - `angledWardenDesign(true)`: what the model can say now. Shoulder plates, breastplate halves, tusks, back spikes and the crest are cubes turned
 *   about their own pivot (`rotation`, `pivot`); the pauldrons and the belt are grown (`inflate`); every part of the right side wears the left
 *   side's texture mirrored (`share` + `mirror`); the faces are laid tallest first (`atlas: "packed"`), the whole model is painted rich
 *   (`shading: "rich"`, a material and a wear on every part) and its face is painted pixel by pixel (`pixels`, the epic tier).
 * - `angledWardenDesign(false)`: the same creature as it could be written before: every cube upright, each side its own texture, painted flat.
 * - The boss puts on a cracked texture at half its life (`texture`, the phase texture swap).
 *
 *   bun packages/mod-core/script/target-angled-boss-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */

type V = [number, number, number]
type Paint = { material: string; base: string; secondary?: string | null; wear?: number | null }
type CubeIn = { name: string; origin: V; size: V; paint?: Paint; rotation?: V; pivot?: V; inflate?: number; mirror?: boolean; share?: string; pixels?: Record<string, { palette: string[]; data: number[] }> }
type BoneIn = { name: string; parent: string | null; pivot: V; rotation?: V; paint?: Paint; cubes: CubeIn[] }

export const CRACKED_ID = "a17c1ed0-0000-4000-8000-0000000000c1"

const STONE: Paint = { material: "stone", base: "#7A7468", secondary: "#5E5A52", wear: 0.5 }
const METAL: Paint = { material: "metal", base: "#8E959C", secondary: "#6C7379", wear: 0.55 }
const LEATHER: Paint = { material: "leather", base: "#6B4A30", wear: 0.4 }
const BONE: Paint = { material: "bone", base: "#E2D6B8", wear: 0.5 }
const CLOTH: Paint = { material: "cloth", base: "#7A2E2A", secondary: "#5C211E", wear: 0.6 }
const CRYSTAL: Paint = { material: "crystal", base: "#3FD0E0" }

/** The warden's face, 10 by 9 texels, as an epic model may paint it: brow, two glowing eyes, a carved rune, a mouth slit. */
function face(): { palette: string[]; data: number[] } {
  const palette = ["#6E685D", "#58534A", "#8A8478", "#2A2622", "#7FF2FF", "#C8FFFF", "#3A3530", "#9C6A2E"]
  const rows = [
    "2222222222",
    "1111111111",
    "0333003330",
    "0345003540",
    "0033003300",
    "0000700000",
    "0007770000",
    "0636666360",
    "1111111111",
  ]
  return { palette, data: rows.flatMap((row) => [...row].map(Number)) }
}

const faces = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })

/** The left side of the warden (x > 0 is its left); the right side is made from it. */
function leftSide(after: boolean): BoneIn[] {
  const turn = (rotation: V, pivot: V) => (after ? { rotation, pivot } : {})
  return [
    {
      name: "shoulder_left", parent: "torso", pivot: [11, 35, 0], paint: METAL,
      cubes: [
        { name: "pauldron", origin: [8, 33, -5], size: [8, 6, 10], ...(after ? { inflate: 0.5 } : {}), ...turn([0, 0, -18], [9, 36, 0]) },
        { name: "spike_a", origin: [11, 38, -3], size: [2, 6, 2], paint: BONE, ...turn([10, 0, -30], [12, 38, -2]) },
        { name: "spike_b", origin: [11, 38, 1], size: [2, 5, 2], paint: BONE, ...turn([-10, 0, -35], [12, 38, 2]) },
      ],
    },
    { name: "arm_left", parent: "shoulder_left", pivot: [12, 34, 0], paint: STONE, cubes: [{ name: "upper", origin: [10, 24, -3], size: [6, 10, 6] }] },
    {
      name: "forearm_left", parent: "arm_left", pivot: [13, 24, 0], paint: METAL,
      cubes: [
        { name: "bracer", origin: [9.5, 14, -3.5], size: [7, 10, 7] },
        { name: "fist", origin: [10, 9, -3], size: [6, 5, 6], paint: STONE },
        { name: "blade", origin: [12, 12, -9], size: [1, 3, 8], ...turn([0, 20, 0], [12, 13, -4]) },
      ],
    },
    {
      name: "leg_left", parent: "hips", pivot: [4, 18, 0], paint: STONE,
      cubes: [
        { name: "thigh", origin: [1, 4, -3], size: [6, 14, 6] },
        { name: "boot", origin: [0.5, 0, -4], size: [7, 4, 8], paint: LEATHER },
        { name: "knee", origin: [1.5, 9, -4], size: [5, 4, 1], paint: METAL, ...turn([-15, 0, 0], [4, 11, -3.5]) },
      ],
    },
  ]
}

/** The right side as the left side made again across x = 0: what `m.mirror` does, and with `share` the copy wears the left side's texture mirrored. */
function rightSide(left: BoneIn[], after: boolean): BoneIn[] {
  const name = (value: string) => value.replace("_left", "_right")
  return left.map((bone) => ({
    name: name(bone.name),
    parent: bone.parent && bone.parent.endsWith("_left") ? name(bone.parent) : bone.parent,
    pivot: [-bone.pivot[0], bone.pivot[1], bone.pivot[2]],
    ...(bone.paint ? { paint: bone.paint } : {}),
    cubes: bone.cubes.map((cube) => ({
      ...cube,
      origin: [-(cube.origin[0] + cube.size[0]), cube.origin[1], cube.origin[2]] as V,
      ...(cube.rotation ? { rotation: [cube.rotation[0], -cube.rotation[1] + 0, -cube.rotation[2] + 0] as V, pivot: [-cube.pivot![0] + 0, cube.pivot![1], cube.pivot![2]] as V } : {}),
      ...(after ? { share: `${bone.name}.${cube.name}`, mirror: true } : {}),
    })),
  }))
}

export function angledWardenDesign(after: boolean) {
  const turn = (rotation: V, pivot: V) => (after ? { rotation, pivot } : {})
  const left = leftSide(after)
  const bones: BoneIn[] = [
    { name: "root", parent: null, pivot: [0, 0, 0], cubes: [] },
    {
      name: "hips", parent: "root", pivot: [0, 20, 0], paint: STONE,
      cubes: [
        { name: "pelvis", origin: [-7, 17, -4], size: [14, 7, 8] },
        { name: "belt", origin: [-7.5, 20, -4.5], size: [15, 2, 9], paint: LEATHER, ...(after ? { inflate: 0.25 } : {}) },
      ],
    },
    { name: "loincloth", parent: "hips", pivot: [0, 18, -4], paint: CLOTH, cubes: [{ name: "front", origin: [-4, 7, -5], size: [8, 11, 1], ...turn([-8, 0, 0], [0, 18, -4.5]) }] },
    {
      name: "torso", parent: "hips", pivot: [0, 24, 0], paint: STONE,
      cubes: [
        { name: "chest", origin: [-9, 24, -6], size: [18, 14, 12] },
        { name: "core", origin: [-2, 30, -7.5], size: [4, 4, 2], paint: CRYSTAL },
        ...(after
          ? ([
              { name: "plate_left", origin: [0.5, 26, -8], size: [8, 11, 1], paint: METAL, rotation: [0, 14, 0] as V, pivot: [1, 31, -7.5] as V },
              { name: "plate_right", origin: [-8.5, 26, -8], size: [8, 11, 1], paint: METAL, rotation: [0, -14, 0] as V, pivot: [-1, 31, -7.5] as V, share: "torso.plate_left", mirror: true },
            ] satisfies CubeIn[])
          : ([{ name: "plate", origin: [-8.5, 26, -7], size: [17, 11, 1], paint: METAL }] satisfies CubeIn[])),
      ],
    },
    {
      name: "back_spikes", parent: "torso", pivot: [0, 36, 6], paint: BONE,
      cubes: [0, 1, 2].map((index) => ({ name: `spike_${index + 1}`, origin: [-1, 34 - index * 4, 5] as V, size: [2, 7 - index, 2] as V, ...turn([35, 0, 0], [0, 34 - index * 4, 6]) })),
    },
    {
      name: "head", parent: "torso", pivot: [0, 38, -2], paint: STONE,
      cubes: [
        { name: "skull", origin: [-5, 38, -7], size: [10, 9, 9], ...(after ? { pixels: { north: face() } } : {}) },
        { name: "crest", origin: [-1, 46, -6], size: [2, 4, 9], paint: METAL, ...turn([-12, 0, 0], [0, 46, -2]) },
        { name: "tusk_left", origin: [2, 37, -10], size: [2, 2, 5], paint: BONE, ...turn([-30, -15, 0], [3, 38, -7]) },
        { name: "tusk_right", origin: [-4, 37, -10], size: [2, 2, 5], paint: BONE, ...turn([-30, 15, 0], [-3, 38, -7]), ...(after ? { share: "head.tusk_left", mirror: true } : {}) },
      ],
    },
    ...left,
    ...rightSide(left, after),
  ]
  const still = (name: string, length: number, loop: boolean, swing: number) => ({
    name,
    length,
    loop,
    channels: [
      { bone: "torso", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: length / 2, rotation: [swing / 3, 0, 0] }, { time: length, rotation: [0, 0, 0] }] },
      { bone: "arm_left", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: length / 2, rotation: [swing, 0, 0] }, { time: length, rotation: [0, 0, 0] }] },
      { bone: "arm_right", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: length / 2, rotation: [-swing, 0, 0] }, { time: length, rotation: [0, 0, 0] }] },
      { bone: "leg_left", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: length / 2, rotation: [-swing, 0, 0] }, { time: length, rotation: [0, 0, 0] }] },
      { bone: "leg_right", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: length / 2, rotation: [swing, 0, 0] }, { time: length, rotation: [0, 0, 0] }] },
    ],
  })
  return {
    name: after ? "斜甲守卫" : "斜甲守卫（旧写法）",
    texture_size: after ? 256 : 256,
    budget: "epic",
    ...(after ? { shading: "rich", atlas: "packed" } : {}),
    bones: bones.map((bone) => ({
      name: bone.name,
      parent: bone.parent,
      pivot: bone.pivot,
      rotation: bone.rotation ?? [0, 0, 0],
      ...(bone.paint ? { paint: bone.paint } : {}),
      cubes: bone.cubes.map((cube) => ({
        ...cube,
        // The flat face colours every cube carries for tools that do not paint; the painter draws the material.
        faces: faces((cube.paint ?? bone.paint ?? STONE).base),
        surface_details: [],
        ...(after ? {} : { paint: cube.paint ? { ...cube.paint, wear: null } : null }),
      })),
    })),
    animations: [still("idle", 2, true, 4), still("walk", 1, true, 25), still("hurt", 0.5, false, 12)],
  }
}

/** The warden as a boss of three targets: at half its life it puts on a cracked texture (a texture asset the size of its own). */
export async function createTargetAngledBossSample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "斜甲守卫", description: "一个穿着斜甲的石头守卫。", mod_id: "angled_warden", target })
  const design = angledWardenDesign(true)
  const boss = EntitySchema.parse({
    ...createEntity({ name: "斜甲守卫", description: "斜甲守卫，血掉到一半就裂开。", health: 300, speed: 0.2, attack_damage: 10, behavior: "hostile" }),
    name_en: "Angled Warden",
    runtime: { spawn: null, explosion: null, movement: "direct", armor: 8, charging_armor: 8, texture_asset_id: null },
    experience: 60,
    boss: {
      bar: { color: "red", style: "notched_10", darken_sky: false },
      intro: null,
      phases: [{ below: 0.5, clip: null, seconds: 1, bar_color: null, speed: 1.1, damage: 1.2, model: { texture: { asset: CRACKED_ID } } }],
      death: { seconds: 2, xp_bursts: 2, explosion: false },
      leash: { distance: 48, reset_seconds: 120 },
    },
  })
  const now = new Date().toISOString()
  const cracked = WorkspaceAssetSchema.parse({ id: CRACKED_ID, module: "texture", title: "斜甲守卫裂开的样子", revision: 1, created_at: now, updated_at: now, prompt: "裂开的石皮", dependencies: [], document: phaseSkin(design.texture_size, ["#5E5A52", "#FF6A1A"]), provenance: { model: null, request_id: null }, status: "ready" })
  let project = await saveProject(directory, { ...created, entities: [boss], workspace: { assets: [...created.workspace.assets, cracked] } }, created.revision)
  project = (await putModelAsset(directory, { entity_id: boss.id, data: { design }, origin: "example", expectedRevision: project.revision })).project
  return project
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-angled-boss-sample.ts <empty directory> [target]")
  const project = await createTargetAngledBossSample(path.resolve(directory), target as TargetId)
  console.log(`Boss project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}
