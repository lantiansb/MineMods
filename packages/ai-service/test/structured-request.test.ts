import { afterEach, beforeEach, expect, test } from "bun:test"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { createModelingContext, createModelingRequester } from "../src/openai"
import { clearDialectCache, extractJsonObject, probeConnection, probeVision, requestStructured, type StructuredRequest } from "../src/structured-request"
import { designFixture } from "../../studio-ai/test/fixture"

type Call = { path: string; authorization: string | undefined; body: Record<string, any> }
type Reply = { status?: number; json?: unknown; sse?: unknown[]; raw?: string; hang?: boolean }

const closers: (() => void)[] = []
beforeEach(() => clearDialectCache())
afterEach(() => closers.splice(0).forEach((close) => close()))

/** A local OpenAI-compatible provider whose behaviour each test scripts per request. */
async function provider(handler: (call: Call, index: number) => Reply) {
  const calls: Call[] = []
  const server = createServer((incoming: IncomingMessage, outgoing: ServerResponse) => {
    const chunks: Buffer[] = []
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk))
    incoming.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8")
      const call = { path: incoming.url ?? "", authorization: incoming.headers.authorization, body: text ? JSON.parse(text) : {} }
      calls.push(call)
      const reply = handler(call, calls.length - 1)
      if (reply.hang) return
      if (reply.sse || reply.raw !== undefined) {
        outgoing.writeHead(reply.status ?? 200, { "Content-Type": "text/event-stream" })
        outgoing.end(reply.raw ?? reply.sse!.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join(""))
        return
      }
      outgoing.writeHead(reply.status ?? 200, { "Content-Type": "application/json" })
      outgoing.end(JSON.stringify(reply.json ?? {}))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  closers.push(() => {
    server.closeAllConnections()
    server.close()
  })
  return { calls, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` }
}

const schema = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false }
const request = (baseUrl: string, overrides: Partial<StructuredRequest> = {}): StructuredRequest => ({
  baseUrl,
  apiKey: "fixture-key",
  model: "fixture-model",
  instructions: "Summarize the brief.",
  input: JSON.stringify({ brief: "forest" }),
  schemaName: "fixture_summary",
  schema,
  maxOutputTokens: 4000,
  streaming: false,
  signal: new AbortController().signal,
  envelope: "lenient",
  transport: (url, init) => fetch(url, init),
  ...overrides,
})

const responsesReply = (text: string, model = "fixture-model") => ({ id: "resp_1", model, status: "completed", usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }] })
const chatReply = (content: string, extra: Record<string, unknown> = {}) => ({ id: "chatcmpl_1", model: "fixture-model", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 }, ...extra })
const unsupported = (message: string, status = 400) => ({ status, json: { error: { message, type: "invalid_request_error" } } })
const notFound = { status: 404, json: { error: { message: "Not Found" } } }
const answer = JSON.stringify({ summary: "forest" })

test("Responses happy path sends exactly the established request body and nothing else", async () => {
  const fake = await provider(() => ({ json: responsesReply(answer) }))
  const result = await requestStructured(request(fake.baseUrl))
  expect(result).toMatchObject({ value: { summary: "forest" }, dialect: "responses", repaired: false, model: "fixture-model", responseId: "resp_1", usage: { total_tokens: 12 } })
  expect(fake.calls).toHaveLength(1)
  expect(fake.calls[0].path).toBe("/v1/responses")
  expect(fake.calls[0].authorization).toBe("Bearer fixture-key")
  expect(Object.keys(fake.calls[0].body)).toEqual(["model", "reasoning", "instructions", "input", "text", "max_output_tokens", "stream", "store"])
  expect(fake.calls[0].body).toEqual({
    model: "fixture-model",
    reasoning: { effort: "high" },
    instructions: "Summarize the brief.",
    input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ brief: "forest" }) }] }],
    text: { format: { type: "json_schema", name: "fixture_summary", strict: true, schema } },
    max_output_tokens: 4000,
    stream: false,
    store: false,
  })
})

test("the Codex route keeps its streaming body and never falls back to Chat Completions", async () => {
  const bodies: Record<string, unknown>[] = []
  const transport = async (url: string, init: RequestInit) => {
    bodies.push({ url, ...JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ error: { message: "Not Found" } }), { status: 404 })
  }
  await expect(requestStructured(request("https://example.com/backend-api/codex", { transport }))).rejects.toThrow("UPSTREAM_UNAVAILABLE")
  expect(bodies).toHaveLength(1)
  expect(bodies[0].url).toBe("https://example.com/backend-api/codex/responses")
  expect(Object.keys(bodies[0])).toEqual(["url", "model", "reasoning", "instructions", "input", "text", "stream", "store"])
  expect(bodies[0].stream).toBe(true)
})

test("a rejected reasoning parameter is retried on the Responses API without it", async () => {
  const fake = await provider((call) => (call.body.reasoning ? unsupported("Unsupported parameter: 'reasoning.effort' is not supported with this model.") : { json: responsesReply(answer) }))
  const result = await requestStructured(request(fake.baseUrl))
  expect(result.dialect).toBe("responses-reduced")
  expect(result.value).toEqual({ summary: "forest" })
  expect(fake.calls.map((call) => call.path)).toEqual(["/v1/responses", "/v1/responses"])
  expect(Object.keys(fake.calls[1].body)).toEqual(["model", "instructions", "input", "text", "max_output_tokens", "stream", "store"])
})

test("a missing Responses route falls back to Chat Completions with a strict json_schema", async () => {
  const fake = await provider((call) => (call.path.endsWith("/responses") ? notFound : { json: chatReply(answer) }))
  const result = await requestStructured(request(fake.baseUrl))
  expect(result).toMatchObject({ value: { summary: "forest" }, dialect: "chat-json-schema", responseId: "chatcmpl_1", usage: { input_tokens: 11, output_tokens: 4, total_tokens: 15 } })
  expect(fake.calls.map((call) => call.path)).toEqual(["/v1/responses", "/v1/chat/completions"])
  expect(fake.calls[1].body).toEqual({
    model: "fixture-model",
    messages: [
      { role: "system", content: "Summarize the brief." },
      { role: "user", content: JSON.stringify({ brief: "forest" }) },
    ],
    response_format: { type: "json_schema", json_schema: { name: "fixture_summary", strict: true, schema } },
    max_tokens: 4000,
    stream: false,
  })
})

test("a rejected json_schema falls back to json_object with the schema in the system message", async () => {
  const fake = await provider((call) => {
    if (call.path.endsWith("/responses")) return { status: 405, json: {} }
    if (call.body.response_format?.type === "json_schema") return unsupported("This response_format type is unavailable now")
    return { json: chatReply(answer) }
  })
  const result = await requestStructured(request(fake.baseUrl))
  expect(result.dialect).toBe("chat-json-object")
  expect(fake.calls).toHaveLength(3)
  expect(fake.calls[2].body.response_format).toEqual({ type: "json_object" })
  expect(fake.calls[2].body.messages[0].content).toStartWith("Summarize the brief.\n\n")
  expect(fake.calls[2].body.messages[0].content).toContain(JSON.stringify(schema))
  expect(fake.calls[2].body.messages[0].content).toContain("single JSON object only")
})

test("a rejected json_object falls back to a plain request that still carries the schema", async () => {
  const fake = await provider((call) => {
    if (call.path.endsWith("/responses")) return { status: 501, json: {} }
    if (call.body.response_format) return unsupported(JSON.stringify({ detail: [{ loc: ["body", "response_format", "type"], msg: "unsupported value" }] }), 422)
    return { json: chatReply(answer) }
  })
  const result = await requestStructured(request(fake.baseUrl))
  expect(result.dialect).toBe("chat-plain")
  expect(fake.calls).toHaveLength(4)
  expect(fake.calls[3].body).not.toHaveProperty("response_format")
  expect(fake.calls[3].body.messages[0].content).toContain(JSON.stringify(schema))
})

test("a rejected max_tokens is retried as max_completion_tokens, and a stated ceiling is honoured", async () => {
  const renamed = await provider((call) => {
    if (call.path.endsWith("/responses")) return notFound
    if ("max_tokens" in call.body) return unsupported("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.")
    return { json: chatReply(answer) }
  })
  await requestStructured(request(renamed.baseUrl))
  expect(renamed.calls[2].body.max_completion_tokens).toBe(4000)
  expect(renamed.calls[2].body).not.toHaveProperty("max_tokens")

  const capped = await provider((call) => {
    if (call.path.endsWith("/responses")) return notFound
    if (call.body.max_tokens > 2048) return unsupported("Invalid max_tokens value, the valid range of max_tokens is [1, 2048]")
    return { json: chatReply(answer) }
  })
  await requestStructured(request(capped.baseUrl))
  expect(capped.calls.map((call) => call.body.max_tokens)).toEqual([undefined, 4000, 2048])
})

test("JSON is recovered from code fences, surrounding prose and reasoning blocks", () => {
  expect(extractJsonObject('```json\n{"summary":"a"}\n```')).toEqual({ summary: "a" })
  expect(extractJsonObject('Here is the result:\n{"summary":"b {braces} and \\"quotes\\""}\nHope that helps!')).toEqual({ summary: 'b {braces} and "quotes"' })
  expect(extractJsonObject('<think>I should return {"draft":1} first</think>\n{"summary":"c"}')).toEqual({ summary: "c" })
  expect(extractJsonObject('plan the answer {not json}</think>{"summary":"d"}')).toEqual({ summary: "d" })
  expect(extractJsonObject('Sure. ```\n{"summary":"e"}\n``` Done.')).toEqual({ summary: "e" })
  expect(() => extractJsonObject("no object here")).toThrow("INVALID_OUTPUT")
  expect(() => extractJsonObject('["an", "array"]')).toThrow("INVALID_OUTPUT")
})

test("an unenforced reply wrapped in reasoning and a code fence is accepted end to end", async () => {
  const fake = await provider((call) => {
    if (call.path.endsWith("/responses")) return notFound
    if (call.body.response_format) return unsupported("response_format is not supported")
    return { json: chatReply(`<think>The user wants a summary.</think>\nHere you go:\n\`\`\`json\n${answer}\n\`\`\``) }
  })
  const result = await requestStructured(request(fake.baseUrl))
  expect(result).toMatchObject({ value: { summary: "forest" }, dialect: "chat-plain", repaired: false })
})

