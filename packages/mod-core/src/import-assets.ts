import { createHash, randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile, cp, readdir } from "node:fs/promises"
import { pipeline } from "node:stream/promises"
import { Transform } from "node:stream"
import path from "node:path"
import yauzl from "yauzl"
import { z } from "zod"
import { getImportProject } from "./import-project"
import {
  assertNoReverseSymlink,
  createReverseArchiveFromDirectory,
  extractReverseArchive,
  listReverseFilesOnDisk,
  reverseFilePath,
  safeReversePath,
} from "./reverse-archive"

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const GroupSchema = z.strictObject({
  id: digest,
  name: z.string().max(512),
  kind: z.enum(["mod", "author"]),
  path: z.string().max(2048),
  bytes: z.number().int().nonnegative(),
  description: z.string().max(2048),
})
export const ImportedAssetSchema = z.strictObject({
  id: digest,
  path: z.string().max(2048),
  resourcePath: z.string().max(2048),
  sourcePath: z.string().max(2048),
  groupId: digest,
  kind: z.enum(["model", "texture", "animation", "script", "config", "quest", "audio", "data", "other"]),
  format: z.string().max(32),
  name: z.string().max(512),
  namespace: z.string().max(256).nullable(),
  bytes: z.number().int().nonnegative(),
  sha256: digest,
  dependencies: z.array(digest).max(10000),
  origin: z.enum(["mod", "author"]),
})
export const ImportedAssetCatalogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: z.uuid(),
  sourceSha256: digest,
  createdAt: z.iso.datetime(),
  groups: z.array(GroupSchema).max(10000),
  assets: z.array(ImportedAssetSchema).max(100000),
  warnings: z.array(z.string().max(4096)).max(10000),
})
export type ImportedAsset = z.infer<typeof ImportedAssetSchema>
export type ImportedAssetCatalog = z.infer<typeof ImportedAssetCatalogSchema>

const assetRoot = (workspaceDirectory: string, id: string) =>
  path.join(workspaceDirectory, "analysis-projects", z.uuid().parse(id), "asset-workspace")
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const groupIdFor = (sourceSha256: string, kind: string, sourcePath: string) =>
  hash(Buffer.from(`${sourceSha256}\0${kind}\0${sourcePath}`))
const assetIdFor = (sourceSha256: string, sourcePath: string) => hash(Buffer.from(`${sourceSha256}\0${sourcePath}`))
const safeGroupDirectory = (id: string) => digest.parse(id).slice(0, 32)
const decoder = new TextDecoder("utf-8", { fatal: true })
const authorRoots = new Set([
  "kubejs",
  "config",
  "defaultconfigs",
  "quests",
  "ftbquests",
  "betterquesting",
  "scripts",
  "resources",
  "resourcepacks",
  "datapacks",
])

