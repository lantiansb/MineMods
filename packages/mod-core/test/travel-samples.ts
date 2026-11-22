import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { AbilitySchema, FlightSchema, type Ability, type Flight } from "../src/entity-runtime"
import { StaggerSchema } from "../src/combat"

/**
 * r29c: two small creatures for the pictures of abilities that carry the creature, made of arithmetic only (no subject is known to the code under test; every number is a
 * pixel of the document, 16 to the block): a bird that stoops on what it hunts from the air, and a beast that charges head down, is dazed when it runs into a wall, and has
 * the white puff where its body goes swapped for another particle.
 */
const flat = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })
const cube = (name: string, origin: [number, number, number], size: [number, number, number], color: string) => ({ name, origin, size, faces: flat(color) })
const bone = (name: string, parent: string | null, pivot: [number, number, number], cubes: ReturnType<typeof cube>[]) => ({ name, parent, pivot, rotation: [0, 0, 0] as [number, number, number], cubes })
type Spin = { bone: string; axis: 0 | 1 | 2; swing: number }
/** A clip in which each named bone turns about one axis by `swing` degrees and back (or, `held`, turns and stays there). */
const clip = (name: string, length: number, loop: boolean, spins: Spin[], held = false) => ({
  name,
  length,
  loop,
  channels: spins.map((spin) => ({
    bone: spin.bone,
    keyframes: [0, 1, 2].map((at) => ({ time: (length * at) / 2, rotation: [0, 1, 2].map((axis) => (axis === spin.axis && (at === 1 || (held && at === 2)) ? spin.swing : 0)) as [number, number, number], interpolation: "smooth" as const })),
  })),
})

const wings = (swing: number): Spin[] => [
  { bone: "wing_left", axis: 2, swing: -swing },
  { bone: "wing_right", axis: 2, swing },
]

/** The bird: a body a block long, a head with a beak, two wings 1.5 blocks each, two short legs ending in talons. */
export const birdDesign = ModelDesignSchema.parse({
  name: "小鸟",
  texture_size: 128,
  bones: [
    bone("body", null, [0, 10, 0], [cube("torso", [-3, 6, -8], [6, 6, 16], "#7a5a3a")]),
    bone("head", "body", [0, 12, -8], [cube("skull", [-2, 10, -13], [4, 4, 5], "#8a6a4a"), cube("beak", [-1, 11, -16], [2, 2, 3], "#d8b040")]),
    bone("wing_left", "body", [3, 11, 0], [cube("wing_l", [3, 10, -5], [24, 1, 10], "#6a4a2a")]),
    bone("wing_right", "body", [-3, 11, 0], [cube("wing_r", [-27, 10, -5], [24, 1, 10], "#6a4a2a")]),
    bone("legs", "body", [0, 6, -1], [cube("leg_l", [1, 1, -2], [1, 5, 1], "#c0a040"), cube("leg_r", [-2, 1, -2], [1, 5, 1], "#c0a040")]),
    bone("talons", "legs", [0, 1, -2], [cube("claw", [-2, 0, -4], [4, 1, 3], "#404040")]),
  ],
  animations: [
    clip("idle", 2, true, [{ bone: "head", axis: 0, swing: 8 }]),
    clip("walk", 0.6, true, [{ bone: "legs", axis: 0, swing: 25 }]),
    clip("hurt", 0.4, false, [{ bone: "head", axis: 0, swing: -20 }]),
    clip("death", 1.5, false, [{ bone: "body", axis: 2, swing: 80 }, ...wings(-50)], true),
    clip("takeoff", 1, false, wings(60)),
    clip("fly", 0.8, true, wings(45)),
    clip("hover", 0.6, true, wings(35)),
    clip("land", 1, false, wings(30)),
    clip("swoop", 2, false, [...wings(-40), { bone: "legs", axis: 0, swing: -60 }]),
  ],
})

export const birdFlight: Flight = FlightSchema.parse({ style: "hover", speed: 8, altitude: { min: 6, max: 16 }, turn: 120, climb: 45, bank: 30, air_share: 0.7, takeoff: { clip: "takeoff", seconds: 1 }, land: { clip: "land", seconds: 1 }, clips: { fly: "fly", glide: null, hover: "hover" } })

/** It gets ready for 0.6 seconds, stoops, and strikes with its talons at 1.4 seconds, on prey 6 to 16 blocks off. */
export const birdSwoop: Ability = AbilitySchema.parse({
  id: "swoop",
  name: "俯冲一爪",
  clip: "swoop",
  windup: 0.6,
  length: 2,
  facing: "lock",
  where: "air",
  dive: true,
  hits: [{ type: "area", at: 1.4, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 1.2 }, hits: "everyone", damage: 5, knockback: 0.6, effects: [], bone: "talons" }],
  moves: [],
  start: { min_distance: 6, max_distance: 16, line_of_sight: true, cooldown: 5, weight: 3 },
  stopped_by_hurt: false,
  events: [{ type: "particle", at: 1.4, particle: "cloud", count: 8, forward: 0, up: 0, left: 0, spread: 0.5, bone: "talons" }],
})

