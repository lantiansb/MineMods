import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { AbilitySchema, HitboxSchema, type Ability } from "../src/entity-runtime"
import { golemAbilities } from "../script/data-gameplay-sample"

/**
 * A giant that walks, for the tests of big bodies (任务二 第 1 项): 9 blocks tall, 6 wide from hand to hand, six arms of three bones each, two legs, and 150 cubes and more.
 * It is made of arithmetic only (no subject is known to the code under test); every number is a pixel of the document (16 to the block). Its front is -Z, its own left +X.
 */
const flat = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })
const cube = (name: string, origin: [number, number, number], size: [number, number, number], color = "#8A5A3C") => ({ name, origin, size, faces: flat(color) })
const bone = (name: string, parent: string | null, pivot: [number, number, number], cubes: ReturnType<typeof cube>[]) => ({ name, parent, pivot, rotation: [0, 0, 0] as [number, number, number], cubes })

// The torso, 48 wide and 32 deep from 72 to 120 high, laid as plates (three across, six up, front and back): 36 cubes.
const plates = Array.from({ length: 36 }, (_, index) => {
  const [column, row, back] = [index % 3, Math.floor(index / 3) % 6, index >= 18]
  return cube(`plate_${index}`, [-24 + column * 16, 72 + row * 8, back ? 0 : -16], [16, 8, 16])
})
// The head, 24 on a side on top of the torso, of nine cubes.
const head = Array.from({ length: 9 }, (_, index) => cube(`head_${index}`, [-12 + (index % 3) * 8, 120 + Math.floor(index / 3) * 8, -12], [8, 8, 24], "#C9A27A"))
/** One of six arms: shoulder at height `y`, on its own left (`side` 1) or right (-1); upper arm, forearm and hand, each of six cubes, reaching out and down to 42 from the middle. */
const arm = (pair: number, side: 1 | -1) => {
  const name = `${side === 1 ? "left" : "right"}_${pair}`
  const y = 116 - pair * 16
  const x = side * 24
  const along = (from: number, length: number, base: number, tall: number) => Array.from({ length: 6 }, (_, at) => [side === 1 ? x + from + (at * length) / 6 : x - from - ((at + 1) * length) / 6, base, tall] as const)
  return [
    bone(`upper_${name}`, "torso", [x, y, -8], along(0, 6, y - 6, 6).map(([at, base], index) => cube(`upper_${name}_${index}`, [at, base, -12], [1, 8, 8]))),
    bone(`fore_${name}`, `upper_${name}`, [x + side * 6, y, -8], along(6, 6, y - 22, 6).map(([at, base], index) => cube(`fore_${name}_${index}`, [at, base, -11], [1, 20, 6]))),
    bone(`hand_${name}`, `fore_${name}`, [x + side * 12, y - 22, -8], along(12, 6, y - 30, 6).map(([at, base], index) => cube(`hand_${name}_${index}`, [at, base, -12], [1, 8, 8], "#C9A27A"))),
  ]
}
const leg = (side: 1 | -1) => {
  const name = side === 1 ? "left" : "right"
  return [
    bone(`thigh_${name}`, "torso", [side * 12, 72, -8], Array.from({ length: 5 }, (_, at) => cube(`thigh_${name}_${at}`, [side * 12 - 10, 72 - (at + 1) * 8, -18], [20, 8, 20]))),
    bone(`shin_${name}`, `thigh_${name}`, [side * 12, 32, -8], Array.from({ length: 4 }, (_, at) => cube(`shin_${name}_${at}`, [side * 12 - 9, 32 - (at + 1) * 8, -17], [18, 8, 18]))),
  ]
}

const bones = [bone("torso", null, [0, 72, -8], plates), bone("head", "torso", [0, 120, -8], head), ...[0, 1, 2].flatMap((pair) => [...arm(pair, 1), ...arm(pair, -1)]), ...leg(1), ...leg(-1)]

type Spin = { bone: string; axis: 0 | 1 | 2; swing: number }
/** A clip in which each named bone turns about one axis by `swing` degrees and back, in `halves` half-turns, smoothly. */
const clip = (name: string, length: number, loop: boolean, spins: Spin[], halves = 2) => ({
  name,
  length,
  loop,
  channels: spins.map((spin) => ({
    bone: spin.bone,
    keyframes: Array.from({ length: halves + 1 }, (_, at) => ({ time: (length * at) / halves, rotation: [0, 1, 2].map((axis) => (axis === spin.axis && at % 2 === 1 ? spin.swing : 0)) as [number, number, number], interpolation: "smooth" as const })),
  })),
})
const arms = (swing: number, axis: 0 | 2 = 0) => [0, 1, 2].flatMap((pair) => [{ bone: `upper_left_${pair}`, axis, swing: axis === 2 ? -swing : swing }, { bone: `upper_right_${pair}`, axis, swing }])

export const giantDesign = ModelDesignSchema.parse({
  name: "六臂巨人",
  texture_size: 512,
  budget: "epic",
  bones,
  animations: [
    clip("idle", 3, true, [...arms(8, 2), { bone: "head", axis: 1, swing: 10 }]),
    clip("walk", 1.6, true, [{ bone: "thigh_left", axis: 0, swing: 25 }, { bone: "thigh_right", axis: 0, swing: -25 }, ...arms(15)]),
    clip("hurt", 0.5, false, [{ bone: "head", axis: 0, swing: -20 }]),
    clip("slam", 1.2, false, [...arms(-70), { bone: "torso", axis: 0, swing: 10 }]),
    clip("roar", 2, false, [{ bone: "head", axis: 0, swing: -30 }, ...arms(40, 2)]),
  ],
})

/** One ability: all six arms up and down on its target. */
export const giantAbilities: Ability[] = [AbilitySchema.parse({ ...golemAbilities[0], start: { ...golemAbilities[0]!.start, max_distance: 6 }, hits: [{ ...golemAbilities[0]!.hits[0], shape: { type: "arc", reach: 6, angle: 140, low: -0.5, high: 6 } }] })]

/** Its collision boxes: a core of 4 by 7.5 (up to its shoulders) that walks up a block and a half, a box for each hand (following the hand) and one for the head; it goes round when stuck, and may push on. */
export const giantHitbox = HitboxSchema.parse({
  core: { width: 4, height: 7.5, step: 1.5 },
  parts: [
    ...[0, 1, 2].flatMap((pair) => [1, -1].map((side) => ({ name: `${side === 1 ? "左" : "右"}手${pair + 1}`, forward: 0.5, up: (116 - pair * 16 - 30) / 16, left: (side * (24 + 15)) / 16, width: 0.9, height: 0.9, bone: `hand_${side === 1 ? "left" : "right"}_${pair}` }))),
    { name: "头", forward: 0, up: 7.5, left: 0, width: 1.6, height: 1.2, bone: "head" },
  ],
  stuck: { seconds: 3, squeeze: true },
})
