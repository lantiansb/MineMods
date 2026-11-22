import { EntitySchema } from "../src/entity-runtime"
import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { ItemSchema, RecipeSchema, SOUND_TYPES, compileContent, validateContent } from "../src/content"
import { blockFacets, itemFacets, recipeFacets } from "../src/content-facets"
import { CONNECTION_CAPABILITY, MINING_LEVELS, RECIPE_KINDS, TOOL_KINDS, contentWords, referenceWords, vanillaIssue, type RecipeKind } from "../src/content-words"
import { CONVENTION_ITEM_TAGS, MINECRAFT_ITEM_TAGS, VANILLA_ITEM_NAMES } from "../src/fabric/content-vanilla"
import type { Facet } from "../src/playable"
import type { Project } from "../src/project"
import { getModuleSchema } from "../src/workspace"
import { MODULES } from "../src/workspace-modules"
import { connectionChain, createDataGameplaySample } from "../script/data-gameplay-sample"
import { HAS_GAME_DATA, compileTreeFor, vanillaFiles, vanillaJson } from "./java-tree"
import { hasTargetJavac, targetJavac } from "./target-javac"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function temporary() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-connect-"))
  roots.push(root)
  return root
}

/** A JSON value with every leaf replaced by its type: two documents of the same format have the same shape. */
const shape = (value: unknown): unknown =>
  Array.isArray(value) ? [...new Set(value.map((entry) => JSON.stringify(shape(entry))))].sort().map((entry) => JSON.parse(entry)) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, shape(entry)])) : typeof value

const ID = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
const plain = (index: number, identifier: string, name: string, extra: Record<string, unknown> = {}) => ({ id: ID(index), identifier, name, max_stack: 64, color: "#49C6E8", ...extra })
const slots = (...filled: (string | null)[]) => [...filled, ...Array.from({ length: 9 - filled.length }, () => null)]
const recipe = (index: number, type: RecipeKind | undefined, pattern: (string | null)[], result: string, extra: Record<string, unknown> = {}) => ({ id: ID(100 + index), name: `配方${index}`, pattern, result, count: 1, ...(type ? { type } : {}), ...extra })
const tool = { kind: "pickaxe", durability: 300, mining_level: "iron", mining_speed: 6.5, attack_damage: 4, attack_speed: null, enchantability: 15, repair: "azure:ingot" }
const content = (items: unknown[], recipes: unknown[] = [], blocks: unknown[] = []) => ({ mod_id: "azure", package_name: "com.minemods.content_azure", blocks, items, recipes, logic: [] })
const message = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return ""
}
const REGISTRY = "src/main/java/com/minemods/content_azure/StudioContentRegistry.java"
const recipeFile = (index: number) => `src/main/resources/data/azure/recipe/${ID(100 + index)}.json`

// One recipe of each kind, and the game's own recipe of that kind it must be written like.
const KINDS: [RecipeKind, ReturnType<typeof recipe>, string][] = [
  ["shaped", recipe(1, "shaped", ["azure:ingot", "azure:ingot", "azure:ingot", null, "#minecraft:planks", null, null, "minecraft:stick", null], "azure:pick"), "iron_pickaxe"],
  ["shapeless", recipe(2, "shapeless", slots("azure:shard", "minecraft:sugar"), "azure:candy", { count: 2 }), "flint_and_steel"],
  ["smelting", recipe(3, "smelting", slots("azure:shard"), "azure:ingot", { experience: 0.7, cooking_time: 200 }), "iron_ingot_from_smelting_iron_ore"],
  ["blasting", recipe(4, "blasting", slots("azure:shard"), "azure:ingot", { experience: 0.7 }), "iron_ingot_from_blasting_iron_ore"],
  ["smoking", recipe(5, "smoking", slots("minecraft:beef"), "azure:candy"), "cooked_beef_from_smoking"],
  ["campfire", recipe(6, "campfire", slots("#minecraft:logs"), "minecraft:charcoal"), "cooked_beef_from_campfire_cooking"],
  ["stonecutting", recipe(7, "stonecutting", slots("minecraft:stone"), "azure:shard", { count: 4 }), "stone_slab_from_stone_stonecutting"],
  ["smithing", recipe(8, "smithing", slots("minecraft:netherite_upgrade_smithing_template", "azure:pick", "minecraft:netherite_ingot"), "minecraft:netherite_pickaxe"), "netherite_sword_smithing"],
]
const ITEMS = [plain(1, "shard", "蓝晶碎片"), plain(2, "ingot", "蓝晶锭"), plain(3, "pick", "蓝晶镐", { max_stack: 1, tool }), plain(4, "candy", "蓝晶糖", { food: { hunger: 2, saturation: 0.3, snack: true } })]

