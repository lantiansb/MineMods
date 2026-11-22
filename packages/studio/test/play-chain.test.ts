import { expect, test } from "bun:test"
import { SCENE_WORDS } from "@minemods/mod-core/scene"
import { RELEASE_DEFAULTS, RELEASE_LICENSES, ReleaseSchema } from "@minemods/mod-core/release"
import { STALE_BUILD_CODE, jobWentStale, staleReasonOf } from "@minemods/mod-core/build-stages"
import { CRASH_WORDS } from "@minemods/mod-core/game-crash"
import { CHAIN_WORDS, INTERRUPTED_WORDS, JOB_STATE_WORDS, chainOwnsNextAction, chainStages, chainStep, endedDetail, plainProgress, runningNote, type ChainFacts } from "../src/renderer/play-chain"
import { CHIP_WORDS, OUTSIDE_PRESENT_MS, connectionChip, outsidePresent } from "../src/renderer/connection-chip"
import { LICENSE_WORDS, authorPlaceholder, releaseFields, releaseOf, releaseProblem } from "../src/renderer/release-words"

const facts = (over: Partial<ChainFacts>): ChainFacts => ({ want: "play", built: false, eula: false, world: false, ended: null, scene: null, making: 0, choice: null, ...over })
const done = (stage: "build" | "check" | "play") => ({ stage, state: "completed" as const })

test("构建并试玩：一次按下走完打包、后台检查、打开测试场；已经打包过的版本不再打包", () => {
  expect(chainStep(facts({}))).toEqual({ run: "build" })
  expect(chainStep(facts({ built: true, eula: true, ended: done("build") }))).toEqual({ run: "check" })
  expect(chainStep(facts({ built: true, eula: true, ended: done("check"), scene: { findings: 0, missing: [] } }))).toEqual({ run: "play" })
  expect(chainStep(facts({ built: true, eula: true, ended: done("play") }))).toEqual({ stop: "played" })
  // A finished build of the project as it is now: straight to the scene.
  expect(chainStep(facts({ built: true, eula: true }))).toEqual({ run: "check" })
  expect(chainStages("play")).toEqual(["build", "check", "play"])
})

test("构建并试玩：没同意许可协议又没有测试场的世界：停下来问，不替人同意，也不直接把人送到主菜单", () => {
  // No licence, no check, so no world: opening now would land on the game's main menu with nothing of the mod set out.
  expect(chainStep(facts({ built: true, eula: false, ended: done("build") }))).toEqual({ stop: "eula" })
  expect(chainStep(facts({ built: true, eula: false }))).toEqual({ stop: "eula" })
  // The person chose to open anyway: today's behaviour, the game opens as it is.
  expect(chainStep(facts({ built: true, eula: false, ended: done("build"), choice: "open" }))).toEqual({ run: "play" })
  // A world from an earlier check of this very build is there: opening it needs no new check.
  expect(chainStep(facts({ built: true, eula: false, ended: done("build"), world: true }))).toEqual({ run: "play" })
  // Agreed (the stop's first button, or the box): the background check comes first, with or without an old world.
  expect(chainStep(facts({ built: true, eula: true, ended: done("build") }))).toEqual({ run: "check" })
  expect(chainStep(facts({ built: true, eula: true, ended: done("build"), world: true }))).toEqual({ run: "check" })
  // Only the jar asked for: nothing to decide about the game.
  expect(chainStep(facts({ want: "jar", built: true, eula: false, ended: done("build") }))).toEqual({ stop: "built" })
  // Say plainly why it stopped and what each answer gives; the sentence by the box no longer promises more than opening on the menu.
  expect(CHAIN_WORDS.stop.eula).toBe("要把你做的东西摆在测试场里给你看，得先在后台用游戏自带的服务器建好测试场，这需要你同意游戏的许可协议（Minecraft EULA）。")
  expect([CHAIN_WORDS.agree, CHAIN_WORDS.openBare]).toEqual(["同意许可协议，继续", "不同意，直接打开游戏"])
  expect(CHAIN_WORDS.openBareNote).toContain("主菜单")
  // Round 17: the note no longer points at a command nobody can use; it says what is missing and that the steps follow (the steps are generated from the project, `byHandLines`).
  expect(CHAIN_WORDS.openBareNote).not.toMatch(/\/give|\/summon|END_|[A-Z]_[A-Z]/)
  expect(CHAIN_WORDS.openBareNote).toContain("创造模式的世界")
  expect(CHAIN_WORDS.licence).toContain("aka.ms/MinecraftEULA")
  expect(CHAIN_WORDS.eula).toContain("只到主菜单")
  expect(CHAIN_WORDS.eula).not.toContain("不同意也能直接打开")
})

