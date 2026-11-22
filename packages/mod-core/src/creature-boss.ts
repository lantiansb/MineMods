import { abilityRef, assetRef, clipRef, phaseRef } from "./finding-refs"
import { CINEMATIC_INSTRUCTIONS } from "./cinematic"
import { motionName } from "@minemods/studio-ai/making"
import { ABILITY_SOUNDS, TICKS } from "./ability-words"
import { BOSS_BAR_COLORS, BOSS_BAR_STYLES, BOSS_LIMITS, BREAK_LIMITS, DEBRIS_LIMITS, LAIR_LIMITS, SUMMON_LIMITS, SHAKE_LIMITS, bossPhaseIds, bossPhaseRelative, lairSeparation } from "./boss-words"
import { lairClearanceWords, type Ability, type Boss, type Flight } from "./entity-runtime"
import { BOSS_BAR_LOOK_INSTRUCTIONS, bossBarAsset } from "./boss-bar"
import { FLIGHT_LIMITS } from "./flight-words"
import { typeIn } from "./play-words"
import { bossWeatherPlan, lightningEvents, phaseWeatherWords } from "./boss-weather"
import { BOSS_LOOK_INSTRUCTIONS, DROP_EVENT_INSTRUCTIONS, SHAKE_MORE_INSTRUCTIONS, dropWords, phaseLookWords, shakeMoreWords } from "./boss-look-words"
import { ARENA_INSTRUCTIONS, arenaReviewIssues, arenaWords } from "./arena"
import { type ShowNames, BOSS_SHOW_INSTRUCTIONS, bossShowEnd, bossShowSentence } from "./boss-show"
import { tacticsWords } from "./ability-tactics"
import { BOSS_BASE_INSTRUCTIONS, bossBaseWords } from "./boss-base"

/**
 * A boss between its document and everything that reads it (boss runtime, 10-12): the ticks and masks the generated
 * Java is written from (`bossPlan`, the one place seconds become ticks), what is wrong with a boss against the
 * model it plays on, what the blueprint's Boss tier still asks of a creature, and all of it in plain words.
 * Nothing here knows a subject: every sentence is made from the numbers and names of the document.
 * No Node APIs: the app's window reads it too.
 */

const num = (value: number, digits = 2) => Number(value.toFixed(digits))
const percent = (share: number) => `${num(share * 100, 1)}%`
type Clip = { name: string; length: number }

/** A moment of a boss in seconds as the server tick it happens on; never less than one tick (the shortest the spec allows is half a second). */
export const bossTick = (seconds: number) => Math.max(1, Math.round(seconds * TICKS))

/**
 * Which abilities (by their place in the creature's list, as a bit mask) a boss may start in each phase (spec: 阶段). `abilities` are what it may choose
 * from, in the generated Java's order: its abilities, then its combos (a combo's bit is its place after the last ability).
 * What each phase may start is `bossPhaseIds`: phase 0 is before any line of life is crossed (the ones no phase lists, all of them when every one is listed); phase N
 * (N above 0) is the whole list `phases[N - 1]` gives, all of them when it gives none, or the phase before it with what it adds and removes.
 * A phase left with none (a document the checks refuse) is given all of them, as a phase that lists none is. Without phases, every ability is always allowed.
 */
export function bossMasks(boss: Pick<Boss, "phases">, abilities: readonly (Pick<Ability, "id"> & { name?: string })[], strict = false) {
  const all = abilities.reduce((mask, _, index) => mask | (1 << index), 0)
  const maskOf = (ids: readonly string[]) => abilities.reduce((mask, ability, index) => (ids.includes(ability.id) ? mask | (1 << index) : mask), 0)
  return bossPhaseIds(boss.phases, abilities.map((ability) => ability.id), strict).map((ids) => maskOf(ids) || (strict ? 0 : all))
}

/**
 * How long, in ticks from the moment the fight begins, a boss holds every other ability back for its named first attack (`intro.opening`) before it lets them go
 * (the first attack is then still taken whenever it can start). Read from the data, not guessed:
 * - the floor, `BOSS_LIMITS.opening.floor` seconds: the time to close in on a target that stands outside the ability's window;
 * - the ability's own `cooldown`: its wait may still be running when the fight begins (it was cut short by a leash reset in the last fight, which starts the wait);
 * - for a flier, the trip it may have to make to be where the ability starts (`where`): the least it stays up before it comes down (`FLIGHT_LIMITS.airLeast`), the landing and the take-off again.
 * Its own length is not counted: the wait is for it to start, not to end.
 */
export function bossOpeningTicks(ability: Pick<Ability, "start">, flight?: Pick<Flight, "takeoff" | "land"> | null) {
  const trip = flight ? bossTick(FLIGHT_LIMITS.airLeast) + bossTick(flight.land.seconds) + bossTick(flight.takeoff.seconds) : 0
  return bossTick(BOSS_LIMITS.opening.floor) + Math.round(ability.start.cooldown * TICKS) + trip
}

/** The boss as ticks and masks: what the generated Java holds as constants and every sentence about timing says. */
export function bossPlan(boss: Boss, abilities: readonly Pick<Ability, "id" | "start">[], flight?: Pick<Flight, "takeoff" | "land"> | null, strict = false) {
  const opening = boss.intro?.opening ? abilities.findIndex((ability) => ability.id === boss.intro!.opening) : -1
  return {
    // Boss 能力 15: a show whose last step is later than its seconds runs to that step (`bossShowEnd`; 0 without steps, so any other boss is what it always was).
    introTicks: boss.intro ? Math.max(bossTick(boss.intro.seconds), bossShowEnd(boss.intro.steps)) : 0,
    phases: boss.phases.map((phase) => ({ below: phase.below, ticks: bossTick(phase.seconds), speed: phase.speed, damage: phase.damage })),
    masks: bossMasks(boss, abilities, strict),
    deathTicks: Math.max(bossTick(boss.death.seconds), bossShowEnd(boss.death.steps)),
    // The experience bursts are spread evenly over the death, none at its very first or last tick.
    bursts: Array.from({ length: boss.death.xp_bursts }, (_, index) => Math.max(1, Math.floor(((index + 1) * bossTick(boss.death.seconds)) / (boss.death.xp_bursts + 1)))),
    leashTicks: boss.leash ? bossTick(boss.leash.reset_seconds) : 0,
    /** The first attack after the wake-up: its place in the creature's list and how long the others wait for it; null without one. */
    opening: opening >= 0 ? { index: opening, ticks: bossOpeningTicks(abilities[opening]!, flight) } : null,
  }
}
export type BossPlan = ReturnType<typeof bossPlan>

