import { expect, test } from "bun:test"
import { FACE_WORDS, outerFace } from "@minemods/studio-ai/orientation"
import { exportBbmodel } from "../src/bbmodel"
import { compileModel } from "../src/model"
import { decodeRgbaPng } from "../src/png-decode"

const flat = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })
const motion = (name: string) => ({ name, length: 1, loop: name !== "hurt", channels: [{ bone: "side", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [10, 0, 0] }] }] })
// A trunk on the centre line and one block on +X, the thing's own left, whose outer face alone is magenta.
const DESIGN = {
  name: "sides",
  texture_size: 64,
  bones: [
    { name: "base", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ name: "trunk", origin: [-4, 0, -2], size: [8, 14, 4], faces: flat("#808080"), surface_details: [] }] },
    { name: "side", parent: "base", pivot: [4, 10, 0], rotation: [0, 0, 0], cubes: [{ name: "block", origin: [5, 4, -2], size: [4, 8, 4], faces: { ...flat("#00ffff"), [outerFace(7)!]: "#ff00ff" }, surface_details: [] }] },
  ],
  animations: ["idle", "walk", "hurt"].map(motion),
}

test("left stays left in the Blockbench file: a part on +X lands on Blockbench's west side with its outer face still facing out", () => {
  expect([outerFace(7), FACE_WORDS.west, FACE_WORDS.east]).toEqual(["west", "它的左侧", "它的右侧"])
  const compiled = compileModel(DESIGN, "sides")
  const file = exportBbmodel({ name: "sides", geometry: compiled.geometry, animation: compiled.animation, png: compiled.png })
  const block = file.elements.find((element) => element.name === "side_1")!
  // Blockbench keeps a model that faces north with east at +X: the thing's own left is its west, -X there.
  expect([block.from, block.to]).toEqual([[-9, 4, -2], [-5, 12, 2]])
  const png = decodeRgbaPng(compiled.png)
  const colour = (face: string) => ((uv) => [0, 1, 2].map((part) => png.pixels[((uv[1]! + 1) * png.width + uv[0]! + 1) * 4 + part]))(block.faces[face]!.uv)
  // The face on Blockbench's -X side, pointing away from the trunk, is the painted one.
  expect(colour("west")).toEqual([255, 0, 255])
  expect(colour("east")).toEqual([0, 255, 255])
})
