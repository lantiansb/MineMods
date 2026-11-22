import { TICKS } from "./ability-words"
import { dashPlan } from "./ability-dash"
import { stagePlan } from "./ability-tactics"
import { shapeFar } from "./ability-dash-words"
import { staggerList } from "./combat"
import { impactSlots, type ImpactFx } from "./impact-fx"
import { AIM_TARGET, type Place } from "./creature-abilities"
import { assumedTarget } from "./effect-abilities"
import type { Travel } from "./ability-travel"
import type { Ability } from "./entity-runtime"

/**
 * r29c: the moments an ability runs into something (`impact`, r29) and the dazes those start (`stagger[].enter`), placed in its pictures. The game shows them where and when
 * they really happen, which a picture cannot know: there is no wall in it. So the picture says what it takes, the one rule for every creature:
 * - the one it fights stands where every picture puts them (`assumedTarget`, straight ahead), a player's box;
 * - a wall stands where the creature's own run ends (`Travel`): the end of its dash, or of the stretch it covers in the loop the rule belongs to. Where it meets it is the
 *   generated `abilityImpactFront`: the middle of the side of its box that faces the way it goes, halfway up;
 * - it meets the one it fights the first tick its box (grown by 0.35 a side, as `abilityTouched` grows it) touches theirs, and a dash's hit strikes them the first tick the
 *   stretch it swept reaches their box; where is the generated `abilityImpactOn`: the point of their box nearest its own middle;
 * - a daze that one of those starts (`result.stagger`) begins on the same tick, shown at the middle of its body (`combatFall`).
 * A moment that cannot be placed (a loop that does not carry it anywhere, a run that never reaches the one it fights) is said, with why, and not drawn. No Node APIs.
 */

export type ImpactMoment = {
  /** `impactSlots`'s key (`a0.dash.wall`, …) and its words (「招式「…」冲刺撞墙时」). */
  key: string
  words: string
  fx: ImpactFx
  /** The tick it happens on, where (blocks, the creature's own terms when the ability started) and where its feet are then; null when the picture cannot place it (`why`). */
  tick: number | null
  at: Place | null
  feet: Place | null
  /** A wall it is taken to meet: where its face stands ahead. */
  wall: { forward: number } | null
  /** What the picture takes, in words. */
  assumed: string
  why?: string
  /** Each daze it starts there, with what that shows (`stagger.enter`). */
  dazes: { words: string; fx: ImpactFx; at: Place }[]
}

type Creature = { stagger?: Parameters<typeof staggerList>[0]; width: number; height: number }
const num = (value: number, digits = 2) => Number(value.toFixed(digits))

