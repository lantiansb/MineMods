import { createHash } from "node:crypto"
import { mkdtemp, readFile, rename, rm } from "node:fs/promises"
import path from "node:path"
import { exportBuiltJar, type BuildResult } from "@minemods/mod-core/build"
import { storagePath, type Project } from "@minemods/mod-core/project"
import { modVersion } from "@minemods/mod-core/release"

export function deliveredJarName(project: Pick<Project, "name" | "release">) {
  const name = project.name.normalize("NFC").replace(/[<>:"/\|?*\p{Cc}]/gu, "-").trim().replace(/^[. ]+|[. ]+$/g, "")
  const suffix = "-" + modVersion(project) + ".jar"
  // Leave room for the filesystem's byte limit and the exported companions' suffixes.
  const budget = 255 - Buffer.byteLength(suffix) - 32
  const letters = [...name]
  while (Buffer.byteLength(letters.join("")) > budget) letters.pop()
  const portable = letters.join("").replace(/[. ]+$/g, "") || "MineMods"
  const safe = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(portable) ? "_" + portable : portable
  return safe + suffix
}

/** The build and its record keep the Gradle name. Deliver a verified copy with its guide and models beside it. */
export async function deliverJar(projectDirectory: string, result: BuildResult, name: string) {
  const segments = ["打包产物", result.id, name]
  const target = await storagePath(projectDirectory, segments)
  const alreadyDelivered = async () => {
    const file = await storagePath(projectDirectory, segments)
    const bytes = await readFile(file).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
      throw error
    })
    if (!bytes) return false
    if (createHash("sha256").update(bytes).digest("hex") !== result.sha256)
      throw new Error("已交付的模组文件被修改过，请移走这次的打包产物文件夹后再试。")
    return true
  }
  if (await alreadyDelivered()) return target
  const parent = path.dirname(await storagePath(projectDirectory, ["打包产物", ".new"], true))
  const staging = await mkdtemp(path.join(parent, ".delivery-"))
  try {
    await exportBuiltJar(projectDirectory, result, path.join(staging, name))
    // Publishing the folder together lets a second click see the finished copy and its companions.
    await rename(staging, path.dirname(target)).catch(async (error: unknown) => {
      if (!(await alreadyDelivered())) throw error
    })
    return target
  } finally {
    if (path.dirname(staging) === parent) await rm(staging, { recursive: true, force: true })
  }
}
