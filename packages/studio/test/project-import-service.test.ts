import { expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { openProject } from "@minemods/mod-core/project"
import { dispatchExternal } from "../src/main/external-dispatch"
import { StudioRequestSchema } from "../src/main/protocol"
import { createStudioService } from "../src/main/service"
import { createImportBossSample } from "../../mod-core/script/import-boss-sample"

/**
 * 从别的工程导入 through Studio: the window's four calls and the outside AI's two tools. The list is only a list; the import is written once and said in the
 * activity feed; the outside AI's second call needs the list's fingerprint; the source project is never written.
 */
test("界面和外部 AI 都能从别的工程导入：先看清单，同意后写一次，能撤销", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "studio-project-import-"))
  try {
    const workspace = path.join(base, "projects")
    const frost = await createImportBossSample(path.join(workspace, "霜原"), "frost")
    const lava = await createImportBossSample(path.join(workspace, "火山口"), "lava")
    const service = await createStudioService({ workspaceDirectory: workspace, runtimeDirectory: path.join(base, "runtime"), templateDirectory: path.join(base, "templates"), ai: {} })
    const { source: _source, hasApiKey: _has, ...settings } = await service.getConnection()
    await service.saveConnection({ ...settings, mode: "mcp" })
    const main = (await service.createProject({ name: "三章合集", description: "" })).project

    const sources = await service.projectImportSources({ projectId: main.id })
    expect(sources.map((value) => value.name).sort()).toEqual(["火山口", "霜原"])
    const listed = sources.find((value) => value.id === frost.id)!
    const creature = listed.things.find((thing) => thing.kind === "creature")!
    expect(creature.title).toBe("霜甲巨像")
    // A creature's model and motions come with it and are not offered apart; its drops are.
    expect(listed.things.some((thing) => thing.kind === "model")).toBe(false)
    expect(listed.things.some((thing) => thing.kind === "item" && thing.title === "核心")).toBe(true)

    // The window: list, import, undo — each request as the window sends it.
    const request = (method: string, input: unknown) => StudioRequestSchema.parse({ method, input })
    const preview = request("previewProjectImport", { projectId: main.id, sourceId: frost.id, picks: [creature.id] })
    if (preview.method !== "previewProjectImport") throw new Error("unexpected request")
    const plan = await service.previewProjectImport(preview.input)
    expect((await openProject(path.join(workspace, "三章合集"))).revision).toBe(main.revision)
    const applied = request("applyProjectImport", { ...preview.input, expectedRevision: main.revision, fingerprint: plan.fingerprint })
    if (applied.method !== "applyProjectImport") throw new Error("unexpected request")
    const done = await service.applyProjectImport(applied.input)
    expect(done.view.project.revision).toBe(main.revision + 1)
    expect(done.view.project.entities.map((entity) => entity.name)).toEqual([...main.entities.map((entity) => entity.name), "霜甲巨像"])
    const undone = await service.undoProjectImport({ projectId: main.id, expectedRevision: done.view.project.revision, importId: done.importId })
    expect(undone.view.project.entities).toEqual(main.entities)

    // The outside AI: the first call is the list only; the second, with its fingerprint, writes.
    const pick = (await openProject(path.join(workspace, "火山口"))).workspace.assets.find((asset) => asset.module === "entity")!.id
    const told = (await dispatchExternal(service, { method: "importFromProject", input: { projectId: main.id, sourceProjectId: lava.id, picks: [pick] } })) as { written: boolean; fingerprint: string; items: { title: string; renamed: unknown[] }[]; how: string }
    expect(told.written).toBe(false)
    expect(told.items.find((item) => item.title === "熔岩魔像")).toBeTruthy()
    const revision = (await openProject(path.join(workspace, "三章合集"))).revision
    await expect(dispatchExternal(service, { method: "importFromProject", input: { projectId: main.id, sourceProjectId: lava.id, picks: [pick], fingerprint: told.fingerprint } })).rejects.toThrow("expectedRevision")
    const written = (await dispatchExternal(service, { method: "importFromProject", input: { projectId: main.id, sourceProjectId: lava.id, picks: [pick], fingerprint: told.fingerprint, expectedRevision: revision } })) as { written: boolean; importId: string; revision: number }
    expect(written.written).toBe(true)
    expect(written.revision).toBe(revision + 1)
    const activity = await service.getActivity({ projectId: main.id })
    expect(JSON.stringify(activity)).toContain("外部 AI 从「火山口」导入了")
    const back = (await dispatchExternal(service, { method: "undoProjectImport", input: { projectId: main.id, expectedRevision: written.revision, importId: written.importId } })) as { undone: boolean }
    expect(back.undone).toBe(true)

    // r29b 合并重复件: the frost creature, then the lava one renamed beside it; the outside AI gets the list, merges it, and the window takes the merge back.
    for (const [from, chosen] of [[frost.id, creature.id], [lava.id, pick]] as const) {
      const now = (await openProject(path.join(workspace, "三章合集"))).revision
      const listed = await service.previewProjectImport({ projectId: main.id, sourceId: from, picks: [chosen] })
      await service.applyProjectImport({ projectId: main.id, sourceId: from, picks: [chosen], expectedRevision: now, fingerprint: listed.fingerprint })
    }
    // Asked again, the outside AI is told by source id that each would be written over in place; the one the main project already had word for word (from the frost import) stays the main project's own (reuse_same is the default since r29b).
    const again = (await dispatchExternal(service, { method: "importFromProject", input: { projectId: main.id, sourceProjectId: lava.id, picks: [pick] } })) as { items: { sourceId: string; action: string; again?: unknown }[] }
    expect(again.items.every((item) => item.sourceId && ((item.action === "update" && item.again) || item.action === "reuse"))).toBe(true)
    expect(again.items.filter((item) => item.action === "reuse")).toHaveLength(1)
    const duplicates = (await dispatchExternal(service, { method: "mergeDuplicateAssets", input: { projectId: main.id } })) as { written: boolean; duplicates: { kind: string; drop: { id: string; name: string | null }; keep: { name: string | null } }[] }
    expect(duplicates.written).toBe(false)
    expect(duplicates.duplicates.map((pair) => `${pair.drop.name}>${pair.keep.name}`)).toEqual(expect.arrayContaining(["spark_crater>spark", "roar_crater>roar"]))
    const before = (await openProject(path.join(workspace, "三章合集"))).revision
    const merged = (await dispatchExternal(service, { method: "mergeDuplicateAssets", input: { projectId: main.id, drops: duplicates.duplicates.map((pair) => pair.drop.id), expectedRevision: before } })) as { written: boolean; mergeId: string; revision: number }
    expect(merged).toMatchObject({ written: true, revision: before + 1 })
    expect(await service.listDuplicateAssets({ projectId: main.id })).toEqual([])
    const unmerge = request("undoAssetMerge", { projectId: main.id, expectedRevision: merged.revision, mergeId: merged.mergeId })
    if (unmerge.method !== "undoAssetMerge") throw new Error("unexpected request")
    await service.undoAssetMerge(unmerge.input)
    expect((await service.listDuplicateAssets({ projectId: main.id })).length).toBe(duplicates.duplicates.length)
    // The sources were never written.
    expect((await openProject(path.join(workspace, "霜原"))).revision).toBe(frost.revision)
    expect((await openProject(path.join(workspace, "火山口"))).revision).toBe(lava.revision)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}, 300000)

