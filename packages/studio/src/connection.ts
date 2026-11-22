import { z } from "zod"

const ConnectionText = z.string().trim().max(500)
const ModelName = z.string().trim().min(1).max(120)

export const ConnectionSettingsSchema = z.strictObject({
  mode: z.enum(["api", "mcp"]),
  baseUrl: ConnectionText,
  model: ModelName,
  routerModel: ModelName,
  moduleModel: ModelName,
  transcriptionModel: ModelName,
  /**
   * 「审查」(10-07, the owner's decision): a review by an AI that took no part in the making, as a switch the person turns
   * on and off. On, every thing made is read once more by a reviewer of its own before it is saved, which costs more.
   * With an API connection the reviewer is one more model to name (`reviewModel`; left out: the making model, asked afresh).
   * With an outside AI over MCP the person is given two hand-offs, one for the AI that makes and one for the AI that reviews.
   * Off, the maker's own review is the last word and is recorded as that. Absent (settings saved before the switch): on.
   */
  review: z.boolean().optional(),
  // Distinguishes first-time connections from old files that omitted the switch.
  reviewDefaults: z.literal("by-mode").optional(),
  particleLook: z.boolean().optional(),
  reviewModel: ModelName.optional(),
  /**
   * 六视图 (2026-10-08): the model Studio asks to draw a thing's six views (and its own AI's concept views) through the connection's
   * `/images/generations` in API mode. In MCP mode the external agent checks its own image tools and submits the generated sheet. Absent (settings saved before): "gpt-image-1".
   */
  imageModel: ModelName.optional(),
})
export type ConnectionSettings = z.infer<typeof ConnectionSettingsSchema>

export const PublicConnectionSchema = ConnectionSettingsSchema.extend({
  hasApiKey: z.boolean(),
  source: z.enum(["saved", "environment", "none"]),
})
export type PublicConnection = z.infer<typeof PublicConnectionSchema>

export const REVIEW_DEFAULT = { api: true, mcp: false } as const
type ReviewChoice = Partial<Pick<PublicConnection, "review" | "reviewDefaults" | "mode" | "source">>
export function reviewEnabled(connection: ReviewChoice) {
  if (connection.review !== undefined) return connection.review
  return connection.reviewDefaults || connection.source === "none" ? REVIEW_DEFAULT[connection.mode ?? "api"] : true
}

export function editableConnection({ source, hasApiKey, ...settings }: PublicConnection): SaveConnectionInput {
  return settings
}

export const SaveConnectionInputSchema = ConnectionSettingsSchema.extend({
  apiKey: z.string().trim().min(1).max(1000).optional(),
  clearApiKey: z.boolean().optional(),
}).refine((value) => !(value.apiKey !== undefined && value.clearApiKey === true), {
  message: "apiKey 与 clearApiKey 不能同时设置。",
  path: ["apiKey"],
})
export type SaveConnectionInput = z.infer<typeof SaveConnectionInputSchema>

export const TestConnectionInputSchema = SaveConnectionInputSchema
export type TestConnectionInput = z.infer<typeof TestConnectionInputSchema>

export const ListConnectionModelsInputSchema = z.strictObject({
  baseUrl: ConnectionText,
  apiKey: z.string().trim().min(1).max(1000).optional(),
  model: ModelName.optional(),
})
export type ListConnectionModelsInput = z.infer<typeof ListConnectionModelsInputSchema>

export const ConnectionTestResultSchema = z.strictObject({
  ok: z.literal(true),
  model: z.string().min(1).max(120),
  status: z.string().min(1).max(80),
})
export type ConnectionTestResult = z.infer<typeof ConnectionTestResultSchema>
