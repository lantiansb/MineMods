import { afterEach, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { zipSync } from "fflate"
import { missingMods, readModJar, readModsToml } from "../src/mod-jar"
import { TARGET_SCENE_DOWNLOADS, TARGET_SCENE_WORDS, targetScenePaths, targetSceneReady } from "../src/scene-target"
import { SCENE } from "../src/scene"
import { installedProof } from "../src/store/instance"
import { targetManifest } from "../src/target/manifests"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const folder = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "测试场 目标-"))
  roots.push(root)
  return root
}
const bytes = (text: string) => new TextEncoder().encode(text)

test("a mods file is read for who the mod is and what it cannot start without, on Forge's and NeoForge's own terms", () => {
  const toml = [
    'modLoader = "javafml"',
    "# a comment",
    "[[mods]]",
    'modId = "ember"',
    'version = "${file.jarVersion}"',
    "displayName = 'Ember \"Isles\"'",
    "[[mods]]",
    'modId="ember_extra"',
    "[[dependencies.ember]]",
    '  modId = "forge"',
    "  mandatory = true",
    "[[dependencies.ember]]",
    '  modId = "jei"',
    "  mandatory = false",
    "[[dependencies.ember]]",
    '  modId = "curios"',
    '  type = "required"',
    "[[dependencies.ember]]",
    '  modId = "sodium"',
    '  type = "incompatible"',
    "[[dependencies.ember]]",
    '  modId = "kotlin"',
    '  type = "optional"',
    "  mandatory = true",
    "[modproperties.ember]",
    'modId = "not_a_mod"',
  ].join("\n")
  expect(readModsToml(toml)).toEqual({
    mods: [
      { modId: "ember", displayName: 'Ember "Isles"', version: "${file.jarVersion}" },
      { modId: "ember_extra", displayName: "", version: "" },
    ],
    // NeoForge's `type` wins over the older `mandatory` when both are there.
    dependencies: [
      { modId: "forge", required: true },
      { modId: "jei", required: false },
      { modId: "curios", required: true },
      { modId: "sodium", required: false },
      { modId: "kotlin", required: false },
    ],
  })
})

test("a jar is a mod of the loader only with that loader's file; its nested jars answer to their ids, and nobody's needs are made up", async () => {
  const root = await folder()
  const nested = zipSync({ "META-INF/mods.toml": bytes('[[mods]]\nmodId="playeranimator"\n') })
  const built = path.join(root, "built.jar")
  await writeFile(built, zipSync({ "META-INF/mods.toml": bytes('[[mods]]\nmodId="ember"\nversion="1.0.0"\n[[dependencies.ember]]\nmodId="geckolib"\nmandatory=true\n[[dependencies.ember]]\nmodId="playeranimator"\nmandatory=true\n'), "META-INF/jarjar/player-animation-lib-forge.jar": nested }))
  const fabric = path.join(root, "fabric.jar")
  await writeFile(fabric, zipSync({ "fabric.mod.json": bytes('{"id":"sodium","depends":{"fabricloader":"*"}}') }))
  const notZip = path.join(root, "broken.jar")
  await writeFile(notZip, "not a zip")
  expect(await readModJar(built, "forge")).toEqual({ file: built, id: "ember", name: "", version: "1.0.0", ids: ["ember", "playeranimator"], depends: ["geckolib"] })
  expect(await readModJar(built, "neoforge")).toBeNull()
  expect(await readModJar(fabric, "forge")).toBeNull()
  expect(await readModJar(fabric, "fabric")).toMatchObject({ ids: ["sodium"], depends: ["fabricloader"] })
  expect(await readModJar(notZip, "forge")).toBeNull()
  // GeckoLib brings what the mod asks for; the loader, the game and Java are always there; what nobody brings is missing.
  expect(missingMods([{ ids: ["ember"], depends: ["geckolib", "forge", "minecraft"] }, { ids: ["geckolib"], depends: ["forge"] }], "forge")).toEqual([])
  expect(missingMods([{ ids: ["ember"], depends: ["geckolib", "curios", "neoforge"] }, { ids: [], depends: ["curios"] }], "neoforge")).toEqual(["geckolib", "curios"])
  // Forge's own id is not NeoForge's.
  expect(missingMods([{ ids: ["x"], depends: ["forge"] }], "neoforge")).toEqual(["forge"])
})