/**
 * r29c 乙 第 6 件: a project folder outside Studio's projects (another machine's offload drive, a chapter's own folder) is read where it is, from the window's folder picker or an outside
 * AI's path: never copied into the workspace, never added to Studio's projects, never written. A path that is not a MineMods project is said in plain words.
 */
test("别处的工程文件夹能直接导入：只读、不复制、不登记；不是工程的路径说人话", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "studio-project-import-folder-"))
  try {
    const workspace = path.join(base, "projects")
    const elsewhere = path.join(base, "offload", "mobs", "frost", "projects", "霜原")
    const frost = await createImportBossSample(elsewhere, "frost")
    const service = await createStudioService({ workspaceDirectory: workspace, runtimeDirectory: path.join(base, "runtime"), templateDirectory: path.join(base, "templates"), ai: {} })
    const { source: _source, hasApiKey: _has, ...settings } = await service.getConnection()
    await service.saveConnection({ ...settings, mode: "mcp" })
    const main = (await service.createProject({ name: "三章合集", description: "" })).project
    // Not among Studio's projects, so not in the list to pick from.
    expect((await service.projectImportSources({ projectId: main.id })).map((value) => value.id)).not.toContain(frost.id)

    // The window: the folder picked, its things listed, the list made and the import written, as the window sends them.
    const request = (method: string, input: unknown) => StudioRequestSchema.parse({ method, input })
    const at = request("projectImportSourceAt", { projectId: main.id, sourcePath: elsewhere })
    if (at.method !== "projectImportSourceAt") throw new Error("unexpected request")
    const found = await service.projectImportSourceAt(at.input)
    expect(found).toMatchObject({ id: frost.id, name: "霜原" })
    expect(found.path).toBeTruthy()
    const creature = found.things.find((thing) => thing.kind === "creature")!
    // The manifest file itself names the same folder.
    expect((await service.projectImportSourceAt({ projectId: main.id, sourcePath: path.join(elsewhere, "minemods.project.json") })).id).toBe(frost.id)
    const preview = request("previewProjectImport", { projectId: main.id, sourcePath: elsewhere, picks: [creature.id] })
    if (preview.method !== "previewProjectImport") throw new Error("unexpected request")
    const plan = await service.previewProjectImport(preview.input)
    expect(plan.source.name).toBe("霜原")
    const done = await service.applyProjectImport({ ...preview.input, expectedRevision: main.revision, fingerprint: plan.fingerprint })
    expect(done.view.project.entities.map((entity) => entity.name)).toContain("霜甲巨像")
    // One source at a time.
    expect(() => request("previewProjectImport", { projectId: main.id, sourceId: frost.id, sourcePath: elsewhere, picks: [creature.id] })).toThrow()
    expect(() => request("previewProjectImport", { projectId: main.id, picks: [creature.id] })).toThrow()

    // The outside AI: the same by its path, the list first.
    const told = (await dispatchExternal(service, { method: "importFromProject", input: { projectId: main.id, sourceProjectPath: elsewhere, picks: [creature.id] } })) as { written: boolean; items: { action: string }[] }
    expect(told.written).toBe(false)
    expect(told.items.length).toBeGreaterThan(0)
    await expect(dispatchExternal(service, { method: "importFromProject", input: { projectId: main.id, sourceProjectId: frost.id, sourceProjectPath: elsewhere, picks: [creature.id] } })).rejects.toThrow("源工程写一个")

    // What is not a project, said in plain words.
    const said = (sourcePath: string) => service.previewProjectImport({ projectId: main.id, sourcePath, picks: [creature.id] })
    await expect(said("projects/霜原")).rejects.toThrow("完整的路径")
    await expect(said(path.join(base, "nowhere"))).rejects.toThrow("找不到")
    await expect(said(path.join(base, "offload", "mobs", "frost", "projects"))).rejects.toThrow("不是 MineMods 工程")
    await expect(said(path.join(workspace, "三章合集"))).rejects.toThrow("同一个工程")
    await Bun.write(path.join(base, "broken", "minemods.project.json"), "{ not json")
    await expect(said(path.join(base, "broken"))).rejects.toThrow("读不出来")

    // Read where it is: never written, never copied into the workspace, never added to Studio's projects.
    expect((await openProject(elsewhere)).revision).toBe(frost.revision)
    expect((await readdir(workspace)).some((name) => name.includes("霜原"))).toBe(false)
    expect((await service.listProjects()).some((value) => value.project.id === frost.id)).toBe(false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}, 300000)

