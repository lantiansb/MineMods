import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { strToU8, unzipSync, zipSync } from "fflate"
import { importProject } from "../src/import-project"
import {
  createImportedAssetReader,
  extractImportAssets,
  exportImportAssetWorkspace,
  getImportAssetSelection,
  getImportAssetRoot,
  getImportedAssetCatalog,
  readImportedAssetBytes,
  readImportedAssetFile,
  saveImportedAssetFile,
} from "../src/import-assets"

test("snapshot reader checks file integrity independently of mutable returned catalog", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-asset-reader-"))
  const workspaceDirectory = path.join(root, "workspace")
  await mkdir(workspaceDirectory)
  const archive = path.join(root, "sample.jar")
  await writeFile(archive, zipSync({ "assets/demo/models/item/test.json": strToU8("{}") }))
  try {
    const project = await importProject({ workspaceDirectory, filename: archive })
    const input = { workspaceDirectory, id: project.manifest.id }
    const selection = await getImportAssetSelection(input)
    await extractImportAssets({ ...input, groupIds: [selection.groups[0]!.id] })
    const reader = await createImportedAssetReader(input)
    const asset = { ...reader.catalog.assets[0]! }
    reader.catalog.assets[0]!.path = "../outside.json"
    reader.catalog.assets[0]!.sha256 = "0".repeat(64)
    expect(Buffer.from(await reader.readBytes(asset.id)).toString()).toBe("{}")
    await writeFile(path.join(await getImportAssetRoot(input), "files", asset.path), "[]")
    await expect(reader.readBytes(asset.id)).rejects.toThrow(/checksum/i)
    await expect(reader.readBytes("0".repeat(64))).rejects.toThrow(/not found/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("selectively extracts author KubeJS files without extracting mod JAR assets and can add groups safely", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-assets-")),
    workspaceDirectory = path.join(root, "workspace"),
    archive = path.join(root, "pack.zip")
  const nested = zipSync({
    "assets/sample/models/block/copper.json": strToU8(
      JSON.stringify({ parent: "block/cube_all", textures: { all: "sample:block/copper" } }),
    ),
    "assets/sample/textures/block/copper.png": new Uint8Array([1, 2, 3]),
    "assets/sample/geo/dragon.geo.json": strToU8("{}"),
    "com/sample/Helper.class": strToU8("bytecode"),
  })
  const longText = `{"value":"${"x".repeat(4 * 1024 * 1024)}"}`
  const original = zipSync({
    "overrides/kubejs/server_scripts/dragon.js": strToU8("ServerEvents.recipes(() => {})\n"),
    "overrides/kubejs/server_scripts/big.json5": strToU8(longText),
    "overrides/mods/dragon.jar": Buffer.from(nested),
    "overrides/config/example.toml": strToU8("enabled=true\n"),
    "manifest.json": strToU8(JSON.stringify({ files: [{ projectID: 123, fileID: 456 }] })),
  })
  await writeFile(archive, original)
  await mkdir(workspaceDirectory)
  try {
    const imported = await importProject({ workspaceDirectory, filename: archive }),
      selection = await getImportAssetSelection({ workspaceDirectory, id: imported.manifest.id })
    expect(selection.sourceKind).toBe("modpack")
    const kube = selection.groups.find((group) => group.name === "kubejs")!,
      mod = selection.groups.find((group) => group.kind === "mod")!
    let catalog = await extractImportAssets({ workspaceDirectory, id: imported.manifest.id, groupIds: [kube.id] })
    expect(catalog.groups.map((group) => group.id)).toEqual([kube.id])
    expect(catalog.assets.map((asset) => asset.kind)).toEqual(["script", "script"])
    expect(catalog.assets[0]?.resourcePath).toBe("kubejs/server_scripts/dragon.js")
    expect(await getImportedAssetCatalog({ workspaceDirectory, id: imported.manifest.id })).toEqual(catalog)
    expect(
      await readImportedAssetFile({ workspaceDirectory, id: imported.manifest.id, assetId: catalog.assets[0]!.id }),
    ).toMatchObject({ encoding: "utf8", content: "ServerEvents.recipes(() => {})\n", truncated: false })
    const script = catalog.assets.find((asset) => asset.name === "dragon.js")!
    const truncatedText = await readImportedAssetFile({
      workspaceDirectory,
      id: imported.manifest.id,
      assetId: catalog.assets.find((asset) => asset.name === "big.json5")!.id,
    })
    expect(truncatedText).toMatchObject({ encoding: "utf8", truncated: true })
    expect(truncatedText.content).toHaveLength(4 * 1024 * 1024)
    catalog = await saveImportedAssetFile({
      workspaceDirectory,
      id: imported.manifest.id,
      assetId: script.id,
      expectedSha256: script.sha256,
      content: "// reviewed\n",
    })
    expect(catalog.sourceSha256).toBe(selection.sourceSha256)
    expect(
      await readImportedAssetFile({ workspaceDirectory, id: imported.manifest.id, assetId: script.id }),
    ).toMatchObject({ encoding: "utf8", content: "// reviewed\n" })
    await expect(
      saveImportedAssetFile({
        workspaceDirectory,
        id: imported.manifest.id,
        assetId: script.id,
        expectedSha256: script.sha256,
        content: "stale",
      }),
    ).rejects.toThrow(/changed/i)
    const exported = path.join(root, "assets.zip")
    await exportImportAssetWorkspace({ workspaceDirectory, id: imported.manifest.id, destination: exported })
    const exportedEntries = unzipSync(await readFile(exported))
    expect(Object.keys(exportedEntries)).toContain(`files/${script.path}`)
    expect(Buffer.from(exportedEntries["MINE-MODS-ASSET-NOTICE.txt"]!).toString()).toContain(
      "not a directly launchable modpack",
    )
    await mkdir(
      path.join(await getImportAssetRoot({ workspaceDirectory, id: imported.manifest.id }), "models", script.id),
      { recursive: true },
    )
    await writeFile(
      path.join(
        await getImportAssetRoot({ workspaceDirectory, id: imported.manifest.id }),
        "models",
        script.id,
        "model.bbmodel",
      ),
      "derived",
    )
    catalog = await extractImportAssets({ workspaceDirectory, id: imported.manifest.id, groupIds: [kube.id, mod.id] })
    expect(
      await readFile(
        path.join(
          await getImportAssetRoot({ workspaceDirectory, id: imported.manifest.id }),
          "models",
          script.id,
          "model.bbmodel",
        ),
        "utf8",
      ),
    ).toBe("derived")
    expect(catalog.groups.map((group) => group.id).sort()).toEqual([kube.id, mod.id].sort())
    expect([...catalog.assets.map((asset) => asset.kind)].sort().join(",")).toBe(
      ["model", "model", "texture", "script", "script"].sort().join(","),
    )
    const model = catalog.assets.find((asset) => asset.resourcePath.endsWith("models/block/copper.json"))!
    const texture = catalog.assets.find((asset) => asset.kind === "texture")!
    expect(model.sourcePath).toContain("dragon.jar!/")
    expect(model.dependencies).toContain(texture.id)
    expect(catalog.assets.some((asset) => asset.name.endsWith(".class"))).toBe(false)
    expect(await readImportedAssetBytes({ workspaceDirectory, id: imported.manifest.id, assetId: texture.id })).toEqual(
      Buffer.from([1, 2, 3]),
    )
    expect(await extractImportAssets({ workspaceDirectory, id: imported.manifest.id, groupIds: [kube.id] })).toEqual(
      catalog,
    )
    expect(await readFile(archive)).toEqual(Buffer.from(original))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("extracts a JAR group into generic visual assets with stable IDs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-assets-jar-")),
    workspaceDirectory = path.join(root, "workspace"),
    archive = path.join(root, "sample.jar")
  await writeFile(
    archive,
    zipSync({
      "assets/demo/models/item/staff.json": strToU8("{}"),
      "assets/demo/models/item/staff_animation.json": strToU8("{}"),
      "assets/demo/textures/item/staff.png": new Uint8Array([8, 9]),
      "assets/demo/textures/item/staff.png.mcmeta": strToU8("{}"),
      "assets/demo/geo/staff.geo.json": strToU8("{}"),
      "assets/demo/animations/staff.animation.json": strToU8("{}"),
      "data/demo/loot_tables/test.json": strToU8("{}"),
      "demo/Logic.class": strToU8("class"),
    }),
  )
  await mkdir(workspaceDirectory)
  try {
    const imported = await importProject({ workspaceDirectory, filename: archive }),
      groups = await getImportAssetSelection({ workspaceDirectory, id: imported.manifest.id }),
      catalog = await extractImportAssets({
        workspaceDirectory,
        id: imported.manifest.id,
        groupIds: [groups.groups[0]!.id],
      })
    expect(groups.groups).toHaveLength(1)
    expect([...catalog.assets.map((asset) => asset.kind)].sort().join(",")).toBe(
      ["animation", "animation", "data", "data", "model", "model", "texture"].sort().join(","),
    )
    expect(catalog.assets.every((asset) => asset.origin === "mod" && asset.resourcePath.length > 0)).toBe(true)
    expect(
      (
        await extractImportAssets({ workspaceDirectory, id: imported.manifest.id, groupIds: [groups.groups[0]!.id] })
      ).assets.map((asset) => asset.id),
    ).toEqual(catalog.assets.map((asset) => asset.id))
    const model = catalog.assets.find((asset) => asset.kind === "model")!,
      assetRoot = await getImportAssetRoot({ workspaceDirectory, id: imported.manifest.id }),
      modelDirectory = path.join(assetRoot, "models", model.id),
      preview = "{}\n",
      bbmodel = '{"elements":[]}\n',
      sha = (value: string) => createHash("sha256").update(value).digest("hex"),
      metadata = {
        schemaVersion: 1,
        assetId: model.id,
        sourceSha256: catalog.sourceSha256,
        sourceAssetSha256: model.sha256,
        sourcePath: model.sourcePath,
        format: "json",
        dependencies: [...new Set([model.id, ...model.dependencies])].map((assetId) => ({
          assetId,
          sha256: catalog.assets.find((asset) => asset.id === assetId)!.sha256,
        })),
        files: { "preview.json": sha(preview), "model.bbmodel": sha(bbmodel) },
        textureCandidateAssetIds: [],
        selectedTextureAssetId: null,
        diagnostics: [],
      },
      exportPath = path.join(root, "derived.zip")
    await mkdir(modelDirectory, { recursive: true })
    await writeFile(path.join(modelDirectory, "asset.json"), JSON.stringify(metadata))
    await writeFile(path.join(modelDirectory, "preview.json"), preview)
    await writeFile(path.join(modelDirectory, "model.bbmodel"), bbmodel)
    await exportImportAssetWorkspace({ workspaceDirectory, id: imported.manifest.id, destination: exportPath })
    await writeFile(path.join(modelDirectory, "model.bbmodel"), `${bbmodel}tampered`)
    await expect(
      exportImportAssetWorkspace({
        workspaceDirectory,
        id: imported.manifest.id,
        destination: path.join(root, "tampered.zip"),
      }),
    ).rejects.toThrow(/checksum/i)
    await writeFile(path.join(modelDirectory, "model.bbmodel"), bbmodel)
    await writeFile(
      path.join(modelDirectory, "asset.json"),
      JSON.stringify({ ...metadata, sourceAssetSha256: "0".repeat(64) }),
    )
    await expect(
      exportImportAssetWorkspace({
        workspaceDirectory,
        id: imported.manifest.id,
        destination: path.join(root, "stale.zip"),
      }),
    ).rejects.toThrow(/stale|source/i)
    const vanillaResourcePath = "assets/minecraft/textures/block/candle.png",
      vanillaBytes = Buffer.from([3, 2, 1]),
      vanillaSha = createHash("sha256").update(vanillaBytes).digest("hex"),
      vanillaBundle = JSON.stringify({
        [vanillaResourcePath]: { sha256: vanillaSha, content: vanillaBytes.toString("base64") },
      }),
      tamperedBundle = JSON.stringify({
        [vanillaResourcePath]: { sha256: vanillaSha, content: Buffer.from([0]).toString("base64") },
      }),
      vanillaMetadata = {
        ...metadata,
        files: { ...metadata.files, "vanilla-resources.json": sha(vanillaBundle) },
        vanillaDiagnostics: [],
        vanillaDependencies: {
          version: "1.20.1",
          jarSha256: "a".repeat(64),
          classJarSha256: "b".repeat(64),
          selectionBasis: "source_filename_within_reported_range",
          jarSource: "libraries",
          entries: [{ path: vanillaResourcePath, sha256: vanillaSha, embedded: true }],
        },
      }
    await writeFile(path.join(modelDirectory, "asset.json"), JSON.stringify(vanillaMetadata))
    await writeFile(path.join(modelDirectory, "vanilla-resources.json"), vanillaBundle)
    await exportImportAssetWorkspace({
      workspaceDirectory,
      id: imported.manifest.id,
      destination: path.join(root, "vanilla-derived.zip"),
    })
    await writeFile(path.join(modelDirectory, "vanilla-resources.json"), tamperedBundle)
    await writeFile(
      path.join(modelDirectory, "asset.json"),
      JSON.stringify({
        ...vanillaMetadata,
        files: { ...vanillaMetadata.files, "vanilla-resources.json": sha(tamperedBundle) },
      }),
    )
    await expect(
      exportImportAssetWorkspace({
        workspaceDirectory,
        id: imported.manifest.id,
        destination: path.join(root, "tampered-vanilla.zip"),
      }),
    ).rejects.toThrow(/provenance/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("rejects bad selections and unsafe ZIP entries without changing the original archive", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-assets-unsafe-")),
    workspaceDirectory = path.join(root, "workspace"),
    archive = path.join(root, "unsafe.zip")
  const original = zipSync({ "../outside.txt": strToU8("escape"), "kubejs/server_scripts/a.js": strToU8("safe") })
  await mkdir(workspaceDirectory)
  await writeFile(archive, original)
  try {
    await expect(importProject({ workspaceDirectory, filename: archive })).rejects.toThrow()
    expect(await readFile(archive)).toEqual(Buffer.from(original))
    await expect(
      extractImportAssets({ workspaceDirectory, id: "../../bad", groupIds: ["a".repeat(64)] }),
    ).rejects.toThrow()
    expect(await readFile(path.join(root, "outside.txt")).catch(() => undefined)).toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
