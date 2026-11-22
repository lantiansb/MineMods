import { createHash } from "node:crypto"
import { lstat, readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import type { FindingRef } from "@minemods/studio-ai/acceptance"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { ModelAssetSchema, type ModelAsset } from "./assets"
import { BlockSchema, ItemSchema, LogicSchema, RecipeSchema, validateContent } from "./content"
import { creatureLairIssues, creatureLootIssues, creatureSummonIssues, creatureTemptIssues, creatureTerrainIssues } from "./creature-life"
import { compileSavedModel } from "./editable-model"
import { creatureName } from "./gameplay"
import { bookName } from "./registry-name"
import { mediaHashes, mediaPath, readMedia, storeMedia } from "./media"
import { openProject, projectTargets, ProjectSchema, saveProjectUnlocked, storagePath, withProjectLock, writeRecord, type Project } from "./project"
import { reconcile, type Finding } from "./reconcile"
import { recipeClashes, recipeThing } from "./recipe-clash"
import { targetMinecraft, lacksOf } from "./version-lacks"
import { mirrorContent, type WorkspaceAsset } from "./workspace"
import { assetKind, type ModuleKind } from "./workspace-modules"
import { kindGap } from "./platform/kind-gaps"
import type { TargetId } from "./target/ids"

/**
 * 从别的工程导入 (cross-project import): one or more things of another Studio project, with everything they use, brought into this one, so
 * several projects made apart (one chapter's boss each) become one mod, one mod_id. The source is only read. The main project is written
 * once, after the person (or the outside AI on their behalf) has seen the list, and the import can be undone.
 *
 * What is brought follows the links the project already keeps, nothing of its own:
 * - a workspace asset's `dependencies`, and any asset id its document names (the registry's "id" and "dependency" references);
 * - the identifiers a document names (the registry's "identifier" references: drops, summons, lures, lairs, recipes, repairs, bindings);
 * - what belongs to a thing (the registry's `belongs`): a model's animations and texture, the recipes that make an item, a creature's rules;
 * - a creature's saved model, its conception entries and the media files its documents name.
 * Gameplay code is not brought: its Java names things by strings this import cannot follow. A thing that needs it is refused, with the reason.
 */

/** What a person may choose for one thing of the list (`choices`). */
export const IMPORT_CHOICES = ["rename", "reuse", "replace"] as const
export const ProjectImportInputSchema = z.strictObject({
  /** What to bring: workspace asset ids, a creature's id, or a block's, item's, recipe's or rule's id. */
  picks: z.array(z.uuid()).min(1).max(64),
  /** When the main project already has the very same thing (same content, same dependencies): use it ("reuse_same", the default since r29b) or still bring a renamed copy ("rename"). Things of the same id or name with other content are renamed unless `choices` says otherwise. */
  conflict: z.enum(["rename", "reuse_same"]).default("reuse_same"),
  /**
   * Per thing (source id), overriding `conflict`. "rename": bring a renamed copy beside the main project's own. "reuse": use the main project's own instead, where
   * the plan found the same thing or (r29b) one by the same id or game name (`namesake`), whatever its content. "replace" (r29b): only for a namesake: the main
   * project's own takes the imported content, under its own id and game name.
   */
  choices: z.record(z.uuid(), z.enum(IMPORT_CHOICES)).optional(),
})
export type ProjectImportInput = z.input<typeof ProjectImportInputSchema>

/**
 * What a clash changed. "title": the name Studio and the game show; "id": the asset's own number. "registry" (a creature) and "identifier" (a block or an item): the
 * name the game registers it by, changed only when the main project already registers that very name; a player's old save that holds one of these loses it.
 */
export type ImportRename = { what: "id" | "identifier" | "registry" | "name" | "title"; from: string; to: string }
export type ImportItem = {
  source_id: string
  kind: ModuleKind | "creature"
  title: string
  /** Why it comes along: who uses it and how, in plain words. The first is the reason it was added to the list. */
  why: string[]
  /**
   * "add": brought as a new thing; "reuse": the main project's `same_as` is used instead, and every reference points at it. r29b: "replace": the main project's
   * namesake takes the imported content in its place (its id and game name kept, so whatever uses it still does); "update": the same, for the thing an earlier
   * import from this very source brought (`again`).
   */
  action: "add" | "reuse" | "replace" | "update"
  /** Its id in the main project after the import. */
  target_id: string
  same_as: { id: string; title: string } | null
  renames: ImportRename[]
  /**
   * r29b: the main project's own thing of the same kind with the same id or the same game name (identifier, or a sound's, music's or particle's name) whose content
   * differs, with the fields that differ. The person chooses: "reuse" it, "replace" it with the imported one, or "rename" (bring both, the default).
   */
  namesake?: { id: string; title: string; fields: string[] }
  /** r29b: what an earlier import from this source brought, by its id in the main project, and whether it was changed there since (the new version overwrites it). */
  again?: { id: string; title: string; edited: boolean }
}
export type ImportNote = { text: string; refs: FindingRef[] }
export type ImportPlan = {
  source: { id: string; name: string; mod_id: string; revision: number; targets: TargetId[]; sha256: string }
  main: { id: string; name: string; mod_id: string; revision: number; targets: TargetId[] }
  items: ImportItem[]
  /** Saved creature models copied alongside (one current version each). */
  models: number
  /** The source's plan entries for what is brought (keeping a creature's tier and its answers to the playability questions), under the key each has in the main project's plan. */
  plan_entries: { key: string; title: string; from: string }[]
  /** Media files copied (those the main project does not hold already). */
  media: number
  /** Things of the source that use what is brought but are not brought, and why. */
  left_out: { id: string; kind: string; title: string; why: string }[]
  /** What changes on the main project's targets and options, what was switched automatically, and what the main project's check says about the things brought. */
  notes: ImportNote[]
  /** Why the import cannot be done as it stands. Empty: it can. */
  blocked: string[]
  /** Hash of the list: the person confirms this list, and the import refuses when the projects changed in between. */
  fingerprint: string
}

const KIND_ORDER: readonly ModuleKind[] = ["worldview", "texture", "model", "animation", "sound", "music", "particle", "effect", "gesture", "fixture", "bossbar", "item", "block", "recipe", "logic", "ability", "entity", "biome", "dimension", "terrain", "gameplay"]
// Keys under which a document names a block or an item of the project by identifier (bare, or as mod_id:identifier): the registry's "identifier" references.
const IDENTIFIER_KEYS = new Set(["item", "block", "block_identifier", "material", "tempt", "floor", "rim", "repair", "result", "pattern"])
const IDENTIFIER_WORDS: Record<string, string> = { item: "用到的物品", block: "用到的方块", block_identifier: "死后掉落的盲盒方块", material: "地形招式用的方块", tempt: "引诱它的物品", floor: "巢的地面", rim: "巢的边", repair: "修理用的材料", result: "做出的东西", pattern: "配方的材料" }
// Kinds a same-thing match is looked for: what two projects may well have made alike from the same game resources.
const REUSABLE = new Set<ModuleKind>(["sound", "music", "particle", "effect", "item", "block", "recipe", "bossbar", "fixture", "texture", "worldview"])
const GEOMETRY = new Set<ModuleKind>(["model", "texture", "animation"])
// r29b: kinds whose main project's own of the same id or game name is offered whatever its content (`namesake`), and the field each is named in the game by.
const NAMESAKES = new Set<ModuleKind>([...REUSABLE, "ability", "book"])
const GAME_NAMED: Partial<Record<string, string>> = { item: "identifier", block: "identifier", book: "identifier", sound: "name", music: "name", particle: "name", effect: "name" }
const gameName = (document: { kind: string }) => ((key) => ((value) => (typeof value === "string" && value ? value : null))(key ? (document as Record<string, unknown>)[key] : undefined))(GAME_NAMED[document.kind])
/** The main project's own game name of a thing written over, kept: whatever uses it by that name still finds it. */
const keptName = (document: { kind: string }) => ((key, value) => (key && value ? { [key]: value } : {}))(GAME_NAMED[document.kind], gameName(document))
/**
 * The name shown in the game for an item, block or recipe brought in: `title` (its title in the main project, renamed or kept) when the source's name was
 * just its title, else the source's own name. 合包 (r29d): a name of its own (「山晖之筋」 under the title 「山𤟤之筋」, the game lacking 𤟤) was replaced by the title.
 */
const ownName = (asset: { title: string; document: unknown }, title: string) => ((name) => (typeof name === "string" && name && name !== asset.title ? name : title))((asset.document as { name?: unknown }).name)
/** The fields of the main project's own that the imported one has otherwise (its references already pointing into the main project), and its dependencies. */
function differences(before: WorkspaceAsset, document: unknown, dependencies: readonly string[]) {
  const own = before.document as Record<string, unknown>
  const other = document as Record<string, unknown>
  const fields = [...new Set([...Object.keys(own), ...Object.keys(other)])].filter((key) => key !== "kind" && canonical(own[key]) !== canonical(other[key]))
  return [...fields, ...(canonical([...before.dependencies].sort()) !== canonical([...dependencies].sort()) ? ["dependencies"] : [])]
}
// Vanilla particles and sounds a game version lacks, with the nearest it has: switched when the main project's targets lack what the source used.
const VANILLA_SWAPS: Record<string, string> = { dust_plume: "poof", gust: "cloud", "entity.breeze.shoot": "entity.blaze.shoot" }

type Walk = (text: string, key: string | null) => string
function walk(value: unknown, key: string | null, map: Walk): unknown {
  if (typeof value === "string") return map(value, key)
  if (Array.isArray(value)) return value.map((entry) => walk(entry, key, map))
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, walk(entry, name, map)]))
  return value
}
const visit = (value: unknown, see: (text: string, key: string | null) => void) => walk(value, null, (text, key) => (see(text, key), text))

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`
  return JSON.stringify(value)
}
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
/** A new id for a thing whose id the main project already holds: the same every time the same import is planned, so the list a person confirmed is the list written. */
function freshId(seed: string) {
  const hash = sha(seed)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${"89ab"[Number.parseInt(hash[16]!, 16) % 4]}${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
/** `core` → `core_<source mod>`, held to the name's own length, and counted on while still taken. */
function freshName(base: string, suffix: string, taken: Set<string>, max: number) {
  const head = (extra: string) => `${base.slice(0, Math.max(1, max - suffix.length - extra.length - 1))}_${suffix}${extra}`
  const found = [head(""), ...Array.from({ length: 98 }, (_, index) => head(`_${index + 2}`))].find((name) => !taken.has(name))
  if (!found) throw new Error(`「${base}」找不到不重名的名字。`)
  taken.add(found)
  return found
}
function freshTitle(title: string, from: string, taken: Set<string>) {
  const head = (extra: string) => `${title.slice(0, Math.max(1, 120 - from.length - extra.length - 2))}（${from}${extra}）`
  const found = [head(""), ...Array.from({ length: 98 }, (_, index) => head(` ${index + 2}`))].find((name) => !taken.has(name)) ?? title
  taken.add(found)
  return found
}

/** Everything the plan reads, already loaded: the two projects and the source's saved creature models (by their reference id). */
export type ImportSides = {
  source: Project
  main: Project
  sourceSha256: string
  records: ReadonlyMap<string, { record: ModelAsset; bytes: Uint8Array }>
  /** Whether the main project already holds a media file. */
  hasMedia: (hash: string) => boolean
  /** r29b: what earlier imports from this very source (not undone) brought, by source id: its id in the main project and when it was brought (the newest import's). */
  earlier?: ReadonlyMap<string, { target: string; at: string; kept?: boolean }>
}

type Node = { id: string; kind: ModuleKind | "creature"; title: string; why: string[] }
type Built = {
  plan: Omit<ImportPlan, "fingerprint" | "notes"> & { notes: ImportNote[] }
  next: Project
  /** Model records to write into the main project, with the bytes (the source's own when nothing in them changed). */
  // `over`: (r29b) the next version of a model the main project keeps (a creature brought again): only that file is new, the folder holds its older versions.
  records: { record: ModelAsset; bytes: Uint8Array; over: boolean }[]
  media: string[]
  imported: ImportedIds
  /** Source id → its id in the main project, for what was brought and what was matched to the main project's own. */
  ids: ReadonlyMap<string, string>
  /** The plan entries added to the main project's blueprint, and whether the import made that blueprint (the main project had none). */
  blueprint: { created: boolean; keys: string[] }
  /** r29b: what of the main project the import writes over ("replace", "update"), as it was before, for the undo to put back. */
  overwritten: ImportOverwritten
}
export type ImportOverwritten = { workspace: WorkspaceAsset[]; entities: Project["entities"]; assets: Project["assets"]; blocks: Project["blocks"]; items: Project["items"]; recipes: Project["recipes"]; logic: Project["logic"]; conception: Project["conception"]["entries"] }
export type ImportedIds = { workspace: string[]; entities: string[]; assets: string[]; blocks: string[]; items: string[]; recipes: string[]; logic: string[]; conception: string[] }

const label = (kind: ModuleKind | "creature") => (kind === "creature" ? "生物" : assetKind(kind).label)

/** The list and the main project as it would be after the import, without writing anything. */
export function planProjectImport(sides: ImportSides, given: ProjectImportInput): Built {
  const input = ProjectImportInputSchema.parse({ picks: given.picks, conflict: given.conflict, choices: given.choices })
  const main = sides.main
  // A block, item, recipe or rule kept only in the content lists gets the asset that stands for it, in memory: the source stays as it is on disk.
  const source = mirrorContent(sides.source, new Set([...sides.source.blocks, ...sides.source.items, ...sides.source.recipes, ...sides.source.logic].map((value) => value.id)))
  const srcMod = source.mod_id
  const assets = new Map(source.workspace.assets.map((asset) => [asset.id, asset]))
  const rows = new Map(source.entities.map((entity) => [entity.id, entity]))
  const things = new Map(source.workspace.assets.flatMap((asset) => (asset.document.kind === "item" || asset.document.kind === "block" ? [[asset.document.identifier, asset] as const] : [])))
  const local = (text: string) => (text.startsWith(`${srcMod}:`) ? text.slice(srcMod.length + 1) : text.includes(":") || text.startsWith("#") ? null : text)
  const blocked: string[] = []
  const nodes = new Map<string, Node>()
  const queue: string[] = []
  const add = (id: string, kind: Node["kind"], title: string, why: string) => {
    const found = nodes.get(id)
    if (found) {
      if (!found.why.includes(why)) found.why.push(why)
      return
    }
    nodes.set(id, { id, kind, title, why: [why] })
    queue.push(id)
  }
  const addAsset = (asset: WorkspaceAsset, why: string) => add(asset.id, asset.module, asset.title, why)
  // Only a creature with a creature document (its entity asset) is brought as a creature; one that has only a model is not.
  const documented = new Set(source.workspace.assets.flatMap((asset) => (asset.document.kind === "entity" ? [asset.document.model_asset_id] : [])))
  const addRow = (id: string, why: string) => {
    const row = rows.get(id)
    if (row && documented.has(id)) add(`row:${id}`, "creature", row.name, why)
  }
  for (const pick of input.picks) {
    const asset = assets.get(pick)
    if (asset) addAsset(asset, "你选的")
    else if (rows.has(pick) && documented.has(pick)) addRow(pick, "你选的")
    else if (rows.has(pick)) blocked.push(`「${rows.get(pick)!.name}」只有模型、没有生物文档，不当成生物导入。要带它的样子，就选它的模型。`)
    else blocked.push(`源工程里没有编号为 ${pick} 的东西。`)
  }
  const reach = (owner: Node, document: unknown, dependencies: readonly string[]) => {
    const kind = owner.kind === "creature" ? "entity" : owner.kind
    const words = (target: WorkspaceAsset) => assetKind(kind).references.find((reference) => reference.kinds.includes(target.module) && reference.what)?.what ?? `用到的${assetKind(target.module).label}`
    // Who, said with its kind unless it is a creature: 「霜甲巨像」, 配方「核心」, 技能「冰刺法杖」.
    const who = owner.kind === "creature" || owner.kind === "entity" ? `「${owner.title}」` : `${label(owner.kind)}「${owner.title}」`
    const ids = new Set(dependencies)
    visit(document, (text, key) => {
      if (assets.has(text) && text !== owner.id) ids.add(text)
      const name = key && IDENTIFIER_KEYS.has(key) ? local(text) : null
      const thing = name ? things.get(name) : undefined
      if (thing && thing.id !== owner.id) addAsset(thing, `${who}${IDENTIFIER_WORDS[key!]}`)
    })
    for (const id of ids) {
      const target = assets.get(id)
      if (target) addAsset(target, `${who}${words(target)}`)
    }
  }
  while (queue.length) {
    const node = nodes.get(queue.shift()!)!
    if (node.kind === "creature") {
      const row = rows.get(node.id.slice(4))!
      reach(node, row, [])
      const model = assets.get(row.id)
      if (model?.module === "model") addAsset(model, `生物「${row.name}」的模型`)
      for (const owner of source.workspace.assets.filter((asset) => asset.document.kind === "entity" && asset.document.model_asset_id === row.id)) addAsset(owner, `生物「${row.name}」的设定`)
      for (const rule of source.workspace.assets.filter((asset) => asset.document.kind === "logic" && asset.document.entity_id === row.id)) addAsset(rule, `生物「${row.name}」的规则`)
      continue
    }
    const asset = assets.get(node.id)!
    const document = asset.document
    if (document.kind === "gameplay") {
      blocked.push(`「${asset.title}」是玩法代码，这一版还不能跨工程导入：代码里写死的名字没法跟着改。先在主工程里重新做这段玩法，或者别带上用它的东西。`)
      continue
    }
    reach(node, GEOMETRY.has(asset.module) ? null : document, asset.dependencies)
    if (document.kind === "model") {
      if (rows.has(asset.id)) addRow(asset.id, `模型「${asset.title}」的生物`)
      for (const part of source.workspace.assets.filter((candidate) => (candidate.module === "animation" || candidate.module === "texture") && candidate.dependencies.includes(asset.id)))
        addAsset(part, `模型「${asset.title}」的${assetKind(part.module).label}`)
    }
    if (document.kind === "entity") addRow(document.model_asset_id, `「${asset.title}」这只生物本身`)
    if (document.kind === "item" || document.kind === "block") {
      const made = `${srcMod}:${document.identifier}`
      for (const recipe of source.workspace.assets.filter((candidate) => candidate.document.kind === "recipe" && candidate.document.result === made)) addAsset(recipe, `做「${asset.title}」的配方`)
      // What the thing is for: a recipe that takes it (a boss's drop made into its weapon) comes along, and with it what that recipe makes.
      for (const recipe of source.workspace.assets.filter((candidate) => candidate.document.kind === "recipe" && candidate.document.result !== made && candidate.document.pattern.includes(made))) addAsset(recipe, `用「${asset.title}」做材料的配方`)
    }
  }

  // ---- the same thing, new ids, new names ----
  const order = [...nodes.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind === "creature" ? "entity" : a.kind) - KIND_ORDER.indexOf(b.kind === "creature" ? "entity" : b.kind))
  const ids = new Map<string, string>()
  const names = new Map<string, string>()
  const mainIds = new Set([...main.workspace.assets.map((asset) => asset.id), ...main.entities.map((entity) => entity.id), ...main.assets.map((asset) => asset.id), ...[...main.blocks, ...main.items, ...main.recipes, ...main.logic].map((value) => value.id), ...main.conception.entries.map((entry) => entry.id)])
  const takenIds = new Set(mainIds)
  // The item registry: blocks and items, and (r29b) books and the main project's spawn eggs, which a book or a creature naming itself may clash with.
  const identifiers = new Set([...[...main.blocks, ...main.items].map((value) => value.identifier), ...main.workspace.assets.flatMap((asset) => (asset.document.kind === "book" ? [bookName({ id: asset.id, document: asset.document })] : [])), ...main.entities.map((entity) => `${creatureName(entity)}_spawn_egg`)])
  const gameNames: Record<string, Set<string>> = Object.fromEntries((["sound", "music", "particle"] as const).map((kind) => [kind, new Set(main.workspace.assets.flatMap((asset) => (asset.document.kind === kind ? [asset.document.name] : [])))]))
  const titles = new Map<string, Set<string>>()
  const titlesOf = (kind: string) =>
    titles.get(kind) ??
    titles.set(kind, new Set(kind === "creature" ? main.entities.map((entity) => entity.name) : [...main.workspace.assets.filter((asset) => asset.module === kind).map((asset) => asset.title), ...(kind === "item" ? main.items : kind === "block" ? main.blocks : []).map((value) => value.name)])).get(kind)!
  const suffix = srcMod.replace(/[^a-z0-9_]/g, "").slice(0, 16) || "imported"
  const newId = (id: string) => {
    if (ids.has(id)) return ids.get(id)!
    const fresh = takenIds.has(id) ? freshId(`${main.id}:${source.id}:${id}`) : id
    takenIds.add(fresh)
    ids.set(id, fresh)
    return fresh
  }
  const rewrite = (value: unknown, own: boolean) =>
    walk(value, null, (text, key) => {
      const id = ids.get(text)
      if (id) return id
      if (text.startsWith(`${srcMod}:`) || text.startsWith(`#${srcMod}:`)) {
        const hash = text.startsWith("#") ? "#" : ""
        const name = text.slice(hash.length + srcMod.length + 1)
        return `${hash}${main.mod_id}:${names.get(name) ?? name}`
      }
      if (key && (IDENTIFIER_KEYS.has(key) || (own && key === "identifier")) && names.has(text)) return names.get(text)!
      return text
    })
  // r29b: a thing that becomes the main project's own is named in the documents brought by the main project's game name.
  const sameName = (document: { kind: string }, own: { kind: string }) => ((from, to) => (from && to ? void names.set(from, to) : undefined))(gameName(document), gameName(own))
  // r29b: what an earlier import from this source brought and the main project still has, of the same kind: brought again, it is written over in place.
  const priorAsset = (asset: WorkspaceAsset) => ((found) => (found ? main.workspace.assets.find((value) => value.id === found.target && value.module === asset.module) : undefined))(sides.earlier?.get(asset.id))
  const priorRow = (id: string) => ((found) => (found ? main.entities.find((value) => value.id === found.target) : undefined))(sides.earlier?.get(id))
  const editedSince = (id: string, updated: string | undefined) => Boolean(updated && sides.earlier?.get(id) && updated > sides.earlier.get(id)!.at)
  // A creature's name is decided first: its setting (the entity asset) is listed and shown under the same name. One brought again keeps the name it has.
  const creatureTitles = new Map(order.filter((node) => node.kind === "creature").map((node) => {
    const row = rows.get(node.id.slice(4))!
    const taken = titlesOf("creature")
    const prior = input.choices?.[row.id] === "rename" ? undefined : priorRow(row.id)
    if (prior) return [row.id, prior.name] as const
    return [row.id, taken.has(row.name) ? freshTitle(row.name, source.name, taken) : (taken.add(row.name), row.name)] as const
  }))
  const items: ImportItem[] = []
  for (const node of order) {
    if (node.kind === "creature") continue
    const asset = assets.get(node.id)!
    if (asset.module === "gameplay") continue
    const same = REUSABLE.has(asset.module)
      ? main.workspace.assets.find((candidate) => candidate.module === asset.module && canonical(candidate.document) === canonical(rewrite(asset.document, false)) && canonical([...candidate.dependencies].sort()) === canonical([...new Set(asset.dependencies.map((id) => ids.get(id) ?? id))].sort()))
      : undefined
    const document = asset.document
    const asked = input.choices?.[asset.id]
    // r29b: brought again from the same source: written over in place, unless the person asks for a copy beside it.
    const prior = asked === "rename" ? undefined : priorAsset(asset)
    if (prior) {
      ids.set(asset.id, prior.id)
      sameName(document, prior.document)
      const reused = asked === "reuse" || (asked === undefined && sides.earlier?.get(asset.id)?.kept === true)
      items.push({ source_id: asset.id, kind: asset.module, title: asset.title, why: node.why, action: reused ? "reuse" : "update", target_id: prior.id, same_as: reused ? { id: prior.id, title: prior.title } : null, renames: [], again: { id: prior.id, title: prior.title, edited: !reused && editedSince(asset.id, prior.updated_at) } })
      continue
    }
    // r29b: the main project's own of the same id or game name, with other content.
    const namesake = same || !NAMESAKES.has(asset.module) ? undefined : main.workspace.assets.find((candidate) => candidate.module === asset.module && (candidate.id === asset.id || (gameName(candidate.document) !== null && gameName(candidate.document) === gameName(document))))
    const differs = namesake ? differences(namesake, rewrite(asset.document, asset.module === "item" || asset.module === "block"), [...new Set(asset.dependencies.map((id) => ids.get(id) ?? id))]) : []
    const choice = asked ?? (input.conflict === "reuse_same" ? "reuse" : "rename")
    if (asked === "reuse" && !same && !namesake) blocked.push(`「${asset.title}」在主工程里没有一样的东西，也没有同编号、同名的，不能选「用主工程里已有的」。`)
    if (asked === "replace" && !namesake) blocked.push(`「${asset.title}」在主工程里没有同编号、同名的东西，不能选「用导入的替换主工程那份」。`)
    const with_ = namesake ? { namesake: { id: namesake.id, title: namesake.title, fields: differs } } : {}
    if (namesake && (choice === "replace" || asked === "reuse")) {
      ids.set(asset.id, namesake.id)
      sameName(document, namesake.document)
      items.push({ source_id: asset.id, kind: asset.module, title: asset.title, why: node.why, action: choice === "replace" ? "replace" : "reuse", target_id: namesake.id, same_as: choice === "replace" ? null : { id: namesake.id, title: namesake.title }, renames: [], ...with_ })
      continue
    }
    if (same && choice === "reuse") {
      ids.set(asset.id, same.id)
      if (document.kind === "item" || document.kind === "block") names.set(document.identifier, document.identifier)
      const item: ImportItem = { source_id: asset.id, kind: asset.module, title: asset.title, why: node.why, action: "reuse", target_id: same.id, same_as: { id: same.id, title: same.title }, renames: [] }
      items.push(item)
      continue
    }
    const renames: ImportRename[] = []
    const target = newId(asset.id)
    if (target !== asset.id) renames.push({ what: "id", from: asset.id, to: target })
    if (document.kind === "item" || document.kind === "block") {
      const identifier = identifiers.has(document.identifier) ? freshName(document.identifier, suffix, identifiers, 64) : (identifiers.add(document.identifier), document.identifier)
      names.set(document.identifier, identifier)
      if (identifier !== document.identifier) renames.push({ what: "identifier", from: document.identifier, to: identifier })
    }
    // r29b: a book that names itself is an item by that name: kept, unless the main project already has an item of that name.
    if (document.kind === "book" && document.identifier) {
      const identifier = identifiers.has(document.identifier) ? freshName(document.identifier, suffix, identifiers, 64) : (identifiers.add(document.identifier), document.identifier)
      if (identifier !== document.identifier) renames.push({ what: "identifier", from: document.identifier, to: identifier })
    }
    if (document.kind === "sound" || document.kind === "music" || document.kind === "particle") {
      const taken = gameNames[document.kind]!
      const name = taken.has(document.name) ? freshName(document.name, suffix, taken, document.kind === "particle" ? 32 : 48) : (taken.add(document.name), document.name)
      if (name !== document.name) renames.push({ what: "name", from: document.name, to: name })
    }
    const taken = titlesOf(asset.module)
    // A creature's setting keeps its own title, and takes the creature's new name only when the creature is renamed.
    const creatureTitle = document.kind === "entity" ? creatureTitles.get(document.model_asset_id) : undefined
    const creatureRow = document.kind === "entity" ? rows.get(document.model_asset_id) : undefined
    const title = document.kind === "entity"
      ? creatureTitle === undefined || creatureTitle === creatureRow?.name ? asset.title : asset.title === creatureRow?.name ? creatureTitle : freshTitle(asset.title, source.name, taken)
      : taken.has(asset.title) ? freshTitle(asset.title, source.name, taken) : (taken.add(asset.title), asset.title)
    if (title !== asset.title) renames.push({ what: "title", from: asset.title, to: title })
    const item: ImportItem = { source_id: asset.id, kind: asset.module, title: asset.title, why: node.why, action: "add", target_id: target, same_as: same ? { id: same.id, title: same.title } : null, renames, ...with_ }
    items.push(item)
  }
  // A creature's own id is its model's: decided with the model above when it has one.
  const registries = new Set(main.entities.map((entity) => creatureName(entity)))
  const creatures = order.filter((node) => node.kind === "creature").map((node) => {
    const row = rows.get(node.id.slice(4))!
    // r29b: a creature an earlier import from this source brought is written over in place, under its id and registry name.
    const prior = input.choices?.[row.id] === "rename" ? undefined : priorRow(row.id)
    if (prior) {
      ids.set(row.id, prior.id)
      return { row, node, target: prior.id, title: prior.name, renames: [] as ImportRename[], identifier: prior.identifier ?? null, prior }
    }
    const target = newId(row.id)
    const title = creatureTitles.get(row.id)!
    // Its registry name (`creatureName`) is kept, unless the main project already registers that very name, and then said. One made of its id is
    // taken only when the id is; r29b: one it names itself (`identifier`) is taken by a creature of the main project of that name, or by an item named as its spawn egg would be.
    const clashes = (name: string) => registries.has(name) || identifiers.has(`${name}_spawn_egg`)
    const identifier = row.identifier ? (clashes(row.identifier) ? freshName(row.identifier, suffix, new Set([...registries, ...[...identifiers].flatMap((name) => (name.endsWith("_spawn_egg") ? [name.slice(0, -"_spawn_egg".length)] : []))]), 64) : row.identifier) : null
    const registry = (id: string, mod: string, own: string | null) => `${mod}:${creatureName({ id, identifier: own })}`
    const renamed = identifier ? identifier !== row.identifier : target !== row.id
    registries.add(creatureName({ id: target, identifier }))
    const renames: ImportRename[] = [
      ...(target !== row.id ? [{ what: "id" as const, from: row.id, to: target }] : []),
      ...(renamed ? [{ what: "registry" as const, from: registry(row.id, srcMod, row.identifier ?? null), to: registry(target, main.mod_id, identifier) }] : []),
      ...(title !== row.name ? [{ what: "title" as const, from: row.name, to: title }] : []),
    ]
    return { row, node, target, title, renames, identifier, prior: undefined }
  })
  items.push(...creatures.map((creature): ImportItem => ({ source_id: creature.row.id, kind: "creature", title: creature.row.name, why: creature.node.why, action: creature.prior ? "update" : "add", target_id: creature.target, same_as: null, renames: creature.renames, ...(creature.prior ? { again: { id: creature.prior.id, title: creature.prior.name, edited: false } } : {}) })))
  const records = creatures.flatMap((creature): { reference: Project["assets"][number]; record: ModelAsset; bytes: Uint8Array; over?: Project["assets"][number] }[] => {
    const reference = source.assets.find((asset) => asset.id === creature.row.model_asset_id)
    if (!reference) return []
    const saved = sides.records.get(reference.id)
    if (!saved) {
      blocked.push(`生物「${creature.row.name}」的模型存档读不到。`)
      return []
    }
    // r29b: brought again, its model is the next version of the one the main project keeps.
    const kept = creature.prior?.model_asset_id ? main.assets.find((value) => value.id === creature.prior!.model_asset_id) : undefined
    if (kept) {
      const record = ModelAssetSchema.parse({ ...saved.record, id: kept.id, entity_id: creature.target, revision: kept.revision + 1 })
      const bytes = new TextEncoder().encode(`${JSON.stringify(record, null, 2)}\n`)
      return [{ reference: { ...reference, id: kept.id, entity_id: creature.target, revision: record.revision, sha256: sha(bytes) }, record, bytes, over: kept }]
    }
    const id = newId(reference.id)
    if (id === reference.id && creature.target === creature.row.id) return [{ reference: { ...reference }, ...saved, over: undefined }]
    const record = ModelAssetSchema.parse({ ...saved.record, id, entity_id: creature.target })
    const bytes = new TextEncoder().encode(`${JSON.stringify(record, null, 2)}\n`)
    return [{ reference: { ...reference, id, entity_id: creature.target, sha256: sha(bytes) }, record, bytes, over: undefined }]
  })

  // ---- the documents, with every reference pointing where it now points ----
  const renamed = (item: ImportItem, what: ImportRename["what"], value: string) => item.renames.find((rename) => rename.what === what)?.to ?? value
  const added = items.filter((item) => item.action === "add" && item.kind !== "creature")
  // r29b: written over in place: the main project's own id, title and game name, the imported content (`overwrite`).
  const placed = items.filter((item) => (item.action === "replace" || item.action === "update") && item.kind !== "creature")
  const workspace = added.map((item) => {
    const asset = assets.get(item.source_id)!
    const own = asset.module === "item" || asset.module === "block"
    const document = rewrite(asset.document, own) as Record<string, unknown>
    const title = renamed(item, "title", asset.title)
    const named = asset.module === "sound" || asset.module === "music" || asset.module === "particle" ? { name: renamed(item, "name", String(document.name)) } : {}
    // An item's or block's name in the game follows its title (so a renamed one shows renamed), unless the source gave it a name of its own (合包, 山𤟤: titled 「山𤟤之筋」, named 「山晖之筋」 because the game lacks 𤟤).
    const shown = own || asset.module === "recipe" ? { name: ownName(asset, title) } : asset.module === "entity" ? { name: creatureTitles.get(String(document.model_asset_id)) ?? String(document.name) } : {}
    // r29b: the registry name decided above, on the creature's setting and on a book (the creature's row takes it below).
    const creature = asset.document.kind === "entity" ? creatures.find((value) => value.row.id === (asset.document as { model_asset_id: string }).model_asset_id) : undefined
    const identifier = creature?.identifier ? { identifier: creature.identifier } : asset.document.kind === "book" && asset.document.identifier ? { identifier: renamed(item, "identifier", asset.document.identifier) } : {}
    return { ...asset, id: item.target_id, title, dependencies: [...new Set(asset.dependencies.map((id) => ids.get(id) ?? id))], document: { ...document, ...named, ...shown, ...identifier } } as WorkspaceAsset
  })
  const overwrite = placed.map((item) => {
    const asset = assets.get(item.source_id)!
    const before = main.workspace.assets.find((value) => value.id === item.target_id)!
    const own = asset.module === "item" || asset.module === "block"
    const document = { ...(rewrite(asset.document, own) as Record<string, unknown>), ...keptName(before.document) }
    const creature = asset.document.kind === "entity" ? creatures.find((value) => value.row.id === (asset.document as { model_asset_id: string }).model_asset_id) : undefined
    return { ...asset, id: before.id, title: before.title, revision: before.revision + 1, created_at: before.created_at, dependencies: [...new Set(asset.dependencies.map((id) => ids.get(id) ?? id))], document: { ...document, ...(own ? { name: ownName(asset, before.title) } : asset.module === "entity" ? { name: creature?.title ?? String(document.name) } : {}), ...(creature?.identifier ? { identifier: creature.identifier } : {}) } } as WorkspaceAsset
  })
  const content = (kind: ModuleKind, from: ImportItem[] = added, among: readonly WorkspaceAsset[] = workspace) =>
    from.filter((item) => item.kind === kind).map((item) => {
      const asset = among.find((value) => value.id === item.target_id)!
      const { kind: _kind, ...fields } = asset.document as Record<string, unknown>
      return { fields: { ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null)), id: item.target_id } }
    })
  const contentOf = {
    blocks: content("block").map((entry) => BlockSchema.parse(entry.fields)),
    items: content("item").map((entry) => ItemSchema.parse(entry.fields)),
    recipes: content("recipe").map((entry) => RecipeSchema.parse(entry.fields)),
    logic: content("logic").map((entry) => LogicSchema.parse(entry.fields)),
  }
  const overContent = {
    blocks: content("block", placed, overwrite).map((entry) => BlockSchema.parse(entry.fields)),
    items: content("item", placed, overwrite).map((entry) => ItemSchema.parse(entry.fields)),
    recipes: content("recipe", placed, overwrite).map((entry) => RecipeSchema.parse(entry.fields)),
    logic: content("logic", placed, overwrite).map((entry) => LogicSchema.parse(entry.fields)),
  }
  const allEntities = creatures.map((creature) => {
    const row = rewrite(creature.row, false) as typeof creature.row
    const record = records.find((value) => value.record.entity_id === creature.target)
    return { ...row, id: creature.target, name: creature.title, ...(creature.identifier ? { identifier: creature.identifier } : {}), model_asset_id: record ? record.reference.id : row.model_asset_id }
  })
  const updatedRows = new Set(creatures.flatMap((creature) => (creature.prior ? [creature.target] : [])))
  const entities = allEntities.filter((entity) => !updatedRows.has(entity.id))
  const overRows = allEntities.filter((entity) => updatedRows.has(entity.id))
  // r29b: a creature brought again writes over its conception entries that the main project still has under the same id.
  const overIds = new Set(main.conception.entries.filter((entry) => entry.entity_id && updatedRows.has(entry.entity_id)).map((entry) => entry.id))
  const allConception = source.conception.entries.filter((entry) => entry.entity_id && creatures.some((creature) => creature.row.id === entry.entity_id)).map((entry) => {
    const moved = rewrite(entry, false) as typeof entry
    const id = overIds.has(entry.id) ? entry.id : takenIds.has(entry.id) && !ids.has(entry.id) ? newId(entry.id) : (ids.get(entry.id) ?? (takenIds.add(entry.id), entry.id))
    const creature = creatures.find((value) => value.row.id === entry.entity_id)!
    return { ...moved, id, title: entry.kind === "entity" ? creature.title : moved.title, model_confirmed_asset_id: entry.model_confirmed_asset_id ? (ids.get(entry.model_confirmed_asset_id) ?? entry.model_confirmed_asset_id) : null }
  })
  const conception = allConception.filter((entry) => !overIds.has(entry.id))
  const overConception = allConception.filter((entry) => overIds.has(entry.id))
  const overModels = records.flatMap((value) => (value.over ? [value.over] : []))
  const placedIds = new Set([...overwrite.map((asset) => asset.id), ...overRows.map((row) => row.id), ...overConception.map((entry) => entry.id), ...overModels.map((value) => value.id), ...Object.values(overContent).flat().map((value) => value.id)])
  const swapIn = <T extends { id: string }>(list: readonly T[], over: readonly T[]) => list.map((value) => over.find((other) => other.id === value.id) ?? value)
  const overwritten: ImportOverwritten = {
    workspace: main.workspace.assets.filter((asset) => placedIds.has(asset.id)),
    entities: main.entities.filter((value) => placedIds.has(value.id)),
    assets: main.assets.filter((value) => placedIds.has(value.id)),
    blocks: main.blocks.filter((value) => placedIds.has(value.id)),
    items: main.items.filter((value) => placedIds.has(value.id)),
    recipes: main.recipes.filter((value) => placedIds.has(value.id)),
    logic: main.logic.filter((value) => placedIds.has(value.id)),
    conception: main.conception.entries.filter((value) => placedIds.has(value.id)),
  }
  const media = [...new Set([...workspace, ...overwrite].flatMap((asset) => mediaHashes(asset.document)))].filter((hash) => !sides.hasMedia(hash))
  const notes: ImportNote[] = []
  // ---- the source's plan entries for what is brought: a creature's tier lives there (`creature-tier.ts`), and the answers to the playability questions ----
  const brought = new Map(items.filter((item) => item.action === "add").map((item) => [item.source_id, item.target_id] as const))
  const plan = source.blueprint
  const chosen = (plan?.entries ?? []).filter((entry) => entry.asset_id && brought.has(entry.asset_id))
  const keys = new Set(main.blueprint?.entries.map((entry) => entry.key) ?? [])
  const keyOf = new Map(chosen.map((entry) => [entry.key, keys.has(entry.key) ? freshName(entry.key, suffix, keys, 64) : (keys.add(entry.key), entry.key)] as const))
  const entries = chosen.map((entry) => ({
    ...entry,
    key: keyOf.get(entry.key)!,
    asset_id: brought.get(entry.asset_id!)!,
    owner: entry.owner && keyOf.has(entry.owner) ? keyOf.get(entry.owner)! : null,
    needs: entry.needs.flatMap((key) => (keyOf.has(key) ? [keyOf.get(key)!] : [])),
    ...(entry.existing ? { existing: undefined } : {}),
  }))
  if (entries.length && main.blueprint && main.blueprint.state !== "confirmed") notes.push({ text: "主工程的蓝图还没确认：带进来的蓝图条目（生物的档位也在里面）要等确认以后才算数。", refs: [] })
  if (entries.length && plan?.state !== "confirmed") notes.push({ text: "源工程的蓝图还没确认，带进来的蓝图条目在主工程里也只是草稿。", refs: [] })
  const blueprint = !entries.length ? main.blueprint
    : main.blueprint ? { ...main.blueprint, entries: [...main.blueprint.entries, ...entries] }
    : { request: `从「${source.name}」导入的东西`, style: plan!.style, entries, questions: [], revision: 1, state: plan!.state }
  const next = {
    ...main,
    ...(blueprint ? { blueprint } : {}),
    entities: [...swapIn(main.entities, overRows), ...entities],
    assets: [...swapIn(main.assets, records.flatMap((value) => (value.over ? [value.reference] : []))), ...records.flatMap((value) => (value.over ? [] : [value.reference]))],
    workspace: { assets: [...swapIn(main.workspace.assets, overwrite), ...workspace] },
    blocks: [...swapIn(main.blocks, overContent.blocks), ...contentOf.blocks],
    items: [...swapIn(main.items, overContent.items), ...contentOf.items],
    recipes: [...swapIn(main.recipes, overContent.recipes), ...contentOf.recipes],
    logic: [...swapIn(main.logic, overContent.logic), ...contentOf.logic],
    conception: { ...main.conception, entries: [...swapIn(main.conception.entries, overConception), ...conception] },
  } as Project

  // ---- what changes on the main project's targets ----
  const sourceTargets = projectTargets(source)
  const mainTargets = projectTargets(main)
  const newTargets = mainTargets.filter((target) => !sourceTargets.includes(target))
  for (const item of items) for (const rename of item.renames) {
    if (rename.what === "registry") notes.push({ text: `「${item.title}」的注册名从 ${rename.from} 改成 ${rename.to}：主工程里已经有这个注册名了。玩家旧存档里的这只会丢。`, refs: [] })
    if (rename.what === "identifier") notes.push({ text: `「${item.title}」的注册名从 ${srcMod}:${rename.from} 改成 ${main.mod_id}:${rename.to}：主工程里已经有 ${main.mod_id}:${rename.from} 了。玩家旧存档里的这样东西会丢。`, refs: [] })
  }
  // r29b: the same id or game name with other content, said with what differs and what each choice does; and what is written over.
  for (const item of items) {
    const words = item.namesake ? `不一样的地方：${item.namesake.fields.join("、") || "依赖"}。` : ""
    if (item.namesake && item.action === "add") notes.push({ text: `「${item.title}」和「${main.name}」里的「${item.namesake.title}」编号或游戏里的名字相同，内容不一样。${words}现在两份都留（导进来的改名另存）；也可以选「用已有的」或「用导入的（替换主工程那份）」。`, refs: [] })
    if (item.namesake && item.action === "reuse") notes.push({ text: `用「${main.name}」的「${item.namesake.title}」，「${source.name}」那份里的不同之处不会带进来。${words}`, refs: [] })
    if (item.namesake && item.action === "replace") notes.push({ text: `用「${source.name}」那份替换「${main.name}」的「${item.namesake.title}」：编号和游戏里的名字不变，用到它的地方照旧指着它，主工程那份里的不同之处会被盖掉。${words}`, refs: [] })
    if (item.again?.edited) notes.push({ text: `「${item.again.title}」上次从「${source.name}」导入以后在「${main.name}」里改过，这次重新导入会用源工程的新版盖掉这些改动。不想盖掉就对它选「两份都留」。`, refs: [] })
  }
  const again = items.filter((item) => item.action === "update")
  if (again.length) notes.push({ text: `「${source.name}」以前导入过：这次带的 ${again.length} 样东西是上次那批，原地换成新版（编号、名字不变，主工程别处对它们的引用照旧），不另存一份。`, refs: [] })
  if (srcMod !== main.mod_id && items.some((item) => item.action === "add")) notes.push({ text: `源工程的 mod_id 是 ${srcMod}，主工程是 ${main.mod_id}：带进来的东西注册名的前缀换成 ${main.mod_id}，后面的部分不变（上面单列的除外）。用源工程那个模组玩出来的旧存档，换成合并后的模组时认不出这些东西。`, refs: [] })
  if (newTargets.length) notes.push({ text: `源工程是做给 ${sourceTargets.join("、")} 的，主工程做给 ${mainTargets.join("、")}。下面按主工程的目标核对过：${newTargets.join("、")} 是源工程没做过的目标。`, refs: [] })
  for (const target of mainTargets) for (const kind of new Set(added.map((item) => item.kind))) {
    const gap = kindGap(kind, target)
    if (gap) notes.push({ text: `${label(kind)}在 ${target} 上还做不进游戏：${gap}`, refs: [] })
  }
  const lacking = new Set(mainTargets.flatMap((target) => { const lacks = lacksOf(targetMinecraft(target)); return [...lacks.particles, ...lacks.sounds] }))
  const swapped = new Map<string, Set<string>>()
  const swap = (value: unknown, owner: string) => walk(value, null, (text, key) => {
    if (!lacking.has(text) || !VANILLA_SWAPS[text] || !key || !["particle", "dust", "sound"].includes(key)) return text
    swapped.set(text, (swapped.get(text) ?? new Set()).add(owner))
    return VANILLA_SWAPS[text]!
  })
  if (lacking.size) {
    next.entities = next.entities.map((entity) => (entities.some((value) => value.id === entity.id) ? (swap(entity, entity.name) as typeof entity) : entity))
    next.workspace = { assets: next.workspace.assets.map((asset) => (workspace.some((value) => value.id === asset.id) && !GEOMETRY.has(asset.module) ? ({ ...asset, document: swap(asset.document, asset.title) } as WorkspaceAsset) : asset)) }
    for (const [from, owners] of swapped) notes.push({ text: `主工程的目标里有 Minecraft ${mainTargets.map(targetMinecraft).filter((version) => lacksOf(version).particles.includes(from) || lacksOf(version).sounds.includes(from)).join("、")}，这个版本没有原版的 ${from}：${[...owners].map((owner) => `「${owner}」`).join("、")}里的 ${from} 已自动换成 ${VANILLA_SWAPS[from]}。`, refs: [] })
  }
  const leftovers = [...entities.map((entity) => JSON.stringify(entity)), ...workspace.filter((asset) => !GEOMETRY.has(asset.module)).map((asset) => JSON.stringify(asset.document))].filter((text) => text.includes(`${srcMod}:`) || text.includes(`"${srcMod}.`))
  if (leftovers.length && srcMod !== main.mod_id) notes.push({ text: `导进来的东西里还有 ${leftovers.length} 处文字写着源工程的 mod_id「${srcMod}」（不是引用，比如说明文字），没有改。`, refs: [] })

  // ---- what is left out ----
  const reached = new Set(items.map((item) => item.source_id))
  const left_out: ImportPlan["left_out"] = source.workspace.assets
    .filter((asset) => !reached.has(asset.id) && asset.document.kind === "gameplay" && asset.dependencies.some((id) => reached.has(id)))
    .map((asset) => ({ id: asset.id, kind: asset.module, title: asset.title, why: "玩法代码不跟着导入：代码里写死的名字没法跟着改。需要的话在主工程里重新做。" }))
  // Plan entries that belong to what is brought but are not brought themselves: not made yet, or made as something this import leaves out (gameplay code, said above).
  const unplanned = (plan?.entries ?? []).filter((entry) => !chosen.includes(entry) && !entry.asset_id && entry.owner && chosen.some((value) => value.key === entry.owner))
  if (unplanned.length) left_out.push({ id: source.id, kind: "blueprint", title: `蓝图里还没做的 ${unplanned.length} 条`, why: `这些是源工程蓝图里归带进来的东西管、但还没做出来的条目（${unplanned.map((entry) => entry.title).slice(0, 6).join("、")}），不跟着带；需要的话在主工程的蓝图里再加。` })

  // ---- the main project's own checks, over the project as it would be ----
  const parsed = ProjectSchema.safeParse(next)
  if (!parsed.success) blocked.push(...[...new Set(parsed.error.issues.map((issue) => issue.message))].map((message) => `合进主工程后检查没过：${message}`))
  if (parsed.success) {
    const contentIssue = (() => {
      try {
        validateContent({ blocks: next.blocks, items: next.items, recipes: next.recipes, logic: next.logic, mod_id: next.mod_id, entities: next.entities })
        return null
      } catch (error) {
        return error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join("；") : String(error)
      }
    })()
    if (contentIssue) blocked.push(`合进主工程后内容检查没过：${contentIssue}`)
    for (const asset of workspace) {
      const document = asset.document
      if (document.kind === "entity") blocked.push(...[...creatureTerrainIssues(next, document), ...creatureLootIssues(next, { ...document, name: document.name }), ...creatureTemptIssues(next, document), ...creatureLairIssues(next, document), ...creatureSummonIssues(next, document)])
    }
    for (const recipe of contentOf.recipes) {
      const clash = recipeClashes(recipe, next.recipes, (reference) => recipeThing({ mod_id: next.mod_id, blocks: next.blocks, items: next.items }, reference)).find((found) => found.stops)
      if (clash) blocked.push(`${clash.text}${clash.fix}`)
    }
  }
  const imported: ImportedIds = {
    workspace: workspace.map((asset) => asset.id),
    entities: entities.map((entity) => entity.id),
    assets: records.flatMap((value) => (value.over ? [] : [value.reference.id])),
    blocks: contentOf.blocks.map((value) => value.id),
    items: contentOf.items.map((value) => value.id),
    recipes: contentOf.recipes.map((value) => value.id),
    logic: contentOf.logic.map((value) => value.id),
    conception: conception.map((entry) => entry.id),
  }
  return {
    plan: {
      source: { id: source.id, name: source.name, mod_id: source.mod_id, revision: source.revision, targets: sourceTargets, sha256: sides.sourceSha256 },
      main: { id: main.id, name: main.name, mod_id: main.mod_id, revision: main.revision, targets: mainTargets },
      items,
      models: records.length,
      media: media.length,
      left_out,
      notes,
      plan_entries: entries.map((entry) => ({ key: entry.key, title: entry.title, from: chosen.find((value) => brought.get(value.asset_id!) === entry.asset_id)!.key })),
      blocked: [...new Set(blocked)],
    },
    next: parsed.success ? parsed.data : next,
    records: records.map((value) => ({ record: value.record, bytes: value.bytes, over: Boolean(value.over) })),
    media,
    imported,
    ids,
    blueprint: { created: !main.blueprint && entries.length > 0, keys: entries.map((entry) => entry.key) },
    overwritten,
  }
}

