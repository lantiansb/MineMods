import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rename, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { strToU8, unzipSync, zipSync } from "fflate"
import { BUILD_STAGES, buildStageWords } from "../src/build-stages"
import { createProject, storagePath } from "../src/project"
import { exportProjectArchive, importProjectArchive } from "../src/container"
import { begin, describe, finalReview, fingerprint, looked, reviewAsked, selfReview } from "../src/making"
import { blueprintSource } from "../src/task-source"
import { CLAIMED_DETAIL, type ProjectRun, type RunTask } from "../src/workspace-runs"
import {
  ACTIVITY_ARCHIVE_PATH,
  ACTIVITY_LIMITS,
  ActivityEventSchema,
  archivedActivity,
  buildActivity,
  buildWatch,
  checkArchivedActivity,
  makingActivity,
  noteActivity,
  pulseActivity,
  readActivity,
  runActivity,
  taskItem,
  type ActivityInput,
} from "../src/activity"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-activity-"))
  directories.push(root)
  const directory = path.join(root, "project")
  await createProject({ directory, name: "动态" })
  return { root, directory }
}

const at = "2026-10-05T08:00:00.000Z"
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const task = (n: number, key: string, title: string, extra: Partial<RunTask> = {}): RunTask => ({
  id: uuid(n),
  asset_id: uuid(100 + n),
  key,
  module: "item",
  title,
  prompt: title,
  source: blueprintSource(key),
  dependencies: [],
  target_id: null,
  state: "queued",
  detail: "",
  error: null,
  started_at: null,
  finished_at: null,
  ...extra,
})
const run = (tasks: RunTask[], extra: Partial<ProjectRun> = {}): ProjectRun => ({
  id: uuid(1),
  project_id: uuid(2),
  prompt: "做一套蓝晶",
  state: "running",
  summary: "",
  questions: [],
  tasks,
  events: [],
  error: null,
  model_complexity: null,
  created_at: at,
  updated_at: at,
  ...extra,
})
const said = (events: ActivityInput[]) => events.map((event) => `${event.mark}${event.end ? "!" : ""}${event.step ? "~" : ""} ${event.title ?? "-"}: ${event.text}`)
const note = (text: string, extra: Partial<ActivityInput> = {}): ActivityInput => ({ kind: "note", mark: "note", item: null, title: null, text, ...extra })

