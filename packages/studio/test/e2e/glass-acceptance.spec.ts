import { test, expect, _electron, type Page } from "@playwright/test"
import { createServer } from "node:http"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import path from "node:path"
import { fixtureReply } from "./structured-fixture"
import { modelFixture } from "./model-fixture"
import { readFileSync } from "node:fs"
const itemImage = "data:image/png;base64," + readFileSync(path.resolve("test/e2e/fixtures/copper-pickaxe.png")).toString("base64")
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAvUlEQVR4nJVTqxFCQRDbYugERQMYJAKBYwaFQz6BoABqoovXwzPHRGQnB9m5h9iJuNsk+4v94dhO50sjIq63eyJiejwTEfhLDE0GajJQk4GaDAxNnualbV/vttn94SCV5qUjQKiivqloUEkJGFR05CRJB3ywDgx5OtAalYA1Ihw5nceoy1RSAp1SjLo82pOoFN1I3V6EU3Rdr/bCOnBdLx24GquRuoUqb0EJOtvi7OcW1lyjEne3sPb6vh1/ABwPaVuyZ52PAAAAAElFTkSuQmCC"

const studioDirectory = process.cwd()
const artifactsDirectory = path.resolve(studioDirectory, "../../.artifacts/studio")
const prompt = "玻璃森林验收：模型、贴图、动画、方块、物品、配方、逻辑、世界观、群系、维度、地形。"

const labels = [
  ["model", "模型"],
  ["texture", "贴图"],
  ["animation", "动画"],
  ["block", "方块"],
  ["item", "物品"],
  ["recipe", "配方"],
  ["logic", "逻辑"],
  ["worldview", "世界观"],
  ["biome", "群系"],
  ["dimension", "维度"],
  ["terrain", "地形"],
] as const

function responseFor(input: { task?: { module: string }; project?: { entities?: { id: string }[] } }) {
  if (!input.task) {
    return {
      summary: "玻璃森林的 11 个模块均已拆分为本地 fixture 任务。",
      questions: [],
      tasks: labels.map(([module, title]) => ({
        key: `${module}_task`,
        module,
        title: `玻璃${title}`,
        prompt: `${title} fixture`,
        source: title,
        dependencies: module === "animation" ? ["model_task"] : module === "recipe" ? ["block_task", "item_task"] : [],
        target_id: null,
      })),
    }
  }

  const entityId = input.project?.entities?.[0]?.id
  switch (input.task.module) {
    case "model":
      return modelFixture("玻璃鹿模型")
    case "texture":
      return { kind: "texture", width: 128, height: 128, palette: ["#7d9aa0", "#d9f3f2", "#395459", "#527f85"], pixels: Array.from({length:128*128}, (_, index) => (Math.floor(index/128/3)+Math.floor(index%128/2))%4) }
    case "animation":
      return {
        kind: "animation",
        name: "glass_idle",
        length: 1,
        loop: true,
        channels: [
          {
            bone: "torso",
            keyframes: [
              { time: 0, rotation: [0, 0, 0] },
              { time: 0.5, rotation: [0, 10, 0] },
              { time: 1, rotation: [0, 0, 0] },
            ],
          },
        ],
      }
    case "block":
      return {
        kind: "block",
        identifier: "glass_stone",
        name: "玻璃石",
        hardness: 2,
        luminance: 5,
        tool: "pickaxe",
        drop: "self",
        color: "#7d9aa0",
        texture: image,
      }
    case "item":
      return {
        kind: "item",
        identifier: "glass_shard",
        name: "玻璃碎片",
        max_stack: 64,
        color: "#d9f3f2",
        texture: itemImage,
      }
    case "recipe":
      return {
        kind: "recipe",
        name: "玻璃石配方",
        pattern: [
          "glass_acceptance:glass_shard",
          "minecraft:stone",
          null,
          null,
          "glass_acceptance:glass_shard",
          null,
          null,
          null,
          null,
        ],
        result: "glass_acceptance:glass_stone",
        count: 1,
      }
    case "logic":
      if (!entityId) throw new Error("Fixture project entity missing for logic module")
      return {
        kind: "logic",
        entity_id: entityId,
        trigger: "player_near",
        action: "follow",
        item: null,
        animation: null,
        enabled: true,
      }
    case "worldview":
      return {
        kind: "worldview",
        title: "玻璃森林",
        summary: "雾气把月光折成蓝绿色的林间河流。",
        entries: [{ title: "玻璃鹿", body: "玻璃鹿在林缘收集散落的月光碎片。" }],
      }
    case "biome":
      return {
        kind: "biome",
        identifier: "glass_grove",
        name: "玻璃林地",
        description: "冷色雾气覆盖的林地。",
        temperature: 0.4,
        downfall: 0.7,
        effects: { sky: "#88b8c0", fog: "#577277", water: "#6da8b3" },
      }
    case "dimension":
      return {
        kind: "dimension",
        identifier: "glass_realm",
        name: "玻璃界",
        description: "反射月光的静谧空间。",
        sky: "custom",
        has_ceiling: false,
        ambient_light: 0.6,
      }
    case "terrain":
      return {
        kind: "terrain",
        name: "玻璃林地层",
        description: "从苔土到玻璃石的分层。",
        layers: [
          { material: "苔土", depth: 3 },
          { material: "玻璃石", depth: 8 },
        ],
        features: ["月光池", "雾林"],
      }
    default:
      throw new Error(`Unknown fixture module: ${input.task.module}`)
  }
}

