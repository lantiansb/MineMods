import { FixtureActionSchema } from "./fixture-schema"
import { ImpactFxSchema, impactFxWords } from "./impact-fx"
import { z } from "zod"
import { abilityRef } from "./finding-refs"
import type { Ability, Boss, Combo, Stances } from "./entity-runtime"

export const CombatAmountSchema = z.union([
  z.strictObject({ points: z.number().min(0.5).max(1024) }),
  z.strictObject({ share: z.number().min(0.01).max(1) }),
])
export const StanceIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "姿态代号用小写字母开头，只含小写字母、数字和下划线。")
const stanceResult = { stance: StanceIdSchema.optional() }
const StanceResultSchema = z.strictObject({ stance: StanceIdSchema })
export const StanceActionSchema = z.strictObject({ type: z.literal("stance"), to: StanceIdSchema })

export const CastInterruptSchema = z.strictObject({
  hit: CombatAmountSchema.optional(), total: CombatAmountSchema.optional(),
  hits: z.number().int().min(1).max(1024).optional(), part: z.string().min(1).max(48).optional(),
  from: z.number().min(0).optional(), to: z.number().positive().optional(),
}).superRefine((rule, ctx) => {
  if (!rule.hit && !rule.total && !rule.hits) ctx.addIssue({ code: "custom", message: "打断至少写单次掉血 hit、累计掉血 total 或命中次数 hits 中的一项。" })
  if (rule.to !== undefined && Math.round(rule.to * 20) <= Math.round((rule.from ?? 0) * 20)) ctx.addIssue({ code: "custom", message: "打断结束时间要比开始时间至少晚一刻。" })
})
export const InterruptSchema = CastInterruptSchema.safeExtend({ result: StanceResultSchema.optional() })
export type Interrupt = z.infer<typeof InterruptSchema>
export type CombatAmount = z.infer<typeof CombatAmountSchema>
export function interruptProgress(rule: Interrupt, blow: { lost: number; max: number; part?: string | undefined }, tick: number, total: number, hits: number) {
  if (tick < Math.round(20 * (rule.from ?? 0)) || tick >= Math.round(20 * (rule.to ?? Infinity)) || (rule.part && rule.part !== blow.part)) return { total, hits, stop: false }
  const amount = (value: CombatAmount) => "points" in value ? value.points : value.share * blow.max
  const lost = Math.max(0, blow.lost)
  return { total: total + lost, hits: hits + 1, stop: Boolean((rule.hit && lost >= amount(rule.hit)) || (rule.total && total + lost >= amount(rule.total)) || (rule.hits && hits + 1 >= rule.hits)) }
}

const group = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/)
export const FixturesLitSchema = z.strictObject({ if: z.literal("fixtures_lit"), count: z.number().int().min(1).max(8), within_arc: z.number().positive().max(360).optional() })
export type FixturesLit = z.infer<typeof FixturesLitSchema>
export const fixtureConditionWords = (rule: FixturesLit) => `${rule.within_arc ? `身体正前方总角 ${rule.within_arc} 度内` : "场内"}同时亮着至少 ${rule.count} 座物件`
const healthLine = z.strictObject({ if: z.literal("health_point"), share: z.number().min(0.05).max(0.95) })
const poise = z.strictObject({ amount: CombatAmountSchema, reset_seconds: z.number().min(1).max(30), immune_seconds: z.number().min(0).max(60) })
const accumulated = poise.extend({ if: z.literal("damage_taken") })
const stagger = z.strictObject({
  id: group.optional(), seconds: z.number().min(0.5).max(10), damage_scale: z.number().min(1).max(4),
  cooldown: z.number({error:"硬直后要歇几秒，请填数字。"}).min(0,"等待时间不能小于零。").max(3600,"等待时间最多一小时。").optional(),
  max_times: z.number({error:"请填一场最多硬直几次。"}).int("次数要填整数。").min(1,"一场至少允许一次。").max(65535,"次数最多 65535。").optional(),
  knockback_scale: z.number().finite().min(0).max(1).optional(),
  result: StanceResultSchema.optional(),
  clip: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/).refine(name => !["idle","walk","death"].includes(name), "硬直可以用自己的动作、借用受击动作，或不选动作。请选择模型里的其他动作。").nullable().optional(),
  /** r29: what is heard, seen and felt at its body the moment it begins (`ImpactFxSchema`); left out, nothing. */
  enter: ImpactFxSchema.optional(),
  on_interrupt: z.boolean().optional(), at_health: z.array(healthLine.shape.share).min(1).max(4).optional(), poise: poise.optional(),
  when: z.array(z.discriminatedUnion("if", [healthLine, accumulated, FixturesLitSchema])).min(1).max(5).optional(),
}).superRefine((value, ctx) => {
  if (value.when && (value.at_health || value.poise)) ctx.addIssue({ code:"custom", message:"硬直触发用 when 或 at_health、poise 中的一种写法。" })
  if (value.at_health?.some((n,i,a) => i > 0 && n >= a[i-1]!)) ctx.addIssue({ code:"custom", message:"硬直血量点请从高到低写，每个只写一次。" })
})
export const StaggerSchema = z.union([stagger, z.array(stagger.safeExtend({ id: group })).min(1).max(8)]).superRefine((value, ctx) => {
  const rows = Array.isArray(value) ? value : [value]
  if (new Set(rows.map(row => row.id)).size < rows.length) ctx.addIssue({code:"custom",message:"每种硬直请用不同的 id。"})
  if (rows.filter(row => row.on_interrupt).length > 1) ctx.addIssue({code:"custom",message:"被打断时只能直接进入一种硬直，请只给一种打开 on_interrupt。"})
})
export type Stagger = z.infer<typeof StaggerSchema>
export const staggerList = (value: Stagger | undefined) => value ? Array.isArray(value) ? value : [value] : []
export const staggerConditions = (row: z.infer<typeof stagger>) => row.when ?? [
  ...(row.at_health ?? []).map(share => ({if: "health_point" as const, share})),
  ...(row.poise ? [{if: "damage_taken" as const, ...row.poise}] : []),
]

