import { BranchChanceSchema } from "./combat"
import { CollisionRuleSchema } from "./combat"
import { ImpactPairSchema, impactFxWords } from "./impact-fx"
import { z } from "zod"
import { ABILITY_LIMITS, COMBO_LIMITS, EPIC_LIMITS, TICKS } from "./ability-words"

/**
 * 第 3 步 (Boss AI 与出招): every attack is a state with its own
 * range, chance and wait; chained states give a wind-up, a loop that runs until something happens, a strike and a recovery; the boss keeps turning to its target until
 * a set moment and then commits; it leaps at where the target is or will be; a combo goes on by how far the target is and whether the last blow landed; between attacks
 * it circles, closes in or backs off, faster and angrier as its life runs out. Nothing here is new to the game: all of it is the server moving and turning the creature,
 * and choosing among the abilities it already has.
 *
 * The schema of each piece is here (the creature's schema in `entity-runtime.ts` is built from them), with the checks that need more than one field, the plans the
 * generated Java is written from (`fabric/ability-tactics.ts`), the words and what an AI is told. Every field is optional: a creature that writes none of them is
 * generated exactly as before, to the byte. No Node APIs and nothing of `entity-runtime` but its types.
 */

/**
 * - `turn`: degrees a second an ability turns the body by while it tracks (`turn_speed`). The game's own mobs turn their heads 30 degrees a tick (600 a second), which is
 *   what an ability always turned by; 20 a second is a slow giant that can be walked round, 1200 one that whips round in a few ticks.
 * - `leap`: a leap's `height` (blocks above the straight line from where it leaves to where it lands), how far it goes at most (`distance`), how short of its
 *   target it lands (`short`), and the fewest ticks it is in the air (`ticks`: under four it is a hop, not an arc a player can read).
 * - `lead`: the most ticks ahead a predicted aim looks: two seconds; beyond that a player's change of mind is the only thing predicted.
 * - `stages`: the most stages one ability has (wind-up, a loop, a strike and a recovery, with room for one more strike and recovery).
 * - `reach`: blocks within which the target ends a loop that waits for it to be near.
 * - `branches`: the most branches one combo has.
 * - `distance`: blocks a between-attack style keeps from its target; `pause`: seconds it waits after an ability before another (0: at once, as it always did).
 * - `react`: seconds the target has to stay far (kited) or close (hugging) before it reacts; `urge`: ticks a reaction holds the choice to the abilities it names.
 * - `enrage`: below what share of its life it is enraged, and what that multiplies (its walk, the damage of its abilities, its waits: under 1 is shorter).
 */
export const TACTICS_LIMITS = {
  turn: { min: 20, max: 1200, ground: 600 },
  // `ground`: where a leap comes down is looked for no more than this many blocks above the higher of the creature and its target, nor below the lower (`abilityLeapGround`).
  leap: { height: { min: 0.5, max: 12 }, distance: { min: 1, max: 32 }, short: { max: 8 }, ticks: 4, perAbility: 1, ground: { up: 4, down: 8 } },
  lead: 40,
  stages: { min: 2, max: 6 },
  reach: { min: 0.5, max: 32 },
  branches: 16,
  distance: { min: 1, max: 24 },
  pause: { min: 0, max: 10 },
  react: { min: 0.5, max: 30 },
  urge: 60,
  enrage: { below: { min: 0.05, max: 0.95 }, speed: { min: 1, max: 2 }, damage: { min: 1, max: 3 }, cooldown: { min: 0.25, max: 1 } },
} as const

const time = z.number().finite().min(0).max(ABILITY_LIMITS.seconds)
const tickOf = (seconds: number) => Math.round(seconds * TICKS)
const num = (value: number, digits = 2) => Number(value.toFixed(digits))
const AbilityIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "招式和连招的 id 用小写字母开头，只含小写字母、数字和下划线")
const ClipSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/)

// ---- 1. track, then commit ----

/** The fields an ability gains (`AbilitySchema`): until when it keeps turning to its target, and how fast. */
export const AbilityTrackShape = {
  /**
   * With `facing: "track"`: the moment (seconds of the ability) until which it keeps turning toward the one it fights; from then on it is committed to where it faces.
   * Left out: the end of getting ready (`windup`), as it always was. It may be later than `windup` (it still turns while its first blows come) or earlier (it commits
   * before it has finished getting ready, so the last of the wind-up is the moment to step aside).
   */
  track_until: time.optional(),
  /** Degrees a second it turns by while it tracks, on the ground as in the air (a flier in the air turns no faster than its flight lets it). Left out: 600 (30 a tick), as it always was. */
  turn_speed: z.number().finite().min(TACTICS_LIMITS.turn.min).max(TACTICS_LIMITS.turn.max).optional(),
}

// ---- 2. a leap, and an aim that leads ----

/**
 * A leap (`moves[]` of `type: "leap"`): at `at` it leaves the ground for where the one it fights stands (`aim: "target"`) or will stand when it lands (`aim: "predicted"`:
 * where they are, plus how they have moved over the last ticks times the ticks it is in the air), `short` blocks short of them and no further than `max_distance`, and flies
 * there in an arc `height` blocks above the straight line, landing exactly at `land`. A hit written at `land` lands as it touches down. The server moves it every tick (it
 * collides with the world: a wall in the way stops it there, and it drops). It takes no fall damage from it.
 */
export const LeapMoveSchema = z.strictObject({
  type: z.literal("leap"),
  at: time,
  land: time,
  height: z.number().finite().min(TACTICS_LIMITS.leap.height.min).max(TACTICS_LIMITS.leap.height.max),
  aim: z.enum(["target", "predicted"]),
  max_distance: z.number().finite().min(TACTICS_LIMITS.leap.distance.min).max(TACTICS_LIMITS.leap.distance.max),
  short: z.number().finite().min(0).max(TACTICS_LIMITS.leap.short.max).optional(),
  lock_at: z.literal("cast_start").optional(),
  landing_hit: z.number().int().nonnegative().optional(),
})
export type LeapMove = z.infer<typeof LeapMoveSchema>
export const isLeap = (move: unknown): move is LeapMove => typeof move === "object" && move !== null && (move as { type?: unknown }).type === "leap"

