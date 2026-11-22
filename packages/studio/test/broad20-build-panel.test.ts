import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import * as jobs from "@minemods/mod-core/jobs"
import { openProject, saveProject, storagePath } from "@minemods/mod-core/project"
import { builtWorkspaceAssets } from "@minemods/mod-core/workspace"
import { VERSION_WORDS, type PackedVersion } from "@minemods/mod-core/packed-version"
import { COUNTER_LABELS, STALL_MS, countLine, growthLine } from "@minemods/mod-core/progress-counter"
import { handSave } from "../src/main/content-service"
import { markProgress, type JobMarks } from "../src/main/job-marks"
import { createStudioService } from "../src/main/service"
import { versionView } from "../src/renderer/build-version"
import { CHAIN_WORDS, chainStep, runningNote, skippedBuildWords, stageElapsed, stageWait, type ChainFacts } from "../src/renderer/play-chain"
import { advanceChain, type Chain, type ChainDeps } from "../src/renderer/play-chain-run"
import type { SceneInfo } from "../src/renderer/features/test-scene"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const at = "2026-10-19T08:00:00.000Z"
const item = (name: string, identifier: string) => ({ kind: "item", identifier, name, max_stack: 64, color: "#99aacc", texture: null })

/** A pack as the build leaves it: a finished build job and the manifest beside it, made from the project as it stands. */
async function pack(directory: string) {
  const project = await openProject(directory)
  const id = randomUUID()
  const queued = await jobs.startJob(directory, { kind: "build", expectedRevision: project.revision })
  const running = await jobs.updateJob(directory, queued.id, { state: "running", expectedRevision: queued.revision })
  const output = { id, revision: project.revision, jarPath: path.join(directory, "x.jar"), projectDirectory: directory, sourceDirectory: path.join(directory, "generated", `build-${id}`), sha256: "a".repeat(64) }
  await jobs.updateJob(directory, queued.id, { state: "completed", expectedRevision: running.revision, output })
  await writeFile(await storagePath(directory, ["generated", `build-${id}`, "minemods-build.json"], true), JSON.stringify({ workspace_assets: builtWorkspaceAssets(project) }))
  return queued.id
}
async function save(directory: string, name: string, identifier: string) {
  const project = await openProject(directory)
  const made = handSave(project, { assetId: null, document: item(name, identifier), id: randomUUID(), at })
  await saveProject(directory, made.next, project.revision)
}

test("真实的记录：打包那一版含 4 样；之后又存了 2 样，面板说这一版里没有，数不会跟着现在的工程跑", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-panel-"))
  roots.push(root)
  const service = await createStudioService({ workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: {} })
  const created = await service.createProject({ name: "版本工程", description: "", empty: true })
  const { directory } = created
  const projectId = created.project.id
  // Nothing packed yet: no version, and a computer that has never built is cold for the build.
  expect(await service.getBuildPanel({ projectId })).toMatchObject({ latest: null, used: null, ready: { build: false, check: false, play: false } })
  for (const [name, identifier] of [["月屑", "moon_a"], ["月块", "moon_b"], ["月锭", "moon_c"], ["月镐", "moon_d"]] as const) await save(directory, name, identifier)
  const jobId = await pack(directory)
  const packed = await service.getBuildPanel({ projectId, jobId })
  expect(packed.latest).toMatchObject({ job_id: jobId, current: true, contains: 4, added: [], changed: [] })
  expect(packed.used).toEqual(packed.latest)
  // A build finished here means the development files are here: neither a code check nor the next pack is a first time.
  expect(packed.ready.build).toBe(true)
  // An outside AI saves two more while the game's files download.
  await save(directory, "守匣警报", "guard_a")
  await save(directory, "夜盾", "guard_b")
  const after = await service.getBuildPanel({ projectId, jobId })
  const used = after.used as PackedVersion
  expect(used).toMatchObject({ job_id: jobId, current: false, contains: 4 })
  expect(used.added.map((value) => value.title).sort()).toEqual(["夜盾", "守匣警报"])
  expect(VERSION_WORDS.later(used)).toMatch(/^打包以后又做好了 2 样（「.+」、「.+」），这一版里没有。$/)
  // A job id that is no finished build of this project is not a version.
  expect((await service.getBuildPanel({ projectId, jobId: randomUUID() })).used).toBeNull()
  // Packing again makes a new version that holds all six.
  const second = await pack(directory)
  expect((await service.getBuildPanel({ projectId, jobId: second })).used).toMatchObject({ current: true, contains: 6 })
  expect((await service.getBuildPanel({ projectId, jobId })).used).toMatchObject({ current: false, contains: 4 })
})

