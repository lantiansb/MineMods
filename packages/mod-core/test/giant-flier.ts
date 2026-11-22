import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { AbilitySchema, BossSchema, FlightSchema, HabitsSchema, HitboxSchema, type Ability, type Boss, type Flight, type Habits } from "../src/entity-runtime"
import { golemAbilities } from "../script/data-gameplay-sample"

/**
 * A giant flying boss for the tests that need one: a body, a neck and tail of three bones each, two wings of two bones with a span of 30 blocks, four legs.
 * It is made of arithmetic only (no subject is known to the code under test); every number is a pixel of the document (16 to the block).
 */
const flat = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })
const cube = (name: string, origin: [number, number, number], size: [number, number, number], color = "#6B4E8A") => ({ name, origin, size, faces: flat(color) })
const bone = (name: string, parent: string | null, pivot: [number, number, number], cubes: ReturnType<typeof cube>[]) => ({ name, parent, pivot, rotation: [0, 0, 0] as [number, number, number], cubes })

const wing = (side: 1 | -1) => {
  // A wing hangs from the shoulder and reaches 15 blocks out in two bones; `origin` is the near corner, so a wing on the document's -X side starts at its far end.
  const reach = (from: number, length: number) => (side === 1 ? from : -from - length)
  const name = side === 1 ? "left" : "right"
  return [
    bone(`wing_${name}`, "body", [side * 16, 76, -8], [cube(`arm_${name}`, [reach(16, 96), 74, -24], [96, 3, 48])]),
    bone(`wing_tip_${name}`, `wing_${name}`, [side * 112, 76, -12], [cube(`membrane_${name}`, [reach(112, 128), 75, -20], [128, 2, 40])]),
  ]
}
const leg = (name: string, x: number, z: number) => bone(name, "body", [x, 44, z], [cube(`${name}_cube`, [x - 6, 0, z - 6], [12, 44, 12])])

const bones = [
  bone("body", null, [0, 60, 0], [cube("torso", [-16, 44, -40], [32, 32, 80])]),
  bone("neck_1", "body", [0, 66, -40], [cube("neck_1_cube", [-8, 58, -72], [16, 16, 32])]),
  bone("neck_2", "neck_1", [0, 66, -72], [cube("neck_2_cube", [-7, 60, -104], [14, 14, 32])]),
  bone("head", "neck_2", [0, 66, -104], [cube("skull", [-10, 58, -136], [20, 18, 32])]),
  bone("tail_1", "body", [0, 60, 40], [cube("tail_1_cube", [-10, 52, 40], [20, 18, 40])]),
  bone("tail_2", "tail_1", [0, 60, 80], [cube("tail_2_cube", [-7, 54, 80], [14, 12, 40])]),
  bone("tail_3", "tail_2", [0, 60, 120], [cube("tail_3_cube", [-4, 56, 120], [8, 8, 40])]),
  ...wing(1),
  ...wing(-1),
  leg("leg_front_left", 14, -24),
  leg("leg_front_right", -14, -24),
  leg("leg_back_left", 14, 24),
  leg("leg_back_right", -14, 24),
]

type Spin = { bone: string; axis: 0 | 1 | 2; swing: number }
/** A clip in which each named bone turns about one axis by `swing` degrees and back, in `halves` half-turns, smoothly. */
const clip = (name: string, length: number, loop: boolean, spins: Spin[], halves = 2) => ({
  name,
  length,
  loop,
  channels: spins.map((spin) => ({
    bone: spin.bone,
    keyframes: Array.from({ length: halves + 1 }, (_, at) => ({
      time: (length * at) / halves,
      rotation: [0, 1, 2].map((axis) => (axis === spin.axis && at % 2 === 1 ? spin.swing : 0)) as [number, number, number],
      interpolation: "smooth" as const,
    })),
  })),
})
// The wings go up on a positive swing: the left wing turns about z against the sign of the document's x, the right one with it.
const flap = (swing: number) => [
  { bone: "wing_left", axis: 2 as const, swing: -swing },
  { bone: "wing_right", axis: 2 as const, swing },
  { bone: "wing_tip_left", axis: 2 as const, swing: -swing / 2 },
  { bone: "wing_tip_right", axis: 2 as const, swing: swing / 2 },
]
const legs = (swing: number) => ["leg_front_left", "leg_front_right", "leg_back_left", "leg_back_right"].map((name, at) => ({ bone: name, axis: 0 as const, swing: at % 2 ? swing : -swing }))

