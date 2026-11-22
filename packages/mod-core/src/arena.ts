import { abilityRef, fixtureRef, phaseRef } from "./finding-refs"
import { fixtureReview } from "./fixture-checks"
import { z } from "zod"
import { ABILITY_LIMITS, TICKS } from "./ability-words"
import { BOSS_LIMITS, bossPhaseIds } from "./boss-words"
import type { Ability, AbilityHit, AbilityShape, Boss } from "./entity-runtime"

/**
 * Boss 能力 12 (场地物件 + 雾) and 13 (涿鹿：离场 + 天降大投射物 + 安全区) as data, between the document and everything that reads it: the boss's `arena` (fixtures put down
 * round its home when it wakes, lit by a player's right click, and the fog an ability raises), an ability's `fog` event, its `leave` move, an area hit over the whole arena
 * (`shape: {type: "arena"}`) with places that stay safe, and the arena's middle (`place: "center"`). Every number here is what the schema, the generated Java (`fabric/arena.ts`),
 * the words, the pictures (`arena-picture.ts`) and the reviewer read, so none of them can disagree. Nothing here knows a subject: every sentence is made from the document.
 * No Node APIs and nothing of `entity-runtime` but its types: the schema there is built from these.
 */

const num = (value: number, digits = 2) => Number(value.toFixed(digits))

/**
 * - `fixtures`: placed fixtures in all, whatever entries write them (a ring of four is four): the bar's row of dots holds as many (`BOSS_BAR_LIMITS.dots`).
 * - `place`: blocks a fixture may stand ahead of or beside home; `ring`: how many one ring puts down and how far out.
 * - `use`: seconds a player holds the use key on it to light it (0: one click), and the seconds after it goes dark before it may be lit again.
 * - `clear`: the radius (blocks) round a lit fixture where there is no fog, and how long it stays lit.
 * - `fog`: how far a player in it sees (blocks), how long it takes to come and go, what the boss's blows on such a player are multiplied by and what that player's blows on it are.
 * - `rise`: blocks a boss rises when it leaves the field; `safe`: the radius of a place that stays safe from a hit over the arena, and how many such places a hit may name.
 * - `size`: what a thrown thing of an effect's look may be scaled by (Boss 能力 13's comet).
 * - `watch`: ticks between two looks at who stands in the fog (each look sends only what changed); `edge`: ticks between two rounds of mist at the edge of a lit fixture's clear ground.
 * - `ground`: blocks above and below the planned place a fixture looks for ground to stand on; none there and it is not put down (the log says which).
 * - `hold`: ticks a player may let go of the use key and still be holding (the game repeats the click every four ticks while it is held).
 * - `radius`: blocks round the arena's middle a hit over the whole arena reaches, and the fight's own range (`BOSS_LIMITS.battle`).
 */
export const ARENA_LIMITS = {
  fixtures: 8,
  entries: 8,
  place: 32,
  ring: { count: { min: 1, max: 8 }, radius: { min: 2, max: 32 } },
  use: { seconds: { min: 0, max: 10 }, cooldown: { min: 0, max: 120 } },
  clear: { radius: { min: 2, max: 32 }, seconds: { min: 1, max: 120 } },
  fog: { visibility: { min: 2, max: 32 }, fade_end: { max: 64 }, fade: { min: 0.5, max: 10 }, boss_damage: { min: 1, max: 4 }, damage_taken: { min: 0.1, max: 1 } },
  rise: { min: 4, max: 24 },
  safe: { radius: { min: 1, max: 16 }, points: 8 },
  size: { min: 0.25, max: 8 },
  watch: 5,
  edge: 10,
  ground: { up: 8, down: 16 },
  hold: 8,
  radius: BOSS_LIMITS.battle,
} as const

export const FOG_LIFTS = { all_lit_once: "每一座物件都亮过一次，雾就整个退掉", never: "物件只在自己身边清出一块，雾一直到这场战斗结束" } as const
export const FIXTURE_GLOWS = { lit: "点亮的时候发光", always: "一直发光", none: "不发光" } as const
export const LEAVE_PLACES = { home: "它的家（出生的地方，有巢就是巢的中心）", center: "场地正中（物件围成的那一圈的中间，没有物件就是家）", near_target: "它的目标身边" } as const

const ahead = z.number().finite().min(-ARENA_LIMITS.place).max(ARENA_LIMITS.place)
const time = z.number().finite().min(0).max(ABILITY_LIMITS.seconds)
const Point = z.strictObject({ forward: ahead, left: ahead })

/** Where one entry of fixtures stands, in the arena's own terms (blocks ahead of home and to its left, the way the boss faced when the fight began): one place, or a ring round home. */
export const FixturePlaceSchema = z.union([
  Point,
  z.strictObject({ ring: z.strictObject({ count: z.number().int().min(ARENA_LIMITS.ring.count.min).max(ARENA_LIMITS.ring.count.max), radius: z.number().finite().min(ARENA_LIMITS.ring.radius.min).max(ARENA_LIMITS.ring.radius.max) }) }),
])
export type FixturePlace = z.infer<typeof FixturePlaceSchema>

