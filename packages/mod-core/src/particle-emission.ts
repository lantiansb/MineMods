import { landingTick, earlyLanding } from "./hit-origin"
import { z } from "zod"
import { EncounterConditionSchema } from "./combat"
import { ABILITY_PARTICLES, ABILITY_PARTICLE_IDS } from "./ability-words"

const horizontal = z.number().min(0).max(32)
const speed = z.number().min(-20).max(20).optional()
export const ResolvedParticleSchema = z.union([z.enum(ABILITY_PARTICLE_IDS), z.strictObject({ asset: z.uuid() })])
export const ParticleAliasesSchema = z.record(z.string().min(1).max(64), ResolvedParticleSchema)
export const ParticleRefSchema = z.union([ResolvedParticleSchema, z.strictObject({ alias: z.string().min(1).max(64) })])
export type ParticleRef = z.infer<typeof ParticleRefSchema>
export type ParticleAliases = z.infer<typeof ParticleAliasesSchema>
export const resolveParticle = (ref: ParticleRef, aliases?: ParticleAliases) =>
  typeof ref === "object" && "alias" in ref ? aliases && Object.hasOwn(aliases, ref.alias) ? aliases[ref.alias] : undefined : ref

const branches = ["events", "hits", "abilities", "emitters", "trail", "look", "impact", "ground", "boss", "intro", "death", "steps", "phases", "finish", "stages", "end", "collision", "result", "moves", "stagger", "enter", "wall", "touch"]
type Owner = { particles?: ParticleAliases }
function walkRefs(value: unknown, path: (string | number)[], visit: (ref: ParticleRef, path: (string | number)[]) => ParticleRef): unknown {
  if (Array.isArray(value)) {
    const next = value.map((child, i) => walkRefs(child, [...path, i], visit))
    return next.some((child, i) => child !== value[i]) ? next : value
  }
  if (!value || typeof value !== "object") return value
  const original = value as Record<string, unknown>
  let out = original
  const keys = path.at(-1) === "builtin" ? Object.keys(original) : ["particle", "dust", "builtin", ...branches]
  for (const key of keys) {
    if (original[key] == null) continue
    const at = [...path, key]
    const value = original[key]
    const nested = value !== null && typeof value === "object" && "particle" in value
    const next = (key === "particle" || key === "dust") && !nested ? visit(value as ParticleRef, at) : walkRefs(value, at, visit)
    if (next !== original[key]) out = { ...out, [key]: next }
  }
  return out
}
export function aliasIssues(owner: Owner) {
  const issues: { path: (string | number)[]; message: string }[] = []
  walkRefs(owner, [], (ref, path) => {
    if (typeof ref === "object" && "alias" in ref && !resolveParticle(ref, owner.particles)) issues.push({ path, message: `找不到粒子别名「${ref.alias}」，请在这份文档的 particles 里定义它。` })
    return ref
  })
  return issues
}
export function missingParticleRefs(owner: Owner & { events?: readonly unknown[]; hits?: readonly unknown[] }, hasAsset: (id: string) => boolean, includeUnusedAliases = false) {
  const issues: { path: (string | number)[]; name: string; asset?: string; alias?: string }[] = []
  walkRefs(owner, [], (ref, path) => {
    const alias = typeof ref === "object" && "alias" in ref ? ref.alias : undefined
    const found = resolveParticle(ref, owner.particles)
    if (typeof found === "string" && !Object.hasOwn(ABILITY_PARTICLES, found)) issues.push({ path, name: found, alias })
    if (typeof found === "object" && !hasAsset(found.asset)) issues.push({ path, name: alias ?? "工程粒子", asset: found.asset, alias })
    if (!found && alias) issues.push({ path, name: alias, alias })
    return ref
  })
  if (includeUnusedAliases) {
    const reported = new Set(issues.map(issue => issue.alias))
    for (const [alias, ref] of Object.entries(owner.particles ?? {})) {
      if (typeof ref === "object" && !hasAsset(ref.asset) && !reported.has(alias)) {
        issues.push({ path: ["particles", alias], name: alias, asset: ref.asset, alias })
      }
    }
  }
  return issues
}
export function resolveAliases<T extends Owner>(owner: T, strict = true): T {
  if (!owner.particles) return owner
  return walkRefs(owner, [], ref => {
    const found = resolveParticle(ref, owner.particles)
    if (!found && strict) throw new Error("找不到粒子别名：" + (typeof ref === "object" && "alias" in ref ? ref.alias : ""))
    return found ?? ref
  }) as T
}
export function particleDependencies(owner: Owner & { shared_abilities?: readonly Owner[] | null }) {
  const ids = new Set(Object.values(owner.particles ?? {}).flatMap(ref => typeof ref === "object" ? [ref.asset] : []))
  for (const use of owner.shared_abilities ?? []) for (const ref of Object.values(use.particles ?? {})) if (typeof ref === "object") ids.add(ref.asset)
  walkRefs(owner, [], ref => {
    const found = resolveParticle(ref, owner.particles)
    if (typeof found === "object") ids.add(found.asset)
    return ref
  })
  return [...ids]
}
export type ParticleNames = { title?: ((id: string) => string | null) | null; aliases?: ParticleAliases; displayNames?: boolean; bone?: (id: string) => string }
export function particleLabel(ref: ParticleRef, names: ParticleNames = {}) {
  const found = resolveParticle(ref, names.aliases)
  const title = typeof found === "string" ? ABILITY_PARTICLES[found] : found ? names.title?.(found.asset) ?? (names.displayNames ? null : found.asset) : null
  if (names.displayNames && typeof ref === "object" && "alias" in ref && !/[一-龥]/.test(ref.alias)) return title ?? "找不到粒子"
  return typeof ref === "object" && "alias" in ref ? title ?? `未找到的粒子别名「${ref.alias}」` : title ?? (names.displayNames ? "找不到粒子" : "")
}
export function assetOf(ref: ParticleRef) {
  return typeof ref === "object" && "asset" in ref ? ref.asset : null
}
export function resolvedAsset(ref: Exclude<ParticleRef, string>) {
  if ("asset" in ref) return ref.asset
  throw new Error(`粒子别名「${ref.alias}」尚未解析。`)
}
export const ScatterFields = {
  shape: z.enum(["ball", "disc", "ring"]).optional(),
  spread: z.union([z.number().min(0).max(4), z.strictObject({ forward: horizontal, up: z.number().min(0).max(8), left: horizontal })]),
  velocity: z.strictObject({ forward: speed, up: speed, left: speed, outward: speed, vary: z.number().min(0).max(1).optional() }).optional(),
  motion: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("converge") }),
    z.strictObject({ type: z.literal("orbit"), turns: z.number().min(-4).max(4) }),
  ]).optional(),
  tint: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  bone: z.string().min(1).max(64).optional(),
}
export const TimedScatter = {
  ...ScatterFields,
  until: z.number().min(0).max(120).optional(),
  every_ticks: z.number().int().min(1).max(20).optional(),
}
export const ParticleOrigin = { where: z.enum(["self", "target", "hit"]).optional(), hit: z.number().int().min(0).nullable().optional() }

