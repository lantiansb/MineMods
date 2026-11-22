import { contentName } from "./asset-name"
import { GAMEPLAY_API, creatureName, gameplayThings, generatedNames, type GameplayDocument, type GameplayFinding, type GameplayThing } from "./gameplay"
import { argumentLiteral, argumentText, callArgumentSpans, closing, stripJava, type ScannedSource } from "./gameplay-scan"
import { BASELINE_GOALS, GOAL_BAND, GOAL_BAND_WORDS, inGoalBand } from "./creature-goals"
import { DEFAULT_TARGET, type TargetId } from "./target/ids"
import { targetWords } from "./target/words"

/**
 * What a gameplay points at, checked against the project: every thing it lists exists, every thing its
 * code reads through `ProjectContent` is one of this project's and is listed, its data files are JSON and
 * name things that exist, its texts are there in both languages, and it puts nothing in the place of a
 * file or text Studio writes itself or another gameplay owns. No Node APIs: the app's window runs it too.
 */

/** What the checks read of a project; `target` (the primary one) decides the facts of the game they hold the data files to, left out: the default. */
type Project = Parameters<typeof gameplayThings>[0] & { target?: TargetId }

const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length
const NAMESPACES = ["minecraft", "c", "fabric"]
const READS = { item: ["item"], block: ["block"], blockItem: ["block"], entity: ["creature"], isEntity: ["creature"], addGoal: ["creature"], addTargetGoal: ["creature"], targetRule: ["creature"], spawnEffect: ["effect"] } as const
/** The calls that steer a creature the code already holds (a `Mob`), so they name no content of the project to check. */
const STEERS = ["flyTo", "isFlying", "land", GAMEPLAY_API.motionMethod]
/** Called by Studio's own generated creatures only. */
const INTERNAL = ["applyGoals", "mayTarget", "runAbility"]
/** The call by which gameplay code registers what it does at the moment of an ability's hit written for it (`abilityAction("name", (creature, target) -> …)`): its first argument is the entry's own name, not a thing of the project. */
const ABILITY_ENTRY = GAMEPLAY_API.abilityMethod
/** How an entry of an ability is spelled: the same as an ability's own id (`AbilitySchema`). */
const ABILITY_ENTRY_NAME = /^[a-z][a-z0-9_]{0,31}$/
/** The calls by which gameplay code governs whom a creature fights: a creature named in one is generated to fight its target and nobody else. */
const GOVERNS = ["targetRule", "addTargetGoal"]

/** Every call of the accessor in one source file: the method, where it stands, and the name it is given when that is written out (a string, or a `static final String` constant of the same file). */
export function accessorCalls(content: string) {
  const scanned = stripJava(content)
  return [...scanned.code.matchAll(new RegExp(`(?<![\\w.])${GAMEPLAY_API.content}\\s*\\.\\s*(\\w+)\\s*\\(`, "g"))].map((call) => {
    const method = call[1]!
    const open = call.index + call[0].length - 1
    // The arguments are cut at the commas of the call itself (balanced brackets, strings already blanked), so a call written inside one
    // argument (`isEntity(ball.getOwner(), "id")`) or a comma or bracket inside a string does not move the name.
    const args = callArgumentSpans(scanned.code, open)
    // addGoal("id", priority, factory) and targetRule("id", rule): the name is the first argument. isEntity(entity, "id"): it is the last.
    const arg = method.startsWith("add") || method === "targetRule" || method === "spawnEffect" || method === ABILITY_ENTRY ? args[0]! : args.at(-1)!
    return {
      method,
      index: call.index,
      // The name is written out when its argument is one string literal on its own (not `"a" + b`), or a constant of the same file that stands for its text (`static final String GUARDIAN = "…"`).
      name: argumentText(scanned, arg),
      /** What stands between the first two commas: the priority of an added goal. */
      second: args.length > 2 ? scanned.code.slice(args[1]!.start, args[1]!.end).trim() : "",
    }
  })
}

/**
 * The creatures, by their names in the game's registry, whose targets gameplay code of this project governs
 * (`targetRule`, `addTargetGoal`). `draft` is a gameplay being written: it stands in for its saved version.
 */
export function governedCreatures(project: Project, draft?: { asset_id: string | null; document: Pick<GameplayDocument, "sources"> }) {
  const things = gameplayThings(project)
  const sources = [
    ...project.workspace.assets.flatMap((asset) => (asset.document.kind === "gameplay" && asset.id !== draft?.asset_id ? (asset.document as unknown as GameplayDocument).sources : [])),
    ...(draft?.document.sources ?? []),
  ]
  return new Set(
    sources
      .flatMap((file) => accessorCalls(file.content))
      .filter((call) => GOVERNS.includes(call.method))
      .flatMap((call) => things.flatMap((thing) => (thing.kind === "creature" && thing.key === call.name && thing.registry ? [thing.registry] : []))),
  )
}

/** The gameplay of the project that has this slug, by its asset and the name the project shows it by; null when there is none (an ability can name one that is gone). */
export function gameplayBySlug(project: Project, slug: string): { id: string; title: string } | null {
  const asset = project.workspace.assets.find((value) => value.document.kind === "gameplay" && value.document.slug === slug)
  return asset ? { id: asset.id, title: contentName(asset) } : null
}

/** Every entry a gameplay's code registers for abilities (`ProjectContent.abilityAction("name", …)`), with where it stands. `name` is undefined when the call does not write the name out: no ability can be told to call that. */
export function registeredActions(sources: readonly { path: string; content: string }[]) {
  return sources.flatMap((file) => accessorCalls(file.content).filter((call) => call.method === ABILITY_ENTRY).map((call) => ({ name: call.name, file: file.path, line: lineAt(file.content, call.index) })))
}