export const ArenaFixtureSchema = z.strictObject({
  light: z.number().int().min(0).max(15).optional(),
  ember_light: z.number().int().min(0).max(15).optional(),
  id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "场地物件的 id 用小写字母开头，只含小写字母、数字和下划线"),
  /** A fixture asset of this project (`fixture.ts`): its model, its two motions and its glow. */
  look: z.strictObject({ asset: z.uuid() }),
  place: FixturePlaceSchema,
  use: z.strictObject({ by: z.enum(["hold", "hit"]).optional(), lit_seconds: z.number().min(0.05).max(3600).nullable().optional(), seconds: z.number().finite().min(ARENA_LIMITS.use.seconds.min).max(ARENA_LIMITS.use.seconds.max), cooldown: z.number().finite().min(ARENA_LIMITS.use.cooldown.min).max(ARENA_LIMITS.use.cooldown.max) }).optional(),
  clear: z.strictObject({ radius: z.number().finite().min(ARENA_LIMITS.clear.radius.min).max(ARENA_LIMITS.clear.radius.max), seconds: z.number().finite().min(ARENA_LIMITS.clear.seconds.min).max(ARENA_LIMITS.clear.seconds.max) }),
}).refine(value => !value.ember_light || value.ember_light < (value.light ?? 0), { path: ["ember_light"], message: "余烬光照请留空、写 0，或写比亮灯光照更低的等级。" })
export type ArenaFixture = z.infer<typeof ArenaFixtureSchema>

export const ArenaFogSchema = z.strictObject({
  visibility: z.number().finite().min(ARENA_LIMITS.fog.visibility.min).max(ARENA_LIMITS.fog.visibility.max),
  fade_end: z.number().finite().min(ARENA_LIMITS.fog.visibility.min).max(ARENA_LIMITS.fog.fade_end.max).optional(),
  fade_seconds: z.number().finite().min(ARENA_LIMITS.fog.fade.min).max(ARENA_LIMITS.fog.fade.max),
  boss_damage: z.number().finite().min(ARENA_LIMITS.fog.boss_damage.min).max(ARENA_LIMITS.fog.boss_damage.max),
  damage_taken: z.number().finite().min(ARENA_LIMITS.fog.damage_taken.min).max(ARENA_LIMITS.fog.damage_taken.max),
  lift: z.enum(Object.keys(FOG_LIFTS) as [keyof typeof FOG_LIFTS, ...(keyof typeof FOG_LIFTS)[]]),
}).refine((fog) => fog.fade_end === undefined || fog.fade_end >= fog.visibility, { path: ["fade_end"], message: "雾的完全遮挡距离 fade_end 不能小于 visibility。" })
export type ArenaFog = z.infer<typeof ArenaFogSchema>

/**
 * A boss's arena: `fixtures` put down on the ground round its home when it wakes (each entry one place or a ring), lit by a player holding the use key on them for
 * `use.seconds`, clearing the fog `clear.radius` round them for `clear.seconds`; `fog` (null: none) raised by an ability's fog event. All of it is taken away when the
 * fight ends (its death, a leash reset). The arena's frame is home and the way the boss faced when its fixtures were put down, turned to the nearest of the four
 * directions so the layout lies along the blocks.
 */
export const ArenaSchema = z
  .strictObject({
    fixtures: z.array(ArenaFixtureSchema).max(ARENA_LIMITS.entries),
    fog: ArenaFogSchema.nullable(),
  })
  .superRefine((arena, context) => {
    const total = arena.fixtures.reduce((sum, fixture) => sum + fixtureCount(fixture.place), 0)
    if (total > ARENA_LIMITS.fixtures) context.addIssue({ code: "custom", path: ["fixtures"], message: `一个场地最多 ${ARENA_LIMITS.fixtures} 座物件（一圈 4 座算 4 座），这里一共 ${total} 座：血条下面那一排小点放不下更多` })
    arena.fixtures.forEach((fixture, index) => arena.fixtures.findIndex((other) => other.id === fixture.id) !== index && context.addIssue({ code: "custom", path: ["fixtures", index, "id"], message: `两组场地物件不能用同一个 id（${fixture.id}）` }))
  })
export type Arena = z.infer<typeof ArenaSchema>

/** An ability's moment that raises the fog over its boss's arena (only a boss whose arena has a fog may write it): the fog then follows the ability's wait, weight and phases. */
export const FogEventSchema = z.strictObject({ type: z.literal("fog"), at: time })
export type FogEvent = z.infer<typeof FogEventSchema>

/**
 * A boss leaving the field (Boss 能力 13): at `at` it rises `rise` blocks and is gone — not drawn, not hurt, not taken as a target by anything — its bar staying; at `back.at` it comes
 * down at `back.place`. Both are moments of the ability, which runs on while it is away. Cut short (its ability ends early, a leash reset, its death) it is back home at once.
 */
const returnRange = z.tuple([ahead, ahead]).refine(([from, to]) => from <= to, "回场距离从小到大写，固定距离可填两个相同的数。")
const returnPlace = z.strictObject({ forward: returnRange, left: returnRange })
export const LeaveMoveSchema = z.strictObject({
  type: z.literal("leave"),
  at: time,
  rise: z.number().finite().min(ARENA_LIMITS.rise.min).max(ARENA_LIMITS.rise.max),
  back: z.strictObject({ at: time, place: z.union([z.enum(Object.keys(LEAVE_PLACES) as [keyof typeof LEAVE_PLACES, ...(keyof typeof LEAVE_PLACES)[]]), returnPlace]) }),
})
export type LeaveMove = z.infer<typeof LeaveMoveSchema>

/** Places a hit over the arena does not reach: round every lit fixture, or round points in the arena's frame; `radius` blocks round each. */
export const ArenaSafeSchema = z.strictObject({
  around: z.union([z.literal("lit_fixtures"), z.strictObject({ points: z.array(Point).min(1).max(ARENA_LIMITS.safe.points) })]),
  radius: z.number().finite().min(ARENA_LIMITS.safe.radius.min).max(ARENA_LIMITS.safe.radius.max),
})
export type ArenaSafe = z.infer<typeof ArenaSafeSchema>