test("a recipe without a type and an item without a nature are written exactly as before", () => {
  const old = content([plain(1, "shard", "蓝晶碎片")], [recipe(1, undefined, ["azure:shard", "minecraft:stick", null, null, null, null, null, null, null], "azure:shard", { count: 2 })])
  const built = compileContent(old)
  expect(JSON.parse(String(built[recipeFile(1)]))).toEqual({ type: "minecraft:crafting_shaped", pattern: ["AB ", "   ", "   "], key: { A: { item: "azure:shard" }, B: { item: "minecraft:stick" } }, result: { id: "azure:shard", count: 2 } })
  // Writing the defaults out changes nothing, and nothing new is generated for it.
  const spelled = compileContent(content([plain(1, "shard", "蓝晶碎片", { tool: null, food: null, fuel: null })], [recipe(1, "shaped", ["azure:shard", "minecraft:stick", null, null, null, null, null, null, null], "azure:shard", { count: 2, experience: null, cooking_time: null })]))
  expect(spelled).toEqual(built)
  expect(Object.keys(built).some((name) => /StudioToolMaterial|tags\/item/.test(name))).toBe(false)
  expect(String(built[REGISTRY])).not.toMatch(/FuelRegistry|\bTier\b|FoodProperties|CreativeModeTabs\.(TOOLS_AND_UTILITIES|COMBAT|FOOD_AND_DRINKS)/)
  // Old documents parse into the same value: the new fields are not added to them.
  expect(RecipeSchema.parse(old.recipes[0])).toEqual(old.recipes[0] as never)
  expect(ItemSchema.parse(old.items[0])).toEqual(old.items[0] as never)
})

test.skipIf(!HAS_GAME_DATA)("each kind of recipe is written field for field like the game's own recipe of that kind", () => {
  const built = compileContent(content(ITEMS, KINDS.map(([, value]) => value)))
  KINDS.forEach(([kind, , vanilla], index) => {
    const ours = JSON.parse(String(built[recipeFile(index + 1)])) as Record<string, unknown>
    // `group` is an optional recipe-book grouping; a shaped recipe has been written without `category` since before this round.
    const { group: _group, ...theirs } = vanillaJson(`data/minecraft/recipe/${vanilla}.json`) as Record<string, unknown>
    const { category: _category, ...uncategorised } = theirs
    expect(ours.type).toBe(RECIPE_KINDS[kind].type)
    expect(theirs.type).toBe(RECIPE_KINDS[kind].type)
    // An ingredient is an item or a tag; vanilla's sample of this kind happens to use one of the two.
    // The letters of a shaped key are the writer's own; what each stands for is what must match.
    const keyed = (value: Record<string, unknown>) => (value.key && typeof value.key === "object" ? { ...value, key: Object.values(value.key) } : value)
    expect(shape(keyed(JSON.parse(JSON.stringify(ours).replaceAll('{"tag":', '{"item":')) as Record<string, unknown>))).toEqual(shape(keyed(kind === "shaped" ? uncategorised : theirs)))
  })
  // A tag ingredient is written the way vanilla's stick recipe writes its planks.
  expect((JSON.parse(String(built[recipeFile(1)])) as { key: Record<string, unknown> }).key.B).toEqual((vanillaJson("data/minecraft/recipe/stick.json") as { key: Record<string, unknown> }).key["#"])
  expect(JSON.parse(String(built[recipeFile(3)]))).toEqual({ type: "minecraft:smelting", category: "misc", cookingtime: 200, experience: 0.7, ingredient: { item: "azure:shard" }, result: { id: "azure:ingot" } })
  // The station's own time when none is written; the book tab follows what is made.
  expect(JSON.parse(String(built[recipeFile(4)]))).toMatchObject({ cookingtime: 100, category: "misc" })
  expect(JSON.parse(String(built[recipeFile(5)]))).toMatchObject({ cookingtime: 100, experience: 0, category: "food" })
  expect(JSON.parse(String(built[recipeFile(6)]))).toMatchObject({ cookingtime: 600, ingredient: { tag: "minecraft:logs" } })
  expect(JSON.parse(String(built[recipeFile(8)]))).toEqual({ type: "minecraft:smithing_transform", addition: { item: "minecraft:netherite_ingot" }, base: { item: "azure:pick" }, result: { count: 1, id: "minecraft:netherite_pickaxe" }, template: { item: "minecraft:netherite_upgrade_smithing_template" } })
})

