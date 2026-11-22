import { describe, expect, test } from "bun:test"
import {
  canCraft,
  craft,
  collectMatching,
  dragEven,
  dragOneEach,
  initialRecipeState,
  leftClick,
  rightClick,
  shiftTransfer,
  hotbarSwap,
  type RecipeState,
} from "../src/renderer/features/recipe-state"

const items = [
  { id: "minecraft:copper_ingot", name: "铜锭" },
  { id: "minecraft:redstone", name: "红石" },
  { id: "copper_lamp", name: "铜纹灯" },
]

const stateWith = (slots: (string | null)[], counts: number[], cursor: string | null = null): RecipeState => ({
  stencil: Array(9).fill(null),
  inventory: Array.from({ length: 36 }, (_, index) => slots[index] ? { id: slots[index]!, count: counts[index] ?? 0 } : null),
  cursor: cursor ? { id: cursor, count: 1 } : null,
})

describe("recipe stack interactions", () => {
  test("left click picks up and merges a matching stack", () => {
    const result = leftClick(stateWith(["a", "a"], [3, 60]), "inventory", 0)
    expect(result.cursor).toEqual({ id: "a", count: 3 })
    expect(result.inventory[0]).toBeNull()
    expect(leftClick(result, "inventory", 1).inventory[1]).toEqual({ id: "a", count: 63 })
  })

  test("right click splits half and places one", () => {
    const picked = rightClick(stateWith(["a"], [5]), "inventory", 0)
    expect(picked.cursor).toEqual({ id: "a", count: 3 })
    expect(picked.inventory[0]).toEqual({ id: "a", count: 2 })
    const placed = rightClick(picked, "inventory", 1)
    expect(placed.inventory[1]).toEqual({ id: "a", count: 1 })
    expect(placed.cursor).toEqual({ id: "a", count: 2 })
  })

  test("left drag evenly distributes odd stacks and preserves remainder", () => {
    const state = stateWith(["a", null, null], [7, 0, 0])
    const picked = leftClick(state, "inventory", 0)
    const result = dragEven(picked, "inventory", [1, 2])
    expect(result.inventory.slice(1, 3)).toEqual([{ id: "a", count: 3 }, { id: "a", count: 3 }])
    expect(result.cursor).toEqual({ id: "a", count: 1 })
  })

  test("right drag places one per repeated slot", () => {
    const result = dragOneEach(leftClick(stateWith(["a", null, null], [3, 0, 0]), "inventory", 0), "inventory", [1, 2])
    expect(result.inventory.slice(1, 3)).toEqual([{ id: "a", count: 1 }, { id: "a", count: 1 }])
    expect(result.cursor).toEqual({ id: "a", count: 1 })
  })

  test("shift transfer moves a stack into the other inventory section", () => {
    const result = shiftTransfer(stateWith(["a", null, null], [12, 0, 0]), "inventory", 0)
    expect(result.inventory[0]).toBeNull()
    expect(result.inventory[27]).toEqual({ id: "a", count: 12 })
  })

  test("number keys swap inventory and hotbar slots", () => {
    const state = stateWith(Array(36).fill(null), Array(36).fill(0))
    state.inventory[0] = { id: "a", count: 2 }
    state.inventory[27] = { id: "b", count: 1 }
    expect(hotbarSwap(state, 1).inventory.slice(0, 1)).toEqual([{ id: "b", count: 1 }])
    expect(hotbarSwap(state, 1).inventory[27]).toEqual({ id: "a", count: 2 })
  })

  test("craft validates the stencil and consumes one recipe per output", () => {
    const state = stateWith(["minecraft:copper_ingot", "minecraft:redstone"], [8, 1])
    state.stencil = ["minecraft:copper_ingot", "minecraft:copper_ingot", "minecraft:copper_ingot", "minecraft:copper_ingot", "minecraft:redstone", "minecraft:copper_ingot", "minecraft:copper_ingot", "minecraft:copper_ingot", "minecraft:copper_ingot"]
    expect(canCraft(state, items[2].id)).toBe(true)
    const crafted = craft(state, items[2].id)
    expect(crafted.inventory.filter((stack) => stack?.id === "minecraft:copper_ingot").reduce((sum, stack) => sum + (stack?.count ?? 0), 0)).toBe(0)
    expect(crafted.inventory.filter((stack) => stack?.id === "minecraft:redstone").reduce((sum, stack) => sum + (stack?.count ?? 0), 0)).toBe(0)
    expect(crafted.inventory.some((stack) => stack?.id === items[2].id && stack.count === 1)).toBe(true)
  })

  test("stencil stays independent from the saved draft pattern", () => {
    const saved = ["a", null, null, null, null, null, null, null, null]
    const state = initialRecipeState({ pattern: saved })
    state.stencil[0] = "b"
    expect(saved[0]).toBe("a")
    expect(state.stencil[0]).toBe("b")
  })

  test("single item right click puts the one item in hand", () => {
    const picked = rightClick(stateWith(["a"], [1]), "inventory", 0)
    expect(picked.inventory[0]).toBeNull()
    expect(picked.cursor).toEqual({ id: "a", count: 1 })
  })

  test("double click collects matching stacks up to one full cursor", () => {
    const state = stateWith(["a", "b", "a"], [20, 1, 60])
    const result = collectMatching(state, "inventory", 0)
    expect(result.cursor).toEqual({ id: "a", count: 64 })
    expect(result.inventory[0]).toBeNull()
    expect(result.inventory[2]).toEqual({ id: "a", count: 16 })
  })

  test("craft preserves the state when requested output exceeds capacity", () => {
    const state = stateWith(Array(36).fill("a"), Array(36).fill(64))
    state.stencil[0] = "a"
    expect(craft(state, "result", 4)).toBe(state)
  })

  test("craft can use the slot freed by consuming the last ingredient", () => {
    const state = stateWith(Array(36).fill("filler"), Array(36).fill(64))
    state.inventory[0] = { id: "ingredient", count: 1 }
    state.stencil[0] = "ingredient"
    expect(canCraft(state, "result")).toBe(true)
    expect(craft(state, "result").inventory[0]).toEqual({ id: "result", count: 1 })
    expect(state.inventory[0]).toEqual({ id: "ingredient", count: 1 })
  })

  test("double click collects the held material without overwriting another kind", () => {
    const state = stateWith(["a", "b", "a"], [20, 3, 4])
    state.cursor = { id: "b", count: 2 }
    const result = collectMatching(state, "inventory", 0)
    expect(result.cursor).toEqual({ id: "b", count: 5 })
    expect(result.inventory[0]).toEqual({ id: "a", count: 20 })
    expect(result.inventory[2]).toEqual({ id: "a", count: 4 })
  })
})
