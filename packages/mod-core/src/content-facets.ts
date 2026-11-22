/**
 * What a block, an item and a recipe answer to the four playability questions (`playable.ts`): where it comes
 * from, what it is for, what happens when it is touched. Every answer is read from the whole project, never
 * from the one document: an item's source is the recipe, the block or the creature that gives it, wherever
 * that is saved. One answer per way, each naming in `through` the project's own things it goes through, so the
 * standard can tell a chain that starts in the world from one that starts nowhere. No Node APIs.
 */
import type { Block, Item, Recipe } from "./content"
import { MINING_LEVELS, blockShapeWords, RECIPE_KINDS, TIER_RANKS, TOOL_KINDS, contentWords, referenceWords } from "./content-words"
import { BLOCK_SOUNDS, dataWords } from "./data-words"
import { abilityAssets } from "./ability-asset"
import { bossShowSteps } from "./boss-show"
import { READ_FROM_CODE, gameplayPuts, gameplayRecipes, gameplayWorldgen } from "./gameplay-references"
import type { Facet } from "./playable"
import type { Project } from "./project"

type BlockDocument = Omit<Block, "id" | "texture">
type ItemDocument = Omit<Item, "id" | "texture">
type RecipeDocument = Omit<Recipe, "id">

// The standard shows an answer on one line of a card.
const WORDS = 160
const short = (words: string, fallback: string) => (words.length > WORDS ? fallback : words)
const span = (min: number, max: number) => (min === max ? String(min) : `${min}–${max}`)
const percent = (chance: number) => `${Number((chance * 100).toFixed(1))}%`

/** One way a block or item is come by: the answer the standard shows, the records it was read from (paths into the project), and the record itself for whoever words it differently. */
export type SourceWay = { facet: Facet; from: string[] } & (
  | { way: "generation"; generation: NonNullable<Project["blocks"][number]["generation"]> }
  | { way: "recipe"; recipe: Project["recipes"][number] }
  | { way: "mined"; block: Project["blocks"][number] }
  | { way: "loot" | "death_drop" | "boss_show" | "lair"; entity: Project["entities"][number] }
  | { way: "gameplay" }
)

