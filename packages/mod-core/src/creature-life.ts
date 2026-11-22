import { LOOK_GUIDE, SWAY_GUIDE, WEIGHT_GUIDE } from "@minemods/studio-ai/animation"
import { soundLookup } from "./sound"
import { contentName } from "./asset-name"
import { CREATURE_BABY } from "./creature-capability"
import { motionName } from "@minemods/studio-ai/making"
import { ORE_BIOME_GROUPS, biomeName } from "./data-words"
import { CREATURE_JUSTIFIED_MOST, CREATURE_LIFE_LIMITS, ENGAGEMENT_LIMITS, ENGAGEMENT_MODES, NEAR_LIMITS, SPAWN_BIOME_TAGS, SPAWN_CAP_LIMITS, SPAWN_TIMES, SPAWN_WEATHERS, SPAWN_WHEN_LIMITS, STRUCTURE_NOT_IN_1_20_1, type CreatureLoot, type Engagement, type EntityRuntime, type StructureRef } from "./entity-runtime"
import { VANILLA_ITEM_NAMES } from "./fabric/content-vanilla"
import { GAMEPLAY_API, creatureName } from "./gameplay"
import { stripJava } from "./gameplay-scan"
import { gameplayHolds, type GameplayHold } from "./gameplay-references"
import type { Facet } from "./playable"
import type { Project } from "./project"
import type { ModuleDocument } from "./workspace"
import { ABILITY_INSTRUCTIONS, ABILITY_SUMMARY, COMBO_INSTRUCTIONS, COMBO_SUMMARY, abilityWords, bindingLines, comboWords, creatureBindings } from "./creature-abilities"
import { BOSS_INSTRUCTIONS, BOSS_SUMMARY, bossOwn, bossWords } from "./creature-boss"
import { STEADY_INSTRUCTIONS } from "./creature-steady"
import { COMBAT_INSTRUCTIONS, TARGET_BEARING_INSTRUCTIONS } from "./combat"
import { STANCE_INSTRUCTIONS } from "./stances"
import { TACTICS_INSTRUCTIONS, TACTICS_SUMMARY } from "./ability-tactics"
import { BOSS_WEATHER_INSTRUCTIONS } from "./boss-weather"
import { FLIGHT_INSTRUCTIONS, FLIGHT_SUMMARY, HABITS_INSTRUCTIONS, flightClipRoles, flightLands, flightWords, habitClipRoles, habitsWords } from "./creature-flight"
import { effectEvents, effectLookup } from "./effect-abilities"
import { HITBOX_INSTRUCTIONS, HITBOX_SUMMARY } from "./creature-hitbox"

/**
 * What makes a creature alive, read from its document: which motions its behaviour needs, what its
 * death gives, where it turns up by itself, and the answers it gives to the four playability questions
 * (`playable.ts`). Nothing here knows a subject; every sentence is made from the numbers and names of the
 * document it is about. No Node APIs: the app's window reads it too.
 */

type Creature = Pick<Project["entities"][number], "behavior" | "attack_damage" | "runtime" | "loot" | "experience" | "stationary" | "abilities" | "combos" | "engagement" | "boss" | "flight" | "habits" | "tempt" | "identifier">
/** The abilities a creature really uses: only one that fights has anybody to use them on. */
export const usedAbilities = (creature: Pick<Creature, "behavior" | "abilities">) => (creature.behavior === "hostile" ? (creature.abilities ?? []) : [])
/** Its combos, which only a creature that fights uses (the same rule as its abilities). */
export const usedCombos = (creature: Pick<Creature, "behavior"> & { combos?: Creature["combos"] }) => (creature.behavior === "hostile" ? (creature.combos ?? []) : [])

const span = (min: number, max: number) => (min === max ? String(min) : `${min}–${max}`)
const percent = (chance: number) => `${Number((chance * 100).toFixed(1))}%`
const SPAWN_GROUPS: Record<(typeof SPAWN_BIOME_TAGS)[number], string> = { ...ORE_BIOME_GROUPS, is_overworld: "整个主世界", is_nether: "整个下界", is_end: "整个末地" }

/** Motions the generated creature plays by itself when its model has them, besides idle, walk and hurt which it always plays. */
export const MOTIONS_WHEN_PRESENT = ["death", "attack"] as const

/** Hits with its own body: the generated creature swings at a player it has reached. One that explodes instead never swings. */
export const attacksInMelee = (creature: Pick<Creature, "behavior" | "attack_damage" | "runtime">) => creature.behavior === "hostile" && creature.attack_damage > 0 && !creature.runtime?.explosion

/**
 * The motions a creature's model needs, derived from what the creature does, each with why and with what
 * the game shows when the motion is missing. `required` motions are the ones generated code names
 * outright: a model without one cannot be built. The others have a vanilla fallback that still shows
 * something, so a model without one builds, and the gap is said instead of hidden.
 */
export function creatureClipNeeds(creature: Pick<Creature, "behavior" | "attack_damage" | "runtime" | "abilities" | "flight" | "habits">): { clip: string; why: string; required: boolean; without: string; fix?: string }[] {
  const abilities = usedAbilities(creature)
  return [
    { clip: "idle", why: "闲着的时候", required: true, without: "" },
    { clip: "walk", why: "走动的时候", required: true, without: "" },
    { clip: "hurt", why: "被打的时候", required: true, without: "" },
    { clip: "death", why: "被打死的时候", required: false, without: "只会像原版生物那样变红、侧身倒下，一秒后消失" },
    // With abilities it fights with those, each on a motion of its own; the plain attack motion is then only for gameplay code that calls doHurtTarget.
    ...(attacksInMelee(creature) && !abilities.length ? [{ clip: "attack", why: "出手打人的时候", required: false, without: "它打人的时候自己身上看不出在出手，只有玩家那边掉血" }] : []),
    ...abilities
      .filter((ability, index) => abilities.findIndex((other) => other.clip === ability.clip) === index)
      .map((ability) => ({
        clip: ability.clip,
        why: `用招式「${ability.name}」的时候`,
        required: false,
        without: "这个招式播不出来，打包会被退回",
        fix: `全长至少 ${ability.length} 秒；前 ${ability.windup} 秒是看得出来的蓄力，打到的那一下落在第 ${ability.hits.map((hit) => hit.at).join("、")} 秒。`,
      })),
    // Flight and habits (10-12): the motions they play, each on a motion of its own.
    ...[...flightClipRoles(creature.flight), ...habitClipRoles(creature.habits)].map((role) => ({ clip: role.clip, why: role.why, required: false, without: "这个动作播不出来，打包会被退回", fix: `${role.fix}` })),
  ]
}

/** Motions the game itself stands in for when a model has none: it shows its own fall on death and the hit on a plain melee swing. */
const FALLBACK_CLIPS: readonly string[] = ["death", "attack"]

/** The needed motions a model does not have, as plain findings. `clips` are the model's animation names. */
export function creatureClipFindings(creature: Pick<Creature, "behavior" | "attack_damage" | "runtime" | "abilities" | "flight" | "habits"> & { name: string }, clips: readonly string[]) {
  return creatureClipNeeds(creature)
    .filter((need) => !need.required && !clips.includes(need.clip))
    .map((need) => ({
      clip: need.clip,
      text: `「${creature.name}」${need.why}没有自己的动作：${need.without}。`,
      fix: `给它的模型加一个名叫 ${need.clip} 的动作（${motionName(need.clip)}）。${need.fix ? need.fix : need.clip === "attack" ? "出手的那一下放在动作开头 0.25 秒以内，伤害是一挥就算的。" : `最长 ${CREATURE_LIFE_LIMITS.death_seconds} 秒，播完它才消失。`}`,
    }))
}

