import { abilityRef, clipRef } from "./finding-refs"
import { motionName } from "@minemods/studio-ai/making"
import { TICKS } from "./ability-words"
import { AIM_TARGET, AIR_REACH, abilityPlan, airHitReach, airReachFlier, airReachMayStart, airReachNearest, airReachPath, hasDirectionalStrike, shapeAims, type Place } from "./creature-abilities"
import type { Ability, Flight, Habits } from "./entity-runtime"
import { typeIn } from "./play-words"
import { ABILITY_WHERE, FLIGHT_LIMITS, FLIGHT_STYLES, HABIT_ACTIVE, HABIT_LIMITS, VANILLA_PREY, VANILLA_PREY_IDS, flightMotions, turnRadius } from "./flight-words"

/**
 * Flight and habits between their documents and everything that reads them (epic tier and flight, 10-12): the numbers the generated Java
 * is written from (`flightPlan`, `habitsPlan`, the one place seconds become ticks), what is wrong with them against the model they play
 * on, what the blueprint's epic tier still asks of a creature, and all of it in plain words, for the person and for whoever writes the document.
 * Nothing here knows a subject: every sentence is made from the numbers and names of the document.
 * No Node APIs: the app's window reads it too.
 */

const num = (value: number, digits = 2) => Number(value.toFixed(digits))
type Clip = { name: string; length: number }
/** A moment of a flier or a habit as a server tick; never less than one tick. */
const tick = (seconds: number) => Math.max(1, Math.round(seconds * TICKS))

/** Whether an ability may start with the creature in the air (`where` left out is either). */
export const airAbility = (ability: Pick<Ability, "where">) => ability.where !== "ground"

/**
 * How a flier fights once it has a target, whoever gave it (its own targeting, a revenge, gameplay code that set one):
 * `circle`: some ability of it may start in the air, so it circles above the target and uses those (a hostile creature only: abilities are only used by one);
 * `harry`: it has no ability at all, so what it has is the plain swing, and it closes in and swings at the target from the air (a swing reaches only what its box meets at the same height, so not from above);
 * `ground`: it has abilities but every one says `where: ground`, so it fights on the ground, as those say;
 * `none`: a passive creature does not fight, so a target it was given changes nothing about where it is.
 * `abilities` is the list the creature uses: empty for a creature that is not hostile.
 */
export function flightFight(abilities: readonly Pick<Ability, "where">[], behavior: "passive" | "follow" | "hostile"): "circle" | "harry" | "ground" | "none" {
  if (behavior === "passive") return "none"
  if (behavior === "hostile" && abilities.some(airAbility)) return "circle"
  return abilities.length === 0 ? "harry" : "ground"
}

/**
 * Whether the generated flier ever walks on the ground by its own choice, so that its walk motion can be seen played there. False only for one that is never
 * in the mood for the ground (`air_share` at 1: `flightWantsAir` is then true whenever nothing asks anything of it), has no ability that must be used on the ground
 * (`where: "ground"`: it comes down for one, or, with only such abilities, fights on the ground, see `flightFight` and `flightLands`), does not rest (`habits.active`
 * other than "always": it goes home and rests on the ground, walking there), does not eat after a kill (`habits.eat`: it comes down first, `habitEatLeft`) and is no boss (its leash sets it down at its lair, `flightComeHome`). Why it exists:
 * a bat, a ghost or a jellyfish whose model's walk was declared still never walks; holding its walk to "a foot steps back" (`walk_glides`) would refuse it for a motion nobody sees,
 * and its creature-stage maker cannot change the model. Anything that can bring it down is counted as walking (when in doubt it is held to the rule, which `justified` answers).
 * What is not looked at, because it is not the creature's way of moving: the two seconds (`FLIGHT_LIMITS.groundLeast`) after it appears on the ground before it takes off, being in water
 * (it does not take off there) and gameplay code that asks it to land (`ProjectContent.land`).
 */
export function flightWalks(creature: { flight?: Flight | null; habits?: Habits | null; boss?: unknown; abilities?: readonly Pick<Ability, "where">[] | null }) {
  const flight = creature.flight
  if (!flight) return true
  return flight.air_share < 1 || (creature.abilities ?? []).some((ability) => ability.where === "ground") || Boolean(creature.habits && (creature.habits.active !== "always" || creature.habits.eat)) || Boolean(creature.boss)
}

/**
 * The abilities of a flier that fights in the air which only start on the ground (`where: ground`): it comes down for them when no air ability is ready
 * (flight, `flightGroundWanted` in the generated Java). Empty when it has no ability that starts in the air (then it fights on the ground all the way, `flightFight`
 * says "ground") or none that is ground-only (then it never has a reason to come down). `abilities` is the list the creature uses.
 */
export const flightLands = <T extends Pick<Ability, "where">>(abilities: readonly T[]): T[] => (abilities.some(airAbility) ? abilities.filter((ability) => ability.where === "ground") : [])

/**
 * Where a flier circles above the one it fights, so that as many of its abilities as possible can start there: the distance (blocks, the
 * creature to its target) that the most start windows of its in-the-air abilities hold, the larger weight and then the smaller distance
 * deciding a tie; half of it is the height above the target (30 degrees up), the rest the radius on the ground, never tighter than the
 * flier can turn (it needs 1.2 times its turning radius, speed over turn rate in radians, to keep circling).
 * `reaching` (epic game1, `airReach`): per ability, the row of one aimed at the one it fights. Such an ability starts only when its hits can be within reach by the first hit
 * (`flightReaches`), which a circle too wide never allows, so the distance is brought in to the widest circle at which every one of them can start from it (`airReachCircled`, found by
 * halving between a circle that can and the first distance). Where none can, not even on the tightest circle the flier can fly (the turning room, at the bottom of its band), no circle
 * helps: `approach` is true and the flier closes in on the line to its target when such an ability is ready (`flightReachReady`), as the windows say it may. Without such a row the
 * result is what it always was, to the property.
 */
