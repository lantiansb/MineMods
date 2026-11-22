import { abilityUsers } from "@minemods/mod-core/ability-usage"
import { BeamSweepFields } from "./beam-sweep-fields"
import { SoundRangeFields } from "./sound-range-fields"
import { ReturnPlaceFields } from "./return-place-fields"
import { LandingFields } from "./landing-fields"
import { OnceGroupFields } from "./once-group-fields"
import { RingWarnFields } from "./ring-warn-fields"
import type { Ability } from "@minemods/mod-core/entity-runtime"
import { FixtureFields } from "./fixture-fields"
import type { ArenaFixture } from "@minemods/mod-core/arena"
import type { ParticleAliases } from "@minemods/mod-core/particle-emission"
import { thingName as workspaceName } from "../words"
import { For, Index, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import type { Project } from "@minemods/mod-core/project"
import type { WorkspaceAsset } from "@minemods/mod-core/workspace"
import { contentWords } from "@minemods/mod-core/content-words"
import type { StudioView } from "../../api"
import type { HandIssue, HandKind } from "../../main/content-service"
import { fieldSelector } from "../../finding-targets"
import { BuiltinEditor } from "./builtin-editor"
import { StaggerEditor } from "./stagger-editor"
import { ItemIcon } from "./item-icon"
import { changedLabels, check, formOf, plainIssue, same, setAt, tickWords, type FormField } from "./asset-edit-form"
import { catalog, fromValue, gridOf, offered, search, thingName, toValue, typedThing, withSlot, type Thing, type ThingMode } from "./asset-edit-recipe"
import { handWired, saveHand, savedDocument, type HandApi } from "./asset-edit-save"
import { followStored, STALE_EDIT } from "@minemods/mod-core/stale-edit"
import { StaleNotice } from "./stale-edit"
import { importPicture } from "./asset-edit-texture"
import { adopt, memoryOf, switchedOn, type SwitchMemory } from "./asset-edit-memory"
import { HAND_KEPT_WORDS, at, settle, type Loose } from "./asset-edit-words"
import "./asset-edit.css"
import { Fold } from "../fold"
import { BookPages } from "./book-pages"
import type { BookDocument } from "@minemods/mod-core/book"

/** Said beside the buttons, so what is on screen is never mistaken for what is saved. */
export const EDIT_STATE = { dirty: "改过了，还没保存", fresh: "新的，还没保存", clean: "和保存的一样", saving: "正在保存…", saved: "保存好了" } as const
// A choice of this many or fewer is laid out as buttons, all in sight at once; a longer one is a drop-down list.
const BUTTON_CHOICES = 4
// A choice of many (the 64 biomes) is folded away and searched instead of filling the page.
const FOLDED_CHOICES = 16

type Context = {
  kind: HandKind
  project: () => Project
  things: () => Thing[]
  draft: () => Loose
  /** The asset being edited; null before it is first saved. */
  id: () => string | null
  edit: (key: string, value: unknown) => void
  replace: (document: Loose) => void
  /** What a switch held when it was turned off, so turning it on gives that back (see `asset-edit-memory.ts`). */
  memory: SwitchMemory
  disabled: () => boolean
  advanced: () => boolean
  bad: (key: string) => string
}

/** The search-and-pick list for one field or one slot: this mod's things, the game's items by Chinese name, groups of items. */
function ThingList(props: { context: Context; mode: ThingMode; except?: string; value: string | null; clear: string | null; onPick: (value: string | null) => void }) {
  const [query, setQuery] = createSignal("")
  const [typed, setTyped] = createSignal("")
  const [wrong, setWrong] = createSignal("")
  const modId = () => props.context.project().mod_id
  const list = createMemo(() => offered(props.context.things(), props.mode, { advanced: props.context.advanced(), except: props.except, modId: modId() }))
  const found = createMemo(() => search(list(), query()))
  const enter = () => {
    const read = typedThing(typed(), list(), props.mode, modId())
    if ("error" in read) return setWrong(read.error)
    setWrong("")
    setTyped("")
    props.onPick(read.value)
  }
  return (
    <div class="ae-things mc-well">
      <input type="search" class="ae-things-search" placeholder="搜名字，例如 铁锭、木板" aria-label="搜索物品" value={query()} disabled={props.context.disabled()} onInput={(event) => setQuery(event.currentTarget.value)} />
      <div class="ae-things-list" role="listbox" aria-label="可以选的东西">
        <Show when={props.clear !== null && props.value}>
          <button type="button" class="ae-thing ae-thing-clear" disabled={props.context.disabled()} onClick={() => props.onPick(null)}>
            {props.clear}
          </button>
        </Show>
        <For each={found()}>
          {(thing) => (
            <button type="button" class="ae-thing" role="option" aria-selected={fromValue(props.mode, modId(), props.value ?? "") === thing.id} disabled={props.context.disabled()} onClick={() => props.onPick(toValue(props.mode, modId(), thing.id))}>
              <span class="ae-thing-icon mc-slot">
                <ItemIcon id={thing.id} color={thing.color} texture={thing.texture} />
              </span>
              <span>
                {thing.name}
                <Show when={thing.from === "own"}>
                  <small>这个模组的</small>
                </Show>
                <Show when={props.context.advanced()}>
                  <small>{thing.id}</small>
                </Show>
              </span>
            </button>
          )}
        </For>
        <Show when={!found().length}>
          <p class="ae-things-none">没有找到叫这个名字的东西。换个说法试试。</p>
        </Show>
      </div>
      <Show when={props.context.advanced()}>
        <div class="ae-things-typed">
          <input type="text" placeholder="直接填 ID（高级），例如 minecraft:stone" aria-label="直接填物品 ID" value={typed()} disabled={props.context.disabled()} onInput={(event) => setTyped(event.currentTarget.value)} onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), enter())} />
          <button type="button" class="studio-button" disabled={props.context.disabled() || !typed().trim()} onClick={enter}>
            填进去
          </button>
        </div>
        <Show when={wrong()}>
          <p class="ae-bad" role="alert">
            {wrong()}
          </p>
        </Show>
      </Show>
    </div>
  )
}

