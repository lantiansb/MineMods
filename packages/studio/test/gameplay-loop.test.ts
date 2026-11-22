import { afterEach, expect, test } from "bun:test"
import { untilObserved } from "./observed"
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readActivity } from "@minemods/mod-core/activity"
import { GAMEPLAY_LIMITS, findingLine, gameplaySheet, type GameplayDocument } from "@minemods/mod-core/gameplay"
import { compileGameplayCandidate, forgetCompiled, REUSED_NOTE, type CodeCompiler, type CompileResult } from "@minemods/mod-core/gameplay-compile"
import { readGameplay } from "@minemods/mod-core/gameplay-loop"
import { GAMEPLAY_GENERATED_REVIEW, GAMEPLAY_DISCIPLINE, GAMEPLAY_FORM_EXAMPLE, GAMEPLAY_NO_GAME_WORDS, GAMEPLAY_REFUSALS, gameplayOwnWords, GAMEPLAY_REVIEWER_HANDOFF, GAMEPLAY_REVIEWER_INSTRUCTIONS, GAMEPLAY_SHEET_INSTRUCTIONS, GAMEPLAY_WRITER_INSTRUCTIONS } from "@minemods/mod-core/gameplay-words"
import { REFUSALS, SaveRefusal, UNSATISFIED } from "@minemods/mod-core/making"
import { openProject, saveProject } from "@minemods/mod-core/project"
import { MODULES } from "@minemods/mod-core/workspace"
import { createProjectRunner, INSPECTION_WORDS } from "../src/main/project-runner"
import { dispatchExternal, externalError, refusedWords } from "../src/main/external-dispatch"
import { createStudioService } from "../src/main/service"
import type { ExternalStartResult, ExternalTaskContext } from "../src/external"
import { createGameplayLoop, GAMEPLAY_AGAIN_APART, GAMEPLAY_CHECK_FRESH_MS, GAMEPLAY_SHEET_CHANGE_REFUSED, gameplayStep, type GameplayCompile, type WaitForGameplayCheck } from "../src/main/gameplay-loop"
import { CALL_MARGIN_MS, CHECK_CALLING, CHECK_STAGES, CHECK_TIMING, CLIENT_CALL_MS, COMPILE_COLD_LINE, type CheckTiming } from "../src/main/check-calling"
import { CHECK_NETWORK_WORDS } from "@minemods/mod-core/gradle-network"
import { gameplayCapability, MCP_GAMEPLAY_ENDINGS, MCP_GAMEPLAY_REFUSALS, MCP_GAMEPLAY_WORKFLOW } from "../src/main/gameplay-handoff"
import { MCP_SERVER_INSTRUCTIONS, MCP_TOOLS } from "../src/main/mcp-handoff"
import { everythingToRead } from "./handoff-reading"
import { getMcpCapabilities } from "../src/main/mcp-capabilities"
import { ExternalBridgeMethodSchema, ExternalSheetInputSchema } from "../src/external"
import { BAD, BOX_GUARD, GUARDIAN_HOME, IDS, LEGACY_FILES, REVIEWS } from "../../mod-core/test/fixtures/gameplay/sample"
import { HAS_OFFICIAL_JAVAC, officialJavacCompiler } from "../../mod-core/test/gameplay-javac"
import { PAPER, played } from "./playable-fixture"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const directories: string[] = []
const closers: (() => unknown)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

/** A compiler for tests of the order of work: it knows the one version in the fixtures that does not compile. The real one is used further down. */
const scripted: GameplayCompile = async (input) => {
  const broken = input.candidate.document.sources.find((file) => file.content.includes(".setCooldown("))
  return { ran: true, compile: broken ? { ok: false, findings: [{ rule: "compile", file: broken.path, line: 34, message: "编译不过：找不到方法 setCooldown(Item,int)（在 class ItemCooldowns 里）。（编译器原话：cannot find symbol）", fix: "核对拼写、参数和 import。" }], compiler: "scripted", note: null } : { ok: true, findings: [], compiler: "scripted", note: null } }
}
const javac: GameplayCompile = (input) => compileGameplayCandidate(input.directory, { templateDirectory: TEMPLATE, candidate: input.candidate, compiler: officialJavacCompiler, signal: input.signal })

async function bench(options: { compile?: GameplayCompile | null; ai?: { apiKey?: string; baseUrl?: string }; timing?: Partial<CheckTiming>; waitForCheck?: WaitForGameplayCheck } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-gameplay-"))
  directories.push(root)
  const directory = path.join(root, "project")
  const original = JSON.parse(await readFile(LEGACY_FILES.project, "utf8"))
  await mkdir(path.join(directory, ".minemods", "assets", original.assets[0].id), { recursive: true })
  await cp(LEGACY_FILES.project, path.join(directory, "minemods.project.json"))
  await cp(LEGACY_FILES.model, path.join(directory, ".minemods", "assets", original.assets[0].id, `${original.assets[0].revision}.json`))
  const project = await openProject(directory)
  const runner = createProjectRunner({ directoryFor: async () => directory, ai: options.ai ?? {}, ...(options.compile === null ? {} : { compileGameplay: options.compile ?? scripted }), ...(options.timing ? { checkTiming: options.timing } : {}), waitForCheck: options.waitForCheck })
  closers.push(() => runner.dispose())
  return { project, directory, runner }
}

