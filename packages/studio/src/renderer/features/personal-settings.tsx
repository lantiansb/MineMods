import { For, Show, createSignal, onCleanup, type JSX } from "solid-js"
import { DIFFICULTY_WORDS, IDENTITY_LIMITS, STYLE_WORDS, type StudioSettings } from "../../settings"
import { AHEAD_WORDS } from "../../prepare-ahead"
import { Avatar, Button, FACES, Icon, type FaceId } from "../ui"
import "./personal-settings.css"

type Saved = "idle" | "saving" | "saved" | "failed"

/**
 * 个人设置: who the person is to the tool. No account: a name to be called by, a face, what they like, the words
 * every AI working for them keeps, then how the AI is connected and what belongs to this computer.
 * Everything saves by itself a moment after it is changed; the heading says so quietly.
 */
export function PersonalSettings(props: {
  settings: StudioSettings
  /** Studio's own folder: where new projects go while the person has picked no other. */
  workspace?: string
  /** Stores the settings and gives back what was stored. */
  onSave: (next: StudioSettings) => Promise<StudioSettings>
  /** Lets the person pick a folder for new projects; null when they closed the chooser. */
  onChooseDirectory: () => Promise<StudioSettings | null>
  onResetDirectory: () => Promise<StudioSettings>
  backLabel: string
  /** Which project this was opened from, said in a sentence (see `settingsBack`); empty when it was opened from nowhere in particular. */
  cameFrom?: string
  onBack: () => void
  onResources: (tab: "tools" | "storage") => void
  /** The connection section's own content (the wizard keeps its behaviour). */
  connection: JSX.Element
}) {
  // What is on the page while it is being typed; the stored copy is trimmed, so it is never written back over a field in use.
  const [draft, setDraft] = createSignal(props.settings)
  const [saved, setSaved] = createSignal<Saved>("idle")
  const [failure, setFailure] = createSignal("")
  const [directory, setDirectory] = createSignal(props.settings.projectsDirectory)
  const state = { timer: undefined as ReturnType<typeof setTimeout> | undefined, waiting: false, running: Promise.resolve() }

  const store = () => {
    state.waiting = false
    setSaved("saving")
    // One save at a time, each with the page as it is then: an earlier answer never lands on a later change.
    state.running = state.running
      .then(() => props.onSave({ ...props.settings, ...draft(), modelComplexity: props.settings.modelComplexity, projectsDirectory: directory() }))
      .then(
        () => {
          if (!state.waiting) setSaved("saved")
        },
        (cause: unknown) => {
          setFailure(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "")
          setSaved("failed")
        },
      )
  }
  const change = (next: Partial<StudioSettings>, wait = 0) => {
    setDraft({ ...draft(), ...next })
    clearTimeout(state.timer)
    state.waiting = true
    setSaved("saving")
    state.timer = setTimeout(store, wait)
  }
  // Leaving the page with something typed a moment ago: stored on the way out.
  onCleanup(() => {
    clearTimeout(state.timer)
    if (state.waiting) store()
  })
  const pick = async (action: () => Promise<StudioSettings | null>) => {
    setSaved("saving")
    await action().then(
      (next) => {
        if (next) setDirectory(next.projectsDirectory)
        setSaved(next ? "saved" : "idle")
      },
      (cause: unknown) => {
        setFailure(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "")
        setSaved("failed")
      },
    )
  }
  const typing = 600
  const name = () => draft().nickname.trim()
  const Count = (count: { now: number; limit: number }) => (
    <span class={`ps-count ${count.now >= count.limit ? "full" : ""}`}>
      {count.now} / {count.limit}
    </span>
  )
  const Choice = <T extends string>(choice: { label: string; value: T; words: Record<T, { label: string }>; onPick: (value: T) => void }) => (
    <div class="ps-row">
      <span class="ps-label">{choice.label}</span>
      <div class="ps-choice" role="radiogroup" aria-label={choice.label}>
        <For each={Object.keys(choice.words) as T[]}>
          {(value) => (
            <button type="button" role="radio" aria-checked={choice.value === value} class={choice.value === value ? "on" : ""} onClick={() => choice.onPick(value)}>
              {choice.words[value].label}
            </button>
          )}
        </For>
      </div>
    </div>
  )

  return (
    <div class="page ps-page">
      <div class="page-heading ps-heading">
        <div>
          <h1>个人设置</h1>
          <p>告诉 MineMods 你是谁、喜欢什么。不用注册，也没有账号：这些只存在这台电脑上。</p>
          <Show when={props.cameFrom}>
            <p class="ps-from" role="status">
              {props.cameFrom}
            </p>
          </Show>
        </div>
        <div class="ps-heading-side">
          <span class={`ps-saved ${saved()}`} role="status" aria-live="polite">
            {saved() === "saving" ? "正在保存…" : saved() === "saved" ? "已保存" : saved() === "failed" ? `没存上${failure() ? `：${failure()}` : "，再改一下试试"}` : "改了就会自动保存"}
          </span>
          <Button onClick={props.onBack}>
            <Icon name="undo" />
            {props.backLabel}
          </Button>
        </div>
      </div>
      <div class="ps-grid">
        <div class="ps-column">
          <section class="ps-section mc-window" aria-labelledby="ps-who">
            <header>
              <h2 id="ps-who">我是谁</h2>
              <p>MineMods 和替你干活的 AI 怎么称呼你。</p>
            </header>
            <div class="ps-who">
              <div class="ps-face mc-slot">
                <Avatar tone={draft().avatar} />
              </div>
              <div class="ps-who-fields">
                <label class="ps-field">
                  <span class="ps-label">
                    怎么称呼我
                    <Count now={draft().nickname.length} limit={IDENTITY_LIMITS.nickname} />
                  </span>
                  <input
                    aria-label="怎么称呼我"
                    maxlength={IDENTITY_LIMITS.nickname}
                    placeholder="比如：阿铜、老王、船长"
                    value={draft().nickname}
                    onInput={(event) => change({ nickname: event.currentTarget.value }, typing)}
                  />
                </label>
                <p class="ps-note">{name() ? `以后会叫你「${name()}」。` : "不填也行：那就不带称呼。"}</p>
              </div>
            </div>
            <div class="ps-row">
              <span class="ps-label">选一张脸</span>
              <div class="ps-faces" role="radiogroup" aria-label="选一张脸">
                <For each={Object.keys(FACES) as FaceId[]}>
                  {(tone) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={draft().avatar === tone}
                      aria-label={`头像 ${FACES[tone].name}`}
                      title={FACES[tone].name}
                      class={`mc-slot ${draft().avatar === tone ? "on" : ""}`}
                      onClick={() => change({ avatar: tone })}
                    >
                      <Avatar tone={tone} />
                    </button>
                  )}
                </For>
              </div>
            </div>
          </section>

          <section class="ps-section mc-window" aria-labelledby="ps-likes">
            <header>
              <h2 id="ps-likes">我的偏好</h2>
              <p>你没特别交代的时候，AI 照这些来拿主意。</p>
            </header>
            <Choice label="喜欢的风格" value={draft().style} words={STYLE_WORDS} onPick={(style) => change({ style })} />
            <Choice label="难度倾向" value={draft().difficulty} words={DIFFICULTY_WORDS} onPick={(difficulty) => change({ difficulty })} />
            <label class="ps-field">
              <span class="ps-label">
                还喜欢什么
                <Count now={draft().likes.length} limit={IDENTITY_LIMITS.likes} />
              </span>
              <textarea
                aria-label="还喜欢什么"
                rows={2}
                maxlength={IDENTITY_LIMITS.likes}
                placeholder="比如：喜欢机械和红石；生物要可爱一点"
                value={draft().likes}
                onInput={(event) => change({ likes: event.currentTarget.value }, typing)}
              />
            </label>
            <label class="ps-field">
              <span class="ps-label">
                不要什么
                <Count now={draft().avoid.length} limit={IDENTITY_LIMITS.avoid} />
              </span>
              <textarea
                aria-label="不要什么"
                rows={2}
                maxlength={IDENTITY_LIMITS.avoid}
                placeholder="比如：不要血腥的东西；不要太吓人的怪"
                value={draft().avoid}
                onInput={(event) => change({ avoid: event.currentTarget.value }, typing)}
              />
            </label>
          </section>

          <section class="ps-section mc-window" aria-labelledby="ps-standing">
            <header>
              <h2 id="ps-standing">一直带着的话</h2>
              <p>想让每个替你干活的 AI 都一直记着的话，写在这里，不用每次重说。</p>
            </header>
            <label class="ps-field">
              <span class="ps-label">
                要一直记着的话
                <Count now={draft().standing.length} limit={IDENTITY_LIMITS.standing} />
              </span>
              <textarea
                aria-label="一直带着的话"
                class="ps-standing"
                rows={5}
                maxlength={IDENTITY_LIMITS.standing}
                placeholder="比如：我是给八岁的孩子做模组，说明要写得让他看得懂。"
                value={draft().standing}
                onInput={(event) => change({ standing: event.currentTarget.value }, typing)}
              />
            </label>
            <ul class="ps-when">
              <li>什么时候用：每次有 AI 替你想点子、做东西，都会先读到。这里自带的 AI 和你接进来的外部 AI 都一样。</li>
              <li>排在后面：MineMods 的制作规矩和检查标准在前，这些话在后，不能用来放宽标准。</li>
              <li>审查员看不到这些，只知道怎么称呼你，免得偏心。</li>
            </ul>
          </section>
        </div>

        <div class="ps-column">
          <section class="ps-section mc-window ps-connection" aria-labelledby="ps-link">
            <header>
              <h2 id="ps-link">连接 AI</h2>
              <p>替你干活的 AI 从哪里来，做完的东西要不要再请一位审查员看一遍。</p>
            </header>
            {props.connection}
          </section>

          <section class="ps-section mc-window" aria-labelledby="ps-computer">
            <header>
              <h2 id="ps-computer">这台电脑</h2>
              <p>只和这台电脑有关的几样。</p>
            </header>
            <div class="page-actions">
              <Button onClick={() => props.onResources("tools")}><Icon name="tool" />工具</Button>
              <Button onClick={() => props.onResources("storage")}><Icon name="folder" />存储空间</Button>
            </div>
            <label class="ps-row">
              <span class="ps-label">语言</span>
              <select aria-label="语言" class="ps-select">
                <option>简体中文</option>
              </select>
            </label>
            <div class="ps-field">
              <span class="ps-label">默认工程目录</span>
              <div class="ps-path">
                <output class="mc-well" aria-label="默认工程目录">{directory() || props.workspace || "…"}</output>
                <div class="ps-path-actions">
                  <Button onClick={() => void pick(props.onChooseDirectory)}>
                    <Icon name="folder" />
                    换个文件夹
                  </Button>
                  <Show when={directory()}>
                    <Button onClick={() => void pick(props.onResetDirectory)}>用回原来的</Button>
                  </Show>
                </div>
              </div>
              <p class="ps-note">新建的工程放在这里。换了以后，已经做好的工程留在原处，照样能打开。</p>
            </div>
            <label class="ps-row">
              <span class="ps-label">
                史诗档六视图画法
                <small>用于以后新画的六视图和构想图。</small>
              </span>
              <select class="ps-select" value={draft().epicSixViewStyle} onChange={(event) => change({ epicSixViewStyle: event.currentTarget.value === "blocky" ? "blocky" : "sculpted" })}>
                <option value="sculpted">新写法（斜板加圆体）</option>
                <option value="blocky">老写法（全方块）</option>
              </select>
            </label>
            <label class="ps-row ps-switch">
              <span class="ps-label">
                减少动效
                <small>画面晃得不舒服时打开。</small>
              </span>
              <input aria-label="减少动效" type="checkbox" checked={draft().reducedMotion} onChange={(event) => change({ reducedMotion: event.currentTarget.checked })} />
            </label>
            <label class="ps-row ps-switch">
              <span class="ps-label">
                声音
                <small>按按钮、达成进度时响一下，声音是现场合成的。</small>
              </span>
              <input aria-label="声音" type="checkbox" checked={draft().sounds} onChange={(event) => change({ sounds: event.currentTarget.checked })} />
            </label>
            <label class="ps-row ps-switch">
              <span class="ps-label">
                {AHEAD_WORDS.setting}
                <small>{AHEAD_WORDS.settingNote}</small>
              </span>
              <input aria-label={AHEAD_WORDS.setting} type="checkbox" checked={draft().prepareAhead} onChange={(event) => change({ prepareAhead: event.currentTarget.checked })} />
            </label>
          </section>
        </div>
      </div>
    </div>
  )
}