const fingerprintOf = (plan: Omit<ImportPlan, "fingerprint">) => sha(canonical({ ...plan, notes: plan.notes.map((note) => note.text) }))

async function exists(target: string) {
  return lstat(target).then(() => true, (error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? false : Promise.reject(error)))
}

/** Both projects read from disk: the source only read, its saved creature models loaded and checked against the hashes its manifest keeps. */
export async function readImportSides(sourceDirectory: string, mainDirectory: string): Promise<ImportSides> {
  if (path.resolve(sourceDirectory).toLowerCase() === path.resolve(mainDirectory).toLowerCase()) throw new Error("源工程和主工程是同一个工程。")
  const manifest = await readFile(await storagePath(sourceDirectory, ["minemods.project.json"]))
  const source = await openProject(sourceDirectory)
  const main = await openProject(mainDirectory)
  if (source.id === main.id) throw new Error("源工程和主工程是同一个工程。")
  const records = new Map<string, { record: ModelAsset; bytes: Uint8Array }>()
  for (const reference of source.assets) {
    const bytes = await readFile(await storagePath(sourceDirectory, [".minemods", "assets", reference.id, `${reference.revision}.json`]))
    if (sha(bytes) !== reference.sha256) throw new Error(`源工程的模型存档和清单对不上：${reference.id}`)
    records.set(reference.id, { record: ModelAssetSchema.parse(JSON.parse(new TextDecoder().decode(bytes))), bytes })
  }
  const held = new Set(await readdir(path.join(mainDirectory, ".minemods", "media")).catch(() => [] as string[]))
  // r29b: what earlier imports from this very source brought (newest first, so the newest import's id stands), for this one to write over in place.
  // A copy merged into the main project's own since (`mergeDuplicateAssets`) is that one now, and brought again uses it as it is (`kept`).
  const merged = new Map((await listAssetMerges(mainDirectory)).filter((value) => !value.undone_at).flatMap((value) => value.pairs.map((pair) => [pair.drop, pair.keep] as const)))
  const earlier = new Map<string, { target: string; at: string; kept?: boolean }>()
  for (const record of (await listProjectImports(mainDirectory)).filter((value) => value.source.id === source.id && !value.undone_at))
    for (const item of record.items) if (item.action !== "reuse" && !earlier.has(item.source_id)) earlier.set(item.source_id, merged.has(item.target_id) ? { target: merged.get(item.target_id)!, at: record.at, kept: true } : { target: item.target_id, at: record.at })
  return { source, main, sourceSha256: sha(manifest), records, hasMedia: (hash) => held.has(hash), earlier }
}

