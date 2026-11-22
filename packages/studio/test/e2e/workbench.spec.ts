import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import path from "node:path"

const studioDirectory = path.resolve(process.cwd())
const artifactsDirectory = path.resolve(studioDirectory, "../../.artifacts/studio")

async function launchStudio(directory: string) {
  const app = await _electron.launch({
    executablePath: path.join(studioDirectory, "node_modules/electron/dist/electron.exe"),
    args: [studioDirectory, `--user-data-dir=${path.join(directory, "electron")}`],
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
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
  await page.emulateMedia({ reducedMotion: "reduce" })
  return { app, page }
}

async function createExampleProject(page: Page) {
  const project = await page.evaluate(async () => {
    const created = await window.studio.createProject({
      name: "工作台验收工程",
      description: "A/B workbench fixture",
      empty: false,
    })
    const example = await window.studio.useExample({ projectId: created.project.id, expectedRevision: created.project.revision })
    // This specimen exercises the surviving legacy behavior route, shown only for a project with a saved brief.
    return window.studio.saveConception({ projectId: example.project.id, expectedRevision: example.project.revision, conception: { ...example.project.conception, brief: "A/B workbench legacy creature brief" } })
  })
  await page.reload()
  await page
    .getByRole("button", { name: /工作台验收工程/ })
    .first()
    .click()
  await page.getByRole("navigation", { name: "工程里的东西", exact: true }).waitFor()
  return project.project.id
}

async function openEntityWorkbench(page: Page) {
  const projectTree = page.getByRole("navigation", { name: "工程里的东西", exact: true })
  await expect(projectTree).toBeVisible()
  await projectTree.getByRole("region", { name: "生物", exact: true }).locator(".inv-slot").first().click()
  if (await page.getByRole("button", { name: "打开它", exact: false }).isVisible()) await page.getByRole("button", { name: "打开它", exact: false }).click()
  if (!(await page.getByRole("region", { name: "做模型", exact: true }).isVisible())) await page.getByRole("navigation", {name:"生物制作流程",exact:true}).getByRole("button",{name:"外观",exact:true}).click()
  await expect(page.getByRole("region", { name: "做模型", exact: true })).toBeVisible()
}

async function assertViewportLayout(page: Page, width: number, height: number, screenshot: string) {
  const layout = await page.evaluate(() => {
    const selectors = ["nav[aria-label='工程里的东西']", "nav[aria-label='生物制作流程']", "section[aria-label='做模型']"]
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      nodes: selectors.map((selector) => {
        const node = document.querySelector<HTMLElement>(selector)
        const bounds = node?.getBoundingClientRect()
        return {
          selector,
          present: Boolean(node),
          left: bounds?.left ?? -1,
          right: bounds?.right ?? -1,
          top: bounds?.top ?? -1,
          bottom: bounds?.bottom ?? -1,
        }
      }),
    }
  })
  expect(layout.width).toBe(width)
  expect(layout.height).toBe(height)
  expect(layout.documentWidth, "workbench must not scroll horizontally").toBeLessThanOrEqual(width)
  for (const node of layout.nodes) {
    expect(node.present, `${node.selector} must be present`).toBe(true)
    expect(node.left, `${node.selector} left edge`).toBeGreaterThanOrEqual(0)
    expect(node.right, `${node.selector} right edge`).toBeLessThanOrEqual(width)
  }
  await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" })
  if (process.env.STUDIO_WORKBENCH_VISUAL === "1")
    await expect(page).toHaveScreenshot(path.basename(screenshot), { animations: "disabled", caret: "hide" })
}

test("workbench keeps project context while guiding the selected entity through three steps", async () => {
  await mkdir(artifactsDirectory, { recursive: true })
  const directory = await mkdtemp(path.join(artifactsDirectory, "workbench-e2e-"))
  const errors: string[] = []
  const { app, page } = await launchStudio(directory)
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  try {
    const projectId = await createExampleProject(page)
    await page.getByRole("button", { name: "高级", exact: true }).click()
    await openEntityWorkbench(page)

    const projectNavigation = page.getByRole("navigation", { name: "工程里的东西", exact: true })
    const stepNavigation = page.locator("nav[aria-label='生物制作流程']")
    await expect(projectNavigation).toBeVisible()
    await expect(stepNavigation).toBeVisible()
    await expect(stepNavigation.getByRole("button", { name: /外观/ })).toBeVisible()
    await expect(stepNavigation.getByRole("button", { name: /动作/ })).toBeVisible()
    await expect(stepNavigation.getByRole("button", { name: /行为/ })).toBeVisible()
    await expect(stepNavigation.locator("[aria-current='step']")).toHaveCount(1)

  await expect(page.getByRole("region", { name: "做模型", exact: true })).toBeVisible()
    await expect(page.locator("canvas").first()).toBeVisible()
    await expect(page.locator("iframe")).toHaveCount(0)

    const identityBefore = await page.evaluate((id) => window.studio.openProject(id), projectId)
    expect(identityBefore.project.id).toBe(projectId)
    expect(identityBefore.project.entities).toHaveLength(1)

    await page.getByLabel("跟 AI 说这个模型", { exact: true }).fill("把尾巴做得更长，保留其他部位。")
    await stepNavigation.getByRole("button", { name: /动作/ }).click()
    await expect(stepNavigation.getByRole("button", { name: /动作/ })).toHaveAttribute("aria-current", "step")
    await expect(
      page.getByRole("heading", { name: identityBefore.project.entities[0].name, exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel("跟 AI 说这个模型", { exact: true })).toHaveValue("把尾巴做得更长，保留其他部位。")
    await stepNavigation.getByRole("button", { name: /行为/ }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "留在这里", exact: true }).click()
    await expect(stepNavigation.getByRole("button", { name: /动作/ })).toHaveAttribute("aria-current", "step")
    await expect(page.getByLabel("跟 AI 说这个模型", { exact: true })).toHaveValue("把尾巴做得更长，保留其他部位。")
    await page.getByLabel("跟 AI 说这个模型", { exact: true }).fill("")
    await stepNavigation.getByRole("button", { name: /行为/ }).click()
    await expect(stepNavigation.getByRole("button", { name: /行为/ })).toHaveAttribute("aria-current", "step")
    await stepNavigation.getByRole("button", { name: /外观/ }).click()
    await expect(stepNavigation.getByRole("button", { name: /外观/ })).toHaveAttribute("aria-current", "step")

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith("/index.html"))!.setContentSize(1440, 900))
    await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1440, 900])
    await assertViewportLayout(page, 1440, 900, path.join(directory, "workbench-1440.png"))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith("/index.html"))!.setContentSize(1024, 768))
    await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1024, 768])
    await assertViewportLayout(page, 1024, 768, path.join(directory, "workbench-1024.png"))

    // The title-bar button now builds and opens the game in one press; the menu's command opens the same drawer without starting anything.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("studio:command", "export"))
    const build = page.getByRole("dialog", { name: /打包模组/ })
    await expect(build).toBeVisible()
    await page.screenshot({ path: path.join(directory, "build-drawer-1024.png"), animations: "disabled" })
    await page.keyboard.press("Escape")
    await expect(build).toBeHidden()

  await expect(page.getByRole("region", { name: "做模型", exact: true })).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("studio:command", "export"))
    await page.getByRole("button", { name: "关闭打包抽屉", exact: true }).click()
    await expect(build).toBeHidden()

    expect(errors).toEqual([])
  } catch (error) {
    const body = await page
      .locator("body")
      .innerText()
      .catch(() => "")
    await page
      .screenshot({ path: path.join(directory, "failure.png"), fullPage: true, animations: "disabled" })
      .catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}\n\nBODY TEXT:\n${body.slice(0, 12000)}`)
  } finally {
    await writeFile(path.join(directory, "renderer-errors.json"), JSON.stringify(errors, null, 2))
    // A failed assertion can leave an unsent prompt. Discard only this fixture's draft before closing it.
    await page.getByLabel("跟 AI 说这个模型", { exact: true }).fill("").catch(() => undefined)
    await app.close()
  }
})