test("构建并试玩：只要 jar 的人打包完就停，不检查也不开游戏", () => {
  expect(chainStep(facts({ want: "jar" }))).toEqual({ run: "build" })
  expect(chainStep(facts({ want: "jar", built: true, eula: true, ended: done("build") }))).toEqual({ stop: "built" })
  expect(chainStep(facts({ want: "jar", built: true, eula: true }))).toEqual({ stop: "built" })
  expect(chainStages("jar")).toEqual(["build"])
  expect(CHAIN_WORDS.jar).toBe("打包，不打开游戏")
})

test("构建并试玩：打包失败、取消、打包后工程又改了，都停下并说清楚", () => {
  expect(chainStep(facts({ ended: { stage: "build", state: "failed" } }))).toEqual({ stop: "build_failed" })
  expect(chainStep(facts({ ended: { stage: "build", state: "interrupted" } }))).toEqual({ stop: "build_failed" })
  for (const stage of ["build", "check", "play"] as const) expect(chainStep(facts({ built: true, eula: true, ended: { stage, state: "canceled" } }))).toEqual({ stop: "canceled" })
  // The job ended well, yet there is no build of the project as it is now.
  expect(chainStep(facts({ built: false, ended: done("build") }))).toEqual({ stop: "build_stale" })
})

test("构建并试玩：AI 还在做东西、又没有可用的打包：先说清楚，让人选先打包现有的还是等；已经有打包就不拦", () => {
  // Nothing usable to play yet and things are still being made: any save would make the new pack out of date.
  expect(chainStep(facts({ making: 3 }))).toEqual({ stop: "making" })
  expect(chainStep(facts({ want: "jar", making: 1 }))).toEqual({ stop: "making" })
  expect(chainStep(facts({ making: 3, choice: "now" }))).toEqual({ run: "build" })
  expect(chainStep(facts({ making: 3, choice: "leave" }))).toEqual({ stop: "waits" })
  // A finished build of the project as it is: the press plays exactly that, later saves do not touch it.
  expect(chainStep(facts({ making: 3, built: true, eula: true }))).toEqual({ run: "check" })
  // Asked once, at the start: after the pack the question is the stale stop's, not this one.
  expect(chainStep(facts({ making: 3, ended: done("build") }))).toEqual({ stop: "build_stale" })
  expect(CHAIN_WORDS.stop.making(3)).toContain("3 样")
  // The second answer queues nothing (an AI between two batches cannot be told from a finished one), so it does not promise to: the person presses again.
  expect([CHAIN_WORDS.packNow, CHAIN_WORDS.waitForAi]).toEqual(["先打包现在有的", "先不打包，我晚点再按"])
  expect(CHAIN_WORDS.waitForAi).not.toContain("等它做完")
  expect(CHAIN_WORDS.stop.waits).toContain("你再按一次")
  expect(CHAIN_WORDS.stop.build_stale_making(2)).toContain("2 样")
  // The stale stop no longer tells the person to press again: it offers the press, worded for what they asked for.
  expect(CHAIN_WORDS.stop.build_stale).not.toContain("再按一次")
  expect([CHAIN_WORDS.again("play"), CHAIN_WORDS.again("jar")]).toEqual(["重新打包并打开", "重新打包"])
})

