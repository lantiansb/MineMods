import { expect, test } from "bun:test"
import { advanceChain, type Chain, type ChainDeps } from "../src/renderer/play-chain-run"
import type { SceneInfo } from "../src/renderer/features/test-scene"

const A = "00000000-0000-4000-8000-00000000000a"
const B = "00000000-0000-4000-8000-00000000000b"
const BUILD = "11111111-1111-4111-8111-111111111111"

const chain = (over: Partial<Chain> = {}): Chain => ({ projectId: A, want: "play", running: null, marks: {}, ended: null, stop: null, error: "", lines: [], findings: 0, missing: [], making: 0, ...over })
const built = { stage: "build" as const, state: "completed" as const }

/** A window with project B on screen and the drawer closed: nothing here can tell which project is shown, only what each project has. */
function window(over: Partial<ChainDeps> & { builds?: Record<string, string | null>; eula?: boolean; world?: boolean; buildId?: string; making?: number } = {}) {
  const started: { projectId: string; stage: string; jobId: string }[] = []
  const shown: (Chain | null)[] = []
  const builds = over.builds ?? { [A]: BUILD, [B]: null }
  const deps: ChainDeps = {
    readScene: async () => ({ eula: over.eula ?? false, world: over.world ?? false, record: over.world ? { build_id: over.buildId ?? BUILD, missing: [] } : null }) as unknown as SceneInfo,
    latestBuildJobId: async (projectId) => {
      if (!(projectId in builds)) throw new Error("没有这个工程")
      return builds[projectId]!
    },
    readMaking: async () => over.making ?? 0,
    ready: async () => ({ build: true, check: true, play: true }),
    blocked: () => false,
    start: async (projectId, stage, jobId) => {
      started.push({ projectId, stage, jobId })
      return { jobId: `job-${started.length}` }
    },
    error: () => "",
    show: (next) => void shown.push(next),
    ...over,
  }
  return { deps, started, shown }
}

test("打包完时人正看着另一个工程：试玩照样为原来的工程启动，用的是原工程的打包", async () => {
  const { deps, started, shown } = window({ eula: true })
  await advanceChain(chain({ ended: built }), null, deps)
  // Never the project on screen (B has no build at all), never dropped.
  expect(started).toEqual([{ projectId: A, stage: "check", jobId: BUILD }])
  expect(shown.at(-1)).toMatchObject({ projectId: A, running: { stage: "check", jobId: "job-1" }, stop: null })
  expect(shown).not.toContain(null)
})

test("没同意许可协议、也没有测试场的世界：停在「要先同意」，什么也不启动，也不替人同意", async () => {
  const { deps, started, shown } = window()
  await advanceChain(chain({ ended: built }), null, deps)
  expect(started).toEqual([])
  expect(shown.at(-1)).toMatchObject({ projectId: A, running: null, stop: "eula" })
})

test("在「要先同意」那里选「不同意，直接打开游戏」：照旧打开，不做后台检查", async () => {
  const { deps, started, shown } = window()
  await advanceChain(chain({ ended: built, stop: null }), "open", deps)
  expect(started).toEqual([{ projectId: A, stage: "play", jobId: BUILD }])
  expect(shown.at(-1)).toMatchObject({ running: { stage: "play", jobId: "job-1" }, stop: null })
  // The game opens on its main menu with nothing set out: the window keeps saying how to see the things by hand, while it is open and after.
  expect(shown.at(-1)).toMatchObject({ bare: true })
})

test("有测试场的世界或同意了许可协议时，游戏不是空着打开的：不说「自己找」", async () => {
  const world = window({ world: true })
  await advanceChain(chain({ ended: built, stop: null }), null, world.deps)
  expect(world.shown.at(-1)).toMatchObject({ running: { stage: "play" } })
  expect(world.shown.at(-1)!.bare).toBeUndefined()
  const agreed = window({ eula: true })
  await advanceChain(chain({ ended: built, stop: null }), null, agreed.deps)
  expect(agreed.shown.at(-1)!.bare).toBeUndefined()
})

