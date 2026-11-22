import { For, Show, createMemo, createEffect, createSignal, onCleanup } from "solid-js"
import type { StudioView } from "../../api"
import { layeredModelPreview } from "../model-paint-preview"
import { ModelCanvas } from "./model-canvas"
import { CreatureSounds } from "./creature-sounds"
import { advanced } from "../advanced"
import { Fold } from "../fold"
import { CreatureCombos, CreatureMoves } from "./creature-moves"
import { CreatureArena, CreatureCombat, CreaturePhases } from "./creature-phases"
import { CreatureStances } from "./creature-stances"
import { bossLookPlan, stageHidden } from "@minemods/mod-core/boss-look-words"
import { currentStance } from "@minemods/mod-core/stances"
import { CreatureShows } from "./creature-shows"
import type { CreatureInside, InsideTab } from "./creature-inside-model"
import type { SoundRef } from "@minemods/mod-core/sound"
import { emitterWhen, particleLabel } from "@minemods/mod-core/particle-emission"
import { resolveSteady } from "@minemods/mod-core/creature-steady"
import { CombatHandPanel } from "./combat-hand"
import type { CombatEdit } from "./combat-hand-fields"
import "./creature-inside.css"

export type InsideActions = {
  data: CreatureInside
  phase: number
  stance?: string
  selectStance: (id: string) => void
  selectPhase: (i: number) => void
  previewPhase: (i: number) => void
  selectMove: (id: string) => void
  play: (clip: string, title?: string) => void
  listen: (sound: SoundRef) => Promise<void>
  go: (id: string) => void
  ask: (text: string) => void
  busy: boolean
  canAsk: boolean
  saved: (v: StudioView) => void
  edit: (scope: CombatEdit) => void
}
export function CreaturePicture(props: {
  data: CreatureInside
  part: "move" | "phases" | "show" | "arena"
  value?: string
  label: string
  busy: boolean
}) {
  const [result, setResult] = createSignal<Awaited<ReturnType<typeof window.studio.getCreatureLook>>>()
  const [pending, setPending] = createSignal(false)
  let generation = 0
  createEffect(() => {
    void props.value
    void props.data.project.revision
    generation++
    setResult(undefined)
    setPending(false)
  })
  onCleanup(() => {
    generation++
  })
  const load = async () => {
    const started = generation
    setPending(true)
    try {
      const m = props.data
      const asset = m.project.workspace.assets.find(
        (a) => a.document.kind === "entity" && a.document.model_asset_id === m.doc.model_asset_id,
      )
      if (asset) {
        const result = await window.studio.getCreatureLook({
          projectId: m.project.id,
          expectedRevision: m.project.revision,
          assetId: asset.id,
          part: props.part,
          key: props.value,
        })
        if (started === generation) setResult(result)
      }
    } catch (e) {
      if (started === generation) setResult({ pictures: [], note: String(e) })
    } finally {
      if (started === generation) setPending(false)
    }
  }
  return (
    <div class="creature-picture">
      <button
        disabled={props.busy || pending()}
        onClick={() => (result()?.pictures.length ? setResult(undefined) : void load())}
      >
        {pending() ? "正在画…" : result()?.pictures.length ? "收起图片" : props.label}
      </button>
      <Show when={props.busy}>
        <small>AI 正在制作，等它做完再看图。</small>
      </Show>
      <Show when={result()?.note}>
        <p role="status">{result()?.note}</p>
      </Show>
      <For each={result()?.pictures}>
        {(p) => (
          <figure>
            <img src={p.url} alt={p.label} />
            <figcaption>{p.label}</figcaption>
          </figure>
        )}
      </For>
    </div>
  )
}
type Section = {
  tab: InsideTab | "behavior"
  count: (data: CreatureInside) => number
  render: (actions: InsideActions) => import("solid-js").JSX.Element
}
const hasCombat = (m: CreatureInside) => Boolean(m.doc.guard || m.doc.stagger || m.moves.some(move => move.openings?.length || move.interrupt || move.breaks?.length))
const sections: Section[] = [
  { tab: "moves", count: (m) => m.moves.length, render: (a) => <CreatureMoves {...a} /> },
  { tab: "moves", count: (m) => m.combos.length, render: (a) => <CreatureCombos {...a} /> },
  { tab: "stances", count: (m) => m.doc.stances?.list.length ?? 0, render: (a) => <CreatureStances {...a} /> },
  { tab: "phases", count: (m) => m.phases.length, render: (a) => <CreaturePhases {...a} /> },
  {
    tab: "phases",
    count: (m) => m.boss?.arena?.fixtures.length || Number(!!m.boss?.arena?.fog),
    render: (a) => <CreatureArena {...a} />,
  },
  {
    tab: "phases",
    count: (m) => Number(hasCombat(m)),
    render: (a) => <CreatureCombat {...a} />,
  },
  {
    tab: "behavior",
    count: (m) => Number(!!m.doc.steady),
    render: (a) => {
      const plan = resolveSteady(a.data.doc.steady, a.data.doc.hitbox?.core.height ?? 0)
      return (
        plan && (
          <article class="inside-card">
            <h3>让它稳重</h3>
            <p>
              {plan.label} · 身体每秒最多转 {plan.body_turn}°，头每秒最多转 {plan.head.turn}°，蓄力时身体每秒最多转{" "}
              {plan.ability_turn}°。
            </p>
          </article>
        )
      )
    },
  },
  {
    tab: "behavior",
    count: (m) => Object.keys(m.doc.particles ?? {}).length,
    render: (a) => (
      <article class="inside-card">
        <h3>粒子别名</h3>
        <For each={Object.keys(a.data.doc.particles ?? {})}>
          {(alias) => <p>{particleLabel({ alias }, a.data.names)}</p>}
        </For>
      </article>
    ),
  },
  {
    tab: "behavior",
    count: (m) => m.doc.emitters?.length ?? 0,
    render: (a) => (
      <article class="inside-card">
        <h3>持续发射</h3>
        <For each={a.data.doc.emitters}>
          {(e) => (
            <p>
              {emitterWhen(e.when, (id) => a.data.actions.find((move) => move.id === id)?.name ?? "指定招式")}从
              {e.bone ? a.data.names.bone(e.bone) : "脚下"}每 {e.every_ticks} 刻冒 {e.count} 颗
              {particleLabel(e.particle, a.data.names)}。
            </p>
          )}
        </For>
      </article>
    ),
  },
  {
    tab: "behavior",
    count: (m) => Number(!m.boss && hasCombat(m)),
    render: (a) => <CreatureCombat {...a} />,
  },
  {
    tab: "sounds",
    count: () => 1,
    render: (a) => (
      <CreatureSounds project={a.data.project} entityId={a.data.doc.model_asset_id} disabled={a.busy} saved={a.saved} />
    ),
  },
  { tab: "shows", count: (m) => m.shows.length, render: (a) => <CreatureShows {...a} /> },
]
export function CreatureInsidePage(props: {
  data: CreatureInside
  tab: InsideTab | "behavior"
  select: (tab: InsideTab) => void
  view: StudioView
  busy: boolean
  canAsk: boolean
  saved: (v: StudioView) => void
  go: (id: string) => void
  ask: (s: string) => void
}) {
  const [opened, setOpened] = createSignal<InsideTab[]>([])
  createEffect(() => {
    const tab = props.tab
    if (tab !== "behavior") setOpened(previous => previous.includes(tab) ? previous : [...previous, tab])
  })
  const modelTabs = createMemo(() => opened().filter(tab => tab !== "sounds"))
  const [phase, setPhase] = createSignal(0)
  const [stance, setStance] = createSignal<string>()
  const previewStance = createMemo(() => props.data.doc.stances ? currentStance(props.data.doc.stances, stance()) : undefined)
  const looks = createMemo(() => bossLookPlan(props.data.boss ?? { phases: [] }, props.data.boss ? props.data.moves : [], props.data.doc.stances))
  const hidden = createMemo(() => {
    const plan = looks(), selected = previewStance()
    if (!plan || !selected || props.tab !== "stances") return []
    const index = props.data.doc.stances!.list.indexOf(selected)
    return [...stageHidden(plan, phase(), index), ...plan.phaseDrops.slice(0, phase()).flatMap(drops => drops.map(drop => drop.name))]
  })
  const [combatEdit, setCombatEdit] = createSignal<CombatEdit>()
  const [motion, setMotion] = createSignal({ clip: "", title: "", n: 0 })
  const [audioNote, setAudioNote] = createSignal("")
  let audio: HTMLAudioElement | undefined,
    token = 0
  onCleanup(() => {
    token++
    audio?.pause()
  })
  const play = (clip: string, title = props.data.motion(clip)) => setMotion({ clip, title, n: motion().n + 1 })
  const listen = async (sound: SoundRef) => {
    const seq = ++token
    audio?.pause()
    const m = props.data
    const asset =
      typeof sound === "object" ? m.project.workspace.assets.find((a) => a.id === sound.asset)?.document : null
    const url =
      typeof sound === "string"
        ? await window.studio.vanillaAudio({ projectId: m.project.id, event: sound }).catch(() => null)
        : asset?.kind === "sound"
          ? asset.files[0]?.data
          : null
    if (seq !== token) return
    if (!url) {
      setAudioNote("本机暂时没有这段声音。")
      return
    }
    audio = new Audio(url)
    audio.onended = () => setAudioNote("")
    await audio.play().then(
      () => setAudioNote("正在试听"),
      () => setAudioNote("这段声音暂时不能播放。"),
    )
  }
  const actions: InsideActions = {
    get data() {
      return props.data
    },
    get stance() { return previewStance()?.id },
    selectStance: setStance,
    previewPhase: setPhase,
    get phase() {
      return phase()
    },
    get busy() {
      return props.busy
    },
    get canAsk() {
      return props.canAsk
    },
    saved: (v) => props.saved(v),
    edit: (scope) => {
      setCombatEdit(scope)
      requestAnimationFrame(() => document.querySelector(".combat-hand")?.scrollIntoView({ block: "start" }))
    },
    selectPhase: (i) => {
      setPhase(i)
      props.select("phases")
    },
    selectMove: (id) => {
      props.select("moves")
      requestAnimationFrame(() => document.getElementById("creature-move-" + id)?.scrollIntoView({ block: "nearest" }))
    },
    play,
    listen,
    go: (id) => props.go(id),
    ask: (s) => props.ask(s),
  }
  const preview = createMemo(() => {
    const original = props.view.entity_id === props.data.doc.model_asset_id ? props.view : { model: props.data.model, preview: null }
    const plan = looks(), selected = previewStance(), model = original.model
    if (!plan || !selected || !model || props.tab !== "stances") return original
    const stage = Math.min(phase(), plan.texture.length - 1)
    const overlay = plan.stances?.[props.data.doc.stances!.list.indexOf(selected)]
    const texture = (id: string | undefined) => {
      const document = props.data.project.workspace.assets.find(asset => asset.id === id)?.document
      if (document?.kind !== "texture" || document.width !== document.height) return null
      const pixels = new Uint8Array(document.pixels.length * 4)
      document.pixels.forEach((index, offset) => {
        const rgb = Number.parseInt(document.palette[index]!.slice(1), 16)
        pixels.set([rgb >> 16, rgb >> 8 & 255, rgb & 255, 255], offset * 4)
      })
      return { size: document.width, pixels }
    }
    const picture = overlay && overlay.texture >= 0 ? overlay.texture : plan.texture[stage]!
    const base = texture(plan.textures[picture - 1] ?? (picture === 0 ? props.data.doc.runtime.texture_asset_id ?? undefined : undefined))
    const glows = plan.slots.flatMap((slot, index) => {
      const mask = slot === "emissive" ? slot : texture(slot.asset)
      const level = overlay?.glow?.slot === index ? overlay.glow.to : plan.glow[stage]?.[index]?.to ?? 0
      return mask && level > 0 ? [{ picture: mask, level }] : []
    })
    const drawn = layeredModelPreview(model, base, glows)
    return drawn ? { ...original, preview: { ...original.preview, ...drawn } } : original
  })
  const contents = (tab: InsideTab | "behavior") => (
    <For each={sections.filter(section => section.tab === tab && section.count(props.data) > 0)}>
      {section => section.render(actions)}
    </For>
  )
  return (
    <Show when={props.tab !== "behavior"} fallback={
      <Show when={sections.some(section => section.tab === "behavior" && section.count(props.data) > 0)}>
        <Fold class="behavior-details" summary="行为细节">{contents("behavior")}</Fold>
      </Show>
    }>
      <section class="creature-inside">
        <header>
          <h1>{props.data.name}</h1>
        </header>
        <Show when={opened().includes("sounds")}>
          <div hidden={props.tab !== "sounds"}>{contents("sounds")}</div>
        </Show>
        <Show when={modelTabs().length}>
          <div class="inside-columns" style={{display:props.tab==="sounds" ? "none" : undefined}}>
            <aside class="inside-stage">
              <ModelCanvas
                view={preview()}
                mode="animation"
                modes={[]}
                hideMotionPicker visible={props.tab!=="sounds"}
                hiddenBones={props.data.doc.stances ? hidden() : undefined}
                animation={props.tab === "stances" ? previewStance()?.clips?.idle ?? "idle" : motion().clip}
                playRequest={motion().n}
                motionName={props.data.motion}
                rawNames={advanced()}
              />
              <Show when={motion().clip}>
                <p role="status">正在放：{motion().title}</p>
              </Show>
              <Show when={audioNote()}>
                <p role="status">{audioNote()}</p>
              </Show>
            </aside>
            <div class="inside-detail">
              <CombatHandPanel data={props.data} edit={combatEdit()?.tab === props.tab ? combatEdit() : undefined}
                close={() => setCombatEdit(undefined)} busy={props.busy} saved={props.saved} go={ref => {
                  if (ref.kind === "asset") props.go(String(ref.id))
                  if (ref.kind === "ability" || ref.kind === "combo") actions.selectMove(String(ref.id))
                  if (ref.kind === "phase") actions.selectPhase(Number(ref.id) - 1)
                }} />
              <For each={modelTabs()}>{tab => <div hidden={props.tab !== tab}>{contents(tab)}</div>}</For>
            </div>
          </div>
        </Show>
      </section>
    </Show>
  )
}
