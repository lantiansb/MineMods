export const HEAVY_DAMAGE = 12
export const COUNTER_SECONDS = 1
export const SHORT_VISUAL_SECONDS = 1

export const COMBAT_FEEDBACK_GUIDE =
  ` 表现检查（只给建议）：每次命中把粒子、看得见的形状（效果资产、地面特效等）和声音叠在一起；一次基础伤害达到 ${HEAVY_DAMAGE} 点（${HEAVY_DAMAGE / 2} 颗心）是重招，再加震屏或碎块。范围出手把三层排在同一刻或相邻一刻；扔出的东西用 impact 做落点的粒子、形状和震屏，命中声若需跟着真实落点，用已有的玩法入口实现。第一下出伤以前要有一声提示；技能可以用 sounds.start 做提示，在第 0 刻立即出伤时先留出提示的时间。一击招式的收招至少是起手的一半，光束、持续施法和多段攻击不用照这个比例。`

export const CREATURE_COMBAT_GUIDE =
  COMBAT_FEEDBACK_GUIDE +
  ` 从开始到第一下出手算起手。facing 写 "track" 时，建议把 track_until 写成首次出手时刻的约 80%（例如出手在 0.5 秒，就追到 0.4 秒），让玩家有时间躲。全程定向用 facing: "lock"；turn_speed 只管转得多快，stages 可以把起手、出招和收招分开。重招从最后出伤起至少留 ${COUNTER_SECONDS} 秒反击机会，可放在收招里，或由明确限制下一招的阶段停顿、冷却补足。单招的 start.cooldown 只管这一招。`

export const CAST_COMBAT_GUIDE =
  COMBAT_FEEDBACK_GUIDE +
  ` 单击技能按蓄力和时间线的出伤时刻算起手，按末次出伤到时间线结束算收招。重招至少留 ${COUNTER_SECONDS} 秒才允许同一技能再放；用 cast.cooldown 或排好收尾的事件，允许立即连放的 recasts 不算冷却。生物引用这招时，用引用处的 facing 选择面向目标或锁定朝向。`

export const PARTICLE_DESIGN_GUIDE =
  " 精细档、Boss 档和史诗档每招的主视觉用自己设计的粒子或效果资产，颜色跟着题材走；原版粒子留给点缀。原版火星和烟容易一眼认出，容易盖掉这一招自己的形状和配色；1.20.1 也没有 dust_plume、gust。"

export const APPENDAGE_GUIDE =
  ' 尾巴、披风、胡子和链子通常拆成 2 到 6 节，每节接在上一节下面，用 follow（弹簧跟随或 mode: "hang" 的挂链）让末端有惯性。给同一串写连续的名字，例如 tail_1、tail_2、tail_3。结构数字只是事实，不是通过或不通过的理由。'

export const SHORT_PARTICLE_GUIDE =
  ` 寿命不超过 ${SHORT_VISUAL_SECONDS} 秒的粒子，建议 emissive: true，让它在暗处也看得见；opacity.end 至少比 start 低，建议淡到 0。`

export const SHORT_EFFECT_GUIDE =
  ` 寿命不超过 ${SHORT_VISUAL_SECONDS} 秒的效果，建议 play.bright: true 或 blend: "additive"。play.opacity 是全程固定的；收尾可以在动画中把承载形状的骨骼缩到接近 0，或用逐渐变透明的粒子来做淡出。`
