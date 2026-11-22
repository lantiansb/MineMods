import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

export type ChatProviderCall = { method: string; path: string; body: Record<string, any> }

/**
 * A local provider that only implements Chat Completions, like most OpenAI-compatible services:
 * no Responses route, no model catalogue, no strict json_schema, and replies wrapped the way
 * reasoning models wrap them.
 */
export async function startChatOnlyProvider(reply: (call: ChatProviderCall) => unknown, options: { model?: string } = {}) {
  const calls: ChatProviderCall[] = []
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = []
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk))
    incoming.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8")
      const call = { method: incoming.method ?? "", path: incoming.url ?? "", body: text ? JSON.parse(text) : {} }
      calls.push(call)
      const send = (status: number, value: unknown) => {
        outgoing.writeHead(status, { "Content-Type": "application/json" })
        outgoing.end(JSON.stringify(value))
      }
      if (call.path !== "/v1/chat/completions" || call.method !== "POST") return send(404, { error: { message: "Not Found" } })
      if (call.body.response_format?.type === "json_schema")
        return send(400, { error: { message: "This response_format type is unavailable now", type: "invalid_request_error" } })
      const content = `<think>先核对输入。</think>\n\`\`\`json\n${JSON.stringify(reply(call))}\n\`\`\``
      send(200, {
        id: "chatcmpl-fixture",
        ...(options.model ? { model: options.model } : {}),
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    calls,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    close: () => {
      server.closeAllConnections()
      server.close()
    },
  }
}
