import { expect, test } from "bun:test"
import { encodePng } from "@minemods/mod-core/png"
import { BLOCK_SHAPE_EXAMPLE } from "@minemods/mod-core/content-words"
import { getModuleSchema, type ModuleDocument } from "@minemods/mod-core/workspace"
import type { BlockShape } from "@minemods/studio-ai/block-shape"
import { describeAsset } from "../src/renderer/features/asset-words"
import { draftPicture, pictureOf, shapeStamp } from "../src/renderer/features/asset-picture"
import { HAND_WORDS } from "../src/renderer/features/asset-edit-words"
import { formOf, shapeAt, controlOf, tickWords } from "../src/renderer/features/asset-edit-form"

// What the person sees of a block and of a form must be what is saved: a flower painted by its shape's sheet is never
// shown as a coloured cube or called unpainted, and a tick box means one thing.
const dataUrl = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`
const sheet = (colour = 90) => dataUrl(encodePng(Uint8Array.from({ length: 32 * 32 * 4 }, (_, index) => (index % 4 === 3 ? 255 : colour)), 32, 32))
const shape = (extra: Partial<BlockShape> = {}) => ({ ...BLOCK_SHAPE_EXAMPLE, elements: structuredClone(BLOCK_SHAPE_EXAMPLE.elements), sheet: sheet(), ...extra }) as BlockShape
const block = (extra: Record<string, unknown> = {}) => ({ id: "b1", ...(getModuleSchema("block").parse({ kind: "block", identifier: "moonflower", name: "月光花", hardness: 0, luminance: 0, tool: "none", drop: "self", color: "#4466dd", texture: null, ...extra }) as Extract<ModuleDocument, { kind: "block" }>) })
const project = (value: ReturnType<typeof block>) => ({ id: "p", mod_id: "moon", blocks: [value], items: [], recipes: [], entities: [], logic: [], workspace: { assets: [] } }) as never
const tile = { id: "block:b1", asset_id: null, kind: "block" as const, preview: { source: "content" as const, model_asset_id: null, texture_asset_id: null, entity_id: null } }
const describe = (value: ReturnType<typeof block>) => describeAsset(project(value), tile, (reference) => reference)
const picture = (value: ReturnType<typeof block>) => pictureOf("p", project(value), [], tile)

test("a block painted by its shape's sheet is not called unpainted, whatever its texture holds", () => {
  const flower = block({ shape: shape() })
  expect(flower.texture).toBeNull()
  const card = describe(flower)
  expect(card.notes.join()).not.toContain("还没有画图案")
  // The card says it is boxes put together, so the words match the picture beside them.
  expect(card.rows.find((row) => row.label === "外形")?.text).toContain("个方盒子拼成的")
  // A whole block with nothing painted on it is one colour, and says so.
  const plain = describe(block())
  expect(plain.notes).toContain("还没有画图案，游戏里每一面都是这一种颜色。")
  expect(plain.rows.find((row) => row.label === "外形")).toBeUndefined()
})

test("the picture of a shaped block is its shape, with its own key that changes when the shape does; a whole block keeps the cube", () => {
  const a = picture(block({ shape: shape() }))!
  expect(a.key).toContain(":shape:")
  // Same shape, same picture; a moved box, a different sheet or a changed face is another picture even with no saved revision to tell.
  expect(picture(block({ shape: shape() }))!.key).toBe(a.key)
  const moved = shape()
  moved.elements[0]!.from = [moved.elements[0]!.from[0] + 1, moved.elements[0]!.from[1], moved.elements[0]!.from[2]]
  expect(picture(block({ shape: moved }))!.key).not.toBe(a.key)
  expect(picture(block({ shape: shape({ sheet: sheet(200) }) }))!.key).not.toBe(a.key)
  expect(shapeStamp(shape())).toBe(shapeStamp(shape()))
  expect(shapeStamp(null)).toBe("")
  // A shape's picture does not depend on the texture; a block without one still draws the cube it always did.
  expect(picture(block({ shape: shape(), texture: sheet(10) }))!.key).toBe(a.key)
  const cube = picture(block({ texture: sheet(10) }))!
  expect(cube.key).not.toContain(":shape:")
  expect(cube.key).toContain(`#4466dd:${sheet(10).length}`)
})

test("a draft block with a shape that does not hold together gives no picture rather than a coloured cube", () => {
  const draft = (document: unknown) => ({ kind: "block", title: "花", asset_id: null, document, progress: null })
  const whole = { color: "#4466dd", texture: null }
  expect(draftPicture(draft(whole))).not.toBeNull()
  expect(draftPicture(draft({ ...whole, shape: shape() }))!.key).toContain(":shape:")
  // Half written: no boxes yet, or a sheet that is not a picture.
  expect(draftPicture(draft({ ...whole, shape: { facing: "none", collision: "full", sheet: "x", elements: [] } }))).toBeNull()
  // The key moves with the shape even when the document is the same length.
  const one = draftPicture(draft({ ...whole, shape: shape({ sheet: sheet(40) }) }))!.key
  const two = draftPicture(draft({ ...whole, shape: shape({ sheet: sheet(41) }) }))!.key
  expect(one).not.toBe(two)
})

test("a tick box says one thing, always: what ticking it does; the word for leaving it out is only ever the current state", () => {
  const generation = HAND_WORDS.block.flatMap((section) => section.fields).find((word) => word.path === "generation")!
  // The shape that read as a box labelled 「不生成」: ticked it turned generation on.
  expect(tickWords(generation, false)).toEqual({ box: "像矿石一样自己生成", state: "现在：不生成：只能靠合成或者创造模式拿到" })
  expect(tickWords(generation, true)).toEqual({ box: "像矿石一样自己生成", state: "现在：开着" })
  // Every tick box of the block, item and creature forms: the box is the field's own positive name, never the words for "off".
  for (const kind of ["block", "item", "entity"] as const)
    for (const word of HAND_WORDS[kind].flatMap((section) => section.fields)) {
      const shapeOf = shapeAt(kind, word.path)
      if (!shapeOf || !["switch", "flag"].includes(controlOf(word, shapeOf))) continue
      const words = tickWords(word, false)
      expect([kind, word.path, words.box]).toEqual([kind, word.path, word.label])
      expect([kind, word.path, /^(不生成|不能|不会|不给|不要|没有|无|别|禁止)/.test(word.label)]).toEqual([kind, word.path, false])
      if (word.none) expect([word.path, words.box.includes(word.none)]).toEqual([word.path, false])
    }
  expect(formOf("block", block() as never, { advanced: false }).flatMap((section) => section.fields).find((field) => field.key === "generation")?.control).toBe("switch")
})
