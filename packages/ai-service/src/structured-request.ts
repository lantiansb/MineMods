import { z } from "zod"
import { UsageSchema } from "@minemods/studio-ai/contracts"
import { MODEL_POLICY, ModelingError, requiresExactModel } from "@minemods/studio-ai/policy"
import { createDesignProgress, readModelResponse, type ModelProgressEvent, type ModelResponseDiagnostics } from "./model-stream"
import { responsesConfig } from "./responses-config"
import { routeMissing } from "./route-evidence"
import { fromStrict, strictSchema } from "./strict-schema"
import { createTimedModelingTransport } from "./timed-transport"

export type StructuredTransport = (url: string, init: RequestInit) => Promise<Response>
export type StructuredUsage = z.infer<typeof UsageSchema>
export type StructuredDialect = "responses" | "responses-reduced" | "chat-json-schema" | "chat-json-object" | "chat-plain"

export type StructuredRequest = {
  baseUrl?: string
  apiKey: string
  model: string
  instructions: string
  /** The user payload, already serialized by the caller. */
  input: string
  /** Pictures for the model to look at, as data URLs, sent after the text. A model that cannot take them fails with NO_VISION. */
  images?: readonly string[]
  schemaName: string
  schema: unknown
  maxOutputTokens: number
  /**
   * How hard a thinking model should think. Left out: the Responses route asks for the policy's effort and Chat Completions asks for nothing (the
   * service's own default). "low" is asked for on both routes, through the parameter each route defines (`reasoning.effort`, `reasoning_effort`).
   */
  reasoningEffort?: "low"
  streaming: boolean
  signal: AbortSignal
  /** "strict" keeps the modeling service's full envelope checks and requires usage from the Responses API. */
  envelope: "strict" | "lenient"
  transport?: StructuredTransport
  /** Throws when the parsed object is unacceptable; the message is sent back to the model on a repair retry. */
  validate?: (value: unknown) => void
  /** Lets the caller's attempt budget veto the single repair retry. */
  canRepair?: () => boolean
  /** Called once per model attempt, not per dialect probe, with the first body that will be sent. */
  onAttempt?: (body: string, attempt: { repair: boolean }) => void
  /** Called before the output is inspected so a usage budget is enforced even for unusable output. */
  onUsage?: (usage: StructuredUsage | undefined) => void
  onProgress?: (event: ModelProgressEvent) => void | Promise<void>
  onText?: (text: string) => void
  onRead?: (value: ModelResponseDiagnostics) => void | Promise<void>
  onResponse?: (value: unknown) => void | Promise<void>
}

export type StructuredResult = {
  value: unknown
  text: string
  /** The model name the provider echoed, when it echoed one. */
  model?: string
  responseId?: string
  usage?: StructuredUsage
  dialect: StructuredDialect
  repaired: boolean
}

type TokenParameter = "max_output_tokens" | "max_tokens" | "max_completion_tokens" | "none"
type Variant = {
  api: "responses" | "chat"
  format: "json_schema" | "json_object" | "none"
  reasoning: boolean
  store: boolean
  tokens: TokenParameter
  tokenLimit: number | null
  flipStream: boolean
  streamUsage: boolean
  /** Chat Completions only: whether `reasoning_effort` may be sent when a request asks for one. */
  effort: boolean
}
type Provider = ReturnType<typeof responsesConfig>
type Evidence = { kind: "route" } | { kind: "parameter"; message: string }
type RepairTurn = { reply: string; message: string }
type Completion = { text: string; model?: string; responseId?: string; usage?: StructuredUsage }

const TEXT_LIMIT = 2097152
const STREAM_LIMIT = 16777216
const ERROR_BODY_LIMIT = 65536
const MAX_PROBES = 12

const dialects = new Map<string, Variant>()
let sharedTransport: ReturnType<typeof createTimedModelingTransport> | undefined
const defaultTransport: StructuredTransport = (url, init) => (sharedTransport ??= createTimedModelingTransport()).fetch(url, init)

/** Test hook; production keeps negotiated dialects for the process lifetime. */
export function clearDialectCache() {
  dialects.clear()
}

const cacheKey = (provider: Provider, model: string) => `${provider.base}\n${model}`
const responsesVariant = (provider: Provider): Variant => ({ api: "responses", format: "json_schema", reasoning: true, store: true, tokens: provider.codex ? "none" : "max_output_tokens", tokenLimit: null, flipStream: false, streamUsage: false, effort: false })
const chatVariant = (): Variant => ({ api: "chat", format: "json_schema", reasoning: false, store: false, tokens: "max_tokens", tokenLimit: null, flipStream: false, streamUsage: true, effort: true })

