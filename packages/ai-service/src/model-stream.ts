import { z } from "zod"
import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import { MODEL_POLICY, ModelingError } from "@minemods/studio-ai/policy"
import { createModelingRequester } from "./openai"

export type ModelProgressEvent =
  | { type: "reset"; sequence: number; phase: "stream" }
  | { type: "bone"; index: number; value: ModelDesign["bones"][number]; sequence: number; phase: "stream" }
  | { type: "cube"; boneIndex: number; index: number; value: ModelDesign["bones"][number]["cubes"][number]; sequence: number; phase: "stream" }
  | { type: "animation"; index: number; value: ModelDesign["animations"][number]; sequence: number; phase: "stream" }

export type ModelResponseDiagnostics = { streaming: boolean; bytes: number; textBytes: number; events: number; completed: boolean }

/** This alias shares the production requester's single budget, deadline and repair path. */
export function createModelStreamingRequester(options: Parameters<typeof createModelingRequester>[0] = {}) {
  return createModelingRequester({ ...options, onProgress: options?.onProgress ?? (() => undefined) })
}

function arrayStart(text: string, key: string) {
  let depth = 0
  let quoted = false
  let escaped = false
  let start = -1
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (escaped) { escaped = false; continue }
      if (character === "\\") { escaped = true; continue }
      if (character !== '"') continue
      quoted = false
      if (depth === 1 && text.slice(start + 1, index) === key) {
        const suffix = text.slice(index + 1).match(/^\s*:\s*\[/)
        if (suffix) return index + suffix[0].length
      }
      continue
    }
    if (character === '"') { quoted = true; start = index }
    if (character === "{" || character === "[") depth += 1
    if (character === "}" || character === "]") depth -= 1
  }
  return -1
}

function closedObjects(text: string, key: string) {
  const open = arrayStart(text, key)
  if (open < 0) return []
  const result: string[] = []
  let depth = 0
  let quoted = false
  let escaped = false
  let start = -1
  for (let index = open + 1; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') { quoted = true; continue }
    if (character === "]" && depth === 0) break
    if (character === "{" && depth++ === 0) start = index
    if (character === "}" && --depth === 0 && start >= 0) result.push(text.slice(start, index + 1))
  }
  return result
}

const parseJson = (value: string): unknown => {
  try { return JSON.parse(value) } catch { throw new ModelingError("INVALID_OUTPUT") }
}

const OutputItemSchema = z.object({ id: z.string().min(1), type: z.string(), status: z.string().optional(), role: z.string().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional() }).passthrough()

/** Emits each closed, schema-valid bone, cube and animation once as the design text grows. */
export function createDesignProgress(onProgress: ((event: ModelProgressEvent) => void | Promise<void>) | undefined, signal: AbortSignal | undefined, checkCancelled: () => void) {
  const state = { sequence: 0, bones: 0, animations: 0 }
  return {
    async reset() {
      if (!signal?.aborted) await onProgress?.({ type: "reset", sequence: ++state.sequence, phase: "stream" })
    },
    async text(text: string) {
      if (!onProgress) return
      const bones = closedObjects(text, "bones")
      for (let index = state.bones; index < bones.length; index += 1) {
        const bone = ModelDesignSchema.shape.bones.element.safeParse(parseJson(bones[index]))
        if (!bone.success) continue
        if (signal?.aborted) return
        await onProgress({ type: "bone", index, value: bone.data, sequence: ++state.sequence, phase: "stream" })
        for (const [cubeIndex, cube] of bone.data.cubes.entries()) {
          checkCancelled()
          await onProgress({ type: "cube", boneIndex: index, index: cubeIndex, value: cube, sequence: ++state.sequence, phase: "stream" })
        }
      }
      state.bones = bones.length
      const animations = closedObjects(text, "animations")
      for (let index = state.animations; index < animations.length; index += 1) {
        const animation = ModelDesignSchema.shape.animations.element.safeParse(parseJson(animations[index]))
        if (animation.success && !signal?.aborted) await onProgress({ type: "animation", index, value: animation.data, sequence: ++state.sequence, phase: "stream" })
      }
      state.animations = animations.length
    },
  }
}

/**
 * Read transport only. The caller still validates the complete response and owns cancellation.
 * A null expectedModel skips the identity check for providers that echo aliases, snapshots or nothing.
 */
