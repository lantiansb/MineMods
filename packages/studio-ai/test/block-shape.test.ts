import { expect, test } from "bun:test"
import { BLOCK_SHAPE, BlockShapeSchema, CUTOUT_ALPHA, blockPaint, FACE_CORNERS, FACE_NORMALS, boxSize, elementBounds, faceCorners, faceExtent, facingBox, readPngSize, shapeBoxes, shapeConflict, turned, type BlockShape } from "../src/block-shape"
import { drawShape, measureShape, shapeLines, SHAPE_VIEWS } from "../src/block-shape-facts"
import { SCRIPT_LIMITS, scriptApi } from "../src/script"
import type { Picture } from "../src/texture-facts"

// A PNG data URL with only the header a reader of sizes needs: the schema reads the size, the pictures are read elsewhere.
const header = (side: number) => {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  new DataView(bytes.buffer).setUint32(16, side)
  new DataView(bytes.buffer).setUint32(20, side)
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`
}
const face = (uv: [number, number, number, number], cull = false) => ({ uv, cull })
const box = (name: string, from: [number, number, number], to: [number, number, number], faces: Record<string, ReturnType<typeof face>> = { north: face([0, 0, 4, 4]) }, rotation: unknown = null) => ({ name, from, to, rotation, faces })
const shape = (elements: unknown[], extra: Record<string, unknown> = {}, side = 16) => ({ facing: "horizontal", collision: "shape", sheet: header(side), elements, ...extra })
const issues = (value: unknown) => {
  const parsed = BlockShapeSchema.safeParse(value)
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}：${issue.message}`)
}
/** A sheet filled with one colour, opaque. */
const solid = (side: number, colour: [number, number, number, number] = [200, 100, 50, 255]): Picture => ({ width: side, height: side, pixels: Uint8Array.from({ length: side * side * 4 }, (_, index) => colour[index % 4]!) })
const paint = (sheet: Picture, left: number, top: number, right: number, bottom: number, colour: [number, number, number, number]) => {
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) sheet.pixels.set(colour, (y * sheet.width + x) * 4)
  return sheet
}
const at = (picture: Picture, x: number, y: number) => [...picture.pixels.subarray((y * picture.width + x) * 4, (y * picture.width + x) * 4 + 3)]

test("a shape with a 16, 32 or 64 pixel sheet and well-made boxes has no issue; each way of getting it wrong is said in words", () => {
  const good = box("a", [0, 0, 0], [16, 8, 16], { up: face([0, 0, 16, 16], false), north: face([0, 0, 16, 8], true) })
  expect(issues(shape([good]))).toEqual([])
  expect(issues(shape([good], {}, 64))).toEqual([])
  expect(readPngSize(header(32))).toEqual({ width: 32, height: 32 })
  expect(readPngSize("data:image/jpeg;base64,AAAA")).toBeNull()
  expect(issues(shape([good], {}, 24))[0]).toContain("16、32 或 64")
  expect(issues(shape([good], { sheet: "nope" }))[0]).toContain("PNG")
  expect(issues(shape([box("flat", [0, 0, 0], [16, 8, 0])]))[0]).toBe("elements.0.to.2：盒子「flat」的 z 方向 to（0）要比 from（0）大。")
  expect(issues(shape([box("far", [0, 0, 0], [30, 8, 4])]))).not.toEqual([])
  expect(issues(shape([box("reach", [-8, 0, 0], [24, 8, 4])]))).toEqual([])
  expect(issues(shape([good, box("a", [0, 8, 0], [4, 12, 4])]))[0]).toBe("elements.1.name：有两个盒子都叫「a」，每个盒子要有自己的名字。")
  expect(issues(shape([box("o", [0, 0, 0], [4, 4, 4], { north: face([0, 0, 20, 4]) })]))[0]).toContain("超出了 sheet")
  expect(issues(shape([box("o", [0, 0, 0], [4, 4, 4], { north: face([0, 0, 0, 4]) })]))[0]).toContain("没有面积")
  expect(issues(shape([box("o", [0, 0, 0], [4, 4, 4], {})]))[0]).toContain("一个面也没有要画")
  expect(issues(shape([box("o", [0, 0, 0], [4, 4, 4], { north: face([0, 0, 4, 4]) }, { axis: "y", angle: 30, origin: [8, 8, 8] })]))[0]).toContain("-45、-22.5、0、22.5、45")
  expect(issues(shape([box("o", [0, 0, 0], [4, 4, 4], { north: face([0, 0, 4, 4]) }, { axis: "y", angle: 22.5, origin: [8, 8, 8] })]))).toEqual([])
  expect(issues(shape(Array.from({ length: BLOCK_SHAPE.elements + 1 }, (_, index) => box(`b${index}`, [0, 0, 0], [1, 1, 1]))))).not.toEqual([])
  expect(issues(shape(Array.from({ length: BLOCK_SHAPE.elements }, (_, index) => box(`b${index}`, [0, 0, 0], [1, 1, 1]))))).toEqual([])
  expect(issues(shape([]))).not.toEqual([])
  expect(issues(shape([good], { facing: "diagonal" }))).not.toEqual([])
})