test("a recipe is held to its kind, and to things the game really has", () => {
  const check = (value: unknown, items: unknown[] = ITEMS) => message(() => validateContent(content(items, [value])))
  expect(check(recipe(1, "smelting", slots("azure:shard", "azure:shard"), "azure:ingot"))).toContain("只能有一样材料")
  expect(check(recipe(1, "smithing", slots("azure:pick", "azure:ingot"), "azure:pick"))).toContain("第 0、1、2 格")
  expect(check(recipe(1, "smelting", slots("azure:shard"), "azure:ingot", { count: 2 }))).toContain("一次只能出 1 个")
  expect(check(recipe(1, "shapeless", slots("azure:shard"), "azure:ingot", { experience: 1 }))).toContain("不是烧炼类配方")
  // A misspelt vanilla item is refused with the real ones it most looks like.
  const typo = check(recipe(1, "shaped", slots("minecraft:iron_ingott"), "azure:ingot"))
  expect(typo).toContain("Minecraft 1.21.1 里没有 minecraft:iron_ingott")
  expect(typo).toContain("minecraft:iron_ingot（铁锭）")
  expect(check(recipe(1, "shaped", slots("azure:shard"), "minecraft:diamondd"))).toContain("里没有 minecraft:diamondd")
  expect(check(recipe(1, "shaped", slots("#minecraft:plank"), "azure:ingot"))).toContain("没有 #minecraft:plank 这个物品标签")
  expect(check(recipe(1, "shaped", slots("#azure:things"), "azure:ingot"))).toContain("物品标签")
  expect(check(recipe(1, "shaped", slots("azure:nothing"), "azure:ingot"))).toContain("Unknown content reference")
  // A result is one thing, never a tag.
  expect(RecipeSchema.safeParse(recipe(1, "shaped", slots("azure:shard"), "#minecraft:planks")).success).toBe(false)
  expect(check(recipe(1, "shapeless", slots("#c:ingots/iron", "#minecraft:planks", "minecraft:stick"), "azure:ingot"))).toBe("")
  expect(vanillaIssue("minecraft:stick")).toBeNull()
  expect(vanillaIssue("azure:whatever")).toBeNull()
})

