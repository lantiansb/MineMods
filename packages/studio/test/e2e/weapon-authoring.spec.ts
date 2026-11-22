import { test, expect, _electron, type Page } from "@playwright/test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { applyWorkspaceAsset } from "@minemods/mod-core/workspace"
import { decodeRgbaPng } from "@minemods/mod-core/png-decode"
import type { ModelAnnotationContext } from "@minemods/studio-ai/model-annotation"
import type { ExternalStartResult, ExternalTaskContext } from "../../src/external"
import type { StudioView } from "../../src/api"
import { weaponFixture, WEAPON_ITEM_ID, WEAPON_MODEL_ID } from "../weapon-fixture"

const artifacts = path.resolve("../../.artifacts/studio")
const bun = process.env.BUN_EXECUTABLE ?? (process.platform === "win32" ? path.join(process.env.USERPROFILE ?? "", ".bun/bin/bun.exe") : "bun")
const executable = process.env.STUDIO_PACKAGED_EXECUTABLE || process.env.MINEMODS_STUDIO_EXECUTABLE

async function projectPage(page: Page, name: string) {
  await page.reload()
  const card = page.locator(".project-card").filter({ hasText: name })
  if (await card.count()) await card.click()
  await expect(page.getByRole("navigation", { name: "工程里的东西", exact: true })).toBeVisible()
}

