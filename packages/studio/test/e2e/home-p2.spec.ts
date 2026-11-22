import { expect, test, _electron } from "@playwright/test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import path from "node:path"

/** P2 on the packaged app: the cover moves and holds still when asked to, two buttons, and 「接着做」 leads into the project. */
test("P2 正式包：封面动效、首页两个按钮、接着做列表", async () => {
  const root = path.resolve("../../.artifacts/studio")
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(path.join(root, "p2-"))
  await mkdir(path.join(directory, "screens"))
  const app = await _electron.launch({ executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE!, args: [`--user-data-dir=${path.join(directory, "electron")}`], env: { ...process.env, MINEMODS_STUDIO_TEST: "1", MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"), MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"), OPENAI_API_KEY: "", OPENAI_BASE_URL: "", STUDIO_AI_URL: "", STUDIO_SERVICE_TOKEN: "" } })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
  const evidence: Record<string, unknown> = { directory }
  const shot = (name: string) => page.screenshot({ path: path.join(directory, "screens", `${name}.png`), scale: "css" })
  const size = async (width: number, height: number) => {
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows().find((window) => /index\.html/.test(window.webContents.getURL()))!.setContentSize(value[0], value[1]), [width, height])
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height])
  }
  const bothSizes = async (name: string) => {
    for (const [width, height] of [[1366, 768], [1920, 1080]]) {
      await size(width, height)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { message: `${name} 在 ${width} 下不能横向滚动` }).toBe(true)
      await page.waitForTimeout(250)
      await shot(`${width}-${name}`)
    }
    await size(1366, 768)
  }
  const animation = (selector: string, pseudo?: string) => page.evaluate(([value, element]) => getComputedStyle(document.querySelector(value!)!, element).animationName, [selector, pseudo] as const)
  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    // Nothing yet: the list is not there, the two buttons are.
    await size(1366, 768)
    const ways = page.locator('nav.title-ways button')
    await expect(ways).toHaveText(["打开或导入工程", "模组图鉴"])
    await expect(page.getByRole("region", { name: "接着做", exact: true })).toHaveCount(0)
    await bothSizes("home-empty")

    // The cover moves.
    expect(await animation('.studio-root[data-page="home"]', "::before")).toBe("mm-cover-pan")
    expect(await animation(".mm-logo-face")).toBe("mm-logo-drop")
    expect(await animation(".mm-splash")).toBe("mm-splash")

    const names = ["第一个工程", "第二个工程", "第三个工程", "第四个工程"]
    for (const name of names) {
      await page.evaluate((value) => window.studio.createProject({ name: value, description: "", empty: true }), name)
      await page.waitForTimeout(20)
    }
    await page.reload()
    const list = page.getByRole("region", { name: "接着做", exact: true })
    await expect(list.locator(".mm-world")).toHaveCount(3)
    await expect(list.locator(".mm-world strong")).toHaveText([names[3]!, names[2]!, names[1]!])
    await expect(list.locator(".mm-world").first()).toHaveClass(/sel/)
    await expect(list.locator(".mm-world small").first()).toContainText("改过")
    await bothSizes("home-worlds")

    // The whole list is one press away and is the one that was there, with rename and delete.
    await list.getByRole("button", { name: "全部工程（4）", exact: true }).click()
    await expect(page.locator(".project-grid .project-card")).toHaveCount(4)
    await expect(page.locator(".project-grid .project-menu")).toHaveCount(4)
    await bothSizes("home-all")
    await list.getByRole("button", { name: "全部工程（4）", exact: true }).click()
    await expect(page.locator(".project-grid")).toHaveCount(0)

    // The two ways that became one button.
    await ways.first().click()
    const dialog = page.getByRole("dialog", { name: "打开或导入工程", exact: true })
    await expect(dialog.getByRole("button", { name: /^打开工程/ })).toBeVisible()
    await expect(dialog.getByRole("button", { name: /^导入工程/ })).toBeVisible()
    await bothSizes("home-open-or-import")
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)

    // Storage is still there, one step on.
    await ways.nth(1).click()
    await expect(page.getByRole("heading", { name: "模组图鉴", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "存储空间", exact: true }).click()
    await expect(page.getByRole("heading", { name: "存储空间", exact: true })).toBeVisible()
    await shot("1366-storage-from-book")
    await page.getByRole("button", { name: "返回首页", exact: true }).click()

    // The person asked for less motion: nothing moves.
    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect.poll(() => animation('.studio-root[data-page="home"]', "::before")).toBe("none")
    expect(await animation(".mm-logo-face")).toBe("none")
    expect(await animation(".mm-splash")).toBe("none")
    expect(await animation(".mm-world-play svg")).toBe("none")
    await bothSizes("home-reduced-motion")
    await page.emulateMedia({ reducedMotion: "no-preference" })

    // A row leads into its project.
    await list.locator(".mm-world").first().click()
    await expect(page.getByRole("navigation", { name: "工程里的东西", exact: true })).toBeVisible()
    await expect(page.locator(".title-project")).toContainText(names[3]!)
    evidence.worlds = names
  } finally {
    await writeFile(path.join(directory, "evidence.json"), JSON.stringify({ ...evidence, errors }, null, 2))
    await app.close()
  }
  expect(errors).toEqual([])
})
