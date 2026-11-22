import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { ContentSchema, type Content } from "./content"
import { ConceptionSchema, type Conception } from "./conception"
import { BlueprintSchema } from "./blueprint"
import { WorkspaceSchema, type Workspace } from "./workspace"
import { EntitySchema } from "./entity-runtime"
import { EnglishNameSchema, hasCjk } from "./data-words"
import { IconUrlSchema, ReleaseSchema } from "./release"
import { DEFAULT_TARGET, TargetIdSchema, type TargetId } from "./target/ids"
import { ProjectRecordBusyError, windowsRecordHolder } from "./project-record-busy"
export { ProjectRecordBusyError } from "./project-record-busy"
export { EntitySchema } from "./entity-runtime"

export const AssetOriginSchema = z.enum(["gpt-6-astra", "ai", "manual", "example"])
export const AssetReferenceSchema = z.strictObject({
  id: z.uuid(),
  entity_id: z.uuid(),
  revision: z.number().int().positive(),
  origin: AssetOriginSchema,
  created_at: z.iso.datetime(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
})
export const ProjectSchema = z
  .strictObject({
    schema_version: z.literal(1),
    id: z.uuid(),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(4000),
    mod_id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    // The primary target: the one 构建并试玩 uses unless another is picked. Older projects have only this.
    target: TargetIdSchema,
    revision: z.number().int().nonnegative(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    entities: z.array(EntitySchema).max(256),
    assets: z.array(AssetReferenceSchema).max(4096),
    blocks: ContentSchema.shape.blocks,
    items: ContentSchema.shape.items,
    recipes: ContentSchema.shape.recipes,
    logic: ContentSchema.shape.logic,
    conception: ConceptionSchema.default(() => ConceptionSchema.parse({})),
    workspace: WorkspaceSchema.default(() => WorkspaceSchema.parse({})),
    // Optional, not defaulted: a project without a blueprint must be written back exactly as it was read.
    blueprint: BlueprintSchema.optional(),
    // The mod's own name and description for an English-language game. Absent in older projects, which build as before.
    name_en: EnglishNameSchema.nullable().optional(),
    description_en: z.string().max(4000).refine((text) => !hasCjk(text), "英文介绍里不能有中文。").nullable().optional(),
    // Who made the mod, its version, licence and links. Absent in older projects, which build as before: author "MineMods Studio", 0.1.0, MIT.
    release: ReleaseSchema.optional(),
    // The picture a mod list shows beside the mod, a square PNG already checked and sized when it was saved (`givenIcon`). Absent: the build makes one from an item or block picture, as before.
    icon: IconUrlSchema.nullable().optional(),
    // Every target the project is built for, primary first; one blueprint, model and set of numbers for all of them.
    // Optional, not defaulted: a project for one target is written back exactly as it was read.
    targets: z.array(TargetIdSchema).min(1).max(TargetIdSchema.options.length).optional(),
    // Which names of the game the project's gameplay code is written in. "official": Mojang's, the names every generator now writes. Absent: an older
    // project, whose gameplay code (if it has any) was written in Yarn's and is converted once before its first build (`naming-migration.ts`).
    // Optional, not defaulted: a project file without it is written back exactly as it was read.
    naming: z.literal("official").optional(),
  })
  .superRefine((project, context) => {
    if (project.targets && (project.targets[0] !== project.target || new Set(project.targets).size !== project.targets.length))
      context.addIssue({ code: "custom", path: ["targets"], message: "targets lists each target once, the primary target first." })
    project.items.forEach((item, index) => {
      if (!item.model_asset_id) return
      const model = project.workspace.assets.find(asset => asset.id === item.model_asset_id)
      if (model?.document.kind !== "model" || model.status !== "ready") context.addIssue({ code: "custom", path: ["items", index, "model_asset_id"], message: `Item ${item.identifier} requires a ready workspace model` })
    })
    if (new Set(project.entities.map((entity) => entity.id)).size !== project.entities.length)
      context.addIssue({ code: "custom", message: "Duplicate entity ID" })
    if (new Set(project.assets.map((asset) => asset.id)).size !== project.assets.length)
      context.addIssue({ code: "custom", message: "Duplicate asset ID" })
    project.entities
      .filter((entity) => entity.model_asset_id !== null)
      .forEach((entity) => {
        if (!project.assets.some((asset) => asset.id === entity.model_asset_id && asset.entity_id === entity.id))
          context.addIssue({ code: "custom", message: `Missing model dependency for entity ${entity.id}` })
      })
    project.entities.forEach((entity, index) => {
      const textureId = entity.runtime?.texture_asset_id
      if (textureId === undefined || textureId === null) return
      const texture = project.workspace.assets.find((asset) => asset.id === textureId)
      if (!texture || texture.module !== "texture" || texture.document.kind !== "texture") {
        context.addIssue({ code: "custom", path: ["entities", index, "runtime", "texture_asset_id"], message: `Entity ${entity.id} references a missing texture workspace asset` })
        return
      }
      const model = project.workspace.assets.find((asset) => asset.id === entity.id)
      if (!model || model.module !== "model" || model.document.kind !== "model") {
        context.addIssue({ code: "custom", path: ["entities", index, "runtime", "texture_asset_id"], message: `Entity ${entity.id} has no workspace model asset for texture validation` })
        return
      }
      if (texture.document.width !== model.document.texture_size || texture.document.height !== model.document.texture_size)
        context.addIssue({ code: "custom", path: ["entities", index, "runtime", "texture_asset_id"], message: `Entity ${entity.id} texture dimensions do not match its model` })
      const entityAsset = project.workspace.assets.find((asset) => asset.module === "entity" && asset.document.kind === "entity" && asset.document.model_asset_id === entity.id)
      if (!entityAsset || !entityAsset.dependencies.includes(textureId))
        context.addIssue({ code: "custom", path: ["entities", index, "runtime", "texture_asset_id"], message: `Entity ${entity.id} workspace asset does not depend on its texture` })
    })
    project.entities.forEach((entity, index) => {
      const deathDrop = entity.runtime?.death_drop
      if (!deathDrop) return
      const block = project.blocks.find((candidate) => candidate.identifier === deathDrop.block_identifier)
      if (!block?.lucky) {
        context.addIssue({ code: "custom", path: ["entities", index, "runtime", "death_drop", "block_identifier"], message: `Entity ${entity.id} death drop references a missing or non-lucky block` })
        return
      }
      const blockAsset = project.workspace.assets.find((asset) => asset.module === "block" && asset.document.kind === "block" && asset.document.identifier === deathDrop.block_identifier)
      const entityAsset = project.workspace.assets.find((asset) => asset.module === "entity" && asset.document.kind === "entity" && asset.document.model_asset_id === entity.id)
      if (!blockAsset || !entityAsset || !entityAsset.dependencies.includes(blockAsset.id))
        context.addIssue({ code: "custom", path: ["entities", index, "runtime", "death_drop"], message: `Entity ${entity.id} workspace asset must depend on its lucky block asset` })
    })
    project.assets.forEach((asset) => {
      if (!project.entities.some((entity) => entity.id === asset.entity_id))
        context.addIssue({ code: "custom", message: `Asset ${asset.id} references a missing entity` })
    })
    project.conception.entries.forEach((entry) => {
      if (entry.entity_id !== null && !project.entities.some((entity) => entity.id === entry.entity_id))
        context.addIssue({ code: "custom", path: ["conception", "entries"], message: `Conception entry ${entry.id} references a missing entity` })
      if (entry.model_confirmed_asset_id !== null) {
        const asset = project.assets.find(candidate => candidate.id === entry.model_confirmed_asset_id)
        if (!asset) context.addIssue({ code: "custom", path: ["conception", "entries"], message: `Conception entry ${entry.id} references a missing model asset` })
        else if (entry.entity_id === null || asset.entity_id !== entry.entity_id)
          context.addIssue({ code: "custom", path: ["conception", "entries"], message: `Confirmed model asset does not belong to conception entity ${entry.id}` })
      }
    })
  })

export type Entity = z.infer<typeof EntitySchema>
export type Project = z.infer<typeof ProjectSchema>
export type AssetReference = z.infer<typeof AssetReferenceSchema>
export type AssetOrigin = z.infer<typeof AssetOriginSchema>
export type ProjectContent = Content
export type ProjectConception = Conception
export type ProjectWorkspace = Workspace

export class RevisionConflictError extends Error {
  constructor(expected: number, actual: number) {
    super(`Revision conflict: expected ${expected}, current revision is ${actual}`)
    this.name = "RevisionConflictError"
  }
}

const pending = new Map<string, Promise<unknown>>()

/** Who holds a project's write lock, written inside the lock as it is taken: enough to tell, later, a writer that is gone from one still at work. */
const LockOwnerSchema = z.object({ pid: z.number().int().positive(), token: z.string().min(1), host: z.string(), at: z.string() })
export type LockOwner = z.infer<typeof LockOwnerSchema>
/** This process, for the locks it takes. The token tells it from an earlier process the system gave the same number. */
const SELF = { pid: process.pid, token: randomUUID(), host: os.hostname() }
const LOCK_OWNER = "owner.json"
/**
 * A lock with no owner written in it was taken by a Studio from before owners were written (r12 and older), or by a writer that died in the
 * instant between taking it and signing it. Nobody can be asked whether that writer is still there, so it is left alone for as long as any
 * operation under the lock could run, and taken over after.
 */
export const OWNERLESS_LOCK_MS = 10 * 60 * 1000
/** Only one process may clear an abandoned lock at a time; clearing takes milliseconds, so a claim older than this was left by a process that died doing it. */
const TAKEOVER_CLAIM_MS = 30 * 1000

/**
 * Another writer holds the project. `holder` is who (null: the lock does not say), `alive` whether that process was found running on this
 * computer (null: it could not be told: another computer, or no owner written). The message is for logs; Studio says it in the person's words.
 */
export class ProjectLockedError extends Error {
  readonly code = "PROJECT_WRITE_LOCKED"
  constructor(
    readonly holder: LockOwner | null,
    readonly alive: boolean | null,
  ) {
    super("Project write lock exists. Close other Studio instances; if a writer crashed, remove .minemods/write.lock after confirming no writer is active.")
    this.name = "ProjectLockedError"
  }
}

const exists = (error: unknown) => error instanceof Error && "code" in error && error.code === "EEXIST"

async function lockOwner(lock: string): Promise<LockOwner | null> {
  const parsed = LockOwnerSchema.safeParse(
    await readFile(path.join(lock, LOCK_OWNER), "utf8")
      .then((text) => JSON.parse(text) as unknown)
      .catch(() => null),
  )
  return parsed.success ? parsed.data : null
}

/** Signal 0 sends nothing and only asks whether the process is there. A process we may not signal (EPERM) is there. */
function running(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

/**
 * Whether the writer that took a lock is still there: true, false, or null when it cannot be told. This process's own token on a lock is a
 * lock nobody in this process is using (the caller is next in its queue): one whose removal failed. Its number with another token cannot be
 * told (an earlier process the system gave the same number, most likely) and is left alone. A number the system has since given to an
 * unrelated program reads as running. Whenever it cannot be told the lock is kept: it is never taken from a writer that may be live.
 */
async function holderAlive(lock: string, holder: LockOwner | null): Promise<boolean | null> {
  if (!holder) {
    const age = await stat(lock).then(
      (found) => Date.now() - found.mtimeMs,
      () => 0,
    )
    return age > OWNERLESS_LOCK_MS ? false : null
  }
  if (holder.host !== SELF.host) return null
  if (holder.pid === SELF.pid) return holder.token === SELF.token ? false : null
  return running(holder.pid)
}

/**
 * Takes the project's lock directory, signed with this process. A lock already there whose writer is gone (Studio was ended in the middle of
 * a write) is cleared and taken; one whose writer is running, or cannot be told to be gone, refuses as before. Clearing is done under a claim
 * of its own, and the lock is read again inside it, so of several processes that find the same abandoned lock one clears it and none clears
 * the lock the winner took after.
 */
async function acquireLock(lock: string, retried = false): Promise<void> {
  const taken = await mkdir(lock).then(
    () => true,
    (error: unknown) => {
      if (exists(error)) return false
      throw error
    },
  )
  if (taken)
    return writeFile(path.join(lock, LOCK_OWNER), JSON.stringify({ ...SELF, at: new Date().toISOString() })).catch(async (error: unknown) => {
      await rm(lock, { recursive: true, force: true })
      throw error
    })
  const holder = await lockOwner(lock)
  const alive = await holderAlive(lock, holder)
  if (retried || alive !== false) throw new ProjectLockedError(holder, alive)
  const claim = `${lock}.takeover`
  const claimed = await mkdir(claim).then(
    () => true,
    (error: unknown) => {
      if (exists(error)) return false
      throw error
    },
  )
  if (!claimed) {
    // Someone else is clearing it right now, or died doing so: an old claim is removed so the next call can make its own.
    const age = await stat(claim).then(
      (found) => Date.now() - found.mtimeMs,
      () => 0,
    )
    if (age > TAKEOVER_CLAIM_MS) await rm(claim, { recursive: true, force: true })
    throw new ProjectLockedError(holder, alive)
  }
  const again = await lockOwner(lock)
  const same = (again?.token ?? null) === (holder?.token ?? null) && (await holderAlive(lock, again)) === false
  if (same) await rm(lock, { recursive: true, force: true })
  await rm(claim, { recursive: true, force: true })
  if (!same) throw new ProjectLockedError(again, null)
  return acquireLock(lock, true)
}

function missing(error: unknown) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
  throw error
}

/** Resolve only generated path segments; reject symlinks within the selected project root. */
export async function storagePath(directory: string, segments: string[], createParent = false) {
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || /[/\\:]/.test(segment)))
    throw new Error("Unsafe project storage path")
  const root = await realpath(directory)
  await segments.reduce(async (previous, segment, index) => {
    const parent = await previous
    const target = path.join(parent, segment)
    const info = await lstat(target).catch(missing)
    if (info?.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in project storage: ${target}`)
    if (index < segments.length - 1) {
      if (info && !info.isDirectory()) throw new Error(`Expected a storage directory: ${target}`)
      if (!info && createParent)
        await mkdir(target).catch((error: unknown) => {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
        })
      const checked = await lstat(target).catch(missing)
      if (checked?.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in project storage: ${target}`)
    }
    if (index === segments.length - 1 && info && !info.isFile())
      throw new Error(`Expected a regular storage file: ${target}`)
    return target
  }, Promise.resolve(root))
  return path.join(root, ...segments)
}

