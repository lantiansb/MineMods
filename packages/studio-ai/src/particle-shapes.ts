// Published pixels are part of a project's assets. Improvements must use a new shape name.
import { z } from "zod"

export const SHAPES = [
  "dot",
  "glint",
  "spark",
  "ember",
  "puff",
  "mist",
  "wisp",
  "streak",
  "shard",
  "ring",
  "drop",
  "flake",
  "bolt",
  "arc",
] as const
export const SHAPE_PARAMETERS = {
  dot: "光点",
  glint: "星芒，points 为 4 或 8",
  spark: "带尾火星",
  ember: "余烬",
  mist: "软雾，中心实、边缘渐淡，适合多团叠放",
  puff: "烟团，stage 控制消散",
  wisp: "雾带",
  streak: "细线",
  shard: "碎片",
  ring: "环，radius 是半径占边长的比例（0.1 到 0.48），width 是像素宽（0.5 到 4），gaps 是缺口数（0 到 8），stage 控制扩张",
  drop: "水滴，hollow 为 true 时只留气泡轮廓",
  flake: "屑片",
  bolt: "电弧",
  arc: "月牙，angle 是张角（30 到 360 度）",
}
const common = {
  seed: z.number().int().min(-2147483648).max(2147483647).optional(),
  side: z.union([z.literal(8), z.literal(16), z.literal(32)]).optional(),
  stage: z.number().min(0).max(1).optional(),
}
export const ShapeFrameSchema = z.discriminatedUnion("shape", [
  z.strictObject({
    shape: z.enum(["dot", "spark", "ember", "puff", "mist", "wisp", "streak", "shard", "flake", "bolt"]),
    ...common,
  }),
  z.strictObject({ shape: z.literal("glint"), ...common, points: z.union([z.literal(4), z.literal(8)]).optional() }),
  z.strictObject({
    shape: z.literal("ring"),
    ...common,
    radius: z.number().min(0.1).max(0.48).optional(),
    width: z.number().min(0.5).max(4).optional(),
    gaps: z.number().int().min(0).max(8).optional(),
  }),
  z.strictObject({ shape: z.literal("drop"), ...common, hollow: z.boolean().optional() }),
  z.strictObject({ shape: z.literal("arc"), ...common, angle: z.number().min(30).max(360).optional() }),
])
export type ShapeFrame = z.infer<typeof ShapeFrameSchema>

