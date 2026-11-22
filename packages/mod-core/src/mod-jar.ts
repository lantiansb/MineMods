import { readFile } from "node:fs/promises"
import { unzipSync } from "fflate"
import type { SceneModFile } from "./scene"

/**
 * What a mod jar says about itself, read the way its own loader reads it: Fabric's `fabric.mod.json`, Forge's
 * `META-INF/mods.toml`, NeoForge's `META-INF/neoforge.mods.toml`. A jar is a mod of a loader only when it carries that
 * loader's file; one made for another loader is not read as one, so a test scene never mixes loaders. Jars nested in
 * it (Fabric's `META-INF/jars`, Forge's and NeoForge's `META-INF/jarjar`) answer to their ids too.
 */

export type ModLoader = "fabric" | "forge" | "neoforge"

/** The file that makes a jar a mod of the loader. */
export const MOD_FILES: Record<ModLoader, string> = { fabric: "fabric.mod.json", forge: "META-INF/mods.toml", neoforge: "META-INF/neoforge.mods.toml" }
/** Where the loader keeps jars nested in a mod. */
const NESTED: Record<ModLoader, RegExp> = { fabric: /^META-INF\/jars\/[^/]+\.jar$/, forge: /^META-INF\/jarjar\/[^/]+\.jar$/, neoforge: /^META-INF\/jarjar\/[^/]+\.jar$/ }
/** What every game of the loader has without a jar in `mods`: the game, Java and the loader itself. */
export const MOD_GIVEN: Record<ModLoader, readonly string[]> = { fabric: ["minecraft", "java", "fabricloader"], forge: ["minecraft", "java", "forge"], neoforge: ["minecraft", "java", "neoforge"] }

export const isModLoader = (loader: string): loader is ModLoader => loader === "fabric" || loader === "forge" || loader === "neoforge"

export type ModJarFacts = SceneModFile & { id: string; name: string; version: string }

/** A TOML string value, or a bare true/false; nothing else of the language is needed for a mods file. */
const tomlValue = (raw: string): string | boolean | null => {
  const value = raw.trim()
  if (value === "true" || value === "false") return value === "true"
  const quoted = /^"((?:[^"\\]|\\.)*)"/.exec(value) ?? /^'([^']*)'/.exec(value)
  return quoted ? quoted[1]!.replace(/\\(["\\])/g, "$1") : null
}

/**
 * The tables of a mods file that say who the mod is and what it cannot start without: each `[[mods]]` with its
 * `modId`, `displayName` and `version`, each `[[dependencies.<id>]]` with its `modId` and whether it is required
 * (`mandatory = true` on Forge and older NeoForge, `type = "required"` on NeoForge 1.20.5 and later).
 */
export function readModsToml(text: string) {
  const mods: { modId: string; displayName: string; version: string }[] = []
  const dependencies: { modId: string; required: boolean }[] = []
  let table: Record<string, string | boolean> | null = null
  let kind: "mod" | "dependency" | null = null
  const close = () => {
    if (kind === "mod" && typeof table?.modId === "string") mods.push({ modId: table.modId, displayName: typeof table.displayName === "string" ? table.displayName : "", version: typeof table.version === "string" ? table.version : "" })
    if (kind === "dependency" && typeof table?.modId === "string") {
      const type = typeof table.type === "string" ? table.type.toLowerCase() : null
      dependencies.push({ modId: table.modId, required: type ? type === "required" : table.mandatory === true })
    }
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s+/, "")
    if (!line || line.startsWith("#")) continue
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?/.exec(line)
    if (header) {
      close()
      const name = header[1]!
      kind = name === "mods" ? "mod" : name.startsWith("dependencies.") ? "dependency" : null
      table = kind ? {} : null
      continue
    }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line)
    if (!pair || !table) continue
    const value = tomlValue(pair[2]!)
    if (value !== null) table[pair[1]!] = value
  }
  close()
  return { mods, dependencies }
}

/** A value the build fills in later (`${file.jarVersion}`) says nothing. */
const plain = (value: string) => (value.includes("${") ? "" : value.trim().slice(0, 200))

/** One jar's own mods file, read; null when the jar is not a mod of the loader. */
function readOwn(entries: Record<string, Uint8Array>, loader: ModLoader): Omit<ModJarFacts, "file"> | null {
  const bytes = entries[MOD_FILES[loader]]
  if (!bytes) return null
  const text = Buffer.from(bytes).toString("utf8")
  if (loader === "fabric") {
    const parsed = (() => {
      try {
        return JSON.parse(text) as { id?: unknown; name?: unknown; version?: unknown; provides?: unknown; depends?: unknown }
      } catch {
        return null
      }
    })()
    if (!parsed || typeof parsed !== "object") return null
    const id = typeof parsed.id === "string" ? parsed.id : ""
    return {
      id,
      name: typeof parsed.name === "string" ? parsed.name.trim().slice(0, 200) : "",
      version: typeof parsed.version === "string" ? plain(parsed.version) : "",
      ids: [...(id ? [id] : []), ...(Array.isArray(parsed.provides) ? parsed.provides.filter((value): value is string => typeof value === "string") : [])],
      depends: parsed.depends && typeof parsed.depends === "object" ? Object.keys(parsed.depends) : [],
    }
  }
  const toml = readModsToml(text)
  if (!toml.mods.length) return null
  const first = toml.mods[0]!
  return {
    id: first.modId,
    name: first.displayName.trim().slice(0, 200),
    version: plain(first.version),
    ids: toml.mods.map((mod) => mod.modId),
    depends: toml.dependencies.filter((dependency) => dependency.required).map((dependency) => dependency.modId),
  }
}

/**
 * What a jar is as a mod of `loader`: the ids it and the jars nested in it answer to, the ids it cannot start without
 * (less those it brings itself), and its own id, name and version. Null when it is not a mod of that loader (or not a jar).
 */
export async function readModJar(file: string, loader: ModLoader): Promise<ModJarFacts | null> {
  const nested = NESTED[loader]
  let read: Record<string, Uint8Array>
  try {
    read = unzipSync(await readFile(file), { filter: (entry) => entry.name === MOD_FILES[loader] || nested.test(entry.name) })
  } catch {
    return null
  }
  const own = readOwn(read, loader)
  if (!own) return null
  const inside = Object.entries(read)
    .filter(([name]) => name.endsWith(".jar"))
    .flatMap(([, bytes]) => {
      try {
        const inner = readOwn(unzipSync(bytes, { filter: (entry) => entry.name === MOD_FILES[loader] }), loader)
        return inner ? [inner] : []
      } catch {
        return []
      }
    })
  const ids = [...new Set([...own.ids, ...inside.flatMap((value) => value.ids)])]
  const depends = [...new Set([...own.depends, ...inside.flatMap((value) => value.depends)])].filter((id) => !ids.includes(id))
  return { file, id: own.id, name: own.name, version: own.version, ids, depends }
}

/**
 * Which of the ids the jars ask for nobody brings: the game, Java and the loader are there in every game, and each jar
 * brings the ids it answers to. Said once each, in the order they are first asked for.
 */
export function missingMods(mods: readonly Pick<SceneModFile, "ids" | "depends">[], loader: ModLoader) {
  const have = new Set([...MOD_GIVEN[loader], ...mods.flatMap((mod) => mod.ids)])
  return [...new Set(mods.flatMap((mod) => mod.depends))].filter((id) => !have.has(id))
}