/** One named thing shown the way a slot shows it. */
function ThingFace(props: { context: Context; mode: ThingMode; value: string | null | undefined; empty: string }) {
  const id = () => fromValue(props.mode, props.context.project().mod_id, props.value ?? "")
  const thing = () => props.context.things().find((candidate) => candidate.id === id())
  return (
    <>
      <span class="ae-thing-icon mc-slot">
        <Show when={props.value}>
          <ItemIcon id={id()} color={thing()?.color} texture={thing()?.texture} />
        </Show>
      </span>
      <span>{thingName(props.context.things(), props.mode, props.context.project().mod_id, props.value, props.context.advanced()) || props.empty}</span>
    </>
  )
}

/** A recipe's materials as the slots of its station; a slot is picked, then filled from the list beside it. */
function RecipeGrid(props: { context: Context }) {
  const [slot, setSlot] = createSignal(0)
  const grid = createMemo(() => gridOf(props.context.draft()))
  createEffect(() => slot() >= grid().slots.length && setSlot(0))
  const modId = () => props.context.project().mod_id
  const said = (reference: string) => thingName(props.context.things(), "ingredient", modId(), reference, false)
  const sentence = () => {
    const document = props.context.draft() as unknown as Parameters<typeof contentWords.recipe>[0]
    const { labels, slots } = grid()
    const complete = document.result && (labels.length ? slots.every(Boolean) : slots.some(Boolean)) && Number.isInteger(document.count)
    return complete ? `${contentWords.recipe(document, said)}。` : ""
  }
  return (
    <div class="ae-grid">
      <div class="ae-grid-slots" style={{ "--columns": grid().columns }} role="group" aria-label="材料格子">
        <Index each={grid().slots}>
          {(value, index) => (
            <button type="button" class="ae-slot mc-slot" classList={{ on: slot() === index }} aria-pressed={slot() === index} title={value() ? said(value()!) : "空格子"} disabled={props.context.disabled()} onClick={() => setSlot(index)}>
              <Show when={value()}>
                <ItemIcon id={value()!} color={props.context.things().find((thing) => thing.id === value())?.color} texture={props.context.things().find((thing) => thing.id === value())?.texture} />
                <small>{said(value()!)}</small>
              </Show>
              <Show when={grid().labels[index]}>
                <em>{grid().labels[index]}</em>
              </Show>
            </button>
          )}
        </Index>
      </div>
      <div class="ae-grid-pick">
        <p class="ae-help">
          {grid().labels[slot()] ? `正在选「${grid().labels[slot()]}」。` : `正在选第 ${slot() + 1} 格。`}
          {grid().ordered ? "" : "这种配方不看位置，放在哪一格都一样。"}
        </p>
        <ThingList context={props.context} mode="ingredient" value={grid().slots[slot()] ?? null} clear="清空这一格" onPick={(value) => props.context.replace(withSlot(props.context.draft(), slot(), value))} />
      </div>
      <Show when={sentence()}>
        <p class="ae-grid-says" role="note">
          {sentence()}
        </p>
      </Show>
    </div>
  )
}