function reader(project: Project) {
  const mod = project.mod_id
  const things = [...project.blocks, ...project.items]
  const name = (identifier: string) => things.find((value) => value.identifier === identifier)?.name ?? null
  const said = (reference: string) => referenceWords(reference, mod, name)
  /** The identifier of a reference to one of this project's own things, else nothing. */
  const own = (reference: string) => (reference.startsWith(`${mod}:`) ? [reference.slice(mod.length + 1)] : [])
  const filled = (recipe: Pick<Recipe, "pattern">) => recipe.pattern.filter((value): value is string => value !== null)
  const station = (recipe: Pick<Recipe, "type">) => RECIPE_KINDS[recipe.type ?? "shaped"].station
  // A use that takes other things of this project besides the thing itself says which, so one nobody can get shows.
  const needs = (recipe: Pick<Recipe, "pattern">, identifier: string) => {
    const others = [...new Set(filled(recipe).flatMap(own))].filter((other) => other !== identifier)
    return others.length ? { through: others } : {}
  }
  // A creature is known to the standard by its saved asset; one made by hand, by its name.
  const creature = (entity: Project["entities"][number]) => project.workspace.assets.find((asset) => asset.document.kind === "entity" && asset.document.model_asset_id === entity.id)?.id ?? entity.name
  const gameplays = (id: string | undefined) => (id ? project.workspace.assets.flatMap((asset) => (asset.document.kind === "gameplay" && asset.document.uses.includes(id) ? [asset.document] : [])) : [])

  /**
   * Every way a survival player comes by the block or item called `identifier`, each with the records it was read from.
   * The one reading of "where it comes from": the standard's answers, reconciliation and the guide's own section all go
   * through it (round 18: the guide counted ways by itself, left a creature's drops out, and said of an item a creature
   * drops that nothing drops it).
   */
  const assetPath = (id: string) => project.workspace.assets.flatMap((asset, index) => (asset.id === id ? [`workspace.assets[${index}]`] : []))
  const ways = (identifier: string): SourceWay[] => [
    ...project.blocks.flatMap((block, index): SourceWay[] => (block.identifier === identifier && block.generation ? [{ way: "generation", generation: block.generation, from: [`blocks[${index}]`], facet: { question: "source", answered: true, words: `${dataWords.generation(block.generation)}`, through: [] } }] : [])),
    ...project.recipes.flatMap((recipe, index): SourceWay[] =>
      recipe.result === `${mod}:${identifier}`
        ? [{ way: "recipe", recipe, from: [`recipes[${index}]`], facet: { question: "source", answered: true, words: short(contentWords.recipe(recipe, said), `在${station(recipe)}按配方「${recipe.name}」做出来`), detail: `recipe ${recipe.id} (${RECIPE_KINDS[recipe.type ?? "shaped"].type})`, through: [...new Set(filled(recipe).flatMap(own))].filter((other) => other !== identifier) } }]
        : [],
    ),
    ...project.blocks.flatMap((block, index): SourceWay[] =>
      block.drop === "item" && block.drop_item?.item === identifier ? [{ way: "mined", block, from: [`blocks[${index}]`], facet: { question: "source", answered: true, words: `挖掉「${block.name}」会掉 ${span(block.drop_item.min, block.drop_item.max)} 个`, through: [block.identifier] } }] : [],
    ),
    ...project.entities.flatMap((entity, index): SourceWay[] => [
      ...(entity.loot ?? [])
        .filter((drop) => drop.item === identifier)
        .map((drop): SourceWay => ({ way: "loot", entity, from: [`entities[${index}]`], facet: { question: "source", answered: true, words: `打败「${entity.name}」${drop.chance < 1 ? `有 ${percent(drop.chance)} 的机会` : "会"}掉 ${span(drop.min, drop.max)} 个${drop.player_only ? "（要玩家亲手打败）" : ""}`, through: [creature(entity)] } })),
      ...(entity.runtime?.death_drop?.block_identifier === identifier ? [{ way: "death_drop" as const, entity, from: [`entities[${index}]`], facet: { question: "source" as const, answered: true, words: `玩家亲手打败「${entity.name}」有 ${percent(entity.runtime.death_drop.chance)} 的机会掉一个`, through: [creature(entity)] } }] : []),
      // A boss puts it in the world itself: a step of its wake-up or its death show sets it down (蚩尤's death grew trees of 赤枫叶 and the build said nothing gives it),
      // or its lair, a structure of the world's own generation, is built of it.
      ...(entity.behavior === "hostile" && entity.boss
        ? [
            ...(["intro", "death"] as const).flatMap((show): SourceWay[] =>
              bossShowSteps(entity.boss).some((entry) => entry.show === show && entry.step.type === "place_structure" && "blocks" in entry.step.structure && entry.step.structure.blocks.some((value) => value.block === identifier))
                ? [{ way: "boss_show", entity, from: [`entities[${index}]`], facet: { question: "source", answered: true, words: show === "death" ? `打败「${entity.name}」后，它的死亡演出会在原地摆下它` : `「${entity.name}」醒来时的登场演出会在原地摆下它`, through: [creature(entity)] } }]
                : [],
            ),
            ...(entity.boss.lair && [...entity.boss.lair.floor, ...(entity.boss.lair.rim ? [entity.boss.lair.rim] : [])].includes(identifier)
              ? [{ way: "lair" as const, entity, from: [`entities[${index}]`], facet: { question: "source" as const, answered: true, words: `「${entity.name}」的巢是用它铺的（巢随世界生成）`, through: [] } }]
              : []),
          ]
        : []),
    ]),
    // K2: gameplay code that places it or hands it out is a way to come by it too. Read off the source by pattern and said so; when and where is the gameplay's own description to say.
    ...gameplayPuts(project, identifier).flatMap((gameplay): SourceWay[] => {
      const from = assetPath(gameplay.id)
      return [
        ...(gameplay.placed ? [{ way: "gameplay" as const, from, facet: { question: "source" as const, answered: true, words: `玩法「${gameplay.title}」的代码会把它放进世界（${READ_FROM_CODE}；什么时候放、放在哪儿，见那个玩法的说明）`, through: [gameplay.id] } }] : []),
        ...(gameplay.given ? [{ way: "gameplay" as const, from, facet: { question: "source" as const, answered: true, words: `玩法「${gameplay.title}」的代码会把它交给玩家或者掉在世界里（${READ_FROM_CODE}；什么时候给，见那个玩法的说明）`, through: [gameplay.id] } }] : []),
      ]
    }),
    // A gameplay's world-generation files, hooked in by its code: a block it plants in the world with no code that calls setBlockState is still put there.
    ...gameplayWorldgen(project, identifier).map((gameplay): SourceWay => ({ way: "gameplay", from: assetPath(gameplay.id), facet: { question: "source", answered: true, words: `玩法「${gameplay.title}」把它加进了世界生成（${READ_FROM_CODE}；在哪些地方、多常见，见那个玩法的说明）`, through: [gameplay.id] } })),
    // A recipe file the gameplay ships itself: its result is this thing, so it is made the way any recipe's result is, from what the file takes.
    ...gameplayRecipes(project, identifier).map((gameplay): SourceWay => ({ way: "gameplay", from: assetPath(gameplay.id), facet: { question: "source", answered: true, words: `玩法「${gameplay.title}」自带一个配方能做出它（数据文件 ${gameplay.path}；Studio 只读了配方的结果和材料，没有试过它在游戏里行不行）`, detail: `gameplay recipe ${gameplay.path}`, through: [...new Set([...gameplay.through, gameplay.id])] } })),
  ]
  const sources = (identifier: string): Facet[] => ways(identifier).map((way) => way.facet)

  /** Every use the block or item called `identifier` has that both kinds share: a material, a fuel, something code builds on. */
  const uses = (kind: "item" | "block", identifier: string, id: string | undefined, fuel: { burn_ticks: number } | null | undefined): Facet[] => [
    ...abilityAssets(project, false).flatMap(({ document }): Facet[] =>
      document.bindings.flatMap((binding): Facet[] => {
        if (binding.type === "item" && kind === "item" && binding.item === identifier)
          return [{ question: "use", answered: true, words: `${binding.use === "hold" ? "按住右键" : "右键"}施放技能「${document.name}」` }]
        if (binding.type === "block" && kind === "block" && binding.block === identifier)
          return [{ question: "use", answered: true, words: `右键这个方块，方块会施放技能「${document.name}」` }]
        return []
      }),
    ),
    ...project.entities.flatMap((entity): Facet[] => {
      const summon = entity.behavior === "hostile" ? entity.boss?.summon : null
      if (!summon) return []
      return [
        ...(summon.item === identifier ? [{ question: "use" as const, answered: true, words: `拿着它右键${summon.block ? said(summon.block) : ""}召唤「${entity.name}」`, through: summon.block && !summon.block.includes(":") ? [summon.block] : [] }] : []),
        ...(kind === "block" && summon.block === identifier ? [{ question: "use" as const, answered: true, words: `是「${entity.name}」的召唤台，拿着${said(summon.item)}右键`, through: summon.item.includes(":") ? [] : [summon.item] }] : []),
      ]
    }),
    ...project.recipes
      .filter((recipe) => filled(recipe).includes(`${mod}:${identifier}`) && recipe.result !== `${mod}:${identifier}`)
      .map((recipe): Facet => ({ question: "use", answered: true, words: `是在${station(recipe)}做${said(recipe.result)}的材料`, detail: `recipe ${recipe.id}`, ...needs(recipe, identifier) })),
    ...project.items.flatMap((item): Facet[] => (item.tool?.repair === `${mod}:${identifier}` || item.armor?.repair === `${mod}:${identifier}` ? [{ question: "use", answered: true, words: `在铁砧上用它修「${item.name}」` }] : [])),
    ...(fuel ? [{ question: "use" as const, answered: true, words: contentWords.fuel(fuel) }] : []),
    ...project.logic.flatMap((rule): Facet[] => {
      const entity = rule.enabled && rule.item === `${mod}:${identifier}` ? project.entities.find((value) => value.id === rule.entity_id) : undefined
      return entity ? [{ question: "use", answered: true, words: `拿着它走近「${entity.name}」，它会${rule.action === "follow" ? "跟过来" : rule.action === "look" ? "看着你" : "做一个动作"}` }] : []
    }),
    // broad10 w2: cheese a mouse follows (its tempt; this project's own things are written bare, as in loot) was called useless, and the person was told to have the AI give it a use.
    ...project.entities.flatMap((entity): Facet[] => (entity.behavior === "follow" && (entity.tempt ?? []).some((lure) => lure === identifier || lure === `${mod}:${identifier}`) ? [{ question: "use", answered: true, words: `拿在手里，「${entity.name}」会跟着你走` }] : [])),
    ...gameplays(id).map((gameplay): Facet => ({ question: "use", answered: true, words: short(`玩法「${gameplay.name}」用到了它：${gameplay.summary}`, `玩法「${gameplay.name}」用到了它`) })),
  ]

  // K2: nothing was read that brings it into the world, yet gameplay code is attached to it: said, so "creative only" is not claimed about code Studio could not follow.
  const unread = (id: string | undefined) => ((titles) => (titles.length ? `；玩法${titles.map((title) => `「${title}」`).join("、")}挂在它上面，但 Studio 没能从代码里读出是不是它把这样东西放进世界或交给玩家，要你自己进游戏看` : ""))(gameplays(id).map((gameplay) => gameplay.name))

  return { mod, said, sources, ways, uses, name, unread }
}

