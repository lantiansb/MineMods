/**
 * A form that edits stored content (a thing's card, a blueprint entry) shows what was stored when it was opened. An AI can store a newer
 * version meanwhile, and a save of the form would then write the old text back over the AI's work without anyone having decided that.
 * So every such form knows the revision it started from, the app refuses a save made on an older revision with the sentence below, and the
 * form says the same sentence at once, with a way to load the new content. One mechanism, shared by the page and by the saves.
 */
export const STALE_EDIT = {
  /** Said to the person where the form stands, and as the refusal of a save made on an old revision. */
  says: "AI 刚改过这一样，你看到的是改之前的。",
  /** The button that puts the new content into the form. */
  load: "载入新的",
} as const

export class StaleEditError extends Error {
  constructor() {
    super(STALE_EDIT.says)
  }
}

/**
 * The door of a save. `basedOn` is the revision the form started from, `stored` the revision stored now. A save that does not say what it
 * started from (`undefined`) is not a form's and is held only to the checks it always had. Throws `StaleEditError`.
 */
export function assertFresh(basedOn: number | undefined, stored: number | undefined) {
  if (basedOn !== undefined && stored !== undefined && basedOn !== stored) throw new StaleEditError()
}

/**
 * What a form does when the stored content may have moved under it.
 * "keep": the same revision, nothing to do. "rebase": a newer revision, but not in what this form edits, so the form carries on from it.
 * "follow": the content changed and the person has not touched the form, so it shows the new content. "moved": the content changed under
 * a form the person has edited; their words stay, the form says so, and the new content is theirs to load.
 */
export function followStored<T>(started: { revision: number; value: T }, stored: { revision: number; value: T }, edited: boolean, same: (left: T, right: T) => boolean): "keep" | "rebase" | "follow" | "moved" {
  if (started.revision === stored.revision) return "keep"
  if (same(started.value, stored.value)) return "rebase"
  return edited ? "moved" : "follow"
}