test("cull is for a face on the edge of the block that is not turned: anywhere else the game would drop a face that can be seen", () => {
  const inner = box("inner", [4, 4, 4], [12, 12, 12], { north: face([0, 0, 4, 4], true) })
  expect(issues(shape([inner]))[0]).toBe("elements.0.faces.north.cull：盒子「inner」的正面（north）不在方块的边上（或者盒子转过），cull 写 true 会让它在旁边有方块时凭空消失：写 false。")
  const edge = box("edge", [0, 0, 0], [8, 8, 8], { north: face([0, 0, 4, 4], true), south: face([0, 0, 4, 4], false), west: face([0, 0, 4, 4], true) })
  expect(issues(shape([edge]))).toEqual([])
  const turnedEdge = box("turned", [0, 0, 0], [8, 8, 8], { north: face([0, 0, 4, 4], true) }, { axis: "y", angle: 45, origin: [8, 8, 8] })
  expect(issues(shape([turnedEdge]))).not.toEqual([])
  // A turn of 0 is no turn.
  expect(issues(shape([box("flat", [0, 0, 0], [8, 8, 8], { north: face([0, 0, 4, 4], true) }, { axis: "y", angle: 0, origin: [8, 8, 8] })]))).toEqual([])
})

test("collision: shape needs a box inside the block to be; full does not", () => {
  const outside = box("out", [20, 0, 0], [24, 4, 4])
  expect(issues(shape([outside]))[0]).toContain("碰撞箱会是空的")
  expect(issues(shape([outside], { collision: "full" }))).toEqual([])
})

test("what a shape cannot be together with is one function, said the same everywhere", () => {
  const block = { name: "花盆", shape: {}, generation: null, variants: [], random_mirror: null, random_turn: false }
  expect(shapeConflict(block)).toBeNull()
  expect(shapeConflict({ ...block, shape: null, generation: {} })).toBeNull()
  expect(shapeConflict({ ...block, generation: {} })).toMatchObject({ field: "generation" })
  expect(shapeConflict({ ...block, variants: ["x"] })).toMatchObject({ field: "variants" })
  expect(shapeConflict({ ...block, random_mirror: true })).toMatchObject({ field: "random_mirror" })
  expect(shapeConflict({ ...block, random_turn: true })?.message).toContain("花盆")
})

test("the faces are laid out as the game bakes them: the corners and the way each looks", () => {
  // The north face seen from outside starts at its east edge; its first corner is the picture's top left.
  expect(FACE_CORNERS.north[0]).toEqual([1, 1, 0])
  expect(FACE_CORNERS.south[0]).toEqual([0, 1, 1])
  expect(FACE_CORNERS.up[0]).toEqual([0, 1, 0])
  Object.entries(FACE_CORNERS).forEach(([name, corners]) => {
    expect(corners).toHaveLength(4)
    // Every corner of a face is on the side the face looks to: the axis of its normal is the same for all four.
    const normal = FACE_NORMALS[name as keyof typeof FACE_NORMALS]
    const axis = normal.findIndex((value) => value !== 0)
    expect(new Set(corners.map((corner) => corner[axis])).size).toBe(1)
    expect(corners[0]![axis]).toBe(normal[axis]! > 0 ? 1 : 0)
  })
  const element = box("b", [2, 0, 4], [10, 6, 8]) as unknown as BlockShape["elements"][number]
  expect(faceCorners(element, "north")).toEqual([[10, 6, 4], [10, 0, 4], [2, 0, 4], [2, 6, 4]])
  expect(faceExtent(element, "north")).toEqual({ across: 8, down: 6 })
  expect(faceExtent(element, "east")).toEqual({ across: 4, down: 6 })
  expect(faceExtent(element, "up")).toEqual({ across: 8, down: 4 })
  expect(boxSize(element)).toEqual([8, 6, 4])
})

