/**
 * How a brief (what a thing is to be made as) is laid out for reading: a short headline, then one point per sentence,
 * with the names of motions or parts the brief explains in brackets (「idle（轻微探头、嗅闻）」) lifted out as chips.
 * Pure and lossless: every character of the brief is still shown, only arranged; nothing is summarised or guessed.
 */
export type BriefPiece = { text: string } | { name: string; says: string }
export type BriefLayout = { head: string | null; points: BriefPiece[][] }

// A headline is the part before the first colon when that part is short enough to read at a glance as a title.
const HEAD_MOST = 24
// A name explained in full-width brackets right after it: a motion, part or state the brief means by that word.
const NAMED = /([A-Za-z][A-Za-z0-9_]*)（([^（）]{1,60})）/g
// What stands between chips in a list of them, which the chips replace.
const JOINER = /^[\s、，,和及与以及]*$/

export function briefLayout(brief: string): BriefLayout {
  const text = brief.replace(/\s+/g, " ").trim()
  const colon = text.search(/[：:]/)
  const head = colon > 0 && colon <= HEAD_MOST ? text.slice(0, colon).trim() : null
  const rest = head ? text.slice(colon + 1) : text
  const sentences = rest
    .split(/(?<=[。；;！!？?])/)
    .map((part) => part.trim())
    .filter((part) => part.replace(/[。；;！!？?\s]/g, "").length > 0)
  return { head, points: sentences.map(piecesOf) }
}

function piecesOf(sentence: string): BriefPiece[] {
  const pieces: BriefPiece[] = []
  let at = 0
  for (const match of sentence.matchAll(NAMED)) {
    const before = sentence.slice(at, match.index)
    if (before) pieces.push({ text: before })
    pieces.push({ name: match[1]!, says: match[2]! })
    at = match.index! + match[0].length
  }
  if (at < sentence.length) pieces.push({ text: sentence.slice(at) })
  // Between two chips only a joining word stood ("、", "和"): the chips say it on their own.
  return pieces.filter((piece, index) => !("text" in piece) || !JOINER.test(piece.text) || !("name" in (pieces[index - 1] ?? {})) || !("name" in (pieces[index + 1] ?? {})))
}

/** Every character of the brief that is not layout: what a test checks is kept. */
export const briefChars = (layout: BriefLayout) =>
  (layout.head ?? "") + layout.points.flat().map((piece) => ("text" in piece ? piece.text : piece.name + piece.says)).join("")
