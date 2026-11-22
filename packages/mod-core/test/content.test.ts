import { expect, test } from "bun:test"
import { compileContent, ContentSchema, validateContent } from "../src/content"

const block = {
  id: "11111111-1111-4111-8111-111111111111",
  identifier: "copper_lamp",
  name: "铜纹灯",
  hardness: 1.5,
  luminance: 12,
  tool: "pickaxe" as const,
  drop: "self" as const,
  color: "#c77a45",
}
const item = {
  id: "22222222-2222-4222-8222-222222222222",
  identifier: "copper_ingot",
  name: "铜锭",
  max_stack: 64,
  color: "#c77a45",
}
const recipe = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "铜纹灯",
  pattern: [
    "minecraft:copper_ingot", "minecraft:copper_ingot", "minecraft:copper_ingot",
    "minecraft:copper_ingot", "minecraft:redstone", "minecraft:copper_ingot",
    "minecraft:copper_ingot", "minecraft:copper_ingot", "minecraft:copper_ingot",
  ],
  result: "copper_aviary:copper_lamp",
  count: 1,
}

const valid = {
  mod_id: "copper_aviary",
  package_name: "com.minemods.copper_aviary",
  entities: [{ id: "44444444-4444-4444-8444-444444444444" }],
  blocks: [block],
  items: [item],
  recipes: [recipe],
  logic: [{
    id: "55555555-5555-4555-8555-555555555555",
    entity_id: "44444444-4444-4444-8444-444444444444",
    trigger: "holding_item" as const,
    action: "play_animation" as const,
    item: "copper_aviary:copper_ingot",
    animation: "idle",
    enabled: true,
  }],
}

test("validates content references while allowing reversible recipe references", () => {
  const reversible = { ...valid, recipes: [{ ...recipe, pattern: ["copper_aviary:copper_lamp", null, null, null, null, null, null, null, null], result: "copper_aviary:copper_ingot" }] }
  expect(validateContent(reversible).recipes).toHaveLength(1)
  expect(() => validateContent({ ...valid, recipes: [{ ...recipe, result: "copper_aviary:missing" }] })).toThrow(/reference|引用/i)
  expect(() => validateContent({ ...valid, blocks: [block, { ...block, id: "66666666-6666-4666-8666-666666666666" }] })).toThrow(/identifier|重复/i)
})

test("rejects malformed values and unsupported logic combinations", () => {
  expect(() => ContentSchema.parse({ ...valid, blocks: [{ ...block, luminance: 16 }] })).toThrow()
  expect(() => validateContent({ ...valid, logic: [{ ...valid.logic[0], item: undefined }] })).toThrow(/item|物品/i)
  expect(() => validateContent({ ...valid, logic: [{ ...valid.logic[0], trigger: "player_near", item: "minecraft:stick" }] })).toThrow(/trigger|触发/i)
})

test("compiles deterministic block, item, recipe, loot table, texture, and logic files", () => {
  const first = compileContent(valid)
  const second = compileContent(valid)
  expect(Object.keys(first)).toEqual(Object.keys(second))
  expect(Buffer.from(first["src/main/resources/assets/copper_aviary/textures/block/copper_lamp.png"] as Uint8Array)).toEqual(
    Buffer.from(second["src/main/resources/assets/copper_aviary/textures/block/copper_lamp.png"] as Uint8Array),
  )
  expect(Object.keys(first)).toContain("src/main/resources/assets/copper_aviary/blockstates/copper_lamp.json")
  expect(Object.keys(first)).toContain("src/main/resources/assets/copper_aviary/models/item/copper_ingot.json")
  expect(Object.keys(first)).toContain(`src/main/resources/data/copper_aviary/recipe/${recipe.id}.json`)
  expect(Object.keys(first)).toContain("src/main/resources/data/copper_aviary/loot_table/blocks/copper_lamp.json")
  expect(String(first["src/main/java/com/minemods/copper_aviary/StudioContentRegistry.java"])).toContain("Registry.register")
  expect(String(first["src/main/java/com/minemods/copper_aviary/StudioContentRegistry.java"])).toContain("static void register()")
  expect(first["src/main/java/com/minemods/copper_aviary/StudioLogicHooks.java"]).toBeUndefined()
})

test("Minecraft 1.21 resources retain multiple recipes, mining tags and names", () => {
  const other = { ...recipe, id: "66666666-6666-4666-8666-666666666666", pattern: ["minecraft:diamond", null, null, null, null, null, null, null, null] }
  const files = compileContent({ ...valid, recipes: [recipe, other] })
  expect(Object.keys(files).filter(file => file.includes("/recipe/"))).toHaveLength(2)
  expect(JSON.parse(String(files["src/main/resources/data/minecraft/tags/block/mineable/pickaxe.json"])).values).toContain("copper_aviary:copper_lamp")
  expect(JSON.parse(String(files["src/main/resources/assets/copper_aviary/lang/zh_cn.json"]))["block.copper_aviary.copper_lamp"]).toBe("铜纹灯")
  expect(String(files["src/main/java/com/minemods/copper_aviary/StudioContentRegistry.java"])).toContain("ItemGroupEvents.modifyEntriesEvent")
  expect(() => compileContent({ ...valid, recipes: [{ ...recipe, pattern: Array(9).fill(null) }] })).toThrow()
})