/** The motions a boss starts itself: its wake-up's and each change of phase's, where it has them. */
export const bossClips = (boss: (Pick<Boss, "intro" | "phases"> & Partial<Pick<Boss, "death">>) | null | undefined) => [
  ...(boss?.intro?.clip ? [boss.intro.clip] : []),
  ...(boss?.phases ?? []).flatMap((phase) => (phase.clip ? [phase.clip] : [])),
  // Boss 能力 15: the motions its wake-up's and its death's steps play.
  ...[...(boss?.intro?.steps ?? []), ...(boss?.death?.steps ?? [])].flatMap((step) => (step.type === "clip" ? [step.clip] : [])),
]

// ---- words ----

/**
 * What a boss gets from the rest of its creature that changes how its wake-up and its phases are told: habits (a dormant boss lives them until it meets
 * someone, so it is not asleep while they say "active") and flight (its wake-up is a display in the air, and a faster phase is faster in the air too).
 */
export type BossOwn = ShowNames & { habits?: boolean; flies?: boolean; health?: number }
/** `health` (its own most life, where the creature has one) is what the words of its caps and its scaling are told against (`bossBaseWords`). */
export const bossOwn = (creature: { habits?: unknown; flight?: unknown; health?: unknown }): BossOwn => ({ habits: Boolean(creature.habits), flies: Boolean(creature.flight), ...(typeof creature.health === "number" ? { health: creature.health } : {}) })
/** The abilities as the words are given them: the name a person reads and, when at hand, when each may start (the wait for a first attack is told from its cooldown). */
type WordAbility = Pick<Ability, "id" | "name"> & Partial<Pick<Ability, "start">>
/** The flight of the creature, whose take-off and landing a first attack may have to wait for (`bossOpeningTicks`). */
type WordFlight = Pick<Flight, "takeoff" | "land"> | null | undefined

