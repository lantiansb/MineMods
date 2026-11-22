import { PROJECTILE_LIMITS, type ProjectilePath } from "./projectile-words"

/**
 * Boss 能力 2: how a thrown thing flies, tick by tick, as one set of formulas the pictures draw it with and the game flies it with. The generated `StudioFlight`
 * (common/projectiles.ts) is these very functions in Java, statement for statement, in `double`; a test runs both on the same numbers and compares the points.
 * Units are blocks and server ticks; a point is [x, y, z] in the world's axes (y up). No Node APIs: the app's window reads it too.
 *
 * - straight: it leaves at `speed` toward the point it aims at, and each tick moves by its velocity, then falls by `gravity` (0: a straight line for ever).
 * - arc: it is lobbed so that, moving `speed` across a tick and falling by `gravity`, it is exactly at the point it aims at after the fewest whole ticks that cover the way.
 * - return: it flies straight to the point it aims at in whole ticks, arriving exactly there, and then flies back to its thrower (`stepBack`).
 * - boomerang: a loop: over `boomerangTicks` ticks it goes out to the point it aims at and back, swinging out to its left on the way out and to its right on the way back.
 * - from the sky: it starts above where it falls and falls: straight with its velocity straight down.
 */

export type Point = [number, number, number]

/** The number each path is written as in the generated Java. */
export const PATH_NUMBERS: Record<ProjectilePath, number> = { straight: 0, arc: 1, boomerang: 2, return: 3 }

const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const length = (a: Point) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])

/** The ticks a way of `distance` blocks takes at `speed` blocks a tick: whole ticks, at least one. */
export const wayTicks = (distance: number, speed: number) => Math.max(1, Math.ceil(distance / speed - 1e-9))

/** The velocity it leaves with (blocks a tick), from `from` toward `aim`, for the paths that move by velocity (straight, arc, return). */
export function launchVelocity(path: ProjectilePath, from: Point, aim: Point, speed: number, gravity: number): Point {
  const way = minus(aim, from)
  if (path === "arc") {
    const flat = Math.sqrt(way[0] * way[0] + way[2] * way[2])
    const ticks = wayTicks(flat, speed)
    return [way[0] / ticks, (way[1] + (gravity * ticks * (ticks - 1)) / 2) / ticks, way[2] / ticks]
  }
  const far = length(way)
  if (far < 1e-9) return [0, -speed, 0]
  if (path === "return") {
    const ticks = wayTicks(far, speed)
    return [way[0] / ticks, way[1] / ticks, way[2] / ticks]
  }
  return [(way[0] / far) * speed, (way[1] / far) * speed, (way[2] / far) * speed]
}

/** The ticks the way out of a return takes (it arrives exactly at the point it aims at on the last). */
export const returnTicks = (from: Point, aim: Point, speed: number) => wayTicks(length(minus(aim, from)), speed)

/** One tick of flight by velocity: where it is after the tick, and its velocity for the next (it moves, then falls by `gravity`). */
export function flyStep(at: Point, velocity: Point, gravity: number): { at: Point; velocity: Point } {
  return { at: [at[0] + velocity[0], at[1] + velocity[1], at[2] + velocity[2]], velocity: [velocity[0], velocity[1] - gravity, velocity[2]] }
}

/** The ticks a whole boomerang loop takes: out to the point it aims at and back, twice the ticks of the way there. */
export const boomerangTicks = (from: Point, aim: Point, speed: number) => 2 * wayTicks(length(minus(aim, from)), speed)

/**
 * Where a boomerang is `tick` ticks after it left (0 to `total`), with its thrower standing still: out along the way to the point it aims at and back (sin of half a turn), and to
 * its left by `PROJECTILE_LIMITS.width` of the level way at most (sin of a whole turn: left going out, right coming back). The game adds how far its thrower has moved since,
 * in proportion to how far the loop has gone, so it comes back to where the thrower is.
 */
export function boomerangAt(from: Point, aim: Point, tick: number, total: number): Point {
  const way = minus(aim, from)
  const flat = Math.sqrt(way[0] * way[0] + way[2] * way[2])
  const u = tick / total
  const out = Math.sin(Math.PI * u)
  const swing = PROJECTILE_LIMITS.width * flat * Math.sin(2 * Math.PI * u)
  // Its own left as it faces along the way: (forward z, 0, -forward x) in the world's axes; straight up or down it swings along x.
  const leftX = flat < 1e-9 ? 1 : way[2] / flat
  const leftZ = flat < 1e-9 ? 0 : -way[0] / flat
  return [from[0] + way[0] * out + leftX * swing, from[1] + way[1] * out, from[2] + way[2] * out + leftZ * swing]
}

/** One tick of the way back: `speed` blocks straight toward `to`, or onto it when it is nearer than that (`home`: it has arrived). */
export function stepBack(at: Point, to: Point, speed: number): { at: Point; home: boolean } {
  const way = minus(to, at)
  const far = length(way)
  if (far <= speed) return { at: [to[0], to[1], to[2]], home: true }
  return { at: [at[0] + (way[0] / far) * speed, at[1] + (way[1] / far) * speed, at[2] + (way[2] / far) * speed], home: false }
}

