import { createInspectionReceipts } from "../src/main/inspection-receipts"
import { afterEach, expect, test } from "bun:test"
import { PAPER, played } from "./playable-fixture"
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { readActivity } from "@minemods/mod-core/activity"
import os from "node:os"
import path from "node:path"
import { createProject, openProject } from "@minemods/mod-core/project"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { ModelingError } from "@minemods/studio-ai/policy"
import { getModuleSchema, type ModuleDocument } from "@minemods/mod-core/workspace"
import { GESTURE_EXAMPLE } from "@minemods/mod-core/gesture-bases"
import {
  changeMaking,
  describe as describeSheet,
  edit as editSheet,
  listMakings,
  FINDING_CONTRASTS,
  FINDING_LABELS,
  FINDING_LINE,
  LOOKED_KINDS,
  MAKING_DISCIPLINE,
  MAKING_DISCIPLINE_OWN,
  OWN_GLANCE_INSTRUCTIONS,
  ownWords,
  TOOL_VOICE,
  MAKING_LIMITS,
  MAKING_MODELS,
  MAKING_SUMMARY,
  MakingRefusal,
  NO_VISION_WORDS,
  readMaking,
  REFUSALS,
  REVIEWER_HANDOFF,
  REVIEWER_INSTRUCTIONS,
  REVIEWER_LAST_WORD,
  SELF_REVIEW_INSTRUCTIONS,
  SHEET_INSTRUCTIONS,
  UNSATISFIED,
} from "@minemods/mod-core/making"
import { MODULES } from "@minemods/mod-core/workspace"
import { sizeNextToPlayer, CREATURE_TIERS } from "@minemods/mod-core/creature-tier"
import { REVIEW_SWITCH, SOLO_VOICE, TIER_REVIEW_RULE, TOLERATED, CONCEPT_GUIDE, conceptPrompt, REFERENCE_GUIDE, REFERENCE_LIMITS, REFERENCE_ZOOM_GUIDE, REFERENCE_NOTE, REFERENCE_REFUSALS, REFERENCE_SHEET_NAME, THREE_VIEW_GUIDE, THREE_VIEW_REVIEW_RULE, threeViewPrompt } from "@minemods/studio-ai/making"
import { BUDGET_REFUSALS } from "@minemods/studio-ai/budget"
import { MOTION_VISIBLE } from "@minemods/studio-ai/model-motion"
import { SCRIPT_API, SCRIPT_ERRORS, SCRIPT_EXAMPLE, SCRIPT_GUIDE, SCRIPT_LIMITS, SCRIPT_SUMMARY } from "@minemods/studio-ai/script"
import { addReference, readReferences, setThreeView, shownReferences } from "@minemods/mod-core/making"
import { THREE_VIEW_DRAWING } from "../src/main/reference-service"
import { PARALLEL_WORDS } from "@minemods/mod-core/workspace-runs"
import { createBlueprintService, REDO_BESIDE_WORDS } from "../src/main/blueprint-service"
import { referenceSheet } from "../src/main/look-job"
import { SCRIPT_REPAIRS, SCRIPTED_ANSWER_INSTRUCTIONS } from "../src/main/script-door"
import { forgetMissingPictureRoutes, requestPicture } from "@minemods/ai-service/image-request"
import { createProjectRunner, INSPECTION_PATIENCE, INSPECTION_WORDS, REVIEWER_SILENCE_SECONDS, reviewContext, UNSAID } from "../src/main/project-runner"
import { createStudioService, dispatchStudioRequest, publicError } from "../src/main/service"
import { dispatchExternal, externalError } from "../src/main/external-dispatch"
import { buildMcpHandoff, buildMcpReviewHandoff, MCP_MAKING_ENDINGS, MCP_MAKING_REFUSALS, MCP_MAKING_WORKFLOW, MCP_TOOLS } from "../src/main/mcp-handoff"
import { everythingToRead } from "./handoff-reading"
import { getMcpCapabilities, MCP_INSPECTION } from "../src/main/mcp-capabilities"
import { lookJob, lookQueue, needJob, reviewJob, type LookJob, type LookPictures, type LookRenderer } from "../src/main/look-job"
import { output, pictured } from "../src/main/mcp-content"
import type { ExternalStartResult, ExternalTaskContext } from "../src/external"
import type { Making } from "../src/api"
import slime from "../../studio-ai/test/fixtures/look/good/sprout-slime.json"

const directories: string[] = []
const closers: (() => unknown)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const good = { kind: "model" as const, ...ModelDesignSchema.parse(slime.model) }
/** The same creature under another name: a different version of the document that still passes the standard. */
const named = (name: string) => ({ ...good, name })
/** One plain box that never moves: what the standard refuses. */
const weak = {
  kind: "model" as const,
  ...ModelDesignSchema.parse({
    name: "两块",
    texture_size: 64,
    bones: [{ name: "root", parent: null, pivot: [0, 8, 0], rotation: [0, 0, 0], cubes: [{ name: "body", origin: [-2, 4, -2], size: [4, 4, 4], faces: { north: "#aa6644", east: "#aa6644", south: "#aa6644", west: "#aa6644", up: "#ddaa77", down: "#664422" } }] }],
    animations: ["idle", "walk", "hurt"].map((name) => ({ name, length: 1, loop: name !== "hurt", channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [0, 0, 0] }] }] })),
  }),
}
const sheet = {
  subject: "一只守着蓝色矿石的洞穴守卫，敌对生物。",
  recognisable: ["圆滚滚的身体", "头顶一株嫩芽", "一双看得清的眼睛"],
  parts: [
    { name: "body", what: "身体", shape: "圆角方块，约 12×10×12 像素", attaches: "直接落在地上", surface: "半透明的绿色凝胶，正面一双深色眼睛", moves: "走路时一压一弹", assumed: false },
    { name: "sprout", what: "嫩芽", shape: "细茎加两片叶子，高约 6 像素", attaches: "长在身体顶面正中", surface: "嫩绿色，叶脉稍深", moves: "跟着身体晃", assumed: true },
  ],
  assumed: ["人没说头顶有什么：定成一株嫩芽"],
}
/** The same creature with a fourth motion of its own. */
const fourMotions = { ...good, animations: [...good.animations, { ...good.animations.find((value) => value.name === "hurt")!, name: "attack" }] }
/** What the set drawn for a reviewer of the creature holds: every side, the bare shape, and each of its three motions from two directions. */
/** What Studio's own AI is shown of the first version of this model: every side, the first motion, the bare shape, then the other motions (all new, so all due), each from a look of its own. */
const FIRST_SEEN = ["六个角度", "待机（idle） · 斜前方", "只看形状", "走路（walk） · 斜前方", "受伤（hurt） · 斜前方"]
const REVIEW_SET = ["六个角度", "只看形状", "待机（idle） · 斜前方", "待机（idle） · 它的左侧", "走路（walk） · 斜前方", "走路（walk） · 它的左侧", "受伤（hurt） · 斜前方", "受伤（hurt） · 它的左侧"]
const revise = { matches: ["身体的比例对"], problems: ["正面远看认不出脸"], next: ["把眼睛加大并提亮"], verdict: "revise" as const }
/** A maker that keeps finding something new to change: another thing each version, so none of it is a problem it already named of the version before (which would stop blocking, `carriedOver`). */
const anotherProblem = (round: number) => ["正面远看认不出脸", "左边的手臂悬在半空没有接上", "背上的矿石比说明里多了两块", "脚陷进地里一大截", "尾巴比身子还长", "头顶少了一只角"][(round - 1) % 6]!
const done = { matches: ["每个部件都和说明一致"], problems: [], next: [], verdict: "done" as const }

/** A stand-in for the hidden window: answers every job with one tiny picture per sheet, and keeps the jobs. */
function renderer(answer?: (job: LookJob) => LookPictures) {
  const jobs: LookJob[] = []
  const look: LookRenderer = async (job) => {
    jobs.push(job)
    return answer?.(job) ?? { ok: true, pictures: job.sheets.map((value) => ({ label: value.label, url: PIXEL })) }
  }
  return { jobs, look }
}

async function bench(options: { look?: LookRenderer; ai?: { apiKey?: string; baseUrl?: string; retryWait?: readonly number[]; review?: boolean; reviewDefaults?: "by-mode"; mode?: "mcp" | "api"; reviewModel?: string; moduleModel?: string }; sees?: "yes" | "no" | "unknown"; draws?: (request: { prompt: string }) => Promise<string | null>; canDraw?: () => boolean; pauseInspection?: (ms: number) => Promise<void> } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-making-"))
  directories.push(root)
  const directory = path.join(root, "project")
  const created = await createProject({ directory, name: "看着做", description: "" })
  const asked: string[] = []
  const runner = createProjectRunner({
    directoryFor: async () => directory,
    ai: options.ai ?? {},
    look: options.look,
    sees: async (connection) => {
      asked.push(connection.model)
      return options.sees ?? "yes"
    },
    draws: options.draws,
    canDraw: options.canDraw,
    pauseInspection: options.pauseInspection,
  })
  closers.push(() => runner.dispose())
  return { created, directory, runner, asked }
}

async function claimed(runner: ReturnType<typeof createProjectRunner>, projectId: string, revision: number, module: "model" | "worldview" | "gesture" = "model") {
  const started = await runner.startExternal({
    projectId,
    expectedRevision: revision,
    prompt: "一只守着矿石的敌对生物",
    plan: { summary: "守卫", questions: [], tasks: [{ key: "guardian", module, title: "洞穴守卫", prompt: "守着矿石的敌对生物", source: "守着矿石的敌对生物", dependencies: [], target_id: null }] },
  })
  const ids = { projectId, runId: started.run.id, taskId: started.run.tasks[0]!.id }
  return { ids, assetId: started.run.tasks[0]!.asset_id, context: await runner.claimExternalTask(ids) }
}

const words = (step: Promise<unknown>) => step.then(() => "accepted", (error: Error) => error.message)

test("外部 AI：提交被拒绝的每一种情况，原话都说清楚缺哪一步；走完才保存", async () => {
  const hidden = renderer()
  const { created, directory, runner } = await bench({ look: hidden.look })
  const { ids, assetId, context } = await claimed(runner, created.id, created.revision)
  // The claim says the thing is made by looking, with the order of work and the cap.
  // It also says a script may be handed in for this kind, and what references are attached (none here).
  expect(context.making).toEqual({ discipline: MAKING_DISCIPLINE, sheet: null, remark: null, rounds_allowed: MAKING_LIMITS.rounds, next_step: "先用 save_sheet 写部件说明。", script: SCRIPT_SUMMARY, references: [], three_view: { present: false, by: null, views: [], missing: [], words: "" }, reference_guide: `${REFERENCE_GUIDE}${CONCEPT_GUIDE}${REFERENCE_ZOOM_GUIDE}` })
  const commit = (document: unknown) => words(runner.commitExternalTask({ ...ids, document }))
  const state = async () => (await runner.get({ projectId: created.id, runId: ids.runId })).tasks[0]!.state
  const kept = "任务保持运行，工程里什么都没有改动。"

  expect(await commit(good)).toBe(`${REFUSALS.no_sheet}${kept}`)
  expect(await words(runner.lookExternalTask({ ...ids, document: good }))).toBe(REFUSALS.no_sheet)
  expect(hidden.jobs).toHaveLength(0)
  expect(await runner.describeExternalTask({ ...ids, sheet })).toMatchObject({ sheet: { ...sheet, remark: null }, state: "making", round: 0, next_step: expect.stringContaining("look") })
  expect(await commit(good)).toBe(`${REFUSALS.no_look}${kept}`)

  const first = await runner.lookExternalTask({ ...ids, document: good })
  expect(first).toMatchObject({ round: 1, rounds_allowed: MAKING_LIMITS.rounds, rounds_left: MAKING_LIMITS.rounds - 1, pictures: [{ label: "六个角度", url: PIXEL }], findings: [] })
  // Every look of a model says in words how much each of its motions moves and how it holds together tick by tick, measured from the document.
  expect((first as { notes: string[] }).notes).toEqual([
    expect.stringMatching(/^待机（idle）：动得最多的是「.+」.+个模型像素.+个屏幕像素/),
    expect.stringMatching(/^待机（idle）连起来看（按游戏每秒 20 刻逐刻量）：循环的最后一刻和第一刻接得上；/),
    expect.stringContaining("走路（walk）："),
    expect.stringContaining("走路（walk）连起来看"),
    expect.stringContaining("受伤（hurt）："),
    expect.stringContaining("受伤（hurt）连起来看"),
  ])
  // One contact sheet of six labelled views, drawn from the document that was handed in.
  // The words on it are for a person as much as for the AI. One more cell rides along for the round's small picture; the maker is not handed it.
  expect(hidden.jobs[0]!.sheets.map((value) => [value.label, value.cells.map((cell) => cell.label)])).toEqual([["六个角度", ["正面", "背面", "它的左侧", "它的右侧", "从上往下", "斜前方"]], ["封面", ["斜前方"]]])
  expect(await commit(good)).toBe(`${REFUSALS.no_self_review(1)}${kept}`)
  expect(await runner.selfReviewExternalTask({ ...ids, ...revise })).toMatchObject({ state: "making", next_step: expect.stringContaining("改出新的一版") })
  expect(await commit(good)).toBe(`${REFUSALS.not_done}${kept}`)
  expect(await words(runner.finalReviewExternalTask(ids))).toBe(REFUSALS.not_done)

  // The second version, looked at more closely: the look holds three pictures and says what it left out.
  const second = await runner.lookExternalTask({ ...ids, document: named("第二版"), shape_only: true, names: true, close_up: "body", animation: "walk" })
  expect(second.round).toBe(2)
  expect(second.pictures.map((picture) => picture.label)).toEqual(["六个角度", "走路（walk） · 斜前方", "近看「body」"])
  expect(second.notes).toEqual([`一次最多 ${MAKING_LIMITS.sheets} 张图，这次没有画：只看形状、部件名字。需要的话再看一次。`, ...(first as { notes: string[] }).notes])
  // Looking again at the same version is not a new version.
  expect((await runner.lookExternalTask({ ...ids, document: named("第二版"), shape_only: true })).round).toBe(2)
  expect(await words(runner.lookExternalTask({ ...ids, document: named("第二版"), close_up: "tail" }))).toBe("这个模型里没有叫「tail」的部件。它有：root、body、sprout、leaf_left、leaf_right。")
  expect(await runner.selfReviewExternalTask({ ...ids, ...done })).toMatchObject({ state: "reviewing", next_step: expect.stringContaining("final_review") })
  expect(await commit(named("第二版"))).toBe(`${REFUSALS.no_review}${kept}`)
  // Changed since the last look: not the version that was seen.
  expect(await commit(named("偷偷改过"))).toBe(`${REFUSALS.unseen}${kept}`)

  // What a reviewer is given: what is judged and what is not, the sheet, this kind's criteria, the person's words for
  // context, and a whole set of pictures drawn for this version. Nothing of the making, and nothing to assemble.
  hidden.jobs.length = 0
  type Packet = { instructions: string; input: Record<string, any>; pictures: { label: string; url: string }[]; how: string; needs_left: number; answer_schema: { properties: Record<string, unknown> } }
  const packet = (await runner.finalReviewExternalTask(ids)) as Packet
  expect(packet.instructions).toBe(REVIEWER_INSTRUCTIONS)
  expect(Object.keys(packet.input)).toEqual(["judging", "not_judged", "part_sheet", "criteria", "request", "motion_facts", "budget_facts"])
  expect(packet.input.judging).toBe("「洞穴守卫」——这个模型的外观和它自带的动作：形状、比例、每一个部件、表面，以及每一个动作放出来的样子。")
  // Behaviour and other things are named as outside this review; the sentence is there for context only.
  expect(packet.input.not_judged).toHaveLength(2)
  expect(packet.input.not_judged[0]).toContain("守着什么")
  expect(packet.input.not_judged[1]).toContain("别的东西")
  expect(packet.input).toMatchObject({ request: "一只守着矿石的敌对生物", part_sheet: { ...sheet, remark: null } })
  expect(packet.input.criteria.map((line: string) => line.split("：")[0])).toEqual(["不凑数", "不机械", "认得出", "有主次", "站得住"])
  expect(packet.pictures.map((picture) => picture.label)).toEqual(REVIEW_SET)
  expect(packet.pictures.length).toBeLessThanOrEqual(MAKING_LIMITS.review_sheets)
  expect(packet.how).toBe(REVIEWER_HANDOFF)
  expect(packet.needs_left).toBe(MAKING_LIMITS.needs)
  expect(Object.keys(packet.answer_schema.properties)).toEqual(["passed", "findings", "advice", "technical", "need"])
  expect(JSON.stringify(packet)).not.toMatch(/self_review|matches|"bones"|第二版/)
  // Drawn a look's worth at a time, so no single job is larger than a look; asking again draws nothing new.
  expect(hidden.jobs.map((job) => job.sheets.length)).toEqual([3, 3, 2])
  expect(((await runner.finalReviewExternalTask(ids)) as Packet).pictures.map((picture) => picture.label)).toEqual(REVIEW_SET)
  expect(hidden.jobs).toHaveLength(3)

  // "Not shown" is not "not achieved": the reviewer asks, is shown, and has to conclude after a bounded number of requests.
  const asked = (await runner.finalReviewExternalTask({ ...ids, need: [{ what: "motion", name: "hurt" }] })) as { pictures: { label: string }[]; needs_left: number; how: string }
  expect(asked.pictures.map((picture) => picture.label)).toEqual(["受伤（hurt） · 斜后方和它的右侧"])
  expect(asked.needs_left).toBe(MAKING_LIMITS.needs - 1)
  // Something the document does not have is said in plain words and does not use up a request.
  expect(await words(runner.finalReviewExternalTask({ ...ids, need: [{ what: "close_up", name: "tail" }] }))).toBe("没有叫「tail」的部件。它有：root、body、sprout、leaf_left、leaf_right。")
  // A reviewer's whole answer handed over as the verdict still counts as a request while its `need` is filled.
  const more = (await runner.finalReviewExternalTask({ ...ids, verdict: { passed: false, findings: [], advice: [], need: [{ what: "angle", name: "back" }, { what: "close_up", name: "body" }], independent: true } })) as { pictures: { label: string }[]; needs_left: number }
  expect(more.pictures.map((picture) => picture.label)).toEqual(["背面（大图）", "近看「body」"])
  expect(more.needs_left).toBe(0)
  expect(await words(runner.finalReviewExternalTask({ ...ids, need: [{ what: "angle", name: "top" }] }))).toBe(REFUSALS.no_more_needs)
  expect(((await runner.finalReviewExternalTask(ids)) as Packet).pictures.map((picture) => picture.label)).toEqual([...REVIEW_SET, "受伤（hurt） · 斜后方和它的右侧", "背面（大图）", "近看「body」"])

  // Only a blocking finding fails a review, and a verdict has to agree with its own lists.
  expect(await words(runner.finalReviewExternalTask({ ...ids, verdict: { passed: false, findings: [], advice: ["表情还不够凶"], independent: true } }))).toBe(REFUSALS.failed_without_findings)
  expect(await words(runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: ["头顶的嫩芽悬在半空"], independent: true } }))).toBe(REFUSALS.passed_with_findings)
  expect(await runner.finalReviewExternalTask({ ...ids, verdict: { passed: false, findings: ["头顶的嫩芽悬在半空，没有接在身体上"], advice: ["表情还不够凶"], independent: false } })).toMatchObject({
    review: { passed: false, independent: false, findings: ["头顶的嫩芽悬在半空，没有接在身体上"], advice: ["表情还不够凶"] },
    state: "making",
  })
  expect(await commit(named("第二版"))).toBe(`${REFUSALS.review_failed}${kept}`)
  expect(await words(runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], independent: true } }))).toBe(REFUSALS.reviewed_and_failed)

  // A third version answers the review; the earlier review does not count for it.
  await runner.lookExternalTask({ ...ids, document: named("第三版") })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  expect(await commit(named("第三版"))).toBe(`${REFUSALS.stale_review}${kept}`)
  await runner.finalReviewExternalTask(ids)
  // Polish left over is normal: the review passes with it, and it travels with the version to the person.
  expect(await runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], advice: ["走路缺少重心转移", "呼吸的起伏太不明显"], independent: true } })).toMatchObject({
    review: { passed: true, independent: true, findings: [], advice: ["走路缺少重心转移", "呼吸的起伏太不明显"] },
    next_step: expect.stringContaining("commit_task"),
  })
  expect(await state()).toBe("running")
  expect((await openProject(directory)).workspace.assets).toEqual([])
  expect(await commit(named("第三版"))).toBe("accepted")
  expect(await state()).toBe("completed")
  expect((await openProject(directory)).workspace.assets.map((asset) => [asset.id, asset.document.kind === "model" && asset.document.name])).toEqual([[assetId, "第三版"]])

  // Everything is on record, in the project.
  const record = (await readMaking(directory, assetId))!
  expect(record).toMatchObject({ state: "done", outcome: "passed", entry: null, kind: "model", request: "一只守着矿石的敌对生物", review: { passed: true, independent: true } })
  expect(record.rounds.map((round) => [round.round, round.self_review?.verdict, round.pictures.map((picture) => picture.label)])).toEqual([
    [1, "revise", ["六个角度"]],
    [2, "done", ["六个角度", "走路（walk） · 斜前方", "近看「body」", "只看形状"]],
    [3, "done", ["六个角度"]],
  ])
  // What each reviewer was shown stays with the version it was shown of, and every round has its own small picture.
  expect(record.rounds.map((round) => [round.review_pictures?.length ?? 0, round.asked ?? 0, Boolean(round.cover)])).toEqual([[0, 0, true], [REVIEW_SET.length + 3, MAKING_LIMITS.needs, true], [REVIEW_SET.length, 0, true]])
  // The kept copy of the best version is gone once it is saved.
  expect(await Bun.file(path.join(directory, ".minemods", "making", `${assetId}.best.json`)).exists()).toBe(false)
})

test("外部 AI：量得出的硬伤是底线，还有硬伤就不能自评做完；画不出图不算看过", async () => {
  const state = { broken: true }
  const hidden = renderer(() => (state.broken ? { ok: false, reason: "这台电脑现在画不出三维预览（没有可用的图形加速）。" } : (undefined as never)))
  const { created, directory, runner } = await bench({ look: hidden.look })
  const { ids, assetId } = await claimed(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...ids, sheet })
  // Could not render: said in plain words, and nothing counts as seen.
  expect(await words(runner.lookExternalTask({ ...ids, document: good }))).toBe(REFUSALS.render_failed("这台电脑现在画不出三维预览（没有可用的图形加速）。"))
  expect((await readMaking(directory, assetId))!.rounds).toEqual([])
  expect(await words(runner.commitExternalTask({ ...ids, document: good }))).toContain(REFUSALS.no_look)
  state.broken = false
  hidden.jobs.length = 0
  const shown = await runner.lookExternalTask({ ...ids, document: weak })
  expect(shown.findings.length).toBeGreaterThan(0)
  expect(shown.findings[0]).toMatch(/^.+：.+/)
  expect(await words(runner.selfReviewExternalTask({ ...ids, ...done }))).toBe(REFUSALS.done_with_findings(shown.findings))
  expect(await words(runner.selfReviewExternalTask({ ...ids, ...revise, next: [] }))).toBe(REFUSALS.revise_without_next)
  // The draft that was looked at is the one Studio shows while the task runs.
  expect((await runner.getExternalProgress({ projectId: created.id, runId: ids.runId })).drafts[ids.taskId]).toMatchObject({ draft: { name: "两块" }, quality: { passed: false } })
  // No document and no draft: there is nothing to look at.
  const other = await bench({ look: hidden.look })
  const fresh = await claimed(other.runner, other.created.id, other.created.revision)
  await other.runner.describeExternalTask({ ...fresh.ids, sheet })
  expect(await words(other.runner.lookExternalTask(fresh.ids))).toContain("没有可以看的版本")
})

test("看不出来在动的动作：量出来告诉制作者，改掉或者在说明里声明本来就不动才能说做完；这一版照样留着", async () => {
  const hidden = renderer()
  const { created, directory, runner } = await bench({ look: hidden.look })
  const { ids, assetId } = await claimed(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...ids, sheet })
  // The same creature with its idle turned down to a tenth: it still turns a degree, and nothing travels far enough to be seen.
  const faint = { ...good, animations: good.animations.map((animation) => (animation.name === "idle" ? { ...animation, channels: animation.channels.map((channel) => ({ ...channel, keyframes: channel.keyframes.map((frame) => ({ ...frame, rotation: frame.rotation.map((value) => value * 0.1) as [number, number, number] })) })) } : animation)) }
  const shown = await runner.lookExternalTask({ ...ids, document: faint })
  expect(shown.findings).toEqual([expect.stringMatching(/^不机械：待机（idle）看不出来在动（.+不到 2 个）。.+still/)])
  expect(shown.notes[0]).toContain(`——不到 ${MOTION_VISIBLE.pixels} 个屏幕像素，人眼看不出来在动。`)
  // It is not one of the standard's hard faults: the version is the best so far, and its round holds none.
  expect((await readMaking(directory, assetId))!).toMatchObject({ best: { round: 1 }, rounds: [{ findings: [], motion: [{ name: "idle", unseen: true }, { unseen: false }, { unseen: false }] }] })
  expect(await words(runner.selfReviewExternalTask({ ...ids, ...done }))).toBe(REFUSALS.done_with_unseen_motion(shown.findings))
  // Declared still, with a reason: exempt, and said so to the maker, the reviewer and the person.
  await runner.describeExternalTask({ ...ids, sheet: { ...sheet, still: [{ motion: "idle", reason: "它是一块石头，站着就该一动不动" }] } })
  expect(await words(runner.selfReviewExternalTask({ ...ids, ...done }))).toBe("accepted")
  const packet = (await runner.finalReviewExternalTask(ids)) as { input: { motion_facts: string[]; part_sheet: { still: unknown } } }
  expect(packet.input.motion_facts[0]).toContain("部件说明里声明了「这个动作本来就不动」（它是一块石头，站着就该一动不动），所以不算毛病。")
  expect(packet.input.part_sheet.still).toEqual([{ motion: "idle", reason: "它是一块石头，站着就该一动不动" }])
})

test("外部 AI：版数用完、最后一次验收没过，做出来的不会白丢——最好的一版留下交给人，标明 AI 还不满意", async () => {
  const { created, directory, runner } = await bench({ look: renderer().look })
  const { ids, assetId } = await claimed(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...ids, sheet })
  for (const round of Array.from({ length: MAKING_LIMITS.rounds - 1 }, (_, index) => index + 1)) {
    expect((await runner.lookExternalTask({ ...ids, document: named(`第 ${round} 版`) })).rounds_left).toBe(MAKING_LIMITS.rounds - round)
    await runner.selfReviewExternalTask({ ...ids, ...revise })
  }
  await runner.lookExternalTask({ ...ids, document: named("最后一版") })
  const ended = await words(runner.selfReviewExternalTask({ ...ids, ...revise, problems: [anotherProblem(MAKING_LIMITS.rounds)], advice: ["走路缺少重心转移"] }))
  expect(ended).toBe(`${REFUSALS.out_of_rounds(MAKING_LIMITS.rounds)}${REFUSALS.kept(MAKING_LIMITS.rounds)}${BATCH_OVER}`)
  // Not failed, not thrown away: saved through the same door, the task done, and marked for the person.
  const run = await runner.get({ projectId: created.id, runId: ids.runId })
  expect(run.state).toBe("completed")
  expect(run.tasks[0]).toMatchObject({ state: "completed", error: null, outcome: "kept_unsatisfied", detail: `${UNSATISFIED.mark}：把第 ${MAKING_LIMITS.rounds} 版先交给你验收。` })
  expect((await openProject(directory)).workspace.assets.map((asset) => [asset.id, asset.document.kind === "model" && asset.document.name])).toEqual([[assetId, "最后一版"]])
  expect(await readMaking(directory, assetId)).toMatchObject({
    state: "done",
    outcome: "kept_unsatisfied",
    kept_round: MAKING_LIMITS.rounds,
    kept_reason: [`停下的原因：${REFUSALS.out_of_rounds(MAKING_LIMITS.rounds)}`, `它自己认为必须改：${anotherProblem(MAKING_LIMITS.rounds)}`, "它自己认为可以更好：走路缺少重心转移"],
  })
  expect(await words(runner.lookExternalTask({ ...ids, document: named("再来一版") }))).toBe("外部任务尚未领取或已结束。")
  expect(await words(runner.commitExternalTask({ ...ids, document: named("最后一版") }))).toBe("外部任务尚未领取或已结束。")

  // A reviewer that fails the last version allowed ends it the same way, and its two lists are the reason given.
  const again = await bench({ look: renderer().look })
  const held = await claimed(again.runner, again.created.id, again.created.revision)
  await again.runner.describeExternalTask({ ...held.ids, sheet })
  for (const round of Array.from({ length: MAKING_LIMITS.rounds }, (_, index) => index + 1)) {
    await again.runner.lookExternalTask({ ...held.ids, document: named(`第 ${round} 版`) })
    await again.runner.selfReviewExternalTask({ ...held.ids, ...(round < MAKING_LIMITS.rounds ? revise : done) })
  }
  await again.runner.finalReviewExternalTask(held.ids)
  expect(await words(again.runner.finalReviewExternalTask({ ...held.ids, verdict: { passed: false, findings: ["背上的叶子和说明写的两片不一样，只有一片"], advice: ["表情还不够凶"], independent: true } }))).toBe(
    `独立验收没有通过。${REFUSALS.out_of_rounds(MAKING_LIMITS.rounds)}${REFUSALS.kept(MAKING_LIMITS.rounds)}${BATCH_OVER}`,
  )
  expect((await again.runner.get({ projectId: again.created.id, runId: held.ids.runId })).tasks[0]).toMatchObject({ state: "completed", outcome: "kept_unsatisfied" })
  expect((await readMaking(again.directory, held.assetId))!.kept_reason).toEqual([
    `停下的原因：独立验收没有通过。${REFUSALS.out_of_rounds(MAKING_LIMITS.rounds)}`,
    "评审认为必须改：背上的叶子和说明写的两片不一样，只有一片",
    "评审认为可以更好：表情还不够凶",
  ])
})