test("an item's nature is bounded and checked against the rest of the mod", () => {
  const check = (item: unknown) => message(() => validateContent(content([plain(2, "ingot", "蓝晶锭"), item])))
  expect(check(plain(3, "pick", "蓝晶镐", { max_stack: 1, tool }))).toBe("")
  expect(check(plain(3, "pick", "蓝晶镐", { tool }))).toContain("工具不能叠放")
  expect(check(plain(3, "pick", "蓝晶镐", { max_stack: 1, tool, food: { hunger: 2, saturation: 0.3 } }))).toContain("不能既是工具又是食物")
  expect(check(plain(3, "pick", "蓝晶镐", { max_stack: 1, tool: { ...tool, repair: "azure:gone" } }))).toContain("Unknown content reference")
  expect(check(plain(3, "pick", "蓝晶镐", { max_stack: 1, tool: { ...tool, repair: "azure:pick" } }))).toContain("不能是它自己")
  expect(check(plain(3, "pick", "蓝晶镐", { max_stack: 1, tool: { ...tool, repair: "minecraft:iron_ingots" } }))).toContain("里没有 minecraft:iron_ingots")
  expect(check(plain(3, "pick", "蓝晶镐", { max_stack: 1, tool: { ...tool, repair: "#c:ingots/iron" } }))).toBe("")
  expect(ItemSchema.safeParse(plain(3, "pick", "蓝晶镐", { tool: { ...tool, kind: "bow" } })).success).toBe(false)
  expect(ItemSchema.safeParse(plain(3, "pick", "蓝晶镐", { tool: { ...tool, durability: 0 } })).success).toBe(false)
  expect(ItemSchema.safeParse(plain(3, "pick", "蓝晶镐", { food: { hunger: 0, saturation: 0.3 } })).success).toBe(false)
  expect(ItemSchema.safeParse(plain(3, "pick", "蓝晶镐", { fuel: { burn_ticks: 5 } })).success).toBe(false)
  // The documents an AI hands in carry the same fields, and the instructions it reads name what exists and what does not.
  const { id: _id, ...document } = plain(3, "pick", "蓝晶镐", { max_stack: 1, tool, fuel: { burn_ticks: 200 }, name_en: "Azure Pickaxe" })
  expect(getModuleSchema("item").safeParse({ kind: "item", ...document, texture: null }).success).toBe(true)
  const { id: _recipe, ...smelting } = recipe(3, "smelting", slots("azure:shard"), "azure:ingot", { experience: 0.7, cooking_time: 200 })
  expect(getModuleSchema("recipe").safeParse({ kind: "recipe", ...smelting }).success).toBe(true)
  expect(getModuleSchema("recipe").safeParse({ kind: "recipe", ...smelting, type: "brewing" }).success).toBe(false)
  Object.keys(TOOL_KINDS).forEach((kind) => expect(MODULES.item.instructions).toContain(kind))
  Object.keys(RECIPE_KINDS).forEach((kind) => expect(MODULES.recipe.instructions).toContain(kind))
  expect(MODULES.item.instructions).toContain("弓弩和其他远程武器")
  // Armor is data now (its own field), only a worn model of its own is not.
  expect(MODULES.item.instructions).toContain("armor 让它成为真正的盔甲")
  expect(MODULES.block.instructions).toContain("fuel={burn_ticks")
  expect(CONNECTION_CAPABILITY.not_done.join("")).toContain("盔甲")
  expect(MODULES.item.references.some((reference) => reference.field === "tool.repair")).toBe(true)
})

