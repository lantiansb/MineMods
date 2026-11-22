import { assetRef, phaseRef } from "./finding-refs"
import { z } from "zod"
import type { StandardOutline } from "@minemods/studio-ai/acceptance"
import { ABILITY_LIMITS, COMBO_LIMITS, TICKS } from "./ability-words"
import { BOSS_LIMITS } from "./boss-words"
import { decodeTextureDataUrl } from "./content-texture"
import { hasCjk } from "./data-words"
import { decodeRgbaPng } from "./png-decode"

/**
 * A boss bar of its own (自定义血条, Boss 能力 6): a picture at the top of the screen in place of the game's bar, as data. One asset of
 * kind `bossbar` holds the look (a background, the picture of a full bar, where each stage's segment lies, the lock between two stages and
 * the frames it breaks in, a row of icons that light while the abilities they are bound to run, a name for every stage); a boss uses it with
 * `boss.bar.look: { asset }`. The Studio preview (`drawBossBar`), the build's layout file (`bossBarLayoutJson`) and the generated HUD read the
 * same resolved layout (`bossBarLayout`) and the same three rules (`bossBarFilled`, `bossBarLockFrame`, `bossBarLit`), so what the reviewer
 * sees is what the game draws. Nothing here knows a subject. No Node APIs: the app's window reads it too.
 */

/**
 * - `width`, `height`: the largest background, in pixels (one pixel of it is one pixel of the game's interface at scale 1).
 * - `stages`: a boss has at most `BOSS_LIMITS.phases` lines of life, so at most one more stage (the one before the first line).
 * - `lock`: the lock sprite is at most this many pixels a side; it breaks in `frames` pictures (the first is the whole lock), each shown `ticks` ticks.
 * - `icons`, `icon`: at most this many icons, each at most this many pixels a side.
 * - `dim`: an icon that is not lit is drawn with its colour multiplied by this (the game: the shader colour; the preview: the same product).
 * - `name`: characters of a stage's name, short enough to stand on one line over the bar.
 * - `dots`: the row of small dots kept for the arena's fixtures (Boss 能力 12): at most this many, each `dot` pixels, `gap` pixels apart.
 */
export const BOSS_BAR_LIMITS = {
  width: 512,
  height: 128,
  stages: BOSS_LIMITS.phases + 1,
  lock: 64,
  frames: { min: 2, max: 8 },
  ticks: { min: 1, max: 10 },
  icons: 16,
  icon: 32,
  dim: 0.35,
  name: 24,
  dots: 8,
  dot: { min: 2, max: 8 },
  gap: { min: 1, max: 16 },
} as const

const Png = z.string().max(2_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "图要写成 PNG 的 data URL（data:image/png;base64,…）")
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色写成 #rrggbb")
const X = z.number().int().min(0).max(BOSS_BAR_LIMITS.width - 1)
const Y = z.number().int().min(0).max(BOSS_BAR_LIMITS.height - 1)
const Point = z.strictObject({ x: X, y: Y })
const ChoiceId = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "招式和连招的 id 用小写字母开头，只含小写字母、数字和下划线")

/** The one built-in look: a plain bronze plaque drawn by `bronzeBar` at build time, laid out for as many stages as `names` has. */
export const BRONZE = "bronze" as const

const BossBarShape = z.strictObject({
    kind: z.literal("bossbar"),
    /** `"bronze"`: the built-in plaque, drawn for as many stages as `names` has; or a PNG of at most 512×128. */
    background: z.union([z.literal(BRONZE), Png]),
    /** What the segments look like full: a PNG as large as the background (inside each segment as much of it is drawn as the stage has life left), a colour, or null for the built-in ember red. */
    fill: z.union([Color, Png]).nullable(),
    /** Which way a segment empties: `left` keeps its left end (it empties toward the left), `right` its right end. */
    drain: z.enum(["left", "right"]),
    /** Where each stage's segment lies on the background, one for every stage (`phase` 0 is the one before the first line). Empty with the bronze plaque: laid out for you. */
    segments: z.array(z.strictObject({ x: X, y: Y, width: z.number().int().min(1).max(BOSS_BAR_LIMITS.width), height: z.number().int().min(1).max(BOSS_BAR_LIMITS.height), phase: z.number().int().min(0).max(BOSS_BAR_LIMITS.stages - 1) })).max(BOSS_BAR_LIMITS.stages),
    /**
     * The lock between two stages: `frames` (the whole lock first, then it breaking; null: the built-in bronze lock), each shown `ticks` ticks once the line is crossed,
     * and `at`, the top-left corner of the lock on each line (one fewer than the stages). `at` empty with the bronze plaque: on the gaps between its segments.
     */
    lock: z.strictObject({
      frames: z.array(Png).min(BOSS_BAR_LIMITS.frames.min).max(BOSS_BAR_LIMITS.frames.max).nullable(),
      ticks: z.number().int().min(BOSS_BAR_LIMITS.ticks.min).max(BOSS_BAR_LIMITS.ticks.max),
      at: z.array(Point).max(BOSS_BAR_LIMITS.stages - 1),
    }),
    /** Icons, each lit while one of the abilities or combos it names (by id) runs and dim otherwise. `image` null: a plain bronze roundel; `at` null: in a row under the bar. */
    icons: z
      .array(z.strictObject({ abilities: z.array(ChoiceId).min(1).max(ABILITY_LIMITS.abilities + COMBO_LIMITS.combos), image: Png.nullable(), at: Point.nullable() }))
      .max(BOSS_BAR_LIMITS.icons),
    /** The name of every stage, the first one included, in Chinese and English: the bar shows the one of the stage the fight is in. */
    names: z.array(z.strictObject({ zh: z.string().trim().min(1).max(BOSS_BAR_LIMITS.name), en: z.string().trim().min(1).max(BOSS_BAR_LIMITS.name).refine((name) => !hasCjk(name), "英文名里不能有中文") })).min(1).max(BOSS_BAR_LIMITS.stages),
    /** Where the stage's name stands on the bar (its middle); null: on the line above the bar, after the boss's own name. */
    name_at: Point.nullable(),
    /** Kept for the arena's fixtures (Boss 能力 12): a row of small dots centred on `x`, lit one by one (on the bronze plaque its own bottom row, whatever `x` and `y` say); null: none. A boss whose arena puts fixtures down lights one a fixture (`StudioArena.dots`). */
    dots: z.strictObject({ x: X, y: Y, gap: z.number().int().min(BOSS_BAR_LIMITS.gap.min).max(BOSS_BAR_LIMITS.gap.max), size: z.number().int().min(BOSS_BAR_LIMITS.dot.min).max(BOSS_BAR_LIMITS.dot.max) }).nullable(),
})
type BossBarFields = z.infer<typeof BossBarShape>
export const BossBarDocumentSchema = BossBarShape.superRefine((document, context) => bossBarDocumentIssues(document).forEach((issue) => context.addIssue({ code: "custom", ...issue })))
export type BossBarDocument = z.infer<typeof BossBarDocumentSchema>

