import { z } from "zod"

/**
 * A block that is not a whole block: a few boxes put together (a flower pot, a lectern, a lantern), all drawn
 * from one picture, with a front that turns to face whoever places it. This file is the data and the geometry
 * and nothing else (no Node, no DOM), so the generator, the checks, the scripts and the pictures the maker is
 * shown all read the same boxes the same way. The model JSON, the Java and the pictures are made elsewhere.
 *
 * Every rule about how a face reads the picture and how a box turns is the game's own, read from the 1.21.1
 * jar in its official names (`FaceInfo`, `FaceBakery`), not remembered.
 */

export const SHAPE_FACES = ["north", "south", "east", "west", "up", "down"] as const
export type ShapeFace = (typeof SHAPE_FACES)[number]
export const SHAPE_FACINGS = ["north", "east", "south", "west"] as const
export type ShapeFacing = (typeof SHAPE_FACINGS)[number]

/**
 * `elements`, `reach`, `sheets`: the block-shape spec (2026-10-12). `angles`: the only angles the game's model
 * format accepts for an element's rotation (`ModelElement.Deserializer`: -45, -22.5, 0, 22.5, 45). `sheet_text`: a
 * 64×64 RGBA picture is 16 384 bytes of pixels, 64 filter bytes and about 100 of headers, 22 200 characters as
 * base64; twice that leaves room for a picture a poor encoder wrote. `name`: a box's name is only ever read by a
 * person (in a finding), one line of it.
 */
export const BLOCK_SHAPE = {
  elements: 48,
  reach: [-8, 24],
  block: 16,
  sheets: [16, 32, 64],
  angles: [-45, -22.5, 0, 22.5, 45],
  sheet_text: 44_400,
  name: 64,
  /**
   * How high a shape's collision may reach, in pixels: a block and a half, as the game's own fences and walls stand (their
   * collision box is 24 pixels high). broad8 w3: a chair's back and a sunflower's head reached 23 pixels and were cut to 16, so
   * whoever stood on them sank in. Sideways it stays inside the block, where the game looks for it.
   */
  collision_top: 24,
} as const

/**
 * The shade the game gives each way a face looks (`Direction.getShade`/`BlockModelRenderer`): the top full, the
 * bottom half, the north and south sides four fifths, the east and west sides three fifths.
 */
export const FACE_SHADE: Readonly<Record<ShapeFace, number>> = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 }

/** The shader drops a pixel whose alpha is under this (`rendertype_cutout.fsh`: `color.a < 0.1`); every other pixel is drawn whole, with no blending. */
export const CUTOUT_ALPHA = 0.1

/** What a face is called to the person; the north face is the front, as it is in the game's own models of things that face you. */
export const SHAPE_FACE_WORDS: Readonly<Record<ShapeFace, string>> = { north: "正面（north）", south: "背面（south）", east: "东面（east）", west: "西面（west）", up: "上面（up）", down: "下面（down）" }

export type Vec = readonly [number, number, number]
export type Axis = "x" | "y" | "z"

/**
 * The corners of each face in the order the game bakes them (`CubeFace`): 0 is the box's smaller end on that
 * axis, 1 its larger. The first corner is where the face's picture starts, (u1, v1); then (u1, v2), (u2, v2),
 * (u2, v1). So seen from outside, with the top up, the north face starts at its east edge and the south face at
 * its west edge; the top face starts at its north-west corner and the bottom face at its south-west one.
 */
export const FACE_CORNERS: Readonly<Record<ShapeFace, readonly (readonly [0 | 1, 0 | 1, 0 | 1])[]>> = {
  down: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]],
  up: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  north: [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]],
  south: [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]],
  west: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]],
  east: [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]],
}

/** The way each face looks, outward. */
export const FACE_NORMALS: Readonly<Record<ShapeFace, Vec>> = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] }

