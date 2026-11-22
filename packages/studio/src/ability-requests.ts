import { z } from "zod"

export const ExtractAbilityInput = z.strictObject({
  projectId: z.uuid(), expectedRevision: z.int().nonnegative(), entityAssetId: z.uuid(), moveId: z.string().min(1).max(32),
})
