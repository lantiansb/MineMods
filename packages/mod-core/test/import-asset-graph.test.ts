import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { strToU8, zipSync } from "fflate"
import { extractImportAssets, getImportAssetRoot, getImportAssetSelection } from "../src/import-assets"
import { importProject } from "../src/import-project"
import { ImportedAssetCatalogSchema } from "../src/import-assets"
import { ImportAssetGraphSchema, buildGraph, buildImportAssetGraph } from "../src/import-asset-graph"

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")
const projectId = "513143d9-7c36-4d17-a6d0-5faee5be0e32"
const entries = [
  {
    path: "assets/examplemod/models/item/charm.json",
    resourcePath: "assets/examplemod/models/item/charm.json",
    kind: "model" as const,
    text: JSON.stringify({ parent: "item/generated", textures: { layer0: "examplemod:item/charm" } }),
  },
  {
    path: "assets/examplemod/textures/item/charm.png",
    resourcePath: "assets/examplemod/textures/item/charm.png",
    kind: "texture" as const,
    text: "texture bytes",
  },
  {
    path: "duplicate.jar!/assets/examplemod/textures/item/charm.png",
    resourcePath: "assets/examplemod/textures/item/charm.png",
    kind: "texture" as const,
    text: "duplicate texture bytes",
    group: "duplicate",
  },
  {
    path: "assets/examplemod/textures/item/charm.png.mcmeta",
    resourcePath: "assets/examplemod/textures/item/charm.png.mcmeta",
    kind: "data" as const,
    text: JSON.stringify({ animation: { frametime: 3, frames: [0, 1, { index: 2, time: 7 }] } }),
  },
  {
    path: "assets/examplemod/sounds.json",
    resourcePath: "assets/examplemod/sounds.json",
    kind: "data" as const,
    text: JSON.stringify({
      "casket.open": {
        sounds: [{ name: "examplemod:random/casket/open" }, { name: "casket.closed", type: "event" }],
      },
      "casket.closed": { sounds: [{ name: "examplemod:random/casket/close" }] },
    }),
  },
  {
    path: "assets/examplemod/sounds/random/casket/open.ogg",
    resourcePath: "assets/examplemod/sounds/random/casket/open.ogg",
    kind: "audio" as const,
    text: "audio bytes",
  },
  {
    path: "data/examplemod/dimension/dark_forest.json",
    resourcePath: "data/examplemod/dimension/dark_forest.json",
    kind: "data" as const,
    text: JSON.stringify({
      biome: "examplemod:dark_forest",
      generator: {
        codec: { type: "examplemod:not_a_biome" },
        wrapped_generator: {
          biome_source: {
            biome_landscape: [
              { key_biome: "examplemod:dark_forest", biome_layers: { "0": "examplemod:dark_forest" } },
            ],
          },
        },
      },
    }),
  },
  {
    path: "data/examplemod/worldgen/biome/dark_forest.json",
    resourcePath: "data/examplemod/worldgen/biome/dark_forest.json",
    kind: "data" as const,
    text: JSON.stringify({ spawners: { monster: [{ type: "examplemod:serpent" }] } }),
  },
]
const catalog = ImportedAssetCatalogSchema.parse({
  schemaVersion: 1,
  projectId,
  sourceSha256: sha256("project"),
  createdAt: "2026-10-03T00:00:00.000Z",
  groups: [
    {
      id: sha256("group"),
      name: "fixture.jar",
      kind: "mod",
      path: "fixture.jar",
      bytes: 100,
      description: "fixture",
    },
    {
      id: sha256("duplicate-group"),
      name: "duplicate.jar",
      kind: "mod",
      path: "duplicate.jar",
      bytes: 100,
      description: "duplicate fixture",
    },
  ],
  assets: entries
    .map((entry, index) => ({
      id: sha256(entry.path),
      path: entry.path,
      resourcePath: entry.resourcePath,
      sourcePath: entry.group === "duplicate" ? entry.path : `fixture.jar!/${entry.path}`,
      groupId: entry.group === "duplicate" ? sha256("duplicate-group") : sha256("group"),
      kind: entry.kind,
      format: entry.path.split(".").at(-1)!,
      name: entry.path.split("/").at(-1)!,
      namespace: "examplemod",
      bytes: Buffer.byteLength(entry.text),
      sha256: sha256(entry.text),
      dependencies: [],
      origin: "mod",
      _index: index,
      group: entry.group,
    }))
    .map(({ _index, group: _group, ...asset }) => asset),
  warnings: [],
})

