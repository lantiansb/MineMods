import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import yauzl from "yauzl"

type ZipEntry = yauzl.Entry
type ArchiveIndex = {
  filename: string
  sha256: string
  entries: Map<string, ZipEntry>
  zip: yauzl.ZipFile
  cacheKey?: string
  refs: number
  touched: number
}

const archiveCache = new Map<string, Promise<ArchiveIndex>>()
const archiveCacheLimit = 6
const byteCache = new Map<string, Uint8Array>()
let byteCacheSize = 0
const sha256File = async (filename: string) => {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest("hex")
}

const safeEntry = (name: string) => {
  const normalized = name.replaceAll("\\", "/")
  return !normalized.endsWith("/") && !normalized.split("/").some((part) => !part || part === "." || part === "..")
}

const pruneArchiveCache = () => {
  if (archiveCache.size <= archiveCacheLimit) return
  void Promise.all([...archiveCache.entries()].map(async ([key, pending]) => ({ key, index: await pending })))
    .then((entries) =>
      Promise.all(
        entries
          .sort((left, right) => left.index.touched - right.index.touched)
          .slice(0, entries.length - archiveCacheLimit)
          .map(({ key, index }) => {
            if (index.refs) return
            archiveCache.delete(key)
            index.zip.close()
          }),
      ),
    )
    .catch(() => undefined)
}

async function getArchiveIndex(filename: string, cacheable = true): Promise<ArchiveIndex> {
  const info = await stat(filename),
    key = `${path.resolve(filename)}\0${info.size}\0${info.mtimeMs}`,
    cached = cacheable ? archiveCache.get(key) : undefined
  if (cached) {
    const index = await cached
    index.touched = Date.now()
    index.refs++
    return index
  }
  const pending = new Promise<ArchiveIndex>((resolve, reject) =>
    yauzl.open(filename, { lazyEntries: true, autoClose: false, strictFileNames: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("Unable to open Minecraft archive"))
      const entries = new Map<string, ZipEntry>()
      zip.on("error", (cause) => {
        zip.close()
        reject(cause)
      })
      zip.on("end", () => {
        void sha256File(filename).then(
          (sha256) =>
            resolve({
              filename,
              sha256,
              entries,
              zip,
              ...(cacheable ? { cacheKey: key } : {}),
              refs: 1,
              touched: Date.now(),
            }),
          (cause) => {
            zip.close()
            reject(cause)
          },
        )
      })
      zip.on("entry", (entry) => {
        const name = entry.fileName.replaceAll("\\", "/")
        if (safeEntry(name) && !entries.has(name)) entries.set(name, entry)
        zip.readEntry()
      })
      zip.readEntry()
    }),
  )
  if (cacheable) {
    archiveCache.set(key, pending)
    void pending.catch(() => {
      if (archiveCache.get(key) === pending) archiveCache.delete(key)
    })
    pruneArchiveCache()
  }
  return pending
}

const releaseArchive = (index: ArchiveIndex) => {
  index.refs = Math.max(0, index.refs - 1)
  index.touched = Date.now()
  if (!index.refs && !index.cacheKey) index.zip.close()
  pruneArchiveCache()
}

async function readIndexedEntry(index: ArchiveIndex, name: string, maxBytes: number) {
  const cacheKey = `${index.sha256}\0${name}`,
    cached = byteCache.get(cacheKey)
  if (cached) {
    byteCache.delete(cacheKey)
    byteCache.set(cacheKey, cached)
    return cached
  }
  const entry = index.entries.get(name)
  if (!entry) throw new Error(`Archive resource is missing: ${name}`)
  if (entry.uncompressedSize > maxBytes) throw new Error(`Archive resource exceeds read limit: ${name}`)
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    index.zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(error ?? new Error(`Unable to read archive resource: ${name}`))
      const chunks: Buffer[] = []
      let size = 0
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length
        if (size > maxBytes) stream.destroy(new Error(`Archive resource exceeds read limit: ${name}`))
        else chunks.push(chunk)
      })
      stream.on("error", reject)
      stream.on("end", () => resolve(Buffer.concat(chunks)))
    })
  })
  if (bytes.length <= 2 * 1024 * 1024) {
    byteCache.set(cacheKey, bytes)
    byteCacheSize += bytes.length
    while (byteCacheSize > 24 * 1024 * 1024) {
      const oldest = byteCache.keys().next().value
      if (!oldest) break
      byteCacheSize -= byteCache.get(oldest)!.length
      byteCache.delete(oldest)
    }
  }
  return bytes
}

