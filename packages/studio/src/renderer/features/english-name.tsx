import { createEffect, createMemo, createSignal, on, Show } from "solid-js"
import { Button } from "../ui"
import { plainError } from "./project-setup-model"
import { ENGLISH_WORDS, englishHint, englishProblem, englishThing } from "./english-name-model"
import type { CardPartProps } from "./asset-card-parts"
import "./english-name.css"

/**
 * The English name of a block, an item or a creature, on its own card and in the open: the check after a build says to fill it, and this
 * is where it is filled (a finding's button brings the person here and focuses the box). Saved on its own, not with a form, so it works for
 * every thing, including a creature made before things had pages of their own.
 */
export function EnglishNameCard(props: CardPartProps) {
  const thing = createMemo(() => englishThing(props.project, props.item))
  const [text, setText] = createSignal(thing()?.nameEn ?? "")
  const [said, setSaid] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  let input!: HTMLInputElement
  // The name saved elsewhere meanwhile (an outside AI filled it in, or this very save): an untouched box follows it.
  createEffect(on(() => thing()?.nameEn ?? "", (now, before) => setText((typed) => (typed.trim() === (before ?? "") ? now : typed)), { defer: true }))
  const problem = () => englishProblem(text())
  const changed = () => text().trim() !== (thing()?.nameEn ?? "")
  const save = async () => {
    const found = thing()
    if (!found || saving() || !changed() || problem()) return
    setSaving(true)
    setSaid("")
    await window.studio
      .setEnglishName({ projectId: props.projectId, expectedRevision: props.project.revision, kind: found.kind, id: found.id, name_en: text().trim() })
      .then(
        () => {
          setSaid(text().trim() ? ENGLISH_WORDS.saved : ENGLISH_WORDS.cleared)
          props.changed?.()
        },
        (cause: unknown) => setSaid(plainError(cause, ENGLISH_WORDS.failed, props.advanced)),
      )
      .finally(() => setSaving(false))
  }
  // A finding's button was pressed for this field: bring the box into view and put the cursor in it.
  createEffect(
    on(
      () => props.focus,
      (request) => {
        if (!request || request.itemId !== props.item.id || request.field !== "name_en") return
        queueMicrotask(() => {
          input?.scrollIntoView({ block: "center" })
          input?.focus()
        })
      },
    ),
  )
  return (
    <Show when={thing()}>
      <section class="en-card" data-field="name_en" aria-label={ENGLISH_WORDS.label}>
        <label for={`en-name-${props.item.id}`}>{ENGLISH_WORDS.label}</label>
        <div class="en-row">
          <input
            id={`en-name-${props.item.id}`}
            ref={input}
            type="text"
            maxlength="120"
            spellcheck={false}
            autocomplete="off"
            placeholder={`${thing()!.name} 的英文名`}
            aria-invalid={!!problem()}
            value={text()}
            disabled={saving()}
            onInput={(event) => {
              setText(event.currentTarget.value)
              setSaid("")
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.isComposing) {
                event.preventDefault()
                void save()
              }
            }}
          />
          <Button disabled={saving() || !changed() || !!problem()} onClick={() => void save()}>
            {saving() ? ENGLISH_WORDS.saving : ENGLISH_WORDS.save}
          </Button>
        </div>
        <p class="en-help" classList={{ bad: !!problem() }} role={problem() ? "alert" : undefined}>
          {problem() || englishHint(thing()!)}
        </p>
        <Show when={said()}>
          <p class="en-said" role="status">
            {said()}
          </p>
        </Show>
      </section>
    </Show>
  )
}
