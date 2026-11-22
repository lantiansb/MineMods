import { test, expect, _electron } from "@playwright/test"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { zip } from "../fixtures/zip"

test("import scan and managed storage work through the desktop interface", async () => {
  const artifacts = path.resolve("../../.artifacts/studio")
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, "import-storage-e2e-"))
  const runtime = path.join(directory, "runtime")
  const source = path.join(directory, "example.jar")
  const exported = path.join(directory, "example.modscan")
  await mkdir(path.join(runtime, "gradle-home"), { recursive: true })
  await writeFile(path.join(runtime, "gradle-home", "cached-artifact.bin"), "cache contents")
  const fixture = zip({
    "fabric.mod.json": JSON.stringify({
      id: "example",
      name: "示例模组",
      version: "1.0.0",
      depends: { minecraft: "1.21.1", fabricloader: ">=0.16.0" },
    }),
    "kubejs/server_scripts/recipes.js": "// Custom recipe script\n",
    "assets/example/models/item/example.json": '{"parent":"minecraft:item/generated"}',
  })
  await writeFile(source, fixture)
  const app = await _electron.launch({
    args: [path.resolve("."), `--user-data-dir=${path.join(directory, "electron")}`],
    env: {
      ...process.env,
      OPENAI_API_KEY: "",
      STUDIO_AI_URL: "",
      STUDIO_SERVICE_TOKEN: "",
      MINEMODS_STUDIO_TEST: "1",
      MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"),
      MINEMODS_STUDIO_RUNTIME: runtime,
      MINEMODS_STUDIO_JAVA_HOME: "",
      JAVA_HOME: "",
    },
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  // Replace only native file selection; scanning, worker IPC, and persistence stay real.
  await app.evaluate(
    ({ dialog }, files) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.source] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: files.exported })
    },
    { source, exported },
  )
  page.on("dialog", (dialog) => void dialog.accept())
  try {
    await page.getByRole("button", { name: /^模组图鉴/ }).click()
    await expect(page.getByRole("heading", { name: "模组图鉴", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "打开模组文件", exact: true }).click()
    await expect(page.locator('section[aria-label="当前模组"] h2[title="example"]')).toBeVisible()
    const tags = page.locator(".workbench-project-tags")
    await expect(tags.getByText("fabric", { exact: true })).toBeVisible()
    await expect(tags.getByText("Minecraft 1.21.1", { exact: true })).toBeVisible()
    const projectId = await page.evaluate(async () => (await window.studio.listImportedProjects())[0]!.manifest.id)
    const scanned = await page.evaluate((id) => window.studio.getImportedProject({ id }), projectId)
    expect(scanned.report.mods.map((mod) => mod.name)).toContain("示例模组")

    // The backpack unpacks a single JAR on open; raw files and the scan report sit behind 高级.
    const backpack = page.locator('section[aria-label="模组背包"]')
    await expect(backpack.getByRole("status")).toHaveCount(0, { timeout: 30000 })
    const projectTabs = page.getByRole("tablist", { name: "模组里的东西" })
    await page.getByRole("button", { name: "高级", exact: true }).click()
    await projectTabs.getByRole("tab", { name: "文件" }).click()
    const workbench = page.locator('section[aria-label="文件工作台"]')
    const extract = workbench.getByRole("button", { name: "拆解所选内容", exact: true })
    await expect(workbench.locator(".iaw-layout").or(extract)).toBeVisible()
    if (await extract.isVisible()) {
      await expect(workbench.getByRole("checkbox")).toBeChecked()
      await extract.click()
    }
    await workbench.getByPlaceholder("搜索名称或路径").fill("recipes")
    await expect(workbench.locator(".iaw-asset")).toHaveCount(1)
    await expect(workbench.locator(".iaw-asset")).toContainText("recipes.js")
    await page.getByRole("heading", { name: "模组图鉴", exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(artifacts, "import-scan.png"), fullPage: true })
    await projectTabs.getByRole("tab", { name: "工程信息" }).click()
    await page.getByRole("button", { name: "导出扫描报告", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "报告已导出" })).toBeVisible()
    expect(JSON.parse(await readFile(exported, "utf8"))).toMatchObject({
      format: "minemods-import-report",
      report: { metadata: { loaders: ["fabric"] } },
    })

    // Storage is its own page now, entered from home.
    await page.getByRole("button", { name: "返回首页", exact: true }).click()
    await page.getByRole("button", { name: /^模组图鉴/ }).click()
    await page.getByRole("button", { name: /^存储空间/ }).click()
    await expect(page.getByRole("heading", { name: "存储空间", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "打开模组文件", exact: true })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Gradle 与打包要用的文件", exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(artifacts, "environment-storage.png"), fullPage: true })
    await page.getByRole("button", { name: "清理这一项", exact: true }).click()
    await expect(
      page.getByText("尚未下载托管环境。可以先创建或导入工程，要打包时再准备。", { exact: true }),
    ).toBeVisible()
    expect(await readdir(runtime)).not.toContain("gradle-home")

    await page.getByRole("button", { name: "返回首页", exact: true }).click()
    await page.getByRole("button", { name: /^模组图鉴/ }).click()
    const library = page.getByRole("complementary", { name: "我的模组" })
    await library.getByRole("button", { name: /^example/ }).click()
    await expect(page.locator('section[aria-label="当前模组"] h2[title="example"]')).toBeVisible()
    await page.locator('section[aria-label="当前模组"]').getByRole("button", { name: "移除", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "已移除。" })).toBeVisible()
    await expect(library.getByText("还没有打开过模组。", { exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.studio.listImportedProjects())).toEqual([])
    expect(await readFile(source)).toEqual(fixture)
    expect(errors).toEqual([])
  } finally {
    await app.close()
    if (path.dirname(path.resolve(directory)) !== artifacts) throw new Error("Unexpected test cleanup path")
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
})