const resultFields = { interrupt: z.literal(true).optional(), stagger: group.optional() }
export const CollisionConditionSchema = z.strictObject({if:z.literal("collision"),with:z.enum(["world","own_terrain","other_terrain"],{error:"碰撞对象填 world（世界墙）、own_terrain（自己立的）或 other_terrain（别人立的）"})})
export const CollisionRuleSchema = z.strictObject({when:CollisionConditionSchema,result:z.strictObject({...resultFields,impact:ImpactFxSchema.optional(),shatter_terrain:z.number({error:"撞碎地形的力度要填数字"}).min(0,"撞碎地形的力度至少为 0").max(50,"撞碎地形的力度最多为 50").optional()}).refine(r=>r.interrupt || r.stagger || r.shatter_terrain!==undefined,"请写打断、硬直或碎裂力度")})
export const CombatResultSchema = z.strictObject({ fixture: FixtureActionSchema.omit({type:true}).optional(), ...resultFields, ...stanceResult }).refine(value => value.interrupt || value.stagger || value.fixture || value.stance, "打够以后请选择打断招式、进入硬直、改灯或切姿态。")
export const CombatAbilityShape = {
  openings: z.array(z.strictObject({
    from: z.number().nonnegative(), to: z.number().positive(), part: z.string().min(1).max(48).optional(),
    damage_scale: z.number().min(0).max(16), group: group.optional(),
  })).min(1).max(4).optional(),
  breaks: z.array(z.strictObject({
    group, hits: z.number().int().min(1).max(1024).optional(), total: CombatAmountSchema.optional(), result: CombatResultSchema,
    reset: z.literal("ability_end").optional(),
  }).refine(rule => Boolean(rule.hits) !== Boolean(rule.total), "每组只选一种计量：hits 数次数，total 按来击量。")).min(1).max(4).optional(),
}
export const GuardSchema = z.strictObject({ arc: z.number().min(30).max(360), damage_scale: z.number().min(0).max(0.95), by: z.enum(["melee","ranged","any"]) })
export const CombatCreatureShape = { stagger: StaggerSchema.optional(), guard: GuardSchema.optional() }

// A break consumes the control fields; a completed phase consumes its event list.
// Future posture and arena results can extend this one type at their execution sites.
export type CombatResult<Event = never> = z.infer<typeof CombatResultSchema> & { events?: readonly Event[] }
export function combatResult<Event>(result: CombatResult<Event>) {
  return { ...(result.fixture ? {fixture:result.fixture} : {}), interrupt: result.interrupt === true, stagger: result.stagger, ...(result.stance ? { stance: result.stance } : {}), events: result.events ?? [] }
}

