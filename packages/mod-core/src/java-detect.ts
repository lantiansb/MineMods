import { execFile } from "node:child_process"
import { access, lstat, readdir, realpath, statfs } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { managedJavaFolder } from "./runtime"

/** A Java found on this computer. `fits`: a JDK of the major version asked for, for this computer's processor. */
export type JavaFound = {
  home: string
  version: string
  major: number
  vendor: string
  arch: string
  jdk: boolean
  source: "chosen" | "studio" | "java_home" | "path" | "installed" | "launcher" | "registry"
  fits: boolean
  /** Why it does not fit, in plain words; null when it fits. */
  why: string | null
}

type Run = (command: string, args: string[]) => Promise<{ code: number | null; stdout: string; stderr: string }>

/** Reads `java -XshowSettings:properties -version` (printed on stderr); null when it is not that output. */
export function parseJavaProperties(output: string): { version: string; vendor: string; arch: string } | null {
  const read = (name: string) => output.match(new RegExp(`^[ \\t]*${name.replaceAll(".", "\\.")}[ \\t]*=[ \\t]*(.*?)\\s*$`, "m"))?.[1]
  const [version, vendor, arch] = [read("java.version"), read("java.vendor"), read("os.arch")]
  if (!version || !vendor || !arch || !/^\d/.test(version)) return null
  return { version, vendor, arch }
}

/** "1.8.0_402" is Java 8 (the old numbering); from 9 on the first number is the major. */
export function javaMajor(version: string): number {
  const numbers = version.match(/\d+/g)?.map(Number) ?? []
  return (numbers[0] === 1 ? numbers[1] : numbers[0]) ?? 0
}

// Java says amd64 (Windows, Linux) or x86_64 (macOS) where Node says x64, and aarch64 where Node says arm64.
const archFamily = (arch: string) =>
  ({ amd64: "x64", x86_64: "x64", x64: "x64", x86: "ia32", i386: "ia32", i486: "ia32", i586: "ia32", i686: "ia32", ia32: "ia32", aarch64: "arm64", arm64: "arm64", arm: "arm", aarch32: "arm" })[
    arch.toLowerCase()
  ] ?? arch.toLowerCase()
const archWords = (family: string) =>
  ({ x64: "64 位", ia32: "32 位", arm64: "ARM 64 位", arm: "ARM 32 位" })[family] ?? "别的处理器"

export function judgeJava(
  found: Omit<JavaFound, "fits" | "why">,
  want: { major: number; arch: string },
): { fits: boolean; why: string | null } {
  const [have, need] = [archFamily(found.arch), archFamily(want.arch)]
  const why =
    found.major !== want.major
      ? `这是 Java ${found.major}，这个版本的游戏要 Java ${want.major}。`
      : !found.jdk
        ? "只有运行环境（JRE），打包模组要完整的 JDK。"
        : have !== need
          ? `是 ${archWords(have)}的，这台电脑要 ${archWords(need)}的。`
          : null
  return { fits: why === null, why }
}

// Windows paths compare without case and either slash; trailing separators never make two homes different.
const sameHome = (a: string, b: string) => {
  const normal = (home: string) => {
    const windows = /^[a-z]:[\\/]|^\\\\/i.test(home)
    const slashed = home.replace(/[\\/]+/g, "/").replace(/(?<=.)\/$/, "")
    return windows ? slashed.toLowerCase() : slashed
  }
  return normal(a) === normal(b)
}

// "1.8.0_402" counts as 8.0.402, so it orders below every Java 9 and later.
const versionKey = (version: string) => {
  const numbers = version.match(/\d+/g)?.map(Number) ?? []
  return numbers[0] === 1 ? numbers.slice(1) : numbers
}
const newerFirst = (a: JavaFound, b: JavaFound) => {
  const [left, right] = [versionKey(a.version), versionKey(b.version)]
  for (let index = 0; index < Math.max(left.length, right.length); index++)
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (right[index] ?? 0) - (left[index] ?? 0)
  return 0
}

/** What a build uses: the chosen Java when it fits (or nothing); otherwise Studio's own, then JAVA_HOME, then the newest. */
export function pickJava(found: JavaFound[], input: { chosen: string | null }): JavaFound | null {
  if (input.chosen) return found.find((java) => java.fits && sameHome(java.home, input.chosen!)) ?? null
  const rank = (java: JavaFound) => (java.source === "studio" ? 0 : java.source === "java_home" ? 1 : 2)
  return found.filter((java) => java.fits).sort((a, b) => rank(a) - rank(b) || newerFirst(a, b))[0] ?? null
}

