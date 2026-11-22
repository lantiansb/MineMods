import { ARMOR_LOOKS, ARMOR_SLOTS, FOOD_EFFECTS, FOOD_LEAVES, ITEM_RARITIES, MINING_LEVELS, MOVEMENT_PLAIN, TOOL_KINDS, type ToolKind } from "../content-words"
import type { Content, Item, Movement } from "../content"

/**
 * The Java of what an item is besides an ordinary item: a tool with its own material, a food, a furnace fuel.
 * Every class, constructor and method named is Mojang's official name for 1.21.1. A project whose items
 * are all ordinary gets nothing from here, so it builds byte for byte as before.
 */

const float = (value: number) => `${Number(value.toFixed(3))}f`
const constant = (identifier: string) => identifier.toUpperCase()

export function repair(reference: string | null) {
  if (!reference) return "Ingredient::of"
  const [namespace, name] = reference.replace("#", "").split(":")
  const id = `ResourceLocation.fromNamespaceAndPath("${namespace}", "${name}")`
  // Looked up when an anvil asks, long after every item is registered.
  return reference.startsWith("#") ? `() -> Ingredient.of(TagKey.create(Registries.ITEM, ${id}))` : `() -> Ingredient.of(BuiltInRegistries.ITEM.get(${id}))`
}

/** The settings a block's movement adds, in the order the game's own blocks write them; a part at the game's default adds nothing, so a block that changes nothing is what it always was. */
export function movementSource(movement: Movement | null | undefined) {
  if (!movement) return ""
  return `${movement.speed === MOVEMENT_PLAIN.speed ? "" : `.speedFactor(${float(movement.speed)})`}${movement.jump === MOVEMENT_PLAIN.jump ? "" : `.jumpFactor(${float(movement.jump)})`}${movement.slip === MOVEMENT_PLAIN.slip ? "" : `.friction(${float(movement.slip)})`}`
}

/** `source` with the item's rarity set on its properties (every item source has exactly one); common or none: unchanged, as every build wrote it before. */
export function withRarity(item: Item, source: string) {
  return item.rarity && item.rarity !== "common" ? source.replace("new Item.Properties()", `new Item.Properties().rarity(net.minecraft.world.item.Rarity.${ITEM_RARITIES[item.rarity].java})`) : source
}

/** The `new …(…)` an item is registered with. An ordinary item's is exactly what every build wrote before. */
export function itemSource(item: Item) {
  return withRarity(item, itemBody(item))
}

function itemBody(item: Item) {
  // A piece of armor: its own material (`materialSource`), worn in its slot, wearing out after its durability.
  if (item.armor) return `new ArmorItem(ARMOR_${constant(item.identifier)}, ArmorItem.Type.${ARMOR_SLOTS[item.armor.slot].type}, new Item.Properties().durability(${item.armor.durability}))`
  if (item.tool) {
    const words = TOOL_KINDS[item.tool.kind]
    // The whole hit is the player's own 1 plus the material's damage; the speed is counted down from the player's own 4.
    return `new ${words.java}(MATERIAL_${constant(item.identifier)}, new Item.Properties().attributes(${words.java}.createAttributes(MATERIAL_${constant(item.identifier)}, ${item.tool.kind === "sword" ? "0" : "0f"}, ${float((item.tool.attack_speed ?? words.speed) - 4)})))`
  }
  if (item.food) {
    const food = item.food
    // An instant effect (healing, saturation) happens once, the moment it is applied: vanilla's potions give it one tick.
    const effects = (food.effects ?? []).map((effect) => `.effect(new MobEffectInstance(MobEffects.${FOOD_EFFECTS[effect.effect].java}, ${"instant" in FOOD_EFFECTS[effect.effect] ? 1 : effect.seconds * 20}, ${effect.level - 1}), ${float(effect.chance)})`).join("")
    const plain = `new Item(new Item.Properties().stacksTo(${item.max_stack}).food(new FoodProperties.Builder().nutrition(${food.hunger}).saturationModifier(${float(food.saturation)})${food.always_edible ? ".alwaysEdible()" : ""}${food.snack ? ".fast()" : ""}${effects}${food.leaves ? `.usingConvertsTo(Items.${FOOD_LEAVES[food.leaves].java})` : ""}.build()))`
    // Drunk, not chewed: the drinking motion while it is held, and the drinking sound when the last mouthful goes down (the game's honey bottle does both).
    return food.drink
      ? `${plain} {
        @Override public UseAnim getUseAnimation(ItemStack stack) { return UseAnim.DRINK; }
        @Override public SoundEvent getEatingSound() { return getDrinkingSound(); }
    }`
      : plain
  }
  return `new Item(new Item.Properties().stacksTo(${item.max_stack}))`
}

