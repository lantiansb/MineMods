import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import type { GameplayDocument } from "../src/gameplay"
import { staticChecks } from "../src/gameplay-check"
import { gameplayAllowed, scanGameplay } from "../src/gameplay-scan"
import { genTarget } from "../src/platform/target"
import { unportedFeatures } from "../src/platform/ported"
import { openProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { createTargetGameplaySample } from "../script/target-gameplay-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * The gameplay group of the platform layer (D 组): AI-written gameplay code and what it reaches the loader through
 * (`ProjectPlatform`, `ProjectClient`) on Forge 1.20.1 and NeoForge 1.21.1, and the same gameplay on Fabric 1.21.1. The real
 * Gradle builds and dedicated servers are `script/target-gameplay-check.ts`.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function assembled(target: TargetId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-gameplay-target-"))
  roots.push(root)
  const directory = path.join(root, "蓝晶矿洞")
  const project = await createTargetGameplaySample(directory, target)
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(directory, source, TEMPLATE)
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
  const read = (name: string) => readFile(path.join(source, name), "utf8")
  return { project: await openProject(directory), saved: project, built, source, names, read }
}

const pkg = "src/main/java/com/minemods/content_azure_sample"
const api = `${pkg}/gameplay/api`

for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: gameplay starts from the facade's entries, reaches the loader only through it, and the whole tree compiles`, async () => {
    const { project, built, names, read, source } = await assembled(target)
    expect(unportedFeatures(project, genTarget(target))).toEqual([])
    expect(built.gameplay.map((entry) => entry.slug)).toEqual(["ore_guarding", "studio_probe"])
    // Both gameplays pass the checks of their target as they are.
    for (const asset of project.workspace.assets.filter((value) => value.document.kind === "gameplay")) {
      const checks = staticChecks(project, asset.document as never, asset.id)
      expect({ slug: (asset.document as { slug: string }).slug, bounds: checks.bounds, references: checks.references }).toEqual({ slug: (asset.document as { slug: string }).slug, bounds: [], references: [] })
    }
    expect(names).not.toContain("src/main/resources/fabric.mod.json")
    for (const name of ["ProjectContent", "ProjectPlatform", "ProjectClient", "GameplayBoot", "GameplayEntry", "GameplayClientEntry", "AbilityAction", "client/GameplayClientBoot"]) expect(names).toContain(`${api}/${name}.java`)
    // No loader's entry point: the boot classes are plain classes, run by the entries.
    const boot = await read(`${api}/GameplayBoot.java`)
    expect(boot).not.toContain("net.fabricmc")
    expect(boot).toContain('start("ore_guarding", com.minemods.content_azure_sample.gameplay.ore_guarding.Main::new);')
    expect(await read(`${pkg}/StudioContent.java`)).toContain("com.minemods.content_azure_sample.gameplay.api.GameplayBoot.register();")
    expect(await read(`${pkg}/client/StudioClient.java`)).toContain("com.minemods.content_azure_sample.gameplay.api.client.GameplayClientBoot.register();")
    // The support code names no loader: ProjectPlatform and ProjectClient hand on to the facade.
    for (const name of names.filter((value) => value.startsWith(`${pkg}/gameplay/`))) expect({ name, loader: /^import net\.(fabricmc|minecraftforge|neoforged)\./m.test(await read(name)) }).toEqual({ name, loader: false })
    expect(await read(`${api}/ProjectPlatform.java`)).toContain("StudioPlatform.onUseBlock(handler::use);")
    // Asked for before the loader has registered it, a thing of the project is said not to be there yet (Fabric registers at once and never says it).
    expect(await read(`${api}/ProjectContent.java`)).toContain('throw new IllegalStateException("Not registered yet: "')
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 180000)
}

test("fabric-1.21.1: the same gameplay compiles on Fabric; ProjectPlatform is written with Fabric API there, only because a gameplay names it", async () => {
  const { built, names, read, source } = await assembled("fabric-1.21.1")
  expect(built.gameplay.map((entry) => entry.slug)).toEqual(["ore_guarding", "studio_probe"])
  expect(names).toContain(`${api}/ProjectPlatform.java`)
  expect(await read(`${api}/ProjectPlatform.java`)).toContain("UseBlockCallback.EVENT.register(handler::use);")
  expect(await read(`${api}/ProjectContent.java`)).not.toContain("Not registered yet")
  const metadata = JSON.parse(await read("src/main/resources/fabric.mod.json"))
  expect(metadata.entrypoints.main).toContain("com.minemods.content_azure_sample.gameplay.api.GameplayBoot")
  expect(metadata.entrypoints.client).toContain("com.minemods.content_azure_sample.gameplay.api.client.GameplayClientBoot")
  if (!hasTargetJavac(CLASSPATH["fabric-1.21.1"])) return
  const compiled = await targetJavac(CLASSPATH["fabric-1.21.1"], path.join(source, "src", "main", "java"))
  expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
  expect(compiled.code).toBe(0)
}, 180000)

