import { randomUUID } from "node:crypto"
import path from "node:path"
import { putModelAsset } from "../src/assets"
import { WorkspaceAssetSchema, applyContent } from "../src/workspace"
import { guardingGameplay } from "../test/fixtures/gameplay/guarding"
import { ContentSchema } from "../src/content"
import { createEntity, createProject, EntitySchema, ProjectSchema, saveProject } from "../src/project"

/**
 * A small project that uses every data-only feature: an ore that generates, needs an iron pickaxe, drops
 * shards and gives experience; a second ore in the nether; blocks with borrowed sounds; and a creature
 * with vanilla sounds, glowing eyes and veins, a spawn rule and a play-animation rule.
 *
 *   bun packages/mod-core/script/data-gameplay-sample.ts <empty directory>
 *
 * Run this way the golem is also a living creature (`life`: death and attack motions, drops, experience,
 * wider spawning, and a piece of gameplay code that makes it guard the ore), it fights with two abilities
 * that have real timing (`abilities`: a slam up close and a two-thrust burst from afar) and show two effects
 * while they run (`effects`: a mark on the ground where the slam lands, a row of spikes along the burst), and it carries the chain below (`connectionChain`): what is mined is smelted, the ingot becomes
 * a real pickaxe and a real sword, and there is something to eat and something to burn.
 *
 * Open the directory in Studio and build it.
 */

const flat = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })
const stone = { material: "stone", base: "#5E6A78", secondary: "#49535F" } as const
const crystal = { material: "crystal", base: "#49C6E8", secondary: "#2E7FB8" } as const
const feature = (type: string, extra: Record<string, unknown> = {}) => ({ type, face: null, shape: null, color: null, color2: null, x: null, y: null, size: null, count: null, glow: null, mirror: null, ...extra })

export const golemDesign = {
  name: "晶石傀儡",
  texture_size: 128,
  bones: [
    {
      name: "body",
      parent: null,
      pivot: [0, 12, 0],
      rotation: [0, 0, 0],
      paint: stone,
      cubes: [
        { name: "torso", origin: [-5, 10, -3], size: [10, 10, 6], faces: flat("#5E6A78"), features: [feature("veins", { color: "#7FE9FF", count: 2, glow: true }), feature("gem", { face: "north", color: "#49C6E8", y: 0.45, size: 3 })] },
        { name: "hips", origin: [-4, 8, -2], size: [8, 2, 4], faces: flat("#49535F") },
        { name: "back_crystal", origin: [-2, 16, 3], size: [4, 6, 2], faces: flat("#49C6E8"), paint: crystal },
      ],
    },
    {
      name: "head",
      parent: "body",
      pivot: [0, 20, 0],
      rotation: [0, 0, 0],
      cubes: [
        {
          name: "skull",
          origin: [-4, 20, -4],
          size: [8, 7, 7],
          faces: flat("#6B7887"),
          features: [feature("eyes", { shape: "wide", color: "#8FF0FF", x: 0.5, y: 0.4, glow: true }), feature("brows", { shape: "flat", color: "#2A323B", x: 0.5, y: 0.4 }), feature("mouth", { shape: "line", color: "#2A323B", y: 0.78, size: 4 })],
        },
      ],
    },
    ...([
      ["arm_left", 7, 1],
      ["arm_right", -7, -1],
    ] as const).map(([name, x]) => ({
      name,
      parent: "body",
      pivot: [x, 19, 0],
      rotation: [0, 0, 0],
      cubes: [
        { name: "upper", origin: [x - 2, 12, -2], size: [4, 8, 4], faces: flat("#5E6A78") },
        { name: "fist", origin: [x - 2, 8, -2], size: [4, 4, 4], faces: flat("#49C6E8"), paint: crystal },
      ],
    })),
    ...([
      ["leg_left", 3],
      ["leg_right", -3],
    ] as const).map(([name, x]) => ({
      name,
      parent: "body",
      pivot: [x, 8, 0],
      rotation: [0, 0, 0],
      cubes: [{ name: "leg", origin: [x - 2, 0, -2], size: [4, 8, 4], faces: flat("#49535F") }],
    })),
  ],
  animations: [
    { name: "idle", length: 3, loop: true, channels: [{ bone: "head", keyframes: [{ time: 0, rotation: [0, -4, 0] }, { time: 1.5, rotation: [2, 4, 0] }, { time: 3, rotation: [0, -4, 0] }] }] },
    {
      name: "walk",
      length: 1,
      loop: true,
      channels: (["leg_left", "leg_right", "arm_right", "arm_left"] as const).map((bone, index) => ({
        bone,
        keyframes: [{ time: 0, rotation: [index % 2 ? -24 : 24, 0, 0] }, { time: 0.5, rotation: [index % 2 ? 24 : -24, 0, 0] }, { time: 1, rotation: [index % 2 ? -24 : 24, 0, 0] }],
      })),
    },
    { name: "hurt", length: 0.4, loop: false, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.12, rotation: [-10, 0, 4] }, { time: 0.4, rotation: [0, 0, 0] }] }] },
    // Played by the rule below when the golem is hit.
    { name: "roar", length: 0.8, loop: false, channels: [{ bone: "arm_left", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.3, rotation: [-150, 0, -20] }, { time: 0.8, rotation: [0, 0, 0] }] }, { bone: "arm_right", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.3, rotation: [-150, 0, 20] }, { time: 0.8, rotation: [0, 0, 0] }] }] },
    // Nothing plays this one: the build's reconciliation is expected to say so.
    { name: "wave", length: 1, loop: false, channels: [{ bone: "arm_left", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [-120, 0, 0] }, { time: 1, rotation: [0, 0, 0] }] }] },
  ],
}