/** Every way a survival player comes by one of the project's blocks or items (see `ways` above), for whoever else has to say where a thing comes from. */
export const sourceWays = (project: Project, identifier: string) => reader(project).ways(identifier)

const id = (project: Project, identifier: string) => [...project.blocks, ...project.items].find((value) => value.identifier === identifier)?.id

export function blockFacets(document: BlockDocument, project: Project): Facet[] {
  const read = reader(project)
  const sources = read.sources(document.identifier)
  const uses: Facet[] = [
    ...(document.drop === "item" && document.drop_item ? [{ question: "use" as const, answered: true, words: `挖掉它能得到「${read.name(document.drop_item.item) ?? document.drop_item.item}」` }] : []),
    ...(document.lucky ? [{ question: "use" as const, answered: true, words: `放下以后右键打开，随机出 ${document.lucky.outcomes.length} 种结果里的一种` }] : []),
    ...read.uses("block", document.identifier, id(project, document.identifier), document.fuel),
    // Slowing, a low jump, sliding and bouncing are what a placed block does to whoever stands on it.
    ...(contentWords.standing(document) ? [{ question: "use" as const, answered: true, words: contentWords.standing(document) }] : []),
    // Light is something a placed block does for the player by itself.
    ...(document.luminance > 0 ? [{ question: "use" as const, answered: true, words: `会发光（亮度 ${document.luminance}，最亮是 15），摆出来能照明` }] : []),
    // broad3: every block can be put down and built with; that is what a block is for in Minecraft (see PLAY_QUESTIONS.use).
    ...(document.shape
      ? [{ question: "use" as const, answered: true, words: `${blockShapeWords(document.shape)}，${document.shape.collision === "shape" ? "碰撞和选中框也是这些盒子" : "碰撞和整块一样"}；能放下来当摆设` }]
      : [{ question: "use" as const, answered: true, words: "能放下来盖房子、铺地或者当摆设" }]),
  ]
  // Mining it with a tool of this project is part of what happens when it is touched.
  const diggers = document.tool === "none" ? [] : project.items.filter((item) => item.tool && TOOL_KINDS[item.tool.kind].mines === document.tool && MINING_LEVELS[item.tool.mining_level].rank >= (document.tool_tier ? TIER_RANKS[document.tool_tier] : 0))
  return [
    ...(sources.length ? sources : [{ question: "source" as const, answered: false, words: `不会在世界里生成，没有配方，也没有方块或生物掉它：只能在创造模式物品栏里拿到${read.unread(id(project, document.identifier))}` }]),
    ...uses,
    {
      question: "reaction",
      answered: true,
      words: short(
        [
          document.tool_tier && document.tool !== "none" ? dataWords.tier(document.tool_tier, document.tool) : dataWords.breaks(document),
          ...(diggers.length ? [`本模组的${diggers.map((item) => `「${item.name}」`).join("、")}挖得动`] : []),
          document.drop === "item" && document.drop_item ? dataWords.drop(document.drop_item, (identifier) => read.name(identifier) ?? identifier) : document.drop === "self" ? "挖掉会掉它自己" : "挖掉什么都不掉",
          ...(document.experience ? [dataWords.experience(document.experience)] : []),
          ...(document.sound ? [`是${BLOCK_SOUNDS[document.sound]}的声音`] : []),
        ].join("；"),
        `${dataWords.breaks(document)}；${document.drop === "none" ? "挖掉什么都不掉" : "挖掉会掉东西"}`,
      ),
      detail: `hardness ${document.hardness}, tool ${document.tool}${document.tool_tier ? ` (${document.tool_tier})` : ""}, drop ${document.drop}`,
    },
  ]
}

