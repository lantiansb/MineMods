import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createProject, openProject } from "@minemods/mod-core/project"
import type { ModelComplexity } from "@minemods/studio-ai/model-quality"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { paintModel } from "@minemods/studio-ai/model-paint"
import { REFUSAL_CAP } from "@minemods/mod-core/acceptance"
import { createProjectRunner } from "../src/main/project-runner"
import { saveProject } from "@minemods/mod-core/project"
import slime from "../../studio-ai/test/fixtures/look/good/sprout-slime.json"

const directories: string[] = []
const runners: ReturnType<typeof createProjectRunner>[] = []
afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner.dispose()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const good = { kind: "model", ...slime.model }

function document(count: number) {
  return {
    kind: "model",
    name: "结构检查夹具",
    texture_size: 128,
    bones: [
      {
        name: "root",
        parent: null,
        pivot: [0, 0, 0],
        rotation: [0, 0, 0],
        cubes: Array.from({ length: count }, (_, index) => ({
          name: `part_${index}`,
          origin: [index * 4, 0, 0],
          size: [2 + (index % 3), 3, 2],
          faces: {
            north: "#77935B",
            east: "#786044",
            south: "#786044",
            west: "#786044",
            up: "#B3BD7C",
            down: "#4A3A2C",
          },
          surface_details: [],
        })),
      },
    ],
    animations: ["idle", "walk", "hurt"].map((name) => ({
      name,
      length: 1,
      loop: name !== "hurt",
      channels: [
        {
          bone: "root",
          keyframes: [
            { time: 0, rotation: [0, 0, 0] },
            { time: 0.5, rotation: [2, 0, 0] },
            { time: 1, rotation: [0, 0, 0] },
          ],
        },
      ],
    })),
  }
}

