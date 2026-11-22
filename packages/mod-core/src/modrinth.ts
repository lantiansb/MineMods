import { randomUUID } from "node:crypto"
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
// Explicit entry bypasses Bun's partial built-in undici shim; Node/Electron use this same installed implementation.
import { Agent, ProxyAgent, request, type Dispatcher } from "undici/index.js"
import { downloadVerifiedFile, proxyJvmArgs } from "./runtime"
import { SCENE_EXTRA, sceneModFacts } from "./scene"
import { fabricModJson } from "./scene-run"
import { isModLoader, MOD_FILES, readModJar, type ModLoader } from "./mod-jar"
import { discardBody } from "./http-body"

/**
 * 预装模组 (2026-10-08): mods from Modrinth or from the person's computer, put into the project's `test-scene-mods`
 * folder, which the test scene already installs from (`deployScene`). They run beside the person's mod in the scene;
 * the mod's own code never calls them. Each one added is written down in `.minemods-mods.json` in that folder, so the
 * list can say its name and where it came from; a jar put there by hand still shows, named from its `fabric.mod.json`.
 */

export const MODRINTH_API = "https://api.modrinth.com/v2"
/** Modrinth asks every client to name itself and how to reach its makers; an anonymous agent may be turned away. */
export const MODRINTH_AGENT = "MineMods-Studio/0.1.0 (github.com/minemods)"
export const MODS_RECORD = ".minemods-mods.json"
/** One page of search results: the number the design's search card shows at once. */
export const MODRINTH_PAGE = 20
/**
 * What Studio installs into every scene by itself (`deployScene`'s pinned Fabric API and GeckoLib), by Modrinth slug and
 * by the mod id in their jars. A second copy would only race the pinned one.
 */
export const STUDIO_INSTALLS = ["fabric-api", "geckolib"] as const
/** The same for a project's loader: a Forge or NeoForge scene gets GeckoLib from Studio (`scene-target.ts`) and has no Fabric API. */
export const studioInstalls = (loader: string): readonly string[] => (loader === "fabric" ? STUDIO_INSTALLS : ["geckolib"])
/**
 * How many mods one 「加上」 may bring in, the asked-for one and its required ones together. Twelve is the design's bound
 * (2026-10-08): a content mod's required chain is a library or two; past a dozen it is a pack, not a dependency, and is
 * left for the person to add on purpose.
 */
export const MODRINTH_LIMIT = 12
/** The same size a verified download is held to (`downloadVerifiedFile`): a jar from the person's computer gets no more room. */
const JAR_LIMIT = 536870912
/**
 * The largest answer read from the API. A search page is a few kilobytes and a version list of one mod for one game
 * version and loader rarely reaches a hundred; 16 MiB is far past both and still bounds memory against a broken proxy.
 */
const JSON_LIMIT = 16 * 1024 * 1024

