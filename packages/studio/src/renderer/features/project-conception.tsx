import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import type { Project } from "@minemods/mod-core/project"
import type { Conception, ConceptionEntry, ConceptionPlan } from "@minemods/mod-core/conception"
import { WORDS } from "../words"
import "./project-conception.css"
import { Fold } from "../fold"

export type ProjectConceptionProps = {
  project: Project
  disabled: boolean
  aiConfigured: boolean
  onSave: (conception: Conception) => Promise<void>
  onAnalyze: (brief: string) => Promise<void>
  onImport: (plan: ConceptionPlan) => Promise<void>
  onOpen: (entry: ConceptionEntry) => void
  onDirty: (dirty: boolean) => void
}
const labels = {
  entity: "生物",
  block: "方块",
  item: "物品",
  recipe: "配方",
  biome: "群系",
  dimension: "维度",
  worldview: "世界观",
} as const
const order = ["entity", "block", "item", "recipe", "biome", "dimension", "worldview"] as const

export function ProjectConception(props: ProjectConceptionProps) {
  const [draft, setDraft] = createSignal<Conception>(structuredClone(props.project.conception))
  const [baseline, setBaseline] = createSignal(JSON.stringify(props.project.conception))
  const [saving, setSaving] = createSignal(false)
  const [notice, setNotice] = createSignal("")
  const [activeKind, setActiveKind] = createSignal<(typeof order)[number]>("entity")
  const review = () => draft().review
  const dirty = () => JSON.stringify(draft()) !== baseline()
  // By what it holds: the project is new at every save of anything, and that is no reason to take back what is being written here.
  const stored = createMemo(() => JSON.stringify(props.project.conception))
  createEffect(
    on(stored, (text) => {
      setDraft(JSON.parse(text) as Conception)
      setBaseline(text)
      setNotice("")
    }),
  )
  createEffect(() => props.onDirty(dirty()))
  onCleanup(() => props.onDirty(false))
  const keys = createMemo(
    () =>
      review()
        ?.entries.filter((entry) => entry.kind === activeKind())
        .map((entry) => entry.key) ?? [],
  )
  const update = (change: Partial<Conception>) => {
    if (props.disabled || saving()) return
    setDraft((value) => ({ ...value, ...change }))
    setNotice("")
  }
  const changePlan = (change: Partial<ConceptionPlan>) => {
    const plan = review()
    if (plan) update({ review: { ...plan, ...change } })
  }
  const changeEntry = (key: string, change: Partial<ConceptionPlan["entries"][number]>) => {
    const plan = review()
    if (plan)
      changePlan({ entries: plan.entries.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)) })
  }
  const action = async (operation: () => Promise<void>, message: string) => {
    if (props.disabled || saving()) return
    setSaving(true)
    setNotice("")
    await operation()
      .then(() => {
        setBaseline(JSON.stringify(draft()))
        setNotice(message)
      })
      .catch((cause) => setNotice(cause instanceof Error ? cause.message : "操作失败，请重试。"))
      .finally(() => setSaving(false))
  }
  const blocked = () => props.disabled || saving()
  return (
    <section class={`project-conception ${review() ? "has-review" : "new-conception"}`} aria-label="工程构想">
      <header class="conception-heading">
        <div>
          <h1>{props.project.name}</h1>
          <span class="conception-state">{review() ? "设定文档" : "待整理构想"}</span>
        </div>
        <div class="conception-actions">
          <button
            class="conception-button"
            disabled={blocked() || !dirty()}
            onClick={() => void action(() => props.onSave(draft()), "构想已保存")}
          >
            保存构想
          </button>
          <Show when={review()}>
            <button
              class="conception-button primary"
              disabled={blocked()}
              onClick={() => void action(() => props.onImport(review()!), "已经记进工程")}
            >
              确认导入
            </button>
          </Show>
        </div>
      </header>
      <Fold
        class="conception-intake"
        open={!review()}
        arrow={false}
        summary={
          <>
            <span>旧的构想</span>
            <small>写下世界，再让 AI 整理成一条一条的草稿。这里的草稿不会进游戏</small>
          </>
        }
      >
        <div class="intake-body">
          <textarea
            aria-label="工程构想描述"
            rows={review() ? 4 : 8}
            maxlength="20000"
            value={draft().brief}
            disabled={blocked()}
            placeholder="这个世界是什么样的？你希望玩家遇见什么、制作什么、经历什么？"
            onInput={(event) => update({ brief: event.currentTarget.value })}
          />
          <div class="intake-footer">
            <span>{props.aiConfigured ? "" : "连接 AI 以后才能整理；构想可以先保存。"}</span>
            <button
              class="conception-button primary"
              disabled={blocked() || !props.aiConfigured || !draft().brief.trim()}
              onClick={() => void action(() => props.onAnalyze(draft().brief), "正在整理构想…")}
            >
              AI 整理构想
            </button>
          </div>
        </div>
      </Fold>
      <Show when={notice()}>
        <p class="conception-notice" role="status">
          {notice()}
        </p>
      </Show>
      <Show when={review()}>
        {(plan) => (
          <div class="conception-review">
            <div class="review-top">
              <div>
                <h2>世界设定文档</h2>
                <p>把世界规则、视觉方向和想做的东西放在同一份文档里。</p>
              </div>
              <span class="review-count">{WORDS.things(plan().entries.length)}</span>
            </div>
            <div class="conception-doc-meta">
              <label class="conception-name">
                <span>模组名称</span>
                <input
                  aria-label="百科名称"
                  maxlength="120"
                  value={plan().name}
                  disabled={blocked()}
                  onInput={(event) => changePlan({ name: event.currentTarget.value })}
                />
              </label>
              <label class="plan-field">
                <span>世界观</span>
                <textarea
                  aria-label="世界观"
                  rows="3"
                  maxlength="20000"
                  value={plan().worldview}
                  disabled={blocked()}
                  onInput={(event) => changePlan({ worldview: event.currentTarget.value })}
                />
              </label>
            </div>
            <Show when={plan().questions.length}>
              <div class="open-questions">
                <strong>待确认</strong>
                <ul>
                  <For each={plan().questions}>{(question) => <li>{question}</li>}</For>
                </ul>
              </div>
            </Show>
            <div class="review-body">
              <nav class="category-nav" aria-label="构想分类">
                <For each={order}>
                  {(kind) => (
                    <button class={activeKind() === kind ? "active" : ""} onClick={() => setActiveKind(kind)}>
                      <span>{labels[kind]}</span>
                      <small>{plan().entries.filter((entry) => entry.kind === kind).length}</small>
                    </button>
                  )}
                </For>
              </nav>
              <div class="encyclopedia">
                <Show when={keys().length} fallback={<p class="review-empty">暂无{labels[activeKind()]}设定</p>}>
                  <For each={keys()}>
                    {(key) => {
                      const entry = () => review()!.entries.find((value) => value.key === key)!
                      const stored = () =>
                        props.project.conception.entries.find(
                          (value) => value.key === key && value.kind === entry().kind,
                        )
                      return (
                        <article class="encyclopedia-entry">
                          <header>
                            <div>
                              <span class="entry-kind">{labels[entry().kind]}</span>
                              <input
                                aria-label={`${labels[entry().kind]}名称`}
                                maxlength="120"
                                value={entry().title}
                                disabled={blocked()}
                                onInput={(event) => changeEntry(key, { title: event.currentTarget.value })}
                              />
                            </div>
                            <Show when={stored()}>
                              {(value) => (
                                <button class="entry-open" disabled={blocked()} onClick={() => props.onOpen(value())}>
                                  打开草稿
                                </button>
                              )}
                            </Show>
                          </header>
                          <textarea
                            aria-label={`${entry().title}创作意图`}
                            rows="5"
                            maxlength="20000"
                            value={entry().brief}
                            disabled={blocked()}
                            onInput={(event) => changeEntry(key, { brief: event.currentTarget.value })}
                          />
                          <Show when={entry().relationships.length}>
                            <p class="relationships">
                              关联：
                              {entry()
                                .relationships.map(
                                  (key) => plan().entries.find((value) => value.key === key)?.title ?? key,
                                )
                                .join(" · ")}
                            </p>
                          </Show>
                        </article>
                      )
                    }}
                  </For>
                </Show>
              </div>
            </div>
          </div>
        )}
      </Show>
    </section>
  )
}