/** A leap as server ticks of its ability: the tick it leaves on and how many ticks it is in the air (it is down at the end of tick `start + ticks - 1`, so a hit on tick `start + ticks` is after it touched down). */
export function leapPlan(ability: { moves: readonly unknown[]; length: number }) {
  const index = ability.moves.findIndex(isLeap)
  if (index < 0) return null
  const leap = ability.moves[index] as LeapMove
  const length = Math.max(1, tickOf(ability.length))
  const start = Math.min(length, tickOf(leap.at))
  return { index, leap, start, ticks: Math.max(1, Math.min(length, tickOf(leap.land)) - start) }
}

// ---- 3. stages ----

export const STAGE_KINDS = { windup: "蓄力", loop: "循环", strike: "出手", recover: "收招" } as const
export type StageKind = keyof typeof STAGE_KINDS

/**
 * What ends a loop before its time is up (any one of them does): the one it fights is within `reach` blocks of it; its body touches a living thing that is not of its own
 * kind (`touch`); it runs into a wall (`wall`); a blow of this ability has struck somebody (`landed`). At least one.
 */
export const LoopEndSchema = z.strictObject({
  collision:z.array(CollisionRuleSchema).min(1).max(3).refine(rows=>new Set(rows.map(r=>r.when.with)).size===rows.length,"同一种碰撞只写一种结果").optional(),
  reach: z.number().finite().min(TACTICS_LIMITS.reach.min).max(TACTICS_LIMITS.reach.max).optional(),
  touch: z.boolean().optional(),
  wall: z.boolean().optional(),
  /** Its own blows in this ability have struck somebody (the hit a dash carries strikes them: the charge has met them). */
  landed: z.boolean().optional(),
  /** r29: what is shown where it meets the wall (`wall`) or the living thing (`touch`) the moment that ends the loop (`ImpactPairSchema`). */
  impact: ImpactPairSchema.optional(),
})

/**
 * One stage of an ability: it runs from where the stage before it ended (the first from 0) `until` that moment (seconds of the ability; the last until its `length`).
 * `clip`: the motion that plays from the start of this stage (a loop's plays over and over); left out, the motion that was playing goes on. The first stage plays the ability's own `clip`.
 * A `loop` stage ends early when `end` says so: the ability then goes on from the end of the loop at once, and what lay in the rest of the loop does not happen.
 */
export const AbilityStageSchema = z.strictObject({
  kind: z.enum(Object.keys(STAGE_KINDS) as [StageKind, ...StageKind[]]),
  until: z.number().finite().min(0.05).max(ABILITY_LIMITS.seconds),
  clip: ClipSchema.optional(),
  end: LoopEndSchema.optional(),
})
export type AbilityStage = z.infer<typeof AbilityStageSchema>

export const AbilityStagesShape = {
  /** Its stages (wind-up, loop, strike, recover) in order; left out, it is one stretch as it always was. */
  stages: z.array(AbilityStageSchema).min(TACTICS_LIMITS.stages.min).max(TACTICS_LIMITS.stages.max).optional(),
}

/** An ability's stages as server ticks: each one's first tick and the tick after its last, the clip it switches to (null: none) and, for a loop, what ends it. */
export function stagePlan(ability: { stages?: readonly AbilityStage[] | undefined; length: number }) {
  if (!ability.stages?.length) return []
  const length = Math.max(1, tickOf(ability.length))
  return ability.stages.map((stage, index) => {
    const from = index === 0 ? 0 : Math.min(length, tickOf(ability.stages![index - 1]!.until))
    const to = Math.min(length, tickOf(stage.until))
    return { index, kind: stage.kind, from, to, clip: index === 0 ? null : (stage.clip ?? null), end: stage.kind === "loop" ? (stage.end ?? null) : null }
  })
}

// ---- 4. branching combos ----

/**
 * A branch of a combo: when step `after` (its place in `steps`, from 0) ends — or, with `at`, at that moment of it (seconds of that step: the rest of it is cut, its
 * recovery cancelled) — and the one it fights is between `min_distance` and `max_distance` blocks away (each left out: no bound) and, with `landed`, its blows of that step
 * struck somebody (true) or nobody (false), the combo goes on with step `to` (a later step; null: the combo ends here). Branches are tried in the order written; the first
 * that holds is taken. When none at the end of a step holds, the next step follows as it always did (the combo ends after its last).
 */
export const ComboBranchSchema = z.strictObject({
  chance: BranchChanceSchema.optional(),
  after: z.number().int().min(0).max(COMBO_LIMITS.steps.max - 1),
  at: time.optional(),
  min_distance: z.number().finite().min(0).max(ABILITY_LIMITS.distance).optional(),
  max_distance: z.number().finite().min(0).max(ABILITY_LIMITS.distance).optional(),
  landed: z.boolean().optional(),
  to: z.number().int().min(0).max(COMBO_LIMITS.steps.max - 1).nullable(),
})
export type ComboBranch = z.infer<typeof ComboBranchSchema>
export const ComboBranchesShape = {
  /** How it goes on after a step: by how far the one it fights is and whether the step's blows landed (`ComboBranchSchema`). Left out, its steps follow one another as they always did. */
  branches: z.array(ComboBranchSchema).min(1).max(TACTICS_LIMITS.branches).optional(),
}