async function setup(prompt: string, complexity?: { value: ModelComplexity }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-quality-"))
  directories.push(directory)
  const project = await createProject({ directory, name: "模型质量验收", description: "" })
  const runner = createProjectRunner({ directoryFor: async () => directory, ai: {}, ...(complexity ? { getModelComplexity: async () => complexity.value } : {}) })
  runners.push(runner)
  const started = await runner.startExternal({
    projectId: project.id,
    expectedRevision: project.revision,
    prompt,
    plan: {
      summary: prompt,
      questions: [],
      tasks: [
        {
          key: "model",
          module: "model",
          title: "苔皮苦力怕",
          source: prompt,
          prompt: "保留原版造型",
          dependencies: [],
          target_id: null,
        },
      ],
    },
  })
  const input = { projectId: project.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
  return { directory, project, runner, input }
}

test("MCP 简陋模型保留草稿和修订机会，通过最低结构检查后才保存", async () => {
  const { directory, project, runner, input } = await setup("制作精美复杂的苔皮苦力怕，保留原版群系和地形")
  const context = await runner.claimExternalTask(input)
  // What the task will be held to is told up front, generated from the standard; nothing was made by an AI before, so there is nothing to compare with.
  expect(context.quality.standard).toContain("验收标准（模型）")
  expect(context.quality.existing).toBeNull()
  const progress = await runner.updateExternalTask({ ...input, progress: 70, draft: document(7) })
  expect(progress.drafts[input.taskId]?.quality?.passed).toBe(false)
  await expect(runner.commitExternalTask({ ...input, document: document(7) })).rejects.toThrow("模型没通过验收")
  expect((await openProject(directory)).revision).toBe(project.revision)
  expect((await runner.getExternalRun({ projectId: input.projectId, runId: input.runId })).tasks[0]?.state).toBe(
    "running",
  )
  const retry = await runner.getExternalProgress({ projectId: input.projectId, runId: input.runId })
  expect(retry.drafts[input.taskId]?.quality?.measured).toMatchObject({ cubes: 7 })
  expect(retry.run.tasks[0]?.detail).toContain("模型没通过验收")
  // More of the same cubes is refused as well: only a model that looks finished gets in.
  await expect(runner.commitExternalTask({ ...input, document: document(12) })).rejects.toThrow("模型没通过验收")
  const completed = await runner.commitExternalTask({ ...input, document: good })
  expect(completed.tasks[0]?.state).toBe("completed")
  expect((await openProject(directory)).workspace.assets[0]?.status).toBe("ready")
})

test("原始需求明确要求简单低模时不强制堆叠细节", async () => {
  const { directory, runner, input } = await setup("制作简单低模苦力怕")
  const context = await runner.claimExternalTask(input)
  expect(context.quality.complexity).toBeNull()
  const result = await runner.commitExternalTask({ ...input, document: document(7) })
  expect(result.state).toBe("completed")
  expect((await openProject(directory)).workspace.assets).toHaveLength(1)
})

test("MCP 任务使用开始时快照的复杂度并在 update 与 commit 共用该档位门槛", async () => {
  const complexity = { value: "high" as ModelComplexity }
  const { runner, input } = await setup("制作精细复杂生物", complexity)
  const context = await runner.claimExternalTask(input)
  expect(context.quality.complexity).toBe("high")
  complexity.value = "low"
  const progress = await runner.updateExternalTask({ ...input, progress: 70, draft: document(12) })
    expect(progress.drafts[input.taskId]?.quality?.passed).toBe(false)
  await expect(runner.commitExternalTask({ ...input, document: document(12) })).rejects.toThrow("模型没通过验收")
})

/** The model's own painted atlas as a palette texture: a texture that looks as good as the model does. */
function ownTexture() {
  const painted = paintModel(ModelDesignSchema.parse(slime.model))
  const colors = Array.from({ length: painted.size * painted.size }, (_, index) => `#${[0, 1, 2].map((channel) => painted.pixels[index * 4 + channel]!.toString(16).padStart(2, "0")).join("")}`)
  const palette = [...new Set(colors)]
  return { kind: "texture", width: painted.size, height: painted.size, palette, pixels: colors.map((color) => palette.indexOf(color)) }
}

async function pair(prompt: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-quality-"))
  directories.push(directory)
  const project = await createProject({ directory, name: "贴图质量验收", description: "" })
  const runner = createProjectRunner({ directoryFor: async () => directory, ai: {} })
  runners.push(runner)
  const task = (key: string, module: "model" | "texture", dependencies: string[]) => ({ key, module, title: key, source: prompt, prompt, dependencies, target_id: null })
  const started = await runner.startExternal({
    projectId: project.id,
    expectedRevision: project.revision,
    prompt,
    plan: { summary: prompt, questions: [], tasks: [task("model", "model", []), task("texture", "texture", ["model"])] },
  })
  const input = (index: number) => ({ projectId: project.id, runId: started.run.id, taskId: started.run.tasks[index]!.id })
  await runner.claimExternalTask(input(0))
  await runner.commitExternalTask({ ...input(0), document: good })
  await runner.claimExternalTask(input(1))
  return { directory, runner, input: input(1), modelId: started.run.tasks[0]!.asset_id }
}

const filler = { kind: "texture", width: 64, height: 64, palette: ["#1F4E79", "#3182A8", "#55C7D9"], pixels: Array.from({ length: 64 * 64 }, (_, index) => ((index % 64) + Math.floor(index / 64)) % 7 === 0 ? 2 : 1) }

test("MCP 贴图贴到它依赖的模型上验收：到处一个花纹的被退回并逐条说明，画好的才保存", async () => {
  const { directory, runner, input } = await pair("给发芽史莱姆画一张贴图")
  const before = (await openProject(directory)).revision
  const progress = await runner.updateExternalTask({ ...input, progress: 60, draft: filler })
  expect(progress.drafts[input.taskId]?.quality).toMatchObject({ kind: "texture", passed: false })
  // The pattern is refused for what is certain (one fill poured over every face, two colours, no light). Diagonal lines on one texel in seven and a head with no pair of eyes found are what the
  // measures cannot call a fault: advice beside the refusal, never a reason for it.
  expect(progress.drafts[input.taskId]?.quality?.findings.map((finding) => finding.rule)).not.toEqual(expect.arrayContaining(["noisy_texture"]))
  expect((progress.drafts[input.taskId]?.quality as { advice?: { rule: string }[] }).advice?.map((entry) => entry.rule)).toEqual(["noisy_texture", "no_face"])
  expect(progress.drafts[input.taskId]?.quality?.findings.map((finding) => finding.rule)).toEqual(expect.arrayContaining(["same_fill"]))
  const refusal = await runner.commitExternalTask({ ...input, document: filler }).catch((error: Error) => error.message)
  expect(refusal).toContain("贴图没通过验收")
  // Numbered, each line naming its criterion, what was found and what to change.
  expect(refusal).toMatch(/1\. 【(不机械|认得出|有主次)】.+怎么改：/)
  expect(refusal).toContain("drafts[taskId].quality.passed")
  expect(refusal).toContain("眼睛")
  expect(refusal).toContain(`还可以再交 ${REFUSAL_CAP - 1} 次`)
  expect(refusal).not.toMatch(/sameFill|speckShare|metrics|same_fill|noisy_texture/)
  expect((await openProject(directory)).revision).toBe(before)
  const completed = await runner.commitExternalTask({ ...input, document: ownTexture() })
  expect(completed.tasks[1]?.state).toBe("completed")
})

test("MCP 贴图反复过不了验收时同样几次之后记为没做成", async () => {
  const { runner, input } = await pair("给发芽史莱姆画一张贴图")
  for (let attempt = 1; attempt < REFUSAL_CAP; attempt++)
    await expect(runner.commitExternalTask({ ...input, document: filler })).rejects.toThrow("贴图没通过验收")
  await expect(runner.commitExternalTask({ ...input, document: filler })).rejects.toThrow(`贴图改了 ${REFUSAL_CAP} 次还是没通过验收`)
  expect((await runner.getExternalRun({ projectId: input.projectId, runId: input.runId })).tasks[1]?.state).toBe("failed")
})

test("重做 AI 做的模型照样完整验收；改人自己做的模型不拦", async () => {
  const { directory, runner, input, modelId } = await pair("给发芽史莱姆画一张贴图")
  await runner.commitExternalTask({ ...input, document: ownTexture() })
  const redo = async () => {
    const project = await openProject(directory)
    const started = await runner.startExternal({
      projectId: project.id,
      expectedRevision: project.revision,
      prompt: "把模型改一下",
      plan: { summary: "改模型", questions: [], tasks: [{ key: "model", module: "model", title: "模型", source: "把模型改一下", prompt: "把模型改一下", dependencies: [], target_id: modelId }] },
    })
    const again = { projectId: project.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
    await runner.claimExternalTask(again)
    return again
  }
  // An AI made the saved model, so handing in a placeholder as its "revision" is refused like any fresh work.
  const first = await redo()
  await expect(runner.commitExternalTask({ ...first, document: document(7) })).rejects.toThrow("模型没通过验收")
  await runner.failExternalTask({ ...first, error: "测试结束" })
  // The same asset once a person owns it (no AI behind it) and it does not pass: an edit of it is the person's business.
  const project = await openProject(directory)
  await saveProject(directory, { ...project, workspace: { assets: project.workspace.assets.map((asset) => (asset.id === modelId ? { ...asset, document: document(7) as never, provenance: { model: null, request_id: null } } : asset)) } }, project.revision)
  const second = await redo()
  expect((await runner.commitExternalTask({ ...second, document: document(8) })).tasks[0]?.state).toBe("completed")
})
