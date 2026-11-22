import { z } from "zod"
export const BoundedSnapshotSchema = z.record(z.string(), z.unknown()).refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 24_000_000, "模型文件超过 24 MB。")
export const BlockbenchCancelSchema = z.strictObject({ type: z.literal("blockbench-cancel"), id: z.uuid() })

export const BlockbenchTaskSchema = z.strictObject({
  type: z.literal("blockbench-task"),
  id: z.uuid(),
  projectId: z.uuid(),
  entityId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  model: BoundedSnapshotSchema,
})
export const BlockbenchTaskResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ type: z.literal("blockbench-result"), id: z.uuid(), ok: z.literal(true), snapshot: BoundedSnapshotSchema }),
  z.strictObject({ type: z.literal("blockbench-result"), id: z.uuid(), ok: z.literal(false), error: z.string() }),
])
export type BlockbenchTask = z.infer<typeof BlockbenchTaskSchema>