const MANIFEST = "minemods.project.json"
const manifestIO = new Map<string, Promise<void>>()

// MoveFileEx cannot replace an open destination on Windows, even when a Node reader shares deletion.
// Queue only handle I/O: parsing and validation can proceed after the reader has closed its handle.
async function manifestAccess<T>(directory: string, access: (root: string) => Promise<T>): Promise<T> {
  if (process.platform !== "win32") return access(directory)
  const root = await realpath(directory)
  const key = root.toLowerCase()
  const previous = manifestIO.get(key) ?? Promise.resolve()
  const result = previous.then(() => access(root))
  const tail = result.then(() => undefined, () => undefined)
  manifestIO.set(key, tail)
  return result.finally(() => { if (manifestIO.get(key) === tail) manifestIO.delete(key) })
}

/** The exact manifest bytes, including for a migration backup. No handle survives the read. */
export function readProjectRecord(directory: string) {
  return manifestAccess(directory, async root => readFile(await storagePath(root, [MANIFEST])))
}

/** Atomic replacement of a validated JSON record. Caller must hold the project write lock. */
export async function writeRecord(directory: string, segments: string[], value: unknown) {
  const manifest = segments.length === 1 && segments[0]!.toLowerCase() === MANIFEST
  const write = async (root: string) => {
    const target = await storagePath(root, segments, true)
    const temporary = `${target}.${randomUUID()}.tmp`
    const bytes = JSON.stringify(value, null, 2) + "\n"
    const handle = await open(temporary, "wx", 0o600)
    try {
      await handle.writeFile(bytes, "utf8").then(() => handle.sync()).finally(() => handle.close())
      await replace(temporary, target, manifest && process.platform === "win32")
    } finally {
      await rm(temporary, { force: true })
    }
  }
  return manifest ? manifestAccess(directory, write) : write(directory)
}

