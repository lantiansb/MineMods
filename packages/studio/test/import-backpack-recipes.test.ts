import { describe, expect, test } from "bun:test"
import { describeTag, readLoot, readPart, readRecipe } from "../src/renderer/features/import-backpack-recipes"

describe("backpack recipes", () => {
  test("lays a shaped recipe into a 3×3 grid and reads both result spellings", () => {
    const view = readRecipe({
      type: "minecraft:crafting_shaped",
      pattern: ["#", "S"],
      key: { "#": { item: "mod:plank" }, S: "#minecraft:planks" },
      result: { id: "mod:pillar", count: 2 },
    })!
    expect(view.layout).toBe("grid")
    expect(view.cells).toHaveLength(9)
    expect(view.cells[0]).toMatchObject({ id: "mod:plank", tag: false })
    expect(view.cells[3]).toMatchObject({ id: "minecraft:planks", tag: true })
    expect(view.result).toMatchObject({ id: "mod:pillar", count: 2 })
    expect(readRecipe({ type: "crafting_shapeless", ingredients: [{ tag: "c:paper" }], result: "mod:book" })).toMatchObject({
      free: true,
      result: { id: "mod:book", count: 1 },
    })
  })
  test("names the station and time of cooking recipes", () => {
    expect(
      readRecipe({ type: "minecraft:blasting", cookingtime: 100, ingredient: [{ item: "a:ore" }, { item: "a:raw" }], result: "a:ingot" }),
    ).toMatchObject({ layout: "single", station: "高炉", seconds: 5, inputs: [{ id: "a:ore", others: 1 }] })
    expect(readRecipe({ type: "minecraft:stonecutting", ingredient: { item: "a:stone" }, result: "a:slab", count: 2 })).toMatchObject({
      station: "切石机",
      result: { count: 2 },
    })
  })
  test("unwraps conditional recipes and falls back for a mod's own types", () => {
    const wrapped = { type: "forge:conditional", recipes: [{ conditions: [], recipe: { type: "minecraft:smelting", ingredient: "a:b", result: "a:c" } }] }
    expect(readRecipe(wrapped)).toMatchObject({ station: "熔炉", result: { id: "a:c" } })
    expect(readRecipe({ type: "mod:press", "neoforge:conditions": [], input: { tag: "c:ingots/iron" }, output: { id: "mod:plate" } })).toMatchObject({
      layout: "row",
      inputs: [{ id: "c:ingots/iron", tag: true }],
      result: { id: "mod:plate" },
    })
    expect(readRecipe({ type: "mod:special" })).toBeNull()
    expect(readRecipe({ type: "smithing_transform", template: { item: "a:t" }, base: { item: "a:b" }, addition: { item: "a:c" }, result: { item: "a:d" } })).toMatchObject({ layout: "smithing", inputs: [{ id: "a:t" }, { id: "a:b" }, { id: "a:c" }] })
  })
  test("rejects ids that are not plain resource names", () => {
    expect(readPart("minecraft:../secret")).toBeNull()
    expect(readPart({ item: "Bad Id" })).toBeNull()
  })
  test("collects drops through nested entries with their count range", () => {
    const drops = readLoot({
      pools: [
        {
          entries: [
            {
              type: "minecraft:alternatives",
              children: [
                { type: "minecraft:item", name: "a:fur", functions: [{ function: "minecraft:set_count", count: { min: 0, max: 2 } }] },
                { type: "minecraft:item", name: "a:bone" },
              ],
            },
          ],
        },
      ],
    })
    expect(drops).toEqual([
      { id: "a:fur", tag: false, count: 1, others: 0, min: 0, max: 2 },
      { id: "a:bone", tag: false, count: 1, others: 0, min: 1, max: 1 },
    ])
  })
  test("gives tags a friendly name", () => {
    const names = { "minecraft:iron_ingot": "铁锭", "minecraft:oak_planks": "橡木木板", "minecraft:white_bed": "白色床", "minecraft:red_bed": "红色床" }
    expect(describeTag("minecraft:planks", names)).toEqual({ name: "任意木板", sample: "minecraft:oak_planks" })
    expect(describeTag("forge:ingots/iron", names)).toEqual({ name: "任意铁锭", sample: "minecraft:iron_ingot" })
    expect(describeTag("minecraft:beds", names)).toEqual({ name: "任意床", sample: "minecraft:white_bed" })
    expect(describeTag("mod:ingots/fiery", names, (name) => (name === "fiery_ingot" ? { id: "mod:fiery_ingot", name: "炽铁锭" } : undefined))).toEqual({ name: "任意炽铁锭", sample: "mod:fiery_ingot" })
    expect(describeTag("mod:odd_things", names)).toEqual({ name: "任意 Odd Things", sample: null })
  })
})
