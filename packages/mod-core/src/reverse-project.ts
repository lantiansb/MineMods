import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import yauzl from "yauzl"
import { z } from "zod"
import { getImportProject, importProject } from "./import-project"
import { exportModifiedImport, getImportContext } from "./import-edit"
import { inspectJavaClass } from "./class-inspect"
import { ReverseDependencyFileSchema, prepareReverseDependencies } from "./reverse-dependencies"
import { compileReverseSources, decompileArchive, prepareReverseTools } from "./reverse-tools"
import {
  assertNoReverseSymlink,
  createReverseArchiveFromDirectory,
  extractReverseArchive,
  listReverseArchiveEntries,
  listReverseFilesOnDisk,
  readReverseArchivePrefix,
  reverseFilePath,
  rewriteReverseArchive,
  safeReversePath,
} from "./reverse-archive"

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const originalHashCache = new Map<string, { statKey: string; sha256: string }>()
const reverseIdSchema = z.uuid()
const dependencySchema = z.strictObject({
  id: z.string().max(512),
  version: z.string().max(512).nullable(),
  evidence: z.string().max(1024),
})
const placementSchema = z.strictObject({
  archivePath: z.string().max(2048),
  parentModuleId: digestSchema.nullable(),
  internalPath: z.string().max(1024).nullable(),
})
const moduleBuildSchema = z.strictObject({
  status: z.enum(["not_built", "success", "failed"]),
  attemptedAt: z.iso.datetime().nullable(),
  sourceSha256: digestSchema.nullable(),
  resourceSha256: digestSchema.nullable(),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  stdout: z.string().max(1_100_000),
  stderr: z.string().max(1_100_000),
  diagnostics: z.array(z.string().max(4096)).max(10_000),
  outputJarPath: z.string().max(2048).nullable(),
})
const reverseModuleSchema = z.strictObject({
  id: digestSchema,
  name: z.string().max(512),
  archivePath: z.string().max(2048),
  archivePaths: z.array(z.string().max(2048)).max(100_000),
  placements: z.array(placementSchema).max(100_000),
  originalJarPath: z.string().max(2048),
  sourceRoot: z.string().max(2048),
  resourceRoot: z.string().max(2048),
  status: z.enum(["decompiled", "decompile_failed", "empty"]),
  sourceCount: z.number().int().nonnegative(),
  classCount: z.number().int().nonnegative(),
  decompiledSourceSha256: digestSchema,
  decompiledSourceFiles: z.array(z.string().max(2048)).max(100_000).optional(),
  decompiledResourceSha256: digestSchema,
  loaderHints: z.array(z.string().max(1024)).max(10_000),
  dependencies: z.array(dependencySchema).max(10_000),
  decompile: z.strictObject({
    exitCode: z.number().int().nullable(),
    timedOut: z.boolean(),
    stdout: z.string().max(1_100_000),
    stderr: z.string().max(1_100_000),
    warning: z.string().max(4096).nullable(),
  }),
  build: moduleBuildSchema,
  dependencyFiles: z.array(ReverseDependencyFileSchema).max(512).default([]),
})
export const ReverseProjectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: reverseIdSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  source: z.strictObject({ filename: z.string().max(240), sha256: digestSchema, size: z.number().int().nonnegative() }),
  archiveResourceSha256: digestSchema,
  status: z.enum(["complete", "partial"]),
  modules: z.array(reverseModuleSchema).max(10_000),
  loaderHints: z.array(z.string().max(1024)).max(10_000),
  dependencies: z.array(dependencySchema).max(10_000),
  warnings: z.array(z.string().max(4096)).max(10_000),
  baseImportRevisionId: z.string().max(256).nullable().optional(),
})
export type ReverseProject = z.infer<typeof ReverseProjectSchema>
export type ReverseModule = z.infer<typeof reverseModuleSchema>
export const ReverseChangeSchema = z
  .strictObject({
    path: z.string().min(1).max(2048),
    operation: z.enum(["write", "delete"]),
    expectedSha256: digestSchema.nullable(),
    encoding: z.enum(["utf8", "base64"]),
    content: z
      .string()
      .max(24 * 1024 * 1024)
      .nullable(),
  })
  .superRefine((change, context) => {
    if ((change.operation === "write") !== (change.content !== null))
      context.addIssue({ code: "custom", message: "write requires content; delete requires null content" })
  })
export type ReverseChange = z.infer<typeof ReverseChangeSchema>
export const REVERSE_LIMITS = { listedFiles: 10_000, readBytes: 4 * 1024 ** 2, changeBytes: 16 * 1024 ** 2 } as const

const rootOf = (directory: string, id: string) =>
  path.join(directory, "analysis-projects", reverseIdSchema.parse(id), "reverse")
const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError")
}
async function hashFile(filename: string) {
  const digest = createHash("sha256")
  for await (const chunk of createReadStream(filename)) digest.update(chunk)
  return digest.digest("hex")
}
async function hashDirectory(directory: string, extension?: string) {
  const entries = await listReverseFilesOnDisk(directory),
    digest = createHash("sha256")
  for (const entry of entries.filter((file) => !extension || path.extname(file.path).toLowerCase() === extension)) {
    digest
      .update(entry.path)
      .update("\0")
      .update(await hashFile(reverseFilePath(directory, entry.path)))
      .update("\n")
  }
  return digest.digest("hex")
}
async function hashArchiveResources(directory: string) {
  const entries = await listReverseFilesOnDisk(directory),
    digest = createHash("sha256")
  for (const entry of entries.filter((file) => !/\.(?:jar|zip|mrpack|class)$/i.test(file.path)))
    digest
      .update(entry.path)
      .update("\0")
      .update(await hashFile(reverseFilePath(directory, entry.path)))
      .update("\n")
  return digest.digest("hex")
}
async function projectStorage(workspaceDirectory: string, id: string) {
  const imported = await getImportProject(workspaceDirectory, id),
    root = rootOf(workspaceDirectory, id),
    info = await lstat(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
  if (info && (!info.isDirectory() || info.isSymbolicLink()))
    throw new Error("Reverse project directory is not a safe directory")
  return { imported, root, exists: Boolean(info) }
}
function emptyBuild(): ReverseModule["build"] {
  return {
    status: "not_built",
    attemptedAt: null,
    sourceSha256: null,
    resourceSha256: null,
    exitCode: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    diagnostics: [],
    outputJarPath: null,
  }
}
function digestFromOutput(output: string) {
  return output.length > 1_000_000 ? `${output.slice(0, 1_000_000)}\n[truncated]` : output
}
function isClass(name: string) {
  return name.toLowerCase().endsWith(".class")
}
function isJar(name: string) {
  return name.toLowerCase().endsWith(".jar")
}
function safeChild(root: string, relative: string) {
  return reverseFilePath(root, relative)
}

async function findJars(directory: string) {
  return (await listReverseFilesOnDisk(directory)).filter((entry) => isJar(entry.path)).map((entry) => entry.path)
}
async function inspectModuleMetadata(resourceRoot: string) {
  const loaderHints = new Set<string>(),
    dependencies: ReverseModule["dependencies"] = []
  for (const file of await listReverseFilesOnDisk(resourceRoot)) {
    const lower = file.path.toLowerCase()
    if (
      !(
        lower.endsWith("mods.toml") ||
        lower.endsWith("fabric.mod.json") ||
        lower.endsWith("quilt.mod.json") ||
        lower.endsWith("modrinth.index.json") ||
        lower.endsWith("manifest.json") ||
        lower.endsWith("mcmod.info")
      )
    )
      continue
    if (file.size > 1_000_000) {
      loaderHints.add(`metadata-too-large:${file.path}`)
      continue
    }
    const text = await readFile(safeChild(resourceRoot, file.path), "utf8")
    if (lower.endsWith("mods.toml")) {
      for (const match of text.matchAll(
        /\b(modLoader|loaderVersion|modId|version|displayName)\s*=\s*["']([^"']+)["']/gi,
      ))
        loaderHints.add(`${match[1]}=${match[2]}@${file.path}`)
      for (const match of text.matchAll(
        /\bmodId\s*=\s*["']([^"']+)["'][\s\S]{0,512}?\bversionRange\s*=\s*["']([^"']+)["']/gi,
      ))
        dependencies.push({ id: match[1]!, version: match[2]!, evidence: file.path })
      continue
    }
    let root: Record<string, unknown>
    try {
      root = JSON.parse(text) as Record<string, unknown>
    } catch {
      loaderHints.add(`unparsed:${file.path}`)
      continue
    }
    if (lower.endsWith("fabric.mod.json")) {
      loaderHints.add(`loader:fabric@${file.path}`)
      if (typeof root.id === "string") loaderHints.add(`modId=${root.id}@${file.path}`)
      if (typeof root.version === "string") loaderHints.add(`modVersion=${root.version}@${file.path}`)
      for (const [id, version] of Object.entries(
        (root.depends && typeof root.depends === "object" ? root.depends : {}) as Record<string, unknown>,
      ))
        dependencies.push({ id, version: typeof version === "string" ? version : null, evidence: file.path })
      continue
    }
    if (lower.endsWith("quilt.mod.json")) loaderHints.add(`loader:quilt@${file.path}`)
    if (lower.endsWith("mods.toml")) loaderHints.add(`loader:${String(root.modLoader ?? "unknown")}@${file.path}`)
    if (lower.endsWith("modrinth.index.json")) {
      const deps =
        root.dependencies && typeof root.dependencies === "object" ? (root.dependencies as Record<string, unknown>) : {}
      for (const [id, version] of Object.entries(deps))
        dependencies.push({ id, version: typeof version === "string" ? version : null, evidence: file.path })
      for (const id of Object.keys(deps))
        if (/loader|forge|neoforge|fabric|quilt/i.test(id)) loaderHints.add(`loader:${id}`)
    }
  }
  return { loaderHints: [...loaderHints], dependencies }
}

async function parseArchiveHints(directory: string) {
  return inspectModuleMetadata(directory)
}

function zipOpen(filename: string) {
  return new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(
      filename,
      { lazyEntries: true, autoClose: true, strictFileNames: true, validateEntrySizes: true },
      (error, zip) => (error || !zip ? reject(error ?? new Error("Unable to inspect archive")) : resolve(zip)),
    ),
  )
}
async function copyWithHash(source: string, destination: string) {
  await mkdir(path.dirname(destination), { recursive: true })
  await copyFile(source, destination)
  return hashFile(destination)
}
async function fileCount(directory: string, extension: string) {
  return (await listReverseFilesOnDisk(directory)).filter((file) => path.extname(file.path).toLowerCase() === extension)
    .length
}