/** What a loot line names, the way a player would say it. */
const dropName = (project: Pick<Project, "blocks" | "items">, item: string) =>
  item.startsWith("minecraft:") ? (VANILLA_ITEM_NAMES[item.slice("minecraft:".length)] ?? item) : ([...project.items, ...project.blocks].find((value) => value.identifier === item)?.name ?? item)

/** What a lair's floor or rim names, the way a player would say it: this project's block by its name, a vanilla block by the name of its item (a block with no item, by its id). */
const lairBlockName = (project: Pick<Project, "blocks">, block: string) =>
  block.startsWith("minecraft:") ? (VANILLA_ITEM_NAMES[block.slice("minecraft:".length)] ?? block) : (project.blocks.find((value) => value.identifier === block)?.name ?? block)

/** 「面包」或「小麦种子」: the items that lure a follower, by the names a player knows. */
const lureNames = (project: Pick<Project, "blocks" | "items">, tempt: readonly string[]) => tempt.map((item) => `「${dropName(project, item)}」`).join("或")

/** r29 (第 2 件): the moments of `spawn.time` and `spawn.weather` by the names a player knows. */
export const SPAWN_TIME_WORDS: Record<(typeof SPAWN_TIMES)[number], string> = { dawn: "黎明", day: "白天", dusk: "黄昏", night: "夜里" }
export const SPAWN_WEATHER_WORDS: Record<(typeof SPAWN_WEATHERS)[number], string> = { clear: "晴天", rain: "下雨", thunder: "打雷" }
/** 「白天不出现，黄昏和夜里是平时的 2 倍；打雷时是平时的 2 倍」: what `time` and `weather` change, in a player's words; nothing for a moment left at 1. */
const momentWords = (spawn: Pick<NonNullable<EntityRuntime["spawn"]>, "time" | "weather">) => {
  const said = (scales: Record<string, number | undefined> | undefined, names: Record<string, string>) => {
    const changed = Object.keys(names).filter((key) => (scales?.[key] ?? 1) !== 1)
    const joined = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join("、")}和${words.at(-1)}` : words.join(""))
    const groups = [...new Set(changed.map((key) => scales![key]!))].map((scale) => `${joined(changed.filter((key) => scales![key] === scale).map((key) => names[key]!))}${scale === 0 ? "不出现" : `是平时的 ${Number(scale.toFixed(2))} 倍`}`)
    return groups.length ? [groups.join("，")] : []
  }
  return [...said(spawn.time, SPAWN_TIME_WORDS), ...said(spawn.weather, SPAWN_WEATHER_WORDS)]
}

/** The vanilla structures by the names a player knows (r29 `spawn.near`); one not here is said by its id. */
export const VANILLA_STRUCTURE_NAMES: Record<string, string> = {
  village_plains: "平原村庄", village_desert: "沙漠村庄", village_savanna: "热带草原村庄", village_snowy: "雪原村庄", village_taiga: "针叶林村庄",
  desert_pyramid: "沙漠神殿", jungle_pyramid: "丛林神庙", igloo: "雪屋", swamp_hut: "女巫小屋", pillager_outpost: "掠夺者前哨站", mansion: "林地府邸",
  monument: "海底神殿", stronghold: "要塞", fortress: "下界要塞", bastion_remnant: "堡垒遗迹", end_city: "末地城", ancient_city: "远古城市", trail_ruins: "古迹废墟",
  trial_chambers: "试炼密室", mineshaft: "废弃矿井", mineshaft_mesa: "恶地废弃矿井", shipwreck: "沉船", shipwreck_beached: "搁浅的沉船", ocean_ruin_cold: "冷水海底废墟",
  ocean_ruin_warm: "温水海底废墟", buried_treasure: "埋藏的宝藏", nether_fossil: "下界化石", ruined_portal: "废弃传送门", ruined_portal_desert: "沙漠废弃传送门",
  ruined_portal_jungle: "丛林废弃传送门", ruined_portal_mountain: "山地废弃传送门", ruined_portal_nether: "下界废弃传送门", ruined_portal_ocean: "海洋废弃传送门", ruined_portal_swamp: "沼泽废弃传送门",
}
/** 「平原村庄」「Boss 的巢」: a structure a creature keeps to, without the project (a lair is named by its boss where the project is known: `projectStructureWords`). */
export const structureWords = (ref: StructureRef) =>
  typeof ref !== "string" ? "一只 Boss 的巢" : ref.startsWith("minecraft:") ? `「${VANILLA_STRUCTURE_NAMES[ref.slice("minecraft:".length)] ?? ref}」` : `别的模组的结构「${ref}」`
/** The same, with a lair named by its boss: 「「蛇神」的巢」. */
export const projectStructureWords = (project: Pick<Project, "entities" | "workspace">) => (ref: StructureRef) =>
  typeof ref === "string" ? structureWords(ref) : ((owner) => (owner ? `「${owner.entity.name}」的巢` : structureWords(ref)))(lairOwner(project, ref.lair))

/** 「召唤小毒蛙」「守卫」: the gameplay of a list, by the names the project shows them by. */
const gameplayNames = (holds: readonly Pick<GameplayHold, "title">[]) => holds.map((hold) => `「${hold.title}」`).join("、")

export const creatureWords = {
  /**
   * What a creature's card says when gameplay code is about it, and from which gameplay (the generic words of its temper and of whom it fights are what it does
   * by itself; code that rules on its targets or adds to its behaviour takes part of that over, and the card must not hide it). Only what the project and the code
   * written out say: `target` when the code names the creature in `targetRule` or `addTargetGoal`, `goals` for `addGoal`, otherwise only that the gameplay is about
   * the creature, and then the words are "may change", never what it changes. Null for each part when there is nothing to say.
   */
  held: (holds: readonly GameplayHold[]) => {
    const deciding = holds.filter((hold) => hold.target)
    return {
      /** Beside its temper and its target, as a clause: who takes over whom it fights. Null when no gameplay does. */
      target: deciding.length ? `玩法${gameplayNames(deciding)}的代码给它设了打谁的规则，实际打谁以那个玩法为准` : null,
      /** One line for each gameplay that is about the creature, saying which hand it has on it. Empty when none is. */
      lines: holds.map((hold) => `${gameplayNames([hold])}：${hold.target ? "管它打谁（代码里给它设了打谁的规则）" : hold.goals ? "给它加了自己的行为" : "用到了它"}`),
      /** The sentence that goes above those lines. */
      lead: "下面的玩法用到了这只生物，可能会改变它的行为，具体见各个玩法的说明（Studio 是从代码里读出来的，没有运行过）：",
      /** For 高级: how each was read. */
      detail: holds.map((hold) => `${hold.title}: ${[hold.target ? "targetRule/addTargetGoal" : "", hold.goals ? "addGoal" : "", !hold.target && !hold.goals ? "uses or ProjectContent.entity/isEntity" : ""].filter(Boolean).join(", ")}`),
    }
  },
  /** 「玩家手里拿着「面包」或「小麦种子」时会跟过来，不打人」: what lures a follower, by the names a player knows; without `tempt` it is the wheat it always was. */
  lure: (tempt: readonly string[] | null | undefined, project: Pick<Project, "blocks" | "items">) =>
    `玩家手里拿着${tempt?.length ? lureNames(project, tempt) : "小麦"}时会跟过来，不打人`,
  /** 「会自己出现在这些群系：平原、森林一类的群系，一次 1–2 只；只在暗处出现，和平难度下不出现」. `structure`: how a structure it keeps to is called (r29 `spawn.near`). */
  spawn: (spawn: NonNullable<EntityRuntime["spawn"]>, behavior: Creature["behavior"], structure: (ref: StructureRef) => string = structureWords) => {
    const light = spawn.light ?? (behavior === "hostile" ? "dark" : "any")
    const rules = [...momentWords(spawn), ...(spawn.near ? [`只在${spawn.near.structures.map(structure).join("或")}${spawn.near.distance ? `周围 ${spawn.near.distance} 格以内` : "的范围里"}出现（只有新生成的区块里才有这些结构）`] : []), ...(light === "dark" ? ["只在暗处出现"] : light === "bright" ? ["只在亮处出现"] : []), ...(spawn.above_sea ? [`只在比海平面高 ${spawn.above_sea} 格以上的地面上出现`] : []), ...(spawn.cap ? [`${spawn.cap.radius} 格范围内（不管高低）最多同时有 ${spawn.cap.count} 只，满了就不再刷出来（刚造出来的新地方头一批游戏数不到，偶尔会多一两只）`] : []), ...(behavior === "hostile" ? ["和平难度下不出现"] : [])]
    return `会自己出现在这些群系：${creatureWords.places(spawn)}，一次 ${span(spawn.min, spawn.max)} 只${rules.length ? `；${rules.join("，")}` : ""}`
  },
  /**
   * 「它的巢随世界一起生成：……游戏里用 /locate structure 模组:名字_lair 找」: how a boss with a lair is met in the world, or null when it has none (only a hostile creature is a boss).
   * The one reading every place that says how a creature can be met goes through (the creature's facets, its section of the guide, its card).
   */
  lair: (project: Pick<Project, "blocks" | "mod_id">, creature: Pick<Creature, "behavior" | "boss" | "identifier">, modelAssetId: string): string | null => {
    const lair = creature.behavior === "hostile" ? (creature.boss?.lair ?? null) : null
    return lair ? bossWords.lair(lair, creatureWords.places(lair), `${project.mod_id}:${creatureName({ id: modelAssetId, identifier: creature.identifier })}_lair`, (block) => lairBlockName(project, block)) : null
  },
  /**
   * r29: 「跟着「蛇神」的巢一起生成：每座巢 3–4 只……」: how a creature put in a lair as it is made is met, with the boss it goes through; null without a garrison
   * (or with one whose lair is not there: that is said as a fault, `creatureStructureIssues`).
   */
  garrison: (project: Pick<Project, "entities" | "workspace" | "mod_id">, garrison: EntityRuntime["garrison"]) => {
    const owner = garrison ? lairOwner(project, garrison.structure.lair) : null
    if (!garrison || !owner) return null
    return {
      words: `跟着「${owner.entity.name}」的巢一起生成：每座巢里放 ${span(garrison.min, garrison.max)} 只，站在平台上守着，不会自己消失，打败了不会再补；只有新生成的区块里才有，想找到巢：按 T 打开聊天框，粘贴 \`/locate structure ${project.mod_id}:${owner.registry}_lair\` 再按回车`,
      through: [owner.asset],
    }
  },
  /** r29 (第 2 件): 「黄昏和夜里是平时的 2 倍」: what the time of day and the weather change of how often it turns up; empty when neither is written. */
  moments: (spawn: Pick<NonNullable<EntityRuntime["spawn"]>, "time" | "weather">) => momentWords(spawn),
  /** 「平原、森林一类的群系」: the biomes and groups of biomes it turns up in, by the names a player knows. */
  places: (spawn: Pick<NonNullable<EntityRuntime["spawn"]>, "biomes" | "tags">): string => [...spawn.biomes.map(biomeName), ...(spawn.tags ?? []).map((tag) => (tag in ORE_BIOME_GROUPS ? `${SPAWN_GROUPS[tag]}一类的群系` : SPAWN_GROUPS[tag]))].join("、"),
  /** 「2–3 个「蓝晶碎片」；25% 的机会掉 1 个「钻石」（要玩家亲手打败）」 */
  loot: (loot: readonly CreatureLoot[], project: Pick<Project, "blocks" | "items">) =>
    loot.map((drop) => `${drop.chance < 1 ? `${percent(drop.chance)} 的机会掉 ` : ""}${span(drop.min, drop.max)} 个「${dropName(project, drop.item)}」${drop.player_only ? "（要玩家亲手打败）" : ""}`).join("；"),
}