test("一批任务从头到尾：每个状态变化报一次，顺序就是发生的顺序，模型吐字不算一步", () => {
  const ore = task(11, "ore", "蓝晶矿")
  const sword = task(12, "sword", "蓝晶剑")
  const guard = task(13, "guard", "守卫")
  const steps: ProjectRun[] = [
    run([ore, sword, guard]),
    run([{ ...ore, state: "running" }, { ...sword, state: "running" }, guard]),
    // Text arriving from a model changes only the detail: a sign of life, not a step.
    run([{ ...ore, state: "running", detail: "模型输出已接收 1200 字" }, { ...sword, state: "running", detail: "正在画剑刃的高光" }, guard]),
    run([{ ...ore, state: "validating", detail: "做出来了，正在检查。" }, { ...sword, state: "running", detail: "正在画剑刃的高光" }, guard]),
    // Back from the door: the acceptance standard refused this version.
    run([{ ...ore, state: "running", detail: "没通过审查，正在按意见改（还可以再交 2 次）。" }, { ...sword, state: "saving" }, guard], { events: [{ id: 1, task_id: ore.id, time: at, message: "【不机械】图上到处是杂点。\n怎么改：画成成块的深浅。" }] }),
    run([{ ...ore, state: "completed", outcome: "kept_unsatisfied", detail: "AI 还不满意：把第 3 版先交给你验收。" }, { ...sword, state: "completed" }, { ...guard, state: "running" }], {
      events: [{ id: 2, task_id: ore.id, time: at, message: "AI 还不满意：把第 3 版先交给你验收。矿石的裂纹还是不像晶体。" }],
    }),
    run([{ ...ore, state: "completed", outcome: "kept_unsatisfied", detail: "AI 还不满意：把第 3 版先交给你验收。" }, { ...sword, state: "completed" }, { ...guard, state: "failed", error: "TypeError: fetch failed" }], { state: "partial" }),
  ]
  const events = steps.flatMap((step, index) => runActivity(steps[index - 1] ?? null, step))
  expect(said(events)).toEqual([
    "run -: 开始做这一批，一共 3 样：蓝晶矿、蓝晶剑、守卫",
    "run 蓝晶矿: 开始做",
    "run 蓝晶剑: 开始做",
    "run~ 蓝晶剑: 正在画剑刃的高光",
    "run~ 蓝晶矿: 做出来了，正在检查。",
    "fail 蓝晶矿: 没通过审查，正在按意见改（还可以再交 2 次）。",
    "run~ 蓝晶剑: 正在检查并保存。",
    "warn! 蓝晶矿: AI 还不满意：把第 3 版先交给你验收。",
    "ok! 蓝晶剑: 做好了，已经保存，等你验收。",
    "run 守卫: 开始做",
    "fail! 守卫: 这一样没做成。",
    "warn! -: 这一批结束了：做好 1 样，1 样留了一版但没通过审查，1 样没做成。",
  ])
  // Each event is about the overview item of its plan entry, so a click lands on that card.
  expect(events.filter((event) => event.title === "蓝晶剑").every((event) => event.item === "sword")).toBe(true)
  expect(taskItem({ source: "手工任务", asset_id: uuid(9) })).toBe(uuid(9))
  // The refusal's own words are the lines; the leftover reason of a kept version too.
  expect(events[5]!.lines).toEqual(["【不机械】图上到处是杂点。", "怎么改：画成成块的深浅。"])
  expect(events[7]!.lines).toEqual(["矿石的裂纹还是不像晶体。"])
  // The kept version says why it was kept, so the top line can count it apart from what is done; the ones that passed carry no such field.
  expect(events[7]).toMatchObject({ kept: "unsatisfied" })
  expect(events[8]!.kept).toBeUndefined()
  // A raw error is never the sentence: plain words stand, the original goes behind 高级.
  expect(events[10]).toMatchObject({ lines: ["出了技术问题，原文在高级里。"], detail: "TypeError: fetch failed" })
  // Nothing changed, nothing said.
  expect(runActivity(steps[3]!, steps[3]!)).toEqual([])
})

test("「等你验收」说的是每一版 AI 做的：蓝图里的东西、按意见改已保存的东西、用户一句话新做的东西都等人验收，卡片上也是这样说的", () => {
  const finished = (extra: Partial<RunTask>) => said(runActivity(run([task(11, "ore", "蓝晶矿", { ...extra, state: "running" })]), run([task(11, "ore", "蓝晶矿", { ...extra, state: "completed" })], { state: "completed" }))).filter((line) => line.startsWith("ok! 蓝晶矿"))
  expect(finished({})).toEqual(["ok! 蓝晶矿: 做好了，已经保存，等你验收。"])
  // A change to a thing that was already saved, from the person's own words and with no plan entry behind it.
  expect(finished({ source: "把矿石调亮一点", target_id: uuid(111) })).toEqual(["ok! 蓝晶矿: 做好了，已经保存，等你验收。"])
  // Something new made from a sentence waits for the person too (11-09: it was told 「等你验收」 and given no button; `asset-overview.test.ts` says the same).
  expect(finished({ source: "做一块蓝晶矿", target_id: null })).toEqual(["ok! 蓝晶矿: 做好了，已经保存，等你验收。"])
})

test("broad23: 外部 AI 领了任务还没交过任何东西，动态不说「开始做」；交了第一样东西才算开始", () => {
  const ore = task(11, "ore", "蓝晶矿")
  const claimed = { ...ore, state: "running" as const, detail: CLAIMED_DETAIL }
  const handed = { ...claimed, detail: "部件说明交上来了。" }
  const steps = [run([ore]), run([claimed]), run([handed])]
  expect(said(steps.flatMap((step, index) => runActivity(steps[index - 1] ?? null, step)))).toEqual(["run -: 开始做这一批，一共 1 样：蓝晶矿", "note 蓝晶矿: 领了任务，还没动手", "run~ 蓝晶矿: 部件说明交上来了。"])
  // Studio's own AI starts on a task the moment it takes it.
  expect(said(runActivity(run([ore]), run([{ ...ore, state: "running", detail: "正在调用模块模型。" }])))).toEqual(["run 蓝晶矿: 开始做"])
})

