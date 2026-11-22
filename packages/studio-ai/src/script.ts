/**
 * Script modelling: a second, equal way to hand in a model, a texture or an animation. Instead of typing
 * every coordinate, the maker writes a short JavaScript program; Studio runs it shut away from everything
 * and what it returns is an ordinary document, checked and looked at like any other.
 *
 * What the script is given is a medium, not a kit: bones, boxes, keyframes, pixels and a little geometry.
 * Nothing in it knows what any subject is. `SCRIPT_DENIED` and a test keep it that way.
 * No imports beyond the one convention on left and right (itself import-free), so the modelling service and the app both read it.
 */
import type { ShapeFrame, shapeRaster } from "./particle-shapes"
import { ANIMATION_GUIDE } from "./animation"
import { ORIENTATION_GUIDE } from "./orientation"
import { BUDGET_GUIDE, DEFAULT_TIER, GEOMETRY_TIERS, LEGACY_TEXTURE, TEXTURE_SIZES, TIER_CEILING } from "./budget"

/**
 * `source`: characters of script. `seconds`: how long it may compute. `memory_mb`: how much it may hold.
 * `output`: characters of JSON it may hand back. `notes`: lines it may leave for its author. The rest are
 * the document's own limits, said here so a script is stopped at the line that crosses one: `bones` to `keys`
 * are the default geometry tier's (`budget.ts`), which a model that names no tier is held to; `tiers` are all
 * of them, for a model that names one. `texture` is the largest picture of a block or an item, `canvas` the
 * largest canvas (the largest texture any tier allows), `sizes` the texture sizes a model may have.
 */
export const SCRIPT_LIMITS = { source: 180_000, seconds: 2, memory_mb: 64, output: 4_000_000, notes: 20, note: 300, bones: GEOMETRY_TIERS[DEFAULT_TIER].bones, cubes: GEOMETRY_TIERS[DEFAULT_TIER].cubes, bone_cubes: GEOMETRY_TIERS[DEFAULT_TIER].bone_cubes, animations: GEOMETRY_TIERS[DEFAULT_TIER].animations, channels: GEOMETRY_TIERS[DEFAULT_TIER].bones, keys: GEOMETRY_TIERS[DEFAULT_TIER].keys, texture: 256, palette: 256, details: 64, /** The longest side, in pixels, of a concept picture handed into the sandbox for `api.trace`: 256 is 16× the 16-pixel texture it is traced down to (more cannot show), and 256×256×4 = 262 144 numbers is what the sandbox can walk several times inside its 2 seconds. */ trace: 256, /** The most concept pictures one script is handed: all that `save_concepts` keeps (`REFERENCE_LIMITS.concept` in making.ts; a test holds the two together); each is at most 256×256×4 = 256 KiB of bytes in the script's memory. */ pictures: 3, /** The most cells one solid (`bone.solid`) is sampled in: a 40-pixel cube at step 1. Past it a coarser step or smaller pieces is asked for. */ solid_cells: 64_000, detail_pixels: 4096, canvas: LEGACY_TEXTURE, sizes: TEXTURE_SIZES, tier: DEFAULT_TIER, tiers: GEOMETRY_TIERS } as const

/** The kinds a script may produce. */
export const SCRIPTED_KINDS = ["model", "texture", "animation"] as const
export type ScriptedKind = (typeof SCRIPTED_KINDS)[number]
export const isScripted = (kind: string): kind is ScriptedKind => (SCRIPTED_KINDS as readonly string[]).includes(kind)

/** What the script is told about the model a texture dresses or an animation moves: its bones, and where each face lies on the texture. */
export type ScriptWears = {
  texture_size: number
  bones: { name: string; parent: string | null; pivot: number[]; rotation: number[]; cubes: { name: string; origin: number[]; size: number[] }[] }[]
  faces: { bone: string; cube: string; face: string; x: number; y: number; width: number; height: number }[]
}

/**
 * Everything a script can reach, built inside the sandbox from this function's own text: it must not use
 * anything defined outside itself. Written as a function, not a string, so it is type-checked and can be
 * called directly in a test. Returns the frozen `api`, the notes it collected, and `finish`, which turns
 * what the script returned into the JSON text that leaves the sandbox.
 */
/**
 * A concept picture as the sandbox is given it: decoded outside (PNG, JPEG or WebP, `image-decode.ts`), fitted to at most `SCRIPT_LIMITS.trace` pixels
 * on the long side, and written as base64 of raw RGBA, row by row, because the sandbox has no typed arrays and a long list of numbers in JSON is four times as big.
 * A picture that could not be read is handed in as its name and why, so the script's author is told and not left with a missing name.
 */
export type TracePicture = { name: string; width: number; height: number; rgba: string } | { name: string; error: string }

