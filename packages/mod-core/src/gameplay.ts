import { contentName } from "./asset-name"
import { z } from "zod"
import { typeIn } from "./play-words"
import { creatureName } from "./registry-name"

/**
 * Gameplay as an asset: one self-contained unit of behaviour, written by an AI as Java, kept apart in its
 * own package and governed like every other asset. This file is what a gameplay asset holds and how it is
 * laid out in a mod; what the code may touch is in `gameplay-scan.ts`, what it may point at in
 * `gameplay-references.ts`. No Node APIs: the app's window reads it too.
 */

/**
 * `sources`/`data`: files one gameplay may hold. `*_bytes`: the largest single file, as UTF-8.
 * `total_bytes`: everything one gameplay holds together. `rounds`: versions one task may have checked
 * before the best one is handed to the person as it is.
 */
export const GAMEPLAY_LIMITS = { sources: 24, source_bytes: 48 * 1024, data: 32, data_bytes: 64 * 1024, total_bytes: 384 * 1024, lang: 128, uses: 32, behaviours: 24, not_doing: 16, depth: 4, rounds: 8 } as const

/** The names the generated support code has. A gameplay reads the project through these and nothing else of Studio's. */
export const GAMEPLAY_API = { package: "api", content: "ProjectContent", entry: "GameplayEntry", ability: "AbilityAction", abilityMethod: "abilityAction", motionMethod: "playMotion", actor: "StudioActor", client_entry: "GameplayClientEntry", boot: "GameplayBoot", client_boot: "GameplayClientBoot", main: "Main.java", client_main: "client/ClientMain.java", platform: "ProjectPlatform", client_platform: "ProjectClient" } as const

const JAVA_WORDS = new Set(
  "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record sealed permits yield".split(" "),
)
const Line = (max: number) => z.string().trim().min(1).max(max)
const bytes = (text: string) => new TextEncoder().encode(text).length
// Tab, line feed and carriage return are the only control characters a text file needs; anything else is not text.
const plain = (text: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)

/** The last part of the gameplay's package and the name of its folder: lower case, not a Java word, not Studio's own. */
export const GameplaySlugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,31}$/)
  .refine((slug) => !JAVA_WORDS.has(slug) && slug !== GAMEPLAY_API.package && slug !== "client", "Slug is a reserved word")

const segments = (path: string) => path.split("/")
const JavaPath = z
  .string()
  .max(160)
  .regex(/^(?:[a-z][a-z0-9_]*\/)*[A-Z][A-Za-z0-9]*\.java$/)
  .refine((path) => segments(path).length <= GAMEPLAY_LIMITS.depth && segments(path).slice(0, -1).every((part) => !JAVA_WORDS.has(part)), "Java file is nested too deep or sits in a folder named like a Java word")
const DataPath = z
  .string()
  .max(200)
  .regex(/^data\/[a-z0-9_.-]+\/(?:[a-z0-9_.-]+\/)+[a-z0-9_.-]+\.json$/)
  .refine((path) => !segments(path).some((part) => part.startsWith(".")), "Data path has a hidden or relative segment")
const text = (limit: number) => z.string().min(1).refine(plain, "File is not plain text").refine((content) => bytes(content) <= limit, `File is larger than ${limit} bytes`)
const Translations = z.record(z.string().regex(/^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/).max(160), Line(400))

/** One thing the gameplay does, in the words a person can test it by. Free prose; nothing to pick from. */
export const GameplayBehaviourSchema = z.strictObject({
  /** What sets it off. */
  when: Line(300),
  /** What then happens, with the real numbers: how much, how far, how long. */
  does: Line(600),
  /** What the player sees and hears when it does. */
  shows: Line(400),
})

const described = {
  slug: GameplaySlugSchema,
  /** What a player would call it. */
  name: Line(120),
  /** What this gameplay is, in a sentence or two. */
  summary: Line(400),
  behaviours: z.array(GameplayBehaviourSchema).min(1).max(GAMEPLAY_LIMITS.behaviours),
  /** What somebody might expect of it that it does not do. */
  not_doing: z.array(Line(300)).max(GAMEPLAY_LIMITS.not_doing),
  /** Asset ids of this project's things it attaches to or uses: items, blocks, creatures, cast actions, other gameplay. */
  uses: z.array(z.uuid()).max(GAMEPLAY_LIMITS.uses).refine((ids) => new Set(ids).size === ids.length, "A thing is listed twice"),
}