test("一批的其他结局：先问问题、停下、被打断、被卡住，各说各的", () => {
  const ore = task(11, "ore", "蓝晶矿", { state: "running" })
  const sword = task(12, "sword", "蓝晶剑")
  expect(said(runActivity(null, run([], { state: "planning" })))).toEqual(["run -: 正在想这句话要做哪些东西。"])
  expect(runActivity(run([], { state: "planning" }), run([], { state: "awaiting_input", questions: ["守卫会主动攻击吗？"] }))).toMatchObject([{ kind: "plan", mark: "warn", end: true, text: "AI 想先问你几件事。", lines: ["守卫会主动攻击吗？"] }])
  const going = run([ore, sword])
  expect(said(runActivity(going, run([{ ...ore, state: "completed" }, { ...sword, state: "canceled" }], { state: "canceled" })))).toEqual([
    "ok! 蓝晶矿: 做好了，已经保存，等你验收。",
    "note! 蓝晶剑: 停下了，这一样没有做完。",
    "note! -: 停下了，这一批保存了 1 样。",
  ])
  // Cut off by the app closing: what had started says so, what had not is not 「做到一半」, and the way on is where the person can find it (11-09: 「再点一次继续」 had nothing to press).
  const begun = { ...ore, started_at: "2026-10-01T00:00:00.000Z" }
  expect(said(runActivity(run([begun, sword]), run([{ ...begun, state: "blocked" }, { ...sword, state: "blocked" }], { state: "interrupted" })))).toEqual([
    "note! 蓝晶矿: 做到一半，应用关掉了，这一样没有做完。",
    "note! 蓝晶剑: 还没开始做，应用就关掉了。",
    "warn! -: 上次做到一半，应用关掉了，已经交来的都存好了。要接着做：用自己的 AI 助手的，回你的 AI 窗口说「继续」；用 Studio 自己的 AI 的，在总览里再开始一次。",
  ])
  expect(said(runActivity(going, run([{ ...ore, state: "blocked" }, { ...sword, state: "blocked" }], { state: "interrupted" }))).at(-1)).toBe(
    "warn! -: 计划收到了，还没开始做，应用就关掉了。要接着做：用自己的 AI 助手的，回你的 AI 窗口说「继续」；用 Studio 自己的 AI 的，在总览里再开始一次。",
  )
  // Held back by what it stands on: said by name, and the same whether the run is still going or was read again after the app had been opened anew.
  const behind = task(12, "sword", "蓝晶剑", { dependencies: ["ore"] })
  const gone = [{ ...ore, state: "failed" as const, error: "贴图和模型对不上。" }, { ...behind, state: "blocked" as const }]
  expect(said(runActivity(run([ore, behind]), run(gone, { state: "failed", error: "贴图和模型对不上。" })))).toEqual([
    "fail! 蓝晶矿: 这一样没做成。",
    "note! 蓝晶剑: 要用的「蓝晶矿」没做成，这一样先放着。",
    "fail! -: 这一批没做成。",
  ])
  expect(said(runActivity(run([ore, behind]), run(gone, { state: "interrupted" }))).slice(0, 2)).toEqual(["fail! 蓝晶矿: 这一样没做成。", "note! 蓝晶剑: 要用的「蓝晶矿」没做成，这一样先放着。"])
  // Two links away: the one in between is held back itself, and what is named is the one that failed.
  const far = task(13, "shield", "蓝晶盾", { dependencies: ["sword"] })
  expect(said(runActivity(run([ore, behind, far]), run([...gone, { ...far, state: "blocked" as const }], { state: "failed" }))).slice(2, 3)).toEqual(["note! 蓝晶盾: 要用的「蓝晶矿」没做成，这一样先放着。"])
  expect(said(runActivity(run([ore, behind]), run([{ ...ore, state: "canceled" as const }, { ...behind, state: "blocked" as const }], { state: "canceled" }))).slice(1, 2)).toEqual(["note! 蓝晶剑: 要用的「蓝晶矿」被停下了，这一样先放着。"])
  // A blocked task that waited for nothing that stopped says the app closed only when the run says so.
  const started = { started_at: "2026-10-01T00:00:00.000Z" }
  expect(said(runActivity(going, run([{ ...ore, ...started, state: "blocked" }, { ...sword, ...started, state: "blocked" }], { state: "interrupted" }))).slice(0, 2)).toEqual(["note! 蓝晶矿: 做到一半，应用关掉了，这一样没有做完。", "note! 蓝晶剑: 做到一半，应用关掉了，这一样没有做完。"])
  // Cut off by the app closing while what it waited for was cut off too: nothing failed, so nothing is blamed.
  expect(said(runActivity(run([ore, behind]), run([{ ...ore, ...started, state: "blocked" }, { ...behind, ...started, state: "blocked" }], { state: "interrupted" }))).slice(0, 2)).toEqual(["note! 蓝晶矿: 做到一半，应用关掉了，这一样没有做完。", "note! 蓝晶剑: 做到一半，应用关掉了，这一样没有做完。"])
  // Cut short with a version kept: said as that, in the runner's own words, never as "做好了" or as a failure.
  const cut = "制作被中断了：把中断前最好的一版（第 1 版）先交给你验收。"
  const rescued = runActivity(going, run([{ ...ore, state: "completed", outcome: "kept_interrupted", detail: cut }, { ...sword, ...started, state: "blocked" }], { state: "interrupted", events: [{ id: 1, task_id: ore.id, time: at, message: `${cut}这是中断前最好的一版，还没有做完审查。` }] }))
  expect(said(rescued).slice(0, 2)).toEqual([`warn! 蓝晶矿: ${cut}`, "note! 蓝晶剑: 做到一半，应用关掉了，这一样没有做完。"])
  expect(rescued[0]!.lines).toEqual(["这是中断前最好的一版，还没有做完审查。"])
  expect(JSON.stringify(rescued)).not.toMatch(/还不满意|没做成|做好了/)
})

