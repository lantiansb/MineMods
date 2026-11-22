import { describe, expect, test } from "bun:test"
import { blockbenchToDesignResult, designToBlockbench } from "../src/blockbench"
import { compileSavedModel } from "../src/editable-model"
import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import { z } from "zod"
import { deflateSync } from "node:zlib"
import { decodeRgbaPng } from "../src/png-decode"

function filteredPng(pixels: Uint8Array, width: number, height: number) {
  const chunk = (type: string, data: Uint8Array) => {
    const output = Buffer.alloc(data.length + 12)
    output.writeUInt32BE(data.length)
    output.write(type, 4, "ascii")
    output.set(data, 8)
    let crc = 0xffffffff
    output.subarray(4, data.length + 8).forEach((value) => {
      crc ^= value
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    })
    output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8)
    return output
  }
  const stride = width * 4
  const rows = Buffer.alloc(height * (stride + 1))
  for (let row = 0; row < height; row++) {
    rows[row * (stride + 1)] = 1
    for (let index = 0; index < stride; index++) rows[row * (stride + 1) + index + 1] = (pixels[row * stride + index]! - (index >= 4 ? pixels[row * stride + index - 4]! : 0)) & 255
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", new Uint8Array())])
}

const design: ModelDesign = ModelDesignSchema.parse({
  name: "Copper Owl",
  texture_size: 64,
  bones: [
    { name: "root", parent: null, pivot: [0, 8, 0], rotation: [0, 0, 0], cubes: [{ name: "body", origin: [-4, 4, -3], size: [8, 8, 6], faces: { north: "#8a4f2b", east: "#8a4f2b", south: "#8a4f2b", west: "#8a4f2b", up: "#b16b37", down: "#63341e" } }] },
    { name: "wing", parent: "root", pivot: [4, 10, 0], rotation: [0, 12, 0], cubes: [{ name: "feather", origin: [4, 7, -1], size: [2, 5, 2], faces: { north: "#bd7a42", east: "#bd7a42", south: "#bd7a42", west: "#bd7a42", up: "#d49559", down: "#81451f" } }] },
  ],
  animations: [
    { name: "idle", length: 1, loop: true, channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }, { bone: "wing", keyframes: [{ time: 0, rotation: [0, 12, 0] }] }] },
    { name: "walk", length: 1, loop: true, channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }, { bone: "wing", keyframes: [{ time: 0, rotation: [0, 12, 0] }] }] },
    { name: "hurt", length: 0.5, loop: false, channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }, { bone: "wing", keyframes: [{ time: 0, rotation: [0, 12, 0] }] }] },
  ],
})

