import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import type { ModelComplexity } from "@minemods/studio-ai/model-quality"
import { DETAIL_WORDS } from "@minemods/mod-core/creature-tier"
import { Icon } from "../ui"
import "./model-complexity.css"

const choices = [
  { value: "low", label: "低", description: "简洁轮廓，保留关键结构", layers: 1 },
  { value: "medium", label: "中", description: "完整层次，兼顾细节与速度", layers: 2 },
  { value: "high", label: "高", description: "丰富结构，更充分的细节", layers: 3 },
] as const

function Layers(props: { count: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m16 4 12 6-12 6L4 10l12-6Z" />
      <path d="m4 14 12 6 12-6" />
      <Show when={props.count > 1}>
        <path d="m4 19 12 6 12-6" />
      </Show>
      <Show when={props.count > 2}>
        <path d="m4 24 12 6 12-6" />
      </Show>
    </svg>
  )
}

export function ModelComplexityControl(props: {
  value: ModelComplexity
  onChange: (value: ModelComplexity) => Promise<void>
}) {
  const [open, setOpen] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal("")
  const [focusedChoice, setFocusedChoice] = createSignal(1)
  let container!: HTMLDivElement
  let trigger!: HTMLButtonElement
  const buttons: HTMLButtonElement[] = []
  const selected = () => choices.find((choice) => choice.value === props.value) ?? choices[1]
  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) trigger.focus()
  }
  const show = () => {
    setError("")
    setFocusedChoice(choices.findIndex((choice) => choice.value === props.value))
    setOpen(true)
    queueMicrotask(() => buttons[choices.findIndex((choice) => choice.value === props.value)]?.focus())
  }
  const choose = async (value: ModelComplexity) => {
    if (saving()) return
    if (value === props.value) return close(true)
    setSaving(true)
    setError("")
    await props.onChange(value).then(
      () => close(open() && container.contains(document.activeElement)),
      () => setError("未能保存精细度，请重试。当前档位保持不变。"),
    )
    setSaving(false)
    if (open()) buttons[choices.findIndex((choice) => choice.value === value)]?.focus()
  }
  createEffect(() => {
    if (!open()) return
    const outside = (event: Event) => {
      if (event.target instanceof Node && !container.contains(event.target)) close()
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("focusin", outside)
    onCleanup(() => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("focusin", outside)
    })
  })

  return (
    <div class="model-complexity-control" ref={container}>
      <button
        ref={trigger}
        type="button"
        class="studio-button complexity-trigger"
        aria-label={`模型精细度 · ${selected().label}`}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-controls={open() ? "model-complexity-menu" : undefined}
        onClick={() => (open() ? close() : show())}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
          event.preventDefault()
          show()
        }}
      >
        <Layers count={selected().layers} />
        <span>模型精细度 · {selected().label}</span>
      </button>
      <Show when={open()}>
        <div
          id="model-complexity-menu"
          class="complexity-menu"
          role="menu"
          aria-label="模型精细度"
          aria-busy={saving()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              close(true)
              return
            }
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
            const next =
              event.key === "ArrowDown"
                ? (index + 1) % 3
                : event.key === "ArrowUp"
                  ? (index + 2) % 3
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? 2
                      : null
            if (next === null) return
            event.preventDefault()
            buttons[next]?.focus()
          }}
        >
          <div class="complexity-heading">
            <strong>模型精细度</strong>
            <p>{DETAIL_WORDS.button}</p>
          </div>
          <div class="complexity-choices" role="group" aria-label="精细度档位">
            <For each={choices}>
              {(choice, index) => (
                <button
                  ref={(element) => (buttons[index()] = element)}
                  class="complexity-choice"
                  type="button"
                  role="menuitemradio"
                  aria-checked={props.value === choice.value}
                  aria-label={`${choice.label} ${choice.description}`}
                  disabled={saving()}
                  tabIndex={focusedChoice() === index() ? 0 : -1}
                  onFocus={() => setFocusedChoice(index())}
                  onClick={() => void choose(choice.value)}
                >
                  <Layers count={choice.layers} />
                  <span class="complexity-copy">
                    <strong>{choice.label}</strong>
                    <span>{choice.description}</span>
                  </span>
                  <span class="complexity-radio">
                    <Show when={props.value === choice.value}>
                      <Icon name="check" />
                    </Show>
                  </span>
                </button>
              )}
            </For>
          </div>
          <Show when={error()}>
            <p class="complexity-error" role="alert">
              {error()}
            </p>
          </Show>
          <p class="complexity-footer" role="status">
            {saving() ? "正在保存…" : "Studio 自带的 AI 和外面的 AI，用的是同一套检查标准"}
          </p>
        </div>
      </Show>
    </div>
  )
}
