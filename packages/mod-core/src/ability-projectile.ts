import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { ABILITY_EFFECTS, TICKS, WARN_COLORS, WARN_LIMITS, WARN_LOOKS } from "./ability-words"
import { AIM_TARGET, abilityPlace, abilityPlan, abilityTick, hitAnchor, placeTarget, type AbilityIssue, type Place } from "./creature-abilities"
import type { Ability, AbilityHit, HitPlace, ProjectileHit } from "./entity-runtime"
import { fallTicks, fanAim, flightPoints, scatter, stepBack, type Point } from "./projectile-flight"
import { projectileCount, projectileReturns } from "./projectile-rules"
import { PROJECTILE_IMPACT, PROJECTILE_LIMITS, PROJECTILE_PATHS } from "./projectile-words"
import type { ParticleNames } from "./particle-emission"
import { particleWords } from "./ability-trails"
import { groundFxLines, groundImpactWords, groundStar } from "./ground-fx"
import { cameraCueWords, skyTintCueWords } from "./cinematic"

/**
 * Boss 能力 2 (投射物) between the document and everything that reads it: a thrown thing's flight as the pictures draw it (`projectileSketch`, from the one set of formulas
 * the game flies it by, projectile-flight.ts), what is said of it (`projectileWords`) and what a reviewer is told about it (`projectileIssues`). No Node APIs: the app's window reads it too.
 */

const num = (value: number, digits = 2) => Number(value.toFixed(digits)) || 0
type Vec = [number, number, number]

/** A place in the creature's own terms as a point of the flight's frame: the world's axes with the creature at the origin facing +z (its own left is +x). */
const point = (place: Place): Point => [place.left, place.up, place.forward]
/** A point of the flight's frame as a point of the viewport's space (model pixels), where every picture of the creature is drawn. */
const viewport = (at: Point): Vec => abilityPlace(at[2], at[1], at[0])

/** Where the places a volley from the sky falls on lie, in the creature's own terms, with the one it fights `target` blocks straight ahead: item 3's places, by `seed`. */
export function skyPlaces(over: HitPlace, index: number, target: number, seed: number = PROJECTILE_LIMITS.seed): Place[] {
  // Boss 能力 13: the arena's middle is drawn where the creature stands: the pictures put it at the middle of its arena.
  if (over === "self" || over === "center") return [{ forward: 0, up: 0, left: 0 }]
  if (over === "target") return [{ forward: target, up: 0, left: 0 }]
  if ("fixture" in over) return []
  if (over.type === "pattern") return over.points.map((at) => ({ forward: at.forward, up: 0, left: at.left }))
  const pairs = scatter(seed, index, over.count, over.spread)
  return Array.from({ length: over.count }, (_, at) => ({ forward: num(target + pairs[at * 2]!, 4), up: 0, left: num(pairs[at * 2 + 1]!, 4) }))
}

/**
 * One thrown thing's whole flight, as the pictures draw it and the reviewer reads it, with the one it fights straight ahead at `target` blocks on the creature's ground (and not in the
 * way: what it touches is the game's): `out` its way out (viewport points, one a tick), `land` where it comes down (its place, the tick after the throw) or null, `stuck` the ticks
 * it stays there, `back` its way back to where it left from (viewport points; empty when it does not come back), and the ticks after the throw it starts back and is home (or gone).
 */
function oneFlight(hit: ProjectileHit, plan: { tick: number }, from: Point, aim: Point) {
  const flown = flightPoints(hit.path, from, aim, hit.speed, hit.gravity, 0, hit.lifetime_ticks, hit.homing)
  const pin = abilityTick(hit.pin_seconds ?? 0)
  if (hit.path === "boomerang" || hit.path === "return") {
    const turn = flown.back ?? flown.points.length - 1
    return { out: flown.points.slice(0, turn + 1), land: null, stuck: 0, back: flown.points.slice(turn), backAt: turn, home: flown.points.length - 1 }
  }
  const landed = flown.land
  const end = landed ? landed.tick : flown.points.length - 1
  const stays = landed ? pin : 0
  if (!hit.comes_back) return { out: flown.points, land: landed, stuck: stays, back: [] as Point[], backAt: null, home: end + stays }
  const asked = abilityTick(hit.comes_back.at) - plan.tick
  const backAt = Math.max(asked, end + stays)
  const back: Point[] = [flown.points.at(-1)!]
  for (let tick = 0; tick < PROJECTILE_LIMITS.back; tick++) {
    const step = stepBack(back.at(-1)!, from, hit.speed)
    back.push(step.at)
    if (step.home) break
  }
  return { out: flown.points, land: landed, stuck: backAt - end, back, backAt, home: backAt + back.length - 1 }
}