async function designsOf(project: Project, read: (entity: Project["entities"][number]) => Promise<unknown>) {
  const designs = new Map<string, z.infer<typeof ModelDesignSchema>>()
  for (const entity of project.entities) {
    if (!entity.model_asset_id) continue
    const parsed = z.object({ design: ModelDesignSchema, blockbench: z.unknown().optional() }).safeParse(await read(entity).catch(() => null))
    if (parsed.success) designs.set(entity.id, compileSavedModel(parsed.data, creatureName(entity)).design)
  }
  return designs
}
function findingsOf(project: Project, designs: Map<string, z.infer<typeof ModelDesignSchema>>): Finding[] {
  try {
    return reconcile(project, { animations: Object.fromEntries([...designs].map(([id, design]) => [id, design.animations.map((clip) => clip.name)])), models: Object.fromEntries(designs) })
  } catch {
    return []
  }
}
const findingKey = (finding: Finding, id: (value: string) => string) => `${finding.rule}|${finding.about ? id(finding.about.id) : ""}|${(finding.refs ?? []).map((ref) => id(String(ref.id))).sort().join(",")}`

/**
 * The main project's own check (机器对账) over the project as it would be, about the things brought, against the same check of the source: what is new
 * there (a target the source was not made for, a name that now points elsewhere) is said, and when it would stop the build the import is refused; what the
 * source already had is said only when it stops a build, so the person knows it came along and was not made by the import.
 */