// ---- pictures as raw pixels ----

export type Picture = { width: number; height: number; pixels: Uint8Array }
type Rgba = readonly [number, number, number, number]

const blank = (width: number, height: number): Picture => ({ width, height, pixels: new Uint8Array(width * height * 4) })
const rgba = (color: string, alpha = 255): Rgba => [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16), alpha]
function put(picture: Picture, x: number, y: number, color: Rgba) {
  if (x < 0 || y < 0 || x >= picture.width || y >= picture.height) return
  picture.pixels.set(color, (y * picture.width + x) * 4)
}
function box(picture: Picture, x: number, y: number, width: number, height: number, color: Rgba) {
  for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) put(picture, column, row, color)
}

/** A PNG data URL as pixels, at most `side` pixels a side; null when it cannot be read. */
export function readPicture(source: string, side: number = BOSS_BAR_LIMITS.width): Picture | null {
  try {
    return decodeRgbaPng(decodeTextureDataUrl(source), { side })
  } catch {
    return null
  }
}

/**
 * `source` drawn over `target` at (x, y), the rectangle (sx, sy, width, height) of it, each colour multiplied by `tint` (an icon that is not lit), blended by its alpha.
 * The game blits with the default blend function (source alpha, one minus source alpha), which is this.
 */
export function blend(target: Picture, source: Picture, x: number, y: number, sx = 0, sy = 0, width = source.width, height = source.height, tint = 1) {
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) {
      const tx = x + column
      const ty = y + row
      const fx = sx + column
      const fy = sy + row
      if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height || fx < 0 || fy < 0 || fx >= source.width || fy >= source.height) continue
      const from = (fy * source.width + fx) * 4
      const to = (ty * target.width + tx) * 4
      const alpha = source.pixels[from + 3]! / 255
      if (!alpha) continue
      const under = target.pixels[to + 3]! / 255
      const out = alpha + under * (1 - alpha)
      for (let channel = 0; channel < 3; channel++) target.pixels[to + channel] = Math.round((source.pixels[from + channel]! * tint * alpha + target.pixels[to + channel]! * under * (1 - alpha)) / out)
      target.pixels[to + 3] = Math.round(out * 255)
    }
}

// ---- the built-in bronze look ----

const BRONZE_LOOK = { margin: 8, segment: 64, gap: 12, top: 6, trough: 10, base: 22, icon: 16, iconGap: 4, iconRow: 20, dotRow: 10, lock: [12, 14] as const, fill: "#c8372d" }
const METAL = { dark: rgba("#3b2410"), shadow: rgba("#5e3a18"), body: rgba("#8c5a2b"), light: rgba("#b98345"), shine: rgba("#e0b46e"), trough: rgba("#1e1209"), rivet: rgba("#f1d08a") }
const GEMS = ["#d8452f", "#e0a128", "#4f9bd8", "#57b05a", "#a066d0", "#e06aa0", "#5fc8c0", "#e8e0c8"]

/** Where the bronze plaque puts everything for `stages` stages, `icons` icons and, with `dots`, the arena's row: the pixels `bronzeBar` draws and the layout read the same numbers. */
const rowWidth = (icons: number) => icons * BRONZE_LOOK.icon + Math.max(0, icons - 1) * BRONZE_LOOK.iconGap
/** `count` icons of the bronze size in a row centred on a picture `width` wide, their tops at `y`. */
const iconRow = (count: number, width: number, y: number) => Array.from({ length: count }, (_, index) => ({ x: Math.floor((width - rowWidth(count)) / 2) + index * (BRONZE_LOOK.icon + BRONZE_LOOK.iconGap), y }))

export function bronzeGeometry(stages: number, icons: number, dots: boolean) {
  const look = BRONZE_LOOK
  const row = rowWidth(icons)
  const width = Math.max(2 * look.margin + stages * look.segment + (stages - 1) * look.gap, row + 2 * look.margin)
  const height = look.base + (icons ? look.iconRow : 0) + (dots ? look.dotRow : 0)
  const left = Math.floor((width - (stages * look.segment + (stages - 1) * look.gap)) / 2)
  return {
    width,
    height,
    segments: Array.from({ length: stages }, (_, phase) => ({ x: left + phase * (look.segment + look.gap), y: look.top, width: look.segment, height: look.trough, phase })),
    locks: Array.from({ length: stages - 1 }, (_, line) => ({ x: left + line * (look.segment + look.gap) + look.segment + look.gap / 2 - look.lock[0] / 2, y: look.top + look.trough / 2 - look.lock[1] / 2 })),
    icons: iconRow(icons, width, look.base),
    dots: dots ? { x: Math.floor(width / 2), y: look.base + (icons ? look.iconRow : 0) + 2, gap: 4, size: 4 } : null,
  }
}