test("在「要先同意」那里点同意：重新读到已同意，接着做后台检查，检查完再打开游戏", async () => {
  let agreed = false
  const { deps, started, shown } = window({ readScene: async () => ({ eula: agreed, world: false, record: null }) as unknown as SceneInfo })
  await advanceChain(chain({ ended: built }), null, deps)
  const stopped = shown.at(-1)!
  expect(stopped.stop).toBe("eula")
  // The person's click on the agree button: the licence is written, then the same chain goes on.
  agreed = true
  await advanceChain({ ...stopped, stop: null }, null, deps)
  expect(started).toEqual([{ projectId: A, stage: "check", jobId: BUILD }])
  const checking = shown.at(-1)!
  await advanceChain({ ...checking, running: null, marks: { ...checking.marks, check: "completed" }, ended: { stage: "check", state: "completed" } }, null, deps)
  expect(started.at(-1)).toEqual({ projectId: A, stage: "play", jobId: BUILD })
})

test("没同意，但这一次打包的测试场世界已经在：直接打开它；世界是别的打包留下的就不算", async () => {
  const same = window({ world: true })
  await advanceChain(chain({ ended: built }), null, same.deps)
  expect(same.started).toEqual([{ projectId: A, stage: "play", jobId: BUILD }])
  // A play of another build deploys afresh and clears the world, so it would land on the main menu all the same.
  const other = window({ world: true, buildId: "22222222-2222-4222-8222-222222222222" })
  await advanceChain(chain({ ended: built }), null, other.deps)
  expect(other.started).toEqual([])
  expect(other.shown.at(-1)).toMatchObject({ stop: "eula" })
})

test("同意过许可协议的话，打包完先为原工程启动后台检查，检查完再打开游戏", async () => {
  const { deps, started, shown } = window({ eula: true })
  await advanceChain(chain({ ended: built }), null, deps)
  expect(started).toEqual([{ projectId: A, stage: "check", jobId: BUILD }])
  const checking = shown.at(-1)!
  expect(checking.running).toEqual({ stage: "check", jobId: "job-1" })
  await advanceChain({ ...checking, running: null, marks: { ...checking.marks, check: "completed" }, ended: { stage: "check", state: "completed" } }, null, deps)
  expect(started.at(-1)).toEqual({ projectId: A, stage: "play", jobId: BUILD })
})

test("只要 jar 的人，在别的工程里打包完，也只是停在「打包好了」，不开游戏", async () => {
  const { deps, started, shown } = window()
  await advanceChain(chain({ want: "jar", ended: built }), null, deps)
  expect(started).toEqual([])
  expect(shown.at(-1)).toMatchObject({ projectId: A, stop: "built" })
})

test("原工程已经被删掉：链条放下，什么也不启动", async () => {
  const { deps, started, shown } = window({ builds: { [B]: null } })
  await advanceChain(chain({ ended: built }), null, deps)
  expect(started).toEqual([])
  expect(shown).toEqual([null])
})

test("别的事还在做：不抢着启动，停在「上一件事还没做完」，仍属于原工程", async () => {
  const { deps, started, shown } = window({ blocked: () => true, eula: true })
  await advanceChain(chain({ ended: built }), null, deps)
  expect(started).toEqual([])
  expect(shown.at(-1)).toMatchObject({ projectId: A, stop: "busy" })
})

test("启动被拒绝：说成这一步没做成，带着拒绝的那句话停下", async () => {
  const { deps, shown } = window({ start: async () => undefined, error: () => "被拒绝了" })
  // Opened anyway (no licence): the play itself is what was refused.
  await advanceChain(chain({ ended: built }), "open", deps)
  expect(shown.at(-1)).toMatchObject({ projectId: A, stop: "play_failed", error: "被拒绝了" })
})

