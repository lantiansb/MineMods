import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { EXPORT_WORDS, exportButton } from "../src/renderer/play-chain"
import { advanceChain, type Chain, type ChainDeps } from "../src/renderer/play-chain-run"
import type { SceneInfo } from "../src/renderer/features/test-scene"

const A = "00000000-0000-4000-8000-00000000000a"
const BUILD = "11111111-1111-4111-8111-111111111111"
const idle = { busy: false, running: "none", hasPack: true, pressing: false, savingAfterPack: false } as const

/** A window whose eula is agreed and whose test world exists: the case where a play press WOULD go on to check and open the game. */
function window(builds: { [project: string]: string | null }) {
  const started: { stage: string; jobId: string }[] = []
  const shown: Chain[] = []
  const deps: ChainDeps = {
    readScene: async () => ({ eula: true, world: true, record: { build_id: BUILD, missing: [] } }) as unknown as SceneInfo,
    latestBuildJobId: async (projectId) => builds[projectId] ?? null,
    readMaking: async () => 0,
    ready: async () => ({ build: true, check: true, play: true }),
    blocked: () => false,
    start: async (_project, stage, jobId) => (started.push({ stage, jobId }), { jobId: `job-${started.length}` }),
    error: () => "",
    show: (next) => void (next && shown.push(next)),
  }
  return { deps, started, shown }
}
const press: Chain = { projectId: A, want: "jar", running: null, marks: {}, ended: null, stop: null, error: "", lines: [], findings: 0, missing: [], making: 0 }

test("导出不打开游戏、不跑后台检查：已经有一致的打包时，什么任务也不启动，直接停在「打包好了」", async () => {
  const { deps, started, shown } = window({ [A]: BUILD })
  await advanceChain(press, null, deps)
  expect(started).toEqual([])
  expect(shown.at(-1)).toMatchObject({ stop: "built", build: BUILD })
})

test("没有现成的打包：先打包，打完就停在「打包好了」，检查和游戏都不会跟着开", async () => {
  const none = window({ [A]: null })
  await advanceChain(press, null, none.deps)
  expect(none.started).toEqual([{ stage: "build", jobId: "" }])
  // The build ends well, and the project now has its pack: the press stops there, with the pack to save.
  const done = window({ [A]: BUILD })
  await advanceChain({ ...press, running: null, ended: { stage: "build", state: "completed" } }, null, done.deps)
  expect(done.started).toEqual([])
  expect(done.shown.at(-1)).toMatchObject({ stop: "built", build: BUILD })
})

test("游戏开着的时候，有打包就能导出，没有按钮变灰的理由", () => {
  expect(exportButton({ ...idle, running: "other" })).toEqual({ off: false, why: "" })
  expect(exportButton({ ...idle, running: "other", pressing: true })).toEqual({ off: false, why: "" })
  expect(exportButton(idle)).toEqual({ off: false, why: "" })
})

test("只有真有原因才变灰，并且把原因说出来：正在写打包文件；没有打包而游戏开着没法打", () => {
  expect(exportButton({ ...idle, running: "build" })).toEqual({ off: true, why: EXPORT_WORDS.packing })
  expect(exportButton({ ...idle, running: "build", hasPack: false, savingAfterPack: true })).toEqual({ off: true, why: EXPORT_WORDS.packingThenSave })
  expect(exportButton({ ...idle, running: "other", hasPack: false })).toEqual({ off: true, why: EXPORT_WORDS.needsPack })
  // Nothing is running and there is no pack: the button packs, then saves.
  expect(exportButton({ ...idle, hasPack: false })).toEqual({ off: false, why: "" })
  // A press on its way to a pack shows its own progress; a request in flight is simply waited for.
  expect(exportButton({ ...idle, hasPack: false, pressing: true })).toEqual({ off: true, why: "" })
  expect(exportButton({ ...idle, busy: true })).toEqual({ off: true, why: "" })
})

test("给人看的字不再说旧的「游戏开着也不能导出」，也没有英文标识符", () => {
  for (const words of Object.values(EXPORT_WORDS)) expect(words).not.toMatch(/disabled|jobId|build_|[a-z]{4,}/)
  expect(EXPORT_WORDS.needsPack).not.toContain("先关")
})

test("导出按钮在「试玩」那一排里，和游戏开没开无关；不再藏在最下面的「导出与分享」里", () => {
  const source = readFileSync(path.join(import.meta.dir, "../src/renderer/studio-app.tsx"), "utf8")
  const button = source.indexOf("EXPORT_WORDS.button")
  expect(button).toBeGreaterThan(source.indexOf("CHAIN_WORDS.jar}"))
  expect(button).toBeLessThan(source.indexOf("开发环境试玩"))
  const share = source.slice(source.indexOf("<h3>导出与分享</h3>"))
  expect(share).not.toContain("window.studio.exportJar")
  // The export uses no game or check: it only saves a pack, or makes one with the pack-only press.
  const fn = source.slice(source.indexOf("function exportJarNow"), source.indexOf("createEffect", source.indexOf("function exportJarNow")))
  expect(fn).toContain('playNow("jar")')
  expect(fn).not.toMatch(/startScene|startPlaytest|playNow\("play"\)|playNow\(\)/)
})