const java = (body: string, imports: string[] = [], file = "Main.java") => ({
  path: file,
  content: `package com.minemods.content_azure_sample.gameplay.probe${file.includes("/") ? `.${file.split("/").slice(0, -1).join(".")}` : ""};\n\n${imports.map((name) => `import ${name};`).join("\n")}\n\npublic final class ${file.split("/").at(-1)!.replace(".java", "")} {\n    void run() {\n${body}\n    }\n}\n`,
})
const scanned = (target: TargetId, ...sources: { path: string; content: string }[]) => scanGameplay({ mod_id: "azure_sample", slug: "probe", sources, target })
const REGISTERING = ['        Registry.register(BuiltInRegistries.ITEM, ProjectContent.id("x"), new Item(new Item.Properties()));', ["net.minecraft.core.Registry", "net.minecraft.core.registries.BuiltInRegistries", "net.minecraft.world.item.Item"]] as const

test("the checker is per target: Fabric API is refused on Forge and NeoForge with Studio's equivalent, and kept on Fabric", () => {
  const ticking = java("        ServerTickEvents.END_SERVER_TICK.register(server -> {});", ["net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents"])
  expect(scanned("fabric-1.21.1", ticking)).toEqual([])
  for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
    const found = scanned(target, ticking)
    expect(found.map((finding) => [finding.rule, finding.line])).toEqual([["loader_api", 3]])
    expect(found[0]!.message).toContain(target === "forge-1.20.1" ? "这个工程是给 Forge 1.20.1 做的" : "这个工程是给 NeoForge 1.21.1 做的")
    expect(found[0]!.fix).toContain("ProjectPlatform.onServerTick(server -> …)")
    // A loader's own class too, Forge's or NeoForge's: gameplay code names no loader at all.
    expect(scanned(target, java("", ["net.minecraftforge.event.TickEvent"])).map((finding) => finding.rule)).toEqual(["loader_api"])
    expect(scanned(target, java("", ["net.neoforged.neoforge.common.NeoForge"])).map((finding) => finding.rule)).toEqual(["loader_api"])
    // Named in full where it is used, as well.
    expect(scanned(target, java("        net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry.playS2C();")).map((finding) => [finding.rule, finding.fix.includes("ProjectPlatform.s2c")])).toEqual([["loader_api", true]])
    // Registering straight into the game's registries compiles and stops the game: refused, with ProjectPlatform.register.
    const registered = scanned(target, java(REGISTERING[0], [...REGISTERING[1]]))
    expect(registered.map((finding) => finding.rule)).toEqual(["registry_direct"])
    expect(registered[0]!.fix).toContain("ProjectPlatform.register(Registries.XXX")
  }
  expect(scanned("fabric-1.21.1", java("", ["net.minecraftforge.event.TickEvent"])).map((finding) => finding.rule)).toEqual(["import"])
  expect(scanned("fabric-1.21.1", java(REGISTERING[0], [...REGISTERING[1]]))).toEqual([])
  expect(gameplayAllowed("forge-1.20.1").some((name) => name.startsWith("net.fabricmc."))).toBe(false)
  expect(gameplayAllowed("fabric-1.21.1")).toContain("net.fabricmc.fabric.api.")
})

test("Studio's own API is held to the same rules on every target: a right-click that never looks at its hand, ProjectClient outside client/", () => {
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
    const blind = java("        ProjectPlatform.onUseItem((player, level, hand) -> { player.heal(1.0f); return InteractionResult.SUCCESS; });", ["com.minemods.content_azure_sample.gameplay.api.ProjectPlatform", "net.minecraft.world.InteractionResult"])
    expect(scanned(target, blind).map((finding) => [finding.rule, finding.message.startsWith("ProjectPlatform.onUseItem 的回调从来没有看过 hand")])).toEqual([["hand", true]])
    const minded = java("        ProjectPlatform.onUseItem((player, level, hand) -> hand == InteractionHand.MAIN_HAND ? InteractionResult.SUCCESS : InteractionResult.PASS);", ["com.minemods.content_azure_sample.gameplay.api.ProjectPlatform", "net.minecraft.world.InteractionHand", "net.minecraft.world.InteractionResult"])
    expect(scanned(target, minded)).toEqual([])
    expect(scanned(target, java("", ["com.minemods.content_azure_sample.gameplay.api.ProjectClient"])).map((finding) => finding.rule)).toEqual(["client_only"])
    expect(scanned(target, java("", ["com.minemods.content_azure_sample.gameplay.api.ProjectClient"], "client/ClientMain.java"))).toEqual([])
  }
})

test("a project built for Fabric and Forge both is held to both: its gameplay may not use Fabric API", async () => {
  const { project } = await assembled("fabric-1.21.1")
  const guarding = project.workspace.assets.find((asset) => asset.document.kind === "gameplay" && (asset.document as { slug: string }).slug === "ore_guarding")!
  const document = guarding.document as GameplayDocument
  const ticker = java("        ServerTickEvents.END_SERVER_TICK.register(server -> {});", ["net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents"], "Ticker.java")
  const fabricOnly: GameplayDocument = { ...document, sources: [...document.sources, { ...ticker, content: ticker.content.replace("gameplay.probe", "gameplay.ore_guarding") }] }
  expect(staticChecks(project, fabricOnly, guarding.id).bounds).toEqual([])
  const both = { ...project, targets: ["fabric-1.21.1", "forge-1.20.1"] as TargetId[] }
  expect(staticChecks(both, fabricOnly, guarding.id).bounds.map((finding) => [finding.rule, finding.file])).toEqual([["loader_api", "Ticker.java"]])
}, 60000)
