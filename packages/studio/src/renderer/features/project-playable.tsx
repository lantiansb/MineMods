import { WORDS } from "../words"
import { For, Show } from "solid-js"
import { PLAY_MARKS, PLAY_OPEN, PLAY_QUESTIONS, type PlayQuestion, type PlayReport } from "@minemods/mod-core/playable"
import { Fold } from "../fold"
import "./project-playable.css"

/** Keep each complete sentence and its order. Collapse only the long parts of a boss answer. */
export function bossSections(text: string) {
  const sections: { title: string; text: string }[] = []
  let title = "战斗反应"
  for (const part of text.split(/；(?=出手用招式|连招：|它是 Boss：|一开始|第一阶段|血量掉到|死的时候)/)) {
    if (/^(出手用招式|连招：)/.test(part)) title = "招式"
    if (/^它是 Boss：/.test(part)) title = "血条"
    if (/^(一开始|死的时候)/.test(part)) title = "演出"
    if (/^(第一阶段|血量掉到)/.test(part)) title = "阶段"
    const last = sections.at(-1)
    if (last?.title === title) last.text += "；" + part
    else sections.push({ title, text: part })
  }
  return sections
}

type Thing = PlayReport["things"][number]
type Row = Thing["rows"][number]
/** What a paper play-through of the plan found, as stored with it. */
export type Paper = { findings: string[]; advice: string[]; by: "studio" | "outside"; independent: boolean }

/**
 * 「能不能玩」: every thing of the mod with its answers to the four questions, each marked with whose answer it
 * is. A question nobody answered is said in plain words. With the handlers the person can have an AI fill it
 * in or say it is left out on purpose; without them the list is only read. It decides nothing by itself.
 */
export function PlayAnswers(props: {
  titleOf?: (id: string) => string | undefined
  display?: (line: string) => string
  report: PlayReport
  /** Narrow, on the dark side panel beside idea cards. */
  side?: boolean
  busy?: boolean
  /** The words on the fill button: Studio's own AI, or a sentence copied for an outside one. Absent: no AI can be asked from here. */
  fill?: string
  onFill?: () => void
  onDecline?: (thing: string, question: PlayQuestion) => void
  /** Take back a 「故意不做」 the person clicked. */
  onRestore?: (thing: string, question: PlayQuestion) => void
  paper?: Paper | null
  advanced?: boolean
}) {
  const open = (thing: Thing) => thing.rows.filter((row) => row.state === "gap").length
  const loop = (thing: Thing) => props.report.gaps.filter((gap) => gap.thing === thing.id && gap.rule !== "unanswered")
  return (
    <div class="pp-answers" classList={{ side: props.side }}>
      <For each={props.report.things}>
        {(thing) => (
          <section class="pp-thing" data-thing={thing.id} data-open={open(thing) || loop(thing).length ? "yes" : "no"}>
            <header>
              <strong>{props.titleOf?.(thing.id) ?? thing.title}</strong>
              <em>{thing.label}</em>
              <Show when={open(thing)}>
                <small class="warn">{open(thing)} 个问题还没有答案</small>
              </Show>
            </header>
            <dl>
              <For each={thing.rows}>
                {(row: Row) => (
                  <>
                    <dt>{row.label}</dt>
                    <dd data-state={row.state} data-mark={row.mark} data-question={row.question}>
                      <i>{row.mark === "made" ? WORDS.ready : PLAY_MARKS[row.mark]}</i>
                      <span>
                        {/* Where nothing was said, the question itself is shown: the mark already says it is open. */}
                        <For each={row.lines}>{line => {
                          const words = () => props.display?.(line) ?? line
                          return <Show when={line.includes("它是 Boss：")} fallback={<span>{line === PLAY_OPEN ? `要回答：${PLAY_QUESTIONS[row.question].asks}` : words()}</span>}>
                            <For each={bossSections(words())}>{section => <Fold class="boss-answer" summary={section.title} open={section.text.length < 100}>
                              <For each={section.text.split("；")}>{part => <span>{part}</span>}</For>
                            </Fold>}</For>
                          </Show>
                        }}</For>
                      </span>
                      <Show when={row.state === "gap" && (props.onFill || props.onDecline)}>
                        <span class="pp-acts">
                          <Show when={props.onFill && props.fill}>
                            <button type="button" class="pa-link" disabled={props.busy} onClick={() => props.onFill?.()}>
                              {props.fill}
                            </button>
                          </Show>
                          <Show when={props.onDecline}>
                            <button type="button" class="pa-link" disabled={props.busy} onClick={() => props.onDecline?.(thing.id, row.question)}>
                              故意不做
                            </button>
                          </Show>
                        </span>
                      </Show>
                      <Show when={row.mark === "person" && props.onRestore}>
                        <span class="pp-acts">
                          <button type="button" class="pa-link" disabled={props.busy} onClick={() => props.onRestore?.(thing.id, row.question)}>
                            还是要做
                          </button>
                        </span>
                      </Show>
                    </dd>
                  </>
                )}
              </For>
            </dl>
            <For each={loop(thing)}>{(gap) => <p class="pp-loop">{gap.text}</p>}</For>
          </section>
        )}
      </For>
      <Show when={props.paper}>
        {(paper) => (
          <section class="pp-paper" data-stuck={paper().findings.length ? "yes" : "no"}>
            <header>
              <strong>在纸上玩了一遍</strong>
              <small>
                {paper().by === "studio"
                  ? "一个没参与规划的试玩员，只看你的话和上面这些答案，从新的生存世界走了一遍。它没有进游戏，也可能看漏。"
                  : `你的 AI 说它${paper().independent ? "请了一个没参与规划的审查员" : "自己"}照着这些答案走了一遍。Studio 没法验证这一点。`}
              </small>
            </header>
            <Show when={paper().findings.length + paper().advice.length} fallback={<p class="pp-fine">从头到尾走得通，没有发现卡住或者白忙的地方。</p>}>
              <Show when={paper().findings.length}>
                <h4>必须改的 {paper().findings.length}</h4>
                <ul class="must">
                  <For each={paper().findings}>{(line) => <li>{line}</li>}</For>
                </ul>
              </Show>
              <Show when={paper().advice.length}>
                <h4>可以更好的 {paper().advice.length}</h4>
                <ul>
                  <For each={paper().advice}>{(line) => <li>{line}</li>}</For>
                </ul>
              </Show>
              <Show when={paper().findings.length && props.onFill && props.fill}>
                <button type="button" class="pa-link" disabled={props.busy} onClick={() => props.onFill?.()}>
                  {props.fill}
                </button>
              </Show>
            </Show>
          </section>
        )}
      </Show>
    </div>
  )
}