const HELD = ["EPERM", "EBUSY", "EACCES"]
const STANDARD_REPLACE_DELAYS = [25, 50, 75, 100, 125, 150, 175]
// A manifest may still be in use in a different process. Keep atomic replacement and give that reader
// a bounded chance to finish. Never remove the saved version to get around a sharing violation.
const WINDOWS_MANIFEST_DELAYS = [25, 50, 100, 200, 400, 700, 700, 700, 700]
async function replace(temporary: string, target: string, diagnose: boolean): Promise<void> {
  const delays = diagnose ? WINDOWS_MANIFEST_DELAYS : STANDARD_REPLACE_DELAYS
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(temporary, target)
    } catch (error) {
      if (!(error instanceof Error && "code" in error && HELD.includes(String(error.code)))) throw error
      const delay = delays[attempt]
      if (delay === undefined) {
        if (!diagnose) throw error
        const holder = await windowsRecordHolder(target).catch(() => "unknown" as const)
        throw new ProjectRecordBusyError(holder, error)
      }
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

/** FIFO within this process; independent processes fail closed on the exclusive lock directory, unless the process that left it is gone (`acquireLock`). */
export async function withProjectLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const root = await realpath(directory)
  const key = process.platform === "win32" ? root.toLowerCase() : root
  const previous = pending.get(key) ?? Promise.resolve()
  const result = previous
    .catch(() => undefined)
    .then(async () => {
      const storage = await storagePath(root, [".minemods", "owner-check"], true)
      const lock = path.join(path.dirname(storage), "write.lock")
      await acquireLock(lock)
      // Retried: on Windows a scanner may hold the owner file for an instant. A lock still left behind carries this process's token and is cleared by its next writer.
      return operation().finally(() => rm(lock, { recursive: true, maxRetries: 8, retryDelay: 25 }))
    })
  pending.set(key, result)
  return result.finally(() => {
    if (pending.get(key) === result) pending.delete(key)
  })
}