async function classSourceFiles(
  filename: string,
  entries: { path: string; directory: boolean; size: number }[],
  excluded: Set<string> = new Set(),
) {
  const wanted = new Set(
      entries
        .filter(
          (entry) =>
            !entry.directory && isClass(entry.path) && entry.size <= 8 * 1024 * 1024 && !excluded.has(entry.path),
        )
        .map((entry) => entry.path),
    ),
    sources = new Map<string, string>()
  if (!wanted.size) return sources
  const zip = await zipOpen(filename)
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject)
    zip.on("end", resolve)
    zip.on("entry", (entry) => {
      if (!wanted.has(entry.fileName)) {
        zip.readEntry()
        return
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          reject(error ?? new Error("Unable to inspect class source attributes"))
          return
        }
        const chunks: Buffer[] = []
        let bytes = 0,
          oversized = false
        stream.on("data", (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > 8 * 1024 * 1024) {
            oversized = true
            chunks.length = 0
            return
          }
          chunks.push(chunk)
        })
        stream.once("error", reject)
        stream.once("end", () => {
          if (!oversized)
            try {
              const source = inspectJavaClass(Buffer.concat(chunks)).content,
                sourceFile = (JSON.parse(source) as { source_file: unknown }).source_file
              if (typeof sourceFile === "string" && sourceFile.toLowerCase().endsWith(".java"))
                sources.set(entry.fileName, sourceFile)
            } catch {}
          zip.readEntry()
        })
      })
    })
    zip.readEntry()
  }).catch((error) => {
    zip.close()
    throw error
  })
  return sources
}
function sourcePathForClass(classPath: string, sourceFile: string | undefined) {
  if (!sourceFile) return undefined
  try {
    safeReversePath(sourceFile)
  } catch {
    return undefined
  }
  if (sourceFile.includes("/")) return undefined
  const directory = path.posix.dirname(classPath)
  return directory === "." ? sourceFile : `${directory}/${sourceFile}`
}
function withoutResolvedDecompileWarnings(warnings: string[], modules: ReverseModule[]) {
  return warnings.filter(
    (warning) =>
      !(
        warning.startsWith("Decompiler unavailable:") && modules.every((module) => module.status !== "decompile_failed")
      ) &&
      !modules.some(
        (module) => module.status !== "decompile_failed" && warning.startsWith(`${module.archivePath}: Decompiler`),
      ),
  )
}

async function moduleClassVersion(relativeJar: string, root: string) {
  const jar = reverseFilePath(root, relativeJar),
    entries = await listReverseArchiveEntries(jar)
  const firstClass = entries.find((entry) => !entry.directory && isClass(entry.path))
  if (!firstClass) throw new Error("Cannot infer Java release from a module without class files")
  const header = await readReverseArchivePrefix(jar, firstClass.path, 8)
  if (header.length < 8 || header.readUInt32BE(0) !== 0xcafebabe)
    throw new Error(`Invalid class header: ${firstClass.path}`)
  return header.readUInt16BE(6)
}