/** What is written before any code: the description a person later tests against, and what it attaches to. */
export const GameplaySheetSchema = z.strictObject(described)
export type GameplaySheet = z.infer<typeof GameplaySheetSchema>

const code = {
  /** Java files, each by its path inside the gameplay's own package. */
  sources: z.array(z.strictObject({ path: JavaPath, content: text(GAMEPLAY_LIMITS.source_bytes) })).min(1).max(GAMEPLAY_LIMITS.sources),
  /** JSON data files by their path in the mod, starting with `data/`. */
  data: z.array(z.strictObject({ path: DataPath, content: text(GAMEPLAY_LIMITS.data_bytes) })).max(GAMEPLAY_LIMITS.data),
  /** Every text the gameplay shows, in both languages. */
  lang: z.strictObject({ zh_cn: Translations, en_us: Translations }),
}
type Code = { sources: { path: string; content: string }[]; data: { path: string; content: string }[]; lang: { zh_cn: Record<string, string>; en_us: Record<string, string> } }

function structure(document: Code, context: z.RefinementCtx) {
  const paths = [...document.sources, ...document.data].map((file) => file.path.toLowerCase())
  // Windows and macOS fold case: two paths that differ only by case are one file there.
  paths.forEach((path, index) => {
    if (paths.indexOf(path) !== index) context.addIssue({ code: "custom", path: [index < document.sources.length ? "sources" : "data"], message: `Two files share the path ${path}` })
  })
  if (!document.sources.some((file) => file.path === GAMEPLAY_API.main)) context.addIssue({ code: "custom", path: ["sources"], message: `${GAMEPLAY_API.main} is missing` })
  if ([...document.sources, ...document.data].reduce((sum, file) => sum + bytes(file.content), 0) > GAMEPLAY_LIMITS.total_bytes)
    context.addIssue({ code: "custom", path: ["sources"], message: `Files are larger than ${GAMEPLAY_LIMITS.total_bytes} bytes together` })
  const keys = (locale: "zh_cn" | "en_us") => Object.keys(document.lang[locale]).sort()
  if (keys("zh_cn").length > GAMEPLAY_LIMITS.lang) context.addIssue({ code: "custom", path: ["lang"], message: `More than ${GAMEPLAY_LIMITS.lang} texts` })
  if (keys("zh_cn").join("\n") !== keys("en_us").join("\n")) context.addIssue({ code: "custom", path: ["lang"], message: "zh_cn and en_us must have the same keys" })
}

/** The part an AI writes after the sheet: code, data and texts. */
export const GameplayCodeSchema = z.strictObject(code).superRefine(structure)
export type GameplayCode = z.infer<typeof GameplayCodeSchema>

/**
 * The description the writer of the code wants instead of the one it was given, with why. Wherever the description itself is at fault (it asks for something the
 * thing already does otherwise, or something the game cannot do) the code round cannot fix it, and used to be sent back for it again and again (broad22-api-r5: a
 * hen "that does not follow players" over a creature that follows whoever holds seeds; eight versions). The same way a part's maker declares in its self-review.
 */
export const GameplaySheetChangeSchema = z.strictObject({ because: Line(400), sheet: GameplaySheetSchema })
export type GameplaySheetChange = z.infer<typeof GameplaySheetChangeSchema>

/** What Studio's own AI answers when it writes the code: the code, and, when the description is at fault, the description it asks for instead (null when it is not). */
export const GameplayWriterSchema = z.strictObject({ ...code, sheet_change: GameplaySheetChangeSchema.nullable().optional() }).superRefine(structure)

export const GameplayDocumentSchema = z.strictObject({ kind: z.literal("gameplay"), ...described, ...code }).superRefine(structure)
export type GameplayDocument = z.infer<typeof GameplayDocumentSchema>

/** The sheet a document carries: what a review of the code is held against. */
export function gameplaySheet(document: GameplaySheet): GameplaySheet {
  return { slug: document.slug, name: document.name, summary: document.summary, behaviours: document.behaviours, not_doing: document.not_doing, uses: document.uses }
}

