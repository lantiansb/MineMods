import type { Block, Content, Item } from "../content"
import { TOOL_KINDS } from "../content-words"
import { needsTool } from "../data-words"
import { BOUNCE_IMPORTS, bounceOf, bounceSource, launchOf } from "../fabric/block-bounce"
import { isShaped, shapedBlockSource, shapedClass } from "../fabric/block-shape"
import { movementSource } from "../fabric/content-items"
import { compileLuckyCaches } from "../fabric/lucky-cache"
import type { GenTarget } from "./adapter"
import { PLATFORM_CLASS, PLATFORM_PACKAGE, importLines, sourceRoot } from "./facade"

/**
 * The common layer's registry of a project's blocks and items, for a facade target: the same blocks and items the
 * Fabric generator's `StudioContentRegistry` registers (`content.ts`), each through `StudioPlatform`, and held as a
 * `Supplier` (Forge and NeoForge register later than the class is loaded). What a block or an item is besides an
 * ordinary one (E 组) is written the way the Fabric generator writes it, mapped to the target's game version
 * (`VersionAdapter.content`), with the loader's part through the facade:
 * - a block's shape (its own class: `fabric/block-shape.ts`), bounce and launch (`fabric/block-bounce.ts`), experience
 *   (`DropExperienceBlock`, or the loader's own way for a block with a shape: `LoaderAdapter.blockExperience`), movement;
 * - a tool (its material class `StudioToolMaterial`), a food or a drink, a fuel (`StudioPlatform.fuel`);
 * - each into the creative tab Fabric puts it in (`StudioPlatform.addToTab`);
 * - lucky caches (`StudioLuckyCaches`, opened through `StudioPlatform.onUseBlock`).
 * Where a block with a shape is drawn with holes, Forge and NeoForge read from its model (`render_type`), not code.
 */