/** The shape of a hit over the whole arena: everyone within `ARENA_LIMITS.radius` blocks of its middle, between `low` and `high` above the middle's ground. */
export const ArenaShapeSchema = z.strictObject({ type: z.literal("arena"), low: z.number().finite().min(-ABILITY_LIMITS.reach).max(ABILITY_LIMITS.reach), high: z.number().finite().min(-ABILITY_LIMITS.reach).max(ABILITY_LIMITS.reach) })
export type ArenaShape = z.infer<typeof ArenaShapeSchema>

/** The full circle a hit over the arena is, for everything that measures or draws a shape: an arc all the way round, `ARENA_LIMITS.radius` wide. */
export const arenaArc = (shape: Pick<ArenaShape, "low" | "high">) => ({ type: "arc" as const, reach: ARENA_LIMITS.radius, angle: 360, low: shape.low, high: shape.high })

/** A shape as everything that measures or draws one reads it: a hit over the arena is the full circle it covers (`arenaArc`), any other shape itself. */
export const plainShape = (shape: AbilityShape): Exclude<AbilityShape, ArenaShape> => (shape.type === "arena" ? arenaArc(shape) : shape)

// ---- the plan: what the generated boss holds ----

export const fixtureCount = (place: FixturePlace) => ("ring" in place ? place.ring.count : 1)

/** The fixture assets a boss's arena puts down, each once: the creature depends on every one of them, and the build compiles them. */
export const arenaFixtureIds = (boss: Pick<Boss, "arena"> | null | undefined) => [...new Set((boss?.arena?.fixtures ?? []).map((fixture) => fixture.look.asset))]

/** One placed fixture: which entry it comes of (and the asset it looks like), its own id, and where it stands in the arena's frame. */
export type PlacedFixture = { entry: number; id: string; asset: string; forward: number; left: number; use: ArenaFixture["use"]; clear: ArenaFixture["clear"] }

/**
 * Every fixture the arena puts down, in order, each where it stands in the arena's frame (a ring's first ahead of home, the rest round to its left), and the arena's middle
 * (the middle of them all; home when there are none). The generated boss's tables, the pictures and the checks read this one list.
 */
export function arenaPlan(arena: Pick<Arena, "fixtures">) {
  const fixtures = arena.fixtures.flatMap((fixture, entry): PlacedFixture[] => {
    const at = (forward: number, left: number, index: number | null): PlacedFixture => ({ entry, id: index === null ? fixture.id : `${fixture.id}_${index + 1}`, asset: fixture.look.asset, forward: num(forward, 4) || 0, left: num(left, 4) || 0, use: fixture.use, clear: fixture.clear })
    if (!("ring" in fixture.place)) return [at(fixture.place.forward, fixture.place.left, null)]
    const { count, radius } = fixture.place.ring
    return Array.from({ length: count }, (_, index) => at(radius * Math.cos((index * 2 * Math.PI) / count), radius * Math.sin((index * 2 * Math.PI) / count), count > 1 ? index : null))
  })
  const center = fixtures.length ? { forward: num(fixtures.reduce((sum, fixture) => sum + fixture.forward, 0) / fixtures.length, 4), left: num(fixtures.reduce((sum, fixture) => sum + fixture.left, 0) / fixtures.length, 4) } : { forward: 0, left: 0 }
  return { fixtures, center }
}
export type ArenaPlan = ReturnType<typeof arenaPlan>

/** Seconds as server ticks, never none. */
export const arenaTicks = (seconds: number) => Math.max(1, Math.round(seconds * TICKS))

// ---- what an ability writes ----

export const isLeave = (move: { type?: string }): move is LeaveMove => move.type === "leave"
export const abilityLeave = (ability: Pick<Ability, "moves">) => (ability.moves as readonly { type?: string }[]).find(isLeave) as LeaveMove | undefined
export const fogEvents = (ability: Pick<Ability, "events">) => ability.events.filter((event): event is FogEvent => event.type === "fog")
export const arenaHits = (ability: Pick<Ability, "hits">) => ability.hits.flatMap((hit, index) => (hit.type === "area" && hit.shape.type === "arena" ? [{ hit: hit as Extract<AbilityHit, { type: "area" }> & { shape: ArenaShape }, index }] : []))
/** True when anything of the abilities needs the arena's runtime: a fog event, a leave, a hit over the arena or at its middle, a thrown thing that falls on its middle. */
export const abilitiesUseArena = (abilities: readonly Pick<Ability, "events" | "moves" | "hits">[]) =>
  abilities.some(
    (ability) =>
      fogEvents(ability).length > 0 ||
      abilityLeave(ability) !== undefined ||
      ability.hits.some((hit) => (hit.type === "area" && (hit.shape.type === "arena" || hit.place === "center")) || (hit.type === "projectile" && "sky" in hit.from && hit.from.sky.over === "center")),
  )
/** True when the boss has anything of an arena: fixtures, a fog, or an ability that needs its runtime. */
export const bossArena = (boss: Pick<Boss, "arena"> | null | undefined, abilities: readonly Pick<Ability, "events" | "moves" | "hits">[] = []) => Boolean(boss && (boss.arena || abilitiesUseArena(abilities)))

// ---- words ----

const placeWords = (fixture: ArenaFixture) =>
  "ring" in fixture.place
    ? `以家为中心、半径 ${num(fixture.place.ring.radius)} 格的一圈上均匀放 ${fixture.place.ring.count} 座（第一座在它面前）`
    : `家${fixture.place.forward >= 0 ? "前" : "后"}方 ${num(Math.abs(fixture.place.forward))} 格、${fixture.place.left >= 0 ? "左" : "右"}边 ${num(Math.abs(fixture.place.left))} 格`

/** 「场地上有 4 座「指南车」……雾：……」: the arena in words, appended to the boss's own. */
export function arenaWords(arena: Arena, title?: (fixture: ArenaFixture) => string) {
  return arenaLines(arena, title).join("")
}

