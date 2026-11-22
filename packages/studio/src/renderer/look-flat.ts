import type { LookCell } from "../main/look-job"

/**
 * The cells of a look that are flat pictures: a block's face laid edge to edge, cubes that wear it, an
 * item in an inventory slot and in a hand. Everything is drawn on a plain 2D canvas, pixel for pixel and
 * without smoothing, as the game draws it; cubes and the hand are seen from far away (no perspective), so
 * a face is a slanted copy of the picture and nothing here needs a 3D context. What to draw is decided in
 * `main/look-job.ts`; the numbers that are the game's own (face shading, slot size, how an item sits in a
 * hand) are written where they are used, with where they come from.
 */

type Tiles = Extract<LookCell, { kind: "tiles" }>
type Blocks = Extract<LookCell, { kind: "blocks" }>
type Slots = Extract<LookCell, { kind: "slots" }>
type Held = Extract<LookCell, { kind: "held" }>
export type FlatCell = Tiles | Blocks | Slots | Held
type Vector = [number, number, number]
type Pen = CanvasRenderingContext2D

// Room left at the top of a cell for its label, and around what is drawn.
const TOP = 36
const EDGE = 10
// How bright the game draws each face of a block in daylight: top, the two sides that face north and south, the two that face east and west.
const SHADE = { up: 1, south: 0.8, east: 0.6 }
const PLAIN = "#8c8c8c"
const NIGHT = "#0b0d14"

async function loaded(url: string) {
  const picture = new Image()
  picture.src = url
  await picture.decode()
  return picture
}

/** Runs `draw` with nothing able to spill out of the cell's own area. */
function within(pen: Pen, at: [number, number], size: [number, number], draw: () => void) {
  pen.save()
  pen.beginPath()
  pen.rect(at[0], at[1], size[0], size[1])
  pen.clip()
  draw()
  pen.restore()
  pen.setTransform(1, 0, 0, 1, 0, 0)
  pen.imageSmoothingEnabled = true
}

/** The grey squares that stand for "nothing here" behind a picture with transparent pixels. */
function checker(pen: Pen, x: number, y: number, width: number, height: number, square: number) {
  for (let row = 0; row * square < height; row++)
    for (let column = 0; column * square < width; column++) {
      pen.fillStyle = (row + column) % 2 ? "#9a9a9a" : "#b4b4b4"
      pen.fillRect(x + column * square, y + row * square, Math.min(square, width - column * square), Math.min(square, height - row * square))
    }
}

async function tiles(pen: Pen, cell: Tiles, at: [number, number], size: [number, number]) {
  const pictures = await Promise.all(cell.textures.map(loaded))
  const across = cell.layout[0]!.length
  const side = pictures[0]!.width
  // An exact size is the point of a cell that has one. Otherwise as large as fits, a whole number of screen pixels to each pixel when there is room for that.
  const loose = Math.min((size[0] - EDGE * 2) / across, (size[1] - TOP - EDGE) / cell.layout.length)
  const edge = cell.pixel ? cell.pixel * side : loose >= side ? Math.floor(loose / side) * side : loose
  const left = at[0] + (size[0] - edge * across) / 2
  const top = at[1] + TOP + Math.max(0, (size[1] - TOP - EDGE - edge * cell.layout.length) / 2)
  within(pen, at, size, () => {
    pen.imageSmoothingEnabled = false
    checker(pen, left, top, edge * across, edge * cell.layout.length, Math.max(4, edge / 8))
    cell.layout.forEach((row, y) =>
      row.forEach((index, x) => {
        const pose = cell.poses?.[y]?.[x] ?? 0
        if (!pose) return pen.drawImage(pictures[index]!, left + x * edge, top + y * edge, edge, edge)
        // A face the game shows turned or mirrored at this place: the picture is flipped first, then turned clockwise, about its middle.
        pen.save()
        pen.translate(left + (x + 0.5) * edge, top + (y + 0.5) * edge)
        pen.rotate(((pose & 3) * Math.PI) / 2)
        pen.scale(pose & 4 ? -1 : 1, 1)
        pen.drawImage(pictures[index]!, -edge / 2, -edge / 2, edge, edge)
        pen.restore()
      }),
    )
    if (!cell.lines) return
    pen.fillStyle = "rgba(0, 0, 0, 0.28)"
    for (let line = 0; line <= side * across; line++) pen.fillRect(Math.round(left + (line * edge) / side), top, 1, edge * cell.layout.length)
    for (let line = 0; line <= side * cell.layout.length; line++) pen.fillRect(left, Math.round(top + (line * edge) / side), edge * across, 1)
  })
}

