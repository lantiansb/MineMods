import { thingName } from "../words"
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show } from "solid-js"
import { FINDING_LABELS, UNSATISFIED } from "@minemods/studio-ai/making"
import { findingLine, gameplayThings, gameplayTryList, thingWord, type GameplayDocument, type GameplayFinding, type GameplaySheet } from "@minemods/mod-core/gameplay"
import { plainFinding } from "@minemods/mod-core/gameplay-plain"
import { CHECK_WORDS, staticChecks } from "@minemods/mod-core/gameplay-check"
import { GAMEPLAY_SCAN_LIMITS } from "@minemods/mod-core/gameplay-scan"
import { AI_CODE_MARK, PLAYTEST_WORDS } from "@minemods/mod-core/gameplay-words"
import type { GameplayStory } from "../../api"
import type { CardPartProps } from "./asset-card-parts"
import "./asset-gameplay.css"
import { Fold } from "../fold"
import { plainWords } from "@minemods/mod-core/play-words"
import { PlayText, Said, SaidLines } from "./play-text"
import { roundsExplained } from "./production-words"

/**
 * What the acceptance card says about a gameplay: what it does in plain words, what it is attached to, that
 * its code was written by an AI, what the four checks said, how to try it in the game, and — behind 高级 —
 * the source itself. Nothing here runs or judges anything: bounds and references are read off the saved
 * document the same way the door reads them; compiling and the review are what was recorded.
 */

type State = "ok" | "bad" | "none"
type Row = { id: "compile" | "bounds" | "references" | "said"; state: State; label: string; note: string | null; findings: GameplayFinding[]; lines: string[]; /** Round 18: what the check or the reviewer wrote apart from the plain lines; shown under 高级 only. */ technical: string[] }

const pixels = (rows: string[]) => rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === "1" ? [`M${x} ${y}h1v1h-1z`] : []))).join("")
const MARKS: Record<State, string> = {
  ok: pixels(["0000000", "0000001", "0000011", "1000110", "1101100", "0111000", "0010000"]),
  bad: pixels(["1100011", "1110111", "0111110", "0011100", "0111110", "1110111", "1100011"]),
  none: pixels(["0000000", "0000000", "0000000", "1111111", "0000000", "0000000", "0000000"]),
}
const CODE_MARK = pixels(["0010100", "0100010", "1000001", "1000001", "1000001", "0100010", "0010100"])

/** The four checks as rows. `live` are bounds and references read off the document now; the rest is what the record holds for this version. */
export function gameplayRows(input: { live: { bounds: GameplayFinding[]; references: GameplayFinding[] } | null; compile: NonNullable<GameplayStory["saved"]>["check"]["compile"] | undefined; review: { passed: boolean; independent: boolean; findings: string[]; advice?: string[]; technical?: string[] } | null | undefined; checked: boolean }): Row[] {
  const compile = input.compile
  const review = input.review
  return [
    {
      id: "compile",
      state: compile ? (compile.ok ? "ok" : "bad") : "none",
      label: compile ? (compile.ok ? CHECK_WORDS.compile.ok : CHECK_WORDS.compile.bad) : CHECK_WORDS.compile.none,
      note: compile ? (compile.ok ? "和工程生成的代码一起编译过，没有打包，也没有开游戏。" : compile.note) : input.live && (input.live.bounds.length || input.live.references.length) ? "越界和引用的问题改掉以后才会编译。" : input.checked ? null : "没有这一版的编译记录（可能是从别处导入的工程）。打包时会真正编译。",
      findings: compile?.findings ?? [],
      lines: [],
      technical: compile?.detail ? [compile.detail] : [],
    },
    { id: "bounds", state: input.live ? (input.live.bounds.length ? "bad" : "ok") : "none", label: input.live?.bounds.length ? CHECK_WORDS.bounds.bad : CHECK_WORDS.bounds.ok, note: input.live?.bounds.length ? null : "读源码查的：不碰电脑上的文件、网络和别的程序，不用反射和 mixin。", findings: input.live?.bounds ?? [], lines: [], technical: [] },
    { id: "references", state: input.live ? (input.live.references.length ? "bad" : "ok") : "none", label: input.live?.references.length ? CHECK_WORDS.references.bad : CHECK_WORDS.references.ok, note: input.live?.references.length ? null : "它用到的东西都在这个工程里，数据文件和两种语言的文字都在。", findings: input.live?.references ?? [], lines: [], technical: [] },
    {
      id: "said",
      state: review ? (review.passed ? "ok" : "bad") : "none",
      label: review ? (review.passed ? CHECK_WORDS.said.ok : CHECK_WORDS.said.bad) : CHECK_WORDS.said.none,
      note: review ? `${review.independent ? "一个没有参与编写的审查员" : "写它的 AI 自己（不是独立审查）"}对着说明读了代码。` : "还没有审查员对着说明读过这一版的代码。",
      findings: [],
      lines: review ? [...review.findings.map((line) => `${FINDING_LABELS.blocking}：${line}`), ...(review.advice ?? []).map((line) => `${FINDING_LABELS.advice}：${line}`)] : [],
      technical: review?.technical ?? [],
    },
  ]
}

