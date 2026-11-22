import { z } from "zod"
import { TACTICS_LIMITS } from "./ability-tactics"

const speed = z.number().min(TACTICS_LIMITS.turn.min, "转速至少每秒 20 度。").max(TACTICS_LIMITS.turn.max, "转速最多每秒 1200 度。")
const angle = (max: number) => z.number().min(0, "角度不能小于零。").max(max, `角度最多 ${max} 度。`)

export const SteadySchema = z.strictObject({
  preset: z.enum(["auto", "large", "huge", "colossal"]).optional(),
  body_turn: z.number().min(0, "身体转速不能小于零。").max(TACTICS_LIMITS.turn.max, "身体每秒最多转 1200 度。").refine(v => v === 0 || v >= 1, "平时每秒至少转 1 度；只在出招时转请填 0。").optional(),
  head: z.strictObject({ turn: speed.optional(), yaw: angle(180).optional(), pitch: angle(90).optional() }).optional(),
  turn_after: angle(180).optional(),
  idle_look: z.enum(["around", "players", "none"]).optional(),
  ability_turn: speed.optional(),
  focus: z.strictObject({
    hold: z.number().min(0).max(60).optional(),
    leave: z.number().min(2).max(64).optional(),
    hurt: z.number().min(0.02).max(1).optional(),
  }).optional(),
})
export type Steady = z.infer<typeof SteadySchema>

const preset = (height: number, label: string, body: number, head: number, yaw: number, ability: number) => ({
  height, label, body_turn: body, head: { turn: head, yaw, pitch: 45 }, ability_turn: ability,
  idle_look: "players" as const, side_ticks: 200, path_ticks: 20,
})
export const STEADY_PRESETS = {
  large: preset(2, "大型", 180, 240, 70, 360),
  huge: preset(4, "巨型", 90, 150, 60, 180),
  colossal: preset(7, "超巨型", 60, 120, 50, 180),
}
/** What one preset comes to, in the numbers a person compares (the form shows them beside its name: a name alone tells no one how fast it turns). */
export const steadyPresetWords = (id: keyof typeof STEADY_PRESETS) => {
  const p = STEADY_PRESETS[id]
  return `${p.label}（碰撞箱 ${p.height} 格起）：平时身体每秒最多转 ${p.body_turn}°，头每秒 ${p.head.turn}°、左右各偏 ${p.head.yaw}°，蓄力时身体每秒 ${p.ability_turn}°`
}
/** Which preset `auto` takes at this hitbox height, or null below the lowest (where `auto` changes nothing). */
export const steadyAutoPreset = (height: number): keyof typeof STEADY_PRESETS | null =>
  height >= STEADY_PRESETS.colossal.height ? "colossal" : height >= STEADY_PRESETS.huge.height ? "huge" : height >= STEADY_PRESETS.large.height ? "large" : null
export function resolveSteady(value: Steady | null | undefined, height: number) {
  if (!value || (value.preset === "auto" && height < STEADY_PRESETS.large.height)) return null
  const base = value.preset && value.preset !== "auto" ? STEADY_PRESETS[value.preset] :
    height >= STEADY_PRESETS.colossal.height ? STEADY_PRESETS.colossal : height >= STEADY_PRESETS.huge.height ? STEADY_PRESETS.huge : STEADY_PRESETS.large
  const head = { ...base.head, ...value.head }
  return { ...base, ...value, head, turn_after: value.turn_after ?? head.yaw / 2 }
}
export type SteadyPlan = NonNullable<ReturnType<typeof resolveSteady>>

export function steadyDocumentIssues(creature: { behavior: string; engagement?: string | null; steady?: Steady | null }) {
  const s = creature.steady
  const issues: { path: string[]; message: string }[] = []
  if (s?.focus && s.focus.leave === undefined && s.focus.hurt === undefined)
    issues.push({ path: ["steady", "focus"], message: "盯人至少写换人的距离（leave）或五秒内受到的伤害比例（hurt）。" })
  if (s?.focus && !["any_player", "provoked"].includes(creature.engagement ?? ""))
    issues.push({ path: ["steady", "focus"], message: "盯人要先写怎么开打（engagement），选 any_player 或 provoked。" })
  if (creature.behavior !== "hostile" && (s?.focus || s?.ability_turn !== undefined))
    issues.push({ path: ["steady", s.focus ? "focus" : "ability_turn"], message: "只有敌对生物才有战斗目标，请去掉盯人或招式转速。" })
  return issues
}
export const STEADY_INSTRUCTIONS =
  '大个子和 Boss 建议写 steady:{"preset":"auto"}。写 steady:null 就关掉稳重。按碰撞箱高度取档，低于 2 格时 auto 沿用原来的动作；也可点名 ' +
  Object.entries(STEADY_PRESETS).map(([id, p]) => `${id}（${p.height} 格起，身体每秒 ${p.body_turn}°，头每秒 ${p.head.turn}°、左右各 ${p.head.yaw}°，蓄力每秒 ${p.ability_turn}°）`).join("、") +
  "。每项都可单独改。body_turn 写 0 表示身体只在出招时转，此时头照常在 head.yaw 范围内看目标，turn_after 无法启动身体跟转。其余写 1–1200，表示平时在地面每秒转多少度。head.turn 是头的转速，ability_turn 是出招时身体默认转速（每秒 20–1200°），招式自己的 turn_speed 优先。蓄力瞄准、跳扑起跳和预判冲刺起步共用同一刻的转角额度。飞行生物出招时，空中转向也用同一刻的额度。跳扑和冲刺沿转完的朝向出发（写了 keep_heading 的招身体可能还没对准，跳扑会落在目标旁边），跳扑落地那一击的自身预警在起跳定点后画到落点。head.yaw 是左右偏角（0–180°），也是挨打反击默认能顾到的正面范围，攻击者绕到范围外时不会启动反击。head.pitch 是俯仰（0–90°）。turn_after（0–180°）是站定时身体开始跟转的角度，默认取左右偏角的一半。写正数时，站稳后身体跟到偏差只剩启动角度的一半就停下，头继续跟着目标；寻路之间的短暂停步会继续对准。写 0 时可连续跟转。不走路的大体型生物可以先沿用原档的身体转速。目标在 6 格外疾跑，每秒绕过约 53°。idle_look 可选 players（只看人）、none（不张望）、around（也四下张望）。focus.hold 至少盯几秒（0–60）；leave 是换向更近玩家的距离（2–64 格），hurt 是五秒内另一人打掉的血量比例（0.02–1），两项至少写一项，收招后才换。温顺的大象可用 auto，山门守卫可选 huge，石像首领可选 colossal 并写 focus。头单独转动的画面还需要模型支持看向。"