test("one repair retry sends the validation error back, then gives up with INVALID_OUTPUT", async () => {
  const validate = (value: unknown) => {
    if (typeof (value as { summary?: unknown }).summary !== "string") throw new Error("summary must be a string")
  }
  const replies = ["I cannot produce JSON right now.", answer]
  const fake = await provider((call) => (call.path.endsWith("/responses") ? notFound : { json: chatReply(replies.shift() ?? "still not json") }))
  const attempts: boolean[] = []
  const result = await requestStructured(request(fake.baseUrl, { validate, onAttempt: (_body, attempt) => attempts.push(attempt.repair) }))
  expect(result).toMatchObject({ value: { summary: "forest" }, repaired: true })
  expect(attempts).toEqual([false, true])
  const repair = fake.calls.at(-1)!.body.messages
  expect(repair).toHaveLength(4)
  expect(repair[2]).toEqual({ role: "assistant", content: "I cannot produce JSON right now." })
  expect(repair[3].role).toBe("user")
  expect(repair[3].content).toContain("did not contain one parseable JSON object")
  expect(repair[3].content).toContain("corrected JSON object only")

  const wrongShape = await provider((call) => (call.path.endsWith("/responses") ? notFound : { json: chatReply('{"summary":42}') }))
  await expect(requestStructured(request(wrongShape.baseUrl, { validate }))).rejects.toThrow("INVALID_OUTPUT")
  expect(wrongShape.calls.filter((call) => call.path.endsWith("/chat/completions"))).toHaveLength(2)
  expect(wrongShape.calls.at(-1)!.body.messages[3].content).toContain("summary must be a string")

  const vetoed = await provider((call) => (call.path.endsWith("/responses") ? notFound : { json: chatReply("nope") }))
  await expect(requestStructured(request(vetoed.baseUrl, { canRepair: () => false }))).rejects.toThrow("INVALID_OUTPUT")
  expect(vetoed.calls.filter((call) => call.path.endsWith("/chat/completions"))).toHaveLength(1)
})

