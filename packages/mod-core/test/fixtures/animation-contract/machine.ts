import { createHash } from "node:crypto"
import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"

/**
 * The fixture of the animation contract: a stand with an arm, a rod and a block on the rod, a wheel, a
 * box that swells and a small light. It is nothing in particular on purpose; it only has what the contract
 * needs exercising: a bone turned as built (the arm) with a moving bone under it, so a position is seen to
 * follow the axes of the bone above; every track; every interpolation; a loop that wraps a curve; a track
 * that starts late; a bone that only moves; uneven key spacing.
 *
 * `work` is the clip the proof pictures show; `work_plain` is the same clip as a version 1 document could
 * write it (rotation keys, straight lines).
 */
export function contractMachine(): ModelDesign {
  const paint = (material: "stone" | "metal" | "wood" | "cloth" | "crystal", base: string) => ({ material, base })
  const faces = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })
  const cube = (name: string, origin: [number, number, number], size: [number, number, number], color: string) => ({ name, origin, size, faces: faces(color), surface_details: [] })
  const swing: [number, [number, number, number]][] = [[0, [0, 0, 0]], [0.6, [0, 0, -14]], [1, [0, 0, 8]], [1.4, [0, 0, 8]], [2, [0, 0, 0]]]
  return ModelDesignSchema.parse({
    name: "contract machine",
    texture_size: 128,
    bones: [
      { name: "base", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], paint: paint("stone", "#7d7f86"), cubes: [cube("plate", [-9, 0, -8], [18, 3, 16], "#7d7f86")] },
      { name: "column", parent: "base", pivot: [-6, 3, 4], rotation: [0, 0, 0], paint: paint("metal", "#5a6b7a"), cubes: [cube("post", [-8, 3, 2], [4, 19, 4], "#5a6b7a")] },
      // Built turned: what hangs from it moves along axes that are not the document's.
      { name: "arm", parent: "column", pivot: [-6, 22, 4], rotation: [0, 0, 10], paint: paint("wood", "#9a6b3c"), cubes: [cube("beam", [-8, 21, 3], [15, 3, 2], "#9a6b3c")] },
      { name: "rod", parent: "arm", pivot: [5, 22, 4], rotation: [0, 0, -10], paint: paint("metal", "#b9c2c9"), cubes: [cube("shaft", [4, 13, 3], [2, 9, 2], "#b9c2c9")] },
      { name: "block", parent: "rod", pivot: [5, 9, 4], rotation: [0, 0, 0], paint: paint("metal", "#c9772e"), cubes: [cube("mass", [2, 9, 1], [6, 4, 6], "#c9772e")] },
      { name: "wheel", parent: "base", pivot: [-7, 8, -4], rotation: [0, 0, 0], paint: paint("wood", "#6e4a2a"), cubes: [cube("disc", [-8, 5, -7], [2, 6, 6], "#6e4a2a")] },
      { name: "box", parent: "base", pivot: [-1, 3, -4], rotation: [0, 15, 0], paint: paint("cloth", "#8b3d4f"), cubes: [cube("bag", [-4, 3, -7], [6, 6, 6], "#8b3d4f")] },
      { name: "light", parent: "base", pivot: [7, 3, -6], rotation: [0, 0, 0], paint: paint("crystal", "#ffd24a"), cubes: [cube("bulb", [6, 3, -7], [2, 3, 2], "#ffd24a")] },
    ],
    animations: [
      {
        name: "idle",
        length: 2,
        loop: true,
        channels: [
          // Version 1 as it always was: rotation keys, straight lines.
          { bone: "wheel", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [180, 0, 0] }, { time: 2, rotation: [360, 0, 0] }] },
          // A loop of three smooth keys: the curve's ends take their neighbours from the other end.
          { bone: "box", keyframes: [], scale: [{ time: 0, scale: [1, 1, 1], interpolation: "smooth" }, { time: 0.8, scale: [1.1, 0.75, 1.1], interpolation: "smooth" }, { time: 2, scale: [1, 1, 1], interpolation: "smooth" }] },
        ],
      },
      {
        name: "walk",
        length: 1,
        loop: true,
        channels: [
          { bone: "base", keyframes: [{ time: 0, rotation: [0, 0, -3], interpolation: "smooth" }, { time: 0.5, rotation: [0, 0, 3], interpolation: "smooth" }, { time: 1, rotation: [0, 0, -3], interpolation: "smooth" }], position: [{ time: 0, position: [0, 0, 0], interpolation: "smooth" }, { time: 0.25, position: [1, 1.5, 0] }, { time: 0.5, position: [0, 0, -1], interpolation: "smooth" }, { time: 0.75, position: [-1, 1.5, 0] }, { time: 1, position: [0, 0, 0], interpolation: "smooth" }] },
          { bone: "arm", keyframes: [{ time: 0.1, rotation: [0, 0, 6] }, { time: 0.6, rotation: [4, -8, -6], interpolation: "smooth" }, { time: 0.9, rotation: [0, 0, 6] }] },
        ],
      },
      {
        name: "hurt",
        length: 0.5,
        loop: false,
        channels: [
          { bone: "base", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.1, rotation: [-8, 0, 4] }, { time: 0.5, rotation: [0, 0, 0] }] },
          // Held, then a jump: twice.
          { bone: "light", keyframes: [], scale: [{ time: 0, scale: [1, 1, 1], interpolation: "step" }, { time: 0.15, scale: [1.5, 1.5, 1.5], interpolation: "step" }, { time: 0.3, scale: [1, 1, 1] }] },
          // A track that starts late and stops early, on a bone that only moves.
          { bone: "block", keyframes: [], position: [{ time: 0.1, position: [0, 0, 0] }, { time: 0.2, position: [2, -1, 3], interpolation: "smooth" }, { time: 0.4, position: [0, 0, 0] }] },
        ],
      },
      {
        name: "work",
        length: 2,
        loop: true,
        channels: [
          { bone: "arm", keyframes: swing.map(([time, rotation]) => ({ time, rotation, interpolation: "smooth" })) },
          // The rod slides along the arm's own up, which is not the document's: the arm is built turned and swings.
          { bone: "rod", keyframes: [{ time: 0, rotation: [0, 0, 0], interpolation: "smooth" }, { time: 0.6, rotation: [0, 0, 14], interpolation: "smooth" }, { time: 1, rotation: [0, 0, -8], interpolation: "smooth" }, { time: 1.4, rotation: [0, 0, -8], interpolation: "smooth" }, { time: 2, rotation: [0, 0, 0], interpolation: "smooth" }], position: [{ time: 0, position: [0, 0, 0], interpolation: "smooth" }, { time: 0.6, position: [0, 3, 0], interpolation: "smooth" }, { time: 1, position: [0, -3, 0] }, { time: 1.4, position: [0, -3, 0], interpolation: "smooth" }, { time: 2, position: [0, 0, 0], interpolation: "smooth" }] },
          { bone: "block", keyframes: [], scale: [{ time: 0, scale: [1, 1, 1] }, { time: 0.9, scale: [0.9, 1.15, 0.9], interpolation: "smooth" }, { time: 1, scale: [1.3, 0.6, 1.3], interpolation: "smooth" }, { time: 1.4, scale: [1, 1, 1] }, { time: 2, scale: [1, 1, 1] }] },
          { bone: "box", keyframes: [], scale: [{ time: 0, scale: [1, 1, 1], interpolation: "smooth" }, { time: 1, scale: [1.15, 0.6, 1.15], interpolation: "smooth" }, { time: 2, scale: [1, 1, 1], interpolation: "smooth" }], position: [{ time: 0, position: [0, 0, 0] }, { time: 1, position: [0, 0, 0], interpolation: "step" }, { time: 1.1, position: [0, 0.5, 0], interpolation: "step" }, { time: 1.2, position: [0, 0, 0] }] },
          { bone: "light", keyframes: [], scale: [{ time: 0, scale: [1, 1, 1], interpolation: "step" }, { time: 1, scale: [1.6, 1.6, 1.6], interpolation: "step" }, { time: 1.4, scale: [1, 1, 1] }] },
          { bone: "wheel", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 2, rotation: [-360, 0, 0] }] },
        ],
      },
      {
        name: "work_plain",
        length: 2,
        loop: true,
        channels: [
          { bone: "arm", keyframes: swing.map(([time, rotation]) => ({ time, rotation })) },
          { bone: "rod", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.6, rotation: [0, 0, 14] }, { time: 1, rotation: [0, 0, -8] }, { time: 1.4, rotation: [0, 0, -8] }, { time: 2, rotation: [0, 0, 0] }] },
          { bone: "wheel", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 2, rotation: [-360, 0, 0] }] },
        ],
      },
    ],
  })
}

/** Moments the conformance test compares at: on keys, between them, either side of a jump (but not inside GeckoLib's 0.001 s of a held value's end), and past the end. */
export const CONTRACT_TIMES = [0, 0.05, 0.1, 0.13, 0.148, 0.15, 0.2, 0.25, 0.31, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.998, 1, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4, 1.5, 1.7, 1.9, 1.99] as const

type Exported = { geometry: { "minecraft:geometry": { bones: { name: string; parent?: string; pivot: number[]; rotation: number[]; cubes: { origin: number[]; size: number[] }[] }[] }[] }; animation: unknown }

/** What `geckolib-4.8.3.json` was played from: the animation file and the shape of the geometry (not its UVs, which the painter owns). */
export function contractHash(compiled: Exported) {
  const shape = compiled.geometry["minecraft:geometry"][0]!.bones.map((bone) => ({ name: bone.name, parent: bone.parent ?? null, pivot: bone.pivot, rotation: bone.rotation, cubes: bone.cubes.map((cube) => ({ origin: cube.origin, size: cube.size })) }))
  return createHash("sha256").update(JSON.stringify(shape)).update(JSON.stringify(compiled.animation)).digest("hex")
}
