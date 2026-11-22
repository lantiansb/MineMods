import { z } from "zod"
export const AssetAction = z.strictObject({ projectId: z.uuid(), expectedRevision: z.number().int().nonnegative(), assetId: z.uuid(), creature: z.literal(true).optional() })
export const AssetRename = AssetAction.extend({ title: z.string().trim().min(1).max(120) })
export const AssetRestore = AssetAction.omit({ assetId: true, creature: true }).extend({ deletion: z.uuid() })
export const COPY_KINDS = ["block", "item", "sound", "music", "particle", "effect", "bossbar", "fixture"]