/**
 * A moment of a creature's ability that is done by a gameplay's code (a hit of type "gameplay") whose entry cannot be found: no gameplay of the project has that slug (`no_gameplay`), or the one that
 * has it does not register an entry of that name (`no_entry`). Read from the documents and the code written out, no more: that the entry is registered says the ability can call it, never what it does.
 */
export type AbilityActionGap = {
  entity: { id: string; name: string }
  ability: { id: string; name: string }
  /** Which hit of the ability, counted from 0. */
  hit: number
  slug: string
  action: string
  gap: "no_gameplay" | "no_entry"
  /** The gameplay that has the slug, when there is one: its asset (null for a version not saved yet) and the name the project shows it by. */
  gameplay: { id: string | null; title: string } | null
}

/**
 * Every moment of the project's fighting creatures that a gameplay is to do, against the gameplay code of the project. `draft` stands in for its saved version, as in `governedCreatures`: a gameplay being
 * checked is held to what it would be once saved, so the code that answers an ability is told what the ability asks of it before anything is saved.
 */
export function abilityActionGaps(project: Project, draft?: { asset_id: string | null; document: Pick<GameplayDocument, "slug" | "sources"> & { title?: string } }): AbilityActionGap[] {
  const gameplays = [
    ...project.workspace.assets.flatMap((asset) => (asset.document.kind === "gameplay" && asset.id !== draft?.asset_id ? [{ id: asset.id as string | null, title: contentName(asset), document: asset.document as unknown as Pick<GameplayDocument, "slug" | "sources"> }] : [])),
    ...(draft ? [{ id: draft.asset_id, title: draft.document.title ?? project.workspace.assets.find((asset) => asset.id === draft.asset_id)?.title ?? draft.document.slug, document: draft.document }] : []),
  ]
  return project.entities.flatMap((entity) =>
    // Only a creature that fights has its abilities generated.
    entity.behavior !== "hostile"
      ? []
      : (entity.abilities ?? []).flatMap((ability) =>
          ability.hits.flatMap((hit, index): AbilityActionGap[] => {
            if (hit.type !== "gameplay" || hit.gameplay === undefined || hit.action === undefined) return []
            const found = gameplays.find((value) => value.document.slug === hit.gameplay)
            const base = { entity: { id: entity.id, name: entity.name }, ability: { id: ability.id, name: ability.name }, hit: index, slug: hit.gameplay, action: hit.action }
            if (!found) return [{ ...base, gap: "no_gameplay", gameplay: null }]
            const gameplay = { id: found.id, title: found.title }
            return registeredActions(found.document.sources).some((entry) => entry.name === hit.action) ? [] : [{ ...base, gap: "no_entry", gameplay }]
          }),
        ),
  )
}

/**
 * A gap in the words of the person who reads the build's findings: what is wrong with the creature's ability and what to do, with no name of code in either (the slug and the entry are in `detail`, for 高级).
 * The build stops on it: an ability that asks for what nobody answers would play its motion and do nothing at the moment it was made for.
 */
export function abilityActionWords(gap: AbilityActionGap) {
  const nth = `第 ${gap.hit + 1} 次出手`
  return {
    text:
      gap.gap === "no_gameplay"
        ? `「${gap.entity.name}」的招式「${gap.ability.name}」${nth}要交给一个玩法的代码去做，可是工程里找不到那个玩法（可能被删掉了）。`
        : `「${gap.entity.name}」的招式「${gap.ability.name}」${nth}要交给玩法「${gap.gameplay!.title}」去做，可是那个玩法的代码里没有接这一招的入口：这一招的动作会放出来，到了该做事的那一刻什么也不会发生。`,
    fix:
      gap.gap === "no_gameplay"
        ? "让 AI 把那个玩法做回来，或者把这一下改成招式自己能写的出手（打一片范围、射出东西）。补上以前打不了包。"
        : "让 AI 改那个玩法的代码，补上这一招的入口（它叫什么，在「高级」里）；或者把这一下改成招式自己能写的出手。补上以前打不了包。",
    detail: `ability ${gap.ability.id} hit ${gap.hit}: gameplay ${gap.slug}, action ${gap.action}; ${gap.gap === "no_gameplay" ? "no gameplay has this slug" : "the gameplay does not register this action with ProjectContent.abilityAction"}`,
  }
}

/** One gameplay of the project that points at a creature, and the one thing about it that can be read for certain. */
export type GameplayHold = {
  /** The gameplay's asset id and the name the project shows it by. */
  id: string
  title: string
  /** Its code decides whom the creature fights (`targetRule`, `addTargetGoal` named for this creature). */
  target: boolean
  /** Its code adds behaviour of its own to the creature (`addGoal` named for this creature). */
  goals: boolean
}

/**
 * The gameplay of this project that points at the creature called `registry` in the game's registry, by what the project says and what the code writes out
 * and no more: the gameplay lists the creature under `uses`, or one of its calls on `ProjectContent` names it (`entity`, `isEntity`, `addGoal`, `targetRule`,
 * `addTargetGoal`). A call whose name is not written out cannot be read and is not counted. It says the gameplay is about the creature, and for `target` and
 * `goals` what kind of hand it has on it; never what the code does with it or that it works. `draft` stands in for its saved version, as in `governedCreatures`.
 */