const REQUEST = "一只守着秘匣的敌对生物"
async function claimed(runner: ReturnType<typeof createProjectRunner>, project: { id: string; revision: number }, title = "守匣警报") {
  const started = await runner.startExternal({ projectId: project.id, expectedRevision: project.revision, prompt: REQUEST, plan: { summary: "守卫", questions: [], tasks: [{ key: "guard", module: "gameplay", title, prompt: "守着秘匣的敌对生物", source: "守着秘匣的敌对生物", dependencies: [], target_id: null }] } })
  const ids = { projectId: project.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
  return { ids, assetId: started.run.tasks[0]!.asset_id, context: await runner.claimExternalTask(ids) }
}
/** `check_code` until it answers with a result: a check that outlasts one call is asked after again with the same arguments, as an outside AI does. */
async function checked(runner: ReturnType<typeof createProjectRunner>, input: { projectId: string; runId: string; taskId: string; document?: unknown }) {
  const answer = await runner.checkCodeExternalTask(input)
  if (answer.finished) return answer
  return checked(runner, input)
}
const words = (step: Promise<unknown>) => step.then(() => "accepted", (error: unknown) => { const shown = externalError(error); return shown instanceof Error ? shown.message : String(shown) })
const KEPT = "任务保持运行，工程里什么都没有改动。"
const variant = (index: number, document: GameplayDocument = BOX_GUARD): GameplayDocument => ({ ...document, sources: [...document.sources, { path: `Extra${index}.java`, content: `package com.minemods.content_legacy_sample.gameplay.box_guard;\nfinal class Extra${index} {}\n` }] })

test("外部 AI：每一步被拒绝都说清楚缺什么；三项检查过了、评审过了才保存", async () => {
  const { project, directory, runner } = await bench()
  const { ids, assetId, context } = await claimed(runner, project)
  // The claim says this is gameplay code: the order of work, what it may attach to with how code reads each thing, and that nobody launches the game.
  expect(context.making).toBeNull()
  expect(context.gameplay).toMatchObject({ discipline: GAMEPLAY_DISCIPLINE, sheet: null, remark: null, rounds_allowed: GAMEPLAY_LIMITS.rounds, next_step: "先用 save_sheet 写玩法说明。", no_game: GAMEPLAY_NO_GAME_WORDS, package_name: "com.minemods.content_legacy_sample.gameplay.<slug>" })
  expect(context.gameplay!.things).toEqual([
    { asset_id: IDS.item, kind: "物品", title: "月露", accessor: 'ProjectContent.item("moon_dew")' },
    { asset_id: IDS.block, kind: "方块", title: "秘匣", accessor: 'ProjectContent.block("mystery_box")' },
    // One line for the creature, however many assets read it: the asset of its rules is said to be another name for it, and its model's motions come with whether anything plays them.
    // Each thing carries what already acts on it, and by whom: the creature roams and fights by its own settings, so nothing written for it has to.
    { asset_id: IDS.creature, kind: "生物", title: "苔皮苦力怕", accessor: `ProjectContent.entity("${IDS.creature}")`, already: [{ by: "它自己", does: "没事的时候自己闲逛、张望、看向走近的玩家，掉进水里会游泳" }, { by: "它自己", does: "会打人：自己找最近的、看得见的玩家打" }], also_read_as: ["77777777-7777-4777-8777-777777777777"], motions: [{ clip: "idle", played: true }, { clip: "walk", played: true }, { clip: "hurt", played: true }] },
  ])
  expect(context.instructions).toBe(MODULES.gameplay.instructions)
  const commit = (document: unknown) => words(runner.commitExternalTask({ ...ids, document }))
  const check = (document?: unknown) => checked(runner, { ...ids, ...(document === undefined ? {} : { document }) })

  expect(await commit(BOX_GUARD)).toBe(`${GAMEPLAY_REFUSALS.no_sheet}${KEPT}`)
  expect(await words(check(BOX_GUARD))).toBe(GAMEPLAY_REFUSALS.no_sheet)
  expect(await words(check())).toBe(GAMEPLAY_REFUSALS.no_draft)
  expect(await words(runner.finalReviewExternalTask(ids))).toBe(GAMEPLAY_REFUSALS.no_sheet)
  // The steps of the looked kinds do not apply, and say so.
  expect(await words(runner.lookExternalTask({ ...ids, document: BOX_GUARD }))).toBe("玩法不走看图流程，不需要部件说明、看图和自评：做好以后直接 commit_task。")
  // save_sheet takes the description; a part sheet is not one.
  expect(await words(runner.describeExternalTask({ ...ids, sheet: { subject: "守卫", recognisable: ["x"], parts: [{ name: "a", what: "b", shape: "c", attaches: "d", surface: "e", moves: "f", assumed: false }], assumed: [] } }))).toStartWith("结构校验失败")
  expect(await runner.describeExternalTask({ ...ids, sheet: gameplaySheet(BOX_GUARD) })).toMatchObject({ sheet: gameplaySheet(BOX_GUARD), state: "writing", round: 0, next_step: "照说明写出代码，然后用 check_code 检查。" })
  expect(await commit(BOX_GUARD)).toBe(`${GAMEPLAY_REFUSALS.no_check}${KEPT}`)
  expect(await words(runner.finalReviewExternalTask(ids))).toBe(GAMEPLAY_REFUSALS.no_check)
  // A document whose description is not the saved one is not checked at all.
  expect(await words(check(BAD.claims_a_drop))).toBe(GAMEPLAY_REFUSALS.sheet_differs)
  expect(await words(check({ ...BOX_GUARD, sources: [] }))).toStartWith("结构校验失败")

  // Version 1 opens a socket: caught by the scan, never compiled, cannot be reviewed or handed in.
  const first = await check(BAD.opens_socket)
  expect(first).toMatchObject({ state: "writing", round: 1, rounds_left: GAMEPLAY_LIMITS.rounds - 1, check: { passed: false, in_bounds: { ok: false }, references: { ok: true }, compiles: { ok: null } } })
  expect(first.check.lines).toEqual(["Alarm.java 第 36 行：用到了 java.net.Socket：连接游戏以外的地址。玩法要在客户端和服务端之间传消息，用 Fabric 的 networking API（自定义 payload）；不能连游戏以外的任何地址。"])
  expect(await commit(BAD.opens_socket)).toBe(`${GAMEPLAY_REFUSALS.floor(first.check.lines)}${KEPT}`)
  expect(await words(runner.finalReviewExternalTask(ids))).toBe(GAMEPLAY_REFUSALS.floor(first.check.lines))
  // The same hand-in, as the person is told it in the activity: the sentence of the rule, with no file, class or tool name (round 18).
  const stopped = await runner.commitExternalTask({ ...ids, document: BAD.opens_socket }).then(() => null, (error: unknown) => refusedWords(error))
  expect(stopped).toMatchObject({ plain: true, message: `这一版没有通过代码检查，不能评审也不能提交：代码越界了：代码想连接网络，玩法不能联网。${KEPT}`, raw: `${GAMEPLAY_REFUSALS.floor(first.check.lines)}${KEPT}` })
  expect(stopped!.message).not.toMatch(/Alarm|Socket|check_code|java\./)
  // Version 2 names an item that is not there; version 3 does not compile. The draft sent with update_task is what check_code checks when no document is given.
  expect((await check(BAD.missing_item)).check).toMatchObject({ passed: false, in_bounds: { ok: true }, references: { ok: false }, lines: ['Main.java 第 11 行：ProjectContent.item("blue_sword")：这个工程里没有这个物品。这个工程里有：「月露」（moon_dew）。'] })
  await runner.updateExternalTask({ ...ids, draft: BAD.does_not_compile })
  const third = await check()
  expect(third).toMatchObject({ round: 3, state: "writing", check: { passed: false, in_bounds: { ok: true }, references: { ok: true }, compiles: { ok: false, compiler: "scripted" } } })
  expect(third.check.lines[0]).toStartWith("Pulse.java 第 34 行：编译不过：找不到方法 setCooldown")
  // Version 4 is the good one.
  const fourth = await check(BOX_GUARD)
  expect(fourth).toMatchObject({ state: "reviewing", round: 4, rounds_left: GAMEPLAY_LIMITS.rounds - 4, next_step: expect.stringContaining("final_review"), check: { passed: true, lines: [], compiles: { ok: true } } })
  expect(await commit(BOX_GUARD)).toBe(`${GAMEPLAY_REFUSALS.no_review}${KEPT}`)

  // What the reviewer is given: the description and the code, the person's words, and nothing of the three failed versions.
  const packet = (await runner.finalReviewExternalTask(ids)) as { instructions: string; input: Record<string, unknown>; how: string; answer_schema: Record<string, unknown> }
  expect(packet.instructions).toBe(GAMEPLAY_REVIEWER_INSTRUCTIONS)
  expect(packet.how).toBe(GAMEPLAY_REVIEWER_HANDOFF)
  expect(packet.input).toEqual({ judging: "玩法「守匣警报」：它的说明和它的代码（加上 Studio 自己生成的那部分）是不是一回事。", description: gameplaySheet(BOX_GUARD), code: { sources: BOX_GUARD.sources, data: BOX_GUARD.data, lang: BOX_GUARD.lang }, generated: expect.any(Array), already: [{ thing: "苔皮苦力怕", already: [{ by: "它自己", does: "没事的时候自己闲逛、张望、看向走近的玩家，掉进水里会游泳" }, { by: "它自己", does: "会打人：自己找最近的、看得见的玩家打" }] }], request: REQUEST })
  // The gameplay hangs on a creature whose class the AI never sees: what that class guarantees is read from the source the build would write, and handed over.
  const generated = (packet.input.generated as string[]).join("\n")
  expect(generated).toContain("生物「苔皮苦力怕」")
  expect(generated).toContain("出手：它的模型没有 attack 动作，生成的类也没有改写 doHurtTarget。")
  expect(generated).toContain("玩法代码用 ProjectContent.addGoal / addTargetGoal 加的行为，在它自己的 registerGoals 末尾、排在上面这些之后加进去")
  expect(JSON.stringify(packet)).not.toMatch(/Socket|blue_sword|setCooldown/)
  expect(Object.keys((packet.answer_schema as { properties: object }).properties)).toEqual(["passed", "findings", "advice", "technical", "lacking"])
  expect(packet.instructions).toContain(GAMEPLAY_GENERATED_REVIEW)
  // There are no pictures to ask for, and the two lists cannot contradict the verdict.
  expect(await words(runner.finalReviewExternalTask({ ...ids, need: [{ what: "angle", name: "back" }] }))).toBe(GAMEPLAY_REFUSALS.no_need)
  expect(await words(runner.finalReviewExternalTask({ ...ids, verdict: { passed: false, findings: [], independent: true } }))).toBe(REFUSALS.failed_without_findings)
  expect(await words(runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: ["缺掉落"], independent: true } }))).toBe(REFUSALS.passed_with_findings)
  expect(await runner.finalReviewExternalTask({ ...ids, verdict: { ...REVIEWS.good, independent: false } })).toMatchObject({ review: { passed: true, independent: false, findings: [], advice: REVIEWS.good.advice }, next_step: expect.stringContaining("commit_task") })
  // Any other version than the checked and reviewed one is refused.
  expect(await commit(variant(9))).toBe(`${GAMEPLAY_REFUSALS.unchecked}${KEPT}`)
  expect((await openProject(directory)).workspace.assets.some((asset) => asset.id === assetId)).toBe(false)

  expect(await commit(BOX_GUARD)).toBe("accepted")
  const saved = (await openProject(directory)).workspace.assets.find((asset) => asset.id === assetId)!
  expect(saved).toMatchObject({ module: "gameplay", status: "ready", title: "守匣警报", document: BOX_GUARD })
  // What it attaches to became real dependencies.
  expect(BOX_GUARD.uses.every((id) => saved.dependencies.includes(id))).toBe(true)
  const record = (await readGameplay(directory, assetId))!
  expect(record).toMatchObject({ state: "done", outcome: "passed", review: { passed: true, independent: false }, saved: { check: { bounds: [], references: [], compile: { ok: true, compiler: "scripted" } } } })
  expect(record.rounds.map((round) => round.passed)).toEqual([false, false, false, true])
  expect(record.outcome === "passed" && record.kept_reason).toBeUndefined()
  // Every check was reported to the activity log in plain words.
  const events = (await readActivity(directory)).events.filter((event) => event.kind === "check" && event.end)
  expect(events.map((event) => [event.mark, event.round, event.text])).toEqual([
    ["fail", 1, "「守匣警报」第 1 版的代码没通过检查：代码越界了。"],
    ["fail", 2, "「守匣警报」第 2 版的代码没通过检查：引用对不上。"],
    ["fail", 3, "「守匣警报」第 3 版的代码没通过检查：编译不过。"],
    ["ok", 4, "「守匣警报」第 4 版的代码检查通过：能编译、没有越界、引用都对得上。"],
  ])
  // The person's line says what is wrong with no name of code in it (round 18); the AI that fixes the code is given the quoted lines, and 高级 keeps them too.
  expect(events[0]!.lines).toEqual(["代码越界了：代码想连接网络，玩法不能联网。"])
  expect(events[0]!.lines!.join("")).not.toMatch(/Alarm|Socket|java\./)
  expect(events[0]!.detail).toContain(first.check.lines[0]!)
  expect(first.check.lines[0]).toContain("java.net.Socket")
  expect((await runner.get({ projectId: project.id, runId: ids.runId })).tasks[0]).toMatchObject({ state: "completed" })
})

test("评审说缺材料而判了没通过：同一版可以再评审一次，只有一次；评审过了就照常提交", async () => {
  const { project, directory, runner } = await bench()
  const { ids, assetId } = await claimed(runner, project)
  await runner.describeExternalTask({ ...ids, sheet: gameplaySheet(BOX_GUARD) })
  expect(await checked(runner, { ...ids, document: BOX_GUARD })).toMatchObject({ state: "reviewing", check: { passed: true } })
  await runner.finalReviewExternalTask(ids)
  // The reviewer could not see what a generated class does and said so, yet failed the version: that is not the last word on it.
  const lacking = ["生成的生物类里 doHurtTarget 做了什么，code 里看不到"]
  const failed = (await runner.finalReviewExternalTask({ ...ids, verdict: { passed: false, findings: ["说明写了出手有动作，代码只调用 doHurtTarget"], lacking, independent: true } })) as { state: string; next_step: string }
  expect(failed).toMatchObject({ state: "writing", next_step: expect.stringContaining(`评审没通过，但它说缺材料：${lacking[0]}。可以把缺的补给评审，用 final_review 对这一版再评审一次（只有这一次）`) })
  expect(await runner.finalReviewExternalTask({ ...ids, verdict: { ...REVIEWS.good, independent: true } })).toMatchObject({ review: { passed: true }, next_step: expect.stringContaining("commit_task") })
  expect(await words(runner.commitExternalTask({ ...ids, document: BOX_GUARD }))).toBe("accepted")
  expect((await readGameplay(directory, assetId))!.review).toMatchObject({ passed: true, again: true, packet: expect.stringMatching(/^[a-f0-9]{64}$/) })
})

test("评审说说明写了而代码没做到：这一版不能提交；版数用完时，通过了检查的最新一版交给人，标明 AI 还不满意", async () => {
  const { project, directory, runner } = await bench({ waitForCheck: (settled) => settled })
  const { ids, assetId } = await claimed(runner, project)
  // The description promises a drop the code never gives. Every machine check passes: only a reader of both can tell.
  await runner.describeExternalTask({ ...ids, sheet: gameplaySheet(BAD.claims_a_drop) })
  expect(await checked(runner, { ...ids, document: BAD.claims_a_drop })).toMatchObject({ state: "reviewing", check: { passed: true } })
  expect(await runner.finalReviewExternalTask({ ...ids, verdict: { ...REVIEWS.claims_a_drop, independent: true } })).toMatchObject({ state: "writing", review: { passed: false, findings: REVIEWS.claims_a_drop.findings }, next_step: expect.stringContaining("评审没通过") })
  expect(await words(runner.commitExternalTask({ ...ids, document: BAD.claims_a_drop }))).toBe(`${GAMEPLAY_REFUSALS.review_failed}${KEPT}`)
  expect(await words(runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], independent: true } }))).toBe(GAMEPLAY_REFUSALS.reviewed_and_failed)
  // Every later version fails to compile, until the rounds are used up.
  const broken = (index: number) => variant(index, { ...BAD.does_not_compile, behaviours: BAD.claims_a_drop.behaviours })
  for (const index of Array.from({ length: GAMEPLAY_LIMITS.rounds - 2 }, (_, value) => value + 2)) expect(await checked(runner, { ...ids, document: broken(index) })).toMatchObject({ round: index, state: "writing" })
  const last = await words(checked(runner, { ...ids, document: broken(GAMEPLAY_LIMITS.rounds) }))
  expect(last).toStartWith("这一版没有通过代码检查，不能评审也不能提交：Pulse.java 第 34 行：编译不过")
  // What to call next is worked out from the run: this one task was the whole batch, so the batch is over and `next_batch` is the right call.
  expect(last).toEndWith(`${GAMEPLAY_REFUSALS.out_of_rounds(GAMEPLAY_LIMITS.rounds)}${GAMEPLAY_REFUSALS.kept(1)}接下来：这一批已经结束。调用 next_batch 看接下来做什么。`)
  // Version 1 — the one that passed the machine checks — is in the project, marked, with the reviewer's reasons.
  const saved = (await openProject(directory)).workspace.assets.find((asset) => asset.id === assetId)!
  expect(saved.document).toEqual(BAD.claims_a_drop)
  const record = (await readGameplay(directory, assetId))!
  expect(record).toMatchObject({ state: "done", outcome: "kept_unsatisfied", kept_round: 1, saved: { check: { compile: { ok: true } } } })
  expect(record.kept_reason).toEqual([
    expect.stringContaining(`停下的原因：这一版没有通过代码检查`),
    `评审认为必须改：${REVIEWS.claims_a_drop.findings[0]}`,
    "交给你的是第 1 版：后面的版本没有通过代码检查，没有留。",
  ])
  expect((await runner.get({ projectId: project.id, runId: ids.runId })).tasks[0]).toMatchObject({ state: "completed", outcome: "kept_unsatisfied", detail: expect.stringContaining(UNSATISFIED.mark) })
  expect(await words(checked(runner, { ...ids, document: BOX_GUARD }))).toBe("外部任务尚未领取或已结束。")
}, 120_000)

