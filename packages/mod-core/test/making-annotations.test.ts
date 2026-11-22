import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { REFERENCE_LIMITS } from "@minemods/studio-ai/making"
import { weaponFixture, WEAPON_MODEL_ID } from "../../studio/test/weapon-fixture"
import { exportProjectArchive, importProjectArchive } from "../src/container"
import { archivedModelAnnotations } from "../src/making-annotations"
import { addReference, addReferenceUnlocked, readByWords, readReferences, removeReference, setByWords, setConcepts, setThreeView, shownReferences } from "../src/making-references"
import { createProject, saveProject, withProjectLock, writeRecord } from "../src/project"
import { applyWorkspaceAsset, WorkspaceAssetSchema } from "../src/workspace"

const roots: string[] = []
afterEach(() => Promise.all(roots.splice(0).map(directory => rm(directory, { recursive: true, force: true }))))
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

test("annotation replacement and archive preserve six views, by-words, concepts and ordinary references", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "annotation-archive-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const project = await createProject({ directory, name: "标注与六视图" })
  const timestamp = new Date().toISOString()
  const saved = await saveProject(directory, applyWorkspaceAsset(project, WorkspaceAssetSchema.parse({ id: WEAPON_MODEL_ID, module: "model", title: "武器模型", document: { kind: "model", ...weaponFixture() }, revision: 1, created_at: timestamp, updated_at: timestamp, prompt: "武器", dependencies: [], provenance: { model: null, request_id: null }, status: "design" })), project.revision)
  await setByWords(directory, WEAPON_MODEL_ID)
  for (const view of ["front", "back", "left", "right", "top", "quarter"] as const) await setThreeView(directory, WEAPON_MODEL_ID, { view, by: "person", name: view, url: PNG })
  await setConcepts(directory, WEAPON_MODEL_ID, [{ name: "设计图", url: PNG }])
  for (let index = 0; index < REFERENCE_LIMITS.user; index++) await addReference(directory, WEAPON_MODEL_ID, { kind: "user", name: `参考 ${index}`, url: PNG })
  const before = await readReferences(directory, WEAPON_MODEL_ID)
  const previous = before.find(reference => reference.kind === "user")!
  await withProjectLock(directory, async () => {
    const references = await addReferenceUnlocked(directory, WEAPON_MODEL_ID, { kind: "user", name: "模型标注", url: PNG, replaceId: previous.id })
    await writeRecord(directory, [".minemods", "making", "annotations", `${WEAPON_MODEL_ID}.json`], {
      context: { targetId: WEAPON_MODEL_ID, projectRevision: saved.revision, width: 1, height: 1, selectedPart: null, annotations: [{ kind: "text", start: { x: 0.5, y: 0.5 }, text: "保留轮廓", part: null }] },
      modelRevision: 1,
      referenceId: references.find(reference => !before.some(held => held.id === reference.id))!.id,
    })
  })
  const replaced = await readReferences(directory, WEAPON_MODEL_ID)
  expect(replaced.filter(reference => reference.name !== "模型标注")).toEqual(before.filter(reference => reference.id !== previous.id))
  expect(await readByWords(directory, WEAPON_MODEL_ID)).toBe(true)
  const archive = path.join(root, "mixed.minemods")
  await exportProjectArchive({ directory, destination: archive })
  const destination = path.join(root, "imported")
  await importProjectArchive({ archive, destination })
  expect(await shownReferences(destination, [WEAPON_MODEL_ID])).toEqual(await shownReferences(directory, [WEAPON_MODEL_ID]))
  expect(await archivedModelAnnotations(destination)).toEqual(await archivedModelAnnotations(directory))
  expect(await readByWords(destination, WEAPON_MODEL_ID)).toBe(true)
  // The ordinary reference path also lists annotation PNGs. Removing either kind must leave a portable project.
  const ordinary = replaced.find(reference => reference.kind === "user" && reference.name !== "模型标注")!
  await removeReference(destination, WEAPON_MODEL_ID, ordinary.id)
  expect(await archivedModelAnnotations(destination)).toEqual(await archivedModelAnnotations(directory))
  const annotated = replaced.find(reference => reference.name === "模型标注")!
  await removeReference(destination, WEAPON_MODEL_ID, annotated.id)
  expect(await archivedModelAnnotations(destination)).toEqual({})
  expect(await readReferences(destination, WEAPON_MODEL_ID)).toEqual(replaced.filter(reference => reference.id !== ordinary.id && reference.id !== annotated.id))
  expect(await readByWords(destination, WEAPON_MODEL_ID)).toBe(true)
  const cleanedArchive = path.join(root, "cleaned.minemods")
  await exportProjectArchive({ directory: destination, destination: cleanedArchive })
  const cleaned = path.join(root, "cleaned")
  await importProjectArchive({ archive: cleanedArchive, destination: cleaned })
  expect(await shownReferences(cleaned, [WEAPON_MODEL_ID])).toEqual(await shownReferences(destination, [WEAPON_MODEL_ID]))
  expect(await archivedModelAnnotations(cleaned)).toEqual({})
  expect(await readByWords(cleaned, WEAPON_MODEL_ID)).toBe(true)
})
