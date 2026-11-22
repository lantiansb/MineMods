import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  DEEPSEEK_COST_MONTH,
  DEEPSEEK_COST_RANGE,
  DEEPSEEK_KEY_PAGE,
  DEEPSEEK_MEASURED_COST_YUAN,
  DEEPSEEK_MODEL,
  DEEPSEEK_URL,
  KEY_PAGE_PROVIDERS,
  PROVIDER_KEY_PAGE,
  PROVIDER_NOTES,
  endpointProvider,
  keyWords,
  providerFrom,
  deepseekDraft,
} from "../src/ai-providers"
import { StudioRequestSchema } from "../src/main/protocol"

const screen = readFileSync(path.join(import.meta.dir, "../src/renderer/features/connection-settings.tsx"), "utf8")

test("选了 DeepSeek：地址和模型自动填好，画图模型留空，只剩密钥要粘贴", () => {
  const before = {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5",
    routerModel: "gpt-5-mini",
    moduleModel: "gpt-5",
    imageModel: "gpt-image-1",
    review: true,
  }
  const after = deepseekDraft(before)
  expect(after.baseUrl).toBe("https://api.deepseek.com")
  expect([after.model, after.routerModel, after.moduleModel]).toEqual(["deepseek-flash", "deepseek-flash", "deepseek-flash"])
  expect("imageModel" in after).toBe(false)
  expect(after.review).toBe(true)
  expect(DEEPSEEK_URL).toBe("https://api.deepseek.com")
  expect(DEEPSEEK_MODEL).toBe("deepseek-flash")
})

