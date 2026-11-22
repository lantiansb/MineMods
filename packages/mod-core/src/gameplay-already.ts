import { VANILLA_ITEM_NAMES } from "./fabric/content-vanilla"
import { BLOCK_STANDING, FOOD_EFFECTS, TOOL_KINDS } from "./content-words"
import { creatureName, gameplayThings, type GameplayFinding, type GameplayThing } from "./gameplay"
import { accessorCalls } from "./gameplay-references"
import { stripJava } from "./gameplay-scan"
import type { Project } from "./project"

/**
 * What already acts on a thing of the project, and who does it: the thing itself (a block that throws up whoever steps on it, a creature that roams and follows
 * whoever holds wheat) and every other gameplay that lists it. One list for everyone who works on a gameplay, so none has to guess what the others did:
 * the AI that writes the description, the one that writes the code, and the one that reviews them (broad22-api-r5: two gameplays on one hen each registered
 * a laying timer, and each wrote the jelly's bounce that the block already had; each was reviewed on its own description and code, and neither saw the other).
 * Every line is read from a document of the project, never remembered. No Node APIs: the acceptance card recomputes the notices below in the app's window.
 */

/** One thing that is already done to a thing, and by whom: "它自己", or "玩法「名字」". */
export type Already = { by: string; does: string }

/** What another gameplay says of itself: its description, which is all its neighbours may rely on. */
export type OtherGameplay = {
  asset_id: string
  name: string
  summary: string
  behaviours: readonly { when: string; does: string }[]
  uses: readonly string[]
}

/** Who a line is about when it is the thing's own. */
export const BY_ITSELF = "它自己"
const byGameplay = (name: string) => `玩法「${name}」`

const named = (project: Project, reference: string) => {
  const [space, name] = reference.includes(":") ? (reference.split(":") as [string, string]) : [project.mod_id, reference]
  return space === "minecraft" ? (VANILLA_ITEM_NAMES[name] ?? reference) : ([...project.items, ...project.blocks].find((value) => value.identifier === name)?.name ?? reference)
}
const percent = (share: number) => `${Number((share * 100).toFixed(1))}%`

function creatureLines(project: Project, entity: Project["entities"][number]): string[] {
  const lure = entity.tempt?.length ? entity.tempt.map((item) => `「${named(project, item)}」`).join("或") : "小麦"
  const fights =
    entity.behavior === "hostile"
      ? `会打人：${entity.engagement === "provoked" ? "只打刚打了它的" : entity.engagement === "none_by_itself" ? "自己不找目标，只打玩法代码给它的目标" : "自己找最近的、看得见的玩家打"}`
      : entity.behavior === "follow"
        ? `不会打人，也不会去追谁（给它定打谁的规则或目标没有用）；会跟着手里拿着${lure}的玩家走`
        : "不会打人，也不会去追谁（给它定打谁的规则或目标没有用）"
  const drops = (entity.loot ?? []).map((drop) => `${drop.chance < 1 ? `${percent(drop.chance)} 的机会掉 ` : ""}${drop.min === drop.max ? drop.max : `${drop.min}–${drop.max}`} 个「${named(project, drop.item)}」`)
  return [
    entity.stationary ? `站着不走动（${entity.stationary.reason}）` : "没事的时候自己闲逛、张望、看向走近的玩家，掉进水里会游泳",
    fights,
    ...(entity.abilities?.length ? [`有招式「${entity.abilities.map((ability) => ability.name).join("」「")}」：动作、蓄力、判定和冷却都是它自己的设定，玩法不用也不能替它做`] : []),
    ...(entity.flight ? ["会飞：起飞、落地和飞行都是它自己的设定"] : []),
    ...(entity.habits ? ["按自己的习性活动：休息、回窝、捕猎、警觉都是它自己的设定"] : []),
    ...(entity.boss ? ["是 Boss：血条、登场、阶段和死亡演出都是它自己的设定"] : []),
    ...(drops.length ? [`被打败掉：${drops.join("；")}${entity.experience ? `；给 ${entity.experience} 点经验` : ""}`] : entity.experience ? [`被打败给 ${entity.experience} 点经验`] : []),
  ]
}