test("看着做的每一步从制作记录里读出来：说明、每一版、自评、补图、评审；同一份记录再读一遍不会多出一条", async () => {
  const f = await fixture()
  const sheet = {
    subject: "一只守着蓝色矿石的洞穴守卫。",
    recognisable: ["胸口嵌着发光的蓝矿", "一双发蓝光的眼睛"],
    parts: [{ name: "body", what: "躯干", shape: "上宽下窄的石块", attaches: "立在两条腿上", surface: "深灰石头", moves: "走路时左右微晃", assumed: false }],
    assumed: [],
  }
  const version = (name: string) => fingerprint({ kind: "model", name })
  const begun = begin(null, { asset_id: uuid(201), entry: "guard_model", kind: "model", request: "守卫", brief: "守卫的模型", task_id: uuid(13), remark: null })
  const about = { item: "guard_model", title: "守卫的模型" }
  expect(makingActivity(begun, about)).toEqual([])
  const first = selfReview(looked(describe(begun, sheet), { fingerprint: version("a"), pictures: [{ label: "六个角度", file: "1-a-0.jpg" }], findings: ["认得出：正面找不到一双眼睛。"], cover: "1-cover.jpg" }), {
    matches: ["躯干的比例对"],
    problems: ["正面看不出脸"],
    next: ["把眼睛加大并提亮"],
    verdict: "revise",
  })
  const second = selfReview(looked(first, { fingerprint: version("b"), pictures: [{ label: "六个角度", file: "2-a-0.jpg" }], findings: [] }), { matches: ["都对上了"], problems: [], next: [], verdict: "done" })
  const asked = reviewAsked(second, [{ label: "背面近看", file: "2-r-0.jpg" }])
  const failed = finalReview(asked, { passed: false, findings: ["背上的叶子只有一片"], independent: true })
  const events = makingActivity(failed, about)
  expect(events.map((event) => `${event.kind}/${event.mark} ${event.round ?? "-"}: ${event.text}`)).toEqual([
    "task/run -: 写好了部件说明：1 个部件。",
    "look/run 1: 做出了第 1 版，看了它的渲染图。",
    "review/warn 1: 第 1 版自己检查：还要改。",
    "look/run 2: 做出了第 2 版，看了它的渲染图。",
    "review/run 2: 第 2 版自己检查过，觉得可以了。",
    "review/run 2: 审查员想再看几张图，补拍给它了（第 1 次）。",
    "review/fail 2: 没参与制作的审查员看了第 2 版：没通过，有必须改的地方。",
  ])
  expect(events[0]!.lines).toEqual(sheet.recognisable)
  expect(events[1]).toMatchObject({ lines: ["认得出：正面找不到一双眼睛。"], picture: { asset_id: uuid(201), file: "1-cover.jpg" } })
  // No cover kept for the second round: the first picture it looked at stands in. Nothing is copied either way.
  expect(events[3]!.picture).toEqual({ asset_id: uuid(201), file: "2-a-0.jpg" })
  expect(events[2]!.lines).toEqual(["正面看不出脸", "把眼睛加大并提亮"])
  expect(events[6]!.lines).toEqual(["背上的叶子只有一片"])
  // The review's line shows the version it looked at.
  expect(events[6]!.picture).toEqual({ asset_id: uuid(201), file: "2-a-0.jpg" })
  expect(events.every((event) => event.item === "guard_model" && event.key?.startsWith(`making:${uuid(13)}:`))).toBe(true)
  // A review by the maker itself is said as that.
  expect(makingActivity(finalReview(second, { passed: true, findings: [], advice: ["表情可以再凶一点"], independent: false }), about).at(-1)).toMatchObject({ mark: "ok", text: "做它的 AI 自己看了第 2 版：通过。", lines: ["表情可以再凶一点"] })

  // Read while it grows, as the panel's polling does: every step lands once.
  await noteActivity(f.directory, makingActivity(first, about))
  await noteActivity(f.directory, makingActivity(first, about))
  await noteActivity(f.directory, makingActivity(failed, about))
  expect((await readActivity(f.directory)).events.map((event) => event.text)).toEqual(events.map((event) => event.text))
})

