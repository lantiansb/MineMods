import { test, expect, _electron } from "@playwright/test"
import { deflateSync } from "node:zlib"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { zip } from "../fixtures/zip"

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

const pngChunk = (name: string, data: Uint8Array) => {
  const type = Buffer.from(name)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])))
  return Buffer.concat([length, type, data, checksum])
}

const png = (width: number, height: number) => {
  const pixels = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    pixels[row] = 0
    for (let x = 0; x < width; x++) {
      const offset = row + 1 + x * 4
      pixels[offset] = x < width / 2 ? 222 : 44
      pixels[offset + 1] = y < height / 2 ? 152 : 69
      pixels[offset + 2] = 91
      pixels[offset + 3] = 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
}

test("导入的声音可播放，贴图预览支持缩放与拖动", async () => {
  const artifacts = path.resolve("../../.artifacts/studio")
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, "import-media-e2e-"))
  if (path.dirname(path.resolve(directory)) !== artifacts) throw new Error("Unexpected test cleanup path")
  const source = path.join(directory, "media-fixture.zip")
  const audio = await readFile(path.resolve("test/fixtures/media/tone.wav"))
  const jar = zip({
    "fabric.mod.json": JSON.stringify({
      schemaVersion: 1,
      id: "media_fixture",
      version: "1.0.0",
      name: "Media fixture",
    }),
    "assets/media_fixture/sounds/tone.wav": audio,
    "assets/media_fixture/textures/block/sample.png": png(32, 16),
  })
  await writeFile(
    source,
    zip({
      "pack.mcmeta": '{"pack":{"pack_format":15,"description":"media preview fixture"}}\n',
      "mods/media-fixture.jar": jar,
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
      OPENAI_API_KEY: "",
      OPENAI_BASE_URL: "",
      STUDIO_AI_URL: "",
      STUDIO_SERVICE_TOKEN: "",
      MINEMODS_STUDIO_TEST: "1",
      MINEMODS_STUDIO_WORKSPACE: path.join(directory, "workspace"),
      MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"),
      MINEMODS_STUDIO_JAVA_HOME: "",
      JAVA_HOME: "",
    },
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1220, height: 900 })
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, source)

  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    await page.getByRole("button", { name: /^模组图鉴/ }).click()
    await page.getByRole("button", { name: "打开模组文件", exact: true }).click()
    await expect(page.locator('section[aria-label="当前模组"] h2[title="media-fixture"]')).toBeVisible()
    // The backpack unpacks this small pack on open; wait for it to settle before looking at the files.
    const backpack = page.locator('section[aria-label="模组背包"]')
    await expect(backpack.getByRole("status")).toHaveCount(0, { timeout: 30000 })
    const projectTabs = page.getByRole("tablist", { name: "模组里的东西" })
    await page.getByRole("button", { name: "高级", exact: true }).click()
    await projectTabs.getByRole("tab", { name: "文件" }).click()
    const workbench = page.locator('section[aria-label="文件工作台"]')
    // The library normally opens directly; the chooser only shows if nothing was unpacked yet.
    const extract = workbench.getByRole("button", { name: "拆解所选内容", exact: true })
    await expect(workbench.locator(".iaw-layout").or(extract)).toBeVisible()
    if (await extract.isVisible()) {
      await workbench.locator(".iaw-group-card").filter({ hasText: "media-fixture.jar" }).getByRole("checkbox").check()
      await extract.click()
    }
    await expect(workbench.locator(".iaw-categories button").filter({ hasText: "音频" })).toContainText("1")
    await expect(workbench.locator(".iaw-categories button").filter({ hasText: "贴图" })).toContainText("1")

    await workbench.locator(".iaw-categories button").filter({ hasText: "音频" }).click()
    await workbench.locator(".iaw-asset").filter({ hasText: "tone.wav" }).click()
    const audioPlayer = workbench.locator(".iaw-audio-preview audio")
    await expect(audioPlayer).toBeVisible()
    await expect
      .poll(() => audioPlayer.evaluate((element) => (element as HTMLAudioElement).readyState))
      .toBeGreaterThan(0)
    await expect
      .poll(() => audioPlayer.evaluate((element) => (element as HTMLAudioElement).duration))
      .toBeGreaterThan(0)
    await workbench.getByLabel("循环播放").check()
    await expect(audioPlayer).toHaveJSProperty("loop", true)
    const audioHandle = await audioPlayer.elementHandle()
    await audioPlayer.evaluate((element) => (element as HTMLAudioElement).play())
    await expect
      .poll(() => audioPlayer.evaluate((element) => (element as HTMLAudioElement).currentTime))
      .toBeGreaterThan(0.08)
    await audioPlayer.evaluate((element) => (element as HTMLAudioElement).pause())
    await expect.poll(() => audioPlayer.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true)
    await audioPlayer.evaluate((element) => (element as HTMLAudioElement).play())
    await expect.poll(() => audioPlayer.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(false)
    await projectTabs.getByRole("tab", { name: "工程信息" }).click()
    await expect.poll(() => audioHandle!.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true)
    await projectTabs.getByRole("tab", { name: "文件" }).click()
    const resumedAt = await audioPlayer.evaluate((element) => (element as HTMLAudioElement).currentTime)
    await audioPlayer.evaluate((element) => (element as HTMLAudioElement).play())
    await expect
      .poll(() => audioPlayer.evaluate((element) => (element as HTMLAudioElement).currentTime))
      .toBeGreaterThan(resumedAt + 0.08)

    await workbench.locator(".iaw-categories button").filter({ hasText: "贴图" }).click()
    await workbench.locator(".iaw-asset").filter({ hasText: "sample.png" }).click()
    await expect.poll(() => audioHandle!.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true)
    const texture = workbench.locator(".itv-card")
    await expect(texture).toBeVisible()
    await expect(texture.getByText("32 × 16px", { exact: true })).toBeVisible()
    const viewport = texture.getByRole("application", { name: /贴图画布/ })
    await expect(viewport).toBeVisible()

    const zoomIn = texture.getByRole("button", { name: /放大/ })
    const scaleLabel = texture.getByLabel("缩放倍率")
    const beforeZoom = await scaleLabel.inputValue()
    await zoomIn.click()
    await expect(scaleLabel).not.toHaveValue(beforeZoom)
    await texture.getByRole("button", { name: /100%/ }).click()
    await expect(scaleLabel).toHaveValue("100")
    await texture.getByRole("button", { name: /适应/ }).click()
    await expect(scaleLabel).not.toHaveValue("100")

    const image = texture.locator("img.itv-image")
    const beforeDrag = await image.getAttribute("style")
    const stageBox = await viewport.boundingBox()
    await page.mouse.move(stageBox!.x + stageBox!.width / 2, stageBox!.y + stageBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(stageBox!.x + stageBox!.width / 2 + 45, stageBox!.y + stageBox!.height / 2 + 24)
    await page.mouse.up()
    await expect(image).not.toHaveAttribute("style", beforeDrag!)
    const beforeWheel = await scaleLabel.inputValue()
    await viewport.hover()
    await page.mouse.wheel(0, -240)
    await expect(scaleLabel).not.toHaveValue(beforeWheel)
  } catch (error) {
    console.log(
      `Imported media workbench state:\n${await page
        .locator("body")
        .innerText()
        .catch(() => "<unavailable>")}`,
    )
    await page
      .screenshot({ path: path.join(artifacts, "import-media-failure.png"), fullPage: true })
      .catch(() => undefined)
    throw error
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
})