/** The beast: a long low body, a lowered head with horns, four legs. */
export const beastDesign = ModelDesignSchema.parse({
  name: "小兽",
  texture_size: 128,
  bones: [
    bone("body", null, [0, 14, 0], [cube("torso", [-6, 10, -10], [12, 10, 20], "#5a4a3a")]),
    bone("head", "body", [0, 16, -10], [cube("skull", [-4, 9, -18], [8, 8, 8], "#6a5a4a"), cube("horn_l", [3, 15, -19], [2, 2, 5], "#e0d8c0"), cube("horn_r", [-5, 15, -19], [2, 2, 5], "#e0d8c0")]),
    ...(
      [
        ["leg_fl", 3, -7],
        ["leg_fr", -6, -7],
        ["leg_bl", 3, 4],
        ["leg_br", -6, 4],
      ] as const
    ).map(([name, x, z]) => bone(name, "body", [x + 1.5, 10, z + 1.5], [cube(`${name}_cube`, [x, 0, z], [3, 10, 3], "#4a3a2a")])),
  ],
  animations: [
    clip("idle", 2, true, [{ bone: "head", axis: 0, swing: 6 }]),
    clip("walk", 0.8, true, [{ bone: "leg_fl", axis: 0, swing: 25 }, { bone: "leg_br", axis: 0, swing: 25 }, { bone: "leg_fr", axis: 0, swing: -25 }, { bone: "leg_bl", axis: 0, swing: -25 }]),
    clip("hurt", 0.4, false, [{ bone: "head", axis: 0, swing: -20 }]),
    clip("death", 1.2, false, [{ bone: "body", axis: 2, swing: 90 }], true),
    clip("charge", 2.4, false, [{ bone: "head", axis: 0, swing: 25 }, { bone: "leg_fl", axis: 0, swing: 35 }, { bone: "leg_fr", axis: 0, swing: -35 }]),
    clip("dizzy", 2, true, [{ bone: "head", axis: 1, swing: 30 }]),
    clip("recover", 0.4, false, [{ bone: "head", axis: 0, swing: -15 }]),
  ],
})

/** Dazed for two seconds when it runs into a wall, with a puff and a ring at the moment it begins. */
export const beastStagger = StaggerSchema.parse({ id: "wall_daze", seconds: 2, damage_scale: 1.5, clip: "dizzy", enter: { sound: "entity.player.attack.crit", particle: "crit", count: 10, spread: 0.3 } })

/**
 * It lowers its head for half a second, then charges 12 blocks in the loop that follows (14 a second), its horns striking whoever it meets on the way; a wall ends the loop with a
 * thud, dust and a shake, and dazes it. Who it rams is struck with a bang where they are hit.
 */
export const beastCharge: Ability = AbilitySchema.parse({
  id: "charge",
  name: "低头冲撞",
  clip: "charge",
  windup: 0.5,
  length: 2.4,
  facing: "track",
  hits: [{ type: "area", at: 0.5, shape: { type: "box", forward: 1, up: 0.8, left: 0, width: 1.4, height: 1.4, depth: 1.2 }, hits: "everyone", damage: 7, knockback: 1.5, effects: [] }],
  moves: [{ type: "dash", from: 0.5, to: 2, speed: 14, distance: 12, aim: "locked_at_windup", stop_at_wall: true, hit: 0, impact: { touch: { sound: "block.amethyst_block.hit", particle: "explosion", count: 1 } } }],
  stages: [
    { kind: "windup", until: 0.5 },
    { kind: "loop", until: 2, end: { collision: [{ when: { if: "collision", with: "world" }, result: { stagger: "wall_daze", impact: { sound: "block.anvil.land", particle: "cloud", count: 16, spread: 0.6, shake: { strength: 1.5, radius: 10, seconds: 0.4 } } } }] } },
    { kind: "recover", until: 2.4, clip: "recover" },
  ],
  start: { min_distance: 4, max_distance: 14, line_of_sight: true, cooldown: 6, weight: 3 },
  stopped_by_hurt: false,
  events: [],
})

/** A leap at whoever is 5 to 10 blocks off: up at 0.4, down at 1.0, 2.5 blocks over the straight line, landing a block short with a stamp round it. */
export const beastPounce: Ability = AbilitySchema.parse({
  id: "pounce",
  name: "扑跳",
  clip: "charge",
  windup: 0.4,
  length: 1.6,
  facing: "track",
  hits: [{ type: "area", at: 1, shape: { type: "arc", reach: 2.5, angle: 360, low: -0.5, high: 2 }, hits: "everyone", damage: 6, knockback: 1, effects: [] }],
  moves: [{ type: "leap", at: 0.4, land: 1, height: 2.5, aim: "target", max_distance: 12, short: 1 }],
  start: { min_distance: 5, max_distance: 10, line_of_sight: true, cooldown: 6, weight: 2 },
  stopped_by_hurt: false,
  events: [],
})
