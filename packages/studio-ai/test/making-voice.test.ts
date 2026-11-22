import { expect, test } from "bun:test"
import { GLANCE_GUIDE, MAKING_DISCIPLINE, MAKING_DISCIPLINE_OWN, MAKING_LIMITS, MAKING_OWN_STEPS, MAKING_RULES, MAKER_INSTRUCTIONS, OWN_GLANCE_INSTRUCTIONS, ownWords, REFUSALS, SHEET_INSTRUCTIONS, TOOL_VOICE, GuidedSelfReviewSchema, SELF_REVIEW_INSTRUCTIONS, LookOptionsSchema } from "../src/making"

// Round 18. The making discipline was sent word for word to Studio's own AI, which cannot call a tool: Studio drives its steps.
// What is true for every maker is one text; what an outside AI calls, and how Studio's own AI is led, are the two things added to it.

/** The tools an outside AI drives the loop with. None of them exists for Studio's own AI or for the person. */
const TOOLS = /\b(look|glance|save_sheet|self_review|final_review|commit_task|fail_task|next_batch|save_concepts|claim_task|update_task)\b/

test("制作纪律分两种口气：共用的规则只有一份；给外部 AI 的那份讲工具，给 Studio 自己的 AI 的那份讲它的步骤，一个工具名都没有", () => {
  // One set of rules, with one thing put into it for each maker at the same place.
  expect(MAKING_DISCIPLINE.replace(GLANCE_GUIDE, "")).toBe(MAKING_RULES)
  expect(MAKING_DISCIPLINE_OWN.replace(MAKING_OWN_STEPS, "")).toBe(MAKING_RULES)
  expect(MAKING_DISCIPLINE).toContain(GLANCE_GUIDE)
  expect(MAKING_DISCIPLINE).toContain("look 加上 glance: true")
  expect(MAKING_DISCIPLINE).toContain(`一个任务可以看 ${MAKING_LIMITS.glances} 次`)
  // Studio's own AI: no tool, and none of the outside AI's counts.
  for (const name of ["look", "glance", "save_sheet", "self_review", "final_review", "commit_task", "fail_task", "next_batch"]) for (const text of [MAKING_RULES, MAKING_OWN_STEPS, MAKING_DISCIPLINE_OWN]) expect(text).not.toContain(name)
  for (const text of [MAKING_DISCIPLINE_OWN, SHEET_INSTRUCTIONS]) expect(text).not.toMatch(TOOLS)
  expect(MAKING_DISCIPLINE_OWN).not.toContain(`${MAKING_LIMITS.glances} 次`)
  expect(SHEET_INSTRUCTIONS).toContain(MAKING_DISCIPLINE_OWN)
  // What it is told instead: how its own steps go, with the numbers that are its own.
  for (const phrase of ["没有要你调用的东西", "Studio 先画给你看一眼", `一版最多这样看 ${MAKING_LIMITS.own_glances} 次`, `一版最多给 ${MAKING_LIMITS.own_motions} 个`, `点名要看（最多 ${MAKING_LIMITS.own_sees} 样）`, "这不算新的一版"]) expect(MAKING_OWN_STEPS).toContain(phrase)
  // The two voices say the same of a glance in the same words.
  for (const phrase of ["它画的图、量出来的毛病和正式看图完全一样，但不算一版、不用写自评、什么都不留下", "把看得出来的毛病（认不出、比例不对、朝向反了、脚没踩地、动作不对）在这里改掉"]) for (const text of [GLANCE_GUIDE, MAKING_OWN_STEPS, OWN_GLANCE_INSTRUCTIONS]) expect(text).toContain(phrase)
  // Both carry everything else: what is measured, the gates, the blind naming.
  for (const phrase of ["先大形后细节", "硬门槛：只能改掉，写理由不算", "验收时还有一道「盲认」", "没有参与制作的评审"]) for (const text of [MAKING_DISCIPLINE, MAKING_DISCIPLINE_OWN]) expect(text).toContain(phrase)
  // The limits of its own glances and looks, as numbers with a reason beside them in the source.
  expect(MAKING_LIMITS).toMatchObject({ own_glances: 2, own_sees: 2, own_motions: 3 })
})