export const EmitterSchema = z.strictObject({
  ...ScatterFields,
  spread: ScatterFields.spread.default(0),
  particle: ParticleRefSchema,
  every_ticks: z.number().int().min(1).max(1200),
  count: z.number().int().min(1).max(64),
  forward: z.number().min(-32).max(32).optional(), up: z.number().min(-32).max(32).optional(), left: z.number().min(-32).max(32).optional(),
  when: z.union([z.literal("always"), z.literal("combat"), z.strictObject({ phase: z.number().int().min(1) }), EncounterConditionSchema]).optional(),
})
export const EmittersSchema = z.array(EmitterSchema).max(16).superRefine((list, ctx) => {
  const peak = list.reduce((n, e) => n + e.count * Math.ceil(20 / e.every_ticks), 0)
  if (peak > 600) ctx.addIssue({ code: "custom", message: `常驻发射每秒最多冒 ${peak} 颗，超过 600 颗上限 ${peak - 600} 颗。减少 count 或增大 every_ticks。` })
  list.forEach((event, i) => {
    const r = scatterRange(event)
    if ((event.shape === "ring" || event.shape === "disc") && (!r.forward || !r.left)) ctx.addIssue({ code: "custom", path: [i, "spread"], message: "圆盘或圆环需要大于 0 的水平半径。" })
  })
})
export type Emitter = z.infer<typeof EmitterSchema>
export function emitterWhen(when: Emitter["when"], move?: (id: string) => string) {
  if(typeof when!=="object")return when==="combat"?"战斗中":"一直"
  if("phase" in when)return "第 "+when.phase+" 阶段"
  if(when.if==="phase_range")return "第 "+when.from+" 阶段起"+(when.to ? "至第 "+when.to+" 阶段":"")
  if(when.if==="ability")return "招式「"+(move?.(when.id) ?? when.id)+"」"+(when.include_windup===false?"出手后":"含蓄力")
  if(when.if==="health_below" || when.if==="health_above")return "血量"+(when.if==="health_below"?"低于":"高于")+Math.round(when.share*100)+"%"
  if(when.if==="no_sight")return "看不见目标时"
  return {intro:"登场期间",dormant:"尚未唤醒时",fog:"场地起雾期间"}[when.if]
}
export function emitterPhaseIssues(entity: { emitters?: Emitter[]; abilities?:readonly {id:string}[]|null; shared_abilities?:readonly {id:string}[]|null; boss?: { phases: unknown[];intro?:unknown;arena?:{fog?:unknown}|null } | null }) {
  return (entity.emitters??[]).flatMap((e,i)=>{
    const w=e.when
    if(typeof w!=="object")return []
    const max=entity.boss?entity.boss.phases.length+1:0
    const reason="phase" in w ? w.phase>max && "找不到第 "+w.phase+" 阶段。阶段从 1 数起，请填已有的阶段。" :
      w.if==="phase_range" ? (w.from>max || (w.to??w.from)>max || (w.to??w.from)<w.from) && "阶段范围超出已有阶段或结束早于开始。" :
      w.if==="ability" ? ![...(entity.abilities??[]),...(entity.shared_abilities??[])].some(a=>a.id===w.id) && "找不到招式「"+w.id+"」，请填本生物已有的招式编号。" :
      w.if==="fog" ? !entity.boss?.arena?.fog && "请先给这只生物设置场地雾。" : (w.if==="intro" || w.if==="dormant") && !entity.boss?.intro && "请先给这只生物设置登场和唤醒。"
    return reason?[{path:["emitters",i,"when"],message:reason}]:[]
  })
}
const Scatter = z.object(TimedScatter)
export type Scatter = z.infer<typeof Scatter>
export type EmitEvent = Scatter & { at: number; count: number; where?: string; hit?: number | null }