async function prepareReverseProjectInner(input: {
  workspaceDirectory: string
  id: string
  runtimeDirectory: string
  javaHome?: string
  signal?: AbortSignal
  onLog?: (text: string) => void
}) {
  const { imported, root, exists } = await projectStorage(input.workspaceDirectory, input.id)
  if (exists) {
    let project = await readReverseProject(input.workspaceDirectory, input.id, true)
    const currentImportRevisionId =
      (await getImportContext({ workspaceDirectory: input.workspaceDirectory, id: input.id })).revisionId ?? null
    const revisionWarning =
      currentImportRevisionId && project.baseImportRevisionId !== currentImportRevisionId
        ? `A newer import text revision (${currentImportRevisionId}) exists; this reverse snapshot is based on ${project.baseImportRevisionId ?? "the original archive"}. Prepare a new reverse project to include it.`
        : null
    const failed = project.modules.filter((module) => module.status === "decompile_failed")
    if (!failed.length) {
      const warnings = [
        ...withoutResolvedDecompileWarnings(project.warnings, project.modules),
        ...(revisionWarning && !project.warnings.includes(revisionWarning) ? [revisionWarning] : []),
      ]
      if (
        warnings.length === project.warnings.length &&
        warnings.every((warning, index) => warning === project.warnings[index])
      )
        return { project, created: false }
      project = ReverseProjectSchema.parse({ ...project, updatedAt: new Date().toISOString(), warnings })
      await writeManifest(root, project)
      return { project, created: false }
    }
    const tools = await prepareReverseTools({
      runtimeDirectory: input.runtimeDirectory,
      ...(input.javaHome ? { javaHome: input.javaHome } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      onLog: input.onLog,
    })
    const retried: ReverseModule[] = []
    for (const module of failed) {
      const retriedModule = await (async () => {
        const sourceRoot = reverseFilePath(root, module.sourceRoot)
        if ((await hashDirectory(sourceRoot, ".java")) !== module.decompiledSourceSha256)
          throw new Error(`Refusing to overwrite edited sources while retrying decompilation: ${module.archivePath}`)
        const temporary = path.join(root, `.retry-${randomUUID()}`),
          jar = reverseFilePath(root, module.originalJarPath)
        await mkdir(temporary, { recursive: true })
        try {
          const decompile = await decompileArchive({
            jar,
            outputDirectory: temporary,
            tools,
            ...(input.signal ? { signal: input.signal } : {}),
            onLog: input.onLog,
          })
          const sourceCount = await fileCount(temporary, ".java"),
            status =
              decompile.exitCode === 0 && !decompile.timedOut && sourceCount
                ? ("decompiled" as const)
                : ("decompile_failed" as const)
          if (status === "decompiled") {
            await rm(sourceRoot, { recursive: true, force: true })
            await rename(temporary, sourceRoot)
          }
          await writeFile(path.join(root, "logs", `${module.id}.decompile.stdout.txt`), decompile.stdout, {
            mode: 0o600,
          })
          await writeFile(path.join(root, "logs", `${module.id}.decompile.stderr.txt`), decompile.stderr, {
            mode: 0o600,
          })
          return {
            ...module,
            status,
            sourceCount: status === "decompiled" ? sourceCount : module.sourceCount,
            ...(status === "decompiled"
              ? {
                  decompiledSourceFiles: (await listReverseFilesOnDisk(sourceRoot))
                    .filter((file) => file.path.toLowerCase().endsWith(".java"))
                    .map((file) => file.path),
                }
              : {}),
            decompiledSourceSha256:
              status === "decompiled" ? await hashDirectory(sourceRoot, ".java") : module.decompiledSourceSha256,
            decompile: {
              exitCode: decompile.exitCode,
              timedOut: decompile.timedOut,
              stdout: digestFromOutput(decompile.stdout),
              stderr: digestFromOutput(decompile.stderr),
              warning:
                status === "decompile_failed"
                  ? decompile.timedOut
                    ? "Decompiler timed out"
                    : `Decompiler exited with ${decompile.exitCode}`
                  : null,
            },
          }
        } finally {
          await rm(temporary, { recursive: true, force: true })
        }
      })()
      retried.push(retriedModule)
      const updatedModules = project.modules.map((item) => (item.id === module.id ? retriedModule : item)),
        warnings = [
          ...withoutResolvedDecompileWarnings(project.warnings, updatedModules),
          ...(revisionWarning && !project.warnings.includes(revisionWarning) ? [revisionWarning] : []),
        ]
      project = ReverseProjectSchema.parse({
        ...project,
        updatedAt: new Date().toISOString(),
        status:
          warnings.length || updatedModules.some((item) => item.status === "decompile_failed") ? "partial" : "complete",
        modules: updatedModules,
        warnings,
      })
      await writeManifest(root, project)
    }
    const updatedModules = project.modules.map((module) => retried.find((item) => item.id === module.id) ?? module),
      warnings = [
        ...withoutResolvedDecompileWarnings(project.warnings, updatedModules),
        ...(revisionWarning && !project.warnings.includes(revisionWarning) ? [revisionWarning] : []),
      ]
    project = ReverseProjectSchema.parse({
      ...project,
      updatedAt: new Date().toISOString(),
      status:
        warnings.length || updatedModules.some((module) => module.status === "decompile_failed")
          ? "partial"
          : "complete",
      modules: updatedModules,
      warnings,
    })
    await writeManifest(root, project)
    return { project, created: false }
  }
  const parent = imported.directory,
    staging = path.join(parent, `.reverse-${randomUUID()}.tmp`),
    originalDirectory = path.join(staging, "original"),
    archiveDirectory = path.join(staging, "archive"),
    moduleDirectory = path.join(staging, "modules"),
    logsDirectory = path.join(staging, "logs"),
    warnings: string[] = []
  await mkdir(originalDirectory, { recursive: true })
  await Promise.all([
    mkdir(archiveDirectory),
    mkdir(moduleDirectory),
    mkdir(logsDirectory),
    mkdir(path.join(staging, ".cache")),
  ])
  const sourcePath = path.join(parent, "source", imported.manifest.source.filename),
    originalPath = path.join(originalDirectory, imported.manifest.source.filename)
  let effectivePath: string | undefined
  try {
    checkAbort(input.signal)
    const sourceHash = await copyWithHash(sourcePath, originalPath)
    if (sourceHash !== imported.manifest.source.sha256)
      throw new Error("Imported source archive hash changed before reverse preparation")
    const importContext = await getImportContext({ workspaceDirectory: input.workspaceDirectory, id: input.id }),
      baseImportRevisionId = importContext.revisionId ?? undefined,
      tempId = randomUUID()
    effectivePath = baseImportRevisionId
      ? path.join(
          imported.directory,
          "temp",
          `reverse-effective-${tempId}`,
          `effective${path.extname(imported.manifest.source.filename)}`,
        )
      : originalPath
    if (baseImportRevisionId)
      await exportModifiedImport({
        workspaceDirectory: input.workspaceDirectory,
        id: input.id,
        revisionId: baseImportRevisionId,
        destination: effectivePath,
        kind: "archive",
        internalTemporary: true,
      })
    const topExtraction = await extractReverseArchive(effectivePath, archiveDirectory, { signal: input.signal })
    let tools: Awaited<ReturnType<typeof prepareReverseTools>> | null | undefined,
      toolsAttempted = false,
      toolWarning: string | undefined
    const getTools = async () => {
      if (toolsAttempted) return tools ?? null
      toolsAttempted = true
      try {
        tools = await prepareReverseTools({
          runtimeDirectory: input.runtimeDirectory,
          ...(input.javaHome ? { javaHome: input.javaHome } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
          onLog: input.onLog,
        })
      } catch (error) {
        if (input.signal?.aborted) throw error
        toolWarning = `Decompiler unavailable: ${error instanceof Error ? error.message : String(error)}`
        warnings.push(toolWarning)
        input.onLog?.(toolWarning)
      }
      return tools ?? null
    }
    const modules = new Map<string, ReverseModule>(),
      processedArchivePaths = new Set<string>()
    let expandedBytes = topExtraction.expandedBytes
    const extractModule = async (
      jarPath: string,
      archivePath: string,
      parentModuleId: string | null,
      internalPath: string | null,
      depth: number,
    ): Promise<string> => {
      checkAbort(input.signal)
      if (depth > 16) {
        warnings.push(`Nested JAR depth limit reached at ${archivePath}`)
        return ""
      }
      const safeArchivePath = archivePath
      if (processedArchivePaths.has(safeArchivePath)) return ""
      processedArchivePaths.add(safeArchivePath)
      const id = await hashFile(jarPath),
        existing = modules.get(id),
        placement = { archivePath, parentModuleId, internalPath }
      if (existing) {
        if (!existing.archivePaths.includes(archivePath)) existing.archivePaths.push(archivePath)
        existing.placements.push(placement)
        return id
      }
      const name = path.basename(jarPath),
        base = `modules/${id}`,
        originalJarPath = `${base}/original.jar`,
        sourceRoot = `${base}/src`,
        resourceRoot = `${base}/resources`,
        moduleRoot = path.join(staging, ...base.split("/"))
      input.onLog?.(`发现模块 ${modules.size + 1}：${archivePath}`)
      await Promise.all([
        mkdir(path.join(moduleRoot, "src"), { recursive: true }),
        mkdir(path.join(moduleRoot, "resources"), { recursive: true }),
        mkdir(path.join(moduleRoot, "build"), { recursive: true }),
      ])
      const savedJar = path.join(staging, ...originalJarPath.split("/"))
      await copyFile(jarPath, savedJar)
      const archiveEntries = await listReverseArchiveEntries(savedJar),
        classCount = archiveEntries.filter((entry) => !entry.directory && isClass(entry.path)).length
      const extraction = await extractReverseArchive(savedJar, path.join(staging, ...resourceRoot.split("/")), {
        signal: input.signal,
        maxExpandedBytes: Math.max(1, 16 * 1024 ** 3 - expandedBytes),
        include: (entryPath) => !isClass(entryPath),
      })
      expandedBytes += extraction.expandedBytes
      const availableTools = classCount ? await getTools() : null
      const decompile =
        classCount && availableTools
          ? await decompileArchive({
              jar: savedJar,
              outputDirectory: path.join(staging, ...sourceRoot.split("/")),
              tools: availableTools,
              ...(input.signal ? { signal: input.signal } : {}),
              onLog: input.onLog,
            })
          : {
              exitCode: classCount ? null : 0,
              stdout: "",
              stderr: classCount ? (toolWarning ?? "Decompiler unavailable") : "",
              timedOut: false,
            }
      await writeFile(path.join(staging, "logs", `${id}.decompile.stdout.txt`), decompile.stdout, { mode: 0o600 })
      await writeFile(path.join(staging, "logs", `${id}.decompile.stderr.txt`), decompile.stderr, { mode: 0o600 })
      const metadata = await inspectModuleMetadata(path.join(staging, ...resourceRoot.split("/"))),
        sourceCount = await fileCount(path.join(staging, ...sourceRoot.split("/")), ".java")
      const status =
        classCount === 0
          ? "empty"
          : decompile.exitCode === 0 && !decompile.timedOut
            ? sourceCount
              ? "decompiled"
              : "empty"
            : "decompile_failed"
      const warning =
        status === "decompile_failed"
          ? (toolWarning ??
            (decompile.timedOut ? "Decompiler timed out" : `Decompiler exited with ${decompile.exitCode}`))
          : null
      const module = reverseModuleSchema.parse({
        id,
        name,
        archivePath,
        archivePaths: [archivePath],
        placements: [placement],
        originalJarPath,
        sourceRoot,
        resourceRoot,
        status,
        sourceCount,
        classCount,
        ...(status === "decompiled"
          ? {
              decompiledSourceFiles: (await listReverseFilesOnDisk(path.join(staging, ...sourceRoot.split("/"))))
                .filter((file) => file.path.toLowerCase().endsWith(".java"))
                .map((file) => file.path),
            }
          : {}),
        decompiledSourceSha256: await hashDirectory(path.join(staging, ...sourceRoot.split("/")), ".java"),
        decompiledResourceSha256: await hashDirectory(path.join(staging, ...resourceRoot.split("/"))),
        loaderHints: metadata.loaderHints,
        dependencies: metadata.dependencies,
        decompile: {
          exitCode: decompile.exitCode,
          timedOut: decompile.timedOut,
          stdout: digestFromOutput(decompile.stdout),
          stderr: digestFromOutput(decompile.stderr),
          warning,
        },
        build: emptyBuild(),
      })
      modules.set(id, module)
      if (warning) warnings.push(`${archivePath}: ${warning}`)
      const nested = await findJars(path.join(staging, ...resourceRoot.split("/")))
      for (const childPath of nested) {
        const childArchivePath = `${archivePath}!/${childPath}`
        await extractModule(
          path.join(staging, ...resourceRoot.split("/"), ...childPath.split("/")),
          childArchivePath,
          id,
          childPath,
          depth + 1,
        )
      }
      return id
    }
    const sourceIsJar = path.extname(imported.manifest.source.filename).toLowerCase() === ".jar"
    if (sourceIsJar) await extractModule(effectivePath, imported.manifest.source.filename, null, null, 0)
    if (!sourceIsJar)
      for (const jar of await findJars(archiveDirectory))
        await extractModule(path.join(archiveDirectory, ...jar.split("/")), jar, null, null, 0)
    const rootMetadata = await parseArchiveHints(archiveDirectory),
      project = ReverseProjectSchema.parse({
        schemaVersion: 1,
        id: input.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: {
          filename: imported.manifest.source.filename,
          sha256: imported.manifest.source.sha256,
          size: imported.manifest.source.bytes,
        },
        archiveResourceSha256: await hashArchiveResources(archiveDirectory),
        status: warnings.length ? "partial" : "complete",
        modules: [...modules.values()].sort((a, b) => a.archivePath.localeCompare(b.archivePath)),
        loaderHints: rootMetadata.loaderHints,
        dependencies: rootMetadata.dependencies,
        warnings,
        baseImportRevisionId: baseImportRevisionId ?? null,
      })
    await writeFile(path.join(staging, "manifest.json"), JSON.stringify(project, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    })
    checkAbort(input.signal)
    await rename(staging, root)
    return { project, created: true }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  } finally {
    if (effectivePath && effectivePath !== originalPath)
      await rm(path.dirname(effectivePath), { recursive: true, force: true })
  }
}

async function readReverseProject(workspaceDirectory: string, id: string, strong = false): Promise<ReverseProject> {
  const { imported, root, exists } = await projectStorage(workspaceDirectory, id)
  if (!exists) throw new Error("Reverse project not found")
  const info = await lstat(path.join(root, "manifest.json"))
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024)
    throw new Error("Reverse manifest is unsafe or too large")
  const project = ReverseProjectSchema.parse(JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")))
  const moduleIds = new Set<string>()
  for (const module of project.modules) {
    if (
      moduleIds.has(module.id) ||
      module.sourceRoot !== `modules/${module.id}/src` ||
      module.resourceRoot !== `modules/${module.id}/resources` ||
      module.originalJarPath !== `modules/${module.id}/original.jar`
    )
      throw new Error("Reverse manifest contains unsafe or overlapping module paths")
    moduleIds.add(module.id)
    if (
      (module.build.status === "success" &&
        module.build.outputJarPath !== `modules/${module.id}/build/current/module.jar`) ||
      (module.build.status !== "success" && module.build.outputJarPath !== null)
    )
      throw new Error("Reverse manifest contains an invalid module build output path")
    for (const placement of module.placements)
      if (placement.internalPath !== null) safeReversePath(placement.internalPath)
    for (const value of [
      module.archivePath,
      ...module.archivePaths,
      ...module.placements.map((placement) => placement.archivePath),
    ])
      if (
        !value.split("!/").every((part) => {
          try {
            safeReversePath(part)
            return true
          } catch {
            return false
          }
        })
      )
        throw new Error("Reverse manifest contains an unsafe archive path")
  }
  const children = new Map<string, string[]>()
  for (const module of project.modules)
    for (const placement of module.placements) {
      if (placement.parentModuleId === null) continue
      if (!moduleIds.has(placement.parentModuleId))
        throw new Error("Reverse manifest placement references a missing parent module")
      children.set(placement.parentModuleId, [...(children.get(placement.parentModuleId) ?? []), module.id])
    }
  const visiting = new Set<string>(),
    visited = new Set<string>()
  const visit = (moduleId: string) => {
    if (visiting.has(moduleId)) throw new Error("Reverse manifest module placements contain a cycle")
    if (visited.has(moduleId)) return
    visiting.add(moduleId)
    for (const child of children.get(moduleId) ?? []) visit(child)
    visiting.delete(moduleId)
    visited.add(moduleId)
  }
  for (const module of project.modules) visit(module.id)
  if (
    project.id !== id ||
    project.source.sha256 !== imported.manifest.source.sha256 ||
    project.source.filename !== imported.manifest.source.filename ||
    project.source.size !== imported.manifest.source.bytes
  )
    throw new Error("Reverse project identity does not match its imported source")
  const original = path.join(root, "original", project.source.filename),
    originalInfo = await lstat(original),
    statKey = `${originalInfo.size}:${originalInfo.mtimeMs}:${originalInfo.ctimeMs}`
  if (!originalInfo.isFile() || originalInfo.isSymbolicLink() || originalInfo.size !== project.source.size)
    throw new Error("Reverse project original archive is missing or has changed")
  const cached = originalHashCache.get(original),
    digest = !strong && cached?.statKey === statKey ? cached.sha256 : await hashFile(original)
  if (digest !== project.source.sha256) throw new Error("Reverse project original archive is missing or has changed")
  originalHashCache.set(original, { statKey, sha256: digest })
  return project
}

async function writeManifest(root: string, project: ReverseProject) {
  const temporary = path.join(root, `.manifest-${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(project, null, 2) + "\n", { flag: "wx", mode: 0o600 })
  await rename(temporary, path.join(root, "manifest.json"))
}

export async function prepareReverseProject(input: {
  workspaceDirectory: string
  id: string
  runtimeDirectory: string
  javaHome?: string
  signal?: AbortSignal
  onLog?: (text: string) => void
}) {
  reverseIdSchema.parse(input.id)
  if (!path.isAbsolute(input.workspaceDirectory) || !path.isAbsolute(input.runtimeDirectory))
    throw new Error("Choose absolute workspace and runtime directories")
  return prepareReverseProjectInner(input)
}

export async function getReverseProject(input: { workspaceDirectory: string; id: string }) {
  const { exists } = await projectStorage(input.workspaceDirectory, input.id)
  if (!exists) return null
  return readReverseProject(input.workspaceDirectory, input.id)
}

function fileKind(relative: string): "manifest" | "source" | "resource" | "log" | "original" | "build" {
  if (relative === "manifest.json") return "manifest"
  const [root, rest] = relative.split("/", 2)
  if (root === "original") return "original"
  if (root === "logs") return "log"
  if (root === "modules" && rest) {
    if (relative.includes("/src/")) return "source"
    if (relative.includes("/resources/")) return "resource"
    if (relative.includes("/build/")) return "build"
  }
  return "resource"
}

/** Keeps the lexicographically first paths without retaining every file visited. */
export function reverseFileList<T extends { path: string }>() {
  const result: T[] = []
  const compare = (a: T, b: T) => a.path.localeCompare(b.path, "en")
  const swap = (a: number, b: number) => {
    const value = result[a]!
    result[a] = result[b]!
    result[b] = value
  }
  return {
    add(value: T) {
      if (result.length < REVERSE_LIMITS.listedFiles) {
        result.push(value)
        let index = result.length - 1
        while (index > 0) {
          const parent = Math.floor((index - 1) / 2)
          if (compare(result[parent]!, result[index]!) >= 0) break
          swap(parent, index)
          index = parent
        }
      } else if (compare(value, result[0]!) < 0) {
        result[0] = value
        let index = 0
        while (true) {
          const left = index * 2 + 1,
            right = left + 1,
            largest = right < result.length && compare(result[right]!, result[left]!) > 0 ? right : left
          if (largest >= result.length || compare(result[index]!, result[largest]!) >= 0) break
          swap(index, largest)
          index = largest
        }
      }
    },
    sorted: () => result.sort(compare),
  }
}

export async function listReverseFiles(input: { workspaceDirectory: string; id: string; prefix?: string }) {
  const project = await readReverseProject(input.workspaceDirectory, input.id),
    root = rootOf(input.workspaceDirectory, input.id),
    rawPrefix = input.prefix ? safeReversePath(input.prefix) : "",
    prefix = rawPrefix.toLowerCase(),
    result = reverseFileList<{ path: string; kind: ReturnType<typeof fileKind>; size: number; moduleId?: string }>()
  let scope = root,
    scopePrefix = ""
  if (prefix) {
    const parts = rawPrefix.split("/")
    for (let length = parts.length - 1; length > 0; length--) {
      const relative = parts.slice(0, length).join("/"),
        candidate = reverseFilePath(root, relative),
        info = await lstat(candidate).catch(() => undefined)
      if (info?.isSymbolicLink()) throw new Error(`Reverse project contains symbolic link: ${relative}`)
      if (!info?.isDirectory()) continue
      scope = candidate
      scopePrefix = relative
      break
    }
  }
  if (scopePrefix) await assertNoReverseSymlink(root, scopePrefix)
  const visit = async (directory: string, relative: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filePath = relative ? `${relative}/${entry.name}` : entry.name,
        target = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Reverse project contains symbolic link: ${filePath}`)
      if (entry.isDirectory()) {
        await visit(target, filePath)
        continue
      }
      if (
        !entry.isFile() ||
        filePath.startsWith(".cache/") ||
        filePath.startsWith(".tmp-") ||
        (prefix && !filePath.toLowerCase().startsWith(prefix))
      )
        continue
      const moduleId = project.modules.find(
          (module) =>
            filePath.startsWith(`${module.sourceRoot}/`) ||
            filePath.startsWith(`${module.resourceRoot}/`) ||
            filePath.startsWith(`modules/${module.id}/`),
        )?.id,
        value = {
          path: filePath,
          kind: fileKind(filePath),
          size: (await stat(target)).size,
          ...(moduleId ? { moduleId } : {}),
        }
      result.add(value)
    }
  }
  await visit(scope, scopePrefix)
  return result.sorted()
}

