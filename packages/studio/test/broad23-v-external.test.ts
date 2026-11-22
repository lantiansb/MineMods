import { expect, test } from "bun:test"
import { StudioRequestSchema } from "../src/main/protocol"
import { SENTENCE_REFUSALS, askedWords, whereTheyPart } from "../../mod-core/src/blueprint-ideas"
import { buildMcpHandoff, carryRequest } from "../src/main/mcp-handoff"
import { askForPlan, handSentence, handoffRequest, pendingSentence, writeSentence } from "../src/renderer/pending-sentence"
import { zoomedRound } from "../src/renderer/features/story-zoom"
import { COPIED_HOLD_MS, copyButtonWords, reviewCopyWords } from "../src/renderer/features/settings-words"

const configuration = JSON.stringify({ mcpServers: { "minemods-studio": { command: "studio.exe", args: ["mcp-stdio.js"] } } })
const project = { id: "842db5af-c5b8-4e6b-87f3-9cd104fe7af3", name: "月光森林" }

test("连 AI 之前写下的需求：随做东西的 AI 的起步说明一起复制，写在说明最前面", () => {
  writeSentence(project.id, "  做一把能冻住敌人的霜角剑，再加一个冰原 Boss  ")
  expect(pendingSentence(project.id)).toBe("做一把能冻住敌人的霜角剑，再加一个冰原 Boss")
  const asked = handoffRequest(project, "maker")
  expect(asked.request).toContain("做一把能冻住敌人的霜角剑，再加一个冰原 Boss")
  // The same words the 「直接做（复制）」 button puts in front of its instruction: one source, one wording.
  expect(asked.request).toBe(askForPlan(project.name, "做一把能冻住敌人的霜角剑，再加一个冰原 Boss"))
  const handoff = buildMcpHandoff({ configuration, project: { ...project, revision: 1 }, review: true })
  const copied = carryRequest(handoff, { role: asked.role, request: asked.request, ifNoPlan: asked.ifNoPlan, planned: false })
  expect(copied.startsWith("请给 MineMods 工程「月光森林」做一份蓝图")).toBe(true)
  expect(copied).toContain("我想做的模组：做一把能冻住敌人的霜角剑，再加一个冰原 Boss")
  expect(copied.endsWith(handoff)).toBe(true)
})

test("需求没带的几种情况：已经交给过 AI、工程里已经有蓝图、审查的 AI、什么也没写", () => {
  writeSentence(project.id, "做一把霜角剑")
  const handoff = "起步说明"
  const maker = handoffRequest(project, "maker")
  // A plan already stands on the words: carrying them again would have an AI draw it again over what the person is looking at.
  expect(carryRequest(handoff, { ...maker, planned: true })).toBe(handoff)
  // The reviewer judges what is made; it is never given the person's wishes to make from.
  expect(handoffRequest(project, "reviewer")).toEqual({ role: "reviewer" })
  expect(carryRequest(handoff, { role: "reviewer", request: "做一把霜角剑", planned: false })).toBe(handoff)
  // Handed to an AI already (the buttons on the project page): not carried a second time.
  handSentence(project.id)
  expect(pendingSentence(project.id)).toBe("")
  expect(handoffRequest(project, "maker")).toEqual({ role: "maker" })
  // Written anew, it is pending again; empty or blank words carry nothing; no project, nothing.
  writeSentence(project.id, "   ")
  expect(handoffRequest(project)).toEqual({})
  writeSentence(project.id, "再做一只鹿")
  expect(handoffRequest(null)).toEqual({})
  expect(handoffRequest(project).request).toContain("再做一只鹿")
})

test("蓝图被退回的提示：两段话开头一样、只有结尾不同，也能看出差在哪里", () => {
  const held = "做一个冰原主题的模组：有一把霜角剑，能冻住敌人；有一个冰原 Boss，会冲撞和放冰刺；Boss 死后掉落一块霜角"
  const asked = `${held}，另外只在生存模式生效，创造模式不要触发`
  const part = whereTheyPart(held, asked)
  // Cut from the front the two would be the same sixty characters; now each is the stretch around where they part.
  expect(part.held).not.toBe(part.asked)
  expect(part.asked).toContain("只在生存模式生效")
  expect(part.held).not.toContain("生存模式")
  const said = SENTENCE_REFUSALS.person(held, asked)
  expect(said).toContain("只在生存模式生效")
  expect(said).toContain("在 Studio 蓝图页的「你说的要求」里加一条")
  // The old sentence is replaced, not joined by a second one.
  expect(said).not.toContain("都没有被动过")
})