const Coordinate = z.number().finite().min(BLOCK_SHAPE.reach[0]).max(BLOCK_SHAPE.reach[1])
const Point = z.tuple([Coordinate, Coordinate, Coordinate])
const Face = z.strictObject({
  /** Where on the sheet this face is drawn, in sheet pixels: left, top, right, bottom. Right under left (or bottom under top) draws it mirrored, as the game's own models do. */
  uv: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
  /** The game may leave this face out when another block lies against it. Only for a face that lies on the edge of the block. */
  cull: z.boolean(),
})
const Rotation = z.strictObject({
  axis: z.enum(["x", "y", "z"]),
  angle: z.number().refine((angle) => (BLOCK_SHAPE.angles as readonly number[]).includes(angle), `旋转的角度只能是 ${BLOCK_SHAPE.angles.join("、")}（游戏的模型只认这几个）。`),
  origin: Point,
})
export const ShapeElementSchema = z.strictObject({
  name: z.string().trim().min(1).max(BLOCK_SHAPE.name),
  from: Point,
  to: Point,
  rotation: Rotation.nullable(),
  /** The faces to draw; a face left out is not drawn at all (one nobody can see is left out). */
  faces: z.strictObject({ north: Face.optional(), south: Face.optional(), east: Face.optional(), west: Face.optional(), up: Face.optional(), down: Face.optional() }),
})
export type ShapeElement = z.infer<typeof ShapeElementSchema>
export type ShapeRotation = NonNullable<ShapeElement["rotation"]>

const DataUrl = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/

/** The width and height a PNG data URL says in its header, or null when it is not one; the picture itself is not read. */
export function readPngSize(source: string): { width: number; height: number } | null {
  const match = DataUrl.exec(source)
  if (!match) return null
  try {
    const bytes = Uint8Array.from(atob(match[1]!.slice(0, 44)), (character) => character.charCodeAt(0))
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value) || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return null
    const view = new DataView(bytes.buffer)
    return { width: view.getUint32(16), height: view.getUint32(20) }
  } catch {
    return null
  }
}

const rounded = (value: number, digits = 3) => Number(value.toFixed(digits))

/** The sides of a box, in block pixels. */
export const boxSize = (element: Pick<ShapeElement, "from" | "to">): Vec => [element.to[0] - element.from[0], element.to[1] - element.from[1], element.to[2] - element.from[2]]

/** How many block pixels a face covers across and down, before the picture's own scale. */
export function faceExtent(element: Pick<ShapeElement, "from" | "to">, face: ShapeFace): { across: number; down: number } {
  const [dx, dy, dz] = boxSize(element)
  return face === "north" || face === "south" ? { across: dx, down: dy } : face === "east" || face === "west" ? { across: dz, down: dy } : { across: dx, down: dz }
}

/** A point turned about the rotation's axis through its origin, the way the game turns an element's corners (`BakedQuadFactory`: the angle in radians, a right-handed turn). */
export function turned(point: Vec, rotation: ShapeRotation | null): Vec {
  if (!rotation || rotation.angle === 0) return point
  const radians = (rotation.angle * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const x = point[0] - rotation.origin[0]
  const y = point[1] - rotation.origin[1]
  const z = point[2] - rotation.origin[2]
  const [a, b, c] = rotation.axis === "x" ? [x, y * cos - z * sin, y * sin + z * cos] : rotation.axis === "y" ? [x * cos + z * sin, y, -x * sin + z * cos] : [x * cos - y * sin, x * sin + y * cos, z]
  return [a! + rotation.origin[0], b! + rotation.origin[1], c! + rotation.origin[2]]
}

/** A direction turned the same way, about the origin. */
export const turnedDirection = (direction: Vec, rotation: ShapeRotation | null): Vec => turned(direction, rotation && { ...rotation, origin: [0, 0, 0] })

/** The four corners of a face where they stand once the element is turned, in `FACE_CORNERS` order. */
export function faceCorners(element: ShapeElement, face: ShapeFace): Vec[] {
  return FACE_CORNERS[face].map(([x, y, z]) => turned([x ? element.to[0] : element.from[0], y ? element.to[1] : element.from[1], z ? element.to[2] : element.from[2]], element.rotation))
}

/** The eight corners of an element once it is turned. */
export function elementCorners(element: ShapeElement): Vec[] {
  return [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => turned([x ? element.to[0] : element.from[0], y ? element.to[1] : element.from[1], z ? element.to[2] : element.from[2]], element.rotation))))
}

export type Box = { min: Vec; max: Vec }

