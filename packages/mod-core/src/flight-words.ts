/**
 * The fixed vocabulary and every limit of flight and habits (epic tier and flight, 10-12): how a creature flies, when it is in the
 * air, and the way it lives (when it rests, where its home is, what it hunts). The schema, the generated Java, the checks and the
 * words on the cards all read from here.
 * The ranges of the data come from docs/specs/2026-10-12-epic-tier-flight.md (the blocks under 二 and 三); the rest are
 * the numbers the generated Java holds itself to, each with where it comes from. Nothing here knows a subject. No imports, so the
 * app's window can read it.
 */

/** How a creature stays up (spec: 二, `style`). */
export const FLIGHT_STYLES = { soar: "滑翔型（要有速度才能留在空中）", hover: "悬停型（能停在空中）" } as const
export const FLIGHT_STYLE_IDS = Object.keys(FLIGHT_STYLES) as [keyof typeof FLIGHT_STYLES, ...(keyof typeof FLIGHT_STYLES)[]]

/** The four states a flier is in, as the synced byte says them (spec: 二, 生成: GROUND、TAKEOFF、AIR、LANDING). */
export const FLIGHT_STATES = { ground: 0, takeoff: 1, air: 2, landing: 3 } as const

/**
 * The motions a flier really plays: a soaring one glides and never hovers, a hovering one hovers and never glides, so the other is not played even when
 * the document names it. One place, read by the generated Java, the checks against the model and the list of what starts which motion.
 */
export const flightMotions = (flight: { style: string; takeoff: { clip: string | null }; land: { clip: string | null }; clips: { fly: string; glide: string | null; hover: string | null } }) => ({
  takeoff: flight.takeoff.clip,
  land: flight.land.clip,
  fly: flight.clips.fly,
  glide: flight.style === "soar" ? flight.clips.glide : null,
  hover: flight.style === "hover" ? flight.clips.hover : null,
})

/**
 * The radius, in blocks, of the tightest circle a flier can fly: the distance it covers in the time it takes to turn one radian (speed in blocks a second,
 * turn in degrees a second, the ranges of the data). One place, read by the circle it keeps over the one it fights and by the area the test scene gives it.
 */
export const turnRadius = (flight: { speed: number; turn: number }) => flight.speed / ((flight.turn * Math.PI) / 180)

/** Where an ability may start (spec: 二, 招式的俯冲: `where`). */
export const ABILITY_WHERE = { ground: "只在地上", air: "只在天上", any: "地上天上都行" } as const
export const ABILITY_WHERE_IDS = Object.keys(ABILITY_WHERE) as [keyof typeof ABILITY_WHERE, ...(keyof typeof ABILITY_WHERE)[]]

