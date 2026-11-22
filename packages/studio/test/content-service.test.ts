import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { mushroomCowDesign } from "@minemods/mod-core/example"
import { createProject, openProject, saveProject, type Project } from "@minemods/mod-core/project"
import { persistWorkspaceModel } from "@minemods/mod-core/workspace-model"
import { WorkspaceAssetSchema, applyWorkspaceAsset, getModuleSchema } from "@minemods/mod-core/workspace"
import type { ActivityInput } from "@minemods/mod-core/activity"
import type { StudioView } from "../src/api"
import { HAND_KINDS, HAND_PROMPT, HandRefusal, createContentService, handIssues, handNote, handSave, handShape } from "../src/main/content-service"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true }))))
const at = "2026-10-07T08:00:00.000Z"
const uuid = () => crypto.randomUUID()
const block = (overrides: Record<string, unknown> = {}) => ({ kind: "block", identifier: "moon_block", name: "月块", hardness: 1.5, luminance: 0, tool: "pickaxe", drop: "self", color: "#335577", texture: null, ...overrides })
const item = (overrides: Record<string, unknown> = {}) => ({ kind: "item", identifier: "moon_shard", name: "月屑", max_stack: 64, color: "#99aacc", texture: null, ...overrides })
const recipe = (pattern: (string | null)[], result: string, overrides: Record<string, unknown> = {}) => ({ kind: "recipe", name: "合月块", pattern: Array.from({ length: 9 }, (_, index) => pattern[index] ?? null), result, count: 1, type: "shaped", ...overrides })

async function fresh(name = "自己改") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "minemods-hand-"))
  directories.push(directory)
  return { directory, project: await createProject({ directory, name, mod_id: "hand_made" }) }
}
const made = (project: Project, document: Record<string, unknown>, assetId: string | null = null, id = uuid()) => handSave(project, { assetId, document, id, at })

/** A project with one creature: a model an AI made, bridged to an entity, and the creature asset standing on it. */
async function withCreature() {
  const { directory, project } = await fresh("生物")
  const model = WorkspaceAssetSchema.parse({ id: uuid(), module: "model", title: "牛", revision: 1, created_at: at, updated_at: at, prompt: "做一头牛", dependencies: [], document: { kind: "model", ...mushroomCowDesign }, provenance: { model: "gpt-6-astra", request_id: uuid() }, status: "design" })
  await saveProject(directory, applyWorkspaceAsset(project, model), project.revision)
  const bridged = await persistWorkspaceModel(directory, model.id)
  const creature = WorkspaceAssetSchema.parse({
    id: uuid(), module: "entity", title: "月牛", revision: 1, created_at: at, updated_at: at, prompt: "做一头月牛", dependencies: [model.id], provenance: { model: "gpt-6-astra", request_id: uuid() }, status: "ready",
    document: { kind: "entity", name: "月牛", description: "", health: 10, speed: 0.2, attack_damage: 0, behavior: "passive", model_asset_id: model.id, runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null } },
  })
  const saved = await saveProject(directory, applyWorkspaceAsset(bridged.project, creature), bridged.project.revision)
  return { directory, project: saved, creature, model }
}

describe("表格的形状读自保存时用的那份 schema", () => {
  test("每一类的字段、范围和可选项都和 schema 一致", () => {
    const shape = handShape("block")
    expect(shape.fields.luminance).toEqual({ type: "number", int: true, min: 0, max: 15 })
    expect(shape.fields.tool).toEqual({ type: "choice", options: ["pickaxe", "axe", "shovel", "none"] })
    expect(shape.fields.name).toEqual({ type: "text", min: 1, max: 120 })
    expect(shape.fields.fuel).toEqual({ type: "object", fields: { burn_ticks: { type: "number", int: true, min: 20, max: 32000 } }, nullable: true, optional: true })
    expect(handShape("entity").fields.health).toEqual({ type: "number", above: 0, max: 1024 })
    expect(handShape("recipe").fields.pattern).toMatchObject({ type: "list", min: 9, max: 9, of: { type: "text", nullable: true } })
    // What cannot be laid out as plain fields is said to be so, not guessed at.
    expect(handShape("entity").fields.abilities).toMatchObject({ type: "list", of: { type: "object" } })
  })
  test("形状里说能填的值，schema 都收；说不能填的，schema 都不收", () => {
    HAND_KINDS.forEach((kind) => expect(Object.keys(handShape(kind).fields)).toEqual(Object.keys((getModuleSchema(kind) as unknown as { shape: Record<string, unknown> }).shape)))
    const schema = getModuleSchema("block")
    expect(schema.safeParse(block({ luminance: 15 })).success).toBe(true)
    expect(schema.safeParse(block({ luminance: 16 })).success).toBe(false)
    expect(schema.safeParse(block({ luminance: 1.5 })).success).toBe(false)
  })
})

