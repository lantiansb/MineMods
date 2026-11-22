import type { ModelDesign, ModelFeature, ModelPaint } from "./contracts"
import { placedCubes, texelPoint, type PlacedCube } from "./model-space"

export const MODEL_FACES = ["north", "east", "south", "west", "up", "down"] as const
export type ModelFace = (typeof MODEL_FACES)[number]
export const TEXTURE_SPACE_ERROR = "模型纹理空间不足，请增大贴图尺寸或减少模型细节；最大的贴图也放不下的巨型模型，写 texel_size: 2 或 4（一个贴图像素盖 2×2 或 4×4 个模型像素）。"

/**
 * How many model pixels one texel of the texture covers along each side: 1 for every model that does not say (one texel per model pixel, as always),
 * 2 or 4 for a model too large for the largest texture its tier allows (`texel_size`; epic r4: a dragon 24 blocks long and 30 across needed a sheet 1196 texels tall at 512 wide).
 */
export const texelOf = (design: { texel_size?: number | null }) => design.texel_size ?? 1

/** A cube's size in texels at `texel` model pixels to a texel: every side rounded up, at least one. */
export const texelSize = (size: readonly number[], texel = 1) => size.map((value) => Math.max(1, Math.ceil(value / texel - 1e-9))) as [number, number, number]

type Bone = ModelDesign["bones"][number]
type Cube = Bone["cubes"][number]
type Rgb = [number, number, number]
type Material = ModelPaint["material"]

/**
 * One cube face on the atlas: `x`,`y` is its top-left texel, the 1px ring around it is bleed. 第 1 步: `flip`, the face is drawn mirrored
 * left to right (the cube's `mirror`); `shared`, the texels are another cube's (`share`), so nothing is painted for this one.
 */
export type AtlasIsland = {
  bone: string
  cube: string
  boneIndex: number
  cubeIndex: number
  face: ModelFace
  x: number
  y: number
  width: number
  height: number
  flip?: true
  shared?: true
}

/** Width and height of a face in texels: one texel per model unit, or one per `texel`×`texel` model units (`texelOf`). */
export function faceSize(given: Cube["size"], face: ModelFace, texel = 1): [number, number] {
  const size = texel === 1 ? given : texelSize(given, texel)
  if (face === "up" || face === "down") return [size[0], size[2]]
  if (face === "east" || face === "west") return [size[2], size[1]]
  return [size[0], size[1]]
}

/**
 * Where every cube face is on the texture, in document order. Row packing of every face as it comes ("rows", what every saved texture
 * has: never reorder); 第 1 步: "packed" lays them tallest first, so rows waste far less; a cube that `share`s another's texture takes no
 * place of its own and points at that cube's faces (east and west swapped when it is mirrored, the other side of a pair).
 */
export function modelAtlas(design: ModelDesign): AtlasIsland[] {
  const texel = texelOf(design)
  const size = design.texture_size
  type Slot = { boneIndex: number; cubeIndex: number; face: ModelFace; w: number; h: number; order: number }
  const slots: Slot[] = []
  design.bones.forEach((bone, boneIndex) =>
    bone.cubes.forEach((cube, cubeIndex) => {
      if (cube.share) return
      MODEL_FACES.forEach((face) => {
        const [w, h] = faceSize(cube.size, face, texel)
        slots.push({ boneIndex, cubeIndex, face, w, h, order: slots.length })
      })
    }),
  )
  const placed = new Map<string, { x: number; y: number }>()
  const cursor = { x: 1, y: 1, row: 0 }
  const packed = design.atlas === "packed"
  const queue = packed ? [...slots].sort((a, b) => b.h - a.h || b.w - a.w || a.order - b.order) : slots
  for (const slot of queue) {
    if (cursor.x + slot.w + 1 > size) {
      cursor.x = 1
      cursor.y += cursor.row + 2
      cursor.row = 0
    }
    if (slot.w + 2 > size || cursor.y + slot.h + 1 > size) throw new Error(TEXTURE_SPACE_ERROR)
    placed.set(`${slot.boneIndex}/${slot.cubeIndex}/${slot.face}`, { x: cursor.x, y: cursor.y })
    cursor.x += slot.w + 2
    cursor.row = Math.max(cursor.row, slot.h)
  }
  const index = new Map(design.bones.flatMap((bone, boneIndex) => bone.cubes.map((cube, cubeIndex) => [`${bone.name}.${cube.name}`, [boneIndex, cubeIndex] as const])))
  return design.bones.flatMap((bone, boneIndex) =>
    bone.cubes.flatMap((cube, cubeIndex) =>
      MODEL_FACES.map((face) => {
        const [width, height] = faceSize(cube.size, face, texel)
        const source = cube.share ? index.get(cube.share) : undefined
        const mirrored = cube.mirror === true
        const from = source && mirrored && (face === "east" || face === "west") ? (face === "east" ? "west" : "east") : face
        const at = placed.get(source ? `${source[0]}/${source[1]}/${from}` : `${boneIndex}/${cubeIndex}/${face}`)
        if (!at) throw new Error(`方块 ${bone.name}.${cube.name} 的 share 指向的 ${cube.share} 找不到。`)
        return { bone: bone.name, cube: cube.name, boneIndex, cubeIndex, face, x: at.x, y: at.y, width, height, ...(mirrored ? { flip: true as const } : {}), ...(source ? { shared: true as const } : {}) }
      }),
    ),
  )
}

/** A face's place on the texture as GeckoLib's geometry writes it: a mirrored face starts at its right edge and runs back (a negative width). */
export const islandUv = (island: AtlasIsland) => (island.flip ? { uv: [island.x + island.width, island.y], uv_size: [-island.width, island.height] } : { uv: [island.x, island.y], uv_size: [island.width, island.height] })

/**
 * One cube as GeckoLib's geometry (format 1.12.0) writes it, with its faces' places on the texture. 第 1 步: `inflate`, and a cube's own
 * `pivot` and `rotation` when it is turned; a cube that says neither is written exactly as before (origin, size, uv).
 */
