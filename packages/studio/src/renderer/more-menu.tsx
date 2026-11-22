import { createEffect, createSignal, createUniqueId, onCleanup, onMount, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import "./more-menu.css"

const [active, setActive] = createSignal<string>()

export function MoreMenu(props: {
  label: string
  class?: string
  title?: string
  children: (close: () => void) => JSX.Element
}) {
  const id = createUniqueId()
  const open = () => active() === id
  let trigger!: HTMLButtonElement
  const close = () => { if (open()) setActive(undefined) }
  onCleanup(close)
  createEffect(() => {
    if (!open()) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.contains(event.target) && !document.getElementById(id)?.contains(event.target)) close()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      close()
      trigger.focus()
    }
    document.addEventListener("pointerdown", outside, true)
    window.addEventListener("keydown", key, true)
    onCleanup(() => {
      document.removeEventListener("pointerdown", outside, true)
      window.removeEventListener("keydown", key, true)
    })
  })
  const Popup = () => {
    let popup!: HTMLDivElement
    onMount(() => {
      const place = () => {
        const rect = trigger.getBoundingClientRect()
        const width = popup.offsetWidth
        const height = popup.offsetHeight
        popup.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`
        popup.style.top = `${Math.max(8, rect.bottom + height + 12 <= window.innerHeight ? rect.bottom + 4 : rect.top - height - 4)}px`
      }
      const observer = new ResizeObserver(place)
      observer.observe(popup)
      window.addEventListener("resize", place)
      window.addEventListener("scroll", place, true)
      place()
      popup.focus({ preventScroll: true })
      onCleanup(() => {
        observer.disconnect()
        window.removeEventListener("resize", place)
        window.removeEventListener("scroll", place, true)
      })
    })
    return <div id={id} ref={popup} tabIndex={-1} class="more-menu-popover mc-window" onClick={(event) => event.stopPropagation()}>
      {props.children(close)}
    </div>
  }
  return (
    <div class={props.class}>
      <button type="button" class="more-menu-trigger" ref={trigger} aria-label={props.label} title={props.title}
        aria-expanded={open()} aria-controls={open() ? id : undefined} onClick={() => open() ? close() : setActive(id)}>⋯</button>
      <Show when={open()}><Portal mount={trigger?.closest(".studio-root") ?? document.body}><Popup /></Portal></Show>
    </div>
  )
}
