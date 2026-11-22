import { WORDS } from "../words"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { FindingRef } from "@minemods/studio-ai/acceptance"
import type { Finding } from "@minemods/mod-core/reconcile"
import type { StudioView } from "../../api"
import type { HandIssue } from "../../main/content-service"
import { at, type Loose } from "./asset-edit-words"
import { setAt } from "./asset-edit-form"
import { combatAsset, combatFields, combatTitle, type CombatEdit, type CombatField } from "./combat-hand-fields"
import type { CreatureInside } from "./creature-inside-model"

const keyOf = (value: unknown) => value === undefined ? "" : JSON.stringify(value)

function CombatInput(props: { field: CombatField; value: unknown; set: (value: unknown) => void }) {
  const field = () => props.field
  const choices = () => field().choices ?? []
  const selected = () => Array.isArray(props.value) ? props.value : []
  return (
    <Show when={!field().many} fallback={
      <fieldset class="combat-hand-choices">
        <legend>{field().label}</legend>
        <For each={choices()}>{option => (
          <label>
            <input type="checkbox" checked={selected().includes(option.value)} onChange={e => {
              const next = e.currentTarget.checked ? [...selected(), option.value] : selected().filter(value => value !== option.value)
              props.set(next.length ? next : undefined)
            }} />
            {option.label}
          </label>
        )}</For>
      </fieldset>
    }>
      <label class="combat-hand-field">
        <span>{field().label}</span>
        <Show when={field().choices} fallback={
          <Show when={field().text} fallback={
            <input type="number" step="any" value={
              typeof props.value === "number" ? Number((props.value * (field().scale ?? 1)).toPrecision(12)) : field().fallback ?? ""
            } onInput={e => props.set(e.currentTarget.value === "" ? null : e.currentTarget.valueAsNumber / (field().scale ?? 1))} />
          }>
            <input type="text" maxlength={40} value={String(props.value ?? "")} onInput={e => props.set(e.currentTarget.value)} />
          </Show>
        }>
          <select aria-label={field().label} value={keyOf(props.value)} onChange={e => {
            const found = choices().find(option => keyOf(option.value) === e.currentTarget.value)
            if (found) props.set(found.value)
          }}>
            <Show when={!choices().some(option => keyOf(option.value) === keyOf(props.value))}>
              <option value={keyOf(props.value)} disabled>{props.value == null ? "请选择" : "找不到原来选的那样东西"}</option>
            </Show>
            <For each={choices()}>{option => <option value={keyOf(option.value)}>{option.label}</option>}</For>
          </select>
        </Show>
      </label>
    </Show>
  )
}

type Receipt = { projectId: string; assetId: string; revision: number; before: Loose; title: string }

