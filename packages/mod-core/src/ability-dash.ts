import { z } from "zod"
import { ABILITY_LIMITS, TICKS } from "./ability-words"
import { BOSS_LIMITS } from "./boss-words"
import type { Ability, AbilityHit } from "./entity-runtime"
import { LeaveMoveSchema } from "./arena"
import { LeapMoveSchema } from "./ability-tactics"
import { EPIC_LIMITS } from "./ability-words"
import { ImpactPairSchema, impactFxWords } from "./impact-fx"

/**
 * Boss 能力 4 (位移类招式) as data: a sustained dash an ability gives itself (`moves[]` of `type: "dash"`), and a push or pull an area hit leaves on
 * whoever it struck for some seconds (`force`). Everything is decided and done on the server; the numbers here are what the schema, the generated Java,
 * the words, the pictures and the reviewer all read. No Node APIs and nothing of `entity-runtime` but its types: the schema there is built from these.
 */

/**
 * - dash `speed`: blocks a second it goes (a player walks 4.3, sprints 5.6); `distance`: the most it goes in all; at most one dash an ability (`perAbility`).
 *   `sweep`: the hit a dash carries is counted along the stretch it went in a tick, at points no further apart than this (blocks), so a fast dash leaves no gap.
 * - force `strength`: blocks a second the one it struck is carried at, on top of how they move themselves (for `side`, negative is to its own right);
 *   `seconds`: how long it keeps carrying them after the hit.
 */
export const DASH_LIMITS = { speed: { min: 2, max: 40 }, distance: { min: 1, max: 32 }, perAbility: 1, sweep: 0.5 } as const
export const FORCE_LIMITS = { strength: { min: 0.5, max: 16 }, seconds: { min: 0.1, max: 10 } } as const
export const FORCE_KINDS = { push: "从打中的地方往外推", pull: "往打中的地方拉", side: "往它自己的一侧推" } as const
export type ForceKind = keyof typeof FORCE_KINDS

/** The highest step a body walks up without a jump when its document says nothing (`hitbox.core.step`): the game's own for a mob. */
export const DEFAULT_STEP = 0.6
/**
 * How far from it a player stays in its fight, in blocks: an ordinary creature picks and keeps its target within its follow range, the game's usual one
 * (`ENGAGEMENT_LIMITS.distance`, 24, or further when an ability starts further: `fabric/entity.ts` `targetReach`); a boss counts a player within
 * `BOSS_LIMITS.battle` as in the fight. A test holds `usual` to `ENGAGEMENT_LIMITS.distance` (that file builds the schema from this one, so it cannot be read here).
 */
export const FIGHT_RANGE = { usual: 24, boss: BOSS_LIMITS.battle } as const

const time = z.number().finite().min(0).max(ABILITY_LIMITS.seconds)

/** A push it gives itself (as it always was): at `at` its speed becomes `forward` blocks a tick the way it faces (negative: backward) and, when `up` is above 0, `up` upward. */
export const PushMoveSchema = z.strictObject({ at: time, forward: z.number().finite().min(-3).max(3), up: z.number().finite().min(0).max(2) })

/**
 * A dash: from `from` to `to` (seconds of the ability) the server moves it straight ahead every tick by `speed` blocks a second, the way it faced when getting ready
 * ended (`aim: "locked_at_windup"`, the only way there is: the dash may be stepped out of), colliding with the world as its own collision box does (it walks up what
 * its step height lets it), until it has gone `distance` blocks or, with `stop_at_wall`, until a wall stops it. `hit` (an index into the ability's `hits`, or null):
 * an area hit counted on every tick of the dash from its own `at`, over the stretch it went in that tick, each one it holds struck once in the whole dash.
 */
