import { createWriteStream } from "node:fs"
import { lstat, mkdir, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import yauzl from "yauzl"
import yazl from "yazl"

export const REVERSE_ARCHIVE_LIMITS = {
  entries: 100_000,
  expandedBytes: 16 * 1024 ** 3,
  entryBytes: 2 * 1024 ** 3,
  nestedDepth: 16,
} as const

export function safeReversePath(input: string) {
  const name = input.normalize("NFC")
  if (
    !name ||
    name.length > 1024 ||
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
      ) ||
    path.posix.normalize(name) !== name
  )
    throw new Error(`Unsafe reverse archive path: ${input}`)
  return name
}

export function reverseFilePath(root: string, relative: string) {
  const safe = safeReversePath(relative),
    target = path.resolve(root, ...safe.split("/"))
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Unsafe reverse path: ${relative}`)
  return target
}

export async function assertNoReverseSymlink(root: string, relative: string, allowMissing = false) {
  const safe = safeReversePath(relative),
    rootPath = path.resolve(root)
  let current = rootPath
  for (const part of safe.split("/")) {
    current = path.join(current, part)
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (allowMissing && error.code === "ENOENT") return undefined
      throw error
    })
    if (!info) return
    if (info.isSymbolicLink()) throw new Error(`Reverse project path contains a symbolic link: ${relative}`)
  }
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

export async function extractReverseArchive(
  filename: string,
  destination: string,
  options: {
    signal?: AbortSignal
    maxEntries?: number
    maxExpandedBytes?: number
    include?: (entryPath: string) => boolean
  } = {},
) {
  const zip = await openZip(filename),
    seen = new Set<string>()
  let entries = 0,
    expandedBytes = 0
  await mkdir(destination, { recursive: true })
  const activeStreams = new Set<Readable>()
  await new Promise<void>((resolve, reject) => {
    let finished = false
    const finish = (error?: unknown) => {
      if (finished) return
      finished = true
      options.signal?.removeEventListener("abort", abort)
      if (error) {
        zip.close()
        activeStreams.forEach((stream) => stream.destroy(error instanceof Error ? error : new Error(String(error))))
        reject(error)
      } else resolve()
    }
    const abort = () => {
      zip.close()
      finish(options.signal?.reason ?? new DOMException("Aborted", "AbortError"))
    }
    options.signal?.addEventListener("abort", abort, { once: true })
    zip.on("error", finish)
    zip.on("end", () => finish())
    zip.on("entry", (entry) => {
      Promise.resolve()
        .then(async () => {
          if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError")
          const directory = entry.fileName.endsWith("/"),
            name = safeReversePath(directory ? entry.fileName.slice(0, -1) : entry.fileName),
            key = name.toLowerCase()
          if (seen.has(key)) throw new Error(`Duplicate case-insensitive archive path: ${entry.fileName}`)
          seen.add(key)
          if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
            throw new Error(`Archive symbolic link is not allowed: ${entry.fileName}`)
          entries++
          if (entries > (options.maxEntries ?? REVERSE_ARCHIVE_LIMITS.entries))
            throw new Error("Archive entry count exceeds reverse extraction limit")
          if (directory) {
            await mkdir(reverseFilePath(destination, name), { recursive: true })
            return
          }
          if (options.include && !options.include(name)) return
          if (
            entry.uncompressedSize > REVERSE_ARCHIVE_LIMITS.entryBytes ||
            expandedBytes + entry.uncompressedSize > (options.maxExpandedBytes ?? REVERSE_ARCHIVE_LIMITS.expandedBytes)
          )
            throw new Error("Archive expanded data exceeds reverse extraction limit")
          const target = reverseFilePath(destination, name)
          await mkdir(path.dirname(target), { recursive: true })
          await new Promise<void>((done, fail) =>
            zip.openReadStream(entry, (error, stream) => {
              if (error || !stream) return fail(error ?? new Error("Unable to read archive entry"))
              activeStreams.add(stream)
              let current = 0
              const guard = new Transform({
                transform(chunk: Buffer, _encoding, callback) {
                  current += chunk.length
                  if (
                    current > REVERSE_ARCHIVE_LIMITS.entryBytes ||
                    expandedBytes + current > (options.maxExpandedBytes ?? REVERSE_ARCHIVE_LIMITS.expandedBytes)
                  )
                    return callback(new Error("Archive actual expanded data exceeds reverse extraction limit"))
                  callback(null, chunk)
                },
              })
              pipeline(stream, guard, createWriteStream(target, { flags: "wx", mode: 0o600 }), {
                signal: options.signal,
              })
                .then(() => done(), fail)
                .finally(() => activeStreams.delete(stream))
            }),
          )
          expandedBytes += entry.uncompressedSize
        })
        .then(() => zip.readEntry(), finish)
    })
    zip.readEntry()
  })
  return { entries, expandedBytes }
}

export async function listReverseArchiveEntries(filename: string) {
  const zip = await openZip(filename),
    entries: { path: string; directory: boolean; size: number; mode: number }[] = []
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject)
    zip.on("end", resolve)
    zip.on("entry", (entry) => {
      try {
        const directory = entry.fileName.endsWith("/"),
          name = safeReversePath(directory ? entry.fileName.slice(0, -1) : entry.fileName)
        entries.push({
          path: name,
          directory,
          size: entry.uncompressedSize,
          mode: (entry.externalFileAttributes >>> 16) & 0o777,
        })
        if (entries.length > REVERSE_ARCHIVE_LIMITS.entries)
          throw new Error("Archive entry count exceeds reverse listing limit")
        zip.readEntry()
      } catch (error) {
        zip.close()
        reject(error)
      }
    })
    zip.readEntry()
  })
  return entries
}

export async function readReverseArchivePrefix(filename: string, wantedPath: string, maxBytes = 8) {
  const zip = await openZip(filename),
    wanted = safeReversePath(wantedPath)
  let result: Buffer | undefined
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject)
    zip.on("end", resolve)
    zip.on("entry", (entry) => {
      if (entry.fileName.endsWith("/") || entry.fileName !== wanted) {
        zip.readEntry()
        return
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          reject(error ?? new Error("Unable to read archive header"))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        stream.on("data", (chunk: Buffer) => {
          const keep = Math.min(maxBytes - size, chunk.length)
          if (keep > 0) chunks.push(chunk.subarray(0, keep))
          size += keep
        })
        stream.once("error", reject)
        stream.once("end", () => {
          result = Buffer.concat(chunks)
          zip.readEntry()
        })
      })
    })
    zip.readEntry()
  })
  if (!result) throw new Error(`Archive entry not found: ${wanted}`)
  return result
}

export async function listReverseFilesOnDisk(directory: string) {
  const result: { path: string; size: number }[] = []
  const visit = async (current: string, prefix: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name,
        target = path.join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Reverse project contains symbolic link: ${relative}`)
      if (entry.isDirectory()) await visit(target, relative)
      else if (entry.isFile()) result.push({ path: relative, size: (await stat(target)).size })
    }
  }
  await visit(directory, "")
  return result.sort((a, b) => a.path.localeCompare(b.path, "en"))
}

