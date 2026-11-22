import { DEFAULT_STEP, FIGHT_RANGE, dashPlan, dashWords, forceDrift, forceWords, hitForce, type HitForce } from "./ability-dash"
import type { Ability, AbilityShape } from "./entity-runtime"
import { plainShape } from "./arena"
import { leapPlan, leapWords } from "./ability-tactics"

/**
 * Boss 能力 4 between the document and what people read and see of it: the dash drawn as an arrow on the ground as long as it goes, with the band its hit
 * sweeps from where it starts to where it ends, and a force drawn as arrows over where its hit lands, the way it carries whoever it struck; what is said of
 * them under the pictures; and what a reviewer is told (`dashForceReview`). It reads nothing of `creature-abilities.ts`: that one hands it the faces it
 * already has of a hit and the places a hit is counted from, so every picture of a hit is still drawn by the one geometry. No Node APIs.
 */

type Vec = [number, number, number]
type Place = { forward: number; up: number; left: number }
const num = (value: number, digits = 2) => Number(value.toFixed(digits))
/** Model pixels in a block; a place in the creature's own terms as a point of the viewport's space (the same as `abilityPlace`). */
const BLOCK = 16
const at = (forward: number, up: number, left: number): Vec => [-left * BLOCK, up * BLOCK, -forward * BLOCK]
/** Arrows lie this far above the ground, so the ground does not hide them. */
const LIFT = 0.05
/** The longest a force arrow is drawn, blocks: one that carries further is still drawn this long, and the words say how far. */
const LONGEST = 4

/**
 * A flat arrow on the level `up`, from (`forward`, `left`) going `length` blocks in the direction (`toward`, `aside`) (a unit vector in the creature's own terms):
 * a shaft `width` wide and a head twice as wide, its last third.
 */
function arrow(forward: number, left: number, toward: number, aside: number, length: number, width: number, up = LIFT): Vec[][] {
  const head = Math.min(length / 3, width * 2.5)
  const point = (along: number, across: number) => at(forward + toward * along - aside * across, up, left + aside * along + toward * across)
  const neck = length - head
  return [
    [point(0, -width / 2), point(neck, -width / 2), point(neck, width / 2), point(0, width / 2)],
    [point(neck, -width), point(length, 0), point(neck, width)],
  ]
}

/** What a shape covers in the creature's own terms: ahead from and to, aside from and to, and up from and to (blocks). */
function shapeSpan(given: AbilityShape) {
  const shape = plainShape(given)
  if (shape.type === "box") return { ahead: [shape.forward - shape.depth / 2, shape.forward + shape.depth / 2], aside: [shape.left - shape.width / 2, shape.left + shape.width / 2], up: [shape.up - shape.height / 2, shape.up + shape.height / 2] }
  if (shape.type === "sphere") return { ahead: [shape.forward - shape.radius, shape.forward + shape.radius], aside: [shape.left - shape.radius, shape.left + shape.radius], up: [shape.up - shape.radius, shape.up + shape.radius] }
  if (shape.type === "arc") {
    const half = (shape.angle * Math.PI) / 360
    const wide = half >= Math.PI / 2 ? shape.reach : shape.reach * Math.sin(half)
    return { ahead: [half >= Math.PI / 2 ? -shape.reach * Math.min(1, -Math.cos(half)) : 0, shape.reach], aside: [-wide, wide], up: [shape.low, shape.high] }
  }
  const wide = shape.type === "line" ? shape.radius : shape.length * Math.tan((shape.angle * Math.PI) / 360)
  return { ahead: [0, shape.length], aside: [-wide, wide], up: [shape.up - wide, shape.up + wide] }
}

/** A box between two corners in the creature's own terms, as its six faces. */
function boxFaces(ahead: number[], aside: number[], up: number[]): Vec[][] {
  const corner = (index: number) => at(index & 1 ? ahead[1]! : ahead[0]!, index & 2 ? up[1]! : up[0]!, index & 4 ? aside[1]! : aside[0]!)
  return [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]].map((face) => face.map(corner))
}

