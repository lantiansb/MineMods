import { expect, test } from "bun:test"
import { compileModel, fitModelAtlas } from "../src/model"

/** epic r4: a giant at two model pixels to a texel is written for GeckoLib with each face's own uv size, so the game stretches a texel over 2×2 model pixels. */

const flat = { north: "#6688aa", east: "#557799", south: "#6688aa", west: "#557799", up: "#88aacc", down: "#446688" }
const clip = (name: string, loop: boolean) => ({ name, length: 1, loop, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [5, 0, 0] }] }] })
const giant = (texel?: 2) => ({
  name: "巨型",
  texture_size: 512,
  budget: "epic",
  ...(texel ? { texel_size: texel } : {}),
  bones: [{ name: "body", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [0, 1, 2, 3].map((index) => ({ name: `slab_${index}`, origin: [-100, index * 50, -100], size: [200, 40, 200], faces: flat, surface_details: [] })) }],
  animations: [clip("idle", true), clip("walk", true), clip("hurt", false)],
})

test("a giant at two model pixels to a texel compiles with each face's uv size in texels on a 512 sheet; at one it takes the epic tier's 1024 (第 1 步)", () => {
  // 第 1 步: the epic tier has 1024, so the giant keeps one texel to a model pixel there.
  expect(fitModelAtlas(giant(), "giant").geometry["minecraft:geometry"][0]!.description.texture_width).toBe(1024)
  expect(() => fitModelAtlas({ ...giant(), budget: "finest" }, "giant")).toThrow("texel_size: 2 或 4")
  const compiled = compileModel(giant(2), "giant")
  const geometry = compiled.geometry["minecraft:geometry"][0]!
  expect(geometry.description.texture_width).toBe(512)
  const slab = geometry.bones[0]!.cubes[0]!
  expect(slab.size).toEqual([200, 40, 200])
  expect(slab.uv.up.uv_size).toEqual([100, 100])
  expect(slab.uv.north.uv_size).toEqual([100, 20])
})
