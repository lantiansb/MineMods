import { For, Show, createSignal } from "solid-js"
import { MODEL_POLICY } from "@minemods/studio-ai/policy"
import { editableConnection, reviewEnabled } from "../../connection"
import { advanced } from "../advanced"
import { CardShell } from "./project-assets"
import type {
  PublicConnection,
  SaveConnectionInput,
  ConnectionTestResult,
  ListConnectionModelsInput,
} from "../../connection"
import type { McpConnectionStatus } from "../../mcp-status"
import { Button, Icon } from "../ui"
import { REVIEW_SWITCH } from "@minemods/studio-ai/making"
import { IMAGE_MODEL_WORDS, MODE_WORDS, MODEL_ROLE_WORDS, WORDS } from "../words"
import "./connection-settings.css"
import { Fold } from "../fold"
import { REVIEW_OUTSIDE } from "./settings-words"
import { ConnectAi } from "./connect-ai"
import {
  DEEPSEEK_URL,
  OPENAI_URL,
  OPENROUTER_URL,
  PROVIDER_NOTES,
  deepseekDraft,
  endpointProvider,
  keyWords,
  providerFrom,
  sameEndpoint,
  type KeyPageProvider,
  type ProviderId,
} from "../../ai-providers"
import { type AiClientDetection, type AiClientId, type ConnectResult } from "../../ai-clients"

/** The choices in the order they are shown; 「其他服务」 stays last. `url` is filled in for the ready-made ones. */
const PROVIDERS: { id: ProviderId; label: string; note: string; icon: "cube" | "share" | "settings"; url?: string }[] = [
  { id: "openai", label: "OpenAI 官方", note: PROVIDER_NOTES.openai, icon: "cube", url: OPENAI_URL },
  { id: "openrouter", label: "OpenRouter", note: PROVIDER_NOTES.openrouter, icon: "share", url: OPENROUTER_URL },
  { id: "deepseek", label: "DeepSeek", note: PROVIDER_NOTES.deepseek, icon: "cube", url: DEEPSEEK_URL },
  { id: "custom", label: "其他服务（自己填地址）", note: "官方直连或中转服务都可以", icon: "settings" },
]
const providerWords = (id: ProviderId) => PROVIDERS.find((item) => item.id === id)!

function officialOpenAiEndpoint(value: string) {
  try {
    const url = new URL(value.trim() || OPENAI_URL)
    return url.protocol === "https:" && url.hostname === "api.openai.com" && url.pathname.replace(/\/+$/, "") === "/v1"
  } catch {
    return false
  }
}

function cleanError(cause: unknown) {
  return cause instanceof Error
    ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
    : "操作失败，请重试。"
}

const ASSISTANT_MODE = "mcp"

