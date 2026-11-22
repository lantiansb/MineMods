import { expect } from "bun:test"
import type { ModGuide } from "../../src/guide"
import { identifiersIn } from "../../src/play-words"

/**
 * Round 17: nothing a person reads in the guide's normal view is a piece of code. Every line of every section (the markdown is the same lines)
 * is held to the one pattern list of `play-words.ts`; a command stands between backticks and a file name is a file name, so neither counts.
 * What is left over is reported with the line it is in, so a leak names itself.
 */
export function expectPlainGuide(guide: Pick<ModGuide, "sections" | "markdown">) {
  const leaks = guide.sections.flatMap((section) => section.lines.flatMap((line) => identifiersIn(line.text).map((found) => `${section.title}：${found}（${line.text.slice(0, 40)}…）`)))
  expect(leaks).toEqual([])
  expect(identifiersIn(guide.markdown)).toEqual([])
}
