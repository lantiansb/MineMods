import { HIT_PLACE_LIMITS } from "./ability-words"
import type { Ability, AbilityEvent, AbilityHit, Boss, BossWeather, HitPlace, LightningEvent } from "./entity-runtime"
import { LIGHTNING_LIMITS, WEATHER_LIMITS } from "./weather-words"

/**
 * Boss 能力 7 (天气、天色和落雷) between the document and everything that reads it: the weather of each stage of a fight (`bossWeatherPlan`, what the
 * generated boss holds), an ability's lightning as the area hits it lands as (`struckAbility`: the same places, warnings, victims and damage as Boss 能力 3's hits,
 * so the pictures, the checks and the generated Java of a lightning are those of a hit by construction), and all of it in plain words.
 * Nothing here knows a subject: every sentence is made from the numbers of the document. No Node APIs: the app's window reads it too.
 */

const num = (value: number, digits = 2) => Number(value.toFixed(digits))

// ---- a phase's weather ----

/**
 * Per stage of the fight, the weather its players see: stage 0 is before any line of life is crossed (the world's own, null), stage n the one `phases[n - 1]` begins;
 * a phase that writes none keeps the stage before's.
 */
export function bossWeatherPlan(boss: Pick<Boss, "phases">): (BossWeather | null)[] {
  return boss.phases.reduce<(BossWeather | null)[]>((stages, phase) => [...stages, phase.weather ?? stages[stages.length - 1]!], [null])
}

/** True when some phase of the boss writes a weather: only then does the generated boss carry any of it. */
export const bossWeathers = (boss: Pick<Boss, "phases"> | null | undefined) => Boolean(boss?.phases.some((phase) => phase.weather !== undefined))

/** 「下起雷雨，天色暗到 60%」: one weather in words. */
export const weatherWords = (weather: BossWeather) =>
  `${weather.thunder ? "下起雷雨" : weather.rain ? "下起雨（会下雪的地方是雪）" : "不下雨（世界在下雨也一样）"}${weather.dark > 0 ? `，天色压暗 ${num(weather.dark * 100, 0)}%` : ""}`

/** 「，这场战斗里的玩家看到天上下起雷雨……」: what a phase's weather says, appended to the phase's own sentence; empty for a phase that writes none. */
export const phaseWeatherWords = (phase: Pick<Boss["phases"][number], "weather">) =>
  phase.weather ? `，只有这场战斗里的玩家看到天气变了：${weatherWords(phase.weather)}（世界真实的天气不变，${num(WEATHER_LIMITS.ramp / 20, 1)} 秒里慢慢变过去，离开战斗或者战斗结束就恢复）` : ""

// ---- an ability's lightning ----

type AreaHit = Extract<AbilityHit, { type: "area" }>
/** A lightning event as the area hit it lands as; `lightning` is where the event stands in its ability's events. */
export type LightningHit = AreaHit & { lightning: number; lightningLook?: LightningEvent["look"] }
/** An ability event that is not a lightning: what an ability's events are once its lightning has become hits (`struckAbility`). */
export type PlainEvent = Exclude<AbilityEvent, { type: "lightning" }>
/** An ability whose lightning has become hits: its own hits first, as written, then one per lightning, and the rest of its events. */
export type StruckAbility = Omit<Ability, "events"> & { events: PlainEvent[] }

export const isLightningHit = (hit: AbilityHit): hit is LightningHit => typeof (hit as { lightning?: unknown }).lightning === "number"

/** The ability's lightning events, each with where it stands in its events. */
export const lightningEvents = (ability: Pick<Ability, "events">) => ability.events.flatMap((event, index) => (event.type === "lightning" ? [{ event, index }] : []))

/** The column a bolt strikes: a full circle of `radius` round its place, from a block below it to four above (an arc that goes all the way round is what a hit put down elsewhere may be). */
export const lightningShape = (radius: number) => ({ type: "arc" as const, reach: radius, angle: 360, low: LIGHTNING_LIMITS.low, high: LIGHTNING_LIMITS.high })

/**
 * One lightning as an area hit: everyone but the creature and its own kind within its column at its places, struck for its damage, pushed by nothing, at places decided
 * when its warning begins or when it lands. "self" is written as the one place of a pattern at its feet, so it is decided once and kept (a hit round itself is checked where it stands).
 */
export function lightningHit(event: LightningEvent, index: number): LightningHit {
  const place: HitPlace = event.place === "self" ? { type: "pattern", points: [{ forward: 0, left: 0 }] } : event.place
  return { type: "area", at: event.at, shape: lightningShape(event.radius), hits: "everyone", damage: event.damage, knockback: 0, effects: [], place, ...(event.warn ? { warn: event.warn } : {}), lightning: index, ...(event.look ? {lightningLook:event.look} : {}) }
}

/**
 * The ability with its lightning landed as hits (`lightningHit`), after the hits it writes, and its lightning taken out of its events. The very same ability when it has none,
 * so anything made from an ability without lightning is what it always was, to the byte.
 */