test("buildGraph links only JSON-declared model, audio, dimension, and spawner resources", async () => {
  const contents = new Map(entries.map((entry) => [sha256(entry.path), Buffer.from(entry.text)])),
    graph = await buildGraph({ catalog, readBytes: async (assetId) => contents.get(assetId)! })

  expect(graph.edges.some((edge) => edge.type === "uses_model" && edge.relationStatus === "verified")).toBe(true)
  expect(graph.edges.some((edge) => edge.type === "uses_texture" && edge.relationStatus === "candidate")).toBe(true)
  expect(
    graph.nodes.some(
      (node) =>
        node.kind === "texture" &&
        node.metadata.ambiguousSource === true &&
        Array.isArray(node.metadata.sourceAssetIds),
    ),
  ).toBe(true)
  expect(
    graph.nodes.some(
      (node) =>
        node.kind === "animation" && node.metadata.animationMode === "texture_frames" && node.metadata.frameCount === 3,
    ),
  ).toBe(true)
  expect(
    graph.nodes.find((node) => node.kind === "animation" && node.metadata.animationMode === "texture_frames")?.metadata
      .frametime,
  ).toBe(3)
  expect(
    graph.edges.some((edge) => edge.type === "has_animation" && edge.evidence[0]?.jsonPointer === "/animation"),
  ).toBe(true)
  expect(graph.edges.some((edge) => edge.type === "plays_sound" && edge.relationStatus === "verified")).toBe(true)
  expect(
    graph.edges.some(
      (edge) => edge.type === "plays_sound" && graph.nodes.find((node) => node.id === edge.to)?.kind === "sound",
    ),
  ).toBe(true)
  expect(
    graph.nodes.find((node) => node.kind === "sound" && node.resourceId === "examplemod:casket.closed")?.metadata
      .available,
  ).toBe(true)
  expect(graph.edges.some((edge) => edge.type === "references" && edge.evidence[0]?.jsonPointer === "/biome")).toBe(
    true,
  )
  expect(
    graph.edges.some(
      (edge) =>
        edge.type === "belongs_to" &&
        edge.evidence.some((proof) => proof.jsonPointer?.includes("/biome_source/biome_landscape/0/key_biome")),
    ),
  ).toBe(true)
  expect(graph.nodes.some((node) => node.kind === "biome" && node.resourceId === "examplemod:not_a_biome")).toBe(
    false,
  )
  expect(
    graph.edges.some(
      (edge) => edge.type === "spawns_in" && edge.evidence[0]?.jsonPointer === "/spawners/monster/0/type",
    ),
  ).toBe(true)
  expect(
    graph.nodes.some(
      (node) => node.kind === "entity" && node.resourceId === "examplemod:serpent" && node.sourceAssetId === null,
    ),
  ).toBe(true)
  expect(() =>
    ImportAssetGraphSchema.parse({
      ...graph,
      edges: [...graph.edges, { ...graph.edges[0], id: "dangling", from: "missing" }],
    }),
  ).toThrow(/dangling edge/i)
})

