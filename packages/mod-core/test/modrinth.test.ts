import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { zipSync } from "fflate"
import { SCENE_EXTRA } from "../src/scene"
import {
  MOD_WORDS,
  MODS_RECORD,
  STUDIO_INSTALLS,
  addFromModrinth,
  addJarFiles,
  chooseModrinthVersion,
  listPreinstalled,
  modrinthIcons,
  modrinthSearchUrl,
  removePreinstalled,
  searchModrinth,
  studioInstalls,
  type ModrinthVersion,
} from "../src/modrinth"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const project = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "modrinth-工程-"))
  roots.push(root)
  return root
}

/** A jar: a zip with a `fabric.mod.json`, or with none when `metadata` is null. */
const jar = (metadata: Record<string, unknown> | null) =>
  Buffer.from(zipSync(metadata ? { "fabric.mod.json": new TextEncoder().encode(JSON.stringify(metadata)) } : { "META-INF/MANIFEST.MF": new TextEncoder().encode("Manifest-Version: 1.0\n") }))
const sha1 = (bytes: Buffer) => createHash("sha1").update(bytes).digest("hex")

const version = (input: Partial<ModrinthVersion> & { id: string; jar: Buffer; filename: string; requires?: string[] }): ModrinthVersion => ({
  version_number: input.id,
  version_type: "release",
  date_published: "2026-01-01T00:00:00Z",
  loaders: ["fabric"],
  game_versions: ["1.21.1"],
  ...input,
  files: [{ url: `https://cdn.modrinth.com/data/${input.id}/${input.filename}`, filename: input.filename, primary: true, size: input.jar.length, hashes: { sha1: sha1(input.jar) } }],
  dependencies: (input.requires ?? []).map((id) => ({ project_id: id, version_id: null, dependency_type: "required" })),
})

/** A fake Modrinth: projects by id, each with its versions, and the jars their files are. */
function modrinth(projects: { id: string; slug: string; title: string; versions: ReturnType<typeof version>[] }[], jars: Record<string, Buffer>) {
  const asked: string[] = []
  const fetchJson = async (url: string) => {
    asked.push(url)
    const address = new URL(url)
    const [, , kind, id, rest] = address.pathname.split("/")
    const found = projects.find((value) => value.id === id || value.slug === id)
    if (kind !== "project" || !found) throw new Error("MODRINTH_NOT_FOUND")
    if (rest === "version") {
      expect(address.searchParams.get("loaders")).toBe('["fabric"]')
      expect(address.searchParams.get("game_versions")).toBe('["1.21.1"]')
      return found.versions
    }
    return { id: found.id, slug: found.slug, title: found.title }
  }
  const downloads: { url: string; sha1: string }[] = []
  const download = async (input: { url: string; sha1: string; destination: string }) => {
    downloads.push({ url: input.url, sha1: input.sha1 })
    const bytes = jars[input.url]!
    expect(sha1(bytes)).toBe(input.sha1)
    await writeFile(input.destination, bytes, { flag: "wx" })
    return input.destination
  }
  return { fetchJson, download, asked, downloads }
}

test("预装模组：在 Modrinth 搜索时只问这个游戏版本和加载器的模组，结果说成窗口要的样子", async () => {
  const url = new URL(modrinthSearchUrl({ query: "  地图 ", minecraft: "1.21.1", loader: "fabric", offset: 40 }))
  expect(url.origin + url.pathname).toBe("https://api.modrinth.com/v2/search")
  expect(url.searchParams.get("query")).toBe("地图")
  expect(url.searchParams.get("limit")).toBe("20")
  expect(url.searchParams.get("offset")).toBe("40")
  expect(JSON.parse(url.searchParams.get("facets")!)).toEqual([["project_type:mod"], ["categories:fabric"], ["versions:1.21.1"]])
  const result = await searchModrinth({
    query: "map",
    minecraft: "1.21.1",
    loader: "fabric",
    fetchJson: async () => ({ hits: [{ project_id: "AANobbMI", slug: "sodium", title: "Sodium", description: "fast", icon_url: "", downloads: 5, author: "jelly", extra: 1 }], total_hits: 1 }),
  })
  expect(result).toEqual({ hits: [{ projectId: "AANobbMI", slug: "sodium", title: "Sodium", description: "fast", icon: null, downloads: 5, author: "jelly" }], total: 1 })
  await expect(searchModrinth({ query: "x", minecraft: "1.21.1", loader: "fabric", fetchJson: async () => ({ nothing: true }) })).rejects.toThrow("MODRINTH_INVALID_RESPONSE")
})

