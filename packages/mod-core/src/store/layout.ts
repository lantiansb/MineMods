import { lstat } from "node:fs/promises"
import path from "node:path"
import type { ManagedJdk } from "../target/jdks"
import type { TargetManifest } from "../target/manifest"
import { measurePath, recordItem, STORE_FOLDER } from "./catalog"

/**
 * Where each kind of thing lies under the runtime folder. Shared things (libraries, asset files) are kept once and
 * used by every target that needs them; an instance belongs to one project and one target.
 */
export const storeLayout = {
  jdk: (jdk: Pick<ManagedJdk, "major" | "version" | "distribution">) => path.join(STORE_FOLDER, "jdks", `${jdk.distribution}-${jdk.major}-${jdk.version.replaceAll("+", "_")}`),
  minecraft: (version: string) => path.join(STORE_FOLDER, "minecraft", "versions", version),
  libraries: () => path.join(STORE_FOLDER, "minecraft", "libraries"),
  assets: () => path.join(STORE_FOLDER, "minecraft", "assets"),
  loader: (manifest: Pick<TargetManifest, "id" | "loader">) => path.join(STORE_FOLDER, "loaders", `${manifest.id}-${manifest.loader.version}`),
  gradle: (version: string) => path.join(STORE_FOLDER, "gradle", `gradle-${version}`),
  mod: (sha256: string, name: string) => path.join(STORE_FOLDER, "mods", sha256.slice(0, 2), sha256, name),
  instance: (projectId: string, targetId: string) => path.join(STORE_FOLDER, "instances", projectId, targetId),
}

/** Catalogue ids, one per thing. */
export const storeIds = {
  jdk: (major: number) => `jdk:${major}`,
  minecraft: (version: string) => `minecraft:${version}`,
  libraries: () => "libraries:shared",
  assets: () => "assets:shared",
  loader: (manifest: Pick<TargetManifest, "id" | "loader">) => `loader:${manifest.id}-${manifest.loader.version}`,
  gradle: (version: string) => `gradle:${version}`,
  instance: (projectId: string, targetId: string) => `instance:${projectId}.${targetId}`,
}

/**
 * What Studio made before the list existed, written into it where it lies: the first JDK (`java-21`), the Gradle
 * cache (`gradle-home`), the Fabric test scene and the decompiler tools. Nothing is moved or downloaded again.
 * Returns the ids it registered.
 */
export async function registerEarlierThings(runtimeRoot: string, now = new Date(), only?: string[]) {
  const earlier: { id: string; kind: "jdk" | "gradle" | "scene" | "tools"; title: string; folder: string; users: string[] }[] = [
    { id: "jdk:21", kind: "jdk", title: "Java 21（Temurin）", folder: "java-21", users: ["target:fabric-1.21.1", "target:neoforge-1.21.1", "target:forge-1.20.1"] },
    { id: "gradle:home", kind: "gradle", title: "Gradle 缓存", folder: "gradle-home", users: ["target:fabric-1.21.1"] },
    { id: "scene:fabric-1.21.1", kind: "scene", title: "测试场游戏文件（Fabric 1.21.1）", folder: path.join("scene", "fabric-1.21.1"), users: ["target:fabric-1.21.1"] },
    { id: "tools:reverse", kind: "tools", title: "反编译工具", folder: "reverse-tools", users: [] },
  ]
  const registered: string[] = []
  for (const thing of earlier.filter((entry) => !only || only.includes(entry.id))) {
    const full = path.join(runtimeRoot, thing.folder)
    const info = await lstat(full).catch(() => null)
    if (!info?.isDirectory() || info.isSymbolicLink()) continue
    await recordItem(runtimeRoot, {
      id: thing.id,
      kind: thing.kind,
      title: thing.title,
      path: thing.folder,
      bytes: await measurePath(full),
      source: "registered",
      sha256: null,
      installed_at: (info.birthtime.getTime() ? info.birthtime : now).toISOString(),
      users: thing.users,
    })
    registered.push(thing.id)
  }
  return registered
}
