// Writes the hand-built specimens of the acceptance standard for the kinds mod-core measures itself: item
// and block pictures, standalone animations, creature rules, recipes and behaviour rules. Every picture is
// drawn here, pixel by pixel; none comes from the game or from another mod. Run: bun test/fixtures/acceptance/make.ts
// Specimens are evidence for the standard, not the standard: each is kept for the one criterion it shows.
import path from "node:path"
import { encodePng } from "../../../src/png"

type Rgba = [number, number, number, number]
const CLEAR: Rgba = [0, 0, 0, 0]
const hex = (value: string): Rgba => [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16), Number.parseInt(value.slice(5, 7), 16), 255]
const picture = (paint: (x: number, y: number) => Rgba) => {
  const pixels = new Uint8Array(16 * 16 * 4)
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) pixels.set(paint(x, y), (y * 16 + x) * 4)
  return `data:image/png;base64,${Buffer.from(encodePng(pixels, 16, 16)).toString("base64")}`
}
// The same every time: a small hash of the position, not a random number.
const grain = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663) ^ ((x + 3) * (y + 7) * 83492791)) >>> 0

// A cut gem: a diamond outline, a lit upper-left facet, a body tone and a shaded lower-right facet.
const gem = picture((x, y) => {
  const reach = Math.abs(x - 7.5) + Math.abs(y - 7.5)
  if (reach > 7) return CLEAR
  if (reach > 5.9) return hex("#12456b")
  if (x + y < 12) return hex(x < 6 && y < 6 ? "#d9fbff" : "#8fe6f5")
  return hex(x + y > 18 ? "#1f7fa8" : "#46b9dc")
})
// A wand: a dark wooden shaft from lower-left to upper-right with a lit edge, and a glowing tip with a rim.
const wand = picture((x, y) => {
  const tip = Math.hypot(x - 11.5, y - 3.5)
  if (tip < 1.6) return hex("#fff3a8")
  if (tip < 2.9) return hex("#f2b53a")
  if (tip < 3.6) return hex("#8a4d12")
  if (x + y === 15 && x < 10) return hex("#a8733f")
  if (x + y === 16 && x < 11) return hex("#6f4423")
  if (x + y === 14 && x < 9) return hex("#3d2413")
  return CLEAR
})
// Ore in stone: a few broad patches of two close stone tones, with clustered ore pieces that have a lit corner.
const ore = picture((x, y) => {
  const lumps = [[3, 3], [10, 4], [5, 10], [12, 11]]
  const lump = lumps.find((value) => Math.abs(x - value[0]!) <= 1 && Math.abs(y - value[1]!) <= 1)
  if (lump) return hex(x === lump[0]! - 1 && y === lump[1]! - 1 ? "#ffe9a6" : x === lump[0]! + 1 || y === lump[1]! + 1 ? "#a8741c" : "#e6b93f")
  return hex((Math.floor(x / 4) + Math.floor(y / 3)) % 3 === 0 ? "#6b6f76" : (Math.floor((x + 2) / 5) + Math.floor(y / 4)) % 2 === 0 ? "#7d8188" : "#747880")
})

