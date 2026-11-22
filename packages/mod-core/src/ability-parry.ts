import { z } from "zod"
import { ABILITY_LIMITS, TICKS } from "./ability-words"
import type { Ability } from "./entity-runtime"

/**
 * Boss 能力 14 (夺兵) as data: an ability that starts when the creature is hit (`on_hurt`) instead of when the one it fights stands at a distance, and the
 * 「缴械」 (disarm) it may leave on the one who hit it. Everything is decided on the server: whether a blow is answered (its kind, the attacker's distance, the chance,
 * the wait, the phase), whether the blow does anything, and how long the attacker's melee attacks are called off. The numbers here are what the schema, the generated
 * Java, the words, the timeline picture and the reviewer all read. No Node APIs and nothing of `entity-runtime` but its types: the schema there is built from these.
 */

/**
 * - `chance`: of one blow that may be answered (the ability is not running, its wait is over, its phase allows it, the attacker stands in its window), how likely it is.
 * - `cooldown`: seconds it waits after the ability has ended before a blow may start it again.
 * - `disarm`: seconds the attacker's melee attacks are called off and what they hold shows the game's cooldown.
 * - `review`: what the reviewer measures against: a chance above `chance`, a wait under `cooldown` seconds, and a fight in which a player's melee lands less than `share`
 *   of what it would without the parry, are said. `swing`: blows a second a player lands with a sword at full charge (the sword's attack speed, 1.6), the pace the share is counted at.
 * - `melee`: the farthest a player's melee reaches from the middle of the creature, beside half its width (the game's reach of 3 blocks, from the eyes, and a little more for the edge).
 * - `pushed`: how much farther than that a melee parry's `max_distance` should reach: a blow knocks the creature back (Fable's acceptance, 2026-11-15: two blows pushed
 *   a creature that did not walk back out of a 5-block window, and the parry never started again).
 */
export const PARRY_LIMITS = {
  chance: { min: 0.01, max: 1 },
  cooldown: { max: ABILITY_LIMITS.cooldown },
  disarm: { min: 0.5, max: 10 },
  review: { chance: 0.5, cooldown: 2, share: 0.5 },
  swing: 1.6,
  melee: 3.3,
  pushed: 1,
} as const

/** Which blows may start it: `melee` a blow struck by hand or with what the attacker holds (not a thrown or shot thing, not thorns); `any` every blow somebody dealt (an arrow too). */
export const PARRY_BY = { melee: "近战打中它（空手或拿着武器直接打；箭、三叉戟、荆棘都不算）", any: "谁打中它都算（近战、箭、扔出去的三叉戟……，只要有出手的人）" } as const

/**
 * `on_hurt` of an ability: when somebody hits the creature, the ability may start, aimed at whoever hit it (they become its target), instead of being chosen by distance.
 * - `chance` (0.01–1) of each blow that may start it, `cooldown` seconds after it ends before it may again, `by` which blows (`PARRY_BY`);
 * - `block`: the blow that starts it does nothing to the creature (it is parried); false: the blow lands as any other and the ability answers it;
 * - `disarm` (optional): the player who hit it is disarmed for `seconds` from that moment: their melee attacks are called off, and what they hold shows the game's cooldown.
 * The ability's `start` still says where the attacker has to stand (`min_distance`–`max_distance`, in sight when `line_of_sight`) and, when several such abilities answer one
 * blow, how often each is the one (`weight`); its own wait is this `cooldown`, so `start.cooldown` is 0.
 */
export const OnHurtSchema = z.strictObject({
  chance: z.number().finite().min(PARRY_LIMITS.chance.min).max(PARRY_LIMITS.chance.max),
  cooldown: z.number().finite().min(0).max(PARRY_LIMITS.cooldown.max),
  by: z.enum(["melee", "any"]),
  block: z.boolean(),
  front_yaw: z.number().finite().min(0).max(90).optional(),
  disarm: z.strictObject({ seconds: z.number().finite().min(PARRY_LIMITS.disarm.min).max(PARRY_LIMITS.disarm.max) }).optional(),
})
export type OnHurt = z.infer<typeof OnHurtSchema>

type Parried = Pick<Ability, "start"> & { on_hurt?: OnHurt | undefined }