/** A run of two tasks, the second waiting for the first: a model and the creature that wears it. */
async function pair(runner: ReturnType<typeof createProjectRunner>, projectId: string, revision: number) {
  const started = await runner.startExternal({
    projectId,
    expectedRevision: revision,
    prompt: "一只守着矿石的敌对生物",
    plan: {
      summary: "守卫",
      questions: [],
      tasks: [
        { key: "guardian_model", module: "model", title: "洞穴守卫", prompt: "守着矿石的敌对生物", source: "守着矿石的敌对生物", dependencies: [], target_id: null },
        { key: "guardian", module: "entity", title: "洞穴守卫（生物）", prompt: "守着矿石的敌对生物", source: "守着矿石的敌对生物", dependencies: ["guardian_model"], target_id: null },
      ],
    },
  })
  const ids = (index: number) => ({ projectId, runId: started.run.id, taskId: started.run.tasks[index]!.id })
  await runner.claimExternalTask(ids(0))
  return { model: ids(0), creature: ids(1), assetId: started.run.tasks[0]!.asset_id }
}

test("外部 AI 自己放弃（fail_task）：看过的那一版照样留下，它说的原因给人看，依赖它的任务不被卡住；每一版都有硬伤才算没做成", async () => {
  const { created, directory, runner } = await bench({ look: renderer().look })
  const { model, creature, assetId } = await pair(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...model, sheet })
  await runner.lookExternalTask({ ...model, document: named("第一版") })
  await runner.selfReviewExternalTask({ ...model, ...revise })
  // The second version has a hard fault; then the AI gives up.
  await runner.lookExternalTask({ ...model, document: weak })
  await runner.selfReviewExternalTask({ ...model, ...revise })
  const run = await runner.failExternalTask({ ...model, error: "两位评审都不满意，我改不动了。" })
  expect(run.tasks.map((task) => [task.key, task.state, task.outcome])).toEqual([["guardian_model", "completed", "kept_unsatisfied"], ["guardian", "queued", undefined]])
  expect(run.state).toBe("running")
  // What was kept is the latest version the standard does not refuse, and the reason is the AI's own words.
  expect((await openProject(directory)).workspace.assets.map((asset) => asset.document.kind === "model" && asset.document.name)).toEqual(["第一版"])
  expect(await readMaking(directory, assetId)).toMatchObject({
    state: "done",
    outcome: "kept_unsatisfied",
    kept_round: 1,
    kept_reason: ["停下的原因：两位评审都不满意，我改不动了。", "它自己认为必须改：正面远看认不出脸", "交给你的是第 1 版：后面的版本有量得出来的硬伤，没有留。"],
  })
  // The creature that wears it can be made.
  expect((await runner.claimExternalTask(creature)).task.state).toBe("running")

  // Nothing the standard accepts was ever looked at: there is nothing to keep, the task has failed and what waits for it is blocked.
  const other = await bench({ look: renderer().look })
  const second = await pair(other.runner, other.created.id, other.created.revision)
  await other.runner.describeExternalTask({ ...second.model, sheet })
  await other.runner.lookExternalTask({ ...second.model, document: weak })
  const failed = await other.runner.failExternalTask({ ...second.model, error: "做不出来。" })
  expect(failed.tasks.map((task) => [task.key, task.state, task.error])).toEqual([["guardian_model", "failed", "做不出来。"], ["guardian", "blocked", null]])
  expect(failed.state).toBe("failed")
  expect((await openProject(other.directory)).workspace.assets).toEqual([])
  expect(await readMaking(other.directory, second.assetId)).toMatchObject({ state: "stopped", outcome: "failed" })
  // Never looked at: the same.
  const third = await bench({ look: renderer().look })
  const blind = await pair(third.runner, third.created.id, third.created.revision)
  expect((await third.runner.failExternalTask({ ...blind.model, error: "没开始。" })).tasks.map((task) => task.state)).toEqual(["failed", "blocked"])
})

test("不是看着做的种类照旧直接提交；没有渲染窗口时这几类只按标准检查，并且明说没有看图", async () => {
  const looking = await bench({ look: renderer().look })
  const lore = await claimed(looking.runner, looking.created.id, looking.created.revision, "worldview")
  expect(lore.context.making).toBeNull()
  expect(await words(looking.runner.describeExternalTask({ ...lore.ids, sheet }))).toBe("世界观不走看图流程，不需要部件说明、看图和自评：做好以后直接 commit_task。")
  expect(await words(looking.runner.commitExternalTask({ ...lore.ids, document: { kind: "worldview", title: "矿洞", summary: "", entries: [] } }))).toBe("accepted")

  const blind = await bench()
  const model = await claimed(blind.runner, blind.created.id, blind.created.revision)
  expect(model.context.making).toBeNull()
  expect(await words(blind.runner.lookExternalTask({ ...model.ids, document: good }))).toContain("这台 Studio 现在画不了预览图")
  expect(await words(blind.runner.commitExternalTask({ ...model.ids, document: good }))).toBe("accepted")
  expect(await readMaking(blind.directory, model.assetId)).toBeNull()
})

type Sent = { instructions: string; input: Record<string, any>; images: string[]; model?: string }

/** A stand-in for the AI service that tells the four kinds of request apart by their instructions. */
function provider(script: { self: (round: number) => unknown | Promise<unknown>; review: (round: number) => unknown; make?: (round: number) => unknown | Promise<unknown>; /** 边做边看: what the maker answers when it is shown a glance of the version it has just written, by how many glances came before. Left out: it keeps the version. */ glance?: (count: number) => unknown; /** Calls answered 503 instead, by how many requests came before. */ busy?: (request: number) => boolean }) {
  const requests = { count: 0 }
  const sent: (Sent & { kind: "sheet" | "make" | "self" | "review" })[] = []
  // The request that follows a glance is the maker's own second thought on a version, not a version: kept apart, so `sent` reads as the steps of the loop.
  const glances: Sent[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const body = JSON.parse(await request.text()) as { model?: string; instructions: string; input: { content: { type: string; text?: string; image_url?: string }[] }[] }
      if (script.busy?.(requests.count++)) return new Response("busy", { status: 503 })
      const content = body.input[0]!.content
      const reply = (value: unknown) => Response.json({ model: body.model ?? "gpt-6-astra", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(value) }] }] })
      if (body.instructions.endsWith(OWN_GLANCE_INSTRUCTIONS)) {
        glances.push({ model: body.model, instructions: body.instructions, input: JSON.parse(content[0]!.text!) as Record<string, any>, images: content.slice(1).map((part) => part.image_url ?? "") })
        return reply(script.glance?.(glances.length) ?? { keep: true, revised: null })
      }
      const kind = body.instructions === SHEET_INSTRUCTIONS ? "sheet" : body.instructions === SELF_REVIEW_INSTRUCTIONS ? "self" : body.instructions.startsWith(REVIEWER_INSTRUCTIONS) ? "review" : "make"
      const call = { kind, model: body.model, instructions: body.instructions, input: JSON.parse(content[0]!.text!) as Record<string, any>, images: content.slice(1).map((part) => part.image_url ?? "") } as const
      sent.push(call)
      const count = sent.filter((value) => value.kind === kind).length
      const value = kind === "sheet" ? sheet : kind === "self" ? script.self(count) : kind === "review" ? script.review(count) : (script.make?.(count) ?? named(`第 ${count} 版`))
      // A script may do something on the project before it answers (a person's edit made while the maker works): it may be async.
      return reply(await value)
    },
  })
  closers.push(() => server.stop(true))
  return { sent, glances, ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1` } }
}

async function terminal(runner: ReturnType<typeof createProjectRunner>, projectId: string, runId: string) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const run = await runner.get({ projectId, runId })
    if (["completed", "partial", "canceled", "failed", "interrupted"].includes(run.state)) return run
    await Bun.sleep(10)
  }
  throw new Error("runner did not finish")
}

const guided = (review: (typeof revise | typeof done) & { advice?: string[] }, extra: { look_closer?: string | null; watch?: string | null } = {}) => ({ ...review, look_closer: extra.look_closer ?? null, watch: extra.watch ?? null, declare: null })

const answer = (review: { findings?: string[]; advice?: string[]; need?: { what: string; name: string | null; times: number[] | null }[]; passed?: boolean }) => ({ passed: review.passed ?? !(review.findings ?? []).length, findings: review.findings ?? [], advice: review.advice ?? [], need: review.need ?? [] })

test("Studio 自己的 AI 走同一个流程：说明 → 做 → 看图自评 → 改 → 独立验收，图真的发给了模型", async () => {
  const hidden = renderer()
  const fake = provider({
    self: (round) => (round === 1 ? guided({ ...revise, advice: [] }, { look_closer: "sprout", watch: "hurt" }) : guided({ ...done, advice: ["呼吸的起伏太不明显"] })),
    // The first reviewer cannot see something and asks; shown it, it finds a real fault. The second passes with polish left over.
    review: (round) =>
      round === 1
        ? answer({ need: [{ what: "motion", name: "hurt", times: null }] })
        : round === 2
          ? answer({ findings: ["头顶的嫩芽悬在半空，没有接在身体上"], advice: ["表情还不够凶"] })
          : answer({ advice: ["走路缺少重心转移"] }),
  })
  const { created, directory, runner, asked } = await bench({ look: hidden.look, ai: fake.ai })
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(run.state).toBe("completed")
  expect(fake.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self", "make", "self", "review", "review", "make", "self", "review"])
  // Whether the model can see was asked before anything started, once.
  expect(asked).toHaveLength(1)

  const [described, first, judged, second, , reviewer, shownMore, third] = fake.sent
  expect(described!.input).toMatchObject({ request: "一只守着矿石的敌对生物", item: { kind: "模型" }, previous_sheet: null, remark: null })
  expect(described!.images).toEqual([])
  // The first version is made from the sheet, with nothing to look at yet.
  expect(first!.input).toMatchObject({ part_sheet: { ...sheet, remark: null }, making: { round: 1, rounds_allowed: MAKING_LIMITS.rounds } })
  expect(first!.input.revision_required).toBeUndefined()
  expect(first!.images).toEqual([])
  expect(first!.instructions).toContain(MODULES.model.instructions)
  // The self-review is shown the pictures of that version, with the sheet and what the standard measured.
  // Round 18: every motion of a first version is new, so each is shown frame by frame, in a look of its own after the first, as many as one version shows.
  expect(judged!.input).toMatchObject({ part_sheet: { ...sheet, remark: null }, pictures: FIRST_SEEN, findings: [], round: 1 })
  expect(judged!.images).toEqual(FIRST_SEEN.map(() => PIXEL))
  // The revision gets its own self-review back, and the same pictures to look at.
  expect(second!.input.revision_required).toMatchObject({ document: { name: "第 1 版" }, self_review: { problems: revise.problems, advice: [], next: revise.next }, findings: [], reviewer_findings: [], reviewer_advice: [] })
  expect(second!.images).toEqual(FIRST_SEEN.map(() => PIXEL))
  // What it asked to see closer and to watch is what the next look draws.
  expect(hidden.jobs.map((job) => job.sheets.map((value) => value.label))).toContainEqual(["六个角度", "受伤（hurt） · 斜前方", "近看「sprout」", "封面"])
  // The reviewer is a request of its own: what is judged, the sheet, the criteria, the words for context and the whole set of pictures; none of the making.
  expect(Object.keys(reviewer!.input).sort()).toEqual(["budget_facts", "criteria", "judging", "motion_facts", "not_judged", "part_sheet", "pictures", "request"])
  // The maker and the reviewer are told the same measured facts about every motion.
  expect(reviewer!.input.motion_facts).toEqual(judged!.input.motion_facts)
  expect(reviewer!.input.motion_facts).toHaveLength(good.animations.length * 2)
  expect(reviewer!.instructions).toBe(REVIEWER_INSTRUCTIONS)
  expect(reviewer!.input.pictures).toEqual(REVIEW_SET)
  expect(reviewer!.images).toHaveLength(REVIEW_SET.length)
  expect(JSON.stringify(reviewer!.input)).not.toMatch(/第 2 版|self_review|revision_required|"bones"/)
  // It could not see something: it is shown what it asked for and answers again, with everything it had before.
  expect(shownMore!.input.pictures).toEqual([...REVIEW_SET, "受伤（hurt） · 斜后方和它的右侧"])
  expect(shownMore!.images).toHaveLength(REVIEW_SET.length + 1)
  // A failed review sends the work back for another version, with what the reviewer said, in its two lists.
  expect(third!.input.revision_required).toMatchObject({ document: { name: "第 2 版" }, reviewer_findings: ["头顶的嫩芽悬在半空，没有接在身体上"], reviewer_advice: ["表情还不够凶"] })

  const asset = (await openProject(directory)).workspace.assets[0]!
  expect(asset.document).toMatchObject({ kind: "model", name: "第 3 版" })
  const record = (await readMaking(directory, asset.id))!
  // Passed with advice left over: that is a pass.
  expect(record).toMatchObject({ state: "done", outcome: "passed", sheet: { ...sheet, remark: null }, review: { passed: true, independent: true, findings: [], advice: ["走路缺少重心转移"] } })
  expect(record.rounds.map((round) => [round.round, round.self_review?.verdict, round.pictures.length, round.review_pictures?.length ?? 0])).toEqual([[1, "revise", FIRST_SEEN.length, 0], [2, "done", 3, REVIEW_SET.length + 1], [3, "done", 3, REVIEW_SET.length]])
  expect(run.tasks[0]!.outcome).toBeUndefined()
  expect(run.events.map((entry) => entry.message)).toEqual(expect.arrayContaining(["正在写部件说明。", "第 1 版：正在看渲染图。", "第 2 版：正在请没有参与制作的评审来审查。", "第 2 版：评审想再看几张图，正在补拍。"]))
})

test("Studio 自己的 AI：评审一直要图也得给结论；它说没通过却只有可以更好的，就是通过", async () => {
  const hidden = renderer()
  // A reviewer that never stops asking, and that calls polish a failure.
  const fake = provider({ self: () => guided({ ...done, advice: [] }), review: () => ({ passed: false, findings: [], advice: ["表情还不够凶", "走路缺少重心转移"], need: [{ what: "angle", name: "back", times: null }] }) })
  const { created, directory, runner } = await bench({ look: hidden.look, ai: fake.ai })
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(run.state).toBe("completed")
  const reviews = fake.sent.filter((call) => call.kind === "review")
  // Asked as often as one review may, then told to conclude; what it still asks for is no longer drawn.
  expect(reviews).toHaveLength(MAKING_LIMITS.needs + 1)
  expect(reviews.map((call) => call.instructions.endsWith(REVIEWER_LAST_WORD))).toEqual([false, false, true])
  expect(reviews.map((call) => call.images.length)).toEqual([REVIEW_SET.length, REVIEW_SET.length + 1, REVIEW_SET.length + 2])
  // Nothing blocking was listed: the version is saved after one round, with the polish on record.
  expect(fake.sent.filter((call) => call.kind === "make")).toHaveLength(1)
  const asset = (await openProject(directory)).workspace.assets[0]!
  expect(await readMaking(directory, asset.id)).toMatchObject({ outcome: "passed", review: { passed: true, findings: [], advice: ["表情还不够凶", "走路缺少重心转移"] } })
})

test("Studio 自己的 AI：模型说做完但还有硬伤就算没做完；看满版数就把最好的一版留给人，不是丢掉", async () => {
  // The model always calls its two boxes finished. The standard's findings turn that into "revise", every time.
  const stubborn = provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}), make: () => weak })
  const first = await bench({ look: renderer().look, ai: stubborn.ai })
  const failed = await terminal(first.runner, first.created.id, (await first.runner.start({ projectId: first.created.id, expectedRevision: first.created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  // Told what the standard found, it hands in the very same document: that is not a new version, and the task ends there.
  // The standard refuses the only version there is, so there is nothing to keep: this is a failure, as before.
  expect(failed.state).toBe("failed")
  expect(failed.tasks[0]!.error).toBe(REFUSALS.unchanged)
  expect(stubborn.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self", "make"])
  expect(stubborn.sent[3]!.input.revision_required.findings.length).toBeGreaterThan(0)
  expect(stubborn.sent[3]!.input.revision_required.self_review.next).toEqual(stubborn.sent[3]!.input.revision_required.findings)
  expect((await openProject(first.directory)).workspace.assets).toEqual([])
  expect(await readMaking(first.directory, failed.tasks[0]!.asset_id)).toMatchObject({ state: "stopped", outcome: "failed" })

  // A model that keeps revising: after the last version allowed, that version is the person's to judge.
  const restless = provider({ self: (round) => guided({ ...revise, problems: [anotherProblem(round)], advice: ["走路缺少重心转移"] }), review: () => answer({}) })
  const second = await bench({ look: renderer().look, ai: restless.ai })
  const out = await terminal(second.runner, second.created.id, (await second.runner.start({ projectId: second.created.id, expectedRevision: second.created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(out.state).toBe("completed")
  expect(out.tasks[0]).toMatchObject({ state: "completed", error: null, outcome: "kept_unsatisfied", detail: `${UNSATISFIED.mark}：把第 ${MAKING_LIMITS.rounds} 版先交给你验收。` })
  expect(restless.sent.filter((call) => call.kind === "make")).toHaveLength(MAKING_LIMITS.rounds)
  expect((await openProject(second.directory)).workspace.assets.map((asset) => asset.document.kind === "model" && asset.document.name)).toEqual([`第 ${MAKING_LIMITS.rounds} 版`])
  const record = (await readMaking(second.directory, out.tasks[0]!.asset_id))!
  expect(record).toMatchObject({
    state: "done",
    outcome: "kept_unsatisfied",
    kept_round: MAKING_LIMITS.rounds,
    kept_reason: [`停下的原因：${REFUSALS.out_of_rounds(MAKING_LIMITS.rounds)}`, `它自己认为必须改：${anotherProblem(MAKING_LIMITS.rounds)}`, "它自己认为可以更好：走路缺少重心转移"],
  })
  expect(record.rounds).toHaveLength(MAKING_LIMITS.rounds)
})

test("模型看不了图：开始之前就明说，不会悄悄跳过看图", async () => {
  const fake = provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}) })
  const { created, directory, runner } = await bench({ look: renderer().look, ai: fake.ai, sees: "no" })
  const refused = await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "一只守着矿石的敌对生物", module: "model" }).catch((error: unknown) => error)
  expect(refused).toBeInstanceOf(ModelingError)
  expect(publicError(refused)).toBe(NO_VISION_WORDS)
  expect(NO_VISION_WORDS).toContain("看不了图")
  const plan = { summary: "守卫", questions: [], tasks: [{ key: "guardian", module: "model", title: "守卫", prompt: "守卫", source: "守着矿石的敌对生物", dependencies: [], target_id: null }] }
  expect(publicError(await runner.startPlanned({ projectId: created.id, expectedRevision: created.revision, prompt: "一只守着矿石的敌对生物", plan }, false).catch((error: unknown) => error))).toBe(NO_VISION_WORDS)
  expect(await runner.list(created.id)).toEqual([])
  expect(fake.sent).toEqual([])
  expect((await openProject(directory)).revision).toBe(created.revision)
  // An outside AI brings its own eyes: Studio's connection is not asked.
  expect((await runner.startExternal({ projectId: created.id, expectedRevision: created.revision, prompt: "一只守着矿石的敌对生物", plan })).run.state).toBe("running")
  // What is not made by looking starts as before, and nobody is asked whether the model can see.
  const writer = provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}), make: () => ({ kind: "worldview", title: "矿洞", summary: "很久以前", entries: [{ title: "入口", body: "一道裂缝" }] }) })
  const other = await bench({ look: renderer().look, ai: writer.ai, sees: "no" })
  expect((await terminal(other.runner, other.created.id, (await other.runner.start({ projectId: other.created.id, expectedRevision: other.created.revision, prompt: "写一段矿洞的传说", module: "worldview" })).id)).state).toBe("completed")
  expect(other.asked).toEqual([])
})

test("两条路共用一套实现：同一个门、同一份记录、同样的话", async () => {
  const source = await Bun.file(new URL("../src/main/project-runner.ts", import.meta.url)).text()
  const door = source.slice(source.indexOf("async function saveTaskAsset("), source.indexOf("async function runTask("))
  // The loop is checked inside the one door AI work goes through, before the standard and before anything is written.
  expect(door.indexOf("making.gate(")).toBeGreaterThan(0)
  expect(door.indexOf("making.gate(")).toBeLessThan(door.indexOf("acceptanceReview("))
  // Both ways of making take every step through the same loop object; the runner has no second copy of a rule.
  for (const step of ["making.describe(", "making.look(", "making.selfReview(", "making.review(", "making.packet("]) expect(source.split(step).length - 1).toBe(2)
  expect(source).not.toMatch(/commitGate\(|lookGate\(|looked\(|fingerprint\(/)
  expect(source.split("createMakingLoop(").length - 1).toBe(1)
})

async function studio(look?: LookRenderer, reopen?: string) {
  const root = reopen ?? (await mkdtemp(path.join(os.tmpdir(), "studio-making-service-")))
  if (!reopen) directories.push(root)
  const service = await createStudioService({ workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: { mode: "mcp", review: true }, look })
  closers.push(() => service.dispose())
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  return { service, call, root }
}

const blueprint = (entries: { key: string; kind: "model" | "recipe" }[]) =>
  played({
    style: { palette: ["#3355aa"], shape: "方块感", naming: "中文名", world: "矿洞" },
    entries: entries.map((value) => ({ key: value.key, kind: value.kind, title: value.key === "guardian_model" ? "洞穴守卫" : "木棍的配方", brief: `做${value.key}`, owner: null, needs: [], out_of_scope: null })),
    questions: [],
  })

test("每一轮都看得见：轮询 getMaking 跟着任务走；人能改部件说明，重做从它加上人的话开始", async () => {
  const { service, call } = await studio(renderer().look)
  const projectId = (await service.createProject({ name: "看得见", description: "", modId: "seen", empty: true })).project.id
  await call("proposeBlueprint", { projectId, request: "一只守着矿石的敌对生物", blueprint: blueprint([{ key: "guardian_model", kind: "model" }, { key: "sticks", kind: "recipe" }]), paper_play: PAPER })
  await service.confirmBlueprint({ projectId, revision: 1 })
  // Nothing made yet: no record, and no sheet to edit.
  expect(await service.getMaking({ projectId, itemId: "guardian_model" })).toBeNull()
  expect(publicError(await service.saveSheet({ projectId, itemId: "guardian_model", sheet: { ...sheet, remark: null } }).catch((error: unknown) => error))).toBe("这样东西还没有开始做，还没有部件说明可以改。")

  const batch = (await call("nextBatch", { projectId })) as ExternalStartResult
  const ids = (key: string) => ({ projectId, runId: batch.run.id, taskId: batch.tasks.find((value) => value.task.key === key)!.task.id })
  const model = ids("guardian_model")
  const claim = (await call("claimExternalTask", model)) as ExternalTaskContext
  expect(claim.making).toMatchObject({ sheet: null, remark: null, rounds_allowed: MAKING_LIMITS.rounds })
  const seen = () => service.getMaking({ projectId, itemId: "guardian_model" }) as Promise<Making>
  // Taken and not touched (broad23): the record is there, but nothing is being written, so the thing is told as waiting and the overview counts it as queued, not as made.
  expect(await seen()).toEqual({ item_id: "guardian_model", asset_id: null, sheet: null, rounds: [], review: null, state: "describing", rounds_allowed: MAKING_LIMITS.rounds, idle: true })
  const guardian = async () => (await service.getProjectOverview({ projectId })).items.find((item) => item.id === "guardian_model")!
  expect(await guardian()).toMatchObject({ status: "making", status_label: "在排队", queued: { waiting_for: [] } })
  // The kind's own schema answer says it is made by looking; a kind that is not says nothing.
  expect(await call("moduleSchema", { module: "model" })).toMatchObject({ making: MAKING_SUMMARY })
  expect(await call("moduleSchema", { module: "recipe" })).toMatchObject({ making: null })
  // A refusal reaches the outside AI word for word.
  await expect(call("commitExternalTask", { ...model, document: good })).rejects.toThrow(REFUSALS.no_sheet)
  await call("describeExternalTask", { ...model, sheet })
  expect(await seen()).toMatchObject({ sheet: { ...sheet, remark: null }, state: "making", rounds: [] })
  // Once it has handed something in it is being made, said as that.
  expect((await seen()).idle).toBeUndefined()
  expect(await guardian()).toMatchObject({ status: "making", status_label: "正在做" })
  expect((await guardian()).queued).toBeUndefined()
  // While it is being made the sheet is the maker's to write.
  expect(publicError(await service.saveSheet({ projectId, itemId: "guardian_model", sheet: { ...sheet, remark: null } }).catch((error: unknown) => error))).toBe("这样东西正在做，等这一次做完再改部件说明。")
  const shown = (await call("lookExternalTask", { ...model, document: good })) as { pictures: { label: string; url: string }[] }
  expect(shown.pictures).toEqual([{ label: "六个角度", url: PIXEL }])
  expect((await seen()).rounds).toEqual([{ round: 1, at: expect.any(String), pictures: [{ label: "六个角度", url: PIXEL, from: "look" }], cover: PIXEL, self_review: null, findings: [], budget: { plain: expect.stringContaining("「普通」档"), line: expect.stringContaining("几何预算：") }, motion: good.animations.map((animation) => expect.objectContaining({ name: animation.name, unseen: false, still: null, plain: expect.stringContaining("看得出在动"), line: expect.stringContaining("个模型像素") })) }])
  await call("selfReviewExternalTask", { ...model, ...done })
  expect(await seen()).toMatchObject({ state: "reviewing", rounds: [{ self_review: done }] })
  // The reviewer's set, and what it asked to see besides, show up in the round as they are drawn.
  await call("finalReviewExternalTask", model)
  await call("finalReviewExternalTask", { ...model, need: [{ what: "angle", name: "back" }] })
  expect((await seen()).rounds[0]!.pictures.map((picture) => [picture.label, picture.from])).toEqual([...REVIEW_SET.map((label) => [label, "review"]), ["背面（大图）", "asked"]])
  await call("finalReviewExternalTask", { ...model, verdict: { passed: true, findings: [], advice: ["表情还不够凶"], independent: true } })
  await call("commitExternalTask", { ...model, document: good })
  const made = await seen()
  expect(made).toMatchObject({ item_id: "guardian_model", state: "done", outcome: "passed", review: { independent: true, passed: true, findings: [], advice: ["表情还不够凶"], round: 1 } })
  expect((await service.getProjectOverview({ projectId })).items.find((item) => item.id === "guardian_model")).toMatchObject({ status: "review" })
  expect((await service.getProjectOverview({ projectId })).items.find((item) => item.id === "guardian_model")!.ai_unsatisfied).toBeUndefined()
  expect(made.asset_id).toBe((await service.getProjectOverview({ projectId })).items.find((item) => item.id === "guardian_model")!.asset_id)
  // The same record by the asset's id, for a card that knows only that.
  expect(await service.getMaking({ projectId, itemId: made.asset_id! })).toMatchObject({ state: "done", sheet: made.sheet })

  // A kind that is not made by looking has no record and no sheet.
  await call("claimExternalTask", ids("sticks"))
  await call("commitExternalTask", { ...ids("sticks"), document: { kind: "recipe", name: "木棍的配方", pattern: ["minecraft:oak_planks", null, null, "minecraft:oak_planks", null, null, "minecraft:oak_planks", null, null], result: "minecraft:stick", count: 4 } })
  expect(await service.getMaking({ projectId, itemId: "sticks" })).toBeNull()
  expect(publicError(await service.saveSheet({ projectId, itemId: "sticks", sheet: { ...sheet, remark: null } }).catch((error: unknown) => error))).toBe("这一类内容不是看着图做的，没有部件说明。")

  // The person edits the sheet, then sends the thing back with a remark: the redo starts from both.
  const edited = { ...sheet, recognisable: [...sheet.recognisable, "背上一排蓝色晶刺"], remark: null }
  expect(await service.saveSheet({ projectId, itemId: "guardian_model", sheet: edited })).toMatchObject({ sheet: edited, state: "done", rounds: made.rounds })
  await service.redoAsset({ projectId, itemId: "guardian_model", feedback: "眼睛再大一点" })
  const redo = (await call("nextBatch", { projectId })) as ExternalStartResult
  const again = { projectId, runId: redo.run.id, taskId: redo.tasks[0]!.task.id }
  expect(((await call("claimExternalTask", again)) as ExternalTaskContext).making).toMatchObject({ sheet: { ...edited, remark: "眼睛再大一点" }, remark: "眼睛再大一点", next_step: "先用 save_sheet 写部件说明。" })
  // The earlier version's rounds are gone from the record; its sheet is where this one starts, and it must be written again.
  expect(await seen()).toMatchObject({ state: "describing", rounds: [], review: null, sheet: { remark: "眼睛再大一点" } })
  await expect(call("lookExternalTask", { ...again, document: good })).rejects.toThrow(REFUSALS.no_sheet)
  // The task ends without saving: the record says so instead of looking forever under way.
  await call("failExternalTask", { ...again, error: "先不做了" })
  expect((await seen()).state).toBe("stopped")
})

/** A confirmed plan of a model, the creature that needs it, and one thing the plan says it will not make. */
async function planned(look: LookRenderer) {
  const { service, call, root } = await studio(look)
  const projectId = (await service.createProject({ name: "守卫", description: "", modId: "guard", empty: true })).project.id
  const entry = (key: string, kind: "model" | "entity" | "item", title: string, extra: { owner?: string; needs?: string[]; out_of_scope?: string } = {}) => ({ key, kind, title, brief: `做${title}`, owner: null, needs: [], out_of_scope: null, ...extra })
  await call("proposeBlueprint", {
    projectId,
    request: "一种会发光的蓝色矿石、用它合成的一把剑、一只守着矿石的敌对生物",
    blueprint: played({
      style: { palette: ["#3355aa"], shape: "方块感", naming: "中文名", world: "矿洞" },
      entries: [entry("guardian_model", "model", "洞穴守卫", { owner: "guardian" }), entry("guardian", "entity", "洞穴守卫（生物）", { needs: ["guardian_model"] }), entry("sword_skill", "item", "剑的技能", { out_of_scope: "剑现在只能是普通物品，做不了技能。" })],
      questions: [],
    }),
    paper_play: PAPER,
  })
  await service.confirmBlueprint({ projectId, revision: 1 })
  const batch = (await call("nextBatch", { projectId })) as ExternalStartResult
  const ids = (key: string) => ({ projectId, runId: batch.run.id, taskId: batch.tasks.find((value) => value.task.key === key)!.task.id })
  await call("claimExternalTask", ids("guardian_model"))
  await call("describeExternalTask", { ...ids("guardian_model"), sheet })
  /** What the run says and what the plan says about each thing, side by side. */
  const both = async () => {
    const run = (await call("getExternalRun", { projectId, runId: batch.run.id })) as { state: string; tasks: { key: string; state: string }[] }
    const plan = (await call("getBlueprint", { projectId })) as { entries: { id: string; status: string; reason: string | null; ai_unsatisfied?: boolean }[]; production: { failed: number; blocked: number; to_review: number } }
    return { run, plan, pairs: run.tasks.map((task) => [task.key, task.state, plan.entries.find((value) => value.id === task.key)!.status]) }
  }
  return { service, call, root, projectId, runId: batch.run.id, model: ids("guardian_model"), both }
}

test("同一样东西，get_run 和 get_blueprint 说的是同一个状态：没做成就是没做成，被卡住就是被卡住", async () => {
  const { call, model, both } = await planned(renderer().look)
  // Every version has a hard fault and the AI gives up: nothing to keep.
  await call("lookExternalTask", { ...model, document: weak })
  await call("failExternalTask", { ...model, error: "做不出来。" })
  const seen = await both()
  // The run's word and the plan's word for each thing are the same word. (Before: the run said "blocked" and the plan "planned".)
  expect(seen.pairs).toEqual([["guardian_model", "failed", "failed"], ["guardian", "blocked", "blocked"]])
  expect(seen.plan.production).toMatchObject({ failed: 1, blocked: 1 })
  expect(seen.plan.entries.find((value) => value.id === "guardian")!.reason).toBe("要先做好「洞穴守卫」，但它没有做成。")
  // What the plan will not make was never a task and is never anything else.
  expect(seen.plan.entries.find((value) => value.id === "sword_skill")!.status).toBe("out_of_scope")
})

test("留下的那一版在总览里是“等你验收”，带着 AI 还不满意的记号；依赖它的没被卡住；人照常说可以或不太对", async () => {
  const { service, call, projectId, model, both } = await planned(renderer().look)
  await call("lookExternalTask", { ...model, document: good })
  await call("selfReviewExternalTask", { ...model, ...done })
  // What the plan says it will not make is handed to the reviewer word for word, as outside this review.
  const packet = (await call("finalReviewExternalTask", model)) as unknown as { input: { not_judged: string[]; request: string } }
  expect(packet.input.not_judged.at(-1)).toBe("蓝图里写明这次不做「剑的技能」：剑现在只能是普通物品，做不了技能。")
  expect(packet.input.not_judged.join("")).toContain("守着什么")
  await call("finalReviewExternalTask", { ...model, verdict: { passed: false, findings: ["背上的叶子和说明写的两片不一样，只有一片"], advice: ["表情还不够凶"], independent: true } })
  await call("failExternalTask", { ...model, error: "评审没通过，我不知道还能怎么改。" })

  const seen = await both()
  // Not blocked: the creature is still in the batch, waiting its turn (a queued task of a live batch reads "正在做").
  expect(seen.pairs).toEqual([["guardian_model", "completed", "review"], ["guardian", "queued", "making"]])
  expect(seen.plan.production).toMatchObject({ failed: 0, blocked: 0, to_review: 1 })
  expect(seen.plan.entries.find((value) => value.id === "guardian_model")).toMatchObject({ status: "review", ai_unsatisfied: true })
  // The story says so in plain lines, beside the version that was kept and the review that was of it.
  const made = (await service.getMaking({ projectId, itemId: "guardian_model" })) as Making
  expect(made).toMatchObject({
    state: "done",
    outcome: "kept_unsatisfied",
    kept_round: 1,
    kept_reason: ["停下的原因：评审没通过，我不知道还能怎么改。", "评审认为必须改：背上的叶子和说明写的两片不一样，只有一片", "评审认为可以更好：表情还不够凶"],
    review: { passed: false, round: 1, findings: ["背上的叶子和说明写的两片不一样，只有一片"], advice: ["表情还不够凶"] },
  })
  // The person's verdict works as for anything else, and once given the mark has nothing more to say.
  const accepted = await service.reviewAsset({ projectId, assetId: made.asset_id!, verdict: "accepted" })
  expect(accepted.items.find((item) => item.id === "guardian_model")).toMatchObject({ status: "saved", facts: { accepted: true } })
  expect(accepted.items.find((item) => item.id === "guardian_model")!.ai_unsatisfied).toBeUndefined()
  const rejected = await service.reviewAsset({ projectId, assetId: made.asset_id!, verdict: "rejected", note: "脸还是不对" })
  expect(rejected.items.find((item) => item.id === "guardian_model")).toMatchObject({ status: "redo", reason: "脸还是不对" })
})

// B18-J-03: a creature cannot be handed in because the model it stands on needs to be made again. The redo is claimable now, in a run of its own beside the batch,
// and the creature waits for it instead of having to be given up.
test("批次里的生物要等它的模型重做：重做马上就能领，生物在重做提交以前交不了，不用 fail_task；和这一批无关的重做仍然等这一批结束", async () => {
  const { service, call, projectId, runId, model } = await planned(renderer().look)
  const creature = { projectId, runId, taskId: ((await call("getExternalRun", { projectId, runId })) as { tasks: { id: string; key: string }[] }).tasks.find((task) => task.key === "guardian")!.id }
  await call("lookExternalTask", { ...model, document: good })
  await call("selfReviewExternalTask", { ...model, ...done })
  await call("finalReviewExternalTask", model)
  await call("finalReviewExternalTask", { ...model, verdict: { passed: true, findings: [], independent: true } })
  await call("commitExternalTask", { ...model, document: good })
  // The creature is claimed; the model it needs turns out to lack something, and is sent back.
  await call("claimExternalTask", creature)
  const assetId = ((await service.getProjectOverview({ projectId })).items.find((item) => item.id === "guardian_model") as { asset_id: string }).asset_id
  await service.redoAsset({ projectId, itemId: "guardian_model", feedback: "还缺一个射击的动作" })
  // Before: next_batch said the batch was not done, and the creature had to be failed to get out. Now the redo is started beside the batch.
  const redo = (await call("nextBatch", { projectId })) as ExternalStartResult & { next_step: string; parallel: { ready_now: { key: string }[] } }
  expect(redo.run.id).not.toBe(runId)
  expect(redo.tasks.map((value) => value.task.key)).toEqual(["guardian_model"])
  expect(redo.tasks[0]!.task.asset_id).toBe(assetId)
  expect(redo.parallel.ready_now.map((value) => value.key)).toEqual(["guardian_model"])
  expect(redo.next_step).toContain(REDO_BESIDE_WORDS([{ title: "洞穴守卫（生物）" }]))
  expect(redo.next_step).toContain("不要 fail_task")
  // The batch itself is still in hand; asking again says where the redo is and that nothing has to be given up.
  const again = await words(call("nextBatch", { projectId }))
  expect(again).toContain(redo.run.id)
  expect(again).toContain("不要 fail_task")
  expect(again).toContain("洞穴守卫（生物）")
  // The creature waits for the redo: nothing is saved, and the task stays claimed.
  const waiting = await words(call("commitExternalTask", { ...creature, document: good }))
  expect(waiting).toContain(PARALLEL_WORDS.redoFirst("洞穴守卫（生物）", [{ title: "洞穴守卫" }]))
  expect(waiting).toContain("任务保持运行")
  expect(((await call("getExternalRun", { projectId, runId })) as { tasks: { key: string; state: string }[] }).tasks.find((task) => task.key === "guardian")!.state).toBe("running")
  // The redo is made and handed in like any task; then the creature's refusal is another one.
  const remade = { projectId, runId: redo.run.id, taskId: redo.tasks[0]!.task.id }
  await call("claimExternalTask", remade)
  await call("describeExternalTask", { ...remade, sheet })
  await call("lookExternalTask", { ...remade, document: named("加了射击动作") })
  await call("selfReviewExternalTask", { ...remade, ...done })
  await call("finalReviewExternalTask", remade)
  await call("finalReviewExternalTask", { ...remade, verdict: { passed: true, findings: [], independent: true } })
  await call("commitExternalTask", { ...remade, document: named("加了射击动作") })
  expect(await words(call("commitExternalTask", { ...creature, document: good }))).not.toContain(PARALLEL_WORDS.redoFirst("洞穴守卫（生物）", [{ title: "洞穴守卫" }]))
})

test("能力清单和交接说明讲的就是这个流程：工具、上限、原话、模型要求，没有模板", () => {
  const capabilities = getMcpCapabilities("medium")
  const names = capabilities.tools.map((tool) => tool.name)
  expect(names).toEqual(expect.arrayContaining(["save_sheet", "look", "self_review", "final_review"]))
  expect(MCP_TOOLS.filter((tool) => ["save_sheet", "look", "self_review", "final_review"].includes(tool[0]))).toHaveLength(4)
  expect(capabilities.making).toMatchObject({
    summary: MAKING_SUMMARY,
    discipline: MAKING_DISCIPLINE,
    kinds: LOOKED_KINDS,
    workflow: ["claim_task", "save_sheet", "look", "self_review", "final_review", "commit_task"],
    limits: { rounds: MAKING_LIMITS.rounds, pictures_per_look: MAKING_LIMITS.sheets, pictures_per_review: MAKING_LIMITS.review_sheets, review_needs: MAKING_LIMITS.needs, pictures_per_need: MAKING_LIMITS.need_items, picture_pixels: MAKING_LIMITS.sheet },
    findings: { blocking: "必须改的", advice: "可以更好的", line: FINDING_LINE, contrasts: FINDING_CONTRASTS },
    endings: MCP_MAKING_ENDINGS,
    models: MAKING_MODELS,
    independent_review: REVIEWER_HANDOFF,
  })
  expect(capabilities.making.refusals).toEqual([REFUSALS.no_sheet, REFUSALS.no_look, REFUSALS.unseen, REFUSALS.no_self_review(1), REFUSALS.not_done, REFUSALS.no_review, REFUSALS.stale_review, REFUSALS.review_failed])
  expect(capabilities.making.endings).toEqual([`${REFUSALS.out_of_rounds(MAKING_LIMITS.rounds)}${REFUSALS.kept(MAKING_LIMITS.rounds)}`, REFUSALS.nothing_kept])
  expect(capabilities.making.review_scope).toContain("只评这一样东西本身")
  // 10-07 audit: an outside AI is also told how 「审查」 is switched, how many glances a task has, and that a built mod can be checked in the test scene.
  expect(capabilities.making.limits.glances).toBe(MAKING_LIMITS.glances)
  expect(capabilities.making.inspection).toEqual({ review: true, tools: ["await_inspection", "next_inspection"], rule: MCP_INSPECTION.on })
  expect(getMcpCapabilities("medium", { review: false }).making.inspection).toMatchObject({ review: false, rule: MCP_INSPECTION.off })
  expect(capabilities.workflow.slice(-4)).toEqual(["build_project", "get_build", "check_scene", "get_scene_check"])
  for (const name of [...capabilities.workflow, ...capabilities.making.inspection.tools]) expect(names as string[]).toContain(name)
  expect(capabilities.making.unsatisfied).toContain(UNSATISFIED.mark)
  // The picture budget of a review is above that of a look, and bounded.
  expect(MAKING_LIMITS.review_sheets).toBeGreaterThan(MAKING_LIMITS.sheets)
  expect(MAKING_LIMITS.review_sheets + MAKING_LIMITS.needs * MAKING_LIMITS.need_items).toBeLessThanOrEqual(18)
  expect(capabilities.making.templates).toContain("没有")
  expect(MAKING_SUMMARY).toContain(`最多看 ${MAKING_LIMITS.rounds} 版`)
  expect(MAKING_SUMMARY).toContain(`一次看图最多 ${MAKING_LIMITS.sheets} 张图`)
  expect(MAKING_MODELS).toMatch(/GPT 6.*Claude Opus 5\.5/)
  // The discipline is how a good author works, for any subject.
  for (const phrase of ["先大形后细节", "每个角度都看", "检查轮廓", "把动作从头到尾过一遍", "对着自己的部件说明", "没有参与制作的评审"]) expect(MAKING_DISCIPLINE).toContain(phrase)
  expect(REVIEWER_HANDOFF).toContain("核实不了")

  const handoff = everythingToRead({ configuration: JSON.stringify({ mcpServers: { "minemods-studio": { command: "studio.exe", args: [] } } }) })
  expect(handoff).toContain("## 看着做（模型、贴图、动画、施法动作、方块、物品、效果）")
  expect(handoff).toContain(MAKING_SUMMARY)
  expect(handoff).toContain(MAKING_DISCIPLINE)
  expect(handoff).toContain(REVIEWER_HANDOFF)
  expect(handoff).toContain(MAKING_MODELS)
  MCP_MAKING_REFUSALS.forEach((refusal) => expect(handoff).toContain(`- ${refusal}`))
  MCP_MAKING_ENDINGS.forEach((ending) => expect(handoff).toContain(`- ${ending}`))
  expect(handoff).toContain(FINDING_LINE)
  expect(handoff).toContain(MCP_MAKING_WORKFLOW.map((name) => `\`${name}\``).join(" → "))
  expect(handoff).toContain("不提供任何题材的模板、现成零件")
  // Nothing in what an AI is told names a default recipe any more.
  const told = [handoff, MAKING_DISCIPLINE, SHEET_INSTRUCTIONS, SELF_REVIEW_INSTRUCTIONS, REVIEWER_INSTRUCTIONS, ...LOOKED_KINDS.map((kind) => MODULES[kind].instructions), ...LOOKED_KINDS.map((kind) => MODULES[kind].summary)].join("\n")
  expect(told).not.toMatch(/默认做法|默认从|默认写|不要自己写轨道|已经按材质画好|四足石头守卫|各用一两个比例准确的方块/)
  expect(MODULES.model.instructions).toContain("没有默认的那一种")
  expect(MODULES.gesture.instructions).toContain("没有默认的那一种")
  // The six criteria are what the self-review judges by, together with the sheet; a reviewer is handed the ones of the kind it reviews.
  for (const criterion of capabilities.acceptance.criteria) expect(SELF_REVIEW_INSTRUCTIONS).toContain(criterion.name)
  expect(REVIEWER_INSTRUCTIONS).toContain("criteria（适用于这一类东西的验收标准）")
})