export const bossWords = {
  /** 「血条是粉色、分 10 格的，打起来天色会暗下来」 */
  bar: (boss: Boss, studio = false) => `血条是${BOSS_BAR_COLORS[boss.bar.color]}、${BOSS_BAR_STYLES[boss.bar.style]}的${bossBarAsset(boss) ? (studio ? "（用工程里的血条，每个阶段一段，段间有锁，出招时图标点亮）" : "（自己的样子用本工程的一个血条资产：每个阶段一段、段间有锁、出招时图标点亮）") : ""}${boss.bar.darken_sky ? "，战斗时天色会暗下来" : ""}`,
  /**
   * 「一开始睡着，玩家走近 12 格才醒，醒来 3 秒里不动也打不了；之后才出现血条」
   * With habits: 「一开始还没见过谁……」; with flight: the wake-up is a display above the one who woke it. With a first attack (`opening`): 「登场以后先用「俯冲」……」.
   */
  intro: (boss: Boss, own: BossOwn = {}, abilities: readonly WordAbility[] = [], flight?: WordFlight) =>
    boss.intro
      ? `${own.habits ? "一开始还没见过谁：习性说活动的时候它照习性活动（巡、猎、飞都照做，但不挑任何人开打、也不追），习性说休息的时候才睡着不动" : "一开始睡着"}，玩家走近 ${num(boss.intro.wake_distance)} 格才醒，醒来${own.flies ? "先飞到那个玩家头顶（在地上就先起飞），在上空盘旋着" : ""}${boss.intro.clip ? `${own.flies ? "" : "先"}播「${own.motion?.(boss.intro.clip) ?? (motionName(boss.intro.clip) === boss.intro.clip ? "登场动作" : motionName(boss.intro.clip))}」` : ""}${boss.intro.sound ? `、吼一声「${ABILITY_SOUNDS[boss.intro.sound] ?? boss.intro.sound}」` : ""}，这 ${num(boss.intro.seconds)} 秒里${own.flies ? "盘旋着演出、不出招、" : "不动"}也打不了；之后才开始打、才出现血条${bossWords.opening(boss, abilities, own, flight)}${bossShowSentence("intro", boss.intro.steps, own)}`
      : "没有登场，一出来就开打，血条一直在",
  /**
   * 「，登场以后先用「俯冲」：它用过一次之前别的招式都不出；要是 12 秒还没用出来，别的招式就不再等它……」 Empty without a first attack. The seconds are the time `bossOpeningTicks` reads from the
   * ability and the flight; they are said only when the ability's own data is at hand.
   */
  opening: (boss: Boss, abilities: readonly WordAbility[] = [], own: BossOwn = {}, flight?: WordFlight) => {
    const id = boss.intro?.opening
    if (!id) return ""
    const found = abilities.find((ability) => ability.id === id)
    const wait = found?.start ? `${num(bossOpeningTicks({ start: found.start }, flight) / TICKS, 1)} 秒` : "一阵子"
    return `，登场以后先用「${found?.name ?? id}」：它用过一次之前别的招式都不出；要是登场结束后${wait}还没用出来（目标不在它够得着的距离里${own.flies ? "，或者它飞不到、落不到这招要的地方" : ""}），别的招式就不再等它。离开重置后下一场重新先用它，变身不会让它重来`
  },
  /**
   * 「血量掉到 66% 时变身（1.5 秒不动），之后血条变红、快 1.2 倍、伤害 1.3 倍，这一阶段用的招式：「砸地」「吼叫」」；a flier's flight is as much faster.
   * `moves`: what this phase may start, worked out (`bossPhaseIds`), said whatever way the phase writes it, so nobody has to work it out; one written as a change also says the change.
   * Without it, only a phase that writes a whole list says one (what the words said before phases could be written as a change).
   */
  phase: (phase: Boss["phases"][number], abilities: readonly Pick<Ability, "id" | "name">[], own: BossOwn = {}, moves?: readonly string[]) => {
    const named = (id: string) => `「${abilities.find((ability) => ability.id === id)?.name ?? id}」`
    const change = bossPhaseRelative(phase) ? `（在上一阶段的基础上${[...(phase.add?.length ? [`加上${phase.add.map(named).join("")}`] : []), ...(phase.remove?.length ? [`去掉${phase.remove.map(named).join("")}`] : [])].join("、")}）` : ""
    const list = moves ?? (phase.abilities?.length ? phase.abilities : null)
    return `血量掉到 ${percent(phase.below)} 时变身${phase.clip ? `（播「${own.motion?.(phase.clip) ?? (motionName(phase.clip) === phase.clip ? "变身动作" : motionName(phase.clip))}」，` : "（"}${num(phase.seconds)} 秒里不动也打不了），之后${phase.bar_color ? `血条变${BOSS_BAR_COLORS[phase.bar_color]}、` : ""}速度 ×${num(phase.speed)}${own.flies && phase.speed > 1 ? "（飞得也这么快：巡航、转弯、俯冲的速度都乘它）" : ""}、伤害 ×${num(phase.damage)}${
      list ? `，这一阶段用的招式：${list.map(named).join("、")}${change}` : ""
    }${phase.sound ? `；变身开始时播放${typeof phase.sound === "string" ? `「${ABILITY_SOUNDS[phase.sound]}」` : `「${own.title?.(phase.sound.asset) ?? "自制音效"}」`}` : ""}${phaseLookWords(phase.model,undefined,own.bone)}${phaseWeatherWords(phase)}${phase.between ? `；${tacticsWords({ between: phase.between })}` : ""}`
  },
  /** 「第一阶段（血量掉到第一条线之前）用的招式：「横扫」「突刺」」: what the first phase may start, worked out (`bossPhaseIds`); empty without phases (then every one is always used). */
  firstPhase: (boss: Boss, abilities: readonly Pick<Ability, "id" | "name">[]) =>
    boss.phases.length && abilities.length ? `第一阶段（血量掉到第一条线之前）用的招式：${bossPhaseIds(boss.phases, abilities.map((ability) => ability.id))[0]!.map((id) => `「${abilities.find((ability) => ability.id === id)?.name ?? id}」`).join("、")}` : "",
  /** 「死的时候动作播 4 秒，期间经验分 6 次喷出，最后一声只有声光的爆炸」 */
  death: (boss: Boss, own: BossOwn = {}) => `死的时候倒下的动作播 ${num(boss.death.seconds)} 秒${boss.death.xp_bursts ? `，期间经验分 ${boss.death.xp_bursts} 次喷出` : ""}${boss.death.explosion ? "，最后一声只有声光、不破坏方块也不伤人的爆炸" : ""}${bossShowSentence("death", boss.death.steps, own)}`,
  /** 「离出生点超过 48 格、30 秒里身边没有玩家，它回到出生点回满血」 */
  /** 「单次最多掉 40 血，每 5 秒最多掉 120 血……」: what every boss of a big boss mod has (`bossBaseWords`); empty without any of it. */
  base: (boss: Boss, own: BossOwn = {}) => bossBaseWords(boss, own.health),
  leash: (boss: Boss, own: BossOwn = {}) => (boss.leash ? `${num(boss.leash.reset_seconds)} 秒里 ${BOSS_LIMITS.battle} 格内没有玩家，它血量回满、阶段回到第一阶段，离出生点超过 ${num(boss.leash.distance)} 格的还会回到出生点${boss.intro ? (own.habits ? "、回到没见过谁的样子（照习性活动，习性说休息才睡着）" : "、重新睡着") : ""}` : "走得再远也不会自己回出生点"),
  /**
   * 「它的巢随世界一起生成：在平原、森林一类的群系，平均每隔 32 个区块一个，……」 Where its lair is, by the names a player knows: `places` are its biomes (`creatureWords.places`), `locate` the name
   * `/locate structure` takes, `names` a block's name in this project or the game (by default its identifier).
   */
  lair: (lair: NonNullable<Boss["lair"]>, places: string, locate: string, names: (block: string) => string = (block) => block) =>
    `它的巢随世界一起生成：在${places}，平均每隔 ${lair.spacing} 个区块一个${lair.above_sea ? `，平台比海平面高 ${lair.above_sea} 格以上才有` : ""}；巢是半径 ${lair.radius} 格的圆平台，铺着${lair.floor.map((block) => `「${names(block)}」`).join("、")}${lair.rim ? `，最外一圈砌着「${names(lair.rim)}」` : ""}，上方 ${lair.clearance} 格里的树、山石和别的建筑都清掉（巢是区块里最后造的东西；造完以后落下的一层薄雪会留着）；生成的那一刻放进去一只，打败了不会再来，只有新生成的区块里才有，已经走过的地方没有；想找到它：${typeIn(`/locate structure ${locate}`)}，游戏会告诉你它在哪一格`,
  /** The whole boss, one sentence per part, as the card shows it or joined with `；`. */
  /**
   * The whole boss, one sentence per part, as the card shows it or joined with `；`. `abilities` are what it may choose from: its abilities and its combos.
   * With them every phase, the first one too, says what it may start, worked out (`bossPhaseIds`).
   */
  summary: (boss: Boss, abilities: readonly WordAbility[] = [], between = "；", own: BossOwn = {}, flight?: WordFlight) => {
    const stages = abilities.length ? bossPhaseIds(boss.phases, abilities.map((ability) => ability.id)) : null
    return [bossWords.bar(boss, own.displayNames), bossWords.intro(boss, own, abilities, flight), ...(stages ? [bossWords.firstPhase(boss, abilities)].filter(Boolean) : []), ...boss.phases.map((phase, index) => bossWords.phase(phase, abilities, own, stages?.[index + 1])), bossWords.death(boss, own), bossWords.leash(boss, own), ...(boss.music ? [`战斗音乐从${boss.music.starts === "wake" && boss.intro ? "登场" : "开打"}开始，脱战用 ${boss.music.fade_seconds} 秒淡出，死亡时播放已设置的结尾`] : []), ...[bossWords.base(boss, own)].filter(Boolean), ...(boss.arena ? [arenaWords(boss.arena)].filter(Boolean) : [])].join(between)
  },
  summon: (way: NonNullable<Boss["summon"]>, title: (reference: string) => string = (reference) => reference) =>
    `拿着「${title(way.item)}」${way.block ? `对着「${title(way.block)}」` : "对着空气"}右键召唤${way.block ? "，它出现在召唤台上方" : `，它出现在前方约 ${way.ahead} 格`}；召唤物${way.consume ? "消耗一个" : "不消耗"}，冷却 ${way.cooldown} 秒`,
  /** 「第 0.7 秒屏幕晃动（力度 2，12 格内，越远越轻，0.8 秒停下）」 */
  shake: (event: Extract<Ability["events"][number], { type: "shake" }>) => `第 ${num(event.at)} 秒 ${num(event.radius, 1)} 格内的玩家屏幕晃动（力度 ${num(event.strength)}，${event.falloff === "none" ? "范围内一样强" : "越远越轻"}，${num(event.seconds)} 秒里逐渐停下${shakeMoreWords({ ...event, falloff: undefined })}）`,
  /** Boss 能力 10: 「第 0.8 秒「右臂」掉下来……」 */
  drop: (event: Extract<Ability["events"][number], { type: "drop" }>) => dropWords(event),
  /** 「第 0.7 秒脚下的地面冒尘，6 块碎块飞起来」 */
  debris: (event: Extract<Ability["events"][number], { type: "debris" }>) => `第 ${num(event.at)} 秒${event.where === "self" ? "它脚下" : event.where === "target" ? "目标脚下" : "打到的地方"}的地面冒尘，${event.count} 块碎块飞起来再落下${event.throw ? `（向上初速 ${event.throw.speed} 格/刻，水平散开 ${event.throw.spread} 格/刻，重力 ${event.throw.gravity}，碰地消失）` : ""}（只是看得见，不改世界里的方块）`,
  /** 「第 0.9 秒打碎它面前半径 1.5 格、往上 4 格以内硬度不超过 2 的方块（掉落）」 */
  breaks: (event: Extract<Ability["events"][number], { type: "break" }>) =>
    `第 ${num(event.at)} 秒打碎${event.where === "self" ? "它" : event.where === "target" ? "目标" : "打到的地方"}${event.forward > 0 ? `前方 ${num(event.forward)} 格` : event.forward < 0 ? `后方 ${num(-event.forward)} 格` : event.where === "hit" ? "" : "脚下"}${event.up ? `，高度偏移 ${num(event.up)} 格` : ""}${event.left ? `，向左偏移 ${num(event.left)} 格` : ""}半径 ${num(event.radius)} 格、往上 ${num(event.height)} 格以内硬度不超过 ${num(event.hardness)} 的方块（${event.drops ? "掉落方块本身" : "不掉东西"}；世界关了生物破坏方块时不打碎，箱子这类有存储的方块、基岩和液体不碰）`,
}