/** The smallest upright box around an element, turned or not. */
export function elementBounds(element: ShapeElement): Box {
  const corners = elementCorners(element)
  const along = (axis: 0 | 1 | 2) => corners.map((corner) => corner[axis])
  return { min: [Math.min(...along(0)), Math.min(...along(1)), Math.min(...along(2))], max: [Math.max(...along(0)), Math.max(...along(1)), Math.max(...along(2))] }
}

/** The pixels of the sheet a face reads: its uv as whole pixels, the left and top ones included. */
export function facePixels(uv: readonly [number, number, number, number]) {
  const left = Math.floor(Math.min(uv[0], uv[2]))
  const top = Math.floor(Math.min(uv[1], uv[3]))
  return { left, top, right: Math.max(left + 1, Math.ceil(Math.max(uv[0], uv[2]))), bottom: Math.max(top + 1, Math.ceil(Math.max(uv[1], uv[3]))) }
}

/** Whether a face lies on the edge of the block it points to, which is the only place the game may drop it safely. */
export function onEdge(element: ShapeElement, face: ShapeFace) {
  if (element.rotation && element.rotation.angle !== 0) return false
  const b = BLOCK_SHAPE.block
  return { north: element.from[2] === 0, south: element.to[2] === b, west: element.from[0] === 0, east: element.to[0] === b, down: element.from[1] === 0, up: element.to[1] === b }[face]
}

/** What the game uses for a box in the world's collision: each element's upright bounding box, cut to the block sideways and to `collision_top` upward, and only if something is left of it. */
export function shapeBoxes(elements: readonly ShapeElement[]): Box[] {
  const b = BLOCK_SHAPE.block
  return elements.flatMap((element) => {
    const bounds = elementBounds(element)
    const min = bounds.min.map((value) => rounded(Math.max(0, value))) as unknown as Vec
    const max = bounds.max.map((value, axis) => rounded(Math.min(axis === 1 ? BLOCK_SHAPE.collision_top : b, value))) as unknown as Vec
    return min.every((value, axis) => max[axis]! > value) ? [{ min, max }] : []
  })
}

/**
 * A box turned to the way the block faces. The model is made facing north and the blockstate turns it a quarter
 * at a time clockwise seen from above (`"y": 90` for east, 180 south, 270 west), so a point at (x, z) goes to
 * east (16 - z, x), south (16 - x, 16 - z), west (z, 16 - x).
 */
export function facingBox(box: Box, facing: ShapeFacing): Box {
  const b = BLOCK_SHAPE.block
  const map = (x: number, z: number): [number, number] => (facing === "north" ? [x, z] : facing === "east" ? [b - z, x] : facing === "south" ? [b - x, b - z] : [z, b - x])
  const first = map(box.min[0], box.min[2])
  const second = map(box.max[0], box.max[2])
  return { min: [rounded(Math.min(first[0], second[0])), box.min[1], rounded(Math.min(first[1], second[1]))], max: [rounded(Math.max(first[0], second[0])), box.max[1], rounded(Math.max(first[1], second[1]))] }
}

/** The turn the blockstate gives a model for each way the block faces. */
export const FACING_TURN: Readonly<Record<ShapeFacing, 0 | 90 | 180 | 270>> = { north: 0, east: 90, south: 180, west: 270 }

/**
 * What paints a block's faces in the game. A block with a shape is drawn on the shape's one sheet and nothing else (its
 * `texture` is then only the colour of the pieces that fly off when it is mined); a whole block wears its texture, or its
 * plain colour while it has none. Every place that draws a block or says how it is painted asks here, so a flower with a
 * perfect sheet is never shown as a coloured cube or described as "not yet painted" because its `texture` is empty.
 */
export function blockPaint(block: { texture?: string | null; shape?: unknown }): "sheet" | "texture" | "colour" {
  if (block.shape) return "sheet"
  return block.texture ? "texture" : "colour"
}

