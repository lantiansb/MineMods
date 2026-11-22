import { z } from "zod"

export const MODEL_ANNOTATION_IMAGE_LIMIT = 6 * 1024 * 1024
const PREFIX = "data:image/png;base64,"
const PointSchema = z.strictObject({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) })
const PartSchema = z.string().trim().min(1).max(200).nullable()

function dimensions(image: string) {
  if (!image.startsWith(PREFIX)) return null
  const encoded = image.slice(PREFIX.length)
  if (encoded.length < 32 || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null
  const header = atob(encoded.slice(0, 32))
  if (header.slice(0, 8) !== "\x89PNG\r\n\x1a\n" || header.slice(12, 16) !== "IHDR") return null
  const integer = (offset: number) => Array.from(header.slice(offset, offset + 4), (byte) => byte.charCodeAt(0)).reduce((value, byte) => value * 256 + byte, 0)
  return { width: integer(16), height: integer(20) }
}

export const ModelAnnotationImageSchema = z.string().max(MODEL_ANNOTATION_IMAGE_LIMIT).refine((image) => dimensions(image) !== null, "请提供有效的 PNG 图片。")

export const AnnotationMarkSchema = z.strictObject({
  kind: z.enum(["circle", "arrow", "text"]),
  start: PointSchema,
  end: PointSchema.optional(),
  text: z.string().trim().min(1).max(1000).optional(),
  part: PartSchema,
  /** The number of the person's note this mark belongs to (验收窗「制作过程」). Stable, so what is said about it later still names it. */
  note: z.number().int().positive().optional(),
  /** The motion and the moment the note points at. */
  frame: z.strictObject({ clip: z.string().trim().min(1).max(120), time: z.number().finite().min(0).max(3600) }).optional(),
}).superRefine((mark, context) => {
  if (mark.kind !== "text" && !mark.end) context.addIssue({ code: "custom", path: ["end"], message: "圈选和箭头需要终点。" })
  if (mark.kind === "text" && !mark.text) context.addIssue({ code: "custom", path: ["text"], message: "文字标注需要填写文字。" })
})
export type AnnotationMark = z.infer<typeof AnnotationMarkSchema>

export const ModelAnnotationContextSchema = z.strictObject({
  targetId: z.uuid(),
  projectRevision: z.number().int().nonnegative(),
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(4096),
  selectedPart: PartSchema,
  annotations: z.array(AnnotationMarkSchema).min(1).max(100),
  /** The person asked that only what is marked be changed, and nothing else. */
  only_marked: z.boolean().optional(),
})
export type ModelAnnotationContext = z.infer<typeof ModelAnnotationContextSchema>

export const ModelAnnotationInputSchema = ModelAnnotationContextSchema.extend({ image: ModelAnnotationImageSchema }).superRefine((annotation, context) => {
  const size = dimensions(annotation.image)
  if (size && (size.width !== annotation.width || size.height !== annotation.height)) context.addIssue({ code: "custom", path: ["image"], message: "图片尺寸与标注画布不一致。" })
})
export type ModelAnnotationInput = z.infer<typeof ModelAnnotationInputSchema>

/** Saved edit intent names the reference PNG; the image itself belongs to the reference store. */
export const StoredModelAnnotationSchema = z.strictObject({
  context: ModelAnnotationContextSchema,
  modelRevision: z.number().int().positive(),
  referenceId: z.uuid(),
})