test("the strict envelope keeps Responses output exact; a lenient request reads a fenced reply and repairs a bare one on the same route", async () => {
  const fenced = await provider(() => ({ json: responsesReply(`\`\`\`json\n${answer}\n\`\`\``) }))
  await expect(requestStructured(request(fenced.baseUrl, { envelope: "strict" }))).rejects.toThrow("INVALID_OUTPUT")
  expect(fenced.calls).toHaveLength(1)
  clearDialectCache()
  await expect(requestStructured(request(fenced.baseUrl))).resolves.toMatchObject({ value: { summary: "forest" }, dialect: "responses", repaired: false })
  clearDialectCache()
  const script = await provider((_call, index) => ({ json: responsesReply(index === 0 ? "const model = { cubes: [] }" : answer) }))
  const result = await requestStructured(request(script.baseUrl))
  expect(result).toMatchObject({ value: { summary: "forest" }, repaired: true, dialect: "responses" })
  expect(script.calls).toHaveLength(2)
  const turns = script.calls[1].body.input
  expect(turns.map((turn: any) => turn.role)).toEqual(["user", "assistant", "user"])
  expect(turns[2].content[0].text).toContain("previous reply was rejected")
})

test("authentication, quota, server and unrelated request errors surface without any fallback", async () => {
  for (const [reply, code] of [
    [{ status: 401, json: { error: { message: "Incorrect API key; check response_format" } } }, "UNAUTHORIZED"],
    [{ status: 403, json: {} }, "UNAUTHORIZED"],
    [{ status: 429, json: { error: { message: "Rate limit reached for reasoning" } } }, "BUDGET_EXCEEDED"],
    [{ status: 500, json: { error: { message: "reasoning backend crashed" } } }, "UPSTREAM_UNAVAILABLE"],
    [{ status: 503, json: {} }, "UPSTREAM_UNAVAILABLE"],
    [unsupported("The input exceeds the context window of this model."), "REQUEST_REJECTED"],
  ] as const) {
    clearDialectCache()
    const fake = await provider(() => reply)
    await expect(requestStructured(request(fake.baseUrl))).rejects.toThrow(code)
    expect(fake.calls).toHaveLength(1)
  }
})