test("预装模组：搜索结果的图标由后台取来变成 data URL；不是 Modrinth 的、不是图片的、取不到的就不显示", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const asked: string[] = []
  const icons = await modrinthIcons(
    ["https://cdn.modrinth.com/data/A/icon.png", "https://evil.example/icon.png", null, "https://cdn.modrinth.com/data/B/page", "https://cdn.modrinth.com/data/C/broken.png"],
    async (url) => {
      asked.push(url)
      if (url.endsWith("broken.png")) throw new Error("MODRINTH_UNREACHABLE")
      return url.endsWith("page") ? { bytes: Buffer.from("<html>"), type: "text/html" } : { bytes: png, type: "image/png; charset=binary" }
    },
  )
  expect(icons).toEqual([`data:image/png;base64,${png.toString("base64")}`, null, null, null, null])
  expect(asked).not.toContain("https://evil.example/icon.png")
})

test("预装模组：装正式版而不是测试版，同一类里装最新的；没有能校验的 jar 的版本不算", () => {
  const file = (hash?: string) => [{ url: "https://cdn.modrinth.com/x.jar", filename: "x.jar", primary: true, hashes: hash ? { sha1: hash } : {} }]
  const base = { version_number: "1", loaders: ["fabric"], game_versions: ["1.21.1"], dependencies: [] }
  const versions: ModrinthVersion[] = [
    { ...base, id: "beta-new", version_type: "beta", date_published: "2026-09-01T00:00:00Z", files: file("a".repeat(40)) },
    { ...base, id: "release-old", version_type: "release", date_published: "2026-01-01T00:00:00Z", files: file("b".repeat(40)) },
    { ...base, id: "release-new", version_type: "release", date_published: "2026-05-01T00:00:00Z", files: file("c".repeat(40)) },
    { ...base, id: "release-newest-unhashed", version_type: "release", date_published: "2026-08-01T00:00:00Z", files: file() },
    { ...base, id: "release-other-game", version_type: "release", date_published: "2026-10-01T00:00:00Z", game_versions: ["1.20.1"], files: file("d".repeat(40)) },
  ]
  expect(chooseModrinthVersion(versions, { minecraft: "1.21.1", loader: "fabric" })?.version.id).toBe("release-new")
  expect(chooseModrinthVersion(versions.filter((value) => value.version_type === "beta"), { minecraft: "1.21.1", loader: "fabric" })?.version.id).toBe("beta-new")
  expect(chooseModrinthVersion([], { minecraft: "1.21.1", loader: "fabric" })).toBeNull()
})

