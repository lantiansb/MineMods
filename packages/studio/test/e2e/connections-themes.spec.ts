import { expect, test, _electron, type Page } from "@playwright/test"
import { createServer } from "node:http"
import { mkdir, mkdtemp, readFile } from "node:fs/promises"
import path from "node:path"

const studioDirectory = process.cwd()
const artifactsDirectory = path.resolve(studioDirectory, "../../.artifacts/studio")
const apiKey = "fixture-secret-api-key-connection-e2e"
const fixtureModel = "fixture/connections-model"

async function startFixtureServer() {
  const requests: Array<{ method: string; pathname: string; model?: string }> = []
  const server = createServer((request, response) => {
    const buffers: Buffer[] = []
    request.on("data", (chunk) => buffers.push(Buffer.from(chunk)))
    request.on("end", () => {
      let body: { model?: string } = {}
      if (buffers.length) body = JSON.parse(Buffer.concat(buffers).toString("utf8")) as { model?: string }
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname
      requests.push({ method: request.method ?? "", pathname, model: body.model })
      response.setHeader("content-type", "application/json")
      if (pathname.endsWith("/models")) {
        response.end(JSON.stringify({ object: "list", data: [{ id: fixtureModel }, { id: "fixture/router" }] }))
        return
      }
      if (pathname.endsWith("/responses")) {
        response.end(JSON.stringify({ id: "fixture-response", model: body.model, status: "completed" }))
        return
      }
      response.statusCode = 404
      response.end(JSON.stringify({ error: "not found" }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Fixture port missing")
  return { server, url: `http://127.0.0.1:${address.port}/v1`, requests }
}

async function launchStudio(directory: string, importedKey = "") {
  const app = await _electron.launch({
    executablePath:
      process.env.STUDIO_PACKAGED_EXECUTABLE || path.join(studioDirectory, "node_modules/electron/dist/electron.exe"),
    args: [
      ...(process.env.STUDIO_PACKAGED_EXECUTABLE ? [] : [studioDirectory]),
      `--user-data-dir=${path.join(directory, "electron")}`,
    ],
    env: {
      ...process.env,
      OPENAI_API_KEY: importedKey,
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
  const windows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({ visible: window.isVisible(), focused: window.isFocused() })),
  )
  expect(windows.length).toBeGreaterThan(0)
  expect(windows.every((window) => !window.visible && !window.focused)).toBe(true)
  await page.emulateMedia({ reducedMotion: "reduce" })
  return { app, page }
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

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "个人设置", exact: true }).click()
  await expect(page.getByRole("heading", { name: "个人设置", exact: true })).toBeVisible()
  await expect(page.getByRole("region", { name: "怎么连接 AI", exact: true })).toBeVisible()
}

test("只有官方同源本机配置可一键导入，默认地址无需填写", async () => {
  await mkdir(artifactsDirectory, { recursive: true })
  const directory = await mkdtemp(path.join(artifactsDirectory, "official-import-e2e-"))
  const { app, page } = await launchStudio(directory, "local-fixture-import-key")
  try {
    await openSettings(page)
    await page.getByRole("button", { name: "下一步", exact: true }).click()
    await page.getByRole("radio", { name: /OpenAI 官方/ }).click()
    await page.getByRole("button", { name: "下一步", exact: true }).click()
    await expect(page.getByLabel("服务地址", { exact: true })).toHaveCount(0)
    await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("")
    // 每个有固定官网的服务都有同一行：密钥页链接 + 按用量付费；只有 DeepSeek 有实测花费。
    await expect(page.getByRole("button", { name: "OpenAI 的密钥页面", exact: true })).toBeVisible()
    await expect(page.getByText("按用量付费")).toContainText("花费看所选模型")
    await page.getByRole("button", { name: "导入检测到的本机配置", exact: true }).click()
    await expect(page.getByRole("button", { name: "下一步", exact: true })).toBeEnabled()
    await screenshot(page, directory, "official-import")
    await page.getByRole("button", { name: "返回", exact: true }).click()
    // 四个选项，DeepSeek 在「其他服务」前面；选了它不用填地址，页面上有取密钥的链接和花费说明，只剩粘贴密钥。
    await expect(page.getByRole("radiogroup", { name: "AI 厂商" }).getByRole("radio")).toHaveText([/OpenAI 官方/, /OpenRouter/, /DeepSeek/, /其他服务（自己填地址）/])
    await page.getByRole("radio", { name: /DeepSeek/ }).click()
    await page.getByRole("button", { name: "下一步", exact: true }).click()
    await expect(page.getByLabel("服务地址", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "DeepSeek 的密钥页面", exact: true })).toBeVisible()
    await expect(page.getByText("按用量付费")).toContainText("3–6 元")
    await expect(page.getByRole("button", { name: "导入检测到的本机配置", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "下一步", exact: true })).toBeDisabled()
    await page.getByRole("button", { name: "返回", exact: true }).click()
    await page.getByRole("radio", { name: /其他服务（自己填地址）/ }).click()
    await page.getByRole("button", { name: "下一步", exact: true }).click()
    await expect(page.getByRole("button", { name: "导入检测到的本机配置", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "下一步", exact: true })).toBeDisabled()
    await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("")
  } finally {
    await app.close()
  }
})

test("连接向导、加密持久化和 MCP 制作现场", async () => {
  await mkdir(artifactsDirectory, { recursive: true })
  const directory = await mkdtemp(path.join(artifactsDirectory, "connections-e2e-"))
  const fixture = await startFixtureServer()
  const errors: string[] = []
  let app: Awaited<ReturnType<typeof launchStudio>>["app"] | undefined
  try {
    app = (await launchStudio(directory)).app
    const page = await app.firstWindow()
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })

    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    await openSettings(page)
    await screenshot(page, directory, "01-settings-mode")

    await expect(page.getByRole("heading", { name: "你想让谁来替你做？", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "用哪一家的 AI？", exact: true })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "连接其他服务（自己填地址）", exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: /让 Studio 自己调用 AI/ }).click()
    await page.getByRole("button", { name: "下一步", exact: true }).click()
    await expect(page.getByRole("heading", { name: "用哪一家的 AI？", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "你想让谁来替你做？", exact: true })).toHaveCount(0)
    // 第一次来：不预先选中任何一家，没选就不能点「下一步」；小字是对新手有用的一句事实。
    for (const radio of await page.getByRole("radiogroup", { name: "AI 厂商" }).getByRole("radio").all()) await expect(radio).toHaveAttribute("aria-checked", "false")
    await expect(page.getByRole("button", { name: "下一步", exact: true })).toBeDisabled()
    await expect(page.getByRole("radio", { name: /OpenAI 官方/ })).toContainText("ChatGPT 的会员不包含这个密钥")
    await expect(page.getByRole("radio", { name: /OpenRouter/ })).toContainText("一个账号可以用多家模型")
    await expect(page.getByRole("radio", { name: /DeepSeek/ })).toContainText("3–6 元")
    await screenshot(page, directory, "02-settings-provider")

    await page.getByRole("radio", { name: /其他服务（自己填地址）/ }).click()
    await page.getByRole("button", { name: "下一步", exact: true }).click()
    await expect(page.getByRole("heading", { name: /连接\s+其他服务（自己填地址）/ })).toBeVisible()
    await expect(page.getByRole("heading", { name: "用哪一家的 AI？", exact: true })).toHaveCount(0)
    await page.getByLabel("服务地址", { exact: true }).fill(fixture.url)
    await page.getByLabel("API Key", { exact: true }).fill(apiKey)
    await screenshot(page, directory, "03-settings-credential")
    await page.getByRole("button", { name: "下一步", exact: true }).click()
    await expect(page.getByRole("heading", { name: "选择一个模型", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "连接其他服务（自己填地址）", exact: true })).toHaveCount(0)

    await page.getByRole("button", { name: /刷新列表/ }).click()
    await expect(page.getByLabel("模型", { exact: true }).locator("option")).toHaveCount(2)
    await page.getByLabel("模型", { exact: true }).selectOption(fixtureModel)
    await screenshot(page, directory, "04-settings-model")
    await page.getByRole("button", { name: "验证并连接", exact: true }).click()
    await expect(page.getByRole("heading", { name: "连接成功", exact: true })).toBeVisible()
    await expect(page.getByText(fixtureModel, { exact: true })).toBeVisible()
    expect(fixture.requests.filter((request) => request.pathname.endsWith("/models")).length).toBeGreaterThan(0)
    await expect(fixture.requests.filter((request) => request.pathname.endsWith("/responses"))).toHaveLength(1)
    await screenshot(page, directory, "05-settings-success")

    const savedFile = path.join(directory, "runtime", "connection.json")
    await expect.poll(async () => await readFile(savedFile, "utf8")).not.toContain(apiKey)
    const stored = JSON.parse(await readFile(savedFile, "utf8")) as {
      settings: { model: string }
      encryptedApiKey?: string
    }
    expect(stored.settings.model).toBe(fixtureModel)
    expect(stored.encryptedApiKey).toBeTruthy()

    await page.getByRole("button", { name: "开始制作", exact: true }).click()
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    await openSettings(page)
    await expect(page.getByText("已保存连接", { exact: true })).toBeVisible()
    await screenshot(page, directory, "06-settings-persisted")

    // One fixed look: saved settings always report "craft".
    expect((await page.evaluate(() => window.studio.getSettings())).theme).toBe("craft")
    await screenshot(page, directory, "07-settings-craft")
    await page.getByRole("button", { name: "返回工程库", exact: true }).click()
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    await screenshot(page, directory, "08-home")

    await app.close()
    app = (await launchStudio(directory)).app
    const restarted = await app.firstWindow()
    await expect
      .poll(async () => (await restarted.evaluate(() => window.studio.getConnection())).model)
      .toBe(fixtureModel)
    await expect.poll(async () => (await restarted.evaluate(() => window.studio.getConnection())).hasApiKey).toBe(true)

    const created = await restarted.evaluate(() =>
      window.studio.createProject({ name: "连接配置 E2E 工程", description: "", empty: true }),
    )
    await restarted.reload()
    await expect(restarted.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    await expect(restarted.locator(".project-card").filter({ hasText: "连接配置 E2E 工程" })).toBeVisible()
    await restarted.locator(".project-card").filter({ hasText: "连接配置 E2E 工程" }).click()
    await expect(restarted.getByRole("navigation", { name: "工程里的东西", exact: true })).toBeVisible()
    await restarted.getByTitle("连接 AI", { exact: true }).click()
    await restarted.getByRole("dialog", { name: "AI 连接", exact: true }).getByRole("button", { name: "连接设置", exact: true }).click()
    await expect(restarted.getByRole("heading", { name: "个人设置", exact: true })).toBeVisible()
    await restarted.getByRole("button", { name: /用我自己的 AI 助手来做/ }).click()
    await restarted.getByRole("button", { name: "下一步", exact: true }).click()
    await expect(restarted.getByRole("heading", { name: "让你的 AI 接手工程", exact: true })).toBeVisible()
    await expect(restarted.getByRole("textbox", { name: "说一句想做什么", exact: true })).toHaveCount(0)
    await withIsolatedClipboard(app, async () => {
      await restarted.getByRole("button", { name: "启用并复制给做东西的 AI", exact: true }).click()
      await expect(restarted.getByRole("button", { name: "已复制", exact: true })).toBeVisible()
    })
    await expect.poll(async () => (await restarted.evaluate(() => window.studio.getConnection())).mode).toBe("mcp")
    await restarted.locator(".page-heading").getByRole("button", { name: "返回工程「连接配置 E2E 工程」", exact: true }).click()
    await restarted.getByRole("button", { name: "在制作现场看全部", exact: true }).first().click()
    await expect(restarted.getByRole("region", { name: "制作现场", exact: true })).toBeVisible()
    await expect(restarted.getByRole("textbox", { name: "说一句想做什么", exact: true })).toHaveCount(0)
    await screenshot(restarted, directory, "09-mcp-workbench")

    await restarted.getByTitle("连接 AI", { exact: true }).click()
    await restarted.getByRole("dialog", { name: "AI 连接", exact: true }).getByRole("button", { name: "连接设置", exact: true }).click()
    await expect(restarted.getByRole("heading", { name: "个人设置", exact: true })).toBeVisible()
    await restarted.getByRole("button", { name: /让 Studio 自己调用 AI/ }).click()
    await restarted.getByRole("button", { name: "下一步", exact: true }).click()
    await restarted.getByRole("radio", { name: /其他服务（自己填地址）/ }).click()
    await restarted.getByRole("button", { name: "下一步", exact: true }).click()
    await expect(restarted.getByRole("heading", { name: /连接\s+其他服务（自己填地址）/ })).toBeVisible()
    await expect(restarted.getByRole("button", { name: /导入检测到的本机配置/ })).toHaveCount(0)
    await expect(restarted.getByLabel("API Key", { exact: true })).toHaveAttribute("placeholder", /已保存/)
    await restarted.getByRole("button", { name: "下一步", exact: true }).click()
    await expect(restarted.getByRole("heading", { name: "选择一个模型", exact: true })).toBeVisible()
    await restarted.getByRole("button", { name: /刷新列表/ }).click()
    await restarted.getByLabel("模型", { exact: true }).selectOption(fixtureModel)
    await restarted.getByRole("button", { name: "验证并连接", exact: true }).click()
    await expect(restarted.getByRole("heading", { name: "连接成功", exact: true })).toBeVisible()
    await expect.poll(async () => (await restarted.evaluate(() => window.studio.getConnection())).mode).toBe("api")
    await expect.poll(async () => (await restarted.evaluate(() => window.studio.getConnection())).hasApiKey).toBe(true)
    await screenshot(restarted, directory, "10-api-reconnect")

    await restarted.evaluate(() => {
      document.documentElement.style.setProperty("--e2e-check", "1")
    })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith("/index.html"))!.setContentSize(1024, 768))
    await expect.poll(() => restarted.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1024, 768])
    await assertNoHorizontalOverflow(restarted, "mcp-1024")
    await screenshot(restarted, directory, "11-api-reconnect-1024")
    expect(errors).toEqual([])
    expect(created.project.name).toBe("连接配置 E2E 工程")
  } finally {
    await app?.close().catch(() => undefined)
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()))
  }
})