test("a turn is the game's: a right-handed turn about the axis through the origin; the facings turn clockwise seen from above", () => {
  const about = (axis: "x" | "y" | "z", angle: number) => ({ axis, angle: angle as 45, origin: [8, 8, 8] as [number, number, number] })
  const close = (value: readonly number[], expected: number[]) => value.forEach((number, index) => expect(number).toBeCloseTo(expected[index]!, 9))
  // +x about +y goes to -z, +y about +x goes to +z, +x about +z goes to +y.
  close(turned([16, 8, 8], about("y", 45) && { ...about("y", 45), angle: 45 }), [8 + 8 * Math.cos(Math.PI / 4), 8, 8 - 8 * Math.sin(Math.PI / 4)])
  close(turned([8, 16, 8], about("x", 45)), [8, 8 + 8 * Math.cos(Math.PI / 4), 8 + 8 * Math.sin(Math.PI / 4)])
  close(turned([16, 8, 8], about("z", 45)), [8 + 8 * Math.cos(Math.PI / 4), 8 + 8 * Math.sin(Math.PI / 4), 8])
  expect(turned([3, 4, 5], null)).toEqual([3, 4, 5])
  // The turned element's smallest upright box.
  const turnedBox = box("t", [4, 4, 4], [12, 12, 12], { north: face([0, 0, 4, 4]) }, about("y", 45)) as unknown as BlockShape["elements"][number]
  const bounds = elementBounds(turnedBox)
  expect(bounds.max[0]! - bounds.min[0]!).toBeCloseTo(8 * Math.SQRT2, 9)
  expect(bounds.max[1]! - bounds.min[1]!).toBeCloseTo(8, 9)
  // A box on the north side, turned to each way: north stays, east is on the east, south on the south, west on the west.
  const front = { min: [4, 0, 0], max: [12, 8, 4] } as const
  expect(facingBox(front as never, "north")).toEqual(front)
  expect(facingBox(front as never, "east")).toEqual({ min: [12, 0, 4], max: [16, 8, 12] })
  expect(facingBox(front as never, "south")).toEqual({ min: [4, 0, 12], max: [12, 8, 16] })
  expect(facingBox(front as never, "west")).toEqual({ min: [0, 0, 4], max: [4, 8, 12] })
  // Two quarter turns are a half turn.
  expect(facingBox(facingBox(front as never, "east"), "east")).toEqual(facingBox(front as never, "south"))
})

test("the collision of a shape: each box's upright box cut to the block, a box with nothing left in the block is not a box", () => {
  const elements = [box("pot", [4, 0, 4], [12, 6, 12]), box("reach", [-8, 2, 6], [4, 4, 10]), box("gone", [18, 0, 0], [20, 2, 2])] as unknown as BlockShape["elements"]
  expect(shapeBoxes(elements)).toEqual([
    { min: [4, 0, 4], max: [12, 6, 12] },
    { min: [0, 2, 6], max: [4, 4, 10] },
  ])
})

