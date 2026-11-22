import { test, expect, _electron } from "@playwright/test"
import { createRequire } from "node:module"
import { createHash as sha256 } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { zip } from "../fixtures/zip"

const { unzipSync } = createRequire(path.resolve("../mod-core/package.json"))("fflate") as {
  unzipSync: (archive: Uint8Array) => Record<string, Uint8Array>
}

test("通用逆向工程可还原、浏览编辑并导出及恢复小型资源 ZIP", async () => {
  const artifacts = path.resolve("../../.artifacts/studio")
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, "reverse-project-e2e-"))
  if (path.dirname(path.resolve(directory)) !== artifacts) throw new Error("Unexpected test cleanup path")
  const runtime = path.join(directory, "runtime")
  const source = path.join(directory, "reverse-fixture.zip")
  const modifiedArchive = path.join(directory, "reverse-fixture-modified.zip")
  const projectBundle = path.join(directory, "reverse-fixture.modreverse")
  const iconPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64",
  )
  const nestedMod = zip({
    "fabric.mod.json": JSON.stringify({
      schemaVersion: 1,
      id: "fixturemod",
      version: "1.0.0",
      name: "Fixture Mod",
      depends: { minecraft: "1.20.1", fabricloader: ">=0.15.0" },
    }),
    "assets/fixturemod/textures/item/fixture_icon.png": iconPng,
    "assets/fixturemod/textures/item/readme.txt": "resource evidence\n",
  })
  const sourceBytes = zip({
    "pack.mcmeta": '{"pack":{"pack_format":15,"description":"generic reverse fixture"}}\n',
    "data/any_namespace/settings.json": '{"cooldown":20}\n',
    "assets/any_namespace/textures/readme.txt": "resource evidence\n",
    "mods/fixturemod.jar": nestedMod,
  })
  await writeFile(source, sourceBytes)
  const originalHash = sha256("sha256").update(sourceBytes).digest("hex")
  const app = await _electron.launch({
    args: [path.resolve("."), `--user-data-dir=${path.join(directory, "electron")}`],
    env: {
      ...process.env,
      OPENAI_API_KEY: "",
      OPENAI_BASE_URL: "",
      STUDIO_AI_URL: "",
      STUDIO_SERVICE_TOKEN: "",
      MINEMODS_STUDIO_TEST: "1",
      MINEMODS_STUDIO_WORKSPACE: path.join(directory, "workspace"),
      MINEMODS_STUDIO_RUNTIME: runtime,
      MINEMODS_STUDIO_JAVA_HOME: "",
      JAVA_HOME: "",
    },
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1000, height: 900 })
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const openPaths = [source, projectBundle]
  const savePaths = [modifiedArchive, projectBundle]
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.open.shift()!] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.save.shift()! })
    },
    { open: openPaths, save: savePaths },
  )

  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    await page.evaluate(async () => {
      const previous = await window.studio.getConnection()
      const { hasApiKey: _hasApiKey, source: _source, ...settings } = previous
      await window.studio.saveConnection({ ...settings, mode: "mcp" })
    })
    await page.getByRole("button", { name: /^模组图鉴/ }).click()
    await expect(page.getByRole("heading", { name: "模组图鉴", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "打开模组文件", exact: true }).click()
    await expect(page.locator('section[aria-label="当前模组"] h2[title="reverse-fixture"]')).toBeVisible()
    const projectTabs = page.getByRole("tablist", { name: "模组里的东西" })
    const advanced = page.getByRole("button", { name: "高级", exact: true })
    const assertNoWorkbenchHorizontalOverflow = async () => {
      const overflow = await page.evaluate(() => {
        const selector = [
          ".workbench-pane:not([hidden])",
          ".workbench-card",
          ".import-backpack",
          ".bp-chest",
          ".bp-grid",
          ".bp-card",
          ".reverse-module-grid",
          ".reverse-module-card",
          ".reverse-browser",
          ".reverse-file-list",
          ".reverse-editor",
          ".reverse-image-preview",
        ].join(",")
        return [...document.querySelectorAll<HTMLElement>(selector)]
          .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1)
          .map((element) => ({
            className: element.className,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          }))
      })
      expect(overflow).toEqual([])
    }
    // Players get two tabs; repacking and scan details appear with 高级.
    await expect(projectTabs.getByRole("tab", { name: "背包" })).toHaveAttribute("aria-selected", "true")
    await expect(projectTabs.getByRole("tab")).toHaveCount(2)
    const backpack = page.locator('section[aria-label="模组背包"]')
    const categories = backpack.getByRole("tablist", { name: "背包分类" })
    await expect(categories).toBeVisible({ timeout: 30000 })
    await expect(advanced).toHaveAttribute("aria-pressed", "false")
    await advanced.click()
    await expect(advanced).toHaveAttribute("aria-pressed", "true")
    for (const tab of ["背包", "玩法", "文件", "改包", "工程信息"])
      await expect(projectTabs.getByRole("tab", { name: tab })).toBeVisible()
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 1000)
    await assertNoWorkbenchHorizontalOverflow()
    const originalProjectId = await page.evaluate(
      async () => (await window.studio.listImportedProjects())[0]!.manifest.id,
    )

    const panel = page.locator('section[aria-label="通用逆向工程"]')
    await projectTabs.getByRole("tab", { name: "改包" }).click()
    await panel.getByRole("button", { name: /^模块/ }).click()
    await panel.getByRole("button", { name: "一键还原源码与资源", exact: true }).click()
    await panel.getByRole("button", { name: /^任务记录/ }).click()
    await expect(panel.getByText(/处理完成/)).toBeVisible({ timeout: 30000 })
    await panel.getByRole("button", { name: /^模块/ }).click()
    await panel.getByRole("button", { name: /^文件/ }).click()
    await expect(panel.getByRole("button", { name: "settings.json" })).toBeVisible()

    await panel.getByRole("button", { name: "settings.json" }).click()
    const editor = panel.getByRole("textbox", { name: "文件内容", exact: true })
    await expect(editor).toHaveValue('{"cooldown":20}\n')
    await editor.fill('{"cooldown":45}\n')
    // Keep the real readback pending while the person starts their next edit. No contents are mocked.
    await page.evaluate(() => {
      const read = window.studio.readReverseFile
      const edit = window.studio.editReverseFiles
      let saved = false
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      Object.assign(window, { releaseReverseSaveRead: release })
      window.studio.editReverseFiles = async (input) => {
        const result = await edit(input)
        saved = true
        return result
      }
      window.studio.readReverseFile = async (input) => {
        const result = await read(input)
        if (saved) {
          await gate
          window.studio.readReverseFile = read
          window.studio.editReverseFiles = edit
        }
        return result
      }
    })
    await panel.getByRole("button", { name: "保存文本修改", exact: true }).click()
    await expect(editor).toHaveValue('{"cooldown":45}\n')
    await expect(panel.getByRole("status")).toContainText("文件修改已保存")

    await editor.fill('{"cooldown":47}\n')
    await expect(editor).toHaveValue('{"cooldown":47}\n')
    await page.evaluate(() => (window as unknown as { releaseReverseSaveRead: () => void }).releaseReverseSaveRead())
    await expect(panel.getByRole("button", { name: "保存文本修改", exact: true })).toBeEnabled()
    await expect(editor).toHaveValue('{"cooldown":47}\n')
    const imagePath = await page.evaluate(async (id) => {
      const files = await window.studio.listReverseFiles({ id })
      return files.find((file) => file.path.endsWith("fixture_icon.png"))?.path ?? null
    }, originalProjectId)
    expect(imagePath).toBeTruthy()
    await panel.getByRole("button", { name: /^模块/ }).click()
    await panel.getByRole("button", { name: /^文件/ }).click()
    await expect(editor).toHaveValue('{"cooldown":47}\n')

    // The unsaved draft survives a trip to the backpack, where the nested mod's texture has its own slot.
    await projectTabs.getByRole("tab", { name: "背包" }).click()
    await assertNoWorkbenchHorizontalOverflow()
    await categories.getByRole("tab", { name: /^模型与贴图/ }).click()
    await backpack.getByRole("searchbox", { name: "在背包里搜索" }).fill("fixture_icon")
    await backpack.locator(".bp-grid").getByRole("button", { name: "Fixture Icon", exact: true }).click()
    const textureCard = backpack.getByRole("dialog", { name: "Fixture Icon", exact: true })
    await expect(textureCard).toBeVisible()
    await expect(textureCard.locator(".bp-kind")).toContainText("贴图")
    await expect(textureCard.locator(".bp-id")).toHaveText("fixturemod:item/fixture_icon")
    await expect(textureCard.locator(".bp-stage img")).toBeVisible({ timeout: 15000 })
    await assertNoWorkbenchHorizontalOverflow()
    await textureCard.getByRole("button", { name: "关闭", exact: true }).click()
    await expect(textureCard).toHaveCount(0)
    await projectTabs.getByRole("tab", { name: "改包" }).click()
    await expect(editor).toHaveValue('{"cooldown":47}\n')
    await editor.fill('{"cooldown":45}\n')
    await expect(editor).toHaveValue('{"cooldown":45}\n')
    await expect(panel.getByRole("button", { name: "保存文本修改", exact: true })).toBeDisabled()
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(async ({ id, path }) => window.studio.readReverseFile({ id, path }), {
              id: originalProjectId,
              path: "archive/data/any_namespace/settings.json",
            })
          ).content,
      )
      .toBe('{"cooldown":45}\n')
    await panel.getByRole("button", { name: /^文件/ }).click()
    await expect(panel.getByRole("button", { name: "fixture_icon.png" })).toBeVisible()
    await panel.getByRole("button", { name: "fixture_icon.png" }).click()
    await expect(panel.getByRole("img", { name: imagePath! })).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 1440)
    await assertNoWorkbenchHorizontalOverflow()

    await panel.getByRole("button", { name: /^AI修改/ }).click()
    await panel.getByRole("button", { name: "分析逆向工程", exact: true }).click()
    await expect(panel.getByText(/正在等你的 AI/)).toBeVisible()
    const waitingRun = await page.evaluate(
      async (id) => (await window.studio.getReverseState({ id })).runs[0]!,
      originalProjectId,
    )
    await panel.getByText("正在等你的 AI · 查看连接信息", { exact: true }).click()
    await expect(panel.getByText(originalProjectId, { exact: true })).toBeVisible()
    await expect(panel.getByText(waitingRun.id, { exact: true })).toBeVisible()
    await expect(panel.getByRole("button", { name: "复制工程 ID", exact: true })).toBeVisible()
    await expect(panel.getByRole("button", { name: "复制任务 ID", exact: true })).toBeVisible()
    await panel.getByRole("button", { name: "取消分析", exact: true }).click()

    await panel.getByRole("button", { name: "导出完整包", exact: true }).click()
    await expect(panel.getByRole("status").filter({ hasText: "已导出：" })).toBeVisible()
    const entries = unzipSync(await readFile(modifiedArchive))
    expect(Buffer.from(entries["data/any_namespace/settings.json"]!).toString()).toBe('{"cooldown":45}\n')
    expect(Buffer.from(entries["assets/any_namespace/textures/readme.txt"]!).toString()).toBe("resource evidence\n")
    expect(
      sha256("sha256")
        .update(await readFile(source))
        .digest("hex"),
    ).toBe(originalHash)

    await panel.getByRole("button", { name: "导出逆向工程 .modreverse", exact: true }).click()
    await expect(panel.getByRole("status").filter({ hasText: "已导出：" })).toBeVisible()
    await expect(panel.getByLabel("导出告警")).toContainText("The bundle includes the original archive")
    await page.getByRole("button", { name: "打开模组文件", exact: true }).click()
    await expect
      .poll(async () => (await page.evaluate(() => window.studio.listImportedProjects())).length)
      .toBeGreaterThan(1)
    const restored = await page.evaluate(
      async ({ originalProjectId, hash }) =>
        (await window.studio.listImportedProjects()).find(
          (item) =>
            item.manifest.id !== originalProjectId &&
            item.manifest.source.sha256 === hash &&
            item.manifest.source.filename.endsWith(".zip"),
        ),
      { originalProjectId, hash: originalHash },
    )
    expect(restored).toBeTruthy()
    expect(restored!.manifest.id).not.toBe(originalProjectId)
    await expect(page.locator('section[aria-label="当前模组"] h2[title="reverse-fixture"]')).toBeVisible()
    // Both projects have the same title. Wait for the restored identity before switching its tools.
    await expect(page.getByText(restored!.manifest.id, { exact: true })).toBeAttached()
    await projectTabs.getByRole("tab", { name: "工程信息" }).click()
    await expect(page.getByText(restored!.manifest.id, { exact: true })).toBeVisible()
    // 高级 is one switch for the whole app: the restored project opens with it still on.
    await expect(advanced).toHaveAttribute("aria-pressed", "true")
    const restoredPanel = page.locator('section[aria-label="通用逆向工程"]')
    await projectTabs.getByRole("tab", { name: "改包" }).click()
    await restoredPanel.getByRole("button", { name: /^文件/ }).click()
    const restoredFile = restoredPanel.getByRole("button", { name: "settings.json" })
    await expect(restoredFile).toBeVisible()
    await restoredFile.click()
    await expect(restoredPanel.getByRole("textbox", { name: "文件内容", exact: true })).toHaveValue('{"cooldown":45}\n')
    await page.screenshot({ path: path.join(artifacts, "reverse-project.png"), fullPage: true, animations: "disabled" })
    expect(
      sha256("sha256")
        .update(await readFile(source))
        .digest("hex"),
    ).toBe(originalHash)
    expect(errors).toEqual([])
  } catch (error) {
    console.log(
      `Reverse project page state:\n${await page
        .locator("body")
        .innerText()
        .catch(() => "<unavailable>")}`,
    )
    await page
      .screenshot({ path: path.join(artifacts, "reverse-project-failure.png"), fullPage: true })
      .catch(() => undefined)
    throw error
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
})