/** The bronze plaque: a bevelled plate with a dark trough under every segment and a rivet in each corner. */
function bronzePlate(geometry: ReturnType<typeof bronzeGeometry>) {
  const picture = blank(geometry.width, geometry.height)
  box(picture, 0, 0, geometry.width, geometry.height, METAL.dark)
  box(picture, 1, 1, geometry.width - 2, geometry.height - 2, METAL.body)
  box(picture, 1, 1, geometry.width - 2, 1, METAL.light)
  box(picture, 1, 1, 1, geometry.height - 2, METAL.light)
  box(picture, 1, geometry.height - 2, geometry.width - 2, 1, METAL.shadow)
  box(picture, geometry.width - 2, 1, 1, geometry.height - 2, METAL.shadow)
  // A thin engraved line under the troughs.
  box(picture, 4, BRONZE_LOOK.top + BRONZE_LOOK.trough + 3, geometry.width - 8, 1, METAL.shadow)
  box(picture, 4, BRONZE_LOOK.top + BRONZE_LOOK.trough + 4, geometry.width - 8, 1, METAL.light)
  geometry.segments.forEach((segment) => {
    box(picture, segment.x - 1, segment.y - 1, segment.width + 2, segment.height + 2, METAL.shadow)
    box(picture, segment.x, segment.y, segment.width, segment.height, METAL.trough)
    box(picture, segment.x - 1, segment.y + segment.height, segment.width + 2, 1, METAL.shine)
  })
  ;[[2, 2], [geometry.width - 4, 2], [2, geometry.height - 4], [geometry.width - 4, geometry.height - 4]].forEach(([x, y]) => {
    box(picture, x!, y!, 2, 2, METAL.rivet)
    put(picture, x! + 1, y! + 1, METAL.shadow)
  })
  return picture
}

/** A full bar as large as the background: `color` (or ember red, lighter on its top row and darker on its bottom one) inside every segment, nothing elsewhere. */
function fillPicture(width: number, height: number, segments: readonly { x: number; y: number; width: number; height: number }[], color: string | null) {
  const picture = blank(width, height)
  const base = rgba(color ?? BRONZE_LOOK.fill)
  const shade = (by: number): Rgba => [Math.min(255, Math.round(base[0] * by)), Math.min(255, Math.round(base[1] * by)), Math.min(255, Math.round(base[2] * by)), 255]
  segments.forEach((segment) => {
    box(picture, segment.x, segment.y, segment.width, segment.height, base)
    if (color !== null || segment.height < 3) return
    box(picture, segment.x, segment.y, segment.width, 1, shade(1.35))
    box(picture, segment.x, segment.y + segment.height - 1, segment.width, 1, shade(0.7))
  })
  return picture
}

/** The bronze padlock, 12×14: whole, cracked, split in two and in pieces. */
function bronzeLock(): Picture[] {
  const [width, height] = BRONZE_LOOK.lock
  const whole = () => {
    const picture = blank(width, height)
    // The shackle: an arch over the body.
    box(picture, 3, 0, 6, 1, METAL.dark)
    box(picture, 2, 1, 1, 5, METAL.dark)
    box(picture, 9, 1, 1, 5, METAL.dark)
    box(picture, 3, 1, 1, 5, METAL.shine)
    box(picture, 8, 1, 1, 5, METAL.light)
    // The body with its keyhole.
    box(picture, 0, 5, width, height - 5, METAL.dark)
    box(picture, 1, 6, width - 2, height - 7, METAL.light)
    box(picture, 1, 6, width - 2, 1, METAL.shine)
    box(picture, 5, 8, 2, 2, METAL.dark)
    box(picture, 5, 10, 2, 2, METAL.trough)
    return picture
  }
  const cracked = whole()
  ;[[6, 6], [5, 7], [6, 8], [7, 9], [6, 10], [5, 11], [6, 12]].forEach(([x, y]) => put(cracked, x!, y!, METAL.trough))
  // Split: each half pushed away from the middle, the shackle gone.
  const split = blank(width, height)
  const halves = whole()
  box(halves, 0, 0, width, 5, [0, 0, 0, 0])
  blend(split, halves, -1, 1, 0, 0, width / 2, height)
  blend(split, halves, width / 2 + 1, 0, width / 2, 0, width / 2, height)
  // Pieces: a few shards falling, half seen.
  const pieces = blank(width, height)
  ;[[1, 9], [3, 12], [8, 10], [10, 13], [5, 13]].forEach(([x, y]) => {
    put(pieces, x!, y!, [METAL.light[0], METAL.light[1], METAL.light[2], 160])
    put(pieces, x! + 1, y!, [METAL.dark[0], METAL.dark[1], METAL.dark[2], 160])
  })
  return [whole(), cracked, split, pieces]
}

/** A plain bronze roundel, 16×16, with a stone of its own colour (by its place in the row) so two icons can be told apart. */
function bronzeIcon(index: number): Picture {
  const side = BRONZE_LOOK.icon
  const picture = blank(side, side)
  const gem = rgba(GEMS[index % GEMS.length]!)
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const distance = Math.hypot(x + 0.5 - side / 2, y + 0.5 - side / 2)
      if (distance <= side / 2) put(picture, x, y, METAL.dark)
      if (distance <= side / 2 - 1) put(picture, x, y, x + y < side ? METAL.light : METAL.body)
      if (distance <= side / 2 - 4) put(picture, x, y, gem)
    }
  put(picture, side / 2 - 2, side / 2 - 2, [255, 255, 255, 220])
  return picture
}

