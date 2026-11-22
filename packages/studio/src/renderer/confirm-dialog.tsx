import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Button } from "./ui"

/**
 * The app's own question box, in place of the system's `confirm`: the same window look as every other dialog,
 * two buttons, Escape for the safe answer, and the safe answer focused so Enter alone never throws work away.
 * `ask` and `askText` are called like the system ones were, and answer through a promise.
 */
type Question = {
  title: string
  text?: string
  /** Several short paragraphs in place of `text`, for a question that names things and then says what follows. */
  lines?: string[]
  /** The answer that does the thing asked about. */
  confirm: string
  /** The answer that changes nothing. */
  cancel: string
  /** A line to fill in: the answer is then what was written, and the field is focused instead of the safe button. */
  field?: { label: string; value: string; max: number }
  resolve: (answer: string | null) => void
}

const [question, setQuestion] = createSignal<Question | null>(null)
const [written, setWritten] = createSignal("")

function open(input: Omit<Question, "resolve">) {
  // A second question while one is open answers the first with its safe answer: nothing was agreed to.
  question()?.resolve(null)
  return new Promise<string | null>((resolve) => {
    setWritten(input.field?.value ?? "")
    setQuestion({ ...input, resolve })
  })
}

/** True when the person chose `confirm`; false for `cancel`, Escape or a click outside. */
export const ask = (input: { title: string; text?: string; lines?: string[]; confirm: string; cancel: string }) => open(input).then((answer) => answer !== null)

/** What the person wrote, trimmed; null when they left without confirming. */
export const askText = (input: { title: string; text?: string; confirm: string; cancel: string; field: { label: string; value: string; max: number } }) => open(input)

/** The words for leaving a page with edits that are not saved, said the same way everywhere. */
export const UNSAVED = { title: "还有没保存的修改", confirm: "放弃修改", cancel: "留在这里" } as const

export function ConfirmDialog() {
  const answer = (value: string | null) => {
    const asked = question()
    setQuestion(null)
    asked?.resolve(value)
  }
  const confirm = () => {
    const asked = question()
    if (!asked) return
    if (!asked.field) return answer("")
    if (written().trim()) answer(written().trim())
  }
  // Capturing, and stopped here: Escape answers this question only, not the drawer or the menu under it. Listening from the start of the app, so that this comes
  // before anything that began listening later, such as the note being written under the question: of listeners on the window, the first to begin is the first to hear.
  onMount(() => {
    const keys = (event: KeyboardEvent) => {
      if (!question()) return
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopImmediatePropagation()
        answer(null)
        return
      }
      if (event.key !== "Tab") return
      const nodes = [...document.querySelectorAll<HTMLElement>(".confirm-dialog input, .confirm-dialog button:not(:disabled)")]
      if (event.shiftKey && document.activeElement === nodes[0]) {
        event.preventDefault()
        nodes.at(-1)?.focus()
      }
      if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
        event.preventDefault()
        nodes[0]?.focus()
      }
    }
    window.addEventListener("keydown", keys, true)
    onCleanup(() => window.removeEventListener("keydown", keys, true))
  })
  createEffect(() => {
    if (!question()) return
    const previous = document.activeElement as HTMLElement | null
    queueMicrotask(() => document.querySelector<HTMLElement>(".confirm-dialog [data-first]")?.focus())
    onCleanup(() => previous?.focus())
  })
  return (
    <Show when={question()}>
      {(asked) => (
        <div
          class="modal-backdrop confirm-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) answer(null)
          }}
        >
          <form
            class="modal confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onSubmit={(event) => {
              event.preventDefault()
              confirm()
            }}
          >
            <h2 id="confirm-title">{asked().title}</h2>
            <Show when={asked().text}>
              <p class="confirm-text">{asked().text}</p>
            </Show>
            <For each={asked().lines ?? []}>{(line) => <p class="confirm-text">{line}</p>}</For>
            <Show when={asked().field}>
              {(field) => (
                <label class="field">
                  {field().label}
                  <input data-first aria-label={field().label} maxlength={field().max} value={written()} onInput={(event) => setWritten(event.currentTarget.value)} />
                </label>
              )}
            </Show>
            <div class="page-actions">
              <button type="button" class="studio-button" data-first={asked().field ? undefined : ""} onClick={() => answer(null)}>
                {asked().cancel}
              </button>
              <Button primary={!!asked().field} type="submit" disabled={!!asked().field && !written().trim()}>
                {asked().confirm}
              </Button>
            </div>
          </form>
        </div>
      )}
    </Show>
  )
}