/**
 * Every thrown thing of hit `index` of an ability, on the model it plays on, as the pictures draw it: where it leaves from (a part's middle at the hit, `hitAnchor`; for one from the sky
 * the place above where it falls), the target where every picture puts it (`placeTarget`), each flight (`oneFlight`) in the viewport's space, and its warning. Null for a hit that is not
 * a thrown thing, or whose part the model lacks (the build refuses that: `boneIssues`).
 */
export function projectileSketch(ability: Ability, index: number, design: Pick<ModelDesign, "bones" | "animations"> | null, target: number = placeTarget(ability)) {
  const hit = ability.hits[index]
  if (!hit || hit.type !== "projectile") return null
  const plan = abilityPlan(ability).hits[index]!
  const thrown = (() => {
    if ("sky" in hit.from) {
      const sky = hit.from.sky
      return skyPlaces(sky.over, index, target).map((place) => {
        const ground = point(place)
        const top: Point = [ground[0], sky.height, ground[2]]
        return { from: top, aim: ground, ...oneFlight(hit, plan, top, ground) }
      })
    }
    const anchor = design ? hitAnchor(ability, index, design) : null
    if (!anchor) return null
    const from = point(anchor)
    // What flies straight or loops aims at the middle of the one it fights; what is lobbed lands at their feet.
    const aim: Point = [0, hit.path === "arc" ? 0 : AIM_TARGET.middle, target]
    const count = projectileCount(hit)
    return Array.from({ length: count }, (_, at) => {
      const aimed = fanAim(from, aim, at, count, hit.spread ?? 0)
      return { from, aim: aimed, ...oneFlight(hit, plan, from, aimed) }
    })
  })()
  if (!thrown) return null
  const warn = "sky" in hit.from && hit.warn ? { ...hit.warn, start: Math.max(0, plan.tick - abilityTick(hit.warn.seconds)) / TICKS } : null
  return {
    index,
    at: hit.at,
    tick: plan.tick,
    sky: "sky" in hit.from,
    target,
    warn,
    flights: thrown.map(flight => {
      const limit = hit.lifetime_ticks
      if (limit === undefined || limit >= flight.home) return flight
      const backAt = flight.backAt !== null && flight.backAt <= limit ? flight.backAt : null
      return { ...flight, out: flight.out.slice(0, limit + 1), backAt, back: backAt === null ? [] : flight.back.slice(0, limit - backAt + 1), home: limit, stuck: Math.min(flight.stuck, Math.max(0, limit - (flight.land?.tick ?? limit))) }
    }).map((flight) => ({
      ...flight,
      out: flight.out.map(viewport),
      back: flight.back.map(viewport),
      land: flight.land ? { tick: flight.land.tick, place: { forward: num(flight.land.at[2], 3), up: num(flight.land.at[1], 3), left: num(flight.land.at[0], 3) } } : null,
    })),
  }
}
export type ProjectileSketch = NonNullable<ReturnType<typeof projectileSketch>>

/** The ring a landing (or a warned place) is drawn as on the ground: `radius` blocks round a place (viewport space), as flat faces of one outline. */
export function landingRing(place: Place, radius: number): Vec[][] {
  const ring = Array.from({ length: 20 }, (_, at): Vec => abilityPlace(place.forward + radius * Math.cos((at * Math.PI) / 10), 0.02, place.left + radius * Math.sin((at * Math.PI) / 10)))
  return [ring]
}

const lookWords = (hit: ProjectileHit, bone?: ParticleNames["bone"]) => `${"bone" in hit.look ? `自己身上的「${bone?.(hit.look.bone) ?? hit.look.bone}」` : "效果做的投射物"}${hit.size !== undefined && hit.size !== 1 ? `（放大到 ${num(hit.size)} 倍）` : ""}`

