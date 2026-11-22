import { randomUUID } from "node:crypto"
import path from "node:path"
import { putModelAsset } from "../src/assets"
import { ContentSchema } from "../src/content"
import { BLOCK_SHAPE_EXAMPLE } from "../src/content-words"
import { encodePng } from "../src/png"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import type { SoundDocument } from "../src/sound"
import type { TargetId } from "../src/target/ids"
import { WorkspaceAssetSchema, applyContent } from "../src/workspace"
import { oggDataUrl, oggVorbis } from "../test/ogg-sample"
import { livingGolemDesign } from "./data-gameplay-sample"

/**
 * The blocks, items and data beyond the platform layer's slice (E 组, 平台层-移植清单.md), in one project with a Chinese
 * name, for Forge 1.20.1 and NeoForge 1.21.1 (and Fabric 1.21.1, the same project by Fabric's own text):
 * - blocks: an ore that drops an item with Fortune, gives experience and generates in the overworld; a second ore only in
 *   mountain biomes (the loader's `and` of two biome tags); a stool with a shape (turns to face the player, collides as
 *   its boxes, drawn with holes) that also gives experience and bounces; a bouncing block; a jump pad; a slow, sticky,
 *   burning block (movement and fuel); a lucky cache (opened by a player's right click);
 * - items: a plain item that burns; the five tools (sword, pickaxe, axe, shovel, hoe), repaired by a tag, by the
 *   project's own item and by nothing; a stew with an effect that leaves a bowl; a tea that is drunk, always, heals at once
 *   and leaves a glass bottle; a snack eaten fast;
 * - recipes of four kinds; the project's own sound (an Ogg Vorbis file) played by a creature when it is hurt; the
 *   creature looks at a player holding a diamond (a content rule);
 * - a release with a homepage and an issue tracker, so the mod list shows its icon and links.
 *
 *   bun packages/mod-core/script/target-content-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */

export const CONTENT_SOUND_ID = "c0ffee00-0000-4000-8000-0000000000e1"

/** A square picture with the lower right quarter empty (transparent), as a cut-out is. */
const sheet = (side = 32) => {
  const pixels = new Uint8Array(side * side * 4)
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) pixels.set(x >= side / 2 && y >= side / 2 ? [0, 0, 0, 0] : [150 + ((x * 3) % 60), 90 + ((y * 5) % 50), 40, 255], (y * side + x) * 4)
  return `data:image/png;base64,${Buffer.from(encodePng(pixels, side, side)).toString("base64")}`
}

