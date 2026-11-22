import { ARMOR_LOOKS, ARMOR_SLOTS, FOOD_EFFECTS, FOOD_LEAVES, MINING_LEVELS, TOOL_KINDS } from "../content-words"
import type { Item } from "../content"
import { armorImports, itemSource, materialSource, repair, withRarity } from "../fabric/content-items"

/**
 * What a project's blocks and items are written as where the game version changed them (E 组, 平台层-移植清单.md):
 * the common layer writes 1.21.1's shape (the Fabric generator's own text, `fabric/content-items.ts`,
 * `fabric/block-shape.ts`, `fabric/lucky-cache.ts`), and 1.20.1 maps it. Every difference here was found by compiling
 * the generated tree against the real Forge 1.20.1 class path (`test/target-content.test.ts`).
 *
 * - A tool: 1.21 builds its attributes into `Item.Properties` (`createAttributes`) and its material names the blocks it
 *   cannot mine (`Tier.getIncorrectBlocksForDrops`); 1.20.1 hands the damage and speed to the tool's constructor and the
 *   material has a mining level (`Tier.getLevel`: wood 0 … netherite 4, the game's own `Tiers`).
 * - A food: 1.20.1 calls the saturation `saturationMod` and "eat when full" `alwaysEat`, and has no `usingConvertsTo`:
 *   what is left in the hand is given back by the item's own `finishUsingItem`, the way 1.20.1's honey bottle does it.
 * - A block that gives experience: `DropExperienceBlock(Properties, IntProvider)` in 1.20.1, the other way round in 1.21.
 * - A block with a shape: 1.20.1 has no block codecs, and its shape and drop methods are public.
 * - A lucky cache: a status effect is a `MobEffect` in 1.20.1, a `Holder<MobEffect>` in 1.21.
 */
export interface ContentVersion {
  /** The `new …(…)` an item is registered with. */
  item(item: Item): string
  /** The field lines before an item's own: its tool material. */
  material(item: Item): string
  /** The tool material class, `StudioToolMaterial`. */
  toolMaterial(packageName: string): string
  /** A piece of armor's material class, `StudioArmorMaterial`, where the version needs one of the mod's own (1.20.1); null where the game's record is used as it is (1.21). */
  armorMaterial(packageName: string): string | null
  /** What the registry imports for these items' natures (full class names). */
  itemImports(items: readonly Item[]): string[]
  /** A block that drops experience, from an `IntProvider` expression and the properties expression. */
  experienceBlock(range: string, properties: string): string
  /** A block with a shape's class, from the 1.21.1 text. */
  shapedBlock(source: string): string
  /** The lucky caches' class, from the 1.21.1 text. */
  luckyCaches(source: string): string
}

const float = (value: number) => `${Number(value.toFixed(3))}f`
const constant = (identifier: string) => identifier.toUpperCase()

/** What every version imports for the same natures. */
function sharedImports(items: readonly Item[]) {
  const tools = items.flatMap((item) => (item.tool ? [item.tool] : []))
  const foods = items.flatMap((item) => (item.food ? [item.food] : []))
  const tagged = tools.some((tool) => tool.repair?.startsWith("#"))
  const repaired = tools.some((tool) => tool.repair)
  return [
    ...(foods.length ? ["net.minecraft.world.food.FoodProperties"] : []),
    ...(foods.some((food) => food.effects?.length) ? ["net.minecraft.world.effect.MobEffectInstance", "net.minecraft.world.effect.MobEffects"] : []),
    ...(foods.some((food) => food.leaves) ? ["net.minecraft.world.item.Items"] : []),
    ...(foods.some((food) => food.drink) ? ["net.minecraft.world.item.ItemStack", "net.minecraft.sounds.SoundEvent", "net.minecraft.world.item.UseAnim"] : []),
    ...tools.map((tool) => `net.minecraft.world.item.${TOOL_KINDS[tool.kind].java}`),
    ...(tools.length ? ["net.minecraft.world.item.Tier", "net.minecraft.world.item.crafting.Ingredient"] : []),
    ...(repaired ? ["net.minecraft.core.registries.BuiltInRegistries", "net.minecraft.resources.ResourceLocation"] : []),
    ...(tagged ? ["net.minecraft.core.registries.Registries", "net.minecraft.tags.TagKey"] : []),
  ]
}