test("what is counted: a face on an empty part of the sheet, boxes on top of each other, a box nobody can see, a uv off the sheet", () => {
  const sheet = solid(16)
  paint(sheet, 8, 0, 16, 16, [0, 0, 0, 0])
  const closedBox = (name: string, from: [number, number, number], to: [number, number, number], uv: [number, number, number, number]) => box(name, from, to, { north: face(uv), south: face(uv), east: face(uv), west: face(uv), up: face(uv), down: face(uv) })
  const empty = measureShape(shape([box("lid", [0, 0, 0], [4, 4, 4], { north: face([8, 0, 12, 4]), up: face([0, 0, 4, 4]) })]) as BlockShape, sheet)
  expect(empty).toEqual([{ rule: "empty_face", text: "盒子「lid」的正面（north）画在 sheet 的空白处（它读的 16 个像素全是透明的）：游戏里这个面是看不见的。把它的 uv 移到画了东西的地方，或者把这个面去掉。" }])
  // A face that reads only some empty pixels is a face with holes in it, which is a drawing; it is not a fault.
  expect(measureShape(shape([box("lid", [0, 0, 0], [4, 4, 4], { north: face([6, 0, 10, 4]) })]) as BlockShape, sheet)).toEqual([])
  const twin = measureShape(shape([closedBox("a", [2, 2, 2], [6, 6, 6], [0, 0, 4, 4]), closedBox("b", [2, 2, 2], [6, 6, 6], [0, 4, 4, 8])]) as BlockShape, sheet)
  expect(twin.map((fault) => fault.rule)).toEqual(["same_box"])
  expect(twin[0]!.text).toContain("「a」和「b」完全重叠")
  // A box inside a closed box is hidden; inside one with a face left out, or with a hole in a face, it is not.
  const outer = closedBox("shell", [0, 0, 0], [16, 16, 16], [0, 0, 4, 4])
  const inner = box("core", [4, 4, 4], [8, 8, 8], { north: face([0, 4, 4, 8]) })
  expect(measureShape(shape([outer, inner]) as BlockShape, sheet).map((fault) => fault.rule)).toEqual(["hidden_box"])
  expect(measureShape(shape([{ ...outer, faces: { ...outer.faces, up: undefined } }, inner]) as BlockShape, sheet)).toEqual([])
  const holey = solid(16)
  paint(holey, 0, 0, 1, 1, [0, 0, 0, 0])
  expect(measureShape(shape([outer, inner]) as BlockShape, holey)).toEqual([])
  expect(measureShape(shape([outer, { ...inner, from: [4, 4, 4], to: [20, 8, 8] }]) as BlockShape, sheet)).toEqual([])
  // A turned box is not said to be hidden.
  expect(measureShape(shape([outer, { ...inner, rotation: { axis: "y", angle: 22.5, origin: [6, 6, 6] } }]) as BlockShape, sheet).map((fault) => fault.rule)).toEqual(["hidden_box"])
  // A uv off the sheet, which the schema refuses, is also said when the document gets past it by another way.
  const off = measureShape({ ...shape([box("o", [0, 0, 0], [4, 4, 4], { north: face([0, 0, 20, 4]) })]) } as BlockShape, sheet)
  expect(off.map((fault) => fault.rule)).toEqual(["uv_outside"])
  // The faults that need no pixel are still found when the sheet cannot be read.
  expect(measureShape(shape([closedBox("a", [2, 2, 2], [6, 6, 6], [0, 0, 4, 4]), closedBox("b", [2, 2, 2], [6, 6, 6], [0, 4, 4, 8])]) as BlockShape, null).map((fault) => fault.rule)).toEqual(["same_box"])
  // Where a face is drawn, the limit is the game's own: a pixel under the cutout's alpha is empty, any other is drawn.
  const faint = solid(16, [255, 255, 255, Math.floor(CUTOUT_ALPHA * 255) - 1])
  expect(measureShape(shape([box("l", [0, 0, 0], [4, 4, 4], { north: face([0, 0, 4, 4]) })]) as BlockShape, faint).map((fault) => fault.rule)).toEqual(["empty_face"])
  const seen = solid(16, [255, 255, 255, Math.ceil(CUTOUT_ALPHA * 255)])
  expect(measureShape(shape([box("l", [0, 0, 0], [4, 4, 4], { north: face([0, 0, 4, 4]) })]) as BlockShape, seen)).toEqual([])
})

test("the facts said with every look: what the shape is, and how much of the sheet is used and is empty", () => {
  const sheet = solid(16)
  paint(sheet, 8, 0, 16, 16, [0, 0, 0, 0])
  const lines = shapeLines(shape([box("a", [0, 0, 0], [4, 4, 4], { north: face([6, 0, 10, 4]) })]) as BlockShape, sheet)
  expect(lines[0]).toBe("外形：1 个盒子，1 个面要画；放下时正面（north）朝着放它的人；碰撞和选中框就是这些盒子。")
  expect(lines[1]).toBe("sheet（16×16）有 50% 的像素画了东西；面读到的地方占 6%，其中 8 个像素是透明的，游戏里是镂空的。")
  expect(shapeLines(shape([box("a", [0, 0, 0], [4, 4, 4])], { facing: "none", collision: "full" }) as BlockShape, null)).toEqual(["外形：1 个盒子，1 个面要画；朝向固定，不随放它的人转；碰撞和选中框和整块一样。"])
})

