import { createSignal, For, Show } from "solid-js"
import { briefForCreator } from "@minemods/mod-core/creator-words"
import { briefLayout } from "./brief-note-model"
import "./brief-note.css"

// Closed, the note shows this many points; the rest open on request.
const SHOWN = 3

/**
 * 要它做成什么样, written down like an order pinned to the workbench: the headline large, one line per point, the
 * motions or parts it names as chips. The words are the brief's own (brief-note-model.ts), only laid out.
 */
export function BriefNote(props: { brief: string; display?: (text: string) => string }) {
  const layout = () => {
    const plain = briefForCreator(props.brief)
    return briefLayout(plain ? (props.display?.(plain) ?? plain) : "这条蓝图没有可显示的说明。")
  }
  const [all, setAll] = createSignal(false)
  const points = () => (all() ? layout().points : layout().points.slice(0, SHOWN))
  const hidden = () => layout().points.length - SHOWN
  return (
    <div class="bn-note">
      <Show when={layout().head}>
        <p class="bn-head">{layout().head}</p>
      </Show>
      <ul class="bn-points">
        <For each={points()}>
          {(pieces) => (
            <li>
              <For each={pieces}>
                {(piece) =>
                  "text" in piece ? (
                    <span>{piece.text}</span>
                  ) : (
                    <span class="bn-chip">
                      {piece.says}
                    </span>
                  )
                }
              </For>
            </li>
          )}
        </For>
      </ul>
      <Show when={hidden() > 0}>
        <button type="button" class="bn-more" aria-expanded={all()} onClick={() => setAll(!all())}>
          {all() ? "收起" : `还有 ${hidden()} 条`}
        </button>
      </Show>
    </div>
  )
}
