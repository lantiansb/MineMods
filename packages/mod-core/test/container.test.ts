import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { zipSync, strToU8, unzipSync } from "fflate"
import { createEntity, createProject, openProject, saveProject } from "../src/project"
import { putModelAsset } from "../src/assets"
import { designToBlockbench } from "../src/blockbench"
import { mushroomCowDesign } from "../src/example"
import { encodePng } from "../src/png"
import { exportProjectArchive, inspectProjectArchive, importProjectArchive } from "../src/container"

const directories: string[] = []
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-container-"))
  directories.push(root)
  const directory = path.join(root, "original")
  const project = await createProject({ directory, name: "赤铜飞行社" })
  return { root, directory, project, archive: path.join(root, "赤铜飞行社.minemods") }
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

test("portable project roundtrip preserves identity, version and UTF-8 name", async () => {
  const f = await fixture()
  await exportProjectArchive({ directory: f.directory, destination: f.archive })
  const preview = await inspectProjectArchive(f.archive)
  expect(preview.project.name).toBe("赤铜飞行社")
  expect(preview.project.id).toBe(f.project.id)
  expect(preview.environment).toEqual({ java: 21, minecraft: "1.21.1", loader: "fabric", loaderVersion: "0.17.2" })
  const destination = path.join(f.root, "imported")
  await importProjectArchive({ archive: f.archive, destination })
  expect(await openProject(destination)).toEqual(f.project)
  expect(await openProject(f.directory)).toEqual(f.project)
})

test("archive roundtrip preserves canonical Blockbench snapshot, atlas bytes and UVs", async () => {
  const f = await fixture()
  const entity = createEntity({ name: "铜鸮" })
  const project = await saveProject(f.directory, { ...f.project, entities: [entity] }, f.project.revision)
  const blockbench = structuredClone(designToBlockbench(mushroomCowDesign))
  blockbench.elements![0]!.faces.north!.uv = [7, 8, 17, 15]
  const editedPixels = new Uint8Array(mushroomCowDesign.texture_size * mushroomCowDesign.texture_size * 4)
  editedPixels[0] = 0x9a
  editedPixels[1] = 0x4f
  editedPixels[2] = 0x2b
  editedPixels[3] = 0xff
  ;(blockbench.textures![0] as { source: string }).source = `data:image/png;base64,${Buffer.from(encodePng(editedPixels, mushroomCowDesign.texture_size, mushroomCowDesign.texture_size)).toString("base64")}`
  const saved = await putModelAsset(f.directory, {
    entity_id: entity.id,
    expectedRevision: project.revision,
    origin: "manual",
    data: { design: mushroomCowDesign, blockbench },
  })
  await exportProjectArchive({ directory: f.directory, destination: f.archive })
  const entries = unzipSync(await readFile(f.archive))
  expect(JSON.parse(new TextDecoder().decode(entries[`models/${saved.asset.id}.bbmodel`]))).toEqual(blockbench)
  expect(entries[`textures/${saved.asset.id}.png`]).toEqual(Buffer.from((blockbench.textures![0] as { source: string }).source.split(",")[1]!, "base64"))
  const destination = path.join(f.root, "imported-editable")
  await importProjectArchive({ archive: f.archive, destination })
  expect((await openProject(destination)).assets[0]?.id).toBe(saved.asset.id)
  expect(JSON.parse(await readFile(path.join(destination, `models/${saved.asset.id}.bbmodel`), "utf8"))).toEqual(blockbench)
})

test("archive export refuses a Blockbench snapshot without its embedded source", async () => {
  const f = await fixture()
  const entity = createEntity({ name: "无贴图铜鸮" })
  const project = await saveProject(f.directory, { ...f.project, entities: [entity] }, f.project.revision)
  const blockbench = structuredClone(designToBlockbench(mushroomCowDesign))
  blockbench.textures = []
  await putModelAsset(f.directory, {
    entity_id: entity.id,
    expectedRevision: project.revision,
    origin: "manual",
    data: { design: mushroomCowDesign, blockbench },
  })
  await expect(exportProjectArchive({ directory: f.directory, destination: f.archive })).rejects.toThrow("MODEL_TEXTURE_REQUIRED")
  await expect(readFile(f.archive)).rejects.toThrow()
})

