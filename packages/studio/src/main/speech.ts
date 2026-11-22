import { z } from "zod"
import { SpeechInputSchema, type SpeechInput } from "../speech"
import { responsesConfig } from "@minemods/ai-service/responses-config"

export class SpeechError extends Error {}

export async function transcribeSpeech(
  input: SpeechInput,
  options: { apiKey?: string; baseUrl?: string; model?: string },
) {
  const parsed = SpeechInputSchema.parse(input)
  if (!options.apiKey?.trim()) throw new SpeechError("语音服务未配置，请先配置 AI 服务。")
  const provider = responsesConfig(options.baseUrl, 1000, false)
  if (provider.codex) throw new SpeechError("当前服务不支持语音转写，请配置独立的语音转写地址。")
  const bytes = Buffer.from(parsed.audio, "base64")
  if (!bytes.length || bytes.byteLength > 20 * 1024 * 1024)
    throw new SpeechError("录音需小于 20 MB，请缩短录音后重试。")
  const form = new FormData()
  form.set("model", options.model?.trim() || "gpt-4o-mini-transcribe")
  form.set("response_format", "json")
  form.set("file", new Blob([bytes], { type: parsed.mime }), `voice.${parsed.mime.split("/")[1]}`)
  const response = await fetch(provider.endpoint.replace(/\/responses$/, "/audio/transcriptions"), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(120000),
    headers: { Authorization: `Bearer ${options.apiKey.trim()}` },
    body: form,
  }).catch(() => {
    throw new SpeechError("暂时无法连接语音服务，请检查连接后重试。")
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new SpeechError(
      response.status === 401 || response.status === 403
        ? "语音服务凭据无效，请检查服务配置。"
        : "语音转写未完成，请稍后重试。",
    )
  }
  const result = z
    .object({ text: z.string().trim().min(1).max(20000) })
    .safeParse(await response.json().catch(() => null))
  if (!result.success) throw new SpeechError("录音中没有识别到有效需求，请重试或直接输入文字。")
  return result.data
}