const TOOL_MATERIAL_1211 = (packageName: string) => `package ${packageName};

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
`

export const CONTENT_1_21_1: ContentVersion = {
  item: itemSource,
  material: materialSource,
  toolMaterial: TOOL_MATERIAL_1211,
  itemImports: (items) => [...new Set([...sharedImports(items), ...(items.some((item) => item.tool) ? ["net.minecraft.tags.BlockTags"] : []), ...armorImports(items.flatMap((item) => (item.armor ? [item.armor] : [])))])],
  armorMaterial: () => null,
  experienceBlock: (range, properties) => `new DropExperienceBlock(${range}, ${properties})`,
  shapedBlock: (source) => source,
  luckyCaches: (source) => source,
}

/** 1.20.1's tool constructors: the damage is an int for the sword, the pickaxe and the hoe, a float for the axe and the shovel. */
const INT_DAMAGE = new Set(["SwordItem", "PickaxeItem", "HoeItem"])

function item1201(item: Item) {
  // 1.20.1's armor takes its material (the mod's own record) and its durability from it.
  if (item.armor) return `new ArmorItem(ARMOR_${constant(item.identifier)}, ArmorItem.Type.${ARMOR_SLOTS[item.armor.slot].type}, new Item.Properties())`
  if (item.tool) {
    const words = TOOL_KINDS[item.tool.kind]
    // The same arithmetic as 1.21's createAttributes: the hit is the player's own 1 plus the material's damage; the speed is counted down from 4.
    return `new ${words.java}(MATERIAL_${constant(item.identifier)}, ${INT_DAMAGE.has(words.java) ? "0" : "0f"}, ${float((item.tool.attack_speed ?? words.speed) - 4)}, new Item.Properties())`
  }
  if (!item.food) return itemSource(item)
  const food = item.food
  const effects = (food.effects ?? []).map((effect) => `.effect(new MobEffectInstance(MobEffects.${FOOD_EFFECTS[effect.effect].java}, ${"instant" in FOOD_EFFECTS[effect.effect] ? 1 : effect.seconds * 20}, ${effect.level - 1}), ${float(effect.chance)})`).join("")
  const plain = `new Item(new Item.Properties().stacksTo(${item.max_stack}).food(new FoodProperties.Builder().nutrition(${food.hunger}).saturationMod(${float(food.saturation)})${food.always_edible ? ".alwaysEat()" : ""}${food.snack ? ".fast()" : ""}${effects}.build()))`
  const left = food.leaves ? `Items.${FOOD_LEAVES[food.leaves].java}` : null
  const members = [
    ...(food.drink ? ["        @Override public UseAnim getUseAnimation(ItemStack stack) { return UseAnim.DRINK; }", "        @Override public SoundEvent getEatingSound() { return getDrinkingSound(); }"] : []),
    // 1.21.1's usingConvertsTo, as its Player.eat does it: for a player not in creative, the emptied container in the hand, or into the inventory when more are left.
    ...(left
      ? [
          `        @Override public net.minecraft.world.item.ItemStack finishUsingItem(net.minecraft.world.item.ItemStack stack, net.minecraft.world.level.Level level, net.minecraft.world.entity.LivingEntity eater) {
            net.minecraft.world.item.ItemStack rest = super.finishUsingItem(stack, level, eater);
            if (!(eater instanceof net.minecraft.world.entity.player.Player player) || player.getAbilities().instabuild) return rest;
            if (rest.isEmpty()) return new net.minecraft.world.item.ItemStack(${left});
            if (!level.isClientSide()) player.getInventory().add(new net.minecraft.world.item.ItemStack(${left}));
            return rest;
        }`,
        ]
      : []),
  ]
  return members.length ? `${plain} {\n${members.join("\n")}\n    }` : plain
}

