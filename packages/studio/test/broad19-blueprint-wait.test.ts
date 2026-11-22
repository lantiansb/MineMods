import * as bun from "bun:test"
import { afterEach, expect, test } from "bun:test"
import { untilObserved } from "./observed"
import { mkdtemp, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import os from "node:os"
import path from "node:path"
import type { BlueprintPlan } from "@minemods/mod-core/blueprint"
import { createStudioService, publicError } from "../src/main/service"
import { dispatchExternal, externalError } from "../src/main/external-dispatch"
import { BLUEPRINT_WAIT_LIMITS, ExternalAwaitBlueprintDecisionInputSchema } from "../src/external"
import { MCP_TOOLS } from "../src/main/mcp-handoff"
import { everythingToRead } from "./handoff-reading"
import { DECISION_WORDS } from "../src/main/blueprint-service"
import { PAPER, played } from "./playable-fixture"

// Broad19: after pressing 确认蓝图 both simulated users had to go back to the outside AI and say 「开始做」. An AI still in its turn waits in `await_blueprint_decision`
// and starts by itself; Studio knows whether one is waiting, and the page says the truth about it.

// The runtime has it; the installed type declarations do not list it yet.
const setSystemTime = (bun as unknown as { setSystemTime: (date?: Date) => void }).setSystemTime

type Service = Awaited<ReturnType<typeof createStudioService>>
const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const directories: string[] = []
const services: Service[] = []
afterEach(async () => {
  setSystemTime()
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function external() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-broad19-wait-"))
  directories.push(directory)
  const service = await createStudioService({ workspaceDirectory: path.join(directory, "projects"), runtimeDirectory: path.join(directory, "runtime"), templateDirectory: TEMPLATE, ai: { mode: "mcp", review: true } })
  services.push(service)
  const created = await service.createProject({ name: "等蓝图", description: "", modId: "waitplan", empty: true })
  const projectId = created.project.id
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  const refused = (method: string, input: unknown) => call(method, input).then(() => "accepted", publicError)
  return { service, projectId, call, refused }
}

const style = { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" }
const entry = (key: string, kind: string, extra: Record<string, unknown> = {}) =>
  ({ key, kind, title: `${key} 标题`, brief: `做一个 ${key}`, owner: null, needs: [], out_of_scope: null, ...extra }) as BlueprintPlan["entries"][number]
const plan = (entries: BlueprintPlan["entries"]): BlueprintPlan => played({ style, entries, questions: [] })
type Waited = { waiting: boolean; decision?: string; ask_person_back?: boolean; how: string; edited_entries?: string[]; requirements_changed?: string[]; revision?: number }

async function proposed(call: Awaited<ReturnType<typeof external>>["call"], projectId: string, request = "做两块宝石") {
  return (await call("proposeBlueprint", { projectId, request, blueprint: plan([entry("gem", "item"), entry("ruby", "item")]), paper_play: PAPER })) as unknown as { blueprint: { revision: number; entries: { key: string; title: string }[] }; next_step: string }
}
// What the person's own edit sends back: the stored plan as a draft (no revision, state or asset links), with one entry's title changed.
const retitled = (stored: { revision: number; state: string; entries: { key: string; asset_id?: unknown }[] }, key: string, title: string) => {
  const { revision: _revision, state: _state, ...rest } = stored
  return { ...rest, entries: stored.entries.map(({ asset_id: _asset, ...value }) => (value.key === key ? { ...value, title } : value)) } as never
}
const stateOf = async (service: Service, projectId: string) => (await service.getProjectOverview({ projectId })).blueprint_wait?.ai

test("等不到决定就说还在等，再调用一次接着等；页面从这时起说「AI 已经在等」", async () => {
  const { service, projectId, call } = await external()
  const draft = await proposed(call, projectId)
  // Nobody has waited yet: the page must not claim the AI is waiting.
  expect(await stateOf(service, projectId)).toBeUndefined()
  const first = (await call("awaitBlueprintDecision", { projectId, revision: draft.blueprint.revision, wait_seconds: 0 })) as unknown as Waited
  expect(first).toMatchObject({ waiting: true, how: DECISION_WORDS.waiting })
  expect(first.ask_person_back).toBeUndefined()
  expect(await stateOf(service, projectId)).toBe("waiting")
  // A call that is held counts too, at the moment it is held.
  const held = call("awaitBlueprintDecision", { projectId, revision: draft.blueprint.revision, wait_seconds: 1 })
  expect(await stateOf(service, projectId)).toBe("waiting")
  expect(await held).toMatchObject({ waiting: true })
})

test("人在 Studio 里确认：正在等的那一次调用马上返回 confirmed，页面改说「AI 已经收到你的确认」", async () => {
  const { service, projectId, call } = await external()
  const draft = await proposed(call, projectId)
  const done = { value: false }
  const held = (call("awaitBlueprintDecision", { projectId, revision: draft.blueprint.revision, wait_seconds: 20 }) as Promise<Waited>).finally(() => { done.value = true })
  expect(await untilObserved(() => stateOf(service, projectId), (state) => state === "waiting" || done.value)).toBe("waiting")
  expect(done.value).toBe(false)
  const started = Date.now()
  await service.confirmBlueprint({ projectId, revision: draft.blueprint.revision })
  const answer = await held
  expect(answer).toMatchObject({ waiting: false, decision: "confirmed", revision: draft.blueprint.revision, how: DECISION_WORDS.confirmed })
  // It came back as soon as the person confirmed, not at the end of the window.
  expect(Date.now() - started).toBeLessThan(5000)
  expect(answer.how).toContain("next_batch")
  expect(await stateOf(service, projectId)).toBe("told")
  // The AI goes on with the batch, with nothing the person had to say.
  expect(await call("nextBatch", { projectId })).toMatchObject({ run: expect.anything() })
}, 120_000)

test("人先确认、AI 才来等：第一次调用就返回 confirmed", async () => {
  const { service, projectId, call } = await external()
  const draft = await proposed(call, projectId)
  await service.confirmBlueprint({ projectId, revision: draft.blueprint.revision })
  expect(await call("awaitBlueprintDecision", { projectId, revision: draft.blueprint.revision, wait_seconds: 0 })).toMatchObject({ waiting: false, decision: "confirmed" })
})

test("人改了蓝图里的条目：马上返回 changed，写明改了哪一样；之后用新的 revision 接着等", async () => {
  const { service, projectId, call } = await external()
  const draft = await proposed(call, projectId)
  await call("awaitBlueprintDecision", { projectId, revision: draft.blueprint.revision, wait_seconds: 0 })
  const stored = (await service.getBlueprint({ projectId }))!
  await service.saveBlueprint({ projectId, revision: stored.revision, blueprint: retitled(stored, "gem", "亮晶晶的宝石") })
  const changed = (await call("awaitBlueprintDecision", { projectId, revision: draft.blueprint.revision, wait_seconds: 0 })) as unknown as Waited
  expect(changed).toMatchObject({ waiting: false, decision: "changed", edited_entries: ["亮晶晶的宝石"], how: DECISION_WORDS.changed })
  expect(changed.revision).toBeGreaterThan(draft.blueprint.revision)
  // Handled: asked again from the new revision, it waits, and the page still sees an AI that waits.
  expect(await call("awaitBlueprintDecision", { projectId, revision: changed.revision, wait_seconds: 0 })).toMatchObject({ waiting: true })
  expect(await stateOf(service, projectId)).toBe("waiting")
})

test("人改了蓝图要守的要求（不动条目）：也算 changed，并说出改了什么", async () => {
  const { service, projectId, call } = await external()
  const draft = await proposed(call, projectId)
  await call("awaitBlueprintDecision", { projectId, revision: draft.blueprint.revision, wait_seconds: 0 })
  const before = (await service.getBlueprint({ projectId }))!
  const ideas = (await call("getIdeas", { projectId })) as unknown as { ideas: { revision: number } }
  await service.chooseIdeas({ projectId, revision: ideas.ideas.revision, add: "只能是普通物品" })
  const after = (await service.getBlueprint({ projectId }))!
  expect(JSON.stringify(after.constraints)).not.toBe(JSON.stringify(before.constraints))
  const changed = (await call("awaitBlueprintDecision", { projectId, wait_seconds: 0 })) as unknown as Waited
  expect(changed).toMatchObject({ waiting: false, decision: "changed" })
  expect(changed.requirements_changed?.join("")).toContain("只能是普通物品")
})

test("人确认前改过条目：confirmed 里带着他动过的条目，next_batch 按他确认的这一版", async () => {
  const { service, projectId, call } = await external()
  const draft = await proposed(call, projectId)
  await call("awaitBlueprintDecision", { projectId, revision: draft.blueprint.revision, wait_seconds: 0 })
  const stored = (await service.getBlueprint({ projectId }))!
  const saved = await service.saveBlueprint({ projectId, revision: stored.revision, blueprint: retitled(stored, "ruby", "红宝石") })
  await service.confirmBlueprint({ projectId, revision: saved.revision })
  // The AI was away in between, so this call starts from the stored plan and sees only that it is confirmed.
  const answer = (await call("awaitBlueprintDecision", { projectId, revision: draft.blueprint.revision, wait_seconds: 0 })) as unknown as Waited
  expect(answer).toMatchObject({ waiting: false, decision: "confirmed", revision: saved.revision })
})

test("人把蓝图丢掉：discarded，不要再提交原来的", async () => {
  const { service, projectId, call } = await external()
  const draft = await proposed(call, projectId)
  await call("awaitBlueprintDecision", { projectId, revision: draft.blueprint.revision, wait_seconds: 0 })
  await service.discardBlueprint({ projectId })
  expect(await call("awaitBlueprintDecision", { projectId, revision: draft.blueprint.revision, wait_seconds: 0 })).toMatchObject({ waiting: false, decision: "discarded", how: DECISION_WORDS.discarded })
})

test("没有蓝图又没说是哪一版：说清楚先交蓝图，不假装在等", async () => {
  const { projectId, refused } = await external()
  expect(await refused("awaitBlueprintDecision", { projectId, wait_seconds: 0 })).toContain("还没有蓝图")
})

test("等了很久（连续约十分钟）人还没决定：叫 AI 把这件事交还给人，页面改回让人去告诉 AI", async () => {
  const { service, projectId, call } = await external()
  const draft = await proposed(call, projectId)
  const start = Date.now()
  const answers: Waited[] = []
  // One call about every 30 s, the way a client that gets "still waiting" calls again.
  for (let at = 0; at <= BLUEPRINT_WAIT_LIMITS.patience + 30; at += 30) {
    setSystemTime(new Date(start + at * 1000))
    answers.push((await call("awaitBlueprintDecision", { projectId, revision: draft.blueprint.revision, wait_seconds: 0 })) as unknown as Waited)
    if (answers.at(-1)!.ask_person_back) break
  }
  const last = answers.at(-1)!
  expect(last).toMatchObject({ waiting: true, ask_person_back: true, how: DECISION_WORDS.gave_up })
  expect(answers.slice(0, -1).every((answer) => answer.waiting && !answer.ask_person_back)).toBe(true)
  // Only after the patience was spent, not before.
  expect(answers.length).toBeGreaterThan(Math.floor(BLUEPRINT_WAIT_LIMITS.patience / 30) - 1)
  expect(await stateOf(service, projectId)).toBe("none")
})

test("AI 走开了：最后一次调用过去很久，页面不再说它在等；确认以后太久没动静也不说它在开始", async () => {
  const { service, projectId, call } = await external()
  const draft = await proposed(call, projectId)
  const start = Date.now()
  await call("awaitBlueprintDecision", { projectId, revision: draft.blueprint.revision, wait_seconds: 0 })
  expect(await stateOf(service, projectId)).toBe("waiting")
  setSystemTime(new Date(start + (BLUEPRINT_WAIT_LIMITS.gap + 5) * 1000))
  expect(await stateOf(service, projectId)).toBe("none")
  // It came back and was told the person confirmed; it did not start within the time it should.
  await service.confirmBlueprint({ projectId, revision: draft.blueprint.revision })
  expect(await call("awaitBlueprintDecision", { projectId, revision: draft.blueprint.revision, wait_seconds: 0 })).toMatchObject({ decision: "confirmed" })
  expect(await stateOf(service, projectId)).toBe("told")
  setSystemTime(new Date(start + (BLUEPRINT_WAIT_LIMITS.gap + 5 + BLUEPRINT_WAIT_LIMITS.told + 5) * 1000))
  expect(await stateOf(service, projectId)).toBe("none")
})

test("工具、交接说明和 propose_blueprint 的下一步都让做的 AI 等在这一轮里，不叫人回来", async () => {
  const { projectId, call } = await external()
  const tool = MCP_TOOLS.find((value) => value[0] === "await_blueprint_decision")!
  expect(tool[1]).toContain("ask_person_back")
  expect(tool[1]).toContain("40 秒")
  expect(ExternalAwaitBlueprintDecisionInputSchema.safeParse({ projectId, wait_seconds: BLUEPRINT_WAIT_LIMITS.wait + 1 }).success).toBe(false)
  expect(ExternalAwaitBlueprintDecisionInputSchema.safeParse({ projectId, wait_seconds: BLUEPRINT_WAIT_LIMITS.wait }).success).toBe(true)
  const handoff = everythingToRead({ configuration: JSON.stringify({ mcpServers: { "minemods-studio": { command: "studio.exe", args: [] } } }) })
  expect(handoff).toContain("await_blueprint_decision")
  expect(handoff).toContain("不要先停下来问用户")
  const draft = await proposed(call, projectId)
  expect(draft.next_step).toContain("await_blueprint_decision")
  expect(draft.next_step).toContain(`revision 填 ${draft.blueprint.revision}`)
  expect(draft.next_step).not.toContain("请让用户在 MineMods Studio 里查看并确认")
})