type ChoiceFields = {
  id?: string; interrupt?: unknown; openings?: unknown
  start?: { when?: unknown; repeat?: unknown; weight_when?: unknown; weight?: number }
  branches?: readonly { chance?: number | undefined }[] | undefined
}
export function usesCombat(creature: {
  guard?: unknown; stagger?: unknown
  abilities?: readonly ChoiceFields[] | null; shared_abilities?: readonly ChoiceFields[] | null; combos?: readonly ChoiceFields[] | null
  boss?: { phases?: readonly { finish?: unknown }[]; leash?: { reset_after_death_seconds?: number | undefined; distance?: number } | null } | null
}) {
  const choices = [...(creature.abilities ?? []), ...(creature.shared_abilities ?? []), ...(creature.combos ?? [])]
  return Boolean(creature.guard || creature.stagger || creature.boss?.leash?.reset_after_death_seconds !== undefined ||
    creature.boss?.phases?.some(phase=>phase.finish) || choices.some(choice=>choice.interrupt || choice.openings ||
      choice.start?.when || choice.start?.repeat || choice.start?.weight_when || choice.branches?.some(branch=>branch.chance !== undefined)))
}

type Windows = z.infer<z.ZodObject<typeof CombatAbilityShape>> & {stages?: readonly {end?: {collision?: readonly z.infer<typeof CollisionRuleSchema>[] | undefined} | undefined}[] | undefined}

export function combatBreaks(move: Windows, stagger?: Stagger) {
  const kinds = staggerList(stagger)
  return (move.breaks ?? []).flatMap(rule => {
    const windows = (move.openings ?? []).filter(window => window.group === rule.group)
    if (!windows.length || !(rule.result.interrupt || rule.result.stagger)) return []
    const places = [...new Set(windows.map(window => window.part ?? "全身"))].map(place => `「${place}」`).join("或")
    const kind = rule.result.stagger ? kinds.find(row => (row.id ?? "default") === rule.result.stagger) : kinds.find(row => row.on_interrupt)
    const amount = rule.hits ? `打中 ${rule.hits} 次` : rule.total && "points" in rule.total ?
      `累计来击达 ${rule.total.points} 点` : rule.total ? `累计来击达满血的 ${Math.round(rule.total.share * 100)}%` : ""
    const reaction = kind ? `，进入硬直 ${kind.seconds} 秒` : rule.result.stagger ? "，进入硬直" : ""
    return [{ windows, text: `破绽开放时打中${places}（${amount}），招式会被打断${reaction}` }]
  })
}

export function abilityInterruptionWords(move: Windows & { stopped_by_hurt: boolean }, stagger?: Stagger) {
  const breaks = combatBreaks(move, stagger)
  if (!breaks.length) return move.stopped_by_hurt ? "中途挨打会被打断" : "挨打也不会停"
  return breaks.map(row => row.text).join("。") + (move.stopped_by_hurt ? "。其他命中也可按原来的打断条件打断这招" : "，别的挨打不会停")
}

