/**
 * The fixed vocabularies of a creature's abilities (招式): what may be heard, seen and thrown at a moment
 * of one, each with the plain name a player knows it by. The schema, the generated Java and the words on
 * the card all read from here. Everything named is vanilla Minecraft 1.21.1; a test compiles every entry
 * against the game (`SoundEvents`, `ParticleTypes` and the projectile classes). No imports beyond the
 * word lists, so the app's window can read it.
 */
import { CREATURE_SOUNDS } from "./data-words"

/** How many of each an ability, or a creature, may carry, and the widest numbers that still mean something in the game. */
export const ABILITY_LIMITS = { abilities: 16, hits: 6, moves: 4, events: 24, effects: 4, seconds: 10, cooldown: 120, reach: 16, distance: 32, damage: 1024, knockback: 5, weight: 100 } as const

/**
 * A combo (连招): abilities a creature already has, played one after another without going back to standing between them.
 * - `combos`: how many one creature may have; with `ABILITY_LIMITS.abilities` they stay well inside the 32 bits a boss's phase mask has (an epic creature's more: `EPIC_LIMITS`).
 * - `steps`: how many abilities one combo plays, each once.
 * - `gap`: ticks it holds still between two steps (a second at most: longer is no longer one combo).
 * - `damage`: what every hit of its steps does is multiplied by this (the hits' own numbers are the steps' own).
 * - `seconds`: the longest a whole combo may run, its steps and gaps together.
 */
export const COMBO_LIMITS = { combos: 4, steps: { min: 2, max: 6 }, gap: 20, damage: { min: 0.5, max: 1.5 }, seconds: 30 } as const

/**
 * 第 3 步: what an epic creature (the 史诗 tier of its blueprint entry) may carry beyond `ABILITY_LIMITS` and `COMBO_LIMITS`, the limits of every other tier.
 * A fight with around twenty attack states and several chains needs more room than an ordinary boss.
 * The schema takes up to these; a creature whose tier is not epic is held to the ordinary numbers when its project is checked against its blueprint (`tierLimitIssues`).
 * 24 abilities and 8 combos are 32 choices: exactly the 32 bits of a boss phase's mask (the last one is the sign bit, which Java's `&` reads like any other).
 */
export const EPIC_LIMITS = { abilities: 24, hits: 10, combos: 8 } as const

/**
 * When each step of a combo starts, in ticks from the combo's own tick 0, from the steps' lengths in seconds and the ticks between two of them.
 * A step runs its ticks 0 to its length (each at least one tick, as `abilityPlan` counts it); the next one's tick 0 comes `gap` whole ticks after
 * that last tick. `end` is the combo's last tick, from which its wait (`start.cooldown`) counts. The one rule the schema's bound, the generated Java,
 * the words and the preview all read.
 */
export function comboTimeline(lengths: readonly number[], gap: number) {
  const ticks = lengths.map((seconds) => Math.max(1, Math.round(seconds * TICKS)))
  const starts = ticks.reduce<number[]>((found, _, index) => [...found, index === 0 ? 0 : found[index - 1]! + ticks[index - 1]! + 1 + gap], [])
  return { starts, ticks, end: ticks.length ? starts.at(-1)! + ticks.at(-1)! : 0 }
}

/**
 * How much an effect may be, each number chosen for what it costs a player's game.
 * - `cubes`, `bones`: every effect on screen is an animated model the game walks bone by bone each frame, and
 *   `alive` of them may show at once round one creature: 24 × 32 cubes is three creatures of the ordinary
 *   geometry tier (256 cubes each), which is what one fight is allowed to add.
 * - `clips`: only one motion ever plays in the game, so a document has no use for many.
 * - `seconds`: an effect lives no longer than the longest ability (10 s), so none is left over by mistake.
 * - `count`: how many one moment of an ability may show (a circle of twelve is one every 30 degrees).
 * - `alive`: how many may exist round one creature at once; past it nothing more is shown until some are gone.
 * - `spread`, `fall`: blocks; how wide a layout may be (an ability reaches 16 at most) and how far below where
 *   it was put an effect looks for ground to lie on.
 */
export const EFFECT_LIMITS = { cubes: 32, bones: 16, clips: 4, seconds: 10, count: 12, alive: 24, spread: 16, fall: 8 } as const
/** r29c: how many times as large as its model is built an effect event may draw each one (`size`; 1 left out). */
export const EFFECT_SIZE = { min: 0.1, max: 8 } as const

