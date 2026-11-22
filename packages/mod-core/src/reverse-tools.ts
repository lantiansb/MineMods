import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import yauzl from "yauzl"
import { downloadVerifiedFile, runtimeDirectoryRoot, withRuntimeDirectoryLease, withRuntimeInstallLock } from "./runtime"

const tool = {
  id: "vineflower",
  version: "1.12.0",
  sha256: "1dfcfe974395734fa467ce620661c7623d05ba83670de0529b1fbd63ff548b9d",
  url: "https://repo.maven.apache.org/maven2/org/vineflower/vineflower/1.12.0/vineflower-1.12.0.jar",
}

const receipt = (directory: string) => path.join(directory, "receipt.json")
const jarName = `vineflower-${tool.version}.jar`
const timeoutMs = 600000
const maxOutputChars = 1048576
const environmentLockWaitMs = 30000

export type ReverseTools = {
  javaExecutable: string
  javacExecutable: string
  decompilerJar: string
  tool: typeof tool
}

export type ReverseProcessResult = {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

async function waitForEnvironmentLease<T>(
  runtimeRoot: string,
  operation: () => Promise<T>,
  signal?: AbortSignal,
  onWait?: () => void,
): Promise<T> {
  const deadline = Date.now() + environmentLockWaitMs
  while (true) {
    if (signal?.aborted) throw new Error("REVERSE_PROCESS_CANCELLED")
    try {
      return await withRuntimeDirectoryLease(runtimeRoot, operation)
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "ENVIRONMENT_BUSY") throw error
      if (Date.now() >= deadline) throw new Error("REVERSE_ENVIRONMENT_LOCK_TIMEOUT")
      onWait?.()
      onWait = undefined
      await new Promise<void>((resolve, reject) => {
        const finish = (callback: () => void) => {
          clearTimeout(timer)
          signal?.removeEventListener("abort", cancel)
          callback()
        }
        const timer = setTimeout(() => finish(resolve), Math.min(100, deadline - Date.now()))
        const cancel = () => {
          finish(() => reject(new Error("REVERSE_PROCESS_CANCELLED")))
        }
        signal?.addEventListener("abort", cancel, { once: true })
        if (signal?.aborted) cancel()
      })
    }
  }
}

type ReverseOptions = { signal?: AbortSignal; onLog?: (text: string) => void }

function executableName(name: "java" | "javac") {
  return process.platform === "win32" ? `${name}.exe` : name
}

function safeLog(text: string) {
  return text
    .replace(
      /^.*(?:Picked up JAVA_TOOL_OPTIONS|NOTE: Picked up JDK_JAVA_OPTIONS).*$/gm,
      "[Java environment options applied]",
    )
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[redacted]@")
}

async function rejectSymlinkAncestors(filename: string) {
  const absolute = path.resolve(filename)
  const root = path.parse(absolute).root
  let current = root
  for (const segment of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const info = await lstat(current).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
      throw error
    })
    if (info?.isSymbolicLink()) throw new Error("UNSAFE_REVERSE_PATH_ANCESTOR")
  }
}

function runProcess(command: string, args: string[], options: ReverseOptions & { cwd?: string } = {}) {
  if (options.signal?.aborted) return Promise.reject(new Error("REVERSE_PROCESS_CANCELLED"))
  return new Promise<ReverseProcessResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    })
    const output = { stdout: "", stderr: "", timedOut: false, cancelled: false, settled: false }
    const append = (key: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString("utf8")
      const current = output[key]
      if (current.length < maxOutputChars) output[key] += text.slice(0, maxOutputChars - current.length)
      if (output[key].length < maxOutputChars && text.length)
        options.onLog?.(safeLog(text.slice(0, maxOutputChars - current.length)))
    }
    const terminate = () => {
      if (!child.pid) return child.kill()
      if (process.platform === "win32") {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          shell: false,
          windowsHide: true,
          stdio: "ignore",
        })
        killer.once("error", () => child.kill())
        killer.once("close", (code) => {
          if (code !== 0) child.kill("SIGKILL")
        })
        return
      }
      void Promise.resolve()
        .then(() => process.kill(-child.pid!, "SIGKILL"))
        .catch(() => child.kill("SIGKILL"))
    }
    const cancel = () => {
      output.cancelled = true
      terminate()
    }
    const timer = setTimeout(() => {
      output.timedOut = true
      terminate()
    }, timeoutMs)
    options.signal?.addEventListener("abort", cancel, { once: true })
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk))
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk))
    child.once("error", () => {
      if (output.settled) return
      output.settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", cancel)
      reject(new Error(output.cancelled ? "REVERSE_PROCESS_CANCELLED" : "REVERSE_PROCESS_START_FAILED"))
    })
    child.once("close", (code) => {
      if (output.settled) return
      output.settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", cancel)
      if (output.cancelled) return reject(new Error("REVERSE_PROCESS_CANCELLED"))
      resolve({
        exitCode: code ?? -1,
        stdout: safeLog(output.stdout),
        stderr: safeLog(output.stderr),
        timedOut: output.timedOut,
      })
    })
    if (options.signal?.aborted) cancel()
  })
}