const LOADER_NAMES: Record<string, string> = { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", quilt: "Quilt" }
/** A loader as a player knows it by name. */
export const loaderName = (loader: string) => LOADER_NAMES[loader] ?? loader

/** What the list says about a mod that was not added: one sentence each, for the person. */
export const MOD_WORDS = {
  studio: "Studio 自己会把它装进测试场，不用另外加。",
  already: "已经加过了。",
  noVersion: (minecraft: string, loader: string) => `它没有适合 Minecraft ${minecraft} · ${loaderName(loader)} 的版本。`,
  notJar: "这不是模组的 jar 文件。",
  notLoader: (loader: string) => `它不是 ${loaderName(loader)} 模组（里面没有 ${isModLoader(loader) ? MOD_FILES[loader] : "fabric.mod.json"}），测试场用不了。`,
  tooMany: (limit: number) => `要一起加的前置模组超过 ${limit} 个，后面的没有加上；需要的话再搜着加。`,
  tooLarge: "文件太大了，不像是一个模组。",
  gone: "文件找不到了，或者不是普通文件。",
  rest: "其余的前置模组",
} as const

export type FetchJson = (url: string) => Promise<unknown>
export type ModDownload = (input: { url: string; sha1: string; destination: string; signal?: AbortSignal }) => Promise<unknown>

const ModRecordSchema = z.strictObject({
  file: z.string().min(1).max(255),
  id: z.string().max(200),
  name: z.string().max(200),
  version: z.string().max(200),
  from: z.enum(["modrinth", "file"]),
  modrinthId: z.string().max(64).optional(),
  versionId: z.string().max(64).optional(),
  required: z.boolean(),
})
const ModRecordsSchema = z.strictObject({ schema_version: z.literal(1), mods: z.array(ModRecordSchema).max(10000) })
export type ModRecord = z.infer<typeof ModRecordSchema>
/** A pre-installed mod as the window lists it (studio's `PreinstalledMod`). */
export type PreinstalledMod = Pick<ModRecord, "file" | "id" | "name" | "version" | "from" | "required">
export type ModsAdded = { added: PreinstalledMod[]; skipped: { name: string; why: string }[] }

const ModrinthIdSchema = z.string().regex(/^[A-Za-z0-9]{8}$/)
const HitSchema = z.object({
  project_id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  icon_url: z.string().nullish(),
  downloads: z.number().nonnegative(),
  author: z.string().nullish(),
})
const SearchSchema = z.object({ hits: z.array(HitSchema), total_hits: z.number().int().nonnegative() })
const ProjectSchema = z.object({ id: z.string(), slug: z.string(), title: z.string() })
const VersionSchema = z.object({
  id: z.string(),
  project_id: z.string().optional(),
  name: z.string().nullish(),
  version_number: z.string(),
  version_type: z.string(),
  date_published: z.string(),
  loaders: z.array(z.string()).optional(),
  game_versions: z.array(z.string()).optional(),
  files: z.array(
    z.object({
      url: z.string(),
      filename: z.string(),
      primary: z.boolean().optional(),
      size: z.number().optional(),
      hashes: z.object({ sha1: z.string().optional(), sha512: z.string().optional() }),
    }),
  ),
  dependencies: z.array(z.object({ project_id: z.string().nullish(), version_id: z.string().nullish(), dependency_type: z.string() })).nullish(),
})
export type ModrinthVersion = z.infer<typeof VersionSchema>

const parsed = <T>(schema: z.ZodType<T>, value: unknown) => {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error("MODRINTH_INVALID_RESPONSE")
  return result.data
}

const proxyDispatcher = (): Dispatcher => {
  const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY
  if (proxy) proxyJvmArgs({ HTTPS_PROXY: proxy })
  return proxy ? new ProxyAgent({ uri: proxy, proxyTunnel: true }) : new Agent()
}

/**
 * One GET from Modrinth, through the proxy the downloads use. Not reaching it at all, or a refusal that is not
 * "there is no such thing", is MODRINTH_UNREACHABLE: for the person both mean check the network and try again.
 */
async function modrinthGet(url: string, input: { limit: number; accept: string; timeout: number; signal?: AbortSignal; dispatcher?: Dispatcher }) {
  const dispatcher = input.dispatcher ?? proxyDispatcher()
  const timeout = AbortSignal.timeout(input.timeout)
  try {
    const response = await request(url, {
      dispatcher,
      signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
      maxRedirections: 3,
      headersTimeout: input.timeout / 2,
      bodyTimeout: input.timeout / 2,
      headers: { "User-Agent": MODRINTH_AGENT, Accept: input.accept },
    })
    if (response.statusCode < 200 || response.statusCode >= 300) {
      discardBody(response.body)
      throw response.statusCode === 404 ? new Error("MODRINTH_NOT_FOUND") : new Error("MODRINTH_UNREACHABLE", { cause: new Error(`HTTP ${response.statusCode}`) })
    }
    const chunks: Buffer[] = []
    const size = { bytes: 0 }
    for await (const chunk of response.body) {
      size.bytes += (chunk as Buffer).byteLength
      if (size.bytes > input.limit) {
        discardBody(response.body)
        throw new Error("MODRINTH_INVALID_RESPONSE")
      }
      chunks.push(chunk as Buffer)
    }
    return { bytes: Buffer.concat(chunks), type: String([response.headers["content-type"]].flat()[0] ?? "") }
  } catch (error) {
    if (input.signal?.aborted) throw new Error("CANCELLED")
    throw error instanceof Error && error.message.startsWith("MODRINTH_") ? error : new Error("MODRINTH_UNREACHABLE", { cause: error })
  } finally {
    if (!input.dispatcher) void dispatcher.destroy()
  }
}

/** One answer of the Modrinth API. A search is answered while the person waits: a minute in all, half of it at most for the first byte. */
export async function modrinthJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const { bytes } = await modrinthGet(url, { limit: JSON_LIMIT, accept: "application/json", timeout: 60_000, signal })
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown
  } catch {
    throw new Error("MODRINTH_INVALID_RESPONSE")
  }
}

