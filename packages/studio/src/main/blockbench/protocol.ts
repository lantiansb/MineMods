import { z } from "zod"

export const BLOCKBENCH_CHANNEL = "minemods:blockbench:v1"
export const BlockbenchFaceSchema = z.enum(["north", "east", "south", "west", "up", "down"])
const Vector3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
const NameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
const TargetSchema = z.object({ id: z.string().min(1).max(160), kind: z.enum(["cube", "bone", "animation", "texture"]) }).strict()
const BaseCommandSchemas = [
  z.object({ op: z.literal("readSnapshot") }).strict(),
  z.object({ op: z.literal("open"), model: z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 24_000_000, "Model is too large") }).strict(),
  z.object({ op: z.literal("createCuboid"), name: NameSchema, from: Vector3Schema, to: Vector3Schema, bone: z.string().min(1).max(160).optional() }).strict(),
  z.object({ op: z.literal("createBone"), name: NameSchema, parent: z.string().min(1).max(160).nullable(), pivot: Vector3Schema, rotation: Vector3Schema }).strict(),
  z.object({ op: z.literal("createTexture"), name: z.string().min(1).max(160), width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096), dataUrl: z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).max(24_000_000) }).strict(),
  z.object({ op: z.literal("editUV"), cube: z.string().min(1).max(160), face: BlockbenchFaceSchema, uv: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]) }).strict(),
  z.object({ op: z.literal("addKeyframe"), animation: z.string().min(1).max(160), bone: z.string().min(1).max(160), time: z.number().min(0).max(60), rotation: Vector3Schema }).strict(),
  z.object({ op: z.literal("transform"), target: TargetSchema, translation: Vector3Schema.optional(), rotation: Vector3Schema.optional(), scale: Vector3Schema.optional() }).strict(),
  z.object({ op: z.literal("select"), target: TargetSchema.nullable() }).strict(),
  z.object({ op: z.literal("setMode"), mode: z.enum(["edit", "paint", "animate"]) }).strict(),
  z.object({ op: z.literal("resetCamera") }).strict(),
  z.object({ op: z.literal("undo") }).strict(),
  z.object({ op: z.literal("redo") }).strict(),
  z.object({ op: z.literal("save") }).strict(),
  z.object({ op: z.literal("close") }).strict(),
] as const

export const BlockbenchCommandSchema = z.union([...BaseCommandSchemas, z.object({ op: z.literal("batch"), commands: z.array(z.union(BaseCommandSchemas)).min(1).max(32) }).strict()])
export type BlockbenchCommand = z.infer<typeof BlockbenchCommandSchema>
export type BlockbenchAtomicCommand = Exclude<BlockbenchCommand, { op: "batch" }>

export const BlockbenchEnvelopeSchema = z.object({
  channel: z.literal(BLOCKBENCH_CHANNEL),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/),
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/),
  kind: z.enum(["ready", "request", "response", "event"]),
  command: BlockbenchCommandSchema.optional(),
  ok: z.boolean().optional(),
  revision: z.number().int().min(0).optional(),
  snapshot: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(2000).optional(),
}).strict()
export type BlockbenchEnvelope = z.infer<typeof BlockbenchEnvelopeSchema>

export const BlockbenchSnapshotSchema = z.object({
  revision: z.number().int().min(0),
  project: z.record(z.string(), z.unknown()),
  bbmodel: z.record(z.string(), z.unknown()),
}).strict()
export type BlockbenchSnapshot = z.infer<typeof BlockbenchSnapshotSchema>
