import { afterEach, expect, test } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { putModelAsset } from "../src/assets"
import { BOOK_INSTRUCTIONS } from "../src/book"
import { assembleBuildSource } from "../src/build-source"
import { BuildStop } from "../src/build-stop"
import { GROUND_FX_RUNTIME } from "../src/common/ground-fx"
import { PROJECTILE_RUNTIME } from "../src/common/projectiles"
import { CREATURE_SOUND_INSTRUCTIONS } from "../src/data-words"
import { BossSchema, EntityRuntimeSchema, EntitySchema } from "../src/entity-runtime"
import { ARENA_RUNTIME } from "../src/fabric/arena"
import { BOSS_LOOK_RUNTIME } from "../src/fabric/boss-look"
import { EFFECT_RUNTIME } from "../src/fabric/effect"
import { PART_RUNTIME } from "../src/fabric/hitbox"
import { createEntity, createProject, openProject, saveProject, type Project } from "../src/project"
import { applyProjectImport, previewProjectImport } from "../src/project-import"
import { reconcile } from "../src/reconcile"
import { RESERVED_ENTITY_NAMES, RegistryNameSchema, bookName, creatureName, registryClashes } from "../src/registry-name"
import type { TargetId } from "../src/target/ids"
import { applyWorkspaceAsset, ModuleDocumentSchema } from "../src/workspace"
import { createDataGameplaySample, fightingGolemDesign } from "../script/data-gameplay-sample"
import { createImportBossSample } from "../script/import-boss-sample"
import { BOOK_IDS, createBookSample } from "../script/target-book-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * r29b: the registry name of a creature or a book (`identifier`, `registry-name.ts`). Without it every name is what it was, made of the id; with it the
 * creature's spawn egg, language keys, loot table, model files and a boss's lair (and the guards put in it) take it on every target, and a book's item takes it.
 * The samples are a temple keeper with skeleton guards and a wolf pack, and a workshop's manual, not a character of the stories.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const fresh = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-registry-"))
  roots.push(root)
  return root
}
const hex = (id: string) => id.replaceAll("-", "")

const lair = { biomes: [] as string[], tags: ["is_overworld"], spacing: 40, radius: 9, floor: ["minecraft:stone_bricks"], rim: null, clearance: 6 }
const runtime = (spawn: unknown, garrison?: unknown) => EntityRuntimeSchema.parse({ spawn, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null, ...(garrison === undefined ? {} : { garrison }) })
const spawnOf = (near?: unknown) => ({ biomes: [], tags: ["is_overworld"], weight: 10, min: 1, max: 2, ...(near === undefined ? {} : { near }) })
const loot = [{ item: "minecraft:bone", min: 1, max: 2, chance: 1, player_only: false }]

/** A temple keeper (a boss with a lair), its skeleton guards (on the lair and near it) and a wolf: `names` gives each of the first two its own registry name, the wolf none. */
async function templeProject(directory: string, target: TargetId, names: { keeper?: string | null; guard?: string | null } = {}) {
  const created = await createProject({ directory, name: "石殿", description: "石殿守灵和它的骷髅卫兵。", mod_id: "stone_temple", target })
  const named = (value: string | null | undefined) => (value === undefined ? {} : { identifier: value })
  const boss = EntitySchema.parse({ ...createEntity({ name: "石殿守灵", health: 120, speed: 0.22, attack_damage: 6, behavior: "hostile" }), name_en: "Temple Keeper", ...named(names.keeper), loot, boss: BossSchema.parse({ bar: { color: "white", style: "progress", darken_sky: false }, intro: null, phases: [], death: { seconds: 2, xp_bursts: 2, explosion: false }, leash: null, lair }), runtime: runtime(null), sounds: { ambient: "entity.skeleton.ambient", hurt: null, death: null, step: null, pitch: 1, volume: 1 } })
  const guard = EntitySchema.parse({ ...createEntity({ name: "骷髅卫兵", health: 24, speed: 0.25, attack_damage: 3, behavior: "hostile" }), name_en: "Skeleton Guard", ...named(names.guard), loot, runtime: runtime(spawnOf({ structures: [{ lair: boss.id }], distance: 16 }), { structure: { lair: boss.id }, min: 3, max: 4 }) })
  const wolf = EntitySchema.parse({ ...createEntity({ name: "灰狼", health: 16, speed: 0.3, attack_damage: 3, behavior: "hostile" }), name_en: "Grey Wolf", runtime: runtime(spawnOf()) })
  let project = await saveProject(directory, { ...created, entities: [boss, guard, wolf] }, created.revision)
  for (const entity of [boss, guard, wolf]) project = (await putModelAsset(directory, { entity_id: entity.id, data: { design: fightingGolemDesign }, origin: "example", expectedRevision: project.revision })).project
  return { project, boss, guard, wolf }
}