/**
 * The golem as a living creature (`life` below): its model also dies and strikes with motions of its own.
 * The death is longer than vanilla's second, so the build has to hold the body until it has played.
 */
export const livingGolemDesign = {
  ...golemDesign,
  animations: [
    ...golemDesign.animations,
    {
      name: "death",
      length: 1.6,
      loop: false,
      channels: [
        { bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [-14, 0, 6] }, { time: 1.2, rotation: [78, 0, 10] }, { time: 1.6, rotation: [86, 0, 10] }] },
        { bone: "head", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [-24, 0, 0] }, { time: 1.2, rotation: [18, 0, 0] }, { time: 1.6, rotation: [18, 0, 0] }] },
        { bone: "arm_left", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [-60, 0, -30] }, { time: 1.2, rotation: [10, 0, -70] }, { time: 1.6, rotation: [10, 0, -70] }] },
        { bone: "arm_right", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [-60, 0, 30] }, { time: 1.2, rotation: [10, 0, 70] }, { time: 1.6, rotation: [10, 0, 70] }] },
      ],
    },
    {
      name: "attack",
      length: 0.5,
      loop: false,
      channels: [
        { bone: "arm_right", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.1, rotation: [-130, 0, 10] }, { time: 0.22, rotation: [-30, 0, 0] }, { time: 0.5, rotation: [0, 0, 0] }] },
        { bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.1, rotation: [-8, 12, 0] }, { time: 0.22, rotation: [14, -10, 0] }, { time: 0.5, rotation: [0, 0, 0] }] },
      ],
    },
  ],
}

/**
 * The golem that fights with abilities (`abilities` below): two more motions, one for each. `slam` raises
 * both arms and brings them down in front; `burst` leans back, then thrusts forward twice.
 */
export const fightingGolemDesign = {
  ...livingGolemDesign,
  animations: [
    ...livingGolemDesign.animations,
    {
      name: "slam",
      length: 1.2,
      loop: false,
      channels: [
        ...(["arm_left", "arm_right"] as const).map((bone, index) => ({ bone, keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [-172, 0, index ? 12 : -12] }, { time: 0.7, rotation: [-62, 0, 0] }, { time: 0.85, rotation: [-58, 0, 0] }, { time: 1.2, rotation: [0, 0, 0] }] })),
        { bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [-14, 0, 0] }, { time: 0.7, rotation: [26, 0, 0] }, { time: 0.85, rotation: [24, 0, 0] }, { time: 1.2, rotation: [0, 0, 0] }] },
        { bone: "head", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [-12, 0, 0] }, { time: 0.7, rotation: [-20, 0, 0] }, { time: 1.2, rotation: [0, 0, 0] }] },
      ],
    },
    {
      name: "burst",
      length: 1.6,
      loop: false,
      channels: [
        { bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.8, rotation: [-18, 0, 0] }, { time: 1, rotation: [22, 0, 0] }, { time: 1.15, rotation: [4, 0, 0] }, { time: 1.3, rotation: [24, 0, 0] }, { time: 1.6, rotation: [0, 0, 0] }] },
        { bone: "head", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.8, rotation: [-22, 0, 0] }, { time: 1, rotation: [-14, 0, 0] }, { time: 1.3, rotation: [-16, 0, 0] }, { time: 1.6, rotation: [0, 0, 0] }] },
        ...(["arm_left", "arm_right"] as const).map((bone, index) => ({ bone, keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.8, rotation: [30, 0, index ? 55 : -55] }, { time: 1, rotation: [-40, 0, index ? 30 : -30] }, { time: 1.3, rotation: [-44, 0, index ? 30 : -30] }, { time: 1.6, rotation: [0, 0, 0] }] })),
      ],
    },
  ],
}