export function arenaLines(arena: Arena, title?: (fixture: ArenaFixture) => string) {
  const plan = arenaPlan(arena)
  const fixtures = arena.fixtures.map(
    (fixture) =>
      ((use) => `「${title ? title(fixture) : fixture.id}」${placeWords(fixture)}：${!use ? "玩家点不亮它（右键、近战、射箭都没用），只跟着招式和演出亮" : `玩家对着它${use.by === "hit" ? "近战或射箭" : use.seconds > 0 ? `按住右键 ${num(use.seconds)} 秒` : "点一下右键"}点亮`}，${use?.lit_seconds === null ? "保持到下次动作" : `亮 ${num(use?.lit_seconds ?? fixture.clear.seconds)} 秒`}，以它为中心 ${num(fixture.clear.radius)} 格内没有雾${fixture.light !== undefined || fixture.ember_light !== undefined ? `，亮着时方块光照 ${fixture.light ?? 0} 级，余烬 ${fixture.ember_light ?? 0} 级` : ""}${use && use.cooldown > 0 ? `；熄了以后 ${num(use.cooldown)} 秒才能再点` : ""}`)(fixture.use),
  )
  const fog = arena.fog
  return [
    plan.fixtures.length ? `它醒来时在家周围的地面上摆好 ${plan.fixtures.length} 座场地物件（按它醒来时面朝的方向摆，转到最近的东南西北），战斗结束或离开重置时收走：${fixtures.join("；")}。` : "",
    fog
      ? `招式可以让场地起雾，${num(fog.fade_seconds)} 秒里压到${fog.fade_end === undefined ? `只看得见 ${num(fog.visibility)} 格` : `从 ${num(fog.visibility * 0.2)} 格开始变浓，到 ${num(fog.fade_end)} 格完全遮挡`}；只有战斗范围（家周围 ${ARENA_LIMITS.radius} 格）里、不在任何一座亮着的物件清晰区里的玩家在雾里，每个玩家各算各的。雾里的玩家挨它的伤害乘 ${num(fog.boss_damage)}，打它的伤害乘 ${num(fog.damage_taken)}；发光的部位仍可能因距离或遮挡看不清，地面预警、效果和粒子会随雾变淡。${FOG_LIFTS[fog.lift]}${fog.lift === "all_lit_once" && plan.fixtures.length ? `（${plan.fixtures.length} 座都亮过）` : ""}。`
      : "",
  ].filter(Boolean)
}

/** 「第 1 秒起雾」 */
export const fogEventWords = (event: FogEvent) => `第 ${num(event.at)} 秒起雾（场地上的雾开始压下来）`

export function returnPlaceWords(place: LeaveMove["back"]["place"]) {
  if (typeof place === "string") return LEAVE_PLACES[place]
  return `目标附近（按它面朝的方向，向前 ${place.forward.join(" 到 ")} 格、向左 ${place.left.join(" 到 ")} 格；负数表示后方或右方）`
}

/** 「第 0.5 秒升到半空 16 格消失，第 7 秒落回场地正中」 */
export const leaveWords = (move: LeaveMove) =>
  `第 ${num(move.at)} 秒升到半空 ${num(move.rise)} 格消失（这段时间看不见、打不到、不会被当成目标，血条还在），第 ${num(move.back.at)} 秒落回${returnPlaceWords(move.back.place)}`

/** 「亮着的物件周围 6 格内安全」 */
export const safeWords = (safe: ArenaSafe) =>
  safe.around === "lit_fixtures" ? `亮着的场地物件周围 ${num(safe.radius)} 格内的人不受伤` : `场地上 ${safe.around.points.length} 个安全点（${safe.around.points.map((point) => `前 ${num(point.forward)}、左 ${num(point.left)}`).join("；")}）周围 ${num(safe.radius)} 格内的人不受伤`

/** 「整个场地（中间周围 32 格，高 -2 到 6 格）」 */
export const arenaShapeWords = (shape: Pick<ArenaShape, "low" | "high">) => `整个场地（场地正中周围 ${ARENA_LIMITS.radius} 格，离地 ${num(shape.low)} 到 ${num(shape.high)} 格）`

/**
 * Which stages of the fight can raise the fog: the stages (0 before any line) whose abilities include one with a fog event, as the phases' rules say (`bossPhaseIds`).
 * The reviewer reads it ("起雾这招在哪些阶段能出").
 */
export function fogStages(boss: Pick<Boss, "phases">, abilities: readonly Pick<Ability, "id" | "events">[], combos: readonly { id: string; steps: readonly string[] }[] = []) {
  const ids = [...abilities.map((ability) => ability.id), ...combos.map((combo) => combo.id)]
  const fogs = new Set(abilities.filter((ability) => fogEvents(ability).length).map((ability) => ability.id))
  combos.forEach((combo) => combo.steps.some((step) => fogs.has(step)) && fogs.add(combo.id))
  return bossPhaseIds(boss.phases, ids).flatMap((stage, index) => (stage.some((id) => fogs.has(id)) ? [index] : []))
}

// ---- what is refused, and what is said ----

type Found = { path: (string | number)[]; message: string }

/**
 * What the document cannot have, each with where it is (the creature document's own check adds them): a fog event without a fog, a leave, a hit over the arena or at its middle,
 * or a safe ground round lit fixtures without what they need; a leave that comes back before it left or after its ability; two leaves in one ability; a flier leaving the field.
 */