async function checkNotes(built: Built, sides: ImportSides, mainDirectory: string): Promise<{ notes: ImportNote[]; blocked: string[] }> {
  const next = built.next
  const fresh = new Set([...built.imported.workspace, ...built.imported.entities, ...built.imported.blocks, ...built.imported.items, ...built.imported.recipes, ...built.imported.logic])
  const merged = findingsOf(next, await designsOf(next, async (entity) => {
    const imported = built.records.find((value) => value.record.id === entity.model_asset_id)
    if (imported) return imported.record.data
    const revision = next.assets.find((asset) => asset.id === entity.model_asset_id)?.revision
    return ModelAssetSchema.parse(JSON.parse(await readFile(await storagePath(mainDirectory, [".minemods", "assets", entity.model_asset_id!, `${revision}.json`]), "utf8"))).data
  }))
  const before = new Set(findingsOf(sides.source, await designsOf(sides.source, async (entity) => sides.records.get(entity.model_asset_id!)?.record.data)).map((finding) => findingKey(finding, (value) => built.ids.get(value) ?? value)))
  const about = merged.filter((finding) => (finding.about && fresh.has(finding.about.id)) || (finding.refs ?? []).some((ref) => fresh.has(String(ref.id))))
  const said = (finding: Finding) => `${finding.text}${finding.fix}`
  return {
    blocked: about.filter((finding) => finding.stops && !before.has(findingKey(finding, (value) => value))).map((finding) => `合进主工程以后打包会停：${said(finding)}`),
    notes: about.flatMap((finding) => {
      const old = before.has(findingKey(finding, (value) => value))
      if (old && !finding.stops) return []
      return [{ text: old ? `源工程里本来就有、跟着带过来的问题（主工程打包也会停在这里）：${said(finding)}` : `合进主工程以后检查新提醒的：${said(finding)}`, refs: finding.refs ?? [] }]
    }),
  }
}

