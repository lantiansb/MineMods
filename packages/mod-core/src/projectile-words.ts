import { ABILITY_EFFECTS, ABILITY_LIMITS, HIT_PLACE_LIMITS, WARN_LIMITS } from "./ability-words"
import { SHAKE_LIMITS } from "./boss-words"

/**
 * Boss 能力 2 (投射物): the numbers a thrown thing of an ability is held to, the words of its paths, and what an AI is told about it. Constants only: the schema
 * (entity-runtime.ts), the flight (projectile-flight.ts, the arithmetic the pictures and the generated Java share), the checks and the words (ability-projectile.ts) all read them.
 * No Node APIs: the app's window reads it too.
 *
 * - `speed`: blocks a tick it flies (0.1 is a lob, 4 a bolt that crosses an arena in half a second), as a vanilla shot's.
 * - `gravity`: blocks a tick it falls by each tick (an arrow 0.05); 0.2 is a stone dropped.
 * - `radius`: blocks round where it strikes that are hit with it (0: only who it touches); 6 is a large blast.
 * - `touch`: blocks round its path within which it touches someone (a thrown spear is not a point).
 * - `pin`: the most seconds it stays stuck where it landed; `away`: how many seconds after the ability's own end it may still be called back (`comes_back.at`).
 * - `height`: blocks above where it falls on that a thing from the sky starts.
 * - `count`, `fan`: the most thrown at once from a part, and the widest fan (degrees) they spread over.
 * - `flight`: the most ticks it flies before it is taken as lost (it drops where it is, or comes back); `back`: the most ticks its way back takes before it is put away.
 * - `volley`: the most that one cast throws before the reviewer is told what that costs (entities in the world, packets): 12 is the 兵器雨 the plan measures.
 * - `width`: how far to the side a boomerang swings out, as a part of how far it flies.
 * - `seed`: the cast the pictures draw a scattered volley for (`WARN_LIMITS.seed`, the same places item 3 draws).
 */
export const PROJECTILE_LIMITS = {
  speed: { min: 0.1, max: 4 },
  gravity: { max: 0.2 },
  radius: { max: 6 },
  touch: 0.3,
  pin: 30,
  away: 30,
  height: { min: 4, max: 32 },
  count: HIT_PLACE_LIMITS.count,
  fan: 90,
  flight: 200,
  back: 200,
  volley: 12,
  width: 0.3,
  seed: WARN_LIMITS.seed,
} as const

/** 落地炸开 (`ProjectileImpactSchema`): how many particles an impact that names one sends, and within how many blocks, when it does not say. */
export const PROJECTILE_IMPACT = { count: 12, spread: 1 } as const

/** How a thrown thing flies, by the name a person knows. */
export const PROJECTILE_PATHS = {
  straight: "直线飞出，受重力时会往下坠",
  arc: "抛出去，划一道弧正好落在目标脚下",
  boomerang: "像回旋镖一样绕出去再绕回来",
  return: "直直飞到目标那里，马上原路飞回来",
} as const
export type ProjectilePath = keyof typeof PROJECTILE_PATHS
export const PROJECTILE_PATH_IDS = Object.keys(PROJECTILE_PATHS) as [ProjectilePath, ...ProjectilePath[]]

