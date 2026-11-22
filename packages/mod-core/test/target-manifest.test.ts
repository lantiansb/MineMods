import { expect, test } from "bun:test"
import { resolveProfile } from "../src/fabric/profile"
import { listManagedJdks, managedJdk } from "../src/target/jdks"
import { TargetManifestSchema } from "../src/target/manifest"
import { listTargetManifests, targetManifest } from "../src/target/manifests"

test("三个目标的清单都合规，id 和游戏版本、加载器对得上", () => {
  const manifests = listTargetManifests()
  expect(manifests.map((manifest) => manifest.id)).toEqual(["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"])
  manifests.forEach((manifest) => {
    expect(TargetManifestSchema.parse(manifest)).toEqual(manifest)
    expect(manifest.id).toBe(`${manifest.loader.kind}-${manifest.minecraft.version}`)
    expect(manifest.ready).toBe(manifest.why === null)
  })
  expect(() => targetManifest("forge-1.12.2")).toThrow("UNKNOWN_TARGET")
})

test("Fabric 清单就是现在的生成模板配置，第 1 阶段 Fabric 出包不变", () => {
  const profile = resolveProfile("fabric-1.21.1")
  const fabric = targetManifest("fabric-1.21.1")
  expect(fabric.loader.version).toBe(profile.loader)
  expect(fabric.toolchain).toMatchObject({ kind: "loom", plugin: profile.loom, gradle: { version: profile.gradle.version } })
  expect(fabric.mappings).toEqual({ kind: "official", parchment: null })
  expect(fabric.dependencies.geckolib.file).toEqual(profile.geckolib.download)
  expect(fabric.dependencies.fabricApi?.file).toEqual(profile.downloads.fabricApi)
  expect(fabric.minecraft.client.sha1).toBe(profile.downloads.minecraftClient.sha1)
  expect(fabric.java).toEqual({ major: profile.java.major, alsoForBuild: [] })
})

test("版本差异写在清单里：1.20.1 复数目录、配方 item、要 refmap、构建还要 Java 21", () => {
  const forge = targetManifest("forge-1.20.1")
  expect(forge.java).toEqual({ major: 17, alsoForBuild: [21] })
  expect(forge.data).toEqual({ packFormat: { data: 15, resource: 15 }, folders: "plural", recipeResult: "item", modFile: "META-INF/mods.toml", spawns: "forge:add_spawns", refmap: true })
  expect(forge.loader.install.kind).toBe("installer")
  expect(forge.minecraft.assetIndex.id).toBe("5")
  const neoforge = targetManifest("neoforge-1.21.1")
  expect(neoforge.data).toMatchObject({ folders: "singular", recipeResult: "id", modFile: "META-INF/neoforge.mods.toml", refmap: false })
  expect(neoforge.toolchain.kind).toBe("mdg")
  expect(neoforge.minecraft).toEqual(targetManifest("fabric-1.21.1").minecraft)
})

test("清单里要用的每个 Java 都有托管的版本，带官方哈希", () => {
  const majors = new Set(listTargetManifests().flatMap((manifest) => [manifest.java.major, ...manifest.java.alsoForBuild]))
  expect([...majors].sort()).toEqual([17, 21])
  majors.forEach((major) => expect(managedJdk(major).downloads["windows-x64"].sha256).toMatch(/^[0-9a-f]{64}$/))
  expect(listManagedJdks().map((jdk) => jdk.major)).toEqual([17, 21])
  expect(managedJdk(21).version).toBe(resolveProfile("fabric-1.21.1").java.version)
  expect(() => managedJdk(8)).toThrow("UNSUPPORTED_JAVA")
})