function dialectName(variant: Variant, provider: Provider): StructuredDialect {
  if (variant.api === "chat") return variant.format === "json_schema" ? "chat-json-schema" : variant.format === "json_object" ? "chat-json-object" : "chat-plain"
  return JSON.stringify(variant) === JSON.stringify(responsesVariant(provider)) ? "responses" : "responses-reduced"
}

const abortError = (signal: AbortSignal) => new ModelingError(signal.reason?.name === "TimeoutError" ? "TIMEOUT" : "CANCELLED")

/** 400 and 422 mean the service was reached and read the request, then turned it down: not a network problem, and not one a retry cures. */
const statusError = (status: number) =>
  new ModelingError(status === 401 || status === 403 ? "UNAUTHORIZED" : status === 429 ? "BUDGET_EXCEEDED" : status === 400 || status === 422 ? "REQUEST_REJECTED" : "UPSTREAM_UNAVAILABLE")

/** True when an error message names the parameter as a whole word, so `stream` never matches `stream_options`. */
function names(message: string, parameter: string) {
  return new RegExp(`(^|[^a-z0-9_])${parameter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9_]|$)`).test(message)
}

/**
 * A complaint about the structured-output request itself. Services often name only the schema they were sent ("Required properties must match all
 * properties in the object", "'minLength' is not permitted in schema"), not the parameter that carried it; dropping to a looser format is safe
 * either way, because every answer is checked against the caller's own schema after it arrives.
 */
