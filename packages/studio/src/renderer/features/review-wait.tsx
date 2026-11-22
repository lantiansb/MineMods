import { createSignal, onCleanup, Show } from "solid-js"
import type { ProjectOverview } from "../../api"
import { Button, Icon } from "../ui"
import { REVIEWER_OFFER, reviewWaitWords } from "./production-words"
import "./review-wait.css"

/**
 * 「审查」 with an outside AI: a finished version waits for a reviewing window. The page says it, where the person is, in plain words: what waits, for how
 * long, and whether anybody is there. When nobody is, two ways on: open the reviewer (copy its hand-off, to be pasted into a new conversation of another AI),
 * or go without one (the maker checks its own work from now on). Before this the only place that said so was the maker's own chat, which the person
 * had given up reading.
 */
export function ReviewWaitNotice(props: { projectId: string; wait: NonNullable<ProjectOverview["review_wait"]>; onChanged: () => void }) {
  const [now, setNow] = createSignal(Date.now())
  const [copied, setCopied] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [trouble, setTrouble] = createSignal("")
  // The clock moves while the page is left open: "刚刚" turns into minutes without anything else changing.
  const timer = window.setInterval(() => setNow(Date.now()), 15_000)
  onCleanup(() => window.clearInterval(timer))
  const words = () => reviewWaitWords(props.wait, now())

  const open = async () => {
    setTrouble("")
    try {
      await window.studio.copyMcpHandoff({ projectId: props.projectId, role: "reviewer" })
      setCopied(true)
    } catch {
      setTrouble("没能复制，请再点一次。")
    }
  }
  const without = async () => {
    if (busy()) return
    setBusy(true)
    setTrouble("")
    try {
      await window.studio.turnOffReview()
      props.onChanged()
    } catch {
      setTrouble("没能改成功，请再点一次；也可以到连接 AI里把「审查」关掉。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="rw" classList={{ "action-notice": !!words().offer }} role="status" data-reviewer={props.wait.reviewer}>
      <div class="rw-head">
        <strong>{words().head}</strong>
        <Show when={words().clock}>
          <span class="rw-clock">{words().clock}</span>
        </Show>
      </div>
      <p class="rw-line">
        {words().reviewer}
        {words().after}
      </p>
      <Show when={words().offer}>
        <div class="rw-actions">
          <div class="rw-choice">
            <Button primary onClick={() => void open()}>
              <Icon name="copy" />
              {copied() ? "再复制一次" : REVIEWER_OFFER.open}
            </Button>
            <small>{copied() ? REVIEWER_OFFER.copied : REVIEWER_OFFER.openHow}</small>
          </div>
          <div class="rw-choice">
            <Button disabled={busy()} onClick={() => void without()}>
              {REVIEWER_OFFER.without}
            </Button>
            <small>{REVIEWER_OFFER.withoutHow}</small>
          </div>
        </div>
      </Show>
      <Show when={trouble()}>
        <p class="rw-trouble">{trouble()}</p>
      </Show>
    </section>
  )
}