// ---- a boss against the model it plays on ----

export type BossIssue = { refs?: import("@minemods/studio-ai/acceptance").FindingRef[]; rule: "boss_clip" | "boss_ability" | "boss_clip_length" | "boss_death_clip" | "boss_unused" | "boss_lair_clearance" | "boss_lair_spawns" | "boss_weather" | "boss_arena" | "boss_music"; stops: boolean; text: string; fix: string; detail: string }

/** A motion that plays shorter or longer than the time it is given by more than this many seconds is called out: two ticks, the same tolerance a hit is held to (`STRIKE_TOLERANCE`). */
export const CLIP_TOLERANCE = 2 / TICKS

/**
 * What is wrong with a creature's boss against its model, by rule. `clips` are its model's motions (null: the model is not known here, so
 * only what the document itself shows is checked). A finding that `stops` is one the build refuses: the boss could not be played as written
 * (a motion the model lacks, an ability that is not there, a lair too low for the boss). The rest are warnings that the show will not look the way it is meant to.
 * `height`: how tall the creature's collision box is, in blocks, where that is known (its stated box, else the model's): the lair's air has to hold it.
 */
export function bossModelIssues(creature: { name: string; behavior: string; abilities?: readonly (Pick<Ability, "id"> & { name?: string })[] | null; combos?: readonly { id: string; name?: string }[] | null; boss?: Boss | null; runtime?: { spawn?: unknown } | null }, clips: readonly Clip[] | null, height: number | null = null): BossIssue[] {
  const boss = creature.boss
  if (!boss) return []
  const named = (clip: string | null, where: string, seconds: number, what: "intro" | "phase", phase?: number): BossIssue[] => {
    if (clip === null || clips === null) return []
    const found = clips.find((value) => value.name === clip)
    const motion = clipRef(clip)
    const refs = phase === undefined ? [motion] : [motion, phaseRef(phase)]
    if (!found)
      return [
        {
          rule: "boss_clip" as const, refs,
          stops: true,
          text: `「${creature.name}」${where}要播${motion.title !== clip ? `「${motion.title}」` : "指定的动作"}，可是它的模型里没有这个动作。`,
          fix: `给模型补上${what === "intro" ? "登场" : "变身"}动作（长 ${num(seconds)} 秒，不循环），也可以改选模型已有的动作或取消播放。`,
          detail: `${where}: clip ${clip}; model has: ${clips.map((value) => value.name).join(", ")}`,
        },
      ]
    return Number.isFinite(found.length) && Math.abs(found.length - seconds) > CLIP_TOLERANCE + 1e-9
      ? [
          {
            rule: "boss_clip_length" as const, refs,
            stops: false,
            text: `「${creature.name}」${where}的动作「${motion.title}」长 ${num(found.length)} 秒，可是这一段留的是 ${num(seconds)} 秒：${found.length < seconds ? "动作放完它会僵住不动" : "动作还没放完，它就开始打了"}。`,
            fix: `把这一段的 seconds 改成 ${num(found.length)}，或者把动作做成 ${num(seconds)} 秒。`,
            detail: `${where}: clip ${clip} length ${found.length}; seconds ${seconds}`,
          },
        ]
      : []
  }
  // What a phase may name: its abilities and its combos, whichever way the phase names them (a whole list, or what it adds and removes).
  const moves = [...(creature.abilities ?? []), ...(creature.combos ?? [])]
  const ids = new Set(moves.map(move => move.id))
  const choices = moves.map(move => move.name).filter(Boolean).join("、")
  return [
    ...(creature.behavior === "hostile" ? [] : [{ rule: "boss_unused" as const, stops: false, text: `「${creature.name}」不会主动攻击，所以它的 Boss 血条、阶段和登场在游戏里都用不上。`, fix: "把它改成会主动攻击（hostile），或者去掉 boss。", detail: `behavior: ${creature.behavior}` }]),
    ...(boss.intro ? named(boss.intro.clip, "登场时", boss.intro.seconds, "intro") : []),
    ...boss.phases.flatMap((phase, index) => named(phase.clip, `第 ${index + 1} 次变身（血量 ${percent(phase.below)}）时`, phase.seconds, "phase", index + 1)),
    ...boss.phases.flatMap((phase, index) =>
      [...new Set([...(phase.abilities ?? []), ...(phase.add ?? []), ...(phase.remove ?? [])])]
        .filter((id) => !ids.has(id))
        .map((id) => ({ rule: "boss_ability" as const, refs: [phaseRef(index + 1), abilityRef({ id, name: id })], stops: true, text: `「${creature.name}」第 ${index + 1} 次变身之后的阶段指定了一招，可是它没有这个招式。`, fix: `${choices ? `从它已有的招式中选一个（${choices}），或者补上缺少的招式。` : "先给它加上这个招式，再分配到这个阶段。"}`, detail: `phase ${index + 1}: ability ${id}; abilities: ${[...ids].join(", ")}` })),
    ),
    // Boss 能力 7: what of its phases' weather will not show the way it reads.
    ...bossWeatherIssues(creature),
    ...(boss.music?.starts === "wake" && !boss.intro ? [{ rule: "boss_music" as const, stops: false, refs: [assetRef(boss.music.asset)], text: "这只 Boss 没有登场演出，音乐会从开打时播放。", fix: "可以把 starts 改成 fight，或者补上登场演出。", detail: "boss.music.starts: wake" }] : []),
    // Boss 能力 12、13: what of its arena will not play the way it reads (arena.ts).
    ...arenaReviewIssues(creature as Parameters<typeof arenaReviewIssues>[0]),
    ...(clips && !clips.some((clip) => clip.name === "death")
      ? [{ rule: "boss_death_clip" as const, refs: [clipRef("death")], stops: false, text: `「${creature.name}」是 Boss，要演 ${num(boss.death.seconds)} 秒的死亡，可是它的模型里没有死亡（death）动作：这 ${num(boss.death.seconds)} 秒里它只会像原版生物那样侧身倒在地上。`, fix: `给模型加一个名叫 death 的动作（倒下、碎开、熄灭……，长 ${num(boss.death.seconds)} 秒左右），它会把整个死亡演出放完。`, detail: `boss.death.seconds: ${boss.death.seconds}; model has no death clip` }]
      : []),
    // The air cleared above the lair's floor is blocks; a creature stands from the floor up to the whole block that holds its top (ceil), as its box is not a whole number of them.
    ...(boss.lair && height !== null && boss.lair.clearance < Math.ceil(height)
      ? [{ rule: "boss_lair_clearance" as const, stops: true, text: `「${creature.name}」的巢清出来的空间不够高。`, fix: `${lairClearanceWords(boss.lair.clearance, height)}。`, detail: `lair.clearance: ${boss.lair.clearance}; collision box height: ${height}` }]
      : []),
    ...(boss.lair && creature.runtime?.spawn
      ? [{ rule: "boss_lair_spawns" as const, stops: false, text: `「${creature.name}」既有巢（lair）又会自己出现（runtime.spawn）：巢里放一只，野外还会不停刷出更多只，Boss 就不止一只了。`, fix: "Boss 只想守在巢里的话，把 runtime.spawn 写成 null；想要它到处都有，就去掉巢。", detail: "boss.lair and runtime.spawn are both set" }]
      : []),
  ]
}

