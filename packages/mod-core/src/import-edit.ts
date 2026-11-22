import { createHash, randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import path from "node:path"
import vm from "node:vm"
import yauzl from "yauzl"
import { z } from "zod"
import { getImportProject, ImportProjectManifestSchema, ImportProjectReportSchema } from "./import-project"
import { inspectJavaClass } from "./class-inspect"

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const textExtensions = new Set([
  ".json",
  ".json5",
  ".toml",
  ".cfg",
  ".properties",
  ".yml",
  ".yaml",
  ".js",
  ".mjs",
  ".ts",
  ".zs",
  ".txt",
  ".md",
  ".mcfunction",
  ".snbt",
  ".recipe",
  ".lang",
  ".mcmeta",
  ".html",
  ".css",
  ".xml",
  ".csv",
])
const decoder = new TextDecoder("utf-8", { fatal: true })
const ContextSchema = z.strictObject({
  workspaceDirectory: z.string().min(1),
  id: z.uuid(),
  paths: z.array(z.string()).max(500).optional(),
})
const ChangeSchema = z
  .strictObject({
    path: z.string().min(1).max(240),
    operation: z.enum(["write", "delete"]),
    expected_sha256: digestSchema.nullable(),
    content: z
      .string()
      .max(2 * 1024 * 1024)
      .nullable(),
  })
  .superRefine((change, ctx) => {
    if (change.path.includes("!/") || change.path.includes("#method="))
      ctx.addIssue({ code: "custom", message: "Archive evidence paths are read-only" })
    if ((change.operation === "write") !== (change.content !== null))
      ctx.addIssue({ code: "custom", message: "write requires content and delete requires null content" })
  })
export const ChangeSetSchema = z
  .strictObject({
    schema_version: z.literal(1),
    id: z.uuid(),
    project_id: z.uuid(),
    source_sha256: digestSchema,
    summary: z.string().trim().min(1).max(2000),
    changes: z.array(ChangeSchema).min(1).max(500),
    warnings: z.array(z.string().max(2000)).max(100),
  })
  .superRefine((set, ctx) => {
    const paths = set.changes.map((change) => safePath(change.path).toLowerCase())
    if (new Set(paths).size !== paths.length) ctx.addIssue({ code: "custom", message: "Duplicate change paths" })
    if (set.changes.reduce((sum, change) => sum + Buffer.byteLength(change.content ?? "", "utf8"), 0) > 2 * 1024 * 1024)
      ctx.addIssue({ code: "custom", message: "Combined change content exceeds 2 MiB" })
  })
export type ChangeSet = z.infer<typeof ChangeSetSchema>
export type ImportEvidence = {
  id: string
  path: string
  sha256: string
  kind: string
  content: string
  truncated: boolean
}

function contextPath(input: string) {
  const selectorAt = input.indexOf("#"),
    outerAndMember = selectorAt < 0 ? input : input.slice(0, selectorAt),
    rawSelector = selectorAt < 0 ? undefined : input.slice(selectorAt + 1)
  const methodName = rawSelector?.startsWith("method=") ? rawSelector.slice(7) : undefined
  const find = rawSelector?.startsWith("find=") ? rawSelector.slice(5) : undefined
  if (rawSelector !== undefined && methodName === undefined && find === undefined)
    throw new Error(`Invalid archive selector: ${input}`)
  if (methodName !== undefined && (!methodName || !/^[A-Za-z_$<>][A-Za-z0-9_$<>]*$/.test(methodName)))
    throw new Error(`Invalid class method selector: ${input}`)
  if (find !== undefined && (!find || find.length > 80)) throw new Error(`Invalid archive search selector: ${input}`)
  const [outer, member, extra] = outerAndMember!.split("!/")
  if (extra !== undefined) throw new Error(`Invalid nested archive path: ${input}`)
  const result = {
    path: member === undefined ? safePath(outer!) : `${safePath(outer!)}!/${safePath(member)}`,
    methodName,
    find,
  }
  if (methodName && !result.path.toLowerCase().endsWith(".class"))
    throw new Error("Method selectors require a .class path")
  if (find && (!result.path.toLowerCase().endsWith(".jar") || member !== undefined))
    throw new Error("Search selectors require a JAR path")
  return result
}

function safePath(input: string) {
  const name = input.normalize("NFC")
  if (
    !name ||
    name.length > 240 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes(":") ||
    name.includes("\0") ||
    name
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw new Error(`Unsafe import path: ${input}`)
  if (path.posix.normalize(name) !== name) throw new Error(`Non-canonical import path: ${input}`)
  return name
}
function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}
async function fileHash(filename: string) {
  const h = createHash("sha256")
  for await (const chunk of createReadStream(filename)) h.update(chunk)
  return h.digest("hex")
}
function openZip(filename: string) {
  return new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(
      filename,
      {
        lazyEntries: true,
        autoClose: false,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (err, zip) => (err || !zip ? reject(err ?? new Error("Unable to open import archive")) : resolve(zip)),
    ),
  )
}
function readEntryPreview(zip: yauzl.ZipFile, entry: yauzl.Entry, max: number, byteLimit = 64 * 1024 * 1024) {
  return new Promise<{ bytes: Buffer; sha256: string; truncated: boolean; size: number }>((resolve, reject) =>
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error("Unable to read archive entry"))
      const chunks: Buffer[] = [],
        digest = createHash("sha256")
      let captured = 0,
        size = 0
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length
        if (size > Math.min(64 * 1024 * 1024, byteLimit)) {
          stream.destroy(new Error("Evidence read byte budget exceeded"))
          return
        }
        digest.update(chunk)
        if (captured < max) {
          const part = chunk.subarray(0, max - captured)
          chunks.push(part)
          captured += part.length
        }
      })
      stream.once("error", reject)
      stream.once("end", () =>
        resolve({ bytes: Buffer.concat(chunks), sha256: digest.digest("hex"), truncated: size > captured, size }),
      )
    }),
  )
}
function readEntryBytes(zip: yauzl.ZipFile, entry: yauzl.Entry, max: number) {
  if (entry.uncompressedSize > max) return Promise.reject(new Error("Archive entry exceeds its byte limit"))
  return new Promise<Buffer>((resolve, reject) =>
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(error ?? new Error("Unable to read archive entry"))
      const chunks: Buffer[] = []
      let size = 0
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length
        if (size > max) {
          stream.destroy(new Error("Archive entry exceeds its byte limit"))
          return
        }
        chunks.push(chunk)
      })
      stream.once("error", reject)
      stream.once("end", () => resolve(Buffer.concat(chunks)))
    }),
  )
}
function hashEntry(zip: yauzl.ZipFile, entry: yauzl.Entry) {
  return new Promise<string>((resolve, reject) =>
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(error ?? new Error("Unable to hash archive entry"))
      const h = createHash("sha256")
      stream.on("data", (chunk: Buffer) => h.update(chunk))
      stream.once("error", reject)
      stream.once("end", () => resolve(h.digest("hex")))
    }),
  )
}
async function validateRevisionHistory(
  sourcePath: string,
  projectId: string,
  sourceSha256: string,
  revisionList: Awaited<ReturnType<typeof revisions>>,
) {
  let parent: string | null = null
  for (const revision of revisionList) {
    if (
      revision.project_id !== projectId ||
      revision.source_sha256 !== sourceSha256 ||
      revision.parent_revision_id !== parent
    )
      throw new Error("Revision chain identity is invalid")
    parent = revision.id
  }
  const relevant = new Set(
    revisionList.flatMap((revision) => revision.changeset.changes.map((change) => change.path.toLowerCase())),
  )
  const original = new Map<string, string>(),
    originalNames = new Map<string, string>(),
    directories = new Set<string>(),
    zip = await openZip(sourcePath)
  try {
    await new Promise<void>((resolve, reject) => {
      let entryCount = 0
      const names = new Set<string>()
      zip.on("error", reject)
      zip.on("end", resolve)
      zip.on("entry", async (entry) => {
        try {
          if (++entryCount > 25_000) throw new Error("Source archive contains too many entries")
          const name = safePath(entry.fileName.endsWith("/") ? entry.fileName.slice(0, -1) : entry.fileName),
            key = name.toLowerCase()
          if (names.has(key)) throw new Error(`Source archive contains duplicate paths: ${name}`)
          names.add(key)
          if (entry.fileName.endsWith("/")) directories.add(key)
          else {
            originalNames.set(key, name)
            if (relevant.has(name.toLowerCase())) original.set(name.toLowerCase(), await hashEntry(zip, entry))
          }
          zip.readEntry()
        } catch (error) {
          reject(error)
          zip.close()
        }
      })
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
  const effective = new Map<string, string>(),
    effectiveNames = new Map<string, string>(),
    touched = new Set<string>()
  for (const revision of revisionList)
    for (const change of revision.changeset.changes) {
      const key = safePath(change.path).toLowerCase(),
        current = touched.has(key) ? (effective.get(key) ?? null) : (original.get(key) ?? null)
      const currentName = touched.has(key) ? effectiveNames.get(key) : originalNames.get(key)
      if (directories.has(key) || (currentName && currentName !== change.path))
        throw new Error(`Revision path casing or file type changed: ${change.path}`)
      if (current !== change.expected_sha256 || (change.operation === "delete" && current === null))
        throw new Error(`Revision precondition failed: ${change.path}`)
      touched.add(key)
      if (change.operation === "delete") {
        effective.delete(key)
        effectiveNames.delete(key)
      } else {
        effective.set(key, hash(Buffer.from(change.content!, "utf8")))
        effectiveNames.set(key, change.path)
      }
    }
}
function kindFor(name: string) {
  const p = name.toLowerCase().replace(/^(overrides|client-overrides|server-overrides)\//, "")
  if (/(^|\/)kubejs\//.test(p)) return "kubejs"
  if (/(^|\/)(quests|ftbquests|betterquesting)(\/|$)/.test(p)) return "quests"
  if (/(^|\/)assets\//.test(p)) return "assets"
  if (/(^|\/)data\//.test(p)) return "data"
  if (/(^|\/)(config|defaultconfigs)\//.test(p)) return "config"
  if (
    /(^|\/)pack\.mcmeta$/i.test(p) ||
    /manifest|modrinth\.index|fabric\.mod|mods\.toml|mcmod\.info/i.test(path.posix.basename(p))
  )
    return "metadata"
  return "text"
}
const isText = (name: string) => textExtensions.has(path.posix.extname(name).toLowerCase())
export function isImportEditablePath(name: string) {
  try {
    return (
      safePath(name) === name &&
      !name.includes("!/") &&
      !name.includes("#") &&
      isText(name) &&
      !name.toLowerCase().endsWith(".class")
    )
  } catch {
    return false
  }
}
async function projectContext(workspaceDirectory: string, id: string) {
  const project = await getImportProject(workspaceDirectory, id)
  const sourcePath = path.join(project.directory, "source", project.manifest.source.filename)
  const info = await lstat(sourcePath)
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size !== project.manifest.source.bytes ||
    (await fileHash(sourcePath)) !== project.manifest.source.sha256
  )
    throw new Error("Imported source archive has changed")
  return { ...project, sourcePath }
}
async function inspectNestedArchive(
  project: Awaited<ReturnType<typeof projectContext>>,
  outerName: string,
  memberRequests: { path: string; methodName?: string }[],
  findSelectors: string[],
  byteLimit: number,
  evidenceByteLimit: number,
) {
  const sourceZip = await openZip(project.sourcePath),
    tempDirectory = path.join(project.directory, "temp")
  const tempInfo = await lstat(tempDirectory)
  if (!tempInfo.isDirectory() || tempInfo.isSymbolicLink()) throw new Error("Unsafe import temporary directory")
  const tempFile = path.join(tempDirectory, `nested-${randomUUID()}.jar`)
  try {
    const nested = await new Promise<{ bytes?: Buffer; sha256: string; size: number }>((resolve, reject) => {
      let found = false
      sourceZip.on("error", reject)
      sourceZip.on("end", () => (found ? undefined : reject(new Error(`Nested archive not found: ${outerName}`))))
      sourceZip.on("entry", async (entry) => {
        try {
          if (!entry.fileName.endsWith("/") && safePath(entry.fileName) === outerName) {
            found = true
            if (entry.uncompressedSize > byteLimit) {
              reject(new Error(`Nested JAR exceeds remaining inspection budget: ${outerName}`))
              sourceZip.close()
              return
            }
            const bytes = await readEntryBytes(sourceZip, entry, byteLimit)
            resolve({ bytes, sha256: hash(bytes), size: bytes.byteLength })
            sourceZip.close()
            return
          }
          sourceZip.readEntry()
        } catch (error) {
          reject(error)
          sourceZip.close()
        }
      })
      sourceZip.readEntry()
    })
    const requested = memberRequests.map((item) => ({ ...item, path: safePath(item.path) })),
      result: ImportEvidence[] = []
    if (!nested.bytes) throw new Error(`Nested JAR was not read: ${outerName}`)
    await writeFile(tempFile, nested.bytes, { flag: "wx", mode: 0o600 })
    const nestedZip = await openZip(tempFile),
      requestedSet = new Map<string, typeof requested>()
    for (const request of requested)
      requestedSet.set(request.path, [...(requestedSet.get(request.path) ?? []), request])
    const indexEntries: { path: string; size: number }[] = []
    let count = 0,
      evidenceBytesRead = 0
    try {
      await new Promise<void>((resolve, reject) => {
        nestedZip.on("error", reject)
        nestedZip.on("end", resolve)
        nestedZip.on("entry", async (entry) => {
          try {
            if (++count > 25_000) throw new Error("Nested archive entry limit exceeded")
            const name = safePath(entry.fileName.endsWith("/") ? entry.fileName.slice(0, -1) : entry.fileName)
            if (!entry.fileName.endsWith("/")) {
              indexEntries.push({ path: name, size: entry.uncompressedSize })
              const requests = requestedSet.get(name) ?? []
              if (requests.length && isText(name)) {
                if (evidenceBytesRead >= evidenceByteLimit)
                  throw new Error("Explicit nested evidence exceeds the remaining 256 MiB evidence read budget")
                if (entry.uncompressedSize > Math.min(64 * 1024 * 1024, evidenceByteLimit - evidenceBytesRead))
                  throw new Error("Explicit nested text exceeds the remaining evidence read budget")
                const preview = await readEntryPreview(
                  nestedZip,
                  entry,
                  24 * 1024,
                  evidenceByteLimit - evidenceBytesRead,
                )
                evidenceBytesRead += preview.size
                const content = new TextDecoder().decode(preview.bytes)
                if (!content.includes("\0"))
                  result.push({
                    id: `ev_${createHash("sha256").update(`${outerName}!/${name}\0${preview.sha256}`).digest("hex").slice(0, 32)}`,
                    path: `${outerName}!/${name}`,
                    sha256: preview.sha256,
                    kind: kindFor(name),
                    content,
                    truncated: preview.truncated,
                  })
              } else if (requests.length && name.toLowerCase().endsWith(".class")) {
                if (entry.uncompressedSize > 8 * 1024 * 1024) throw new Error("Class evidence exceeds 8 MiB")
                const allowed = Math.min(8 * 1024 * 1024, evidenceByteLimit - evidenceBytesRead)
                if (allowed <= 0 || entry.uncompressedSize > allowed)
                  throw new Error("Explicit nested class exceeds the remaining evidence read budget")
                const bytes = await readEntryBytes(nestedZip, entry, allowed),
                  sha256 = hash(bytes)
                evidenceBytesRead += bytes.byteLength
                for (const request of requests) {
                  const inspected = inspectJavaClass(bytes, request.methodName),
                    selector = request.methodName ? `#method=${request.methodName}` : ""
                  result.push({
                    id: `ev_${createHash("sha256").update(`${outerName}!/${name}${selector}\0${sha256}`).digest("hex").slice(0, 32)}`,
                    path: `${outerName}!/${name}${selector}`,
                    sha256,
                    kind: "bytecode",
                    content: inspected.content.slice(0, 24 * 1024),
                    truncated: inspected.truncated || inspected.content.length > 24 * 1024,
                  })
                }
              }
            }
            nestedZip.readEntry()
          } catch (error) {
            reject(error)
            nestedZip.close()
          }
        })
        nestedZip.readEntry()
      })
    } finally {
      nestedZip.close()
    }
    for (const find of findSelectors) {
      let entries = indexEntries
          .filter((entry) => !find || entry.path.toLowerCase().includes(find.toLowerCase()))
          .sort((a, b) => {
            const rank = (item: typeof a) =>
              item.path.toLowerCase().endsWith(".class") ? 0 : isText(item.path) ? 1 : 2
            return rank(a) - rank(b) || a.path.localeCompare(b.path)
          }),
        content = "",
        matchedCount = entries.length
      do {
        content = JSON.stringify({ sizeBytes: nested.size, entries, truncated: entries.length < matchedCount })
        if (content.length > 24 * 1024) entries = entries.slice(0, Math.max(0, entries.length - 100))
      } while (content.length > 24 * 1024 && entries.length)
      const selector = find ? `#find=${find}` : ""
      result.push({
        id: `ev_${createHash("sha256").update(`${outerName}${selector}\0${nested.sha256}`).digest("hex").slice(0, 32)}`,
        path: `${outerName}${selector}`,
        sha256: nested.sha256,
        kind: "archive-index",
        content,
        truncated: entries.length < matchedCount,
      })
    }
    return { evidence: result, bytesRead: nested.size, evidenceBytesRead }
  } finally {
    sourceZip.close()
    await rm(tempFile, { force: true })
  }
}
export async function getImportContext(input: z.input<typeof ContextSchema>) {
  const request = ContextSchema.parse(input),
    project = await projectContext(request.workspaceDirectory, request.id)
  const requested = request.paths
      ?.map(contextPath)
      .filter(
        (item, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.path === item.path && candidate.methodName === item.methodName && candidate.find === item.find,
          ) === index,
      ),
    evidence: ImportEvidence[] = []
  let total = 0,
    seenEntries = 0,
    inspectionBytesRead = 0
  const zip = await openZip(project.sourcePath)
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject)
      zip.on("end", resolve)
      const next = () => zip.readEntry()
      zip.on("entry", async (entry) => {
        try {
          seenEntries += 1
          if (seenEntries > 25000) throw new Error("Archive entry limit exceeded")
          const name = entry.fileName.endsWith("/") ? entry.fileName.slice(0, -1) : entry.fileName
          safePath(name)
          const explicit = requested?.filter((item) => item.path === name) ?? []
          const selected = requested
            ? explicit.length > 0 && isText(name)
            : isText(name) &&
              (/(^|\/)(manifest\.json|modrinth\.index\.json|fabric\.mod\.json|pack\.mcmeta|mcmod\.info)$|^meta-inf\/.*\.toml$/i.test(
                name,
              ) ||
                /(^|\/)(kubejs|config|defaultconfigs|data|assets|quests|ftbquests|betterquesting)(\/|$)/i.test(name))
          if (requested && explicit.length && name.toLowerCase().endsWith(".class")) {
            if (entry.uncompressedSize > 8 * 1024 * 1024) throw new Error("Class evidence exceeds 8 MiB")
            const allowed = Math.min(8 * 1024 * 1024, 256 * 1024 * 1024 - inspectionBytesRead)
            if (allowed <= 0 || entry.uncompressedSize > allowed)
              throw new Error("Explicit class evidence exceeds the remaining 256 MiB evidence read budget")
            const bytes = await readEntryBytes(zip, entry, allowed),
              sha256 = hash(bytes)
            inspectionBytesRead += bytes.byteLength
            for (const selector of explicit) {
              const inspected = inspectJavaClass(bytes, selector.methodName),
                method = selector.methodName ? `#method=${selector.methodName}` : ""
              evidence.push({
                id: `ev_${createHash("sha256").update(`${name}${method}\0${sha256}`).digest("hex").slice(0, 32)}`,
                path: `${name}${method}`,
                sha256,
                kind: "bytecode",
                content: inspected.content.slice(0, 24 * 1024),
                truncated: inspected.truncated || inspected.content.length > 24 * 1024,
              })
            }
          } else if (selected) {
            const kind = kindFor(name),
              requestedPath = explicit.length > 0
            const bucket =
              kind === "metadata"
                ? "metadata"
                : kind === "kubejs" || kind === "data"
                  ? "scripts"
                  : kind === "assets"
                    ? "assets"
                    : "config"
            const quotas = { metadata: 15_000, scripts: 75_000, config: 20_000, assets: 10_000 }
            const usedInQuota = requestedPath
              ? total
              : evidence
                  .filter((item) => {
                    const itemBucket =
                      item.kind === "metadata"
                        ? "metadata"
                        : item.kind === "kubejs" || item.kind === "data"
                          ? "scripts"
                          : item.kind === "assets"
                            ? "assets"
                            : "config"
                    return itemBucket === bucket
                  })
                  .reduce((sum, item) => sum + item.content.length, 0)
            const quota = requestedPath ? 120_000 : quotas[bucket]
            const remainingContent = Math.max(0, Math.min(120_000 - total, quota - usedInQuota))
            if (!requestedPath && !remainingContent) {
              next()
              return
            }
            const remainingRead = 256 * 1024 * 1024 - inspectionBytesRead
            if (requestedPath && remainingRead <= 0)
              throw new Error("Explicit text evidence exceeds the remaining 256 MiB evidence read budget")
            if (!requestedPath && remainingRead <= 0) {
              next()
              return
            }
            if (requestedPath && entry.uncompressedSize > Math.min(64 * 1024 * 1024, remainingRead))
              throw new Error("Explicit text evidence exceeds the remaining 256 MiB evidence read budget")
            if (!requestedPath && entry.uncompressedSize > Math.min(64 * 1024 * 1024, remainingRead)) {
              next()
              return
            }
            const preview = await readEntryPreview(zip, entry, 24 * 1024, remainingRead)
            inspectionBytesRead += preview.size
            if (preview) {
              const text = new TextDecoder().decode(preview.bytes)
              if (!text.includes("\0")) {
                const content = text.slice(0, Math.min(24 * 1024, remainingContent))
                if (content) {
                  const id = `ev_${createHash("sha256").update(`${name}\0${preview.sha256}`).digest("hex").slice(0, 32)}`
                  const item = {
                    id,
                    path: name,
                    sha256: preview.sha256,
                    kind,
                    content,
                    truncated: preview.truncated || content.length < text.length,
                  }
                  evidence.push(item)
                  total += content.length
                }
              }
            }
          }
          next()
        } catch (error) {
          reject(error)
          zip.close()
        }
      })
      next()
    })
  } finally {
    zip.close()
  }
  const nestedGroups = new Map<string, { members: { path: string; methodName?: string }[]; findSelectors: string[] }>()
  for (const item of requested ?? []) {
    if (item.path.includes("!/")) {
      const [outer, member] = item.path.split("!/") as [string, string]
      const group = nestedGroups.get(outer) ?? { members: [], findSelectors: [] }
      group.members.push({ path: member, methodName: item.methodName })
      nestedGroups.set(outer, group)
    } else if (item.path.toLowerCase().endsWith(".jar")) {
      const group = nestedGroups.get(item.path) ?? { members: [], findSelectors: [] }
      const selector = item.find ?? ""
      if (!group.findSelectors.includes(selector)) group.findSelectors.push(selector)
      nestedGroups.set(item.path, group)
    }
  }
  let nestedBudget = 256 * 1024 * 1024
  for (const [outer, group] of nestedGroups) {
    const inspected = await inspectNestedArchive(
      project,
      outer,
      group.members,
      group.findSelectors,
      nestedBudget,
      256 * 1024 * 1024 - inspectionBytesRead,
    )
    nestedBudget -= inspected.bytesRead
    inspectionBytesRead += inspected.evidenceBytesRead
    for (const item of inspected.evidence) {
      const content = item.content.slice(0, Math.min(24 * 1024, 120_000 - total))
      if (content) {
        evidence.push({ ...item, content, truncated: item.truncated || content.length < item.content.length })
        total += content.length
      }
    }
  }
  const base = await revisionsDirectory(project.directory),
    known = await revisions(base),
    current = await overlayState(base, request.id, project.manifest.source.sha256, known)
  const latestChanges = new Map<string, { sha256: string; content?: string }>()
  for (const rev of current.latest ? revisionLineage(current.latest, known) : [])
    for (const change of rev.changeset.changes)
      if (change.operation === "delete") latestChanges.set(change.path, { sha256: "" })
      else
        latestChanges.set(change.path, { sha256: hash(Buffer.from(change.content!, "utf8")), content: change.content! })
  for (const [name, change] of latestChanges) {
    const index = evidence.findIndex((item) => item.path === name)
    if (index >= 0) {
      total -= evidence[index]!.content.length
      evidence.splice(index, 1)
    }
    if (!change.content || (requested && !requested.some((item) => item.path === name))) continue
    const remaining = Math.max(0, 120_000 - total),
      content = change.content.slice(0, Math.min(24 * 1024, remaining))
    if (!content) continue
    evidence.push({
      id: `ev_${createHash("sha256").update(`${name}\0${change.sha256}`).digest("hex").slice(0, 32)}`,
      path: name,
      sha256: change.sha256,
      kind: kindFor(name),
      content,
      truncated: content.length < change.content.length,
    })
    total += content.length
  }
  return {
    projectId: request.id,
    sourceSha256: project.manifest.source.sha256,
    sourceName: project.manifest.source.filename,
    report: project.report,
    revisionId: current.latest,
    evidence,
  }
}

const revisionSchema = z.strictObject({
  schema_version: z.literal(1),
  id: z.uuid(),
  project_id: z.uuid(),
  source_sha256: digestSchema,
  parent_revision_id: z.uuid().nullable(),
  created_at: z.iso.datetime(),
  changeset_sha256: digestSchema,
  changeset: ChangeSetSchema,
  validation: z.object({ valid: z.boolean(), issues: z.array(z.string()) }),
})
async function revisionsDirectory(directory: string) {
  const base = path.join(directory, "working", "revisions")
  await mkdir(base, { recursive: true })
  for (const target of [path.join(directory, "working"), base]) {
    const info = await lstat(target)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe revision storage")
  }
  return base
}
async function revisions(base: string) {
  const ids = (await readdir(base, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && z.uuid().safeParse(entry.name).success)
    .map((entry) => entry.name)
  return Promise.all(
    ids.map(async (id) => {
      const dir = path.join(base, id),
        directoryInfo = await lstat(dir),
        file = path.join(dir, "manifest.json"),
        info = await lstat(file)
      if (
        !directoryInfo.isDirectory() ||
        directoryInfo.isSymbolicLink() ||
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 16 * 1024 * 1024
      )
        throw new Error("Revision storage is corrupt or unsafe")
      try {
        const revision = revisionSchema.parse(JSON.parse(await readFile(file, "utf8")))
        if (
          revision.id !== id ||
          revision.changeset.project_id !== revision.project_id ||
          revision.changeset.source_sha256 !== revision.source_sha256 ||
          revision.changeset_sha256 !== hash(Buffer.from(JSON.stringify(revision.changeset)))
        )
          throw new Error("Revision manifest hash or identity is invalid")
        return revision
      } catch (error) {
        throw new Error("Revision manifest is corrupt", { cause: error })
      }
    }),
  ).then((items) => items.filter((item): item is z.infer<typeof revisionSchema> => Boolean(item)))
}
async function overlayState(
  base: string,
  projectId: string,
  sourceSha: string,
  revisionList: Awaited<ReturnType<typeof revisions>>,
) {
  const state = new Map<string, { sha256: string; content?: string; path: string }>(),
    touched = new Set<string>(),
    latestPaths = new Map<string, string>(),
    parentIds = new Set(
      revisionList.flatMap((revision) => (revision.parent_revision_id ? [revision.parent_revision_id] : [])),
    )
  const tips = revisionList.filter((revision) => !parentIds.has(revision.id))
  if (revisionList.length && tips.length !== 1) throw new Error("Revision history branches or has no latest revision")
  const ordered = tips.length ? revisionLineage(tips[0]!.id, revisionList) : []
  if (ordered.length !== revisionList.length) throw new Error("Revision history contains an orphan or cycle")
  let parent: string | null = null
  for (const rev of ordered) {
    if (rev.project_id !== projectId || rev.source_sha256 !== sourceSha || rev.parent_revision_id !== parent)
      throw new Error("Revision chain is invalid")
    for (const change of rev.changeset.changes) {
      const name = safePath(change.path)
      const key = name.toLowerCase()
      if (latestPaths.has(key) && latestPaths.get(key) !== name)
        throw new Error(`Revision path casing changed: ${name}`)
      touched.add(key)
      latestPaths.set(key, name)
      if (change.operation === "delete") state.delete(key)
      else state.set(key, { sha256: hash(Buffer.from(change.content!, "utf8")), content: change.content!, path: name })
    }
    parent = rev.id
  }
  return { state, touched, latestPaths, latest: parent }
}
function revisionLineage(revisionId: string, revisionList: Awaited<ReturnType<typeof revisions>>) {
  const byId = new Map(revisionList.map((revision) => [revision.id, revision])),
    lineage: typeof revisionList = []
  let current = byId.get(revisionId)
  if (!current) throw new Error("Import revision not found")
  const visited = new Set<string>()
  while (current) {
    if (visited.has(current.id)) throw new Error("Revision parent cycle detected")
    visited.add(current.id)
    lineage.unshift(current)
    if (!current.parent_revision_id) break
    const parent = byId.get(current.parent_revision_id)
    if (!parent) throw new Error("Revision parent is missing")
    current = parent
  }
  return lineage
}
export async function listImportRevisions(input: { workspaceDirectory: string; id: string }) {
  const project = await projectContext(input.workspaceDirectory, input.id),
    base = await revisionsDirectory(project.directory)
  return (await revisions(base))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(({ changeset, ...item }) => ({ ...item, summary: changeset.summary }))
}
export async function getImportRevision(input: { workspaceDirectory: string; id: string; revisionId: string }) {
  const project = await projectContext(input.workspaceDirectory, input.id),
    base = await revisionsDirectory(project.directory),
    id = z.uuid().parse(input.revisionId)
  const found = (await revisions(base)).find((rev) => rev.id === id)
  if (!found) throw new Error("Import revision not found")
  const revisionDirectory = path.join(base, id),
    files = await Promise.all(
      found.changeset.changes
        .filter((change) => change.operation === "write")
        .map(async (change) => {
          const segments = [revisionDirectory, "files", ...safePath(change.path).split("/")]
          let current = segments[0]!
          for (const segment of segments.slice(1)) {
            current = path.join(current, segment)
            const info = await lstat(current)
            if (
              info.isSymbolicLink() ||
              (current === path.join(revisionDirectory, "files")
                ? !info.isDirectory()
                : segment === segments.at(-1)
                  ? !info.isFile()
                  : !info.isDirectory())
            )
              throw new Error("Unsafe revision file")
          }
          const bytes = await readFile(current),
            content = decoder.decode(bytes)
          if (bytes.byteLength > 2 * 1024 * 1024 || hash(bytes) !== hash(Buffer.from(change.content!, "utf8")))
            throw new Error("Revision content has changed")
          return { path: change.path, content }
        }),
    )
  return { ...found, files }
}
async function applyImportChangesUnlocked(input: {
  workspaceDirectory: string
  id: string
  changeset: unknown
  parentRevisionId: string | null
}) {
  const changeset = ChangeSetSchema.parse(input.changeset),
    project = await projectContext(input.workspaceDirectory, input.id)
  if (changeset.project_id !== input.id || changeset.source_sha256 !== project.manifest.source.sha256)
    throw new Error("Change set does not target this imported source")
  for (const change of changeset.changes) {
    safePath(change.path)
    if (!isImportEditablePath(change.path)) throw new Error(`Unsupported import edit path: ${change.path}`)
    if (change.operation === "write") {
      if (!isText(change.path) || /\.(class|jar|zip|png|jpg|jpeg|gif|webp|ogg|mp3|dat|nbt)$/i.test(change.path))
        throw new Error(`Binary or unsupported write: ${change.path}`)
      const bytes = Buffer.from(change.content!, "utf8")
      if (bytes.includes(0)) throw new Error(`Binary content is not allowed: ${change.path}`)
      if (
        /(?:[A-Z]:\\(?:Users|Documents and Settings)\\|\\\\[^\\]+\\[^\\]+\\|\/(?:home|Users)\/[^/]+\/)/i.test(
          change.content!,
        ) ||
        /(?:api[_-]?key|access[_-]?token|secret|password|passwd|authorization)\s*[:=]\s*["']?[A-Za-z0-9_+/.=-]{16,}/i.test(
          change.content!,
        )
      )
        throw new Error(`Private path or credential-like value is not allowed: ${change.path}`)
      if (/\.json$|\.mcmeta$/i.test(change.path)) JSON.parse(change.content!)
      if (/\.js$/i.test(change.path)) new vm.Script(change.content!, { filename: safePath(change.path) })
    }
  }
  const base = await revisionsDirectory(project.directory),
    known = await revisions(base),
    { state, touched, latestPaths, latest } = await overlayState(base, input.id, changeset.source_sha256, known)
  const changesetJson = JSON.stringify(changeset),
    changesetHash = hash(Buffer.from(changesetJson)),
    prior = known.find((revision) => revision.changeset.id === changeset.id)
  if (prior) {
    if (
      prior.project_id !== input.id ||
      prior.source_sha256 !== changeset.source_sha256 ||
      prior.parent_revision_id !== input.parentRevisionId ||
      prior.changeset_sha256 !== changesetHash ||
      JSON.stringify(prior.changeset) !== changesetJson
    )
      throw new Error("Change set ID conflicts with a previously committed revision")
    await getImportRevision({ workspaceDirectory: input.workspaceDirectory, id: input.id, revisionId: prior.id })
    return { revisionId: prior.id, parentRevisionId: prior.parent_revision_id, validation: prior.validation }
  }
  if (input.parentRevisionId !== latest)
    throw new Error("Import revision changed; refresh context before applying changes")
  const zip = await openZip(project.sourcePath),
    original = new Map<string, string>(),
    originalNames = new Map<string, string>(),
    directories = new Set<string>()
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject)
      zip.on("end", resolve)
      zip.on("entry", async (entry) => {
        try {
          const name = safePath(entry.fileName.endsWith("/") ? entry.fileName.slice(0, -1) : entry.fileName),
            key = name.toLowerCase()
          if (entry.fileName.endsWith("/")) directories.add(key)
          else if (changeset.changes.some((change) => change.path.toLowerCase() === key)) {
            originalNames.set(key, name)
            original.set(key, await hashEntry(zip, entry))
          }
          zip.readEntry()
        } catch (error) {
          reject(error)
          zip.close()
        }
      })
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
  for (const change of changeset.changes) {
    const key = change.path.toLowerCase(),
      currentName = touched.has(key) ? latestPaths.get(key) : originalNames.get(key)
    if (directories.has(key) || (currentName && currentName !== change.path))
      throw new Error(`Path casing or file type changed: ${change.path}`)
    const current = touched.has(key) ? (state.get(key)?.sha256 ?? null) : (original.get(key) ?? null)
    if (current !== change.expected_sha256) throw new Error(`Source changed or expected hash mismatch: ${change.path}`)
    if (change.operation === "delete" && current === null)
      throw new Error(`Cannot delete a missing path: ${change.path}`)
  }
  const revisionId = randomUUID(),
    staging = path.join(base, `.${revisionId}.tmp`),
    destination = path.join(base, revisionId),
    validation = { valid: true, issues: [] as string[] }
  await mkdir(path.join(staging, "files"), { recursive: true })
  try {
    for (const change of changeset.changes.filter((item) => item.operation === "write")) {
      const target = path.join(staging, "files", ...safePath(change.path).split("/"))
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, change.content!, { flag: "wx", mode: 0o600 })
    }
    const manifest = revisionSchema.parse({
      schema_version: 1,
      id: revisionId,
      project_id: input.id,
      source_sha256: changeset.source_sha256,
      parent_revision_id: latest,
      created_at: new Date().toISOString(),
      changeset_sha256: changesetHash,
      changeset,
      validation,
    })
    await writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    })
    await rename(staging, destination)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  return { revisionId, parentRevisionId: latest, validation }
}

async function withApplyLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const working = path.join(directory, "working")
  await mkdir(working, { recursive: true })
  const workingInfo = await lstat(working)
  if (!workingInfo.isDirectory() || workingInfo.isSymbolicLink()) throw new Error("Unsafe import working directory")
  const lockPath = path.join(working, "apply.lock"),
    token = randomUUID()
  let handle
  try {
    handle = await open(lockPath, "wx", 0o600)
  } catch (error) {
    const info = await lstat(lockPath).catch(() => undefined)
    if (!info?.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error("Import project is busy")
    if (info.size === 0 && info.mtimeMs < Date.now() - 30_000) {
      await rm(lockPath, { force: false })
      return withApplyLock(directory, action)
    }
    const owner = await readFile(lockPath, "utf8")
      .then((text) => z.object({ pid: z.number().int().positive(), token: z.uuid() }).safeParse(JSON.parse(text)))
      .catch(() => undefined)
    if (!owner?.success) throw new Error("Import project is busy")
    try {
      process.kill(owner.data.pid, 0)
      throw new Error("Import project is busy")
    } catch (probeError) {
      if ((probeError as NodeJS.ErrnoException).code !== "ESRCH") throw probeError
    }
    await rm(lockPath, { force: false })
    try {
      handle = await open(lockPath, "wx", 0o600)
    } catch {
      throw new Error("Import project is busy")
    }
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid, token }))
  try {
    return await action()
  } finally {
    await handle.close()
    const current = await readFile(lockPath, "utf8")
      .then((text) => JSON.parse(text) as { token?: string })
      .catch(() => undefined)
    if (current?.token === token) await rm(lockPath, { force: true })
  }
}
export async function applyImportChanges(input: {
  workspaceDirectory: string
  id: string
  changeset: unknown
  parentRevisionId: string | null
}) {
  const project = await getImportProject(input.workspaceDirectory, input.id)
  return withApplyLock(project.directory, () => applyImportChangesUnlocked(input))
}