export function scriptApi(given: { wears: ScriptWears | null; limits: typeof SCRIPT_LIMITS; flat?: boolean; particle?: boolean; shapeNames?: readonly string[]; pictures?: TracePicture[] }, raster: typeof shapeRaster | undefined = undefined) {
  type V = [number, number, number]
  type Paint = Record<string, unknown>
  type Cube = { name: string; origin: V; size: V; faces: Record<string, string>; surface_details: Record<string, unknown>[]; paint?: unknown; features?: unknown; rotation?: V; pivot?: V; inflate?: number; mirror?: boolean; share?: string; pixels?: Record<string, { palette: string[]; data: number[] }> }
  type Bone = { name: string; parent: string | null; pivot: V; rotation: V; paint?: unknown; cubes: Cube[] }
  // A track of a motion, as the animation contract names them, with how far a key of it may go.
  type Track = "rotation" | "position" | "scale"
  type Key = { time: number; value: V; interpolation: string }
  type Motion = { name: string; length: number; loop: boolean; channels: { bone: string; tracks: Record<Track, Key[]> }[] }
  type Canvas = { width: number; height: number; pixels: string[] }
  type Named = string | { name: string }

  const L = given.limits
  const FACES = ["north", "east", "south", "west", "up", "down"] as const
  const NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/
  // The three motions every model document has to carry: a rule of the document, not of any subject.
  const REQUIRED = ["idle", "walk", "hurt"]
  const HEX = /^#[0-9a-fA-F]{6}$/
  const notes: string[] = []
  const fail = (message: string): never => {
    throw new Error(message)
  }
  // Geometry tiers (`budget.ts`), as data: which one a model or a motion is held to, and what to say when its limit is reached.
  type Tier = { id: string; name: string; cubes: number; bones: number; bone_cubes: number; texture: number; animations: number; keys: number; total_keys: number | null; face_pixels?: boolean }
  const tierIds = Object.keys(L.tiers)
  const tierAt = (id: string): Tier => ({ id, ...(L.tiers as Record<string, Omit<Tier, "id">>)[id]! })
  const budgetOf = (asked: unknown, what: string): Tier =>
    asked === undefined || asked === null ? tierAt(L.tier) : typeof asked === "string" && tierIds.includes(asked) ? tierAt(asked) : fail(`${what}的 budget 只能是 ${tierIds.join("、")} 之一（不写就是 ${L.tier}），现在是 ${typeof asked === "string" ? `"${asked.slice(0, 40)}"` : typeof asked}。`)
  /** The way on from a limit: the next tier that allows more of it, or that there is none. Never a silent cut. */
  const higher = (tier: Tier, limit: "cubes" | "bones" | "bone_cubes" | "texture" | "animations" | "keys" | "total_keys", unit: string) =>
    ((next) => (next ? `确实需要更多，就把 budget 写成 "${next.id}"（「${next.name}」档最多 ${next[limit]} ${unit}），并在部件说明的 budget 里写明为什么需要。` : tierIds.length > 1 ? "这已经是最高的一档。" : ""))(tierIds.slice(tierIds.indexOf(tier.id) + 1).map(tierAt).find((other) => (other[limit] ?? Infinity) > (tier[limit] ?? Infinity)))
  const show = (value: unknown) => (typeof value === "string" ? `"${value.slice(0, 40)}"` : typeof value === "number" || typeof value === "boolean" || value === null || value === undefined ? String(value) : Array.isArray(value) ? `[${value.slice(0, 4).map(String).join(", ")}${value.length > 4 ? ", …" : ""}]` : typeof value)
  const number = (value: unknown, what: string) => (typeof value === "number" && Number.isFinite(value) ? value : fail(`${what}要是一个数，现在是 ${show(value)}。`))
  const whole = (value: unknown, what: string, min: number, max: number) => (Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? (value as number) : fail(`${what}要是 ${min} 到 ${max} 之间的整数，现在是 ${show(value)}。`))
  const vector = (value: unknown, what: string): V => (Array.isArray(value) && value.length === 3 ? [number(value[0], what), number(value[1], what), number(value[2], what)] : fail(`${what}要写成 [x, y, z] 三个数，现在是 ${show(value)}。`))
  const colour = (value: unknown, what: string) => (typeof value === "string" && HEX.test(value) ? value.toLowerCase() : fail(`${what}要写成 "#RRGGBB" 这样的颜色，现在是 ${show(value)}。`))
  const named = (value: unknown, what: string) => (typeof value === "string" && NAME.test(value) ? value : fail(`${what}要用英文字母开头，只含字母、数字和下划线，最多 48 个字符，现在是 ${show(value)}。`))
  const options = (value: unknown, what: string) => (value === undefined ? {} : typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : fail(`${what}要写成 { … } 这样的一组选项，现在是 ${show(value)}。`))
  const tidy = (value: number) => Math.round(value * 1000) / 1000 + 0
  const tidied = (value: V): V => [tidy(value[0]), tidy(value[1]), tidy(value[2])]

  // Vectors are plain [x, y, z] arrays, in the document's own axes: Y up, the front is -Z, +X is the thing's own left (see orientation.ts).
  const add = (a: unknown, b: unknown): V => ((p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]] as V)(vector(a, "add 的第一个向量"), vector(b, "add 的第二个向量"))
  const sub = (a: unknown, b: unknown): V => ((p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]] as V)(vector(a, "sub 的第一个向量"), vector(b, "sub 的第二个向量"))
  const scale = (a: unknown, by: unknown): V => ((p, k) => [p[0] * k, p[1] * k, p[2] * k] as V)(vector(a, "scale 的向量"), number(by, "scale 的倍数"))
  const length = (a: unknown) => ((p) => Math.hypot(p[0], p[1], p[2]))(vector(a, "length 的向量"))
  const lerp = (a: unknown, b: unknown, t: unknown): number | V => {
    const at = number(t, "lerp 的 t")
    if (typeof a === "number" && typeof b === "number") return a + (b - a) * at
    return add(a, scale(sub(b, a), at))
  }
  const clamp = (value: unknown, low: unknown, high: unknown) => Math.min(number(high, "clamp 的上限"), Math.max(number(low, "clamp 的下限"), number(value, "clamp 的值")))
  const smooth = (t: unknown) => ((x) => x * x * (3 - 2 * x))(clamp(t, 0, 1))
  const rad = (degrees: unknown) => (number(degrees, "rad 的角度") * Math.PI) / 180
  const deg = (radians: unknown) => (number(radians, "deg 的弧度") * 180) / Math.PI
  const mirror = (a: unknown): V => ((p) => [-p[0] + 0, p[1], p[2]] as V)(vector(a, "mirror 的向量"))

  // Rotation as the game does it: X is mirrored, the X and Y angles are negated, and Z, Y, X are multiplied in that order.
  const flipped = (p: V): V => [-p[0] + 0, p[1], p[2]]
  const times = (a: number[], b: number[]) => Array.from({ length: 9 }, (_, index) => [0, 1, 2].reduce((sum, k) => sum + a[Math.floor(index / 3) * 3 + k]! * b[k * 3 + (index % 3)]!, 0))
  const turned = (matrix: number[], p: V): V => [0, 1, 2].map((row) => matrix[row * 3]! * p[0] + matrix[row * 3 + 1]! * p[1] + matrix[row * 3 + 2]! * p[2]) as V
  const inverse = (matrix: number[]) => Array.from({ length: 9 }, (_, index) => matrix[(index % 3) * 3 + Math.floor(index / 3)]!)
  const matrixOf = (rotation: V) => {
    const x = (-rotation[0] * Math.PI) / 180
    const y = (-rotation[1] * Math.PI) / 180
    const z = (rotation[2] * Math.PI) / 180
    return times([Math.cos(z), -Math.sin(z), 0, Math.sin(z), Math.cos(z), 0, 0, 0, 1], times([Math.cos(y), 0, Math.sin(y), 0, 1, 0, -Math.sin(y), 0, Math.cos(y)], [1, 0, 0, 0, Math.cos(x), -Math.sin(x), 0, Math.sin(x), Math.cos(x)]))
  }
  /** The angles that give a rotation matrix back, in the document's signs. */
  const anglesOf = (m: number[]): V => {
    const locked = Math.abs(m[6]!) > 0.99999
    const x = locked ? Math.atan2(-m[5]!, m[4]!) : Math.atan2(m[7]!, m[8]!)
    const y = Math.asin(Math.max(-1, Math.min(1, -m[6]!)))
    const z = locked ? 0 : Math.atan2(m[3]!, m[0]!)
    return [(-x * 180) / Math.PI, (-y * 180) / Math.PI, (z * 180) / Math.PI]
  }
  const unit = (p: V): V => ((size) => (size < 1e-9 ? [0, 0, 0] : [p[0] / size, p[1] / size, p[2] / size]))(Math.hypot(p[0], p[1], p[2]))
  const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  /** The smallest turn that carries one direction onto another. */
  const swing = (from: V, to: V) => {
    const cosine = Math.max(-1, Math.min(1, dot(from, to)))
    // Opposite directions have no smallest turn: any axis square to them will do.
    const axis = unit(cosine < -0.99999 ? cross(from, Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]) : cross(from, to))
    const sine = Math.sin(Math.acos(cosine))
    const k = [0, -axis[2], axis[1], axis[2], 0, -axis[0], -axis[1], axis[0], 0]
    const kk = times(k, k)
    return [1, 0, 0, 0, 1, 0, 0, 0, 1].map((value, index) => value + sine * k[index]! + (1 - cosine) * kk[index]!)
  }
  const rotate = (point: unknown, pivot: unknown, rotation: unknown): V => {
    const about = flipped(vector(pivot, "rotate 的轴心"))
    const moved = turned(matrixOf(vector(rotation, "rotate 的角度")), sub(flipped(vector(point, "rotate 的点")), about))
    return tidied(flipped([moved[0] + about[0], moved[1] + about[1], moved[2] + about[2]]))
  }

  /** Random numbers that come out the same every time for the same seed. */
  const random = (seed: unknown) => {
    const text = String(seed ?? 1)
    const state = { value: Array.from(text).reduce((hash, letter) => (Math.imul(hash ^ letter.charCodeAt(0), 16777619) >>> 0), 2166136261) }
    const next = () => {
      state.value = (state.value + 0x6d2b79f5) >>> 0
      const mixed = Math.imul(state.value ^ (state.value >>> 15), state.value | 1)
      const again = mixed ^ (mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61))
      return ((again ^ (again >>> 14)) >>> 0) / 4294967296
    }
    return Object.freeze(Object.assign(next, {
      between: (low: unknown, high: unknown) => number(low, "between 的下限") + (number(high, "between 的上限") - number(low, "between 的下限")) * next(),
      whole: (low: unknown, high: unknown) => Math.floor(number(low, "whole 的下限") + (number(high, "whole 的上限") - number(low, "whole 的下限") + 1) * next()),
      pick: (list: unknown) => (Array.isArray(list) && list.length ? (list[Math.floor(next() * list.length)] as unknown) : fail("pick 要一个不空的列表。")),
    }))
  }

  const channels = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16))
  const hexOf = (values: number[]) => `#${values.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`
  const mix = (a: unknown, b: unknown, t: unknown) => ((p, q, at) => hexOf(p.map((value, index) => value + (q[index]! - value) * at)))(channels(colour(a, "mix 的第一个颜色")), channels(colour(b, "mix 的第二个颜色")), clamp(t, 0, 1))
  const shade = (value: unknown, amount: unknown) => ((by) => mix(value, by < 0 ? "#000000" : "#ffffff", Math.abs(by)))(clamp(amount, -1, 1))
  /** Six face colours from one: the top lighter and the bottom darker by `amount`, as if lit from above. */
  const lit = (value: unknown, amount: unknown = 0.12) => ((base, by) => ({ north: base, east: shade(base, -by / 3), south: shade(base, -by / 2), west: shade(base, -by / 3), up: shade(base, by), down: shade(base, -by * 1.5) }))(colour(value, "lit 的颜色"), clamp(amount, 0, 1))

  const path = (points: unknown, what: string) => (Array.isArray(points) && points.length >= 2 ? points.map((point) => vector(point, `${what}里的点`)) : fail(`${what}要是至少两个 [x, y, z] 点的列表。`))
  /** The point a share of the way along a line through several points. */
  const along = (points: unknown, t: unknown): V => {
    const line = path(points, "along 的 points")
    const spans = line.slice(1).map((point, index) => length(sub(point, line[index]!)))
    const target = clamp(t, 0, 1) * spans.reduce((sum, value) => sum + value, 0)
    const walked = spans.reduce<{ left: number; found: V | null }>((state, span, index) => (state.found ? state : state.left <= span || index === spans.length - 1 ? { left: 0, found: lerp(line[index]!, line[index + 1]!, span < 1e-9 ? 0 : Math.min(1, state.left / span)) as V } : { left: state.left - span, found: null }), { left: target, found: null })
    return tidied(walked.found ?? line[0]!)
  }
  /** A smooth line through the given points, cut into `count` equal pieces: `count + 1` points. */
  const curve = (points: unknown, count: unknown): V[] => {
    const line = path(points, "curve 的 points")
    const pieces = whole(count, "curve 的段数", 1, 256)
    const at = (index: number) => line[Math.max(0, Math.min(line.length - 1, index))]!
    const dense = line.slice(1).flatMap((_, span) =>
      Array.from({ length: 12 }, (_, step) => {
        const t = step / 12
        return [0, 1, 2].map((axis) => 0.5 * (2 * at(span)[axis]! + (at(span + 1)[axis]! - at(span - 1)[axis]!) * t + (2 * at(span - 1)[axis]! - 5 * at(span)[axis]! + 4 * at(span + 1)[axis]! - at(span + 2)[axis]!) * t * t + (3 * at(span)[axis]! - at(span - 1)[axis]! - 3 * at(span + 1)[axis]! + at(span + 2)[axis]!) * t * t * t)) as V
      }),
    )
    return Array.from({ length: pieces + 1 }, (_, index) => along([...dense, line[line.length - 1]!], index / pieces))
  }

  const faceSize = (size: unknown, face: unknown, texel?: unknown): [number, number] => {
    const given = vector(size, "faceSize 的 size")
    // A model written with texel_size 2 or 4 has a texel to every 2×2 or 4×4 of its pixels: its faces are that much smaller in texels.
    const every = texel === undefined || texel === null ? 1 : texel === 1 || texel === 2 || texel === 4 ? texel : fail(`faceSize 的第三个参数是模型的 texel_size：1、2 或 4，现在是 ${show(texel)}。`)
    const box = every === 1 ? given : given.map((value) => Math.max(1, Math.ceil(value / every - 1e-9)))
    if (face === "up" || face === "down") return [box[0], box[2]]
    if (face === "east" || face === "west") return [box[2], box[1]]
    if (face === "north" || face === "south") return [box[0], box[1]]
    return fail(`面的名字只能是 ${FACES.join("、")}，现在是 ${show(face)}。`)
  }

  /**
   * Where the faces of a set of boxes lie on one sheet, for a block that is boxes put together: each face gets a block of
   * the sheet as large as the face covers at `density` pixels of the sheet to a pixel of the block (a part of one rounds up),
   * laid in rows from the tallest down, a row ending where the next does not fit. Returns the boxes with their uv, and where each face is.
   * The game's own textures have a pixel of the picture to a pixel of the block, so that is the density when none is asked for.
   */
  const layout = (boxes: unknown, asked?: unknown) => {
    const settings = options(asked, "layout 的选项")
    const wantedSide = settings.size === undefined ? 16 : settings.size
    const side = wantedSide === 16 || wantedSide === 32 || wantedSide === 64 ? wantedSide : fail(`layout 的 size（sheet 是多少像素见方）只能是 16、32 或 64，现在是 ${show(wantedSide)}。`)
    const gap = settings.gap === undefined ? 0 : whole(settings.gap, "layout 的 gap", 0, 4)
    // A pixel of the block to one of the sheet is how fine the game's own textures are; up to four (a 64 sheet on a 16 block) and down to a quarter.
    const density = settings.density === undefined ? 1 : Math.min(4, Math.max(0.25, number(settings.density, "layout 的 density")))
    if (!Array.isArray(boxes) || boxes.length === 0) fail('layout 的第一个参数是一列盒子：[{ name, from, to, faces: ["north", …] }, …]。')
    const wanted = (boxes as Record<string, unknown>[]).flatMap((box, index) => {
      const at = `layout 的第 ${index + 1} 个盒子`
      if (typeof box !== "object" || box === null || typeof box.name !== "string" || !box.name) return fail(`${at}要写成 { name, from, to, faces }，name 是一个名字。`)
      const from = vector(box.from, `${at}的 from`)
      const to = vector(box.to, `${at}的 to`)
      const span: V = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
      if (span.some((value) => value <= 0)) fail(`${at}（${box.name}）的 to 每一维都要比 from 大。`)
      const faces: Record<string, unknown> = Array.isArray(box.faces) ? Object.fromEntries(box.faces.map((face) => [face, {}])) : typeof box.faces === "object" && box.faces !== null ? (box.faces as Record<string, unknown>) : fail(`${at}（${box.name}）的 faces 要写成要画的面的名字：["north", "up", …]。`)
      return Object.entries(faces).map(([face, faceOptions]) => {
        const [across, down] = faceSize(span, face)
        const extra = options(faceOptions, `${at}的 ${face} 面`)
        return { index, face, cull: extra.cull === true, width: Math.max(1, Math.ceil(across * density - 1e-9)), height: Math.max(1, Math.ceil(down * density - 1e-9)), x: 0, y: 0 }
      })
    })
    const area = wanted.reduce((sum, place) => sum + place.width * place.height, 0)
    const next = side === 16 ? 32 : 64
    const tooMuch = () => fail(`${wanted.length} 个面要 ${area} 个像素，sheet 只有 ${side}×${side}=${side * side} 个，还要留出排版的空隙，排不下。${side === 64 ? "已经是最大的 sheet 了：把 density 调小（每个方块像素用几个 sheet 像素，现在是 " + density + "），或者去掉看不见的面。" : `把 size 写成 ${next}，或者把 density 调小（每个方块像素用几个 sheet 像素，现在是 ${density}），或者去掉看不见的面。`}`)
    let x = 0
    let y = 0
    let row = 0
    ;[...wanted]
      .sort((a, b) => b.height - a.height || b.width - a.width)
      .forEach((place) => {
        if (place.width > side) tooMuch()
        if (x + place.width > side) [x, y, row] = [0, y + row + gap, 0]
        if (y + place.height > side) tooMuch()
        place.x = x
        place.y = y
        x += place.width + gap
        row = Math.max(row, place.height)
      })
    const elements = (boxes as Record<string, unknown>[]).map((box, index) => ({
      name: box.name,
      from: box.from,
      to: box.to,
      rotation: box.rotation ?? null,
      faces: Object.fromEntries(wanted.filter((place) => place.index === index).map((place) => [place.face, { uv: [place.x, place.y, place.x + place.width, place.y + place.height], cull: place.cull }])),
    }))
    return { size: side, elements, areas: wanted.map((place) => ({ element: (boxes as { name: string }[])[place.index]!.name, face: place.face, x: place.x, y: place.y, width: place.width, height: place.height })) }
  }

  // Pixels. A canvas is a grid of colours; it becomes a texture document, or the marks on one face of a box.
  const canvases = new WeakMap<object, Canvas>()
  // An empty string is a pixel with nothing on it. Only a picture that stands by itself (a block's face, an item's icon) may keep any.
  const ink = (value: unknown, what: string) => (value === null ? "" : given.particle && typeof value === "string" && /^#[0-9a-f]{8}$/i.test(value) ? value.toLowerCase() : colour(value, what))
  const canvas = (width: unknown, height: unknown, fill: unknown = "#000000") => {
    const held: Canvas = { width: whole(width, "画布的宽", 1, L.canvas), height: whole(height, "画布的高", 1, L.canvas), pixels: [] }
    held.pixels = Array.from({ length: held.width * held.height }, () => ink(fill, "画布的底色"))
    const inside = (x: number, y: number) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < held.width && y < held.height
    const put = (x: number, y: number, value: string) => {
      if (inside(x, y)) held.pixels[y * held.width + x] = value
    }
    const area = (x: unknown, y: unknown, w: unknown, h: unknown, what: string) => ({ x: Math.round(number(x, `${what}的 x`)), y: Math.round(number(y, `${what}的 y`)), w: Math.round(number(w, `${what}的宽`)), h: Math.round(number(h, `${what}的高`)) })
    const each = (box: { x: number; y: number; w: number; h: number }, draw: (x: number, y: number, u: number, v: number) => void) =>
      Array.from({ length: Math.max(0, Math.min(box.h, L.canvas)) }, (_, v) => Array.from({ length: Math.max(0, Math.min(box.w, L.canvas)) }, (_, u) => draw(box.x + u, box.y + v, u, v)))
    const self = {
      width: held.width,
      height: held.height,
      set: (x: unknown, y: unknown, value: unknown) => (put(Math.round(number(x, "set 的 x")), Math.round(number(y, "set 的 y")), ink(value, "set 的颜色")), self),
      get: (x: unknown, y: unknown) => (inside(x as number, y as number) ? held.pixels[(y as number) * held.width + (x as number)]! || null : null),
      rect: (x: unknown, y: unknown, w: unknown, h: unknown, value: unknown) => ((paint) => (each(area(x, y, w, h, "rect"), (px, py) => put(px, py, paint)), self))(ink(value, "rect 的颜色")),
      line: (x0: unknown, y0: unknown, x1: unknown, y1: unknown, value: unknown) => {
        const from = [Math.round(number(x0, "line 的 x0")), Math.round(number(y0, "line 的 y0"))]
        const to = [Math.round(number(x1, "line 的 x1")), Math.round(number(y1, "line 的 y1"))]
        const steps = Math.min(1024, Math.max(Math.abs(to[0]! - from[0]!), Math.abs(to[1]! - from[1]!)))
        const paint = ink(value, "line 的颜色")
        Array.from({ length: steps + 1 }, (_, step) => put(Math.round(from[0]! + ((to[0]! - from[0]!) * step) / Math.max(1, steps)), Math.round(from[1]! + ((to[1]! - from[1]!) * step) / Math.max(1, steps)), paint))
        return self
      },
      /** From one colour to another across a box, in `steps` flat bands, so it stays pixel art. */
      gradient: (x: unknown, y: unknown, w: unknown, h: unknown, from: unknown, to: unknown, how: unknown) => {
        const box = area(x, y, w, h, "gradient")
        const asked = options(how, "gradient 的选项")
        const across = asked.direction === "right"
        const span = Math.max(1, across ? box.w : box.h)
        const bands = whole(asked.steps ?? Math.min(span, 4), "gradient 的 steps", 2, 64)
        each(box, (px, py, u, v) => put(px, py, mix(from, to, Math.min(bands - 1, Math.floor((((across ? u : v) + 0.5) / span) * bands)) / (bands - 1))))
        return self
      },
      /** Patches of the given colours that hang together, not single scattered pixels. `cell` is roughly how wide a patch is. */
      noise: (x: unknown, y: unknown, w: unknown, h: unknown, colours: unknown, how: unknown) => {
        const box = area(x, y, w, h, "noise")
        const asked = options(how, "noise 的选项")
        const tones = Array.isArray(colours) && colours.length ? colours.map((value) => colour(value, "noise 的颜色")) : fail("noise 要一个不空的颜色列表。")
        const cell = number(asked.cell ?? 3, "noise 的 cell")
        if (cell < 1) fail("noise 的 cell 至少是 1。")
        // Looked up by number: every pixel asks for four corners, and on a large canvas making a text key for each was most of the time. The value of a corner is what it always was.
        const lattice = new Map<number, number>()
        const corner = (cx: number, cy: number) => {
          const key = cx * 65536 + cy
          const known = lattice.get(key)
          if (known !== undefined) return known
          const made = random(`${String(asked.seed ?? 1)}:${cx},${cy}`)()
          lattice.set(key, made)
          return made
        }
        each(box, (px, py, u, v) => {
          const fx = u / cell
          const fy = v / cell
          const tx = smooth(fx - Math.floor(fx))
          const ty = smooth(fy - Math.floor(fy))
          const top = corner(Math.floor(fx), Math.floor(fy)) * (1 - tx) + corner(Math.floor(fx) + 1, Math.floor(fy)) * tx
          const bottom = corner(Math.floor(fx), Math.floor(fy) + 1) * (1 - tx) + corner(Math.floor(fx) + 1, Math.floor(fy) + 1) * tx
          // Smoothed values crowd around the middle; stretched back out so every colour gets its share.
          put(px, py, tones[Math.min(tones.length - 1, Math.floor(Math.max(0, Math.min(0.999, (top * (1 - ty) + bottom * ty - 0.5) * 1.8 + 0.5)) * tones.length))]!)
        })
        return self
      },
      /** Another canvas laid onto this one with its top-left corner at x, y. */
      stamp: (other: unknown, x: unknown, y: unknown) => {
        const source = canvases.get(other as object) ?? fail("stamp 要另一张画布。")
        // What is empty on the other canvas leaves what is under it as it was.
        each({ x: Math.round(number(x, "stamp 的 x")), y: Math.round(number(y, "stamp 的 y")), w: source.width, h: source.height }, (px, py, u, v) => source.pixels[v * source.width + u] && put(px, py, source.pixels[v * source.width + u]!))
        return self
      },
      /** This canvas as a texture document. */
      texture: () => {
        if (held.pixels.includes("")) fail("这张画布上有透明的像素（颜色写成 null 的地方）。穿在模型上的贴图不能有透明：把它们填上颜色。")
        const palette = [...new Set(held.pixels)]
        if (palette.length > L.palette) fail(`这张贴图用了 ${palette.length} 种颜色，最多 ${L.palette} 种。少用几种颜色，或者把渐变的 steps 调小。`)
        const index = new Map(palette.map((value, at) => [value, at]))
        return { kind: "texture", width: held.width, height: held.height, palette, pixels: held.pixels.map((value) => index.get(value)!) }
      },
      /** This canvas as a picture that stands by itself: a block's face or an item's icon. Empty pixels stay empty (-1). */
      picture: () => {
        const palette = [...new Set(held.pixels.filter((value) => value !== ""))]
        const index = new Map(palette.map((value, at) => [value, at]))
        return { kind: "picture", width: held.width, height: held.height, palette, pixels: held.pixels.map((value) => index.get(value) ?? -1) }
      },
    }
    canvases.set(self, held)
    return Object.freeze(self)
  }

  /** What is drawn on a face, as the document writes it: the commonest colour as the face's own, the rest as rectangles. */
  const drawn = (held: Canvas, where: string) => {
    if (held.pixels.includes("")) fail(`${where}的画布上有透明的像素（颜色写成 null 的地方）。画到方块面上的画布不能有透明。`)
    const counts = held.pixels.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>())
    const base = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
    const used = held.pixels.map((value) => value === base)
    const details: { x: number; y: number; width: number; height: number; color: string }[] = []
    held.pixels.forEach((value, index) => {
      if (used[index]) return
      const x = index % held.width
      const y = Math.floor(index / held.width)
      const free = (px: number, py: number) => px < held.width && py < held.height && !used[py * held.width + px] && held.pixels[py * held.width + px] === value
      const wide = Array.from({ length: held.width - x }, (_, step) => step).findIndex((step) => !free(x + step, y))
      const width = wide === -1 ? held.width - x : wide
      const tall = Array.from({ length: held.height - y }, (_, step) => step).findIndex((step) => !Array.from({ length: width }, (_, u) => u).every((u) => free(x + u, y + step)))
      const height = tall === -1 ? held.height - y : tall
      Array.from({ length: width * height }, (_, cell) => (used[(y + Math.floor(cell / width)) * held.width + x + (cell % width)] = true))
      details.push({ x, y, width, height, color: value })
    })
    if (details.length > L.details) fail(`${where}上画的东西太碎了：拆出来 ${details.length} 个色块，一个方块最多 ${L.details} 个。把图案画得更成块一些（noise 的 cell 调大、颜色少一点），或者只在要紧的面上画，其余的面用 paint 让 Studio 代画。`)
    return { base, details }
  }

  // ---- Tracing a concept picture (`api.trace`). The picture was read and made small outside (`image-decode.ts`); in here it is only numbers.
  const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  const decoded = new Map<string, number[]>()
  /** Base64 text back to bytes: the sandbox has no atob, no Buffer and no typed arrays, so by hand, into a plain list. */
  const bytesOf = (name: string, text: string) => {
    const known = decoded.get(name)
    if (known) return known
    const value: Record<string, number> = {}
    for (let index = 0; index < 64; index++) value[BASE64[index]!] = index
    const bytes: number[] = []
    let buffer = 0
    let held = 0
    for (let index = 0; index < text.length; index++) {
      const found = value[text[index]!]
      if (found === undefined) continue
      buffer = ((buffer << 6) | found) & 0xffff
      held += 6
      if (held >= 8) {
        held -= 8
        bytes.push((buffer >> held) & 255)
      }
    }
    decoded.set(name, bytes)
    return bytes
  }
  // Colour is judged in OKLab (Ottosson, 2020): equal steps in it are equal differences to the eye, which sRGB's are not, so "nearest colour",
  // "average colour" and "how far apart" mean what they seem to. Chosen over CIELAB for the same reason and for being a few lines of arithmetic.
  type Lab = [number, number, number]
  const linear = (byte: number) => ((value) => (value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)))(byte / 255)
  const encoded = (value: number) => Math.max(0, Math.min(255, Math.round(255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055))))
  const labOf = (red: number, green: number, blue: number): Lab => {
    const r = linear(red)
    const g = linear(green)
    const b = linear(blue)
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
  }
  const hexOfLab = (lab: Lab) => {
    const l = Math.pow(lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2], 3)
    const m = Math.pow(lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2], 3)
    const s = Math.pow(lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2], 3)
    return hexOf([encoded(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), encoded(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), encoded(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)])
  }
  const apart = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

  /**
   * A concept picture as pixels to start a texture from. In order: the background is taken away (by the picture's own transparency, or by the
   * colour its edge agrees on, found from the edge inwards so the same colour inside the subject stays); the subject's box is cut out and fitted
   * into the canvas keeping its proportions, each pixel taking the average of the picture under it; the colours are reduced to a small palette
   * (median cut to split, k-means to settle); light from the top left can be shaded in, and a one-pixel outline put round the silhouette.
   * What comes back is an ordinary canvas.
   */
  const trace = (picked?: unknown, how?: unknown) => {
    const asked = options(how, "trace 的选项")
    const pictures = given.pictures ?? []
    if (!pictures.length) fail("还没有构想图可以描：先用 save_concepts 把你画的图交给 Studio（物品、方块、模型的任务都可以交），再在脚本里 api.trace 它。")
    const found = typeof picked === "string" ? pictures.find((value) => value.name === picked) : picked === undefined && pictures.length === 1 ? pictures[0] : undefined
    if (!found) return fail(`没有叫 ${show(picked)} 的构想图。交过的是：${pictures.map((value) => `「${value.name}」`).join("、")}。`)
    if ("error" in found) return fail(`构想图「${found.name}」Studio 读不出来：${found.error}`)
    const picture = found
    const size = asked.size === undefined ? [16, 16] : Array.isArray(asked.size) ? asked.size : [asked.size, asked.size]
    const width = whole(size[0], "trace 的 size（宽）", 1, L.canvas)
    const height = whole(size[1], "trace 的 size（高）", 1, L.canvas)
    const colours = asked.colors === undefined ? 8 : whole(asked.colors, "trace 的 colors", 2, 32)
    // A cell is the subject when at least this share of it is: half, so a one-pixel-wide stroke in the picture still shows where it fills a cell.
    const coverage = asked.coverage === undefined ? 0.5 : Math.min(0.95, Math.max(0.05, number(asked.coverage, "trace 的 coverage")))
    const tolerance = asked.tolerance === undefined ? 0.07 : Math.min(0.4, Math.max(0.01, number(asked.tolerance, "trace 的 tolerance")))
    const fitting = asked.fit === undefined ? "contain" : asked.fit === "contain" || asked.fit === "cover" ? asked.fit : fail(`trace 的 fit 只能是 "contain"（整个主体放进去，留出空边）或 "cover"（铺满、多的切掉），现在是 ${show(asked.fit)}。`)
    const outlined = asked.outline === undefined || asked.outline === false || asked.outline === null ? null : asked.outline === true ? "auto" : colour(asked.outline, "trace 的 outline")
    const shading = asked.shade === undefined || asked.shade === false || asked.shade === null ? 0 : asked.shade === true ? 0.1 : Math.min(0.3, Math.max(0.02, number(asked.shade, "trace 的 shade")))

    const across = picture.width
    const down = picture.height
    const raw = bytesOf(picture.name, picture.rgba)
    if (raw.length < across * down * 4) fail(`构想图「${picture.name}」的数据不完整。`)
    const total = across * down
    const lab: Lab[] = Array.from({ length: total }, (_, index) => labOf(raw[index * 4]!, raw[index * 4 + 1]!, raw[index * 4 + 2]!))
    const opacity = (index: number) => raw[index * 4 + 3]! / 255

    // 1. What is subject (1) and what is not (0), soft on the rim.
    const weight: number[] = new Array(total).fill(1)
    let background: string
    let clear = 0
    for (let index = 0; index < total; index++) if (raw[index * 4 + 3]! < 128) clear++
    // A picture with a real share of transparent pixels is cut out already; one with a few stray ones is not.
    const key = asked.background === undefined ? (clear >= total * 0.02 ? "alpha" : "auto") : asked.background === null ? "alpha" : colour(asked.background, "trace 的 background")
    if (key === "alpha") {
      for (let index = 0; index < total; index++) weight[index] = opacity(index)
      background = clear ? "图自己的透明" : "没有背景，整张都是主体"
    } else {
      const rim: number[] = []
      for (let x = 0; x < across; x++) rim.push(x, (down - 1) * across + x)
      for (let y = 1; y < down - 1; y++) rim.push(y * across, y * across + across - 1)
      // The background colour: the one asked for, or the one most of the edge shares (each corner's colour is tried).
      let base: Lab | null = null
      if (key !== "auto") base = labOf(channels(key)[0]!, channels(key)[1]!, channels(key)[2]!)
      else {
        let best = 0
        for (const corner of [0, across - 1, (down - 1) * across, total - 1]) {
          const near = rim.filter((index) => apart(lab[index]!, lab[corner]!) <= tolerance * 1.5)
          if (near.length <= best) continue
          best = near.length
          base = [0, 1, 2].map((axis) => near.reduce((sum, index) => sum + lab[index]![axis]!, 0) / near.length) as Lab
        }
        if (best < rim.length * 0.6) base = null
      }
      if (!base) {
        background = "没找到单一颜色的背景，整张都当主体"
      } else {
        const ground: Lab = base
        background = `边上的底色 ${hexOfLab(ground)}`
        const like = (index: number) => apart(lab[index]!, ground) <= tolerance
        const away: boolean[] = new Array(total).fill(false)
        const queue: number[] = rim.filter(like)
        queue.forEach((index) => (away[index] = true))
        for (let head = 0; head < queue.length; head++) {
          const index = queue[head]!
          const x = index % across
          for (const next of [x > 0 ? index - 1 : -1, x < across - 1 ? index + 1 : -1, index >= across ? index - across : -1, index < total - across ? index + across : -1]) {
            if (next < 0 || away[next] || !like(next)) continue
            away[next] = true
            queue.push(next)
          }
        }
        for (let index = 0; index < total; index++) {
          if (away[index]) {
            weight[index] = 0
            continue
          }
          // A pixel on the rim between subject and background is partly background: it counts for less, the nearer its colour is to the background's.
          const x = index % across
          const touches = (x > 0 && away[index - 1]) || (x < across - 1 && away[index + 1]) || (index >= across && away[index - across]) || (index < total - across && away[index + across])
          const distance = apart(lab[index]!, ground)
          if (touches && distance < tolerance * 2) weight[index] = (distance - tolerance) / tolerance
        }
      }
    }
    // Specks too small to show at any size this can be traced to are not the subject (and must not stretch its box).
    const speck = Math.max(4, Math.floor(total / 8000))
    const label: number[] = new Array(total).fill(-1)
    for (let start = 0; start < total; start++) {
      if (label[start]! >= 0 || weight[start]! < 0.5) continue
      const members = [start]
      label[start] = start
      for (let head = 0; head < members.length; head++) {
        const index = members[head]!
        const x = index % across
        const y = (index - x) / across
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= across || ny >= down) continue
            const next = ny * across + nx
            if (label[next]! >= 0 || weight[next]! < 0.5) continue
            label[next] = start
            members.push(next)
          }
      }
      if (members.length < speck) members.forEach((index) => (weight[index] = 0))
    }
    let left = across
    let top = down
    let right = -1
    let bottom = -1
    for (let index = 0; index < total; index++) {
      if (weight[index]! < 0.5) continue
      const x = index % across
      const y = (index - x) / across
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
    if (right < 0) fail(`构想图「${picture.name}」里找不到主体：整张都被当成了背景。让图的背景是一种纯色（或者透明），主体和背景颜色差得开，再交一次；或者给 trace 写 background（背景的颜色，或者 null）。`)

    // 2. The subject's box fitted into the canvas in whole cells, so the silhouette fills them; the proportions are kept to within half a cell.
    const margin = outlined && width > 2 && height > 2 ? 1 : 0
    const roomX = width - 2 * margin
    const roomY = height - 2 * margin
    const boxWidth = right - left + 1
    const boxHeight = bottom - top + 1
    const scaleTo = fitting === "contain" ? Math.max(boxWidth / roomX, boxHeight / roomY) : Math.min(boxWidth / roomX, boxHeight / roomY)
    const cellsAcross = Math.max(1, Math.round(boxWidth / scaleTo))
    const cellsDown = Math.max(1, Math.round(boxHeight / scaleTo))
    const stepX = boxWidth / cellsAcross
    const stepY = boxHeight / cellsDown
    const offsetX = Math.floor(margin + (roomX - cellsAcross) / 2)
    const offsetY = Math.floor(margin + (roomY - cellsDown) / 2)
    type Cell = { x: number; y: number; lab: Lab; weight: number }
    const subject: Cell[] = []
    for (let y = Math.max(0, offsetY); y < Math.min(height, offsetY + cellsDown); y++)
      for (let x = Math.max(0, offsetX); x < Math.min(width, offsetX + cellsAcross); x++) {
        const x0 = left + (x - offsetX) * stepX
        const x1 = x0 + stepX
        const y0 = top + (y - offsetY) * stepY
        const y1 = y0 + stepY
        let area = 0
        let covered = 0
        const sum: Lab = [0, 0, 0]
        for (let row = Math.floor(y0); row < Math.ceil(y1); row++)
          for (let column = Math.floor(x0); column < Math.ceil(x1); column++) {
            const share = (Math.min(column + 1, x1) - Math.max(column, x0)) * (Math.min(row + 1, y1) - Math.max(row, y0))
            if (share <= 0) continue
            area += share
            if (column < 0 || row < 0 || column >= across || row >= down) continue
            const index = row * across + column
            const part = share * weight[index]!
            covered += part
            sum[0] += part * lab[index]![0]
            sum[1] += part * lab[index]![1]
            sum[2] += part * lab[index]![2]
          }
        if (area > 0 && covered / area >= coverage) subject.push({ x, y, lab: [sum[0] / covered, sum[1] / covered, sum[2] / covered], weight: covered / area })
      }
    if (!subject.length) fail(`构想图「${picture.name}」缩到 ${width}×${height} 以后一格主体都没有：试试把 coverage 调小（现在是 ${coverage}）。`)

    // 3. A small palette, at most `colours` of them: colours that look alike are one colour, not two (a box of colours no wider than ALIKE is not split,
    // and middles that settle closer than that are joined), so a flat-coloured picture does not come out in five shades of the same grey.
    // 0.05 in OKLab is about where two flat patches side by side stop reading as two different colours at the size of a pixel of a 16×16 picture.
    const ALIKE = 0.05
    // Median cut splits the cells into boxes of colours (the widest box, weighted by how many cells it holds, first),
    // then a few rounds of k-means settle each middle. Splitting is deterministic (ties broken by position), so a script gives the same picture every run.
    const wanted = Math.min(colours, subject.length)
    const groups: Cell[][] = [subject]
    const spread = (group: Cell[]) => [0, 1, 2].map((axis) => Math.max(...group.map((cell) => cell.lab[axis]!)) - Math.min(...group.map((cell) => cell.lab[axis]!)))
    while (groups.length < wanted) {
      const ranked = groups.map((group, index) => ({ index, size: group.length, widest: Math.max(...spread(group)) })).filter((entry) => entry.size > 1 && entry.widest > ALIKE)
      if (!ranked.length) break
      const pick = ranked.reduce((best, entry) => (entry.widest * Math.sqrt(entry.size) > best.widest * Math.sqrt(best.size) ? entry : best))
      const group = groups[pick.index]!
      const axis = spread(group).indexOf(pick.widest)
      const ordered = [...group].sort((a, b) => a.lab[axis]! - b.lab[axis]! || a.x - b.x || a.y - b.y)
      const half = ordered.reduce((sum, cell) => sum + cell.weight, 0) / 2
      let running = 0
      let cut = 1
      for (let index = 0; index < ordered.length - 1; index++) {
        running += ordered[index]!.weight
        cut = index + 1
        if (running >= half) break
      }
      groups.splice(pick.index, 1, ordered.slice(0, cut), ordered.slice(cut))
    }
    const mean = (group: Cell[]): Lab => {
      const mass = group.reduce((sum, cell) => sum + cell.weight, 0)
      return [0, 1, 2].map((axis) => group.reduce((sum, cell) => sum + cell.weight * cell.lab[axis]!, 0) / mass) as Lab
    }
    let centres = groups.map(mean)
    const nearest = (cell: Cell, from: Lab[]) => from.reduce((best, centre, index) => (apart(cell.lab, centre) < apart(cell.lab, from[best]!) ? index : best), 0)
    for (let round = 0; round < 8; round++) {
      const members: Cell[][] = centres.map(() => [])
      subject.forEach((cell) => members[nearest(cell, centres)]!.push(cell))
      centres = members.filter((group) => group.length).map(mean)
    }
    // Joined from the nearest pair, the larger group's middle kept, until none is nearer than ALIKE.
    for (;;) {
      let pair: [number, number] | null = null
      let gap = ALIKE
      for (let one = 0; one < centres.length; one++)
        for (let other = one + 1; other < centres.length; other++) {
          const between = apart(centres[one]!, centres[other]!)
          if (between < gap) [gap, pair] = [between, [one, other]]
        }
      if (!pair) break
      const held = (centre: Lab) => subject.filter((cell) => nearest(cell, centres) === centres.indexOf(centre)).length
      const keep = held(centres[pair[0]!]!) >= held(centres[pair[1]!]!) ? pair[0]! : pair[1]!
      centres = centres.filter((_, index) => index === keep || index !== pair![0] && index !== pair![1])
    }
    centres.sort((a, b) => a[0] - b[0])
    const marks: Record<number, number> = {}
    subject.forEach((cell) => (marks[cell.y * width + cell.x] = nearest(cell, centres)))
    const has = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && marks[y * width + x] !== undefined

    // 4. Light from the top left: each colour in up to three tones, by where the cell sits on the diagonal of the silhouette and whether it is on a lit or a shaded rim.
    const painted: Record<number, string> = {}
    const minX = Math.min(...subject.map((cell) => cell.x))
    const maxX = Math.max(...subject.map((cell) => cell.x))
    const minY = Math.min(...subject.map((cell) => cell.y))
    const maxY = Math.max(...subject.map((cell) => cell.y))
    subject.forEach((cell) => {
      const centre = centres[marks[cell.y * width + cell.x]!]!
      let tone = 0
      if (shading > 0) {
        const diagonal = 0.5 - ((cell.x - minX) / Math.max(1, maxX - minX) + (cell.y - minY) / Math.max(1, maxY - minY)) / 2
        const rimLight = (!has(cell.x - 1, cell.y) || !has(cell.x, cell.y - 1) ? 1 : 0) - (!has(cell.x + 1, cell.y) || !has(cell.x, cell.y + 1) ? 1 : 0)
        const light = Math.max(-1, Math.min(1, diagonal + rimLight * 0.5))
        tone = light > 0.3 ? 1 : light < -0.3 ? -1 : 0
      }
      painted[cell.y * width + cell.x] = hexOfLab([Math.max(0, Math.min(1, centre[0] + tone * shading)), centre[1], centre[2]])
    })
    const result = canvas(width, height, null)
    Object.keys(painted).forEach((at) => result.set(Number(at) % width, Math.floor(Number(at) / width), painted[Number(at)]))

    // 5. One pixel round the silhouette, a dark version of the darkest colour (or the one asked for): it goes on the cells next to the subject, not on it.
    let outlinedCells = 0
    if (outlined) {
      const darkest = centres[0]!
      const line = outlined === "auto" ? hexOfLab([Math.min(darkest[0], 0.5) * 0.5, darkest[1] * 0.7, darkest[2] * 0.7]) : outlined
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          if (has(x, y) || !(has(x - 1, y) || has(x + 1, y) || has(x, y - 1) || has(x, y + 1))) continue
          result.set(x, y, line)
          outlinedCells++
        }
    }
    const used = [...new Set(Object.values(painted))]
    note(`trace「${picture.name}」：构想图 ${across}×${down} → ${width}×${height}，主体 ${subject.length} 格${outlinedCells ? `，描边 ${outlinedCells} 格` : ""}，${used.length} 种颜色（${used.slice(0, 8).join(" ")}${used.length > 8 ? " …" : ""}），背景：${background}。`)
    return result
  }
  /** The concept pictures the task has, by name, with their size as handed in (not the size of the script's canvas). */
  const concepts = (given.pictures ?? []).map((value) => ("error" in value ? { name: value.name, width: 0, height: 0, error: value.error } : { name: value.name, width: value.width, height: value.height }))

  const refName = (value: unknown, what: string) => (typeof value === "string" ? value : typeof value === "object" && value !== null && typeof (value as { name?: unknown }).name === "string" ? (value as { name: string }).name : fail(`${what}要写骨骼的名字，或者 bone(...) 交回来的那根骨骼，现在是 ${show(value)}。`))

  const builders = new WeakMap<object, () => unknown>()
  const TRACKS = { rotation: { low: -360, high: 360, word: "角度", unit: "度" }, position: { low: -128, high: 128, word: "位移", unit: "像素" }, scale: { low: 0, high: 16, word: "缩放", unit: "倍" } } as const
  const MODES = ["linear", "step", "smooth"]
  /** A motion as the document writes it: rotation keys under `keyframes`, the other tracks only when used, `interpolation` only when it is not a straight line. */
  const written = (motion: Motion) => {
    if (!motion.channels.length) fail(`动作「${motion.name}」里一个关键帧都没有。`)
    const keys = (list: Key[], word: Track) => list.map((key) => ({ time: key.time, [word]: key.value, ...(key.interpolation === "linear" ? {} : { interpolation: key.interpolation }) }))
    return {
      name: motion.name,
      length: motion.length,
      loop: motion.loop,
      channels: motion.channels.map((channel) => ({
        bone: channel.bone,
        keyframes: keys(channel.tracks.rotation, "rotation"),
        ...(channel.tracks.position.length ? { position: keys(channel.tracks.position, "position") } : {}),
        ...(channel.tracks.scale.length ? { scale: keys(channel.tracks.scale, "scale") } : {}),
      })),
    }
  }

  /** Keyframes of one motion. A model's own motion and a motion on its own (`alone`) are written the same way. */
  const motionOf = (name: unknown, asked: Record<string, unknown>, known: ((bone: string) => boolean) | null, alone = false, tier: Tier = budgetOf(alone ? asked.budget : undefined, "animation ")) => {
    const motion: Motion = { name: named(name, "动作的名字"), length: number(asked.length, "动作的 length（秒）"), loop: asked.loop === true, channels: [] }
    if (motion.length <= 0 || motion.length > 30) fail(`动作的 length 要大于 0、不超过 30 秒，现在是 ${motion.length}。`)
    const channel = (bone: unknown) => {
      const boneName = refName(bone, "关键帧的骨骼")
      if (known && !known(boneName)) fail(`动作「${motion.name}」里用了骨骼「${boneName}」，模型里还没有这根骨骼。先用 bone 把它建出来。`)
      const found = motion.channels.find((value) => value.bone === boneName)
      if (found) return found
      if (motion.channels.length >= tier.bones) fail(`「${tier.name}」档一个动作最多带动 ${tier.bones} 根骨骼，这是第 ${motion.channels.length + 1} 根。${higher(tier, "bones", "根")}`)
      motion.channels.push({ bone: named(boneName, "骨骼的名字"), tracks: { rotation: [], position: [], scale: [] } })
      return motion.channels[motion.channels.length - 1]!
    }
    /** `{ track, interpolation }` as written after a key or a list of keys; left out, a key turns the bone and runs straight to the next. */
    const chosen = (asked: unknown, what: string) => {
      const given = options(asked, `${what}的选项`)
      const track = given.track === undefined || given.track === null ? "rotation" : typeof given.track === "string" && given.track in TRACKS ? (given.track as Track) : fail(`${what}的 track 只能是 rotation（转）、position（挪）或 scale（缩放），现在是 ${show(given.track)}。`)
      const interpolation = given.interpolation === undefined || given.interpolation === null ? "linear" : MODES.includes(given.interpolation as string) ? (given.interpolation as string) : fail(`${what}的 interpolation 只能是 linear（直线）、step（保持到下一个关键帧再跳）或 smooth（顺滑地经过这个关键帧），现在是 ${show(given.interpolation)}。`)
      return { track, interpolation, given }
    }
    const put = (bone: unknown, time: unknown, value: unknown, track: Track, interpolation: string) => {
      const held = channel(bone)
      const range = TRACKS[track]
      const at = tidy(number(time, "关键帧的时间"))
      if (at < 0 || at > motion.length) fail(`关键帧的时间要在 0 到 ${motion.length} 秒之间，现在是 ${at}。`)
      const amount = tidied(vector(value, `关键帧的${range.word}`))
      if (amount.some((part) => part < range.low || part > range.high)) fail(`关键帧的${range.word}要在 ${range.low} 到 ${range.high} ${range.unit}之间，现在是 ${show(amount)}。`)
      // The same moment written twice: the later word stands.
      held.tracks[track] = [...held.tracks[track].filter((key) => key.time !== at), { time: at, value: amount, interpolation }].sort((a, b) => a.time - b.time)
      if (held.tracks[track].length > tier.keys) fail(`骨骼「${held.bone}」在动作「${motion.name}」里的${range.word}关键帧超过了 ${tier.keys} 个（「${tier.name}」档一条轨道的上限），这是第 ${held.tracks[track].length} 个。${higher(tier, "keys", "个")}`)
    }
    /** `count` moments spread evenly from the start to the end, each read off `at` as it was `late` seconds earlier: a loop goes round, anything else waits at its start. */
    const read = (bone: unknown, at: unknown, count: unknown, late: number, extra: [number, number], pick: { track: Track; interpolation: string }, what: string) => {
      if (typeof at !== "function") return fail(`${what}要一个函数：(t, 秒) => [x, y, z]，t 从 0 到 1。`)
      const moments = whole(count, `${what}的关键帧数`, 2, tier.keys)
      Array.from({ length: moments }, (_, index) => {
        const now = (motion.length * index) / (moments - 1)
        const then = motion.loop ? (((now - late) % motion.length) + motion.length) % motion.length : Math.min(motion.length, Math.max(0, now - late))
        put(bone, now, (at as (t: number, seconds: number, index: number, count: number) => unknown)(then / motion.length, then, ...extra), pick.track, pick.interpolation)
      })
    }
    const document = () => ({ kind: "animation", ...written(motion), ...(tier.id === L.tier ? {} : { budget: tier.id }) })
    const self = {
      name: motion.name,
      length: motion.length,
      key: (bone: unknown, time: unknown, value: unknown, asked?: unknown) => ((pick) => (put(bone, time, value, pick.track, pick.interpolation), self))(chosen(asked, "key")),
      keys: (bone: unknown, list: unknown, asked?: unknown) => {
        const pick = chosen(asked, "keys")
        ;(Array.isArray(list) ? list : fail("keys 要一个 [时间, [x, y, z]] 的列表。")).forEach((entry) =>
          Array.isArray(entry) && (entry.length === 2 || entry.length === 3) ? put(bone, entry[0], entry[1], pick.track, entry.length === 3 ? chosen({ interpolation: entry[2] }, "keys").interpolation : pick.interpolation) : fail("keys 里的每一项要写成 [时间, [x, y, z]]，或者 [时间, [x, y, z], interpolation]。"),
        )
        return self
      },
      /** Keyframes read off a function of time: `count` moments spread evenly from the start to the end. */
      sample: (bone: unknown, at: unknown, count: unknown = 9, asked?: unknown) => {
        const pick = chosen(asked, "sample")
        read(bone, at, count, pick.given.delay === undefined ? 0 : number(pick.given.delay, "sample 的 delay（秒）"), [0, 1], pick, "sample")
        return self
      },
      /**
       * The same function of time handed down a row of bones, each one later than the one before by the
       * seconds the caller gives: `delay` is one number (every bone that much after the last), a list, or
       * (i, n) => seconds after the first. The function is also told which bone it is on: (t, 秒, i, n).
       */
      stagger: (row: unknown, at: unknown, asked?: unknown) => {
        const pick = chosen(asked, "stagger")
        const bones = Array.isArray(row) && row.length ? row : fail("stagger 的第一个参数要是一排骨骼（名字或者 bone、chain 交回来的骨骼）的列表。")
        const delay = pick.given.delay
        bones.forEach((bone, index) => {
          const late = typeof delay === "function" ? (delay as (index: number, count: number) => unknown)(index, bones.length) : Array.isArray(delay) ? delay[index] : delay === undefined ? 0 : number(delay, "stagger 的 delay（秒）") * index
          read(bone, at, pick.given.count === undefined ? 9 : pick.given.count, number(late, `stagger 第 ${index + 1} 根骨骼的 delay（秒）`), [index, bones.length], pick, "stagger")
        })
        return self
      },
      ...(alone ? { document } : {}),
    }
    if (alone) builders.set(self, document)
    return { motion, self: Object.freeze(self) }
  }
  const model = (asked: unknown) => {
    const given = options(asked, "model 的选项")
    const title = typeof given.name === "string" && given.name.trim() ? given.name.trim().slice(0, 80) : fail("model 要一个 name：这样东西叫什么。")
    const tier = budgetOf(given.budget, "model ")
    const sizes = (L.sizes as readonly number[]).filter((value) => value <= tier.texture)
    const size = given.texture_size === undefined ? 64 : sizes.includes(given.texture_size as number) ? (given.texture_size as number) : fail(`texture_size 只能是 ${sizes.slice(0, -1).join("、")} 或 ${sizes[sizes.length - 1]}${tierIds.length > 1 ? `（「${tier.name}」档）` : ""}。${typeof given.texture_size === "number" && (L.sizes as readonly number[]).includes(given.texture_size) ? higher(tier, "texture", "像素见方") : ""}`)
    // One texel to every texel×texel model pixels: for a model the largest texture of its tier cannot hold (the document's own rule says when it is too coarse).
    const texel = given.texel_size === undefined || given.texel_size === null || given.texel_size === 1 ? 1 : given.texel_size === 2 || given.texel_size === 4 ? given.texel_size : fail(`texel_size 只能是 1、2 或 4（一个贴图像素盖几×几个模型像素），现在是 ${show(given.texel_size)}。`)
    // 第 1 步: the whole model's shading and how its faces are laid on the texture (`contracts.ts`); absent, as always.
    const shading = given.shading === undefined || given.shading === null || given.shading === "flat" ? null : given.shading === "rich" ? "rich" : fail(`shading 只能是 "rich"（按朝向的明暗、边缘、接缝和磨损）或 "flat"（原来的画法），现在是 ${show(given.shading)}。`)
    const atlas = given.atlas === undefined || given.atlas === null || given.atlas === "rows" ? null : given.atlas === "packed" ? "packed" : fail(`atlas 只能是 "packed"（按高矮排，空地方少）或 "rows"（原来的按顺序排），现在是 ${show(given.atlas)}。`)
    const bones: Bone[] = []
    const motions: Motion[] = []
    const find = (bone: unknown, what: string) => ((name) => bones.find((value) => value.name === name) ?? fail(`${what}：模型里没有叫「${name}」的骨骼。它有：${bones.map((value) => value.name).slice(0, 40).join("、") || "（还一根都没有）"}。`))(refName(bone, what))
    const total = () => bones.reduce((sum, bone) => sum + bone.cubes.length, 0)

    /** Where a bone carries the points written under it: p -> r·p + t, in mirrored space, through every bone above it. */
    const placed = (bone: Bone): { r: number[]; t: V } => {
      const pivot = flipped(bone.pivot)
      const r = matrixOf(bone.rotation)
      const moved = turned(r, pivot)
      const own = { r, t: [pivot[0] - moved[0], pivot[1] - moved[1], pivot[2] - moved[2]] as V }
      const above = bone.parent === null ? null : placed(find(bone.parent, "骨骼的 parent"))
      if (!above) return own
      const carried = turned(above.r, own.t)
      return { r: times(above.r, own.r), t: [carried[0] + above.t[0], carried[1] + above.t[1], carried[2] + above.t[2]] }
    }
    const still = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] as V }
    const out = (at: { r: number[]; t: V }, point: V): V => ((moved) => [moved[0] + at.t[0], moved[1] + at.t[1], moved[2] + at.t[2]] as V)(turned(at.r, point))
    const back = (at: { r: number[]; t: V }, point: V): V => turned(inverse(at.r), [point[0] - at.t[0], point[1] - at.t[1], point[2] - at.t[2]])

    /**
     * `outer` and `inner` as names of a side face: the one that points away from the centre line (x = 0) and
     * the one that points at it, worked out from where the box ends up once its bones have turned. Plain
     * geometry: it knows nothing of what the box is. A box across the line has neither, and is told so.
     */
    const relative = (bone: Bone, origin: V, size: V, where: string) => {
      const at = placed(bone)
      // In mirrored space, as everything is drawn: west points to -X there, which is +X in the document.
      const xs = Array.from({ length: 8 }, (_, corner) => out(at, flipped([origin[0] + (corner & 1 ? size[0] : 0), origin[1] + (corner & 2 ? size[1] : 0), origin[2] + (corner & 4 ? size[2] : 0)]))[0])
      const low = Math.min(...xs)
      const high = Math.max(...xs)
      const west = turned(at.r, [-1, 0, 0])[0]
      const resolve = (word: string) => {
        if (low < -1e-6 && high > 1e-6) return fail(`${where}跨在中线（x=0）上，没有内外之分，不能写 ${word}。直接写面的名字：west 是朝它自己左边（+X）的那一面，east 是朝它自己右边（-X）的那一面。`)
        if (Math.abs(low + high) < 1e-6) return fail(`${where}正好在中线（x=0）上，没有内外之分，不能写 ${word}。直接写面的名字：west 朝它自己的左边（+X），east 朝它自己的右边（-X）。`)
        if (Math.abs(west) < 0.5) return fail(`${where}所在的骨骼转过以后，它的 east/west 面已经不朝两侧了，不能写 ${word}。直接写面的名字，并在图上核对。`)
        // Away from the line: west is the outer one when it points to the side of the line the box is on.
        const outer = (low + high) * west > 0 ? "west" : "east"
        return word === "outer" ? outer : outer === "west" ? "east" : "west"
      }
      const named = (face: unknown) => (face === "outer" || face === "inner" ? resolve(face) : face)
      return {
        named,
        /** A { face: value } map with `outer`/`inner` put under the face they mean. The same face written twice is refused. */
        keyed: (map: Record<string, unknown>, what: string) =>
          Object.entries(map).reduce<Record<string, unknown>>((made, entry) => {
            const face = named(entry[0]) as string
            if (face in made) fail(`${where}的 ${what} 里 ${face} 面写了两次（${entry[0]} 在这个方块上就是 ${face}）。`)
            return { ...made, [face]: entry[1] }
          }, {}),
        listed: (list: unknown[]) => list.map((entry) => (typeof entry === "object" && entry !== null && !Array.isArray(entry) && ((entry as { face?: unknown }).face === "outer" || (entry as { face?: unknown }).face === "inner") ? { ...entry, face: named((entry as { face?: unknown }).face) } : entry)),
      }
    }

    const surface = (given: Record<string, unknown>, box: V, where: string, sides: ReturnType<typeof relative>) => {
      const painted = given.paint === undefined || given.paint === null ? null : (options(given.paint, `${where}的 paint`) as Paint)
      const plain = given.color === undefined ? (painted && typeof painted.base === "string" ? painted.base : null) : colour(given.color, `${where}的 color`)
      const own = sides.keyed(options(given.faces, `${where}的 faces`), "faces")
      const pictures = sides.keyed(options(given.draw, `${where}的 draw`), "draw")
      Object.keys({ ...own, ...pictures }).forEach((face) => faceSize(box, face, texel))
      const made = FACES.map((face) => {
        const picture = pictures[face] === undefined ? null : (canvases.get(pictures[face] as object) ?? fail(`${where}的 draw.${face} 要是一张画布（api.canvas）。`))
        const wanted = faceSize(box, face, texel)
        if (picture && (picture.width !== wanted[0] || picture.height !== wanted[1])) fail(`${where}的 ${face} 面是 ${wanted[0]}×${wanted[1]} 像素${texel > 1 ? `（texel_size ${texel}：一个贴图像素盖 ${texel}×${texel} 个模型像素）` : ""}，画布却是 ${picture.width}×${picture.height}。画布要和这个面一样大（api.faceSize(size, "${face}"${texel > 1 ? `, ${texel}` : ""})）。`)
        // 第 1 步: where the tier allows a face its own pixels (最精细, 史诗) the canvas is kept pixel for pixel, never cut into rectangles.
        if (picture && tier.face_pixels) {
          if (picture.pixels.includes("")) fail(`${where}的 ${face} 面的画布上有透明的像素（颜色写成 null 的地方）。画到方块面上的画布不能有透明。`)
          const palette = [...new Set(picture.pixels)]
          if (palette.length > 256) fail(`${where}的 ${face} 面用了 ${palette.length} 种颜色，一个面最多 256 种。`)
          const index = new Map(palette.map((value, at) => [value, at]))
          const counts = picture.pixels.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>())
          return { face, base: [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0], details: [], pixels: { palette, data: picture.pixels.map((value) => index.get(value)!) } }
        }
        const laid = picture ? drawn(picture, `${where}的 ${face} 面`) : null
        const base = laid?.base ?? (own[face] === undefined ? plain : colour(own[face], `${where}的 faces.${face}`))
        return { face, base: base ?? fail(`${where}的 ${face} 面没有颜色：给方块写 color，或者 faces.${face}，或者 paint。`), details: (laid?.details ?? []).map((detail) => ({ face, ...detail })), pixels: null as { palette: string[]; data: number[] } | null }
      })
      const kept = made.filter((value) => value.pixels)
      const written = given.details === undefined ? [] : Array.isArray(given.details) ? (sides.listed(given.details) as Record<string, unknown>[]) : fail(`${where}的 details 要是一个列表。`)
      const details = [...made.flatMap((value) => value.details), ...written]
      if (details.length > L.details) fail(`${where}上的色块一共 ${details.length} 个，一个方块最多 ${L.details} 个。`)
      if (made.flatMap((value) => value.details).reduce((sum, detail) => sum + detail.width * detail.height, 0) > L.detail_pixels) fail(`${where}上画的色块加起来超过了 ${L.detail_pixels} 个像素。`)
      return {
        faces: Object.fromEntries(made.map((value) => [value.face, value.base])) as Record<string, string>,
        surface_details: details,
        ...(painted ? { paint: painted } : {}),
        ...(given.features === undefined || given.features === null ? {} : { features: Array.isArray(given.features) ? sides.listed(given.features) : fail(`${where}的 features 要是一个列表。`) }),
        ...(kept.length ? { pixels: Object.fromEntries(kept.map((value) => [value.face, value.pixels!])) } : {}),
      }
    }

    /** 第 1 步: what a cube may say beyond its box: its own turn about a pivot, a growth, a mirrored texture, another cube's texture. Absent, nothing is written. */
    const cubeShape = (given: Record<string, unknown>, where: string) => {
      const rotation = given.rotation === undefined || given.rotation === null ? null : vector(given.rotation, `${where}的 rotation`)
      if (rotation && rotation.some((value) => value < -180 || value > 180)) fail(`${where}的 rotation 每个角度要在 -180 到 180 度之间，现在是 ${show(rotation)}。`)
      const pivot = given.pivot === undefined || given.pivot === null ? null : vector(given.pivot, `${where}的 pivot`)
      const inflate = given.inflate === undefined || given.inflate === null ? null : number(given.inflate, `${where}的 inflate`)
      if (inflate !== null && (inflate < -2 || inflate > 4)) fail(`${where}的 inflate 要在 -2 到 4 个模型像素之间，现在是 ${inflate}。`)
      const mirrored = given.mirror === undefined || given.mirror === null ? null : typeof given.mirror === "boolean" ? given.mirror : fail(`${where}的 mirror 要是 true 或 false。`)
      const share = given.share === undefined || given.share === null ? null : typeof given.share === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,47}\.[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(given.share) ? given.share : fail(`${where}的 share 要写成 "骨骼名.方块名"，现在是 ${show(given.share)}。`)
      return {
        ...(rotation && rotation.some((value) => value !== 0) ? { rotation: tidied(rotation), ...(pivot ? { pivot: tidied(pivot) } : {}) } : {}),
        ...(inflate ? { inflate } : {}),
        ...(mirrored ? { mirror: true } : {}),
        ...(share ? { share } : {}),
      }
    }

    const addCube = (bone: Bone, name: unknown, asked: unknown) => {
      const given = options(asked, "cube 的选项")
      const cubeName = named(name, "方块的名字")
      const where = `方块「${bone.name}.${cubeName}」`
      if (bone.cubes.some((value) => value.name === cubeName)) fail(`骨骼「${bone.name}」里已经有一个叫「${cubeName}」的方块了，名字不能重复。`)
      if (total() >= tier.cubes) fail(`方块太多了：「${tier.name}」档一个模型最多 ${tier.cubes} 个，这是第 ${total() + 1} 个。${higher(tier, "cubes", "个")}`)
      if (bone.cubes.length >= tier.bone_cubes) fail(`骨骼「${bone.name}」里的方块太多了：一根骨骼最多 ${tier.bone_cubes} 个，这是第 ${bone.cubes.length + 1} 个。把它们分到几根骨骼上。`)
      const size = vector(given.size, `${where}的 size`).map((value) => whole(value, `${where}的 size 里的每个数`, 1, 256)) as V
      const origin = given.center === undefined ? vector(given.origin, `${where}的 origin（或者 center）`) : (vector(given.center, `${where}的 center`).map((value, axis) => value - size[axis]! / 2) as V)
      if (origin.some((value, axis) => value < -256 || value + size[axis]! > 256)) fail(`${where}超出了范围：每个方向都要在 -256 到 256 之间。`)
      bone.cubes.push({ name: cubeName, origin: tidied(origin), size, ...surface(given, size, where, relative(bone, origin, size, where)), ...cubeShape(given, where) })
    }

    /**
     * A round or slanted form the way a CAD tool gives one (an ellipsoid, a cylinder, a cone or frustum, a tube along a line, a box
     * with rounded edges), set out in boxes on the model's pixel grid: the shape is sampled cell by cell (`step` pixels a cell) and
     * the filled cells merged into as few boxes as the grid allows. Geometry only: the caller says every size, place and colour,
     * and the boxes are ordinary ones on this bone, counted against the budget like any other.
     */
    const addSolid = (bone: Bone, name: unknown, asked: unknown) => {
      const given = options(asked, "solid 的选项")
      const stem = named(name, "solid 的名字")
      const where = `形体「${bone.name}.${stem}」`
      const step = given.step === undefined ? 1 : whole(given.step, `${where}的 step（每格几个像素）`, 1, 8)
      const axisOf = (value: unknown) => (value === undefined ? 1 : ["x", "y", "z"].indexOf(String(value)) >= 0 ? ["x", "y", "z"].indexOf(String(value)) : fail(`${where}的 axis 只能是 "x"、"y"、"z"。`))
      const positive = (value: unknown, what: string) => ((n) => (n > 0 ? n : fail(`${what}要大于 0，现在是 ${n}。`)))(number(value, what))
      const shape = String(given.shape ?? "")
      // Each shape: its bounds [low, high] and whether a point is inside.
      const form: { low: V; high: V; inside: (p: V) => boolean } = (() => {
        if (shape === "ellipsoid") {
          const c = vector(given.center, `${where}的 center`)
          const r = ((value) => (typeof value === "number" ? ([value, value, value] as V) : vector(value, `${where}的 radii`)))(given.radii ?? given.radius)
          r.forEach((value, axis) => positive(value, `${where}的 radii 第 ${axis + 1} 个`))
          return { low: sub(c, r) as V, high: add(c, r) as V, inside: (p) => ((p[0] - c[0]) / r[0]) ** 2 + ((p[1] - c[1]) / r[1]) ** 2 + ((p[2] - c[2]) / r[2]) ** 2 <= 1 }
        }
        if (shape === "cylinder" || shape === "cone") {
          // Along an axis from `from`, `length` pixels; the section an ellipse of radii, narrowing to `end_radii` for a cone.
          const axis = axisOf(given.axis)
          const from = vector(given.from, `${where}的 from（底面的中心）`)
          const long = positive(given.length, `${where}的 length`)
          const across = [0, 1, 2].filter((value) => value !== axis) as [number, number]
          const section = (value: unknown, what: string) => (typeof value === "number" ? ([positive(value, what), value] as [number, number]) : Array.isArray(value) && value.length === 2 ? ([positive(value[0], what), positive(value[1], what)] as [number, number]) : fail(`${what}要是一个数，或者两个数 [横向, 纵向]。`))
          const start = section(given.radii ?? given.radius, `${where}的 radius`)
          const end = shape === "cone" ? (given.end_radius === 0 || (Array.isArray(given.end_radius) && given.end_radius.every((v) => v === 0)) ? ([0, 0] as [number, number]) : section(given.end_radius, `${where}的 end_radius`)) : start
          const widest = [Math.max(start[0], end[0]), Math.max(start[1], end[1])]
          const low = [...from] as V
          const high = [...from] as V
          high[axis] = from[axis]! + long
          low[across[0]] = from[across[0]]! - widest[0]!
          high[across[0]] = from[across[0]]! + widest[0]!
          low[across[1]] = from[across[1]]! - widest[1]!
          high[across[1]] = from[across[1]]! + widest[1]!
          return {
            low,
            high,
            inside: (p) => {
              const t = (p[axis]! - from[axis]!) / long
              if (t < 0 || t > 1) return false
              const ra = start[0] + (end[0] - start[0]) * t
              const rb = start[1] + (end[1] - start[1]) * t
              return ra > 0 && rb > 0 && ((p[across[0]]! - from[across[0]]!) / ra) ** 2 + ((p[across[1]]! - from[across[1]]!) / rb) ** 2 <= 1
            },
          }
        }
        if (shape === "tube") {
          // Round all the way along a smooth line through `points`; the radius runs from the first to the last value given.
          const line = curve(given.points, Math.max(8, (path(given.points, `${where}的 points`).length - 1) * 8))
          const radii = typeof given.radius === "number" ? [positive(given.radius, `${where}的 radius`)] : Array.isArray(given.radius) && given.radius.length >= 1 ? given.radius.map((value, index) => positive(value, `${where}的 radius 第 ${index + 1} 个`)) : fail(`${where}的 radius 要是一个数，或者从头到尾的几个数。`)
          const at = (t: number) => (radii.length === 1 ? radii[0]! : ((place) => ((index) => radii[index]! + (radii[Math.min(radii.length - 1, index + 1)]! - radii[index]!) * (place - index))(Math.min(radii.length - 2, Math.floor(place))))(t * (radii.length - 1)))
          const spheres = line.map((centre, index) => ({ centre, r: at(index / (line.length - 1)) }))
          const big = Math.max(...radii)
          return {
            low: [0, 1, 2].map((axis) => Math.min(...line.map((point) => point[axis]!)) - big) as V,
            high: [0, 1, 2].map((axis) => Math.max(...line.map((point) => point[axis]!)) + big) as V,
            inside: (p) => spheres.some((ball) => (p[0] - ball.centre[0]) ** 2 + (p[1] - ball.centre[1]) ** 2 + (p[2] - ball.centre[2]) ** 2 <= ball.r ** 2),
          }
        }
        if (shape === "rounded_box") {
          const size = vector(given.size, `${where}的 size`).map((value, axis) => positive(value, `${where}的 size 第 ${axis + 1} 个`)) as V
          const low = given.center === undefined ? vector(given.origin, `${where}的 origin（或者 center）`) : (sub(vector(given.center, `${where}的 center`), scale(size, 0.5)) as V)
          const high = add(low, size) as V
          const round = given.round === undefined ? Math.min(...size) / 4 : number(given.round, `${where}的 round（圆角半径）`)
          if (round < 0 || round > Math.min(...size) / 2) fail(`${where}的 round 要在 0 到最短边的一半（${Math.min(...size) / 2}）之间。`)
          const core = [add(low, [round, round, round]) as V, sub(high, [round, round, round]) as V]
          return { low, high, inside: (p) => Math.hypot(...[0, 1, 2].map((axis) => Math.max(core[0][axis]! - p[axis]!, 0, p[axis]! - core[1][axis]!))) <= round + 1e-9 }
        }
        return fail(`${where}的 shape 只能是 "ellipsoid"（椭球）、"cylinder"（圆柱/椭圆柱）、"cone"（圆锥/圆台）、"tube"（沿一条线的圆管）、"rounded_box"（圆角长方体）。`)
      })()
      // Cells on the model's grid: whole multiples of `step` from the shape's low corner, rounded out to whole pixels.
      const start = form.low.map((value) => Math.floor(value)) as V
      const counts = form.high.map((value, axis) => Math.max(1, Math.ceil((Math.ceil(value) - start[axis]!) / step))) as V
      if (counts[0] * counts[1] * counts[2] > L.solid_cells) fail(`${where}太大了：按 step ${step} 要算 ${counts[0] * counts[1] * counts[2]} 格，最多 ${L.solid_cells} 格。把 step 调大，或者把它拆成几块。`)
      const filled: number[] = Array.from({ length: counts[0] * counts[1] * counts[2] }, () => 0)
      const index = (x: number, y: number, z: number) => (z * counts[1] + y) * counts[0] + x
      for (let z = 0; z < counts[2]; z++) for (let y = 0; y < counts[1]; y++) for (let x = 0; x < counts[0]; x++) filled[index(x, y, z)] = form.inside([start[0] + (x + 0.5) * step, start[1] + (y + 0.5) * step, start[2] + (z + 0.5) * step]) ? 1 : 0
      // Merge: a run along x, grown along y while every row is full, then along z while every layer is.
      const cells: { low: V; span: V }[] = []
      for (let z = 0; z < counts[2]; z++)
        for (let y = 0; y < counts[1]; y++)
          for (let x = 0; x < counts[0]; x++) {
            if (filled[index(x, y, z)] !== 1) continue
            let w = 1
            while (x + w < counts[0] && filled[index(x + w, y, z)] === 1) w++
            const row = (yy: number, zz: number) => Array.from({ length: w }, (_, i) => filled[index(x + i, yy, zz)] === 1).every(Boolean)
            let h = 1
            while (y + h < counts[1] && row(y + h, z)) h++
            let d = 1
            while (z + d < counts[2] && Array.from({ length: h }, (_, j) => row(y + j, z + d)).every(Boolean)) d++
            for (let zz = z; zz < z + d; zz++) for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) filled[index(xx, yy, zz)] = 2
            cells.push({ low: [x, y, z], span: [w, h, d] })
          }
      // broad3: a box with every side against the solid's own cells can never be seen, and the look gate refuses a hidden box; it is left out.
      // What is seen of the solid is unchanged: only its surface shows.
      const solidAt = (p: V) => p.every((value, axis) => value >= 0 && value < counts[axis]!) && filled[index(p[0], p[1], p[2])] !== 0
      const exposed = (cell: { low: V; span: V }) =>
        ([0, 1, 2] as const).some((axis) =>
          [-1, cell.span[axis]].some((offset) => {
            const [a, b] = ([0, 1, 2] as const).filter((other) => other !== axis)
            for (let u = 0; u < cell.span[a]; u++)
              for (let v = 0; v < cell.span[b]; v++) {
                const p = [...cell.low] as V
                p[axis] += offset
                p[a] += u
                p[b] += v
                if (!solidAt(p)) return true
              }
            return false
          }),
        )
      const boxes = cells.filter(exposed).map((cell) => ({ at: cell.low.map((value, axis) => start[axis]! + value * step) as V, size: cell.span.map((value) => value * step) as V }))
      if (!boxes.length) fail(`${where}一格都没有填上：它比 step（${step} 像素）还小。把它做大一点，或者把 step 调小。`)
      const left = Math.min(tier.cubes - total(), tier.bone_cubes - bone.cubes.length)
      if (boxes.length > left) fail(`${where}按 step ${step} 要 ${boxes.length} 个方块，这根骨骼和这个模型还能放 ${left} 个。把 step 调大（越大越粗、方块越少），把它做小一点，或者放到另一根骨骼上。${higher(tier, "cubes", "个")}`)
      const { shape: _s, center: _c, radii: _r, radius: _ra, end_radius: _e, axis: _a, from: _f, length: _l, points: _p, size: _z, origin: _o, round: _ro, step: _st, ...look } = given
      boxes.forEach((box, number) => addCube(bone, `${stem}_${number + 1}`, { ...look, origin: box.at, size: box.size }))
      return boxes.length
    }

    const handles = new Map<string, Readonly<{ name: string; pivot: readonly number[]; cube: (name: unknown, asked: unknown) => unknown; solid: (name: unknown, asked: unknown) => unknown; bone: (name: unknown, asked?: unknown) => unknown }>>()
    const addBone = (name: unknown, asked: unknown) => {
      const given = options(asked, "bone 的选项")
      const boneName = named(name, "骨骼的名字")
      if (bones.some((value) => value.name === boneName)) fail(`已经有一根叫「${boneName}」的骨骼了，名字不能重复。`)
      if (bones.length >= tier.bones) fail(`骨骼太多了：「${tier.name}」档一个模型最多 ${tier.bones} 根，这是第 ${bones.length + 1} 根。${higher(tier, "bones", "根")}`)
      // The first bone is the root; a later one that names no parent hangs from it.
      const parent = bones.length === 0 ? (given.parent === undefined || given.parent === null ? null : fail("第一根骨骼是根骨骼，不能有 parent。")) : given.parent === undefined || given.parent === null ? bones[0]!.name : find(given.parent, "骨骼的 parent").name
      const rotation = given.rotation === undefined ? ([0, 0, 0] as V) : tidied(vector(given.rotation, `骨骼「${boneName}」的 rotation`))
      if (rotation.some((value) => Math.abs(value) > 360)) fail(`骨骼「${boneName}」的 rotation 要在 -360 到 360 度之间。`)
      const bone: Bone = { name: boneName, parent, pivot: tidied(given.pivot === undefined ? [0, 0, 0] : vector(given.pivot, `骨骼「${boneName}」的 pivot`)), rotation, ...(given.paint === undefined || given.paint === null ? {} : { paint: options(given.paint, `骨骼「${boneName}」的 paint`) }), cubes: [] }
      bones.push(bone)
      const handle = Object.freeze({
        name: boneName,
        // Where its joint is written: boxes under this bone are written around this point.
        pivot: Object.freeze([...bone.pivot]),
        cube: (cubeName: unknown, cubeAsked: unknown) => (addCube(bone, cubeName, cubeAsked), handle),
        solid: (solidName: unknown, solidAsked: unknown) => (addSolid(bone, solidName, solidAsked), handle),
        bone: (childName: unknown, childAsked?: unknown) => addBone(childName, { ...options(childAsked, "bone 的选项"), parent: boneName }),
      })
      handles.set(boneName, handle)
      return handle
    }

    const AXES: Record<string, V> = { "x+": [1, 0, 0], "x-": [-1, 0, 0], "y+": [0, 1, 0], "y-": [0, -1, 0], "z+": [0, 0, 1], "z-": [0, 0, -1] }
    /**
     * A bone said by where it ends up instead of by what is written: its joint lands on `at` once every bone
     * above it has turned, and it is turned so that its own `along` axis points at `toward`. Without
     * `toward` it stands straight however the bones above it are turned.
     */
    const joint = (name: unknown, asked: unknown) => {
      const given = options(asked, "joint 的选项")
      const parent = given.parent === undefined || given.parent === null ? (bones[0] ?? null) : find(given.parent, "joint 的 parent")
      const above = parent ? placed(parent) : still
      const at = flipped(vector(given.at, "joint 的 at"))
      const lying = flipped(AXES[String(given.along ?? "z-")] ?? fail(`joint 的 along 只能是 ${Object.keys(AXES).join("、")}。`))
      const way = given.toward === undefined || given.toward === null ? null : ((to) => [to[0] - at[0], to[1] - at[1], to[2] - at[2]] as V)(flipped(vector(given.toward, "joint 的 toward")))
      if (way && Math.hypot(way[0], way[1], way[2]) < 1e-6) fail("joint 的 at 和 toward 在同一个地方。")
      return addBone(name, { ...(parent ? { parent: parent.name } : {}), pivot: flipped(back(above, at)), rotation: anglesOf(way ? swing(lying, turned(inverse(above.r), unit(way))) : inverse(above.r)), ...(given.paint === undefined ? {} : { paint: given.paint }) })
    }
    const self = {
      name: title,
      bone: (name: unknown, asked?: unknown) => addBone(name, asked),
      joint,
      cube: (bone: unknown, name: unknown, asked: unknown) => (addCube(find(bone, "cube 的骨骼"), name, asked), handles.get(refName(bone, "cube 的骨骼"))!),
      solid: (bone: unknown, name: unknown, asked: unknown) => addSolid(find(bone, "solid 的骨骼"), name, asked),
      get: (bone: unknown) => handles.get(find(bone, "get 的骨骼").name)!,
      /** The boxes of one bone taken away, the bone and everything under it kept: to build it again from nothing, or to replace a rough first form with the real one. */
      clear: (bone: unknown) => ((found) => ((found.cubes.length = 0), handles.get(found.name)!))(find(bone, "clear 的骨骼")),
      count: () => ({ bones: bones.length, cubes: total(), animations: motions.length }),
      /** Where a point written under a bone ends up once every bone above it has turned. */
      world: (bone: unknown, point: unknown) => tidied(flipped(out(placed(find(bone, "world 的骨骼")), flipped(vector(point, "world 的点"))))),
      /** The other way round: what to write under a bone so that it ends up at this point. */
      rest: (bone: unknown, point: unknown) => tidied(flipped(back(placed(find(bone, "rest 的骨骼")), flipped(vector(point, "rest 的点"))))),
      /**
       * A row of bones, each hanging from the one before, following a line of points: one box per piece,
       * as long as the piece and as thick as the caller says. Each joint sits on its point.
       */
      chain: (prefix: unknown, asked: unknown) => {
        const given = options(asked, "chain 的选项")
        const stem = named(prefix, "chain 的名字前缀")
        const line = path(given.points, "chain 的 points").map(flipped)
        const pieces = line.length - 1
        const sizes = Array.from({ length: pieces }, (_, index) => {
          const value = typeof given.sizes === "function" ? (given.sizes as (index: number, count: number) => unknown)(index, pieces) : Array.isArray(given.sizes) ? given.sizes[index] : fail("chain 要 sizes：每一段的 [宽, 高]，写成列表或者 (i, n) => [宽, 高]。")
          return Array.isArray(value) && value.length === 2 ? ([whole(value[0], `chain 第 ${index + 1} 段的宽`, 1, 256), whole(value[1], `chain 第 ${index + 1} 段的高`, 1, 256)] as [number, number]) : fail(`chain 第 ${index + 1} 段的粗细要写成 [宽, 高] 两个整数，现在是 ${show(value)}。`)
        })
        const overlap = given.overlap === undefined ? 0 : number(given.overlap, "chain 的 overlap")
        const whole_way = unit([line[pieces]![0] - line[0]![0], line[pieces]![1] - line[0]![1], line[pieces]![2] - line[0]![2]])
        // The pieces are written lying along one axis and turned into place: the axis nearest to where the whole line runs, unless one is asked for.
        const lying = given.along === undefined ? Object.values(AXES).map(flipped).sort((a, b) => dot(b, whole_way) - dot(a, whole_way))[0]! : flipped(AXES[String(given.along)] ?? fail(`chain 的 along 只能是 ${Object.keys(AXES).join("、")}。`))
        const axis = lying.findIndex((value) => value !== 0)
        const first = given.parent === undefined || given.parent === null ? (bones[0] ?? null) : find(given.parent, "chain 的 parent")
        const made = line.slice(0, -1).reduce<{ above: { r: number[]; t: V }; parent: string | null; handles: unknown[] }>(
          (state, from, index) => {
            const way = unit([line[index + 1]![0] - from[0], line[index + 1]![1] - from[1], line[index + 1]![2] - from[2]])
            const reach = Math.hypot(line[index + 1]![0] - from[0], line[index + 1]![1] - from[1], line[index + 1]![2] - from[2])
            if (reach < 1e-6) fail(`chain 的第 ${index + 1} 个点和第 ${index + 2} 个点在同一个地方。`)
            const joint = back(state.above, from)
            const turn = anglesOf(swing(lying, turned(inverse(state.above.r), way)))
            const long = Math.max(1, Math.round(reach + overlap))
            const thick = sizes[index]!
            // Lying along X the section is [depth, height]; along Y, [width, depth]; along Z, [width, height].
            const size = (axis === 0 ? [long, thick[1], thick[0]] : axis === 1 ? [thick[0], long, thick[1]] : [thick[0], thick[1], long]) as V
            const low = joint.map((value, at) => (at === axis ? (lying[axis]! > 0 ? value - overlap : value + overlap - long) : value - size[at]! / 2)) as V
            const look = typeof given.each === "function" ? options((given.each as (index: number, count: number) => unknown)(index, pieces), "chain 的 each 交回来的选项") : {}
            const handle = addBone(`${stem}_${index + 1}`, { parent: state.parent, pivot: flipped(joint), rotation: turn, ...(look.bone_paint === undefined ? {} : { paint: look.bone_paint }) })
            const { bone_paint: _unused, ...rest } = look
            handle.cube(String(given.cube ?? "piece"), { color: given.color, faces: given.faces, paint: given.paint, ...rest, origin: [-(low[0] + size[0]), low[1], low[2]], size })
            return { above: placed(bones[bones.length - 1]!), parent: handle.name, handles: [...state.handles, handle] }
          },
          { above: first ? placed(first) : still, parent: first?.name ?? null, handles: [] },
        )
        return made.handles
      },
      /**
       * A bone and everything hanging from it, made again on the other side of x = 0. `rule` says how the
       * names change: { from, to } replaces one piece of text in every name, or a function gives the new name.
       */
      mirror: (bone: unknown, rule: unknown) => {
        const top = find(bone, "mirror 的骨骼")
        const under = (name: string): Bone[] => bones.filter((value) => value.parent === name).flatMap((value) => [value, ...under(value.name)])
        const group = [top, ...under(top.name)]
        const asked = typeof rule === "function" ? null : options(rule, "mirror 的命名规则")
        const renamed = (name: string) => {
          const next = typeof rule === "function" ? (rule as (name: string) => unknown)(name) : typeof asked!.from === "string" && asked!.from && typeof asked!.to === "string" ? name.split(asked!.from).join(asked!.to) : fail("mirror 要一条命名规则：{ from: \"…\", to: \"…\" }，或者 (name) => 新名字。")
          return next === name ? fail(`mirror 的命名规则没有给「${name}」换出新名字：镜像过去的骨骼要有自己的名字。`) : named(next, "mirror 换出来的名字")
        }
        const names = Object.fromEntries(group.map((value) => [value.name, renamed(value.name)]))
        const shareAll = asked?.share === true
        const sides: Record<string, string> = { east: "west", west: "east" }
        group.forEach((value) => {
          const handle = addBone(names[value.name]!, { parent: value === top ? value.parent : names[value.parent!]!, pivot: flipped(value.pivot), rotation: [value.rotation[0], -value.rotation[1] + 0, -value.rotation[2] + 0], paint: value.paint })
          value.cubes.forEach((cube) =>
            handle.cube(cube.name, {
              origin: [-(cube.origin[0] + cube.size[0]) + 0, cube.origin[1], cube.origin[2]],
              size: cube.size,
              faces: Object.fromEntries(FACES.map((face) => [face, cube.faces[sides[face] ?? face]!])),
              // A mark keeps its place on the mirrored box: its face swaps sides and it is counted from the other edge.
              // A copy that wears the original's texture (`share`) draws none of its own marks.
              details: shareAll || cube.share ? [] : cube.surface_details.map((detail) => ({ ...detail, face: sides[detail.face as string] ?? detail.face, x: faceSize(cube.size, detail.face, texel)[0] - (detail.x as number) - (detail.width as number) })),
              paint: cube.paint,
              features: shareAll || cube.share ? undefined : cube.features,
              // 第 1 步: a turned cube turns the other way on the other side; its own pixels are drawn mirrored on the swapped faces.
              ...(cube.rotation ? { rotation: [cube.rotation[0], -cube.rotation[1] + 0, -cube.rotation[2] + 0], ...(cube.pivot ? { pivot: [-cube.pivot[0] + 0, cube.pivot[1], cube.pivot[2]] } : {}) } : {}),
              ...(cube.inflate ? { inflate: cube.inflate } : {}),
              // With { share: true } in the rule the copy wears the original's texture, mirrored, and takes no texture of its own.
              ...(cube.share ? { share: cube.share, mirror: !cube.mirror } : shareAll ? { share: `${value.name}.${cube.name}`, mirror: !cube.mirror } : cube.mirror ? { mirror: true } : {}),
            }),
          )
          value.cubes.forEach((cube) => {
            if (!cube.pixels || shareAll || cube.share) return
            const made = bones.find((other) => other.name === names[value.name])!.cubes.find((other) => other.name === cube.name)!
            made.pixels = Object.fromEntries(Object.entries(cube.pixels).map(([face, drawn]) => {
              const width = faceSize(cube.size, face, texel)[0]
              return [sides[face] ?? face, { palette: drawn.palette, data: drawn.data.map((_, at) => drawn.data[at - (at % width) + (width - 1 - (at % width))]!) }]
            }))
          })
        })
        return names
      },
      animation: (name: unknown, asked: unknown) => {
        if (motions.length >= tier.animations) fail(`动作太多了：「${tier.name}」档一个模型最多 ${tier.animations} 个，这是第 ${motions.length + 1} 个。${higher(tier, "animations", "个")}`)
        const made = motionOf(name, options(asked, "animation 的选项"), (bone) => bones.some((value) => value.name === bone), false, tier)
        if (motions.some((value) => value.name === made.motion.name)) fail(`已经有一个叫「${made.motion.name}」的动作了。`)
        motions.push(made.motion)
        return made.self
      },
      /** The finished model as a document. */
      document: () => {
        if (!total()) fail("模型里一个方块都没有。")
        // The document's own rule, said here so the script hears it at the line that hands the model in.
        const absent = REQUIRED.filter((name) => !motions.some((motion) => motion.name === name))
        if (absent.length) fail(`模型文档必须带 ${REQUIRED.join("、")} 这三个动作，现在缺 ${absent.join("、")}。用 m.animation 把它们加上。`)
        const keyed = motions.reduce((sum, motion) => sum + motion.channels.reduce((keys, channel) => keys + channel.tracks.rotation.length + channel.tracks.position.length + channel.tracks.scale.length, 0), 0)
        if (tier.total_keys !== null && keyed > tier.total_keys) fail(`关键帧太多了：所有动作加起来有 ${keyed} 个，「${tier.name}」档整个模型最多 ${tier.total_keys} 个，多了 ${keyed - tier.total_keys} 个。把 sample 的 count 调小，或者只给真的在动的骨骼加关键帧。${higher(tier, "total_keys", "个")}`)
        return { kind: "model", name: title, texture_size: size, ...(texel === 1 ? {} : { texel_size: texel }), ...(shading ? { shading } : {}), ...(atlas ? { atlas } : {}), ...(tier.id === L.tier ? {} : { budget: tier.id }), bones: bones.map((bone) => ({ ...bone, cubes: bone.cubes.map((cube) => ({ ...cube })) })), animations: motions.map(written) }
      },
    }
    builders.set(self, self.document)
    return Object.freeze(self)
  }

  /** A motion on its own, for a model that already exists. */
  const animation = (asked: unknown) => ((given) => motionOf(given.name, given, null, true).self)(options(asked, "animation 的选项"))

  // A note too long, or one too many, is not dropped without a word: what was cut is said where it was cut.
  const unkept = { count: 0 }
  const note = (text: unknown) => {
    const said = typeof text === "string" ? text : JSON.stringify(text) ?? String(text)
    if (notes.length < L.notes) return void notes.push(said.length > L.note ? `${said.slice(0, L.note - 12)}…（太长，后面的没留）` : said)
    unkept.count += 1
    notes[L.notes - 1] = `（api.note 一次最多留 ${L.notes} 条：第 ${L.notes} 条和它后面的 ${unkept.count} 条没有留下。）`
  }

  const deep = <T>(value: T): T => {
    if (((typeof value === "object" && value !== null) || typeof value === "function") && !Object.isFrozen(value)) Object.values(Object.freeze(value)).forEach(deep)
    return value
  }
  // Frozen through and through, functions included: a script cannot change what the next line of itself is given.
  const shape = (name: ShapeFrame["shape"], parameters: Record<string, unknown> = {}) => {
    if (!raster || !given.shapeNames?.includes(name)) throw new Error("形状名请从 list_particle_shapes 里选")
    const image = raster({ ...parameters, shape: name } as ShapeFrame)
    const result = canvas(image.width, image.height, null)
    for (let i=0;i<image.pixels.length;i+=4) {
      if (!image.pixels[i+3]) continue
      const color = "#" + image.pixels.slice(i,i+4).map(v=>v.toString(16).padStart(2,"0")).join("")
      result.set(i/4%image.width,Math.floor(i/4/image.width),color)
    }
    return result
  }
  const api = deep({ ...(given.particle ? {shape} : {}), model, animation, canvas, trace, concepts, faceSize, layout, wears: given.wears, note, add, sub, scale, length, lerp, clamp, smooth, rad, deg, rotate, mirror, random, mix, shade, lit, along, curve })

  /** What the script returned, as the text that leaves the sandbox. A builder handed back whole is asked for its document. */
  const finish = (returned: unknown) => {
    if (typeof returned === "object" && returned !== null && typeof (returned as { then?: unknown }).then === "function") fail("脚本不能是异步的：不要用 async、await 或 Promise，直接 return 文档。")
    // A block may have several pictures for the game to choose among: a list of canvases leaves as that many pictures, in order.
    const several = given.flat && Array.isArray(returned) && returned.length > 0 && returned.every((value) => canvases.has(value as object))
    // A block that is boxes put together: the boxes and the one sheet they are drawn on, with how it faces and what stops a player.
    const shaped = given.flat && typeof returned === "object" && returned !== null && !Array.isArray(returned) && !canvases.has(returned) && !builders.has(returned) && "elements" in returned
    if (shaped) {
      const body = returned as { elements: unknown; sheet: unknown; facing?: unknown; collision?: unknown }
      if (!canvases.has(body.sheet as object)) fail("外形的 sheet 要是一张画布：return { elements, sheet: api.canvas(16, 16, null), facing, collision }。")
      return JSON.stringify({ value: { kind: "shape", facing: body.facing ?? "none", collision: body.collision ?? "full", elements: body.elements, sheet: (body.sheet as { picture: () => unknown }).picture() }, notes })
    }
    const made = several ? { kind: "pictures", pictures: (returned as { picture: () => unknown }[]).map((value) => value.picture()) } : canvases.has(returned as object) ? (given.flat ? (returned as { picture: () => unknown }).picture() : (returned as { texture: () => unknown }).texture()) : builders.has(returned as object) ? builders.get(returned as object)!() : returned
    return JSON.stringify({ value: typeof made === "object" && made !== null ? made : null, notes })
  }

  return { api, notes, finish }
}

