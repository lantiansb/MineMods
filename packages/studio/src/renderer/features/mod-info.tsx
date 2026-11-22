import { createEffect, createSignal, on, Show } from "solid-js"
import type { Project } from "@minemods/mod-core/project"
import type { ModInfoInput } from "../../api"
import { advanced } from "../advanced"
import { ReleaseFieldset } from "../release-form"
import { INFO_WORDS, iconPicked, infoChanged, infoFields, infoOf, infoProblem, type InfoFields } from "../mod-info-model"
import { Button, Icon } from "../ui"
import { plainError } from "./project-setup-model"
import "./mod-info.css"

const readUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(INFO_WORDS.failed))
    reader.readAsDataURL(file)
  })

/**
 * 「模组信息」: the one page where the mod says who it is — name (and its English name), description, icon, author, version, licence.
 * The overview links here and so does 「构建并试玩」; there is no other copy of these fields. One Save writes them together (`saveModInfo`).
 * `focus` is a field a link wants shown and focused (`icon`, `name_en`, `author`…).
 */
export function ModInfo(props: {
  project: Project
  nickname: string
  disabled: boolean
  focus?: { field: string; nonce: number } | null
  onSave: (info: ModInfoInput) => Promise<unknown>
  onBack: () => void
}) {
  const [fields, setFields] = createSignal<InfoFields>(infoFields(props.project))
  // undefined: the saved icon stays; null: taken away; a data URL: a picture just picked, shown before it is saved.
  const [icon, setIcon] = createSignal<string | null | undefined>(undefined)
  const [problem, setProblem] = createSignal("")
  const [said, setSaid] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  let picker!: HTMLInputElement
  let root!: HTMLElement
  const shownIcon = () => (icon() === undefined ? (props.project.icon ?? null) : icon())
  // Saved elsewhere meanwhile (an outside AI, or this very save): a page with nothing typed follows the project; what is typed stays.
  let base = JSON.stringify(infoFields(props.project))
  createEffect(
    on(
      () => props.project.revision,
      () => {
        const now = infoFields(props.project)
        if (JSON.stringify(fields()) === base && icon() === undefined) setFields(now)
        base = JSON.stringify(now)
      },
      { defer: true },
    ),
  )
  const set = (key: keyof InfoFields, value: string) => {
    setFields({ ...fields(), [key]: value })
    setProblem("")
    setSaid("")
  }
  const changed = () => infoChanged(props.project, fields(), icon())
  const choose = async (file: File | undefined) => {
    if (!file) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    picker.value = ""
    const checked = iconPicked(bytes, file.type)
    if (!checked.ok) return setProblem(checked.text)
    setIcon(await readUrl(file))
    setProblem("")
    setSaid("")
  }
  const save = async () => {
    const found = infoProblem(fields())
    setProblem(found)
    if (found || saving() || !changed()) return
    setSaving(true)
    setSaid("")
    await props
      .onSave(infoOf(fields(), icon()))
      .then(
        () => {
          setIcon(undefined)
          setSaid(INFO_WORDS.saved)
        },
        (cause: unknown) => setProblem(plainError(cause, INFO_WORDS.failed, advanced())),
      )
      .finally(() => setSaving(false))
  }
  // A link brought the person to one field: scroll to it and put the cursor in it.
  createEffect(
    on(
      () => props.focus,
      (request) => {
        if (!request) return
        queueMicrotask(() => {
          const place = root?.querySelector<HTMLElement>(`[data-field="${request.field}"]`)
          place?.scrollIntoView({ block: "center" })
          place?.querySelector<HTMLElement>("input,textarea,button")?.focus()
        })
      },
    ),
  )
  return (
    <section class="page mod-info" ref={root} aria-label={INFO_WORDS.title}>
      <header class="page-heading">
        <div>
          <h1>{INFO_WORDS.title}</h1>
          <p class="muted">{INFO_WORDS.lead}</p>
        </div>
        <div class="page-actions">
          <Button onClick={props.onBack}>{INFO_WORDS.back}</Button>
          <Button primary disabled={props.disabled || saving() || !changed()} onClick={() => void save()}>
            {saving() ? INFO_WORDS.saving : INFO_WORDS.save}
          </Button>
        </div>
      </header>
      <form
        class="panel mod-info-form release-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <section class="mi-icon" data-field="icon">
          <span class="mi-face mc-slot">
            <Show when={shownIcon()} fallback={<Icon name="cube" />}>
              {(url) => <img src={url()} alt="模组图标" draggable={false} />}
            </Show>
          </span>
          <div class="mi-icon-side">
            <strong>图标</strong>
            <input ref={picker} type="file" accept="image/png" hidden onChange={(event) => void choose(event.currentTarget.files?.[0])} />
            <span class="mi-icon-buttons">
              <Button disabled={props.disabled || saving()} onClick={() => picker.click()}>
                {INFO_WORDS.iconPick}
              </Button>
              <Show when={shownIcon()}>
                <Button disabled={props.disabled || saving()} onClick={() => setIcon(null)}>
                  {INFO_WORDS.iconRemove}
                </Button>
              </Show>
            </span>
            <p class="create-hint">{icon() ? INFO_WORDS.iconChosen : shownIcon() ? INFO_WORDS.iconKept : INFO_WORDS.iconNone}</p>
            <p class="create-hint">{INFO_WORDS.iconRules}</p>
          </div>
        </section>
        <label class="field" data-field="name">
          工程名称
          <input aria-label="工程名称" maxlength={120} disabled={props.disabled} value={fields().name} onInput={(event) => set("name", event.currentTarget.value)} />
        </label>
        <label class="field" data-field="name_en">
          英文名
          <input aria-label="模组的英文名" maxlength={120} spellcheck={false} autocomplete="off" disabled={props.disabled} placeholder="例如 Moss Lantern" value={fields().name_en} onInput={(event) => set("name_en", event.currentTarget.value)} />
          <small class="create-hint">{INFO_WORDS.nameEnHelp}</small>
        </label>
        <label class="field" data-field="description">
          介绍
          <textarea aria-label="模组的介绍" rows={3} maxlength={4000} disabled={props.disabled} value={fields().description} onInput={(event) => set("description", event.currentTarget.value)} />
        </label>
        <label class="field" data-field="description_en">
          英文介绍
          <textarea aria-label="模组的英文介绍" rows={3} maxlength={4000} spellcheck={false} disabled={props.disabled} value={fields().description_en} onInput={(event) => set("description_en", event.currentTarget.value)} />
          <small class="create-hint">{INFO_WORDS.descriptionEnHelp}</small>
        </label>
        <ReleaseFieldset fields={fields()} nickname={props.nickname} disabled={props.disabled} onChange={(key, value) => set(key, value)} />
        <Show when={advanced()}>
          <p class="mi-id">
            {INFO_WORDS.idLabel}：<code>{props.project.mod_id}</code>
          </p>
        </Show>
        <Show when={problem()}>
          <span class="create-problem" role="alert">
            {problem()}
          </span>
        </Show>
        <Show when={said()}>
          <span class="mi-said" role="status">
            {said()}
          </span>
        </Show>
      </form>
    </section>
  )
}