export async function createReverseArchiveFromDirectory(
  directory: string,
  output: string,
  exclude: (relative: string) => boolean = () => false,
) {
  const files = (await listReverseFilesOnDisk(directory)).filter((file) => !exclude(file.path)),
    archive = new yazl.ZipFile()
  for (const file of files)
    archive.addFile(reverseFilePath(directory, file.path), safeReversePath(file.path), { mode: 0o600 })
  await mkdir(path.dirname(output), { recursive: true })
  const destination = createWriteStream(output, { flags: "wx", mode: 0o600 })
  let opened = false
  destination.once("open", () => {
    opened = true
  })
  try {
    const writing = pipeline(archive.outputStream, destination)
    archive.end()
    await writing
  } catch (error) {
    ;(archive.outputStream as Readable).destroy(error instanceof Error ? error : new Error(String(error)))
    if (opened) await import("node:fs/promises").then((fs) => fs.rm(output, { force: true }))
    throw error
  }
}

function stripManifestDigests(bytes: Buffer) {
  if (bytes.length > 4 * 1024 * 1024)
    throw new Error("Cannot safely remove stale digests from an oversized JAR manifest")
  let skipContinuation = false
  const lines = bytes
    .toString("utf8")
    .split(/\r?\n/)
    .filter((line) => {
      if (/^[ \t]/.test(line)) return !skipContinuation
      skipContinuation = /^[^:]+-Digest(?:-[^:]+)?\s*:/i.test(line)
      return !skipContinuation
    })
  return Buffer.from(lines.join("\r\n").replace(/\r?\n*$/, "\r\n"), "utf8")
}