test("给 AI 的话：评审只评这一样东西；问题分两种，线只画在一处；看不到不等于没做到；交最好的一版，不用放弃", () => {
  const handoff = everythingToRead({ configuration: JSON.stringify({ mcpServers: { "minemods-studio": { command: "studio.exe", args: [] } } }) })
  // One definition, told to the maker and to the reviewer alike.
  for (const text of [SELF_REVIEW_INSTRUCTIONS, REVIEWER_INSTRUCTIONS, handoff]) expect(text).toContain(FINDING_LINE)
  expect(FINDING_LABELS).toEqual({ blocking: "必须改的", advice: "可以更好的" })
  for (const phrase of ["认不出", "点了名的部件没有做", "悬空没接上", "动作放不出来", "和人的原话相反", "更有神、更有分量", "“看不到”本身永远不能算必须改的"]) expect(FINDING_LINE).toContain(phrase)
  // The examples are about kinds of fault, not about any subject.
  expect(FINDING_CONTRASTS.length).toBeGreaterThanOrEqual(4)
  expect(FINDING_LINE).not.toMatch(/守卫|矿石|龙|机器人|生物|史莱姆/)
  // The scope of a review: this asset against its sheet; the whole sentence is context.
  for (const phrase of ["只验收这一样东西本身", "not_judged", "只用来了解背景", "不是替他做决定"]) expect(REVIEWER_INSTRUCTIONS).toContain(phrase)
  expect(REVIEWER_INSTRUCTIONS).not.toMatch(/原话要的东西做出来了吗|图上看不出来的就算没做到|不要替制作者想象/)
  expect(MAKING_DISCIPLINE).not.toContain("图上看不出来的不算做到")
  // Not shown is not the same as not achieved, and asking is bounded.
  for (const phrase of ["看不到不等于没做到", "need", `最多这样要 ${MAKING_LIMITS.needs} 次`, "不能写进 findings"]) expect(REVIEWER_INSTRUCTIONS).toContain(phrase)
  // A sheet describes what can be seen and how it moves; behaviour is someone else's.
  for (const text of [SHEET_INSTRUCTIONS, MAKING_DISCIPLINE]) expect(text).toMatch(/行为.*不属于这一样东西/)
  // Finishing with advice left over is normal, the person decides, and giving up is not needed.
  for (const phrase of ["是正常的", "由人在验收卡上自己决定", "不需要放弃", UNSATISFIED.mark]) expect(MAKING_DISCIPLINE).toContain(phrase)
  expect(SELF_REVIEW_INSTRUCTIONS).toContain("advice 里还留着东西很正常")
  expect(MCP_TOOLS.find((tool) => tool[0] === "fail_task")![1]).toContain(UNSATISFIED.mark)
  expect(MCP_TOOLS.find((tool) => tool[0] === "final_review")![2]).toContain("need?")
  expect(handoff).not.toContain("让依赖任务进入 blocked。\"")
  // The sides are said once, in the instructions, and the labels on the pictures are plain words.
  for (const text of [SELF_REVIEW_INSTRUCTIONS, REVIEWER_INSTRUCTIONS, handoff]) expect(text).toContain("它自己的左边在 +X 一侧")
  for (const text of [SELF_REVIEW_INSTRUCTIONS, REVIEWER_INSTRUCTIONS, handoff]) expect(text).toContain("不要按别的格子的画面左右去推")
})