export async function readModelResponse(response: Response, onProgress?: (event: ModelProgressEvent) => void | Promise<void>, signal?: AbortSignal, expectedStream = false, onRead?: (value: ModelResponseDiagnostics) => void | Promise<void>, expectedModel: string | null = MODEL_POLICY.model, onText?: (text: string) => void): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new ModelingError("INVALID_OUTPUT")
  const contentType = response.headers.get("content-type")?.toLowerCase()
  const streaming = Boolean(contentType?.includes("text/event-stream") || expectedStream && !contentType?.includes("application/json"))
  const decoder = new TextDecoder("utf-8", { fatal: true })
  const encoder = new TextEncoder()
  const state = { bytes: 0, textBytes: 0, events: 0, pending: "", json: "", known: false, finished: false, completed: undefined as unknown }
  const texts = new Map<string, string>()
  const doneItems = new Map<number, z.infer<typeof OutputItemSchema>>()
  const checkCancelled = () => {
    if (signal?.aborted) throw new ModelingError(signal.reason?.name === "TimeoutError" ? "TIMEOUT" : "CANCELLED")
  }
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener("abort", cancel, { once: true })
  const progress = createDesignProgress(onProgress, signal, checkCancelled)
  const emit = async () => {
    if (!state.known || !onProgress) return
    const meaningful = [...texts.values()].filter(text => text.trim())
    if (meaningful.length === 1) await progress.text(meaningful[0])
  }
  const consume = async (record: string) => {
    checkCancelled()
    const data = record.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n")
    if (!data || data === "[DONE]") return
    if (state.finished) throw new ModelingError("INVALID_OUTPUT")
    state.events += 1
    const event = z.object({ type: z.string(), delta: z.string().optional(), output_index: z.number().int().nonnegative().optional(), content_index: z.number().int().nonnegative().optional(), response: z.unknown().optional(), item: z.unknown().optional() }).safeParse(parseJson(data))
    if (!event.success) throw new ModelingError("INVALID_OUTPUT")
    if (event.data.type.startsWith("response.refusal")) throw new ModelingError("REFUSED")
    if (event.data.type === "error" || event.data.type === "response.failed") throw new ModelingError("UPSTREAM_UNAVAILABLE")
    if (event.data.type === "response.incomplete") throw new ModelingError("INCOMPLETE_OUTPUT")
    if (event.data.type === "response.created") {
      const created = z.object({ model: z.string().optional() }).safeParse(event.data.response)
      if (!created.success || state.known) throw new ModelingError("INVALID_OUTPUT")
      if (expectedModel !== null && created.data.model === undefined) throw new ModelingError("INVALID_OUTPUT")
      if (expectedModel !== null && created.data.model !== expectedModel) throw new ModelingError("MODEL_MISMATCH")
      state.known = true
      await progress.reset()
      await emit()
    }
    if (event.data.type === "response.output_text.delta") {
      state.textBytes += encoder.encode(event.data.delta ?? "").byteLength
      if (state.textBytes > 2097152) throw new ModelingError("INVALID_OUTPUT")
      const key = `${event.data.output_index ?? 0}:${event.data.content_index ?? 0}`
      texts.set(key, (texts.get(key) ?? "") + (event.data.delta ?? ""))
      await emit()
      if (state.known && texts.size === 1 && !signal?.aborted) onText?.([...texts.values()][0])
    }
    if (expectedStream && event.data.type === "response.output_item.done") {
      const item = OutputItemSchema.safeParse(event.data.item)
      const index = event.data.output_index
      if (!item.success || index === undefined || index >= 64 || doneItems.has(index)) throw new ModelingError("INVALID_OUTPUT")
      if (item.data.type === "message" && (item.data.status !== "completed" || item.data.role !== "assistant")) throw new ModelingError("INVALID_OUTPUT")
      doneItems.set(index, item.data)
    }
    if (event.data.type === "response.completed") {
      if (!state.known || state.completed) throw new ModelingError("INVALID_OUTPUT")
      state.finished = true
      state.completed = event.data.response
    }
  }
  try {
    checkCancelled()
    while (true) {
      const chunk = await reader.read()
      checkCancelled()
      if (chunk.done) break
      state.bytes += chunk.value.byteLength
      // Token-sized SSE events carry IDs and metadata in addition to the output.
      // Bound transport overhead separately; decoded model text retains its 2 MiB cap.
      if (state.bytes > (streaming ? 16777216 : 2097152)) throw new ModelingError("INVALID_OUTPUT")
      const text = decoder.decode(chunk.value, { stream: true })
      if (!streaming) { state.json += text; continue }
      state.pending += text
      const records = state.pending.split(/\r?\n\r?\n/)
      state.pending = records.pop() ?? ""
      for (const record of records) await consume(record)
    }
    const tail = decoder.decode()
    if (!streaming) return parseJson(state.json + tail)
    if ((state.pending + tail).trim()) await consume(state.pending + tail)
    if (!state.completed) throw new ModelingError("INCOMPLETE_OUTPUT")
    // Some Codex gateways leave completed.output empty. Only recover from explicit
    // completed item events; deltas alone never constitute an accepted response.
    const completion = z.object({ output: z.array(z.unknown()) }).passthrough().safeParse(state.completed)
    if (expectedStream && completion.success && completion.data.output.length === 0 && doneItems.size) {
      const ordered = [...doneItems.entries()].sort(([left], [right]) => left - right)
      if (ordered.some(([index], position) => index !== position)) throw new ModelingError("INVALID_OUTPUT")
      state.completed = { ...completion.data, output: ordered.map(([, item]) => item) }
    }
    const envelope = z.object({ output: z.array(z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })) }).safeParse(state.completed)
    if (!envelope.success) throw new ModelingError("INVALID_OUTPUT")
    const actual = envelope.data.output.flatMap(item => item.content ?? []).filter(item => item.type === "output_text" && item.text?.trim()).map(item => item.text)
    const streamed = [...texts.values()].filter(text => text.trim())
    if (actual.length !== streamed.length || actual.some((text, index) => text !== streamed[index])) throw new ModelingError("INVALID_OUTPUT")
    return state.completed
  } finally {
    signal?.removeEventListener("abort", cancel)
    cancel()
    await Promise.resolve().then(() => onRead?.({ streaming, bytes: state.bytes, textBytes: state.textBytes, events: state.events, completed: Boolean(state.completed) })).catch(() => undefined)
  }
}
