import { expect, test } from "bun:test"
import { CreatureLootSchema } from "../src/entity-runtime"
import { creatureLootTable } from "../src/fabric/entity"

/** epic game1: "打败它掉一颗冰霜龙心" dropped seven hearts from three dragons under Looting III: a boss's trophy is the count that was asked for. */

const heart = CreatureLootSchema.parse({ item: "frost_heart", min: 1, max: 1, chance: 1, player_only: false })
const functions = (table: ReturnType<typeof creatureLootTable>) => table.pools[0]!.entries[0]!.functions.map((value) => value.function)

test("a creature's drop grows with Looting as before; a boss's drop does not, unless it says so", () => {
  expect(functions(creatureLootTable("m", "beast", [heart]))).toEqual(["minecraft:set_count", "minecraft:enchanted_count_increase"])
  expect(functions(creatureLootTable("m", "dragon", [heart], true))).toEqual(["minecraft:set_count"])
  expect(functions(creatureLootTable("m", "dragon", [{ ...heart, looting: true }], true))).toEqual(["minecraft:set_count", "minecraft:enchanted_count_increase"])
  expect(functions(creatureLootTable("m", "beast", [{ ...heart, looting: false }]))).toEqual(["minecraft:set_count"])
  // A drop that says nothing is the drop it always was.
  expect("looting" in heart).toBe(false)
})