export function itemFacets(document: ItemDocument, project: Project): Facet[] {
  const read = reader(project)
  const sources = read.sources(document.identifier)
  // Which of this project's blocks ask for exactly this kind of tool, and whether it is good enough for each.
  const digs = document.tool ? project.blocks.filter((block) => block.tool !== "none" && TOOL_KINDS[document.tool!.kind].mines === block.tool && MINING_LEVELS[document.tool!.mining_level].rank >= (block.tool_tier ? TIER_RANKS[block.tool_tier] : 0)) : []
  const uses: Facet[] = [
    ...(document.tool ? [{ question: "use" as const, answered: true, words: short(`${contentWords.tool(document.tool, read.said)}${digs.length ? `；挖得动本模组的${digs.map((block) => `「${block.name}」`).join("、")}` : ""}`, contentWords.tool(document.tool, read.said)), detail: `${TOOL_KINDS[document.tool.kind].java}, #minecraft:${TOOL_KINDS[document.tool.kind].tag}` }] : []),
    ...(document.food ? [{ question: "use" as const, answered: true, words: contentWords.food(document.food) }] : []),
    ...(document.armor ? [{ question: "use" as const, answered: true, words: contentWords.armor(document.armor, read.said) }] : []),
    ...read.uses("item", document.identifier, id(project, document.identifier), document.fuel),
  ]
  return [
    ...(sources.length ? sources : [{ question: "source" as const, answered: false, words: `没有配方，也没有方块或生物掉它：只能在创造模式物品栏里拿到${read.unread(id(project, document.identifier))}` }]),
    ...(uses.length ? uses : [{ question: "use" as const, answered: false, words: "还没有任何用处：没有读到配方、装备、技能、召唤或其他玩法用处" }]),
  ]
}

/** A recipe is a connection, not a thing: it says what it takes and what comes out, for whoever draws the chain. */
export function recipeFacets(document: RecipeDocument, project: Project): Facet[] {
  const read = reader(project)
  const own = (reference: string) => (reference.startsWith(`${read.mod}:`) ? [reference.slice(read.mod.length + 1)] : [])
  return [
    { question: "source", answered: true, words: short(contentWords.recipe(document, read.said), `在${RECIPE_KINDS[document.type ?? "shaped"].station}按配方「${document.name}」做${read.said(document.result)}`), detail: RECIPE_KINDS[document.type ?? "shaped"].type, through: [...new Set(document.pattern.filter((value): value is string => value !== null).flatMap(own))] },
    { question: "use", answered: true, words: `做出来的是${read.said(document.result)}`, through: own(document.result) },
  ]
}