/** What is wrong with a combo's branches against its steps and the abilities they play, each with where it is. */
export function comboBranchIssues(combo: { name: string; steps: readonly string[]; branches?: readonly ComboBranch[] | undefined }, abilities: readonly { id: string; length: number }[]) {
  const found: { path: (string | number)[]; message: string }[] = []
  ;(combo.branches ?? []).forEach((branch, index) => {
    const at = (field: string) => ["branches", index, field]
    if (branch.after >= combo.steps.length) found.push({ path: at("after"), message: `连招「${combo.name}」只有 ${combo.steps.length} 步（从 0 数到 ${combo.steps.length - 1}），没有第 ${branch.after} 步` })
    if (branch.to !== null && branch.to >= combo.steps.length) found.push({ path: at("to"), message: `连招「${combo.name}」只有 ${combo.steps.length} 步（从 0 数到 ${combo.steps.length - 1}），to 不能写 ${branch.to}；要结束连招写 null` })
    if (branch.to !== null && branch.to <= branch.after) found.push({ path: at("to"), message: `分支只能往后跳（to 要比 after 大）：从第 ${branch.after} 步跳回第 ${branch.to} 步会让连招没完没了。想再来一下就把那一招再写进后面的 steps（换一个招式 id），或者写 null 结束` })
    if (branch.min_distance !== undefined && branch.max_distance !== undefined && branch.min_distance >= branch.max_distance) found.push({ path: at("max_distance"), message: "分支的最远距离（max_distance）要比最近距离（min_distance）大" })
    const step = abilities.find((ability) => ability.id === combo.steps[branch.after])
    if (branch.at !== undefined && step && branch.at > step.length + 1e-9) found.push({ path: at("at"), message: `分支的时刻（at，第 ${branch.after} 步「${step.id}」里的秒数）不能比那一招的全长（${step.length} 秒）还晚；要在那一招收完再判断就不写 at` })
  })
  return found
}

// ---- 5. between attacks, reactions and enrage ----

export const BETWEEN_STYLES = { chase: "直接追上去", circle: "绕着目标转圈", strafe: "面朝目标横着走", close_in: "逼近到一定距离停下", back_off: "保持距离，近了就往后退", hop: "一跳一跳地扑过去" } as const
export type BetweenStyle = keyof typeof BETWEEN_STYLES
export const BETWEEN_STYLE_IDS = Object.keys(BETWEEN_STYLES) as [BetweenStyle, ...BetweenStyle[]]

/**
 * What it does between two abilities: `style` (`BETWEEN_STYLES`) at `distance` blocks from the one it fights (the radius it circles at, the distance it closes to or keeps),
 * and `pause`: seconds after an ability ends before it may start another (how aggressive it is; 0: at once, as it always was).
 */
export const BetweenSchema = z.strictObject({
  style: z.enum(BETWEEN_STYLE_IDS),
  mix: z.strictObject({
    every_ticks: z.int().min(1, "至少走一刻再换。").max(1200, "换走法的间隔最多 1200 刻。"),
    choices: z.array(z.strictObject({
      style: z.enum(BETWEEN_STYLE_IDS, { error: "请选择转圈、横移、逼近、保持距离、跳扑或追赶对应的走法。" }),
      weight: z.int().min(1, "每种走法的份数至少为 1。").max(100, "每种走法最多 100 份。"),
    })).min(2, "组合走法至少要有两种。").max(6, "组合走法最多六种。"),
  }).optional(),
  side_ticks: z.int().min(1, "方向至少保持一刻。").max(1200, "方向保持时间最多 1200 刻。").optional(),
  path_ticks: z.int().min(1, "至少隔一刻重新寻路。").max(100, "重新寻路最多间隔 100 刻。").optional(),
  stand_resume: z.number().min(1).max(48).optional(),
  stand_distance: z.number().min(0, "站定距离不能小于 0 格。").max(32, "站定距离最多 32 格。").optional(),
  distance: z.number().finite().min(TACTICS_LIMITS.distance.min).max(TACTICS_LIMITS.distance.max),
  pause: z.number().finite().min(TACTICS_LIMITS.pause.min).max(TACTICS_LIMITS.pause.max),
}).superRefine((stage, context) => {
  if (stage.stand_resume !== undefined && (!stage.stand_distance || stage.stand_resume <= stage.stand_distance))
    context.addIssue({ code: "custom", path: ["stand_resume"], message: "要先写站定距离，重新迈步的距离必须比站定距离更大。" })
})
export type Between = z.infer<typeof BetweenSchema>

const reactSeconds = z.number().finite().min(TACTICS_LIMITS.react.min).max(TACTICS_LIMITS.react.max)
const reactDistance = z.number().finite().min(1).max(ABILITY_LIMITS.distance)

/**
 * How a creature fights between its abilities, as data. Only a hostile creature with abilities fights; one that stays where it is (`stationary`) does not move between them.
 * - between: its style and pause (`BetweenSchema`); a boss's phase may write its own (`between` of the phase), kept for the phases after it.
 * - kited: when the one it fights has stayed further than `distance` blocks for `seconds`, its next ability is one of `use` (abilities or combos by id: a gap-closer, a ranged one),
 *   the first of them that may start within the next three seconds (each still needs its own window, wait and phase).
 * - hugged: when they have stayed nearer than `distance` blocks for `seconds`, its next ability is one of `use`; without `use` it hops back out of their reach.
 * - enrage: once its life is below `below` (a share of the whole) its walk is `speed` times as fast, its abilities do `damage` times their damage and its waits are `cooldown` times as long.
 */
