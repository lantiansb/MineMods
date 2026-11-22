import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { transcribeSpeech } from "../src/main/speech"

test("speech uses the configured transcription endpoint and returns editable text", async () => {
  const requests: { path?: string; body: string }[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", chunk => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      requests.push({ path: request.url, body: Buffer.concat(chunks).toString() })
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ text: "制作一片月光森林和一个鹿模型。" }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing fixture port")
  try {
    await expect(transcribeSpeech({ audio: Buffer.from("test-audio").toString("base64"), mime: "audio/webm" }, { apiKey: "fixture-key", baseUrl: `http://127.0.0.1:${address.port}/v1`, model: "fixture-transcribe" })).resolves.toEqual({ text: "制作一片月光森林和一个鹿模型。" })
    expect(requests).toHaveLength(1)
    expect(requests[0].path).toBe("/v1/audio/transcriptions")
    expect(requests[0].body).toContain("fixture-transcribe")
    expect(requests[0].body).toContain("voice.webm")
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

test("speech rejects unconfigured service and invalid audio before uploading", async () => {
  await expect(transcribeSpeech({ audio: "dGVzdA==", mime: "audio/webm" }, {})).rejects.toThrow("语音")
  await expect(transcribeSpeech({ audio: "not base64", mime: "audio/webm" }, { apiKey: "fixture-key" })).rejects.toThrow()
  await expect(transcribeSpeech({ audio: "dGVzdA==", mime: "audio/webm" }, { apiKey: "fixture-key", baseUrl: "https://example.com/backend-api/codex" })).rejects.toThrow("转写")
})
