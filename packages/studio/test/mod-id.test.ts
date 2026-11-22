import { expect, test } from "bun:test"
import { chosenModId, deriveModId, modIdProblem, MOD_ID_PATTERN, MOD_ID_WORDS } from "../src/mod-id"
import { ADVANCED_STORE, advanced, readAdvanced, setAdvanced, writeAdvanced } from "../src/renderer/advanced"

test("模组 ID 跟着工程名自动起：英文字母和数字留下，别的连成一个下划线", () => {
  expect(deriveModId("Copper Aviary")).toBe("copper_aviary")
  expect(deriveModId("  GPT-6 铜羽工坊  ")).toBe("gpt_6")
  expect(deriveModId("__Moon -- Mist!!")).toBe("moon_mist")
  // Full-width letters and accents fold to plain ones, as mod-core's own default does.
  expect(deriveModId("Ｃａｆé")).toBe("cafe")
  // An id starts with a letter.
  expect(deriveModId("3D 工坊")).toBe("mod_3d")
})

test("模组 ID：纯中文的工程名得到 mod_ 加一段固定的短码，同名同码，不同名不同码", () => {
  const id = deriveModId("赤铜飞行社")
  expect(id).toMatch(/^mod_[0-9a-z]{7}$/)
  expect(deriveModId("赤铜飞行社")).toBe(id)
  expect(deriveModId(" 赤铜飞行社 ")).toBe(id)
  expect(deriveModId("月雾模组")).not.toBe(id)
  // One usable character is not a name either: Fabric Loader refuses an id of a single character.
  expect(deriveModId("铜 A")).toMatch(/^mod_[0-9a-z]{7}$/)
  expect(deriveModId("7")).toMatch(/^mod_[0-9a-z]{7}$/)
})

test("模组 ID：自动起的名字总是合规，再长也截到 64 个字符且不以下划线结尾", () => {
  for (const name of ["a", "ab", "赤铜", "9 lives", "x".repeat(120), `${"a".repeat(63)} b`, `1${"z".repeat(119)}`, "!!!", "A_B", "é"]) {
    const id = deriveModId(name)
    expect(id).toMatch(MOD_ID_PATTERN)
    expect(id.endsWith("_")).toBe(false)
  }
  expect(deriveModId("x".repeat(120))).toHaveLength(64)
  expect(deriveModId(`${"a".repeat(63)} b`)).toBe("a".repeat(63))
})

test("模组 ID：自己写的名字不合规时用白话说哪里不对，留空就用自动起的", () => {
  expect(modIdProblem("copper_aviary")).toBe("")
  expect(modIdProblem("a")).toBe(MOD_ID_WORDS.short)
  expect(modIdProblem("9lives")).toBe(MOD_ID_WORDS.start)
  expect(modIdProblem("_x")).toBe(MOD_ID_WORDS.start)
  expect(modIdProblem("Copper")).toBe(MOD_ID_WORDS.characters)
  expect(modIdProblem("铜羽")).toBe(MOD_ID_WORDS.characters)
  expect(modIdProblem("a b")).toBe(MOD_ID_WORDS.characters)
  expect(modIdProblem("a".repeat(65))).toBe(MOD_ID_WORDS.long)
  expect(chosenModId("赤铜飞行社", null)).toBe(deriveModId("赤铜飞行社"))
  expect(chosenModId("赤铜飞行社", "  ")).toBe(deriveModId("赤铜飞行社"))
  expect(chosenModId("赤铜飞行社", " copper_aviary ")).toBe("copper_aviary")
})

const memory = (start: Record<string, string> = {}) => {
  const values = new Map(Object.entries(start))
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) }
}
const broken = {
  getItem: (): string | null => {
    throw new Error("blocked")
  },
  setItem: () => {
    throw new Error("full")
  },
}

test("「高级」开关：默认关，记在一个键里，重开以后还是原样", () => {
  expect(readAdvanced(memory())).toBe(false)
  expect(readAdvanced(memory({ [ADVANCED_STORE]: "1" }))).toBe(true)
  expect(readAdvanced(memory({ [ADVANCED_STORE]: "0" }))).toBe(false)
  expect(readAdvanced(memory({ [ADVANCED_STORE]: "yes" }))).toBe(false)
  const store = memory()
  writeAdvanced(true, store)
  expect([...store.values]).toEqual([[ADVANCED_STORE, "1"]])
  expect(readAdvanced(store)).toBe(true)
  writeAdvanced(false, store)
  expect(readAdvanced(store)).toBe(false)
})

test("「高级」开关：存不了、读不了也不出错，只是不记得；一处切换，处处读到同一个值", () => {
  expect(readAdvanced(broken)).toBe(false)
  expect(() => writeAdvanced(true, broken)).not.toThrow()
  expect(readAdvanced(undefined)).toBe(false)
  const store = memory()
  expect(advanced()).toBe(false)
  setAdvanced(true, store)
  expect(advanced()).toBe(true)
  expect(readAdvanced(store)).toBe(true)
  expect(() => setAdvanced(false, broken)).not.toThrow()
  expect(advanced()).toBe(false)
})