/** The list a person confirms: nothing is written. */
export async function previewProjectImport(sourceDirectory: string, mainDirectory: string, input: ProjectImportInput): Promise<ImportPlan> {
  const sides = await readImportSides(sourceDirectory, mainDirectory)
  const built = planProjectImport(sides, input)
  const checked = built.plan.blocked.length ? { notes: [], blocked: [] } : await checkNotes(built, sides, mainDirectory)
  const plan = { ...built.plan, notes: [...built.plan.notes, ...checked.notes], blocked: [...built.plan.blocked, ...checked.blocked] }
  return { ...plan, fingerprint: fingerprintOf(plan) }
}

export const ImportRecordSchema = z.strictObject({
  schema_version: z.literal(1),
  id: z.uuid(),
  at: z.iso.datetime(),
  source: z.strictObject({ id: z.uuid(), name: z.string(), mod_id: z.string(), revision: z.number().int().nonnegative(), sha256: z.string() }),
  revision_before: z.number().int().nonnegative(),
  revision_after: z.number().int().positive(),
  imported: z.strictObject({ workspace: z.array(z.uuid()), entities: z.array(z.uuid()), assets: z.array(z.uuid()), blocks: z.array(z.uuid()), items: z.array(z.uuid()), recipes: z.array(z.uuid()), logic: z.array(z.uuid()), conception: z.array(z.uuid()) }),
  media: z.array(z.string()),
  items: z.array(z.strictObject({ source_id: z.string(), kind: z.string(), title: z.string(), action: z.enum(["add", "reuse", "replace", "update"]), target_id: z.string(), renames: z.array(z.strictObject({ what: z.enum(["id", "identifier", "registry", "name", "title"]), from: z.string(), to: z.string() })) })),
  /**
   * r29b: what of the main project the import wrote over (a namesake replaced, a thing of an earlier import from this source brought again), as it was: the
   * undo puts each back. Absent in records written before.
   */
  overwritten: z.strictObject({ workspace: z.array(z.unknown()), entities: z.array(z.unknown()), assets: z.array(z.unknown()), blocks: z.array(z.unknown()), items: z.array(z.unknown()), recipes: z.array(z.unknown()), logic: z.array(z.unknown()), conception: z.array(z.unknown()) }).optional(),
  /** The plan entries the import added; `created`: the main project had no blueprint before, and undoing removes it again. */
  blueprint: z.strictObject({ created: z.boolean(), keys: z.array(z.string()) }).optional(),
  /**
   * r29d 合包: the next versions of models the main project keeps (a creature brought again), written into their folders: the undo removes these files. Absent in
   * records written before, whose undo left them (`applyProjectImport` then writes over such a file nothing uses).
   */
  versions: z.array(z.strictObject({ id: z.uuid(), revision: z.number().int().positive() })).optional(),
  undone_at: z.iso.datetime().nullable(),
})
export type ImportRecord = z.infer<typeof ImportRecordSchema>
const recordSegments = (id: string) => [".minemods", "imports", `${z.uuid().parse(id)}.json`]