const pictures = {
  good: {
    "gem-item": { kind: "item", why: "A cut gem with an outline, a lit facet and a shaded facet: reads at inventory size.", texture: gem },
    "wand-item": { kind: "item", why: "A thin diagonal wand with a glowing tip: small, but a clear silhouette in four tones.", texture: wand },
    "ore-block": { kind: "block", why: "Stone in broad patches of close tones with clustered ore: no lone specks, fully filled.", texture: ore },
  },
  bad: {
    "static-item": { kind: "item", why: "The gem's outline filled with a colour picked per pixel by a hash: static at inventory size.", texture: picture((x, y) => (Math.abs(x - 7.5) + Math.abs(y - 7.5) > 7 ? CLEAR : hex(["#d9fbff", "#12456b", "#f2b53a", "#46b9dc", "#7a3b26", "#3d2413"][grain(x, y) % 6]!))) },
    "brick-item": { kind: "item", why: "A shaded picture that fills the whole square: an item that looks like a block.", texture: picture((x, y) => hex(y < 3 ? "#d98b6a" : y > 12 ? "#7a3b26" : x % 8 === 0 ? "#8f4a31" : "#b5623f")) },
    "speck-item": { kind: "item", why: "Four pixels in the middle of an empty square: nothing to see in a slot.", texture: picture((x, y) => (x >= 7 && x <= 8 && y >= 7 && y <= 8 ? hex(x === 7 ? "#f2b53a" : "#8a4d12") : CLEAR)) },
    "flat-item": { kind: "item", why: "The gem's outline in one flat colour: a shape with no light on it.", texture: picture((x, y) => (Math.abs(x - 7.5) + Math.abs(y - 7.5) > 7 ? CLEAR : hex("#46b9dc"))) },
    "noise-block": { kind: "block", why: "A palette colour picked per pixel by a hash: television static.", texture: picture((x, y) => hex(["#3e6285", "#c9dce2", "#18232b", "#8ff0ff", "#a8741c", "#7a3b26", "#2f6b3a"][grain(x, y) % 7]!)) },
    "flat-block": { kind: "block", why: "One colour on every pixel: the same as having no picture at all.", texture: picture(() => hex("#7d8188")) },
    "holed-block": { kind: "block", why: "The ore block with a transparent window cut in it: a solid block cannot show through.", texture: picture((x, y) => (x >= 6 && x <= 9 && y >= 6 && y <= 9 ? CLEAR : hex((Math.floor(x / 4) + Math.floor(y / 3)) % 3 === 0 ? "#6b6f76" : (Math.floor((x + 2) / 5) + Math.floor(y / 4)) % 2 === 0 ? "#7d8188" : "#747880"))) },
  },
} as const

const item = (texture: string) => ({ kind: "item", identifier: "specimen", name: "样品", max_stack: 64, color: "#46b9dc", texture })
const block = (texture: string) => ({ kind: "block", identifier: "specimen", name: "样品", hardness: 1.5, luminance: 0, tool: "pickaxe", drop: "self", color: "#7d8188", texture })

type Vec = [number, number, number]
// Nine points of a sine, so the part slows down at both ends of its swing.
const swing = (bone: string, axis: 0 | 1 | 2, amplitude: number, length: number) => ({
  bone,
  keyframes: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map((step) => ({ time: Number((step * length).toFixed(3)), rotation: [0, 1, 2].map((index) => (index === axis ? Number((amplitude * Math.sin(step * Math.PI * 2)).toFixed(2)) : 0)) as Vec })),
})
const keys = (bone: string, ...frames: [number, Vec][]) => ({ bone, keyframes: frames.map(([time, rotation]) => ({ time, rotation })) })
const animation = (name: string, length: number, channels: unknown[]) => ({ kind: "animation", name, length, loop: true, channels })
// The skeleton these animations are for: the accepted guardian among the model specimens.
const SKELETON = "crystal-guardian"