/** Every generated file, by its path with forward slashes, and its bytes. */
async function tree(source: string) {
  const entries = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile())
  return Object.fromEntries(await Promise.all(entries.map(async (entry) => [path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"), await readFile(path.join(entry.parentPath, entry.name))] as const)))
}
const digest = (files: Record<string, Buffer>) => createHash("sha256").update(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => `${name}:${createHash("sha256").update(bytes).digest("hex")}`).join("\n")).digest("hex")

async function build(directory: string, root: string, name: string) {
  const source = path.join(root, name)
  await mkdir(source)
  const built = await assembleBuildSource(directory, source, TEMPLATE)
  return { source, built, files: await tree(source) }
}

// ---- the name ----

test("a registry name is written the way an item's identifier is, said in plain words when it is not; without one the name is made of the id as before", () => {
  const id = "64e4b0c2-1111-4222-8333-444455556666"
  expect(creatureName({ id })).toBe(`creature_${hex(id)}`)
  expect(creatureName({ id, identifier: null })).toBe(`creature_${hex(id)}`)
  expect(creatureName({ id, identifier: "temple_keeper" })).toBe("temple_keeper")
  expect(bookName({ id, document: {} })).toBe(`book_${hex(id)}`)
  expect(bookName({ id, document: { identifier: "workshop_manual" } })).toBe("workshop_manual")
  expect(RegistryNameSchema.safeParse("temple_keeper").success).toBe(true)
  for (const bad of ["Temple", "stone_temple:keeper", "1keeper", "守灵", "a".repeat(65)]) expect(RegistryNameSchema.safeParse(bad).error?.issues[0]?.message).toContain("小写字母开头")
  expect(RegistryNameSchema.safeParse(`creature_${hex(id)}`).error?.issues[0]?.message).toContain("Studio 自动起的名字")
  // The entity types every mod may register besides its creatures are the generators' own names.
  expect([...RESERVED_ENTITY_NAMES].sort() as string[]).toEqual([PROJECTILE_RUNTIME.registry, GROUND_FX_RUNTIME.registry, ARENA_RUNTIME.registry, BOSS_LOOK_RUNTIME.registry, EFFECT_RUNTIME.registry, PART_RUNTIME.registry, "studio_terrain"].sort())
  // Both documents take it, and an older document without it is still what it was.
  const book = ModuleDocumentSchema.parse({ kind: "book", name: "工坊手册", pages: [{ body: "第一页" }] })
  expect("identifier" in book).toBe(false)
  expect(ModuleDocumentSchema.safeParse({ ...book, identifier: "workshop_manual" }).success).toBe(true)
  expect(ModuleDocumentSchema.safeParse({ ...book, identifier: "Workshop" }).success).toBe(false)
  // The outside AI is told, briefly.
  expect(CREATURE_SOUND_INSTRUCTIONS).toContain("可选 identifier：生物的注册名")
  expect(BOOK_INSTRUCTIONS).toContain("identifier?")
  expect(BOOK_INSTRUCTIONS).toContain("可选 identifier：书的注册名")
})

test("without a registry name the tree is byte for byte the tree of `identifier: null`, and every creature keeps `creature_<id>`", async () => {
  const root = await fresh()
  const directory = path.join(root, "石殿")
  const made = await templeProject(directory, "fabric-1.21.1")
  const a = await build(directory, root, "a")
  const saved = await openProject(directory)
  await saveProject(directory, { ...saved, entities: saved.entities.map((entity) => ({ ...entity, identifier: null })) }, saved.revision)
  const b = await build(directory, root, "b")
  // What the game gets (`src/`): the build record, the read-me and the project copy beside it carry the project's revision.
  const game = (files: Record<string, Buffer>) => Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith("src/")))
  expect(Object.keys(b.files).filter((name) => name.startsWith("src/") && !a.files[name]?.equals(b.files[name]!))).toEqual([])
  expect(digest(game(b.files))).toBe(digest(game(a.files)))
  expect(Object.keys(a.files)).toContain(`src/main/resources/data/stone_temple/worldgen/structure/creature_${hex(made.boss.id)}_lair.json`)
  expect(JSON.parse(a.files[`src/main/resources/data/stone_temple/worldgen/structure/creature_${hex(made.boss.id)}_lair.json`]!.toString("utf8")).guards).toEqual([{ creature: `stone_temple:creature_${hex(made.guard.id)}`, min: 3, max: 4 }])
  expect(a.built.findings.filter((finding) => finding.rule.startsWith("registry_"))).toEqual([])
}, 240000)

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: a creature that names itself is registered by that name everywhere, its lair and its guards too, and the whole tree compiles`, async () => {
    const root = await fresh()
    const directory = path.join(root, "石殿")
    const { boss, guard, wolf } = await templeProject(directory, target, { keeper: "temple_keeper", guard: "skeleton_guard" })
    const { source, built, files } = await build(directory, root, "source")
    expect(built.findings.filter((finding) => finding.stops)).toEqual([])
    const names = Object.keys(files)
    const text = (name: string) => files[name]!.toString("utf8")
    const assets = "src/main/resources/assets/stone_temple"
    const data = "src/main/resources/data/stone_temple"
    for (const name of ["temple_keeper", "skeleton_guard"]) {
      expect(names).toContain(`${assets}/geo/${name}.geo.json`)
      expect(names).toContain(`${assets}/animations/${name}.animation.json`)
      expect(names).toContain(`${assets}/textures/entity/${name}.png`)
      expect(names).toContain(`${data}/${target === "forge-1.20.1" ? "loot_tables" : "loot_table"}/entities/${name}.json`)
      expect(JSON.parse(text(`${assets}/geo/${name}.geo.json`))["minecraft:geometry"][0].description.identifier).toBe(`geometry.${name}`)
      for (const locale of ["zh_cn", "en_us"]) {
        const lang = JSON.parse(text(`${assets}/lang/${locale}.json`))
        expect(lang[`entity.stone_temple.${name}`]).toBeTruthy()
        expect(lang[`item.stone_temple.${name}_spawn_egg`]).toBeTruthy()
      }
    }
    // The lair is named after the keeper's name, its set places that structure, its guards are the guard's name, and the guard keeps near it by that name.
    const structure = JSON.parse(text(`${data}/worldgen/structure/temple_keeper_lair.json`))
    expect(structure).toMatchObject({ creature: "stone_temple:temple_keeper", guards: [{ creature: "stone_temple:skeleton_guard", min: 3, max: 4 }] })
    expect(JSON.parse(text(`${data}/worldgen/structure_set/temple_keeper_lair.json`)).structures[0].structure).toBe("stone_temple:temple_keeper_lair")
    const java = names.filter((name) => name.endsWith(".java")).map(text).join("\n")
    expect(java).toContain('ResourceLocation.tryParse("stone_temple:temple_keeper_lair")')
    expect(java).toContain('"temple_keeper"')
    expect(java).toContain('"skeleton_guard"')
    // Nothing anywhere still says the old names; the wolf, which names nothing, keeps its own.
    for (const entity of [boss, guard]) expect(names.filter((name) => name.includes(`creature_${hex(entity.id)}`) || (!name.endsWith(".png") && text(name).includes(`creature_${hex(entity.id)}`)))).toEqual([])
    expect(names).toContain(`${assets}/geo/creature_${hex(wolf.id)}.geo.json`)
    // Said at the build: old worlds lose the two under their old names. Nothing stops.
    const renamed = built.findings.filter((finding) => finding.rule === "registry_renamed")
    expect(renamed.map((finding) => finding.about?.id).sort()).toEqual([boss.id, guard.id].sort())
    expect(renamed.find((finding) => finding.about?.id === boss.id)!.text).toBe(`「石殿守灵」的注册名是 stone_temple:temple_keeper，不再是原来的 stone_temple:creature_${hex(boss.id)}：已有世界里旧名字的这个生物会消失。`)
    expect(renamed.every((finding) => !finding.stops)).toBe(true)
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 300000)

  test(`${target}: a book that names itself is an item by that name, its words under it, and the tree compiles`, async () => {
    const root = await fresh()
    const directory = path.join(root, "工程")
    const project = await createBookSample(directory, target)
    await saveProject(directory, { ...project, workspace: { assets: project.workspace.assets.map((asset) => (asset.id === BOOK_IDS.manual ? { ...asset, document: { ...asset.document, identifier: "workshop_manual" } } : asset)) } } as Project, project.revision)
    const { source, built, files } = await build(directory, root, "source")
    const names = Object.keys(files)
    const assets = "src/main/resources/assets/book_sample"
    expect(names).toContain(`${assets}/models/item/workshop_manual.json`)
    expect(names).toContain(`${assets}/textures/item/workshop_manual.png`)
    expect(names.some((name) => name.includes(`book_${hex(BOOK_IDS.manual)}`))).toBe(false)
    // The other books keep the names their ids make.
    expect(names).toContain(`${assets}/models/item/book_${hex(BOOK_IDS.bestiary)}.json`)
    const zh = JSON.parse(files[`${assets}/lang/zh_cn.json`]!.toString("utf8"))
    expect(zh["item.book_sample.workshop_manual"]).toBe("齿轮工坊说明书")
    expect(zh["book.book_sample.workshop_manual.1.title"]).toBe("写在前面")
    expect(built.findings.find((finding) => finding.rule === "registry_renamed")!.text).toContain("已有世界里旧名字的这本书会消失")
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 300000)
}

// ---- clashes ----

test("a name the mod already gives something else is refused at save, found by the reconciliation and stops the build, in plain words", async () => {
  const root = await fresh()
  const directory = path.join(root, "石殿")
  const made = await templeProject(directory, "fabric-1.21.1", { keeper: "temple_keeper", guard: "temple_keeper" })
  const clashes = registryClashes(made.project)
  expect(clashes.map((clash) => clash.id).sort()).toEqual([made.boss.id, made.guard.id].sort())
  const found = reconcile(made.project, { animations: {} }).filter((finding) => finding.rule === "registry_clash")
  expect(found).toHaveLength(2)
  expect(found.every((finding) => finding.stops)).toBe(true)
  expect(found.find((finding) => finding.about?.id === made.guard.id)!.text).toBe("生物「骷髅卫兵」的注册名写成 stone_temple:temple_keeper，这个名字已经给了生物「石殿守灵」：游戏里一个名字只能给一样东西，模组会装不上。")
  expect(found[0]!.fix).toContain("换一个没人用的名字")
  expect(found[0]!.targets?.[0]?.field).toBe("identifier")
  const error = await assembleBuildSource(directory, path.join(root, "source"), TEMPLATE).catch((cause: unknown) => cause)
  expect(error).toBeInstanceOf(BuildStop)
  expect((error as BuildStop).rule).toBe("registry_clash")
  expect((error as BuildStop).message).toContain("模组会装不上")
  // The entity types every mod has, and an item named as a spawn egg would be, are taken too.
  expect(registryClashes({ ...made.project, entities: [{ ...made.boss, identifier: "studio_projectile" }] })[0]!.other.words).toBe("Studio 自己的一个内部生物")
  const egg = { id: randomUUID(), identifier: "temple_keeper_spawn_egg", name: "守灵蛋", max_stack: 64, color: "#888888" }
  expect(registryClashWords(made.project, { ...made.project, entities: [made.boss], items: [egg] } as Project)).toContain("它的刷怪蛋就叫 stone_temple:temple_keeper_spawn_egg，这个名字已经给了物品「守灵蛋」")
  // A creature and an item may share a name, as the game lets them; nothing that names nothing is ever checked.
  expect(registryClashes({ ...made.project, entities: [made.boss], items: [{ ...egg, identifier: "temple_keeper" }] } as Project)).toEqual([])
  expect(registryClashes({ ...made.project, entities: made.project.entities.map(({ identifier: _name, ...entity }) => entity) })).toEqual([])
}, 240000)

test("saving a creature's or a book's document with a name another thing has is refused with the words, and taking the name off gives the old name back", async () => {
  const root = await fresh()
  const directory = path.join(root, "工程")
  const project = await createBookSample(directory)
  const manual = project.workspace.assets.find((asset) => asset.id === BOOK_IDS.manual)!
  const bestiary = project.workspace.assets.find((asset) => asset.id === BOOK_IDS.bestiary)!
  const first = applyWorkspaceAsset(project, { ...manual, document: { ...manual.document, identifier: "workshop_manual" } } as typeof manual)
  expect(() => applyWorkspaceAsset(first, { ...bestiary, document: { ...bestiary.document, identifier: "workshop_manual" } } as typeof bestiary)).toThrow("书「沼泽怪物图鉴」的注册名写成 book_sample:workshop_manual，这个名字已经给了书「齿轮工坊说明书」")
  // The creature's document and its row: the name is the row's, and a document without it takes it off the row.
  const sample = await createDataGameplaySample(path.join(root, "矿洞"), { life: true, hitbox: true })
  const [golem, long] = sample.workspace.assets.filter((asset) => asset.document.kind === "entity")
  const named = applyWorkspaceAsset(sample, { ...golem!, document: { ...golem!.document, identifier: "crystal_golem" } } as typeof golem & {})
  const golemId = (golem!.document as { model_asset_id: string }).model_asset_id
  expect(named.entities.find((entity) => entity.id === golemId)!.identifier).toBe("crystal_golem")
  expect(() => applyWorkspaceAsset(named, { ...long!, document: { ...long!.document, identifier: "crystal_golem" } } as typeof long & {})).toThrow("这个名字已经给了生物「晶石傀儡」")
  const cleared = applyWorkspaceAsset(named, golem!)
  expect(creatureName(cleared.entities.find((entity) => entity.id === golemId)!)).toBe(`creature_${hex(golemId)}`)
}, 240000)

// ---- 整只导入 ----

test("整只导入带着生物自己的注册名；主工程里已经有这个名字时照现有做法改名，并说旧存档里的会丢", async () => {
  const root = await fresh()
  const lava = path.join(root, "lava")
  const made = await createImportBossSample(lava, "lava")
  const setting = made.workspace.assets.find((asset) => asset.module === "entity")!
  const row = made.entities[0]!
  await saveProject(lava, { ...made, entities: [{ ...row, identifier: "magma_keeper" }], workspace: { assets: made.workspace.assets.map((asset) => (asset.id === setting.id ? { ...asset, document: { ...asset.document, identifier: "magma_keeper" } } : asset)) } } as Project, made.revision)
  const main = path.join(root, "main")
  await createProject({ directory: main, name: "主工程", mod_id: "shanhai", target: "forge-1.20.1" })
  const first = await previewProjectImport(lava, main, { picks: [setting.id] })
  expect(first.items.flatMap((item) => item.renames).filter((rename) => rename.what === "registry")).toEqual([])
  const done = await applyProjectImport(lava, main, { picks: [setting.id], expectedRevision: 0, fingerprint: first.fingerprint, importId: randomUUID() })
  const brought = done.project.entities.find((entity) => entity.name === row.name)!
  expect(brought.identifier).toBe("magma_keeper")
  expect(done.project.workspace.assets.find((asset) => asset.document.kind === "entity" && asset.document.model_asset_id === brought.id)!.document).toMatchObject({ identifier: "magma_keeper" })
  // Again: the name is taken now (its id is too), so it is renamed the way an item is, and the list says what a player's old save loses.
  const again = await previewProjectImport(lava, main, { picks: [setting.id], choices: Object.fromEntries(first.items.map((item) => [item.source_id, "rename" as const])) })
  const creature = again.items.find((item) => item.kind === "creature")!
  expect(creature.renames.find((rename) => rename.what === "registry")).toEqual({ what: "registry", from: "crater:magma_keeper", to: "shanhai:magma_keeper_crater" })
  expect(again.notes.map((note) => note.text).join("\n")).toContain("注册名从 crater:magma_keeper 改成 shanhai:magma_keeper_crater：主工程里已经有这个注册名了。玩家旧存档里的这只会丢。")
  // Into a project whose own creature (another id) has that name: the id is kept, the name changed, and the creature brought has the new one.
  const other = path.join(root, "other")
  const frost = await createImportBossSample(other, "frost")
  const own = frost.workspace.assets.find((asset) => asset.module === "entity")!
  await saveProject(other, { ...frost, entities: frost.entities.map((entity) => ({ ...entity, identifier: "magma_keeper" })), workspace: { assets: frost.workspace.assets.map((asset) => (asset.id === own.id ? { ...asset, document: { ...asset.document, identifier: "magma_keeper" } } : asset)) } } as Project, frost.revision)
  const into = await previewProjectImport(lava, other, { picks: [setting.id] })
  const moved = into.items.find((item) => item.kind === "creature")!
  expect(moved.target_id).toBe(row.id)
  expect(moved.renames.filter((rename) => rename.what === "registry")).toEqual([{ what: "registry", from: "crater:magma_keeper", to: `${frost.mod_id}:magma_keeper_crater` }])
  const twice = await applyProjectImport(lava, other, { picks: [setting.id], expectedRevision: (await openProject(other)).revision, fingerprint: into.fingerprint, importId: randomUUID() })
  expect(twice.project.entities.find((entity) => entity.id === row.id)!.identifier).toBe("magma_keeper_crater")
  expect(registryClashes(await openProject(other))).toEqual([])
}, 300000)

/** The words a project with this one item says about its creatures' names. */
function registryClashWords(project: Project, next: Project) {
  return reconcile({ ...project, ...next }, { animations: {} }).filter((finding) => finding.rule === "registry_clash").map((finding) => finding.text).join("\n")
}
