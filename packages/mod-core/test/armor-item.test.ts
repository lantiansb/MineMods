import { afterEach, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { ItemSchema, validateContent } from "../src/content"
import { ARMOR_SLOTS, CONNECTION_CAPABILITY, ITEM_NATURE_INSTRUCTIONS } from "../src/content-words"
import { itemSource, materialSource } from "../src/fabric/content-items"
import { CONTENT_1_20_1 } from "../src/platform/content-version"
import { openProject, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { createTargetContentSample } from "../script/target-content-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * A piece of real armor as data (`armor` of an item, 铜头铁额): its slot, defense, toughness, knockback resistance, durability, enchantability and repair, drawn worn as one
 * of the game's own armors. 1.21 holds its material directly; 1.20.1 has a record of the mod's own. An item without `armor` is what it always was.
 */

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const helmet = ItemSchema.parse({
  id: randomUUID(),
  identifier: "bronze_brow",
  name: "铜头铁额",
  name_en: "Bronze Brow Helm",
  max_stack: 1,
  color: "#8A6A2E",
  armor: { slot: "head", defense: 3, toughness: 2, knockback_resistance: 0.1, durability: 500, enchantability: 12, repair: "minecraft:iron_ingot", look: "netherite" },
})
const boots = ItemSchema.parse({ id: randomUUID(), identifier: "war_hooves", name: "牛蹄靴", max_stack: 1, color: "#3A3A3A", armor: { slot: "feet", defense: 2, toughness: 0, knockback_resistance: 0, durability: 200, enchantability: 9, repair: null, look: "iron" } })
const content = (items: unknown[]) => ({ mod_id: "chiyou", package_name: "com.minemods.content_chiyou", blocks: [], items, recipes: [], logic: [] })
const refused = (change: Record<string, unknown>) => {
  try {
    validateContent(content([{ ...helmet, ...change }]))
    return ""
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

test("an item may be a piece of armor: worn in one slot, one to a stack, neither a tool nor a food", () => {
  expect(validateContent(content([helmet, boots])).items.map((item) => item.armor?.slot)).toEqual(["head", "feet"])
  expect(refused({ max_stack: 16 })).toContain("盔甲不能叠放")
  expect(refused({ food: { hunger: 2, saturation: 0.3, always_edible: false, snack: false } })).toContain("不能既是盔甲又是食物")
  expect(refused({ tool: { kind: "sword", durability: 100, mining_level: "iron", mining_speed: 1, attack_damage: 6, attack_speed: null, enchantability: 10, repair: null } })).toContain("不能既是盔甲又是工具")
  expect(refused({ armor: { ...helmet.armor!, repair: "chiyou:bronze_brow" } })).toContain("修理材料不能是它自己")
  expect(ItemSchema.safeParse({ ...helmet, armor: { ...helmet.armor!, look: "leather" } }).success).toBe(false)
  expect(ItemSchema.safeParse({ ...helmet, armor: { ...helmet.armor!, knockback_resistance: 2 } }).success).toBe(false)
})

test("1.21's armor holds its material directly: its slot's defense, the look's layer and equip sound, its durability on the item", () => {
  expect(itemSource(helmet)).toBe("new ArmorItem(ARMOR_BRONZE_BROW, ArmorItem.Type.HELMET, new Item.Properties().durability(500))")
  const material = materialSource(helmet)
  expect(material).toContain("public static final Holder<ArmorMaterial> ARMOR_BRONZE_BROW = Holder.direct(new ArmorMaterial(Map.of(ArmorItem.Type.HELMET, 3), 12, SoundEvents.ARMOR_EQUIP_NETHERITE,")
  expect(material).toContain('List.of(new ArmorMaterial.Layer(ResourceLocation.withDefaultNamespace("netherite"))), 2f, 0.1f));')
  expect(material).toContain('Ingredient.of(BuiltInRegistries.ITEM.get(ResourceLocation.fromNamespaceAndPath("minecraft", "iron_ingot")))')
  // An item that is not armor is written as it always was.
  const plain = ItemSchema.parse({ id: randomUUID(), identifier: "flag", name: "蚩尤旗", max_stack: 64, color: "#B3261E" })
  expect(itemSource(plain)).toBe("new Item(new Item.Properties().stacksTo(64))")
  expect(materialSource(plain)).toBe("")
})

test("1.20.1's armor has a record of the mod's own: defense and durability for its slot only, the look's name, the equip sound as an event", () => {
  expect(CONTENT_1_20_1.item(helmet)).toBe("new ArmorItem(ARMOR_BRONZE_BROW, ArmorItem.Type.HELMET, new Item.Properties())")
  expect(CONTENT_1_20_1.material(helmet)).toContain('public static final ArmorMaterial ARMOR_BRONZE_BROW = new StudioArmorMaterial("netherite", ArmorItem.Type.HELMET, 500, 3, 12, SoundEvents.ARMOR_EQUIP_NETHERITE,')
  const record = CONTENT_1_20_1.armorMaterial("com.minemods.content_chiyou")!
  expect(record).toContain("public record StudioArmorMaterial(String name, ArmorItem.Type slot, int durability, int defense")
  expect(record).toContain("@Override public int getDefenseForType(ArmorItem.Type type) { return type == slot ? defense : 0; }")
  expect(CONTENT_1_20_1.itemImports([helmet])).not.toContain("net.minecraft.core.Holder")
})

test("an outside AI is told how to write armor and what it cannot do yet", () => {
  expect(ITEM_NATURE_INSTRUCTIONS).toContain("armor 让它成为真正的盔甲")
  expect(ITEM_NATURE_INSTRUCTIONS).toContain(`slot: ${Object.keys(ARMOR_SLOTS).join("|")}`)
  expect(ITEM_NATURE_INSTRUCTIONS).toContain("穿在身上用自己的模型（比如带角的头盔）现在也还做不到")
  expect(ITEM_NATURE_INSTRUCTIONS).not.toContain("要用 gameplay（AI 写的代码）的：盔甲")
  expect(CONNECTION_CAPABILITY.done.join("")).toContain("物品可以是真正的盔甲")
})

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: a project with armor registers it in the combat tab with its enchantable tags, and the whole tree compiles`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-armor-"))
    roots.push(root)
    const directory = path.join(root, "琥珀工坊")
    await createTargetContentSample(directory, target)
    const project = await openProject(directory)
    await saveProject(directory, { ...project, items: [...project.items, helmet, boots] }, project.revision)
    const source = path.join(root, "source")
    await mkdir(source)
    await assembleBuildSource(directory, source, TEMPLATE)
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    const tags = target === "forge-1.20.1" ? "tags/items" : "tags/item"
    expect(names).toContain(`src/main/resources/data/minecraft/${tags}/enchantable/head_armor.json`)
    expect(names).toContain(`src/main/resources/data/minecraft/${tags}/enchantable/foot_armor.json`)
    expect(JSON.parse(await readFile(path.join(source, `src/main/resources/data/minecraft/${tags}/enchantable/armor.json`), "utf8")).values).toEqual(["amber_works:bronze_brow", "amber_works:war_hooves"])
    expect(names.some((name) => name.endsWith("/StudioArmorMaterial.java"))).toBe(target === "forge-1.20.1")
    const registry = names.find((name) => name.endsWith("/StudioContentRegistry.java"))!
    expect(await readFile(path.join(source, registry), "utf8")).toContain("ArmorItem.Type.HELMET")
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}