test("AI 还在做东西、这个工程还没有可用的打包：停在「还在做」，什么也不打包；选先打包现有的才打包", async () => {
  const none = { builds: { [A]: null, [B]: null }, making: 3 }
  const first = window(none)
  await advanceChain(chain(), null, first.deps)
  expect(first.started).toEqual([])
  expect(first.shown.at(-1)).toMatchObject({ projectId: A, running: null, stop: "making", making: 3 })
  // 「先打包现在有的」: the build starts, and the question is not asked again.
  await advanceChain({ ...first.shown.at(-1)!, stop: null }, "now", first.deps)
  expect(first.started).toEqual([{ projectId: A, stage: "build", jobId: "" }])
  // 「先不打包，我晚点再按」: nothing starts, now or later by itself.
  const waits = window(none)
  await advanceChain(chain(), "leave", waits.deps)
  expect(waits.started).toEqual([])
  expect(waits.shown.at(-1)).toMatchObject({ stop: "waits" })
})

test("已经有这个工程现在这个样子的打包：AI 还在做东西也不拦，试玩用的就是那份打包", async () => {
  const { deps, started } = window({ eula: true, making: 3 })
  await advanceChain(chain(), null, deps)
  expect(started).toEqual([{ projectId: A, stage: "check", jobId: BUILD }])
})

test("打包完工程又改了：停在「打包已过时」，带着还在做的数；人的一次点击就重新打包", async () => {
  // The build ended well, but a save made meanwhile left no build of the project as it is; the AI is still at it.
  const stale = window({ builds: { [A]: null, [B]: null }, making: 2 })
  await advanceChain(chain({ ended: built }), null, stale.deps)
  expect(stale.started).toEqual([])
  expect(stale.shown.at(-1)).toMatchObject({ stop: "build_stale", making: 2 })
  // Nothing is being made any more: the stop says only that, and the next press (a fresh chain, as the button starts) packs again.
  const quiet = window({ builds: { [A]: null, [B]: null } })
  await advanceChain(chain({ ended: built }), null, quiet.deps)
  expect(quiet.shown.at(-1)).toMatchObject({ stop: "build_stale", making: 0 })
  await advanceChain(chain(), null, quiet.deps)
  expect(quiet.started).toEqual([{ projectId: A, stage: "build", jobId: "" }])
})

test("AI 在做了多少读不出来：不拦着人，照常打包", async () => {
  const { deps, started } = window({ builds: { [A]: null, [B]: null }, readMaking: async () => Promise.reject(new Error("读不出来")) })
  await advanceChain(chain(), null, deps)
  expect(started).toEqual([{ projectId: A, stage: "build", jobId: "" }])
})

test("打包的时候工程被存了新内容、作业因此失败：停在同一个「打包已过时」，带着还在做的数，什么也不启动；点一下重新打包", async () => {
  const failedStale = { stage: "build" as const, state: "failed" as const, stale: true }
  const busy = window({ builds: { [A]: null, [B]: null }, making: 2 })
  await advanceChain(chain({ ended: failedStale, error: "工程已在构建后修改。请重新构建当前版本，再导出或试玩。", marks: { build: "failed" } }), null, busy.deps)
  expect(busy.started).toEqual([])
  expect(busy.shown.at(-1)).toMatchObject({ stop: "build_stale", making: 2, ended: failedStale })
  // The AI is not making anything any more: the same stop, without a count.
  const quiet = window({ builds: { [A]: null, [B]: null } })
  await advanceChain(chain({ ended: failedStale }), null, quiet.deps)
  expect(quiet.shown.at(-1)).toMatchObject({ stop: "build_stale", making: 0 })
  // An ordinary failure of the same stage is still the ordinary stop, whatever its sentence says.
  await advanceChain(chain({ ended: { stage: "build", state: "failed" }, error: "工程已在构建后修改。请重新构建当前版本，再导出或试玩。" }), null, quiet.deps)
  expect(quiet.shown.at(-1)).toMatchObject({ stop: "build_failed" })
})