type CreatureCombat = z.infer<z.ZodObject<typeof CombatCreatureShape>>
type CombatCreature = CreatureCombat & { health?: number; boss?: { damage_cap?: number | null | undefined } | null; behavior: string; flight?: unknown; abilities?: readonly (Windows & { length?: number })[] | null; shared_abilities?: readonly Windows[] | null; hitbox?: { parts?: readonly { name: string }[] | null } | null }
export function combatIssues(creature: CombatCreature) {
  const issues: { path: (string | number)[]; message: string }[] = []
  const kinds = staggerList(creature.stagger)
  if (kinds.length && (creature.flight || creature.behavior !== "hostile" || !(creature.abilities?.length || creature.shared_abilities?.length))) issues.push({path:["stagger"], message:"硬直需要有招式的地面敌对生物。会飞的生物请去掉 stagger。眩晕时它无法继续控制飞行。" })
  if (creature.guard && (creature.behavior !== "hostile" || !(creature.abilities?.length || creature.shared_abilities?.length)))
    issues.push({ path: ["guard"], message: "正面格挡需要敌对生物并至少写一招或引用一个技能。" })
  const moves = [...(creature.abilities ?? []), ...(creature.shared_abilities ?? [])]
  if (creature.guard?.arc === 360 && creature.guard.damage_scale === 0 && !kinds.length && !moves.some(move => move.openings?.length))
    issues.push({path:["guard"],message:"360 度格挡把所有合格来击都挡光了。请缩小 arc、提高 damage_scale 或给这只生物加破绽窗口或硬直。"})
  for (const key of ["abilities", "shared_abilities"] as const) {
    (creature[key] ?? []).forEach((move, index) => {
      const add = (path: (number|string)[], message: string) => issues.push({ path: [key, index, ...path], message })
      const interrupt = (move as { interrupt?: Interrupt }).interrupt
      const cap = creature.boss?.damage_cap
      if (interrupt?.hit && cap && !interrupt.hits && !interrupt.total && ("points" in interrupt.hit ? interrupt.hit.points : interrupt.hit.share * (creature.health ?? 0)) > cap)
        add(["interrupt","hit"], "单次打断阈值比 Boss 的单次掉血上限更高。请降低 hit，或改用累计掉血 total。")
      for(const [i,stage] of (move.stages ?? []).entries()) for(const rule of stage.end?.collision ?? []) if(rule.result.stagger && !kinds.some(s=>(s.id??"default")===rule.result.stagger)) add(["stages",i,"end","collision"],"请先在 stagger 定义撞击后进入的硬直。")
      const windows = move.openings ?? []
      const rules = move.breaks ?? []
      windows.forEach((w, i) => {
        const from = Math.round(20 * w.from), to = Math.round(20 * w.to)
        if (to <= from || ("length" in move && typeof move.length === "number" && w.to > move.length)) add(["openings",i,"to"], "破绽至少持续一刻，结束时间不能超过招式全长。")
        if (windows.slice(0,i).some(other => other.part === w.part && Math.round(20 * other.from) < to && Math.round(20 * other.to) > from)) add(["openings",i,"from"], "同一部位的窗口不能重叠，请调整起止时间。")
        if (w.part && !creature.hitbox?.parts?.some(part => part.name === w.part)) add(["openings",i,"part"], "窗口部位要写碰撞箱里已有的 name。")
        if (w.group && !rules.some(rule => rule.group === w.group)) add(["openings",i,"group"], "请在这招的 breaks 里写出本组打够之后的结果。")
      })
      rules.forEach((rule,i) => {
        if (rule.result.stagger && !kinds.some(row => (row.id ?? "default") === rule.result.stagger)) add(["breaks",i,"result","stagger"], "请在 stagger 里定义这个名字的硬直，或改用已有名字。")
        if (rules.findIndex(other => other.group === rule.group) !== i || !windows.some(w => w.group === rule.group)) add(["breaks",i,"group"], "每组只写一条规则，并在至少一个破绽窗口中使用这个组名。")
      })
    })
  }
  kinds.forEach((row,i) => {
    if (staggerConditions(row).length || row.on_interrupt) return
    const id = row.id ?? "default"
    if (!moves.some(move => move.breaks?.some(rule => rule.result.stagger === id) || move.stages?.some(s=>s.end?.collision?.some(r=>r.result.stagger===id))))
      issues.push({path: Array.isArray(creature.stagger) ? ["stagger",i] : ["stagger"], message:"请写血量点、破防累计或打开被打断时硬直，也可以在招式的 breaks.result.stagger 里点名它。"})
  })
  return issues
}

type Part = { name: string; damage_scale?: number | undefined; phase_scales?: { phase: number; damage_scale: number }[] | undefined }
export function combatScaleTable(creature: CreatureCombat & { stances?: Stances | undefined; boss?: { phases: readonly unknown[] } | null; hitbox?: { parts?: readonly Part[] | null } | null; abilities?: readonly (Windows & { name: string; length: number })[] | null }) {
  if (!creature.stances && !creature.guard && !creature.stagger && !creature.abilities?.some(move => move.openings || move.breaks || ("interrupt" in move && move.interrupt))) return []
  return Array.from({ length: 1 + (creature.boss?.phases.length ?? 0) }, (_, phase) => (creature.stances?.list ?? [undefined]).flatMap(stance => (creature.abilities ?? []).flatMap(move => {
    const windows = move.openings ?? []
    const ticks = [...new Set([0, Math.round(20 * move.length), ...windows.flatMap(w => [Math.round(20 * w.from), Math.round(20 * w.to)])])].sort((a,b) => a-b)
    return ticks.slice(0,-1).flatMap((from,i) => [null, ...(creature.hitbox?.parts ?? [])].map(part => {
      const open = windows.filter(w => from >= Math.round(w.from * 20) && from < Math.round(w.to * 20))
      const window = (part && open.find(w => w.part === part.name)) || open.find(w => !w.part)
      const phaseScale = part?.phase_scales?.find(row => row.phase === phase)
      const stanceScale = part ? stance?.part_scales?.find(entry => entry.part === part.name) : undefined
      const guard = stance?.guard === undefined ? creature.guard : stance.guard
      const scale = window?.damage_scale ?? stanceScale?.damage_scale ?? phaseScale?.damage_scale ?? part?.damage_scale ?? 1
      const source = window ? window.part ? "部位窗口" : "全身窗口" : stanceScale ? "姿态" : phaseScale ? "阶段条目" : part?.damage_scale !== undefined ? "部位自身" : "默认"
      return { phase, ...(stance ? { stance: stance.id, stanceName: stance.name } : {}), ability: move.name, from, to: ticks[i+1]!, part: part?.name ?? "主身", source, scale, front: scale * (!window && guard ? guard.damage_scale : 1), back: scale * (!window && guard?.arc === 360 ? guard.damage_scale : 1) }
    }))
  }))).flat()
}