export function flightCircle(flight: Pick<Flight, "speed" | "turn" | "altitude" | "climb" | "style">, abilities: readonly Ability[], reaching?: readonly (readonly number[] | null)[]) {
  const windows = abilities.filter(airAbility).map((ability) => ({ min: ability.start.min_distance, max: ability.start.max_distance, weight: ability.start.weight }))
  const candidates = [...new Set(windows.flatMap((window) => [window.min, window.max, (window.min + window.max) / 2].map((value) => Math.max(3, num(value)))))].sort((a, b) => a - b)
  const score = (distance: number) => windows.filter((window) => distance >= window.min && distance <= window.max).reduce((sum, window) => ({ count: sum.count + 1, weight: sum.weight + window.weight }), { count: 0, weight: 0 })
  const best = candidates.reduce<{ distance: number; count: number; weight: number } | null>((found, distance) => {
    const value = score(distance)
    return !found || value.count > found.count || (value.count === found.count && value.weight > found.weight) ? { distance, ...value } : found
  }, null)
  const windowed = best?.distance ?? Math.max(3, num((flight.altitude.min + flight.altitude.max) / 2))
  const rows = (reaching ?? []).flatMap((row, at) => (row && airReachCan(row) ? [{ row, least: abilities[at]!.start.min_distance, ability: { windup: abilityPlan(abilities[at]!).windup, tracks: abilities[at]!.facing === "track" } }] : []))
  // The tightest circle is distance 3 (the least a circle is ever made at): the turning room decides its radius.
  const reached = rows.reduce<{ distance: number; approach: boolean }>(
    (found, { row, least, ability }) => {
      if (airReachCircled(row, flight, found.distance, ability)) return found
      if (!airReachCircled(row, flight, REACH_CIRCLE_LEAST, ability)) return { ...found, approach: true }
      let near = REACH_CIRCLE_LEAST
      let far = found.distance
      // 20 halvings: the distance to a millionth of the window; the gate only gets harder with distance (the circle widens, the height rises), so halving finds the edge.
      for (let step = 0; step < 20; step++) {
        const middle = (near + far) / 2
        if (airReachCircled(row, flight, middle, ability)) near = middle
        else far = middle
      }
      // The ability also starts only from its own window: the flier's feet are `circleAt(...).apart` from its target on that circle (its band and turning room keep it further than the distance
      // says), and if even the widest circle that reaches is nearer than the ability's least distance, no circle serves both.
      return circleAt(flight, near).apart + 1e-6 < least ? { ...found, approach: true } : { ...found, distance: near }
    },
    { distance: windowed, approach: false },
  )
  const distance = rows.length ? num(reached.distance, 4) : windowed
  const turning = turnRadius(flight)
  const height = distance / 2
  return {
    distance,
    height: num(height),
    radius: num(Math.max(Math.sqrt(distance * distance - height * height), turning * FLIGHT_LIMITS.turnRoom)),
    turnRadius: num(turning),
    ...(rows.length ? { approach: reached.approach } : {}),
  }
}

/** The least distance (blocks, the flier to its target) a circle is made at: the same floor the windows use. */
const REACH_CIRCLE_LEAST = 3

/** Whether the gate can ever be passed by such an ability: the nearest the station lets it get is within the reach and the slack (else no circle and no approach helps; the finding says so). */
const airReachCan = (row: readonly number[]) => airReachNearest(row[0]!, 1 + row[1]! - AIM_TARGET.middle) <= row[0]! + AIR_REACH.slack

/**
 * Whether an ability aimed at the one it fights (`airReach` row) may start from a circle of this 3D distance round its target: the gate (`airReachMayStart`) read for a flier on the circle flying
 * square to the line to the target (90° off, the worst of a lap: its goal a little ahead on the circle only turns it toward it), at cruise. The circle is the flier's own (`flightCircle`): half the
 * distance up (held to its band over flat ground, the target's feet), the radius the rest, never under its turning room; every point of it is alike, so one is read, for a lap either way (the place its
 * hits start at lies `left` beside the heading, outward on one and inward on the other). The target's middle is 0.9 above its feet (`AIM_TARGET`) and the ground a block under the feet.
 * The flier cuts a little inside the circle it steers at (14 of 17 blocks in the lap simulation of `test/air-station.test.ts`), so the circle it flies is never wider than this one.
 */
export function airReachCircled(row: readonly number[], flight: Pick<Flight, "speed" | "turn" | "altitude" | "climb" | "style">, distance: number, ability: { windup: number; tracks: boolean }) {
  const at = circleAt(flight, distance)
  const flier = airReachFlier(flight)
  const floor = 1 - AIM_TARGET.middle
  return [0, 180].every((yaw) =>
    airReachMayStart(row, airReachPath(row, flier, ability, { x: at.radius, z: 0, feet: at.high - AIM_TARGET.middle, yaw, climb: 0, speed: flier.cruise }, floor), flier.cruise, floor + row[1]!),
  )
}

/** A circle of this 3D distance as the generated flier flies it: the radius (half the distance up, the rest across, never under its turning room), the height of its feet over the target's (held to its band over flat ground) and so how far its feet are from the target's. */
function circleAt(flight: Pick<Flight, "speed" | "turn" | "altitude">, distance: number) {
  const half = distance / 2
  const radius = Math.max(Math.sqrt(distance * distance - half * half), turnRadius(flight) * FLIGHT_LIMITS.turnRoom)
  const high = Math.min(Math.max(half, flight.altitude.min), flight.altitude.max)
  return { radius, high, apart: Math.hypot(radius, high) }
}

/**
 * epic game1: a frost dragon circled 10 blocks and more above the player and breathed from its mouth with a cone 16 long; the mouth was 25 to 34 blocks from the player and
 * the breath never touched them. Per ability, for one that may start in the air and is not a dive, whose hits are aimed at the one it fights (a beam or a cone not kept level):
 * `[reach, up, forward, left, first, last, push, follow]` (`airHitReach`): how far the shortest of them reaches from where it starts, where that is ahead of, above and beside the feet at the size the
 * model is built (a hit from a bone starts at the bone, any other at the feet; a hit from a bone the model lacks is left out), the ticks of the first and of the last of them and how far the hits before
 * the last push who they hit, and how much of that the aim follows. Null for every other ability: it keeps its height while it runs, as it always did. While it runs the flier holds station where those hits reach (`AIR_REACH`), and it
 * starts only when the hold keeps them within reach at every one (`airReachPath`).
 */
export function airReach(abilities: readonly Ability[], anchors: readonly (readonly (Place | null)[])[]): (number[] | null)[] {
  return abilities.map((ability, index) => airHitReach(ability, anchors[index] ?? []))
}