/**
 * How far the middle of an effect that is put on a hit may lie outside where that hit lands before the two
 * are said to disagree: half a block. A player is 0.6 blocks wide, so a mark that is off by more than half a
 * block shows a place to stand that is not the place the hit decides by.
 */
export const EFFECT_ZONE_TOLERANCE = 0.5

/** Server ticks in a second: every time of an ability is rounded to one of these. */
export const TICKS = 20

// Sounds of striking, shooting and getting ready, beside the creature voices. Every one is a plain `SoundEvent` constant (some vanilla sounds are registry entries instead and would not compile where these are played).
const ACTION_SOUNDS = {
  "entity.player.attack.sweep": "横扫声",
  "entity.player.attack.strong": "重击声",
  "entity.player.attack.knockback": "击退声",
  "entity.player.attack.crit": "暴击声",
  "entity.iron_golem.attack": "铁傀儡挥臂",
  "entity.ravager.roar": "劫掠兽咆哮",
  "entity.ravager.attack": "劫掠兽撞击",
  "entity.warden.sonic_charge": "监守者蓄力",
  "entity.warden.sonic_boom": "监守者音爆",
  "entity.warden.attack_impact": "监守者重击",
  "entity.ender_dragon.growl": "末影龙低吼",
  "entity.ender_dragon.shoot": "末影龙吐息",
  "entity.blaze.shoot": "烈焰人发射",
  "entity.ghast.shoot": "恶魂发射",
  "entity.wither.shoot": "凋灵发射",
  "entity.breeze.shoot": "旋风人发射",
  "entity.arrow.shoot": "射箭声",
  "entity.snowball.throw": "投掷声",
  "entity.evoker.prepare_attack": "唤魔者蓄力",
  "entity.zombie.attack_iron_door": "砸铁门声",
  "entity.phantom.bite": "幻翼撕咬",
  "entity.lightning_bolt.thunder": "雷声",
  "item.firecharge.use": "火焰弹声",
} as const

/** Vanilla sounds an ability may play at a moment, by their game id, with a plain name. */
export const ABILITY_SOUNDS: Readonly<Record<string, string>> = { ...CREATURE_SOUNDS, ...ACTION_SOUNDS }
export const ABILITY_SOUND_IDS = Object.keys(ABILITY_SOUNDS) as [string, ...string[]]

/** Vanilla particles an ability may show at a moment: the key in upper case is the `ParticleTypes` constant, and every one needs no data of its own. */
export const ABILITY_PARTICLES = {
  crit: "暴击星",
  enchanted_hit: "魔法暴击星",
  sweep_attack: "横扫弧光",
  explosion: "爆炸",
  poof: "白色烟团",
  cloud: "云雾",
  smoke: "烟",
  large_smoke: "浓烟",
  campfire_cosy_smoke: "营火的烟",
  dust_plume: "尘土",
  flame: "火苗",
  soul_fire_flame: "灵魂火",
  lava: "岩浆火花",
  snowflake: "雪花",
  splash: "水花",
  dragon_breath: "龙息",
  sonic_boom: "音爆",
  gust: "阵风",
  electric_spark: "电火花",
  end_rod: "白色光点",
  flash: "闪光",
  witch: "紫色魔法",
  soul: "灵魂",
  angry_villager: "怒气",
  damage_indicator: "受伤的心形",
} as const
export type AbilityParticle = keyof typeof ABILITY_PARTICLES
export const ABILITY_PARTICLE_IDS = Object.keys(ABILITY_PARTICLES) as [AbilityParticle, ...AbilityParticle[]]

/**
 * Vanilla projectiles an ability may throw. `damage`: the ability's own number is what a hit takes (an
 * arrow); the others do what they always do in the game, said in `does`. `gravity`: the blocks a tick per tick it
 * falls by (read with javap from the 1.21.1 jar: `AbstractArrow.getDefaultGravity` 0.05, `ThrowableProjectile.getDefaultGravity` 0.03; the
 * fireballs fly straight), which the generated aim makes up for (`PROJECTILE_DRAG` is what each tick keeps of its speed in the air).
 */
export const ABILITY_PROJECTILES = {
  arrow: { name: "箭", damage: true, gravity: 0.05, does: "命中按写的伤害算" },
  snowball: { name: "雪球", damage: false, gravity: 0.03, does: "不掉血，只把人打退一下" },
  small_fireball: { name: "小火球", damage: false, gravity: 0, does: "原版的伤害（5 点）并且点着目标；会点燃方块（受 mobGriefing 规则管）" },
  fireball: { name: "大火球", damage: false, gravity: 0, does: "原版的爆炸（恶魂那种，威力 1）；会炸坏方块（受 mobGriefing 规则管），能被玩家打回来" },
} as const
export const PROJECTILE_DRAG = 0.99
export type AbilityProjectile = keyof typeof ABILITY_PROJECTILES
export const ABILITY_PROJECTILE_IDS = Object.keys(ABILITY_PROJECTILES) as [AbilityProjectile, ...AbilityProjectile[]]

