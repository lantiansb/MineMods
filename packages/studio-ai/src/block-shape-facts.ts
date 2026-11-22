import { BLOCK_SHAPE, CUTOUT_ALPHA, FACE_NORMALS, FACE_SHADE, SHAPE_FACES, SHAPE_FACE_WORDS, elementCorners, facePixels, faceCorners, turnedDirection, type BlockShape, type Box, type ShapeElement, type Vec } from "./block-shape"
import type { Picture } from "./texture-facts"

/**
 * What can be said about a block's shape by counting, and how it is drawn for whoever makes and judges it. The
 * pictures are drawn here, point by point, the way the game's cutout layer draws the model (one-sided faces, the
 * face shades, a pixel under `CUTOUT_ALPHA` dropped and every other one whole), not by the screen's 3D view: the
 * same numbers decide what the game does and what is drawn, so a picture cannot show a face the game does not.
 * No Node, no DOM.
 */

export type ShapeFinding = {
  /** Which kind of fault: a face on an empty part of the sheet, two boxes on top of each other, a box inside another, a uv off the sheet. */
  rule: "empty_face" | "same_box" | "hidden_box" | "uv_outside"
  text: string
}

/** The corners of a box, upright. */
const cornersOf = (box: Box): Vec[] => [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z): Vec => [x ? box.max[0] : box.min[0], y ? box.max[1] : box.min[1], z ? box.max[2] : box.min[2]])))

const alphaAt = (sheet: Picture, x: number, y: number) => sheet.pixels[(y * sheet.width + x) * 4 + 3]! / 255

/** Whether the game draws this pixel of the sheet at all. */
export const drawnPixel = (sheet: Picture, x: number, y: number) => alphaAt(sheet, x, y) >= CUTOUT_ALPHA

/** How many pixels of the sheet a rectangle of its pixels holds that the game draws, and how many it holds. */
function drawnIn(sheet: Picture, rectangle: { left: number; top: number; right: number; bottom: number }) {
  let drawn = 0
  let total = 0
  for (let y = Math.max(0, rectangle.top); y < Math.min(sheet.height, rectangle.bottom); y += 1)
    for (let x = Math.max(0, rectangle.left); x < Math.min(sheet.width, rectangle.right); x += 1) {
      total += 1
      if (drawnPixel(sheet, x, y)) drawn += 1
    }
  return { drawn, total }
}

const same = (a: Vec, b: Vec) => a.every((value, axis) => value === b[axis])
const sameTurn = (a: ShapeElement, b: ShapeElement) => (a.rotation?.angle ?? 0) === (b.rotation?.angle ?? 0) && ((a.rotation?.angle ?? 0) === 0 || (a.rotation!.axis === b.rotation!.axis && same(a.rotation!.origin, b.rotation!.origin)))

/** Every face of a box is drawn, and every drawn pixel of every one is a pixel the game does not drop. */
const closed = (element: ShapeElement, sheet: Picture) =>
  SHAPE_FACES.every((face) => {
    const drawn = element.faces[face]
    if (!drawn) return false
    const covered = drawnIn(sheet, facePixels(drawn.uv))
    return covered.drawn === covered.total && covered.total > 0
  })

/** A point strictly inside a box that is not turned. */
const inside = (point: Vec, element: ShapeElement) => point.every((value, axis) => value > element.from[axis]! && value < element.to[axis]!)

/**
 * The faults that can be counted, each with where it is and what to do. `sheet` is the decoded sheet; without it
 * (it could not be read) only the faults that do not need its pixels are found.
 *
 * - a face on an empty part of the sheet: every pixel of the part it reads is one the game drops, so the face is not there in the game;
 * - two boxes with the same place, size and turn: the faces they share are drawn at the same depth and flicker;
 * - a box inside another: all eight of its corners strictly inside a box that is not turned and has all six faces drawn without a hole, so it can never be seen;
 * - a uv off the sheet: the game would read the next picture in its atlas.
 */
