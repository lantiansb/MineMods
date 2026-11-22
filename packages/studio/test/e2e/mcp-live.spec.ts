import { test, expect, _electron } from "@playwright/test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ExternalStartResult } from "../../src/external"
import type { StudioView } from "../../src/api"
import type { ProjectRun } from "../../src/project-runs"
import { fixtureSheet, fixtureReview } from "./protocol-fixture"
import { OUTSIDE_PRESENT_MS } from "../../src/renderer/connection-chip"

test("MCP 外部模型调用同步到隐藏桌面：草稿、重载恢复、提交与取消", async () => {
  test.setTimeout(OUTSIDE_PRESENT_MS + 90000)
  await mkdir(path.resolve("../../.artifacts/studio"), { recursive: true })
  const directory = await mkdtemp(path.resolve("../../.artifacts/studio/mcp-live-"))
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
      MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"),
      MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"),
    },
  })
  const client = new Client({ name: "studio-e2e-external-client", version: "1.0.0" })
  const page = await app.firstWindow()
  page.on("dialog", dialog => void dialog.accept())
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    const config = await page.evaluate(async () => {
      const previous = await window.studio.getConnection()
      const { hasApiKey: _hasApiKey, source: _source, ...settings } = previous
      await window.studio.saveConnection({ ...settings, mode: "mcp" })
      return (await window.studio.getMcpStatus()).configuration
    })
    const parsed = JSON.parse(config) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>
    }
    const server = parsed.mcpServers["minemods-studio"]!
    const transport = new StdioClientTransport({ ...server, stderr: "pipe" })
    transport.stderr?.on("data", (chunk) => console.log(`MCP stderr: ${String(chunk)}`))
    await client.connect(transport)
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["plan_run", "claim_task", "update_task", "commit_task", "module_schema"]),
    )
    const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const response = await client.callTool({ name, arguments: args })
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true)
      const content = response.content as { type: string; text?: string }[]
      return JSON.parse(content.find((item) => item.type === "text")!.text!) as T
    }
    const created = await call<StudioView>("create_project", {
      name: "苔森的铜鸮",
      description: "外部模型制作现场验收",
      modId: "mcp_forest",
    })
    await page.reload()
    await page.getByRole("button", { name: "MineMods Studio 首页", exact: true }).click()
    await page.locator(".project-card").filter({ hasText: "苔森的铜鸮" }).click()
    await page.getByRole("button", { name: "在制作现场看全部", exact: true }).first().click()
    await expect(page.getByRole("region", { name: "制作现场", exact: true })).toBeVisible()
    await expect(page.locator(".external-connection")).toHaveAttribute("data-connected", "true")
    await expect(page.locator(".external-connection")).toHaveText("已连接")
    await expect(page.locator("textarea")).toHaveCount(0)
    const started = await call<ExternalStartResult>("plan_run", {
      projectId: created.project.id,
      expectedRevision: created.project.revision,
      prompt: "制作简单低模：制作铜鸮模型和苔石方块",
      plan: {
        summary: "铜鸮与苔石",
        questions: [],
        tasks: [
          {
            key: "owl",
            module: "model",
            title: "铜鸮模型",
            prompt: "制作铜色方块鸮",
            source: "铜鸮模型",
            dependencies: [],
            target_id: null,
          },
          {
            key: "stone",
            module: "block",
            title: "苔石方块",
            prompt: "制作苔绿色石块",
            source: "苔石方块",
            dependencies: [],
            target_id: null,
          },
        ],
      },
    })
    const owl = { projectId: created.project.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
    const stone = { ...owl, taskId: started.run.tasks[1]!.id }
    await Promise.all([call("claim_task", owl), call("claim_task", stone)])
    // A model the look check accepts: the owl kept as a must-pass specimen of the gate (materials, a face, eased gait).
    const specimen = JSON.parse(await readFile(path.resolve("../studio-ai/test/fixtures/look/good/dawn-owl.json"), "utf8")) as { model: Record<string, unknown> }
    const design = { kind: "model", ...specimen.model, name: "铜鸮" }
    // The former specimen flapped both wings across its centre. Give them a shorter outward stroke.
    for (const animation of specimen.model.animations as { channels: { bone: string; keyframes: { rotation?: number[] }[] }[] }[]) {
      for (const channel of animation.channels.filter(channel => channel.bone === "wing_left" || channel.bone === "wing_right")) {
        for (const frame of channel.keyframes) if (frame.rotation) frame.rotation[2] = Math.abs(frame.rotation[2] ?? 0) * (channel.bone === "wing_left" ? -0.3 : 0.3)
      }
    }
    await fixtureSheet(call, owl, design)
    await call("update_task", { ...owl, progress: 65, detail: "躯干与头部已完成，正在调整眼部", draft: design })
    await page.locator(".mf-row").filter({ hasText: "铜鸮模型" }).first().click()
    await expect(page.locator(".ml-stage canvas").first()).toBeVisible()
    expect((await call<StudioView>("open_project", { projectId: created.project.id })).project.workspace.assets).toHaveLength(0)
    await page.reload()
    await page.getByRole("button", { name: "MineMods Studio 首页", exact: true }).click()
    await page.locator(".project-card").filter({ hasText: "苔森的铜鸮" }).click()
    await page.getByRole("button", { name: "在制作现场看全部", exact: true }).first().click()
    await page.locator(".mf-row").filter({ hasText: "铜鸮模型" }).first().click()
    await expect(page.locator(".ml-stage canvas").first()).toBeVisible()
    await page.screenshot({ path: path.join(directory, "mcp-live-craft.png") })
    await fixtureReview(call, call, owl, design)
    await call("commit_task", {
      ...owl,
      document: design,
      provenance: { client: "local-test", model: "fixture", verified: false },
    })
    const block = {
      kind: "block",
      identifier: "moss_stone",
      name: "苔石",
      hardness: 2,
      luminance: 0,
      tool: "pickaxe",
      drop: "self",
      color: "#526d4d",
      texture: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAvUlEQVR4nJVTqxFCQRDbYugERQMYJAKBYwaFQz6BoABqoovXwzPHRGQnB9m5h9iJuNsk+4v94dhO50sjIq63eyJiejwTEfhLDE0GajJQk4GaDAxNnualbV/vttn94SCV5qUjQKiivqloUEkJGFR05CRJB3ywDgx5OtAalYA1Ihw5nceoy1RSAp1SjLo82pOoFN1I3V6EU3Rdr/bCOnBdLx24GquRuoUqb0EJOtvi7OcW1lyjEne3sPb6vh1/ABwPaVuyZ52PAAAAAElFTkSuQmCC",
    }
    await fixtureSheet(call, stone, block)
    await call("update_task", { ...stone, progress: 90, detail: "正在校验方块参数", draft: block })
    await page.locator('.mf-row').filter({ hasText: "苔石方块" }).first().click()
    await expect(page.getByLabel("方块预览", { exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(directory, "mcp-block-progress.png") })
    await fixtureReview(call, call, stone, block)
    const completed = await call<ProjectRun>("commit_task", { ...stone, document: block })
    expect(completed.state).toBe("completed")
    await page.locator(".mf-row-live").click()
    await expect(page.locator(".external-run-state")).toHaveText("已完成")
    const saved = await call<StudioView>("open_project", { projectId: created.project.id })
    expect(saved.project.workspace.assets).toHaveLength(2)
    expect(saved.project.entities[0]?.model_asset_id).toBeTruthy()
    await page.screenshot({ path: path.join(directory, "mcp-completed.png") })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith("/index.html"))!.setSize(1024, 768))
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: path.join(directory, "mcp-1024.png") })
    const unfinished = await call<ExternalStartResult>("plan_run", {
      projectId: saved.project.id,
      expectedRevision: saved.project.revision,
      prompt: "再制作一块石头",
      plan: {
        summary: "取消验收",
        questions: [],
        tasks: [
          {
            key: "cancel",
            module: "block",
            title: "取消任务",
            prompt: "制作石头",
            source: "石头",
            dependencies: [],
            target_id: null,
          },
        ],
      },
    })
    await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "停止", exact: true }).click()
    await expect
      .poll(
        async () =>
          (await call<ProjectRun>("get_run", { projectId: saved.project.id, runId: unfinished.run.id })).state,
      )
      .toBe("canceled")
    await client.close()
    await expect(page.locator(".external-connection")).toHaveAttribute("data-connected", "false", { timeout: OUTSIDE_PRESENT_MS + 35000 })
    await expect(page.locator(".external-connection")).toHaveText("AI 没连接")
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
          screenshots: 6,
          tools: tools.tools.length,
          assets: saved.project.workspace.assets.length,
          packaged: !!process.env.STUDIO_PACKAGED_EXECUTABLE,
          hidden: true,
          errors,
        },
        null,
        2,
      ),
    )
    console.log(`MCP acceptance: ${directory}`)
  } finally {
    await Promise.race([client.close(), new Promise(resolve => setTimeout(resolve, 8000))])
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined)
    await app.close()
  }
})