test("the picture of a shape is the game's: one-sided faces, the face shades, cut-out pixels, the sheet read pixel for pixel", () => {
  const sheet = solid(16, [200, 100, 50, 255])
  const cube = shape([box("cube", [0, 0, 0], [16, 16, 16], { north: face([0, 0, 16, 16]), east: face([0, 0, 16, 16]), up: face([0, 0, 16, 16]) })]) as BlockShape
  const middle = (view: keyof typeof SHAPE_VIEWS) => ((picture) => at(picture, 100, 100))(drawShape(cube, sheet, SHAPE_VIEWS[view], 200))
  // From the front only the north face shows (four fifths), from the east side only the east face (three fifths).
  expect(middle("front")).toEqual([160, 80, 40])
  expect(middle("side")).toEqual([120, 60, 30])
  // From the back the faces drawn are all turned away: nothing of the block is drawn, only the room.
  expect(middle("back")).not.toEqual([160, 80, 40])
  // From above and in front the top shows at full light and the front at four fifths.
  const quarter = drawShape(cube, sheet, SHAPE_VIEWS.quarter, 200)
  const colours = new Set(Array.from({ length: 200 * 200 }, (_, index) => at(quarter, index % 200, Math.floor(index / 200)).join()))
  expect(colours.has("200,100,50")).toBe(true)
  expect(colours.has("160,80,40")).toBe(true)
  expect(colours.has("120,60,30")).toBe(true)
  // A pixel of the sheet the game drops lets what is behind show; one it draws is drawn whole.
  const holed = solid(16, [200, 100, 50, 255])
  paint(holed, 0, 0, 16, 8, [0, 0, 0, 0])
  const half = drawShape(cube, holed, SHAPE_VIEWS.front, 200)
  expect(at(half, 100, 40)).not.toEqual([160, 80, 40])
  expect(at(half, 100, 160)).toEqual([160, 80, 40])
  paint(holed, 0, 0, 16, 8, [10, 20, 30, Math.ceil(CUTOUT_ALPHA * 255)])
  expect(at(drawShape(cube, holed, SHAPE_VIEWS.front, 200), 100, 40)).toEqual([8, 16, 24])
})

test("the small picture of a block is the same drawing as the AI's look, on a see-through background", () => {
  // A flower: two crossed thin planes, the sheet cut-out around the petals (the case a coloured cube once stood in for).
  const sheet = solid(16, [20, 160, 60, 255])
  paint(sheet, 0, 0, 16, 8, [0, 0, 0, 0])
  const planes = shape([box("a", [8, 0, 0], [8.01, 16, 16], { east: face([0, 0, 16, 16]), west: face([0, 0, 16, 16]) }), box("b", [0, 0, 8], [16, 16, 8.01], { north: face([0, 0, 16, 16]), south: face([0, 0, 16, 16]) })]) as BlockShape
  const full = drawShape(planes, sheet, SHAPE_VIEWS.quarter, 128)
  const bare = drawShape(planes, sheet, SHAPE_VIEWS.quarter, 128, false, true)
  let drawn = 0
  for (let index = 0; index < 128 * 128; index += 1) {
    const here = [...bare.pixels.subarray(index * 4, index * 4 + 4)]
    if (here[3] === 0) {
      expect(here).toEqual([0, 0, 0, 0])
      continue
    }
    // Every pixel the small picture draws is the pixel the full picture draws there; the rest is only the room.
    drawn += 1
    expect(here.slice(0, 3)).toEqual([...full.pixels.subarray(index * 4, index * 4 + 3)])
  }
  expect(drawn).toBeGreaterThan(200)
  // The cut-out half of the sheet is see-through in the small picture too: the top of the flower's box is empty, not a colour.
  expect(bare.pixels[3]).toBe(0)
  expect(bare.pixels[(2 * 128 + 64) * 4 + 3]).toBe(0)
})

test("what paints a block: the shape's sheet when it has a shape, whatever its texture holds", () => {
  expect(blockPaint({ texture: null, shape: shape([box("a", [0, 0, 0], [4, 4, 4])]) })).toBe("sheet")
  expect(blockPaint({ texture: "data:image/png;base64,AAAA", shape: shape([box("a", [0, 0, 0], [4, 4, 4])]) })).toBe("sheet")
  expect(blockPaint({ texture: "data:image/png;base64,AAAA", shape: null })).toBe("texture")
  expect(blockPaint({ texture: null })).toBe("colour")
  expect(blockPaint({ texture: "", shape: null })).toBe("colour")
})

