import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { mushroomCowDesign } from "@minemods/mod-core/example"
import { openProject, saveProject } from "@minemods/mod-core/project"
import { encodePng } from "@minemods/mod-core/png"
import { decodeRgbaPng } from "@minemods/mod-core/png-decode"
import { persistWorkspaceModel } from "@minemods/mod-core/workspace-model"
import { WorkspaceAssetSchema, applyWorkspaceAsset } from "@minemods/mod-core/workspace"
import { iconBytes } from "@minemods/mod-core/fabric/icon"
import { ICON_WORDS } from "@minemods/mod-core/release"
import { REVISION_CONFLICT } from "../src/api"
import { createStudioService, dispatchStudioRequest, publicError } from "../src/main/service"

// Round 19: 「模组信息」 (one save for the mod's own words, with an icon the person gives) and the English name that a finding sends the person to fill.
const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true }))))

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-info-"))
  directories.push(directory)
  const service = await createStudioService({ workspaceDirectory: path.join(directory, "projects"), runtimeDirectory: path.join(directory, "runtime"), templateDirectory: path.join(directory, "templates"), ai: {} })
  return { service }
}

const square = (side: number) => {
  const pixels = new Uint8Array(side * side * 4)
  for (let at = 0; at < side * side; at++) pixels.set([30, 160, 90, 255], at * 4)
  return encodePng(pixels, side, side)
}
const url = (png: Uint8Array) => `data:image/png;base64,${Buffer.from(png).toString("base64")}`
const info = (more: Record<string, unknown> = {}) => ({ name: "苔光灯林", name_en: "", description: "", description_en: "", release: {}, ...more })

test("模组信息：名字、英文名、介绍、作者、版本、许可证一次存下；空的英文不留；写错的说一句人话", async () => {
  const { service } = await setup()
  const created = await service.createProject({ name: "旧名字", description: "旧介绍", empty: true })
  const projectId = created.project.id
  const saved = await service.saveModInfo({
    projectId,
    expectedRevision: created.project.revision,
    info: info({ name: "  苔光灯林  ", name_en: " Moss Lantern ", description: "夜里发光的林子", description_en: "A glowing grove.", release: { author: "小铜", version: "1.0.0", license: "Apache-2.0" } }),
  })
  expect(saved.project).toMatchObject({ name: "苔光灯林", name_en: "Moss Lantern", description: "夜里发光的林子", description_en: "A glowing grove.", release: { author: "小铜", version: "1.0.0", license: "Apache-2.0" } })
  // The mod id never follows the name, and the icon was not touched.
  expect(saved.project.mod_id).toBe(created.project.mod_id)
  expect(saved.project.icon).toBeUndefined()
  // Emptied English fields and an empty release are not stored: the mod then shows its Chinese words and the build's own defaults, as before.
  const emptied = await service.saveModInfo({ projectId, expectedRevision: saved.project.revision, info: info() })
  expect("name_en" in emptied.project || "description_en" in emptied.project || "release" in emptied.project).toBe(false)
  const text = JSON.parse(await readFile(path.join(emptied.directory, "minemods.project.json"), "utf8"))
  expect(["name_en", "description_en", "release", "icon"].some((key) => key in text)).toBe(false)
  const words = async (more: Record<string, unknown>) => publicError(await service.saveModInfo({ projectId, expectedRevision: emptied.project.revision, info: info(more) }).catch((error: unknown) => error))
  expect(await words({ name: "   " })).toContain("名字要写 1 到 120 个字")
  expect(await words({ name_en: "苔光灯" })).toContain("英文名里不能有中文")
  expect(await words({ description_en: "中文介绍" })).toContain("英文介绍里不能有中文")
  expect(await words({ release: { version: "1.0" } })).toContain("版本号写成 1.0.0 这样的三段数字")
  expect(publicError(await service.saveModInfo({ projectId, expectedRevision: created.project.revision, info: info() }).catch((error: unknown) => error))).toBe(REVISION_CONFLICT)
  await expect(dispatchStudioRequest(service, { method: "saveModInfo", input: { projectId, expectedRevision: emptied.project.revision, info: { ...info(), name: "" } } })).rejects.toThrow()
  expect((await service.openProject(projectId)).project.name).toBe("苔光灯林")
})