/** The flier as ticks, blocks a tick and degrees a tick: what the generated Java holds as constants and every sentence about timing says. */
export function flightPlan(flight: Flight, abilities: readonly Ability[], fights: boolean, harries = false, reaching?: readonly (readonly number[] | null)[]) {
  const cruise = flight.speed / TICKS
  const turn = flight.turn / TICKS
  const soar = flight.style === "soar"
  return {
    soar,
    cruise,
    stall: soar ? cruise * FLIGHT_LIMITS.stall : 0,
    accel: cruise / tick(FLIGHT_LIMITS.accel),
    diveAccel: cruise / tick(FLIGHT_LIMITS.diveAccel),
    brake: cruise / tick(FLIGHT_LIMITS.brake),
    turn,
    climb: flight.climb,
    bank: flight.bank,
    // The lean reaches its largest at the fastest turn (spec: 侧倾 = 转向速度 × 系数，限制在 bank 以内): degrees of lean per degree turned in a tick.
    bankGain: flight.bank / turn,
    altitude: flight.altitude,
    airShare: flight.air_share,
    takeoffTicks: tick(flight.takeoff.seconds),
    landTicks: tick(flight.land.seconds),
    moodTicks: { min: tick(FLIGHT_LIMITS.mood.min), max: tick(FLIGHT_LIMITS.mood.max) },
    groundLeast: tick(FLIGHT_LIMITS.groundLeast),
    airLeast: tick(FLIGHT_LIMITS.airLeast),
    arrive: Math.max(FLIGHT_LIMITS.arriveLeast, num(cruise * TICKS * FLIGHT_LIMITS.arrive)),
    probes: FLIGHT_LIMITS.probe.map((seconds) => tick(seconds)),
    stuckTicks: tick(FLIGHT_LIMITS.stuckSeconds),
    giveUpTicks: tick(FLIGHT_LIMITS.giveUpSeconds),
    returnTicks: tick(FLIGHT_LIMITS.returnSeconds),
    circle: flightCircle(flight, abilities, reaching),
    /** How far above the one it fights it gets ready for a stoop: the height it circles at, never lower than the bottom of its band. */
    diveHeight: Math.max(flightCircle(flight, abilities, reaching).height, flight.altitude.min),
    /** The flier fights in the air when some ability of it may start there. */
    fights: fights && abilities.some(airAbility),
    /** The flier has no ability and is one that fights (`flightFight`): it closes in on its target and swings at it in the air. */
    harries,
    where: abilities.map((ability) => (ability.where === "ground" ? 1 : ability.where === "air" ? 2 : 0)),
    /** The flier comes down to use a ground-only ability when no air ability is ready (`flightLands`): only one that fights in the air has a reason to. */
    lands: fights && flightLands(abilities).length > 0,
    /** Per ability, the distance window it starts in (blocks, the creature to its target): where a flier that comes down for it stands. */
    near: abilities.map((ability) => ability.start.min_distance),
    far: abilities.map((ability) => ability.start.max_distance),
    /** The farthest any ground-only ability starts from: further than that from its target, a flier that came down is left behind and goes up again. */
    groundReach: Math.max(0, ...abilities.filter((ability) => ability.where === "ground").map((ability) => ability.start.max_distance)),
    dive: abilities.map((ability) => Boolean(ability.dive)),
    /**
     * broad11 w1 recheck: per ability, whether it has to face the one it fights for a hit to land: one that turns to them while it gets ready (\`facing: "track"\`), is no dive (a dive lines
     * up by its own flight) and has a hit laid out ahead of it rather than aimed at them (an arc, a box, a sphere, a level beam). In the air such an ability starts only when it can turn to them in time.
     */
    faces: abilities.map((ability) => !ability.dive && ability.facing === "track" && hasDirectionalStrike(ability) && ability.hits.some((hit) => hit.type === "area" && !shapeAims(hit.shape))),
    /** The tick of each ability on which its last hit lands: the charge of a dive ends there. */
    last: abilities.map((ability) => Math.max(...abilityPlan(ability).hits.map((hit) => hit.tick))),
    /** The tick of each ability on which its first hit lands: the charge of a dive is timed to be at the locked point on it. */
    first: abilities.map((ability) => Math.min(...abilityPlan(ability).hits.map((hit) => hit.tick))),
    /** The slowest the charge goes (blocks a tick): twice cruise, and the fastest (`FLIGHT_LIMITS.diveMost`); between them it goes at the speed that is there on time. */
    diveLeast: cruise * FLIGHT_LIMITS.dive,
    diveMost: FLIGHT_LIMITS.diveMost,
  }
}
export type FlightPlan = ReturnType<typeof flightPlan>

/** The habits as ticks and blocks: what the generated Java holds as constants. `lengths` are the model's motions' lengths, in seconds, by name. */
export function habitsPlan(habits: Habits, lengths: Readonly<Record<string, number>>) {
  const stand = (clip: string | null | undefined, least: number) => (clip && lengths[clip] !== undefined ? Math.min(HABIT_LIMITS.eat.max, Math.max(HABIT_LIMITS.eat.min, Math.ceil(lengths[clip]! * TICKS))) : least)
  return {
    hungerTicks: tick(habits.hunger_seconds),
    eatTicks: stand(habits.eat?.clip, HABIT_LIMITS.pause),
    alertTicks: stand(habits.alert?.clip, HABIT_LIMITS.pause),
    cooldownTicks: tick(HABIT_LIMITS.cooldown),
    giveUpTicks: tick(HABIT_LIMITS.giveUp),
  }
}
export type HabitsPlan = ReturnType<typeof habitsPlan>

/** The motions a flier plays itself, once each: takeoff, landing, flapping, gliding and hovering, where it has them. */
export const flightClips = (flight: Flight | null | undefined) => (flight ? [...new Set(Object.values(flightMotions(flight)).filter((clip): clip is string => clip !== null))] : [])
/** The motions a creature plays for its habits, once each: resting, eating and being alert. */
export const habitsClips = (habits: Habits | null | undefined) => (habits ? [...new Set([habits.rest?.clip, habits.eat?.clip, habits.alert?.clip].filter((clip): clip is string => typeof clip === "string"))] : [])

/**
 * Each motion a flier plays, with when and how it must be made: what the model's maker is told, and what a missing one is called.
 * A motion used for two things is listed once with both.
 */