async function verifyJavaHome(home: string, signal?: AbortSignal) {
  const canonical = await realpath(home).catch(() => undefined)
  if (!canonical) return undefined
  const java = path.join(canonical, "bin", executableName("java"))
  const javac = path.join(canonical, "bin", executableName("javac"))
  return verifyJavaExecutables(java, javac, signal)
}

async function verifyJavaExecutables(java: string, javac: string, signal?: AbortSignal) {
  const [javaInfo, javacInfo] = await Promise.all([
    lstat(java).catch(() => undefined),
    lstat(javac).catch(() => undefined),
  ])
  if (!javaInfo?.isFile() || javaInfo.isSymbolicLink() || !javacInfo?.isFile() || javacInfo.isSymbolicLink())
    return undefined
  const [runtime, compiler] = await Promise.all([
    runProcess(java, ["-version"], { signal }),
    runProcess(javac, ["-version"], { signal }),
  ])
  if (runtime.exitCode !== 0 || compiler.exitCode !== 0) return undefined
  const javaVersion = `${runtime.stdout}\n${runtime.stderr}`.match(/version\s+"(?:1\.)?(\d+)/i)?.[1]
  const compilerVersion = `${compiler.stdout}\n${compiler.stderr}`.match(/(?:javac\s+)(?:1\.)?(\d+)/i)?.[1]
  if (!javaVersion || !compilerVersion || Number(javaVersion) < 17 || Number(compilerVersion) !== Number(javaVersion))
    return undefined
  return { javaExecutable: java, javacExecutable: javac, javaMajor: Number(javaVersion) }
}

async function findJava(runtimeDirectory: string, javaHome?: string, signal?: AbortSignal) {
  if (javaHome) {
    const found = await verifyJavaHome(javaHome, signal)
    if (found) return found
    throw new Error("JAVA_17_REQUIRED: 指定的 javaHome 必须包含版本 17 或更高且版本相同的 java 与 javac。")
  }
  const candidates = [process.env.JAVA_HOME, path.join(runtimeDirectory, "java-21")].filter(
    (candidate): candidate is string => !!candidate,
  )
  for (const candidate of candidates) {
    const found = await verifyJavaHome(candidate, signal).catch((error: unknown) => {
      if (error instanceof Error && error.message === "REVERSE_PROCESS_CANCELLED") throw error
      return undefined
    })
    if (found) return found
  }
  for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const found = await verifyJavaExecutables(
      path.join(directory, executableName("java")),
      path.join(directory, executableName("javac")),
      signal,
    ).catch((error: unknown) => {
      if (error instanceof Error && error.message === "REVERSE_PROCESS_CANCELLED") throw error
      return undefined
    })
    if (found) return found
  }
  throw new Error(
    "JAVA_17_REQUIRED: 请设置 javaHome 或 JAVA_HOME 指向包含 java 和 javac 的 JDK 17+，也可在 runtimeDirectory/java-21 安装 JDK。",
  )
}