/** Where a hit's own middle lies from where it is counted (blocks ahead, to the left), and how far round it its shape reaches on the ground: what the force arrows are laid round. */
function shapeMiddle(given: AbilityShape) {
  const shape = plainShape(given)
  if (shape.type === "box") return { forward: shape.forward, left: shape.left, reach: Math.max(shape.width, shape.depth) / 2 }
  if (shape.type === "sphere") return { forward: shape.forward, left: shape.left, reach: shape.radius }
  if (shape.type === "arc") return { forward: shape.angle >= 360 ? 0 : shape.reach / 2, left: 0, reach: shape.angle >= 360 ? shape.reach : shape.reach / 2 }
  return { forward: shape.length / 2, left: 0, reach: shape.length / 2 }
}

/**
 * The arrows of a force over where its hit lands, at every place it is counted from (`places`, as `hitPlaces` gives them; the creature's feet for a hit round it):
 * a push points out from the middle all round, a pull in toward it, a side push across it to the creature's own left or right. Each is drawn as long as it carries
 * someone, up to `LONGEST` blocks.
 */
function forceFaces(shape: AbilityShape, force: HitForce, places: readonly Place[]): Vec[][] {
  const middle = shapeMiddle(shape)
  if (force.kind !== "side" && (force.toward === "origin" || (shape.type !== "box" && shape.type !== "sphere"))) { middle.forward = 0; middle.left = 0 }
  const long = Math.min(LONGEST, Math.max(1, forceDrift(force)))
  const width = Math.min(0.5, long / 6)
  return places.flatMap((place) => {
    const forward = place.forward + middle.forward
    const left = place.left + middle.left
    if (force.kind === "side") {
      const aside = force.strength < 0 ? -1 : 1
      const start = left - (aside * long) / 2
      return [-1, 0, 1].flatMap((row) => arrow(forward + (row * Math.max(1, middle.reach)) / 2, start, 0, aside, long, width))
    }
    const ring = Math.max(0.5, middle.reach * 0.6)
    return Array.from({ length: 8 }, (_, index) => (index * Math.PI) / 4).flatMap((angle) => {
      const toward = Math.cos(angle)
      const aside = Math.sin(angle)
      return force.kind === "push"
        ? arrow(forward + toward * ring, left + aside * ring, toward, aside, long, width)
        : arrow(forward + toward * (ring + long), left + aside * (ring + long), -toward, -aside, Math.min(long, ring + long - 0.25), width)
    })
  })
}

/**
 * The faces a hit of an ability adds to its picture (viewport space, model pixels): for the hit a dash carries, the band its shape sweeps from where the dash
 * starts to where it ends and the shape again at the end; for the first hit of an ability whose dash carries none, nothing but the arrow; with that the arrow of
 * the dash on the ground, as long as it goes. For a hit that leaves a force, the arrows of the force. Nothing for anything else: an old picture is what it was.
 * `own`: the faces of the hit's shape where it is counted from (`shapeFaces`); `places`: where it is counted from (`hitPlaces`).
 */
export function dashForceFaces(ability: Ability, index: number, own: readonly Vec[][], places: readonly Place[]): Vec[][] {
  return [...dashFaces(ability, index, own), ...hitForceFaces(ability, index, places)]
}

/** r29c: the dash's part of `dashForceFaces`, laid out from where the dash starts (it does not move with the creature). */
export function dashFaces(ability: Ability, index: number, own: readonly Vec[][]): Vec[][] {
  const hit = ability.hits[index]
  const plan = dashPlan(ability)
  if (!hit || !plan || (plan.dash.hit ?? 0) !== index) return []
  const far = plan.reach
  const band = plan.dash.hit === index && hit.type === "area"
    ? ((span) => [...boxFaces([span.ahead[0]!, span.ahead[1]! + far], span.aside, span.up), ...own.map((face) => face.map((point): Vec => [point[0], point[1], point[2] - far * BLOCK]))])(shapeSpan(hit.shape))
    : []
  return [...band, ...arrow(0, 0, 1, 0, far, 0.5)]
}

