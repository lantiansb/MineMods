import { afterEach, expect, test } from "bun:test"
import { createModelingContext, createModelingRequester } from "../src/openai"
import { readModelResponse } from "../src/model-stream"
import { designFixture } from "../../studio-ai/test/fixture"

const servers: ReturnType<typeof Bun.serve>[] = []
afterEach(() => servers.splice(0).forEach((server) => server.stop(true)))

const input = { step: "model" as const, content: "Create a simple low-detail forest creature", revision: "r0" }
const context = () => createModelingContext({ userId: "developer", taskId: "stream_fixture", authorized: true, budget: { maxAttempts: 1, maxTotalTokens: 100000, maxOutputTokens: 8192 } })
const sse = (events: unknown[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")
const response = (design = designFixture()) => ({ id: "resp_stream", model: "gpt-6-astra", status: "completed", usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(design) }] }] })

test("accepts bounded token-by-token SSE metadata overhead without lowering the text limit", async () => {
  const text = JSON.stringify({ summary: "x".repeat(20000) })
  const completed = { model: "gpt-6-astra", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] }
  const body = sse([{ type: "response.created", response: { model: "gpt-6-astra" } }, ...Array.from(text).map(delta => ({ type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "msg_stream_overhead", obfuscation: "token_event_padding", delta })), { type: "response.completed", response: completed }])
  expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(2097152)
  await expect(readModelResponse(new Response(body, { headers: { "content-type": "text/event-stream" } }))).resolves.toEqual(completed)
  const oversized = sse([{ type: "response.created", response: { model: "gpt-6-astra" } }, { type: "response.output_text.delta", delta: "x".repeat(2097153) }, { type: "response.completed", response: completed }])
  await expect(readModelResponse(new Response(oversized, { headers: { "content-type": "text/event-stream" } }))).rejects.toThrow("INVALID_OUTPUT")
})

test("Codex backend omits unsupported token parameter and reads headerless SSE with fixed model validation", async () => {
  const request = createModelingRequester({ apiKey: "fixture-token", baseUrl: "https://example.com/backend-api/codex/", transport: async (url, init) => {
    expect(url).toBe("https://example.com/backend-api/codex/responses")
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe("gpt-6-astra")
    expect(body.reasoning.effort).toBe("high")
    expect(body.stream).toBe(true)
    expect(body.store).toBe(false)
    expect(body).not.toHaveProperty("max_output_tokens")
    return new Response(new TextEncoder().encode(sse([{ type: "response.created", response: { model: "gpt-6-astra" } }, { type: "response.output_text.delta", delta: JSON.stringify(designFixture()) }, { type: "response.completed", response: response() }])))
  } })
  await expect(request(input, context())).resolves.toMatchObject({ design: { name: "Mossling" }, usage: { total_tokens: 46 } })
})

test("a configured Codex gateway may echo another model name, which is recorded, while the default endpoint stays pinned", async () => {
  const completed = { ...response(), model: "gpt-5" }
  const body = () => new Response(new TextEncoder().encode(sse([{ type: "response.created", response: { model: "gpt-5" } }, { type: "response.output_text.delta", delta: JSON.stringify(designFixture()) }, { type: "response.completed", response: completed }])), { headers: { "content-type": "text/event-stream" } })
  const gateway = createModelingRequester({ apiKey: "fixture-token", baseUrl: "https://example.com/backend-api/codex", transport: async () => body() })
  await expect(gateway(input, context())).resolves.toMatchObject({ design: { name: "Mossling" }, provenance: { model: "gpt-5" } })
  const pinned = createModelingRequester({ apiKey: "fixture-token", transport: async () => body() })
  await expect(pinned(input, context())).rejects.toThrow("MODEL_MISMATCH")
})

test("Codex headerless stream still enforces the local output budget whatever model is echoed", async () => {
  for (const wrongModel of [true, false]) {
    const completed = { ...response(), model: wrongModel ? "gpt-5" : "gpt-6-astra", usage: { input_tokens: 12, output_tokens: 9000, total_tokens: 9012 } }
    const request = createModelingRequester({ apiKey: "fixture-token", baseUrl: "https://example.com/backend-api/codex", transport: async () => new Response(new TextEncoder().encode(sse([{ type: "response.created", response: { model: completed.model } }, { type: "response.output_text.delta", delta: JSON.stringify(designFixture()) }, { type: "response.completed", response: completed }]))) })
    await expect(request(input, context())).rejects.toThrow("BUDGET_EXCEEDED")
  }
})