test("legacy assets export a reconstructable Blockbench snapshot sidecar", async () => {
  const f = await fixture()
  const entity = createEntity({ name: "旧资产铜鸮" })
  const project = await saveProject(f.directory, { ...f.project, entities: [entity] }, f.project.revision)
  const saved = await putModelAsset(f.directory, {
    entity_id: entity.id,
    expectedRevision: project.revision,
    origin: "example",
    data: { design: mushroomCowDesign },
  })
  await exportProjectArchive({ directory: f.directory, destination: f.archive })
  const entries = unzipSync(await readFile(f.archive))
  expect(JSON.parse(new TextDecoder().decode(entries[`models/${saved.asset.id}.bbmodel`]))).toEqual(designToBlockbench(mushroomCowDesign))
})

test("archive export never clobbers an existing destination", async () => {
  const f = await fixture()
  await writeFile(f.archive, "keep this archive")
  await expect(exportProjectArchive({ directory: f.directory, destination: f.archive })).rejects.toThrow()
  expect(await readFile(f.archive, "utf8")).toBe("keep this archive")
})

test("import rejects a sidecar that is hashed correctly but disagrees with the saved asset", async () => {
  const f = await fixture()
  const entity = createEntity({ name: "不一致铜鸮" })
  const project = await saveProject(f.directory, { ...f.project, entities: [entity] }, f.project.revision)
  const blockbench = designToBlockbench(mushroomCowDesign)
  const saved = await putModelAsset(f.directory, {
    entity_id: entity.id,
    expectedRevision: project.revision,
    origin: "manual",
    data: { design: mushroomCowDesign, blockbench },
  })
  await exportProjectArchive({ directory: f.directory, destination: f.archive })
  const entries = unzipSync(await readFile(f.archive))
  const modelPath = `models/${saved.asset.id}.bbmodel`
  const changed = JSON.parse(new TextDecoder().decode(entries[modelPath]))
  changed.name = "tampered"
  entries[modelPath] = strToU8(JSON.stringify(changed, null, 2) + "\n")
  const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"]))
  const entry = manifest.entries.find((candidate: { path: string }) => candidate.path === modelPath)
  entry.bytes = entries[modelPath].length
  entry.sha256 = createHash("sha256").update(entries[modelPath]).digest("hex")
  entries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2) + "\n")
  await writeFile(f.archive, zipSync(entries))
  const destination = path.join(f.root, "tampered-import")
  await expect(importProjectArchive({ archive: f.archive, destination })).rejects.toThrow("模型快照与资产不一致")
  await expect(readFile(path.join(destination, "minemods.project.json"))).rejects.toThrow()
})

test("archive rejects corrupt checksums without creating a destination", async () => {
  const f = await fixture()
  await exportProjectArchive({ directory: f.directory, destination: f.archive })
  const entries = unzipSync(await readFile(f.archive))
  entries["dependencies.lock.json"] = strToU8("{}")
  await writeFile(f.archive, zipSync(entries))
  await expect(inspectProjectArchive(f.archive)).rejects.toThrow(/校验/)
  await expect(importProjectArchive({ archive: f.archive, destination: path.join(f.root, "bad") })).rejects.toThrow()
  await expect(readFile(path.join(f.root, "bad", "minemods.project.json"))).rejects.toThrow()
})

test("unsafe archive paths and invalid UTF-8 are rejected", async () => {
  const f = await fixture()
  await writeFile(f.archive, zipSync({ "../escape.txt": strToU8("bad"), "manifest.json": strToU8("{}") }))
  await expect(inspectProjectArchive(f.archive)).rejects.toThrow(/路径/)
  await writeFile(f.archive, zipSync({ "manifest.json": new Uint8Array([0xff, 0xfe]) }))
  await expect(inspectProjectArchive(f.archive)).rejects.toThrow()
})

test("import refuses an existing project without changing it", async () => {
  const f = await fixture()
  await exportProjectArchive({ directory: f.directory, destination: f.archive })
  await expect(importProjectArchive({ archive: f.archive, destination: f.directory })).rejects.toThrow()
  expect(await openProject(f.directory)).toEqual(f.project)
})
