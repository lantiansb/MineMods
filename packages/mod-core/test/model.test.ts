import { describe, expect, test } from "bun:test"
import { inflateSync } from "node:zlib"
import { compileModel, fitModelAtlas } from "../src/model"
import { compileSavedModel } from "../src/editable-model"
import { designToBlockbench } from "../src/blockbench"
import { ANIMATION_LIMITS, BAKED_LIMITS, bakedCounts } from "@minemods/studio-ai/animation"
import type { ModelDesign } from "@minemods/studio-ai/contracts"

const design: ModelDesign = {
  name: "Test creature",
  texture_size: 64,
  bones: [
    {
      name: "body",
      parent: null,
      pivot: [0, 8, 0],
      rotation: [0, 0, 0],
      cubes: [
        {
          name: "body",
          origin: [-2, 4, -2],
          size: [4, 4, 4],
          faces: {
            north: "#ff0000",
            east: "#00ff00",
            south: "#0000ff",
            west: "#ffff00",
            up: "#ffffff",
          down: "#000000",
          },
          surface_details: [],
        },
      ],
    },
  ],
  animations: ["idle", "walk", "hurt"].map((name) => ({
    name,
    length: 1,
    loop: name !== "hurt",
    channels: [
      {
        bone: "body",
        keyframes: [
          { time: 0, rotation: [0, 0, 0] },
          { time: 1, rotation: [0, 15, 0] },
        ],
      },
    ],
  })),
}

