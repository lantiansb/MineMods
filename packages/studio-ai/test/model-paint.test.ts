import { expect, test } from "bun:test"
import { MODEL_MATERIALS, ModelDesignJsonSchema, ModelDesignSchema, type ModelDesign } from "../src/contracts"
import { colorDistance, measureLook } from "../src/model-look"
import { cubePaint, luminance, modelAtlas, paintModel, usesPaint } from "../src/model-paint"
import { reviewModelQuality } from "../src/model-quality"
import slime from "./fixtures/look/good/sprout-slime.json"
import guardian from "./fixtures/look/good/crystal-guardian.json"

const base = () => ModelDesignSchema.parse(structuredClone(slime.model))
const face = (design: ModelDesign, cube: string, side: string) => {
  const painted = paintModel(design)
  const island = painted.islands.find((value) => value.cube === cube && value.face === side)!
  return Array.from({ length: island.height }, (_, v) =>
    Array.from({ length: island.width }, (_, u) => [0, 1, 2].map((channel) => painted.pixels[((island.y + v) * painted.size + island.x + u) * 4 + channel]!)),
  )
}
const mean = (rows: number[][][]) => rows.flat().reduce((sum, color) => sum + luminance(color), 0) / rows.flat().length
const flat = { north: "#102030", east: "#203040", south: "#304050", west: "#405060", up: "#506070", down: "#607080" }

test("a cube without material or features is painted exactly as before: face colour, details, face-coloured ring", () => {
  const design = base()
  design.bones[1]!.paint = undefined
  design.bones[1]!.cubes[1] = { name: "crown", origin: [-4, 9, -4], size: [8, 2, 8], faces: flat, surface_details: [{ face: "up", x: 0, y: 0, width: 2, height: 1, color: "#FF0000" }] }
  const painted = paintModel(design)
  const island = painted.islands.find((value) => value.cube === "crown" && value.face === "up")!
  const at = (x: number, y: number) => [...painted.pixels.slice((y * painted.size + x) * 4, (y * painted.size + x) * 4 + 4)]

  expect(at(island.x, island.y)).toEqual([255, 0, 0, 255])
  expect(at(island.x + 2, island.y)).toEqual([0x50, 0x60, 0x70, 255])
  // The ring keeps the face colour even next to a detail that touches the edge.
  expect(at(island.x - 1, island.y - 1)).toEqual([0x50, 0x60, 0x70, 255])
  expect(face(design, "crown", "north").flat()).toEqual(Array.from({ length: 16 }, () => [0x10, 0x20, 0x30]))
})

test("old documents parse to the same value: no paint or features keys appear", () => {
  const design = base()
  design.bones.forEach((bone) => {
    delete bone.paint
    bone.cubes.forEach((part) => {
      delete part.paint
      delete part.features
    })
  })
  const parsed = ModelDesignSchema.parse(JSON.parse(JSON.stringify(design)))

  expect(parsed).toEqual(design)
  expect(usesPaint(parsed)).toBe(false)
  expect(parsed.bones.flatMap((bone) => [bone, ...bone.cubes]).some((value) => "paint" in value || "features" in value)).toBe(false)
})

test("painting is stable: the same document gives the same pixels, and the pattern follows the cube's name", () => {
  const design = base()
  const renamed = base()
  renamed.bones[1]!.cubes[0]!.name = "blob"

  expect(paintModel(design).pixels).toEqual(paintModel(base()).pixels)
  expect(face(renamed, "blob", "east")).not.toEqual(face(design, "jelly", "east"))
})

test("a bone's material reaches its cubes and the bones below it; a cube's own material wins", () => {
  const design = ModelDesignSchema.parse(structuredClone(guardian.model))
  const head = design.bones.find((bone) => bone.name === "head")!

  expect(cubePaint(design, head, head.cubes.find((part) => part.name === "skull")!)?.material).toBe("stone")
  expect(cubePaint(design, head, head.cubes.find((part) => part.name === "horn_left")!)?.material).toBe("bone")
  expect(cubePaint(design, design.bones[0]!, { ...head.cubes[0]!, paint: undefined })).toBeNull()
})