export function measureShape(shape: BlockShape, sheet: Picture | null): ShapeFinding[] {
  const found: ShapeFinding[] = []
  const side = sheet ? sheet.width : null
  shape.elements.forEach((element) => {
    SHAPE_FACES.forEach((face) => {
      const drawn = element.faces[face]
      if (!drawn) return
      if (side && drawn.uv.some((value) => value < 0 || value > side)) {
        found.push({ rule: "uv_outside", text: `盒子「${element.name}」的${SHAPE_FACE_WORDS[face]} uv 超出了 sheet（sheet 是 ${side}×${side}，uv 是 ${drawn.uv.join("、")}）：游戏会读到旁边别的图。把 uv 改回 0 到 ${side} 之间。` })
        return
      }
      if (!sheet) return
      const covered = drawnIn(sheet, facePixels(drawn.uv))
      if (covered.total > 0 && covered.drawn === 0) found.push({ rule: "empty_face", text: `盒子「${element.name}」的${SHAPE_FACE_WORDS[face]}画在 sheet 的空白处（它读的 ${covered.total} 个像素全是透明的）：游戏里这个面是看不见的。把它的 uv 移到画了东西的地方，或者把这个面去掉。` })
    })
  })
  shape.elements.forEach((element, index) => {
    shape.elements.slice(index + 1).forEach((other) => {
      if (same(element.from, other.from) && same(element.to, other.to) && sameTurn(element, other)) found.push({ rule: "same_box", text: `盒子「${element.name}」和「${other.name}」完全重叠（位置、大小和转角一模一样）：它们共用的面画在同一个地方，游戏里会闪。去掉其中一个。` })
    })
  })
  if (sheet)
    shape.elements.forEach((element) => {
      const outer = shape.elements.find((other) => other !== element && !(other.rotation && other.rotation.angle !== 0) && elementCorners(element).every((corner) => inside(corner, other)) && closed(other, sheet))
      if (outer) found.push({ rule: "hidden_box", text: `盒子「${element.name}」完全在盒子「${outer.name}」里面（「${outer.name}」六个面都画了、没有镂空），永远看不见，白占了 sheet 的位置。去掉它，或者把它挪出来。` })
    })
  return found
}

/** How much of the sheet the faces read and how much of it the game draws, in sentences for the maker (never a fault). */
export function shapeLines(shape: BlockShape, sheet: Picture | null): string[] {
  const faces = shape.elements.reduce((count, element) => count + SHAPE_FACES.filter((face) => element.faces[face]).length, 0)
  const lines = [`外形：${shape.elements.length} 个盒子，${faces} 个面要画；${shape.facing === "horizontal" ? "放下时正面（north）朝着放它的人" : "朝向固定，不随放它的人转"}；碰撞和选中框${shape.collision === "shape" ? "就是这些盒子" : "和整块一样"}。`]
  if (!sheet) return lines
  const read = new Set<number>()
  shape.elements.forEach((element) =>
    SHAPE_FACES.forEach((face) => {
      const drawn = element.faces[face]
      if (!drawn) return
      const area = facePixels(drawn.uv)
      for (let y = Math.max(0, area.top); y < Math.min(sheet.height, area.bottom); y += 1) for (let x = Math.max(0, area.left); x < Math.min(sheet.width, area.right); x += 1) read.add(y * sheet.width + x)
    }),
  )
  let drawn = 0
  for (let y = 0; y < sheet.height; y += 1) for (let x = 0; x < sheet.width; x += 1) if (drawnPixel(sheet, x, y)) drawn += 1
  const lost = [...read].filter((index) => !drawnPixel(sheet, index % sheet.width, Math.floor(index / sheet.width))).length
  lines.push(`sheet（${sheet.width}×${sheet.height}）有 ${Math.round((drawn * 100) / (sheet.width * sheet.height))}% 的像素画了东西；面读到的地方占 ${Math.round((read.size * 100) / (sheet.width * sheet.height))}%${lost ? `，其中 ${lost} 个像素是透明的，游戏里是镂空的` : ""}。`)
  return lines
}

/** One way of looking: round the vertical from the front (0 is looking at the north face, 90 from the east), and up from level. */
export type ShapeView = { azimuth: number; pitch: number }
/** The views the look shows. `quarter` sees the front, the east side and the top, as a block in an inventory is shown. */
export const SHAPE_VIEWS = { front: { azimuth: 0, pitch: 0 }, side: { azimuth: 90, pitch: 0 }, back: { azimuth: 180, pitch: 0 }, quarter: { azimuth: 35, pitch: 30 } } as const satisfies Record<string, ShapeView>

