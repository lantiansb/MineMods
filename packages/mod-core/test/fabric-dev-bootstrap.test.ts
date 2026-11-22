import { expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import { scaffoldProject } from "../src/fabric/scaffold"

const templateDirectory = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const execute = promisify(execFile)
const javac = Bun.which("javac")
const java = Bun.which("java")

test.skipIf(!javac || !java)("exported development bootstrap restores a Unicode classpath before delegating with original arguments", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-launch-"))
  try {
    const target = path.join(directory, "中文 mod's project")
    const result = await scaffoldProject({ templateDirectory, directory: target, modId: "a", name: "A", packageName: "studio.a" })
    const bootstrap = path.join(target, "src/studioDev/java/com/minemods/studio/dev/ClasspathBootstrap.java")
    expect(result.files).toContain(bootstrap)
    const probe = path.join(directory, "probe/net/fabricmc/devlaunchinjector/Main.java")
    await mkdir(path.dirname(probe), { recursive: true })
    // A downstream Java entrypoint records what the real bootstrap delegates.
    // The actual Fabric + Minecraft launch is exercised separately against the
    // long Unicode project that reproduced Gradle's manifest-only classpath.
    await writeFile(probe, String.raw`package net.fabricmc.devlaunchinjector;
public final class Main {
  public static void main(String[] args) throws java.io.IOException {
    System.out.write((System.getProperty("java.class.path") + "\n" + String.join("|", args))
        .getBytes(java.nio.charset.StandardCharsets.UTF_8));
  }
}`)
    const classes = path.join(directory, "classes")
    await execute(javac!, ["-encoding", "UTF-8", "--release", "21", "-d", classes, bootstrap, probe])
    const classpathFile = path.join(target, "完整 classpath.txt")
    const expected = [classes, path.join(target, "dependencies", "a's library.jar")].join(path.delimiter)
    await writeFile(classpathFile, expected, "utf8")
    const run = await execute(java!, ["-Dfile.encoding=UTF-8", `-Dminemods.dev.classpath=${classpathFile}`, "-cp", classes,
      "com.minemods.studio.dev.ClasspathBootstrap", "--username", "Builder's name", "--version", "1.21.1"])
    expect(run.stdout.trim().split(/\r?\n/)).toEqual([expected, "--username|Builder's name|--version|1.21.1"])
    expect(await readFile(path.join(target, "build.gradle"), "utf8")).toContain("sourceSets.studioDev.output")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
