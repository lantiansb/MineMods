import { randomUUID } from "node:crypto"
import path from "node:path"
import { putModelAsset } from "../src/assets"
import { ContentSchema } from "../src/content"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { applyContent } from "../src/workspace"
import { livingGolemDesign, longCreatureDesign } from "./data-gameplay-sample"

/**
 * The vertical slice of the platform layer (平台层-移植清单.md): what a Forge 1.20.1 and a NeoForge 1.21.1 build can
 * already make, in one small project with a Chinese name.
 * - A hostile GeckoLib creature with its own model, texture and motions (idle, walk, hurt, death, attack), attributes,
 *   the goals of a hostile creature, armour, drops (one of them a vanilla item, one only when a player kills it),
 *   experience, borrowed vanilla sounds, and a natural spawn by biome and by biome group, in the dark.
 * - A passive creature with the goals of a passive one and a natural spawn on bright grass.
 * - Both with spawn eggs in the spawn-egg tab, names in Chinese and English.
 * - An item, a block that needs a stone pickaxe and drops itself, and a shaped recipe from the item to the block.
 *
 *   bun packages/mod-core/script/target-slice-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
export async function createTargetSliceSample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "赤岩山谷", description: "赤岩傀儡守着山谷，绒角兽在草地上吃草。", mod_id: "red_valley", target })
  const golem = EntitySchema.parse({
    ...createEntity({ name: "赤岩傀儡", description: "山谷里的石头傀儡，见人就打。", health: 40, speed: 0.22, attack_damage: 6, behavior: "hostile" }),
    name_en: "Red Rock Golem",
    runtime: { spawn: { biomes: ["minecraft:plains", "minecraft:savanna"], tags: ["is_mountain"], light: "dark", weight: 20, min: 1, max: 2 }, explosion: null, movement: "direct", armor: 4, charging_armor: 4, texture_asset_id: null },
    sounds: { ambient: "block.amethyst_block.chime", hurt: "entity.iron_golem.hurt", death: "entity.iron_golem.death", step: "entity.iron_golem.step", pitch: 0.8, volume: 1 },
    loot: [
      { item: "red_shard", min: 1, max: 3, chance: 1, player_only: false },
      { item: "minecraft:iron_ingot", min: 1, max: 1, chance: 0.25, player_only: true },
    ],
    experience: 8,
  })
  const grazer = EntitySchema.parse({
    ...createEntity({ name: "绒角兽", description: "温顺的长身动物。", health: 20, speed: 0.2, attack_damage: 0, behavior: "passive" }),
    name_en: "Woolhorn",
    runtime: { spawn: { biomes: [], tags: ["is_forest"], light: "bright", weight: 8, min: 2, max: 3 }, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null },
  })
  const withCreatures = await saveProject(directory, { ...created, entities: [golem, grazer] }, created.revision)
  const golemModelled = await putModelAsset(directory, { entity_id: golem.id, data: { design: livingGolemDesign }, origin: "example", expectedRevision: withCreatures.revision })
  const modelled = await putModelAsset(directory, { entity_id: grazer.id, data: { design: longCreatureDesign }, origin: "example", expectedRevision: golemModelled.project.revision })
  const mod = modelled.project.mod_id
  const content = ContentSchema.parse({
    items: [{ id: randomUUID(), identifier: "red_shard", name: "赤岩碎片", name_en: "Red Shard", max_stack: 64, color: "#B4472E" }],
    blocks: [{ id: randomUUID(), identifier: "red_rock", name: "赤岩", name_en: "Red Rock", hardness: 2, luminance: 4, tool: "pickaxe", drop: "self", color: "#8E3B26", tool_tier: "stone", sound: "stone" }],
    recipes: [{ id: randomUUID(), name: "赤岩", pattern: [`${mod}:red_shard`, `${mod}:red_shard`, null, `${mod}:red_shard`, `${mod}:red_shard`, null, null, null, null], result: `${mod}:red_rock`, count: 1 }],
    logic: [],
  })
  return saveProject(directory, applyContent(modelled.project, content), modelled.project.revision)
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-slice-sample.ts <empty directory> [target]")
  const project = await createTargetSliceSample(path.resolve(directory), target as TargetId)
  console.log(`Slice project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}