const entity = (fields: Record<string, unknown>) => ({
  kind: "entity", name: "样品", description: "", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile", model_asset_id: "00000000-0000-4000-8000-00000000a001",
  runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null },
  ...fields,
})
const grid = (...cells: (string | null)[]) => [...cells, ...Array.from({ length: 9 - cells.length }, () => null)]
const recipe = (fields: Record<string, unknown>) => ({ kind: "recipe", name: "样品配方", pattern: grid("minecraft:stick", "minecraft:diamond"), result: "specimens:gem", count: 1, ...fields })
// What the recipes are judged in: a mod with a gem that stacks, a relic that does not, and one recipe already saved.
const PANTRY = {
  mod_id: "specimens",
  items: [{ id: "00000000-0000-4000-8000-00000000b001", identifier: "gem", name: "宝石", max_stack: 64, color: "#46b9dc" }, { id: "00000000-0000-4000-8000-00000000b002", identifier: "relic", name: "遗物", max_stack: 1, color: "#f2b53a" }],
  recipes: [{ id: "00000000-0000-4000-8000-00000000c001", name: "火把", pattern: grid("minecraft:coal", null, null, "minecraft:stick"), result: "minecraft:torch", count: 4 }],
}
// A trunk on two stiff legs whose walk turns only the trunk: both soles stay where they are on the ground while the game carries the body over it.
const GLIDER = (() => {
  const faces = { north: "#778899", east: "#778899", south: "#778899", west: "#778899", up: "#99aabb", down: "#556677" }
  const cube = (name: string, origin: number[], size: number[]) => ({ name, origin, size, faces, surface_details: [] })
  const turning = (name: string) => ({ name, length: 1.6, loop: true, channels: [{ bone: "body", keyframes: [0, 0.8, 1.6].map((time, key) => ({ time, rotation: [0, 3 * (key === 1 ? -1 : 1), 0] })) }] })
  return {
    kind: "model",
    name: "glider",
    texture_size: 128,
    bones: [
      { name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [] },
      { name: "body", parent: "root", pivot: [0, 26, 0], rotation: [0, 0, 0], cubes: [cube("trunk", [-16, 21, -8], [32, 29, 19])] },
      { name: "leg_left", parent: "root", pivot: [6, 24, 0], rotation: [0, 0, 0], cubes: [cube("leg", [1, 0, -2], [10, 20, 4])] },
      { name: "leg_right", parent: "root", pivot: [-6, 24, 0], rotation: [0, 0, 0], cubes: [cube("leg", [-11, 0, -2], [10, 20, 4])] },
    ],
    animations: ["idle", "walk", "hurt"].map(turning),
  }
})()
const logic = (animation: string) => ({ kind: "logic", entity_id: "00000000-0000-4000-8000-00000000a001", trigger: "player_near", action: "play_animation", item: null, animation, enabled: true })