export async function rewriteReverseArchive(input: {
  source: string
  destination: string
  replacements: Map<string, string | null>
  additions?: Map<string, string>
  removeSignatures?: boolean
  warningText?: string
}) {
  const zip = await openZip(input.source),
    archive = new yazl.ZipFile(),
    consumed = new Set<string>(),
    seen = new Set<string>()
  await mkdir(path.dirname(input.destination), { recursive: true })
  const destination = createWriteStream(input.destination, { flags: "wx", mode: 0o600 }),
    activeStreams = new Set<Readable>()
  let opened = false
  destination.once("open", () => {
    opened = true
  })
  const writer = pipeline(archive.outputStream, destination)
  const rewriting = new Promise<void>((resolve, reject) => {
    zip.on("error", reject)
    zip.on("end", () => {
      try {
        for (const [name, filename] of input.additions ?? []) {
          safeReversePath(name)
          if (seen.has(name.toLowerCase())) continue
          archive.addFile(filename, name, { mode: 0o600 })
        }
        if (input.removeSignatures && input.warningText)
          archive.addBuffer(Buffer.from(input.warningText, "utf8"), `META-INF/MINEMODS-UNSIGNED-${Date.now()}.txt`, {
            mode: 0o600,
          })
        archive.end()
        resolve()
      } catch (error) {
        reject(error)
      }
    })
    zip.on("entry", (entry) => {
      Promise.resolve()
        .then(async () => {
          const directory = entry.fileName.endsWith("/"),
            name = safeReversePath(directory ? entry.fileName.slice(0, -1) : entry.fileName),
            key = name.toLowerCase()
          if (seen.has(key)) throw new Error(`Duplicate archive path during rewrite: ${name}`)
          seen.add(key)
          if (directory) {
            archive.addEmptyDirectory(`${name}/`)
            return
          }
          if (input.removeSignatures && /^META-INF\/[^/]+\.(?:SF|RSA|DSA|EC)$/i.test(name)) {
            consumed.add(key)
            return
          }
          const replacement = input.replacements.get(name)
          if (replacement === null && input.replacements.has(name)) {
            consumed.add(key)
            return
          }
          if (replacement) {
            if (input.removeSignatures && /^META-INF\/MANIFEST\.MF$/i.test(name)) {
              if ((await stat(replacement)).size > 4 * 1024 * 1024)
                throw new Error("Cannot safely remove stale digests from an oversized JAR manifest")
              archive.addBuffer(
                stripManifestDigests(await import("node:fs/promises").then((fs) => fs.readFile(replacement))),
                name,
                { mode: (entry.externalFileAttributes >>> 16) & 0o777 },
              )
            } else archive.addFile(replacement, name, { mode: (entry.externalFileAttributes >>> 16) & 0o777 })
            consumed.add(key)
            return
          }
          await new Promise<void>((done, fail) =>
            zip.openReadStream(entry, (error, stream) => {
              if (error || !stream) return fail(error ?? new Error("Unable to stream archive entry"))
              activeStreams.add(stream as Readable)
              stream.once("close", () => activeStreams.delete(stream as Readable))
              if (input.removeSignatures && /^META-INF\/MANIFEST\.MF$/i.test(name)) {
                const chunks: Buffer[] = []
                let size = 0
                stream.on("data", (chunk: Buffer) => {
                  size += chunk.length
                  if (size <= 4 * 1024 * 1024) chunks.push(chunk)
                })
                stream.once("end", () => {
                  if (size > 4 * 1024 * 1024)
                    return fail(new Error("Cannot safely remove stale digests from an oversized JAR manifest"))
                  archive.addBuffer(stripManifestDigests(Buffer.concat(chunks)), name, {
                    mode: (entry.externalFileAttributes >>> 16) & 0o777,
                  })
                  done()
                })
                stream.once("error", fail)
                return
              }
              archive.addReadStream(stream, name, { mode: (entry.externalFileAttributes >>> 16) & 0o777 })
              stream.once("end", done)
              stream.once("error", fail)
            }),
          )
        })
        .then(() => zip.readEntry())
        .catch(reject)
    })
  })
  try {
    zip.readEntry()
    await Promise.all([rewriting, writer])
  } catch (error) {
    zip.close()
    activeStreams.forEach((stream) => stream.destroy(error instanceof Error ? error : new Error(String(error))))
    ;(archive.outputStream as Readable).destroy(error instanceof Error ? error : new Error(String(error)))
    await Promise.allSettled([rewriting, writer])
    if (opened) await import("node:fs/promises").then((fs) => fs.rm(input.destination, { force: true }))
    throw error
  }
  const notFound = [...input.replacements.keys()].filter(
    (name) => !consumed.has(name.toLowerCase()) && !seen.has(name.toLowerCase()),
  )
  return {
    warnings: input.removeSignatures ? ["Removed stale archive signatures after rewriting entries."] : [],
    notFound,
  }
}