test("最后一轮先答还在检查，任务结束后用相同文档续问仍拿到结论", async () => {
  const gate = Promise.withResolvers<void>()
  const settled = Promise.withResolvers<void>()
  let pastFirstWait = false
  const { project, directory, runner } = await bench({
    compile: async (input) => {
      if (pastFirstWait) await gate.promise
      return scripted(input)
    },
    waitForCheck: (answer) => {
      if (!pastFirstWait) return answer
      void answer.then(() => settled.resolve())
      return Promise.resolve(null)
    },
  })
  const { ids, assetId } = await claimed(runner, project)
  await runner.describeExternalTask({ ...ids, sheet: gameplaySheet(BAD.claims_a_drop) })
  expect(await checked(runner, { ...ids, document: BAD.claims_a_drop })).toMatchObject({ state: "reviewing" })
  await runner.finalReviewExternalTask({ ...ids, verdict: { ...REVIEWS.claims_a_drop, independent: true } })
  const broken = (round: number) => variant(round, { ...BAD.does_not_compile, behaviours: BAD.claims_a_drop.behaviours })
  for (let round = 2; round < GAMEPLAY_LIMITS.rounds; round++) {
    expect(await checked(runner, { ...ids, document: broken(round) })).toMatchObject({ state: "writing", round })
  }
  const last = { ...ids, document: broken(GAMEPLAY_LIMITS.rounds) }
  pastFirstWait = true
  try {
    expect(await runner.checkCodeExternalTask(last)).toMatchObject({ finished: false, state: "checking" })
  } finally {
    gate.resolve()
  }
  await settled.promise
  expect(await readGameplay(directory, assetId)).toMatchObject({ state: "done", outcome: "kept_unsatisfied", kept_round: 1 })

  const reply = await words(runner.checkCodeExternalTask(last))
  console.log("check_code terminal reply:", reply)
  expect(reply).toContain("Pulse.java 第 34 行：编译不过")
  expect(reply).toContain(GAMEPLAY_REFUSALS.kept(1))
  expect(reply).toContain("调用 next_batch")
  expect(await words(runner.checkCodeExternalTask({ ...last, document: BOX_GUARD }))).toBe("外部任务尚未领取或已结束。")

  const restarted = createProjectRunner({ directoryFor: async () => directory, ai: {} })
  closers.push(() => restarted.dispose())
  expect(await words(restarted.checkCodeExternalTask(last))).toBe(reply)
  expect(await words(restarted.checkCodeExternalTask(ids))).toBe(reply)
  expect(await words(restarted.checkCodeExternalTask({ ...last, projectId: "00000000-0000-4000-8000-000000000001" }))).toBe("运行记录不属于当前工程。")
  const run = await runner.get({ projectId: project.id, runId: ids.runId })
  const archived = { ...run, tasks: run.tasks.map((task) => ({ ...task, finished_at: new Date(Date.now() - GAMEPLAY_CHECK_FRESH_MS - 1).toISOString() })) }
  await writeFile(path.join(directory, ".minemods", "runs", `${run.id}.json`), JSON.stringify(archived))
  const oldReply = await words(restarted.checkCodeExternalTask(last))
  console.log("check_code archived reply:", oldReply)
  expect(oldReply).toBe(`任务已结束。以下是最后一轮的结论。${reply}`)
}, 120_000)

test("没有一版通过检查就什么都不留；fail_task 时有通过检查的一版就留下它", async () => {
  const none = await bench()
  const failed = await claimed(none.runner, none.project)
  await none.runner.describeExternalTask({ ...failed.ids, sheet: gameplaySheet(BOX_GUARD) })
  await checked(none.runner, { ...failed.ids, document: BAD.uses_reflection })
  const run = await none.runner.failExternalTask({ ...failed.ids, error: "写不出不用反射的办法" })
  expect(run.tasks[0]).toMatchObject({ state: "failed", error: "写不出不用反射的办法" })
  expect((await openProject(none.directory)).workspace.assets.some((asset) => asset.id === failed.assetId)).toBe(false)
  expect(await readGameplay(none.directory, failed.assetId)).toMatchObject({ state: "stopped", outcome: "failed", best: null })

  const some = await bench()
  const stopped = await claimed(some.runner, some.project)
  await some.runner.describeExternalTask({ ...stopped.ids, sheet: gameplaySheet(BOX_GUARD) })
  await checked(some.runner, { ...stopped.ids, document: BOX_GUARD })
  expect((await some.runner.failExternalTask({ ...stopped.ids, reason: "找不到独立的评审" })).tasks[0]).toMatchObject({ state: "completed", outcome: "kept_unsatisfied" })
  // `reason` is taken for `error` (an outside AI reached for it first); with neither the call is refused in words.
  await expect(some.runner.failExternalTask({ ...stopped.ids })).rejects.toThrow("error（写成 reason 也可以）不能省")
  expect(await readGameplay(some.directory, stopped.assetId)).toMatchObject({ outcome: "kept_unsatisfied", kept_round: 1, kept_reason: ["停下的原因：找不到独立的评审", "这一版通过了越界、引用和编译检查，但说明和代码是不是一回事还没有评审通过。"] })
})

test("没有编译环境、或者编译工具自己坏了：如实说没能编译，不占版数，也不保存", async () => {
  const blind = await bench({ compile: null })
  const first = await claimed(blind.runner, blind.project)
  await blind.runner.describeExternalTask({ ...first.ids, sheet: gameplaySheet(BOX_GUARD) })
  expect(await words(checked(blind.runner, { ...first.ids, document: BOX_GUARD }))).toBe(GAMEPLAY_REFUSALS.no_compiler("这台 Studio 没有配置编译环境。"))
  // Out-of-bounds code is still told so: the scan needs no compiler.
  expect((await checked(blind.runner, { ...first.ids, document: BAD.opens_socket })).check.in_bounds.ok).toBe(false)
  const offline: GameplayCompile = async (): Promise<CompileResult> => ({ ran: false, reason: "编译工具自己出了问题，没有给出任何一行代码的错误（Could not resolve net.fabricmc:fabric-loom）。" })
  const down = await bench({ compile: offline })
  const second = await claimed(down.runner, down.project)
  await down.runner.describeExternalTask({ ...second.ids, sheet: gameplaySheet(BOX_GUARD) })
  expect(await words(checked(down.runner, { ...second.ids, document: BOX_GUARD }))).toContain("这一次没能编译：编译工具自己出了问题")
  expect((await readGameplay(down.directory, second.assetId))!.rounds).toEqual([])
  expect(await words(down.runner.commitExternalTask({ ...second.ids, document: BOX_GUARD }))).toBe(`${GAMEPLAY_REFUSALS.no_check}${KEPT}`)
})