export function flightClipRoles(flight: Flight | null | undefined) {
  if (!flight) return []
  const motions = flightMotions(flight)
  const roles: [string | null, string, string][] = [
    [motions.takeoff, "起飞", `长 ${num(flight.takeoff.seconds)} 秒，不循环`],
    [motions.land, "落地", `长 ${num(flight.land.seconds)} 秒，不循环`],
    [motions.fly, "在天上扇翅", "循环"],
    [motions.glide, "滑翔", "循环"],
    [motions.hover, "悬停", "循环"],
  ]
  return roleList(roles)
}

/** The same for the motions of habits: resting, eating, being alert. */
export function habitClipRoles(habits: Habits | null | undefined) {
  if (!habits) return []
  const roles: [string | null | undefined, string, string][] = [
    [habits.rest?.clip, "休息", "循环"],
    [habits.eat?.clip, "吃东西", "不循环"],
    [habits.alert?.clip, "警觉", "不循环"],
  ]
  return roleList(roles)
}

function roleList(roles: readonly (readonly [string | null | undefined, string, string])[]) {
  const named = roles.flatMap(([clip, why, how]) => (clip ? [{ clip, why, how }] : []))
  return [...new Set(named.map((role) => role.clip))].map((clip) => {
    const found = named.filter((role) => role.clip === clip)
    return { clip, why: `${found.map((role) => role.why).join("、")}的时候`, fix: `${found.map((role) => `${role.why}：${role.how}`).join("；")}。` }
  })
}

// ---- words ----

const days = (habits: Habits) => HABIT_ACTIVE[habits.active]

export const flightWords = {
  /** 「滑翔型，巡航每秒 12 格，平时离地 6–20 格」 */
  style: (flight: Flight) => `${FLIGHT_STYLES[flight.style]}，巡航每秒 ${num(flight.speed)} 格，平时离地 ${num(flight.altitude.min)}–${num(flight.altitude.max)} 格`,
  /** 「转弯最快每秒 90 度，最陡爬升或俯冲 40 度，转弯时机身最多侧倾 25 度」 */
  moves: (flight: Flight) => `转弯最快每秒 ${num(flight.turn)} 度，最陡爬升或俯冲 ${num(flight.climb)} 度，转弯时机身最多侧倾 ${num(flight.bank)} 度（只是看起来）`,
  /** 「没事的时候约 60% 的时间在天上，其余的时间在地上走或休息」 */
  share: (flight: Flight) => (flight.air_share >= 1 ? "没事的时候一直在天上" : flight.air_share <= 0 ? "没事的时候不上天（敌对的发现目标时才上天）" : `没事的时候约 ${num(flight.air_share * 100, 0)}% 的时间在天上，其余的时间在地上走或休息`),
  /** 「起飞播「takeoff」、用 1.2 秒；落地播「land」、用 0.8 秒；在天上扇翅播「fly」、滑翔播「glide」」 */
  clips: (flight: Flight) =>
    `起飞${flight.takeoff.clip ? `播「${motionName(flight.takeoff.clip)}」、` : ""}用 ${num(flight.takeoff.seconds)} 秒；落地${flight.land.clip ? `播「${motionName(flight.land.clip)}」、` : ""}用 ${num(flight.land.seconds)} 秒；在天上扇翅播「${motionName(flight.clips.fly)}」${flight.clips.glide ? `、滑翔播「${motionName(flight.clips.glide)}」` : ""}${flight.clips.hover ? `、悬停播「${motionName(flight.clips.hover)}」` : ""}`,
  /** One sentence for a card or the playable standard. */
  summary: (flight: Flight) => `它会飞：${flightWords.style(flight)}；${flightWords.moves(flight)}；${flightWords.share(flight)}；${flightWords.clips(flight)}；落地前先降到离地 1 格以内；不受摔落伤害`,
  /** A dive, as the ability's sentence says it. */
  dive: `先在目标上方拉高、对准；蓄力一结束就锁定目标当时身体中间的位置，按离那里还有多远、离第一次出手还有多久算好速度（至少两倍巡航速度，每刻最多 ${FLIGHT_LIMITS.diveMost} 格），直线冲过去，正好在第一次出手的那一刻到；到了就等在那里，最后一次出手以后拉起回到平时的高度`,
  where: (where: keyof typeof ABILITY_WHERE) => ABILITY_WHERE[where],
  /** 「天上的招式都还在冷却、而地上的招式好了的时候，它会落到你身边，落地用「扫尾」，用完（或被打、被甩开）再飞起来」: the coming down for a ground-only ability (`flightLands`). */
  lands: (names: readonly string[]) => `天上的招式都还在冷却、而地上的招式好了的时候，它会落到你身边，落地用${names.map((name) => `「${name}」`).join("、")}，用完（或被打、被甩开）再飞起来`,
  /** What it does once it has a target, for the line of the guide about its movement: said by what the generated creature really does (`flightFight`), nothing more. */
  fights: (kind: ReturnType<typeof flightFight>, lands: readonly string[] = []) =>
    kind === "circle"
      ? `会飞，追人时在你上空盘旋${lands.length ? `；${flightWords.lands(lands)}` : ""}`
      : kind === "harry"
        ? "会飞，追人时飞到你身边、在空中近身攻击"
        : kind === "ground"
          ? "会飞，但它的招式都要站在地上才用，所以追人时留在地上打"
          : "会飞",
  /** 「想亲眼看：…」 for the guide: what to do in the game and what to see. */
  sees: (flight: Flight, command: string) =>
    `想亲眼看它飞：${typeIn(`/tp @e[type=${command},limit=1] ~ ~${num(flight.altitude.max + 8, 0)} ~`)}，把它放到空中——它不该掉下来摔死，而是在 ${num(flight.altitude.min)}–${num(flight.altitude.max)} 格的高度上${flight.style === "soar" ? "一直向前飞、兜圈（滑翔型要有速度，不会停在空中）" : "飞、可以停在空中"}；看转弯时机身是不是向转弯的一侧侧倾、爬升时抬头、下降时低头；等一会儿，它没事时会降下来：落地前先降到离地 1 格以内、播落地的动作，落稳了才在地上走。`,
}