export function createEntity(input: {
  name: string
  description?: string
  health?: number
  speed?: number
  attack_damage?: number
  behavior?: Entity["behavior"]
}) {
  return EntitySchema.parse({
    id: randomUUID(),
    name: input.name,
    description: input.description ?? "",
    health: input.health ?? 20,
    speed: input.speed ?? 0.25,
    attack_damage: input.attack_damage ?? 2,
    behavior: input.behavior ?? "passive",
    model_asset_id: null,
  })
}

/** Every target the project is built for, primary first. */
export function projectTargets(project: Pick<Project, "target" | "targets">): TargetId[] {
  return project.targets ? [...project.targets] : [project.target]
}

export async function createProject(input: { directory: string; name: string; description?: string; mod_id?: string; target?: TargetId }) {
  const name = z.string().trim().min(1).max(120).parse(input.name)
  const modId = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/).optional().parse(input.mod_id)
  const technical = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  const timestamp = new Date().toISOString()
  const project = ProjectSchema.parse({
    schema_version: 1,
    id: randomUUID(),
    name,
    description: input.description ?? "",
    // Fabric Loader refuses a mod id of a single character ("is only a single character"): the game would not start.
    mod_id: modId ?? (/^[a-z]./.test(technical)
      ? technical
      : `mod_${technical || randomUUID().replaceAll("-", "").slice(0, 12)}`
    ).slice(0, 64),
    target: input.target ?? DEFAULT_TARGET,
    revision: 0,
    created_at: timestamp,
    updated_at: timestamp,
    entities: [],
    assets: [],
    blocks: [],
    items: [],
    recipes: [],
    logic: [],
    conception: ConceptionSchema.parse({}),
    naming: "official",
  })
  await mkdir(input.directory, { recursive: true })
  return withProjectLock(input.directory, async () => {
    if (await lstat(await storagePath(input.directory, ["minemods.project.json"])).catch(missing))
      throw new Error("A project manifest already exists in this directory")
    await writeRecord(input.directory, ["minemods.project.json"], project)
    return project
  })
}

