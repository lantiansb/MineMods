import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import type { Project } from "@minemods/mod-core/project"
import type { ActivityEvent, Making, ReferenceImage } from "../../api"
import { missingBones, type MakingTrace } from "../../making-trace"
import { paintedPreview } from "../model-paint-preview"
import { ModuleDocumentPreview } from "./making-history"
import { ModelCanvas } from "./model-canvas"
import { copyAt, partProgress, partTitle, partsAt, passageRows, roadOf, stepAt, thinkingLine, type PassageRow, type RoadStop } from "./making-live-model"
import { clock, presenceLine } from "./project-activity-model"
import { calm } from "../calm"
import { keepSame } from "../keep-same"
import "./brief-note.css"
import "./making-live.css"

const TAG_COLOUR: Record<string, string> = { 写入: "write", 看图: "look", 改: "write", 审查: "review", 开始: "review" }
/** How long one step of 「回放过程」 stands. */
const REPLAY_STEP = 700
const plainGrey = { url: "" }
const grey = () => {
  if (plainGrey.url) return plainGrey.url
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 2
  const context = canvas.getContext("2d")
  if (!context) return ""
  context.fillStyle = "#cfcfcf"
  context.fillRect(0, 0, 2, 2)
  plainGrey.url = canvas.toDataURL("image/png")
  return plainGrey.url
}

/**
 * 制作现场 for one thing that is being made or has a recorded making: which stop it is at, the document as it was last written, the part the hand is on, what the AI says it is
 * doing, a timeline of every write that can be walked back, and the whole passage beside it. It reads and changes nothing.
 */