/** Where a point lands on the picture when looked at from far away, from `turn` degrees round and `tilt` degrees up; and how near it is. */
function seen(turn: number, tilt: number) {
  const [yaw, pitch] = [(turn * Math.PI) / 180, (tilt * Math.PI) / 180]
  const right: Vector = [Math.cos(yaw), 0, -Math.sin(yaw)]
  const up: Vector = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch)]
  const toward: Vector = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]
  const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  return { flat: (point: Vector): [number, number] => [dot(point, right), -dot(point, up)], near: (point: Vector) => dot(point, toward), toward }
}

/** Scale and offset that put a set of flat points in the middle of a cell, as large as fits. */
function fitted(points: [number, number][], at: [number, number], size: [number, number]) {
  const low = [Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1]))]
  const high = [Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1]))]
  const scale = Math.min((size[0] - EDGE * 2) / Math.max(0.001, high[0]! - low[0]!), (size[1] - TOP - EDGE) / Math.max(0.001, high[1]! - low[1]!))
  return { scale, x: at[0] + size[0] / 2 - ((low[0]! + high[0]!) / 2) * scale, y: at[1] + TOP + (size[1] - TOP - EDGE) / 2 - ((low[1]! + high[1]!) / 2) * scale }
}

async function blocks(pen: Pen, cell: Blocks, at: [number, number], size: [number, number]) {
  const pictures = await Promise.all(cell.textures.map(loaded))
  const view = cell.view === "corner" ? seen(45, 30) : seen(28, 18)
  const corners = cell.blocks.flatMap((block) => Array.from({ length: 8 }, (_, corner): Vector => [block.at[0] + (corner & 1), block.at[1] + ((corner >> 1) & 1), block.at[2] + ((corner >> 2) & 1)]))
  const fit = fitted(corners.map(view.flat), at, size)
  const place = (point: Vector): [number, number] => ((flat) => [fit.x + flat[0] * fit.scale, fit.y + flat[1] * fit.scale])(view.flat(point))
  // The three faces that are towards the eye: where the picture's top-left corner lies, and which way its two edges run.
  type Face = { origin: Vector; across: Vector; down: Vector; shade: number }
  const plus = (a: Vector, b: Vector): Vector => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
  const minus = (a: Vector): Vector => [-a[0], -a[1], -a[2]]
  // Flipped left to right, as the game's mirrored cube writes every face: the picture starts at the other end of its top edge and runs back.
  const mirrored = (face: Face): Face => ({ ...face, origin: plus(face.origin, face.across), across: minus(face.across) })
  // One quarter turn clockwise seen from above (a blockstate's "y": 90): the top's picture turns with the block.
  const quarter = (way: Vector): Vector => [-way[2], way[1], way[0]]
  const turned = (face: Face, middle: Vector): Face => ({ ...face, origin: plus(middle, quarter(plus(face.origin, minus(middle)))), across: quarter(face.across), down: quarter(face.down) })
  const faces = (corner: Vector, pose = 0): Face[] =>
    (
      [
        { origin: [corner[0], corner[1] + 1, corner[2]], across: [1, 0, 0], down: [0, 0, 1], shade: SHADE.up },
        { origin: [corner[0], corner[1] + 1, corner[2] + 1], across: [1, 0, 0], down: [0, -1, 0], shade: SHADE.south },
        { origin: [corner[0] + 1, corner[1] + 1, corner[2] + 1], across: [0, 0, -1], down: [0, -1, 0], shade: SHADE.east },
      ] as Face[]
    )
      .map((face) => (pose & 4 ? mirrored(face) : face))
      // Every side of a block wears the same picture upright however it is turned; only the top shows a turn.
      .map((face, index) => (index === 0 ? Array.from({ length: pose & 3 }).reduce<Face>((made) => turned(made, [corner[0] + 0.5, corner[1] + 1, corner[2] + 0.5]), face) : face))
  within(pen, at, size, () => {
    if (cell.night) {
      pen.fillStyle = NIGHT
      pen.fillRect(at[0], at[1], size[0], size[1])
    }
    pen.imageSmoothingEnabled = false
    // The far ones first, so the near ones cover them.
    ;[...cell.blocks]
      .sort((left, right) => view.near(left.at) - view.near(right.at))
      .forEach((block) =>
        faces(block.at, block.pose).forEach((face) => {
          const picture = block.texture === null ? null : pictures[block.texture]!
          const side = picture?.width ?? 16
          const origin = place(face.origin)
          const across = place([face.origin[0] + face.across[0], face.origin[1] + face.across[1], face.origin[2] + face.across[2]])
          const down = place([face.origin[0] + face.down[0], face.origin[1] + face.down[1], face.origin[2] + face.down[2]])
          pen.setTransform((across[0] - origin[0]) / side, (across[1] - origin[1]) / side, (down[0] - origin[0]) / side, (down[1] - origin[1]) / side, origin[0], origin[1])
          if (picture) pen.drawImage(picture, 0, 0)
          if (!picture) {
            pen.fillStyle = PLAIN
            pen.fillRect(0, 0, side, side)
          }
          pen.fillStyle = `rgba(0, 0, 0, ${1 - face.shade * (block.light ?? 1)})`
          pen.fillRect(0, 0, side, side)
        }),
      )
  })
}