// ---- the resolved layout ----

export type BossBarLayout = {
  background: Picture
  fill: Picture
  drain: "left" | "right"
  /** One per stage, by stage. */
  segments: { x: number; y: number; width: number; height: number }[]
  lock: { frames: Picture[]; ticks: number; at: { x: number; y: number }[] }
  icons: { image: Picture; x: number; y: number; abilities: string[] }[]
  names: { zh: string; en: string }[]
  name_at: { x: number; y: number } | null
  dots: { x: number; y: number; gap: number; size: number } | null
  dim: number
}

/**
 * Everything a bar document leaves to Studio, filled in: the bronze plaque drawn for its stages, segments and locks laid on it, icons without a picture given a
 * roundel and icons without a place set in a row under the bar, the fill as a picture. Throws on a picture that cannot be read (the document's check has said so first).
 */
export function bossBarLayout(document: BossBarDocument): BossBarLayout {
  const stages = document.names.length
  const bronze = document.background === BRONZE
  const geometry = bronzeGeometry(stages, document.icons.length, document.dots !== null)
  const background = bronze ? bronzePlate(geometry) : readPicture(document.background)
  if (!background) throw new Error("BOSS_BAR_PICTURE")
  const segments = document.segments.length ? [...document.segments].sort((a, b) => a.phase - b.phase).map(({ phase: _phase, ...rest }) => rest) : geometry.segments.map(({ phase: _phase, ...rest }) => rest)
  const fill = document.fill?.startsWith("data:") ? readPicture(document.fill) : fillPicture(background.width, background.height, segments, document.fill)
  if (!fill) throw new Error("BOSS_BAR_PICTURE")
  const frames = document.lock.frames ? document.lock.frames.map((frame) => readPicture(frame, BOSS_BAR_LIMITS.lock)) : bronzeLock()
  if (frames.some((frame) => !frame)) throw new Error("BOSS_BAR_PICTURE")
  const first = frames[0]!
  // A lock not placed is centred on the gap between two segments next to each other (the bronze plaque's own places when it is the bronze plaque's).
  const at = document.lock.at.length ? document.lock.at : bronze && !document.segments.length ? geometry.locks : segments.slice(1).map((segment, line) => ({ x: Math.round((segments[line]!.x + segments[line]!.width + segment.x) / 2 - first.width / 2), y: Math.round(segment.y + segment.height / 2 - first.height / 2) }))
  // Icons with no place given stand in a row under the segments, centred: on the bronze plaque its own row, on a background of one's own just below the lowest segment.
  const row = iconRow(document.icons.length, background.width, bronze ? BRONZE_LOOK.base : Math.max(...segments.map((segment) => segment.y + segment.height)) + 4)
  const icons = document.icons.map((icon, index) => {
    const image = icon.image ? readPicture(icon.image, BOSS_BAR_LIMITS.icon) : bronzeIcon(index)
    if (!image) throw new Error("BOSS_BAR_PICTURE")
    const place = icon.at ?? row[index]!
    return { image, x: place.x, y: place.y, abilities: [...icon.abilities] }
  })
  const dots = document.dots && (bronze ? { ...geometry.dots!, gap: document.dots.gap, size: document.dots.size } : document.dots)
  return { background, fill, drain: document.drain, segments, lock: { frames: frames as Picture[], ticks: document.lock.ticks, at: at.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })) }, icons, names: document.names, name_at: document.name_at, dots, dim: BOSS_BAR_LIMITS.dim }
}

// ---- the three rules the HUD and the preview share ----

/**
 * How many pixels of a segment `width` wide are full: the share of its stage's life left. `lines` are the top of every stage (the first is 1, the boss's
 * `below` after it); the stage ends at the next one, the last at 0. A stage the fight has passed is empty, one it has not reached full. The generated
 * `StudioBossBarState.filled` is this, written the same way (`floor(x + 0.5)`).
 */
export function bossBarFilled(width: number, lines: readonly number[], stage: number, health: number) {
  const high = lines[stage] ?? 0
  const low = lines[stage + 1] ?? 0
  const share = high > low ? Math.min(1, Math.max(0, (health - low) / (high - low))) : 0
  return Math.floor(width * share + 0.5)
}

/**
 * Which frame of the lock on line `line` (between stage `line` and the next) is drawn, -1 for none: whole (0) while the fight has not crossed it; once it has,
 * frames 1, 2, … each `ticks` ticks from the moment it broke (`elapsed` ticks ago; negative: not known), then gone. `StudioBossBarState.lockFrame` is this.
 */
export function bossBarLockFrame(line: number, phase: number, elapsed: number, frames: number, ticks: number) {
  if (phase <= line) return 0
  if (phase === line + 1 && elapsed >= 0 && elapsed < (frames - 1) * ticks) return 1 + Math.floor(elapsed / ticks)
  return -1
}

/** Which icons are lit (a bit each) while choice `running` (abilities, then combos, by place; -1 none) runs and, inside a combo, ability `step` plays. `StudioBossBarState.litIcons` is this. */
export function bossBarLit(masks: readonly number[], running: number, step = -1) {
  return masks.reduce((lit, mask, index) => ((running >= 0 && (mask >>> running) & 1) || (step >= 0 && (mask >>> step) & 1) ? lit | (1 << index) : lit), 0)
}

/** For every icon, a bit for each choice of the creature (its abilities, then its combos: the order the generated Java numbers them) that lights it. */
export const bossBarMasks = (icons: readonly { abilities: readonly string[] }[], choices: readonly string[]) => icons.map((icon) => icon.abilities.reduce((mask, id) => (choices.includes(id) ? mask | (1 << choices.indexOf(id)) : mask), 0))