type Sent = { kind: "sheet" | "write" | "review"; instructions: string; input: Record<string, any> }
/** A stand-in for the AI service that tells the three kinds of request apart by their instructions. */
function provider(script: { write: (round: number, input: Record<string, any>) => GameplayDocument; review: (round: number) => { passed: boolean; findings: string[]; advice: string[] }; sheet?: GameplayDocument }) {
  const sent: Sent[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const body = JSON.parse(await request.text()) as { instructions: string; input: { content: { type: string; text?: string }[] }[] }
      const kind = body.instructions === GAMEPLAY_SHEET_INSTRUCTIONS ? "sheet" : body.instructions === GAMEPLAY_REVIEWER_INSTRUCTIONS ? "review" : "write"
      const call = { kind, instructions: body.instructions, input: JSON.parse(body.input[0]!.content[0]!.text!) as Record<string, any> } as const
      sent.push(call)
      const count = sent.filter((value) => value.kind === kind).length
      const written = kind === "write" ? script.write(count, call.input) : null
      const value = kind === "sheet" ? gameplaySheet(script.sheet ?? BOX_GUARD) : kind === "review" ? { lacking: [], ...script.review(count) } : { sources: written!.sources, data: written!.data, lang: written!.lang }
      return Response.json({ model: "gpt-6-astra", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(value) }] }] })
    },
  })
  closers.push(() => server.stop(true))
  return { sent, ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1` } }
}
async function terminal(runner: ReturnType<typeof createProjectRunner>, projectId: string, runId: string) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const run = await runner.get({ projectId, runId })
    if (["completed", "partial", "canceled", "failed", "interrupted"].includes(run.state)) return run
    await Bun.sleep(10)
  }
  throw new Error("runner did not finish")
}

test("编译环境的提示只在这台电脑真的没下载过开发文件时才说第一次；已经下过的就只说在准备", async () => {
  const stages = async (cold: boolean) => {
    const gate: { open: () => void } = { open: () => undefined }
    const opened = new Promise<void>((resolve) => (gate.open = resolve))
    const seen = { began: false }
    const compile: GameplayCompile = async (input) => {
      if (cold) input.onProgress?.(COMPILE_COLD_LINE)
      seen.began = true
      await opened
      return scripted(input)
    }
    const { project, runner } = await bench({ compile, timing: { first: 40, again: 40, early: 15, beat: 60000 } })
    const { ids } = await claimed(runner, project)
    await runner.describeExternalTask({ ...ids, sheet: gameplaySheet(BOX_GUARD) })
    const first = await runner.checkCodeExternalTask({ ...ids, document: BOX_GUARD })
    const reached = async (): Promise<void> => (seen.began ? undefined : Bun.sleep(10).then(reached))
    await reached()
    const again = (await runner.checkCodeExternalTask({ ...ids, document: BOX_GUARD })) as { checking?: { stage?: string } }
    gate.open()
    await checked(runner, { ...ids, document: BOX_GUARD })
    return { first, stage: again.checking?.stage }
  }
  // Warm: a build or an earlier check has finished here, so nothing is a first time and nothing promises ten minutes.
  expect((await stages(false)).stage).toBe(CHECK_STAGES.preparing)
  expect(CHECK_STAGES.preparing).not.toContain("第一次")
  expect(CHECK_STAGES.preparing).not.toContain("分钟")
  // Cold: said once, with where the range comes from (the same one the build panel quotes).
  expect((await stages(true)).stage).toBe(CHECK_STAGES.preparing_first)
  expect(CHECK_STAGES.preparing_first).toContain("还没有下载过")
  expect(CHECK_STAGES.preparing_first).toContain("6 到 10 分钟")
})

test("check_code 不占着一次调用：慢编译先回答还在检查，同样的参数再问是接着等，同一版只编译一次；检查中交另一版会被退回", async () => {
  const gate: { open: () => void } = { open: () => undefined }
  const opened = new Promise<void>((resolve) => (gate.open = resolve))
  const compiled: string[] = []
  // A compiler that takes as long as the test lets it, and one run of it that dies on the network.
  const slow: GameplayCompile = async (input) => {
    compiled.push(input.candidate.document.sources.at(-1)!.path)
    input.onProgress?.("> Task :compileJava\n")
    await opened
    return compiled.length === 3 ? { ran: false, reason: `编译器没有跑起来（${CHECK_NETWORK_WORDS}）。` } : scripted(input)
  }
  const { project, directory, runner } = await bench({ compile: slow, timing: { first: 40, again: 40, early: 15, beat: 60000 } })
  const { ids, assetId } = await claimed(runner, project)
  await runner.describeExternalTask({ ...ids, sheet: gameplaySheet(BOX_GUARD) })
  const ask = (document: GameplayDocument) => runner.checkCodeExternalTask({ ...ids, document })

  const began = Date.now()
  const first = await ask(BOX_GUARD)
  expect(Date.now() - began).toBeLessThan(3000)
  expect(first).toMatchObject({ finished: false, state: "checking", next_step: expect.stringContaining("用完全相同的参数再调用一次 check_code") })
  // The same call again waits on the same check; another version is sent back in plain words, and uses up no round.
  const reached = async (): Promise<void> => (compiled.length ? undefined : Bun.sleep(10).then(reached))
  await reached()
  expect(await ask(BOX_GUARD)).toMatchObject({ finished: false, checking: { stage: CHECK_STAGES.compiling } })
  expect(await words(ask(variant(1)))).toStartWith("上一版还在检查")
  expect(compiled).toHaveLength(1)
  expect((await readGameplay(directory, assetId))?.rounds).toEqual([])
  // Meanwhile the person is told it is still compiling, and for how long: the first word comes early, long before the regular beat.
  const told = () => readActivity(directory).then(({ events }) => events.some((event) => event.step && event.text.startsWith("正在编译检查「守匣警报」的代码，已经 ") && event.text.endsWith(`：${CHECK_STAGES.compiling}。`) && event.lines?.[0] === `${CHECK_STAGES.compiling}。`))
  expect(await untilObserved(told, Boolean)).toBe(true)

  gate.open()
  const done = await checked(runner, { ...ids, document: BOX_GUARD })
  expect(done).toMatchObject({ finished: true, state: "reviewing", round: 1, check: { passed: true } })
  // Asked once more, the kept result comes back; nothing is compiled again.
  expect(await ask(BOX_GUARD)).toEqual(done)
  expect(compiled).toHaveLength(1)
  // With that check over, the next version is checked as usual.
  expect(await checked(runner, { ...ids, document: variant(1) })).toMatchObject({ finished: true, round: 2 })
  // A compile that died on the network says so, asks for nothing to be changed, and the same call starts afresh.
  expect(await words(checked(runner, { ...ids, document: variant(2) }))).toBe(GAMEPLAY_REFUSALS.no_compiler(CHECK_NETWORK_WORDS))
  expect(await checked(runner, { ...ids, document: variant(2) })).toMatchObject({ finished: true, round: 3 })
  expect(compiled.slice(1)).toEqual(["Extra1.java", "Extra2.java", "Extra2.java"])
  expect(CHECK_CALLING.how).toContain("不会再编译一次")
}, 120_000)

test("check_code 等到结果的那一次调用，答复里的步骤和记录一致，不是开始等之前的旧样子", async () => {
  const gate = Promise.withResolvers<void>()
  const secondWait = Promise.withResolvers<void>()
  const waits = { count: 0 }
  const slow: GameplayCompile = async (input) => gate.promise.then(() => scripted(input))
  const { project, directory, runner } = await bench({
    compile: slow,
    waitForCheck: (answer) => {
      if (++waits.count === 1) return Promise.resolve(null)
      secondWait.resolve()
      return answer
    },
  })
  const { ids, assetId } = await claimed(runner, project)
  await runner.describeExternalTask({ ...ids, sheet: gameplaySheet(BOX_GUARD) })
  expect(await runner.checkCodeExternalTask({ ...ids, document: BOX_GUARD })).toMatchObject({ finished: false, state: "checking" })
  // The second call is already waiting when the compile ends, so it read the record while there was no version yet.
  const waiting = runner.checkCodeExternalTask({ ...ids, document: BOX_GUARD })
  try {
    await Promise.race([secondWait.promise, waiting.then(() => { throw new Error("Check completed before the second wait") })])
  } finally {
    gate.resolve()
  }
  const answer = await waiting
  const record = (await readGameplay(directory, assetId))!
  expect(record).toMatchObject({ state: "reviewing", rounds: [{ round: 1, passed: true }] })
  // 「审查」 is on unless the person turned it off: the version that passed is handed to the reviewer in the other window, and the step says so.
  expect(answer).toMatchObject({ finished: true, check: { passed: true }, ...gameplayStep(record), next_step: INSPECTION_WORDS.maker })
  expect(answer).toMatchObject({ round: 1, next_step: expect.stringContaining("await_inspection") })
}, 120_000)

test("check_code 再次调用的等待是长轮询：比客户端一次请求的一分钟短、留足余量，并且照这个数告诉外部 AI", () => {
  expect(CHECK_TIMING.again).toBe(CLIENT_CALL_MS - CALL_MARGIN_MS)
  expect(CHECK_TIMING.again).toBe(45000)
  expect(CHECK_TIMING.again + CALL_MARGIN_MS).toBeLessThanOrEqual(CLIENT_CALL_MS)
  // The first call still answers quickly, so a check that is going to be long says so at once.
  expect(CHECK_TIMING.first).toBeLessThan(CHECK_TIMING.again)
  expect(CHECK_CALLING.how).toContain("每次调用最多等 45 秒，编译一结束就马上返回")
  expect(gameplayCapability().check_calling.wait_seconds).toBe(45)
})

test("check_code：工程里别的东西提交过（版本号变了），同样的这一版不再编译，结果里说明是沿用的；玩法改了才重新编译", async () => {
  forgetCompiled()
  const ran: string[] = []
  const compiler: CodeCompiler = { name: "counting", run: async (_directory, gameplay) => (ran.push(gameplay), { code: 0, output: "" }) }
  const real: GameplayCompile = (input) => compileGameplayCandidate(input.directory, { templateDirectory: TEMPLATE, candidate: input.candidate, compiler, signal: input.signal })
  const { project, directory, runner } = await bench({ compile: real })
  const { ids } = await claimed(runner, project)
  await runner.describeExternalTask({ ...ids, sheet: gameplaySheet(BOX_GUARD) })
  expect(await checked(runner, { ...ids, document: BOX_GUARD })).toMatchObject({ finished: true, round: 1, check: { compiles: { ok: true, compiler: "counting", note: null } } })
  expect(ran).toHaveLength(1)
  // A recipe is committed in the middle: the project's revision moves, so the kept result is not taken as it is, and the check is done again, bounds and references included...
  const before = await openProject(directory)
  const recipe = { ...before.recipes[0]!, id: "77777777-7777-4777-8777-777777777777", name: "另一个配方", pattern: ["minecraft:stick", null, null, null, null, null, null, null, null], result: "legacy_sample:moon_dew" }
  expect((await saveProject(directory, { ...before, recipes: [...before.recipes, recipe] }, before.revision)).revision).toBeGreaterThan(before.revision)
  // ...but the compiler is not asked again: the files it would be given are the same ones it already answered for.
  const again = await checked(runner, { ...ids, document: BOX_GUARD })
  expect(again).toMatchObject({ finished: true, round: 1, check: { passed: true, compiles: { ok: true, compiler: "counting（沿用上次）", note: REUSED_NOTE } } })
  expect(ran).toHaveLength(1)
  // Another version is compiled as before.
  expect(await checked(runner, { ...ids, document: variant(1) })).toMatchObject({ finished: true, round: 2, check: { compiles: { note: null } } })
  expect(ran).toHaveLength(2)
})

test("Studio 自己的 AI 走同一个流程：说明 → 代码 → 检查 → 改 → 独立评审 → 保存；两条路留下的是同一种记录", async () => {
  const fake = provider({
    // Version 1 does not compile, version 2 opens a socket, version 3 is good; the reviewer first finds a described behaviour missing, then passes version 4.
    write: (round) => (round === 1 ? BAD.does_not_compile : round === 2 ? BAD.opens_socket : round === 3 ? BOX_GUARD : variant(4)),
    review: (round) => (round === 1 ? { passed: true, findings: ["说明第 2 条写冷却 10 秒，Pulse.java 里 COOLDOWN_TICKS 是 200，但冷却期间仍然会播放声音"], advice: [] } : REVIEWS.good),
  })
  const { project, directory, runner } = await bench({ ai: fake.ai })
  const run = await terminal(runner, project.id, (await runner.start({ projectId: project.id, expectedRevision: project.revision, prompt: REQUEST, module: "gameplay" })).id)
  expect(run.state).toBe("completed")
  expect(fake.sent.map((call) => call.kind)).toEqual(["sheet", "write", "write", "write", "review", "write", "review"])
  const [sheet, first, second, , reviewer, fourth] = fake.sent
  // The sheet request is told what it may attach to; the writer is told the package, the accessors and, on a fix, exactly what the checks found.
  expect(sheet!.input).toMatchObject({ request: REQUEST, previous_sheet: null, remark: null })
  expect(sheet!.input.things).toContainEqual({ asset_id: IDS.block, kind: "方块", title: "秘匣" })
  expect(first!.instructions).toBe(GAMEPLAY_WRITER_INSTRUCTIONS)
  expect(first!.input).toMatchObject({ sheet: gameplaySheet(BOX_GUARD), package_name: "com.minemods.content_legacy_sample.gameplay.box_guard", making: { round: 1, rounds_allowed: GAMEPLAY_LIMITS.rounds } })
  expect(first!.input.things).toContainEqual({ asset_id: IDS.item, kind: "物品", title: "月露", accessor: 'ProjectContent.item("moon_dew")' })
  expect(first!.input.revision_required).toBeUndefined()
  expect(second!.input.revision_required.findings[0]).toStartWith("Pulse.java 第 34 行：编译不过：找不到方法 setCooldown")
  // The reviewer is a fresh request: the description and the code, and none of the writing.
  expect(Object.keys(reviewer!.input)).toEqual(["judging", "description", "code", "generated", "already", "request"])
  expect(JSON.stringify(reviewer!.input)).not.toMatch(/setCooldown|Socket|revision_required/)
  // Only blocking findings fail a review, whatever the reviewer put in `passed`.
  expect(fourth!.input.revision_required).toMatchObject({ findings: [], reviewer_findings: [expect.stringContaining("冷却期间仍然会播放声音")] })
  const assetId = run.tasks[0]!.asset_id
  const saved = (await openProject(directory)).workspace.assets.find((asset) => asset.id === assetId)!
  expect(saved.document).toEqual(variant(4))
  expect(saved.provenance.model).toBe("gpt-6-astra")
  const own = (await readGameplay(directory, assetId))!
  expect(own).toMatchObject({ state: "done", outcome: "passed", review: { passed: true, independent: true, advice: REVIEWS.good.advice } })
  expect(own.rounds.map((round) => [round.round, round.passed])).toEqual([[1, false], [2, false], [3, true], [4, true]])
  // The same record an outside AI's tools leave: same fields, same rules.
  const outside = await bench()
  const held = await claimed(outside.runner, outside.project)
  await outside.runner.describeExternalTask({ ...held.ids, sheet: gameplaySheet(BOX_GUARD) })
  await checked(outside.runner, { ...held.ids, document: BOX_GUARD })
  await outside.runner.finalReviewExternalTask({ ...held.ids, verdict: { ...REVIEWS.good, independent: true } })
  await outside.runner.commitExternalTask({ ...held.ids, document: BOX_GUARD })
  const theirs = (await readGameplay(outside.directory, held.assetId))!
  expect(Object.keys(theirs).sort()).toEqual(Object.keys(own).sort())
  expect(Object.keys(theirs.rounds[0]!).sort()).toEqual(Object.keys(own.rounds[0]!).sort())
})

test("Studio 自己的 AI：一直写不对，版数用完；有通过检查的就留下并标明，没有就记为没做成", async () => {
  // Every version compiles and is in bounds, and the reviewer never passes one: the last checked version is kept.
  const stubborn = provider({ write: (round) => variant(round), review: () => ({ passed: false, findings: ["说明写的击退，代码里没有"], advice: [] }) })
  const first = await bench({ ai: stubborn.ai })
  const run = await terminal(first.runner, first.project.id, (await first.runner.start({ projectId: first.project.id, expectedRevision: first.project.revision, prompt: REQUEST, module: "gameplay" })).id)
  expect(stubborn.sent.filter((call) => call.kind === "write")).toHaveLength(GAMEPLAY_LIMITS.rounds)
  expect(run.tasks[0]).toMatchObject({ state: "completed", outcome: "kept_unsatisfied" })
  expect(await readGameplay(first.directory, run.tasks[0]!.asset_id)).toMatchObject({ outcome: "kept_unsatisfied", kept_round: GAMEPLAY_LIMITS.rounds, kept_reason: [expect.stringContaining("停下的原因"), "评审认为必须改：说明写的击退，代码里没有"] })
  expect((await openProject(first.directory)).workspace.assets.find((asset) => asset.id === run.tasks[0]!.asset_id)!.document).toEqual(variant(GAMEPLAY_LIMITS.rounds))
  // Every version leaves its bounds: nothing is ever saved.
  const hopeless = provider({ write: (round) => variant(round, BAD.uses_reflection), review: () => REVIEWS.good })
  const second = await bench({ ai: hopeless.ai })
  const failed = await terminal(second.runner, second.project.id, (await second.runner.start({ projectId: second.project.id, expectedRevision: second.project.revision, prompt: REQUEST, module: "gameplay" })).id)
  expect(hopeless.sent.filter((call) => call.kind === "review")).toHaveLength(0)
  expect(failed.tasks[0]).toMatchObject({ state: "failed", error: GAMEPLAY_REFUSALS.out_of_rounds(GAMEPLAY_LIMITS.rounds) })
  expect((await openProject(second.directory)).workspace.assets.some((asset) => asset.module === "gameplay")).toBe(false)
  // The same document twice is not a fix.
  const lazy = provider({ write: () => BAD.does_not_compile, review: () => REVIEWS.good })
  const third = await bench({ ai: lazy.ai })
  const same = await terminal(third.runner, third.project.id, (await third.runner.start({ projectId: third.project.id, expectedRevision: third.project.revision, prompt: REQUEST, module: "gameplay" })).id)
  expect(same.tasks[0]).toMatchObject({ state: "failed", error: GAMEPLAY_REFUSALS.unchanged })
}, 120000)

test.skipIf(!HAS_OFFICIAL_JAVAC)("样例工程的两个玩法和五个故意做坏的版本，用真的 javac 走一遍：每个坏版本被对应的检查拦下，好的两个通过并保存", async () => {
  const { project, directory, runner } = await bench({ compile: javac })
  const table: Record<string, { check: string; message: string }> = {}
  const guard = await claimed(runner, project)
  await runner.describeExternalTask({ ...guard.ids, sheet: gameplaySheet(BOX_GUARD) })
  for (const name of ["does_not_compile", "opens_socket", "uses_reflection", "missing_item"] as const) {
    const result = await checked(runner, { ...guard.ids, document: BAD[name] })
    expect(result.check.passed).toBe(false)
    table[name] = { check: !result.check.in_bounds.ok ? "越界" : !result.check.references.ok ? "引用" : "编译", message: result.check.lines[0]! }
  }
  expect(table).toEqual({
    does_not_compile: { check: "编译", message: "Pulse.java 第 34 行：编译不过：找不到方法 setCooldown(Item,int)（在 class ItemCooldowns 里）。（编译器原话：cannot find symbol）这个名字在 Minecraft 1.21.1（Mojang 官方名称）或 Fabric API 里不存在，或者少了 import。核对拼写、参数和 import；不确定的接口不要凭印象写。" },
    opens_socket: { check: "越界", message: "Alarm.java 第 36 行：用到了 java.net.Socket：连接游戏以外的地址。玩法要在客户端和服务端之间传消息，用 Fabric 的 networking API（自定义 payload）；不能连游戏以外的任何地址。" },
    uses_reflection: { check: "越界", message: "Pulse.java 第 35 行：调用了 forName：反射。直接用公开的类和方法。碰不到的私有成员在这一版里就是碰不到：不开放反射、mixin 和 access widener。" },
    missing_item: { check: "引用", message: 'Main.java 第 11 行：ProjectContent.item("blue_sword")：这个工程里没有这个物品。这个工程里有：「月露」（moon_dew）。' },
  })
  // The fifth bad version passes every machine check; only the review of description against code catches it (see the test above).
  expect((await checked(runner, { ...guard.ids, document: BOX_GUARD })).check).toMatchObject({ passed: true, compiles: { ok: true, compiler: "javac (stand-in, Mojang's names)" } })
  await runner.finalReviewExternalTask({ ...guard.ids, verdict: { ...REVIEWS.good, independent: true } })
  await runner.commitExternalTask({ ...guard.ids, document: BOX_GUARD })
  // The second gameplay is written in a run of its own, with the first already in the project: it compiles beside it and touches none of its files.
  const after = await openProject(directory)
  const home = await claimed(runner, after, "守卫恋家")
  await runner.describeExternalTask({ ...home.ids, sheet: gameplaySheet(GUARDIAN_HOME) })
  expect((await checked(runner, { ...home.ids, document: GUARDIAN_HOME })).check).toMatchObject({ passed: true })
  await runner.finalReviewExternalTask({ ...home.ids, verdict: { passed: true, findings: [], advice: [], independent: true } })
  await runner.commitExternalTask({ ...home.ids, document: GUARDIAN_HOME })
  const done = await openProject(directory)
  expect(done.workspace.assets.filter((asset) => asset.module === "gameplay").map((asset) => [asset.title, asset.document.kind === "gameplay" && asset.document.slug])).toEqual([["守匣警报", "box_guard"], ["守卫恋家", "guardian_home"]])
  // A check leaves no generated folder behind.
  expect((await readdir(path.join(directory, "generated")).catch(() => [])).filter((name) => name.startsWith("check-"))).toEqual([])
}, 180000)

test("交接文本、能力清单和工具表说的是同一套：种类、入口、读工程的办法、边界、四项检查、没有人开游戏；不带任何题材的玩法示例", () => {
  expect(MCP_TOOLS.map((tool) => tool[0])).toContain("check_code")
  expect(ExternalBridgeMethodSchema.options).toContain("checkCodeExternalTask")
  expect(ExternalSheetInputSchema.safeParse({ projectId: IDS.block, runId: IDS.block, taskId: IDS.block, sheet: gameplaySheet(BOX_GUARD) }).success).toBe(true)
  const capabilities = getMcpCapabilities("medium") as unknown as { gameplay: Record<string, any>; modules: { module: string; capability: string }[]; tools: { name: string }[] }
  expect(capabilities.modules.find((value) => value.module === "gameplay")).toMatchObject({ capability: "runtime" })
  expect(capabilities.tools.map((tool) => tool.name)).toContain("check_code")
  expect(capabilities.gameplay).toMatchObject({ workflow: MCP_GAMEPLAY_WORKFLOW, refusals: MCP_GAMEPLAY_REFUSALS, endings: MCP_GAMEPLAY_ENDINGS, no_game: GAMEPLAY_NO_GAME_WORDS, limits: { rounds: GAMEPLAY_LIMITS.rounds }, entry: { main: "Main.java", interface: "GameplayEntry", accessor: "ProjectContent" }, form_example: GAMEPLAY_FORM_EXAMPLE, active_task_source: "claim_task.gameplay" })
  expect(capabilities.gameplay.bounds.cannot_catch.length).toBeGreaterThanOrEqual(4)
  expect(capabilities.gameplay.bounds.mixins).toContain("不开放 mixin")
  const handoff = everythingToRead({ configuration: JSON.stringify({ mcpServers: { "minemods-studio": { command: "node", args: ["mcp.js"] } } }) })
  ;["## 玩法代码（gameplay）", "check_code", "ProjectContent", "GameplayEntry", "不开放 mixin", GAMEPLAY_NO_GAME_WORDS, GAMEPLAY_DISCIPLINE, "源码检查是护栏，不是证明", ...MCP_GAMEPLAY_REFUSALS, ...MCP_GAMEPLAY_ENDINGS].forEach((words) => expect({ words, said: handoff.includes(words) }).toEqual({ words, said: true }))
  expect(MCP_SERVER_INSTRUCTIONS).toContain(MCP_GAMEPLAY_WORKFLOW.join(" → "))
  // The one example is of the form of a description, and is the only one. Nothing of the test fixtures, and no subject, is told to an AI.
  const told = `${handoff}${JSON.stringify(capabilities.gameplay)}${MODULES.gameplay.instructions}${GAMEPLAY_SHEET_INSTRUCTIONS}${GAMEPLAY_WRITER_INSTRUCTIONS}`
  expect(told).toContain(GAMEPLAY_FORM_EXAMPLE.when)
  expect(told).not.toMatch(/秘匣|月露|苔皮|守卫恋家|box_guard|guardian_home|Pulse|Alarm|音爆|击退|冷却 10 秒|守护者|巨龙|喷火/)
})

test("整条线接在真的服务上：蓝图里规划一个玩法条目，经 MCP 的门检查、评审、提交；验收卡读得到记录，动态里看得到每一步", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-gameplay-service-"))
  directories.push(root)
  const service = await createStudioService({ workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: TEMPLATE, ai: { mode: "mcp", review:true }, compileGameplay: scripted })
  closers.push(() => service.dispose())
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  const projectId = (await service.createProject({ name: "守矿", description: "", modId: "guarded", empty: true })).project.id
  const entry = (key: string, kind: "block" | "gameplay", title: string, needs: string[]) => ({ key, kind, title, brief: `做${title}`, owner: null, needs, out_of_scope: null })
  // Behaviour is planned as a gameplay entry that needs the thing it attaches to; nothing is left out of scope.
  await call("proposeBlueprint", { projectId, request: "一种矿石方块，挖它的时候响一声", blueprint: played({ style: { palette: ["#3355aa"], shape: "方块感", naming: "中文名", world: "矿洞" }, entries: [entry("ore", "block", "蓝矿石", []), entry("ring", "gameplay", "挖矿石会响", ["ore"])], questions: [] }), paper_play: PAPER })
  await service.confirmBlueprint({ projectId, revision: 1 })
  const first = (await call("nextBatch", { projectId })) as ExternalStartResult
  const ids = (batch: ExternalStartResult, key: string) => ({ projectId, runId: batch.run.id, taskId: batch.tasks.find((value) => value.task.key === key)!.task.id })
  await call("claimExternalTask", ids(first, "ore"))
  await call("commitExternalTask", { ...ids(first, "ore"), document: { kind: "block", identifier: "blue_ore", name: "蓝矿石", hardness: 3, luminance: 7, tool: "pickaxe", drop: "self", color: "#3355aa", texture: null } })
  const ring = ids(first, "ring")
  const claim = (await call("claimExternalTask", ring)) as ExternalTaskContext
  const ore = claim.gameplay!.things.find((thing) => thing.title === "蓝矿石")!
  expect(ore).toMatchObject({ kind: "方块", accessor: 'ProjectContent.block("blue_ore")' })
  expect(await service.getGameplay({ projectId, itemId: "ring" })).toMatchObject({ sheet: null, rounds: [], state: "describing", saved: null })
  const document: GameplayDocument = {
    kind: "gameplay",
    slug: "ore_ring",
    name: "挖矿石会响",
    summary: "挖掉蓝矿石的时候，方块的位置响一声铃。",
    behaviours: [{ when: "玩家挖掉一个「蓝矿石」方块时", does: "在方块的位置播放 1 次铃声，音量 1.0", shows: "听到一声铃响，没有别的效果" }],
    not_doing: ["不改变掉落"],
    uses: [ore.asset_id],
    sources: [{ path: "Main.java", content: 'package com.minemods.content_guarded.gameplay.ore_ring;\n\nimport com.minemods.content_guarded.gameplay.api.GameplayEntry;\nimport com.minemods.content_guarded.gameplay.api.ProjectContent;\nimport net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;\nimport net.minecraft.sounds.SoundEvents;\nimport net.minecraft.sounds.SoundSource;\n\npublic final class Main implements GameplayEntry {\n    @Override public void onInitialize() {\n        PlayerBlockBreakEvents.AFTER.register((world, player, pos, state, blockEntity) -> {\n            if (!world.isClientSide() && state.is(ProjectContent.block("blue_ore"))) world.playSound(null, pos, SoundEvents.BELL_BLOCK, SoundSource.BLOCKS, 1.0f, 1.0f);\n        });\n    }\n}\n' }],
    data: [],
    lang: { zh_cn: {}, en_us: {} },
  }
  // A refusal reaches the outside AI word for word through the door.
  await expect(call("checkCodeExternalTask", { ...ring, document })).rejects.toThrow(GAMEPLAY_REFUSALS.no_sheet)
  await call("describeExternalTask", { ...ring, sheet: gameplaySheet(document) })
  expect(await call("checkCodeExternalTask", { ...ring, document })).toMatchObject({ state: "reviewing", check: { passed: true, compiles: { ok: true } } })
  // While it is being written, the card can already read the description and the newest check, by the plan entry's key.
  expect(await service.getGameplay({ projectId, itemId: "ring" })).toMatchObject({ sheet: gameplaySheet(document), state: "reviewing", rounds: [{ round: 1, passed: true }], saved: null })
  await call("finalReviewExternalTask", { ...ring, verdict: { passed: true, findings: [], advice: ["铃声在多人游戏里所有人都听得到"], independent: true } })
  await call("commitExternalTask", { ...ring, document })
  const story = (await service.getGameplay({ projectId, itemId: "ring" }))!
  expect(story).toMatchObject({ state: "done", outcome: "passed", saved: { round: 1, check: { bounds: [], references: [], compile: { ok: true, compiler: "scripted" } }, review: { passed: true, independent: true, advice: ["铃声在多人游戏里所有人都听得到"] } } })
  const overview = await service.getProjectOverview({ projectId })
  const item = overview.items.find((value) => value.id === "ring")!
  expect(item).toMatchObject({ kind: "gameplay", status: "review", facts: { saved: true } })
  expect(overview.kinds.find((kind) => kind.id === "gameplay")).toMatchObject({ label: "玩法", capability: "runtime" })
  // The same record by the asset's id.
  expect(await service.getGameplay({ projectId, itemId: item.asset_id! })).toEqual(story)
  // What the person sees in the activity panel: the check and the review in plain words, and the tool call itself kept for 高级.
  const events = (await service.getActivity({ projectId })).events
  expect(events.filter((event) => event.kind === "check" && event.end).map((event) => event.text)).toEqual(["「挖矿石会响」第 1 版的代码检查通过：能编译、没有越界、引用都对得上。"])
  expect(events.some((event) => event.kind === "review" && event.text === "评审核对了「挖矿石会响」的说明和代码：说明和代码一致。")).toBe(true)
  // The refusal says what is missing and then tells the AI which call to make: the person's line keeps the first, the second stays in the detail for 高级.
  const refused = events.find((event) => event.tool === "check_code" && event.mark === "fail")!
  expect(refused.lines?.[0]).toBe("还没有玩法说明。")
  expect(refused.lines?.join("")).not.toContain("save_sheet")
  expect(refused.detail).toContain(GAMEPLAY_REFUSALS.no_sheet)
}, 60000)

test("按用户自己的话改一份已经保存的玩法（不是蓝图条目、没记过意见）：动态说的和成品卡说的是一件事，编译和审查记录读的是改好的那一版", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-gameplay-revision-"))
  directories.push(root)
  const service = await createStudioService({ workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: TEMPLATE, ai: { mode: "mcp", review:true }, compileGameplay: scripted })
  closers.push(() => service.dispose())
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  const projectId = (await service.createProject({ name: "改玩法", description: "", modId: "revised", empty: true })).project.id
  const entry = (key: string, kind: "block" | "gameplay", title: string, needs: string[]) => ({ key, kind, title, brief: `做${title}`, owner: null, needs, out_of_scope: null })
  await call("proposeBlueprint", { projectId, request: "一种矿石方块，挖它的时候响一声", blueprint: played({ style: { palette: ["#3355aa"], shape: "方块感", naming: "中文名", world: "矿洞" }, entries: [entry("ore", "block", "蓝矿石", []), entry("ring", "gameplay", "挖矿石会响", ["ore"])], questions: [] }), paper_play: PAPER })
  await service.confirmBlueprint({ projectId, revision: 1 })
  const first = (await call("nextBatch", { projectId })) as ExternalStartResult
  const ids = (batch: ExternalStartResult, key: string) => ({ projectId, runId: batch.run.id, taskId: batch.tasks.find((value) => value.task.key === key)!.task.id })
  await call("claimExternalTask", ids(first, "ore"))
  await call("commitExternalTask", { ...ids(first, "ore"), document: { kind: "block", identifier: "blue_ore", name: "蓝矿石", hardness: 3, luminance: 7, tool: "pickaxe", drop: "self", color: "#3355aa", texture: null } })
  const made = ids(first, "ring")
  const claim = (await call("claimExternalTask", made)) as ExternalTaskContext
  const ore = claim.gameplay!.things.find((thing) => thing.title === "蓝矿石")!
  const source = (volume: string) => ({ path: "Main.java", content: `package com.minemods.content_revised.gameplay.ore_ring;\n\nimport com.minemods.content_revised.gameplay.api.GameplayEntry;\nimport com.minemods.content_revised.gameplay.api.ProjectContent;\nimport net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;\nimport net.minecraft.sounds.SoundEvents;\nimport net.minecraft.sounds.SoundSource;\n\npublic final class Main implements GameplayEntry {\n    @Override public void onInitialize() {\n        PlayerBlockBreakEvents.AFTER.register((world, player, pos, state, blockEntity) -> {\n            if (!world.isClientSide() && state.is(ProjectContent.block("blue_ore"))) world.playSound(null, pos, SoundEvents.BELL_BLOCK, SoundSource.BLOCKS, ${volume}f, 1.0f);\n        });\n    }\n}\n` })
  const version = (volume: string): GameplayDocument => ({
    kind: "gameplay",
    slug: "ore_ring",
    name: "挖矿石会响",
    summary: `挖掉蓝矿石的时候，方块的位置响一声铃，音量 ${volume}。`,
    behaviours: [{ when: "玩家挖掉一个「蓝矿石」方块时", does: `在方块的位置播放 1 次铃声，音量 ${volume}`, shows: "听到一声铃响，没有别的效果" }],
    not_doing: ["不改变掉落"],
    uses: [ore.asset_id],
    sources: [source(volume)],
    data: [],
    lang: { zh_cn: {}, en_us: {} },
  })
  const hand = async (task: ReturnType<typeof ids>, document: GameplayDocument) => {
    await call("describeExternalTask", { ...task, sheet: gameplaySheet(document) })
    expect(await call("checkCodeExternalTask", { ...task, document })).toMatchObject({ state: "reviewing", check: { passed: true } })
    await call("finalReviewExternalTask", { ...task, verdict: { passed: true, findings: [], advice: [], independent: true } })
    await call("commitExternalTask", { ...task, document })
  }
  await hand(made, version("1.0"))
  const item = () => service.getProjectOverview({ projectId }).then((view) => view.items.find((value) => value.id === "ring")!)
  expect(await item()).toMatchObject({ status: "review", review_asked: true })

  // The person asks the outside AI, in their own words, to change it: a small plan of its own that revises the saved thing. No blueprint entry names it, and no verdict was recorded first.
  const prompt = "把挖矿石的铃声调小一点"
  const revision = (await call("startExternal", { projectId, expectedRevision: (await service.openProject(projectId)).project.revision, prompt, plan: { summary: "铃声调小", questions: [], tasks: [{ key: "ring_again", module: "gameplay", title: "挖矿石会响修订", prompt, source: "调小一点", dependencies: [], target_id: (await item()).asset_id }] } })) as ExternalStartResult
  const again = ids(revision, "ring_again")
  await call("claimExternalTask", again)
  // Taken and not touched: the thing waits, it is not written.
  expect(await item()).toMatchObject({ status: "making", status_label: "在排队" })
  await hand(again, version("0.4"))

  // The line in 动态 and the card of the thing say the same: it waits for the person, and the card has the button for it.
  expect(await item()).toMatchObject({ status: "review", status_label: "等你验收", review_asked: true, facts: { accepted: null } })
  const lines = (await service.getActivity({ projectId })).events.filter((event) => event.kind === "task" && event.end && event.title === "挖矿石会响修订").map((event) => event.text)
  expect(lines).toEqual(["做好了，已经保存，等你验收。"])

  // The compile and review records the card reads are the revision's (by the plan entry's key, the item's id), not the first version's and not none.
  const story = (await service.getGameplay({ projectId, itemId: "ring" }))!
  expect(story.sheet?.summary).toContain("音量 0.4")
  expect(story).toMatchObject({ state: "done", outcome: "passed", saved: { round: 1, check: { compile: { ok: true, compiler: "scripted" } }, review: { passed: true, independent: true } } })
  expect(await service.getGameplay({ projectId, itemId: (await item()).asset_id! })).toEqual(story)
}, 60000)

test("两条路共用一套实现：玩法也只从保存任务资产的那一个门进工程，运行器里没有第二份规则", async () => {
  const source = await Bun.file(new URL("../src/main/project-runner.ts", import.meta.url)).text()
  const door = source.slice(source.indexOf("async function saveTaskAsset("), source.indexOf("async function runTask("))
  // The gameplay loop is asked inside the one door, before the standard and before anything is written.
  expect(door.indexOf("gameplay.gate(")).toBeGreaterThan(0)
  expect(door.indexOf("gameplay.gate(")).toBeLessThan(door.indexOf("acceptanceReview("))
  expect(door.indexOf("gameplay.saved(")).toBeGreaterThan(door.indexOf("applyWorkspaceAsset("))
  // One loop object; Studio's own AI (`craft`) and the outside AI's steps (`externalGameplay`) are both built on it.
  expect(source.split("createGameplayLoop(").length - 1).toBe(1)
  expect(source.split("externalGameplay(gameplay,").length - 1).toBe(1)
  expect(source.split("gameplay.craft(").length - 1).toBe(1)
  // The runner holds no rule of the loop and no sentence of its own about gameplay.
  expect(source).not.toMatch(/gameplayCommitGate\(|checkedGameplay\(|reviewedGameplay\(|describeGameplay\(|staticChecks\(|scanGameplay\(|GAMEPLAY_REFUSALS/)
  const loop = await Bun.file(new URL("../src/main/gameplay-loop.ts", import.meta.url)).text()
  // In the loop file, the two paths call the same four steps.
  for (const step of ["loop.describe(", "loop.check(", "loop.packet(", "loop.review("]) expect({ step, calls: loop.split(step).length - 1 }).toEqual({ step, calls: 1 })
  for (const step of ["this.describe(", "this.check(", "this.packet(", "this.review("]) expect({ step, calls: loop.split(step).length - 1 }).toEqual({ step, calls: 1 })
})

// ---- 10-07 audit: 「审查」 with two windows, and a refusal that should not end a task ----
test("两个窗口，玩法的最后一版没通过审查：审查的窗口去领下一样，写代码的窗口被告知版数用完、留下了哪一版", async () => {
  const { project, directory, runner } = await bench()
  const { ids, assetId } = await claimed(runner, project)
  await runner.describeExternalTask({ ...ids, sheet: gameplaySheet(BAD.claims_a_drop) })
  const failing = { ...REVIEWS.claims_a_drop, independent: true }
  // Version 1 passes its checks and goes to the reviewing window, which fails it.
  expect(await checked(runner, { ...ids, document: BAD.claims_a_drop })).toMatchObject({ state: "reviewing", next_step: INSPECTION_WORDS.maker })
  const first = (await runner.nextInspection({ projectId: project.id, wait_seconds: 0 })) as unknown as { task: typeof ids }
  expect(await runner.finalReviewExternalTask({ ...first.task, verdict: failing })).toMatchObject({ state: "writing", next_step: INSPECTION_WORDS.recorded })
  expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toMatchObject({ waiting: false, review: { passed: false }, next_step: expect.stringContaining("评审没通过") })
  // The versions in between do not compile; the last one allowed passes its checks and is failed by the reviewer too.
  const broken = (index: number) => variant(index, { ...BAD.does_not_compile, behaviours: BAD.claims_a_drop.behaviours })
  for (const index of Array.from({ length: GAMEPLAY_LIMITS.rounds - 2 }, (_, value) => value + 2)) expect(await checked(runner, { ...ids, document: broken(index) })).toMatchObject({ round: index, state: "writing" })
  expect(await checked(runner, { ...ids, document: variant(GAMEPLAY_LIMITS.rounds, BAD.claims_a_drop) })).toMatchObject({ round: GAMEPLAY_LIMITS.rounds, state: "reviewing" })
  const last = (await runner.nextInspection({ projectId: project.id, wait_seconds: 0 })) as unknown as { task: typeof ids }
  expect(last.task).toEqual(ids)
  // Nothing is thrown at the reviewer, and it is not sent to the writer's next batch.
  expect(await runner.finalReviewExternalTask({ ...last.task, verdict: failing })).toMatchObject({ review: { passed: false }, next_step: INSPECTION_WORDS.recorded })
  expect((await runner.get({ projectId: project.id, runId: ids.runId })).tasks[0]).toMatchObject({ state: "completed", outcome: "kept_unsatisfied" })
  expect(await readGameplay(directory, assetId)).toMatchObject({ state: "done", outcome: "kept_unsatisfied", kept_round: GAMEPLAY_LIMITS.rounds })
  const ended = `${GAMEPLAY_REFUSALS.out_of_rounds(GAMEPLAY_LIMITS.rounds)}${GAMEPLAY_REFUSALS.kept(GAMEPLAY_LIMITS.rounds)}`
  for (const _ of [1, 2]) expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toMatchObject({ waiting: false, state: "done", rounds_left: 0, next_step: `${ended}接下来：这一批已经结束。调用 next_batch 看接下来做什么。` })
  const reply = await words(runner.checkCodeExternalTask({ ...ids, document: variant(GAMEPLAY_LIMITS.rounds, BAD.claims_a_drop) }))
  expect(reply).toStartWith("这一版代码检查通过，独立评审没有通过：")
  expect(reply).toContain(REVIEWS.claims_a_drop.findings[0]!)
  expect(reply).toEndWith(`${ended}接下来：这一批已经结束。调用 next_batch 看接下来做什么。`)
  expect(ended).toContain(UNSATISFIED.mark)
  expect(ended).not.toContain("还可以检查")
  // A gameplay that failed outright says that nothing was kept, and where to go on.
  const record = (await readGameplay(directory, assetId))!
  expect(gameplayStep({ ...record, state: "stopped", outcome: "failed", kept_round: undefined }, false, false, "").next_step).toBe(`${GAMEPLAY_REFUSALS.out_of_rounds(GAMEPLAY_LIMITS.rounds)}${GAMEPLAY_REFUSALS.nothing_kept}`)
})

// B18-J-01 for gameplay: rewriting the description voids the review of the version handed out, and the same code, checked again, goes to the reviewing window at once.
test("两个窗口，玩法：交出去的那一版审过之后改了说明，再检查同一份代码，审查的窗口下一次就拿到它", async () => {
  const { project, runner } = await bench()
  const { ids } = await claimed(runner, project)
  await runner.describeExternalTask({ ...ids, sheet: gameplaySheet(BOX_GUARD) })
  await checked(runner, { ...ids, document: BOX_GUARD })
  const first = (await runner.nextInspection({ projectId: project.id, wait_seconds: 0 })) as unknown as { task: typeof ids }
  await runner.finalReviewExternalTask({ ...first.task, verdict: { ...REVIEWS.good, independent: true } })
  const reworded = { ...BOX_GUARD, summary: "改过的说明" }
  await runner.describeExternalTask({ ...ids, sheet: gameplaySheet(reworded) })
  expect(await checked(runner, { ...ids, document: reworded })).toMatchObject({ state: "reviewing" })
  expect(await runner.nextInspection({ projectId: project.id, wait_seconds: 0 })).toMatchObject({ waiting: false, task: ids })
})

test("两个窗口，评审说缺材料：再评审的那一次也由审查的窗口来做——写代码的窗口再等一次就是请它再评，不是自己去写结论", async () => {
  const { project, directory, runner } = await bench()
  const { ids, assetId } = await claimed(runner, project)
  await runner.describeExternalTask({ ...ids, sheet: gameplaySheet(BOX_GUARD) })
  await checked(runner, { ...ids, document: BOX_GUARD })
  const handed = (await runner.nextInspection({ projectId: project.id, wait_seconds: 0 })) as unknown as { task: typeof ids }
  const lacking = ["生成的生物类里 doHurtTarget 做了什么，code 里看不到"]
  expect(await runner.finalReviewExternalTask({ ...handed.task, verdict: { passed: false, findings: ["说明写了出手有动作，代码只调用 doHurtTarget"], lacking, independent: true } })).toMatchObject({ state: "writing", next_step: INSPECTION_WORDS.recorded })
  // Nobody has asked for the second review yet: the reviewer is not handed the same version again by itself.
  expect(await runner.nextInspection({ projectId: project.id, wait_seconds: 0 })).toEqual({ waiting: true, how: INSPECTION_WORDS.nothing })
  // The writer hears the verdict, and that the second review is the other window's to hold.
  const told = (await runner.awaitInspection({ ...ids, wait_seconds: 0 })) as { next_step: string }
  expect(told).toMatchObject({ waiting: false, review: { passed: false }, next_step: GAMEPLAY_AGAIN_APART(lacking, GAMEPLAY_LIMITS.rounds - 1) })
  expect(told.next_step).toContain("再调用一次 await_inspection")
  expect(told.next_step).toContain("不要自己调用 final_review")
  // Waiting once more on that version is the asking: it is offered to the reviewer again, the writer waits like for any other version.
  expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toEqual({ waiting: true, how: INSPECTION_WORDS.pending })
  const again = (await runner.nextInspection({ projectId: project.id, wait_seconds: 0 })) as unknown as { task: typeof ids; how: string }
  expect(again).toMatchObject({ waiting: false, task: ids, how: INSPECTION_WORDS.reviewer })
  expect(await runner.finalReviewExternalTask({ ...again.task, verdict: { ...REVIEWS.good, independent: true } })).toMatchObject({ review: { passed: true }, next_step: INSPECTION_WORDS.recorded })
  expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toMatchObject({ waiting: false, review: { passed: true }, next_step: expect.stringContaining("commit_task") })
  expect(await words(runner.commitExternalTask({ ...ids, document: BOX_GUARD }))).toBe("accepted")
  expect((await readGameplay(directory, assetId))!.review).toMatchObject({ passed: true, again: true })
})

test("Studio 自己的 AI 写玩法：这一版存不进工程不算任务失败，带着原因再写一版", async () => {
  const { directory } = await bench()
  const loop = createGameplayLoop({ compile: scripted })
  const task = { id: crypto.randomUUID(), asset_id: crypto.randomUUID(), module: "gameplay" as const, title: "守匣警报", prompt: "守着秘匣的敌对生物", source: "守着秘匣的敌对生物" }
  const written: Record<string, any>[] = []
  const saves: unknown[] = []
  const refusal = REFUSALS.unsaveable("它挂着的那样东西已经不在工程里了。")
  await loop.craft({
    work: { directory, run: { prompt: REQUEST }, task },
    ask: (async (_schema: unknown, input: Record<string, any>, instructions: string) => {
      if (instructions === GAMEPLAY_SHEET_INSTRUCTIONS) return gameplaySheet(BOX_GUARD)
      if (instructions === GAMEPLAY_REVIEWER_INSTRUCTIONS) return { passed: true, findings: [], advice: [], lacking: [] }
      written.push(input)
      const document = variant(written.length)
      return { sources: document.sources, data: document.data, lang: document.lang }
    }) as never,
    step: async () => undefined,
    // The door cannot store the first version; the second goes in.
    save: (async (document: unknown) => {
      saves.push(document)
      if (saves.length === 1) throw new SaveRefusal(refusal)
      return { asset: {}, review: {} }
    }) as never,
    signal: new AbortController().signal,
  })
  expect(saves).toHaveLength(2)
  expect(written).toHaveLength(2)
  expect(written[1]!.making).toMatchObject({ round: 2 })
  expect(written[1]!.revision_required.findings).toEqual([refusal])
  // Any other failure of the save is still a failure.
  const other = { ...task, id: crypto.randomUUID(), asset_id: crypto.randomUUID() }
  const broke = loop.craft({ work: { directory, run: { prompt: REQUEST }, task: other }, ask: (async (_schema: unknown, _input: unknown, instructions: string) => (instructions === GAMEPLAY_SHEET_INSTRUCTIONS ? gameplaySheet(BOX_GUARD) : instructions === GAMEPLAY_REVIEWER_INSTRUCTIONS ? { passed: true, findings: [], advice: [], lacking: [] } : { sources: BOX_GUARD.sources, data: BOX_GUARD.data, lang: BOX_GUARD.lang })) as never, step: async () => undefined, save: async () => Promise.reject(new Error("磁盘满了。")), signal: new AbortController().signal })
  expect(await broke.then(() => "saved", (error: Error) => error.message)).toBe("磁盘满了。")
})

test("编译在等什么：换了阶段（环境准备、网络断了重试）当时就写进活动里的那一行和任务的说明，不是几分钟后才补一句", async () => {
  const gate: { open: () => void } = { open: () => undefined }
  const opened = new Promise<void>((resolve) => (gate.open = resolve))
  const stages = async (input: Parameters<GameplayCompile>[0]) => {
    // The stage the first-time environment is in is told by the compiler's own output; a broken download is the next stage, and the compile follows.
    await Bun.sleep(40)
    input.onProgress?.("A download broke off, trying again\n")
    await opened
    return scripted(input)
  }
  // The regular beat is far away, so any line about the retry can only have come from the change of stage itself.
  const { project, directory, runner } = await bench({ compile: stages, timing: { first: 40, again: 40, early: 15, beat: 60000 } })
  const { ids } = await claimed(runner, project)
  await runner.describeExternalTask({ ...ids, sheet: gameplaySheet(BOX_GUARD) })
  expect(await runner.checkCodeExternalTask({ ...ids, document: BOX_GUARD })).toMatchObject({ finished: false })
  const told = async (stage: string): Promise<void> => {
    const lines = (await readActivity(directory)).events.filter((event) => event.step && event.text.startsWith("正在编译检查「守匣警报」的代码，已经 "))
    if (lines.some((event) => event.text.endsWith(`：${stage}。`) && event.lines?.[0] === `${stage}。`)) return
    await Bun.sleep(10)
    return told(stage)
  }
  await told(CHECK_STAGES.retrying)
  // The activity line and the task's description are two writes made one after the other, so the second is waited for rather than read at the instant the first shows.
  const described = async (tries: number): Promise<string> => {
    const detail = (await runner.get({ projectId: ids.projectId, runId: ids.runId })).tasks[0]!.detail ?? ""
    if (detail.includes(CHECK_STAGES.retrying) || tries <= 0) return detail
    await Bun.sleep(10)
    return described(tries - 1)
  }
  expect(await described(300)).toContain(CHECK_STAGES.retrying)
  // What the person reads is what the outside AI is told: the same words, in plain Chinese.
  expect(CHECK_STAGES.retrying).not.toMatch(/[A-Za-z]{4,}/)
  gate.open()
  expect(await checked(runner, { ...ids, document: BOX_GUARD })).toMatchObject({ finished: true, check: { passed: true } })
})

/** What Studio's own AI is asked, in order, with a script for each kind of request: the sheet, the code and the review. */
function scripted_craft(answers: { sheet: GameplayDocument; write: (round: number) => Record<string, unknown>; review?: () => Record<string, unknown> }) {
  const asked: { kind: "sheet" | "write" | "review"; input: Record<string, any> }[] = []
  const ask = (async (_schema: unknown, input: Record<string, any>, instructions: string) => {
    const kind = instructions === GAMEPLAY_SHEET_INSTRUCTIONS ? "sheet" : instructions === GAMEPLAY_REVIEWER_INSTRUCTIONS ? "review" : "write"
    asked.push({ kind, input })
    const count = asked.filter((call) => call.kind === kind).length
    return kind === "sheet" ? gameplaySheet(answers.sheet) : kind === "review" ? (answers.review?.() ?? { passed: true, findings: [], advice: [], lacking: [] }) : answers.write(count)
  }) as never
  return { asked, ask }
}
const taskOf = (title: string, prompt = "一个玩法") => ({ id: crypto.randomUUID(), asset_id: crypto.randomUUID(), module: "gameplay" as const, title, prompt, source: prompt })
const files = (document: GameplayDocument) => ({ sources: document.sources, data: document.data, lang: document.lang })

test("写玩法的、写说明的、评审的 AI 都拿到：这些东西已经会做什么、由谁做（包括别的玩法的说明）；还没写说明的玩法按计划里的题目和一句话告诉它", async () => {
  const { project, directory, runner } = await bench()
  // The first gameplay is in the project, listing the creature and the block.
  const guard = await claimed(runner, project)
  await runner.describeExternalTask({ ...guard.ids, sheet: gameplaySheet(BOX_GUARD) })
  await checked(runner, { ...guard.ids, document: BOX_GUARD })
  await runner.finalReviewExternalTask({ ...guard.ids, verdict: { ...REVIEWS.good, independent: true } })
  await runner.commitExternalTask({ ...guard.ids, document: BOX_GUARD })

  // The second is written beside a third that has no description yet.
  const loop = createGameplayLoop({ compile: scripted })
  const task = taskOf("守卫恋家", "苔皮苦力怕会回家")
  const planned = { ...taskOf("孵蛋", "右键地面用彩虹蛋孵小鸡"), state: "running" as const }
  const script = scripted_craft({ sheet: GUARDIAN_HOME, write: () => files(GUARDIAN_HOME) })
  await loop.craft({ work: { directory, run: { prompt: REQUEST, tasks: [planned] as never }, task }, ask: script.ask, step: async () => undefined, save: (async () => ({ asset: {}, review: {} })) as never, signal: new AbortController().signal })
  const [sheet, write, review] = script.asked
  expect(script.asked.map((call) => call.kind)).toEqual(["sheet", "write", "review"])
  const byGuard = { by: `玩法「${BOX_GUARD.name}」`, does: expect.stringContaining(BOX_GUARD.summary) }
  const creatureLines = (input: Record<string, any>) => (input.things as { title: string; already?: unknown[] }[]).find((thing) => thing.title === "苔皮苦力怕")!.already
  expect(creatureLines(sheet!.input)).toContainEqual(byGuard)
  expect(creatureLines(write!.input)).toContainEqual(byGuard)
  // The creature's own settings come with it: nothing has to be written for what it does by itself.
  expect(creatureLines(write!.input)).toContainEqual({ by: "它自己", does: "会打人：自己找最近的、看得见的玩家打" })
  // A gameplay with no description yet is known by its title and what the plan says of it, cut where a description's summary is cut.
  expect(sheet!.input.not_yet_described).toEqual([{ title: "孵蛋", brief: "右键地面用彩虹蛋孵小鸡" }])
  expect(write!.input.not_yet_described).toEqual([{ title: "孵蛋", brief: "右键地面用彩虹蛋孵小鸡" }])
  // The reviewer is given the same for the things this gameplay lists, and they come from the documents, not from the writing.
  expect(review!.input.already).toEqual([{ thing: "苔皮苦力怕", already: expect.arrayContaining([byGuard, { by: "它自己", does: "会打人：自己找最近的、看得见的玩家打" }]) }])
  // A task of the run that is over, or the gameplay itself, is no neighbour.
  const alone = scripted_craft({ sheet: GUARDIAN_HOME, write: () => files(GUARDIAN_HOME) })
  await loop.craft({ work: { directory, run: { prompt: REQUEST, tasks: [{ ...planned, state: "completed" }, { ...task, state: "running" }] as never }, task: taskOf("守卫恋家", "苔皮苦力怕会回家") }, ask: alone.ask, step: async () => undefined, save: (async () => ({ asset: {}, review: {} })) as never, signal: new AbortController().signal })
  expect(alone.asked[0]!.input.not_yet_described).toBeUndefined()
  // Outside AI is told the same when it claims the task.
  const claim = await claimed(runner, await openProject(directory), "守卫恋家二")
  expect(claim.context.gameplay!.things.find((thing) => thing.title === "苔皮苦力怕")!.already).toContainEqual(byGuard)
}, 120000)

test("写代码的 AI 发现说明本身有问题：交上改好的说明和理由，被收下、检查和评审照新的说明；评审看到改了什么和为什么", async () => {
  const { directory } = await bench()
  const loop = createGameplayLoop({ compile: scripted })
  const sheet = gameplaySheet(BOX_GUARD)
  const smaller = { ...sheet, behaviours: sheet.behaviours.slice(0, 1), not_doing: [...sheet.not_doing, "不会一直跟着玩家"] }
  const because = "第二条行为要它不跟着玩家，可它自己会跟着手里拿着小麦的玩家走"
  const script = scripted_craft({ sheet: BOX_GUARD, write: () => ({ ...files(BOX_GUARD), sheet_change: { because, sheet: smaller } }) })
  const saved: GameplayDocument[] = []
  const task = taskOf("守匣警报")
  await loop.craft({ work: { directory, run: { prompt: REQUEST }, task }, ask: script.ask, step: async () => undefined, save: (async (document: GameplayDocument) => (saved.push(document), { asset: {}, review: {} })) as never, signal: new AbortController().signal })
  // The code was written to the first description; the version checked, reviewed and saved carries the one asked for.
  const [, write, review] = script.asked
  expect(write!.input.sheet).toEqual(sheet)
  expect(saved).toHaveLength(1)
  expect(saved[0]!.behaviours).toEqual(smaller.behaviours)
  expect(saved[0]!.not_doing).toEqual(smaller.not_doing)
  expect(review!.input.description).toEqual(smaller)
  expect(review!.input.amended).toEqual([{ because, changes: [expect.stringContaining("去掉了行为"), "加上了它不做的事：不会一直跟着玩家"] }])
  const record = (await readGameplay(directory, task.asset_id))!
  expect(record.amendments).toEqual([expect.objectContaining({ round: 1, because })])
  expect(record.review).toMatchObject({ passed: true, independent: true })
  // The reviewer is told what to do with it, in the same words wherever it is asked.
  expect(GAMEPLAY_REVIEWER_INSTRUCTIONS).toContain("amended")
  expect(GAMEPLAY_WRITER_INSTRUCTIONS).toContain("sheet_change")
}, 60000)

test("要改的说明没有被收下（改了包名）：说明还是原来的，下一版的意见里先说为什么；一直不改说明也不会因此多占一版", async () => {
  const { directory } = await bench()
  const loop = createGameplayLoop({ compile: scripted })
  const sheet = gameplaySheet(BOX_GUARD)
  // Version 1 does not compile and asks for a description under another name; version 2 is good and asks for nothing.
  const script = scripted_craft({ sheet: BOX_GUARD, write: (round) => (round === 1 ? { ...files(BAD.does_not_compile), sheet_change: { because: "换个名字", sheet: { ...sheet, slug: "other_name" } } } : { ...files(BOX_GUARD), sheet_change: null }) })
  const task = taskOf("守匣警报")
  const refusal = gameplayOwnWords(GAMEPLAY_REFUSALS.amend_slug("box_guard"))
  await loop.craft({ work: { directory, run: { prompt: REQUEST }, task }, ask: script.ask, step: async () => undefined, save: (async () => ({ asset: {}, review: {} })) as never, signal: new AbortController().signal })
  const writes = script.asked.filter((call) => call.kind === "write")
  expect(writes).toHaveLength(2)
  expect(writes[1]!.input.sheet).toEqual(sheet)
  expect(writes[1]!.input.revision_required.findings[0]).toBe(GAMEPLAY_SHEET_CHANGE_REFUSED(refusal))
  expect(writes[1]!.input.revision_required.findings[1]).toStartWith("Pulse.java 第 34 行：编译不过")
  expect((await readGameplay(directory, task.asset_id))!.amendments).toBeUndefined()
}, 60000)

test("外部 AI 检查过以后再调用 save_sheet 改说明：评审拿到的材料里写明改过什么、没有写理由", async () => {
  const { project, runner } = await bench()
  const { ids } = await claimed(runner, project)
  const sheet = gameplaySheet(BOX_GUARD)
  const smaller = { ...sheet, behaviours: sheet.behaviours.slice(0, 1) }
  await runner.describeExternalTask({ ...ids, sheet })
  await checked(runner, { ...ids, document: BOX_GUARD })
  // The first description is no change; after code was checked, the same call is one.
  await runner.describeExternalTask({ ...ids, sheet: smaller })
  const document = { ...BOX_GUARD, ...smaller }
  await checked(runner, { ...ids, document })
  const packet = (await runner.finalReviewExternalTask(ids)) as { input: Record<string, any> }
  expect(packet.input.description).toEqual(smaller)
  expect(packet.input.amended).toEqual([{ because: "没有写理由", changes: [expect.stringContaining("去掉了行为")] }])
}, 60000)