export const DashMoveSchema = z.strictObject({
  type: z.literal("dash"),
  from: time,
  to: time,
  speed: z.number().finite().min(DASH_LIMITS.speed.min).max(DASH_LIMITS.speed.max),
  distance: z.number().finite().min(DASH_LIMITS.distance.min).max(DASH_LIMITS.distance.max),
  // 第 3 步: or "predicted", the way to where the one it fights will be when it gets there (`fabric/ability-dash.ts`, `abilityLeadYaw`), decided when the dash starts.
  aim: z.enum(["locked_at_windup", "predicted"]),
  stop_at_wall: z.boolean(),
  break_hardness: z.number({ error: "撞碎方块的硬度请填 0.1 到 10。" }).min(0.1, "硬度至少 0.1，取消破坏请删掉 break_hardness。").max(10, "冲刺能撞碎的硬度上限是 10。").optional(),
  hit: z.number().int().min(0).max(EPIC_LIMITS.hits - 1).nullable(),
  /** r29: what is shown where it meets a wall that stops it (`wall`, once a dash) and where its hit strikes each one (`touch`) (`ImpactPairSchema`). */
  impact: ImpactPairSchema.optional(),
})
// Boss 能力 13: or a boss leaving the field for a while (`LeaveMoveSchema`, arena.ts).
// 第 3 步: or a leap (`LeapMoveSchema`, ability-tactics.ts).
export const AbilityMoveSchema = z.union([PushMoveSchema, DashMoveSchema, LeaveMoveSchema, LeapMoveSchema])
export type PushMove = z.infer<typeof PushMoveSchema>
export type DashMove = z.infer<typeof DashMoveSchema>
export type AbilityMove = z.infer<typeof AbilityMoveSchema>

/**
 * What an area hit leaves on everyone it struck, for `seconds` after it: every tick they are carried at `strength` blocks a second (once their own drag is
 * counted: on the ground the push builds up to that speed within a few ticks) — `push` away from where the hit came from (its place, or the creature),
 * `pull` toward it (no further than its edge), `side` across, to the creature's own left as it faced at the hit (negative strength: its right).
 */
export const HitForceSchema = z.strictObject({
  kind: z.enum(["push", "pull", "side"]),
  toward: z.enum(["shape", "origin"]).optional(),
  strength: z.number().finite().min(-FORCE_LIMITS.strength.max).max(FORCE_LIMITS.strength.max),
  seconds: z.number().finite().min(FORCE_LIMITS.seconds.min).max(FORCE_LIMITS.seconds.max),
})
export type HitForce = z.infer<typeof HitForceSchema>

export const isDash = (move: AbilityMove): move is DashMove => "type" in move && move.type === "dash"
export const isPush = (move: AbilityMove): move is PushMove => !("type" in move)
/** The dash of an ability, with its place in `moves`; null when it has none. */
export function abilityDash(ability: Pick<Ability, "moves">) {
  const index = ability.moves.findIndex(isDash)
  return index < 0 ? null : { index, dash: ability.moves[index] as DashMove }
}
/** True when the ability carries itself toward what is ahead: a push forward or a dash. Such an ability's reach is not what its shapes alone say. */
export const movesForward = (ability: Pick<Ability, "moves">) => ability.moves.some((move) => (isDash(move) ? true : isPush(move) && move.forward > 0))
/** True for the hit a dash of this ability carries: it is counted along the dash, not once at its own moment. */
export const dashCarries = (ability: Pick<Ability, "moves">, hit: number) => abilityDash(ability)?.dash.hit === hit
/** The force an area hit leaves, or null. */
export const hitForce = (hit: AbilityHit): HitForce | null => (hit.type === "area" ? (hit.force ?? null) : null)

const tickOf = (seconds: number) => Math.round(seconds * TICKS)

/**
 * A dash as server ticks (the ability's own ticks, as `abilityPlan` counts them, never past its end): `start`, the tick it starts on; `ticks`, how many ticks it
 * moves; `step`, blocks a tick; `hitFrom`, the tick from which the hit it carries is counted (null: none); `reach`, blocks it can go in that time (at most `distance`).
 */
export function dashPlan(ability: Pick<Ability, "moves" | "length" | "hits">) {
  const found = abilityDash(ability)
  if (!found) return null
  const length = Math.max(1, tickOf(ability.length))
  const at = (seconds: number) => Math.min(length, tickOf(seconds))
  const { dash } = found
  const start = at(dash.from)
  const ticks = Math.max(1, at(dash.to) - start)
  const step = dash.speed / TICKS
  const carried = dash.hit === null ? null : ability.hits[dash.hit]
  return { index: found.index, dash, start, ticks, step, hitFrom: carried ? Math.max(start, at(carried.at)) : null, reach: Math.min(dash.distance, step * ticks) }
}
export type DashPlan = NonNullable<ReturnType<typeof dashPlan>>

/** The ticks a force carries its victims, at least one. */
export const forceTicks = (force: HitForce) => Math.max(1, tickOf(force.seconds))
/** About how far a force carries someone standing still, in blocks: its speed over its time (the build-up of the first ticks is left out). */
export const forceDrift = (force: HitForce) => Math.abs(force.strength) * force.seconds