async function validateDependencies(directory: string, project: Project, metadataVerified = false) {
  const model = await import("./assets")
  await Promise.all(
    project.assets.map(async (asset) => {
      const bytes = await readFile(
        await storagePath(directory, [".minemods", "assets", asset.id, `${asset.revision}.json`]),
      )
      if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
        throw new Error(`Model asset checksum mismatch: ${asset.id}`)
      if (metadataVerified) return
      const record = model.ModelAssetSchema.parse(JSON.parse(bytes.toString("utf8")))
      if (
        record.id !== asset.id ||
        record.entity_id !== asset.entity_id ||
        record.revision !== asset.revision ||
        record.origin !== asset.origin ||
        record.created_at !== asset.created_at
      )
        throw new Error(`Model asset metadata mismatch: ${asset.id}`)
    }),
  )
}

// Keep one validated manifest per process. Callers own their copy; hashes also catch external edits
// with unchanged timestamps or revision numbers. Referenced model bytes are checked on every read.
let validated: { hash: string; project: Project } | undefined

export async function openProject(directory: string) {
  const bytes = await readProjectRecord(directory)
  const hash = createHash("sha256").update(bytes).digest("hex")
  const hit = validated?.hash === hash ? validated.project : null
  const project = hit ?? ProjectSchema.parse(JSON.parse(bytes.toString("utf8")))
  await validateDependencies(directory, project, !!hit)
  if (!hit) validated = { hash, project }
  return structuredClone(project)
}