/** The Java package every generated class of a mod lives under. `build-source.ts` uses the same name. */
export const modPackage = (modId: string) => `com.minemods.content_${modId}`
/** Where all gameplay of a mod lives, and where one gameplay lives. */
export const gameplayRoot = (modId: string) => `${modPackage(modId)}.gameplay`
export const gameplayPackage = (modId: string, slug: string) => `${gameplayRoot(modId)}.${slug}`
/** The package one source file has to declare: the gameplay's own, plus the folders in its path. */
export const sourcePackage = (modId: string, slug: string, path: string) => [gameplayPackage(modId, slug), ...segments(path).slice(0, -1)].join(".")
/** The file as it is named in the generated project. */
export const sourceFile = (modId: string, slug: string, path: string) => `src/main/java/${gameplayPackage(modId, slug).replaceAll(".", "/")}/${path}`
export const dataFile = (path: string) => `src/main/resources/${path}`
/** A creature is registered under its `identifier`, or else under its id without the dashes (`registry-name.ts`). */
export { creatureName }

/** What a gameplay can attach to, as the registry names the kinds. A creature is listed by its model or by its rules. */
export const GAMEPLAY_USES = ["item", "block", "entity", "model", "gesture", "gameplay", "effect"] as const

export type GameplayThing = {
  /** The asset to list under `uses`. */
  asset_id: string
  kind: "item" | "block" | "creature" | "gesture" | "gameplay" | "effect"
  title: string
  /** What to pass to the accessor: an item's or block's identifier, a creature's asset id. Null when code cannot read it. */
  key: string | null
  /** Its name in the game's registry, without the mod id. */
  registry: string | null
  /** The Java that reads it, as the AI is shown it. */
  accessor: string | null
  /**
   * A creature is listed once under each id the project reads it by (its model's asset and the asset of its rules), and both name the same game creature.
   * The first is the creature itself; the others carry its asset id here and are only other names for it. Null for everything else, and for the creature itself.
   */
  alias_of: string | null
}

type Facts = {
  mod_id: string
  /** `abilities`: only what an ability's hit that a gameplay does is read by (`abilityActionGaps`). */
  entities: readonly { id: string; name: string; model_asset_id: string | null; behavior?: string; abilities?: readonly { id: string; name: string; hits: readonly { type: string; gameplay?: string; action?: string }[] }[] | null }[]
  blocks: readonly { id: string; identifier: string; name: string }[]
  items: readonly { id: string; identifier: string; name: string }[]
  recipes: readonly { id: string }[]
  workspace: { assets: readonly { id: string; module: string; title: string; document: { kind: string } & Record<string, unknown> }[] }
}

type Plain = Omit<GameplayThing, "alias_of">

/**
 * Everything of a project a gameplay may attach to, from the project alone. The accessor the build
 * generates, the list an AI is given and the reference check all read this one list.
 */
export function gameplayThings(project: Facts): GameplayThing[] {
  const assets = project.workspace.assets
  const saved = (id: string) => assets.some((asset) => asset.id === id)
  const creature = (assetId: string, entity: Facts["entities"][number]): Plain => ({ asset_id: assetId, kind: "creature", title: entity.name, key: assetId, registry: creatureName(entity), accessor: `${GAMEPLAY_API.content}.entity("${assetId}")` })
  // Only a creature with a saved model is built, so only that one can be read from code.
  const built = project.entities.filter((entity) => entity.model_asset_id !== null)
  const listed: Plain[] = [
    ...project.items.filter((item) => saved(item.id)).map((item): Plain => ({ asset_id: item.id, kind: "item", title: item.name, key: item.identifier, registry: item.identifier, accessor: `${GAMEPLAY_API.content}.item("${item.identifier}")` })),
    ...project.blocks.filter((block) => saved(block.id)).map((block): Plain => ({ asset_id: block.id, kind: "block", title: block.name, key: block.identifier, registry: block.identifier, accessor: `${GAMEPLAY_API.content}.block("${block.identifier}")` })),
    ...built.filter((entity) => saved(entity.id)).map((entity) => creature(entity.id, entity)),
    // A creature's rules are an asset of their own; listing either one means the creature.
    ...assets.flatMap((asset) => built.filter((entity) => asset.document.kind === "entity" && asset.document.model_asset_id === entity.id).map((entity) => creature(asset.id, entity))),
    ...assets.filter((asset) => asset.document.kind === "gesture").map((asset): Plain => ({ asset_id: asset.id, kind: "gesture", title: contentName(asset), key: null, registry: null, accessor: null })),
    // H3: an effect is shown by its asset id; it has no name of its own in the game's registry.
    ...assets.filter((asset) => asset.document.kind === "effect").map((asset): Plain => ({ asset_id: asset.id, kind: "effect", title: asset.title, key: asset.id, registry: null, accessor: `${GAMEPLAY_API.content}.spawnEffect("${asset.id}", world, pos, yaw)` })),
    ...assets.flatMap((asset) =>
      asset.document.kind === "gameplay" && typeof asset.document.slug === "string"
        ? [{ asset_id: asset.id, kind: "gameplay" as const, title: contentName(asset), key: asset.document.slug, registry: null, accessor: `import ${gameplayPackage(project.mod_id, asset.document.slug)}.*;` }]
        : [],
    ),
  ]
  // The first entry of a creature is the creature; any later one is another name for it (a model's asset and the asset of its rules both stand for the one game creature).
  const first = new Map<string, string>()
  return listed.map((thing) => {
    if (thing.kind !== "creature" || !thing.registry) return { ...thing, alias_of: null }
    const primary = first.get(thing.registry)
    if (primary === undefined) first.set(thing.registry, thing.asset_id)
    return { ...thing, alias_of: primary ?? null }
  })
}