export function ConnectionSettings(props: {
  status: string
  connection: PublicConnection
  mcp?: McpConnectionStatus
  onSave: (input: SaveConnectionInput) => Promise<void>
  onTest: (input: SaveConnectionInput) => Promise<ConnectionTestResult>
  onCopy: () => Promise<void>
  projectName?: string
  /** `role`: with 「审查」 on there are two hand-offs, one for the AI that makes and one for the AI that reviews. */
  onCopyHandoff: (role?: "maker" | "reviewer") => Promise<void>
  onGetHandoff: (role?: "maker" | "reviewer") => Promise<string>
  /** 一键接上: the assistants on this computer, writing Studio into one's settings, and the page to get one. */
  onDetectClients: () => Promise<AiClientDetection>
  onConnectClient: (client: AiClientId) => Promise<ConnectResult>
  onOpenDownload: (client: AiClientId) => Promise<void>
  /** Opens the page where a ready-made service gives out keys. */
  onOpenKeyPage: (provider: KeyPageProvider) => Promise<void>
  onCopyText: (text: string) => Promise<void>
  onListModels?: (input: ListConnectionModelsInput) => Promise<string[]>
  onDone?: () => void
}) {
  const [step, setStep] = createSignal(1)
  const [mode, setMode] = createSignal(props.connection.source === "none" ? ASSISTANT_MODE : props.connection.mode)
  const [provider, setProvider] = createSignal<ProviderId | undefined>(providerFrom(props.connection))
  const [draft, setDraft] = createSignal(editableConnection(props.connection))
  const [key, setKey] = createSignal("")
  const [clear, setClear] = createSignal(false)
  const [written, setWritten] = createSignal(false)
  const [verifiedInput, setVerifiedInput] = createSignal("")
  const verified = () => verifiedInput() === JSON.stringify(input())
  const setVerified = (ok:boolean) => setVerifiedInput(ok ? JSON.stringify(input()) : "")
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const [models, setModels] = createSignal<string[]>([])
  const [pictureModels, setPictureModels] = createSignal<string[]>([])
  const [modelsError, setModelsError] = createSignal("")
  const [handoff, setHandoff] = createSignal("")
  const selectedProvider = () => provider() ?? endpointProvider(props.connection)
  const chooseMode = (choice: "api" | "mcp") => {
    if (mode() !== choice) { setVerified(false); setWritten(false); setNotice(""); setError("") }
    setMode(choice)
  }
  const presetWords = () => {
    const id = selectedProvider()
    return id === "custom" ? undefined : { id, ...keyWords(id) }
  }
  const providerBaseUrl = () => providerWords(selectedProvider()).url ?? draft().baseUrl
  const importAllowed = () =>
    selectedProvider() === "openai" &&
    props.connection.hasApiKey &&
    officialOpenAiEndpoint(providerBaseUrl()) &&
    officialOpenAiEndpoint(props.connection.baseUrl) &&
    props.connection.source !== "none"
  const hasListCredential = () =>
    Boolean(
      key().trim() ||
        (props.connection.hasApiKey && !clear() && sameEndpoint(providerBaseUrl(), props.connection.baseUrl)),
    )
  const input = (): SaveConnectionInput => ({
    ...draft(),
    mode: mode(),
    baseUrl: providerBaseUrl(),
    ...(key().trim() ? { apiKey: key().trim() } : {}),
    ...(clear() && !key().trim() ? { clearApiKey: true } : {}),
  })

  const act = async (action: () => Promise<unknown>, success: string) => {
    setPending(true)
    setNotice("")
    setError("")
    try {
      await action()
      setNotice(success)
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setPending(false)
    }
  }

  const chooseProvider = (value: ProviderId) => {
    const providerChanged = selectedProvider() !== value
    const nextBaseUrl = providerWords(value).url ?? (selectedProvider() === "custom" ? draft().baseUrl : "")
    setProvider(value)
    setDraft((previous) =>
      value === "deepseek" && providerChanged
        ? deepseekDraft(previous)
        : {
            ...previous,
            baseUrl: nextBaseUrl,
            ...(providerChanged ? { model: value === "openrouter" ? "openai/" + MODEL_POLICY.model : MODEL_POLICY.model, routerModel: value === "openrouter" ? "openai/" + MODEL_POLICY.model : MODEL_POLICY.model, moduleModel: value === "openrouter" ? "openai/" + MODEL_POLICY.model : MODEL_POLICY.model } : {}),
          },
    )
    setKey("")
    setClear(providerChanged || !sameEndpoint(props.connection.baseUrl, nextBaseUrl))
    setModels([])
    setPictureModels([])
    setModelsError("")
  }

  const model = (value: string) =>
    setDraft((previous) => ({
      ...previous,
      model: value,
      routerModel: previous.routerModel === previous.model ? value : previous.routerModel,
      moduleModel: previous.moduleModel === previous.model ? value : previous.moduleModel,
    }))

  const listModels = async () => {
    if (!props.onListModels) return
    setPending(true)
    setModelsError("")
    try {
      const listed = await props.onListModels({ baseUrl: providerBaseUrl(), ...(key().trim() ? { apiKey: key().trim() } : {}) })
      const values = listed.filter((value) => !/embedding|whisper|\btts\b|transcrib|dall-e|gpt-image|moderation|realtime/i.test(value))
      setPictureModels(listed.filter((value) => /dall-e|gpt-image/i.test(value)))
      setModels(values)
      if (values.length && !values.includes(draft().model)) model(values[0]!)
    } catch (cause) {
      setModelsError(cleanError(cause))
    } finally {
      setPending(false)
    }
  }

  const clearSavedKey = async () => {
    await act(() => props.onSave({ ...editableConnection(props.connection), clearApiKey: true }), "已清除本机密钥")
    setKey("")
    setClear(true)
  }

  const reviewing = () => reviewEnabled({ ...props.connection, ...draft(), mode: mode() })
  const prepared = () => mode() === "mcp" ? written() || !!props.mcp?.enabled : !!provider() && hasListCredential() && (provider() !== "custom" || !!draft().baseUrl.trim())
  const disabledReason = () => {
    if (pending()) return "请稍等。"
    if (step() !== 2 || prepared()) return ""
    if (mode() === ASSISTANT_MODE) return "先接上助手，或打开连接后按手动步骤操作。"
    if (!provider()) return "先选一家 AI 服务商。"
    if (provider() === "custom" && !draft().baseUrl.trim()) return "请填写服务地址。"
    return "请填写这家服务商的密钥。"
  }
  const connectClient = async (client: AiClientId) => {
    setWritten(false)
    const result = await props.onConnectClient(client)
    if (result.ok && (props.connection.mode !== ASSISTANT_MODE || props.connection.source === "none")) {
      await props.onSave({ ...editableConnection(props.connection), mode: ASSISTANT_MODE })
    }
    return result
  }
  const success = () => mode() === "mcp" ? !!props.mcp?.connected && props.connection.mode === "mcp" : verified()
  const saveOption = async (patch: Partial<SaveConnectionInput>) => {
    if (mode() === "mcp") await props.onSave({ ...editableConnection(props.connection), ...patch, mode: "mcp" })
    setDraft({ ...draft(), ...patch })
    setVerified(false)
  }
  const verify = async () => {
    setVerified(false)
    const current = input()
    await props.onTest(current)
    await props.onSave(current)
    setVerified(true)
  }
  const goBack = () => { setVerified(false); setNotice(""); setError(""); setStep(step()-1) }
  return <CardShell title="连接 AI" manageFocus onClose={() => props.onDone?.()} head={<span role="status" class="wizard-status">{props.status}</span>}>
    <section class="connection-settings connection-wizard">
      <ol class="wizard-steps" aria-label="连接步骤"><For each={["选谁来做","接上","试一下"]}>{(title,i) =>
        <li aria-current={step() === i()+1 ? "step" : undefined} data-done={i()===0 ? step()>1 : i()===1 ? prepared() : step()===3 && success()}>
          <span>{(i()===0 ? step()>1 : i()===1 ? prepared() : step()===3 && success()) ? "✓" : i()+1}</span>{title}</li>}</For></ol>
      <small>第 {step()} 步 / 共 3 步</small>
      <Show when={step()===1}><h2>你想让谁来替你做？</h2>        <div class="connection-modes" role="group" aria-label="谁来做">
          <button
            type="button"
            class={mode() === "api" ? "selected" : ""}
            aria-pressed={mode() === "api"}
            disabled={pending()}
            onClick={() => chooseMode("api")}
          >
            <Icon name="settings" />
            <strong>{MODE_WORDS.api.name}</strong>
            <span>{MODE_WORDS.api.note}</span>
            <i aria-hidden="true" />
          </button>
          <button
            type="button"
            class={mode() === "mcp" ? "selected" : ""}
            aria-pressed={mode() === "mcp"}
            disabled={pending()}
            onClick={() => chooseMode("mcp")}
          >
            <Icon name="cube" />
            <strong>{MODE_WORDS.mcp.name}</strong>
            <span>{MODE_WORDS.mcp.note}</span>
            <i aria-hidden="true" />
          </button>
        </div>
</Show>
      <Show when={step()===2 && mode()==="api"}><h2>用哪一家的 AI？</h2>        <div class="provider-list" role="radiogroup" aria-label="AI 厂商">
          <For each={PROVIDERS}>
            {(item) => (
              <button
                type="button"
                class={provider() === item.id ? "selected" : ""}
                role="radio"
                aria-checked={provider() === item.id}
                disabled={pending()}
                onClick={() => chooseProvider(item.id)}
              >
                <Icon name={item.icon} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.note}</small>
                </span>
                <i aria-hidden="true" />
              </button>
            )}
          </For>
        </div>