function Mark(props: { state: State }) {
  return (
    <svg class="gp-tick" data-state={props.state} viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true">
      <path fill="currentColor" d={MARKS[props.state]} />
    </svg>
  )
}

/** Source files, read-only, with line numbers; a line a check complained about is marked. */
function Sources(props: { document: GameplayDocument; findings: GameplayFinding[] }) {
  const files = createMemo(() => [...props.document.sources.map((file) => ({ ...file, kind: "Java" })), ...props.document.data.map((file) => ({ ...file, kind: "数据" }))])
  const [open, setOpen] = createSignal(0)
  const file = () => files()[Math.min(open(), files().length - 1)]!
  const flagged = () => new Set(props.findings.filter((finding) => finding.file === file().path && finding.line !== null).map((finding) => finding.line!))
  return (
    <div class="gp-code">
      <div class="gp-files" role="tablist" aria-label="源文件">
        <For each={files()}>
          {(value, index) => (
            <button type="button" role="tab" class="gp-file" aria-selected={index() === open()} onClick={() => setOpen(index())}>
              {value.path.split("/").at(-1)}
            </button>
          )}
        </For>
      </div>
      <p class="gp-path">
        {file().kind} · {file().path} · {file().content.split("\n").length} 行 · 只读
      </p>
      <pre class="gp-source" tabIndex={0} aria-label={`${file().path} 的内容`}>
        <For each={file().content.replace(/\n$/, "").split("\n")}>
          {(line, index) => (
            <span class="gp-line" classList={{ flagged: flagged().has(index() + 1) }}>
              <i>{index() + 1}</i>
              <code>{line || " "}</code>
            </span>
          )}
        </For>
      </pre>
    </div>
  )
}