export function gameplayHolds(project: Project, registry: string, draft?: { asset_id: string | null; document: Pick<GameplayDocument, "sources"> & Partial<Pick<GameplayDocument, "uses">> }): GameplayHold[] {
  // A creature is pointed at by its model's asset id or by the asset of its rules: both are its keys (`gameplayThings`).
  const keys = gameplayThings(project).flatMap((thing) => (thing.kind === "creature" && thing.registry === registry && thing.key ? [thing.key] : []))
  if (!keys.length) return []
  return project.workspace.assets.flatMap((asset) => {
    if (asset.document.kind !== "gameplay") return []
    const document = (draft && asset.id === draft.asset_id ? { ...(asset.document as unknown as GameplayDocument), ...draft.document } : (asset.document as unknown as GameplayDocument))
    const calls = document.sources.flatMap((file) => accessorCalls(file.content)).filter((call) => call.name !== undefined && keys.includes(call.name))
    if (!calls.length && !(document.uses ?? []).some((id) => keys.includes(id))) return []
    return [{ id: asset.id, title: contentName(asset), target: calls.some((call) => GOVERNS.includes(call.method)), goals: calls.some((call) => call.method === "addGoal") }]
  })
}

/** Every `"namespace:path"` text inside parsed JSON, wherever it stands. */
const named = (value: unknown): string[] => {
  if (typeof value === "string") return /^#?[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value) ? [value.replace(/^#/, "")] : []
  if (Array.isArray(value)) return value.flatMap(named)
  if (typeof value === "object" && value !== null) return Object.entries(value).flatMap((entry) => [...named(entry[0]), ...named(entry[1])])
  return []
}

/**
 * The reference check of one gameplay. `assetId` is its own asset (null before it has one), so it is not
 * held against itself. Findings come back in the words whoever wrote the code can act on.
 */
/**
 * Data folders by the names they had before 1.21, with the name 1.21.1 reads (the registry keys' own paths in the
 * 1.21.1 jar: `loot_table`, `recipe`, `advancement`, `tags/item` …). A file under the name the target's game does not read is ignored without a word.
 */
const OLD_DATA_FOLDERS: readonly (readonly [string, string])[] = [
  ["loot_tables", "loot_table"], ["recipes", "recipe"], ["advancements", "advancement"], ["structures", "structure"], ["functions", "function"], ["predicates", "predicate"], ["item_modifiers", "item_modifier"],
  ["tags/items", "tags/item"], ["tags/blocks", "tags/block"], ["tags/entity_types", "tags/entity_type"], ["tags/fluids", "tags/fluid"], ["tags/game_events", "tags/game_event"], ["tags/functions", "tags/function"],
]

