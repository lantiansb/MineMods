import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { recordItem } from "../store/catalog"
import { fetchVerified } from "../store/fetch"
import { extractReverseArchive } from "../reverse-archive"
import { runOwnedProcess } from "../runtime"

/**
 * Programs Studio itself looks after for its tools (工具资产), like a JDK: downloaded only when the person asks, checked against the hash its publisher states, kept in
 * the runtime's store and shown on the storage page. A tool names one as `store:<id>`. The person may instead point at a copy of their own.
 *
 * - ffmpeg: turns any audio into the game's sound (mono Ogg Vorbis) and cuts a recording into frames. The LGPL build of BtbN/FFmpeg-Builds (it has libvorbis); its
 *   release on GitHub names every file's sha256, which the download is held to. Never put into the app's own package.
 */
export const PROGRAMS = {
  ffmpeg: {
    title: "ffmpeg（声音转换、录像抽帧）",
    release: { repo: "BtbN/FFmpeg-Builds", tag: "latest", asset: "ffmpeg-n8.1-latest-win64-lgpl-8.1.zip" },
    /** The program inside the archive's one top folder, and what else of it is kept (its license). */
    exe: "bin/ffmpeg.exe",
    keep: ["LICENSE.txt"],
    license: "LGPL 2.1 或更新（BtbN/FFmpeg-Builds 的 LGPL 构建，含 libvorbis）",
  },
} as const
export type ProgramId = keyof typeof PROGRAMS