describe("Blockbench conversion boundary", () => {
  test("round trips hierarchy, colors, animations, and embeds the compiled atlas", () => {
    const project = designToBlockbench(design)
    expect(project.textures).toHaveLength(1)
    expect(project.elements?.every((element) => element.rotation?.every((value) => value === 0))).toBe(true)
    expect(project.outliner?.[0]).toMatchObject({ name: "root" })
    expect(project.outliner?.[0]).toHaveProperty("children.1.name", "wing")
    const result = blockbenchToDesignResult(project)
    expect(result.design.bones.map((bone) => [bone.name, bone.parent])).toEqual([["root", null], ["wing", "root"]])
    expect(result.design.bones[0]?.cubes[0]?.faces.north).toBe("#8a4f2b")
    expect(result.warnings).toEqual(["Blockbench textures are retained in the .bbmodel snapshot; ModelDesign stores face colors and recoverable surface rectangles, while unsupported texture edits require the compiled PNG override."])
  })

  test("recovers surface rectangles and preserves the compiled PNG through a native round trip", () => {
    const detailed = structuredClone(design)
    detailed.bones[0]!.cubes[0]!.surface_details = [{ face: "north", x: 1, y: 1, width: 3, height: 2, color: "#f0c040" }]
    const project = designToBlockbench(detailed)
    const imported = blockbenchToDesignResult(project).design
    expect(imported.bones[0]!.cubes[0]!.surface_details).toEqual([
      { face: "north", x: 1, y: 1, width: 3, height: 2, color: "#f0c040" },
    ])
    const source = (value: unknown) => z.record(z.string(), z.unknown()).parse(value).source
    expect(source(designToBlockbench(imported).textures![0])).toBe(source(project.textures![0]))
  })

  test("accepts native animate-mode records without keyframes and reports the retained boundary", () => {
    const project = designToBlockbench(design)
    const idle = project.animations?.find((animation) => animation.name === "idle")
    const body = Object.entries(idle?.animators ?? {})[0]
    if (!body) throw new Error("fixture is missing idle animator")
    const result = blockbenchToDesignResult({
      ...project,
      animations: project.animations?.map((animation) => animation.name === "idle" ? { ...animation, animators: { ...animation.animators, [body[0]]: { name: "root", type: "bone" } } } : animation),
    })
    expect(result.design.animations[0]?.channels[0]?.keyframes).toEqual([{ time: 0, rotation: [0, 0, 0] }])
    expect(result.warnings).toContain("1 Blockbench animation animator(s) omit keyframes; the native animator records remain in the .bbmodel snapshot and ModelDesign uses default channels for them.")
    expect(() => compileSavedModel({ design: result.design, blockbench: { ...project, animations: project.animations?.map((animation) => animation.name === "idle" ? { ...animation, animators: { ...animation.animators, [body[0]]: { name: "root", type: "bone" } } } : animation) } }, "creature_test")).not.toThrow()
  })

  test("preserves extra native animations during import and export", () => {
    const project = designToBlockbench(design)
    const extra = { ...project.animations![0], name: "attack" }
    const imported = blockbenchToDesignResult({ ...project, animations: [...project.animations!, extra] }).design
    expect(imported.animations.map((animation) => animation.name)).toContain("attack")
    expect(designToBlockbench(imported).animations?.map((animation) => animation.name)).toContain("attack")
  })

  test("keeps native texture authority when a face UV cannot become surface rectangles", () => {
    const project = designToBlockbench(design)
    const element = project.elements![0]!
    element.faces.north!.uv = element.faces.north!.uv!.map((value) => value + 0.5) as [number, number, number, number]
    const result = blockbenchToDesignResult(project)
    expect(result.design.bones[0]!.cubes[0]!.surface_details).toEqual([])
    expect(result.warnings.some((warning) => warning.includes("could not be represented"))).toBe(true)
  })

  test("recovers details from an embedded RGBA PNG using a filtered scanline and offset UV", () => {
    const project = designToBlockbench(design)
    const texture = z.record(z.string(), z.unknown()).parse(project.textures![0])
    const decoded = decodeRgbaPng(Buffer.from(String(texture.source).split(",")[1], "base64"))
    texture.source = `data:image/png;base64,${filteredPng(decoded.pixels, decoded.width, decoded.height).toString("base64")}`
    const result = blockbenchToDesignResult({ ...project, textures: [texture] })
    expect(result.design.bones[0]!.cubes[0]!.faces.north).toBe("#8a4f2b")
  })

  test("falls back with a warning for corrupt PNG data and aggregate rectangle overflow", () => {
    const project = designToBlockbench(design)
    const texture = z.record(z.string(), z.unknown()).parse(project.textures![0])
    const broken = Buffer.from(String(texture.source).split(",")[1], "base64")
    broken[broken.length - 1] ^= 1
    texture.source = `data:image/png;base64,${broken.toString("base64")}`
    expect(() => blockbenchToDesignResult({ ...project, textures: [texture] })).not.toThrow()

    const source = z.record(z.string(), z.unknown()).parse(project.textures![0])
    const decoded = decodeRgbaPng(Buffer.from(String(source.source).split(",")[1], "base64"))
    const element = project.elements![0]!
    for (const face of ["north", "east", "south"] as const) {
      const uv = element.faces[face]!.uv!
      for (let row = 0; row < uv[3] - uv[1]; row++) for (let column = 0; column < uv[2] - uv[0]; column++) {
        const x = uv[0] + column
        const y = uv[1] + row
        const offset = (y * decoded.width + x) * 4
        const color = ((column + row) % 2) ? [240, 192, 64] : [192, 64, 240]
        decoded.pixels.set([...color, 255], offset)
      }
    }
    source.source = `data:image/png;base64,${filteredPng(decoded.pixels, decoded.width, decoded.height).toString("base64")}`
    const overflow = blockbenchToDesignResult({ ...project, textures: [source] })
    expect(overflow.design.bones[0]!.cubes[0]!.surface_details).toEqual([])
    expect(overflow.warnings.some((warning) => warning.includes("could not be represented"))).toBe(true)
  })
})
