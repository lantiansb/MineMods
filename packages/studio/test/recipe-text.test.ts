import { describe, expect, test } from "bun:test"
import { resolveRecipeItem } from "../src/renderer/features/recipe-text"

const items = [
  { id: "minecraft:copper_ingot", name: "铜锭" },
  { id: "minecraft:redstone", name: "红石" },
  { id: "copper_aviary:lamp", name: "铜灯" },
  { id: "other:lamp", name: "铜灯" },
]

describe("text recipe item resolution", () => {
  test("resolves a unique Chinese name", () => expect(resolveRecipeItem(" 铜锭 ", items)).toEqual({ value: "minecraft:copper_ingot" }))
  test("accepts exact namespaced IDs outside the suggestion list", () => expect(resolveRecipeItem("minecraft:ancient_debris", items)).toEqual({ value: "minecraft:ancient_debris" }))
  test("turns whitespace into an empty slot", () => expect(resolveRecipeItem("   ", items)).toEqual({ value: null }))
  test("rejects unknown names without inventing an ID", () => {
    const result = resolveRecipeItem("不存在的材料", items)
    expect(result.error).toContain("不存在的材料")
    expect(result).not.toHaveProperty("value")
  })
  test("rejects ambiguous names and asks for a full ID", () => expect(resolveRecipeItem("铜灯", items).error).toContain("多个来源"))
  test("uses a full ID to resolve an ambiguous item", () => expect(resolveRecipeItem("other:lamp", items)).toEqual({ value: "other:lamp" }))
})
