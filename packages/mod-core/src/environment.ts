import { lstat, readFile, readdir, realpath, rm } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import {
  MANAGED_JAVA,
  managedJavaFolder,
  readEnvironmentUsage,
  readJavaInstallationReceipt,
  readRuntimeLeaseOwner,
  runtimeDirectoryRoot,
  withRuntimeDirectoryLease,
} from "./runtime"
import { resolveProfile } from "./fabric/profile"
import { listManagedJdks, managedJdk } from "./target/jdks"
import { readCatalog, removeItems, type StoreItem } from "./store/catalog"
import { registerEarlierThings } from "./store/layout"
import { listTargetManifests } from "./target/manifests"

const isMissing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT"
// Studio's own JDKs, one folder per major version it pins (`target/jdks.ts`).
const javaFolders = listManagedJdks().map((jdk) => managedJavaFolder(jdk.major))
const managedName = (name: string) =>
  javaFolders.includes(name) ||
  name === "gradle-home" ||
  name === "reverse-tools" ||
  /^java-download-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(name)

export type EnvironmentReference = { projectId: string; projectName?: string; environmentIds: string[] }
export type ManagedEnvironmentInput = {
  runtimeDirectory: string
  projectReferences?: EnvironmentReference[]
  inUse?: string[]
  externalJavaHome?: string
  /** The root the person picked for Studio's own JDK; its Java items are listed and deleted there instead of the runtime directory. */
  javaDirectory?: string
}

const javaItem = (name: string) => javaFolders.includes(name) || name.startsWith("java-download-")
// Which targets need a JDK folder, so it is busy while a build for one of them runs.
const javaMajorOf = (name: string) => (javaFolders.includes(name) ? Number(name.slice("java-".length)) : null)
const javaBusy = (name: string, inUse: Set<string>) => {
  const major = javaMajorOf(name)
  return major !== null && listTargetManifests().some((manifest) => inUse.has(manifest.id) && (manifest.java.major === major || manifest.java.alsoForBuild.includes(major)))
}

async function safeRoot(runtimeDirectory: string) {
  if (!path.isAbsolute(runtimeDirectory)) throw new Error("INVALID_RUNTIME_DIRECTORY")
  // A junction to a folder is that folder (r29: the runtime moved to D: and left a junction behind); the items in it are still checked one by one.
  return runtimeDirectoryRoot(runtimeDirectory)
}

export function isManagedJavaHome(runtimeRoot: string | undefined, javaHome: string) {
  return !!runtimeRoot && path.resolve(javaHome) === path.join(runtimeRoot, MANAGED_JAVA)
}

async function leaseActive(leasePath: string) {
  const owner = await readRuntimeLeaseOwner(path.dirname(leasePath))
  if (!owner) {
    const info = await lstat(leasePath).catch(() => undefined)
    return !info || Date.now() - info.mtimeMs < 30000
  }
  try {
    process.kill(owner.pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH")
  }
}

async function measure(directory: string): Promise<{ bytes: number; safe: boolean }> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) =>
    isMissing(error) ? [] : Promise.reject(error),
  )
  const measured = await Promise.all(
    entries.map(async (entry) => {
      const filename = path.join(directory, entry.name)
      const info = await lstat(filename).catch((error: unknown) =>
        isMissing(error) ? undefined : Promise.reject(error),
      )
      if (!info) return { bytes: 0, safe: true }
      if (info.isSymbolicLink()) return { bytes: info.size, safe: false }
      if (info.isDirectory()) return measure(filename)
      return { bytes: info.isFile() ? info.size : 0, safe: info.isFile() }
    }),
  )
  return {
    bytes: measured.reduce((total, entry) => total + entry.bytes, 0),
    safe: measured.every((entry) => entry.safe),
  }
}

async function reverseReceipt(directory: string) {
  const schema = z.object({
    version: z.string().max(100),
    sourceUrl: z.url().max(2000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    installedAt: z.iso.datetime(),
  })
  const entries = await readdir(directory, { withFileTypes: true })
  const receipts = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map(async (entry) => {
        const file = path.join(directory, entry.name, "receipt.json")
        const info = await lstat(file).catch((error: unknown) => (isMissing(error) ? undefined : Promise.reject(error)))
        if (!info?.isFile() || info.isSymbolicLink() || info.size > 8192) return null
        const parsed = schema.safeParse(
          await readFile(file, "utf8")
            .then(JSON.parse)
            .catch(() => null),
        )
        return parsed.success ? { ...parsed.data, distribution: "Vineflower" } : null
      }),
  )
  return (
    receipts.filter((entry) => entry !== null).sort((a, b) => b.installedAt.localeCompare(a.installedAt))[0] ?? null
  )
}

