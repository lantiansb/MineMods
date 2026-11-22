import { expect, test } from "bun:test"
import { begin, CARRIED, carriedOver, commitGate, describe, finalReview, fingerprint, looked, MakingRefusal, REFUSALS, sameFinding, selfReview, type MakingRecord } from "../src/making"

/**
 * A judgement that is made again of the version made to answer it stops blocking: the second time it is advice, said to have been said before. The first time it is held in full,
 * and so is anything new. It is the same for the maker's own self-review and for the reviewer, whatever they are about (a real run spent all six versions on one collision box).
 */
const sheet = {
  subject: "一只彩虹小鸡，敌对生物。",
  recognisable: ["一身彩虹色的羽毛", "红色的鸡冠", "一对小翅膀"],
  parts: [{ name: "body", what: "躯干", shape: "圆滚滚的方块，约 6×6×8 像素", attaches: "立在两条腿上", surface: "彩虹色羽毛", moves: "走路时左右微晃", assumed: false }],
  assumed: [],
}
const start = () => begin(null, { asset_id: "22222222-2222-4222-8222-222222222222", entry: "chick", kind: "model", request: "一只彩虹小鸡", brief: "彩虹小鸡的模型", task_id: "11111111-1111-4111-8111-111111111111", remark: null })
const version = (name: string) => fingerprint({ kind: "model", name })
const seen = (record: MakingRecord, name: string) => looked(record, { fingerprint: version(name), pictures: [{ label: "六个角度", file: `${record.rounds.length + 1}-a-0.jpg` }], findings: [] })
const refused = (step: () => unknown) => {
  try {
    step()
  } catch (error) {
    if (error instanceof MakingRefusal) return error.message
    throw error
  }
  return null
}
const done = { matches: ["每个部件都对上了"], problems: [], next: [], verdict: "done" as const }

// The kind of sentence a model reviewer writes about one thing in two successive versions: the numbers move, the words stay.
const box = "碰撞箱的箱子比身体大了一截：宽 0.6、高 0.9，视觉外伸约 0.17，空体积约 44%，头、翅膀和尾巴旁边都是空白，在碰撞箱图的第一格看出来。"
const boxAgain = "碰撞箱的箱子比身体大出一截：宽 0.6、高 0.9，视觉外伸约 0.15，空体积约 42%，头部、翅膀和尾巴旁边仍然是空白，在碰撞箱图的第一格看出来。"
const other = "左边的翅膀悬在身体外面，没有接在躯干上，在正面第二格看出来。"

test("两句话是不是同一个意见：数字变了不算，说的是另一件事才算不同；太短的句子要一字不差", () => {
  expect(sameFinding(box, boxAgain)).toBe(true)
  expect(sameFinding(box, other)).toBe(false)
  expect(sameFinding(box, `${CARRIED.reviewed}${boxAgain}`)).toBe(true)
  expect(sameFinding("头部悬空没接上", "翅膀悬空没接上")).toBe(false)
  expect(sameFinding("头部悬空没接上", "头部悬空没接上！")).toBe(true)
  expect(sameFinding("", "")).toBe(false)
})

test("自己审查的问题：第一次照旧挡住；改了一版还在，就不再挡住，留在建议里并写明上一版就提过；新的问题照旧挡住", () => {
  const first = seen(describe(start(), sheet), "a")
  // Said the first time: it holds, as it always did.
  expect(refused(() => selfReview(first, { ...done, problems: [box] }))).toBe(REFUSALS.done_with_problems)
  const revised = selfReview(first, { matches: [], problems: [box], next: ["把箱子改小"], verdict: "revise" })
  const second = seen(revised, "b")
  // Said again of the version made to answer it: it no longer holds the version back, and says so.
  const finished = selfReview(second, { ...done, problems: [boxAgain], advice: ["尾巴可以再翘一点"] })
  expect(finished.state).toBe("reviewing")
  const round = finished.rounds.at(-1)!.self_review!
  expect(round.problems).toEqual([])
  expect(round.advice).toEqual([`${CARRIED.own}${boxAgain}`, "尾巴可以再翘一点"])
  // Something new is held in full, and so is the repeat that sits beside it.
  expect(refused(() => selfReview(second, { ...done, problems: [boxAgain, other] }))).toBe(REFUSALS.done_with_problems)
  const mixed = selfReview(second, { matches: [], problems: [boxAgain, other], next: ["接上翅膀"], verdict: "revise" })
  expect(mixed.rounds.at(-1)!.self_review).toMatchObject({ problems: [other], advice: [`${CARRIED.own}${boxAgain}`] })
  // A third version that says it again is still the same: what was carried over stays carried over.
  const third = seen(mixed, "c")
  expect(selfReview(third, { ...done, problems: [box] }).rounds.at(-1)!.self_review).toMatchObject({ problems: [], advice: [`${CARRIED.own}${box}`] })
})

test("审查的意见：第一次照旧挡住；同一条意见改了一版还在，不再挡住，这一版过得去，并写明上一版就提过；换了一条新的就照旧挡住", () => {
  const finished = selfReview(seen(describe(start(), sheet), "a"), done)
  const failed = finalReview(finished, { passed: false, findings: [box], independent: true })
  expect(failed).toMatchObject({ state: "making", review: { passed: false, findings: [box] } })
  const next = selfReview(seen(failed, "b"), done)
  // The same opinion again of the version that answers it.
  const passed = finalReview(next, { passed: false, findings: [boxAgain], advice: ["可以更圆润一点"], independent: true })
  expect(passed.review).toMatchObject({ passed: true, findings: [], advice: [`${CARRIED.reviewed}${boxAgain}`, "可以更圆润一点"] })
  expect(passed.state).toBe("reviewing")
  expect(commitGate(passed, version("b"))).toBeNull()
  // A new opinion beside the repeat still fails it, and only the new one is held against the version.
  const held = finalReview(next, { passed: false, findings: [boxAgain, other], independent: true })
  expect(held.review).toMatchObject({ passed: false, findings: [other], advice: [`${CARRIED.reviewed}${boxAgain}`] })
  expect(commitGate(held, version("b"))).toBe(REFUSALS.review_failed)
  // The repeat is remembered through a version that failed for something else.
  const again = finalReview(selfReview(seen(held, "c"), done), { passed: false, findings: [box], independent: true })
  expect(again.review).toMatchObject({ passed: true, findings: [] })
  // A review that was passed with nothing, or failed with nothing, is judged as it always was.
  expect(refused(() => finalReview(next, { passed: false, findings: [], independent: true }))).toBe(REFUSALS.failed_without_findings)
  expect(refused(() => finalReview(next, { passed: true, findings: [boxAgain], independent: true }))).toBe(REFUSALS.passed_with_findings)
})

test("第一版被挡的意见，换到不相干的一版也不会被当成重复：只有上一版提过的才算", () => {
  const first = selfReview(seen(describe(start(), sheet), "a"), done)
  // No review before it: nothing is carried over, and a review that holds something fails.
  expect(finalReview(first, { passed: false, findings: [box], independent: true }).review).toMatchObject({ passed: false, findings: [box] })
  expect(carriedOver([], [box], "reviewed")).toEqual({ fresh: [box], carried: [] })
  expect(carriedOver([box], [other], "reviewed")).toEqual({ fresh: [other], carried: [] })
  // An advice line is never long enough to break the record's limit.
  const long = `${box}${"很长的话".repeat(200)}`
  expect(carriedOver([long], [long], "own").carried[0]!.length).toBeLessThanOrEqual(600)
})