type ArchiveEntry = { path: string; directory: boolean; size: number; mode: number }
function openFile(filename: string) {
  return new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(
      filename,
      { lazyEntries: true, autoClose: true, strictFileNames: true, validateEntrySizes: true },
      (error, zip) => (error || !zip ? reject(error ?? new Error("Unable to inspect archive")) : resolve(zip)),
    ),
  )
}
async function listArchive(open: () => Promise<yauzl.ZipFile>) {
  const zip = await open(),
    result: ArchiveEntry[] = [],
    seen = new Set<string>()
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject)
    zip.on("end", resolve)
    zip.on("entry", (entry) => {
      try {
        const directory = entry.fileName.endsWith("/"),
          name = safeReversePath(directory ? entry.fileName.slice(0, -1) : entry.fileName),
          key = name.toLowerCase()
        if (seen.has(key)) throw new Error(`Duplicate case-insensitive archive path: ${name}`)
        if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
          throw new Error(`Archive symbolic link is not allowed: ${name}`)
        seen.add(key)
        result.push({
          path: name,
          directory,
          size: entry.uncompressedSize,
          mode: (entry.externalFileAttributes >>> 16) & 0o777,
        })
        if (result.length > 100_000) throw new Error("Archive entry count exceeds import asset listing limit")
        zip.readEntry()
      } catch (error) {
        zip.close()
        reject(error)
      }
    })
    zip.readEntry()
  })
  return result
}
async function extractSelectedEntries(input: {
  filename: string
  entries: {
    entry: ArchiveEntry
    group: z.infer<typeof GroupSchema>
    sourcePath: string
    type: NonNullable<ReturnType<typeof classify>>
  }[]
  destination: string
  budget: { totalBytes: number }
}) {
  const wanted = new Map(input.entries.map((item) => [item.entry.path.toLowerCase(), item])),
    zip = await openFile(input.filename),
    results: { item: (typeof input.entries)[number]; bytes: number; sha256: string; references: string[] }[] = [],
    seen = new Set<string>()
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject)
    zip.on("end", resolve)
    zip.on("entry", (entry) => {
      Promise.resolve()
        .then(async () => {
          const directory = entry.fileName.endsWith("/"),
            name = safeReversePath(directory ? entry.fileName.slice(0, -1) : entry.fileName),
            key = name.toLowerCase()
          if (seen.has(key)) throw new Error(`Duplicate case-insensitive archive path: ${name}`)
          seen.add(key)
          if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
            throw new Error(`Archive symbolic link is not allowed: ${name}`)
          const item = wanted.get(key)
          if (!directory && item) {
            if (
              entry.uncompressedSize > 2 * 1024 ** 3 ||
              input.budget.totalBytes + entry.uncompressedSize > 16 * 1024 ** 3
            )
              throw new Error("Selected asset data exceeds extraction limits")
            const target = reverseFilePath(
              input.destination,
              `files/${item.type.kind}/${safeGroupDirectory(item.group.id)}/${safeReversePath(item.entry.path)}`,
            )
            await mkdir(path.dirname(target), { recursive: true })
            const digest = createHash("sha256"),
              capture: Buffer[] = [],
              captureAllowed = /\.(?:json|mcmeta|bbmodel|tbl)$/i.test(item.entry.path),
              captureLimit = 2 * 1024 * 1024
            await new Promise<void>((done, fail) =>
              zip.openReadStream(entry, (error, stream) => {
                if (error || !stream) return fail(error ?? new Error(`Unable to read archive entry: ${name}`))
                let size = 0
                const guard = new Transform({
                  transform(chunk: Buffer, _encoding, callback) {
                    size += chunk.length
                    input.budget.totalBytes += chunk.length
                    if (size > 2 * 1024 ** 3 || input.budget.totalBytes > 16 * 1024 ** 3)
                      return callback(new Error("Selected asset data exceeds extraction limits"))
                    digest.update(chunk)
                    if (captureAllowed && size <= captureLimit) capture.push(Buffer.from(chunk))
                    callback(null, chunk)
                  },
                })
                pipeline(stream, guard, createWriteStream(target, { flags: "wx", mode: 0o600 })).then(
                  () => done(),
                  fail,
                )
              }),
            )
            wanted.delete(key)
            results.push({
              item,
              bytes: entry.uncompressedSize,
              sha256: digest.digest("hex"),
              references:
                captureAllowed && entry.uncompressedSize <= captureLimit ? references(Buffer.concat(capture)) : [],
            })
          }
        })
        .then(
          () => zip.readEntry(),
          (error) => {
            zip.close()
            reject(error)
          },
        )
    })
    zip.readEntry()
  })
  if (wanted.size)
    throw new Error(`Selected archive resource is missing: ${wanted.values().next().value?.entry.path ?? "unknown"}`)
  return results
}
function normalizedAuthorPath(sourcePath: string) {
  const parts = sourcePath.split("/")
  const start = parts.findIndex((part) => authorRoots.has(part.toLowerCase()))
  return start < 0 ? null : { root: parts[start]!.toLowerCase(), relative: parts.slice(start + 1).join("/") }
}
function resourcePathFor(sourcePath: string, origin: "mod" | "author") {
  if (origin === "mod") return sourcePath
  const author = normalizedAuthorPath(sourcePath)
  return author ? `${author.root}${author.relative ? `/${author.relative}` : ""}` : sourcePath
}
function isJarPath(name: string) {
  return /(^|\/)mods\/[^/]+\.jar$/i.test(name)
}
function sourceKind(filename: string) {
  return path.extname(filename).toLowerCase() === ".jar" ? ("jar" as const) : ("modpack" as const)
}

async function hashFile(filename: string) {
  const digest = createHash("sha256")
  for await (const chunk of createReadStream(filename)) digest.update(chunk)
  return digest.digest("hex")
}
async function sourceArchive(workspaceDirectory: string, id: string) {
  const project = await getImportProject(workspaceDirectory, id),
    sourceDirectory = path.join(project.directory, "source"),
    source = path.join(sourceDirectory, project.manifest.source.filename),
    real = await realpath(source),
    realSourceDirectory = await realpath(sourceDirectory),
    info = await stat(real)
  if (path.dirname(real) !== realSourceDirectory)
    throw new Error("Imported source archive escaped its project source directory")
  if (
    !info.isFile() ||
    info.size !== project.manifest.source.bytes ||
    (await hashFile(real)) !== project.manifest.source.sha256
  )
    throw new Error("Imported source archive is missing or has changed")
  return {
    project,
    filename: real,
    sourceSha256: project.manifest.source.sha256,
    kind: sourceKind(project.manifest.source.filename),
  }
}
type SourceGroup = {
  group: z.infer<typeof GroupSchema>
  sourceArchivePath: string | null
  authorEntries: ArchiveEntry[]
  moduleEntries: ArchiveEntry[]
}

