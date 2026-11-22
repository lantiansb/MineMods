import { TICKS } from "./ability-words"
import { ARENA_LIMITS, abilityLeave, arenaHits, arenaPlan, returnPlaceWords, type Arena } from "./arena"
import { abilityPlan, abilityTick, warnPlan } from "./creature-abilities"
import type { Ability } from "./entity-runtime"
import { decodeRgbaPng } from "./png-decode"
import { encodePng } from "./png"
import { PROJECTILE_LIMITS } from "./projectile-words"
import { skyPlaces } from "./ability-projectile"

/**
 * Boss 能力 12 and 13 as pictures a reviewer reads (the app's look draws them, `studio/src/main/look-job.ts`), from the same plan the generated Java runs on (`arenaPlan`):
 * - the arena from above: the fight's range round the arena's middle, home, the way the arena faces, every fixture and the ground it clears;
 * - 涿鹿 from above: the whole arena struck, its safe places cut out of it (round every fixture, all taken as lit; or round its points), where its comet falls (a star where it bursts),
 *   where it comes back; with a strip of its time under it (when it is away, when each warning shows, when each hit lands);
 * - 「雾里看它」: the model's texture as the fog leaves it at a distance (`foggedTexture`): what does not glow fades to the fog's grey, what glows stays.
 * North in a picture is the arena's ahead (the way the boss faced when its fixtures were put down), its own left is the picture's left.
 */

type Rgb = readonly [number, number, number]
const COLOURS = {
  ground: [36, 44, 38],
  range: [56, 70, 58],
  grid: [48, 60, 50],
  rim: [196, 206, 186],
  clear: [235, 240, 255],
  fixture: [226, 170, 70],
  home: [235, 70, 70],
  middle: [120, 200, 255],
  arrow: [245, 245, 245],
  struck: [200, 50, 45],
  safe: [70, 200, 110],
  comet: [255, 150, 40],
  back: [90, 150, 255],
  band: [28, 30, 34],
  away: [96, 100, 112],
  warn: [230, 200, 60],
} as const satisfies Record<string, Rgb>
/** The fog's grey in a picture: the grey the game's fog turns to under a plain day sky (`StudioArenaFogMixin`). */
export const FOG_GREY: Rgb = [140, 144, 152]

/** A canvas of RGBA pixels with what the pictures need: a dot blended at an alpha, a disc, a ring, a line, a box. */
function canvas(width: number, height: number) {
  const pixels = new Uint8Array(width * height * 4)
  const dot = (x: number, y: number, colour: Rgb, alpha = 1) => {
    const px = Math.round(x)
    const py = Math.round(y)
    if (px < 0 || py < 0 || px >= width || py >= height) return
    const at = (py * width + px) * 4
    for (let channel = 0; channel < 3; channel++) pixels[at + channel] = Math.round(pixels[at + channel]! * (1 - alpha) + colour[channel]! * alpha)
    pixels[at + 3] = 255
  }
  const fill = (colour: Rgb) => {
    for (let index = 0; index < pixels.length; index += 4) pixels.set([colour[0], colour[1], colour[2], 255], index)
  }
  const disc = (cx: number, cy: number, radius: number, colour: Rgb, alpha = 1, keep: (x: number, y: number) => boolean = () => true) => {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++)
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius && keep(x, y)) dot(x, y, colour, alpha)
  }
  const ring = (cx: number, cy: number, radius: number, colour: Rgb, thick = 2) => {
    for (let y = Math.floor(cy - radius - thick); y <= Math.ceil(cy + radius + thick); y++)
      for (let x = Math.floor(cx - radius - thick); x <= Math.ceil(cx + radius + thick); x++) {
        const far = Math.hypot(x - cx, y - cy)
        if (far <= radius && far > radius - thick) dot(x, y, colour)
      }
  }
  const line = (x0: number, y0: number, x1: number, y1: number, colour: Rgb, thick = 1) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let step = 0; step <= steps; step++) for (let dx = 0; dx < thick; dx++) for (let dy = 0; dy < thick; dy++) dot(x0 + ((x1 - x0) * step) / steps + dx, y0 + ((y1 - y0) * step) / steps + dy, colour)
  }
  const box = (x: number, y: number, w: number, h: number, colour: Rgb, alpha = 1) => {
    for (let py = Math.round(y); py < Math.round(y + h); py++) for (let px = Math.round(x); px < Math.round(x + w); px++) dot(px, py, colour, alpha)
  }
  return { pixels, dot, fill, disc, ring, line, box, png: () => encodePng(pixels, width, height) }
}