function textBytes(bytes: Buffer) {
  if (bytes.includes(0)) return null
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}
async function readPrefix(filename: string, limit: number) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of createReadStream(filename, { start: 0, end: limit - 1 })) {
    chunks.push(chunk)
    size += chunk.length
  }
  return Buffer.concat(chunks, size)
}
export async function readReverseFile(input: { workspaceDirectory: string; id: string; path: string }) {
  await readReverseProject(input.workspaceDirectory, input.id)
  const root = rootOf(input.workspaceDirectory, input.id),
    relative = safeReversePath(input.path)
  await assertNoReverseSymlink(root, relative)
  const file = reverseFilePath(root, relative),
    info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Reverse path is not a regular file")
  const truncated = info.size > REVERSE_LIMITS.readBytes,
    sample = await readPrefix(file, REVERSE_LIMITS.readBytes),
    digest = await hashFile(file)
  const text = textBytes(sample)
  return {
    path: relative,
    sha256: digest,
    encoding: text === null ? ("base64" as const) : ("utf8" as const),
    content: text ?? sample.toString("base64"),
    truncated,
  }
}

function changeBytes(change: ReverseChange) {
  if (change.content === null) return Buffer.alloc(0)
  if (change.encoding === "utf8") return Buffer.from(change.content, "utf8")
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(change.content))
    throw new Error(`Invalid base64 content for ${change.path}`)
  return Buffer.from(change.content, "base64")
}
function editablePath(project: ReverseProject, relative: string) {
  const safe = safeReversePath(relative),
    parts = safe.split("/")
  if (parts[0] === "archive" && parts.length > 1 && !/\.(?:jar|zip|mrpack|class)$/i.test(parts.at(-1)!)) return safe
  if (parts[0] === "modules" && parts.length >= 4) {
    const module = project.modules.find((item) => item.id === parts[1])
    if (!module) throw new Error(`Unknown reverse module: ${parts[1]}`)
    if (parts[2] === "src" && parts.at(-1)!.toLowerCase().endsWith(".java")) return safe
    if (parts[2] === "resources" && !/\.(?:class|jar|zip|mrpack)$/i.test(parts.at(-1)!)) return safe
  }
  throw new Error(`Reverse path is read-only: ${safe}`)
}