export class ImportRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ImportRefusal"
  }
}

/**
 * Writes the import into the main project, once, under its lock: the media files and saved models it needs, then the project itself (its revision
 * goes up by one), then the record `undoProjectImport` reads. `fingerprint` is the list the person confirmed; when either project changed since, the
 * list differs and nothing is written. The source is read only, and its manifest is checked unchanged at the end.
 */
export async function applyProjectImport(sourceDirectory: string, mainDirectory: string, input: ProjectImportInput & { expectedRevision: number; fingerprint?: string; importId: string }) {
  return withProjectLock(mainDirectory, async () => {
    const sides = await readImportSides(sourceDirectory, mainDirectory)
    if (sides.main.revision !== input.expectedRevision) throw new ImportRefusal(`主工程已经改过了（现在是第 ${sides.main.revision} 版，清单是按第 ${input.expectedRevision} 版做的）。重新看一遍清单再导入。`)
    const built = planProjectImport(sides, input)
    const checked = built.plan.blocked.length ? { notes: [], blocked: [] } : await checkNotes(built, sides, mainDirectory)
    const unsigned = { ...built.plan, notes: [...built.plan.notes, ...checked.notes], blocked: [...built.plan.blocked, ...checked.blocked] }
    const plan: ImportPlan = { ...unsigned, fingerprint: fingerprintOf(unsigned) }
    if (plan.blocked.length) throw new ImportRefusal(`这样导入不了：${plan.blocked.join("；")}`)
    if (input.fingerprint && input.fingerprint !== plan.fingerprint) throw new ImportRefusal("清单和你确认的那一份不一样了（源工程或主工程在这期间改过）。重新看一遍清单再导入。")
    const written: string[] = []
    const media: string[] = []
    try {
      for (const hash of built.media) {
        const bytes = await readMedia(sourceDirectory, hash)
        if (!(await exists(path.join(mainDirectory, ...mediaPath(hash).split("/"))))) media.push(hash)
        await storeMedia(mainDirectory, bytes)
      }
      for (const value of built.records) {
        const segments = [".minemods", "assets", value.record.id, `${value.record.revision}.json`]
        const target = await storagePath(mainDirectory, segments, true)
        // r29d 合包: the next version of a model the main project keeps (`over`: one past the version it uses) is a file nothing uses, so one already there is
        // what an undone import left (records written before r29d did not say to remove it): written over. Anywhere else a file already there is refused.
        const orphan = value.over
        if (!orphan && (await exists(target))) throw new Error(`主工程里已经有这个模型存档：${value.record.id}`)
        written.push(value.over ? target : path.dirname(target))
        // The source's own bytes when nothing in the record changed, else the record as `writeRecord` writes it: either way the hash the manifest keeps.
        await writeFile(target, value.bytes, { flag: orphan ? "w" : "wx" })
      }
      const saved = await saveProjectUnlocked(mainDirectory, built.next, sides.main.revision)
      const record: ImportRecord = {
        schema_version: 1,
        id: input.importId,
        at: new Date().toISOString(),
        source: { id: plan.source.id, name: plan.source.name, mod_id: plan.source.mod_id, revision: plan.source.revision, sha256: plan.source.sha256 },
        revision_before: sides.main.revision,
        revision_after: saved.revision,
        imported: built.imported,
        media,
        items: plan.items.map((item) => ({ source_id: item.source_id, kind: item.kind, title: item.title, action: item.action, target_id: item.target_id, renames: item.renames })),
        blueprint: built.blueprint,
        ...(Object.values(built.overwritten).some((list) => list.length) ? { overwritten: built.overwritten } : {}),
        ...(built.records.some((value) => value.over) ? { versions: built.records.filter((value) => value.over).map((value) => ({ id: value.record.id, revision: value.record.revision })) } : {}),
        undone_at: null,
      }
      await writeRecord(mainDirectory, recordSegments(record.id), record)
      const after = sha(await readFile(await storagePath(sourceDirectory, ["minemods.project.json"])))
      if (after !== plan.source.sha256) throw new Error("源工程在导入期间被别的程序改过了：导入已写进主工程，可以撤销。")
      return { plan, project: saved, record }
    } catch (error) {
      const current = await openProject(mainDirectory).catch(() => null)
      if (current?.revision === sides.main.revision) {
        await Promise.all(written.map((directory) => rm(directory, { recursive: true, force: true })))
        await Promise.all(media.map(async (hash) => rm(await storagePath(mainDirectory, mediaPath(hash).split("/")), { force: true })))
      }
      throw error
    }
  })
}

