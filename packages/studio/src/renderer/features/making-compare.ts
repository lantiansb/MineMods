import { SIX_VIEW_WORDS } from "@minemods/studio-ai/making"
import type { MakingRound } from "../../api"

/**
 * 「和上一轮对比」 (broad20 P3-02): two rounds of one making, side by side, at the same angle. Pure, so it can be checked without a screen.
 *
 * What the loop keeps of a round is its pictures, each one a sheet with a label (`MakingRound.pictures`). The six views are not stored apart: they are one
 * sheet, three cells wide and two high, in the order of `SHEET_VIEWS` (look-job's `AROUND`); a motion is a sheet of its own per motion and direction, named
 * for both ("走路 · 斜前方"), whose cells are moments with the time written on each. So "the same angle" is the same sheet label in both rounds, and for the
 * six-view sheet one cell of it. A sheet only one of the rounds has is not offered: nothing is shown against something else.
 */
export const SHEET_VIEWS = [SIX_VIEW_WORDS.front, SIX_VIEW_WORDS.back, SIX_VIEW_WORDS.left, SIX_VIEW_WORDS.right, SIX_VIEW_WORDS.top, SIX_VIEW_WORDS.quarter] as const
export const SHEET_COLUMNS = 3
export const SHEET_ROWS = 2

/** Whether a sheet is the six views laid out in a grid (the maker's look, the reviewer's set, or the shape alone), so one view of it can be cut out. */
export const isViewSheet = (label: string) => label.startsWith("六个角度") || label === "只看形状"

/** The earlier round to hold a round against: the nearest one before it that has pictures. */
export function roundBefore(rounds: readonly MakingRound[], round: MakingRound | undefined) {
  const at = round ? rounds.indexOf(round) : -1
  return at > 0 ? rounds.slice(0, at).filter((value) => value.pictures.length).at(-1) : undefined
}

/** The sheets both rounds have, by label, in the order the later round lists them. */
export function sharedSheets(before: MakingRound | undefined, after: MakingRound | undefined) {
  if (!before || !after) return []
  return after.pictures.filter((picture) => before.pictures.some((value) => value.label === picture.label)).map((picture) => picture.label)
}

/** The picture of a round by its exact label; none when the round has no such sheet (never another one in its place). */
export const sheetOf = (round: MakingRound | undefined, label: string) => round?.pictures.find((picture) => picture.label === label)

/** Where one cell of a sheet lies, as the offsets of the whole sheet shown three times as wide and twice as high. */
export const cellOffset = (index: number) => ({ left: `${-(index % SHEET_COLUMNS) * 100}%`, top: `${-Math.floor(index / SHEET_COLUMNS) * 100}%` })

/** What to show of one sheet: the label to use (the one asked for if both rounds have it, else the first they share) and the cell, only on a sheet that has views. */
export function choose(shared: readonly string[], label: string, cell: number | null) {
  const using = shared.includes(label) ? label : (shared[0] ?? "")
  return { label: using, cell: using && isViewSheet(using) && cell !== null && cell >= 0 && cell < SHEET_VIEWS.length ? cell : null }
}