export type Guard = z.infer<typeof CombatCreatureShape.guard>
const share = z.number().min(0.05).max(0.95)
const scale = z.number().min(0).max(10)
const healthBelow = z.strictObject({ if: z.literal("health_below"), share })
const healthAbove = z.strictObject({ if: z.literal("health_above"), share })
const noSight = z.strictObject({ if: z.literal("no_sight") })
const degrees = z.number().finite().min(-180).max(180)
const bearingShape = {
  if: z.literal("target_bearing"),
  arc: z.tuple([degrees, degrees]).refine(([from, to]) => from !== to && !(from === 180 && to === -180), "请给方向范围两个不同的边界。"),
  seconds: z.number().finite().min(0).max(30).optional(),
}
const targetBearing = z.strictObject(bearingShape)
export type TargetBearing = z.infer<typeof targetBearing>

export function bearingMatches(rule: TargetBearing, bearing: number, ticks: number) {
  const signed = ((bearing % 360 + 540) % 360) - 180
  const [from, to] = rule.arc
  const angle = signed === -180 && to === 180 ? 180 : signed
  const inside = from > to ? angle >= from || angle <= to : angle >= from && angle <= to
  return inside && ticks >= Math.ceil(20 * (rule.seconds ?? 0))
}

export function bearingConditionWords(rule: TargetBearing) {
  const [from, to] = rule.arc
  const angle = (value: number) => value === 0 ? "正前方" : Math.abs(value) === 180 ? "正后方" : `${value < 0 ? "左" : "右"} ${Math.abs(value)}°`
  return `目标在身体的${angle(from)}到${angle(to)}之间${from > to ? "（跨过正后方）" : ""}${rule.seconds ? `达 ${rule.seconds} 秒` : ""}`
}

/**
 * r28 (`hasDirectionalStrike`, `faceTolerance`): an ability whose every hit lands the same whichever way the body faces starts from any heading. The rule was in the code and not in
 * what an outside AI reads (r28 recheck 1): it said 「不分方向的招不要朝向」 nowhere, so it wrote target_bearing or keep_heading for a whole-arena move that needs neither.
 */
export const OMNI_START_INSTRUCTIONS =
  "起手前要不要先朝向目标，看招式的出手：落点随身体朝向变的（打在身前的球、盒、扇形、锥形、光束，投射物，挂在骨骼上的判定，带命中的冲刺，偏在身体一侧的落点），身体要先转到能打中的角度以内才起手；" +
  "不分方向的招（全场招 arena、以自身为中心的球、360° 的圆或环、只有演出和地形没有命中判定的）起手不要朝向，门槛按 180° 算，背对目标也照样起手，不用为它写 keep_heading 或 target_bearing。"

export const TARGET_BEARING_INSTRUCTIONS = '招式、连招和引用技能的 start.when 可加入 {if:"target_bearing",arc:[120,-120],seconds:1}。身体正前方为 0°，左侧为负，右侧为正，±180° 都是背后。起点大于终点表示跨过正后方。seconds 可省略，写了就要求同一个目标连续在该方向这么久。相同条件加上 scale 可以写入 start.weight_when，只调选招权重。start.keep_heading:true 允许不先面向目标就起手。配合 facing:"lock"，石像守卫可在目标绕到身后满一秒时，保持朝向优先使用原地扫一圈的招式。' + OMNI_START_INSTRUCTIONS

const inStance = z.strictObject({ if: z.literal("stance"), id: StanceIdSchema })
const stanceElapsed = z.strictObject({ if: z.literal("stance_elapsed"), seconds: z.number().min(0.05).max(3600) })
const targetStill = z.strictObject({ if: z.literal("target_still"), within: z.number().min(0.5).max(64), seconds: z.number().min(0.05).max(120) })

const stanceDestination = { to: StanceIdSchema }
export const StanceWhenSchema = z.discriminatedUnion("if", [
  healthLine.extend(stanceDestination), accumulated.omit({ immune_seconds: true }).extend(stanceDestination),
  healthBelow.extend(stanceDestination), healthAbove.extend(stanceDestination),
  FixturesLitSchema.extend(stanceDestination), stanceElapsed.extend(stanceDestination), targetStill.extend(stanceDestination),
])
export type StanceWhen = z.infer<typeof StanceWhenSchema>