test("模组信息：图标收正方形的 PNG，小的放大到 128、大的原样；不对的说为什么，原来的图标不动；undefined 保留、null 去掉", async () => {
  const { service } = await setup()
  const created = await service.createProject({ name: "图标工程", description: "", empty: true })
  const projectId = created.project.id
  let revision = created.project.revision
  const save = async (more: Record<string, unknown>) => {
    const next = await service.saveModInfo({ projectId, expectedRevision: revision, info: info(more) as never })
    revision = next.project.revision
    return next
  }
  // 16 × 16 becomes 128 × 128: the file kept in the project is the one the jar will carry.
  const small = await save({ icon: url(square(16)) })
  const kept = decodeRgbaPng(iconBytes(small.project.icon)!)
  expect([kept.width, kept.height, ...kept.pixels.subarray(0, 4)]).toEqual([128, 128, 30, 160, 90, 255])
  // Not given (undefined): the icon stays. The window sends back the saved one when only a name changed: also kept, and not enlarged twice.
  expect((await save({ name: "改了名字" })).project.icon).toBe(small.project.icon)
  expect((await save({ icon: small.project.icon })).project.icon).toBe(small.project.icon)
  const big = square(256)
  expect(iconBytes((await save({ icon: url(big) })).project.icon)).toEqual(new Uint8Array(big))
  // Refused pictures say why and leave the saved icon alone.
  const before = (await service.openProject(projectId)).project
  const refused = async (icon: string) => publicError(await service.saveModInfo({ projectId, expectedRevision: revision, info: info({ icon }) as never }).catch((error: unknown) => error))
  expect(await refused(url(encodePng(new Uint8Array(64 * 32 * 4), 64, 32)))).toBe(ICON_WORDS.notSquare(64, 32))
  expect(await refused(url(square(48)))).toBe(ICON_WORDS.wrongSide(48))
  expect(await refused("data:image/png;base64,AAAA")).toBe(ICON_WORDS.unreadable)
  expect(await refused("https://example.com/icon.png")).toContain("PNG")
  expect((await service.openProject(projectId)).project.icon).toBe(before.icon)
  expect((await service.openProject(projectId)).project.revision).toBe(before.revision)
  // null takes it away.
  const none = await save({ icon: null })
  expect(none.project.icon).toBeUndefined()
})

test("英文名：方块、物品、生物都能单独存；生物连它的规则一起；去掉和写错也一样说人话", async () => {
  const { service } = await setup()
  const created = await service.createProject({ name: "英文名工程", description: "", empty: true })
  const projectId = created.project.id
  const content = (await import("@minemods/mod-core/content")).ContentSchema.parse({
    blocks: [{ id: crypto.randomUUID(), identifier: "moon_block", name: "月块", hardness: 1.5, luminance: 0, tool: "pickaxe", drop: "self", color: "#335577" }],
    items: [{ id: crypto.randomUUID(), identifier: "moon_shard", name: "月屑", max_stack: 64, color: "#99aacc" }],
    recipes: [],
    logic: [],
  })
  let view = await service.saveContent({ projectId, expectedRevision: created.project.revision, content })
  const block = view.project.blocks[0]!
  const item = view.project.items[0]!
  view = await service.setEnglishName({ projectId, expectedRevision: view.project.revision, kind: "block", id: block.id, name_en: "  Moon Block " })
  expect(view.project.blocks[0]!.name_en).toBe("Moon Block")
  // The asset that stands for the block follows, so the form shows the same name.
  expect((view.project.workspace.assets.find((asset) => asset.id === block.id)?.document as { name_en?: string } | undefined)?.name_en).toBe("Moon Block")
  view = await service.setEnglishName({ projectId, expectedRevision: view.project.revision, kind: "item", id: item.id, name_en: "Moon Shard" })
  expect(view.project.items[0]!.name_en).toBe("Moon Shard")
  expect(view.project.blocks[0]!.name_en).toBe("Moon Block")
  // Taking it away.
  view = await service.setEnglishName({ projectId, expectedRevision: view.project.revision, kind: "item", id: item.id, name_en: "  " })
  expect(view.project.items[0]!.name_en ?? null).toBeNull()
  const wrong = async (input: { kind: "block" | "item" | "entity"; id: string; name_en: string }) => publicError(await service.setEnglishName({ projectId, expectedRevision: view.project.revision, ...input }).catch((error: unknown) => error))
  expect(await wrong({ kind: "block", id: block.id, name_en: "月块" })).toContain("英文名里不能有中文")
  expect(await wrong({ kind: "block", id: crypto.randomUUID(), name_en: "Gone" })).toContain("找不到")
  expect(await wrong({ kind: "entity", id: crypto.randomUUID(), name_en: "Gone" })).toContain("找不到")
  expect(publicError(await service.setEnglishName({ projectId, expectedRevision: created.project.revision, kind: "block", id: block.id, name_en: "Late" }).catch((error: unknown) => error))).toBe(REVISION_CONFLICT)
  await expect(dispatchStudioRequest(service, { method: "setEnglishName", input: { projectId, expectedRevision: view.project.revision, kind: "wall", id: block.id, name_en: "x" } })).rejects.toThrow()
})