/** Whether an ability starts when the creature is hit (and is never chosen by distance). */
export const isParry = (ability: { on_hurt?: OnHurt | undefined }): boolean => ability.on_hurt !== undefined
/** The ticks a disarm lasts, at least one; 0 without one. */
export const disarmTicks = (onHurt: OnHurt) => (onHurt.disarm ? Math.max(1, Math.round(onHurt.disarm.seconds * TICKS)) : 0)
const num = (value: number, digits = 2) => Number(value.toFixed(digits))
const percent = (value: number) => `${num(value * 100, 1)}%`

/**
 * What the schema refuses of one ability's `on_hurt`, each with where it is (`AbilitySchema` adds them as its issues): its wait is `on_hurt.cooldown`, so `start.cooldown` is 0
 * (two waits would leave the person guessing which one counts); a dive flies at where its target stood and is no answer to a blow.
 */
export function parryIssues(ability: Pick<Ability, "start" | "dive"> & { on_hurt?: OnHurt | undefined }) {
  const found: { path: (string | number)[]; message: string }[] = []
  if (!ability.on_hurt) return found
  if (ability.start.cooldown !== 0) found.push({ path: ["start", "cooldown"], message: `写了 on_hurt 的招式，歇多久写在 on_hurt.cooldown 里（现在是 ${ability.on_hurt.cooldown} 秒），start.cooldown 写 0：两处都写就分不清按哪个等` })
  if (ability.dive) found.push({ path: ["dive"], message: "被打中时才起的招式（on_hurt）不能是俯冲（dive）：俯冲要先飞起来再冲向目标原来站的地方，接不住这一下" })
  return found
}

/**
 * What a creature as a whole may not have with an ability started by a blow (`creatureDocumentIssues` adds them): a flier (its flight decides by the ability that runs, and
 * nothing of it is written for a blow), a combo step (a step is started by the combo, never by a blow), and a boss's first attack (`intro.opening` waits for it, and a blow may never come).
 */
export function parryDocumentIssues(creature: { abilities?: readonly { id: string; name?: string; on_hurt?: OnHurt | undefined }[] | null; combos?: readonly { name: string; steps: readonly string[] }[] | null; flight?: unknown; boss?: { intro?: { opening?: string | null | undefined } | null } | null }) {
  const found: { path: (string | number)[]; message: string }[] = []
  const abilities = creature.abilities ?? []
  const parries = abilities.filter(isParry)
  if (!parries.length) return found
  if (creature.flight) abilities.forEach((ability, index) => isParry(ability) && found.push({ path: ["abilities", index, "on_hurt"], message: "会飞的生物（写了 flight）现在还不能写被打中时起的招式（on_hurt）：飞行要按正在出的那一招来飞，被打中时插进来的招式这一块还没做。把 on_hurt 去掉，或者去掉 flight" }))
  ;(creature.combos ?? []).forEach((combo, index) =>
    combo.steps.forEach((step, place) => parries.some((ability) => ability.id === step) && found.push({ path: ["combos", index, "steps", place], message: `连招「${combo.name}」的第 ${place + 1} 步 ${step} 是被打中时才起的招式（on_hurt）：连招里的每一步由连招接着出，不等人打它。换成别的招式，或者把那一招的 on_hurt 去掉` })),
  )
  const opening = creature.boss?.intro?.opening
  if (opening && parries.some((ability) => ability.id === opening)) found.push({ path: ["boss", "intro", "opening"], message: `登场以后的第一招（opening）${opening} 是被打中时才起的招式（on_hurt）：没人打它它就一直不出，别的招式也一直等着。换成一个按距离出的招式` })
  return found
}

// ---- the time line: what happens from the blow on, in seconds ----

/**
 * One answered blow on the creature's own clock, from the moment of the blow (0): the ability runs from 0 to `end` (getting ready until `windup`, its hits at `hits`), its
 * wait until `ready` (the next blow that may start it again), and the attacker's disarm from 0 to `disarm` (null without one). The same numbers the generated Java runs on
 * (`abilityPlan`'s ticks, `disarmTicks`).
 */
export function parryTimeline(ability: Pick<Ability, "windup" | "length" | "hits"> & { on_hurt?: OnHurt | undefined }) {
  const onHurt = ability.on_hurt
  if (!onHurt) return null
  const tick = (seconds: number) => Math.round(seconds * TICKS)
  const end = Math.max(1, tick(ability.length)) / TICKS
  const windup = Math.min(end, tick(ability.windup) / TICKS)
  return {
    windup,
    hits: ability.hits.map((hit) => ({ at: Math.min(end, Math.max(windup, tick(hit.at) / TICKS)), damage: hit.type === "area" || hit.type === "shot" || hit.type === "projectile" ? (hit.damage ?? null) : null })),
    end,
    ready: end + tick(onHurt.cooldown) / TICKS,
    disarm: onHurt.disarm ? disarmTicks(onHurt) / TICKS : null,
    block: onHurt.block,
  }
}
export type ParryTimeline = NonNullable<ReturnType<typeof parryTimeline>>