const version = (over: Partial<PackedVersion> = {}): PackedVersion => ({ job_id: "j", packed_at: new Date(2026, 9, 19, 10, 32).toISOString(), revision: 12, current: false, contains: 4, added: [{ title: "守匣警报", kind: "gameplay" }, { title: "夜盾", kind: "gameplay" }], changed: [], ...over })
const now = new Date(2026, 9, 19, 11, 0)

test("客户端还在下载、AI 又存了 2 样：面板用同一个口径说——正在打开的是哪一版、又做好了什么、给一个动作、下载不白费", () => {
  const view = versionView({ used: version(), latest: version(), chain: { running: "play", stop: null, want: "play" }, inGame: false, now })!
  expect(view.pack).toBe("正在打开的是 10:32 打包的那一版，含 4 样。")
  expect(view.later).toBe("打包以后又做好了 2 样（「守匣警报」、「夜盾」），这一版里没有。")
  expect(view.note).toContain("不会白费")
  expect(view.restart).toBe("取消这一次，重新打包并打开")
  // The plain buttons are off while it runs; the one action is the restart.
  expect(view.start).toBeNull()
  expect(view.same).toBe("")
})

test("游戏窗口已经开着：不能在玩家脚下换版本，只说先关掉再重新打包，不给取消键", () => {
  const view = versionView({ used: version(), latest: version(), chain: { running: "play", stop: null, want: "play" }, inGame: true, now })!
  expect(view.restart).toBeNull()
  expect(view.note).toBe("先把游戏窗口关掉，再点「重新打包并打开」。")
})

test("打包以后工程没变：只说是哪一版、含几样、和现在一样，不多给动作", () => {
  const view = versionView({ used: version({ current: true, added: [] }), latest: version({ current: true, added: [] }), chain: { running: "check", stop: null, want: "play" }, inGame: false, now })!
  expect(view).toMatchObject({ pack: "正在检查的是 10:32 打包的那一版，含 4 样。", same: "和现在的工程一样。", later: "", restart: null, start: null })
})

test("没有在跑的时候：最近一次打包是哪一版；过期了，开始键的字换成「重新打包并打开」", () => {
  const view = versionView({ latest: version(), chain: null, inGame: false, now })!
  expect(view.pack).toBe("最近一次打包是 10:32 打包的那一版，含 4 样。")
  expect(view.start).toEqual({ play: "重新打包并打开", jar: "重新打包" })
  expect(view.restart).toBeNull()
  // One that is the project as it is keeps the ordinary buttons.
  expect(versionView({ latest: version({ current: true, added: [] }), chain: null, inGame: false, now })!.start).toBeNull()
  // Never packed (known): says so. Not read yet: says nothing at all.
  expect(versionView({ latest: null, chain: null, inGame: false })!.pack).toBe("还没有打包过。")
  expect(versionView({ chain: null, inGame: false })).toBeNull()
})

test("正在打一个新的包时不列旧包缺什么；停在自带按钮的停靠点时不另外多一个按钮，也不把同一句说两遍", () => {
  expect(versionView({ used: version(), latest: version(), chain: { running: "build", stop: null, want: "play" }, inGame: false })).toBeNull()
  const stale = versionView({ used: version(), latest: version(), chain: { running: null, stop: "build_stale", want: "play" }, inGame: false, now })!
  expect(stale.later).toBe("")
  expect(stale.start).toBeNull()
  // A press that has no pack to name yet says nothing rather than something wrong.
  expect(versionView({ used: null, latest: version(), chain: { running: null, stop: null, want: "play" }, inGame: false })).toBeNull()
})