describe("自己改的东西走 AI 交稿以后走的那条路", () => {
  test("新做一个方块：进内容列表、进资产，记成自己做的", async () => {
    const { project } = await fresh()
    const result = made(project, block())
    expect(result.same).toBe(false)
    expect(result.next.blocks.map((value) => value.identifier)).toEqual(["moon_block"])
    expect(result.asset).toMatchObject({ module: "block", title: "月块", revision: 1, prompt: HAND_PROMPT, provenance: { model: null, request_id: null }, status: "ready" })
    expect(result.next.workspace.assets[0]?.id).toBe(result.asset.id)
    expect(result.next.blocks[0]?.id).toBe(result.asset.id)
  })
  test("改一个已有的：版本加一，名字跟着改，AI 的出处原样留着", async () => {
    const { project } = await fresh()
    const ai = WorkspaceAssetSchema.parse({ id: uuid(), module: "block", title: "月块", revision: 3, created_at: at, updated_at: at, prompt: "做一个月亮方块", dependencies: [], document: block(), provenance: { model: "gpt-6-astra", request_id: uuid() }, status: "ready" })
    const before = applyWorkspaceAsset(project, ai)
    const result = made(before, block({ name: "亮月块", luminance: 12 }), ai.id)
    expect(result.asset).toMatchObject({ id: ai.id, title: "亮月块", revision: 4, prompt: "做一个月亮方块", provenance: ai.provenance, created_at: at })
    expect(result.next.blocks).toHaveLength(1)
    expect(result.next.blocks[0]).toMatchObject({ id: ai.id, name: "亮月块", luminance: 12 })
    // Nothing changed is nothing saved: no revision is spent on it.
    expect(made(before, block(), ai.id)).toMatchObject({ same: true, next: before })
  })
  test("配方用到的东西要真的有；原版物品按 1.21.1 的物品表核对", async () => {
    const { project } = await fresh()
    const withItem = made(project, item()).next
    expect(made(withItem, recipe(["hand_made:moon_shard", "minecraft:stick"], "hand_made:moon_shard")).next.recipes).toHaveLength(1)
    const id = uuid()
    const missing = (() => {
      try {
        made(withItem, recipe(["hand_made:nothing"], "hand_made:moon_shard"), null, id)
      } catch (error) {
        return handIssues(error, withItem, { id, kind: "recipe" })
      }
      return []
    })()
    expect(missing).toEqual([{ path: ["pattern", 0], code: "custom", message: "Unknown content reference: hand_made:nothing" }])
    expect(() => made(withItem, recipe(["minecraft:stik"], "hand_made:moon_shard"))).toThrow(/Minecraft 1.21.1 里没有/)
  })
  test("schema 不收的值按字段报回来，路径是文档自己的", async () => {
    const { project } = await fresh()
    const id = uuid()
    const issues = (document: Record<string, unknown>, kind: string) => {
      try {
        made(project, document, null, id)
      } catch (error) {
        return handIssues(error, project, { id, kind })
      }
      return []
    }
    expect(issues(block({ luminance: 99, name: "" }), "block").map((issue) => [issue.path.join("."), issue.code])).toEqual([["name", "too_small"], ["luminance", "too_big"]])
    // A recipe is checked as a document and again as a content record: one finding, not two.
    expect(issues(recipe([], "minecraft:stick"), "recipe")).toEqual([{ path: ["pattern"], code: "custom", message: "配方至少需要一种材料。" }])
    expect(issues({ kind: "worldview", title: "世界", summary: "", entries: [] }, "worldview")).toEqual([{ path: [], code: "refused", message: "这一类东西还不能在这里自己改。" }])
  })
  test("改了会弄坏别的东西的，说出是哪一样", async () => {
    const { project } = await fresh()
    const first = made(project, item())
    const second = made(first.next, recipe(["hand_made:moon_shard"], "minecraft:stick"))
    const issues = (() => {
      try {
        made(second.next, item({ identifier: "renamed" }), first.asset.id)
      } catch (error) {
        return handIssues(error, second.next, { id: first.asset.id, kind: "item" })
      }
      return []
    })()
    expect(issues).toEqual([{ path: [], code: "custom", message: "Unknown content reference: hand_made:moon_shard", elsewhere: "合月块" }])
  })
  test("生物的数字：生命、掉落、出现的地方一起进生物本身", async () => {
    const { project, creature } = await withCreature()
    const shard = made(project, item()).next
    const document = { ...creature.document, health: 40, behavior: "hostile", attack_damage: 4, experience: 5, loot: [{ item: "moon_shard", min: 1, max: 2, chance: 0.5, player_only: true }], runtime: { ...(creature.document as { runtime: object }).runtime, armor: 4, spawn: { biomes: [], tags: ["is_forest"], weight: 10, min: 1, max: 2 } } }
    const result = made(shard, document, creature.id)
    expect(result.asset.revision).toBe(2)
    expect(result.asset.dependencies).toEqual(creature.dependencies)
    expect(result.next.entities[0]).toMatchObject({ health: 40, behavior: "hostile", experience: 5, loot: [{ item: "moon_shard" }], runtime: { armor: 4, spawn: { tags: ["is_forest"] } } })
    // A drop that names nothing of the project is refused in the creature's own words.
    expect(() => made(shard, { ...document, loot: [{ item: "gone", min: 1, max: 1, chance: 1, player_only: false }] }, creature.id)).toThrow(/在这个工程里找不到/)
    expect(() => made(shard, document)).toThrow(HandRefusal)
  })
})

