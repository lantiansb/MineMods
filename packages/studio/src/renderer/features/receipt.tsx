import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import type { Receipt } from "../../api"
import { Icon } from "../ui"
import { openFloor } from "./making-floor-link"
import "./receipt.css"

/**
 * 验收回执, as a written book. Everything on its pages is a fact from the records (see `buildReceipt`): counts, and the
 * sentences the records already hold. Nothing here is a verdict of its own. The pages are laid out by a rough line budget
 * (`paginate`); a page that still overflows scrolls instead of cutting anything off.
 */

/** Lines of text one page holds, and how many characters of the app's font fit on one line of it. */
const PAGE_LINES = 24
const LINE_CHARS = 26

type Row = { weight: number; node: JSX.Element }
type Section = { heading: string; rows: Row[] }
type Page = { key: string; head?: JSX.Element; parts: { heading: string; again: boolean; rows: Row[] }[] }

/** The weight of a row of text: lines it takes, and a little air. */
const lines = (chars: number) => Math.max(1, Math.ceil(chars / LINE_CHARS)) + 0.5

/** Sections onto pages: a section runs on to the next page when it does not fit, with its heading said again. */
export function paginate(sections: Section[], first: { node: JSX.Element; weight: number } | null): Page[] {
  const pages: Page[] = []
  let page: Page = { key: "p0", parts: [], ...(first ? { head: first.node } : {}) }
  let used = first?.weight ?? 0
  const next = () => {
    pages.push(page)
    page = { key: `p${pages.length}`, parts: [] }
    used = 0
  }
  for (const section of sections) {
    let part: Page["parts"][number] | null = null
    for (const [index, row] of section.rows.entries()) {
      const need = (part ? 0 : 2.5) + row.weight
      // A heading with no row under it is never left at the foot of a page.
      if (used + need > PAGE_LINES && (page.parts.length || page.head)) {
        next()
        part = null
      }
      if (!part) {
        part = { heading: section.heading, again: index > 0, rows: [] }
        page.parts.push(part)
        used += 2.5
      }
      part.rows.push(row)
      used += row.weight
    }
  }
  if (page.parts.length || page.head || !pages.length) pages.push(page)
  return pages
}