test("复用的打包在阶段列表里也说是哪一版，不再只说「这个版本已经打包过了」", () => {
  expect(skippedBuildWords(version({ current: true }), now)).toBe("沿用 10:32 打包的那一版，含 4 样")
  expect(skippedBuildWords(null)).toBe(CHAIN_WORDS.skipped.build)
  expect(Object.values(CHAIN_WORDS.skipped).join("")).not.toContain("这个版本已经打包过了")
})

// ---- the press itself ----
const facts = (over: Partial<ChainFacts>): ChainFacts => ({ want: "play", built: false, eula: true, world: false, ended: null, scene: null, making: 0, choice: null, ...over })
test("玩的时候工程又存了新东西：游戏关掉以后停在「已经关掉」，不会背着人再打一次包、再开一次游戏", () => {
  expect(chainStep(facts({ ended: { stage: "play", state: "completed" } }))).toEqual({ stop: "played" })
  // After the check, the pack that was checked is no longer the project: one decision, the same single action as after a finished build that went old.
  expect(chainStep(facts({ ended: { stage: "check", state: "completed" }, scene: { findings: 0, missing: [] } }))).toEqual({ stop: "build_stale" })
  expect(chainStep(facts({}))).toEqual({ run: "build" })
})

const A = "00000000-0000-4000-8000-00000000000a"
const PACK = "11111111-1111-4111-8111-111111111111"
function window(over: { latest?: string | null; warmth?: Record<"build" | "check" | "play", boolean> | null } = {}) {
  const shown: Chain[] = []
  const deps: ChainDeps = {
    readScene: async () => ({ eula: true, world: false, record: null }) as unknown as SceneInfo,
    latestBuildJobId: async () => (over.latest === undefined ? PACK : over.latest),
    readMaking: async () => 0,
    ready: async () => (over.warmth === undefined ? { build: true, check: false, play: false } : over.warmth),
    blocked: () => false,
    start: async () => ({ jobId: "job-1" }),
    error: () => "",
    show: (next) => void (next && shown.push(next)),
  }
  return { deps, shown }
}
const base = (over: Partial<Chain> = {}): Chain => ({ projectId: A, want: "play", running: null, marks: {}, ended: null, stop: null, error: "", lines: [], findings: 0, missing: [], making: 0, ...over })

test("按下的这一次记着自己用的是哪个打包；之后又存了东西、没有“现在的打包”了，它仍然记着原来那个", async () => {
  const first = window()
  await advanceChain(base({ ended: { stage: "build", state: "completed" } }), null, first.deps)
  expect(first.shown.at(-1)).toMatchObject({ build: PACK, running: { stage: "check" } })
  // The project is saved while the game's files download; the chain's stages still work from the same pack.
  const moved = window({ latest: null })
  await advanceChain(base({ build: PACK, ended: { stage: "play", state: "completed" } }), null, moved.deps)
  expect(moved.shown.at(-1)).toMatchObject({ build: PACK, stop: "played" })
})

test("每一步开始时记下这台电脑有没有下载过它要用的文件，以后不改：下完了也仍然是按“第一次”那样比时间", async () => {
  const cold = window({ warmth: { build: true, check: false, play: false } })
  await advanceChain(base({ ended: { stage: "build", state: "completed" } }), null, cold.deps)
  expect(cold.shown.at(-1)).toMatchObject({ running: { stage: "check" }, ready: { check: false } })
  const warm = window({ warmth: { build: true, check: true, play: true } })
  await advanceChain(base({ ended: { stage: "build", state: "completed" } }), null, warm.deps)
  expect(warm.shown.at(-1)).toMatchObject({ ready: { check: true } })
  // Reading it failed: nothing is recorded, so nothing is said about a first time.
  const unknown = window({ warmth: null })
  await advanceChain(base({ ended: { stage: "build", state: "completed" } }), null, unknown.deps)
  expect(unknown.shown.at(-1)?.ready).toBeUndefined()
})

