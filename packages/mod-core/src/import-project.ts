import { createHash, randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import path from "node:path"
import yauzl from "yauzl"
import { z } from "zod"
import { parse as parseToml } from "smol-toml"

export const IMPORT_LIMITS = {
  archiveBytes: 2 * 1024 * 1024 * 1024,
  expandedBytesRead: 256 * 1024 * 1024,
  entryBytesRead: 64 * 1024 * 1024,
  entries: 25_000,
  nestedJarBytes: 32 * 1024 * 1024,
  nestedJars: 256,
  metadataBytes: 1_000_000,
  evidenceEntries: 20_000,
} as const
const IMPORT_PROJECT_FILE_LIMITS = { manifestBytes: 64 * 1024, reportBytes: 64 * 1024 * 1024 } as const
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const ImportCountSchema = z.strictObject({
  count: z.number().int().nonnegative(),
  entries: z.array(z.string()),
  truncated: z.boolean(),
})
const ModDependencySchema = z.strictObject({
  id: z.string().max(256),
  version_range: z.string().max(512).nullable(),
  mandatory: z.boolean().nullable(),
})
const ImportModSchema = z.strictObject({
  id: z.string().max(256).nullable(),
  name: z.string().max(512).nullable(),
  version: z.string().max(256).nullable(),
  loader: z.enum(["fabric", "forge", "neoforge", "quilt", "unknown"]),
  minecraft: z.string().max(512).nullable(),
  dependencies: z.array(ModDependencySchema),
  source: z.string().max(512),
  evidence: z.array(z.string()).max(16),
})
export const ImportProjectReportSchema = z.strictObject({
  schema_version: z.literal(1),
  id: z.uuid(),
  source: z.strictObject({
    filename: z.string().max(240),
    sha256: digestSchema,
    bytes: z.number().int().nonnegative(),
  }),
  scanned_at: z.iso.datetime(),
  scan: z.strictObject({
    status: z.enum(["complete", "partial"]),
    archive_entries: z.number().int().nonnegative(),
    expanded_bytes_read: z.number().int().nonnegative(),
    nested_jars_scanned: z.number().int().nonnegative(),
    scope: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
  metadata: z.strictObject({
    loaders: z.array(z.enum(["forge", "neoforge", "fabric", "quilt"])),
    minecraft_versions: z.array(z.string()),
    loader_versions: z.array(
      z.strictObject({
        loader: z.enum(["forge", "neoforge", "fabric", "quilt"]),
        version: z.string(),
        evidence: z.string(),
      }),
    ),
    manifests: z.array(z.string()),
    dependency_status: z.enum(["unknown", "external_required", "satisfied_in_archive", "none_declared"]),
    dependencies_missing: z.boolean().nullable(),
    dependency_files: z.array(z.string()),
    included_files: z.array(z.string()),
  }),
  mods: z.array(ImportModSchema),
  categories: z.record(z.string(), ImportCountSchema),
})
export type ImportProjectReport = z.infer<typeof ImportProjectReportSchema>
export const ImportProjectManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  created_at: z.iso.datetime(),
  report_sha256: digestSchema,
  source: z.strictObject({
    filename: z.string().max(240),
    sha256: digestSchema,
    bytes: z.number().int().nonnegative(),
  }),
})
export type ImportProjectManifest = z.infer<typeof ImportProjectManifestSchema>
export class ImportProjectError extends Error {
  constructor(
    readonly code:
      | "UNSUPPORTED_INPUT"
      | "INPUT_LIMIT"
      | "UNSAFE_ARCHIVE"
      | "INVALID_ARCHIVE"
      | "PROJECT_CORRUPT"
      | "PROJECT_NOT_FOUND",
    message: string,
  ) {
    super(message)
    this.name = "ImportProjectError"
  }
}

const decoder = new TextDecoder("utf-8", { fatal: true })
const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const asString = (value: unknown) => (typeof value === "string" && value.length <= 512 ? value : null)
const abortCheck = (signal?: AbortSignal) => {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError")
}

function safeArchivePath(input: string) {
  const directory = input.endsWith("/")
  const name = (directory ? input.slice(0, -1) : input).normalize("NFC")
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
    throw new ImportProjectError("UNSAFE_ARCHIVE", `Unsafe archive path: ${input}`)
  return { name: name + (directory ? "/" : ""), key: name.toLowerCase() }
}

function openZip(filename: string) {
  return new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(
      filename,
      { lazyEntries: true, autoClose: true, strictFileNames: true, validateEntrySizes: true },
      (error, zip) => (error || !zip ? reject(error ?? new Error("Unable to open archive")) : resolve(zip)),
    ),
  )
}

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, maxBytes: number, signal?: AbortSignal) {
  if (maxBytes > IMPORT_LIMITS.entryBytesRead)
    return Promise.reject(new ImportProjectError("INPUT_LIMIT", "Requested archive entry read exceeds its limit"))
  abortCheck(signal)
  return new Promise<Uint8Array>((resolve, reject) => {
    let stream: Readable | undefined
    let settled = false
    const cleanup = () => signal?.removeEventListener("abort", abort)
    const finishError = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const abort = () => {
      const error = signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError")
      if (stream) stream.destroy(error)
      else finishError(error)
    }
    signal?.addEventListener("abort", abort, { once: true })
    zip.openReadStream(entry, (error, opened) => {
      if (error || !opened) {
        finishError(error ?? new Error("Unable to read archive entry"))
        return
      }
      stream = opened
      const openedStream = opened
      const chunks: Buffer[] = []
      let size = 0
      openedStream.on("data", (chunk: Buffer) => {
        size += chunk.length
        if (size > maxBytes) {
          openedStream.destroy(new Error("Archive entry actual data exceeds read limit"))
          return
        }
        chunks.push(chunk)
      })
      openedStream.once("error", finishError)
      openedStream.once("end", () => {
        if (settled) return
        settled = true
        cleanup()
        resolve(Buffer.concat(chunks))
      })
      if (signal?.aborted) abort()
    })
  })
}