test("abort is honoured before sending and while the provider is silent", async () => {
  const fake = await provider(() => ({ hang: true }))
  const early = new AbortController()
  early.abort()
  await expect(requestStructured(request(fake.baseUrl, { signal: early.signal }))).rejects.toThrow("CANCELLED")
  expect(fake.calls).toHaveLength(0)
  const late = new AbortController()
  const pending = requestStructured(request(fake.baseUrl, { signal: late.signal }))
  setTimeout(() => late.abort(), 50)
  await expect(pending).rejects.toThrow()
  expect(fake.calls).toHaveLength(1)
  await expect(requestStructured(request(fake.baseUrl, { signal: AbortSignal.timeout(50) }))).rejects.toThrow()
  expect(fake.calls).toHaveLength(2)
})

test("abort during a streamed chat reply stops the read with CANCELLED", async () => {
  const controller = new AbortController()
  const transport = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '{"summ' } }] })}\n\n`))
          setTimeout(() => controller.abort(), 20)
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    )
  const first = await provider(() => notFound)
  // Reach the chat dialect through the real negotiation, then stream from the injected transport.
  let calls = 0
  await expect(
    requestStructured(request(first.baseUrl, { streaming: true, signal: controller.signal, transport: (url, init) => (calls++ === 0 ? fetch(url, init) : transport()) })),
  ).rejects.toThrow("CANCELLED")
})

test("the negotiated dialect is cached per endpoint and model, and dropped when it stops working", async () => {
  let chatBroken = false
  const fake = await provider((call) => {
    if (call.path.endsWith("/responses")) return chatBroken ? { json: responsesReply(answer) } : notFound
    if (chatBroken) return notFound
    if (call.body.response_format?.type === "json_schema") return unsupported("json_schema is not supported by this model")
    return { json: chatReply(answer) }
  })
  expect((await requestStructured(request(fake.baseUrl))).dialect).toBe("chat-json-object")
  expect(fake.calls).toHaveLength(3)
  expect((await requestStructured(request(fake.baseUrl))).dialect).toBe("chat-json-object")
  expect(fake.calls).toHaveLength(4)
  expect(fake.calls[3].path).toBe("/v1/chat/completions")
  expect(fake.calls[3].body.response_format).toEqual({ type: "json_object" })
  // Another model on the same endpoint negotiates for itself.
  expect((await requestStructured(request(fake.baseUrl, { model: "other-model" }))).dialect).toBe("chat-json-object")
  expect(fake.calls).toHaveLength(7)
  chatBroken = true
  expect((await requestStructured(request(fake.baseUrl))).dialect).toBe("responses")
  expect(fake.calls.slice(7).map((call) => call.path)).toEqual(["/v1/chat/completions", "/v1/responses"])
  expect((await requestStructured(request(fake.baseUrl))).dialect).toBe("responses")
  expect(fake.calls).toHaveLength(10)
})

test("streamed chat completions are assembled from deltas with text callbacks and trailing usage", async () => {
  const pieces = ["<think>plan</think>", '{"summ', 'ary":"for', 'est"}']
  const fake = await provider((call) => {
    if (call.path.endsWith("/responses")) return notFound
    return {
      sse: [
        { id: "chatcmpl_stream", model: "fixture-model-0101", choices: [{ index: 0, delta: { role: "assistant", content: "" } }] },
        ...pieces.map((content) => ({ id: "chatcmpl_stream", choices: [{ index: 0, delta: { content, reasoning_content: null } }] })),
        { id: "chatcmpl_stream", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        { id: "chatcmpl_stream", choices: [], usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 99 } },
        "[DONE]",
      ],
    }
  })
  const seen: string[] = []
  const result = await requestStructured(request(fake.baseUrl, { streaming: true, onText: (text) => seen.push(text) }))
  expect(result).toMatchObject({ value: { summary: "forest" }, dialect: "chat-json-schema", model: "fixture-model-0101", responseId: "chatcmpl_stream", usage: { input_tokens: 20, output_tokens: 6, total_tokens: 26 } })
  expect(fake.calls[1].body.stream).toBe(true)
  expect(fake.calls[1].body.stream_options).toEqual({ include_usage: true })
  expect(seen).toEqual(['{"summ', '{"summary":"for', '{"summary":"forest"}'])
})

test("a truncated, length-limited or refused chat reply keeps the established error codes", async () => {
  const cases: [Reply, string][] = [
    [{ sse: [{ choices: [{ index: 0, delta: { content: '{"summary":"for' } }] }] }, "INCOMPLETE_OUTPUT"],
    [{ json: chatReply('{"summary":"for', { choices: [{ index: 0, finish_reason: "length", message: { role: "assistant", content: '{"summary":"for' } }] }) }, "INCOMPLETE_OUTPUT"],
    [{ json: chatReply("", { choices: [{ index: 0, finish_reason: "content_filter", message: { role: "assistant", content: null } }] }) }, "REFUSED"],
    [{ json: chatReply("", { choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: null, refusal: "I can't help with that." } }] }) }, "REFUSED"],
    [{ sse: [{ error: { message: "overloaded" } }] }, "UPSTREAM_UNAVAILABLE"],
  ]
  for (const [reply, code] of cases) {
    clearDialectCache()
    const fake = await provider((call) => (call.path.endsWith("/responses") ? notFound : reply))
    await expect(requestStructured(request(fake.baseUrl, { streaming: "sse" in reply }))).rejects.toThrow(code)
    expect(fake.calls).toHaveLength(2)
  }
})

test("a configured endpoint may echo an alias or no model name; the echoed name is still reported", async () => {
  const alias = await provider(() => ({ json: responsesReply(answer, "vendor/fixture-model-20260101") }))
  expect((await requestStructured(request(alias.baseUrl))).model).toBe("vendor/fixture-model-20260101")
  const silent = await provider((call) => (call.path.endsWith("/responses") ? notFound : { json: { choices: [{ finish_reason: "stop", message: { content: answer } }] } }))
  const result = await requestStructured(request(silent.baseUrl))
  expect(result.value).toEqual({ summary: "forest" })
  expect(result.model).toBeUndefined()
  expect(result.usage).toBeUndefined()
})

test("the connection probe succeeds on either route and never falls back on bad credentials", async () => {
  const chatOnly = await provider((call) => (call.path.endsWith("/responses") ? notFound : { json: chatReply("pong", { model: "deepseek-chat" }) }))
  const options = { apiKey: "fixture-key", model: "deepseek-chat", signal: new AbortController().signal, transport: (url: string, init: RequestInit) => fetch(url, init) }
  await expect(probeConnection({ ...options, baseUrl: chatOnly.baseUrl })).resolves.toEqual({ model: "deepseek-chat", status: "completed", api: "chat" })
  expect(chatOnly.calls[1].body).toEqual({ model: "deepseek-chat", messages: [{ role: "user", content: "ping" }], max_tokens: 16, stream: false })
  // The probe remembers the missing Responses route for the first real request.
  chatOnly.calls.length = 0
  const direct = await requestStructured(request(chatOnly.baseUrl, { model: "deepseek-chat" })).catch((error: Error) => error.message)
  expect(direct).toBe("INVALID_OUTPUT")
  expect(chatOnly.calls.every((call) => call.path === "/v1/chat/completions")).toBe(true)

  const responsesOnly = await provider((call) => (call.path.endsWith("/responses") ? { json: { status: "completed" } } : notFound))
  await expect(probeConnection({ ...options, baseUrl: responsesOnly.baseUrl })).resolves.toEqual({ model: "deepseek-chat", status: "completed", api: "responses" })
  expect(responsesOnly.calls).toHaveLength(1)

  const denied = await provider(() => ({ status: 401, json: {} }))
  await expect(probeConnection({ ...options, baseUrl: denied.baseUrl })).rejects.toThrow("UNAUTHORIZED")
  expect(denied.calls).toHaveLength(1)
})

// broad22: DeepSeek's reasoning model spent the probe's whole allowance thinking and answered "incomplete"; Studio refused a working connection.
test("a probe answered but cut short by its allowance is a working connection; only a failed answer is not", async () => {
  const options = { apiKey: "fixture-key", model: "deepseek-flash", signal: new AbortController().signal, transport: (url: string, init: RequestInit) => fetch(url, init) }
  const thinking = await provider(() => ({ json: { model: "deepseek-flash", status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } }))
  await expect(probeConnection({ ...options, baseUrl: thinking.baseUrl })).resolves.toEqual({ model: "deepseek-flash", status: "incomplete", api: "responses" })
  expect(thinking.calls).toHaveLength(1)
  expect(thinking.calls[0].body.max_output_tokens).toBe(16)
  const failed = await provider(() => ({ json: { model: "deepseek-flash", status: "failed" } }))
  await expect(probeConnection({ ...options, baseUrl: failed.baseUrl })).rejects.toThrow("UPSTREAM_UNAVAILABLE")
})

test("modeling works end to end against a Chat-Completions-only provider with a configured model", async () => {
  const design = designFixture()
  const fake = await provider((call) => {
    if (call.path.endsWith("/responses")) return notFound
    if (call.body.response_format?.type === "json_schema") return unsupported("response_format json_schema is not supported")
    return { json: { id: "chatcmpl_model", model: "qwen-plus-2026-01-01", choices: [{ finish_reason: "stop", message: { content: `<think>design it</think>\`\`\`json\n${JSON.stringify(design)}\n\`\`\`` } }], usage: { prompt_tokens: 900, completion_tokens: 700, total_tokens: 1600 } } }
  })
  const context = createModelingContext({ userId: "developer", taskId: "chat_fixture", authorized: true, budget: { maxAttempts: 2, maxTotalTokens: 200000, maxOutputTokens: 8192 } })
  const modeling = createModelingRequester({ apiKey: "fixture-key", baseUrl: fake.baseUrl, model: "qwen-plus", transport: (url, init) => fetch(url, init) })
  const result = await modeling({ step: "model", content: "Create a simple low-detail forest creature", revision: "r0" }, context)
  expect(result.design.name).toBe(design.name)
  expect(result.usage).toEqual({ input_tokens: 900, output_tokens: 700, total_tokens: 1600 })
  expect(result.provenance).toMatchObject({ model: "qwen-plus-2026-01-01", response_id: "chatcmpl_model", attempt: 1 })
  expect(fake.calls.map((call) => call.path)).toEqual(["/v1/responses", "/v1/chat/completions", "/v1/chat/completions"])
  expect(fake.calls[2].body.model).toBe("qwen-plus")
  expect(fake.calls[2].body.max_tokens).toBe(8192)
  expect(fake.calls[2].body.messages[0].content).toContain("must validate against this JSON Schema")
})

