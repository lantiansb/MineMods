import { test, expect, _electron } from "@playwright/test"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { zip } from "../fixtures/zip"

const { unzipSync } = createRequire(path.resolve("../mod-core/package.json"))("fflate") as {
  unzipSync: (archive: Uint8Array) => Record<string, Uint8Array>
}

test("整合包作者内容可独立入库并增量拆解模组资产，预览编辑后导出", async () => {
  const artifacts = path.resolve("../../.artifacts/studio")
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, "import-assets-e2e-"))
  if (path.dirname(path.resolve(directory)) !== artifacts) throw new Error("Unexpected test cleanup path")
  const runtime = path.join(directory, "runtime")
  const source = path.join(directory, "asset-fixture.zip")
  const exported = path.join(directory, "asset-fixture-export.zip")
  const texture = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64",
  )
  const nestedJar = zip({
    "assets/sample/models/block/cube.json": JSON.stringify({
      textures: { all: "sample:block/cube" },
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: Object.fromEntries(
            ["north", "south", "east", "west", "up", "down"].map((face) => [face, { texture: "#all" }]),
          ),
        },
      ],
    }),
    "assets/sample/textures/block/cube.png": texture,
  })
  // More than eight content groups, so the backpack asks what to unpack instead of unpacking everything itself.
  const fillerJars = Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `mods/filler-${index + 1}.jar`,
      zip({
        "fabric.mod.json": JSON.stringify({
          schemaVersion: 1,
          id: `filler_${index + 1}`,
          version: "1.0.0",
          name: `Filler ${index + 1}`,
        }),
      }),
    ]),
  )
  const sourceBytes = zip({
    "pack.mcmeta": '{"pack":{"pack_format":15,"description":"asset workbench fixture"}}\n',
    "mods/fixture.jar": nestedJar,
    ...fillerJars,
    "kubejs/server_scripts/startup.js": "// original fixture script\nconsole.log('fixture')\n",
  })
  await writeFile(source, sourceBytes)
  const sourceHash = createHash("sha256").update(sourceBytes).digest("hex")
  const app = await _electron.launch({
    executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE,
    args: [
      ...(process.env.STUDIO_PACKAGED_EXECUTABLE ? [] : [path.resolve(".")]),
      `--user-data-dir=${path.join(directory, "electron")}`,
    ],
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
  await page.setViewportSize({ width: 1220, height: 900 })
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("dialog", (dialog) => void dialog.accept())
  await app.evaluate(
    ({ dialog }, values) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [values.source] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: values.exported })
    },
    { source, exported },
  )

  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    await page.getByRole("button", { name: /^模组图鉴/ }).click()
    await expect(page.getByRole("heading", { name: "模组图鉴", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "打开模组文件", exact: true }).click()
    await expect(page.getByRole("heading", { name: "asset-fixture", exact: true })).toBeVisible()
    const projectTabs = page.getByRole("tablist", { name: "模组里的东西" })
    // A large pack is not unpacked automatically: the backpack waits on its chooser and no catalog exists yet.
    const backpack = page.locator('section[aria-label="模组背包"]')
    await expect(backpack.getByText("这个包里有 10 份东西，想看哪些？", { exact: true })).toBeVisible({ timeout: 30000 })
    await expect(backpack.getByRole("button", { name: "放进背包", exact: true })).toBeEnabled()
    const projectId = await page.evaluate(async () => (await window.studio.listImportedProjects())[0]!.manifest.id)
    expect(await page.evaluate((id) => window.studio.getImportedAssetCatalog({ id }), projectId)).toBeNull()
    await page.getByRole("button", { name: "高级", exact: true }).click()
    await projectTabs.getByRole("tab", { name: "文件" }).click()
    const workbench = page.locator('section[aria-label="文件工作台"]')
    const authorCard = workbench.locator(".iaw-group-card").filter({ hasText: "kubejs" })
    await expect(authorCard).toBeVisible()
    expect(
      await authorCard.evaluate((card) => ({
        overflow: card.scrollWidth > card.clientWidth + 1,
        checkboxWidth: card.querySelector("input")!.getBoundingClientRect().width,
        nameWidth: card.querySelector("strong")!.getBoundingClientRect().width,
      })),
    ).toMatchObject({ overflow: false, checkboxWidth: 16 })
    expect(await authorCard.locator("strong").evaluate((name) => name.getBoundingClientRect().width)).toBeGreaterThan(
      40,
    )
    await authorCard.getByRole("checkbox").check()
    await workbench.getByRole("button", { name: "拆解所选内容", exact: true }).click()
    await expect(workbench.locator(".iaw-categories button").filter({ hasText: "脚本" })).toContainText("1")
    const authorOnly = await page.evaluate((id) => window.studio.getImportedAssetCatalog({ id }), projectId)
    expect(authorOnly?.assets.map((asset) => asset.kind)).toEqual(["script"])
    expect(authorOnly?.assets[0]?.sourcePath).toContain("kubejs/server_scripts/startup.js")

    await workbench.getByRole("button", { name: "选择内容", exact: true }).click()
    const modCard = workbench.locator(".iaw-group-card").filter({ hasText: "fixture.jar" })
    await expect(modCard).toBeVisible()
    await modCard.getByRole("checkbox").check()
    await workbench.getByRole("button", { name: "拆解所选内容", exact: true }).click()
    await expect(workbench.locator(".iaw-categories button").filter({ hasText: "模型" })).toContainText("1")
    await expect(workbench.locator(".iaw-categories button").filter({ hasText: "贴图" })).toContainText("1")
    const fullCatalog = await page.evaluate((id) => window.studio.getImportedAssetCatalog({ id }), projectId)
    expect(fullCatalog?.groups.map((group) => group.name).sort()).toEqual(["fixture.jar", "kubejs"])
    expect(fullCatalog?.assets.map((asset) => asset.kind).sort()).toEqual(["model", "script", "texture"])
    expect(fullCatalog?.assets.find((asset) => asset.kind === "model")?.sourcePath).toContain(
      "fixture.jar!/assets/sample/models/block/cube.json",
    )

    await workbench.locator(".iaw-categories button").filter({ hasText: "模型" }).click()
    await workbench.locator(".iaw-asset").filter({ hasText: "cube.json" }).click()
    const canvas = workbench.locator(".iaw-model-canvas .model-canvas-viewport canvas")
    await expect(canvas).toBeVisible({ timeout: 30000 })
    await expect(workbench.locator(".iaw-model-canvas")).toContainText("贴图 / UV")
    expect(
      await canvas.evaluate((node) => (node as HTMLCanvasElement).width > 0 && (node as HTMLCanvasElement).height > 0),
    ).toBe(true)

    await workbench.locator(".iaw-categories button").filter({ hasText: "贴图" }).click()
    const textureCard = workbench.locator(".iaw-asset").filter({ hasText: "cube.png" })
    await expect(textureCard.locator(".iaw-asset-visual img")).toBeVisible({ timeout: 15000 })
    await textureCard.click()
    await expect(textureCard).toHaveClass(/active/)
    await expect(workbench.locator(".iaw-texture-preview img")).toBeVisible()

    await workbench.locator(".iaw-categories button").filter({ hasText: "脚本" }).click()
    await workbench.locator(".iaw-asset").filter({ hasText: "startup.js" }).click()
    const editor = workbench.getByRole("textbox", { name: "文件的文本" })
    await expect(editor).toHaveValue("// original fixture script\nconsole.log('fixture')\n")
    await editor.fill("// edited through the asset workbench\nconsole.log('saved')\n")
    await expect(editor).toHaveValue("// edited through the asset workbench\nconsole.log('saved')\n")
    await expect(workbench.getByRole("button", { name: "保存文件", exact: true })).toBeEnabled()
    await expect(workbench.getByRole("button", { name: "导出成工程", exact: true })).toBeDisabled()
    await expect(workbench.getByRole("button", { name: "导出成工程", exact: true })).toHaveAttribute(
      "title",
      "请先保存未保存的文本修改，再导出成工程。",
    )
    await projectTabs.getByRole("tab", { name: "工程信息" }).click()
    await projectTabs.getByRole("tab", { name: "文件" }).click()
    await expect(editor).toHaveValue("// edited through the asset workbench\nconsole.log('saved')\n")
    const saveButton = workbench.getByRole("button", { name: "保存文件", exact: true })
    await saveButton.click()
    await expect(saveButton).toBeDisabled()
    await editor.fill("// typed during save\nconsole.log('latest')\n")
    await expect(saveButton).toBeEnabled()
    await expect(editor).toHaveValue("// typed during save\nconsole.log('latest')\n")
    await saveButton.click()
    await expect(editor).toHaveValue("// typed during save\nconsole.log('latest')\n")
    const savedCatalog = await page.evaluate((id) => window.studio.getImportedAssetCatalog({ id }), projectId)
    expect(savedCatalog?.assets.find((asset) => asset.kind === "script")?.sha256).not.toBe(
      authorOnly?.assets[0]?.sha256,
    )

    await workbench.getByRole("button", { name: "导出成工程", exact: true }).click()
    await expect(workbench.locator(".iaw-message[role='status']")).toContainText(exported)
    const bundle = unzipSync(await readFile(exported))
    const manifest = JSON.parse(Buffer.from(bundle["manifest.json"]!).toString("utf8")) as {
      assets: { path: string }[]
    }
    expect(manifest.assets).toHaveLength(3)
    expect(
      Buffer.from(bundle[`files/${savedCatalog!.assets.find((asset) => asset.kind === "script")!.path}`]!).toString(
        "utf8",
      ),
    ).toBe("// typed during save\nconsole.log('latest')\n")
    expect(
      createHash("sha256")
        .update(await readFile(source))
        .digest("hex"),
    ).toBe(sourceHash)
    expect(errors).toEqual([])
  } catch (error) {
    console.log(
      `Import asset workbench state:\n${await page
        .locator("body")
        .innerText()
        .catch(() => "<unavailable>")}`,
    )
    await page
      .screenshot({ path: path.join(artifacts, "import-assets-failure.png"), fullPage: true })
      .catch(() => undefined)
    throw error
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
})

