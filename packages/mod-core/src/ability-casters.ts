import type { AbilityAssetDocument, AssetEvent } from "./ability-asset"

// A missing caster is explained by the feature that needs it. Keep the author's table and the save check together.
const shared = "玩家、方块、生物"
const creature = "生物"
const cast = "玩家、方块"
const events = {
  particle: ["粒子", shared], sound: ["声音", shared], shake: ["震屏", shared], effect: ["特效", shared],
  hazard: ["地面危险区", shared], crack: ["地裂", shared], shockwave: ["冲击波环", shared],
  beam: ["光束", shared], terrain_rise: ["临时地形", shared], block_swap: ["替换地块", shared],
  break: ["打碎方块", shared], debris: ["飞起的碎块", creature], flash: ["闪光", creature],
  camera: ["镜头变化", creature], sky_tint: ["天空变色", creature], lightning: ["落雷", creature],
  drop: ["掉落模型部件", creature], fog: ["场地雾气", creature], fixture: ["场地物件", creature],
  trail: ["武器拖影", creature], hit_fx: ["命中反馈", creature], stance: ["切换姿态", creature],
} as const satisfies Record<AssetEvent["type"], readonly [string, string]>

const features = {
  area: ["范围出手", shared], shot: ["原版投射物", shared], push: ["短促推动", shared],
  projectile: ["自制投射物", creature], gameplay: ["调用玩法", creature],
  bone: ["挂在模型部件上", creature], arena: ["首领场地", creature], force: ["持续推拉", creature],
  inner: ["空心环", shared], warn: ["随形状铺开的预警", creature],
  effectArray: ["多处摆放特效或沿瞄准方向放特效", creature], shakeOptions: ["调整震屏角度、视野或频率", creature],
  dash: ["冲刺（玩家的移动由客户端决定）", creature], leap: ["跳扑（玩家的移动由客户端决定）", creature],
  leave: ["暂时离场", creature], stages: ["分段", creature], combo: ["连招", creature],
  heal: ["治疗", cast], allies: ["只打自己人", cast], buff: ["给自己人加好效果", cast],
  release: ["按住物品后松手释放", "玩家"],
} as const
type Row = readonly [string, string]
type Body = Pick<AbilityAssetDocument, "hits" | "events"> & Partial<Pick<AbilityAssetDocument, "cast" | "moves" | "stages">>

export const casterGuide = () => [...Object.values(features), ...Object.values(events)].map(([what, who]) => what + "：" + who).join("；")

export function casterLimits(body: Body) {
  const uses = new Set<Row>()
  if (body.cast?.release) uses.add(features.release)
  if (body.stages?.length) uses.add(features.stages)
  for (const move of body.moves ?? []) uses.add("type" in move ? features[move.type] : features.push)
  for (const hit of body.hits) {
    uses.add(features[hit.type])
    if ("bone" in hit && hit.bone) uses.add(features.bone)
    if (hit.type !== "area") continue
    if (hit.force) uses.add(features.force)
    if (hit.place === "center" || typeof hit.place === "object" && "fixture" in hit.place || hit.shape.type === "arena") uses.add(features.arena)
    if (hit.shape.type === "arc" && hit.shape.inner) uses.add(features.inner)
    if (hit.warn && (hit.shape.type !== "sphere" || hit.shape.forward !== 0 || hit.shape.left !== 0 || hit.place && hit.place !== "self" && hit.place !== "target")) uses.add(features.warn)
    if (hit.hits === "allies") uses.add(features.allies)
    if (hit.heal !== undefined) uses.add(features.heal)
    if (hit.effects.some(e => ["regeneration", "speed", "strength", "resistance", "absorption"].includes(e.effect))) uses.add(features.buff)
  }
  for (const event of body.events) {
    uses.add(events[event.type])
    if (event.type === "shockwave" && event.warn) uses.add(features.warn)
    if ("bone" in event && event.bone) uses.add(features.bone)
    if (event.type === "effect" && (event.along === "aim" || event.count > 1)) uses.add(features.effectArray)
    if (event.type === "shake" && (event.roll || event.fov || event.falloff === "none" || event.frequency !== undefined && event.frequency !== 1)) uses.add(features.shakeOptions)
  }
  const reasons = (caster: string) => [...uses].filter(([, allowed]) => !allowed.includes(caster)).map(([why]) => why)
  return { generic: reasons("玩家"), block: reasons("方块"), creature: reasons("生物") }
}

export function casterLine(body: Body) {
  const limits = casterLimits(body)
  if (limits.generic.length && limits.creature.length) return `目前没有谁能完整放出这招。玩家和方块用不了${limits.generic.join("、")}，生物用不了${limits.creature.join("、")}。`
  if (limits.generic.length) return "只有生物能放，里面有" + limits.generic.join("、") + "。"
  if (limits.block.length && limits.creature.length) return "只有玩家能放。方块用不了" + limits.block.join("、") + "，生物用不了" + limits.creature.join("、") + "。"
  if (limits.creature.length) return "玩家和方块能放，生物用不了" + limits.creature.join("、") + "。"
  return "玩家、方块和生物都能放。"
}