async function startFixtureServer() {
  const server = createServer((request, response) => {
    if(request.method === "GET") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({data:[{id:"gpt-6-astra",object:"model"}]})); return }
    const buffers: Buffer[] = []
    request.on("data", (chunk) => buffers.push(Buffer.from(chunk)))
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(buffers).toString()) as {
        model?: string
        text?: { format?: { schema?: { properties?: Record<string, unknown> } } }
        input: { content: { text: string }[] }[]
      }
      // Before any work Studio asks the model whether it sees pictures (a red square, `probeVision`): not JSON, and answered as a model with eyes would.
      if (!String(body.input?.[0]?.content?.[0]?.text ?? "").trimStart().startsWith("{")) {
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify({ model: body.model, status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ colour: "red" }) }] }] }))
        return
      }
      const input = JSON.parse(String(body.input?.[0]?.content?.[0]?.text ?? "")) as {
        task?: { module: string }
        project?: { entities?: { id: string }[] }
      }
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          model: body.model,
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: JSON.stringify(fixtureReply(body, input, () => responseFor(input))) }],
            },
          ],
        }),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Fixture port missing")
  return { server, url: `http://127.0.0.1:${address.port}/v1` }
}

async function launchStudio(directory: string, fixtureUrl: string) {
  const app = await _electron.launch({
    executablePath:
      process.env.STUDIO_PACKAGED_EXECUTABLE || path.join(studioDirectory, "node_modules/electron/dist/electron.exe"),
    args: [
      ...(process.env.STUDIO_PACKAGED_EXECUTABLE ? [] : [studioDirectory]),
      `--user-data-dir=${path.join(directory, "electron")}`,
    ],
    env: {
      ...process.env,
      OPENAI_API_KEY: "fixture-key",
      OPENAI_BASE_URL: fixtureUrl,
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

async function screenshot(page: Page, directory: string, name: string) {
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true, animations: "disabled" })
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const layout = await page.evaluate(() => {
    const width = window.innerWidth
    const elements = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const style = getComputedStyle(element)
        const bounds = element.getBoundingClientRect()
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          bounds.width > 0 &&
          bounds.height > 0 &&
          (bounds.left < -1 || bounds.right > width + 1)
        )
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: element.className,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
      }))
    return {
      width,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      elements,
    }
  })
  expect(layout.documentWidth, `${label}: document must fit viewport`).toBeLessThanOrEqual(layout.width)
  expect(layout.bodyWidth, `${label}: body must fit viewport`).toBeLessThanOrEqual(layout.width)
  expect(layout.elements, `${label}: visible elements must fit viewport`).toEqual([])
}

function projectTree(page: Page) {
  return page.getByRole("navigation", { name: "工程里的东西", exact: true })
}