/** Modrinth keeps a project's icon on its own file host; nothing else is fetched for a search result. */
const ICON_HOST = "https://cdn.modrinth.com/"
/** Modrinth refuses project icons over 256 KiB at upload, so a larger answer is not one. */
const ICON_LIMIT = 256 * 1024
const ICON_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]
/**
 * The search results' icons as data URLs: the window loads nothing from the internet (its content policy allows only
 * its own files and data URLs), so the worker fetches them. An icon is decoration: one that fails, is not an image, or
 * has not come within five seconds is left out, and the list is never held up longer than that.
 */
export async function modrinthIcons(urls: readonly (string | null)[], fetchBytes?: (url: string) => Promise<{ bytes: Buffer; type: string }>) {
  const dispatcher = fetchBytes ? undefined : (() => { try { return proxyDispatcher() } catch { return undefined } })()
  if (!fetchBytes && !dispatcher) return urls.map(() => null)
  const get = fetchBytes ?? ((url: string) => modrinthGet(url, { limit: ICON_LIMIT, accept: ICON_TYPES.join(", "), timeout: 5_000, dispatcher }))
  try {
    return await Promise.all(
      urls.map(async (url) => {
        if (!url?.startsWith(ICON_HOST)) return null
        const answer = await get(url).catch(() => null)
        const type = answer?.type.split(";")[0]!.trim().toLowerCase() ?? ""
        return answer && ICON_TYPES.includes(type) && answer.bytes.length ? `data:${type};base64,${answer.bytes.toString("base64")}` : null
      }),
    )
  } finally {
    void dispatcher?.destroy()
  }
}

export function modrinthSearchUrl(input: { query: string; minecraft: string; loader: string; offset?: number }) {
  const url = new URL(`${MODRINTH_API}/search`)
  url.searchParams.set("query", input.query.trim())
  url.searchParams.set("limit", String(MODRINTH_PAGE))
  url.searchParams.set("offset", String(input.offset ?? 0))
  url.searchParams.set("facets", JSON.stringify([["project_type:mod"], [`categories:${input.loader}`], [`versions:${input.minecraft}`]]))
  return url.href
}

/** Mods on Modrinth for one game version and loader, most relevant first, a page at a time. */
export async function searchModrinth(input: { query: string; minecraft: string; loader: string; offset?: number; fetchJson?: FetchJson }) {
  const result = parsed(SearchSchema, await (input.fetchJson ?? modrinthJson)(modrinthSearchUrl(input)))
  return {
    hits: result.hits.map((hit) => ({
      projectId: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      description: hit.description ?? "",
      icon: hit.icon_url || null,
      downloads: hit.downloads,
      author: hit.author ?? "",
    })),
    total: result.total_hits,
  }
}

const projectUrl = (id: string) => `${MODRINTH_API}/project/${ModrinthIdSchema.parse(id)}`

