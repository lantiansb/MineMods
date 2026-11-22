import { z } from "zod"
import { ModelingInputSchema, ModelingResultSchema, type ModelingResult } from "./contracts"
import { ModelingError, ModelingErrorCodes } from "./policy"

/** Instantiate in a trusted desktop main process. Never send this configuration to the renderer. */
export function createModelingClient(options: { url: string; token: string; timeoutMs?: number }) {
  if (!URL.canParse(options.url) || !options.token.trim()) throw new ModelingError("SERVICE_UNAVAILABLE")
  const url = new URL(options.url)
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  ) {
    throw new ModelingError("SERVICE_UNAVAILABLE")
  }
  return {
    async requestModelingStep(input: unknown, context: { signal?: AbortSignal } = {}): Promise<ModelingResult> {
      if (context.signal?.aborted) throw new ModelingError("CANCELLED")
      const parsed = ModelingInputSchema.safeParse(input)
      if (!parsed.success) throw new ModelingError("INVALID_INPUT")
      const timeout = AbortSignal.timeout(Math.min(Math.max(options.timeoutMs ?? 630000, 1), 630000))
      const signal = context.signal ? AbortSignal.any([timeout, context.signal]) : timeout
      return fetch(new URL("/v1/modeling", url), {
        method: "POST",
        redirect: "error",
        signal,
        headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })
        .then(async (response) => {
          const reader = response.body?.getReader()
          if (!reader) throw new ModelingError("INVALID_OUTPUT")
          const chunks: Uint8Array[] = []
          const size = { bytes: 0 }
          const read = async (): Promise<void> => {
            const next = await reader.read()
            if (next.done) return
            size.bytes += next.value.byteLength
            if (size.bytes > 2097152) {
              await reader.cancel().catch(() => undefined)
              throw new ModelingError("INVALID_OUTPUT")
            }
            chunks.push(next.value)
            return read()
          }
          await read()
          const raw: unknown = await Promise.resolve()
            .then(() => JSON.parse(Buffer.concat(chunks).toString("utf8")))
            .catch(() => {
              throw new ModelingError("INVALID_OUTPUT")
            })
          if (!response.ok) {
            const error = z.object({ error: z.object({ code: z.enum(ModelingErrorCodes) }) }).safeParse(raw)
            throw new ModelingError(error.success ? error.data.error.code : "SERVICE_UNAVAILABLE")
          }
          const result = ModelingResultSchema.safeParse(raw)
          if (!result.success || result.data.revision !== parsed.data.revision)
            throw new ModelingError("INVALID_OUTPUT")
          if (context.signal?.aborted) throw new ModelingError("CANCELLED")
          return result.data
        })
        .catch((error: unknown) => {
          if (context.signal?.aborted) throw new ModelingError("CANCELLED")
          if (timeout.aborted) throw new ModelingError("TIMEOUT")
          if (error instanceof ModelingError) throw error
          throw new ModelingError("SERVICE_UNAVAILABLE")
        })
    },
  }
}