export function platformContentRegistry(content: Content, modId: string, packageName: string, target: GenTarget, soundTypes: Readonly<Record<string, string>>) {
  const version = target.version.content
  const constant = (identifier: string) => identifier.toUpperCase()
  const bouncing = (block: Block) => (bounceOf(block) > 0 || launchOf(block) > 0) && !isShaped(block)
  const properties = (block: Block) =>
    `BlockBehaviour.Properties.of().strength(${block.hardness}f).lightLevel(state -> ${block.luminance})${needsTool(block) ? ".requiresCorrectToolForDrops()" : ""}${block.sound ? `.sound(SoundType.${soundTypes[block.sound]})` : ""}${movementSource(block.movement)}${isShaped(block) ? ".noOcclusion()" : ""}`
  const made = (block: Block) =>
    isShaped(block)
      ? `new ${shapedClass(block)}(${properties(block)})`
      : block.experience
        ? version.experienceBlock(`UniformInt.of(${block.experience.min}, ${block.experience.max})`, properties(block))
        : `new Block(${properties(block)})`
  const blocks = content.blocks.map(
    (block) =>
      `    public static final Supplier<Block> BLOCK_${constant(block.identifier)} = ${PLATFORM_CLASS}.block("${block.identifier}", () -> ${made(block)}${bouncing(block) ? ` {\n${bounceSource(bounceOf(block), "        ", launchOf(block))}\n    }` : ""});`,
  )
  const blockItems = content.blocks.map(
    (block) =>
      `    public static final Supplier<Item> BLOCK_ITEM_${constant(block.identifier)} = ${PLATFORM_CLASS}.item("${block.identifier}", () -> new BlockItem(BLOCK_${constant(block.identifier)}.get(), new Item.Properties()${block.lucky ? `.stacksTo(${block.lucky.max_stack})` : ""}));`,
  )
  const items = content.items.map((item) => `${version.material(item)}    public static final Supplier<Item> ITEM_${constant(item.identifier)} = ${PLATFORM_CLASS}.item("${item.identifier}", () -> ${version.item(item)});`)
  const registers = content.blocks.length > 0 || content.items.length > 0
  const shaped = content.blocks.filter(isShaped)
  const experienced = content.blocks.some((block) => block.experience && !isShaped(block))
  const imports = [
    `${packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS}`,
    ...(registers ? ["java.util.function.Supplier", "net.minecraft.world.item.CreativeModeTabs", "net.minecraft.world.item.Item"] : []),
    ...(content.blocks.length ? ["net.minecraft.world.level.block.Block", "net.minecraft.world.level.block.state.BlockBehaviour", "net.minecraft.world.item.BlockItem"] : []),
    ...(content.blocks.some((block) => block.sound) ? ["net.minecraft.world.level.block.SoundType"] : []),
    ...(content.blocks.some(bouncing) ? BOUNCE_IMPORTS : []),
    ...shaped.map((block) => `${packageName}.block.${shapedClass(block)}`),
    ...(experienced ? ["net.minecraft.world.level.block.DropExperienceBlock", "net.minecraft.util.valueproviders.UniformInt"] : []),
    ...version.itemImports(content.items),
  ]
  const tab = (name: string, fields: string[]) => fields.map((field) => `        ${PLATFORM_CLASS}.addToTab(CreativeModeTabs.${name}, ${field});`)
  const tools = (tabName: "TOOLS" | "COMBAT") => content.items.filter((item) => item.tool && TOOL_KINDS[item.tool.kind].tab === tabName).map((item) => `ITEM_${constant(item.identifier)}`)
  const fuels = [...content.items.flatMap((item) => (item.fuel ? [`ITEM_${constant(item.identifier)}, ${item.fuel.burn_ticks}`] : [])), ...content.blocks.flatMap((block) => (block.fuel ? [`BLOCK_ITEM_${constant(block.identifier)}, ${block.fuel.burn_ticks}`] : []))]
  const registrations = [
    ...(content.blocks.some((block) => block.lucky) ? ["        StudioLuckyCaches.register();"] : []),
    ...tab("BUILDING_BLOCKS", content.blocks.map((block) => `BLOCK_ITEM_${constant(block.identifier)}`)),
    ...tab("INGREDIENTS", content.items.filter((item: Item) => !item.tool && !item.food && !item.armor).map((item) => `ITEM_${constant(item.identifier)}`)),
    ...tab("TOOLS_AND_UTILITIES", tools("TOOLS")),
    ...tab("COMBAT", [...tools("COMBAT"), ...content.items.filter((item) => item.armor).map((item) => `ITEM_${constant(item.identifier)}`)]),
    ...tab("FOOD_AND_DRINKS", content.items.filter((item) => item.food).map((item) => `ITEM_${constant(item.identifier)}`)),
    ...fuels.map((fuel) => `        ${PLATFORM_CLASS}.fuel(${fuel});`),
  ]
  const source = `package ${packageName};

${importLines(imports)}

/** This mod's blocks and items (${target.manifest.id}), registered through the facade. */
public final class StudioContentRegistry {
    public static final String MOD_ID = "${modId}";
${[...blocks, ...blockItems, ...items].join("\n")}${registers ? "\n" : ""}
    public static void register() {
${registrations.join("\n")}
    }
}
`
  const java = (file: string, text: string) => [`${sourceRoot(packageName)}/${file}`, target.version.rewriteJava(text)] as const
  return Object.fromEntries([
    java("StudioContentRegistry.java", source),
    ...(content.items.some((item) => item.tool) ? [java("StudioToolMaterial.java", version.toolMaterial(packageName))] : []),
    ...((armor) => (armor && content.items.some((item) => item.armor) ? [java("StudioArmorMaterial.java", armor)] : []))(version.armorMaterial(packageName)),
    ...shaped.map((block) => java(`block/${shapedClass(block)}.java`, version.shapedBlock(shapedBlockSource(block, packageName, target.loader.blockExperience)))),
    ...Object.values(compileLuckyCaches(content.blocks, packageName)).map((text) => java("StudioLuckyCaches.java", version.luckyCaches(platformLuckyCaches(text, packageName)))),
  ])
}

/** The lucky caches' class of the Fabric generator (`fabric/lucky-cache.ts`) on the facade: opened through `StudioPlatform.onUseBlock`, its blocks read from their suppliers. */
function platformLuckyCaches(text: string, packageName: string) {
  const fabric = "import net.fabricmc.fabric.api.event.player.UseBlockCallback;\n"
  const register = "UseBlockCallback.EVENT.register(StudioLuckyCaches::open);"
  if (!text.includes(fabric) || !text.includes(register)) throw new Error("LUCKY_CACHE_TEXT_CHANGED")
  return text
    .replace(fabric, `import ${packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};\n`)
    .replace(register, `${PLATFORM_CLASS}.onUseBlock(StudioLuckyCaches::open);`)
    .replace(/state\.is\(StudioContentRegistry\.(BLOCK_\w+)\)/g, "state.is(StudioContentRegistry.$1.get())")
}

/** A block with a shape is drawn with holes where its sheet is empty: Forge and NeoForge read the render type from the block's model. */
export function cutoutModel(text: string) {
  return JSON.stringify({ ...(JSON.parse(text) as Record<string, unknown>), render_type: "minecraft:cutout" }, null, 2)
}
