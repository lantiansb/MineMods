import { expect, test } from "bun:test"
import { z } from "zod"
import { forgetCutOffModels, requestAuthoring } from "../src/main/authoring-ai"
import { startChatOnlyProvider } from "./fixtures/chat-only-provider"

test("authoring uses Codex streaming contract and retains structured output validation", async () => {
  const text = JSON.stringify({ summary: "森林世界" })
  const output = [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }]
  const events = [{ type: "response.created", response: { model: "gpt-6-astra" } }, { type: "response.output_text.delta", delta: text }, { type: "response.output_item.done", output_index: 0, item: { id: "msg_authoring", ...output[0] } }, { type: "response.completed", response: { model: "gpt-6-astra", status: "completed", output: [] } }]
  await expect(requestAuthoring(z.strictObject({ summary: z.string() }), { brief: "森林" }, {
    apiKey: "fixture-key", baseUrl: "https://example.com/backend-api/codex", instructions: "Summarize.", signal: new AbortController().signal,
    transport: async (url, init) => {
      const body = JSON.parse(String(init.body))
      expect(url).toBe("https://example.com/backend-api/codex/responses")
      expect(body.stream).toBe(true)
      expect(body.model).toBe("gpt-6-astra")
      expect(body.reasoning.effort).toBe("high")
      expect(body).not.toHaveProperty("max_output_tokens")
      expect(body.text.format.type).toBe("json_schema")
      return new Response(new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")))
    },
  })).resolves.toEqual({ summary: "森林世界" })
})

test("authoring converts malformed generated JSON into the standard output error", async () => {
  await expect(requestAuthoring(z.strictObject({ summary: z.string() }), { brief: "森林" }, {
    apiKey: "fixture-key", instructions: "Summarize.", signal: new AbortController().signal,
    transport: async () => Response.json({ model: "gpt-6-astra", status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"summary":' }] }] }),
  })).rejects.toThrow("INVALID_OUTPUT")
})

test("module authoring pins its configured model and reports actual streamed text", async () => {
  const text = JSON.stringify({ summary: "已收到纹理参数" })
  const seen: string[] = []
  const events = [
    { type: "response.created", response: { model: "fixture-small" } },
    { type: "response.output_text.delta", delta: text },
    { type: "response.completed", response: { model: "fixture-small", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] } },
  ]
  await expect(requestAuthoring(z.strictObject({ summary: z.string() }), {}, {
    apiKey: "fixture-key", model: "fixture-small", instructions: "Texture module only.", signal: new AbortController().signal,
    onText: value => { seen.push(value) },
    transport: async (_url, init) => {
      expect(JSON.parse(String(init.body)).model).toBe("fixture-small")
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } })
    },
  })).resolves.toEqual({ summary: "已收到纹理参数" })
  expect(seen).toEqual([text])
})

test("the default model on the default endpoint stays pinned to the echoed model name", async () => {
  await expect(requestAuthoring(z.strictObject({ summary: z.string() }), {}, {
    apiKey: "fixture-key", instructions: "Fixed module.", signal: new AbortController().signal,
    transport: async () => Response.json({ model: "gpt-5", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: '{"summary":"wrong provider"}' }] }] }),
  })).rejects.toThrow("MODEL_MISMATCH")
})

test("a configured model or endpoint accepts an alias, a dated snapshot or no echoed model name", async () => {
  const reply = (model?: string) => Response.json({ ...(model ? { model } : {}), status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: '{"summary":"ok"}' }] }] })
  for (const echoed of ["fixture-small-2026-01-01", "provider/alias", undefined]) {
    await expect(requestAuthoring(z.strictObject({ summary: z.string() }), {}, {
      apiKey: "fixture-key", model: "fixture-small", instructions: "Fixed module.", signal: new AbortController().signal,
      transport: async () => reply(echoed),
    })).resolves.toEqual({ summary: "ok" })
  }
  await expect(requestAuthoring(z.strictObject({ summary: z.string() }), {}, {
    apiKey: "fixture-key", baseUrl: "https://relay.example.com/v1", instructions: "Fixed module.", signal: new AbortController().signal,
    transport: async () => reply("some-other-name"),
  })).resolves.toEqual({ summary: "ok" })
})

test("authoring works against a Chat-Completions-only provider with a configured model and repairs one invalid reply", async () => {
  const replies: unknown[] = [{ summary: 42 }, { summary: "森林世界" }]
  const provider = await startChatOnlyProvider(() => replies.shift())
  try {
    await expect(requestAuthoring(z.strictObject({ summary: z.string() }), { brief: "森林" }, {
      apiKey: "fixture-key", baseUrl: provider.baseUrl, model: "moonshot-v1-32k", instructions: "Summarize.", maxOutputTokens: 2000, signal: new AbortController().signal,
    })).resolves.toEqual({ summary: "森林世界" })
    expect(provider.calls.map(call => call.path)).toEqual(["/v1/responses", "/v1/chat/completions", "/v1/chat/completions", "/v1/chat/completions"])
    const repair = provider.calls.at(-1)!.body
    expect(repair.model).toBe("moonshot-v1-32k")
    expect(repair.max_tokens).toBe(2000)
    expect(repair.messages).toHaveLength(4)
    expect(repair.messages[3].content).toContain("summary")
    await expect(requestAuthoring(z.strictObject({ summary: z.string() }), { brief: "森林" }, {
      apiKey: "fixture-key", baseUrl: provider.baseUrl, model: "moonshot-v1-32k", instructions: "Summarize.", signal: new AbortController().signal,
    })).rejects.toThrow("INVALID_OUTPUT")
  } finally {
    provider.close()
  }
})

test("an answer cut off at the output allowance is tried again with less thinking and more room, and the model starts with less thinking after that", async () => {
  forgetCutOffModels()
  const seen: { effort: unknown; room: unknown }[] = []
  const text = JSON.stringify({ summary: "小鸡" })
  const ask = () => requestAuthoring(z.strictObject({ summary: z.string() }), {}, {
    apiKey: "fixture-key", baseUrl: "https://example.com/v1", model: "fixture-thinker", instructions: "Summarize.", maxOutputTokens: 1000, signal: new AbortController().signal, retry: true, retryWait: [0, 0],
    transport: async (_url, init) => {
      const body = JSON.parse(String(init.body))
      seen.push({ effort: body.reasoning?.effort, room: body.max_output_tokens })
      return seen.length <= 2
        ? Response.json({ model: "fixture-thinker", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] })
        : Response.json({ model: "fixture-thinker", status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }] })
    },
  })
  await expect(ask()).resolves.toEqual({ summary: "小鸡" })
  expect(seen).toEqual([{ effort: "high", room: 1000 }, { effort: "low", room: 2000 }, { effort: "low", room: 4000 }])
  await expect(ask()).resolves.toEqual({ summary: "小鸡" })
  // Thinking less is remembered for this model; the room is not.
  expect(seen[3]).toEqual({ effort: "low", room: 1000 })
  forgetCutOffModels()
})