/**
 * How the golem fights, as data. Up close it slams: half a second of raising its arms while it still turns
 * to you, then everything in front of it within two and a half blocks is hit. From further away it bursts:
 * a long lean back, then two thrusts that each hit along a straight line toward where you stood when it
 * stopped turning; hitting it while it leans back breaks the burst off.
 */
export const golemAbilities = [
  {
    id: "slam",
    name: "重锤",
    clip: "slam",
    windup: 0.5,
    length: 1.2,
    facing: "track",
    hits: [{ type: "area", at: 0.7, shape: { type: "arc", reach: 2.5, angle: 120, low: -0.5, high: 2.5 }, hits: "everyone", damage: 9, knockback: 1.2, effects: [{ effect: "slowness", duration_ticks: 40, amplifier: 0 }] }],
    moves: [],
    start: { min_distance: 0, max_distance: 2.8, line_of_sight: true, cooldown: 2.5, weight: 3 },
    stopped_by_hurt: false,
    events: [
      { type: "sound", at: 0.7, sound: "entity.iron_golem.attack", volume: 1, pitch: 0.7 },
      { type: "particle", at: 0.7, particle: "dust_plume", count: 12, forward: 1.2, up: 0.1, left: 0, spread: 0.6 },
    ],
  },
  {
    id: "burst",
    name: "晶刺喷射",
    clip: "burst",
    windup: 0.8,
    length: 1.6,
    facing: "track",
    hits: [
      { type: "area", at: 1, shape: { type: "line", up: 1.2, length: 9, radius: 0.6 }, hits: "everyone", damage: 4, knockback: 0.4, effects: [] },
      { type: "area", at: 1.3, shape: { type: "line", up: 1.2, length: 9, radius: 0.6 }, hits: "everyone", damage: 4, knockback: 0.4, effects: [{ effect: "weakness", duration_ticks: 100, amplifier: 0 }] },
    ],
    moves: [],
    start: { min_distance: 4, max_distance: 10, line_of_sight: true, cooldown: 6, weight: 2 },
    stopped_by_hurt: true,
    events: [
      { type: "sound", at: 0, sound: "block.amethyst_block.chime", volume: 1.5, pitch: 0.6 },
      { type: "sound", at: 1, sound: "block.glass.break", volume: 1, pitch: 1.2 },
      { type: "particle", at: 1, particle: "end_rod", count: 16, forward: 2.5, up: 1.2, left: 0, spread: 0.8 },
      { type: "particle", at: 1.3, particle: "end_rod", count: 16, forward: 2.5, up: 1.2, left: 0, spread: 0.8 },
    ],
  },
] as const

const tint = (side: string, top: string, under: string) => ({ north: side, east: side, south: side, west: side, up: top, down: under })

/**
 * Two effects the golem's abilities show (`effects` option): things that appear for a moment and are gone.
 * `mark` is a flat frame on the ground the size of where the slam lands: it opens while the golem raises its
 * arms, turns with it, and closes just after the blow. `spike` is a small shard that pushes up out of the
 * ground and sinks back; the burst sets a row of them along its line at each thrust.
 */