/**
 * How much of a player's melee reaches the creature while it answers blows like this, against what would without it (0–1), for one player who keeps striking with a
 * sword at full charge (`PARRY_LIMITS.swing` blows a second) and is the one it answers: blows wait for a parry (one in `1 / chance`), the parried blow does nothing when it
 * `block`s, the blows during the disarm are called off, and the blows from the end of the disarm until it may answer again land (also those while the ability runs).
 * Anyone else's blows are not counted: they are never disarmed by this player's parry.
 */
export function parryShare(ability: Pick<Ability, "windup" | "length" | "hits"> & { on_hurt?: OnHurt | undefined }, swing: number = PARRY_LIMITS.swing) {
  const line = parryTimeline(ability)
  if (!line || !ability.on_hurt) return null
  const chance = ability.on_hurt.chance
  const waiting = (1 - chance) / chance
  const window = line.ready
  const disarm = line.disarm ?? 0
  const landed = waiting + (line.block ? 0 : 1) + swing * Math.max(0, window - disarm)
  const seconds = 1 / (chance * swing) + Math.max(window, disarm)
  return { share: landed / (swing * seconds), window, disarm, landed, seconds }
}

// ---- words ----

/** 「被近战打中（出手的人离它 0–4 格、看得见）的时候，有 15% 的机会」 — the start of an ability started by a blow, where `abilityWords.start` says a window. */
export function parryStartWords(ability: Parried & { on_hurt: OnHurt }) {
  const { start, on_hurt: onHurt } = ability
  return `被${onHurt.by === "melee" ? "近战" : "人"}打中（出手的人离它 ${num(start.min_distance)}–${num(start.max_distance)} 格${start.line_of_sight ? "、看得见" : ""}${onHurt.front_yaw === undefined ? "" : `、启用稳重时在正面左右各 ${onHurt.front_yaw}° 内`}）的时候，有 ${percent(onHurt.chance)} 的机会`
}

/** 「架住的那一下不掉血；出手的玩家缴械 3 秒（……）；用完歇 8 秒才会再起」 — what an ability started by a blow does beside its hits, for its summary. */
export function parryWords(onHurt: OnHurt) {
  return [
    onHurt.block ? "架住的那一下不掉血" : "那一下照样掉血",
    ...(onHurt.disarm ? [`出手的玩家缴械 ${num(onHurt.disarm.seconds)} 秒（这期间近战打不出去，手里的东西显示冷却）`] : []),
    onHurt.cooldown > 0 ? `用完歇 ${num(onHurt.cooldown)} 秒才会再被打出来` : "用完马上又能被打出来",
  ].join("，")
}

/** The label of the timeline picture and the lines under it. */
export function parryTimelineWords(ability: Pick<Ability, "name" | "start" | "windup" | "length" | "hits"> & { on_hurt?: OnHurt | undefined }) {
  const line = parryTimeline(ability)
  if (!line || !ability.on_hurt) return null
  const share = parryShare(ability)!
  return {
    label: `「${ability.name}」被打中以后：白线是挨打的那一刻（0 秒），蓝条是招式（深色是蓄力），红线是出手，灰条是歇着（这期间不会再起），橙条是出手的玩家缴械的时间；横轴 0–${num(Math.max(line.ready, line.disarm ?? 0))} 秒`,
    lines: [
      `「${ability.name}」：第 0 秒${parryStartWords({ start: ability.start, on_hurt: ability.on_hurt })}起招，${line.block ? "架住这一下（不掉血）" : "这一下照样掉血"}；蓄力到第 ${num(line.windup)} 秒，第 ${line.hits.map((hit) => num(hit.at)).join("、")} 秒出手反击，第 ${num(line.end)} 秒收招；歇到第 ${num(line.ready)} 秒才会再被打出来。`,
      ...(line.disarm !== null ? [`出手的玩家从第 0 秒缴械到第 ${num(line.disarm)} 秒：只缴他一个人，别的玩家照常能打。${line.disarm > line.ready ? "缴械比它歇着还长：缴械没完它又能架了。" : ""}`] : []),
      `按一个玩家拿剑每秒砍 ${PARRY_LIMITS.swing} 下一直打它算，他的近战大约有 ${percent(share.share)} 能打上去（不架的话是 100%）。`,
    ],
  }
}

