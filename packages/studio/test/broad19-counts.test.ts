import { expect, test } from "bun:test"
import { MAKING_LIMITS } from "@minemods/studio-ai/making"
import { KEPT_WORDS } from "@minemods/mod-core/asset-status"
import type { OverviewItem, OverviewStatus } from "../src/api"
import { assetCheck } from "../src/renderer/features/asset-check"
import { doneLine, doneShare, heldHint, heldShare, heldWords, makeCount } from "../src/renderer/features/production-counts"
import { roundsExplained } from "../src/renderer/features/production-words"
import { floorRows } from "../src/renderer/features/making-floor-model"
import { WAITING_WORDS, waitingForYou } from "../src/renderer/features/waiting-for-you-model"
import { BOX_GUARD, IDS, sampleProject } from "../../mod-core/test/fixtures/gameplay/sample"

// Broad19: the overview counted a version that was kept although its independent review did not pass as "已做好", and the veteran could not tell
// what the checks measured or how 第 N 版, 最多 6 版 and 边做边看 relate. These tests keep the counts and the words in step.

const production = (rest: Partial<Parameters<typeof doneLine>[0]> = {}) => ({ total: 5, done: 3, remaking: 0, unsatisfied: 1, interrupted: 0, ...rest })

test("the strip, the road's 制作 stage and the bar all count the same done number, and the kept ones are said apart", () => {
  const counts = production({ done: 3, unsatisfied: 1, interrupted: 1 })
  expect(doneLine(counts)).toBe("已做好 3 / 5")
  expect(makeCount(counts)).toBe("3 / 5 · 1 样没通过审查 · 1 样被中断")
  expect(heldWords(counts)).toEqual([KEPT_WORDS.unsatisfied(1), KEPT_WORDS.interrupted(1)])
  expect(heldWords(counts)[0]).toContain("没通过审查")
  // The bar: green is what is done, amber is what is kept without a pass, and together they never pass the whole.
  expect(doneShare(counts) + heldShare(counts)).toBeCloseTo(1)
  expect(doneShare(counts)).toBeCloseTo(0.6)
  expect(heldHint(counts)).toContain("由你看了决定")
  // Nothing kept: no extra words, no hint, and the all-done sentence appears only when every saved thing is done.
  expect(heldWords(production({ unsatisfied: 0 }))).toEqual([])
  expect(heldHint(production({ unsatisfied: 0 }))).toBe("")
  expect(doneLine(production({ done: 5, unsatisfied: 0 }))).toBe("全部做好了，一共 5 样")
  // A kept version is saved, but five saved things with one kept are not "全部做好了".
  expect(doneLine(production({ done: 4, unsatisfied: 1 }))).toBe("已做好 4 / 5")
})

test("a kept version waits for the person with the others and is marked, not shown among the done", () => {
  const item = (id: string, status: OverviewStatus, more: Partial<OverviewItem> = {}) =>
    ({ id, key: id, asset_id: null, kind: "entity", title: id, brief: "", owner: null, status, status_label: status, reason: null, facts: {}, review_asked: false, review: null, preview: {}, needs: [], used_by: [], out_of_scope: null, revision: null, ...more }) as unknown as OverviewItem
  const rows = floorRows({ items: [item("fine", "saved"), item("boss", "review", { ai_unsatisfied: true }), item("cut", "review", { ai_interrupted: true })], kinds: [{ id: "entity", label: "生物" }], makings: {}, events: [], say: () => "" })
  const by = Object.fromEntries(rows.map((row) => [row.id, row]))
  expect(by.fine).toMatchObject({ state: "done", mark: "ok" })
  expect(by.boss).toMatchObject({ state: "review", mark: "warn" })
  expect(by.cut).toMatchObject({ state: "review", mark: "warn" })
  // The "waiting for you" line says how many of those were not passed, and the plain line is unchanged when none were.
  expect(WAITING_WORDS.review(3, 2)).toContain("其中 2 样")
  expect(WAITING_WORDS.review(3, 9)).toContain("其中 3 样")
  expect(WAITING_WORDS.review(3)).toBe("有 3 样做好了，等你验收。")
  const waiting = waitingForYou({ toReview: 3, keptReview: 2 } as never)
  expect(waiting.find((entry) => entry.kind === "review")?.text).toContain("其中 2 样")
})

test("the line under the rounds explains the three counts with the limits the code uses", () => {
  const line = roundsExplained(MAKING_LIMITS.rounds)
  expect(line).toContain(`最多 ${MAKING_LIMITS.rounds} 轮`)
  expect(line).toContain(`最多看 ${MAKING_LIMITS.glances} 次`)
  expect(line).toContain(`每一版最多 ${MAKING_LIMITS.own_glances} 次`)
  // Said in 版 where the screen counts 版, and without the glance sentence where the screen has no glances.
  expect(roundsExplained(6, { word: "版" })).toContain("最多 6 版")
  expect(roundsExplained(6, { word: "版", glances: false })).not.toContain("边做边看")
})

test("a passed check on the card says what each criterion measures and the numbers each passed rule read", () => {
  const tile = { id: "thing", asset_id: IDS.box_guard, kind: "gameplay", brief: "", needs: [], preview: { source: "none" }, judged: undefined } as never
  const check = assetCheck(sampleProject(), [{ id: "thing", asset_id: IDS.box_guard }], tile, { kind: "gameplay", document: BOX_GUARD, progress: null })!
  expect(check.criteria.length).toBe(6)
  check.criteria.forEach((criterion) => expect(criterion.measures.length).toBeGreaterThan(8))
  const ticked = check.criteria.filter((criterion) => criterion.state === "passed")
  expect(ticked.length).toBeGreaterThan(0)
  // A ticked criterion lists the rules that ran and passed on this very document, each with what it asked; a criterion that failed or was not measured lists none.
  ticked.forEach((criterion) => {
    expect(criterion.looked.length).toBeGreaterThan(0)
    criterion.looked.forEach((entry) => expect(entry.asks.length).toBeGreaterThan(0))
  })
  check.criteria.filter((criterion) => criterion.state !== "passed" && criterion.findings.length > 0).forEach((criterion) => expect(criterion.looked.every((entry) => !criterion.findings.some((finding) => finding.message === entry.asks))).toBe(true))
})