describe("model asset compilation", () => {
  test("fits AI atlas upward while preserving design details and actual UV size", () => {
    const model = structuredClone(design)
    model.bones[0]!.cubes = Array.from({ length: 24 }, (_, index) => ({
      ...structuredClone(design.bones[0]!.cubes[0]!),
      name: `cube_${index}`,
      origin: [index * 8, 4, -2] as [number, number, number],
      surface_details: [{ face: "north" as const, x: 1, y: 1, width: 2, height: 1, color: "#123456" }],
    }))
    expect(() => compileModel(model, "creature")).toThrow("纹理空间不足")
    const fitted = fitModelAtlas(model, "creature")
    expect(fitted.design.texture_size).toBe(128)
    expect(fitted.geometry["minecraft:geometry"][0]!.description.texture_width).toBe(128)
    expect(fitted.geometry["minecraft:geometry"][0]!.bones[0]!.cubes[0]!.uv.north.uv_size).toEqual([4, 4])
    expect(fitted.design.bones[0]!.cubes[0]!.surface_details).toEqual(model.bones[0]!.cubes[0]!.surface_details)
  })

  test("keeps explicit compile behavior and rejects designs that overflow 256", () => {
    const model = structuredClone(design)
    model.bones[0]!.cubes = Array.from({ length: 64 }, (_, index) => ({
      ...structuredClone(design.bones[0]!.cubes[0]!),
      name: `cube_${index}`,
      size: [16, 16, 16] as [number, number, number],
    }))
    expect(() => compileModel(model, "creature")).toThrow("纹理空间不足")
    expect(() => fitModelAtlas(model, "creature")).toThrow("纹理空间不足")
  })

  test("exports actual six-face colors in a decodable PNG and geometry with matching UV rectangles", () => {
    const result = compileModel(design, "creature")
    const png = Buffer.from(result.png)
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
    expect(png.readUInt32BE(16)).toBe(64)
    expect(png.readUInt32BE(20)).toBe(64)
    const chunks: Buffer[] = []
    for (let cursor = 8; cursor < png.length; ) {
      const length = png.readUInt32BE(cursor)
      if (png.toString("ascii", cursor + 4, cursor + 8) === "IDAT")
        chunks.push(png.subarray(cursor + 8, cursor + 8 + length))
      cursor += length + 12
    }
    const pixels = inflateSync(Buffer.concat(chunks))
    const cube = result.geometry["minecraft:geometry"][0].bones[0].cubes[0]
    Object.entries(design.bones[0].cubes[0].faces).forEach(([face, color]) => {
      const rect = cube.uv[face as keyof typeof cube.uv]
      const offset = rect.uv[1] * (64 * 4 + 1) + 1 + rect.uv[0] * 4
      expect(pixels.subarray(offset, offset + 3).toString("hex")).toBe(color.slice(1))
      expect(pixels[offset + 3]).toBe(255)
    })
  })

  test("exports animation names and exact keyframe data used by the preview", () => {
    const result = compileModel(design, "creature")
    expect(result.animation.animations["animation.creature.walk"].bones.body.rotation["1.0"]).toEqual([0, 15, 0])
    expect(result.animation.animations["animation.creature.hurt"].loop).toBe(false)
  })

  test("draws surface details into the corresponding face UV pixels", () => {
    const model = structuredClone(design)
    model.bones[0].cubes[0].surface_details = [{ face: "north", x: 1, y: 2, width: 2, height: 1, color: "#123456" }]
    const result = compileModel(model, "creature")
    const png = Buffer.from(result.png)
    const chunks: Buffer[] = []
    for (let cursor = 8; cursor < png.length; ) {
      const length = png.readUInt32BE(cursor)
      if (png.toString("ascii", cursor + 4, cursor + 8) === "IDAT") chunks.push(png.subarray(cursor + 8, cursor + 8 + length))
      cursor += length + 12
    }
    const pixels = inflateSync(Buffer.concat(chunks))
    const rect = result.geometry["minecraft:geometry"][0].bones[0].cubes[0].uv.north
    const offset = (rect.uv[1]! + 2) * (64 * 4 + 1) + 1 + (rect.uv[0]! + 1) * 4
    expect(pixels.subarray(offset, offset + 4).toString("hex")).toBe("123456ff")
  })

  test("serialized fractional keyframes retain chronological order for the GeckoLib parser", () => {
    const model = structuredClone(design)
    model.animations[1].channels[0].keyframes.splice(1, 0, { time: 0.5, rotation: [10, 0, 0] })
    const exported = JSON.parse(JSON.stringify(compileModel(model, "creature").animation))
    expect(Object.keys(exported.animations["animation.creature.walk"].bones.body.rotation).map(Number)).toEqual([
      0, 0.5, 1,
    ])
  })

  test("large and rotated geometry determines visibility and collision bounds", () => {
    const model = structuredClone(design)
    model.texture_size = 256
    model.bones[0].pivot = [0, 0, 0]
    model.bones[0].cubes[0].origin = [-1, 0, -1]
    model.bones[0].cubes[0].size = [2, 200, 2]
    const tall = compileModel(model, "creature")
    expect(tall.bounds.height).toBe(12.5)
    expect(tall.geometry["minecraft:geometry"][0].description.visible_bounds_height).toBeGreaterThanOrEqual(12.5)
    model.bones[0].rotation = [90, 0, 0]
    const rotated = compileModel(model, "creature")
    expect(rotated.bounds.width).toBeCloseTo(25)
    expect(rotated.bounds.max[1]).toBeCloseTo(1)
  })

  test("rejects invalid identifiers and overflowing textures without returning partial assets", () => {
    expect(() => compileModel(design, "../escape")).toThrow()
    expect(() =>
      compileModel(
        { ...design, bones: [{ ...design.bones[0], cubes: [{ ...design.bones[0].cubes[0], size: [64, 64, 64] }] }] },
        "creature",
      ),
    ).toThrow()
  })
})