test("预装模组：必需的前置一起加上，绕成圈的只看一次，有上限；Studio 自己装的不重复加；每个文件都按 SHA-1 校验并记下来", async () => {
  const directory = await project()
  const jars = {
    a: jar({ id: "alpha", name: "Alpha 模组", version: "1.2.0" }),
    b: jar({ id: "beta_lib", name: "Beta Lib", version: "3.0" }),
    c: jar({ id: "gamma", version: "0.1" }),
    d: jar({ id: "delta" }),
    e: jar({ id: "epsilon" }),
    geo: jar({ id: "geckolib" }),
  }
  const projects = [
    { id: "AAAAAAAA", slug: "alpha", title: "Alpha", versions: [version({ id: "VAAAAAAA", jar: jars.a, filename: "alpha-1.2.0.jar", requires: ["BBBBBBBB", "P7dR8mSH"] })] },
    // B needs A back (a loop), C, and a renamed GeckoLib whose jar says what it is.
    { id: "BBBBBBBB", slug: "beta-lib", title: "Beta Lib", versions: [version({ id: "VBBBBBBB", jar: jars.b, filename: "../beta lib?.jar", requires: ["AAAAAAAA", "CCCCCCCC", "GGGGGGGG"] })] },
    { id: "CCCCCCCC", slug: "gamma", title: "Gamma", versions: [version({ id: "VCCCCCCC", jar: jars.c, filename: "gamma.jar", requires: ["DDDDDDDD"] })] },
    { id: "DDDDDDDD", slug: "delta", title: "Delta", versions: [version({ id: "VDDDDDDD", jar: jars.d, filename: "delta.jar", requires: ["EEEEEEEE"] })] },
    { id: "EEEEEEEE", slug: "epsilon", title: "Epsilon", versions: [version({ id: "VEEEEEEE", jar: jars.e, filename: "epsilon.jar" })] },
    { id: "P7dR8mSH", slug: "fabric-api", title: "Fabric API", versions: [] },
    { id: "GGGGGGGG", slug: "geo-renamed", title: "Geo", versions: [version({ id: "VGGGGGGG", jar: jars.geo, filename: "geo.jar" })] },
  ]
  const files = Object.fromEntries(projects.flatMap((value) => value.versions.map((entry) => [entry.files[0]!.url, Object.values(jars).find((bytes) => sha1(bytes) === entry.files[0]!.hashes.sha1)!])))
  const fake = modrinth(projects, files)
  const result = await addFromModrinth({ projectDirectory: directory, projectId: "AAAAAAAA", minecraft: "1.21.1", loader: "fabric", skip: STUDIO_INSTALLS, fetchJson: fake.fetchJson, download: fake.download, limit: 4 })
  expect(result.added).toEqual([
    { file: "alpha-1.2.0.jar", id: "alpha", name: "Alpha 模组", version: "1.2.0", from: "modrinth", required: false },
    // A name from the server is only ever a file name in the folder.
    { file: "beta lib_.jar", id: "beta_lib", name: "Beta Lib", version: "3.0", from: "modrinth", required: true },
    // No name in its own metadata: the name Modrinth gives.
    { file: "gamma.jar", id: "gamma", name: "Gamma", version: "0.1", from: "modrinth", required: true },
    { file: "delta.jar", id: "delta", name: "Delta", version: "VDDDDDDD", from: "modrinth", required: true },
  ])
  expect(result.skipped).toEqual([
    { name: "Fabric API", why: MOD_WORDS.studio },
    { name: "Geo", why: MOD_WORDS.studio },
    { name: MOD_WORDS.rest, why: MOD_WORDS.tooMany(4) },
  ])
  // The loop back to A was not asked about twice.
  expect(fake.asked.filter((url) => url.endsWith("/project/AAAAAAAA"))).toHaveLength(1)
  expect(fake.downloads.map((value) => value.sha1)).toEqual([sha1(jars.a), sha1(jars.b), sha1(jars.c), sha1(jars.geo), sha1(jars.d)])
  const folder = path.join(directory, SCENE_EXTRA)
  expect((await readdir(folder)).sort()).toEqual([MODS_RECORD, "beta lib_.jar", "alpha-1.2.0.jar", "delta.jar", "gamma.jar"].sort())
  const records = JSON.parse(await readFile(path.join(folder, MODS_RECORD), "utf8"))
  expect(records.mods[0]).toEqual({ file: "alpha-1.2.0.jar", id: "alpha", name: "Alpha 模组", version: "1.2.0", from: "modrinth", modrinthId: "AAAAAAAA", versionId: "VAAAAAAA", required: false })

  // Asked again: already there, nothing downloaded.
  const again = await addFromModrinth({ projectDirectory: directory, projectId: "AAAAAAAA", minecraft: "1.21.1", loader: "fabric", skip: STUDIO_INSTALLS, fetchJson: fake.fetchJson, download: fake.download })
  expect(again).toEqual({ added: [], skipped: [{ name: "Alpha", why: MOD_WORDS.already }] })
  expect(fake.downloads).toHaveLength(5)

  // A jar put there by hand shows too, named from its own metadata; removing takes the jar and its record.
  await writeFile(path.join(folder, "hand.jar"), jar({ id: "hand", name: "手放的", version: "9" }))
  expect((await listPreinstalled(directory)).map((value) => [value.file, value.name, value.from])).toEqual([
    ["alpha-1.2.0.jar", "Alpha 模组", "modrinth"],
    ["beta lib_.jar", "Beta Lib", "modrinth"],
    ["delta.jar", "Delta", "modrinth"],
    ["gamma.jar", "Gamma", "modrinth"],
    ["hand.jar", "手放的", "file"],
  ])
  const left = await removePreinstalled(directory, "alpha-1.2.0.jar")
  expect(left.map((value) => value.file)).toEqual(["beta lib_.jar", "delta.jar", "gamma.jar", "hand.jar"])
  expect(JSON.parse(await readFile(path.join(folder, MODS_RECORD), "utf8")).mods.map((value: { file: string }) => value.file)).toEqual(["beta lib_.jar", "gamma.jar", "delta.jar"])
  // A jar deleted by hand is not 「已经加过了」: asked again, it comes back.
  await rm(path.join(folder, "gamma.jar"))
  expect((await addFromModrinth({ projectDirectory: directory, projectId: "CCCCCCCC", minecraft: "1.21.1", loader: "fabric", skip: STUDIO_INSTALLS, fetchJson: fake.fetchJson, download: fake.download })).added.map((value) => value.file)).toEqual(["gamma.jar"])
  for (const name of ["../alpha.jar", "sub/x.jar", "..\\x.jar", MODS_RECORD, "x.zip", ".hidden.jar"]) await expect(removePreinstalled(directory, name)).rejects.toThrow("MOD_FILE_INVALID")
})