test("a tool, a food and a fuel are generated as the game's own classes, models and tags", () => {
  const built = compileContent(
    content(
      [plain(2, "ingot", "蓝晶锭", { name_en: "Azure Ingot" }), plain(3, "pick", "蓝晶镐", { max_stack: 1, tool, name_en: "Azure Pickaxe" }), plain(5, "blade", "蓝晶剑", { max_stack: 1, tool: { ...tool, kind: "sword", attack_damage: 6.5, attack_speed: 1.6, repair: "#c:ingots/iron" } }), plain(4, "candy", "蓝晶糖", { max_stack: 16, food: { hunger: 2, saturation: 0.3, always_edible: true, snack: true } }), plain(6, "coal", "余烬炭", { fuel: { burn_ticks: 2400 } })],
      [],
      [{ id: ID(50), identifier: "pile", name: "炭堆", hardness: 1, luminance: 0, tool: "none", drop: "self", color: "#222222", fuel: { burn_ticks: 16000 } }],
    ),
  )
  const java = String(built[REGISTRY])
  // The whole hit is the player's 1 plus the material's 3; 1.2 hits a second is the player's 4 less 2.8.
  expect(java).toContain('MATERIAL_PICK = new StudioToolMaterial(300, 6.5f, 3f, BlockTags.INCORRECT_FOR_IRON_TOOL, 15, () -> Ingredient.of(BuiltInRegistries.ITEM.get(ResourceLocation.fromNamespaceAndPath("azure", "ingot"))));')
  expect(java).toContain("new PickaxeItem(MATERIAL_PICK, new Item.Properties().attributes(PickaxeItem.createAttributes(MATERIAL_PICK, 0f, -2.8f)))")
  expect(java).toContain('MATERIAL_BLADE = new StudioToolMaterial(300, 6.5f, 5.5f, BlockTags.INCORRECT_FOR_IRON_TOOL, 15, () -> Ingredient.of(TagKey.create(Registries.ITEM, ResourceLocation.fromNamespaceAndPath("c", "ingots/iron"))));')
  expect(java).toContain("SwordItem.createAttributes(MATERIAL_BLADE, 0, -2.4f)")
  expect(java).toContain("new Item(new Item.Properties().stacksTo(16).food(new FoodProperties.Builder().nutrition(2).saturationModifier(0.3f).alwaysEdible().fast().build()))")
  expect(java).toContain("FuelRegistry.INSTANCE.add(ITEM_COAL, 2400);")
  expect(java).toContain("FuelRegistry.INSTANCE.add(BLOCK_ITEM_PILE, 16000);")
  // Each goes to the creative tab a player looks for it in, and only there.
  const tab = (name: string) => new RegExp(`CreativeModeTabs\\.${name}\\)\\.register\\(entries -> \\{\\n([^}]*)\\}`).exec(java)![1]!
  expect(tab("INGREDIENTS")).toMatch(/ITEM_INGOT[\s\S]*ITEM_COAL/)
  expect(tab("INGREDIENTS")).not.toMatch(/PICK|BLADE|CANDY/)
  expect(tab("TOOLS_AND_UTILITIES")).toContain("ITEM_PICK")
  expect(tab("COMBAT")).toContain("ITEM_BLADE")
  expect(tab("FOOD_AND_DRINKS")).toContain("ITEM_CANDY")
  const model = (identifier: string) => JSON.parse(String(built[`src/main/resources/assets/azure/models/item/${identifier}.json`])) as { parent: string }
  expect(model("pick").parent).toBe("minecraft:item/handheld")
  expect(model("blade").parent).toBe("minecraft:item/handheld")
  expect(model("candy").parent).toBe("minecraft:item/generated")
  expect(JSON.parse(String(built["src/main/resources/data/minecraft/tags/item/pickaxes.json"]))).toEqual({ replace: false, values: ["azure:pick"] })
  expect(JSON.parse(String(built["src/main/resources/data/minecraft/tags/item/swords.json"]))).toEqual({ replace: false, values: ["azure:blade"] })
  expect(Object.keys(built).filter((name) => name.includes("tags/item"))).toHaveLength(2)
  expect(JSON.parse(String(built["src/main/resources/assets/azure/lang/en_us.json"]))).toMatchObject({ "item.azure.pick": "Azure Pickaxe", "item.azure.ingot": "Azure Ingot", "item.azure.candy": "蓝晶糖" })
  expect(JSON.parse(String(built["src/main/resources/assets/azure/lang/zh_cn.json"]))).toMatchObject({ "item.azure.pick": "蓝晶镐" })
})

test.skipIf(!HAS_GAME_DATA)("every item, tag, model parent and tool tag in the vocabulary is the game's own", () => {
  const listing = vanillaFiles()
  const names = new Set(listing)
  // Every item id has a model in the jar, and there are as many as the game registers.
  Object.keys(VANILLA_ITEM_NAMES).forEach((id) => expect(names.has(`assets/minecraft/models/item/${id}.json`) ? "" : id).toBe(""))
  expect(Object.keys(VANILLA_ITEM_NAMES)).toHaveLength(1332)
  expect(VANILLA_ITEM_NAMES).toMatchObject({ stick: "木棍", iron_ingot: "铁锭", netherite_upgrade_smithing_template: "锻造模板" })
  expect([...MINECRAFT_ITEM_TAGS].sort()).toEqual(listing.flatMap((name) => /^data\/minecraft\/tags\/item\/(.+)\.json$/.exec(name)?.[1] ?? []).sort())
  expect(CONVENTION_ITEM_TAGS.has("ingots/iron")).toBe(true)
  Object.values(TOOL_KINDS).forEach((kind) => expect(names.has(`data/minecraft/tags/item/${kind.tag}.json`)).toBe(true))
  expect(vanillaJson("assets/minecraft/models/item/iron_pickaxe.json")).toMatchObject({ parent: "minecraft:item/handheld" })
  expect(vanillaJson("assets/minecraft/models/item/iron_sword.json")).toMatchObject({ parent: "minecraft:item/handheld" })
  // A tool in these tags can take the enchantments of its kind.
  expect(JSON.stringify(vanillaJson("data/minecraft/tags/item/enchantable/sword.json"))).toContain("#minecraft:swords")
  expect(JSON.stringify(vanillaJson("data/minecraft/tags/item/enchantable/mining.json"))).toContain("#minecraft:pickaxes")
})