test("看什么由种类决定：模型看六个角度，贴图平铺和穿在模型上，动画和施法动作看逐帧", () => {
  const model = lookJob(good, null)
  expect(model.job.sheets).toHaveLength(1)
  expect(model.job.sheets[0]).toMatchObject({ label: "六个角度", columns: 3, cell: [512, 512] })
  // One sheet is never larger than the documented picture size.
  expect([model.job.sheets[0]!.columns * model.job.sheets[0]!.cell[0], Math.ceil(model.job.sheets[0]!.cells.length / model.job.sheets[0]!.columns) * model.job.sheets[0]!.cell[1]]).toEqual([...MAKING_LIMITS.sheet])
  const named = lookJob(good, null, { names: true })
  expect(named.job.sheets[1]).toMatchObject({ label: "部件名字", cells: [{ names: true }, { names: true }] })
  // Shape only: the second scene is the same boxes with nothing on them.
  const bare = lookJob(good, null, { shape_only: true })
  expect(bare.job.sheets[1]!.cells.every((cell) => cell.kind === "view" && cell.scene === 1)).toBe(true)
  expect(JSON.stringify(bare.job.scenes[1]!.design.bones.flatMap((bone) => bone.cubes.map((cube) => [cube.paint, cube.features, cube.surface_details])))).not.toMatch(/eyes|#[0-9a-f]{6}/i)
  const timed = lookJob(good, null, { animation: "walk", times: [0, 0.25] })
  // The moments asked for, then the two moments that differ most laid over each other.
  expect(timed.job.sheets[1]!.cells.map((cell) => (cell.kind === "view" ? [cell.animation, cell.time] : cell.kind))).toEqual([["walk", 0], ["walk", 0.25], "compare"])
  expect(() => lookJob(good, null, { animation: "fly" })).toThrow(MakingRefusal)

  const texture = getModuleSchema("texture").parse({ kind: "texture", width: 64, height: 64, palette: ["#336633", "#224422"], pixels: Array.from({ length: 64 * 64 }, (_, index) => index % 2) }) as ModuleDocument
  const flat = lookJob(texture, null)
  expect(flat.job.sheets[0]!.cells.map((cell) => cell.kind)).toEqual(["flat"])
  expect(flat.notes[0]).toContain("没有挂在任何模型上")
  const worn = lookJob(texture, good)
  expect(worn.job.sheets[0]!.cells.map((cell) => cell.kind)).toEqual(["flat", "view", "view", "view", "view", "view"])
  expect(worn.job.scenes[0]!.preview?.textureDataUrl).toBe(worn.job.sheets[0]!.cells[0]!.kind === "flat" ? worn.job.sheets[0]!.cells[0]!.url : "")

  const motion = getModuleSchema("animation").parse({ kind: "animation", ...good.animations[0]! }) as ModuleDocument
  expect(lookJob(motion, good).job.sheets.map((value) => [value.label, value.cells.length])).toEqual([["待机（idle） · 斜前方", MAKING_LIMITS.frames], ["待机（idle） · 它的左侧", MAKING_LIMITS.frames]])
  expect(() => lookJob(motion, null)).toThrow("没有东西可以摆出这个动作")

  const cast = lookJob(getModuleSchema("gesture").parse(GESTURE_EXAMPLE) as ModuleDocument, null)
  expect(cast.job.sheets.map((value) => [value.label, value.cells.length, value.cell[1] < value.cell[0]])).toEqual([["别人看到的（第三人称）", MAKING_LIMITS.frames, false], ["自己看到的（第一人称）", MAKING_LIMITS.frames, true]])
  expect(cast.job.sheets[1]!.cells.every((cell) => cell.kind === "view" && cell.camera !== undefined)).toBe(true)
  // Every kind's look fits one vision request.
  for (const made of [model, named, bare, timed, flat, worn, cast]) expect(made.job.sheets.length).toBeLessThanOrEqual(MAKING_LIMITS.sheets)
  expect(() => lookJob({ kind: "worldview", title: "矿洞", summary: "", entries: [] } as ModuleDocument, null)).toThrow("不需要看图")
  // Every kind brings one single view for a thumbnail, so nobody has to guess where to crop a sheet.
  for (const made of [model, flat, worn, lookJob(motion, good), cast]) expect(made.cover).toMatchObject({ label: "封面", columns: 1, cells: [{}] })
  expect(worn.cover.cells[0]).toMatchObject({ kind: "view", view: "quarter" })
  expect(flat.cover.cells[0]!.kind).toBe("flat")
  // Every label on a picture is a word a person reads as it is; no axis names.
  const labels = [model, named, bare, timed, worn, lookJob(motion, good), cast, reviewJob(fourMotions, null), needJob(good, null, [{ what: "angle", name: "left" }, { what: "motion", name: "walk" }])].flatMap((made) => made.job.sheets.flatMap((value) => [value.label, ...value.cells.map((cell) => cell.label)]))
  expect(labels.join("\n")).not.toMatch(/[+-][XYZ]|文档里|plus_x|minus_x/)
  expect(labels).toEqual(expect.arrayContaining(["正面", "背面", "它的右侧", "它的左侧", "从上往下", "斜前方", "只看形状", "走路（walk） · 斜前方", "受伤（hurt） · 它的左侧"]))
})

test("验收用的图是一整套：六个角度、只看形状、每一个动作从两个方向逐帧；有上限，动作多了就合并，每个动作都看得到", () => {
  // Four motions: 2 + 4 × 2 = 10 pictures, within the budget.
  const set = reviewJob(fourMotions, null)
  expect(set.job.sheets.map((value) => value.label)).toEqual([
    "六个角度",
    "只看形状",
    ...["待机（idle）", "走路（walk）", "受伤（hurt）", "攻击（attack）"].flatMap((name) => [`${name} · 斜前方`, `${name} · 它的左侧`]),
  ])
  expect(set.job.sheets.length).toBeLessThanOrEqual(MAKING_LIMITS.review_sheets)
  // Nothing was left out; what is said with the set is every motion's measured facts: how much it moves, and how it holds together.
  expect(set.notes).toEqual(set.facts)
  // 第 2 步: and one on how the attack (the one motion that neither loops nor is a flinch or a death) is phrased.
  expect(set.facts).toHaveLength(fourMotions.animations.length * 2 + 1)
  expect(set.facts.at(-1)).toStartWith("攻击（attack）的节奏")
  // Every motion is there frame by frame, from a quarter and from a side, and nothing is larger than the documented picture.
  for (const name of fourMotions.animations.map((value) => value.name)) {
    const strips = set.job.sheets.filter((value) => value.cells.some((cell) => cell.kind === "view" && cell.animation === name))
    expect(strips.map((value) => [value.cells.length, new Set(value.cells.map((cell) => (cell.kind === "view" || cell.kind === "compare") && cell.view)).size])).toEqual([[MAKING_LIMITS.frames, 1], [MAKING_LIMITS.frames, 1]])
    expect(new Set(strips.flatMap((value) => value.cells.map((cell) => (cell.kind === "view" || cell.kind === "compare") && cell.view))).size).toBe(2)
    // The last cell of each lays the two moments that differ most over each other: a small motion shows there.
    expect(strips.map((value) => value.cells.map((cell) => cell.kind).join(" "))).toEqual(["view view view view view compare", "view view view view view compare"])
  }
  for (const value of set.job.sheets) expect([value.columns * value.cell[0] <= MAKING_LIMITS.sheet[0], Math.ceil(value.cells.length / value.columns) * value.cell[1] <= MAKING_LIMITS.sheet[1]]).toEqual([true, true])
  expect(set.job.sheets[1]!.cells.every((cell) => cell.kind === "view" && cell.scene === 1)).toBe(true)

  // A motion of parts behind the middle is shot from the back quarter, and from the side the quarter does not show; one that leans to a side, from that side.
  const tailed = { ...good, bones: [...good.bones, { ...good.bones.find((bone) => bone.name === "sprout")!, name: "tail", pivot: [0, 4, 7] as [number, number, number], cubes: [] }, { ...good.bones.find((bone) => bone.name === "sprout")!, name: "arm", pivot: [-6, 6, 0] as [number, number, number], cubes: [] }] }
  const wag = { ...tailed, animations: [...tailed.animations, { name: "wag", length: 1, loop: true, channels: [{ bone: "tail", keyframes: [{ time: 0, rotation: [0, 0, 0] as [number, number, number] }] }] }, { name: "wave", length: 1, loop: true, channels: [{ bone: "arm", keyframes: [{ time: 0, rotation: [0, 0, 0] as [number, number, number] }] }] }] }
  const views = (name: string) => reviewJob(wag, null).job.sheets.filter((value) => value.label.includes(`（${name}）`) || value.label.includes(`「${name}」`)).map((value) => value.label)
  expect(views("wag")).toEqual(["「wag」 · 斜后方", "「wag」 · 它的右侧"])
  // A motion with a plain name is called by it, its clip name beside it for the one who writes it.
  expect(views("wave")).toEqual(["挥动（wave） · 斜前方", "挥动（wave） · 它的右侧"])

  // More motions than fit at two pictures each: one picture per motion, three moments from both directions.
  const motions = (count: number) => ({ ...good, animations: [...good.animations, ...Array.from({ length: count - good.animations.length }, (_, index) => ({ ...good.animations[0]!, name: `extra_${index}` }))] })
  const many = reviewJob(motions(7), null)
  expect(many.job.sheets).toHaveLength(2 + 7)
  expect(many.job.sheets[2]).toMatchObject({ label: "待机（idle） · 斜前方和它的左侧" })
  expect(many.job.sheets[2]!.cells.map((cell) => cell.label)).toEqual(["斜前方 · 0.25 秒", "斜前方 · 1.25 秒", "动得最多的两刻叠在一起（0.25 秒和 1.25 秒）", "它的左侧 · 0.25 秒", "它的左侧 · 1.25 秒", "动得最多的两刻叠在一起（0.25 秒和 1.25 秒）"])
  // Still more: motions share sheets, so that none is left unseen (`review-motions.test.ts` has the rest of it: how the cells are shared, and what is said when even one cell each does not fit).
  const crowd = reviewJob(motions(13), null)
  expect(crowd.job.sheets.length).toBeLessThanOrEqual(MAKING_LIMITS.review_sheets)
  expect(new Set(crowd.job.sheets.flatMap((value) => value.cells.flatMap((cell) => (cell.kind === "view" && cell.animation ? [cell.animation] : [])))).size).toBe(13)
  expect(crowd.notes).toEqual([expect.stringContaining("动作有 13 个，一次放不下每个动作的整段逐帧图"), ...crowd.facts])
  // The other kinds are whole in one look already.
  const motion = getModuleSchema("animation").parse({ kind: "animation", ...good.animations[0]! }) as ModuleDocument
  expect(reviewJob(motion, good).job.sheets.map((value) => value.label)).toEqual(["待机（idle） · 斜前方", "待机（idle） · 它的左侧"])
})

test("评审要补看的：某一面的大图、近看一个部件、换两个方向再看一个动作；没有的东西用大白话说", () => {
  const asked = needJob(good, null, [{ what: "angle", name: "back" }, { what: "close_up", name: "sprout" }, { what: "motion", name: "hurt" }])
  expect(asked.job.sheets.map((value) => [value.label, value.cells.map((cell) => cell.label)])).toEqual([
    ["背面（大图）", ["背面", "背面 · 只看形状"]],
    ["近看「sprout」", ["正面", "背面", "它的左侧", "斜前方"]],
    // The set showed this motion from the front quarter and the right; what is asked for comes from the other two.
    // Each direction shows the motion's two extremes, then the two laid over each other.
    ["受伤（hurt） · 斜后方和它的右侧", ["斜后方 · 0.07 秒", "斜后方 · 0.17 秒", "动得最多的两刻叠在一起（0.07 秒和 0.17 秒）", "它的右侧 · 0.07 秒", "它的右侧 · 0.17 秒", "动得最多的两刻叠在一起（0.07 秒和 0.17 秒）"]],
  ])
  // The moments asked for; more than three come from the other quarter alone. A side may be named in the picture's own word.
  expect(needJob(good, null, [{ what: "motion", name: "hurt", times: [0.1, 0.2] }]).job.sheets[0]!.cells.map((cell) => cell.label.replace(/（.*/, ""))).toEqual(["斜后方 · 0.1 秒", "斜后方 · 0.2 秒", "动得最多的两刻叠在一起", "它的右侧 · 0.1 秒", "它的右侧 · 0.2 秒", "动得最多的两刻叠在一起"])
  expect(needJob(good, null, [{ what: "motion", name: "walk", times: [0, 0.1, 0.2, 0.3] }]).job.sheets[0]).toMatchObject({ label: "走路（walk） · 斜后方", cells: [{}, {}, {}, {}, { kind: "compare" }] })
  expect(needJob(good, null, [{ what: "angle", name: "它的右侧" }]).job.sheets[0]!.label).toBe("它的右侧（大图）")
  // Left and right are the thing's own however they are asked for: plain 左侧 and "left" are the side its own left is on.
  expect(needJob(good, null, [{ what: "angle", name: "左侧" }, { what: "angle", name: "left" }]).job.sheets.map((sheet) => [sheet.label, (sheet.cells[0] as { view: string }).view])).toEqual([["它的左侧（大图）", "plus_x"], ["它的左侧（大图）", "plus_x"]])
  expect(() => needJob(good, null, [{ what: "angle", name: "underneath" }])).toThrow("没有叫「underneath」的角度。可以要：front、back、left、right、top、quarter、quarter_back（left 和 right 是它自己的左侧和右侧）。")
  expect(() => needJob(good, null, [{ what: "motion", name: "fly" }])).toThrow("没有叫「fly」的动作。它有：idle、walk、hurt。")
  // An animation is asked about on the model it moves; a gesture only by its moments.
  const motion = getModuleSchema("animation").parse({ kind: "animation", ...good.animations[0]! }) as ModuleDocument
  expect(needJob(motion, good, [{ what: "motion" }]).job.sheets[0]!.label).toBe("待机（idle） · 斜后方和它的右侧")
  const cast = getModuleSchema("gesture").parse(GESTURE_EXAMPLE) as ModuleDocument
  expect(needJob(cast, null, [{ what: "motion", times: [0.2] }]).job.sheets.map((value) => value.cells.length)).toEqual([1, 1])
  expect(() => needJob(cast, null, [{ what: "angle", name: "back" }])).toThrow("施法动作只能按时刻再看")
})

test("画图排队、限时、永远有回答：画不出来是一句话，不是卡住", async () => {
  const order: string[] = []
  const gaveUp: number[] = []
  const slowStarted = Promise.withResolvers<void>()
  const releaseSlow = Promise.withResolvers<void>()
  const hangStarted = Promise.withResolvers<void>()
  const timers: { ms: number; expire: () => void; canceled: boolean }[] = []
  const job = (label: string): LookJob => ({ scenes: [], sheets: [{ label, columns: 1, cell: [8, 8], cells: [] }] })
  const queue = lookQueue(
    async (given) => {
      const label = given.sheets[0]!.label
      order.push(`start ${label}`)
      if (label === "slow") {
        slowStarted.resolve()
        await releaseSlow.promise
      }
      if (label === "hang") {
        hangStarted.resolve()
        await new Promise(() => undefined)
      }
      if (label === "throw") throw new Error("WebGL context lost")
      order.push(`end ${label}`)
      return { ok: true, pictures: [{ label, url: PIXEL }] }
    },
    {
      timeoutMs: 60,
      giveUp: () => gaveUp.push(order.length),
      schedule: (ms, expire) => {
        const timer = { ms, expire, canceled: false }
        timers.push(timer)
        return () => { timer.canceled = true }
      },
    },
  )
  const queued = Promise.all([queue(job("slow")), queue(job("quick")), queue(job("hang")), queue(job("throw")), queue(job("after"))])
  await slowStarted.promise
  expect(order).toEqual(["start slow"])
  releaseSlow.resolve()
  await hangStarted.promise
  expect(timers.map(({ ms, canceled }) => [ms, canceled])).toEqual([[60, true], [60, true], [60, false]])
  timers[2]!.expire()
  const results = await queued
  // One after another, in the order asked.
  expect(order).toEqual(["start slow", "end slow", "start quick", "end quick", "start hang", "start throw", "start after", "end after"])
  expect(results.map((result) => result.ok)).toEqual([true, true, false, false, true])
  expect(results[2]).toEqual({ ok: false, reason: "预览图画了 0 秒还没有画完，已经放弃这一次。" })
  expect(results[3]).toEqual({ ok: false, reason: "预览图没有画出来。" })
  // Whatever was drawing is thrown away after each failure, so the next look starts clean.
  expect(gaveUp).toHaveLength(2)
})

test("给外部 AI 的图是 MCP 的图片内容，文字里只留图的名字", () => {
  const value = { round: 2, findings: ["认得出：看不出脸。"], pictures: [{ label: "六个角度", url: PIXEL }, { label: "坏的", url: "file:///etc/passwd" }] }
  const result = pictured(value)
  expect(result.content[0]!.type).toBe("text")
  expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({ round: 2, findings: ["认得出：看不出脸。"], pictures: ["六个角度", "坏的"] })
  expect(result.content.slice(1)).toEqual([{ type: "image", data: PIXEL.split(",")[1]!, mimeType: "image/png" }])
  expect(JSON.stringify(result.structuredContent)).not.toContain("base64")
  // A result without pictures is plain output.
  expect(pictured({ state: "making" })).toEqual(output({ state: "making" }))
})

// ---------- script modelling, reference images, and a making that was cut short ----------

/** A script whose document is the creature the standard passes, under any name: what it returns is the document, written out. */
const scriptOf = (name: string) => `// ${name}\nconst made = ${JSON.stringify(named(name))}\nreturn made`
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]).toString("base64")}`

test("脚本建模，外部 AI：script 可以代替 document；跑出来的就是普通文档，看图、自评、验收、提交都一样，记录里留着脚本", async () => {
  const hidden = renderer()
  const { created, directory, runner } = await bench({ look: hidden.look })
  const { ids, assetId } = await claimed(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...ids, sheet })
  // A script that does not run is a sentence, at the line it went wrong; nothing was looked at and nothing changed.
  expect(await words(runner.lookExternalTask({ ...ids, script: "const m = api.model({ name: 'x' })\nm.bone('root').cube('box', { origin: [0, 0, 0], size: [1, 0, 1], color: '#808080' })" }))).toBe(
    "脚本运行到第 2 行出错了：方块「root.box」的 size 里的每个数要是 1 到 256 之间的整数，现在是 0。脚本没有产出文档，什么都没有改动：改好脚本再交一次。",
  )
  expect(await words(runner.lookExternalTask({ ...ids, script: "while (true) {}" }))).toContain(SCRIPT_ERRORS.timeout)
  expect(await words(runner.lookExternalTask({ ...ids, script: "return require('node:fs')" }))).toContain(SCRIPT_ERRORS.missing("require", 1))
  expect(await words(runner.lookExternalTask({ ...ids, script: scriptOf("第一版"), document: good }))).toBe("document 和 script 只交一样：两样都给，Studio 不知道以哪一个为准。")
  expect((await readMaking(directory, assetId))!.rounds).toEqual([])
  expect(hidden.jobs).toHaveLength(0)

  const first = await runner.lookExternalTask({ ...ids, script: scriptOf("第一版") })
  expect(first).toMatchObject({ round: 1, findings: [], script: { summary: { kind: "model", bones: good.bones.length, cubes: good.bones.flatMap((bone) => bone.cubes).length, texture_size: good.texture_size }, notes: [] } })
  expect((await readMaking(directory, assetId))!.rounds[0]!.script).toBe(scriptOf("第一版"))
  // The draft the person watches is the document the script produced.
  expect((await runner.getExternalProgress({ projectId: created.id, runId: ids.runId })).drafts[ids.taskId]!.draft).toEqual(named("第一版"))
  await runner.selfReviewExternalTask({ ...ids, ...revise })
  // A revision is the script edited: a new version, with its own script beside it.
  await runner.lookExternalTask({ ...ids, script: scriptOf("第二版") })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  await runner.finalReviewExternalTask(ids)
  await runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], advice: [], independent: true } })
  // Handing in a different script is handing in a version nobody looked at.
  expect(await words(runner.commitExternalTask({ ...ids, script: scriptOf("没看过的一版") }))).toBe(`${REFUSALS.unseen}任务保持运行，工程里什么都没有改动。`)
  // The same script gives the same document: it is the version that was looked at and reviewed.
  await runner.commitExternalTask({ ...ids, script: scriptOf("第二版") })
  expect((await openProject(directory)).workspace.assets[0]!.document).toEqual(named("第二版"))
  const record = (await readMaking(directory, assetId))!
  expect(record).toMatchObject({ state: "done", outcome: "passed" })
  expect(record.rounds.map((round) => round.script)).toEqual([scriptOf("第一版"), scriptOf("第二版")])

  // update_task takes a script for the draft as well; kinds that are plain data do not take scripts.
  const other = await bench({ look: renderer().look })
  const held = await claimed(other.runner, other.created.id, other.created.revision)
  const progress = await other.runner.updateExternalTask({ ...held.ids, script: scriptOf("草稿") })
  expect(progress.drafts[held.ids.taskId]!.draft).toEqual(named("草稿"))
  expect(progress.script).toMatchObject({ summary: { kind: "model" } })
  const world = await bench({ look: renderer().look })
  const lore = await claimed(world.runner, world.created.id, world.created.revision, "worldview")
  expect(await words(world.runner.updateExternalTask({ ...lore.ids, script: "return {}" }))).toContain(SCRIPT_ERRORS.not_scripted("世界观"))
}, 30_000)

test("脚本建模，Studio 自己的 AI：可以用脚本作答；脚本跑不通就带着原因让它改，改上一版时改的是脚本", async () => {
  const hidden = renderer()
  const broken = "const m = api.model({ name: 'x' })\nm.bone('root').cube('box', { origin: [0, 0, 0], size: [1, 0, 1], color: '#808080' })"
  const answers = [{ script: broken, document: null }, { script: scriptOf("第 1 版"), document: null }, { script: scriptOf("第 2 版"), document: null }]
  const fake = provider({
    make: (count) => answers[count - 1],
    self: (round) => guided({ ...(round === 1 ? revise : done), advice: [] }),
    review: () => answer({}),
  })
  const { created, directory, runner } = await bench({ look: hidden.look, ai: fake.ai })
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(run.state).toBe("completed")
  // A script that did not run is not a version: it is handed back once with what went wrong, then the loop goes on.
  expect(fake.sent.map((call) => call.kind)).toEqual(["sheet", "make", "make", "self", "make", "self", "review"])
  const [, first, repaired, , revised] = fake.sent
  expect(first!.instructions).toContain(SCRIPTED_ANSWER_INSTRUCTIONS)
  expect(first!.instructions).toContain(SCRIPT_GUIDE)
  expect(first!.input.script_failed).toBeUndefined()
  expect(repaired!.input.script_failed).toEqual({ script: broken, error: "脚本运行到第 2 行出错了：方块「root.box」的 size 里的每个数要是 1 到 256 之间的整数，现在是 0。", line: 2 })
  expect(repaired!.input.making).toEqual({ round: 1, rounds_allowed: MAKING_LIMITS.rounds })
  // The revision is given the script of the version before, not its long document.
  expect(revised!.input.revision_required).toMatchObject({ script: scriptOf("第 1 版"), self_review: { problems: revise.problems } })
  expect(revised!.input.revision_required.document).toBeUndefined()
  const asset = (await openProject(directory)).workspace.assets[0]!
  expect(asset.document).toEqual(named("第 2 版"))
  expect((await readMaking(directory, asset.id))!.rounds.map((round) => round.script)).toEqual([scriptOf("第 1 版"), scriptOf("第 2 版")])

  // A script that never runs ends the version in plain words; an answer with neither is said too.
  const stuck = provider({ make: () => ({ script: broken, document: null }), self: () => guided({ ...done, advice: [] }), review: () => answer({}) })
  const second = await bench({ look: renderer().look, ai: stuck.ai })
  const failed = await terminal(second.runner, second.created.id, (await second.runner.start({ projectId: second.created.id, expectedRevision: second.created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(failed.state).toBe("failed")
  expect(stuck.sent.filter((call) => call.kind === "make")).toHaveLength(SCRIPT_REPAIRS + 1)
  expect(failed.tasks[0]!.error).toContain(`AI 写的脚本改了 ${SCRIPT_REPAIRS} 次还是跑不出模型`)
}, 30_000)

test("参考图：人放进来的图存在工程里，每次看图和验收都拼成一张放在渲染图旁边；构想图标明是 AI 画的，排在人给的后面", async () => {
  const hidden = renderer()
  const { service, call } = await studio(hidden.look)
  const projectId = (await service.createProject({ name: "参考图", description: "", modId: "refs", empty: true })).project.id
  await call("proposeBlueprint", { projectId, request: "一只守着矿石的敌对生物", blueprint: blueprint([{ key: "guardian_model", kind: "model" }]), paper_play: PAPER })
  await service.confirmBlueprint({ projectId, revision: 1 })
  // Attached before anything is made: the item is a plan entry and nothing more yet.
  expect(await service.getReferences({ projectId, itemId: "guardian_model" })).toEqual([])
  const attached = await service.addReference({ projectId, itemId: "guardian_model", name: "守卫草图.png", url: PIXEL })
  expect(attached).toEqual([{ id: expect.any(String), kind: "user", name: "守卫草图.png", url: PIXEL }])
  // Refusals are plain words; nothing is stored.
  expect(publicError(await service.addReference({ projectId, itemId: "guardian_model", name: "a.svg", url: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}` }).catch((error: unknown) => error))).toBe(REFERENCE_REFUSALS.not_a_picture)
  expect(publicError(await service.addReference({ projectId, itemId: "guardian_model", name: "a.png", url: `data:image/png;base64,${Buffer.from("not a picture").toString("base64")}` }).catch((error: unknown) => error))).toBe(REFERENCE_REFUSALS.not_a_picture)

  const batch = (await call("nextBatch", { projectId })) as ExternalStartResult
  const model = { projectId, runId: batch.run.id, taskId: batch.tasks[0]!.task.id }
  const claim = (await call("claimExternalTask", model)) as ExternalTaskContext
  // The maker is told what is attached and how to read it.
  expect(claim.making).toMatchObject({ references: [{ kind: "user", name: "守卫草图.png" }], reference_guide: `${REFERENCE_GUIDE}${CONCEPT_GUIDE}${REFERENCE_ZOOM_GUIDE}` })
  expect(REFERENCE_GUIDE).toContain("六视图排第一，人给的参考图其次")
  await call("describeExternalTask", { ...model, sheet })
  // The maker may hand in views of what it intends; they are kept as AI-drawn, after the person's own.
  expect(await call("conceptExternalTask", { ...model, views: [{ name: "正面", image: JPEG }, { name: "侧面", image: JPEG }] })).toMatchObject({ references: [{ kind: "user", name: "守卫草图.png" }, { kind: "concept", name: "正面" }, { kind: "concept", name: "侧面" }], how: REFERENCE_GUIDE })
  await expect(call("conceptExternalTask", { ...model, views: [{ name: "正面", image: "data:text/html;base64,PGI+" }] })).rejects.toThrow(REFERENCE_REFUSALS.not_a_picture)
  // Handing in again replaces what it handed in before.
  expect(await call("conceptExternalTask", { ...model, views: [{ name: "三视图", image: JPEG }] })).toMatchObject({ references: [{ kind: "user" }, { kind: "concept", name: "三视图" }] })

  const looked = (await call("lookExternalTask", { ...model, document: good })) as { pictures: { label: string; url: string }[] }
  // One more picture beside the look: the references on one sheet, not counted against the look's own.
  expect(looked.pictures.map((picture) => picture.label)).toEqual(["六个角度", REFERENCE_SHEET_NAME])
  const sheetJob = hidden.jobs.at(-1)!
  expect(sheetJob.scenes).toEqual([])
  expect(sheetJob.sheets).toEqual([referenceSheet([{ kind: "user", name: "守卫草图.png", url: PIXEL }, { kind: "concept", name: "三视图", url: JPEG }], REFERENCE_LIMITS.shown)!])
  expect(sheetJob.sheets[0]!.cells.map((cell) => cell.label)).toEqual(["人给的参考图 1 · 守卫草图.png", "AI 画的构想图 2 · 三视图"])
  // It is not a picture of any version, so the round does not hold it.
  const making = (await service.getMaking({ projectId, itemId: "guardian_model" })) as Making
  expect(making.rounds[0]!.pictures.map((picture) => picture.label)).toEqual(["六个角度"])
  expect(making.references).toEqual([{ id: attached[0]!.id, kind: "user", name: "守卫草图.png" }, { id: expect.any(String), kind: "concept", name: "三视图" }])
  expect((await service.getReferences({ projectId, itemId: "guardian_model" })).map((reference) => [reference.kind, reference.url])).toEqual([["user", PIXEL], ["concept", JPEG]])

  await call("selfReviewExternalTask", { ...model, ...done })
  const packet = (await call("finalReviewExternalTask", model)) as unknown as { instructions: string; pictures: { label: string }[] }
  // The reviewer gets the same sheet beside the whole set, and is told how to read it.
  expect(packet.pictures.map((picture) => picture.label)).toEqual([...REVIEW_SET, REFERENCE_SHEET_NAME])
  expect(packet.instructions).toContain(REFERENCE_GUIDE)
  // The person takes one away; what is left is what the next look shows.
  await service.removeReference({ projectId, itemId: "guardian_model", referenceId: attached[0]!.id })
  expect(((await service.getMaking({ projectId, itemId: "guardian_model" })) as Making).references).toEqual([{ id: expect.any(String), kind: "concept", name: "三视图" }])
  await call("conceptExternalTask", { ...model, views: [] })
  const bare = (await call("finalReviewExternalTask", model)) as unknown as { pictures: { label: string }[] }
  expect(bare.pictures.map((picture) => picture.label)).toEqual(REVIEW_SET)
  expect("references" in ((await service.getMaking({ projectId, itemId: "guardian_model" })) as Making)).toBe(false)
}, 30_000)

test("参考图：一张最多拼七格，人给的在前；说明里各有一句用途和责任；能力清单和交接说明里有脚本和参考图", async () => {
  const many = [...Array.from({ length: 3 }, (_, index) => ({ kind: "concept" as const, name: `构想 ${index + 1}`, url: PIXEL })), ...Array.from({ length: 4 }, (_, index) => ({ kind: "user" as const, name: `参考 ${index + 1}`, url: PIXEL }))]
  expect(referenceSheet([], REFERENCE_LIMITS.shown)).toBeNull()
  expect(referenceSheet(many.slice(3, 4), REFERENCE_LIMITS.shown)).toMatchObject({ label: REFERENCE_SHEET_NAME, columns: 1, cell: [MAKING_LIMITS.sheet[1], MAKING_LIMITS.sheet[1]] })
  expect(referenceSheet(many.slice(3, 5), REFERENCE_LIMITS.shown)).toMatchObject({ columns: 2, cell: [MAKING_LIMITS.sheet[0] / 2, MAKING_LIMITS.sheet[1]] })
  // Up to four pictures lie two to a row, as before; more lie three to a row like the six-angle renders.
  expect(referenceSheet(many.slice(0, 4), REFERENCE_LIMITS.shown)).toMatchObject({ columns: 2, cell: [MAKING_LIMITS.sheet[0] / 2, MAKING_LIMITS.sheet[1] / 2] })
  expect(referenceSheet(many.slice(0, 5), REFERENCE_LIMITS.shown)).toMatchObject({ columns: 3, cell: [MAKING_LIMITS.sheet[0] / 3, MAKING_LIMITS.sheet[1] / 2] })
  const full = referenceSheet([...many, ...many], REFERENCE_LIMITS.shown)!
  expect(full.cells).toHaveLength(REFERENCE_LIMITS.shown)
  // Never larger than one sheet.
  expect(full.columns * full.cell[0]).toBe(MAKING_LIMITS.sheet[0])
  expect(Math.ceil(full.cells.length / full.columns) * full.cell[1]).toBeLessThanOrEqual(MAKING_LIMITS.sheet[1])
  expect(full.cells.every((cell) => cell.kind === "flat" && cell.picture === true)).toBe(true)
  // Stored order puts the person's own first, so theirs are the ones on the sheet when there are more than fit.
  const { created, directory, runner } = await bench({ look: renderer().look })
  const { ids } = await claimed(runner, created.id, created.revision)
  await runner.conceptExternalTask({ ...ids, views: many.slice(0, 3).map((view) => ({ name: view.name, image: view.url })) })
  const assetId = (await runner.get({ projectId: created.id, runId: ids.runId })).tasks[0]!.asset_id
  await many.slice(3).reduce(async (before, reference) => {
    await before
    await addReference(directory, assetId, reference)
  }, Promise.resolve())
  expect((await shownReferences(directory, [assetId])).slice(0, REFERENCE_LIMITS.shown).map((reference) => reference.kind)).toEqual(["user", "user", "user", "user", "concept", "concept", "concept"])
  // Whichever was added first, the list is the person's own and then what an AI drew.
  expect((await readReferences(directory, assetId)).map((reference) => reference.kind)).toEqual(["user", "user", "user", "user", "concept", "concept", "concept"])

  // The words: what references are for and whose they are, once for the AI and once for the person.
  expect(REFERENCE_GUIDE).toContain("参考图只用来参考形状和风格")
  expect(REFERENCE_GUIDE).toContain("人放进来的图由他自己负责")
  expect(REFERENCE_NOTE).toBe("参考图只用来参考形状和风格；你放进来的图由你自己负责。")
  expect(SELF_REVIEW_INSTRUCTIONS).toContain(REFERENCE_GUIDE)
  expect(REVIEWER_INSTRUCTIONS).toContain(REFERENCE_GUIDE)
  expect(SHEET_INSTRUCTIONS).toContain(REFERENCE_SHEET_NAME)
  expect(CONCEPT_GUIDE).toContain("可做可不做")
  const handoff = everythingToRead({ configuration: JSON.stringify({ mcpServers: { "minemods-studio": { command: "node", args: ["mcp.js"] } } }) })
  expect(handoff).toContain("save_concepts")
  expect(handoff).toContain(SCRIPT_EXAMPLE)
  expect(MCP_TOOLS.map((tool) => tool[0])).toContain("save_concepts")
  const capabilities = getMcpCapabilities("medium") as unknown as { making: { script: { api: unknown[]; limits: Record<string, number> }; references: { limits: Record<string, number> } } }
  expect(capabilities.making.script.api).toHaveLength(SCRIPT_API.length)
  expect(capabilities.making.script.limits).toEqual({ characters: SCRIPT_LIMITS.source, seconds: SCRIPT_LIMITS.seconds, memory_mb: SCRIPT_LIMITS.memory_mb })
  expect(capabilities.making.references.limits).toMatchObject({ user: REFERENCE_LIMITS.user, concept: REFERENCE_LIMITS.concept, megabytes: 4, sheets_per_look: MAKING_LIMITS.reference_sheets })
})

