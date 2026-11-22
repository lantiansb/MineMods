/**
 * An ore's placed feature (`data/<mod>/worldgen/placed_feature/ore_<block>.json`, the same file on every loader) added to
 * the biomes it generates in, for a loader that takes it as data: Forge's and NeoForge's `add_features` biome modifier,
 * at the game's `underground_ores` step, where vanilla's own ores are. Fabric does the same in code (`StudioWorldgen`,
 * `fabric/worldgen.ts`) with `BiomeSelectors.foundInOverworld()` and the like; here the dimension is the game's own tag
 * (`#minecraft:is_overworld`, `is_nether`, `is_end`), and an overworld ore limited to a group of biomes is in both tags
 * at once: the loader's `and` holder set.
 */

export type OreSpread = { readonly modId: string; readonly feature: string; readonly dimension: "overworld" | "nether" | "end"; readonly biomeTag: string | null }

const DIMENSION_TAGS = { overworld: "#minecraft:is_overworld", nether: "#minecraft:is_nether", end: "#minecraft:is_end" } as const

export function oreModifierFiles(loader: "forge" | "neoforge", folder: string, input: OreSpread): Record<string, string> {
  const dimension = DIMENSION_TAGS[input.dimension]
  const biomes = input.biomeTag ? { type: `${loader}:and`, values: [dimension, `#minecraft:${input.biomeTag}`] } : dimension
  return {
    [`src/main/resources/data/${input.modId}/${folder}/${input.feature}.json`]: JSON.stringify({ type: `${loader}:add_features`, biomes, features: `${input.modId}:${input.feature}`, step: "underground_ores" }, null, 2),
  }
}
