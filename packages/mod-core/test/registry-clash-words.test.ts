import { expect, test } from "bun:test"
import { buildWordsForCreator, creatorWords } from "../src/creator-words"
import type { Project } from "../src/project"
import { registryClashWords } from "../src/registry-name"

/**
 * r29c 乙 第 9 件 (r29b recheck): a clash of two registry names was told to the person as 「注册名写成 指定的部分 … 比如 指定的部分」: the window's plain words
 * (`creatorWords`, `sayPieces`) hide every piece of code, and a registry name looks like code. The name the game knows a thing of this mod by is what the person
 * has to find and change, so it is kept; other code is still hidden, and 高级 is as it was.
 */
const project = { mod_id: "ground_fire_camp", items: [{ identifier: "core", name: "核心" }], blocks: [], workspace: { assets: [] } } as unknown as Project
const clash = registryClashWords("ground_fire_camp", { kind: "entity", id: "a", name: "炎魔", registry: "r29b_bison", other: { id: "b", words: "生物「撞墙野牛」", name: "r29b_bison" } })

test("a registry clash keeps the real names in the person's words", () => {
  const said = buildWordsForCreator(project, [clash])
  expect(said).not.toContain("指定的部分")
  expect(said).toContain("注册名写成 ground_fire_camp:r29b_bison，这个名字已经给了生物「撞墙野牛」")
  expect(said).toContain("比如改成 ground_fire_camp:r29b_bison_2")
  // One of its items is still said by its name, as it always was; a name of this mod nothing else names is kept as it is.
  expect(creatorWords(project)("掉出 ground_fire_camp:core")).toBe("掉出 核心")
  expect(creatorWords(project)("生物 ground_fire_camp:r29b_bison 撞了")).toBe("生物 ground_fire_camp:r29b_bison 撞了")
})

test("other code is still hidden from the person, and 高级 still shows names and ids", () => {
  const say = creatorWords(project)
  expect(say("招式的 windup_ticks 太短")).toContain("指定的部分")
  expect(say("另一个模组的 other_mod:thing 撞了")).toContain("指定的部分")
  // A game command that names one is still hidden whole.
  expect(say("用 `/summon ground_fire_camp:r29b_bison` 放出来")).not.toContain("/summon")
  expect(say("物品 core 撞了", true)).toBe("物品 核心（core） 撞了")
})
