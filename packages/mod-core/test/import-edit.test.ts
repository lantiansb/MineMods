import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { strToU8, unzipSync, zipSync } from "fflate"
import {
  applyImportChanges,
  exportModifiedImport,
  getImportContext,
  getImportRevision,
  listImportRevisions,
  restoreModificationProject,
} from "../src/import-edit"
import { importProject } from "../src/import-project"

function classFixture() {
  const u1 = (value: number) => Buffer.from([value]),
    u2 = (value: number) => Buffer.from([value >> 8, value & 255]),
    u4 = (value: number) => Buffer.from([value >>> 24, value >>> 16, value >>> 8, value])
  const utf = (value: string) => Buffer.concat([u1(1), u2(value.length), Buffer.from(value)])
  const cp = [
    u1(7),
    u2(2),
    utf("C"),
    u1(7),
    u2(4),
    utf("java/lang/Object"),
    utf("load"),
    utf("()V"),
    utf("Code"),
    utf("tick"),
    utf("onEvent"),
  ]
  const code = Buffer.concat([u2(0), u2(1), u4(1), u1(177), u2(0), u2(0)])
  const method = (name: number) => Buffer.concat([u2(1), u2(name), u2(6), u2(1), u2(7), u4(code.length), code])
  return Buffer.concat([
    u4(0xcafebabe),
    u2(0),
    u2(61),
    u2(10),
    ...cp,
    u2(0x21),
    u2(1),
    u2(3),
    u2(0),
    u2(0),
    u2(3),
    method(5),
    method(8),
    method(9),
    u2(0),
  ])
}