test("参考图，Studio 自己的 AI：人给了图，从写说明起每一步都带着；没给的时候可以请连接画一张构想图，画不出来就照常做", async () => {
  // The person attached a picture: no concept view is drawn, and the reference sheet rides with the sheet request, the maker, the self-review and the reviewer.
  const hidden = renderer()
  const fake = provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}) })
  const prompts: string[] = []
  const first = await bench({ look: hidden.look, ai: fake.ai, draws: async (request) => (prompts.push(request.prompt), JPEG) })
  // The thing exists already (made once, by hand-in); the person attaches a picture and has it remade.
  const before = await claimed(first.runner, first.created.id, first.created.revision)
  await first.runner.describeExternalTask({ ...before.ids, sheet })
  await first.runner.lookExternalTask({ ...before.ids, document: good })
  await first.runner.selfReviewExternalTask({ ...before.ids, ...done })
  await first.runner.finalReviewExternalTask(before.ids)
  await first.runner.finalReviewExternalTask({ ...before.ids, verdict: { passed: true, findings: [], independent: true } })
  await first.runner.commitExternalTask({ ...before.ids, document: good })
  await first.runner.conceptExternalTask({ ...before.ids, views: [] }).catch(() => null)
  await addReference(first.directory, before.assetId, { kind: "user", name: "草图.png", url: PIXEL })
  const redo = await first.runner.start({ projectId: first.created.id, expectedRevision: (await openProject(first.directory)).revision, prompt: "照着图重做", module: "model", assetId: before.assetId })
  expect((await terminal(first.runner, first.created.id, redo.id)).state).toBe("completed")
  expect(prompts).toEqual([])
  const [described, made, judged, reviewer] = fake.sent
  expect(described!.images).toEqual([PIXEL])
  expect(made!.images).toEqual([PIXEL])
  expect(judged!.input.pictures.at(-1)).toBe(REFERENCE_SHEET_NAME)
  expect(reviewer!.input.pictures.at(-1)).toBe(REFERENCE_SHEET_NAME)
  expect(reviewer!.images).toHaveLength(REVIEW_SET.length + 1)

  // Nothing attached: the connection is asked for one picture of what the sheet describes, and it becomes a concept view.
  const again = provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}) })
  const second = await bench({ look: renderer().look, ai: again.ai, draws: async (request) => (prompts.push(request.prompt), JPEG) })
  const run = await terminal(second.runner, second.created.id, (await second.runner.start({ projectId: second.created.id, expectedRevision: second.created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(run.state).toBe("completed")
  expect(prompts).toEqual([conceptPrompt(sheet)])
  expect(prompts[0]).toContain("front, side, back")
  expect((await readReferences(second.directory, run.tasks[0]!.asset_id)).map((reference) => [reference.kind, reference.name])).toEqual([["concept", "正面 · 侧面 · 背面"]])
  expect(again.sent[0]!.images).toEqual([])
  expect(again.sent[1]!.images).toEqual([PIXEL])
  expect(again.sent[2]!.input.pictures.at(-1)).toBe(REFERENCE_SHEET_NAME)

  // A connection known to have no image endpoint is not asked at all, and the thing is made as before.
  const unable = await bench({ look: renderer().look, ai: provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}) }).ai, draws: async (request) => (prompts.push(request.prompt), JPEG), canDraw: () => false })
  const skipped = prompts.length
  const unmade = await terminal(unable.runner, unable.created.id, (await unable.runner.start({ projectId: unable.created.id, expectedRevision: unable.created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(unmade.state).toBe("completed")
  expect(prompts).toHaveLength(skipped)
  expect(await readReferences(unable.directory, unmade.tasks[0]!.asset_id)).toEqual([])

  // A connection that draws nothing, or fails, changes nothing: the thing is made as before.
  const third = await bench({ look: renderer().look, ai: provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}) }).ai, draws: async () => Promise.reject(new Error("no image endpoint")) })
  const plain = await terminal(third.runner, third.created.id, (await third.runner.start({ projectId: third.created.id, expectedRevision: third.created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(plain.state).toBe("completed")
  expect(await readReferences(third.directory, plain.tasks[0]!.asset_id)).toEqual([])

  // The request itself: one POST to the provider's image endpoint; anything but a real picture back is "drew nothing".
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const transport = (reply: () => Response) => async (url: string, init: RequestInit) => (calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> }), reply())
  const signal = AbortSignal.timeout(5000)
  expect(await requestPicture({ baseUrl: "https://example.test/v1", apiKey: "key", prompt: "three views", signal, transport: transport(() => Response.json({ data: [{ b64_json: PIXEL.split(",")[1] }] })) })).toBe(PIXEL)
  expect(calls[0]).toEqual({ url: "https://example.test/v1/images/generations", body: { model: "gpt-image-1", prompt: "three views", n: 1, size: "1536x1024" } })
  expect(await requestPicture({ baseUrl: "https://example.test/v1", apiKey: "key", prompt: "x", signal, transport: transport(() => new Response("not found", { status: 404 })) })).toBeNull()
  forgetMissingPictureRoutes() // a 404 is remembered for the run; the cases below each stand alone
  expect(await requestPicture({ baseUrl: "https://example.test/v1", apiKey: "key", prompt: "x", signal, transport: transport(() => Response.json({ data: [{ b64_json: Buffer.from("<html>").toString("base64") }] })) })).toBeNull()
  expect(await requestPicture({ baseUrl: "https://example.test/v1", apiKey: "key", prompt: "x", signal, transport: async () => Promise.reject(new Error("offline")) })).toBeNull()
  expect(await requestPicture({ baseUrl: "https://example.test/v1", apiKey: "", prompt: "x", signal, transport: transport(() => Response.json({})) })).toBeNull()
  expect(calls).toHaveLength(3)
}, 30_000)

test("制作被中断：已经审查的草稿还要本人继续提交，重开只恢复草稿", async () => {
  const { created, directory, runner } = await bench({ look: renderer().look })
  const { model, creature, assetId } = await pair(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...model, sheet })
  await runner.lookExternalTask({ ...model, script: scriptOf("中断前看过的一版") })
  await runner.selfReviewExternalTask({ ...model, ...done })
  await runner.finalReviewExternalTask(model)
  // The reviewer passed it; the controller crashed before the hand-in and Studio was closed.
  await runner.finalReviewExternalTask({ ...model, verdict: { passed: true, findings: [], advice: ["神态可以再凶一点"], independent: true } })
  expect((await openProject(directory)).workspace.assets).toEqual([])

  // Studio starts again: a runner that knows nothing of the run finds it unfinished.
  const reopened = createProjectRunner({ directoryFor: async () => directory, ai: {}, look: renderer().look })
  closers.push(() => reopened.dispose())
  const [run] = await reopened.list(created.id)
  expect(run!.state).toBe("interrupted")
  const detail = "制作中断了。需要的话可以接着做。"
  expect(run!.tasks[0]).toMatchObject({ state: "blocked", detail })
  expect(run!.tasks[0]!.outcome).toBeUndefined()
  expect(run!.tasks[1]!.state).toBe("blocked")
  expect(run!.events.at(-1)?.message).toBe(detail)
  const project = await openProject(directory)
  expect(project.revision).toBe(created.revision)
  expect(project.workspace.assets).toEqual([])
  const record = (await readMaking(directory, assetId))!
  expect(record).toMatchObject({ review: { passed: true, advice: ["神态可以再凶一点"] } })
  expect((await reopened.getExternalProgress({ projectId: created.id, runId: model.runId })).drafts[model.taskId]?.draft).toEqual(named("中断前看过的一版"))
  expect(JSON.stringify([run, record])).not.toMatch(/没达标|没有达到标准|还不满意/)

  // Looking again keeps the interruption and the same project revision.
  const again = await reopened.list(created.id)
  expect(again[0]!.updated_at).toBe(run!.updated_at)
  expect(await reopened.get({ projectId: created.id, runId: model.runId })).toEqual(again[0]!)
  expect((await openProject(directory)).revision).toBe(project.revision)
  expect(creature.taskId).toBe(run!.tasks[1]!.id)
}, 30_000)

test("MCP 打开工程和恢复中断的制作进度都不改工程文件", async () => {
  const first = await planned(renderer().look)
  await first.call("lookExternalTask", { ...first.model, document: good })
  const { directory, project } = await first.service.openProject(first.projectId)
  const file = path.join(directory, "minemods.project.json")
  const saved = await readFile(file)
  const { mtimeMs } = await stat(file)
  const activity = path.join(directory, ".minemods", "activity.jsonl")
  const log = await readFile(activity)
  const reopened = await studio(renderer().look, first.root)
  for (const detail of ["summary", "full"]) {
    expect(await reopened.call("openProject", { projectId: first.projectId, detail })).toMatchObject({ project: { revision: project.revision } })
  }
  expect(await readFile(activity)).toEqual(log)
  expect(await reopened.call("getExternalProgress", { projectId: first.projectId, runId: first.runId })).toMatchObject({
    run: { state: "interrupted" }, drafts: { [first.model.taskId]: { draft: good } },
  })
  expect(await readFile(file)).toEqual(saved)
  expect((await stat(file)).mtimeMs).toBe(mtimeMs)
}, 30_000)

test("中断后重开：已经正式提交的模型可供依赖任务继续使用", async () => {
  const first = await planned(renderer().look)
  await first.call("lookExternalTask", { ...first.model, document: good })
  await first.call("selfReviewExternalTask", { ...first.model, ...done })
  await first.call("finalReviewExternalTask", first.model)
  await first.call("finalReviewExternalTask", { ...first.model, verdict: { passed: true, findings: [], independent: true } })
  await first.call("commitExternalTask", { ...first.model, document: good })
  const seen = async (opened: Awaited<ReturnType<typeof studio>>) => {
    const run = (await opened.call("getExternalRun", { projectId: first.projectId, runId: first.runId })) as { state: string; tasks: { key: string; state: string; detail: string; outcome?: string }[] }
    const plan = (await opened.call("getBlueprint", { projectId: first.projectId })) as { entries: { id: string; status: string; ai_interrupted?: boolean }[]; production: { failed: number; blocked: number } }
    return { run, plan }
  }
  const freed = "它要用的东西已经做好保存了，这一样没有被卡住，可以接着做。"
  const second = await studio(renderer().look, first.root)
  const reopened = await seen(second)
  expect(reopened.run.state).toBe("interrupted")
  expect(reopened.run.tasks.map((task) => [task.key, task.state, task.outcome])).toEqual([["guardian_model", "completed", undefined], ["guardian", "queued", undefined]])
  expect(reopened.run.tasks[1]!.detail).toBe(freed)
  expect(reopened.plan.entries.map((entry) => [entry.id, entry.status]).slice(0, 2)).toEqual([["guardian_model", "review"], ["guardian", "planned"]])
  expect(reopened.plan.production).toMatchObject({ failed: 0, blocked: 0 })
  const directory = path.join(first.root, "projects", (await readdir(path.join(first.root, "projects")))[0]!)
  expect((await readActivity(directory)).events.filter((event) => event.text === freed).map((event) => event.title)).toEqual(["洞穴守卫（生物）"])

  // A record as an earlier Studio left it: the model already rescued, the creature still marked as held up.
  const file = path.join(directory, ".minemods", "runs", `${first.runId}.json`)
  const record = JSON.parse(await readFile(file, "utf8")) as { tasks: { key: string; state: string; detail: string; finished_at: string | null }[] }
  await writeFile(file, JSON.stringify({ ...record, tasks: record.tasks.map((task) => (task.key === "guardian" ? { ...task, state: "blocked", detail: "进程中断，未继续执行。", finished_at: new Date().toISOString() } : task)) }))
  const third = await studio(renderer().look, first.root)
  expect((await seen(third)).run.tasks.map((task) => [task.key, task.state])).toEqual([["guardian_model", "completed"], ["guardian", "queued"]])
  // Said once, however often it is opened again.
  expect((await readActivity(directory)).events.filter((event) => event.text === freed)).toHaveLength(1)

  // Going on from the plan hands out exactly what is left: the creature, which can now be made.
  const next = (await third.call("nextBatch", { projectId: first.projectId })) as ExternalStartResult
  expect(next.tasks.map((value) => value.task.key)).toEqual(["guardian"])
}, 30_000)

test("制作被中断：硬伤只记中断，旧中断记录也保留私有草稿", async () => {
  // Nothing looked at, and a version with a hard fault: nothing to keep.
  const none = await bench({ look: renderer().look })
  const first = await claimed(none.runner, none.created.id, none.created.revision)
  await none.runner.describeExternalTask({ ...first.ids, sheet })
  await none.runner.lookExternalTask({ ...first.ids, document: weak })
  const reopened = createProjectRunner({ directoryFor: async () => none.directory, ai: {}, look: renderer().look })
  closers.push(() => reopened.dispose())
  const [run] = await reopened.list(none.created.id)
  expect(run).toMatchObject({ state: "interrupted", summary: "制作中断了。工程仍使用已提交的版本。" })
  expect(run!.tasks[0]).toMatchObject({ state: "blocked", detail: "制作中断了。需要的话可以接着做。" })
  expect(run!.tasks[0]!.outcome).toBeUndefined()
  expect((await openProject(none.directory)).workspace.assets).toEqual([])
  expect((await readMaking(none.directory, first.assetId))!.outcome).toBeUndefined()

  // A run a Studio from before the rescue had already marked interrupted: its best version still lies beside the record.
  const old = await bench({ look: renderer().look })
  const held = await claimed(old.runner, old.created.id, old.created.revision)
  await old.runner.describeExternalTask({ ...held.ids, sheet })
  await old.runner.lookExternalTask({ ...held.ids, document: named("旧版本留下的最好一版") })
  const blind = createProjectRunner({ directoryFor: async () => old.directory, ai: {} })
  closers.push(() => blind.dispose())
  // Without a renderer the loop is off, which is how the old Studio behaved: marked interrupted, nothing kept.
  expect((await blind.list(old.created.id))[0]).toMatchObject({ state: "interrupted", tasks: [{ state: "blocked" }] })
  expect((await openProject(old.directory)).workspace.assets).toEqual([])
  const now = createProjectRunner({ directoryFor: async () => old.directory, ai: {}, look: renderer().look })
  closers.push(() => now.dispose())
  const [recovered] = await now.list(old.created.id)
  expect(recovered).toMatchObject({ state: "interrupted", tasks: [{ state: "blocked" }] })
  expect((await openProject(old.directory)).workspace.assets).toEqual([])
  expect(recovered!.tasks[0]?.outcome).toBeUndefined()
  expect((await now.getExternalProgress({ projectId: old.created.id, runId: held.ids.runId })).drafts[held.ids.taskId]?.draft).toEqual(named("旧版本留下的最好一版"))

  // Something the person changed after the run began is never overwritten by a rescue.
  const edited = await bench({ look: renderer().look })
  const mine = await claimed(edited.runner, edited.created.id, edited.created.revision)
  await edited.runner.describeExternalTask({ ...mine.ids, sheet })
  await edited.runner.lookExternalTask({ ...mine.ids, document: named("AI 的一版") })
  await edited.runner.selfReviewExternalTask({ ...mine.ids, ...done })
  await edited.runner.finalReviewExternalTask(mine.ids)
  await edited.runner.finalReviewExternalTask({ ...mine.ids, verdict: { passed: true, findings: [], independent: true } })
  await edited.runner.commitExternalTask({ ...mine.ids, document: named("AI 的一版") })
  const later = createProjectRunner({ directoryFor: async () => edited.directory, ai: {}, look: renderer().look })
  closers.push(() => later.dispose())
  expect((await later.list(edited.created.id))[0]!.tasks[0]).toMatchObject({ state: "completed" })
  expect((await later.list(edited.created.id))[0]!.tasks[0]!.outcome).toBeUndefined()
  expect((await openProject(edited.directory)).workspace.assets).toHaveLength(1)
}, 30_000)

// 10-07, internalising what only the outside path could do: Studio's own AI is driven through the same loop, and these are the places its driver used to give up.
test("Studio 自己的 AI：量出来的事实本来就该这样，就在自评里写进部件说明（declare），同一版照新的说明核对，不用白改一版", async () => {
  const hidden = renderer()
  // The same creature with its idle turned down to a tenth: nothing in it travels far enough to be seen.
  const faint = { ...good, animations: good.animations.map((animation) => (animation.name === "idle" ? { ...animation, channels: animation.channels.map((channel) => ({ ...channel, keyframes: channel.keyframes.map((frame) => ({ ...frame, rotation: frame.rotation.map((value) => value * 0.1) as [number, number, number] })) })) } : animation)) }
  const still = [{ motion: "idle", reason: "它是一块石头，站着就该一动不动" }]
  const fake = provider({ make: () => faint, self: () => ({ ...guided({ ...done, advice: [] }), declare: { still, justified: [], differs: [] } }), review: () => answer({}) })
  const { created, directory, runner } = await bench({ look: hidden.look, ai: fake.ai })
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "一块会呼吸的石头", module: "model" })).id)
  expect(run.state).toBe("completed")
  // One version: the finding was answered in the sheet, not by changing the thing.
  expect(fake.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self", "review"])
  expect(fake.sent[2]!.input.findings).toEqual([expect.stringMatching(/^不机械：待机（idle）看不出来在动/)])
  const record = (await readMaking(directory, (await openProject(directory)).workspace.assets[0]!.id))!
  expect(record).toMatchObject({ state: "done", outcome: "passed", sheet: { still }, rounds: [{ round: 1, self_review: { verdict: "done" } }] })
  // The reviewer is given the sheet as it now reads, reason and all.
  expect(fake.sent[3]!.input.part_sheet.still).toEqual(still)
  // The maker's instructions carry the whole discipline with every version, the gate included.
  expect(fake.sent[1]!.instructions).toContain(MAKING_DISCIPLINE_OWN)
  expect(fake.sent[1]!.instructions).toContain("硬门槛：只能改掉，写理由不算")
})

// Owner's rule: a harness never burns a round, or a task, for nothing. Two ways the maker's own answer used to end the task by repeating nothing.
test("Studio 自己的 AI：自评里写的 declare 被部件说明的规则拒绝了，原话告诉制作者；它原样再交一遍同一份文档，是再声明一次的机会，不算一版也不结束任务", async () => {
  const hidden = renderer()
  const faint = { ...good, animations: good.animations.map((animation) => (animation.name === "idle" ? { ...animation, channels: animation.channels.map((channel) => ({ ...channel, keyframes: channel.keyframes.map((frame) => ({ ...frame, rotation: frame.rotation.map((value) => value * 0.1) as [number, number, number] })) })) } : animation)) }
  const still = [{ motion: "idle", reason: "它是一块石头，站着就该一动不动" }]
  const at = { directory: "" }
  const sheetless = async (wanted: boolean) => changeMaking(at.directory, (await listMakings(at.directory))[0]!.asset_id, (record) => ({ ...record!, sheetless: wanted || undefined }))
  const fake = provider({
    make: () => faint,
    self: async (round) => {
      // The first declare meets a sheet that refuses to be written (the loop's own refusal, in its own words); the second one is taken.
      await sheetless(round === 1)
      return { ...guided({ ...done, advice: [] }), declare: { still, justified: [], differs: [] } }
    },
    review: () => answer({}),
  })
  const { created, directory, runner } = await bench({ look: hidden.look, ai: fake.ai })
  at.directory = directory
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "一块会呼吸的石头", module: "model" })).id)
  expect(run.state).toBe("completed")
  expect(fake.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self", "make", "self", "review"])
  // Told, in the refusal's own words, with the findings of the next version (and as what it is to do next), not dropped.
  const told = fake.sent[3]!.input.revision_required
  expect(told.findings).toHaveLength(2)
  expect(told.findings[0]).toMatch(/^不机械：待机（idle）看不出来在动/)
  expect(told.findings[1]).toContain("你在自评里写的 declare")
  expect(told.findings[1]).toContain(ownWords(REFUSALS.no_sheet_wanted))
  expect(told.self_review.next).toEqual(told.findings)
  // Handed in again unchanged: not "unchanged" (final), and not a version; it is looked at as the same round and declared again.
  const record = (await readMaking(directory, (await openProject(directory)).workspace.assets[0]!.id))!
  expect(record).toMatchObject({ state: "done", outcome: "passed", sheet: { still }, rounds: [{ round: 1, self_review: { verdict: "done" } }] })
  expect(record.rounds).toHaveLength(1)
}, 30_000)

test("Studio 自己的 AI：部件说明的答案在这一版看过以后变了，同一份文档再交一遍是照新的说明重新核对，不是原样重交：不算一版，也不结束任务", async () => {
  const hidden = renderer()
  const faint = { ...good, animations: good.animations.map((animation) => (animation.name === "idle" ? { ...animation, channels: animation.channels.map((channel) => ({ ...channel, keyframes: channel.keyframes.map((frame) => ({ ...frame, rotation: frame.rotation.map((value) => value * 0.1) as [number, number, number] })) })) } : animation)) }
  const still = [{ motion: "idle", reason: "它是一块石头，站着就该一动不动" }]
  const at = { directory: "" }
  const fake = provider({
    make: async (round) => {
      // The sheet is answered between the two versions (the person's own edit of it, or a declare whose re-look failed): the document the maker hands in is the same one.
      if (round === 2) {
        const record = (await listMakings(at.directory))[0]!
        await changeMaking(at.directory, record.asset_id, (latest) => describeSheet(latest!, { ...latest!.sheet!, still }))
      }
      return faint
    },
    self: (round) => guided({ ...(round === 1 ? revise : done), advice: [] }),
    review: () => answer({}),
  })
  const { created, directory, runner } = await bench({ look: hidden.look, ai: fake.ai })
  at.directory = directory
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "一块会呼吸的石头", module: "model" })).id)
  expect(run.state).toBe("completed")
  expect(fake.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self", "make", "self", "review"])
  // The second look judged the same document against the new sheet: nothing is left to answer.
  expect(fake.sent[2]!.input.findings).toEqual([expect.stringMatching(/^不机械：待机（idle）看不出来在动/)])
  expect(fake.sent[4]!.input.findings).toEqual([])
  const record = (await readMaking(directory, (await openProject(directory)).workspace.assets[0]!.id))!
  expect(record.rounds).toHaveLength(1)
  expect(record).toMatchObject({ state: "done", outcome: "passed", sheet: { still } })
  // Without a change of the sheet it is still the failure it was: the same document again is not a new version.
  const stubborn = provider({ make: () => weak, self: () => guided({ ...revise, advice: [] }), review: () => answer({}) })
  const again = await bench({ look: hidden.look, ai: stubborn.ai })
  const failed = await terminal(again.runner, again.created.id, (await again.runner.start({ projectId: again.created.id, expectedRevision: again.created.revision, prompt: "一块会呼吸的石头", module: "model" })).id)
  expect(failed.tasks[0]!.error).toBe(REFUSALS.unchanged)
}, 30_000)

test("Studio 自己的 AI：看图被退回不算一版也不结束任务——画不出来就再画一次，能改的原因交还给制作者改", async () => {
  // The first picture cannot be drawn; drawn again, it can.
  const drawn = { count: 0 }
  const hidden = renderer((job) => (drawn.count++ === 0 ? { ok: false, reason: "画的时候超时了。" } : { ok: true, pictures: job.sheets.map((value) => ({ label: value.label, url: PIXEL })) }))
  // The first answer asks for a higher tier than its sheet declares: the look refuses it before anything is drawn. Told why, the maker answers again.
  const fake = provider({ make: (round) => (round === 1 ? { ...named("越档"), budget: "fine" } : named("第 1 版")), self: () => guided({ ...done, advice: [] }), review: () => answer({}) })
  const { created, directory, runner } = await bench({ look: hidden.look, ai: fake.ai })
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(run.state).toBe("completed")
  expect(fake.sent.map((call) => call.kind)).toEqual(["sheet", "make", "make", "self", "review"])
  expect(fake.sent[2]!.input.look_refused).toBe(BUDGET_REFUSALS.undeclared("fine"))
  // Still the first version: neither the refused answer nor the picture that failed used one up.
  expect(fake.sent[2]!.input.making).toMatchObject({ round: 1 })
  const asset = (await openProject(directory)).workspace.assets[0]!
  expect(asset.document).toMatchObject({ name: "第 1 版" })
  expect((await readMaking(directory, asset.id))!.rounds).toHaveLength(1)
})

test("Studio 自己的 AI：模型服务一时忙（503），制作循环里的请求会再试，不会因此把这样东西判成做不成", async () => {
  const hidden = renderer()
  // The third request (the self-review) is answered 503 once.
  const fake = provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}), busy: (request) => request === 2 })
  const { created, directory, runner } = await bench({ look: hidden.look, ai: { ...fake.ai, retryWait: [0, 0] } })
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(run.state).toBe("completed")
  expect(fake.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self", "review"])
  expect((await readMaking(directory, (await openProject(directory)).workspace.assets[0]!.id))!).toMatchObject({ state: "done", outcome: "passed" })
})

// 「审查」(10-07, the owner's decision): a switch the person throws. On, a reviewer of its own reads every thing made; off, the maker's own review is the last word and is recorded as that.
test("审查开关，API 连接：开着就另请一位评审（可以单独指定模型）；关掉就不另请，记录里写明是它自己验收", async () => {
  // On, with a model named for the reviewer: the review request, and only that one, goes to it.
  const named_reviewer = provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}) })
  const on = await bench({ look: renderer().look, ai: { ...named_reviewer.ai, moduleModel: "maker-model", reviewModel: "reviewer-model" } })
  expect((await terminal(on.runner, on.created.id, (await on.runner.start({ projectId: on.created.id, expectedRevision: on.created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)).state).toBe("completed")
  expect(named_reviewer.sent.map((call) => [call.kind, call.model])).toEqual([["sheet", "maker-model"], ["make", "maker-model"], ["self", "maker-model"], ["review", "reviewer-model"]])
  expect((await readMaking(on.directory, (await openProject(on.directory)).workspace.assets[0]!.id))!.review).toMatchObject({ passed: true, independent: true })

  // Off: no review request at all; the maker's own advice is kept, and the record says nobody else read it.
  const alone = provider({ self: () => guided({ ...done, advice: ["呼吸的起伏太不明显"] }), review: () => answer({ findings: ["不该有人来问我"] }) })
  const off = await bench({ look: renderer().look, ai: { ...alone.ai, review: false } })
  expect((await terminal(off.runner, off.created.id, (await off.runner.start({ projectId: off.created.id, expectedRevision: off.created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)).state).toBe("completed")
  expect(alone.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self"])
  const record = (await readMaking(off.directory, (await openProject(off.directory)).workspace.assets[0]!.id))!
  expect(record).toMatchObject({ state: "done", outcome: "passed", review: { passed: true, independent: false, findings: [], advice: ["呼吸的起伏太不明显"] } })
  // The words the person reads the switch by say what it costs and what is given up.
  expect(REVIEW_SWITCH).toMatchObject({ name: "审查" })
  expect(REVIEW_SWITCH.note).toContain("单独开的一次审查，会多用一些额度和时间")
  expect([REVIEW_SWITCH.maker_model, REVIEW_SWITCH.reviewer_model].every((line) => line.includes("GPT 6 / 6.1") && line.includes("Claude Opus 5.5"))).toBe(true)
})

test("审查开关，外部 AI：开着时是两个窗口——做的那个等结论，审的那个领下一样来看；关掉就和以前一样由做的那个自己安排", async () => {
  const hidden = renderer()
  const { created, directory, runner } = await bench({ look: hidden.look })
  const { ids, assetId } = await claimed(runner, created.id, created.revision)
  // Nothing is waiting before anything is called finished.
  expect(await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })).toEqual({ waiting: true, how: INSPECTION_WORDS.nothing })
  await runner.describeExternalTask({ ...ids, sheet })
  await runner.lookExternalTask({ ...ids, document: good })
  // The maker calls it finished: its next step is to wait for the other window, not to arrange a reviewer.
  expect(await runner.selfReviewExternalTask({ ...ids, ...done })).toMatchObject({ state: "reviewing", next_step: INSPECTION_WORDS.maker })
  expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toEqual({ waiting: true, how: INSPECTION_WORDS.pending })
  // The reviewer's window asks for the next thing: this version, with everything a reviewer is given.
  const handed = (await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })) as { waiting: boolean; task: typeof ids; title: string; instructions: string; input: { judging: string }; pictures: unknown[]; how: string }
  expect(handed).toMatchObject({ waiting: false, task: ids, instructions: REVIEWER_INSTRUCTIONS, how: INSPECTION_WORDS.reviewer })
  expect(handed.pictures).toHaveLength(REVIEW_SET.length)
  // The same version is not handed to a second reviewer while the first is at it.
  expect(await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })).toMatchObject({ waiting: true })
  // It concludes with the tool every reviewer uses; the maker's wait ends with that conclusion and what to do next.
  await runner.finalReviewExternalTask({ ...handed.task, verdict: { passed: true, findings: [], advice: ["表情还不够凶"], independent: true } })
  expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toMatchObject({ waiting: false, review: { passed: true, independent: true, advice: ["表情还不够凶"] }, next_step: expect.stringContaining("commit_task") })
  expect(await words(runner.commitExternalTask({ ...ids, document: good }))).toBe("accepted")
  expect((await readMaking(directory, assetId))!).toMatchObject({ state: "done", outcome: "passed", review: { independent: true } })

  // Off: one window, as before.
  const single = await bench({ look: renderer().look, ai: { review: false } })
  const held = await claimed(single.runner, single.created.id, single.created.revision)
  await single.runner.describeExternalTask({ ...held.ids, sheet })
  await single.runner.lookExternalTask({ ...held.ids, document: good })
  expect(((await single.runner.selfReviewExternalTask({ ...held.ids, ...done })) as { next_step: string }).next_step).toContain("用 final_review（不带 verdict）取验收材料")
  // A reviewing window that asks all the same is told the switch is off, and is handed nothing although a finished version is there.
  expect(await single.runner.nextInspection({ projectId: single.created.id, wait_seconds: 0 })).toEqual({ waiting: false, review_off: true, how: INSPECTION_WORDS.off })

  // The two hand-offs: the maker's sends reviews to the other window; the reviewer's is one loop and a list of what not to touch. Both name the models to use.
  const configuration = JSON.stringify({ mcpServers: { "minemods-studio": { command: "studio.exe", args: ["mcp-stdio.js"] } } })
  const maker = everythingToRead({ configuration, review: true })
  expect(maker).toContain("## 审查开着：验收不由你做")
  expect(maker).toContain("await_inspection")
  expect(maker).toContain(REVIEW_SWITCH.maker_model)
  // 10-12 epic: both windows are told the strongest model for an epic creature.
  expect(maker).toContain(REVIEW_SWITCH.epic_models)
  expect(buildMcpHandoff({ configuration })).not.toContain("审查开着")
  const reviewer = buildMcpReviewHandoff({ configuration, project: { id: created.id, name: "看着做", revision: 1 } })
  for (const phrase of ["next_inspection", "independent: true", REVIEW_SWITCH.reviewer_model, REVIEW_SWITCH.epic_models, created.id, "不领任务、不改任何东西、不提交、不打包", "studio.exe"]) expect(reviewer).toContain(phrase)
  // The reviewer's text is one loop and a list of what not to touch: shorter than even the start-up text of the maker, which is itself no longer than a page.
  expect(reviewer.length).toBeLessThan(buildMcpHandoff({ configuration, review: true }).length)
})