/** One line for each thing the script can use. The instructions are written from this list, and a test holds it to what `scriptApi` really offers. */
export const MODEL_POSE_SCRIPT = '尾巴、铁链或披风用 follow 的 mode:"hang"，踩台阶用 foot_placement。脚掌在当前姿势下按实际盒体的旋转和外扩贴住踏面；请把脚底的几何盒放在对应脚骨上。建模脚本最后先取 const doc = m.document()，再写 doc.follow = [{bone:"tail_1", mode:"hang"}, {bone:"tail_2", mode:"hang"}] 和 doc.foot_placement = {feet:[{thigh:"leg_l", calf:"calf_l"}, {thigh:"leg_r", calf:"calf_r"}]}，最后 return doc。骨骼名换成实际的名字，完整字段见 module_schema(model)。两项均由 ModelDesignSchema 校验。'

export const SCRIPT_API: readonly (readonly [string, string])[] = [
  ["api.model({ name, texture_size, budget, texel_size, shading, atlas })", `开始做一个模型，交回 m。texture_size 是 ${TEXTURE_SIZES.filter((size) => size <= GEOMETRY_TIERS[DEFAULT_TIER].texture).join("、")} 之一，不写就是 64。budget 是几何预算的档（${Object.keys(GEOMETRY_TIERS).join("、")}），不写就是 ${DEFAULT_TIER}；高一档能用更多方块、骨骼和更大的贴图，要在部件说明里写明理由。texel_size 不写就是 1（一个贴图像素对一个模型像素）；只有这一档最大的贴图也放不下的巨型模型才写 2 或 4（一个贴图像素盖 2×2 或 4×4 个模型像素），这时每个面的画布、色块、特征都按贴图像素算（api.faceSize(size, face, texel_size)），用不着时会被拒绝。shading 写 "rich" 是按朝向的明暗、边缘高光、接缝暗边和材质磨损来画（Boss 和史诗档都该写）；atlas 写 "packed" 是各个面按高矮排进贴图，空地方少很多。史诗档贴图最大 1024，脚本最多算 ${GEOMETRY_TIERS.epic.script_seconds} 秒（最精细 ${GEOMETRY_TIERS.finest.script_seconds} 秒、精细 ${GEOMETRY_TIERS.fine.script_seconds} 秒、普通 ${GEOMETRY_TIERS.standard.script_seconds} 秒，看 api.model 里写的 budget）。`],
  ["m.bone(name, { parent, pivot, rotation, paint })", "建一根骨骼，交回它。第一根是根骨骼；后面的不写 parent 就挂在根骨骼上。pivot 是关节的位置，rotation 是它摆好的角度（度）。"],
  ["bone.bone(name, { pivot, rotation, paint })", "在这根骨骼下面再建一根。"],
  ["bone.name / bone.pivot", "这根骨骼的名字，和它的关节写在哪里（写它下面的方块时，以这个点为准）。"],
  ["m.joint(name, { parent, at, toward, along, paint })", "按“最后落在哪里”来建一根骨骼：at 是关节在上面的骨骼都转好以后的实际位置；给了 toward，就把它转到自己的 along 轴（x+、x-、y+、y-、z+、z-，默认 z-）正对着 toward；不给 toward，不管上面的骨骼怎么转，它自己都是正的。"],
  ["bone.cube(name, { origin | center, size, color, faces, draw, details, paint, features, rotation, pivot, inflate, mirror, share })", "在这根骨骼上加一个方块。rotation、pivot、inflate、mirror、share 就是文档里方块的那几栏（转过角度的板、胀一圈、贴图左右翻、穿另一个一样大的方块的贴图），原样写，不写就没有。「最精细」「史诗」档里 draw 上去的画布一个像素一个像素原样留下（文档里是这个面的 pixels），不再拆成色块，也没有 64 块的限制。origin 是它最小的那个角，或者用 center 写正中；size 是三个整数。color 是整块的颜色，faces 可以单独改某个面，draw 可以把一张画布画到某个面上；paint、features 和 details 就是文档里原来的那三栏，原样写。faces、draw 的面名，和 details、features 里的 face，除了六个面的名字以外还可以写 outer（朝外，背向中线 x=0 的那个侧面）和 inner（朝内，对着中线的那个侧面）：Studio 按这个方块转好以后落在中线哪一边，把它换成 west 或 east。方块跨在中线上或者正好在中线上，没有内外之分，会被拒绝并说明。"],
  ["m.cube(bone, name, { … })", "同上，骨骼用名字指出来。"],
  ["bone.solid(name, { shape, step, color, faces, paint, … })", "在这根骨骼上加一个按参数生成的形体，像 CAD 里的基本体：它按模型的像素格一格一格取样，再并成尽量少的方块（名字是 name_1、name_2…），每个方块用同样的 color、faces、paint。shape 是 \"ellipsoid\"（椭球：center、radii 写 [x, y, z] 三个半径或一个数）、\"cylinder\"（圆柱或椭圆柱：from 是底面中心，axis 是 \"x\"/\"y\"/\"z\"，length，radius 写一个数或 [横, 纵]）、\"cone\"（圆锥或圆台：同 cylinder，再加 end_radius，0 就是尖的）、\"tube\"（沿一条顺滑的线的圆管：points，radius 一个数或从头到尾的几个数）、\"rounded_box\"（圆角长方体：origin 或 center、size、round 圆角半径）。step 是每格几个像素（默认 1，越大越粗、方块越少）；step 每大 1，边上的台阶就宽一个像素，一个半径不到 10 像素的形体用 2 或 3 就已经看起来是方的了，要它看起来圆就用 1。史诗档体积大的圆体可先试 2，只在轮廓仍像参考图时保留；小件需要细弧时保持 1，方块不够就简化无关紧要的细节。方块数照常算进预算，超了会告诉你差多少。想斜着放，把它放在转过的骨骼上。"],
  ["m.solid(bone, name, { … })", "同上，骨骼用名字指出来；交回它用了几个方块。"],
  ["m.get(name)", "按名字取回一根骨骼。"],
  ["m.clear(bone)", "把这根骨骼上的方块全部去掉，骨骼自己和它下面的骨骼都留着（动作还是能用），然后你再用 cube、solid 重新做；交回这根骨骼。"],
  ["m.count()", "现在有几根骨骼、几个方块、几个动作。"],
  ["m.world(bone, point)", "写在这根骨骼下面的一个点，等上面的骨骼都转好以后，实际落在哪里。"],
  ["m.rest(bone, point)", "反过来：想让一个点落在某处，在这根骨骼下面应该写什么坐标。"],
  ["m.chain(prefix, { parent, points, sizes, along, overlap, cube, color, faces, paint, each })", "沿着一串点摆一排首尾相接的骨骼，每段一个方块，关节正好落在这些点上。sizes 是每一段的 [宽, 高]（列表，或者 (i, n) => [宽, 高]），每个数都由你给。交回这一排骨骼。each(i, n) 可以给每一段单独的表面。"],
  ["m.mirror(bone, { from, to, share })", "把一根骨骼连同它下面的所有东西，在 x=0 的另一侧照样再做一份，名字里的 from 换成 to（也可以给一个改名的函数）。转过角度的方块转到另一边。share 写 true 时，另一边的方块直接穿这一边的贴图（左右翻过来），不另占贴图。交回 { 旧名字: 新名字 }。"],
  ["m.animation(name, { length, loop })", "给模型加一个动作，交回 a。"],
  ["a.key(bone, time, [x, y, z], { track, interpolation })", "加一个关键帧：这根骨骼在第几秒。track 不写就是 rotation（比摆好的角度再转多少度）；写 position 是把这根骨骼连同它下面的东西挪多少像素，写 scale 是绕着关节放大缩小多少倍（1 是原样）。interpolation 说从这个关键帧出发怎么走到下一个：linear（直线，默认）、step（保持不变，到下一个关键帧再跳）、smooth（顺滑地经过这个关键帧，前后两段都是曲线）。"],
  ["a.keys(bone, [[time, [x, y, z]], …], { track, interpolation })", "一次加好几个关键帧。单独某一项可以写成 [time, [x, y, z], interpolation]。"],
  ["a.sample(bone, (t, seconds) => [x, y, z], count, { track, interpolation, delay })", "按一个时间的函数取关键帧：从头到尾均匀取 count 个，t 从 0 到 1。哪一种 track 都可以。delay 是晚多少秒：这根骨骼每一刻做的是函数在 delay 秒之前的值（循环的动作绕回去，不循环的在开头等着）。"],
  ["a.stagger(bones, (t, seconds, i, n) => [x, y, z], { count, track, interpolation, delay })", "把同一个时间函数依次交给一排骨骼（比如 chain 交回来的那一排），每一根比前一根晚一点。delay 由你给：一个数（每根比上一根晚这么多秒）、一个列表、或者 (i, n) => 比第一根晚多少秒。函数还会被告知现在是第几根（i，从 0 起）和一共几根（n）。"],
  ["m.document()", `做好的模型文档。脚本最后把它 return 出去。${MODEL_POSE_SCRIPT}`],
  ["api.animation({ name, length, loop, budget })", "单独做一段动作（给已经有的模型用），用法和 a 一样，最后 return 它的 document()。它要带动的模型是高一档的，budget 写和模型一样的档。"],
  ["api.canvas(width, height, fill)", "一张像素画布，交回 c。可以画到方块的面上，可以整张当贴图，也可以整张当一个方块或物品自己的那张图。fill 写 null 是一张空的（透明的）画布。"],
  ["api.trace(name, { size, colors, outline, shade, fit, background })", `拿你交给 Studio 的一张构想图（save_concepts 交的，name 是图的名字；只交了一张时可以不写）做起点，交回一张画布 c，可以接着用 set、rect、line 手改，最后和别的画布一样 return。它依次做：去掉背景（图自己有透明就用透明；没有就取图边上一圈的底色，从边上往里去掉，主体里同样颜色的地方留着）→ 把主体按比例缩进 size（[宽, 高] 或一个数，默认 16×16，最大 ${SCRIPT_LIMITS.canvas}）→ 用 OKLab 里的中位切分加 k-means 把颜色合成 colors 种（2 到 32，默认 8；OKLab 里颜色的远近和眼睛看到的差不多，所以合并的是看起来相近的颜色）→ shade 写 true 或 0.02 到 0.3 的数，按左上亮、右下暗每种颜色再分出亮、中、暗（不写不分）→ outline 写 true 在主体外面描一圈 1 像素的深色边（写 "#RRGGBB" 就用这个颜色；有描边时主体四周留 1 格给它）。fit 默认 "contain"（整个主体放进去），"cover" 是铺满切掉多的；background 默认自动，写 "#RRGGBB" 指定背景色，写 null 表示只看图自己的透明。构想图交进来时已经缩到长边不超过 ${SCRIPT_LIMITS.trace} 像素；一份任务最多 ${SCRIPT_LIMITS.pictures} 张。它做的是起点：形状和颜色照构想图，细节、对比和高光还要自己改。`],
  ["api.concepts", "这个任务交过的构想图：[{ name, width, height }]（读不出来的图多一项 error，说明为什么）。没交过就是空列表。"],
  ["c.set(x, y, color) / c.get(x, y)", "画一个像素 / 读一个像素。颜色写 null 就是把这个像素擦成透明（rect、line 也一样）；只有方块或物品自己的那张图可以留着透明。"],
  ["c.rect(x, y, w, h, color)", "填一个矩形。"],
  ["c.line(x0, y0, x1, y1, color)", "画一条线。"],
  ["c.gradient(x, y, w, h, from, to, { direction, steps })", "从一种颜色过渡到另一种，分成 steps 条色带。direction 是 \"down\"（默认）或 \"right\"。"],
  ["c.noise(x, y, w, h, colors, { seed, cell })", "用给的几种颜色铺成一块一块连在一起的斑块（不是零散的噪点）。cell 是斑块大概有多宽，seed 相同画出来就相同。"],
  ["c.stamp(other, x, y)", "把另一张画布贴到这张上。"],
  ["c.texture()", "这张画布作为贴图文档。单独做贴图时，脚本最后把它 return 出去。"],
  ["c.picture()", "这张画布作为一个方块或物品自己的那张图（透明的像素保留）。给方块或物品画图时，脚本最后把画布 return 出去就是它。方块要好几张图给游戏随机换着用时，return 一个画布的列表：[第一张, 第二张, …]。"],
  ["api.faceSize(size, face, texel_size)", "一个方块的某个面是多少像素：[宽, 高]。往面上画的画布要和它一样大。模型写了 texel_size 2 或 4 时把它作第三个参数传进来（面按贴图像素算，向上取整）。"],
  ["api.layout(boxes, { size, density, gap })", "给不是整块的方块排 sheet：boxes 是 [{ name, from, to, rotation, faces: [\"north\", \"up\", …] }, …]（坐标是方块内的像素，0 到 16），每个要画的面按它盖住的大小分到 sheet 上一块，从高的排起一行一行排。默认方块的 1 个像素用 sheet 的 1 个像素，和原版的贴图一样细；density 写 2 是两倍细，写 0.5 是粗一半（不够一个像素的部分进一位）。交回 { size, elements（盒子照原样，每个面多了 uv；faces 写成 { north: { cull: true } } 可以指定 cull，不写是 false）, areas（每个面在 sheet 上的位置：[{ element, face, x, y, width, height }]，照着往画布上画）}。size 是 16、32 或 64，不写是 16；gap 是块和块之间留几个像素，不写是 0。排不下会说清楚缺多少、怎么办。"],
  ["api.wears", "做贴图或者单独的动作时，它要穿（要带动）的那个模型：bones（每根骨骼的名字、关节、方块）和 faces（每个面在贴图上的位置 x、y、width、height）。没有就是 null。"],
  ["api.add(a, b) / api.sub(a, b) / api.scale(a, k) / api.length(a)", "向量（[x, y, z]）的加、减、乘、长度。"],
  ["api.lerp(a, b, t) / api.clamp(v, low, high) / api.smooth(t)", "两个数或两个向量之间取一点；把数夹在范围里；0 到 1 之间两头慢中间快。"],
  ["api.rad(degrees) / api.deg(radians)", "角度和弧度互换。"],
  ["api.rotate(point, pivot, rotation)", "一个点绕着一个轴心，按骨骼的转法转过 rotation 以后在哪里。"],
  ["api.mirror(point)", "一个点在 x=0 另一侧的位置。"],
  ["api.along(points, t) / api.curve(points, count)", "一串点连成的线上走到 t（0 到 1）的那一点；穿过这些点的一条顺滑的线，等分成 count 段。"],
  ["api.random(seed)", "有种子的随机数：r() 是 0 到 1，r.between(a, b)、r.whole(a, b)、r.pick(list)。种子相同，结果相同。"],
  ["api.mix(a, b, t) / api.shade(color, amount) / api.lit(color, amount)", "两种颜色之间取一种；调亮（正数）或调暗（负数）；由一种颜色得出六个面的颜色，顶面亮一些、底面暗一些。"],
  ["api.note(text)", "留一句话给自己看：会跟着结果一起交回来。"],
]

