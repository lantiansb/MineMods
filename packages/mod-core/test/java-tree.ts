import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

/**
 * The game's own jars on Fabric 1.21.1's compile class path in Mojang's names (`fabric-1.21.1-official.txt` under MINEMODS_TARGET_CLASSPATH, the
 * list `target-javac.ts` compiles against): the common half holds `data/`, the client half `assets/`. Read only for the game's own data files
 * (JSON, pictures), which are the same whatever the names; never compiled against here. Empty where the machine has no such class path.
 */
export const MINECRAFT_JARS: readonly string[] = (() => {
  const folder = process.env.MINEMODS_TARGET_CLASSPATH
  const list = path.join(folder ?? "", "fabric-1.21.1-official.txt")
  if (!folder || !existsSync(list)) return []
  const jars = readFileSync(list, "utf8").split(/\r?\n/).filter(Boolean)
  const found = ["minecraft-common-", "minecraft-clientOnly-"].map((name) => jars.find((jar) => path.basename(jar).startsWith(name)))
  return found.every((jar): jar is string => !!jar && existsSync(jar)) ? (found as string[]) : []
})()

/** Whether the game's data files can be read on this machine. */
export const HAS_GAME_DATA = MINECRAFT_JARS.length > 0

/** The one of the game's jars that holds `data/` (recipes, tags, loot tables, world generation), for what reads a single jar of data. */
export const MINECRAFT_DATA_JAR = MINECRAFT_JARS[0] ?? ""

/** Every file name in the game's jars, `data/` and `assets/` together. Empty without them. */
export function vanillaFiles(): string[] {
  return MINECRAFT_JARS.flatMap((jar) => {
    const listing = Bun.spawnSync(["unzip", "-Z1", jar])
    return listing.exitCode === 0 ? listing.stdout.toString().split(/\r?\n/).filter(Boolean) : []
  })
}

/** One JSON file out of the game's jars. */
export function vanillaJson(file: string) {
  for (const jar of MINECRAFT_JARS) {
    const read = Bun.spawnSync(["unzip", "-p", jar, file])
    if (read.exitCode === 0) return JSON.parse(read.stdout.toString()) as unknown
  }
  throw new Error(`Not in the Minecraft jars: ${file}`)
}

/**
 * A whole generated tree compiled for one target with its real class path (`target-javac.ts`): the game named as that
 * target names it, with loader access already applied, so no stand-ins are needed. Skips (resolves null) where the
 * machine has no class path for it. With `classes` the compiled classes are kept in that folder, for a test that reads them.
 */
export async function compileTreeFor(target: string, source: string, classes?: string) {
  const { hasTargetJavac, targetJavac } = await import("./target-javac")
  if (!hasTargetJavac(target)) return null
  return targetJavac(target, path.join(source, "src", "main", "java"), classes)
}