export function checkGameplayReferences(project: Project, document: GameplayDocument, assetId: string | null): GameplayFinding[] {
  const things = gameplayThings(project).filter((thing) => thing.asset_id !== assetId)
  const listed = document.uses.flatMap((id) => things.filter((thing) => thing.asset_id === id))
  const generated = generatedNames(project)
  const others = project.workspace.assets.flatMap((asset) => (asset.id !== assetId && asset.document.kind === "gameplay" ? [{ title: contentName(asset), document: asset.document as unknown as GameplayDocument }] : []))
  const found: GameplayFinding[] = []
  const add = (rule: string, file: string | null, line: number | null, message: string, fix: string) => found.push({ rule, file, line, message, fix })
  const offer = (kinds: readonly GameplayThing["kind"][]) => {
    const have = things.filter((thing) => kinds.includes(thing.kind) && thing.key)
    return have.length ? `这个工程里有：${have.slice(0, 8).map((thing) => `「${thing.title}」（${thing.key}）`).join("、")}${have.length > 8 ? " 等" : ""}。` : "这个工程里现在一样也没有。"
  }

  document.uses.filter((id) => !things.some((thing) => thing.asset_id === id)).forEach((id) => add("unknown_use", null, null, `uses 里列了 ${id}，但这个工程里没有这样东西（或者它不是玩法可以挂的东西）。`, "uses 只能写这个工程里已经保存的物品、方块、生物、施法动作或别的玩法的资产 id；claim_task 返回的 gameplay.things 里有完整的清单。"))
  const twin = others.find((other) => other.document.slug === document.slug)
  if (twin) add("slug_taken", null, null, `slug「${document.slug}」已经被另一个玩法「${twin.title}」用了。`, "换一个 slug；每个玩法有自己的包，名字不能重复。")

  document.sources.forEach((file) => {
    const scanned = stripJava(file.content)
    accessorCalls(file.content).forEach((call) => {
      const method = call.method
      const line = lineAt(file.content, call.index)
      if (method === "id") return
      if (INTERNAL.includes(method)) return add("unknown_accessor", file.path, line, `${GAMEPLAY_API.content}.${method} 是 Studio 生成的生物自己调用的，玩法代码不能调用。`, `要给生物加行为，用 ${GAMEPLAY_API.content}.addGoal("生物的资产 id", 优先级, mob -> new 你的Goal(mob))；要管它打谁，用 ${GAMEPLAY_API.content}.targetRule("生物的资产 id", (mob, 候选) -> …)。`)
      if (STEERS.includes(method)) return
      // Temporary terrain acts at a position; its arguments name no asset of the project.
      if (["terrainRise", "terrainRiseWith", "blockSwap", "blockSwapWithOwner", "popBlocks"].includes(method)) return
      // What the gameplay does at the moment of an ability's hit written for it: the name is the entry's own, spelled as an ability's id, and no two entries of the project share it (the second would throw at start).
      if (method === ABILITY_ENTRY) {
        const entry = call.name
        if (entry === undefined) return add("accessor_argument", file.path, line, `${GAMEPLAY_API.content}.${method}(...) 的名字不是直接写出来的。`, "把名字直接写成字符串，或者写成同一个文件里的 static final String 常量：招式里写的 action 要和它一字不差，Studio 才能核对这一招真的有人接。")
        if (!ABILITY_ENTRY_NAME.test(entry)) return add("ability_action_name", file.path, line, `${GAMEPLAY_API.content}.${method}("${entry}")：入口的名字写法不对。`, "用小写字母开头，只含小写字母、数字和下划线，最长 32 个字符，和招式里 action 写的一样。")
        const first = registeredActions(document.sources).find((value) => value.name === entry)!
        const twin = others.find((other) => registeredActions(other.document.sources).some((value) => value.name === entry))
        if (twin) return add("ability_action_taken", file.path, line, `${GAMEPLAY_API.content}.${method}("${entry}")：另一个玩法「${twin.title}」已经登记了同名的入口，两个同名的入口游戏一启动就会报错。`, "换一个名字，并让招式里的 action 跟着改。")
        if (first.file !== file.path || first.line !== line) return add("ability_action_taken", file.path, line, `${GAMEPLAY_API.content}.${method}("${entry}")：同一个玩法里把这个名字登记了两次，第二次游戏一启动就会报错。`, "每个入口只登记一次；两个招式要做不同的事，就用两个名字。")
        return
      }
      if (!(method in READS)) return add("unknown_accessor", file.path, line, `${GAMEPLAY_API.content} 没有 ${method} 这个方法。`, `${GAMEPLAY_API.content} 只有 item、block、blockItem、entity、isEntity、addGoal、addTargetGoal、targetRule、abilityAction、spawnEffect、flyTo、isFlying、land、playMotion 和 id。`)
      const kinds = READS[method as keyof typeof READS]
      // addGoal("id", priority, factory): what stands between the first two commas has to be a whole number written out, inside the band.
      if (method.startsWith("add")) {
        const written = call.second
        const fix = `把优先级直接写成 ${GOAL_BAND.over_idle[0]} 到 ${GOAL_BAND.over_idle[1]} 之间的整数（该它上场时要盖过闲逛），或者 ${GOAL_BAND.after} 及以上的整数（只在闲着时做）。`
        if (!/^-?\d+$/.test(written)) add("goal_priority", file.path, line, `${GAMEPLAY_API.content}.${method}(...) 的优先级不是直接写出来的整数${written && written.length <= 40 ? `（写的是 ${written}）` : ""}。写成变量、常量或算式，Studio 没法在不开游戏的情况下核对它不会和生物自带的行为抢。${GOAL_BAND_WORDS.baseline}。`, fix)
        else if (!inGoalBand(Number(written))) add("goal_priority", file.path, line, `${GAMEPLAY_API.content}.${method}(...) 的优先级写的是 ${written}，不在允许的范围里。${GOAL_BAND_WORDS.baseline}。${GOAL_BAND_WORDS.band}。${GOAL_BAND_WORDS.why}。`, fix)
      }
      const name = call.name
      if (name === undefined) return add("accessor_argument", file.path, line, `${GAMEPLAY_API.content}.${method}(...) 的名字不是直接写出来的。`, "把名字直接写成字符串，或者写成同一个文件里的 static final String 常量，这样 Studio 才能在不开游戏的情况下核对它存在。")
      const thing = things.find((value) => kinds.includes(value.kind as never) && value.key === name)
      if (!thing) return add("unknown_content", file.path, line, `${GAMEPLAY_API.content}.${method}("${name}")：这个工程里没有这个${kinds[0] === "creature" ? "生物" : kinds[0] === "effect" ? "效果" : kinds[0] === "block" ? "方块" : "物品"}。`, offer(kinds))
      // A creature listed under any of its ids is listed: its model and its rules are two names for one creature (`alias_of`).
      if (!listed.some((value) => value.kind === thing.kind && (value.key === thing.key || (value.kind === "creature" && value.registry === thing.registry)))) add("undeclared_use", file.path, line, `代码用到了「${thing.title}」，但 uses 里没有列它。`, `把它的资产 id（${thing.asset_id}）加进 uses：这样说明里看得到它挂在什么上，删掉那样东西之前 Studio 也会提醒。`)
      // A target is only acted on by a creature that fights: for any other, deciding one changes nothing it does.
      if (GOVERNS.includes(method) && ["passive", "follow"].includes(project.entities.find((entity) => creatureName(entity) === thing.registry)?.behavior ?? ""))
        add("target_unused", file.path, line, `${GAMEPLAY_API.content}.${method} 管的是「${thing.title}」打谁，但它不是敌对生物：它自己没有任何去打目标的行为，给它定了目标它也不会动手。`, "这是这只生物自己的设定，玩法改不了它：去掉这一处调用，它平时做什么用 addGoal 加你自己的行为。说明要的就是让它打人，那是说明和这只生物冲突，要改的是说明；真想让它打人，得由做这只生物的人把它的 behavior 改成 hostile。")
    })
    // A text shown to the player has to be there in both languages.
    ;[...scanned.code.matchAll(/\btranslatable\s*\(\s*"/g)].forEach((call) => {
      const key = scanned.strings.find((value) => value.offset === call.index + call[0].length - 1)?.value
      if (key && key.includes(`.${project.mod_id}.`) && !(key in document.lang.zh_cn)) add("missing_text", file.path, lineAt(file.content, call.index), `代码显示文字「${key}」，但 lang 里没有这一条。`, "在 lang.zh_cn 和 lang.en_us 里都加上这个 key 的文字。")
    })
  })

  // A creature's ability that hands a moment to this gameplay's entry: the code has to register it, or the ability would ask for something nobody answers.
  abilityActionGaps(project, { asset_id: assetId, document })
    .filter((gap) => gap.slug === document.slug && gap.gap === "no_entry")
    .forEach((gap) => add("ability_action_missing", null, null, `「${gap.entity.name}」的招式「${gap.ability.name}」第 ${gap.hit + 1} 次出手要交给这个玩法的入口 ${gap.action}，可是代码里没有登记它。`, `在 onInitialize 里加上 ${GAMEPLAY_API.content}.abilityAction("${gap.action}", (creature, target) -> { … })，名字一字不差；或者让那个招式改用别的入口名。`))

  const game = targetWords(project.target ?? DEFAULT_TARGET)
  const literals = new Set(document.sources.flatMap((file) => stripJava(file.content).strings.map((value) => value.value)))
  // What a data file may name in this mod's namespace: the project's own things, this gameplay's own data files, and names its code writes out.
  const registry = new Set([...gameplayThings(project).flatMap((thing) => (thing.registry ? [thing.registry] : [])), ...project.entities.map((entity) => `${creatureName(entity)}_spawn_egg`)])
  const ownData = (name: string) => document.data.some((file) => file.path.startsWith(`data/${project.mod_id}/`) && file.path.endsWith(`/${name}.json`))
  document.data.forEach((file) => {
    const namespace = file.path.split("/")[1]!
    if (namespace !== project.mod_id && !NAMESPACES.includes(namespace)) add("data_namespace", file.path, null, `数据文件放在了命名空间 ${namespace} 下面。`, `数据文件只能放在这个模组自己的命名空间（data/${project.mod_id}/…）下面，或者 minecraft、c、fabric 下面（用来往已有的标签里加东西）。`)
    // The target's game reads one of the two names; a file under the other is ignored without a word.
    const singular = game.folders === "singular"
    const old = OLD_DATA_FOLDERS.map(([plural, single]) => (singular ? [plural, single] : [single, plural])).find(([before]) => file.path.split("/").slice(2).join("/").startsWith(`${before}/`))
    const folderWhy = singular ? `那是旧版本游戏的名字` : `那是 1.21 起新版本游戏的名字`
    const folderFix = singular ? `1.21 起这些文件夹都改成了不带 s 的名字` : `${game.minecraft} 用的还是带 s 的名字`
    if (old) add("data_folder", file.path, null, `这个数据文件放在 ${old[0]} 文件夹里，${folderWhy}：${game.minecraft} 不读这个文件夹，文件等于没有，游戏也不会报错。`, `把文件夹改名为 ${old[1]}（${folderFix}）。`)
    if (generated.data(file.path)) add("shadows_generated", file.path, null, "这个数据文件和 Studio 自己生成的文件是同一个路径，会把它顶掉。", "换一个文件名。玩法自己的配方可以放在同一个 recipe 文件夹里，只要文件名不和已有配方的 id 重名；Studio 自己的方块、生物的掉落（loot_table）属于那些资产本身，玩法不能替换，要改它们的掉落就去改对应的资产。")
    const owner = others.find((other) => other.document.data.some((value) => value.path.toLowerCase() === file.path.toLowerCase()))
    if (owner) add("file_taken", file.path, null, `另一个玩法「${owner.title}」已经有同一个路径的数据文件。`, "换一个路径；两个玩法不能写同一个文件。")
    const parsed = (() => {
      try {
        return { value: JSON.parse(file.content) as unknown }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })()
    if ("error" in parsed) return add("data_json", file.path, null, `这个数据文件不是合法的 JSON（${parsed.error}）。`, "改成合法的 JSON：不能有注释，不能有多余的逗号。")
    ;[...new Set(named(parsed.value))]
      .filter((name) => name.startsWith(`${project.mod_id}:`))
      .map((name) => name.slice(project.mod_id.length + 1))
      .filter((name) => !registry.has(name) && !ownData(name) && !literals.has(name) && !literals.has(`${project.mod_id}:${name}`))
      .forEach((name) => add("unknown_reference", file.path, null, `数据文件里写了 ${project.mod_id}:${name}，但这个工程里没有叫这个名字的东西，这个玩法自己也没有定义它。`, `${offer(["item", "block"])}生物的名字是它的 identifier，没写的是 creature_ 加上它的 id（去掉横线）。`))
  })

  Object.keys(document.lang.zh_cn).forEach((key) => {
    if (generated.lang(key)) add("shadows_generated", null, null, `lang 里的「${key}」是 Studio 自己生成的文字（物品、方块、生物的名字），玩法不能改它。`, `换一个 key，例如 gameplay.${project.mod_id}.${document.slug}.……`)
    const owner = others.find((other) => key in other.document.lang.zh_cn)
    if (owner) add("text_taken", null, null, `lang 里的「${key}」已经被另一个玩法「${owner.title}」用了。`, `换一个 key，例如 gameplay.${project.mod_id}.${document.slug}.……`)
  })
  return found
}

/** The slugs of the other gameplay this one lists under `uses`: the only packages besides its own it may import. */
export function declaredGameplay(project: Project, document: Pick<GameplayDocument, "uses">, assetId: string | null) {
  return gameplayThings(project).flatMap((thing) => (thing.kind === "gameplay" && thing.asset_id !== assetId && thing.key && document.uses.includes(thing.asset_id) ? [thing.key] : []))
}

/**
 * The calls by which code puts a block into the world or an item into a player's hands or onto the ground,
 * by their 1.21.1 official names (read off the jar: Level.setBlock / setBlockAndUpdate, LevelChunk.setBlockState; Player.addItem / drop,
 * Inventory.add (as player.getInventory().add, the name alone is every list's) / placeItemBackInInventory, Entity.spawnAtLocation,
 * Block.popResource / popResourceFromFace, Containers.dropItemStack / dropContents, the ItemEntity constructor). Putting a stack into a hand
 * or a slot (setItemInHand, setItem, setItemSlot) is left out: the source does not say whose hand it is.
 */
const PUTS = {
  placed: /\.\s*(?:setBlock|setBlockAndUpdate|setBlockState)\s*\(/g,
  given: /\.\s*(?:addItem|drop|placeItemBackInInventory|spawnAtLocation|popResource|popResourceFromFace)\s*\(|\.\s*getInventory\s*\(\s*\)\s*\.\s*add\s*\(|(?<![\w.])Containers\s*\.\s*(?:dropItemStack|dropContents)\s*\(|\bnew\s+ItemEntity\s*\(/g,
} as const
/** The types a local may have that carries a block or an item from where it is read to where it is put. */
const CARRIERS = "Block|BlockState|BlockItem|Item|ItemStack|ItemLike|var"

/**
 * Gameplay of this project whose code places the block, or hands out the item, called `identifier`:
 * `ProjectContent.block("id")` (or a local of a carrying type made from it) stands among the arguments of
 * `setBlock` (or `setBlockAndUpdate`), or `ProjectContent.item("id")` / `blockItem("id")` among those of a call that gives or
 * drops a stack. A reading of the source by pattern, the way `creature-life.ts` reads who summons a creature:
 * it says the code is written to do it, never when, where, how often, or that it works in the game. What it
 * cannot follow (a helper method in between, a field, a loot table or a world-generation file of the
 * gameplay) reads as nothing found.
 */
export function gameplayPuts(project: Pick<Project, "workspace">, identifier: string) {
  return project.workspace.assets.flatMap((asset) => {
    if (asset.document.kind !== "gameplay") return []
    const found = (asset.document as unknown as GameplayDocument).sources.map((file) => {
      const code = stripJava(file.content).code
      const reads = accessorCalls(file.content).filter((call) => ["block", "blockItem", "item"].includes(call.method) && call.name === identifier)
      if (!reads.length) return { placed: false, given: false }
      const declared = [...code.matchAll(new RegExp(`(?<![\\w.])(?:${CARRIERS})\\s+(\\w+)\\s*=([^;]*);`, "g"))].map((match) => ({ name: match[1]!, from: match.index, to: match.index + match[0].length, made: match[2]! }))
      // A local made from the read, or from a local made from it: a few steps are enough for `Block → BlockState` and `Item → ItemStack`.
      const carried = [0, 1, 2].reduce<string[]>((names) => declared.filter((local) => reads.some((read) => read.index > local.from && read.index < local.to) || names.some((name) => new RegExp(`\\b${name}\\b`).test(local.made))).map((local) => local.name), [])
      const reaches = (calls: RegExp) =>
        [...code.matchAll(calls)].some((call) => {
          const open = call.index + call[0].length - 1
          const close = closing(code, open)
          return reads.some((read) => read.index > open && read.index < close) || carried.some((name) => new RegExp(`\\b${name}\\b`).test(code.slice(open, close)))
        })
      return { placed: reads.some((read) => read.method === "block") && reaches(PUTS.placed), given: reaches(PUTS.given) }
    })
    const placed = found.some((file) => file.placed)
    const given = found.some((file) => file.given)
    return placed || given ? [{ id: asset.id, title: contentName(asset), placed, given }] : []
  })
}

/** Every string value anywhere in parsed JSON, at any depth. Object keys are not values. */
function jsonStrings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(jsonStrings)
  return value && typeof value === "object" ? Object.values(value).flatMap(jsonStrings) : []
}
const parsedJson = (content: string): unknown => {
  try {
    return JSON.parse(content)
  } catch {
    return undefined
  }
}

/** The text an argument stands for when the source writes it out: one string literal, or a plain name whose declaration (`String NAME = "…"`) is a literal of the same file. */
function writtenText(scanned: ScannedSource, span: { start: number; end: number }): string | undefined {
  const literal = argumentLiteral(scanned, span)
  if (literal !== undefined) return literal
  const name = /^[A-Za-z_]\w*$/.exec(scanned.code.slice(span.start, span.end).trim())?.[0]
  const declared = name ? new RegExp(`(?<![\\w.])${name}\\s*=\\s*"`).exec(scanned.code) : null
  return declared ? scanned.strings.find((value) => value.offset === declared.index + declared[0].length - 1)?.value : undefined
}

/**
 * The ids a call argument names, as far as the source writes them out: a literal ("mod:name"), `ProjectContent.id("name")`,
 * `ResourceLocation.fromNamespaceAndPath("mod", "name")` / `ResourceLocation.parse("mod:name")` (or `tryParse`) / `ResourceLocation.withDefaultNamespace("name")`. An argument that is a plain name
 * (a field or local holding the key) is followed once to what it was made from. Anything computed reads as nothing.
 */
function writtenIds(scanned: ScannedSource, span: { start: number; end: number }, mod: string, follow = true): string[] {
  const full = (text: string) => (text.includes(":") ? text : `minecraft:${text}`)
  const literal = writtenText(scanned, span)
  if (literal !== undefined) return [full(literal)]
  const code = scanned.code.slice(span.start, span.end)
  const made = [...code.matchAll(new RegExp(`\\b(?:(${GAMEPLAY_API.content}\\s*\\.\\s*id)|ResourceLocation\\s*\\.\\s*(?:fromNamespaceAndPath|parse|tryParse|withDefaultNamespace|tryBuild))\\s*\\(`, "g"))].flatMap((call) => {
    const parts = callArgumentSpans(scanned.code, span.start + call.index + call[0].length - 1).map((part) => writtenText(scanned, part))
    if (parts.some((part) => part === undefined)) return []
    return call[1] ? [`${mod}:${parts[0]}`] : parts.length === 2 ? [`${parts[0]}:${parts[1]}`] : [full(parts[0]!)]
  })
  if (made.length || !follow) return made
  const name = /^[A-Za-z_]\w*$/.exec(code.trim())?.[0]
  const declared = name ? new RegExp(`(?<![\\w.])${name}\\s*=([^;]*);`).exec(scanned.code) : null
  return declared ? writtenIds(scanned, { start: declared.index + declared[0].indexOf("=") + 1, end: declared.index + declared[0].length - 1 }, mod, false) : []
}

/** The placed features one source file hooks into world generation: the ids written in its `BiomeModifications.addFeature(…)` calls. */
function hookedFeatures(content: string, mod: string): string[] {
  const scanned = stripJava(content)
  return [...scanned.code.matchAll(/\bBiomeModifications\s*\.\s*addFeature\s*\(/g)].flatMap((call) => callArgumentSpans(scanned.code, call.index + call[0].length - 1).flatMap((span) => writtenIds(scanned, span, mod)))
}

const FEATURE_FILE = /^data\/([a-z0-9_.-]+)\/worldgen\/(configured_feature|placed_feature)\/(.+)\.json$/

/**
 * Gameplay of this project that brings the block called `identifier` into the world through world generation:
 * its data holds a configured or placed feature file with the block's full id (`<mod>:<identifier>`) as a string
 * value anywhere in the JSON, and that feature is hooked in, i.e. the gameplay's code names a placed feature in a
 * `BiomeModifications.addFeature(` call and the chain from that placed feature reaches the file naming the block.
 * The chain is read the way the game reads it: a placed feature's `feature` is a configured feature (by id, or
 * written inline), and a configured feature may nest more features inline or point at placed ones by id. A feature
 * file nothing hooks never runs, so it is no source; that is true, and nothing more is said about it. A reading of
 * the files and the source: it says the block is put in the world, never where, how often, or that it works.
 */
export function gameplayWorldgen(project: Pick<Project, "workspace" | "mod_id">, identifier: string) {
  const block = `${project.mod_id}:${identifier}`
  return project.workspace.assets.flatMap((asset) => {
    if (asset.document.kind !== "gameplay") return []
    const document = asset.document as unknown as GameplayDocument
    const features = new Map<string, string[]>()
    document.data.forEach((file) => {
      const found = FEATURE_FILE.exec(file.path)
      const parsed = found ? parsedJson(file.content) : undefined
      if (found && parsed !== undefined) features.set(`${found[2]}:${found[1]}:${found[3]}`, jsonStrings(parsed))
    })
    if (!features.size) return []
    // placed → configured, configured → placed: the two kinds point at each other through their ids.
    const reaches = (kind: "placed_feature" | "configured_feature", id: string, seen: Set<string>): boolean => {
      const key = `${kind}:${id}`
      const strings = features.get(key)
      if (!strings || seen.has(key)) return false
      seen.add(key)
      return strings.includes(block) || strings.some((value) => reaches(kind === "placed_feature" ? "configured_feature" : "placed_feature", value, seen))
    }
    const hooked = document.sources.flatMap((file) => hookedFeatures(file.content, project.mod_id))
    return hooked.some((id) => reaches("placed_feature", id, new Set())) ? [{ id: asset.id, title: contentName(asset) }] : []
  })
}

/**
 * Gameplay of this project that ships a recipe file of its own whose result is the block or item called
 * `identifier`, with the other things of this project the recipe takes (so a recipe nobody can feed is
 * not mistaken for a way in). Read from the file alone: `result` is `{ "id": … }` (1.21) or a bare id.
 */
export function gameplayRecipes(project: Pick<Project, "workspace" | "mod_id">, identifier: string) {
  const result = `${project.mod_id}:${identifier}`
  return project.workspace.assets.flatMap((asset) => {
    if (asset.document.kind !== "gameplay") return []
    return (asset.document as unknown as GameplayDocument).data.flatMap((file) => {
      if (!/^data\/[^/]+\/recipe\/.+\.json$/.test(file.path)) return []
      const parsed = parsedJson(file.content)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return []
      const { result: made, ...taken } = parsed as Record<string, unknown>
      const id = typeof made === "string" ? made : made && typeof made === "object" ? (made as Record<string, unknown>).id : undefined
      if (id !== result) return []
      const through = [...new Set(jsonStrings(taken).filter((value) => value.startsWith(`${project.mod_id}:`)).map((value) => value.slice(project.mod_id.length + 1)))].filter((other) => other !== identifier)
      return [{ id: asset.id, title: contentName(asset), path: file.path, through }]
    })
  })
}

/** Said beside every answer read off gameplay code: where it comes from, and that nothing was run. */
export const READ_FROM_CODE = "Studio 是从代码里读出来的，没有运行过"

/** What a goal over idling that can always start means, for the writer, the reviewer and the finding above. */
export const GOAL_ALWAYS_WORDS = {
  means: `闲逛（${BASELINE_GOALS.wander}）、看向玩家（${BASELINE_GOALS.look_at_player}）、张望（${BASELINE_GOALS.look_around}）用的是同一副身体，就一直轮不到`,
  fix: "这是提醒，不拦这一版。要它只在某些时候上场，就在 canUse 里写上真正要等的事（玩家走到多少格以内、隔多少刻一次、一个随机的机会），或者让它做一小会儿就在 canContinueToUse 里退场、隔一阵再来，把时间还给闲逛和张望。它确实应该一直顶替闲逛的话，说明里必须如实写明它闲着时不再自己走动和张望，不能写原有的行为都保留：评审会拿说明对着这一条看。",
} as const

/** What a creature does most of the time it has nothing to do, as `canUse` asks it: conditions that wait for nothing. */
const STANDING = [
  [/^(?:this\.)?\w+\.getTarget\(\)==null$/, "没有目标"],
  [/^!(?:this\.)?\w+\.(?:isInWater|isUnderWater|isInLava|isInWaterOrBubble)\(\)$/, "不在水里"],
  [/^!(?:this\.)?\w+\.(?:isVehicle|isPassenger|hasControllingPassenger)\(\)$/, "没人骑着"],
  [/^(?:this\.)?\w+\.isAlive\(\)$|^!(?:this\.)?\w+\.(?:isDeadOrDying|isRemoved)\(\)$/, "还活着"],
] as const

/**
 * Advice, never a refusal: goals added over idling (`GOAL_BAND.over_idle`) that hold the body and whose
 * `canUse` waits for nothing. Such a goal is running whenever the creature is not swimming or fighting, so
 * roaming and looking (5 to 7, the same controls) never get a turn. Whether that is a fault depends on what
 * the description promises, which no pattern can read; so the writer is told what it means and the reviewer
 * decides. Read only where it is plain: the goal's class is written in this gameplay, `canUse` is a single
 * `return` of `true` or of conditions from `STANDING` joined by `&&`, and the class names Flag.MOVE or
 * Flag.LOOK. Anything else (a field, a helper, a timer, a random chance) is taken as a real condition.
 */
export function goalAdvice(document: Pick<GameplayDocument, "sources">): GameplayFinding[] {
  const files = document.sources.map((file) => ({ path: file.path, content: file.content, code: stripJava(file.content).code }))
  const block = (code: string, open: number) => code.slice(open + 1, closing(code, open))
  return files.flatMap((file) =>
    [...file.code.matchAll(new RegExp(`(?<![\\w.])${GAMEPLAY_API.content}\\s*\\.\\s*addGoal\\s*\\(([^,]*),\\s*(\\d+)\\s*,([^;]*)\\)\\s*;`, "g"))].flatMap((call): GameplayFinding[] => {
      const priority = Number(call[2])
      const type = /\bnew\s+(\w+)\s*\(/.exec(call[3]!)?.[1] ?? /(\w+)\s*::\s*new\b/.exec(call[3]!)?.[1]
      if (priority < GOAL_BAND.over_idle[0] || priority > GOAL_BAND.over_idle[1] || !type) return []
      const body = files.flatMap((other) => ((found) => (found ? [block(other.code, found.index + found[0].length - 1)] : []))(new RegExp(`\\bclass\\s+${type}\\b[^{]*\\{`).exec(other.code)))[0]
      const start = body === undefined ? null : /\bboolean\s+canUse\s*\(\s*\)\s*\{/.exec(body)
      if (!body || !start) return []
      const returned = /^return(.+);$/.exec(block(body, start.index + start[0].length - 1).replace(/\s+/g, ""))?.[1]
      const waits = returned === "true" ? [] : (returned?.split("&&").map((part) => STANDING.find((known) => known[0].test(part))?.[1]) ?? [undefined])
      const holds = ["MOVE", "LOOK"].filter((control) => new RegExp(`\\bFlag\\s*\\.\\s*${control}\\b`).test(body))
      if (waits.some((words) => !words) || !holds.length) return []
      return [
        {
          rule: "goal_always",
          file: file.path,
          line: lineAt(file.content, call.index),
          message: `${type} 加在优先级 ${priority}、占着 ${holds.join(" 和 ")}，而它的 canUse ${waits.length ? `只看生物自己当下的状态（${[...new Set(waits)].join("、")}）` : "直接回答 true"}，没有任何要等的事：这只生物只要没在游泳、没在打架，它就一直上场，${GOAL_ALWAYS_WORDS.means}。（${READ_FROM_CODE}；只看了 canUse 的写法。）`,
          fix: GOAL_ALWAYS_WORDS.fix,
        },
      ]
    }),
  )
}

/** How code asks "is this an enemy" with the class that only the game's own hostile mobs extend: a test of it, its class as a filter, or it as the type a search or a target goal is given. */
const HOSTILE_CLASS = /\binstanceof\s+(?:final\s+)?(?:[\w.]+\.)?Monster\b|\b(?:[\w.]+\.)?Monster\s*\.\s*class\b|<\s*(?:[\w.]+\.)?Monster\s*>/g

/** What is said of it, for the writer and the reviewer (the sentence for the person is `hostile_missed` in gameplay-plain.ts). */
export const HOSTILE_MISSED = {
  message: (name: string) => `这里用 Monster 类判断“是不是敌人”（或拿它当类型去找、去过滤）：这个工程里的敌对生物（比如「${name}」）不是它的子类，会被漏掉，原版的怪有效，工程自己的怪和 Boss 却不起作用。`,
  fix: "判断敌人改用 instanceof Enemy（net.minecraft.world.entity.monster.Enemy）：原版的怪和这个工程的敌对生物都是它。拿它当类型去找（getEntitiesOfClass、NearestAttackableTargetGoal 的类型）的，改成 LivingEntity 再用 instanceof Enemy 过滤。这里确实只想要原版那几种怪的，改成直接写那几种怪的类（例如 Zombie），并在说明里写明只对它们起作用。",
} as const

/**
 * Advice, never a refusal: code that tells enemies apart with the `Monster` class in a project that has hostile creatures of its own. Those creatures
 * (and every boss) extend the baby's class and carry the game's `Enemy` marker, so such a test passes the game's mobs and none of the project's.
 * Whether it is a fault depends on whom the description means, which no pattern can read (a gameplay may mean vanilla zombies only), so the writer is
 * told and the reviewer reads the description. Told once for each file however often it is written there.
 */
export function hostileAdvice(project: Pick<Project, "entities">, document: Pick<GameplayDocument, "sources">): GameplayFinding[] {
  const own = project.entities.filter((entity) => entity.behavior === "hostile")
  if (!own.length) return []
  return document.sources.flatMap((file): GameplayFinding[] => {
    const found = new RegExp(HOSTILE_CLASS.source).exec(stripJava(file.content).code)
    return found
      ? [{ rule: "hostile_missed", file: file.path, line: lineAt(file.content, found.index), message: `${HOSTILE_MISSED.message(own[0]!.name)}（${READ_FROM_CODE}。）`, fix: HOSTILE_MISSED.fix }]
      : []
  })
}