export const TacticsSchema = z.strictObject({
  between: BetweenSchema.optional(),
  kited: z.strictObject({ distance: reactDistance, seconds: reactSeconds, use: z.array(AbilityIdSchema).min(1).max(EPIC_LIMITS.abilities + EPIC_LIMITS.combos) }).optional(),
  hugged: z.strictObject({ distance: reactDistance, seconds: reactSeconds, use: z.array(AbilityIdSchema).min(1).max(EPIC_LIMITS.abilities + EPIC_LIMITS.combos).optional() }).optional(),
  enrage: z
    .strictObject({
      below: z.number().finite().min(TACTICS_LIMITS.enrage.below.min).max(TACTICS_LIMITS.enrage.below.max),
      speed: z.number().finite().min(TACTICS_LIMITS.enrage.speed.min).max(TACTICS_LIMITS.enrage.speed.max),
      damage: z.number().finite().min(TACTICS_LIMITS.enrage.damage.min).max(TACTICS_LIMITS.enrage.damage.max),
      cooldown: z.number().finite().min(TACTICS_LIMITS.enrage.cooldown.min).max(TACTICS_LIMITS.enrage.cooldown.max),
    })
    .optional(),
})
export type Tactics = z.infer<typeof TacticsSchema>

/** The between-attack style it has when nothing is written: it walks straight at its target and starts the next ability as soon as one may, as it always did. */
export const DEFAULT_BETWEEN: Between = { style: "chase", distance: TACTICS_LIMITS.distance.min, pause: 0 }

/** Its between-attack behaviour in each stage of a boss's fight ([first phase, after the first line, ...]); one stage for a creature that is no boss. A phase that writes none keeps the one before. */
export function betweenStages(tactics: Tactics | null | undefined, phases: readonly { between?: Between | undefined }[] = []) {
  const stages: Between[] = [tactics?.between ?? DEFAULT_BETWEEN]
  for (const phase of phases) stages.push(phase.between ?? stages.at(-1)!)
  return stages
}

/** True when a creature writes any of what this file adds to how it fights between abilities (a style, a reaction, an enrage, or a phase's own style). */
export const tacticsWritten = (creature: { tactics?: Tactics | null; boss?: { phases: readonly { between?: Between | undefined }[] } | null }) => Boolean(creature.tactics || creature.boss?.phases.some((phase) => phase.between))

// ---- checks that need more than one field ----

type AbilityLike = {
  id: string
  name: string
  windup: number
  length: number
  facing: "track" | "lock"
  clip: string
  track_until?: number | undefined
  turn_speed?: number | undefined
  stages?: readonly AbilityStage[] | undefined
  moves: readonly unknown[]
  hits: readonly { at: number;type?:string;place?:unknown;warn?:{seconds:number;follow?:string} }[]
}

/** What the schema refuses of an ability's tracking, leap and stages, each with where it is; `AbilitySchema` adds them as its issues. */
export function tacticsAbilityIssues(ability: AbilityLike) {
  const found: { path: (string | number)[]; message: string }[] = []
  const late = (at: number) => at > ability.length + 1e-9
  if (ability.track_until !== undefined) {
    if (ability.facing !== "track") found.push({ path: ["track_until"], message: '只有一直转向目标的招式（facing 写 "track"）才写 track_until：lock 的招式从开始就不转' })
    if (late(ability.track_until)) found.push({ path: ["track_until"], message: "转向到的时刻（track_until）不能比招式全长（length）还晚" })
  }
  if (ability.turn_speed !== undefined && ability.facing !== "track") found.push({ path: ["turn_speed"], message: '只有一直转向目标的招式（facing 写 "track"）才写转身速度（turn_speed）：lock 的招式不转' })
  const leaps = ability.moves.flatMap((move, index) => (isLeap(move) ? [{ move, index }] : []))
  leaps.slice(TACTICS_LIMITS.leap.perAbility).forEach(({ index }) => found.push({ path: ["moves", index], message: `一个招式最多 ${TACTICS_LIMITS.leap.perAbility} 次跳跃（type:"leap"）：要跳两次，就做成两个招式，用连招接起来` }))
  if (leaps.length && ability.moves.some((move) => typeof move === "object" && move !== null && (move as { type?: unknown }).type === "dash"))
    found.push({ path: ["moves", leaps[0]!.index], message: "一个招式里不能既冲刺（dash）又跳跃（leap）：两个都要把身体挪到别处。做成两个招式，用连招接起来" })
  for (const { move, index } of leaps.slice(0, TACTICS_LIMITS.leap.perAbility)) {
    if (move.landing_hit !== undefined) {
      const hit = ability.hits[move.landing_hit]
      const earliest = move.lock_at === "cast_start" ? 0 : tickOf(move.at)
      if (hit?.type !== "area" || hit.place !== "target" || tickOf(hit.at)!==tickOf(move.land)) found.push({path:["moves",index,"landing_hit"],message:"落地出手要指向落地那一刻的一次范围出手，place 写 target。"})
      else if (hit.warn?.follow || hit.warn && tickOf(hit.at)-tickOf(hit.warn.seconds)<earliest) found.push({path:["moves",index,"landing_hit"],message:`跳扑的落点在第 ${earliest/20} 秒定下。落地预警从这时起可用固定位置；要从蓄力开始就亮，请把 lock_at 写成 cast_start。`})
    }
    if (late(move.land)) found.push({ path: ["moves", index, "land"], message: "落地的时刻（land）不能比招式全长（length）还晚" })
    if (tickOf(move.land) - tickOf(move.at) < TACTICS_LIMITS.leap.ticks)
      found.push({ path: ["moves", index, "land"], message: `跳起（at）到落地（land）至少 ${TACTICS_LIMITS.leap.ticks / TICKS} 秒（${TACTICS_LIMITS.leap.ticks} 刻）：再短就只是一蹦，看不出是扑过去的` })
    if ((move.short ?? 0) >= move.max_distance) found.push({ path: ["moves", index, "short"], message: "停在目标前面的距离（short）要比最远能跳的距离（max_distance）小" })
  }
  const stages = ability.stages ?? []
  if (stages.length) {
    stages.forEach((stage, index) => {
      const path = (field: string) => ["stages", index, field]
      if (index > 0 && stage.until <= stages[index - 1]!.until + 1e-9) found.push({ path: path("until"), message: "各段按先后写：每一段结束的时刻（until）要比上一段晚" })
      if (index === stages.length - 1 && Math.abs(stage.until - ability.length) > 1e-9) found.push({ path: path("until"), message: `最后一段要一直到招式结束：until 写招式全长（length，${ability.length}）` })
      if (index < stages.length - 1 && late(stage.until)) found.push({ path: path("until"), message: "一段结束的时刻（until）不能比招式全长（length）还晚" })
      if (index === 0 && stage.clip !== undefined) found.push({ path: path("clip"), message: "第一段播的就是招式自己的动作（clip），这里不写 clip" })
      if (stage.kind === "loop") {
        if (!stage.end || (stage.end.reach === undefined && !stage.end.touch && !stage.end.wall && !stage.end.landed && !stage.end.collision?.length))
          found.push({ path: path("end"), message: '循环段（kind:"loop"）要写什么时候提前结束：end 里至少写一样——reach（目标走进几格以内）、touch:true（身体碰到人）、wall:true（撞上墙）或 landed:true（这一招打中了人）；到 until 那一刻也会结束' })
        if (stage.end?.impact?.wall && !stage.end.wall) found.push({ path: ["stages", index, "end", "impact", "wall"], message: "撞墙那一刻的声光（impact.wall）跟着撞墙结束走：请在 end 里同时写 wall:true，或者把它挪到 end.collision 里 with 为 world 的那条规则的 result.impact" })
        if (stage.end?.impact?.touch && !stage.end.touch) found.push({ path: ["stages", index, "end", "impact", "touch"], message: "撞到生物那一刻的声光（impact.touch）跟着碰到生物结束走：请在 end 里同时写 touch:true" })
        if (index === 0) found.push({ path: path("kind"), message: "循环段前面要先有一段（一般是蓄力 windup）：第一段不能是循环" })
        const next = stages[index + 1]
        if (next && next.clip === undefined) found.push({ path: ["stages", index + 1, "clip"], message: "循环可能提前结束，后面接着的那一段要写自己的动作（clip）：否则提前结束时还在播循环之后的那半截，动作和出手对不上" })
      } else if (stage.end !== undefined) found.push({ path: path("end"), message: '只有循环段（kind:"loop"）写 end' })
    })
    const loops = stages.filter((stage) => stage.kind === "loop").length
    if (loops > 1) found.push({ path: ["stages"], message: "一个招式最多一段循环：要循环两次就做成两个招式，用连招接起来" })
    const windupStage = stages.findIndex((stage) => stage.kind === "windup")
    if (windupStage > 0) found.push({ path: ["stages", windupStage, "kind"], message: "蓄力段（windup）只能是第一段" })
  }
  return found
}