/** A block's or an item's picture, and 「换一张图」: a file of the person's own, saved as it is. */
function Picture(props: { context: Context; field: FormField }) {
  let input!: HTMLInputElement
  const [refused, setRefused] = createSignal("")
  const url = () => at(props.context.draft(), props.field.key) as string | null | undefined
  const choose = async (file: File | undefined) => {
    // The place is read now: after the file has been read the field may no longer be on the form.
    const key = props.field.key
    if (!file) return
    const read = importPicture(new Uint8Array(await file.arrayBuffer()), (props.context.draft().variants as string[] | null | undefined) ?? [])
    input.value = ""
    if (!read.ok) return setRefused(read.text)
    setRefused("")
    props.context.edit(key, read.url)
  }
  return (
    <div class="ae-picture">
      <span class="ae-picture-face mc-slot" style={{ background: url() ? undefined : String(props.context.draft().color ?? "") }}>
        <Show when={url()}>
          <img src={url()!} alt="现在的图案" draggable={false} />
        </Show>
      </span>
      <div class="ae-picture-side">
        <input ref={input} type="file" accept="image/png" hidden onChange={(event) => void choose(event.currentTarget.files?.[0])} />
        <button type="button" class="studio-button" disabled={props.context.disabled()} onClick={() => input.click()}>
          换一张图
        </button>
        <Show when={url()}>
          <button type="button" class="studio-button" disabled={props.context.disabled()} onClick={() => props.context.edit(props.field.key, null)}>
            不用图案
          </button>
        </Show>
        <Show when={refused()}>
          <p class="ae-bad" role="alert">
            {refused()}
          </p>
        </Show>
      </div>
    </div>
  )
}

/** A number typed as text: what is being typed stays as typed, and the document gets the number it reads as. */
function NumberBox(props: { context: Context; field: FormField }) {
  const value = () => at(props.context.draft(), props.field.key) as number | null | undefined
  const [text, setText] = createSignal(value() == null ? "" : String(value()))
  // Something else changed the number (give up, a rule of the game): show that, not what was typed before.
  createEffect(on(value, (now) => {
    const typed = text().trim() === "" ? null : Number(text())
    if (!(now == null ? typed === null : Object.is(now, typed))) setText(now == null || Number.isNaN(now) ? "" : String(now))
  }))
  const shape = () => props.field.shape as Extract<FormField["shape"], { type: "number" }>
  const leftOut = () => (shape().nullable ? null : shape().optional ? undefined : Number.NaN)
  return (
    <input
      type="number"
      inputmode="decimal"
      aria-label={props.field.word.label}
      aria-invalid={!!props.context.bad(props.field.key)}
      min={shape().min ?? shape().above}
      max={shape().max}
      step={shape().int ? 1 : "any"}
      placeholder={props.field.word.none ?? ""}
      value={text()}
      disabled={props.context.disabled()}
      onInput={(event) => {
        setText(event.currentTarget.value)
        props.context.edit(props.field.key, event.currentTarget.value.trim() === "" ? leftOut() : Number(event.currentTarget.value))
      }}
    />
  )
}