/** The top of every stage: 1, then each phase's line. */
export const bossBarLines = (phases: readonly { below: number }[]) => [1, ...phases.map((phase) => phase.below)]

/** What the bar shows at one moment: the stage, the life left (of the whole), the icons lit (a bit each), how long ago the last lock broke (ticks; -1 none), the arena's dots. */
export type BossBarState = { phase: number; health: number; lit: number; broke: number; dots?: { count: number; lit: number } }

/** The bar drawn as the game's HUD draws it (`StudioBossBarHud`), pixel for pixel at scale 1: background, the segments' fill, the locks, the icons, the arena's dots. Names are text and are said beside it. */
export function drawBossBar(layout: BossBarLayout, lines: readonly number[], state: BossBarState): Picture {
  const picture = blank(layout.background.width, layout.background.height)
  blend(picture, layout.background, 0, 0)
  layout.segments.forEach((segment, stage) => {
    const filled = bossBarFilled(segment.width, lines, stage, state.health)
    if (!filled) return
    const x = layout.drain === "left" ? segment.x : segment.x + segment.width - filled
    blend(picture, layout.fill, x, segment.y, x, segment.y, filled, segment.height)
  })
  layout.lock.at.forEach((point, line) => {
    const frame = bossBarLockFrame(line, state.phase, state.broke, layout.lock.frames.length, layout.lock.ticks)
    if (frame >= 0) blend(picture, layout.lock.frames[frame]!, point.x, point.y)
  })
  layout.icons.forEach((icon, index) => blend(picture, icon.image, icon.x, icon.y, 0, 0, icon.image.width, icon.image.height, (state.lit >>> index) & 1 ? 1 : layout.dim))
  const dots = layout.dots
  if (dots && state.dots?.count) {
    const across = state.dots.count * dots.size + (state.dots.count - 1) * dots.gap
    Array.from({ length: state.dots.count }, (_, index) => box(picture, dots.x - Math.floor(across / 2) + index * (dots.size + dots.gap), dots.y, dots.size, dots.size, (state.dots!.lit >>> index) & 1 ? DOT.lit : DOT.dark))
  }
  return picture
}
/** The tops of `stages` stages spread evenly (1, 0.67, 0.33 for three): the lines a bar is shown with when no boss gives its own. */
export const evenLines = (stages: number) => Array.from({ length: stages }, (_, stage) => Number((1 - stage / stages).toFixed(2)))

/**
 * The three moments every preview of a bar shows (spec: 满血、刚过 2/3 正在碎锁、残血), each with the words said under it: full life before any line; just past the
 * first line with its lock halfway through breaking and the first icon lit; the last stage with 15% of its life left and the second icon lit (the first when
 * there is one). A bar of one stage has no line: its middle picture is a third of its life gone. `lines`: the boss's own, or spread evenly.
 */
export function bossBarMoments(layout: Pick<BossBarLayout, "segments" | "lock" | "icons" | "names">, lines: readonly number[] = evenLines(layout.segments.length), includeEnglish = true) {
  const stages = layout.segments.length
  const last = stages - 1
  const frames = layout.lock.frames.length
  const lit = (index: number) => (layout.icons.length > index ? 1 << index : 0)
  const percent = (health: number) => `${Math.round(health * 100)}%`
  const name = (phase: number) => {
    const stage = layout.names[phase]
    if (!stage) return ""
    return includeEnglish ? `「${stage.zh}」（${stage.en}）` : `「${stage.zh}」`
  }
  const lighted = (mask: number) => (mask ? `第 ${Math.log2(mask) + 1} 个图标亮着` : "没有图标亮着")
  const breaking = 1 + Math.floor((frames - 2) / 2)
  const crossed = stages > 1 ? Math.max(0, lines[1]! - (lines[1]! - (lines[2] ?? 0)) * 0.04) : 0.66
  const low = (lines[last] ?? 1) * 0.15
  const moments: { label: string; state: BossBarState }[] = [
    { label: `满血 · 阶段${name(0)} · ${lighted(0)}`, state: { phase: 0, health: 1, lit: 0, broke: -1 } },
    stages > 1
      ? { label: `刚过第一条线（${percent(lines[1]!)}），血量 ${percent(crossed)}，锁正在碎（第 ${breaking + 1}/${frames} 帧） · 阶段${name(1)} · ${lighted(lit(0))}`, state: { phase: 1, health: crossed, lit: lit(0), broke: (breaking - 1) * layout.lock.ticks } }
      : { label: `血量 ${percent(crossed)}（只有一个阶段，没有锁） · 阶段${name(0)} · ${lighted(lit(0))}`, state: { phase: 0, health: crossed, lit: lit(0), broke: -1 } },
    { label: `残血 ${percent(low)} · 阶段${name(last)} · ${lighted(lit(1) || lit(0))}`, state: { phase: last, health: low, lit: lit(1) || lit(0), broke: -1 } },
  ]
  return moments
}

/** The colours of an arena dot, the same in the HUD (`0xFF…` there). */
export const DOT = { lit: rgba("#ffd36b"), dark: rgba("#3a2a1a") } as const

// ---- what is wrong with a bar ----

type Issue = { path: (string | number)[]; message: string }

