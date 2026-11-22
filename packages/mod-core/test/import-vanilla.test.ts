import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { strToU8, zipSync } from "fflate"
import {
  clearImportedArchiveCache,
  createJarClassProvider,
  createVanillaResourceProvider,
  resolveTargetMinecraftVersion,
} from "../src/import-vanilla"

test("selects a source-evidenced Minecraft version and reads versioned extra/srg JARs by indexed entry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-vanilla-provider-")),
    directory = path.join(root, ".minecraft", "libraries", "net", "minecraft", "client", "1.20.1-20230612.114412"),
    extra = path.join(directory, "client-1.20.1-20230612.114412-extra.jar"),
    srg = path.join(directory, "client-1.20.1-20230612.114412-srg.jar"),
    source = path.join(root, "source.jar")
  await mkdir(directory, { recursive: true })
  await Promise.all([
    writeFile(
      extra,
      zipSync({
        "assets/minecraft/models/block/template_candle.json": strToU8('{"elements":[]}'),
        "assets/minecraft/textures/block/candle.png": new Uint8Array([1, 2, 3]),
        "assets/minecraft/textures/block/candle.png.mcmeta": strToU8('{"animation":{}}'),
        "META-INF/MANIFEST.MF": strToU8("ignored"),
      }),
    ),
    writeFile(
      srg,
      zipSync({
        "net/minecraft/client/model/SkullModel.class": strToU8("skull-model"),
        "net/minecraft/client/model/geom/ModelLayers.class": strToU8("model-layers"),
        "net/minecraft/client/model/geom/LayerDefinitions.class": strToU8("layer-definitions"),
      }),
    ),
    writeFile(
      source,
      zipSync({
        "com/example/Renderer.class": strToU8("renderer"),
        "assets/example/models/item/custom.json": strToU8("private source model"),
      }),
    ),
  ])
  try {
    expect(resolveTargetMinecraftVersion(["[1.20.1,)"], "examplemod-1.20.1-4.3.2508-universal.jar")).toEqual({
      version: "1.20.1",
      selectionBasis: "source_filename_within_reported_range",
    })
    expect(resolveTargetMinecraftVersion(["[1.20.1,)"], "examplemod-universal.jar")).toBeNull()
    expect(resolveTargetMinecraftVersion(["[1.19,1.20)"], "examplemod-1.20.1-universal.jar")).toBeNull()
    const provider = await createVanillaResourceProvider("1.20.1", { workspaceDirectory: root })
    if (!provider) throw new Error("Test Minecraft archives were not located")
    expect(provider.paths).toContain("assets/minecraft/models/block/template_candle.json")
    expect(provider.paths).toContain("assets/minecraft/textures/block/candle.png.mcmeta")
    expect(provider.paths).not.toContain("META-INF/MANIFEST.MF")
    expect(provider.classPaths).toContain("net/minecraft/client/model/SkullModel.class")
    expect(provider.classPaths).toContain("net/minecraft/client/model/geom/LayerDefinitions.class")
    expect(Buffer.from(await provider.readFile("assets/minecraft/textures/block/candle.png"))).toEqual(
      Buffer.from([1, 2, 3]),
    )
    expect(Buffer.from(await provider.readFile("net/minecraft/client/model/SkullModel.class"))).toEqual(
      Buffer.from("skull-model"),
    )
    expect(await provider.verify()).toBe(true)
    provider.dispose()
    const sourceClasses = await createJarClassProvider(source)
    expect(sourceClasses.has("com/example/Renderer.class")).toBe(true)
    expect(sourceClasses.has("assets/example/models/item/custom.json")).toBe(false)
    await expect(sourceClasses.readFile("assets/example/models/item/custom.json")).rejects.toThrow(/not a class/i)
    sourceClasses.dispose()
  } finally {
    await clearImportedArchiveCache()
    await rm(root, { recursive: true, force: true })
  }
})