test("a model without materials or features compiles byte for byte as it did before the painter existed", async () => {
  // The real AI-made model kept as a look-gate specimen: 32 flat cubes, one surface detail each.
  const specimen = await Bun.file(new URL("../../studio-ai/test/fixtures/look/bad/lanjing-guard.json", import.meta.url)).json()
  const sha = (value: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(value).digest("hex")
  const compiled = compileModel(specimen.model, "x")

  // Hashes taken from compileModel at efb85a7, before paint and features were added.
  expect(sha(compiled.png)).toBe("9ed6015333696153596bb8dc652e5efb15812863852984b9f2fe34db4d7fb4e4")
  expect(sha(JSON.stringify(compiled.geometry))).toBe("1a870d102fd689af246e80b1b9e46531efc4aca3d67620f2138c0e7d24e0da75")
  // A detail that touches the island edge must not leak into the ring around it.
  const edged = structuredClone(specimen.model)
  edged.bones[1].cubes[0].surface_details.push({ face: "up", x: 0, y: 0, width: 10, height: 2, color: "#FF0000" })
  expect(sha(compileModel(edged, "x").png)).toBe("31866c47eb095ac8e9b275a09e00f920ffd19620ed7536d9ff5699e247bca473")
})

test("a model painted by material compiles to a texture of several tones with the same UV layout", async () => {
  const specimen = await Bun.file(new URL("../../studio-ai/test/fixtures/look/good/crystal-guardian.json", import.meta.url)).json()
  const flat = structuredClone(specimen.model)
  flat.bones.forEach((bone: { paint?: unknown; cubes: { paint?: unknown; features?: unknown }[] }) => {
    delete bone.paint
    bone.cubes.forEach((cube) => {
      delete cube.paint
      delete cube.features
    })
  })
  const painted = compileModel(specimen.model, "x")

  expect(painted.geometry).toEqual(compileModel(flat, "x").geometry)
  expect(painted.png).not.toEqual(compileModel(flat, "x").png)
  expect(painted.design.bones.find((bone) => bone.name === "body")?.paint).toEqual({ material: "stone", base: "#3E6285", secondary: "#4C5F6E" })
})

// ---- round 10: the save compiles what was looked at ----

test("six smooth keys that export as more than sixty are saved as they were looked at; the written keys stay the document's", () => {
  const smooth = (x: number, time: number) => ({ time, rotation: [x, 0, 0] as [number, number, number], interpolation: "smooth" as const })
  const swung: ModelDesign = { ...design, animations: [...design.animations, { name: "slam", length: 1.8, loop: false, channels: [{ bone: "body", keyframes: [smooth(0, 0), smooth(-120, 0.45), smooth(-130, 0.65), smooth(-46, 0.8), smooth(0, 0.9), smooth(0, 1.8)] }] }] }
  const exported = (compiled: ReturnType<typeof compileModel>) => Object.keys(compiled.animation.animations["animation.creature.slam"]!.bones.body!.rotation!)
  // The document's own compile: more keys than may be written, none refused.
  const direct = compileModel(swung, "creature")
  expect(exported(direct).length).toBeGreaterThan(ANIMATION_LIMITS.keys)
  expect(exported(direct).length).toBe(bakedCounts(swung.animations).longest!.baked)
  // The save's compile, through the editor's file: this is where the version that had been looked at and reviewed was refused
  // (「animations.N.channels.M.keyframes: Too big: expected array to have <=60 items」).
  const saved = compileSavedModel({ design: swung, blockbench: designToBlockbench(swung) }, "creature")
  expect(exported(saved)).toEqual(exported(direct))
  expect(saved.design.animations.at(-1)!.channels[0]!.keyframes).toEqual(swung.animations.at(-1)!.channels[0]!.keyframes)
  // What the cap is justified by: a key of the exported file is a few dozen bytes.
  const bytes = JSON.stringify(saved.animation.animations["animation.creature.slam"]!.bones.body!.rotation).length / exported(saved).length
  expect(bytes).toBeGreaterThan(20)
  expect(bytes).toBeLessThan(45)
  expect(BAKED_LIMITS.track * 45).toBeLessThan(32 * 1024)
  // A track that cannot be exported even at the loosest tolerance is refused by both compiles in the same words a look gives.
  const wild: ModelDesign = { ...design, animations: [...design.animations, { name: "spin", length: 6, loop: false, channels: [{ bone: "body", keyframes: Array.from({ length: 60 }, (_, index) => smooth(index % 2 ? 180 : -180, index / 10)) }] }] }
  const words = bakedCounts(wild.animations).faults.join("")
  expect(words).toContain("动作 spin 里骨骼 body 的转动轨道导出给游戏时太长了")
  expect(() => compileModel(wild, "creature")).toThrow(words)
  expect(() => compileSavedModel({ design: wild, blockbench: designToBlockbench(wild) }, "creature")).toThrow(words)
})