/** A thrown thing in words: 「第 0.7 秒从「spear」朝目标扔出自己身上的「spear」（抛出去，划一道弧正好落在目标脚下）：打中掉 10 点血、被打退；落地插在地上 5 秒，再飞回它手里」. */
export function projectileWords(hit: ProjectileHit, names: ParticleNames = {}) {
  const count = projectileCount(hit)
  const where = "sky" in hit.from ? `从天上 ${num(hit.from.sky.height)} 格高的地方往${placeWordsOf(hit.place ?? hit.from.sky.over)}落下${count > 1 ? ` ${count} 件` : ""}` : `从「${names.bone?.(hit.from.bone) ?? hit.from.bone}」朝${hit.place ? placeWordsOf(hit.place) : "目标"}扔出${count > 1 ? ` ${count} 件（摊开 ${num(hit.spread ?? 0)}°）` : ""}`
  const done = [...(hit.damage > 0 ? [`掉 ${num(hit.damage)} 点血`] : []), ...(hit.knockback > 0 ? ["被打退"] : []), ...hit.effects.map((effect) => `${ABILITY_EFFECTS[effect.effect]} ${num(effect.duration_ticks / TICKS, 1)} 秒`)].join("、") || "什么都不会发生"
  const after = hit.path === "boomerang" || hit.path === "return" ? "，飞回它手里" : `${(hit.pin_seconds ?? 0) > 0 ? `；落地插在地上 ${num(hit.pin_seconds!)} 秒` : "；落地就消失"}${hit.comes_back ? `，最早第 ${num(hit.comes_back.at)} 秒拔出来飞回它手里` : ""}`
  return `第 ${num(hit.at)} 秒${where}${lookWords(hit, names.bone)}（${PROJECTILE_PATHS[hit.path]}${hit.warn ? `，提前 ${num(hit.warn.seconds)} 秒在落点画出${WARN_COLORS[hit.warn.color].name}的预警（${WARN_LOOKS[hit.warn.look]}）` : ""}）：打中${hit.radius > 0 ? `的地方 ${num(hit.radius)} 格以内` : "的"}${done}${after}${hit.pierce ? `，可额外穿过 ${hit.pierce} 个目标` : ""}${hit.bounces ? `，遇墙最多反弹 ${hit.bounces} 次` : ""}${hit.homing ? `，在 ${hit.homing.range} 格内追踪目标（每刻转向 ${num(hit.homing.strength * 100)}%）` : ""}${hit.lifetime_ticks !== undefined ? `，离手后最多存在 ${hit.lifetime_ticks} 刻` : ""}${hit.trail ? `，飞行拖尾每刻 ${hit.trail.per_tick} 颗${particleWords(hit.trail, names.title, names.aliases)}` : ""}${hit.impact ? `；${impactWords(hit.impact, names.title, names.aliases)}` : ""}`
}

/**
 * 落地炸开 in words: 「落下的那一刻在落点炸开：一个效果资产、24 个爆炸粒子（散开 3 格）、32 格内的玩家屏幕晃动（力度 4，1.5 秒）」. `title` names an effect or a particle asset by its id (null: not known here).
 */
export function impactWords(impact: NonNullable<ProjectileHit["impact"]>, title: ((id: string) => string | null) | null = null, aliases?: ParticleNames["aliases"]) {
  const parts = [
    ...(impact.effect !== undefined ? [`放出效果「${title?.(impact.effect) ?? impact.effect}」`] : []),
    ...(impact.particle !== undefined ? [`冒出 ${impact.count ?? PROJECTILE_IMPACT.count} 个${particleWords({ particle: impact.particle }, title, aliases)}粒子（散开 ${num(impact.spread ?? PROJECTILE_IMPACT.spread)} 格）`] : []),
    ...(impact.shake ? [`${num(impact.shake.radius, 1)} 格内的玩家屏幕晃动（力度 ${num(impact.shake.strength)}，${num(impact.shake.seconds)} 秒里停下）`] : []),
    // The players' camera and sky round there (cinematic).
    ...(impact.camera ? [cameraCueWords(impact.camera)] : []),
    ...(impact.sky_tint ? [skyTintCueWords(impact.sky_tint)] : []),
    // 第 4 步: what it leaves on the ground there.
    ...(impact.ground?.length ? [groundImpactWords(impact.ground, title, aliases)] : []),
  ]
  return `落下的那一刻（碰到人或者落地）在落点炸开：${parts.join("、")}`
}

