import { expect, test } from "bun:test"
import { sheetReasons } from "@minemods/studio-ai/making"
import type { Making } from "../src/api"
import { assetCheck, type AssetCheck } from "../src/renderer/features/asset-check"
import { checkVersusReview } from "../src/renderer/features/asset-check-versus"
import { BAD, IDS, sampleProject } from "../../mod-core/test/fixtures/gameplay/sample"
import { bareHead } from "../../studio-ai/test/specimens"
import guardian from "../../studio-ai/test/fixtures/look/good/crystal-guardian.json"

// broad20: the machine check said 没通过 and the review beside it said 通过, and a paragraph of explanation was put between them. The cause was that the card judged without the reasons
// the gate had accepted the work on, and that a number which cannot tell a fault from a choice refused. Both are fixed at the root; what is left of the card is one sentence.
const tile = (kind: string, id: string | null = null) => ({ id: "thing", asset_id: id, kind, brief: "", needs: [], preview: { source: "none" }, judged: undefined }) as never
const failing = () => assetCheck(sampleProject(), [{ id: "thing", asset_id: IDS.box_guard }], tile("gameplay", IDS.box_guard), { kind: "gameplay", document: BAD.opens_socket, progress: null })!
const making = (review: Partial<NonNullable<Making["review"]>> | null): Pick<Making, "review"> => ({ review: review && { independent: true, passed: true, findings: [], at: "2026-10-19T00:00:00.000Z", round: 1, ...review } }) as never

test("机器检查没通过、审查通过：只说一句，把决定留给看图的人", () => {
  const check = failing()
  expect(check.passed).toBe(false)
  expect(checkVersusReview(check, making({}))).toBe("机器检查没通过，审查通过了：请看图自己决定。")
  // 做它的 AI 自己的判断叫「自己审查」。
  expect(checkVersusReview(check, making({ independent: false }))).toBe("机器检查没通过，自己审查通过了：请看图自己决定。")
})

test("只有「机器没通过、审查通过」才出这句话", () => {
  const check = failing()
  expect(checkVersusReview(check, making({ passed: false, findings: ["不行"] }))).toBeNull()
  expect(checkVersusReview(check, making(null))).toBeNull()
  expect(checkVersusReview(check, null)).toBeNull()
  expect(checkVersusReview({ ...check, passed: true }, making({}))).toBeNull()
  expect(checkVersusReview({ ...check, unreadable: { message: "读不了", fix: "换一张" } }, making({}))).toBeNull()
})

const model = (change: (design: typeof guardian.model) => unknown) => ({ kind: "model", ...(change(structuredClone(guardian.model)) as object) })
const checked = (document: unknown, justified: Parameters<typeof assetCheck>[4] = null): AssetCheck => assetCheck(sampleProject(), [{ id: "thing", asset_id: null }], tile("model"), { kind: "model", document, progress: null }, justified)!

test("卡片按制作的 AI 在部件说明里写的理由来查，和做的时候那道关一样：不会把它收下的东西又退一遍", () => {
  // A head with nothing on it, which its sheet says is meant (a turret): the gate accepted it on that reason.
  const bare = model((design) => bareHead(design as never))
  const withoutReason = checked(bare)
  expect(withoutReason.passed).toBe(false)
  expect(withoutReason.criteria.flatMap((entry) => entry.findings).map((finding) => finding.rule)).toContain("no_face")
  const sheet = { justified: [{ what: "no_face", reason: "它是一台炮台，转的只是炮管，没有脸" }], still: [] }
  const withReason = checked(bare, sheetReasons(sheet as never))
  expect(withReason.passed).toBe(true)
  expect(withReason.criteria.flatMap((entry) => entry.findings)).toEqual([])
  // The same list for the gate and the card: a motion the sheet declares still answers its rules too.
  expect(sheetReasons({ justified: [], still: [{ motion: "walk", reason: "固定的炮台" }] } as never)?.map((entry) => entry.what)).toContain("walk_legs_still")
  expect(sheetReasons({ justified: [], still: [] } as never)).toBeNull()
  expect(sheetReasons(null)).toBeNull()
})

test("找不到眼睛但头上有别的记号：卡片通过，只在这一条下面写一句建议，不当作通过的依据也不当作没通过", () => {
  const painted = model((design) => {
    const skull = (design as typeof guardian.model).bones.find((bone) => bone.name === "head")!.cubes[0]! as { features?: { type: string }[] }
    skull.features = skull.features!.filter((feature) => feature.type !== "eyes" && feature.type !== "brows")
    return design
  })
  const check = checked(painted)
  expect(check.passed).toBe(true)
  expect(check.found).toBe(0)
  const reads = check.criteria.find((entry) => entry.name === "认得出")!
  expect(reads.state).toBe("passed")
  expect(reads.findings).toEqual([])
  const face = reads.advice.filter((entry) => entry.rule === "no_face")
  expect(face).toHaveLength(1)
  expect(face[0]!.message).toContain("正面或两侧找到一对看得清的眼睛")
  expect(reads.looked.map((entry) => entry.rule)).not.toContain("no_face")
  // Nothing in the advice is a rule's name or a field's name.
  expect(face[0]!.message).not.toMatch(/no_face|justified|head\b/)
})