const ChoiceSchema = z.strictObject({
  /** The program's full path. */
  path: z.string().min(1).max(600),
  /** The person's own copy (true) or one Studio downloaded. */
  own: z.boolean(),
  /** The archive's sha256, for one Studio downloaded. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  at: z.iso.datetime(),
})
const ChoicesSchema = z.record(z.string(), ChoiceSchema)

const choicesPath = (runtimeRoot: string) => path.join(runtimeRoot, "store", "programs.json")
const programsFolder = (runtimeRoot: string) => path.join(runtimeRoot, "store", "programs")

async function readChoices(runtimeRoot: string) {
  const text = await readFile(choicesPath(runtimeRoot), "utf8").catch(() => null)
  if (text === null) return {}
  try {
    return ChoicesSchema.parse(JSON.parse(text))
  } catch {
    return {}
  }
}

async function writeChoices(runtimeRoot: string, choices: z.infer<typeof ChoicesSchema>) {
  const file = choicesPath(runtimeRoot)
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(choices, null, 2)}\n`)
  await rename(temporary, file)
}

/** How a program found on the machine is looked for and tried: the environment it is looked for in, and what it says it can encode (`ffmpeg -encoders`). */
export type ProgramSearch = { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; encoders?: (file: string) => Promise<string> }

const isFile = async (file: string) => Boolean((await stat(file).catch(() => null))?.isFile())
const below = async (folder: string) => (await readdir(folder, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).map((entry) => path.join(folder, entry.name))

/**
 * Where a copy the person installed themselves usually is, in order: every folder on PATH, then the places the two common Windows package managers put it — WinGet's
 * links and its Gyan.FFmpeg packages (`Packages\Gyan.FFmpeg*\ffmpeg-*\bin`), scoop's shims and its current ffmpeg. Only where the environment names a folder.
 */
export async function programCandidates(id: ProgramId, search: ProgramSearch = {}) {
  const env = search.env ?? process.env
  const windows = (search.platform ?? process.platform) === "win32"
  const exe = windows ? `${id}.exe` : id
  const local = env.LOCALAPPDATA
  const home = env.USERPROFILE ?? env.HOME
  const packages = local ? path.join(local, "Microsoft", "WinGet", "Packages") : null
  const gyan = packages ? (await below(packages)).filter((folder) => path.basename(folder).toLowerCase().startsWith("gyan.ffmpeg")) : []
  return [
    ...(env.PATH ?? env.Path ?? "").split(windows ? ";" : path.delimiter).filter(Boolean).map((folder) => path.join(folder, exe)),
    ...(local ? [path.join(local, "Microsoft", "WinGet", "Links", exe)] : []),
    ...(await Promise.all(gyan.map(below))).flat().map((folder) => path.join(folder, "bin", exe)),
    ...(home ? [path.join(home, "scoop", "shims", exe), path.join(home, "scoop", "apps", id, "current", "bin", exe)] : []),
  ]
}

// What a found copy said it can encode, by its path and when it was last changed: it is run once, not every time a sound is converted.
const tried = new Map<string, boolean>()

/**
 * A copy on the machine that turns sound into the game's (it lists the libvorbis encoder: some builds leave it out, and the sound would then not convert), or null.
 * The first that does wins; one that does not is passed over.
 */
export async function findProgram(id: ProgramId, search: ProgramSearch = {}) {
  const encoders = search.encoders ?? ((file: string) => runOwnedProcess(file, ["-hide_banner", "-encoders"], { timeoutMs: 15000 }).then((result) => result.output, () => ""))
  for (const file of await programCandidates(id, search)) {
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) continue
    const key = `${file}|${info.mtimeMs}`
    if (!tried.has(key)) tried.set(key, /\blibvorbis\b/.test(await encoders(file)))
    if (tried.get(key)) return file
  }
  return null
}

/**
 * Where a program is now: the one downloaded or pointed at on the storage page, else (ffmpeg) a copy found on the machine (`findProgram`); null when there is none
 * (or the file chosen is gone).
 */
export async function programPath(runtimeRoot: string, id: string, search: ProgramSearch = {}): Promise<string | null> {
  const choice = (await readChoices(runtimeRoot))[id]
  if (choice) return (await isFile(choice.path)) ? choice.path : null
  // MINEMODS_PROGRAM_SEARCH=off: only what the storage page holds, as before r29 (and for a test that must see the program missing on a machine that has one).
  return id in PROGRAMS && process.env.MINEMODS_PROGRAM_SEARCH !== "off" ? findProgram(id as ProgramId, search) : null
}

/** Every program Studio knows of and where it is, for the storage page. `auto`: nothing was chosen there, and the copy is one found on the machine. */
export async function programStates(runtimeRoot: string, search: ProgramSearch = {}) {
  const choices = await readChoices(runtimeRoot)
  return Promise.all(
    (Object.keys(PROGRAMS) as ProgramId[]).map(async (id) => {
      const found = await programPath(runtimeRoot, id, search)
      return { id, title: PROGRAMS[id].title, license: PROGRAMS[id].license, path: found, own: choices[id]?.own ?? false, auto: !choices[id] && found !== null }
    }),
  )
}

/** The person points at a copy of their own (checked to be there; whether it runs is checked by whoever can run it). */
export async function useOwnProgram(runtimeRoot: string, id: ProgramId, file: string) {
  if (!path.isAbsolute(file) || !(await stat(file).catch(() => null))?.isFile()) throw new Error(`找不到这个程序：${file}`)
  await writeChoices(runtimeRoot, { ...(await readChoices(runtimeRoot)), [id]: { path: file, own: true, sha256: null, at: new Date().toISOString() } })
}

/** What the publisher's release says of the archive: where it is, how big, its sha256 (GitHub's own digest of the uploaded file). */
export async function releaseAsset(id: ProgramId, fetchJson: (url: string) => Promise<unknown>) {
  const release = PROGRAMS[id].release
  const answer = z
    .looseObject({ assets: z.array(z.looseObject({ name: z.string(), size: z.int().positive(), digest: z.string().nullable().optional(), browser_download_url: z.url() })) })
    .parse(await fetchJson(`https://api.github.com/repos/${release.repo}/releases/tags/${release.tag}`))
  const asset = answer.assets.find((value) => value.name === release.asset)
  if (!asset) throw new Error(`发布页上没有 ${release.asset}`)
  const sha256 = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? "")?.[1]
  // No stated hash, no download: a file that cannot be checked is not run.
  if (!sha256) throw new Error(`发布页没有给出 ${release.asset} 的 sha256，不能下载`)
  return { url: asset.browser_download_url, size: asset.size, sha256 }
}

/**
 * Downloads the program (the person asked on the storage page), holds the archive to the sha256 its release states, keeps only the program and its license, and
 * records it in the store. The archive is removed afterwards.
 */
export async function installProgram(runtimeRoot: string, id: ProgramId, deps: { fetchJson: (url: string) => Promise<unknown>; fetch?: typeof fetchVerified; signal?: AbortSignal; onProgress?: Parameters<typeof fetchVerified>[0]["onProgress"] }) {
  const program = PROGRAMS[id]
  const asset = await releaseAsset(id, deps.fetchJson)
  const archive = path.join(runtimeRoot, "store", "downloads", program.release.asset)
  await (deps.fetch ?? fetchVerified)({ file: { url: asset.url, size: asset.size, sha256: asset.sha256 }, destination: archive, mirrors: false, signal: deps.signal, onProgress: deps.onProgress })
  const folder = path.join(programsFolder(runtimeRoot), id, asset.sha256.slice(0, 12))
  await rm(folder, { recursive: true, force: true })
  const wanted = [program.exe, ...program.keep]
  await extractReverseArchive(archive, folder, { signal: deps.signal, maxExpandedBytes: 600 * 1024 * 1024, include: (entry) => wanted.some((name) => entry === name || entry.endsWith(`/${name}`)) })
  // The archive's files sit under one top folder named as the archive, or at its root.
  const candidates = [path.join(folder, path.basename(program.release.asset, ".zip"), program.exe), path.join(folder, program.exe)]
  let found: string | null = null
  for (const candidate of candidates) if (!found && (await stat(candidate).catch(() => null))?.isFile()) found = candidate
  if (!found) throw new Error(`压缩包里没有 ${program.exe}`)
  await rm(archive, { force: true })
  const bytes = (await stat(found)).size
  const at = new Date().toISOString()
  await writeChoices(runtimeRoot, { ...(await readChoices(runtimeRoot)), [id]: { path: found, own: false, sha256: asset.sha256, at } })
  await recordItem(runtimeRoot, { id: `tools:${id}`, kind: "tools", title: program.title, path: path.relative(runtimeRoot, path.join(programsFolder(runtimeRoot), id)).replaceAll("\\", "/"), bytes, source: "github", sha256: asset.sha256, installed_at: at }).catch(() => undefined)
  return found
}