test("reads bounded text evidence, applies immutable hash-checked revisions and exports archive and project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-edit-")),
    workspaceDirectory = path.join(root, "workspace"),
    archive = path.join(root, "pack.zip")
  await mkdir(workspaceDirectory)
  await writeFile(
    archive,
    zipSync({
      "manifest.json": strToU8(JSON.stringify({ minecraft: { version: "1.21.1", modLoaders: [] }, files: [] })),
      "kubejs/server_scripts/recipes.js": strToU8("ServerEvents.recipes(event => {})\n"),
      "config/sample.toml": strToU8("enabled = true\n"),
    }),
  )
  try {
    const imported = await importProject({ workspaceDirectory, filename: archive }),
      context = await getImportContext({ workspaceDirectory, id: imported.manifest.id })
    expect(context.sourceSha256).toBe(imported.manifest.source.sha256)
    expect(context.evidence.map((item) => item.path)).toContain("kubejs/server_scripts/recipes.js")
    const old = context.evidence.find((item) => item.path.endsWith("recipes.js"))!
    const changeset = {
      schema_version: 1 as const,
      id: crypto.randomUUID(),
      project_id: imported.manifest.id,
      source_sha256: imported.manifest.source.sha256,
      summary: "Update recipe script",
      warnings: [],
      changes: [
        {
          path: old.path,
          operation: "write" as const,
          expected_sha256: old.sha256,
          content: "ServerEvents.recipes(event => { event.remove({ output: 'minecraft:stone' }) })\n",
        },
        {
          path: "kubejs/server_scripts/custom.js",
          operation: "write" as const,
          expected_sha256: null,
          content: "console.log('new script')\n",
        },
        {
          path: "config/sample.toml",
          operation: "delete" as const,
          expected_sha256: context.evidence.find((item) => item.path === "config/sample.toml")!.sha256,
          content: null,
        },
      ],
    }
    const applied = await applyImportChanges({
      workspaceDirectory,
      id: imported.manifest.id,
      changeset,
      parentRevisionId: context.revisionId,
    })
    expect(applied.validation.valid).toBe(true)
    const countBeforeReplay = (await listImportRevisions({ workspaceDirectory, id: imported.manifest.id })).length
    const replay = await applyImportChanges({
      workspaceDirectory,
      id: imported.manifest.id,
      changeset,
      parentRevisionId: context.revisionId,
    })
    expect(replay.revisionId).toBe(applied.revisionId)
    expect((await listImportRevisions({ workspaceDirectory, id: imported.manifest.id })).length).toBe(countBeforeReplay)
    await expect(
      applyImportChanges({
        workspaceDirectory,
        id: imported.manifest.id,
        changeset: { ...changeset, summary: "Conflicting retry content" },
        parentRevisionId: context.revisionId,
      }),
    ).rejects.toThrow("Change set ID conflicts")
    await expect(
      applyImportChanges({
        workspaceDirectory,
        id: imported.manifest.id,
        changeset,
        parentRevisionId: applied.revisionId,
      }),
    ).rejects.toThrow("Change set ID conflicts")
    expect(
      (await getImportRevision({ workspaceDirectory, id: imported.manifest.id, revisionId: applied.revisionId }))
        .files[0]?.content,
    ).toContain("event.remove")
    const updatedContext = await getImportContext({ workspaceDirectory, id: imported.manifest.id })
    expect(updatedContext.revisionId).toBe(applied.revisionId)
    expect(updatedContext.evidence.find((item) => item.path === old.path)?.content).toContain("event.remove")
    await expect(
      applyImportChanges({
        workspaceDirectory,
        id: imported.manifest.id,
        changeset: { ...changeset, id: crypto.randomUUID() },
        parentRevisionId: context.revisionId,
      }),
    ).rejects.toThrow("revision changed")
    const out = path.join(root, "edited.zip")
    await exportModifiedImport({
      workspaceDirectory,
      id: imported.manifest.id,
      revisionId: applied.revisionId,
      destination: out,
      kind: "archive",
    })
    await expect(
      exportModifiedImport({
        workspaceDirectory,
        id: imported.manifest.id,
        revisionId: applied.revisionId,
        destination: out,
        kind: "archive",
      }),
    ).rejects.toThrow("already exists")
    await expect(
      exportModifiedImport({
        workspaceDirectory,
        id: imported.manifest.id,
        revisionId: applied.revisionId,
        destination: path.join(imported.directory, "inside.zip"),
        kind: "archive",
      }),
    ).rejects.toThrow("outside")
    const exported = unzipSync(await readFile(out))
    expect(new TextDecoder().decode(exported[old.path])).toContain("event.remove")
    expect(new TextDecoder().decode(exported["manifest.json"])).toContain("1.21.1")
    expect(new TextDecoder().decode(exported["kubejs/server_scripts/custom.js"])).toContain("new script")
    expect(exported["config/sample.toml"]).toBeUndefined()
    const share = path.join(root, "share.modwork")
    await exportModifiedImport({
      workspaceDirectory,
      id: imported.manifest.id,
      revisionId: applied.revisionId,
      destination: share,
      kind: "project",
    })
    const packaged = unzipSync(await readFile(share))
    expect(Object.keys(packaged)).toContain("source/pack.zip")
    expect(Object.keys(packaged)).toContain(
      `revision/revisions/${applied.revisionId}/files/kubejs/server_scripts/recipes.js`,
    )
    expect(new TextDecoder().decode(packaged["README.txt"])).toContain("licenses")
    const restoreWorkspace = path.join(root, "restored-workspace")
    await mkdir(restoreWorkspace)
    const restored = await restoreModificationProject({ workspaceDirectory: restoreWorkspace, filename: share })
    expect(restored.manifest.id).not.toBe(imported.manifest.id)
    expect(await readFile(path.join(restored.directory, "source", "pack.zip"))).toEqual(
      await readFile(path.join(imported.directory, "source", "pack.zip")),
    )
    const resumedContext = await getImportContext({ workspaceDirectory: restoreWorkspace, id: restored.manifest.id })
    expect(resumedContext.revisionId).toBe(applied.revisionId)
    const resumedEvidence = resumedContext.evidence.find((item) => item.path === old.path)!
    const secondChange = {
      ...changeset,
      id: crypto.randomUUID(),
      project_id: restored.manifest.id,
      changes: [
        {
          ...changeset.changes[0]!,
          expected_sha256: resumedEvidence.sha256,
          content: `${resumedEvidence.content}\n// resumed edit\n`,
        },
      ],
    }
    const resumed = await applyImportChanges({
      workspaceDirectory: restoreWorkspace,
      id: restored.manifest.id,
      changeset: secondChange,
      parentRevisionId: restored.revisionId,
    })
    const resumedArchive = path.join(root, "resumed.zip")
    await exportModifiedImport({
      workspaceDirectory: restoreWorkspace,
      id: restored.manifest.id,
      revisionId: resumed.revisionId,
      destination: resumedArchive,
      kind: "archive",
    })
    expect(new TextDecoder().decode(unzipSync(await readFile(resumedArchive))[old.path])).toContain("resumed edit")
    const mrpack = path.join(root, "edited.mrpack")
    await exportModifiedImport({
      workspaceDirectory,
      id: imported.manifest.id,
      revisionId: applied.revisionId,
      destination: mrpack,
      kind: "archive",
    })
    expect(unzipSync(await readFile(mrpack))["kubejs/server_scripts/custom.js"]).toBeDefined()
    const later = await applyImportChanges({
      workspaceDirectory,
      id: imported.manifest.id,
      parentRevisionId: applied.revisionId,
      changeset: {
        schema_version: 1,
        id: crypto.randomUUID(),
        project_id: imported.manifest.id,
        source_sha256: imported.manifest.source.sha256,
        summary: "A later independent change",
        warnings: [],
        changes: [
          {
            path: "kubejs/server_scripts/later.js",
            operation: "write",
            expected_sha256: null,
            content: "console.log('later')\n",
          },
        ],
      },
    })
    expect(later.parentRevisionId).toBe(applied.revisionId)
    const countBeforeOldReplay = (await listImportRevisions({ workspaceDirectory, id: imported.manifest.id })).length
    expect(
      (await applyImportChanges({ workspaceDirectory, id: imported.manifest.id, changeset, parentRevisionId: null }))
        .revisionId,
    ).toBe(applied.revisionId)
    expect((await listImportRevisions({ workspaceDirectory, id: imported.manifest.id })).length).toBe(
      countBeforeOldReplay,
    )
    await writeFile(
      path.join(imported.directory, "working", "revisions", applied.revisionId, "files", ...old.path.split("/")),
      "tampered content\n",
    )
    await expect(
      applyImportChanges({ workspaceDirectory, id: imported.manifest.id, changeset, parentRevisionId: null }),
    ).rejects.toThrow("Revision content has changed")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("removes invalidated signatures when exporting a modified signed JAR", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-edit-signed-")),
    workspaceDirectory = path.join(root, "workspace"),
    jar = path.join(root, "signed.jar")
  await mkdir(workspaceDirectory)
  await writeFile(
    jar,
    zipSync({
      "META-INF/MOD.SF": strToU8("signature"),
      "META-INF/MOD.RSA": strToU8("signature block"),
      "config/mod.toml": strToU8("enabled=true\n"),
    }),
  )
  try {
    const imported = await importProject({ workspaceDirectory, filename: jar }),
      context = await getImportContext({ workspaceDirectory, id: imported.manifest.id }),
      config = context.evidence[0]!
    const result = await applyImportChanges({
      workspaceDirectory,
      id: imported.manifest.id,
      parentRevisionId: null,
      changeset: {
        schema_version: 1,
        id: crypto.randomUUID(),
        project_id: imported.manifest.id,
        source_sha256: imported.manifest.source.sha256,
        summary: "Change config",
        warnings: [],
        changes: [
          { path: config.path, operation: "write", expected_sha256: config.sha256, content: "enabled=false\n" },
        ],
      },
    })
    const output = path.join(root, "edited.jar"),
      exported = await exportModifiedImport({
        workspaceDirectory,
        id: imported.manifest.id,
        revisionId: result.revisionId,
        destination: output,
        kind: "archive",
      })
    const entries = unzipSync(await readFile(output))
    expect(entries["META-INF/MOD.SF"]).toBeUndefined()
    expect(entries["META-INF/MOD.RSA"]).toBeUndefined()
    expect(Object.keys(entries).some((name) => name.startsWith("META-INF/MINEMODS-UNSIGNED-"))).toBe(true)
    expect(exported.warnings.length).toBe(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("finds nested instance KubeJS and pack metadata while reserving context for scripts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-edit-prefix-")),
    workspaceDirectory = path.join(root, "workspace"),
    archive = path.join(root, "nested.zip")
  await mkdir(workspaceDirectory)
  await writeFile(
    archive,
    zipSync({
      "overrides/config/ftbquests/quests/one.snbt": strToU8("x".repeat(24_000)),
      "overrides/config/ftbquests/quests/two.snbt": strToU8("y".repeat(24_000)),
      "overrides/.minecraft/kubejs/server_scripts/example.js": strToU8("ServerEvents.recipes(event => {})\n"),
      "overrides/.minecraft/pack.mcmeta": strToU8('{"pack":{"pack_format":15,"description":"sample"}}'),
    }),
  )
  try {
    const imported = await importProject({ workspaceDirectory, filename: archive }),
      context = await getImportContext({ workspaceDirectory, id: imported.manifest.id })
    expect(context.evidence.some((item) => item.path === "overrides/.minecraft/kubejs/server_scripts/example.js")).toBe(
      true,
    )
    expect(context.evidence.some((item) => item.path === "overrides/.minecraft/pack.mcmeta")).toBe(true)
    expect(
      context.evidence.filter((item) => item.kind === "quests").reduce((sum, item) => sum + item.content.length, 0),
    ).toBeLessThanOrEqual(20_000)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("skips default evidence decompression after its content quota is exhausted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-edit-budget-")),
    workspaceDirectory = path.join(root, "workspace"),
    archive = path.join(root, "pack.zip")
  await mkdir(workspaceDirectory)
  const oversized = new Uint8Array(65 * 1024 * 1024).fill(97)
  await writeFile(
    archive,
    zipSync({ "config/first.toml": strToU8("x".repeat(20_000)), "config/oversized.toml": oversized }),
  )
  try {
    const imported = await importProject({ workspaceDirectory, filename: archive }),
      context = await getImportContext({ workspaceDirectory, id: imported.manifest.id })
    expect(context.evidence.find((item) => item.path === "config/first.toml")?.content).toHaveLength(20_000)
    expect(context.evidence.some((item) => item.path === "config/oversized.toml")).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("indexes selected nested JAR entries and reads class method evidence without making it editable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-edit-nested-")),
    workspaceDirectory = path.join(root, "workspace"),
    archive = path.join(root, "pack.zip")
  await mkdir(workspaceDirectory)
  const nestedJar = zipSync({
    "com/example/MorphLoader.class": classFixture(),
    "com/example/MultiBlockRegistry.class": classFixture(),
    "config/morph.json": strToU8('{"enabled":true}'),
    "assets/example/lang/en_us.json": strToU8("{}"),
    "README.txt": strToU8("read me"),
  })
  await writeFile(archive, zipSync({ "overrides/mods/example.jar": nestedJar, "TopLoader.class": classFixture() }))
  try {
    const imported = await importProject({ workspaceDirectory, filename: archive }),
      id = imported.manifest.id
    const index = await getImportContext({
      workspaceDirectory,
      id,
      paths: ["overrides/mods/example.jar#find=morph", "overrides/mods/example.jar#find=multiblock"],
    })
    const indexes = index.evidence.filter((item) => item.kind === "archive-index")
    const morphIndex = indexes.find((item) => item.path.endsWith("#find=morph"))!
    const multiIndex = indexes.find((item) => item.path.endsWith("#find=multiblock"))!
    expect(indexes).toHaveLength(2)
    expect(morphIndex.id).not.toBe(multiIndex.id)
    expect(morphIndex.content).toContain("MorphLoader.class")
    expect(morphIndex.content).not.toContain("README.txt")
    expect(multiIndex.content).toContain("MultiBlockRegistry.class")
    expect(multiIndex.content).not.toContain("MorphLoader.class")
    const context = await getImportContext({
      workspaceDirectory,
      id,
      paths: [
        "overrides/mods/example.jar!/config/morph.json",
        "overrides/mods/example.jar!/com/example/MorphLoader.class#method=load",
        "overrides/mods/example.jar!/com/example/MorphLoader.class#method=tick",
        "overrides/mods/example.jar!/com/example/MorphLoader.class#method=onEvent",
        "TopLoader.class#method=load",
        "TopLoader.class#method=tick",
      ],
    })
    const bytecode = context.evidence.filter((item) => item.kind === "bytecode")
    expect(bytecode).toHaveLength(5)
    expect(new Set(bytecode.map((item) => item.id)).size).toBe(5)
    expect(bytecode.map((item) => item.path)).toContain(
      "overrides/mods/example.jar!/com/example/MorphLoader.class#method=load",
    )
    expect(bytecode.find((item) => item.path.endsWith("#method=load"))?.content).toContain('"name": "load"')
    expect(context.evidence.find((item) => item.path.endsWith("config/morph.json"))?.content).toContain(
      '"enabled":true',
    )
    const bytecodeEvidence = bytecode[0]!
    await expect(
      applyImportChanges({
        workspaceDirectory,
        id,
        parentRevisionId: null,
        changeset: {
          schema_version: 1,
          id: crypto.randomUUID(),
          project_id: id,
          source_sha256: imported.manifest.source.sha256,
          summary: "Try to change class",
          warnings: [],
          changes: [
            {
              path: bytecodeEvidence.path,
              operation: "write",
              expected_sha256: bytecodeEvidence.sha256,
              content: "not source",
            },
          ],
        },
      }),
    ).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("rejects unsafe, duplicate, and non-JSON JSON changes before saving a revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-edit-reject-")),
    workspaceDirectory = path.join(root, "workspace"),
    archive = path.join(root, "pack.zip")
  await mkdir(workspaceDirectory)
  await writeFile(archive, zipSync({ "config/settings.json": strToU8("{}") }))
  try {
    const project = await importProject({ workspaceDirectory, filename: archive }),
      base = {
        schema_version: 1,
        id: crypto.randomUUID(),
        project_id: project.manifest.id,
        source_sha256: project.manifest.source.sha256,
        summary: "Invalid changes",
        warnings: [],
      }
    const attempt = (changes: unknown[]) =>
      applyImportChanges({
        workspaceDirectory,
        id: project.manifest.id,
        changeset: { ...base, changes },
        parentRevisionId: null,
      })
    await expect(
      attempt([{ path: "../outside.txt", operation: "write", expected_sha256: null, content: "x" }]),
    ).rejects.toThrow("Unsafe import path")
    await expect(
      attempt([{ path: "config/settings.json", operation: "write", expected_sha256: null, content: "{" }]),
    ).rejects.toThrow()
    expect(await readFile(path.join(project.directory, "working", "revisions")).catch(() => undefined)).toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
