import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { strToU8, zipSync } from "fflate"
import {
  clearImportCache,
  deleteImportProject,
  exportImportReport,
  getImportProject,
  importProject,
  listImportProjects,
  listImportProjectIssues,
} from "../src/import-project"

test("imports a real zip as a persistent bounded scan report without extracting its contents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-project-"))
  const archive = path.join(root, "legacy.zip")
  await mkdir(path.join(root, "workspace"))
  await writeFile(
    archive,
    zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          minecraft: { version: "1.20.1", modLoaders: [{ id: "forge-47.2.0", primary: true }] },
          files: [{ projectID: 123, fileID: 456 }],
        }),
      ),
      "config/example.toml": strToU8("enabled = true\n"),
      "defaultconfigs/mod.cfg": strToU8("setting=true\n"),
      "kubejs/server_scripts/example.js": strToU8("ServerEvents.recipes(event => {})\n"),
      "overrides/mods/example.jar": zipSync({
        "fabric.mod.json": strToU8(
          JSON.stringify({ id: "sample", name: "Sample", version: "1.0", depends: { minecraft: "1.20.1" } }),
        ),
      }),
    }),
  )
  try {
    const imported = await importProject({ workspaceDirectory: path.join(root, "workspace"), filename: archive })
    expect(imported.report.id).toBe(imported.manifest.id)
    expect(imported.report.source.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(imported.report.metadata.minecraft_versions).toContain("1.20.1")
    expect(imported.report.metadata.dependency_files).toEqual(["CurseForge:123:456"])
    expect(imported.report.metadata.included_files).toContain("overrides/mods/example.jar")
    expect(imported.report.metadata.dependencies_missing).toBe(true)
    expect(imported.report.categories.config.entries).toContain("config/example.toml")
    expect(imported.report.categories.defaultconfigs.entries).toContain("defaultconfigs/mod.cfg")
    expect(imported.report.categories.kubejs.entries).toContain("kubejs/server_scripts/example.js")
    expect(imported.report.mods.some((mod) => mod.id === "sample" && mod.source === "included_nested_jar")).toBe(true)
    expect(await readFile(path.join(imported.directory, "source", "legacy.zip"))).toEqual(await readFile(archive))
    await expect(readFile(path.join(imported.directory, "config", "example.toml"))).rejects.toThrow()
    expect((await getImportProject(path.join(root, "workspace"), imported.manifest.id)).report).toEqual(imported.report)
    expect((await listImportProjects(path.join(root, "workspace"))).length).toBe(1)
    const exported = path.join(root, "report.modscan")
    await exportImportReport({
      workspaceDirectory: path.join(root, "workspace"),
      id: imported.manifest.id,
      destination: exported,
    })
    const share = JSON.parse(await readFile(exported, "utf8"))
    expect(share.report).toEqual(imported.report)
    expect(share.format).toBe("minemods-import-report")
    await mkdir(path.join(root, "workspace", "analysis-projects", ".cache"))
    await writeFile(path.join(root, "workspace", "analysis-projects", ".cache", "tmp"), "cache")
    expect(await clearImportCache(path.join(root, "workspace"), imported.manifest.id)).toEqual({ cleared: true })
    expect((await getImportProject(path.join(root, "workspace"), imported.manifest.id)).report.id).toBe(
      imported.report.id,
    )
    await deleteImportProject(path.join(root, "workspace"), imported.manifest.id)
    expect(await listImportProjects(path.join(root, "workspace"))).toHaveLength(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("rejects unsafe archive paths before creating an analysis project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-unsafe-")),
    archive = path.join(root, "unsafe.zip")
  await mkdir(path.join(root, "workspace"))
  await writeFile(archive, zipSync({ "../escape.txt": strToU8("bad"), "manifest.json": strToU8("{}") }))
  try {
    await expect(
      importProject({ workspaceDirectory: path.join(root, "workspace"), filename: archive }),
    ).rejects.toThrow()
    expect(await listImportProjects(path.join(root, "workspace"))).toHaveLength(0)
    expect(await readFile(path.join(root, "escape.txt")).catch(() => undefined)).toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("reads loader-specific mod metadata and distinguishes Modrinth downloads from bundled overrides", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-modrinth-")),
    archive = path.join(root, "pack.mrpack")
  await mkdir(path.join(root, "workspace"))
  await writeFile(
    archive,
    zipSync({
      "modrinth.index.json": strToU8(
        JSON.stringify({
          formatVersion: 1,
          game: "minecraft",
          versionId: "pack",
          dependencies: { minecraft: "1.20.1", forge: "47.2.0" },
          files: [
            { path: "mods/remote.jar", downloads: ["https://example.invalid/mod.jar"], fileSize: 1 },
            { path: "mods/absent.jar", downloads: ["https://example.invalid/absent.jar"], fileSize: 2 },
          ],
        }),
      ),
      "overrides/mods/remote.jar": zipSync({
        "fabric.mod.json": strToU8(JSON.stringify({ id: "bundled", version: "1", depends: { minecraft: ">=1.20" } })),
      }),
      "overrides/kubejs/server_scripts/change.js": strToU8("ServerEvents.recipes(event => {})"),
      "overrides/config/ftbquests/quests/quest.snbt": strToU8("{}"),
      "META-INF/mods.toml": strToU8(
        'modLoader="javafml"\nloaderVersion="[47,)"\nlicense="All Rights Reserved"\n[[mods]]\nmodId="tomlmod"\ndisplayName="TOML Mod"\nversion="2.0"\n[[dependencies.tomlmod]]\nmodId="minecraft"\nmandatory=true\nversionRange="[1.20.1,1.21)"\n',
      ),
    }),
  )
  try {
    const { report } = await importProject({ workspaceDirectory: path.join(root, "workspace"), filename: archive })
    expect(report.metadata.loaders).toContain("forge")
    expect(report.metadata.loader_versions).toContainEqual({
      loader: "forge",
      version: "47.2.0",
      evidence: "modrinth.index.json",
    })
    expect(report.metadata.minecraft_versions).toEqual(["1.20.1"])
    expect(report.metadata.dependencies_missing).toBe(true)
    expect(report.metadata.dependency_status).toBe("external_required")
    expect(report.metadata.dependency_files).toEqual(["Modrinth:mods/remote.jar", "Modrinth:mods/absent.jar"])
    expect(report.metadata.included_files).toContain("overrides/mods/remote.jar")
    expect(report.mods).toContainEqual(
      expect.objectContaining({
        id: "tomlmod",
        name: "TOML Mod",
        minecraft: "[1.20.1,1.21)",
        dependencies: [{ id: "minecraft", version_range: "[1.20.1,1.21)", mandatory: true }],
      }),
    )
    expect(report.mods.some((mod) => mod.id === "bundled" && mod.source === "included_nested_jar")).toBe(true)
    expect(report.categories.kubejs.entries).toContain("overrides/kubejs/server_scripts/change.js")
    expect(report.categories.quests.entries).toContain("overrides/config/ftbquests/quests/quest.snbt")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("rejects case-colliding and symbolic-link ZIP entries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-zip-safety-")),
    workspace = path.join(root, "workspace")
  await mkdir(workspace)
  try {
    const collision = path.join(root, "collision.zip")
    await writeFile(collision, zipSync({ "Mods/Alpha.jar": strToU8("a"), "mods/alpha.jar": strToU8("b") }))
    await expect(importProject({ workspaceDirectory: workspace, filename: collision })).rejects.toThrow(
      "Duplicate case-insensitive",
    )
    const link = path.join(root, "link.zip"),
      bytes = zipSync({ "link.txt": strToU8("target") })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let offset = 0; offset + 46 < bytes.length; offset++) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue
      view.setUint16(offset + 4, 0x0314, true)
      view.setUint32(offset + 38, 0xa1ff0000, true)
      break
    }
    await writeFile(link, bytes)
    await expect(importProject({ workspaceDirectory: workspace, filename: link })).rejects.toThrow(
      "Symbolic links are not allowed",
    )
    expect(await listImportProjects(workspace)).toHaveLength(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("lists valid projects while reporting a corrupt project independently", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-issues-")),
    workspace = path.join(root, "workspace"),
    archive = path.join(root, "pack.zip")
  await mkdir(workspace)
  await writeFile(
    archive,
    zipSync({
      "manifest.json": strToU8(JSON.stringify({ minecraft: { version: "1.20.1", modLoaders: [] }, files: [] })),
    }),
  )
  try {
    const imported = await importProject({ workspaceDirectory: workspace, filename: archive })
    await mkdir(path.join(workspace, "analysis-projects", "00000000-0000-4000-8000-000000000001"))
    expect((await listImportProjects(workspace)).map((project) => project.manifest.id)).toEqual([imported.manifest.id])
    expect(await listImportProjectIssues(workspace)).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "00000000-0000-4000-8000-000000000001",
        message: "工程文件损坏或不可读取",
      },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("cancels a scan from progress and removes its staging directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-abort-")),
    workspace = path.join(root, "workspace"),
    archive = path.join(root, "pack.zip"),
    controller = new AbortController()
  await mkdir(workspace)
  await writeFile(
    archive,
    zipSync({ "a.txt": strToU8("first"), "b.txt": strToU8("second"), "manifest.json": strToU8("{}") }),
  )
  try {
    await expect(
      importProject({
        workspaceDirectory: workspace,
        filename: archive,
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toThrow()
    expect(await readdir(path.join(workspace, "analysis-projects"))).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("cancels an active nested archive read and removes its staging directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-read-abort-")),
    workspace = path.join(root, "workspace"),
    archive = path.join(root, "pack.zip"),
    controller = new AbortController()
  await mkdir(workspace)
  const nested = zipSync({ "payload.bin": new Uint8Array(16 * 1024 * 1024) }, { level: 0 })
  await writeFile(archive, zipSync({ "a.txt": strToU8("first"), "mods/large.jar": nested }, { level: 0 }))
  try {
    let firstProgress = true
    await expect(
      importProject({
        workspaceDirectory: workspace,
        filename: archive,
        signal: controller.signal,
        onProgress: () => {
          if (firstProgress) {
            firstProgress = false
            setTimeout(() => controller.abort(), 0)
          }
        },
      }),
    ).rejects.toThrow()
    expect(await readdir(path.join(workspace, "analysis-projects"))).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("derives Minecraft and loader metadata for a standalone Fabric jar", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-fabric-")),
    workspace = path.join(root, "workspace"),
    archive = path.join(root, "fabric.jar")
  await mkdir(workspace)
  await writeFile(
    archive,
    zipSync({
      "fabric.mod.json": strToU8(
        JSON.stringify({
          id: "sample",
          name: "Sample",
          version: "1.0",
          depends: { minecraft: "1.21.1", fabricloader: ">=0.16.0" },
        }),
      ),
    }),
  )
  try {
    const { report } = await importProject({ workspaceDirectory: workspace, filename: archive })
    expect(report.metadata.minecraft_versions).toEqual(["1.21.1"])
    expect(report.metadata.loaders).toEqual(["fabric"])
    expect(report.mods[0]?.dependencies).toContainEqual({ id: "minecraft", version_range: "1.21.1", mandatory: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("infers a missing pack loader from bundled nested mod metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-nested-loader-")),
    workspace = path.join(root, "workspace"),
    archive = path.join(root, "pack.zip")
  await mkdir(workspace)
  await writeFile(
    archive,
    zipSync({
      "manifest.json": strToU8(JSON.stringify({ minecraft: { version: "1.20.1", modLoaders: [] }, files: [] })),
      "overrides/mods/example.jar": zipSync({
        "fabric.mod.json": strToU8(JSON.stringify({ id: "sample", version: "1", depends: { minecraft: ">=1.19" } })),
      }),
    }),
  )
  try {
    const { report } = await importProject({ workspaceDirectory: workspace, filename: archive })
    expect(report.metadata.loaders).toEqual(["fabric"])
    expect(report.metadata.minecraft_versions).toEqual(["1.20.1"])
    expect(report.mods.find((mod) => mod.id === "sample")?.minecraft).toBe(">=1.19")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