/** Every moment of impact of `ability` and the dazes they start, placed as the file says. */
export function impactMoments(ability: Ability, travel: Travel | null, creature: Creature): ImpactMoment[] {
  const staggers = staggerList(creature.stagger)
  const slots = impactSlots([ability]).filter((slot) => slot.ability === 0)
  const enters = impactSlots([], staggers)
  const places = travel?.places ?? []
  const length = Math.max(1, Math.round(ability.length * TICKS))
  const placeAt = (tick: number): Place => places[Math.max(0, Math.min(places.length - 1, tick))] ?? { forward: 0, up: 0, left: 0 }
  const target = assumedTarget(ability)
  const half = creature.width / 2
  const middle = (feet: Place): Place => ({ ...feet, up: feet.up + creature.height / 2 })
  const front = (feet: Place): Place => ({ forward: feet.forward + half, up: feet.up + creature.height / 2, left: feet.left })
  // The point of the target's box nearest its own middle (`abilityImpactOn`).
  const onTarget = (feet: Place): Place => ({ forward: Math.max(target - 0.3, Math.min(target + 0.3, feet.forward)), up: Math.max(0, Math.min(AIM_TARGET.tall, feet.up + creature.height / 2)), left: Math.max(-0.3, Math.min(0.3, feet.left)) })
  // The furthest it gets between two ticks, and the first tick it is there (the move that takes it there is the one a wall just past it stops).
  const runEnd = (from: number, to: number) => {
    const span = places.slice(from, to + 1)
    if (span.length < 2) return null
    const far = Math.max(...span.map((place) => place.forward))
    if (far - span[0]!.forward < 1e-3) return null
    const arrive = from + span.findIndex((place) => place.forward >= far - 1e-6)
    return { tick: Math.max(from, arrive - 1), feet: placeAt(arrive) }
  }
  const dazesOf = (rule: { result: { stagger?: string | undefined } } | null, feet: Place | null) => {
    if (!rule?.result.stagger || !feet) return []
    const index = staggers.findIndex((row) => (row.id ?? "default") === rule.result.stagger)
    const slot = enters.find((entry) => entry.key === `stagger.${index}`)
    return slot ? [{ words: slot.words, fx: slot.fx, at: middle(feet) }] : []
  }
  const dash = dashPlan(ability)
  const stages = stagePlan(ability)
  const wallWords = "图上没有墙：假设墙就在它冲到头的地方，撞点是它身体正前方那一面的中间、半身高"
  return slots.map((slot): ImpactMoment => {
    const [, part, side] = slot.key.split(".") as [string, string, string]
    const base = { key: slot.key, words: slot.words, fx: slot.fx, dazes: [] as ImpactMoment["dazes"] }
    const none = (assumed: string, why: string): ImpactMoment => ({ ...base, tick: null, at: null, feet: null, wall: null, assumed, why })
    // The loop a rule belongs to, or the whole dash.
    const stage = part.startsWith("s") ? stages[Number(part.slice(1))] ?? null : null
    const from = stage ? stage.from : dash ? dash.start : 0
    const to = stage ? Math.max(stage.from, stage.to - 1) : dash ? Math.min(length, dash.start + dash.ticks) : length
    const rule = stage && side.startsWith("c") ? ability.stages![stage.index]!.end?.collision?.[Number(side.slice(1))] ?? null : null
    const meetsWall = side === "wall" || Boolean(rule)
    if (meetsWall) {
      const end = runEnd(from, to)
      if (!end) return none(wallWords, `${stage ? "这一段" : "冲刺"}里它自己不往前走，撞墙的那一刻要看它被推到哪里，图上画不出来`)
      return { ...base, tick: end.tick, at: front(end.feet), feet: end.feet, wall: { forward: end.feet.forward + half }, assumed: wallWords, dazes: dazesOf(rule, end.feet) }
    }
    // Meeting the one it fights.
    const touchWords = `目标画在正前方 ${num(target)} 格（出招距离的中间），撞点是目标身上离它身体中间最近的那一点`
    const hit = slot.key.includes(".dash.") && dash?.dash.hit !== null && dash ? ability.hits[dash.dash.hit!] : null
    const reach = hit && hit.type === "area" ? shapeFar(hit.shape) : 0
    const meets = (tick: number) => (hit ? placeAt(tick + 1).forward + reach >= target - 0.3 : placeAt(tick).forward + half + 0.35 >= target - 0.3)
    const start = hit && dash?.hitFrom !== null && dash ? Math.max(from, dash.hitFrom) : from
    const found = Array.from({ length: Math.max(0, to - start + 1) }, (_, at) => start + at).find(meets)
    if (found === undefined) return none(touchWords, `它这一路${hit ? "带的那一下" : "身体"}碰不到站在 ${num(target)} 格外的目标`)
    const feet = placeAt(hit ? found + 1 : found)
    return { ...base, tick: found, at: onTarget(feet), feet, wall: null, assumed: touchWords }
  })
}

/** The words of one moment for a cell and the notes. */
export function impactMomentWords(moment: ImpactMoment, fx: (value: ImpactFx) => string) {
  const at = moment.tick === null ? "" : `第 ${num(moment.tick / TICKS)} 秒`
  return [
    `${moment.words}${at ? `（${at}）` : ""}：${fx(moment.fx)}。${moment.why ? `${moment.why}。` : `${moment.assumed}。`}`,
    ...moment.dazes.map((daze) => `同一刻${daze.words}：${fx(daze.fx)}，在它身体中间。`),
  ]
}