/** What is wrong with a creature's tactics against its abilities and combos, each with where it is. */
export function tacticsDocumentIssues(creature: { behavior: string; stationary?: unknown; abilities?: readonly { id: string }[] | null; combos?: readonly { id: string }[] | null; tactics?: Tactics | null; boss?: { phases: readonly { between?: Between | undefined }[] } | null }) {
  const found: { path: (string | number)[]; message: string }[] = []
  if (!tacticsWritten(creature)) return found
  const choices = [...(creature.abilities ?? []), ...(creature.combos ?? [])].map((choice) => choice.id)
  if (creature.behavior !== "hostile" || !(creature.abilities ?? []).length) found.push({ path: ["tactics"], message: "出招之间怎么走（tactics、阶段的 between）只给会出招的敌对生物写：behavior 写 hostile，并且写了招式（abilities）" })
  const tactics = creature.tactics
  if (creature.stationary && (tactics?.between || creature.boss?.phases.some((phase) => phase.between))) found.push({ path: ["tactics", "between"], message: "故意不走动的生物（stationary）出招之间不走动，between 不起作用：去掉 between，或者去掉 stationary" })
  for (const reaction of ["kited", "hugged"] as const) {
    ;(tactics?.[reaction]?.use ?? []).forEach((id, index) => {
      if (!choices.includes(id)) found.push({ path: ["tactics", reaction, "use", index], message: `${reaction === "kited" ? "被放风筝" : "被贴身"}时要用的 ${id} 在这只生物的招式（abilities）和连招（combos）里都找不到` })
    })
  }
  if (tactics?.kited && tactics.hugged && tactics.hugged.distance >= tactics.kited.distance) found.push({ path: ["tactics", "hugged", "distance"], message: "被贴身的距离（hugged.distance）要比被放风筝的距离（kited.distance）近" })
  return found
}

// ---- words ----

/** 「蓄力时一直转向目标，到第 0.8 秒才定住（每秒最多转 240°）」; null when the ability says nothing of it. */
export function trackWords(ability: Pick<AbilityLike, "facing" | "windup" | "track_until" | "turn_speed">) {
  if (ability.facing !== "track" || (ability.track_until === undefined && ability.turn_speed === undefined)) return null
  return `一直转向目标，到第 ${num(ability.track_until ?? ability.windup)} 秒才定住朝向${ability.turn_speed === undefined ? "" : `（每秒最多转 ${num(ability.turn_speed, 0)}°）`}`
}

/** 「第 0.5 秒跳起，扑向目标 0.8 秒后会在的地方（最远 12 格，停在它前面 1 格），弧顶比直线高 3 格，第 1.3 秒落地」 */
export function leapWords(ability: { moves: readonly unknown[] }) {
  const leap = ability.moves.find(isLeap)
  if (!leap) return null
  return `${leap.lock_at ? "蓄力开始即定落点，" : ""}第 ${num(leap.at)} 秒跳起，扑向${leap.aim === "predicted" ? `目标 ${num(leap.land - (leap.lock_at ? 0 : leap.at))} 秒后会在的地方（按它这几刻的走向预判）` : "目标所在的地方"}（最远 ${num(leap.max_distance)} 格${leap.short ? `，停在它前面 ${num(leap.short)} 格` : ""}），弧顶比直线高 ${num(leap.height)} 格，第 ${num(leap.land)} 秒落地`
}