test("modeling charges the full reservation when a chat provider reports no usage", async () => {
  const design = designFixture()
  const fake = await provider((call) => (call.path.endsWith("/responses") ? notFound : { json: { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(design) } }] } }))
  const context = createModelingContext({ userId: "developer", taskId: "chat_no_usage", authorized: true, budget: { maxAttempts: 1, maxTotalTokens: 200000, maxOutputTokens: 8192 } })
  const modeling = createModelingRequester({ apiKey: "fixture-key", baseUrl: fake.baseUrl, model: "local-model", transport: (url, init) => fetch(url, init) })
  const result = await modeling({ step: "model", content: "Create a simple low-detail forest creature", revision: "r0" }, context)
  expect(result.usage.output_tokens).toBe(8192)
  expect(result.usage.total_tokens).toBe(result.usage.input_tokens + 8192)
  expect(result.provenance.model).toBe("local-model")
  expect(result.provenance.response_id).toStartWith("unidentified-")
})

// Pictures for a model that looks at what it made: the making loop sends contact sheets with the words.
const SHEET = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQ=="
const CLOSE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

test("pictures ride after the text as image parts on the Responses route; without pictures the body is unchanged", async () => {
  const fake = await provider(() => ({ json: responsesReply(answer) }))
  await requestStructured(request(fake.baseUrl, { images: [SHEET, CLOSE] }))
  expect(fake.calls[0]!.path).toBe("/v1/responses")
  expect(fake.calls[0]!.body.input).toEqual([
    {
      role: "user",
      content: [
        { type: "input_text", text: JSON.stringify({ brief: "forest" }) },
        { type: "input_image", image_url: SHEET },
        { type: "input_image", image_url: CLOSE },
      ],
    },
  ])
  await requestStructured(request(fake.baseUrl, { images: [] }))
  await requestStructured(request(fake.baseUrl))
  expect(fake.calls[1]!.body.input).toEqual([{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ brief: "forest" }) }] }])
  expect(fake.calls[2]!.body).toEqual(fake.calls[1]!.body)
})

