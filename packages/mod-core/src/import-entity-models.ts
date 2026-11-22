import { randomUUID } from "node:crypto"
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { openImportClassProvider } from "./import-asset-graph"
import { getImportAssetRoot, getImportedAssetCatalog } from "./import-assets"
import { assertNoReverseSymlink } from "./reverse-archive"
import { decodeRgbaPng } from "./png-decode"
import {
  parseDescriptor,
  parseInstruction,
  readClassCode,
  readJavaModels,
  readLayerModel,
  type ClassCode,
  type JavaModelGeometry,
  type JavaModelResult,
  type MethodCode,
} from "./imported-java-model"

/**
 * Works out, for every creature a mod adds, what it looks like: which model and which texture.
 *
 * Nothing here depends on one mod's coding style or on a particular mod loader:
 *  - the list of creatures comes from the mod's data (language files, drop tables, spawn eggs);
 *  - the link from a creature to its renderer is read from the registration code by shape
 *    ("an entity field, then a reference to a constructor, then a call") rather than by API name;
 *  - models are rebuilt from bytecode (see imported-java-model.ts) or taken from model files;
 *  - when registration code cannot be followed, class and file names are matched to the creature's id.
 */

export type EntityModelEntry = {
  /** "namespace:id" */
  entity: string
  kind: "java" | "asset" | "none"
  geometry?: JavaModelGeometry
  /** Catalog asset id of a model file (GeckoLib and similar). */
  modelAssetId?: string
  /** Catalog asset id of the texture, or a path inside the game's own files. */
  texture?: { assetId: string } | { game: string }
  /** How the model was tied to the creature: followed through code, or matched by name. */
  via?: "registration" | "name" | "files"
  source?: string
  partial: boolean
  diagnostics: string[]
  /** A living thing with drops or a spawn egg, as opposed to arrows, bolts and other helper entities. */
  creature: boolean
  /** Drawn by a renderer for things that are not alive (arrows, bolts, thrown blocks), and has no drops or spawn egg. */
  helper?: boolean
  /** How the game draws the surface: blended see-through, and how solid (1 = fully). Absent for ordinary cut-out skins. */
  look?: { blend: boolean; opacity: number }
}

/** Render-type factories that blend the skin with what is behind it, under Mojang, Forge and Fabric names. */
const blended = new Set([
  "entityTranslucent",
  "entityTranslucentCull",
  "entityTranslucentEmissive",
  "itemEntityTranslucentCull",
  "m_110473_",
  "getEntityTranslucent",
  "getEntityTranslucentCull",
  "getItemEntityTranslucentCull",
  "method_23580",
])

export type EntityAsset = { id: string; resourcePath: string; kind: string; format: string }
export type ClassSource = { paths: string[]; readFile: (path: string) => Promise<Uint8Array> }
/** The game's own files, when a copy is on this computer. */
export type GameSource = {
  classPaths: string[]
  hasClass: (path: string) => boolean
  has: (path: string) => boolean
  readFile: (path: string) => Promise<Uint8Array>
}

const idPart = /^[a-z0-9_.-]+$/
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "")
const simple = (internal: string) => internal.slice(internal.lastIndexOf("/") + 1)
const outer = (internal: string) => simple(internal).split("$")[0]!