export const EncounterConditionSchema = z.discriminatedUnion("if", [healthBelow,healthAbove,noSight,
  z.strictObject({if:z.literal("phase_range"),from:z.int().min(1),to:z.int().min(1).optional()}),
  z.strictObject({if:z.enum(["intro","dormant","fog"])}),
  z.strictObject({if:z.literal("ability"),id:z.string().min(1),include_windup:z.boolean().optional()}),
])

export const CombatConditionSchema = z.discriminatedUnion("if", [healthLine, accumulated, healthBelow, healthAbove, noSight, FixturesLitSchema, CollisionConditionSchema, targetBearing, inStance, stanceElapsed, targetStill])
export type CombatCondition = z.infer<typeof CombatConditionSchema>

// Conditions are restricted by the context that evaluates them. Future senses can add observations here.
export const WeightWhenSchema = z.discriminatedUnion("if", [healthBelow.extend({ scale }), healthAbove.extend({ scale }), noSight.extend({ scale }), FixturesLitSchema.extend({ scale }), z.strictObject({ ...bearingShape, scale }), inStance.extend({ scale })])
export const CombatStartShape = {
  when: z.array(z.discriminatedUnion("if", [FixturesLitSchema, targetBearing, inStance])).min(1).max(4).optional(),
  repeat: z.strictObject({ weight_scale: z.number().min(0).max(1), recover_seconds: z.number().min(0.5).max(120) }).optional(),
  weight_when: z.array(WeightWhenSchema).min(1).max(4).optional(),
  keep_heading: z.boolean().optional(),
}
export const BranchChanceSchema = z.number().min(0.05).max(1)

type Start = z.infer<z.ZodObject<typeof CombatStartShape>> & { weight: number }
export function combatWeight(start: Start, health: number, visible: boolean, elapsedTicks?: number, litCount: (arc: number) => number = () => 0, bearing?: { angle: number; ticks: number }, stance?: string) {
  const repeat = start.repeat
  const recovery = repeat && elapsedTicks !== undefined ? repeat.weight_scale + (1 - repeat.weight_scale) * Math.min(1, elapsedTicks / Math.round(20 * repeat.recover_seconds)) : 1
  return (start.weight_when ?? []).reduce((weight, rule) => {
    const matches = rule.if === "stance" ? stance === rule.id : rule.if === "target_bearing" ? bearing !== undefined && bearingMatches(rule, bearing.angle, bearing.ticks) :
      rule.if === "fixtures_lit" ? litCount(rule.within_arc ?? 360) >= rule.count : rule.if === "no_sight" ? !visible : rule.if === "health_above" ? health > rule.share : health < rule.share
    return matches ? weight * rule.scale : weight
  }, start.weight * recovery)
}

export function combatGuide(creature: CreatureCombat & { abilities?: readonly Ability[] | null; boss?: Boss | null }, partName: (id:string)=>string = id=>id, staggerName: (id:string)=>string = id=>id) {
  const lines: string[] = []
  const guard = creature.guard
  if (guard) lines.push(`从正面 ${guard.arc} 度以内打它，${{melee:"近战",ranged:"远程",any:"有方向的"}[guard.by]}伤害只结算 ${Math.round(100*guard.damage_scale)}%。命中开着的破绽或它正在硬直时，可以绕开格挡。`)
  for (const kind of staggerList(creature.stagger)) {
    const triggers=staggerConditions(kind).map(c=>c.if==="fixtures_lit" ? fixtureConditionWords(c) : c.if==="health_point" ? `血量跌过 ${Math.round(100*c.share)}%` :
      `累计来击达到${"points" in c.amount ? c.amount.points+" 点" : "满血的 "+Math.round(100*c.amount.share)+"%"}（停手 ${c.reset_seconds} 秒清零）`)
    if(kind.on_interrupt) triggers.push("打断它的招式")
    lines.push(`${kind.id ? staggerName(kind.id) : "破防"}硬直持续 ${kind.seconds} 秒，期间受到 ${kind.damage_scale} 倍伤害。${kind.cooldown === undefined ? "" : `结束后歇 ${kind.cooldown} 秒。`}${kind.max_times === undefined ? "" : `每场最多 ${kind.max_times} 次。`}${kind.knockback_scale === undefined ? "" : `击退按平时的 ${Math.round(kind.knockback_scale * 100)}% 结算。`}${triggers.length ? "触发方式为"+triggers.join("或")+"。" : "打够招式指定的破绽窗口可触发。"}${kind.enter ? `进入时${impactFxWords(kind.enter)}。` : ""}`)
  }
  for(const move of creature.abilities ?? []) {
    if (combatBreaks(move, creature.stagger).length) lines.push(`「${move.name}」${abilityInterruptionWords(move, creature.stagger)}。`)
    for(const rule of move.start.when ?? []) lines.push(`「${move.name}」需要${rule.if === "fixtures_lit" ? fixtureConditionWords(rule) : rule.if === "stance" ? `处于「${rule.id}」姿态` : bearingConditionWords(rule)}。`)
    for(const rule of move.start.weight_when ?? []) if(rule.if === "fixtures_lit") lines.push(`${fixtureConditionWords(rule)}时，「${move.name}」的选中权重乘 ${rule.scale}。`)
    if(move.interrupt) {
      const {hit,total,hits,part,from,to}=move.interrupt
      const format=(a:CombatAmount)=>"points" in a ? a.points+" 点" : "满血的 "+Math.round(a.share*100)+"%"
      const limits=[hit && "单次掉血达"+format(hit),total && "累计掉血达"+format(total),hits && "有效命中 "+hits+" 次"].filter(Boolean)
      lines.push(`「${move.name}」在第 ${from??0} 至 ${to??move.length} 秒可打断。${part ? "命中「"+partName(part)+"」时，" : ""}${limits.join("或")}即中断。`)
    }
    for(const w of move.openings ?? []) lines.push(`「${move.name}」第 ${w.from} 至 ${w.to} 秒，${w.part ? partName(w.part) : "全身"}承受 ${w.damage_scale} 倍伤害。`)
  }
  if(creature.boss?.leash?.reset_after_death_seconds!==undefined) lines.push(`参战玩家全部阵亡后 ${creature.boss.leash.reset_after_death_seconds} 秒，首领恢复满血并回到初始阶段。`)
  return lines
}

