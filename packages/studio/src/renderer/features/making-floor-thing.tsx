import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import type { ActivityEvent, Making, OverviewItem, ProjectOverview } from "../../api"
import { Icon } from "../ui"
import { MakingStory, plainLabel } from "./asset-making"
import { MotionPlay } from "./motion-play"
import type { Project } from "@minemods/mod-core/project"
import { cachedPicture, loadPicture, type Picture } from "./asset-picture"
import { isWhole, recordRound, REPLACED_WORDS, roundVerdict, shortWhen, thingTimeline, type FloorRow, type Moment, type RoundTone } from "./making-floor-model"
import { clock } from "./project-activity-model"
import { SaidLines } from "./play-text"
import { StatusMark } from "./project-assets"

export type Glyph = Parameters<typeof Icon>[0]["name"]
/** A picture shown large, with what it is of. */
export type Zoomed = { url: string; label: string }

// Who or what an event is from, in a word. The raw kind stays under 高级.
const KIND_WORDS: Record<ActivityEvent["kind"], string> = { plan: "规划", batch: "这一批", task: "制作", look: "出图", review: "审查", build: "打包", person: "你", tool: "外部 AI", check: "检查", note: "记录" }
const MARK_WORDS: Record<ActivityEvent["mark"], string> = { run: "进行中", ok: "顺利", fail: "没成", warn: "要留意", note: "说明" }

/** A slot with the thing's own picture, or the mark of its kind when it has none yet. */
export function FloorPicture(props: { picture: Picture | null; glyph: Glyph; large?: boolean; onZoom?: (url: string) => void }) {
  const [url, setUrl] = createSignal<string | null>(null)
  // The picture object is made anew on every read of the list; only its key says whether it changed.
  const key = createMemo(() => props.picture?.key)
  createEffect(
    on(
      key,
      () => {
        const picture = props.picture
        setUrl(picture ? (cachedPicture(picture.key) ?? null) : null)
        if (!picture || cachedPicture(picture.key) !== undefined) return
        const asked = { live: true }
        void loadPicture(picture).then((made) => asked.live && setUrl(made))
        onCleanup(() => (asked.live = false))
      },
    ),
  )
  const inside = () => (
    <Show when={url()} fallback={<Icon name={props.glyph} />}>
      <img src={url()!} classList={{ pixel: props.picture?.pixel }} alt="" draggable={false} />
    </Show>
  )
  return (
    <Show
      when={props.onZoom && url()}
      fallback={
        <span class="mf-cell mc-slot" classList={{ large: props.large }}>
          {inside()}
        </span>
      }
    >
      <button type="button" class="mf-cell mc-slot" classList={{ large: props.large }} title="点一下放大看" aria-label="放大看这张图" onClick={() => props.onZoom!(url()!)}>
        {inside()}
      </button>
    </Show>
  )
}

/** One picture over the whole window. Escape or a click anywhere closes it. */
export function FloorZoom(props: { shown: Zoomed | null; onClose: () => void }) {
  createEffect(() => {
    if (!props.shown) return
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopImmediatePropagation()
      props.onClose()
    }
    window.addEventListener("keydown", key, true)
    onCleanup(() => window.removeEventListener("keydown", key, true))
  })
  return (
    <Show when={props.shown}>
      {(shown) => (
        <div class="mk-zoom mf-zoom" role="dialog" aria-modal="true" aria-label={shown().label} onClick={props.onClose}>
          <header>
            <strong>{shown().label}</strong>
            <span class="pa-moves-gap" />
            <button type="button" class="pa-move" onClick={props.onClose}>
              关上
            </button>
          </header>
          <img src={shown().url} alt={shown().label} draggable={false} onLoad={(event) => event.currentTarget.classList.toggle("pixel", event.currentTarget.naturalWidth < 200)} />
        </div>
      )}
    </Show>
  )
}

/**
 * One event of the activity log as a line of a story. In the live view it names its thing and leads there;
 * in a thing's own story it leads to the round it is about. 高级 adds everything else the event carries.
 */