export function GameplayCard(props: CardPartProps) {
  const asset = () => props.project.workspace.assets.find((value) => value.id === props.item.asset_id)
  const document = () => ((value) => (value?.kind === "gameplay" ? (value as unknown as GameplayDocument) : null))(asset()?.document)
  const [story, setStory] = createSignal<GameplayStory | null>(null)
  // Asked again while it is being written: the record is rewritten at every step.
  createEffect(
    on(
      () => [props.projectId, props.item.id, props.item.status, props.item.revision] as const,
      ([projectId, itemId, status]) => {
        const read = () => void window.studio.getGameplay({ projectId, itemId }).then(setStory, () => setStory(null))
        read()
        if (status !== "making") return
        const timer = setInterval(read, 1500)
        onCleanup(() => clearInterval(timer))
      },
    ),
  )
  // Clicking something it attaches to opens that thing's own card: by the id the overview knows it under.
  const [overview] = createResource(
    () => props.projectId,
    (projectId) => window.studio.getProjectOverview({ projectId }).catch(() => null),
  )
  const things = createMemo(() => gameplayThings(props.project))
  const making = () => props.item.status === "making" || !document()
  /** What is described: the saved document, or — while nothing is saved yet — the description its writer has written. */
  const sheet = (): GameplaySheet | null => document() ?? story()?.sheet ?? null
  const used = createMemo(() =>
    (sheet()?.uses ?? []).map((id) => {
      const thing = things().find((value) => value.asset_id === id)
      const item = overview()?.items.find((value) => value.asset_id === id)
      return { id, title: thingName(props.project.workspace.assets.find(asset => asset.id === id)) ?? thing?.title ?? item?.title ?? "已经不在工程里的东西", kind: thing ? thingWord(thing.kind) : "", item: item?.id ?? null }
    }),
  )
  const latest = () => story()?.rounds.at(-1) ?? null
  const live = createMemo(() => ((value) => (value ? staticChecks(props.project, value, props.item.asset_id) : null))(document()))
  const rows = createMemo(() => {
    // While it is being written, what is shown is the newest version checked; afterwards, the saved one.
    const round = making() ? latest() : null
    if (round) return gameplayRows({ live: { bounds: round.check.bounds, references: round.check.references }, compile: round.check.compile, review: story()?.review?.round === round.round ? story()!.review : null, checked: true })
    return gameplayRows({ live: live(), compile: story()?.saved?.check.compile, review: story()?.saved?.review, checked: !!story()?.saved })
  })
  const findings = () => rows().flatMap((row) => row.findings)
  const tries = createMemo(() => ((value) => (value ? gameplayTryList(props.project.mod_id, value, things()) : null))(sheet()))
  /** The lines of the description that `plainWords` changed (a game event said as when it happens), as written. */
  const original = createMemo(() => {
    const value = sheet()
    if (!value) return []
    return [value.summary, ...value.behaviours.flatMap((behaviour) => [behaviour.when, behaviour.does, behaviour.shows]), ...value.not_doing].filter((line) => plainWords(line) !== line)
  })
  const kept = () => story()?.outcome === "kept_unsatisfied"
  const bad = () => rows().filter((row) => row.state === "bad").length

  return (
    <Show when={sheet()}>
      {(described) => (
        <section class="gp-card" data-making={making()}>
          <p class="gp-ai">
            <svg viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true">
              <path fill="currentColor" d={CODE_MARK} />
            </svg>
            <strong>{AI_CODE_MARK}</strong>
            <span>{PLAYTEST_WORDS}</span>
          </p>
          {/* The four checks at a glance; what each found is further down. */}
          <Show when={!making() || latest()}>
            <ul class="gp-strip" aria-label="检查结果一览">
              <For each={rows()}>
                {(row) => (
                  <li data-state={row.state}>
                    <Mark state={row.state} />
                    {row.label}
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={kept() && story()?.kept_reason?.length}>
            <div class="gp-kept">
              <strong>
                {UNSATISFIED.mark}：{UNSATISFIED.words}
              </strong>
              <ul>
                <SaidLines lines={story()!.kept_reason!} advanced={props.advanced} />
                <Show when={props.advanced}>
                  <For each={story()!.kept_technical ?? []}>{(line) => <li class="said-technical">{line}</li>}</For>
                </Show>
              </ul>
            </div>
          </Show>

          <section class="gp-part">
            <h4>{making() ? "它打算做的事" : "它会做的事"}</h4>
            <p class="pa-sentence">
              <Said text={described().summary} events={!props.advanced} />
            </p>
            <ol class="gp-does">
              <For each={described().behaviours}>
                {(behaviour) => (
                  <li>
                    <strong>
                      <Said text={behaviour.when} events={!props.advanced} />
                    </strong>
                    <span>
                      <Said text={behaviour.does} events={!props.advanced} />
                    </span>
                    <small>
                      你会看到、听到：
                      <Said text={behaviour.shows} events={!props.advanced} />
                    </small>
                  </li>
                )}
              </For>
            </ol>
            <Show when={described().not_doing.length}>
              <p class="gp-not">
                <strong>它不做的：</strong>
                <Said text={described().not_doing.join("；")} events={!props.advanced} />
              </p>
            </Show>
          </section>

          <Show when={used().length}>
            <section class="gp-part">
              <h4>它挂在这些东西上</h4>
              <div class="gp-uses">
                <For each={used()}>
                  {(thing) => (
                    <button type="button" class="gp-use mc-slot" disabled={!thing.item} title={thing.item ? `打开「${thing.title}」` : thing.title} onClick={() => thing.item && props.onOpen(thing.item)}>
                      <em>{thing.kind}</em>
                      <span>{thing.title}</span>
                    </button>
                  )}
                </For>
              </div>
            </section>
          </Show>

          <section class="gp-part">
            <h4>
              {making() ? (latest() ? `第 ${latest()!.round} 版的检查结果（最多 ${story()!.rounds_allowed} 版）` : "检查结果") : "检查结果"}
              <Show when={bad()}>
                <em class="gp-count">{bad()} 项有问题</em>
              </Show>
            </h4>
            <Show when={making()}>
              <p class="pa-hint">{roundsExplained(story()!.rounds_allowed, { word: "版", glances: false })}</p>
            </Show>
            <Show when={!making() || latest()} fallback={<p class="pa-hint">代码还没有写出来，写好以后这里会显示每一项检查的结果。</p>}>
              <ul class="gp-checks">
                <For each={rows()}>
                  {(row) => (
                    <li data-state={row.state} data-check={row.id}>
                      <Mark state={row.state} />
                      <div>
                        <strong>{row.label}</strong>
                        <Show when={row.note}>
                          {/* A note from an older record may quote the compiler's own lines: those stay under 高级. */}
                          <small>
                            <SaidLines as="span" lines={[row.note!]} advanced={props.advanced} />
                          </small>
                        </Show>
                        <Show when={row.findings.length || row.lines.length}>
                          <ul class="gp-found">
                            <For each={row.findings}>
                              {(finding) => (
                                <li>
                                  {/* The normal view says what is wrong in the finding's plain sentence (its own, or its rule's) and leaves out the file's name; 高级 has the finding as the check wrote it for whoever fixes the code. */}
                                  <Show when={props.advanced} fallback={<>{plainFinding(finding)}</>}>
                                    <Show when={finding.file}>
                                      <b>
                                        {finding.file}
                                        {finding.line ? ` 第 ${finding.line} 行` : ""}
                                      </b>
                                    </Show>
                                    <Said text={finding.message} events={false} />
                                    <Show when={finding.fix}>
                                      <i>{finding.fix}</i>
                                    </Show>
                                  </Show>
                                </li>
                              )}
                            </For>
                            <SaidLines lines={row.lines} advanced={props.advanced} />
                            <Show when={props.advanced}>
                              <For each={row.technical}>{(line) => <li class="said-technical">{line}</li>}</For>
                            </Show>
                          </ul>
                        </Show>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
              <p class="pa-hint">这四项都是读代码、编译代码得出来的，没有一项是在游戏里试出来的。</p>
            </Show>
          </section>

          <Show when={!making() && tries()}>
            {(list) => (
              <Fold class="gp-try" summary="怎么在游戏里试">
                <p class="pa-hint">照着说明列出来的，只是给你的指引：没有人替你试过，Studio 也不会记录你试了哪几条。</p>
                <h5>先准备</h5>
                <ul>
                  <For each={list().prepare}>{(line) => <li><PlayText text={line} /></li>}</For>
                </ul>
                <h5>一条一条试</h5>
                <ol>
                  <For each={list().steps}>
                    {(step) => (
                      <li>
                        <span>
                          <b>做：</b>
                          <Said text={step.do} />
                        </span>
                        <span>
                          <b>应该：</b>
                          <Said text={step.expect} />
                        </span>
                        <span>
                          <b>留意：</b>
                          <Said text={step.notice} />
                        </span>
                      </li>
                    )}
                  </For>
                </ol>
                <Show when={list().not_expected.length}>
                  <h5>这些不会发生（说明里写了它不做）</h5>
                  <ul>
                    <For each={list().not_expected}>{(line) => <li><Said text={line} /></li>}</For>
                  </ul>
                </Show>
              </Fold>
            )}
          </Show>

          <Show when={props.advanced}>
            <section class="gp-part gp-advanced">
              <h4>源代码和检查记录</h4>
              {/* The description as its writer wrote it, where the normal view had to put plain words in place of the game's own names. */}
              <Show when={original().length}>
                <Fold class="gp-limits" summary="说明的原文（普通视图里把游戏内部的叫法换成了白话）">
                  <ul>
                    <For each={original()}>{(line) => <li>{line}</li>}</For>
                  </ul>
                </Fold>
              </Show>
              <Show when={document()} fallback={<p class="pa-hint">这一版还没有保存，源代码保存以后才能在这里看。</p>}>{(value) => <Sources document={value()} findings={findings()} />}</Show>
              <Show when={story()?.rounds.length}>
                <ol class="gp-rounds">
                  <For each={story()!.rounds}>
                    {(round) => (
                      <li data-passed={round.passed}>
                        <Mark state={round.passed ? "ok" : "bad"} />
                        <span>
                          第 {round.round} 版：{round.passed ? "三项检查都过了" : [...round.check.bounds, ...round.check.references, ...(round.check.compile?.findings ?? [])].slice(0, 2).map(findingLine).join(" ") || round.check.compile?.note || "没通过检查"}
                          <Show when={round.check.compile}>
                            <small>（{round.check.compile!.compiler}）</small>
                          </Show>
                        </span>
                      </li>
                    )}
                  </For>
                </ol>
              </Show>
              <Fold class="gp-limits" summary="“没有越界”查不出什么">
                <ul>
                  <For each={GAMEPLAY_SCAN_LIMITS}>{(line) => <li>{line}</li>}</For>
                </ul>
              </Fold>
            </section>
          </Show>
        </section>
      )}
    </Show>
  )
}
