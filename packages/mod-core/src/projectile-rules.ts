import type { Ability, ProjectileHit } from "./entity-runtime"
import { groundImpactIssues } from "./ground-fx"

/**
 * Boss 能力 2: what a thrown thing of its own (`type: "projectile"`) may be written with, said in the words the maker reads, as `AbilitySchema` refuses it.
 * Everything here is read off the document alone; what needs the model (the part is there) is `boneIssues`, what needs the flight (it reaches, it comes back) `projectileIssues`.
 */

/** How many it throws at once: the fan from a part, or every place it falls on from the sky (a scatter's count, a pattern's points; the one place of "self" and "target"). */
export function projectileCount(hit: Pick<ProjectileHit, "from" | "count">) {
  if ("bone" in hit.from) return hit.count ?? 1
  const over = hit.from.sky.over
  return typeof over === "string" || "fixture" in over ? 1 : over.type === "around_target" ? over.count : over.points.length
}

/** Whether a thrown thing comes back to its thrower: a boomerang and a return always do, a straight or a lobbed one when it says `comes_back`. */
export const projectileReturns = (hit: Pick<ProjectileHit, "path" | "comes_back">) => hit.path === "boomerang" || hit.path === "return" || hit.comes_back !== undefined

export function projectileRules(ability: Ability, add: (path: (string | number)[], message: string) => void) {
  ability.hits.forEach((hit, index) => {
    if (hit.type !== "projectile") return
    const at = (...rest: (string | number)[]) => ["hits", index, ...rest]
    const sky = "sky" in hit.from
    if ((hit.pierce || hit.bounces) && (hit.path === "boomerang" || hit.path === "return"))
      add(at("path"), "穿透或碰墙弹射请选直飞 straight 或抛射 arc，回旋和折返有自己的飞行路线。")
    if (hit.homing && (sky || hit.path !== "straight")) add(at("homing"), "追踪弹请从模型部件发射，并把 path 写 straight，才能朝锁定目标转弯。")
    if (sky && hit.path !== "straight") add(at("path"), `从天上落下来的东西只能写 path:"straight"（直直落下，gravity 让它越落越快），${hit.path} 是从它手里扔出去的飞法`)
    if (sky && (hit.count !== undefined || hit.spread !== undefined)) add(at("count"), '从天上落的东西有几件由 over 定（around_target 的 count，pattern 的 points），不写 count 和 spread；count、spread 只用在 from:{"bone"} 的扇形')
    if (!sky && hit.warn) add(at("warn"), "只有从天上落下来的东西能写预警（warn）：从部件扔出去的朝目标飞，出手前不知道会落在哪里")
    if (hit.spread !== undefined && (hit.count ?? 1) < 2) add(at("spread"), "spread 是几件东西摊开的扇形有多宽（度），只有 count 大于 1 时才写")
    if ("bone" in hit.look && projectileCount(hit) > 1) add(at("look"), `扔的是它自己的部件「${hit.look.bone}」，它身上只有一个：一次只能扔 1 件。要扔一排或者下一场兵器雨，look 用一个效果资产（{"effect":"…"}）`)
    if (hit.path === "arc" && hit.gravity <= 0) add(at("gravity"), "arc 是抛出去划一道弧落在目标脚下，要有重力：gravity 写大于 0 的数（0.03 到 0.08 比较像扔出去的东西）")
    if ((hit.path === "boomerang" || hit.path === "return") && hit.gravity > 0) add(at("gravity"), `${hit.path === "boomerang" ? "回旋镖" : "飞去飞回的"}东西不受重力，gravity 写 0`)
    if ((hit.path === "boomerang" || hit.path === "return") && hit.comes_back) add(at("comes_back"), `path 是 ${hit.path} 的东西自己就会飞回来，不写 comes_back`)
    if ((hit.path === "boomerang" || hit.path === "return") && (hit.pin_seconds ?? 0) > 0) add(at("pin_seconds"), `path 是 ${hit.path} 的东西不落地，不会插在地上，不写 pin_seconds`)
    if (hit.comes_back && hit.comes_back.at < hit.at - 1e-9) add(at("comes_back", "at"), `飞回来的时刻（comes_back.at）从招式开始算，不能比扔出去（at，第 ${hit.at} 秒）还早`)
    if (hit.warn && hit.at - hit.warn.seconds < -1e-9) add(at("warn", "seconds"), `预警最早在招式开始的那一刻出现：这一下在第 ${hit.at} 秒，预警（warn.seconds）最多提前 ${hit.at} 秒`)
    // 落地炸开: only what comes down has a place it comes down at; something has to be written in it; count and spread are the particles'.
    const impact = hit.impact
    if (!impact) return
    if (hit.path === "boomerang" || hit.path === "return") add(at("impact"), `path 是 ${hit.path} 的东西一路碰到谁打谁、再飞回来，不落地，没有炸开的地方：不写 impact。要落地炸开，用 straight、arc 或者从天上落`)
    if (impact.effect === undefined && impact.particle === undefined && impact.shake === undefined && impact.ground === undefined && impact.camera === undefined && impact.sky_tint === undefined) add(at("impact"), "impact 是落地（打中人或者撞到方块）那一刻在那里炸开的样子：effect（效果资产）、particle（粒子）、shake（晃屏）、camera（镜头）、sky_tint（染天）、ground（地面危险区、地裂、冲击波环）至少写一样；什么都不要就不写 impact")
    // 第 4 步: what it leaves on the ground there (`groundImpactIssues`).
    groundImpactIssues(impact.ground ?? []).forEach((issue) => add(at("impact", ...issue.path), issue.message))
    if (impact.particle === undefined && (impact.count !== undefined || impact.spread !== undefined)) add(at("impact", "count"), "impact 的 count 和 spread 是粒子有几个、散开多大，只有写了 particle 时才写")
  })
  // What is laid on where a hit lands, or along its aim, needs that place before it is thrown: a thrown thing's is known only when it strikes.
  ability.events.forEach((event, index) => {
    if ((event.type !== "effect" && event.type !== "debris") || event.hit === null || ability.hits[event.hit]?.type !== "projectile") return
    add(["events", index, "hit"], `第 ${event.hit} 次出手是扔出去的东西，打在哪里要等它飞到才知道：效果和碎块不能用 where:"hit" 或 along:"aim" 指向它。要标出它的落点，从天上落的写预警（warn），扔出去的用 look 看画出的路线`)
  })
}