/** 「分段：蓄力到 0.6 秒 → 循环到 2.4 秒（目标进 2 格以内、碰到人或撞墙就提前结束，播 charge_loop）→ 出手到 2.8 秒（播 charge_hit）→ 收招到 3.4 秒」 */
export function stageWords(ability: Pick<AbilityLike, "stages">, motion: (clip:string)=>string = clip=>clip) {
  const stages = ability.stages ?? []
  if (!stages.length) return null
  return `分段：${stages
    .map((stage) => {
      const ends = stage.end ? [stage.end.reach !== undefined ? `目标进 ${num(stage.end.reach)} 格以内` : null, stage.end.touch ? "碰到人" : null, stage.end.wall ? "撞墙" : null, stage.end.landed ? "打中了人" : null].filter(Boolean).join("、") : ""
      const collisions = stage.end?.collision?.map(({when,result}) => {
        const object = {world:"世界方块", own_terrain:"自己立的地形", other_terrain:"别人立的地形"}[when.with]
        const actions = [result.shatter_terrain === undefined ? null : `以 ${result.shatter_terrain} 点力度打碎地形`, result.stagger ? `进入硬直「${result.stagger}」` : null, result.interrupt ? "打断招式" : null].filter(Boolean)
        return "撞到"+object+"时"+actions.join("并")+(result.impact ? `，撞上时${impactFxWords(result.impact)}` : "")
      }) ?? []
      const met = (["wall", "touch"] as const).flatMap((side) => ((fx) => (fx ? [`${side === "wall" ? "撞墙" : "碰到人"}的那一刻${impactFxWords(fx)}`] : []))(stage.end?.impact?.[side]))
      return `${STAGE_KINDS[stage.kind]}到 ${num(stage.until)} 秒${ends || stage.clip || collisions.length || met.length ? `（${[ends ? `${ends}就提前结束` : null, stage.clip ? `播 ${motion(stage.clip)}` : null, ...collisions, ...met].filter(Boolean).join("，")}）` : ""}`
    })
    .join(" → ")}`
}

/** 「第 1 步收完：目标在 4 格以外 → 第 3 步；打空了 → 结束」 */
export function branchWords(combo: { steps: readonly string[]; branches?: readonly ComboBranch[] | undefined }, name: (id: string) => string = () => "指定招式") {
  const branches = combo.branches ?? []
  if (!branches.length) return null
  return branches
    .map((branch) => {
      const when = [
        branch.min_distance !== undefined && branch.max_distance !== undefined ? `目标在 ${num(branch.min_distance)}–${num(branch.max_distance)} 格` : branch.min_distance !== undefined ? `目标在 ${num(branch.min_distance)} 格以外` : branch.max_distance !== undefined ? `目标在 ${num(branch.max_distance)} 格以内` : null,
        branch.chance === undefined ? null : `${num(branch.chance * 100)}% 概率`,
        branch.landed === undefined ? null : branch.landed ? "这一步打中了人" : "这一步打空了",
      ].filter(Boolean)
      return `第 ${branch.after + 1} 步「${name(combo.steps[branch.after] ?? "")}」${branch.at === undefined ? "收完" : `出到第 ${num(branch.at)} 秒`}：${when.length ? when.join("且") : "不管怎样"} → ${branch.to === null ? "结束连招" : `接第 ${branch.to + 1} 步「${name(combo.steps[branch.to] ?? "")}」`}`
    })
    .join("；")
}

/** 「出招之间绕着目标转圈（6 格），每招之后歇 1 秒；被放风筝 3 秒（10 格外）就用「跳劈」；血量低于 30% 暴怒：走得快 1.3 倍、伤害 1.5 倍、冷却 0.6 倍」 */
export function tacticsWords(tactics: Tactics | null | undefined, names: (id: string) => string = (id) => id) {
  if (!tactics) return null
  const between = tactics.between
  return [
    between ? `出招之间${BETWEEN_STYLES[between.style]}${between.style === "chase" || between.style === "hop" ? "" : `（${num(between.distance)} 格）`}，每招之后${between.pause > 0 ? `歇 ${num(between.pause)} 秒` : "立刻能出下一招"}` : null,
    between?.mix ? `每 ${between.mix.every_ticks} 刻重新选走法（${between.mix.choices.map(choice => BETWEEN_STYLES[choice.style] + " " + choice.weight + " 份").join("、")}）` : null,
    between?.side_ticks ? `方向至少保持 ${between.side_ticks} 刻` : null,
    between?.path_ticks ? `转圈每 ${between.path_ticks} 刻重新寻路` : null,
    between?.stand_distance ? `目标在 ${between.stand_distance} 格内时站定转身` : null,
    tactics.kited ? `目标在 ${num(tactics.kited.distance)} 格外待了 ${num(tactics.kited.seconds)} 秒（放风筝）就用${tactics.kited.use.map((id) => `「${names(id)}」`).join("或")}` : null,
    tactics.hugged ? `目标贴在 ${num(tactics.hugged.distance)} 格以内 ${num(tactics.hugged.seconds)} 秒就${tactics.hugged.use ? `用${tactics.hugged.use.map((id) => `「${names(id)}」`).join("或")}` : "往后跳开"}` : null,
    tactics.enrage ? `血量低于 ${num(tactics.enrage.below * 100, 1)}% 暴怒：走得快 ${num(tactics.enrage.speed)} 倍、招式伤害 ${num(tactics.enrage.damage)} 倍、冷却 ${num(tactics.enrage.cooldown)} 倍` : null,
  ]
    .filter(Boolean)
    .join("；")
}

// ---- what an AI is told ----

