import { test, expect, _electron } from "@playwright/test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import type { ExternalStartResult } from "../../src/external"
import type { StudioView } from "../../src/api"
import type { ProjectRun } from "../../src/project-runs"
import type { Job } from "@minemods/mod-core/jobs"
import type { BuildResult } from "@minemods/mod-core/build"
import { modelFixture } from "./model-fixture"
import { fixtureSheet, fixtureReview } from "./protocol-fixture"

test("真实 MCP 制作两个群系生物、独立材质、后台构建并显示真实状态", async () => {
  await mkdir(path.resolve("../../.artifacts/studio"), { recursive: true })
  const directory = await mkdtemp(path.resolve("../../.artifacts/studio/entity-runtime-"))
  test.setTimeout(600000)
  const javaHome = process.env.MINEMODS_STUDIO_JAVA_HOME || path.resolve("../../.artifacts/toolchains/temurin21/jdk-21.0.12.1+1")
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
      MINEMODS_STUDIO_JAVA_HOME: javaHome,
      MINEMODS_STUDIO_RUNTIME: process.env.MINEMODS_E2E_RUNTIME || path.join(directory, "runtime"),
      MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"),
    },
  })
  const page = await app.firstWindow()
  const client = new Client({ name: "entity-runtime-acceptance", version: "1.0.0" })
  const errors: string[] = []
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
    const config = await page.evaluate(async () => {
      const { hasApiKey: _key, source: _source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "mcp" })
      return (await window.studio.getMcpStatus()).configuration
    })
    const server = JSON.parse(config).mcpServers["minemods-studio"] as {
      command: string
      args: string[]
      env: Record<string, string>
    }
    const transport = new StdioClientTransport({ ...server, stderr: "pipe" })
    await client.connect(transport)
    const listed = await client.listTools()
    expect(listed.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["build_project", "get_build", "inspect_model"]),
    )
    const capabilities = await call<{ tools: { name: string }[] }>("get_capabilities", {})
    expect(listed.tools.map(tool => tool.name).sort()).toEqual(capabilities.tools.map(tool => tool.name).sort())
    const schema = await call<{ capability: string }>("module_schema", { module: "entity" })
    expect(schema.capability).toBe("runtime")
    const created = await call<StudioView>("create_project", {
      name: "群系生物 · 能力验收",
      description: "仅测试夹具，不修改用户工程",
      modId: "runtime_acceptance",
    })
    await page.reload()
    await page.getByRole("button", { name: "MineMods Studio 首页", exact: true }).click()
    await page.locator(".project-card").filter({ hasText: created.project.name }).click()
    await page.getByRole("button", { name: "在制作现场看全部", exact: true }).first().click()
    const task = (title: string, module: string, dependencies: string[] = []) => ({
      key: `${module}_${Array.from(title)
        .map((character) => character.codePointAt(0)!.toString(16))
        .join("")}`,
      module,
      title,
      prompt: title,
      source: title,
      dependencies,
      target_id: null,
    })
    const models = await call<ExternalStartResult>("plan_run", {
      projectId: created.project.id,
      expectedRevision: created.project.revision,
      prompt: "制作简单低模：森林模型 沙漠模型 苔藓贴图",
      plan: {
        summary: "制作外观",
        questions: [],
        tasks: [task("森林模型", "model"), task("沙漠模型", "model"), task("苔藓贴图", "texture")],
      },
    })
    const args = (run: ProjectRun, index: number) => ({
      projectId: created.project.id,
      runId: run.id,
      taskId: run.tasks[index]!.id,
    })
    await Promise.all(models.run.tasks.map((_, index) => call("claim_task", args(models.run, index))))
    const model = (name: string, _color: string) => modelFixture(name)
    for (const index of [0, 1]) await fixtureSheet(call, args(models.run, index), model(index ? "沙漠苦力怕" : "森林苦力怕", ""))
    await call("update_task", {
      ...args(models.run, 0),
      progress: 70,
      detail: "头部与四足结构已完成",
      draft: model("森林苦力怕", "#556b38"),
    })
    await page.locator(".mf-row").filter({ hasText: "森林模型" }).first().click()
    await expect(page.locator(".ml-stage canvas").first()).toBeVisible()
    await fixtureReview(call, call, args(models.run, 0), model("森林苦力怕", ""))
    await call("commit_task", { ...args(models.run, 0), document: model("森林苦力怕", "#556b38") })
    await fixtureReview(call, call, args(models.run, 1), model("沙漠苦力怕", ""))
    await call("commit_task", { ...args(models.run, 1), document: model("沙漠苦力怕", "#b59260") })
    const inspected = await call<{ asset_id: string; preview: NonNullable<StudioView["preview"]> }>("inspect_model", {
      projectId: created.project.id,
      modelAssetId: models.run.tasks[0]!.asset_id,
    })
    expect(inspected.asset_id).toBe(models.run.tasks[0]!.asset_id)
    const face = inspected.preview.geometry["minecraft:geometry"][0]!.bones.find(bone => bone.name === "head")!.cubes[0]!.uv.north
    const textureSize = model("森林苦力怕", "").texture_size
    const pixels = Array.from(
      { length: textureSize * textureSize },
      (_, index) => (Math.floor(index / textureSize / 3) + Math.floor((index % textureSize) / 2)) % 4,
    )
    const mask = ["00000000", "01100110", "01100110", "00011000", "00111100", "00111100", "00100100", "00000000"]
    mask.forEach((row, y) =>
      Array.from(row).forEach((pixel, x) => {
        if (pixel === "1") pixels[(face.uv[1]! + y) * textureSize + face.uv[0]! + x] = 4
      }),
    )
    const texture = {
        kind: "texture",
        width: textureSize,
        height: textureSize,
        palette: ["#52643a", "#75824d", "#574838", "#3a4028", "#182217"],
        pixels,
      } as const
    await fixtureSheet(call, args(models.run, 2), texture)
    await fixtureReview(call, call, args(models.run, 2), texture)
    await call("commit_task", { ...args(models.run, 2), document: texture })
    const before = await call<StudioView>("open_project", { projectId: created.project.id })
    const entities = await call<ExternalStartResult>("plan_run", {
      projectId: created.project.id,
      expectedRevision: before.project.revision,
      prompt: "森林苦力怕 沙漠苦力怕",
      plan: {
        summary: "接入原版群系与战斗规则",
        questions: [],
        tasks: [task("森林苦力怕", "entity"), task("沙漠苦力怕", "entity")],
      },
    })
    for (const index of [0, 1]) {
      await call("claim_task", args(entities.run, index))
      const document = {
        kind: "entity",
        name: index ? "沙漠苦力怕" : "森林苦力怕",
        description: "现有群系中的独立变体，不改变方块与地形",
        health: 20,
        speed: index ? 0.3 : 0.22,
        attack_damage: 2,
        behavior: "hostile",
        model_asset_id: models.run.tasks[index]!.asset_id,
        runtime: {
          spawn: {
            biomes: index ? ["minecraft:desert"] : ["minecraft:forest", "minecraft:birch_forest"],
            weight: 20,
            min: 1,
            max: 2,
          },
          explosion: {
            fuse_ticks: index ? 30 : 40,
            radius: 3,
            damage_blocks: false,
            effects: [{ effect: index ? "blindness" : "slowness", duration_ticks: 100, amplifier: 0 }],
          },
          movement: index ? "burst" : "stalk",
          armor: 2,
          charging_armor: 0,
          texture_asset_id: index ? null : models.run.tasks[2]!.asset_id,
        },
      }
      await call("update_task", {
        ...args(entities.run, index),
        progress: 80,
        detail: "正在校验生物规则",
        draft: document,
      })
      await page.locator(".mf-row").filter({ hasText: index ? "沙漠苦力怕" : "森林苦力怕" }).first().click()
      await expect(page.getByLabel("生物规则预览", { exact: true })).toBeVisible()
      await call("commit_task", { ...args(entities.run, index), document })
    }
    const saved = await call<StudioView>("open_project", { projectId: created.project.id })
    expect(saved.project.entities).toHaveLength(2)
    expect(saved.project.blocks).toEqual([])
    expect(
      saved.project.workspace.assets.filter((asset) => ["terrain", "biome", "block"].includes(asset.module)),
    ).toEqual([])
    expect(
      saved.project.workspace.assets
        .filter((asset) => asset.module === "entity")
        .every((asset) => asset.status === "ready"),
    ).toBe(true)
    expect(saved.project.entities.every((entity) => entity.runtime?.explosion?.damage_blocks === false)).toBe(true)
    await page.reload()
    await page.getByRole("button", { name: "MineMods Studio 首页", exact: true }).click()
    await page.locator(".project-card").filter({hasText:created.project.name}).click()
    await page
      .getByRole("navigation", { name: "工程里的东西", exact: true })
      .getByRole("region", { name: "生物", exact: true })
      .locator(".inv-slot[data-kind='entity']")
      .filter({ hasText: "森林苦力怕" })
      .first()
      .click()
    // MCP mode opens the creature in the model workspace; its runtime rules are the 行为 step.
    if (await page.getByRole("button", { name: "打开它", exact: false }).isVisible()) await page.getByRole("button", { name: "打开它", exact: false }).click()
  if (!(await page.getByRole("region", { name: "做模型", exact: true }).isVisible())) await page.getByRole("navigation", {name:"生物制作流程",exact:true}).getByRole("button",{name:"外观",exact:true}).click()
  await expect(page.getByRole("region", { name: "做模型", exact: true })).toBeVisible()
    await expect(
      page.getByRole("navigation", { name: "工程里的东西", exact: true }).locator(".inv-slot[data-kind='model'], .inv-slot[data-kind='texture'], .inv-slot[data-kind='animation']"),
    ).toHaveCount(3)
    await page.getByRole("navigation", { name: "生物制作流程", exact: true }).getByRole("button", { name: "行为" }).click()
    await expect(page.locator(".entity-preview-note")).toHaveText("外观预览 · 游戏行为需构建后验证")
    await expect(page.getByText("保留方块", { exact: true })).toBeVisible()
    await expect(page.locator(".entity-preview canvas")).toBeVisible()
    await page.screenshot({ path: path.join(directory, "entity-craft.png") })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith("/index.html"))!.setSize(1024, 768))
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: path.join(directory, "entity-1024.png") })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith("/index.html"))!.setSize(1500, 1000))
    await page.getByRole("button", { name: "模组总览", exact: true }).click()
    await page.getByRole("button", { name: "在制作现场看全部", exact: true }).first().click()
    const build = await call<{ jobId: string }>("build_project", { projectId: created.project.id })
    await expect(page.getByLabel("打包进度", { exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(directory, "mcp-building.png") })
    await expect
      .poll(async () => (await call<Job>("get_build", { projectId: created.project.id, jobId: build.jobId })).state, {
        timeout: 480000,
        intervals: [1500],
      })
      .toMatch(/completed|failed|interrupted|canceled/)
    const job = await call<Job>("get_build", { projectId: created.project.id, jobId: build.jobId })
    await writeFile(path.join(directory, "build-job.json"), JSON.stringify(job, null, 2))
    expect(job.state, job.error ?? "真实构建必须成功").toBe("completed")
    const output = job.output as BuildResult
    const bytes = await readFile(output.jarPath)
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(output.sha256)
    const entries = await promisify(execFile)(path.join(javaHome, "bin", "jar.exe"), ["tf", output.jarPath], {
      windowsHide: true,
    })
    expect(entries.stdout.match(/textures\/entity\/creature_[a-z0-9]+\.png/g)).toHaveLength(2)
    await writeFile(path.join(directory, "jar-entries.txt"), entries.stdout)
    await expect(page.getByLabel("打包进度").getByText(/打包好了/)).toBeVisible()
    await page.screenshot({ path: path.join(directory, "mcp-built.png") })
    const latest = await call<StudioView>("open_project", { projectId: created.project.id })
    const failed = await call<ExternalStartResult>("plan_run", {
      projectId: saved.project.id,
      expectedRevision: latest.project.revision,
      prompt: "失败状态验收",
      plan: { summary: "失败反馈验收", questions: [], tasks: [task("失败状态验收", "worldview")] },
    })
    await call("claim_task", args(failed.run, 0))
    await call("fail_task", {
      ...args(failed.run, 0),
      error: "验收夹具：输入缺少可用素材。请保留已保存生物并读取最新工程继续。",
    })
    await expect(page.getByRole("heading", { name: "这一步没做完", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "在等下一份看得见的草稿" })).toHaveCount(0)
    await page.locator(".external-empty .fold-summary").click()
    await page.screenshot({ path: path.join(directory, "mcp-failure.png") })
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible() && !window.isFocused()),
      ),
    ).toBe(true)
    expect(errors).toEqual([])
    await writeFile(
      path.join(directory, "result.json"),
      JSON.stringify(
        {
          directory,
          packaged: !!process.env.STUDIO_PACKAGED_EXECUTABLE,
          tools: listed.tools.length,
          entities: 2,
          assets: saved.project.workspace.assets.length,
          jar: output,
          screenshots: 7,
          hidden: true,
          errors,
        },
        null,
        2,
      ),
    )
    console.log(`Entity runtime acceptance: ${directory}`)
  } catch (error) {
    await writeFile(path.join(directory, "failure-body.txt"), await page.locator("body").innerText())
    await page.screenshot({path:path.join(directory,"failure.png")})
    console.log(await page.locator("body").innerText())
    throw error
  } finally {
    await client.close()
    await app.close()
  }
})