/** Status effects a hit may leave, by the name a player knows: the list a creature's explosion already uses. */
export const ABILITY_EFFECTS = { slowness: "变慢", blindness: "看不清", poison: "中毒", weakness: "变虚弱" } as const
export type AbilityEffect = keyof typeof ABILITY_EFFECTS
export const ABILITY_EFFECT_IDS = Object.keys(ABILITY_EFFECTS) as [AbilityEffect, ...AbilityEffect[]]

/** Motions the generated creature already plays by itself for something else; an ability brings a motion of its own. */
export const RESERVED_CLIPS = ["idle", "walk", "hurt", "death"] as const

/**
 * Where an area hit lands when it is not counted from the creature itself (`place`), and the warning drawn before it lands (`warn`).
 * - `count`, `points`: how many places one hit may land on at once: every place is one more outline a player's game draws for the whole warning.
 * - `spread`: blocks round the one it fights within which `around_target` scatters its places: from a step aside to most of what an ability reaches.
 */
export const HIT_PLACE_LIMITS = { count: 16, points: 16, spread: { min: 1, max: 12 } } as const

/**
 * The warning before a hit (`warn`), each number chosen for the player who has to step out of it.
 * - `seconds`: how long before the hit the warning shows: 0.2 s (four ticks) is the least a game shows at all, 3 s the most before it is a decoration and not a warning.
 * - `readable`: under this many seconds a player sees the warning but cannot act on it (seeing it and starting to move takes about this long); the reviewer is told so.
 * - `walk`: blocks a second a player walks (vanilla 4.317): a warning centred on the one it fights has to last long enough to walk out of it.
 * - `range`: blocks from any of its places within which a player's game is told to draw the warning.
 * - `seed`: the cast the pictures draw `around_target` for (the game picks a new one every cast): the same places the server would pick for it.
 */
export const WARN_LIMITS = { seconds: { min: 0.2, max: 3 }, readable: 0.4, walk: 4.3, range: 64, seed: 20261114 } as const

/** How a warning looks: a flat outline on the ground of where the hit lands, or that outline with a beam of light rising from its middle as high as the hit reaches. */
export const WARN_LOOKS = { ring: "地上画出范围的一圈", pillar: "地上一圈加中间一道光柱" } as const
export type WarnLook = keyof typeof WARN_LOOKS
export const WARN_LOOK_IDS = Object.keys(WARN_LOOKS) as [WarnLook, ...WarnLook[]]

/** The colours a warning may have: the name a player knows it by, and the red, green and blue (0 to 1) of the dust it is drawn with. */
export const WARN_COLORS = {
  red: { name: "红色", rgb: [1, 0.15, 0.1] },
  orange: { name: "橙色", rgb: [1, 0.55, 0.1] },
  yellow: { name: "黄色", rgb: [1, 0.9, 0.2] },
  purple: { name: "紫色", rgb: [0.7, 0.25, 1] },
  blue: { name: "蓝色", rgb: [0.25, 0.6, 1] },
  white: { name: "白色", rgb: [1, 1, 1] },
} as const
export type WarnColor = keyof typeof WARN_COLORS
export const WARN_COLOR_IDS = Object.keys(WARN_COLORS) as [WarnColor, ...WarnColor[]]

/**
 * A weapon trail (Boss 能力 11): a coloured ribbon a player's game draws behind the far end of one part of the model while an ability runs.
 * - width 0.05–2 blocks: from a thin streak to a blade's sweep twice a sword's length.
 * - fade 1–40 ticks: how long a stretch of it stays after the tip has passed (each stretch fades out over that time); two seconds is long past a swing.
 * - points 64: the most tip positions a game keeps for one trail; at sixty frames a second and a short fade that is a second of it.
 * - shortest 2 ticks: a trail drawn for less than two ticks is a speck, not a sweep (said, never refused).
 * - still 0.25 blocks: a tip that travels less than this while the trail is drawn leaves nothing that reads as a trail (said, never refused).
 */
export const TRAIL_LIMITS = { width: { min: 0.05, max: 2 }, fade: { min: 1, max: 40 }, points: 64, shortest: 2, still: 0.25 } as const
