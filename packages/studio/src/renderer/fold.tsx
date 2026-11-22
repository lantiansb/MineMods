import { createEffect, createSignal, type JSX } from "solid-js"
import { foldAttributes, followOpen, nextFoldId, pressed } from "./fold-model"
import "./fold.css"

/**
 * One fold for the whole app, in place of the browser's details and summary elements (see `fold-model.ts` for why): a button with `aria-expanded` and `aria-controls` that shows or
 * hides its content, which the keyboard works on as on any button (Tab to it, Enter or Space).
 *
 * - `class` goes on the outer element and `summaryClass` on the button, so the CSS of each place keeps working: its `summary` became `.fold-summary`, its `[open]` became `[data-open]`.
 * - `open` is where it starts, and follows the expression when that changes (the person's own presses in between are kept until it does); `onToggle` hears every press.
 * - The content stays in the page while folded (hidden), as a closed details element keeps it, so what was typed into it is still there when it opens again.
 * - `arrow={false}` for a place that draws its own arrow.
 */
export function Fold(props: {
  class?: string
  summary: JSX.Element
  summaryClass?: string
  /** What a screen reader says for the button when its text alone does not say it. */
  summaryLabel?: string
  summaryTitle?: string
  open?: boolean
  onToggle?: (open: boolean) => void
  arrow?: boolean
  /** The place's own state word for its CSS (`data-state`). */
  state?: string
  children: JSX.Element
}) {
  const id = nextFoldId()
  const [open, setOpen] = createSignal(Boolean(props.open))
  let before = props.open
  createEffect(() => {
    const now = props.open
    setOpen((current) => followOpen(before, now, current))
    before = now
  })
  const press = () => {
    const next = pressed(open())
    setOpen(next)
    props.onToggle?.(next)
  }
  return (
    <div class={`fold ${props.class ?? ""}`} data-open={open() ? "yes" : undefined} data-arrow={props.arrow === false ? "none" : undefined} data-state={props.state}>
      <button
        type="button"
        class={`fold-summary ${props.summaryClass ?? ""}`}
        {...foldAttributes(open(), id)}
        aria-label={props.summaryLabel}
        title={props.summaryTitle}
        onClick={press}
      >
        {props.summary}
      </button>
      <div class="fold-content" id={id} hidden={!open()}>
        {props.children}
      </div>
    </div>
  )
}