export function CombatHandPanel(props: {
  data: CreatureInside
  edit: CombatEdit | undefined
  close: () => void
  busy: boolean
  saved: (view: StudioView) => void
  go: (ref: FindingRef) => void
}) {
  const [pending, setPending] = createSignal(false)
  const [receipt, setReceipt] = createSignal<Receipt>()
  const [issues, setIssues] = createSignal<HandIssue[]>([])
  const [warnings, setWarnings] = createSignal<Finding[]>([])
  const last = () => receipt()?.projectId === props.data.project.id ? receipt() : undefined
  const submit = async (assetId: string, basedOn: number, document: Loose, changed: string[]) => {
    const project = props.data.project
    setIssues([])
    setWarnings([])
    setPending(true)
    const result = await window.studio.saveByHand({
      projectId: project.id, expectedRevision: project.revision, assetId, document, basedOn, changed, battleEdit: true,
    }).catch((error: unknown) => ({
      ok: false as const,
      issues: [{ path: [], code: "refused", message: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error) }],
    }))
    setPending(false)
    if (!result.ok) {
      setIssues(result.issues)
      return undefined
    }
    setWarnings(result.warnings ?? [])
    return result.view
  }
  const refs = (entries: FindingRef[] = []) => (
    <For each={entries}>{ref => {
      const title = ref.title === String(ref.id) && /^[0-9a-f-]{36}$/i.test(ref.title) ? "找不到这项" : ref.title
      const canOpen = () => ref.kind === "asset" ? props.data.project.workspace.assets.some(asset => asset.id === ref.id)
        : ref.kind === "ability" ? props.data.moves.some(move => move.id === ref.id)
        : ref.kind === "phase" && props.data.phases[Number(ref.id) - 1] !== undefined
      return <Show when={canOpen()} fallback={<small> {title}</small>}>
        <button type="button" onClick={() => { props.close(); props.go(ref) }}>{title}</button>
      </Show>
    }}</For>
  )
  return (
    <>
      <Show when={props.edit} keyed>{edit => {
        const scope = () => combatAsset(props.data, edit)
        return <Show when={scope()}>
          {asset => {
            const start = asset()
            const before = start.document as Loose
            const [draft, setDraft] = createSignal(before)
            const [labels, setLabels] = createSignal<Record<string, string>>({})
            const groups = createMemo(() => combatFields(props.data, edit, before))
            const title = () => combatTitle(props.data, edit)
            const change = (field: CombatField, value: unknown) => {
              setIssues([])
              setDraft(current => setAt(current, field.path, value))
              setLabels(current => ({ ...current, [field.path]: field.label }))
            }
            const changed = () => Object.keys(labels()).filter(path => keyOf(at(before, path)) !== keyOf(at(draft(), path)))
            const save = async () => {
              const keys = changed()
              if (!keys.length || props.busy || pending()) return
              const view = await submit(start.id, start.revision, draft(), [...new Set(keys.map(path => labels()[path]!))].slice(0, 64))
              if (!view) return
              const saved = view.project.workspace.assets.find(value => value.id === start.id)
              if (saved && saved.revision !== start.revision) setReceipt({ projectId: view.project.id, assetId: start.id, revision: saved.revision, before, title: start.title })
              props.saved(view)
              props.close()
            }
            return (
              <form class="inside-card combat-hand" aria-label={title()} onSubmit={e => { e.preventDefault(); void save() }}>
                <h3>{title()}</h3>
                <Show when={edit.tab === "moves" && edit.skill}><p>使用这项{WORDS.skill}的生物、物品和方块会一起变。</p></Show>
                <fieldset disabled={props.busy || pending()}>
                  <For each={groups()}>{group => (
                    <fieldset class="combat-hand-group">
                      <legend>{group.title}</legend>
                      <For each={group.fields}>{field => <CombatInput field={field} value={at(draft(), field.path)} set={value => change(field, value)} />}</For>
                    </fieldset>
                  )}</For>
                  <button type="submit" disabled={!changed().length}>保存修改</button>{" "}
                  <button type="button" onClick={props.close}>取消</button>
                </fieldset>
              </form>
            )
          }}
        </Show>
      }}</Show>
      <Show when={last()}>{saved => (
        <p class="inside-card" role="status">
          已保存「{saved().title}」。{" "}
          <button disabled={props.busy || pending() || !!props.edit} onClick={async () => {
            const undo = saved()
            const view = await submit(undo.assetId, undo.revision, undo.before, ["撤销手动修改"])
            if (!view) return
            setReceipt(undefined)
            props.saved(view)
          }}>撤销上次修改</button>
        </p>
      )}</Show>
      <Show when={issues().length}>
        <ul class="inside-card" role="alert">
          <For each={issues()}>{issue => <li>{issue.message} {refs(issue.refs)}</li>}</For>
        </ul>
      </Show>
      <Show when={warnings().length}>
        <ul class="inside-card" aria-label="检查提醒">
          <For each={warnings()}>{warning => <li>{warning.text} {warning.fix} {refs(warning.refs)}</li>}</For>
        </ul>
      </Show>
    </>
  )
}