/** What is wrong with a bar document by itself, in the person's words: pictures that cannot be read or are too large, places off the picture, counts that do not agree. */
export function bossBarDocumentIssues(document: BossBarFields): Issue[] {
  const found: Issue[] = []
  const stages = document.names.length
  const bronze = document.background === BRONZE
  const background = bronze ? bronzeGeometry(stages, document.icons.length, document.dots !== null) : readPicture(document.background, 4096)
  if (!background) return [{ path: ["background"], message: "background 不是一张读得出来的 PNG" }]
  if (background.width > BOSS_BAR_LIMITS.width || background.height > BOSS_BAR_LIMITS.height) return [{ path: ["background"], message: `血条的底图最大 ${BOSS_BAR_LIMITS.width}×${BOSS_BAR_LIMITS.height}，这张是 ${background.width}×${background.height}` }]
  const inside = (path: (string | number)[], what: string, x: number, y: number, width: number, height: number) =>
    (x + width > background.width || y + height > background.height) && found.push({ path, message: `${what}（${x},${y} 起 ${width}×${height}）超出了底图（${background.width}×${background.height}）` })
  if (!bronze && !document.segments.length) found.push({ path: ["segments"], message: "用自己的底图时要写 segments：每个阶段一段血条在底图上的位置（x、y、width、height、phase）" })
  if (document.segments.length && document.segments.length !== stages) found.push({ path: ["segments"], message: `segments 有 ${document.segments.length} 段，names 有 ${stages} 个阶段的名字：每个阶段一段、一个名字，两边要一样多` })
  document.segments.forEach((segment, index) => {
    inside(["segments", index], `第 ${index + 1} 段血条`, segment.x, segment.y, segment.width, segment.height)
    if (segment.phase >= stages) found.push({ path: ["segments", index, "phase"], message: `第 ${index + 1} 段写的是阶段 ${segment.phase}，可是只有 ${stages} 个阶段（0 到 ${stages - 1}）` })
    else if (document.segments.findIndex((other) => other.phase === segment.phase) !== index) found.push({ path: ["segments", index, "phase"], message: `阶段 ${segment.phase} 写了两段血条：每个阶段只有一段` })
  })
  if (document.fill?.startsWith("data:")) {
    const fill = readPicture(document.fill, 4096)
    if (!fill) found.push({ path: ["fill"], message: "fill 不是一张读得出来的 PNG" })
    else if (fill.width !== background.width || fill.height !== background.height) found.push({ path: ["fill"], message: `fill 的图要和底图一样大（${background.width}×${background.height}），这张是 ${fill.width}×${fill.height}` })
  }
  const frames = (document.lock.frames ?? []).map((frame) => readPicture(frame, 4096))
  frames.forEach((frame, index) => {
    if (!frame) found.push({ path: ["lock", "frames", index], message: `锁的第 ${index + 1} 帧不是一张读得出来的 PNG` })
    else if (frame.width > BOSS_BAR_LIMITS.lock || frame.height > BOSS_BAR_LIMITS.lock) found.push({ path: ["lock", "frames", index], message: `锁的每一帧最大 ${BOSS_BAR_LIMITS.lock}×${BOSS_BAR_LIMITS.lock}，第 ${index + 1} 帧是 ${frame.width}×${frame.height}` })
    else if (frames[0] && (frame.width !== frames[0].width || frame.height !== frames[0].height)) found.push({ path: ["lock", "frames", index], message: `锁的每一帧要一样大：第 1 帧是 ${frames[0].width}×${frames[0].height}，第 ${index + 1} 帧是 ${frame.width}×${frame.height}` })
  })
  const lock = frames[0] ?? { width: BRONZE_LOOK.lock[0], height: BRONZE_LOOK.lock[1] }
  if (document.lock.at.length && document.lock.at.length !== stages - 1) found.push({ path: ["lock", "at"], message: `lock.at 写了 ${document.lock.at.length} 把锁的位置，可是 ${stages} 个阶段之间只有 ${stages - 1} 条线：每条线一把锁` })
  document.lock.at.forEach((point, index) => inside(["lock", "at", index], `第 ${index + 1} 把锁`, point.x, point.y, lock.width, lock.height))
  if (!bronze && !document.lock.at.length && document.segments.length > 1) {
    const sorted = [...document.segments].sort((a, b) => a.phase - b.phase)
    const apart = sorted.slice(1).some((segment, line) => segment.y !== sorted[line]!.y)
    if (apart) found.push({ path: ["lock", "at"], message: "这几段血条不在同一行，锁放在哪里算不出来：写 lock.at（每条线一把锁的左上角）" })
  }
  document.icons.forEach((icon, index) => {
    const image = icon.image ? readPicture(icon.image, 4096) : { width: BRONZE_LOOK.icon, height: BRONZE_LOOK.icon }
    if (!image) return found.push({ path: ["icons", index, "image"], message: `第 ${index + 1} 个图标不是一张读得出来的 PNG` })
    if (image.width > BOSS_BAR_LIMITS.icon || image.height > BOSS_BAR_LIMITS.icon) return found.push({ path: ["icons", index, "image"], message: `图标最大 ${BOSS_BAR_LIMITS.icon}×${BOSS_BAR_LIMITS.icon}，第 ${index + 1} 个是 ${image.width}×${image.height}` })
    if (icon.at) inside(["icons", index, "at"], `第 ${index + 1} 个图标`, icon.at.x, icon.at.y, image.width, image.height)
    icon.abilities.forEach((id, place) => icon.abilities.indexOf(id) !== place && found.push({ path: ["icons", index, "abilities", place], message: `第 ${index + 1} 个图标把 ${id} 写了两遍` }))
    return undefined
  })
  // Icons laid out for you have to fit under the bar on a background of one's own.
  if (!bronze && document.icons.some((icon) => !icon.at)) {
    const lowest = Math.max(0, ...document.segments.map((segment) => segment.y + segment.height))
    if (lowest + 4 + BRONZE_LOOK.icon > background.height || rowWidth(document.icons.length) > background.width) found.push({ path: ["icons"], message: `有图标没写位置（at），自动排在血条下面一行放不下（底图 ${background.width}×${background.height}）：给每个图标写 at，或者把底图做高一些` })
  }
  if (document.name_at) inside(["name_at"], "阶段名字的位置", document.name_at.x, document.name_at.y, 1, 1)
  if (document.dots && !bronze) inside(["dots"], "场地小点那一行", document.dots.x, document.dots.y, document.dots.size, document.dots.size)
  return found
}

