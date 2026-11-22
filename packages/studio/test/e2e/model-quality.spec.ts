import { test, expect, _electron } from "@playwright/test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mkdir, mkdtemp, readFile, rename, rmdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import type { getMcpCapabilities } from "../../src/main/mcp-capabilities"
import type { StudioView } from "../../src/api"
import type { ExternalProgress, ExternalStartResult, ExternalTaskContext } from "../../src/external"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { ToldReview } from "@minemods/mod-core/acceptance"
import type { ProjectRun } from "../../src/project-runs"
import { fixtureSheet, fixtureReview } from "./protocol-fixture"

type Complexity = "low" | "medium" | "high"
type ComplexitySettings = { modelComplexity: Complexity }
type ComplexityRun = ProjectRun & { model_complexity: Complexity }
type ComplexityTaskContext = ExternalTaskContext
// What the MCP boundary shows of a draft's review: the verdict in words (see `told`).
type ShownProgress = Omit<ExternalProgress, "drafts"> & { drafts: Record<string, Omit<ExternalProgress["drafts"][string], "quality"> & { quality?: ToldReview }> }

const complexityLabels: Record<Complexity, { title: string; description: string }> = {
  low: { title: "低", description: "简洁轮廓，保留关键结构" },
  medium: { title: "中", description: "完整层次，兼顾细节与速度" },
  high: { title: "高", description: "丰富结构，更充分的细节" },
}