export const dragonDesign = ModelDesignSchema.parse({
  name: "巨龙",
  texture_size: 512,
  budget: "epic",
  bones,
  animations: [
    clip("idle", 4, true, [{ bone: "body", axis: 0, swing: 2 }, { bone: "tail_1", axis: 1, swing: 6 }]),
    clip("walk", 1.5, true, legs(25)),
    clip("hurt", 0.5, false, [{ bone: "head", axis: 0, swing: -25 }]),
    clip("death", 3, false, [{ bone: "body", axis: 2, swing: 80 }, ...flap(-60)], 1),
    clip("attack", 0.8, false, [{ bone: "head", axis: 0, swing: 35 }, { bone: "neck_1", axis: 0, swing: 25 }]),
    clip("takeoff", 2, false, flap(55)),
    clip("fly", 1.6, true, flap(40)),
    clip("glide", 3, true, flap(6)),
    clip("hover", 1.6, true, flap(30)),
    clip("land", 1.8, false, flap(35)),
    clip("sleep", 5, true, [{ bone: "head", axis: 0, swing: 20 }]),
    clip("roar", 2, false, [{ bone: "head", axis: 0, swing: -40 }, ...flap(20)]),
    clip("breath", 2.4, false, [{ bone: "head", axis: 0, swing: 30 }, { bone: "neck_2", axis: 0, swing: 20 }]),
    clip("stoop", 1.4, false, [...flap(15), { bone: "body", axis: 0, swing: 40 }]),
    clip("sweep", 1.6, false, [{ bone: "tail_1", axis: 1, swing: 70 }, { bone: "tail_2", axis: 1, swing: 50 }, { bone: "tail_3", axis: 1, swing: 40 }]),
  ],
})

/** The ability of the golem's sample, re-aimed: its own clip, and the distances at which it starts. */
const ability = (id: string, clipName: string, min: number, max: number, extra: Record<string, unknown> = {}): Ability =>
  AbilitySchema.parse({ ...golemAbilities[0], id, name: id, clip: clipName, windup: 0.5, length: 1.2, start: { min_distance: min, max_distance: max, line_of_sight: true, cooldown: 4, weight: 3 }, hits: [{ ...golemAbilities[0]!.hits[0], at: 0.9 }], ...extra })

/** Three abilities, the farthest 32 blocks (the most `ABILITY_LIMITS.distance` allows) and the others past the 24 a creature follows by default. */
export const dragonAbilities: Ability[] = [ability("breath", "breath", 8, 32), ability("stoop", "stoop", 6, 30, { where: "air", dive: true }), ability("sweep", "sweep", 0, 12)]

/**
 * The same three kinds of ability, counted from the part of the body that does them (`bone`): a bite and a breath from the head, which is 7 blocks ahead of the feet and
 * 2.6 above them and lifts further when the neck swings, a sweep from the tail's tip, and the dive that has no bone. The reach of each is from its part, not from the feet.
 */
