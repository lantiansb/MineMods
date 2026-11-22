import { afterAll, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { unzipSync } from "fflate"
import { runToolchainGradle } from "../src/toolchain/run"
import { templateDirectoryOf, toolchainFor } from "../src/toolchain/toolchain"

/*
 * Opt-in: MINEMODS_REAL_BUILD=1 scaffolds a minimal mod from each ModDevGradle template into a folder whose path has
 * Chinese characters and a space, and runs the real Gradle build. It downloads whatever Gradle's folder lacks, so it is
 * pointed at a warm one (MINEMODS_GRADLE_HOME). The mod is built twice: as the template makes it, and with one mixin added.
 * MINEMODS_REAL_RUN=1 also starts the development server from that folder and stops it once it has gone far enough: on Forge
 * it stops by itself at Minecraft's EULA (never accepted here), on NeoForge (whose development server does not ask) the test
 * stops it once the mod was constructed and the server started.
 *
 * MINEMODS_JDK17 / MINEMODS_JDK21: the JDKs (defaults: the check folder's JDK 17, Studio's own Java 21).
 */
const real = process.env.MINEMODS_REAL_BUILD === "1"
const runToo = process.env.MINEMODS_REAL_RUN === "1"
const spike = process.env.MINEMODS_CHECK_DIR ?? path.join(os.homedir(), "MineMods-check")
const gradleHome = process.env.MINEMODS_GRADLE_HOME ?? path.join(spike, "gradle-home")
const javaHomes = {
  17: process.env.MINEMODS_JDK17 ?? path.join(spike, "tools", "jdk17", "jdk-17.0.21+9"),
  21: process.env.MINEMODS_JDK21 ?? path.join(process.env.APPDATA ?? "", "MineMods Studio", "runtime", "java-21"),
}
const templatesRoot = fileURLToPath(new URL("../../../templates", import.meta.url))
const cleanup: (() => Promise<unknown>)[] = []

afterAll(async () => {
  for (const step of cleanup.reverse()) await step()
})

/** A runtime folder of its own whose `gradle-home` is a junction to the warm one, so the build finds its caches and Studio's lease files land here, not there. */
async function runtimeDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-toolchain-runtime-"))
  const link = path.join(directory, "gradle-home")
  await symlink(gradleHome, link, "junction")
  // The junction goes first and on its own, so removing the folder can never reach into the warm caches.
  cleanup.push(async () => {
    await unlink(link)
    await rm(directory, { recursive: true, force: true })
  })
  return directory
}