test("动态只增不改，有上限；文字太长会截短；说不出话也不抛错", async () => {
  const f = await fixture()
  expect(await readActivity(f.directory)).toMatchObject({ events: [], last: 0 })
  await noteActivity(f.directory, note("第一条"))
  await noteActivity(f.directory, [note("长".repeat(1000), { lines: ["", ...Array.from({ length: 9 }, (_, index) => `第 ${index} 行${"长".repeat(400)}`)], detail: "x".repeat(5000) }), note("  ")])
  const read = await readActivity(f.directory)
  expect(read.events.map((event) => event.seq)).toEqual([1, 2, 3])
  expect(read.events[1]!.text).toHaveLength(ACTIVITY_LIMITS.text)
  expect(read.events[1]!.text.endsWith("…")).toBe(true)
  expect(read.events[1]!.lines).toHaveLength(ACTIVITY_LIMITS.lines)
  expect(read.events[1]!.lines!.every((line) => line.length <= ACTIVITY_LIMITS.line)).toBe(true)
  expect(read.events[1]!.detail).toHaveLength(ACTIVITY_LIMITS.detail)
  expect(read.events[2]!.text).toBe("（没有说明）")
  // Polling: only what came after.
  expect((await readActivity(f.directory, 2)).events.map((event) => event.seq)).toEqual([3])
  // Something that cannot be an event is dropped without failing whoever reported it, and the queue goes on.
  await noteActivity(f.directory, { ...note("坏的"), kind: "nonsense" as "note" })
  await noteActivity(f.directory, async () => Promise.reject(new Error("boom")))
  await noteActivity(f.directory, note("还在"))
  expect((await readActivity(f.directory)).events.map((event) => event.text).slice(-2)).toEqual(["（没有说明）", "还在"])
  // A key is reported once; the very same tool call again within a minute is once too, but a refusal in between is not swallowed.
  await noteActivity(f.directory, [note("有键", { key: "k" }), note("有键", { key: "k" })])
  await noteActivity(f.directory, note("有键", { key: "k" }))
  const poll = note("外部 AI 看了看这一批的进度。", { kind: "tool", tool: "get_run", quiet: true })
  await noteActivity(f.directory, [poll, poll, note("外部 AI 提交了「蓝晶剑」，被 Studio 退回了。", { kind: "tool", mark: "fail" }), poll])
  expect((await readActivity(f.directory)).events.map((event) => event.text).slice(-4)).toEqual(["有键", poll.text, "外部 AI 提交了「蓝晶剑」，被 Studio 退回了。", poll.text])

  // Bounded: once the slack is used up the oldest go in one rewrite, and the count goes on.
  const before = (await readActivity(f.directory)).last
  await noteActivity(f.directory, Array.from({ length: ACTIVITY_LIMITS.events + ACTIVITY_LIMITS.slack }, (_, index) => note(`事件 ${index}`)))
  const full = await readActivity(f.directory)
  expect(full.events).toHaveLength(ACTIVITY_LIMITS.events)
  expect(full.last).toBe(before + ACTIVITY_LIMITS.events + ACTIVITY_LIMITS.slack)
  expect(full.events[0]!.seq).toBe(full.last - ACTIVITY_LIMITS.events + 1)
  const lines = (await readFile(await storagePath(f.directory, ACTIVITY_ARCHIVE_PATH.split("/")), "utf8")).split("\n").filter(Boolean)
  expect(lines).toHaveLength(ACTIVITY_LIMITS.events)
  lines.slice(0, 20).forEach((line) => ActivityEventSchema.parse(JSON.parse(line)))
})