const minecraftRoots = (
  input: { workspaceDirectory?: string; runtimeDirectory?: string; projectDirectory?: string } = {},
) => [
  ...new Set(
    [
      input.workspaceDirectory,
      input.runtimeDirectory,
      input.projectDirectory,
      process.env.MINECRAFT_DIR,
      process.env.APPDATA ? path.join(process.env.APPDATA, ".minecraft") : undefined,
      process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Saved Games", "MC", ".minecraft") : undefined,
      process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Roaming", ".minecraft") : undefined,
      process.env.HOME ? path.join(process.env.HOME, ".minecraft") : undefined,
    ]
      .filter((root): root is string => Boolean(root))
      .flatMap((root) => [
        root,
        path.join(root, ".minecraft"),
        path.join(root, "minecraft"),
        path.join(root, "runtime", "minecraft"),
        path.join(root, ".cache", "minecraft"),
        path.join(root, ".cache", "import-assets", "minecraft"),
      ]),
  ).values(),
]

const versionMetadataMatches = async (versionDirectory: string, version: string) => {
  const metadataPath = path.join(versionDirectory, `${path.basename(versionDirectory)}.json`),
    info = await lstat(metadataPath).catch(() => undefined)
  if (!info) return true
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) return false
  try {
    return JSON.parse(await readFile(metadataPath, "utf8")).id === version
  } catch {
    return false
  }
}