test("MCP 写入、窗口从上次记录带出，同一个对照表经过两条入口", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "studio-map-import-"))
  try {
    const workspace = path.join(base, "projects")
    const source = await createImportBossSample(path.join(workspace, "source"), "lava")
    const service = await createStudioService({ workspaceDirectory: workspace, runtimeDirectory: path.join(base, "runtime"), templateDirectory: path.join(base, "templates"), ai: {} })
    const { source: _source, hasApiKey: _has, ...settings } = await service.getConnection()
    await service.saveConnection({ ...settings, mode: "mcp" })
    const main = (await service.createProject({ name: "机械工坊", description: "" })).project
    const particle = source.workspace.assets.find((asset) => asset.module === "particle")!
    const mapping = [{ source: "spark", action: "rename" as const, target: "forge_spark" }]
    const data = { projectId: main.id, picks: [particle.id], mapping }
    const request = StudioRequestSchema.parse({ method: "previewProjectImport", input: { ...data, sourceId: source.id } })
    if (request.method !== "previewProjectImport") throw new Error("unexpected request")
    const windowPlan = await service.previewProjectImport(request.input)
    const mcp = { ...data, sourceProjectId: source.id }
    const preview = await dispatchExternal(service, { method: "importFromProject", input: mcp }) as { written: boolean; fingerprint: string }
    expect(preview).toMatchObject({ written: false, fingerprint: windowPlan.fingerprint, columns: { mapped: [], renamed: [expect.objectContaining({ sourceId: particle.id })], saved: [] } })
    const written = await dispatchExternal(service, { method: "importFromProject", input: { ...mcp, fingerprint: preview.fingerprint, expectedRevision: main.revision } })
    expect(written).toMatchObject({ written: true })
    const remembered = (await service.projectImportSources({ projectId: main.id })).find((value) => value.id === source.id)?.mapping
    expect(remembered).toEqual([{ ...mapping[0]!, source: particle.id }])
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}, 45_000)