// A one-task batch whose only task has ended: the batch is over, so the next call is next_batch (a batch with tasks left says to claim them instead).
const BATCH_OVER = "接下来：这一批已经结束。调用 next_batch 看接下来做什么。"

// ---- 10-07 audit: what the two ways of working got wrong at their edges ----
test("API 连接出错：存下来给人看的原因是大白话，内部代码只留在高级里", async () => {
  // The provider is down for good: every try of the first request is answered 503.
  const down = provider({ self: () => guided(done), review: () => answer({}), busy: () => true })
  const worded = await bench({ look: renderer().look })
  const said = publicError(new ModelingError("UPSTREAM_UNAVAILABLE"))
  const runner = createProjectRunner({ directoryFor: async () => worded.directory, ai: { ...down.ai, retryWait: [0, 0] }, look: renderer().look, sees: async () => "yes", plain: publicError })
  closers.push(() => runner.dispose())
  const run = await terminal(runner, worded.created.id, (await runner.start({ projectId: worded.created.id, expectedRevision: worded.created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(run).toMatchObject({ state: "failed", error: said, tasks: [{ state: "failed", error: said }] })
  expect(run.events.at(-2)!.message).toBe(`模块任务失败：${said}`)
  expect(JSON.stringify(run)).not.toContain("UPSTREAM_UNAVAILABLE")
  const activity = (await readActivity(worded.directory)).events
  expect(activity.find((event) => event.mark === "fail" && event.end)).toMatchObject({ text: "这一样没做成。", lines: [said] })
  // The code is not lost: it is on a quiet event, where 高级 reads it.
  expect(activity.find((event) => event.detail === "UPSTREAM_UNAVAILABLE")).toMatchObject({ quiet: true, kind: "task" })

  // Routing fails the same way; and without the service's wording, what is stored is still a sentence, never the code.
  const bare = await bench({ look: renderer().look, ai: { ...down.ai, retryWait: [0, 0] } })
  const routed = await terminal(bare.runner, bare.created.id, (await bare.runner.start({ projectId: bare.created.id, expectedRevision: bare.created.revision, prompt: "一只守着矿石的敌对生物" })).id)
  expect(routed).toMatchObject({ state: "failed", error: UNSAID })
  expect(routed.events.at(-1)!.message).toBe(UNSAID)
  expect((await readActivity(bare.directory)).events.find((event) => event.detail === "UPSTREAM_UNAVAILABLE")).toMatchObject({ quiet: true, kind: "plan" })
  expect(UNSAID).toMatch(/[一-鿿]/)

  // A refusal of the loop is already the words to show and stays as it is.
  const same = provider({ make: () => named("一模一样"), self: () => guided({ ...revise, advice: [] }), review: () => answer({}) })
  const stuck = await bench({ look: renderer().look, ai: same.ai })
  const kept = await terminal(stuck.runner, stuck.created.id, (await stuck.runner.start({ projectId: stuck.created.id, expectedRevision: stuck.created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(kept.tasks[0]).toMatchObject({ state: "completed", outcome: "kept_unsatisfied" })
  expect((await readMaking(stuck.directory, kept.tasks[0]!.asset_id))!.kept_reason![0]).toBe(`停下的原因：${REFUSALS.unchanged}`)
})

test("Studio 自己的 AI：拆任务和不看图直接交的内容，模型服务一时忙（503）也会再试", async () => {
  const lore = { kind: "worldview", title: "矿洞", summary: "很久以前", entries: [{ title: "入口", body: "一道裂缝" }] }
  const route = { summary: "矿洞的来历", questions: [], tasks: [{ key: "lore", module: "worldview", title: "矿洞", prompt: "矿洞的来历", source: "矿洞的来历", dependencies: [], target_id: null }] }
  // The routing request and the document's own request are each answered 503 once.
  const fake = provider({ make: (count) => (count === 1 ? route : lore), self: () => guided(done), review: () => answer({}), busy: (request) => request === 0 || request === 2 })
  const { created, directory, runner } = await bench({ look: renderer().look, ai: { ...fake.ai, retryWait: [0, 0] } })
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "矿洞的来历" })).id)
  expect(run).toMatchObject({ state: "completed", tasks: [{ module: "worldview", state: "completed" }] })
  // Two answers, four requests: each of the two was asked twice.
  expect(fake.sent).toHaveLength(2)
  expect((await openProject(directory)).workspace.assets.map((asset) => asset.document)).toMatchObject([lore])
})

test("Studio 自己的 AI：验收用的图一时画不出来，就再画一次，不因此结束任务", async () => {
  // The look is drawn; the first try at the reviewer's set is not.
  const failed = { times: 0 }
  // The reviewer's set is the only job with more sheets than one look holds.
  const hidden = renderer((job) => (job.sheets.length > MAKING_LIMITS.sheets && failed.times++ === 0 ? { ok: false, reason: "画的时候超时了。" } : { ok: true, pictures: job.sheets.map((value) => ({ label: value.label, url: PIXEL })) }))
  const fake = provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}) })
  const { created, directory, runner } = await bench({ look: hidden.look, ai: fake.ai })
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(run.state).toBe("completed")
  expect(fake.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self", "review"])
  expect(failed.times).toBe(2)
  expect((await readMaking(directory, (await openProject(directory)).workspace.assets[0]!.id))!).toMatchObject({ state: "done", outcome: "passed", rounds: [{ round: 1 }] })
})

test("两个窗口，最后一版没通过审查：审查的窗口只被告知结论已记下、去领下一样；做的窗口被告知版数用完、留下了哪一版、接着做下一批", async () => {
  const { created, directory, runner } = await bench({ look: renderer().look })
  const { ids, assetId } = await claimed(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...ids, sheet })
  for (const round of Array.from({ length: MAKING_LIMITS.rounds }, (_, index) => index + 1)) {
    await runner.lookExternalTask({ ...ids, document: named(`第 ${round} 版`) })
    await runner.selfReviewExternalTask({ ...ids, ...(round < MAKING_LIMITS.rounds ? revise : done) })
  }
  const handed = (await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })) as unknown as { task: typeof ids }
  expect(handed.task).toEqual(ids)
  // The verdict is recorded and nothing is thrown at the reviewer; above all it is not sent to the maker's next batch.
  const verdict = (await runner.finalReviewExternalTask({ ...handed.task, verdict: { passed: false, findings: ["背上的叶子只有一片"], independent: true } })) as { review: { passed: boolean }; next_step: string }
  expect(verdict).toMatchObject({ review: { passed: false }, next_step: INSPECTION_WORDS.recorded })
  expect(INSPECTION_WORDS.recorded).toContain("next_inspection")
  expect(INSPECTION_WORDS.recorded).toContain("不要调用 next_batch")
  const finished = await runner.get({ projectId: created.id, runId: ids.runId })
  const kept = (await readMaking(directory, assetId))!
  expect(finished.tasks[0]).toMatchObject({ state: "completed", outcome: "kept_unsatisfied" })
  expect(kept).toMatchObject({ state: "done", outcome: "kept_unsatisfied", kept_round: MAKING_LIMITS.rounds })
  // Pause the saved state between recording the rejection and deciding which version can be kept.
  const runFile = path.join(directory, ".minemods", "runs", `${finished.id}.json`)
  await changeMaking(directory, assetId, () => ({ ...kept, state: "stopped", outcome: undefined, kept_round: undefined, kept_reason: undefined }))
  await writeFile(runFile, JSON.stringify({ ...finished, state: "running", tasks: finished.tasks.map((task) => ({ ...task, state: "running", outcome: undefined, finished_at: null })) }))
  try {
    expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toMatchObject({ waiting: true })
  } finally {
    await writeFile(runFile, JSON.stringify(finished))
    await changeMaking(directory, assetId, () => kept)
  }
  // The maker's wait ends with how the task ended, in words it can act on; asked again, the same.
  const ended = `${REFUSALS.out_of_rounds(MAKING_LIMITS.rounds)}${REFUSALS.kept(MAKING_LIMITS.rounds)}${BATCH_OVER}`
  for (const _ of [1, 2]) expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toMatchObject({ waiting: false, state: "done", rounds_left: 0, review: { passed: false, findings: ["背上的叶子只有一片"] }, next_step: ended })
  expect(ended).toContain(UNSATISFIED.mark)
  expect(ended).toContain("next_batch")
  expect(ended).not.toContain("还可以看")
  // The next thing a reviewer asks for is the next thing, not this one again.
  expect(await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })).toEqual({ waiting: true, how: INSPECTION_WORDS.nothing })
}, 120_000)

// B18-J-01: a review is void the moment the sheet it was a review of is rewritten, and so is the lock that kept the version from a second reviewer. The lock is by task and drawing, and the drawing is the same.
test("两个窗口：交给审查的那一版，说明改了、旧审查失效以后，审查的那个窗口下一次就拿到现在这一版，不用等十分钟", async () => {
  const { created, directory, runner } = await bench({ look: renderer().look })
  const { ids, assetId } = await claimed(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...ids, sheet })
  await runner.lookExternalTask({ ...ids, document: good })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  const first = (await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })) as unknown as { task: typeof ids }
  await runner.finalReviewExternalTask({ ...first.task, verdict: { passed: true, findings: [], independent: true } })
  expect((await readMaking(directory, assetId))!.review).toMatchObject({ passed: true })
  // The maker rewrites a part of the sheet after the pass: the same drawing, another sheet. The pass no longer counts and the commit says so.
  await runner.describeExternalTask({ ...ids, sheet: { ...sheet, recognisable: [...sheet.recognisable, "背后一圈浅色的纹路"] } })
  expect((await readMaking(directory, assetId))!.review).toBeNull()
  expect(await words(runner.commitExternalTask({ ...ids, document: good }))).toContain(REFUSALS.no_review)
  // The maker waits; the reviewer asks for the next thing and is given this version at once, with everything a reviewer gets.
  expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toEqual({ waiting: true, how: INSPECTION_WORDS.pending })
  const again = (await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })) as unknown as { waiting: boolean; task: typeof ids; how: string }
  expect(again).toMatchObject({ waiting: false, task: ids, how: INSPECTION_WORDS.reviewer })
  // The version just handed out is still held back from a second reviewer, as before.
  expect(await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })).toMatchObject({ waiting: true })
  await runner.finalReviewExternalTask({ ...again.task, verdict: { passed: true, findings: [], independent: true } })
  expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toMatchObject({ waiting: false, review: { passed: true }, next_step: expect.stringContaining("commit_task") })
  expect(await words(runner.commitExternalTask({ ...ids, document: good }))).toBe("accepted")
})

test("两个窗口：说明不是经过 save_sheet 改的（比如用户自己改了）旧审查同样失效，交出去的锁也跟着失效", async () => {
  const { created, directory, runner } = await bench({ look: renderer().look })
  const { ids, assetId } = await claimed(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...ids, sheet })
  await runner.lookExternalTask({ ...ids, document: good })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })
  // The sheet changes on disk by a path that does not go through the runner (the person's own edit), without the review being given a verdict.
  await changeMaking(directory, assetId, (record) => editSheet(record!, { ...record!.sheet!, subject: `${record!.sheet!.subject}（用户补了一句）` }))
  expect(await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })).toMatchObject({ waiting: false, task: ids })
})

test("两个窗口：交给审查的图没画出来，这一版不会被扣住，下一次照样交出来", async () => {
  const fail = { next: false }
  const hidden = renderer((job) => (fail.next ? ((fail.next = false), { ok: false, reason: "画的时候超时了。" }) : { ok: true, pictures: job.sheets.map((value) => ({ label: value.label, url: PIXEL })) }))
  const { created, runner } = await bench({ look: hidden.look })
  const { ids } = await claimed(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...ids, sheet })
  await runner.lookExternalTask({ ...ids, document: good })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  fail.next = true
  expect(await words(runner.nextInspection({ projectId: created.id, wait_seconds: 0 }))).toBe(REFUSALS.review_not_drawn("画的时候超时了。"))
  expect(await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })).toMatchObject({ waiting: false, task: ids, how: INSPECTION_WORDS.reviewer })
})

test("审查开着却只有一个窗口：做的那个等了几次都没有人来审，就被告知去跟用户说；不会自动通过，也不会让它自己审", async () => {
  const { created, directory, runner } = await bench({ look: renderer().look })
  const { ids, assetId } = await claimed(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...ids, sheet })
  await runner.lookExternalTask({ ...ids, document: good })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  for (const _ of Array.from({ length: INSPECTION_PATIENCE - 1 })) expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toEqual({ waiting: true, how: INSPECTION_WORDS.pending })
  expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toEqual({ waiting: true, no_reviewer: true, how: INSPECTION_WORDS.absent })
  for (const phrase of ["没有连着的审查窗口", "给审查的 AI", "把「审查」关掉", "接着调用 await_inspection", "不要自己调用 final_review"]) expect(INSPECTION_WORDS.absent).toContain(phrase)
  // Nothing was passed meanwhile.
  expect((await readMaking(directory, assetId))!).toMatchObject({ state: "reviewing", review: null })
  expect(await words(runner.commitExternalTask({ ...ids, document: good }))).toContain(REFUSALS.no_review)
  // A reviewing window turns up: from then on the maker is simply still waiting, and then gets its verdict.
  const handed = (await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })) as unknown as { task: typeof ids }
  expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toEqual({ waiting: true, how: INSPECTION_WORDS.pending })
  await runner.finalReviewExternalTask({ ...handed.task, verdict: { passed: true, findings: [], independent: true } })
  expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toMatchObject({ waiting: false, review: { passed: true }, next_step: expect.stringContaining("commit_task") })
})

// ---- broad16 first-time user: the reviewer never came, and the person saw nothing but the maker's chat ----
test("等审查员：一版做好了没有审查窗口来过，页面读得到「在等」、等了多久、该给哪两个出路；有窗口来领了就不再提", async () => {
  const { created, runner, directory } = await bench({ look: renderer().look })
  const { ids, assetId } = await claimed(runner, created.id, created.revision)
  // Nothing finished yet: nothing waits, so nothing is said.
  expect(await runner.reviewWait(directory)).toBeNull()
  await runner.describeExternalTask({ ...ids, sheet })
  await runner.lookExternalTask({ ...ids, document: good })
  expect(await runner.reviewWait(directory)).toBeNull()
  const before = Date.now()
  await runner.selfReviewExternalTask({ ...ids, ...done })
  // No reviewing window has ever asked: offered at once, since there is nothing to wait for.
  const wait = (await runner.reviewWait(directory))!
  expect(wait).toMatchObject({ reviewer: "never", offer: true, waiting: [{ asset_id: assetId, title: "洞穴守卫" }] })
  // `since` is when the maker called the version finished, not when the page looked.
  expect(Date.parse(wait.waiting[0]!.since)).toBeGreaterThanOrEqual(before - 5)
  expect(Date.parse(wait.waiting[0]!.since)).toBeLessThanOrEqual(Date.now())
  // The page reads the same thing from the overview, with the switch.
  const blueprints = createBlueprintService({ directoryFor: async () => directory, runner, connection: () => null, onRun: () => undefined })
  expect(await blueprints.overview({ projectId: created.id })).toMatchObject({ review_on: true, review_wait: { reviewer: "never", offer: true, waiting: [{ asset_id: assetId, title: "洞穴守卫" }] } })
  // A reviewing window turns up and is handed the version: it is at it, so nobody is offered to go without it.
  const handed = (await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })) as unknown as { task: typeof ids }
  expect(await runner.reviewWait(directory)).toMatchObject({ reviewer: "reading", offer: false })
  expect((await blueprints.overview({ projectId: created.id })).review_wait).toMatchObject({ reviewer: "reading", offer: false })
  await runner.finalReviewExternalTask({ ...handed.task, verdict: { passed: true, findings: [], independent: true } })
  // Concluded: nothing waits any more, and the overview does not carry the field at all.
  expect(await runner.reviewWait(directory)).toBeNull()
  expect(await blueprints.overview({ projectId: created.id })).not.toHaveProperty("review_wait")
  // The switch being on and a window being connected are told apart even with nothing waiting: this one asked just now.
  expect((await blueprints.overview({ projectId: created.id })).review_window).toBe("present")
})

test("审查打开了但审查员还没接上：没有东西在等的时候，总览也说得出审查员有没有来过", async () => {
  const { created, runner, directory } = await bench({ look: renderer().look })
  const blueprints = createBlueprintService({ directoryFor: async () => directory, runner, connection: () => null, onRun: () => undefined })
  expect(runner.reviewerPresence(directory)).toBe("never")
  expect(await blueprints.overview({ projectId: created.id })).toMatchObject({ review_on: true, review_window: "never" })
  await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })
  expect(runner.reviewerPresence(directory)).toBe("present")
  expect((await blueprints.overview({ projectId: created.id })).review_window).toBe("present")
  const real = Date.now
  try {
    Date.now = () => real() + (REVIEWER_SILENCE_SECONDS + 5) * 1000
    expect(runner.reviewerPresence(directory)).toBe("silent")
  } finally {
    Date.now = real
  }
})

test("等审查员：窗口来过但安静了超过它自己两次来问之间该有的时间，才又提出路；刚来过就只说它连着", async () => {
  const { created, runner, directory } = await bench({ look: renderer().look })
  const { ids } = await claimed(runner, created.id, created.revision)
  const real = Date.now
  const askedAt = real()
  try {
    // The reviewer asks once while nothing is finished (it waits for work), then the version is finished.
    Date.now = () => askedAt
    expect(await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })).toEqual({ waiting: true, how: INSPECTION_WORDS.nothing })
    Date.now = real
    await runner.describeExternalTask({ ...ids, sheet })
    await runner.lookExternalTask({ ...ids, document: good })
    await runner.selfReviewExternalTask({ ...ids, ...done })
    Date.now = () => askedAt
    expect(await runner.reviewWait(directory)).toMatchObject({ reviewer: "present", offer: false })
    // A bit less than the silence a reviewer may keep between two asks: still there.
    Date.now = () => askedAt + (REVIEWER_SILENCE_SECONDS - 5) * 1000
    expect(await runner.reviewWait(directory)).toMatchObject({ reviewer: "present", offer: false })
    Date.now = () => askedAt + (REVIEWER_SILENCE_SECONDS + 5) * 1000
    expect(await runner.reviewWait(directory)).toMatchObject({ reviewer: "silent", offer: true })
  } finally {
    Date.now = real
  }
  // The silence is as long as the maker waits before it is told nobody came: the page and the chat say the same thing at the same time.
  expect(REVIEWER_SILENCE_SECONDS).toBe(INSPECTION_PATIENCE * 40)
})

for (const legacy of [false, true]) {
  test((legacy ? "旧连接" : "新连接") + "默认值贯穿制作、自评、移交、等待与领取审查", async () => {
    const ai = legacy ? { mode: "mcp" as const } : { mode: "mcp" as const, reviewDefaults: "by-mode" as const }
    const { created, runner, directory } = await bench({ look: renderer().look, ai })
    const { ids } = await claimed(runner, created.id, created.revision)
    await runner.describeExternalTask({ ...ids, sheet })
    await runner.lookExternalTask({ ...ids, document: good })
    const self = await runner.selfReviewExternalTask({ ...ids, ...done })
    expect(runner.reviewOn()).toBe(legacy)
    expect(runner.reviewerPresence(directory)).toBe(legacy ? "never" : null)
    if (legacy) {
      expect(self).toMatchObject({next_step: INSPECTION_WORDS.maker})
      expect(await runner.reviewWait(directory)).toMatchObject({offer: true})
      for (let attempt = 0; attempt < INSPECTION_PATIENCE - 1; attempt++)
        expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toMatchObject({waiting: true})
      expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toMatchObject({no_reviewer: true})
      expect(await runner.nextInspection({projectId:created.id, wait_seconds:0})).toMatchObject({task:ids})
      expect(runner.reviewerPresence(directory)).toBe("present")
    } else {
      expect(await runner.reviewWait(directory)).toBeNull()
      expect(await runner.nextInspection({projectId:created.id, wait_seconds:0})).toMatchObject({review_off:true})
      expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toMatchObject({review_off:true})
      expect(await words(runner.finalReviewExternalTask({ ...ids, verdict: { passed:true, findings:[], independent:true } }))).toContain(SOLO_VOICE.independent)
    }
  }, 30000)
}

test("等审查员：审查关着的时候页面没有什么要等的，也没有出路要给", async () => {
  const { created, runner, directory } = await bench({ look: renderer().look, ai: { review: false } })
  const { ids } = await claimed(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...ids, sheet })
  await runner.lookExternalTask({ ...ids, document: good })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  expect(await runner.reviewWait(directory)).toBeNull()
  expect(runner.reviewOn()).toBe(false)
})

test("这次不另请审查：审查在做的 AI 等着的时候被关掉，它正在等的那一次就结束，被告知改为自己验收；记下的是它自己验收，不是独立评审", async () => {
  // The switch is the one the service flips: the runner reads it at every use.
  const ai: { review?: boolean } = {}
  const waiting = Promise.withResolvers<void>()
  const resume = Promise.withResolvers<void>()
  const { created, runner, directory } = await bench({
    look: renderer().look, ai,
    pauseInspection: () => { waiting.resolve(); return resume.promise },
  })
  const { ids, assetId } = await claimed(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...ids, sheet })
  await runner.lookExternalTask({ ...ids, document: good })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toEqual({ waiting: true, how: INSPECTION_WORDS.pending })
  expect(await runner.reviewWait(directory)).toMatchObject({ offer: true })
  // A wait that is under way when the person decides: it must end at once and not run out its forty seconds.
  const pending = runner.awaitInspection({ ...ids, wait_seconds: 30 })
  await Promise.race([waiting.promise, pending.then(() => { throw new Error("Inspection returned before the wait") })])
  const started = Date.now()
  ai.review = false
  resume.resolve()
  const told = (await pending) as { waiting: boolean; review_off: boolean; how: string }
  expect(Date.now() - started).toBeLessThan(5000)
  expect(told).toEqual({ waiting: false, review_off: true, how: INSPECTION_WORDS.turned_off })
  // The words tell it what to do and what not to claim.
  for (const phrase of ["final_review（不带 verdict）", "independent 写 false", "不要再调用 await_inspection", "我自己对着材料核对过"]) expect(INSPECTION_WORDS.turned_off).toContain(phrase)
  expect(await runner.reviewWait(directory)).toBeNull()
  // From here on the maker is where a maker is with the switch off: it takes the material, checks it itself, and says so.
  expect(await words(runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], independent: true } }))).toContain(SOLO_VOICE.independent)
  await runner.finalReviewExternalTask({ ...ids })
  await runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], independent: false } })
  expect(await words(runner.commitExternalTask({ ...ids, document: good }))).toBe("accepted")
  expect((await readMaking(directory, assetId))!).toMatchObject({ state: "done", outcome: "passed", review: { independent: false, passed: true } })
  // A reviewing window that asks all the same is told the switch is off.
  expect(await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })).toEqual({ waiting: false, review_off: true, how: INSPECTION_WORDS.off })
})

// ---- Round 18: 边做边看 for Studio's own AI. It wrote a whole version blind and saw it once; now it is shown what it wrote before that counts. ----
test("Studio 自己的 AI 边做边看：看了一眼改过的那一份，才是正式看、记下来的那一版；看一眼什么都不留下", async () => {
  const hidden = renderer()
  // Shown its first draft it revises once; shown the revision it keeps it.
  const fake = provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}), glance: (count) => (count === 1 ? { keep: false, revised: named("看了一眼改的") } : { keep: true, revised: null }) })
  const { created, directory, runner } = await bench({ look: hidden.look, ai: fake.ai })
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(run.state).toBe("completed")
  // One version was asked for and one was looked at; the two glances are not steps of the loop.
  expect(fake.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self", "review"])
  expect(fake.glances).toHaveLength(2)
  const [first, second] = fake.glances
  // The request after a glance: the maker's own instructions in its own voice with what a glance is, the draft, its pictures and what was measured.
  expect(first!.instructions).toContain(MAKING_DISCIPLINE_OWN)
  expect(first!.instructions).toEndWith(OWN_GLANCE_INSTRUCTIONS)
  expect(first!.input).toMatchObject({ part_sheet: { ...sheet, remark: null }, making: { round: 1 }, glance: { document: { name: "第 1 版" }, pictures: ["六个角度", "待机（idle） · 斜前方", "只看形状"], findings: [], left: MAKING_LIMITS.own_glances - 1 } })
  expect(first!.input.glance.motion_facts).toHaveLength(good.animations.length * 2)
  expect(first!.images).toEqual([PIXEL, PIXEL, PIXEL])
  // The second glance is of the revision, and is the last this version has.
  expect(second!.input.glance).toMatchObject({ document: { name: "看了一眼改的" }, left: 0 })
  // What counts is what it kept: the self-review, the review and the saved asset are all of the revision.
  const asset = (await openProject(directory)).workspace.assets[0]!
  expect(asset.document).toMatchObject({ kind: "model", name: "看了一眼改的" })
  const record = (await readMaking(directory, asset.id))!
  // Nothing of a glance is recorded: one round, with the pictures of the look that counted.
  expect(record).toMatchObject({ state: "done", outcome: "passed", rounds: [{ round: 1 }] })
  expect(record.rounds).toHaveLength(1)
  expect(record.rounds[0]!.pictures.map((picture) => picture.label)).toEqual(FIRST_SEEN)
  expect(record.rounds[0]!.fingerprint).toBe(record.review!.fingerprint)
  // The glances were drawn without the cell for the round's small picture being kept: every job is a look's job, and the first two came before the look that counted.
  expect(hidden.jobs.slice(0, 2).map((job) => job.sheets.map((value) => value.label))).toEqual([["六个角度", "待机（idle） · 斜前方", "只看形状", "封面"], ["六个角度", "待机（idle） · 斜前方", "只看形状", "封面"]])
  // The person reads what happened in plain words.
  expect(run.events.map((entry) => entry.message)).toEqual(expect.arrayContaining(["第 1 版：正在边做边看。", "第 1 版：边做边看了一眼，接着改。", "第 1 版：边做边看了一眼，就照这一份正式看。", "第 1 版：正在看渲染图。"]))
  expect(run.events.map((entry) => entry.message).join("\n")).not.toMatch(/glance|keep|revised/)
})

