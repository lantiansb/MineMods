import { describe, expect, test } from "bun:test"
import { ModelDesignSchema, ModelingInputSchema } from "../src/contracts"
import { assertResponseModel, MODEL_POLICY } from "../src/policy"
import { designFixture } from "./fixture"

describe("fixed model policy", () => {
  test("only the exact verified model identity succeeds", () => {
    expect(MODEL_POLICY).toEqual({
      provider: "openai",
      model: "gpt-6-astra",
      reasoningEffort: "high",
      endpoint: "https://api.openai.com/v1/responses",
    })
    expect(() => assertResponseModel("gpt-6-astra")).not.toThrow()
    for (const model of ["gpt-5", "gpt-6-astra-preview", "gpt-6-astra-2026-09-13", "", undefined]) {
      expect(() => assertResponseModel(model)).toThrow("MODEL_MISMATCH")
    }
    expect(Object.isFrozen(MODEL_POLICY)).toBe(true)
  })
  test("requests reject every unsupported override field", () => {
    const input = { step: "model", content: "Create a forest creature", revision: "r0" }
    expect(ModelingInputSchema.safeParse(input).success).toBe(true)
    for (const field of [
      "model",
      "aiModel",
      "provider",
      "baseURL",
      "endpoint",
      "reasoning_effort",
      "budget",
      "userId",
    ]) {
      expect(ModelingInputSchema.safeParse({ ...input, [field]: "override" }).success).toBe(false)
    }
  })
  test("accepts trusted revision context up to 200000 characters", () => {
    const input = { step: "revise", content: "x".repeat(200000), revision: "r0" }
    expect(ModelingInputSchema.safeParse(input).success).toBe(true)
    expect(ModelingInputSchema.safeParse({ ...input, content: `${input.content}x` }).success).toBe(false)
    expect(ModelingInputSchema.safeParse({ step: "model", content: "x".repeat(16000), revision: "r0" }).success).toBe(true)
  })
})

describe("V1 model design", () => {
  test("accepts AI-authored geometry and six face colors", () => {
    expect(ModelDesignSchema.parse(designFixture()).bones[0].cubes[0].faces.north).toBe("#226633")
    expect(ModelDesignSchema.parse(designFixture()).bones[0].cubes[0].surface_details).toEqual([])
  })
  test("rejects invalid cube extents, colors, coordinates, and unknown fields", () => {
    for (const value of [0, -1, 0.5, Infinity, 257]) {
      const design = designFixture()
      design.bones[0].cubes[0].size[0] = value
      expect(ModelDesignSchema.safeParse(design).success).toBe(false)
    }
    const design = designFixture()
    design.bones[0].cubes[0].faces.north = "red"
    expect(ModelDesignSchema.safeParse(design).success).toBe(false)
    expect(ModelDesignSchema.safeParse({ ...designFixture(), extra: true }).success).toBe(false)
    design.bones[0].pivot[0] = NaN
    expect(ModelDesignSchema.safeParse(design).success).toBe(false)
  })
  test("rejects duplicate bones and disconnected or cyclic parent graphs", () => {
    const bone = designFixture().bones[0]
    for (const bones of [
      [bone, bone],
      [bone, { ...bone, name: "child", parent: "missing" }],
      [bone, { ...bone, name: "second_root" }],
      [bone, { ...bone, name: "a", parent: "b" }, { ...bone, name: "b", parent: "a" }],
    ])
      expect(ModelDesignSchema.safeParse({ ...designFixture(), bones }).success).toBe(false)
  })
  test("requires all three animations and valid references, distinct times within length", () => {
    const design = designFixture()
    design.animations[0].channels[0].bone = "missing"
    expect(ModelDesignSchema.safeParse(design).success).toBe(false)
    expect(ModelDesignSchema.safeParse({ ...designFixture(), animations: [] }).success).toBe(false)
    design.animations[0].channels[0].bone = "root"
    design.animations[0].channels[0].keyframes[0].time = 2
    expect(ModelDesignSchema.safeParse(design).success).toBe(false)
  })
  test("accepts extra uniquely named animations while requiring the three defaults", () => {
    const design = designFixture()
    design.animations.push({ ...design.animations[0], name: "attack" })
    expect(ModelDesignSchema.parse(design).animations.map((animation) => animation.name)).toContain("attack")
    expect(ModelDesignSchema.safeParse({ ...design, animations: design.animations.slice(0, 2) }).success).toBe(false)
    expect(ModelDesignSchema.safeParse({ ...design, animations: design.animations.map((animation, index) => index === 3 ? { ...animation, name: "idle" } : animation) }).success).toBe(false)
  })
  test("validates surface detail rectangles against each cube face", () => {
    const design = designFixture()
    design.bones[0].cubes[0].surface_details = [{ face: "north", x: 3, y: 2, width: 1, height: 2, color: "#ffffff" }]
    expect(ModelDesignSchema.safeParse(design).success).toBe(true)
    for (const detail of [
      { face: "north", x: 4, y: 0, width: 1, height: 1, color: "#ffffff" },
      { face: "north", x: 0, y: 0, width: 5, height: 1, color: "#ffffff" },
      { face: "north", x: 0, y: 0, width: 0, height: 1, color: "#ffffff" },
    ] as const) {
      const candidate = structuredClone(designFixture())
      candidate.bones[0].cubes[0].surface_details = [detail]
      expect(ModelDesignSchema.safeParse(candidate).success).toBe(false)
    }
  })
})