export const golemEffects = {
  mark: {
    title: "落点标记",
    document: {
      kind: "effect",
      name: "ground_mark",
      texture_size: 64,
      bones: [
        {
          name: "frame",
          parent: null,
          pivot: [0, 0, 0],
          rotation: [0, 0, 0],
          cubes: [
            { name: "edge_front", origin: [-20, 0, -20], size: [40, 1, 2], faces: tint("#8FE3FF", "#C9F4FF", "#49C6E8"), surface_details: [] },
            { name: "edge_back", origin: [-20, 0, 18], size: [40, 1, 2], faces: tint("#8FE3FF", "#C9F4FF", "#49C6E8"), surface_details: [] },
            { name: "edge_left", origin: [18, 0, -18], size: [2, 1, 36], faces: tint("#8FE3FF", "#C9F4FF", "#49C6E8"), surface_details: [] },
            { name: "edge_right", origin: [-20, 0, -18], size: [2, 1, 36], faces: tint("#8FE3FF", "#C9F4FF", "#49C6E8"), surface_details: [] },
          ],
        },
        { name: "core", parent: "frame", pivot: [0, 0, 0], rotation: [0, 45, 0], cubes: [{ name: "plate", origin: [-4, 0, -4], size: [8, 1, 8], faces: tint("#49C6E8", "#8FE3FF", "#2E8FB0"), surface_details: [] }] },
      ],
      animations: [
        {
          name: "open",
          length: 0.8,
          loop: false,
          channels: [
            { bone: "frame", keyframes: [], scale: [{ time: 0, scale: [0.12, 1, 0.12] }, { time: 0.3, scale: [1, 1, 1], interpolation: "smooth" }, { time: 0.62, scale: [1, 1, 1] }, { time: 0.8, scale: [0.05, 1, 0.05] }] },
            { bone: "core", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.6, rotation: [0, 180, 0] }, { time: 0.8, rotation: [0, 200, 0] }] },
          ],
        },
      ],
      play: { clip: "open", lifetime: 0.8, follow: true, facing: "owner", on_ground: true, ends_with_owner: true, bright: true, opacity: 0.65 },
    },
  },
  spike: {
    title: "地面晶刺",
    document: {
      kind: "effect",
      name: "ground_spike",
      texture_size: 64,
      bones: [
        { name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ name: "foot", origin: [-3, 0, -3], size: [6, 5, 6], faces: tint("#2E8FB0", "#49C6E8", "#1F6F8C"), surface_details: [] }] },
        {
          name: "shard",
          parent: "root",
          pivot: [0, 5, 0],
          rotation: [-9, 0, 6],
          cubes: [
            { name: "shaft", origin: [-2, 5, -2], size: [4, 7, 4], faces: tint("#49C6E8", "#8FE3FF", "#2E8FB0"), surface_details: [] },
            { name: "tip", origin: [-1, 12, -1], size: [2, 5, 2], faces: tint("#8FE3FF", "#E6FBFF", "#49C6E8"), surface_details: [] },
          ],
        },
      ],
      animations: [
        {
          name: "rise",
          length: 0.5,
          loop: false,
          channels: [
            { bone: "root", keyframes: [], scale: [{ time: 0, scale: [0.4, 0.05, 0.4] }, { time: 0.1, scale: [1, 1.18, 1] }, { time: 0.18, scale: [1, 1, 1] }, { time: 0.34, scale: [1, 1, 1] }, { time: 0.5, scale: [0.5, 0.04, 0.5] }] },
            { bone: "shard", keyframes: [{ time: 0, rotation: [16, 0, -10] }, { time: 0.14, rotation: [-3, 0, 2] }, { time: 0.22, rotation: [0, 0, 0] }, { time: 0.5, rotation: [0, 0, 0] }] },
          ],
        },
      ],
      play: { clip: "rise", lifetime: 0.5, follow: false, facing: "owner", on_ground: true, ends_with_owner: false, bright: false, opacity: 1 },
    },
  },
} as const

/** The golem's two abilities with those effects in them: `ids` are the asset ids the two effects were saved under. */
export const golemAbilitiesWithEffects = (ids: { mark: string; spike: string }) => [
  // The mark lies on where the slam lands from the moment the arms start up, 0.6 seconds before the blow.
  { ...golemAbilities[0], events: [...golemAbilities[0].events, { type: "effect", at: 0.1, effect: ids.mark, where: "hit", hit: 0, forward: 0, up: 0, left: 0, count: 1, layout: "ring", spread: 0 }] },
  // Six spikes in a row ahead of it at each thrust, from a block and a half to nine blocks out: the length of the line that hits.
  { ...golemAbilities[1], events: [...golemAbilities[1].events, ...[1, 1.3].map((at) => ({ type: "effect", at, effect: ids.spike, where: "self", hit: null, forward: 1.5, up: 0, left: 0, count: 6, layout: "line", spread: 7.5 }))] },
]