/** What an AI is told about a thrown thing of its own (Boss 能力 2). Part of `ABILITY_INSTRUCTIONS`. */
export const PROJECTILE_INSTRUCTIONS =
  ` 自己的投射物：{type:"projectile", at, look, from, speed, gravity, path, damage, knockback, effects, radius, pin_seconds, comes_back, count, spread, warn, impact}——到 at 那一刻扔出去一件东西（矛、戈、飞刀、陨石……），由服务端每一刻算它飞到哪里、碰到谁，玩家的游戏只负责画它。` +
  ` 追踪弹用直飞并加 homing:{strength:0.2,range:24}，追发射时选中的目标。每刻转向力度大于 0、最多 1，追踪距离 1–128 格。` +
  ` pierce 表示打中后还能穿过几个目标（0–16），bounces 是在方块表面反弹几次（0–8）；留空则第一次遇到目标或墙就按原来的方式落下。` +
  ` lifetime_ticks 可填 1–1200 刻，从开始飞行起计，到点消失（插地和返回也计时）。省略时直飞和抛射沿用 200 刻的飞行上限。` +
  ` look 是它长什么样：{"effect":"效果资产的 id"}（用这个工程里做好的一个效果当它的模型，效果自己的动作循环播放；生物任务要依赖它），或者 {"bone":"部件名"}（就扔它自己身上的那个部件，比如 spear：扔出去的时候它身上的这个部件藏起来，飞回来、或者东西消失以后再显示）。` +
  ` from 是从哪里扔：{"bone":"部件名"}（从模型这个部件在出手那一刻的中心扔出去，朝目标飞），或者 {"sky":{"over": 落点, "height": 高度}}（从落点正上方 height 格（${PROJECTILE_LIMITS.height.min} 到 ${PROJECTILE_LIMITS.height.max}）的天上直直落下来；over 的写法和范围出手的 place 完全一样："self"、"target"、{type:"around_target", count, spread}、{type:"pattern", points}，所以「兵器雨」就写 over:{type:"around_target", count:12, spread:6}，落点在出手（有预警就是预警开始）那一刻由服务端定下）。` +
  ` speed 是每刻飞几格（${PROJECTILE_LIMITS.speed.min} 到 ${PROJECTILE_LIMITS.speed.max}），gravity 是每刻往下多掉几格（0 到 ${PROJECTILE_LIMITS.gravity.max}，箭是 0.05）。path：${Object.entries(PROJECTILE_PATHS).map(([id, words]) => `${id}（${words}）`).join("、")}。arc 要 gravity 大于 0（按 speed 水平飞、算好抬多高）；boomerang 和 return 不受重力，gravity 写 0，它们自己会飞回扔它的生物，不能再写 comes_back、pin_seconds；从天上落的只能写 straight。` +
  ` damage、knockback、effects 和范围出手一样，打中除了它自己和同类以外的生物；radius 是打中（碰到人或者落地）的地方周围多少格以内一起挨打（0 到 ${PROJECTILE_LIMITS.radius.max}，0 就是只打碰到的那个）；回旋和飞回的一路上碰到谁打谁，去和回各打一次。knockback 只能是 0 或正数（从打中的地方往外推）。` +
  ` trail 可选。particle 可以是原版名、工程粒子或别名，per_tick 是每刻沿飞行路径均匀铺几颗（1–8，默认 2），spread 是每个方向散开的格数（0–1，默认 0）。飞回时也画，等候和插地时停画。` +
  ` pin_seconds 是落地以后插在地上停几秒（0 到 ${PROJECTILE_LIMITS.pin}，可以不写，不写就是 0：落地就没了）；打中人以后它掉在那人脚下再插进地里。comes_back:{at} 是飞回去：插在地上的东西停够 pin_seconds、并且到了 at 秒（从招式开始算，可以比招式长，最多长 ${PROJECTILE_LIMITS.away} 秒）以后拔出来飞回它手里，碰到人照样打。没写 comes_back 的，停够了就消失；扔的是自己的部件的话，那个部件到时候重新出现在它身上。它死了或者不见了，飞在外面和插在地上的都当场消失。` +
  ` count 和 spread 只用在 from:bone：一次扔出 count 件（1 到 ${PROJECTILE_LIMITS.count}），在朝目标的方向左右均匀摊开成 spread 度（0 到 ${PROJECTILE_LIMITS.fan}）的扇形；look 是自己的部件时只能扔 1 件。warn 只用在从天上落的：写法和范围出手的 warn 一样，提前 seconds 秒在每个落点画出圈（圈的大小是 radius，至少 1 格），到 at 那一刻东西才从天上开始落，落到地上才打。` +
  ` impact（可选，不写或写 null 就是落下来什么都不炸）是它落下来那一刻、就在落点炸开的样子：碰到第一个人或者撞到方块（落地）的那一刻（也就是它打人的那一刻），在那个地方放出来，只给人看和感觉，不改伤害。写法 {effect, particle, count, spread, shake, camera, sky_tint}，effect、particle、shake、camera、sky_tint 至少写一样；camera 和 sky_tint 写法与同名招式事件相同，省去 type 和 at，从落点按 radius 找玩家，落地那一刻开始镜头曲线或染天：effect 是这个工程里一个效果资产的 id（生物任务要依赖它）；particle 和招式粒子事件的 particle 写法一样，原版粒子的名字或者 {"asset":"粒子资产的 UUID"}（生物任务要依赖它），count 是几个（1 到 64，不写是 ${PROJECTILE_IMPACT.count}），spread 是散开几格（0 到 4，不写是 ${PROJECTILE_IMPACT.spread}），只写了 particle 才写 count、spread；shake 是 {strength ${SHAKE_LIMITS.strength.min}–${SHAKE_LIMITS.strength.max}, radius ${SHAKE_LIMITS.radius.min}–${SHAKE_LIMITS.radius.max}, seconds ${SHAKE_LIMITS.seconds.min}–${SHAKE_LIMITS.seconds.max}}，落点 radius 格内的玩家屏幕晃动，离得越远越轻。招式的 events 只能从它自己、目标或者某一次范围出手的中心算位置，扔出去的东西落在哪里要飞到才知道——要在它落下的地方炸开、冒烟、震屏，就写在 impact 里（它离场以后从天上砸下来的彗星也一样）。boomerang 和 return 不落地，不能写 impact；一次扔出或者落下好几件的，每一件落下都各炸一次。` +
  ` 一次扔出去超过 ${PROJECTILE_LIMITS.volley} 件，检查会提醒这一招在场上同时有多少个东西；飞出去够不到目标、回不来、它的冷却比东西在外面的时间还短（部件还没回来就又要扔），检查都会说出来。对生物任务调用 look 会把每一件的路线用虚线画出来，标出落点、插在地上几秒和飞回来的路线。` +
  ` 例（矛贯：扔出自己的矛，插在地上 5 秒再飞回来）：{"type":"projectile","at":0.7,"look":{"bone":"spear"},"from":{"bone":"spear"},"speed":1.4,"gravity":0.03,"path":"arc","damage":10,"knockback":0.6,"effects":[],"radius":1.5,"pin_seconds":5,"comes_back":{"at":0.7}}；例（兵器雨）：{"type":"projectile","at":1.2,"look":{"effect":"<效果资产 id>"},"from":{"sky":{"over":{"type":"around_target","count":12,"spread":6},"height":16}},"speed":0.6,"gravity":0.08,"path":"straight","damage":6,"knockback":0.3,"effects":[],"radius":1.5,"warn":{"seconds":1,"look":"ring","color":"red"}}。`

/** What a hit of this kind leaves, in the words a status effect is said in (for `felt`). */
export const projectileEffectWords = (effects: readonly { effect: keyof typeof ABILITY_EFFECTS }[]) => effects.map((effect) => ABILITY_EFFECTS[effect.effect])

/** The moments a thrown thing may still be called back at, from an ability's start, in seconds. */
export const PROJECTILE_BACK_MAX = ABILITY_LIMITS.seconds + PROJECTILE_LIMITS.away