/**
 * Boss 能力 7: what of a boss's phase weather will not show the way it reads, said and never a stop: a storm (`thunder`) brings no bolt by itself (only an ability's
 * lightning does), and a bar that darkens the sky (`darken_sky`) darkens it at least as much as the game's own boss darkening whatever a phase's `dark` says.
 */
export function bossWeatherIssues(creature: { name: string; abilities?: readonly object[] | null; boss?: Boss | null }): BossIssue[] {
  const boss = creature.boss
  if (!boss) return []
  const stages = bossWeatherPlan(boss)
  const stormy = stages.some((weather) => weather?.thunder)
  // What it is handed may be only the abilities' ids (a check that has not read their events): then nothing is said of the lightning.
  const events = (creature.abilities ?? []).map((ability) => ("events" in ability && Array.isArray(ability.events) ? lightningEvents(ability as Pick<Ability, "events">).length : null))
  const struck = events.some((count) => count !== 0)
  const lighter = boss.bar.darken_sky ? boss.phases.flatMap((phase, index) => (phase.weather && phase.weather.dark < 1 ? [index + 1] : [])) : []
  return [
    ...(stormy && !struck
      ? [{ rule: "boss_weather" as const, stops: false, text: `「${creature.name}」有阶段写了雷雨（weather.thunder），可是它没有一个招式会落雷：雷雨只让战斗里的玩家看到更暗的天和更大的雨，天上不会自己劈下闪电。`, fix: "想要闪电，给它的招式加 lightning 事件（落在哪里、伤害多少、要不要预警）；只想要暗天和大雨就不用改。", detail: `thunder in stages ${stages.flatMap((weather, stage) => (weather?.thunder ? [stage] : [])).join(", ")}; no lightning event` }]
      : []),
    ...(lighter.length
      ? [{ rule: "boss_weather" as const, stops: false, refs: lighter.map(phaseRef), text: `「${creature.name}」的血条写了 darken_sky，战斗里天色本来就按原版压暗；第 ${lighter.join("、")} 阶段的 weather.dark 不会让它比原版压暗更亮，只会更暗。`, fix: "想要某个阶段天色正常，就把 bar.darken_sky 写成 false，暗度全由各阶段的 weather.dark 决定。", detail: `bar.darken_sky: true; phases ${lighter.join(", ")} write dark below 1` }]
      : []),
  ]
}

// ---- what the blueprint's Boss tier asks of the creature ----

/** The ability events that make a fight felt: a creature of the Boss tier has at least one ability that uses one of them (spec: Boss 档的要求). */
export const felt = (abilities: readonly Pick<Ability, "events">[]) => abilities.some((ability) => ability.events.some((event) => event.type === "shake" || event.type === "debris"))