test("英文名：一只只有旧条目的生物，和一只有规则卡的生物，都存得进去，规则卡跟着", async () => {
  const { service } = await setup()
  const created = await service.createProject({ name: "生物英文名", description: "" })
  const projectId = created.project.id
  // A creature kept from before things had pages of their own: only its entry.
  const legacy = await service.useExample({ projectId, expectedRevision: created.project.revision })
  const old = legacy.project.entities[0]!
  const named = await service.setEnglishName({ projectId, expectedRevision: legacy.project.revision, kind: "entity", id: old.id, name_en: "Moss Moth" })
  expect(named.project.entities[0]!.name_en).toBe("Moss Moth")
  // A creature with a rules asset: the asset carries the name too, and its revision moves so a hand form open on it sees the change.
  const at = "2026-10-14T08:00:00.000Z"
  const model = WorkspaceAssetSchema.parse({ id: crypto.randomUUID(), module: "model", title: "牛", revision: 1, created_at: at, updated_at: at, prompt: "做一头牛", dependencies: [], document: { kind: "model", ...mushroomCowDesign }, provenance: { model: "gpt-6-astra", request_id: crypto.randomUUID() }, status: "design" })
  const fresh = await service.createProject({ name: "有规则卡", description: "", empty: true })
  await saveProject(fresh.directory, applyWorkspaceAsset(fresh.project, model), fresh.project.revision)
  const bridged = await persistWorkspaceModel(fresh.directory, model.id)
  const creature = WorkspaceAssetSchema.parse({
    id: crypto.randomUUID(), module: "entity", title: "月牛", revision: 1, created_at: at, updated_at: at, prompt: "做一头月牛", dependencies: [model.id], provenance: { model: "gpt-6-astra", request_id: crypto.randomUUID() }, status: "ready",
    document: { kind: "entity", name: "月牛", description: "", health: 10, speed: 0.2, attack_damage: 0, behavior: "passive", model_asset_id: model.id, runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null } },
  })
  const saved = await saveProject(fresh.directory, applyWorkspaceAsset(bridged.project, creature), bridged.project.revision)
  const done = await service.setEnglishName({ projectId: fresh.project.id, expectedRevision: saved.revision, kind: "entity", id: model.id, name_en: "Moon Cow" })
  expect(done.project.entities.find((entity) => entity.id === model.id)!.name_en).toBe("Moon Cow")
  const asset = done.project.workspace.assets.find((value) => value.id === creature.id)!
  expect((asset.document as { name_en?: string }).name_en).toBe("Moon Cow")
  expect(asset.revision).toBe(creature.revision + 1)
  expect((await openProject(fresh.directory)).entities.find((entity) => entity.id === model.id)!.name_en).toBe("Moon Cow")
})