test("Codex reconstructs an empty completion output only from matching completed item events", async () => {
  for (const variant of ["valid", "missing", "changed", "incomplete", "wrong-model", "standard", "late-items"] as const) {
    const item = { id: "msg_codex", ...response().output[0]!, status: variant === "incomplete" ? "in_progress" : "completed" }
    if (variant === "changed") item.content = [{ type: "output_text", text: JSON.stringify({ ...designFixture(), name: "Changed" }) }]
    const completed = { type: "response.completed", response: { ...response(), model: variant === "wrong-model" ? "gpt-5" : "gpt-6-astra", output: [] } }
    const body = sse([{ type: "response.created", response: { model: "gpt-6-astra" } }, ...(variant === "late-items" ? [completed] : []), { type: "response.output_text.delta", output_index: 0, delta: JSON.stringify(designFixture()) }, ...(variant === "missing" ? [] : [{ type: "response.output_item.done", output_index: 0, item }]), ...(variant === "late-items" ? [] : [completed])])
    const request = createModelingRequester({ apiKey: "fixture-token", baseUrl: variant === "standard" ? "https://example.com/v1" : "https://example.com/backend-api/codex", transport: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }) })
    // A configured gateway is not pinned to the echoed model name, so "wrong-model" reconstructs like "valid".
    if (variant === "valid" || variant === "wrong-model") {
      await expect(request(input, context())).resolves.toMatchObject({ design: { name: "Mossling" }, usage: { total_tokens: 46 } })
      continue
    }
    await expect(request(input, context())).rejects.toThrow("INVALID_OUTPUT")
  }
})

test("emits only closed validated bones, cubes, and animations while consuming real SSE deltas", async () => {
  const design = designFixture()
  const text = JSON.stringify(design)
  const events = [
    { type: "response.created", response: { model: "gpt-6-astra" } },
    { type: "response.output_text.delta", delta: text.slice(0, text.indexOf(JSON.stringify(design.bones[0])) + JSON.stringify(design.bones[0]).length) },
    { type: "response.output_text.delta", delta: text.slice(text.indexOf(JSON.stringify(design.bones[0])) + JSON.stringify(design.bones[0]).length) },
    { type: "response.completed", response: response(design) },
  ]
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(sse(events), { headers: { "content-type": "text/event-stream" } }) })
  servers.push(server)
  const progress: { type: string; index: number }[] = []
  let firstBone!: () => void
  const reachedBone = new Promise<void>(resolve => { firstBone = resolve })
  const request = createModelingRequester({ apiKey: "token", transport: async (_url, init) => fetch(new URL("/v1/responses", server.url), init), onProgress: (event) => { if (event.type !== "reset") { progress.push({ type: event.type, index: event.index }); if (event.type === "bone") firstBone() } } })
  const pending = request(input, context())
  await reachedBone
  expect(progress[0]?.type).toBe("bone")
  await expect(pending).resolves.toMatchObject({ design: { name: "Mossling" }, usage: { total_tokens: 46 } })
  expect(progress.some((event) => event.type === "bone")).toBe(true)
  expect(progress.some((event) => event.type === "cube")).toBe(true)
  expect(progress.some((event) => event.type === "animation")).toBe(true)
})

test("rejects a spoofed completed model and emits no successful draft", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(sse([{ type: "response.created", response: { model: "gpt-5" } }, { type: "response.output_text.delta", delta: JSON.stringify(designFixture()) }, { type: "response.completed", response: { ...response(), model: "gpt-5" } }]), { headers: { "content-type": "text/event-stream" } }) })
  servers.push(server)
  const progress: unknown[] = []
  const request = createModelingRequester({ apiKey: "token", transport: async (_url, init) => fetch(new URL("/v1/responses", server.url), init), onProgress: (event) => { progress.push(event) } })
  await expect(request(input, context())).rejects.toThrow("MODEL_MISMATCH")
  expect(progress).toHaveLength(0)
})

test("supports a non-stream JSON fixture with honest no-progress fallback", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json(response()) })
  servers.push(server)
  const progress: unknown[] = []
  const request = createModelingRequester({ apiKey: "token", transport: async (_url, init) => fetch(new URL("/v1/responses", server.url), init), onProgress: (event) => { progress.push(event) } })
  await expect(request(input, context())).resolves.toMatchObject({ design: { name: "Mossling" } })
  expect(progress).toHaveLength(0)
})

test("does not emit an invalid closed draft", async () => {
  const bad = JSON.stringify({ ...designFixture(), bones: [{ ...designFixture().bones[0], name: "" }] })
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(sse([{ type: "response.output_text.delta", delta: bad }, { type: "response.completed", response: response() }]), { headers: { "content-type": "text/event-stream" } }) })
  servers.push(server)
  const progress: unknown[] = []
  const request = createModelingRequester({ apiKey: "token", transport: async (_url, init) => fetch(new URL("/v1/responses", server.url), init), onProgress: (event) => { progress.push(event) } })
  await expect(request(input, context())).rejects.toThrow("INVALID_OUTPUT")
  expect(progress).toHaveLength(0)
})

