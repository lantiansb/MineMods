import { z } from "zod"

/**
 * The targets Studio has a manifest for (`target/manifests.ts`); whether each is ready yet is the manifest's to say.
 * A leaf module so the project schema can name targets without pulling in the asset-kind registry.
 */
export const TargetIdSchema = z.enum(["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"])
export type TargetId = z.infer<typeof TargetIdSchema>
export const DEFAULT_TARGET = "fabric-1.21.1" as const satisfies TargetId