/**
 * Words that would mean the medium has started to know a subject. None may appear in a name the script can
 * call or in an option it can pass. (`faces` is a box's six sides; `bone` is a joint of the rig: both are the document's own words.)
 */
export const SCRIPT_DENIED = [
  "leg", "legs", "arm", "arms", "head", "tail", "wing", "wings", "limb", "limbs", "torso", "neck", "spine", "rib", "ribs", "foot", "feet", "hand", "hands", "finger", "fingers", "toe", "toes", "claw", "claws", "horn", "horns",
  "eye", "eyes", "mouth", "jaw", "snout", "nose", "ear", "ears", "hair", "fur", "feather", "feathers", "scales", "skin", "membrane", "body",
  "creature", "animal", "monster", "dragon", "bird", "fish", "snake", "humanoid", "human", "biped", "quadruped", "character", "mob",
  "wheel", "wheels", "door", "window", "roof", "wall", "chair", "table", "car", "vehicle", "house", "building", "tree", "trunk", "branch", "leaf", "leaves", "flower", "plant", "sword", "weapon", "tool", "machine", "robot",
  "preset", "presets", "template", "templates", "kit", "proportion", "proportions", "anatomy", "skeleton", "rig", "pose", "walk", "idle", "flap", "run",
] as const

/** A worked example, deliberately of nothing in particular: a row of posts with a rail. It shows the writing, not a subject. */
export const SCRIPT_EXAMPLE = `const m = api.model({ name: "一排柱子和横杆", texture_size: 64 })
const base = m.bone("base", { pivot: [0, 0, 0] })
const count = 5
const gap = 6
for (let i = 0; i < count; i++) {
  const x = (i - (count - 1) / 2) * gap
  // 每根柱子是一根骨骼，关节在柱脚
  const post = base.bone("post_" + (i + 1), { pivot: [x, 0, 0] })
  post.cube("shaft", { origin: [x - 1, 0, -1], size: [2, 10 + (i % 2) * 2, 2], faces: api.lit("#8a6a45", 0.15) })
}
// 横杆从第一根柱子连到最后一根
base.cube("rail", { origin: [-(count - 1) / 2 * gap - 1, 7, -2], size: [(count - 1) * gap + 2, 2, 1], faces: api.lit("#b08a5a", 0.15) })
const sway = m.animation("idle", { length: 2, loop: true })
for (let i = 0; i < count; i++) sway.sample("post_" + (i + 1), (t) => [0, 0, Math.sin(t * Math.PI * 2 + i) * 2], 9)
m.animation("walk", { length: 1, loop: true }).sample("base", (t) => [Math.sin(t * Math.PI * 2) * 6, 0, 0], 9)
m.animation("hurt", { length: 0.4, loop: false })
  .keys("base", [[0, [0, 0, 0]], [0.1, [-10, 0, 0]], [0.4, [0, 0, 0]]])
  // 同一根骨骼还可以有位移和缩放两条轨道：单位、方向和 interpolation 的意思见上面的说明
  .keys("base", [[0, [0, 0, 0]], [0.1, [0, 0, 1], "smooth"], [0.4, [0, 0, 0]]], { track: "position" })
return m.document()`