/**
 * What the golem gains as a living creature, all of it data: shards and now and then a diamond when it
 * falls, experience, and whole groups of biomes to turn up in besides the two it lists.
 */
export const golemLife = {
  loot: [
    { item: "azure_shard", min: 1, max: 3, chance: 1, player_only: false },
    { item: "minecraft:diamond", min: 1, max: 1, chance: 0.1, player_only: true },
  ],
  experience: 8,
  spawn: { biomes: ["minecraft:dripstone_caves", "minecraft:plains"], tags: ["is_mountain", "is_forest"], light: "dark", weight: 20, min: 1, max: 2 },
} as const

/**
 * An ordinary chain on top of the sample's ore, all of it data: the ore's shard is smelted (or blasted) into an
 * ingot, ingots and sticks make a pickaxe and a sword that are real tools, nine ingots pack into a block and
 * back, a shard and sugar make a candy to eat, and the nether rock bakes into a coal that burns.
 */
export function connectionChain(mod: string) {
  const own = (identifier: string) => `${mod}:${identifier}`
  const slots = (...filled: (string | null)[]) => [...filled, ...Array.from({ length: 9 - filled.length }, () => null)]
  const tool = { durability: 320, mining_level: "iron", mining_speed: 6.5, enchantability: 16, repair: own("azure_ingot") } as const
  return {
    items: [
      { id: randomUUID(), identifier: "azure_ingot", name: "蓝晶锭", name_en: "Azure Ingot", max_stack: 64, color: "#3FA9D6" },
      { id: randomUUID(), identifier: "azure_pickaxe", name: "蓝晶镐", name_en: "Azure Pickaxe", max_stack: 1, color: "#3FA9D6", tool: { ...tool, kind: "pickaxe", attack_damage: 4, attack_speed: null } },
      { id: randomUUID(), identifier: "azure_sword", name: "蓝晶剑", name_en: "Azure Sword", max_stack: 1, color: "#3FA9D6", tool: { ...tool, kind: "sword", attack_damage: 6.5, attack_speed: 1.6 } },
      { id: randomUUID(), identifier: "azure_candy", name: "蓝晶糖", name_en: "Azure Candy", max_stack: 16, color: "#8FE3FF", food: { hunger: 2, saturation: 0.3, always_edible: true, snack: true } },
      { id: randomUUID(), identifier: "ember_coal", name: "余烬炭", name_en: "Ember Coal", max_stack: 64, color: "#5A2A1E", fuel: { burn_ticks: 2400 } },
    ],
    blocks: [{ id: randomUUID(), identifier: "azure_ingot_block", name: "蓝晶锭块", name_en: "Block of Azure", hardness: 5, luminance: 0, tool: "pickaxe", drop: "self", color: "#3FA9D6", tool_tier: "stone", sound: "metal" }],
    recipes: [
      { id: randomUUID(), name: "烧蓝晶锭", type: "smelting", pattern: slots(own("azure_shard")), result: own("azure_ingot"), count: 1, experience: 0.7, cooking_time: 200 },
      { id: randomUUID(), name: "高炉烧蓝晶锭", type: "blasting", pattern: slots(own("azure_shard")), result: own("azure_ingot"), count: 1, experience: 0.7, cooking_time: 100 },
      { id: randomUUID(), name: "蓝晶镐", type: "shaped", pattern: [own("azure_ingot"), own("azure_ingot"), own("azure_ingot"), null, "minecraft:stick", null, null, "minecraft:stick", null], result: own("azure_pickaxe"), count: 1 },
      { id: randomUUID(), name: "蓝晶剑", type: "shaped", pattern: [null, own("azure_ingot"), null, null, own("azure_ingot"), null, null, "#c:rods/wooden", null], result: own("azure_sword"), count: 1 },
      { id: randomUUID(), name: "蓝晶锭块", type: "shaped", pattern: Array.from({ length: 9 }, () => own("azure_ingot")), result: own("azure_ingot_block"), count: 1 },
      { id: randomUUID(), name: "拆蓝晶锭块", type: "shapeless", pattern: slots(own("azure_ingot_block")), result: own("azure_ingot"), count: 9 },
      { id: randomUUID(), name: "蓝晶糖", type: "shapeless", pattern: slots(own("azure_shard"), "minecraft:sugar"), result: own("azure_candy"), count: 2 },
      { id: randomUUID(), name: "烤余烬炭", type: "smelting", pattern: slots(own("ember_rock")), result: own("ember_coal"), count: 1, experience: 0.1, cooking_time: 200 },
    ],
  }
}

