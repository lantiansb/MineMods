import { randomUUID, timingSafeEqual } from "node:crypto"
import { ModelingInputSchema } from "@minemods/studio-ai/contracts"
import { ModelingError, type ModelingErrorCode } from "@minemods/studio-ai/policy"
import { createModelingContext, requestModelingStep } from "./openai"
import { MODEL_ANNOTATION_IMAGE_LIMIT } from "@minemods/studio-ai/model-annotation"

export function createModelingHandler(options: {
  serviceToken?: string
  requestModelingStep?: typeof requestModelingStep
}) {
  return async function handler(request: Request) {
    const failure = (code: ModelingErrorCode, status: number) =>
      Response.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store" } })
    if (new URL(request.url).pathname !== "/v1/modeling" || request.method !== "POST")
      return new Response(null, { status: 404 })
    if (!options.serviceToken) return failure("SERVICE_UNAVAILABLE", 503)
    const expected = Buffer.from(`Bearer ${options.serviceToken}`)
    const supplied = Buffer.from(request.headers.get("authorization") ?? "")
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return failure("UNAUTHORIZED", 401)
    if (!request.headers.get("content-type")?.startsWith("application/json")) return failure("INVALID_INPUT", 400)
    const limit = MODEL_ANNOTATION_IMAGE_LIMIT + 1024 * 1024
    if (Number(request.headers.get("content-length") ?? 0) > limit) return failure("INVALID_INPUT", 400)
    const text = await request.text().catch(() => "")
    if (new TextEncoder().encode(text).byteLength > limit) return failure("INVALID_INPUT", 400)
    const parsed = ModelingInputSchema.safeParse(
      await Promise.resolve()
        .then((): unknown => JSON.parse(text))
        .catch(() => null),
    )
    if (!parsed.success) return failure("INVALID_INPUT", 400)
    // This token authenticates a developer preview only. Production login/entitlements remain a separate milestone.
    const context = createModelingContext({
      userId: "developer-preview",
      taskId: randomUUID(),
      authorized: true,
      budget: { maxAttempts: 2, maxTotalTokens: 250000, maxOutputTokens: 32768 },
      timeoutMs: 600000,
      signal: request.signal,
    })
    return (options.requestModelingStep ?? requestModelingStep)(parsed.data, context)
      .then((result) => Response.json(result, { headers: { "Cache-Control": "no-store" } }))
      .catch((error: unknown) => {
        const code = error instanceof ModelingError ? error.code : "UPSTREAM_UNAVAILABLE"
        const status =
          code === "UNAUTHORIZED"
            ? 403
            : code === "BUDGET_EXCEEDED"
              ? 429
              : code === "CANCELLED"
                ? 499
                : code === "TIMEOUT"
                  ? 504
                  : code === "NO_API_KEY"
                    ? 503
                    : 502
        return failure(code, status)
      })
  }
}
