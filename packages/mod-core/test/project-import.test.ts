import { afterAll, expect, test } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { createProject, openProject, saveProject } from "../src/project"
import { applyProjectImport, ImportRefusal, listProjectImports, previewProjectImport, undoProjectImport } from "../src/project-import"
import { WorkspaceAssetSchema } from "../src/workspace"
import { createImportBossSample, type ImportTheme } from "../script/import-boss-sample"
import { createDataGameplaySample } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"

/**
 * 从别的工程导入: three small projects, one boss each (`import-boss-sample.ts`, which on purpose names every drop 「核心」 `core`, every particle `spark`,
 * every sound `roar`), merged into one main project: what comes along and why, how the clashes are renamed and every reference follows, the same effect
 * used once when asked, the sources untouched, the main project written once per import and its own output unchanged, and the import undone.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterAll(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
async function folder() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-import-"))
  roots.push(root)
  return root
}
/** Every file under a folder with its hash: what "the source is only read" is checked against. */
async function hashes(directory: string) {
  const files = (await readdir(directory, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile())
  return Object.fromEntries(await Promise.all(files.map(async (entry) => [path.relative(directory, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"), createHash("sha256").update(await readFile(path.join(entry.parentPath, entry.name))).digest("hex")] as const)))
}
async function tree(directory: string, output: string, target: "forge-1.20.1" | "neoforge-1.21.1" | "fabric-1.21.1" = "forge-1.20.1") {
  await mkdir(output, { recursive: true })
  const built = await assembleBuildSource(directory, output, TEMPLATE, { target })
  return { built, files: await hashes(output) }
}
const pickOf = async (directory: string) => (await openProject(directory)).workspace.assets.find((asset) => asset.module === "entity")!.id
async function importAll(root: string, main: string, sources: readonly { theme: ImportTheme; conflict: "rename" | "reuse_same" }[]) {
  const results = []
  for (const source of sources) {
    const directory = path.join(root, source.theme)
    const pick = await pickOf(directory)
    const plan = await previewProjectImport(directory, main, { picks: [pick], conflict: source.conflict })
    expect(plan.blocked).toEqual([])
    const before = await openProject(main)
    results.push(await applyProjectImport(directory, main, { picks: [pick], conflict: source.conflict, expectedRevision: before.revision, fingerprint: plan.fingerprint, importId: randomUUID() }))
  }
  return results
}

test("三个各有一只 Boss 的工程合进一个主工程：带齐依赖、重名的改名、引用跟着改、源工程一个字节不变", async () => {
  const root = await folder()
  await createImportBossSample(path.join(root, "frost"), "frost")
  await createImportBossSample(path.join(root, "lava"), "lava")
  // Made for Fabric 1.21.1: its slam raises dust_plume, which the main project's Minecraft 1.20.1 does not have.
  await createImportBossSample(path.join(root, "thorn"), "thorn", "fabric-1.21.1")
  const main = path.join(root, "main")
  await createProject({ directory: main, name: "三章合集", mod_id: "three_chapters", target: "forge-1.20.1" })
  const sources = await Promise.all(["frost", "lava", "thorn"].map((theme) => hashes(path.join(root, theme))))

  const frost = path.join(root, "frost")
  const plan = await previewProjectImport(frost, main, { picks: [await pickOf(frost)] })
  // Everything the boss uses, each with who uses it.
  const kinds = plan.items.map((item) => item.kind).sort()
  expect(kinds).toEqual(["ability", "creature", "effect", "entity", "fixture", "item", "item", "model", "particle", "recipe", "recipe", "sound"])
  expect(plan.items.find((item) => item.kind === "effect")!.why[0]).toContain("冰刺法杖")
  expect(plan.items.find((item) => item.kind === "recipe" && item.title === "召唤符")!.why).toEqual(["用「核心」做材料的配方", "做「召唤符」的配方"])
  expect(plan.items.every((item) => item.action === "add" && item.renames.length === 0)).toBe(true)
  expect(plan.models).toBe(1)
  // Only the list: nothing was written.
  expect((await openProject(main)).revision).toBe(0)

  const done = await importAll(root, main, [{ theme: "frost", conflict: "rename" }, { theme: "lava", conflict: "rename" }, { theme: "thorn", conflict: "reuse_same" }])
  expect(done.map((result) => result.project.revision)).toEqual([1, 2, 3])
  const merged = await openProject(main)
  expect(merged.mod_id).toBe("three_chapters")
  expect(merged.entities.map((entity) => entity.name)).toEqual(["霜甲巨像", "熔岩魔像", "荆棘树人"])
  expect(merged.items.map((item) => item.identifier).sort()).toEqual(["core", "core_crater", "core_thorn_wood", "token", "token_crater", "token_thorn_wood"])
  expect(merged.items.filter((item) => item.name.startsWith("核心")).map((item) => item.name)).toEqual(["核心", "核心（火山口）", "核心（荆棘林）"])
  // Every reference followed the new names: the drop, the summoning token, the recipes in the main project's namespace.
  const lava = merged.entities[1]!
  expect(lava.loot?.[0]?.item).toBe("core_crater")
  expect(lava.boss?.summon?.item).toBe("token_crater")
  expect(merged.recipes.map((recipe) => recipe.result).sort()).toEqual(["three_chapters:core", "three_chapters:core_crater", "three_chapters:core_thorn_wood", "three_chapters:token", "three_chapters:token_crater", "three_chapters:token_thorn_wood"])
  expect(merged.recipes.find((recipe) => recipe.result === "three_chapters:token_crater")!.pattern).toContain("three_chapters:core_crater")
  const named = (kind: "sound" | "particle") => merged.workspace.assets.flatMap((asset) => (asset.document.kind === kind ? [asset.document.name] : [])).sort()
  expect(named("sound")).toEqual(["roar", "roar_crater", "roar_thorn_wood"])
  expect(named("particle")).toEqual(["spark", "spark_crater", "spark_thorn_wood"])
  // The spike effect is the same in all three: kept apart when renaming, used once when asked to use the same thing.
  expect(merged.workspace.assets.filter((asset) => asset.module === "effect")).toHaveLength(2)
  const reused = done[2]!.plan.items.find((item) => item.kind === "effect")!
  expect(reused.action).toBe("reuse")
  expect(done[1]!.plan.items.find((item) => item.kind === "effect")!.same_as).not.toBeNull()
  const thornAbility = merged.workspace.assets.find((asset) => asset.module === "ability" && asset.title.includes("荆棘林"))!
  expect(thornAbility.dependencies).toEqual([reused.target_id])
  // A target the source was not made for: said, and what can be switched is switched.
  const thornNotes = done[2]!.plan.notes.map((note) => note.text).join("\n")
  expect(thornNotes).toContain("fabric-1.21.1")
  expect(thornNotes).toContain("dust_plume 已自动换成 poof")
  expect(JSON.stringify(merged.entities[2])).not.toContain("dust_plume")
  // The sources were only read.
  expect(await Promise.all(["frost", "lava", "thorn"].map((theme) => hashes(path.join(root, theme))))).toEqual(sources)
  expect((await listProjectImports(main)).map((record) => record.source.name)).toEqual(["荆棘林", "火山口", "霜原"])

  const built = await tree(main, path.join(root, "out"))
  expect(built.built.entityIds).toHaveLength(3)
  const resources = `src/main/resources/assets/three_chapters`
  for (const name of ["core", "core_crater", "core_thorn_wood"]) expect(Object.keys(built.files)).toContain(`${resources}/models/item/${name}.json`)
}, 300000)

for (const target of ["forge-1.20.1", "neoforge-1.21.1", "fabric-1.21.1-official"] as const) {
  test.skipIf(!hasTargetJavac(target))(`合成的主工程在 ${target} 上整树 javac 通过`, async () => {
    const root = await folder()
    const made = target === "fabric-1.21.1-official" ? "fabric-1.21.1" : target
    for (const theme of ["frost", "lava", "thorn"] as const) await createImportBossSample(path.join(root, theme), theme, made)
    const main = path.join(root, "main")
    await createProject({ directory: main, name: "三章合集", mod_id: "three_chapters", target: made })
    await importAll(root, main, [{ theme: "frost", conflict: "rename" }, { theme: "lava", conflict: "rename" }, { theme: "thorn", conflict: "reuse_same" }])
    const source = path.join(root, "source")
    await tree(main, source, made)
    const compiled = (await compileTreeFor(target, source, path.join(root, "classes")))!
    expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 600000)
}

test("主工程原有的东西生成结果不变；撤销以后回到导入前的样子", async () => {
  const root = await folder()
  const main = path.join(root, "main")
  await createImportBossSample(main, "frost")
  await createImportBossSample(path.join(root, "lava"), "lava")
  const before = await tree(main, path.join(root, "before"))
  const [done] = await importAll(root, main, [{ theme: "lava", conflict: "rename" }])
  const after = await tree(main, path.join(root, "after"))
  // With a second creature every creature's classes take a numbered name (the build's rule since before this import): the frost boss's own classes are
  // the same text under that name. The tables every creature shares grow by the new rows; everything else of the main project is the same byte for byte.
  const suffix = `Entity1_${(await openProject(main)).entities[0]!.id.replaceAll("-", "").slice(0, 8)}`
  const pkg = `src/main/java/${before.built.packageName.replaceAll(".", "/")}`
  const shared = ["minemods-build.json", "README-STUDIO.md", "project-backup/minemods.project.json", "sounds.json", "lang/en_us.json", "lang/zh_cn.json", "StudioContent.java", "StudioContentRegistry.java", "StudioSounds.java", "StudioClient.java", "StudioEffects.java", "StudioFixtures.java", "StudioParticles.java"]
  const changed = Object.keys(before.files).filter((file) => after.files[file] !== before.files[file])
  const renamed = changed.filter((file) => !shared.some((name) => file.endsWith(`/${name}`) || file === name))
  expect(renamed.sort()).toEqual([`${pkg}/client/StudioCreatureRenderer.java`, `${pkg}/entity/StudioCreature.java`])
  for (const file of renamed) {
    const text = await readFile(path.join(root, "before", file), "utf8")
    const moved = await readFile(path.join(root, "after", file.replace(/\.java$/, `${suffix}.java`)), "utf8")
    expect(moved.replaceAll(suffix, "")).toBe(text)
  }
  const undone = await undoProjectImport(main, done!.record.id, done!.project.revision)
  expect(undone.project.revision).toBe(done!.project.revision + 1)
  const back = await tree(main, path.join(root, "undone"))
  const differ = Object.keys(before.files).filter((file) => back.files[file] !== before.files[file])
  // Only the three files that carry the project's revision.
  expect(differ.sort()).toEqual(["README-STUDIO.md", "minemods-build.json", "project-backup/minemods.project.json"])
  expect(Object.keys(back.files).sort()).toEqual(Object.keys(before.files).sort())
  expect((await listProjectImports(main))[0]!.undone_at).not.toBeNull()
  await expect(undoProjectImport(main, done!.record.id, undone.project.revision)).rejects.toThrow("已经撤销过了")
}, 300000)

test("清单变了、主工程改过、选了玩法代码、导进来的东西被用着时都不写盘", async () => {
  const root = await folder()
  const main = path.join(root, "main")
  await createProject({ directory: main, name: "主工程", mod_id: "main_mod", target: "forge-1.20.1" })
  const lava = path.join(root, "lava")
  await createImportBossSample(lava, "lava")
  const pick = await pickOf(lava)
  const plan = await previewProjectImport(lava, main, { picks: [pick] })
  await expect(applyProjectImport(lava, main, { picks: [pick], expectedRevision: 0, fingerprint: "0".repeat(64), importId: randomUUID() })).rejects.toBeInstanceOf(ImportRefusal)
  await expect(applyProjectImport(lava, main, { picks: [pick], expectedRevision: 5, fingerprint: plan.fingerprint, importId: randomUUID() })).rejects.toThrow("主工程已经改过了")
  expect((await openProject(main)).revision).toBe(0)
  await expect(previewProjectImport(main, main, { picks: [pick] })).rejects.toThrow("同一个工程")
  // Gameplay code is not brought: picked, it is refused with the reason; used by what is picked, it is listed as left out.
  const golem = path.join(root, "golem")
  const sample = await createDataGameplaySample(golem, { life: true })
  const code = sample.workspace.assets.find((asset) => asset.module === "gameplay")!
  expect((await previewProjectImport(golem, main, { picks: [code.id] })).blocked.join("")).toContain("玩法代码")
  const guarded = await previewProjectImport(golem, main, { picks: [sample.workspace.assets.find((asset) => asset.module === "entity")!.id] })
  expect(guarded.left_out.map((thing) => thing.id)).toContain(code.id)
  const stamp = new Date().toISOString()
  const note = WorkspaceAssetSchema.parse({ id: randomUUID(), module: "worldview", title: "世界观", revision: 1, created_at: stamp, updated_at: stamp, prompt: "世界观", dependencies: [], document: { kind: "worldview", title: "火山", summary: "", entries: [] }, provenance: { model: null, request_id: null }, status: "design" })
  // What was imported cannot be taken back out while something made since uses it.
  const done = await applyProjectImport(lava, main, { picks: [pick], expectedRevision: 0, fingerprint: (await previewProjectImport(lava, main, { picks: [pick] })).fingerprint, importId: randomUUID() })
  const project = await openProject(main)
  const sound = done.plan.items.find((item) => item.kind === "sound")!.target_id
  const user = WorkspaceAssetSchema.parse({ ...note, id: randomUUID(), title: "用吼声的设定", dependencies: [sound] })
  const used = await saveProject(main, { ...project, workspace: { assets: [...project.workspace.assets, user] } }, project.revision)
  await expect(undoProjectImport(main, done.record.id, used.revision)).rejects.toThrow("用吼声的设定")
}, 300000)

test("源工程蓝图里的条目跟着带过来（生物的档位在里面）；设定资产保留自己的标题；撤销时主工程原来没有的蓝图也拿掉", async () => {
  const root = await folder()
  const lava = path.join(root, "lava")
  const made = await createImportBossSample(lava, "lava")
  const setting = made.workspace.assets.find((asset) => asset.module === "entity")!
  const item = made.items.find((value) => value.identifier === "core")!
  // An epic boss with more moves than the standard tier allows, as a plan settled it; its setting has a title of its own.
  const moves = Array.from({ length: 17 }, (_, index) => ({ ...made.entities[0]!.abilities![0]!, id: `move_${index}`, name: `第 ${index + 1} 招` }))
  const entity = { ...made.entities[0]!, abilities: moves }
  const entry = (key: string, kind: "entity" | "item", title: string, asset: string, extra = {}) => ({ key, kind, title, brief: title, owner: null, needs: [], out_of_scope: null, asset_id: asset, ...extra })
  await saveProject(lava, {
    ...made,
    entities: [entity],
    workspace: { assets: made.workspace.assets.map((asset) => (asset.id === setting.id && asset.document.kind === "entity" ? { ...asset, title: "熔岩魔像（终章 Boss）", document: { ...asset.document, abilities: moves } } : asset)) },
    blueprint: { request: "火山口的 Boss", style: { palette: [], shape: "", naming: "", world: "" }, entries: [entry("boss", "entity", "熔岩魔像", setting.id, { tier: { level: "epic", reason: "终章", by: "you" } }), entry("core", "item", "核心", item.id, { owner: "boss", needs: ["boss"] })], questions: [], revision: 1, state: "confirmed" },
  }, made.revision)
  const main = path.join(root, "main")
  await createProject({ directory: main, name: "主工程", mod_id: "main_mod", target: "forge-1.20.1" })
  const plan = await previewProjectImport(lava, main, { picks: [setting.id] })
  // With the tier the build would stop on seventeen moves; with it, nothing stops.
  expect(plan.blocked).toEqual([])
  expect(plan.plan_entries.map((value) => value.key)).toEqual(["boss", "core"])
  expect(plan.items.find((value) => value.kind === "entity")!.renames).toEqual([])
  const done = await applyProjectImport(lava, main, { picks: [setting.id], expectedRevision: 0, fingerprint: plan.fingerprint, importId: randomUUID() })
  const saved = await openProject(main)
  expect(saved.workspace.assets.find((asset) => asset.module === "entity")!.title).toBe("熔岩魔像（终章 Boss）")
  expect(saved.blueprint?.entries.map((value) => [value.key, value.tier?.level ?? null, value.owner])).toEqual([["boss", "epic", null], ["core", null, "boss"]])
  expect(saved.blueprint?.entries[0]!.asset_id).toBe(done.plan.items.find((value) => value.kind === "entity")!.target_id)
  await undoProjectImport(main, done.record.id, done.project.revision)
  expect((await openProject(main)).blueprint).toBeUndefined()
}, 300000)

test("单独导一样东西：一个粒子只带它自己；一样物品带上做它的配方和用它做材料的配方", async () => {
  const root = await folder()
  const lava = path.join(root, "lava")
  const made = await createImportBossSample(lava, "lava")
  const main = path.join(root, "main")
  await createImportBossSample(main, "frost")
  const spark = made.workspace.assets.find((asset) => asset.module === "particle")!
  const particle = await previewProjectImport(lava, main, { picks: [spark.id] })
  expect(particle.items.map((item) => [item.kind, item.renames.filter((rename) => rename.what !== "id").map((rename) => rename.to)])).toEqual([["particle", ["spark_crater", "火星（火山口）"]]])
  const core = made.items.find((item) => item.identifier === "core")!
  const item = await previewProjectImport(lava, main, { picks: [core.id] })
  expect(item.items.map((value) => `${value.kind}:${value.title}`).sort()).toEqual(["item:召唤符", "item:核心", "recipe:召唤符", "recipe:核心"])
  expect(item.items.some((value) => value.kind === "creature")).toBe(false)
  const done = await applyProjectImport(lava, main, { picks: [core.id], expectedRevision: (await openProject(main)).revision, fingerprint: item.fingerprint, importId: randomUUID() })
  expect(done.project.items.map((value) => value.identifier).sort()).toEqual(["core", "core_crater", "token", "token_crater"])
}, 300000)

test("生物的注册名照旧，只有真撞了才改，并写清楚旧存档会丢；只有模型、没有生物文档的不当成生物导入", async () => {
  const root = await folder()
  const lava = path.join(root, "lava")
  const made = await createImportBossSample(lava, "lava")
  const main = path.join(root, "main")
  await createProject({ directory: main, name: "主工程", mod_id: "shanhai", target: "forge-1.20.1" })
  const setting = made.workspace.assets.find((asset) => asset.module === "entity")!.id
  const row = made.entities[0]!.id
  const first = await previewProjectImport(lava, main, { picks: [setting] })
  expect(first.items.find((item) => item.kind === "creature")!.target_id).toBe(row)
  expect(first.items.flatMap((item) => item.renames).filter((rename) => rename.what === "registry")).toEqual([])
  expect(first.notes.map((note) => note.text).join("\n")).toContain("注册名的前缀换成 shanhai")
  await applyProjectImport(lava, main, { picks: [setting], expectedRevision: 0, fingerprint: first.fingerprint, importId: randomUUID() })
  // The same creature again: its registry name is taken now, so it is renamed, and the list says what a player's old save loses.
  // r29b: brought again from the same source it would be written over in place; asked for two copies, each is renamed as before.
  const again = await previewProjectImport(lava, main, { picks: [setting], choices: Object.fromEntries(first.items.map((item) => [item.source_id, "rename" as const])) })
  const creature = again.items.find((item) => item.kind === "creature")!
  const registry = creature.renames.find((rename) => rename.what === "registry")!
  expect(registry.from).toBe(`crater:creature_${row.replaceAll("-", "")}`)
  expect(registry.to).toBe(`shanhai:creature_${creature.target_id.replaceAll("-", "")}`)
  expect(again.notes.map((note) => note.text).join("\n")).toContain(`注册名从 ${registry.from} 改成 ${registry.to}：主工程里已经有这个注册名了。玩家旧存档里的这只会丢。`)
  expect(again.notes.map((note) => note.text).join("\n")).toContain("注册名从 crater:core 改成 shanhai:core_crater")
  // Only a model, no creature document: offered and brought as a model, never as a creature.
  const bare = path.join(root, "bare")
  const sample = await createImportBossSample(bare, "frost")
  const project = await openProject(bare)
  await saveProject(bare, { ...project, workspace: { assets: project.workspace.assets.filter((asset) => asset.module !== "entity") } }, project.revision)
  const { importableThings } = await import("../src/project-import")
  const offered = importableThings(await openProject(bare))
  expect(offered.some((thing) => thing.kind === "creature")).toBe(false)
  expect(offered.some((thing) => thing.kind === "model" && thing.id === sample.entities[0]!.id)).toBe(true)
  expect((await previewProjectImport(bare, main, { picks: [sample.entities[0]!.id] })).items.map((item) => item.kind)).toEqual(["model"])
}, 300000)