function isMetadata(name: string) {
  const lower = name.toLowerCase()
  return [
    "fabric.mod.json",
    "meta-inf/mods.toml",
    "meta-inf/neoforge.mods.toml",
    "meta-inf/quilt.mod.json",
    "mcmod.info",
    "manifest.json",
    "modrinth.index.json",
  ].includes(lower)
}
function isNestedMod(name: string) {
  return /(^|\/)mods\/[^/]+\.jar$/i.test(name)
}

function category(name: string) {
  const p = name.toLowerCase().replace(/^(overrides|client-overrides|server-overrides)\//, "")
  if (/\.class$/.test(p)) return "bytecode"
  if (p.startsWith("assets/")) return "assets"
  if (p.startsWith("data/")) return "data"
  if (p.startsWith("kubejs/")) return "kubejs"
  if (/(^|\/)(ftbquests|quests|betterquesting)(\/|$)/.test(p)) return "quests"
  if (/^(tasks|taskdata)\//.test(p)) return "tasks"
  if (p.startsWith("defaultconfigs/")) return "defaultconfigs"
  if (p.startsWith("config/")) return "config"
  if (/^(resourcepacks|shaderpacks|datapacks)\//.test(p)) return "packs"
  if (/^resources?\//.test(p)) return "resources"
  if (/\.(jar|zip|mrpack)$/.test(p)) return "nested_archives"
  if (/\.(json|toml|cfg|properties|yml|yaml|js|zs|txt|md|mcmeta)$/.test(p)) return "configuration_and_scripts"
  return "other"
}

function parseMetadata(archive: Map<string, Uint8Array>, source: string) {
  const loaders = new Set<"fabric" | "forge" | "neoforge" | "quilt">(),
    versions = new Set<string>(),
    loaderVersions: { loader: "fabric" | "forge" | "neoforge" | "quilt"; version: string; evidence: string }[] = [],
    manifests: string[] = [],
    mods: ImportProjectReport["mods"] = [],
    warnings: string[] = []
  const parse = (filename: string, bytes: Uint8Array) => {
    if (bytes.byteLength > IMPORT_LIMITS.metadataBytes) {
      warnings.push(`元数据超过 1 MB，已跳过：${filename}`)
      return undefined
    }
    try {
      return filename.toLowerCase().endsWith(".toml")
        ? parseToml(decoder.decode(bytes))
        : (JSON.parse(decoder.decode(bytes)) as unknown)
    } catch {
      warnings.push(`无法解析元数据：${filename}`)
      return undefined
    }
  }
  const addMod = (
    loader: ImportProjectReport["mods"][number]["loader"],
    evidence: string,
    values: Record<string, unknown>,
    dependencies: ImportProjectReport["mods"][number]["dependencies"] = [],
    minecraft: string | null = asString(values.minecraft),
  ) => {
    const version = asString(values.version)
    if (loader !== "unknown") loaders.add(loader)
    const loaderDependency = dependencies.find(
      (dep) => dep.id === "fabricloader" || dep.id === "fabric-loader" || dep.id === "quilt_loader",
    )
    if (loaderDependency && loader !== "unknown")
      loaderVersions.push({ loader, version: loaderDependency.version_range ?? "unknown", evidence })
    mods.push({
      id: asString(values.id ?? values.modId),
      name: asString(values.name ?? values.displayName),
      version,
      loader,
      minecraft,
      dependencies,
      source,
      evidence: [evidence],
    })
  }
  archive.forEach((bytes, filename) => {
    const lower = filename.toLowerCase()
    if (
      [
        "fabric.mod.json",
        "meta-inf/mods.toml",
        "meta-inf/neoforge.mods.toml",
        "meta-inf/quilt.mod.json",
        "mcmod.info",
      ].includes(lower)
    ) {
      manifests.push(filename)
      const value = parse(filename, bytes)
      if (!value) return
      const root = asObject(value)
      if (lower.endsWith("fabric.mod.json")) {
        const depends = asObject(root.depends)
        const dependencies = Object.entries(depends).map(([id, target]) => ({
          id,
          version_range: typeof target === "string" ? target : asString(asObject(target).version),
          mandatory:
            typeof target === "string"
              ? true
              : typeof target === "object"
                ? asObject(target).optional === true
                  ? false
                  : true
                : null,
        }))
        addMod("fabric", filename, root, dependencies, asString(depends.minecraft))
      } else if (lower.endsWith("quilt.mod.json")) {
        const loader = asObject(root.quilt_loader),
          depends = asObject(loader.depends)
        const dependencies = Object.entries(depends).map(([id, target]) => ({
          id,
          version_range: asString(asObject(target).versions) ?? asString(target),
          mandatory: null,
        }))
        addMod(
          "quilt",
          filename,
          loader,
          dependencies,
          dependencies.find((dep) => dep.id === "minecraft")?.version_range ?? null,
        )
      } else if (lower.endsWith("mcmod.info"))
        (Array.isArray(value) ? value : [value]).forEach((item) => addMod("forge", filename, asObject(item)))
      else {
        const loader = lower.includes("neoforge") ? "neoforge" : "forge"
        const modList = Array.isArray(root.mods) ? root.mods : []
        const allDependencies = asObject(root.dependencies)
        const loaderVersion = asString(root.loaderVersion)
        if (loaderVersion) {
          loaders.add(loader)
          loaderVersions.push({ loader, version: loaderVersion, evidence: filename })
        }
        modList.forEach((item) => {
          const mod = asObject(item),
            rawDependencies = Array.isArray(allDependencies[String(mod.modId)])
              ? (allDependencies[String(mod.modId)] as unknown[])
              : [],
            dependencies = rawDependencies.map((dep: unknown) => ({
              id: asString(asObject(dep).modId) ?? "unknown",
              version_range: asString(asObject(dep).versionRange),
              mandatory: typeof asObject(dep).mandatory === "boolean" ? (asObject(dep).mandatory as boolean) : null,
            }))
          addMod(
            loader,
            filename,
            mod,
            dependencies,
            dependencies.find((dep) => dep.id === "minecraft")?.version_range ?? null,
          )
        })
      }
    }
    if (lower === "manifest.json" || lower === "modrinth.index.json") {
      manifests.push(filename)
      const root = asObject(parse(filename, bytes))
      if (lower === "manifest.json") {
        const minecraft = asString(asObject(root.minecraft).version)
        if (minecraft) versions.add(minecraft)
        const modloaders = Array.isArray(asObject(root.minecraft).modLoaders)
          ? (asObject(root.minecraft).modLoaders as unknown[])
          : []
        modloaders.forEach((value) => {
          const id = asString(asObject(value).id),
            loader = id?.split("-")[0]
          if (id && (loader === "forge" || loader === "neoforge" || loader === "fabric" || loader === "quilt")) {
            loaders.add(loader)
            loaderVersions.push({ loader, version: id.slice(loader.length + 1), evidence: filename })
          }
        })
      }
      if (lower === "modrinth.index.json")
        Object.entries(asObject(root.dependencies)).forEach(([key, value]) => {
          if (key.startsWith("minecraft") && typeof value === "string") versions.add(value)
          const loader =
            key === "fabric-loader"
              ? "fabric"
              : key === "forge"
                ? "forge"
                : key === "neoforge"
                  ? "neoforge"
                  : key === "quilt-loader"
                    ? "quilt"
                    : null
          if (loader && typeof value === "string") {
            loaders.add(loader)
            loaderVersions.push({ loader, version: value, evidence: filename })
          }
        })
    }
  })
  return {
    loaders: [...loaders],
    minecraft_versions: [...versions],
    loader_versions: loaderVersions,
    manifests,
    mods,
    warnings,
  }
}

function parseNestedJar(bytes: Uint8Array, name: string, readBudget: number, signal?: AbortSignal) {
  abortCheck(signal)
  return new Promise<{ metadata: ReturnType<typeof parseMetadata>; entries: number; readBytes: number }>(
    (resolve, reject) =>
      yauzl.fromBuffer(
        Buffer.from(bytes),
        { lazyEntries: true, autoClose: true, strictFileNames: true, validateEntrySizes: true },
        (error, zip) => {
          if (error || !zip) {
            reject(error ?? new Error("Unable to open nested jar"))
            return
          }
          const found = new Map<string, Uint8Array>(),
            seen = new Set<string>()
          let entries = 0,
            readBytes = 0
          const next = () => zip.readEntry()
          const cleanup = () => signal?.removeEventListener("abort", abort)
          const fail = (cause: unknown) => {
            cleanup()
            zip.close()
            reject(cause)
          }
          const abort = () => fail(signal?.reason ?? new DOMException("Aborted", "AbortError"))
          signal?.addEventListener("abort", abort, { once: true })
          zip.on("error", fail)
          zip.on("entry", (entry: yauzl.Entry) => {
            try {
              abortCheck(signal)
              const safe = safeArchivePath(entry.fileName),
                mode = entry.externalFileAttributes >>> 16
              if (seen.has(safe.key))
                throw new Error(`Duplicate case-insensitive nested archive path: ${entry.fileName}`)
              seen.add(safe.key)
              if ((mode & 0xf000) === 0xa000)
                throw new Error(`Symbolic links are not allowed: ${name}!/${entry.fileName}`)
              if (++entries > IMPORT_LIMITS.entries) throw new Error("Nested jar entry limit reached")
              if (!entry.fileName.endsWith("/") && isMetadata(entry.fileName)) {
                if (
                  entry.uncompressedSize > IMPORT_LIMITS.metadataBytes ||
                  readBytes + entry.uncompressedSize > readBudget
                ) {
                  next()
                  return
                }
                readEntry(zip, entry, IMPORT_LIMITS.metadataBytes, signal).then((data) => {
                  readBytes += data.byteLength
                  found.set(safe.name, data)
                  next()
                }, fail)
                return
              }
              next()
            } catch (cause) {
              fail(cause)
            }
          })
          zip.on("end", () => {
            cleanup()
            resolve({ metadata: parseMetadata(found, "included_nested_jar"), entries, readBytes })
          })
          next()
        },
      ),
  )
}

async function scanArchive(
  filename: string,
  displayName: string,
  fileHash: string,
  bytes: number,
  id: string,
  signal?: AbortSignal,
  onProgress?: (value: { phase: string; completed: number; total: number }) => void,
) {
  const zip = await openZip(filename),
    seen = new Set<string>(),
    categories: ImportProjectReport["categories"] = {},
    manifests = new Map<string, Uint8Array>(),
    nested: { name: string; bytes: Uint8Array }[] = [],
    bundledFiles: string[] = [],
    warnings: string[] = []
  let count = 0,
    expandedRead = 0
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanupAbort = () => signal?.removeEventListener("abort", abort)
      const abort = () => {
        cleanupAbort()
        zip.close()
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"))
      }
      signal?.addEventListener("abort", abort, { once: true })
      zip.on("error", (error) => {
        cleanupAbort()
        reject(error)
      })
      zip.on("entry", (entry: yauzl.Entry) => {
        Promise.resolve()
          .then(async () => {
            abortCheck(signal)
            const safe = safeArchivePath(entry.fileName),
              key = safe.key
            if (seen.has(key)) throw new Error(`Duplicate case-insensitive archive path: ${entry.fileName}`)
            seen.add(key)
            const mode = entry.externalFileAttributes >>> 16
            if ((mode & 0xf000) === 0xa000) throw new Error(`Symbolic links are not allowed: ${entry.fileName}`)
            count++
            if (count > IMPORT_LIMITS.entries) throw new Error("Archive entry count exceeds limit")
            if (entry.compressedSize === 0 && entry.uncompressedSize > 0)
              throw new Error(`Invalid empty compressed entry: ${entry.fileName}`)
            if (!entry.fileName.endsWith("/")) {
              const kind = category(safe.name),
                bucket = (categories[kind] ??= { count: 0, entries: [], truncated: false })
              bucket.count++
              if (bucket.entries.length < IMPORT_LIMITS.evidenceEntries) bucket.entries.push(safe.name)
              else bucket.truncated = true
              if (isNestedMod(safe.name)) {
                if (bundledFiles.length < IMPORT_LIMITS.evidenceEntries) bundledFiles.push(safe.name)
                if (
                  nested.length < IMPORT_LIMITS.nestedJars &&
                  entry.uncompressedSize <= IMPORT_LIMITS.nestedJarBytes &&
                  expandedRead + entry.uncompressedSize <= IMPORT_LIMITS.expandedBytesRead
                ) {
                  const data = await readEntry(zip, entry, IMPORT_LIMITS.nestedJarBytes, signal)
                  expandedRead += data.byteLength
                  nested.push({ name: safe.name, bytes: data })
                } else warnings.push(`嵌套模组包超过大小或数量限制，已跳过元数据：${safe.name}`)
              }
              if (
                /^(overrides|client-overrides|server-overrides)\//i.test(safe.name) &&
                bundledFiles.length < IMPORT_LIMITS.evidenceEntries
              )
                bundledFiles.push(safe.name)
              if (isMetadata(safe.name)) {
                if (
                  entry.uncompressedSize > IMPORT_LIMITS.metadataBytes ||
                  expandedRead + entry.uncompressedSize > IMPORT_LIMITS.expandedBytesRead
                ) {
                  warnings.push(`元数据读取达到限制，已跳过：${safe.name}`)
                  return
                }
                const data = await readEntry(zip, entry, IMPORT_LIMITS.metadataBytes, signal)
                expandedRead += data.byteLength
                manifests.set(safe.name, data)
              }
            }
            onProgress?.({ phase: "扫描归档", completed: count, total: zip.entryCount })
          })
          .then(
            () => zip.readEntry(),
            (error) => {
              cleanupAbort()
              reject(error)
            },
          )
      })
      zip.on("end", () => {
        cleanupAbort()
        resolve()
      })
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
  const parsed = parseMetadata(manifests, "archive"),
    dependencyFiles: string[] = [],
    mrDownloadPaths: string[] = []
  let downloadListPresent = false
  const cfEntry = [...manifests].find(([name]) => name.toLowerCase() === "manifest.json")
  if (cfEntry) {
    const root = asObject(JSON.parse(decoder.decode(cfEntry[1])))
    if (Array.isArray(root.files)) {
      downloadListPresent = true
      root.files.forEach((item) => {
        const record = asObject(item)
        if (typeof record.projectID === "number" && typeof record.fileID === "number")
          dependencyFiles.push(`CurseForge:${record.projectID}:${record.fileID}`)
      })
    }
  }
  const mrEntry = [...manifests].find(([name]) => name.toLowerCase() === "modrinth.index.json")
  if (mrEntry) {
    const root = asObject(JSON.parse(decoder.decode(mrEntry[1])))
    if (Array.isArray(root.files)) {
      downloadListPresent = true
      root.files.forEach((item) => {
        const record = asObject(item)
        if (typeof record.path === "string") {
          dependencyFiles.push(`Modrinth:${record.path}`)
          mrDownloadPaths.push(record.path)
        }
      })
    }
  }
  const mods = [...parsed.mods],
    nestedLoaders = new Set<"fabric" | "forge" | "neoforge" | "quilt">(),
    nestedCount = Math.min(nested.length, IMPORT_LIMITS.nestedJars)
  let modListTruncated = false
  for (const [index, item] of nested.entries()) {
    abortCheck(signal)
    const result = await parseNestedJar(item.bytes, item.name, IMPORT_LIMITS.expandedBytesRead - expandedRead, signal)
    expandedRead += result.readBytes
    warnings.push(...result.metadata.warnings)
    result.metadata.mods.forEach((mod) => {
      if (mod.loader !== "unknown") nestedLoaders.add(mod.loader)
    })
    mods.push(...result.metadata.mods.map((mod) => ({ ...mod, evidence: [`${item.name}!/${mod.evidence[0]}`] })))
    if (mods.length > 10_000) {
      mods.length = 10_000
      modListTruncated = true
      warnings.push("模组元数据列表已截断")
    }
    onProgress?.({ phase: "扫描嵌套模组包", completed: index + 1, total: nestedCount })
  }
  if (nested.length > IMPORT_LIMITS.nestedJars) warnings.push("嵌套模组包扫描达到数量限制")
  if (parsed.warnings.length) warnings.push(...parsed.warnings)
  const mrExternal = mrDownloadPaths.some(
    (name) =>
      ![...seen].some(
        (entry) =>
          entry === `overrides/${name}`.toLowerCase() ||
          entry === `client-overrides/${name}`.toLowerCase() ||
          entry === `server-overrides/${name}`.toLowerCase(),
      ),
  )
  const dependencyStatus =
    dependencyFiles.some((name) => name.startsWith("CurseForge:")) || mrExternal
      ? "external_required"
      : mrDownloadPaths.length
        ? "satisfied_in_archive"
        : downloadListPresent
          ? "none_declared"
          : "unknown"
  const minecraftVersions = parsed.minecraft_versions.length
    ? parsed.minecraft_versions
    : [...new Set(parsed.mods.flatMap((mod) => (mod.minecraft ? [mod.minecraft] : [])))]
  const loaders = parsed.loaders.length ? parsed.loaders : [...nestedLoaders]
  if (parsed.manifests.length === 0) warnings.push("未找到可识别的模组或整合包清单；加载器和 Minecraft 版本未知")
  if (modListTruncated) warnings.push("报告省略了额外的模组元数据")
  const report = ImportProjectReportSchema.parse({
    schema_version: 1,
    id,
    source: { filename: displayName, sha256: fileHash, bytes },
    scanned_at: new Date().toISOString(),
    scan: {
      status: warnings.length ? "partial" : "complete",
      archive_entries: count,
      expanded_bytes_read: expandedRead,
      nested_jars_scanned: nestedCount,
      scope: [
        "已扫描 ZIP 中央目录的全部路径并分类",
        "仅读取可识别的模组和整合包元数据；未解压普通文件",
        "仅检查嵌套 mods/*.jar 的元数据；未提取或执行其中的类和资源",
        "CurseForge 文件 ID 和 Modrinth 索引路径代表外部下载项；override 路径和嵌套模组包代表随包文件",
      ],
      warnings,
    },
    metadata: {
      loaders,
      minecraft_versions: minecraftVersions,
      loader_versions: parsed.loader_versions,
      manifests: parsed.manifests,
      dependency_status: dependencyStatus,
      dependencies_missing: dependencyStatus === "unknown" ? null : dependencyStatus === "external_required",
      dependency_files: dependencyFiles,
      included_files: [...new Set(bundledFiles)],
    },
    mods,
    categories,
  })
  return report
}

function safeFilename(input: string) {
  const filename = path
    .basename(input)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .slice(0, 200)
  if (!/\.(jar|zip|mrpack)$/i.test(filename))
    throw new ImportProjectError("UNSUPPORTED_INPUT", "Choose a .jar, .zip, or .mrpack archive")
  return filename
}
async function projectRoot(workspaceDirectory: string) {
  const root = await realpath(workspaceDirectory),
    base = path.join(root, "analysis-projects")
  await mkdir(base, { recursive: true })
  if ((await lstat(base)).isSymbolicLink()) throw new Error("Analysis project root may not be a symbolic link")
  return base
}

export async function importProject(input: {
  workspaceDirectory: string
  filename: string
  signal?: AbortSignal
  onProgress?: (value: { phase: string; completed: number; total: number }) => void
}) {
  abortCheck(input.signal)
  if (!path.isAbsolute(input.filename))
    throw new ImportProjectError("UNSUPPORTED_INPUT", "Choose an absolute local archive path")
  const filename = safeFilename(input.filename),
    source = await realpath(input.filename),
    info = await stat(source)
  if (!info.isFile() || info.size > IMPORT_LIMITS.archiveBytes)
    throw new ImportProjectError("INPUT_LIMIT", "Archive exceeds 2 GiB input size limit")
  const base = await projectRoot(input.workspaceDirectory),
    id = randomUUID(),
    staging = path.join(base, `.tmp-${id}`),
    directory = path.join(base, id)
  await mkdir(path.join(staging, "source"), { recursive: true })
  try {
    const storedSource = path.join(staging, "source", filename),
      digest = createHash("sha256")
    let copied = 0
    await pipeline(
      createReadStream(source),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          copied += chunk.length
          if (copied > IMPORT_LIMITS.archiveBytes) return callback(new Error("Archive exceeds 2 GiB input size limit"))
          digest.update(chunk)
          callback(null, chunk)
        },
      }),
      createWriteStream(storedSource, { flags: "wx", mode: 0o600 }),
      { signal: input.signal },
    )
    const report = await scanArchive(
      storedSource,
      filename,
      digest.digest("hex"),
      copied,
      id,
      input.signal,
      input.onProgress,
    )
    const manifest = ImportProjectManifestSchema.parse({
      schema_version: 1,
      id,
      name: path.parse(filename).name.slice(0, 120) || "Imported project",
      created_at: report.scanned_at,
      report_sha256: createHash("sha256").update(JSON.stringify(report)).digest("hex"),
      source: report.source,
    })
    await Promise.all(["runs", "logs", "temp"].map((name) => mkdir(path.join(staging, name), { recursive: true })))
    await writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    })
    await writeFile(path.join(staging, "report.json"), JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    })
    abortCheck(input.signal)
    await rename(staging, directory)
    return { directory, manifest, report }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    if (error instanceof ImportProjectError || input.signal?.aborted) throw error
    throw new ImportProjectError(
      "INVALID_ARCHIVE",
      error instanceof Error ? error.message : "Archive could not be scanned",
    )
  }
}