/** The imports written into a project, newest first. */
export async function listProjectImports(mainDirectory: string) {
  const folder = path.join(mainDirectory, ".minemods", "imports")
  const names = (await readdir(folder).catch(() => [] as string[])).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name))
  const records = await Promise.all(names.map(async (name) => ImportRecordSchema.safeParse(JSON.parse(await readFile(path.join(folder, name), "utf8"))).data ?? null))
  return records.filter((record) => record !== null).sort((a, b) => b.at.localeCompare(a.at))
}

/**
 * Takes an import back out: everything it added leaves the project (one more save, revision up by one), and the saved models and media files it
 * added are removed when nothing else holds them. Refused while something made since uses what was imported: the person changes that first.
 */
export async function undoProjectImport(mainDirectory: string, importId: string, expectedRevision: number) {
  return withProjectLock(mainDirectory, async () => {
    const record = ImportRecordSchema.parse(JSON.parse(await readFile(await storagePath(mainDirectory, recordSegments(importId)), "utf8")))
    if (record.undone_at) throw new ImportRefusal("这次导入已经撤销过了。")
    const project = await openProject(mainDirectory)
    if (project.revision !== expectedRevision) throw new ImportRefusal(`主工程已经改过了（现在是第 ${project.revision} 版）。刷新以后再撤销。`)
    const gone = new Set(Object.values(record.imported).flat())
    const users = project.workspace.assets.filter((asset) => !gone.has(asset.id) && asset.dependencies.some((id) => gone.has(id))).map((asset) => asset.title)
    if (users.length) throw new ImportRefusal(`还不能撤销，以下内容在用导进来的东西：${[...new Set(users)].join("、")}。`)
    // r29b: and what it wrote over is put back as it was.
    const over = record.overwritten
    const keep = <T extends { id: string }>(list: readonly T[], back: readonly unknown[] = []) => list.filter((value) => !gone.has(value.id)).map((value) => (back as T[]).find((old) => old.id === value.id) ?? value)
    const next = {
      ...project,
      entities: keep(project.entities, over?.entities),
      assets: keep(project.assets, over?.assets),
      workspace: { assets: keep(project.workspace.assets, over?.workspace) },
      blocks: keep(project.blocks, over?.blocks),
      items: keep(project.items, over?.items),
      recipes: keep(project.recipes, over?.recipes),
      logic: keep(project.logic, over?.logic),
      conception: { ...project.conception, entries: keep(project.conception.entries, over?.conception) },
      blueprint: !project.blueprint || record.blueprint?.created ? undefined : { ...project.blueprint, entries: project.blueprint.entries.filter((entry) => !record.blueprint?.keys.includes(entry.key)) },
    }
    const parsed = ProjectSchema.safeParse(next)
    if (!parsed.success) throw new ImportRefusal(`还不能撤销：去掉导进来的东西以后，${[...new Set(parsed.error.issues.map((issue) => issue.message))].join("；")}`)
    try {
      validateContent({ blocks: next.blocks, items: next.items, recipes: next.recipes, logic: next.logic, mod_id: next.mod_id, entities: next.entities })
    } catch (error) {
      throw new ImportRefusal(`还不能撤销：去掉导进来的东西以后，${error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join("；") : String(error)}`)
    }
    const saved = await saveProjectUnlocked(mainDirectory, parsed.data, project.revision)
    for (const id of record.imported.assets) {
      // r29b: the folder by a file in it: `storagePath` refuses a folder as its last segment, so the folder was never found and stayed (the same creature could then not be brought again).
      const folder = await storagePath(mainDirectory, [".minemods", "assets", id, "-"]).then(path.dirname, () => null)
      if (folder) await rm(folder, { recursive: true, force: true })
    }
    // r29d 合包: and the next versions it wrote into models the main project keeps, now back at the version they had (left, the same creature could not be brought again).
    for (const version of record.versions ?? []) {
      const kept = saved.assets.find((value) => value.id === version.id)
      if (kept && kept.revision >= version.revision) continue
      await rm(await storagePath(mainDirectory, [".minemods", "assets", version.id, `${version.revision}.json`]), { force: true }).catch(() => undefined)
    }
    const held = new Set(mediaHashes(saved.workspace))
    for (const hash of record.media.filter((value) => !held.has(value))) await rm(await storagePath(mainDirectory, mediaPath(hash).split("/")), { force: true }).catch(() => undefined)
    await writeRecord(mainDirectory, recordSegments(importId), { ...record, undone_at: new Date().toISOString() })
    return { project: saved, record }
  })
}

/**
 * What a person can pick in a project to bring into another: each creature once (by its setting, or the creature itself when an older project has no setting),
 * and every other thing by itself. A creature's model and motions, and gameplay code, are not offered: the first come with their creature, the second cannot be brought.
 */
export function importableThings(project: Project) {
  const owners = new Map(project.workspace.assets.flatMap((asset) => (asset.document.kind === "entity" ? [[asset.document.model_asset_id, asset] as const] : [])))
  // A creature is offered by its creature document; one that has only a model is offered as that model.
  const creatures = project.entities.flatMap((entity) => (owners.has(entity.id) ? [{ id: owners.get(entity.id)!.id, kind: "creature" as const, title: entity.name }] : []))
  const partOfCreature = (asset: WorkspaceAsset) => asset.module === "entity" || (asset.module === "model" && owners.has(asset.id)) || ((asset.module === "animation" || asset.module === "texture") && asset.dependencies.some((id) => owners.has(id)))
  const held = new Set(project.workspace.assets.map((asset) => asset.id))
  const things = project.workspace.assets.filter((asset) => !partOfCreature(asset) && asset.module !== "gameplay").map((asset) => ({ id: asset.id, kind: asset.module as ModuleKind | "creature", title: asset.title }))
  const loose = [...project.blocks.map((value) => ({ id: value.id, kind: "block" as const, title: value.name })), ...project.items.map((value) => ({ id: value.id, kind: "item" as const, title: value.name })), ...project.recipes.map((value) => ({ id: value.id, kind: "recipe" as const, title: value.name }))].filter((value) => !held.has(value.id))
  return [...creatures, ...things, ...loose]
}

