export const MODEL_POLICY = Object.freeze({
  provider: "openai" as const,
  model: "gpt-6-astra" as const,
  reasoningEffort: "high" as const,
  endpoint: "https://api.openai.com/v1/responses" as const,
})

export const ModelingErrorCodes = Object.freeze([
  "INVALID_INPUT",
  "INVALID_OUTPUT",
  "MODEL_MISMATCH",
  "UNAUTHORIZED",
  "BUDGET_EXCEEDED",
  "NO_API_KEY",
  "CANCELLED",
  "TIMEOUT",
  "REFUSED",
  "INCOMPLETE_OUTPUT",
  "UPSTREAM_UNAVAILABLE",
  // The model service was reached and refused the request as written (HTTP 400/422) after every looser form was tried.
  "REQUEST_REJECTED",
  "SERVICE_UNAVAILABLE",
  // The configured model was sent pictures and cannot take them.
  "NO_VISION",
] as const)
export type ModelingErrorCode = (typeof ModelingErrorCodes)[number]

export class ModelingError extends Error {
  constructor(readonly code: ModelingErrorCode) {
    super(code)
    this.name = "ModelingError"
  }
}

/**
 * The echoed model can only be pinned on the default endpoint with the default model.
 * Other providers echo an alias, a dated snapshot or nothing at all.
 */
export function requiresExactModel(endpoint: string, model: string) {
  return endpoint === MODEL_POLICY.endpoint && model === MODEL_POLICY.model
}

export function assertResponseModel(model: unknown, request: { endpoint: string; model: string } = MODEL_POLICY) {
  if (requiresExactModel(request.endpoint, request.model) && model !== request.model) throw new ModelingError("MODEL_MISMATCH")
}