async function openTreeEntry(page: Page, group: string, title: string) {
  const section = projectTree(page).getByRole("region", { name: group, exact: true })
  const toggle = section.locator(".tree-toggle")
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click()
  await section
    .locator(".inv-slot:not(.inv-empty)")
    .filter({ has: page.locator(".inv-name", { hasText: new RegExp(`^${title}$`) }) })
    .click()
}

const treeGroups: Record<(typeof labels)[number][0], string> = {
  model: "模型 · 贴图 · 动画素材",
  texture: "模型 · 贴图 · 动画素材",
  animation: "模型 · 贴图 · 动画素材",
  block: "方块",
  item: "物品",
  recipe: "配方",
  logic: "玩法",
  worldview: "世界",
  biome: "世界",
  dimension: "世界",
  terrain: "世界",
}

async function openExampleModelWorkspace(page: Page) {
  await openTreeEntry(page, "生物", "玻璃鹿")
  await expect(page.getByRole("region", { name: "做模型", exact: true })).toBeVisible()
  await expect(page.getByRole("region", { name: "模型可视化", exact: true })).toBeVisible()
  await expect(page.locator("canvas").first()).toBeVisible()
}

async function openProject(page: Page, name: string) {
  await page.reload()
  await page.locator(".project-card").filter({ hasText: name }).click()
  await expect(projectTree(page)).toBeVisible()
}