/** Texts and files of a mod that Studio writes itself: a gameplay may not put its own in their place. */
export function generatedNames(project: Facts) {
  const built = project.entities.filter((entity) => entity.model_asset_id !== null).map((entity) => creatureName(entity))
  return {
    lang: (key: string) =>
      project.blocks.some((block) => key === `block.${project.mod_id}.${block.identifier}`) ||
      project.items.some((item) => key === `item.${project.mod_id}.${item.identifier}`) ||
      built.some((name) => key === `entity.${project.mod_id}.${name}` || key === `item.${project.mod_id}.${name}_spawn_egg`) ||
      key.startsWith(`key.${project.mod_id}.gesture.`) ||
      key === `category.${project.mod_id}.gestures`,
    data: (path: string) =>
      path.startsWith(`data/${project.mod_id}/studio/`) ||
      // Exactly the recipe files Studio writes (`data/<mod>/recipe/<recipe id>.json`, content.ts), no more: the rule only stops a gameplay
      // overwriting Studio's own file. A gameplay's recipe under any other name in the same folder is its own and is read as such.
      project.recipes.some((recipe) => path === `data/${project.mod_id}/recipe/${recipe.id}.json`) ||
      project.blocks.some((block) => path === `data/${project.mod_id}/loot_table/blocks/${block.identifier}.json`) ||
      // A creature's drops are its own document's (`loot`); gameplay code adds drops in code, not by replacing the table.
      built.some((name) => path === `data/${project.mod_id}/loot_table/entities/${name}.json`) ||
      /^data\/minecraft\/tags\/block\/mineable\/(?:pickaxe|axe|shovel)\.json$/.test(path) ||
      // Data-only gameplay: the tool tier tags and each block's ore features are Studio's to write as well.
      /^data\/minecraft\/tags\/block\/needs_(?:stone|iron|diamond)_tool\.json$/.test(path) ||
      project.blocks.some((block) => path === `data/${project.mod_id}/worldgen/configured_feature/ore_${block.identifier}.json` || path === `data/${project.mod_id}/worldgen/placed_feature/ore_${block.identifier}.json`),
  }
}

const KIND_WORDS: Record<GameplayThing["kind"], string> = { item: "物品", block: "方块", creature: "生物", gesture: "施法动作", gameplay: "玩法", effect: "效果" }
export const thingWord = (kind: GameplayThing["kind"]) => KIND_WORDS[kind]

/**
 * The way into a new creative world, said once for every place that sends a person to try something: nobody is put in a world for them
 * when the game is opened on its main menu, so what to choose is said, and the one switch a command needs.
 */
export const NEW_WORLD_WORDS = "在游戏里点「单人游戏」→「创建新的世界」，把游戏模式选成「创造」，把「允许作弊」打开（用命令才需要），再点「创建新的世界」"