/** Why a creature's loot cannot be built in this project, in plain words; empty when it can. */
export function creatureLootIssues(project: Pick<Project, "blocks" | "items">, creature: Pick<Creature, "loot"> & { name: string }) {
  const known = new Set([...project.items, ...project.blocks].map((value) => value.identifier))
  return (creature.loot ?? [])
    .filter((drop) => !drop.item.startsWith("minecraft:") && !known.has(drop.item))
    .map((drop) => `生物「${creature.name}」的掉落物「${drop.item}」在这个工程里找不到。先把这样物品或方块做出来，或者写成 minecraft:名字 的原版物品。`)
}

/** Why a boss's lair cannot be built in this project, in plain words; empty when it can. A block of its own is one of this project's blocks (an item cannot be placed); a vanilla one was checked with the document. */
export function creatureTerrainIssues(project: Pick<Project, "blocks">, creature: Pick<Creature, "abilities">) {
  const known = new Set(project.blocks.map(block => block.identifier))
  return (creature.abilities ?? []).flatMap(ability => ability.events.flatMap(event =>
    event.type === "terrain_rise" && event.material && !event.material.includes(":") && !known.has(event.material)
      ? [`招式「${ability.name}」的地形材质「${event.material}」在工程里找不到。先制作这个方块，或选 minecraft:stone 等原版方块。`] : []))
}

export function creatureLairIssues(project: Pick<Project, "blocks">, creature: Pick<Creature, "boss"> & { name: string }) {
  const known = new Set(project.blocks.map((value) => value.identifier))
  const lair = creature.boss?.lair
  if (!lair) return []
  return [...lair.floor, ...(lair.rim ? [lair.rim] : [])]
    .filter((block, place, all) => !block.startsWith("minecraft:") && !known.has(block) && all.indexOf(block) === place)
    .map((block) => `生物「${creature.name}」的巢用了方块「${block}」，在这个工程里找不到。先把这个方块做出来，或者写成 minecraft:名字 的原版方块。`)
}

/**
 * r29: the boss a `{ lair }` names (`spawn.near`, `garrison`), found by the creature's own asset id or by its model's (the id the generated mod names it by), when it is a
 * hostile creature with a lair; else null. `registry`: its name in the game, `asset`: the id the playability graph knows it by.
 */