test("构建并试玩：检查发现问题时停下来问，「还是打开看看」才打开，「先不打开」就不打开", () => {
  const found = { built: true, eula: true, ended: done("check"), scene: { findings: 2, missing: [] } }
  expect(chainStep(facts(found))).toEqual({ stop: "found" })
  expect(chainStep(facts({ ...found, choice: "open" }))).toEqual({ run: "play" })
  expect(chainStep(facts({ ...found, choice: "leave" }))).toEqual({ stop: "left" })
  expect(CHAIN_WORDS.stop.found(2)).toBe("后台检查发现了 2 处问题：")
  expect([CHAIN_WORDS.open, CHAIN_WORDS.leave]).toEqual(["还是打开看看", "先不打开"])
  // A check that could not run says nothing about the mod: the same two answers.
  const failed = { built: true, eula: true, ended: { stage: "check" as const, state: "failed" as const }, scene: { findings: 0, missing: [] } }
  expect(chainStep(facts(failed))).toEqual({ stop: "check_failed" })
  expect(chainStep(facts({ ...failed, choice: "open" }))).toEqual({ run: "play" })
  expect(chainStep(facts({ ...failed, choice: "leave" }))).toEqual({ stop: "left" })
})

test("构建并试玩：缺前置模组时停下，用测试场自己的那句话；打开失败也停下", () => {
  const missing = { findings: 0, missing: ["geckolib"] }
  expect(chainStep(facts({ built: true, eula: true, ended: { stage: "check", state: "failed" }, scene: missing }))).toEqual({ stop: "missing" })
  expect(chainStep(facts({ built: true, ended: { stage: "play", state: "failed" }, scene: missing }))).toEqual({ stop: "missing" })
  // Not asked around: a missing mod is not something to open anyway.
  expect(chainStep(facts({ built: true, eula: true, ended: { stage: "check", state: "failed" }, scene: missing, choice: "open" }))).toEqual({ stop: "missing" })
  expect(CHAIN_WORDS.missing).toBe(SCENE_WORDS.missing)
  expect(chainStep(facts({ built: true, ended: { stage: "play", state: "failed" }, scene: { findings: 0, missing: [] } }))).toEqual({ stop: "play_failed" })
})

test("任务状态只用中文说；进度里只有服务自己写的中文句子给人看，工具打印的英文留给高级", () => {
  expect(JOB_STATE_WORDS).toEqual({ queued: "排队中", running: "正在进行", completed: "做好了", failed: "没做成", canceled: "已取消", interrupted: "没做成" })
  for (const words of [...Object.values(JOB_STATE_WORDS), ...Object.values(CHAIN_WORDS.stage), ...Object.values(CHAIN_WORDS.running)]) expect(words).not.toMatch(/[A-Za-z]{3,}/)
  expect(plainProgress("准备测试场要用的游戏文件（服务器）。\n")).toBe("准备测试场要用的游戏文件（服务器）。")
  expect(plainProgress("游戏的声音、语言和图标：500 / 3000\nDownloading https://example.org/a.jar\n")).toBe("游戏的声音、语言和图标：500 / 3000")
  // A stage Gradle names in its own output is said the way the activity log says it.
  expect(plainProgress("> Task :compileJava\n")).toBe("正在编译模组的代码。")
  expect(plainProgress("> Task :compileJava\nBUILD SUCCESSFUL in 12s\n")).toBe("编译完成，正在检查做出来的文件。")
  // A line that mixes in a tool's words is not one of ours.
  expect(plainProgress("机器对账：entity copper_owl 缺少 loot table\n")).toBe("")
  // What a stage costs when its downloads are still to come is said only then, from the computer's real state (see the "第一次" test).
  expect(runningNote("build", "", false)).toContain("还没有下载过游戏的开发文件")
  expect(runningNote("play", "", false)).toContain("几百 MB")
  // A Forge or NeoForge project's first time is its own target's, said in its words (`getBuildPanel`'s `cold`); once ready, nothing about downloads.
  expect(runningNote("play", "", false, undefined, "这台电脑还没有装过 Forge 1.20.1 的游戏本体")).toBe(`${CHAIN_WORDS.running.play}这台电脑还没有装过 Forge 1.20.1 的游戏本体`)
  expect(runningNote("play", "", true, true, "这台电脑还没有装过 Forge 1.20.1 的游戏本体")).toBe(CHAIN_WORDS.running.play)
})