export function EventNode(props: {
  event: ActivityEvent
  advanced: boolean
  /** Shown in front of the sentence when the list mixes things. */
  thing?: string | null
  /** Where a click on the line leads; absent when it leads nowhere. */
  onVisit?: () => void
  visitTitle?: string
  /** The picture the small one was made from, when the making record still has it. */
  full?: string
  onZoom: (shown: Zoomed) => void
}) {
  const words = () => (
    <>
      <time title={new Date(props.event.at).toLocaleString("zh-CN")}>{clock(props.event.at)}</time>
      <span class="mf-node-text">
        <Show when={props.thing}>
          <b class="mf-node-thing">{props.thing}</b>
        </Show>
        {/* Who it is from, unless the sentence already begins with that. */}
        <Show when={!props.event.text.startsWith(KIND_WORDS[props.event.kind])}>
          <i class="mf-node-kind">{KIND_WORDS[props.event.kind]}</i>
        </Show>
        {props.event.text}
        <Show when={props.event.round !== undefined && !/第 \d+ [版轮]/.test(props.event.text)}>
          <i class="mf-node-kind after">第 {props.event.round} 轮</i>
        </Show>
        <Show when={props.event.lines?.length}>
          <span class="mf-node-lines">
            <SaidLines as="span" lines={props.event.lines ?? []} advanced={props.advanced} />
          </span>
        </Show>
      </span>
    </>
  )
  return (
    <li class="mf-node" data-mark={props.event.mark} data-kind={props.event.kind} data-seq={props.event.seq} classList={{ quiet: props.event.quiet, step: props.event.step, end: props.event.end }}>
      <div class="mf-node-row">
        <Show when={props.onVisit} fallback={<div class="mf-node-main">{words()}</div>}>
          <button type="button" class="mf-node-main" title={props.visitTitle} onClick={() => props.onVisit!()}>
            {words()}
          </button>
        </Show>
        <Show when={props.event.thumb}>
          <button type="button" class="mf-thumb mc-well" title="点一下放大看" aria-label="放大看这张图" onClick={() => props.onZoom({ url: props.full ?? props.event.thumb!, label: `${props.event.title ?? ""} ${props.event.round ? `第 ${props.event.round} 轮` : ""}`.trim() || "制作时的图" })}>
            <img src={props.event.thumb} alt="" draggable={false} />
          </button>
        </Show>
      </div>
      <Show when={props.advanced}>
        <pre class="mf-tech">
          {[
            [`#${props.event.seq}`, props.event.kind, `${props.event.mark}（${MARK_WORDS[props.event.mark]}）`, props.event.end ? "end（收尾）" : null, props.event.step ? "step（进行中的一步）" : null, props.event.quiet ? "quiet（别的记录已经说过）" : null, props.event.round === undefined ? null : `round ${props.event.round}`]
              .filter(Boolean)
              .join(" · "),
            [props.event.tool, props.event.ms === undefined ? null : `${props.event.ms} 毫秒`, props.event.item ? `item ${props.event.item}` : null].filter(Boolean).join(" · "),
            // The detail of a tool call repeats its name and time in its first line.
            props.event.detail?.replace(/^[a-z_]+ · \d+ 毫秒\n?/, ""),
          ]
            .filter(Boolean)
            .join("\n")}
        </pre>
      </Show>
    </li>
  )
}

/** A list that stays at its newest line until the person scrolls away, with the way back. */
export function FollowScroll(props: { class?: string; label: string; /** Changes when the list grows. */ stamp: unknown; /** Changes when the list becomes another list: it then starts at its newest line again. */ scope?: string; /** The list opens at its first line: what stands there is the record itself, the log comes after. */ fromTop?: boolean; children: JSX.Element }) {
  let host!: HTMLDivElement
  const [following, setFollowing] = createSignal(!props.fromTop)
  const atEnd = () => host.scrollHeight - host.scrollTop - host.clientHeight < 28
  // A list that opens at its first line and fits its box is at its newest line all the same.
  onMount(() => props.fromTop && queueMicrotask(() => setFollowing(atEnd())))
  const toBottom = () => {
    setFollowing(true)
    host.scrollTo({ top: host.scrollHeight })
  }
  const scope = createMemo(() => props.scope)
  createEffect(on(scope, () => queueMicrotask(() => (props.fromTop ? (host.scrollTo({ top: 0 }), setFollowing(atEnd())) : toBottom())), { defer: true }))
  const stamp = createMemo(() => props.stamp)
  createEffect(
    on(
      stamp,
      () => following() && queueMicrotask(() => host?.scrollTo({ top: host.scrollHeight })),
    ),
  )
  return (
    <div class={`mf-follow ${props.class ?? ""}`}>
      <div class="mf-follow-scroll" ref={host} role="log" aria-label={props.label} onScroll={() => setFollowing(atEnd())}>
        {props.children}
      </div>
      <Show when={!following()}>
        <button type="button" class="ac-jump mf-jump" onClick={toBottom}>
          回到最新
        </button>
      </Show>
    </div>
  )
}