function Control(props: { context: Context; field: FormField }) {
  const key = () => props.field.key
  const word = () => props.field.word
  const value = () => at(props.context.draft(), key())
  const off = () => (props.field.shape.nullable ? null : props.field.shape.optional ? undefined : false)
  const label = (option: string) => {
    const title = word().choices?.[option] ?? "选项 " + (props.field.options.indexOf(option) + 1)
    return props.context.advanced() && title !== option ? title + "（" + option + "）" : title
  }
  const mode = () => word().as as ThingMode
  // Whether the settings of a switch were just given back from before it was turned off.
  const [restored, setRestored] = createSignal(false)
  const [open, setOpen] = createSignal(false)
  const [filter, setFilter] = createSignal("")
  const picked = () => (Array.isArray(value()) ? (value() as string[]) : [])
  const toggle = (option: string) => {
    const next = picked().includes(option) ? picked().filter((entry) => entry !== option) : [...props.field.options.filter((entry) => picked().includes(entry) || entry === option)]
    // A list that may be left out is left out when nothing is picked (a creature's groups of biomes need at least one).
    props.context.edit(key(), !next.length && props.field.shape.optional && !word().keepEmpty ? undefined : next)
  }
  const rows = () => (Array.isArray(value()) ? (value() as unknown[]) : [])
  const list = () => props.field.shape as Extract<FormField["shape"], { type: "list" }>
  return (
    <Switch>
      <Match when={props.field.control === "builtin"}>
        <BuiltinEditor value={value()} aliases={props.context.draft().particles as ParticleAliases | undefined} advanced={props.context.advanced()} project={props.context.project()} disabled={props.context.disabled()} edit={v=>props.context.edit(key(),v)} />
      </Match>
      <Match when={props.field.control === "stagger"}>
        <StaggerEditor value={value()} disabled={props.context.disabled()} edit={v => props.context.edit(key(), v)} />
      </Match>
      <Match when={props.field.control === "text"}>
        <input type="text" aria-label={word().label} aria-invalid={!!props.context.bad(key())} placeholder={word().none ?? ""} value={(value() as string | null | undefined) ?? ""} disabled={props.context.disabled()} onInput={(event) => props.context.edit(key(), event.currentTarget.value === "" && word().none ? off() : event.currentTarget.value)} />
      </Match>
      <Match when={props.field.control === "long"}>
        <textarea rows="3" aria-label={word().label} value={(value() as string | undefined) ?? ""} disabled={props.context.disabled()} onInput={(event) => props.context.edit(key(), event.currentTarget.value)} />
      </Match>
      <Match when={props.field.control === "number"}>
        <NumberBox context={props.context} field={props.field} />
      </Match>
      <Match when={props.field.control === "texture"}>
        <select aria-label={word().label} aria-invalid={!!props.context.bad(key())} value={(value() as string | undefined) ?? ""} disabled={props.context.disabled()} onChange={(event) => props.context.edit(key(), event.currentTarget.value || off())}>
          <option value="">{word().none ?? "不用"}</option>
          <For each={props.context.project().workspace.assets.filter((asset) => asset.document.kind === "texture") ?? []}>
            {(asset) => <option value={asset.id}>{asset.document.kind === "texture" ? `${asset.title}（${asset.document.width}×${asset.document.height}）` : asset.title}</option>}
          </For>
        </select>
      </Match>
      <Match when={props.field.control === "color"}>
        <input type="color" class="ae-color" aria-label={word().label} value={String(value() ?? "#8a8a8a")} disabled={props.context.disabled()} onInput={(event) => props.context.edit(key(), event.currentTarget.value)} />
      </Match>
      <Match when={props.field.control === "flag"}>
        <label class="ae-flag">
          <input type="checkbox" aria-label={word().label} checked={value() === true} disabled={props.context.disabled()} onChange={(event) => props.context.edit(key(), event.currentTarget.checked ? true : off())} />

          <small class="ae-state">{tickWords(word(), value() === true).state}</small>
        </label>
      </Match>
      <Match when={props.field.control === "switch"}>
        <label class="ae-flag">
          <input
            type="checkbox" aria-label={word().label}
            checked={value() != null}
            disabled={props.context.disabled()}
            onChange={(event) => {
              // Off keeps what was set (it must not stay in the document, see `asset-edit-memory.ts`); on gives it back, and says so.
              if (!event.currentTarget.checked) {
                props.context.memory.keep(key(), value())
                setRestored(false)
                return props.context.edit(key(), off())
              }
              const back = switchedOn(props.context.memory, key(), word().fresh)
              setRestored(back.restored)
              props.context.edit(key(), back.value)
            }}
          />

          <small class="ae-state">{tickWords(word(), value() != null).state}</small>
          <Show when={restored() && value() != null}>
            <small class="ae-state">已恢复成你关掉之前的设置</small>
          </Show>
        </label>
      </Match>
      <Match when={props.field.control === "choice" && props.field.options.length + (word().none ? 1 : 0) <= BUTTON_CHOICES}>
        <div class="ae-choice" role="group" aria-label={word().label}>
          <Show when={word().none}>
            <button type="button" aria-pressed={value() == null} disabled={props.context.disabled()} onClick={() => props.context.edit(key(), off())}>
              {word().none}
            </button>
          </Show>
          <For each={props.field.options}>
            {(option) => (
              <button type="button" aria-pressed={value() === option} disabled={props.context.disabled()} onClick={() => props.context.edit(key(), option)}>
                {label(option)}
              </button>
            )}
          </For>
        </div>
      </Match>
      <Match when={props.field.control === "choice"}>
        <select aria-label={word().label} aria-invalid={!!props.context.bad(key())} disabled={props.context.disabled()} onChange={(event) => props.context.edit(key(), event.currentTarget.value === "" ? off() : event.currentTarget.value)}>
          <Show when={word().none}>
            <option value="" selected={value() == null}>
              {word().none}
            </option>
          </Show>
          <For each={props.field.options}>
            {(option) => (
              <option value={option} selected={value() === option}>
                {label(option)}
              </option>
            )}
          </For>
        </select>
      </Match>
      <Match when={props.field.control === "many"}>
        <Show when={word().keepEmpty}>
          <label><input type="checkbox" checked={Array.isArray(value())} disabled={props.context.disabled()} onChange={event => props.context.edit(key(), event.currentTarget.checked ? [] : undefined)} />使用这份名单</label>
        </Show>
        <Show when={!word().keepEmpty || Array.isArray(value())}>
        <Show
          when={props.field.options.length > FOLDED_CHOICES}
          fallback={
            <div class="ae-many" role="group" aria-label={word().label}>
              <For each={props.field.options}>
                {(option) => (
                  <button type="button" aria-pressed={picked().includes(option)} disabled={props.context.disabled()} onClick={() => toggle(option)}>
                    {label(option)}
                  </button>
                )}
              </For>
            </div>
          }
        >
          <Fold class="ae-fold" summary={picked().length ? `选了 ${picked().length} 个：${picked().map(label).join("、")}` : "一个都没选，点开来挑"}>
            <input type="search" placeholder="搜名字" aria-label={`搜索${word().label}`} value={filter()} onInput={(event) => setFilter(event.currentTarget.value)} />
            <div class="ae-many ae-many-long" role="group" aria-label={word().label}>
              <For each={props.field.options.filter((option) => label(option).includes(filter().trim()) || option.includes(filter().trim()))}>
                {(option) => (
                  <button type="button" aria-pressed={picked().includes(option)} disabled={props.context.disabled()} onClick={() => toggle(option)}>
                    {label(option)}
                  </button>
                )}
              </For>
            </div>
          </Fold>
        </Show>
        </Show>
      </Match>
      <Match when={props.field.control === "thing"}>
        <div class="ae-pick">
          <button type="button" class="ae-pick-face" aria-expanded={open()} aria-invalid={!!props.context.bad(key())} disabled={props.context.disabled()} onClick={() => setOpen(!open())}>
            <ThingFace context={props.context} mode={mode()} value={value() as string | null | undefined} empty={word().none ?? "点这里选"} />
            <b>{open() ? "收起" : "换"}</b>
          </button>
          <Show when={open()}>
            <ThingList
              context={props.context}
              mode={mode()}
              except={mode() === "own" ? String(props.context.draft().identifier ?? "") : undefined}
              value={(value() as string | null | undefined) ?? null}
              clear={word().none ?? null}
              onPick={(next) => {
                props.context.edit(key(), next ?? off())
                setOpen(false)
              }}
            />
          </Show>
        </div>
      </Match>
      <Match when={props.field.control === "grid"}>
        <RecipeGrid context={props.context} />
      </Match>
      <Match when={props.field.control === "picture"}>
        <Picture context={props.context} field={props.field} />
      </Match>
      <Match when={props.field.control === "list"}>
        <div class="ae-rows">
          <Index each={props.field.rows}>
            {(row, index) => (
              <div class="ae-row">
                <Fields context={props.context} keys={row().map((field) => field.key)} find={(wanted) => props.field.rows[index]?.find((field) => field.key === wanted)} />
                <button type="button" class="studio-button" disabled={props.context.disabled()} onClick={() => props.context.edit(key(), rows().filter((_, position) => position !== index))}>
                  去掉这一行
                </button>
              </div>
            )}
          </Index>
          <Show when={!rows().length}>
            <p class="ae-help">现在一行都没有。</p>
          </Show>
          <button type="button" class="studio-button" disabled={props.context.disabled() || (list().max !== undefined && rows().length >= list().max!)} onClick={() => props.context.edit(key(), [...rows(), word().fresh?.()])}>
            加一行{list().max !== undefined ? `（最多 ${list().max} 行）` : ""}
          </button>
        </div>
      </Match>
    </Switch>
  )
}