test("拒绝的话分成两截：前一截谁都适用，后一截只说给会调用工具的 AI；Studio 自己的 AI 和人看到的只有前一截", () => {
  const said: Record<keyof typeof TOOL_VOICE, string> = {
    no_sheet: REFUSALS.no_sheet,
    no_look: REFUSALS.no_look,
    unseen: REFUSALS.unseen,
    no_self_review: REFUSALS.no_self_review(2),
    reviewed_already: REFUSALS.reviewed_already,
    not_done: REFUSALS.not_done,
    no_sheet_wanted: REFUSALS.no_sheet_wanted,
    render_failed: REFUSALS.render_failed("画的时候超时了。"),
    no_review: REFUSALS.no_review,
    no_document: REFUSALS.no_document,
    review_not_drawn: REFUSALS.review_not_drawn("画的时候超时了。"),
    kept: REFUSALS.kept(3),
    nothing_kept: REFUSALS.nothing_kept,
  }
  for (const [key, words] of Object.entries(said) as [keyof typeof TOOL_VOICE, string][]) {
    // The outside AI is told the whole of it, as before; the tail is the end of it.
    expect(words).toEndWith(TOOL_VOICE[key])
    const own = ownWords(words)
    expect(`${own}${TOOL_VOICE[key]}`).toBe(words)
    expect(own).not.toMatch(TOOLS)
    expect(own).not.toMatch(/调用|再看一次/)
    // What is left is a sentence of its own.
    expect(own).toEndWith("。")
    expect(own.length).toBeGreaterThan(6)
  }
  expect(ownWords(REFUSALS.render_failed("画的时候超时了。"))).toBe("这一次没有看成：画的时候超时了。")
  expect(ownWords(REFUSALS.review_not_drawn("画的时候超时了。"))).toBe("验收用的图没有画出来：画的时候超时了。")
  expect(ownWords(REFUSALS.nothing_kept)).toBe("没有一版可以留下：要么一版都没看过，要么每一版都有量得出来的硬伤。这个任务记为没做成，工程里什么都没有改动。")
  // A refusal with nothing for a tool-calling AI in it is the same for everyone, and so are words that are not a refusal.
  for (const words of [REFUSALS.unchanged, REFUSALS.out_of_rounds(6), REFUSALS.review_failed, "模型没有交出模型：script 和 document 都是空的。"]) expect(ownWords(words)).toBe(words)
})

test("Studio 自己的 AI 的眼睛：看一眼以后回答留着还是改；自评里可以点名再看两样；一次看图可以要某一面的大图", () => {
  for (const phrase of ["keep 写 false，revised 照平常交一版的格式写改好的整版", "keep 写 true，revised 写 null", "glance.left"]) expect(OWN_GLANCE_INSTRUCTIONS).toContain(phrase)
  expect(OWN_GLANCE_INSTRUCTIONS).not.toMatch(/\b(look|save_sheet|self_review|final_review|commit_task|fail_task|next_batch)\b/)
  // `see`: always asked for, at most two, and an answer from before it existed reads as nothing asked.
  const review = { matches: [], problems: [], advice: [], next: [], verdict: "done", look_closer: null, watch: null, declare: null }
  expect(GuidedSelfReviewSchema.parse(review).see).toEqual([])
  expect(GuidedSelfReviewSchema.parse({ ...review, see: [{ what: "motion", name: "walk" }, { what: "angle", name: "back" }] }).see).toHaveLength(2)
  expect(GuidedSelfReviewSchema.safeParse({ ...review, see: [{ what: "motion", name: "a" }, { what: "close_up", name: "b" }, { what: "angle", name: "c" }] }).success).toBe(false)
  for (const phrase of [`写进 see，最多 ${MAKING_LIMITS.own_sees} 样`, "seen_more", "motions_not_shown", "这不算新的一版"]) expect(SELF_REVIEW_INSTRUCTIONS).toContain(phrase)
  expect(LookOptionsSchema.parse({ angle: "back" })).toEqual({ angle: "back" })
  expect(MAKER_INSTRUCTIONS).not.toContain("save_sheet")
})