test("on Chat Completions pictures are image_url parts of the user message, and a repair turn keeps them", async () => {
  const fake = await provider((call, index) => (call.path.endsWith("/responses") ? notFound : { json: chatReply(index === 1 ? "not json" : answer) }))
  const result = await requestStructured(request(fake.baseUrl, { images: [SHEET] }))
  expect(result).toMatchObject({ value: { summary: "forest" }, repaired: true })
  const pictured = [{ type: "text", text: JSON.stringify({ brief: "forest" }) }, { type: "image_url", image_url: { url: SHEET } }]
  expect(fake.calls[1]!.body.messages[1]).toEqual({ role: "user", content: pictured })
  expect(fake.calls[2]!.body.messages[1]).toEqual({ role: "user", content: pictured })
  // Without pictures the user message stays a plain string, as every text-only provider expects.
  await requestStructured(request(fake.baseUrl))
  expect(fake.calls.at(-1)!.body.messages[1]).toEqual({ role: "user", content: JSON.stringify({ brief: "forest" }) })
})

test("a model that refuses pictures is tried on Chat Completions, and refused there too it fails as NO_VISION, not as a broken connection", async () => {
  const blind = await provider(() => unsupported("This model does not support image input."))
  await expect(requestStructured(request(blind.baseUrl, { images: [SHEET] }))).rejects.toMatchObject({ code: "NO_VISION" })
  expect(blind.calls.map((call) => call.path)).toEqual(["/v1/responses", "/v1/chat/completions"])
  // The same words about a request that carried no pictures are an ordinary refusal of a parameter.
  clearDialectCache()
  const plain = await provider(() => unsupported("This model does not support image input."))
  await expect(requestStructured(request(plain.baseUrl))).rejects.toMatchObject({ code: "REQUEST_REJECTED" })
  // Refused on Responses only: the pictures go through on Chat Completions.
  clearDialectCache()
  const half = await provider((call) => (call.path.endsWith("/responses") ? unsupported("input_image is not supported; vision unavailable on this route") : { json: chatReply(answer) }))
  expect((await requestStructured(request(half.baseUrl, { images: [SHEET] }))).value).toEqual({ summary: "forest" })
  expect(half.calls[1]!.body.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: SHEET } })
})

