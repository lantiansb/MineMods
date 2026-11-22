import { z } from "zod"
import { ABILITY_PARTICLE_IDS, ABILITY_PARTICLES, ABILITY_SOUND_IDS, ABILITY_SOUNDS } from "./ability-words"
import { SHAKE_LIMITS } from "./boss-words"

/**
 * r29 撞上那一刻: what is heard, seen and felt at the moment something runs into something (a charge into a wall, a ram into a player, the start of a daze),
 * where it really meets, not at a second of the ability. Each part may be left out; at least one is there.
 * - `sound`: a vanilla sound id or `{asset}` of the project's own; `volume` (default 1) and `pitch` (default 1).
 * - `particle`: a vanilla particle, `{asset}` of the project's own or `{alias}` of the creature's own aliases; `count` (default `IMPACT_FX.count`), `spread` (blocks, default `IMPACT_FX.spread`).
 * - `shake`: the screens of the players within `radius` blocks shake, weaker further away (strength within what every shake runtime holds, so it never needs the longer one).
 * The particle schema is written out here (the union `ParticleRefSchema` is, in particle-emission.ts) because that file imports combat.ts, which imports this one.
 */
export const IMPACT_FX = { count: 12, spread: 0.4, volume: 1, pitch: 1 } as const
const ParticleSchema = z.union([z.enum(ABILITY_PARTICLE_IDS), z.strictObject({ asset: z.uuid() }), z.strictObject({ alias: z.string().min(1).max(64) })])
export const ImpactFxSchema = z.strictObject({
  sound: z.union([z.enum(ABILITY_SOUND_IDS), z.strictObject({ asset: z.uuid() })]).optional(),
  volume: z.number().finite().min(0.2, "音量最小 0.2。").max(4, "音量最大 4。").optional(),
  pitch: z.number().finite().min(0.5, "音高最低 0.5。").max(2, "音高最高 2。").optional(),
  particle: ParticleSchema.optional(),
  count: z.number().int().min(1, "粒子至少 1 颗。").max(64, "一次最多 64 颗。").optional(),
  spread: z.number().finite().min(0).max(4, "散开最多 4 格。").optional(),
  shake: z.strictObject({
    strength: z.number().finite().min(SHAKE_LIMITS.strength.min).max(SHAKE_LIMITS.legacyCap),
    radius: z.number().finite().min(SHAKE_LIMITS.radius.min).max(SHAKE_LIMITS.radius.max),
    seconds: z.number().finite().min(SHAKE_LIMITS.seconds.min).max(SHAKE_LIMITS.seconds.max),
  }).optional(),
}).refine((fx) => fx.sound !== undefined || fx.particle !== undefined || fx.shake !== undefined, "撞上那一刻至少要放一样：sound（声音）、particle（粒子）或 shake（晃屏）。")
  .refine((fx) => fx.particle !== undefined || (fx.count === undefined && fx.spread === undefined), "写了 particle 才写 count 和 spread。")
  .refine((fx) => fx.sound !== undefined || (fx.volume === undefined && fx.pitch === undefined), "写了 sound 才写 volume 和 pitch。")
export type ImpactFx = z.infer<typeof ImpactFxSchema>
export { impactSlots, type ImpactSlot } from "./impact-slots"
/** What a dash or a loop runs into: a wall (`wall`) or a living thing not of its own kind (`touch`), each with what is shown at that moment. */
export const ImpactPairSchema = z.strictObject({ wall: ImpactFxSchema.optional(), touch: ImpactFxSchema.optional() })
  .refine((pair) => pair.wall || pair.touch, "impact 里至少写 wall（撞墙）或 touch（撞到生物）其中一个。")


/** 「闷响 + 土尘 12 颗 + 晃屏」: what one moment shows, in plain words (vanilla names by their Chinese name; the project's own by `title`). */
export function impactFxWords(fx: ImpactFx, title: (id: string) => string | null = () => null) {
  const particle = fx.particle === undefined ? null : typeof fx.particle === "string" ? ABILITY_PARTICLES[fx.particle] ?? fx.particle : "asset" in fx.particle ? title(fx.particle.asset) ?? "自己的粒子" : `粒子别名「${fx.particle.alias}」`
  const sound = fx.sound === undefined ? null : typeof fx.sound === "string" ? ABILITY_SOUNDS[fx.sound] ?? fx.sound : title(fx.sound.asset) ?? "自己的声音"
  return [sound ? `响「${sound}」` : null, particle ? `冒「${particle}」${fx.count ?? IMPACT_FX.count} 颗` : null, fx.shake ? `${fx.shake.radius} 格内晃屏 ${fx.shake.seconds} 秒` : null].filter(Boolean).join("、")
}

/** What an AI is told about the moment of impact. Part of `ABILITY_INSTRUCTIONS` (the stages and the dash) and of the stagger's words. */
export const IMPACT_INSTRUCTIONS =
  ` 撞上那一刻的声光（impact）：招式里的声音、粒子按第几秒放，撞墙、撞人的时刻不固定，要在真正撞上的那一刻、在撞点放，就写 impact。写法 {sound, volume, pitch, particle, count, spread, shake}，sound、particle、shake 至少一样：sound 是原版声音名或 {"asset":"声音资产的 UUID"}，volume 默认 ${IMPACT_FX.volume}（0.2–4），pitch 默认 ${IMPACT_FX.pitch}（0.5–2）；particle 是原版粒子名、{"asset":"粒子资产的 UUID"} 或 {"alias":"粒子别名"}，count 默认 ${IMPACT_FX.count}（1–64），spread 默认 ${IMPACT_FX.spread} 格（0–4）；shake 是 {strength ${SHAKE_LIMITS.strength.min}–${SHAKE_LIMITS.legacyCap}, radius ${SHAKE_LIMITS.radius.min}–${SHAKE_LIMITS.radius.max}, seconds ${SHAKE_LIMITS.seconds.min}–${SHAKE_LIMITS.seconds.max}}，撞点 radius 格内的玩家屏幕晃，越远越轻。用到自己的声音或粒子资产，生物任务要依赖它。能写在四个地方：` +
  `① 循环段碰撞规则的结果里 stages[].end.collision[].result.impact，撞墙或撞上地形那一刻在身体正前方的撞点放，同一次出招每条规则只放一次，例 {"when":{"if":"collision","with":"world"},"result":{"stagger":"wall_daze","impact":{"sound":{"asset":"闷响的 UUID"},"particle":{"asset":"碎石的 UUID"},"count":16,"shake":{"strength":1.5,"radius":12,"seconds":0.4}}}}；` +
  `② 循环段自己的结束条件旁边 stages[].end.impact:{wall, touch}，wall 要和 end.wall:true 一起写，循环段因为撞墙结束那一刻在撞点放；touch 要和 end.touch:true 一起写，因为碰到一个不是同类的生物结束那一刻、在两者相碰的地方放；` +
  `③ 冲刺 moves[] 里 type:"dash" 的 impact:{wall, touch}，wall 是冲刺被墙挡住那一刻（每次冲刺放一次），touch 是冲刺带的那次出手（hit）打中每个人那一刻、在那人身上挨撞的地方放，所以写 touch 要有 hit；` +
  `④ 硬直 stagger 的 enter，进入这一种硬直那一刻在它身上放（不管是撞墙进的还是别的条件进的）。不写 impact 的招式和原来完全一样。`