async function requireSafeDirectory(directory: string, create: boolean) {
  if (!path.isAbsolute(directory)) throw new Error("INVALID_REVERSE_DIRECTORY")
  await rejectSymlinkAncestors(directory)
  const existing = await lstat(directory).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  })
  if (existing?.isSymbolicLink() || (existing && !existing.isDirectory())) throw new Error("UNSAFE_REVERSE_DIRECTORY")
  if (!existing && create) await mkdir(directory, { recursive: true })
  const canonical = await realpath(directory).catch(() => undefined)
  if (!canonical || canonical !== path.resolve(directory)) throw new Error("UNSAFE_REVERSE_DIRECTORY")
  if (create && (await readdir(canonical)).length !== 0) throw new Error("REVERSE_OUTPUT_DIRECTORY_NOT_EMPTY")
  return canonical
}

function archiveEntryPathIsSafe(name: string) {
  if (!name || name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[a-z]:/i.test(name)) return false
  const segments = name.replace(/\/$/, "").split("/")
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

async function validateArchive(jar: string, signal?: AbortSignal) {
  const filename = path.resolve(jar)
  const info = await lstat(filename).catch(() => undefined)
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error("INVALID_REVERSE_ARCHIVE")
  if (signal?.aborted) throw new Error("REVERSE_PROCESS_CANCELLED")
  await new Promise<void>((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, archive) => {
      if (error || !archive) return reject(new Error("INVALID_REVERSE_ARCHIVE"))
      let count = 0
      let settled = false
      const finishWithError = (message: string) => {
        if (settled) return
        settled = true
        signal?.removeEventListener("abort", cancel)
        archive.close()
        reject(new Error(message))
      }
      const cancel = () => finishWithError("REVERSE_PROCESS_CANCELLED")
      signal?.addEventListener("abort", cancel, { once: true })
      archive.on("error", () => finishWithError("INVALID_REVERSE_ARCHIVE"))
      archive.on("entry", (entry) => {
        count++
        if (
          count > 200000 ||
          !archiveEntryPathIsSafe(entry.fileName) ||
          ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
        )
          return finishWithError("UNSAFE_REVERSE_ARCHIVE_ENTRY")
        archive.readEntry()
      })
      archive.once("end", () => {
        if (settled) return
        settled = true
        signal?.removeEventListener("abort", cancel)
        resolve()
      })
      archive.readEntry()
    })
  })
  return filename
}

