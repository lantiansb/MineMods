import { describe, expect, test } from "bun:test"
import { encodePng } from "@minemods/mod-core/png"
import { decodeRgbaPng } from "@minemods/mod-core/png-decode"
import { decodeTextureDataUrl } from "@minemods/mod-core/content-texture"
import { ContentSchema, validateContent } from "@minemods/mod-core/content"
import type { Project } from "@minemods/mod-core/project"
import { getModuleSchema } from "@minemods/mod-core/workspace"
import { PICTURE_WORDS, importPicture, pictureSize, storedSize } from "../src/renderer/features/asset-edit-texture"
import { CRAFTING, NAMELESS, benchOf, catalog, fromValue, gridOf, offered, search, thingName, toValue, typedThing, withSlot } from "../src/renderer/features/asset-edit-recipe"
import { contentWith, handWired, saveHand, type HandApi } from "../src/renderer/features/asset-edit-save"
import { blankDocument, recipeKindName, type Loose } from "../src/renderer/features/asset-edit-words"
import type { StudioView } from "../src/api"

const png = (width: number, height: number) => encodePng(Uint8Array.from({ length: width * height * 4 }, (_, index) => (index % 4 === 3 ? 255 : (index * 7) % 256)), width, height)
const project = {
  id: "0f6d1a0c-1c1e-4c58-8a52-3c1b8f6c0a11",
  revision: 4,
  mod_id: "hand_made",
  blocks: [{ id: "1f6d1a0c-1c1e-4c58-8a52-3c1b8f6c0a11", identifier: "moon_block", name: "月块", hardness: 1.5, luminance: 0, tool: "pickaxe", drop: "self", color: "#335577" }],
  items: [{ id: "2f6d1a0c-1c1e-4c58-8a52-3c1b8f6c0a11", identifier: "moon_shard", name: "月屑", max_stack: 64, color: "#99aacc" }],
  recipes: [],
  logic: [],
  entities: [],
} as unknown as Project
const things = catalog(project)

describe("换一张图", () => {
  test("16×16 的 PNG 原样存成方块和物品用的那种图", () => {
    const bytes = png(16, 16)
    const read = importPicture(bytes)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.url.startsWith("data:image/png;base64,")).toBe(true)
    // The stored picture is the chosen file, byte for byte, and is what a save and a build read.
    expect(decodeTextureDataUrl(read.url)).toEqual(bytes)
    expect(decodeRgbaPng(decodeTextureDataUrl(read.url))).toMatchObject({ width: 16, height: 16 })
    expect(storedSize(read.url)).toEqual({ width: 16, height: 16 })
    expect(getModuleSchema("item").safeParse({ kind: "item", identifier: "a", name: "甲", max_stack: 1, color: "#000000", texture: read.url }).success).toBe(true)
  })
  test("别的大小不收，说清楚收什么", () => {
    expect(importPicture(png(32, 32))).toEqual({ ok: false, text: "这张图是 32×32 的。只收 16×16 的 PNG 图片：Minecraft 自己的方块和物品都是这个大小。" })
    expect(importPicture(png(16, 32))).toEqual({ ok: false, text: `${PICTURE_WORDS.size(16, 32)}${PICTURE_WORDS.accepted}` })
  })
  test("不是 PNG、读不出来的 PNG 都不收", () => {
    expect(importPicture(new TextEncoder().encode("GIF89a not a png at all, only some text"))).toEqual({ ok: false, text: `${PICTURE_WORDS.notPng}${PICTURE_WORDS.accepted}` })
    expect(importPicture(new Uint8Array())).toMatchObject({ ok: false })
    expect(pictureSize(new Uint8Array(4))).toBeNull()
    const broken = png(16, 16)
    broken[40] = broken[40]! ^ 0xff
    expect(importPicture(broken)).toEqual({ ok: false, text: PICTURE_WORDS.broken })
  })
  test("方块另外带着几张随机图案的时候，新图要和它们一样大", () => {
    const other = importPicture(png(32, 32), [`data:image/png;base64,${Buffer.from(png(32, 32)).toString("base64")}`])
    expect(other.ok).toBe(true)
    expect(importPicture(png(16, 16), [`data:image/png;base64,${Buffer.from(png(32, 32)).toString("base64")}`])).toEqual({ ok: false, text: `${PICTURE_WORDS.size(16, 16)}${PICTURE_WORDS.others(1, 32, 32)}` })
  })
})

