import { test, expect } from "bun:test"
import { mkdtemp, readFile, writeFile, rm, cp, access } from "node:fs/promises"
import { gunzipSync } from "node:zlib"
import os from "node:os"
import path from "node:path"
import { dispatchExternal } from "../src/main/external-dispatch"
import { createStudioService } from "../src/main/service"
import { exportProjectArchive, importProjectArchive } from "@minemods/mod-core/container"
import { musicEvents } from "@minemods/mod-core/music"
import { mediaPath } from "@minemods/mod-core/media"
import { StudioRequestSchema } from "../src/main/protocol"
import { createCombinedSample } from "../../mod-core/script/target-combined-sample"
import { openProject, saveProject } from "@minemods/mod-core/project"
import { handSave } from "../src/main/content-service"
import { putAudio } from "../src/main/audio-import"
import { changeSoundMoment } from "../src/main/change-sound-moment"

const samples = path.join(import.meta.dir, "e2e")
test("更换和清除 Boss 配乐后重开工程，文档、生物条目和依赖一致", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-music-binding-"))
  try {
    const original = await createCombinedSample(dir, "forge-1.20.1")
    const song = await readFile(path.join(samples, "stone-loop.ogg"))
    const audio = { kind: "music" as const, projectId: original.id, expectedRevision: original.revision }
    const a = await putAudio(dir, original, { ...audio, title: "登场曲" }, song, null)
    const b = await putAudio(dir, a.next, { ...audio, title: "开打曲" }, song, null)
    const owner = original.entities[0]!.id
    let project = changeSoundMoment(b.next, owner, "boss.music", a.id)
    const entityRule = () => {
      const asset = project.workspace.assets.find(a => a.document.kind === "entity" && a.document.model_asset_id === owner)!
      if (asset.document.kind !== "entity" || !asset.document.boss) throw new Error("缺少 Boss")
      return { asset, document: asset.document, boss: { ...asset.document.boss } }
    }
    for (const id of [b.id, undefined]) {
      const { asset, document, boss } = entityRule()
      if (id) boss.music = { ...boss.music!, asset: id }
      else delete boss.music
      const saved = handSave(project, { assetId: asset.id, document: { ...document, boss }, id: asset.id, at: new Date().toISOString() })
      await saveProject(dir, saved.next, project.revision)
      project = await openProject(dir)
      expect(entityRule().asset.dependencies.filter(dep => dep === a.id || dep === b.id)).toEqual(id ? [id] : [])
      expect(entityRule().boss.music?.asset).toBe(id)
      expect(project.entities.find(e => e.id === owner)?.boss?.music?.asset).toBe(id)
    }
  } finally {
    await rm(dir, {recursive:true, force:true})
  }
}, 120000)