/**
 * The fields under one heading, by their places. Each stays the same control for as long as its place is on the
 * form, whatever else changes: the form is laid out again on every keystroke, and a box being typed in must not be made anew.
 */
function Fields(props: { context: Context; keys: string[]; find: (key: string) => FormField | undefined }) {
  return (
    <For each={props.keys}>
      {(key) => (
        <Show when={props.find(key)}>
          {(field) => (
            <div class="ae-field" data-field={key} classList={{ inner: field().inner, bad: !!props.context.bad(key), wide: ["grid", "list", "long", "picture"].includes(field().control) || (field().control === "many" && field().options.length > BUTTON_CHOICES) }}>
              <div class="ae-label">
                <span>{field().word.label}</span>
                <Show when={field().range}>
                  <small>{field().range}</small>
                </Show>
                <Show when={props.context.advanced()}>
                  <code>{key}</code>
                </Show>
              </div>
              <div class="ae-control">
                <Control context={props.context} field={field()} />
              </div>
              <p class="ae-help">
                {field().word.help}
                {field().word.note?.(props.context.draft(), props.context.id()) ?? ""}
              </p>
              <Show when={props.context.bad(key)}>
                <p class="ae-bad" role="alert">
                  {props.context.bad(key)}
                </p>
              </Show>
            </div>
          )}
        </Show>
      )}
    </For>
  )
}