export async function listManagedEnvironment(input: ManagedEnvironmentInput) {
  const profile = resolveProfile("fabric-1.21.1")
  const runtimeRoot = await safeRoot(input.runtimeDirectory)
  const javaRoot = input.javaDirectory ? await safeRoot(input.javaDirectory) : runtimeRoot
  const apart = javaRoot !== runtimeRoot
  const inUse = new Set(input.inUse ?? [])
  const scan = async (root: string | undefined, keep: (name: string) => boolean) => {
    const leasePath = root ? path.join(root, ".environment.lock") : ""
    const hasLease =
      !!leasePath &&
      !!(await lstat(leasePath).catch((error: unknown) => (isMissing(error) ? undefined : Promise.reject(error))))
    const locked = hasLease && (await leaseActive(leasePath))
    const usage = root ? await readEnvironmentUsage(root) : null
    return root
      ? (
          await Promise.all(
            (
              await readdir(root, { withFileTypes: true }).catch((error: unknown) =>
                isMissing(error) ? [] : Promise.reject(error),
              )
            )
              .filter((entry) => managedName(entry.name) && keep(entry.name))
              .map(async (entry) => {
                const id = entry.name
                const filename = path.join(root, id)
                const info = await lstat(filename).catch((error: unknown) =>
                  isMissing(error) ? undefined : Promise.reject(error),
                )
                if (!info) return null
                const measured =
                  info.isDirectory() && !info.isSymbolicLink()
                    ? await measure(filename)
                    : { bytes: info.size, safe: false }
                const receipt =
                  javaMajorOf(id) !== null && info.isDirectory() && !info.isSymbolicLink()
                    ? await readJavaInstallationReceipt(filename)
                    : id === "reverse-tools" && measured.safe
                      ? await reverseReceipt(filename)
                      : null
                const references = (input.projectReferences ?? [])
                  .filter((reference) => reference.environmentIds.includes(id))
                  .map((reference) => reference.projectId)
                const busy = inUse.has(id) || javaBusy(id, inUse)
                return {
                  id,
                  type:
                    javaMajorOf(id) !== null
                      ? ("jdk" as const)
                      : id === "gradle-home"
                        ? ("gradle-cache" as const)
                        : id === "reverse-tools"
                          ? ("reverse-tools" as const)
                          : ("temporary-download" as const),
                  path: filename,
                  bytes: measured.bytes,
                  version: receipt?.version ?? null,
                  targetVersion:
                    javaMajorOf(id) !== null ? managedJdk(javaMajorOf(id)!).version : id === "gradle-home" ? profile.gradle.version : null,
                  distribution: receipt?.distribution ?? null,
                  sourceUrl: receipt?.sourceUrl ?? null,
                  installedAt: receipt?.installedAt ?? null,
                  sourceSha256: receipt?.sha256 ?? null,
                  lastUsedAt: id === "java-21" || id === "gradle-home" ? (usage?.last_used_at[id] ?? null) : null,
                  status: !measured.safe
                    ? ("unsafe" as const)
                    : id.startsWith("java-download-")
                      ? ("incomplete" as const)
                      : ("present" as const),
                  canDelete: measured.safe && !busy && !locked,
                  inUse: busy || locked,
                  referencedBy: references.map((projectId) => ({
                    projectId,
                    projectName:
                      input.projectReferences?.find((reference) => reference.projectId === projectId)?.projectName ??
                      null,
                  })),
                }
              }),
          )
        ).filter((item): item is NonNullable<typeof item> => item !== null)
      : []
  }
  // With a root of its own, Studio's JDK (and its unfinished downloads) are read there and only there.
  const items = [
    ...(await scan(runtimeRoot, (name) => !apart || !javaItem(name))),
    ...(apart ? await scan(javaRoot, javaItem) : []),
  ]
  const externalPath = input.externalJavaHome?.trim() || process.env.JAVA_HOME?.trim()
  const externalInfo = externalPath ? await lstat(externalPath).catch(() => undefined) : undefined
  const externalJava = externalPath
    ? {
        id: "external-java",
        type: "external-jdk" as const,
        path: externalPath,
        bytes: externalInfo?.isDirectory() && !externalInfo.isSymbolicLink() ? (await measure(externalPath)).bytes : 0,
        version: null,
        targetVersion: null,
        distribution: null,
        sourceUrl: null,
        lastUsedAt: null,
        status:
          externalInfo?.isDirectory() && !externalInfo.isSymbolicLink()
            ? ("configured" as const)
            : ("unavailable" as const),
        canDelete: false as const,
        inUse: false,
        referencedBy: [] as { projectId: string; projectName: string | null }[],
      }
    : null
  const stored = runtimeRoot ? await storeEntries(runtimeRoot, inUse, input.projectReferences ?? []) : []
  return { supportedProfiles: ["fabric-1.21.1"] as const, items: [...items, ...stored, ...(externalJava ? [externalJava] : [])] }
}