test("every material paints a few clustered tones, lit from above, and passes the gate it is judged by", () => {
  MODEL_MATERIALS.forEach((material) => {
    const design = base()
    design.bones[1]!.paint = { material, base: "#7A8F5C", secondary: "#8C7A4E" }
    const look = measureLook(design)
    const tones = new Set(face(design, "jelly", "east").flat().map((color) => color.join(",")))

    expect({ material, tones: tones.size >= 3 && tones.size <= 18 }).toEqual({ material, tones: true })
    // Crystal facets differ so much face to face that only top against bottom is a fair comparison.
    expect({ material, lit: mean(face(design, "jelly", "up")) > mean(face(design, "jelly", "down")) && (material === "crystal" || mean(face(design, "jelly", "up")) > mean(face(design, "jelly", "east"))) }).toEqual({ material, lit: true })
    expect({ material, speckShare: look.speckShare < 0.07, flatShare: look.flatShare < 0.3 }).toEqual({ material, speckShare: true, flatShare: true })
    expect({ material, findings: reviewModelQuality(design, { complexity: "medium" }).findings }).toEqual({ material, findings: [] })
  })
})

test("eyes are a mirrored pair that stands out from the skin, whatever the skin colour", () => {
  ;["#101418", "#7A8F5C", "#F2F2EC"].forEach((skin) => {
    const design = base()
    design.bones[1]!.paint = { material: "skin", base: skin }
    design.bones[1]!.cubes[0]!.features = [{ type: "eyes", shape: "square", size: 2, color: skin === "#F2F2EC" ? "#1B1B24" : "#F2F2EC", color2: skin === "#F2F2EC" ? "#F2F2EC" : "#1B1B24" }]
    const bare = base()
    bare.bones[1]!.paint = design.bones[1]!.paint
    bare.bones[1]!.cubes[0]!.features = []
    const skinRows = face(bare, "jelly", "north")
    const drawn = face(design, "jelly", "north").map((row, v) => row.map((color, u) => color.join(",") !== skinRows[v]![u]!.join(",")))

    // What the eyes changed on the left half is mirrored on the right half.
    expect({ skin, mirrored: drawn.every((row) => row.every((value, u) => value === row[row.length - 1 - u])) }).toEqual({ skin, mirrored: true })
    expect(drawn.flat().filter(Boolean).length).toBeGreaterThanOrEqual(8)
    expect({ skin, eyes: measureLook(design).eyes }).toEqual({ skin, eyes: true })
  })
})

test("every feature draws inside its face and changes it", () => {
  const types = ["eyes", "brows", "mouth", "nose", "belly", "stripes", "spots", "cracks", "veins", "band", "claws", "gem"] as const
  types.forEach((type) => {
    const design = base()
    const plain = base()
    plain.bones[1]!.cubes[0]!.features = []
    design.bones[1]!.cubes[0]!.features = [{ type, face: "north" }]

    expect({ type, changed: JSON.stringify(face(design, "jelly", "north")) !== JSON.stringify(face(plain, "jelly", "north")) }).toEqual({ type, changed: true })
    // Nothing leaks onto other faces or other cubes.
    expect({ type, same: JSON.stringify(face(design, "crown", "north")) === JSON.stringify(face(plain, "crown", "north")) }).toEqual({ type, same: true })
  })
})

test("features fit faces of any size without throwing", () => {
  const sizes: [number, number, number][] = [[1, 1, 1], [2, 1, 3], [3, 2, 1], [5, 9, 2], [16, 3, 16]]
  sizes.forEach((size) => {
    const design = base()
    design.bones[1]!.cubes[0] = {
      ...design.bones[1]!.cubes[0]!,
      size,
      features: ["eyes", "brows", "mouth", "nose", "belly", "stripes", "spots", "cracks", "veins", "band", "claws", "gem"].map((type) => ({ type, face: "all" })) as never,
    }
    expect(() => paintModel(ModelDesignSchema.parse(design))).not.toThrow()
  })
})

test("the strict JSON schema lists every key as required and lets the optional ones be null", () => {
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return
    const object = value as Record<string, unknown>
    if (object.properties && Array.isArray(object.required)) expect([...(object.required as string[])].sort()).toEqual(Object.keys(object.properties as object).sort())
    Object.values(object).forEach(visit)
  }
  visit(ModelDesignJsonSchema)
  const text = JSON.stringify(ModelDesignJsonSchema)
  expect(text).toContain('"paint"')
  expect(text).toContain('"features"')
  const cubeOf = ModelDesignSchema.parse(JSON.parse(JSON.stringify(guardian.model).replaceAll('"surface_details":[]', '"surface_details":[],"paint":null,"features":null')))
  expect(paintModel(cubeOf).pixels.length).toBe(128 * 128 * 4)
})

test("the atlas layout is the document order row packing saved textures rely on", () => {
  const islands = modelAtlas(base())

  expect(islands.slice(0, 3).map((island) => [island.cube, island.face, island.x, island.y, island.width, island.height])).toEqual([
    ["jelly", "north", 1, 1, 12, 9],
    ["jelly", "east", 15, 1, 12, 9],
    ["jelly", "south", 29, 1, 12, 9],
  ])
})