export function lairOwner(project: Pick<Project, "entities" | "workspace">, id: string) {
  const asset = project.workspace.assets.find((value) => value.document.kind === "entity" && (value.id === id || value.document.model_asset_id === id))
  const modelId = asset?.document.kind === "entity" ? asset.document.model_asset_id : id
  const entity = project.entities.find((value) => value.id === modelId)
  if (!entity || entity.behavior !== "hostile" || !entity.boss?.lair) return null
  return { entity, registry: creatureName(entity), asset: asset?.id ?? entity.id }
}

/** The `{ lair }` references of a creature's `spawn.near` and `garrison`, in the order written. */
const lairRefs = (runtime: EntityRuntime | null | undefined) => [...(runtime?.spawn?.near?.structures ?? []).flatMap((ref) => (typeof ref === "string" ? [] : [ref.lair])), ...(runtime?.garrison ? [runtime.garrison.structure.lair] : [])]

/** r29: why a creature kept to a lair cannot be built in this project, in plain words; empty when it can: every lair it names is a boss of this project that has one. */
export function creatureStructureIssues(project: Pick<Project, "entities" | "workspace">, creature: Pick<Creature, "runtime"> & { name: string }) {
  return [...new Set(lairRefs(creature.runtime))].filter((id) => !lairOwner(project, id)).map((id) => {
    const found = project.entities.find((value) => value.id === id) ?? project.entities.find((value) => project.workspace.assets.some((asset) => asset.id === id && asset.document.kind === "entity" && asset.document.model_asset_id === value.id))
    return found
      ? `生物「${creature.name}」要守在「${found.name}」的巢边上，可是「${found.name}」${found.behavior !== "hostile" ? "不是敌对生物，当不了 Boss" : "没有巢（boss.lair）"}。先给它做一个巢，或者把 spawn.near / garrison 里的这一项改掉。`
      : `生物「${creature.name}」要守的巢（lair: ${id}）在这个工程里找不到：没有这个编号的生物。写那只 Boss 生物的编号，或者把这一项去掉。`
  })
}

/** Vanilla structures whose box is a few blocks across (a hut, a portal, a chest in the sand): a creature kept to the box alone has almost nowhere to turn up. */
const SMALL_STRUCTURES = new Set(["igloo", "swamp_hut", "buried_treasure", "nether_fossil", "shipwreck", "shipwreck_beached", "ruined_portal", "ruined_portal_desert", "ruined_portal_jungle", "ruined_portal_mountain", "ruined_portal_nether", "ruined_portal_ocean", "ruined_portal_swamp"])
/** How wide (blocks across the middle) a place has to be for a natural spawn to find it often enough: two thirds of a chunk. */
const NEAR_ROOM = 8

/**
 * r29: what is worth saying about where a creature keeps to, beside the faults (`creatureStructureIssues`): a place so small it would hardly ever turn up there, a structure
 * one of the project's targets does not have, guards taller than the air over the lair they stand in. Each finding names what to change.
 */
export function structureFindings(project: Pick<Project, "entities" | "workspace" | "target"> & { targets?: readonly string[] | undefined }, creature: Pick<Creature, "runtime"> & { name: string; hitbox?: { core: { height: number } } | null }) {
  const near = creature.runtime?.spawn?.near
  const garrison = creature.runtime?.garrison
  const words = projectStructureWords(project)
  const old = [project.target, ...(project.targets ?? [])].includes("forge-1.20.1")
  const lairRadius = (ref: StructureRef) => (typeof ref === "string" ? null : (lairOwner(project, ref.lair)?.entity.boss?.lair?.radius ?? null))
  const small = (near?.structures ?? []).filter((ref) => {
    if (!near || near.distance >= NEAR_ROOM) return false
    if (typeof ref === "string") return ref.startsWith("minecraft:") && SMALL_STRUCTURES.has(ref.slice("minecraft:".length))
    const radius = lairRadius(ref)
    return radius !== null && radius + near.distance < NEAR_ROOM
  })
  const owner = garrison ? lairOwner(project, garrison.structure.lair) : null
  const clearance = owner?.entity.boss?.lair?.clearance
  const height = creature.hitbox?.core.height
  return [
    ...(small.length ? [{ rule: "spawn_near_small" as const, stops: false, text: `「${creature.name}」只在${small.map(words).join("、")}${near!.distance ? `周围 ${near!.distance} 格` : "的范围里"}出现，那一片太小了：自然生成在那里很难找到落脚的地方，游戏里几乎见不到它。`, fix: `把 spawn.near.distance 加到 ${NEAR_ROOM} 格以上，或者守在大一点的结构边上；想每座都有几只守着，用 runtime.garrison（只限本工程 Boss 的巢）。`, detail: `spawn.near.distance ${near!.distance}` }] : []),
    ...(old && near?.structures.some((ref) => typeof ref === "string" && ref.startsWith("minecraft:") && STRUCTURE_NOT_IN_1_20_1.has(ref.slice("minecraft:".length)))
      ? [{ rule: "spawn_near_small" as const, stops: false, text: `「${creature.name}」要守的${near!.structures.filter((ref) => typeof ref === "string" && STRUCTURE_NOT_IN_1_20_1.has(ref.slice("minecraft:".length))).map(words).join("、")}是 1.21 才有的结构，Forge 1.20.1 里没有：在那个版本里它不会在那里出现。`, fix: "给 Forge 1.20.1 也写一个它有的结构，或者接受这个版本里遇不到它。", detail: "structure not in 1.20.1" }]
      : []),
    ...(owner && clearance !== undefined && height !== undefined && clearance < Math.ceil(height)
      ? [{ rule: "creature_structure" as const, stops: true, text: `「${creature.name}」要站在「${owner.entity.name}」的巢上，可是巢上方清出来的空间只有 ${clearance} 格，它有 ${Number(height.toFixed(2))} 格高：放进去会被埋在岩石里。`, fix: `把「${owner.entity.name}」的 boss.lair.clearance 至少写 ${Math.ceil(height)}，或者换一个矮一点的生物守巢。`, detail: `lair.clearance ${clearance}; collision box height ${height}` }]
      : []),
  ]
}

/** Why a boss's summoning cannot be built in this project, in plain words; empty when it can: the item it is called with is one of this project's items or blocks, and the altar one of its blocks (vanilla ones were checked with the document). */
export function creatureSummonIssues(project: Pick<Project, "blocks" | "items">, creature: Pick<Creature, "boss"> & { name: string }) {
  const summon = creature.boss?.summon
  if (!summon) return []
  const items = new Set([...project.items, ...project.blocks].map((value) => value.identifier))
  const blocks = new Set(project.blocks.map((value) => value.identifier))
  return [
    ...(!summon.item.startsWith("minecraft:") && !items.has(summon.item) ? [`生物「${creature.name}」召唤用的「${summon.item}」在这个工程里找不到。先把这样物品或方块做出来，或者写成 minecraft:名字 的原版物品。`] : []),
    ...(summon.block && !summon.block.startsWith("minecraft:") && !blocks.has(summon.block) ? [`生物「${creature.name}」的召唤台「${summon.block}」在这个工程里找不到。先把这个方块做出来，或者写成 minecraft:名字 的原版方块。`] : []),
  ]
}