export async function applyReverseChanges(input: { workspaceDirectory: string; id: string; changes: ReverseChange[] }) {
  const project = await readReverseProject(input.workspaceDirectory, input.id),
    root = rootOf(input.workspaceDirectory, input.id),
    changes = input.changes.map((change) => ReverseChangeSchema.parse(change))
  if (!changes.length || changes.length > 500) throw new Error("Choose between 1 and 500 reverse changes")
  const paths = changes.map((change) => editablePath(project, change.path).toLowerCase())
  if (new Set(paths).size !== paths.length) throw new Error("Duplicate reverse change paths")
  const decoded = changes.map((change) => changeBytes(change))
  if (decoded.reduce((sum, bytes) => sum + bytes.byteLength, 0) > REVERSE_LIMITS.changeBytes)
    throw new Error("Combined reverse change content exceeds limit")
  const targets = await Promise.all(
    changes.map(async (change, index) => {
      const relative = editablePath(project, change.path),
        target = reverseFilePath(root, relative)
      await assertNoReverseSymlink(root, relative, true)
      const info = await lstat(target).catch(() => undefined),
        currentHash = info?.isFile() && !info.isSymbolicLink() ? await hashFile(target) : null
      if (currentHash !== change.expectedSha256) throw new Error(`Reverse file hash precondition failed: ${relative}`)
      if (info && !info.isFile()) throw new Error(`Reverse target is not a regular file: ${relative}`)
      return { relative, target, bytes: decoded[index]!, operation: change.operation }
    }),
  )
  for (const target of targets) {
    if (target.operation === "delete") await rm(target.target, { force: true })
    else {
      await mkdir(path.dirname(target.target), { recursive: true })
      const temporary = `${target.target}.${randomUUID()}.tmp`
      await writeFile(temporary, target.bytes, { flag: "wx", mode: 0o600 })
      await rename(temporary, target.target)
    }
  }
  const updatedModules = await Promise.all(
    project.modules.map(async (module) => ({
      ...module,
      sourceCount: await fileCount(path.resolve(root, ...module.sourceRoot.split("/")), ".java"),
    })),
  )
  const updated = ReverseProjectSchema.parse({
    ...project,
    updatedAt: new Date().toISOString(),
    modules: updatedModules,
  })
  await writeManifest(root, updated)
  return {
    project: updated,
    applied: await Promise.all(
      targets.map(async (target) => ({
        path: target.relative,
        sha256: target.operation === "delete" ? null : await hashFile(target.target),
      })),
    ),
  }
}