const placeWordsOf = (over: HitPlace) => (over === "self" ? "它自己脚下" : over === "target" ? "目标脚下" : over === "center" ? "场地正中" : "fixture" in over ? (over.fixture === "lit_random" ? "随机亮着的物件" : "最近的亮着物件") : over.type === "around_target" ? `目标周围 ${num(over.spread)} 格以内随机的地方` : `它排好的 ${over.points.length} 个地方`)

/** The lines the pictures say under a thrown thing's cell: where it lands and when, how long it stays, when it is back. */
export function projectileLines(ability: Ability, sketch: ProjectileSketch): string[] {
  const hit = ability.hits[sketch.index] as ProjectileHit
  const first = sketch.flights[0]!
  const seconds = (ticks: number) => num((sketch.tick + ticks) / TICKS)
  const landing = first.land ? `第 ${seconds(first.land.tick)} 秒落在前 ${first.land.place.forward} 格、左 ${first.land.place.left} 格的地方` : null
  return [
    `第 ${num(hit.at)} 秒${sketch.sky ? `从天上落下 ${sketch.flights.length} 件` : `扔出${sketch.flights.length > 1 ? ` ${sketch.flights.length} 件` : ""}`}（虚线是飞的路线，图上按站在正前方 ${sketch.target} 格的目标画${sketch.sky && typeof (hit.from as { sky: { over: HitPlace } }).sky.over === "object" ? "，随机的落点按其中一次出招画" : ""}）。`,
    ...(hit.homing ? [`弯曲虚线演示目标每刻横移 0.18 格、持续 30 刻时的追踪路线；追踪距离为 ${hit.homing.range} 格。`] : []),
    ...(landing ? [`${landing}${first.stuck > 0 ? `，插在地上 ${num(first.stuck / TICKS)} 秒` : "，落地就消失"}${first.backAt !== null ? `，第 ${seconds(first.backAt)} 秒飞回来（第二种虚线），第 ${seconds(first.home)} 秒回到它手里` : ""}。`] : []),
    ...(!first.land && (hit.path === "boomerang" || hit.path === "return") ? [`第 ${seconds(first.backAt ?? 0)} 秒到最远处，第 ${seconds(first.home)} 秒回到它手里（按它站着不动画）。`] : []),
    ...(!hit.homing && !first.land && hit.path !== "boomerang" && hit.path !== "return" ? [`没碰到人的话它一直飞，${num((hit.lifetime_ticks ?? PROJECTILE_LIMITS.flight) / TICKS)} 秒内落不了地${hit.lifetime_ticks === undefined && hit.comes_back ? "，到时候飞回来" : "，到时候就消失"}。`] : []),
    ...(sketch.warn ? [`预警：从第 ${num(sketch.warn.start)} 秒起在每个落点画出${WARN_COLORS[sketch.warn.color].name}的圈，到第 ${num(hit.at)} 秒东西才开始落，第 ${first.land ? seconds(first.land.tick) : "?"} 秒落地才打。`] : []),
    // 落地炸开: where and when it bursts, drawn as a star at every landing (`impactLines`).
    ...(hit.impact
      ? [
          first.land
            ? `第 ${seconds(first.land.tick)} 秒落地的那一刻在落点炸开（图上每个落点画成${IMPACT_COLOR.words}的星${hit.impact.ground?.length ? "，留在地上的画成它的范围" : ""}）：${impactWords(hit.impact).replace(/^[^：]*：/, "")}。`
            : `它${hit.path === "boomerang" || hit.path === "return" ? "不落地" : "按图上的目标位置落不了地"}，碰到人的那一刻才在那里炸开：${impactWords(hit.impact).replace(/^[^：]*：/, "")}。`,
        ]
      : []),
  ]
}

/** The colour a burst is drawn in, and its name. */
export const IMPACT_COLOR = { hex: "#ffcc22", words: "金色" } as const