test("预装模组：没有适合这个版本的就不加并说明；下载失败什么都不留", async () => {
  const directory = await project()
  const bytes = jar({ id: "solo" })
  const fake = modrinth([{ id: "SSSSSSSS", slug: "solo", title: "Solo", versions: [] }, { id: "TTTTTTTT", slug: "two", title: "Two", versions: [version({ id: "VTTTTTTT", jar: bytes, filename: "two.jar" })] }], {})
  expect(await addFromModrinth({ projectDirectory: directory, projectId: "SSSSSSSS", minecraft: "1.21.1", loader: "fabric", skip: STUDIO_INSTALLS, fetchJson: fake.fetchJson, download: fake.download })).toEqual({ added: [], skipped: [{ name: "Solo", why: MOD_WORDS.noVersion("1.21.1", "fabric") }] })
  await expect(addFromModrinth({ projectDirectory: directory, projectId: "TTTTTTTT", minecraft: "1.21.1", loader: "fabric", skip: STUDIO_INSTALLS, fetchJson: fake.fetchJson, download: async () => { throw new Error("DOWNLOAD_CHECKSUM_MISMATCH") } })).rejects.toThrow("MODRINTH_DOWNLOAD_FAILED")
  expect(await readdir(path.join(directory, SCENE_EXTRA))).toEqual([])
  await expect(addFromModrinth({ projectDirectory: directory, projectId: "TTTTTTTT", minecraft: "1.21.1", loader: "quilt", skip: STUDIO_INSTALLS, fetchJson: fake.fetchJson, download: fake.download })).rejects.toThrow("MOD_LOADER_UNSUPPORTED")
})

