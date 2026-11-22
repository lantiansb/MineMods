import { z } from "zod"

const names = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/)
const namedSlot = z.union([z.strictObject({ group: names }), z.strictObject({ instance: names })])
export const FixtureActionSchema = z.strictObject({
  type: z.literal("fixture"),
  do: z.enum(["light", "douse", "ember"]),
  which: z.union([
    z.enum(["all", "nearest"]),
    namedSlot,
    z.array(namedSlot).min(1).max(8),
    z.strictObject({ in_hit: z.number().int().min(0) }),
  ]),
  every_seconds: z.number().min(0.05).max(30).optional(),
})
export type FixtureAction = z.infer<typeof FixtureActionSchema>