test("同一把武器经真实截图标注、MCP返工、持握保存及游戏资源导出", async () => {
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, "weapon-v1-"))
  const app = await _electron.launch({
    executablePath: executable || path.resolve("node_modules/electron/dist/electron.exe"),
    args: [...(executable ? [] : [process.cwd()]), `--user-data-dir=${path.join(directory, "electron")}`],
    env: {
      ...process.env, OPENAI_API_KEY: "", OPENAI_BASE_URL: "", STUDIO_AI_URL: "", STUDIO_SERVICE_TOKEN: "",
      MINEMODS_STUDIO_TEST: "1", MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"), MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"),
    },
  })
  const page = await app.firstWindow()
  const client = new Client({ name: "weapon-protocol-fixture", version: "1.0.0" })
  const errors: string[] = []
  const evidence: Record<string, unknown> = { author: "local deterministic MCP test collaborator; no live AI quality claim", baseline: "dce0415719355f2cb3591674b76d843199fbac15", directory }
  page.on("pageerror", (error) => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: "reduce" })
  const call = async <T>(name: string, args: Record<string, unknown>) => {
    const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }))
    expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).not.toBe(true)
    const text = result.content.find((item) => item.type === "text")
    if (!text || text.type !== "text") throw new Error(`${name}: missing JSON text`)
    return { value: JSON.parse(text.text) as T, content: result.content }
  }
  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    evidence.application = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, executable: process.execPath, appPath: app.getAppPath() }))
    expect((evidence.application as { packaged: boolean }).packaged).toBe(Boolean(executable))
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
    const created = await page.evaluate(async () => {
      const { hasApiKey: _key, source: _source, ...connection } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...connection, mode: "mcp" })
      return window.studio.createProject({ name: "铜齿电锯剑联合验收", description: "本地可控协作者验证武器制作管线", modId: "weapon_fixture", empty: true })
    })
    const fixture = weaponFixture()
    const asset = { revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), prompt: "铜齿电锯剑，静态物品模型", dependencies: [], provenance: { model: null, request_id: null }, status: "ready" as const }
    const withModel = applyWorkspaceAsset(created.project, { ...asset, id: WEAPON_MODEL_ID, module: "model", title: fixture.name, document: { kind: "model", ...fixture } })
    const prepared = applyWorkspaceAsset(withModel, {
      ...asset, id: WEAPON_ITEM_ID, module: "item", title: "铜齿电锯剑物品", dependencies: [WEAPON_MODEL_ID],
      document: { kind: "item", identifier: "copper_chainsword", name: "铜齿电锯剑物品", max_stack: 1, color: "#bd8545", texture: null, model_asset_id: WEAPON_MODEL_ID,
        tool: { kind: "sword", durability: 600, mining_level: "iron", mining_speed: 4, attack_damage: 8, attack_speed: 1.6, enchantability: 14, repair: "minecraft:copper_ingot" } },
    })
    const saved = JSON.parse(execFileSync(bun, ["-e", 'import {saveProject} from "@minemods/mod-core/project"; const input=JSON.parse(process.argv[1]); console.log(JSON.stringify(await saveProject(input.directory,input.project,input.project.revision)))', JSON.stringify({ directory: created.directory, project: prepared })], { cwd: process.cwd(), windowsHide: true, encoding: "utf8" })) as StudioView["project"]
    expect(saved.entities).toHaveLength(0)
    const configuration = await page.evaluate(async () => (await window.studio.getMcpStatus()).configuration)
    await client.connect(new StdioClientTransport({ ...JSON.parse(configuration).mcpServers["minemods-studio"], stderr: "pipe" }))
    await projectPage(page, created.project.name)
    const modelTile = page.locator(`.inv-slot[data-kind="model"]`).filter({ hasText: fixture.name }).first()
    await expect(modelTile).toBeVisible()
    await modelTile.click()
    const dialog = page.getByRole("dialog", { name: fixture.name, exact: true })
    await expect(dialog).toBeVisible()
    const viewport = dialog.locator(".pa-view-host canvas")
    await expect(viewport).toBeVisible()
    const viewportBounds = await viewport.boundingBox()
    if (!viewportBounds) throw new Error("Weapon viewport has no bounds")
    await viewport.click({ position: { x: viewportBounds.width * 0.5, y: viewportBounds.height * 0.38 } })
    await dialog.getByRole("button", { name: "图上标注修改", exact: true }).click()
    const annotation = dialog.getByRole("region", { name: "图上标注修改", exact: true })
    const capture = await annotation.locator(".annotation-picture img").getAttribute("src")
    expect(capture).toMatch(/^data:image\/png;base64,/)
    await writeFile(path.join(directory, "weapon-authoring-original.png"), Buffer.from(capture!.split(",")[1]!, "base64"))
    const board = annotation.getByRole("img", { name: "截图标注画布", exact: true })
    const drag = async (from: [number, number], to: [number, number]) => {
      await board.scrollIntoViewIfNeeded()
      const bounds = await board.boundingBox()
      if (!bounds) throw new Error("Annotation canvas has no bounds")
      await page.mouse.move(bounds.x + bounds.width * from[0], bounds.y + bounds.height * from[1])
      await page.mouse.down()
      await page.mouse.move(bounds.x + bounds.width * to[0], bounds.y + bounds.height * to[1], { steps: 6 })
      await page.mouse.up()
    }
    await drag([0.35, 0.18], [0.65, 0.7])
    await annotation.getByRole("button", { name: "清空标注", exact: true }).click()
    await expect(annotation.locator(".annotation-list li")).toHaveCount(0)
    await drag([0.35, 0.18], [0.65, 0.7])
    await annotation.getByRole("button", { name: "箭头", exact: true }).click()
    await drag([0.8, 0.4], [0.55, 0.42])
    await annotation.getByRole("button", { name: "文字", exact: true }).click()
    await annotation.getByLabel("标注文字", { exact: true }).fill("刀刃厚度从 2 加到 3")
    await board.click({ position: { x: 35, y: 35 } })
    await expect(annotation.locator(".annotation-list li")).toHaveCount(3)
    await annotation.getByRole("button", { name: "撤销标注", exact: true }).click()
    await expect(annotation.locator(".annotation-list li")).toHaveCount(2)
    await board.click({ position: { x: 35, y: 35 } })
    await annotation.getByLabel("标注修改说明", { exact: true }).fill("只把 blade.core 的厚度从 2 加到 3，保持其余武器部件。")
    await annotation.getByRole("button", { name: "取消", exact: true }).click()
    await annotation.getByRole("button", { name: "继续标注 · 3 条", exact: true }).click()
    await expect(annotation.getByLabel("标注修改说明", { exact: true })).toHaveValue("只把 blade.core 的厚度从 2 加到 3，保持其余武器部件。")
    await page.screenshot({ path: path.join(artifacts, "weapon-authoring-overview-annotation.png"), fullPage: true })
    await annotation.getByRole("button", { name: "提交标注修改", exact: true }).click()
    await expect(annotation.getByText("标注已提交。", { exact: true })).toBeVisible()
    const batch = (await call<ExternalStartResult>("next_batch", { projectId: created.project.id })).value
    expect(batch.run).toBeTruthy()
    const task = batch.run.tasks.find((value) => value.asset_id === WEAPON_MODEL_ID)
    expect(task).toBeTruthy()
    const ids = { projectId: created.project.id, runId: batch.run.id, taskId: task!.id }
    const claim = await call<ExternalTaskContext & { annotation: ModelAnnotationContext; pictures: string[] }>("claim_task", ids)
    expect(claim.value.annotation).toMatchObject({ targetId: WEAPON_MODEL_ID, projectRevision: saved.revision, annotations: [{ kind: "circle" }, { kind: "arrow" }, { kind: "text", text: "刀刃厚度从 2 加到 3" }] })
    expect(claim.value.annotation.selectedPart).toMatch(/^blade\./)
    expect(claim.value.annotation.annotations.every((mark) => mark.part === claim.value.annotation.selectedPart)).toBe(true)
    const png = claim.content.find((item) => item.type === "image")
    if (!png || png.type !== "image") throw new Error("MCP claim did not deliver an image content block")
    expect(png.mimeType).toBe("image/png")
    const pixels = decodeRgbaPng(Buffer.from(png.data, "base64"))
    expect(pixels.width).toBeGreaterThan(100)
    expect(pixels.height).toBeGreaterThan(100)
    expect(png.data).not.toBe(capture!.split(",")[1])
    const colors = new Set(Array.from({ length: pixels.width * pixels.height }, (_, index) => `${pixels.pixels[index * 4]},${pixels.pixels[index * 4 + 1]},${pixels.pixels[index * 4 + 2]}`))
    expect(colors.size).toBeGreaterThan(100)
    await writeFile(path.join(artifacts, "weapon-authoring-submitted.png"), Buffer.from(png.data, "base64"))
    evidence.annotation = { ...claim.value.annotation, pngSha256: createHash("sha256").update(png.data).digest("hex"), colorCount: colors.size }
    const revised = { kind: "model" as const, ...fixture, bones: fixture.bones.map((bone) => bone.name !== "blade" ? bone : { ...bone, cubes: bone.cubes.map((cube) => cube.name !== "core" ? cube : { ...cube, size: [cube.size[0], cube.size[1], 3] as [number, number, number] }) }) }
    await call("save_sheet", { ...ids, sheet: {
      subject: "铜齿电锯剑的静态物品外观，刀芯加厚。", recognisable: ["长条锯齿刀刃", "铜色电机与护手"], assumed: [],
      parts: fixture.bones.map((bone) => ({ name: bone.name, what: `${bone.name} 武器结构`, shape: "依照已有立方体几何，blade.core厚度改为3", attaches: bone.parent ? `固定在${bone.parent}` : "物品根结构", surface: "沿用已有铜色和青蓝色", moves: "静态物品，本来就不动", assumed: false })),
      still: fixture.animations.map((animation) => ({ motion: animation.name, reason: "这是静态持握武器，不是生物；轨道保持静止。" })),
    } })
    const glance = await call<{ findings: string[]; glance: boolean }>("look", { ...ids, document: revised, glance: true })
    expect(glance.value.glance).toBe(true)
    evidence.glanceFindings = glance.value.findings
    const looked = await call<{ findings: string[] }>("look", { ...ids, document: revised })
    evidence.lookFindings = looked.value.findings
    await writeFile(path.join(directory, "weapon-authoring-evidence.json"), JSON.stringify(evidence, null, 2))
    expect(looked.value.findings, "Production look findings must be resolved without bypassing gates").toEqual([])
    await call("self_review", { ...ids, matches: ["刀芯厚度已改为3，其余原有部件和颜色保持。"], problems: [], next: [], verdict: "done" })
    const review = await call<{ pictures: string[]; blind_first?: boolean }>("final_review", ids)
    expect(review.content.some((item) => item.type === "image")).toBe(true)
    if (review.value.blind_first) {
      const named = await call("final_review", { ...ids, blind: { sees: "带长条锯齿刀刃和护手的电锯剑", also: [], because: "确定性管线测试：图中可见长刀刃、两侧锯齿和铜色握柄。此回答不作为真实独立AI评审证据。" } })
      expect(named.content.some((item) => item.type === "image")).toBe(true)
    }
    evidence.review = { blindFirst: !!review.value.blind_first, independent: false }
    await call("final_review", { ...ids, verdict: { passed: true, findings: [], advice: [], independent: false, ...(review.value.blind_first ? { fits: "at_once" } : {}) } })
    await call("commit_task", { ...ids, document: revised })
    const changed = (await call<StudioView>("open_project", { projectId: created.project.id })).value
    const model = changed.project.workspace.assets.find((asset) => asset.id === WEAPON_MODEL_ID)?.document
    expect(model?.kind).toBe("model")
    if (model?.kind !== "model") throw new Error("Revised weapon model missing")
    expect(model.bones.find((bone) => bone.name === "blade")!.cubes.find((cube) => cube.name === "core")!.size[2]).toBe(3)
    expect(changed.project.entities).toHaveLength(0)
    evidence.revisedModelRevision = changed.project.workspace.assets.find((asset) => asset.id === WEAPON_MODEL_ID)?.revision
    await projectPage(page, created.project.name)
    await page.locator('.inv-slot[data-kind="model"]').filter({ hasText: fixture.name }).first().click()
    await dialog.getByRole("button", { name: "图上标注修改", exact: true }).click()
    await drag([0.35, 0.18], [0.65, 0.7])
    await annotation.getByLabel("标注修改说明", { exact: true }).fill("这份标注还没提交，切换制作过程时应该保留。")
    await dialog.getByRole("tab", { name: "制作过程", exact: true }).click()
    const unsaved = page.getByRole("alertdialog", { name: "还有没保存的修改", exact: true })
    await expect(unsaved).toBeVisible()
    await unsaved.getByRole("button", { name: "留在这里", exact: true }).click()
    await expect(annotation.locator(".annotation-list li")).toHaveCount(1)
    await expect(annotation.getByLabel("标注修改说明", { exact: true })).toHaveValue("这份标注还没提交，切换制作过程时应该保留。")
    await dialog.getByRole("button", { name: "关闭", exact: true }).click()
    await page.getByRole("button", { name: "放弃修改", exact: true }).click()
    await page.locator('.inv-slot[data-kind="item"]').filter({ hasText: "铜齿电锯剑物品" }).first().click()
    const held = page.getByRole("region", { name: "铜齿电锯剑物品持握设置", exact: true })
    await expect(held).toBeVisible()
    await expect(held.locator("canvas")).toBeVisible()
    expect(await held.evaluate((element) => element.scrollWidth - element.clientWidth), "Held controls must fit the overview card").toBeLessThanOrEqual(1)
    for (const [index, label] of ["第一人称 · 右手", "第一人称 · 左手", "第三人称 · 右手", "第三人称 · 左手"].entries()) {
      await held.getByRole("tab", { name: label, exact: true }).click()
      await expect(held.getByRole("tab", { name: label, exact: true })).toHaveAttribute("aria-selected", "true")
      await held.getByLabel("位置 X", { exact: true }).fill(String(index + 1))
      await held.getByLabel("位置 Y", { exact: true }).fill(index < 2 ? "5" : "0")
      await held.getByLabel("旋转 Y", { exact: true }).fill(String(10 + index * 5))
      await held.getByLabel("缩放 X", { exact: true }).fill(index < 2 ? "0.6" : "1")
      await held.getByLabel("缩放 Y", { exact: true }).fill(index < 2 ? "0.6" : "1")
      await held.getByLabel("缩放 Z", { exact: true }).fill(index < 2 ? "0.6" : "0.85")
      const stage = decodeRgbaPng(await held.locator("canvas").screenshot())
      const copper = Array.from({ length: stage.width * stage.height }, (_, pixel) => pixel * 4).filter((pixel) => stage.pixels[pixel]! > stage.pixels[pixel + 1]! * 1.2 && stage.pixels[pixel + 1]! > stage.pixels[pixel + 2]! * 1.3).length
      expect(copper, `${label}: the copper weapon must actually be visible`).toBeGreaterThan(40)
      evidence[`heldView${index}`] = { label, width: stage.width, height: stage.height, copperPixels: copper }
      await page.screenshot({ path: path.join(artifacts, `weapon-authoring-${index < 2 ? "firstperson" : "thirdperson"}-${index % 2 ? "left" : "right"}.png`), fullPage: true })
    }
    await held.getByRole("button", { name: "保存持握设置", exact: true }).click()
    await expect(held.getByText("持握设置已保存，重新打开后继续生效。", { exact: true })).toBeVisible()
    await projectPage(page, created.project.name)
    await page.locator('.inv-slot[data-kind="item"]').filter({ hasText: "铜齿电锯剑物品" }).first().click()
    const reopened = page.getByRole("region", { name: "铜齿电锯剑物品持握设置", exact: true })
    for (const [index, label] of ["第一人称 · 右手", "第一人称 · 左手", "第三人称 · 右手", "第三人称 · 左手"].entries()) {
      await reopened.getByRole("tab", { name: label, exact: true }).click()
      await expect(reopened.getByLabel("位置 X", { exact: true })).toHaveValue(String(index + 1))
      await expect(reopened.getByLabel("位置 Y", { exact: true })).toHaveValue(index < 2 ? "5" : "0")
      await expect(reopened.getByLabel("旋转 Y", { exact: true })).toHaveValue(String(10 + index * 5))
      await expect(reopened.getByLabel("缩放 X", { exact: true })).toHaveValue(index < 2 ? "0.6" : "1")
      await expect(reopened.getByLabel("缩放 Y", { exact: true })).toHaveValue(index < 2 ? "0.6" : "1")
      await expect(reopened.getByLabel("缩放 Z", { exact: true })).toHaveValue(index < 2 ? "0.6" : "0.85")
    }
    const final = (await page.evaluate((projectId) => window.studio.openProject(projectId), created.project.id)).project
    const sourceDirectory = path.join(directory, "source-export")
    execFileSync(bun, ["-e", 'import {exportProjectSource} from "@minemods/mod-core/export"; const input=JSON.parse(process.argv[1]); await exportProjectSource(input.directory,input.destination,input.template)', JSON.stringify({ directory: created.directory, destination: sourceDirectory, template: path.resolve("../../templates/fabric-1.21") })], { cwd: process.cwd(), windowsHide: true, encoding: "utf8" })
    const resourceDirectory = path.join(sourceDirectory, "src/main/resources/assets/weapon_fixture")
    const resource = await readFile(path.join(resourceDirectory, "models/item/copper_chainsword.json"), "utf8")
    const exported = JSON.parse(resource) as { display: Record<string, { translation: number[]; rotation: number[]; scale: number[] }>; elements: { name: string; from: number[]; to: number[] }[] }
    for (const [index, slot] of ["firstperson_righthand", "firstperson_lefthand", "thirdperson_righthand", "thirdperson_lefthand"].entries()) {
      expect(exported.display[slot]?.translation[0]).toBe(index + 1)
      expect(exported.display[slot]?.translation[1]).toBe(index < 2 ? 5 : 0)
      expect(exported.display[slot]?.rotation[1]).toBe(10 + index * 5)
      expect(exported.display[slot]?.scale).toEqual(index < 2 ? [0.6, 0.6, 0.6] : [1, 1, 0.85])
    }
    expect(exported.elements).toHaveLength(fixture.bones.flatMap((bone) => bone.cubes).length)
    const blade = exported.elements.find((element) => element.name === "blade.core")!
    expect(blade.to[2]! - blade.from[2]!).toBe(3)
    const texture = decodeRgbaPng(await readFile(path.join(resourceDirectory, "textures/item/copper_chainsword.png")))
    expect(new Set(Array.from({ length: texture.width * texture.height }, (_, index) => `${texture.pixels[index * 4]},${texture.pixels[index * 4 + 1]},${texture.pixels[index * 4 + 2]}`)).size).toBeGreaterThan(1)
    expect(final.entities).toHaveLength(0)
    expect((await readdir(resourceDirectory, { recursive: true })).some((file) => /(^|[/\\])(geo|animations|entity)([/\\]|$)|\.geo\.json$|\.animation\.json$/.test(file))).toBe(false)
    await writeFile(path.join(artifacts, "weapon-authoring-exported-item.json"), resource)
    evidence.sourceExportDirectory = sourceDirectory
    evidence.finalProjectRevision = final.revision
    evidence.display = exported.display
    evidence.entityCount = final.entities.length
    evidence.pageErrors = errors
    await writeFile(path.join(directory, "weapon-authoring-evidence.json"), JSON.stringify(evidence, null, 2))
    expect(errors).toEqual([])
  } catch (cause) {
    await page.screenshot({ path: path.join(artifacts, "weapon-authoring-failure.png"), fullPage: true }).catch(() => undefined)
    evidence.failure = cause instanceof Error ? cause.message : String(cause)
    evidence.pageErrors = errors
    await writeFile(path.join(directory, "weapon-authoring-evidence.json"), JSON.stringify(evidence, null, 2))
    throw cause
  } finally {
    await client.close()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()))
    await app.close()
  }
})