test.skipIf(!hasTargetJavac("fabric-1.21.1-official"))("every tool class, mining level and block sound in the vocabulary is real, and the sample chain compiles whole", async () => {
  const root = await temporary()
  await mkdir(path.join(root, "vocabulary"))
  await writeFile(
    path.join(root, "vocabulary", "Vocabulary.java"),
    `import net.minecraft.tags.BlockTags; import net.minecraft.tags.TagKey; import net.minecraft.world.item.Item; import net.minecraft.world.item.Tier; import net.minecraft.world.level.block.Block; import net.minecraft.world.level.block.SoundType;
${[...new Set(Object.values(TOOL_KINDS).map((kind) => kind.java))].map((name) => `import net.minecraft.world.item.${name};`).join(" ")}
final class Vocabulary {
    static final java.util.List<TagKey<Block>> LEVELS = java.util.List.of(${Object.values(MINING_LEVELS).map((level) => `BlockTags.${level.tag}`).join(", ")});
    static Item[] tools(Tier material) { return new Item[] { ${Object.values(TOOL_KINDS).map((kind) => `new ${kind.java}(material, new Item.Properties().attributes(${kind.java}.createAttributes(material, 0, 0f)))`).join(", ")} }; }
    static final SoundType[] SOUNDS = { ${Object.values(SOUND_TYPES).map((name) => `SoundType.${name}`).join(", ")} };
}
`,
  )
  const vocabulary = await targetJavac("fabric-1.21.1-official", path.join(root, "vocabulary"))
  expect(vocabulary.output).not.toContain("error")
  expect(vocabulary.code).toBe(0)
  const directory = path.join(root, "project")
  await createDataGameplaySample(directory, { chain: true })
  const source = path.join(root, "source")
  await mkdir(source)
  await assembleBuildSource(directory, source, TEMPLATE)
  const compiled = (await compileTreeFor("fabric-1.21.1-official", source))!
  expect(compiled.output).not.toContain("error")
  expect(compiled.code).toBe(0)
  const written = (await readdir(source, { recursive: true })).map((name) => name.replaceAll(path.sep, "/"))
  expect(written.filter((name) => name.includes("data/azure_sample/recipe/"))).toHaveLength(9)
  expect(written).toContain("src/main/java/com/minemods/content_azure_sample/StudioToolMaterial.java")
  expect(written).toContain("src/main/resources/data/minecraft/tags/item/swords.json")
  expect(JSON.parse(await readFile(path.join(source, "src/main/resources/assets/azure_sample/lang/en_us.json"), "utf8"))).toMatchObject({ "item.azure_sample.azure_sword": "Azure Sword", "block.azure_sample.azure_ingot_block": "Block of Azure" })
}, 180000)

// ---- the answers a block, an item and a recipe give to the playability questions ----

const answers = (facets: Facet[], question: Facet["question"]) => facets.filter((facet) => facet.question === question)

async function chainProject() {
  const root = await temporary()
  return createDataGameplaySample(path.join(root, "project"), { chain: true })
}
const block = (project: Project, identifier: string) => project.blocks.find((value) => value.identifier === identifier)!
const item = (project: Project, identifier: string) => project.items.find((value) => value.identifier === identifier)!