const seconds = SCRIPT_LIMITS.seconds

/** How to write a script, for every AI, whichever way it comes by. */
export const SCRIPT_GUIDE =
  `模型、贴图和单独的动画有两种交法，哪一种都可以，结果是同一种文档：直接写文档（JSON），或者写一段 JavaScript 脚本，由 Studio 运行，脚本 return 出来的就是文档。之后看图、验收、保存都一样。` +
  `什么时候用脚本：有重复的（一排、一圈、一串差不多的部件）、有左右对称的、有一节接一节的链条（每一节都接在上一节末端并且转一点角度）、部件很多（几十个方块以上）、或者表面要按规律画。这些用脚本写又短又准，手敲坐标容易错也写不多。部件少、每个都不一样的，直接写文档就行。` +
  `脚本是一段函数体，最多 ${SCRIPT_LIMITS.source} 个字符。里面可以用 api 和普通的 JavaScript（循环、函数、Math），最后必须 return 一份文档。脚本读不了文件、连不了网、没有定时器、没有 require 和 import，也没有 Date 和 Math.random（要随机数用 api.random(seed)，同一个脚本每次跑出来必须一样）。最多算 ${seconds} 秒，文档的上限不变：${SCRIPT_LIMITS.bones} 根骨骼、${SCRIPT_LIMITS.cubes} 个方块、贴图最大 ${SCRIPT_LIMITS.texture}×${SCRIPT_LIMITS.texture}、${SCRIPT_LIMITS.animations} 个动作、每根骨骼每个动作 ${SCRIPT_LIMITS.keys} 个关键帧（这是不写 budget 时的「${GEOMETRY_TIERS[DEFAULT_TIER].name}」档）。${BUDGET_GUIDE}脚本出错会告诉你错在第几行、是什么错，改了再交。` +
  `api 只是材料，不是零件库：它只懂骨骼、方块、关键帧、像素和一点几何，不知道任何东西长什么样。每一个尺寸、位置、颜色、角度都由你给。` +
  `圆的、椭圆的、带弧度的、一头粗一头细的、沿一条曲线走的形状，用 bone.solid 按参数生成（像 CAD 里的椭球、圆柱、圆锥、圆管、圆角长方体），改半径、长短径、粗细就能调形状，比一块一块手摆准、也快；它出来的还是方块，像素风格不变。` +
  `api.trace 是给方块和物品自己的那张图用的（它留透明的底）；穿在模型上的贴图不能有透明，一般不用它。` +
  `坐标和文档一样：Y 朝上，正面朝 -Z，x=0 是中线，脚底在 y=0；单位是像素。${ORIENTATION_GUIDE}骨骼的 rotation 和转动的关键帧都是 [x, y, z] 度；关键帧是在骨骼摆好的角度上再加的。${ANIMATION_GUIDE}方块写在它所属骨骼“还没转”的位置上，骨骼一转，它下面的方块和骨骼都跟着转；想知道转完落在哪，用 m.world，想反过来求该写什么，用 m.rest。` +
  `能用的全部在这里：${SCRIPT_API.map((entry) => `${entry[0]} —— ${entry[1]}`).join("；")}。` +
  `一个例子，只示范写法（故意不是任何具体的东西，不要照抄它的内容）：\n${SCRIPT_EXAMPLE}\n` +
  `改上一版的时候改脚本，不要把脚本的结果抄成文档再手改。`