/** Why a follower's lure cannot be built in this project, in plain words; empty when it can. Same reading of a name as a drop's. */
export function creatureTemptIssues(project: Pick<Project, "blocks" | "items">, creature: Pick<Creature, "tempt"> & { name: string }) {
  const known = new Set([...project.items, ...project.blocks].map((value) => value.identifier))
  return (creature.tempt ?? [])
    .filter((item) => !item.startsWith("minecraft:") && !known.has(item))
    .map((item) => `生物「${creature.name}」的引诱物「${item}」在这个工程里找不到。先把这样物品或方块做出来，或者写成 minecraft:名字 的原版物品。`)
}

/** A summon is a source only if its local inputs can be reached too. */
export function bossSummonWay(project: Project, creature: Pick<Creature, "behavior" | "boss">) {
  const summon = creature.behavior === "hostile" ? creature.boss?.summon : null
  if (!summon) return null
  const refs = [summon.item, ...(summon.block ? [summon.block] : [])]
  return {
    refs,
    through: [...new Set(refs.filter((ref) => !ref.includes(":")))],
    words: bossWords.summon(summon, (reference) => dropName(project, reference)),
  }
}

/** Gameplay whose code brings this creature into the world: it reads the creature's type and calls a spawning method. */
function summoners(project: Pick<Project, "workspace">, ids: readonly string[]) {
  return project.workspace.assets.flatMap((asset) => {
    if (asset.document.kind !== "gameplay") return []
    const made = asset.document.sources.some((file) => {
      const scanned = stripJava(file.content)
      const type = `\\b${GAMEPLAY_API.content}\\s*\\.\\s*entity\\s*\\([^)]*\\)`
      // Either the type is spawned or created where it is read, or the file reads it and hands a new entity to the world.
      const spawns = new RegExp(`${type}\\s*\\.\\s*(?:spawn|create)\\s*\\(`).test(scanned.code) || (new RegExp(type).test(scanned.code) && /\.\s*spawn(?:New)?Entity(?:AndPassengers)?\s*\(/.test(scanned.code))
      return spawns && scanned.strings.some((text) => ids.includes(text.value))
    })
    return made ? [{ id: asset.id, title: contentName(asset) }] : []
  })
}

type EntityDocument = Extract<ModuleDocument, { kind: "entity" }>

/**
 * A creature's answers to the four questions. Read against the whole project: its motions are its model's,
 * its drops name other things of the project, and gameplay code may be what brings it into the world.
 */
export function creatureFacets(document: EntityDocument, project: Project, studio = false): Facet[] {
  const model = project.workspace.assets.find((asset) => asset.id === document.model_asset_id)?.document
  const clips = model?.kind === "model" ? model.animations.map((animation) => animation.name) : null
  const own = project.workspace.assets.find((asset) => asset.document === document || (asset.document.kind === "entity" && asset.document.model_asset_id === document.model_asset_id))
  const summoned = summoners(project, [document.model_asset_id, ...(own ? [own.id] : [])])
  const ritual = bossSummonWay(project, document)
  const missing = clips ? creatureClipFindings(document, clips) : []
  const fallback = missing.filter((finding) => FALLBACK_CLIPS.includes(finding.clip))
  const unplayable = missing.filter((finding) => !FALLBACK_CLIPS.includes(finding.clip))
  const loot = document.loot ?? []
  const lair = creatureWords.lair(project, document, document.model_asset_id)
  const garrison = creatureWords.garrison(project, document.runtime.garrison)
  const lucky = document.runtime.death_drop
  const gives = [
    ...(loot.length ? [`打败它会掉 ${creatureWords.loot(loot, project)}`] : []),
    ...(lucky ? [`玩家亲手打败它有 ${percent(lucky.chance)} 的机会掉一个「${project.blocks.find((block) => block.identifier === lucky.block_identifier)?.name ?? lucky.block_identifier}」`] : []),
    ...(document.experience ? [`给 ${document.experience} 点经验`] : []),
    // broad6 w4b: a duck that follows a player holding bread (a rule on the blueprint, made and seen in the game) was told it was
    // for nothing, because only what it drops was read. Leading it with an item is something it is for.
    // The same for the lure its own document names (`tempt`): a follower is led by the items it lists.
    ...(document.behavior === "follow" && document.tempt?.length ? [`玩家手里拿着${lureNames(project, document.tempt)}时它会跟着走`] : []),
    ...project.logic
      .filter((rule) => rule.enabled && rule.trigger === "holding_item" && rule.action === "follow" && rule.item && [document.model_asset_id, own?.id].includes(rule.entity_id))
      .map((rule) => `拿着「${dropName(project, rule.item!.startsWith(`${project.mod_id}:`) ? rule.item!.slice(project.mod_id.length + 1) : rule.item!)}」它会跟着你走`),
  ]
  // One that stays where it is on purpose (stationary) is not pushed off its place by a blow (its knockback resistance is full).
  const shoved = document.stationary ? "不会被打退（它守着原地）" : "被打退"
  const shown = clips ? creatureClipNeeds(document).filter((need) => clips.includes(need.clip) && !["idle", "walk"].includes(need.clip)) : []
  const idle = model?.kind === "model" ? model.animations.find((animation) => animation.name === "idle") : undefined
  // What it does to the one it fights, and which of its model's motions nothing starts: from the binding list.
  const abilities = usedAbilities(document)
  const bindings = model?.kind === "model" ? creatureBindings({ abilities, boss: document.behavior === "hostile" ? document.boss : null, flight: document.flight, habits: document.habits }, model.animations, project.logic.filter((rule) => rule.entity_id === document.model_asset_id), (id) => effectLookup(project)(id)?.title ?? null, (id) => soundLookup(project)(id)?.title ?? null) : null
  // H3: the effects each ability shows, by the names they have in this project; an ability that shows none reads as it always did.
  const showing = (ability: (typeof abilities)[number]) => ((titles) => (titles.length ? `，会出现效果${titles.map((title) => `「${title}」`).join("")}` : ""))([...new Set(effectEvents(ability).flatMap((found) => effectLookup(project)(found.event.effect)?.title ?? []))])
  // Gameplay code that rules on whom it fights takes that over from its own temper and engagement: said, with which gameplay.
  const taken = document.behavior === "hostile" && document.model_asset_id ? creatureWords.held(gameplayHolds(project, creatureName({ id: document.model_asset_id, identifier: document.identifier }))).target : null
  const fights = `${document.behavior === "hostile" && document.engagement ? `；${ENGAGEMENT_WORDS[document.engagement]}` : ""}${taken ? `；${taken}` : ""}${abilities.length ? `；出手用招式：${abilities.map((ability) => `「${ability.name}」（${abilityWords.start(ability)}${showing(ability)}）`).join("、")}` : ""}${usedCombos(document).length ? `；连招：${usedCombos(document).map((combo) => `「${combo.name}」（${comboWords.summary(combo, abilities, "，", studio, document.stagger)}）`).join("、")}` : ""}${document.behavior === "hostile" && document.boss ? `；它是 Boss：${bossWords.summary(document.boss, [...abilities, ...usedCombos(document)], "；", { ...bossOwn(document), displayNames: studio, title: id => project.workspace.assets.find(asset => asset.id === id)?.title ?? null, block: id => lairBlockName(project, id) }, document.flight)}` : ""}`
  // Flight and habits (10-12): what a player can check in the game, in the creature's own numbers.
  const lives = `${document.flight ? `；${flightWords.summary(document.flight)}${document.behavior === "hostile" && flightLands(abilities).length ? `；战斗时${flightWords.lands(flightLands(abilities).map((ability) => ability.name))}` : ""}` : ""}${document.habits ? `；${habitsWords.summary(document.habits)}` : ""}`
  return [
    // r29: kept only to lairs of this project, it is met where those bosses are (any one of them is enough, so only a lone lair is a step on the way).
    ...(document.runtime.spawn ? [{ question: "source" as const, answered: true, words: creatureWords.spawn(document.runtime.spawn, document.behavior, projectStructureWords(project)), through: ((refs) => (refs.length === 1 && typeof refs[0] !== "string" ? [lairOwner(project, refs[0]!.lair)?.asset ?? refs[0]!.lair] : []))(document.runtime.spawn.near?.structures ?? []) }] : []),
    ...(garrison ? [{ question: "source" as const, answered: true, words: garrison.words, through: garrison.through }] : []),
    // Its lair: a boss that a structure of the world's own generation places once (`LairSchema`), found with /locate; only a hostile creature is a boss.
    ...(lair ? [{ question: "source" as const, answered: true, words: lair, through: [] }] : []),
    ...summoned.map((gameplay) => ({ question: "source" as const, answered: true, words: `玩法「${gameplay.title}」的代码会把它放进世界（什么时候放，见那个玩法的说明）`, through: [gameplay.id] })),
    ...(ritual ? [{ question: "source" as const, answered: true, words: ritual.words, through: ritual.through }] : []),
    ...(document.runtime.spawn || summoned.length || lair || ritual || garrison ? [] : [{ question: "source" as const, answered: false, words: "不会自己出现：只能用它的刷怪蛋或者指令放出来，生存模式的玩家遇不到它", detail: "runtime.spawn is null and no gameplay code spawns it" }]),
    gives.length
      ? { question: "use", answered: true, words: gives.join("；"), ...(loot.length ? { detail: `loot: ${loot.map((drop) => drop.item).join(", ")}` } : {}) }
      : { question: "use", answered: false, words: "打败它什么都不掉，也不给经验" },
    // A motion with a vanilla fallback (dying, the swing of a plain melee hit) still leaves the creature reacting: the game shows its
    // own. Only a motion nothing stands in for (an ability's) leaves the question open. The fallback is said, never hidden.
    unplayable.length
      ? { question: "reaction", answered: false, words: unplayable.map((finding) => finding.text).join(""), detail: `missing clips: ${unplayable.map((finding) => finding.clip).join(", ")}` }
      : {
          question: "reaction",
          answered: true,
          words: clips
            ? `被打会变红、${shoved}${shown.length ? `，${shown.map((need) => `${need.why.replace(/的时候$/, "")}有自己的动作`).join("、")}` : ""}${fallback.length ? `；${fallback.map((finding) => finding.text.replace(/^「[^」]*」/, "").replace(/。$/, "")).join("；")}` : ""}${fights}`
            : `被打会变红、${shoved}、做受伤的动作；被打死会倒下消失${fights}`,
          ...(bindings ? { detail: bindingLines(bindings, true).join("\n") } : clips ? { detail: `clips: ${clips.join(", ")}` } : {}),
        },
    document.stationary
      ? { question: "idle", answered: true, words: `故意不走动（${document.stationary.reason}）；会转头看走近的玩家${idle ? "，一直做待机动作" : ""}` }
      : document.speed > 0
        ? {
            question: "idle",
            answered: true,
            // broad10 w4b: a boss asleep until somebody comes near was said to wander about, right after the guide said it sleeps.
            words: `${document.behavior === "hostile" && document.boss?.intro ? `一开始${document.habits ? "还没见过谁，习性说活动的时候照习性活动，说休息的时候睡着不动" : "睡着不动"}，有人走到 ${document.boss.intro.wake_distance} 格以内才醒；醒着` : ""}没事的时候自己四处走动、张望，看向走近的玩家，掉进水里会游${lives}`,
          }
        : { question: "idle", answered: false, words: "移动速度是 0，走不了：它只会原地转头，却没有说明为什么不动" },
  ]
}

type GameplayDocument = Extract<ModuleDocument, { kind: "gameplay" }>

/**
 * A gameplay's answers, from its own description. A gameplay starts itself with the mod, so it has no
 * source to find and no idle; what it is for and what the player sees are the behaviours it was reviewed against.
 */
export function gameplayFacets(document: GameplayDocument, project: Project): Facet[] {
  const titles = document.uses.flatMap((id) => project.workspace.assets.filter((asset) => asset.id === id).map(contentName))
  const short = (words: string) => (words.length > 150 ? `${words.slice(0, 149)}…` : words)
  return [
    { question: "source", answered: true, words: "装上模组就生效，不用玩家去拿", through: [] },
    { question: "use", answered: true, words: short(`${titles.length ? `挂在${titles.map((title) => `「${title}」`).join("、")}上：` : ""}${document.summary}`) },
    ...document.behaviours.map((behaviour) => ({ question: "reaction" as const, answered: true, words: short(`${behaviour.when}：${behaviour.shows}`) })),
  ]
}

const listed = (values: readonly string[]) => values.join("|")

/** How a creature comes to fight somebody, in a player's words. */
export const ENGAGEMENT_WORDS: Record<Engagement, string> = {
  any_player: "看见玩家就上去打（最近的那个）",
  provoked: "不主动打人，谁打了它它才打谁",
  none_by_itself: "自己不找人打，打谁由玩法决定",
}

/** What an AI is told about the field that says what lures a creature that follows. */
export const TEMPT_INSTRUCTIONS =
  ` tempt 只对会跟人的生物（behavior=follow）有意义，说玩家手里拿着什么它才跟过来：1 到 ${CREATURE_LIFE_LIMITS.tempt} 个物品，写法和 loot 的 item 一样（本工程物品或方块的标识符，或者 minecraft:名字 的原版物品，必须是 1.21.1 真有的物品）。用户说了要拿什么引它（“拿着面包会跟着走”），就把那样东西写进 tempt（minecraft:bread），不要因为它是跟随型就当成小麦；用户没说，省略 tempt 或写 null，就是拿着小麦。不跟人的生物写 tempt 会被退回。`

/** What an AI is told about the field that says whom a hostile creature fights. */
export const ENGAGEMENT_INSTRUCTIONS =
  ` engagement 只对敌对生物（behavior=hostile）有意义，说它怎么开打：${listed(ENGAGEMENT_MODES)}。any_player 是它自己去打 ${ENGAGEMENT_LIMITS.distance} 格内看得见的、最近的玩家（有招式够得比 ${ENGAGEMENT_LIMITS.distance} 格更远的，按它最远的那个招式算）；provoked 是它不主动，只打刚打了它的；none_by_itself 是它自己从不找人，只打玩法代码给它的目标。不管哪一种，它追、出手、用招式都只对它当下的目标，目标死了、离开这个距离、${ENGAGEMENT_LIMITS.unseen_ticks / 20} 秒看不见就放手，没有目标的时候照常闲逛。省略或 null 是老样子：自己追最近的玩家。它该打谁要看条件（离某个地方多近、玩家拿着什么、时间）的时候，条件写在玩法代码里（ProjectContent.targetRule），这里只选它自己主不主动。`

/** What an AI is told about the creature's own `justified`: the way out of a measured fault that is how this creature is meant to be. */
export const JUSTIFIED_INSTRUCTIONS =
  ` justified 是这只生物自己的“本来就该这样”清单，可以不写：[{what, reason}]，最多 ${CREATURE_JUSTIFIED_MOST} 条。量出来的毛病里，有几样要看这只生物是什么才知道算不算毛病（它滑着走是不是本来的样子，一个招式有没有蓄力要不要紧），退回的话里会写明这一项叫什么、怎么回答；你确定它本来就该这样，就照那句话在这里写上这一项的名字（what）和一句理由（reason），理由会原样给评审和人看，评审判断说不说得通；写了的不再算硬伤，没写的还是要改。招式的一项叫“招式 id:项目”，例如 {"what":"thorns:windup","reason":"荆棘一碰就刺，本来就不蓄力"}。`

/** r29c: what an AI is told about the motions a creature keeps for a behaviour still to come (`later_clips`). */
export const LATER_CLIPS_INSTRUCTIONS =
  ` later_clips 可以不写：模型里留给以后的行为、现在还没有招式或规则播的动作，[{clip, reason}]，例如 {"clip":"circle","reason":"留给以后绕着光走的行为"}；写了的打包时只提醒“看看”，不算要改。`

/** r29: what an AI is told about keeping a creature to a structure (`spawn.near`) and putting it in a boss's lair as the lair is made (`garrison`). */
export const SPAWN_NEAR_INSTRUCTIONS =
  ` 按时候和天气多刷少刷（都可不写，不写是全天、什么天气都一样，老样子）：runtime.spawn.time = {dawn, day, dusk, night}，runtime.spawn.weather = {clear, rain, thunder}，每一项 ${SPAWN_WHEN_LIMITS.scale.min}–${SPAWN_WHEN_LIMITS.scale.max}，是平时的几倍（1 是平时，0 是这时候不出现，2 是多一倍），没写的那一项算 1。时候按主世界的钟（黎明 22200–1000、白天 1000–12000、黄昏 12000–13800、夜里 13800–22200 刻），天气按整个世界（下雨时沙漠里也算下雨）。最常见的那个时候按 weight 刷，别的时候按比例少。只白天：{"time":{"dusk":0,"night":0,"dawn":0}}；只夜里：{"time":{"day":0,"dawn":0}}；黄昏和夜里更多：{"time":{"dusk":2,"night":2}}；下雨打雷时多一倍：{"weather":{"rain":2,"thunder":2}}。敌对生物本来就只在暗处出现（light），所以白天地面上本来就少，可是山洞、树荫底下白天也会刷：要白天哪里都不出，才写 time。` +
  ` 只在某个结构附近刷：runtime.spawn.near（可不写）= {structures: [结构], distance: ${NEAR_LIMITS.distance.min}–${NEAR_LIMITS.distance.max}}，自然生成时除了上面的群系、光照这些条件，还要刷出来的那个点在其中一个结构的范围里（distance 写 0）或者离它的范围不超过 distance 格（只量水平距离）。结构写原版的 minecraft:名字（例如 minecraft:village_plains；村庄有 village_plains、village_desert、village_savanna、village_snowy、village_taiga 五种，要“所有村庄附近”就五个都写），别的模组的写 那个模组的id:结构名（那个模组没装就永远刷不出来），本工程 Boss 的巢写 {"lair": "那只 Boss 生物的编号"}；最多 ${NEAR_LIMITS.structures} 个。biomes/tags 仍然要写，表示允许的群系：只想跟着结构走、不限群系，就写 tags ["is_overworld"]。结构只在新生成的区块里有。不写 near 是群系里哪里都刷，老样子。` +
  ` 跟着巢一起放好、杀了不再刷：runtime.garrison（可不写）= {structure: {"lair": "那只 Boss 生物的编号"}, min, max}（${NEAR_LIMITS.guards.min}–${NEAR_LIMITS.guards.max}），那只 Boss 的巢在世界生成的时候，平台上除了 Boss 再放 min–max 只这种生物，围在 Boss 周围；它们不会自己消失，打败了不会再补。适合守神殿的卫兵、守石阶的兽。现在只能放进本工程 Boss 的巢；原版或别的模组的结构没法在生成时放生物，用 spawn.near。只想要这种放法、不想它在野外自然刷，就把 spawn 写成 null，它照样算“在世界里遇得到”。不写或 null 是没有，老样子。以后有了结构资产，structure 会多一种 {"asset": 结构资产编号} 的写法。` +
  ` 例（神殿卫兵，每座巢 3–4 只，平时也只在巢周围 16 格里刷）：{"runtime":{"spawn":{"biomes":[],"tags":["is_overworld"],"near":{"structures":[{"lair":"Boss 的编号"}],"distance":16},"weight":10,"min":1,"max":2},"garrison":{"structure":{"lair":"Boss 的编号"},"min":3,"max":4}}}。`

/** What an AI is told about the fields that make a creature alive. One text: the registry, the hand-off and the capability list read it. */
export const CREATURE_LIFE_INSTRUCTIONS =
  " 生物天生是活的：没事的时候自己闲逛、张望、看向走近的玩家、掉进水里会游，被打会变红、被打退一段，这些不用写，也不能去掉。只有它本来就不该走动（例如长在地上的、被固定住的、守在塔上的炮塔）才写 stationary={reason}，reason 用一句话说清为什么，会原样显示给用户；省略或 null 就是会闲逛。写了 stationary 的生物不走（速度 speed 写 0 也行）、不追、不闲逛、不会被打退，只会转身面向目标；所以它的招式要有远处能用的（射出去的 shot、长的光束或锥形），只有近身招式的，玩家不走到它身边它就什么也做不了。" +
  ` loot 是它被打败时掉的东西，最多 ${CREATURE_LIFE_LIMITS.loot} 行：[{item, min, max, chance, player_only, looting?}]。item 写本工程物品或方块的标识符，或者 minecraft:名字 的原版物品（必须是 1.21.1 真有的物品）；min/max 是数量，chance 是这一行掉落的机会（大于 0，最多 1），player_only=true 表示只有玩家亲手打败才掉。掉落会随抢夺附魔变多（每级最多多 1 个），Boss 的掉落不会——原话说掉几个就是几个；要改就写 looting（true 或 false）。尊重 doMobLoot。experience 是打败它给的经验点数（0 到 ${CREATURE_LIFE_LIMITS.experience}，僵尸是 5；写了 boss 的生物最多 ${CREATURE_LIFE_LIMITS.boss_experience}，凋灵是 50，末影龙第一次是 12000）。一只打败了什么都不给的生物没有意义：没有特别说明时，按它的强弱给一份合理的掉落和经验。` +
  ` runtime.spawn 让它自己出现在世界里：{biomes: [原版群系 id], tags: [${listed(SPAWN_BIOME_TAGS)}], light: dark|bright|any, above_sea（可不写）, cap（可不写）, weight, min, max}。biomes 和 tags 至少写一样，tags 是一整类群系（is_overworld 是整个主世界）；light 省略时敌对生物只在暗处出现、其余不限；above_sea（1–256 的整数，可不写）让它只在地面比海平面（主世界是 63）高这么多格以上的地方出现，用来做山顶、高地的生物（主世界建筑高度到 320，比海平面高 257，所以最多写 256；大多数山地的山顶比海平面高 40–120 格，写 60 左右就是山上；不写是不限高度，老样子）；cap（可不写）是“一处地方最多几只”：{count: ${SPAWN_CAP_LIMITS.count.min}–${SPAWN_CAP_LIMITS.count.max}, radius: ${SPAWN_CAP_LIMITS.radius.min}–${SPAWN_CAP_LIMITS.radius.max}}，自然生成时数一数以刷出来的那个点为中心、radius 格以内（只量水平距离，天上飞的也算这一处）已经有几只同一种生物，数到 count 就不再刷，所以一群会刷到满为止、不会超过。要“一群 1–2 只，但 48 格内不超过 2 只”就写 min 1、max 2、cap {"count":2,"radius":48}。不要用玩法代码去做这件事：玩法代码接不到自然生成的判断，只能生成之后再删，那样玩家会看到生物冒出来又消失。只管自然生成（刷怪蛋、指令、刷怪笼不受限）；游戏刚造出一块新地方的那一刻数不到已有的生物，所以头一批偶尔会略多，之后就守住上限了。不写 cap 是不限数量，老样子；weight 是相对多少（僵尸是 100，末影人是 10），min/max 是一群几只。spawn 为 null 时它只能用刷怪蛋放出来，生存模式的玩家遇不到：除非有玩法代码负责把它放进世界，否则应该给它写上 spawn。` +
  SPAWN_NEAR_INSTRUCTIONS +
  ` 例：{"loot":[{"item":"azure_shard","min":1,"max":2,"chance":1,"player_only":false},{"item":"minecraft:diamond","min":1,"max":1,"chance":0.1,"player_only":true}],"experience":8,"stationary":null}。` +
  TEMPT_INSTRUCTIONS +
  ENGAGEMENT_INSTRUCTIONS +
  ABILITY_INSTRUCTIONS +
  COMBO_INSTRUCTIONS +
  TACTICS_INSTRUCTIONS + STEADY_INSTRUCTIONS + "\n" + COMBAT_INSTRUCTIONS + "\n" + TARGET_BEARING_INSTRUCTIONS + "\n" + STANCE_INSTRUCTIONS +
  "\n启用稳重的生物可用 on_hurt.front_yaw 为单招指定正面反击的左右半角（0–90°）。省略时沿用头的左右偏角，上限 90°。" +
  "\n硬直开始时收住自己的走路、前踏、跳扑和冲刺。外来击退仍有作用，人在空中照常落地。stagger.knockback_scale 可把硬直期间的击退乘 0 到 1，不写沿用平时。小体型可留满值，大型可从 0.7 试，巨型和超巨型可从 0.5 试。" +
  "\n模型没有专门的硬直动作时，stagger.clip 可以写 hurt，普通受击不会把它从头重播。待机、走路、死亡动作继续留给各自的状态。招式可以只用破绽组的 breaks 打断。stopped_by_hurt 省略时按 false 处理，普通受击照常结算，招式继续。连招里符合条件的一步被打断，整套跟着停。" +
  BOSS_INSTRUCTIONS +
  BOSS_WEATHER_INSTRUCTIONS +
  FLIGHT_INSTRUCTIONS +
  HABITS_INSTRUCTIONS +
  HITBOX_INSTRUCTIONS +
  JUSTIFIED_INSTRUCTIONS +
  LATER_CLIPS_INSTRUCTIONS

export const CREATURE_LIFE_SUMMARY = "生物天生会闲逛、张望、游泳（只有写了 stationary 和原因才不走动）；可选：被打败的掉落（loot：本工程或原版物品、数量、机会、是否要玩家亲手打败）、经验（experience）、在哪些群系自己出现、一处最多几只、只在某个结构附近出现、按时候和天气多刷少刷（runtime.spawn 的 biomes、tags、light、above_sea、cap、near、time、weather）、跟着 Boss 的巢一起放好（runtime.garrison）、跟人的生物被什么物品引诱（tempt：不写就是小麦）、敌对生物怎么开打（engagement：自己找玩家、只还手、或只打玩法给的目标）。" + ABILITY_SUMMARY + COMBO_SUMMARY + TACTICS_SUMMARY + "大体型和 Boss 可写 steady，控制转身、看人和换目标。" + BOSS_SUMMARY + FLIGHT_SUMMARY + CREATURE_BABY.summary + HITBOX_SUMMARY + "可选：justified——量出来的、看这只生物是什么才知道算不算毛病的几样（滑着走、没有蓄力的招式），照退回的话写上名字和理由就不再算硬伤。"

/** What whoever makes a creature's model is told about its motions: the list follows from what the creature does. */
export const MODEL_CLIP_INSTRUCTIONS =
  ` 动作清单不是固定的三个，而是由这只生物会做的事决定：它闲着（idle）、会走（walk）、会挨打（hurt），这三个必须有；它会被打死，就做 death（倒下、碎开、熄灭……由你设计，最长 ${CREATURE_LIFE_LIMITS.death_seconds} 秒，游戏会等它播完再让尸体消失；没有这个动作时游戏只会让它像原版生物那样侧身倒下）；它会出手打人，就做 attack（出手的那一下放在开头 0.25 秒以内，每次出手游戏都会从头播一遍；没有这个动作时它打人自己身上看不出来）；需求、玩法说明或规则里答应过玩家看得见的其他举动（吼叫、蓄力、守卫姿态……），各做一个自己命名的动作，由规则或玩法代码来播。每个动作都要在游戏里那么大的画面上看得出来：受伤和出手要有明显的整体位移或大幅度摆动，不能只转一两度。这只生物要是有招式（生物文档的 abilities），每个招式的 clip 都要在模型里有一个同名的、不循环的动作，不能借用 idle、walk、hurt、death：先有一段看得出来的蓄力（往出手的反方向收，幅度要大，玩家靠它来躲），打到的那一下正好落在招式写的判定时刻（hits 的 at），之后收回；动作不能比招式的 length 短。这只生物要是会飞（生物文档的 flight）：起飞（takeoff，不循环，长度和 flight 里留的 seconds 一样）、落地（land，不循环，同样）、在天上扇翅（fly，循环）、滑翔（glide，循环，滑翔型必须有）或悬停（hover，循环，悬停型必须有）各做一个自己的动作，不能借用 idle、walk、hurt、death；起飞、落地的动作里身体要有大的整体变化（收腿、展翼、收翼），因为玩家就盯着这几秒看。有习性（habits）的，休息（rest，循环）、吃东西（eat，不循环）、警觉（alert，不循环，吼叫、竖起翅膀）也各做一个。` + LOOK_GUIDE + SWAY_GUIDE + WEIGHT_GUIDE

/** For a capability list: which motions the generated runtime plays by itself, and when. */
export const CREATURE_MOTION_SUMMARY = "生成的生物自己会播的动作：idle（闲着）、walk（走动）、hurt（挨打，立刻播）、death（模型里有就在死的时候播完再消失，没有就按原版侧身倒下）、attack（模型里有就在每次出手时播）。招式（abilities）的 clip 在那个招式开始时从头播。会飞的生物起飞、落地、在天上扇翅、滑翔或悬停时按飞行的状态播 flight 里写的动作；有习性的生物休息、吃东西、警觉时播 habits 里写的动作。其他名字的动作要由规则（play_animation）或玩法代码（ProjectContent.playMotion）来播。"