test("重启以后还在：换一个进程（这里用换路径代替）从文件读回来，编号接着往下数；有没有动静只看这一次运行", async () => {
  const f = await fixture()
  await noteActivity(f.directory, [note("开始做这一批", { kind: "batch", mark: "run" }), note("做好了", { kind: "task", mark: "ok", end: true, item: "ore", title: "蓝晶矿" })])
  const moved = path.join(f.root, "reopened")
  await rename(f.directory, moved)
  const read = await readActivity(moved)
  expect(read.events.map((event) => [event.seq, event.text])).toEqual([[1, "开始做这一批"], [2, "做好了"]])
  // Nothing has moved in this process yet: the last sign of life is the last event's own time.
  expect(read.alive_at).toBe(Date.parse(read.events[1]!.at))
  await Bun.sleep(5)
  pulseActivity(moved)
  expect((await readActivity(moved)).alive_at).toBeGreaterThan(read.alive_at)
  await noteActivity(moved, note("重启后的第一条"))
  expect((await readActivity(moved, 2)).events.map((event) => event.seq)).toEqual([3])
})

test("打包的每一段报一次，提醒逐条报；成功说文件在哪，失败说人话，停下就说停下", async () => {
  const seen = new Set<string>()
  expect(buildActivity("Assembling a saved project snapshot\n> Task :compileJava\n", seen).map((event) => event.text)).toEqual(["正在把工程里的东西整理到一起。", "正在编译模组的代码。"])
  expect(buildActivity("> Task :compileJava\nGuard.java:12: warning: [deprecation] foo() is deprecated\n> Task :processResources", seen)).toMatchObject([
    { mark: "run", text: "正在装进贴图、模型和声音。" },
    { mark: "warn", text: "打包时有一条提醒，不影响做出模组。", detail: "Guard.java:12: warning: [deprecation] foo() is deprecated" },
  ])
  expect(buildActivity("Guard.java:12: warning: [deprecation] foo() is deprecated\n> Task :remapJar\nBUILD SUCCESSFUL", seen).map((event) => event.text)).toEqual(["正在装成一个模组文件。", "编译完成，正在检查做出来的文件。"])

  const f = await fixture()
  const good = buildWatch(f.directory)
  good.progress("> Task :compileJava\nA.java:1: warning: unchecked")
  good.done("/tmp/out/bluecrystal-1.0.0.jar")
  const stopped = buildWatch(f.directory)
  stopped.failed(new Error("CANCELLED"))
  const bad = buildWatch(f.directory)
  bad.failed(new Error("error: cannot find symbol\n  symbol: class Foo"))
  const worded = buildWatch(f.directory)
  worded.failed(new Error("「守卫的玩法」引用了一个不存在的物品。"))
  const events = (await readActivity(f.directory)).events
  expect(events.every((event) => event.kind === "build" && event.item === null)).toBe(true)
  expect(events.map((event) => `${event.mark}${event.end ? "!" : ""} ${event.text}`)).toEqual([
    "run 开始把做好的东西做进模组。",
    "run 正在编译模组的代码。",
    "warn 打包时有一条提醒，不影响做出模组。",
    "ok! 模组打包好了：bluecrystal-1.0.0.jar",
    "run 开始把做好的东西做进模组。",
    "note! 打包停下了。",
    "run 开始把做好的东西做进模组。",
    "fail! 模组没有打包成功。",
    "run 开始把做好的东西做进模组。",
    "fail! 模组没有打包成功。",
  ])
  expect(events[3]).toMatchObject({ detail: "/tmp/out/bluecrystal-1.0.0.jar" })
  expect(events[7]).toMatchObject({ lines: ["打包时出了技术问题，原文在高级里。"], detail: "error: cannot find symbol\n  symbol: class Foo" })
  expect(events[9]!.lines).toEqual(["「守卫的玩法」引用了一个不存在的物品。"])
  expect(events[9]!.detail).toBeUndefined()
})

