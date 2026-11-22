import { For, Match, Show, Switch, createSignal, onCleanup, onMount } from "solid-js"
import { AI_CLIENT_NAME, CONNECT_WORDS, connectChoices, connectedLine, type AiClientDetection, type AiClientId, type ConnectResult } from "../../ai-clients"
import { advanced } from "../advanced"
import { Button, Icon } from "../ui"
import { Fold } from "../fold"


/**
 * 一键接上 (broad20, round 22): the first step of 「用我自己的 AI 助手」. Looks at which assistants are on this computer and, for each, offers the
 * button that puts Studio into its settings; with none, says where to get one. Nothing is written until a button is pressed.
 * What is chosen to show lives in `connectChoices`, the words in `ai-clients.ts`, so they are tested without drawing anything.
 */
export function ConnectAi(props: {
  detect: () => Promise<AiClientDetection>
  connect: (client: AiClientId) => Promise<ConnectResult>
  download: (client: AiClientId) => Promise<void>
  onConnected: (client: AiClientId) => void
  status?: { enabled: boolean; configuration: string; codexConfiguration?: string }
  pending: boolean
  onEnable: () => void
  onCopyHandoff: () => void
  onCopyText: (text: string) => void
}) {
  const [found, setFound] = createSignal<AiClientDetection | null>(null)
  const [looking, setLooking] = createSignal(false)
  const [working, setWorking] = createSignal<AiClientId | null>(null)
  const [outcome, setOutcome] = createSignal<ConnectResult | null>(null)
  const [error, setError] = createSignal("")

  const say = (cause: unknown) => (cause instanceof Error && cause.message ? cause.message : "操作失败，请重试。")
  const look = async () => {
    if (looking()) return
    setLooking(true)
    try {
      setFound(await props.detect())
    } catch (cause) {
      setError(say(cause))
    } finally {
      setLooking(false)
    }
  }
  const press = async (client: AiClientId) => {
    setWorking(client)
    setError("")
    setOutcome(null)
    try {
      const result = await props.connect(client)
      setOutcome(result)
      if (result.ok) props.onConnected(client)
      await look()
    } catch (cause) {
      setError(say(cause))
    } finally {
      setWorking(null)
    }
  }
  const open = async (client: AiClientId) => {
    setError("")
    try {
      await props.download(client)
    } catch (cause) {
      setError(say(cause))
    }
  }

  // Someone who goes off to install an assistant comes back to this window: look again then, so the button is there without a search.
  onMount(() => {
    void look()
    const again = () => void look()
    window.addEventListener("focus", again)
    onCleanup(() => window.removeEventListener("focus", again))
  })

  const choices = () => connectChoices(found())
  const files = (client: AiClientId) => found()?.clients.find(item => item.id === client)?.files ?? []
  const changedFiles = () => {
    const result = outcome()
    return result?.ok ? result.files.filter(file => file.change !== "unchanged") : []
  }
  const manual = [
    { client: "claude-desktop", file: "claude_desktop_config.json", value: () => props.status?.configuration ?? "", destination: "把下面的 Studio 设置合入 mcpServers。" },
    { client: "codex", file: "config.toml", value: () => props.status?.codexConfiguration ?? "", destination: "把整段加到文件末尾。接过的助手请先去掉原来同名的一段。" },
  ] as const
  const failed = () => {
    const result = outcome()
    return result && !result.ok ? result : null
  }

  return (
    <div class="mcp-connect">
      <h2>{CONNECT_WORDS.title}</h2>
      <Switch>
        <Match when={choices().kind === "looking"}>
          <p class="mcp-connect-hint" role="status">
            {CONNECT_WORDS.detecting}
          </p>
        </Match>
        <Match when={choices().kind === "install"}>
          <p>{CONNECT_WORDS.install}</p>
          <p class="mcp-connect-hint">{CONNECT_WORDS.quota}</p>
          <div class="mcp-connect-buttons">
            <For each={choices().downloads}>
              {(item) => (
                <Button primary={item.client === "claude-desktop"} onClick={() => void open(item.client)}>
                  <Icon name="arrow" />
                  {item.label}
                </Button>
              )}
            </For>
            <Button disabled={looking()} onClick={() => void look()}>
              {looking() ? CONNECT_WORDS.detecting : CONNECT_WORDS.detect}
            </Button>
          </div>

        </Match>
        <Match when={choices().kind === "connect"}>
          <div class="mcp-connect-buttons">
            <For each={choices().buttons}>
              {(button) => (
                <div class="mcp-connect-choice">
                  <Button primary={button.primary} disabled={button.disabled || props.pending || working() !== null} onClick={() => void press(button.client)}>
                    <Icon name="link" />
                    {working() === button.client ? CONNECT_WORDS.working : button.label}
                  </Button>
                  <For each={files(button.client)}>{path => <small class="assistant-file-path">{path}</small>}</For>
                  <Show when={button.hint}>
                    <small>{button.hint}</small>
                  </Show>
                </div>
              )}
            </For>
          </div>
          <p class="assistant-method-note">一键接入会把下面所示的 Studio 设置写到助手文件里。原文件有备份，撤回时用备份换回原文件，或只去掉 Studio 那一段。</p>
        </Match>
      </Switch>
      <div class="assistant-manual-actions">
        <Button disabled={props.pending || working() !== null} onClick={props.onCopyHandoff}>只复制接入说明</Button>
        <Button disabled={props.pending || working() !== null || props.status?.enabled} onClick={props.onEnable}>
          {props.status?.enabled ? "连接已打开" : "打开连接"}
        </Button>
      </div>
      <p class="assistant-method-note">复制接入说明和打开连接都不会改助手的设置文件。</p>
      <Fold class="connection-advanced" summary="手动接入">
        <p>先打开连接，找到你的助手对应的文件。保存后重新打开助手，新开一个对话并粘贴接入说明。</p>
        <For each={manual}>{item => (
          <section class="assistant-manual-file">
            <h3>{AI_CLIENT_NAME[item.client]} · {item.file}</h3>
            <For each={files(item.client)}>{path => <small class="assistant-file-path">{path}</small>}</For>
            <p>{item.destination}保留其余设置。</p>
            <textarea readonly rows={4} aria-label={AI_CLIENT_NAME[item.client] + " 的接入设置"} value={item.value()} />
            <Button disabled={props.pending || !item.value()} onClick={() => props.onCopyText(item.value())}>复制 {AI_CLIENT_NAME[item.client]} 的设置</Button>
          </section>
        )}</For>
      </Fold>
      <Show when={outcome()}>
        {(result) => (
          <p class={result().ok ? "mcp-connect-done" : "connection-error"} role={result().ok ? "status" : "alert"}>
            {connectedLine(result())}
          </p>
        )}
      </Show>
      <For each={changedFiles()}>{file => (
        <small class="assistant-file-path">
          改动文件：{file.path}。{file.backup ? "备份：" + file.backup : "原先没有这个文件，撤回时去掉 Studio 那一段。"}
        </small>
      )}</For>
      {/* Where the trouble was: for the person to find the file, or to tell someone; the sentence above is the explanation. */}
      <Show when={advanced() && failed()}>
        {(result) => (
          <small class="mcp-connect-detail">
            {AI_CLIENT_NAME[result().client]}
            {result().path ? ` · ${result().path}` : ""}
            {result().backup ? ` · 备份：${result().backup}` : ""}
            {result().detail ? ` · ${result().detail}` : ""}
          </small>
        )}
      </Show>
      <Show when={error()}>
        <p class="connection-error" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  )
}
