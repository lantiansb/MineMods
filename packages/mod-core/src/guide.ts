import { BUILTIN_LABELS, builtinUses } from "./builtin-names"
import { emitterWhen, resolveParticle, particleLabel, type ParticleRef } from "./particle-emission"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { abilityAssetNames, abilityAssets, abilityAssetLines, withSharedAbilities } from "./ability-asset"
import { creatureTier, particleReport } from "./combat-particles"
import { bossShowSteps } from "./boss-show"
import { blueprintEntryMade } from "./blueprint"
import { isSoundAsset, soundLookup, soundWords, soundUses } from "./sound"
import { BLOCK_SOUNDS, SOUND_MOMENTS, dataWords, type SoundMoment } from "./data-words"
import { sourceWays } from "./content-facets"
import { ITEM_RARITIES, blockShapeWords, contentWords, referenceWords } from "./content-words"
import { targetWords } from "./target/words"
import { creatureName, gameplayThings, gameplayTryList } from "./gameplay"
import { AI_CODE_MARK, PLAYTEST_WORDS } from "./gameplay-words"
import { gameplayBySlug, gameplayHolds } from "./gameplay-references"
import { motionName } from "@minemods/studio-ai/making"
import type { Project } from "./project"
import { jarName } from "./release"
import { findingText, mayBePlayedByGameplay, playedAnimations, type Finding } from "./reconcile"
import { bossSummonWay, ENGAGEMENT_WORDS, creatureWords, projectStructureWords } from "./creature-life"
import { playability, projectThings, walkLines } from "./playable"
import { bossOpeningTicks, bossWords, felt } from "./creature-boss"
import { fixtureWords, moveAimsAtFixture } from "./fixture-events"
import { arenaWords } from "./arena"
import { combatGuide } from "./combat"
import { stanceWords } from "./stances"
import { abilityWords } from "./creature-abilities"
import { BOSS_LIMITS, bossPhaseIds, type BossPhaseRule } from "./boss-words"
import { flightFight, flightLands, flightWords, habitsWords } from "./creature-flight"
import { creatureEntry, roamOf } from "./scene"
import { VANILLA_PREY } from "./flight-words"
import { byHandLines } from "./play-by-hand"
import { ABILITY_SOUNDS } from "./ability-words"
import { hasHitboxCombat } from "./hitbox-combat"
import { TRIGGER_WORDS, command, handoutWords, plainFix, typeIn } from "./play-words"

/**
 * The mod guide (模组说明书): what is in a mod and how a player meets it, written from the project's own
 * data and from nothing else. There is no sentence here that is true of "a mod like this": every line names
 * the records it was read from (`from`, paths into the project and the build profile), a thing the project
 * does not have gets no line, and a test holds every number and every quoted name to those records.
 */
export type GuideLine = { text: string; from: string[] }
/** `creature` is set on a section about one creature: the id its model can be exported by. */
export type GuideSection = { title: string; lines: GuideLine[]; creature?: string }
export type ModGuide = { title: string; sections: GuideSection[]; markdown: string }

export const guidePose = (design?: Pick<ModelDesign, "follow" | "foot_placement">) => ({
  hangs: Boolean(design?.follow?.some((entry) => entry.mode === "hang")),
  feet: Boolean(design?.foot_placement),
})

export type GuideFacts = {
  /** What machine reconciliation found. The guide shows warnings about what the build does. */
  findings: readonly Finding[]
  /** Animation names of each creature's compiled model, by creature id. */
  animations: Readonly<Record<string, readonly string[]>>
  /** The pose features of the saved models, including models saved before workspace documents. */
  poses?: Readonly<Record<string, ReturnType<typeof guidePose>>>
  /** Creatures whose glow texels are drawn at full brightness in this build. */
  glowing: readonly string[]
  /** True when this guide is written beside a jar that was just built. */
  built: boolean
  /** Set with `built: false` when a build did finish earlier and the project was saved again after it: the jar is of an older version. */
  changed?: boolean
}

/** The one sentence about packaging, by what is known of the project's builds. */
export const BUILT_WORDS = {
  built: "打包时 Studio 核对过它能编译、名字和引用对得上；没有人替你启动游戏试玩过，好不好玩、对不对要你自己进游戏看。",
  changed: "这份说明是按工程现在的内容写的。模组打包过，可是打包以后工程又改过，jar 里的还是改之前的样子；重新打包以后 jar 旁边会有和这份一样的说明。",
  never: "这份说明是按工程现在的内容写的，模组还没有打包；打包以后 jar 旁边会有同样的一份。",
} as const

export const GUIDE_FILE = "模组说明.md"

const hearts = (points: number) => `${Number((points / 2).toFixed(1))} 颗心`
const seconds = (ticks: number) => `${Number((ticks / 20).toFixed(1))} 秒`
const span = (min: number, max: number) => (min === max ? String(min) : `${min}–${max}`)
const MOODS = { passive: "不会主动攻击玩家", hostile: "看见生存模式的玩家就会追上来攻击" } as const
const MOVES = { direct: "直直地走过来", stalk: "慢慢跟近，到两格左右停下", burst: "走一段、冲一段", strafe: "绕着玩家横着走", leap: "靠近以后扑过来", retreat: "被打以后先往后退" } as const
const EFFECTS: Record<string, string> = { slowness: "变慢", blindness: "看不清", poison: "中毒", weakness: "变虚弱" }

/**
 * How a creature treats players, in one phrase. broad7 w2: a hostile creature told to fight only whoever hit it (engagement provoked) was
 * said both to chase every survival player and to fight only back; what decides is its engagement, said in its own words.
 */
export const mood = (
  project: Pick<Project, "blocks" | "items">,
  entity: {
    behavior: keyof typeof MOODS | "follow"
    engagement?: keyof typeof ENGAGEMENT_WORDS | null
    tempt?: readonly string[] | null
    habits?: { alert?: { distance: number; attack_distance?: number | undefined } | null | undefined } | null
    boss?: { intro?: { wake_distance: number } | null | undefined } | null
  },
) => {
  if (entity.behavior === "follow") return creatureWords.lure(entity.tempt, project)
  const fights = entity.behavior === "hostile" && entity.engagement ? ENGAGEMENT_WORDS[entity.engagement] : MOODS[entity.behavior]
  if (entity.behavior !== "hostile") return fights
  // broad9 w4b: a wolf that growls first and a boss that sleeps until somebody comes near were both summed up as "goes for any player it
  // sees", which the person then saw it not do. What it does before it fights comes first, from the same numbers the game uses.
  const alert = entity.habits?.alert
  const wake = entity.boss?.intro?.wake_distance
  const before = [
    ...(wake !== undefined
      ? [entity.habits ? `平时照自己的习性活动（还没见过谁，不挑人打；习性说休息的时候睡着），有人走到 ${wake} 格以内才醒，醒了以后` : `平时睡着，有人走到 ${wake} 格以内才醒，醒了以后`]
      : []),
    ...(alert?.attack_distance !== undefined ? [`玩家走到 ${alert.distance} 格以内先警告，靠到 ${alert.attack_distance} 格以内才扑上来；扑上来以后`] : []),
  ]
  return before.length ? `${before.join("")}${fights}` : fights
}

/**
 * broad7 w2: a creature whose model the blueprint's making had saved, before the creature itself was made, stood in the guide with the
 * placeholder numbers a model is saved with (20 life, passive), read as the creature's rules. It is one the confirmed blueprint plans a
 * creature for, through its model's entry, and whose creature entry has not been made yet.
 */
