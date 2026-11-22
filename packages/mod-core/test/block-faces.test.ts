import { expect, test } from "bun:test"
import { compileContent, validateContent } from "../src/content"
import { encodePng } from "../src/png"
import { runDrawing, SCRIPT_ERRORS } from "../src/script-run"
import { BLOCK_FACES } from "@minemods/studio-ai/texture-facts"

// Pictures made from arithmetic; the file names and JSON shapes held to are the game's own (1.21.1 `blockstates/stone.json`, `dirt.json`).
const png = (seed: number, side = 16) => `data:image/png;base64,${Buffer.from(encodePng(Uint8Array.from({ length: side * side * 4 }, (_, index) => (index % 4 === 3 ? 255 : (index * seed) % 200)), side, side)).toString("base64")}`
const block = (extra: Record<string, unknown> = {}) => ({ id: "7f2d1c9e-3a4b-4c5d-8e6f-0a1b2c3d4e5f", identifier: "ore", name: "矿", hardness: 3, luminance: 0, tool: "pickaxe", drop: "self", color: "#3a8fd0", texture: png(3), ...extra })
const compiled = (extra: Record<string, unknown> = {}) => compileContent({ mod_id: "m", package_name: "a.b", blocks: [block(extra)] })
const assets = "src/main/resources/assets/m"
const json = (files: Record<string, string | Uint8Array>, name: string) => JSON.parse(files[`${assets}/${name}`] as string) as unknown
const refusal = (extra: Record<string, unknown>) => {
  try {
    validateContent({ mod_id: "m", blocks: [block(extra)] })
    return null
  } catch (error) {
    return (error as { issues: { message: string }[] }).issues[0]!.message
  }
}

test("一张图、不随机的方块，生成的文件和以前一个字节都不差；写 null 和不写一样", () => {
  const old = compiled()
  expect(old[`${assets}/blockstates/ore.json`]).toBe(JSON.stringify({ variants: { "": { model: "m:block/ore" } } }, null, 2))
  expect(old[`${assets}/models/block/ore.json`]).toBe(JSON.stringify({ parent: "minecraft:block/cube_all", textures: { all: "m:block/ore" } }, null, 2))
  expect(Object.keys(old).filter((name) => name.includes("/ore"))).toEqual(Object.keys(compiled({ variants: null, random_mirror: null, random_turn: false })).filter((name) => name.includes("/ore")))
  expect(compiled({ variants: [], random_mirror: false })).toEqual(old)
})

test("几张图、镜像、转向：blockstate 是原版那样的一份名单，每张图一个模型，物品用第一张", () => {
  const three = compiled({ variants: [png(5), png(7)] })
  expect(json(three, "blockstates/ore.json")).toEqual({ variants: { "": [{ model: "m:block/ore" }, { model: "m:block/ore-2" }, { model: "m:block/ore-3" }] } })
  expect(json(three, "models/block/ore-3.json")).toEqual({ parent: "minecraft:block/cube_all", textures: { all: "m:block/ore-3" } })
  expect(three[`${assets}/textures/block/ore-2.png`]).toBeInstanceOf(Uint8Array)
  expect(json(three, "models/item/ore.json")).toEqual({ parent: "m:block/ore" })
  // The game's stone: a plain and a mirrored model of the same picture. Its dirt: the same model turned.
  const mirrored = compiled({ random_mirror: true })
  expect(json(mirrored, "blockstates/ore.json")).toEqual({ variants: { "": [{ model: "m:block/ore" }, { model: "m:block/ore-mirrored" }] } })
  expect(json(mirrored, "models/block/ore-mirrored.json")).toEqual({ parent: "minecraft:block/cube_mirrored_all", textures: { all: "m:block/ore" } })
  expect(json(compiled({ random_turn: true }), "blockstates/ore.json")).toEqual({ variants: { "": [{ model: "m:block/ore" }, { model: "m:block/ore", y: 90 }, { model: "m:block/ore", y: 180 }, { model: "m:block/ore", y: 270 }] } })
  const all = json(compiled({ variants: [png(5)], random_mirror: true, random_turn: true }), "blockstates/ore.json") as { variants: { "": unknown[] } }
  expect(all.variants[""]).toHaveLength(16)
  expect(all.variants[""][7]).toEqual({ model: "m:block/ore-2-mirrored", y: 90 })
})

test("几张图不一样大、没有第一张、读不出来、太多张，都用人话退回", () => {
  expect(refusal({ variants: [png(5, 32)] })).toBe("方块「矿」的几张图要一样大：第 1 张是 16×16，第 2 张是 32×32。")
  expect(refusal({ variants: [png(5)], texture: undefined })).toContain("可是没有第一张")
  expect(refusal({ variants: ["data:image/png;base64,AAAA"] })).toBe("方块「矿」的第 2 张图不是一张读得出来的 PNG。")
  expect(refusal({ variants: Array.from({ length: BLOCK_FACES.extra + 1 }, (_, index) => png(index + 2)) })).not.toBeNull()
  expect(refusal({ variants: [png(5)] })).toBeNull()
})

test("画图脚本交回一列画布就是几张图：第一张是 texture，其余是 variants；太多张说明多了几张，不截掉", async () => {
  const one = await runDrawing(`return api.canvas(16, 16, "#777777")`)
  expect(one).toMatchObject({ ok: true, variants: [] })
  const several = await runDrawing(`return [1, 2, 3].map((n) => api.canvas(16, 16, "#777777").set(n, n, "#3a8fd0"))`)
  expect(several).toMatchObject({ ok: true, summary: { kind: "picture", pictures: 3 } })
  expect((several as { variants: string[] }).variants).toHaveLength(2)
  expect(new Set([(several as { texture: string }).texture, ...(several as { variants: string[] }).variants]).size).toBe(3)
  expect(await runDrawing(`return [1, 2, 3, 4, 5].map(() => api.canvas(16, 16, "#777777"))`)).toEqual({ ok: false, error: SCRIPT_ERRORS.too_many_pictures(5), line: null })
  expect(await runDrawing(`return [api.canvas(16, 16, "#777777"), 3]`)).toMatchObject({ ok: false })
})