test("a picture is not turned about: the front of the north face starts at its east edge, the way the game bakes it", () => {
  // Red in the top left pixel of the face's picture, blue in the bottom right.
  const sheet = solid(16, [90, 90, 90, 255])
  paint(sheet, 0, 0, 1, 1, [255, 0, 0, 255])
  paint(sheet, 7, 7, 8, 8, [0, 0, 255, 255])
  const one = shape([box("plate", [0, 0, 0], [16, 16, 4], { north: face([0, 0, 8, 8]) })]) as BlockShape
  const front = drawShape(one, sheet, SHAPE_VIEWS.front, 200)
  const reds = Array.from({ length: 200 * 200 }, (_, index) => ({ x: index % 200, y: Math.floor(index / 200), colour: at(front, index % 200, Math.floor(index / 200)) }))
  const red = reds.filter((pixel) => pixel.colour[0] > 150 && pixel.colour[1] < 30)
  const blue = reds.filter((pixel) => pixel.colour[2] > 150 && pixel.colour[0] < 30)
  // Seen from the front the picture reads the right way round: its red corner top left, its blue corner bottom right.
  expect(red.length).toBeGreaterThan(0)
  expect(blue.length).toBeGreaterThan(0)
  expect(Math.max(...red.map((pixel) => pixel.x))).toBeLessThan(Math.min(...blue.map((pixel) => pixel.x)) + 1)
  expect(Math.max(...red.map((pixel) => pixel.y))).toBeLessThan(Math.min(...blue.map((pixel) => pixel.y)) + 1)
})

test("the picture beside a player: a box the size of a player stands next to the block, her eyes marked", () => {
  const sheet = solid(16)
  const small = shape([box("peg", [6, 0, 6], [10, 8, 10], { north: face([0, 0, 4, 8]) })]) as BlockShape
  const alone = drawShape(small, sheet, SHAPE_VIEWS.front, 300)
  const beside = drawShape(small, sheet, SHAPE_VIEWS.front, 300, true)
  const grey = (picture: Picture) => Array.from({ length: 300 * 300 }, (_, index) => at(picture, index % 300, Math.floor(index / 300))).filter((colour) => colour.join() === "96,110,128").length
  expect(grey(alone)).toBe(0)
  expect(grey(beside)).toBeGreaterThan(1000)
  expect(Array.from({ length: 300 * 300 }, (_, index) => at(beside, index % 300, Math.floor(index / 300))).some((colour) => colour.join() === "255,255,255")).toBe(true)
})