/**
 * What the schema refuses of an ability's dash and of its hits' forces, each with where it is; `AbilitySchema` adds them as its issues.
 * - one dash an ability; it starts when getting ready has ended or later (its direction is the one it faced then), ends after it starts and not after the ability,
 *   and in that time can go the whole `distance` at its speed;
 * - the hit it carries is an area hit round the creature (an arc, a box or a ball; not put elsewhere, not warned of, not from a bone) whose moment lies within the dash;
 * - a push or a pull has a positive strength; a side push is not 0 either way.
 */
export function dashForceIssues(ability: Pick<Ability, "moves" | "hits" | "windup" | "length">) {
  const found: { path: (string | number)[]; message: string }[] = []
  const dashes = ability.moves.flatMap((move, index) => (isDash(move) ? [{ move, index }] : []))
  dashes.slice(DASH_LIMITS.perAbility).forEach(({ index }) => found.push({ path: ["moves", index], message: `一个招式最多 ${DASH_LIMITS.perAbility} 段冲刺（type:"dash"）：要冲两次，就做成两个招式，或者用连招把它们接起来` }))
  for (const { move: dash, index } of dashes.slice(0, DASH_LIMITS.perAbility)) {
    const path = (field: string) => ["moves", index, field]
    if (dash.from < ability.windup - 1e-9) found.push({ path: path("from"), message: dash.aim === "predicted" ? `预判的冲刺（aim 写的是 predicted）在冲刺开始那一刻按目标的走向定方向，要等蓄力结束：冲刺（from）不能比蓄力结束（windup，第 ${ability.windup} 秒）早` : `冲刺的方向在蓄力结束那一刻定下（aim 写的是 locked_at_windup），所以冲刺（from）不能比蓄力结束（windup，第 ${ability.windup} 秒）早` })
    if (dash.to > ability.length + 1e-9) found.push({ path: path("to"), message: "冲刺结束的时刻（to）不能比招式全长（length）还晚" })
    const ticks = tickOf(Math.min(dash.to, ability.length)) - tickOf(dash.from)
    if (ticks < 1) found.push({ path: path("to"), message: "冲刺结束的时刻（to）要比开始（from）至少晚一刻（0.05 秒）" })
    else if ((dash.speed / TICKS) * ticks < dash.distance - 1e-6)
      found.push({ path: path("distance"), message: `以每秒 ${dash.speed} 格冲 ${Number((ticks / TICKS).toFixed(2))} 秒（from 到 to）只冲得出 ${Number(((dash.speed / TICKS) * ticks).toFixed(2))} 格，比 distance（${dash.distance} 格）短：把 to 往后挪、把 speed 加大，或者把 distance 改小` })
    if (dash.impact?.touch && dash.hit === null) found.push({ path: path("impact"), message: "冲刺撞到人那一刻的声光（impact.touch）放在冲刺带的那次出手打中人的时候：请给冲刺写 hit（沿路打的那次范围出手），或者去掉 impact.touch" })
    if (dash.hit === null) continue
    const hit = ability.hits[dash.hit]
    if (!hit) {
      found.push({ path: path("hit"), message: `这个招式只有 ${ability.hits.length} 次出手，没有第 ${dash.hit} 次（从 0 数）` })
      continue
    }
    if (hit.type !== "area") {
      found.push({ path: path("hit"), message: `冲刺沿路打的那一下（hit）要是一次范围出手（type:"area"），第 ${dash.hit} 次出手是 ${hit.type}` })
      continue
    }
    if (hit.shape.type !== "arc" && hit.shape.type !== "box" && hit.shape.type !== "sphere") found.push({ path: path("hit"), message: `冲刺沿路打的那一下只能是它身边的扇形（arc）、盒子（box）或球（sphere），跟着它一起往前扫；第 ${dash.hit} 次出手是 ${hit.shape.type}` })
    if (hit.shape.type === "arc" && (hit.shape.inner ?? 0) > 0) found.push({ path: path("hit"), message: `冲刺沿路打的那一下一路扫过去，中间空心（inner）没有意义：第 ${dash.hit} 次出手的扇形写了 inner，去掉它` })
    if (hit.place !== undefined && hit.place !== "self") found.push({ path: path("hit"), message: `冲刺沿路打的那一下跟着它自己走，不能落在别处（place）：第 ${dash.hit} 次出手写了 place` })
    if (hit.warn !== undefined) found.push({ path: path("hit"), message: `冲刺沿路打的那一下跟着它自己走，落点事先定不下来，不能写预警（warn）：第 ${dash.hit} 次出手写了 warn` })
    if (hit.bone !== undefined) found.push({ path: path("hit"), message: `冲刺沿路打的那一下从脚下算（用 shape 的 forward、up、left 摆到身前），不能写 bone：第 ${dash.hit} 次出手写了 bone` })
    if (tickOf(hit.at) < tickOf(dash.from) || tickOf(hit.at) >= tickOf(dash.to)) found.push({ path: ["hits", dash.hit, "at"], message: `冲刺沿路打的那一下从它自己的时刻（at）起，在冲刺的每一刻都判定，所以 at 要落在冲刺里（第 ${dash.from} 秒起、第 ${dash.to} 秒以前）；一般写成和 from 一样` })
  }
  ability.hits.forEach((hit, index) => {
    const force = hitForce(hit)
    if (!force) return
    if (force.kind === "side" && force.toward) found.push({ path: ["hits", index, "force", "toward"], message: "侧推按出手朝向走，请删掉 toward；选 pull 或 push 时才需要中心。" })
    if (force.kind !== "side" && force.strength <= 0) found.push({ path: ["hits", index, "force", "strength"], message: `推（push）和拉（pull）的力度（strength）写正数，方向由 kind 定；往它自己的右边推用 kind:"side" 写负数` })
    if (Math.abs(force.strength) < FORCE_LIMITS.strength.min - 1e-9) found.push({ path: ["hits", index, "force", "strength"], message: `力度（strength，每秒带着走几格）最小 ${FORCE_LIMITS.strength.min}（side 往右推写 -${FORCE_LIMITS.strength.min} 以下）：再小就感觉不到` })
  })
  return found
}