/** Every creature id the mod's data mentions. */
export function findEntityIds(assets: EntityAsset[], languages: Map<string, string>) {
  const ids = new Set<string>()
  const add = (namespace: string, id: string) => {
    if (namespace !== "minecraft" && idPart.test(namespace) && idPart.test(id) && !id.includes(".")) ids.add(`${namespace}:${id}`)
  }
  for (const [path, content] of languages) {
    const namespace = path.match(/^assets\/([^/]+)\/lang\//)?.[1] ?? ""
    if (path.endsWith(".json")) {
      let keys: string[] = []
      try {
        keys = Object.keys(JSON.parse(content) as Record<string, unknown>)
      } catch {
        // A malformed language file only costs the names it would have given.
      }
      for (const key of keys) {
        const match = key.match(/^entity\.([^.]+)\.([^.]+)$/)
        if (match) add(match[1]!, match[2]!)
      }
    } else
      for (const line of content.split(/\r?\n/)) {
        // 1.12 and earlier: entity.<Name>.name=… or entity.<modid>.<name>.name=…
        const match = line.match(/^entity\.([\w.:-]+)\.name\s*=/)
        if (match) add(namespace, match[1]!.split(/[.:]/).at(-1)!.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase())
      }
  }
  const named = new Set(ids)
  for (const asset of assets) {
    const egg = asset.resourcePath.match(/^assets\/([^/]+)\/models\/item\/([^/]+)_spawn_egg\.json$/)
    if (egg) {
      add(egg[1]!, egg[2]!)
      named.add(`${egg[1]}:${egg[2]}`)
    }
  }
  for (const asset of assets) {
    const loot = asset.resourcePath.match(/^data\/([^/]+)\/loot_tables?\/entities\/([^/]+)\.json$/)
    if (!loot) continue
    // "troll_forest" next to a creature called "troll" is that creature's drop table for one variant, not another creature.
    const variant = [...named].some((known) => `${loot[1]}:${loot[2]}`.startsWith(`${known}_`))
    if (!variant) add(loot[1]!, loot[2]!)
  }
  return [...ids].sort()
}

type Target = { owner: string; name: string; descriptor: string }
/** A layer built by a whole method, or by the first `upTo` instructions of one (the value then on the stack). */
/** `maker` is the class whose method builds the shape: usually the model class that also poses it. */
type LayerSource = Target & { upTo?: number; maker?: string }
type Scope = { classes: Set<string>; methods: Target[] }

const handleTarget = (argument: string | undefined): Target | null => {
  const match = argument?.match(/^handle#\d+ (.+)\.([^.:]+):(.+)$/)
  return match ? { owner: match[1]!, name: match[2]!, descriptor: match[3]! } : null
}
const bootstrapTarget = (code: ClassCode, comment: string) => {
  const index = Number(comment.match(/^bootstrap#(\d+)/)?.[1])
  const entry = code.bootstraps.find((candidate) => candidate.index === index)
  return entry?.arguments.map(handleTarget).find((target) => target) ?? null
}
const objectType = (type: string) => (type.startsWith("L") && type.endsWith(";") ? type.slice(1, -1) : null)

/** Loads classes on demand from the mod, then from the game's files; keeps what it parsed. */
function createClassStore(classes: ClassSource | null, game: GameSource | null) {
  const parsed = new Map<string, ClassCode | null>()
  const modPaths = new Set(classes?.paths ?? [])
  const missing = new Set<string>()
  const load = async (name: string) => {
    if (parsed.has(name)) return parsed.get(name) ?? null
    const path = `${name}.class`
    const bytes = modPaths.has(path)
      ? await classes!.readFile(path).catch(() => null)
      : game?.hasClass(path)
        ? await game.readFile(path).catch(() => null)
        : null
    let code: ClassCode | null = null
    try {
      code = bytes ? readClassCode(bytes) : null
    } catch {
      // An unreadable class is treated as absent.
    }
    parsed.set(name, code)
    return code
  }
  return {
    load,
    isMod: (name: string) => modPaths.has(`${name}.class`),
    /** Synchronous view for the interpreter; remembers what it could not find so it can be fetched and retried. */
    lookup: (name: string) => {
      if (parsed.has(name)) return parsed.get(name) ?? null
      missing.add(name)
      return null
    },
    /** Load what the last run asked for. Returns true when something new arrived. */
    async settle() {
      const wanted = [...missing]
      missing.clear()
      const before = parsed.size
      const loaded = await Promise.all(wanted.map(load))
      return parsed.size > before && loaded.some((code) => code)
    },
    all: () => [...parsed.values()].filter((code): code is ClassCode => !!code),
  }
}

type Store = ReturnType<typeof createClassStore>

/** Run a bytecode reading step again while it keeps discovering classes it needs from the game's files. */
async function withClasses<T>(store: Store, read: () => T) {
  let result = read()
  for (let round = 0; round < 8 && (await store.settle()); round++) result = read()
  return result
}

/**
 * "This layer key is built by that method": `register(KEY, Model::createLayer)` in a mod, or
 * `map.put(KEY, Model.createLayer())` in the game's own table. Keys are static fields.
 */
function scanLayerRegistry(codes: ClassCode[]) {
  const registry = new Map<string, LayerSource>()
  for (const code of codes)
    for (const method of code.methods) {
      const lines = method.instructions.map(parseInstruction)
      lines.forEach((line, index) => {
        if (line.op !== "getstatic" || !line.member || !objectType(line.member.descriptor)) return
        const key = `${line.member.owner}.${line.member.name}`
        const next = lines[index + 1]
        if (!next || registry.has(key)) return
        if (next.op === "invokedynamic") {
          // register(KEY, Model::createLayer)
          const target = bootstrapTarget(code, next.comment)
          const call = lines[index + 2]
          if (!target || target.name === "<init>" || !call?.member || !/^invoke/.test(call.op)) return
          if (parseDescriptor(call.member.descriptor).args.length !== 2) return
          if (objectType(parseDescriptor(target.descriptor).returns)) registry.set(key, { ...target, maker: target.owner })
          return
        }
        // map.put(KEY, value): the value is a local computed earlier, or one static call with constant arguments.
        // Either way it is whatever sits on top of the stack when the call happens, so replay up to there.
        const span = /^aload/.test(next.op)
          ? 1
          : 1 + lines.slice(index + 1, index + 6).findIndex((item) => item.op === "invokestatic" && item.member)
        if (span < 1) return
        if (!lines.slice(index + 1, index + span).every((item) => /const|push|ldc|getstatic/.test(item.op))) return
        const call = lines[index + 1 + span]
        if (!call?.member || !/^invoke/.test(call.op) || parseDescriptor(call.member.descriptor).args.length !== 2) return
        // Who built the value: the static call right there, or the one whose result was kept in that local.
        const bare = (position: number) => method.instructions[position]!.replace(/^\d+: /, "")
        let maker = lines[index + span]?.op === "invokestatic" ? lines[index + span]!.member?.owner : undefined
        if (/^aload/.test(next.op)) {
          const stored = bare(index + 1).replace(/^aload/, "astore")
          for (let back = index; back > 0; back--)
            if (bare(back) === stored) {
              if (lines[back - 1]?.op === "invokestatic") maker = lines[back - 1]!.member?.owner
              break
            }
        }
        registry.set(key, { owner: code.name, name: method.name, descriptor: method.descriptor, upTo: index + 1 + span, ...(maker ? { maker } : {}) })
      })
    }
  return registry
}

/** Static fields that stand for a creature: the field is assigned right after the creature's id is mentioned. */
function scanEntityFields(codes: ClassCode[], ids: string[]) {
  const byPath = new Map<string, string[]>()
  ids.forEach((id) => {
    const path = id.split(":")[1]!
    byPath.set(path, [...(byPath.get(path) ?? []), id])
    byPath.set(id, [id])
  })
  const namespaces = new Set(ids.map((id) => id.split(":")[0]!))
  const fields = new Map<string, string>()
  const assign = (code: ClassCode, literals: string[], key: string) => {
    for (const literal of [...literals].reverse()) {
      const matches = byPath.get(literal)
      if (!matches) continue
      // An id shared by several namespaces goes to the one this class's package or strings point at.
      const chosen =
        matches.length === 1
          ? matches[0]!
          : (matches.find((id) => code.name.includes(id.split(":")[0]!) || code.strings.includes(id.split(":")[0]!)) ?? matches[0]!)
      if (!fields.has(key)) fields.set(key, chosen)
      return
    }
  }
  // Two passes so a field holding a name constant can be followed into the field holding the creature.
  for (let pass = 0; pass < 2; pass++)
    for (const code of codes) {
      if (!code.strings.some((value) => byPath.has(value)) && pass === 0 && !code.strings.some((value) => namespaces.has(value))) continue
      for (const method of code.methods) {
        let literals: string[] = []
        for (const text of method.instructions) {
          if (text.includes(" ldc")) {
            const line = parseInstruction(text)
            if (/^ldc/.test(line.op)) literals.push(line.comment)
          } else if (text.includes("getstatic") && pass === 1) {
            const member = parseInstruction(text).member
            const known = member && fields.get(`${member.owner}.${member.name}`)
            if (known) literals.push(known)
          } else if (text.includes("putstatic")) {
            const member = parseInstruction(text).member
            if (member) assign(code, literals, `${member.owner}.${member.name}`)
            literals = []
          }
        }
      }
    }
  return fields
}

/** For each creature, the code that draws it: renderer classes and the lambdas that create them. */
function scanRendererLinks(codes: ClassCode[], fields: Map<string, string>) {
  const scopes = new Map<string, Scope>()
  const scope = (entity: string) => {
    let value = scopes.get(entity)
    if (!value) scopes.set(entity, (value = { classes: new Set(), methods: [] }))
    return value
  }
  for (const code of codes) {
    if (!code.bootstraps.length) continue
    for (const method of code.methods) {
      const lines = method.instructions.map(parseInstruction)
      lines.forEach((line, index) => {
        if (line.op !== "getstatic" || !line.member) return
        const entity = fields.get(`${line.member.owner}.${line.member.name}`)
        if (!entity) return
        for (const next of lines.slice(index + 1, index + 7)) {
          if (next.op === "getstatic" && next.member && fields.has(`${next.member.owner}.${next.member.name}`)) return
          if (next.op !== "invokedynamic") continue
          const target = bootstrapTarget(code, next.comment)
          if (!target) return
          if (target.name === "<init>") scope(entity).classes.add(target.owner)
          else scope(entity).methods.push(target)
          return
        }
      })
    }
  }
  return scopes
}

/** Words in a texture's file name that mark it as something drawn over the base skin. */
const accessories = new Set(
  "eyes eye glow glowing overlay emissive armor armour saddle bridle tack reins sleeping asleep blink egg breath horn mouth empty charge charged layer shield banner collar wool fur held item chest harness hidden".split(
    " ",
  ),
)
/** Words in a model file's name that mark the plain standing pose. */
const standing = new Set("ground base idle default stand standing normal".split(" "))
const affixes = /^(render(er)?|model|entity|geo|layer|new|legacy|mob)+|(render(er)?|model|entity|geo|layer|mob)+$/g
/** Classes named after a creature, e.g. MossGolemRenderer or ModelMossGolem for "moss_golem". */
function scanByName(paths: string[], ids: string[]) {
  const wanted = new Map(ids.map((id) => [normalize(id.split(":")[1]!), id]))
  const found = new Map<string, string[]>()
  for (const path of paths) {
    const name = outer(path.slice(0, -".class".length))
    if (!/render|model/i.test(name)) continue
    let core = name.toLowerCase()
    for (let previous = ""; previous !== core; ) {
      previous = core
      core = core.replace(affixes, "")
    }
    const entity = wanted.get(normalize(core))
    if (entity) found.set(entity, [...(found.get(entity) ?? []), path.slice(0, -".class".length)])
  }
  return found
}

type Candidate = { model: JavaModelResult; priority: number }

const pngSize = (bytes: Uint8Array | null | undefined) => {
  if (!bytes || bytes.length < 24) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getUint32(0) === 0x89504e47 ? ([view.getUint32(16), view.getUint32(20)] as const) : null
}

type Skin = { width: number; height: number; pixels: Uint8Array }
const readSkin = (bytes: Uint8Array | null | undefined): Skin | null => {
  try {
    return bytes && bytes.length <= 16 * 1024 * 1024 ? decodeRgbaPng(bytes) : null
  } catch {
    return null
  }
}
/**
 * How well a skin and a shape belong together, from 0 to 1: the shape's faces should land on painted
 * pixels, and the painted pixels should be ones the shape uses. A skin drawn for another shape leaves
 * holes on this one; a small shape laid over a big creature's skin leaves most of the paint unused.
 * This is what tells apart the shapes a mod keeps for one creature (old and new, young and grown).
 */
export function skinCoverage(geometry: JavaModelGeometry, skin: Skin) {
  const { description, bones } = geometry["minecraft:geometry"][0]!
  const width = Math.round(description.texture_width)
  const height = Math.round(description.texture_height)
  if (width < 1 || height < 1 || width * height > 4_000_000) return 0
  const scaleX = skin.width / width
  const scaleY = skin.height / height
  // One cell per texture unit: is any paint there, and does the shape use it.
  const used = new Uint8Array(width * height)
  const rect = (u: number, v: number, w: number, h: number) => {
    for (let y = Math.max(0, Math.floor(v)); y < Math.min(height, Math.ceil(v + h)); y++)
      for (let x = Math.max(0, Math.floor(u)); x < Math.min(width, Math.ceil(u + w)); x++) used[y * width + x] = 1
  }
  for (const bone of bones)
    for (const cube of bone.cubes) {
      const [w, h, d] = cube.size.map((side) => (side < 0.5 ? 0 : side)) as [number, number, number]
      const [u, v] = cube.uv
      rect(u + d, v, w, d)
      rect(u + d + w, v, w, d)
      rect(u, v + d, d, h)
      rect(u + d, v + d, w, h)
      rect(u + d + w, v + d, d, h)
      rect(u + d + w + d, v + d, w, h)
    }
  let both = 0
  let usedCells = 0
  let paintedCells = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const px = Math.min(skin.width - 1, Math.floor((x + 0.5) * scaleX))
      const py = Math.min(skin.height - 1, Math.floor((y + 0.5) * scaleY))
      const painted = skin.pixels[(py * skin.width + px) * 4 + 3]! > 0
      const inUse = used[y * width + x] === 1
      if (painted) paintedCells++
      if (inUse) usedCells++
      if (painted && inUse) both++
    }
  if (!both) return 0
  const covered = both / usedCells
  const spent = both / paintedCells
  return (2 * covered * spent) / (covered + spent)
}

export async function buildEntityModels(input: {
  assets: EntityAsset[]
  readAsset: (assetId: string) => Promise<Uint8Array>
  classes: ClassSource | null
  game?: GameSource | null
  /** Creatures known from elsewhere, e.g. the relationship graph. */
  extraIds?: string[]
}): Promise<EntityModelEntry[]> {
  const decoder = new TextDecoder()
  const languages = new Map<string, string>()
  for (const asset of input.assets)
    if (/^assets\/[^/]+\/lang\/(en_us\.json|zh_cn\.json|en_us\.lang|en_US\.lang)$/.test(asset.resourcePath))
      languages.set(asset.resourcePath, decoder.decode(await input.readAsset(asset.id).catch(() => new Uint8Array())))
  const found = [...new Set([...findEntityIds(input.assets, languages), ...(input.extraIds ?? [])])].sort()
  if (!found.length) return []

  const store = createClassStore(input.classes, input.game ?? null)
  const modClasses = (input.classes?.paths ?? []).filter((path) => path.endsWith(".class")).slice(0, 60_000)
  for (const path of modClasses) await store.load(path.slice(0, -".class".length))
  const codes = store.all()

  const registry = scanLayerRegistry(codes)
  const allFields = scanEntityFields(codes, found)
  // A drop table with no name, no spawn egg and no registration behind it is a reward list, not a creature.
  const backed = new Set<string>(allFields.values())
  for (const [file, content] of languages) {
    const namespace = file.match(/^assets\/([^/]+)\/lang\//)?.[1] ?? ""
    for (const match of content.matchAll(/entity\.([a-z0-9_.-]+)\.([a-z0-9_-]+)"/g)) backed.add(`${match[1]}:${match[2]}`)
    for (const match of content.matchAll(/^entity\.([\w.:-]+)\.name\s*=/gm))
      backed.add(`${namespace}:${match[1]!.split(/[.:]/).at(-1)!.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}`)
  }
  for (const asset of input.assets) {
    const egg = asset.resourcePath.match(/^assets\/([^/]+)\/models\/item\/([^/]+)_spawn_egg\.json$/)
    if (egg) backed.add(`${egg[1]}:${egg[2]}`)
  }
  ;(input.extraIds ?? []).forEach((id) => backed.add(id))
  const ids = allFields.size ? found.filter((id) => backed.has(id)) : found
  const fields = new Map([...allFields].filter(([, id]) => ids.includes(id)))
  const scopes = scanRendererLinks(codes, fields)
  const named = scanByName(modClasses, ids)
  // The game keeps its key→layer table next to the class that holds the keys. Which class that is cannot be
  // known by name (it differs between Forge and Fabric), so each folder a key-like field comes from is read once.
  const gameRegistries = new Map<string, Map<string, LayerSource>>()
  const loadGameRegistry = async (keyOwner: string, keyType: string | undefined) => {
    if (!input.game) return null
    const folder = keyOwner.slice(0, keyOwner.lastIndexOf("/") + 1)
    // A key is its own kind of object, declared beside the class that lists the keys; constants of a class's own type are not keys.
    if (!keyType || keyType === keyOwner || !keyType.startsWith(folder) || keyType.slice(folder.length).includes("/")) return null
    const known = gameRegistries.get(folder)
    if (known) return known
    const near = input.game.classPaths.filter((path) => path.startsWith(folder) && !path.slice(folder.length).includes("/")).slice(0, 600)
    const loaded: ClassCode[] = []
    for (const path of near) {
      const code = await store.load(path.slice(0, -".class".length))
      if (code) loaded.push(code)
    }
    const registry = scanLayerRegistry(loaded)
    gameRegistries.set(folder, registry)
    return registry
  }

  const creatures = new Set<string>()
  for (const asset of input.assets) {
    const match =
      asset.resourcePath.match(/^data\/([^/]+)\/loot_tables?\/entities\/([^/]+)\.json$/) ??
      asset.resourcePath.match(/^assets\/([^/]+)\/models\/item\/([^/]+)_spawn_egg\.json$/) ??
      asset.resourcePath.match(/^assets\/([^/]+)\/models\/item\/spawn_egg_([^/]+)\.json$/)
    if (match) creatures.add(`${match[1]}:${match[2]}`)
  }
  const textures = input.assets.filter((asset) => asset.kind === "texture" && asset.format === "png")
  const modelFiles = input.assets.filter((asset) => /\.(geo\.json|tbl)$/i.test(asset.resourcePath))
  const entries: EntityModelEntry[] = []

  for (const entity of ids) {
    const [namespace = "", id = ""] = entity.split(":")
    const linked = scopes.get(entity)
    const byName = named.get(entity) ?? []
    const via: EntityModelEntry["via"] = linked ? "registration" : byName.length ? "name" : "files"
    // Everything that takes part in drawing this creature: renderers, their parents, the lambdas that build them.
    const scopeClasses = new Set<string>(linked ? linked.classes : byName)
    const scopeMethods = [...(linked?.methods ?? [])]
    const texts: ClassCode[] = []
    const instructions: string[] = []
    /** Classes the registration itself creates, as opposed to ones its renderer keeps for other occasions. */
    const direct = new Set<string>()
    const visit = async (name: string, depth: number) => {
      const code = await store.load(name)
      if (!code || texts.includes(code) || depth > 6) return
      texts.push(code)
      code.methods.forEach((method) => instructions.push(...method.instructions))
      if (code.superclass && !/^java\//.test(code.superclass)) await visit(code.superclass, depth + 1)
    }
    for (const method of scopeMethods) {
      const owner = await store.load(method.owner)
      const body = owner?.methods.find((entry) => entry.name === method.name && entry.descriptor === method.descriptor)
      if (!body) continue
      instructions.push(...body.instructions)
      for (const text of body.instructions)
        if (text.includes(" new ")) {
          const created = parseInstruction(text).comment
          direct.add(created)
          if (store.isMod(created) || input.game?.hasClass(`${created}.class`)) scopeClasses.add(created)
        }
    }
    for (const name of [...scopeClasses]) await visit(name, 0)

    const candidates: Candidate[] = []
    const resourceNames: string[] = []
    const seenTargets = new Set<string>()
    const consider = async (target: LayerSource, priority: number, wrapperName?: string) => {
      const key = `${target.owner}.${target.name}${target.descriptor}#${target.upTo ?? ""}`
      if (seenTargets.has(key)) return
      seenTargets.add(key)
      const owner = await store.load(target.owner)
      const whole = owner?.methods.find((entry) => entry.name === target.name && entry.descriptor === target.descriptor)
      if (!owner || !whole) return
      const method: MethodCode =
        target.upTo === undefined
          ? whole
          : {
              name: `${whole.name}#${target.upTo}`,
              descriptor: `${whole.descriptor.slice(0, whole.descriptor.indexOf(")") + 1)}Ljava/lang/Object;`,
              access: whole.access,
              instructions: [...whole.instructions.slice(0, target.upTo), "999999: areturn"],
              truncated: false,
            }
      // The class wrapped around the shape poses it; when its code cannot be read only its name is known.
      // Of the class being created around the shape and the class that built it, the first that has posing code is used.
      let wrapperCode: ClassCode | null = null
      for (const name of [wrapperName, target.maker]) {
        if (!name) continue
        for (let code = await store.load(name), depth = 0; code && depth < 12 && !wrapperCode; depth++) {
          if (code.methods.some((entry) => /^\(L[^;]+;F{5}\)V$|^\(F{6}L[^;]+;\)V$/.test(entry.descriptor) && entry.instructions.length > 1)) wrapperCode = await store.load(name)
          code = code.superclass ? await store.load(code.superclass) : null
        }
        if (wrapperCode) break
      }
      const wrapper = wrapperCode ? { code: wrapperCode } : wrapperName ? { name: wrapperName } : undefined
      const model = await withClasses(store, () => readLayerModel(owner, method, store.lookup, undefined, wrapper))
      if (model) candidates.push({ model, priority })
    }
    const considerClass = async (name: string, priority: number) => {
      const code = await store.load(name)
      if (!code) return
      resourceNames.push(...code.strings)
      const models = await withClasses(store, () => readJavaModels(code, store.lookup))
      models.forEach((model) => candidates.push({ model, priority }))
    }
    // `new Model(context.bakeLayer(KEY))`: the class being created when a layer key is fetched is the one wrapped around it.
    const creating: string[] = []
    for (const text of instructions) {
      if (text.includes("getstatic")) {
        const member = parseInstruction(text).member
        if (!member) continue
        const key = `${member.owner}.${member.name}`
        const target =
          registry.get(key) ??
          (!store.isMod(member.owner) ? (await loadGameRegistry(member.owner, objectType(member.descriptor) ?? undefined))?.get(key) : undefined)
        if (target) await consider(target, 3, creating.at(-1))
      } else if (text.includes(" new ")) {
        const created = parseInstruction(text).comment
        creating.push(created)
        if (store.isMod(created) && created !== "java/lang/Object") await considerClass(created, direct.has(created) ? 2.6 : 2)
      } else if (text.includes("invokespecial") && text.includes("<init>")) {
        const made = parseInstruction(text).member?.owner
        const index = made ? creating.lastIndexOf(made) : -1
        if (index >= 0) creating.length = index
      } else if (text.includes(" ldc")) resourceNames.push(parseInstruction(text).comment)
    }
    // The game's renderer this one builds on says whether the thing is alive; unreadable names say nothing.
    const ancestors = texts.map((code) => code.superclass).filter((name): name is string => !!name && !store.isMod(name) && /Renderer/.test(simple(name)))
    const helper = ancestors.length > 0 && !ancestors.some((name) => /Mob|Living|Humanoid|Biped|Ageable/.test(simple(name))) && !creatures.has(entity)
    // Drawn blended when the renderer picks a see-through render type for the creature itself.
    // Only the mod's own choice counts: the game's base renderer mentions every way of drawing.
    const blend = texts.some((code) =>
      store.isMod(code.name) &&
      code.methods.some((method) => {
        const returned = objectType(parseDescriptor(method.descriptor).returns)
        return (
          !!returned &&
          method.instructions.some((text) => {
            if (!text.includes("invokestatic")) return false
            const member = parseInstruction(text).member
            return member?.owner === returned && blended.has(member.name)
          })
        )
      }),
    )
    texts.forEach((code) => resourceNames.push(...code.strings))
    for (const name of byName) await considerClass(name, 1)
    // A mod may ship two shapes for one creature (FooModel and NewFooModel) and choose by installed textures.
    for (const candidate of [...candidates]) {
      const owner = candidate.model.source.slice(0, candidate.model.source.lastIndexOf("."))
      const base = outer(owner).replace(/^(New|Legacy)/, "")
      const siblings = new Set([base, `New${base}`, `Legacy${base}`])
      for (const path of modClasses)
        if (siblings.has(simple(path.slice(0, -".class".length))) && path.slice(0, -".class".length) !== owner)
          await considerClass(path.slice(0, -".class".length), candidate.priority - 0.5)
    }

    // Stems that files of this creature tend to start with: its id and the names of its model classes.
    const stems = [
      normalize(id),
      ...candidates.map((candidate) => {
        let core = outer(candidate.model.source.slice(0, candidate.model.source.lastIndexOf("."))).toLowerCase()
        for (let previous = ""; previous !== core; ) {
          previous = core
          core = core.replace(affixes, "")
        }
        return normalize(core)
      }),
    ].filter((stem, index, all) => stem.length >= 4 && all.indexOf(stem) === index)
    // Texture: the one the code names; else one called after the creature, or kept in a folder called after it.
    // Overlays and accessories (eyes, armour, saddles…) are drawn on top of the base skin and never chosen first.
    const idWords = id.split("_")
    const namedFiles = resourceNames
      .filter((value) => /^[\w./:-]+\.png$/i.test(value))
      .map((value) => value.split(":").at(-1)!.replace(/^\/+/, ""))
    let texture: EntityModelEntry["texture"]
    let textureBytes: Uint8Array | null = null
    const scored = textures
      .map((asset) => {
        const file = asset.resourcePath
        const base = file.slice(file.lastIndexOf("/") + 1, -4)
        const folder = normalize(file.split("/").at(-2) ?? "")
        const flat = normalize(base)
        const named = namedFiles.reduce((most, name) => (file.endsWith(`/${name}`) ? Math.max(most, name.includes("/") ? 6 : 5) : most), 0)
        // Banner and shield pattern folders hold flag artwork named after creatures, not their skins.
        const inPlace = /\/textures\/(model|entity|mob)s?\//.test(file) && !/\/(banner|shield)s?\//.test(file)
        // Screens, inventory pictures and block faces are never a creature's skin, whatever the code calls them.
        if (/\/textures\/(gui|items?|blocks?|particles?|painting|font|environment|mob_effect)\//.test(file)) return null
        const words = base.toLowerCase().split(/[_\-.]/)
        const called = !inPlace
          ? 0
          : flat === stems[0]
            ? 3
            : stems.some((stem) => flat.startsWith(stem))
              ? 1.5
              : idWords.length > 1 && idWords.every((word) => words.includes(word))
                ? 1.4 // "myrmex_desert_worker" for the creature "myrmex_worker"
                : 0
        const housed =
          inPlace && stems.some((stem) => folder === stem || folder.startsWith(stem) || (folder.length >= 4 && stem.startsWith(folder)))
            ? 1.2
            : 0
        if (!named && !called && !housed) return null
        const accessory = words.some((word) => accessories.has(word)) ? 7 : 0
        return {
          asset,
          named: named > 0,
          called: called > 0,
          score: named + called + housed - accessory + (file.startsWith(`assets/${namespace}/`) ? 0.5 : 0) - base.length / 2000,
        }
      })
      .filter((entry) => entry !== null)
      .sort((first, second) => second.score - first.score || first.asset.resourcePath.localeCompare(second.asset.resourcePath))
    let chosenTexture = scored[0]
    // The name is only a hint. When there is a shape to hold the likely skins against, the skin that was
    // painted for one of the shapes wins over one that merely has the better name.
    const skins = new Map<string, Skin | null>()
    if (candidates.length && scored.length > 1) {
      const fit = async (entry: (typeof scored)[number]) => {
        const painted = readSkin(await input.readAsset(entry.asset.id).catch(() => null))
        skins.set(entry.asset.id, painted)
        return painted ? Math.max(...candidates.map((candidate) => skinCoverage(candidate.model.geometry, painted))) : null
      }
      // A skin known only by its folder says nothing about which of the folder's skins it is:
      // the one painted for the shape the registration itself creates is taken.
      if (!scored[0]!.named && !scored[0]!.called) {
        const top = Math.max(...candidates.map((candidate) => candidate.priority))
        const leading = candidates.filter((candidate) => candidate.priority === top)
        let most = 0
        for (const entry of scored.filter((one) => one.score > 0 && !one.named && !one.called).slice(0, 16)) {
          const painted = readSkin(await input.readAsset(entry.asset.id).catch(() => null))
          skins.set(entry.asset.id, painted)
          if (!painted) continue
          const value = Math.max(...leading.map((candidate) => skinCoverage(candidate.model.geometry, painted)))
          if (value > most + 0.02) {
            most = value
            chosenTexture = entry
          }
        }
      }
      const first = await fit(chosenTexture!)
      // Only a skin that plainly was not painted for any of the shapes is given up.
      if (first !== null && first < 0.35) {
        let most = first + 0.3
        for (const entry of scored.filter((one) => one.score > 0 && one !== chosenTexture).slice(0, 8)) {
          const other = await fit(entry)
          if (other !== null && other > most) {
            most = other
            chosenTexture = entry
          }
        }
      }
    }
    const guessed = !!chosenTexture && !chosenTexture.named
    if (chosenTexture) {
      texture = { assetId: chosenTexture.asset.id }
      textureBytes = await input.readAsset(chosenTexture.asset.id).catch(() => null)
    } else if (input.game) {
      const path = namedFiles.map((name) => `assets/minecraft/${name}`).find((candidate) => input.game!.has(candidate))
      if (path) {
        texture = { game: path }
        textureBytes = await input.game.readFile(path).catch(() => null)
      }
    }
    const size = pngSize(textureBytes)
    const skin = candidates.length > 1 ? ((chosenTexture && skins.get(chosenTexture.asset.id)) ?? readSkin(textureBytes)) : null
    const fits = (model: JavaModelResult) => {
      const description = model.geometry["minecraft:geometry"][0]!.description
      return !!size && description.texture_width / description.texture_height === size[0] / size[1]
    }
    // Among several shapes for one creature, the one this skin was painted for wins.
    const rank = (candidate: Candidate) =>
      (fits(candidate.model) ? 8 : 0) +
      (skin ? skinCoverage(candidate.model.geometry, skin) * 12 : 0) +
      candidate.priority +
      (candidate.model.partial ? 0 : 2) +
      Math.min(candidate.model.cubeCount, 999) / 1000
    const best = candidates.sort((first, second) => rank(second) - rank(first))[0]
    if (best) {
      entries.push({
        entity,
        kind: "java",
        geometry: best.model.geometry,
        ...(texture ? { texture } : {}),
        via,
        source: best.model.source,
        partial: best.model.partial,
        diagnostics: [...best.model.diagnostics, ...(guessed ? ["贴图是按文件名匹配的，游戏里可能会用同一组里的另一张。"] : [])],
        creature: creatures.has(entity),
        ...(helper ? { helper } : {}),
        ...(blend ? { look: { blend, opacity: Math.round((best.model.opacity ?? 1) * 100) / 100 } } : {}),
      })
      continue
    }

    // Model files (GeckoLib, Tabula and similar): named by the code, else the file called after the creature.
    // A creature with one file per pose is shown standing.
    const fragments = resourceNames.filter((value) => value.length >= 6 && /^[\w./:-]+$/.test(value) && /[/_]/.test(value))
    const geo = modelFiles
      .map((asset) => {
        const file = asset.resourcePath
        const base = file.slice(file.lastIndexOf("/") + 1).replace(/\.(geo\.json|tbl)$/i, "")
        const flat = normalize(base)
        const named = fragments.some((value) => file.includes(value.split(":").at(-1)!.replace(/\.(geo\.json|tbl)$/i, "")) && value.includes(base)) ? 3 : 0
        const called = flat === stems[0] ? 3 : stems.some((stem) => flat.startsWith(stem)) ? 1.5 : 0
        if (!named && !called) return null
        const words = base.toLowerCase().split(/[_\-.]/)
        const pose = words.some((word) => standing.has(word)) ? 1 : 0
        return { asset, named: named > 0, score: named + called + pose + (file.startsWith(`assets/${namespace}/`) ? 0.5 : 0) - base.length / 2000 }
      })
      .filter((entry) => entry !== null)
      .sort((first, second) => second.score - first.score || first.asset.resourcePath.localeCompare(second.asset.resourcePath))[0]
    if (geo) {
      entries.push({
        entity,
        kind: "asset",
        modelAssetId: geo.asset.id,
        ...(texture ? { texture } : {}),
        via: geo.named ? via : "files",
        source: geo.asset.resourcePath,
        partial: false,
        diagnostics: guessed ? ["贴图是按文件名匹配的，游戏里可能会用同一组里的另一张。"] : [],
        creature: creatures.has(entity),
        ...(helper ? { helper } : {}),
      })
      continue
    }
    entries.push({
      entity,
      kind: "none",
      ...(texture ? { texture } : {}),
      partial: false,
      creature: creatures.has(entity),
      ...(helper ? { helper } : {}),
      diagnostics: [
        !input.classes
          ? "没有可以读取的模组代码。"
          : !linked && !byName.length
            ? "没有找到绘制这个生物的代码。"
            : input.game
              ? "这个生物的模型不是用可读取的方式定义的。"
              : "这个生物用的是原版游戏里的模型，这台电脑上没有找到原版游戏文件。",
      ],
    })
  }
  return entries
}

// ---------------------------------------------------------------- saved result

const indexVersion = 19
export type EntityModelIndex = {
  schemaVersion: 1
  analysisVersion: number
  /** Changes when the unpacked content changes. */
  stamp: string
  /** Whether the game's own files were available; a later run with them can fill in more creatures. */
  withGame: boolean
  entities: EntityModelEntry[]
}
const indexFile = (root: string) => path.join(root, "entity-models.json")
const catalogStamp = (catalog: { sourceSha256: string; createdAt: string; assets: unknown[] }) =>
  `${catalog.sourceSha256}:${catalog.createdAt}:${catalog.assets.length}`

/** The saved creature models for a project, built on first use and whenever the unpacked content changes. */
export async function loadImportEntityModels(input: {
  workspaceDirectory: string
  id: string
  /** Opens the game's files when a copy exists on this computer. Called only when a build is needed. */
  openGame?: () => Promise<(GameSource & { dispose?: () => void }) | null>
  hasGame?: boolean
}): Promise<EntityModelIndex> {
  const root = await getImportAssetRoot(input)
  const catalog = await getImportedAssetCatalog(input)
  if (!catalog) throw new Error("Imported asset catalog does not exist")
  const stamp = catalogStamp(catalog)
  await assertNoReverseSymlink(root, "entity-models.json", true)
  const info = await lstat(indexFile(root)).catch((error: NodeJS.ErrnoException) =>
    error.code === "ENOENT" ? undefined : Promise.reject(error),
  )
  if (info?.isFile() && !info.isSymbolicLink() && info.size <= 64 * 1024 * 1024) {
    try {
      const stored = JSON.parse(await readFile(indexFile(root), "utf8")) as EntityModelIndex
      const current = stored.schemaVersion === 1 && stored.analysisVersion === indexVersion && stored.stamp === stamp
      if (current && Array.isArray(stored.entities) && (stored.withGame || !input.hasGame)) return stored
    } catch {
      // An unreadable saved result is simply rebuilt.
    }
  }
  const { reader, provider, dispose } = await openImportClassProvider(input)
  const game = (await input.openGame?.().catch(() => null)) ?? null
  try {
    const entities = await buildEntityModels({
      assets: catalog.assets,
      readAsset: reader.readBytes,
      classes: provider,
      game,
    })
    const index: EntityModelIndex = { schemaVersion: 1, analysisVersion: indexVersion, stamp, withGame: !!game, entities }
    const temporary = `${indexFile(root)}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(index), { flag: "wx", mode: 0o600 })
    await rename(temporary, indexFile(root)).catch(async (error) => {
      await rm(temporary, { force: true })
      throw error
    })
    return index
  } finally {
    game?.dispose?.()
    await dispose()
  }
}
