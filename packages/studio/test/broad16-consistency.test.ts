import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { openProject, saveProject } from "@minemods/mod-core/project"
import { WorkspaceAssetSchema, applyWorkspaceAsset } from "@minemods/mod-core/workspace"
import { blueprintPlannerInstructions, paperPlayInstructions } from "@minemods/mod-core/blueprint-planner"
import { CONSTRAINT_CHECK_INSTRUCTIONS, constraintCheckInstructions, PLAN_CHECK_WORDS } from "@minemods/mod-core/blueprint-constraints"
import { PAPER_PLAY_INSTRUCTIONS, PLAY_REFUSALS } from "@minemods/mod-core/playable"
import type { BlueprintPlan } from "@minemods/mod-core/blueprint"
import { createStudioService, dispatchStudioRequest, publicError } from "../src/main/service"
import { dispatchExternal, externalError } from "../src/main/external-dispatch"
import { MCP_INSPECTION, getMcpCapabilities } from "../src/main/mcp-capabilities"
import { everythingToRead } from "./handoff-reading"
import { toolActivity } from "../src/main/activity-tools"
import { leaked } from "../../mod-core/test/fixtures/acceptance/names"
import { PAPER, played } from "./playable-fixture"

const CONFIGURATION = JSON.stringify({ mcpServers: { "minemods-studio": { command: "minemods-studio", args: [] } } })

type Service = Awaited<ReturnType<typeof createStudioService>>