type Entry = ActivityEvent | Making["rounds"][number] | NonNullable<Making["review"]>
const VERDICT_WORDS = { accepted: "你说：验收通过", rejected: "你说：退回重做" } as const
const PROBLEM_WORDS: Record<ProjectOverview["problems"][number]["kind"], string> = { missing_reference: "缺东西", unused: "没人用", blocked: "被卡住", stale: "它用到的东西重做过" }
// How a round's line is marked: only a passed review is the green of "went well"; a maker's own opinion has no colour of its own.
const TONE_MARK: Record<RoundTone, ActivityEvent["mark"]> = { pass: "ok", fail: "warn", revise: "warn", own: "note", wait: "run" }
const yesNo = (value: boolean | null) => (value === null ? "—" : value ? "是" : "否")

/**
 * The right side of 制作现场 for one row: who it is, the making story as the overview card shows it (the same
 * component), and beside it every recorded moment in the order it happened. A row without a making record
 * (a recipe, the blueprint, a build) is its moments alone.
 */
export function ThingStory(props: {
  projectId: string
  /** The open project: with it a model's motions can be played here. */
  project?: Project
  row: FloorRow
  items: OverviewItem[]
  making: Making | undefined
  /** The making record has been asked for; false while the first answer is still on its way. */
  read: boolean
  picture: Picture | null
  glyph: Glyph
  advanced: boolean
  problems: ProjectOverview["problems"]
  /** The round a link asked for, with the time of the record that named it when one did; handled once the record is there. */
  round: { round: number; at?: string } | null
  onRound: () => void
  /** Records that belong to this row and are not events: the runs for the batches, the build job for the build. */
  extra?: JSX.Element
  /** What an outside AI has shown of it so far, when it has not been saved yet. */
  draft?: JSX.Element
  onSelect: (id: string, round?: number) => void
  /** Open the saved thing itself, where it can be looked at and changed. */
  onOpen?: () => void
  /** Lead to this thing's card on the overview, where the person says yes or no to a version. Offered only while a version waits for that. */
  onVerdict?: () => void
  onZoom: (shown: Zoomed) => void
  /** The person opened a round or a large picture of this thing: the page stops following what is being made, so the thing under their eyes does not change. */
  onHold?: () => void
}) {
  let storyHost: HTMLDivElement | undefined
  const [tab, setTab] = createSignal<"story" | "line">("story")
  const [about, setAbout] = createSignal(false)
  // An old record was opened whose version a redo has replaced: said plainly, and no round is picked for it.
  const [replaced, setReplaced] = createSignal(false)
  const item = () => props.row.item
  const timeline = createMemo(() => thingTimeline(props.making, props.row.events, props.advanced))
  const titled = (id: string) => props.items.find((value) => value.id === id)?.title ?? id
  // The story has one stop per round, in order, and one for how it ended. It is another feature's component, so a stop is pressed, not set.
  const press = (round: number | "end") => {
    setReplaced(false)
    setTab("story")
    queueMicrotask(() => {
      const stops = storyHost?.querySelectorAll<HTMLButtonElement>(".mk-film button.mk-stop") ?? []
      const index = round === "end" ? stops.length - 1 : (props.making?.rounds.findIndex((value) => value.round === round) ?? -1)
      const stop = round === "end" ? storyHost?.querySelector<HTMLButtonElement>(".mk-film button.mk-stop.end") : stops[index]
      stop?.click()
      stop?.scrollIntoView({ block: "nearest", inline: "nearest" })
    })
  }
  createEffect(() => {
    const asked = props.round
    if (asked === null || !props.making) return
    props.onRound()
    // Without a time the link came from the story itself, which only ever shows the making there is.
    const target = asked.at ? recordRound({ at: asked.at, round: asked.round }, props.making) : ({ making: "current", round: asked.round } as const)
    if (target?.making === "current") return press(target.round)
    setReplaced(target?.making === "replaced")
  })
  const visit = (event: ActivityEvent) => {
    const target = recordRound(event, props.making)
    if (target?.making === "current") return () => press(target.round)
    return target ? () => setReplaced(true) : undefined
  }
  // Another row starts at its own story; a row without one has only its moments.
  const rowId = createMemo(() => props.row.id)
  createEffect(on(rowId, () => (setTab("story"), setAbout(false), setReplaced(false)), { defer: true }))
  const pane = () => (props.making || props.draft ? tab() : "line")
  const links = (label: string, ids: string[]) => (
    <Show when={ids.length}>
      <p class="mf-links">
        <span>{label}</span>
        <For each={ids}>
          {(id) => (
            <button type="button" class="pa-link" onClick={() => props.onSelect(id)}>
              {titled(id)}
            </button>
          )}
        </For>
      </p>
    </Show>
  )
  // The list is keyed by the records themselves (an event, a round, the review), which stay the same objects from one read to the next,
  // so a story that grows adds lines instead of being drawn again.
  const records = createMemo(() => timeline().moments.map((value) => (value.type === "event" ? value.event : value.type === "round" ? value.round : value.review)))
  const momentOf = (record: Entry): Moment => ("seq" in record ? { type: "event", at: record.at, event: record } : "pictures" in record ? { type: "round", at: record.at, round: record } : { type: "review", at: record.at, review: record })
  const moment = (record: Entry) => {
    const value = momentOf(record)
    if (value.type === "event")
      return (
        <EventNode
          event={value.event}
          advanced={props.advanced}
          onVisit={visit(value.event)}
          visitTitle={recordRound(value.event, props.making)?.making === "current" ? "点一下，看这一轮的图和检查" : REPLACED_WORDS}
          full={recordRound(value.event, props.making)?.making === "current" ? props.making?.rounds.find((round) => round.round === value.event.round)?.pictures[0]?.url : undefined}
          onZoom={props.onZoom}
        />
      )
    if (value.type === "round") {
      const cover = value.round.cover ?? value.round.pictures[0]?.url
      return (
        <li class="mf-node mf-node-round" data-mark={TONE_MARK[roundVerdict(props.making, value.round, props.row.events).tone]} data-tone={roundVerdict(props.making, value.round, props.row.events).tone}>
          <div class="mf-node-row">
            <button type="button" class="mf-node-main" title="点一下，看这一轮的图和检查" onClick={() => press(value.round.round)}>
              <time title={new Date(value.at).toLocaleString("zh-CN")}>{clock(value.at)}</time>
              <span class="mf-node-text">
                <b class="mf-node-thing">第 {value.round.round} 轮</b>
                {roundVerdict(props.making, value.round, props.row.events).words}
                <Show when={value.round.pictures.length}>
                  <i class="mf-node-kind after">{value.round.pictures.length} 张图</i>
                </Show>
              </span>
            </button>
            <Show when={cover}>
              <button type="button" class="mf-thumb mc-well" title="点一下放大看" aria-label={`放大看第 ${value.round.round} 轮的图`} onClick={() => props.onZoom({ url: value.round.pictures[0]?.url ?? cover!, label: `${props.row.title} · 第 ${value.round.round} 轮${value.round.pictures[0] ? ` · ${plainLabel(value.round.pictures[0].label)}` : ""}` })}>
                <img src={cover} alt="" draggable={false} />
              </button>
            </Show>
          </div>
        </li>
      )
    }
    return (
      <li class="mf-node mf-node-round" data-mark={value.review.passed ? "ok" : "fail"}>
        <div class="mf-node-row">
          <button type="button" class="mf-node-main" title="点一下，看审查的结论" onClick={() => press("end")}>
            <time title={new Date(value.at).toLocaleString("zh-CN")}>{clock(value.at)}</time>
            <span class="mf-node-text">
              <b class="mf-node-thing">审查</b>
              {value.review.independent ? "另一位没参与制作的 AI" : "做它的那个 AI 自己"}：{value.review.passed ? "通过" : "没通过"}
              <Show when={value.review.round}>
                <i class="mf-node-kind after">看的是第 {value.review.round} 轮</i>
              </Show>
              <Show when={value.review.findings.length || value.review.advice?.length}>
                <span class="mf-node-lines">
                  <SaidLines as="span" lines={[...value.review.findings, ...(value.review.advice ?? []).map((line) => `可以更好：${line}`)]} advanced={props.advanced} />
                  <Show when={props.advanced}>
                    <For each={value.review.technical ?? []}>{(line) => <span class="said-technical">{line}</span>}</For>
                  </Show>
                </span>
              </Show>
            </span>
          </button>
        </div>
      </li>
    )
  }

  return (
    <section class="mf-thing" data-row={props.row.id} aria-label={`${props.row.title}的制作经过`}>
      <header class="mf-thing-head">
        <FloorPicture picture={props.picture} glyph={props.glyph} large onZoom={(url) => props.onZoom({ url, label: props.row.title })} />
        <div class="mf-thing-name">
          <h2>{props.row.title}</h2>
          <p>
            <span class="mf-kind">{props.row.kindLabel}</span>
            <Show when={item()}>{(value) => <StatusMark status={value().status} label={value().status_label} words />}</Show>
            <Show when={item()?.ai_interrupted}>
              <em class="pa-unsat">被中断了</em>
            </Show>
            <Show when={item()?.ai_unsatisfied && !item()?.ai_interrupted}>
              <em class="pa-unsat">AI 还不满意</em>
            </Show>
            <Show when={props.row.rounds}>
              <span class="mf-kind">做了 {props.row.rounds} 轮</span>
            </Show>
            <Show when={props.row.at}>
              <time>{shortWhen(props.row.at)}</time>
            </Show>
          </p>
          <p class="mf-thing-verdict">{props.row.verdict}</p>
        </div>
        <div class="mf-thing-actions">
          <Show when={props.onVerdict && item()?.status === "review" && item()?.review_asked && item()?.facts.accepted === null}>
            <button type="button" class="pa-move" onClick={() => props.onVerdict!()}>
              去验收
            </button>
          </Show>
          <Show when={props.onOpen}>
            <button type="button" class="pa-move" onClick={() => props.onOpen!()}>
              打开这样东西
            </button>
          </Show>
          <Show when={item()}>
            <button type="button" class="pa-move" aria-expanded={about()} onClick={() => setAbout(!about())}>
              {about() ? "收起底细" : "它的底细"}
            </button>
          </Show>
        </div>
      </header>
      <Show when={item()}>
        {(value) => (
          <div class="mf-about" classList={{ open: about() }}>
            <Show when={value().reason}>
              <p class="mf-reason" data-status={value().status}>
                {value().reason}
              </p>
            </Show>
            <For each={props.problems}>
              {(problem) => (
                <p class="mf-reason">
                  <b>{PROBLEM_WORDS[problem.kind]}</b>
                  {problem.message}
                </p>
              )}
            </For>
            <Show when={value().review}>
              {(review) => (
                <p class="mf-reason" data-verdict={review().verdict}>
                  <b>{VERDICT_WORDS[review().verdict]}</b>
                  {review().note}
                  <time>{shortWhen(review().at)}</time>
                </p>
              )}
            </Show>
            <Show when={about()}>
              <Show when={value().brief} fallback={<p class="pa-hint">它没有留下「要做成什么」的说明。</p>}>
                <p class="mf-brief">
                  <span>要做成什么</span>
                  {value().brief}
                </p>
              </Show>
              <Show when={value().out_of_scope}>
                <p class="mf-brief">
                  <span>为什么不做这个了</span>
                  {value().out_of_scope}
                </p>
              </Show>
              <Show when={value().owner}>{(owner) => links("它属于", [owner()])}</Show>
              {links("它用到", value().needs)}
              {links("谁在用它", value().used_by)}
              <p class="pa-hint">{value().review_asked ? (value().facts.accepted === null ? "这一版在等你验收：到「工程总览」里打开它，说可以还是要改。" : "这一版你已经表过态了。") : "这一样不用你验收。"}想改它的说明或者让它重做，也在「工程总览」里。</p>
              <Show when={props.advanced}>
                <dl class="pa-tech mf-facts">
                  <dt>种类 · 状态</dt>
                  <dd>
                    {value().kind} · {value().status}
                  </dd>
                  <dt>蓝图里的标识 · id</dt>
                  <dd>
                    {value().key ?? "—"} · {value().id}
                  </dd>
                  <dt>这样东西的 ID · 版本</dt>
                  <dd>
                    {value().asset_id ?? "—"} · {value().revision ?? "—"}
                  </dd>
                  <dt>已保存 · 已做进模组 · 游戏内测试 · 客户端测试 · 你验收过了</dt>
                  <dd>
                    {yesNo(value().facts.saved)} · {yesNo(value().facts.built)} · {yesNo(value().facts.gametest)} · {yesNo(value().facts.client)} · {yesNo(value().facts.accepted)}
                  </dd>
                  <dt>画它用的文档</dt>
                  <dd>
                    {value().preview.source ?? "—"} · 模型 {value().preview.model_asset_id ?? "—"} · 贴图 {value().preview.texture_asset_id ?? "—"} · 生物 {value().preview.entity_id ?? "—"}
                  </dd>
                  <Show when={value().judged}>
                    {(judged) => (
                      <>
                        <dt>检查标准当时听到的</dt>
                        <dd>
                          {judged().asked || "—"}
                          {judged().complexity ? ` · 精细程度 ${judged().complexity}${judged().insisted ? "（你指定的）" : ""}` : ""}
                          <br />
                          {judged().brief}
                        </dd>
                      </>
                    )}
                  </Show>
                  <Show when={props.making}>
                    {(making) => (
                      <>
                        <dt>制作记录</dt>
                        <dd>
                          item {making().item_id} · asset {making().asset_id ?? "—"} · state {making().state} · outcome {making().outcome ?? "—"} · stopped_reason {making().stopped_reason ?? "—"} · 最多 {making().rounds_allowed} 轮 · kept_round {making().kept_round ?? "—"}
                          {making().sheetless ? " · sheetless" : ""} · 参考图 {(making().references ?? []).map((reference) => `${reference.kind}:${reference.name}`).join("、") || "—"}
                        </dd>
                      </>
                    )}
                  </Show>
                </dl>
              </Show>
            </Show>
          </div>
        )}
      </Show>
      <Show when={replaced()}>
        <p class="mf-reason mf-replaced" role="status">
          {REPLACED_WORDS}。下面是现在这一版的制作过程。
        </p>
      </Show>
      <Show when={props.making || props.draft}>
        <div class="mf-tabs" role="tablist" aria-label="看哪一面">
          <button type="button" role="tab" class="pa-move" aria-selected={tab() === "story"} aria-pressed={tab() === "story"} onClick={() => setTab("story")}>
            {props.making ? "制作过程" : "现在的草稿"}
          </button>
          <button type="button" role="tab" class="pa-move" aria-selected={tab() === "line"} aria-pressed={tab() === "line"} onClick={() => setTab("line")}>
            全部经过 · {timeline().moments.length} 条
          </button>
        </div>
      </Show>
      <div class="mf-thing-body" data-pane={pane()} classList={{ single: !props.making && !props.draft }}>
        <Show when={props.making || props.draft}>
          <div class="mf-story" ref={storyHost}>
            <Show when={props.making} fallback={props.draft}>
              {(making) => (
                <MakingStory
                  projectId={props.projectId}
                  kind={props.row.kind}
                  making={making()}
                  events={props.row.events}
                  locked="这里只看不改。想改这份说明或者让它重做，到「工程总览」里打开这样东西。"
                  sheetFolded
                  onHold={props.onHold}
                  play={props.project ? <MotionPlay projectId={props.projectId} project={props.project} item={props.row.item} /> : undefined}
                  busy={false}
                  promise=""
                  saved={0}
                  onSave={() => undefined}
                  onRedo={() => undefined}
                />
              )}
            </Show>
          </div>
        </Show>
        <div class="mf-line">
          <h3>
            全部经过<small>{isWhole(props.row.id) ? "按发生的先后" : "每一轮、每一次检查、退回和保存，按发生的先后"}</small>
          </h3>
          <FollowScroll label={`${props.row.title}的全部经过`} fromTop={!!props.extra} scope={`${props.row.id}:${pane()}`} stamp={`${timeline().moments.length}:${timeline().live?.seq}`}>
            {props.extra}
            <Show
              when={timeline().moments.length || timeline().live}
              fallback={
                <p class="pa-hint mf-none">
                  {!props.read && item() ? "正在读它的制作记录…" : props.extra ? "动态里没有别的记录。" : item()?.status === "planned" ? "还没轮到它，所以什么记录都没有。" : item()?.status === "making" ? "它正在做。第一条记录出来以后，会显示在这里。" : "它没有留下制作时的记录：可能是手做的，或者是在有记录之前做的。"}
                </p>
              }
            >
              <ol class="mf-nodes">
                <For each={records()}>{moment}</For>
                <Show when={timeline().live}>
                  {(live) => (
                    <li class="mf-node mf-live" data-mark="run">
                      <div class="mf-node-row">
                        <div class="mf-node-main">
                          <time>{clock(live().at)}</time>
                          <span class="mf-node-text">
                            {live().text}
                            <i class="ac-cursor" aria-hidden="true" />
                          </span>
                        </div>
                      </div>
                    </li>
                  )}
                </Show>
              </ol>
            </Show>
          </FollowScroll>
        </div>
      </div>
    </section>
  )
}
