import { test, expect, _electron } from "@playwright/test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { deflateSync } from "node:zlib"
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
  const type = Buffer.from(name),
    length = Buffer.alloc(4),
    checksum = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])))
  return Buffer.concat([length, type, data, checksum])
}

const png = (width: number, height: number) => {
  const pixels = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    pixels[row] = 0
    for (let x = 0; x < width; x++) {
      const pixel = row + 1 + x * 4
      pixels[pixel] = x < width / 2 ? 220 : 54
      pixels[pixel + 1] = y < height / 2 ? 146 : 72
      pixels[pixel + 2] = 104
      pixels[pixel + 3] = 255
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

const toneWav = () => {
  const sampleRate = 8000,
    count = 3200,
    dataBytes = count * 2,
    wav = Buffer.alloc(44 + dataBytes)
  wav.write("RIFF", 0)
  wav.writeUInt32LE(36 + dataBytes, 4)
  wav.write("WAVEfmt ", 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write("data", 36)
  wav.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < count; index++)
    wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 6500), 44 + index * 2)
  return wav
}

test("模组背包从导入资源建立真实关系并可在文件里打开", async () => {
  const artifacts = path.resolve("../../.artifacts/studio")
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, "import-asset-graph-e2e-"))
  if (path.dirname(path.resolve(directory)) !== artifacts) throw new Error("Unexpected test cleanup path")
  const source = path.join(directory, "graph-fixture.zip")
  const jar = zip({
    "fabric.mod.json": JSON.stringify({
      schemaVersion: 1,
      id: "sample",
      version: "1.0.0",
      name: "Asset graph fixture",
    }),
    "assets/sample/models/block/cube.json": JSON.stringify({ textures: { all: "sample:block/cube" } }),
    "assets/sample/textures/block/cube.png": png(32, 64),
    "assets/sample/textures/block/cube.png.mcmeta": JSON.stringify({ animation: { frametime: 2, frames: [0, 1] } }),
    "assets/sample/sounds.json": JSON.stringify({ "sample:fixture.roar": { sounds: ["sample:tone"] } }),
    "assets/sample/sounds/tone.wav": toneWav(),
    "data/sample/worldgen/biome/test.json": JSON.stringify({ spawners: { creature: [{ type: "sample:animal" }] } }),
    "data/sample/dimension/test.json": JSON.stringify({
      generator: { biome_source: { type: "minecraft:fixed", biome: "sample:test" } },
    }),
  })
  await writeFile(
    source,
    zip({
      "pack.mcmeta": '{"pack":{"pack_format":15,"description":"asset graph fixture"}}\n',
      "mods/graph-fixture.jar": jar,
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
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, source)

  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    await page.getByRole("button", { name: /^模组图鉴/ }).click()
    await expect(page.getByRole("heading", { name: "模组图鉴", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "打开模组文件", exact: true }).click()
    await expect(page.locator('section[aria-label="当前模组"] h2[title="graph-fixture"]')).toBeVisible()
    const tabs = page.getByRole("tablist", { name: "模组里的东西" })
    await expect(tabs.getByRole("tab", { name: "背包" })).toHaveAttribute("aria-selected", "true")
    await expect(tabs.getByRole("tab", { name: "文件" })).toHaveCount(0)

    // One nested jar is a small source, so the backpack unpacks and sorts it without asking.
    const backpack = page.locator('section[aria-label="模组背包"]')
    const categories = backpack.getByRole("tablist", { name: "背包分类" })
    await expect(categories).toBeVisible({ timeout: 30000 })
    await expect(backpack.getByRole("button", { name: "放进背包", exact: true })).toHaveCount(0)
    const projectId = await page.evaluate(async () => (await window.studio.listImportedProjects())[0]!.manifest.id)

    const graph = await page.evaluate((id) => window.studio.getImportAssetGraph({ id }), projectId)
    const biome = graph?.nodes.find(
      (node) => node.kind === "biome" && node.resourceId === "sample:test" && node.sourceAssetId,
    )
    const dimension = graph?.nodes.find(
      (node) => node.kind === "dimension" && node.resourceId === "sample:test" && node.sourceAssetId,
    )
    const sound = graph?.nodes.find((node) => node.kind === "sound" && node.resourceId === "sample:fixture.roar")
    const audio = graph?.nodes.find(
      (node) => node.kind === "audio" && node.resourceId === "sample:tone" && node.sourceAssetId,
    )
    const model = graph?.nodes.find(
      (node) => node.kind === "model" && node.resourceId === "sample:block/cube" && node.sourceAssetId,
    )
    const texture = graph?.nodes.find(
      (node) => node.kind === "texture" && node.resourceId === "sample:block/cube" && node.sourceAssetId,
    )
    const frameAnimation = graph?.nodes.find(
      (node) => node.kind === "animation" && node.metadata.animationMode === "texture_frames",
    )
    expect(biome).toBeTruthy()
    expect(dimension).toBeTruthy()
    expect(sound).toBeTruthy()
    expect(audio).toBeTruthy()
    expect(model).toBeTruthy()
    expect(texture).toBeTruthy()
    expect(frameAnimation).toBeTruthy()
    expect(graph?.edges).toContainEqual(
      expect.objectContaining({ from: dimension?.id, to: biome?.id, type: "references" }),
    )
    expect(graph?.edges).toContainEqual(
      expect.objectContaining({ from: sound?.id, to: audio?.id, type: "plays_sound" }),
    )
    expect(graph?.edges).toContainEqual(
      expect.objectContaining({ from: model?.id, to: texture?.id, type: "uses_texture" }),
    )

    await expect(categories.getByRole("tab", { name: /^生物/ })).toHaveCount(0)
    await expect(categories.getByRole("tab", { name: /^世界/ })).toContainText("2")
    await expect(categories.getByRole("tab", { name: /^动作与声音/ })).toContainText("3")
    // Raw models, textures and code-level entries stay out of the way until 高级 is on.
    await expect(categories.getByRole("tab", { name: /^模型与贴图/ })).toHaveCount(0)
    await expect(categories.getByRole("tab", { name: /^其他/ })).toHaveCount(0)
    const advanced = page.getByRole("button", { name: "高级", exact: true })
    await advanced.click()
    await expect(advanced).toHaveAttribute("aria-pressed", "true")
    await expect(categories.getByRole("tab", { name: /^生物/ })).toContainText("1")

    const grid = backpack.locator(".bp-grid")
    const search = backpack.getByRole("searchbox", { name: "在背包里搜索" })
    const card = backpack.getByRole("dialog")
    const related = (label: string) => card.locator(".bp-related").filter({ hasText: label })
    const closeCard = async () => {
      await card.getByRole("button", { name: "关闭", exact: true }).click()
      await expect(card).toHaveCount(0)
    }

    // The creature is only mentioned by the biome spawner; its card links to where it appears.
    await categories.getByRole("tab", { name: /^生物/ }).click()
    await grid.getByRole("button", { name: "Animal", exact: true }).click()
    await expect(backpack.getByRole("dialog", { name: "Animal", exact: true })).toBeVisible()
    await expect(card.locator(".bp-kind")).toContainText("生物")
    await expect(card.locator(".bp-kind")).toContainText("模组里只提到了它，本体在原版游戏或别的模组里")
    await expect(card.locator(".bp-id")).toHaveText("sample:animal")
    await expect(card.getByRole("button", { name: "复制提问，去问 AI", exact: true })).toBeEnabled()
    await related("出现在").getByRole("button", { name: "Test", exact: true }).click()

    // Biome -> dimension, following related slots inside the card and stepping back again.
    await expect(backpack.getByRole("dialog", { name: "Test", exact: true })).toBeVisible()
    await expect(card.locator(".bp-kind")).toContainText("生物群系")
    await expect(related("这里会出现").getByRole("button", { name: "Animal", exact: true })).toBeVisible()
    await related("来自").getByRole("button", { name: "Test", exact: true }).click()
    await expect(card.locator(".bp-kind")).toContainText("维度")
    await expect(related("相关的东西").getByRole("button", { name: "Test", exact: true })).toBeVisible()
    await card.getByRole("button", { name: "← 返回", exact: true }).click()
    await expect(card.locator(".bp-kind")).toContainText("生物群系")
    await closeCard()

    await categories.getByRole("tab", { name: /^世界/ }).click()
    await expect(grid.getByRole("button", { name: "Test", exact: true })).toHaveCount(2)

    // Texture frame animation, found by its original name.
    await categories.getByRole("tab", { name: /^动作与声音/ }).click()
    await expect(grid.locator(".bp-slot")).toHaveCount(3)
    await search.fill("帧动画")
    await expect(grid.locator(".bp-slot")).toHaveCount(1)
    await grid.locator(".bp-slot").click()
    await expect(card.locator(".bp-kind")).toContainText("动作")
    await expect(card.locator(".bp-kind")).toContainText("一帧一帧切换贴图的动画")
    await expect(related("谁在用它").getByRole("button", { name: "Cube", exact: true })).toBeVisible()
    await closeCard()

    await search.fill("no-matching-resource")
    await expect(backpack.getByText("这里没有找到叫这个名字的东西。", { exact: true })).toBeVisible()
    await expect(grid).toHaveCount(0)

    // Sound event -> audio file, playable from the card.
    await search.fill("sample:fixture.roar")
    await grid.getByRole("button", { name: "Fixture Roar", exact: true }).click()
    await expect(backpack.getByRole("dialog", { name: "Fixture Roar", exact: true })).toBeVisible()
    await expect(card.locator(".bp-kind")).toContainText("音效")
    await expect(card.locator(".bp-id")).toHaveText("sample:fixture.roar")
    await expect(card.locator("audio")).toBeVisible()
    await related("声音").getByRole("button", { name: "Tone", exact: true }).click()
    await expect(backpack.getByRole("dialog", { name: "Tone", exact: true })).toBeVisible()
    await expect(card.locator(".bp-id")).toHaveText("sample:tone")
    await expect(related("谁在用它").getByRole("button", { name: "Fixture Roar", exact: true })).toBeVisible()
    await advanced.click()
    await expect(advanced).toHaveAttribute("aria-pressed", "false")
    await expect(card.getByRole("button", { name: "在文件里打开", exact: true })).toHaveCount(0)
    await closeCard()

    // 高级 reveals the raw file library; the backpack already unpacked it, so no chooser step.
    await advanced.click()
    await expect(advanced).toHaveAttribute("aria-pressed", "true")
    for (const tab of ["背包", "玩法", "文件", "改包", "工程信息"])
      await expect(tabs.getByRole("tab", { name: tab })).toBeVisible()
    await tabs.getByRole("tab", { name: "文件" }).click()
    const workbench = page.locator('section[aria-label="文件工作台"]')
    await expect(workbench.locator(".iaw-categories button").filter({ hasText: "模型" })).toContainText("1")
    await expect(workbench.locator(".iaw-categories button").filter({ hasText: "贴图" })).toContainText("1")
    await expect(workbench.locator(".iaw-categories button").filter({ hasText: "音频" })).toContainText("1")
    await expect(workbench.getByRole("button", { name: "拆解所选内容", exact: true })).toHaveCount(0)

    await tabs.getByRole("tab", { name: "背包" }).click()
    await expect(categories.getByRole("tab", { name: /^其他/ })).toBeVisible()
    await search.fill("sample:tone")
    await grid.getByRole("button", { name: "Tone", exact: true }).click()
    await card.getByRole("button", { name: "在文件里打开", exact: true }).click()
    await expect(tabs.getByRole("tab", { name: "文件" })).toHaveAttribute("aria-selected", "true")
    await expect(workbench.locator(".iaw-detail-heading")).toContainText("tone.wav")
    await expect(workbench.locator(".iaw-audio-preview audio")).toBeVisible()

    // Model -> texture, then open the texture file in the viewer.
    await tabs.getByRole("tab", { name: "背包" }).click()
    await closeCard()
    await expect(categories.getByRole("tab", { name: /^模型与贴图/ })).toContainText("2")
    await categories.getByRole("tab", { name: /^模型与贴图/ }).click()
    await search.fill("cube.json")
    await expect(grid.locator(".bp-slot")).toHaveCount(1)
    await grid.getByRole("button", { name: "Cube", exact: true }).click()
    await expect(backpack.getByRole("dialog", { name: "Cube", exact: true })).toBeVisible()
    await expect(card.locator(".bp-kind")).toContainText("模型")
    await expect(card.locator(".bp-id")).toHaveText("sample:block/cube")
    await expect(card.getByRole("button", { name: "转一转看看", exact: true })).toBeVisible()
    await related("贴图").getByRole("button", { name: "Cube", exact: true }).click()
    await expect(card.locator(".bp-kind")).toContainText("贴图")
    await expect(related("动作").locator(".bp-slot")).toHaveCount(1)
    await expect(related("谁在用它").getByRole("button", { name: "Cube", exact: true })).toBeVisible()
    await card.getByRole("button", { name: "在文件里打开", exact: true }).click()
    const viewer = workbench.locator(".itv-card")
    await expect(viewer).toBeVisible()
    await expect(viewer.getByText("32 × 64px", { exact: true })).toBeVisible()
    const scale = viewer.getByLabel("缩放倍率")
    const beforeZoom = await scale.inputValue()
    await viewer.getByRole("button", { name: "放大" }).click()
    await expect(scale).not.toHaveValue(beforeZoom)
    expect(errors).toEqual([])
  } catch (error) {
    console.log(
      `Imported backpack state:\n${await page
        .locator("body")
        .innerText()
        .catch(() => "<unavailable>")}`,
    )
    await page
      .screenshot({ path: path.join(artifacts, "import-asset-graph-failure.png"), fullPage: true })
      .catch(() => undefined)
    throw error
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
})