const unmade = (project: Project, id: string) => {
  const entries = project.blueprint?.state === "confirmed" ? project.blueprint.entries : []
  const model = entries.find((entry) => entry.kind === "model" && entry.asset_id === id)
  const owner = model?.owner ? entries.find((entry) => entry.key === model.owner && entry.kind === "entity") : undefined
  return !!owner && !owner.asset_id
}

/** The moves a boss may start in a stage of its fight: stage 0 is before any line, stage n is its n-th phase (the rule BOSS_INSTRUCTIONS gives, `bossPhaseIds`). `abilities`: its abilities and combos. */
function stageMoves(boss: { phases: readonly BossPhaseRule[] }, abilities: readonly { id: string }[], stage: number) {
  return bossPhaseIds(boss.phases, abilities.map((ability) => ability.id))[stage]!
}
const sameMoves = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id))

export function modGuide(given: Project, facts: GuideFacts): ModGuide {
  const project = withSharedAbilities(given)
  const readSound = soundLookup(project)
  const sounds = (id: string) => {
    const found = readSound(id)
    if (!found || found.title !== found.document.name) return found
    const position = project.workspace.assets.filter((asset) => asset.module === "sound").findIndex((asset) => asset.id === id)
    return { ...found, title: found.document.subtitle?.zh ?? `工程音效 ${position + 1}` }
  }
  // The facts of the game, loader and libraries the mod is built for, read off its primary target's manifest.
  const game = targetWords(project.target)
  const mod = project.mod_id
  // Whatever has an identifier is called by its name; a vanilla thing keeps its id, which is what the game shows in commands.
  const named = (reference: string) => {
    const identifier = reference.includes(":") ? reference.split(":")[1]! : reference
    if (reference.includes(":") && reference.split(":")[0] !== mod) return reference
    return [...project.blocks, ...project.items].find((value) => value.identifier === identifier)?.name ?? identifier
  }
  // This mod's things are said by name in 「」; a vanilla thing is said as what it is, by the id the game knows it by.
  const said = (reference: string): string => (reference.startsWith("#") ? plainly(reference) : reference.includes(":") && reference.split(":")[0] !== mod ? `原版的${plainly(reference)}` : `「${named(reference)}」`)
  // The same, with a vanilla item by its Chinese name and a tag as 「任意木板」: how the newer recipe kinds and item natures are said.
  const plainly = (reference: string): string => referenceWords(reference, mod, (identifier) => [...project.blocks, ...project.items].find((value) => value.identifier === identifier)?.name ?? null)
  /** Where the record of a named block or item is, so a sentence that says its name points at it. */
  const where = (reference: string) => {
    const identifier = reference.includes(":") ? reference.split(":")[1]! : reference
    if (reference.includes(":") && reference.split(":")[0] !== mod) return []
    return [...project.blocks.flatMap((value, index) => (value.identifier === identifier ? [`blocks[${index}]`] : [])), ...project.items.flatMap((value, index) => (value.identifier === identifier ? [`items[${index}]`] : []))]
  }
  /** The same for anything an asset id stands for: content, a creature, or a workspace asset. */
  const whereAsset = (id: string) => [
    ...project.blocks.flatMap((value, index) => (value.id === id ? [`blocks[${index}]`] : [])),
    ...project.items.flatMap((value, index) => (value.id === id ? [`items[${index}]`] : [])),
    ...project.entities.flatMap((value, index) => (value.id === id ? [`entities[${index}]`] : [])),
    ...project.workspace.assets.flatMap((value, index) => (value.id === id ? [`workspace.assets[${index}]`, ...(value.document.kind === "entity" ? project.entities.flatMap((entity, entityIndex) => (value.document.kind === "entity" && entity.id === value.document.model_asset_id ? [`entities[${entityIndex}]`] : [])) : [])] : [])),
  ]
  const gestures = project.workspace.assets.flatMap((asset, index) => (asset.document.kind === "gesture" ? [{ asset, document: asset.document, path: `workspace.assets[${index}]` }] : []))
  const titles = (id: string) => project.workspace.assets.find(a => a.id === id && a.document.kind === "particle")?.title ?? null
  const particleLines: GuideLine[] = project.workspace.assets.flatMap((a, index) => a.document.kind === "particle" ? [{ text: `「${a.title}」每颗持续 ${a.document.lifetime} 秒，颜色从 ${a.document.color.start} 变为 ${a.document.color.end}。`, from: [`workspace.assets[${index}]`] }] : [])
  project.entities.forEach((entity, i) => {
    const add = (ref: ParticleRef | undefined, text: string) => {
      if (!ref) return
      const found = resolveParticle(ref, entity.particles)
      particleLines.push({ text: `「${entity.name}」${text}冒出${particleLabel(ref, { title: titles, aliases: entity.particles })}。`, from: [`entities[${i}]`, ...(typeof found === "object" ? whereAsset(found.asset) : [])] })
    }
    for (const use of builtinUses(entity.builtin)) {
      const moment = BUILTIN_LABELS[use.key]
      const when = moment.endsWith("时") ? moment : moment + "时"
      if(use.effect) particleLines.push({text:`「${entity.name}」在${moment}显示「${project.workspace.assets.find(a=>a.id===use.effect)?.title ?? use.effect}」。`,from:[`entities[${i}]`,...whereAsset(use.effect)]})
      if(use.particle==="none") particleLines.push({text:`「${entity.name}」在${when}关闭了自带粒子。`,from:[`entities[${i}]`]})
      else add(use.particle, `在${when}`)
      if(use.sound==="none") particleLines.push({text:`「${entity.name}」在${moment}时不响。`,from:[`entities[${i}]`]})
      else if (use.sound) {
        const ref = use.sound
        const sound = typeof ref === "string" ? ref : project.workspace.assets.find(a => a.id === ref.asset)?.title ?? ref.asset
        particleLines.push({text:`「${entity.name}」在${moment}时播放「${sound}」。`,from:[`entities[${i}]`,...(typeof ref === "string" ? [] : whereAsset(ref.asset))]})
      }
    }
    entity.abilities?.forEach(a => {
      for (const e of a.events) {
        const at = `「${entity.name}」在「${a.name}」第 ${e.at} 秒`
        if (e.type === "flash") particleLines.push({text:`${at}出现${{arc:"弧形刀光",ring:"光环",glint:"星芒"}[e.shape]}，倾角 ${e.tilt}°，${e.seconds} 秒后消失。`,from:[`entities[${i}]`]})
        if (e.type === "hit_fx") {
          add(e.particle ?? entity.particles?.hit ?? "crit", `在「${a.name}」第 ${e.at} 秒的${{light:"轻击",medium:"中击",heavy:"重击"}[e.level]}反馈里`)
        }
      }
      a.events.forEach(e => { if (e.type === "particle" || e.type === "hazard") add(e.particle, `在「${a.name}」第 ${e.at} 秒${e.type === "hazard" ? "铺下的危险区里" : ""}`) })
      a.events.forEach(e => {
        const p = e.type === "lightning" ? e.look?.particle : undefined
        if (p) add(typeof p === "object" && "particle" in p ? p.particle : p, `在「${a.name}」第 ${e.at} 秒的落雷处`)
      })
      a.events.forEach(e => { if (e.type === "debris") add(e.dust, `在「${a.name}」第 ${e.at} 秒掀起碎块时`) })
      a.hits.forEach(h => {
        if (h.type !== "projectile") return
        add(h.trail?.particle, `在「${a.name}」的投射物飞行时沿路径每刻`)
        add(h.impact?.particle, `在「${a.name}」第 ${h.at} 秒发射的投射物落地时`)
        h.impact?.ground?.forEach(fx => { if (fx.type === "hazard") add(fx.particle, `在「${a.name}」的投射物留下的危险区里`) })
      })
    })
    entity.emitters?.forEach(e => add(e.particle, `${emitterWhen(e.when)}每 ${e.every_ticks} 刻`))
    for (const show of ["intro", "death"] as const) entity.boss?.[show]?.steps?.forEach(e => { if (e.type === "particle") add(e.particle, `${show === "intro" ? "登场" : "死亡"}演出第 ${e.at} 秒`) })
    entity.boss?.phases.forEach((phase, index) => phase.finish?.forEach(step => {
      if (step.type === "particle") add(step.particle, `第 ${index + 1} 次变身收尾时`)
      if (step.type === "ground") step.ground.forEach(fx => { if (fx.type === "hazard") add(fx.particle, `第 ${index + 1} 次变身收尾的危险区里`) })
    }))
  })
  project.workspace.assets.forEach((asset, i) => {
    const doc = asset.document
    if (doc.kind === "ability") doc.events.forEach(e => { if (e.type === "particle") particleLines.push({ text: `技能「${doc.name}」在第 ${e.at} 秒冒出${particleLabel(e.particle, { title: titles, aliases: doc.particles })}。`, from: [`workspace.assets[${i}]`] }) })
  })
  const gameplays = project.workspace.assets.flatMap((asset, index) => (asset.document.kind === "gameplay" ? [{ asset, document: asset.document, path: `workspace.assets[${index}]` }] : []))
  const things = gameplayThings(project)

  const contents: GuideLine[] = [
    ...project.blocks.map((block, index) => ({
      text: `方块「${block.name}」：${block.shape ? `${blockShapeWords(block.shape)}，` : ""}硬度 ${block.hardness}，${block.luminance > 0 ? `会发光（亮度 ${block.luminance}，最亮是 15）` : "不发光"}，${dataWords.breaks(block)}${contentWords.standing(block) ? `；${contentWords.standing(block)}` : ""}${block.lucky ? "；是一个可以右键打开的盲盒" : ""}。`,
      from: [`blocks[${index}]`],
    })),
    ...project.items.map((item, index) => ({ text: `物品「${item.name}」：${item.max_stack === 1 ? "不能叠放，一格一个" : `一格最多叠 ${item.max_stack} 个`}${[...(item.tool ? [contentWords.tool(item.tool, plainly)] : []), ...(item.armor ? [contentWords.armor(item.armor, plainly)] : []), ...(item.food ? [contentWords.food(item.food)] : []), ...(item.fuel ? [contentWords.fuel(item.fuel)] : []), ...(item.rarity && item.rarity !== "common" ? [`稀有度「${ITEM_RARITIES[item.rarity].label}」，名字显示${ITEM_RARITIES[item.rarity].colour}`] : [])].map((words) => `；${words}`).join("")}。`, from: [`items[${index}]`, ...(item.tool?.repair ? where(item.tool.repair) : []), ...(item.armor?.repair ? where(item.armor.repair) : [])] })),
    ...project.entities.map((entity, index) =>
      unmade(project, entity.id)
        ? { text: `生物「${entity.name}」：模型做好了，生物本身还在做——生命、会不会打人这些等它做好才写在这里。`, from: [`entities[${index}]`] }
        : { text: `生物「${entity.name}」：生命 ${entity.health} 点（${hearts(entity.health)}），${mood(project, entity)}。`, from: [`entities[${index}]`, ...(entity.tempt ?? []).flatMap(where)] },
    ),
    ...project.entities.flatMap((entity, index) => {
      const report = particleReport(entity, entity.abilities ?? [], creatureTier(project, entity.id), project.workspace)
      return report && !report.warning ? [{ text: report.line, from: [`entities[${index}]`, ...(entity.shared_abilities ?? []).flatMap((use) => whereAsset(use.asset))] }] : []
    }),
    ...abilityAssets(project, false).flatMap(({ id, document }) => [
      ...abilityAssetLines(document, (kind, name) => kind === "gesture"
        ? gestures.find(({ asset }) => asset.id === name)?.document.name
        : (kind === "item" ? project.items : project.blocks).find((value) => value.identifier === name)?.name)
        .map((text) => ({ text, from: whereAsset(id) })),
      ...abilityAssetNames(document).sounds.map((sound) => ({ text: `技能「${document.name}」使用 ${soundWords({ asset: sound }, sounds, ABILITY_SOUNDS)}。`, from: [...whereAsset(id), ...whereAsset(sound)] })),
    ]),
    ...gestures.map((gesture) => ({ text: `施法动作「${gesture.document.name}」：按 ${gesture.document.trigger.key.toUpperCase()} 键做一遍。`, from: [gesture.path] })),
    ...gameplays.map((gameplay) => ({ text: `玩法「${gameplay.document.name}」（${AI_CODE_MARK}）：${handoutWords(gameplay.document.summary)}`, from: [gameplay.path] })),
  ]

  const obtain: GuideLine[] = [...project.blocks.map((value, index) => ({ value, path: `blocks[${index}]`, block: true })), ...project.items.map((value, index) => ({ value, path: `items[${index}]`, block: false }))].flatMap((entry) => {
    const id = `${mod}:${entry.value.identifier}`
    const users = gameplays.filter((gameplay) => gameplay.document.uses.includes(entry.value.id))
    // Round 18: read by the one reader the playable standard and reconciliation use (`sourceWays`), so this section, 「怎么玩一遍」
    // and each creature's own section cannot disagree about whether something gives it. Only the wording is this page's own.
    const found = sourceWays(project, entry.value.identifier)
    const order = ["recipe", "generation", "mined", "death_drop", "loot", "boss_show", "lair", "gameplay"] as const
    const ways: GuideLine[] = order.flatMap((kind) => found.filter((way) => way.way === kind)).map((way) => {
      const from = [...way.from, entry.path]
      if (way.way === "recipe") {
        const recipe = way.recipe
        const counts = recipe.pattern.filter((value): value is string => value !== null).reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>())
        // A recipe that is not laid out on the crafting grid (a furnace, a stonecutter, shapeless) is said by its own kind.
        if (recipe.type && recipe.type !== "shaped") return { text: `「${entry.value.name}」可以这样得到（配方「${recipe.name}」）：${contentWords.recipe(recipe, plainly)}。`, from: [...from, ...[...counts.keys()].flatMap(where)] }
        return { text: `「${entry.value.name}」可以合成：在工作台上按配方「${recipe.name}」摆放 ${[...counts].map(([reference, count]) => `${count} 个${said(reference)}`).join("、")}，做出 ${recipe.count} 个。`, from: [...from, ...[...counts.keys()].flatMap(where)] }
      }
      if (way.way === "generation") return { text: `「${entry.value.name}」${dataWords.generation(way.generation)}。`, from: [entry.path] }
      if (way.way === "mined") return { text: `挖掉「${way.block.name}」会掉 ${span(way.block.drop_item!.min, way.block.drop_item!.max)} 个「${entry.value.name}」。`, from }
      if (way.way === "death_drop") return { text: `玩家亲手打败「${way.entity.name}」时，有 ${Math.round(way.entity.runtime!.death_drop!.chance * 100)}% 的机会掉一个「${entry.value.name}」。`, from }
      // A creature's ordinary drops and what gameplay code hands out are said in the reader's own words.
      return { text: `「${entry.value.name}」：${way.facet.words}。`, from }
    })
    return [
      ...ways,
      ...(ways.length
        ? []
        : [
            {
              text: `「${entry.value.name}」没有配方，不会在世界里生成，也没有方块或生物掉它：可以在创造模式里拿：按 E 打开物品栏，点「搜索物品」页签，输入它的名字；不想翻物品栏的话，${typeIn(`/give @s ${id}`)}，直接给你一个。${users.length ? `玩法${users.map((user) => `「${user.document.name}」`).join("、")}的代码用到了它，能不能从那里得到要看那段玩法。` : ""}`,
              from: [entry.path, "mod_id", "recipes", ...users.map((user) => user.path)],
            },
          ]),
    ]
  })

  const mining: GuideLine[] = project.blocks.flatMap((block, index) => {
    const from = [`blocks[${index}]`]
    return [
      ...(block.tool_tier && block.tool !== "none" ? [{ text: `「${block.name}」${dataWords.tier(block.tool_tier, block.tool)}。`, from }] : []),
      {
        text: `「${block.name}」${block.drop === "item" && block.drop_item ? dataWords.drop(block.drop_item, named) : block.drop === "self" ? "挖掉会掉它自己" : "挖掉什么都不掉"}。`,
        from: block.drop === "item" && block.drop_item ? [...from, ...where(block.drop_item.item)] : from,
      },
      ...(block.experience ? [{ text: `「${block.name}」${dataWords.experience(block.experience)}。`, from }] : []),
      ...(block.sound ? [{ text: `「${block.name}」${dataWords.blockSound(block.sound)}（借用原版${BLOCK_SOUNDS[block.sound]}的声音，没有自己的音效文件）。`, from }] : []),
      ...(block.lucky
        ? [
            {
              text: `右键打开「${block.name}」会随机出 ${block.lucky.outcomes.length} 种结果里的一种：${block.lucky.outcomes
                .map((outcome) => `${outcome.weight}% 的机会是 ${[...outcome.items.map((gift) => `${span(gift.min, gift.max)} 个${plainly(gift.item)}`), ...outcome.effects.map((effect) => `${EFFECTS[effect.effect] ?? effect.effect} ${seconds(effect.duration_ticks)}`)].join("、")}`)
                .join("；")}。`,
              from,
            },
          ]
        : []),
    ]
  })

  const creatures: GuideSection[] = project.entities.map((entity, index) => {
    const from = [`entities[${index}]`]
    const runtime = entity.runtime
    const played = playedAnimations(project, entity.id, facts.animations[entity.id])
    const rest = (facts.animations[entity.id] ?? []).filter((name) => !played.includes(name))
    // Gameplay code that picks a motion by a name it builds may play any of the rest: they are not said to be never played.
    const byCode = mayBePlayedByGameplay(project, entity.id)
    const unplayed = byCode ? [] : rest
    const rules = project.logic.flatMap((rule, ruleIndex) => (rule.entity_id === entity.id && rule.enabled ? [{ rule, path: `logic[${ruleIndex}]` }] : []))
    const voice = entity.sounds ? dataWords.voice(entity.sounds) : ""
    const lair = creatureWords.lair(project, entity, entity.id)
    const ritual = bossSummonWay(project, entity)
    const guarded = creatureWords.garrison(project, runtime?.garrison)
    const model = project.workspace.assets.find((asset) => asset.id === entity.model_asset_id)?.document
    const pose = facts.poses?.[entity.id] ?? guidePose(model?.kind === "model" ? model : undefined)
    const abilities = entity.behavior === "hostile" ? entity.abilities ?? [] : []
    const motion = (name: string) => abilities.find((value) => value.clip === name)?.name ?? motionName(name)
    const motionList = (name: string) => motion(name) === name ? `「${name}」` : motion(name)
    // Still being made: its model is shown, its placeholder rules are not (broad7 w2, `unmade`).
    if (unmade(project, entity.id))
      return { title: `生物「${entity.name}」`, ...(entity.model_asset_id ? { creature: entity.id } : {}), lines: [{ text: "还在做：模型做好了，生物本身（生命、会不会打人、掉什么、怎么动）做好以后这里才写。", from }] }
    return {
      title: `生物「${entity.name}」`,
      ...(entity.model_asset_id ? { creature: entity.id } : {}),
      lines: [
        { text: `生命 ${entity.health} 点（${hearts(entity.health)}）${runtime?.armor ? `，护甲 ${runtime.armor} 点` : ""}。`, from },
        { text: `${mood(project, entity)}${entity.behavior === "hostile" ? ((taken) => (taken ? `（${taken}）` : ""))(creatureWords.held(gameplayHolds(project, creatureName(entity))).target) : ""}${runtime && entity.behavior !== "passive" ? `，${entity.flight ? flightWords.fights(entity.behavior === "hostile" ? flightFight(entity.abilities ?? [], "hostile") : "none", entity.behavior === "hostile" ? flightLands(entity.abilities ?? []).map((ability) => ability.name) : []) : MOVES[runtime.movement]}` : ""}。`, from: [...from, ...(entity.tempt ?? []).flatMap(where)] },
        ...(entity.behavior === "hostile" && !runtime?.explosion ? [{ text: entity.attack_damage > 0 ? `普通难度下打中玩家一下掉 ${entity.attack_damage} 点血（${hearts(entity.attack_damage)}，没算护甲）；简单难度少一些，困难多一些，和平难度不掉血。` : entity.abilities?.length ? "空手近战的攻击力是 0：贴身碰到不掉血，它伤人靠下面的招式。" : "攻击力是 0，打中了也不掉血。", from }] : []),
        // broad6 w1: in the test scene a creature stands in a pen, whose panes also stop it seeing the person, so it does not come to fight until the gate is opened.
        // broad23: the pen is glass with a fence gate on the side toward the person (it was invisible wall), and says so.
        // A boss that starts asleep has no pen (it waits where it is), so this is said of every other hostile creature, with the gate and the one command that brings it out.
        // broad8 w1: a flier has no pen either (it flies over one), so it is not said to stand in one.
        ...(entity.behavior === "hostile" && !entity.boss?.intro && !entity.flight
          ? [{ text: `测试场里它站在一圈玻璃栏里（第一眼好让它待在名字下面），栏挡着视线，在外面它看不到你，不会过来打你。栏朝你的这一面有一扇木栅栏门：右键打开、走进去，它就会来打你。想让它直接到你面前：先走到空地上、面朝前方，${typeIn(`/tp @e[type=${project.mod_id}:${creatureName(entity)},limit=1] ^ ^ ^6`)}，它就到你面前 6 格。`, from }]
          : []),
        ...(runtime?.explosion && entity.behavior !== "passive"
          ? [
              {
                text: `${entity.behavior === "hostile" ? "不用手打人：" : ""}贴近它跟着的玩家 3 格以内 ${seconds(runtime.explosion.fuse_ticks)}后爆炸，波及 ${runtime.explosion.radius} 格，${runtime.explosion.damage_blocks ? "会炸坏方块" : "不会炸坏方块"}${
                  runtime.explosion.effects.length ? `；被炸到的生存玩家会${runtime.explosion.effects.map((effect) => `${EFFECTS[effect.effect]} ${seconds(effect.duration_ticks)}`).join("、")}` : ""
                }。`,
                from,
              },
            ]
          : []),
        // How it is met in the world: out in the biomes (`runtime.spawn`) and/or in its lair (`boss.lair`), the same two facets the standard reads.
        // Only a creature with neither is said not to appear by itself; the egg and /summon are said for it, and for the others they are a creative-mode convenience.
        ...(runtime?.spawn ? [{ text: `${creatureWords.spawn(runtime.spawn, entity.behavior, projectStructureWords(project))}。`, from }] : []),
        ...(lair ? [{ text: `${lair}。`, from: [...from, "mod_id"] }] : []),
        // r29: put in a boss's lair as it is made.
        ...(guarded ? [{ text: `${guarded.words}。`, from: [...from, "mod_id"] }] : []),
        ...(ritual ? [{ text: `召唤方式：${ritual.words}。`, from: [...from, ...ritual.refs.flatMap(where)] }] : []),
        ...(runtime?.spawn || lair || ritual || guarded ? [] : [{ text: `不会自己出现：按 E 打开创造模式物品栏，在「刷怪蛋」页签里找「${entity.name}刷怪蛋」，拿在手上对着地面右键；或者${typeIn(`/summon ${mod}:${creatureName(entity)}`)}，它就出现在你面前。`, from: [...from, "mod_id"] }]),
        ...(runtime?.death_drop ? [{ text: `被玩家亲手打败（不是炸死）时，有 ${Math.round(runtime.death_drop.chance * 100)}% 的机会掉一个「${named(runtime.death_drop.block_identifier)}」。`, from: [...from, ...where(runtime.death_drop.block_identifier)] }] : []),
        // Round 18: its drops are said here too, in the words its card uses, so 「进游戏亲眼看」 has something written to count them against.
        ...(entity.loot?.length || entity.experience
          ? [{ text: `${[...(entity.loot?.length ? [`打败它会掉 ${creatureWords.loot(entity.loot, project)}`] : []), ...(entity.experience ? [`打败它给 ${entity.experience} 点经验`] : [])].join("；")}。`, from: [...from, ...(entity.loot ?? []).flatMap((drop) => where(drop.item))] }]
          : runtime?.death_drop ? [] : [{ text: "没有设置掉落：打败它什么都不掉。", from }]),
        ...(entity.sounds
          ? [
              {
                text: `${(Object.keys(SOUND_MOMENTS) as SoundMoment[]).some((moment) => isSoundAsset(entity.sounds![moment])) ? "声音" : "声音借用原版的"}：${(Object.keys(SOUND_MOMENTS) as SoundMoment[])
                  .map((moment) => (entity.sounds![moment] ? dataWords.creatureSound(moment, entity.sounds![moment]!, (id) => sounds(id)?.title ?? null) : `${SOUND_MOMENTS[moment]}${moment === "ambient" ? "不出声" : moment === "step" ? "是脚下方块的声音" : "是所有生物通用的声音"}`))
                  .join("；")}${voice ? `；${voice}` : ""}。`,
                from,
              },
            ]
          : [{ text: "没有设置声音：平时不出声，受伤和死的时候是所有生物通用的声音。", from }]),
        ...soundUses({ ...entity, abilities }).flatMap((use) => "ability" in use.where && isSoundAsset(use.sound) ? [{ text: `${use.words}放 ${soundWords(use.sound, sounds, ABILITY_SOUNDS)}。`, from: [...from, ...whereAsset(use.sound.asset)] }] : []),
        ...(entity.behavior === "hostile" && entity.boss ? [
          ...(entity.boss.intro?.sound && isSoundAsset(entity.boss.intro.sound) ? [{ text: `登场时放 ${soundWords(entity.boss.intro.sound, sounds, ABILITY_SOUNDS)}。`, from: [...from, ...whereAsset(entity.boss.intro.sound.asset)] }] : []),
          ...bossShowSteps(entity.boss).flatMap(({ show, step }) => step.type === "sound" && isSoundAsset(step.sound)
            ? [{ text: `${show === "intro" ? "登场" : "死亡"}演出第 ${step.at} 秒放 ${soundWords(step.sound, sounds, ABILITY_SOUNDS)}。`, from: [...from, ...whereAsset(step.sound.asset)] }]
            : []),
        ] : []),
        ...(entity.boss?.arena?.fixtures.some(group => !group.use || group.use.by || group.use.lit_seconds !== undefined || group.light !== undefined || group.ember_light !== undefined) ? [{text:arenaWords(entity.boss.arena),from}] : []),
        ...abilities.flatMap(move => [
          ...move.events.flatMap(event => event.type === "fixture" ? [{text:`「${move.name}」第 ${event.at} 秒${fixtureWords(event,entity.builtin)}。`,from}] : []),
          ...(moveAimsAtFixture(move) ? [{text:`「${move.name}」打亮着的场地物件。全部熄灭时它不会选这招。`,from}] : []),
        ]),
        ...combatGuide({...entity,abilities}).map(text => ({ text, from })),
        ...(entity.stances?.list.flatMap(row => stanceWords(row, entity.stances!, [...abilities, ...(entity.combos ?? [])]).map(text => ({ text: `「${row.name}」姿态。 ${text}`, from }))) ?? []),
        ...abilities.flatMap((ability) => abilityWords.terrain(ability).map((text) => ({ text: `招式「${ability.name}」${text}。`, from }))),
        ...(pose.hangs ? [{ text: "挂链会受重力垂下，跟着身体移动和甩动。", from: [...from, ...whereAsset(entity.model_asset_id!)] }] : []),
        ...(pose.feet ? [{ text: "踩地让脚在画面里随台阶和斜坡的高低调整，生物实际站位和碰撞箱照常。", from: [...from, ...whereAsset(entity.model_asset_id!)] }] : []),
        ...(facts.glowing.includes(entity.id) ? [{ text: "模型上画成发光的部分（眼睛、纹路）在黑暗里也是亮的。", from }] : []),
        ...rules.map(({ rule, path }) => ({
          text: `${TRIGGER_WORDS[rule.trigger](said(rule.item ?? ""))}，它会${rule.action === "look" ? "转头看着玩家" : rule.action === "follow" ? "跟着玩家走" : `做「${motionName(rule.animation ?? "")}」这个动作`}。`,
          from: [path, ...from, ...(rule.item ? where(rule.item) : [])],
        })),
        { text: `${byCode && rest.length && !unplayed.length ? "游戏里它确定会做的动作有" : "游戏里它会做的动作只有"}：${played.map(motionList).join("、")}。${unplayed.length ? `模型里的「${unplayed.map(motion).join("」「")}」没有东西去播放，游戏里看不到。` : byCode && rest.length ? `玩法代码里是按它自己拼出来的名字播动作的，模型里的「${rest.map(motion).join("」「")}」可能由玩法代码播放，这里读不出来。` : ""}`, from: [...from, ...rules.map((entry) => entry.path), "animations"] },
      ],
    }
  })

  const plays: GuideSection[] = gameplays.map((gameplay) => {
    const tries = gameplayTryList(mod, gameplay.document, things)
    const from = [gameplay.path]
    return {
      title: `玩法「${gameplay.document.name}」（${AI_CODE_MARK}）`,
      lines: [
        { text: handoutWords(gameplay.document.summary), from },
        { text: PLAYTEST_WORDS, from },
        ...gameplay.document.behaviours.map((behaviour) => ({ text: handoutWords(`${behaviour.when}：${behaviour.does}（你会看到：${behaviour.shows}）`), from })),
        { text: `怎么在游戏里试：先${tries.prepare[0]}。`, from: [...from, "mod_id"] },
        // One line for each thing to get hold of, so each command stands on its own line in the window with its own copy button.
        ...tries.prepare.slice(1).map((line) => ({ text: `准备：${line}。`, from: [...from, "mod_id", ...gameplay.document.uses.flatMap(whereAsset)] })),
        ...tries.steps.map((step, stepIndex) => ({ text: handoutWords(`试第 ${stepIndex + 1} 条：${step.do}。应该发生：${step.expect}。留意：${step.notice}`), from })),
      ],
    }
  })

  const refused: GuideLine[] = [
    ...(project.blueprint?.entries ?? []).flatMap((entry, index) => (entry.out_of_scope && !blueprintEntryMade(project, entry) ? [{ text: `「${entry.title}」：${handoutWords(entry.out_of_scope)}`, from: [`blueprint.entries[${index}]`] }] : [])),
    ...gameplays.flatMap((gameplay) => gameplay.document.not_doing.map((line) => ({ text: `玩法「${gameplay.document.name}」不会：${handoutWords(line)}`, from: [gameplay.path] }))),
  ]

  // 「怎么玩一遍」: the order a survival player can reach things in, each with what its own kind reports for it.
  // Read across the whole project (a thing's source may be another thing's recipe or drop), so every record backs a line.
  const play = playability(projectThings(project))
  const across = ["workspace.assets", "blocks", "items", "recipes", "entities", "logic"]
  const steps = walkLines(play).filter((line) => play.walk.find((step) => step.thing === line.thing)!.source.length)
  // Only what is known to have no way in: a thing whose kind reports nothing is not said to be out of reach.
  const unreached = play.things.filter((thing) => play.gaps.some((gap) => gap.thing === thing.id && gap.question === "source" && !gap.silent))
  // Boss runtime (10-12): how to try each boss, in the order a fight goes: walk up and watch it wake, take it to the first line of life, see whether a slam shakes the screen, walk away, kill it.
  const bosses: GuideLine[] = project.entities.flatMap((entity, index): GuideLine[] => {
    const boss = entity.behavior === "hostile" ? entity.boss : null
    if (!boss) return []
    const from = [`entities[${index}]`]
    const named = `「${entity.name}」`
    const opening = boss.intro?.opening ? (entity.abilities ?? []).find((ability) => ability.id === boss.intro!.opening) : undefined
    return [
      { text: `${named}是 Boss：${bossWords.bar(boss)}。${boss.intro ? `在测试场里它一开始${entity.habits ? "还没见过谁：习性说活动的时候它照习性活动（巡、猎、飞都照做，但不会挑你打），习性说休息的时候才睡着" : "是睡着的"}，Studio 不会替你把它叫醒：从远处慢慢走近，到 ${boss.intro.wake_distance} 格以内（或者打它一下）看它醒来——${entity.flight ? "它该飞到你头顶（在地上就先起飞），在上空盘旋着演这一段，" : ""}${boss.intro.clip ? "醒来的动作有没有播完，" : ""}${boss.intro.sound ? "吼声有没有响，" : ""}这 ${boss.intro.seconds} 秒里它${entity.flight ? "只盘旋、不出招" : "不动"}、也打不掉血，血条要等它醒完才出现。` : "它一出来就开打，血条一直在。"}`, from },
      // The named first attack (`intro.opening`): what to look for once the wake-up is over, and what happens when it cannot start.
      ...(opening
        ? [
            {
              text: `${named}登场以后的第一招该是「${opening.name}」：等它登场演完，站在这一招够得着的地方（离它 ${opening.start.min_distance}–${opening.start.max_distance} 格${opening.start.line_of_sight ? "、让它看得见你" : ""}），看它出的第一下是不是这一招，别的招式在它用出这一招之前不该出。再试它用不出来的情形：登场演完以后躲到离它 ${opening.start.max_distance} 格以外${boss.leash ? `、但别走出 ${BOSS_LIMITS.battle} 格（走出 ${BOSS_LIMITS.battle} 格待够 ${boss.leash.reset_seconds} 秒它会先重置）` : ""}的地方别动，登场结束约 ${Number((bossOpeningTicks(opening, entity.flight) / 20).toFixed(1))} 秒以后它就放开其他符合条件的招式：够得着你、这个阶段允许的那些招式才会出。${boss.leash ? `走远待够 ${boss.leash.reset_seconds} 秒让它重置，再回来叫醒它：第一招应该又是这一招；` : ""}它变身（进下一个阶段）不会让它重新先用这一招。`,
              from,
            },
          ]
        : []),
      ...boss.phases.map((phase, number) => ({
        // broad7 w3: the line said every phase got faster, harder and changed its moves, of a phase whose speed and damage were 1 and whose moves
        // were the first stage's. Only what this phase changes is said.
        text: `${named}第 ${number + 1} 次变身：打到它血量剩 ${Math.round(phase.below * 100)}% 左右——它该停下变身${phase.clip ? "，播变身的动作" : ""}，这 ${phase.seconds} 秒里打它不掉血${((changes) => (changes.length ? `；之后${changes.join("，")}` : ""))([...(phase.bar_color ? ["血条换颜色"] : []), ...(phase.speed > 1 ? [entity.flight ? `走得和飞得都快到 ${phase.speed} 倍（盘旋、俯冲的速度都变快）` : `走得快到 ${phase.speed} 倍`] : []), ...(phase.damage > 1 ? [`出手重到 ${phase.damage} 倍`] : []), ...(sameMoves(stageMoves(boss, [...(entity.abilities ?? []), ...(entity.combos ?? [])], number), stageMoves(boss, [...(entity.abilities ?? []), ...(entity.combos ?? [])], number + 1)) ? [] : ["能用的招式变了"])])}。一下打得很重也只会停在这条线上，不会一次跳过两个阶段。`,
        from,
      })),
      ...(felt(entity.abilities ?? [])
        ? [{ text: `${named}的晃屏和碎块：站在它够得着的地方等它砸地或吼叫——屏幕该晃一下再慢慢停下（离得远晃得轻）；脚下的地面冒尘、碎块飞起再落下，落完地上的方块一块都没有少。再到游戏设置里把“屏幕效果强度”调到 0，同一招应该不晃。`, from }]
        : []),
      // The leash ends the fight wherever the boss is once nobody is within the battle range for reset_seconds (fabric/entity-boss.ts); the distance only decides whether it is also brought home. So the first test is not walking it out, it is walking away from it.
      ...(boss.leash ? [{ text: `${named}走远了会回去、重新开始：先在它出生点附近打它几下，让血量掉下来${boss.phases.length ? "（有阶段的打进下一个阶段更好）" : ""}；然后自己走到离它 ${BOSS_LIMITS.battle} 格以外，待 ${boss.leash.reset_seconds} 秒以上，再回来看——不管它当时在哪里，它都该血量回满、回到第一阶段${boss.intro ? (entity.habits ? "、回到没见过谁的样子（照习性活动）" : "、重新睡着") : ""}${boss.bar.darken_sky ? "，变暗的天色也该亮回来" : ""}。再试一次：这回把它引到离出生点 ${boss.leash.distance} 格以外再走开，它除了重新开始，还该自己走回出生点。`, from }] : []),
      { text: `${named}死的时候：${bossWords.death(boss, { title: titles, aliases: entity.particles })}。看动作放完才消失、经验是分几次喷出来的（数一数），${boss.death.explosion ? "最后那一声只有光和响，地上的方块和你都没事。" : "没有最后的爆炸。"}`, from },
      // broad5: the scene's world takes commands (`allowSceneCommands`), which is the quickest way to reach each part of a fight.
      { text: `想快一点试${named}的每一段，可以用命令（测试场里能用；自己建的世界要开着“允许作弊”）。每一条都是：按 T 打开聊天框，粘贴，再按回车。${command("/gamemode creative")}，不怕被打死；${command("/effect give @s minecraft:resistance 600 4")}，扛得住；${command(`/kill @e[type=${project.mod_id}:${creatureName(entity)}]`)}，直接看死亡动作和掉落。想看经验一波波喷出，得算你打死的：${command(`/damage @e[type=${project.mod_id}:${creatureName(entity)},limit=1] 1000 minecraft:player_attack by @s`)}（它还在登场时打不动，有阶段的第一下会停在阶段线上，多来几下）；用上面那条 kill 命令杀死的不算玩家打死，不掉经验。`, from },
      // broad6 w3: /kill alone showed the death with no experience at all, which only a player's kill gives.
    ]
  })
  // Flight and habits (10-12): what to look for in the game, in the creature's own numbers: the sentences are made from the document, so they can be checked against it.
  const lives: GuideLine[] = project.entities.flatMap((entity, index): GuideLine[] => {
    const from = [`entities[${index}]`]
    const named = `「${entity.name}」`
    const registry = `${project.mod_id}:${creatureName(entity)}`
    return [
      ...(entity.flight
        ? [
            { text: `${named}${flightWords.summary(entity.flight)}。`, from },
            { text: `${named}：${flightWords.sees(entity.flight, registry)}${entity.behavior === "hostile" && entity.abilities?.some((ability) => ability.dive) ? `想看俯冲：站在地上让它发现你，它会飞到你上空盘旋，出招时${flightWords.dive}。` : ""}${entity.habits?.home ? "" : `测试场里它被限定在出生点 ${roamOf(creatureEntry(project, entity))} 格以内飞（免得一进来它已经飞远了；这个范围按它自己转一圈要的地方算，转得越慢、飞得越快就越大）；换到别的世界就没有这个限制。`}`, from },
          ]
        : []),
      ...(entity.habits
        ? [
            { text: `${named}的习性：${habitsWords.summary(entity.habits)}。`, from },
            { text: `${named}：想看它的作息，改时间：${typeIn("/time set day")}（变成白天）或者 ${command("/time set night")}（变成夜里）——${entity.habits.active === "always" ? "它一直活动，不会因为时间去休息" : `不在${entity.habits.active === "day" ? "白天" : "夜里"}的时候，它该${entity.habits.home ? "走（或飞）回出生点附近" : "停在原地"}、停下来${entity.habits.rest?.clip ? "、播休息的动作" : ""}；换回活动的时间它就起来`}。${entity.habits.home ? `把它引到出生点 ${entity.habits.home.radius} 格外，它该自己回来。` : ""}${entity.habits.prey.length ? `想看捕猎：在它附近放一只原版的动物（${entity.habits.prey.slice(0, 2).map((id) => VANILLA_PREY[id] ?? id).join("、")}），等它饿了（吃饱后 ${Math.round(entity.habits.hunger_seconds)} 秒；${typeIn(`/data merge entity @e[type=${registry},limit=1] {HabitHunger:100000}`)} 可以让它立刻饿）它会去追、咬，吃的时候${entity.habits.eat?.clip ? "播进食的动作" : "站着不动"}。` : ""}${entity.habits.alert ? `想看警觉：从远处走近到 ${entity.habits.alert.distance} 格以内，它该先停下看你${entity.habits.alert.clip ? "、播一次警觉的动作" : ""}；退开再走近，30 秒内不会再播。${habitsWords.warns(entity.habits) ? `${habitsWords.warns(entity.habits)}：站在两个距离之间它只警告、不动手；走进 ${entity.habits.alert.attack_distance} 格以内，或者先打它一下，它才开打。` : ""}` : ""}`, from },
          ]
        : []),
    ]
  })
  const walk: GuideLine[] = [
    ...(steps.length
      ? [
          { text: "从一个新的生存世界出发，照下面的顺序能把模组里的东西走一遍。顺序是按每样东西的来历排出来的，没有人替你试玩过。", from: ["workspace.assets"] },
          ...steps.map((line) => ({ text: line.text, from: [...project.workspace.assets.flatMap((asset, index) => (asset.id === line.thing ? [`workspace.assets[${index}]`] : [])), ...across] })),
          ...(unreached.length ? [{ text: `还走不到的：${unreached.map((thing) => `「${thing.title}」`).join("、")}。生存模式里没有它们的来历，只能在创造模式的物品栏里拿。`, from: ["workspace.assets"] }] : []),
        ]
      : []),
    ...bosses,
    ...lives,
  ]

  const warnings: GuideLine[] = facts.findings.filter((finding) => !finding.stops && finding.rule !== "blueprint_sound_drift").map((finding) => ({ text: plainFix(findingText(finding)), from: ["findings"] }))

  const install: GuideLine[] = [
    { text: `这是一个 ${game.loader} 模组，给 Minecraft ${game.minecraft}（Java 版）用，需要 Java ${game.java}。`, from: ["profile"] },
    game.fabricApi
      ? { text: `先装好 Fabric Loader（${game.loaderVersion} 或更新），再把三个文件放进游戏的 mods 文件夹：这个模组的 ${jarName(project)}、Fabric API（${game.fabricApi} 或更新）和 GeckoLib ${game.geckolib} 或更新的 ${game.geckolib.split(".")[0]}.x（Fabric ${game.minecraft} 版）。缺了后两个，游戏会在启动时提示缺少前置。`, from: ["profile", "mod_id"] }
      : { text: `先装好 ${game.loader}（${game.loaderVersion} 或更新），再把两个文件放进游戏的 mods 文件夹：这个模组的 ${jarName(project)} 和 GeckoLib ${game.geckolib} 或更新的 ${game.geckolib.split(".")[0]}.x（${game.loader} ${game.minecraft} 版）。缺了 GeckoLib，游戏会在启动时提示缺少前置。`, from: ["profile", "mod_id"] },
    ...(gestures.length ? [{ text: "施法动作用到的动画库已经装在这个模组的 jar 里，不用另外下载。", from: gestures.map((gesture) => gesture.path) }] : []),
    { text: facts.built ? BUILT_WORDS.built : facts.changed ? BUILT_WORDS.changed : BUILT_WORDS.never, from: ["built"] },
  ]

  // 「进游戏亲眼看」: what Studio measured or generated and nobody has seen in the running game (10-07). One line per thing to look at,
  // said as what to do and what to see; only for what this mod really has. Nothing here is about a subject: the lines follow the data.
  const entityPath = (id: string) => project.entities.flatMap((value, index) => (value.id === id ? [`entities[${index}]`] : []))
  const seen: GuideLine[] = [
    ...(project.entities.length || project.blocks.length || project.items.length || gameplays.length
      ? [{ text: "装好以后打开游戏：能进主菜单；新建一个世界能进去，不卡在载入画面；退出再进同一个世界也一样。", from: ["built"] }]
      : []),
    ...project.entities.flatMap((entity) => {
      const from = entityPath(entity.id)
      const clips = facts.animations[entity.id] ?? []
      const abilities = entity.behavior === "hostile" ? (entity.abilities ?? []) : []
      // A boss that sleeps until somebody comes is kept like a placed one (fabric/entity-boss.ts despawnKept), so it is not said to come and go (broad9 w4b).
      const stays = !(entity.behavior === "hostile" && entity.runtime?.spawn) || !!entity.boss?.intro
      return [
        { text: `「${entity.name}」走路：离它八格左右看它走，慢慢走的时候也看——是在一步一步迈，还是摆着姿势被拖着走。`, from },
        { text: `「${entity.name}」站着：看它十秒，看得出是活的；脚踩在地上，没有陷进去也没有飘着（它本来就该飘着或者飞的话，看它离地的高度对不对）。`, from },
        { text: `「${entity.name}」挨打：打它一下，它有没有明显的反应。${clips.includes("death") ? "把它打死：倒下的动作放完才消失。" : ""}${entity.loot?.length || entity.experience ? "数一数掉的东西和经验，和上面写的一样不一样。" : ""}`, from },
        ...(entity.hitbox ? [{ text: hasHitboxCombat(entity.hitbox) ? `「${entity.name}」的部位：按 F3+B 看框是否贴着身体和兵器动作；${(entity.hitbox.parts ?? []).map((part) => `「${part.name}」伤害倍率 ${part.damage_scale ?? 1}×${part.phase_scales?.length ? `（${part.phase_scales.map((entry) => `阶段 ${entry.phase}：${entry.damage_scale}×`).join("、")}）` : ""}`).join("、")}。用同一把武器打各部位核对掉血：弱点有暴击粒子，0 倍率有火星和金属格挡声；阶段 0 是初始阶段。${(entity.hitbox.parts ?? []).some((part) => part.contact?.length) ? "站到兵器扫过的地方：只在指定招式的时间窗内受伤和被击退，同一招一直贴着它也只挨一次；下一招能再挨打，招式中断立刻停止。" : ""}` : `「${entity.name}」的碰撞箱：按 F3+B 显示出来，看框是不是贴着身体；对着伸出去的部位（${(entity.hitbox.parts ?? []).map((part) => part.name).join("、") || "头、尾、四肢"}）各打一下，都会掉血。它做动作的时候框不跟着肢体动，这是现在的限制。`, from }] : []),
        ...abilities.map((ability) => {
          // A moment of the ability that gameplay code does: what it does is that gameplay's to say (its sheet), and the check cannot see it; the person is asked to look for exactly that.
          const handed = [...new Set(ability.hits.flatMap((hit) => (hit.type === "gameplay" ? [gameplayBySlug(project, hit.gameplay)?.title ?? "代码接手的那个"] : [])))]
          return {
            text: `「${entity.name}」的招式「${ability.name}」：站到它够得着的地方等它出手——看得出它要出手吗；它动作到位的那一下，${abilityWords.felt(ability) ? `和你${abilityWords.felt(ability)}，是不是同一刻；冒出来的效果是不是就在你挨打的地方` : handed.length ? "动作、声音和冒出来的效果对不对得上" : "动作、声音和冒出来的效果对不对得上（这一招不会伤到你，也不会推你拉你）"}。${handed.length ? `这一招有一刻由玩法${handed.map((title) => `「${title}」`).join("、")}的代码接着做：照那个玩法的说明里写的看，它做的事是不是就发生在动作到位的那一刻，这一招进行的时候别的招式不会同时放。` : ""}站高一点、站低一点各试一次。`,
            from,
          }
        }),
        stays
          ? { text: `「${entity.name}」留不留得住：走开一百多格再回来，退出世界再进来，它都应该还在。`, from }
          : { text: `「${entity.name}」是会自己出现的敌对生物：走远了它会像原版怪物一样消失，这是正常的；去它出现的地方等一等，看十分钟里遇不遇得到。`, from },
      ]
    }),
    ...(project.blocks.some((block) => !block.shape) ? [{ text: `方块（${project.blocks.filter((block) => !block.shape).map((block) => `「${block.name}」`).join("、")}）：各砌一面八格见方的墙，站远看——是不是一眼看得出一格一格在重复；和旁边的原版方块放在一起协不协调。用上面写的工具挖一次，再换一把差一级的挖一次，掉的东西对不对。`, from: ["blocks"] }] : []),
    // A block that is boxes put together is looked at from around, set down facing each way and walked into, not built into a wall.
    ...project.blocks.flatMap((block, index) =>
      block.shape
        ? [{ text: `方块「${block.name}」（${blockShapeWords(block.shape)}）：放在地上，绕着它走一圈，四面和上面都看一眼，和做的时候看到的图一样不一样；${block.shape.facing === "horizontal" ? "朝四个方向各放一个，正面是不是都朝着你；" : ""}${block.shape.collision === "shape" ? "走进它没有盒子的地方，能不能走进去，碰到盒子的地方挡不挡你；" : "碰撞和整块一样，不用走进去试；"}放在别的方块旁边，边上的面有没有凭空消失；用上面写的工具挖一次，掉的东西对不对。`, from: [`blocks[${index}]`] }]
        : [],
    ),
    ...(project.items.length ? [{ text: `物品（${project.items.map((item) => `「${item.name}」`).join("、")}）：在背包里和拿在手上各看一眼，认不认得出是什么。是工具的，拿去挖要它这个等级才挖得动的方块；是食物的吃一口；是燃料的烧一次。`, from: ["items"] }] : []),
    ...(project.recipes.length ? [{ text: "配方：照上面“怎么得到这些东西”里写的各摆一次，能不能做出来、做出几个。", from: ["recipes"] }] : []),
    ...(gameplays.length ? [{ text: `玩法（${gameplays.map((gameplay) => `「${gameplay.document.name}」`).join("、")}）：照它那一节的“试第 N 条”一条一条做；做完退出世界再进来，它记下的东西（位置、主人、次数）还对不对。`, from: gameplays.map((gameplay) => gameplay.path) }] : []),
    ...(gestures.length ? [{ text: "施法动作：按键以后看得到自己的手臂在动吗，切到第三人称看朝向对不对，做完能回到原样吗。", from: gestures.map((gesture) => gesture.path) }] : []),
    ...(project.entities.length || gameplays.length ? [{ text: "要和朋友一起玩的话：叫一个人进来，他看到的动作和效果，和你看到的一样吗。", from: ["built"] }] : []),
  ]

  // 「进游戏找到这些东西」: how to see the mod's things in a world of one's own, with no test world set out (round 17).
  const hand = byHandLines(project)

  const written: GuideSection[] = [
    ...(project.description.trim() ? [{ title: "作者的介绍", lines: [{ text: project.description.trim(), from: ["description"] }] }] : []),
    { title: "模组里有什么", lines: contents.length ? contents : [{ text: "这个模组里还没有任何东西。", from: ["blocks", "items", "entities"] }] },
    ...(hand.length ? [{ title: "进游戏找到这些东西", lines: hand }] : []),
    ...(walk.length ? [{ title: "怎么玩一遍", lines: walk }] : []),
    ...(seen.length ? [{ title: "进游戏亲眼看这几样", lines: [{ text: "下面这些，Studio 只在纸面上量过、算过，没有人在游戏里看过。照着做一遍，哪一条不对，回 Studio 对那样东西说“重做”并把看到的写上。", from: ["built"] }, ...seen] }] : []),
    ...(obtain.length ? [{ title: "怎么得到这些东西", lines: obtain }] : []),
    ...(mining.length ? [{ title: "方块挖起来怎么样", lines: mining }] : []),
    ...creatures,
    ...(particleLines.length ? [{ title: "粒子", lines: particleLines }] : []),
    ...(gestures.length
      ? [{ title: "按键", lines: [...gestures.map((gesture) => ({ text: `按 ${gesture.document.trigger.key.toUpperCase()} 键：做「${gesture.document.name}」这个动作。`, from: [gesture.path] })), { text: "按键可以在游戏的“选项 → 控制 → 按键绑定”里改。施法动作本身只是动作，不带伤害、粒子或音效。", from: gestures.map((gesture) => gesture.path) }] }]
      : []),
    ...plays,
    ...(refused.length ? [{ title: "这个模组不做什么", lines: refused }] : []),
    ...(warnings.length ? [{ title: "机器对账发现的问题", lines: warnings }] : []),
    { title: "怎么安装", lines: install },
  ]
  const title = `${project.name} 模组说明`
  // Whatever an AI wrote into the project (a gameplay's description reaches the guide by several roads: its own section, the order of play,
  // a block's use) is read by a person here, so the words go through `handoutWords` once more as the last step: no road needs to remember it.
  const sections = written.map((section) => ({ ...section, lines: section.lines.map((line) => ({ ...line, text: handoutWords(line.text) })) }))
  return {
    title,
    sections,
    markdown: [`# ${title}`, "", ...sections.flatMap((section) => [`## ${section.title}`, "", ...section.lines.map((line) => `- ${line.text}`), ""])].join("\n"),
  }
}
