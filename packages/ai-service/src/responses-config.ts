import { MODEL_POLICY, ModelingError } from "@minemods/studio-ai/policy"

/** Trusted provider configuration; never supplied through a model prompt or renderer. */
export function responsesConfig(baseUrl: string | undefined, maxOutputTokens: number, streaming: boolean) {
  if (baseUrl && !URL.canParse(baseUrl)) throw new ModelingError("SERVICE_UNAVAILABLE")
  const url = new URL(baseUrl ?? MODEL_POLICY.endpoint.replace(/\/responses$/, ""))
  if (url.username || url.password || url.search || url.hash) throw new ModelingError("SERVICE_UNAVAILABLE")
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new ModelingError("SERVICE_UNAVAILABLE")
  const codex = /\/backend-api\/codex\/?$/.test(url.pathname)
  const base = `${url.origin}${url.pathname.replace(/\/+$/, "")}`
  return {
    base,
    endpoint: `${base}/responses`,
    // Same validated base, so the URL safety rules above also cover Chat Completions and model listing.
    chatEndpoint: `${base}/chat/completions`,
    modelsEndpoint: `${base}/models`,
    codex,
    // The Codex route requires streaming and rejects max_output_tokens. The caller
    // still enforces its deadline, response-size limit, usage budget and model policy.
    parameters: codex ? { stream: true, store: false } : { max_output_tokens: maxOutputTokens, stream: streaming, store: false },
  }
}
