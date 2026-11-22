import type { Block } from "../content"
import { ORE_BASES, ORE_DIMENSIONS } from "../data-words"

/** The two worldgen documents of one generating block, in the shape vanilla 1.21.1 writes its own ores. */
export function oreFeatures(block: Pick<Block, "identifier"> & { generation: NonNullable<Block["generation"]> }, modId: string) {
  const generation = block.generation
  return {
    configured: {
      type: "minecraft:ore",
      config: {
        discard_chance_on_air_exposure: 0,
        size: generation.vein_size,
        targets: generation.replaces.map((base) => ({ state: { Name: `${modId}:${block.identifier}` }, target: ORE_BASES[base].target })),
      },
    },
    placed: {
      feature: `${modId}:ore_${block.identifier}`,
      placement: [
        { type: "minecraft:count", count: generation.veins_per_chunk },
        { type: "minecraft:in_square" },
        {
          type: "minecraft:height_range",
          height: { type: generation.spread === "middle" ? "minecraft:trapezoid" : "minecraft:uniform", max_inclusive: { absolute: generation.max_y }, min_inclusive: { absolute: generation.min_y } },
        },
        { type: "minecraft:biome" },
      ],
    },
  }
}

/**
 * Everything a generating block adds to the build: its two datapack documents, and one fixed class that
 * hands every such feature to Fabric's biome modification API. The class is the same for every mod apart
 * from its list of rows. Nothing at all for a project where no block generates.
 */
export function compileWorldgen(blocks: readonly Block[], modId: string, packageName: string): Record<string, string> {
  const ores = blocks.flatMap((block) => (block.generation ? [{ identifier: block.identifier, generation: block.generation }] : []))
  if (!ores.length) return {}
  const data = `src/main/resources/data/${modId}/worldgen`
  return {
    ...Object.fromEntries(
      ores.flatMap((ore) => {
        const features = oreFeatures(ore, modId)
        return [
          [`${data}/configured_feature/ore_${ore.identifier}.json`, JSON.stringify(features.configured, null, 2)],
          [`${data}/placed_feature/ore_${ore.identifier}.json`, JSON.stringify(features.placed, null, 2)],
        ]
      }),
    ),
    [`src/main/java/${packageName.replaceAll(".", "/")}/StudioWorldgen.java`]: `package ${packageName};

import java.util.function.Predicate;
import net.fabricmc.fabric.api.biome.v1.BiomeModifications;
import net.fabricmc.fabric.api.biome.v1.BiomeSelectionContext;
import net.fabricmc.fabric.api.biome.v1.BiomeSelectors;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.tags.TagKey;
import net.minecraft.world.level.levelgen.GenerationStep;

/** Hands this mod's ore features (data/${modId}/worldgen) to the biomes they generate in. One row per ore. */
public final class StudioWorldgen {
    private record Ore(String feature, String dimension, String biomeTag) {}

    private static final Ore[] ORES = {
${ores.map((ore) => `        new Ore("ore_${ore.identifier}", "${ore.generation.dimension}", ${ore.generation.biomes ? `"${ore.generation.biomes}"` : "null"}),`).join("\n")}
    };

    public static void register() {
        for (Ore ore : ORES) {
            Predicate<BiomeSelectionContext> where = switch (ore.dimension()) {
                case "nether" -> BiomeSelectors.${ORE_DIMENSIONS.nether.selector}();
                case "end" -> BiomeSelectors.${ORE_DIMENSIONS.end.selector}();
                default -> BiomeSelectors.${ORE_DIMENSIONS.overworld.selector}();
            };
            if (ore.biomeTag() != null)
                where = where.and(BiomeSelectors.tag(TagKey.create(Registries.BIOME, ResourceLocation.fromNamespaceAndPath("minecraft", ore.biomeTag()))));
            BiomeModifications.addFeature(where, GenerationStep.Decoration.UNDERGROUND_ORES,
                ResourceKey.create(Registries.PLACED_FEATURE, ResourceLocation.fromNamespaceAndPath("${modId}", ore.feature())));
        }
    }
}
`,
  }
}