// An inventory slot as the game lays it out, in interface pixels: 18 across, the icon 16 in the middle of it.
const SLOT = 18
const SLOT_LOOK = { light: { panel: "#c6c6c6", slot: "#8b8b8b", shadow: "#373737", shine: "#ffffff", words: "#2a2a2a" }, dark: { panel: "#20222a", slot: "#30333d", shadow: "#14151a", shine: "#4a4e5c", words: "#e8e8e8" } }

async function slots(pen: Pen, cell: Slots, at: [number, number], size: [number, number]) {
  const pictures = await Promise.all(cell.icons.map((url) => (url ? loaded(url) : null)))
  const look = SLOT_LOOK[cell.dark ? "dark" : "light"]
  // The outline alone: every filled-in pixel in one colour.
  const outlined = (picture: HTMLImageElement) => {
    const canvas = document.createElement("canvas")
    canvas.width = picture.width
    canvas.height = picture.height
    const inner = canvas.getContext("2d")!
    inner.drawImage(picture, 0, 0)
    inner.globalCompositeOperation = "source-in"
    inner.fillStyle = "#1c1c1c"
    inner.fillRect(0, 0, canvas.width, canvas.height)
    return canvas
  }
  const tall = cell.scales.reduce((sum, scale) => sum + (SLOT + 8) * scale + 34, 0)
  within(pen, at, size, () => {
    pen.fillStyle = look.panel
    pen.fillRect(at[0], at[1], size[0], size[1])
    pen.imageSmoothingEnabled = false
    pen.font = "600 13px sans-serif"
    pen.textBaseline = "middle"
    cell.scales.reduce((top, scale) => {
      const left = at[0] + Math.round((size[0] - cell.icons.length * SLOT * scale) / 2)
      pictures.forEach((picture, index) => {
        const x = left + index * SLOT * scale
        pen.fillStyle = look.shadow
        pen.fillRect(x, top, SLOT * scale, SLOT * scale)
        pen.fillStyle = look.shine
        pen.fillRect(x + scale, top + scale, (SLOT - 1) * scale, (SLOT - 1) * scale)
        pen.fillStyle = look.slot
        pen.fillRect(x + scale, top + scale, (SLOT - 2) * scale, (SLOT - 2) * scale)
        if (picture) pen.drawImage(cell.solid ? outlined(picture) : picture, x + scale, top + scale, 16 * scale, 16 * scale)
        if (index !== cell.own) return
        pen.fillStyle = cell.dark ? "#ffd84a" : "#a02020"
        pen.beginPath()
        pen.moveTo(x + (SLOT * scale) / 2, top + SLOT * scale + 4)
        pen.lineTo(x + (SLOT * scale) / 2 - 7, top + SLOT * scale + 14)
        pen.lineTo(x + (SLOT * scale) / 2 + 7, top + SLOT * scale + 14)
        pen.fill()
      })
      pen.fillStyle = look.words
      pen.fillText(`${cell.own === undefined ? "" : "有箭头的是做出来的 · "}图标 ${16 * scale}×${16 * scale} 像素`, at[0] + 12, top + SLOT * scale + 26)
      return top + (SLOT + 8) * scale + 34
    }, at[1] + TOP + 12 + Math.max(0, (size[1] - TOP - 24 - tall) / 2))
  })
}