<Show when={provider()}>          <p>
            {presetWords() ? (
              <>
                {presetWords()!.before}
                <button type="button" class="link-button" onClick={() => void props.onOpenKeyPage(presetWords()!.id)}>
                  {presetWords()!.link}
                </button>
                {presetWords()!.after}
              </>
            ) : (
              "请输入服务地址和 密钥。"
            )}
          </p>
        <div class="credential-fields">
          <Show when={selectedProvider() === "custom"}>
            <label class="field">
              <span>服务地址</span>
              <input
                aria-label="服务地址"
                value={draft().baseUrl}
                placeholder="https://your-service.example/v1"
                disabled={pending()}
                spellcheck={false}
                onInput={(event) => {
                  setDraft({ ...draft(), baseUrl: event.currentTarget.value })
                  setKey("")
                  setClear(true)
                }}
              />
            </label>
          </Show>
          <label class="field">
            <span>密钥</span>
            <div class="credential-input">
              <Icon name="settings" />
              <input
                aria-label="密钥"
                type="password"
                autocomplete="off"
                value={key()}
                placeholder={props.connection.hasApiKey && !clear() ? "已保存，留空表示保留" : "粘贴 密钥"}
                disabled={pending()}
                onInput={(event) => setKey(event.currentTarget.value)}
              />
            </div>
            <small>密钥由系统加密保存在本机。</small>
          </label>
          <Show when={importAllowed()}>
            <button
              class="import-config"
              type="button"
              disabled={pending()}
              onClick={() => {
                setClear(false)
                setKey("")
                setNotice("已导入检测到的本机配置")
              }}
            >
              <Icon name="download" />
              导入检测到的本机配置
            </button>
            <small class="import-note">已检测到同源的 OpenAI 官方配置，可安全导入。</small>
          </Show>
          <Show when={props.connection.hasApiKey}>
            <button class="clear-key" type="button" disabled={pending()} onClick={() => void clearSavedKey()}>
              清除已保存的 密钥
            </button>
          </Show>
        </div>