/**
 * What a flight may be told, and what the generated flier holds itself to.
 * - `speed`, `altitude`, `turn`, `climb`, `bank`, `seconds`: the ranges of the data in the spec's `flight` block. `altitude.min` and `.max` are
 *   ranges of their own because the larger must exceed the smaller (checked on the document).
 * - `accel`, `brake`: seconds from rest to cruise, and from cruise to rest. A change faster than half a second reads as a jump; slower than three
 *   would not stop for a block seen at the farthest look-ahead (`probe`, 1.5 s). 1.5 and 0.75 seconds: the farthest look-ahead and half of it.
 * - `stall`: the share of cruise a soaring creature never goes under in the air (it needs speed to stay up, spec: soar). Half.
 * - `probe`: how far ahead it looks for a block, in seconds of its present speed, three looks (spec: 前方 3 个距离做射线检查); `probeLeast`
 *   is the least each look reaches beyond the creature's own half width, in blocks, so a slow one still sees what it is about to touch.
 * - `arrive`: a point counts as reached within this many seconds of flying at cruise, and never within less than `arriveLeast` blocks. Half a second.
 * - `wander`: how far away a wandering point is chosen, blocks: from a stone's throw to two chunks (32), the most that is surely loaded round it.
 * - `mood`: how long it stays in the air or on the ground when nothing asks it to move, seconds: a person who watches for the minute of a first
 *   look sees about one change. `groundLeast` and `airLeast`: the shortest time it stays down after landing and up after taking off (ground: 2 s, to
 *   not take off the moment it lands; air: 5 s, the longest takeoff the spec allows) unless something asks for it.
 * - `landHeight`: it lands once its feet are within this many blocks of the ground (spec: 落地前先降到离地 1 格以内).
 * - `dive`: the least speed of the charge as a multiple of cruise (spec: 2 倍巡航速度). `diveAccel`: seconds from rest to cruise while it stoops, a third of
 *   the usual 1.5 (the 0.75 s brake is the shortest the eye still reads as a change of speed); it is the pace of the wind-up and of the pull-up after the last hit.
 * - `diveMost`: the most the charge goes in one tick, blocks: 3.9, the game's own bound on a velocity it sends to players (`ClientboundSetEntityMotionPacket`
 *   clamps every component to ±3.9, read with javap), so a charge is still seen as a movement and not as a jump; a step that long is swept against the
 *   blocks by `Entity.move`, not jumped over. The charge goes at the speed that gets it to the locked point on the tick of the first hit, between
 *   `dive` times cruise (the fastest cruise, 1.5 a tick, gives 3: under this bound for every creature) and this.
 * - `roam`: the radius of the area a flier keeps to round where it first stood when its document gives it no home and a command (the test scene) asks for one,
 *   blocks: at least 4, the first radius that holds a point beyond the 3 blocks within which a place counts as reached (`arriveLeast`); at most 64, the largest
 *   home radius the data allows (`HABIT_LIMITS.radius`).
 * - `turnRoom`: how much wider than its tightest turning circle a flier keeps to when it circles (1.2: it needs a little more than the least to hold the circle
 *   against its own speed changes, `flightCircle`). `homeShare`: the share of a home or a roam within which the generated flier picks the points it wanders to
 *   (0.8; the literal in `entity-flight.ts`'s `flightWanderPoint`), so a circle it flies must fit in that share of it to be flown.
 * - `fall`: blocks it may fall before it opens its wings (the game's own limit for a fall that hurts, `fallDistance > 3`).
 * - `stuckSeconds`, `giveUpSeconds`: it is stuck when it moves a quarter of what it means to for two seconds (and turns away); after ten it goes down
 *   and stays down for a mood (a cave it cannot get through, spec: 没有三维寻路).
 * - `pitchEase`, `rollEase`: the share of the gap closed each tick when the model leans (a fifth: 90% in half a second).
 * - `returnSeconds`: a flier going home gives up flying after this long and is set down at home (a boss that must be back).
 * - `requestHold`, `requestGiveUp`: seconds a flier asked by gameplay code to fly to a place keeps to it once there (hovering or circling about it;
 *   three seconds is long enough to be seen to stay, short enough that its own wandering soon goes on, as the stay of a mood is counted in tens), and how
 *   long it tries to get there before the request is dropped (thirty: three times `giveUpSeconds`, the time it tries before it comes down stuck).
 * - `deadFall`: ticks a dead flier is kept in the world past the moment it would otherwise go, while it has not yet come down (its death motion is meant
 *   to be seen on the ground, not in the sky). The longest a fall can last: the overworld is 384 blocks high (-64 to 320), and a body in free fall gains 0.08 blocks
 *   a tick of speed and loses 2% of it (`LivingEntity.travel`), which settles at 0.08 × 0.98 / 0.02 = 3.92 blocks a tick: 384 / 3.92 = 97.96, so 98.
 * - `harryGap`: blocks between its box and its target's when a flier with no ability of its own closes in on them to swing: half of the reach of a swing (0.83 blocks to each side of
 *   its box, `Mob.DEFAULT_ATTACK_REACH` = sqrt(2.04) - 0.6, read with javap), so a swing finds them with room to spare, and not zero, so it does not sit inside their box.
 * - `footprint`, `footColumn`, `footSlope`: blocks. The place a flier sets down at is judged by the one block column it lies in (the ground there, and that it is not water) until its
 *   box is wider than `footprint`: 1.95, the width of the widest creature of the game that walks the ground (the ravager; read from `EntityType` with javap), which the game itself
 *   puts down by the ground under one spot, so up to it that one check has always been what a creature of that size is given. A box wider than that stands over several columns,
 *   so every column under it must be ground no more than `footSlope` higher or lower than the place (a block: the step between two neighbouring columns of a stair, the world
 *   being built in blocks), and its whole box must be free there. The columns are looked at `footColumn` apart (a block, the corners among them) because nothing narrower than a
 *   block can differ between two points of the world's grid.
 * - `track`: ticks between two updates of the position it sends to players: one, so a creature that flies 1.5 blocks a tick (the 30 blocks a second
 *   the spec allows) is not seen to jump in the game's usual three-tick steps.
 */