/** The field lines that must stand before an item's own: its tool material. */
export function materialSource(item: Item) {
  // A piece of armor's material, held directly (no registry: nothing else names it): its defense in its slot, enchantability, equip sound, repair, how it is drawn worn, toughness, knockback resistance.
  if (item.armor) {
    const armor = item.armor
    return `    public static final Holder<ArmorMaterial> ARMOR_${constant(item.identifier)} = Holder.direct(new ArmorMaterial(Map.of(ArmorItem.Type.${ARMOR_SLOTS[armor.slot].type}, ${armor.defense}), ${armor.enchantability}, SoundEvents.${ARMOR_LOOKS[armor.look].sound}, ${repair(armor.repair)}, List.of(new ArmorMaterial.Layer(ResourceLocation.withDefaultNamespace("${armor.look}"))), ${float(armor.toughness)}, ${float(armor.knockback_resistance)}));
`
  }
  if (!item.tool) return ""
  return `    public static final Tier MATERIAL_${constant(item.identifier)} = new StudioToolMaterial(${item.tool.durability}, ${float(item.tool.mining_speed)}, ${float(item.tool.attack_damage - 1)}, BlockTags.${MINING_LEVELS[item.tool.mining_level].tag}, ${item.tool.enchantability}, ${repair(item.tool.repair)});\n`
}

/** What a piece of armor's material and item name: the same classes on every version (1.20.1's material is a record of the mod's own, `content-version.ts`, which names the rest itself). */
export function armorImports(armors: readonly NonNullable<Item["armor"]>[]) {
  if (!armors.length) return []
  return [
    "net.minecraft.world.item.ArmorItem",
    "net.minecraft.world.item.ArmorMaterial",
    "net.minecraft.core.Holder",
    "net.minecraft.sounds.SoundEvents",
    "java.util.List",
    "java.util.Map",
    "net.minecraft.resources.ResourceLocation",
    "net.minecraft.world.item.crafting.Ingredient",
    ...(armors.some((armor) => armor.repair) ? ["net.minecraft.core.registries.BuiltInRegistries"] : []),
    ...(armors.some((armor) => armor.repair?.startsWith("#")) ? ["net.minecraft.core.registries.Registries", "net.minecraft.tags.TagKey"] : []),
  ]
}

/**
 * The 1.21 tags that make a piece of armor's enchantments available at a table and on an anvil (its slot's, every armor's, durability's, being worn), so other mods
 * recognise it too. 1.20.1 knows armor by its class and does not read them (a facade target's `tags/item` is mapped to its `tags/items` anyway).
 */
export function armorTags(armors: readonly { id: string; slot: keyof typeof ARMOR_SLOTS }[]): Record<string, string> {
  if (!armors.length) return {}
  const file = (tag: string, values: readonly string[]) => [`src/main/resources/data/minecraft/tags/item/${tag}.json`, JSON.stringify({ replace: false, values }, null, 2)] as const
  const all = armors.map((armor) => armor.id)
  return Object.fromEntries([
    ...(Object.keys(ARMOR_SLOTS) as (keyof typeof ARMOR_SLOTS)[]).flatMap((slot) => ((values) => (values.length ? [file(`enchantable/${ARMOR_SLOTS[slot].tag}`, values)] : []))(armors.filter((armor) => armor.slot === slot).map((armor) => armor.id))),
    file("enchantable/armor", all),
    file("enchantable/durability", all),
    file("enchantable/equippable", all),
  ])
}

