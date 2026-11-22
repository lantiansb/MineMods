import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { compileEntity } from "../src/fabric/entity"
import { mushroomCowDesign } from "../src/example"
import { scaffoldProject } from "../src/fabric/scaffold"
import { proxyJvmArgs, runOwnedProcess } from "../src/runtime"

const templateDirectory = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const repoRoot = path.resolve(templateDirectory, "../..")
const evidenceRoot = path.join(repoRoot, ".artifacts", "studio", "entity-runtime-gametest")

async function main() {
  const javaHome = path.join(repoRoot, ".artifacts", "toolchains", "temurin21", "jdk-21.0.12.1+1")
  const gradleHome = path.join(repoRoot, ".artifacts", "toolchains", "gradle-home")
  await mkdir(evidenceRoot, { recursive: true })
  const runDirectory = process.env.RUNTIME_GAMETEST_DIRECTORY
    ? path.resolve(process.env.RUNTIME_GAMETEST_DIRECTORY)
    : await mkdtemp(path.join(evidenceRoot, "run-"))
  const relative = path.relative(evidenceRoot, runDirectory)
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("GameTest directory must remain inside its evidence folder")
  if (!process.env.RUNTIME_GAMETEST_DIRECTORY) {
    await scaffoldProject({
      templateDirectory,
      directory: runDirectory,
      modId: "runtime_gametest",
      name: "Runtime GameTest",
      packageName: "studio.runtime_gametest",
    })
  }
  const generated = compileEntity({
    modId: "runtime_gametest",
    packageName: "studio.runtime_gametest",
    id: "runtime_gametest",
    name: "Runtime GameTest",
    health: 20,
    speed: 0.2,
    attack_damage: 3,
    behavior: "hostile",
    model: mushroomCowDesign,
    runtime: {
      spawn: { biomes: ["minecraft:plains"], weight: 10, min: 1, max: 2 },
      explosion: {
        fuse_ticks: 20,
        radius: 2,
        damage_blocks: false,
        effects: [{ effect: "slowness", duration_ticks: 40, amplifier: 1 }],
      },
      movement: "direct",
      armor: 4,
      charging_armor: 8,
      texture_asset_id: null,
    },
  })
  await Promise.all(
    Object.entries(generated).map(async ([name, contents]) => {
      const target = path.join(runDirectory, name)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, contents)
    }),
  )
  const fixture = await readFile(path.join(import.meta.dir, "runtime-gametest-fixture.java"), "utf8")
  const fixturePath = path.join(
    runDirectory,
    "src",
    "main",
    "java",
    "studio",
    "runtime_gametest",
    "RuntimeGameTest.java",
  )
  await mkdir(path.dirname(fixturePath), { recursive: true })
  await writeFile(fixturePath, fixture)
  const metadataPath = path.join(runDirectory, "src", "main", "resources", "fabric.mod.json")
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>
  metadata.entrypoints = {
    main: ["studio.runtime_gametest.StudioContent"],
    client: ["studio.runtime_gametest.client.StudioClient"],
    "fabric-gametest": ["studio.runtime_gametest.RuntimeGameTest"],
  }
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
  const reportPath = path.join(evidenceRoot, "gametest-report.xml")
  await rm(reportPath, { force: true })
  const buildGradlePath = path.join(runDirectory, "build.gradle")
  const buildGradle = await readFile(buildGradlePath, "utf8")
  const baseBuildGradle = buildGradle.replace(/\n\ntasks\.named\('runServer'\)[\s\S]*$/, "")
  await writeFile(
    buildGradlePath,
    `${baseBuildGradle}\n\ntasks.named('runServer') {\n    jvmArgs '-Dfabric-api.gametest'\n    jvmArgs "-Dfabric-api.gametest.report-file=${reportPath.replaceAll("\\", "/")}"\n}\n`,
  )
  const gradle = await runOwnedProcess(
    path.join(javaHome, "bin", "java.exe"),
    [
      ...proxyJvmArgs(process.env),
      "-classpath",
      path.join(runDirectory, "gradle", "wrapper", "gradle-wrapper.jar"),
      "org.gradle.wrapper.GradleWrapperMain",
      "--no-daemon",
      "--console=plain",
      "runServer",
    ],
    {
      cwd: runDirectory,
      env: { ...process.env, JAVA_HOME: javaHome, GRADLE_USER_HOME: gradleHome },
      timeoutMs: 900000,
      onProgress: (text) => process.stdout.write(text),
    },
  )
  await writeFile(path.join(evidenceRoot, "gradle.stdout.log"), gradle.output)
  await writeFile(path.join(evidenceRoot, "gradle.stderr.log"), "")
  const report = await Bun.file(reportPath)
    .text()
    .catch(() => "")
  await writeFile(path.join(evidenceRoot, "gametest-report.snapshot.xml"), report)
  if (gradle.code !== 0) throw new Error(`GameTest Gradle failed. See ${evidenceRoot}`)
  const testCaseCount = report.match(/<testcase\b/g)?.length ?? 0
  if (testCaseCount !== 2 || /<(?:failure|error)\b/.test(report))
    throw new Error(`GameTest report contains failures or missing testcases. See ${reportPath}`)
  await writeFile(
    path.join(evidenceRoot, "result.json"),
    JSON.stringify({ runDirectory, reportPath, testCaseCount, passed: true }, null, 2),
  )
  console.log(JSON.stringify({ evidenceRoot, runDirectory, reportPath }, null, 2))
}

await main()