export const FLIGHT_LIMITS = {
  speed: { min: 2, max: 30 },
  altitude: { min: { min: 2, max: 48 }, max: { min: 4, max: 96 } },
  turn: { min: 20, max: 360 },
  climb: { min: 10, max: 60 },
  bank: { min: 0, max: 60 },
  seconds: { min: 0.2, max: 5 },
  accel: 1.5,
  brake: 0.75,
  stall: 0.5,
  probe: [0.5, 1, 1.5],
  probeLeast: [2, 4, 6],
  arrive: 0.5,
  arriveLeast: 3,
  wander: { min: 16, max: 32 },
  mood: { min: 20, max: 60 },
  groundLeast: 2,
  airLeast: 5,
  landHeight: 1,
  dive: 2,
  diveAccel: 0.5,
  diveMost: 3.9,
  roam: { min: 4, max: 64 },
  turnRoom: 1.2,
  homeShare: 0.8,
  fall: 3,
  stuckSeconds: 2,
  giveUpSeconds: 10,
  pitchEase: 0.2,
  rollEase: 0.2,
  returnSeconds: 60,
  requestHold: 3,
  requestGiveUp: 30,
  deadFall: 98,
  harryGap: 0.4,
  footprint: 1.95,
  footColumn: 1,
  footSlope: 1,
  track: 1,
} as const

/** Which part of the day a creature is up, in the game's ticks of day time (24000 a day; the sun sets at 12000). */
export const HABIT_ACTIVE = { day: "白天", night: "夜里", always: "一直" } as const
export const HABIT_ACTIVE_IDS = Object.keys(HABIT_ACTIVE) as [keyof typeof HABIT_ACTIVE, ...(keyof typeof HABIT_ACTIVE)[]]

/**
 * Vanilla creatures a creature may hunt: animals and fish that cannot hurt it back much, each by its game id with the name a player knows it by.
 * Every id is an `EntityType` constant of 1.21.1 in upper case (a test compiles them). No player, no villager, no monster: what a creature
 * lives on is what a pack of them would not empty out of a world.
 */
export const VANILLA_PREY: Readonly<Record<string, string>> = {
  cow: "牛",
  pig: "猪",
  sheep: "羊",
  chicken: "鸡",
  rabbit: "兔子",
  goat: "山羊",
  horse: "马",
  donkey: "驴",
  llama: "羊驼",
  mooshroom: "哞菇",
  fox: "狐狸",
  parrot: "鹦鹉",
  bat: "蝙蝠",
  frog: "青蛙",
  turtle: "海龟",
  salmon: "鲑鱼",
  cod: "鳕鱼",
  tropical_fish: "热带鱼",
  squid: "鱿鱼",
  glow_squid: "发光鱿鱼",
}
export const VANILLA_PREY_IDS = Object.keys(VANILLA_PREY) as [string, ...string[]]

/**
 * What habits may be told, and what the generated creature holds itself to.
 * - `radius`, `prey`, `hunger`, `distance`: the ranges of the data in the spec's `habits` block; `cooldown` is the spec's 30 seconds.
 * - `attack`: the range of `alert.attack_distance`, blocks (it must also be under the alert's own `distance`). At least 2: about the reach of a creature of a
 *   player's size in melee, so a player inside it is already next to the creature and there is no warning to give; the smallest `distance` is 4, so a gap of
 *   2 blocks to be warned in is always possible. At most 24: the least distance beyond which a fighting creature lets go of its target (`ENGAGEMENT_LIMITS.distance`; a creature
 *   with longer abilities keeps its target further, never nearer), so a player picked from farther could be dropped on the same tick.
 * - `dayEnd`, `dayLength`: ticks of the game's day; the sun sets at 12000 of 24000, the game's own halves of a day (spec: 作息按世界时间，不看天气).
 * - `watch`: ticks between two looks for a player or for prey; a look scans the world's entities, so it is not made every tick. As the boss runtime's.
 * - `near`: blocks within which a creature counts as at a place, at least; a large creature needs its own width and a half (checked in Java).
 * - `fly`: blocks from a place beyond which a flier goes there by flying; nearer it walks. A path search reaches the follow range (24, or the farthest of its abilities when that is more) and no further, so 24 stays inside it.
 * - `hunt`: blocks within which it looks for prey, the least follow range of any generated creature (24; one whose abilities reach further has more, which only widens what it is allowed to pick); `giveUp`: seconds after which it gives up a hunt that has not ended (30).
 * - `eat`: ticks it stands to eat when its clip's length is not known or is short or long: between half a second and ten seconds.
 * - `pause`: ticks it stands to be alert when it has no clip: one second.
 */
export const HABIT_LIMITS = {
  radius: { min: 8, max: 64 },
  prey: 6,
  hunger: { min: 30, max: 1200 },
  distance: { min: 4, max: 32 },
  attack: { min: 2, max: 24 },
  cooldown: 30,
  dayEnd: 12000,
  dayLength: 24000,
  watch: 10,
  near: 3,
  fly: 24,
  hunt: 24,
  giveUp: 30,
  eat: { min: 10, max: 200 },
  pause: 20,
} as const