/** A bar asset as a boss needs it: null when the project has none by that id. */
export type BossBarLookup = (id: string) => { title: string; document: BossBarDocument } | null
export const bossBarLookup =
  (project: { workspace: { assets: readonly { id: string; title: string; document: { kind: string } }[] } }): BossBarLookup =>
  (id) =>
    project.workspace.assets.flatMap((asset) => (asset.id === id && asset.document.kind === "bossbar" ? [{ title: asset.title, document: asset.document as BossBarDocument }] : []))[0] ?? null

/** The asset id a boss's bar looks like, or null for the game's own bar (`look` left out or `"vanilla"`). */
export const bossBarAsset = (boss: { bar: { look?: "vanilla" | { asset: string } | null | undefined } } | null | undefined) => (boss && typeof boss.bar.look === "object" && boss.bar.look ? boss.bar.look.asset : null)

export type BossBarIssue = { refs?: import("@minemods/studio-ai/acceptance").FindingRef[]; rule: "boss_bar_missing" | "boss_bar_stages" | "boss_bar_icon" | "boss_bar_lock_slow"; stops: boolean; text: string; fix: string; detail: string }

/**
 * What is wrong with a boss's own bar against the boss (the reviewer's checks; spec: 自定义血条): the asset exists and is a bar; it has a segment and a name for
 * every stage (phases + 1); every icon names abilities or combos the creature has;
 * a lock still breaking when the change of phase is over (a warning).
 */
export function bossBarIssues(creature: { name: string; abilities?: readonly { id: string }[] | null; combos?: readonly { id: string }[] | null; boss?: { bar: { look?: "vanilla" | { asset: string } | null }; phases: readonly { below: number; seconds: number; abilities?: readonly string[]; add?: readonly string[]; remove?: readonly string[] }[] } | null }, lookup: BossBarLookup): BossBarIssue[] {
  const id = bossBarAsset(creature.boss)
  if (!id || !creature.boss) return []
  const boss = creature.boss
  const found = lookup(id)
  if (!found) return [{ rule: "boss_bar_missing", refs: [assetRef(id)], stops: true, text: `「${creature.name}」的血条（boss.bar.look）指向的血条资产找不到了。`, fix: "给它换一个本工程里的血条资产，或者把 look 写成 \"vanilla\" 用原版血条。", detail: `boss.bar.look.asset: ${id}` }]
  const bar = found.document
  const stages = boss.phases.length + 1
  const choices = [...(creature.abilities ?? []), ...(creature.combos ?? [])].map((choice) => choice.id)
  const segments = bar.segments.length || bar.names.length
  const issues: BossBarIssue[] = []
  if (bar.names.length !== stages || segments !== stages)
    issues.push({ rule: "boss_bar_stages", refs: [assetRef(id, found.title)], stops: true, text: `「${creature.name}」有 ${boss.phases.length} 次变身、${stages} 个阶段，可是血条「${found.title}」是按 ${bar.names.length} 个阶段做的（${segments} 段血条、${bar.names.length} 个名字）。`, fix: `把血条改成 ${stages} 段、${stages} 个阶段名字（第一个是还没变身时的），或者换一个合适的血条。`, detail: `phases + 1: ${stages}; segments: ${segments}; names: ${bar.names.length}` })
  bar.icons.forEach((icon, index) =>
    icon.abilities
      .filter((ability) => !choices.includes(ability))
      .forEach((ability) => issues.push({ rule: "boss_bar_icon", refs: [assetRef(id, found.title)], stops: true, text: `血条「${found.title}」的第 ${index + 1} 个图标绑的 ${ability} 不是「${creature.name}」的招式或连招。`, fix: `把它换成它有的招式或连招（${choices.join("、") || "现在一个都没有"}），或者去掉这个图标。`, detail: `icons[${index}].abilities: ${icon.abilities.join(", ")}; choices: ${choices.join(", ")}` })),
  )
  const frames = bar.lock.frames?.length ?? 4
  boss.phases.forEach((phase, line) => {
    const breaking = (frames - 1) * bar.lock.ticks
    if (breaking > Math.round(phase.seconds * TICKS))
      issues.push({ rule: "boss_bar_lock_slow", refs: [assetRef(id, found.title), phaseRef(line + 1)], stops: false, text: `第 ${line + 1} 次变身只有 ${phase.seconds} 秒，可是血条上的锁要 ${Number((breaking / TICKS).toFixed(2))} 秒才碎完：它打起来了锁还在碎。`, fix: `把锁的帧数减少或者 lock.ticks 改小（${frames - 1} 帧 × ${bar.lock.ticks} tick），或者让变身久一点。`, detail: `lock: ${frames} frames × ${bar.lock.ticks} ticks; phase ${line + 1} seconds: ${phase.seconds}` })
  })
  return issues
}

// ---- for whoever makes one ----

/** What the acceptance standard asks of a bar: nothing it can measure beyond the document's own checks (`bossBarDocumentIssues`) and the boss's (`bossBarIssues`); the rest is looked at in the three pictures. */
export const BOSS_BAR_STANDARD: StandardOutline = {
  kind: "bossbar",
  label: "血条",
  rules: [],
  unmeasured: {
    earns_place: "血条上该有多少东西量不了，由人看三张预览",
    not_mechanical: "底图画得好不好量不了，由人看三张预览",
    reads: "满血、碎锁、残血三个样子一眼看不看得懂量不了，由人看三张预览",
    hierarchy: "血条、锁、图标哪个该最显眼量不了，由人看三张预览",
    sound: "血条是屏幕上的一张图，站不站得住对它不适用",
    fits: "它和用它的 Boss 对不对得上（段数、名字、图标绑的招式）在看那只 Boss 时量，不在这里",
  },
  told: {
    reads: "满血、刚过第一条线正在碎锁、残血三个样子（和游戏里画它的代码按同一份布局、同样的规则画），每个阶段的名字，每个图标绑的招式",
  },
}