const SIDE = 480
/** Blocks round the arena's middle a map shows: the fight's range and a little more. */
const SHOWN = ARENA_LIMITS.radius + 4
const SCALE = SIDE / (SHOWN * 2)

/** Where a place of the arena's frame (forward, left) is on a map: ahead is up, its left is left, the arena's middle is the picture's. */
const onMap = (forward: number, left: number, middle: { forward: number; left: number }) => [SIDE / 2 - (left - middle.left) * SCALE, SIDE / 2 - (forward - middle.forward) * SCALE] as const

/** The ground, the fight's range round the middle, a grid every 8 blocks, home (a red cross) and the way the arena faces (an arrow from home). */
function base(draw: ReturnType<typeof canvas>, middle: { forward: number; left: number }) {
  draw.fill(COLOURS.ground)
  const [mx, my] = onMap(middle.forward, middle.left, middle)
  draw.disc(mx, my, ARENA_LIMITS.radius * SCALE, COLOURS.range)
  for (let block = -SHOWN; block <= SHOWN; block += 8) {
    const [gx] = onMap(0, block, { forward: 0, left: 0 })
    draw.line(gx, 0, gx, SIDE - 1, COLOURS.grid)
    draw.line(0, gx, SIDE - 1, gx, COLOURS.grid)
  }
  draw.ring(mx, my, ARENA_LIMITS.radius * SCALE, COLOURS.rim)
  const [hx, hy] = onMap(0, 0, middle)
  draw.line(hx - 6, hy - 6, hx + 6, hy + 6, COLOURS.home, 2)
  draw.line(hx - 6, hy + 6, hx + 6, hy - 6, COLOURS.home, 2)
  draw.line(hx, hy, hx, hy - 4 * SCALE, COLOURS.arrow, 2)
  draw.line(hx, hy - 4 * SCALE, hx - 5, hy - 4 * SCALE + 6, COLOURS.arrow, 2)
  draw.line(hx, hy - 4 * SCALE, hx + 5, hy - 4 * SCALE + 6, COLOURS.arrow, 2)
  if (Math.hypot(middle.forward, middle.left) > 0.5) draw.ring(mx, my, 5, COLOURS.middle, 2)
}

/**
 * The arena from above: the fight's range (the rim), home (red cross) and the arrow of ahead, every fixture (a gold square as wide as the fixture stands) and the ground it clears
 * when lit (a pale disc with a white rim). `width`: how wide each fixture's box is, by its asset id, where known.
 */
export function arenaMapPicture(arena: Pick<Arena, "fixtures">, width: (asset: string) => number = () => 1) {
  const plan = arenaPlan(arena)
  const draw = canvas(SIDE, SIDE)
  base(draw, plan.center)
  for (const fixture of plan.fixtures) {
    const [x, y] = onMap(fixture.forward, fixture.left, plan.center)
    draw.disc(x, y, fixture.clear.radius * SCALE, COLOURS.clear, 0.22)
    draw.ring(x, y, fixture.clear.radius * SCALE, COLOURS.clear, 2)
  }
  for (const fixture of plan.fixtures) {
    const [x, y] = onMap(fixture.forward, fixture.left, plan.center)
    const side = Math.max(6, width(fixture.asset) * SCALE)
    draw.box(x - side / 2, y - side / 2, side, side, COLOURS.fixture)
  }
  return { png: draw.png(), blocks: SHOWN * 2, plan }
}