export async function createTargetContentSample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "琥珀工坊", description: "琥珀矿、琥珀工具、会弹的方块和一盒运气。", mod_id: "amber_works", target })
  const keeper = EntitySchema.parse({
    ...createEntity({ name: "琥珀守卫", description: "守着矿洞的石头守卫。", health: 30, speed: 0.22, attack_damage: 4, behavior: "hostile" }),
    name_en: "Amber Keeper",
    sounds: { ambient: null, hurt: { asset: CONTENT_SOUND_ID }, death: "entity.iron_golem.death", step: "entity.iron_golem.step", pitch: 1, volume: 1 },
  })
  const withCreature = await saveProject(directory, { ...created, entities: [keeper] }, created.revision)
  const modelled = await putModelAsset(directory, { entity_id: keeper.id, data: { design: livingGolemDesign }, origin: "example", expectedRevision: withCreature.revision })
  const mod = modelled.project.mod_id
  const ore = { tool: "pickaxe", tool_tier: "iron", drop: "item", drop_item: { item: "amber", min: 1, max: 2, fortune: true }, experience: { min: 2, max: 5 }, sound: "deepslate" } as const
  const content = ContentSchema.parse({
    blocks: [
      { id: randomUUID(), identifier: "amber_ore", name: "琥珀矿石", name_en: "Amber Ore", hardness: 3, luminance: 0, color: "#C8892E", ...ore, generation: { dimension: "overworld", min_y: -16, max_y: 48, spread: "middle", vein_size: 8, veins_per_chunk: 10, replaces: ["stone", "deepslate"], biomes: null } },
      { id: randomUUID(), identifier: "jade_ore", name: "玉石矿", name_en: "Jade Ore", hardness: 3, luminance: 0, color: "#3E9B6A", ...ore, generation: { dimension: "overworld", min_y: 0, max_y: 120, spread: "even", vein_size: 6, veins_per_chunk: 6, replaces: ["stone"], biomes: "is_mountain" } },
      { id: randomUUID(), identifier: "amber_stool", name: "琥珀凳", name_en: "Amber Stool", hardness: 1, luminance: 0, tool: "axe", drop: "item", drop_item: { item: "amber", min: 1, max: 1, fortune: false }, experience: { min: 1, max: 1 }, color: "#B0702A", bounce: 0.5, shape: { ...BLOCK_SHAPE_EXAMPLE, elements: structuredClone(BLOCK_SHAPE_EXAMPLE.elements), sheet: sheet() } },
      { id: randomUUID(), identifier: "spring_moss", name: "弹簧苔", name_en: "Spring Moss", hardness: 0.5, luminance: 0, tool: "shovel", drop: "self", color: "#6DBF4B", bounce: 0.8, sound: "slime" },
      { id: randomUUID(), identifier: "jump_pad", name: "弹射板", name_en: "Jump Pad", hardness: 1, luminance: 7, tool: "pickaxe", drop: "self", color: "#4B8BBF", launch: 4 },
      { id: randomUUID(), identifier: "peat", name: "泥炭", name_en: "Peat", hardness: 0.6, luminance: 0, tool: "shovel", drop: "self", color: "#4A3A2A", fuel: { burn_ticks: 2400 }, movement: { speed: 0.4, jump: 0.5, slip: 0.6 }, sound: "mud" },
      { id: randomUUID(), identifier: "lucky_crate", name: "幸运箱", name_en: "Lucky Crate", hardness: 1, luminance: 3, tool: "axe", drop: "self", color: "#E0B040", lucky: { max_stack: 16, outcomes: [{ weight: 60, items: [{ item: "minecraft:diamond", min: 1, max: 2 }, { item: "minecraft:bread", min: 2, max: 4 }], effects: [] }, { weight: 40, items: [], effects: [{ effect: "poison", duration_ticks: 100, amplifier: 0 }, { effect: "slowness", duration_ticks: 60, amplifier: 1 }] }] } },
    ],
    items: [
      { id: randomUUID(), identifier: "amber", name: "琥珀", name_en: "Amber", max_stack: 64, color: "#E8A33A", fuel: { burn_ticks: 800 } },
      { id: randomUUID(), identifier: "amber_sword", name: "琥珀剑", name_en: "Amber Sword", max_stack: 1, color: "#E8A33A", tool: { kind: "sword", durability: 400, mining_level: "iron", mining_speed: 6, attack_damage: 7, attack_speed: null, enchantability: 15, repair: "#minecraft:planks" } },
      { id: randomUUID(), identifier: "amber_pickaxe", name: "琥珀镐", name_en: "Amber Pickaxe", max_stack: 1, color: "#E8A33A", tool: { kind: "pickaxe", durability: 400, mining_level: "iron", mining_speed: 6.5, attack_damage: 4, attack_speed: null, enchantability: 15, repair: `${mod}:amber` } },
      { id: randomUUID(), identifier: "amber_axe", name: "琥珀斧", name_en: "Amber Axe", max_stack: 1, color: "#E8A33A", tool: { kind: "axe", durability: 400, mining_level: "stone", mining_speed: 6, attack_damage: 8, attack_speed: 0.9, enchantability: 10, repair: null } },
      { id: randomUUID(), identifier: "amber_shovel", name: "琥珀锹", name_en: "Amber Shovel", max_stack: 1, color: "#E8A33A", tool: { kind: "shovel", durability: 300, mining_level: "diamond", mining_speed: 6, attack_damage: 3.5, attack_speed: null, enchantability: 15, repair: "minecraft:iron_ingot" } },
      { id: randomUUID(), identifier: "amber_hoe", name: "琥珀锄", name_en: "Amber Hoe", max_stack: 1, color: "#E8A33A", tool: { kind: "hoe", durability: 300, mining_level: "wood", mining_speed: 4, attack_damage: 1, attack_speed: null, enchantability: 15, repair: null } },
      { id: randomUUID(), identifier: "berry_stew", name: "浆果炖菜", name_en: "Berry Stew", max_stack: 1, color: "#9B2D4A", food: { hunger: 6, saturation: 0.6, effects: [{ effect: "regeneration", seconds: 5, level: 2, chance: 1 }], leaves: "minecraft:bowl" } },
      { id: randomUUID(), identifier: "honey_tea", name: "蜂蜜茶", name_en: "Honey Tea", max_stack: 16, color: "#E0B040", food: { hunger: 3, saturation: 0.3, always_edible: true, drink: true, effects: [{ effect: "instant_health", seconds: 1, level: 1, chance: 1 }], leaves: "minecraft:glass_bottle" } },
      { id: randomUUID(), identifier: "amber_candy", name: "琥珀糖", name_en: "Amber Candy", max_stack: 64, color: "#F0C060", food: { hunger: 2, saturation: 0.1, snack: true } },
    ],
    recipes: [
      { id: randomUUID(), name: "烧琥珀矿", type: "smelting", pattern: [`${mod}:amber_ore`, null, null, null, null, null, null, null, null], result: `${mod}:amber`, count: 1, experience: 0.7, cooking_time: null },
      { id: randomUUID(), name: "琥珀剑", pattern: [null, `${mod}:amber`, null, null, `${mod}:amber`, null, null, "minecraft:stick", null], result: `${mod}:amber_sword`, count: 1 },
      { id: randomUUID(), name: "琥珀糖", type: "shapeless", pattern: [`${mod}:amber`, "minecraft:sugar", null, null, null, null, null, null, null], result: `${mod}:amber_candy`, count: 4 },
      { id: randomUUID(), name: "切琥珀凳", type: "stonecutting", pattern: [`${mod}:amber`, null, null, null, null, null, null, null, null], result: `${mod}:amber_stool`, count: 1 },
    ],
    logic: [{ id: randomUUID(), entity_id: keeper.id, trigger: "holding_item", action: "look", item: "minecraft:diamond", enabled: true }],
  })
  const withContent = applyContent(modelled.project, content)
  const now = new Date().toISOString()
  const chime: SoundDocument = { kind: "sound", name: "amber_chime", files: [{ data: oggDataUrl(oggVorbis({ samples: 44100 })), duration: 1 }], subtitle: { zh: "琥珀轻响", en: "Amber chimes" }, category: "block", volume: 1, pitch: 1 }
  const sound = WorkspaceAssetSchema.parse({ id: CONTENT_SOUND_ID, module: "sound", title: "琥珀轻响", revision: 1, created_at: now, updated_at: now, prompt: "琥珀轻响", dependencies: [], document: chime, provenance: { model: null, request_id: null }, status: "ready" })
  const assets = [
    sound,
    ...withContent.workspace.assets.map((asset) => (asset.document.kind === "entity" && asset.document.model_asset_id === keeper.id ? { ...asset, dependencies: [...asset.dependencies, CONTENT_SOUND_ID] } : asset)),
  ]
  return saveProject(
    directory,
    { ...withContent, workspace: { assets }, release: { author: "MineMods", license: "MIT", homepage: "https://example.com/amber-works", issues: "https://example.com/amber-works/issues" } },
    modelled.project.revision,
  )
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-content-sample.ts <empty directory> [target]")
  const project = await createTargetContentSample(path.resolve(directory), target as TargetId)
  console.log(`Content project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}