/** The element of a form field by its path, else of the nearest field above it; null when the form has none of them. */
function fieldElement(host: HTMLElement | undefined, field: string) {
  return fieldSelector(field).map((selector) => host?.querySelector<HTMLElement>(selector)).find((place) => !!place) ?? null
}

/**
 * 「自己改」: one thing of the project as a form the person fills in, saved as that thing's real document.
 * `asset` null: a new thing, started from `start`. Needs no AI.
 */
function TerrainControls(props: { context: Context }) {
  const keys = () => {
    const moves = props.context.draft().abilities
    if (!Array.isArray(moves)) return []
    return moves.flatMap((move, m) => Array.isArray(move?.events)
      ? move.events.flatMap((event: {type?: string}, i: number) =>
        event.type === "terrain_rise" || event.type === "block_swap" ? [`abilities.${m}.events.${i}`] : [])
      : [])
  }
  return <For each={keys()}>{key => {
    const value = (name: string) => at(props.context.draft(), key+"."+name)
    const edit = (name: string, v: unknown) => props.context.edit(key+"."+name,v)
    const rise = () => value("type") === "terrain_rise"
    const moveName = () => at(props.context.draft(),key.split(".").slice(0,2).join(".")+".name")
    return <section class="ae-section mc-window">
      <h3>{String(moveName())} · {value("at") as number} 秒{rise() ? "升起地形" : "临时换块"}</h3>
      <Show when={rise()}>
        <label>方块材质 <input value={String(value("material") ?? "")} placeholder="留空取脚下方块" onInput={e => edit("material",e.currentTarget.value || undefined)} /></label>
        <label>可被打碎的硬度 <input type="number" min="0" max="50" step="any" placeholder="留空时毁不掉" value={String(value("hardness") ?? "")} onInput={e => edit("hardness",e.currentTarget.value === "" ? undefined : e.currentTarget.valueAsNumber)} /></label>
        <Show when={value("shape") === "spike"}><label>收尖程度 <input type="number" min="0" max="1" step="0.1" placeholder="默认 1" value={String(value("taper") ?? "")} onInput={e => edit("taper",e.currentTarget.value === "" ? undefined : e.currentTarget.valueAsNumber)} /></label></Show>
        <For each={[["beam","挡光束"],["area","挡受掩体影响的范围出手"],["projectile","挡投射物"]]}>{([flag,label]) =>
          <label><input type="checkbox" checked={value("blocks."+flag) === true} onChange={e => {
            const flags = {...value("blocks") as Record<string,boolean>}
            if(e.currentTarget.checked) flags[flag!] = true
            else delete flags[flag!]
            edit("blocks",Object.keys(flags).length ? flags : undefined)
          }} /> {label}</label>
        }</For>
      </Show>
      <label><input type="checkbox" checked={value("restore_on_exit") === true} onChange={e => edit("restore_on_exit",e.currentTarget.checked || undefined)} /> 放它的生物离场时，把地形变回原样</label>
    </section>
  }}</For>
}

