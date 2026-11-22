import { expect, test } from "bun:test"
import { z } from "zod"
import { getModuleSchema } from "@minemods/mod-core/workspace"
import { shareRepeats } from "../src/main/authoring-ai"

/**
 * r29 修补乙 回归: a revised creature's request passed the 240000 characters a request allows once a few optional fields were added to the creature (it had been 209 under).
 * The same sub-schema written out in several places is now defined once and referred to: what it says is the same, and a creature's schema is much shorter.
 */

/** Every `$ref` to a shared definition put back as what it refers to. */
const inline = (value: unknown, defs: Record<string, unknown>): unknown => {
  if (Array.isArray(value)) return value.map((child) => inline(child, defs))
  if (!value || typeof value !== "object") return value
  const ref = (value as { $ref?: unknown }).$ref
  if (typeof ref === "string" && ref.startsWith("#/$defs/__shared")) return inline(defs[ref.slice("#/$defs/".length)], defs)
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, inline(child, defs)]))
}

test("a creature's schema says the same with its repeats shared, and is shorter by far", () => {
  const original = z.toJSONSchema(getModuleSchema("entity"), { reused: "ref" }) as Record<string, unknown>
  const shared = shareRepeats(structuredClone(original))
  const defs = shared.$defs as Record<string, unknown>
  const back = inline(shared, defs) as Record<string, unknown>
  // The shared definitions are added to $defs; with them put back in place, everything else is what it was.
  const { $defs: backDefs, ...rest } = back
  const { $defs: originalDefs, ...was } = original
  expect(rest).toEqual(was)
  expect(Object.fromEntries(Object.entries(backDefs as Record<string, unknown>).filter(([key]) => !key.startsWith("__shared")))).toEqual(originalDefs as Record<string, unknown>)
  expect(JSON.stringify(shared).length).toBeLessThan(JSON.stringify(original).length - 10000)
  // Every reference points at a definition that is there.
  const refs = [...JSON.stringify(shared).matchAll(/"\$ref":"#\/\$defs\/([^"]+)"/g)].map((match) => match[1]!)
  refs.forEach((name) => expect(defs).toHaveProperty(name))
})

test("only a schema written twice or more, long enough to be worth it, is shared; a map of properties and the root never are", () => {
  const long = { type: "string", enum: Array.from({ length: 40 }, (_, index) => `name_${index}`) }
  const schema: Record<string, unknown> = { type: "object", properties: { a: structuredClone(long), b: structuredClone(long), c: { type: "string" }, d: { type: "string" } }, required: ["a", "b", "c", "d"] }
  const shared = shareRepeats(structuredClone(schema))
  expect(shared.properties).toEqual({ a: { $ref: "#/$defs/__shared0" }, b: { $ref: "#/$defs/__shared0" }, c: { type: "string" }, d: { type: "string" } })
  expect(shared.$defs).toEqual({ __shared0: long })
  // Nothing repeated: unchanged, and no $defs added.
  const single = { type: "object", properties: { a: long } }
  expect(shareRepeats(structuredClone(single))).toEqual(single)
})
