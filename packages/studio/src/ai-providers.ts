/**
 * Ready-made AI services the person can pick in 个人设置 → 连接 AI → Studio 自己调用 AI, so only the key is left to paste.
 * Pure data and words: the window shows them, the main process opens the key page from here (the window names the
 * service, never a link).
 */

/** DeepSeek's own service. Sees pictures, cannot draw (the 画图模型 stays empty; Studio already remembers a 404 from the draw route). */
export const DEEPSEEK_URL = "https://api.deepseek.com"
export const DEEPSEEK_MODEL = "deepseek-flash"
/** Where the person creates a key. */
export const DEEPSEEK_KEY_PAGE = "https://platform.deepseek.com/api_keys"

/** Choosing DeepSeek fills the address and the model and leaves the 画图模型 empty: only the key is left to paste. */
export function deepseekDraft<T extends { baseUrl: string; model: string; routerModel: string; moduleModel: string; imageModel?: string }>(previous: T): T {
  const { imageModel: _cannotDraw, ...rest } = previous
  return { ...rest, baseUrl: DEEPSEEK_URL, model: DEEPSEEK_MODEL, routerModel: DEEPSEEK_MODEL, moduleModel: DEEPSEEK_MODEL } as T
}

/**
 * What it cost to make one small mod (6–9 things) with DeepSeek end to end, in yuan (broad22-api, each round one such mod):
 *   r4 4.00 · r5 5.13 · r6 at least 3.23 (the run was cut short, so a floor) · r7 4.52 (peak-hour price; at the off-peak price about 2.26)
 *   · broad24 5.48 (a novice through the real window, summed usage; one failed picture request returned no usage).
 * Price source: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ , read 2026-10-19 and 2026-10-20.
 * The words below say the span of these widened to whole yuan, so every measured mod falls inside it (3.23 -> 3, 5.48 -> 6): a rounded
 * upper end below a measured cost would tell the person less than they will pay. When the price changes, measure again and
 * change this list and DEEPSEEK_COST_MONTH; the sentence follows.
 */
export const DEEPSEEK_MEASURED_COST_YUAN = [4.0, 5.13, 3.23, 4.52, 5.48] as const
/** When those numbers were taken, as the person reads it. */
export const DEEPSEEK_COST_MONTH = "2026 年 10 月"
/** How many things the measured mod had. */
export const DEEPSEEK_MEASURED_THINGS = "6–9"

export const DEEPSEEK_COST_RANGE = {
  low: Math.floor(Math.min(...DEEPSEEK_MEASURED_COST_YUAN)),
  high: Math.ceil(Math.max(...DEEPSEEK_MEASURED_COST_YUAN)),
}

/** The services that have one fixed website: the window shows a link for these, and only names the service. */
export const KEY_PAGE_PROVIDERS = ["openai", "openrouter", "deepseek"] as const
export type KeyPageProvider = (typeof KEY_PAGE_PROVIDERS)[number]
/** Where the person creates a key, per service. The main process opens these; the window never passes an address. */
export const PROVIDER_KEY_PAGE: Record<KeyPageProvider, string> = {
  openai: "https://platform.openai.com/api-keys",
  openrouter: "https://openrouter.ai/keys",
  deepseek: DEEPSEEK_KEY_PAGE,
}

const SERVICE_NAME: Record<KeyPageProvider, string> = { openai: "OpenAI", openrouter: "OpenRouter", deepseek: "DeepSeek" }

/** What the person is told about the cost of what was measured here; only services that were measured have one. */
const MEASURED_COST: Partial<Record<KeyPageProvider, string>> = {
  deepseek: `做一个 ${DEEPSEEK_MEASURED_THINGS} 样东西的小模组，实测大约 ${DEEPSEEK_COST_RANGE.low}–${DEEPSEEK_COST_RANGE.high} 元（${DEEPSEEK_COST_MONTH}，按 DeepSeek 官网价格）。`,
}
/** Without a measurement the line says only what is true: the price follows the model picked. */
const UNMEASURED_COST = "花费看所选模型。"

/**
 * The one line on the connect step for every ready-made service: where to create a key, that it is paid by use, then what it
 * costs. `link` is the clickable part.
 */
export function keyWords(provider: KeyPageProvider) {
  return {
    before: "到 ",
    link: `${SERVICE_NAME[provider]} 的密钥页面`,
    after: ` 创建密钥，按用量付费。${MEASURED_COST[provider] ?? UNMEASURED_COST}`,
  }
}

/**
 * The small print under each choice on the provider step: one fact a first-time person can use. Paid-by-use is said on the
 * connect step, so only DeepSeek, the one with a measured cost, carries it here.
 */
export const PROVIDER_NOTES: Record<KeyPageProvider, string> = {
  openai: "要另外开通 API，ChatGPT 的会员不包含这个密钥",
  openrouter: "一个账号可以用多家模型",
  deepseek: `做一个小模组实测约 ${DEEPSEEK_COST_RANGE.low}–${DEEPSEEK_COST_RANGE.high} 元`,
}

export const OPENAI_URL = "https://api.openai.com/v1"
export const OPENROUTER_URL = "https://openrouter.ai/api/v1"

export type ProviderId = KeyPageProvider | "custom"

/** The same service address, spelled loosely (a trailing slash, an empty address meaning OpenAI's own). */
export function sameEndpoint(left: string, right: string) {
  try {
    const a = new URL(left.trim() || OPENAI_URL)
    const b = new URL(right.trim() || OPENAI_URL)
    return (
      a.protocol === b.protocol &&
      a.hostname === b.hostname &&
      a.port === b.port &&
      a.pathname.replace(/\/+$/, "") === b.pathname.replace(/\/+$/, "")
    )
  } catch {
    return left.trim().replace(/\/$/, "") === right.trim().replace(/\/$/, "")
  }
}

/** Which service an address belongs to; an empty address is the default one, OpenAI. */
export function endpointProvider(value: { baseUrl: string }): ProviderId {
  if (!value.baseUrl.trim()) return "openai"
  if (sameEndpoint(value.baseUrl, OPENAI_URL)) return "openai"
  if (sameEndpoint(value.baseUrl, OPENROUTER_URL)) return "openrouter"
  if (sameEndpoint(value.baseUrl, DEEPSEEK_URL)) return "deepseek"
  return "custom"
}

/** The service a saved connection already uses. Someone who has saved nothing has chosen none, and picks on the first look. */
export function providerFrom(value: { baseUrl: string; hasApiKey: boolean }): ProviderId | undefined {
  return value.hasApiKey || value.baseUrl.trim() ? endpointProvider(value) : undefined
}
