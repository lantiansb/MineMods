import { toolCopy } from "./creator-card-copy"
import { WORDS } from "../words"
import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { ToolsView } from "../../api"
import { Button } from "../ui"
import { advanced } from "../advanced"
import { Fold } from "../fold"
import "./tools-panel.css"

/**
 * The tools page: every tool an outside AI may ask Studio to run, what each runs or reaches, and what it waits for — the person's look at a new one before it is
 * turned on, a key it needs, a program Studio looks after (ffmpeg: downloaded here, held to its release's sha256, or the person's own copy). The list follows the
 * tools folder as it changes (a tool put in or taken out is there or gone without restarting).
 */

const STATE_WORDS: Record<ToolsView["tools"][number]["state"], string> = {
  ready: "可以用",
  unapproved: "等你看过再启用",
  disabled: "停用了",
  invalid: "说明写得不对",
  missing_program: "缺程序",
  missing_secret: "缺密钥",
}
const ROLE_WORDS: Record<string, string> = { generate: "生成", convert: "转换", check: "检查" }
const MEDIUM_WORDS: Record<string, string> = { sound: "声音", image: "图片", video: "视频" }

const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  "sound-synth": "在这台电脑上合成吼声、撞击声或风声等声音，再保存到工程里。",
  "delegate-sound": "让连接的 AI 制作一段声音，交回 Studio 转成游戏能用的格式。",
  "delegate-image": "让连接的 AI 画一张图，例如模型的六视图，再交回 Studio。",
  "scene-record": "录下这个工程的测试场窗口，存作检查材料。录制时请让游戏窗口保持打开。",
  "video-frames": "从录像里按时间间隔取出画面，供你或 AI 逐张检查。",
}

const toolTitle = (tool: ToolsView["tools"][number]) =>
  ({ "sound-synth": "合成声音", "delegate-sound": "让 AI 生成声音", "delegate-image": "让 AI 生成图片" })[tool.id as "sound-synth" | "delegate-sound" | "delegate-image"] ?? tool.title

export function ToolsPanel() {
  const [view, setView] = createSignal<ToolsView>()
  const [busy, setBusy] = createSignal(false)
  const [said, setSaid] = createSignal("")
  const [keys, setKeys] = createSignal<Record<string, string>>({})
  const errorText = (cause: unknown) => (cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(cause))
  const reload = () => window.studio.listTools().then(setView, (cause: unknown) => setSaid(errorText(cause)))
  const perform = async (work: () => Promise<unknown>, done?: string) => {
    if (busy()) return
    setBusy(true)
    setSaid("")
    try {
      await work()
      if (done) setSaid(done)
      await reload()
    } catch (cause) {
      setSaid(errorText(cause))
    } finally {
      setBusy(false)
    }
  }
  onMount(() => {
    void reload()
    // Main says "tools" when the folder changed or a key was saved.
    onCleanup(window.studio.onCommand((command) => command === "tools" && void reload()))
  })

  return (
    <section class="panel tools-panel" aria-label="工具">
      <div>
        <p>做声音、画图或处理录像时，可以用这里的工具。每张卡会告诉你现在能不能用、还需要准备什么。</p>
        <Show when={advanced()}><p class="resource-path">{view()?.folder}</p></Show>
        <Show when={said()}>
          <p class="muted" role="status">{said()}</p>
        </Show>
      </div>
      <For each={view()?.programs}>
        {(program) => (
          <section class="panel resource-item">
            <header>
              <h3>{advanced() ? program.title : WORDS.converter}</h3>
              <span>{program.path ? (program.auto ? "自动找到 · 本机已装的" : program.own ? "已安装 · 使用本机版本" : "已安装 · Studio 下载") : "还没安装"}</span>
            </header>
            <Show when={program.path} fallback={<p class="muted">声音转换和录像抽帧要用它。可以让 Studio 从发布页下载（约 160 MB，下载后会检查文件是否完整），也可以指定你电脑上已有的。</p>}>
              <Show when={advanced()} fallback={<p>声音转换和录像抽帧可以用了。</p>}><p class="resource-path">{program.path}</p></Show>
            </Show>
            <Show when={advanced()}><p class="muted">许可：{program.license}</p></Show>
            <div class="page-actions">
              <Button disabled={busy()} onClick={() => void perform(() => window.studio.installProgram({ id: "ffmpeg" }), "转换工具下载好了。")}>
                {program.path && !program.own && !program.auto ? "重新下载" : "下载"}
              </Button>
              <Button disabled={busy()} onClick={() => void perform(() => window.studio.chooseOwnProgram({ id: "ffmpeg" }))}>
                用我自己的
              </Button>
            </div>
          </section>
        )}
      </For>
      <div class="resource-items">
        <For each={view()?.tools}>
          {(tool) => (
            <section class="panel resource-item">
              <header>
                <h3>{toolTitle(tool)}</h3>
                <span>
                  {ROLE_WORDS[tool.role] ?? tool.role}
                  {MEDIUM_WORDS[tool.medium] ?? ""} · {STATE_WORDS[tool.state]}
                </span>
              </header>
              <p class="muted">{BUILTIN_DESCRIPTIONS[tool.id] ?? (toolCopy(tool.description) || "查看下面的运行方式和使用条件。")}</p>
              <Show when={tool.problem && tool.state !== "ready"}>
                <p role="status">{tool.state === "missing_program" ? `先安装${WORDS.converter}，才能使用这个工具。` : tool.state === "missing_secret" ? "在下方填好密钥，就能使用这个工具。" : toolCopy(tool.problem ?? "") || STATE_WORDS[tool.state]}</p>
              </Show>
              <Show when={tool.runs}>
                <Fold summary="它会运行什么、连到哪里" open={tool.state === "unapproved"}>
                  <p class="resource-path">{tool.builtin && !advanced() ? "使用 Studio 自带的工具处理所选文件。" : tool.runs}</p>
                </Fold>
              </Show>
              <For each={tool.secrets}>
                {(name) => (
                  <label class="field">
                    密钥 {name}
                    {view()?.secrets.includes(name) ? "（已存）" : ""}
                    <input type="password" autocomplete="off" value={keys()[name] ?? ""} onInput={(event) => setKeys({ ...keys(), [name]: event.currentTarget.value })} />
                    <Button disabled={busy() || !(keys()[name] ?? "").trim()} onClick={() => void perform(async () => {
                      await window.studio.saveToolSecret({ name, value: keys()[name] ?? "" })
                      setKeys({ ...keys(), [name]: "" })
                    }, `密钥 ${name} 存好了（加密保存在这台电脑上，不会交给外部 AI）。`)}>
                      存
                    </Button>
                  </label>
                )}
              </For>
              <div class="page-actions">
                <Show when={tool.state === "unapproved" && tool.sha256}>
                  <Button disabled={busy()} onClick={() => void perform(() => window.studio.approveTool({ id: tool.id, sha256: tool.sha256! }), `启用了「${toolTitle(tool)}」。`)}>
                    看过了，启用
                  </Button>
                </Show>
                <Show when={tool.state !== "invalid" && tool.state !== "unapproved"}>
                  <Button disabled={busy()} onClick={() => void perform(() => window.studio.setToolEnabled({ id: tool.id, enabled: tool.state === "disabled" }))}>
                    {tool.state === "disabled" ? "启用" : "停用"}
                  </Button>
                </Show>
              </div>
            </section>
          )}
        </For>
      </div>
    </section>
  )
}