async function locateClientJars(
  version: string,
  roots: string[],
): Promise<{ resources: string; classes?: string; source: "libraries" | "versions" } | null> {
  const libraryCandidates = await Promise.all(
    roots.map(async (root) => {
      const libraryRoot = path.join(root, "libraries", "net", "minecraft", "client")
      return readdir(libraryRoot, { withFileTypes: true })
        .then((entries) =>
          entries
            .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${version}-`))
            .flatMap((entry) => {
              const directory = path.join(libraryRoot, entry.name)
              return [
                {
                  resources: path.join(directory, `client-${entry.name}-extra.jar`),
                  classes: path.join(directory, `client-${entry.name}-srg.jar`),
                  source: "libraries" as const,
                },
                {
                  resources: path.join(directory, `client-${entry.name}.jar`),
                  source: "libraries" as const,
                },
              ]
            }),
        )
        .catch(() => [])
    }),
  )
  for (const candidate of libraryCandidates.flat()) {
    const info = await lstat(candidate.resources).catch(() => undefined)
    if (!info?.isFile() || info.isSymbolicLink()) continue
    let classes = candidate.classes
    if (candidate.classes) {
      const classInfo = await lstat(candidate.classes).catch(() => undefined)
      if (!classInfo?.isFile() || classInfo.isSymbolicLink()) classes = undefined
    }
    return { resources: candidate.resources, ...(classes ? { classes } : {}), source: candidate.source }
  }
  for (const root of roots) {
    const versionDirectory = path.join(root, "versions", version),
      versionJar = path.join(versionDirectory, `${version}.jar`),
      info = await lstat(versionJar).catch(() => undefined)
    if (info?.isFile() && !info.isSymbolicLink() && (await versionMetadataMatches(versionDirectory, version)))
      return { resources: versionJar, source: "versions" }
  }
  return null
}

const supportedResource = (name: string) =>
  /^assets\/minecraft\/(?:models\/(?:block|item)\/.*\.json|textures\/.*\.png(?:\.mcmeta)?)$/i.test(name)

export function resolveTargetMinecraftVersion(reportedVersions: string[], sourceFilename: string) {
  const exact = (value: string) => (/^\d+(?:\.\d+){1,2}(?:[-+][a-z0-9.-]+)?$/i.test(value) ? value : null),
    exactVersions = [...new Set(reportedVersions.flatMap((value) => (exact(value) ? [exact(value)!] : [])))],
    satisfies = (version: string) =>
      reportedVersions.every((range) => {
        if (exact(range)) return version === exact(range)
        const exactRange = range.match(/^\[\s*(\d+(?:\.\d+){1,2})\s*\]$/)
        if (exactRange) return version === exactRange[1]
        const interval = range.match(/^[[(]\s*(\d+(?:\.\d+){1,2})?\s*,\s*(\d+(?:\.\d+){1,2})?\s*[)\]]$/)
        if (!interval) return false
        const compare = (left: string, right: string) => {
          const a = left.split(".").map(Number),
            b = right.split(".").map(Number)
          for (let index = 0; index < Math.max(a.length, b.length); index++) {
            if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0)
          }
          return 0
        }
        const lower = interval[1],
          upper = interval[2],
          lowerComparison = lower ? compare(version, lower) : 1,
          upperComparison = upper ? compare(version, upper) : -1
        return (
          (lowerComparison > 0 || (lowerComparison === 0 && range.startsWith("["))) &&
          (upperComparison < 0 || (upperComparison === 0 && range.endsWith("]")))
        )
      })
  if (exactVersions.length === 1 && satisfies(exactVersions[0]!))
    return { version: exactVersions[0]!, selectionBasis: "report_exact" as const }
  if (exactVersions.length > 1) return null
  const evidence = [...path.basename(sourceFilename).matchAll(/(?:^|[-_])((?:\d+\.){1,2}\d+)(?=[-_]|\.)/g)].map(
      (match) => match[1]!,
    ),
    candidates = [...new Set(evidence)].filter(satisfies),
    reportedLowerBounds = reportedVersions.flatMap(
      (range) => range.match(/^[[(]\s*(\d+(?:\.\d+){1,2})\s*,/)?.[1] ?? [],
    ),
    explicitlyNamed = candidates.filter((candidate) => reportedLowerBounds.includes(candidate))
  if (explicitlyNamed.length === 1)
    return { version: explicitlyNamed[0]!, selectionBasis: "source_filename_within_reported_range" as const }
  if (candidates.length !== 1) return null
  return { version: candidates[0]!, selectionBasis: "source_filename_within_reported_range" as const }
}

export async function createVanillaResourceProvider(
  version: string,
  rootsInput: { workspaceDirectory?: string; runtimeDirectory?: string; projectDirectory?: string } = {},
) {
  const roots = minecraftRoots(rootsInput),
    jars = await locateClientJars(version, roots)
  if (!jars) return null
  const resources = await getArchiveIndex(jars.resources),
    classes = jars.classes ? await getArchiveIndex(jars.classes) : resources,
    paths = [...resources.entries.keys()].filter(supportedResource),
    classPaths = [
      ...new Set([...resources.entries.keys(), ...classes.entries.keys()].filter((name) => name.endsWith(".class"))),
    ]
  return {
    version,
    selectionBasis: jars.source,
    resourceJar: jars.resources,
    classJar: jars.classes ?? jars.resources,
    resourceSha256: resources.sha256,
    classSha256: classes.sha256,
    sha256: resources.sha256,
    paths,
    classPaths,
    has: (name: string) => resources.entries.has(name.replaceAll("\\", "/")),
    hasClass: (name: string) =>
      classes.entries.has(name.replaceAll("\\", "/")) || resources.entries.has(name.replaceAll("\\", "/")),
    readFile: async (name: string) => {
      const normalized = name.replaceAll("\\", "/"),
        archive = normalized.endsWith(".class") && classes.entries.has(normalized) ? classes : resources
      return readIndexedEntry(archive, normalized, 64 * 1024 * 1024)
    },
    verify: async () =>
      (await sha256File(jars.resources)) === resources.sha256 &&
      (jars.classes ? (await sha256File(jars.classes)) === classes.sha256 : true),
    dispose: () => {
      releaseArchive(resources)
      if (classes !== resources) releaseArchive(classes)
    },
  }
}

export async function createJarClassProvider(filename: string, expectedSha256?: string) {
  const info = await lstat(filename)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Imported source JAR is unavailable")
  const index = await getArchiveIndex(filename, false)
  if (expectedSha256 && index.sha256 !== expectedSha256) {
    releaseArchive(index)
    throw new Error("Imported source JAR checksum mismatch")
  }
  const paths = [...index.entries.keys()].filter((name) => name.endsWith(".class"))
  return {
    sha256: index.sha256,
    paths,
    has: (name: string) =>
      name.replaceAll("\\", "/").endsWith(".class") && index.entries.has(name.replaceAll("\\", "/")),
    readFile: async (name: string) => {
      const normalized = name.replaceAll("\\", "/")
      if (!normalized.endsWith(".class")) throw new Error(`Imported source resource is not a class: ${normalized}`)
      return readIndexedEntry(index, normalized, 64 * 1024 * 1024)
    },
    verify: async () => (await sha256File(filename)) === index.sha256,
    dispose: () => releaseArchive(index),
  }
}

export async function clearImportedArchiveCache() {
  const entries = await Promise.all(
    [...archiveCache.entries()].map(async ([key, pending]) => ({ key, index: await pending })),
  )
  entries.forEach(({ key, index }) => {
    if (index.refs) return
    archiveCache.delete(key)
    index.zip.close()
  })
  byteCache.clear()
  byteCacheSize = 0
}