test("连接标识：外面的 AI 刚调用过工具就算接上，两分钟没动静才说在等；MCP、API 这些字只在高级里出现", () => {
  const now = Date.parse("2026-10-07T12:00:00.000Z")
  const ago = (ms: number) => new Date(now - ms).toISOString()
  expect(outsidePresent(undefined, now)).toBe(false)
  expect(outsidePresent({ connected: true, lastActivity: null }, now)).toBe(true)
  // The bridge calls it disconnected 30 s after a call; between two calls of one session it is still there.
  expect(outsidePresent({ connected: false, lastActivity: ago(45_000) }, now)).toBe(true)
  expect(outsidePresent({ connected: false, lastActivity: ago(OUTSIDE_PRESENT_MS - 1) }, now)).toBe(true)
  expect(outsidePresent({ connected: false, lastActivity: ago(OUTSIDE_PRESENT_MS) }, now)).toBe(false)
  expect(outsidePresent({ connected: false, lastActivity: null }, now)).toBe(false)
  expect(outsidePresent({ connected: false, lastActivity: "not a date" }, now)).toBe(false)
  expect(OUTSIDE_PRESENT_MS).toBe(120_000)
  const chip = (external: boolean, mcp: { connected: boolean; lastActivity: string | null } | undefined, aiConfigured: boolean, advanced = false) => connectionChip({ external, mcp, aiConfigured, advanced, now })
  expect(chip(true, { connected: false, lastActivity: ago(60_000) }, false)).toEqual({ on: true, state: "connected", text: "已连接" })
  expect(chip(true, { connected: false, lastActivity: null }, true)).toEqual({ on: false, state: "unconnected", text: "AI 没连接" })
  expect(chip(true, undefined, true)).toEqual({ on: false, state: "unconnected", text: CHIP_WORDS.outside_off })
  expect(chip(false, { connected: true, lastActivity: ago(0) }, false)).toEqual({ on: false, state: "unconnected", text: "AI 没连接" })
  expect(chip(false, undefined, true)).toEqual({ on: true, state: "connected", text: "已连接" })
  for (const words of Object.values(CHIP_WORDS)) expect(words).not.toMatch(/MCP|API/)
  expect(chip(true, { connected: true, lastActivity: null }, false, true).text).toBe("已连接 · MCP")
  expect(chip(false, undefined, true, true).text).toBe("已连接 · API")
  expect(chip(false, undefined, false, true).text).toBe("AI 没连接")
})

test("发布信息：没填的不存，写错的用一句话说；作者空着时说清会用谁的名字；每种许可证都有一句人话", () => {
  expect(releaseOf(releaseFields(undefined))).toEqual({})
  const filled = { ...releaseFields(undefined), author: " 小铜 ", version: "1.2.0", license: "ARR" as const, homepage: "  " }
  expect(releaseOf(filled)).toEqual({ author: "小铜", version: "1.2.0", license: "ARR" })
  expect(ReleaseSchema.parse(releaseOf(filled))).toEqual({ author: "小铜", version: "1.2.0", license: "ARR" })
  expect(releaseFields({ author: "小铜", sources: "https://example.org/src" })).toEqual({ author: "小铜", version: "", license: "", homepage: "", sources: "https://example.org/src", issues: "", glyphs: "" })
  expect(releaseProblem(filled)).toBe("")
  expect(releaseProblem({ ...filled, version: "1.2" })).toContain("版本号写成 1.0.0 这样的三段数字")
  expect(releaseProblem({ ...filled, issues: "http://example.org" })).toContain("https://")
  expect(authorPlaceholder("  小铜 ")).toBe("小铜")
  expect(authorPlaceholder("")).toBe("MineMods Studio")
  expect(authorPlaceholder("")).toBe(RELEASE_DEFAULTS.author)
  expect(Object.keys(LICENSE_WORDS).sort()).toEqual(Object.keys(RELEASE_LICENSES).sort())
  for (const words of Object.values(LICENSE_WORDS)) expect(words).not.toMatch(/[A-Za-z]{3,}/)
})

