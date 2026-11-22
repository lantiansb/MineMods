import { afterAll, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createProject, openProject, saveProject, type Project } from "../src/project"
import { applyProjectImport, duplicateAssets, listAssetMerges, listProjectImports, mergeDuplicateAssets, previewProjectImport, undoAssetMerge, undoProjectImport, type ProjectImportInput } from "../src/project-import"
import { createImportBossSample } from "../script/import-boss-sample"

/**
 * r29b 导入: the same id or game name with other content (粒子 spark, 声音 roar, 效果 spike), chosen one of three ways; the same source brought again,
 * written over in place; and the renamed copies earlier imports left, merged into the main project's own. Every step is undone again.
 * The samples are the three small boss projects of `import-boss-sample.ts`, which on purpose name their particle `spark` and their sound `roar`.
 */

const roots: string[] = []
afterAll(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))))
async function folder() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-again-"))
  roots.push(root)
  return root
}
const ofKind = (project: Project, kind: string) => project.workspace.assets.filter((asset) => asset.module === kind)
const settingOf = (project: Project) => project.workspace.assets.find((asset) => asset.module === "entity")!.id
async function bring(source: string, main: string, input: Omit<ProjectImportInput, "picks"> & { picks: string[] }) {
  const plan = await previewProjectImport(source, main, input)
  expect(plan.blocked).toEqual([])
  return applyProjectImport(source, main, { ...input, expectedRevision: (await openProject(main)).revision, fingerprint: plan.fingerprint, importId: randomUUID() })
}

/** The lava project, its spike effect made a little different from the frost project's (same name, other content). */
async function lavaWithOwnSpike(directory: string) {
  const made = await createImportBossSample(directory, "lava")
  const spike = ofKind(made, "effect")[0]!
  const changed = JSON.parse(JSON.stringify(spike.document).replace('"pivot":[0,0,0]', '"pivot":[0,0.5,0]'))
  expect(JSON.stringify(changed)).not.toBe(JSON.stringify(spike.document))
  return saveProject(directory, { ...made, workspace: { assets: made.workspace.assets.map((asset) => (asset.id === spike.id ? { ...asset, document: changed } : asset)) } } as Project, made.revision)
}

test("同名不同内容的粒子、声音、效果：表里标出来、列出不同的字段，选「用已有的」后生物指向主工程那份、不多出资产，撤销还原", async () => {
  const root = await folder()
  const lava = path.join(root, "lava")
  const source = await lavaWithOwnSpike(lava)
  const main = path.join(root, "main")
  const frost = await createImportBossSample(main, "frost")
  const setting = settingOf(source)
  const own = (kind: string) => ofKind(source, kind)[0]!
  const theirs = (kind: string) => ofKind(frost, kind)[0]!
  // By default both are kept, as before: each is marked, with what differs, and said.
  const plan = await previewProjectImport(lava, main, { picks: [setting] })
  for (const kind of ["particle", "sound", "effect"]) {
    const item = plan.items.find((value) => value.source_id === own(kind).id)!
    expect(item.action).toBe("add")
    expect(item.namesake).toMatchObject({ id: theirs(kind).id, title: theirs(kind).title })
    expect(item.namesake!.fields.length).toBeGreaterThan(0)
  }
  expect(plan.items.find((value) => value.source_id === own("particle").id)!.namesake!.fields).toContain("color")
  expect(plan.notes.map((note) => note.text).join("\n")).toContain("编号或游戏里的名字相同，内容不一样")
  // 「用已有的」 for the three: nothing new of them, and what is brought names the main project's own.
  const before = await openProject(main)
  const choices = Object.fromEntries(["particle", "sound", "effect"].map((kind) => [own(kind).id, "reuse" as const]))
  const reused = await previewProjectImport(lava, main, { picks: [setting], choices })
  expect(["particle", "sound", "effect"].map((kind) => reused.items.find((value) => value.source_id === own(kind).id)!.action)).toEqual(["reuse", "reuse", "reuse"])
  // Its drop 「核心」 is a namesake too (an item `core` in both): left as chosen by default, two copies.
  expect(reused.items.find((value) => value.kind === "item" && value.namesake)?.action).toBe("add")
  expect(reused.notes.map((note) => note.text).join("\n")).toContain(`用「${frost.name}」的「${theirs("particle").title}」，「${source.name}」那份里的不同之处不会带进来。`)
  const done = await bring(lava, main, { picks: [setting], choices })
  for (const kind of ["particle", "sound", "effect"]) expect(ofKind(done.project, kind).map((asset) => asset.id)).toEqual(ofKind(before, kind).map((asset) => asset.id))
  const brought = JSON.stringify([...done.project.entities.filter((entity) => !before.entities.some((value) => value.id === entity.id)), ...done.project.workspace.assets.filter((asset) => !before.workspace.assets.some((value) => value.id === asset.id))])
  for (const kind of ["particle", "sound", "effect"]) {
    expect(brought).toContain(theirs(kind).id)
    expect(brought).not.toContain(own(kind).id)
  }
  // Undone: the main project is what it was.
  const undone = await undoProjectImport(main, done.record.id, done.project.revision)
  expect(undone.project.workspace.assets.map((asset) => asset.id).sort()).toEqual(before.workspace.assets.map((asset) => asset.id).sort())
  expect(undone.project.entities.map((entity) => entity.id)).toEqual(before.entities.map((entity) => entity.id))
}, 300000)