export function struckAbility(ability: Ability): StruckAbility {
  const strikes = lightningEvents(ability)
  if (!strikes.length) return ability as StruckAbility
  return { ...ability, hits: [...ability.hits, ...strikes.map(({ event, index }) => lightningHit(event, index))], events: ability.events.filter((event): event is PlainEvent => event.type !== "lightning") }
}

/** The lightning a struck ability's hit `index` lands, when it is one. */
export const strikeOf = (ability: Pick<Ability, "events">, hit: AbilityHit) => (isLightningHit(hit) ? (ability.events[hit.lightning] as LightningEvent | undefined) ?? null : null)

/**
 * 「第 1.2 秒在目标脚下落雷（提前 1 秒……；半径 2 格里……掉 8 点血）」: one lightning in words. `place` and `warn` are said by the words every area hit's place and warning are said with.
 */
export const lightningWords = (event: LightningEvent, place: string, warn: string | null) =>
  `第 ${num(event.at)} 秒在${place}${event.place === "target" || event.place === "self" ? "" : "各"}落一道雷（${warn ? `${warn}；` : ""}半径 ${num(event.radius)} 格里除了它自己和同类以外的生物${event.damage > 0 ? `掉 ${num(event.damage)} 点血` : "不掉血"}，几道雷劈到同一个也只算一次；只有闪电的样子和雷声，不点火、不改方块）`

// ---- for whoever writes a creature document ----

/** What an AI is told about a phase's weather (appended to the boss's instructions). */
export const BOSS_WEATHER_INSTRUCTIONS =
  ` 每个阶段还可以写 weather（可选）：{rain, thunder, dark ${WEATHER_LIMITS.dark.min}–${WEATHER_LIMITS.dark.max}}——从这个阶段的变身开始，只有这场战斗里的玩家（看得到它血条的玩家）看到的天气：rain 下雨（会下雪的地方下雪）；thunder 是雷雨的暗天和大雨（要和 rain 一起写；真的闪电用招式的 lightning 事件劈）；dark 是他们的天空和整个画面暗多少，0 不暗，1 和原版 Boss 把天压暗到最深时一样、天空几乎全黑（写了 bar.darken_sky 的，不会比原版压暗更亮）。世界真实的天气不变，不在战斗里的玩家看到的还是原来的天气。不写 weather 就沿用上一阶段的（第一阶段是世界本来的天气）；想在后面的阶段雨停，就写 {"rain":false,"thunder":false,"dark":0}，这时战斗里的玩家看到的是不下雨，就算世界在下雨。天气在 ${num(WEATHER_LIMITS.ramp / 20, 1)} 秒里慢慢变过去；玩家离开战斗、下线、换维度，Boss 死了、离开重置、睡回去，都在 ${num(WEATHER_LIMITS.ramp / 20, 1)} 秒里恢复成世界真实的天气。例：{"below":0.5,"clip":"enrage","seconds":2,"bar_color":"red","speed":1.2,"damage":1.4,"weather":{"rain":true,"thunder":true,"dark":0.6}}。`

/** What an AI is told about a lightning event (appended to the events of an ability). */
export const LIGHTNING_INSTRUCTIONS =
  ` 或者落雷 {type:"lightning", at, place, warn, damage, radius ${LIGHTNING_LIMITS.radius.min}–${LIGHTNING_LIMITS.radius.max}}：到 at 那一刻在 place 的每个落点劈下一道闪电。place 的写法和范围出手的 place 一样（"self"、"target"、{type:"around_target", count, spread}、{type:"pattern", points}，最多 ${Math.max(HIT_PLACE_LIMITS.count, HIT_PLACE_LIMITS.points)} 个落点），落点同样由服务端在预警开始（没有预警就是落雷）那一刻定下，之后谁怎么动都不改；以落点为中心半径 radius 格、落点往下 ${-LIGHTNING_LIMITS.low} 格到往上 ${LIGHTNING_LIMITS.high} 格的柱子里，除了它自己和同类以外的生物（创造模式的玩家除外）各挨 damage 点伤害，几道雷劈到同一个也只算一次，伤害照样乘 Boss 阶段的倍数。省略 look 使用原版的画面和雷声：不点火、不改方块、劈不出闪电苦力怕和女巫。warn 可以不写，写法和范围出手的 warn 一样（look 写 pillar 就是地上一圈加一道光柱，范围就是这根柱子），预警最早在招式开始时出现；at 不能早于 windup。打在目标脚下的落雷要写预警、留够躲开的时间，否则玩家只能硬吃，检查会说出来。六道雷先后落下，各写一条 lightning，在 look 里一起选粒子、声音和闪形，再各写一条同刻的 shake，共 12 个事件，24 个位置还剩 12 个。六处同时落雷可用同一组落点，再加一次震屏，共 2 个事件。`