/** Extra imports, the lines `register()` gains and the extra files, for the items and blocks that are more than ordinary. */
export function compileItemNatures(content: Content, modId: string, packageName: string) {
  const tools = content.items.flatMap((item) => (item.tool ? [{ item, tool: item.tool }] : []))
  const armors = content.items.flatMap((item) => (item.armor ? [{ item, armor: item.armor }] : []))
  const foods = content.items.filter((item) => item.food)
  const fuels = [...content.items.flatMap((item) => (item.fuel ? [`ITEM_${constant(item.identifier)}, ${item.fuel.burn_ticks}`] : [])), ...content.blocks.flatMap((block) => (block.fuel ? [`BLOCK_ITEM_${constant(block.identifier)}, ${block.fuel.burn_ticks}`] : []))]
  const tagged = tools.some((entry) => entry.tool.repair?.startsWith("#"))
  const effects = foods.some((item) => item.food?.effects?.length)
  const drinks = foods.some((item) => item.food?.drink)
  const imports = [
    ...(fuels.length ? ["net.fabricmc.fabric.api.registry.FuelRegistry"] : []),
    ...(foods.length ? ["net.minecraft.world.food.FoodProperties"] : []),
    ...(effects ? ["net.minecraft.world.effect.MobEffectInstance", "net.minecraft.world.effect.MobEffects"] : []),
    ...(foods.some((item) => item.food?.leaves) ? ["net.minecraft.world.item.Items"] : []),
    ...(drinks ? ["net.minecraft.world.item.ItemStack", "net.minecraft.sounds.SoundEvent", "net.minecraft.world.item.UseAnim"] : []),
    ...[...new Set(tools.map((entry) => TOOL_KINDS[entry.tool.kind].java))].sort().map((name) => `net.minecraft.world.item.${name}`),
    ...(tools.length ? ["net.minecraft.world.item.Tier", "net.minecraft.world.item.crafting.Ingredient"] : []),
    ...(tagged ? ["net.minecraft.core.registries.Registries"] : []),
    ...(tools.length ? ["net.minecraft.tags.BlockTags"] : []),
    ...(tagged ? ["net.minecraft.tags.TagKey"] : []),
    ...armorImports(armors.map((entry) => entry.armor)),
  ]
  const tab = (name: string, items: readonly Item[]) =>
    items.length ? `        ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.${name}).register(entries -> {\n${items.map((item) => `            entries.accept(ITEM_${constant(item.identifier)});`).join("\n")}\n        });\n` : ""
  const kinds = Object.keys(TOOL_KINDS) as ToolKind[]
  return {
    // A tool and a piece of armor name some of the same classes: each is imported once.
    imports: [...new Set(imports)].map((name) => `import ${name};\n`).join(""),
    registrations:
      tab("TOOLS_AND_UTILITIES", tools.filter((entry) => TOOL_KINDS[entry.tool.kind].tab === "TOOLS").map((entry) => entry.item)) +
      tab("COMBAT", [...tools.filter((entry) => TOOL_KINDS[entry.tool.kind].tab === "COMBAT").map((entry) => entry.item), ...armors.map((entry) => entry.item)]) +
      tab("FOOD_AND_DRINKS", foods) +
      fuels.map((fuel) => `        FuelRegistry.INSTANCE.add(${fuel});\n`).join(""),
    files: {
      ...(tools.length
        ? {
            [`src/main/java/${packageName.replaceAll(".", "/")}/StudioToolMaterial.java`]: `package ${packageName};

import java.util.function.Supplier;
import net.minecraft.tags.TagKey;
import net.minecraft.world.item.Tier;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.level.block.Block;

/** One tool's material, with the numbers the project gave it. */
public record StudioToolMaterial(int durability, float miningSpeed, float attackDamage, TagKey<Block> inverseTag, int enchantability, Supplier<Ingredient> repair) implements Tier {
    @Override public int getUses() { return durability; }
    @Override public float getSpeed() { return miningSpeed; }
    @Override public float getAttackDamageBonus() { return attackDamage; }
    @Override public TagKey<Block> getIncorrectBlocksForDrops() { return inverseTag; }
    @Override public int getEnchantmentValue() { return enchantability; }
    @Override public Ingredient getRepairIngredient() { return repair.get(); }
}
`,
          }
        : {}),
      // The vanilla tags that make a tool's enchantments available and let other mods recognise it.
      ...Object.fromEntries(
        kinds.flatMap((kind) => {
          const values = tools.filter((entry) => entry.tool.kind === kind).map((entry) => `${modId}:${entry.item.identifier}`)
          return values.length ? [[`src/main/resources/data/minecraft/tags/item/${TOOL_KINDS[kind].tag}.json`, JSON.stringify({ replace: false, values }, null, 2)]] : []
        }),
      ),
      ...armorTags(armors.map((entry) => ({ id: `${modId}:${entry.item.identifier}`, slot: entry.armor.slot }))),
    },
  }
}