/** A player is 0.6 blocks wide and 1.8 high (`EntityType.PLAYER` dimensions), her eyes at 1.62; in block pixels. */
export const PLAYER = { width: 0.6 * BLOCK_SHAPE.block, height: 1.8 * BLOCK_SHAPE.block, eyes: 1.62 * BLOCK_SHAPE.block } as const

type Vec2 = readonly [number, number]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec): Vec => ((length) => [a[0] / length, a[1] / length, a[2] / length] as Vec)(Math.hypot(...a))

const BACKGROUND = [226, 230, 235] as const
const GROUND = [196, 202, 210] as const
const GRID = [206, 212, 220] as const
const PLAYER_COLOUR = [96, 110, 128] as const

/**
 * The shape drawn from one side, `size` pixels square, as the game's cutout layer would draw it in even light:
 * faces that point away are not drawn, a face is shaded by the way it looks (`FACE_SHADE`), a pixel of the sheet
 * under `CUTOUT_ALPHA` is not drawn and every other is drawn whole, the sheet read pixel for pixel. The block's own
 * cube is not drawn, only the ground line under it and a grid a block apart, so the size of things can be read.
 * `player`: also a box the size of a player standing in the next block to the left, with a line at her eyes.
 * `bare`: only the shape itself, on a see-through background with no ground, grid or player, for a small picture that
 * is set on a tile of its own (the overview, the acceptance window). Every pixel of the shape is placed exactly as in
 * the full picture, so the person's small picture and the AI's look are the same drawing.
 */
