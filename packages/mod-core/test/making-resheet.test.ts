import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { begin, commitGate, describe, finalReview, fingerprint, looked, lookGate, makingVersion, MakingRefusal, readBest, REFUSALS, selfReview, writeBest, type MakingRecord } from "../src/making"

/**
 * r29c 乙 第 5 件 (a shared wind trail, r28): its first sheet described a part wrongly and the reviewer failed it for that. The document had to stay letter for letter what another
 * project has (so an import merges the two), so only the sheet was mended; the look at the same document was the same version, and its self-review was refused 「这一版已经有独立验收的结论了」.
 * A sheet rewritten after a failed review now makes the same document a new version: a round of its own, reviewed again.
 */

const sheet = {
  subject: "一道淡青色的风痕，烛龙章共用的效果。",
  recognisable: ["细长的青色弧线", "尾端渐隐"],
  parts: [{ name: "arc", what: "弧线", shape: "细长弯弧，约 3 格长", attaches: "从出手处甩出", surface: "淡青半透明", moves: "向前甩出后消散", assumed: false }],
  assumed: [],
}
const mended = { ...sheet, parts: [{ ...sheet.parts[0]!, shape: "细长弯弧，约 2 格长，两头尖" }] }
const document = { kind: "effect", name: "风痕" }
const revise = { matches: ["弧线对"], problems: ["尾端太硬"], next: ["尾端改淡"], verdict: "revise" as const }
const done = { matches: ["每个部件都对上了"], problems: [], next: [], verdict: "done" as const }
const refused = (step: () => unknown) => {
  try {
    step()
  } catch (error) {
    if (error instanceof MakingRefusal) return error.message
    throw error
  }
  return null
}
const look = (record: MakingRecord) => looked(record, { fingerprint: makingVersion(record, document), pictures: [{ label: "六个角度", file: `${record.rounds.length + 1}-a-0.jpg` }], findings: [] })
const failed = () => {
  const described = describe(begin(null, { asset_id: "22222222-2222-4222-8222-222222222222", entry: null, kind: "effect", request: "风痕", brief: "风痕", task_id: "11111111-1111-4111-8111-111111111111", remark: null }), sheet)
  return finalReview(selfReview(look(described), done), { passed: false, findings: ["说明写的是 3 格长，图里只有 2 格"], independent: true })
}

test("a sheet rewritten after a failed review makes the same document a new version, reviewed again", () => {
  const before = failed()
  expect(makingVersion(before, document)).toBe(fingerprint(document))
  // As it was: the same document under the same sheet is the round that was concluded on.
  expect(refused(() => selfReview(look(before), done))).toBe(REFUSALS.reviewed_already)
  const resheeted = describe(before, mended)
  expect(resheeted.resheet).toBe(fingerprint(resheeted.sheet))
  expect(makingVersion(resheeted, document)).not.toBe(fingerprint(document))
  expect(lookGate(resheeted, makingVersion(resheeted, document)).opens).toBe(true)
  const again = look(resheeted)
  expect(again.rounds.map((round) => round.round)).toEqual([1, 2])
  // The hand-in waits for this round's own review; the failed one was of the version before.
  expect(commitGate(again, makingVersion(again, document))).toBe(REFUSALS.no_self_review(2))
  const reviewed = finalReview(selfReview(again, done), { passed: true, findings: [], independent: true })
  expect(commitGate(reviewed, makingVersion(reviewed, document))).toBeNull()
  // The document's own fingerprint is no longer the version reviewed.
  expect(commitGate(reviewed, fingerprint(document))).toBe(REFUSALS.unseen)
  // Each rewrite after a failure costs a round, as a changed document does: it cannot be reviewed again for nothing.
  expect(again.rounds_allowed).toBe(before.rounds_allowed)
})

test("a sheet rewritten with no failed review on record, or rewritten to say the same, changes nothing", () => {
  const described = describe(begin(null, { asset_id: "22222222-2222-4222-8222-222222222222", entry: null, kind: "effect", request: "风痕", brief: "风痕", task_id: "11111111-1111-4111-8111-111111111111", remark: null }), sheet)
  const making = selfReview(look(described), revise)
  expect(describe(making, mended).resheet).toBeUndefined()
  expect(describe(failed(), sheet).resheet).toBeUndefined()
  const passed = finalReview(selfReview(look(described), done), { passed: true, findings: [], independent: true })
  expect(describe(passed, mended).resheet).toBeUndefined()
})

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

test("the best version kept under a rewritten sheet is read back", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "minemods-resheet-"))
  roots.push(directory)
  const record = look(describe(failed(), mended))
  const version = makingVersion(record, document)
  await writeBest(directory, record.asset_id, { task_id: record.task_id!, fingerprint: version, document, resheet: record.resheet })
  expect(await readBest(directory, { ...record, best: { round: 2, fingerprint: version } })).toEqual(document)
})