// ---- waiting ----
test("计数记在任务里：数变了才更新时间；换了一步（编译、打开游戏）就不再带着旧数", () => {
  const marks: JobMarks = {}
  const t = (n: number) => new Date(Date.UTC(2026, 9, 19, 10, n)).toISOString()
  markProgress(marks, `${countLine(COUNTER_LABELS.assets, 500, 3888)}\n`, () => t(0))
  expect(marks).toMatchObject({ counter: "游戏的声音、语言和图标：500 / 3888", counter_at: t(0) })
  // Retry notices in the tools' English go by while the count stands still: the time does not move.
  markProgress(marks, "「a.json」这一次没下完（ETIMEDOUT），2 秒后再试（第 2 次，最多 6 次）。\n", () => t(1))
  expect(marks.counter_at).toBe(t(0))
  markProgress(marks, `${countLine(COUNTER_LABELS.assets, 600, 3888)}\n`, () => t(3))
  expect(marks).toMatchObject({ counter: "游戏的声音、语言和图标：600 / 3888", counter_at: t(3) })
  markProgress(marks, "正在打开测试场。\n", () => t(4))
  expect(marks.counter).toBeUndefined()
  expect(marks.counter_at).toBeUndefined()
  // A build: the folder's growth is a counter too, and Gradle's next stage ends it.
  markProgress(marks, `${growthLine(COUNTER_LABELS.libs, 80)}\n`, () => t(5))
  expect(marks.counter).toBe("正在准备开发用的库：这一步已经新增 80 MB")
  markProgress(marks, "> Task :compileJava\n", () => t(6))
  expect(marks.counter).toBeUndefined()
})

test("停在 3500 / 3888 超过两分钟：如实说这一步有一阵没有进展，给出能做的事；没到两分钟、没有计数的，都不下这个结论", () => {
  const t0 = Date.parse("2026-10-19T10:00:00.000Z")
  const checkpoint = { detail: "x", counter: "游戏的声音、语言和图标：3500 / 3888", counter_at: new Date(t0).toISOString() }
  const wait = (ms: number, over: Partial<Parameters<typeof stageWait>[0]> = {}) => stageWait({ stage: "play", state: "running", ms: 9 * 60_000, detail: "", checkpoint, ready: false, now: t0 + ms, ...over })
  expect(wait(60_000).stalled).toBeNull()
  expect(wait(60_000).counter).toBe("游戏的声音、语言和图标：3500 / 3888")
  const stalled = wait(9 * 60_000).stalled!
  expect(stalled.lead).toBe("这一步有一阵没有进展了：「游戏的声音、语言和图标：3500 / 3888」已经 9 分钟没有变。")
  expect(stalled.can).toContain("取消")
  expect(STALL_MS).toBe(120_000)
  expect(wait(STALL_MS).stalled).not.toBeNull()
  // No counter at all (a quiet compile): there is no number to show and nothing to call stuck.
  const quiet = stageWait({ stage: "build", state: "running", ms: 9 * 60_000, detail: "> Task :compileJava\n", checkpoint: { detail: "x" }, ready: true, now: t0 + 9 * 60_000 })
  expect(quiet.counter).toBe("")
  expect(quiet.stalled).toBeNull()
  // A job that is not running any more shows no stall.
  expect(wait(9 * 60_000, { state: "canceled" })).toMatchObject({ counter: "", stalled: null })
})

test("长等待只说真的：没有计数就没有数字，也没有百分号；时间用已经过了几分钟", () => {
  const quiet = stageWait({ stage: "build", state: "running", ms: 7 * 60_000, detail: "", checkpoint: { detail: "" }, ready: false, now: 0 })
  expect(quiet).toEqual({ elapsed: "已经过了 7 分钟。一般 6 到 10 分钟。", counter: "", stalled: null })
  const counted = stageWait({ stage: "build", state: "running", ms: 3 * 60_000, detail: "", checkpoint: { counter: growthLine(COUNTER_LABELS.game, 412), counter_at: new Date(0).toISOString() }, ready: false, now: 60_000 })
  expect(counted.counter).toBe("正在准备游戏的开发文件：这一步已经新增 412 MB")
  expect(`${quiet.elapsed}${counted.counter}`).not.toContain("%")
})