// A healthy JVM answers -version in well under a second; ten seconds allows a cold start on a slow disk with an antivirus scan.
const checkTimeout = 10000
// Each check starts a JVM (tens of MB and a core for a moment); four at a time keeps the computer responsive and still
// gets through a dozen candidates in a few seconds.
const checkLimit = 4
// Folder names the vendors' Windows installers use under Program Files (and %LOCALAPPDATA%\Programs for per-user installs).
const vendorFolders = ["Java", "Eclipse Adoptium", "Eclipse Foundation", "Microsoft", "Zulu", "BellSoft", "Amazon Corretto", "Semeru"]
// Registry keys the vendors' installers write; the value naming the home differs (JavaHome, Path, InstallationPath).
const registryKeys = [
  "HKLM\\SOFTWARE\\JavaSoft",
  "HKLM\\SOFTWARE\\Eclipse Adoptium",
  "HKLM\\SOFTWARE\\Eclipse Foundation",
  "HKLM\\SOFTWARE\\Azul Systems\\Zulu",
  "HKLM\\SOFTWARE\\Microsoft\\JDK",
]
const launcherPackage = "Microsoft.4297127D64EC6_8wekyb3d8bbwe"

const defaultRun: Run = (command, args) =>
  new Promise((resolve, reject) =>
    execFile(command, args, { windowsHide: true, timeout: checkTimeout, maxBuffer: 1048576, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") return reject(error)
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr })
    }),
  )

/** Reads `reg query <key> /s` output: every JavaHome, Path or InstallationPath string value. */
function registryHomes(output: string, env: (name: string) => string | undefined) {
  return [...output.matchAll(/^[ \t]+(?:JavaHome|Path|InstallationPath)[ \t]+REG_(?:EXPAND_)?SZ[ \t]+(.+?)\s*$/gim)].map((match) =>
    match[1].replace(/%([^%]+)%/g, (whole, name: string) => env(name) ?? whole),
  )
}

/**
 * Finds every Java on this computer (read-only: nothing is installed or changed), checks each by running it once, and
 * says which a build would use. A candidate that is missing, broken or silent is left out; this never throws for one.
 */