test("a long stage says how long it has run and what a first time usually takes; a short one says nothing", async () => {
  const { stageElapsed } = await import("../src/renderer/play-chain")
  expect(stageElapsed("build", 30_000)).toBe("")
  // Not known whether the downloads were there: only the time is said, nothing about a first time.
  expect(stageElapsed("build", 4 * 60_000 + 5_000)).toBe("已经过了 4 分钟。")
  expect(stageElapsed("build", 4 * 60_000 + 5_000, "", false)).toBe("已经过了 4 分钟。一般 6 到 10 分钟。")
  expect(stageElapsed("build", 90_000, "", true)).toBe("已经过了 1 分钟。一般 1 到 2 分钟。")
  expect(stageElapsed("play", 2 * 60_000, "", false)).toContain("一般 1 到 7 分钟")
  expect(stageElapsed("check", Number.NaN)).toBe("")
  // Waiting its turn behind another run: the progress line says that, and how long a first build takes is not said beside it.
  const { RUNTIME_WAIT_LINE, RUNTIME_TURN_LINE } = await import("@minemods/mod-core/runtime")
  const { plainProgress } = await import("../src/renderer/play-chain")
  const waiting = `Assembling a saved project snapshot\n${RUNTIME_WAIT_LINE}`
  expect(stageElapsed("build", 5 * 60_000, waiting)).toBe("")
  expect(plainProgress(waiting)).toContain("自动接着做")
  expect(stageElapsed("build", 5 * 60_000, `${waiting}${RUNTIME_TURN_LINE}`)).toContain("已经过了 5 分钟")
  expect(plainProgress(`${waiting}${RUNTIME_TURN_LINE}`)).toBe("轮到它了，接着做。")
})

test("broad6 w3: once the game is open, the play stage stops saying it is opening and stops counting the play as waiting", async () => {
  const { runningNote, stageElapsed, inGame } = await import("../src/renderer/play-chain")
  const opening = "正在打开测试场。\n[Render thread/INFO]: Setting user: Player\n"
  const open = `${opening}[Server thread/INFO]: Player joined the game\n${SCENE_WORDS.in_game}\n`
  expect(runningNote("play", opening)).toBe(CHAIN_WORDS.running.play)
  expect(stageElapsed("play", 5 * 60_000, opening)).toContain("已经过了 5 分钟")
  expect(inGame("play", open)).toBe(true)
  expect(runningNote("play", open)).toBe("")
  expect(stageElapsed("play", 12 * 60_000, open)).toBe("")
  expect(plainProgress(open)).toBe(SCENE_WORDS.in_game)
  // Only the play stage reads it.
  expect(runningNote("build", open)).toBe(CHAIN_WORDS.running.build)
})

// broad11 w4b: the last line of a job that stopped without writing an end was still 「游戏已经开着了」.
test("一步已经不在进行了，就不再说游戏开着；被打断的那一步说清是 Studio 关了", () => {
  const open = `正在打开测试场。\n${SCENE_WORDS.in_game}`
  expect(endedDetail("running", open)).toBe(open)
  expect(endedDetail("queued", open)).toBe(open)
  expect(endedDetail("interrupted", open)).toBe(`正在打开测试场。\n${INTERRUPTED_WORDS}`)
  expect(endedDetail("interrupted", "")).toBe(INTERRUPTED_WORDS)
  expect(endedDetail("canceled", open)).toBe("正在打开测试场。")
  expect(plainProgress(endedDetail("interrupted", open))).not.toContain("游戏已经开着了")
})