describe("格子里能放的东西", () => {
  test("这个模组的东西、原版物品的中文名、成组的物品", () => {
    expect(things.find((thing) => thing.id === "hand_made:moon_shard")).toMatchObject({ name: "月屑", from: "own", color: "#99aacc" })
    expect(things.find((thing) => thing.id === "minecraft:iron_ingot")).toMatchObject({ name: "铁锭", from: "vanilla" })
    expect(things.find((thing) => thing.id === "#minecraft:planks")).toMatchObject({ name: "任意木板", from: "tag", named: true })
    expect(things.filter((thing) => thing.from === "tag" && !thing.named).length).toBeGreaterThan(0)
  })
  test("搜中文名：自己的东西排前面，开头对得上的排前面", () => {
    expect(search(things, "月").map((thing) => thing.name).slice(0, 2)).toEqual(["月屑", "月块"])
    expect(search(things, "铁锭")[0]).toMatchObject({ id: "minecraft:iron_ingot" })
    expect(search(things, "iron_ingot").map((thing) => thing.id)).toContain("minecraft:iron_ingot")
    expect(search(things, "没有这种东西")).toEqual([])
    expect(search(things, "").length).toBe(60)
  })
  test("每种字段只给它能写的：做出来的东西不能是一组，方块的掉落只能是自己模组里别的东西", () => {
    const options = { advanced: false, modId: "hand_made" }
    expect(offered(things, "ingredient", options).some((thing) => thing.id === "#minecraft:planks")).toBe(true)
    expect(offered(things, "ingredient", options).some((thing) => thing.from === "tag" && !thing.named)).toBe(false)
    expect(offered(things, "ingredient", { ...options, advanced: true }).some((thing) => thing.from === "tag" && !thing.named)).toBe(true)
    expect(offered(things, "result", options).some((thing) => thing.from === "tag")).toBe(false)
    expect(offered(things, "own", { ...options, except: "moon_block" }).map((thing) => thing.id)).toEqual(["hand_made:moon_shard"])
    expect(offered(things, "loot", options).some((thing) => thing.from === "vanilla")).toBe(true)
  })
  test("各种字段各自的写法，来回不变", () => {
    expect(toValue("own", "hand_made", "hand_made:moon_shard")).toBe("moon_shard")
    expect(toValue("loot", "hand_made", "minecraft:bone")).toBe("minecraft:bone")
    expect(toValue("ingredient", "hand_made", "hand_made:moon_shard")).toBe("hand_made:moon_shard")
    for (const mode of ["ingredient", "result", "own", "loot"] as const) for (const id of ["hand_made:moon_shard", "minecraft:bone"]) expect(fromValue(mode, "hand_made", toValue(mode, "hand_made", id))).toBe(id)
    expect(thingName(things, "own", "hand_made", "moon_shard", false)).toBe("月屑")
    expect(thingName(things, "own", "hand_made", "moon_shard", true)).toBe("月屑（hand_made:moon_shard）")
    // An id is never shown to somebody who has not asked for ids.
    expect(thingName(things, "ingredient", "hand_made", "other:gone", false)).toBe(NAMELESS)
    expect(thingName(things, "ingredient", "hand_made", null, false)).toBe("")
  })
  test("高级里直接填 ID：只收列表里有的", () => {
    const list = offered(things, "ingredient", { advanced: true, modId: "hand_made" })
    expect(typedThing("minecraft:iron_ingot", list, "ingredient", "hand_made")).toEqual({ value: "minecraft:iron_ingot" })
    expect(typedThing("#minecraft:planks", list, "ingredient", "hand_made")).toEqual({ value: "#minecraft:planks" })
    expect(typedThing("铁锭", list, "ingredient", "hand_made")).toEqual({ value: "minecraft:iron_ingot" })
    expect(typedThing("hand_made:moon_shard", offered(things, "loot", { advanced: true, modId: "hand_made" }), "loot", "hand_made")).toEqual({ value: "moon_shard" })
    expect(typedThing("minecraft:stik", list, "ingredient", "hand_made")).toMatchObject({ error: expect.stringContaining("minecraft:stik") })
    expect(typedThing("  ", list, "ingredient", "hand_made")).toEqual({ value: null })
  })
})