export function drawShape(shape: BlockShape, sheet: Picture, view: ShapeView, size: number, player = false, bare = false): Picture {
  const azimuth = (view.azimuth * Math.PI) / 180
  const pitch = (view.pitch * Math.PI) / 180
  // Where the camera is, from the middle of the block: azimuth 0 in front of the north face, 90 at the east side.
  const toward: Vec = [Math.sin(azimuth) * Math.cos(pitch), Math.sin(pitch), -Math.cos(azimuth) * Math.cos(pitch)]
  const right = unit(cross([-toward[0], -toward[1], -toward[2]], [0, 1, 0]))
  const up = cross(right, [-toward[0], -toward[1], -toward[2]])
  const centre: Vec = [8, 8, 8]
  const project = (point: Vec): { x: number; y: number; depth: number } => {
    const from: Vec = [point[0] - centre[0], point[1] - centre[1], point[2] - centre[2]]
    return { x: dot(from, right), y: dot(from, up), depth: dot(from, toward) }
  }
  // The player stands in the next block to the left of the front view, on the ground, her middle at that block's middle.
  const playerBox: Box = { min: [8 + 16 - PLAYER.width / 2, 0, 8 - PLAYER.width / 2], max: [8 + 16 + PLAYER.width / 2, PLAYER.height, 8 + PLAYER.width / 2] }
  const drawn = shape.elements.flatMap((element) => elementCorners(element))
  const cube = cornersOf({ min: [0, 0, 0], max: [16, 16, 16] })
  const all = [...drawn, ...cube, ...(player ? cornersOf(playerBox) : [])].map(project)
  const left = Math.min(...all.map((point) => point.x)) - 1
  const rightEdge = Math.max(...all.map((point) => point.x)) + 1
  const bottom = Math.min(...all.map((point) => point.y)) - 1
  const top = Math.max(...all.map((point) => point.y)) + 1
  const scale = size / Math.max(rightEdge - left, top - bottom)
  const offsetX = (size - (rightEdge - left) * scale) / 2
  const offsetY = (size - (top - bottom) * scale) / 2
  const screen = (point: Vec): Vec2 => ((p) => [offsetX + (p.x - left) * scale, offsetY + (top - p.y) * scale] as const)(project(point))
  const pixels = new Uint8Array(size * size * 4)
  const depths = new Float64Array(size * size).fill(-Infinity)
  const put = (x: number, y: number, colour: readonly number[]) => {
    const at = (y * size + x) * 4
    pixels[at] = colour[0]!
    pixels[at + 1] = colour[1]!
    pixels[at + 2] = colour[2]!
    pixels[at + 3] = 255
  }
  if (!bare) for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) put(x, y, BACKGROUND)
  const row = (value: number) => Math.round(value)
  // A grid one block apart through the middle of the block, and the ground under it, so a length can be read in blocks.
  if (view.pitch === 0 && !bare) {
    const ground = screen([8, 0, 8])
    for (let y = Math.max(0, row(ground[1])); y < size; y += 1) for (let x = 0; x < size; x += 1) put(x, y, GROUND)
    for (const block of [-2, -1, 0, 1, 2, 3]) {
      // Lines at block edges along the way the picture runs across: east-west when looking at the front or back, north-south at a side.
      const line = screen(view.azimuth % 180 === 0 ? [block * BLOCK_SHAPE.block, 0, 8] : [8, 0, block * BLOCK_SHAPE.block])
      for (let y = 0; y < size; y += 1) if (line[0] >= 0 && line[0] < size) put(Math.floor(line[0]), y, GRID)
    }
    for (const height of [1, 2, 3]) {
      const line = screen([8, height * BLOCK_SHAPE.block, 8])
      if (line[1] >= 0 && line[1] < size) for (let x = 0; x < size; x += 1) put(x, Math.floor(line[1]), GRID)
    }
  }
  if (player && !bare) {
    const low = screen([playerBox.min[0], playerBox.min[1], 8])
    const high = screen([playerBox.max[0], playerBox.max[1], 8])
    const eyes = screen([8, PLAYER.eyes, 8])[1]
    for (let y = Math.max(0, Math.floor(Math.min(low[1], high[1]))); y < Math.min(size, Math.ceil(Math.max(low[1], high[1]))); y += 1)
      for (let x = Math.max(0, Math.floor(Math.min(low[0], high[0]))); x < Math.min(size, Math.ceil(Math.max(low[0], high[0]))); x += 1) put(x, y, Math.abs(y + 0.5 - eyes) <= 0.75 ? [255, 255, 255] : PLAYER_COLOUR)
  }
  const triangle = (corners: [Vec, Vec, Vec], points: [Vec2, Vec2, Vec2], uvs: [Vec2, Vec2, Vec2], shade: number) => {
    const [a, b, c] = points
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
    if (Math.abs(area) < 1e-9) return
    const depth = corners.map((corner) => project(corner).depth)
    const first = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])))
    const last = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])))
    const above = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])))
    const below = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])))
    for (let y = above; y <= below; y += 1)
      for (let x = first; x <= last; x += 1) {
        const px = x + 0.5
        const py = y + 0.5
        const wa = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area
        const wb = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area
        const wc = 1 - wa - wb
        if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) continue
        const here = wa * depth[0]! + wb * depth[1]! + wc * depth[2]!
        if (here <= depths[y * size + x]!) continue
        const u = wa * uvs[0][0] + wb * uvs[1][0] + wc * uvs[2][0]
        const v = wa * uvs[0][1] + wb * uvs[1][1] + wc * uvs[2][1]
        const sx = Math.min(sheet.width - 1, Math.max(0, Math.floor(u)))
        const sy = Math.min(sheet.height - 1, Math.max(0, Math.floor(v)))
        if (!drawnPixel(sheet, sx, sy)) continue
        const at = (sy * sheet.width + sx) * 4
        depths[y * size + x] = here
        put(x, y, [Math.round(sheet.pixels[at]! * shade), Math.round(sheet.pixels[at + 1]! * shade), Math.round(sheet.pixels[at + 2]! * shade)])
      }
  }
  shape.elements.forEach((element) =>
    SHAPE_FACES.forEach((face) => {
      const art = element.faces[face]
      if (!art) return
      // One-sided, as the game draws a face: seen only from the side it points to.
      if (dot(turnedDirection(FACE_NORMALS[face], element.rotation), toward) <= 1e-9) return
      const corners = faceCorners(element, face)
      const [u1, v1, u2, v2] = art.uv
      const uvs: Vec2[] = [[u1, v1], [u1, v2], [u2, v2], [u2, v1]]
      const points = corners.map(screen)
      triangle([corners[0]!, corners[1]!, corners[2]!], [points[0]!, points[1]!, points[2]!], [uvs[0]!, uvs[1]!, uvs[2]!], FACE_SHADE[face])
      triangle([corners[0]!, corners[2]!, corners[3]!], [points[0]!, points[2]!, points[3]!], [uvs[0]!, uvs[2]!, uvs[3]!], FACE_SHADE[face])
    }),
  )
  return { width: size, height: size, pixels }
}