function blockLines(block: Project["blocks"][number]): string[] {
  const { launch, bounce, movement } = block
  return [
    ...(launch ? [`${BLOCK_STANDING.launch.what}：${BLOCK_STANDING.launch.only}，把活着的东西往上弹约 ${launch} 格高；潜行的人不弹`] : []),
    ...(bounce ? [`${BLOCK_STANDING.bounce.what}：${BLOCK_STANDING.bounce.only}，把落下的速度还回去 ${percent(bounce)}；潜行落上去不反弹`] : []),
    ...(movement ? [`${BLOCK_STANDING.movement.what}：走路速度 ×${movement.speed}、起跳 ×${movement.jump}、滑度 ${movement.slip}（平常的方块是 1、1、0.6）`] : []),
    ...(block.drop === "none" ? ["挖掉什么都不掉"] : block.drop === "item" ? ["挖掉掉的是方块文档里写的那样东西"] : []),
  ]
}

function itemLines(item: Project["items"][number]): string[] {
  const food = item.food
  const effects = (food?.effects ?? []).map((effect) => FOOD_EFFECTS[effect.effect].name)
  return [
    ...(food ? [`${food.drink ? "喝" : "吃"}下去补 ${food.hunger} 点饥饿${effects.length ? `，带状态效果：${effects.join("、")}` : ""}`] : []),
    ...(item.tool ? [`是${TOOL_KINDS[item.tool.kind].name}，挖得动的等级、耐久和伤害都是它自己的设定`] : []),
    ...(item.fuel ? ["能当燃料烧"] : []),
  ]
}

/** What the thing is, by its own settings. Empty for a thing that does nothing by itself (and for a kind that has no settings of this sort). */
export function selfAlready(project: Project, thing: GameplayThing): Already[] {
  const lines =
    thing.kind === "creature"
      ? ((entity) => (entity ? creatureLines(project, entity) : []))(project.entities.find((value) => creatureName(value) === thing.registry))
      : thing.kind === "block"
        ? ((block) => (block ? blockLines(block) : []))(project.blocks.find((value) => value.id === thing.asset_id))
        : thing.kind === "item"
          ? ((item) => (item ? itemLines(item) : []))(project.items.find((value) => value.id === thing.asset_id))
          : []
  return lines.map((does) => ({ by: BY_ITSELF, does }))
}

const sameThing = (left: GameplayThing, right: GameplayThing) => left.asset_id === right.asset_id || (left.kind === "creature" && right.kind === "creature" && left.registry !== null && left.registry === right.registry)

/** What the other gameplays that list this thing say they do to it. */
export function othersAlready(thing: GameplayThing, all: readonly GameplayThing[], others: readonly OtherGameplay[]): Already[] {
  return others
    .filter((other) => other.uses.some((id) => all.some((value) => value.asset_id === id && sameThing(value, thing))))
    .map((other) => ({ by: byGameplay(other.name), does: `${other.summary}${other.behaviours.length ? `（${other.behaviours.map((behaviour) => `${behaviour.when}，${behaviour.does}`).join("；")}）` : ""}` }))
}

/** The gameplays saved in the project, other than `except`, as their descriptions say. */
export function savedGameplays(project: Project, except: string | null): OtherGameplay[] {
  return project.workspace.assets.flatMap((asset) => {
    const document = asset.document
    if (document.kind !== "gameplay" || asset.id === except) return []
    return [{ asset_id: asset.id, name: document.name, summary: document.summary, behaviours: document.behaviours, uses: document.uses }]
  })
}

