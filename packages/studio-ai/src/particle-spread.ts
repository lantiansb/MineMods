import { z } from "zod"

export const ParticleSpreadSchema = z.strictObject({
  count:z.number().int().min(1).max(600).optional(),seed:z.number().int().optional(),yaw:z.number().finite().optional(),
  shape:z.enum(["sphere","disc","ring"]).optional(),spread:z.union([z.number().min(0).max(64),z.strictObject({x:z.number().min(0).max(64),y:z.number().min(0).max(64),z:z.number().min(0).max(64)})]).optional(),
  velocity:z.strictObject({forward:z.number().min(-20).max(20).optional(),up:z.number().min(-20).max(20).optional(),left:z.number().min(-20).max(20).optional(),outward:z.number().min(-20).max(20).optional(),vary:z.number().min(0).max(1).optional()}).optional(),
  motion:z.discriminatedUnion("type",[z.strictObject({type:z.literal("converge")}),z.strictObject({type:z.literal("orbit"),turns:z.number().min(-4).max(4)})]).optional(),
  tint:z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
})