/**
 * K1: a long, low creature: a body one block wide and four and a half long from nose to tail. The one box the
 * game gives a creature is square, so without boxes of its own it would stand in a square five and a half blocks
 * wide. Its tail swings when it moves, which no box follows: boxes turn with the body only.
 */
const hide = { material: "skin", base: "#7FB6C9", secondary: "#5C93A8" } as const
export const longCreatureDesign = {
  name: "长脊兽",
  texture_size: 128,
  bones: [
    {
      name: "body",
      parent: null,
      pivot: [0, 9, 0],
      rotation: [0, 0, 0],
      paint: hide,
      cubes: [
        { name: "trunk", origin: [-8, 2, -14], size: [16, 14, 28], faces: flat("#7FB6C9") },
        { name: "fin_left", origin: [8, 3, -8], size: [8, 2, 8], faces: flat("#5C93A8") },
        { name: "fin_right", origin: [-16, 3, -8], size: [8, 2, 8], faces: flat("#5C93A8") },
      ],
    },
    {
      name: "head",
      parent: "body",
      pivot: [0, 9, -14],
      rotation: [0, 0, 0],
      cubes: [{ name: "skull", origin: [-7, 3, -28], size: [14, 12, 14], faces: flat("#8CC3D6"), features: [feature("eyes", { shape: "dot", color: "#16232B", x: 0.5, y: 0.4 })] }],
    },
    { name: "tail", parent: "body", pivot: [0, 9, 14], rotation: [0, 0, 0], cubes: [{ name: "tail_root", origin: [-5, 5, 14], size: [10, 8, 12], faces: flat("#73A9BC") }] },
    {
      name: "tail_end",
      parent: "tail",
      pivot: [0, 9, 26],
      rotation: [0, 0, 0],
      cubes: [
        { name: "tail_tip", origin: [-3, 6, 26], size: [6, 5, 12], faces: flat("#6A9FB2") },
        { name: "fluke", origin: [-8, 7, 38], size: [16, 2, 6], faces: flat("#5C93A8") },
      ],
    },
  ],
  animations: [
    { name: "idle", length: 3, loop: true, channels: [{ bone: "head", keyframes: [{ time: 0, rotation: [0, -5, 0] }, { time: 1.5, rotation: [0, 5, 0] }, { time: 3, rotation: [0, -5, 0] }] }, { bone: "tail", keyframes: [{ time: 0, rotation: [0, 4, 0] }, { time: 1.5, rotation: [0, -4, 0] }, { time: 3, rotation: [0, 4, 0] }] }] },
    {
      name: "walk",
      length: 1.2,
      loop: true,
      channels: [
        { bone: "tail", keyframes: [{ time: 0, rotation: [0, 16, 0] }, { time: 0.6, rotation: [0, -16, 0] }, { time: 1.2, rotation: [0, 16, 0] }] },
        { bone: "tail_end", keyframes: [{ time: 0, rotation: [0, -10, 0] }, { time: 0.3, rotation: [0, 14, 0] }, { time: 0.9, rotation: [0, -14, 0] }, { time: 1.2, rotation: [0, -10, 0] }] },
        { bone: "head", keyframes: [{ time: 0, rotation: [0, -4, 0] }, { time: 0.6, rotation: [0, 4, 0] }, { time: 1.2, rotation: [0, -4, 0] }] },
      ],
    },
    { name: "hurt", length: 0.4, loop: false, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.12, rotation: [-6, 0, 5] }, { time: 0.4, rotation: [0, 0, 0] }] }] },
  ],
}