export const SCATTER_INSTRUCTIONS = "粒子可以写原版名、{asset:粒子资产 id}、{alias:别名}。在这份文档的 particles 里把别名指向原版名或工程粒子。where 写 self、target 或 hit，hit 从 0 数。bone 选模型部件，forward、up、left 再挪位置。直到 until 秒每 every_ticks 刻撒一把，省略间隔是 2 刻。velocity 的 forward、up、left、outward 是格/秒，vary 是快慢浮动的比例。shape 选 ball、disc、ring，spread 可以写一个数或 {forward,up,left}，水平最多 32 格，竖直最多 8 格。贴地雾可用 disc 和 {forward:20,up:0.08,left:20}。工程粒子可以用 motion:{type:'converge'} 往中间聚，或 {type:'orbit',turns:0.8} 每秒绕 0.8 圈，tint 写 #rrggbb 染色。每事件最多 600 颗，每招最多 1500 颗。"
export const EMITTER_INSTRUCTIONS = "任何生物都能用 emitters 写持续发射，每项填 particle、every_ticks、count，可加骨骼和撒法。when 省略或写 always 表示常驻，combat 表示有活着的战斗目标，硬直期间仍有活目标就继续发射，{phase:2} 只在 Boss 正打到第二阶段时发射，换阶段的演出里停，第三阶段也停（初始阶段为 1）。也可填 {if:\u0027phase_range\u0027,from:2,to:3}，省略 to 就一直到最后阶段；{if:\u0027intro\u0027}、{if:\u0027dormant\u0027}、{if:\u0027fog\u0027} 分别在登场、沉睡、场地起雾时生效；{if:\u0027ability\u0027,id:\u0027gust\u0027,include_windup:false} 只在出手后生效，省略 include_windup 包含蓄力。每只最多 16 处，一秒合计最多 600 颗，只发给发射点 64 格内的玩家。"
export function extendedEmit(event: Scatter & { where?: string; hit?: number | null }, cast = false) {
  return typeof event.spread !== "number" || event.shape !== undefined || event.velocity !== undefined || event.motion !== undefined || event.tint !== undefined || event.bone !== undefined || event.until !== undefined || event.every_ticks !== undefined || (!cast && event.where !== undefined) || event.hit !== undefined
}

export function emitTicks(event: Pick<EmitEvent, "at" | "until" | "every_ticks">) {
  const first = Math.round(event.at * 20)
  const last = Math.round((event.until ?? event.at) * 20)
  const interval = event.every_ticks ?? 2
  return Array.from({ length: Math.max(0, 1 + Math.floor((last - first) / interval)) }, (_, n) => first + n * interval)
}