/** The few lines of it for a capability list or a tool description. */
export const SCRIPT_SUMMARY = `模型、贴图和单独的动画可以用脚本来交：在 look、update_task、commit_task 里用 script（一段 JavaScript 函数体，最后 return 文档）代替 document，Studio 在隔离的环境里运行它，得到的文档照常看图、验收、保存。两种交法是平等的；重复、对称、成串、部件很多或者表面有规律的东西，用脚本更合适。脚本只能用 api 提供的骨骼、方块、关键帧、像素和几何，没有任何题材的零件；读不了文件、连不了网，最多算 ${seconds} 秒。`

/**
 * For a block or an item the script does not replace the document: the document carries the name and the
 * numbers, the script draws the one picture, and Studio puts the picture into the document's `texture`.
 */
export const DRAWN_KINDS = ["block", "item", "particle"] as const
export type DrawnKind = (typeof DRAWN_KINDS)[number]
export const isDrawn = (kind: string): kind is DrawnKind => (DRAWN_KINDS as readonly string[]).includes(kind)

/** How many pictures one drawing script may hand back for a block: its first and as many more as a block may carry (`BLOCK_FACES.extra` in texture-facts.ts; a test holds the two together). */
export const DRAWN_PICTURES = 4

/** How a block's or an item's picture is drawn by script, for every AI, whichever way it comes by. */
/**
 * A block that is boxes put together (`shape`): the script draws the whole of it. The document carries the name and the numbers
 * and says `shape: null`; the script's return is the shape, and replaces any a document has.
 */