// ---- for whoever writes a creature document ----

const listed = (record: Readonly<Record<string, unknown>>) => Object.keys(record).join("|")

/**
 * What an AI is told about the boss: the data and what each part does in the game, and how to choose the numbers (spec: Boss 档的要求).
 * One text: the registry, the hand-off, the capability list and the task text of a Boss-tier creature read it.
 */
export const BOSS_VALUE_GUIDE = `阶段线（phases[].below）常用 0.66 和 0.33；后一阶段保留前一阶段的招式、只多一两招的，用 add 写多出来的那几招（例如 {"add":["quake"]}），不要整份重列；变身（phases[].seconds）1.5–3 秒；每过一个阶段 speed、damage 递增一点（例如 1.15、1.3）；晃屏 shake.strength：落地猛砸 1.5–2.5，吼叫 0.5–1，最后阶段的大招可以到 4–6 并配上 roll 2–5、fov 2–4；radius 取够到玩家站的位置（砸地 12–20，吼叫 20–32）；史诗 Boss 写上 damage_cap（满血的 4%–6%）、dps_cap（5 秒里满血的 12%–20%）、regen（每秒满血的 0.5%–1%，10 秒没掉血、脱战才回）和 scaling（每多一人血 +50%、伤害 +20%，32 格，最多算 4 人）。`

/**
 * What a task for a Boss-tier creature is told on top of the tier's own list (`tierAsks`; spec: 制作生物的任务说明里，Boss 档写明上面这些，并说明每一项的取值怎么定):
 * how to choose the numbers, the same ones the AI is given in the field instructions (`BOSS_VALUE_GUIDE`). What the tier requires is not said here: it is the list.
 */
export const BOSS_TASK_LINES = [
  `- 取值怎么定：${BOSS_VALUE_GUIDE}`,
] as const

