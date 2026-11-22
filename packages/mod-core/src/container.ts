import { createHash, randomUUID } from "node:crypto"
import { lstat, link, mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { unzipSync, zipSync } from "fflate"
import { z } from "zod"
import { openProject, ProjectSchema, storagePath, withProjectLock } from "./project"
import { ModelAssetSchema } from "./assets"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { compileSavedModel } from "./editable-model"
// The archive's sidecar files are named by the id alone, as every archive was: they are files beside the model, not what the game registers.
import { creatureName } from "./registry-name"
import { designToBlockbench } from "./blockbench"
import { targetLock } from "./target/manifests"
import { ProjectRunSchema } from "./workspace-runs"
import { archivedMakingPaths, archivedMakings } from "./making"
import { archivedGameplay, archivedGameplayPaths } from "./gameplay-loop"
import { ACTIVITY_ARCHIVE_PATH, archivedActivity, checkArchivedActivity } from "./activity"
import { IDEAS_ARCHIVE_PATH, IdeasSchema, readIdeas } from "./blueprint-ideas"

import { checkMusicBytes } from "./music"
import { mediaHashes, mediaPath, readMedia } from "./media"

export class ArchiveError extends Error {}
const limit = 128 * 1024 * 1024
const EntrySchema = z.strictObject({ path: z.string().min(1).max(240), bytes: z.number().int().nonnegative().max(limit), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
const ManifestSchema = z.strictObject({
  format: z.literal("minemods"), container_version: z.literal(1), project: ProjectSchema,
  environment: z.strictObject({ java: z.literal(21), minecraft: z.literal("1.21.1"), loader: z.literal("fabric"), loaderVersion: z.literal("0.17.2") }),
  entries: z.array(EntrySchema).max(8192),
})
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n")
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const parseJson = (bytes: Uint8Array) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
const sameBytes = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((value, index) => value === right[index])

function safeEntry(name: string) {
  if (name.length > 240 || name.includes("\\") || name.includes(":") || name.includes("\0") || name.startsWith("/") || name.split("/").some(segment => !segment || segment === "." || segment === ".." || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)))
    throw new ArchiveError("工程包包含不安全的文件路径。")
  return name
}

async function archiveData(filename: string) {
  const info = await stat(filename)
  if (!info.isFile() || info.size > limit) throw new ArchiveError("工程包超过 128 MB 限制。")
  const total = { bytes: 0 }
  const seen = new Set<string>()
  const entries = unzipSync(await readFile(filename), { filter: file => {
    safeEntry(file.name)
    const key = file.name.toLowerCase()
    if (seen.has(key)) throw new ArchiveError("工程包包含重复路径。")
    seen.add(key)
    total.bytes += file.originalSize
    if (seen.size > 8193 || total.bytes > limit || file.originalSize > limit) throw new ArchiveError("工程包解压后过大。")
    return true
  } })
  if (!entries["manifest.json"]) throw new ArchiveError("这不是有效的 .minemods 工程。")
  const parsed = ManifestSchema.safeParse(parseJson(entries["manifest.json"]))
  if (!parsed.success) throw new ArchiveError("工程格式或游戏环境版本不受支持。")
  const manifest = parsed.data
  const listed = new Set(manifest.entries.map(entry => safeEntry(entry.path)))
  if (listed.size !== manifest.entries.length || listed.has("manifest.json") || Object.keys(entries).length !== listed.size + 1)
    throw new ArchiveError("工程文件清单与归档内容不一致。")
  manifest.entries.forEach(entry => {
    const bytes = entries[entry.path]
    if (!bytes || bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new ArchiveError(`文件校验失败：${entry.path}`)
  })
  const projectBytes = entries["minemods.project.json"]
  if (!projectBytes || JSON.stringify(ProjectSchema.parse(parseJson(projectBytes))) !== JSON.stringify(manifest.project)) throw new ArchiveError("工程身份与归档不一致。")
  const allowed = new Set(["minemods.project.json", "dependencies.lock.json"])
  manifest.entries.filter(entry => /^\.minemods\/runs\/[0-9a-f-]{36}\.json$/i.test(entry.path)).forEach(entry => {
    const run = ProjectRunSchema.safeParse(parseJson(entries[entry.path]))
    if (!run.success || run.data.project_id !== manifest.project.id || entry.path !== `.minemods/runs/${run.data.id}.json`) throw new ArchiveError("工程任务记录与工程身份不一致。")
    allowed.add(entry.path)
  })
  // How things were made (part sheets, the pictures an AI was shown, its reviews) travels with the project when it has any.
  const makings = (() => {
    try {
      return archivedMakingPaths(entries, manifest.project)
    } catch {
      throw new ArchiveError("工程包里的制作记录与内容不一致。")
    }
  })()
  makings.forEach(name => allowed.add(name))
  // ---- gameplay records (what the code checks said) travel with the project ----
  const gameplayRecords = (() => {
    try {
      return archivedGameplayPaths(entries)
    } catch {
      throw new ArchiveError("工程包里的玩法检查记录读不出来。")
    }
  })()
  gameplayRecords.forEach(name => allowed.add(name))
  // ---- end gameplay records ----
  // The idea cards with the person's requirements, and the newest of what happened, travel too when the project has them.
  try {
    if (entries[IDEAS_ARCHIVE_PATH]) IdeasSchema.parse(parseJson(entries[IDEAS_ARCHIVE_PATH]))
    if (entries[ACTIVITY_ARCHIVE_PATH]) checkArchivedActivity(entries[ACTIVITY_ARCHIVE_PATH])
  } catch {
    throw new ArchiveError("工程包里的想法记录或动态记录读不出来。")
  }
  allowed.add(IDEAS_ARCHIVE_PATH).add(ACTIVITY_ARCHIVE_PATH)
  for (const sha of mediaHashes(manifest.project.workspace.assets)) {
    const file = mediaPath(sha)
    if (!entries[file] || hash(entries[file]) !== sha) throw new ArchiveError("工程包缺少媒体文件或文件校验失败。")
    allowed.add(file)
  }
  for (const {document} of manifest.project.workspace.assets) if (document.kind === "music") {
    for (const part of [document.intro, document.loop, document.outro]) if (part) checkMusicBytes(part, entries[mediaPath(part.media_sha256)]!)
  }
  manifest.project.assets.forEach(reference => {
    const file = `.minemods/assets/${reference.id}/${reference.revision}.json`
    allowed.add(file)
    allowed.add(`models/${reference.id}.bbmodel`)
    allowed.add(`textures/${reference.id}.png`)
    allowed.add(`animations/${reference.id}.json`)
    if (!entries[file] || hash(entries[file]) !== reference.sha256) throw new ArchiveError("模型资产校验失败。")
    const asset = ModelAssetSchema.parse(parseJson(entries[file]))
    if (asset.id !== reference.id || asset.entity_id !== reference.entity_id || asset.revision !== reference.revision || asset.origin !== reference.origin || asset.created_at !== reference.created_at) throw new ArchiveError("模型资产版本不一致。")
    const compiled = compileSavedModel(asset.data, creatureName({ id: reference.entity_id }))
    const modelFile = `models/${reference.id}.bbmodel`
    const textureFile = `textures/${reference.id}.png`
    const animationFile = `animations/${reference.id}.json`
    const data = z.object({ design: ModelDesignSchema, blockbench: z.unknown().optional() }).safeParse(asset.data)
    const expectedModel = data.success && data.data.blockbench ? data.data.blockbench : designToBlockbench(compiled.design)
    if (!entries[modelFile] || JSON.stringify(parseJson(entries[modelFile])) !== JSON.stringify(expectedModel)) throw new ArchiveError("模型快照与资产不一致。")
    if (!entries[textureFile] || !sameBytes(entries[textureFile], compiled.png)) throw new ArchiveError("模型贴图 sidecar 与资产不一致。")
    if (!entries[animationFile] || JSON.stringify(parseJson(entries[animationFile])) !== JSON.stringify(compiled.animation)) throw new ArchiveError("模型动画 sidecar 与资产不一致。")
  })
  if ([...listed].some(name => !allowed.has(name)) || !entries["dependencies.lock.json"]) throw new ArchiveError("工程包包含未声明的文件。")
  if (JSON.stringify(parseJson(entries["dependencies.lock.json"])) !== JSON.stringify(targetLock(manifest.project.target))) throw new ArchiveError("依赖锁与受支持环境不一致。")
  return { manifest, entries }
}

export async function inspectProjectArchive(filename: string) {
  const data = await archiveData(filename)
  return { project: data.manifest.project, environment: data.manifest.environment, files: data.manifest.entries.length, formatVersion: 1 as const }
}

export async function exportProjectArchive(input: { directory: string; destination: string }) {
  if (!path.isAbsolute(input.destination) || !input.destination.toLowerCase().endsWith(".minemods")) throw new ArchiveError("请选择 .minemods 工程文件名。")
  return withProjectLock(input.directory, async () => {
    const project = await openProject(input.directory)
    const entries: Record<string, Uint8Array> = { "minemods.project.json": encode(project), "dependencies.lock.json": encode(targetLock(project.target)) }
    let mediaBytes = 0
    for (const sha of mediaHashes(project.workspace.assets)) {
      const bytes = await readMedia(input.directory, sha)
      mediaBytes += bytes.length
      if (mediaBytes > limit) throw new ArchiveError("工程包超过 128 MB 限制。")
      entries[mediaPath(sha)] = bytes
    }
    const runDirectory = path.dirname(await storagePath(input.directory, [".minemods", "runs", "listing"]))
    const runFiles = await readdir(runDirectory, { withFileTypes: true }).catch((cause: unknown) => {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return []
      throw cause
    })
    await Promise.all(runFiles.filter(file => file.isFile() && /^[0-9a-f-]{36}\.json$/i.test(file.name)).map(async file => {
      const relative = `.minemods/runs/${file.name}`
      const data = await readFile(await storagePath(input.directory, relative.split("/")))
      const run = ProjectRunSchema.parse(parseJson(data))
      if (run.project_id !== project.id || file.name !== `${run.id}.json`) throw new ArchiveError("工程任务记录与工程身份不一致。")
      entries[relative] = data
    }))
    Object.assign(entries, await archivedMakings(input.directory))
    archivedMakingPaths(entries, project)
    Object.assign(entries, await archivedGameplay(input.directory))
    Object.assign(entries, await archivedActivity(input.directory))
    const ideas = await readIdeas(input.directory)
    if (ideas) entries[IDEAS_ARCHIVE_PATH] = encode(ideas)
    await Promise.all(project.assets.map(async reference => {
      const file = `.minemods/assets/${reference.id}/${reference.revision}.json`
      entries[file] = await readFile(await storagePath(input.directory, file.split("/")))
      const asset = ModelAssetSchema.parse(parseJson(entries[file]))
      const data = z.object({ design: ModelDesignSchema, blockbench: z.unknown().optional() }).safeParse(asset.data)
      const compiled = compileSavedModel(data.success ? data.data : asset.data, creatureName({ id: reference.entity_id }))
      entries[`textures/${reference.id}.png`] = compiled.png
      entries[`animations/${reference.id}.json`] = encode(compiled.animation)
      entries[`models/${reference.id}.bbmodel`] = encode(data.success && data.data.blockbench ? data.data.blockbench : designToBlockbench(compiled.design))
    }))
    const manifest = ManifestSchema.parse({
      format: "minemods", container_version: 1, project,
      environment: { java: 21, minecraft: "1.21.1", loader: "fabric", loaderVersion: "0.17.2" },
      entries: Object.entries(entries).map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: hash(bytes) })),
    })
    entries["manifest.json"] = encode(manifest)
    if (Object.values(entries).reduce((sum, bytes) => sum + bytes.length, 0) > limit) throw new ArchiveError("工程包超过 128 MB 限制。")
    const bytes = zipSync(entries, { level: 6 })
    const destination = path.join(await realpath(path.dirname(input.destination)), path.basename(input.destination))
    const temporary = `${destination}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, "wx", 0o600)
      await handle.writeFile(bytes).then(() => handle.sync()).finally(() => handle.close())
      await link(temporary, destination)
    } finally {
      await rm(temporary, { force: true })
    }
    return { path: destination, sha256: hash(bytes), revision: project.revision }
  })
}

export async function importProjectArchive(input: { archive: string; destination: string }) {
  if (!path.isAbsolute(input.destination)) throw new ArchiveError("请选择有效的工程位置。")
  const data = await archiveData(input.archive)
  const destination = path.join(await realpath(path.dirname(input.destination)), path.basename(input.destination))
  await mkdir(destination)
  const created = await realpath(destination)
  return Promise.resolve().then(async () => {
    await Promise.all(data.manifest.entries.filter(entry => entry.path !== "minemods.project.json").map(async entry => {
      await writeFile(await storagePath(created, entry.path.split("/"), true), data.entries[entry.path], { flag: "wx" })
    }))
    await writeFile(await storagePath(created, ["minemods.project.json"]), data.entries["minemods.project.json"], { flag: "wx" })
    return { directory: created, project: await openProject(created) }
  }).catch(async (error: unknown) => {
    if (await realpath(destination).catch(() => "") === created && !(await lstat(created)).isSymbolicLink()) await rm(created, { recursive: true, force: true })
    throw error
  })
}

export async function migrateLegacyProject(input: { directory: string; destination: string }) {
  const temporary = path.join(await realpath(path.dirname(input.destination)), `migration-${randomUUID()}.minemods`)
  await exportProjectArchive({ directory: input.directory, destination: temporary })
  return importProjectArchive({ archive: temporary, destination: input.destination }).finally(() => rm(temporary, { force: true }))
}