export const BlockShapeSchema = z
  .strictObject({
    /** horizontal: the front turns to face whoever places the block, as a furnace does; none: it always stands as made. */
    facing: z.enum(["none", "horizontal"]),
    /** One picture every face of every box is drawn on: a PNG data URL, 16, 32 or 64 pixels a side. */
    sheet: z.string().max(BLOCK_SHAPE.sheet_text),
    elements: z.array(ShapeElementSchema).min(1).max(BLOCK_SHAPE.elements),
    /** full: walked into like a whole block; shape: the boxes themselves are what stops you. */
    collision: z.enum(["full", "shape"]),
  })
  .superRefine((shape, context) => {
    const add = (message: string, path: (string | number)[]) => context.addIssue({ code: "custom", path, message })
    const size = readPngSize(shape.sheet)
    if (!size) add("sheet 要是一张 PNG（data URL）。", ["sheet"])
    else if (size.width !== size.height || !(BLOCK_SHAPE.sheets as readonly number[]).includes(size.width)) add(`sheet 要是 16、32 或 64 像素见方的图，现在是 ${size.width}×${size.height}。`, ["sheet"])
    const names = new Set<string>()
    shape.elements.forEach((element, index) => {
      const at = (...path: (string | number)[]) => ["elements", index, ...path]
      if (names.has(element.name)) add(`有两个盒子都叫「${element.name}」，每个盒子要有自己的名字。`, at("name"))
      names.add(element.name)
      ;(["x", "y", "z"] as const).forEach((axis, number) => {
        if (element.to[number]! <= element.from[number]!) add(`盒子「${element.name}」的 ${axis} 方向 to（${element.to[number]}）要比 from（${element.from[number]}）大。`, at("to", number))
      })
      SHAPE_FACES.forEach((face) => {
        const drawn = element.faces[face]
        if (!drawn) return
        if (drawn.uv[0] === drawn.uv[2] || drawn.uv[1] === drawn.uv[3]) add(`盒子「${element.name}」的${SHAPE_FACE_WORDS[face]} uv 没有面积（左右或上下写成了同一个数）。`, at("faces", face, "uv"))
        if (size && drawn.uv.some((value) => value < 0 || value > size.width)) add(`盒子「${element.name}」的${SHAPE_FACE_WORDS[face]} uv 超出了 sheet（sheet 是 ${size.width}×${size.width}，uv 要在 0 到 ${size.width} 之间）。`, at("faces", face, "uv"))
        if (drawn.cull && !onEdge(element, face)) add(`盒子「${element.name}」的${SHAPE_FACE_WORDS[face]}不在方块的边上（或者盒子转过），cull 写 true 会让它在旁边有方块时凭空消失：写 false。`, at("faces", face, "cull"))
      })
    })
    if (!shape.elements.some((element) => SHAPE_FACES.some((face) => element.faces[face]))) add("一个面也没有要画：至少给一个盒子写一个面（faces）。", ["elements"])
    if (shape.collision === "shape" && shapeBoxes(shape.elements).length === 0) add("collision 写了 shape，可是没有一个盒子在方块的 0 到 16 以内，碰撞箱会是空的：改成 full，或者把盒子放进方块里。", ["collision"])
  })
export type BlockShape = z.infer<typeof BlockShapeSchema>

/**
 * What a block with a shape cannot also have, as the field it is wrong in and the sentence for the person, or null.
 * Ores are whole blocks in the ground, and a list of pictures to choose from or a turn at random is for the faces
 * of a cube; a shape has one sheet and a front.
 */
export function shapeConflict(block: { name: string; generation?: unknown; variants?: readonly unknown[] | null; random_mirror?: boolean | null; random_turn?: boolean | null; shape?: unknown }) {
  if (!block.shape) return null
  if (block.generation) return { field: "generation", message: `方块「${block.name}」有外形，不是整块，不能在世界里当矿石生成：去掉 generation，或者去掉 shape。` }
  if (block.variants?.length) return { field: "variants", message: `方块「${block.name}」有外形，外形只有一张 sheet，不能再写 variants（更多的图）：去掉其中一个。` }
  if (block.random_mirror) return { field: "random_mirror", message: `方块「${block.name}」有外形，不能再写 random_mirror（随机镜像）：去掉其中一个。` }
  if (block.random_turn) return { field: "random_turn", message: `方块「${block.name}」有外形，不能再写 random_turn（随机转向）：它的朝向由 shape 的 facing 决定。` }
  return null
}