/**
 * One ability that leaves the field or strikes the whole arena, from above, with a strip of its time: the whole arena struck in red but its safe places (green: round every fixture,
 * all taken as lit, or round its points), where each thing from the sky falls (orange, with the ground it strikes), where it comes back (a blue triangle); under it its time from 0 to
 * its end, grey while it is away, yellow while a warning shows, a red mark where a hit lands, orange while a comet falls. Null for an ability with neither.
 */
export function zhuoluPicture(arena: Pick<Arena, "fixtures">, ability: Ability) {
  const leave = abilityLeave(ability)
  const struck = arenaHits(ability)
  if (!leave && !struck.length) return null
  const plan = arenaPlan(arena)
  const strip = 72
  const draw = canvas(SIDE, SIDE + strip)
  base(draw, plan.center)
  const [mx, my] = onMap(plan.center.forward, plan.center.left, plan.center)
  const safeAt = struck.flatMap(({ hit }) => {
    const safe = hit.safe
    if (!safe) return []
    const places = safe.around === "lit_fixtures" ? plan.fixtures.map((fixture) => ({ forward: fixture.forward, left: fixture.left })) : safe.around.points
    return places.map((place) => ({ ...place, radius: safe.radius }))
  })
  if (struck.length) {
    const inSafe = (x: number, y: number) => safeAt.some((place) => ((point) => Math.hypot(x - point[0], y - point[1]) <= place.radius * SCALE)(onMap(place.forward, place.left, plan.center)))
    draw.disc(mx, my, ARENA_LIMITS.radius * SCALE, COLOURS.struck, 0.55, (x, y) => !inSafe(x, y))
    for (const place of safeAt) {
      const [x, y] = onMap(place.forward, place.left, plan.center)
      draw.disc(x, y, place.radius * SCALE, COLOURS.safe, 0.6)
      draw.ring(x, y, place.radius * SCALE, COLOURS.safe, 2)
    }
  }
  for (const fixture of plan.fixtures) {
    const [x, y] = onMap(fixture.forward, fixture.left, plan.center)
    draw.box(x - 4, y - 4, 8, 8, COLOURS.fixture)
  }
  // What falls from the sky: on the arena's middle (where the creature is drawn standing for any other place, as every picture of a hit does).
  const falls = ability.hits.flatMap((hit, index) => (hit.type === "projectile" && "sky" in hit.from ? skyPlaces(hit.from.sky.over, index, 6, PROJECTILE_LIMITS.seed).map((place) => ({ place, radius: hit.radius, size: hit.size ?? 1, burst: Boolean(hit.impact) })) : []))
  for (const fall of falls) {
    const [x, y] = onMap(fall.place.forward + plan.center.forward, fall.place.left + plan.center.left, plan.center)
    if (fall.radius > 0) draw.ring(x, y, fall.radius * SCALE, COLOURS.comet, 2)
    const size = 6 + 2 * fall.size
    draw.line(x - size, y, x + size, y, COLOURS.comet, 3)
    draw.line(x, y - size, x, y + size, COLOURS.comet, 3)
    // 落地炸开 (`impact`): a star, the cross with its diagonals.
    if (fall.burst) {
      const slant = size * 0.7
      draw.line(x - slant, y - slant, x + slant, y + slant, COLOURS.comet, 2)
      draw.line(x - slant, y + slant, x + slant, y - slant, COLOURS.comet, 2)
    }
  }
  if (leave) {
    const offset = typeof leave.back.place === "object" ? leave.back.place : null
    const back = leave.back.place === "home" ? { forward: 0, left: 0 } : leave.back.place === "center" ? plan.center : { forward: plan.center.forward + 6 + (offset ? (offset.forward[0] + offset.forward[1]) / 2 : 0), left: plan.center.left + (offset ? (offset.left[0] + offset.left[1]) / 2 : 0) }
    if (offset) {
      const target = { forward: plan.center.forward + 6, left: plan.center.left }
      const [tx, ty] = onMap(target.forward, target.left, plan.center)
      draw.ring(tx, ty, 3, COLOURS.arrow, 1)
      draw.line(tx, ty, tx, ty - 6, COLOURS.arrow, 1)
      const [x1, y1] = onMap(target.forward + offset.forward[0], target.left + offset.left[0], plan.center)
      const [x2, y2] = onMap(target.forward + offset.forward[1], target.left + offset.left[1], plan.center)
      draw.line(x1, y1, x2, y1, COLOURS.back, 1)
      draw.line(x2, y1, x2, y2, COLOURS.back, 1)
      draw.line(x2, y2, x1, y2, COLOURS.back, 1)
      draw.line(x1, y2, x1, y1, COLOURS.back, 1)
    }
    const [x, y] = onMap(back.forward, back.left, plan.center)
    for (let row = 0; row < 12; row++) draw.line(x - row / 1.5, y - 8 + row, x + row / 1.5, y - 8 + row, COLOURS.back)
  }
  // The strip of its time.
  const top = SIDE + 8
  const length = Math.max(1, abilityTick(ability.length))
  const x = (tick: number) => 8 + ((SIDE - 16) * Math.min(tick, length)) / length
  draw.box(0, SIDE, SIDE, strip, COLOURS.band)
  if (leave) draw.box(x(abilityTick(leave.at)), top, x(abilityTick(leave.back.at)) - x(abilityTick(leave.at)), 18, COLOURS.away)
  const timed = abilityPlan(ability)
  warnPlan(ability).forEach((warn) => warn && draw.box(x(warn.start), top + 22, x(warn.start + warn.ticks) - x(warn.start), 12, COLOURS.warn))
  ability.hits.forEach((hit, index) => {
    if (hit.type !== "projectile" || !("sky" in hit.from)) return
    const thrown = hit.warn ? Math.max(0, timed.hits[index]!.tick - abilityTick(hit.warn.seconds)) : timed.hits[index]!.tick
    draw.box(x(thrown), top + 22, Math.max(2, x(timed.hits[index]!.tick) - x(thrown)), 12, COLOURS.comet, hit.warn ? 0.6 : 1)
  })
  timed.hits.forEach((hit) => draw.box(x(hit.tick) - 1, top + 38, 3, 18, COLOURS.struck))
  for (let second = 0; second * TICKS <= length; second++) draw.line(x(second * TICKS), top + 58, x(second * TICKS), top + 62, COLOURS.rim)
  return {
    png: draw.png(),
    seconds: Number((length / TICKS).toFixed(2)),
    away: leave ? { from: leave.at, to: leave.back.at, back: returnPlaceWords(leave.back.place) } : null,
    safe: safeAt.length,
  }
}