async function readImportProject(base: string, id: string) {
  const safeId = z.uuid().parse(id),
    directory = path.join(base, safeId),
    info = await lstat(directory).catch(() => undefined)
  if (!info || !info.isDirectory() || info.isSymbolicLink())
    throw new ImportProjectError("PROJECT_NOT_FOUND", "Analysis project was not found")
  const manifestFile = path.join(directory, "manifest.json"),
    reportFile = path.join(directory, "report.json"),
    sourceDirectory = path.join(directory, "source")
  const [manifestInfo, reportInfo, sourceDirectoryInfo] = await Promise.all([
    lstat(manifestFile),
    lstat(reportFile),
    lstat(sourceDirectory),
  ])
  if (
    !manifestInfo.isFile() ||
    manifestInfo.isSymbolicLink() ||
    !reportInfo.isFile() ||
    reportInfo.isSymbolicLink() ||
    !sourceDirectoryInfo.isDirectory() ||
    sourceDirectoryInfo.isSymbolicLink()
  )
    throw new ImportProjectError("PROJECT_CORRUPT", "Analysis project contains an unsafe or invalid file")
  if (
    manifestInfo.size > IMPORT_PROJECT_FILE_LIMITS.manifestBytes ||
    reportInfo.size > IMPORT_PROJECT_FILE_LIMITS.reportBytes
  )
    throw new ImportProjectError("PROJECT_CORRUPT", "Analysis project manifest or report exceeds its size limit")
  const manifest = ImportProjectManifestSchema.parse(JSON.parse(await readFile(manifestFile, "utf8"))),
    report = ImportProjectReportSchema.parse(JSON.parse(await readFile(reportFile, "utf8")))
  if (
    path.basename(manifest.source.filename) !== manifest.source.filename ||
    safeFilename(manifest.source.filename) !== manifest.source.filename
  )
    throw new ImportProjectError("PROJECT_CORRUPT", "Analysis project source filename is unsafe")
  if (
    manifest.id !== safeId ||
    report.id !== safeId ||
    manifest.source.sha256 !== report.source.sha256 ||
    manifest.source.filename !== report.source.filename ||
    manifest.source.bytes !== report.source.bytes ||
    manifest.report_sha256 !== createHash("sha256").update(JSON.stringify(report)).digest("hex")
  )
    throw new ImportProjectError("PROJECT_CORRUPT", "Analysis project manifest and report do not match")
  const archive = path.join(sourceDirectory, manifest.source.filename),
    archiveInfo = await lstat(archive)
  if (!archiveInfo.isFile() || archiveInfo.isSymbolicLink() || archiveInfo.size !== manifest.source.bytes)
    throw new ImportProjectError("PROJECT_CORRUPT", "Analysis source archive is missing or changed")
  return { directory, manifest, report }
}
export const ImportProjectIssueSchema = z.strictObject({ id: z.uuid(), name: z.string(), message: z.string() })
export type ImportProjectIssue = z.infer<typeof ImportProjectIssueSchema>
async function scanProjectDirectory(
  base: string,
  id: string,
): Promise<{ project?: Awaited<ReturnType<typeof readImportProject>>; issue?: ImportProjectIssue }> {
  try {
    return { project: await readImportProject(base, id) }
  } catch (error) {
    return {
      issue: ImportProjectIssueSchema.parse({
        id,
        name: id,
        message: error instanceof ImportProjectError ? error.message : "工程文件损坏或不可读取",
      }),
    }
  }
}
async function scanProjectDirectories(workspaceDirectory: string) {
  const base = await projectRoot(workspaceDirectory),
    folders = await readdir(base, { withFileTypes: true })
  return Promise.all(
    folders
      .filter((folder) => folder.isDirectory() && z.uuid().safeParse(folder.name).success)
      .map((folder) => scanProjectDirectory(base, folder.name)),
  )
}
export async function listImportProjects(workspaceDirectory: string) {
  return (await scanProjectDirectories(workspaceDirectory)).flatMap((result) =>
    result.project ? [result.project] : [],
  )
}
export async function listImportProjectIssues(workspaceDirectory: string) {
  return (await scanProjectDirectories(workspaceDirectory)).flatMap((result) => (result.issue ? [result.issue] : []))
}
export async function getImportProject(workspaceDirectory: string, id: string) {
  return readImportProject(await projectRoot(workspaceDirectory), id)
}
export async function deleteImportProject(workspaceDirectory: string, id: string) {
  const base = await projectRoot(workspaceDirectory),
    safeId = z.uuid().parse(id),
    directory = path.join(base, safeId),
    info = await lstat(directory)
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    path.dirname(await realpath(directory)) !== (await realpath(base))
  )
    throw new ImportProjectError("PROJECT_NOT_FOUND", "Analysis project was not found")
  await rm(directory, { recursive: true, force: false })
}
export async function clearImportCache(workspaceDirectory: string, id: string) {
  const project = await getImportProject(workspaceDirectory, id)
  const reverse = path.join(project.directory, "reverse")
  const reverseInfo = await lstat(reverse).catch((error: NodeJS.ErrnoException) =>
    error.code === "ENOENT" ? undefined : Promise.reject(error),
  )
  if (reverseInfo && (!reverseInfo.isDirectory() || reverseInfo.isSymbolicLink()))
    throw new ImportProjectError("UNSAFE_ARCHIVE", "Unsafe reverse project cache directory")
  const paths = [
    path.join(project.directory, ".cache"),
    path.join(project.directory, "temp"),
    ...(reverseInfo ? [path.join(reverse, ".cache")] : []),
  ]
  const infos = await Promise.all(paths.map((file) => lstat(file).catch(() => undefined)))
  infos.forEach((info, index) => {
    if (info?.isSymbolicLink())
      throw new ImportProjectError(
        "UNSAFE_ARCHIVE",
        `Import cache may not be a symbolic link: ${path.basename(paths[index]!)}`,
      )
  })
  await Promise.all(
    paths.map((file, index) => (infos[index] ? rm(file, { recursive: true, force: true }) : Promise.resolve())),
  )
  await mkdir(path.join(project.directory, "temp"), { recursive: true })
  return { cleared: infos.some(Boolean) }
}
export async function exportImportReport(input: { workspaceDirectory: string; id: string; destination: string }) {
  const { manifest, report } = await getImportProject(input.workspaceDirectory, input.id)
  if (!path.isAbsolute(input.destination) || !input.destination.toLowerCase().endsWith(".modscan"))
    throw new Error("Choose an absolute .modscan destination")
  const licenseEntries = Object.values(report.categories)
    .flatMap((category) => category.entries)
    .filter((name) => /(^|\/)(license|licence|copying|notice)(\.[^/]*)?$/i.test(name))
  const body =
    JSON.stringify(
      {
        format: "minemods-import-report",
        version: 1,
        manifest,
        report,
        dependencies_lock: {
          loaders: report.metadata.loaders,
          minecraft_versions: report.metadata.minecraft_versions,
          loader_versions: report.metadata.loader_versions,
          declared_downloads: report.metadata.dependency_files,
          bundled_files: report.metadata.included_files,
        },
        license_evidence: licenseEntries,
      },
      null,
      2,
    ) + "\n"
  const target = path.join(await realpath(path.dirname(input.destination)), path.basename(input.destination))
  await writeFile(target, body, { flag: "wx", mode: 0o600 })
  return { path: target, sha256: createHash("sha256").update(body).digest("hex") }
}
