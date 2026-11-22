import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { strToU8, unzipSync, zipSync } from "fflate"
import { importProject } from "../src/import-project"
import { applyImportChanges, getImportContext } from "../src/import-edit"
import {
  applyReverseChanges,
  buildReverseModule,
  exportReverseProject,
  getReverseProject,
  listReverseFiles,
  prepareReverseProject,
  readReverseFile,
  reverseFileList,
  restoreReverseProject,
} from "../src/reverse-project"
import { runOwnedProcess } from "../src/runtime"
import { prepareReverseTools } from "../src/reverse-tools"

const workspace = (root: string) => path.join(root, "workspace")
const runtime = (root: string) => path.join(root, "runtime")
const jdk = [
  process.env.JAVA_HOME,
  path.resolve(import.meta.dir, "../../../.artifacts/dragon-extension/toolchain/jdk-17.0.20.1+1"),
]
  .filter((candidate): candidate is string => Boolean(candidate))
  .find((candidate) => existsSync(path.join(candidate, "bin", process.platform === "win32" ? "javac.exe" : "javac")))

test("resource-only ZIP reverses and exports without Java tools", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods reverse resources-")),
    source = path.join(root, "pack.zip")
  await mkdir(workspace(root), { recursive: true })
  await writeFile(
    source,
    zipSync({
      "config/example.txt": strToU8("before"),
      "assets/pixel.png": new Uint8Array([0, 255, 1, 2]),
      "META-INF/MANIFEST.MF": strToU8(
        "Manifest-Version: 1.0\r\nName: config/example.txt\r\nSHA-256-Digest: stale\r\n\r\n",
      ),
      "META-INF/TEST.SF": strToU8("signature"),
    }),
  )
  try {
    const imported = await importProject({ workspaceDirectory: workspace(root), filename: source })
    expect(await getReverseProject({ workspaceDirectory: workspace(root), id: imported.manifest.id })).toBeNull()
    const prepared = await prepareReverseProject({
      workspaceDirectory: workspace(root),
      id: imported.manifest.id,
      runtimeDirectory: runtime(root),
    })
    expect(prepared.project.modules).toEqual([])
    const file = await readReverseFile({
      workspaceDirectory: workspace(root),
      id: imported.manifest.id,
      path: "archive/config/example.txt",
    })
    await applyReverseChanges({
      workspaceDirectory: workspace(root),
      id: imported.manifest.id,
      changes: [
        { path: file.path, operation: "write", expectedSha256: file.sha256, encoding: "utf8", content: "after" },
      ],
    })
    const output = path.join(root, "out.zip")
    await exportReverseProject({
      workspaceDirectory: workspace(root),
      id: imported.manifest.id,
      destination: output,
      kind: "archive",
    })
    const entries = unzipSync(await readFile(output))
    expect(new TextDecoder().decode(entries["config/example.txt"])).toBe("after")
    expect([...entries["assets/pixel.png"]!]).toEqual([0, 255, 1, 2])
    expect(entries["META-INF/TEST.SF"]).toBeUndefined()
    expect(new TextDecoder().decode(entries["META-INF/MANIFEST.MF"])).not.toContain("Digest")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("nested resource edits invalidate outer signatures and restore rejects unsafe manifests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-reverse-nested-")),
    workspaceDir = workspace(root),
    source = path.join(root, "pack.zip")
  await mkdir(workspaceDir, { recursive: true })
  const inner = zipSync({
    "config/value.txt": strToU8("before"),
    "META-INF/MANIFEST.MF": strToU8("Manifest-Version: 1.0\r\nName: config/value.txt\r\nSHA-256-Digest: stale\r\n\r\n"),
    "META-INF/INNER.SF": strToU8("inner signature"),
  })
  await writeFile(
    source,
    zipSync({
      "mods/fixture.jar": inner,
      "META-INF/MANIFEST.MF": strToU8(
        "Manifest-Version: 1.0\r\nName: mods/fixture.jar\r\nSHA-256-Digest: stale\r\n\r\n",
      ),
      "META-INF/OUTER.SF": strToU8("outer signature"),
    }),
  )
  try {
    const imported = await importProject({ workspaceDirectory: workspaceDir, filename: source }),
      id = imported.manifest.id
    const prepared = await prepareReverseProject({
        workspaceDirectory: workspaceDir,
        id,
        runtimeDirectory: runtime(root),
      }),
      module = prepared.project.modules[0]!
    expect(module.placements[0]?.archivePath).toBe("mods/fixture.jar")
    const resource = await readReverseFile({
      workspaceDirectory: workspaceDir,
      id,
      path: `${module.resourceRoot}/config/value.txt`,
    })
    await applyReverseChanges({
      workspaceDirectory: workspaceDir,
      id,
      changes: [
        {
          path: resource.path,
          operation: "write",
          expectedSha256: resource.sha256,
          encoding: "utf8",
          content: "after",
        },
      ],
    })
    const output = path.join(root, "out.zip")
    await exportReverseProject({ workspaceDirectory: workspaceDir, id, destination: output, kind: "archive" })
    const exported = unzipSync(await readFile(output)),
      exportedInner = unzipSync(exported["mods/fixture.jar"]!)
    expect(exported["META-INF/OUTER.SF"]).toBeUndefined()
    expect(new TextDecoder().decode(exported["META-INF/MANIFEST.MF"])).not.toContain("Digest")
    expect(exportedInner["META-INF/INNER.SF"]).toBeUndefined()
    expect(new TextDecoder().decode(exportedInner["config/value.txt"]!)).toBe("after")

    const share = path.join(root, "project.modreverse")
    await exportReverseProject({ workspaceDirectory: workspaceDir, id, destination: share, kind: "project" })
    const bundle = unzipSync(await readFile(share)),
      originalManifest = JSON.parse(new TextDecoder().decode(bundle["manifest.json"]!))
    const hostile = async (change: (manifest: typeof originalManifest) => void, expected: string) => {
      const altered = structuredClone(originalManifest)
      change(altered)
      const filename = path.join(root, `hostile-${expected.replaceAll(" ", "-")}.modreverse`)
      await writeFile(filename, zipSync({ ...bundle, "manifest.json": strToU8(JSON.stringify(altered)) }))
      await expect(restoreReverseProject({ workspaceDirectory: workspaceDir, filename })).rejects.toThrow(expected)
    }
    await hostile((manifest) => {
      manifest.source.filename = "../../outside.jar"
    }, "unsafe source filename")
    await hostile((manifest) => {
      manifest.modules[0].placements[0].parentModuleId = manifest.modules[0].id
    }, "placements contain a cycle")
    await hostile((manifest) => {
      manifest.modules[0].build.outputJarPath = "modules/elsewhere/build/current/module.jar"
    }, "invalid module build output path")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("reverse file listing scopes directory prefixes and keeps the sorted limit", async () => {
  const pathFor = (index: number) => `generated/item-${String(index).padStart(5, "0")}.txt`
  const files = reverseFileList<{ path: string }>()
  // In reverse order the final paths actually replace entries in the full heap.
  for (let index = 10_004; index >= 0; index -= 1) files.add({ path: `archive/${pathFor(index)}` })
  const bounded = files.sorted()
  expect(bounded).toHaveLength(10_000)
  expect(bounded[0]?.path).toBe("archive/generated/item-00000.txt")
  expect(bounded.at(-1)?.path).toBe("archive/generated/item-09999.txt")

  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-reverse-list-")),
    workspaceDir = workspace(root),
    source = path.join(root, "many.zip")
  await mkdir(workspaceDir, { recursive: true })
  const entries = Object.fromEntries(
    [0, 9_999, 10_000, 10_001, 10_002, 10_003, 10_004].map((index) => [pathFor(index), strToU8(String(index))]),
  )
  await writeFile(source, zipSync(entries))
  try {
    const imported = await importProject({ workspaceDirectory: workspaceDir, filename: source }),
      id = imported.manifest.id
    await prepareReverseProject({ workspaceDirectory: workspaceDir, id, runtimeDirectory: runtime(root) })
    expect((await listReverseFiles({ workspaceDirectory: workspaceDir, id, prefix: "archive/generated" })).map((file) => file.path))
      .toEqual(Object.keys(entries).sort().map((file) => `archive/${file}`))
    const partialName = await listReverseFiles({
      workspaceDirectory: workspaceDir,
      id,
      prefix: "archive/generated/item-1000",
    })
    expect(partialName.map((file) => file.path)).toEqual(
      Array.from({ length: 5 }, (_, index) => `archive/generated/item-${String(10_000 + index).padStart(5, "0")}.txt`),
    )
    await mkdir(path.join(imported.directory, "reverse", "archive"), { recursive: true })
    await writeFile(path.join(imported.directory, "reverse", "archive", "generatedSibling.txt"), "sibling")
    expect(
      (await listReverseFiles({ workspaceDirectory: workspaceDir, id, prefix: "archive/generatedSib" })).map(
        (file) => file.path,
      ),
    ).toEqual(["archive/generatedSibling.txt"])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)

test("reverse preparation inherits and records the latest import text revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-reverse-revision-")),
    workspaceDir = workspace(root),
    source = path.join(root, "pack.zip")
  await mkdir(workspaceDir, { recursive: true })
  await writeFile(source, zipSync({ "config/sample.toml": strToU8("enabled = true\n") }))
  try {
    const imported = await importProject({ workspaceDirectory: workspaceDir, filename: source }),
      id = imported.manifest.id,
      context = await getImportContext({ workspaceDirectory: workspaceDir, id }),
      evidence = context.evidence.find((item) => item.path === "config/sample.toml")!
    const revision = await applyImportChanges({
      workspaceDirectory: workspaceDir,
      id,
      parentRevisionId: context.revisionId,
      changeset: {
        schema_version: 1,
        id: crypto.randomUUID(),
        project_id: id,
        source_sha256: context.sourceSha256,
        summary: "Toggle resource",
        warnings: [],
        changes: [
          { path: evidence.path, operation: "write", expected_sha256: evidence.sha256, content: "enabled = false\n" },
        ],
      },
    })
    const prepared = await prepareReverseProject({
      workspaceDirectory: workspaceDir,
      id,
      runtimeDirectory: runtime(root),
    })
    expect(prepared.project.baseImportRevisionId).toBe(revision.revisionId)
    expect(
      (await readReverseFile({ workspaceDirectory: workspaceDir, id, path: "archive/config/sample.toml" })).content,
    ).toBe("enabled = false\n")
    expect(
      (await readFile(path.join(imported.directory, "reverse", "original", "pack.zip"))).equals(await readFile(source)),
    ).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test.skipIf(!jdk)(
  "compiled module export preserves resources and survives share restore",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods reverse jar-")),
      workspaceDir = workspace(root),
      runtimeDirectory = runtime(root)
    await mkdir(workspaceDir, { recursive: true })
    const tools = await prepareReverseTools({ runtimeDirectory, javaHome: jdk }),
      sourceRoot = path.join(root, "src", "fixture"),
      classes = path.join(root, "classes")
    await mkdir(sourceRoot, { recursive: true })
    await mkdir(classes, { recursive: true })
    const java = path.join(sourceRoot, "Hello.java")
    await writeFile(
      java,
      'package fixture; public final class Hello { static final class Inner {} public String value() { return "before"; } public static void main(String[] args) { System.out.print(new Hello().value()); } }\n',
    )
    const staleJava = path.join(sourceRoot, "Stale.java")
    await writeFile(staleJava, "package fixture; public final class Stale {}\n")
    const compiled = await runOwnedProcess(tools.javacExecutable, [
      "-encoding",
      "UTF-8",
      "--release",
      "17",
      "-d",
      classes,
      java,
      staleJava,
    ])
    expect(compiled.code).toBe(0)
    const dependencyJar = path.join(root, "external.jar")
    await writeFile(
      dependencyJar,
      zipSync({ "fixture/Stale.class": new Uint8Array(await readFile(path.join(classes, "fixture", "Stale.class"))) }),
    )
    const jar = path.join(root, "fixture.jar")
    await writeFile(
      jar,
      zipSync({
        "fixture/Hello.class": new Uint8Array(await readFile(path.join(classes, "fixture", "Hello.class"))),
        "fixture/Hello$Inner.class": new Uint8Array(await readFile(path.join(classes, "fixture", "Hello$Inner.class"))),
        "fixture/Stale.class": new Uint8Array(await readFile(path.join(classes, "fixture", "Stale.class"))),
        "assets/kept.bin": new Uint8Array([0, 255, 8]),
      }),
    )
    expect(unzipSync(await readFile(jar))["fixture/Hello$Inner.class"]).toBeDefined()
    const imported = await importProject({ workspaceDirectory: workspaceDir, filename: jar }),
      id = imported.manifest.id
    try {
      const prepared = await prepareReverseProject({
        workspaceDirectory: workspaceDir,
        id,
        runtimeDirectory,
        javaHome: jdk,
      })
      const module = prepared.project.modules[0]!
      expect(module.status).toBe("decompiled")
      const javaPath = `${module.sourceRoot}/fixture/Hello.java`,
        sourceFile = await readReverseFile({ workspaceDirectory: workspaceDir, id, path: javaPath })
      expect(sourceFile.content).toContain("Inner")
      const changedSource = sourceFile.content
        .replace('"before"', '"after"')
        .replace(/static\s+final\s+class\s+Inner\s*\{\s*\}/, "")
      expect(changedSource).not.toContain("Inner")
      await applyReverseChanges({
        workspaceDirectory: workspaceDir,
        id,
        changes: [
          {
            path: javaPath,
            operation: "write",
            expectedSha256: sourceFile.sha256,
            encoding: "utf8",
            content: changedSource,
          },
        ],
      })
      await expect(
        exportReverseProject({
          workspaceDirectory: workspaceDir,
          id,
          destination: path.join(root, "blocked.jar"),
          kind: "archive",
        }),
      ).rejects.toThrow("Archive export blocked")
      const build = await buildReverseModule({
        workspaceDirectory: workspaceDir,
        id,
        moduleId: module.id,
        runtimeDirectory,
        javaHome: jdk,
        dependencyPaths: [dependencyJar],
      })
      expect(build.build.status).toBe("success")
      expect(build.project.modules[0]?.dependencyFiles).toHaveLength(1)
      const stale = await readReverseFile({
        workspaceDirectory: workspaceDir,
        id,
        path: `${module.sourceRoot}/fixture/Stale.java`,
      })
      await applyReverseChanges({
        workspaceDirectory: workspaceDir,
        id,
        changes: [
          { path: stale.path, operation: "delete", expectedSha256: stale.sha256, encoding: "utf8", content: null },
        ],
      })
      const deletedBuild = await buildReverseModule({
        workspaceDirectory: workspaceDir,
        id,
        moduleId: module.id,
        runtimeDirectory,
        javaHome: jdk,
      })
      expect(deletedBuild.build.status).toBe("success")
      expect(deletedBuild.project.modules[0]?.dependencyFiles).toHaveLength(1)
      const output = path.join(root, "compiled.jar")
      await exportReverseProject({ workspaceDirectory: workspaceDir, id, destination: output, kind: "archive" })
      const exported = unzipSync(await readFile(output))
      expect(exported["fixture/Hello.class"]).toBeDefined()
      expect(exported["fixture/Hello$Inner.class"]).toBeUndefined()
      expect(exported["fixture/Stale.class"]).toBeUndefined()
      expect([...exported["assets/kept.bin"]!]).toEqual([0, 255, 8])
      const exportedJar = path.join(root, "run.jar")
      await writeFile(exportedJar, await readFile(output))
      const execution = await runOwnedProcess(
        path.join(jdk!, "bin", process.platform === "win32" ? "java.exe" : "java"),
        ["-cp", exportedJar, "fixture.Hello"],
      )
      expect(execution).toMatchObject({ code: 0, output: "after" })
      const share = path.join(root, "project.modreverse")
      await exportReverseProject({ workspaceDirectory: workspaceDir, id, destination: share, kind: "project" })
      const restored = await restoreReverseProject({ workspaceDirectory: workspaceDir, filename: share })
      expect(restored.project.modules[0]?.build.status).toBe("success")
      expect(restored.project.modules[0]?.dependencyFiles).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  120000,
)
