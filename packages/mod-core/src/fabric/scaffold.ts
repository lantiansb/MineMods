import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { compileContent, type Content } from "../content"
import { resolveProfile } from "./profile"
import { RELEASE_DEFAULTS, RELEASE_LICENSES, licenseNotice, type ReleaseLicense } from "../release"

const placeholder = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g
const javaReserved = new Set("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null _".split(" "))

function render(text: string, variables: Record<string, string>, json = false) {
  return text.replace(placeholder, (_, name: string) => {
    if (!Object.hasOwn(variables, name)) throw new Error(`Unknown template placeholder: ${name}`)
    return json ? JSON.stringify(variables[name]).slice(1, -1) : variables[name]
  })
}

async function writeGenerated(directory: string, name: string, contents: string | Uint8Array) {
  const target = path.resolve(directory, name)
  const containment = path.relative(directory, target)
  if (!containment || containment === ".." || containment.startsWith(`..${path.sep}`) || path.isAbsolute(containment))
    throw new Error(`Generated content path escapes destination: ${name}`)
  await mkdir(path.dirname(target), { recursive: true })
  const existing = await lstat(target).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  })
  if (!existing) {
    await writeFile(target, contents, { flag: "wx" })
    return
  }
  if (!/\/lang\/(?:en_us|zh_cn)\.json$/.test(name.replaceAll(path.sep, "/")))
    throw new Error(`Generated content path already exists: ${name}`)
  const current = JSON.parse(await readFile(target, "utf8")) as unknown
  const generated = JSON.parse(typeof contents === "string" ? contents : new TextDecoder().decode(contents)) as unknown
  if (typeof current !== "object" || current === null || Array.isArray(current) || typeof generated !== "object" || generated === null || Array.isArray(generated))
    throw new Error(`Language file must contain an object: ${name}`)
  const conflicts = Object.keys(generated).filter((key) => Object.hasOwn(current, key) && current[key as keyof typeof current] !== generated[key as keyof typeof generated])
  if (conflicts.length) throw new Error(`Language key collision in ${name}: ${conflicts.join(", ")}`)
  await writeFile(target, `${JSON.stringify({ ...current, ...generated }, null, 2)}\n`)
}

export async function copyTemplate(source: string, directory: string, variables: Record<string, string>) {
  const destination = path.resolve(directory)
  const collect = async (folder: string, relative = ""): Promise<{ source: string; target: string }[]> => {
    return (await Promise.all((await readdir(folder, { withFileTypes: true })).map(async (entry) => {
      if (entry.isSymbolicLink()) throw new Error(`Template symlinks are unsupported: ${entry.name}`)
      const name = path.join(relative, entry.name)
      if (entry.isDirectory()) return collect(path.join(folder, entry.name), name)
      if (!entry.isFile()) throw new Error(`Unsupported template entry: ${name}`)
      const target = path.resolve(destination, render(name, variables))
      const containment = path.relative(destination, target)
      if (!containment || containment === ".." || containment.startsWith(`..${path.sep}`) || path.isAbsolute(containment)) {
        throw new Error(`Template path escapes destination: ${name}`)
      }
      return [{ source: path.join(folder, entry.name), target }]
    }))).flat()
  }
  const files = await collect(source)
  if (new Set(files.map((file) => process.platform === "win32" ? file.target.toLowerCase() : file.target)).size !== files.length) {
    throw new Error("Template paths collide after substitution")
  }
  const contents = await Promise.all(files.map(async (file) => {
    const bytes = await readFile(file.source)
    // `.mcmeta` is JSON (a Forge template's pack.mcmeta); the Fabric template has none.
    const text = /\.(?:java|json|mcmeta|gradle|properties|md|txt|xml|yml|yaml|toml|bat|sh)$/.test(file.source) ||
      ["gradlew", ".gitignore", "LICENSE"].includes(path.basename(file.source))
    return { ...file, contents: text ? render(bytes.toString("utf8"), variables, /\.(?:json|mcmeta)$/.test(file.source)) : bytes }
  }))
  await Promise.all(contents.map(async (file) => {
    await mkdir(path.dirname(file.target), { recursive: true })
    await writeFile(file.target, file.contents, { flag: "wx" })
    if (path.basename(file.target) === "gradlew") await chmod(file.target, 0o755)
  }))
  return files.map((file) => file.target)
}

export type ScaffoldInput = {
  templateDirectory: string
  directory: string
  modId: string
  name: string
  packageName: string
  version?: string
  description?: string
  author?: string
  /** Absent: MIT, as every scaffold was. */
  license?: ReleaseLicense
  /** Links for fabric.mod.json's `contact`; the key is written only when there is one. */
  contact?: { homepage?: string; sources?: string; issues?: string }
  /** Path of the mod's icon inside the jar (the caller writes the file); the key is written only when given. */
  icon?: string
  profileId?: string
  content?: Content
}

/**
 * Which versions of what it is built on a generated mod accepts, as fabric.mod.json's `depends` says them
 * (Fabric Loader's version predicates; several in one string must all hold).
 * - GeckoLib: any 4.x from the one compiled against. The generated classes call only GeckoLib's public
 *   animation and renderer API, which a major version keeps; pinning the exact patch made the game refuse
 *   the mod for a player whose other mods brought a newer 4.x. A new major (5) renames that API, so it is excluded.
 * - Minecraft stays exact: the generated Java uses names of exactly this version (Mojang's official names of it), and
 *   they change between minor versions. It is the template's `{{mc_version}}`.
 * - Fabric Loader and Fabric API stay "this or newer" (the template's `>=`): both keep old entry points working.
 */
