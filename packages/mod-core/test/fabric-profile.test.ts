import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assertSupportedEnvironment, listSupportedProfiles, resolveProfile } from "../src/fabric/profile"
import { copyTemplate, scaffoldProject } from "../src/fabric/scaffold"

const templateDirectory = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))

test("the supported profile pins stable, checksum-addressed Fabric dependencies", () => {
  const profile = resolveProfile("fabric-1.21.1")
  expect(profile.minecraft).toBe("1.21.1")
  expect(profile.java.major).toBe(21)
  expect(profile.loom).toBe("1.7.4")
  expect(profile.gradle.version).toBe("8.8")
  expect(profile.loader).toBe("0.17.2")
  expect(profile.fabricApi).toBe("0.116.6+1.21.1")
  expect(profile.geckolib.version).toBe("4.8.3")
  expect(profile.gradle.wrapper.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(() => resolveProfile("fabric-latest")).toThrow("Unsupported")
})

test("enumerates only the verified Java 21 Fabric environment", () => {
  expect(listSupportedProfiles().map((entry) => entry.id)).toEqual(["fabric-1.21.1"])
  expect(assertSupportedEnvironment({ javaMajor: 21, minecraft: "1.21.1", loader: "fabric", loaderVersion: "0.17.2" }).id).toBe("fabric-1.21.1")
  expect(() => assertSupportedEnvironment({ javaMajor: 17, minecraft: "1.21.1", loader: "fabric", loaderVersion: "0.17.2" })).toThrow(/UNSUPPORTED_ENVIRONMENT/)
})

test("scaffolds from an explicit installed resource directory with binary integrity and escaped metadata", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-scaffold-"))
  try {
    const target = path.join(directory, "中文 mod's project")
    const result = await scaffoldProject({
      templateDirectory,
      directory: target,
      modId: "minimal_mod",
      name: '中文 "Mod"',
      packageName: "studio.fixture.minimal",
      description: "line one\nline two\\end",
      author: "Builder's name",
      version: "1.2.3",
    })
    const metadata = JSON.parse(await readFile(path.join(target, "src/main/resources/fabric.mod.json"), "utf8"))
    expect(metadata.name).toBe('中文 "Mod"')
    expect(metadata.description).toBe("line one\nline two\\end")
    expect(metadata.depends.geckolib).toBe(">=4.8.3 <5.0.0")
    expect(metadata.depends.minecraft).toBe("1.21.1")
    const wrapper = await readFile(path.join(target, "gradle/wrapper/gradle-wrapper.jar"))
    expect(createHash("sha256").update(wrapper).digest("hex")).toBe(result.profile.gradle.wrapper.sha256)
    expect(wrapper.equals(await readFile(path.join(templateDirectory, "gradle/wrapper/gradle-wrapper.jar")))).toBe(true)
    expect(await readFile(path.join(target, "gradle.properties"), "utf8")).toContain("mod_version=1.2.3")
    expect(await readFile(path.join(target, "gradle.properties"), "utf8")).toContain("loader_version=0.17.2")
    expect(await readFile(path.join(target, "build.gradle"), "utf8")).not.toContain("SNAPSHOT")
    expect(result.files).toContain(path.join(target, "gradlew.bat"))
    await expect(scaffoldProject({ templateDirectory, directory: target, modId: "another", name: "Another", packageName: "studio.another" })).rejects.toThrow("not empty")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects path traversal and malformed project identifiers before writing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-safe-scaffold-"))
  try {
    const source = path.join(directory, "source")
    await mkdir(source)
    await writeFile(path.join(source, "{{name}}.txt"), "content")
    await expect(copyTemplate(source, path.join(directory, "target"), { name: "../../escape" })).rejects.toThrow("escapes")
    await expect(scaffoldProject({ templateDirectory, directory: path.join(directory, "target"), modId: "../bad", name: "Bad", packageName: "studio.fixture" })).rejects.toThrow("mod ID")
    await expect(scaffoldProject({ templateDirectory, directory: path.join(directory, "target"), modId: "valid", name: "Bad", packageName: "studio.class" })).rejects.toThrow("package")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("scaffolds a legal single-character mod ID accepted by saved projects", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-short-id-"))
  try {
    const result = await scaffoldProject({ templateDirectory, directory, modId: "a", name: "A", packageName: "studio.a" })
    const metadata = JSON.parse(await readFile(path.join(directory, "src/main/resources/fabric.mod.json"), "utf8"))
    expect(metadata.id).toBe("a")
    expect(metadata.entrypoints.main).toEqual(["studio.a.AMod"])
    expect(result.files).toContain(path.join(directory, "src/main/java/studio/a/AMod.java"))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("scaffolds generated block resources when content is supplied", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-content-scaffold-"))
  try {
    const result = await scaffoldProject({
      templateDirectory,
      directory,
      modId: "copper_aviary",
      name: "铜鸮",
      packageName: "studio.copper_aviary",
      content: {
        blocks: [{
          id: "11111111-1111-4111-8111-111111111111",
          identifier: "copper_lamp",
          name: "铜纹灯",
          hardness: 1.5,
          luminance: 12,
          tool: "pickaxe",
          drop: "self",
          color: "#c77a45",
        }],
        items: [],
        recipes: [],
        logic: [],
      },
    })
    expect(result.files).toContain(path.join(directory, "src/main/resources/assets/copper_aviary/blockstates/copper_lamp.json"))
    expect((await readFile(path.join(directory, "src/main/resources/assets/copper_aviary/textures/block/copper_lamp.png"))).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
    const language = JSON.parse(await readFile(path.join(directory, "src/main/resources/assets/copper_aviary/lang/en_us.json"), "utf8"))
    expect(language["modmenu.summary.copper_aviary"]).toBe("A Minecraft mod created with MineMods Studio")
    expect(language["block.copper_aviary.copper_lamp"]).toBe("铜纹灯")
    expect(result.files.filter((file) => file === path.join(directory, "src/main/resources/assets/copper_aviary/lang/en_us.json"))).toHaveLength(1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