export const BOSS_INSTRUCTIONS =
  ` boss 把一只敌对生物（behavior=hostile，别的生物不能写）做成一场战斗的主角；省略或 null 是普通生物。格式 {bar, intro, phases, death, leash, music（可选）, lair（可选）, damage_cap / dps_cap / regen / scaling（可选）, summon（可选）}，全是数据，生成的模组照着演，不用写玩法代码；lair 在世界生成的时候铺平台；招式事件可以在世界规则允许时打碎方块（break）或临时换块（block_swap）。` +
  ` bar：{color: ${listed(BOSS_BAR_COLORS)}, style: ${listed(BOSS_BAR_STYLES)}, darken_sky}——它被看见时，屏幕上方出现写着它名字的血条；darken_sky 为 true 时战斗中天色变暗，它死了或重置了就恢复。` +
  ` music 写 {asset, starts, fade_seconds}。asset 选工程里的音乐 UUID，starts 选 wake（登场开始）或 fight（登场结束），fade_seconds 填 0–10。血条上的玩家听同一场战斗的音乐，走远或脱战淡出，死亡放结尾。换阶段继续原曲。玩家同时遇见两只 Boss 时先听先开始的那首。` +
  BOSS_BAR_LOOK_INSTRUCTIONS +
  ` intro：null，或 {wake_distance ${BOSS_LIMITS.wake.min}–${BOSS_LIMITS.wake.max}, clip, seconds ${BOSS_LIMITS.seconds.min}–${BOSS_LIMITS.seconds.max}, sound, opening（可选）}——它一开始睡着不动，玩家走进 wake_distance 格（或者被玩家打到）才醒；醒来播模型里名叫 clip 的动作（不能是 idle、walk、hurt、death；不要动作写 null）、吼 sound（和招式的 sound 同一份清单；不吼写 null），这 seconds 秒里它不动、不出招、打不死，之后才开始战斗、才出现血条。clip 的动作长度要和 seconds 一样。opening（可选，不写就是登场以后按各招式的 weight 随机出招）：这只生物某一个招式（或连招）的 id，登场结束后的第一招一定是它——这个招式在这场战斗里用过一次之前，别的招式都不出；要是它迟迟用不出来（目标不在它的出招距离里，会飞的飞不到、落不到这招要的地方），过了 ${BOSS_LIMITS.opening.floor} 秒再加上这个招式的 cooldown（会飞的再加上它至少在天上待的时间、降落和起飞的时间）别的招式就不再等它。离开重置之后下一场重新先用它，变身不会让它重来。它必须是第一阶段能用的招式（第一阶段用的是没有写进任何阶段的 abilities 或 add 的招式，所有招式都写进了阶段就都能用）。只有人明确说了登场以后先用哪一招（“醒来以后先俯冲下来抓”“落下来第一下就是……”）才写 opening；没有这样说就不写，让招式照 weight 随机。有登场的 Boss 不会自然消失。null 是一出来就开打。登场和这只生物的另外两样东西合在一起：（一）有习性（habits）的话，它一开始不是睡着，而是“还没见过谁”——习性说活动的时候（habits.active 或一直活动）它照习性活动，巡、猎、飞都照做，但不挑任何人开打、也不追；玩家走进 wake_distance 格（或打到它）才见到、才开始登场；习性说休息的时候、或者没有习性，它才睡着不动。离开重置之后它回到同一个“还没见过谁”的样子。想要一只在天上巡视、被人打扰才发怒的 Boss，就给它写上 habits（active 写 always，或写 day / night——到了活动的时间它才活动，休息的时间它还是睡着）；想要它一直睡到有人来，就不写 habits（或让习性是休息）。（二）会飞（flight）的 Boss，登场是一场空中的表演：醒来时在地上就先起飞，然后在叫醒它的玩家头顶盘旋这 seconds 秒，同时播 clip、吼 sound，不出招、打不死，演完才落入战斗；所以 clip 要做成适合在空中放的动作（展翅、长啸），不要做成站在地上才合理的动作（站起、从土里钻出）。` +
  ` phases：0 到 ${BOSS_LIMITS.phases} 个，[{below ${BOSS_LIMITS.below.min}–${BOSS_LIMITS.below.max}, clip, seconds ${BOSS_LIMITS.seconds.min}–${BOSS_LIMITS.seconds.max}, bar_color, speed ${BOSS_LIMITS.speed.min}–${BOSS_LIMITS.speed.max}, damage ${BOSS_LIMITS.damage.min}–${BOSS_LIMITS.damage.max}, abilities 或 add / remove}]，below 从大到小写。血量掉到 below（占满血的几分之几，0.66 就是三分之二）时进入这一阶段：先播变身动作 clip（模型里要有，规则同登场的 clip；动作长度要和 seconds 一样），这 seconds 秒里它不动、不出招、打不死；然后血条换成 bar_color（null 不换）、速度乘 speed（会飞的 Boss，飞行的巡航、转弯、俯冲也都乘 speed，每刻最快 3.9 格的上限不变，俯冲仍然正好在第一次出手那一刻到——speed 大于 1 的阶段就是飞得更快的阶段）、它造成的伤害（招式、近战、箭）乘 damage。一刀打不穿两个阶段：会跨过下一条线的伤害，血量停在线上、触发变身。每个阶段能用哪些招式，有两种写法，二选一（同一个阶段里不能既写非空的 abilities 又写 add / remove）：一、abilities 写整份名单——这一阶段能用的招式 id（必须是这只生物 abilities 或 combos 里有的，连招按它的 id 写），只用这些，上一阶段的不会自动留下，还想继续用的要再写一遍；abilities 写空数组或者不写（也不写 add / remove），这一阶段什么招式都能用。二、在上一阶段的基础上增减：add 写这一阶段新加的招式 id（上一阶段还不能用的），remove 写这一阶段不再用的招式 id（上一阶段能用的），没写到的照旧——“原有两招之外再加一招”就是只写 add:["那一招"]，不写 abilities。add 的招式不能是上一阶段已经能用的，remove 的招式必须是上一阶段能用的，remove 以后至少要剩一招。第一阶段（还没掉到任何一条线）用的是没有写进任何阶段的 abilities 或 add 的招式；所有招式都写进了阶段，第一阶段就什么都能用。` +
  ` 每条阶段线都可以写 sound。血量首次碰到这条线、开始变身时播放一次。填招式可用的原版声音名，或填 {"asset":"工程里声音资产的编号"}。` +
  BOSS_LOOK_INSTRUCTIONS +
  ARENA_INSTRUCTIONS +
  ` death：{seconds ${BOSS_LIMITS.death.min}–${BOSS_LIMITS.death.max}, xp_bursts 0–${BOSS_LIMITS.bursts}, explosion}——死亡动作（模型里名叫 death 的动作，长度和 seconds 差不多）播这么久，不是原版的 1 秒；期间经验分 xp_bursts 次喷出（总量是生物文档 experience 的数）；explosion 为 true 时最后有一声只有声光、不破坏方块、不伤人的爆炸。掉落照 loot，在死亡开始时掉。` +
  BOSS_SHOW_INSTRUCTIONS +
  ` leash：null，或 {distance ${BOSS_LIMITS.leash.min}–${BOSS_LIMITS.leash.max}, reset_seconds ${BOSS_LIMITS.reset.min}–${BOSS_LIMITS.reset.max}}——reset_seconds 秒里 ${BOSS_LIMITS.battle} 格内没有玩家时，它血量回满、阶段回到第一阶段、回到登场前的样子，离出生点超过 distance 格的还会回到出生点（有登场的话：没有习性就重新睡着，有习性就回到“还没见过谁”）。null 是不回去。` +
  BOSS_BASE_INSTRUCTIONS +
  ` lair（可选，省略或 null 是没有巢）：{biomes, tags, above_sea, spacing ${LAIR_LIMITS.spacing.min}–${LAIR_LIMITS.spacing.max}, radius ${LAIR_LIMITS.radius.min}–${LAIR_LIMITS.radius.max}, floor, rim, clearance ${LAIR_LIMITS.clearance.min}–${LAIR_LIMITS.clearance.max}}——给 Boss 一个随世界生成的巢：游戏自己的“结构”（和村庄、海底神殿一样），跟着地形一起生成，不靠玩法代码，也不会碰玩家盖的任何东西；Boss 在巢生成的那一刻放进去一只，打败了就不会再来，重新进游戏也不会多出来。人明确说了“山顶上的巢”“沼泽里的祭坛”这类话才写。biomes（原版群系 id）和 tags（群系的大类）写法和 runtime.spawn 一样，至少写一样，说巢可以出现在哪些群系；above_sea（可选）：平台的地面至少比海平面（63）高这么多格，写了就只在山上找；spacing：平均每隔多少个区块有一个巢（原版：冰屋、沙漠神殿 32，林地府邸 80），两个巢之间最少隔多远由它自己算出来（比如 ${LAIR_LIMITS.spacing.min} 的时候是 ${lairSeparation(LAIR_LIMITS.spacing.min)} 个区块），不用写；radius：圆形平台的半径，格；floor：铺平台的 ${LAIR_LIMITS.floor.min}–${LAIR_LIMITS.floor.max} 种方块，写本工程方块的标识符，或者 minecraft:名字 的原版方块（名字要是原版有的方块），每一列按位置固定地挑其中一种，所以一个世界里的图案是固定的；rim：平台最外一圈上面再砌一格高的方块，写法同上，不要就写 null；clearance：平台上方清成空气的格数，树、山石和挤在那里的别的结构都会清掉（巢是一个区块里最后造的东西，造完以后落下的一层薄雪会留着），不能比这只生物的碰撞箱高度小。平台落在附近最高的地面上，低处悬空的部分用 floor 的第一种方块一直垫到实地；落在水面上，或者要垫超过 ${LAIR_LIMITS.support} 格的地方，不生成。玩家用 /locate structure 模组id:生物注册名_lair 找它（生物注册名是它的 identifier，没写就是 creature_ 开头的那个）。巢只出现在装上模组以后新生成的区块里，已经走过的地方不会补出来。有巢的 Boss 就不要再写 runtime.spawn，否则野外还会刷出更多只。例：{"lair":{"biomes":[],"tags":["is_mountain"],"above_sea":80,"spacing":40,"radius":12,"floor":["minecraft:packed_ice","minecraft:blue_ice"],"rim":"minecraft:snow_block","clearance":16}}。` +
  ` summon（可选，省略或 null 是不能召唤）：{item, block, consume, cooldown ${SUMMON_LIMITS.cooldown.min}–${SUMMON_LIMITS.cooldown.max}, ahead ${SUMMON_LIMITS.ahead.min}–${SUMMON_LIMITS.ahead.max}}——玩家拿着 item（本工程物品或方块的标识符，或者 minecraft:名字 的原版物品）右键就把它召唤出来：block 写 null 时对着空中用，它出现在玩家面前 ahead 格；block 写一个方块（本工程方块的标识符或 minecraft:名字，比如一座祭坛）时，只有对着这个方块用才行，它出现在那个方块上面。它在那里往上最多 ${SUMMON_LIMITS.rise} 格找放得下身体的地方，面朝玩家，和平时一样先睡着、玩家在旁边就醒（所以登场照常播）。consume 为 true 时用掉这一个（创造模式不扣）；cooldown 是这件东西隔多少秒才能再召唤一次；玩家 ${SUMMON_LIMITS.near} 格内已经有一只活着的时候召唤不出来。召唤用的东西和祭坛要先在工程里做出来（或用原版的），配方另外写。` +
  ` ${BOSS_VALUE_GUIDE}Boss 的每个招式都要在蓄力里放预警（effect 事件在判定范围上画出来），蓄力要长到玩家看得见、躲得开。` +
  ` 例：{"bar":{"color":"purple","style":"notched_10","darken_sky":true},"intro":{"wake_distance":16,"clip":"awaken","seconds":3,"sound":"entity.ender_dragon.growl"},"phases":[{"below":0.66,"clip":"enrage","seconds":2,"bar_color":"red","speed":1.15,"damage":1.3,"abilities":["slam","roar"]},{"below":0.33,"clip":"enrage","seconds":2,"bar_color":"white","speed":1.3,"damage":1.6,"add":["quake"]}],"death":{"seconds":4,"xp_bursts":6,"explosion":true},"leash":{"distance":48,"reset_seconds":30}}。`

