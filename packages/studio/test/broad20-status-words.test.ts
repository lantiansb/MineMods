import { expect, test } from "bun:test"
import { KEPT_WORDS, keptEach } from "@minemods/mod-core/kept-words"
import { STEP_WORDS } from "@minemods/mod-core/refusal-words"
import type { ActivityEvent } from "../src/api"
import { toastOf } from "../src/renderer/features/advancement"
import { ROUND_WORDS, roundVerdict } from "../src/renderer/features/making-floor-model"
import { leftWords, WALK_WORDS } from "../src/renderer/features/production-counts"
import { WAITING_WORDS, waitingForYou } from "../src/renderer/features/waiting-for-you-model"

// Broad20: a kept version said 「做好了：是」 on its card while the banner said the AI was not satisfied, the entry did not say how many were not,
// 「都看完了」 read as the whole project, and a toast said 「验收通过」 about what only an AI had reviewed.

test("a kept version is said the same way on the entry, the line that waits for you and the card", () => {
  // The entry and the 制作现场 line use one sentence for how many of the waiting ones were not passed.
  expect(KEPT_WORDS.among(1, 1)).toBe("其中 1 样 AI 自己还不满意，或者没做完审查")
  expect(KEPT_WORDS.among(2, 9)).toContain("其中 2 样")
  const waiting = waitingForYou({ blueprint: null, madeCount: 3, ideasWaiting: false, toReview: 1, keptReview: 1, external: true, running: false })
  expect(waiting[0]!.text).toBe(`有 1 样等你验收，${KEPT_WORDS.among(1, 1)}。`)
  expect(WAITING_WORDS.review(2)).toBe("有 2 样做好了，等你验收。")
  // The card's 「做好了」 never says 「是」 for a kept version: it uses the strip's words with the count taken off.
  expect(keptEach({ ai_unsatisfied: true })).toBe("留了一版但没通过审查")
  expect(KEPT_WORDS.unsatisfied(1)).toContain(KEPT_WORDS.each.unsatisfied)
  expect(KEPT_WORDS.interrupted(1)).toContain(KEPT_WORDS.each.interrupted)
  // A cut-short making is never called unsatisfied, even if both marks are on.
  expect(keptEach({ ai_unsatisfied: true, ai_interrupted: true })).toBe(KEPT_WORDS.each.interrupted)
  expect(keptEach({})).toBeNull()
})

test("the end of a walk names the batch and counts what the project still has open, only the non-zero", () => {
  expect(WALK_WORDS.done(3)).toBe("这次打开的 3 样看完了")
  expect(WALK_WORDS.done(3)).not.toContain("都看完了")
  expect(leftWords({ making: 3, remaking: 1, to_review: 2, to_redo: 1 })).toEqual(["还在做 2 样", "等你验收 2 样", "重做中 2 样"])
  expect(leftWords({ making: 0, remaking: 0, to_review: 1, to_redo: 0 })).toEqual(["等你验收 1 样"])
  expect(leftWords({ making: 0, remaking: 0, to_review: 0, to_redo: 0 })).toEqual([])
  expect(WALK_WORDS.left(["还在做 2 样", "重做中 1 样"])).toBe("工程里还剩：还在做 2 样、重做中 1 样。")
})

test("a toast about another AI's review never says 验收 as if it were the person's", () => {
  const review = { seq: 1, kind: "review", mark: "ok", end: true, text: "评审通过了第 2 版。", title: "蓝晶剑", round: 2 } as unknown as ActivityEvent
  const toast = toastOf(review)!
  expect(toast.head).toBe("AI 审查通过，等你验收")
  const caught = toastOf({ seq: 2, kind: "task", mark: "fail", end: false, text: "没通过", title: "蓝晶剑" } as unknown as ActivityEvent)!
  // 「验收」 appears only where it is the person's turn.
  expect(caught.name).not.toContain("验收")
  expect(`${toast.head}${toast.name}`.replace("等你验收", "")).not.toContain("验收")
})

test("what an AI or a machine judged is never worded as 验收, which is only the person's own verdict", () => {
  // Another AI's review, the maker's own review and the step names on 制作现场 say 审查, never 验收. The activity lines are held in mod-core's activity test.
  expect(Object.values(ROUND_WORDS).join("")).not.toContain("验收")
  expect(ROUND_WORDS.pass).toBe("审查通过")
  expect(ROUND_WORDS.self_pass).toContain("自己审查")
  const round = { round: 1, at: "2026-01-01T00:00:00Z", pictures: [], findings: [], self_review: null } as never
  const said = [
    { independent: true, passed: true },
    { independent: false, passed: true },
    { independent: true, passed: false },
  ].map((review) => roundVerdict({ rounds: [round], review: { ...review, findings: [], at: "2026-01-01T00:00:01Z", round: 1 } } as never, round))
  expect(said.map((value) => `${value.words}${value.short}`).join("")).not.toContain("验收")
  expect(Object.values(STEP_WORDS).join("")).not.toContain("验收")
})