function diagnostics(stderr: string, stdout: string) {
  return `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .filter((line) => /\.java:\d+:|error:|warning:|symbol:|location:/i.test(line))
    .slice(0, 10_000)
}

export async function buildReverseModule(input: {
  workspaceDirectory: string
  id: string
  moduleId: string
  runtimeDirectory: string
  javaHome?: string
  dependencyPaths?: string[]
  signal?: AbortSignal
  onLog?: (text: string) => void
}) {
  const project = await readReverseProject(input.workspaceDirectory, input.id, true),
    module = project.modules.find((item) => item.id === input.moduleId)
  if (!module) throw new Error(`Reverse module not found: ${input.moduleId}`)
  if (!path.isAbsolute(input.runtimeDirectory)) throw new Error("Choose an absolute runtime directory")
  const root = rootOf(input.workspaceDirectory, input.id),
    sourceRoot = reverseFilePath(root, module.sourceRoot),
    moduleRoot = path.join(root, "modules", module.id),
    tools = await prepareReverseTools({
      runtimeDirectory: input.runtimeDirectory,
      ...(input.javaHome ? { javaHome: input.javaHome } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      onLog: input.onLog,
    }),
    dependencyPreparation = await prepareReverseDependencies({
      root,
      previous: module.dependencyFiles,
      filenames: input.dependencyPaths,
      ...(input.signal ? { signal: input.signal } : {}),
    })
  const temp = path.join(moduleRoot, `.build-${randomUUID()}`),
    classes = path.join(temp, "classes"),
    oldBuild = path.join(moduleRoot, "build"),
    outputBuild = path.join(oldBuild, "current")
  try {
    await mkdir(classes, { recursive: true })
    const classpath = [...dependencyPreparation.classpath]
    for (const other of project.modules) {
      if (other.id === module.id) continue
      const built =
        other.build.status === "success" && other.build.outputJarPath
          ? reverseFilePath(root, other.build.outputJarPath)
          : undefined
      classpath.push(
        built && (await lstat(built).catch(() => undefined))?.isFile()
          ? built
          : reverseFilePath(root, other.originalJarPath),
      )
    }
    classpath.push(reverseFilePath(root, module.originalJarPath))
    const classVersionBytes = await moduleClassVersion(module.originalJarPath, root),
      release = Math.max(8, Math.min(25, classVersionBytes - 44))
    const result = await compileReverseSources({
      sourceDirectory: sourceRoot,
      outputDirectory: classes,
      classpath,
      tools,
      release,
      ...(input.signal ? { signal: input.signal } : {}),
      onLog: input.onLog,
    })
    const buildStatus = result.exitCode === 0 && !result.timedOut ? "success" : "failed",
      sourceHash = await hashDirectory(sourceRoot, ".java"),
      resourceHash = await hashDirectory(reverseFilePath(root, module.resourceRoot))
    const stdout = digestFromOutput(result.stdout),
      stderr = digestFromOutput(result.stderr),
      outputJarPath = buildStatus === "success" ? `modules/${module.id}/build/current/module.jar` : null
    if (buildStatus === "success") {
      const originalJar = reverseFilePath(root, module.originalJarPath),
        entries = await listReverseArchiveEntries(originalJar),
        compiled = new Map(
          (await listReverseFilesOnDisk(classes))
            .filter((file) => isClass(file.path))
            .map((file) => [file.path, reverseFilePath(classes, file.path)]),
        ),
        originalClassSources = await classSourceFiles(originalJar, entries, new Set(compiled.keys())),
        sourceRootFiles = await listReverseFilesOnDisk(sourceRoot),
        sourceFiles = new Set(
          sourceRootFiles.filter((file) => file.path.toLowerCase().endsWith(".java")).map((file) => file.path),
        ),
        baselineSourceFiles = new Set(module.decompiledSourceFiles ?? []),
        resourceRoot = reverseFilePath(root, module.resourceRoot),
        resourceFiles = await listReverseFilesOnDisk(resourceRoot),
        resources = new Map(resourceFiles.map((file) => [file.path, reverseFilePath(resourceRoot, file.path)])),
        replacements = new Map<string, string | null>(),
        additions = new Map<string, string>()
      for (const entry of entries) {
        if (entry.directory) continue
        if (compiled.has(entry.path)) {
          replacements.set(entry.path, compiled.get(entry.path)!)
          continue
        }
        if (isClass(entry.path)) {
          const javaPath = sourcePathForClass(entry.path, originalClassSources.get(entry.path))
          if (
            javaPath &&
            (sourceFiles.has(javaPath) || (baselineSourceFiles.has(javaPath) && !sourceFiles.has(javaPath)))
          )
            replacements.set(entry.path, null)
          continue
        }
        replacements.set(entry.path, resources.get(entry.path) ?? null)
        resources.delete(entry.path)
      }
      for (const [name, file] of compiled)
        if (!entries.some((entry) => !entry.directory && entry.path === name)) additions.set(name, file)
      for (const [name, file] of resources) additions.set(name, file)
      const jarTemp = path.join(temp, "module.jar")
      await rewriteReverseArchive({
        source: originalJar,
        destination: jarTemp,
        replacements,
        additions,
        removeSignatures: entries.some((entry) => signedEntry(entry.path)),
        warningText:
          "MineMods removed stale JAR signatures after recompilation. Re-sign before relying on signature verification.\n",
      })
      await rm(outputBuild, { recursive: true, force: true })
      await mkdir(oldBuild, { recursive: true })
      await rename(temp, outputBuild)
    } else await rm(temp, { recursive: true, force: true })
    const updatedModule = reverseModuleSchema.parse({
      ...module,
      build: {
        status: buildStatus,
        attemptedAt: new Date().toISOString(),
        sourceSha256: sourceHash,
        resourceSha256: resourceHash,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdout,
        stderr,
        diagnostics: diagnostics(stderr, stdout),
        outputJarPath,
      },
      dependencyFiles: dependencyPreparation.entries,
    })
    await mkdir(path.join(root, "logs"), { recursive: true })
    await writeFile(path.join(root, "logs", `${module.id}.build.stdout.txt`), stdout, { mode: 0o600 })
    await writeFile(path.join(root, "logs", `${module.id}.build.stderr.txt`), stderr, { mode: 0o600 })
    const updated = ReverseProjectSchema.parse({
      ...project,
      updatedAt: new Date().toISOString(),
      status: "partial",
      modules: project.modules.map((item) => (item.id === module.id ? updatedModule : item)),
      warnings: [...project.warnings, ...(buildStatus === "failed" ? [`${module.archivePath}: build failed`] : [])],
    })
    await writeManifest(root, updated)
    return { project: updated, moduleId: module.id, build: updatedModule.build }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

function signedEntry(name: string) {
  return /^META-INF\/[^/]+\.(?:SF|RSA|DSA|EC)$/i.test(name)
}

async function outputModuleArchive(
  root: string,
  project: ReverseProject,
  module: ReverseModule,
  stage: string,
  dirtySources: Set<string>,
  memo: Map<string, string>,
): Promise<{ path: string; changed: boolean; warnings: string[] }> {
  if (memo.has(module.id)) return { path: memo.get(module.id)!, changed: true, warnings: [] }
  const sourceRoot = reverseFilePath(root, module.sourceRoot),
    resourceRoot = reverseFilePath(root, module.resourceRoot),
    originalJar = reverseFilePath(root, module.originalJarPath),
    sourceHash = await hashDirectory(sourceRoot, ".java"),
    resourceHash = await hashDirectory(resourceRoot),
    builtClasses =
      module.build.status === "success" && module.build.sourceSha256 === sourceHash && module.build.outputJarPath
        ? reverseFilePath(root, `${path.posix.dirname(module.build.outputJarPath)}/classes`)
        : null,
    useBuild = Boolean(builtClasses),
    sourceDirty = sourceHash !== module.decompiledSourceSha256,
    resourceDirty = resourceHash !== module.decompiledResourceSha256,
    childPlacements = project.modules.flatMap((child) =>
      child.placements.filter((place) => place.parentModuleId === module.id).map((place) => ({ child, place })),
    ),
    childResults = await Promise.all(
      childPlacements.map(async ({ child, place }) => ({
        child,
        place,
        result: await outputModuleArchive(root, project, child, stage, dirtySources, memo),
      })),
    ),
    changed = Boolean(useBuild || resourceDirty || childResults.some((entry) => entry.result.changed))
  if (sourceDirty && !useBuild) dirtySources.add(module.id)
  if (!changed)
    return {
      path: originalJar,
      changed: false,
      warnings:
        sourceDirty && !useBuild
          ? [`Source changed without a successful current build: ${module.archivePath}; original bytecode retained.`]
          : [],
    }
  const sourceEntries = await listReverseArchiveEntries(originalJar),
    compiledMap = new Map<string, string>()
  if (builtClasses)
    for (const file of await listReverseFilesOnDisk(builtClasses))
      if (isClass(file.path)) compiledMap.set(file.path, reverseFilePath(builtClasses, file.path))
  const originalClassSources = builtClasses
      ? await classSourceFiles(originalJar, sourceEntries, new Set(compiledMap.keys()))
      : new Map<string, string>(),
    sourceRootFiles = await listReverseFilesOnDisk(sourceRoot),
    sourceFiles = new Set(
      sourceRootFiles.filter((file) => file.path.toLowerCase().endsWith(".java")).map((file) => file.path),
    ),
    baselineSourceFiles = new Set(module.decompiledSourceFiles ?? []),
    resourceFiles = await listReverseFilesOnDisk(resourceRoot),
    resourceMap = new Map(resourceFiles.map((entry) => [entry.path, reverseFilePath(resourceRoot, entry.path)]))
  const childMap = new Map(childResults.map((entry) => [entry.place.internalPath!, entry.result]))
  const replacements = new Map<string, string | null>(),
    additions = new Map<string, string>()
  for (const entry of sourceEntries) {
    if (entry.directory) continue
    if (compiledMap.has(entry.path)) {
      replacements.set(entry.path, compiledMap.get(entry.path)!)
      continue
    }
    const child = childMap.get(entry.path)
    if (child?.changed) {
      replacements.set(entry.path, child.path)
      continue
    }
    if (isClass(entry.path)) {
      if (builtClasses) {
        const javaPath = sourcePathForClass(entry.path, originalClassSources.get(entry.path))
        if (
          javaPath &&
          (sourceFiles.has(javaPath) || (baselineSourceFiles.has(javaPath) && !sourceFiles.has(javaPath)))
        )
          replacements.set(entry.path, null)
      }
      continue
    }
    replacements.set(entry.path, resourceMap.get(entry.path) ?? null)
    resourceMap.delete(entry.path)
  }
  for (const [name, file] of compiledMap)
    if (!sourceEntries.some((entry) => !entry.directory && entry.path === name)) additions.set(name, file)
  for (const [name, file] of resourceMap) additions.set(name, file)
  const output = path.join(stage, `module-${module.id}-${randomUUID()}.jar`),
    signatures = sourceEntries.some((entry) => signedEntry(entry.path)),
    result = await rewriteReverseArchive({
      source: originalJar,
      destination: output,
      replacements,
      additions,
      removeSignatures: signatures,
      warningText:
        "MineMods removed stale JAR signatures after source or resource changes. Re-sign before relying on signature verification.\n",
    })
  memo.set(module.id, output)
  return {
    path: output,
    changed: true,
    warnings: [
      ...result.warnings,
      ...(sourceDirty && !useBuild
        ? [`Source changed without a successful current build: ${module.archivePath}; original bytecode retained.`]
        : []),
    ],
  }
}

export async function exportReverseProject(input: {
  workspaceDirectory: string
  id: string
  destination: string
  kind: "project" | "archive"
}) {
  const project = await readReverseProject(input.workspaceDirectory, input.id, true),
    root = rootOf(input.workspaceDirectory, input.id),
    imported = await getImportProject(input.workspaceDirectory, input.id)
  if (!path.isAbsolute(input.destination)) throw new Error("Choose an absolute export destination")
  const extension = input.kind === "project" ? ".modreverse" : path.extname(input.destination).toLowerCase()
  if (input.kind === "project" && path.extname(input.destination).toLowerCase() !== ".modreverse")
    throw new Error("Choose a .modreverse destination")
  if (input.kind === "archive" && ![".jar", ".zip", ".mrpack"].includes(extension))
    throw new Error("Archive export must use .jar, .zip, or .mrpack")
  const destination = path.resolve(input.destination),
    projectRoot = path.resolve(root),
    sourceOriginal = path.resolve(root, "original", project.source.filename)
  await mkdir(path.dirname(destination), { recursive: true })
  const canonicalDestination = path.join(await realpath(path.dirname(destination)), path.basename(destination)),
    importedRoot = await realpath(imported.directory),
    canonicalProjectRoot = await realpath(projectRoot),
    canonicalSourceOriginal = await realpath(sourceOriginal),
    importedSource = await realpath(path.join(imported.directory, "source", project.source.filename))
  if (
    [importedRoot, canonicalProjectRoot].some(
      (base) => canonicalDestination === base || canonicalDestination.startsWith(`${base}${path.sep}`),
    ) ||
    canonicalDestination === canonicalSourceOriginal ||
    canonicalDestination === importedSource
  )
    throw new Error("Export destination must be outside the analysis project and original archive")
  const destinationInfo = await lstat(canonicalDestination).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (destinationInfo?.isSymbolicLink()) throw new Error("Export destination cannot be a symbolic link")
  const sourceInfo = await lstat(canonicalSourceOriginal),
    importedSourceInfo = await lstat(importedSource)
  if (
    destinationInfo &&
    [sourceInfo, importedSourceInfo].some(
      (source) => destinationInfo.dev === source.dev && destinationInfo.ino === source.ino,
    )
  )
    throw new Error("Export destination cannot replace the original archive")
  const tempDir = await import("node:fs/promises").then((fs) => fs.mkdtemp(path.join(root, ".tmp-export-")))
  try {
    if (input.kind === "project") {
      const exportRoot = path.join(tempDir, "bundle")
      await mkdir(exportRoot)
      for (const file of await listReverseFilesOnDisk(root)) {
        if (file.path.startsWith(".cache/") || file.path.startsWith(".tmp-")) continue
        const from = reverseFilePath(root, file.path),
          to = reverseFilePath(exportRoot, file.path)
        await mkdir(path.dirname(to), { recursive: true })
        await copyFile(from, to)
      }
      const contents = await listReverseFilesOnDisk(exportRoot)
      if (!contents.some((entry) => entry.path === "manifest.json"))
        throw new Error("Reverse project export is missing manifest")
      await createReverseArchiveFromDirectory(exportRoot, destination)
      return {
        path: destination,
        kind: input.kind,
        size: (await stat(destination)).size,
        sha256: await hashFile(destination),
        warnings: ["The bundle includes the original archive; inspect it for private content before sharing."],
      }
    }
    const dirtySources = new Set<string>(),
      memo = new Map<string, string>(),
      warnings: string[] = [],
      sourceIsJar = path.extname(project.source.filename).toLowerCase() === ".jar"
    if (sourceIsJar) {
      const module = project.modules.find((item) =>
        item.placements.some((place) => place.parentModuleId === null && place.archivePath === project.source.filename),
      )
      if (!module) {
        await copyFile(sourceOriginal, destination)
        return {
          path: destination,
          kind: input.kind,
          size: project.source.size,
          sha256: project.source.sha256,
          warnings: ["No module was found; original archive copied unchanged."],
        }
      }
      const result = await outputModuleArchive(root, project, module, tempDir, dirtySources, memo)
      warnings.push(...result.warnings)
      if (dirtySources.size)
        throw new Error(
          `Archive export blocked because edited Java sources have no successful current build: ${[...dirtySources].join(", ")}`,
        )
      await mkdir(path.dirname(destination), { recursive: true })
      if (!result.changed) await copyFile(sourceOriginal, destination)
      else await copyFile(result.path, destination)
    } else {
      const originalContents = await listReverseArchiveEntries(sourceOriginal),
        archiveRoot = reverseFilePath(root, "archive"),
        archiveFiles = await listReverseFilesOnDisk(archiveRoot),
        resourceMap = new Map(archiveFiles.map((entry) => [entry.path, reverseFilePath(archiveRoot, entry.path)])),
        replacements = new Map<string, string | null>(),
        additions = new Map<string, string>()
      const archiveResourceChanged = (await hashArchiveResources(archiveRoot)) !== project.archiveResourceSha256
      let signatures = archiveResourceChanged && originalContents.some((entry) => signedEntry(entry.path))
      for (const entry of originalContents) {
        if (entry.directory) continue
        const rootModule = project.modules.find((module) =>
          module.placements.some((place) => place.parentModuleId === null && place.archivePath === entry.path),
        )
        if (rootModule) {
          const result = await outputModuleArchive(root, project, rootModule, tempDir, dirtySources, memo)
          warnings.push(...result.warnings)
          if (result.changed) {
            replacements.set(entry.path, result.path)
            signatures ||= originalContents.some((item) => signedEntry(item.path))
          }
          resourceMap.delete(entry.path)
          continue
        }
        if (isJar(entry.path)) continue
        const edited = resourceMap.get(entry.path)
        if (edited) {
          replacements.set(entry.path, edited)
          resourceMap.delete(entry.path)
        } else if (archiveResourceChanged) replacements.set(entry.path, null)
      }
      if (dirtySources.size)
        throw new Error(
          `Archive export blocked because edited Java sources have no successful current build: ${[...dirtySources].join(", ")}`,
        )
      for (const [name, file] of resourceMap) if (!isJar(name) && !isClass(name)) additions.set(name, file)
      const output = destination
      await mkdir(path.dirname(output), { recursive: true })
      const rewritten = await rewriteReverseArchive({
        source: sourceOriginal,
        destination: output,
        replacements,
        additions,
        removeSignatures: signatures,
        warningText:
          "MineMods removed stale archive signatures after editing archive content. Re-sign before relying on signature verification.\n",
      })
      warnings.push(...rewritten.warnings)
    }
    return {
      path: destination,
      kind: input.kind,
      size: (await stat(destination)).size,
      sha256: await hashFile(destination),
      warnings: [...new Set(warnings)],
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function restoreReverseProject(input: {
  workspaceDirectory: string
  filename: string
  signal?: AbortSignal
}) {
  if (!path.isAbsolute(input.workspaceDirectory) || !path.isAbsolute(input.filename))
    throw new Error("Choose absolute workspace and .modreverse paths")
  if (path.extname(input.filename).toLowerCase() !== ".modreverse")
    throw new Error("Choose a .modreverse project archive")
  const workspace = await realpath(input.workspaceDirectory),
    base = path.join(workspace, "analysis-projects")
  await mkdir(base, { recursive: true })
  const baseInfo = await lstat(base)
  if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) throw new Error("Unsafe analysis project storage")
  const staging = path.join(base, `.reverse-restore-${randomUUID()}`),
    contents = path.join(staging, "contents")
  await mkdir(contents, { recursive: true })
  let importedDirectory: string | undefined,
    restored = false
  try {
    await extractReverseArchive(input.filename, contents, {
      signal: input.signal,
      maxEntries: 100_000,
      maxExpandedBytes: 16 * 1024 ** 3,
    })
    const manifest = ReverseProjectSchema.parse(
      JSON.parse(await readFile(path.join(contents, "manifest.json"), "utf8")),
    )
    if (
      path.basename(manifest.source.filename) !== manifest.source.filename ||
      manifest.source.filename.includes("/") ||
      manifest.source.filename.includes("\\")
    )
      throw new Error("Shared reverse project contains an unsafe source filename")
    for (const module of manifest.modules) {
      if (
        (module.build.status === "success" &&
          module.build.outputJarPath !== `modules/${module.id}/build/current/module.jar`) ||
        (module.build.status !== "success" && module.build.outputJarPath !== null)
      )
        throw new Error("Shared reverse project contains an invalid module build output path")
      for (const placement of module.placements)
        if (placement.internalPath !== null) safeReversePath(placement.internalPath)
    }
    const moduleIds = new Set(manifest.modules.map((module) => module.id)),
      children = new Map<string, string[]>()
    for (const module of manifest.modules)
      for (const placement of module.placements)
        if (placement.parentModuleId !== null) {
          if (!moduleIds.has(placement.parentModuleId))
            throw new Error("Shared reverse project placement references a missing parent module")
          children.set(placement.parentModuleId, [...(children.get(placement.parentModuleId) ?? []), module.id])
        }
    const visiting = new Set<string>(),
      visited = new Set<string>()
    const visit = (moduleId: string) => {
      if (visiting.has(moduleId)) throw new Error("Shared reverse project placements contain a cycle")
      if (visited.has(moduleId)) return
      visiting.add(moduleId)
      for (const child of children.get(moduleId) ?? []) visit(child)
      visiting.delete(moduleId)
      visited.add(moduleId)
    }
    for (const module of manifest.modules) visit(module.id)
    const original = path.join(contents, "original", manifest.source.filename)
    if ((await hashFile(original)) !== manifest.source.sha256 || (await stat(original)).size !== manifest.source.size)
      throw new Error("Shared reverse project source checksum does not match its manifest")
    const imported = await importProject({
      workspaceDirectory: workspace,
      filename: original,
      ...(input.signal ? { signal: input.signal } : {}),
    })
    importedDirectory = imported.directory
    const newRoot = path.join(imported.directory, "reverse"),
      restoredProject = ReverseProjectSchema.parse({
        ...manifest,
        id: imported.manifest.id,
        updatedAt: new Date().toISOString(),
      })
    await writeFile(path.join(contents, "manifest.json"), JSON.stringify(restoredProject, null, 2) + "\n", {
      mode: 0o600,
    })
    await rename(contents, newRoot)
    const project = await readReverseProject(workspace, imported.manifest.id)
    restored = true
    return { project, restoredFrom: manifest.id, sourceHashVerified: true }
  } finally {
    await rm(staging, { recursive: true, force: true })
    if (importedDirectory && !restored) await rm(importedDirectory, { recursive: true, force: true })
  }
}
