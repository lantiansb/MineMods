import { creatureWords } from "./creature-life"
import { TOOL_KINDS } from "./content-words"
import { dataWords } from "./data-words"
import { CREATIVE_TAKE_WORDS, NEW_WORLD_WORDS, creatureName } from "./gameplay"
import { command } from "./play-words"
import type { Project } from "./project"

/**
 * 「进游戏自己找到你做的东西」: what a person does to see their things when nobody has set a test world out for them: they declined the
 * game's licence (so there is no background-made test world) and the game opens on its main menu, or they simply play in a world of their own.
 * Written from the project alone and in the order a person does it: make a creative world, find what can be held, find what is a creature,
 * find what turns up by itself. Where the mod puts a thing is read from the same facts the build uses (`content.ts` and `fabric/content-items.ts`
 * put blocks, items and spawn eggs into the game's own tabs; the mod has no tab of its own, and that is said so nobody looks for one).
 * A command comes last and only as a line to paste. No Node APIs.
 */
export type HandLine = { text: string; from: string[] }

/** The creative tab each kind of thing is put into, by the name the Chinese game shows. */
export const TAB_NAMES = { BUILDING_BLOCKS: "建筑方块", INGREDIENTS: "原材料", TOOLS: "工具与实用物品", COMBAT: "战斗用品", FOOD_AND_DRINK: "食物与饮品", SPAWN_EGGS: "刷怪蛋" } as const

/** Which tab an item is in: what `content-items.ts` registers it under (tools by their kind, food, everything else with the ingredients). */
export const itemTab = (item: Pick<Project["items"][number], "tool" | "food">): (typeof TAB_NAMES)[keyof typeof TAB_NAMES] =>
  item.tool ? TAB_NAMES[TOOL_KINDS[item.tool.kind].tab] : item.food ? TAB_NAMES.FOOD_AND_DRINK : TAB_NAMES.INGREDIENTS

/** The names of the game's own screens and buttons that the steps put between 「」: they are the game's words, not names from the project. */
export const GAME_WORDS: readonly string[] = ["单人游戏", "创建新的世界", "创造", "允许作弊", "搜索物品", ...Object.values(TAB_NAMES)]

const quoted = (names: readonly string[]) => names.map((name) => `「${name}」`).join("、")

export function byHandLines(project: Project): HandLine[] {
  const mod = project.mod_id
  const holdable = [...project.blocks.map((value, index) => ({ name: value.name, tab: TAB_NAMES.BUILDING_BLOCKS as string, path: `blocks[${index}]`, id: `${mod}:${value.identifier}` })), ...project.items.map((value, index) => ({ name: value.name, tab: itemTab(value) as string, path: `items[${index}]`, id: `${mod}:${value.identifier}` }))]
  const creatures = project.entities.filter((entity) => entity.model_asset_id !== null).map((entity) => ({ entity, path: `entities[${project.entities.indexOf(entity)}]` }))
  const gameplays = project.workspace.assets.flatMap((asset, index) => (asset.document.kind === "gameplay" ? [{ name: String(asset.document.name), path: `workspace.assets[${index}]` }] : []))
  if (!holdable.length && !creatures.length && !gameplays.length) return []
  const tabs = [...new Set(holdable.map((entry) => entry.tab))]
  const lines: HandLine[] = [
    { text: `先进一个创造模式的世界：${NEW_WORLD_WORDS}。进去以后连按两下空格就能飞起来，在创造模式里不会被打死。`, from: ["mod_id"] },
  ]
  if (holdable.length) {
    lines.push({
      text: `找到做出来的方块和物品：按 E 打开物品栏。Studio 做的东西放在游戏自带的页签里，没有一个单独的模组页签。最省事的是点「搜索物品」页签，输入它的名字（游戏不是中文的话，输入它的英文名），${CREATIVE_TAKE_WORDS}。`,
      from: holdable.map((entry) => entry.path),
    })
    tabs.forEach((tab) => {
      const here = holdable.filter((entry) => entry.tab === tab)
      lines.push({ text: `在「${tab}」页签里能找到：${quoted(here.map((entry) => entry.name))}。`, from: here.map((entry) => entry.path) })
    })
  }
  if (creatures.length) {
    lines.push({
      text: `放出做出来的生物：按 E 打开物品栏，点「${TAB_NAMES.SPAWN_EGGS}」页签，每个生物有一枚蛋（${quoted(creatures.map(({ entity }) => `${entity.name}刷怪蛋`))}）；${CREATIVE_TAKE_WORDS}，选中那一格后对着地面右键，生物就出现在那里。`,
      from: creatures.map((entry) => entry.path),
    })
    creatures.forEach(({ entity, path }) => {
      const lair = creatureWords.lair(project, entity, entity.id)
      const spawn = entity.runtime?.spawn
      if (spawn) lines.push({ text: `「${entity.name}」不用蛋也行，它${creatureWords.spawn(spawn, entity.behavior)}。新建的世界里到那样的地方走走、飞着找；已经走过的地方不会再多出来。`, from: [path] })
      if (lair) lines.push({ text: `「${entity.name}」：${lair}。`, from: [path, "mod_id"] })
    })
  }
  project.blocks.forEach((block, index) => {
    if (block.generation) lines.push({ text: `「${block.name}」会自己长在世界里，不用拿：${dataWords.generation(block.generation)}。只有新生成的地方才有，所以要在新建的世界里找；按 F3 能看到自己所在的高度（Y 那一项）。`, from: [`blocks[${index}]`] })
  })
  if (gameplays.length)
    lines.push({
      text: `玩法${quoted(gameplays.map((gameplay) => gameplay.name))}：先把它用到的东西拿到手，再照说明里它那一节的“试第 N 条”一条一条做。`,
      from: gameplays.map((gameplay) => gameplay.path),
    })
  // The one command the whole page has when there is nothing else to type: to put an item or a creature in front of you without the inventory.
  const first = holdable[0]
  const egg = creatures[0]
  if (first || egg)
    lines.push({
      text: `嫌翻物品栏麻烦的话，也可以用命令（世界要开着“允许作弊”）。每一条都是：按 T 打开聊天框，粘贴，再按回车。${[...(first ? [`${command(`/give @s ${first.id}`)}，给你一个「${first.name}」`] : []), ...(egg ? [`${command(`/summon ${mod}:${creatureName(egg.entity)}`)}，在你面前放出「${egg.entity.name}」`] : [])].join("；")}。`,
      from: [...(first ? [first.path] : []), ...(egg ? [egg.path] : []), "mod_id"],
    })
  return lines
}