test("keeps one budgeted schema repair and forwards diagnostics on the primary requester path", async () => {
  let calls = 0
  const invalid = structuredClone(designFixture())
  invalid.bones[0]!.name = ""
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => {
    calls += 1
    const value = calls === 1 ? invalid : designFixture()
    return new Response(sse([{ type: "response.created", response: { model: "gpt-6-astra" } }, { type: "response.output_text.delta", delta: JSON.stringify(value) }, { type: "response.completed", response: response(value) }]), { headers: { "content-type": "text/event-stream" } })
  } })
  servers.push(server)
  let repairs = 0
  const request = createModelingRequester({ apiKey: "token", transport: async (_url, init) => fetch(new URL("/v1/responses", server.url), init), onRepair: () => { repairs += 1 } })
  await expect(request(input, createModelingContext({ userId: "developer", taskId: "repair_stream", authorized: true, budget: { maxAttempts: 2, maxTotalTokens: 100000, maxOutputTokens: 8192 } }))).resolves.toMatchObject({ design: { name: "Mossling" } })
  expect(calls).toBe(2)
  expect(repairs).toBe(1)
})

test("rejects refusal and multiple streamed JSON texts without committing progress", async () => {
  for (const events of [
    [{ type: "response.created", response: { model: "gpt-6-astra" } }, { type: "response.refusal", refusal: "no" }],
    [{ type: "response.created", response: { model: "gpt-6-astra" } }, { type: "response.output_text.delta", output_index: 0, delta: JSON.stringify(designFixture()) }, { type: "response.output_text.delta", output_index: 1, delta: JSON.stringify(designFixture()) }, { type: "response.completed", response: response() }],
  ]) {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(sse(events), { headers: { "content-type": "text/event-stream" } }) })
    servers.push(server)
    const progress: unknown[] = []
    const request = createModelingRequester({ apiKey: "token", transport: async (_url, init) => fetch(new URL("/v1/responses", server.url), init), onProgress: event => { progress.push(event) } })
    await expect(request(input, context())).rejects.toThrow(events[1]!.type === "response.refusal" ? "REFUSED" : "INVALID_OUTPUT")
    if (events[1]!.type === "response.refusal") expect(progress.filter(value => (value as { type?: string }).type === "bone")).toHaveLength(0)
  }
})

test("cancels a hanging transport and does not retry it", async () => {
  const cancel = new AbortController()
  let calls = 0
  const request = createModelingRequester({ apiKey: "token", transport: async (_url, init) => {
    calls += 1
    await new Promise<void>(resolve => init.signal?.addEventListener("abort", () => resolve(), { once: true }))
    throw new Error("transport aborted")
  }, onProgress: () => undefined })
  const pending = request(input, createModelingContext({ userId: "developer", taskId: "cancel_stream", authorized: true, signal: cancel.signal, budget: { maxAttempts: 2, maxTotalTokens: 100000, maxOutputTokens: 8192 } }))
  cancel.abort()
  await expect(pending).rejects.toThrow("CANCELLED")
  expect(calls).toBe(1)
})

test("times out a hanging reader and cancels its underlying stream", async () => {
  let cancelled = false
  const request = createModelingRequester({ apiKey: "token", transport: async () => new Response(new ReadableStream({ pull: () => new Promise<void>(() => undefined), cancel: () => { cancelled = true } }), { headers: { "content-type": "text/event-stream" } }), onProgress: () => undefined })
  await expect(request(input, createModelingContext({ userId: "developer", taskId: "timeout_stream", authorized: true, timeoutMs: 10, budget: { maxAttempts: 1, maxTotalTokens: 100000, maxOutputTokens: 8192 } }))).rejects.toThrow("TIMEOUT")
  expect(cancelled).toBe(true)
})

test("does not emit remaining cube events after a progress callback cancels", async () => {
  const cancel = new AbortController()
  const progress: string[] = []
  const request = createModelingRequester({ apiKey: "token", transport: async () => new Response(sse([{ type: "response.created", response: { model: "gpt-6-astra" } }, { type: "response.output_text.delta", delta: JSON.stringify(designFixture()) }, { type: "response.completed", response: response() }]), { headers: { "content-type": "text/event-stream" } }), onProgress: event => {
    progress.push(event.type)
    if (event.type === "bone") cancel.abort()
  } })
  await expect(request(input, createModelingContext({ userId: "developer", taskId: "cancel_callback", authorized: true, signal: cancel.signal, budget: { maxAttempts: 1, maxTotalTokens: 100000, maxOutputTokens: 8192 } }))).rejects.toThrow("CANCELLED")
  expect(progress).toEqual(["reset", "bone"])
})