/** The two events that make a fight felt, as an AI is told them (appended to the events of an ability). */
export const BOSS_EVENT_INSTRUCTIONS =
  CINEMATIC_INSTRUCTIONS +
  ` 或者晃屏 {type:"shake", at, strength ${SHAKE_LIMITS.strength.min}–${SHAKE_LIMITS.strength.max}, radius ${SHAKE_LIMITS.radius.min}–${SHAKE_LIMITS.radius.max}, seconds ${SHAKE_LIMITS.seconds.min}–${SHAKE_LIMITS.seconds.max}, roll, fov, falloff, frequency}：那一刻起 radius 格内的玩家屏幕晃动，离得越远越轻，seconds 秒里逐渐停下（玩家在游戏设置里把“屏幕效果强度”调到 0 就不晃，调小就晃得小）；${SHAKE_MORE_INSTRUCTIONS}` +
  DROP_EVENT_INSTRUCTIONS +
  `或者碎块 {type:"debris", at, where: self|target|hit, hit, forward, up, left, radius ${DEBRIS_LIMITS.radius.min}–${DEBRIS_LIMITS.radius.max}, count ${DEBRIS_LIMITS.count.min}–${DEBRIS_LIMITS.count.max}}：那个位置（算法和 effect 一样；where 写 "hit" 时 hit 写第几次出手，其余写 null）的地面冒尘，脚下方块的碎块（缩小的那种方块）向上飞起再落下，一圈 radius 格；只是看得见，不改世界里的方块，不掉东西；全世界同时最多 ${DEBRIS_LIMITS.alive} 块。` +
  `或者打碎方块 {type:"break", at, where: self|target|hit, hit, forward, up, left, radius ${BREAK_LIMITS.radius.min}–${BREAK_LIMITS.radius.max}, height ${BREAK_LIMITS.height.min}–${BREAK_LIMITS.height.max}, hardness ${BREAK_LIMITS.hardness.min}–${BREAK_LIMITS.hardness.max}, drops}：临时地形写了 hardness 时，破块事件的 hardness 达到它的硬度就打碎整组；这个事件会挖掉真实方块——那个位置（算法和碎块一样）半径 radius 格、往上 height 格的一根圆柱里，硬度不超过 hardness 的方块像被挖掉一样碎掉（有破碎声和碎屑；drops 为 true 时掉出方块本身，false 什么都不掉）。硬度参考：泥土 0.5、石头和原木 1.5–2、圆石和砖 2、铁块 5、黑曜石 50（所以写 10 也挖不动黑曜石）；一次最多 ${BREAK_LIMITS.blocks} 块。箱子、熔炉这类有存储的方块、基岩这类打不坏的和水、岩浆永远不碰；世界的游戏规则 mobGriefing 关着时（Forge、NeoForge 上还有领地模组说不行时）一块都不打碎，招式照常。冲撞撞柱子、砸地砸出坑时用它，最好同时放碎块和晃屏。` +
  ` 这几样所有敌对生物的招式都能用；落地猛砸、吼叫的那一刻放。`

export const BOSS_SUMMARY =
  "可选：Boss（boss，只有敌对生物能写）——屏幕上方的血条（颜色、刻度、战斗时天色变暗；bar.look 可以引用一个自己画的血条资产）、登场（先睡着——有习性的话是照习性活动、还没见过谁——玩家走近才醒，醒来的动作和吼声里不动也打不死；会飞的 Boss 这段是在叫醒它的玩家头顶盘旋的空中演出）、可以指定登场以后的第一招（opening）、最多 3 个阶段（血量掉到线上先变身，可用 sound 在变身开始时播放声音，再换血条颜色、变快（会飞的连飞行也变快）、伤害变大、换能用的招式——整份重列，或者在上一阶段的基础上加招（add）减招（remove）；一刀打不穿两个阶段）、死亡演出（动作播几秒、经验分几次喷出、最后一声只有声光的爆炸）、登场和死亡还能写成一串带时间的步骤（steps：动作、声音、粒子、特效、晃屏、骨骼一个个显出发光、部件一件件脱手、放下一片树或一圈方块、天气）、离开出生点太远没人在附近时回去回满血、像大型 Boss 模组那样的底子（一下最多掉多少血、几秒里最多掉多少血、脱战回血、附近玩家越多血越厚伤害越高）、还可以给它一个随世界生成的巢（lair：生成时放进一只）。招式里还能放晃屏（shake：范围内玩家的屏幕晃动，玩家可以在设置里关）和碎块（debris：地面冒尘、碎块飞起再落下，只是看得见）。"