test("Studio 自己的 AI 边做边看：说留着就直接正式看；一版最多看两眼；看一眼画不出来就跳过，不耽误正式看", async () => {
  // Keeps what it wrote: one glance, then the look.
  const kept = provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}) })
  const plain = await bench({ look: renderer().look, ai: kept.ai })
  expect((await terminal(plain.runner, plain.created.id, (await plain.runner.start({ projectId: plain.created.id, expectedRevision: plain.created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)).state).toBe("completed")
  expect(kept.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self", "review"])
  expect(kept.glances).toHaveLength(1)
  expect((await openProject(plain.directory)).workspace.assets[0]!.document).toMatchObject({ name: "第 1 版" })

  // Never satisfied at a glance: it is shown its work as often as one version allows and no more; the last revision is what is looked at.
  const restless = provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}), glance: (count) => ({ keep: false, revised: named(`看了 ${count} 眼`) }) })
  const capped = await bench({ look: renderer().look, ai: restless.ai })
  expect((await terminal(capped.runner, capped.created.id, (await capped.runner.start({ projectId: capped.created.id, expectedRevision: capped.created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)).state).toBe("completed")
  expect(restless.glances).toHaveLength(MAKING_LIMITS.own_glances)
  expect(restless.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self", "review"])
  expect(restless.sent[2]!.input.round).toBe(1)
  const made = (await openProject(capped.directory)).workspace.assets[0]!
  expect(made.document).toMatchObject({ name: `看了 ${MAKING_LIMITS.own_glances} 眼` })
  expect((await readMaking(capped.directory, made.id))!.rounds).toHaveLength(1)

  // A revision handed back word for word is the version in hand: nothing new to glance at, so it is looked at as it is.
  const same = provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}), glance: () => ({ keep: false, revised: named("第 1 版") }) })
  const still = await bench({ look: renderer().look, ai: same.ai })
  expect((await terminal(still.runner, still.created.id, (await still.runner.start({ projectId: still.created.id, expectedRevision: still.created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)).state).toBe("completed")
  expect(same.glances).toHaveLength(1)

  // The glance cannot be drawn: no request is made for it, and the look that counts goes ahead.
  const failed = { times: 0 }
  const hidden = renderer((job) => (failed.times++ === 0 ? { ok: false, reason: "画的时候超时了。" } : { ok: true, pictures: job.sheets.map((value) => ({ label: value.label, url: PIXEL })) }))
  const unseen = provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}) })
  const dark = await bench({ look: hidden.look, ai: unseen.ai })
  const run = await terminal(dark.runner, dark.created.id, (await dark.runner.start({ projectId: dark.created.id, expectedRevision: dark.created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(run.state).toBe("completed")
  expect(unseen.glances).toHaveLength(0)
  expect(unseen.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self", "review"])
  expect(run.events.map((entry) => entry.message).join("\n")).not.toContain("画的时候超时了")
})

test("Studio 自己的 AI 自评时还想看的：点名要的补画在同一版里，再问它一次才算数；每个动作在一个任务里都轮得到", async () => {
  const hidden = renderer()
  // It asks to see the back large and one part close, at every self-review: only the first asking of a version is drawn.
  const asking = { see: [{ what: "angle", name: "back" }, { what: "close_up", name: "sprout" }] }
  const fake = provider({ self: (round) => ({ ...guided(round <= 2 ? { ...revise, advice: [] } : { ...done, advice: [] }), ...asking }), review: () => answer({}) })
  const { created, directory, runner } = await bench({ look: hidden.look, ai: fake.ai })
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  expect(run.state).toBe("completed")
  // Two self-review requests for each version, and they are one version: the first asks, the second is the one that stands.
  expect(fake.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self", "self", "make", "self", "self", "review"])
  const [, , asked, settledReview, , again] = fake.sent
  expect(asked!.input.pictures).toEqual(FIRST_SEEN)
  expect("seen_more" in asked!.input).toBe(false)
  const MORE = ["背面（大图）", "近看「sprout」"]
  expect(settledReview!.input).toMatchObject({ round: 1, pictures: [...FIRST_SEEN, ...MORE], seen_more: MORE, see_refused: [] })
  expect(settledReview!.images).toHaveLength(FIRST_SEEN.length + MORE.length)
  // The same round: what was drawn besides is kept with it (the first sheet and the newest of the rest), and no version was spent.
  const asset = (await openProject(directory)).workspace.assets[0]!
  const record = (await readMaking(directory, asset.id))!
  expect(record.rounds.map((round) => [round.round, round.self_review?.verdict])).toEqual([[1, "revise"], [2, "done"]])
  expect(record.rounds[0]!.pictures.map((picture) => picture.label)).toEqual(["六个角度", "只看形状", "走路（walk） · 斜前方", "受伤（hurt） · 斜前方", ...MORE])
  expect(run.events.map((entry) => entry.message)).toContain("第 1 版：自评时还想再看 2 样，正在补画。")
  // The second version changed nothing of the motions, and all were shown at the first: one comes round, the one shown longest ago; the others are named as not shown.
  expect(again!.input.pictures.slice(0, 3)).toEqual(["六个角度", "待机（idle） · 斜前方", "只看形状"])
  expect(again!.input.motions_not_shown).toEqual(["walk", "hurt"])
  expect("motions_not_shown" in asked!.input).toBe(false)

  // Something it asks for that does not exist is said back to it, not held against the version; with nothing new drawn it is not asked twice.
  const lost = provider({ self: () => ({ ...guided({ ...done, advice: [] }), see: [{ what: "close_up", name: "没有的部件" }] }), review: () => answer({}) })
  const other = await bench({ look: renderer().look, ai: lost.ai })
  expect((await terminal(other.runner, other.created.id, (await other.runner.start({ projectId: other.created.id, expectedRevision: other.created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)).state).toBe("completed")
  expect(lost.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self", "review"])
})

test("Studio 自己的 AI：动作多过一版给得下的，先给没看过的和改过的，下一版接着给剩下的；没有哪个动作一直看不到", async () => {
  // Five motions: two more than one version shows frame by frame.
  const busy = (name: string) => ({ ...good, name, animations: [...good.animations, ...["sway", "nod"].map((motion) => ({ ...good.animations[0]!, name: motion }))] })
  const fake = provider({ self: (round) => guided(round === 1 ? { ...revise, advice: [] } : { ...done, advice: [] }), review: () => answer({}), make: (round) => busy(`第 ${round} 版`) })
  const { created, runner } = await bench({ look: renderer().look, ai: fake.ai })
  expect((await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)).state).toBe("completed")
  const [first, second] = fake.sent.filter((call) => call.kind === "self")
  const strips = (call: (typeof fake.sent)[number]) => (call.input.pictures as string[]).filter((label) => label.includes("（") || label.includes(" · ")).filter((label) => label !== "六个角度" && label !== "只看形状")
  expect(strips(first!)).toHaveLength(MAKING_LIMITS.own_motions)
  expect(first!.input.motions_not_shown).toEqual(["sway", "nod"])
  // The next version: the two never shown are due and are what it is shown.
  expect(strips(second!).map((label) => label.split(" · ")[0])).toEqual(["「sway」", "「nod」"])
  expect(second!.input.motions_not_shown).toEqual(["idle", "walk", "hurt"])
})

// ---- Round 18: a refusal of the loop reaches Studio's own AI and the person without what it tells a tool-calling AI to do. ----
test("API 连接：图一直画不出来，交回给模型的话和留给人看的原因里都没有说给外部 AI 的那半句", async () => {
  const hidden = renderer(() => ({ ok: false, reason: "画的时候超时了。" }))
  const fake = provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}) })
  const { created, runner } = await bench({ look: hidden.look, ai: fake.ai })
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "一只守着矿石的敌对生物", module: "model" })).id)
  const core = "这一次没有看成：画的时候超时了。"
  expect(ownWords(REFUSALS.render_failed("画的时候超时了。"))).toBe(core)
  // The maker is handed the refusal a few times, each time as the plain half of it.
  const refused = fake.sent.filter((call) => call.kind === "make").flatMap((call) => (call.input.look_refused ? [call.input.look_refused] : []))
  expect(refused.length).toBeGreaterThan(0)
  expect(new Set(refused)).toEqual(new Set([core]))
  // No glance could be drawn, so none was asked about.
  expect(fake.glances).toHaveLength(0)
  // What the person reads on the task says what happened and nothing about calling anything.
  expect(run.tasks[0]).toMatchObject({ state: "failed", error: core })
  expect(JSON.stringify(run)).not.toContain(TOOL_VOICE.render_failed)
})

