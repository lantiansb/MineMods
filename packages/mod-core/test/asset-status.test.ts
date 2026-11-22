import { expect, test } from "bun:test"
import { ASSET_STATUS_LABELS, deriveAssetStatus, type AssetStatusInput } from "../src/asset-status"
import { validateBlueprint } from "../src/blueprint"
import { RunTaskSchema } from "../src/workspace-runs"
import { VerificationRecordSchema } from "../src/verification"

const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`
const time = (minute: number) => `2026-10-01T00:${String(minute).padStart(2, "0")}:00.000Z`
const blueprint = validateBlueprint({
  revision: 1, request: "做几样东西", state: "confirmed", style: { palette: [], shape: "", naming: "", world: "" }, questions: [],
  entries: [
    { key: "box", kind: "block", title: "秘匣", brief: "盲盒", owner: null, needs: [], asset_id: id(1), out_of_scope: null },
    { key: "dew", kind: "item", title: "月露", brief: "材料", owner: null, needs: [], asset_id: null, out_of_scope: null },
    { key: "flight", kind: "logic", title: "飞行", brief: "骑着飞", owner: null, needs: [], asset_id: null, out_of_scope: "目前做不了骑乘" },
  ],
}, "fabric-1.21.1")
const task = (assetId: string, state: string, extra: Record<string, unknown> = {}) => RunTaskSchema.parse({
  key: "task", module: "block", title: "任务", prompt: "做", source: "做", dependencies: [], target_id: null, id: crypto.randomUUID(), asset_id: assetId,
  state, detail: "细节", error: null, started_at: null, finished_at: null, ...extra,
})
const run = (state: string, minute: number, tasks: ReturnType<typeof task>[]) => ({ state, created_at: time(minute), tasks }) as AssetStatusInput["runs"][number]
const base: AssetStatusInput = { blueprint, assets: [{ id: id(1), revision: 3 }], runs: [], build: null, verification: null }
const verification = (cases: unknown[]) => VerificationRecordSchema.parse({ schema_version: 1, build_id: id(9), updated_at: time(0), cases })
const check = (kind: string, passed: boolean, name = kind) => ({ id: name, asset_ids: [id(1)], kind, passed, detail: "" })
const status = (input: Partial<AssetStatusInput>) => deriveAssetStatus({ ...base, ...input })

test("every state has a plain Chinese label", () => {
  expect(ASSET_STATUS_LABELS).toEqual({
    planned: "还没做", making: "正在做", review: "等你验收", redo: "要重做", saved: "做好了", built: "已做进模组", verified: "游戏自动查过了", failed: "没做成", out_of_scope: "这次不做",
  })
})

test("planned, out of scope and saved come from the blueprint and the workspace alone", () => {
  const result = status({})
  expect(result.entries.dew).toEqual({ status: "planned", reason: null, facts: { saved: false, built: false, gametest: "none", client: "none", accepted: null, asked: false } })
  expect(result.entries.flight).toMatchObject({ status: "out_of_scope", reason: "目前做不了骑乘" })
  expect(result.entries.box!.status).toBe("saved")
  expect(result.assets[id(1)]!.status).toBe("saved")
  // A linked asset that no longer exists is simply planned again.
  expect(status({ assets: [] }).entries.box!.status).toBe("planned")
})

test("making needs a live run; a run waiting for an answer or already ended does not count", () => {
  const making = ["queued", "running", "validating", "saving"]
  making.forEach((state) => expect(status({ runs: [run("running", 1, [task(id(1), state)])] }).assets[id(1)]!.status).toBe("making"))
  expect(status({ runs: [run("awaiting_input", 1, [task(id(1), "queued")])] }).assets[id(1)]!.status).toBe("saved")
  expect(status({ runs: [run("canceled", 1, [task(id(1), "canceled")])] }).assets[id(1)]!.status).toBe("saved")
  // A task made from an entry counts for that entry before any asset exists.
  expect(status({ runs: [run("running", 1, [task(id(5), "running", { source: "blueprint:dew" })])] }).entries.dew!.status).toBe("making")
  expect(status({ review: [id(1)], runs: [run("running", 1, [task(id(1), "running")])] }).assets[id(1)]!.status).toBe("review")
})

test("failed means the latest task failed and keeps the reason; a later success clears it", () => {
  const failed = run("failed", 1, [task(id(1), "failed", { error: "模型需要细化" })])
  expect(status({ runs: [failed] }).assets[id(1)]).toMatchObject({ status: "failed", reason: "模型需要细化" })
  expect(status({ runs: [failed] }).entries.box).toMatchObject({ status: "failed", reason: "模型需要细化" })
  expect(status({ runs: [run("partial", 1, [task(id(1), "blocked", { detail: "依赖任务未完成，已阻塞。" })])] }).assets[id(1)]).toMatchObject({ status: "failed", reason: "依赖任务未完成，已阻塞。" })
  // Runs arrive in any order; creation time decides which task is the latest.
  expect(status({ runs: [run("completed", 2, [task(id(1), "completed")]), failed] }).assets[id(1)]!.status).toBe("saved")
  expect(status({ runs: [run("completed", 0, [task(id(1), "completed")]), failed] }).assets[id(1)]!.status).toBe("failed")
})

test("built requires the current revision in the latest successful build", () => {
  expect(status({ build: { id: id(9), assets: [{ id: id(1), revision: 3 }] } }).assets[id(1)]).toMatchObject({ status: "built", facts: { saved: true, built: true } })
  expect(status({ build: { id: id(9), assets: [{ id: id(1), revision: 2 }] } }).assets[id(1)]).toMatchObject({ status: "saved", facts: { built: false } })
  expect(status({ build: { id: id(9), assets: [] } }).assets[id(1)]!.status).toBe("saved")
})

test("verified needs checks recorded for that build, all passing, and keeps gametest and client apart", () => {
  const build = { id: id(9), assets: [{ id: id(1), revision: 3 }] }
  expect(status({ build, verification: verification([]) }).assets[id(1)]!.status).toBe("built")
  expect(status({ build, verification: verification([check("gametest", true)]) }).assets[id(1)]).toMatchObject({ status: "verified", facts: { gametest: "passed", client: "none" } })
  expect(status({ build, verification: verification([check("gametest", true), check("client", false)]) }).assets[id(1)]).toMatchObject({ status: "built", facts: { gametest: "passed", client: "failed" } })
  expect(status({ build, verification: verification([check("gametest", true), check("gametest", false, "second")]) }).assets[id(1)]!.facts.gametest).toBe("failed")
  expect(status({ build, verification: verification([check("gametest", true), check("client", true)]) }).entries.box).toMatchObject({ status: "verified", facts: { gametest: "passed", client: "passed" } })
  // Checks from another build, or for a revision that was edited since, prove nothing about this one.
  expect(status({ build: { ...build, id: id(8) }, verification: verification([check("gametest", true)]) }).assets[id(1)]).toMatchObject({ status: "built", facts: { gametest: "none" } })
  expect(status({ build: { id: id(9), assets: [{ id: id(1), revision: 2 }] }, verification: verification([check("gametest", true)]) }).assets[id(1)]!.status).toBe("saved")
})

test("packed and accepted are independent: a version that asked for an answer keeps waiting after a build, until it gets one", () => {
  const build = { id: id(9), assets: [{ id: id(1), revision: 3 }] }
  const made = [run("completed", 5, [task(id(1), "completed", { source: "blueprint:box", finished_at: time(10) })])]
  const asset = { id: id(1), revision: 3, updated_at: time(9) }
  const verdict = (value: string) => ({ asset_id: id(1), revision: 3, verdict: value, note: "", at: time(30) }) as never
  const waiting = status({ assets: [asset], runs: made, reviews: [], build })
  expect(waiting.assets[id(1)]).toMatchObject({ status: "review", facts: { built: true, asked: true, accepted: null } })
  // The checks of the game do not answer for the person either.
  expect(status({ assets: [asset], runs: made, reviews: [], build, verification: verification([check("gametest", true)]) }).assets[id(1)]!.status).toBe("review")
  expect(status({ assets: [asset], runs: made, reviews: [verdict("accepted")], build }).assets[id(1)]).toMatchObject({ status: "built", facts: { accepted: true } })
  expect(status({ assets: [asset], runs: made, reviews: [verdict("rejected")], build }).assets[id(1)]!.status).toBe("redo")
  // Nothing asked for an answer (made by hand): packing it needs none.
  expect(status({ assets: [asset], runs: [], reviews: [], build }).assets[id(1)]).toMatchObject({ status: "built", facts: { asked: false } })
})