export const habitsWords = {
  /** 「白天活动，夜里回出生点 20 格内的窝休息」 */
  rest: (habits: Habits) =>
    habits.active === "always"
      ? "一直活动，不特意休息"
      : `${days(habits)}活动，${habits.active === "day" ? "夜里" : "白天"}${habits.home ? "回窝" : "就地"}休息${habits.rest?.clip ? `（播「${motionName(habits.rest.clip)}」）` : "（站着不动）"}`,
  /** 「平时不离开出生点 24 格远，走远了自己回来」 */
  home: (habits: Habits) => (habits.home ? `平时不离开出生点 ${num(habits.home.radius)} 格远，走远了自己回来` : "没有固定的窝，不限制在哪里活动"),
  /**
   * 「吃饱以后每过 5 分钟又饿，饿了去追捕附近的牛、猪……」. Empty when `prey` is: an empty list only means the habits do not send it hunting, and a gameplay of its own may still make it eat
   * (broad11 w4b: a toad that "eats bugs at night" through a gameplay was told it does not hunt), so nothing is said either way.
   */
  prey: (habits: Habits) =>
    habits.prey.length ? `吃饱以后每过 ${num(habits.hunger_seconds / 60, 1)} 分钟又饿，饿了去追捕附近的${habits.prey.map((id) => VANILLA_PREY[id] ?? id).join("、")}${habits.eat?.clip ? `，吃的时候播「${motionName(habits.eat.clip)}」` : ""}` : "",
  /** 「玩家第一次走近 16 格就先警觉（播「roar」），之后 30 秒内不再；它先只警告……走近到 6 格以内才会扑上来」 */
  alert: (habits: Habits) =>
    habits.alert
      ? `玩家第一次走近 ${num(habits.alert.distance)} 格就先警觉${habits.alert.clip ? `（播「${motionName(habits.alert.clip)}」）` : ""}，之后 ${HABIT_LIMITS.cooldown} 秒内不再${habits.alert.attack_distance === undefined ? "" : `；它先只警告、看着玩家，走近到 ${num(habits.alert.attack_distance)} 格以内（或者玩家打了它）才会扑上来`}`
      : "不会警觉",
  /** 「走近到 20 格它会先警告，再靠近到 8 格才扑上来」: the line for the guide; null for a creature that fights from as far as ever. */
  warns: (habits: Habits) => (habits.alert?.attack_distance === undefined ? null : `走近到 ${num(habits.alert.distance)} 格它会先警告，再靠近到 ${num(habits.alert.attack_distance)} 格才扑上来`),
  summary: (habits: Habits, between = "；") => [habitsWords.rest(habits), habitsWords.home(habits), habitsWords.prey(habits), habitsWords.alert(habits)].filter(Boolean).join(between),
}

// ---- against the model ----

export type FlightIssue = { refs?: import("@minemods/studio-ai/acceptance").FindingRef[]; rule: "flight_clip" | "flight_clip_length" | "habit_clip" | "flight_dive_reach"; stops: boolean; text: string; fix: string; detail: string }

/**
 * What is wrong with a creature's flight and habits against its model, by rule. `clips` are its model's motions (null: the model is not known
 * here, so only what the document itself shows is checked). A finding that `stops` is one the build refuses: a motion it plays that the model lacks.
 * A takeoff or landing motion whose length is not the time it is given is a warning: it would freeze before the creature is up, or be cut off.
 */
export function flightModelIssues(creature: { name: string; flight?: Flight | null; habits?: Habits | null }, clips: readonly Clip[] | null): FlightIssue[] {
  if (clips === null) return []
  const lacking = (clip: string | null | undefined, where: string, rule: "flight_clip" | "habit_clip", fix: string): FlightIssue[] =>
    clip && !clips.some((value) => value.name === clip)
      ? [{ rule, refs: [clipRef(clip)], stops: true, text: `「${creature.name}」${where}要播「${motionName(clip)}」这个动作，可是它的模型里没有这个动作。`, fix, detail: `${where}: clip ${clip}; model has: ${clips.map((value) => value.name).join(", ")}` }]
      : []
  const timed = (clip: string | null, where: string, seconds: number): FlightIssue[] => {
    const found = clip ? clips.find((value) => value.name === clip) : undefined
    return found && Number.isFinite(found.length) && Math.abs(found.length - seconds) > 2 / TICKS + 1e-9
      ? [{ rule: "flight_clip_length", refs: [clipRef(clip!)], stops: false, text: `「${creature.name}」${where}的动作「${motionName(clip!)}」长 ${num(found.length)} 秒，可是这一段留的是 ${num(seconds)} 秒：${found.length < seconds ? "动作放完它会僵住不动" : "动作还没放完，状态就变了"}。`, fix: `把 flight 里这一段的 seconds 改成 ${num(found.length)}，或者把动作做成 ${num(seconds)} 秒。`, detail: `${where}: clip ${clip} length ${found.length}; seconds ${seconds}` }]
      : []
  }
  const flight = creature.flight
  const habits = creature.habits
  const motions = flight ? flightMotions(flight) : null
  const fixFlight = (what: string) => `给模型加上名叫这个名字的动作（${what}），或者把 flight 里的 clip 改成模型里有的动作${what === "起飞" || what === "落地" ? "，不想播动作就写 null" : ""}。`
  const fixHabit = (what: string) => `给模型加上名叫这个名字的动作（${what}），或者把 habits 里的 clip 改成模型里有的动作，不想播动作就写 null。`
  return [
    ...(flight && motions
      ? [
          ...lacking(motions.takeoff, "起飞时", "flight_clip", fixFlight("起飞")),
          ...lacking(motions.land, "落地时", "flight_clip", fixFlight("落地")),
          ...lacking(motions.fly, "在天上扇翅时", "flight_clip", fixFlight("扇翅，循环")),
          ...lacking(motions.glide, "滑翔时", "flight_clip", fixFlight("滑翔，循环")),
          ...lacking(motions.hover, "悬停时", "flight_clip", fixFlight("悬停，循环")),
          ...timed(motions.takeoff, "起飞时", flight.takeoff.seconds),
          ...timed(motions.land, "落地时", flight.land.seconds),
        ]
      : []),
    ...(habits
      ? [...lacking(habits.rest?.clip, "休息时", "habit_clip", fixHabit("休息，循环")), ...lacking(habits.eat?.clip, "吃东西时", "habit_clip", fixHabit("进食")), ...lacking(habits.alert?.clip, "警觉时", "habit_clip", fixHabit("警觉，不循环"))]
      : []),
  ]
}