/** What an AI is told about abilities started by a blow and the disarm (one text: `ABILITY_INSTRUCTIONS` adds it after the dashes). */
export const PARRY_INSTRUCTIONS =
  ` 招式还可以写 on_hurt：{chance, cooldown, by, block, disarm}——写了它的招式不按距离挑，而是在它被打中的那一刻才起（夺兵、格挡反击）：被打中时，招式没在出、歇够了、阶段允许、出手的人站在 start 的 min_distance 到 max_distance 格之间（line_of_sight 为 true 时还要看得见）的话，就有 chance（${PARRY_LIMITS.chance.min} 到 ${PARRY_LIMITS.chance.max}）的机会起这一招，打它的人当场成为它的目标，它转过去对着他，照常播 clip、出 hits、放 events（架住的火星写成那一刻的 particle 或 effect，反手一击写成后面的出手）。by：${Object.entries(PARRY_BY).map(([key, words]) => `${key}（${words}）`).join("；")}。block 为 true 时，引出这一招的那一下不掉血（架住了），false 时那一下照常掉血、它再还手。cooldown 是这一招用完以后要歇几秒才能再被打出来（0 到 ${PARRY_LIMITS.cooldown.max}；写了 on_hurt 的招式 start.cooldown 写 0，start.weight 只在同一下能引出好几招时用来挑）。几个都能起的时候各自掷一次 chance，中了的按 weight 挑一个。` +
  ` disarm（可选）：{seconds}——打它的如果是玩家，从起招那一刻起 seconds 秒（${PARRY_LIMITS.disarm.min} 到 ${PARRY_LIMITS.disarm.max}）缴械：这期间他的近战攻击一律打不出去（服务端拦下），手里拿的东西显示冷却，屏幕下方提示还要几秒；只缴打它的那一个人，别的玩家照常。退出重进也还在（按剩下的时间），服务器重启就没了。生物打它不会被缴械。` +
  ` 写的时候想着玩家：chance 不要太大（一般 0.1 到 0.3），cooldown 不要是 0，缴械不要比它歇着的时间还长，不然近战几乎打不动它，审查会按一个玩家拿剑一直砍它算出近战还能打上去几成。会飞的生物、连招里的一步、Boss 登场后的第一招（opening）都不能是 on_hurt 的招式；要只在二阶段以后才会，照常写进阶段的 abilities 或 add。看图时这一招另有一张时间轴：挨打 → 架住（蓄力）→ 反击（出手）→ 歇着，下面一条是缴械的时间。` +
  ` 例：夺兵——{"id":"disarm","name":"夺兵","clip":"parry","windup":0.3,"length":1.2,"facing":"track","hits":[{"type":"area","at":0.6,"shape":{"type":"arc","reach":4,"angle":120,"low":-0.5,"high":3},"hits":"target","damage":16,"knockback":1,"effects":[]}],"moves":[],"start":{"min_distance":0,"max_distance":5,"line_of_sight":false,"cooldown":0,"weight":1},"stopped_by_hurt":false,"events":[{"type":"particle","at":0,"particle":"crit","count":24,"forward":1.2,"up":2,"left":0,"spread":0.6},{"type":"sound","at":0,"sound":"entity.zombie.attack_iron_door","volume":1,"pitch":1.4}],"on_hurt":{"chance":0.15,"cooldown":8,"by":"melee","block":true,"disarm":{"seconds":3}}}。`

/** One sentence for the creature's capability list and the ability summary. */
export const PARRY_SUMMARY = "招式还可以写成被打中时才起（on_hurt：按机会架住那一下、反手还击，可以让打它的玩家缴械几秒，期间近战打不出去）。"

// ---- the reviewer ----

/**
 * What the reviewer is told of a creature's abilities started by a blow (never a stop: each still works): one that may start again at once (no wait), a chance so high it
 * answers most blows, a fight in which one player's melee lands less than half of what it would (`parryShare`), a window a melee blow never comes from, and a creature
 * whose every ability waits for a blow (it never strikes first).
 */
