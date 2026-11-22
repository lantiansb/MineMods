import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build"
import { putModelAsset } from "../src/assets"
import { designToBlockbench } from "../src/blockbench"
import { mushroomCowDesign } from "../src/example"
import { createEntity, createProject, saveProject } from "../src/project"

const roots: string[] = []
const templateDirectory = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))

afterEach(() => Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

test("passes per-entity logic into the generated Fabric entity", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-logic-build-"))
  roots.push(directory)
  const initial = await createProject({ directory, name: "逻辑铜鸮", mod_id: "logic_owl" })
  const entity = createEntity({ name: "铜鸮" })
  const project = await saveProject(directory, {
    ...initial,
    entities: [entity],
    items: [{ id: "11111111-1111-4111-8111-111111111111", identifier: "feather", name: "羽毛", max_stack: 64, color: "#eeeeee" }],
    logic: [{ id: "22222222-2222-4222-8222-222222222222", entity_id: entity.id, trigger: "holding_item", action: "follow", item: "logic_owl:feather", enabled: true }],
  }, initial.revision)
  await putModelAsset(directory, { entity_id: entity.id, expectedRevision: project.revision, origin: "example", data: { design: mushroomCowDesign } })
  const source = path.join(directory, "generated-source")
  await assembleBuildSource(directory, source, templateDirectory)
  const entitySource = await readFile(path.join(source, "src/main/java/com/minemods/content_logic_owl/entity/StudioCreature.java"), "utf8")
  expect(entitySource).toContain("getNavigation().moveTo(player, 1.0)")
  expect(entitySource).toContain("logic_owl")
  expect(entitySource).toContain("feather")
})

test("compiles a generated entity with a real logic rule using local Gradle", async () => {
  const repoRoot = path.resolve(templateDirectory, "../..")
  const javaHome = path.join(repoRoot, ".artifacts", "toolchains", "temurin21", "jdk-21.0.12.1+1")
  const gradleHome = path.join(repoRoot, ".artifacts", "toolchains", "gradle-home")
  if (!existsSync(path.join(javaHome, "bin", "java.exe")) || !existsSync(gradleHome)) return
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-logic-gradle-"))
  roots.push(directory)
  const initial = await createProject({ directory, name: "逻辑铜鸮", mod_id: "logic_owl" })
  const entity = createEntity({ name: "铜鸮" })
  const rules = [
    ["player_near", "look"], ["player_near", "follow"], ["player_near", "play_animation"],
    ["holding_item", "look"], ["holding_item", "follow"], ["holding_item", "play_animation"],
    ["hurt", "look"], ["hurt", "follow"], ["hurt", "play_animation"],
  ] as const
  const project = await saveProject(directory, {
    ...initial,
    entities: [entity],
    items: [{ id: "11111111-1111-4111-8111-111111111111", identifier: "feather", name: "羽毛", max_stack: 64, color: "#eeeeee" }],
    logic: rules.map(([trigger, action], index) => ({
      id: `66666666-6666-4666-8666-${String(index + 1).padStart(12, "0")}`,
      entity_id: entity.id,
      trigger,
      action,
      ...(trigger === "holding_item" ? { item: "logic_owl:feather" } : {}),
      ...(action === "play_animation" ? { animation: "flight" } : {}),
      enabled: true,
    })),
  }, initial.revision)
  const blockbench = designToBlockbench(mushroomCowDesign)
  const root = (blockbench.outliner![0] as { uuid: string }).uuid
  blockbench.animations!.push({
    name: "flight",
    length: 12,
    loop: true,
    animators: {
      [root]: {
        keyframes: [
          { time: 0, channel: "rotation", data_points: [{ x: 0, y: 0, z: 0 }] },
          { time: 6, channel: "rotation", data_points: [{ x: 0, y: 25, z: 0 }] },
        ],
      },
    },
  })
  await putModelAsset(directory, { entity_id: entity.id, expectedRevision: project.revision, origin: "example", data: { design: mushroomCowDesign, blockbench } })
  const source = path.join(directory, "generated-source")
  await assembleBuildSource(directory, source, templateDirectory)
  const entitySource = await readFile(path.join(source, "src/main/java/com/minemods/content_logic_owl/entity/StudioCreature.java"), "utf8")
  expect(entitySource.match(/triggerableAnim\(/g)?.length).toBe(3)
  expect(entitySource).toContain("animation.creature_")
  expect(entitySource).toContain(".flight\"")
  expect(entitySource).toContain("studioLogicHurtFollowUntil")
  expect(entitySource).toContain("tickCount + 40")
  expect(entitySource).toContain("getNavigation().stop()")
  const gradle = Bun.spawn(["cmd.exe", "/d", "/s", "/c", "gradlew.bat assemble --no-daemon"], {
    cwd: source,
    env: { ...process.env, JAVA_HOME: javaHome, GRADLE_USER_HOME: gradleHome },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr] = await Promise.all([new Response(gradle.stdout).text(), new Response(gradle.stderr).text()])
  expect(await gradle.exited, `${stdout}\n${stderr}`).toBe(0)
  expect(await readFile(path.join(source, "build/classes/java/main/com/minemods/content_logic_owl/entity/StudioCreature.class"))).toBeTruthy()
}, 120_000)