test("蓝图被退回的提示：中间被改的地方只显示那一段和前后各一小段；两边不会再从开头一起截断", () => {
  const front = "做一个冰原主题的模组，需要很多很多东西，比如剑、盔甲、方块、配方，"
  const back = "最后把它们全部放进一个宝箱，宝箱放在村庄里，村民会拿它们交易"
  const part = whereTheyPart(`${front}颜色只能是白色，${back}`, `${front}颜色只能是红色，${back}`)
  expect(part.held).toContain("白")
  expect(part.asked).toContain("红")
  expect(part.held.startsWith("…")).toBe(true)
  expect(part.held.endsWith("…")).toBe(true)
  expect(part.held.length).toBeLessThan(40)
  // Spaces and quote marks are not what differs: they are set aside the way the lock reads the words.
  expect(whereTheyPart("做 一朵“花”，颜色白色", "做一朵花，颜色红色")).toMatchObject({ held: "做一朵花，颜色白色", asked: "做一朵花，颜色红色" })
})

test("蓝图被退回：不是同一句话时，拿最接近的那段原话来比，补充的话不算数", () => {
  const request = "做一朵花，颜色只能是白色，不要带刺"
  const summary = "一朵白色的、不带刺的花，花瓣最多五片"
  const refused = askedWords([summary, request], `${request}，其实红色也行`)
  expect("person" in refused && refused.person).toContain("其实红色也行")
  expect("person" in refused && refused.person).toContain("不要带刺")
  expect("person" in refused && refused.person).not.toContain("花瓣最多五片")
  expect(askedWords([request], `${request}。`)).toEqual({ request })
})

test("放大图：新的一轮交上来、检查结果写进来、这一轮没有图，放大的那一轮都还在；只有它所在的那一轮没有了才关", () => {
  const rounds = [
    { round: 1, at: "2026-10-19T10:00:00.000Z", pictures: [{ label: "front" }] },
    { round: 2, at: "2026-10-19T10:05:00.000Z", pictures: [{ label: "front" }] },
  ]
  const zoom = { round: 1, at: rounds[0]!.at }
  expect(zoomedRound(zoom, rounds)?.round).toBe(1)
  // An outside AI hands in round 3 and its own check lands on round 2: round 1 is where it was.
  const later = [...rounds.map((value) => ({ ...value })), { round: 3, at: "2026-10-19T10:10:00.000Z", pictures: [{ label: "front" }] }]
  expect(zoomedRound(zoom, later)?.round).toBe(1)
  // A read that caught the round without its pictures does not take the round away.
  expect(zoomedRound(zoom, [{ ...rounds[0]!, pictures: [] }, rounds[1]!])?.round).toBe(1)
  // A redo starts a new making numbered from 1 again: the same number there is another picture, so the old one is gone.
  expect(zoomedRound(zoom, [{ round: 1, at: "2026-10-19T11:00:00.000Z", pictures: [{ label: "front" }] }])).toBeUndefined()
  expect(zoomedRound(zoom, [])).toBeUndefined()
  expect(zoomedRound(null, rounds)).toBeUndefined()
})

test("复制按钮：连接以后还没复制过，不说「再次」；复制成功先说「已复制」，过几秒才变回可以再点的字样", () => {
  const base = { enabled: false, copied: false, justCopied: false, reviewing: true }
  expect(copyButtonWords(base)).toBe("复制给我的 AI")
  expect(copyButtonWords({ ...base, reviewing: false })).toBe("复制给我的 AI")
  // One-click connection enabled the outside AI but copied nothing.
  expect(copyButtonWords({ ...base, enabled: true })).toBe("复制给做东西的 AI")
  expect(copyButtonWords({ ...base, enabled: true, reviewing: false })).toBe("复制起步说明")
  expect(copyButtonWords({ ...base, enabled: true, copied: true, justCopied: true })).toBe("已复制")
  expect(copyButtonWords({ ...base, enabled: true, copied: true })).toBe("再次复制（做东西的 AI）")
  expect(copyButtonWords({ ...base, enabled: true, copied: true, reviewing: false })).toBe("再次复制起步说明")
  expect(reviewCopyWords({ copied: false, justCopied: false })).toBe("复制给审查的 AI")
  expect(reviewCopyWords({ copied: true, justCopied: true })).toBe("已复制")
  expect(reviewCopyWords({ copied: true, justCopied: false })).toBe("再次复制（审查的 AI）")
  expect(COPIED_HOLD_MS).toBeGreaterThanOrEqual(2000)
  expect(COPIED_HOLD_MS).toBeLessThanOrEqual(5000)
})

test("起步说明只有复制那一条路带需求，并且能说明「已有蓝图就不带」；看说明那一条仍然不收需求", () => {
  const request = "请给 MineMods 工程「月光森林」做一份蓝图"
  expect(StudioRequestSchema.safeParse({ method: "copyMcpHandoff", input: { projectId: project.id, request, ifNoPlan: true } }).success).toBe(true)
  expect(StudioRequestSchema.safeParse({ method: "getMcpHandoff", input: { projectId: project.id, request } }).success).toBe(false)
})