export const DRAWN_SHAPE_GUIDE =
  "方块不是整块、而是几个方盒子拼成的时候（花盆、灯笼、讲台那样），脚本也可以搭它：document 照常写（shape 写 null），脚本先用 api.layout 把每个面要的像素块排到 sheet 上，再用 api.canvas(size, size, null) 开一张 sheet 画布、照着 areas 往上画，最后 return { elements, sheet, facing, collision }——elements 和 size 用 layout 交回来的，sheet 是那张画布，facing 是 \"horizontal\"（放下时正面朝着玩家）或 \"none\"（不写就是 none），collision 是 \"shape\"（碰撞就是这些盒子）或 \"full\"（和整块一样，不写就是 full）。Studio 把它放进文档的 shape，texture 不动。"

export const DRAWN_GUIDE =
  `方块和物品自己的那张图有两种交法，哪一种都可以：把 PNG（data URL）直接写在文档的 texture 里；或者文档照常写（texture 写 null），另外交一段 JavaScript 脚本把图画出来——脚本 return 一张画布，Studio 运行它，把画出来的图放进文档的 texture。之后看图、验收、保存都一样。逐个像素手写 PNG 很容易出错，画图用脚本更稳，改上一版时改脚本就行。` +
  `脚本是一段函数体：用 api.canvas(16, 16, fill) 开一张画布（方块写底色，物品写 null 得到透明的底），用 set、rect、line、gradient、noise、stamp 往上画，最后 return 这张画布。里面可以用普通的 JavaScript（循环、函数、Math）；读不了文件、连不了网，没有 Date 和 Math.random（随机数用 api.random(seed)，同一个脚本每次跑出来必须一样），最多算 ${seconds} 秒。方块的图要铺满、不能有透明的像素；物品的图四周留透明。方块可以有好几张图让游戏在每个位置随机用一张（打破墙上的重复）：脚本 return 一个画布的列表（最多 ${DRAWN_PICTURES} 张，一样大），第一张进 texture，其余的依次进 variants；物品只有一张。` +
  `要让人一眼认出来的物品和方块（靠轮廓认的那种），可以不必一个像素一个像素凭空画：先用你自己的画图工具画一张正对着、轮廓清楚的图（背景一种纯色或透明，只画这一样东西，不画场景），用 save_concepts 交给 Studio，再在脚本里 let c = api.trace("图的名字", { size: 16, colors: 6, outline: true, shade: true }) 把它描成像素画布，然后用 set、rect、line 手改：补上缩小时丢掉的细线、提亮高光、加深暗部、把颜色收成少数几种，最后 return c。api.trace 只是起点，不是成品：还是要对着渲染图看，改到认得出来为止。这一步可做可不做；图案简单、不靠轮廓认的（一整块纹理之类），直接画就行。` +
  `api 只是材料：它只懂像素和颜色，不知道任何东西长什么样，每一个像素画在哪里、什么颜色都由你定。画图能用的：${SCRIPT_API.filter((entry) => /^(api\.canvas|api\.trace|api\.concepts|c\.(?!texture)|api\.random|api\.mix|api\.lerp|api\.note)/.test(entry[0])).map((entry) => `${entry[0]} —— ${entry[1]}`).join("；")}。` +
  DRAWN_SHAPE_GUIDE