/**
 * What the person does with an item once they see it in the creative inventory. Clicking it only puts a copy on the cursor: read off the 1.21.1 client
 * (javap on `CreativeModeInventoryScreen.slotClicked`, Yarn's `CreativeInventoryScreen.onMouseClick`), a click on a slot of the creative item list sets the handler's cursor stack to a copy of the item (one,
 * or a full stack with shift held: QUICK_MOVE there only changes the count), and nothing is sent to the player's inventory until a second click on a
 * hotbar slot puts the cursor stack down. So shift-click is no shortcut to the hotbar, and 「点一下就放进快捷栏」 left out the second click (broad18 w2, B18-J-06).
 */
export const CREATIVE_TAKE_WORDS = "点一下它，它只是跟在鼠标上；再点一下快捷栏里的一个空格，它才放进去"

/**
 * How to get hold of one of the project's things in a creative test world, for the person's own play-test: the way that needs no command
 * first (the creative inventory, by the name the person knows it by), the command as one line they can paste after it.
 */
function reach(modId: string, thing: GameplayThing) {
  const search = (name: string) => `按 E 打开物品栏，点「搜索物品」页签，输入「${name}」`
  if (thing.kind === "item") return `拿到「${thing.title}」：${search(thing.title)}，${CREATIVE_TAKE_WORDS}；不想翻物品栏的话，${typeIn(`/give @s ${modId}:${thing.registry}`)}，直接给你一个`
  if (thing.kind === "block") return `拿到「${thing.title}」并放下几块：${search(thing.title)}，${CREATIVE_TAKE_WORDS}，选中那一格后对着地面右键放下；不想翻物品栏的话，${typeIn(`/give @s ${modId}:${thing.registry}`)}，直接给你一个`
  if (thing.kind === "creature") return `放出「${thing.title}」：按 E 打开物品栏，点「刷怪蛋」页签找到「${thing.title}刷怪蛋」，${CREATIVE_TAKE_WORDS}，选中那一格后对着地面右键；不想翻物品栏的话，${typeIn(`/summon ${modId}:${thing.registry}`)}，它就出现在你面前`
  if (thing.kind === "gesture") return `记住「${thing.title}」的按键（在游戏的按键设置里能看到）`
  if (thing.kind === "effect") return `效果「${thing.title}」不用准备：它由这个玩法自己放出来`
  return `玩法「${thing.title}」要同时在这个模组里`
}

/**
 * 「怎么在游戏里试」: guidance for the person's own play-test, made from the description alone — what to
 * get ready, then per behaviour what to do, what should happen and what to look and listen for. Nobody
 * ticks anything and nothing here was run: it is the description turned into steps.
 */
export function gameplayTryList(modId: string, sheet: Pick<GameplaySheet, "behaviours" | "not_doing" | "uses">, things: readonly GameplayThing[]) {
  const used = sheet.uses.flatMap((id) => things.filter((thing) => thing.asset_id === id))
  return {
    prepare: [`把构建出来的模组放进 mods 文件夹（用 Studio 里的“构建并试玩”按钮打开游戏的话已经放好了），进一个创造模式的世界。新建的办法：${NEW_WORLD_WORDS}`, ...used.map((thing) => reach(modId, thing))],
    steps: sheet.behaviours.map((behaviour) => ({ do: behaviour.when, expect: behaviour.does, notice: behaviour.shows })),
    not_expected: sheet.not_doing,
  }
}
export type GameplayTryList = ReturnType<typeof gameplayTryList>

/** One finding of a machine check on gameplay code, in words whoever wrote the code can act on. */
export type GameplayFinding = {
  /** Which rule found it; stable, for tests and tables. */
  rule: string
  /** The file it is in, by its path in the document; null when it is about the gameplay as a whole. */
  file: string | null
  line: number | null
  /** What was found. */
  message: string
  /** What to do instead. */
  fix: string
  /**
   * The finding in one sentence for the person, with no name of code in it. Written by Studio where it makes the finding; absent in records from before,
   * and for those `plainFinding` (gameplay-plain.ts) says it from the rule. `message` and `fix` quote the code for whoever fixes it.
   */
  plain?: string
}

/** A finding as one plain line: where, what, and what to do instead. */
export const findingLine = (finding: GameplayFinding) => `${finding.file ? `${finding.file}${finding.line ? ` 第 ${finding.line} 行` : ""}：` : ""}${finding.message}${finding.fix}`