export function parryReview(creature: { name: string; abilities?: readonly Ability[] | null; hitbox?: { core?: { width?: number | null } | null } | null }) {
  const found: { ability: string; rule: "ability_parry"; stops: false; text: string; fix: string; detail: string }[] = []
  const abilities = creature.abilities ?? []
  const say = (ability: Ability, text: string, fix: string, detail: string) => found.push({ ability: ability.id, rule: "ability_parry", stops: false, text, fix, detail: `ability ${ability.id}: ${detail}` })
  const reach = PARRY_LIMITS.melee + (creature.hitbox?.core?.width ?? 1) / 2
  for (const ability of abilities) {
    const onHurt = ability.on_hurt
    if (!onHurt) continue
    const share = parryShare(ability)!
    if (onHurt.cooldown < PARRY_LIMITS.review.cooldown)
      say(ability, `「${creature.name}」的招式「${ability.name}」用完${onHurt.cooldown === 0 ? "马上" : `只歇 ${num(onHurt.cooldown)} 秒`}就又能被打出来：玩家每打一下都要赌一次会不会被架住，打起来只觉得它一直在挡。`, `把 on_hurt.cooldown 改到 ${PARRY_LIMITS.review.cooldown} 秒以上（夺兵这类一般 6–10 秒）。`, `on_hurt.cooldown ${onHurt.cooldown}`)
    if (onHurt.chance > PARRY_LIMITS.review.chance)
      say(ability, `「${creature.name}」的招式「${ability.name}」被打中时有 ${percent(onHurt.chance)} 的机会起：大半的${onHurt.by === "melee" ? "近战" : "攻击"}都会被它接住，玩家会觉得怎么打都被挡。`, `把 on_hurt.chance 改到 ${PARRY_LIMITS.review.chance} 以下（夺兵这类一般 0.1–0.3）。`, `on_hurt.chance ${onHurt.chance}`)
    if (share.share < PARRY_LIMITS.review.share)
      say(ability, `「${creature.name}」的招式「${ability.name}」让近战几乎打不动它：按一个玩家拿剑每秒砍 ${PARRY_LIMITS.swing} 下一直打它算，${num(1 / onHurt.chance, 1)} 下里就有一下被${onHurt.block ? "架住" : "接住"}${share.disarm > 0 ? `、缴械 ${num(share.disarm)} 秒` : ""}，它要 ${num(share.window)} 秒以后才会再起；这样他的近战只有 ${percent(share.share)} 能打上去。`, `把 chance 改小、cooldown 改长${share.disarm > 0 ? "，或者把缴械（disarm.seconds）改短" : ""}，让近战至少有一半打得上去。`, `chance ${onHurt.chance}; block ${onHurt.block}; ability ${num(share.window - onHurt.cooldown)} s + cooldown ${onHurt.cooldown} s; disarm ${share.disarm} s; melee share ${num(share.share, 3)}`)
    if (onHurt.by === "melee" && ability.start.min_distance > reach)
      say(ability, `「${creature.name}」的招式「${ability.name}」只在近战打中它、出手的人离它 ${num(ability.start.min_distance)} 格以外时才起，可是近战最远只能在离它中心约 ${num(reach)} 格的地方打到它：这一招永远起不来。`, `把 start.min_distance 改成 0，或者把 by 改成 any（箭也算）。`, `start.min_distance ${ability.start.min_distance}; melee reach about ${num(reach)}`)
    else if (onHurt.by === "melee" && ability.start.max_distance < reach + PARRY_LIMITS.pushed)
      say(ability, `「${creature.name}」的招式「${ability.name}」只在出手的人离它 ${num(ability.start.max_distance)} 格以内时才起，可是近战在离它中心约 ${num(reach)} 格的地方就能打到它，每挨一下它还会被打退一点：站在近战边缘打它、或者把它打退一两下以后，这一招就起不来了（它自己不走回来的话一直起不来）。`, `把 start.max_distance 改到 ${num(reach + PARRY_LIMITS.pushed)} 格以上，或者给它击退抗性。`, `start.max_distance ${ability.start.max_distance}; melee reach about ${num(reach)} + pushed ${PARRY_LIMITS.pushed}`)
  }
  if (abilities.length && abilities.every(isParry))
    say(abilities[0]!, `「${creature.name}」的招式全都要被打中才起（on_hurt）：没人打它的时候它只会走到目标身边，一下也不出手。`, "再给它一个按距离出的招式（不写 on_hurt），让它自己也会进攻。", `${abilities.length} abilities, all on_hurt`)
  return found
}
