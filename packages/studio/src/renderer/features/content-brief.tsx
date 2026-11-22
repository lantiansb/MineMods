import { Icon } from "../ui"
import { For, Show, createEffect, createSignal, on, onCleanup, untrack } from "solid-js"
import type { ConceptionEntry } from "@minemods/mod-core/conception"
import { RecipeWorkbench } from "./recipe"
import "./content-brief.css"

export const contentNames = {
  entity: "生物",
  block: "方块",
  item: "物品",
  recipe: "配方",
  biome: "群系",
  dimension: "维度",
  worldview: "世界观",
} as const
export type ContentBriefEditorProps = {
  entry: ConceptionEntry
  behavior?: boolean
  disabled: boolean
  aiConfigured: boolean
  onSave: (entry: ConceptionEntry) => Promise<void>
  onReview: (entry: ConceptionEntry, behavior: boolean) => Promise<void>
  onBack: () => void
  onDirty: (dirty: boolean) => void
}

export function ContentBriefEditor(props: ContentBriefEditorProps) {
  const [draft, setDraft] = createSignal<ConceptionEntry>(structuredClone(props.entry))
  const [dirty, setDirty] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  createEffect(
    on(
      () => props.entry,
      (incoming) => {
        if (incoming.id !== untrack(draft).id || !untrack(dirty)) {
          setDraft(structuredClone(incoming))
          return
        }
        setDraft((value) => ({ ...value, review: incoming.review, behavior_review: incoming.behavior_review }))
      },
    ),
  )
  createEffect(() => props.onDirty(dirty()))
  const update = (changes: Partial<ConceptionEntry>) => {
    if (props.disabled) return
    setDraft((value) => ({ ...value, ...changes, status: "draft" }) as ConceptionEntry)
    setDirty(true)
    setError("")
  }
  const save = async () => {
    if (busy() || props.disabled || !dirty()) return
    setBusy(true)
    setError("")
    try {
      await props.onSave(draft())
      setDirty(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。")
    } finally {
      setBusy(false)
    }
  }
  const review = async () => {
    if (busy() || props.disabled || !props.aiConfigured) return
    setBusy(true)
    setError("")
    try {
      await props.onReview(draft(), !!props.behavior)
      setDirty(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 没整理成，请再试一次。")
    } finally {
      setBusy(false)
    }
  }
  const shortcut = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault()
      void save()
    }
  }
  window.addEventListener("keydown", shortcut)
  onCleanup(() => {
    window.removeEventListener("keydown", shortcut)
    props.onDirty(false)
  })
  const activeReview = () => (props.behavior ? draft().behavior_review : draft().review)
  const recipe = () => {
    const value = draft()
    return value.kind === "recipe" ? value.recipe : null
  }
  return (
    <section class="content-brief-editor" aria-label={`${contentNames[props.entry.kind]}意图编辑`}>
      <header class="brief-header">
        <button type="button" class="brief-back" onClick={props.onBack}>
          <Icon name="undo" />
          返回
        </button>
        <div class="brief-title">
          <h1>{draft().title}</h1>
          <span>{props.behavior ? "行为设计" : `${contentNames[props.entry.kind]}设计`}</span>
        </div>
        <div class="brief-actions">
          <button type="button" disabled={props.disabled || busy() || !dirty()} onClick={() => void save()}>
            {busy() ? "处理中…" : "保存设计"}
          </button>
          <button
            type="button"
            class="primary"
            disabled={props.disabled || busy() || !props.aiConfigured}
            onClick={() => void review()}
          >
            交给 AI 整理
          </button>
        </div>
      </header>
      <div class="brief-layout">
        <div class="brief-form">
          <div class="brief-fields">
            <label>
              <span>名称</span>
              <input
                value={draft().title}
                disabled={props.disabled || busy()}
                onInput={(event) => update({ title: event.currentTarget.value })}
              />
            </label>
            <label>
              <span>{props.behavior ? "想让它怎么行动" : "想做成什么样"}</span>
              <textarea
                rows={props.entry.kind === "recipe" ? 3 : 7}
                value={props.behavior ? draft().behavior_brief : draft().brief}
                disabled={props.disabled || busy()}
                onInput={(event) =>
                  props.behavior
                    ? update({ behavior_brief: event.currentTarget.value })
                    : update({ brief: event.currentTarget.value })
                }
              />
            </label>
          </div>
          <Show when={recipe()}>
            {(value) => (
              <RecipeWorkbench
                value={value()}
                disabled={props.disabled || busy()}
                onChange={(next) => update({ recipe: next } as Partial<ConceptionEntry>)}
              />
            )}
          </Show>
          <Show when={error()}>
            <p class="brief-error" role="alert">
              {error()}
            </p>
          </Show>
        </div>
        <aside class="brief-review">
          <div class="review-title">
            <div>
              <span>AI 整理</span>
              <h2>{activeReview() ? (draft().status === "draft" ? "上次整理" : "整理结果") : "还没有整理过"}</h2>
            </div>
            <Show when={!props.aiConfigured}>
              <em>AI 没连接</em>
            </Show>
          </div>
          <Show
            when={activeReview()}
            fallback={<div class="review-empty">保存以后，可以让 AI 提炼结构、发现遗漏并提出问题。这里整理出来的只是草稿，不会进游戏。</div>}
          >
            {(value) => (
              <div class="review-content">
                <p class="review-summary">{value().summary}</p>
                <For each={value().sections}>
                  {(section) => (
                    <section>
                      <h3>{section.title}</h3>
                      <p>{section.body}</p>
                    </section>
                  )}
                </For>
                <Show when={value().questions.length}>
                  <div class="review-questions">
                    <h3>仍需决定</h3>
                    <ul>
                      <For each={value().questions}>{(question) => <li>{question}</li>}</For>
                    </ul>
                  </div>
                </Show>
              </div>
            )}
          </Show>
        </aside>
      </div>
    </section>
  )
}