/** Every version of a mod Modrinth lists for this game version and loader. */
export async function modrinthVersionsFor(input: { projectId: string; minecraft: string; loader: string; fetchJson?: FetchJson }) {
  const url = new URL(`${projectUrl(input.projectId)}/version`)
  url.searchParams.set("loaders", JSON.stringify([input.loader]))
  url.searchParams.set("game_versions", JSON.stringify([input.minecraft]))
  return parsed(z.array(VersionSchema), await (input.fetchJson ?? modrinthJson)(url.href))
}

const STABILITY = ["release", "beta", "alpha"]
/**
 * The version to install: one that really is for this game version and loader and has a jar with a SHA-1 to hold it
 * to; a release before a beta before an alpha, and the newest of those. Its file is the one marked primary, else the first.
 */
export function chooseModrinthVersion(versions: readonly ModrinthVersion[], target: { minecraft: string; loader: string }) {
  const usable = versions.flatMap((version) => {
    if (version.loaders && !version.loaders.includes(target.loader)) return []
    if (version.game_versions && !version.game_versions.includes(target.minecraft)) return []
    const file = version.files.find((value) => value.primary) ?? version.files[0]
    return file && /^[a-f0-9]{40}$/.test(file.hashes.sha1 ?? "") ? [{ version, file: { ...file, sha1: file.hashes.sha1! } }] : []
  })
  const rank = (type: string) => (STABILITY.includes(type) ? STABILITY.indexOf(type) : STABILITY.length)
  return usable.sort((a, b) => rank(a.version.version_type) - rank(b.version.version_type) || Date.parse(b.version.date_published) - Date.parse(a.version.date_published))[0] ?? null
}

const UNSAFE_NAME = /[<>:"/\\|?*\x00-\x1f]/
/** A file name that is only a name: no folder, no hidden file, nothing Windows refuses, ending in .jar. */
export function isPlainJarName(name: string) {
  return name.length >= 5 && name.length <= 255 && !UNSAFE_NAME.test(name) && !name.startsWith(".") && name === path.basename(name) && /\.jar$/i.test(name)
}
/** What a file the API names is saved as: only its last part, with characters a folder cannot hold replaced. */
const savedName = (name: string) => {
  const base = path.win32.basename(path.posix.basename(name)).replace(new RegExp(UNSAFE_NAME.source, "g"), "_").replace(/^\.+/, "")
  return isPlainJarName(base) ? base : null
}

const exists = (file: string) => lstat(file).then(() => true, () => false)
const text = (value: unknown, limit = 200) => (typeof value === "string" ? value.trim().slice(0, limit) : "")

const jarNames = async (folder: string) => (await readdir(folder).catch(() => [] as string[])).filter((name) => isPlainJarName(name)).sort()

/** What was written down for the jars still in the folder: a jar the person deleted by hand takes its record with it. */
async function readRecords(folder: string): Promise<ModRecord[]> {
  const value = await readFile(path.join(folder, MODS_RECORD), "utf8").then((data) => JSON.parse(data) as unknown, () => null)
  // A record file that is broken or from elsewhere says nothing; the jars beside it still show, named from their own metadata.
  const result = ModRecordsSchema.safeParse(value)
  const present = new Set(await jarNames(folder))
  return result.success ? result.data.mods.filter((record) => present.has(record.file)) : []
}

async function writeRecords(folder: string, mods: readonly ModRecord[]) {
  const staged = path.join(folder, `${MODS_RECORD}.${randomUUID()}.tmp`)
  await writeFile(staged, `${JSON.stringify(ModRecordsSchema.parse({ schema_version: 1, mods }), null, 2)}\n`)
  await rename(staged, path.join(folder, MODS_RECORD))
}

/**
 * A jar as a mod of the project's loader: its own id, name and version and the ids it answers to; null when it is not one.
 * Fabric reads its `fabric.mod.json` as it always did; Forge and NeoForge their mods file (`mod-jar.ts`).
 */
async function modOf(file: string, loader: ModLoader) {
  if (loader !== "fabric") return readModJar(file, loader).catch(() => null)
  const metadata = await fabricModJson(file).catch(() => null)
  if (!metadata) return null
  const own = metadata as { id?: unknown; name?: unknown; version?: unknown }
  return { ...sceneModFacts(file, metadata), id: text(own.id), name: text(own.name), version: text(own.version) }
}

/** The ids every jar already in the folder answers to, so the same mod is not added twice under another file name. */
async function presentIds(folder: string, loader: ModLoader) {
  const ids = await Promise.all((await jarNames(folder)).map(async (name) => (await modOf(path.join(folder, name), loader))?.ids ?? []))
  return new Set(ids.flat())
}

const visible = (record: ModRecord): PreinstalledMod => ({ file: record.file, id: record.id, name: record.name, version: record.version, from: record.from, required: record.required })

// One change at a time per project folder: two 「加上」 at once would each write the record file from what they read before.
const queues = new Map<string, Promise<unknown>>()
function serialized<T>(directory: string, operation: () => Promise<T>) {
  const key = path.resolve(directory)
  const result = (queues.get(key) ?? Promise.resolve()).then(operation, operation)
  const settled = result.then(() => undefined, () => undefined)
  queues.set(key, settled)
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key)
  })
  return result
}