test("预装模组：从电脑选的 jar 要是 Fabric 模组才收，Studio 自己装的和已经有的不重复", async () => {
  const directory = await project()
  const source = await project()
  const write = async (name: string, bytes: Buffer) => {
    await writeFile(path.join(source, name), bytes)
    return path.join(source, name)
  }
  const files = [
    await write("good.jar", jar({ id: "good", name: "好模组", version: "1.0" })),
    await write("forge-only.jar", jar(null)),
    await write("fabric-api-0.1.jar", jar({ id: "fabric-api" })),
    await write("readme.txt", Buffer.from("hi")),
    path.join(source, "missing.jar"),
  ]
  const result = await addJarFiles({ projectDirectory: directory, files, loader: "fabric" })
  expect(result.added).toEqual([{ file: "good.jar", id: "good", name: "好模组", version: "1.0", from: "file", required: false }])
  expect(result.skipped).toEqual([
    { name: "forge-only.jar", why: MOD_WORDS.notLoader("fabric") },
    { name: "fabric-api-0.1.jar", why: MOD_WORDS.studio },
    { name: "readme.txt", why: MOD_WORDS.notJar },
    { name: "missing.jar", why: MOD_WORDS.gone },
  ])
  // The same mod under another name is already there.
  const renamed = await write("good-copy.jar", jar({ id: "good" }))
  expect((await addJarFiles({ projectDirectory: directory, files: [renamed], loader: "fabric" })).skipped).toEqual([{ name: "good-copy.jar", why: MOD_WORDS.already }])
  await expect(addJarFiles({ projectDirectory: directory, files, loader: "quilt" })).rejects.toThrow("MOD_LOADER_UNSUPPORTED")
  expect(await listPreinstalled(directory)).toEqual(result.added)
})

/** A Forge or NeoForge jar: a zip with its loader's mods file. */
const tomlJar = (file: "META-INF/mods.toml" | "META-INF/neoforge.mods.toml", toml: string) => Buffer.from(zipSync({ [file]: new TextEncoder().encode(toml) }))

test("预装模组：Forge 和 NeoForge 工程只收自己加载器的模组，名字和版本读它的 mods 文件；Fabric 的 jar 不混进来", async () => {
  const source = await project()
  const write = async (name: string, bytes: Buffer) => {
    await writeFile(path.join(source, name), bytes)
    return path.join(source, name)
  }
  const forgeToml = 'modLoader="javafml"\n[[mods]]\nmodId="jei"\nversion="15.2.0"\ndisplayName="Just Enough Items"\n[[dependencies.jei]]\nmodId="forge"\nmandatory=true\n'
  const files = [
    await write("jei-forge.jar", tomlJar("META-INF/mods.toml", forgeToml)),
    await write("sodium-fabric.jar", jar({ id: "sodium", name: "Sodium" })),
    await write("geckolib-forge.jar", tomlJar("META-INF/mods.toml", '[[mods]]\nmodId="geckolib"\nversion="${file.jarVersion}"\n')),
    await write("neo-only.jar", tomlJar("META-INF/neoforge.mods.toml", '[[mods]]\nmodId="neo"\n')),
  ]
  const forge = await project()
  const result = await addJarFiles({ projectDirectory: forge, files, loader: "forge" })
  expect(result.added).toEqual([{ file: "jei-forge.jar", id: "jei", name: "Just Enough Items", version: "15.2.0", from: "file", required: false }])
  expect(result.skipped).toEqual([
    { name: "sodium-fabric.jar", why: MOD_WORDS.notLoader("forge") },
    // Studio puts GeckoLib into every Forge and NeoForge scene itself; Fabric API is not one of theirs.
    { name: "geckolib-forge.jar", why: MOD_WORDS.studio },
    { name: "neo-only.jar", why: MOD_WORDS.notLoader("forge") },
  ])
  expect(MOD_WORDS.notLoader("forge")).toBe("它不是 Forge 模组（里面没有 META-INF/mods.toml），测试场用不了。")
  expect(MOD_WORDS.notLoader("fabric")).toBe("它不是 Fabric 模组（里面没有 fabric.mod.json），测试场用不了。")
  // A jar put there by hand is listed by its own mods file for the project's loader.
  await writeFile(path.join(forge, SCENE_EXTRA, "by-hand.jar"), tomlJar("META-INF/mods.toml", '[[mods]]\nmodId="hand"\ndisplayName="手放的"\nversion="2"\n'))
  expect((await listPreinstalled(forge, "forge")).map((mod) => [mod.file, mod.id, mod.name, mod.version])).toEqual([
    ["by-hand.jar", "hand", "手放的", "2"],
    ["jei-forge.jar", "jei", "Just Enough Items", "15.2.0"],
  ])
  expect((await removePreinstalled(forge, "by-hand.jar", "forge")).map((mod) => mod.file)).toEqual(["jei-forge.jar"])
  // NeoForge reads its own file and refuses the Forge one.
  const neo = await project()
  const neoResult = await addJarFiles({ projectDirectory: neo, files, loader: "neoforge" })
  expect(neoResult.added.map((mod) => mod.id)).toEqual(["neo"])
  expect(neoResult.skipped.map((value) => value.name)).toEqual(["jei-forge.jar", "sodium-fabric.jar", "geckolib-forge.jar"])
  expect(studioInstalls("fabric")).toEqual(STUDIO_INSTALLS)
  expect(studioInstalls("neoforge")).toEqual(["geckolib"])
})

