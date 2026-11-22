import type { ModelDesign } from "../src/contracts"

type Vec = [number, number, number]
const face = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })
const box = (name: string, origin: Vec, size: Vec, color: string) => ({ name, origin, size, faces: face(color), surface_details: [] })
const bone = (name: string, parent: string | null, pivot: Vec, cubes: ReturnType<typeof box>[]) => ({ name, parent, pivot, rotation: [0, 0, 0] as Vec, cubes })

/** A leg of two bones: the thigh from the body down to the knee, the calf from the knee to the ground. `x` to its own left, `z` towards its back. */
const leg = (name: string, x: number, z: number) => [
  bone(`${name}_thigh`, "body", [x, 10, z], [box("upper", [x - 1, 5, z - 1], [2, 5, 2], "#6b5a45")]),
  bone(`${name}_calf`, `${name}_thigh`, [x, 5, z], [box("lower", [x - 1, 0, z - 1], [2, 5, 2], "#5a4a38")]),
]
const swing = (bone: string, angle: number, length: number) => ({
  bone,
  keyframes: [
    { time: 0, rotation: [angle, 0, 0] as Vec },
    { time: length / 2, rotation: [-angle, 0, 0] as Vec },
    { time: length, rotation: [angle, 0, 0] as Vec },
  ],
})

/**
 * 第 2 步 (挂链和踩地): a plain four-legged animal, built with its tail straight out behind it, its tail three links that hang (`mode: "hang"`)
 * and its four feet placed on the ground (`foot_placement`). Invented for the tests; any creature of the kind would do.
 */
export function quadrupedFixture(): ModelDesign {
  return {
    name: "Quadruped",
    texture_size: 64,
    bones: [
      bone("root", null, [0, 0, 0], []),
      bone("body", "root", [0, 12, 0], [box("trunk", [-4, 9, -8], [8, 6, 16], "#8a7255")]),
      bone("head", "body", [0, 14, -8], [box("skull", [-3, 11, -14], [6, 6, 6], "#7d674c")]),
      ...leg("front_left", 3, -6),
      ...leg("front_right", -3, -6),
      ...leg("hind_left", 3, 6),
      ...leg("hind_right", -3, 6),
      bone("tail", "body", [0, 13, 8], [box("base", [-1, 12, 8], [2, 2, 5], "#8a7255")]),
      bone("tail_mid", "tail", [0, 13, 13], [box("middle", [-1, 12, 13], [2, 2, 5], "#7d674c")]),
      bone("tail_end", "tail_mid", [0, 13, 18], [box("tip", [-1, 12, 18], [2, 2, 4], "#f0e8dc")]),
    ],
    animations: [
      { name: "idle", length: 2, loop: true, channels: [{ bone: "head", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [6, 0, 0] }, { time: 2, rotation: [0, 0, 0] }] }] },
      { name: "walk", length: 1, loop: true, channels: [swing("front_left_thigh", 25, 1), swing("hind_right_thigh", 25, 1), swing("front_right_thigh", -25, 1), swing("hind_left_thigh", -25, 1)] },
      { name: "hurt", length: 0.3, loop: false, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.15, rotation: [-8, 0, 0] }, { time: 0.3, rotation: [0, 0, 0] }] }] },
    ],
    follow: [
      { bone: "tail", mode: "hang", attract: 0.4, falloff: 0.5, damping: 0.3 },
      { bone: "tail_mid", mode: "hang" },
      { bone: "tail_end", mode: "hang" },
    ],
    foot_placement: {
      body: "body",
      feet: [
        { thigh: "front_left_thigh", calf: "front_left_calf", knee: "back" },
        { thigh: "front_right_thigh", calf: "front_right_calf", knee: "back" },
        { thigh: "hind_left_thigh", calf: "hind_left_calf" },
        { thigh: "hind_right_thigh", calf: "hind_right_calf" },
      ],
    },
  }
}
