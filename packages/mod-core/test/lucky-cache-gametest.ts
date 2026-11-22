import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { compileContent } from "../src/content"
import { compileEntity } from "../src/fabric/entity"
import { mushroomCowDesign } from "../src/example"
import { scaffoldProject } from "../src/fabric/scaffold"
import { proxyJvmArgs, runOwnedProcess } from "../src/runtime"

const repo = path.resolve(import.meta.dir, "../../..")
const evidence = path.join(repo, ".artifacts/studio/lucky-cache-gametest")
await mkdir(evidence, { recursive: true })
const directory = process.env.LUCKY_GAMETEST_DIRECTORY ?? await mkdtemp(path.join(evidence, "run-"))
const relative = path.relative(evidence, directory)
if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Test directory outside evidence folder")
const fixture = (identifier: string, effect: boolean) => ({
  id: crypto.randomUUID(), identifier, name: identifier, hardness: 1, luminance: 0, tool: "none", drop: "self", color: "#557744",
  lucky: { max_stack: 16, outcomes: [{ weight: 100,
    items: effect ? [] : [{ item: "minecraft:diamond", min: 3, max: 3 }],
    effects: effect ? [{ effect: "slowness", duration_ticks: 100, amplifier: 1 }] : [],
  }] },
})
if (!process.env.LUCKY_GAMETEST_DIRECTORY) await scaffoldProject({ templateDirectory: path.join(repo, "templates/fabric-1.21"), directory,
  modId: "lucky_gametest", packageName: "studio.lucky_gametest", name: "Lucky cache integration tests" })
const generated = {
  ...compileContent({ mod_id: "lucky_gametest", package_name: "studio.lucky_gametest", blocks: [fixture("reward_cache", false), fixture("punish_cache", true)] }),
  ...compileEntity({ modId: "lucky_gametest", packageName: "studio.lucky_gametest", id: "creeper", name: "Loot test creature",
    health: 20, speed: 0.2, attack_damage: 3, behavior: "passive", model: mushroomCowDesign,
    runtime: { spawn: null, explosion: { fuse_ticks: 20, radius: 2, damage_blocks: false, effects: [] }, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null,
      death_drop: { block_identifier: "reward_cache", chance: 1 } },
  }),
}
generated["src/main/java/studio/lucky_gametest/StudioContent.java"] = String(generated["src/main/java/studio/lucky_gametest/StudioContent.java"])
  .replace("public static void register() {", "public static void register() {\n        StudioContentRegistry.register();")
await Promise.all(Object.entries(generated).map(async ([name, content]) => {
  const target = path.join(directory, name)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content)
}))
await writeFile(path.join(directory, "src/main/java/studio/lucky_gametest/LuckyCacheGameTest.java"), await readFile(path.join(import.meta.dir, "lucky-cache-gametest-fixture.java")))
const metadataPath = path.join(directory, "src/main/resources/fabric.mod.json")
const metadata = JSON.parse(await readFile(metadataPath, "utf8"))
metadata.entrypoints = { main: ["studio.lucky_gametest.StudioContent"], client: ["studio.lucky_gametest.client.StudioClient"], "fabric-gametest": ["studio.lucky_gametest.LuckyCacheGameTest"] }
await writeFile(metadataPath, JSON.stringify(metadata, null, 2))
const reportPath = path.join(directory, "gametest-report.xml")
const gradlePath = path.join(directory, "build.gradle")
const gradleText = (await readFile(gradlePath, "utf8")).replace(/\n\ntasks\.named\('runServer'\)[\s\S]*$/, "")
await writeFile(gradlePath, `${gradleText}\n\ntasks.named('runServer') {\n    jvmArgs '-Dfabric-api.gametest'\n    jvmArgs "-Dfabric-api.gametest.report-file=${reportPath.replaceAll("\\", "/")}"\n}\n`)
const javaHome = path.join(repo, ".artifacts/toolchains/temurin21/jdk-21.0.12.1+1")
console.log(JSON.stringify({ directory }))
const result = await runOwnedProcess(path.join(javaHome, "bin/java.exe"), [
  ...proxyJvmArgs(process.env), "-classpath", path.join(directory, "gradle/wrapper/gradle-wrapper.jar"), "org.gradle.wrapper.GradleWrapperMain",
  "--no-daemon", "--console=plain", "runServer",
], { cwd: directory, env: { ...process.env, JAVA_HOME: javaHome, GRADLE_USER_HOME: path.join(repo, ".artifacts/toolchains/gradle-home") },
  timeoutMs: 900000, onProgress: text => process.stdout.write(text) })
await writeFile(path.join(directory, "gradle.log"), result.output)
const report = await readFile(reportPath, "utf8").catch(() => "")
const tests = report.match(/<testcase\b/g)?.length ?? 0
if (result.code !== 0 || tests !== 5 || /<(failure|error)\b/.test(report)) throw new Error(`GameTest failed: ${directory}`)
await writeFile(path.join(evidence, "result.json"), JSON.stringify({ directory, reportPath, tests, passed: true }, null, 2))
console.log(JSON.stringify({ tests, passed: true, reportPath }))