/**
 * 落地炸开 as the pictures draw it: a star at every place a thrown thing of this sketch comes down (as wide as its particles scatter, a block at least), and what it leaves on the
 * ground there (`groundFxLines`: a hazard's circle, a crack's strokes, a shockwave's first and last ring). Empty for one that bursts into nothing, or never comes down.
 */
export function impactLines(ability: Ability, sketch: ProjectileSketch): { points: Vec[]; color: string; dashed?: boolean }[] {
  const hit = ability.hits[sketch.index]
  if (!hit || hit.type !== "projectile" || !hit.impact) return []
  const impact = hit.impact
  const size = Math.max(1, impact.spread ?? PROJECTILE_IMPACT.spread, ...(impact.shake ? [1.5] : []))
  return sketch.flights.flatMap((flight) => {
    if (!flight.land) return []
    const place = flight.land.place
    return [...groundStar(place.forward, place.up, place.left, size).map((points) => ({ points, color: IMPACT_COLOR.hex })), ...(impact.ground ?? []).flatMap((fx) => groundFxLines(fx, { forward: place.forward, up: 0, left: place.left }))]
  })
}

/** The ticks a thrown thing is out, from the moment it is thrown to the moment it is back or gone, over level ground with its target where the pictures put them. */
const awayTicks = (sketch: ProjectileSketch) => Math.max(...sketch.flights.map((flight) => flight.home))

/**
 * What a reviewer is told about an ability's thrown things, never a stop: one that cannot reach the one it fights (a straight throw that falls short, a flight longer than the game keeps it,
 * a fall from too high to land), one that comes back long after (it vanishes if its thrower dies first), a part thrown that is still away when the ability may start again (the game then
 * throws nothing), and a cast that throws more at once than `PROJECTILE_LIMITS.volley`.
 */