test("收件箱、媒体版本、工程包、整目录备份和删除工程", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "studio-media-"))
  try {
    const service = await createStudioService({
      workspaceDirectory: path.join(base, "projects"),
      runtimeDirectory: path.join(base, "runtime"),
      templateDirectory: path.join(base, "templates"),
      ai: {},
    })
    const v = await service.createProject({ name: "石像守卫", description: "" })
    const projectId = v.project.id,
      box = await service.listAudioInbox({ projectId })
    const large = gunzipSync(await readFile(path.join(samples, "large-music.ogg.gz")))
    expect(large.length).toBeGreaterThan(4 * 1024 * 1024)
    const file = path.join(box.folder, "长曲.ogg")
    await writeFile(file, large)
    expect((await service.listAudioInbox({ projectId })).files).toEqual(["长曲.ogg"])
    const { source: _source, hasApiKey: _has, ...settings } = await service.getConnection()
    await service.saveConnection({ ...settings, mode: "mcp" })
    const reply = (await dispatchExternal(service, {
      method: "importAudioInbox",
      input: { projectId, expectedRevision: v.project.revision, kind: "music", title: "守卫的曲子", filename: "长曲.ogg" },
    })) as { assetId: string; revision: number }
    expect(Object.keys(reply).sort()).toEqual(["assetId", "cut", "revision", "seconds"])
    const result = { assetId: reply.assetId, view: await service.openProject(projectId) }
    const id = result.assetId,
      doc = result.view.project.workspace.assets.find((a) => a.id === id)!.document
    if (doc.kind !== "music") throw new Error("没有保存音乐")
    expect(musicEvents(doc)).toEqual([{ part: "loop", event: "music_" + doc.name + "_loop", ...doc.loop }])
    expect(doc.loop.channels).toBe(2)
    const rel = mediaPath(doc.loop.media_sha256)
    expect((await readFile(path.join(v.directory, rel))).equals(large)).toBe(true)
    expect((await readFile(file)).equals(large)).toBe(true)
    expect((await readFile(path.join(v.directory, "minemods.project.json"))).length).toBeLessThan(100000)
    const target = path.join(base, "备份.minemods")
    await exportProjectArchive({ directory: v.directory, destination: target })
    const opened = await importProjectArchive({ archive: target, destination: path.join(base, "还原") })
    expect((await readFile(path.join(opened.directory, rel))).equals(large)).toBe(true)
    const replacement = await readFile(path.join(samples, "stone-loop.ogg"))
    await writeFile(file, replacement)
    const replaced = await service.importAudioInbox({
      projectId,
      expectedRevision: result.view.project.revision,
      assetId: id,
      kind: "music",
      part: "loop",
      filename: "长曲.ogg",
    })
    const backup = path.join(base, "完整备份")
    await cp(v.directory, backup, { recursive: true })
    expect((await readFile(path.join(backup, rel))).equals(large)).toBe(true)
    await service.makingHistory.restore({ projectId, expectedRevision: replaced.view.project.revision, assetId: id, version: 1 })
    expect(await service.readMusicPart({ projectId, assetId: id, part: "loop" })).toBe("data:audio/ogg;base64," + large.toString("base64"))
    const summary = await service.projectSummary(projectId)
    expect(JSON.stringify(summary)).toContain("boss.music.asset")
    expect(JSON.stringify(summary).length).toBeLessThan(8000)
    const { moved } = await service.deleteProject({ projectId })
    await expect(access(v.directory)).rejects.toThrow()
    expect((await readFile(path.join(moved, rel))).equals(large)).toBe(true)
    expect((await readFile(path.join(moved, "收件箱", "长曲.ogg"))).equals(replacement)).toBe(true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}, 120000)

test("四个资产操作保留声音注册名、校验版本且可撤销", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-asset-menu-"))
  try {
    const s = await createStudioService({
      workspaceDirectory: path.join(dir, "projects"),
      runtimeDirectory: path.join(dir, "runtime"),
      templateDirectory: path.join(dir, "templates"),
      ai: {},
    })
    const v = await s.createProject({ name: "空谷", description: "" })
    const id = v.project.id,
      data = "data:audio/ogg;base64," + (await readFile(path.join(samples, "stone-tone.ogg"))).toString("base64")
    const a = await s.uploadAudio({ projectId: id, expectedRevision: v.project.revision, kind: "sound", title: "空谷回声", data })
    const input = { projectId: id, assetId: a.assetId, expectedRevision: a.view.project.revision },
      was = a.view.project.workspace.assets.find((x) => x.id === a.assetId)!
    for (const [method, body] of [
      ["renameAsset", { ...input, title: "回音" }],
      ["duplicateAsset", input],
      ["deleteAsset", input],
      ["restoreDeleted", { projectId: id, expectedRevision: 1, deletion: a.assetId }],
    ] as const)
      expect(StudioRequestSchema.safeParse({ method, input: body }).success).toBe(true)
    const renamed = await s.renameAsset({ ...input, title: "岩石回音" })
    expect(renamed.project.workspace.assets.find((x) => x.id === a.assetId)?.document).toEqual(was.document)
    await expect(s.duplicateAsset(input)).rejects.toThrow()
    const copy = await s.duplicateAsset({ ...input, expectedRevision: renamed.project.revision })
    const copied = copy.view.project.workspace.assets.find((x) => x.id === copy.assetId)!
    expect(copied.title).toBe("岩石回音 的副本")
    expect(copied.id).not.toBe(a.assetId)
    if (copied.document.kind !== "sound" || was.document.kind !== "sound") throw new Error("声音种类丢失")
    expect(copied.document.files).toEqual(was.document.files)
    expect(copied.document.name).not.toBe(was.document.name)
    const gone = await s.deleteAsset({ ...input, expectedRevision: copy.view.project.revision, assetId: copied.id })
    if (!gone.deletion) throw new Error("副本未删除")
    expect(gone.view.project.workspace.assets.some((x) => x.id === copied.id)).toBe(false)
    const restored = await s.restoreDeleted({ projectId: id, expectedRevision: gone.view.project.revision, deletion: gone.deletion })
    expect(restored.view.project.workspace.assets.find((x) => x.id === copied.id)).toEqual(copied)
    await expect(s.restoreDeleted({ projectId: id, expectedRevision: restored.view.project.revision, deletion: gone.deletion })).rejects.toThrow()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 120000)