export function arenaDocumentIssues(creature: { behavior: string; boss?: Pick<Boss, "arena"> | null; flight?: unknown; abilities?: readonly Pick<Ability, "name" | "events" | "moves" | "hits" | "length">[] | null }) {
  const found: Found[] = []
  const boss = creature.behavior === "hostile" ? (creature.boss ?? null) : null
  const arena = boss?.arena ?? null
  const fixtures = arena ? arenaPlan(arena).fixtures.length : 0
  ;(creature.abilities ?? []).forEach((ability, index) => {
    const at = (...path: (string | number)[]) => ["abilities", index, ...path]
    ability.events.forEach((event, place) => {
      if (event.type !== "fog") return
      if (!boss) found.push({ path: at("events", place), message: `招式「${ability.name}」的起雾（fog）只有 Boss 能用：雾是 Boss 场地（boss.arena）的一部分` })
      else if (!arena?.fog) found.push({ path: at("events", place), message: `招式「${ability.name}」要起雾（fog），可是 boss.arena 没有写 fog（雾多浓、雾里伤害怎么算、怎么退）。先写 boss.arena.fog，或者去掉这个事件` })
    })
    const leaves = (ability.moves as readonly { type?: string }[]).flatMap((move, place) => (isLeave(move) ? [{ move, place }] : []))
    leaves.slice(1).forEach(({ place }) => found.push({ path: at("moves", place), message: `一个招式最多离场一次（type:"leave"）：「${ability.name}」写了 ${leaves.length} 次` }))
    leaves.forEach(({ move, place }) => {
      if (!boss) found.push({ path: at("moves", place), message: `招式「${ability.name}」的离场（leave）只有 Boss 能用` })
      if (creature.flight) found.push({ path: at("moves", place), message: `会飞的 Boss（写了 flight）现在还不能离场（leave）：它在天上的位置由飞行管，两样会打架。去掉 leave，或者去掉 flight` })
      if (move.back.at <= move.at + 1e-9) found.push({ path: at("moves", place, "back", "at"), message: `离场以后落回来的时刻（back.at，第 ${move.back.at} 秒）要比离开（at，第 ${move.at} 秒）晚` })
      if (move.at > ability.length + 1e-9 || move.back.at > ability.length + 1e-9) found.push({ path: at("moves", place, "back", "at"), message: `离场（at）和落回来（back.at）都要在招式里面（第 ${ability.length} 秒以前）：它离场的这段时间就是这一招在出` })
      if (move.back.place === "near_target" && !boss) return
    })
    ability.hits.forEach((hit, place) => {
      if (hit.type === "area" && hit.shape.type === "arena") {
        if (!boss) found.push({ path: at("hits", place, "shape"), message: `招式「${ability.name}」第 ${place + 1} 次出手打整个场地（shape: arena），只有 Boss 有场地` })
        if (hit.place !== undefined && hit.place !== "center") found.push({ path: at("hits", place, "place"), message: `打整个场地的那一下（shape: arena）总是以场地正中为中心：place 不写，或者写 "center"` })
        if (hit.bone !== undefined) found.push({ path: at("hits", place, "bone"), message: `打整个场地的那一下（shape: arena）不从身上的部件算，不能写 bone` })
        if (hit.shape.low >= hit.shape.high) found.push({ path: at("hits", place, "shape", "high"), message: "整个场地那一下的上沿（high）要比下沿（low）高" })
      }
      if (hit.type === "area" && hit.place === "center" && !boss) found.push({ path: at("hits", place, "place"), message: `招式「${ability.name}」第 ${place + 1} 次出手落在场地正中（place: "center"），只有 Boss 有场地` })
      if (hit.type === "projectile" && "sky" in hit.from && hit.from.sky.over === "center" && !boss) found.push({ path: at("hits", place, "from", "sky", "over"), message: `招式「${ability.name}」第 ${place + 1} 次从天上落到场地正中（over: "center"），只有 Boss 有场地` })
      if (hit.type === "area" && hit.safe) {
        if (hit.shape.type !== "arena") found.push({ path: at("hits", place, "safe"), message: `安全区（safe）只写在打整个场地的那一下上（shape: {"type":"arena"}）` })
        if (hit.safe.around === "lit_fixtures" && !fixtures) found.push({ path: at("hits", place, "safe", "around"), message: `安全区写的是亮着的物件周围（lit_fixtures），可是 boss.arena 里没有场地物件：要么给场地加物件，要么用 points 写固定的安全点` })
      }
    })
  })
  return found
}

/** One thing the reviewer is told of an arena, by rule; `stops` only for what cannot be played as written. */
export type ArenaIssue = { refs?: import("@minemods/studio-ai/acceptance").FindingRef[]; rule: "boss_arena"; stops: boolean; text: string; fix: string; detail: string }

/**
 * What of the arena will not play the way it reads, measured on the plan: a fixture outside the fight's range, clear grounds that overlap or cover most of the arena, a clear
 * ground smaller than what can be seen in the fog anyway, a fog no ability raises (and the stages that can raise it), a fog that never lifts by fixtures, a hit over the arena
 * that nobody is warned of, or whose safe places cannot exist when it lands.
 */