</Show></Show>
      <Show when={step()===2 && mode()==="mcp"}><ConnectAi detect={props.onDetectClients} connect={connectClient} download={props.onOpenDownload}
        onConnected={() => setWritten(true)} status={props.mcp} pending={pending()}
        onEnable={() => void act(async () => {
          await props.onSave({ ...editableConnection(props.connection), mode: ASSISTANT_MODE })
          setWritten(true)
        }, "已打开连接，可以到助手里接上 Studio。")}
        onCopyHandoff={() => void act(() => props.onCopyHandoff("maker"), "已复制接入说明")}
        onCopyText={text => void act(() => props.onCopyText(text), "已复制接入设置")} /></Show>
      <Show when={step()===3}><h2>试一下</h2>
        <Show when={mode()==="mcp"} fallback={<Button disabled={pending()} onClick={()=>void act(verify,"连接成功")}>验证并连接</Button>}>
          <p>到你的 AI 助手里新开一个对话，粘贴起步说明。</p>
          <Button onClick={()=>void act(()=>props.onCopyHandoff("maker"),"已复制起步说明")}>复制起步说明</Button>
          <p role="status">{success() ? "接上了" : "正在等它接上……"}</p>
        </Show>
        <Show when={advanced()}><section class="wizard-advanced"><h3>连接参数</h3>
          <label><input type="checkbox" checked={reviewing()} disabled={pending()} onChange={e=>void act(()=>saveOption({review:!reviewing()}),"已更新审查设置")} />审查</label>
          <label><input type="checkbox" checked={draft().particleLook!==false} disabled={pending()} onChange={()=>void act(()=>saveOption({particleLook:draft().particleLook===false}),"已更新粒子设置")} />粒子要看图</label>
          <p>{REVIEW_SWITCH.maker_model}</p><p>{REVIEW_SWITCH.epic_models}</p>
          <Show when={mode()==="api"} fallback={<>
            <Button onClick={()=>void act(async()=>setHandoff(await props.onGetHandoff("maker")),"")}>查看完整起步说明</Button>
            <Show when={handoff()}><textarea readonly value={handoff()} aria-label="完整起步说明" /></Show>
            <Show when={reviewing()}><p>{REVIEW_OUTSIDE.card}</p><Button onClick={()=>void act(()=>props.onCopyHandoff("reviewer"),"已复制审查说明")}>复制给审查的 AI</Button></Show>
            <label>MCP 配置<textarea readonly value={props.mcp?.configuration ?? ""} /></label><Button onClick={()=>void act(props.onCopy,"已复制连接配置")}>复制连接配置</Button>
            <Show when={props.mcp?.codexConfiguration}><label>Codex 配置（config.toml）<textarea readonly value={props.mcp?.codexConfiguration ?? ""}/></label><Button onClick={()=>void act(()=>props.onCopyText(props.mcp!.codexConfiguration!),"已复制 Codex 配置")}>复制 Codex 配置</Button></Show>
          </>}>        <div class="model-picker">
          <div class="model-picker-row">
            <select
              aria-label="模型"
              value={draft().model}
              disabled={pending()}
              onChange={(event) => model(event.currentTarget.value)}
            >
              <Show when={!models().length}>
                <option value={draft().model}>{draft().model || "暂无模型列表"}</option>
              </Show>
              <For each={models()}>{(value) => <option value={value}>{value}</option>}</For>
            </select>
            <Button
              disabled={pending() || !props.onListModels || !hasListCredential()}
              onClick={() => void listModels()}
            >
              <Icon name="undo" />
              刷新列表
            </Button>
          </div>
          <Show when={!hasListCredential()}>
            <p class="model-list-note">填了这一家的 密钥 以后可以刷新模型列表，也可以展开手动填写。</p>
          </Show>
          <Show when={modelsError()}>
            <p class="model-list-error" role="alert">
              {modelsError()} 可手动填写模型名称。
            </p>
          </Show>
          <Fold class="connection-advanced" summary="手动填写模型名称（可选）">
            <label class="field">
              <span>模型 ID</span>
              <input
                aria-label="模型名称"
                value={draft().model}
                onInput={(event) => model(event.currentTarget.value)}
              />
            </label>
          </Fold>

          <Show when={reviewing()}>
            <Fold class="connection-advanced" summary="审查用的模型">
            <label class="field review-model">
              <span>审查用的模型（可不填）</span>
              <input
                aria-label="审查用的模型"
                placeholder={draft().moduleModel || draft().model}
                value={draft().reviewModel ?? ""}
                onInput={(event) => setDraft((({ reviewModel: _before, ...rest }) => ({ ...rest, ...(event.currentTarget.value.trim() ? { reviewModel: event.currentTarget.value.trim() } : {}) }))(draft()))}
              />
              <small>{REVIEW_SWITCH.api}</small>
            </label>
            </Fold>
          </Show>
          <Fold class="connection-advanced" summary="模型分工">
            <div class="connection-advanced-fields">
              <label class="field">
                {MODEL_ROLE_WORDS.router.name}
                <small>{MODEL_ROLE_WORDS.router.note}</small>
                <input
                  aria-label={MODEL_ROLE_WORDS.router.name}
                  value={draft().routerModel}
                  onInput={(event) => setDraft({ ...draft(), routerModel: event.currentTarget.value })}
                />
              </label>
              <label class="field">
                {MODEL_ROLE_WORDS.maker.name}
                <small>{MODEL_ROLE_WORDS.maker.note}</small>
                <input
                  aria-label={MODEL_ROLE_WORDS.maker.name}
                  value={draft().moduleModel}
                  onInput={(event) => setDraft({ ...draft(), moduleModel: event.currentTarget.value })}
                />
              </label>
              <label class="field">
                {IMAGE_MODEL_WORDS.name}
                <small>{IMAGE_MODEL_WORDS.note}</small>
                <input
                  aria-label={IMAGE_MODEL_WORDS.name}
                  placeholder={IMAGE_MODEL_WORDS.placeholder}
                  list="connection-image-models"
                  value={draft().imageModel ?? ""}
                  onInput={(event) => setDraft((({ imageModel: _before, ...rest }) => ({ ...rest, ...(event.currentTarget.value.trim() ? { imageModel: event.currentTarget.value.trim() } : {}) }))(draft()))}
                />
                <datalist id="connection-image-models">
                  <For each={pictureModels()}>{(value) => <option value={value} />}</For>
                </datalist>
              </label>
              <label class="field">
                语音转写模型
                <input
                  aria-label="语音转写模型"
                  value={draft().transcriptionModel}
                  onInput={(event) => setDraft({ ...draft(), transcriptionModel: event.currentTarget.value })}
                />
              </label>
            </div>
          </Fold>
        </div>
</Show>
        </section></Show>
      </Show>
      <Show when={error()}><p role="alert" class="connection-error">{error()}</p></Show>
      <Show when={notice()}><p role="status">{notice()}</p></Show>
      <footer class="wizard-actions"><Show when={step()>1}><Button disabled={pending()} onClick={goBack}>返回</Button></Show>
        <Show when={step()<3} fallback={<Button primary disabled={pending() || !success()} onClick={props.onDone}>开始做</Button>}>
          <Show when={disabledReason()}><span id="wizard-next-reason" role="status">{disabledReason()}</span></Show>
          <Button primary disabled={!!disabledReason()} aria-describedby={disabledReason() ? "wizard-next-reason" : undefined}
            onClick={()=>{setStep(step()+1);setNotice("");setError("")}}>下一步</Button>
        </Show></footer>
    </section></CardShell>
}