test("同名不同内容选「用导入的」：主工程那份原地换成导入的内容，编号和游戏里的名字不变；撤销换回原来的", async () => {
  const root = await folder()
  const lava = path.join(root, "lava")
  const source = await lavaWithOwnSpike(lava)
  const main = path.join(root, "main")
  const frost = await createImportBossSample(main, "frost")
  const spark = ofKind(source, "particle")[0]!
  const theirs = ofKind(frost, "particle")[0]!
  const plan = await previewProjectImport(lava, main, { picks: [settingOf(source)], choices: { [spark.id]: "replace" } })
  expect(plan.items.find((value) => value.source_id === spark.id)).toMatchObject({ action: "replace", target_id: theirs.id })
  expect(plan.notes.map((note) => note.text).join("\n")).toContain(`用「${source.name}」那份替换「${frost.name}」的「${theirs.title}」`)
  const done = await bring(lava, main, { picks: [settingOf(source)], choices: { [spark.id]: "replace" } })
  const replaced = done.project.workspace.assets.find((asset) => asset.id === theirs.id)!
  expect(ofKind(done.project, "particle")).toHaveLength(1)
  expect(replaced.document).toMatchObject({ name: "spark", color: (spark.document as { color: unknown }).color })
  // Whatever of the main project used it still does: the frost boss's own ability names the same id.
  expect(JSON.stringify(done.project.workspace.assets.filter((asset) => frost.workspace.assets.some((value) => value.id === asset.id && value.id !== theirs.id)))).toContain(theirs.id)
  const undone = await undoProjectImport(main, done.record.id, done.project.revision)
  expect(undone.project.workspace.assets.find((asset) => asset.id === theirs.id)!.document).toEqual(theirs.document)
  // "replace" where nothing has that id or name is refused in words.
  const alone = path.join(root, "alone")
  await createProject({ directory: alone, name: "空工程", mod_id: "alone", target: "forge-1.20.1" })
  expect((await previewProjectImport(lava, alone, { picks: [settingOf(source)], choices: { [spark.id]: "replace" } })).blocked.join("")).toContain("没有同编号、同名的东西，不能选「用导入的替换主工程那份」")
}, 300000)