export function arenaReviewIssues(creature: { name: string; boss?: Pick<Boss, "arena" | "phases"> | null; abilities?: readonly Ability[] | null; combos?: readonly { id: string; steps: readonly string[] }[] | null; stagger?: import("./combat").Stagger; shared_abilities?: readonly { id: string; asset: string; start: Ability["start"] }[] | null }): ArenaIssue[] {
  const boss = creature.boss
  const arena = boss?.arena
  // What it is handed may be only the abilities' ids (a check that has not read their hits and events): then nothing is said of what they do.
  const given = (creature.abilities ?? []) as readonly Partial<Ability>[]
  const full = given.every((ability) => Array.isArray(ability.events) && Array.isArray(ability.hits))
  const abilities = full ? (given as readonly Ability[]) : []
  const said: ArenaIssue[] = fixtureReview({...creature, abilities, combos: (creature.combos ?? []).filter((combo): combo is import("./entity-runtime").Combo => "start" in combo)})
  const say = (stops: boolean, text: string, fix: string, detail: string, refs: import("@minemods/studio-ai/acceptance").FindingRef[] = []) => said.push({ rule: "boss_arena", stops, text: `「${creature.name}」${text}`, fix, detail, ...(refs.length ? { refs } : {}) })
  if (!boss) return said
  const plan = arena ? arenaPlan(arena) : null
  const range = ARENA_LIMITS.radius
  const placement = (fixture: PlacedFixture) => fixtureRef(arena!.fixtures[fixture.entry]!.id, fixture.id)
  plan?.fixtures.forEach((fixture) => {
    const far = Math.hypot(fixture.forward, fixture.left)
    if (far > range - 2) say(false, `的场地物件「${fixture.id}」离家 ${num(far, 1)} 格，在战斗范围（${range} 格）的边上或外面：玩家跑去点它就出了战斗范围，雾和伤害倍数都不算了。`, `把它摆近一些（离家 ${range - 4} 格以内）。`, `fixture ${fixture.id} at ${num(far, 1)} blocks; battle range ${range}`, [placement(fixture)])
  })
  if (plan) {
    for (let a = 0; a < plan.fixtures.length; a++)
      for (let b = a + 1; b < plan.fixtures.length; b++) {
        const one = plan.fixtures[a]!
        const two = plan.fixtures[b]!
        const apart = Math.hypot(one.forward - two.forward, one.left - two.left)
        if (apart < one.clear.radius + two.clear.radius - 1e-9)
          say(false, `的物件「${one.id}」和「${two.id}」相隔 ${num(apart, 1)} 格，两块清晰区（半径 ${num(one.clear.radius)}、${num(two.clear.radius)}）叠在一起：点亮一座就够两座的地方用，跑位少了一半。`, "把它们摆开一些，或者把 clear.radius 改小。", `fixtures ${one.id}, ${two.id} apart ${num(apart, 1)}`, [placement(one), placement(two)])
      }
    const covered = arenaCoverage(plan)
    if (plan.fixtures.length && covered > 0.6)
      say(false, `的物件全亮的时候，清晰区盖住了战斗范围的 ${Math.round(covered * 100)}%：雾几乎起不了作用。`, "把 clear.radius 改小，或者少摆几座。", `clear grounds cover ${Math.round(covered * 100)}% of the arena`)
    const fog = arena!.fog
    if (fog)
      plan.fixtures.forEach((fixture) => {
        if (fixture.clear.radius <= fog.visibility + 1e-9)
          say(false, `的物件「${fixture.id}」清出来的地方（半径 ${num(fixture.clear.radius)} 格）还没有雾里本来看得见的远（${num(fog.visibility)} 格）：点亮它看起来没什么变化。`, `把 clear.radius 改到 ${Math.ceil(fog.visibility * 2)} 格左右，或者把雾的 visibility 改小。`, `clear ${fixture.clear.radius} <= visibility ${fog.visibility}`, [placement(fixture)])
      })
    if (fog && fog.lift === "all_lit_once" && !plan.fixtures.length) say(false, "的雾写着「每座物件都亮过就退」（lift: all_lit_once），可是场地上没有物件：雾一起来就要等到这场战斗结束。", '给场地加物件，或者把 lift 写成 "never" 说明白。', "lift all_lit_once without fixtures")
  }
  if (arena?.fog && full) {
    const stages = fogStages(boss, abilities, creature.combos ?? [])
    const names = (stage: number) => (stage === 0 ? "第一阶段" : `第 ${stage + 1} 阶段`)
    if (!stages.length) say(false, "的场地写了雾（boss.arena.fog），可是没有一个它能出的招式会起雾（fog 事件）：雾永远不会来。", "给一个招式加 {\"type\":\"fog\",\"at\":…} 事件，并让它在该出的阶段能用。", "no ability with a fog event in any stage")
    else say(false, `能起雾的招式在${stages.map(names).join("、")}能出（起雾这一招照它的冷却、权重和阶段来）。`, "这是告诉你的事实；不对就改阶段的 abilities / add。", `fog stages: ${stages.join(", ")}`, stages.map((stage) => phaseRef(stage + 1)))
  }
  abilities.forEach((ability) => {
    arenaHits(ability).forEach(({ hit, index }) => {
      if (!hit.warn) say(false, `的招式「${ability.name}」第 ${index + 1} 次出手打整个场地，可是没有预警：玩家不知道什么时候该往安全的地方跑。`, "给这一下写 warn（最长 3 秒），并把离场的时间留够：跑到安全区要几秒。", `ability ${ability.id} hit ${index}: arena without warn`, [abilityRef(ability)])
      if (hit.safe?.around === "lit_fixtures" && plan && !plan.fixtures.length) say(true, `的招式「${ability.name}」第 ${index + 1} 次出手的安全区在亮着的物件周围，可是场地上没有物件。`, "给场地加物件，或者用 points 写固定的安全点。", "safe lit_fixtures without fixtures", [abilityRef(ability)])
      if (!hit.safe && hit.damage > 0) say(false, `的招式「${ability.name}」第 ${index + 1} 次出手打整个场地却没有安全区（safe）：场上每个人都躲不开。`, "写 safe（亮着的物件周围，或者几个固定的点）。", `ability ${ability.id} hit ${index}: arena without safe`, [abilityRef(ability)])
    })
  })
  return said
}