/** The few lines of it for a capability list or a tool description. */
export const DRAWN_SUMMARY = `方块和物品自己的那张图可以用脚本来画：在 look、update_task、commit_task 里，document 照常写（texture 写 null），同时给 script（一段 JavaScript 函数体：用 api.canvas 开画布、往上画，最后 return 这张画布），Studio 在隔离的环境里运行它，把画出来的图放进文档的 texture，再照常看图、验收、保存。不是整块的方块（几个方盒子拼成的外形）也可以这样搭：用 api.layout 排 sheet，return { elements, sheet, facing, collision }。也可以不用脚本，直接把 PNG（data URL）写在 texture 里。交过构想图（save_concepts）的话，脚本里可以用 api.trace 把它描成像素画布当起点，再手改（可做可不做）。脚本只有像素和颜色可用，没有任何题材的零件；读不了文件、连不了网，最多算 ${seconds} 秒。`

/** What an AI is told about handing work in as a script, for one kind; null for a kind that takes documents only. */
export const scriptSummary = (kind: string) => (isScripted(kind) ? SCRIPT_SUMMARY : kind==="particle" ? "用 api.canvas 或 api.shape 画粒子帧，return 一到八张一样大的正方形画布，边长不超过 32，可写 #rrggbbaa。" : isDrawn(kind) ? DRAWN_SUMMARY : null)

/** What went wrong with a script, in words its author can act on. `line` is the script's own line, when it is known. */
export const SCRIPT_ERRORS = {
  too_long: (length: number) => `脚本有 ${length} 个字符，超过上限 ${length - SCRIPT_LIMITS.source} 个（最多 ${SCRIPT_LIMITS.source} 个）。用函数或循环合并重复的方块和关键帧。能独立交的贴图或动画另拆成对应任务，当前任务仍需一次交齐自己的脚本。`,
  empty: "脚本是空的。写一段 JavaScript，最后 return 一份文档。",
  forbidden: (word: string) => `脚本里不能用 ${word}。脚本只能用 api 和普通的 JavaScript：读不了文件、连不了网，也装不了别的代码。`,
  missing: (word: string, line: number | null) => `脚本${at(line)}用了 ${word}，这里没有这个东西。脚本只能用 api 和普通的 JavaScript：读不了文件、连不了网、没有定时器，也没有 Date 和 Math.random（随机数用 api.random(seed)）。`,
  syntax: (message: string, line: number | null) => `脚本写错了，没法运行${line === null ? "" : `（第 ${line} 行）`}：${message}`,
  threw: (message: string, line: number | null) => `脚本${at(line)}出错了：${message}`,
  deep: (line: number | null) => `脚本${at(line)}一层套一层调用得太深了（多半是函数自己调自己停不下来）。`,
  timeout: `脚本算到了时间上限（${seconds} 秒；模型脚本按 api.model 写的 budget 算，史诗档 ${GEOMETRY_TIERS.epic.script_seconds} 秒）还没有算完（多半是循环停不下来），已经停掉了。`,
  memory: `脚本占用的内存超过了上限（${SCRIPT_LIMITS.memory_mb} MB），已经停掉了。`,
  too_large: `脚本交出来的内容太大了（超过 ${Math.round(SCRIPT_LIMITS.output / 1_000_000)} MB），原样退回，没有截掉任何东西。文档大多是关键帧和面上的色块撑大的：把 sample 的 count 调小、只给真的在动的骨骼加关键帧，或者少画一些零碎的色块。`,
  nothing: "脚本没有交出文档：最后要 return 一份文档，比如 return m.document()。",
  crashed: "脚本没有跑完就断了，没有得到结果。",
  no_sandbox: "这台电脑上现在运行不了脚本。请直接写文档。",
  not_scripted: (label: string) => `${label}不能用脚本来交，只有模型、贴图和单独的动画可以。请直接写文档。`,
  too_many_pictures: (got: number) => `脚本交出了 ${got} 张图：一个方块最多 ${DRAWN_PICTURES} 张（第一张和 ${DRAWN_PICTURES - 1} 张变体）。`,
  one_picture: "物品只有一张图：脚本最后 return 一张画布，不要 return 列表。",
  not_a_picture: (got: string) => `给方块或物品画图的脚本，最后要 return 一张画布（api.canvas 开的那张），现在交出来的是 ${got}。`,
  wrong_kind: (wanted: string, got: string) => `这个任务要的是 ${wanted} 文档，脚本交出来的是 ${got}。`,
  invalid: (label: string, issues: string[]) => `脚本跑完了，但交出来的文档不符合「${label}」的格式：${issues.join("；")}。`,
} as const

function at(line: number | null) {
  return line === null ? "运行时" : `运行到第 ${line} 行`
}
