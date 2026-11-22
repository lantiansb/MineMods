import { expect, test, _electron, type Page } from "@playwright/test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import path from "node:path"

const studioDirectory = process.cwd()
const artifactsDirectory = path.resolve(studioDirectory, "../../.artifacts/studio")

type McpServerConfiguration = {
  command: string
  args: string[]
  env?: Record<string, string>
}

async function launchStudio(directory: string) {
  const app = await _electron.launch({
    executablePath:
      process.env.STUDIO_PACKAGED_EXECUTABLE || path.join(studioDirectory, "node_modules/electron/dist/electron.exe"),
    args: [
      ...(process.env.STUDIO_PACKAGED_EXECUTABLE ? [] : [studioDirectory]),
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
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).not.toEqual([0, 0])
  await expectHidden(app)
  await page.emulateMedia({ reducedMotion: "reduce" })
  return { app, page }
}

async function expectHidden(app: Awaited<ReturnType<typeof _electron.launch>>) {
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every((window) => !window.isVisible() && !window.isFocused()),
    ),
  ).toBe(true)
}

async function withIsolatedClipboard<T>(app: Awaited<ReturnType<typeof _electron.launch>>, action: () => Promise<T>) {
  // Keep the production IPC path while isolating the user's system clipboard.
  await app.evaluate(({ clipboard }) => {
    let text = ""
    clipboard.writeText = (value: string) => {
      text = value
    }
    clipboard.readText = () => text
  })
  return action()
}
async function screenshot(page: Page, directory: string, name: string) {
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true, animations: "disabled" })
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const layout = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }))
  expect(layout.documentWidth, `${label}: document must fit viewport`).toBeLessThanOrEqual(layout.width)
  expect(layout.bodyWidth, `${label}: body must fit viewport`).toBeLessThanOrEqual(layout.width)
}