// What the asset catalogue lists beyond the folders scanned above (those keep their own receipts): game files,
// loaders, instances, the test scene. Users that are targets keep it 「使用中」 while that target runs; projects are asked about.
const scannedFolder = (relative: string) => managedName(relative.split(/[\\/]/)[0]!)
const storeBusy = (entry: StoreItem, inUse: Set<string>) => entry.users.some((user) => user.startsWith("target:") && inUse.has(user.slice("target:".length)))
async function storeEntries(runtimeRoot: string, inUse: Set<string>, references: EnvironmentReference[]) {
  if (!(await readCatalog(runtimeRoot)).items.some((entry) => entry.id === "scene:fabric-1.21.1")) await registerEarlierThings(runtimeRoot, new Date(), ["scene:fabric-1.21.1"])
  return (await readCatalog(runtimeRoot)).items
    .filter((entry) => !scannedFolder(entry.path))
    .map((entry) => {
      const busy = storeBusy(entry, inUse)
      const projects = entry.users.filter((user) => user.startsWith("project:")).map((user) => user.slice("project:".length))
      return {
        id: entry.id,
        type: "store" as const,
        title: entry.title,
        path: path.join(runtimeRoot, entry.path),
        bytes: entry.bytes,
        version: null,
        targetVersion: null,
        distribution: null,
        sourceUrl: null,
        installedAt: entry.installed_at,
        sourceSha256: entry.sha256,
        source: entry.source,
        neededBy: entry.users.filter((user) => user.startsWith("target:")).map((user) => user.slice("target:".length)),
        lastUsedAt: entry.last_used_at,
        status: "present" as const,
        canDelete: !busy,
        inUse: busy,
        referencedBy: projects.map((projectId) => ({ projectId, projectName: references.find((reference) => reference.projectId === projectId)?.projectName ?? null })),
      }
    })
}

/** 「清理没用的」: removes every catalogue item nobody needs, never while something is running. */
export async function cleanUnusedEnvironment(input: ManagedEnvironmentInput) {
  if ((input.inUse ?? []).length) throw new Error("ENVIRONMENT_IN_USE")
  const root = await safeRoot(input.runtimeDirectory)
  if (!root) return { removed: [], kept: [], freedBytes: 0 }
  return withRuntimeDirectoryLease(root, async () => {
    // What predates the catalogue (the decompiler tools above all, which no target needs) is listed first, so it is
    // cleaned like everything else; a folder a project still names is never taken, listed or not.
    await registerEarlierThings(root, new Date(), ["tools:reverse"])
    const named = new Set((input.projectReferences ?? []).flatMap((reference) => reference.environmentIds))
    const unused = (await readCatalog(root)).items.filter((entry) => entry.users.length === 0 && !named.has(entry.path.split(/[\\/]/)[0]!))
    return removeItems(root, { ids: unused.map((entry) => entry.id) })
  })
}