/**
 * Stages what is being added in a folder of its own inside the mods folder, and moves it in only when everything
 * asked for is there: a download that breaks off leaves nothing behind and nothing half-recorded. The staging folder's
 * name does not end in .jar, so a scene deployed meanwhile does not read it.
 */
async function staging<T>(folder: string, operation: (stage: string) => Promise<T>) {
  await mkdir(folder, { recursive: true })
  const stage = path.join(folder, `.adding-${randomUUID()}`)
  await mkdir(stage)
  try {
    return await operation(stage)
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

async function commit(folder: string, records: readonly ModRecord[], added: readonly { staged: string; record: ModRecord }[]) {
  for (const value of added) await rename(value.staged, path.join(folder, value.record.file))
  if (added.length) await writeRecords(folder, [...records, ...added.map((value) => value.record)])
  return added.map((value) => visible(value.record))
}

/**
 * Adds a mod from Modrinth and the mods it requires, each the newest fitting version, each file held to the SHA-1
 * Modrinth gives for it. Required mods are followed until `limit` are added; a mod met twice (a loop) is looked at
 * once. What Studio installs by itself (`skip`) and what is already in the folder are not added again.
 */
export async function addFromModrinth(input: {
  projectDirectory: string
  projectId: string
  minecraft: string
  loader: string
  skip: readonly string[]
  download?: ModDownload
  fetchJson?: FetchJson
  limit?: number
  signal?: AbortSignal
}): Promise<ModsAdded> {
  const loader = input.loader
  if (!isModLoader(loader)) throw new Error("MOD_LOADER_UNSUPPORTED")
  ModrinthIdSchema.parse(input.projectId)
  const fetchJson = input.fetchJson ?? ((url: string) => modrinthJson(url, input.signal))
  const limit = input.limit ?? MODRINTH_LIMIT
  const folder = path.join(input.projectDirectory, SCENE_EXTRA)
  return serialized(input.projectDirectory, () =>
    staging(folder, async (stage) => {
      const records = await readRecords(folder)
      const present = await presentIds(folder, loader)
      const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY
      // One set of connections for every file of this 「加上」; closed when it is done.
      const dispatcher = input.download ? undefined : proxy ? new ProxyAgent({ uri: proxy, proxyTunnel: true }) : new Agent()
      const download: ModDownload = input.download ?? ((value) => downloadVerifiedFile({ ...value, proxyUrl: proxy, dispatcher }))
      const added: { staged: string; record: ModRecord; ids: readonly string[] }[] = []
      const skipped: ModsAdded["skipped"] = []
      const seen = new Set<string>()
      const queue: { projectId: string; required: boolean }[] = [{ projectId: input.projectId, required: false }]
      try {
        while (queue.length) {
          const next = queue.shift()!
          if (seen.has(next.projectId)) continue
          seen.add(next.projectId)
          const project = parsed(ProjectSchema, await fetchJson(projectUrl(next.projectId)))
          seen.add(project.id)
          // A required mod that is already there is simply there; only the one the person asked for is said to be.
          const already = (why: string) => (next.required ? undefined : skipped.push({ name: project.title, why }))
          if (input.skip.includes(project.slug)) {
            skipped.push({ name: project.title, why: MOD_WORDS.studio })
            continue
          }
          if (records.some((record) => record.modrinthId === project.id)) {
            already(MOD_WORDS.already)
            continue
          }
          if (added.length >= limit) {
            skipped.push({ name: MOD_WORDS.rest, why: MOD_WORDS.tooMany(limit) })
            break
          }
          const chosen = chooseModrinthVersion(await modrinthVersionsFor({ projectId: project.id, minecraft: input.minecraft, loader: input.loader, fetchJson }), input)
          if (!chosen) {
            skipped.push({ name: project.title, why: MOD_WORDS.noVersion(input.minecraft, input.loader) })
            continue
          }
          const file = savedName(chosen.file.filename)
          if (!file) {
            skipped.push({ name: project.title, why: MOD_WORDS.notJar })
            continue
          }
          if ((await exists(path.join(folder, file))) || added.some((value) => value.record.file === file)) {
            already(MOD_WORDS.already)
            continue
          }
          const staged = path.join(stage, file)
          await download({ url: chosen.file.url, sha1: chosen.file.sha1, destination: staged, signal: input.signal }).catch((error: unknown) => {
            if (input.signal?.aborted || (error instanceof Error && error.message === "CANCELLED")) throw new Error("CANCELLED")
            throw new Error("MODRINTH_DOWNLOAD_FAILED", { cause: error })
          })
          // Read the way the project's loader reads it: a jar made for another loader is never added (one scene, one loader).
          const facts = await modOf(staged, loader)
          if (!facts) {
            skipped.push({ name: project.title, why: MOD_WORDS.notLoader(input.loader) })
            continue
          }
          if (facts.ids.some((id) => input.skip.includes(id))) {
            skipped.push({ name: project.title, why: MOD_WORDS.studio })
            continue
          }
          if (facts.ids.some((id) => present.has(id) || added.some((value) => value.ids.includes(id)))) {
            already(MOD_WORDS.already)
            continue
          }
          added.push({
            staged,
            ids: facts.ids,
            record: {
              file,
              id: facts.id || project.slug,
              name: facts.name || project.title,
              version: facts.version || chosen.version.version_number.slice(0, 200),
              from: "modrinth",
              modrinthId: project.id,
              versionId: chosen.version.id.slice(0, 64),
              required: next.required,
            },
          })
          for (const dependency of chosen.version.dependencies ?? []) {
            if (dependency.dependency_type !== "required") continue
            // Some versions name only the version they need; the mod it belongs to is asked for.
            const owner = dependency.project_id ?? (dependency.version_id && ModrinthIdSchema.safeParse(dependency.version_id).success ? parsed(VersionSchema, await fetchJson(`${MODRINTH_API}/version/${dependency.version_id}`)).project_id : undefined)
            if (owner && ModrinthIdSchema.safeParse(owner).success) queue.push({ projectId: owner, required: true })
          }
        }
        return { added: await commit(folder, records, added), skipped }
      } finally {
        void dispatcher?.destroy()
      }
    }),
  )
}

/**
 * Copies jars the person picked on their computer. Each must be a mod of the project's loader: for Fabric, a jar with
 * a `fabric.mod.json`; for Forge, `META-INF/mods.toml`; for NeoForge, `META-INF/neoforge.mods.toml`. A loader Studio
 * cannot read (Quilt) is refused as a whole.
 */
export async function addJarFiles(input: { projectDirectory: string; files: readonly string[]; loader: string; skip?: readonly string[] }): Promise<ModsAdded> {
  const loader = input.loader
  if (!isModLoader(loader)) throw new Error("MOD_LOADER_UNSUPPORTED")
  const skip = input.skip ?? studioInstalls(loader)
  const folder = path.join(input.projectDirectory, SCENE_EXTRA)
  return serialized(input.projectDirectory, () =>
    staging(folder, async (stage) => {
      const records = await readRecords(folder)
      const present = await presentIds(folder, loader)
      const added: { staged: string; record: ModRecord; ids: readonly string[] }[] = []
      const skipped: ModsAdded["skipped"] = []
      for (const source of input.files) {
        const name = path.basename(source)
        if (!/\.jar$/i.test(name)) {
          skipped.push({ name, why: MOD_WORDS.notJar })
          continue
        }
        const info = await lstat(source).catch(() => null)
        if (!info?.isFile()) {
          skipped.push({ name, why: MOD_WORDS.gone })
          continue
        }
        if (info.size > JAR_LIMIT) {
          skipped.push({ name, why: MOD_WORDS.tooLarge })
          continue
        }
        const file = savedName(name)
        if (!file) {
          skipped.push({ name, why: MOD_WORDS.notJar })
          continue
        }
        const facts = await modOf(source, loader)
        if (!facts) {
          skipped.push({ name, why: MOD_WORDS.notLoader(input.loader) })
          continue
        }
        if (facts.ids.some((id) => skip.includes(id))) {
          skipped.push({ name, why: MOD_WORDS.studio })
          continue
        }
        if ((await exists(path.join(folder, file))) || added.some((value) => value.record.file === file) || facts.ids.some((id) => present.has(id) || added.some((value) => value.ids.includes(id)))) {
          skipped.push({ name, why: MOD_WORDS.already })
          continue
        }
        const staged = path.join(stage, file)
        await copyFile(source, staged)
        added.push({ staged, ids: facts.ids, record: { file, id: facts.id, name: facts.name || facts.id || file, version: facts.version, from: "file", required: false } })
      }
      return { added: await commit(folder, records, added), skipped }
    }),
  )
}

/** The jars in the project's mods folder, with what was written down when each was added; a jar put there by hand shows too, named from its own mods file for the project's loader. */
export async function listPreinstalled(projectDirectory: string, loader = "fabric"): Promise<PreinstalledMod[]> {
  const folder = path.join(projectDirectory, SCENE_EXTRA)
  const records = await readRecords(folder)
  return Promise.all(
    (await jarNames(folder)).map(async (file) => {
      const record = records.find((value) => value.file === file)
      if (record) return visible(record)
      const own = isModLoader(loader) ? await modOf(path.join(folder, file), loader) : null
      return { file, id: own?.id ?? "", name: own?.name || own?.id || file, version: own?.version ?? "", from: "file" as const, required: false }
    }),
  )
}

/** Takes one jar out of the project's mods folder (Studio or the person put it there) and its record with it. */
export async function removePreinstalled(projectDirectory: string, file: string, loader = "fabric"): Promise<PreinstalledMod[]> {
  if (!isPlainJarName(file)) throw new Error("MOD_FILE_INVALID")
  const folder = path.join(projectDirectory, SCENE_EXTRA)
  await serialized(projectDirectory, async () => {
    const target = path.join(folder, file)
    const info = await lstat(target).catch(() => null)
    if (info?.isDirectory()) throw new Error("MOD_FILE_INVALID")
    const records = await readRecords(folder)
    if (info) await rm(target, { force: true })
    if (records.some((record) => record.file === file)) await writeRecords(folder, records.filter((record) => record.file !== file))
  })
  return listPreinstalled(projectDirectory, loader)
}