export function projectileIssues(creature: { name: string }, ability: Ability, design: Pick<ModelDesign, "bones" | "animations"> | null): AbilityIssue[] {
  const plan = abilityPlan(ability)
  const said = (index: number, text: string, fix: string, detail: string): AbilityIssue => ({ ability: ability.id, rule: "ability_projectile", stops: false, text: `「${creature.name}」的招式「${ability.name}」第 ${index + 1} 次出手${text}`, fix, detail: `ability ${ability.id} hit ${index}: ${detail}` })
  const found = ability.hits.flatMap((hit, index): AbilityIssue[] => {
    if (hit.type !== "projectile") return []
    const lifetime = hit.lifetime_ticks ?? PROJECTILE_LIMITS.flight
    const reach = (distance: number) => projectileSketch(ability, index, design, distance)
    const near = reach(ability.start.min_distance)
    const far = reach(ability.start.max_distance)
    if (!far || !near) return []
    const issues: AbilityIssue[] = []
    if ("sky" in hit.from) {
      const ticks = fallTicks(hit.from.sky.height, hit.speed, hit.gravity, lifetime + 1)
      if (ticks > lifetime) issues.push(said(index, `从 ${num(hit.from.sky.height)} 格高落下来，${num(lifetime / TICKS)} 秒内落不到地上：游戏里它半路就消失了。`, "把 speed 或 gravity 加大，或者把 height 改低。", `falls ${ticks} ticks`))
      const lead = (hit.warn ? abilityTick(hit.warn.seconds) : 0) + ticks
      if (!hit.warn && hit.from.sky.over !== "self") issues.push(said(index, `从天上落向${placeWordsOf(hit.from.sky.over)}，却没有预警（warn）：东西要第 ${num((plan.hits[index]!.tick + ticks) / TICKS)} 秒才落地，玩家看不出要躲到哪里。`, "给它写 warn，在落点先画出圈。", "no warning"))
      else if (hit.warn && lead / TICKS < WARN_LIMITS.readable - 1e-9) issues.push(said(index, `的预警到落地只有 ${num(lead / TICKS)} 秒（不到 ${WARN_LIMITS.readable} 秒）：玩家看到了也来不及躲。`, "把 warn.seconds 改大，或者让它从高一点的地方落。", `warning ${lead} ticks before it lands`))
    } else {
      // How far it gets toward someone at the far end of its window, and at the near end, flying over level ground.
      for (const sketch of [far, near]) {
        const flight = sketch.flights[Math.floor(sketch.flights.length / 2)]!
        const short = flight.land ? sketch.target - flight.land.place.forward : 0
        if (hit.path === "straight" && flight.land && short > 0.5 + PROJECTILE_LIMITS.touch)
          issues.push(said(index, `扔出去以后往下坠，目标站在 ${num(sketch.target)} 格外时，它在 ${num(flight.land.place.forward)} 格的地方就落地了：够不到。`, "把 speed 加大、gravity 改小，或者改成 arc（自己算好抬多高），或者把出招的最远距离改近。", `target ${sketch.target}; lands ${flight.land.place.forward} ahead`))
        if (hit.path === "arc" && !flight.land) issues.push(said(index, `抛向 ${num(sketch.target)} 格外的目标，${num(lifetime / TICKS)} 秒内落不了地：游戏里它半路就当作丢了。`, "把 speed 加大。", `no landing within ${lifetime} ticks`))
        if (hit.path === "straight" && !flight.land && hit.speed * lifetime < sketch.target) issues.push(said(index, `每刻只飞 ${num(hit.speed)} 格，${num(lifetime / TICKS)} 秒飞不到 ${num(sketch.target)} 格外的目标。`, "把 speed 加大。", `speed ${hit.speed}`))
      }
    }
    // It comes back long after the ability: whatever its thrower does meanwhile, it is said what becomes of it if the thrower is gone.
    const away = awayTicks(far)
    const after = plan.hits[index]!.tick + away - plan.length
    if (projectileReturns(hit) && after > 2 * TICKS)
      issues.push(said(index, `扔出去的东西要到招式结束 ${num(after / TICKS)} 秒以后才飞回来；这期间它要是死了或者不见了，东西就在原地消失，不会飞回去${"bone" in hit.look ? `，「${hit.look.bone}」也不会再出现` : ""}。`, "这是写法本身的结果，确认一下是不是想要的；不想等这么久就把 pin_seconds 或 comes_back.at 改小。", `back ${away} ticks after the throw`))
    if ("bone" in hit.look) {
      const again = plan.length - plan.hits[index]!.tick + plan.cooldown
      if (away > again)
        issues.push(said(index, `扔的是自己的「${hit.look.bone}」，它要 ${num(away / TICKS)} 秒才回来（或者消失），可是这一招 ${num(again / TICKS)} 秒以后就又能用：那时它手里没有「${hit.look.bone}」，游戏里这一下就不扔了，只剩动作。`, `把这一招的冷却（start.cooldown）加到 ${num(Math.ceil(((away - (plan.length - plan.hits[index]!.tick)) / TICKS) * 10) / 10)} 秒以上，或者让它早点回来。`, `away ${away} ticks; may start again after ${again}`))
      if (!projectileReturns(hit)) issues.push(said(index, `扔出去的是自己的「${hit.look.bone}」，可是它不会飞回来：东西落地${(hit.pin_seconds ?? 0) > 0 ? `插 ${num(hit.pin_seconds!)} 秒` : ""}消失的那一刻，「${hit.look.bone}」凭空重新出现在它身上。`, "要它飞回来就写 comes_back，或者改用 return、boomerang。", "never comes back"))
    }
    return issues
  })
  const thrown = ability.hits.reduce((sum, hit) => sum + (hit.type === "projectile" ? projectileCount(hit) : 0), 0)
  return [
    ...found,
    ...(thrown > PROJECTILE_LIMITS.volley
      ? [{ ability: ability.id, rule: "ability_projectile" as const, stops: false, text: `「${creature.name}」的招式「${ability.name}」一次扔出 ${thrown} 件东西（超过 ${PROJECTILE_LIMITS.volley} 件）：每一件都是场上的一个实体，飞的每一刻服务端都要查一遍它碰到了谁、撞没撞墙，附近每个玩家的游戏都要画它；同一时刻有几只这样的生物就再乘几倍。`, fix: `能少就少几件（${PROJECTILE_LIMITS.volley} 件已经是一场兵器雨），或者分到两次出手里错开落。`, detail: `ability ${ability.id}: ${thrown} thrown in one cast` }]
      : []),
  ]
}

/** Whether a hit is a thrown thing of its own (Boss 能力 2). */
export const isProjectile = (hit: AbilityHit): hit is ProjectileHit => hit.type === "projectile"