export async function detectJava(input: {
  major: number
  runtimeDirectory: string
  installDirectory?: string | null
  chosen?: string | null
  env?: Record<string, string | undefined>
  platform?: NodeJS.Platform
  arch?: string
  run?: Run
  listDirectory?: (dir: string) => Promise<string[]>
  exists?: (file: string) => Promise<boolean>
  realpath?: (file: string) => Promise<string>
}): Promise<{ found: JavaFound[]; using: JavaFound | null }> {
  const platform = input.platform ?? process.platform
  const windows = platform === "win32"
  const p = windows ? path.win32 : path.posix
  const environment = input.env ?? process.env
  // Windows variable names have no case (PATH is often "Path"); a plain record does, so it is searched that way.
  const env = (name: string) =>
    windows
      ? Object.entries(environment).find(([key, value]) => key.toUpperCase() === name.toUpperCase() && value)?.[1]
      : environment[name]
  const run = input.run ?? defaultRun
  const list = input.listDirectory ?? ((dir: string) => readdir(dir).catch(() => [] as string[]))
  const exists = input.exists ?? ((file: string) => access(file).then(() => true, () => false))
  const real = input.realpath ?? realpath
  const exe = (name: string) => (windows ? `${name}.exe` : name)
  const children = async (dir: string | undefined) =>
    dir ? (await list(dir).catch(() => [] as string[])).map((name) => p.join(dir, name)) : []

  const candidates: { home: string; source: JavaFound["source"] }[] = []
  const add = (source: JavaFound["source"], homes: (string | undefined | null)[]) =>
    homes.forEach((home) => home?.trim() && candidates.push({ home: p.resolve(home.trim()), source }))

  add("chosen", [input.chosen])
  const managed = managedJavaFolder(input.major)
  add("studio", [p.join(input.installDirectory ?? input.runtimeDirectory, managed), p.join(input.runtimeDirectory, managed)])
  add("java_home", [env("JAVA_HOME")])
  // A PATH entry is usually <home>/bin, but it may be a folder of links (Oracle's javapath, /usr/bin): the link is followed.
  const pathEntries = (env("PATH") ?? "").split(windows ? ";" : ":").map((entry) => entry.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean)
  for (const entry of pathEntries) {
    const java = p.join(entry, exe("java"))
    if (await exists(java).catch(() => false)) add("path", [p.dirname(p.dirname(await real(java).catch(() => java)))])
  }
  if (windows) {
    const local = env("LOCALAPPDATA")
    const vendorRoots = [env("ProgramFiles"), env("ProgramFiles(x86)"), local && p.join(local, "Programs")].filter((root): root is string => !!root)
    add("installed", (await Promise.all(vendorRoots.flatMap((root) => vendorFolders.map((vendor) => children(p.join(root, vendor)))))).flat())
    // The Minecraft launchers keep their own Java under runtime\<component>\windows-x64\<component>.
    const launcherRoots = [env("APPDATA") && p.join(env("APPDATA")!, ".minecraft", "runtime"), local && p.join(local, "Packages", launcherPackage, "LocalCache", "Local", "runtime")]
    const components = (await Promise.all(launcherRoots.map((root) => children(root || undefined)))).flat()
    add("launcher", (await Promise.all(components.map((component) => children(p.join(component, "windows-x64"))))).flat())
    const registry = await Promise.all(
      registryKeys.map((key) =>
        run("reg.exe", ["query", key, "/s"]).then(
          (result) => (result.code === 0 ? registryHomes(result.stdout, env) : []),
          () => [],
        ),
      ),
    )
    add("registry", registry.flat())
  } else {
    const home = env("HOME") ?? os.homedir()
    add("installed", [
      ...(await children("/usr/lib/jvm")),
      ...(await children("/Library/Java/JavaVirtualMachines")).map((bundle) => p.join(bundle, "Contents", "Home")),
      ...(home ? await children(p.join(home, ".sdkman", "candidates", "java")) : []),
    ])
  }

  // The same Java reached two ways (JAVA_HOME also on PATH, sdkman's "current" link) is one entry, under its first source.
  const seen = new Set<string>()
  const unique: typeof candidates = []
  for (const candidate of candidates) {
    const key = await real(candidate.home).catch(() => candidate.home)
    const folded = windows ? key.replace(/[\\/]+$/, "").toLowerCase() : key.replace(/(?<=.)\/+$/, "")
    if (seen.has(folded)) continue
    seen.add(folded)
    unique.push(candidate)
  }

  const want = { major: input.major, arch: input.arch ?? process.arch }
  const check = async ({ home, source }: (typeof candidates)[number]): Promise<JavaFound | null> => {
    const java = p.join(home, "bin", exe("java"))
    if (!(await exists(java).catch(() => false))) return null
    const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined }
    const result = await Promise.race([
      run(java, ["-XshowSettings:properties", "-version"]),
      new Promise<null>((resolve) => (timer.id = setTimeout(() => resolve(null), checkTimeout))),
    ])
      .catch(() => null)
      .finally(() => clearTimeout(timer.id))
    const properties = result?.code === 0 ? parseJavaProperties(`${result.stderr}\n${result.stdout}`) : null
    if (!properties) return null
    const jdk = await exists(p.join(home, "bin", exe("javac"))).catch(() => false)
    const described = { home, ...properties, major: javaMajor(properties.version), jdk, source }
    return { ...described, ...judgeJava(described, want) }
  }
  const checked: (JavaFound | null)[] = []
  for (let start = 0; start < unique.length; start += checkLimit)
    checked.push(...(await Promise.all(unique.slice(start, start + checkLimit).map(check))))
  const found = checked
    .filter((java): java is JavaFound => java !== null)
    .sort((a, b) => Number(b.fits) - Number(a.fits) || newerFirst(a, b))
  return { found, using: pickJava(found, { chosen: input.chosen ?? null }) }
}

/** Free bytes on the disk `directory` is (or would be) on; null when it cannot be read. */
export async function freeSpace(directory: string): Promise<number | null> {
  const nearest = async (candidate: string): Promise<string | null> =>
    (await lstat(candidate).catch(() => undefined))
      ? candidate
      : path.dirname(candidate) === candidate
        ? null
        : nearest(path.dirname(candidate))
  const existing = await nearest(path.resolve(directory))
  if (!existing) return null
  return statfs(existing).then(
    (info) => Number(info.bavail) * Number(info.bsize),
    () => null,
  )
}

// Lives beside the downloads it measures; kept importable from here, where the install size is told.
export { directorySize } from "./runtime"