/** Appended after the combos (`COMBO_INSTRUCTIONS`): everything of this step, with three worked examples. */
export const TACTICS_INSTRUCTIONS =
  ` 出招更像一个会打架的 Boss（全部可以不写，不写就和以前一模一样）：` +
  ` 一、先跟后定：facing 写 "track" 的招式可以再写 track_until（秒）——一直转向目标到这一刻才定住朝向（不写就是到 windup 为止）；可以比 windup 晚（出手的头几下还在跟），也可以比 windup 早（蓄力最后那一截已经定住，玩家这时闪开）。turn_speed 是跟的时候每秒最多转几度（${TACTICS_LIMITS.turn.min}–${TACTICS_LIMITS.turn.max}，不写是 ${TACTICS_LIMITS.turn.ground}，即每刻 30°；大个子写 120–240 就绕得开），地上天上都管（天上不会比飞行的转弯速度快）。` +
  ` 二、跳跃和预判：moves 里可以写一次跳跃 {type:"leap", at, land, height, aim, max_distance, short}——at 秒跳起，正好在 land 秒落地（至少隔 ${TACTICS_LIMITS.leap.ticks / TICKS} 秒），飞的是一道弧，弧顶比起落两点的连线高 height 格（${TACTICS_LIMITS.leap.height.min}–${TACTICS_LIMITS.leap.height.max}）；落点是目标脚下（aim:"target"），或者按目标这几刻的走向预判它落地时会在的地方（aim:"predicted"），停在它前面 short 格（可以不写，0–${TACTICS_LIMITS.leap.short.max}），最远跳 max_distance 格（${TACTICS_LIMITS.leap.distance.min}–${TACTICS_LIMITS.leap.distance.max}）。服务端每刻按弧线挪它，撞墙就停在墙前落下，不摔伤。想落地砸人，就把那一下范围出手的 at 写成 land。一个招式最多一次跳跃，不能和冲刺写在一起。冲刺（dash）的 aim 除了 "locked_at_windup" 还可以写 "predicted"：冲刺开始那一刻朝目标会在的地方冲（按目标这几刻的走向和自己冲到那里要的时间算），跑动中的玩家要变向才躲得开。` +
  ` 三、分段：stages 把一个招式切成几段（${TACTICS_LIMITS.stages.min}–${TACTICS_LIMITS.stages.max} 段）[{kind, until, clip, end}]——kind 是 ${Object.entries(STAGE_KINDS).map(([kind, words]) => `${kind}（${words}）`).join("、")}；每段从上一段结束（第一段从 0）到 until 秒，最后一段的 until 写 length；clip 是这一段开始时换上的动作（第一段不写，播的就是招式自己的 clip；不写就接着播原来的；循环段的动作会一直循环）。循环段（只能有一段，不能是第一段）要写 end：{reach（目标走进几格以内）, touch（身体碰到人）, wall（撞上墙）, landed（这一招的出手打中了人，冲刺沿路那一下也算）}，至少写一样，满足任何一样就提前结束、立刻接下一段，循环里还没到的出手和事件就不发生；到 until 还没满足也结束。循环后面那一段必须写自己的 clip。换了动作的段里，拖尾（trail）不再画（拖尾跟着招式自己的动作算时间），要拖尾就放在第一段里。蓄力冲锋就是：蓄力段 → 循环段里一段冲刺（dash 的 from 写循环开始、to 写循环结束），冲刺沿路那一下打中人（landed）或撞墙就提前结束 → 出手段（at 写循环结束的时刻）→ 收招段。` +
  ` 四、会拐弯的连招：连招可以写 branches [{after, at, min_distance, max_distance, landed, to}]——第 after 步（steps 里从 0 数）收完时（写了 at 就是那一步出到第 at 秒时，后面的收招直接取消），目标离它在 min_distance 到 max_distance 格之间（不写就不限）、并且这一步打中了人（landed:true）或打空了（landed:false，不写就不管），就接第 to 步（只能往后跳；null 是连招到此结束）。按写的顺序试，第一条满足的算数；收完时没有一条满足，就照旧接下一步。远了就接冲锋、近了就接重砸，打空了就收手，都靠它。连招最多 ${TACTICS_LIMITS.branches} 条分支。` +
  ` 落点时序：原地范围无预警时按出手那刻的位置；固定预警在亮起时定点，最早第 0 秒；跟随预警一直更新到出手前 lock_before 秒，省略则跟到出手。远处无预警的出手在出手时定点。冲刺在启动时定方向，沿路按身体实际经过的位置打。跳扑默认起跳时定落点；moves 里的 leap 写 lock_at:"cast_start" 可在蓄力开始时定点。landing_hit:0 把第 0 次出手（落地时刻、place:"target"）和它的固定预警放到同一跳扑终点，撞墙时身体停在墙前，伤害和预警仍在定下的位置。` +
  ` 五、出招之间：生物可以写 tactics：{between, kited, hugged, enrage}。between：{style, distance, pause}——没在出招的时候怎么走：${Object.entries(BETWEEN_STYLES).map(([style, words]) => `${style}（${words}）`).join("、")}；distance 是转圈的半径、逼近或保持的距离（${TACTICS_LIMITS.distance.min}–${TACTICS_LIMITS.distance.max} 格）；pause 是每出完一招至少歇几秒才出下一招（0–${TACTICS_LIMITS.pause.max}，越小越凶）。between 还可以写四样（都可以不写）：mix:{every_ticks:60,choices:[{style:"circle",weight:3},{style:"close_in",weight:1}]}——每隔 every_ticks 刻按份数重新抽一种走法（可以连续抽到同一种）；side_ticks——转圈和横移时一个方向至少保持多少刻才许换（缺省每 80 刻随机换一次，启用稳重时取预设）；path_ticks——转圈时隔多少刻重新寻路（缺省每 5 刻，启用稳重时取预设）；stand_distance——目标在这么多格以内时站定，只转身不迈步。稳重的生物默认走出站定距离 3 格后才重新迈步；stand_resume 可指定重新迈步的距离（最多 48 格）。大体型的生物把 side_ticks 写大（比如 200）、path_ticks 写到 20 左右，走位才不会来回折返。Boss 的每个阶段可以写自己的 between（同样的写法），之后的阶段沿用，换阶段就换打法。kited：{distance, seconds, use}——目标在 distance 格外待了 seconds 秒（玩家放风筝），接下来几秒只从 use（招式或连招的 id）里挑一招出（一般是跳劈、冲锋或远程招式；各自的出招距离、冷却和阶段照样要满足）。hugged：{distance, seconds, use}——目标贴在 distance 格以内 seconds 秒，就从 use 里挑一招（不写 use 就往后跳开）。enrage：{below, speed, damage, cooldown}——血量低于 below（占满血的几分之几）时暴怒：出招之间走得快 speed 倍（${TACTICS_LIMITS.enrage.speed.min}–${TACTICS_LIMITS.enrage.speed.max}）、招式的范围出手伤害乘 damage（${TACTICS_LIMITS.enrage.damage.min}–${TACTICS_LIMITS.enrage.damage.max}，和阶段的 damage 相乘）、冷却和 pause 乘 cooldown（${TACTICS_LIMITS.enrage.cooldown.min}–${TACTICS_LIMITS.enrage.cooldown.max}）。` +
  ` 六、史诗档（蓝图上定的是 epic）的生物招式最多 ${EPIC_LIMITS.abilities} 个、每招出手最多 ${EPIC_LIMITS.hits} 次、连招最多 ${EPIC_LIMITS.combos} 个；别的档仍是 ${ABILITY_LIMITS.abilities}、${ABILITY_LIMITS.hits}、${COMBO_LIMITS.combos}，超了打包前会被拦下。` +
  ` 例一 蓄力冲锋（预判、撞上人就停）：{"id":"charge","name":"蓄力冲锋","clip":"charge_windup","windup":0.8,"length":3.4,"facing":"track","track_until":0.7,"turn_speed":240,"stages":[{"kind":"windup","until":0.8},{"kind":"loop","until":2.4,"clip":"charge_loop","end":{"landed":true,"wall":true}},{"kind":"strike","until":2.8,"clip":"charge_hit"},{"kind":"recover","until":3.4,"clip":"charge_recover"}],"hits":[{"type":"area","at":0.8,"shape":{"type":"box","forward":1.5,"up":1,"left":0,"width":3,"height":2.5,"depth":2},"hits":"everyone","damage":12,"knockback":1.5,"effects":[]},{"type":"area","at":2.45,"shape":{"type":"arc","reach":4,"angle":120,"low":-0.5,"high":3},"hits":"everyone","damage":8,"knockback":1,"effects":[]}],"moves":[{"type":"dash","from":0.8,"to":2.4,"speed":14,"distance":22,"aim":"predicted","stop_at_wall":true,"hit":0}],"start":{"min_distance":6,"max_distance":24,"line_of_sight":true,"cooldown":8,"weight":3},"stopped_by_hurt":false,"events":[]}。` +
  ` 例二 跳劈（落地那一刻砸）：{"id":"leap_slam","name":"跳劈","clip":"leap_slam","windup":0.5,"length":1.8,"facing":"track","hits":[{"type":"area","at":1.3,"shape":{"type":"sphere","forward":0,"up":0,"left":0,"radius":4},"hits":"everyone","damage":14,"knockback":1.2,"effects":[]}],"moves":[{"type":"leap","at":0.5,"land":1.3,"height":3,"aim":"predicted","max_distance":14,"short":1}],"start":{"min_distance":5,"max_distance":14,"line_of_sight":true,"cooldown":6,"weight":2},"stopped_by_hurt":false,"events":[{"type":"shake","at":1.3,"strength":2,"radius":16,"seconds":0.6}]}。` +
  ` 例三 按距离拐弯的连招：{"id":"reaper","name":"收割","steps":["sweep","leap_slam","thrust","slam"],"gap_ticks":2,"damage_scale":1,"start":{"min_distance":0,"max_distance":4,"line_of_sight":true,"cooldown":10,"weight":2},"branches":[{"after":0,"min_distance":5,"to":1},{"after":0,"max_distance":5,"to":2},{"after":1,"to":null},{"after":2,"at":0.6,"landed":false,"to":null}]}——横扫收完，目标退到 5 格外就接跳劈（之后结束），还在身边就接突刺，突刺出到 0.6 秒还没打中人就收手，打中了接重砸。` +
  ` 配上 "tactics":{"between":{"style":"circle","distance":6,"pause":0.8},"kited":{"distance":10,"seconds":3,"use":["leap_slam","charge"]},"hugged":{"distance":2,"seconds":2},"enrage":{"below":0.3,"speed":1.3,"damage":1.5,"cooldown":0.6}}，阶段里写 "between":{"style":"close_in","distance":3,"pause":0.3} 就是二阶段贴身猛攻。`

export const TACTICS_SUMMARY =
  "可选：更像 Boss 的出招——招式可以一直转向目标到某一刻才定住（track_until）并限定转身速度（turn_speed）；可以跳向目标或预判的落点、正好在某一刻落地砸人（leap）；冲刺可以朝目标会在的地方冲（aim:predicted）；招式可以分成蓄力、循环、出手、收招几段，循环碰到人、撞墙或目标走近就提前结束，每段换自己的动作；连招可以按目标远近、这一步打没打中拐到后面某一步或提前收手；生物可以写出招式之间怎么走（转圈、横移、逼近、保持距离、跳着扑，可按份数组合并设转圈的换向、寻路间隔），每招之后歇多久（Boss 的每个阶段可以换），被放风筝、被贴身时换招，残血暴怒。史诗档的招式、出手和连招上限更高。"

/** The seconds of the ability a reaction's urge lasts, said: the ticks are `TACTICS_LIMITS.urge`. */
export const URGE_SECONDS = TACTICS_LIMITS.urge / TICKS