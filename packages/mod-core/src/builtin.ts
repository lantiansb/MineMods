import { z } from "zod"
import { ABILITY_SOUND_IDS } from "./ability-words"
import { ParticleRefSchema } from "./particle-emission"

const particle = z.union([ParticleRefSchema,z.literal("none")]).optional()
const sound = z.union([z.literal("none"),z.literal("none"),z.enum(ABILITY_SOUND_IDS), z.strictObject({ asset: z.uuid() })]).optional()
const fixture = z.strictObject({particle, effect:z.uuid().optional()}).refine(v => !(v.particle && v.effect), {message:"物件同一状态选一种表现。保留粒子或效果中的一项。"})
const both = z.strictObject({particle, sound})
const audio = z.strictObject({sound})
export const BuiltinSchema = z.strictObject({
  weak_hit:both.optional(), immune_hit:both.optional(), leave:both.optional(), return:both.optional(),
  death_burst:both.optional(), death_poof:z.strictObject({particle}).optional(), fuse:both.optional(), arena_light:audio.optional(), fog_lift:audio.optional(),
  terrain_shatter:z.strictObject({particle}).optional(),
  fixture_lit:fixture.optional(), fixture_ember:fixture.optional(),
  fog_edge:z.strictObject({particle}).optional(), summon_success:audio.optional(), summon_blocked:audio.optional(),
})
export type Builtin = z.infer<typeof BuiltinSchema>
export { BUILTIN_LABELS, builtinUses } from "./builtin-names"