/** What an AI making a bar is told (the kind's instructions). */
export const BOSS_BAR_INSTRUCTIONS =
  `血条（bossbar）是一只 Boss 在屏幕上方的那条血条的样子，用来代替原版的血条；它自己不进游戏，要 Boss 在 boss.bar.look 里写 {"asset": 这个血条资产的 UUID}（并把它加进依赖）才用上。` +
  `格式 {kind:"bossbar", background, fill, drain, segments, lock, icons, names, name_at, dots}，全是数据：` +
  ` background：写 "bronze" 用 Studio 自带的朴素青铜牌（不用画任何图，段、锁、图标的位置都会自动排好），或者一张导入的 PNG（data URL，最大 ${BOSS_BAR_LIMITS.width}×${BOSS_BAR_LIMITS.height}，一个像素就是游戏界面上的一个像素）。外部 AI 画不了像素图：没有人提供底图就用 "bronze"。` +
  ` fill：血条满的时候的样子——一张和底图一样大的 PNG（每一段里，剩多少血就画出多少），或者一个颜色 #rrggbb，null 是自带的炭火红。drain：left 是每段从右往左掉（左端留着），right 反过来。` +
  ` names：每个阶段的名字 [{zh, en}]，个数等于这只 Boss 的 phases 数加一（第一个是还没变身时的阶段），最多 ${BOSS_BAR_LIMITS.stages} 个，每个最多 ${BOSS_BAR_LIMITS.name} 个字；打到哪个阶段，血条上就显示那个阶段的名字。name_at：名字写在血条图上的哪个位置（中心点 {x,y}），null 是写在血条上面一行、跟在 Boss 自己的名字后面。` +
  ` segments：每个阶段一段血条在底图上的矩形 [{x, y, width, height, phase}]，phase 是阶段的序号（0 是还没变身时的），个数和 names 一样多，都在底图里面；用 "bronze" 时写空数组。` +
  ` lock：段与段之间的锁 {frames, ticks ${BOSS_BAR_LIMITS.ticks.min}–${BOSS_BAR_LIMITS.ticks.max}, at}——frames 是 ${BOSS_BAR_LIMITS.frames.min}–${BOSS_BAR_LIMITS.frames.max} 张一样大的 PNG（最大 ${BOSS_BAR_LIMITS.lock}×${BOSS_BAR_LIMITS.lock}），第一张是完整的锁，后面是碎开的过程；null 用自带的青铜锁（4 帧）。血量还没掉到那条线时锁是完整的；掉过那条线（变身）的那一刻起，每 ticks 个 tick 换下一帧，放完就消失。碎完的时间（帧数减一乘 ticks）不要比变身的 seconds 长。at 是每把锁左上角的位置，个数是阶段数减一；写空数组时放在相邻两段中间（自己的底图上段不在同一行就必须写 at）。` +
  ` icons：最多 ${BOSS_BAR_LIMITS.icons} 个图标 [{abilities, image, at}]——abilities 写这只 Boss 的一个或几个招式或连招的 id，那一招正在出的时候图标点亮（连招里正在放的那一步的招式也算），别的时候变暗；image 是 PNG（最大 ${BOSS_BAR_LIMITS.icon}×${BOSS_BAR_LIMITS.icon}），null 用自带的青铜圆章（每个一块不同颜色的宝石）；at 是左上角的位置，null 是自动排在血条下面一行。图标绑的招式和连招要是这只 Boss 自己有的。` +
  ` dots：场地物件（例如四座指南车亮了几座）的一排小点 {x, y, gap, size}，x 是这一排的中心（用 "bronze" 时自动放在青铜牌最下面一行，x、y 不起作用）；Boss 的 boss.arena 摆了几座物件就有几个点，起雾以后亮过一座点亮一个（没起雾时是现在亮着的），不需要就写 null。` +
  ` 一个血条可以给几只 Boss 用，但每只 Boss 的阶段数都要和它的 names 个数对得上。Studio 会用同一份布局画出三张预览：满血、刚过第一条线正在碎锁、残血。` +
  ` 例（不画图）：{"kind":"bossbar","background":"bronze","fill":null,"drain":"left","segments":[],"lock":{"frames":null,"ticks":4,"at":[]},"icons":[{"abilities":["slam"],"image":null,"at":null}],"names":[{"zh":"苏醒","en":"Awakened"},{"zh":"狂怒","en":"Enraged"},{"zh":"垂死","en":"Last Stand"}],"name_at":null,"dots":null}。`

export const BOSS_BAR_SUMMARY = `Boss 的自定义血条：底图（自带青铜牌，或导入 PNG，最大 ${BOSS_BAR_LIMITS.width}×${BOSS_BAR_LIMITS.height}）、每个阶段一段血条、段间会碎的锁、出招时点亮的图标、每个阶段的名字；Boss 用 boss.bar.look 引用它。`

/** The sentence a boss's instructions add for `bar.look`. */
export const BOSS_BAR_LOOK_INSTRUCTIONS = ` bar.look（可选）："vanilla"（不写也是）用原版血条；{"asset": 血条资产的 UUID} 用本工程的一个血条（bossbar）资产，生物要依赖那个资产，血条的阶段名字和段数要等于 phases 数加一，图标绑的招式要是它有的。`
