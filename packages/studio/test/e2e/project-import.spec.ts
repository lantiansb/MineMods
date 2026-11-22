import { expect, test, _electron } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp } from "node:fs/promises"
import path from "node:path"

/**
 * 从别的工程导入 in the real window: a main project and two other projects with a boss each (`import-boss-sample.ts`), the entry under 加一样东西, the list,
 * the import, and the creature opened afterwards. The pictures go to MINEMODS_IMPORT_SHOTS (or the run's own folder).
 */
test("加一样东西 → 从别的工程导入：选工程、选东西、看清单、带进来", async () => {
  const directory = await mkdtemp(path.resolve("../../.artifacts/studio/project-import-"))
  const shots = process.env.MINEMODS_IMPORT_SHOTS ?? path.join(directory, "screens")
  await mkdir(shots, { recursive: true })
  const projects = path.join(directory, "projects")
  const bun = process.env.BUN_EXECUTABLE ?? path.join(process.env.USERPROFILE!, ".bun/bin/bun.exe")
  const sample = path.resolve("../mod-core/script/import-boss-sample.ts")
  for (const [folder, theme] of [["霜原", "frost"], ["火山口", "lava"]]) execFileSync(bun, [sample, path.join(projects, folder), theme], { windowsHide: true })
  // r29c: a third project in a folder of its own, outside Studio's projects: picked by its folder and read where it is.
  const elsewhere = path.join(directory, "offload", "thorn", "projects", "荆棘林")
  execFileSync(bun, [sample, elsewhere, "thorn"], { windowsHide: true })
  const app = await _electron.launch({ args: [process.cwd(), `--user-data-dir=${path.join(directory, "electron")}`], env: { ...process.env, OPENAI_API_KEY: "", OPENAI_BASE_URL: "", STUDIO_AI_URL: "", STUDIO_SERVICE_TOKEN: "", MINEMODS_STUDIO_TEST: "1", MINEMODS_STUDIO_WORKSPACE: projects, MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime") } })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const shot = (name: string) => page.screenshot({ path: path.join(shots, `${name}.png`), animations: "disabled" })
  try {
    await page.waitForURL("**/index.html")
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1366, 860))
    await page.evaluate(async () => {
      const { hasApiKey: _has, source: _source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "mcp" })
      await window.studio.createProject({ name: "三章合集", description: "三章 Boss 合成一个模组", modId: "three_chapters", empty: true })
    })
    await page.reload()
    await page.locator(".project-card").filter({ hasText: "三章合集" }).click()
    await page.getByRole("button", { name: "加一样东西", exact: true }).click()
    await page.getByRole("button", { name: "从别的工程导入", exact: true }).click()
    await expect(page.getByText("火山口", { exact: true })).toBeVisible()
    await shot("1-选工程")
    await page.locator(".pji-source").filter({ hasText: "火山口" }).click()
    await page.locator(".pji-group").filter({ hasText: "生物" }).getByText("熔岩魔像").click()
    await shot("2-选东西")
    await page.getByRole("button", { name: "看看会带进来什么", exact: true }).click()
    await expect(page.locator(".pji-table")).toBeVisible()
    await expect(page.locator(".pji-table")).toContainText("做「核心」的配方")
    // r29c: the creature's setting is said apart from the creature itself.
    await expect(page.locator(".pji-table")).toContainText("生物的设定")
    await shot("3-清单")
    await page.getByRole("button", { name: "就这样带进来", exact: true }).click()
    await expect(page.locator(".pji-line").filter({ hasText: "带进来了" })).toBeVisible()
    await shot("4-带进来了")
    await page.getByRole("button", { name: "好的", exact: true }).click()
    await page.locator(".studio-root").press("Escape").catch(() => undefined)
    await expect(page.locator(".inv-slot").filter({ hasText: "熔岩魔像" }).first()).toBeVisible()
    await shot("5-左栏里有了")
    // The second one: names that clash are renamed in the list.
    await page.getByRole("button", { name: "加一样东西", exact: true }).click()
    await page.getByRole("button", { name: "从别的工程导入", exact: true }).click()
    await page.locator(".pji-source").filter({ hasText: "霜原" }).click()
    await page.locator(".pji-group").filter({ hasText: "生物" }).getByText("霜甲巨像").click()
    await page.getByRole("button", { name: "看看会带进来什么", exact: true }).click()
    await expect(page.locator(".pji-table")).toContainText("注册名改成「core_frost_plain」")
    await shot("6-重名改名的清单")
    await page.getByRole("button", { name: "就这样带进来", exact: true }).click()
    await expect(page.locator(".pji-line").filter({ hasText: "带进来了" })).toBeVisible()
    await page.getByRole("button", { name: "好的", exact: true }).click()
    await page.locator(".studio-root").press("Escape").catch(() => undefined)
    // r29c: a project folder elsewhere, chosen in the folder picker (answered here in place of the system's), read where it is.
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog
    }, elsewhere)
    await page.getByRole("button", { name: "加一样东西", exact: true }).click()
    await page.getByRole("button", { name: "从别的工程导入", exact: true }).click()
    await expect(page.locator(".pji-source").filter({ hasText: "荆棘林" })).toHaveCount(0)
    await shot("7-别处的工程文件夹")
    await page.getByRole("button", { name: "选别处的工程文件夹", exact: true }).click()
    await expect(page.locator(".pji-line").filter({ hasText: "从这个文件夹读" })).toContainText("荆棘林")
    await page.locator(".pji-group").filter({ hasText: "生物" }).getByText("荆棘树人").click()
    await shot("8-从文件夹选东西")
    await page.getByRole("button", { name: "看看会带进来什么", exact: true }).click()
    await expect(page.locator(".pji-table")).toBeVisible()
    await page.getByRole("button", { name: "就这样带进来", exact: true }).click()
    await expect(page.locator(".pji-line").filter({ hasText: "带进来了" })).toBeVisible()
    await shot("9-从文件夹带进来了")
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
