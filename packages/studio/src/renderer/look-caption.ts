/**
 * How the sentences written under a picture of a look are laid out: wrapped to the cell's width, in rows of `CAPTION.row` pixels on a band that is
 * `CAPTION.pad` pixels taller than its rows, and held to a share of the cell's height. Plain arithmetic over a width measure, so the page that draws (`look.ts`) and a
 * test that has no canvas read the same layout.
 */

/** Pixels a row of text takes, and the band's own padding under the last row (the same two numbers the band is drawn with). */
export const CAPTION = { row: 22, pad: 8, share: 0.4 } as const

/**
 * A caption never covers more than 40% of its cell's height. A picture is framed so that the thing fills the cell (`lookCamera`, a tenth of margin), so a
 * band across the foot of the cell hides the lowest part of the thing in proportion to its height. The cell is there to show the creature (or what is under test)
 * first: with the band at two fifths, the upper three fifths are always clear and the thing is still read from its upper body and its outline; a band that grew
 * with the text covered the whole cell (a creature with four long sentences under it was only text). What does not fit is not lost: every sentence of a caption is
 * also in the look's notes, which say them in full, and the last row says how many were left to the notes.
 */
export const captionRows = (height: number) => Math.max(1, Math.floor((height * CAPTION.share - CAPTION.pad) / CAPTION.row))

export type CaptionRow = { text: string; sentence: number }

/**
 * The rows a caption is drawn in: each sentence wrapped letter by letter to `width` (a row is as many letters as `measure` says fit), at most `captionRows(height)` of them.
 * When more were wanted, the rows past the cap are cut and the last kept row ends with 「……其余 N 句见说明」, N being the sentences not shown whole (one cut in the middle is
 * not said in full either); the row's own text gives up as many letters at its end as the sentence needs to fit.
 */
export function captionLayout(caption: readonly string[], width: number, height: number, measure: (text: string) => number): CaptionRow[] {
  const rows = caption.flatMap((line, sentence) => [...line].reduce<string[]>((made, letter) => (measure(made.at(-1)! + letter) > width ? [...made, letter] : [...made.slice(0, -1), made.at(-1)! + letter]), [""]).map((text): CaptionRow => ({ text, sentence })))
  const most = captionRows(height)
  if (rows.length <= most) return rows
  const kept = rows.slice(0, most)
  const last = kept.at(-1)!
  const later = caption.length - 1 - last.sentence
  // The sentence of the last kept row is shown whole only if it ends on this row and the mark fits behind it without taking letters away.
  const whole = rows[most]!.sentence !== last.sentence && measure(`${last.text}……其余 ${later} 句见说明`) <= width
  const mark = `……其余 ${later + (whole ? 0 : 1)} 句见说明`
  const letters = [...last.text]
  const text = letters.map((_, index) => letters.slice(0, letters.length - index).join("")).find((prefix) => measure(prefix + mark) <= width) ?? ""
  return [...kept.slice(0, -1), { text: text + mark, sentence: last.sentence }]
}

/** The band's height in pixels for `rows` rows: the rows and the padding under the last one (the two numbers it is drawn with). */
export const captionBand = (rows: number) => rows * CAPTION.row + CAPTION.pad

/**
 * The part of a cell the 3D picture is drawn in when a caption of `rows` rows lies over the foot of the cell: the cell's whole width and the height above the band. A camera that
 * frames the thing for a whole cell frames it for any picture of the same view angle, whatever its size: the lens's field of view is vertical (`LENS`), so a shorter picture shows the
 * same stretch of the world in fewer pixels, and a picture wider than high (it only gets wider) shows at least the same width. So the one camera of a cell (`lookCamera`)
 * stays the camera when the picture is drawn into this part: everything it frames lies above the band, scaled down by this part's share of the cell's height. A cell with no caption
 * (`rows` 0) is its whole self, the same numbers, so nothing is drawn differently there. At least a pixel stays free: the band is held to a share of the cell (`captionRows`), so only a cell too small to hold a row can come to that.
 */
export const pictureSize = (size: readonly [number, number], rows: number): [number, number] => (rows > 0 ? [size[0], Math.max(1, size[1] - captionBand(rows))] : [size[0], size[1]])