// broad16 a60–a61: the game was on its main menu and the drawer kept saying it was opening, 3 and then 6 minutes in.
test("游戏停在主菜单也算已经打开：不再说「正在打开」，不再数第一次下载的分钟，状态词换成「游戏开着」", async () => {
  const { runningNote, stageElapsed, inGame, endedDetail } = await import("../src/renderer/play-chain")
  const opening = "正在打开测试场。\n[Render thread/INFO]: Setting user: Player\n"
  const title = `${opening}${SCENE_WORDS.at_title}\n`
  expect(inGame("play", opening)).toBe(false)
  expect(inGame("play", title)).toBe(true)
  expect(inGame("build", title)).toBe(false)
  expect(runningNote("play", title)).toBe("")
  expect(stageElapsed("play", 6 * 60_000, title)).toBe("")
  expect(plainProgress(title)).toBe(SCENE_WORDS.at_title)
  expect(CHAIN_WORDS.gameOpen).toBe("游戏开着")
  // The job ending takes either line out; an interrupted one says why it stopped.
  expect(endedDetail("completed", title)).toBe("正在打开测试场。\n[Render thread/INFO]: Setting user: Player")
  expect(endedDetail("interrupted", title)).toContain(INTERRUPTED_WORDS)
  expect(endedDetail("interrupted", title)).not.toContain("主菜单")
})

test("打包的时候工程被存了新内容（作业因此失败）：和「打包完又改了」是同一个停靠点，只有一个再打包的动作，不落进普通失败", () => {
  // Round 17: revision 12 became 13 while the pack ran; the job failed on the project changing, and the window showed the two ordinary buttons.
  for (const stage of ["build", "check", "play"] as const) {
    expect(chainStep(facts({ ended: { stage, state: "failed", stale: true } }))).toEqual({ stop: "build_stale" })
    expect(chainStep(facts({ ended: { stage, state: "interrupted", stale: true } }))).toEqual({ stop: "build_stale" })
  }
  // An ordinary failure, with the same words in its error, is still an ordinary failure: the decision is the recorded reason, not the sentence.
  expect(chainStep(facts({ ended: { stage: "build", state: "failed" } }))).toEqual({ stop: "build_failed" })
  // A cancel stays a cancel even if the job was marked.
  expect(chainStep(facts({ ended: { stage: "build", state: "canceled", stale: true } }))).toEqual({ stop: "canceled" })
  // The one action is the same as after a finished-but-old build, for both ways of pressing.
  expect(CHAIN_WORDS.again("play")).toBe("重新打包并打开")
  expect(CHAIN_WORDS.again("jar")).toBe("重新打包")
  for (const words of [CHAIN_WORDS.stop.build_stale_failed, CHAIN_WORDS.stop.build_stale_failed_making(2)]) {
    expect(words).toContain("打包的时候")
    expect(words).not.toMatch(/STALE|revision|没有打包成功/)
  }
  expect(CHAIN_WORDS.stop.build_stale_failed_making(2)).toContain("还在做 2 样")
})

test("作业因工程被改而失败，是按它记下的原因认的，不是按错误的字句", () => {
  expect(staleReasonOf(new Error(STALE_BUILD_CODE))).toBe("stale")
  expect(staleReasonOf(new Error("DOWNLOAD_FAILED"))).toBeNull()
  expect(staleReasonOf("STALE_BUILD_REVISION")).toBeNull()
  const failed = { state: "failed", error: "工程已在构建后修改。请重新构建当前版本，再导出或试玩。", checkpoint: { detail: "x", reason: "stale" } }
  expect(jobWentStale(failed)).toBe(true)
  // The same sentence without the recorded reason, a different reason, a job that did not fail, no checkpoint: none of them is stale.
  expect(jobWentStale({ ...failed, checkpoint: { detail: "x" } })).toBe(false)
  expect(jobWentStale({ ...failed, checkpoint: { reason: "network" } })).toBe(false)
  expect(jobWentStale({ ...failed, state: "completed" })).toBe(false)
  expect(jobWentStale({ ...failed, checkpoint: null })).toBe(false)
  expect(jobWentStale(null)).toBe(false)
})