type Matrix = number[]
const times = (a: Matrix, b: Matrix): Matrix => Array.from({ length: 16 }, (_, index) => [0, 1, 2, 3].reduce((sum, k) => sum + a[Math.floor(index / 4) * 4 + k]! * b[k * 4 + (index % 4)]!, 0))
const moved = (x: number, y: number, z: number): Matrix => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]
const sized = (by: number): Matrix => [by, 0, 0, 0, 0, by, 0, 0, 0, 0, by, 0, 0, 0, 0, 1]
const turned = (axis: 0 | 1 | 2, degrees: number): Matrix => {
  const [c, s] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)]
  return axis === 0 ? [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1] : axis === 1 ? [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1] : [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}
const through = (matrix: Matrix, point: Vector): Vector => [0, 1, 2].map((row) => matrix[row * 4]! * point[0] + matrix[row * 4 + 1]! * point[1] + matrix[row * 4 + 2]! * point[2] + matrix[row * 4 + 3]!) as Vector

/**
 * How the game seats an item in a right hand seen by someone else, from the game's own files: the two item
 * models every flat item descends from (`models/item/generated.json`, `models/item/handheld.json`:
 * rotation in degrees, translation in sixteenths of a block, scale), and the fixed steps the game takes
 * from the arm to the item (a quarter turn down, a half turn round, then 1/16 across, 1/8 down, 5/8 forward).
 */
const HOLDS = {
  generated: { rotation: [0, 0, 0], translation: [0, 3, 1], scale: 0.55 },
  handheld: { rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: 0.85 },
} as const
// The arm is a plain box of the size the game's own figure has (4 × 12 × 4 pixels, hung from 2 below its top), raised a little so the hand is not behind it.
const ARM = { low: [-3 / 16, -2 / 16, -2 / 16] as Vector, high: [1 / 16, 10 / 16, 2 / 16] as Vector, raised: -32, colour: [185, 180, 170] as Vector }