const specimens: Record<"good" | "bad", Record<string, Record<string, unknown>>> = {
  good: {
    ...Object.fromEntries(Object.entries(pictures.good).map(([name, value]) => [name, { kind: value.kind, why: value.why, document: value.kind === "item" ? item(value.texture) : block(value.texture) }])),
    "tail-sway": { kind: "animation", why: "A tail swaying and a head answering it, both easing at the ends, on bones the skeleton has.", skeleton: SKELETON, document: animation("sway", 2, [swing("tail", 1, 24, 2), swing("head", 1, 6, 2)]) },
    "forest-stalker": { kind: "entity", why: "Hostile, hits for three and walks: what it does and its numbers agree.", document: entity({}) },
    "meadow-grazer": { kind: "entity", why: "Passive and unarmed: nothing claims otherwise.", document: entity({ behavior: "passive", attack_damage: 0 }) },
    "tower-guard": { kind: "entity", why: "Hostile at speed zero on purpose (a guard that stays on its tower, with its reason written): it is not a chaser that cannot move.", document: entity({ speed: 0, stationary: { reason: "守在塔顶，只在原地朝来人射击" } }) },
    "gem-from-diamond": { kind: "recipe", why: "Makes something it does not consume, in a count that stacks, on a grid nobody else uses.", pantry: PANTRY, document: recipe({}) },
    "greets-walking": { kind: "logic", why: "Plays an animation its creature's model really has.", skeleton: SKELETON, document: logic("walk") },
  },
  bad: {
    ...Object.fromEntries(Object.entries(pictures.bad).map(([name, value]) => [name, { kind: value.kind, why: value.why, document: value.kind === "item" ? item(value.texture) : block(value.texture) }])),
    "frozen-animation": { kind: "animation", why: "Three tracks that hold one pose from start to end: an animation in name only.", skeleton: SKELETON, document: animation("guard", 2, [keys("tail", [0, [0, 10, 0]], [2, [0, 10, 0]]), keys("head", [0, [5, 0, 0]], [1, [5, 0, 0]]), keys("body", [0, [0, 0, 0]])]) },
    "robot-swing": { kind: "animation", why: "A big swing keyed only at its two ends: constant speed there and back.", skeleton: SKELETON, document: animation("sway", 2, [keys("tail", [0, [0, -30, 0]], [1, [0, 30, 0]], [2, [0, -30, 0]])]) },
    "snap-animation": { kind: "animation", why: "Half a turn between two keys one tick apart: the part teleports.", skeleton: SKELETON, document: animation("flip", 1, [keys("head", [0, [0, 0, 0]], [0.4, [0, 20, 0]], [0.45, [0, 200, 0]], [0.7, [0, 190, 0]], [1, [0, 180, 0]])]) },
    "ghost-bones": { kind: "animation", why: "The good sway written for a wing and an antenna this skeleton does not have.", skeleton: SKELETON, document: animation("sway", 2, [swing("wing_left", 2, 24, 2), swing("antenna", 1, 6, 2), swing("tail", 1, 20, 2)]) },
    "half-size-texture": { kind: "texture", why: "A tidy texture drawn at 32×32 for a model whose texture space is 128×128: it cannot be put on.", skeleton: SKELETON, document: { kind: "texture", width: 32, height: 32, palette: ["#3e6285", "#4c5f6e", "#8ff0ff", "#18232b"], pixels: Array.from({ length: 32 * 32 }, (_, index) => (Math.floor((index % 32) / 4) + Math.floor(index / 32 / 4)) % 4) } },
    "toothless-hunter": { kind: "entity", why: "Hostile with no attack and no explosion: it chases and then can do nothing.", document: entity({ attack_damage: 0 }) },
    "muzzle-that-is-not-there": { kind: "entity", why: "Shoots an arrow from a part called muzzle, which the model it wears does not have: the build would refuse it, so it is refused here first.", skeleton: SKELETON, document: entity({ abilities: [{ id: "shoot", name: "射击", clip: "shoot", windup: 0.3, length: 0.8, facing: "track", hits: [{ type: "shot", at: 0.5, projectile: "arrow", speed: 1.6, forward: 1, up: 1.2, damage: 3, bone: "muzzle" }], moves: [], start: { min_distance: 3, max_distance: 14, line_of_sight: true, cooldown: 2, weight: 1 }, stopped_by_hurt: false, events: [] }] }) },
    "rooted-follower": { kind: "entity", why: "Follows the player at speed zero: it never takes a step.", document: entity({ behavior: "follow", attack_damage: 0, speed: 0 }) },
    "gliding-walker": { kind: "entity", why: "Hostile and walking at a speed above zero, wearing a model whose walk turns only the trunk: both feet stay planted while the body is carried over the ground.", model: GLIDER, document: entity({}) },
    "gem-from-gem": { kind: "recipe", why: "Its own result is one of its ingredients.", pantry: PANTRY, document: recipe({ pattern: grid("specimens:gem", "minecraft:stick") }) },
    "sixteen-relics": { kind: "recipe", why: "Sixteen at once of a thing that stacks to one.", pantry: PANTRY, document: recipe({ result: "specimens:relic", count: 16 }) },
    "second-torch-grid": { kind: "recipe", why: "The saved torch recipe's grid, moved one cell over, making something else.", pantry: PANTRY, document: recipe({ pattern: grid(null, "minecraft:coal", null, null, "minecraft:stick") }) },
    "missing-roar": { kind: "logic", why: "Asks its creature to play an animation the model does not have.", skeleton: SKELETON, document: logic("roar") },
  },
}

await Promise.all(
  (["good", "bad"] as const).flatMap((folder) => Object.entries(specimens[folder]).map(([name, value]) => Bun.write(path.join(import.meta.dir, folder, `${name}.json`), `${JSON.stringify({ name, ...value })}\n`))),
)
console.log(Object.fromEntries((["good", "bad"] as const).map((folder) => [folder, Object.keys(specimens[folder]).length])))