/** The point the `index`-th of `count` thrown together aims at: the point all aim at, turned about `from` (level) by its share of a fan `spread` degrees wide, evenly from one edge (the first) to the other (the last). */
export function fanAim(from: Point, aim: Point, index: number, count: number, spread: number): Point {
  if (count < 2) return [aim[0], aim[1], aim[2]]
  const angle = ((spread * (index / (count - 1) - 0.5)) * Math.PI) / 180
  const dx = aim[0] - from[0]
  const dz = aim[2] - from[2]
  return [from[0] + dx * Math.cos(angle) - dz * Math.sin(angle), aim[1], from[2] + dx * Math.sin(angle) + dz * Math.cos(angle)]
}

/** The ticks a thing falling from `height` blocks above the ground takes to reach it: straight down at `speed`, faster by `gravity` each tick (at most `PROJECTILE_LIMITS.flight`). */
export function fallTicks(height: number, speed: number, gravity: number, limit: number = PROJECTILE_LIMITS.flight) {
  let y = height
  let velocity = -speed
  for (let tick = 1; tick <= limit; tick++) {
    y += velocity
    velocity -= gravity
    if (y <= 0) return tick
  }
  return limit
}

/**
 * A whole flight over level ground at height `ground` (no one in the way), as the pictures draw it: every point from where it leaves on (one a tick), where it lands (the tick, and
 * the point on the ground between the two ticks around it) or null when it flies its `PROJECTILE_LIMITS.flight` ticks without landing; a boomerang and a return come back to `from`
 * with their thrower standing still (`back` is where the way back starts, in `points`).
 */
export function flightPoints(path: ProjectilePath, from: Point, aim: Point, speed: number, gravity: number, ground: number, lifetime: number = PROJECTILE_LIMITS.flight, homing?: { strength: number; range: number }) {
  if (path === "boomerang") {
    const total = boomerangTicks(from, aim, speed)
    return { points: Array.from({ length: total + 1 }, (_, tick) => boomerangAt(from, aim, tick, total)), land: null, back: total / 2 }
  }
  const points: Point[] = [[from[0], from[1], from[2]]]
  let at: Point = [from[0], from[1], from[2]]
  let velocity = launchVelocity(path, from, aim, speed, gravity)
  if (path === "return") {
    const out = returnTicks(from, aim, speed)
    for (let tick = 0; tick < out; tick++) {
      at = flyStep(at, velocity, 0).at
      points.push(at)
    }
    for (let tick = 0; tick < PROJECTILE_LIMITS.back; tick++) {
      const step = stepBack(at, from, speed)
      points.push((at = step.at))
      if (step.home) break
    }
    return { points, land: null, back: out }
  }
  for (let tick = 1; tick <= lifetime; tick++) {
    if (homing) {
      const offset: Point = [aim[0] + Math.min(tick, 30) * 0.18 - at[0], aim[1] - at[1], aim[2] - at[2]]
      const distance = length(offset)
      if (distance < PROJECTILE_LIMITS.touch) break
      const speedNow = length(velocity)
      if (distance <= homing.range && speedNow > 0) {
        const heading = velocity.map((v, i) => v / speedNow * (1 - homing.strength) + offset[i]! / distance * homing.strength) as Point
        const norm = length(heading)
        velocity = norm > 1e-8 ? heading.map(v => v * speedNow / norm) as Point : offset.map(v => v * speedNow / distance) as Point
      }
    }
    const step = flyStep(at, velocity, gravity)
    if (step.at[1] <= ground && at[1] > ground) {
      const share = (at[1] - ground) / (at[1] - step.at[1])
      const landed: Point = [at[0] + (step.at[0] - at[0]) * share, ground, at[2] + (step.at[2] - at[2]) * share]
      points.push(landed)
      return { points, land: { tick, at: landed }, back: null }
    }
    at = step.at
    velocity = step.velocity
    points.push(at)
  }
  return { points, land: null, back: null }
}

// ---- the places a volley from the sky falls on: item 3's (creature-abilities.ts `aroundOffsets`, `placeSeed`), here so the generated StudioFlight and its test share one copy ----

/** mulberry32 on 32-bit integers, as `placeRandom` (creature-abilities.ts) and the creature's `abilityRandom`. */
export function flightRandom(seed: number) {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

/** `count` places within `spread` blocks round a point, as [forward, left] pairs in the thrower's terms, drawn by the cast's `seed` mixed with which hit it is (`slot`): item 3's scatter, number for number. */
export function scatter(seed: number, slot: number, count: number, spread: number): number[] {
  const roll = flightRandom((seed ^ Math.imul(slot + 1, 0x9e3779b9 | 0)) | 0)
  return Array.from({ length: count }, () => {
    const angle = roll() * 2 * Math.PI
    const far = Math.sqrt(roll()) * spread
    return [far * Math.cos(angle), far * Math.sin(angle)]
  }).flat()
}