export function geoCube(cube: Cube, islands: readonly AtlasIsland[]) {
  const turned = Boolean(cube.rotation?.some((value) => value !== 0))
  return {
    origin: cube.origin,
    size: cube.size,
    ...(cube.inflate ? { inflate: cube.inflate } : {}),
    ...(turned ? { pivot: cube.pivot ?? (cube.origin.map((value, axis) => value + cube.size[axis]! / 2) as [number, number, number]), rotation: cube.rotation! } : {}),
    uv: Object.fromEntries(islands.map((island) => [island.face, islandUv(island)])) as Record<ModelFace, { uv: number[]; uv_size: number[] }>,
  }
}

/** The material a cube ends up with: its own, else its bone's, else the nearest ancestor bone's. */
export function cubePaint(design: ModelDesign, bone: Bone, cube: Cube): ModelPaint | null {
  if (cube.paint) return cube.paint
  const walk = (current: Bone | undefined, depth: number): ModelPaint | null => {
    if (!current || depth > design.bones.length) return null
    if (current.paint) return current.paint
    return walk(design.bones.find((value) => value.name === current.parent), depth + 1)
  }
  return walk(bone, 0)
}

/** True when any cube is painted by material or carries features, so the tool draws its texture. 第 1 步: or the model is shaded rich, a face has its own pixels, or a cube wears another's texture or a mirrored one. */
export function usesPaint(design: ModelDesign) {
  return design.shading === "rich" || design.bones.some((bone) => bone.cubes.some((cube) => Boolean(cubePaint(design, bone, cube)) || Boolean(cube.features?.length) || Boolean(cube.pixels) || Boolean(cube.share) || cube.mirror === true))
}

const rgb = (hex: string): Rgb => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as Rgb
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
export const luminance = (color: readonly number[]) => (0.299 * color[0]! + 0.587 * color[1]! + 0.114 * color[2]!) / 255
const mix = (a: Rgb, b: Rgb, amount: number) => a.map((value, index) => Math.round(value + (b[index]! - value) * amount)) as Rgb

function toHsl(color: Rgb) {
  const [r, g, b] = color.map((value) => value / 255) as Rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l] as const
  const d = max - min
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60
  return [h, l > 0.5 ? d / (2 - max - min) : d / (max + min), l] as const
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const channel = (offset: number) => {
    const t = (((h + offset) % 360) + 360) % 360
    const value = t < 60 ? 2 * l - q + (2 * q - 2 * l) * (t / 60) : t < 180 ? q : t < 240 ? 2 * l - q + (2 * q - 2 * l) * ((240 - t) / 60) : 2 * l - q
    return Math.round(clamp(value) * 255)
  }
  return [channel(120), channel(0), channel(-120)]
}

/**
 * A pixel-art tone step: shadows get darker, a little more saturated and drift toward blue,
 * lights get paler and drift toward yellow. That hue drift is what keeps few-tone art from looking grey.
 */
function tone(color: Rgb, level: number): Rgb {
  if (level === 0) return color
  const [h, s, l] = toHsl(color)
  const amount = Math.abs(level)
  const drift = ((((level < 0 ? 245 : 52) - h + 540) % 360) - 180) * Math.min(0.14, 0.032 * amount)
  if (level < 0) return fromHsl(h + drift, clamp(s * (1 + 0.04 * amount)), clamp(l * 0.86 ** amount, 0.03, 0.97))
  return fromHsl(h + drift, clamp(s * (1 - 0.06 * amount)), clamp(l + (1 - l) * (1 - 0.84 ** amount), 0.03, 0.97))
}

// Light comes from above and a little from the front, as on vanilla skins.
const FACE_SHADE: Record<ModelFace, number> = { up: 0.6, north: 0, east: -0.35, west: -0.35, south: -0.5, down: -1.2 }