function parseFirstJsonFence(value: string) {
  const blocks = Array.from(value.matchAll(/(`{3,})json\s*([\s\S]*?)\1/gi), (match) => match[2]!.trim())
  expect(blocks.length, "交接说明必须包含 JSON 配置 fence").toBeGreaterThan(0)
  const configuration = blocks
    .map((block) => {
      try {
        return JSON.parse(block) as unknown
      } catch {
        return null
      }
    })
    .find(
      (parsed): parsed is { mcpServers: Record<string, McpServerConfiguration> } =>
        typeof parsed === "object" &&
        parsed !== null &&
        "mcpServers" in parsed &&
        typeof parsed.mcpServers === "object" &&
        parsed.mcpServers !== null,
    )
  expect(configuration, "JSON fence 必须包含 mcpServers 配置").toBeTruthy()
  return configuration!
}

test("MCP 完整交接支持复制、真实 SDK 连接和工程上下文", async () => {
  await mkdir(artifactsDirectory, { recursive: true })
  const directory = await mkdtemp(path.join(artifactsDirectory, "mcp-handoff-e2e-"))
  const { app, page } = await launchStudio(directory)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))

  const client = new Client({ name: "studio-e2e-handoff-client", version: "1.0.0" })
  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    await expect.poll(async () => (await page.evaluate(() => window.studio.getConnection())).hasApiKey).toBe(false)
    await page.getByRole("button", { name: "个人设置", exact: true }).click()
    await page.getByRole("button", { name: /用我自己的 AI 助手来做/ }).click()
    await page.getByRole("button", { name: "下一步", exact: true }).click()
    await expect(page.getByRole("heading", { name: "让你的 AI 接手工程", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "启用并复制给做东西的 AI", exact: true })).toBeEnabled()
    await expect(page.getByText("查看完整交接说明", { exact: true })).toBeVisible()
    await expect(page.getByText("高级连接配置", { exact: true })).toBeVisible()
    for (const summary of ["查看完整交接说明", "高级连接配置"]) {
      // A fold (fold.tsx) tells whether it is open by aria-expanded on its button.
      await expect(page.getByRole("button", { name: summary, expanded: false })).toBeVisible()
    }

    const noProjectHandoff = await withIsolatedClipboard(app, async () => {
      await page.getByRole("button", { name: "启用并复制给做东西的 AI", exact: true }).click()
      await expect(page.getByRole("button", { name: "已复制", exact: true })).toBeVisible()
      const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
      expect(copied).toContain("当前工程：未指定")
      return copied
    })
    const noProjectConfiguration = parseFirstJsonFence(noProjectHandoff)
    const noProjectServer = noProjectConfiguration.mcpServers["minemods-studio"]!
    expect(noProjectServer.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" })
    expect(noProjectHandoff).not.toContain("OPENAI_API_KEY")
    expect(noProjectHandoff).not.toContain("STUDIO_SERVICE_TOKEN")

    const created = await page.evaluate(() =>
      window.studio.createProject({ name: "交接说明验收工程", description: "MCP handoff E2E", empty: true }),
    )
    await page.reload()
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    await page.locator(".project-card").filter({ hasText: "交接说明验收工程" }).click()
    await expect(page.getByRole("navigation", { name: "工程里的东西", exact: true })).toBeVisible()
    await page.getByRole("button", { name: /^AI 连接：/ }).click()
    await expect(page.getByRole("dialog", { name: "AI 连接", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "连接设置", exact: true }).click()
    await expect(page.getByRole("heading", { name: "个人设置", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "下一步", exact: true }).click()
    await expect(page.getByRole("heading", { name: "让你的 AI 接手工程", exact: true })).toBeVisible()
    await expect(page.getByText("当前工程 · 交接说明验收工程", { exact: true })).toBeVisible()

    await page.getByRole("heading", { name: "让你的 AI 接手工程", exact: true }).scrollIntoViewIfNeeded()
    await screenshot(page, directory, "handoff-ready")

    let projectHandoff = ""
    await withIsolatedClipboard(app, async () => {
      // Enabled by the earlier copy but not copied in this visit: no 「再次」.
      await page.getByRole("button", { name: "复制给做东西的 AI", exact: true }).click()
      await expect(page.getByRole("button", { name: "已复制", exact: true })).toBeVisible()
      projectHandoff = await app.evaluate(({ clipboard }) => clipboard.readText())
    })
    expect(projectHandoff).toContain(created.project.id)
    expect(projectHandoff).toContain(created.project.name)
    expect(projectHandoff.length).toBeGreaterThan(1000)
    await screenshot(page, directory, "handoff-copied")

    await page.getByText("查看完整交接说明", { exact: true }).click()
    const fullPreview = page.getByRole("textbox", { name: "完整交接说明", exact: true })
    await expect(fullPreview).toBeVisible()
    await expect(fullPreview).toHaveValue(/## 整体流程/)
    const previewText = await fullPreview.inputValue()
    // The text the person copies is the start-up text: how to connect, the order of work and the rules for everything; the rest is read from Studio once connected.
    expect(previewText).toContain("## 连接")
    expect(previewText).toContain("## 整体流程")
    expect(previewText).toContain("## 必须遵守的规矩")
    expect(previewText).toContain("## Codex TOML 配置")
    expect(previewText).toContain("## 细节在哪里读")
    expect(previewText.length).toBeLessThan(5000)
    for (const tool of [
      "get_capabilities",
      "get_guide",
      "list_projects",
      "open_project",
      "module_schema",
      "plan_run",
      "claim_task",
      "update_task",
      "commit_task",
      "fail_task",
      "cancel_run",
      "build_project",
      "get_build",
    ]) {
      expect(previewText).toContain(tool)
    }
    await page.getByText("高级连接配置", { exact: true }).click()
    const rawConfiguration = await page.getByRole("textbox", { name: "MCP 客户端配置", exact: true }).inputValue()
    expect(JSON.parse(rawConfiguration)).toEqual(parseFirstJsonFence(projectHandoff))
    await withIsolatedClipboard(app, async () => {
      await page.getByRole("button", { name: "仅复制连接配置", exact: true }).click()
      await expect(page.getByRole("status").filter({ hasText: "连接配置已复制" })).toBeVisible()
      expect(JSON.parse(await app.evaluate(({ clipboard }) => clipboard.readText()))).toEqual(
        JSON.parse(rawConfiguration),
      )
    })
    await screenshot(page, directory, "handoff-details")
    await screenshot(page, directory, "handoff-advanced")
    await page.getByText("高级连接配置", { exact: true }).click()
    await page.getByText("查看完整交接说明", { exact: true }).click()

    const server = parseFirstJsonFence(projectHandoff).mcpServers["minemods-studio"]!
    expect(server.command).toBeTruthy()
    expect(server.args).toEqual(expect.arrayContaining(["--mcp-stdio", "--connection"]))
    const transport = new StdioClientTransport({ ...server, stderr: "pipe" })
    transport.stderr?.on("data", () => undefined)
    await client.connect(transport)
    expect(client.getInstructions()).toContain("module_schema")
    const tools = await client.listTools()
    // The list grows with the product; the names below are what this test is about.
    expect(tools.tools.length).toBeGreaterThanOrEqual(15)
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_projects",
        "open_project",
        "create_project",
        "module_schema",
        "plan_run",
        "claim_task",
        "update_task",
        "commit_task",
        "fail_task",
        "get_run",
        "get_progress",
        "cancel_run",
        "build_project",
        "get_build",
        "inspect_model",
        "get_guide",
      ]),
    )
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: args })
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true)
      return response
    }
    const listed = await call("list_projects", {})
    expect(JSON.stringify(listed.content)).toContain(created.project.id)
    const opened = await call("open_project", { projectId: created.project.id })
    expect(JSON.stringify(opened.content)).toContain(created.project.name)
    // What the start-up text leaves out is read from the connected Studio.
    expect(JSON.stringify((await call("get_guide", {})).content)).toContain("blueprint")
    expect(JSON.stringify((await call("get_guide", { topic: "making" })).content)).toContain("save_sheet")
    await expect.poll(async () => (await page.evaluate(() => window.studio.getMcpStatus())).connected).toBe(true)
    await expect(page.getByText("已连接 · 返回工程查看进度", { exact: true })).toBeVisible()

    await page.getByRole("heading", { name: "让你的 AI 接手工程", exact: true }).scrollIntoViewIfNeeded()
    await screenshot(page, directory, "handoff-connected")
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith("/index.html"))!.setContentSize(1024, 768))
    await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1024, 768])
    await assertNoHorizontalOverflow(page, "mcp-handoff-1024")
    await screenshot(page, directory, "handoff-connected-1024")
    await expectHidden(app)
    expect(errors).toEqual([])
    await writeFile(
      path.join(directory, "result.json"),
      JSON.stringify(
        {
          packaged: Boolean(process.env.STUDIO_PACKAGED_EXECUTABLE),
          tools: tools.tools.length,
          hidden: true,
          clipboard: "isolated in memory",
          errors,
        },
        null,
        2,
      ),
    )
  } finally {
    await client.close().catch(() => undefined)
    await app.close()
  }
})