/** Internal transaction primitive: caller must hold withProjectLock. */
export async function saveProjectUnlocked(directory: string, input: Project, expectedRevision: number) {
  const project = ProjectSchema.parse(input)
  const current = await openProject(directory)
  if (current.revision !== expectedRevision) throw new RevisionConflictError(expectedRevision, current.revision)
  if (project.revision !== expectedRevision) throw new RevisionConflictError(project.revision, current.revision)
  if (project.id !== current.id || project.created_at !== current.created_at || project.mod_id !== current.mod_id)
    throw new Error("Project identity, technical name and creation time are immutable")
  await validateDependencies(directory, project)
  const music = project.workspace.assets.filter(asset => asset.document.kind === "music" && !current.workspace.assets.some(previous => previous.id === asset.id && JSON.stringify(previous.document) === JSON.stringify(asset.document)))
  if (music.length) {
    const { readMedia } = await import("./media")
    const { checkMusicBytes } = await import("./music")
    for (const asset of music) if (asset.document.kind === "music") {
      for (const part of [asset.document.intro, asset.document.loop, asset.document.outro]) if (part) checkMusicBytes(part, await readMedia(directory, part.media_sha256))
    }
  }
  const naming = namingAfterSave(current, project)
  const updated = ProjectSchema.parse({
    ...project,
    ...(naming ? { naming } : {}),
    revision: current.revision + 1,
    updated_at: new Date().toISOString(),
  })
  await writeRecord(directory, ["minemods.project.json"], updated)
  await keepAssetVersions(directory, current, updated).catch(() => undefined)
  return updated
}

/** Whether a project has gameplay code, the one thing of a project that is written in the game's names. */
export const hasGameplayCode = (project: Pick<Project, "workspace">) => project.workspace.assets.some((asset) => asset.document.kind === "gameplay")

/**
 * The naming a save leaves the project in. Once official, always official: a caller holding a copy read before the mark was set does not take it away.
 * A project that had no gameplay code before this save has no code in the old names: when this save brings its first gameplay, that code was written in
 * the official names, and the project is marked now, so it is never sent through the conversion meant for code in the old names. Any other save of an
 * unmarked project writes it back as it was (a project without gameplay code does not need the mark).
 */
function namingAfterSave(current: Project, next: Project): Project["naming"] {
  return current.naming ?? next.naming ?? (!hasGameplayCode(current) && hasGameplayCode(next) ? "official" : undefined)
}

/** Where every saved version of a thing is kept: read by 验收窗「制作过程」, never built into the mod nor exported with the project. */
export const assetVersionSegments = (assetId: string, revision?: number) => [".minemods", "making", "versions", assetId, ...(revision === undefined ? [] : [`${revision}.json`])]
/**
 * `by`: who made this version. "restored": the person brought an older one back (`from` says which). "converted": nobody wrote it; Studio turned the
 * version before it from the old Yarn names into Mojang's (`naming-migration.ts`), so it answers nothing that was asked of an AI.
 */
export type KeptVersion = { revision: number; at: string; by: "ai" | "person" | "restored" | "converted"; from?: number; title: string; document: unknown }

/**
 * Every way a thing gets saved comes through `saveProjectUnlocked`, so this is the one place that can see them all, the AI's and the person's alike. A record already
 * there is left alone (a step back to an old version wrote its own, saying so); the version being replaced is kept too when an older project never recorded it.
 */
async function keepAssetVersions(directory: string, before: Project, after: Project) {
  const write = async (asset: Project["workspace"]["assets"][number]) => {
    const segments = assetVersionSegments(asset.id, asset.revision)
    const target = await storagePath(directory, segments, true)
    if (await lstat(target).then(() => true, () => false)) return
    const kept: KeptVersion = { revision: asset.revision, at: asset.updated_at, by: asset.provenance.model === null ? "person" : "ai", title: asset.title, document: asset.document }
    await writeRecord(directory, segments, kept)
  }
  for (const asset of after.workspace.assets) {
    const was = before.workspace.assets.find((value) => value.id === asset.id)
    if (was?.revision === asset.revision) continue
    if (was) await write(was)
    await write(asset)
  }
}

export async function saveProject(directory: string, project: Project, expectedRevision: number) {
  return withProjectLock(directory, () => saveProjectUnlocked(directory, project, expectedRevision))
}

export async function listProjects(workspaceDirectory: string) {
  const root = await realpath(workspaceDirectory)
  const entries = await Promise.all(
    (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map(async (entry) => {
        const directory = path.join(root, entry.name)
        return openProject(directory)
          .then((project) => ({ directory, project }))
          .catch(() => undefined)
      }),
  )
  return entries
    .filter((entry) => entry !== undefined)
    .sort((a, b) => b.project.updated_at.localeCompare(a.project.updated_at))
}
