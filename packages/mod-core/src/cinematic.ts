import { z } from "zod"
import { ABILITY_LIMITS } from "./ability-words"

// Kept separate from entity-runtime so schemas, descriptions and generators share one vocabulary.
const bounded = (name: string, min: number, max: number) => z.number({ error: `${name}要写数字` }).finite({ error: `${name}要写有限数字` }).min(min, { error: `${name}最小 ${min}` }).max(max, { error: `${name}最大 ${max}` })
const radius = bounded("影响玩家的半径（radius，格）", 4, 64)
export const CinematicTimeSchema = bounded("镜头和染天的时刻（at，从招式开始算的秒数）", 0, ABILITY_LIMITS.seconds)
export const CameraShape = {
  radius,
  fov: bounded("镜头的视野倍率（fov）", 0.25, 2),
  rise: bounded("镜头推到峰值的时间（rise，秒）", 0.05, 5),
  hold: bounded("镜头保持的时间（hold，秒）", 0, 5),
  fade: bounded("镜头回到原位的时间（fade，秒）", 0.05, 5),
  easing: z.enum(["linear", "smooth", "cubic"], { error: "镜头缓动（easing）写 linear（匀速）、smooth（平滑）或 cubic（柔和）" }),
}
export const SkyTintShape = {
  radius,
  color: z.string({ error: "天色（color）写 #rrggbb 的颜色" }).regex(/^#[0-9a-fA-F]{6}$/, "天色（color）写 #rrggbb 的六位十六进制颜色"),
  strength: bounded("天色染色强度（strength）", 0.05, 1),
  hold: bounded("天色保持的时间（hold，秒）", 0, 10),
  fade: bounded("天色淡回的时间（fade，秒）", 0.05, 10),
  edge: z.boolean({ error: "屏幕边缘染色（edge）写 true 或 false" }).optional(),
}
export const CameraSchema = z.strictObject(CameraShape)
export const SkyTintSchema = z.strictObject(SkyTintShape)
export const DebrisThrowSchema = z.strictObject({
  speed: bounded("碎块向上的初速（speed，格/刻）", 0.1, 1.5),
  spread: bounded("碎块水平散开的速度（spread，格/刻）", 0, 0.75),
  gravity: bounded("碎块每刻下落加速（gravity）", 0.02, 0.2),
})
export type CameraCue = z.infer<typeof CameraSchema>
export type SkyTintCue = z.infer<typeof SkyTintSchema>
export const CINEMATIC_INSTRUCTIONS = ` 或者镜头 {type:"camera", at, radius:4–64, fov:0.25–2, rise:0.05–5, hold:0–5, fade:0.05–5, easing:"linear"|"smooth"|"cubic"}：第 at 秒给自己 radius 格内的玩家推镜头，fov 是视野倍率，小于 1 推近、大于 1 拉远；rise 秒推到峰值、hold 秒保持、fade 秒回到原视野，三段时间均为秒。缓动 linear 匀速、smooth 平滑、cubic 柔和。范围内强度相同，可与 shake 叠加，受玩家的屏幕效果强度设置控制，换世界或断线自动清除。或者瞬时染天 {type:"sky_tint", at, radius:4–64, color:"#ff3030", strength:0.05–1, hold:0–10, fade:0.05–10, edge?:true}：第 at 秒范围内玩家的天空、云和雾立即染成该颜色，保持 hold 秒，再用 fade 秒平滑淡回；edge 可选，true 时屏幕边缘也染色。与阶段天色变暗叠加，不改世界天气。碎块 debris 可选 throw:{speed:0.1–1.5, spread:0–0.75, gravity:0.02–0.2}，分别是向上初速（格/刻）、水平散开速度（格/刻）、每刻向下加速；抛起后按重力飞行，撞到地面或墙就消失，最迟 8 秒消失，仍不改方块。未写 throw 时沿用原来的小碎块。`
/** A camera cue in words, without when (an event says its moment before it; a projectile's impact is the moment it comes down). */
export function cameraCueWords(cue: CameraCue) {
  return `镜头${cue.fov < 1 ? "一推" : cue.fov > 1 ? "拉远" : "保持原视野"}（${cue.radius} 格内，视野 ×${cue.fov}，${cue.rise} 秒推到、保持 ${cue.hold} 秒、${cue.fade} 秒回落，${({ linear: "匀速", smooth: "平滑", cubic: "柔和" })[cue.easing]}）`
}
/** A sky tint in words, without when (as `cameraCueWords`). */
export function skyTintCueWords(cue: SkyTintCue) {
  const color = ({ "#ff0000": "红色", "#ff3030": "红色", "#0000ff": "蓝色", "#ffffff": "白色", "#000000": "黑色" } as Record<string, string>)[cue.color.toLowerCase()] ?? cue.color
  return `天染成${color}（${cue.radius} 格内的天空和雾，强度 ${cue.strength}，保持 ${cue.hold} 秒、${cue.fade} 秒淡回${cue.edge ? "，屏幕边缘也染色" : ""}）`
}
export function cameraWords(cue: CameraCue & { at: number }) {
  return `第 ${cue.at} 秒${cameraCueWords(cue)}`
}
export function skyTintWords(cue: SkyTintCue & { at: number }) {
  return `第 ${cue.at} 秒${skyTintCueWords(cue)}`
}