async function scanGroups(workspaceDirectory: string, id: string) {
  const source = await sourceArchive(workspaceDirectory, id),
    outerOpen = () => openFile(source.filename),
    outer = await listArchive(outerOpen),
    groups: SourceGroup[] = [],
    warnings: string[] = []
  const seenAuthor = new Map<string, SourceGroup>()
  const addAuthor = (entry: ArchiveEntry) => {
    const author = normalizedAuthorPath(entry.path)
    if (!author || entry.directory) return
    const old = seenAuthor.get(author.root)
    if (old) {
      old.authorEntries.push(entry)
      old.group.bytes += entry.size
      return
    }
    const group: SourceGroup = {
      group: GroupSchema.parse({
        id: groupIdFor(source.sourceSha256, "author", author.root),
        name: author.root,
        kind: "author",
        path: author.root,
        bytes: entry.size,
        description: `整合包自定义 ${author.root} 内容`,
      }),
      sourceArchivePath: null,
      authorEntries: [entry],
      moduleEntries: [],
    }
    seenAuthor.set(author.root, group)
    groups.push(group)
  }
  if (source.kind === "jar") {
    const group: SourceGroup = {
      group: GroupSchema.parse({
        id: groupIdFor(source.sourceSha256, "mod", source.project.manifest.source.filename),
        name: source.project.manifest.source.filename,
        kind: "mod",
        path: source.project.manifest.source.filename,
        bytes: source.project.manifest.source.bytes,
        description: "输入 JAR 模组资源",
      }),
      sourceArchivePath: source.project.manifest.source.filename,
      authorEntries: [],
      moduleEntries: outer.filter((entry) => !entry.directory),
    }
    groups.push(group)
  } else {
    for (const entry of outer) {
      if (entry.directory) continue
      addAuthor(entry)
      if (isJarPath(entry.path))
        groups.push({
          group: GroupSchema.parse({
            id: groupIdFor(source.sourceSha256, "mod", entry.path),
            name: path.posix.basename(entry.path),
            kind: "mod",
            path: entry.path,
            bytes: entry.size,
            description: "整合包内嵌模组 JAR",
          }),
          sourceArchivePath: entry.path,
          authorEntries: [],
          moduleEntries: [],
        })
    }
  }
  const declared = source.project.report.metadata.dependency_files
  if (declared.length) warnings.push(`包内引用了 ${declared.length} 个外部下载项；未下载的依赖不会作为资产列出。`)
  const licenseFiles = groups
    .flatMap((group) => [...group.authorEntries, ...group.moduleEntries])
    .filter((entry) => /(^|\/)(license|licence|copying|notice)(\.[^/]*)?$/i.test(entry.path))
  if (licenseFiles.length)
    warnings.push(`检测到 ${licenseFiles.length} 个 LICENSE/NOTICE 类文件；导出目录包含这些文件及原始来源记录。`)
  return { source, groups, warnings }
}

export async function getImportAssetSelection(input: { workspaceDirectory: string; id: string }) {
  const { source, groups, warnings } = await scanGroups(input.workspaceDirectory, input.id)
  return {
    projectId: source.project.manifest.id,
    sourceKind: source.kind,
    sourceSha256: source.sourceSha256,
    groups: groups.map(({ group }) => group),
    warnings,
  }
}