// Self-contained so the drawing worker can install exactly the same arithmetic inside its own realm.
export function shapeRaster(frame: ShapeFrame, textureSize?: 64) {
  const side = textureSize ?? frame.side ?? 16
  if (textureSize !== 64 && ![8, 16, 32].includes(side)) throw new Error("形状边长选 8、16 或 32")
  const pixels = Array<number>(side * side * 4).fill(0)
  const stage = frame.stage ?? 0
  let seed = (frame.seed ?? 1) >>> 0
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
  const circle = Math.PI * 2
  const turn = rand() * circle
  const cos = Math.cos(turn),
    sin = Math.sin(turn)
  const length = side * (0.3 + rand() * 0.15)
  const circles = Array.from({ length: 3 + Math.floor(rand() * 3) }, () => {
    const angle = rand() * circle,
      radius = rand() * 0.18 * side
    return [
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      (0.16 + rand() * 0.12) * side * (0.6 + 0.6 * stage),
    ] as const
  })
  const points = 3 + Math.floor(rand() * 3)
  const polygon = Array.from({ length: points }, (_, i) => {
    const a = turn + ((i + rand() * 0.22) * circle) / points,
      r = side * (0.28 + rand() * 0.1)
    return [r * Math.cos(a), r * Math.sin(a)] as const
  })
  const bands = Array.from(
    { length: 2 + Math.floor(rand() * 2) },
    () => [side * (rand() - 0.5) * 0.42, rand() * circle] as const,
  )
  const bolt = Array.from(
    { length: points + 1 },
    (_, i) => [(rand() - 0.5) * side * 0.48, (i / points - 0.5) * side * 0.86] as const,
  )
  const segments = bolt.slice(1).map((b, i) => [bolt[i]!, b] as const)
  segments.push([bolt[1]!, [bolt[1]![0] + side * 0.26, bolt[1]![1] + side * 0.23]])
  const segmentDistance = (x: number, y: number, [a, b]: (typeof segments)[number]) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)
  }
  const noise = Array.from({ length: side * side }, rand)
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      const x = i + 0.5 - side / 2,
        y = j + 0.5 - side / 2,
        d = Math.hypot(x, y),
        u = x * cos + y * sin,
        v = y * cos - x * sin
      const n = noise[j * side + i]!,
        taper = Math.sin((Math.PI * (i + 0.5)) / side)
      let alpha = 0,
        shade = 255
      switch (frame.shape) {
        case "dot":
          alpha = Math.max(0, 1 - (d / (side * 0.42)) ** 2) ** 2
          break
        case "glint": {
          const axis = Math.min(Math.abs(x), Math.abs(y)) <= 0.51 ? 1 - d / (side * 0.46) : 0
          const diagonal = frame.points === 8 && Math.abs(Math.abs(x) - Math.abs(y)) < 0.6 ? 1 - d / (side * 0.25) : 0
          alpha = Math.max(axis, diagonal)
          break
        }
        case "spark":
          alpha =
            u >= -1 && u < length && Math.abs(v - (u > length * 0.4 && u < length * 0.8 ? 1 : 0)) <= 0.85
              ? 1 - (Math.max(0, u) / length) * 0.78
              : 0
          break
        case "ember": {
          const edge = Math.abs(x) + Math.abs(y) - side * 0.2
          alpha =
            edge < -0.75
              ? 1
              : (edge <= 0.5 && n >= 0.35) || (edge <= 1.5 && n < 0.35 && (Math.abs(x) < 1 || Math.abs(y) < 1))
                ? 2 / 3
                : 0
          shade = alpha === 1 ? 255 : 207
          break
        }
        case "mist": {
          // Overlapping, offset lobes keep a bank of fog from repeating a circular outline.
          const xx = 2 * x / side, yy = 2 * y / side
          const density = (cx: number, cy: number, rx: number, ry: number) =>
            Math.max(0, 1 - ((xx-cx)/rx)**2 - ((yy-cy)/ry)**2)**2
          const bank = 0.45*density(-0.32,0.12,0.65,0.34)
            + 0.55*density(0.09,-0.05,0.73,0.45)
            + 0.32*density(0.52,0.08,0.46,0.27)
          alpha = Math.min(1, bank) * (0.92 + 0.08*n) * (1 - 0.45*stage)
          break
        }
        case "puff": {
          const inside = circles.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < r)
          const block = noise[Math.floor(j / 2) * side + Math.floor(i / 2)]!
          alpha = inside && block > 0.25 + 0.35 * stage ? (block > 0.65 ? 2 / 3 : 1 / 3) * (1 - stage * 0.45) : 0
          shade = x + y > side * 0.08 ? 205 : 255
          break
        }
        case "wisp":
          alpha = bands.some(
            ([offset, phase]) => Math.abs(y - offset - Math.sin((x / side) * 5 + phase) * side * 0.1) < taper * 1.3,
          )
            ? taper > 0.65
              ? 2 / 3
              : 1 / 3
            : 0
          break
        case "streak":
          alpha =
            Math.abs(y) <= Math.max(0.5, Math.round((1 + (cos > 0 ? 1 : 0)) * taper ** 0.7)) && taper > 0.12
              ? Math.max(1 / 3, taper)
              : 0
          break
        case "shard":
          alpha = polygon.every(([px, py], k) => {
            const [qx, qy] = polygon[(k + 1) % points]!
            return (qx - px) * (y - py) - (qy - py) * (x - px) >= 0
          })
            ? 1
            : 0
          shade = u > 0 ? 255 : 205
          break
        case "ring": {
          const delta = Math.abs(d - side * (frame.radius ?? 0.36) * (0.65 + 0.35 * stage)) - (frame.width ?? 1) / 2
          alpha =
            (frame.gaps ?? 0) > 0 && Math.cos((Math.atan2(y, x) - turn) * frame.gaps!) > 0.85
              ? 0
              : Math.max(0, 1 - Math.max(0, delta) * 0.7)
          break
        }
        case "drop": {
          const r = side * 0.21,
            off = cos * 0.5,
            dx = Math.abs(x - off),
            dy = y - side * 0.07
          const edge = dy >= 0 ? r - Math.hypot(dx, dy) : r + dy * 0.55 - dx
          alpha = edge >= 0 && (!frame.hollow || edge <= 1.3) ? 1 : 0
          shade = dx < 1.5 && x <= off && y < 0 ? 255 : 214
          if (Math.hypot(x + r * 0.47, y + r * 0.12) < 1) {
            alpha = 1
            shade = 255
          }
          break
        }
        case "flake":
          alpha = Math.abs(u) / (side * 0.09) + Math.abs(v) / (side * 0.21) <= 1 && !(u > 0.4 && v > 1) ? 1 : 0
          break
        case "bolt": {
          const near = Math.min(...segments.map((s) => segmentDistance(x, y, s)))
          alpha = near < 0.6 ? 1 : near < 1.4 ? 1 / 3 : 0
          break
        }
        case "arc": {
          const a = Math.atan2(x, -y),
            span = ((frame.angle ?? 140) * Math.PI) / 360
          const inward = side * 0.43 - d,
            thick = side * 0.17 * Math.cos(((a / span) * Math.PI) / 2)
          alpha = Math.abs(a) <= span && inward >= 0 && inward <= thick ? 1 - (inward / (thick + 0.001)) * 0.65 : 0
          break
        }
      }
      const opacity = frame.shape === "mist" ? Math.round(255 * alpha) : 85 * Math.round(Math.max(0, Math.min(1, alpha)) * 3)
      if (opacity) {
        const index = (j * side + i) * 4
        pixels[index] = pixels[index + 1] = pixels[index + 2] = shade
        pixels[index + 3] = opacity
      }
    }
  if (frame.shape === "puff") {
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) {
        const i = (y * side + x) * 4
        if (!pixels[i + 3]) continue
        const neighbor =
          (x > 0 && pixels[i - 1]) ||
          (x + 1 < side && pixels[i + 7]) ||
          (y > 0 && pixels[i - side * 4 + 3]) ||
          (y + 1 < side && pixels[i + side * 4 + 3])
        if (!neighbor) pixels.fill(0, i, i + 4)
      }
  }
  return { width: side, height: side, pixels }
}

export function shapePixels(frame: ShapeFrame) {
  const image = shapeRaster(frame)
  return { ...image, pixels: Uint8Array.from(image.pixels) }
}