/** r29c: the force's part of `dashForceFaces`: arrows over where the hit lands, which go where the creature is when it is counted. */
export function hitForceFaces(ability: Ability, index: number, places: readonly Place[]): Vec[][] {
  const hit = ability.hits[index]
  const force = hit ? hitForce(hit) : null
  return force && hit?.type === "area" ? forceFaces(hit.shape, force, places) : []
}

/** What the label of a hit's picture adds for a dash or a force: 「（冲刺 20 格）」「（推 3 秒）」; "" for anything else. */
export function dashForceLabel(ability: Ability, index: number) {
  const plan = dashPlan(ability)
  const hit = ability.hits[index]
  const force = hit ? hitForce(hit) : null
  return [
    ...(plan && (plan.dash.hit ?? 0) === index ? [`（冲刺 ${num(plan.reach)} 格）`] : []),
    ...(force ? [`（${force.kind === "pull" ? "拉" : "推"} ${num(force.seconds)} 秒）`] : []),
  ].join("")
}

/** What is said under a hit's picture of a dash and a force, in sentences. */
export function dashForceLines(ability: Ability, index: number) {
  const plan = dashPlan(ability)
  const hit = ability.hits[index]
  const force = hit ? hitForce(hit) : null
  return [
    ...(plan && (plan.dash.hit ?? 0) === index
      ? [
          `${dashWords(ability)}。图上地上的箭头就是它冲的方向和长度（${num(plan.reach)} 格）${plan.dash.hit === index ? "；透明的长条是这一下沿路扫过的范围，起点和终点各画一次判定范围" : ""}。方向按蓄力结束时它面对的方向，图上画成正前方。`,
          ...(plan.dash.hit === index && hit && hit.at > plan.dash.from + 1e-9 ? [`这一下从第 ${num(hit.at)} 秒才开始沿路判定，冲刺前面 ${num(hit.at - plan.dash.from)} 秒扫过的地方不打人。`] : []),
        ]
      : []),
    ...(force ? [`打中的人${forceWords(force)}；图上范围上的箭头是推的方向${force.kind === "side" ? "（按它出手时的朝向）" : ""}。`] : []),
  ]
}

export type DashForceIssue = { ability: string; rule: "ability_move"; stops: false; text: string; fix: string; detail: string }

/** How far ahead of where it stands a shape reaches, in blocks (as `shapeFar`). */
export const shapeFar = (given: AbilityShape) => ((shape: ReturnType<typeof plainShape>) => shape.type === "arc" ? shape.reach : shape.type === "line" || shape.type === "cone" ? shape.length : shape.type === "box" ? shape.forward + shape.depth / 2 : shape.forward + shape.radius)(plainShape(given))

/**
 * What a reviewer is told about a creature's dashes and forces, never a stop (the ability plays as written; it may only play out otherwise than meant):
 * - a dash longer than the boss's leash, its home or its lair's platform: it carries itself out of where it is kept and is brought back, or off the platform;
 * - a dash likely to run into the ground: a body that steps up less than a block stops at the first block-high rise of the land (or, not stopping at walls, grinds
 *   against it until the dash's time is out);
 * - a dash whose end with its hit's reach still falls short of where the ability may start;
 * - a push or a side push that carries a player standing at the edge of where the hit lands out of the range it keeps them in its fight (`FIGHT_RANGE`).
 */