/** K1: its collision boxes: the body where its trunk is, and one box each for what reaches out in front of and behind it. */
export const longCreatureHitbox = {
  core: { width: 1.1, height: 1 },
  parts: [
    { name: "头", forward: 1.15, up: 0.15, left: 0, width: 1.2, height: 0.85, bone: "head" },
    { name: "后身", forward: -1.05, up: 0.25, left: 0, width: 1, height: 0.65, bone: "tail" },
    { name: "尾", forward: -1.95, up: 0.3, left: 0, width: 0.8, height: 0.5, bone: "tail_end" },
    { name: "尾鳍", forward: -2.55, up: 0.35, left: 0, width: 1, height: 0.35, bone: "tail_end" },
  ],
}

export async function createDataGameplaySample(directory: string, options: { chain?: boolean; life?: boolean; abilities?: boolean; effects?: boolean; /** K1: a second creature, long and low, with collision boxes of its own. */ hitbox?: boolean; longDesign?: typeof longCreatureDesign } = {}) {
  // `effects` goes with `abilities`: the two effects are saved as assets and the abilities show them.
  const shown = options.life && options.abilities && options.effects ? { mark: randomUUID(), spike: randomUUID() } : null
  // `abilities` goes with `life`: the living golem also fights with the two abilities above, on the model that has their motions.
  const design = options.life ? (options.abilities ? fightingGolemDesign : livingGolemDesign) : golemDesign
  const created = await createProject({ directory, name: "蓝晶矿洞", description: "地下有蓝晶矿，晶石傀儡守着它。", mod_id: "azure_sample" })
  const golem = EntitySchema.parse({
    ...createEntity({ name: "晶石傀儡", description: "守着蓝晶矿的石头傀儡。", health: 40, speed: 0.22, attack_damage: 6, behavior: "hostile" }),
    runtime: { spawn: options.life ? golemLife.spawn : { biomes: ["minecraft:dripstone_caves", "minecraft:plains"], weight: 20, min: 1, max: 2 }, explosion: null, movement: "direct", armor: 6, charging_armor: 6, texture_asset_id: null },
    sounds: { ambient: "block.amethyst_block.chime", hurt: "entity.iron_golem.hurt", death: "entity.iron_golem.death", step: "entity.iron_golem.step", pitch: 0.8, volume: 1 },
    name_en: "Crystal Golem",
    ...(options.life ? { loot: golemLife.loot, experience: golemLife.experience } : {}),
    ...(options.life && options.abilities ? { abilities: shown ? golemAbilitiesWithEffects(shown) : golemAbilities } : {}),
  })
  const long = options.hitbox ? EntitySchema.parse({ ...createEntity({ name: "长脊兽", description: "身子很长的温顺动物。", health: 30, speed: 0.2, attack_damage: 0, behavior: "passive" }), runtime: { spawn: { biomes: ["minecraft:plains", "minecraft:beach"], weight: 6, min: 1, max: 2 }, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null }, name_en: "Longback", hitbox: longCreatureHitbox }) : null
  const longDesign = options.longDesign ?? longCreatureDesign
  const withGolem = await saveProject(directory, { ...created, entities: [golem, ...(long ? [long] : [])] }, created.revision)
  const golemModelled = await putModelAsset(directory, { entity_id: golem.id, data: { design }, origin: "example", expectedRevision: withGolem.revision })
  const modelled = long ? await putModelAsset(directory, { entity_id: long.id, data: { design: longDesign }, origin: "example", expectedRevision: golemModelled.project.revision }) : golemModelled
  const mod = modelled.project.mod_id
  const content = {
    items: [{ id: randomUUID(), identifier: "azure_shard", name: "蓝晶碎片", name_en: "Azure Shard", max_stack: 64, color: "#49C6E8" }],
    blocks: [
      {
        id: randomUUID(),
        identifier: "azure_ore",
        name: "蓝晶矿石",
        name_en: "Azure Ore",
        hardness: 3,
        luminance: 3,
        tool: "pickaxe",
        drop: "item",
        color: "#5E7F96",
        drop_item: { item: "azure_shard", min: 1, max: 2, fortune: true },
        tool_tier: "iron",
        experience: { min: 2, max: 5 },
        sound: "amethyst_block",
        generation: { dimension: "overworld", min_y: -16, max_y: 48, spread: "middle", vein_size: 6, veins_per_chunk: 8, replaces: ["stone", "deepslate"], biomes: null },
      },
      { id: randomUUID(), identifier: "azure_block", name: "蓝晶块", name_en: "Azure Block", hardness: 5, luminance: 9, tool: "pickaxe", drop: "self", color: "#49C6E8", sound: "amethyst_block" },
      {
        id: randomUUID(),
        identifier: "ember_rock",
        name: "余烬石",
        name_en: "Ember Rock",
        hardness: 1.5,
        luminance: 6,
        tool: "pickaxe",
        drop: "self",
        color: "#B4472E",
        tool_tier: "stone",
        sound: "nether_ore",
        generation: { dimension: "nether", min_y: 10, max_y: 117, spread: "even", vein_size: 10, veins_per_chunk: 6, replaces: ["netherrack"], biomes: null },
      },
    ],
    recipes: [{ id: randomUUID(), name: "蓝晶块", pattern: Array.from({ length: 9 }, () => `${mod}:azure_shard`), result: `${mod}:azure_block`, count: 1 }],
    logic: [{ id: randomUUID(), entity_id: golem.id, trigger: "hurt", action: "play_animation", animation: "roar", enabled: true }],
  }
  const chain = options.chain ? connectionChain(mod) : { items: [], blocks: [], recipes: [] }
  const filled = applyContent(modelled.project, ContentSchema.parse({ ...content, items: [...content.items, ...chain.items], blocks: [...content.blocks, ...chain.blocks], recipes: [...content.recipes, ...chain.recipes] }))
  if (!options.life) return saveProject(directory, filled, modelled.project.revision)
  // As Studio itself saves a creature: its model and its rules are workspace assets, so gameplay code can name it and the playable standard can read it.
  const ore = content.blocks[0]!
  const now = new Date().toISOString()
  const saved = (id: string, module: string, title: string, dependencies: string[], document: unknown) => WorkspaceAssetSchema.parse({ id, module, title, revision: 1, created_at: now, updated_at: now, prompt: "晶石傀儡守着蓝晶矿石", dependencies, document, provenance: { model: "example", request_id: null }, status: "ready" })
  const { id: _id, model_asset_id: _model, ...rules } = golem
  // The guarding gameplay of the first mod a person played, corrected: one goal added beside the golem's own.
  const guarding = guardingGameplay({ mod_id: mod, creature: golem.id, creature_name: golem.name, ore: ore.identifier, ore_name: ore.name, uses: [golem.id, ore.id] })
  return saveProject(
    directory,
    ProjectSchema.parse({
      ...filled,
      workspace: {
        assets: [
          ...filled.workspace.assets,
          saved(golem.id, "model", golem.name, [], { kind: "model", ...design }),
          ...(shown ? [saved(shown.mark, "effect", golemEffects.mark.title, [], golemEffects.mark.document), saved(shown.spike, "effect", golemEffects.spike.title, [], golemEffects.spike.document)] : []),
          saved(randomUUID(), "entity", golem.name, [golem.id, ...(shown ? [shown.mark, shown.spike] : [])], { kind: "entity", ...rules, model_asset_id: golem.id }),
          saved(randomUUID(), "gameplay", guarding.name, guarding.uses, guarding),
          ...(long ? [saved(long.id, "model", long.name, [], { kind: "model", ...longDesign }), saved(randomUUID(), "entity", long.name, [long.id], (({ id: _long, model_asset_id: _worn, ...longRules }) => ({ kind: "entity", ...longRules, model_asset_id: long.id }))(long))] : []),
        ],
      },
    }),
    modelled.project.revision,
  )
}

if (import.meta.main) {
  const directory = process.argv[2]
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/data-gameplay-sample.ts <empty directory>")
  // K1: `--hitbox` adds the long creature with collision boxes of its own.
  const project = await createDataGameplaySample(path.resolve(directory), { chain: true, life: true, abilities: true, effects: true, hitbox: process.argv.includes("--hitbox") })
  console.log(`Sample project "${project.name}" (${project.mod_id}) created in ${path.resolve(directory)}. Open that folder in Studio and build it.`)
}