test("api.layout gives every face the pixels it covers, side by side on one sheet", () => {
  const { api } = scriptApi({ wears: null, limits: SCRIPT_LIMITS, flat: true })
  const stool = [
    { name: "seat", from: [2, 10, 2], to: [14, 12, 14], faces: ["up", "north", "south", "east", "west"] },
    { name: "leg", from: [6, 0, 6], to: [10, 10, 10], faces: ["north", "south", "east", "west"] },
  ]
  const made = api.layout(stool, { size: 32 })
  expect(made.size).toBe(32)
  expect(made.areas).toHaveLength(9)
  // Each block is as large as the face covers: a pixel of the sheet to a pixel of the block, as the game's own pictures are.
  expect(made.areas.find((area) => area.element === "seat" && area.face === "up")).toMatchObject({ width: 12, height: 12 })
  expect(made.areas.find((area) => area.element === "seat" && area.face === "north")).toMatchObject({ width: 12, height: 2 })
  expect(made.areas.find((area) => area.element === "leg" && area.face === "east")).toMatchObject({ width: 4, height: 10 })
  // No two overlap and every one is on the sheet.
  made.areas.forEach((area, index) => {
    expect(area.x + area.width).toBeLessThanOrEqual(32)
    expect(area.y + area.height).toBeLessThanOrEqual(32)
    made.areas.slice(index + 1).forEach((other) => expect(area.x + area.width <= other.x || other.x + other.width <= area.x || area.y + area.height <= other.y || other.y + other.height <= area.y).toBe(true))
  })
  // The boxes come back with the uv of those blocks, and are a shape the schema takes.
  const element = made.elements.find((value) => value.name === "seat")!
  const area = made.areas.find((value) => value.element === "seat" && value.face === "up")!
  expect((element.faces as Record<string, { uv: number[]; cull: boolean }>).up).toEqual({ uv: [area.x, area.y, area.x + area.width, area.y + area.height], cull: false })
  expect(issues(shape(made.elements, {}, 32))).toEqual([])
  // Each face's block is what the face covers, as the geometry says, whichever face it is.
  made.elements.forEach((value) =>
    Object.entries(value.faces as Record<string, { uv: number[] }>).forEach(([name, drawn]) => {
      const extent = faceExtent(value as never, name as never)
      expect([drawn.uv[2]! - drawn.uv[0]!, drawn.uv[3]! - drawn.uv[1]!]).toEqual([Math.ceil(extent.across), Math.ceil(extent.down)])
    }),
  )
  // Finer, and coarser, on request; a part of a pixel takes the whole of one.
  expect(api.layout(stool, { size: 64, density: 2 }).areas.find((value) => value.element === "leg" && value.face === "east")).toMatchObject({ width: 8, height: 20 })
  expect(api.layout([{ name: "pin", from: [0, 0, 0], to: [1.5, 3, 1], faces: ["north"] }], { density: 0.5 }).areas[0]).toMatchObject({ width: 1, height: 2 })
  // On a 16 sheet this stool does not fit, and the way out is said.
  expect(() => api.layout(stool)).toThrow("把 size 写成 32，或者把 density 调小")
  expect(() => api.layout(stool, { size: 64, density: 4 })).toThrow("已经是最大的 sheet 了")
  expect(() => api.layout(stool, { size: 48 })).toThrow("16、32 或 64")
  expect(() => api.layout([{ name: "x", from: [0, 0, 0], to: [0, 1, 1], faces: ["north"] }])).toThrow("要比 from 大")
  expect(() => api.layout([{ name: "x", from: [0, 0, 0], to: [1, 1, 1], faces: ["front"] }])).toThrow("面的名字只能是")
  expect(() => api.layout([])).toThrow("一列盒子")
  // A face may say it can be culled; a gap keeps the blocks apart.
  const culled = api.layout([{ name: "slab", from: [0, 0, 0], to: [16, 4, 16], faces: { down: { cull: true }, up: {} } }], { size: 64, gap: 1 })
  expect((culled.elements[0]!.faces as Record<string, { cull: boolean }>).down!.cull).toBe(true)
  expect(culled.areas[0]!.x + culled.areas[0]!.width + 1 === culled.areas[1]!.x || culled.areas[1]!.y > culled.areas[0]!.y).toBe(true)
})

test("a script that returns boxes and a canvas hands back a shape; its facing and collision default to the plainest", () => {
  const kit = scriptApi({ wears: null, limits: SCRIPT_LIMITS, flat: true })
  const made = kit.api.layout([{ name: "slab", from: [0, 0, 0], to: [16, 4, 16], faces: ["up", "north"] }], { size: 32 })
  const sheet = kit.api.canvas(32, 32, null).rect(0, 0, 32, 32, "#886644")
  const out = JSON.parse(kit.finish({ elements: made.elements, sheet })) as { value: { kind: string; facing: string; collision: string; elements: unknown[]; sheet: { kind: string; width: number } } }
  expect(out.value).toMatchObject({ kind: "shape", facing: "none", collision: "full", sheet: { kind: "picture", width: 32 } })
  expect(out.value.elements).toHaveLength(1)
  const again = scriptApi({ wears: null, limits: SCRIPT_LIMITS, flat: true })
  expect(JSON.parse(again.finish({ elements: made.elements, sheet: again.api.canvas(32, 32, null), facing: "horizontal", collision: "shape" })).value).toMatchObject({ facing: "horizontal", collision: "shape" })
  expect(() => scriptApi({ wears: null, limits: SCRIPT_LIMITS, flat: true }).finish({ elements: made.elements, sheet: "nope" })).toThrow("sheet 要是一张画布")
  // Without the flat door (a model, a texture) an object with elements is only what it says it is.
  expect(JSON.parse(scriptApi({ wears: null, limits: SCRIPT_LIMITS }).finish({ elements: [] })).value).toEqual({ elements: [] })
})

test("broad8 w3: a shape's collision reaches a block and a half up, as fences do, and stays inside the block sideways", () => {
  const boxes = shapeBoxes([{ name: "back", from: [-4, 0, 12], to: [20, 23, 14], rotation: null, faces: {} }] as never)
  expect(boxes).toEqual([{ min: [0, 0, 12], max: [16, 23, 14] }])
  expect(shapeBoxes([{ name: "pole", from: [7, 0, 7], to: [9, 24, 9], rotation: null, faces: {} }] as never)[0]!.max[1]).toBe(BLOCK_SHAPE.collision_top)
})
