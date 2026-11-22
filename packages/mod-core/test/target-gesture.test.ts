import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { GESTURE_EXAMPLE } from "../src/gesture-bases"
import { genTarget } from "../src/platform/target"
import { unportedFeatures } from "../src/platform/ported"
import { createProject, openProject, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { targetManifest } from "../src/target/manifests"
import { applyWorkspaceAsset } from "../src/workspace"
import { SKY_EXAMPLE, gestureAsset } from "./gesture-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * Cast actions (playerAnimator) on Forge 1.20.1 and NeoForge 1.21.1 (D 组): the runtime's loader part through the facade, the library
 * from the target's manifest, bundled by ModDevGradle's jar-in-jar and named in the mod's metadata, and the whole tree compiles against
 * the target's class path and the pinned library. The real Gradle builds and servers are `script/target-gameplay-check.ts --gestures`.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

/** The pinned library's jar where Gradle keeps it after a real build of the target (beside the class path folder's gradle-home, in a folder named by its SHA-1 without leading zeros), if it is there. */
function pinnedLibrary(target: TargetId) {
  const artifact = targetManifest(target).dependencies.playerAnimator!
  const classpaths = process.env.MINEMODS_TARGET_CLASSPATH
  if (!classpaths) return null
  const folder = path.join(path.dirname(classpaths), "gradle-home", "caches", "modules-2", "files-2.1", "dev.kosmx.player-anim", "player-animation-lib-forge", artifact.version, artifact.file.sha1!.replace(/^0+/, ""))
  const jar = path.join(folder, `player-animation-lib-forge-${artifact.version}.jar`)
  return existsSync(jar) ? jar : null
}

for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: cast actions go through the facade, bundle the pinned playerAnimator, and compile`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-gesture-target-"))
    roots.push(root)
    const directory = path.join(root, "施法")
    const created = await createProject({ directory, name: "施法试验", mod_id: "gesture_smoke", target })
    await saveProject(directory, applyWorkspaceAsset(applyWorkspaceAsset(created, gestureAsset(GESTURE_EXAMPLE, "00000000-0000-4000-8000-0000000000a1")), gestureAsset(SKY_EXAMPLE, "00000000-0000-4000-8000-0000000000a2")), created.revision)
    const project = await openProject(directory)
    expect(unportedFeatures(project, genTarget(target))).toEqual([])
    const source = path.join(root, "source")
    await mkdir(source)
    const built = await assembleBuildSource(directory, source, TEMPLATE)
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    const read = (name: string) => readFile(path.join(source, name), "utf8")
    const pkg = "src/main/java/com/minemods/content_gesture_smoke"
    expect(names.filter((name) => name.startsWith(`${pkg}/gesture/`)).sort()).toEqual(
      ["core/GestureAim", "core/GestureCooldown", "core/GestureData", "core/GestureRuntime", "core/GestureState", "platform/GestureMod", "platform/client/GestureAimModifier", "platform/client/GestureAnimations", "platform/client/GestureCast", "platform/client/GestureClient"].map((name) => `${pkg}/gesture/${name}.java`),
    )
    expect(built.gestureFiles).toEqual(["com/minemods/content_gesture_smoke/gesture/platform/GestureMod.class", "data/gesture_smoke/studio/gestures.json", "META-INF/licenses/playerAnimator-LICENSE.txt"])
    // Started by the facade's entries, not by a loader's entry point; the loader's part names no loader.
    expect(await read(`${pkg}/StudioContent.java`)).toContain("com.minemods.content_gesture_smoke.gesture.platform.GestureMod.register();")
    expect(await read(`${pkg}/client/StudioClient.java`)).toContain("com.minemods.content_gesture_smoke.gesture.platform.client.GestureClient.register();")
    for (const name of names.filter((value) => value.startsWith(`${pkg}/gesture/`))) expect({ name, loader: /^import net\.(fabricmc|minecraftforge|neoforged)\./m.test(await read(name)) }).toEqual({ name, loader: false })
    // The library: its Maven, both its compile and jar-in-jar dependency, its pinned hash, and the mod's metadata naming it.
    const artifact = targetManifest(target).dependencies.playerAnimator!
    const gradle = await read("build.gradle")
    expect(gradle).toContain("url = 'https://maven.kosmx.dev/'")
    expect(gradle).toContain(`    ${target === "forge-1.20.1" ? "modImplementation" : "implementation"} project.player_animator_coordinate\n    jarJar project.player_animator_coordinate\n`)
    expect(gradle).toContain("tasks.named('compileJava') { dependsOn 'verifyPlayerAnimator' }")
    expect(await read("gradle.properties")).toContain(`player_animator_coordinate=${artifact.coordinate}\nplayer_animator_sha256=${artifact.file.sha256}\n`)
    const metadata = await read(target === "forge-1.20.1" ? "src/main/resources/META-INF/mods.toml" : "src/main/resources/META-INF/neoforge.mods.toml")
    expect(metadata).toContain(`[[dependencies.gesture_smoke]]\nmodId = "playeranimator"\n${target === "forge-1.20.1" ? "mandatory = true" : 'type = "required"'}\nversionRange = "[${artifact.version},)"`)
    expect(JSON.parse(await read("minemods-build.json")).gesture_runtime.player_animator).toMatchObject({ version: artifact.version, coordinate: artifact.coordinate, download: { sha256: artifact.file.sha256 } })
    expect(await read("src/main/resources/META-INF/licenses/playerAnimator-LICENSE.txt")).toContain("Copyright (c) 2022 KosmX")
    const library = pinnedLibrary(target)
    if (!hasTargetJavac(target) || !library) return console.warn(`${target}: no javac class path or no pinned playerAnimator jar here; the cast actions were not compiled`)
    const compiled = await targetJavac(target, path.join(source, "src", "main", "java"), undefined, [library])
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 180000)
}

test("each facade target pins its own playerAnimator from Modrinth's list: 1.0.2-rc1+1.20 on Forge 1.20.1, 2.0.4+1.21.1 on NeoForge 1.21.1; Fabric keeps its profile's", () => {
  expect(targetManifest("forge-1.20.1").dependencies.playerAnimator).toMatchObject({ coordinate: "dev.kosmx.player-anim:player-animation-lib-forge:1.0.2-rc1+1.20", file: { sha256: "4a624602ba90d305a4cdcfbde07c893466ddbc0a1210b559bf607bf715626cb0" } })
  expect(targetManifest("neoforge-1.21.1").dependencies.playerAnimator).toMatchObject({ coordinate: "dev.kosmx.player-anim:player-animation-lib-forge:2.0.4+1.21.1", file: { sha256: "dbe5de45f5cd60c0e5e47af14e6d564534a98456e973cf670cb881f6938eee92" } })
  expect(targetManifest("fabric-1.21.1").dependencies.playerAnimator).toBeUndefined()
})