test("六视图：人给的按格子放、同一格就换掉，只给模型；外部 AI 领任务时知道有哪几格、只能照着做；看图和验收时六格和渲染图同序、排在参考图的最前面", async () => {
  const hidden = renderer()
  const { service, call } = await studio(hidden.look)
  const projectId = (await service.createProject({ name: "六视图", description: "", modId: "threeview", empty: true })).project.id
  await call("proposeBlueprint", { projectId, request: "一只守着矿石的敌对生物", blueprint: blueprint([{ key: "guardian_model", kind: "model" }, { key: "sticks", kind: "recipe" }]), paper_play: PAPER })
  await service.confirmBlueprint({ projectId, revision: 1 })
  const refused = (step: Promise<unknown>) => step.then(() => "", (error: unknown) => publicError(error))
  // Only a model is built from a 六视图; a thing that is not there has none; a picture is checked as any reference is.
  expect(await refused(service.addThreeView({ projectId, itemId: "sticks", view: "sheet", name: "a.png", url: PIXEL }))).toBe(REFERENCE_REFUSALS.not_a_model)
  expect(await refused(service.addThreeView({ projectId, itemId: "nothing", view: "sheet", name: "a.png", url: PIXEL }))).toBe(THREE_VIEW_DRAWING.gone)
  expect(await refused(service.addThreeView({ projectId, itemId: "guardian_model", view: "front", name: "a.svg", url: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}` }))).toBe(REFERENCE_REFUSALS.not_a_picture)
  // Put in before anything is made, by slot, and listed sheet, front, back, left, right, top, quarter before the person's other pictures.
  await service.addReference({ projectId, itemId: "guardian_model", name: "草图.png", url: PIXEL })
  await service.addThreeView({ projectId, itemId: "guardian_model", view: "back", name: "背面.png", url: PIXEL })
  const views = await service.addThreeView({ projectId, itemId: "guardian_model", view: "front", name: "正面.jpg", url: JPEG })
  expect(views.map((reference) => [reference.kind, reference.view, reference.by, reference.url])).toEqual([["three_view", "front", "person", JPEG], ["three_view", "back", "person", PIXEL], ["user", undefined, undefined, PIXEL]])
  // A whole sheet takes the place of the separate views, and a single view takes the place of the sheet.
  const whole = await service.addThreeView({ projectId, itemId: "guardian_model", view: "sheet", name: "六视图.png", url: PIXEL })
  expect(whole.map((reference) => [reference.kind, reference.view ?? null])).toEqual([["three_view", "sheet"], ["user", null]])
  expect((await service.addThreeView({ projectId, itemId: "guardian_model", view: "quarter", name: "斜前方.png", url: PIXEL })).map((reference) => [reference.kind, reference.view ?? null])).toEqual([["three_view", "quarter"], ["user", null]])
  // Each of the six goes into its own slot; a "side" from an older caller is the left one.
  for (const view of ["top", "right", "side", "back", "front"] as const) await service.addThreeView({ projectId, itemId: "guardian_model", view, name: `${view}.png`, url: view === "front" ? JPEG : PIXEL })
  const six = await service.getReferences({ projectId, itemId: "guardian_model" })
  expect(six.map((reference) => [reference.view ?? null, reference.name])).toEqual([["front", "front.png"], ["back", "back.png"], ["left", "side.png"], ["right", "right.png"], ["top", "top.png"], ["quarter", "斜前方.png"], [null, "草图.png"]])
  expect(await service.addThreeView({ projectId, itemId: "guardian_model", view: "left", name: "左侧.png", url: PIXEL })).toHaveLength(REFERENCE_LIMITS.three_view + 1)

  const batch = (await call("nextBatch", { projectId })) as ExternalStartResult
  const model = { projectId, runId: batch.run.id, taskId: batch.tasks.find((value) => value.task.key === "guardian_model")!.task.id }
  const claim = (await call("claimExternalTask", model)) as ExternalTaskContext
  // The maker is told there is one, whose it is and what it holds; the rule is in the guide it reads.
  expect(claim.making).toMatchObject({
    three_view: { present: true, by: "person", views: ["front", "back", "left", "right", "top", "quarter"], missing: [], words: "这样东西的六视图六个方向都放了。" },
    references: [
      { kind: "three_view", name: "front.png", view: "front", by: "person" },
      { kind: "three_view", name: "back.png", view: "back", by: "person" },
      { kind: "three_view", name: "左侧.png", view: "left", by: "person" },
      { kind: "three_view", name: "right.png", view: "right", by: "person" },
      { kind: "three_view", name: "top.png", view: "top", by: "person" },
      { kind: "three_view", name: "斜前方.png", view: "quarter", by: "person" },
      { kind: "user", name: "草图.png" },
    ],
  })
  expect(claim.making!.reference_guide).toContain(THREE_VIEW_GUIDE)
  // While the thing is being made its 六视图 stays as it is.
  expect(await refused(service.addThreeView({ projectId, itemId: "guardian_model", view: "front", name: "a.png", url: PIXEL }))).toBe(THREE_VIEW_DRAWING.being_made)
  await call("describeExternalTask", { ...model, sheet })
  // Its own concept views come after the person's; none of its tools puts or replaces a 六视图.
  await call("conceptExternalTask", { ...model, views: [{ name: "构想", image: JPEG }] })
  expect((await readReferences((await service.listProjects()).find((entry) => entry.project.id === projectId)!.directory, "guardian_model")).map((reference) => reference.kind)).toEqual([...Array.from({ length: REFERENCE_LIMITS.three_view }, () => "three_view" as const), "user", "concept"])
  const looked = (await call("lookExternalTask", { ...model, document: good })) as { pictures: { label: string }[] }
  expect(looked.pictures.map((picture) => picture.label)).toEqual(["六个角度", REFERENCE_SHEET_NAME])
  // On the reference sheet the six views come first, three to a row in the order of the six-angle renders and named as they are, each
  // saying whose it is; then the person's first picture. The concept no longer fits.
  const referenced = hidden.jobs.at(-1)!.sheets[0]!
  expect(referenced.cells.map((cell) => cell.label)).toEqual(["六视图 · 正面（人给的）", "六视图 · 背面（人给的）", "六视图 · 它的左侧（人给的）", "六视图 · 它的右侧（人给的）", "六视图 · 从上往下（人给的）", "六视图 · 斜前方（人给的）", "人给的参考图 7 · 草图.png"])
  expect(referenced).toMatchObject({ columns: 3, cell: [MAKING_LIMITS.sheet[0] / 3, Math.floor(MAKING_LIMITS.sheet[1] / 3)] })
  expect(referenced.cells.slice(0, 6).map((cell) => cell.label.split(" · ")[1]!.split("（")[0])).toEqual(["正面", "背面", "它的左侧", "它的右侧", "从上往下", "斜前方"])
  expect(((await service.getMaking({ projectId, itemId: "guardian_model" })) as Making).references!.map((reference) => [reference.kind, reference.view ?? null])).toEqual([...(["front", "back", "left", "right", "top", "quarter"] as const).map((view) => ["three_view" as const, view]), ["user", null], ["concept", null]])
  await call("selfReviewExternalTask", { ...model, ...done })
  // The reviewer gets the same sheet beside the whole set, and is told that a clear mismatch with it is blocking.
  const packet = (await call("finalReviewExternalTask", model)) as unknown as { instructions: string; pictures: { label: string }[] }
  expect(packet.pictures.map((picture) => picture.label)).toEqual([...REVIEW_SET, REFERENCE_SHEET_NAME])
  expect(packet.instructions).toContain(THREE_VIEW_REVIEW_RULE)
  // The capability list and the hand-off say the same, and that it is the person's.
  const capabilities = getMcpCapabilities("medium") as unknown as { making: { references: { three_view: { guide: string; source: string }; limits: Record<string, number> } } }
  expect(capabilities.making.references.three_view).toMatchObject({ name: "六视图", guide: THREE_VIEW_GUIDE, review: THREE_VIEW_REVIEW_RULE, slots: ["sheet", "front", "back", "left", "right", "top", "quarter"], views: { front: "正面", back: "背面", left: "它的左侧", right: "它的右侧", top: "从上往下", quarter: "斜前方" }, source: "claim_task.making.three_view" })
  expect(capabilities.making.references.limits.three_view).toBe(REFERENCE_LIMITS.three_view)
  const handoff = everythingToRead({ configuration: JSON.stringify({ mcpServers: { "minemods-studio": { command: "node", args: ["mcp.js"] } } }) })
  expect(handoff).toContain(THREE_VIEW_GUIDE)
  expect(handoff).toContain("making.three_view.present")
  expect(handoff).toContain("views 是有哪几格：sheet 是一整张，front 是正面、back 是背面、left 是它的左侧、right 是它的右侧、top 是从上往下、quarter 是斜前方")
  expect(handoff).toContain("每张渲染图对同一个方向的那一格")
  expect(handoff).not.toContain("三视图")
}, 30_000)

test("六视图，让 AI 画：用连接里选的画图模型照这样东西自己的话画；画不出来说清楚、什么都不存；人给的在就不画；连接画不了图时事先说明", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-six-view-"))
  directories.push(root)
  const calls: { url: string; body: Record<string, unknown> }[] = []
  let reply = () => Response.json({ data: [{ b64_json: PIXEL.split(",")[1] }] })
  const service = await createStudioService({
    workspaceDirectory: path.join(root, "projects"),
    runtimeDirectory: path.join(root, "runtime"),
    templateDirectory: path.join(root, "templates"),
    // The blueprint is handed in over MCP; image requests are enabled only after switching to API mode.
    ai: { mode: "mcp", apiKey: "key", baseUrl: "https://images.example.test/v1", imageModel: "my-image-model" },
    look: renderer().look,
    pictureTransport: async (url, init) => (calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> }), reply()),
  })
  closers.push(() => service.dispose())
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  const refused = (step: Promise<unknown>) => step.then(() => "", (error: unknown) => publicError(error))
  expect(await service.threeViewDrawing()).toEqual({ mode: "mcp", can: false, model: null, why: null })
  const projectId = (await service.createProject({ name: "画六视图", description: "", modId: "drawn", empty: true })).project.id
  await call("proposeBlueprint", { projectId, request: "一只守着矿石的敌对生物", blueprint: blueprint([{ key: "guardian_model", kind: "model" }, { key: "sticks", kind: "recipe" }]), paper_play: PAPER })
  await service.confirmBlueprint({ projectId, revision: 1 })

  expect(await refused(service.drawThreeView({ projectId, itemId: "guardian_model" }))).toBe(THREE_VIEW_DRAWING.mcp)
  expect(calls).toHaveLength(0)
  const settings = { mode: "api" as const, model: "m", routerModel: "m", moduleModel: "m", transcriptionModel: "t" }
  await service.saveConnection({ ...settings, baseUrl: "https://images.example.test/v1", imageModel: "my-image-model" })
  expect(await service.threeViewDrawing()).toEqual({ mode: "api", can: true, model: "my-image-model", why: null })

  // Drawn from the thing's own words and the person's note, as one sheet, marked as drawn.
  const drawn = await service.drawThreeView({ projectId, itemId: "guardian_model", note: "正面再方一点" })
  expect(drawn.map((reference) => [reference.kind, reference.view, reference.by, reference.name, reference.url])).toEqual([["three_view", "sheet", "ai", THREE_VIEW_DRAWING.name, PIXEL]])
  expect(calls).toEqual([{ url: "https://images.example.test/v1/images/generations", body: { model: "my-image-model", prompt: threeViewPrompt({ title: "洞穴守卫", words: "做guardian_model", sheet: null, note: "正面再方一点" }), n: 1, size: "1536x1024" } }])
  expect(String(calls[0]!.body.prompt)).toContain("a grid of exactly six views of the same thing, three columns and two rows")
  expect((await service.getActivity({ projectId })).events.map((event) => event.text)).toContain(THREE_VIEW_DRAWING.drawn("洞穴守卫"))
  expect([THREE_VIEW_DRAWING.drawn("洞穴守卫"), THREE_VIEW_DRAWING.failed("洞穴守卫"), THREE_VIEW_DRAWING.name, THREE_VIEW_DRAWING.being_made]).toEqual(["画了「洞穴守卫」的六视图（AI 画的）。", "没画出「洞穴守卫」的六视图。", "AI 画的六视图", "AI 正在做这一样，等这一次做完再换六视图。"])
  // Drawn again: it takes the place of the earlier drawing.
  reply = () => Response.json({ data: [{ b64_json: JPEG.split(",")[1] }] })
  expect((await service.drawThreeView({ projectId, itemId: "guardian_model" })).map((reference) => [reference.by, reference.url])).toEqual([["ai", JPEG]])
  // Nothing back: plain words, nothing changed, and the log says it did not work.
  reply = () => new Response("no such model", { status: 404 })
  expect(await refused(service.drawThreeView({ projectId, itemId: "guardian_model" }))).toBe(THREE_VIEW_DRAWING.no_picture)
  expect((await service.getReferences({ projectId, itemId: "guardian_model" })).map((reference) => [reference.by, reference.url])).toEqual([["ai", JPEG]])
  expect((await service.getActivity({ projectId })).events.map((event) => event.text)).toContain(THREE_VIEW_DRAWING.failed("洞穴守卫"))
  // The endpoint said it does not exist: it is not asked again in this run, and the connection is said to be unable to draw.
  const missed = calls.length
  expect(await service.threeViewDrawing()).toEqual({ mode: "api", can: false, model: null, why: THREE_VIEW_DRAWING.no_route })
  expect(await refused(service.drawThreeView({ projectId, itemId: "guardian_model" }))).toBe(THREE_VIEW_DRAWING.no_route)
  expect(calls).toHaveLength(missed)
  // (what a restart does) the next lines go on with a connection that draws again.
  forgetMissingPictureRoutes()
  reply = () => Response.json({ data: [{ b64_json: JPEG.split(",")[1] }] })
  // Not a model: nothing is drawn.
  const asked = calls.length
  expect(await refused(service.drawThreeView({ projectId, itemId: "sticks" }))).toBe(REFERENCE_REFUSALS.not_a_model)
  // The person's own takes the place of the drawing, and is never replaced by one: refused before the endpoint is asked.
  expect((await service.addThreeView({ projectId, itemId: "guardian_model", view: "front", name: "我画的.png", url: PIXEL })).map((reference) => [reference.view, reference.by])).toEqual([["front", "person"]])
  expect(await refused(service.drawThreeView({ projectId, itemId: "guardian_model" }))).toBe(REFERENCE_REFUSALS.person_three_view)
  expect(calls).toHaveLength(asked)
  expect(await refused(service.drawThreeView({ projectId, itemId: "guardian_model", note: "长".repeat(501) }))).not.toBe("")

  // The image model is kept with the connection and read back; a route that answers text only, or no key, cannot draw, and says why beforehand.
  expect(await service.saveConnection({ ...settings, baseUrl: "https://chatgpt.com/backend-api/codex", apiKey: "key", imageModel: "other-image" })).toMatchObject({ imageModel: "other-image", hasApiKey: true })
  expect((await service.getConnection()).imageModel).toBe("other-image")
  expect(await service.threeViewDrawing()).toEqual({ mode: "api", can: false, model: null, why: THREE_VIEW_DRAWING.no_route })
  expect(await refused(service.drawThreeView({ projectId, itemId: "guardian_model" }))).toBe(THREE_VIEW_DRAWING.no_route)
  await service.saveConnection({ ...settings, baseUrl: "https://images.example.test/v1", clearApiKey: true })
  expect(await service.threeViewDrawing()).toEqual({ mode: "api", can: false, model: null, why: THREE_VIEW_DRAWING.no_key })
  expect(THREE_VIEW_DRAWING.no_key).toBe("要在 Studio 里画六视图，得在「连接」里接上一个能画图的接口（比如 gpt-image-1）。")
  expect(THREE_VIEW_DRAWING.no_route).toBe("现在连接的这条路线只能回答文字，画不了图。要在 Studio 里画六视图，得在「连接」里接上一个能画图的接口（比如 gpt-image-1）。")
  // Settings saved without one (as before the choice existed) draw with the default model.
  const plain = await service.saveConnection({ ...settings, baseUrl: "https://images.example.test/v1", apiKey: "key" })
  expect("imageModel" in plain).toBe(false)
  expect(await service.threeViewDrawing()).toEqual({ mode: "api", can: true, model: "gpt-image-1", why: null })
  expect(calls).toHaveLength(asked)
}, 30_000)

test("外部 AI 六视图：提示词只读且不需要 key；生成图自动归到当前模型，不能生图只记录原因，人工图与制作锁仍受保护", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-six-view-external-"))
  directories.push(root)
  const requests: string[] = []
  const options = {
    workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"),
    ai: { mode: "mcp" as const, review:true },
    look: renderer().look,
    pictureTransport: async (url: string) => (requests.push(url), Response.json({ data: [{ b64_json: PIXEL.split(",")[1] }] })),
  }
  const service = await createStudioService(options)
  closers.push(() => service.dispose())
  const created = await service.createProject({ name: "外部生图", description: "", modId: "external_views", empty: true })
  const projectId = created.project.id
  const itemId = "guardian_model"
  const plan = blueprint([{ key: itemId, kind: "model" }, { key: "other_model", kind: "model" }, { key: "sticks", kind: "recipe" }])
  plan.entries.find((entry) => entry.key === "other_model")!.title = "另一个模型"
  await dispatchExternal(service, { method: "proposeBlueprint", input: { projectId, request: "一只守着矿石的敌对生物", blueprint: plan, paper_play: PAPER } })
  await service.confirmBlueprint({ projectId, revision: 1 })
  const snapshot = async (folder: string): Promise<unknown[]> => Promise.all((await readdir(folder, { withFileTypes: true })).map(async (entry) => [entry.name, (await stat(path.join(folder, entry.name))).mtimeMs, entry.isDirectory() ? await snapshot(path.join(folder, entry.name)) : (await readFile(path.join(folder, entry.name))).toString("base64")]))
  const beforePrompt = await snapshot(created.directory)
  const prompt = await dispatchStudioRequest(service, { method: "getThreeViewPrompt", input: { projectId, itemId, note: "手臂短一些" } })
  expect(typeof prompt).toBe("string")
  for (const text of [projectId, itemId, "洞穴守卫", "做guardian_model", "手臂短一些", "finish_six_view", "unsupported", "不要开始建模", "不要用脚本", threeViewPrompt({ title: "洞穴守卫", words: "做guardian_model", note: "手臂短一些" })]) expect(String(prompt)).toContain(text)
  expect(String(prompt)).toContain("a grid of exactly six views of the same thing, three columns and two rows")
  expect(await dispatchExternal(service, { method: "getThreeViewPrompt", input: { projectId, itemId, note: "手臂短一些" } })).toBe(String(prompt))
  expect(await snapshot(created.directory)).toEqual(beforePrompt)
  expect(await service.threeViewDrawing()).toEqual({ mode: "mcp", can: false, model: null, why: null })
  await expect(service.drawThreeView({ projectId, itemId })).rejects.toThrow(THREE_VIEW_DRAWING.mcp)
  expect(requests).toEqual([])

  const generated = await dispatchExternal(service, { method: "finishThreeView", input: { projectId, itemId, result: { status: "generated", image: PIXEL, name: "守卫六视图" } } })
  expect(generated).toMatchObject({ status: "generated", references: [{ kind: "three_view", view: "sheet", by: "ai", name: "守卫六视图" }] })
  expect(JSON.stringify(generated)).not.toContain("data:image/")
  expect(JSON.stringify(generated)).not.toContain('"url"')
  expect(await service.getReferences({ projectId, itemId })).toMatchObject([{ kind: "three_view", view: "sheet", by: "ai", name: "守卫六视图", url: PIXEL }])
  expect(await service.getReferences({ projectId, itemId: "sticks" })).toEqual([])
  expect((await service.finishThreeView({ projectId, itemId, result: { status: "generated", image: JPEG } })).references).toMatchObject([{ by: "ai", url: JPEG }])
  expect((await service.getReferences({ projectId, itemId }))).toHaveLength(1)
  expect((await service.getActivity({ projectId })).events.filter((event) => event.tool === "finish_six_view" && event.mark === "ok" && event.end)).toHaveLength(2)
  await expect(service.finishThreeView({ projectId, itemId: "sticks", result: { status: "generated", image: PIXEL } })).rejects.toThrow(REFERENCE_REFUSALS.not_a_model)
  await expect(service.finishThreeView({ projectId, itemId: "gone", result: { status: "generated", image: PIXEL } })).rejects.toThrow(THREE_VIEW_DRAWING.gone)
  await expect(service.getThreeViewPrompt({ projectId, itemId: "sticks" })).rejects.toThrow(REFERENCE_REFUSALS.not_a_model)
  await expect(service.getThreeViewPrompt({ projectId, itemId: "gone" })).rejects.toThrow(THREE_VIEW_DRAWING.gone)
  await expect(service.getThreeViewPrompt({ projectId, itemId, note: "长".repeat(501) })).rejects.toThrow()
  for (const image of ["https://example.test/a.png", "C:\\tmp\\a.png", "data:image/png;base64,AA==", `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`, `data:image/png;base64,${Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64")}`])
    await expect(dispatchStudioRequest(service, { method: "finishThreeView", input: { projectId, itemId, result: { status: "generated", image } } })).rejects.toThrow()

  await service.addThreeView({ projectId, itemId, view: "front", name: "人工图", url: PIXEL })
  const person = await service.getReferences({ projectId, itemId })
  await expect(service.finishThreeView({ projectId, itemId, result: { status: "generated", image: JPEG } })).rejects.toThrow(REFERENCE_REFUSALS.person_three_view)
  const beforeUnsupported = await snapshot(created.directory)
  const unsupported = await dispatchExternal(service, { method: "finishThreeView", input: { projectId, itemId, result: { status: "unsupported", reason: "当前没有可调用的生图工具" } } })
  expect(unsupported).toEqual({ status: "unsupported", message: THREE_VIEW_DRAWING.unsupported, references: person.map((reference) => ({ id: reference.id, kind: reference.kind, name: reference.name, view: reference.view, by: reference.by })) })
  expect(JSON.stringify(unsupported)).not.toContain("data:image/")
  expect(JSON.stringify(unsupported)).not.toContain('"url"')
  expect(await service.getReferences({ projectId, itemId })).toEqual(person)
  // The unsupported outcome adds only its activity event; model files, references and their timestamps stay as they were.
  const withoutActivity = (snapshot: unknown[]) => JSON.stringify(snapshot).replace(/\["activity\.jsonl",\d+(?:\.\d+)?,"[^"]*"\],?/, "")
  expect(withoutActivity(await snapshot(created.directory))).toBe(withoutActivity(beforeUnsupported))
  expect((await service.getActivity({ projectId })).events.filter((event) => event.tool === "finish_six_view")).toMatchObject([
    { item: itemId, mark: "ok", end: true }, { item: itemId, mark: "ok", end: true }, { item: itemId, mark: "warn", end: true, lines: ["当前没有可调用的生图工具"] },
  ])

  const batch = await dispatchExternal(service, { method: "nextBatch", input: { projectId } }) as ExternalStartResult
  const model = { projectId, runId: batch.run.id, taskId: batch.tasks.find((value) => value.task.key === itemId)!.task.id }
  await dispatchExternal(service, { method: "claimExternalTask", input: model })
  await dispatchExternal(service, { method: "describeExternalTask", input: { ...model, sheet } })
  const live = await snapshot(created.directory)
  expect(await service.getThreeViewPrompt({ projectId, itemId })).toContain(threeViewPrompt({ title: "洞穴守卫", words: "做guardian_model", sheet }))
  const otherPrompt = await service.getThreeViewPrompt({ projectId, itemId: "other_model" })
  expect(otherPrompt).toContain("另一个模型")
  expect(otherPrompt).toContain("做other_model")
  expect(otherPrompt).not.toContain(sheet.subject)
  expect(await snapshot(created.directory)).toEqual(live)
  await expect(service.finishThreeView({ projectId, itemId, result: { status: "generated", image: PIXEL } })).rejects.toThrow(THREE_VIEW_DRAWING.being_made)
  await service.dispose()
  const restarted = await createStudioService(options)
  closers.push(() => restarted.dispose())
  const beforeRestartPrompt = await snapshot(created.directory)
  expect(await dispatchStudioRequest(restarted, { method: "getThreeViewPrompt", input: { projectId, itemId } })).toContain(sheet.subject)
  expect(await snapshot(created.directory)).toEqual(beforeRestartPrompt)
  expect(requests).toEqual([])
}, 30_000)

test("六视图，Studio 自己的 AI：有六视图（哪怕只有一格）就不画构想图（参考图那张没画出来也一样）；重做时构想图清掉，六视图留着", async () => {
  // The reference sheet cannot be drawn here, so nothing is attached to the requests: what stops the concept is the 六视图 itself.
  const hidden = renderer((job) => (job.sheets[0]?.label === REFERENCE_SHEET_NAME ? { ok: false, reason: "画不出来" } : { ok: true, pictures: job.sheets.map((value) => ({ label: value.label, url: PIXEL })) }))
  const fake = provider({ self: () => guided({ ...done, advice: [] }), review: () => answer({}) })
  const prompts: string[] = []
  const { created, directory, runner } = await bench({ look: hidden.look, ai: fake.ai, draws: async (request) => (prompts.push(request.prompt), JPEG) })
  const before = await claimed(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...before.ids, sheet })
  await runner.lookExternalTask({ ...before.ids, document: good })
  await runner.selfReviewExternalTask({ ...before.ids, ...done })
  await runner.finalReviewExternalTask(before.ids)
  await runner.finalReviewExternalTask({ ...before.ids, verdict: { passed: true, findings: [], independent: true } })
  await runner.commitExternalTask({ ...before.ids, document: good })
  // An earlier concept and one view of the person's 六视图: the redo clears the one and keeps the other.
  await runner.conceptExternalTask({ ...before.ids, views: [{ name: "构想", image: JPEG }] }).catch(() => null)
  await setThreeView(directory, before.assetId, { view: "top", by: "person", name: "从上往下.png", url: PIXEL })
  const redo = await runner.start({ projectId: created.id, expectedRevision: (await openProject(directory)).revision, prompt: "照着六视图重做", module: "model", assetId: before.assetId })
  expect((await terminal(runner, created.id, redo.id)).state).toBe("completed")
  expect(prompts).toEqual([])
  expect((await readReferences(directory, before.assetId)).map((reference) => [reference.kind, reference.view])).toEqual([["three_view", "top"]])
  // Its maker, its self-review and its reviewer are told the rule all the same.
  const [described, made, judged, reviewer] = fake.sent
  expect(described!.instructions).toContain("其中写着「六视图」的格子是人定下来的形状")
  expect(made!.instructions).toContain(THREE_VIEW_GUIDE)
  expect(judged!.instructions).toContain(THREE_VIEW_REVIEW_RULE)
  expect(reviewer!.instructions).toContain(THREE_VIEW_REVIEW_RULE)
}, 30_000)

// creature tier (10-12): what the tier a blueprint settled for a creature asks of its model's making.
test("生物档位：模型的任务说明里写明档位，部件说明的 budget 低于档位被退回并说明是蓝图要求的；精细和 Boss 的验收不因「简单」放宽", async () => {
  const { service, call } = await studio(renderer().look)
  const projectId = (await service.createProject({ name: "档位", description: "", modId: "tiers", empty: true })).project.id
  const tier = { level: "fine" as const, reason: "你说了『精细的大守卫』", by: "ai" as const }
  const entry = (key: string, kind: "model" | "entity", extra: Record<string, unknown> = {}) => ({ key, kind, title: key === "guardian" ? "洞穴守卫（生物）" : "洞穴守卫", brief: `做${key}`, owner: null, needs: [], out_of_scope: null, ...extra })
  await call("proposeBlueprint", {
    projectId,
    request: "一只精细的大守卫，简单点的也行",
    blueprint: played({ style: { palette: ["#3355aa"], shape: "方块感", naming: "中文名", world: "矿洞" }, entries: [entry("guardian_model", "model", { owner: "guardian" }), entry("guardian", "entity", { needs: ["guardian_model"], tier })], questions: [] }),
    paper_play: PAPER,
  })
  await service.confirmBlueprint({ projectId, revision: 1 })
  const batch = (await call("nextBatch", { projectId })) as ExternalStartResult
  const modelTask = batch.tasks.find((value) => value.task.key === "guardian_model")!.task
  const ids = { projectId, runId: batch.run.id, taskId: modelTask.id }
  // The task text carries the tier, the budget to write, and the first-version demand.
  expect(modelTask.prompt).toContain("这个生物在蓝图上定的档位，做出来都要兑现：")
  expect(modelTask.prompt).toContain('部件说明的 budget 至少写 "fine"')
  expect(modelTask.prompt).toContain("你说了『精细的大守卫』")
  expect(batch.tasks.find((value) => value.task.key === "guardian")!.task.prompt).toContain("档位：「精细」（fine）")
  // broad21: what the tier has to have is a list in the claimed task, for the creature and for its model, from the one table.
  expect(modelTask.prompt).toContain("这一档要有这些（做完照这张单子逐项对一遍，审查时也按它查）：")
  expect(modelTask.prompt).toContain("  · 必须有的动作：")
  expect(batch.tasks.find((value) => value.task.key === "guardian")!.task.prompt).toContain("  · 必须有的动作：")
  await call("claimExternalTask", ids)
  const said = (budget: unknown) => words(call("describeExternalTask", { ...ids, sheet: { ...sheet, budget } }))
  // Below the tier: refused before anything is recorded, and the words name the blueprint.
  const none = await said(null)
  expect(none).toContain("蓝图上把「洞穴守卫（生物）」定为「精细」档")
  expect(none).toContain("是蓝图上定的档位要求这样")
  expect(await said({ tier: "standard", reason: "不需要", at_once: 3 })).toContain('budget 至少要写 "fine"')
  expect(((await service.getMaking({ projectId, itemId: "guardian_model" })) as Making | null)?.sheet ?? null).toBeNull()
  // At or above the tier: the sheet is accepted.
  expect(await said({ tier: "fine", reason: "它很大，会被走近了看", at_once: 2 })).toBe("accepted")
  // broad5 w3: the tier's budget is answered on the sheet in the tier's words, so no look asks for it to be lowered.
  const kept = ((await service.getMaking({ projectId, itemId: "guardian_model" })) as Making | null)!.sheet!.justified ?? []
  expect(kept).toContainEqual({ what: "budget:unused", reason: expect.stringContaining("蓝图上把「洞穴守卫（生物）」定为「精细」档") })
})

// broad11: a "thunderbird boss" was a squat bird barely taller than the player and its reviewers had no tier criterion to fail it on.
test("生物档位：精细及以上的模型，独立评审拿到档位的要求和量出来的大小；标准和没有档位的评审拿到的和以前一样", async () => {
  const tiers: [string, { level: "standard" | "fine" | "boss"; reason: string; by: "ai" } | undefined][] = [
    ["boss", { level: "boss", reason: "你说了『最终 Boss』", by: "ai" }],
    ["standard", { level: "standard", reason: "没有特别说", by: "ai" }],
    ["none", undefined],
  ]
  const packets = new Map<string, { instructions: string; input: Record<string, unknown>; pictures: { label: string }[] }>()
  for (const [name, tier] of tiers) {
    const { service, call } = await studio(renderer().look)
    const projectId = (await service.createProject({ name: `评审档位 ${name}`, description: "", modId: `review${name}`, empty: true })).project.id
    const entry = (key: string, kind: "model" | "entity", extra: Record<string, unknown> = {}) => ({ key, kind, title: key === "guardian" ? "洞穴守卫（生物）" : "洞穴守卫", brief: `做${key}`, owner: null, needs: [], out_of_scope: null, ...extra })
    await call("proposeBlueprint", {
      projectId,
      request: "一只最终 Boss 的洞穴守卫",
      blueprint: played({ style: { palette: ["#3355aa"], shape: "方块感", naming: "中文名", world: "矿洞" }, entries: [entry("guardian_model", "model", { owner: "guardian" }), entry("guardian", "entity", { needs: ["guardian_model"], ...(tier ? { tier } : {}) })], questions: [] }),
      paper_play: PAPER,
    })
    await service.confirmBlueprint({ projectId, revision: 1 })
    const batch = (await call("nextBatch", { projectId })) as ExternalStartResult
    const ids = { projectId, runId: batch.run.id, taskId: batch.tasks.find((value) => value.task.key === "guardian_model")!.task.id }
    await call("claimExternalTask", ids)
    await call("describeExternalTask", { ...ids, sheet: { ...sheet, ...(name === "boss" ? { budget: { tier: "finest", reason: "它很大，整场战斗都盯着它", at_once: 1 } } : {}) } })
    await call("lookExternalTask", { ...ids, document: good })
    await call("selfReviewExternalTask", { ...ids, ...done })
    packets.set(name, (await call("finalReviewExternalTask", ids)) as never)
  }
  const boss = packets.get("boss")!
  const plain = packets.get("standard")!
  const none = packets.get("none")!
  // A Boss's reviewer is told the level, the creature, why, what the tier asks (the very sentence the maker got) and what the maker had to go by.
  expect(boss.input.tier).toEqual({ level: "boss", label: "Boss", creature: "洞穴守卫（生物）", reason: "你说了『最终 Boss』", detail: CREATURE_TIERS.boss.detail, views: expect.stringContaining("没有六视图，没有人给的参考图，制作者也没有自己画构想图") })
  expect(CREATURE_TIERS.boss.detail).toContain("体型要明显比玩家大")
  // The size next to the player is a measured sentence among the budget facts, from the model's own bounds.
  const facts = boss.input.budget_facts as string[]
  expect(facts.at(-1)).toBe(sizeNextToPlayer(good))
  expect(facts.at(-1)).toContain("玩家高 1.8 格、宽 0.6 格")
  expect(facts.length).toBeGreaterThan(1)
  // Standard and no tier at all: no tier field and no size sentence, the same fields as before.
  for (const packet of [plain, none]) {
    expect("tier" in packet.input).toBe(false)
    expect((packet.input.budget_facts as string[]).some((line) => line.startsWith("大小（量出来的事实）"))).toBe(false)
    expect(Object.keys(packet.input)).toEqual(["judging", "not_judged", "part_sheet", "criteria", "request", "motion_facts", "budget_facts"])
    expect(packet.instructions).toBe(REVIEWER_INSTRUCTIONS)
  }
  expect(Object.keys(boss.input)).toEqual(["judging", "not_judged", "part_sheet", "tier", "criteria", "request", "motion_facts", "budget_facts"])
  // The reviewers of every kind are told the rule; it makes a missing Boss weight a blocking finding.
  expect(boss.instructions).toBe(REVIEWER_INSTRUCTIONS)
  expect(REVIEWER_INSTRUCTIONS).toContain(TIER_REVIEW_RULE)
  expect(TIER_REVIEW_RULE).toContain(`没做到，是${FINDING_LABELS.blocking}，不是只写进 advice`)
  expect(TIER_REVIEW_RULE).toContain("不是明显大出一圈，就是没做到")
}, 60_000)

test("生物档位：精细和 Boss 的作品按完整标准验收，标准、简单和没有档位的照旧", () => {
  const run = { prompt: "做一只简单的守卫", model_complexity: null }
  const task = (key: string) => ({ prompt: "简单的低模守卫", source: `blueprint:${key}` })
  const entries = (level: "simple" | "standard" | "fine" | "boss" | null) => [
    { key: "g_model", kind: "model", title: "m", owner: "g" },
    { key: "g_skin", kind: "texture", title: "s", owner: "g" },
    { key: "g", kind: "entity", title: "g", owner: null, ...(level ? { tier: { level, reason: "r", by: "ai" as const } } : {}) },
    { key: "gem", kind: "item", title: "i", owner: null },
  ]
  const insisted = (level: "simple" | "standard" | "fine" | "boss" | null, key: string, complexity: "low" | null = null) => reviewContext({ ...run, model_complexity: complexity }, task(key), { entries: entries(level) } as never).insisted
  for (const level of ["fine", "boss"] as const) for (const key of ["g", "g_model", "g_skin"]) expect(insisted(level, key)).toBe(true)
  for (const level of ["simple", "standard", null] as const) for (const key of ["g", "g_model"]) expect(insisted(level, key)).toBe(false)
  // A thing that is not a creature's keeps the run's own setting, and so does a creature made outside the blueprint.
  expect(insisted("boss", "gem")).toBe(false)
  expect(insisted("boss", "ghost")).toBe(false)
  expect(reviewContext(run, { prompt: "x", source: "做一只简单的守卫" }, { entries: entries("boss") } as never).insisted).toBe(false)
  expect(insisted("standard", "g_model", "low")).toBe(true)
  // The brief is the person's own words as before; only whether they may relax the review changes.
  expect(reviewContext(run, task("g"), { entries: entries("fine") } as never)).toMatchObject({ asked: "做一只简单的守卫", brief: "做一只简单的守卫\n简单的低模守卫" })
})

// broad20: the review holds a creature's model to the same detail level its maker was told: the button, raised by the creature's tier, never lowered.
test("生物档位：验收按这个生物模型实际的精细度来量（顶部和档位里更高的那个），别的东西和更低的档位照顶部", () => {
  const entries = (level: "simple" | "standard" | "fine" | "boss" | "epic" | null) => [
    { key: "g_model", kind: "model", title: "m", owner: "g" },
    { key: "g_skin", kind: "texture", title: "s", owner: "g" },
    { key: "g", kind: "entity", title: "g", owner: null, ...(level ? { tier: { level, reason: "r", by: "ai" as const } } : {}) },
    { key: "gem_model", kind: "model", title: "i", owner: null },
  ]
  const task = (key: string) => ({ prompt: "做它", source: `blueprint:${key}` })
  const level = (button: "low" | "medium" | "high" | null, tier: "simple" | "standard" | "fine" | "boss" | "epic" | null, key: string) =>
    reviewContext({ prompt: "做一只守卫", model_complexity: button }, task(key), { entries: entries(tier) } as never).complexity
  // Under 低, a Boss's (or 精细, or 史诗) model is reviewed as 高; 标准 (the planner's default) and 简单 follow the button.
  for (const tier of ["fine", "boss", "epic"] as const) expect(level("low", tier, "g_model")).toBe("high")
  expect(level("low", "standard", "g_model")).toBe("low")
  expect(level("low", "simple", "g_model")).toBe("low")
  // Under 高 nothing is lowered, and 中 is raised only by what asks for 高.
  for (const tier of ["simple", "standard", "fine", "boss", "epic"] as const) expect(level("high", tier, "g_model")).toBe("high")
  expect(level("medium", "boss", "g_model")).toBe("high")
  expect(level("medium", "simple", "g_model")).toBe("medium")
  // Only the creature's own model: the creature, its texture, a model of something else and a task outside the blueprint keep the button's setting.
  for (const key of ["g", "g_skin", "gem_model", "ghost"]) expect(level("low", "boss", key)).toBe("low")
  expect(reviewContext({ prompt: "x", model_complexity: "low" }, { prompt: "y", source: "做一只守卫" }, { entries: entries("boss") } as never).complexity).toBe("low")
  // No tier written (an old blueprint), no blueprint at all, and a run that started with no button setting.
  expect(level("low", null, "g_model")).toBe("low")
  expect(reviewContext({ prompt: "x", model_complexity: "low" }, task("g_model")).complexity).toBe("low")
  expect(level(null, "boss", "g_model")).toBeUndefined()
})

test("外部 AI：调用顺序放宽——上一版没写自评也能看下一版，同一版再写自评是替换；独立验收有结论以后自评不再能改", async () => {
  const hidden = renderer()
  const { created, directory, runner } = await bench({ look: hidden.look })
  const { ids, assetId } = await claimed(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...ids, sheet })

  // A first look has nothing behind it to skip. The second version is looked at without a self-review of the first.
  expect(await runner.lookExternalTask({ ...ids, document: good })).not.toHaveProperty("note")
  const second = await runner.lookExternalTask({ ...ids, document: named("第二版") })
  expect(second).toMatchObject({ round: 2, note: TOLERATED.skipped_review(1), next_step: expect.stringContaining("self_review") })
  expect((await readMaking(directory, assetId))!.rounds.map((round) => [round.round, round.self_review])).toEqual([[1, null], [2, null]])

  // The skipped version is gone for good as far as the loop goes: this one still needs its own self-review before anything is reviewed or handed in.
  expect(await words(runner.finalReviewExternalTask(ids))).toBe(REFUSALS.no_self_review(2))
  expect(await words(runner.commitExternalTask({ ...ids, document: named("第二版") }))).toBe(`${REFUSALS.no_self_review(2)}任务保持运行，工程里什么都没有改动。`)

  // The self-review of a version written twice: the second stands, and the answer says so.
  expect(await runner.selfReviewExternalTask({ ...ids, ...revise })).not.toHaveProperty("note")
  const replaced = await runner.selfReviewExternalTask({ ...ids, ...done })
  expect(replaced).toMatchObject({ state: "reviewing", note: TOLERATED.replaced_review, next_step: expect.stringContaining("final_review") })
  expect((await readMaking(directory, assetId))!.rounds.map((round) => round.self_review?.verdict ?? null)).toEqual([null, "done"])

  // After the independent review of this very version has concluded, its self-review stays as it was written.
  await runner.finalReviewExternalTask(ids)
  await runner.finalReviewExternalTask({ ...ids, verdict: { passed: false, findings: ["头顶的嫩芽悬在半空，没有接在身体上"], independent: true } })
  expect(await words(runner.selfReviewExternalTask({ ...ids, ...revise }))).toBe(REFUSALS.reviewed_already)
  expect(await words(runner.selfReviewExternalTask({ ...ids, ...done }))).toBe(REFUSALS.reviewed_already)
  // The review itself is not given a second go.
  expect(await words(runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], independent: true } }))).toBe(REFUSALS.reviewed_and_failed)
})

test("外部 AI：位置满了领不了新的，拒绝的话按离做完多近排好手上的任务：评审已通过的最先，在等评审的最后", async () => {
  const hidden = renderer()
  const { created, runner } = await bench({ look: hidden.look })
  const started = await runner.startExternal({
    projectId: created.id,
    expectedRevision: created.revision,
    prompt: "四只生物",
    plan: { summary: "四只", questions: [], tasks: ["a", "b", "c", "d"].map((key) => ({ key, module: "model" as const, title: `生物${key}`, prompt: "生物", source: "生物", dependencies: [], target_id: null })) },
  })
  const ids = (index: number) => ({ projectId: created.id, runId: started.run.id, taskId: started.run.tasks[index]!.id })
  for (const index of [0, 1, 2]) await runner.claimExternalTask(ids(index))
  // 生物c is only claimed; 生物b has called its version finished and waits for the reviewer; 生物a has been reviewed and passed.
  for (const index of [0, 1]) {
    await runner.describeExternalTask({ ...ids(index), sheet })
    await runner.lookExternalTask({ ...ids(index), document: named(`版${index}`) })
    await runner.selfReviewExternalTask({ ...ids(index), ...done })
  }
  await runner.finalReviewExternalTask(ids(0))
  await runner.finalReviewExternalTask({ ...ids(0), verdict: { passed: true, findings: [], independent: true } })
  const refused = await words(runner.claimExternalTask(ids(3)))
  expect(refused).toContain("最先该做完的是「生物a」（评审已经通过，只差 commit_task）")
  expect(refused).toContain("手上的是：「生物a」评审已经通过，只差 commit_task；「生物c」刚领，还在做；「生物b」自评做完了，在等独立评审。")
  expect(refused).toContain("马上领「生物d」")
  // Once the passed one is handed in, the place is free and the claim goes through.
  await runner.commitExternalTask({ ...ids(0), document: named("版0") })
  expect((await runner.claimExternalTask(ids(3))).task.state).toBe("running")
})

test("版数用完以后接下来调用什么，照这一批现在的样子：还有任务能领就领它，不是 next_batch；这一批真结束了才是 next_batch", async () => {
  const { created, runner } = await bench({ look: renderer().look })
  const { model } = await pair(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...model, sheet })
  for (const round of Array.from({ length: MAKING_LIMITS.rounds - 1 }, (_, index) => index + 1)) {
    await runner.lookExternalTask({ ...model, document: named(`第 ${round} 版`) })
    await runner.selfReviewExternalTask({ ...model, ...revise })
  }
  await runner.lookExternalTask({ ...model, document: named("最后一版") })
  const ended = await words(runner.selfReviewExternalTask({ ...model, ...revise }))
  // The model is kept for the person; the creature that wears it is still queued and can be claimed now, so that is the call to name.
  expect(ended).toContain(REFUSALS.out_of_rounds(MAKING_LIMITS.rounds))
  expect(ended).toContain("claim_task")
  expect(ended).toContain("洞穴守卫（生物）")
  expect(ended).not.toContain("调用 next_batch")
  // The words are computed from the run, not fixed: the same ending in a batch of one names the other call.
  expect(ended).not.toContain(BATCH_OVER)
})

test("审查关着：final_review 写 independent: true 被退回并说明为什么；没看过就提交的退回话也不再要别的评审", async () => {
  const { created, runner } = await bench({ look: renderer().look, ai: { review: false } })
  const { ids } = await claimed(runner, created.id, created.revision)
  await runner.describeExternalTask({ ...ids, sheet })
  const refused = (work: () => Promise<unknown>) => work().then(() => "accepted", (error: unknown) => (error as Error).message)
  // Committing before the review: the refusal is the one for a maker that reviews itself, not the one that sends it to somebody else.
  await runner.lookExternalTask({ ...ids, document: good })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  const early = await refused(() => runner.commitExternalTask({ ...ids, document: good }))
  expect(early).toContain("independent 写 false")
  expect(early).not.toContain("交给一个没有参与制作的评审")
  // The material is handed over as for one's own check, and a claim of independence is refused.
  const packet = (await runner.finalReviewExternalTask(ids)) as { how: string }
  expect(packet.how).not.toContain("交给没参与制作的评审")
  const lie = await refused(() => runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], independent: true } }))
  expect(lie).toContain("审查关着")
  expect(lie).toContain("independent")
  // Saying so honestly is accepted.
  expect(await runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], independent: false } })).toMatchObject({ review: { passed: true, independent: false } })
})
test("long inspections report progress without consuming the completed packet", async () => {
  const receipts = createInspectionReceipts(2)
  const packet = { waiting: false, pictures: [{ label: "图" }] }
  expect(await receipts.start("one", async () => packet)).toEqual(packet)

  const ready = Promise.withResolvers<typeof packet>()
  const first = await receipts.start("one", async (progress) => {
    progress(3, 12)
    return ready.promise
  }) as { rendering: { id: string; done: number; total: number } }
  expect(first.rendering).toMatchObject({ done: 3, total: 12 })
  const id = first.rendering.id
  expect(() => receipts.poll("two", id)).toThrow("找不到")
  expect(receipts.poll("one", id)).toEqual(first)
  ready.resolve(packet)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(receipts.poll("one", id)).toEqual(packet)
  expect(receipts.poll("one", id)).toEqual(packet)
})

test("重开不会把未审查的修改覆盖到已保存模型", async () => {
  const { created, directory, runner } = await bench({ look: renderer().look })
  const first = await claimed(runner, created.id, created.revision)
  const formal = named("正式版")
  await runner.describeExternalTask({ ...first.ids, sheet })
  await runner.lookExternalTask({ ...first.ids, document: formal })
  await runner.selfReviewExternalTask({ ...first.ids, ...done })
  await runner.finalReviewExternalTask(first.ids)
  await runner.finalReviewExternalTask({ ...first.ids, verdict: { passed: true, findings: [], independent: true } })
  await runner.commitExternalTask({ ...first.ids, document: formal })
  const before = await openProject(directory)
  // Keep the original version clearly earlier than the update run.
  await Bun.sleep(20)
  const request = "把洞穴守卫做成更高的样子"
  const changed = await runner.startExternal({
    projectId: created.id, expectedRevision: before.revision, prompt: request,
    plan: { summary: request, questions: [], tasks: [{ key: "guardian", module: "model", title: "改洞穴守卫", prompt: request, source: request, dependencies: [], target_id: first.assetId }] },
  })
  const ids = { projectId: created.id, runId: changed.run.id, taskId: changed.run.tasks[0]!.id }
  await runner.claimExternalTask(ids)
  await runner.describeExternalTask({ ...ids, sheet })
  const draft = named("还没审查的一版")
  await runner.lookExternalTask({ ...ids, document: draft })
  expect((await openProject(directory)).workspace.assets[0]?.document).toEqual(formal)

  const reopened = createProjectRunner({ directoryFor: async () => directory, ai: {}, look: renderer().look })
  closers.push(() => reopened.dispose())
  const progress = await reopened.getExternalProgress({ projectId: ids.projectId, runId: ids.runId })
  const after = await openProject(directory)
  expect(after.revision).toBe(before.revision)
  expect(after.workspace.assets).toEqual(before.workspace.assets)
  expect(progress.drafts[ids.taskId]?.draft).toEqual(draft)
  expect(progress.run).toMatchObject({ state: "interrupted", tasks: [{ id: ids.taskId, state: "blocked" }] })
})
