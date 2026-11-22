import { z } from "zod"
import { SOUND_LIMITS } from "@minemods/mod-core/sound"

export const AudioTarget = z.strictObject({
  projectId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  kind: z.enum(["music", "sound"]),
  assetId: z.uuid().optional(),
  title: z.string().trim().min(1).max(120).optional(),
  part: z.enum(["intro", "loop", "outro"]).optional(),
  index: z.number().int().min(0).max(7).optional(),
})
export const InboxImport = AudioTarget.extend({ filename: z.string().min(1).max(180) })
export const AudioUpload = AudioTarget.extend({
  data: z
    .string()
    .min(1)
    .max(88 * 1024 * 1024),
})
export const PartInput = z.strictObject({ projectId: z.uuid(), assetId: z.uuid(), part: z.enum(["intro", "loop", "outro"]) })
const subtitle = z.string().trim().min(1).max(SOUND_LIMITS.subtitle)
export const SoundSettings = z.strictObject({
  projectId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  assetId: z.uuid(),
  subtitle: z.strictObject({ zh: subtitle, en: subtitle }).nullable(),
  volume: z.number().finite().min(0.1).max(1),
})
export type SoundSettingsInput = z.infer<typeof SoundSettings>
export type AudioTargetInput = z.infer<typeof AudioTarget>