test("界面里 DeepSeek 排在「其他服务」前面，三个原有选项的顺序不变；填好的就是这组常量", () => {
  const order = [...screen.matchAll(/\{ id: "(\w+)", label: "([^"]+)"/g)].map((match) => match[2])
  expect(order).toEqual(["OpenAI 官方", "OpenRouter", "DeepSeek", "其他服务（自己填地址）"])
  expect(screen).toContain("deepseekDraft(previous)")
  expect(screen).toContain("url: DEEPSEEK_URL")
})

test("取密钥的说明：链接存在、点开走固定页面（窗口只说是哪家，不传地址），文案如实", () => {
  expect(DEEPSEEK_KEY_PAGE).toBe("https://platform.deepseek.com/api_keys")
  expect(PROVIDER_KEY_PAGE.deepseek).toBe(DEEPSEEK_KEY_PAGE)
  expect(screen).toContain('class="link-button"')
  expect(screen).toContain("props.onOpenKeyPage(presetWords()!.id)")
  const words = keyWords("deepseek")
  expect(words.link).toContain("DeepSeek")
  const line = words.before + words.link + words.after
  expect(line).toContain("按用量付费")
  expect(line).toContain("6–9 样")
  expect(line).toContain(DEEPSEEK_COST_MONTH)
  expect(line).toContain("DeepSeek 官网价格")
  for (const boast of ["推荐", "最好", "最便宜", "免费"]) expect(line).not.toContain(boast)
})

test("文案里的花费区间把每一次实测都包在里面，和代码常量一致", () => {
  expect([...DEEPSEEK_MEASURED_COST_YUAN]).toEqual([4.0, 5.13, 3.23, 4.52, 5.48])
  expect(DEEPSEEK_COST_RANGE).toEqual({ low: 3, high: 6 })
  expect(keyWords("deepseek").after).toContain(`${DEEPSEEK_COST_RANGE.low}–${DEEPSEEK_COST_RANGE.high} 元`)
  // Every measured mod sits inside what the sentence says, unrounded: the span is widened to whole yuan, never cut.
  for (const yuan of DEEPSEEK_MEASURED_COST_YUAN) {
    expect(yuan).toBeGreaterThanOrEqual(DEEPSEEK_COST_RANGE.low)
    expect(yuan).toBeLessThanOrEqual(DEEPSEEK_COST_RANGE.high)
  }
})

test("打开密钥页面的请求只认已知的服务名，任意地址被拒绝", () => {
  expect(StudioRequestSchema.safeParse({ method: "openProviderKeyPage", input: { provider: "deepseek" } }).success).toBe(true)
  expect(StudioRequestSchema.safeParse({ method: "openProviderKeyPage", input: { provider: "evil", url: "https://example.com" } }).success).toBe(false)
  expect(StudioRequestSchema.safeParse({ method: "openProviderKeyPage", input: { provider: "deepseek", url: "https://example.com" } }).success).toBe(false)
})

test("每个有固定官网的服务都有密钥页链接，页面在主进程的固定表里，请求只传服务名", () => {
  expect([...KEY_PAGE_PROVIDERS]).toEqual(["openai", "openrouter", "deepseek"])
  expect(PROVIDER_KEY_PAGE.openai).toBe("https://platform.openai.com/api-keys")
  expect(PROVIDER_KEY_PAGE.openrouter).toBe("https://openrouter.ai/keys")
  for (const provider of KEY_PAGE_PROVIDERS) {
    expect(PROVIDER_KEY_PAGE[provider]).toMatch(/^https:\/\//)
    expect(StudioRequestSchema.safeParse({ method: "openProviderKeyPage", input: { provider } }).success).toBe(true)
    expect(StudioRequestSchema.safeParse({ method: "openProviderKeyPage", input: { provider, url: "https://example.com" } }).success).toBe(false)
    // The same line for every service: where to create the key, then paid by use.
    const words = keyWords(provider)
    expect(words.before).toBe("到 ")
    expect(words.link).toMatch(/的密钥页面$/)
    expect(words.after).toMatch(/^ 创建密钥，按用量付费。/)
  }
  expect(StudioRequestSchema.safeParse({ method: "openProviderKeyPage", input: { provider: "custom" } }).success).toBe(false)
  // 「其他服务」 has no fixed site, so the screen shows its own words and no link for it.
  expect(screen).toContain('id === "custom" ? undefined')
  // The window passes the service name only; no address is written in it.
  expect(screen).not.toMatch(/openExternal|platform\.openai\.com|openrouter\.ai\/keys/)
})

test("花费只出现在有实测的那家；没有实测的如实说看所选模型，不编数字", () => {
  const line = (provider: "openai" | "openrouter" | "deepseek") => keyWords(provider).after
  expect(line("deepseek")).toMatch(/\d+–\d+ 元/)
  for (const provider of ["openai", "openrouter"] as const) {
    expect(line(provider)).not.toMatch(/\d/)
    expect(line(provider)).not.toContain("实测")
    expect(line(provider)).toContain("花费看所选模型")
    expect(PROVIDER_NOTES[provider]).not.toMatch(/\d|元/)
  }
  expect(PROVIDER_NOTES.deepseek).toContain(`${DEEPSEEK_COST_RANGE.low}–${DEEPSEEK_COST_RANGE.high} 元`)
})

test("选项小字是一句对新手有用的事实，不说推荐", () => {
  expect(PROVIDER_NOTES.openai).toBe("要另外开通 API，ChatGPT 的会员不包含这个密钥")
  expect(PROVIDER_NOTES.openrouter).toBe("一个账号可以用多家模型")
  for (const note of Object.values(PROVIDER_NOTES)) {
    for (const word of ["推荐", "最好", "最便宜", "免费", "官方服务"]) expect(note).not.toContain(word)
  }
  expect(screen).toContain("note: PROVIDER_NOTES.openai")
  expect(screen).toContain("note: PROVIDER_NOTES.openrouter")
  expect(screen).toContain("note: PROVIDER_NOTES.deepseek")
})

test("第一次打开不预先选中任何一家，没选就不能点「下一步」；存过连接的仍选中当前那家", () => {
  // Nothing saved: no key and no address.
  expect(providerFrom({ baseUrl: "", hasApiKey: false })).toBeUndefined()
  // Saved: the one the address belongs to.
  expect(providerFrom({ baseUrl: "", hasApiKey: true })).toBe("openai")
  expect(providerFrom({ baseUrl: "https://api.openai.com/v1/", hasApiKey: true })).toBe("openai")
  expect(providerFrom({ baseUrl: "https://openrouter.ai/api/v1", hasApiKey: true })).toBe("openrouter")
  expect(providerFrom({ baseUrl: "https://api.deepseek.com", hasApiKey: true })).toBe("deepseek")
  expect(providerFrom({ baseUrl: "https://relay.example/v1", hasApiKey: true })).toBe("custom")
  expect(providerFrom({ baseUrl: "https://relay.example/v1", hasApiKey: false })).toBe("custom")
  // What the draft stands on before a pick is still the default service, so picking it does not wipe the default models.
  expect(endpointProvider({ baseUrl: "" })).toBe("openai")
  // The screen: the next button waits for a pick on the provider step.
  expect(screen).toContain('!!provider() && hasListCredential()')
  expect(screen).toContain("createSignal<ProviderId | undefined>(providerFrom(props.connection))")
})

test("连接那一步对每个预设用同一行，不再有各家各自的「粘贴你在……拿到的密钥」", () => {
  expect(screen).not.toContain("粘贴你在")
  expect(screen).not.toContain("使用 DeepSeek 的官方服务")
  expect(screen).toContain("keyWords(id)")
})