/**
 * A model's texture as it is seen through the fog at `amount` (0 clear, 1 as thick as it gets): what does not glow is mixed into the fog's grey, what glows (its glow mask) is drawn
 * on top at full brightness as the game draws it, with the fog lifted. The texture and the mask are the build's own pictures (`fitModelAtlas`).
 */
export function foggedTexture(texture: Uint8Array, mask: Uint8Array | null, amount: number) {
  const base = decodeRgbaPng(texture)
  const glow = mask ? decodeRgbaPng(mask) : null
  const usable = glow && glow.width === base.width && glow.height === base.height ? glow : null
  const pixels = new Uint8Array(base.pixels)
  const share = Math.min(1, Math.max(0, amount))
  for (let index = 0; index < pixels.length; index += 4) {
    const lit = usable ? usable.pixels[index + 3]! / 255 : 0
    for (let channel = 0; channel < 3; channel++) {
      const fogged = pixels[index + channel]! * (1 - share) + FOG_GREY[channel]! * share
      pixels[index + channel] = Math.min(255, Math.round(fogged * (1 - lit) + (usable ? Math.min(255, usable.pixels[index + channel]! * 1.15) : 0) * lit))
    }
  }
  return encodePng(pixels, base.width, base.height)
}

/** How far into the fog something `distance` blocks off is, as the fog mixin draws it: none within a fifth of the visibility, all of it at the visibility and beyond. */
export const fogShare = (distance: number, visibility: number, end = visibility) => Math.min(1, Math.max(0, (distance - visibility * 0.2) / (end - visibility * 0.2)))