export function MakingLive(props: {
  projectId: string
  project: Project
  /** A thing on the list, or a first version on no list yet. */
  subject: { id: string; title: string; kind: string; making: boolean; said: string; events: readonly ActivityEvent[] }
  assetId: string
  making: Making | undefined
  /** What the project holds now, or the draft in hand: what stands on the stage before any step has been recorded. */
  fallback: ModuleDocument | null
  advanced: boolean
  /** An outside AI's connection as it stands: gone quiet or gone away, it is not 「在想」. */
  presence?: string
  /** The rounds, pictures and sheet of the making, as this page showed them before. */
  onStory: () => void
}) {
  const [trace, setTrace] = createSignal<MakingTrace | null>(null)
  const [before, setBefore] = createSignal<ModuleDocument | null>(null)
  const [shown, setShown] = createSignal<{ version: number; seq: number; document: ModuleDocument } | null>(null)
  // null: following the newest step. A number: the person has walked back to that step.
  const [at, setAt] = createSignal<number | null>(null)
  const [playing, setPlaying] = createSignal(false)
  const [follow, setFollow] = createSignal(true)
  const [bare, setBare] = createSignal(false)
  const [references, setReferences] = createSignal<ReferenceImage[]>([])
  const copies = new Map<string, ModuleDocument | null>()

  const steps = () => trace()?.steps ?? []
  // What the list has read of its making; a thing on no list yet reads its own, each time something new is written.
  const [ownMaking, setOwnMaking] = createSignal<Making | null>(null)
  const record = () => props.making ?? ownMaking() ?? undefined
  const parts = () => record()?.sheet?.parts ?? null
  const making = () => props.subject.making
  const stepNow = createMemo(() => stepAt(steps(), at()))
  const document = () => shown()?.document ?? props.fallback
  const model = createMemo(() => (document()?.kind === "model" ? (document() as ModelDesign & ModuleDocument) : null))

  // What stands on the stage: the copy kept at the step in view. The window is told of a new step at once; the slow read is there for what that message missed.
  // Whatever comes back is looked at against what is in view now: this page stays when another thing is chosen, and an answer about the last one that arrives late is not about this one.
  const read = async () => {
    const asked = props.assetId
    const next = await window.studio.getMakingTrace({ projectId: props.projectId, assetId: asked }).catch(() => null)
    if (asked !== props.assetId) return
    // The rows that did not change stay the objects they were, so what is on screen is not rebuilt once a second.
    if (next) setTrace((before) => ({ ...next, steps: keepSame(before?.steps ?? [], next.steps, (step) => step.seq) }))
    if (props.making) return
    const own = await window.studio.getMaking({ projectId: props.projectId, itemId: asked }).catch(() => null)
    if (asked === props.assetId) setOwnMaking(own)
  }
  const readBefore = () => {
    const asked = props.assetId
    void window.studio.getMakingHistory({ projectId: props.projectId, assetId: asked }).then((history) => {
      if (asked !== props.assetId) return
      const last = history.versions.filter((value) => !value.current || making()).at(-1)
      setBefore(last?.document ?? null)
    }, () => undefined)
  }
  // By value: the subject handed down is a new object whenever anything about it moves, and `on` alone would start the page over each time, walked-back step and all.
  const asset = createMemo(() => props.assetId)
  createEffect(
    on(
      asset,
      () => {
        setTrace(null)
        setShown(null)
        setAt(null)
        setPlaying(false)
        setOwnMaking(null)
        setBefore(null)
        copies.clear()
        void read()
        readBefore()
      },
    ),
  )
  // A new version of the same thing: its steps count from 1 again, a step walked back to belongs to the old one, and what the old one had is what stands as ghosts now.
  const versionNow = createMemo(() => trace()?.version)
  createEffect(
    on(
      versionNow,
      (now, was) => {
        if (now === undefined || was === undefined) return
        setAt(null)
        setPlaying(false)
        readBefore()
      },
      { defer: true },
    ),
  )
  const unsubscribe = window.studio.onCommand((command) => {
    if (command === "trace") void read()
  })
  const timer = window.setInterval(() => {
    if (making()) void read()
  }, 1000)
  onCleanup(() => {
    unsubscribe()
    window.clearInterval(timer)
  })
  createEffect(() => {
    const version = trace()?.version
    const copy = copyAt(steps(), at())
    if (!version || !copy || (shown()?.version === version && shown()?.seq === copy.seq)) return
    const key = `${version}:${copy.seq}`
    const known = copies.get(key)
    if (known) return setShown({ version, seq: copy.seq, document: known })
    const asked = props.assetId
    void window.studio.getMakingStep({ projectId: props.projectId, assetId: asked, version, seq: copy.seq }).then((value) => {
      if (asked !== props.assetId) return
      copies.set(key, value)
      if (value && untrack(() => trace()?.version) === version && untrack(() => copyAt(steps(), at())?.seq) === copy.seq) setShown({ version, seq: copy.seq, document: value })
    }, () => undefined)
  })
  // Each thing's own pictures to go by, read again when the list of them changes.
  const referenceIds = createMemo(() => (record()?.references ?? []).map((value) => value.id).join())
  createEffect(
    on(
      referenceIds,
      () => {
        const asked = props.subject.id
        void window.studio.getReferences({ projectId: props.projectId, itemId: asked }).then(
          (list) => asked === props.subject.id && setReferences(list),
          () => asked === props.subject.id && setReferences([]),
        )
      },
    ),
  )
  // 「回放过程」: step by step from the first, then back to the newest.
  createEffect(() => {
    if (!playing()) return
    const walk = window.setInterval(() => {
      const all = untrack(steps)
      const index = all.findIndex((step) => step.seq === untrack(at))
      const next = all[index + 1]
      if (next) return setAt(next.seq)
      setPlaying(false)
      setAt(null)
    }, calm() ? REPLAY_STEP * 2 : REPLAY_STEP)
    onCleanup(() => window.clearInterval(walk))
  })
  const replay = () => {
    if (playing()) {
      setPlaying(false)
      setAt(null)
      return
    }
    setAt(steps()[0]?.seq ?? null)
    setPlaying(true)
  }
  const walkTo = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    const all = steps()
    if (!all.length) return
    const box = event.currentTarget.getBoundingClientRect()
    const place = Math.max(0, Math.min(1, (event.clientX - box.left) / Math.max(1, box.width)))
    const index = Math.round(place * (all.length - 1))
    setPlaying(false)
    setAt(index === all.length - 1 ? null : all[index]!.seq)
  }

  // By name: the same parts again are no reason to turn the view to them again.
  const current = createMemo(() => partsAt(steps(), at()), [], { equals: (left, right) => left.join() === right.join() })
  const past = () => at() !== null
  const backToNewest = () => {
    setPlaying(false)
    setAt(null)
  }
  // What the hand is on, while it is on it: the newest step wrote parts. Looking at the picture or being reviewed is not working on one.
  const writing = () => making() && steps().at(-1)?.kind === "write"
  const hand = createMemo(() => (writing() || at() !== null ? partProgress({ parts: parts(), document: document(), current: current() }) : { name: null, line: null, count: null, left: [] as string[] }))
  const ghosts = createMemo(() => {
    const old = before()
    const now = model()
    if (old?.kind !== "model" || !now || !making()) return null
    const names = missingBones(old.bones, now.bones).map((bone) => bone.name)
    return names.length ? { design: old as ModelDesign & ModuleDocument, names } : null
  })
  const road = createMemo<RoadStop[]>((before) =>
    keepSame(before, roadOf({
      kind: props.subject.kind,
      making: making(),
      version: trace()?.version ?? 0,
      sixView: (record()?.references ?? []).some((value) => value.kind === "three_view"),
      document: document(),
      steps: steps(),
      review: record()?.review ?? null,
    }), (stop) => stop.id),
    [],
  )
  const standing = () => (making() ? presenceLine(props.presence) : null)
  // Walking back, the line says what was said at that step. Gone quiet or gone away, nobody is thinking: it says so, and what to do.
  const thinking = createMemo(() => {
    const step = stepNow()
    if (past() && step) return { label: "这一步", text: step.note ?? (step.parts.length ? `写了：${step.parts.map((part) => partTitle(part, parts())).join("、")}` : step.kind === "look" ? "看了一眼渲染图" : step.kind === "review" ? "做了一次审查" : "写了一版"), at: step.at, state: "" }
    const quiet = standing()
    if (quiet) return { label: "AI", text: `${quiet.text}。${quiet.next}`, at: null, state: quiet.state }
    const line = thinkingLine(trace(), props.subject.events)
    // Thinking is said only while it is being made; afterwards the same words are what it last said.
    return line ? { label: line.own ? (making() ? "AI 在想" : "AI 最后说") : "刚才", text: line.text, at: line.at, state: "" } : null
  })
  const passage = createMemo<PassageRow[]>((before) => keepSame(before, passageRows(props.subject.events, steps(), (part) => partTitle(part, parts()), props.advanced), (row) => row.key), [])
  // What was said of the version before: the person's words when they sent it back, else the review's first finding.
  const lastSaid = () => props.subject.said || (record()?.review && !record()!.review!.passed ? record()!.review!.findings[0] : "") || ""
  const view = () => {
    const value = model()
    const painted = value && bare() ? paintedPreview(value) : null
    return { model: value, preview: painted ? { ...painted, textureDataUrl: grey() } : null }
  }

  return (
    <div class="ml-floor" data-testid="making-live">
      <section class="ml-centre" aria-label={`${props.subject.title}，${making() ? "正在做" : "做过的过程"}`}>
        <header class="ml-head">
          <h2 title={props.subject.title}>{props.subject.title}</h2>
          <Show when={lastSaid()}>
            <small>第 {trace()?.version ?? 1} 版 · 上一版说「{lastSaid()}」</small>
          </Show>
          <button type="button" class="pa-link ml-story-link" onClick={props.onStory}>
            看每一轮的图和说明
          </button>
        </header>
        <div class="pa-road mc-window ml-road" role="list" aria-label="这一样做到哪一步了">
          <For each={road()}>
            {(stop, index) => (
              <>
                <Show when={index() > 0}>
                  <i class="pa-road-link" data-state={stop.state} aria-hidden="true" />
                </Show>
                <span class="pa-stop" role="listitem" data-stop={stop.id} data-state={stop.state} aria-current={stop.state === "now" ? "step" : undefined} aria-label={`${stop.label}：${stop.state === "done" ? "做好了" : stop.state === "now" ? "正在做" : "还没到"}`}>
                  <span class="pa-stop-frame ml-stop-frame" aria-hidden="true">
                    {stop.state === "done" ? "✓" : ""}
                  </span>
                  <span class="pa-stop-words">
                    <strong>{stop.label}</strong>
                  </span>
                </span>
              </>
            )}
          </For>
        </div>
        <div class="ml-stage" data-seq={shown()?.seq ?? 0} data-replaying={past()} data-ghosts={ghosts()?.names.length ?? 0}>
          <Show when={model()} fallback={<ModuleDocumentPreview document={document()} project={props.project} empty={making() ? "AI 交第一份草稿后，这里会马上出现。" : "这一样没有可以显示的内容。"} />}>
            <ModelCanvas view={view()} modes={[]} highlight={current()} ghosts={ghosts()} follow={follow() && !past() ? current() : null} holdCamera={past()} onOwnView={() => setFollow(false)} rawNames={props.advanced} />
          </Show>
          <Show when={model() && paintedPreview(model()!)}>
            <div class="ml-skin" role="group" aria-label="怎么看">
              <button type="button" aria-pressed={!bare()} onClick={() => setBare(false)}>
                带颜色
              </button>
              <button type="button" aria-pressed={bare()} onClick={() => setBare(true)}>
                只看形状
              </button>
            </div>
          </Show>
          <Show when={references().length}>
            <div class="ml-refs" aria-label="参考图">
              <For each={references().slice(0, 6)}>
                {(reference) => (
                  <span class="mc-slot" title={reference.name}>
                    <img src={reference.url} alt={reference.name} draggable={false} />
                  </span>
                )}
              </For>
            </div>
          </Show>
          <div class="ml-tips">
            <Show when={hand().line}>
              <p class="mc-tooltip ml-tip" data-testid="making-part">
                {past() ? hand().line!.replace(/^正在做/, "这一步在做") : hand().line}
              </p>
            </Show>
            <Show when={writing() && !past() && hand().left.length}>
              <p class="mc-tooltip ml-tip ml-tip-next">接下来：{hand().left.slice(0, 3).join("、")}{hand().left.length > 3 ? ` 等 ${hand().left.length} 块` : ""}</p>
            </Show>
          </div>
          {/* The AI goes on while the person looks back: said, with the way back, so what stands here is not taken for where it has got to. */}
          <Show when={past()}>
            <div class="ml-past">
              <span>正在看第 {steps().findIndex((step) => step.seq === at()) + 1} 步，共 {steps().length} 步{making() ? "，AI 还在往下做" : ""}</span>
              <button type="button" class="ml-button" onClick={backToNewest}>
                回到最新
              </button>
            </div>
          </Show>
          <Show when={thinking()}>
            {(line) => (
              <div class="mc-tooltip ml-thinking" role="status" aria-live={playing() ? "off" : "polite"} data-state={line().state}>
                <b>{line().label}</b>
                <span title={line().text}>{line().text}</span>
                <Show when={line().at}>
                  <time>{clock(line().at!)}</time>
                </Show>
              </div>
            )}
          </Show>
        </div>
        <div class="ml-track">
          <button type="button" class="ml-button" disabled={steps().length < 2} title={steps().length < 2 ? "至少写两次才能回放" : undefined} onClick={replay}>
            {playing() ? "停止回放" : "回放过程"}
          </button>
          <button
            type="button"
            class="ml-button"
            aria-pressed={follow() && !past()}
            title={past() ? "回到最新，接着跟 AI 看" : undefined}
            onClick={() => {
              if (past()) {
                backToNewest()
                return setFollow(true)
              }
              setFollow(!follow())
            }}
          >
            跟着 AI 看
          </button>
          <div
            class="ml-ticks"
            role="slider"
            tabindex={0}
            aria-label={`时间轴：写了 ${trace()?.written ?? 0} 次，拖动可以回到任意一步`}
            aria-valuemin={1}
            aria-valuemax={Math.max(1, steps().length)}
            aria-valuenow={Math.max(1, steps().findIndex((step) => step.seq === stepNow()?.seq) + 1)}
            aria-valuetext={steps().length ? `第 ${steps().findIndex((step) => step.seq === stepNow()?.seq) + 1} 步，共 ${steps().length} 步${past() ? "" : "，最新"}` : "还没有写入"}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              walkTo(event)
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) walkTo(event)
            }}
            onKeyDown={(event) => {
              const all = steps()
              const index = all.findIndex((step) => step.seq === stepNow()?.seq)
              const next = event.key === "ArrowLeft" ? all[index - 1] : event.key === "ArrowRight" ? all[index + 1] : event.key === "Home" ? all[0] : event.key === "End" ? all.at(-1) : undefined
              if (!next) return
              event.preventDefault()
              setPlaying(false)
              setAt(next === all.at(-1) ? null : next.seq)
            }}
          >
            <For each={steps()}>{(step) => <i data-kind={step.kind} data-now={step.seq === stepNow()?.seq} title={`${clock(step.at)} ${step.note ?? ""}`} />}</For>
          </div>
          <span class="ml-count" title={`写了 ${trace()?.written ?? 0} 次`}>
            写了 {trace()?.written ?? 0} 次
            <Show when={past()}> · 正在看第 {steps().findIndex((step) => step.seq === at()) + 1} 步</Show>
          </span>
        </div>
      </section>
      <aside class="ml-passage mc-window" aria-label="它的动态">
        <div class="ml-passage-head">
          <strong>它的动态</strong>
          <small>最新在上</small>
        </div>
        <Show when={lastSaid()}>
          <p class="bn-note ml-said">上一版审查：{lastSaid()}</p>
        </Show>
        <ol class="ml-rows">
          <For each={passage()} fallback={<li class="ml-none">还没有记录。</li>}>
            {(row) => (
              <li>
                <time>{clock(row.at)}</time>
                <span class="ml-row-words">
                  <em data-colour={TAG_COLOUR[row.tag]}>{row.tag}</em>
                  {row.text}
                </span>
              </li>
            )}
          </For>
        </ol>
      </aside>
    </div>
  )
}