test("后台全场景截图验收：Liquid Glass 工程流与 11 模块", async () => {
  await mkdir(artifactsDirectory, { recursive: true })
  const directory = await mkdtemp(path.join(artifactsDirectory, "glass-acceptance-"))
  const fixture = await startFixtureServer()
  const errors: string[] = []
  const { app, page } = await launchStudio(directory, fixture.url)
  await writeFile(
    path.join(directory, "acceptance-manifest.json"),
    JSON.stringify(
      {
        kind: "background-scene-gallery",
        fixture: "local-http-openai-compatible",
        real_cloud_api: false,
        hidden_electron: true,
        packaged_executable: process.env.STUDIO_PACKAGED_EXECUTABLE || null,
        modules: labels.map(([module]) => module),
        scenes: [
          "project-list",
          "new-project",
          "overview",
          "commands",
          "modules",
          "model-editor",
          "texture-editor",
          "animation-editor",
          "build",
          "settings",
          "1024",
        ],
      },
      null,
      2,
    ),
  )
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  const projectName = "玻璃森林截图验收"
  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    await screenshot(page, directory, "01-project-list")

    await page.getByRole("button", { name: "开始做", exact: true }).click()
    await expect(page.getByRole("heading", { name: "新建工程", exact: true })).toBeVisible()
    await expect(page.getByLabel("模组 ID", { exact: true })).toBeHidden()
    await page.getByLabel("工程名称", { exact: true }).fill(projectName)
    await screenshot(page, directory, "02-new-project")
    await page.locator(".create-advanced .fold-summary").click()
    await screenshot(page, directory, "03-new-project-advanced")
    await page.getByLabel("模组 ID", { exact: true }).fill("glass_acceptance")
    await page.getByRole("button", { name: "创建工程", exact: true }).click()
    await expect(projectTree(page)).toBeVisible()
    await page.getByRole("button", { name: "高级", exact: true }).click()
    const created = await page.evaluate(
      async (name) => (await window.studio.listProjects()).find((value) => value.project.name === name)!,
      projectName,
    )
    const withEntity = await page.evaluate(async (input) => window.studio.addEntity(input), {
      projectId: created.project.id,
      expectedRevision: created.project.revision,
      name: "玻璃鹿",
    })
    await page.evaluate(async (input) => window.studio.useExample(input), {
      projectId: withEntity.project.id,
      expectedRevision: withEntity.project.revision,
    })
    await page.getByRole("button", { name: "MineMods Studio 首页", exact: true }).click()
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    await expect(page.locator(".project-card").filter({ hasText: projectName })).toBeVisible()
    await screenshot(page, directory, "04-project-list-populated")
    await openProject(page, projectName)
    await expect(page.getByRole("heading", { name: "模组总览" })).toBeVisible()
    await screenshot(page, directory, "05-project-overview")

    await page.getByRole("button", { name: "在制作现场看全部", exact: true }).first().click()
    await page.getByLabel("说一句想做什么", { exact: true }).fill(prompt)
    await page.getByRole("button", { name: "跟 AI 说", exact: true }).click()
    await expect
      .poll(
        async () =>
          (await page.evaluate((id) => window.studio.listProjectRuns({ projectId: id }), created.project.id))[0]?.state,
        { timeout: 30000 },
      )
      .toBe("completed")
    await expect(page.locator(".project-run-task")).toHaveCount(11)
    await expect(page.locator(".project-run-focus-header .project-run-state")).toHaveAttribute(
      "data-state",
      "completed",
    )
    await expect(page.getByRole("button", { name: "停止任务", exact: true })).toHaveCount(0)
    await expect(page.locator(".project-run-task [data-state='completed']")).toHaveCount(11)
    await screenshot(page, directory, "06-project-command")
    await openProject(page, projectName)

    await openExampleModelWorkspace(page)
    await screenshot(page, directory, "07-model-editor-model")
    await page.getByRole("tab", { name: "贴图 / UV", exact: true }).click()
    await expect(page.getByRole("tab", { name: "贴图 / UV", exact: true })).toHaveAttribute("aria-selected", "true")
    await screenshot(page, directory, "08-model-editor-texture")
    await page.getByRole("navigation", { name: "生物制作流程", exact: true }).getByRole("button", { name: "动作" }).click()
    await expect(page.getByRole("slider", { name: "动作时间", exact: true })).toBeVisible()
    await expect(page.getByRole("tab", { name: "动画", exact: true })).toHaveCount(0)
    await screenshot(page, directory, "09-model-editor-animation")

    await page.getByRole("button", { name: "模组总览", exact: true }).click()
    await expect(page.getByRole("heading", { name: "模组总览" })).toBeVisible()

    for (const [module, label] of labels) {
      await openTreeEntry(page, treeGroups[module], `玻璃${label}`)
      await page.getByRole("button", { name: "打开它", exact: true }).click()
      await expect(page.getByRole("region", { name: `${label}工作区`, exact: true })).toBeVisible()
      await expect(page.getByRole("heading", { name: `玻璃${label}`, exact: true })).toBeVisible()
      await screenshot(page, directory, `10-module-${module}`)
    }

    // The title-bar button now builds and opens the game in one press; the menu's command opens the same drawer without starting anything.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith("/index.html"))!.webContents.send("studio:command", "export"))
    const buildPanel = page.getByRole("dialog", { name: `打包模组 · ${projectName}`, exact: true })
    await expect(buildPanel).toBeVisible()
    await expect(buildPanel.getByRole("button", { name: "打包，不打开游戏", exact: true })).toBeEnabled()
    await expect(buildPanel.getByRole("button", { name: /工程文件 \.minemods/ })).toBeEnabled()
    await screenshot(page, directory, "20-build")
    await page.keyboard.press("Escape")
    await expect(buildPanel).toHaveCount(0)
    await page.getByRole("button", { name: "个人设置", exact: true }).click()
    await expect(page.getByRole("heading", { name: "个人设置", exact: true })).toBeVisible()
    await screenshot(page, directory, "22-settings")

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith("/index.html"))!.setContentSize(1024, 768))
    await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1024, 768])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
    await screenshot(page, directory, "23-settings-1024")

    await page.getByRole("button", { name: /^返回工程「/ }).click()
    await expect(page.getByRole("button", { name: "模组总览", exact: true })).toBeVisible()
    await openTreeEntry(page, "配方", "玻璃配方")
    await expect(page.getByRole("region", { name: "配方工作区", exact: true })).toBeVisible()
    await assertNoHorizontalOverflow(page, "recipe-1024")
    await screenshot(page, directory, "24-recipe-1024")

    await openExampleModelWorkspace(page)
    await assertNoHorizontalOverflow(page, "model-editor-1024")
    await screenshot(page, directory, "25-model-editor-1024")
    expect(errors).toEqual([])
  } catch (cause) {
    await screenshot(page, directory, "failure").catch(() => undefined)
    throw cause
  } finally {
    await app.close()
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()))
  }
})