function hash(text: string) {
  return [...text].reduce((value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261)
}

/** Stable pseudo-random number in [0,1) for a seed and three integers. */
function random(seed: number, a: number, b: number, c: number) {
  const mixed = Math.imul(Math.imul(Math.imul(seed ^ Math.imul(a + 374761393, 668265263), 2246822519) ^ Math.imul(b + 1274126177, 3266489917), 2654435761) ^ Math.imul(c + 362437, 40503), 2246822519)
  return (((mixed ^ (mixed >>> 15)) >>> 0) % 100003) / 100003
}

type Spot = { p: number; q: number; w: number; h: number; side: boolean; r: (key: number, x: number, y: number) => number }
const band = (value: number, dark: number, light: number) => (value < dark ? -1 : value > 1 - light ? 1 : 0)
const mod = (value: number, by: number) => ((value % by) + by) % by

/**
 * Tone level (-2 dark … +2 light) of a texel for each material. Every rule draws clusters of a
 * few texels with a shape typical of the material; none decides texel by texel, which reads as noise.
 */
const MATERIALS: Record<Material, (at: Spot) => number> = {
  // Skin is the calmest surface: soft half-step patches, never blotches.
  skin: (at) => band(at.r(1, Math.floor((at.p + Math.floor(at.q / 2)) / 2), Math.floor(at.q / 2)), 0.12, 0.09) * 0.6,
  fur: (at) => band(at.r(1, at.p, Math.floor((at.q + Math.floor(at.r(2, at.p, 0) * 3)) / 3)), 0.27, 0.17),
  feather: (at) => {
    const row = Math.floor(at.q / 3)
    const column = mod(at.p + (row % 2) * 2, 4)
    // Only the lower edge of each feather is drawn; the rest stays one tone so plumage reads as rows, not specks.
    if (mod(at.q, 3) === 2) return column === 1 || column === 2 ? 0 : -1
    return mod(at.q, 3) === 0 && column === 1 && at.r(1, Math.floor(at.p / 4), row) < 0.4 ? 1 : 0
  },
  scales: (at) => {
    const row = Math.floor(at.q / 2)
    const column = mod(at.p + (row % 2) * 2, 3)
    if (mod(at.q, 2) === 1) return column === 0 ? -1 : 0
    return column === 1 && at.r(1, Math.floor(at.p / 3), row) < 0.35 ? 1 : 0
  },
  shell: (at) => {
    const row = mod(at.q, 4)
    if (row === 0) return 1
    if (row === 3) return -2
    return at.r(1, Math.floor(at.p / 3), Math.floor(at.q / 4)) < 0.2 ? -1 : 0
  },
  stone: (at) => {
    if (at.r(3, Math.floor(at.p / 2), Math.floor(at.q / 2)) < 0.035) return -2
    return band(at.r(1, Math.floor((at.p + Math.floor(at.q / 2) * 2) / 3), Math.floor(at.q / 2)), 0.2, 0.14)
  },
  crystal: (at) => {
    const facet = Math.floor((at.p + at.q) / 3)
    const level = [2, 0, -1, 1, 0, -1][Math.floor(at.r(1, facet, 0) * 6)]!
    return mod(at.p + at.q, 3) === 0 && level < 2 ? level + 1 : level
  },
  metal: (at) => {
    if (at.q === 0) return 2
    if (at.q === 1 && at.h > 4) return 1
    if (at.q >= at.h - 1) return -2
    if (at.q === at.h - 2 && at.h > 4) return -1
    return at.r(1, Math.floor(at.p / 4), at.q) < 0.14 ? 1 : 0
  },
  wood: (at) => band(at.r(1, at.p, Math.floor((at.q + Math.floor(at.r(2, at.p, 0) * 6)) / 6)), 0.3, 0.1),
  cloth: (at) => {
    if (at.side && at.q === at.h - 1 && at.h > 3) return -1
    return band(at.r(1, Math.floor((at.p + 1) / 3), Math.floor(at.q / 5)), 0.3, 0.12)
  },
  bone: (at) => {
    if (at.side && at.p === 0 && at.w > 2) return 1
    return at.r(1, Math.floor(at.p / 2), Math.floor(at.q / 2)) < 0.12 ? -1 : 0
  },
  slime: (at) => {
    if (at.w > 3 && at.h > 3 && ((at.q === 1 && (at.p === 1 || at.p === 2)) || (at.q === 2 && at.p === 1))) return 2
    if (at.w > 3 && at.h > 3 && (at.p === 0 || at.q === 0 || at.p === at.w - 1 || at.q === at.h - 1)) return -1
    return at.r(1, Math.floor(at.p / 3), Math.floor(at.q / 3)) < 0.14 && mod(at.p, 3) === 1 && mod(at.q, 3) === 1 ? 1 : 0
  },
  leaf: (at) => band(at.r(1, Math.floor((at.p + at.q) / 2), Math.floor((at.q - at.p + 64) / 3)), 0.32, 0.26),
  // 第 1 步: tanned hide, soft creases running across in short runs, a lighter scuff now and then.
  leather: (at) => {
    if (at.r(2, Math.floor(at.p / 3), at.q) < 0.08) return -1
    return band(at.r(1, Math.floor(at.p / 4), Math.floor(at.q / 2)), 0.14, 0.1) * 0.7
  },
}

type Canvas = {
  w: number
  h: number
  face: ModelFace
  seed: number
  /** Colour under the brush; features read it to stay readable on any material. */
  get: (u: number, v: number) => Rgb
  set: (u: number, v: number, color: Rgb) => void
  /** Like `set`, for a texel that gives off light (a glowing eye, a glowing vein): the same colour, and remembered as lit. */
  lit: (u: number, v: number, color: Rgb) => void
  /** Material tone level of a texel plus the shade of its face, for repainting it in another colour. */
  level: (u: number, v: number) => number
  /** Cube-local position of a texel: x across, y up, z from the front (north) to the back. */
  point: (u: number, v: number) => [number, number, number]
  size: Cube["size"]
  paint: ModelPaint | null
}

const DARK: Rgb = [27, 27, 36]
const WHITE: Rgb = [242, 242, 236]
const shadow = (canvas: Canvas, u: number, v: number, amount: number) =>
  tone(canvas.get(u, v), luminance(canvas.get(u, v)) < 0.16 ? amount * 0.8 : -amount)
const rect = (canvas: Canvas, u: number, v: number, w: number, h: number, color: (u: number, v: number) => Rgb) =>
  Array.from({ length: w * h }, (_, index) => [u + (index % w), v + Math.floor(index / w)] as const).forEach((at) =>
    canvas.set(at[0], at[1], color(at[0], at[1])),
  )

/** Where a pair of eyes sits on a face, shared by eyes and brows so they stay together. */
function eyeBox(canvas: Canvas, feature: ModelFeature) {
  const scale = feature.size ?? (canvas.w >= 14 ? 3 : canvas.w >= 6 ? 2 : 1)
  const wanted = feature.shape ?? (scale === 1 ? "dot" : canvas.h >= 6 && feature.glow !== true ? "square" : "wide")
  const paired = feature.mirror ?? (canvas.face === "north" || canvas.face === "south" || canvas.face === "up")
  const shape = (paired ? canvas.w < 5 : canvas.w < 3) ? "dot" : wanted
  const width = shape === "dot" ? 1 : shape === "tall" ? Math.max(1, scale - 1) : shape === "slit" ? (scale > 1 ? 3 : 1) : Math.max(2, scale)
  const height = shape === "dot" ? 1 : shape === "wide" ? Math.max(1, scale - 1) : shape === "square" ? width : Math.max(2, scale)
  const top = clamp(Math.round((feature.y ?? 0.42) * canvas.h - height / 2), 0, canvas.h - height)
  if (!paired) return { shape, width, height, top, paired, left: clamp(Math.round((feature.x ?? 0.3) * canvas.w - width / 2), 0, canvas.w - width) }
  return { shape, width, height, top, paired, left: clamp(Math.round(canvas.w / 2 - ((feature.x ?? 0.5) * canvas.w) / 2 - width / 2), 0, Math.floor((canvas.w - 1) / 2) - width + (canvas.w % 2 === 0 ? 0 : 0)) }
}

const hex = (value: string | null | undefined) => (value ? rgb(value) : null)

/** A wandering 1px line from the top edge downward, with one side branch: cracks and veins. */
function wander(canvas: Canvas, key: number, color: (u: number, v: number) => Rgb, glow: Rgb | null) {
  const length = Math.max(2, Math.round(canvas.h * (0.55 + random(canvas.seed, key, 1, 0) * 0.4)))
  const start = Math.floor(random(canvas.seed, key, 2, 0) * canvas.w)
  const path = Array.from({ length }, (_, step) => step).reduce<[number, number][]>((points, step) => {
    const last = points.at(-1) ?? [start, 0]
    const turn = random(canvas.seed, key, 3, step)
    return [...points, [clamp(last[0] + (step === 0 ? 0 : turn < 0.3 ? -1 : turn > 0.7 ? 1 : 0), 0, canvas.w - 1), step]]
  }, [])
  const fork = path[Math.floor(path.length / 2)]!
  const side = random(canvas.seed, key, 4, 0) < 0.5 ? -1 : 1
  const all = [...path, ...(canvas.w >= 5 ? ([[fork[0] + side, fork[1]], [fork[0] + side * 2, fork[1] + 1]] as [number, number][]) : [])]
  if (glow)
    all.forEach((at) =>
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach((step) => canvas.set(at[0] + step[0]!, at[1] + step[1]!, mix(canvas.get(at[0] + step[0]!, at[1] + step[1]!), glow, 0.22))),
    )
  all.forEach((at) => (glow ? canvas.lit : canvas.set)(at[0], at[1], color(at[0], at[1])))
  if (glow) canvas.lit(fork[0], fork[1], tone(glow, 2))
}

const FEATURES: Record<ModelFeature["type"], (canvas: Canvas, feature: ModelFeature) => void> = {
  eyes: (canvas, feature) => {
    const box = eyeBox(canvas, feature)
    const plain = box.shape === "dot" || box.shape === "tall"
    const main = hex(feature.color) ?? (plain ? DARK : WHITE)
    const pupil = hex(feature.color2) ?? (feature.glow || plain ? null : DARK)
    const lefts = box.paired ? [box.left, canvas.w - box.left - box.width] : [box.left]
    lefts.forEach((left, index) => {
      // A halo for glowing eyes, a brow shadow for ordinary ones: both lift the eye off the skin.
      if (feature.glow) rect(canvas, left - 1, box.top - 1, box.width + 2, box.height + 2, (u, v) => mix(canvas.get(u, v), main, 0.35))
      if (!feature.glow && canvas.h >= 6 && box.top > 0) rect(canvas, left, box.top - 1, box.width, 1, (u, v) => shadow(canvas, u, v, 0.8))
      rect(feature.glow ? { ...canvas, set: canvas.lit } : canvas, left, box.top, box.width, box.height, () => main)
      if (feature.glow) canvas.lit(left + (index === 0 ? box.width - 1 : 0), box.top, tone(main, 2.4))
      if (!pupil) return
      if (plain) return canvas.set(left, box.top, pupil)
      // Pupils sit toward the nose; a lone eye on a side face looks forward.
      const inner = box.shape === "slit" ? left + Math.floor(box.width / 2) : !box.paired || index === 0 ? left + box.width - 1 : left
      rect(canvas, inner, box.top + (box.shape === "square" && box.height > 2 ? 1 : 0), 1, box.height - (box.shape === "square" && box.height > 2 ? 1 : 0), () => pupil)
      if (box.shape === "square" && box.width > 2)
        rect(canvas, inner + (inner === left ? 1 : -1), box.top + 1, 1, box.height - 1, () => pupil)
    })
  },
  brows: (canvas, feature) => {
    const box = eyeBox(canvas, feature)
    const lefts = box.paired ? [box.left, canvas.w - box.left - box.width] : [box.left]
    lefts.forEach((left, index) =>
      Array.from({ length: box.width }, (_, step) => step).forEach((step) => {
        const inner = !box.paired || index === 0 ? step === box.width - 1 : step === 0
        const drop = feature.shape === "angry" ? (inner ? 0 : -1) : feature.shape === "sad" ? (inner ? -1 : 0) : -1
        const v = Math.max(0, box.top + drop)
        canvas.set(left + step, v, hex(feature.color) ?? shadow(canvas, left + step, Math.max(0, box.top - 1), 3))
      }),
    )
  },
  mouth: (canvas, feature) => {
    const width = clamp(feature.size ?? Math.max(2, Math.round(canvas.w * 0.5)), 1, canvas.w)
    const left = Math.floor((canvas.w - width) / 2)
    const row = clamp(Math.round((feature.y ?? 0.8) * canvas.h - 0.5), 0, canvas.h - 1)
    const shape = feature.shape ?? "line"
    const ink = (u: number, v: number) => hex(feature.color) ?? shadow(canvas, u, v, 3)
    const teeth = hex(feature.color2) ?? WHITE
    if (shape === "open") {
      rect(canvas, left, Math.min(row, canvas.h - 2), width, 2, ink)
      if (width >= 4) rect(canvas, left + 1, Math.min(row, canvas.h - 2) + 1, width - 2, 1, () => hex(feature.color2) ?? [190, 78, 88])
      return
    }
    rect(canvas, left, row, width, 1, (u, v) => (shape === "teeth" && (u - left) % 2 === 1 ? teeth : ink(u, v)))
    if (shape === "smile" && width >= 3 && row > 0) [left, left + width - 1].forEach((u) => (canvas.set(u, row, canvas.get(u, row + 1 < canvas.h ? row + 1 : row)), canvas.set(u, row - 1, ink(u, row - 1))))
    if (shape === "frown" && width >= 3 && row + 1 < canvas.h) [left, left + width - 1].forEach((u) => (canvas.set(u, row, canvas.get(u, row - 1 >= 0 ? row - 1 : row)), canvas.set(u, row + 1, ink(u, row + 1))))
    if (shape === "fangs" && row + 1 < canvas.h) [left + (width >= 6 ? 1 : 0), left + width - (width >= 6 ? 2 : 1)].forEach((u) => canvas.set(u, row + 1, teeth))
  },
  nose: (canvas, feature) => {
    if (feature.shape === "snout") {
      const width = clamp(feature.size ?? Math.max(2, Math.round(canvas.w * 0.5)), 1, canvas.w)
      const height = Math.max(2, Math.round(canvas.h * 0.36))
      const left = Math.floor((canvas.w - width) / 2)
      const top = clamp(Math.round((feature.y ?? 0.72) * canvas.h - height / 2), 0, canvas.h - height)
      rect(canvas, left, top, width, height, (u, v) => (feature.color ? tone(rgb(feature.color), canvas.level(u, v)) : tone(canvas.get(u, v), 1.8)))
      if (width >= 3) [left + (width >= 5 ? 1 : 0), left + width - (width >= 5 ? 2 : 1)].forEach((u) => canvas.set(u, top, hex(feature.color2) ?? shadow(canvas, u, top, 3.2)))
      return
    }
    const width = feature.size ?? (canvas.w % 2 === 0 ? 2 : 1)
    const row = clamp(Math.round((feature.y ?? 0.6) * canvas.h - 0.5), 0, canvas.h - 1)
    rect(canvas, Math.floor((canvas.w - width) / 2), row, width, 1, (u, v) => hex(feature.color) ?? shadow(canvas, u, v, 2.6))
  },
  belly: (canvas, feature) => {
    const inset = Math.min(feature.size ?? Math.max(1, Math.round(canvas.w * 0.2)), Math.floor((canvas.w - 1) / 2))
    const flat = canvas.face === "up" || canvas.face === "down"
    const top = flat ? 0 : Math.round((feature.y ?? 0.3) * canvas.h)
    const color = hex(feature.color) ?? hex(canvas.paint?.secondary) ?? null
    rect(canvas, inset, top, canvas.w - inset * 2, canvas.h - top, (u, v) => {
      // Rounded top corners keep the patch from reading as a pasted rectangle.
      if (!flat && v === top && (u === inset || u === canvas.w - inset - 1) && canvas.w - inset * 2 > 2) return canvas.get(u, v)
      return color ? tone(color, canvas.level(u, v)) : tone(canvas.get(u, v), 2)
    })
  },
  stripes: (canvas, feature) => {
    const axis = canvas.size.indexOf(Math.max(...canvas.size))
    const length = canvas.size[axis]!
    if (feature.shape === "long") {
      // A stripe running the length of the part, down the middle of its back.
      if (canvas.face !== (axis === 1 ? "north" : "up")) return
      const width = clamp(feature.size ?? Math.max(1, Math.round(canvas.w / 4)), 1, canvas.w)
      const across = axis === 0
      const span = across ? canvas.h : canvas.w
      rect(canvas, across ? 0 : Math.floor((span - width) / 2), across ? Math.floor((span - width) / 2) : 0, across ? canvas.w : width, across ? width : canvas.h, (u, v) => hex(feature.color) ?? shadow(canvas, u, v, 2.6))
      return
    }
    const count = feature.count ?? Math.max(2, Math.round(length / 5))
    const period = length / count
    const thick = feature.size ?? Math.max(1, Math.round(period * 0.34))
    rect(canvas, 0, 0, canvas.w, canvas.h, (u, v) => {
      const at = canvas.point(u, v)
      const index = Math.floor(at[axis]! / period)
      if (at[axis]! - index * period - (period - thick) / 2 < 0 || at[axis]! - index * period - (period - thick) / 2 >= thick) return canvas.get(u, v)
      // Rings on an upright part; on a lying one each stripe fades out partway down the flank and skips the belly.
      if (axis !== 1 && canvas.face === "down") return canvas.get(u, v)
      if (axis !== 1 && canvas.face !== "up" && canvas.size[1] - at[1] > canvas.size[1] * (0.5 + random(canvas.seed, 71, index, 0) * 0.35)) return canvas.get(u, v)
      return hex(feature.color) ?? shadow(canvas, u, v, 2.6)
    })
  },
  spots: (canvas, feature) => {
    const big = (feature.size ?? (canvas.w * canvas.h >= 40 ? 2 : 1)) > 1
    Array.from({ length: feature.count ?? Math.max(1, Math.round((canvas.w * canvas.h) / 20)) }, (_, index) => index).forEach((index) => {
      const u = Math.floor(random(canvas.seed, 81, index, MODEL_FACES.indexOf(canvas.face)) * (canvas.w - (big ? 1 : 0)))
      const v = Math.floor(random(canvas.seed, 82, index, MODEL_FACES.indexOf(canvas.face)) * (canvas.h - (big ? 1 : 0)))
      const color = hex(feature.color) ?? tone(canvas.get(u, v), luminance(canvas.get(u, v)) > 0.5 ? -2.4 : 2.2)
      const skip = Math.floor(random(canvas.seed, 83, index, 0) * 4)
      if (!big) return canvas.set(u, v, color)
      // Three texels out of a 2×2 block: rounder than a square, never a single stray pixel.
      Array.from({ length: 4 }, (_, corner) => corner).filter((corner) => corner !== skip).forEach((corner) => canvas.set(u + (corner % 2), v + Math.floor(corner / 2), color))
    })
  },
  cracks: (canvas, feature) => {
    if (canvas.w * canvas.h < 12 && !feature.count) return
    Array.from({ length: feature.count ?? 1 }, (_, index) => index).forEach((index) =>
      wander(canvas, 90 + index * 7 + MODEL_FACES.indexOf(canvas.face), (u, v) => hex(feature.color) ?? shadow(canvas, u, v, 3), null),
    )
  },
  veins: (canvas, feature) => {
    if (canvas.w * canvas.h < 12 && !feature.count) return
    const color = hex(feature.color) ?? tone(hex(canvas.paint?.secondary) ?? canvas.get(0, 0), 3)
    Array.from({ length: feature.count ?? 1 }, (_, index) => index).forEach((index) =>
      wander(canvas, 130 + index * 7 + MODEL_FACES.indexOf(canvas.face), () => color, feature.glow === false ? null : color),
    )
  },
  band: (canvas, feature) => {
    const color = (u: number, v: number, lift: number) => {
      const base = hex(feature.color) ?? hex(canvas.paint?.secondary)
      return base ? tone(base, lift + FACE_SHADE[canvas.face]) : shadow(canvas, u, v, 2.6 - lift)
    }
    if (feature.shape === "frame")
      return rect(canvas, 0, 0, canvas.w, canvas.h, (u, v) => (u === 0 || v === 0 || u === canvas.w - 1 || v === canvas.h - 1 ? color(u, v, 0) : canvas.get(u, v)))
    const thick = clamp(feature.size ?? (canvas.h >= 8 ? 2 : 1), 1, canvas.h)
    const top = clamp(Math.round((feature.y ?? 0.5) * canvas.h - thick / 2), 0, canvas.h - thick)
    rect(canvas, 0, top, canvas.w, thick, (u, v) => color(u, v, thick > 1 ? (v === top ? 1 : v === top + thick - 1 ? -1 : 0) : 0))
  },
  claws: (canvas, feature) => {
    const count = feature.count ?? clamp(Math.floor((canvas.w + 1) / 2), 1, 3)
    const height = clamp(feature.size ?? (canvas.h >= 4 ? 2 : 1), 1, canvas.h)
    Array.from({ length: count }, (_, index) => Math.round(((index + 0.5) * canvas.w) / count - 0.5)).forEach((u) => {
      rect(canvas, u, canvas.h - height, 1, height, (_, v) => tone(hex(feature.color) ?? [237, 232, 218], v === canvas.h - 1 ? -1 : 0))
    })
  },
  gem: (canvas, feature) => {
    const size = clamp(feature.size ?? 3, 1, Math.min(canvas.w, canvas.h))
    const color = hex(feature.color) ?? [85, 214, 232]
    const centres = [feature.x ?? 0.5, ...(feature.mirror ? [1 - (feature.x ?? 0.5)] : [])]
    centres.forEach((x) => {
      const left = clamp(Math.round(x * canvas.w - size / 2), 0, canvas.w - size)
      const top = clamp(Math.round((feature.y ?? 0.5) * canvas.h - size / 2), 0, canvas.h - size)
      const radius = (size - 1) / 2
      const inside = (u: number, v: number, grow: number) =>
        feature.shape === "square" || size < 3
          ? u >= left - grow && v >= top - grow && u < left + size + grow && v < top + size + grow
          : Math.abs(u - left - radius) + Math.abs(v - top - radius) <= radius + grow
      // A dark setting first, then the stone lit from the top-left.
      if (size >= 3) rect(canvas, left - 1, top - 1, size + 2, size + 2, (u, v) => (inside(u, v, 1) ? shadow(canvas, u, v, 2.4) : canvas.get(u, v)))
      rect(canvas, left, top, size, size, (u, v) => {
        if (!inside(u, v, 0)) return canvas.get(u, v)
        const lit = (u - left - radius + (v - top - radius)) / Math.max(1, radius)
        return tone(color, lit < -0.6 ? 2.6 : lit > 0.6 ? -1.8 : 0)
      })
    })
  },
}

/** Faces a feature goes on when the document does not say. */
function featureFaces(feature: ModelFeature, size: Cube["size"]): readonly ModelFace[] {
  if (feature.face === "all") return MODEL_FACES
  // Eyes "on the sides" means one on each cheek, not four around the head.
  if (feature.face === "sides") return feature.type === "eyes" || feature.type === "brows" ? ["east", "west"] : ["north", "east", "south", "west"]
  if (feature.face) return [feature.face]
  if (feature.type === "belly") return ["down"]
  if (feature.type === "band" && feature.shape !== "frame") return ["north", "east", "south", "west"]
  if (feature.type === "stripes" && feature.shape !== "long") return size[1] === Math.max(...size) ? ["north", "east", "south", "west"] : ["up", "east", "west"]
  if (feature.type === "stripes") return MODEL_FACES
  if (feature.type === "spots") return ["up", "east", "west", "south"]
  if (feature.type === "cracks" || feature.type === "veins") return ["north", "east", "south", "west", "up"]
  return ["north"]
}

/** One cube face as RGB texels, row by row, and which of them a glow feature lit. */
function paintFace(design: ModelDesign, bone: Bone, given: Cube, face: ModelFace, shade: RichShade | null = null) {
  // A model at more than one model pixel to a texel is painted as the cube it would be at one texel to a pixel of that size: patterns, features and details are all in texels.
  const texel = texelOf(design)
  const cube = texel === 1 ? given : { ...given, size: texelSize(given.size, texel) }
  const [w, h] = faceSize(cube.size, face)
  const paint = cubePaint(design, bone, cube)
  const seed = hash(`${bone.name}/${cube.name}`)
  const side = face !== "up" && face !== "down"
  // Side faces share one strip of pattern coordinates so rows line up around the cube.
  const offset = side ? [0, cube.size[0], cube.size[0] + cube.size[2], cube.size[0] * 2 + cube.size[2]][MODEL_FACES.indexOf(face)]! : 0
  const levels = Array.from({ length: w * h }, (_, index) => {
    if (!paint) return 0
    const u = index % w
    const v = Math.floor(index / w)
    // Tiny faces stay flat: a pattern on four texels is only noise.
    if (w * h <= 6) return FACE_SHADE[face]
    const level = MATERIALS[paint.material]({ p: u + offset, q: v, w, h, side, r: (key, x, y) => random(seed + (side ? 0 : 1 + MODEL_FACES.indexOf(face)), key, x, y) })
    // The rim of a side face: lit along the top, darker where it meets the ground or the part below.
    const rim = side && h >= 4 && paint.material !== "metal" && paint.material !== "slime" ? (v === 0 ? 0.6 : v === h - 1 ? -0.7 : 0) : 0
    return level + rim + FACE_SHADE[face]
  })
  const own = cube.pixels?.[face]
  const texels = own
    ? // 第 1 步: a face painted pixel by pixel is drawn as written, in the face's own order (as surface_details are).
      own.data.map((value) => rgb(own.palette[value]!))
    : levels.map((level, index) => {
        if (!paint) return shade ? richTexel(shade, rgb(cube.faces[face]), null, 0, face, index % w, Math.floor(index / w), w, h, seed) : rgb(cube.faces[face])
        const second = paint.secondary && w * h > 6 && random(seed, 7, Math.floor(((index % w) + offset + Math.floor(index / w / 2)) / 3), Math.floor(index / w / 2) + (side ? 0 : 50 + MODEL_FACES.indexOf(face))) < 0.13
        const base = rgb(second ? paint.secondary! : paint.base)
        // Rich: the material's own pattern stays, softened, and the light, the edges, the seams and the wear are laid over it (`richTexel`).
        return shade ? richTexel(shade, base, paint, (level - FACE_SHADE[face]) * 0.75, face, index % w, Math.floor(index / w), w, h, seed + offset) : tone(base, level)
      })
  // Features are written the way one looks at the face: on the cheeks 0 is the front, on top 0 is the front too.
  const flipU = face === "east"
  const flipV = face === "down"
  const index = (u: number, v: number) => (flipV ? h - 1 - v : v) * w + (flipU ? w - 1 - u : u)
  const inside = (u: number, v: number) => u >= 0 && v >= 0 && u < w && v < h
  const lit = new Set<number>()
  const canvas: Canvas = {
    w,
    h,
    face,
    seed,
    size: cube.size,
    paint,
    get: (u, v) => texels[index(clamp(u, 0, w - 1), clamp(v, 0, h - 1))]!,
    // Whatever is painted over a lit texel later (a pupil, a detail) puts it out again.
    set: (u, v, color) => {
      if (!inside(u, v)) return
      texels[index(u, v)] = color
      lit.delete(index(u, v))
    },
    lit: (u, v, color) => {
      if (!inside(u, v)) return
      texels[index(u, v)] = color
      lit.add(index(u, v))
    },
    level: (u, v) => levels[index(clamp(u, 0, w - 1), clamp(v, 0, h - 1))]!,
    point: (u, v) => {
      if (face === "north" || face === "south") return [u + 0.5, cube.size[1] - v - 0.5, face === "north" ? 0 : cube.size[2]]
      if (face === "east" || face === "west") return [face === "east" ? cube.size[0] : 0, cube.size[1] - v - 0.5, u + 0.5]
      return [u + 0.5, face === "up" ? cube.size[1] : 0, v + 0.5]
    },
  }
  ;(cube.features ?? []).filter((feature) => featureFaces(feature, cube.size).includes(face)).forEach((feature) => FEATURES[feature.type](canvas, feature))
  cube.surface_details
    .filter((detail) => detail.face === face)
    .forEach((detail) => rect({ ...canvas, set: (u, v, color) => ((texels[v * w + u] = color), lit.delete(v * w + u)) }, detail.x, detail.y, detail.width, detail.height, () => rgb(detail.color)))
  return { texels, lit }
}

/**
 * The model's own texture: every cube face painted onto the atlas. Cubes with a material or
 * features are drawn by the painter; the others keep the flat face colour plus surface_details,
 * byte for byte as before materials existed. `glow` is a second picture of the same size holding only
 * the texels a glow feature lit (everything else transparent), or null when nothing glows.
 * 第 1 步: a model with `shading: "rich"` is painted with light, edges, seams and wear (`richTexel`); a face with its own `pixels`
 * is drawn as written; a cube that `share`s another's texture paints nothing of its own.
 */
export function paintModel(design: ModelDesign) {
  const size = design.texture_size
  const pixels = new Uint8Array(size * size * 4)
  const islands = modelAtlas(design)
  const glow = new Uint8Array(size * size * 4)
  const rich = design.shading === "rich" ? richShade(design) : null
  const lights = islands.map((island) => {
    if (island.shared) return 0
    const bone = design.bones[island.boneIndex]!
    const cube = bone.cubes[island.cubeIndex]!
    const face = paintFace(design, bone, cube, island.face, rich ? rich(island) : null)
    const texels = face.texels
    face.lit.forEach((index) => glow.set([...texels[index]!, 255], ((island.y + Math.floor(index / island.width)) * size + island.x + (index % island.width)) * 4))
    // The ring around an island keeps texture filtering from pulling in a neighbour: painted faces repeat
    // their edge, flat ones keep the face colour as they always did.
    const flat = cubePaint(design, bone, cube) || cube.features?.length || cube.pixels?.[island.face] || rich ? null : rgb(cube.faces[island.face])
    for (let row = -1; row <= island.height; row++)
      for (let column = -1; column <= island.width; column++)
        pixels.set(
          [...(row < 0 || column < 0 || row >= island.height || column >= island.width ? flat : null) ?? texels[clamp(row, 0, island.height - 1) * island.width + clamp(column, 0, island.width - 1)]!, 255],
          ((island.y + row) * size + island.x + column) * 4,
        )
    return face.lit.size
  })
  return { size, pixels, islands, glow: lights.some(Boolean) ? glow : null }
}

// ---- 第 1 步: rich shading, what a hand-painted boss texture has and a flat fill does not ----

/** What a rich face is painted with besides its colour: how dark each texel is for the parts around it (0 open, 1 pressed against another part). */
type RichShade = { occlusion: (u: number, v: number) => number; wear: number }

/** Low-frequency value noise in [-1, 1]: a smooth mottle `cell` texels across, the same for the same seed and place. */
function mottle(seed: number, x: number, y: number, cell: number) {
  const gx = Math.floor(x / cell)
  const gy = Math.floor(y / cell)
  const fx = x / cell - gx
  const fy = y / cell - gy
  const corner = (dx: number, dy: number) => random(seed, 911, gx + dx, gy + dy) * 2 - 1
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  return (corner(0, 0) * (1 - sx) + corner(1, 0) * sx) * (1 - sy) + (corner(0, 1) * (1 - sx) + corner(1, 1) * sx) * sy
}

const RUST: Rgb = [122, 70, 38]
const GRIME: Rgb = [58, 46, 36]
const AGED_BONE: Rgb = [176, 150, 96]

/**
 * One texel of a rich face. The level is what the material's pattern gives (`pattern`), plus: light by the way the face points (`FACE_SHADE`),
 * a gradient down a side (light at the top, dark at the foot), a lit top edge and left edge and a dark lower and right one (a bevel), a darker
 * band where another part presses on the face (`occlusion`), a smooth mottle; then the material's own wear: scratches and rust on metal, chips
 * and grime in stone's pits, weave and a dirty hem on cloth, stitching and scuffs on leather, yellowed ends on bone, grain on wood, glints
 * on crystal. Deterministic: the same cube paints the same every time.
 */
function richTexel(shade: RichShade, base: Rgb, paint: ModelPaint | null, pattern: number, face: ModelFace, u: number, v: number, w: number, h: number, seed: number): Rgb {
  const side = face !== "up" && face !== "down"
  const tiny = w * h <= 6
  const along = h > 1 ? v / (h - 1) : 0.5
  const across = w > 1 ? u / (w - 1) : 0.5
  const gradient = side ? 0.35 - along * 0.8 : face === "up" ? 0.15 - Math.abs(across - 0.5) * 0.3 - Math.abs(along - 0.5) * 0.3 : 0
  const bevel = tiny || w < 3 || h < 3 ? 0 : (v === 0 ? 0.75 : v === h - 1 ? -0.6 : 0) + (u === 0 ? 0.3 : u === w - 1 ? -0.3 : 0)
  const pressed = shade.occlusion(u, v)
  const material = paint?.material ?? null
  const wear = paint?.wear ?? shade.wear
  const noise = mottle(seed, u, v, 4) * 0.35 + mottle(seed + 17, u, v, 2) * 0.12
  let level = FACE_SHADE[face] + pattern + gradient + bevel - pressed * 1.5 + noise
  const pick = (key: number, x: number, y: number) => random(seed, key, x, y)
  if (material === "metal") {
    // Scratches: short diagonal runs of light, more of them the more worn.
    if (pick(301, Math.floor((u + v) / 3), u - v + 64) < 0.03 + wear * 0.07) level += 1.3
    if ((u + v) % 7 === 0 && pick(302, u, v) < 0.5) level += 0.25
  }
  if (material === "stone" && pick(311, Math.floor(u / 2), Math.floor(v / 2)) < 0.03 + wear * 0.08) level -= 1.4
  if (material === "stone" && (u === 0 || v === 0 || u === w - 1 || v === h - 1) && pick(312, u, v) < wear * 0.5) level -= 0.8
  if (material === "cloth") level += (u + v) % 2 === 0 ? 0.12 : -0.12
  if (material === "cloth" && side && v === h - 1 && pick(321, u, 0) < 0.3 + wear * 0.4) level -= 1.1
  if (material === "leather" && w >= 5 && h >= 5 && (u === 1 || u === w - 2 || v === 1 || v === h - 2) && (u + v) % 2 === 0) level += 1.2
  if (material === "leather" && pick(331, Math.floor(u / 2), v) < wear * 0.1) level += 0.7
  if (material === "wood") level += Math.sin((side ? u : v) * 1.7 + mottle(seed + 5, u, v, 3) * 2.2) * 0.35
  if (material === "wood" && pick(341, Math.floor(u / 3), Math.floor(v / 4)) < 0.02) level -= 1.2
  if (material === "crystal") level += (across - along) * 0.9 + (u === 1 && v === 1 && w >= 4 && h >= 4 ? 2.2 : 0)
  if (material === "bone" && pick(351, u, Math.floor(v / 2)) < wear * 0.05) level -= 1.2
  let color = tone(base, clamp(level, -3.2, 3))
  // Wear that is another colour: rust on metal where water sits (low down, in seams), grime low on stone, cloth and leather, bone yellowed at its ends.
  const low = side ? along : 0.5
  if (material === "metal") color = mix(color, RUST, clamp((mottle(seed + 31, u, v, 3) * 0.5 + 0.5) * wear * 1.2 + low * wear * 0.5 + pressed * wear - 0.55, 0, 0.75))
  if (material === "stone" || material === "cloth" || material === "leather") color = mix(color, GRIME, clamp(low * wear * 0.45 + pressed * 0.25, 0, 0.5))
  if (material === "bone") color = mix(color, AGED_BONE, clamp((side ? Math.abs(along - 0.5) * 2 : 0.3) * wear * 0.6, 0, 0.5))
  return color
}

/**
 * The rich painter's view of the whole model: for every face, how much each texel is pressed against another part — a sample a little off
 * the face that lands inside another cube is in its shadow (a seam), one a little further that is near one is half in it. Plain geometry.
 */
function richShade(design: ModelDesign) {
  const boxes = placedCubes(design)
  const texel = texelOf(design)
  const at = new Map(boxes.map((box) => [`${box.boneIndex}/${box.cubeIndex}`, box]))
  const near = (a: PlacedCube, b: PlacedCube, grow: number) => a.min.every((value, axis) => value - grow <= b.max[axis]! && b.min[axis]! - grow <= a.max[axis]!)
  const neighbours = new Map(boxes.map((box) => [box, boxes.filter((other) => other !== box && near(box, other, 2))]))
  return (island: AtlasIsland): RichShade => {
    const box = at.get(`${island.boneIndex}/${island.cubeIndex}`)!
    const others = neighbours.get(box)!
    const [across, down] = faceSize(box.cube.size, island.face)
    return {
      wear: 0.35,
      occlusion: (u, v) => {
        if (!others.length) return 0
        const close = texelPoint(box, island.face, u, v, 0.6, texel, across, down)
        if (others.some((other) => other.holds(close, 0))) return 1
        const further = texelPoint(box, island.face, u, v, 1.8, texel, across, down)
        return others.some((other) => other.holds(further, 0.3)) ? 0.45 : 0
      },
    }
  }
}

/**
 * 第 1 步: how flat a model's texture is — of all the texels its own faces have (shared faces counted once), the share that is the one
 * colour its face is mostly painted in. 1 is a model of single-colour boxes; a hand-painted boss is well under half. `flatFaces`: faces
 * of at least 8 texels that are one colour throughout.
 */
export function paintFlatness(design: ModelDesign, painted: { size: number; pixels: Uint8Array; islands: AtlasIsland[] } = paintModel(design)) {
  let area = 0
  let flat = 0
  let faces = 0
  let flatFaces = 0
  for (const island of painted.islands) {
    if (island.shared) continue
    const counts = new Map<number, number>()
    for (let row = 0; row < island.height; row++)
      for (let column = 0; column < island.width; column++) {
        const at = ((island.y + row) * painted.size + island.x + column) * 4
        const key = (painted.pixels[at]! << 16) | (painted.pixels[at + 1]! << 8) | painted.pixels[at + 2]!
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    const most = Math.max(...counts.values())
    const size = island.width * island.height
    area += size
    flat += most
    if (size >= 8) {
      faces += 1
      if (counts.size === 1) flatFaces += 1
    }
  }
  return { ratio: area ? flat / area : 0, area, faces, flatFaces }
}

/** That measure in a sentence for whoever makes or reviews the model. */
export function paintFlatnessLine(design: Pick<ModelDesign, "shading">, measured: ReturnType<typeof paintFlatness>) {
  const percent = Math.round(measured.ratio * 100)
  return (
    `贴图量出来的平涂占比 ${percent}%：每个面里用得最多的那一种颜色，加起来占所有面的 ${percent}%（100% 是一个面一种颜色的积木；手绘纹理通常在 40% 以下）；${measured.faces} 个不小于 8 个像素的面里有 ${measured.flatFaces} 个整面只有一种颜色。` +
    (design.shading === "rich"
      ? "这个模型写了 shading: \"rich\"（按朝向的明暗、边缘高光、接缝暗边和材质磨损）。"
      : "这个模型没有写 shading: \"rich\"：Boss 和史诗档的模型应当写上，再用 pixels（或脚本的 draw）手画脸、纹样这些要紧的面。")
  )
}
