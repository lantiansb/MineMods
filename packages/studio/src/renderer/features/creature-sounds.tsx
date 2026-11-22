import { thingName } from "../words"
import {focusSound,soundDestination} from "./sound-focus"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { soundMoments, soundUsers, type SoundMomentRow } from "@minemods/mod-core/sound-moments"
import type { Project } from "@minemods/mod-core/project"
import { Fold } from "../fold"
import { AudioImport } from "./audio-editor"
import { NewAudioDialog } from "./new-audio-dialog"
import { ABILITY_SOUNDS } from "@minemods/mod-core/ability-words"
import { CREATURE_SOUNDS } from "@minemods/mod-core/data-words"
import { creatureSoundIssues, soundLookup } from "@minemods/mod-core/sound"
import type { StudioView } from "../../api"

export function SoundUsers(props: { project: Project; id: string; go?: (id: string) => void }) {
  const users = createMemo(() => soundUsers(props.project, props.id))
  return (
    <section aria-label="谁在用它">
      <h3>谁在用它</h3>
      <Show when={users().length} fallback={<p>还没有谁在用。</p>}>
        <For each={users()}>
          {(u) => (
            <p>
              {thingName(props.project.workspace.assets.find(a => u.entity ? a.document.kind === "entity" && a.document.model_asset_id === u.entity : a.id === u.owner)) ?? u.title} · {u.where}{" "}
              <button
                onClick={() => {
                  if(u.entity)focusSound({entity:u.entity,key:u.key,edit:false})
                  props.go?.(
                    u.entity
                      ? (props.project.workspace.assets.find((a) => a.document.kind === "entity" && a.document.model_asset_id === u.entity)?.id ??
                          u.owner)
                      : u.owner,
                  )
                }}
              >
                去看
              </button>
            </p>
          )}
        </For>
      </Show>
    </section>
  )
}
export function CreatureSounds(props: { project: Project; entityId: string; disabled?: boolean; saved: (view: StudioView) => void }) {
  const rows = createMemo(() => soundMoments(props.project, props.entityId))
  const sounds = () => props.project.workspace.assets.filter((a) => a.module === "sound")
  const [addingMusic, setAddingMusic] = createSignal(false)
  const [native, setNative] = createSignal("")
  const [changing, change] = createSignal(""),
    [error, say] = createSignal(""),
    [silent, mark] = createSignal<string[]>([]),
    [selected, select] = createSignal("")
  const [active, playing] = createSignal(""),
    [clock, tick] = createSignal(0)
  let audio: HTMLAudioElement | undefined,
    request = 0
  const stop = () => {
    request++
    audio?.pause()
    audio = undefined
    playing("")
  }
  window.addEventListener("studio-audition", stop)
  onCleanup(() => { stop(); window.removeEventListener("studio-audition", stop) })
  async function play(row: SoundMomentRow) {
    window.dispatchEvent(new Event("studio-audition"))
    const token = request
    say("")
    try {
      const ref = row.ref
      const doc = typeof ref === "object" && ref ? props.project.workspace.assets.find((a) => a.id === ref.asset)?.document : null
      const src =
        typeof ref === "string"
          ? await window.studio.vanillaAudio({ projectId: props.project.id, event: ref })
          : doc?.kind === "sound"
            ? doc.files[0]?.data
            : null
      if (token !== request) return
      if (!src) {
        mark([...silent(), row.key])
        return
      }
      const player = new Audio(src)
      audio = player
      playing(row.key)
      tick(0)
      player.ontimeupdate = () => tick(player.currentTime)
      player.onended = stop
      await player.play()
    } catch (e) {
      say(String(e))
      stop()
    }
  }
  const [filter, setFilter] = createSignal(""),
    [newFile, setNewFile] = createSignal(false)
  const creature = () => props.project.entities.find((e) => e.id === props.entityId)
  const ability = (row: SoundMomentRow) => row.path[0] === "abilities"
    ? `local:${row.path[1]}`
    : props.project.workspace.assets.find((asset) => asset.id === row.owner)?.document.kind === "ability"
      ? row.owner
      : ""
  const showMoment = (row: SoundMomentRow) =>
    row.path[0] === "boss" || (row.path[0] === "builtin" && ["leave", "return", "death_burst", "arena_light", "fog_lift"].includes(String(row.path[1])))
  const daily = () => rows().filter((row) => !ability(row) && !showMoment(row))
  const showRows = () => rows().filter(showMoment)
  const abilities = createMemo(() => {
    const result = new Map<string, SoundMomentRow[]>()
    for (const row of rows()) {
      const key = ability(row)
      if (key) result.set(key, [...(result.get(key) ?? []), row])
    }
    return result
  })
  const moveName = (row: SoundMomentRow) => row.where.match(/^(?:招式|技能)「(.+?)」/)?.[1] ?? "招式"
  const momentName = (row: SoundMomentRow) => ability(row) ? row.where.replace(/^(?:招式|技能)「.+?」/, "").trim() : row.where
  const [folded, setFolded] = createSignal<Record<string, boolean>>({})
  const toggle = (id: string, open: boolean) => setFolded((before) => ({ ...before, [id]: !open }))
  const opened = (id: string) => !folded()[id]
  const editMoment = (row: SoundMomentRow) => {
    change(row.key)
    const ref = row.ref
    select(ref && typeof ref === "object" && sounds().some((asset) => asset.id === ref.asset) ? ref.asset : "")
    setFilter("")
    setNative("")
    setNewFile(false)
  }
  const issues = () => {
    const e = creature()
    return e ? creatureSoundIssues(e, soundLookup(props.project)) : []
  }
  createEffect(()=>{
    const target=soundDestination()
    if(target?.entity!==props.entityId || (target.key!=="boss.music" && !rows().some(r=>r.key===target.key)))return
    const row = rows().find((moment) => moment.key === target.key)
    if (target.edit && row) editMoment(row)
    const move = row ? ability(row) : ""
    toggle("all", true)
    if (move) {
      toggle("abilities", true)
      toggle(move, true)
    } else {
      toggle(!row ? "music" : showMoment(row) ? "show" : "daily", true)
    }
    requestAnimationFrame(()=>{
      const node=document.querySelector<HTMLElement>('[data-sound-moment="'+CSS.escape(target.key)+'"]')
      if(node){node.scrollIntoView({block:"center"});node.focus({preventScroll:true})}
    })
    focusSound(null)
  })
  const nativeOnly = (row: SoundMomentRow) => row.path.at(-1) === "weakpoint_sound" || row.path.join("/") === "boss/intro/sound"
  const catalog = (row: SoundMomentRow) =>
    row.path.at(-1) === "weakpoint_sound"
      ? { "entity.player.attack.crit": "暴击声", "block.anvil.land": "金属重响" }
      : row.path[0] === "sounds" && row.path.length === 2 && ["ambient", "hurt", "death", "step"].includes(String(row.path[1]))
        ? CREATURE_SOUNDS
        : ABILITY_SOUNDS
  const nativeEvents = createMemo(() => [...new Set([...rows().flatMap(r => typeof r.ref === "string" ? [r.ref] : []), ...native() ? [native()] : []])])
  const [available] = createResource(
    nativeEvents,
    async (ids) =>
      new Set(
        (
          await Promise.all(
            ids.map(async (event) =>
              (await window.studio.vanillaAudio({ projectId: props.project.id, event, probe: true }).catch(() => null)) ? event : "",
            ),
          )
        ).filter(Boolean),
      ),
  )
  const apply = async (row: SoundMomentRow, soundId?: string, vanilla?: string, revision = props.project.revision) => {
    try {
      const next = await window.studio.changeSoundMoment({
        projectId: props.project.id,
        expectedRevision: revision,
        entityId: props.entityId,
        key: row.key,
        soundId,
        vanilla,
      })
      change("")
      setNewFile(false)
      say("")
      props.saved(next)
    } catch (e) {
      say(String(e))
    }
  }
  const canPlay = (row: SoundMomentRow) => {
    if (!row.ref || silent().includes(row.key)) return false
    if (typeof row.ref === "string") return available()?.has(row.ref) === true
    const ref = row.ref
    return sounds().some((asset) => asset.id === ref.asset && asset.document.kind === "sound" && asset.document.files.length > 0)
  }
  const soundRow = (r: SoundMomentRow) => (
          <div class="resource-item" data-sound-moment={r.key} tabindex={-1}>
            <strong>{momentName(r)}</strong> <span>{r.ref ? r.source + "：" + (typeof r.ref === "object" ? thingName(props.project.workspace.assets.find(a => a.id === (r.ref as { asset: string }).asset)) ?? r.name : r.name) : r.name}</span>
            <Show when={r.reach}><small>能传多远：{r.reach}</small></Show><Show when={r.detail}><small>{r.detail}</small></Show>
            <Show when={r.ref}>
              <button disabled={!canPlay(r)} onClick={() => void play(r)}>试听</button>
            </Show>
            <Show when={silent().includes(r.key) || (typeof r.ref === "string" && !available.loading && !available()?.has(r.ref))}>
              {" "}
              本机还没有这份游戏声音文件。
            </Show>
            <Show when={active() === r.key}>
              {" "}
              正在放 {clock().toFixed(1)} 秒 <button onClick={stop}>停止</button>
            </Show>
            <button
              disabled={!r.editable || props.disabled}
              onClick={() => editMoment(r)}
            >
              换
            </button>
            <Show when={changing() === r.key}>
              <div class="panel new-asset-form">
                <div class="page-actions"><button onClick={() => void apply(r)}>{r.path[0]==="builtin"?"换回 Studio 自带的":"不设声音"}</button>
                <Show when={r.path[0]==="builtin"}><button onClick={()=>void apply(r,undefined,"none")}>不响</button></Show></div>
                <Show when={!nativeOnly(r)} fallback={<p>这里只能选原版声音。</p>}>
                  <label class="field">
                    工程里的声音
                    <select value={selected()} onChange={(e) => select(e.currentTarget.value)}>
                      <option value="" selected={!selected()}>选择一个声音</option>
                      <For each={sounds()}>{(a) => <option value={a.id} selected={a.id === selected()}>{thingName(a)}</option>}</For>
                    </select>
                  </label>
                  <div class="page-actions"><button disabled={!selected()} onClick={() => void apply(r, selected())}>
                    用这个声音
                  </button>
                  <button onClick={() => setNewFile(!newFile())}>放一个新文件</button></div>
                  <Show when={newFile()}>
                    <AudioImport
                      project={props.project}
                      kind="sound"
                      saved={(v, id) => {
                        props.saved(v)
                        void apply(r, id, undefined, v.project.revision)
                      }}
                    />
                  </Show>
                </Show>
                <label class="field">
                  搜索原版声音
                  <input value={filter()} onInput={(event) => { setFilter(event.currentTarget.value); setNative("") }} />
                </label>
                <label class="field">
                  原版声音
                  <select value={native()} onChange={event => { stop(); setNative(event.currentTarget.value) }}>
                    <option value="">选一个原版声音</option>
                    <For each={Object.entries(catalog(r)).filter(([id, name]) => (name + id).includes(filter()))}>
                      {([id, name]) => <option value={id}>{name}</option>}
                    </For>
                  </select>
                </label>
                <div class="page-actions">
                  <Show when={active() === r.key + "/native"} fallback={
                    <button disabled={!native() || !available()?.has(native())} onClick={() => void play({ ...r, key: r.key + "/native", ref: native() })}>
                      试听原版
                    </button>
                  }><button onClick={stop}>停止试听</button></Show>
                  <button disabled={!native()} onClick={() => void apply(r, undefined, native())}>用这个原版声音</button>
                </div>
                <Show when={native() && !available.loading && !available()?.has(native())}>
                  <p>本机还没有这份游戏声音文件。</p>
                </Show>
              </div>
            </Show>
          </div>
  )
  const interval = () => props.project.entities.find((e) => e.id === props.entityId)?.sounds?.step_interval
  return (
    <Fold class="panel creature-sounds" summary="它的声音" open={opened("all")} onToggle={(open) => toggle("all", open)}>
      <For each={issues()}>{(issue) => <p>{issue.text}</p>}</For>
      <Show when={creature()?.boss}>
        <Fold class="sound-group" summary="背景音乐" open={opened("music")} onToggle={(open) => toggle("music", open)}>
        <label class="resource-item creature-music-note" data-sound-moment="boss.music" tabindex={-1}>
          战斗时的曲子
          <select aria-label="背景音乐" disabled={props.disabled} value={creature()?.boss?.music?.asset ?? ""}
            onChange={async e => {
              const asset = e.currentTarget.value
              try {
                props.saved(await window.studio.changeSoundMoment({ projectId: props.project.id, expectedRevision: props.project.revision,
                  entityId: props.entityId, key: "boss.music", soundId: asset || undefined }))
                say("")
              } catch (err) { say(String(err)) }
            }}>
            <option value="">不设音乐</option>
            <For each={props.project.workspace.assets.filter(a => a.module === "music")}>{a => <option value={a.id}>{a.title}</option>}</For>
          </select>
        </label>
        <button type="button" disabled={props.disabled} onClick={() => setAddingMusic(true)}>添加曲子</button>
        <Show when={addingMusic()}>
          <NewAudioDialog project={props.project} kind="music" disabled={props.disabled} close={() => setAddingMusic(false)}
            saved={view => { setAddingMusic(false); props.saved(view) }} />
        </Show>
        </Fold>
      </Show>
      <Show when={daily().length}>
        <Fold class="sound-group" summary={<>平时 <small>{daily().length} 处</small></>}
          open={opened("daily")} onToggle={(open) => toggle("daily", open)}>
          <p>走路时{interval() === undefined ? "按移动距离发声" : interval() === 0 ? "按体型自动决定间隔" : "至少间隔 " + interval() + " 秒"}。</p>
          <For each={daily()}>{soundRow}</For>
        </Fold>
      </Show>
      <Show when={abilities().size}>
        <Fold class="sound-group" summary={<>每一招 <small>{abilities().size} 招</small></>}
          open={opened("abilities")} onToggle={(open) => toggle("abilities", open)}>
          <For each={[...abilities().keys()]}>{(key) => {
            const moments = () => abilities().get(key) ?? []
            return <Fold class="sound-group" summary={<>{moveName(moments()[0]!)} <small>{moments().length} 处</small></>}
              open={opened(key)} onToggle={(open) => toggle(key, open)}>
              <For each={moments()}>{soundRow}</For>
            </Fold>
          }}</For>
        </Fold>
      </Show>
      <Show when={showRows().length}>
        <Fold class="sound-group" summary="演出和阶段" open={opened("show")} onToggle={(open) => toggle("show", open)}>
          <For each={showRows()}>{soundRow}</For>
        </Fold>
      </Show>
      <p role="status">{error()}</p>
    </Fold>
  )
}