/** 「第 0.6–1.6 秒笔直往前冲 20 格（每秒 20 格，方向在蓄力结束时定下），撞墙就停，沿路用第 1 次出手打，每个人只挨一下」 */
export function dashWords(ability: Pick<Ability, "moves">) {
  const found = abilityDash(ability)
  if (!found) return null
  const { dash } = found
  return `第 ${Number(dash.from.toFixed(2))}–${Number(dash.to.toFixed(2))} 秒笔直往前冲 ${Number(dash.distance.toFixed(2))} 格（每秒 ${Number(dash.speed.toFixed(2))} 格，${dash.aim === "predicted" ? "朝目标冲到时会在的地方预判" : "方向在蓄力结束时定下"}）${dash.break_hardness ? `，沿途撞碎硬度不超过 ${dash.break_hardness} 的方块` : ""}${dash.stop_at_wall ? "，撞墙就停" : "，撞墙也不停，顶着墙直到时间到"}${dash.hit === null ? "" : `，沿路用第 ${dash.hit + 1} 次出手打，每个人只挨一下`}${dash.impact?.wall ? `，撞墙的那一刻${impactFxWords(dash.impact.wall)}` : ""}${dash.impact?.touch ? `，撞到人的那一刻在那人身上${impactFxWords(dash.impact.touch)}` : ""}`
}

/** 「之后 3 秒往它自己左边推（每秒 4 格）」 */
export const forceWords = (force: HitForce) =>
  `之后 ${Number(force.seconds.toFixed(2))} 秒${force.kind === "push" ? "把打中的往外推" : force.kind === "pull" ? "把打中的往里拉" : `把打中的往它自己的${force.strength < 0 ? "右" : "左"}边推`}（目标速度每秒 ${Number(Math.abs(force.strength).toFixed(2))} 格，实际位移受阻力、碰撞和移动影响）${force.kind === "side" ? "" : force.toward === "origin" ? "，以出手原点为中心" : "，以判定形状为中心"}`