test("同一个源工程出了新版再导一次：上一次那批原地换成新版，不留重复件，主工程别处的引用照旧；手改过的会提示；撤销回到上一次的样子", async () => {
  const root = await folder()
  const lava = path.join(root, "lava")
  const made = await createImportBossSample(lava, "lava")
  const main = path.join(root, "main")
  await createProject({ directory: main, name: "山海", mod_id: "shanhai", target: "forge-1.20.1" })
  const setting = settingOf(made)
  const first = await bring(lava, main, { picks: [setting] })
  const once = first.project
  const spark = first.plan.items.find((item) => item.kind === "particle")!
  // The main project uses the imported particle elsewhere, by its id: a copy of the sample's ability asset of its own that names it.
  const ability = ofKind(once, "ability")[0]!
  const mine = { ...ability, id: randomUUID(), title: "主工程自己的技能" }
  const withMine = await saveProject(main, { ...once, workspace: { assets: [...once.workspace.assets, mine] } } as Project, once.revision)
  // A hand change to the imported sound in the main project, after the import.
  const sound = withMine.workspace.assets.find((asset) => asset.module === "sound")!
  const later = new Date(Date.now() + 1000).toISOString()
  const edited = await saveProject(main, { ...withMine, workspace: { assets: withMine.workspace.assets.map((asset) => (asset.id === sound.id ? { ...asset, title: "主工程改过的吼声", updated_at: later } : asset)) } } as Project, withMine.revision)
  // The source's next version: the boss is tougher and its spark another colour.
  const source = await openProject(lava)
  const row = source.entities[0]!
  const sourceSpark = ofKind(source, "particle")[0]!
  await saveProject(lava, { ...source, entities: [{ ...row, health: 200 }], workspace: { assets: source.workspace.assets.map((asset) => (asset.id === sourceSpark.id ? { ...asset, document: { ...asset.document, color: { start: "#123456", end: "#654321" } } } : asset.document.kind === "entity" ? { ...asset, document: { ...asset.document, health: 200 } } : asset)) } } as Project, source.revision)
  const plan = await previewProjectImport(lava, main, { picks: [setting] })
  expect(plan.blocked).toEqual([])
  expect(plan.items.every((item) => item.action === "update")).toBe(true)
  expect(plan.items.every((item) => item.renames.length === 0)).toBe(true)
  expect(plan.notes.map((note) => note.text).join("\n")).toContain("以前导入过：这次带的")
  expect(plan.notes.map((note) => note.text).join("\n")).toContain("「主工程改过的吼声」上次从「火山口」导入以后在「山海」里改过，这次重新导入会用源工程的新版盖掉这些改动。")
  const again = await applyProjectImport(lava, main, { picks: [setting], expectedRevision: edited.revision, fingerprint: plan.fingerprint, importId: randomUUID() })
  const now = again.project
  expect(now.workspace.assets.map((asset) => asset.id).sort()).toEqual(edited.workspace.assets.map((asset) => asset.id).sort())
  expect(now.entities.map((entity) => entity.id)).toEqual(edited.entities.map((entity) => entity.id))
  expect(now.entities[0]!.health).toBe(200)
  expect(now.workspace.assets.find((asset) => asset.id === spark.target_id)!.document).toMatchObject({ color: { start: "#123456", end: "#654321" } })
  expect(JSON.stringify(now.workspace.assets.find((asset) => asset.id === mine.id))).toBe(JSON.stringify(edited.workspace.assets.find((asset) => asset.id === mine.id)))
  // The creature's model is the next version of the one kept, the older one still on disk.
  const model = now.assets.find((value) => value.id === now.entities[0]!.model_asset_id)!
  expect(model.revision).toBe(edited.assets.find((value) => value.id === model.id)!.revision + 1)
  // Undone: as it was after the hand change.
  const undone = await undoProjectImport(main, again.record.id, now.revision)
  expect(undone.project.entities[0]!.health).toBe(120)
  expect(undone.project.workspace.assets.find((asset) => asset.id === sound.id)!.title).toBe("主工程改过的吼声")
  expect(undone.project.workspace.assets.find((asset) => asset.id === spark.target_id)!.document).toEqual(once.workspace.assets.find((asset) => asset.id === spark.target_id)!.document)
  expect(undone.project.assets).toEqual(edited.assets)
  // r29d 合包: the next version of the model it wrote is gone with the undo (left, the same creature could not be brought again), the record says which.
  expect(again.record.versions).toEqual([{ id: model.id, revision: model.revision }])
  expect(await Bun.file(path.join(main, ".minemods", "assets", model.id, `${model.revision}.json`)).exists()).toBe(false)
  const third = await bring(lava, main, { picks: [setting] })
  expect(third.project.assets.find((value) => value.id === model.id)!.revision).toBe(model.revision)
  // A record written before r29d did not say to remove it: such a file left after an undo is written over, not refused.
  const back = await undoProjectImport(main, third.record.id, third.project.revision)
  const left = path.join(main, ".minemods", "assets", model.id, `${model.revision}.json`)
  await Bun.write(left, "{}")
  expect(back.project.assets.find((value) => value.id === model.id)!.revision).toBe(model.revision - 1)
  const fourth = await bring(lava, main, { picks: [setting] })
  expect(fourth.project.assets.find((value) => value.id === model.id)!.revision).toBe(model.revision)
  expect(JSON.parse(await Bun.file(left).text()).id).toBe(model.id)
}, 300000)

