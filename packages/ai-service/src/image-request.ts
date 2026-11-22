import { z } from "zod"
import { responsesConfig } from "./responses-config"
import { routeMissing } from "./route-evidence"
import type { StructuredTransport } from "./structured-request"
import { createTimedModelingTransport } from "./timed-transport"

/**
 * One picture drawn by the provider's image endpoint (`/images/generations`, as OpenAI and those
 * compatible with it offer). It is an extra: many connections have no such endpoint, so this never
 * throws for the provider's sake. Null means "this connection drew nothing", whatever the reason, and
 * the caller goes on without a picture.
 */

/** The model asked for when the caller names none. */
export const IMAGE_MODEL = "gpt-image-1"
const PICTURE_LIMIT = 8 * 1024 * 1024
const BODY_LIMIT = 16 * 1024 * 1024

const AnswerSchema = z.object({ data: z.array(z.object({ b64_json: z.string().min(1).optional() })).min(1) })

let sharedTransport: ReturnType<typeof createTimedModelingTransport> | undefined
const defaultTransport: StructuredTransport = (url, init) => (sharedTransport ??= createTimedModelingTransport()).fetch(url, init)

const mime = (bytes: Uint8Array) => {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp"
  return null
}

/** The model a connection draws with: the one it names, or `IMAGE_MODEL` when it names none (settings saved before the choice existed). */
export const pictureModel = (model?: string | null) => model?.trim() || IMAGE_MODEL

/**
 * Where a connection's pictures are asked for, or null when its route cannot draw: an address that is not a safe one, or the Codex
 * route, which answers text only. Whoever says beforehand whether a picture can be drawn reads this, so it says what `requestPicture` does.
 */
export function pictureRoute(baseUrl?: string) {
  try {
    const provider = responsesConfig(baseUrl || undefined, 1, false)
    return provider.codex ? null : `${provider.base}/images/generations`
  } catch {
    return null
  }
}

/**
 * Pictures asked for at an address with a model that answered "no such endpoint", for the rest of this run. Many connections (a text-only
 * provider, for one) have no image endpoint; asking again for every task only repeats the same refusal. The key is the address and the
 * model, so a connection changed to another address or another image model is judged afresh.
 */
const missing = new Set<string>()
const memoryKey = (route: string, model: string) => `${route}\n${model}`

/** Whether this address with this image model is known, from an earlier answer in this run, to have no image endpoint. */
export function pictureRouteMissing(baseUrl?: string, model?: string | null) {
  const route = pictureRoute(baseUrl)
  return route !== null && missing.has(memoryKey(route, pictureModel(model)))
}

/** Whether a picture can be asked for here at all: the route is a drawing one and has not already answered that it does not exist. */
export const pictureCanBeAsked = (baseUrl?: string, model?: string | null) => pictureRoute(baseUrl) !== null && !pictureRouteMissing(baseUrl, model)

/** Forgets every remembered missing endpoint (tests; nothing in the app needs it, a restart does the same). */
export const forgetMissingPictureRoutes = () => missing.clear()

export async function requestPicture(options: { baseUrl?: string; apiKey: string; model?: string; prompt: string; size?: "1024x1024" | "1536x1024"; signal: AbortSignal; transport?: StructuredTransport }): Promise<string | null> {
  if (!options.apiKey.trim() || options.signal.aborted) return null
  const route = pictureRoute(options.baseUrl)
  if (!route) return null
  const key = memoryKey(route, pictureModel(options.model))
  if (missing.has(key)) return null
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(180_000)])
  return (options.transport ?? defaultTransport)(route, {
    method: "POST",
    redirect: "error",
    signal,
    headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: pictureModel(options.model), prompt: options.prompt.slice(0, 8000), n: 1, size: options.size ?? "1536x1024" }),
  })
    .then(async (response) => {
      if (routeMissing(response.status)) missing.add(key)
      if (!response.ok || Number(response.headers.get("content-length") ?? 0) > BODY_LIMIT) return null
      const text = await response.text()
      if (text.length > BODY_LIMIT) return null
      const answer = AnswerSchema.safeParse(await Promise.resolve(text).then(JSON.parse).catch(() => null)).data
      const encoded = answer?.data[0]?.b64_json
      if (!encoded || !/^[A-Za-z0-9+/=]+$/.test(encoded)) return null
      const bytes = Buffer.from(encoded, "base64")
      const type = bytes.length <= PICTURE_LIMIT ? mime(bytes) : null
      return type ? `data:${type};base64,${bytes.toString("base64")}` : null
    })
    .catch(() => null)
}