export async function prepareReverseTools(input: {
  runtimeDirectory: string
  javaHome?: string
  signal?: AbortSignal
  onLog?: (text: string) => void
  onLeaseWait?: () => void
  /** An explicit mirror can serve the same pinned artifact, without changing its checksum or receipt. */
  downloadMirror?: URL
}): Promise<ReverseTools> {
  if (!path.isAbsolute(input.runtimeDirectory)) throw new Error("INVALID_RUNTIME_DIRECTORY")
  if (input.signal?.aborted) throw new Error("REVERSE_PROCESS_CANCELLED")
  // A runtime directory that is there is used as the folder it resolves to, a junction to a folder included (the same rule as the storage page,
  // `runtimeDirectoryRoot`); only one that is not there yet is made, and then never through a link on the way to it.
  const existing = await runtimeDirectoryRoot(input.runtimeDirectory)
  if (!existing) await rejectSymlinkAncestors(input.runtimeDirectory)
  if (!existing) await mkdir(input.runtimeDirectory, { recursive: true })
  const runtimeRoot = existing ?? (await realpath(input.runtimeDirectory))
  const java = await findJava(runtimeRoot, input.javaHome, input.signal)
  const toolsRoot = path.join(runtimeRoot, "reverse-tools")
  const toolDirectory = path.join(toolsRoot, tool.version)
  const jar = path.join(toolDirectory, jarName)
  const cachedToolIsValid = async () => {
    const [rootInfo, directoryInfo, jarInfo, receiptInfo] = await Promise.all(
      [toolsRoot, toolDirectory, jar, receipt(toolDirectory)].map((filename) =>
        lstat(filename).catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
          throw error
        }),
      ),
    )
    if (
      !rootInfo?.isDirectory() ||
      rootInfo.isSymbolicLink() ||
      !directoryInfo?.isDirectory() ||
      directoryInfo.isSymbolicLink() ||
      !jarInfo?.isFile() ||
      jarInfo.isSymbolicLink() ||
      !receiptInfo?.isFile() ||
      receiptInfo.isSymbolicLink() ||
      receiptInfo.size > 4096
    )
      return false
    const [hash, receiptValue] = await Promise.all([
      readFile(jar)
        .then((bytes) => createHash("sha256").update(bytes).digest("hex"))
        .catch(() => undefined),
      readFile(receipt(toolDirectory), "utf8")
        .then(JSON.parse)
        .catch(() => undefined),
    ])
    return (
      hash === tool.sha256 &&
      receiptValue?.version === tool.version &&
      receiptValue?.sourceUrl === tool.url &&
      receiptValue?.sha256 === tool.sha256
    )
  }
  if (await cachedToolIsValid())
    return { javaExecutable: java.javaExecutable, javacExecutable: java.javacExecutable, decompilerJar: jar, tool }
  const install = async () => {
    for (const directory of [toolsRoot, toolDirectory]) {
      const info = await lstat(directory).catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
        throw error
      })
      if (info?.isSymbolicLink() || (info && !info.isDirectory())) throw new Error("UNSAFE_REVERSE_TOOL_DIRECTORY")
      if (!info) await mkdir(directory)
    }
    const fileInfo = await lstat(jar).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
      throw error
    })
    if (fileInfo?.isSymbolicLink() || (fileInfo && !fileInfo.isFile())) throw new Error("UNSAFE_REVERSE_TOOL_FILE")
    if (
      fileInfo &&
      createHash("sha256")
        .update(await readFile(jar))
        .digest("hex") !== tool.sha256
    )
      await rm(jar)
    const current = await lstat(jar).catch(() => undefined)
    if (!current) {
      const temporary = path.join(toolDirectory, `.vineflower-${randomUUID()}.part`)
      try {
        input.onLog?.(`正在下载并校验 Vineflower ${tool.version}。\n`)
        await downloadVerifiedFile({
          url: input.downloadMirror ? new URL(new URL(tool.url).pathname, input.downloadMirror).href : tool.url,
          sha256: tool.sha256,
          destination: temporary,
          proxyUrl: input.downloadMirror ? undefined : process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY,
          signal: input.signal,
        })
        await rename(temporary, jar)
      } catch (error) {
        await rm(temporary, { force: true })
        if (input.signal?.aborted || (error instanceof Error && error.message === "CANCELLED"))
          throw new Error("REVERSE_PROCESS_CANCELLED")
        throw new Error(`REVERSE_TOOL_DOWNLOAD_FAILED: ${(error as Error).message}`)
      }
    }
    const installedHash = createHash("sha256")
      .update(await readFile(jar))
      .digest("hex")
    if (installedHash !== tool.sha256) throw new Error("REVERSE_TOOL_CHECKSUM_MISMATCH")
    const receiptPath = receipt(toolDirectory)
    const receiptInfo = await lstat(receiptPath).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
      throw error
    })
    if (receiptInfo?.isSymbolicLink() || (receiptInfo && !receiptInfo.isFile()))
      throw new Error("UNSAFE_REVERSE_TOOL_RECEIPT")
    const oldReceipt = receiptInfo
      ? await readFile(receiptPath, "utf8")
          .then(JSON.parse)
          .catch(() => undefined)
      : undefined
    if (
      oldReceipt?.version !== tool.version ||
      oldReceipt?.sourceUrl !== tool.url ||
      oldReceipt?.sha256 !== tool.sha256
    ) {
      const receiptBytes = JSON.stringify(
        { version: tool.version, sourceUrl: tool.url, sha256: tool.sha256, installedAt: new Date().toISOString() },
        null,
        2,
      )
      const temporaryReceipt = path.join(toolDirectory, `.receipt-${randomUUID()}.tmp`)
      await writeFile(temporaryReceipt, receiptBytes, { flag: "wx", mode: 0o600 })
      await rename(temporaryReceipt, receiptPath).catch(async (error: unknown) => {
        await rm(temporaryReceipt, { force: true })
        throw error
      })
    }
  }
  await withRuntimeInstallLock(
    path.join(runtimeRoot, "reverse-tools", tool.version),
    () => waitForEnvironmentLease(runtimeRoot, install, input.signal, input.onLeaseWait),
    input.signal,
  )
  return { javaExecutable: java.javaExecutable, javacExecutable: java.javacExecutable, decompilerJar: jar, tool }
}