/**
 * How far a dive can get between the end of its wind-up and its first hit, the only time it has to cover the way to the one it fights (the data counts the hit
 * as it says, whether it got there or not): the velocities the charge sets before the hit is counted, and the blocks it covers with them at the fastest charge
 * (`FLIGHT_LIMITS.diveMost` a tick). The flight runs after the creature has moved in its tick, so the first velocity of the charge is set while the wind-up's
 * last tick counts, and it is applied by the movement two ticks on; the last one that counts is set two ticks before the hit's, which is applied just before it:
 * the ticks from the end of the wind-up to the first hit, less one.
 */
export function diveCoverage(ability: Ability) {
  const plan = abilityPlan(ability)
  const first = Math.min(...plan.hits.map((hit) => hit.tick))
  const ticks = Math.max(0, first - plan.windup - 1)
  return { windup: plan.windup, first, ticks, blocks: num(ticks * FLIGHT_LIMITS.diveMost) }
}

/**
 * A dive that cannot get to its target in time: its start window reaches out to `start.max_distance`, and the way from there, at the fastest the charge goes, is
 * longer than the time between the end of the wind-up and the first hit allows. It still hits when the data says it does, and misses whoever is not within its
 * reach then. Never stops a build. Needs only the document (no model): the charge is flown, not played.
 */
export function diveIssues(creature: { name: string; behavior: string; flight?: Flight | null; abilities?: readonly Ability[] | null }): FlightIssue[] {
  if (creature.behavior !== "hostile" || !creature.flight) return []
  return (creature.abilities ?? []).flatMap((ability): FlightIssue[] => {
    if (!ability.dive) return []
    const cover = diveCoverage(ability)
    const far = ability.start.max_distance
    if (far <= cover.blocks + 1e-9) return []
    // The first hit late enough for the velocities that cover `far` at the fastest: that many ticks, the one the wind-up ends on and the one before the hit.
    const needed = Math.ceil(far / FLIGHT_LIMITS.diveMost) + 1
    return [
      {
        rule: "flight_dive_reach",
        refs: [abilityRef(ability)],
        stops: false,
        text: `「${creature.name}」的俯冲招式「${ability.name}」目标在 ${num(far)} 格外也会开始，可是从蓄力结束（第 ${num(cover.windup / TICKS)} 秒）到第一次出手（第 ${num(cover.first / TICKS)} 秒）只有 ${num(cover.ticks / TICKS)} 秒，冲刺再快（每刻最多 ${FLIGHT_LIMITS.diveMost} 格）也只冲得过 ${num(cover.blocks)} 格：出手还是照数据在那一刻算，冲不到的时候打不中人。`,
        fix: `把第一次出手（hits 的第一个 at）放晚到第 ${num((cover.windup + needed) / TICKS)} 秒以后，或者把这个招式的最远出招距离（start.max_distance）改到 ${num(cover.blocks)} 格以内。`,
        detail: `ability ${ability.id}: start.max_distance ${far}; wind-up ends tick ${cover.windup}, first hit tick ${cover.first}; ${cover.ticks} velocities * ${FLIGHT_LIMITS.diveMost} blocks/tick = ${cover.blocks}`,
      },
    ]
  })
}

// ---- what the blueprint's epic tier asks of the creature ----

/** Words in what the person asked for (or the planning AI wrote) that say a creature flies. Whole phrases: a splash that "flies" off a sword is not a flier. */
const FLIES = /会飞|能飞|飞行|飞翔|飞天|飞起|翱翔|盘旋|滑翔|翅膀|双翼|\bfly\b|\bflies\b|\bflying\b|\bflight\b|\bwings?\b|\bsoars?\b/i
/** Whether some words say the creature flies. */
export const impliesFlight = (...words: readonly (string | null | undefined)[]) => words.some((value) => typeof value === "string" && FLIES.test(value))

/**
 * What a creature of the epic tier that flies or lives by habits still lacks, as clauses that follow 「蓝图上定的是 史诗，可是」 (spec: 四):
 * a creature that is said to fly and has no flight, a flier whose takeoff or landing plays no motion of its own, a creature with habits whose rest plays none.
 * `said` is whether the blueprint's words or the creature's description say that it flies.
 */
export function flightTierGaps(creature: { flight?: Flight | null; habits?: Habits | null }, said: boolean) {
  return [...(said && !creature.flight ? ["蓝图或说明里写了它会飞，可是它没有 flight"] : []), ...flightTierStops(creature)]
}

/**
 * The gaps of `flightTierGaps` that the epic tier does not let through (spec 一: the motions of the air and of rest are 必须): a flight or habits that
 * is there but plays no motion of its own for takeoff, landing or rest. The other gap, "said to fly and has no flight", is read from words by a rule
 * of thumb (`impliesFlight`), which may take a creature that does not fly for one that does, so it is only said and never stops anything.
 */
export function flightTierStops(creature: { flight?: Flight | null; habits?: Habits | null }) {
  return [
    ...(creature.flight && !creature.flight.takeoff.clip ? ["它会飞，可是起飞没有自己的动作（flight.takeoff.clip）"] : []),
    ...(creature.flight && !creature.flight.land.clip ? ["它会飞，可是落地没有自己的动作（flight.land.clip）"] : []),
    ...(creature.habits && !creature.habits.rest?.clip && creature.habits.active !== "always" ? ["它有习性，可是休息没有自己的动作（habits.rest.clip）"] : []),
  ]
}

/** What to do about each gap `flightTierGaps` names. */
export const FLIGHT_TIER_STEPS = "给它写上 flight（会飞的话：起飞、落地、扇翅、滑翔或悬停各一个动作），有习性的写上 habits 并给休息一个动作；模型里要有这些动作。"
export const FLIGHT_TIER_FIX = `${FLIGHT_TIER_STEPS}不补也能打包，只是这些表现还没有。`

// ---- for whoever writes a creature document ----

const listed = (record: Readonly<Record<string, unknown>>) => Object.keys(record).join("|")

/** How to choose the numbers of a flight, as an AI is told them. */
export const FLIGHT_VALUE_GUIDE =
  "数值怎么定：巨大的生物飞得慢而稳（speed 8–14，turn 60–110，bank 20–35，altitude 12–40）；小而灵活的飞得快、转得急（speed 6–12，turn 180–300，altitude 2–8）。climb 取 30–45。起飞、落地的 seconds 取起飞、落地那个动作的长度（常见 1–2.5 秒）。air_share：只在天上的 0.9–1，常在地上的 0.2–0.4。"

