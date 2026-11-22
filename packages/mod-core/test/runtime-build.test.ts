import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { compileEntity } from "../src/fabric/entity"
import { scaffoldProject } from "../src/fabric/scaffold"
import { runOwnedProcess } from "../src/runtime"

const roots: string[] = []
const templateDirectory = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))

afterEach(() => Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

test("runtime entity source compiles against the pinned Fabric 1.21.1 toolchain", async () => {
  const repoRoot = path.resolve(templateDirectory, "../..")
  const javaHome = path.join(repoRoot, ".artifacts", "toolchains", "temurin21", "jdk-21.0.12.1+1")
  const gradleHome = path.join(repoRoot, ".artifacts", "toolchains", "gradle-home")
  if (!existsSync(path.join(javaHome, "bin", "java.exe")) || !existsSync(gradleHome)) return
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-runtime-gradle-"))
  roots.push(directory)
  await scaffoldProject({
    templateDirectory,
    directory,
    modId: "runtime_build",
    name: "Runtime Build",
    packageName: "studio.runtime_build",
  })
  const files = compileEntity({
    modId: "runtime_build",
    packageName: "studio.runtime_build",
    id: "runtime_build",
    name: "Runtime Build",
    health: 20,
    speed: 0.2,
    attack_damage: 3,
    behavior: "hostile",
    model: {
      name: "Creature",
      texture_size: 64,
      bones: [
        {
          name: "root",
          parent: null,
          pivot: [0, 0, 0],
          rotation: [0, 0, 0],
          cubes: [
            {
              name: "body",
              origin: [-2, 0, -2],
              size: [4, 8, 4],
              faces: {
                north: "#cc9966",
                east: "#cc9966",
                south: "#cc9966",
                west: "#cc9966",
                up: "#cc9966",
                down: "#cc9966",
              },
            },
          ],
        },
      ],
      animations: ["idle", "walk", "hurt"].map((name) => ({
        name,
        length: 1,
        loop: name !== "hurt",
        channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }],
      })),
    },
    runtime: {
      spawn: { biomes: ["minecraft:plains"], weight: 10, min: 1, max: 2 },
      explosion: {
        fuse_ticks: 20,
        radius: 2,
        damage_blocks: false,
        effects: [{ effect: "slowness", duration_ticks: 40, amplifier: 1 }],
      },
      movement: "strafe",
      armor: 4,
      charging_armor: 8,
      texture_asset_id: null,
    },
  })
  await Promise.all(
    Object.entries(files).map(async ([name, contents]) => {
      const target = path.join(directory, name)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, contents)
    }),
  )
  const metadataPath = path.join(directory, "src", "main", "resources", "fabric.mod.json")
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>
  metadata.entrypoints = {
    main: ["studio.runtime_build.StudioContent"],
    client: ["studio.runtime_build.client.StudioClient"],
  }
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
  const gradle = await runOwnedProcess("cmd.exe", ["/d", "/s", "/c", "gradlew.bat assemble --no-daemon"], {
    cwd: directory,
    env: { ...process.env, JAVA_HOME: javaHome, GRADLE_USER_HOME: gradleHome },
    timeoutMs: 110000,
  })
  const evidenceDirectory = path.join(repoRoot, ".artifacts", "studio", "entity-runtime-compiler")
  await mkdir(evidenceDirectory, { recursive: true })
  await writeFile(path.join(evidenceDirectory, "compile.log"), gradle.output)
  await writeFile(
    path.join(evidenceDirectory, "StudioCreature.java"),
    String(files["src/main/java/studio/runtime_build/entity/StudioCreature.java"]),
  )
  expect(gradle.code, gradle.output).toBe(0)
  expect(
    await readFile(
      path.join(
        directory,
        "build",
        "classes",
        "java",
        "main",
        "studio",
        "runtime_build",
        "entity",
        "StudioCreature.class",
      ),
    ),
  ).toBeTruthy()
}, 120_000)