export function dependencyRanges(profile: ReturnType<typeof resolveProfile>) {
  return { geckolib: `>=${profile.geckolib.version} <${Number(profile.geckolib.version.split(".")[0]) + 1}.0.0` }
}

/** The checks every scaffold makes before it writes anything, whichever loader it is for. */
export function checkScaffoldInput(input: Pick<ScaffoldInput, "modId" | "packageName" | "name" | "version" | "templateDirectory">) {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(input.modId)) throw new Error("Invalid mod ID")
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)+$/.test(input.packageName) ||
    input.packageName.split(".").some((part) => javaReserved.has(part))) throw new Error("Invalid Java package")
  if (!input.name.trim()) throw new Error("Project name must not be empty")
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(input.version ?? RELEASE_DEFAULTS.version)) throw new Error("Invalid mod version")
  if (!path.isAbsolute(input.templateDirectory)) throw new Error("Template directory must be an explicit absolute resource path")
}

/** The mod's main class: its ID in UpperCamelCase plus `Mod` (`fire_dragon` → `FireDragonMod`). */
export const modClassName = (modId: string) => modId.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("") + "Mod"

/** The placeholders every template shares: who the mod is, not what it is built with. */
export function modPlaceholders(input: Pick<ScaffoldInput, "modId" | "name" | "packageName" | "description" | "author" | "license">) {
  return {
    mod_id: input.modId,
    ClassName: modClassName(input.modId),
    display_name: input.name,
    description: input.description ?? "A Minecraft mod created with MineMods Studio",
    author: input.author ?? RELEASE_DEFAULTS.author,
    package_name: input.packageName,
    package_path: input.packageName.replaceAll(".", "/"),
    year: String(new Date().getFullYear()),
    license: RELEASE_LICENSES[input.license ?? RELEASE_DEFAULTS.license].metadata,
  }
}

/** The placeholders `templates/fabric-1.21` is filled with. */
export function fabricPlaceholders(input: Pick<ScaffoldInput, "modId" | "name" | "packageName" | "description" | "author" | "license">, profile: ReturnType<typeof resolveProfile>) {
  const mod = modPlaceholders(input)
  return {
    mod_id: mod.mod_id,
    ClassName: mod.ClassName,
    display_name: mod.display_name,
    description: mod.description,
    author: mod.author,
    package_name: mod.package_name,
    package_path: mod.package_path,
    mc_version: profile.minecraft,
    fabric_loader_version: profile.loader,
    fabric_api_version: profile.fabricApi,
    java_version: String(profile.java.major),
    year: mod.year,
    license: mod.license,
    geckolib_range: dependencyRanges(profile).geckolib,
  }
}

/** Refuses a template whose Gradle wrapper jar is not the pinned one (every template carries the same official Gradle 8.8 wrapper jar). */
export async function checkGradleWrapper(templateDirectory: string, sha256 = resolveProfile("fabric-1.21.1").gradle.wrapper.sha256) {
  const wrapper = await readFile(path.join(templateDirectory, "gradle/wrapper/gradle-wrapper.jar"))
  if (createHash("sha256").update(wrapper).digest("hex") !== sha256) throw new Error("Gradle wrapper checksum mismatch")
}

export async function scaffoldProject(input: ScaffoldInput) {
  checkScaffoldInput(input)
  const profile = resolveProfile(input.profileId ?? "fabric-1.21.1")
  const directory = path.resolve(input.directory)
  if (existsSync(directory) && (await readdir(directory)).length) throw new Error("Target directory is not empty")
  await checkGradleWrapper(input.templateDirectory, profile.gradle.wrapper.sha256)
  const files = await copyTemplate(input.templateDirectory, directory, fabricPlaceholders(input, profile))
  // The template's LICENSE is MIT's whole text. Any other licence gets a short file that names it and says where its text is.
  if (input.license && input.license !== "MIT")
    await writeFile(path.join(directory, "LICENSE"), licenseNotice(input.license, { name: input.name, author: input.author ?? RELEASE_DEFAULTS.author, year: String(new Date().getFullYear()) }))
  const contact = Object.fromEntries(Object.entries(input.contact ?? {}).filter((entry) => entry[1]))
  if (Object.keys(contact).length || input.icon) {
    const metadataPath = path.join(directory, "src/main/resources/fabric.mod.json")
    await writeFile(metadataPath, `${JSON.stringify({ ...JSON.parse(await readFile(metadataPath, "utf8")), ...(Object.keys(contact).length ? { contact } : {}), ...(input.icon ? { icon: input.icon } : {}) }, null, 2)}\n`)
  }
  await writeFile(path.join(directory, "gradle.properties"), (await readFile(path.join(directory, "gradle.properties"), "utf8"))
    .replace("mod_version=0.1.0", `mod_version=${input.version ?? RELEASE_DEFAULTS.version}`))
  const generated = input.content
    ? compileContent({ ...input.content, mod_id: input.modId, package_name: input.packageName })
    : {}
  await Promise.all(Object.entries(generated).map(([name, contents]) => writeGenerated(directory, name, contents)))
  return { directory, files: [...new Set([...files, ...Object.keys(generated).map((name) => path.resolve(directory, name))])], profile }
}