export async function deleteManagedEnvironment(
  input: ManagedEnvironmentInput & { id: string; confirmReferenced?: boolean },
) {
  if (input.id.includes(":")) return deleteStoreItem(input)
  if (!managedName(input.id)) throw new Error("UNSUPPORTED_ENVIRONMENT_ITEM")
  if (
    (input.inUse ?? []).includes(input.id) ||
    javaBusy(input.id, new Set(input.inUse ?? []))
  )
    throw new Error("ENVIRONMENT_IN_USE")
  const references = (input.projectReferences ?? [])
    .filter((reference) => reference.environmentIds.includes(input.id))
    .map((reference) => ({ projectId: reference.projectId, projectName: reference.projectName ?? null }))
  if (references.length && !input.confirmReferenced)
    return { deleted: false, confirmationRequired: true, impactedProjects: references }
  const root = await safeRoot(
    input.javaDirectory && javaItem(input.id) ? input.javaDirectory : input.runtimeDirectory,
  )
  if (!root) return { deleted: false, confirmationRequired: false, impactedProjects: references }
  return withRuntimeDirectoryLease(root, async () => {
    const target = path.join(root, input.id)
    if (path.dirname(target) !== root || path.basename(target) !== input.id) throw new Error("UNSAFE_ENVIRONMENT_PATH")
    const info = await lstat(target).catch((error: unknown) => (isMissing(error) ? undefined : Promise.reject(error)))
    if (!info) return { deleted: false, confirmationRequired: false, impactedProjects: references }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("UNSAFE_ENVIRONMENT_ITEM")
    const canonical = await realpath(target)
    if (canonical !== target) throw new Error("UNSAFE_ENVIRONMENT_PATH")
    if (!(await measure(target)).safe) throw new Error("UNSAFE_ENVIRONMENT_ITEM")
    await rm(target, { recursive: true, force: false })
    return { deleted: true, confirmationRequired: false, impactedProjects: references }
  })
}

async function deleteStoreItem(input: ManagedEnvironmentInput & { id: string; confirmReferenced?: boolean }) {
  const root = await safeRoot(input.runtimeDirectory)
  const entry = root ? (await readCatalog(root)).items.find((item) => item.id === input.id) : undefined
  if (!root || !entry) return { deleted: false, confirmationRequired: false, impactedProjects: [] }
  if (storeBusy(entry, new Set(input.inUse ?? []))) throw new Error("ENVIRONMENT_IN_USE")
  const impactedProjects = entry.users
    .filter((user) => user.startsWith("project:"))
    .map((user) => user.slice("project:".length))
    .map((projectId) => ({ projectId, projectName: input.projectReferences?.find((reference) => reference.projectId === projectId)?.projectName ?? null }))
  if (entry.users.length && !input.confirmReferenced) return { deleted: false, confirmationRequired: true, impactedProjects }
  // Whatever the catalogue lists can be fetched again, so the person's confirmation is enough to remove it while needed.
  const result = await withRuntimeDirectoryLease(root, () => removeItems(root, { ids: [input.id], force: true }))
  return { deleted: result.removed.includes(input.id), confirmationRequired: false, impactedProjects }
}

export async function prepareManagedEnvironment(input: {
  runtimeDirectory: string
  profileId?: string
  javaHome?: string
  /** The root Studio's own JDK is installed under and looked up in; left out, the runtime directory. */
  javaDirectory?: string
  signal?: AbortSignal
  onProgress?: (text: string) => void
}) {
  const profileId = input.profileId ?? "fabric-1.21.1"
  if (profileId !== "fabric-1.21.1") throw new Error("UNSUPPORTED_ENVIRONMENT_PROFILE")
  const profile = resolveProfile(profileId)
  const runtime = await import("./runtime")
  const javaHome = await runtime.ensureJava(input.runtimeDirectory, input)
  const root = await safeRoot(input.javaDirectory ?? input.runtimeDirectory)
  const managed = isManagedJavaHome(root, javaHome)
  if (root && managed)
    await runtime.withRuntimeDirectoryLease(root, async () => {
      await runtime.validateJava(javaHome, input).catch(() => {
        throw new Error("JAVA_RUNTIME_REMOVED_RETRY")
      })
      await runtime.recordManagedEnvironmentUse(root, [MANAGED_JAVA])
    })
  const receipt = managed ? await readJavaInstallationReceipt(javaHome) : null
  return {
    profileId,
    status: "ready" as const,
    java: {
      path: javaHome,
      version: receipt?.version ?? null,
      targetVersion: profile.java.version,
      distribution: receipt?.distribution ?? null,
      sourceUrl: receipt?.sourceUrl ?? null,
      managed,
    },
    minecraft: profile.minecraft,
    loader: { type: "fabric", version: profile.loader },
    gradle: { version: profile.gradle.version, dependencies: "download-on-build" as const },
  }
}