/** The share of the fight's range (a disc of `ARENA_LIMITS.radius` round the arena's middle) that the clear grounds of all fixtures cover when all are lit, by a grid of half blocks. */
export function arenaCoverage(plan: ArenaPlan) {
  const range = ARENA_LIMITS.radius
  let inside = 0
  let clear = 0
  for (let x = -range; x <= range; x += 0.5)
    for (let z = -range; z <= range; z += 0.5) {
      if (Math.hypot(x - plan.center.forward, z - plan.center.left) > range) continue
      inside++
      if (plan.fixtures.some((fixture) => Math.hypot(x - fixture.forward, z - fixture.left) <= fixture.clear.radius)) clear++
    }
  return inside ? clear / inside : 0
}

// ---- for whoever writes a creature document ----

/** What an AI is told about the arena (appended to the boss's instructions). */
export const FIXTURE_CONTROL_INSTRUCTIONS = "物件组可写 light（亮着时的方块光照 0–15）与 ember_light（余烬时低于亮灯的光照，默认 0）。光源占用灯脚的普通空气，地面、液体和其他方块保留。物件依附 Boss 提供的场地，当前不能创建独立开关房。use.by 默认 hold（seconds:0 仍为右键一下）；hit 接受玩家近战、归属玩家的箭，不接受同阵营。use.lit_seconds 省略沿用 clear.seconds，0.05–3600 是独立亮灯秒数，null 持续到下个动作。没亮和余烬都不算灯、不清雾。招式 events、登场和死亡 steps 可写 {type:'fixture',at,do:'light'|'douse'|'ember',which,every_seconds?}；阶段 finish 不写 at，breaks.result.fixture 只填 do、which 和间隔。which 可写 all、nearest（相对施放者，同距取摆放顺序靠前的）、{group:'组名'}、{instance:'组名_1'} 或这些点名对象的数组。环形从前方起向左数。{in_hit:0} 取本招第 1 次范围出手当时罩住的物件。按物件本身的范围计算，脚下、旁边和路径上的方块都不会挡住物件；玩家和生物仍按 blocked_by_walls 检查视线。已有隔墙受阻的出手要让物件沿用旧判定，给这次出手另加 fixture_walls:true。顺序按场地展开顺序；招式收招或被打断时取消余下步骤。stagger.when、start.when、start.weight_when 可写 {if:'fixtures_lit',count:2,within_arc:90}，权重另写 scale。数当前不同亮灯，身体朝向左右各占总角的一半，含边缘；硬直在条件刚成立时触发。范围出手、落雷与投射物可写 place:{fixture:'lit_nearest'|'lit_random'}，天降也可写在 from.sky.over；无灯不出招，有预警时锁定落点。"
export const ARENA_INSTRUCTIONS = FIXTURE_CONTROL_INSTRUCTIONS +
  ` arena（可选，场地物件和雾，例如「雾和指南车」）：{fixtures, fog}。fixtures：最多 ${ARENA_LIMITS.entries} 组、一共最多 ${ARENA_LIMITS.fixtures} 座，[{id, look:{asset: 场地物件资产的 UUID}, place, use?:{seconds ${ARENA_LIMITS.use.seconds.min}–${ARENA_LIMITS.use.seconds.max}, cooldown ${ARENA_LIMITS.use.cooldown.min}–${ARENA_LIMITS.use.cooldown.max}, by?, lit_seconds?}, clear:{radius ${ARENA_LIMITS.clear.radius.min}–${ARENA_LIMITS.clear.radius.max}, seconds ${ARENA_LIMITS.clear.seconds.min}–${ARENA_LIMITS.clear.seconds.max}}, light?, ember_light?}]（带问号的可选，写法见这一段开头）——Boss 醒来（开始登场）时，在它的家（出生的地方；有巢就是巢的中心）周围找地面把物件摆好（上下 ${ARENA_LIMITS.ground.up}/${ARENA_LIMITS.ground.down} 格内找不到能站的地面就跳过那一座，日志里会写），战斗结束、离开重置时收走；物件打不坏、推不动、不存盘。place 写 {forward, left}（家前方、左边多少格，负数是后方、右边）或者 {ring:{count, radius}}（以家为中心半径 radius 格的一圈上均匀摆 count 座，第一座在正前方）；前方是它醒来时面朝的方向，转到最近的东南西北。默认按住右键 use.seconds 秒点亮（0 是点一下；按住的进度在屏幕下方显示）。use.by 为 hit 时改由有效命中点亮。不写 use 的物件玩家点不亮（右键、近战、射箭都不响应），只跟着招式、登场、死亡和阶段里的 fixture 步骤亮和熄，这时要有这样的步骤去点亮它。灯亮时 clear.radius 格内没有雾；未写 use.lit_seconds 时亮 clear.seconds 秒，熄灯后等 cooldown 秒才能再次互动。物件的样子是一个「场地物件」资产（look.asset，生物要依赖它）：没点亮和点亮各有一个动作，也可指定余烬动作和发光部分。` +
  ` fog：null，或 {visibility ${ARENA_LIMITS.fog.visibility.min}–${ARENA_LIMITS.fog.visibility.max}, fade_seconds ${ARENA_LIMITS.fog.fade.min}–${ARENA_LIMITS.fog.fade.max}, fade_end?（visibility 至 ${ARENA_LIMITS.fog.fade_end.max} 格）, boss_damage ${ARENA_LIMITS.fog.boss_damage.min}–${ARENA_LIMITS.fog.boss_damage.max}, damage_taken ${ARENA_LIMITS.fog.damage_taken.min}–${ARENA_LIMITS.fog.damage_taken.max}, lift: ${Object.keys(FOG_LIFTS).join("|")}}——雾由它招式里的 fog 事件 {type:"fog", at} 起（所以起雾照那一招的冷却、权重和阶段来，比如只在二阶段以后），fade_seconds 秒里雾渐浓，完全遮挡距离默认为 visibility。可选 fade_end 独立延长完全遮挡距离，雾仍从 visibility 的 20% 处开始变浓。比如 visibility: 10、fade_end: 36，近处开始起雾，24 格外的轮廓和预警比较容易辨认。只有战斗范围（家周围 ${ARENA_LIMITS.radius} 格）里的玩家受影响，每个玩家各算各的：不在任何一座亮着的物件的清晰区里，就在雾里；清晰区的边上有一圈雾气，从外面也看得出哪里是亮区。雾里的玩家挨它的伤害（招式、近战、投射物）乘 boss_damage，雾里的玩家打它的伤害乘 damage_taken。模型的发光层可减弱场地雾的影响，仍受当前阶段、遮挡和渲染距离影响。地面预警圈、效果资产和粒子依然会随雾变淡。想让玩家在较远处读到预警，可以提高 fade_end，并在目标版本进游戏看一遍。lift：${Object.entries(FOG_LIFTS).map(([key, words]) => `${key}（${words}）`).join("、")}。用自己的血条资产时，血条下面那一排小点（dots）显示亮过几座；原版血条在名字后面写「（亮过的/一共）」。` +
  ` 例（雾和指南车）：{"arena":{"fixtures":[{"id":"compass","look":{"asset":"<场地物件的 UUID>"},"place":{"ring":{"count":4,"radius":14}},"use":{"seconds":2,"cooldown":10},"clear":{"radius":12,"seconds":20}}],"fog":{"visibility":6,"fade_seconds":3,"boss_damage":1.5,"damage_taken":0.5,"lift":"all_lit_once"}}}。`