for (const id of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
  test.skipIf(!real)(
    `${id}: a minimal mod builds for real in a folder with Chinese characters and a space`,
    async () => {
      expect(existsSync(gradleHome)).toBe(true)
      const toolchain = toolchainFor(id)
      const root = await mkdtemp(path.join(os.tmpdir(), "minemods 中文 构建-"))
      if (process.env.MINEMODS_KEEP_BUILD !== "1") cleanup.push(() => rm(root, { recursive: true, force: true }))
      const directory = path.join(root, `${id} 模组`)
      await mkdir(root, { recursive: true })
      await toolchain.scaffold({ templateDirectory: templateDirectoryOf(toolchain, templatesRoot), directory, modId: "toolchain_probe", name: "工具链 验证", packageName: "studio.probe", version: "0.2.0" })
      const runtime = await runtimeDirectory()
      const output: string[] = []
      const began = Date.now()
      const result = await runToolchainGradle(toolchain, directory, "build", { runtimeDirectory: runtime, javaHomes, onProgress: (text) => output.push(text) })
      const seconds = Math.round((Date.now() - began) / 1000)
      await writeFile(path.join(os.tmpdir(), `minemods-toolchain-${id}.log`), output.join(""))
      console.log(`${id}: build ${result.code === 0 ? "passed" : "FAILED"} in ${seconds}s (retries ${result.retries}); log at ${path.join(os.tmpdir(), `minemods-toolchain-${id}.log`)}; stage: ${toolchain.stageWords(output.join(""))}`)
      expect(result.code).toBe(0)
      const jar = toolchain.jarPath(directory, { modId: "toolchain_probe", version: "0.2.0" })
      expect(existsSync(jar)).toBe(true)
      const names = Object.keys(unzipSync(new Uint8Array(await readFile(jar))))
      expect(names).toContain(toolchain.modFile)
      expect(names).toContain("studio/probe/ToolchainProbeMod.class")
      expect(names).toContain("toolchain_probe.mixins.json")
      expect(names).toContain("pack.mcmeta")
      const modFile = new TextDecoder().decode(unzipSync(new Uint8Array(await readFile(jar)), { filter: (file) => file.name === toolchain.modFile })[toolchain.modFile])
      // processResources put the version in.
      expect(modFile).toContain('version = "0.2.0"')

      // The same project with one mixin (what the generator adds for the camera): built again, it carries the mixin, and on Forge its refmap.
      await mkdir(path.join(directory, "src/main/java/studio/probe/mixin"), { recursive: true })
      await writeFile(
        path.join(directory, "src/main/java/studio/probe/mixin/ProbeMixin.java"),
        [
          "package studio.probe.mixin;",
          "",
          "import net.minecraft.client.Minecraft;",
          "import org.spongepowered.asm.mixin.Mixin;",
          "import org.spongepowered.asm.mixin.injection.At;",
          "import org.spongepowered.asm.mixin.injection.Inject;",
          "import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;",
          "",
          "@Mixin(Minecraft.class)",
          "public abstract class ProbeMixin {",
          '    @Inject(method = "tick", at = @At("HEAD"))',
          "    private void toolchainProbe$tick(CallbackInfo info) {}",
          "}",
          "",
        ].join("\n"),
      )
      const mixinsFile = path.join(directory, "src/main/resources/toolchain_probe.mixins.json")
      await writeFile(mixinsFile, JSON.stringify({ ...JSON.parse(await readFile(mixinsFile, "utf8")), client: ["ProbeMixin"] }, null, 2))
      const againBegan = Date.now()
      const again = await runToolchainGradle(toolchain, directory, "build", { runtimeDirectory: runtime, javaHomes, onProgress: (text) => output.push(text) })
      await writeFile(path.join(os.tmpdir(), `minemods-toolchain-${id}.log`), output.join(""))
      console.log(`${id}: build with a mixin ${again.code === 0 ? "passed" : "FAILED"} in ${Math.round((Date.now() - againBegan) / 1000)}s`)
      expect(again.code).toBe(0)
      const withMixin = unzipSync(new Uint8Array(await readFile(jar)))
      expect(Object.keys(withMixin)).toContain("studio/probe/mixin/ProbeMixin.class")
      if (id === "forge-1.20.1") {
        expect(Object.keys(withMixin)).toContain("toolchain_probe.refmap.json")
        expect(new TextDecoder().decode(withMixin["META-INF/MANIFEST.MF"])).toContain("MixinConfigs: toolchain_probe.mixins.json")
      }

      if (!runToo) return
      // The development server is stopped here as soon as the mod's constructor has logged and the server has either started or stopped at the EULA
      // (NeoForge's development server does not ask for it; nothing here accepts it).
      const server: string[] = []
      const started = Date.now()
      const stop = new AbortController()
      const limit = setTimeout(() => stop.abort(), 15 * 60_000)
      const loaded = /\[toolchain_probe\] initializing/
      const run = await runToolchainGradle(toolchain, directory, "runServer", {
        runtimeDirectory: runtime,
        javaHomes,
        signal: stop.signal,
        onProgress: (text) => {
          server.push(text)
          const log = server.join("")
          if (loaded.test(log) && /Done \(|agree to the EULA/.test(log)) stop.abort()
        },
      }).then(
        (result) => `exited with ${result.code}`,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      )
      clearTimeout(limit)
      const log = server.join("")
      await writeFile(path.join(os.tmpdir(), `minemods-toolchain-${id}-server.log`), log)
      console.log(`${id}: runServer ${run} after ${Math.round((Date.now() - started) / 1000)}s; mod constructed: ${loaded.test(log)}; started: ${/Done \(/.test(log)}; EULA stop: ${/agree to the EULA/.test(log)}`)
      // Forge 1.20.1's development server asks for the EULA before it constructs any mod: there, reaching that question with the mod's mixin
      // config handed to Mixin is how far a server run gets without accepting it. NeoForge's development server does not ask, and constructs the mod.
      if (id === "forge-1.20.1") {
        expect(log).toContain("--mixin.config, toolchain_probe.mixins.json")
        expect(log).toMatch(/Launching target 'forgeserveruserdev'/)
        expect(log).toMatch(/agree to the EULA/)
      } else {
        expect(log).toMatch(loaded)
        expect(log).toMatch(/Done \(/)
      }
    },
    40 * 60_000,
  )
}