test("the vision check shows the model one picture and believes only the right answer", async () => {
  const signal = new AbortController().signal
  const transport = (url: string, init: RequestInit) => fetch(url, init)
  const ask = (baseUrl: string) => probeVision({ baseUrl, apiKey: "fixture-key", model: "fixture-model", signal, transport })
  const sees = await provider(() => ({ json: responsesReply(JSON.stringify({ colour: "red" })) }))
  expect(await ask(sees.baseUrl)).toBe("yes")
  const sent = sees.calls[0]!.body.input[0].content
  expect(sent.map((part: { type: string }) => part.type)).toEqual(["input_text", "input_image"])
  expect(sent[1].image_url).toStartWith("data:image/png;base64,")
  expect(sees.calls[0]!.body.text.format.schema.properties.colour.enum).toContain("no_picture")
  clearDialectCache()
  // A proxy that drops pictures leaves the model guessing or saying so: neither counts as seeing.
  expect(await ask((await provider(() => ({ json: responsesReply(JSON.stringify({ colour: "no_picture" })) }))).baseUrl)).toBe("no")
  clearDialectCache()
  expect(await ask((await provider(() => ({ json: responsesReply(JSON.stringify({ colour: "blue" })) }))).baseUrl)).toBe("no")
  clearDialectCache()
  expect(await ask((await provider(() => unsupported("image inputs are not supported by this model"))).baseUrl)).toBe("no")
  clearDialectCache()
  // When the question could not be asked at all, nothing is known about the model's eyes.
  expect(await ask((await provider(() => ({ status: 500, json: { error: { message: "boom" } } }))).baseUrl)).toBe("unknown")
  clearDialectCache()
  expect(await ask((await provider(() => ({ status: 401, json: { error: { message: "bad key" } } }))).baseUrl)).toBe("unknown")
})