async function writeArchive(destination: string, add: (zip: import("yazl").ZipFile) => Promise<void>) {
  const yazl = await import("yazl"),
    zip = new yazl.ZipFile(),
    temp = `${destination}.${randomUUID()}.tmp`
  try {
    await lstat(destination)
    throw new Error("Export destination already exists")
  } catch (error) {
    if (error instanceof Error && error.message === "Export destination already exists") throw error
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const output = zip.outputStream,
    writeTask = pipeline(output, createWriteStream(temp, { flags: "wx", mode: 0o600 }))
  void writeTask.catch(() => undefined)
  try {
    await Promise.all([writeTask, add(zip).then(() => zip.end())])
    await link(temp, destination)
    await rm(temp)
  } catch (error) {
    ;(output as unknown as import("node:stream").Readable).destroy(
      error instanceof Error ? error : new Error("Archive export failed"),
    )
    await writeTask.catch(() => undefined)
    await rm(temp, { force: true })
    throw error
  }
}
async function exportDestination(
  destination: string,
  projectDirectory: string,
  sourcePath: string,
  internalTemporary = false,
) {
  if (!path.isAbsolute(destination)) throw new Error("Export destination must be absolute")
  const project = await realpath(projectDirectory)
  let candidate = path.resolve(path.dirname(destination)),
    missing: string[] = [],
    existing: string
  while (true) {
    try {
      existing = await realpath(candidate)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      const parent = path.dirname(candidate)
      if (parent === candidate) throw error
      missing.unshift(path.basename(candidate))
      candidate = parent
    }
  }
  const parent = path.join(existing, ...missing),
    target = path.join(parent, path.basename(destination))
  const withinProject = (candidatePath: string) => {
    const relative = path.relative(project, candidatePath)
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  }
  const managedTemporary = (candidatePath: string) => {
    const relative = path.relative(project, candidatePath).split(path.sep)
    return (
      internalTemporary &&
      relative.length === 3 &&
      relative[0] === "temp" &&
      /^reverse-effective-[a-f0-9-]{36}$/.test(relative[1]!) &&
      /^effective\.(?:jar|zip|mrpack)$/i.test(relative[2]!)
    )
  }
  const requestedTarget = path.resolve(destination)
  if (internalTemporary && !managedTemporary(requestedTarget)) throw new Error("Invalid managed temporary export path")
  if (withinProject(target) && !managedTemporary(target))
    throw new Error("Export destination must be outside the imported project")
  await mkdir(parent, { recursive: true })
  const canonicalParent = await realpath(parent),
    canonicalTarget = path.join(canonicalParent, path.basename(destination))
  if (internalTemporary && canonicalTarget !== requestedTarget)
    throw new Error("Managed temporary export path resolves through an unexpected directory")
  if (withinProject(canonicalTarget) && !managedTemporary(canonicalTarget))
    throw new Error("Export destination must be outside the imported project")
  const source = await realpath(sourcePath)
  if (canonicalTarget.toLowerCase() === source.toLowerCase())
    throw new Error("Export destination cannot replace the original source")
  try {
    await lstat(canonicalTarget)
    throw new Error("Export destination already exists")
  } catch (error) {
    if (error instanceof Error && error.message === "Export destination already exists") throw error
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  return canonicalTarget
}
function addBuffer(zip: import("yazl").ZipFile, name: string, content: string | Buffer) {
  zip.addBuffer(Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"), name, { mode: 0o600 })
}
export async function exportModifiedImport(input: {
  workspaceDirectory: string
  id: string
  revisionId: string
  destination: string
  kind: "archive" | "project"
  internalTemporary?: boolean
}) {
  const extension = path.extname(input.destination).toLowerCase()
  if (
    !path.isAbsolute(input.destination) ||
    (input.kind === "archive" ? ![".zip", ".jar", ".mrpack"].includes(extension) : extension !== ".modwork")
  )
    throw new Error(
      input.kind === "project"
        ? "Project exports must use an absolute .modwork destination"
        : "Archive exports must use an absolute .zip or .jar destination",
    )
  const project = await projectContext(input.workspaceDirectory, input.id),
    base = await revisionsDirectory(project.directory),
    known = await revisions(base),
    wanted = z.uuid().parse(input.revisionId),
    revisionList = revisionLineage(wanted, known),
    selected = revisionList.at(-1)!
  const destination = await exportDestination(
    input.destination,
    project.directory,
    project.sourcePath,
    input.internalTemporary,
  )
  await overlayState(base, input.id, project.manifest.source.sha256, revisionList)
  const changes = new Map<string, { operation: "write" | "delete"; content?: string }>()
  for (const rev of revisionList)
    for (const change of rev.changeset.changes)
      changes.set(change.path, {
        operation: change.operation,
        ...(change.content === null ? {} : { content: change.content }),
      })
  if (input.kind === "archive") {
    const zipSource = await openZip(project.sourcePath),
      present = new Set<string>()
    const signedJar =
      /\.jar$/i.test(project.manifest.source.filename) && revisionList.some((rev) => rev.changeset.changes.length > 0)
    let signaturesRemoved = false,
      expandedBytes = 0,
      addedBytes = 0
    try {
      await writeArchive(destination, async (out) => {
        await new Promise<void>((resolve, reject) => {
          zipSource.on("error", reject)
          zipSource.on("end", resolve)
          zipSource.on("entry", (entry) => {
            const name = entry.fileName
            if (name.endsWith("/")) {
              try {
                safePath(name.slice(0, -1))
              } catch (error) {
                reject(error)
                zipSource.close()
                return
              }
              out.addEmptyDirectory(name)
              zipSource.readEntry()
              return
            }
            let safe: string
            try {
              safe = safePath(name)
            } catch (error) {
              reject(error)
              zipSource.close()
              return
            }
            present.add(safe)
            if (signedJar && /^META-INF\/[^/]+\.(?:SF|RSA|DSA|EC)$/i.test(safe)) {
              signaturesRemoved = true
              zipSource.readEntry()
              return
            }
            const changed = changes.get(safe)
            if (changed?.operation === "delete") {
              zipSource.readEntry()
              return
            }
            if (changed?.operation === "write") {
              const bytes = Buffer.byteLength(changed.content ?? "", "utf8")
              addedBytes += bytes
              if (bytes > 1024 ** 3 || expandedBytes + addedBytes > 8 * 1024 ** 3) {
                reject(new Error("Expanded archive output exceeds export limits"))
                zipSource.close()
                return
              }
              addBuffer(out, safe, changed.content ?? "")
              zipSource.readEntry()
              return
            }
            if (
              entry.uncompressedSize > 1024 ** 3 ||
              expandedBytes + entry.uncompressedSize + addedBytes > 8 * 1024 ** 3
            ) {
              reject(new Error("Expanded archive output exceeds export limits"))
              zipSource.close()
              return
            }
            zipSource.openReadStream(entry, (err, stream) => {
              if (err || !stream) {
                reject(err ?? new Error("Unable to stream imported entry"))
                zipSource.close()
                return
              }
              let currentBytes = 0
              const guarded = new Transform({
                transform(chunk: Buffer, _encoding, callback) {
                  currentBytes += chunk.length
                  expandedBytes += chunk.length
                  if (currentBytes > 1024 ** 3 || expandedBytes + addedBytes > 8 * 1024 ** 3)
                    return callback(new Error("Expanded archive output exceeds export limits"))
                  callback(null, chunk)
                },
              })
              stream.once("error", (streamError) => guarded.destroy(streamError))
              guarded.once("end", () => zipSource.readEntry())
              guarded.once("error", (streamError) => {
                stream.destroy(streamError)
                zipSource.close()
                reject(streamError)
              })
              out.addReadStream(guarded, safe, { mode: (entry.externalFileAttributes >>> 16) & 0o777 })
              stream.pipe(guarded)
            })
          })
          zipSource.readEntry()
        })
        for (const [name, change] of changes)
          if (!present.has(name) && change.operation === "write") {
            if (signedJar && /^META-INF\/[^/]+\.(?:SF|RSA|DSA|EC)$/i.test(name)) {
              signaturesRemoved = true
              continue
            }
            const bytes = Buffer.byteLength(change.content ?? "", "utf8")
            addedBytes += bytes
            if (bytes > 1024 ** 3 || expandedBytes + addedBytes > 8 * 1024 ** 3)
              throw new Error("Expanded archive output exceeds export limits")
            addBuffer(out, name, change.content ?? "")
          }
        if (signaturesRemoved)
          addBuffer(
            out,
            `META-INF/MINEMODS-UNSIGNED-${randomUUID()}.txt`,
            "MineMods removed previous JAR signature files because archive content changed. Re-sign the JAR before relying on signature verification.\n",
          )
      })
    } finally {
      zipSource.close()
    }
    return {
      path: destination,
      kind: input.kind,
      revisionId: wanted,
      warnings: signaturesRemoved
        ? ["Removed stale JAR signatures; re-sign before relying on signature verification."]
        : [],
    }
  }
  const projectDestination = destination
  const sourceFile = path.join(project.directory, "source", project.manifest.source.filename)
  const reportText = await readFile(path.join(project.directory, "report.json"), "utf8")
  const ancestors = revisionList
  const sourceHash = await fileHash(sourceFile)
  if (sourceHash !== project.manifest.source.sha256) throw new Error("Imported source archive has changed")
  await writeArchive(projectDestination, async (out) => {
    const { createReadStream } = await import("node:fs")
    out.addReadStream(createReadStream(sourceFile), `source/${project.manifest.source.filename}`, { mode: 0o600 })
    addBuffer(out, "manifest.json", JSON.stringify(project.manifest, null, 2) + "\n")
    addBuffer(out, "report.json", reportText)
    addBuffer(
      out,
      "README.txt",
      "MineMods editable import project\n\nThis .modwork contains the complete original imported archive, scan report, and AI-assisted text revisions. The original archive is preserved as supplied and may itself contain credentials or private machine paths; review it before sharing. External mod downloads and game/runtime dependencies may still be required. Check the original project and mod licenses.\n",
    )
    addBuffer(
      out,
      "revision/manifest.json",
      JSON.stringify(
        {
          format: "minemods-modwork",
          version: 1,
          revisionId: wanted,
          projectId: input.id,
          sourceSha256: project.manifest.source.sha256,
        },
        null,
        2,
      ) + "\n",
    )
    for (const rev of ancestors) {
      addBuffer(out, `revision/revisions/${rev.id}/manifest.json`, JSON.stringify(rev, null, 2) + "\n")
      const revFiles = await getImportRevision({
        workspaceDirectory: input.workspaceDirectory,
        id: input.id,
        revisionId: rev.id,
      })
      for (const file of revFiles.files) addBuffer(out, `revision/revisions/${rev.id}/files/${file.path}`, file.content)
    }
  })
  return {
    path: projectDestination,
    kind: input.kind,
    revisionId: wanted,
    warnings: [
      "The complete original archive is included; inspect its contents for credentials and private paths before sharing.",
    ],
  }
}

const BundleRevisionSchema = z.strictObject({
  format: z.literal("minemods-modwork"),
  version: z.literal(1),
  revisionId: z.uuid(),
  projectId: z.uuid(),
  sourceSha256: digestSchema,
})
function bundleTarget(name: string, stage: string) {
  const parts = safePath(name).split("/")
  if (["manifest.json", "report.json"].includes(name)) return path.join(stage, name)
  if (parts[0] === "source" && parts.length === 2) return path.join(stage, "source", safePath(parts[1]!))
  if (name === "revision/manifest.json") return path.join(stage, "bundle-revision.json")
  if (parts[0] === "revision" && parts[1] === "revisions" && z.uuid().safeParse(parts[2]).success) {
    const id = parts[2]!
    if (parts.length === 4 && parts[3] === "manifest.json")
      return path.join(stage, "working", "revisions", id, "manifest.json")
    if (parts.length >= 5 && parts[3] === "files")
      return path.join(stage, "working", "revisions", id, "files", ...parts.slice(4))
  }
  if (name === "README.txt") return undefined
  throw new Error(`Unexpected .modwork entry: ${name}`)
}
export async function restoreModificationProject(input: { workspaceDirectory: string; filename: string }) {
  if (!path.isAbsolute(input.workspaceDirectory) || !path.isAbsolute(input.filename))
    throw new Error("Choose absolute workspace and .modwork paths")
  if (path.extname(input.filename).toLowerCase() !== ".modwork") throw new Error("Choose a .modwork project archive")
  const bundleInfo = await lstat(input.filename)
  if (!bundleInfo.isFile() || bundleInfo.isSymbolicLink() || bundleInfo.size > 3 * 1024 ** 3)
    throw new Error(".modwork input exceeds restore limits")
  const bundleFile = await realpath(input.filename),
    workspace = await realpath(input.workspaceDirectory),
    base = path.join(workspace, "analysis-projects")
  await mkdir(base, { recursive: true })
  const baseInfo = await lstat(base)
  if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) throw new Error("Unsafe analysis project storage")
  const stage = path.join(base, `.${randomUUID()}.restore.tmp`),
    seen = new Set<string>(),
    revisionFiles = new Set<string>(),
    sourceEntries = new Set<string>()
  await mkdir(stage)
  await mkdir(path.join(stage, "source"))
  await Promise.all(["runs", "logs", "temp"].map((name) => mkdir(path.join(stage, name), { recursive: true })))
  let zip: yauzl.ZipFile | undefined
  try {
    zip = await openZip(bundleFile)
    let entryCount = 0,
      actualBytes = 0
    await new Promise<void>((resolve, reject) => {
      zip!.on("error", reject)
      zip!.on("end", resolve)
      zip!.on("entry", async (entry) => {
        try {
          if (++entryCount > 30_000) throw new Error(".modwork contains too many entries")
          const directory = entry.fileName.endsWith("/"),
            name = directory ? entry.fileName.slice(0, -1) : entry.fileName
          safePath(name)
          if (directory) throw new Error(".modwork directory entries are not supported")
          const key = name.toLowerCase()
          if (seen.has(key)) throw new Error(`Duplicate .modwork entry: ${name}`)
          seen.add(key)
          if (name.startsWith("source/")) sourceEntries.add(name)
          if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
            throw new Error(".modwork may not contain symbolic links")
          const target = bundleTarget(name, stage)
          if (name.startsWith("revision/revisions/") && name.includes("/files/"))
            revisionFiles.add(name.slice("revision/revisions/".length))
          if (!target) {
            zip!.readEntry()
            return
          }
          if (entry.uncompressedSize > 2 * 1024 ** 3 || actualBytes + entry.uncompressedSize > 8 * 1024 ** 3)
            throw new Error(".modwork expanded data exceeds restore limits")
          await mkdir(path.dirname(target), { recursive: true })
          await new Promise<void>((done, fail) =>
            zip!.openReadStream(entry, (err, stream) => {
              if (err || !stream) return fail(err ?? new Error("Unable to read .modwork entry"))
              let bytes = 0
              const guard = new Transform({
                transform(chunk: Buffer, _encoding, callback) {
                  bytes += chunk.length
                  actualBytes += chunk.length
                  if (bytes > 2 * 1024 ** 3 || actualBytes > 8 * 1024 ** 3)
                    return callback(new Error(".modwork expanded data exceeds restore limits"))
                  callback(null, chunk)
                },
              })
              pipeline(stream, guard, createWriteStream(target, { flags: "wx", mode: 0o600 })).then(() => done(), fail)
            }),
          )
          zip!.readEntry()
        } catch (error) {
          reject(error)
          zip!.close()
        }
      })
      zip!.readEntry()
    })
    zip.close()
    zip = undefined
    const manifestInfo = await lstat(path.join(stage, "manifest.json")),
      reportInfo = await lstat(path.join(stage, "report.json"))
    if (manifestInfo.size > 64 * 1024 || reportInfo.size > 64 * 1024 * 1024)
      throw new Error(".modwork metadata exceeds validation limits")
    const manifest = ImportProjectManifestSchema.parse(
      JSON.parse(await readFile(path.join(stage, "manifest.json"), "utf8")),
    )
    const report = ImportProjectReportSchema.parse(JSON.parse(await readFile(path.join(stage, "report.json"), "utf8")))
    const bundleRevision = BundleRevisionSchema.parse(
      JSON.parse(await readFile(path.join(stage, "bundle-revision.json"), "utf8")),
    )
    if (
      manifest.id !== bundleRevision.projectId ||
      report.id !== manifest.id ||
      report.source.sha256 !== manifest.source.sha256 ||
      report.source.filename !== manifest.source.filename ||
      report.source.bytes !== manifest.source.bytes ||
      manifest.source.filename !== path.basename(manifest.source.filename) ||
      safePath(manifest.source.filename) !== manifest.source.filename ||
      !/\.(?:jar|zip|mrpack)$/i.test(manifest.source.filename) ||
      manifest.source.bytes > 2 * 1024 ** 3 ||
      manifest.report_sha256 !== hash(Buffer.from(JSON.stringify(report)))
    )
      throw new Error(".modwork manifest and report do not match")
    if (sourceEntries.size !== 1 || !sourceEntries.has(`source/${manifest.source.filename}`))
      throw new Error(".modwork must include exactly one declared source archive")
    if (bundleRevision.sourceSha256 !== manifest.source.sha256)
      throw new Error(".modwork source identity does not match")
    const sourcePath = path.join(stage, "source", manifest.source.filename),
      sourceInfo = await lstat(sourcePath)
    if (
      !sourceInfo.isFile() ||
      sourceInfo.isSymbolicLink() ||
      sourceInfo.size !== manifest.source.bytes ||
      (await fileHash(sourcePath)) !== manifest.source.sha256
    )
      throw new Error(".modwork source archive failed verification")
    const revisionsPath = path.join(stage, "working", "revisions"),
      restoredRevisions = await revisions(revisionsPath)
    const lineage = revisionLineage(bundleRevision.revisionId, restoredRevisions)
    await overlayState(revisionsPath, manifest.id, manifest.source.sha256, lineage)
    await validateRevisionHistory(sourcePath, manifest.id, manifest.source.sha256, lineage)
    if (restoredRevisions.length !== lineage.length)
      throw new Error(".modwork contains revisions outside the selected history")
    const expectedRevisionFiles = new Set<string>()
    for (const revision of lineage)
      for (const change of revision.changeset.changes)
        if (change.operation === "write") {
          const relative = `${revision.id}/files/${safePath(change.path)}`,
            filename = path.join(revisionsPath, revision.id, "files", ...safePath(change.path).split("/"))
          const info = await lstat(filename)
          if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024)
            throw new Error(`Revision file failed verification: ${change.path}`)
          const bytes = await readFile(filename)
          if (hash(bytes) !== hash(Buffer.from(change.content!, "utf8")))
            throw new Error(`Revision file failed verification: ${change.path}`)
          expectedRevisionFiles.add(relative)
        }
    if (
      expectedRevisionFiles.size !== revisionFiles.size ||
      [...expectedRevisionFiles].some((file) => !revisionFiles.has(file))
    )
      throw new Error(".modwork revision files do not match their manifests")
    if (bundleRevision.revisionId !== lineage.at(-1)?.id)
      throw new Error(".modwork does not identify its latest revision")
    const restoredId = randomUUID(),
      restoredReport = ImportProjectReportSchema.parse({ ...report, id: restoredId })
    const restoredManifest = ImportProjectManifestSchema.parse({
      ...manifest,
      id: restoredId,
      report_sha256: hash(Buffer.from(JSON.stringify(restoredReport))),
    })
    for (const revision of lineage) {
      const changeset = ChangeSetSchema.parse({ ...revision.changeset, project_id: restoredId })
      const updated = revisionSchema.parse({
        ...revision,
        project_id: restoredId,
        changeset,
        changeset_sha256: hash(Buffer.from(JSON.stringify(changeset))),
      })
      await writeFile(path.join(revisionsPath, revision.id, "manifest.json"), JSON.stringify(updated, null, 2) + "\n", {
        flag: "w",
        mode: 0o600,
      })
    }
    await writeFile(path.join(stage, "manifest.json"), JSON.stringify(restoredManifest, null, 2) + "\n", {
      flag: "w",
      mode: 0o600,
    })
    await writeFile(path.join(stage, "report.json"), JSON.stringify(restoredReport, null, 2) + "\n", {
      flag: "w",
      mode: 0o600,
    })
    await rm(path.join(stage, "bundle-revision.json"), { force: true })
    await overlayState(revisionsPath, restoredId, restoredManifest.source.sha256, await revisions(revisionsPath))
    const destination = path.join(base, restoredId)
    try {
      await lstat(destination)
      throw new Error(`Restored project ID collision: ${restoredId}`)
    } catch (error) {
      if (error instanceof Error && error.message.includes("collision")) throw error
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    await rename(stage, destination)
    return {
      directory: destination,
      manifest: restoredManifest,
      report: restoredReport,
      revisionId: bundleRevision.revisionId,
    }
  } catch (error) {
    zip?.close()
    await rm(stage, { recursive: true, force: true })
    throw error
  }
}