describe("配方的格子和配方文档", () => {
  const blank = blankDocument("recipe", "合月块", [])!
  test("工作台九格，熔炉一格，锻造台三格", () => {
    expect(gridOf(blank)).toMatchObject({ columns: 3, ordered: true, labels: [] })
    expect(gridOf(blank).slots).toHaveLength(9)
    expect(gridOf({ ...blank, type: "shapeless" })).toMatchObject({ ordered: false })
    expect(gridOf({ ...blank, type: "smelting" })).toMatchObject({ slots: [null], columns: 1 })
    expect(gridOf({ ...blank, type: "smithing" })).toMatchObject({ slots: [null, null, null], labels: ["锻造模板", "要升级的东西", "加进去的材料"] })
    expect(recipeKindName("shaped")).toBe("工作台（按位置摆）")
    expect(recipeKindName("blasting")).toBe("高炉")
  })
  test("一格一格放进去，存的就是真的配方文档；读回来还是那些格子", () => {
    const pattern = ["hand_made:moon_shard", "hand_made:moon_shard", null, "hand_made:moon_shard", "#minecraft:planks", null, null, "minecraft:stick", null]
    const filled = pattern.reduce<Loose>((document, value, index) => withSlot(document, index, value), blank)
    const document: Loose = { ...filled, result: "hand_made:moon_block", count: 2 }
    expect(document.pattern).toEqual(pattern)
    expect(gridOf(document).slots).toEqual(pattern)
    expect(getModuleSchema("recipe").safeParse(document).success).toBe(true)
    expect(withSlot(document, 4, null).pattern).toEqual([...pattern.slice(0, 4), null, ...pattern.slice(5)])
    // The whole project takes it: every material and the result are there.
    expect(() => validateContent({ ...contentWith(project, "3f6d1a0c-1c1e-4c58-8a52-3c1b8f6c0a11", document), mod_id: "hand_made", entities: [] })).not.toThrow()
  })
  test("给人看的配方：按位置摆的原样九格；怎么摆都行的往前挨着排；熔炉一格、锻造台三格，旁边写的是它的台子", () => {
    const pattern = [null, "minecraft:copper_ingot", null, null, "minecraft:stick", null, null, "minecraft:stick", null]
    expect(benchOf({ pattern })).toMatchObject({ slots: pattern, columns: 3, title: CRAFTING })
    expect(benchOf({ type: "shaped", pattern })).toMatchObject({ slots: pattern, title: CRAFTING })
    // Places do not count: the things stand in the first slots in the order they were written, and there are still nine.
    expect(benchOf({ type: "shapeless", pattern })).toMatchObject({ slots: ["minecraft:copper_ingot", "minecraft:stick", "minecraft:stick", null, null, null, null, null, null], columns: 3, title: CRAFTING })
    expect(benchOf({ type: "smelting", pattern: ["hand_made:moon_shard", null, null, null, null, null, null, null, null] })).toMatchObject({ slots: ["hand_made:moon_shard"], columns: 1, title: "熔炉" })
    expect(benchOf({ type: "smithing", pattern: ["a:t", "a:b", "a:c", null, null, null, null, null, null] })).toMatchObject({ slots: ["a:t", "a:b", "a:c"], labels: ["锻造模板", "要升级的东西", "加进去的材料"], title: "锻造台" })
  })
  test("熔炉和锻造台的格子写在文档开头的几格", () => {
    const smelting = withSlot({ ...blank, type: "smelting" }, 0, "hand_made:moon_shard")
    expect(smelting.pattern).toEqual(["hand_made:moon_shard", null, null, null, null, null, null, null, null])
    const smithing = ["minecraft:netherite_upgrade_smithing_template", "hand_made:moon_shard", "minecraft:netherite_ingot"].reduce<Loose>((document, value, index) => withSlot(document, index, value), { ...blank, type: "smithing" })
    expect(gridOf(smithing).slots).toEqual(["minecraft:netherite_upgrade_smithing_template", "hand_made:moon_shard", "minecraft:netherite_ingot"])
    expect(() => validateContent({ ...contentWith(project, "3f6d1a0c-1c1e-4c58-8a52-3c1b8f6c0a11", { ...smithing, result: "hand_made:moon_block" }), mod_id: "hand_made", entities: [] })).not.toThrow()
    expect(() => validateContent({ ...contentWith(project, "4f6d1a0c-1c1e-4c58-8a52-3c1b8f6c0a11", { ...smelting, result: "hand_made:moon_block", experience: 0.7 }), mod_id: "hand_made", entities: [] })).not.toThrow()
  })
})