export function dashForceReview(creature: {
  name: string
  abilities?: readonly Ability[] | null
  boss?: { leash: { distance: number } | null; lair?: { radius: number } | null } | null
  habits?: { home?: { radius: number } | null } | null
  hitbox?: { core?: { step?: number | null } } | null
}): DashForceIssue[] {
  const abilities = creature.abilities ?? []
  const fight = creature.boss ? FIGHT_RANGE.boss : Math.max(FIGHT_RANGE.usual, ...abilities.map((ability) => ability.start.max_distance))
  return abilities.flatMap((ability): DashForceIssue[] => {
    const said = (text: string, fix: string, detail: string): DashForceIssue => ({ ability: ability.id, rule: "ability_move", stops: false, text: `「${creature.name}」的招式「${ability.name}」${text}`, fix, detail: `ability ${ability.id}: ${detail}` })
    const plan = dashPlan(ability)
    const found: DashForceIssue[] = []
    if (plan) {
      const far = plan.reach
      const leash = creature.boss?.leash?.distance
      if (leash !== undefined && far > leash) found.push(said(`一次冲刺 ${num(far)} 格，比它的拴绳（leash.distance，${num(leash)} 格）还远：在家附近起冲也会冲出范围，没人在旁边时它会被送回原处。`, `把冲刺的 distance 改到 ${num(leash)} 格以内，或者把 leash.distance 放大。`, `dash ${num(far)} blocks; leash ${leash}`))
      const home = creature.habits?.home?.radius
      if (home !== undefined && far > home) found.push(said(`一次冲刺 ${num(far)} 格，比它的家（home.radius，${num(home)} 格）还大：冲出去以后它会再走回家。`, `把 distance 改到 ${num(home)} 格以内，或者把 home.radius 放大。`, `dash ${num(far)} blocks; home radius ${home}`))
      const lair = creature.boss?.lair?.radius
      if (lair !== undefined && far > lair) found.push(said(`一次冲刺 ${num(far)} 格，比它的巢的平台半径（lair.radius，${num(lair)} 格）还长：从平台中间往外冲，会冲出平台、冲进外面的地形里。`, `把冲刺的 distance 改到 ${num(lair)} 格以内，或者把巢的平台做大。`, `dash ${num(far)} blocks; lair radius ${lair}`))
      const step = creature.hitbox?.core?.step ?? DEFAULT_STEP
      if (step < 1 && far >= 6)
        found.push(said(`冲刺 ${num(far)} 格，可是它只跨得上 ${num(step)} 格高的坎（碰撞箱的 step${creature.hitbox?.core?.step == null ? "，没写就是游戏默认的 0.6" : ""}）：平地以外，一格高的土坡、台阶就会把冲刺挡住${plan.dash.stop_at_wall ? "，冲刺在那里停下" : "，它会顶着坎一直推到冲刺的时间结束"}，实际冲出去的常常比 ${num(far)} 格短。`, "给碰撞箱写 core.step（1 到 1.5 能冲上一格高的坎），或者把场地放在平地上（巢的平台），或者缩短冲刺。", `dash ${num(far)} blocks; step ${step}`))
      const breaksAlongDash = ability.events.some((event) => event.type === "break" && event.where === "self" && event.forward >= 0 && event.at >= plan.dash.from && event.at <= plan.dash.to)
      if (!plan.dash.stop_at_wall && !breaksAlongDash) found.push(said(`的冲刺写了撞墙不停（stop_at_wall: false）：冲到墙或坡下以后它会贴着墙一直往前顶，直到第 ${num(plan.dash.to)} 秒，看起来像卡住了。`, "可把冲刺设为「撞墙就停」（stop_at_wall: true）。", "stop_at_wall false"))
      const carried = plan.dash.hit === null ? null : ability.hits[plan.dash.hit]
      const reach = far + (carried?.type === "area" ? shapeFar(carried.shape) : 0)
      if (carried && ability.start.min_distance > reach + 0.3)
        found.push(said(`要目标在 ${num(ability.start.min_distance)} 格以外才用，可是冲到头（${num(far)} 格）再加上沿路那一下的范围，最远也只打到 ${num(reach)} 格：用出来打不中。`, "把冲刺的 distance 加长，或者把出招的最近距离（start.min_distance）改近。", `start.min_distance ${ability.start.min_distance}; dash and hit reach ${num(reach)}`))
    }
    ability.hits.forEach((hit, index) => {
      const force = hitForce(hit)
      if (!force || hit.type !== "area" || force.kind === "pull") return
      // Where a player struck at the far edge of what the hit covers ends up: that edge (a hit put down at or round the one it fights lands as far off as they may stand when it starts,
      // a pattern at its furthest place; the hit a dash carries, at the dash's end), and what the force carries them.
      const placed = hit.place === undefined || hit.place === "self" || hit.place === "center" || typeof hit.place === "object" && "fixture" in hit.place ? 0 : hit.place === "target" ? ability.start.max_distance : hit.place.type === "around_target" ? ability.start.max_distance + hit.place.spread : Math.max(...hit.place.points.map((point) => Math.hypot(point.forward, point.left)))
      const edge = placed + (placed ? shapeMiddle(hit.shape).reach : shapeFar(hit.shape)) + (plan && plan.dash.hit === index ? plan.reach : 0)
      const end = force.kind === "push" ? edge + forceDrift(force) : Math.hypot(edge, forceDrift(force))
      if (end <= fight) return
      found.push(said(`第 ${index + 1} 次出手${forceWords(force)}：站在范围边上（离它约 ${num(edge)} 格）的玩家按目标速度估算可到约 ${num(end)} 格外，超出它${creature.boss ? `算作在战斗里的范围（${fight} 格），没人在范围里一阵子它就会脱战回血` : `追人的范围（${num(fight)} 格），它会丢掉目标`}。`, `把 force 的 strength 或 seconds 改小，让 strength 乘 seconds 加上范围不超过 ${num(fight)} 格。`, `force ${force.kind} ${force.strength} b/s for ${force.seconds} s from ${num(edge)} blocks: ends ${num(end)}; fight range ${fight}`))
    })
    return found
  })
}

