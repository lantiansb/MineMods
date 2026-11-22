import { createSignal, Show } from "solid-js"
import { REVIEWER_OFFER } from "./production-words"
import type { reviewerLine } from "./floor-idle-model"

/**
 * One line on 制作现场: 「审查」 being switched on, and whether the reviewing window is really connected. When it is not, the way to open it is
 * the same as on the notice that appears once a version waits (copy the reviewer's hand-off to paste into another AI's new conversation).
 */
export function ReviewerLine(props: { projectId: string; line: NonNullable<ReturnType<typeof reviewerLine>> }) {
  const [copied, setCopied] = createSignal(false)
  const [trouble, setTrouble] = createSignal("")
  const open = async () => {
    setTrouble("")
    try {
      await window.studio.copyMcpHandoff({ projectId: props.projectId, role: "reviewer" })
      setCopied(true)
    } catch {
      setTrouble("没能复制，请再点一次。")
    }
  }
  return (
    <p class="pa-hint mf-reviewer" classList={{ "action-notice": props.line.open }} role="status" data-open={props.line.open}>
      <span>{props.line.text}</span>
      <Show when={props.line.open}>
        <button type="button" class="pa-link" title={REVIEWER_OFFER.openHow} onClick={() => void open()}>
          {copied() ? "已复制，在同一个 AI 助手里新开一个对话粘贴" : REVIEWER_OFFER.open}
        </button>
      </Show>
      <Show when={trouble()}>
        <span class="rw-trouble">{trouble()}</span>
      </Show>
    </p>
  )
}