/** What already acts on each of the things a gameplay lists (or, for a writer, on every thing): one entry for a thing that has anything, a creature once however many ids read it. */
export function alreadyOnThings(project: Project, ids: readonly string[] | null, others: readonly OtherGameplay[], except: string | null) {
  const all = gameplayThings(project).filter((thing) => thing.asset_id !== except)
  return all
    .filter((thing) => thing.alias_of === null && (ids === null || ids.some((id) => all.some((value) => value.asset_id === id && sameThing(value, thing)))))
    .flatMap((thing) => {
      const already = [...selfAlready(project, thing), ...othersAlready(thing, all, others)]
      return already.length ? [{ thing, already }] : []
    })
}

/** The same for a reviewer: by the thing's name and kind, which is how the description names it. */
export const alreadyForReview = (project: Project, uses: readonly string[], others: readonly OtherGameplay[], except: string | null) =>
  alreadyOnThings(project, uses, others, except).map(({ thing, already }) => ({ thing: thing.title, already }))

/**
 * Notices (never refusals) for the two ways one thing is done twice that can be read off the code without guessing what the code means: a second gameplay that
 * also adds behaviour to the same creature, and code that sets the speed of what it meets while the block it lists already throws that up by itself. They name no
 * code. The description of the other gameplay is the writer's and the reviewer's to compare; what these say is only that there is something to compare.
 */
export function overlapAdvice(project: Project, document: { sources: readonly { path: string; content: string }[]; uses: readonly string[] }, assetId: string | null): GameplayFinding[] {
  const things = gameplayThings(project)
  const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length
  const creatureOf = (name: string | undefined) => (name === undefined ? undefined : things.find((value) => value.kind === "creature" && value.key === name))
  const mine = document.sources.flatMap((file) => accessorCalls(file.content).filter((call) => call.method === "addGoal").map((call) => ({ file: file.path, line: lineAt(file.content, call.index), thing: creatureOf(call.name) })))
  // The creatures each other gameplay adds behaviour to, by their names in the game's registry (a creature is one whichever of its ids names it).
  const others = project.workspace.assets.flatMap((asset) =>
    asset.document.kind === "gameplay" && asset.id !== assetId
      ? [{ name: asset.document.name, registries: new Set((asset.document as unknown as { sources: { content: string }[] }).sources.flatMap((file) => accessorCalls(file.content).filter((call) => call.method === "addGoal").flatMap((call) => creatureOf(call.name)?.registry ?? []))) }]
      : [],
  )
  const goals = mine.flatMap((call): GameplayFinding[] => {
    const thing = call.thing
    if (!thing) return []
    const twin = others.find((other) => thing.registry !== null && other.registries.has(thing.registry))
    return twin
      ? [
          {
            rule: "goal_twice",
            file: call.file,
            line: call.line,
            message: `玩法「${twin.name}」也给「${thing.title}」加了行为：两个玩法各加的行为会同时挂在这只生物身上，各做各的。`,
            fix: `对照玩法「${twin.name}」的说明：做的是同一件事（比如都按时间做同一个动作），就只留一处来做，另一处去掉；做的是不同的事，就不用管。`,
          },
        ]
      : []
  })
  const throwing = document.uses.flatMap((id) => project.blocks.filter((block) => block.id === id && (block.launch || block.bounce)))
  const speeds = document.sources.flatMap((file) => [...stripJava(file.content).code.matchAll(/\.\s*(?:setDeltaMovement|addDeltaMovement|push)\s*\(|\bhurtMarked\b/g)].map((found) => ({ file: file.path, line: lineAt(file.content, found.index) })))
  const velocity = throwing.length && speeds.length
    ? [
        {
          rule: "velocity_twice",
          file: speeds[0]!.file,
          line: speeds[0]!.line,
          message: `这个玩法挂着「${throwing[0]!.name}」，它自己已经会把${throwing[0]!.launch ? "踩上去" : "落上去"}的东西弹起来（潜行的人不弹），而代码里又有直接改东西速度的写法。`,
          fix: "如果代码是在做同一件事，就是重复，而且潜行时也会被弹；说明里没有这一条就去掉它，让方块自己来。不是同一件事，就不用管。",
        },
      ]
    : []
  return [...goals, ...velocity]
}