function classify(sourcePath: string, group: z.infer<typeof GroupSchema>) {
  const lower = sourcePath.toLowerCase(),
    ext = path.posix.extname(lower).replace(/^\./, "") || "bin"
  if (/\.class$/i.test(lower)) return null
  if (/\.mcmeta$/i.test(lower)) return { kind: "data" as const, format: ext }
  if (/\.(?:animation|anim)\.json$/i.test(lower) || /(?:^|[_/])animation(?:s)?(?:[_./-]|$)/i.test(lower))
    return {
      kind: "animation" as const,
      format: ext === "json" && lower.endsWith(".animation.json") ? "animation.json" : ext,
    }
  if (
    /\.(bbmodel|tbl)$/i.test(lower) ||
    /\.geo\.json$/i.test(lower) ||
    /(^|\/)models?\/.*\.json$/i.test(lower) ||
    /(^|\/)geo\/.*\.json$/i.test(lower)
  )
    return { kind: "model" as const, format: ext === "json" && lower.endsWith(".geo.json") ? "geo.json" : ext }
  if (/\.(png|jpe?g|webp|tiff?)$/i.test(lower)) return { kind: "texture" as const, format: ext }
  if (/\.(ogg|wav|mp3|flac|m4a)$/i.test(lower) || /(^|\/)sounds?\//.test(lower))
    return { kind: "audio" as const, format: ext }
  if (
    group.kind === "author" &&
    ["quests", "ftbquests", "betterquesting"].some(
      (name) => lower.includes(`/${name}/`) || lower.startsWith(`${name}/`),
    )
  )
    return { kind: "quest" as const, format: ext }
  if (group.kind === "author" && /\.(?:js|zs|mjs|ts|json5|snbt)$/i.test(lower))
    return { kind: "script" as const, format: ext }
  if (/\.mcfunction$/i.test(lower)) return { kind: "data" as const, format: ext }
  if (group.kind === "author" && /\.(toml|cfg|properties|yml|yaml|ini|conf)$/i.test(lower))
    return { kind: "config" as const, format: ext }
  if (/^data\//i.test(lower) || /\.(json|mcmeta)$/i.test(lower)) return { kind: "data" as const, format: ext }
  return { kind: "other" as const, format: ext }
}
function namespaceFor(sourcePath: string) {
  const match = sourcePath.match(/(?:^|\/)(?:assets|data)\/([^/]+)\//i)
  return match?.[1] ?? null
}
function references(bytes: Buffer) {
  if (bytes.length > 2 * 1024 * 1024) return []
  try {
    const parsed: unknown = JSON.parse(decoder.decode(bytes)),
      found = new Set<string>()
    const visit = (value: unknown, reference = false) => {
      if (typeof value === "string" && reference) found.add(value.replace(/^#/, ""))
      if (Array.isArray(value)) value.forEach((item) => visit(item, reference))
      else if (typeof value === "object" && value !== null)
        Object.entries(value).forEach(([key, item]) =>
          visit(item, reference || /(?:textures?|model|parent)/i.test(key)),
        )
    }
    visit(parsed)
    return [...found]
  } catch {
    return []
  }
}
const catalogCache = new Map<string, { stamp: string; catalog: ImportedAssetCatalog }>()
async function loadCatalog(workspaceDirectory: string, id: string): Promise<ImportedAssetCatalog | null> {
  await getImportProject(workspaceDirectory, id)
  const root = assetRoot(workspaceDirectory, id),
    manifest = path.join(root, "manifest.json")
  const info = await lstat(root).catch((error: NodeJS.ErrnoException) =>
    error.code === "ENOENT" ? undefined : Promise.reject(error),
  )
  if (!info) return null
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Imported asset workspace is not a safe directory")
  await assertNoReverseSymlink(root, "manifest.json")
  const manifestInfo = await lstat(manifest)
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 64 * 1024 * 1024)
    throw new Error("Imported asset catalog is unsafe or too large")
  // Parsing and validating a large catalog takes a noticeable fraction of a second, and every asset
  // read starts here. The parsed result is reused while the manifest file on disk stays the same.
  const stamp = `${manifestInfo.size}:${manifestInfo.mtimeMs}:${manifestInfo.ino}`
  const cached = catalogCache.get(manifest)
  if (cached?.stamp === stamp) return cached.catalog
  const catalog = ImportedAssetCatalogSchema.parse(JSON.parse(await readFile(manifest, "utf8")))
  if (catalog.projectId !== z.uuid().parse(id)) throw new Error("Imported asset catalog project mismatch")
  catalogCache.delete(manifest)
  catalogCache.set(manifest, { stamp, catalog })
  if (catalogCache.size > 4) catalogCache.delete(catalogCache.keys().next().value!)
  return catalog
}
export async function getImportedAssetCatalog(input: { workspaceDirectory: string; id: string }) {
  return loadCatalog(input.workspaceDirectory, input.id)
}

export async function extractImportAssets(input: {
  workspaceDirectory: string
  id: string
  groupIds: string[]
}): Promise<ImportedAssetCatalog> {
  const requested = [...new Set(input.groupIds.map((value) => digest.parse(value)))].sort()
  if (!requested.length) throw new Error("Select at least one import asset group")
  if (requested.length > 10_000) throw new Error("Selected import asset group count exceeds the limit")
  const scanned = await scanGroups(input.workspaceDirectory, input.id),
    wantedGroups = scanned.groups.filter((entry) => requested.includes(entry.group.id))
  if (wantedGroups.length !== requested.length) throw new Error("Unknown import asset group ID")
  let current = await loadCatalog(input.workspaceDirectory, input.id)
  if (current && current.sourceSha256 !== scanned.source.sourceSha256)
    throw new Error("Imported asset source has changed")
  if (current && requested.every((id) => current!.groups.some((group) => group.id === id))) return current
  const groupsToExtract = wantedGroups.filter(
    ({ group }) => !current?.groups.some((existing) => existing.id === group.id),
  )
  const allSelected = [...(current?.groups ?? []), ...groupsToExtract.map(({ group }) => group)]
  const root = assetRoot(input.workspaceDirectory, input.id),
    staging = `${root}.tmp-${randomUUID()}`,
    backup = `${root}.bak-${randomUUID()}`
  await mkdir(staging, { recursive: true })
  try {
    if (current) {
      const oldRoot = root
      await listReverseFilesOnDisk(oldRoot)
      for (const asset of current.assets) {
        const source = reverseFilePath(oldRoot, `files/${asset.path}`)
        await assertNoReverseSymlink(oldRoot, `files/${asset.path}`)
        if ((await stat(source)).size !== asset.bytes || (await hashFile(source)) !== asset.sha256)
          throw new Error(`Existing imported asset was changed: ${asset.path}`)
      }
      await cp(oldRoot, staging, { recursive: true, force: false, errorOnExist: true })
    }
    await mkdir(path.join(staging, "files"), { recursive: true })
    const nestedRoot = path.join(staging, ".nested-jars"),
      nestedGroups = groupsToExtract.filter((group) => group.group.kind === "mod" && scanned.source.kind === "modpack")
    if (nestedGroups.length) {
      const nestedPaths = new Set(nestedGroups.map((group) => group.sourceArchivePath!))
      await extractReverseArchive(scanned.source.filename, nestedRoot, { include: (entry) => nestedPaths.has(entry) })
      for (const group of nestedGroups)
        group.moduleEntries = (
          await listArchive(() => openFile(reverseFilePath(nestedRoot, group.sourceArchivePath!)))
        ).filter((entry) => !entry.directory)
    }
    const discoveredLicenseFiles = groupsToExtract
      .flatMap((group) => [...group.authorEntries, ...group.moduleEntries])
      .filter((entry) => /(^|\/)(license|licence|copying|notice)(\.[^/]*)?$/i.test(entry.path))
    const specifications = (selected: SourceGroup) =>
      (selected.group.kind === "author" ? selected.authorEntries : selected.moduleEntries).flatMap((entry) => {
        const type = classify(entry.path, selected.group)
        return type
          ? [
              {
                entry,
                group: selected.group,
                type,
                sourcePath:
                  selected.group.kind === "author" ? entry.path : `${selected.sourceArchivePath}!/${entry.path}`,
              },
            ]
          : []
      })
    const dependencyRefs = new Map<string, string[]>(),
      extractionBudget = { totalBytes: 0 },
      newAssets = [] as ImportedAsset[]
    const persistExtracted = async (filename: string, specs: ReturnType<typeof specifications>) => {
      for (const result of await extractSelectedEntries({
        filename,
        entries: specs,
        destination: staging,
        budget: extractionBudget,
      })) {
        const assetId = assetIdFor(scanned.source.sourceSha256, result.item.sourcePath),
          relative = `${result.item.type.kind}/${safeGroupDirectory(result.item.group.id)}/${safeReversePath(result.item.entry.path)}`
        newAssets.push(
          ImportedAssetSchema.parse({
            id: assetId,
            path: relative,
            resourcePath: resourcePathFor(result.item.entry.path, result.item.group.kind),
            sourcePath: result.item.sourcePath,
            groupId: result.item.group.id,
            kind: result.item.type.kind,
            format: result.item.type.format,
            name: path.posix.basename(result.item.entry.path),
            namespace: namespaceFor(resourcePathFor(result.item.entry.path, result.item.group.kind)),
            bytes: result.bytes,
            sha256: result.sha256,
            dependencies: [],
            origin: result.item.group.kind,
          }),
        )
        dependencyRefs.set(assetId, result.references)
      }
    }
    const authorSpecs = groupsToExtract.filter((group) => group.group.kind === "author").flatMap(specifications)
    if (authorSpecs.length) await persistExtracted(scanned.source.filename, authorSpecs)
    if (scanned.source.kind === "jar") {
      const specs = groupsToExtract.filter((group) => group.group.kind === "mod").flatMap(specifications)
      if (specs.length) await persistExtracted(scanned.source.filename, specs)
    }
    for (const group of nestedGroups) {
      const specs = specifications(group)
      if (specs.length) await persistExtracted(reverseFilePath(nestedRoot, group.sourceArchivePath!), specs)
    }
    if (nestedGroups.length) await rm(nestedRoot, { recursive: true, force: true })
    const assets = [...(current?.assets ?? []), ...newAssets],
      byReference = new Map<string, string[]>(),
      authorByNamespace = new Map<string, string[]>()
    assets.forEach((asset) => {
      const aliases = [asset.resourcePath, asset.name, asset.name.replace(/\.[^.]+$/, "")]
      const resourceMatch = asset.resourcePath.match(/(?:^|\/)assets\/([^/]+)\/(.+)$/i)
      if (asset.namespace && resourceMatch?.[1] === asset.namespace) {
        const relative = resourceMatch[2]!.replace(/\.[^.]+$/, "")
        aliases.push(`${asset.namespace}:${relative}`, `${asset.namespace}:${relative.replace(/^textures?\//, "")}`)
        if (/^models?\//.test(relative))
          aliases.push(relative.replace(/^models?\//, ""), `${asset.namespace}:${relative.replace(/^models?\//, "")}`)
      }
      aliases.forEach((alias) =>
        byReference.set(`${asset.groupId}:${alias.toLowerCase()}`, [
          ...(byReference.get(`${asset.groupId}:${alias.toLowerCase()}`) ?? []),
          asset.id,
        ]),
      )
      if (asset.origin === "author" && asset.namespace)
        aliases.forEach((alias) =>
          authorByNamespace.set(`${asset.namespace}:${alias.toLowerCase()}`, [
            ...(authorByNamespace.get(`${asset.namespace}:${alias.toLowerCase()}`) ?? []),
            asset.id,
          ]),
        )
    })
    const combinedAssets = assets.map((asset) => ({
      ...asset,
      dependencies: [
        ...new Set([
          ...(current?.assets.find((old) => old.id === asset.id)?.dependencies ?? []),
          ...(dependencyRefs.get(asset.id) ?? [])
            .flatMap(
              (reference) =>
                byReference.get(`${asset.groupId}:${reference.toLowerCase()}`) ??
                (asset.origin === "author" && asset.namespace
                  ? (authorByNamespace.get(`${asset.namespace}:${reference.toLowerCase()}`) ?? [])
                  : []),
            )
            .filter((id) => id !== asset.id),
        ]),
      ],
    }))
    const licenseWarning = discoveredLicenseFiles.length
      ? `所选内容含 ${discoveredLicenseFiles.length} 个 LICENSE/NOTICE 类文件，已保留为资产。`
      : null
    const catalog = ImportedAssetCatalogSchema.parse({
      schemaVersion: 1,
      projectId: scanned.source.project.manifest.id,
      sourceSha256: scanned.source.sourceSha256,
      createdAt: current?.createdAt ?? new Date().toISOString(),
      groups: allSelected,
      assets: combinedAssets,
      warnings: [
        ...new Set([...(current?.warnings ?? []), ...scanned.warnings, ...(licenseWarning ? [licenseWarning] : [])]),
      ],
    })
    await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 })
    if (current) await rename(root, backup)
    try {
      await rename(staging, root)
    } catch (error) {
      if (current) await rename(backup, root)
      throw error
    }
    if (current) await rm(backup, { recursive: true, force: true })
    current = catalog
    return current
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

export async function getImportAssetRoot(input: { workspaceDirectory: string; id: string }) {
  await getImportProject(input.workspaceDirectory, input.id)
  const root = assetRoot(input.workspaceDirectory, input.id),
    info = await lstat(root).catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? undefined : Promise.reject(error),
    )
  if (!info || !info.isDirectory() || info.isSymbolicLink())
    throw new Error("Imported asset workspace is not available")
  return root
}

async function importedAssetPath(root: string, asset: ImportedAsset) {
  const relative = `files/${safeReversePath(asset.path)}`,
    target = reverseFilePath(root, relative)
  await assertNoReverseSymlink(root, relative)
  const info = await lstat(target)
  if (!info.isFile() || info.isSymbolicLink() || info.size !== asset.bytes)
    throw new Error("Imported asset file is unsafe or changed")
  return target
}

async function readVerifiedAssetPrefix(filename: string, asset: ImportedAsset, prefixLimit: number, maxBytes?: number) {
  const digest = createHash("sha256"),
    chunks: Buffer[] = []
  let bytesRead = 0,
    prefixBytes = 0
  for await (const chunk of createReadStream(filename)) {
    bytesRead += chunk.length
    if (maxBytes !== undefined && bytesRead > maxBytes)
      throw new Error(`Imported asset exceeds ${maxBytes} byte read limit`)
    digest.update(chunk)
    if (prefixBytes < prefixLimit) {
      const prefix = chunk.subarray(0, Math.min(chunk.length, prefixLimit - prefixBytes))
      chunks.push(prefix)
      prefixBytes += prefix.length
    }
  }
  if (bytesRead !== asset.bytes || digest.digest("hex") !== asset.sha256)
    throw new Error("Imported asset checksum mismatch")
  return { prefix: Buffer.concat(chunks), bytesRead }
}

export async function readImportedAssetBytes(input: { workspaceDirectory: string; id: string; assetId: string }) {
  const assetId = digest.parse(input.assetId),
    catalog = await loadCatalog(input.workspaceDirectory, input.id),
    asset = catalog?.assets.find((candidate) => candidate.id === assetId)
  if (!asset) throw new Error("Imported asset was not found")
  if (asset.bytes > 64 * 1024 * 1024) throw new Error("Imported asset exceeds the 64 MiB read limit")
  const target = await importedAssetPath(assetRoot(input.workspaceDirectory, input.id), asset)
  return readVerifiedAssetPrefix(target, asset, asset.bytes, 64 * 1024 * 1024).then(({ prefix }) => prefix)
}

export async function createImportedAssetReader(input: { workspaceDirectory: string; id: string }) {
  const catalog = await loadCatalog(input.workspaceDirectory, input.id)
  if (!catalog) throw new Error("Imported asset catalog does not exist")
  const root = assetRoot(input.workspaceDirectory, input.id)
  const index = new Map(catalog.assets.map((asset) => [asset.id, { ...asset }]))
  return {
    catalog,
    readBytes: async (assetId: string) => {
      const asset = index.get(digest.parse(assetId))
      if (!asset) throw new Error("Imported asset was not found")
      if (asset.bytes > 64 * 1024 * 1024) throw new Error("Imported asset exceeds the 64 MiB read limit")
      const target = await importedAssetPath(root, asset)
      return readVerifiedAssetPrefix(target, asset, asset.bytes, 64 * 1024 * 1024).then(({ prefix }) => prefix)
    },
  }
}

export async function readImportedAssetFile(input: { workspaceDirectory: string; id: string; assetId: string }) {
  const catalog = await loadCatalog(input.workspaceDirectory, input.id),
    asset = catalog?.assets.find((candidate) => candidate.id === digest.parse(input.assetId))
  if (!asset) throw new Error("Imported asset was not found")
  const target = await importedAssetPath(assetRoot(input.workspaceDirectory, input.id), asset),
    { prefix, bytesRead } = await readVerifiedAssetPrefix(target, asset, 4 * 1024 * 1024 + 1)
  const text =
    /\.(?:json|json5|snbt|mcmeta|mcfunction|txt|toml|cfg|properties|yml|yaml|ini|conf|js|mjs|ts|zs|md)$/i.test(
      asset.name,
    )
  if (text) {
    try {
      return {
        path: asset.path,
        encoding: "utf8" as const,
        content: new TextDecoder().decode(prefix.subarray(0, 4 * 1024 * 1024)),
        truncated: bytesRead > 4 * 1024 * 1024,
      }
    } catch {}
  }
  const slice = prefix.subarray(0, 4 * 1024 * 1024)
  return {
    path: asset.path,
    encoding: "base64" as const,
    content: slice.toString("base64"),
    truncated: bytesRead > slice.length,
  }
}

export async function saveImportedAssetFile(input: {
  workspaceDirectory: string
  id: string
  assetId: string
  expectedSha256: string
  content: string
}) {
  const catalog = await loadCatalog(input.workspaceDirectory, input.id),
    assetId = digest.parse(input.assetId),
    expectedSha256 = digest.parse(input.expectedSha256),
    asset = catalog?.assets.find((candidate) => candidate.id === assetId)
  if (!catalog || !asset) throw new Error("Imported asset was not found")
  if (asset.sha256 !== expectedSha256) throw new Error("Imported asset changed since it was opened")
  if (
    !/\.(?:json|json5|snbt|mcmeta|mcfunction|txt|toml|cfg|properties|yml|yaml|ini|conf|js|mjs|ts|zs|md)$/i.test(
      asset.name,
    )
  )
    throw new Error("Only text imported assets can be edited")
  if (asset.bytes > 4 * 1024 * 1024) throw new Error("Imported asset text exceeds the 4 MiB edit limit")
  const bytes = Buffer.from(input.content, "utf8")
  if (bytes.length > 4 * 1024 * 1024) throw new Error("Imported asset text exceeds the 4 MiB edit limit")
  const root = assetRoot(input.workspaceDirectory, input.id),
    relative = `files/${safeReversePath(asset.path)}`,
    target = reverseFilePath(root, relative)
  await assertNoReverseSymlink(root, relative)
  const oldInfo = await lstat(target)
  if (!oldInfo.isFile() || oldInfo.isSymbolicLink() || oldInfo.size !== asset.bytes)
    throw new Error("Imported asset file is unsafe or changed")
  const oldBytes = await readFile(target)
  if (hash(oldBytes) !== expectedSha256) throw new Error("Imported asset checksum mismatch")
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 })
  await rename(temporary, target).catch(async (error) => {
    await rm(temporary, { force: true })
    throw error
  })
  const updated = ImportedAssetSchema.parse({ ...asset, bytes: bytes.length, sha256: hash(bytes) }),
    next = ImportedAssetCatalogSchema.parse({
      ...catalog,
      assets: catalog.assets.map((candidate) => (candidate.id === assetId ? updated : candidate)),
    }),
    manifest = path.join(root, "manifest.json"),
    manifestTemp = `${manifest}.${randomUUID()}.tmp`
  await writeFile(manifestTemp, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx", mode: 0o600 })
  await rename(manifestTemp, manifest).catch(async (error) => {
    await rm(manifestTemp, { force: true })
    await writeFile(target, oldBytes, { mode: 0o600 })
    throw error
  })
  return next
}

export async function exportImportAssetWorkspace(input: {
  workspaceDirectory: string
  id: string
  destination: string
}) {
  const catalog = await loadCatalog(input.workspaceDirectory, input.id)
  if (!catalog) throw new Error("Imported asset catalog does not exist")
  if (!path.isAbsolute(input.destination)) throw new Error("Choose an absolute export destination")
  const project = await getImportProject(input.workspaceDirectory, input.id),
    root = assetRoot(input.workspaceDirectory, input.id),
    sourceDirectory = path.join(project.directory, "source"),
    destination = path.join(await realpath(path.dirname(input.destination)), path.basename(input.destination))
  const within = (parent: string, target: string) => {
    const relative = path.relative(path.resolve(parent), path.resolve(target))
    return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  }
  if (within(root, destination) || within(sourceDirectory, destination))
    throw new Error("Export destination cannot replace or be inside imported source or asset workspace")
  await listReverseFilesOnDisk(root)
  for (const asset of catalog.assets) {
    const filename = await importedAssetPath(root, asset)
    if ((await hashFile(filename)) !== asset.sha256) throw new Error("Imported asset checksum mismatch")
  }
  await validateDerivedModels(root, catalog)
  const graphInfo = await lstat(path.join(root, "graph.json")).catch((error: NodeJS.ErrnoException) =>
    error.code === "ENOENT" ? undefined : Promise.reject(error),
  )
  if (graphInfo) {
    const { loadImportAssetGraph } = await import("./import-asset-graph")
    await loadImportAssetGraph(input)
  }
  const notice = path.join(root, "MINE-MODS-ASSET-NOTICE.txt"),
    noticeText = `MineMods extracted asset package\n\nThis archive contains selected resources and their provenance from an imported Minecraft archive. It is not a directly launchable modpack.\n\nOriginal source SHA-256: ${catalog.sourceSha256}\nProject ID: ${catalog.projectId}\n\nCopyright and licenses for original materials remain with their respective authors. Confirm license terms before sharing this export. Preserve LICENSE/NOTICE files when present.\n\nScripts and configuration are stored as data and are never executed by MineMods during extraction.\n`
  const existingNotice = await lstat(notice).catch((error: NodeJS.ErrnoException) =>
    error.code === "ENOENT" ? undefined : Promise.reject(error),
  )
  if (
    existingNotice &&
    (!existingNotice.isFile() || existingNotice.isSymbolicLink() || (await readFile(notice, "utf8")) !== noticeText)
  )
    throw new Error("Export notice path is occupied by a different file")
  if (!existingNotice) await writeFile(notice, noticeText, { flag: "wx", mode: 0o600 })
  await createReverseArchiveFromDirectory(root, destination)
  return { path: destination }
}

async function validateDerivedModels(root: string, catalog: ImportedAssetCatalog) {
  const modelsRoot = path.join(root, "models"),
    modelRootInfo = await lstat(modelsRoot).catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? undefined : Promise.reject(error),
    )
  if (!modelRootInfo) return
  if (!modelRootInfo.isDirectory() || modelRootInfo.isSymbolicLink())
    throw new Error("Derived models directory is unsafe")
  const modelAssets = new Map(
      catalog.assets.filter((asset) => asset.kind === "model").map((asset) => [asset.id, asset]),
    ),
    entries = await readdir(modelsRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !digest.safeParse(entry.name).success)
      throw new Error("Derived model directory is unsafe")
    const sourceAsset = modelAssets.get(entry.name)
    if (!sourceAsset) throw new Error("Derived model does not match a catalog model asset")
    const directory = path.join(modelsRoot, entry.name),
      children = await readdir(directory, { withFileTypes: true })
    if (
      children.some(
        (child) =>
          !child.isFile() ||
          child.isSymbolicLink() ||
          !["asset.json", "preview.json", "model.bbmodel", "vanilla-resources.json"].includes(child.name),
      )
    )
      throw new Error("Derived model contains an unsafe or unsupported file")
    const assetJson = path.join(directory, "asset.json"),
      metadataInfo = await lstat(assetJson).catch((error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? undefined : Promise.reject(error),
      )
    if (!metadataInfo?.isFile() || metadataInfo.isSymbolicLink() || metadataInfo.size > 1024 * 1024)
      throw new Error("Derived model metadata is missing or unsafe; reopen the model to rebuild it")
    const metadata = z
      .strictObject({
        schemaVersion: z.literal(1),
        assetId: digest,
        sourceSha256: digest,
        sourceAssetSha256: digest,
        sourcePath: z.string().max(2048),
        format: z.string().max(128),
        dependencies: z.array(z.strictObject({ assetId: digest, sha256: digest })).max(10000),
        files: z.partialRecord(z.enum(["preview.json", "model.bbmodel", "vanilla-resources.json"]), digest),
        textureCandidateAssetIds: z.array(digest).max(10000),
        selectedTextureAssetId: digest.nullable(),
        diagnostics: z.array(z.unknown()).max(10000),
        vanillaDiagnostics: z
          .array(
            z.strictObject({
              code: z.string().max(128),
              version: z.string().max(64).nullable(),
              path: z.string().max(2048).optional(),
              message: z.string().max(4096),
            }),
          )
          .max(10000)
          .optional(),
        vanillaDependencies: z
          .strictObject({
            version: z.string().max(64),
            jarSha256: digest,
            classJarSha256: digest.optional(),
            selectionBasis: z.enum(["report_exact", "source_filename_within_reported_range"]).optional(),
            jarSource: z.enum(["libraries", "versions"]).optional(),
            entries: z
              .array(z.strictObject({ path: z.string().max(2048), sha256: digest, embedded: z.boolean() }))
              .max(10000),
          })
          .optional(),
      })
      .safeParse(JSON.parse(await readFile(assetJson, "utf8")))
    if (!metadata.success)
      throw new Error("Derived model metadata is outdated or invalid; reopen the model to rebuild it")
    const value = metadata.data
    if (
      value.assetId !== sourceAsset.id ||
      value.sourceSha256 !== catalog.sourceSha256 ||
      value.sourceAssetSha256 !== sourceAsset.sha256 ||
      value.sourcePath !== sourceAsset.sourcePath
    )
      throw new Error("Derived model source is stale; reopen the model to rebuild it")
    const dependencyIds = new Set<string>()
    if (
      value.dependencies.some((dependency) => {
        const catalogDependency = catalog.assets.find((asset) => asset.id === dependency.assetId)
        if (dependencyIds.has(dependency.assetId)) return true
        dependencyIds.add(dependency.assetId)
        return !catalogDependency || catalogDependency.sha256 !== dependency.sha256
      }) ||
      !dependencyIds.has(sourceAsset.id)
    )
      throw new Error("Derived model dependencies are stale; reopen the model to rebuild it")
    const textureIds = new Set(catalog.assets.filter((asset) => asset.kind === "texture").map((asset) => asset.id))
    if (
      value.textureCandidateAssetIds.some((assetId) => !textureIds.has(assetId)) ||
      (value.selectedTextureAssetId !== null &&
        (!textureIds.has(value.selectedTextureAssetId) ||
          !value.textureCandidateAssetIds.includes(value.selectedTextureAssetId) ||
          !dependencyIds.has(value.selectedTextureAssetId)))
    )
      throw new Error("Derived model texture references are stale; reopen the model to rebuild it")
    for (const filename of ["preview.json", "model.bbmodel"] as const) {
      const file = path.join(directory, filename),
        info = await lstat(file).catch((error: NodeJS.ErrnoException) =>
          error.code === "ENOENT" ? undefined : Promise.reject(error),
        ),
        expected = value.files[filename]
      if (!expected && info) throw new Error("Derived model file is not recorded in its metadata")
      if (expected && (!info?.isFile() || info.isSymbolicLink() || (await hashFile(file)) !== expected))
        throw new Error("Derived model file checksum mismatch")
    }
    const vanillaFile = path.join(directory, "vanilla-resources.json"),
      vanillaInfo = await lstat(vanillaFile).catch((error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? undefined : Promise.reject(error),
      ),
      vanillaExpected = value.files["vanilla-resources.json"]
    if (!vanillaExpected && vanillaInfo) throw new Error("Derived model file is not recorded in its metadata")
    if (
      vanillaExpected &&
      (!vanillaInfo?.isFile() || vanillaInfo.isSymbolicLink() || (await hashFile(vanillaFile)) !== vanillaExpected)
    )
      throw new Error("Derived vanilla resource bundle checksum mismatch")
    if (vanillaExpected) {
      const bundle = z
        .record(z.string().max(2048), z.strictObject({ sha256: digest, content: z.string().max(96 * 1024 * 1024) }))
        .parse(JSON.parse(await readFile(vanillaFile, "utf8")))
      for (const dependency of value.vanillaDependencies?.entries ?? []) {
        if (!dependency.embedded) continue
        const item = bundle[dependency.path]
        if (
          !item ||
          item.sha256 !== dependency.sha256 ||
          hash(Buffer.from(item.content, "base64")) !== dependency.sha256
        )
          throw new Error("Derived vanilla resource bundle does not match its provenance")
      }
    }
  }
}