export function ContentEditor(props: {
  project: Project
  kind: HandKind
  asset: WorkspaceAsset | null
  start: Loose
  disabled: boolean
  advanced: boolean
  onDirty: (dirty: boolean) => void
  onSaved: (view: StudioView, assetId: string) => void
  /** Leave the form with nothing kept. Asked for a new thing; a saved one just goes back to what is saved. */
  onGiveUp?: () => void
  /** A finding's button asked for this field: it is scrolled to and its control focused (`fieldElement`). */
  focus?: { field: string; nonce: number } | null
}) {
  let host!: HTMLElement
  const api = window.studio as unknown as HandApi
  const [draft, setDraft] = createSignal<Loose>(structuredClone(props.start))
  const [base, setBase] = createSignal<Loose | null>(props.asset ? structuredClone(props.start) : null)
  const [tried, setTried] = createSignal(false)
  const [answered, setAnswered] = createSignal<HandIssue[]>([])
  const [saving, setSaving] = createSignal(false)
  const [saved, setSaved] = createSignal(false)
  // A new thing has an id once it is saved; the next save is of that thing, not of another new one.
  const [ownId, setOwnId] = createSignal(props.asset?.id ?? null)
  const dirty = createMemo(() => !base() || !same(base(), draft()))
  // The revision of the thing the form's `base` is of (see `stale-edit`): a save says it, and the app refuses one made on an older revision.
  const [basis, setBasis] = createSignal<number | null>(props.asset?.revision ?? null)
  // The thing was saved by something else meanwhile (an AI's new version) and the form holds words of the person's: it says so instead of
  // writing the old words back over the new version, and the new content is theirs to load.
  const [moved, setMoved] = createSignal(false)
  const revisionNow = createMemo(() => props.asset?.revision)
  createEffect(
    on(
      revisionNow,
      (revision) => {
        const document = props.asset?.document as Loose | undefined
        const started = basis()
        if (!document || revision === undefined || started === null) return
        // A stored version that is what the form holds is this form's own save coming back (it can arrive before the save call returns).
        const verdict = same(document, draft()) ? "rebase" : followStored({ revision: started, value: base() }, { revision, value: document }, dirty(), same)
        if (verdict === "follow") {
          setDraft(structuredClone(document))
          setBase(structuredClone(document))
          setBasis(revision)
          setMoved(false)
        }
        if (verdict === "rebase") {
          setBasis(revision)
          setMoved(false)
        }
        if (verdict === "moved") setMoved(true)
      },
      { defer: true },
    ),
  )
  createEffect(() => props.onDirty(dirty()))
  onCleanup(() => props.onDirty(false))
  const things = createMemo(() => catalog(props.project))
  const sections = createMemo(() => formOf(props.kind, draft(), { advanced: props.advanced, basics: !handWired(api) }))
  const fields = createMemo(() => new Map(sections().flatMap((section) => section.fields).map((field) => [field.key, field])))
  const issues = createMemo(() => (tried() ? [...check(props.kind, draft()), ...answered()].map((issue) => plainIssue(props.kind, issue, props.advanced)) : []))
  // A finding beside a field that is not on the form as it stands is said with the ones about the whole thing.
  const placed = (key: string) => fields().has(key) || [...fields().values()].some((field) => field.rows.some((row) => row.some((inner) => inner.key === key)))
  const loose = createMemo(() => issues().filter((issue) => !issue.key || !placed(issue.key)))
  const replace = (document: Loose) => {
    setAnswered([])
    setSaved(false)
    setDraft(document)
  }
  // Beside the draft and not in it: a save replaces the draft with what was stored, and the settings of a switch that is off are not stored.
  const memory = memoryOf(props.asset?.id ?? null)
  const context: Context = {
    kind: props.kind,
    memory,
    project: () => props.project,
    things,
    draft,
    id: () => props.asset?.id ?? ownId(),
    edit: (key, value) => replace(settle(props.kind, setAt(draft(), key, value))),
    replace,
    disabled: () => props.disabled || saving(),
    advanced: () => props.advanced,
    bad: (key) => issues().filter((issue) => issue.key === key).map((issue) => issue.text).join(""),
  }
  const save = async () => {
    if (saving() || props.disabled || !dirty() || moved()) return
    setTried(true)
    if (check(props.kind, draft()).length) return
    setSaving(true)
    const document = draft()
    const result = await saveHand(api, props.project, props.kind, props.asset?.id ?? ownId(), document, base() ? changedLabels(props.kind, base()!, document) : [], () => crypto.randomUUID(), basis() ?? undefined)
    setSaving(false)
    if (!result.ok) {
      // The app turned the save back because the stored version is newer than the one this form started from: say it where the form stands.
      // That refusal is said once, by the notice; any other issue in the same answer is still listed.
      if (result.issues.some((issue) => issue.message === STALE_EDIT.says)) setMoved(true)
      return setAnswered(result.issues.filter((issue) => issue.message !== STALE_EDIT.says))
    }
    // What was stored is what the form now holds: the save trims names and may write a field its own way.
    const stored = savedDocument(result.view, result.assetId) ?? document
    setBase(structuredClone(stored))
    setDraft(structuredClone(stored))
    setBasis(result.view.project.workspace.assets.find((asset) => asset.id === result.assetId)?.revision ?? basis())
    setMoved(false)
    setTried(false)
    setSaved(true)
    setOwnId(result.assetId)
    // A new thing that was switched on and off before its first save keeps its memory under the id it now has.
    adopt(result.assetId, memory)
    props.onSaved(result.view, result.assetId)
  }
  // Put the stored version into the form, in place of what it holds.
  const loadNew = () => {
    const document = props.asset?.document as Loose | undefined
    if (!document) return
    setBase(structuredClone(document))
    setBasis(props.asset?.revision ?? basis())
    setMoved(false)
    setTried(false)
    replace(structuredClone(document))
  }
  const giveUp = () => {
    if (moved()) return loadNew()
    if (!base()) return props.onGiveUp?.()
    setTried(false)
    replace(structuredClone(base()!))
  }
  const shortcut = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return
    event.preventDefault()
    void save()
  }
  window.addEventListener("keydown", shortcut)
  onCleanup(() => window.removeEventListener("keydown", shortcut))

  // Once the form is on screen: the asked-for field, else the nearest one above it that is (`drop_item.item` only exists while `drop` says so).
  createEffect(
    on(
      () => props.focus,
      (request) => {
        if (!request) return
        const place = fieldElement(host, request.field)
        if (!place) return
        place.scrollIntoView({ block: "center" })
        place.querySelector<HTMLElement>("input,select,textarea,button")?.focus()
        place.classList.add("asked")
        window.setTimeout(() => place.classList.remove("asked"), 2500)
      },
    ),
  )
  return (
    <section class="ae" aria-label="自己改" ref={host}>
      <header class="ae-bar mc-window">
        <span class="ae-state" classList={{ dirty: dirty() }} role="status">
          {saving() ? EDIT_STATE.saving : !base() ? EDIT_STATE.fresh : dirty() ? EDIT_STATE.dirty : saved() ? EDIT_STATE.saved : EDIT_STATE.clean}
        </span>
        <Show when={loose().length || (tried() && issues().length)}>
          <span class="ae-bar-bad" role="alert">
            {loose().length ? loose().map((issue) => `${issue.label ? `「${issue.label}」` : ""}${issue.text}`).join("") : `有 ${issues().length} 处要先改好，已经标在下面。`}
          </span>
        </Show>
        <Show when={dirty() && props.asset?.document.kind === "ability" && props.asset}>
          {asset => <p role="status">保存会影响{abilityUsers(props.project, asset().id, asset().document as import("@minemods/mod-core/ability-asset").AbilityAssetDocument).map(user => "「" + user.title + "」").join("、") || "这一招本身"}。</p>}
        </Show>
        <span class="ae-bar-buttons">
          <button type="button" class="studio-button" disabled={saving() || props.disabled || (!!base() && !dirty())} onClick={giveUp}>
            {base() ? "放弃修改" : "不做了"}
          </button>
          <button type="button" class="studio-button primary" disabled={saving() || props.disabled || !dirty() || moved()} onClick={() => void save()}>
            {saving() ? EDIT_STATE.saving : "保存"}
          </button>
        </span>
      </header>
      <Show when={moved()}>
        <StaleNotice onLoad={loadNew} />
      </Show>
      <div class="ae-sections">
        <Show when={props.kind === "entity" && handWired(api)}>
          <BeamSweepFields abilities={(draft().abilities as Ability[] | undefined) ?? []} phases={(draft().boss as Project["entities"][number]["boss"])?.phases.length ?? 0} edit={context.edit} disabled={context.disabled()} />
          <SoundRangeFields creature={draft() as unknown as Project["entities"][number]} edit={context.edit} disabled={context.disabled()} />
          <ReturnPlaceFields abilities={(draft().abilities as Ability[] | undefined) ?? []} edit={context.edit} disabled={context.disabled()} />
          <LandingFields abilities={(draft().abilities as Ability[] | undefined) ?? []} edit={context.edit} disabled={context.disabled()} />
          <OnceGroupFields abilities={(draft().abilities as Ability[] | undefined) ?? []} edit={context.edit} disabled={context.disabled()} />
          <RingWarnFields abilities={(draft().abilities as Ability[] | undefined) ?? []} effects={props.project.workspace.assets.filter(a => a.document.kind === "effect")} edit={context.edit} disabled={context.disabled()} />
        </Show>
        <Show when={props.kind === "entity" && handWired(api)}><TerrainControls context={context} /></Show>
        <Show when={props.kind === "entity" && handWired(api) && (draft().boss as {arena?:{fixtures?:ArenaFixture[]}} | null)?.arena?.fixtures?.length}>
          <FixtureFields groups={(draft().boss as {arena:{fixtures:ArenaFixture[]}}).arena.fixtures} title={id => workspaceName(props.project.workspace.assets.find(asset => asset.id === id))} advanced={props.advanced} edit={context.edit} disabled={context.disabled()} />
        </Show>
        <For each={sections().map((section) => section.title)}>
          {(title) => (
            <section class="ae-section mc-window" classList={{ wide: props.kind === "recipe" }}>
              <h3>{title}</h3>
              <Fields context={context} keys={(sections().find((section) => section.title === title)?.fields ?? []).map((field) => field.key)} find={(key) => fields().get(key)} />
            </section>
          )}
        </For>
        {/* 书: every page, written beside the book as the game draws it. */}
        <Show when={props.kind === "book"}>
          <BookPages document={draft() as unknown as BookDocument} project={props.project} disabled={context.disabled()} edit={context.edit} />
        </Show>
      </div>
      <Show when={HAND_KEPT_WORDS[props.kind]}>
        <p class="ae-kept">{HAND_KEPT_WORDS[props.kind]}</p>
      </Show>
      <Show when={props.kind === "entity"}>
        <p class="ae-kept">招式要等目标到哪边、起手时要不要转身，可以让 AI 改。</p>
      </Show>
    </section>
  )
}