export async function decompileArchive(
  input: {
    jar: string
    outputDirectory: string
    tools: ReverseTools
    classpath?: string[]
  } & ReverseOptions,
): Promise<ReverseProcessResult> {
  if (input.signal?.aborted) throw new Error("REVERSE_PROCESS_CANCELLED")
  const archive = await validateArchive(input.jar, input.signal)
  const outputDirectory = await requireSafeDirectory(input.outputDirectory, true)
  const classpath = (input.classpath ?? []).flatMap((entry) => {
    if (!entry || entry.includes("\0") || /[\r\n]/.test(entry)) throw new Error("INVALID_REVERSE_CLASSPATH")
    const absolute = path.resolve(entry)
    if (absolute.includes(path.delimiter)) throw new Error("INVALID_REVERSE_CLASSPATH")
    return [`-e=${absolute}`]
  })
  return runProcess(
    input.tools.javaExecutable,
    [
      "-Xmx2G",
      "-jar",
      input.tools.decompilerJar,
      "--folder",
      "--skip-extra-files=true",
      "--thread-count=2",
      ...classpath,
      archive,
      outputDirectory,
    ],
    { cwd: outputDirectory, signal: input.signal, onLog: input.onLog },
  )
}

async function collectJavaSources(directory: string) {
  const root = await realpath(directory).catch(() => undefined)
  if (!root) throw new Error("REVERSE_SOURCE_DIRECTORY_NOT_FOUND")
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("UNSAFE_REVERSE_SOURCE_DIRECTORY")
  const files: string[] = []
  const visit = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("UNSAFE_REVERSE_SOURCE_SYMLINK")
      const filename = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(filename)
      else if (entry.isFile() && entry.name.endsWith(".java")) {
        if (filename.includes("\0") || /[\r\n]/.test(filename)) throw new Error("INVALID_REVERSE_SOURCE_PATH")
        files.push(filename)
        if (files.length > 50000) throw new Error("TOO_MANY_REVERSE_SOURCES")
      }
    }
  }
  await visit(root)
  return files.sort()
}

export async function compileReverseSources(
  input: {
    sourceDirectory: string
    outputDirectory: string
    classpath: string[]
    tools: ReverseTools
    release?: number
  } & ReverseOptions,
): Promise<ReverseProcessResult> {
  if (input.signal?.aborted) throw new Error("REVERSE_PROCESS_CANCELLED")
  const sourceDirectory = await realpath(input.sourceDirectory).catch(() => undefined)
  if (!sourceDirectory) throw new Error("REVERSE_SOURCE_DIRECTORY_NOT_FOUND")
  const sources = await collectJavaSources(sourceDirectory)
  if (!sources.length) throw new Error("REVERSE_JAVA_SOURCES_NOT_FOUND")
  const release = input.release ?? 17
  if (!Number.isInteger(release) || release < 8 || release > 99) throw new Error("INVALID_JAVA_RELEASE")
  const classpath = input.classpath.map((entry) => {
    if (!entry || entry.includes("\0") || /[\r\n]/.test(entry)) throw new Error("INVALID_REVERSE_CLASSPATH")
    const absolute = path.resolve(entry)
    if (absolute.includes(path.delimiter)) throw new Error("INVALID_REVERSE_CLASSPATH")
    return absolute
  })
  const outputDirectory = await requireSafeDirectory(input.outputDirectory, true)
  const args = ["-encoding", "UTF-8", "-proc:none", "--release", String(release), "-d", outputDirectory]
  if (classpath.length) args.push("-classpath", classpath.join(path.delimiter))
  args.push(...sources)
  const responseFile = path.join(outputDirectory, `.javac-args-${randomUUID()}.txt`)
  const escapedArgs = args.map((argument) => {
    if (argument.includes("\0") || /[\r\n]/.test(argument)) throw new Error("INVALID_JAVAC_ARGUMENT")
    return `"${argument.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
  })
  await writeFile(responseFile, `${escapedArgs.join("\n")}\n`, { flag: "wx", mode: 0o600 })
  try {
    return await runProcess(input.tools.javacExecutable, ["-J-Xmx2G", `@${responseFile}`], {
      cwd: sourceDirectory,
      signal: input.signal,
      onLog: input.onLog,
    })
  } finally {
    await rm(responseFile, { force: true })
  }
}

// Keep the checksum and download coordinates discoverable for callers and tests.
export const VineflowerTool = tool