/**
 * 第 3 步: a leap in a hit's picture (`leapPlan`, ability-tactics.ts). For a hit counted round the creature at the moment it lands or later: an arrow on the ground as long as the leap
 * goes in the picture (to the one it fights where the pictures put them, the middle of its window, short of them by `short` and no further than `max_distance`), and the hit's shape
 * again at the end of it, where it comes down. Nothing for any other hit.
 */
export function leapFaces(ability: Ability, index: number, own: readonly Vec[][]): Vec[][] {
  const plan = leapPlan(ability)
  const hit = ability.hits[index]
  if (!plan || !hit || hit.type !== "area" || (hit.place !== undefined && hit.place !== "self") || hit.at < plan.leap.land - 1e-9) return []
  const far = leapReach(ability)
  return [...arrow(0, 0, 1, 0, far, 0.5), ...own.map((face) => face.map((point): Vec => [point[0], point[1], point[2] - far * BLOCK]))]
}

/** How far a leap goes in the pictures: to the middle of its ability's window, `short` of it, no further than `max_distance`. */
export function leapReach(ability: Ability) {
  const plan = leapPlan(ability)
  if (!plan) return 0
  return Math.max(0, Math.min(plan.leap.max_distance, (ability.start.min_distance + ability.start.max_distance) / 2 - (plan.leap.short ?? 0)))
}

/** What is said under a hit's picture of the leap it lands with. */
export function leapLines(ability: Ability, index: number) {
  const plan = leapPlan(ability)
  const hit = ability.hits[index]
  if (!plan || !hit || hit.type !== "area" || hit.at < plan.leap.land - 1e-9) return []
  return [`${leapWords(ability)}。图上地上的箭头是它跳过去的方向和距离（目标站在出招距离的中间时，${num(leapReach(ability))} 格），这一下的范围画在箭头尽头，就是落地砸到的地方${Math.abs(hit.at - plan.leap.land) > 1e-9 ? `（这一下在落地后 ${num(hit.at - plan.leap.land)} 秒）` : ""}。`]
}