test("where a thing comes from and what it is for are read from the whole project", async () => {
  const project = await chainProject()
  const ore = blockFacets(block(project, "azure_ore"), project)
  // The world gives the ore by itself; everything after it goes through something.
  expect(answers(ore, "source")).toEqual([{ question: "source", answered: true, words: "在主世界 Y −16 到 48 的石头、深板岩里生成（越靠中间越多），每个区块约 8 团，每团最多 6 块", through: [] }])
  expect(answers(ore, "use").map((facet) => facet.words)).toContain("挖掉它能得到「蓝晶碎片」")
  const [reaction] = answers(ore, "reaction")
  expect(reaction).toMatchObject({ answered: true })
  expect(reaction!.words).toContain("至少要用铁镐才挖得下来")
  // The mod's own pickaxe is of the iron level, so it is named as what mines the ore.
  expect(reaction!.words).toContain("本模组的「蓝晶镐」挖得动")
  expect(reaction!.words).toContain("挖掉会给 2–5 点经验")
  expect(answers(ore, "idle")).toEqual([])

  const shard = itemFacets(item(project, "azure_shard"), project)
  expect(answers(shard, "source")).toEqual([{ question: "source", answered: true, words: "挖掉「蓝晶矿石」会掉 1–2 个", through: ["azure_ore"] }])
  expect(answers(shard, "use").map((facet) => facet.words)).toEqual(["是在工作台做「蓝晶块」的材料", "是在熔炉做「蓝晶锭」的材料", "是在高炉做「蓝晶锭」的材料", "是在工作台做「蓝晶糖」的材料"])

  const ingot = itemFacets(item(project, "azure_ingot"), project)
  expect(answers(ingot, "source").map((facet) => [facet.words, facet.through])).toEqual([
    ["在熔炉里把「蓝晶碎片」烧 10 秒，得到 1 个「蓝晶锭」，给 0.7 点经验", ["azure_shard"]],
    ["在高炉里把「蓝晶碎片」烧 5 秒，得到 1 个「蓝晶锭」，给 0.7 点经验", ["azure_shard"]],
    ["在工作台上放进 1 个「蓝晶锭块」（怎么摆都行），做出 9 个「蓝晶锭」", ["azure_ingot_block"]],
  ])
  expect(answers(ingot, "use").map((facet) => facet.words)).toEqual(expect.arrayContaining(["是在工作台做「蓝晶镐」的材料", "在铁砧上用它修「蓝晶剑」"]))

  const pickaxe = itemFacets(item(project, "azure_pickaxe"), project)
  // Vanilla things are said by their Chinese names, a tag as any of its kind.
  expect(answers(pickaxe, "source")[0]!.words).toBe("在工作台上按配方的格子摆放 3 个「蓝晶锭」和 2 个木棍，做出 1 个「蓝晶镐」")
  expect(answers(itemFacets(item(project, "azure_sword"), project), "source")[0]!.words).toBe("在工作台上按配方的格子摆放 2 个「蓝晶锭」和 1 个任意木棍，做出 1 个「蓝晶剑」")
  expect(answers(pickaxe, "use")[0]!.words).toBe("是一把镐：能用 320 次，拿着打一下 4 点伤害，挖得动钻石矿这一档，和铁镐一样，可以附魔，在铁砧上用「蓝晶锭」修；挖得动本模组的「蓝晶矿石」、「蓝晶块」、「余烬石」、「蓝晶锭块」")
  expect(answers(itemFacets(item(project, "azure_candy"), project), "use").map((facet) => facet.words)).toEqual(["能吃：补 2 点饥饿（1 格鸡腿），不饿也能吃，吃得很快"])
  expect(answers(itemFacets(item(project, "ember_coal"), project), "use").map((facet) => facet.words)).toEqual(["能当燃料：一个能烧 120 秒，够熔炉烧 12 个东西"])
  // Everything in the chain has an answer to every question asked of its kind, and none is longer than a card line.
  const all = [...project.blocks.map((value) => blockFacets(value, project)), ...project.items.map((value) => itemFacets(value, project))].flat()
  expect(all.filter((facet) => !facet.answered)).toEqual([])
  all.forEach((facet) => expect(facet.words.length).toBeLessThanOrEqual(160))

  const smelt = project.recipes.find((value) => value.type === "smelting")!
  expect(recipeFacets(smelt, project)).toEqual([
    { question: "source", answered: true, words: "在熔炉里把「蓝晶碎片」烧 10 秒，得到 1 个「蓝晶锭」，给 0.7 点经验", detail: "minecraft:smelting", through: ["azure_shard"] },
    { question: "use", answered: true, words: "做出来的是「蓝晶锭」", through: ["azure_ingot"] },
  ])
})