describe("存到哪里去", () => {
  const view = { project } as unknown as StudioView
  test("内容列表里换掉那一条，或者加在最后；别的原样", () => {
    const changed = contentWith(project, project.blocks[0]!.id, { kind: "block", identifier: "moon_block", name: "亮月块", hardness: 3, luminance: 9, tool: "pickaxe", drop: "self", color: "#335577", texture: null })
    expect(changed.blocks).toEqual([{ id: project.blocks[0]!.id, identifier: "moon_block", name: "亮月块", hardness: 3, luminance: 9, tool: "pickaxe", drop: "self", color: "#335577" }])
    expect(changed.items).toBe(project.items)
    expect(ContentSchema.safeParse(changed).success).toBe(true)
    const added = contentWith(project, "5f6d1a0c-1c1e-4c58-8a52-3c1b8f6c0a11", blankDocument("item", "新物品", ["moon_shard"])!)
    expect(added.items.map((item) => item.name)).toEqual(["月屑", "新物品"])
    expect(ContentSchema.safeParse(added).success).toBe(true)
  })
  test("有 saveByHand 就都走它，带上改了哪几项", async () => {
    const calls: unknown[] = []
    const api = { saveByHand: async (input: unknown) => (calls.push(input), { ok: true as const, view, assetId: "a" }) } as unknown as HandApi
    expect(handWired(api)).toBe(true)
    expect(await saveHand(api, project, "block", "a", { kind: "block" }, ["硬度"], () => "fresh")).toEqual({ ok: true, view, assetId: "a" })
    expect(calls).toEqual([{ projectId: project.id, expectedRevision: 4, assetId: "a", document: { kind: "block" }, changed: ["硬度"] }])
  })
  test("没有的话：方块、物品、配方走 saveContent，生物最基本的几项走 saveEntity", async () => {
    const calls: [string, unknown][] = []
    const api = { saveContent: async (input: unknown) => (calls.push(["saveContent", input]), view), saveEntity: async (input: unknown) => (calls.push(["saveEntity", input]), view) } as unknown as HandApi
    expect(handWired(api)).toBe(false)
    expect(await saveHand(api, project, "item", null, blankDocument("item", "新物品", [])!, [], () => "5f6d1a0c-1c1e-4c58-8a52-3c1b8f6c0a11")).toEqual({ ok: true, view, assetId: "5f6d1a0c-1c1e-4c58-8a52-3c1b8f6c0a11" })
    expect(calls[0]).toMatchObject(["saveContent", { projectId: project.id, expectedRevision: 4, content: { items: [{ name: "月屑" }, { id: "5f6d1a0c-1c1e-4c58-8a52-3c1b8f6c0a11", name: "新物品" }] } }])
    await saveHand(api, project, "entity", "e", { kind: "entity", name: "月牛", description: "", health: 12, speed: 0.2, attack_damage: 0, behavior: "passive", model_asset_id: "m", runtime: {} }, [], () => "x")
    expect(calls[1]).toEqual(["saveEntity", { projectId: project.id, expectedRevision: 4, name: "月牛", description: "", health: 12, speed: 0.2, attack_damage: 0, behavior: "passive", entityId: "m" }])
  })
  test("没存成的话，原因按一句话说出来，不带内部的前缀", async () => {
    const api = { saveContent: async () => Promise.reject(new Error("Error invoking remote method 'studio': Error: 有两样东西用了同一个英文短名。给其中一样换个名字再保存。")) } as unknown as HandApi
    expect(await saveHand(api, project, "item", null, blankDocument("item", "新物品", [])!, [], () => "5f6d1a0c-1c1e-4c58-8a52-3c1b8f6c0a11")).toEqual({ ok: false, issues: [{ path: [], code: "refused", message: "有两样东西用了同一个英文短名。给其中一样换个名字再保存。" }] })
  })
})
