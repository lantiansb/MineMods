import type { Ability, Boss, Hitbox, Stances } from "./entity-runtime"

/** No defaults are inserted into old documents: only an explicitly configured part opts into the combat runtime. */
export const hasHitboxCombat = (hitbox: Hitbox | null | undefined, abilities?: readonly Pick<Ability, "interrupt" | "openings">[] | null, stances?: Stances) => Boolean(stances?.list.some(row => row.part_scales?.length)) || Boolean(hitbox?.parts?.length && abilities?.some(ability => ability.interrupt?.part || ability.openings?.some(window => window.part))) || (hitbox?.parts ?? []).some((part) => part.damage_scale !== undefined || part.phase_scales !== undefined || part.weakpoint_sound !== undefined || part.contact !== undefined)

/** The same document checks are used by saving, hand-in, acceptance and generation. Phase 0 is the initial phase. */
export function hitboxCombatIssues(creature: { behavior: string; abilities?: readonly Pick<Ability, "id" | "length" | "interrupt">[] | null; shared_abilities?: readonly Pick<Ability, "id" | "interrupt">[] | null; boss?: Pick<Boss, "phases"> | null; hitbox?: Pick<Hitbox, "parts"> | null }) {
  const missing = (["abilities", "shared_abilities"] as const).flatMap(key => (creature[key] ?? []).flatMap((ability, i) => ability.interrupt?.part && !creature.hitbox?.parts?.some(part => part.name === ability.interrupt?.part) ? [{ path: [key, i, "interrupt", "part"], message: `找不到部位「${ability.interrupt.part}」，请填碰撞箱部位的 name。` }] : []))
  return [...missing, ...(creature.hitbox?.parts ?? []).flatMap((part, index) => {
    const found: { path: (string | number)[]; message: string }[] = []
    const issue = (field: (string | number)[], message: string) => found.push({ path: ["hitbox", "parts", index, ...field], message: `碰撞箱部位「${part.name}」：${message}` })
    ;(part.phase_scales ?? []).forEach((entry, at) => {
      if (!creature.boss) issue(["phase_scales", at], "按阶段改倍率（phase_scales）要先写 boss；phase 0 是初始阶段，1 是第一次换阶段以后")
      else if (entry.phase > creature.boss.phases.length) issue(["phase_scales", at, "phase"], `phase 写了 ${entry.phase}，这只 Boss 只有初始阶段和 ${creature.boss.phases.length} 次换阶段`)
    })
    ;(part.contact ?? []).forEach((contact, at) => {
      if (creature.behavior !== "hostile") issue(["contact", at], "接触伤害（contact）只能给敌对生物写")
      const ability = creature.abilities?.find((ability) => ability.id === contact.ability)
      if (!ability) issue(["contact", at, "ability"], `接触伤害指定的招式「${contact.ability}」不存在；ability 要写 abilities 里已有的 id`)
      else if ((contact.from ?? 0) >= (contact.to ?? ability.length) || (contact.to ?? ability.length) > ability.length) issue(["contact", at], `接触伤害的时间窗要满足 0 ≤ from < to ≤ 招式时长 ${ability.length} 秒；不写 from 从 0 开始，不写 to 到招式结束`)
      else if (Math.round((contact.from ?? 0) * 20) >= Math.round((contact.to ?? ability.length) * 20)) issue(["contact", at], "接触伤害的时间窗换成游戏刻以后没有长度；游戏每秒 20 刻，把 from 和 to 至少拉开一刻（0.05 秒）")
    })
    return found
  })]
}

export const HITBOX_COMBAT_INSTRUCTIONS = " 部位还能写 damage_scale（0 到 16，不写是 1）：2 是弱点、0.25 是硬甲，0 完全挡住伤害并冒火星、响金属声；大于 1 打中冒暴击粒子，weakpoint_sound 可选写 entity.player.attack.crit（暴击声）或 block.anvil.land（金属重响），不写就只有粒子。phase_scales: [{phase: 2, damage_scale: 2}] 可以让第三阶段胸口变成弱点：phase 0 是初始阶段，1 是第一次换阶段以后；只覆盖列出的阶段，其他阶段仍用 damage_scale。contact: [{ability: \"sweep\", from: 0.4, to: 0.8, damage: 6, knockback: 0.6}] 让部位在 sweep 这招的 0.4 到 0.8 秒碰到玩家时伤 6 点、把人推开 0.6；ability 写招式 id，from/to 是从招式开始算的秒数（含 from、不含 to），可省略为整段动作。只在招式确实播放时生效，中断或结束就停止，同一招的所有部位合起来对同一玩家只打一次；下一次出招可以再打。兵器箱要写 bone 跟着兵器骨骼动，箱子贴着模型上的刀刃，不能拿一个大空箱代替挥击。"