test("fresh modpack graph analysis reads selected nested JAR classes without a reverse project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-asset-graph-nested-")),
    workspaceDirectory = path.join(root, "workspace"),
    archive = path.join(root, "pack.zip"),
    javaClass = Buffer.from(
      "yv66vgAAAD0ACwoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWBwAIAQASZGVtby9OZXN0ZWRGaXh0dXJlAQAEQ29kZQEACXNldHVwQW5pbQAhAAcAAgAAAAAAAgABAAUABgABAAkAAAARAAEAAQAAAAUqtwABsQAAAAAAAQAKAAYAAQAJAAAADQAAAAEAAAABsQAAAAAAAA==",
      "base64",
    ),
    nestedJar = zipSync({
      "demo/NestedFixture.class": javaClass,
      "assets/demo/models/item/test.json": strToU8(JSON.stringify({ textures: { layer0: "demo:item/test" } })),
    })
  await mkdir(workspaceDirectory)
  await writeFile(archive, zipSync({ "mods/nested.jar": nestedJar }))
  try {
    const imported = await importProject({ workspaceDirectory, filename: archive }),
      input = { workspaceDirectory, id: imported.manifest.id },
      selection = await getImportAssetSelection(input),
      mod = selection.groups.find((group) => group.kind === "mod")!
    await extractImportAssets({ ...input, groupIds: [mod.id] })
    const graph = await buildImportAssetGraph(input)
    expect(graph.coverage.availableClasses).toBe(1)
    expect(graph.coverage.inspectedClasses).toBe(1)
    expect(
      graph.nodes.some((node) => node.kind === "animation" && node.resourceId === "demo.NestedFixture#setupAnim"),
    ).toBe(true)
    expect(
      graph.nodes.find((node) => node.kind === "animation" && node.resourceId === "demo.NestedFixture#setupAnim")
        ?.sourcePath,
    ).toBe("mods/nested.jar!/demo/NestedFixture.class")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("nested archive failure disposes opened providers and removes its temporary extraction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-asset-graph-cleanup-")),
    workspaceDirectory = path.join(root, "workspace"),
    archive = path.join(root, "pack.zip"),
    goodJar = zipSync({
      "demo/NestedFixture.class": Buffer.from(
        "yv66vgAAAD0ACwoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWBwAIAQASZGVtby9OZXN0ZWRGaXh0dXJlAQAEQ29kZQEACXNldHVwQW5pbQAhAAcAAgAAAAAAAgABAAUABgABAAkAAAARAAEAAQAAAAUqtwABsQAAAAAAAQAKAAYAAQAJAAAADQAAAAEAAAABsQAAAAAAAA==",
        "base64",
      ),
      "assets/demo/models/item/test.json": strToU8("{}"),
    }),
    badJar = zipSync({ "assets/demo/models/item/bad.json": strToU8("{}") })
  await mkdir(workspaceDirectory)
  await writeFile(archive, zipSync({ "mods/a-good.jar": goodJar, "mods/z-bad.jar": badJar }))
  try {
    const imported = await importProject({ workspaceDirectory, filename: archive }),
      input = { workspaceDirectory, id: imported.manifest.id },
      selection = await getImportAssetSelection(input),
      good = selection.groups.find((group) => group.path === "mods/a-good.jar")!,
      bad = selection.groups.find((group) => group.path === "mods/z-bad.jar")!
    await extractImportAssets({ ...input, groupIds: [good.id] })
    const assetRoot = await getImportAssetRoot(input),
      catalogPath = path.join(assetRoot, "manifest.json"),
      catalog = JSON.parse(await readFile(catalogPath, "utf8"))
    catalog.groups.push({ ...bad, bytes: bad.bytes + 1 })
    await writeFile(catalogPath, JSON.stringify(catalog))
    await expect(buildImportAssetGraph(input)).rejects.toThrow(/nested JAR size mismatch/i)
    const cacheRoot = path.join(workspaceDirectory, "analysis-projects", input.id, ".cache", "import-asset-graph")
    expect((await readdir(cacheRoot)).filter((name) => name.startsWith("selected-"))).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