test("a schema with optional fields goes out in strict form, and the nulls it invites come back out before the caller's check", async () => {
  const loose = {
    type: "object",
    properties: { summary: { type: "string" }, note: { type: "string" }, tags: { type: "array", items: { type: "object", properties: { name: { type: "string" }, colour: { type: "string" } }, required: ["name"] } } },
    required: ["summary"],
  }
  const seen: unknown[] = []
  const fake = await provider(() => ({ json: responsesReply(JSON.stringify({ summary: "forest", note: null, tags: [{ name: "moss", colour: null }] })) }))
  const result = await requestStructured(request(fake.baseUrl, { schema: loose, validate: (value) => void seen.push(value) }))
  expect(fake.calls[0].body.text.format.schema).toEqual({
    type: "object",
    properties: {
      summary: { type: "string" },
      note: { anyOf: [{ type: "string" }, { type: "null" }] },
      tags: { anyOf: [{ type: "array", items: { type: "object", properties: { name: { type: "string" }, colour: { anyOf: [{ type: "string" }, { type: "null" }] } }, required: ["name", "colour"], additionalProperties: false } }, { type: "null" }] },
    },
    required: ["summary", "note", "tags"],
    additionalProperties: false,
  })
  expect(result.value).toEqual({ summary: "forest", tags: [{ name: "moss" }] })
  expect(seen).toEqual([{ summary: "forest", tags: [{ name: "moss" }] }])
})

test("a service that names only the schema it refuses steps down the ladder instead of failing as a broken connection", async () => {
  // broad22-api-r2: DeepSeek's words for a schema that strict mode does not take.
  const refusal = "Required properties must match all properties in the object"
  const fake = await provider((call) => (call.body.text?.format?.type === "json_schema" || call.body.response_format?.type === "json_schema" ? unsupported(refusal) : { json: chatReply(answer) }))
  const result = await requestStructured(request(fake.baseUrl))
  expect(result.dialect).toBe("chat-json-object")
  expect(fake.calls.map((call) => call.path)).toEqual(["/v1/responses", "/v1/chat/completions", "/v1/chat/completions"])
})

test("a request the service reads and refuses on every rung is REQUEST_REJECTED, never a network failure", async () => {
  const fake = await provider(() => unsupported("Model does not exist or you lack access to it."))
  await expect(requestStructured(request(fake.baseUrl))).rejects.toThrow("REQUEST_REJECTED")
  expect(fake.calls).toHaveLength(1)
})

test("asked to think less, each route is told through its own parameter, and a chat service that refuses it is asked without it", async () => {
  const responses = await provider(() => ({ json: responsesReply(answer) }))
  await requestStructured(request(responses.baseUrl, { reasoningEffort: "low" }))
  expect(responses.calls[0].body.reasoning).toEqual({ effort: "low" })
  clearDialectCache()
  const chat = await provider((call) => (call.path.endsWith("/responses") ? notFound : call.body.reasoning_effort ? unsupported("Unrecognized request argument supplied: reasoning_effort") : { json: chatReply(answer) }))
  const result = await requestStructured(request(chat.baseUrl, { reasoningEffort: "low" }))
  expect(result.value).toEqual({ summary: "forest" })
  expect(chat.calls.map((call) => call.body.reasoning_effort)).toEqual([undefined, "low", undefined])
  // Not asked: nothing is sent, so a service's own default stands.
  clearDialectCache()
  const plain = await provider((call) => (call.path.endsWith("/responses") ? notFound : { json: chatReply(answer) }))
  await requestStructured(request(plain.baseUrl))
  expect("reasoning_effort" in plain.calls[1].body).toBe(false)
})

test("a connection cut while the answer streams in is UPSTREAM_UNAVAILABLE, the code a retrying caller tries again", async () => {
  const transport = async () =>
    new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"response.created","response":{"model":"fixture-model"}}\n\n'))
        controller.error(new TypeError("terminated: other side closed"))
      },
    }), { headers: { "Content-Type": "text/event-stream" } })
  await expect(requestStructured(request("https://example.com/v1", { streaming: true, transport }))).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" })
  const refused = async () => { throw new TypeError("fetch failed") }
  await expect(requestStructured(request("https://example.com/v1", { transport: refused }))).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" })
})
