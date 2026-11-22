import { expect, test } from "bun:test"
import { z } from "zod"
import { fromStrict, strictSchema } from "../src/strict-schema"

test("a Zod schema with optional, nullable and shared parts becomes strict and its answers pass the original check", () => {
  const Part = z.strictObject({ name: z.string(), size: z.number().optional() }).meta({ id: "Part" })
  const Design = z.object({ title: z.string(), note: z.string().nullable().optional(), parts: z.array(Part), main: Part.optional() })
  const original = z.toJSONSchema(Design)
  const strict = strictSchema(original) as any
  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return
    if (node.properties) {
      expect(node.required).toEqual(Object.keys(node.properties))
      expect(node.additionalProperties).toBe(false)
    }
    Object.values(node).forEach(walk)
  }
  walk(strict)
  // Already nullable: no second null branch.
  expect(JSON.stringify(strict.properties.note)).not.toContain('"anyOf":[{"anyOf"')
  // The original is left untouched and the rewrite is computed once.
  expect(strictSchema(original)).toBe(strict)
  expect((original as any).required).toEqual(["title", "parts"])

  const answer = { title: "deer", note: null, parts: [{ name: "antler", size: null }], main: null }
  const cleaned = fromStrict(answer, original)
  expect(cleaned).toEqual({ title: "deer", note: null, parts: [{ name: "antler" }] })
  expect(Design.parse(cleaned)).toEqual({ title: "deer", note: null, parts: [{ name: "antler" }] })
})

test("nulls on required or unknown fields and values of other kinds are left for the caller's check", () => {
  const schema = { type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a"] }
  expect(fromStrict({ a: null, b: null, c: null }, schema)).toEqual({ a: null, c: null })
  expect(fromStrict("text", schema)).toBe("text")
  expect(strictSchema(true)).toBe(true)
})

test("a tuple goes out as an array of exactly its length, and the caller's check still holds each position", () => {
  const Cube = z.strictObject({ origin: z.tuple([z.number(), z.number(), z.number()]), uv: z.tuple([z.number(), z.number()]).optional(), tag: z.tuple([z.string(), z.number()]) })
  const strict = strictSchema(z.toJSONSchema(Cube)) as any
  expect(JSON.stringify(strict)).not.toContain("prefixItems")
  expect(strict.properties.origin).toEqual({ type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 })
  expect(strict.properties.tag.items).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] })
  expect(strict.properties.uv.anyOf[0]).toMatchObject({ type: "array", minItems: 2, maxItems: 2 })
  const cleaned = fromStrict({ origin: [0, 1, 2], uv: null, tag: ["a", 1] }, z.toJSONSchema(Cube))
  expect(Cube.parse(cleaned)).toEqual({ origin: [0, 1, 2], tag: ["a", 1] })
})

test("an optional union becomes one flat choice with null, never a choice inside a choice", () => {
  const Face = z.strictObject({ texel_size: z.union([z.number(), z.strictObject({ x: z.number(), y: z.number() })]).optional().describe("pixels per unit") })
  const strict = strictSchema(z.toJSONSchema(Face)) as any
  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node.anyOf)) for (const branch of node.anyOf) expect(Object.keys(branch)).not.toEqual(["anyOf"])
    Object.values(node).forEach(walk)
  }
  walk(strict)
  expect(strict.properties.texel_size.anyOf.map((branch: any) => branch.type)).toEqual(["number", "object", "null"])
  expect(strict.properties.texel_size.description).toBe("pixels per unit")
  expect(Face.parse(fromStrict({ texel_size: null }, z.toJSONSchema(Face)))).toEqual({})
})

test("a map goes out as a list of key/value entries and comes back as the map", () => {
  const Lang = z.strictObject({ zh_cn: z.record(z.string(), z.string()), en_us: z.record(z.string(), z.string()).optional() })
  const original = z.toJSONSchema(Lang)
  const strict = strictSchema(original) as any
  expect(JSON.stringify(strict)).not.toMatch(/"additionalProperties":\{/)
  expect(strict.properties.zh_cn).toMatchObject({ type: "array", items: { type: "object", required: ["key", "value"], additionalProperties: false } })
  const back = fromStrict({ zh_cn: [{ key: "item.egg", value: "彩虹蛋" }], en_us: null }, original)
  expect(Lang.parse(back)).toEqual({ zh_cn: { "item.egg": "彩虹蛋" } })
  // An answer in the original shape (a prompt-only route) passes through.
  expect(Lang.parse(fromStrict({ zh_cn: { a: "b" } }, original))).toEqual({ zh_cn: { a: "b" } })
})