test("模型依赖缺失仍可展开原始资源，切换资产清除旧错误", async () => {
  const artifacts = path.resolve("../../.artifacts/studio")
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, "import-model-source-e2e-"))
  if (path.dirname(path.resolve(directory)) !== artifacts) throw new Error("Unexpected test cleanup path")
  const source = path.join(directory, "missing-parent.jar")
  const raw = JSON.stringify({ parent: "sample:block/missing_parent" })
  await writeFile(
    source,
    zip({
      "fabric.mod.json": JSON.stringify({
        schemaVersion: 1,
        id: "sample",
        version: "1.0.0",
        name: "Missing parent fixture",
      }),
      "assets/sample/models/block/missing.json": raw,
      "assets/sample/data/readme.txt": "Available resource",
    }),
  )
  const app = await _electron.launch({
    executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE,
    args: [
      ...(process.env.STUDIO_PACKAGED_EXECUTABLE ? [] : [path.resolve(".")]),
      `--user-data-dir=${path.join(directory, "electron")}`,
    ],
    env: {
      ...process.env,
      MINEMODS_STUDIO_TEST: "1",
      MINEMODS_STUDIO_WORKSPACE: path.join(directory, "workspace"),
      MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"),
    },
  })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1220, height: 900 })
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
    }, source)
    await page.getByRole("button", { name: /^模组图鉴/ }).click()
    await page.getByRole("button", { name: "打开模组文件", exact: true }).click()
    await expect(page.locator('section[aria-label="当前模组"] h2[title="missing-parent"]')).toBeVisible()
    // A single JAR is unpacked by the backpack on open; wait for it to settle before looking at the files.
    const backpack = page.locator('section[aria-label="模组背包"]')
    await expect(backpack.getByRole("status")).toHaveCount(0, { timeout: 30000 })
    await page.getByRole("button", { name: "高级", exact: true }).click()
    await page.getByRole("tablist", { name: "模组里的东西" }).getByRole("tab", { name: "文件" }).click()
    const workbench = page.locator('section[aria-label="文件工作台"]')
    // The library normally opens directly; the chooser only shows if nothing was unpacked yet.
    const extract = workbench.getByRole("button", { name: "拆解所选内容", exact: true })
    await expect(workbench.locator(".iaw-layout").or(extract)).toBeVisible()
    if (await extract.isVisible()) {
      await expect(workbench.getByRole("checkbox")).toBeChecked()
      await extract.click()
    }
    await workbench.locator(".iaw-asset").filter({ hasText: "missing.json" }).click()
    await expect(workbench.getByRole("alert")).toContainText("missing_parent")
    await workbench.getByText("原始模型文件（查看与编辑）", { exact: true }).click()
    await expect(workbench.getByRole("textbox", { name: "文件的文本" })).toHaveValue(raw)
    await workbench.locator(".iaw-asset").filter({ hasText: "readme.txt" }).click()
    await expect(workbench.getByRole("textbox", { name: "文件的文本" })).toHaveValue("Available resource")
    await expect(workbench.getByRole("alert")).toHaveCount(0)
  } catch (error) {
    console.log(`Missing model resource workbench state:\n${await (await app.firstWindow()).locator("body").innerText().catch(() => "<unavailable>")}`)
    await (await app.firstWindow()).screenshot({ path: path.join(artifacts, "missing-model-resource-failure.png"), fullPage: true }).catch(() => undefined)
    throw error
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
})