// Nonblocking notes use the same ticks, conditions and scales as the generated fight.
export function combatAdvice(creature: CreatureCombat & {
  abilities?: readonly Ability[] | null; combos?: readonly Combo[] | null
  boss?: Partial<Pick<Boss,"damage_cap"|"phases">> | null
  hitbox?: {parts?: readonly Part[] | null} | null
}) {
  const rows: { ability: string; refs?: ReturnType<typeof abilityRef>[]; rule: "ability_warn"; stops: false; text: string; fix: string; detail: string }[] = []
  const moves=creature.abilities ?? []
  const warn = (ability:string, text:string, fix:string, detail:string) => {
    const move = moves.find(move => move.id === ability)
    rows.push({ability, ...(move ? {refs: [abilityRef(move)]} : {}), rule:"ability_warn",stops:false,text,fix,detail})
  }
  const first=moves[0]?.id ?? "combat"
  if (creature.guard && creature.guard.arc >= 180 && creature.guard.damage_scale <= 0.1 && !creature.stagger && !moves.some(move => move.openings?.length))
    warn(first,"正面只能打掉一成血左右，玩家需要绕后。","可给重招收尾加 openings，或加累计破防。","guard")
  for (const move of moves) {
    const rule=move.interrupt
    if (rule?.hit && "points" in rule.hit && rule.hit.points <= 1)
      warn(move.id,"单次掉血 1 点就能打断这招。","想抗住轻击时请提高 hit。","interrupt.hit")
    if (rule?.from && move.hits.length && rule.from > Math.min(...move.hits.map(hit=>hit.at)))
      warn(move.id,"打断窗口在第一次出手后才开始。","如需阻止第一次出手，请提前 from。","interrupt.from")
    const breakWindows = combatBreaks(move, creature.stagger).flatMap(row => row.windows)
    if (breakWindows.length && move.hits.length && breakWindows.every(window => window.from > Math.min(...move.hits.map(hit => hit.at))))
      warn(move.id, "能打断这招的破绽都在第一次出手之后才开放。", "想阻止第一次出手时，请提前放出破绽。", "openings")
    for (const opening of move.openings ?? []) {
      const parts=creature.hitbox?.parts ?? []
      const targets=opening.part ? parts.filter(p=>p.name===opening.part) : [{damage_scale:1},...parts]
      if (!creature.guard && !opening.group && targets.every(p=>(p.damage_scale ?? 1)===opening.damage_scale && (!("phase_scales" in p) || p.phase_scales?.every(r=>r.damage_scale===opening.damage_scale)!==false)))
        warn(move.id,"这个破绽窗口和平时的倍率相同。","要露出弱点，请提高窗口的 damage_scale。","openings.damage_scale")
    }
  }
  for (const kind of staggerList(creature.stagger)) {
    for (const condition of staggerConditions(kind)) {
      if (condition.if==="health_point" && creature.boss?.phases?.some(phase=>Math.abs(phase.below-condition.share)<0.01))
        warn(first,"硬直点与阶段线重合，会先转换，结束后硬直。","若想把两段分开，请错开血量点。","stagger.health_point")
      if (condition.if==="damage_taken" && Math.max(condition.immune_seconds, kind.cooldown ?? 0)<kind.seconds)
        warn(first,"持续挨打时，这种硬直可能占去一半以上的时间。","需要留出反击时间时，请延长 immune_seconds。","stagger.immune_seconds")
    }
  }
  if (creature.boss?.damage_cap && (staggerList(creature.stagger).some(row=>row.damage_scale>1) || moves.some(move=>move.openings?.some(w=>w.damage_scale>1))))
    warn(first,"易伤倍率在 Boss 单次掉血上限之前结算，已到上限的来击不会再多掉血。","要让重击也体现易伤，请核对 damage_cap。","boss.damage_cap")
  const choices=[...moves.filter(move=>!move.on_hurt),...(creature.combos ?? [])]
  if (choices.length && choices.some(move=>move.start.weight_when?.some(rule=>rule.scale===0))) {
    const lines=[...new Set([0,1,...choices.flatMap(move=>move.start.weight_when?.flatMap(rule=>"share" in rule ? [rule.share] : []) ?? [])])].sort((a,b)=>a-b)
    for (let i=1;i<lines.length;i++) {
      const low=lines[i-1]!, high=lines[i]!
      if (choices.every(move=>combatWeight(move.start,(low+high)/2,true)===0))
        warn(first,`血量在 ${Math.round(100*low)}% 到 ${Math.round(100*high)}% 之间时，即使看得见目标也没有可选招。`,"给至少一招保留正权重。","start.weight_when")
    }
  }
  return rows
}