async function held(pen: Pen, cell: Held, at: [number, number], size: [number, number]) {
  const picture = await loaded(cell.url)
  const canvas = document.createElement("canvas")
  canvas.width = picture.width
  canvas.height = picture.height
  const inner = canvas.getContext("2d", { willReadFrequently: true })!
  inner.drawImage(picture, 0, 0)
  const pixels = inner.getImageData(0, 0, canvas.width, canvas.height).data
  const hold = HOLDS[cell.pose]
  const arm = turned(0, ARM.raised)
  const item = [turned(0, -90), turned(1, 180), moved(1 / 16, 0.125, -0.625), moved(hold.translation[0] / 16, hold.translation[1] / 16, hold.translation[2] / 16), turned(0, hold.rotation[0]), turned(1, hold.rotation[1]), turned(2, hold.rotation[2]), sized(hold.scale), moved(-0.5, -0.5, -0.5)].reduce(times, arm)
  // The game's figures are built with y pointing down; half a turn about the line of sight stands them up.
  const upright = (point: Vector): Vector => [-point[0], -point[1], point[2]]
  const boxes: { low: Vector; high: Vector; matrix: Matrix; colour: Vector }[] = [
    { ...ARM, matrix: arm },
    ...Array.from({ length: canvas.width * canvas.height }, (_, index) => index)
      .filter((index) => pixels[index * 4 + 3]! >= 128)
      .map((index) => {
        const [x, y] = [index % canvas.width, Math.floor(index / canvas.width)]
        // A flat item is its picture standing upright, one sixteenth of a block thick.
        return { low: [x / canvas.width, 1 - (y + 1) / canvas.height, 7.5 / 16] as Vector, high: [(x + 1) / canvas.width, 1 - y / canvas.height, 8.5 / 16] as Vector, matrix: item, colour: [pixels[index * 4]!, pixels[index * 4 + 1]!, pixels[index * 4 + 2]!] as Vector }
      }),
  ]
  // From between the front and the side of the holding hand, a little above: whoever holds it faces the right of the picture and towards the eye.
  const view = seen(132, 26)
  const sides = boxes.flatMap((box) => {
    const corner = (index: number): Vector => upright(through(box.matrix, [index & 1 ? box.high[0] : box.low[0], index & 2 ? box.high[1] : box.low[1], index & 4 ? box.high[2] : box.low[2]]))
    return [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]].map((order) => {
      const points = order.map(corner)
      const middle = points.reduce<Vector>((sum, point) => [sum[0] + point[0] / 4, sum[1] + point[1] / 4, sum[2] + point[2] / 4], [0, 0, 0])
      const centre = upright(through(box.matrix, [(box.low[0] + box.high[0]) / 2, (box.low[1] + box.high[1]) / 2, (box.low[2] + box.high[2]) / 2]))
      const out: Vector = [middle[0] - centre[0], middle[1] - centre[1], middle[2] - centre[2]]
      const long = Math.hypot(...out) || 1
      // Lit from above and from the eye's side, as an item in a hand is: faces turned away are darker, none is black.
      const facing = (out[0] * view.toward[0] + out[1] * view.toward[1] + out[2] * view.toward[2]) / long
      return { points, near: view.near(middle), facing, shade: 0.62 + 0.38 * Math.max(0, (out[1] / long) * 0.6 + facing * 0.6), colour: box.colour }
    })
  }).filter((side) => side.facing > 0.001)
  const fit = fitted(sides.flatMap((side) => side.points.map(view.flat)), at, size)
  within(pen, at, size, () =>
    sides
      .sort((left, right) => left.near - right.near)
      .forEach((side) => {
        pen.fillStyle = pen.strokeStyle = `rgb(${side.colour.map((value) => Math.round(value * Math.min(1, side.shade))).join(", ")})`
        pen.lineWidth = 0.6
        pen.beginPath()
        side.points.map(view.flat).forEach((point, index) => (index ? pen.lineTo(fit.x + point[0] * fit.scale, fit.y + point[1] * fit.scale) : pen.moveTo(fit.x + point[0] * fit.scale, fit.y + point[1] * fit.scale)))
        pen.closePath()
        pen.fill()
        pen.stroke()
      }),
  )
}

/** Draw one flat cell into the sheet. Throws when a picture cannot be read: the look then says in plain words that nothing was drawn. */
export async function drawFlat(pen: Pen, cell: FlatCell, at: [number, number], size: [number, number]) {
  if (cell.kind === "tiles") return tiles(pen, cell, at, size)
  if (cell.kind === "blocks") return blocks(pen, cell, at, size)
  if (cell.kind === "slots") return slots(pen, cell, at, size)
  return held(pen, cell, at, size)
}
