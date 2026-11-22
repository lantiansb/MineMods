import type { Builtin } from "./builtin"

export const BUILTIN_LABELS: Record<keyof Builtin,string> = {
  weak_hit:"弱点部位受击", immune_hit:"免伤部位受击", leave:"离场", return:"回场", death_burst:"死亡爆炸", death_poof:"死后消失时那团白烟", fuse:"爆炸引信",
  fixture_lit:"物件亮着时", fixture_ember:"物件处于余烬时",
  terrain_shatter:"升起地形碎裂", arena_light:"点亮场地物件", fog_lift:"同时清掉全场雾", fog_edge:"雾中安全区边缘", summon_success:"召唤成功", summon_blocked:"召唤被挡",
}
export const builtinUses = (builtin?: Builtin) => (Object.keys(builtin ?? {}) as (keyof Builtin)[]).flatMap(key => {
  const value = builtin![key]
  return value ? [{ key, effect:"effect" in value ? value.effect : undefined, particle:"particle" in value ? value.particle : undefined, sound:"sound" in value ? value.sound : undefined }] : []
})