export const COMBAT_INSTRUCTIONS = "全部可以不写。招式、连招和引用技能的 start.repeat 用 weight_scale 和 recover_seconds 设置刚收招时的权重和恢复时间。start.when 写条件数组，全部成立才可出招。start.weight_when 写 if（health_below、health_above 配 share，no_sight 或 fixtures_lit 配 count、可选总角 within_arc）和 scale，满足的倍率依次相乘。所有可用招的权重都是 0 时等待。连招分支 chance 是条件满足以后走这条的概率，未选中会继续试下一条。interrupt 可限定 from（含）、to（不含）、part（碰撞箱名）。hit、total 看这一下或累计实际掉血，hits 看有效命中次数。写它时打开 stopped_by_hurt；玩家施法要在 cancel_on 中写 hurt，从按下开始计时。Boss 阶段 finish 最多 6 条，在转换结束那一刻放声音、粒子、特效、震屏或地面效果。收尾的 particle 可写原版名、工程粒子的 {asset}，也可用 {alias} 引用这只生物 particles 里定义的名字。地面效果写 {type:\"ground\",ground:[…]}，内容同投射物落地。leash.reset_after_death_seconds 写参战玩家全部死亡后等几秒重置。openings 按碰撞箱 name 覆盖部位倍率，同期部位窗口优先于全身窗口。窗口内跳过 guard；其他命中在身体正面 arc 度且符合 by 时乘 damage_scale。多个窗口写同一个 group，可用 breaks 的 total（原始来击量）或 hits 触发 result，计数在每次出招结束清零。stagger 一种时直接写，多种时写带 id 的数组；seconds、clip、damage_scale 决定硬直的时长、动作和易伤。每种硬直可写 cooldown（结束后歇几秒）和 max_times（一场最多几次），只在实际进入时计次；Boss 脱战重置，普通敌人连续五秒没有活目标后重置。省略时不额外限制。at_health 到血量点触发，poise 在部位和格挡之前累计，0 倍的盾也计入，on_interrupt 可在打断时触发。每种硬直可写 enter（写法同撞上那一刻的声光 impact：{sound, volume, pitch, particle, count, spread, shake}），进入这种硬直那一刻在它身上放；不写就没有。玩家施法按每刻损失的血量和吸收量计算。\n例如在已有地面敌对生物上加：{\"guard\":{\"arc\":120,\"by\":\"melee\",\"damage_scale\":0.2},\"stagger\":{\"seconds\":1.5,\"damage_scale\":2,\"on_interrupt\":true,\"poise\":{\"amount\":{\"points\":12},\"reset_seconds\":3,\"immune_seconds\":2}}}。请在它的一招上打开 stopped_by_hurt，并写 interrupt.hit.points 为 6。"