export const CONTENT_1_20_1: ContentVersion = {
  item: (item) => withRarity(item, item1201(item)),
  material: (item) =>
    item.armor
      ? `    public static final ArmorMaterial ARMOR_${constant(item.identifier)} = new StudioArmorMaterial("${item.armor.look}", ArmorItem.Type.${ARMOR_SLOTS[item.armor.slot].type}, ${item.armor.durability}, ${item.armor.defense}, ${item.armor.enchantability}, SoundEvents.${ARMOR_LOOKS[item.armor.look].sound}, ${repair(item.armor.repair)}, ${float(item.armor.toughness)}, ${float(item.armor.knockback_resistance)});\n`
      : item.tool
      ? materialSource(item).replace(/, BlockTags\.\w+, /, `, ${MINING_LEVELS[item.tool.mining_level].rank}, `)
      : "",
  toolMaterial: (packageName) => `package ${packageName};

import java.util.function.Supplier;
import net.minecraft.world.item.Tier;
import net.minecraft.world.item.crafting.Ingredient;

/** One tool's material, with the numbers the project gave it. Its mining level is the game's own (wood 0, stone 1, iron 2, diamond 3, netherite 4). */
public record StudioToolMaterial(int durability, float miningSpeed, float attackDamage, int level, int enchantability, Supplier<Ingredient> repair) implements Tier {
    @Override public int getUses() { return durability; }
    @Override public float getSpeed() { return miningSpeed; }
    @Override public float getAttackDamageBonus() { return attackDamage; }
    @Override public int getLevel() { return level; }
    @Override public int getEnchantmentValue() { return enchantability; }
    @Override public Ingredient getRepairIngredient() { return repair.get(); }
}
`,
  // 1.20.1's armor material is the mod's own record (`armorMaterial`, in the registry's own package): only the item, the game's interface, the sound and what mends it are named.
  itemImports: (items) => {
    const armors = items.flatMap((item) => (item.armor ? [item.armor] : []))
    if (!armors.length) return sharedImports(items)
    return [...new Set([...sharedImports(items), ...armorImports(armors).filter((name) => !["net.minecraft.core.Holder", "java.util.List", "java.util.Map"].includes(name))])]
  },
  armorMaterial: (packageName) => `package ${packageName};

import java.util.function.Supplier;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.ArmorMaterial;
import net.minecraft.world.item.crafting.Ingredient;

/**
 * One piece of armor's material, with the numbers the project gave it: worn in \`slot\` only (every other slot 0). \`name\` is the game's own armor it is drawn as worn
 * (its texture under minecraft:textures/models/armor/).
 */
public record StudioArmorMaterial(String name, ArmorItem.Type slot, int durability, int defense, int enchantability, SoundEvent equipSound, Supplier<Ingredient> repair, float toughness, float knockbackResistance) implements ArmorMaterial {
    @Override public int getDurabilityForType(ArmorItem.Type type) { return type == slot ? durability : 0; }
    @Override public int getDefenseForType(ArmorItem.Type type) { return type == slot ? defense : 0; }
    @Override public int getEnchantmentValue() { return enchantability; }
    @Override public SoundEvent getEquipSound() { return equipSound; }
    @Override public Ingredient getRepairIngredient() { return repair.get(); }
    @Override public String getName() { return name; }
    @Override public float getToughness() { return toughness; }
    @Override public float getKnockbackResistance() { return knockbackResistance; }
}
`,
  experienceBlock: (range, properties) => `new DropExperienceBlock(${properties}, ${range})`,
  shapedBlock: (source) =>
    source
      .replace("import com.mojang.serialization.MapCodec;\n", "")
      .replace(/ {4}public static final MapCodec<\w+> CODEC = simpleCodec\(\w+::new\);\n/, "")
      .replace(/\n {4}@Override\n {4}protected MapCodec<\? extends \w+> codec\(\) \{\n {8}return CODEC;\n {4}\}\n/, "")
      .replaceAll("    protected VoxelShape get", "    public VoxelShape get")
      .replaceAll("    protected void spawnAfterBreak(", "    public void spawnAfterBreak("),
  luckyCaches: (source) => source.replace("import net.minecraft.core.Holder;\n", "").replace("Holder<MobEffect> effect", "MobEffect effect"),
}