const directories: string[] = []
const services: Service[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function studio(ai: Record<string, unknown>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-broad16-"))
  directories.push(directory)
  const service = await createStudioService({ workspaceDirectory: path.join(directory, "projects"), runtimeDirectory: path.join(directory, "runtime"), templateDirectory: path.join(directory, "templates"), ai })
  services.push(service)
  return service
}

const target = "fabric-1.21.1"
const style = { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" }
const entry = (key: string, kind: string, extra: Record<string, unknown> = {}) =>
  ({ key, kind, title: `${key} 标题`, brief: `做一个 ${key}`, owner: null, needs: [], out_of_scope: null, ...extra }) as BlueprintPlan["entries"][number]
const plan = (entries: BlueprintPlan["entries"]): BlueprintPlan => played({ style, entries, questions: [] })

async function external(ai: Record<string, unknown>) {
  const service = await studio({ mode: "mcp", review:true, ...ai })
  const created = await service.createProject({ name: "一致性", description: "", modId: "consistent", empty: true })
  const projectId = created.project.id
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  const refused = (method: string, input: unknown) => call(method, input).then(() => "accepted", publicError)
  return { service, created, projectId, call, refused }
}

type Shown = {
  plan_checks: { reviewer: boolean; rule: string }
  planner: { instructions: string }
  playable: { paper_play: { instructions: string } }
  requirements: { check: { instructions: string } }
}

test("审查关着：蓝图的规划规则、核对说明、试玩说明都说自己核对；谎称有别的评审被退回，如实写 false 就收", async () => {
  const { projectId, call, refused } = await external({ review: false })
  const shown = (await call("getBlueprint", { projectId })) as unknown as Shown
  expect(shown.plan_checks.reviewer).toBe(false)
  expect(shown.plan_checks.rule).toBe(PLAN_CHECK_WORDS.self)
  expect(shown.planner.instructions).toBe(blueprintPlannerInstructions(target, "self"))
  expect(shown.playable.paper_play.instructions).toBe(paperPlayInstructions("self"))
  expect(shown.requirements.check.instructions).toBe(constraintCheckInstructions("self"))
  // None of the three still asks for somebody who did not take part in the plan.
  ;[shown.planner.instructions, shown.playable.paper_play.instructions, shown.requirements.check.instructions].forEach((text) => {
    expect(text).not.toContain("请一个没有参与规划的评审")
    expect(text).not.toContain("没参与规划的试玩员")
  })

  const good = { projectId, request: "做一块宝石", blueprint: plan([entry("gem", "item")]) }
  // Studio knows no one else can have read this plan, so the claim is refused with the reason and the fix.
  const lie = await refused("proposeBlueprint", { ...good, paper_play: PAPER })
  expect(lie).toContain("没有任何别的评审")
  expect(lie).toContain("改成 false")
  expect(await refused("proposeBlueprint", good)).toBe(PLAY_REFUSALS.unplayed_self)
  const honest = (await call("proposeBlueprint", { ...good, paper_play: { ...PAPER, independent: false } })) as { blueprint: { paper: { independent: boolean } }; next_step: string }
  expect(honest.blueprint.paper.independent).toBe(false)
  expect(honest.next_step).not.toContain("核实不了")
})

test("审查开着：说明和以前逐字相同；声称是没参与规划的评审做的，Studio 核实不了，所以留下说明并写进下一步", async () => {
  const { projectId, call } = await external({})
  const shown = (await call("getBlueprint", { projectId })) as unknown as Shown
  expect(shown.plan_checks.reviewer).toBe(true)
  expect(shown.planner.instructions).toBe(blueprintPlannerInstructions(target))
  expect(shown.playable.paper_play.instructions).toBe(PAPER_PLAY_INSTRUCTIONS)
  expect(shown.requirements.check.instructions).toBe(CONSTRAINT_CHECK_INSTRUCTIONS)
  const claimed = (await call("proposeBlueprint", { projectId, request: "做一块宝石", blueprint: plan([entry("gem", "item")]), paper_play: PAPER })) as { blueprint: { paper: { independent: boolean } }; next_step: string }
  expect(claimed.blueprint.paper.independent).toBe(true)
  expect(claimed.next_step).toContain("核实不了")
})

test("审查开关：活动里取验收材料那一句，关着时不再说去请评审；能力说明和交接文都按开关说", () => {
  const ask = (review: boolean) => toolActivity({ method: "finalReviewExternalTask", input: { projectId: "p", taskId: "t" }, result: {}, refused: null, ms: 1, run: null, review })!.text
  expect(ask(true)).toContain("去请评审看")
  expect(ask(false)).not.toContain("去请评审")
  expect(ask(false)).toContain("审查关着")

  const off = getMcpCapabilities("medium", { review: false })
  const on = getMcpCapabilities("medium", { review: true })
  expect(off.making.inspection.rule).toBe(MCP_INSPECTION.off)
  expect(on.making.inspection.rule).toBe(MCP_INSPECTION.on)
  expect(off.making.independent_review).not.toBe(on.making.independent_review)
  expect(JSON.stringify(off)).not.toContain("没有参与规划的评审")
  expect(leaked(JSON.stringify(off))).toEqual([])

  const handoff = everythingToRead({ configuration: CONFIGURATION, review: false })
  expect(handoff).toContain("independent 填 false")
  expect(handoff).not.toContain("再请一个只看得到要求和条目的评审逐条核对")
  expect(handoff).not.toContain("再请一个没参与规划的评审")
  expect(leaked(handoff)).toEqual([])
  expect(everythingToRead({ configuration: CONFIGURATION })).toContain("再请一个只看得到要求和条目的评审逐条核对")
})

const at = "2026-10-14T08:00:00.000Z"

test("已有内容：同名的新条目被退回并给出它的 id；声明 change 就放行，开工的任务直接改那一样，清单里不出现两样", async () => {
  const { service, created, projectId, call, refused } = await external({})
  const id = crypto.randomUUID()
  const moth = WorkspaceAssetSchema.parse({
    id, module: "item", title: "月屑", revision: 1, created_at: at, updated_at: at, prompt: "做一块月屑", dependencies: [],
    document: { kind: "item", identifier: "moon_shard", name: "月屑", max_stack: 64, color: "#99aacc", texture: null },
    provenance: { model: "gpt-6-astra", request_id: crypto.randomUUID() }, status: "ready",
  })
  const project = await openProject(created.directory)
  await saveProject(created.directory, applyWorkspaceAsset(project, moth), project.revision)

  const shown = (await call("getBlueprint", { projectId })) as unknown as { existing: { id: string; title: string }[] }
  expect(shown.existing.map((value) => value.id)).toEqual([id])

  const clash = await refused("proposeBlueprint", { projectId, request: "做月屑", blueprint: plan([entry("shard", "item", { title: "月屑" })]), paper_play: { ...PAPER, independent: true } })
  expect(clash).toContain(id)
  expect(clash).toContain(`action: "change"`)

  const changed = entry("shard", "item", { title: "月屑", existing: { id, action: "change" } })
  const proposed = (await call("proposeBlueprint", { projectId, request: "把月屑改亮一点", blueprint: plan([changed]), paper_play: PAPER })) as { blueprint: { revision: number } }
  expect((await service.getProjectOverview({ projectId })).items.filter((item) => item.title === "月屑")).toHaveLength(1)
  await dispatchStudioRequest(service, { method: "confirmBlueprint", input: { projectId, revision: proposed.blueprint.revision } } as never)
  await call("nextBatch", { projectId })
  const run = (await service.listProjectRuns({ projectId }))[0]!
  expect(run.tasks.map((task) => task.target_id)).toEqual([id])
})