export function scatterWords(event: EmitEvent & { forward:number; up:number; left:number }, name: string, bone?: (id: string) => string) {
  const r = scatterRange(event), v = event.velocity
  const speed = (value: number | undefined, positive: string, negative: string) =>
    value ? (value > 0 ? positive : negative) + " " + Math.abs(value) + " 格/秒" : null
  const offset = ([["前后",event.forward],["上下",event.up],["左右",event.left]] as const).filter(([,value])=>value).map(([axis,value])=>axis+"偏移 "+value+" 格")
  const axes = [r.forward,r.up,r.left].filter(n=>n>0).length
  const extent = axes === 1 ? "一线长 "+2*Math.max(r.forward,r.up,r.left)+" 格" : axes ? "前后、上下、左右半径 "+[r.forward,r.up,r.left].join("、")+" 格" : "一点"
  return [`${name}每把 ${event.count} 颗`, event.bone ? `从「${bone?.(event.bone) ?? event.bone}」冒` : event.where === "hit" ? `从第 ${(event.hit ?? 0)+1} 次出手处冒` : event.where === "target" ? "从目标冒" : "从脚下冒", ...offset, "第 "+event.at+" 秒开始",
    event.until !== undefined && `每 ${event.every_ticks ?? 2} 刻一把，至第 ${event.until} 秒`,
    event.shape === "disc" || event.shape === "ring" ? `${event.shape === "disc" ? "圆盘" : "圆环"}前后 ${r.forward}、左右 ${r.left}、上下 ${r.up} 格` : extent, v?.vary && `快慢浮动 ${Math.round(v.vary*100)}%`,
    speed(v?.forward,"往前","往后"), speed(v?.up,"往上","往下"), speed(v?.left,"往左","往右"), speed(v?.outward,"向外","向内"), event.motion?.type === "orbit" ? `每秒绕 ${event.motion.turns} 圈` : event.motion ? "往中心聚" : null, event.tint && `染成 ${event.tint}`].filter(Boolean).join("，")
}

export function scatterRange(event: Scatter) {
  return typeof event.spread === "number" ? { forward: event.spread, up: event.spread, left: event.spread } : event.spread
}

type EmissionHit = { type: string; at: number; warn?: {seconds:number;follow?:string;lock_before?:number}; place?: string | { type: "around_target"; count: number } | { type: "pattern"; points: readonly unknown[] } | { type?: undefined; fixture: string } }
export function emitIssues(events: readonly ({ type: string } | (EmitEvent & { type: "particle" }))[], length: number, hits: readonly EmissionHit[], pulses = 1, trails: readonly number[] = []) {
  const issues: { path: (string | number)[]; message: string }[] = []
  let total = trails.reduce((sum, count) => sum + count, 0)
  trails.forEach((count, index) => {
    if (count > 600) issues.push({path: ["hits", index, "trail"], message: `飞行拖尾最多会画 ${count} 颗，单次出手上限为 600 颗。调小 per_tick、减少投射物或缩短 lifetime_ticks。`})
  })
  events.forEach((event, i) => {
    if (event.type !== "particle" || !("spread" in event)) return
    const add = (key: string, message: string) => issues.push({ path: ["events", i, key], message })
    if (event.until !== undefined && (event.until < event.at || event.until > length)) add("until", "粒子结束的时间要在开始时间和招式结束之间。")
    if (event.every_ticks !== undefined && event.until === undefined) add("every_ticks", "要持续冒粒子，请用 until 写结束的时间。")
    if (event.where === "hit" ? event.hit == null || event.hit >= hits.length : event.hit != null) add("hit", "从出手位置冒时，hit 写已有出手的编号（从 0 数）；其他位置请省略 hit。")
    if (event.bone && event.where && event.where !== "self") add("bone", "从部件冒时，位置写 self 或省略 where。")
    const range = scatterRange(event)
    if ((event.shape === "disc" || event.shape === "ring") && (!range.forward || !range.left)) add("spread", "圆盘或圆环需要水平半径，请给 spread 的 forward 和 left 填大于 0 的格数。")
    const hit = event.where === "hit" && event.hit != null ? hits[event.hit] : undefined
    if (hit && Math.round(event.at*20) < (hit.place && hit.place !== "self" ? landingTick(hit) : Math.round(hit.at*20))) add("hit", hit.place && hit.place !== "self" ? earlyLanding(event.hit!,landingTick(hit)) : "这次出手还没发生，将粒子开始时间放到出手当刻或以后。")
    if (hit?.type === "gameplay" || hit?.type === "projectile") add("hit", "这次出手没有固定落点。投射物落地时的粒子请写在 impact 里。")
    const place = hit?.place
    const places = typeof place === "object" ? place.type === "pattern" ? place.points.length : place.type === "around_target" ? place.count : 1 : 1
    const count = event.count * emitTicks(event).length * places * pulses
    total += count
    if (count > 600) add("count", `第 ${i + 1} 个事件共冒 ${count} 颗，超过 600 颗上限 ${count - 600} 颗。调小 count 或增大 every_ticks。`)
  })
  if (total > 1500) issues.push({ path: ["events"], message: `这一招共冒 ${total} 颗，超过 1500 颗上限 ${total - 1500} 颗。减少每把的颗数或缩短持续时间。` })
  return issues
}
