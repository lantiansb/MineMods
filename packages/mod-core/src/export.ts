import { copyFile, mkdir, readdir, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import { assembleBuildSource, verifyBuiltResult, type BuildResult } from "./build"
import { GUIDE_FILE } from "./guide"
import { withProjectLock } from "./project"

export async function exportProjectSource(projectDirectory: string, destination: string, templateDirectory: string, options: { author?: string } = {}) {
  if (!path.isAbsolute(destination)) throw new Error("ABSOLUTE_EXPORT_DESTINATION_REQUIRED")
  const target = path.join(await realpath(path.dirname(destination)), path.basename(destination))
  return withProjectLock(projectDirectory, async () => {
    // Exclusive directory creation: even a pre-existing empty directory is never reused.
    await mkdir(target)
    await assembleBuildSource(projectDirectory, target, templateDirectory, options.author ? { author: options.author } : {})
    return target
  })
}

/** What an exported jar says it needs: the game, Java, the loader and its other mods, from the build's target. Fabric's lines are as they always were. */
export function requirementLines(verified: Pick<Awaited<ReturnType<typeof verifyBuiltResult>>, "manifest" | "profile">) {
  if (verified.profile)
    return [
      `Required: Minecraft ${verified.profile.minecraft}; Java ${verified.profile.java.major}; Fabric Loader ${verified.profile.loader}; Fabric API ${verified.profile.fabricApi}; GeckoLib ${verified.profile.geckolib.version}.`,
      "Install the matching Fabric Loader and copy this mod, Fabric API and GeckoLib JARs into the installation's mods directory.",
    ]
  const manifest = verified.manifest
  const loader = manifest.loader.kind === "forge" ? "Forge" : "NeoForge"
  return [
    `Required: Minecraft ${manifest.minecraft.version}; Java ${manifest.java.major}; ${loader} ${manifest.loader.version}; GeckoLib ${manifest.dependencies.geckolib.version} (${manifest.dependencies.geckolib.coordinate.split(":")[1]}).`,
    `Install ${loader} ${manifest.loader.version} for Minecraft ${manifest.minecraft.version} and copy this mod and the GeckoLib JAR into the installation's mods directory.`,
  ]
}

export async function exportBuiltJar(projectDirectory: string, buildResult: BuildResult, destination: string) {
  if (!path.isAbsolute(destination) || !destination.toLowerCase().endsWith(".jar"))
    throw new Error("ABSOLUTE_JAR_DESTINATION_REQUIRED")
  const target = path.join(await realpath(path.dirname(destination)), path.basename(destination))
  return withProjectLock(projectDirectory, async () => {
    const verified = await verifyBuiltResult(projectDirectory, buildResult)
    await writeFile(target, verified.bytes, { flag: "wx" })
    await writeFile(
      `${target}.README.txt`,
      [
        `MineMods Studio project: ${verified.project.name}`,
        `Revision: ${verified.result.revision}; SHA-256: ${verified.result.sha256}`,
        ...requirementLines(verified),
        "This file records a verified build export. It does not claim a successful gameplay test.",
        "",
      ].join("\n"),
      { flag: "wx" },
    ).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
    })
    // The guide and the Blockbench models the build left beside its jar go along, named after the exported file so
    // they cannot be mistaken for another mod's. A build from before they existed simply has none.
    const libs = path.dirname(verified.result.jarPath)
    const stem = target.slice(0, -".jar".length)
    await copyFile(path.join(libs, GUIDE_FILE), `${stem}-${GUIDE_FILE}`).catch(() => undefined)
    const models = (await readdir(path.join(libs, "models")).catch(() => [])).filter((name) => name.endsWith(".bbmodel"))
    if (models.length) await mkdir(`${stem}-models`, { recursive: true })
    await Promise.all(models.map((name) => copyFile(path.join(libs, "models", name), path.join(`${stem}-models`, name))))
    return target
  })
}