export const FLIGHT_INSTRUCTIONS =
  ` flight 让生物会飞；省略或 null 是不会飞（老样子）。格式 {style, speed, altitude, turn, climb, bank, air_share, takeoff, land, clips}，全是数据，生成的模组照着飞，不用写玩法代码；它不改世界里的任何方块。` +
  ` style：${listed(FLIGHT_STYLES)}——soar 是大翅膀滑翔型（龙、鹰），要有速度才能留在空中，在天上永远不会停下；hover 是能悬停的（蜜蜂、萤火虫、幽灵）。` +
  ` speed ${FLIGHT_LIMITS.speed.min}–${FLIGHT_LIMITS.speed.max}（巡航速度，格/秒）；altitude {min ${FLIGHT_LIMITS.altitude.min.min}–${FLIGHT_LIMITS.altitude.min.max}, max ${FLIGHT_LIMITS.altitude.max.min}–${FLIGHT_LIMITS.altitude.max.max}}（平时离地多高，max 要比 min 大）；turn ${FLIGHT_LIMITS.turn.min}–${FLIGHT_LIMITS.turn.max}（最快转向，度/秒）；climb ${FLIGHT_LIMITS.climb.min}–${FLIGHT_LIMITS.climb.max}（平时飞行最陡的爬升或下降角，度；俯冲的冲刺是直线，不受它限制）；bank ${FLIGHT_LIMITS.bank.min}–${FLIGHT_LIMITS.bank.max}（转弯时机身最多侧倾几度，只是画面）；air_share 0–1（没事的时候有多大比例的时间在天上，其余在地上走或休息）。` +
  ` takeoff、land：{clip, seconds ${FLIGHT_LIMITS.seconds.min}–${FLIGHT_LIMITS.seconds.max}}——起飞、落地播模型里名叫 clip 的动作（不能是 idle、walk、hurt、death；不要动作写 null，会改播扇翅），状态持续 seconds 秒，seconds 要和动作的长度一样。` +
  ` clips：{fly, glide, hover}——fly 是在天上扇翅的循环动作；glide 是平飞或下降时的滑翔循环动作（soar 必须有，其余写 null）；hover 是几乎停着时的悬停循环动作（hover 必须有，其余写 null）；这些动作都要在模型里，也不能是 idle、walk、hurt、death。` +
  ` 在地上它照原样走（idle、walk）；起飞时播 takeoff，几秒内升到 altitude 的范围里，在天上自己控制飞行（朝一个点飞，转向、爬升、加减速都按上面的数不会瞬变，前方有方块会向上并向侧面避开，没有三维寻路：复杂的洞穴里会卡），转弯时机身侧倾、爬升时抬头；要落地时先降到离地 1 格以内，播 land，落稳了才在地上走。不受摔落伤害。不会在水下飞，不载人。敌对的会飞生物发现目标后在目标上空盘旋，用招式。Boss 的离开重置对它同样有效：回出生点时飞回去再落地。会飞的 Boss 还有三处和 boss 合在一起：（一）有登场（boss.intro）的，醒来是在叫醒它的玩家头顶盘旋着演（在地上就先起飞），不是站着不动；（二）阶段的 speed 大于 1 时，飞行的巡航、转弯、俯冲的速度也乘 speed（每刻最快 ${FLIGHT_LIMITS.diveMost} 格的上限不变，俯冲仍然正好在第一次出手那一刻到），也就是越到后面的阶段飞得越快；（三）Boss 有习性（habits）时，登场前它照习性活动，包括飞（见 habits 的说明）。` +
  ` 招式新增两个可选字段：where（${listed(ABILITY_WHERE)}，省略是 any）说这个招式在地上还是天上才用；dive（true 只有会飞的生物能写）让这个招式是俯冲：蓄力（windup）的时候它在目标上方拉高、对准；蓄力一结束就锁定目标那时身体中间的位置，直线冲过去：速度按“离那里还有多远 ÷ 离第一次出手还有多久”算，正好在第一次出手的那一刻到，至少两倍 speed，每刻最多 ${FLIGHT_LIMITS.diveMost} 格（每秒 ${FLIGHT_LIMITS.diveMost * 20} 格，游戏自己发给玩家的速度也不超过这个）；冲刺是直线，不受 climb 限制，也不被高度范围往上拉；到了就等在那里，最后一次出手之后拉起回到平时的高度。dive 的招式 where 写 air 或 any，第一次出手的时刻（hits 的第一个 at）要和蓄力结束（windup）隔开足够的时间让它冲到：start.max_distance 除以 ${FLIGHT_LIMITS.diveMost * 20} 秒以上，不够的话 Studio 会提醒（出手还是照数据在那一刻算，冲不到就打不中）；hits 用 sphere 或 arc 画在它身边，冲到的时候目标就在它身上。` +
  ` 会飞的敌对生物发现目标就上天，在目标上空盘旋；它在天上只用 where 不是 ground 的招式；写了招式但每个都是 where: ground 的，它有目标时留在地上打；一个招式都没写的（只有普通近战），它有目标时飞到目标身边、在空中近身攻击（贴到和目标身体差不多高的位置才打得到，不是在头顶）；where 写 ground 的招式只在它站在地上时用。不管目标是它自己选的、被打了还手、还是玩法代码给它定的，它都这样。天上的招式不能写位移（moves 在天上不起作用）。招式的 start 距离是它和目标之间的距离，盘旋会尽量停在能出招的距离上。` +
  ` 天上有招、地上也有招（where 写 ground）的会飞生物，战斗时是这样配合的：天上的招式（where 不是 ground 的）有一个好了（冷却完、Boss 的这一阶段允许）它就留在天上；天上的招式都还在冷却、而某个 where: ground 的招式好了、落地以后它的 start 范围放得下（max_distance 比两个身体的半宽之和大），它就落到目标身边那个招式的距离上，落地用这个招式，用完以后天上的招式好了就立刻再起飞；落地时被打了而手上又没有好了的地上招式，或者目标被甩到地上招式够不到的地方，也立刻再起飞；落了地一直没用上的，等了和“落地加起飞”一样久，它就放弃、之后同样久里不再为这个招式落地。体形大的它落点要放得下整个身体（和落地的脚印检查是同一个），找不到就不落。所以想让一只会飞的敌对生物有一招地面的招式（扫尾、践踏、震地），把那个招式写成 where: ground 就行，不用另写落地的代码；它为这个招式落地、再起飞各用起飞、落地的 seconds，所以这两个 seconds 不要写得比动作的长度长太多。` +
  ` 要让它飞到玩法指定的地方（例如在某些方块之间飞来飞去、飞到玩家头顶），那部分行为写成玩法代码，用 ProjectContent.flyTo(creature, x, y, z) 请它飞过去（isFlying 问它离没离地，land 请它落下），不要在代码里自己去摆布它的飞行；这个生物自己还是要有 flight。` +
  ` ${FLIGHT_VALUE_GUIDE}` +
  ` 例：{"style":"soar","speed":12,"altitude":{"min":10,"max":28},"turn":80,"climb":40,"bank":28,"air_share":0.6,"takeoff":{"clip":"takeoff","seconds":1.5},"land":{"clip":"land","seconds":1.2},"clips":{"fly":"fly","glide":"glide","hover":null}}。`