test("a thing with no way to it, or nothing after it, says so instead of answering", async () => {
  const project = await chainProject()
  const bare: Project = { ...project, recipes: [], blocks: project.blocks.map((value) => ({ ...value, generation: null, drop: "self" as const, drop_item: null, experience: null, luminance: 0 })), items: project.items.map((value) => ({ ...value, tool: null, food: null, fuel: null })) }
  expect(blockFacets(block(bare, "azure_ore"), bare).map((facet) => [facet.question, facet.answered])).toEqual([["source", false], ["use", true], ["reaction", true]])
  // broad3: a block is always something to build with, so a bare block's use is that and nothing is called missing.
  expect(answers(blockFacets(block(bare, "azure_ore"), bare), "use")).toEqual([{ question: "use", answered: true, words: "能放下来盖房子、铺地或者当摆设" }])
  expect(blockFacets(block(bare, "azure_ore"), bare)[0]!.words).toContain("只能在创造模式物品栏里拿到")
  expect(itemFacets(item(bare, "azure_sword"), bare)).toEqual([
    { question: "source", answered: false, words: "没有配方，也没有方块或生物掉它：只能在创造模式物品栏里拿到" },
    { question: "use", answered: false, words: "还没有任何用处：没有读到配方、装备、技能、召唤或其他玩法用处" },
  ])
  // A recipe that makes a thing out of itself is no way to it and no use of it.
  const loop: Project = { ...bare, recipes: [{ id: ID(900), name: "自己做自己", pattern: slots(`${bare.mod_id}:azure_ingot`), result: `${bare.mod_id}:azure_ingot`, count: 2 }] }
  expect(answers(itemFacets(item(loop, "azure_ingot"), loop), "source")).toEqual([{ question: "source", answered: true, words: "在工作台上按配方的格子摆放 1 个「蓝晶锭」，做出 2 个「蓝晶锭」", detail: `recipe ${ID(900)} (minecraft:crafting_shaped)`, through: [] }])
  expect(answers(itemFacets(item(loop, "azure_ingot"), loop), "use")).toEqual([{ question: "use", answered: false, words: "还没有任何用处：没有读到配方、装备、技能、召唤或其他玩法用处" }])
  // broad10 w2: a thing a follower is lured by (its tempt, written bare like loot) is used for that, not called useless.
  const mouse = EntitySchema.parse({ id: "11111111-1111-4111-8111-111111111111", name: "小老鼠", description: "", health: 8, speed: 0.25, attack_damage: 0, behavior: "follow", model_asset_id: null, tempt: ["azure_sword"] })
  const lured: Project = { ...bare, entities: [mouse] }
  expect(answers(itemFacets(item(lured, "azure_sword"), lured), "use")).toEqual([{ question: "use", answered: true, words: "拿在手里，「小老鼠」会跟着你走" }])
})

test("recipes and natures are said in plain words, the same wherever they are shown", () => {
  const said = (reference: string) => referenceWords(reference, "azure", (identifier) => ({ shard: "蓝晶碎片", ingot: "蓝晶锭", pick: "蓝晶镐" })[identifier] ?? null)
  expect(said("azure:shard")).toBe("「蓝晶碎片」")
  expect(said("minecraft:iron_ingot")).toBe("铁锭")
  expect(said("#minecraft:planks")).toBe("任意木板")
  expect(said("#minecraft:beds")).toBe("任意带 #minecraft:beds 标签的物品")
  const words = Object.fromEntries(KINDS.map(([kind, value]) => [kind, contentWords.recipe(value, said)]))
  expect(words).toEqual({
    shaped: "在工作台上按配方的格子摆放 3 个「蓝晶锭」、1 个任意木板和 1 个木棍，做出 1 个「蓝晶镐」",
    shapeless: "在工作台上放进 1 个「蓝晶碎片」和 1 个糖（怎么摆都行），做出 2 个「candy」",
    smelting: "在熔炉里把「蓝晶碎片」烧 10 秒，得到 1 个「蓝晶锭」，给 0.7 点经验",
    blasting: "在高炉里把「蓝晶碎片」烧 5 秒，得到 1 个「蓝晶锭」，给 0.7 点经验",
    smoking: "在烟熏炉里把生牛肉熏 5 秒，得到 1 个「candy」",
    campfire: "放在营火上把任意原木烤 30 秒，得到 1 个木炭",
    stonecutting: "在切石机里把 1 个石头切成 4 个「蓝晶碎片」",
    smithing: "在锻造台上放上锻造模板、「蓝晶镐」和下界合金锭，把「蓝晶镐」升级成下界合金镐（原来的附魔会留着）",
  })
  expect(connectionChain("azure").recipes.every((value) => RecipeSchema.safeParse(value).success)).toBe(true)
})
