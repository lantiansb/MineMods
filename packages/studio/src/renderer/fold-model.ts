/**
 * The open/closed state of a fold (the shared stand-in for `<details>`), kept apart from the component so it can be tested without a page.
 * Why a fold is not a `<details>`: in the packaged app (Electron 35, Chromium 134) a `<details>` showed its own internal stylesheet as text
 * (`:host summary { display: list-item; ... }`) in the build drawer (broad9) and between the mod guide's cards (broad7); no rule of ours could be found
 * that does it, and the same page in a newer Chromium does not. A button that shows or hides its content has no such inner part to leak.
 */

let counter = 0

/** A new id for the content a fold's button controls (`aria-controls` names an element, so each fold needs its own). */
export const nextFoldId = (): string => `fold-${++counter}`

/** The attributes of a fold's button that tell a reader whether its content is showing and which content it is. */
export function foldAttributes(open: boolean, contentId: string) {
  return { "aria-expanded": open ? "true" : "false", "aria-controls": contentId } as const
}

/**
 * The open state a fold shows when its `open` prop is read again: an `open` that changed is followed (as a `<details open={...}>` follows its expression), one that is
 * the same as before leaves it as the person set it by pressing the button. `before` is what the prop was the last time it was read.
 */
export function followOpen(before: boolean | undefined, now: boolean | undefined, current: boolean): boolean {
  return Boolean(before) === Boolean(now) ? current : Boolean(now)
}

/** The state after the button is pressed, and whether the fold has to tell anyone (it always does: a press always changes it). */
export function pressed(current: boolean): boolean {
  return !current
}
