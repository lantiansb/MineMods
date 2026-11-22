import { randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

/**
 * Everything Studio downloaded or set up, in one list: what it is, where it lies, how big, where it came from, when it
 * was last used, and who needs it. The storage page reads this list; nothing in it is removed while anyone needs it,
 * and 「清理没用的」 removes exactly what nobody does. Things made before the list existed (the first JDK, the Gradle
 * cache, the Fabric test scene) are written into it where they already lie, never downloaded again.
 */

export const STORE_FOLDER = "store"
const CATALOG_FILE = "catalog.json"

export const StoreKindSchema = z.enum(["jdk", "minecraft", "libraries", "assets", "loader", "gradle", "mod", "instance", "scene", "tools"])
export type StoreKind = z.infer<typeof StoreKindSchema>

/** Who needs an item: a target (`target:forge-1.20.1`) or a project (`project:<uuid>`). */
const UserSchema = z.string().regex(/^(target:[a-z0-9.-]{1,40}|project:[0-9a-f-]{36})$/)

export const StoreItemSchema = z.strictObject({
  id: z.string().regex(/^[a-z]+:[A-Za-z0-9._+-]{1,120}$/),
  kind: StoreKindSchema,
  /** Plain words for the person, such as 「Java 17（Temurin 17.0.21+9）」. */
  title: z.string().min(1).max(120),
  /** Relative to the runtime folder; always inside it. */
  path: z.string().min(1).max(400),
  bytes: z.int().nonnegative(),
  /** Where it came from: a source name from the downloader, `kept` when it was already right, `registered` for what predates the list. */
  source: z.string().min(1).max(40),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  installed_at: z.iso.datetime(),
  last_used_at: z.iso.datetime().nullable(),
  users: z.array(UserSchema).max(1024),
})
export type StoreItem = z.infer<typeof StoreItemSchema>

const CatalogSchema = z.strictObject({ schema_version: z.literal(1), items: z.array(StoreItemSchema).max(20000) })
export type Catalog = z.infer<typeof CatalogSchema>

const empty = (): Catalog => ({ schema_version: 1, items: [] })

// One writer per runtime folder at a time inside this process; the file itself is replaced whole, never edited in place.
const queues = new Map<string, Promise<unknown>>()
function serial<T>(root: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(root) ?? Promise.resolve()
  const next = previous.then(work, work)
  queues.set(root, next.catch(() => undefined))
  return next
}

const catalogPath = (runtimeRoot: string) => path.join(runtimeRoot, STORE_FOLDER, CATALOG_FILE)

/** The list as it is on disk. A list that cannot be read is started over: everything in it can be found and registered again. */
export async function readCatalog(runtimeRoot: string): Promise<Catalog> {
  const text = await readFile(catalogPath(runtimeRoot), "utf8").catch(() => null)
  if (text === null) return empty()
  const parsed = CatalogSchema.safeParse((() => {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  })())
  return parsed.success ? parsed.data : empty()
}

async function writeCatalog(runtimeRoot: string, catalog: Catalog) {
  const file = catalogPath(runtimeRoot)
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(CatalogSchema.parse(catalog), null, 2)}\n`)
  await rename(temporary, file)
}

function update(runtimeRoot: string, change: (catalog: Catalog) => Catalog | Promise<Catalog>) {
  return serial(runtimeRoot, async () => {
    const next = await change(await readCatalog(runtimeRoot))
    await writeCatalog(runtimeRoot, next)
    return next
  })
}

/** The path inside the runtime folder, refused when it would point outside it. */
export function insideRuntime(runtimeRoot: string, relative: string) {
  const full = path.resolve(runtimeRoot, relative)
  const back = path.relative(runtimeRoot, full)
  if (!back || back.startsWith("..") || path.isAbsolute(back)) throw new Error("UNSAFE_STORE_PATH")
  return full
}

/** Adds an item, or refreshes one already listed (its users are kept). */
export function recordItem(runtimeRoot: string, item: Omit<StoreItem, "users" | "last_used_at"> & { users?: string[] }) {
  insideRuntime(runtimeRoot, item.path)
  return update(runtimeRoot, (catalog) => {
    const before = catalog.items.find((entry) => entry.id === item.id)
    const users = [...new Set([...(before?.users ?? []), ...(item.users ?? [])])]
    const next: StoreItem = { ...item, users, last_used_at: before?.last_used_at ?? null }
    return { ...catalog, items: [...catalog.items.filter((entry) => entry.id !== item.id), next].sort((a, b) => a.id.localeCompare(b.id)) }
  })
}

/** Marks an item as needed by a user, and as used now. */
export function useItem(runtimeRoot: string, id: string, user: string, now = new Date()) {
  UserSchema.parse(user)
  return update(runtimeRoot, (catalog) => ({
    ...catalog,
    items: catalog.items.map((entry) => (entry.id === id ? { ...entry, users: [...new Set([...entry.users, user])], last_used_at: now.toISOString() } : entry)),
  }))
}

/** A user no longer needs an item (a project was deleted, a target taken off a project). */
export function releaseItem(runtimeRoot: string, id: string, user: string) {
  return update(runtimeRoot, (catalog) => ({ ...catalog, items: catalog.items.map((entry) => (entry.id === id ? { ...entry, users: entry.users.filter((other) => other !== user) } : entry)) }))
}

/** Drops a user from every item, as when its project is gone. */
export function releaseUser(runtimeRoot: string, user: string) {
  return update(runtimeRoot, (catalog) => ({ ...catalog, items: catalog.items.map((entry) => ({ ...entry, users: entry.users.filter((other) => other !== user) })) }))
}

export type RemoveResult = { removed: string[]; kept: { id: string; users: string[] }[]; freedBytes: number }

/**
 * Removes the listed items (or, with no list, every item nobody needs). An item somebody needs is kept and said so;
 * removing it anyway is the person's explicit choice (`force`), and only for items that can be fetched again.
 */
export function removeItems(runtimeRoot: string, input: { ids?: string[]; force?: boolean } = {}) {
  return serial(runtimeRoot, async (): Promise<RemoveResult> => {
    const catalog = await readCatalog(runtimeRoot)
    const chosen = catalog.items.filter((entry) => (input.ids ? input.ids.includes(entry.id) : entry.users.length === 0))
    const removed: string[] = []
    const kept: RemoveResult["kept"] = []
    let freedBytes = 0
    const root = await realpath(runtimeRoot)
    for (const entry of chosen) {
      if (entry.users.length && !input.force) {
        kept.push({ id: entry.id, users: entry.users })
        continue
      }
      const target = insideRuntime(root, entry.path)
      const info = await lstat(target).catch(() => null)
      // Never follows a link out of Studio's folder: a link is removed as itself.
      if (info) await rm(target, { recursive: !info.isSymbolicLink(), force: true })
      removed.push(entry.id)
      freedBytes += entry.bytes
    }
    await writeCatalog(runtimeRoot, { ...catalog, items: catalog.items.filter((entry) => !removed.includes(entry.id)) })
    return { removed, kept, freedBytes }
  })
}

/** Size of a file or folder, not following links. */
export async function measurePath(target: string): Promise<number> {
  const info = await lstat(target).catch(() => null)
  if (!info) return 0
  if (!info.isDirectory() || info.isSymbolicLink()) return info.size
  let total = 0
  for (const entry of await readdir(target)) total += await measurePath(path.join(target, entry))
  return total
}