describe("活动里的那一行", () => {
  test("说是你自己改的，改了哪几项", () => {
    expect(handNote({}, { id: "a", title: "月块" }, false, ["硬度", "发光"])).toEqual({ kind: "person", mark: "note", item: "a", title: "月块", text: "你自己改了「月块」的硬度、发光。" })
    expect(handNote({}, { id: "a", title: "月块" }, false, []).text).toBe("你自己改了「月块」。")
    expect(handNote({}, { id: "a", title: "月块" }, true, []).text).toBe("你自己从空白做了「月块」。")
    expect(handNote({}, { id: "a", title: "月块" }, false, ["一", "二", "三", "四", "五", "六", "七", "八"]).text).toBe("你自己改了「月块」的一、二、三、四、五、六 等 8 处。")
  })
})

describe("saveByHand", () => {
  async function service() {
    const { directory, project } = await fresh()
    const notes: ActivityInput[] = []
    const view = async () => ({ directory, project: await openProject(directory) }) as StudioView
    const hand = createContentService({
      view,
      source: async (_id, expected) => {
        const current = await view()
        if (expected !== undefined && current.project.revision !== expected) throw new Error("REVISION")
        return current
      },
      saveProject,
      note: (_directory, event) => void notes.push(event),
    })
    return { hand, notes, project, view }
  }
  test("存下来、工程版本加一、活动里记一行", async () => {
    const { hand, notes, project, view } = await service()
    const first = await hand.saveByHand({ projectId: project.id, expectedRevision: project.revision, assetId: null, document: block(), changed: [] })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.view.project.revision).toBe(project.revision + 1)
    expect(notes.map((note) => note.text)).toEqual(["你自己从空白做了「月块」。"])
    const second = await hand.saveByHand({ projectId: project.id, expectedRevision: first.view.project.revision, assetId: first.assetId, document: block({ hardness: 3 }), changed: ["硬度"] })
    expect(second.ok && second.view.project.workspace.assets[0]).toMatchObject({ revision: 2, document: { hardness: 3 } })
    expect(notes.at(-1)).toMatchObject({ kind: "person", item: first.assetId, text: "你自己改了「月块」的硬度。" })
    // The same document again: nothing is saved and nothing is said.
    await hand.saveByHand({ projectId: project.id, expectedRevision: (await view()).project.revision, assetId: first.assetId, document: block({ hardness: 3 }), changed: [] })
    expect(notes).toHaveLength(2)
    expect((await view()).project.revision).toBe(project.revision + 2)
  })
  test("不对的不存，按字段说；版本对不上照旧拒绝", async () => {
    const { hand, notes, project, view } = await service()
    const refused = await hand.saveByHand({ projectId: project.id, expectedRevision: project.revision, assetId: null, document: block({ hardness: -1 }), changed: [] })
    expect(refused).toMatchObject({ ok: false, issues: [{ path: ["hardness"], code: "too_small" }] })
    expect((await view()).project.revision).toBe(project.revision)
    expect(notes).toEqual([])
    await expect(hand.saveByHand({ projectId: project.id, expectedRevision: project.revision + 5, assetId: null, document: block(), changed: [] })).rejects.toThrow("REVISION")
  })
  // broad19: the form was open while an outside AI saved a newer version of the same thing; saving the form wrote the old words back over it.
  test("表格开在旧的一版上，存着的已经被 AI 改新了：拒绝并说那句话，不覆盖；载入新的以后再存就存得进", async () => {
    const { hand, notes, project, view } = await service()
    const first = await hand.saveByHand({ projectId: project.id, expectedRevision: project.revision, assetId: null, document: block(), changed: [] })
    if (!first.ok) throw new Error("not saved")
    // The person opened the form on revision 1. The AI then stores revision 2.
    const opened = first.view.project.workspace.assets[0]!.revision
    const ai = await hand.saveByHand({ projectId: project.id, expectedRevision: first.view.project.revision, assetId: first.assetId, document: block({ hardness: 9, name: "AI 改的月块" }), changed: [] })
    if (!ai.ok) throw new Error("not saved")
    expect(ai.view.project.workspace.assets[0]).toMatchObject({ revision: opened + 1, title: "AI 改的月块" })
    const before = (await view()).project
    const stale = await hand.saveByHand({ projectId: project.id, expectedRevision: before.revision, assetId: first.assetId, document: block({ luminance: 7 }), changed: ["亮度"], basedOn: opened })
    expect(stale).toEqual({ ok: false, issues: [{ path: [], code: "refused", message: "AI 刚改过这一样，你看到的是改之前的。" }] })
    // Nothing was written, nothing was said in the activity list, and the AI's version stands.
    expect((await view()).project).toEqual(before)
    expect(notes.map((note) => note.text)).toEqual(["你自己从空白做了「月块」。", "你自己改了「AI 改的月块」。"])
    // The person loads the new content, changes it, and saves on the revision they now see.
    const loaded = await hand.saveByHand({ projectId: project.id, expectedRevision: before.revision, assetId: first.assetId, document: block({ hardness: 9, name: "AI 改的月块", luminance: 7 }), changed: ["亮度"], basedOn: opened + 1 })
    expect(loaded.ok && loaded.view.project.workspace.assets[0]).toMatchObject({ revision: opened + 2, document: { luminance: 7, hardness: 9 } })
    // A caller that does not say where it started is held to the checks it always had.
    expect((await hand.saveByHand({ projectId: project.id, expectedRevision: (await view()).project.revision, assetId: first.assetId, document: block({ hardness: 2, name: "AI 改的月块", luminance: 7 }), changed: [] })).ok).toBe(true)
  })
})