export const HABITS_INSTRUCTIONS =
  ` habits 让生物有自己的习性；省略或 null 是老样子。格式 {active, rest, home, prey, hunger_seconds, eat, alert}，全是数据，生成的模组照着做；吃东西不改血量，作息按世界时间不看天气，不改世界里的任何方块。` +
  ` active：${listed(HABIT_ACTIVE)}——day 白天活动、夜里去休息，night 相反，always 一直活动（此时不写 rest）。休息时它回到 home 的中心（没有 home 就在原地）停下、播 rest.clip（模型里的循环动作，不能是 idle、walk、hurt、death；rest 写 null 是只站着不动）。敌对的生物看到玩家照旧开打，打完回去休息；Boss 的登场优先。有登场（boss.intro）的 Boss 配了习性：登场前它不是睡着，而是照习性活动（活动的时间里巡、猎、飞，回窝；休息的时间才睡着），只是还没见过谁，所以不挑人开打；玩家走近 wake_distance 格或打到它，才见到、登场、开打；离开重置之后它回到这个还没见过谁的样子。没有习性的、有登场的 Boss 还是一直睡着。` +
  ` home：null，或 {radius ${HABIT_LIMITS.radius.min}–${HABIT_LIMITS.radius.max}}——平时不离开出生点（窝）这么远，走远了自己回来；会飞的飞着回来。` +
  ` prey：原版生物的 id 数组，最多 ${HABIT_LIMITS.prey} 个（${VANILLA_PREY_IDS.join("、")}），饿了就去追最近的、用近战打（所以 attack_damage 要大于 0），打死就算吃饱；空数组是习性不派它去捕猎（它吃什么另由玩法代码决定）；会飞的飞过去。hunger_seconds ${HABIT_LIMITS.hunger.min}–${HABIT_LIMITS.hunger.max}：吃饱以后多久又饿。eat：null，或 {clip}——捕到猎物以后站着吃、播这个动作（不循环，和动作一样长）。` +
  ` alert：null，或 {clip, distance ${HABIT_LIMITS.distance.min}–${HABIT_LIMITS.distance.max}, attack_distance 可不写}——玩家第一次走近 distance 格就先停下、看着玩家、播 clip（吼叫、竖起翅膀），之后 ${HABIT_LIMITS.cooldown} 秒内不再播。` +
  ` attack_distance（${HABIT_LIMITS.attack.min}–${HABIT_LIMITS.attack.max} 格，必须比 distance 小；只对敌对的、自己挑玩家打的生物有用，engagement 不要写 provoked 或 none_by_itself）：不写，敌对的生物照旧看到玩家（engagement 说的距离内）就开打，警觉只是开打前停一下；写了，它只在玩家走近到 attack_distance 格以内、或者玩家打了它的时候，才把玩家当成目标开打——玩家在 distance 和 attack_distance 之间时它只警告：停下、看着、播 clip，不攻击。开打以后和以前一样，追到目标死了、走远了或看不见为止。要“先吼一声，靠近了才扑上来”就写它（例：distance 20、attack_distance 8）。` +
  ` 例：{"active":"day","rest":{"clip":"sleep"},"home":{"radius":32},"prey":["cow","sheep"],"hunger_seconds":300,"eat":{"clip":"eat"},"alert":{"clip":"roar","distance":20,"attack_distance":8}}。`

export const FLIGHT_SUMMARY =
  "可选：飞行（flight）——滑翔型或悬停型，起飞、扇翅、滑翔或悬停、落地各有动作，转弯时机身侧倾、爬升时抬头，没事的时候按比例在天上或地上，敌对的发现目标就上天盘旋；没事时它在天上一个点一个点往前飞，不写 habits.home 就会越飞越远——要它守在一片地方上空转（海边、山顶、巢附近），就写 habits.home（不离出生点太远），它会在那一圈里飞来飞去、飞远了自己回来；招式可以写 dive（俯冲）和 where（地上还是天上才用；既有天上的招式又有 where: ground 的招式，它战斗时天上的招式都在冷却、地上的好了，就落到目标身边用，用完再飞起来）；会飞的 Boss 登场是在叫醒它的玩家头顶盘旋着演，阶段变快飞得也变快；玩法代码可以用 ProjectContent.flyTo / isFlying / land 请它飞到某处、问它离没离地、请它落下；不受摔落伤害，没有三维寻路，不在水下飞，不载人。习性（habits）——白天或夜里活动、不活动时回窝休息（播休息的动作）、不离出生点太远、饿了去捕猎原版动物并吃（播进食的动作）、玩家第一次走近先警觉（可以写成先只警告、再靠近到更近的距离才扑上来）。"

/** What a task for an epic-tier creature is told on top of the tier's own lines about flight and habits. */
export const FLIGHT_TASK_LINES = [
  "- 要它在天上飞的，要写 flight（格式见 flight 的说明）：模型里要有起飞（takeoff）、扇翅（fly）、滑翔（glide，滑翔型）或悬停（hover，悬停型）、落地（land）这些动作，flight 里的 clip 对得上；招式可以写 dive（俯冲）。原话要「飞」的生物，写了 flight 就不再列进「这次做不了」。",
  "- 要它有自己习性的（休息、守着窝、捕猎、见人先警觉），要写 habits（格式见 habits 的说明）：休息（rest）、进食（eat）、警觉（alert）各要一个动作，模型里要有。",
  `- 取值怎么定：${FLIGHT_VALUE_GUIDE}`,
] as const