test("停靠点自己带按钮的时候，抽屉里普通的「打包并打开游戏」「只打包」不再同时摆出来（broad18 r52）", async () => {
  const { STOPS_WITH_OWN_ACTIONS, chainOwnsNextAction } = await import("../src/renderer/play-chain")
  const { readFileSync } = await import("node:fs")
  const path = await import("node:path")
  const source = readFileSync(path.join(import.meta.dir, "../src/renderer/studio-app.tsx"), "utf8")
  // The stops that draw a button row of their own are read out of the drawer's markup, so a new stop with buttons that is not in the rule fails here.
  const block = source.slice(source.indexOf("class={`chain-stop"), source.indexOf("The game was opened on its main menu"))
  const drawn = new Set<string>()
  for (const part of block.split("<Show when={run().stop")) {
    if (!part.includes('<div class="build-actions">')) continue
    for (const stop of `run().stop${part.slice(0, part.indexOf("}>"))}`.matchAll(/stop === "(\w+)"/g)) drawn.add(stop[1]!)
  }
  expect([...drawn].sort()).toEqual([...STOPS_WITH_OWN_ACTIONS].sort())
  for (const stop of ["eula", "making", "build_stale", "found", "check_failed"] as const) expect(chainOwnsNextAction(stop)).toBe(true)
  // Stops with no button of their own, and no stop at all, keep the ordinary pair: it is the way to try again.
  for (const stop of ["built", "played", "build_failed", "play_failed", "canceled", "left", "waits", "missing", "busy", null] as const) expect(chainOwnsNextAction(stop)).toBe(false)
  // The ordinary pair sits behind that rule in the drawer, and the export row no longer points at a button that may be away.
  expect(source).toContain("<Show when={!chainOwnsNextAction(shownChain()?.stop)}>")
  expect(source).not.toContain("按上面的「只打包")
})

test("指向某张卡片的「打开」按钮：压在上面的构建抽屉先收起，不论当时在不在概览页（broad18 r10）", async () => {
  const { readFileSync } = await import("node:fs")
  const path = await import("node:path")
  const source = readFileSync(path.join(import.meta.dir, "../src/renderer/studio-app.tsx"), "utf8")
  const go = source.slice(source.indexOf("const goToTarget"), source.indexOf("// Home page, a project's own menu"))
  // Closed after a successful move, in the target path itself, not as a side effect of changing the page.
  expect(go).toMatch(/if \(!yes\) return\s+setBuildOpen\(false\)\s+setNavOpen\(false\)\s+setJump\(/)
})

test("broad18 w2: a play that ended because the game crashed stops as a crash, not as 「测试场已经关掉了」 and not as a game that would not open", () => {
  const crashed = { stage: "play" as const, state: "failed" as const, crashed: true }
  expect(chainStep(facts({ built: true, eula: true, ended: crashed, scene: { findings: 0, missing: [] } }))).toEqual({ stop: "crashed" })
  // A play that failed without a crash is still the plain failure, and a play that was closed is still the plain end.
  expect(chainStep(facts({ built: true, eula: true, ended: { stage: "play", state: "failed" }, scene: { findings: 0, missing: [] } }))).toEqual({ stop: "play_failed" })
  expect(chainStep(facts({ built: true, eula: true, ended: done("play") }))).toEqual({ stop: "played" })
  // The stop says it crashed, in the words of the crash and in nothing that sounds like a normal close.
  expect(CHAIN_WORDS.stop.crashed).toBe(CRASH_WORDS.stop)
  expect(CHAIN_WORDS.stop.crashed).toContain("崩溃")
  expect(CHAIN_WORDS.stop.crashed).not.toContain("关掉了。想再看")
  expect(CHAIN_WORDS.stop.played).not.toContain("崩溃")
  // The ordinary pair of buttons stays: trying again is the way on, and the AI button is the crash's own.
  expect(chainOwnsNextAction("crashed")).toBe(false)
})