/** What an AI is told about the fog event, the leave move, a hit over the arena, its safe places, the arena's middle and a thrown thing's size (appended to the ability's instructions). */
export const ARENA_ABILITY_INSTRUCTIONS =
  ` Boss 的场地（boss.arena）还给招式这几样：events 里的起雾 {type:"fog", at}（boss.arena 要写 fog）；moves 里的离场 {type:"leave", at, rise ${ARENA_LIMITS.rise.min}–${ARENA_LIMITS.rise.max}, back:{at, place: ${Object.keys(LEAVE_PLACES).join("|")}}}——第 at 秒它升到半空 rise 格消失，这段时间看不见、打不到、不会被任何东西当成目标，血条还在，第 back.at 秒落回 ${Object.entries(LEAVE_PLACES).map(([key, words]) => `${key}（${words}）`).join("、")}。back.place 也可写 {forward:[2,3],left:[0,0]}，即目标身前 2–3 格；两轴各填从小到大的两个数（−32 到 32 格），负数表示后或右。回场时按目标当时的朝向在范围内抽点，找地面并检查整个身体能否站下，最多尝试 12 次；目标丢失或都站不下时回家。at 和 back.at 都在招式里面（招式最长 ${ABILITY_LIMITS.seconds} 秒），这一招被打断、离开重置或者它死了，它都立刻回到家里；每招最多离场一次，会飞的 Boss 不能离场。` +
  ` 范围出手的 shape 可以写 {type:"arena", low, high}：打整个场地（场地正中周围 ${ARENA_LIMITS.radius} 格、离地 low 到 high 格），总是以场地正中为中心（place 不写）；加 safe:{around: "lit_fixtures" 或 {points:[{forward, left}]}, radius ${ARENA_LIMITS.safe.radius.min}–${ARENA_LIMITS.safe.radius.max}}，站在亮着的物件（或者这几个点，按场地的方向算）周围 radius 格内的人不受这一下的伤。打整个场地的那一下要写 warn（预警画在整个场地上），留够跑到安全区的时间。范围出手、落雷的 place 和投射物天上落的 over 还可以写 "center"：场地正中（物件围成的那一圈的中间，没有物件就是家）。` +
  ` 投射物可以写 size ${ARENA_LIMITS.size.min}–${ARENA_LIMITS.size.max}（不写是 1）：按这个倍数放大它的样子（效果资产或自己的部件），伤害范围仍按 radius。离场时它不在场上，招式的 events 放不到彗星落下的地方：彗星砸下来的那一下炸开、冒烟、震屏，写在投射物的 impact 里。` +
  ` 例（涿鹿）：moves:[{"type":"leave","at":0.5,"rise":20,"back":{"at":8,"place":"center"}}]，hits:[{"type":"projectile","at":6,"look":{"effect":"<彗星效果的 UUID>"},"size":4,"from":{"sky":{"over":"center","height":30}},"speed":1.5,"gravity":0.05,"path":"straight","damage":0,"knockback":0,"effects":[],"radius":0,"warn":{"seconds":3,"look":"pillar","color":"red"},"impact":{"effect":"<落地炸开的效果的 UUID>","particle":"explosion","count":24,"spread":3,"shake":{"strength":4,"radius":32,"seconds":1.5}}},{"type":"area","at":7,"shape":{"type":"arena","low":-2,"high":8},"hits":"everyone","damage":40,"knockback":2,"effects":[],"warn":{"seconds":3,"look":"ring","color":"red"},"safe":{"around":"lit_fixtures","radius":6}}]。`

export const ARENA_SUMMARY = "场地物件可命中点亮、定时或保持，招式和演出能切换熄灭、点亮、余烬。亮灯数量可触发硬直、限制选招和改变权重，可指名打亮着的物件。仅支持 Boss 场地。" + "Boss 的场地（boss.arena）：醒来时在家周围摆好的场地物件（场地物件资产，玩家点亮，周围一圈清掉雾），招式起的雾（每个玩家各算各的，雾里伤害有倍数，fade_end 可延长预警和场景轮廓的可见距离），离场（leave：升上半空消失，过一会儿落回来），打整个场地的一下（shape: arena）和安全区（safe：亮着的物件或固定的点周围）。"