export const dragonAnchoredAbilities: Ability[] = [
  ability("bite", "attack", 0, 16, {
    windup: 0.3,
    length: 0.7,
    hits: [{ type: "area", at: 0.5, shape: { type: "sphere", forward: 1, up: -0.5, left: 0, radius: 2.5 }, hits: "everyone", damage: 14, knockback: 1.5, effects: [], bone: "head" }],
  }),
  ability("breath", "breath", 8, 32, {
    windup: 0.8,
    length: 2.4,
    hits: [
      { type: "area", at: 1.2, shape: { type: "cone", up: 0, length: 14, angle: 40 }, hits: "everyone", damage: 5, knockback: 0.2, effects: [{ effect: "slowness", duration_ticks: 40, amplifier: 0 }], bone: "head" },
      { type: "shot", at: 1.6, projectile: "fireball", speed: 1, forward: 1, up: 0, damage: null, bone: "head" },
    ],
    events: [{ type: "particle", at: 1.2, particle: "flame", count: 24, forward: 2, up: 0, left: 0, spread: 1 }],
  }),
  ability("sweep", "sweep", 0, 14, { windup: 0.4, length: 1.5, hits: [{ type: "area", at: 0.9, shape: { type: "arc", reach: 5, angle: 120, low: -4, high: 3 }, hits: "everyone", damage: 9, knockback: 2.5, effects: [], bone: "tail_3" }] }),
  ability("stoop", "stoop", 6, 30, { where: "air", dive: true }),
]

export const dragonFlight: Flight = FlightSchema.parse({ style: "soar", speed: 14, altitude: { min: 12, max: 40 }, turn: 60, climb: 40, bank: 35, air_share: 0.6, takeoff: { clip: "takeoff", seconds: 2 }, land: { clip: "land", seconds: 1.8 }, clips: { fly: "fly", glide: "glide", hover: null } })
export const dragonHabits: Habits = HabitsSchema.parse({ active: "day", rest: { clip: "sleep" }, home: { radius: 48 }, prey: ["cow"], hunger_seconds: 300, eat: { clip: "attack" }, alert: { clip: "roar", distance: 24 } })
export const dragonBoss: Boss = BossSchema.parse({
  bar: { color: "purple", style: "notched_10", darken_sky: true },
  intro: { wake_distance: 32, clip: "roar", seconds: 2, sound: "entity.ender_dragon.growl" },
  phases: [{ below: 0.5, clip: "roar", seconds: 2, bar_color: "red", speed: 1.2, damage: 1.3, abilities: ["breath"] }],
  death: { seconds: 4, xp_bursts: 6, explosion: true },
  leash: { distance: 96, reset_seconds: 30 },
})
/** Its collision boxes: a core within the 16 blocks the game allows a box, and a box for each part that sticks out. */
export const dragonHitbox = HitboxSchema.parse({
  core: { width: 4, height: 5 },
  parts: [
    { name: "头", forward: -7, up: 3.5, left: 0, width: 1.4, height: 1.2, bone: "head" },
    { name: "尾", forward: 6, up: 3.4, left: 0, width: 1.2, height: 0.9, bone: "tail_3" },
    { name: "左翼", forward: 0, up: 4.6, left: 7, width: 3, height: 0.4, bone: "wing_left" },
    { name: "右翼", forward: 0, up: 4.6, left: -7, width: 3, height: 0.4, bone: "wing_right" },
  ],
})

/**
 * The first epic case, as data: a dragon that rests in its nest by day and patrols at night (habits), has a wake-up that is shown in the air (boss intro, a flier), is faster in its second
 * phase (boss phase speed), dives to claw and breathes in the air (`where: air`), and sweeps its tail only on the ground (`where: ground`).
 */
export const epicAbilities: Ability[] = [ability("stoop", "stoop", 6, 30, { where: "air", dive: true }), ability("breath", "breath", 8, 32, { where: "air" }), ability("sweep", "sweep", 0, 12, { where: "ground" })]
export const epicHabits: Habits = HabitsSchema.parse({ active: "night", rest: { clip: "sleep" }, home: { radius: 48 }, prey: [], hunger_seconds: 300, eat: null, alert: null })
export const epicBoss: Boss = BossSchema.parse({
  bar: { color: "blue", style: "notched_10", darken_sky: true },
  intro: { wake_distance: 32, clip: "roar", seconds: 2, sound: "entity.ender_dragon.growl" },
  phases: [{ below: 0.5, clip: "roar", seconds: 2, bar_color: "red", speed: 1.5, damage: 1.3, abilities: [] }],
  death: { seconds: 4, xp_bursts: 6, explosion: true },
  leash: { distance: 96, reset_seconds: 30 },
})