test("a target's scene keeps its record where the Fabric scene keeps its own, and its game in the project's two instances", async () => {
  const root = await folder()
  const projectId = randomUUID()
  const paths = targetScenePaths(root, projectId, "forge-1.20.1")
  expect(paths.record).toBe(path.join(root, "scene", "instances", projectId, "scene.json"))
  expect(paths.mods).toBe(path.join(root, "scene", "instances", projectId, "mods"))
  expect(paths.server).toBe(path.join(root, "store", "instances", projectId, "forge-1.20.1", "server"))
  expect(paths.game).toBe(path.join(root, "store", "instances", projectId, "forge-1.20.1", "client", "game"))
  // The check's world is the server's own (its level-name), which opening the game copies in.
  expect(paths.world).toBe(path.join(paths.server, SCENE.world))
  expect(() => targetScenePaths(root, "../x", "forge-1.20.1")).toThrow("INVALID_PROJECT_ID")
})

test("what is on this computer for a target's check and game is read from the installer's own marks, and the game only counts once its files were all fetched", async () => {
  const root = await folder()
  const projectId = randomUUID()
  const manifest = targetManifest("neoforge-1.21.1")
  const paths = targetScenePaths(root, projectId, manifest.id)
  expect(await targetSceneReady(root, projectId, manifest)).toEqual({ check: false, play: false })
  const mark = async (side: "server" | "client") => {
    const directory = side === "server" ? paths.server : paths.client
    const proof = path.join(directory, ...installedProof(manifest, side).split("/"))
    await mkdir(path.dirname(proof), { recursive: true })
    await writeFile(proof, "{}")
    if (manifest.loader.install.kind !== "installer") throw new Error("not an installer")
    const file = manifest.loader.install.file
    await writeFile(path.join(directory, ".minemods-instance.json"), JSON.stringify({ target: manifest.id, loader: manifest.loader.version, installer: file.sha256 ?? file.sha1, side, installed_at: "", mirror: false }))
  }
  await mark("server")
  expect(await targetSceneReady(root, projectId, manifest)).toEqual({ check: true, play: false })
  await mark("client")
  // Installed, but the sounds and languages were never all fetched: still a first time.
  expect(await targetSceneReady(root, projectId, manifest)).toEqual({ check: true, play: false })
  await writeFile(path.join(paths.client, `.minemods-game-files-${manifest.minecraft.assetIndex.file.sha1}`), "")
  expect(await targetSceneReady(root, projectId, manifest)).toEqual({ check: true, play: true })
})

test("a first check and a first opening of a target say what they install and about how much, in the drawer's words", () => {
  for (const id of ["forge-1.20.1", "neoforge-1.21.1"]) {
    const manifest = targetManifest(id)
    const cold = TARGET_SCENE_WORDS.cold(manifest)
    const name = `${manifest.loader.kind === "forge" ? "Forge" : "NeoForge"} ${manifest.minecraft.version}`
    expect(cold.check).toContain(`还没有装过 ${name} 的服务器`)
    expect(cold.play).toContain(`还没有装过 ${name} 的游戏（`)
    const sizes = TARGET_SCENE_DOWNLOADS[id]!
    expect(sizes.check).toBeGreaterThan(0)
    expect(sizes.play).toBeGreaterThan(sizes.check)
    expect(cold.play).toMatch(/约 \d+(\.\d)? (MB|GB)/)
  }
  // The lines said while it prepares have no Latin letter, so the drawer shows them (`plainProgress`).
  for (const line of [TARGET_SCENE_WORDS.server, TARGET_SCENE_WORDS.client, TARGET_SCENE_WORDS.installing]) expect(line).not.toMatch(/[A-Za-z]/)
})