// ---- r29b: 合并以前导入留下的重复件 ----

/** One thing an earlier import brought as a renamed copy of what the main project already had (`chiyou_dust` and `chiyou_dust_<source>`): the copy goes, the original stays. */
export type DuplicatePair = { kind: ModuleKind; keep: { id: string; title: string; name: string | null }; drop: { id: string; title: string; name: string | null }; from: string; fields: string[] }

export const AssetMergeRecordSchema = z.strictObject({
  schema_version: z.literal(1),
  id: z.uuid(),
  at: z.iso.datetime(),
  pairs: z.array(z.strictObject({ kind: z.string(), keep: z.uuid(), drop: z.uuid() })),
  revision_before: z.number().int().nonnegative(),
  revision_after: z.number().int().positive(),
  /** The project as it was before: the undo writes it back (as the next revision) while nothing was saved since. */
  before: z.unknown(),
  undone_at: z.iso.datetime().nullable(),
})
export type AssetMergeRecord = z.infer<typeof AssetMergeRecordSchema>
const mergeSegments = (id: string) => [".minemods", "merges", `${z.uuid().parse(id)}.json`]

/** The merges written into a project, newest first. */
export async function listAssetMerges(mainDirectory: string) {
  const folder = path.join(mainDirectory, ".minemods", "merges")
  const names = (await readdir(folder).catch(() => [] as string[])).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name))
  const records = await Promise.all(names.map(async (name) => AssetMergeRecordSchema.safeParse(JSON.parse(await readFile(path.join(folder, name), "utf8"))).data ?? null))
  return records.filter((record) => record !== null).sort((a, b) => b.at.localeCompare(a.at))
}

/**
 * The renamed copies earlier imports (not undone) left in the project beside the thing they were renamed away from: the import's own record says which name it
 * had in its source, and the project still has a thing of that kind by that name (its game name, or its title for a kind the game names by id). Creatures,
 * their settings and models are not offered: two creatures are two registered things a world may hold.
 */
export function duplicateAssets(project: Project, records: readonly ImportRecord[]): DuplicatePair[] {
  const byId = new Map(project.workspace.assets.map((asset) => [asset.id, asset]))
  const found = new Map<string, DuplicatePair>()
  for (const record of records.filter((value) => !value.undone_at)) for (const item of record.items) {
    const drop = byId.get(item.target_id)
    if (item.action !== "add" || !drop || !NAMESAKES.has(drop.module) || found.has(drop.id)) continue
    const rename = item.renames.find((value) => value.what === "name" || value.what === "identifier") ?? (gameName(drop.document) === null ? item.renames.find((value) => value.what === "title") : undefined)
    if (!rename) continue
    const keep = project.workspace.assets.find((asset) => asset.id !== drop.id && asset.module === drop.module && (rename.what === "title" ? asset.title === rename.from : gameName(asset.document) === rename.from))
    if (!keep || found.has(keep.id)) continue
    found.set(drop.id, { kind: drop.module, keep: { id: keep.id, title: keep.title, name: gameName(keep.document) }, drop: { id: drop.id, title: drop.title, name: gameName(drop.document) }, from: record.source.name, fields: differences(keep, drop.document, drop.dependencies) })
  }
  return [...found.values()]
}

/** The project with each pair's copy taken out and everything that named it (by id, by `<mod id>:<name>`, or by identifier) naming the one kept instead. */
export function mergedProject(project: Project, pairs: readonly DuplicatePair[]): Project {
  const ids = new Map(pairs.map((pair) => [pair.drop.id, pair.keep.id]))
  const names = new Map(pairs.flatMap((pair) => (pair.drop.name && pair.keep.name ? [[pair.drop.name, pair.keep.name] as const] : [])))
  const identifiers = new Set(pairs.flatMap((pair) => ((pair.kind === "item" || pair.kind === "block") && pair.drop.name ? [pair.drop.name] : [])))
  const mod = project.mod_id
  const kept = { ...project, workspace: { assets: project.workspace.assets.filter((asset) => !ids.has(asset.id)) }, blocks: project.blocks.filter((value) => !ids.has(value.id)), items: project.items.filter((value) => !ids.has(value.id)), recipes: project.recipes.filter((value) => !ids.has(value.id)), logic: project.logic.filter((value) => !ids.has(value.id)) }
  const moved = walk(kept, null, (text, key) => {
    const id = ids.get(text)
    if (id) return id
    const hash = text.startsWith("#") ? "#" : ""
    const named = text.startsWith(`${hash}${mod}:`) ? names.get(text.slice(hash.length + mod.length + 1)) : undefined
    if (named) return `${hash}${mod}:${named}`
    if (key && IDENTIFIER_KEYS.has(key) && identifiers.has(text)) return names.get(text)!
    return text
  }) as Project
  const blueprint = moved.blueprint && mergedBlueprint(moved.blueprint, project.blueprint?.entries ?? [], pairs)
  return { ...moved, ...(blueprint ? { blueprint } : {}), workspace: { assets: moved.workspace.assets.map((asset) => ({ ...asset, dependencies: [...new Set(asset.dependencies)] })) } }
}

/**
 * r29c (r29b recheck): the plan entries of the merged copies, whose `asset_id` already names the one kept (`mergedProject`'s walk), keep the key the import renamed them to
 * (`chiyou_dust_shanhai_chiyou_s`). An entry that the kept one has already is that entry: the copy's goes, and whatever named its key names the kept one's. Otherwise the
 * copy's entry takes the kept one's game name as its key, when that is a key and no other entry has it. `before`: the entries as they were before the walk, to tell whose they were.
 */
function mergedBlueprint(blueprint: NonNullable<Project["blueprint"]>, before: NonNullable<Project["blueprint"]>["entries"], pairs: readonly DuplicatePair[]) {
  const used = new Set(blueprint.entries.map((entry) => entry.key))
  const keys = new Map<string, string>()
  for (const pair of pairs) for (const entry of before.filter((value) => value.asset_id === pair.drop.id)) {
    const kept = before.find((value) => value.asset_id === pair.keep.id)?.key
    const named = pair.keep.name && /^[a-z][a-z0-9_]{0,63}$/.test(pair.keep.name) && !used.has(pair.keep.name) ? pair.keep.name : undefined
    const key = kept ?? named
    if (!key) continue
    keys.set(entry.key, key)
    used.add(key)
  }
  if (!keys.size) return blueprint
  const rekey = (key: string) => keys.get(key) ?? key
  const merged = new Set<string>()
  const entries = blueprint.entries.flatMap((entry) => {
    const key = rekey(entry.key)
    if (merged.has(key) || (key !== entry.key && blueprint.entries.some((other) => other.key === key))) return []
    merged.add(key)
    return [{ ...entry, key, owner: entry.owner === null ? null : rekey(entry.owner), needs: [...new Set(entry.needs.map(rekey))].filter((need) => need !== key) }]
  })
  return { ...blueprint, entries }
}

/**
 * Merges the chosen copies (each must still be one `duplicateAssets` offers), once, under the project's lock, and keeps a record that `undoAssetMerge` reads.
 * Nothing is deleted from disk: the copies leave the project file only.
 */
export async function mergeDuplicateAssets(mainDirectory: string, input: { drops: readonly string[]; expectedRevision: number; mergeId: string }) {
  return withProjectLock(mainDirectory, async () => {
    const project = await openProject(mainDirectory)
    if (project.revision !== input.expectedRevision) throw new ImportRefusal(`工程已经改过了（现在是第 ${project.revision} 版）。重新列一遍重复件再合并。`)
    const offered = duplicateAssets(project, await listProjectImports(mainDirectory))
    const missing = input.drops.filter((id) => !offered.some((pair) => pair.drop.id === id))
    if (missing.length) throw new ImportRefusal(`这些不在可以合并的重复件里：${missing.join("、")}。重新列一遍再选。`)
    const chosen = offered.filter((pair) => input.drops.includes(pair.drop.id))
    if (!chosen.length) throw new ImportRefusal("没有选要合并的重复件。")
    const parsed = ProjectSchema.safeParse(mergedProject(project, chosen))
    if (!parsed.success) throw new ImportRefusal(`合并以后检查没过：${[...new Set(parsed.error.issues.map((issue) => issue.message))].join("；")}`)
    const saved = await saveProjectUnlocked(mainDirectory, parsed.data, project.revision)
    const record: AssetMergeRecord = { schema_version: 1, id: input.mergeId, at: new Date().toISOString(), pairs: chosen.map((pair) => ({ kind: pair.kind, keep: pair.keep.id, drop: pair.drop.id })), revision_before: project.revision, revision_after: saved.revision, before: project, undone_at: null }
    await writeRecord(mainDirectory, mergeSegments(record.id), record)
    return { project: saved, record, pairs: chosen }
  })
}

/** Takes a merge back: the project as it was before, as its next revision. Refused once anything was saved since (the person would lose that). */
export async function undoAssetMerge(mainDirectory: string, mergeId: string, expectedRevision: number) {
  return withProjectLock(mainDirectory, async () => {
    const record = AssetMergeRecordSchema.parse(JSON.parse(await readFile(await storagePath(mainDirectory, mergeSegments(mergeId)), "utf8")))
    if (record.undone_at) throw new ImportRefusal("这次合并已经撤销过了。")
    const project = await openProject(mainDirectory)
    if (project.revision !== expectedRevision) throw new ImportRefusal(`工程已经改过了（现在是第 ${project.revision} 版）。刷新以后再撤销。`)
    if (project.revision !== record.revision_after) throw new ImportRefusal("合并以后工程又改过了，撤销会把那些改动一起丢掉，所以不撤。要撤就先把后来的改动撤掉。")
    const before = ProjectSchema.parse(record.before)
    const saved = await saveProjectUnlocked(mainDirectory, { ...before, revision: project.revision }, project.revision)
    await writeRecord(mainDirectory, mergeSegments(mergeId), { ...record, undone_at: new Date().toISOString() })
    return { project: saved, record }
  })
}