/** What an AI is told about dashes and forces (one text: `ABILITY_INSTRUCTIONS` adds it after the moves). */
export const DASH_INSTRUCTIONS =
  ` moves 里还可以写一段冲刺（每个招式最多 ${DASH_LIMITS.perAbility} 段）：{type:"dash", from, to, speed, distance, aim:"locked_at_windup", stop_at_wall, hit}——从 from 到 to 秒（from 不能早于 windup，to 不能晚于 length），服务端每一刻把它朝面前笔直推出去，每秒 speed 格（${DASH_LIMITS.speed.min} 到 ${DASH_LIMITS.speed.max}；玩家走路每秒 4.3 格、疾跑 5.6 格），一共最多 distance 格（${DASH_LIMITS.distance.min} 到 ${DASH_LIMITS.distance.max}；speed 乘上 to 减 from 要够 distance）。方向在蓄力结束那一刻定下（aim 写 locked_at_windup；写 predicted 是冲刺开始时朝目标会在的地方冲，见后面的「跳跃和预判」），之后不再转，所以看准了能闪开。它按自己的碰撞箱（大体型就是主体那个箱子）撞地形：跨得上的台阶（碰撞箱的 step，不写是 ${DEFAULT_STEP} 格）照样冲上去；stop_at_wall=true 时撞上墙就停下（招式的动作照常播完），false 时顶着墙直到 to。临时地形写了 hardness 时，同一冲刺的 break_hardness 达到它的硬度就会把整组撞碎。要沿路撞碎方块，给这段冲刺写 break_hardness（0.1–10，比如 2）：沿途撞碎不超过这个硬度的方块，只有撞不碎的才算撞墙；受生物破坏规则限制，跳过容器和液体，每次冲刺最多破坏 256 块。要自己定在哪一刻破、破多大一片、掉不掉落，就不写 break_hardness，改在冲刺 from 到 to 之间排若干 break 事件：where 写 self、forward 写碰撞箱前方的偏移，硬度和掉落按实际需要填写；冲刺写 stop_at_wall:false，遇到方块时等附近的 break 生效再继续。世界关闭生物破坏方块时，两种写法都破不了，冲刺仍会被地形挡住。` +
  ` hit 写这段冲刺沿路打的那一次出手（hits 里从 0 数的第几个，不打人就写 null）：那一下要是它身边的 arc、box 或 sphere（不能写 place、warn、bone），at 写在冲刺里（一般和 from 一样）；从 at 起冲刺的每一刻都按它这一刻扫过的那一段判定，冲得再快也不漏人，同一个人整段冲刺只挨一下，这一下不会在 at 那一刻另外再打一次。冲刺在天上不起作用（和别的位移一样）；招式被打断，冲刺当场停下。看图时冲刺画成地上一支和 distance 一样长的箭头，加上那一下沿路扫过的整条范围。` +
  ` 范围出手可以写 blocked_by_walls:true，原点与目标之间有实心方块时，伤害、效果和推拉都被挡住。范围出手还可以写 force：{kind, strength, seconds}——打中以后的 seconds 秒（${FORCE_LIMITS.seconds.min} 到 ${FORCE_LIMITS.seconds.max}）里，每一刻都给被这一下打中的人（玩家和生物都算）加一股力，向目标速度每秒 strength 格逐刻加力（${FORCE_LIMITS.strength.min} 到 ${FORCE_LIMITS.strength.max}）。普通平地上，站着不动的玩家和生物持续被推或被拉 2 秒，实测位移约为 strength × seconds × 0.95 格（strength 3、seconds 2 时约 5.7 格）。移动、抗性、碰撞会让它变少，提前到达拉力中心也会缩短路程。kind 是 ${Object.entries(FORCE_KINDS).map(([kind, words]) => `${kind}（${words}）`).join("、")}。push 和 pull 默认以偏移后的球心或盒心为中心；环和扇形取圆心，线和锥取出手原点。toward:"origin" 使用偏移前的落点，未指定落点时是施法者。拉力在靠近中心时停止加力；side 是它出手时朝向的左边，strength 写负数就往右边推（起风、把人吹到一边）。击退抗性照样减弱它。看图时在范围上画出推的方向（箭头），标出推几秒；推得太远、会把玩家推出它追人的范围（一般 ${FIGHT_RANGE.usual} 格，Boss 是 ${FIGHT_RANGE.boss} 格），检查会说出来。` +
  ` 例：铁额撞——{"type":"dash","from":0.6,"to":1.6,"speed":20,"distance":20,"aim":"locked_at_windup","stop_at_wall":true,"hit":0}，hits 第 0 个是 {"type":"area","at":0.6,"shape":{"type":"box","forward":1.5,"up":1,"left":0,"width":3,"height":2.5,"depth":2},"hits":"everyone","damage":10,"knockback":1.5,"effects":[]}；风伯把人吹到一边——范围出手加 "force":{"kind":"side","strength":5,"seconds":3}。`