test("后台实际工作室保留低质草稿，修订为 GPT Image 引导的精细模型并保存预览", async () => {
  await mkdir(path.resolve("../../.artifacts/studio"), { recursive: true })
  const directory = await mkdtemp(path.resolve("../../.artifacts/studio/model-quality-"))
  const settingsPath = path.join(directory, "projects", "studio-settings.json")
  const design = JSON.parse(
    // The showcase creeper repainted with materials and a face: its flat-colour original no longer passes the look check.
    await readFile(path.resolve("test/fixtures/model-quality/forest-creeper.painted.design.json"), "utf8"),
  ) as ModelDesign
  // The old specimen's long front/rear feet touched at rest. Leave a gap for their moving toes.
  for (const bone of design.bones.filter(bone => bone.name.startsWith("foot_"))) {
    const back = bone.name.includes("back")
    for (const cube of bone.cubes) {
      if (cube.size[2] === 6) {
        cube.size[2] = 3
        if (back) cube.origin[2] += 3
      }
      if (back && cube.size[2] === 2) cube.origin[2] += 5
    }
  }
  // Keep a genuine stride (>16 degrees peak-to-peak) while avoiding the original over-long steps.
  for (const animation of design.animations.filter(animation => animation.name === "walk" || animation.name === "hurt")) {
    for (const channel of animation.channels) for (const frame of channel.keyframes) {
      if (frame.rotation) frame.rotation = frame.rotation.map(value => value * 0.5) as [number, number, number]
    }
  }
  const app = await _electron.launch({
    executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE || path.resolve("node_modules/electron/dist/electron.exe"),
    args: [
      ...(process.env.STUDIO_PACKAGED_EXECUTABLE ? [] : [process.cwd()]),
      `--user-data-dir=${path.join(directory, "electron")}`,
    ],
    env: {
      ...process.env,
      OPENAI_API_KEY: "",
      OPENAI_BASE_URL: "",
      STUDIO_AI_URL: "",
      STUDIO_SERVICE_TOKEN: "",
      MINEMODS_STUDIO_TEST: "1",
      MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"),
      MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"),
    },
  })
  const client = new Client({ name: "model-quality-acceptance", version: "1.0.0" })
  const errors: string[] = []
  const page = await app.firstWindow()
  await page.emulateMedia({ reducedMotion: "reduce" })
  page.on("pageerror", (error) => errors.push(error.message))
  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const response = await client.callTool({ name, arguments: args })
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true)
    return JSON.parse(
      (response.content as { type: string; text?: string }[]).find((item) => item.type === "text")!.text!,
    ) as T
  }
  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    const configuration = await page.evaluate(async () => {
      const { hasApiKey: _key, source: _source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "mcp" })
      return (await window.studio.getMcpStatus()).configuration
    })
    await client.connect(
      new StdioClientTransport({ ...JSON.parse(configuration).mcpServers["minemods-studio"], stderr: "pipe" }),
    )
    const capabilities = await call<ReturnType<typeof getMcpCapabilities>>("get_capabilities", {})
    expect(capabilities.protocol_version).toBe(1)
    // Every kind of the registry, however many there are by now (13 when this was written, 15 since effects and gameplay).
    expect(capabilities.modules.length).toBeGreaterThanOrEqual(13)
    expect(capabilities.tools.map((tool) => tool.name).sort()).toEqual(
      (await client.listTools()).tools.map((tool) => tool.name).sort(),
    )
    const entitySchema = await call<{ schema: Record<string, unknown>; capability: string }>("module_schema", {
      module: "entity",
    })
    expect(entitySchema.capability).toBe("runtime")
    expect(capabilities.modules.find((module) => module.module === "entity")?.schema_fingerprint).toBe(
      createHash("sha256").update(JSON.stringify(entitySchema.schema)).digest("hex"),
    )
    const created = await call<StudioView>("create_project", {
      name: "苔皮苦力怕 · 精细结构样例",
      description: "GPT Image 参考下的结构与动作样例，独立验收工程。",
      modId: "crafted_creeper",
    })
    await page.reload()
    await page.getByRole("button", { name: "MineMods Studio 首页", exact: true }).click()
    const createdCard = page.locator(".project-card").filter({ hasText: created.project.name })
    if (await createdCard.count()) await createdCard.click()
    await page.getByRole("button", { name: "在制作现场看全部", exact: true }).first()
      .click()
    await expect(page.getByRole("button", { name: "模型精细度 · 中", exact: true })).toBeVisible()
    const readComplexity = () =>
      page.evaluate(async () => (await window.studio.getSettings()) as unknown as ComplexitySettings)
    const readHandoff = () =>
      page.evaluate((projectId) => window.studio.getMcpHandoff({ projectId }), created.project.id)
    const reloadProject = async () => {
      await page.reload()
    await page.getByRole("button", { name: "MineMods Studio 首页", exact: true }).click()
      const card = page.locator(".project-card").filter({ hasText: created.project.name })
      await card.press("Enter")
      await expect(page.getByRole("navigation", { name: "工程里的东西", exact: true })).toBeVisible()
      await page.getByRole("button", { name: "在制作现场看全部", exact: true }).first()
        .click()
      await expect(page.getByRole("button", { name: /模型精细度 · (低|中|高)/ })).toBeVisible()
    }
    const chooseComplexity = async (complexity: Complexity) => {
      const label = complexityLabels[complexity]
      await page.getByRole("button", { name: /模型精细度 · (低|中|高)/ }).click()
      const menu = page.getByRole("menu", { name: "模型精细度", exact: true })
      await expect(menu).toBeVisible()
      await expect(menu.getByRole("menuitemradio")).toHaveCount(3)
      await menu.getByRole("menuitemradio", { name: `${label.title} ${label.description}`, exact: true }).click()
      await expect(page.locator(".toast")).toBeVisible()
      await expect(page.getByRole("button", { name: `模型精细度 · ${label.title}`, exact: true })).toBeVisible()
    }
    const initialSettings = await readComplexity()
    expect(initialSettings.modelComplexity).toBe("medium")
    await page.getByRole("button", { name: "模型精细度 · 中", exact: true }).click()
    await expect(page.getByRole("menu", { name: "模型精细度", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("menu", { name: "模型精细度", exact: true })).toBeHidden()
    await page.getByRole("button", { name: "模型精细度 · 中", exact: true }).click()
    await page.getByRole("region", { name: "制作现场", exact: true }).getByRole("heading").first().click()
    await expect(page.getByRole("menu", { name: "模型精细度", exact: true })).toBeHidden()
    await page.getByRole("button", { name: "模型精细度 · 中", exact: true }).press("ArrowDown")
    await expect(page.getByRole("menu", { name: "模型精细度", exact: true })).toBeVisible()
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("button", { name: "模型精细度 · 高", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "模型精细度 · 高", exact: true }).press("ArrowUp")
    await page.keyboard.press("ArrowUp")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("button", { name: "模型精细度 · 中", exact: true })).toBeVisible()
    const settingsBackupPath = `${settingsPath}.e2e-backup`
    await rename(settingsPath, settingsBackupPath)
    await mkdir(settingsPath)
    await page.getByRole("button", { name: "模型精细度 · 中", exact: true }).click()
    try {
      await page
        .getByRole("menu", { name: "模型精细度", exact: true })
        .getByRole("menuitemradio", { name: "高 丰富结构，更充分的细节", exact: true })
        .click()
      await expect(page.getByRole("alert")).toHaveText("未能保存精细度，请重试。当前档位保持不变。")
      await expect(page.getByRole("button", { name: "模型精细度 · 中", exact: true })).toBeVisible()
    } finally {
      await rmdir(settingsPath)
      await rename(settingsBackupPath, settingsPath)
    }
    expect((await readComplexity()).modelComplexity).toBe("medium")
    await page.keyboard.press("Escape")
    await chooseComplexity("high")
    expect((await readComplexity()).modelComplexity).toBe("high")
    const updatedCapabilities = await call<ReturnType<typeof getMcpCapabilities>>("get_capabilities", {})
    expect(updatedCapabilities.model_quality.complexity).toBe("high")
    expect(updatedCapabilities.contract_fingerprint).toBe(capabilities.contract_fingerprint)
    await chooseComplexity("medium")
    for (const complexity of ["low", "medium", "high"] as const) {
      await chooseComplexity(complexity)
      const saved = await readComplexity()
      expect(saved.modelComplexity).toBe(complexity)
      const handoff = await readHandoff()
      expect(handoff).toContain(created.project.id)
      expect((await call<ReturnType<typeof getMcpCapabilities>>("get_capabilities", {})).model_quality.complexity).toBe(complexity)
      await reloadProject()
      expect((await readComplexity()).modelComplexity).toBe(complexity)
    }
    await chooseComplexity("medium")
    expect((await readComplexity()).modelComplexity).toBe("medium")
    const prompt = "制作精美复杂的森林苔皮苦力怕，保留原版群系和地形"
    const started = await call<ExternalStartResult>("plan_run", {
      projectId: created.project.id,
      expectedRevision: created.project.revision,
      prompt,
      plan: {
        summary: "苔皮苦力怕 · 结构细化",
        questions: [],
        tasks: [
          {
            key: "forest",
            module: "model",
            title: "苔皮苦力怕",
            prompt,
            source: prompt,
            dependencies: [],
            target_id: null,
          },
        ],
      },
    })
    const task = { projectId: created.project.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
    const claimed = await call<ComplexityTaskContext>("claim_task", task)
    expect(claimed.quality.standard).toContain("验收标准（模型）")
    expect(claimed.quality.complexity).toBe("medium")
    expect(claimed.instructions).toContain("medium")
    expect((started.run as ComplexityRun).model_complexity).toBe("medium")
    await chooseComplexity("high")
    expect((await readComplexity()).modelComplexity).toBe("high")
    expect((await call<ReturnType<typeof getMcpCapabilities>>("get_capabilities", {})).model_quality.complexity).toBe("high")
    expect(
      (await call<ComplexityRun>("get_run", { projectId: task.projectId, runId: task.runId })).model_complexity,
    ).toBe("medium")
    await chooseComplexity("medium")
    const draft = (limit: number) => ({
      kind: "model",
      ...design,
      bones: design.bones.map((bone, index) => ({
        ...bone,
        cubes: bone.cubes.slice(
          0,
          Math.max(0, limit - design.bones.slice(0, index).reduce((sum, value) => sum + value.cubes.length, 0)),
        ),
      })),
    })
    await fixtureSheet(call, task, { kind: "model", ...design })
    const coarse = await call<ShownProgress>("update_task", {
      ...task,
      progress: 25,
      detail: "主体与剪影",
      draft: draft(7),
    })
    expect(coarse.drafts[task.taskId]?.quality?.passed).toBe(false)
    await call("look", { ...task, document: draft(7) })
    await call("self_review", { ...task, matches: [], problems: ["模型没通过验收：缺少关键结构"], advice: [], next: ["补齐模型结构"], verdict: "revise" })
    const rejected = await client.callTool({ name: "commit_task", arguments: { ...task, document: draft(7) } })
    expect(rejected.isError).toBe(true)
    expect(JSON.stringify(rejected.content)).toContain("自评")
    const untouched = await call<StudioView>("open_project", { projectId: created.project.id })
    expect(untouched.project.revision).toBe(created.project.revision)
    await page.reload()
    await page.getByRole("button", { name: "MineMods Studio 首页", exact: true }).click()
    await page.locator(".project-card").filter({ hasText: created.project.name }).click()
    await page.getByRole("button", { name: "在制作现场看全部", exact: true }).first().click()
    await expect(page.locator(".external-workbench")).toBeVisible()
    await expect(page.locator(".external-workbench")).toContainText("被 Studio 退回了")
    await expect(page.locator(".external-workbench")).toContainText("补齐模型结构")
    await page.screenshot({ path: path.join(directory, "01-refinement-required.png") })
    await call("update_task", {
      ...task,
      progress: 60,
      detail: "结构层次与材质 · 树皮护片、苔冠与根趾",
      draft: draft(32),
    })
    await expect(page.locator(".external-workbench")).toContainText("结构层次与材质")
    await page.screenshot({ path: path.join(directory, "02-structural-draft.png") })
    await call("update_task", { ...task, progress: 95, detail: "关节与动作 · 15 根骨骼、6 个动作", draft: draft(55) })
    await fixtureReview(call, call, task, { kind: "model", ...design })
    await call("commit_task", { ...task, document: { kind: "model", ...design } })
    const inspected = await call<StudioView & { quality: ToldReview }>("inspect_model", {
      projectId: created.project.id,
      modelAssetId: started.run.tasks[0]!.asset_id,
    })
    expect(inspected.quality).toMatchObject({ kind: "model", passed: true, findings: [] })
    expect(inspected.model?.animations).toHaveLength(6)
    expect(inspected.preview?.geometry["minecraft:geometry"][0]?.bones).toHaveLength(15)
    expect(inspected.preview?.textureDataUrl).toMatch(/^data:image\/png;base64,/)
    const savedAfterCommit = await call<StudioView>("open_project", { projectId: created.project.id })
    await expect(page.locator(".external-workbench")).toContainText("已经保存")
    await page.screenshot({ path: path.join(directory, "03-crafted-model.png") })
    const parts = page.getByRole("region", { name: "模型 · 贴图 · 动画素材", exact: true })
    if ((await parts.locator(".tree-toggle").getAttribute("aria-expanded")) === "true") await parts.locator(".tree-toggle").click()
    await expect(parts.locator(".tree-toggle")).toHaveAttribute("aria-expanded", "false")
    await page.getByRole("textbox", { name: "搜索工程里的东西", exact: true }).fill("苔皮")
    await expect(parts.locator(".tree-toggle")).toHaveAttribute("aria-expanded", "true")
    await expect(parts.locator(".inv-slot").filter({ hasText: "苔皮苦力怕" })).toBeVisible()
    await page.getByRole("textbox", { name: "搜索工程里的东西", exact: true }).fill("")
    await expect(parts.locator(".tree-toggle")).toHaveAttribute("aria-expanded", "false")
    const canvas = page.locator(".external-workbench canvas").first()
    await expect(canvas).toBeVisible()
    await expect(async () => {
      await expect(canvas).toBeVisible()
      await canvas.screenshot({ path: path.join(directory, "04-model-detail.png") })
    }).toPass({ timeout: 10000 })
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width * 0.73, box!.y + box!.height * 0.5, { steps: 24 })
    await page.mouse.up()
    await canvas.screenshot({ path: path.join(directory, "05-model-rotated.png") })
    await reloadProject()
    await page.getByRole("button", { name: "模型精细度 · 中", exact: true }).click()
    await expect(page.getByRole("menu", { name: "模型精细度", exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(directory, "complexity-craft-popover.png") })
    await page.keyboard.press("Escape")
    await chooseComplexity("high")
    const highPrompt = "继续制作高复杂度森林苔皮苦力怕"
    const highStarted = await call<ExternalStartResult>("plan_run", {
      projectId: created.project.id,
      expectedRevision: savedAfterCommit.project.revision,
      prompt: highPrompt,
      plan: {
        summary: "高复杂度拒绝门槛",
        questions: [],
        tasks: [
          {
            key: "forest_high",
            module: "model",
            title: "高复杂度苔皮苦力怕",
            prompt: highPrompt,
            source: highPrompt,
            dependencies: [],
            target_id: null,
          },
        ],
      },
    })
    const highTask = { projectId: created.project.id, runId: highStarted.run.id, taskId: highStarted.run.tasks[0]!.id }
    const highClaimed = await call<ComplexityTaskContext>("claim_task", highTask)
    expect(highClaimed.quality.complexity).toBe("high")
    expect(highClaimed.instructions).toContain("high")
    expect((highStarted.run as ComplexityRun).model_complexity).toBe("high")
    await fixtureSheet(call, highTask, { kind: "model", ...design })
    await call("look", { ...highTask, document: draft(7) })
    await call("self_review", { ...highTask, matches: [], problems: ["模型没通过验收：缺少关键结构"], advice: [], next: ["补齐模型结构"], verdict: "revise" })
    const highRejected = await client.callTool({ name: "commit_task", arguments: { ...highTask, document: draft(7) } })
    expect(highRejected.isError).toBe(true)
    expect(JSON.stringify(highRejected.content)).toContain("自评")
    await call("cancel_run", { projectId: highTask.projectId, runId: highTask.runId })
    await chooseComplexity("medium")
    expect((await readComplexity()).modelComplexity).toBe("medium")
    await page.evaluate(async () => {
      const connection = await window.studio.getConnection()
      const { hasApiKey: _hasApiKey, source: _source, ...settings } = connection
      await window.studio.saveConnection({ ...settings, mode: "api" })
    })
    await reloadProject()
    await page.getByRole("button", { name: "模型精细度 · 中", exact: true }).click()
    await expect(page.getByRole("menu", { name: "模型精细度", exact: true })).toBeVisible()
    await page
      .getByRole("menu", { name: "模型精细度", exact: true })
      .getByRole("menuitemradio", { name: "低 简洁轮廓，保留关键结构", exact: true })
      .click()
    await expect(page.getByRole("button", { name: "模型精细度 · 低", exact: true })).toBeVisible()
    expect((await readComplexity()).modelComplexity).toBe("low")
    await chooseComplexity("medium")
    const hidden = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every((window) => !window.isVisible() && !window.isFocused()),
    )
    expect(hidden).toBe(true)
    expect(errors).toEqual([])
    await writeFile(
      path.join(directory, "result.json"),
      JSON.stringify(
        {
          directory,
          projectDirectory: created.directory,
          projectId: created.project.id,
          complexity: await readComplexity(),
          hidden,
          quality: inspected.quality,
          animations: inspected.model?.animations.map((value) => value.name),
          errors,
        },
        null,
        2,
      ),
    )
    console.log(`MODEL_QUALITY_EVIDENCE=${directory}`)
  } finally {
    await client.close()
    await app.close()
  }
})