test("“第一次”按这台电脑的真实状态说：下过的不再说，没下过的才说；没读到就什么也不说", () => {
  for (const stage of ["build", "check", "play"] as const) {
    expect(runningNote(stage, "", true)).not.toContain("第一次")
    expect(runningNote(stage, "")).not.toContain("第一次")
    expect(runningNote(stage, "", false)).toContain("还没有下载过")
  }
  // The same words everywhere a step says what it costs: no stage still promises “第一次” on its own.
  expect(Object.values(CHAIN_WORDS.running).join("")).not.toContain("第一次")
  // Warm build: the files are already here.
  expect(runningNote("build", "", true)).toContain("不用再下载")
})

test("超过一般的上限就如实说比平常久，不再一直停在原来的话上", () => {
  // Round 20: a cold pack took 10 min 54 s, a background check 2 min 25 s.
  expect(stageElapsed("build", 7 * 60_000, "", false)).toBe("已经过了 7 分钟。一般 6 到 10 分钟。")
  expect(stageElapsed("build", (10 * 60 + 54) * 1000, "", false)).toBe("已经过了 10 分钟。比平常久（一般 6 到 10 分钟）。")
  expect(stageElapsed("check", (2 * 60 + 25) * 1000, "", false)).toBe("已经过了 2 分钟。比平常久（一般 1 到 2 分钟）。")
  expect(stageElapsed("check", 90_000, "", false)).toBe("已经过了 1 分钟。一般 1 到 2 分钟。")
  // A step that has no range for its state says only the time.
  expect(stageElapsed("check", 5 * 60_000, "", true)).toBe("已经过了 5 分钟。")
})

test("本次不改的已有东西照样算进包里：新蓝图把它标成「这次不做」，旧包不会变成含 0 样，新增 5 样后新包含 6 样", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-panel-"))
  roots.push(root)
  const service = await createStudioService({ workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: {} })
  const created = await service.createProject({ name: "沿用工程", description: "", empty: true })
  const { directory } = created
  const projectId = created.project.id
  await save(directory, "手做方块", "hand_block")
  const before = await openProject(directory)
  const assetId = before.workspace.assets.find((asset) => asset.title === "手做方块")!.id
  const jobId = await pack(directory)
  expect((await service.getBuildPanel({ projectId, jobId })).used).toMatchObject({ current: true, contains: 1 })
  // The next plan sets the saved thing aside (本次不改) and plans something else; the pack made before is not touched by that.
  const now = await openProject(directory)
  await saveProject(
    directory,
    {
      ...now,
      blueprint: {
        request: "再做几样",
        style: { palette: [], shape: "", naming: "", world: "" },
        questions: [],
        revision: 1,
        state: "confirmed",
        entries: [{ key: "hand", kind: "item", title: "手做方块", brief: "已有的，这次不改", owner: null, needs: [], out_of_scope: "已经做好了，这次不改。", asset_id: assetId }],
      },
    },
    now.revision,
  )
  expect((await service.getProjectOverview({ projectId })).items.find((value) => value.asset_id === assetId)).toMatchObject({ status: "out_of_scope" })
  const unchanged = (await service.getBuildPanel({ projectId, jobId })).used as PackedVersion
  expect(unchanged.contains).toBe(1)
  expect(VERSION_WORDS.version(unchanged)).toContain("含 1 样")
  for (const n of [1, 2, 3, 4, 5]) await save(directory, `新东西${n}`, `fresh_${n}`)
  const moved = (await service.getBuildPanel({ projectId, jobId })).used as PackedVersion
  expect(moved).toMatchObject({ current: false, contains: 1 })
  expect(moved.added).toHaveLength(5)
  expect(moved.changed).toEqual([])
  // The new pack holds the old thing and the five: six, counted from its own manifest, not from what the plan says about each.
  const second = await pack(directory)
  expect((await service.getBuildPanel({ projectId, jobId: second })).used).toMatchObject({ current: true, contains: 6, added: [] })
})