test("预装模组：Forge 工程从 Modrinth 加的时候按 Forge 和这个游戏版本问，下回来的要是 Forge 模组", async () => {
  const directory = await project()
  const forgeJar = tomlJar("META-INF/mods.toml", '[[mods]]\nmodId="alpha"\ndisplayName="Alpha"\nversion="${file.jarVersion}"\n')
  const fabricJar = jar({ id: "beta" })
  const forgeVersion = { ...version({ id: "VAAAAAAA", jar: forgeJar, filename: "alpha.jar" }), loaders: ["forge"], game_versions: ["1.20.1"] }
  const mislabelled = { ...version({ id: "VBBBBBBB", jar: fabricJar, filename: "beta.jar" }), loaders: ["forge"], game_versions: ["1.20.1"] }
  const projects = [
    { id: "AAAAAAAA", slug: "alpha", title: "Alpha", versions: [forgeVersion] },
    { id: "BBBBBBBB", slug: "beta", title: "Beta", versions: [mislabelled] },
  ]
  const asked: string[] = []
  const fetchJson = async (url: string) => {
    const address = new URL(url)
    const [, , , id, rest] = address.pathname.split("/")
    const found = projects.find((value) => value.id === id)!
    if (rest === "version") {
      asked.push(`${address.searchParams.get("loaders")} ${address.searchParams.get("game_versions")}`)
      return found.versions
    }
    return { id: found.id, slug: found.slug, title: found.title }
  }
  const jars: Record<string, Buffer> = { [forgeVersion.files[0]!.url]: forgeJar, [mislabelled.files[0]!.url]: fabricJar }
  const download = async (input: { url: string; destination: string }) => writeFile(input.destination, jars[input.url]!)
  const added = await addFromModrinth({ projectDirectory: directory, projectId: "AAAAAAAA", minecraft: "1.20.1", loader: "forge", skip: studioInstalls("forge"), fetchJson, download })
  // The mods file leaves the version to the build; Modrinth's version number is said instead.
  expect(added.added).toEqual([{ file: "alpha.jar", id: "alpha", name: "Alpha", version: "VAAAAAAA", from: "modrinth", required: false }])
  const refused = await addFromModrinth({ projectDirectory: directory, projectId: "BBBBBBBB", minecraft: "1.20.1", loader: "forge", skip: studioInstalls("forge"), fetchJson, download })
  expect(refused).toEqual({ added: [], skipped: [{ name: "Beta", why: MOD_WORDS.notLoader("forge") }] })
  expect(asked).toEqual(['["forge"] ["1.20.1"]', '["forge"] ["1.20.1"]'])
  expect((await readdir(path.join(directory, SCENE_EXTRA))).filter((name) => name.endsWith(".jar"))).toEqual(["alpha.jar"])
})