const when = (at: string) => {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? "" : `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

const plain = (cause: unknown) => (cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "出了点问题。")

/** The sentences of the book, from the receipt alone. Pure: the view below only lays them out. */
export function receiptWords(receipt: Receipt) {
  const saved = receipt.things.filter((thing) => thing.saved)
  const kinds = [...saved.reduce((count, thing) => count.set(thing.kind_label, (count.get(thing.kind_label) ?? 0) + 1), new Map<string, number>())].map(([label, count]) => `${label} ${count}`)
  const fixed = receipt.caught.filter((value) => value.fixed).length
  return {
    empty: !saved.length && !receipt.made.rounds && !receipt.caught_total,
    kinds: kinds.join(" · "),
    unsaved: receipt.things.length - saved.length,
    rounds: receipt.made.rounds ? `AI 一共看了 ${receipt.made.rounds} 版图，做了 ${receipt.made.things} 样。` : "还没有 AI 看图做东西的记录。",
    firstTry: receipt.made.rounds ? `看一版就通过审查的：${receipt.made.firstTry} 样。` : "",
    most: receipt.made.most ? `看得最多的是「${receipt.made.most.title}」：${receipt.made.most.rounds} 版。` : "",
    caught: receipt.caught_total
      ? `一共 ${receipt.caught_total} 处${receipt.caught_total > receipt.caught.length ? `，这里是最近的 ${receipt.caught.length} 处` : ""}：已经改掉 ${fixed} 处，还在的 ${receipt.caught.length - fixed} 处。`
      : "这个工程里还没有被拦下的记录。",
    reviewed: receipt.reviewed.total ? `${receipt.reviewed.passed} / ${receipt.reviewed.total} 样通过了没参与制作的另一位 AI 的审查。` : "还没有另一位 AI 审查过的记录。",
    refused: receipt.reviewed.refusals ? `它一共没让过 ${receipt.reviewed.refusals} 次，每次都是 AI 照意见改了再交。` : "",
    game: receipt.game
      ? !receipt.game.started
        ? "游戏带着这个模组没有启动起来。"
        : `${receipt.game.total} 样里 ${receipt.game.placed} 样摆出来了${receipt.game.waited ? `；等了一会儿，${receipt.game.waited} 只生物里 ${receipt.game.present} 只一直在场` : ""}；问题 ${receipt.game.problems} 处。`
      : "",
    gameWhen: receipt.game ? `检查于 ${when(receipt.game.checked_at)}。${receipt.game.current ? "" : "这次检查以后工程又改过，它说的是改之前的样子。"}` : "",
    gameNone: "游戏还没有在后台查过。点右上角「构建并试玩」，Studio 会把做好的东西摆进一个空世界，问游戏它们在不在。",
    checked: receipt.checked.passed + receipt.checked.failed ? `游戏自动检查的记录：${receipt.checked.total} 样里 ${receipt.checked.passed} 样通过${receipt.checked.failed ? `，${receipt.checked.failed} 样没通过` : ""}。` : "",
    unverified: receipt.unverified.length ? `下面这些做好了，但还没有验证到底：` : saved.length ? "做好的东西都验证过了，没有留下没验证的。" : "",
  }
}

/** One thing's making story, opened at the version asked for. */
const story = (target: { item: string; round?: number | null; at?: string }, close: () => void) => {
  close()
  openFloor({ item: target.item, ...(target.round ? { round: target.round } : {}), ...(target.round && target.at ? { at: target.at } : {}) })
}

export function ReceiptBook(props: {
  projectId: string
  projectName: string
  /** The overview's own slot for a thing (its picture and status mark); null when the thing is not on the overview any more. */
  slot: (id: string, onOpen: (id: string) => void) => JSX.Element | null
  onClose: () => void
}) {
  const [receipt, setReceipt] = createSignal<Receipt | null>(null)
  const [failed, setFailed] = createSignal("")
  const [at, setAt] = createSignal(0)
  const [turns, setTurns] = createSignal({ count: 0, back: false })
  const [narrow, setNarrow] = createSignal(typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches)
  let veil: HTMLDivElement | undefined

  const go = (id: string, round?: number | null, time?: string) => story({ item: id, round, at: time }, props.onClose)
  const words = createMemo(() => (receipt() ? receiptWords(receipt()!) : null))

  const pages = createMemo<Page[]>(() => {
    const value = receipt()
    const said = words()
    if (!value || !said) return []
    const title = (
      <header class="rc-title">
        <h2>检查结果</h2>
        <strong>{props.projectName}</strong>
        <small>只写 Studio 记下来的事实：查了什么、拦下了什么、验证了什么。</small>
      </header>
    )
    if (said.empty) return [{ key: "empty", head: title, parts: [{ heading: "", again: false, rows: [{ weight: 3, node: <p class="rc-plain">这个工程里还没有可以写进回执的东西。等 AI 做出第一样、Studio 检查过，这里才会有内容。</p> }] }] }]
    const saved = value.things.filter((thing) => thing.saved)
    const sections: Section[] = [
      {
        heading: "做了哪些东西",
        rows: [
          { weight: 1.5, node: <p class="rc-plain">{saved.length} 样已经保存{said.kinds ? `：${said.kinds}` : ""}。{said.unsaved ? `另有 ${said.unsaved} 样没做好，没算在里面。` : ""}</p> },
          ...Array.from({ length: Math.ceil(saved.length / 3) }, (_, row): Row => ({
            weight: 4.6,
            node: (
              <div class="rc-slots">
                <For each={saved.slice(row * 3, row * 3 + 3)}>{(thing) => props.slot(thing.id, (id) => go(id)) ?? <button type="button" class="rc-link" onClick={() => go(thing.id)}>{thing.title}</button>}</For>
              </div>
            ),
          })),
        ],
      },
      {
        heading: "AI 做了几轮",
        rows: [{ weight: lines(said.rounds.length) + (said.firstTry ? lines(said.firstTry.length) : 0) + (said.most ? lines(said.most.length) : 0), node: <p class="rc-plain">{said.rounds}{said.firstTry ? <><br />{said.firstTry}</> : null}{said.most ? <><br />{said.most}</> : null}</p> }],
      },
      {
        heading: "Studio 拦下、让 AI 改掉的",
        rows: [
          { weight: lines(said.caught.length), node: <p class="rc-plain">{said.caught}</p> },
          ...value.caught.map(
            (line): Row => ({
              weight: lines(line.title.length + line.why.length + line.how.length + 9),
              node: (
                <button type="button" class="rc-line" data-by={line.by} title={`${line.how}。点一下，去看这样东西${line.round ? `第 ${line.round} 版` : ""}的制作过程。`} onClick={() => go(line.item, line.round, line.at)}>
                  <i class={line.fixed ? "rc-mark fixed" : "rc-mark open"} role="img" aria-label={line.fixed ? "已改掉" : "还在"}>
                    {line.fixed ? "✓" : "●"}
                  </i>
                  <span>
                    「{line.title}」{line.round ? `第 ${line.round} 版` : ""}：{line.why}
                    <small>（{line.how}{line.fixed ? "" : "，还在"}）</small>
                  </span>
                </button>
              ),
            }),
          ),
        ],
      },
      {
        heading: "另一位 AI 审查",
        rows: [
          { weight: lines(said.reviewed.length) + (said.refused ? lines(said.refused.length) : 0), node: <p class="rc-plain">{said.reviewed}{said.refused ? <><br />{said.refused}</> : null}</p> },
          ...value.reviewed.blind.map(
            (blind): Row => ({
              weight: lines(blind.title.length + blind.said.length + 24),
              node: (
                <button type="button" class="rc-quote" onClick={() => go(blind.item)}>
                  「{blind.title}」不给名字时看起来像：“{blind.said.replace(/。$/, "")}”
                  <small>{blind.recognised === null ? "" : blind.recognised ? "（告诉它名字以后，对得上）" : "（告诉它名字以后，也对不上）"}</small>
                </button>
              ),
            }),
          ),
        ],
      },
      {
        heading: "在游戏里查过",
        rows: [
          {
            weight: lines((said.game || said.gameNone).length + said.gameWhen.length + said.checked.length),
            node: (
              <p class="rc-plain">
                {said.game || said.gameNone}
                {said.gameWhen ? <><br />{said.gameWhen}</> : null}
                {said.checked ? <><br />{said.checked}</> : null}
              </p>
            ),
          },
        ],
      },
      ...(said.unverified
        ? [
            {
              heading: "还没验证的",
              rows: [
                { weight: lines(said.unverified.length), node: <p class="rc-plain">{said.unverified}</p> },
                ...value.unverified.map(
                  (line): Row => ({
                    weight: lines(line.title.length + line.why.length + 4),
                    node: (
                      <button type="button" class="rc-line open" onClick={() => go(line.id)}>
                        <i class="rc-mark open" aria-hidden="true">●</i>
                        <span>
                          「{line.title}」：{line.why}
                        </span>
                      </button>
                    ),
                  }),
                ),
              ],
            },
          ]
        : []),
    ]
    return paginate(sections, { node: title, weight: 5.5 })
  })

  const step = () => (narrow() ? 1 : 2)
  const last = () => Math.max(0, pages().length - 1)
  // A spread shows two pages side by side (the left one even): narrow windows show one.
  const first = () => (narrow() ? at() : at() - (at() % 2))
  const turn = (by: number) => {
    const next = Math.min(Math.max(0, first() + by * step()), narrow() ? last() : last() - (last() % 2))
    if (next === first()) return
    setTurns({ count: turns().count + 1, back: by < 0 })
    setAt(next)
  }
  const shown = createMemo(() => [first(), ...(narrow() ? [] : [first() + 1])])
  const can = (by: number) => (by < 0 ? first() > 0 : first() + step() <= last())

  onMount(() => {
    veil?.focus()
    const wide = window.matchMedia("(max-width: 820px)")
    const watch = () => setNarrow(wide.matches)
    wide.addEventListener("change", watch)
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
      if (event.key === "Escape") props.onClose()
      else if (event.key === "ArrowRight") turn(1)
      else if (event.key === "ArrowLeft") turn(-1)
      else return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener("keydown", key, true)
    onCleanup(() => {
      wide.removeEventListener("change", watch)
      window.removeEventListener("keydown", key, true)
    })
    void window.studio
      .getReceipt({ projectId: props.projectId })
      .then(setReceipt)
      .catch((cause: unknown) => setFailed(plain(cause)))
  })

  const sheet = (index: number) => {
    const page = pages()[index]
    return (
      <section class="rc-page" data-side={index % 2 === 0 ? "left" : "right"} aria-label={page ? `第 ${index + 1} 页` : undefined}>
        <Show when={page}>
          {(value) => (
            <>
              <div class="rc-body">
                {value().head}
                <For each={value().parts}>
                  {(part) => (
                    <div class="rc-part">
                      <Show when={part.heading}>
                        <h3>
                          {part.heading}
                          <Show when={part.again}>
                            <small>（接上页）</small>
                          </Show>
                        </h3>
                      </Show>
                      <For each={part.rows}>{(row) => row.node}</For>
                    </div>
                  )}
                </For>
              </div>
              <footer class="rc-foot">
                第 {index + 1} 页，共 {pages().length} 页
              </footer>
            </>
          )}
        </Show>
      </section>
    )
  }

  return (
    <div class="rc-veil" onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <div class="rc-book" role="dialog" aria-modal="true" aria-label="检查结果" tabIndex={-1} ref={veil}>
        <button type="button" class="rc-close" aria-label="合上" onClick={() => props.onClose()}>
          <Icon name="close" />
        </button>
        <Show
          when={receipt() && pages().length}
          fallback={
            <div class="rc-spread single">
              <section class="rc-page" data-side="left">
                <div class="rc-body">
                  <header class="rc-title">
                    <h2>检查结果</h2>
                    <strong>{props.projectName}</strong>
                  </header>
                  <p class="rc-plain" role="status">
                    {failed() ? `回执没能读出来：${failed()}` : "正在翻开…"}
                  </p>
                </div>
              </section>
            </div>
          }
        >
          <For each={[turns().count]}>
            {() => (
              <div class="rc-spread" classList={{ single: narrow(), back: turns().back, turned: turns().count > 0 }}>
                <For each={shown()}>{(index) => sheet(index)}</For>
              </div>
            )}
          </For>
          <nav class="rc-turn" aria-label="翻页">
            <button type="button" aria-label="上一页" disabled={!can(-1)} onClick={() => turn(-1)}>
              ◀
            </button>
            <span>{narrow() ? `${at() + 1} / ${pages().length}` : `${first() + 1}${first() + 2 <= pages().length ? `–${first() + 2}` : ""} / ${pages().length}`}</span>
            <button type="button" aria-label="下一页" disabled={!can(1)} onClick={() => turn(1)}>
              ▶
            </button>
            <em>键盘 ← → 翻页，Esc 合上</em>
          </nav>
        </Show>
      </div>
    </div>
  )
}