test("合并以前导入留下的重复件：列出同源改名另存的那些，合并后引用都指向保留的那份，能撤销；之后再导同一个源工程用保留的那份", async () => {
  const root = await folder()
  const lava = path.join(root, "lava")
  const source = await createImportBossSample(lava, "lava")
  const main = path.join(root, "main")
  const frost = await createImportBossSample(main, "frost")
  const done = await bring(lava, main, { picks: [settingOf(source)] })
  const sparkCopy = done.project.workspace.assets.find((asset) => asset.document.kind === "particle" && asset.document.name === "spark_crater")!
  const roarCopy = done.project.workspace.assets.find((asset) => asset.document.kind === "sound" && asset.document.name === "roar_crater")!
  const pairs = duplicateAssets(done.project, await listProjectImports(main))
  const spark = ofKind(frost, "particle")[0]!
  const roar = ofKind(frost, "sound")[0]!
  expect(pairs.map((pair) => [pair.kind, pair.drop.name, pair.keep.name]).sort()).toEqual(expect.arrayContaining([["particle", "spark_crater", "spark"], ["sound", "roar_crater", "roar"]]))
  expect(pairs.find((pair) => pair.drop.id === sparkCopy.id)).toMatchObject({ keep: { id: spark.id }, from: source.name })
  expect(pairs.find((pair) => pair.drop.id === sparkCopy.id)!.fields).toContain("color")
  // Merged: the copies are gone, and what named them names the frost project's own.
  const merged = await mergeDuplicateAssets(main, { drops: [sparkCopy.id, roarCopy.id], expectedRevision: done.project.revision, mergeId: randomUUID() })
  expect(ofKind(merged.project, "particle").map((asset) => asset.id)).toEqual([spark.id])
  expect(ofKind(merged.project, "sound").map((asset) => asset.id)).toEqual([roar.id])
  const text = JSON.stringify(merged.project)
  expect(text).not.toContain(sparkCopy.id)
  expect(text).not.toContain(roarCopy.id)
  expect(text).not.toContain("spark_crater")
  expect(duplicateAssets(merged.project, await listProjectImports(main)).map((pair) => pair.drop.id)).not.toContain(sparkCopy.id)
  // Brought again from the same source, the merged ones are used as they are: no new copy.
  const again = await previewProjectImport(lava, main, { picks: [settingOf(source)] })
  expect(again.items.find((item) => item.source_id === ofKind(source, "particle")[0]!.id)).toMatchObject({ action: "reuse", target_id: spark.id })
  // A copy not offered is refused; undone, the copies are back as they were.
  await expect(mergeDuplicateAssets(main, { drops: [randomUUID()], expectedRevision: merged.project.revision, mergeId: randomUUID() })).rejects.toThrow("不在可以合并的重复件里")
  const undone = await undoAssetMerge(main, merged.record.id, merged.project.revision)
  expect(JSON.stringify({ ...undone.project, revision: 0, updated_at: "" })).toBe(JSON.stringify({ ...done.project, revision: 0, updated_at: "" }))
  expect((await listAssetMerges(main))[0]!.undone_at).not.toBeNull()
}, 300000)

test("r29d 合包：物品的游戏显示名和标题不一样时（标题「山𤟤之筋」、显示名「山晖之筋」，游戏里没有𤟤），带进来和原地重导都保住显示名", async () => {
  const root = await folder()
  const lava = path.join(root, "lava")
  const made = await createImportBossSample(lava, "lava")
  const core = ofKind(made, "item").find((asset) => (asset.document as { identifier?: string }).identifier === "core")!
  const named = (project: Project) => ({ ...project, items: project.items.map((item) => (item.id === core.id ? { ...item, name: "山晖之筋" } : item)), workspace: { assets: project.workspace.assets.map((asset) => (asset.id === core.id ? { ...asset, title: "山𤟤之筋", document: { ...asset.document, name: "山晖之筋" } } : asset)) } }) as Project
  await saveProject(lava, named(made), made.revision)
  const main = path.join(root, "main")
  await createProject({ directory: main, name: "山海", mod_id: "shanhai", target: "forge-1.20.1" })
  const setting = settingOf(made)
  const first = await bring(lava, main, { picks: [setting] })
  const item = first.plan.items.find((value) => value.source_id === core.id)
  expect(item).toBeDefined()
  const shown = (project: Project) => ({ row: project.items.find((value) => value.id === item!.target_id)!.name, document: (project.workspace.assets.find((value) => value.id === item!.target_id)!.document as { name: string }).name, title: project.workspace.assets.find((value) => value.id === item!.target_id)!.title })
  expect(shown(first.project)).toEqual({ row: "山晖之筋", document: "山晖之筋", title: "山𤟤之筋" })
  // Brought again in place: the name is still its own, not the title.
  const again = await bring(lava, main, { picks: [setting] })
  expect(again.plan.items.find((value) => value.source_id === core.id)!.action).toBe("update")
  expect(shown(again.project)).toEqual({ row: "山晖之筋", document: "山晖之筋", title: "山𤟤之筋" })
  // An item whose name is its title follows the title as before (a renamed one shows renamed in the game).
  const token = first.plan.items.find((value) => value.kind === "item" && value.source_id !== core.id)
  if (token) expect(first.project.items.find((value) => value.id === token.target_id)!.name).toBe(first.project.workspace.assets.find((value) => value.id === token.target_id)!.title)
}, 300000)