const namesStructuredOutput = (message: string) =>
  ["text.format", "response_format", "json_schema", "json_object", "response format", "json schema", "json mode", "structured output", "structured outputs", "schema", "required properties", "additionalproperties", "additional properties"].some((name) => names(message, name)) ||
  /(unknown|unsupported|unrecognized|not supported)[^.]*['"`]text['"`]/.test(message)

/** Providers state their ceiling in several shapes: "[1, 8192]", "at most 16384", "<= 4096". */
function statedTokenLimit(message: string, current: number) {
  const match = message.match(/\[\s*\d+\s*,\s*(\d+)\s*\]/) ?? message.match(/(?:<=|≤|at most|up to|less than or equal to|maximum(?: value)?(?: is| of)?)\s*(\d+)/)
  const limit = match ? Number(match[1]) : Number.NaN
  return Number.isInteger(limit) && limit >= 1 && limit < current ? limit : null
}

async function boundedText(response: Response, limit: number) {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (bytes < limit) {
      const chunk = await reader.read()
      if (chunk.done) break
      chunks.push(chunk.value)
      bytes += chunk.value.byteLength
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return Buffer.concat(chunks).subarray(0, limit).toString("utf8")
}

/**
 * Only an explicit "this route or parameter is unsupported" answer counts as evidence.
 * Authentication, quota, server and network failures are real errors and never trigger a fallback.
 */
async function unsupportedEvidence(response: Response): Promise<Evidence | null> {
  if (routeMissing(response.status)) {
    await response.body?.cancel().catch(() => undefined)
    return { kind: "route" }
  }
  if (response.status === 400 || response.status === 422) {
    const message = await boundedText(response, ERROR_BODY_LIMIT).catch(() => "")
    return { kind: "parameter", message: message.toLowerCase() }
  }
  await response.body?.cancel().catch(() => undefined)
  return null
}

function nextTokens(variant: Variant, message: string, requested: number): Variant {
  const limit = statedTokenLimit(message, variant.tokenLimit ?? requested)
  if (limit !== null) return { ...variant, tokenLimit: limit }
  if (variant.tokens === "max_tokens") return { ...variant, tokens: "max_completion_tokens", tokenLimit: null }
  return { ...variant, tokens: "none", tokenLimit: null }
}

/** Returns the next variant to try, or null when the evidence does not point at anything this variant sends. */
function downgrade(variant: Variant, evidence: Evidence, provider: Provider, maxOutputTokens: number): Variant | null {
  if (evidence.kind === "route") return variant.api === "responses" && !provider.codex ? chatVariant() : null
  const message = evidence.message
  if (variant.api === "responses") {
    if (variant.reasoning && (names(message, "reasoning") || names(message, "reasoning_effort"))) return { ...variant, reasoning: false }
    if (variant.tokens !== "none" && names(message, variant.tokens)) return { ...variant, tokens: "none" }
    if (variant.store && names(message, "store")) return { ...variant, store: false }
    if (!variant.flipStream && !provider.codex && names(message, "stream")) return { ...variant, flipStream: true }
    if (!provider.codex && namesStructuredOutput(message)) return chatVariant()
    return null
  }
  if (variant.streamUsage && names(message, "stream_options")) return { ...variant, streamUsage: false }
  if (variant.effort && names(message, "reasoning_effort")) return { ...variant, effort: false }
  // Older servers reject an oversized completion budget without naming the parameter.
  if (variant.tokens !== "none" && (names(message, variant.tokens) || message.includes("maximum context length"))) return nextTokens(variant, message, maxOutputTokens)
  if (variant.format !== "none" && namesStructuredOutput(message)) return { ...variant, format: variant.format === "json_schema" ? "json_object" : "none" }
  if (!variant.flipStream && names(message, "stream")) return { ...variant, flipStream: true }
  return null
}

const schemaPrompt = (schema: unknown) =>
  `Respond with a single JSON object only: no prose, no markdown, no code fences. The object must validate against this JSON Schema:\n${JSON.stringify(schema)}`

function responsesBody(request: StructuredRequest, provider: Provider, variant: Variant, repair?: RepairTurn) {
  const parameters: Record<string, unknown> = { ...provider.parameters }
  if (variant.tokens === "none") delete parameters.max_output_tokens
  if (!variant.store) delete parameters.store
  if (variant.flipStream) parameters.stream = !parameters.stream
  // Key order is part of the contract: the default variant must serialize exactly as it always has.
  return {
    model: request.model,
    ...(variant.reasoning ? { reasoning: { effort: request.reasoningEffort ?? MODEL_POLICY.reasoningEffort } } : {}),
    instructions: request.instructions,
    input: [
      { role: "user", content: [{ type: "input_text", text: request.input }, ...(request.images ?? []).map((url) => ({ type: "input_image", image_url: url }))] },
      ...(repair
        ? [
            { role: "assistant", content: [{ type: "output_text", text: repair.reply }] },
            { role: "user", content: [{ type: "input_text", text: `${repair.message}\n\n${schemaPrompt(request.schema)}` }] },
          ]
        : []),
    ],
    text: { format: { type: "json_schema", name: request.schemaName, strict: true, schema: strictSchema(request.schema) } },
    ...parameters,
  }
}

function chatBody(request: StructuredRequest, variant: Variant, repair?: RepairTurn) {
  const enforced = variant.format === "json_schema"
  const stream = variant.flipStream ? !request.streaming : request.streaming
  return {
    model: request.model,
    messages: [
      { role: "system", content: enforced ? request.instructions : `${request.instructions}\n\n${schemaPrompt(request.schema)}` },
      { role: "user", content: request.images?.length ? [{ type: "text", text: request.input }, ...request.images.map((url) => ({ type: "image_url", image_url: { url } }))] : request.input },
      ...(repair
        ? [
            { role: "assistant", content: repair.reply },
            // An endpoint may accept json_schema without enforcing it, so the repair turn restates the schema.
            { role: "user", content: enforced ? `${repair.message}\n\n${schemaPrompt(request.schema)}` : repair.message },
          ]
        : []),
    ],
    ...(enforced ? { response_format: { type: "json_schema", json_schema: { name: request.schemaName, strict: true, schema: strictSchema(request.schema) } } } : {}),
    ...(variant.format === "json_object" ? { response_format: { type: "json_object" } } : {}),
    ...(variant.tokens === "none" ? {} : { [variant.tokens]: variant.tokenLimit ?? request.maxOutputTokens }),
    ...(variant.effort && request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
    stream,
    ...(stream && variant.streamUsage ? { stream_options: { include_usage: true } } : {}),
  }
}

function post(request: Pick<StructuredRequest, "apiKey" | "signal" | "transport">, url: string, body: string) {
  return (request.transport ?? defaultTransport)(url, {
    method: "POST",
    redirect: "error",
    signal: request.signal,
    headers: { Authorization: `Bearer ${request.apiKey.trim()}`, "Content-Type": "application/json" },
    body,
  })
}

/** An endpoint saying it cannot take the pictures it was sent, as opposed to any other parameter it dislikes. */
const namesPictures = (message: string) => /image|vision|multimodal|multi-modal/.test(message)

/** Sends one model attempt, walking down the dialect ladder only on explicit "unsupported" evidence. */
async function send(request: StructuredRequest, provider: Provider, repair?: RepairTurn) {
  const key = cacheKey(provider, request.model)
  let cached = dialects.get(key)
  let variant = cached ?? responsesVariant(provider)
  let announced = false
  for (let probe = 0; probe < MAX_PROBES; probe += 1) {
    if (request.signal.aborted) throw abortError(request.signal)
    const body = JSON.stringify(variant.api === "chat" ? chatBody(request, variant, repair) : responsesBody(request, provider, variant, repair))
    if (!announced) request.onAttempt?.(body, { repair: Boolean(repair) })
    announced = true
    const response = await post(request, variant.api === "chat" ? provider.chatEndpoint : provider.endpoint, body)
    if (response.ok) {
      dialects.set(key, variant)
      return { response, variant }
    }
    const evidence = await unsupportedEvidence(response)
    // Pictures the Responses route will not take may still be taken by Chat Completions; refused there too, the model cannot see.
    const blind = Boolean(request.images?.length) && evidence?.kind === "parameter" && namesPictures(evidence.message)
    if (blind && (variant.api === "chat" || provider.codex)) throw new ModelingError("NO_VISION")
    const next = blind ? chatVariant() : evidence ? downgrade(variant, evidence, provider, request.maxOutputTokens) : null
    if (cached && (next || evidence?.kind === "route")) {
      // The remembered dialect stopped working; forget it and negotiate again from the top.
      dialects.delete(key)
      cached = undefined
      const initial = responsesVariant(provider)
      if (JSON.stringify(variant) !== JSON.stringify(initial)) {
        variant = initial
        continue
      }
    }
    if (!next) throw statusError(response.status)
    variant = next
  }
  throw new ModelingError("UPSTREAM_UNAVAILABLE")
}

function chatUsage(value: unknown): StructuredUsage | undefined {
  const usage = z.object({ prompt_tokens: z.number().int().min(0), completion_tokens: z.number().int().min(0) }).safeParse(value)
  if (!usage.success) return undefined
  // Providers disagree on whether total_tokens includes reasoning or cached tokens; the sum is what the budget needs.
  return { input_tokens: usage.data.prompt_tokens, output_tokens: usage.data.completion_tokens, total_tokens: usage.data.prompt_tokens + usage.data.completion_tokens }
}

/** Drops `<think>` blocks, a block that is still open mid-stream, and a lone closing tag ahead of the answer. */
function withoutReasoning(text: string) {
  const visible = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").replace(/<think(?:ing)?>[\s\S]*$/i, "")
  if (/^\s*[{`]/.test(visible)) return visible
  // Some reasoning models emit only the closing tag.
  const orphan = visible.match(/^[\s\S]*?<\/think(?:ing)?>/i)
  return orphan ? visible.slice(orphan[0].length) : visible
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value)

const tryParseObject = (text: string): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(text)
    return isObject(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** End index of the balanced object opening at `start`, or -1 when it never closes. */
function objectEnd(text: string, start: number) {
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    if (character === "{") depth += 1
    if (character === "}" && --depth === 0) return index
  }
  return -1
}

/** Recovers the JSON object from replies that wrap it in reasoning tags, code fences or prose. */
export function extractJsonObject(text: string): Record<string, unknown> {
  const visible = withoutReasoning(text).trim()
  const direct = tryParseObject(visible)
  if (direct) return direct
  for (const fence of visible.matchAll(/```[a-z0-9_-]*\s*([\s\S]*?)```/gi)) {
    const fenced = tryParseObject(fence[1].trim())
    if (fenced) return fenced
  }
  let start = visible.indexOf("{")
  for (let candidates = 0; start >= 0 && candidates < 64; candidates += 1) {
    const end = objectEnd(visible, start)
    const embedded = end < 0 ? undefined : tryParseObject(visible.slice(start, end + 1))
    if (embedded) return embedded
    start = visible.indexOf("{", start + 1)
  }
  throw new ModelingError("INVALID_OUTPUT")
}

const ChatContentSchema = z.union([z.string(), z.array(z.object({ text: z.string().optional() }).passthrough())]).nullish()
const ChatBodySchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    error: z.unknown().optional(),
    usage: z.unknown().optional(),
    choices: z.array(z.object({ finish_reason: z.string().nullish(), message: z.object({ content: ChatContentSchema, refusal: z.string().nullish() }).passthrough() }).passthrough()).min(1),
  })
  .passthrough()
const ChatChunkSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    error: z.unknown().optional(),
    usage: z.unknown().optional(),
    choices: z.array(z.object({ index: z.number().optional(), finish_reason: z.string().nullish(), delta: z.object({ content: z.string().nullish(), refusal: z.string().nullish() }).passthrough().nullish() }).passthrough()).nullish(),
  })
  .passthrough()

function assertFinished(finish: string | null | undefined, refusal: string | null | undefined) {
  if (refusal?.trim() || finish === "content_filter") throw new ModelingError("REFUSED")
  if (finish === "length") throw new ModelingError("INCOMPLETE_OUTPUT")
}

/** Reads a streamed or plain Chat Completions body under the same byte limits as the Responses reader. */
async function readChatCompletion(response: Response, request: StructuredRequest, expectedStream: boolean): Promise<Completion & { raw: unknown }> {
  const reader = response.body?.getReader()
  if (!reader) throw new ModelingError("INVALID_OUTPUT")
  const signal = request.signal
  const contentType = response.headers.get("content-type")?.toLowerCase()
  const streaming = Boolean(contentType?.includes("text/event-stream") || (expectedStream && !contentType?.includes("application/json")))
  const decoder = new TextDecoder("utf-8", { fatal: true })
  const encoder = new TextEncoder()
  const state = { bytes: 0, textBytes: 0, events: 0, pending: "", json: "", text: "", refusal: "", started: false, done: false, finish: undefined as string | undefined, id: undefined as string | undefined, model: undefined as string | undefined, usage: undefined as unknown }
  const checkCancelled = () => {
    if (signal.aborted) throw abortError(signal)
  }
  const progress = createDesignProgress(request.onProgress, signal, checkCancelled)
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener("abort", cancel, { once: true })
  const consume = async (record: string) => {
    checkCancelled()
    const data = record.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n")
    if (!data) return
    if (data === "[DONE]") {
      state.done = true
      return
    }
    state.events += 1
    const chunk = ChatChunkSchema.safeParse(tryParseObject(data))
    if (!chunk.success) throw new ModelingError("INVALID_OUTPUT")
    if (chunk.data.error != null) throw new ModelingError("UPSTREAM_UNAVAILABLE")
    state.id ??= chunk.data.id
    state.model ??= chunk.data.model
    if (chunk.data.usage != null) state.usage = chunk.data.usage
    const choice = chunk.data.choices?.find((item) => (item.index ?? 0) === 0)
    if (!choice) return
    if (!state.started) {
      state.started = true
      await progress.reset()
    }
    state.refusal += choice.delta?.refusal ?? ""
    if (choice.finish_reason) state.finish = choice.finish_reason
    const delta = choice.delta?.content ?? ""
    if (!delta) return
    state.textBytes += encoder.encode(delta).byteLength
    if (state.textBytes > TEXT_LIMIT) throw new ModelingError("INVALID_OUTPUT")
    state.text += delta
    const visible = withoutReasoning(state.text)
    await progress.text(visible)
    if (visible.trim() && !signal.aborted) request.onText?.(visible)
  }
  try {
    checkCancelled()
    while (true) {
      const chunk = await reader.read()
      checkCancelled()
      if (chunk.done) break
      state.bytes += chunk.value.byteLength
      if (state.bytes > (streaming ? STREAM_LIMIT : TEXT_LIMIT)) throw new ModelingError("INVALID_OUTPUT")
      const text = decoder.decode(chunk.value, { stream: true })
      if (!streaming) { state.json += text; continue }
      state.pending += text
      const records = state.pending.split(/\r?\n\r?\n/)
      state.pending = records.pop() ?? ""
      for (const record of records) await consume(record)
    }
    const tail = decoder.decode()
    if (!streaming) {
      const body = ChatBodySchema.safeParse(tryParseObject(state.json + tail))
      if (!body.success) throw new ModelingError("INVALID_OUTPUT")
      if (body.data.error != null) throw new ModelingError("UPSTREAM_UNAVAILABLE")
      const choice = body.data.choices[0]
      assertFinished(choice.finish_reason, choice.message.refusal)
      const content = choice.message.content
      const text = typeof content === "string" ? content : (content ?? []).map((part) => part.text ?? "").join("")
      state.done = true
      return { text, model: body.data.model, responseId: body.data.id, usage: chatUsage(body.data.usage), raw: body.data }
    }
    if ((state.pending + tail).trim()) await consume(state.pending + tail)
    assertFinished(state.finish, state.refusal)
    // A stream that just stops, with neither a finish reason nor [DONE], was cut off.
    if (!state.finish && !state.done) throw new ModelingError("INCOMPLETE_OUTPUT")
    state.done = true
    return { text: state.text, model: state.model, responseId: state.id, usage: chatUsage(state.usage), raw: { id: state.id, model: state.model, usage: state.usage, choices: [{ finish_reason: state.finish, message: { role: "assistant", content: state.text } }] } }
  } catch (error) {
    state.done = false
    throw error
  } finally {
    signal.removeEventListener("abort", cancel)
    cancel()
    await Promise.resolve().then(() => request.onRead?.({ streaming, bytes: state.bytes, textBytes: state.textBytes, events: state.events, completed: state.done })).catch(() => undefined)
  }
}

const StrictResponseSchema = z.object({
  id: z.string().min(1).max(200),
  model: z.string().optional(),
  status: z.string(),
  error: z.unknown().optional(),
  incomplete_details: z.unknown().optional(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number(), total_tokens: z.number() }),
  output: z.array(z.object({ type: z.string(), role: z.string().optional(), status: z.string().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })),
})
const LenientResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  status: z.string(),
  usage: z.unknown().optional(),
  output: z.array(z.object({ type: z.string(), role: z.string().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })),
})

function assertEchoedModel(exact: boolean, requested: string, echoed: string | undefined) {
  // A pinned request with no echoed model cannot prove which model answered.
  if (exact && echoed === undefined) throw new ModelingError("INVALID_OUTPUT")
  if (exact && echoed !== requested) throw new ModelingError("MODEL_MISMATCH")
}

/** The modeling service's envelope: exactly one completed assistant message with one text part, and billed usage. */
function strictResponsesCompletion(raw: unknown, request: StructuredRequest, exact: boolean): Completion {
  const envelope = StrictResponseSchema.safeParse(raw)
  if (!envelope.success) throw new ModelingError("INVALID_OUTPUT")
  assertEchoedModel(exact, request.model, envelope.data.model)
  if (envelope.data.status !== "completed" || envelope.data.incomplete_details != null) throw new ModelingError("INCOMPLETE_OUTPUT")
  if (envelope.data.error != null) throw new ModelingError("UPSTREAM_UNAVAILABLE")
  const usage = UsageSchema.safeParse(envelope.data.usage)
  if (!usage.success) throw new ModelingError("INVALID_OUTPUT")
  request.onUsage?.(usage.data)
  const meaningful = envelope.data.output.filter((item) => {
    if (item.type !== "message" || item.role !== "assistant" || item.status !== "completed") return true
    const parts = item.content ?? []
    return !(parts.length > 0 && parts.every((part) => part.type === "output_text" && typeof part.text === "string" && part.text.trim() === ""))
  })
  const content = meaningful.flatMap((item) => item.content ?? [])
  if (content.some((item) => item.type === "refusal")) throw new ModelingError("REFUSED")
  const messages = meaningful.filter((item) => item.type === "message")
  if (messages.length !== 1 || messages[0].role !== "assistant" || messages[0].status !== "completed" || content.length !== 1 || content[0].type !== "output_text" || !content[0].text)
    throw new ModelingError("INVALID_OUTPUT")
  return { text: content[0].text, model: envelope.data.model, responseId: envelope.data.id, usage: usage.data }
}

function lenientResponsesCompletion(raw: unknown, request: StructuredRequest, exact: boolean): Completion {
  const envelope = LenientResponseSchema.safeParse(raw)
  if (!envelope.success) throw new ModelingError("INVALID_OUTPUT")
  assertEchoedModel(exact, request.model, envelope.data.model)
  if (request.signal.aborted) throw abortError(request.signal)
  if (envelope.data.status !== "completed") throw new ModelingError("INCOMPLETE_OUTPUT")
  if (envelope.data.output.some((item) => item.content?.some((part) => part.type === "refusal"))) throw new ModelingError("REFUSED")
  const usage = UsageSchema.safeParse(envelope.data.usage)
  request.onUsage?.(usage.success ? usage.data : undefined)
  const outputs = envelope.data.output
    .filter((item) => item.type === "message" && item.role === "assistant")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && part.text?.trim())
  if (outputs.length !== 1) throw new ModelingError("INVALID_OUTPUT")
  return { text: outputs[0].text!, model: envelope.data.model, responseId: envelope.data.id, usage: usage.success ? usage.data : undefined }
}

/**
 * A connection that breaks while asking or while the answer streams in ("other side closed", a truncated compressed body: r6) is the service being
 * unreachable for that moment, the same as a refused connection: UPSTREAM_UNAVAILABLE, which callers that retry treat as worth another try.
 * Cancellation and timeouts keep their own codes; ModelingErrors pass as they are.
 */
async function complete(request: StructuredRequest, provider: Provider, repair?: RepairTurn): Promise<Completion & { variant: Variant }> {
  try {
    return await completeOnce(request, provider, repair)
  } catch (error) {
    if (error instanceof ModelingError) throw error
    if (request.signal.aborted) throw abortError(request.signal)
    throw new ModelingError("UPSTREAM_UNAVAILABLE")
  }
}

async function completeOnce(request: StructuredRequest, provider: Provider, repair?: RepairTurn): Promise<Completion & { variant: Variant }> {
  const { response, variant } = await send(request, provider, repair)
  const exact = requiresExactModel(provider.endpoint, request.model)
  const notify = (raw: unknown) => Promise.resolve().then(() => request.onResponse?.(raw)).catch(() => undefined)
  if (variant.api === "responses") {
    const raw = await readModelResponse(response, request.onProgress, request.signal, provider.codex, request.onRead, exact ? request.model : null, request.onText)
    await notify(raw)
    return { ...(request.envelope === "strict" ? strictResponsesCompletion(raw, request, exact) : lenientResponsesCompletion(raw, request, exact)), variant }
  }
  const chat = await readChatCompletion(response, request, variant.flipStream ? !request.streaming : request.streaming)
  await notify(chat.raw)
  assertEchoedModel(exact, request.model, chat.model)
  request.onUsage?.(chat.usage)
  return { text: chat.text, model: chat.model, responseId: chat.responseId, usage: chat.usage, variant }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 4000)

/**
 * An endpoint may accept json_schema without enforcing it (Chat Completions often; r5: DeepSeek's Responses route answered with a fenced object and
 * with bare script), so every reply is parsed leniently and may earn one repair turn. Only the modeling service's strict envelope keeps exact parsing.
 */
function parse(request: StructuredRequest, completion: Completion & { variant: Variant }) {
  if (completion.variant.api === "responses" && request.envelope === "strict") {
    const value: unknown = (() => {
      try { return fromStrict(JSON.parse(completion.text), request.schema) } catch { throw new ModelingError("INVALID_OUTPUT") }
    })()
    try { request.validate?.(value) } catch { throw new ModelingError("INVALID_OUTPUT") }
    return { value }
  }
  const value = (() => {
    try { return fromStrict(extractJsonObject(completion.text), request.schema) } catch { return undefined }
  })()
  if (!value) return { failure: "The reply did not contain one parseable JSON object." }
  try { request.validate?.(value) } catch (error) { return { failure: describe(error) } }
  return { value }
}

/**
 * Obtains one schema-shaped JSON object from the configured endpoint and model.
 * The dialect that works is negotiated once per endpoint and model, then remembered.
 */
export async function requestStructured(request: StructuredRequest): Promise<StructuredResult> {
  const provider = responsesConfig(request.baseUrl, request.maxOutputTokens, request.streaming)
  const finish = (completion: Completion & { variant: Variant }, value: unknown, repaired: boolean): StructuredResult => {
    if (request.signal.aborted) throw abortError(request.signal)
    return { value, text: completion.text, model: completion.model, responseId: completion.responseId, usage: completion.usage, dialect: dialectName(completion.variant, provider), repaired }
  }
  const first = await complete(request, provider)
  const parsed = parse(request, first)
  if (!parsed.failure) return finish(first, parsed.value, false)
  if (request.canRepair && !request.canRepair()) throw new ModelingError("INVALID_OUTPUT")
  const second = await complete(request, provider, {
    reply: withoutReasoning(first.text).trim().slice(0, 20000) || "(empty reply)",
    message: `Your previous reply was rejected: ${parsed.failure}\nReply again with the complete corrected JSON object only.`,
  })
  const repaired = parse(request, second)
  if (repaired.failure) throw new ModelingError("INVALID_OUTPUT")
  return finish(second, repaired.value, true)
}

/** Output allowance of a connection check: enough for a plain model to say a word, cheap either way. */
export const PROBE_TOKENS = 16
const ProbeResponsesSchema = z.object({ model: z.string().optional(), status: z.string() })
const ProbeChatSchema = z.object({ model: z.string().optional(), choices: z.array(z.unknown()).min(1) })

const acceptsEcho = (requested: string, echoed: string) =>
  echoed === requested || (echoed.startsWith(`${requested}-`) && /^\d{4}-\d{2}-\d{2}$/.test(echoed.slice(requested.length + 1)))

/**
 * Connection check: succeeds when either the Responses or the Chat Completions route answers a minimal request.
 * It does not exercise structured output; that is negotiated on the first real request.
 */
export async function probeConnection(options: { baseUrl?: string; apiKey: string; model: string; signal: AbortSignal; transport?: StructuredTransport }) {
  // The same small allowance as the chat probe below. A reasoning model may spend all of it thinking; that answer still proves the route, key and model.
  const provider = responsesConfig(options.baseUrl, PROBE_TOKENS, false)
  const exact = requiresExactModel(provider.endpoint, options.model)
  const echoed = (model: string | undefined) => {
    if (exact && (model === undefined || !acceptsEcho(options.model, model))) throw new ModelingError("MODEL_MISMATCH")
    return model?.trim() ? model.trim().slice(0, 120) : options.model
  }
  let variant: Variant = { ...responsesVariant(provider), reasoning: false }
  for (let probe = 0; probe < MAX_PROBES; probe += 1) {
    const parameters: Record<string, unknown> = { ...provider.parameters }
    if (variant.tokens === "none") delete parameters.max_output_tokens
    if (!variant.store) delete parameters.store
    const body = variant.api === "responses"
      ? { model: options.model, input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }], ...parameters }
      : { model: options.model, messages: [{ role: "user", content: "ping" }], ...(variant.tokens === "none" ? {} : { [variant.tokens]: variant.tokenLimit ?? PROBE_TOKENS }), stream: false }
    const response = await post(options, variant.api === "responses" ? provider.endpoint : provider.chatEndpoint, JSON.stringify(body))
    if (!response.ok) {
      const evidence = await unsupportedEvidence(response)
      const next = evidence ? downgrade({ ...variant, format: "none", flipStream: true, streamUsage: false }, evidence, provider, PROBE_TOKENS) : null
      if (!next) throw statusError(response.status)
      variant = next
      continue
    }
    const text = await boundedText(response, TEXT_LIMIT)
    if (variant.api === "chat") {
      const result = ProbeChatSchema.safeParse(tryParseObject(text))
      if (!result.success) throw new ModelingError("INVALID_OUTPUT")
      const key = cacheKey(provider, options.model)
      // Saves the first real request a wasted round trip to the missing Responses route.
      if (!dialects.has(key)) dialects.set(key, chatVariant())
      return { model: echoed(result.data.model), status: "completed", api: "chat" as const }
    }
    const result = ProbeResponsesSchema.safeParse(tryParseObject(text))
    // The Codex route only streams; a successful event stream is the whole answer it can give here.
    if (!result.success && provider.codex) return { model: options.model, status: "completed", api: "responses" as const }
    if (!result.success) throw new ModelingError("INVALID_OUTPUT")
    const model = echoed(result.data.model)
    // A connection check asks whether the route, the key and the model answer, not whether a word of reply fit in the allowance: an answer cut short
    // ("incomplete", e.g. a reasoning model thinking past PROBE_TOKENS) is still an answer. Only one the service itself calls failed is not.
    if (result.data.status === "failed") throw new ModelingError("UPSTREAM_UNAVAILABLE")
    return { model, status: result.data.status, api: "responses" as const }
  }
  throw new ModelingError("UPSTREAM_UNAVAILABLE")
}

// A 64×64 plain red PNG: small enough to cost nothing, plain enough that any model that sees it can name it.
const RED_SQUARE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAoklEQVR4nO3RQQ0AIBADQUScf2V4ARlDwj7m33TXnjk/W3qA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gH7gQrSBZHxMeGqg/HiAAAAAElFTkSuQmCC"
const SEEN = ["red", "green", "blue", "yellow", "black", "white", "no_picture"] as const

/**
 * Whether the configured model really sees pictures: it is shown a red square and asked to pick its colour
 * from a short list that also offers "no picture came". "no" when the endpoint refuses pictures or the
 * answer is anything but red; "unknown" when the question could not be asked at all (the connection is
 * then the problem, not the model's eyes).
 */
export async function probeVision(options: { baseUrl?: string; apiKey: string; model: string; signal: AbortSignal; transport?: StructuredTransport }): Promise<"yes" | "no" | "unknown"> {
  return requestStructured({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model,
    instructions: "Answer with the JSON object only. If no picture reached you, answer no_picture; never guess.",
    input: "One picture is attached. What single colour fills it?",
    images: [RED_SQUARE],
    schemaName: "minemods_colour_check",
    schema: { type: "object", additionalProperties: false, required: ["colour"], properties: { colour: { type: "string", enum: SEEN } } },
    maxOutputTokens: 2048,
    streaming: false,
    signal: options.signal,
    envelope: "lenient",
    transport: options.transport,
  }).then(
    (result) => (isObject(result.value) && result.value.colour === "red" ? ("yes" as const) : ("no" as const)),
    (error: unknown) => (error instanceof ModelingError && error.code === "NO_VISION" ? ("no" as const) : ("unknown" as const)),
  )
}
