import { expect, test } from "bun:test"
import { encodePng } from "@minemods/mod-core/png"
import { BLOCK_SHAPE_EXAMPLE } from "@minemods/mod-core/content-words"
import { getModuleSchema, type ModuleDocument } from "@minemods/mod-core/workspace"
import type { BlockShape } from "@minemods/studio-ai/block-shape"
import { BLIND_SHEET, blindSheet, lookJob, reviewJob } from "../src/main/look-job"
import { drawnInto, handedIn } from "../src/main/script-door"

// A block that is boxes put together is looked at as the game draws it, and named blind from its shape alone.
// The sheet is arithmetic: opaque everywhere but its lower right quarter, which is a hole as a cut-out is.
const dataUrl = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`
const sheet = (side = 32) => dataUrl(encodePng(Uint8Array.from({ length: side * side * 4 }, (_, index) => ((pixel) => (index % 4 === 3 ? ((pixel % side) >= side / 2 && Math.floor(pixel / side) >= side / 2 ? 0 : 255) : (index * 7) % 200))(Math.floor(index / 4))), side, side))
const plain = dataUrl(encodePng(Uint8Array.from({ length: 16 * 16 * 4 }, (_, index) => (index % 4 === 3 ? 255 : 90)), 16, 16))
const shape = (extra: Partial<BlockShape> = {}) => ({ ...BLOCK_SHAPE_EXAMPLE, elements: structuredClone(BLOCK_SHAPE_EXAMPLE.elements), sheet: sheet(), ...extra }) as BlockShape
const stool = (extra: Record<string, unknown> = {}) => getModuleSchema("block").parse({ kind: "block", identifier: "stool", name: "凳子", hardness: 1, luminance: 0, tool: "axe", drop: "self", color: "#8a6a3a", texture: null, shape: shape(), ...extra })
const flatCells = (job: { sheets: { cells: { kind: string }[] }[] }) => job.sheets.flatMap((value) => value.cells.map((cell) => cell.kind))

test("a shaped block is looked at as its shape: front, side, above, behind, the sheet as drawn, and beside a player", () => {
  const looked = lookJob(stool(), null)
  expect(looked.job.scenes).toEqual([])
  expect(looked.job.sheets).toHaveLength(1)
  const cells = looked.job.sheets[0]!.cells
  expect(cells.map((cell) => cell.kind)).toEqual(["flat", "flat", "flat", "flat", "tiles", "flat"])
  expect(cells.map((cell) => cell.label)).toEqual([
    "正面（north 那一面，放下时朝着放它的人）",
    "侧面（从东边看）",
    "斜上方（前面、东侧和顶上）",
    "背面（south 那一面）",
    "sheet 原样（32×32，放大看每个像素）",
    expect.stringContaining("和玩家比"),
  ])
  // Every picture is a real PNG of the same side.
  cells.filter((cell) => cell.kind === "flat").forEach((cell) => expect((cell as unknown as { url: string }).url).toMatch(/^data:image\/png;base64,/))
  expect(looked.texture_facts?.length).toBeGreaterThan(0)
  expect(looked.notes).toEqual(looked.texture_facts ?? [])
})

test("what was counted on the shape and the sheet is answered, not only said: two boxes on top of each other are a measured finding, a sound shape has none", () => {
  expect(lookJob(stool(), null).measured).toBeUndefined()
  const elements = shape().elements
  const doubled = shape({ elements: [...elements, { ...structuredClone(elements[1]!), name: "twin" }] })
  const looked = lookJob(stool({ shape: doubled }), null)
  expect(looked.measured?.length).toBeGreaterThan(0)
  expect(looked.measured!.join("\n")).toContain("twin")
  expect(looked.texture_facts).toEqual(expect.arrayContaining(looked.measured!))
  // The review of a version looks at the same pictures.
  expect(reviewJob(stool(), null).job.sheets[0]!.cells).toHaveLength(6)
})

test("a sheet that is not a picture is said, with what to do; a block with no shape is looked at as a cube as it always was", () => {
  expect(() => lookJob({ ...(stool() as Extract<ModuleDocument, { kind: "block" }>), shape: shape({ sheet: "data:image/png;base64,AAAA" }) }, null)).toThrow("方块外形的 sheet 不是一张读得出来的 PNG")
  const cube = lookJob(stool({ shape: null, texture: plain }), null)
  expect(flatCells(cube.job)).not.toContain("flat")
})

test("named blind, a shaped block shows its shape from three sides and never its sheet, its name, or its colour", () => {
  const blind = blindSheet(stool())!
  expect(blind.label).toBe(BLIND_SHEET)
  expect(blind.cells.map((cell) => cell.kind)).toEqual(["flat", "flat", "flat"])
  const words = JSON.stringify(blind.cells.map((cell) => cell.label))
  expect(words).not.toMatch(/凳|stool|sheet|8a6a3a/)
  // A whole block is still a cube, one face and enlarged.
  expect(blindSheet(stool({ shape: null, texture: plain }))!.cells.map((cell) => cell.kind)).toEqual(["blocks", "tiles", "tiles"])
})

test("a script that lays out the boxes and draws their sheet is put into the block's shape, and the block's own colour and picture are left", async () => {
  const script = `
    const made = api.layout([{ name: "seat", from: [2, 10, 2], to: [14, 12, 14], faces: ["up", "north", "south", "east", "west"] }], { size: 32 })
    const sheet = api.canvas(32, 32, null)
    made.areas.forEach((area) => sheet.rect(area.x, area.y, area.width, area.height, "#a0763c"))
    return { elements: made.elements, sheet, facing: "horizontal" }`
  const document = { kind: "block", identifier: "stool", name: "凳子", hardness: 1, luminance: 0, tool: "axe", drop: "self", color: "#8a6a3a", texture: plain, shape: null }
  const made = await drawnInto(document, script, "block")
  const into = made.document as unknown as { texture: string; color: string; shape: BlockShape }
  expect(into.texture).toBe(plain)
  expect(into.color).toBe("#8a6a3a")
  expect(into.shape.facing).toBe("horizontal")
  expect(into.shape.collision).toBe("full")
  expect(into.shape.elements.map((element) => element.name)).toEqual(["seat"])
  expect(made.made?.summary).toMatchObject({ kind: "shape", elements: 1, faces: 5, sheet: 32 })
  expect(getModuleSchema("block").safeParse(into).success).toBe(true)
  // The same hand-in as an outside AI makes it.
  expect(((await handedIn("block", { document, script }, () => null)).document as { shape: BlockShape }).shape.elements).toHaveLength(1)
  // An item cannot be handed a shape.
  await expect(drawnInto({ ...document, kind: "item" }, script, "item")).rejects.toThrow("脚本没有画出图")
})