test("随工程包走，但只带装得下的最新一段；包里夹带的不是动态记录就拒收", async () => {
  const f = await fixture()
  expect(await archivedActivity(f.directory)).toEqual({})
  await noteActivity(f.directory, Array.from({ length: 1200 }, (_, index) => note(`事件 ${index} ${"字".repeat(280)}`)))
  const packed = (await archivedActivity(f.directory))[ACTIVITY_ARCHIVE_PATH]!
  expect(packed.length).toBeLessThanOrEqual(ACTIVITY_LIMITS.archive)
  const kept = new TextDecoder().decode(packed).split("\n").filter(Boolean).map((line) => ActivityEventSchema.parse(JSON.parse(line)))
  // One unbroken tail that ends with the newest event.
  expect(kept.length).toBeGreaterThan(100)
  expect(kept.length).toBeLessThan(1200)
  expect(kept.at(-1)!.seq).toBe(1200)
  expect(kept.map((event) => event.seq)).toEqual(Array.from({ length: kept.length }, (_, index) => 1200 - kept.length + 1 + index))

  const archive = path.join(f.root, "activity.minemods")
  await exportProjectArchive({ directory: f.directory, destination: archive })
  const destination = path.join(f.root, "imported")
  await importProjectArchive({ archive, destination })
  const read = await readActivity(destination)
  expect(read.events.map((event) => event.seq)).toEqual(kept.map((event) => event.seq))
  // The imported log goes on counting from where it was.
  await noteActivity(destination, note("导入以后"))
  expect((await readActivity(destination)).last).toBe(1201)

  expect(() => checkArchivedActivity(strToU8('{"seq":1}\n'))).toThrow()
  expect(() => checkArchivedActivity(new Uint8Array(ACTIVITY_LIMITS.archive * 4 + 1))).toThrow("Activity log is too large")
  const entries = unzipSync(await Bun.file(archive).bytes())
  const tampered = path.join(f.root, "tampered.minemods")
  // Checksums that match, so only what the entry holds can turn it away.
  const junk = strToU8("#!/bin/sh\nrm -rf /\n")
  const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"])) as { entries: { path: string; bytes: number; sha256: string }[] }
  const listed = manifest.entries.map((entry) => (entry.path === ACTIVITY_ARCHIVE_PATH ? { path: entry.path, bytes: junk.length, sha256: createHash("sha256").update(junk).digest("hex") } : entry))
  await Bun.write(tampered, zipSync({ ...entries, [ACTIVITY_ARCHIVE_PATH]: junk, "manifest.json": strToU8(JSON.stringify({ ...manifest, entries: listed })) }))
  await expect(importProjectArchive({ archive: tampered, destination: path.join(f.root, "tampered") })).rejects.toThrow("工程包里的想法记录或动态记录读不出来。")
})

test("the build's stage sentences are one table: the window gets the latest stage of a stretch of output, the log the same words", () => {
  expect(buildStageWords("Downloading something\n")).toBeNull()
  expect(buildStageWords("Assembling a saved project snapshot\n> Task :compileJava\n")).toBe("正在编译模组的代码。")
  // By place in the output, not by the table's order: Gradle may do resources first.
  expect(buildStageWords("> Task :processResources\n> Task :compileJava\n")).toBe("正在编译模组的代码。")
  expect(buildStageWords("> Task :jar\n> Task :remapJar\nBUILD SUCCESSFUL in 41s")).toBe("编译完成，正在检查做出来的文件。")
  expect(buildActivity("> Task :remapJar\n", new Set()).map((event) => event.text)).toEqual([buildStageWords("> Task :remapJar\n")!])
  expect(BUILD_STAGES.map(([, words]) => words)).toHaveLength(new Set(BUILD_STAGES.map(([, words]) => words)).size)
})
