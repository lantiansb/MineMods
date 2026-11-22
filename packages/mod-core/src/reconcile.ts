import { stanceClips, stanceFindings } from "./stances"
import { abilityRef, assetRef, blueprintRef, boneRef, clipRef, partRef, phaseRef, registryRef, uniqueFindingRefs } from "./finding-refs"
import { resolveSteady } from "./creature-steady"
import { betweenStages, isLeap } from "./ability-tactics"
import { bossPhaseIds } from "./boss-words"
import { contentName } from "./asset-name"
import { particleWeather } from "./particle-uses"
import { scatterFindings } from "./particle-preview"
import type { EmissionFinding } from "./particle-emission-findings"
import { resolveAliases } from "./particle-emission"
import { creatureVanillaGaps, targetMinecraft } from "./version-lacks"
import { motionLabel } from "@minemods/studio-ai/making"
import { shapeConflict } from "@minemods/studio-ai/block-shape"
import type { FindingRef } from "@minemods/studio-ai/acceptance"
import type { Project } from "./project"
import { creatureName } from "./gameplay"
import { registryClashWords, registryClashes, registryRenames } from "./registry-name"
import { abilityActionGaps, abilityActionWords } from "./gameplay-references"
import { codedMotions, gameplaysAbout, mayBePlayedByGameplay } from "./gameplay-motions"
export { gameplayPlays, gameplaysAbout, mayBePlayedByGameplay } from "./gameplay-motions"
import { hasCjk } from "./data-words"
import { creatureClipFindings, creatureStructureIssues, MOTIONS_WHEN_PRESENT, structureFindings, usedAbilities } from "./creature-life"
import { governing, tierAskGaps, tierLimitIssues, tierName, tierOf } from "./creature-tier"
import { PLAY_QUESTIONS, playability, projectThings } from "./playable"
import { abilityCanReachBehind, abilityIssues, abilityTimingIssues, type AbilityIssue } from "./creature-abilities"
import { bossClips, bossModelIssues, felt, type BossIssue } from "./creature-boss"
import { bossLookIssues, type BossLookIssue } from "./boss-look"
import { bossShowIssues, type BossShowIssue } from "./boss-show-model"
import { bossBarIssues, bossBarLookup, type BossBarIssue } from "./boss-bar"
import { abilityAssetIssues, abilityAssets, abilityParticleFindings, expandedMoves, sharedAbilityIssues, withSharedAbilities, type AbilityAssetIssue } from "./ability-asset"
import { staggerList } from "./combat"
import { FLIGHT_TIER_FIX, FLIGHT_TIER_STEPS, diveIssues, flightClips, flightModelIssues, flightTierGaps, flightTierStops, habitsClips, impliesFlight, type FlightIssue } from "./creature-flight"
import { abilityEffectIssues, creatureTall, effectLookup } from "./effect-abilities"
import { creatureSoundIssues, isSoundAsset, soundLookup, soundUses, type SoundIssue } from "./sound"
import type { BlueprintEntry } from "./blueprint"
import { blueprintCreature, modelOnlyCreature } from "./blueprint-creature"
import { bossShowSteps } from "./boss-show"
import { modelBounds } from "./model-bounds"
import { recipeClashes, recipeThing } from "./recipe-clash"
import { castDesignHints, creatureDesignHints, visualDesignHint, type DesignRule } from "./combat-design"
import { creatureTier, particleReport } from "./combat-particles"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { bookFindings, type BookIssue } from "./book-findings"
import { fontFindings, type GlyphFacts } from "./font-findings"

/**
 * Machine reconciliation (机器对账): the project compared with what a build really generates, by rule, with
 * no AI and without starting the game. It reports what would leave the mod broken once installed, or
 * quietly not doing what the project says. A finding that `stops` is one the build already fails on;
 * the rest are warnings shown beside the build result. The guide prints warnings about the implementation.
 */
export type Finding = {
  /** Which rule found it; stable, for tests and tables. */
  rule:
    | "asset_unused"
    | "music_size"
    | "particle_emission"
    | "solid_body_motion"
    | "blocker_overlap"
    | "particle_reference"
    | "model_missing"
    | "skipped_creature"
    | "model_only"
    | "model_motions"
    | "target_lacks_vanilla"
    | "texture_missing"
    | "rule_animation"
    | "animation_unplayed"
    // r29c: a motion its creature keeps for a behaviour still to come (`later_clips`), not played yet: something to look at, not to mend.
    | "animation_later"
    | "recipe_reference"
    // A crafting recipe that takes what a recipe of the game takes, so the game makes its item; or that takes what another recipe of the project takes (`recipe-clash.ts`).
    | "recipe_vanilla"
    | "recipe_duplicate"
    | "drop_reference"
    // block shape (10-12): a block that is boxes put together and also something that only a whole block can be.
    | "shape_conflict"
    | "ore_drops_nothing"
    | "language_key"
    | "creature_unreachable"
    // r29: a lair it keeps to (spawn.near, garrison) that is not there; a place it keeps to so small that it would hardly ever turn up.
    | "creature_structure"
    | "spawn_near_small"
    | "stance_unreachable"
    | "stance_empty"
    | "stance_boss_only"
    | "gameplay_unchecked"
    | "explosion_never"
    | "english_missing"
    | "english_text"
    | "play_gap"
    | "play_unreachable"
    // creature tier (10-12): a creature whose blueprint tier asks for motions or abilities it does not have. A warning; for the epic tier it stops (spec 一: 必须).
    | "tier_motions"
    // 第 3 步: a creature that carries more abilities, hits or combos than its blueprint tier lets it (only the epic tier has room for more). It stops.
    | "tier_limits"
    // boss runtime (10-12): a creature whose blueprint tier is Boss (or a hostile epic one) but that lacks a boss or a felt ability, or an epic one that lacks its hitbox of parts. A warning; it stops only for the missing hitbox of an epic creature.
    | "tier_boss"
    // An ability moment that a gameplay is to do (a hit of type "gameplay"), against the gameplay code of the project: no gameplay has that slug, or it registers no entry of that name. It stops: nothing would answer the ability.
    | "ability_gameplay"
    // flight and habits (10-12): an epic creature that is said to fly and does not, or whose flight or habits lack a motion of their own. It stops for the missing motion of takeoff, landing or rest; the "said to fly" part is only a warning.
    | "tier_flight"
    | "tier_steady"
    | "steady_advice"
    | "steady_rear_advice"
    | "steady_counter_circle"
    | "model_pose_advice"
    // flight and habits (10-12): a flight or a habit against the model it plays on (`creature-flight.ts`).
    | FlightIssue["rule"]
    // boss runtime (10-12): a boss against the model it plays on (`creature-boss.ts`).
    | BossIssue["rule"]
    // Boss 能力 8 and 10: stacked shakes, and a boss's model changes against its model (`boss-look.ts`).
    | BossLookIssue["rule"]
    // Boss 能力 15: a boss's wake-up and death steps against its model and its project (`boss-show-model.ts`).
    | BossShowIssue["rule"]
    // Boss 能力 6: a boss's own bar against the boss (`boss-bar.ts`).
    | BossBarIssue["rule"]
    // 技能资产: an ability asset against the project and its target, and a creature's use of one (`ability-asset.ts`).
    | AbilityAssetIssue["rule"]
    // G2: an ability against the model it plays on (`creature-abilities.ts`).
    | AbilityIssue["rule"]
    // H3: the effects an ability shows (`effect-abilities.ts`).
    | ReturnType<typeof abilityEffectIssues>[number]["rule"]
    // 任务二 §9: the sounds of its own a creature plays (`sound.ts`).
    | SoundIssue["rule"]
    // 书: a book's pages against its page layout, and the pictures they show (`book.ts`).
    | BookIssue["rule"]
    // 缺字: a word the mod shows has a character the target's font cannot draw (`font-findings.ts`); read off the built language files.
    | "font_missing"
    // 补字 (E19): such a character the build drew into the mod from an installed OFL font (`glyph-fill.ts`).
    | "font_filled"
    | "blueprint_sound_drift"
    // r29b: a creature or a book whose own name the mod already gives something else (it stops); one that names itself, which old worlds lose under its old name.
    | "registry_clash"
    | "registry_renamed"
    | DesignRule
  /** True when the build fails on this; false for a warning. The tier rules (`tier_*`) are stopped by `assembleBuildSource` itself, since no compile of theirs would. */
  stops: boolean
  /** The thing it is about, by the id and name the project knows it by; null for the mod as a whole. */
  about: { kind: "entity" | "block" | "item" | "recipe" | "logic" | "gameplay" | "ability" | "effect" | "particle" | "book"; id: string; name: string } | null
  /** What is wrong, in one plain sentence. */
  text: string
  /** What to do about it. */
  fix: string
  /**
   * Who is asked to put it right, when that is not the thing it is about: a motion made for a creature and played by nothing is for the gameplay that points at the creature to play, not for the creature to
   * redo. Absent: the thing it is about. The finding stays under `about` where it is read; only the redo handed over from it goes here.
   */
  redo?: NonNullable<Finding["about"]>[]
  /**
   * Where the person can put it right themselves, when what the finding asks for is a field they can fill. Every finding that tells the
   * person to write something names where, so the window can take them there (open the thing, show the field, focus it) instead of
   * leaving them to look for it; a finding that asks the AI to redo something has none.
   */
  targets?: FindingTarget[]
  refs?: FindingRef[]
  emission?: EmissionFinding
  /** For 高级 only. */
  detail?: string
}

/**
 * One field of one thing a finding is about. `field` is the field's path in that thing's own form (`name_en`, `drop`, `drop_item.item`, `pattern`),
 * the same path the hand form (`asset-edit-words.ts`) and the card use, so a window can find the field by it. `label` is the button's words.
 */
export type FindingTarget = { about: NonNullable<Finding["about"]>; field: string; label: string }

export type ReconcileFacts = {
  /** Animation names of each creature's compiled model, by creature id. A creature that is absent has no model. */
  animations: Readonly<Record<string, readonly string[]>>
  models?: Readonly<Record<string, Pick<ModelDesign, "bones" | "follow" | "look"> & Partial<Pick<ModelDesign, "animations">>>>
  /** Gameplay units and whether a code check of exactly the current version is on record. Left out when not looked up. */
  gameplay?: readonly { id: string; title: string; checked: boolean }[]
  /** What the build generated. Left out before a build: the rules that need it are then not run. */
  built?: { lang: { zh_cn: Readonly<Record<string, string>>; en_us: Readonly<Record<string, string>> }; files: readonly string[]; glyphs?: GlyphFacts }
}

/** The motions every generated creature plays by itself, whatever its rules. */
export const BUILT_IN_MOTIONS = ["idle", "walk", "hurt"] as const

/**
 * The animation names the generated runtime really plays for one creature: idle and walk on the movement
 * controller, hurt on the hurt controller, and each animation an enabled play_animation rule names.
 * Nothing else in a model is ever started by generated code. Given the model's own animation names, a
 * name a rule asks for that the model does not have is left out: it cannot play.
 */
export function playedAnimations(project: Pick<Project, "logic"> & Partial<Pick<Project, "entities" | "workspace">>, entityId: string, modelled?: readonly string[]) {
  // G2: the motion of each ability a fighting creature has is started when that ability starts.
  const fighter = project.entities?.find((entity) => entity.id === entityId && entity.behavior === "hostile")
  // Flight and habits (10-12): any creature may fly or live by habits, the one that fights or not.
  const liver = project.entities?.find((entity) => entity.id === entityId)
  // E1: a model that brings a death or an attack motion has it played by the generated creature (`MOTIONS_WHEN_PRESENT`).
  // r29: the abilities it shares from an ability asset play their motions as its own do (the reconciliation expands them first, the guide reads them as saved),
  // and a stagger plays its own motion (`stagger.clip`, each kind's): a model's dizzy motion that only a stagger plays was said never to play (r28).
  const moves = fighter?.shared_abilities?.length && project.workspace ? expandedMoves(fighter, project.workspace) : (fighter?.abilities ?? [])
  const staggered = fighter ? staggerList(fighter.stagger).flatMap((kind) => (kind.clip ? [kind.clip] : [])) : []
  const named = [...new Set([...BUILT_IN_MOTIONS, ...MOTIONS_WHEN_PRESENT.filter((name) => modelled?.includes(name)), ...moves.flatMap((ability) => [ability.clip, ...(ability.stages ?? []).flatMap((stage) => (stage.clip ? [stage.clip] : []))]), ...staggered, ...bossClips(fighter?.boss), ...stanceClips(fighter?.stances), ...flightClips(liver?.flight), ...habitsClips(liver?.habits), ...project.logic.flatMap((rule) => (rule.entity_id === entityId && rule.enabled && rule.action === "play_animation" && rule.animation ? [rule.animation] : [])), ...codedMotions(project, entityId).named])]
  return modelled ? named.filter((name) => modelled.includes(name)) : named
}

/**
 * creature tier (10-12): what the tier a confirmed blueprint settled for this creature asks of its model, compared with the model.
 * Only said, never stopping the build: a model without them still builds and plays with the game's own stand-ins. The motions
 * are the ones `creatureClipNeeds` already derives from what the creature does, so what counts as hitting in melee is decided in one place.
 */
/**
 * 第 3 步: a creature carries no more abilities, hits a move and combos than its tier lets it (`tierLimitIssues`): the epic tier's larger numbers are for an epic creature only. A creature
 * with no tier settled on a confirmed blueprint is held to the ordinary numbers, as every creature was before. It stops: the person chose the tier, and the larger fight is the epic one.
 */
function tierLimitFindings(project: Project, entity: Project["entities"][number], about: NonNullable<Finding["about"]>): Finding[] {
  const entries = project.blueprint?.state === "confirmed" ? project.blueprint.entries : []
  const entry =
    entries.find((value) => value.kind === "entity" && value.tier && (value.asset_id === entity.id || project.workspace.assets.some((asset) => asset.id === value.asset_id && asset.document.kind === "entity" && asset.document.model_asset_id === entity.id))) ??
    entries.flatMap((value) => (value.kind === "model" && value.asset_id === entity.id ? [governing(entries, value.key)] : [])).find((value) => value !== null)
  const row = tierOf(entry)
  const over = tierLimitIssues(row.level, entity)
  return over.length ? [{ rule: "tier_limits", stops: true, about, text: `「${entity.name}」是${tierName(row)}，${over.join("；")}。`, fix: "删掉或合并一些招式、出手或连招；真要这么多，在蓝图卡片上把它改成史诗档。", detail: `tier: ${row.level}; abilities ${entity.abilities?.length ?? 0}; most hits ${Math.max(0, ...(entity.abilities ?? []).map((ability) => ability.hits.length))}; combos ${entity.combos?.length ?? 0}` }] : []
}

function tierFindings(project: Project, entity: Project["entities"][number], about: NonNullable<Finding["about"]>, animations: readonly string[]): Finding[] {
  const entries = project.blueprint?.state === "confirmed" ? project.blueprint.entries : []
  // The blueprint's creature entry for this creature: linked to the creature itself, to the entity asset that wears its model, or through its model entry's owner.
  const entry = entries.find(
    (value) =>
      value.kind === "entity" &&
      value.tier &&
      (value.asset_id === entity.id || project.workspace.assets.some((asset) => asset.id === value.asset_id && asset.document.kind === "entity" && asset.document.model_asset_id === entity.id)),
  ) ?? entries.flatMap((value) => (value.kind === "model" && value.asset_id === entity.id ? [governing(entries, value.key)] : [])).find((value) => value !== null)
  if (!entry) return []
  const row = tierOf(entry)
  const missing = creatureClipFindings(entity, animations).filter((finding) => (finding.clip === "death" && row.death) || (finding.clip === "attack" && row.attack))
  const abilities = entity.behavior === "hostile" && row.abilities > usedAbilities(entity).length ? usedAbilities(entity).length : null
  // broad21: what the tier's list (`tierAsks`) measurably lacks of the creature's document, said as what is still missing (the Boss settings, the ability that is felt, the hitbox of parts), in the list's own words.
  // The phases, the wake-up, the leash and the lair are open in the schema and are not on the list as required, so they are never missing here.
  const measured = row.boss || row.hitbox ? tierAskGaps(row, entity) : []
  const gaps = measured.filter(gap => gap.ask.id !== "steady")
  const planRef = blueprintRef(entry.key, entry.title)
  const steady: Finding[] = measured.filter(gap => gap.ask.id === "steady").map(gap => ({ rule: "tier_steady", stops: false, about, refs: [planRef], text: `${tierName(row)}${gap.said}。`, fix: gap.ask.fix }))
  const boxGaps = gaps.filter((gap) => gap.ask.id === "hitbox")
  // 10-12 flight: an epic creature the blueprint or its own description says flies, and does not; or one that flies or lives by habits without a motion of its own for it.
  const flightGaps = row.level === "epic" ? flightTierGaps(entity, impliesFlight(entry.title, entry.brief, entity.name, entity.description)) : []
  // The epic tier's 必须 (spec 一) stop the build; every other gap, and the ones of the other tiers, are said and let through.
  const epic = row.level === "epic"
  const flightStops = epic ? flightTierStops(entity).length > 0 : false
  const boxStops = epic && boxGaps.length > 0
  const asFlier: Finding[] = flightGaps.length
    ? [{ rule: "tier_flight", stops: flightStops, about, refs: [planRef], text: `${tierName(row)}还缺这几项表现：${flightGaps.join("；")}。`, fix: flightStops ? `${FLIGHT_TIER_STEPS}起飞、落地和休息的动作必须补齐才能打包。${flightTierStops(entity).length < flightGaps.length ? "「写了会飞却没有 flight」这一条不补也能打包。" : ""}` : FLIGHT_TIER_FIX, detail: `tier: ${row.level}; flight: ${entity.flight ? entity.flight.style : "none"}; habits: ${entity.habits ? entity.habits.active : "none"}; said to fly: ${impliesFlight(entry.title, entry.brief, entity.name, entity.description)}` }]
    : []
  const asBoss: Finding[] = gaps.length
    ? [
        {
          rule: "tier_boss",
          stops: boxStops,
          about,
          refs: [planRef],
          text: `${tierName(row)}还缺这几项表现：${gaps.map((gap) => gap.said).join("；")}。`,
          fix: `${gaps.map((gap) => gap.ask.fix).join("")}${boxStops ? "碰撞箱必须补上才能打包，其余的不补也能打包，只是这些表现还没有。" : "不补也能打包，只是这些表现还没有。"}想降档，在蓝图卡片上改。`,
          detail: `tier: ${row.level}; boss: ${entity.boss ? `${entity.boss.phases.length} phases` : "none"}; shake or debris in an ability: ${felt(entity.abilities ?? [])}; hitbox parts: ${entity.hitbox?.parts?.length ?? 0}`,
        },
      ]
    : []
  if (!missing.length && abilities === null) return [...asBoss, ...asFlier, ...steady]
  const lacks = [
    ...(missing.length ? [`「${entity.name}」的模型里没有：${missing.map((finding) => motionLabel(finding.clip)).join("、")}`] : []),
    ...(abilities === null ? [] : [`${missing.length ? "它" : `「${entity.name}」`}的招式只有 ${abilities} 个，这一档的敌对生物至少要有 ${row.abilities} 个`]),
  ]
  return [
    ...asBoss,
    ...asFlier,
    ...steady,
    {
      rule: "tier_motions",
      refs: [planRef, ...missing.map(({ clip }) => clipRef(clip))],
      stops: epic,
      about,
      text: `蓝图上定的是「${row.label}」档，可是${lacks.join("；")}。`,
      fix: [...missing.map((finding) => finding.fix), ...(abilities === null ? [] : [`给它再写出至少 ${row.abilities - abilities} 个招式（abilities），每个招式在模型里有同名的动作。`]), epic ? "这一档必须有这些，补齐以后才能打包。想降档，在蓝图卡片上改。" : "不补也能打包，只是这一档要的动作和招式还没齐。想降档，在蓝图卡片上改。"].join(""),
      detail: `tier: ${row.level}; missing clips: ${missing.map((finding) => finding.clip).join(", ") || "-"}; abilities: ${usedAbilities(entity).length}/${row.abilities}`,
    },
  ]
}

const own = (project: Pick<Project, "mod_id">, reference: string) => reference.split(":")[0] === project.mod_id

/** Only a clear statement about the creature's sound as a whole can be compared to all its saved cues. */
function blueprintSoundPlan(entry: BlueprintEntry) {
  const statements = [entry.out_of_scope, entry.brief].flatMap((text) => text?.split(/[。！？，；,.!?;\n]+/).map((part) => part.trim()) ?? [])
  const vanilla = statements.some((text) => /^(?:(?:先|只|暂时|目前)?用原版(?:的)?(?:声音|音效)|(?:声音|音效)(?:先|只|暂时)?用原版|(?:不用|不做)(?:自己(?:做)?的|自制)(?:声音|音效)|不自制(?:声音|音效))$/.test(text))
  const custom = statements.some((text) => /^(?:(?:要|先|只)?(?:用|做)(?:自己(?:做)?的|自制)(?:声音|音效)|(?:先|要)?自制(?:声音|音效)|(?:声音|音效)(?:用自己(?:做)?的|自制))$/.test(text))
  return vanilla === custom ? null : vanilla ? "vanilla" : "custom"
}

function blueprintSoundFindings(project: Project): Finding[] {
  const lookup = soundLookup(project)
  return (project.blueprint?.entries ?? []).flatMap((entry): Finding[] => {
    const entity = blueprintCreature(project, entry)
    const plan = entity && blueprintSoundPlan(entry)
    if (!entity || !plan) return []
    const boss = entity.boss
    const cues = [...bossShowSteps(boss).map(({ step }) => step), ...(boss?.phases.flatMap((phase) => phase.finish ?? []) ?? [])]
    const cuesInUse = [boss?.intro?.sound, ...soundUses(entity).map(({ sound }) => sound), ...cues.flatMap((step) => step.type === "sound" ? [step.sound] : [])]
    const own = cuesInUse.filter(isSoundAsset).flatMap(({ asset }) => {
      const sound = lookup(asset)
      return sound ? [{ id: asset, title: sound.title }] : []
    })[0]
    const vanilla = cuesInUse.some((sound) => typeof sound === "string")
    if ((plan === "vanilla" && !own) || (plan === "custom" && (own || cuesInUse.some(isSoundAsset)))) return []
    const planned = plan === "vanilla" ? "用原版声音" : "用自己的声音"
    const actual = own ? `用了自己的声音「${own.title}」` : vanilla ? "配了原版声音" : "没有配置自己的声音"
    return [{
      rule: "blueprint_sound_drift", stops: false, about: { kind: "entity", id: entity.id, name: entity.name },
      refs: [blueprintRef(entry.key, entry.title), ...(own ? [assetRef(own.id, own.title)] : [])],
      text: `蓝图里说「${entity.name}」${planned}，做出来的${actual}。`,
      fix: "如果现在的声音合适，可以更新蓝图。想按蓝图做，就修改这只生物的声音设置。",
    }]
  })
}

export function reconcile(given: Project, facts: ReconcileFacts): Finding[] {
  // 技能资产: a creature that uses an ability asset is checked as the build makes it, with that ability among its own (`withSharedAbilities`).
  const project = withSharedAbilities(given)
  // Read off the project as saved: sharing abilities adds to a creature's row, and the build decides on the saved one.
  const modelOnly = new Set(given.entities.filter((entity) => entity.model_asset_id && modelOnlyCreature(given, entity)).map((entity) => entity.id))
  // Every moment of an ability that a gameplay is to do, against the project's gameplay code: read once, said under the creature it is about.
  const actionGaps = abilityActionGaps(project)
  const things = new Map([...project.blocks, ...project.items].map((value) => [value.identifier, value]))
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]))
  const effects = effectLookup(project)
  const sound = soundLookup(project)
  const referenceRef = (reference: string) => {
    const thing = own(project, reference) ? things.get(reference.split(":")[1]!) : undefined
    return thing ? assetRef(thing.id, thing.name) : registryRef(reference, recipeThing(project, reference).slice(1, -1))
  }
  const creatures = project.entities.flatMap((stored): Finding[] => {
    const about = { kind: "entity" as const, id: stored.id, name: stored.name }
    const entity = resolveAliases(stored, false)
    const animations = facts.animations[entity.id]
    // Only a model a blueprint entry made, worn by no creature document: the build leaves it out and says so, so nothing of a creature is asked of it (the epic tier's hitbox, its motions).
    if (modelOnly.has(entity.id))
      return [{ rule: "model_only", stops: false, about, text: `「${entity.name}」只有模型，没有生物文档，打包时不会打进模组（不注册成生物，也没有刷怪蛋）。`, fix: "要让它成为能刷出来的生物，先写用这个模型的生物文档（生物任务），再打包。" }]
    if (!entity.model_asset_id || !animations)
      return [{ rule: "model_missing", stops: true, about, text: `生物「${entity.name}」还没有模型，模组做不出来。`, fix: "先给它做一个模型。" }]
    const played = playedAnimations(project, entity.id, animations)
    const lacking = BUILT_IN_MOTIONS.filter((name) => !animations.includes(name)).map(clipRef)
    const texture = entity.runtime?.texture_asset_id
    const rules = project.logic.filter((rule) => rule.entity_id === entity.id && rule.enabled && rule.action === "play_animation" && rule.animation && !animations.includes(rule.animation))
    // Gameplay code that plays a motion by a name it builds could be playing any of the rest: never said to be never played then (the guide says it may be played by that code).
    const idle = mayBePlayedByGameplay(project, entity.id) ? [] : animations.filter((name) => !played.includes(name))
    // r29c (狍鸮, 鵕鸟): what its document keeps for a behaviour still to come (`later_clips`) is said apart, as something to look at.
    const later = idle.flatMap((name) => ((kept) => (kept ? [{ ref: clipRef(name), reason: kept.reason }] : []))(entity.later_clips?.find((kept) => kept.clip === name)))
    const unplayed = idle.filter((name) => !later.some((kept) => kept.ref.id === name)).map(clipRef)
    const strays = (entity.later_clips ?? []).filter((kept) => !animations.includes(kept.clip))
    const egg = `item.${project.mod_id}.${creatureName(entity)}_spawn_egg`
    // G2: how long each motion is, where the project holds the model as a document (a creature shares its id with its model asset); a motion of unknown length is never called too short.
    const modelled = project.workspace.assets.find((asset) => asset.id === entity.id && asset.document.kind === "model")?.document
    const height = entity.hitbox?.core.height ?? (modelled?.kind === "model" ? modelBounds(modelled).height : null)
    const steady = height === null ? null : resolveSteady(entity.steady, height)
    const moves = entity.abilities ?? []
    const circles = steady && moves.some((ability) => ability.on_hurt) ? betweenStages(entity.tactics, entity.boss?.phases) : []
    const stageMoves = circles.length && entity.boss ? bossPhaseIds(entity.boss.phases, [...moves, ...(entity.combos ?? [])].map(({ id }) => id)) : null
    const countersWhileCircling = circles.flatMap((stage, index): Finding[] => {
      if (stage.style !== "circle") return []
      const counters = moves.filter((ability) => ability.on_hurt && (!stageMoves || stageMoves[index]?.includes(ability.id)))
      if (!counters.length) return []
      return [{
        rule: "steady_counter_circle", stops: false, about,
        refs: [...(entity.boss ? [phaseRef(index + 1)] : []), ...counters.map(abilityRef)],
        text: `「${entity.name}」绕着目标转圈时，${counters.map(({ name }) => `「${name}」`).join("、")}只会在身体正面挨打时掷概率。头看过来时，身体可能还朝着别处。`,
        fix: "试招时站在身体当前的正面。想让它靠近后面朝对手，可以把这一段走位改成「逼近到一定距离停下」。",
      }]
    })
    // r29c (狍鸮): a steady creature's leap leaves along its body as turned by then, as far as its target is (`abilityLeapStart`): one that may start facing elsewhere (keep_heading) and
    // cannot turn round by the time it leaves (its turn a tick, through its tracking for a track one) lands beside its target, and looks short.
    const swerves = steady ? moves.flatMap((ability) => {
      const leap = ability.moves.find(isLeap)
      if (!leap || !ability.start.keep_heading) return []
      const turns = (ability.turn_speed ?? steady.ability_turn) * ((ability.facing === "track" ? Math.min(leap.at, ability.track_until ?? ability.windup ?? 0) : 0) + 1 / 20)
      return turns < 180 ? [{ ability, turns: Math.round(turns) }] : []
    }) : []
    const hasBearing = [...moves, ...(entity.combos ?? [])].some(({ start }) => start.when?.some(rule => rule.if === "target_bearing") || start.weight_when?.some(rule => rule.if === "target_bearing"))
    const advice = [
      entity.steady?.preset === "auto" && height !== null && !steady ? "碰撞箱低于 2 格，按体型设置会沿用原来的动作。想启用可手选大型。" : "",
      steady && entity.flight ? "平时空中行进可调 flight.turn，出招转身用稳重的蓄力转速或各招式自己的转速。" : "",
      steady && steady.body_turn > 0 && steady.ability_turn >= steady.body_turn * 5 && entity.abilities?.some(a => a.facing === "track" && a.turn_speed === undefined) ? "蓄力转速至少是平时的五倍。若转得太急，可以降低 ability_turn。" : "",
    ].filter(Boolean)
    const lengths = modelled?.kind === "model" ? modelled.animations : []
    const particles = particleReport(entity, moves, creatureTier(project, entity.id), project.workspace)
    const modelForHints = modelled ?? project.workspace.assets.find((asset) => asset.id === entity.model_asset_id && asset.document.kind === "model")?.document
    const model = facts.models?.[entity.id] ?? (modelForHints?.kind === "model" ? modelForHints : null)
    return [
      ...(entity.hitbox?.blockers ?? []).flatMap((box): Finding[] => {
        const core = entity.hitbox!.core
        const targets = [{ name: "身体中心", ...core, forward: 0, up: 0, left: 0 }, ...(entity.hitbox?.parts ?? [])]
        const overlaps = targets.filter(part => Math.abs(box.forward - part.forward) < (box.width + part.width) / 2
          && Math.abs(box.left - part.left) < (box.width + part.width) / 2
          && box.up < part.up + part.height && part.up < box.up + box.height)
        return overlaps.length ? [{
          rule: "blocker_overlap", stops: false, about, refs: [partRef(box.name), ...overlaps.filter(part => part !== targets[0]).map(part => partRef(part.name))],
          text: `挡路部件「${box.name}」和${overlaps.map(part => `「${part.name}」`).join("、")}在摆好时有重叠，重叠处仍能打中身体或受击部位。`,
          fix: "希望这里打不掉血时，把挡路部件移到受击范围外，或缩小其中一个箱子。",
        }] : []
      }),
      ...(entity.hitbox?.parts ?? []).flatMap((part): Finding[] => part.solid && part.bone ? [{
        rule: "solid_body_motion", stops: false, about, refs: [partRef(part.name), boneRef(part.bone)],
        text: `「${entity.name}」的实心部位「${part.name}」跟着「${part.bone}」动。部位移开后，站在上面的角色会落下。`,
        fix: "如果想让这个部位一直当作落脚处，可以去掉跟随的骨骼或减小这段动作。",
      }] : []),
      ...[...bossShowSteps(entity.boss).map(({show,step,index})=>({step,label:(show==="intro"?"登场":"死亡")+"第 "+(index+1)+" 步",phase:undefined as number|undefined})),
        ...(entity.boss?.phases??[]).flatMap((p,i)=>(p.finish??[]).map(step=>({step,label:"第 "+(i+2)+" 阶段收尾",phase:i+2})))].flatMap(({step,label,phase})=>
          step.type==="particle" ? scatterFindings({...step,at:"at" in step ? step.at : 0},entity.particles,effects.particle,Object.values(particleWeather(entity.boss,undefined,phase)).some(Boolean)).map(issue=>({...issue,refs:[...(phase === undefined ? [] : [phaseRef(phase)]), ...issue.refs],rule:"particle_emission" as const,stops:false,about,text:"「"+entity.name+"」"+label+"："+issue.text,fix:""})) : []),
      ...(entity.emitters ?? []).flatMap((e, i) => scatterFindings({ ...e, at: 0, until: 120 }, entity.particles, effects.particle, Object.values(particleWeather(entity.boss,e.when)).some(Boolean)).map(issue => ({ ...issue, rule: "particle_emission" as const, stops: false, about, text: `「${entity.name}」第 ${i+1} 处常驻发射：${issue.text}`, fix: "" }))),
      ...(entity.abilities ?? []).flatMap(a => a.events.flatMap(e => e.type === "particle" ? scatterFindings(e, entity.particles, effects.particle, Object.values(particleWeather(entity.boss)).some(Boolean)).map(issue => ({ ...issue, rule: "particle_emission" as const, stops: false, about, refs: [abilityRef(a), ...issue.refs], text: `「${entity.name}」的「${a.name}」第 ${e.at} 秒：${issue.text}`, fix: "" })) : [])),
      ...(model ? (() => {
        const head = entity.steady && model.look ? resolveSteady(entity.steady, height ?? modelBounds(model).height)?.head : null
        const hints: { text: string; refs: FindingRef[] }[] = []
        if (!model.look) {
          const clips = (model.animations ?? []).filter(clip => clip.weights?.look?.length).map(clip => clip.name)
          if (clips.length) hints.push({ text: `模型没有 look，${clips.join("、")} 写的 weights.look 不起作用。`, refs: clips.map(clipRef) })
          if (entity.steady?.head) hints.push({ text: "生物写了头怎么转，模型还没有 look，头部无法单独转动。", refs: [] })
        } else if (head) {
          for (const axis of ["yaw", "pitch"] as const) {
            const cap = model.look.bones.reduce((sum, b) => sum + b[axis], 0)
            if (head[axis] > cap) hints.push({ text: `服务端的头${axis === "yaw" ? "左右" : "上下"}能偏 ${head[axis]}°，模型各节加起来只能转 ${cap}°，多出的 ${head[axis] - cap}° 看不见。`, refs: model.look.bones.map(({ bone }) => boneRef(bone)) })
          }
        }
        return hints.map(hint => ({ ...hint, rule: "model_pose_advice" as const, stops: false, about, refs: [assetRef(entity.model_asset_id!, project.workspace.assets.find(({ id }) => id === entity.model_asset_id)?.title), ...hint.refs], fix: "在模型上设置看向骨骼和每节限角，或调整生物的头部范围。"}))
      })() : []),
      ...creatureDesignHints(entity, moves, model).map((issue) => ({ ...issue, about })),
      ...(particles?.warning ? [{ ...particles.warning, about }] : []),
      ...[...abilityIssues(entity, animations.map((name) => ({ name, length: lengths.find((clip) => clip.name === name)?.length ?? Number.POSITIVE_INFINITY })), modelled?.kind === "model" ? modelled : null), ...(modelled?.kind === "model" ? abilityTimingIssues(entity, modelled) : []), ...abilityEffectIssues(entity, effects, modelled?.kind === "model" ? creatureTall(modelled) : null, modelled?.kind === "model" ? modelled : null), ...creatureSoundIssues(entity, sound)].map((issue) => ({ rule: issue.rule, stops: issue.stops, about, text: issue.text, fix: issue.fix, detail: issue.detail, refs: issue.refs })),
      ...(lacking.length
        ? [{ rule: "model_motions" as const, stops: true, about, refs: lacking, text: `生物「${entity.name}」的模型缺少必须有的动作：${lacking.map((ref) => ref.title).join("、")}。`, fix: "给模型补上待机（idle）、行走（walk）、受击（hurt）三个动作。" }]
        : []),
      // boss runtime (10-12): its wake-up, its changes of phase and its death against the motions the model has.
      // The lair's air against how tall it stands: its stated box, else its model's, the two the build reads (`compileEntity`).
      ...bossModelIssues(entity, animations.map((name) => ({ name, length: lengths.find((clip) => clip.name === name)?.length ?? Number.POSITIVE_INFINITY })), entity.hitbox?.core.height ?? (modelled?.kind === "model" ? modelBounds(modelled).height : null)).map((issue) => ({ rule: issue.rule, stops: issue.stops, about, text: issue.text, fix: issue.fix, detail: issue.detail, refs: issue.refs })),
      // Boss 能力 8 and 10: shakes stacked past the cap; its phases' model changes and the parts it drops against its model (the bones there, nothing dropped still needed, a glow with a picture).
      ...stanceFindings(entity).map(({ field, ...issue }) => ({
        ...issue, about, stops: false, targets: [{ about, field, label: issue.refs[0]!.title }],
      })),
      ...bossLookIssues(entity, modelled?.kind === "model" ? modelled : null, (id) => ((asset) => (asset?.document.kind === "texture" ? { width: asset.document.width, height: asset.document.height } : null))(project.workspace.assets.find((value) => value.id === id))).map((issue) => ({ rule: issue.rule, stops: issue.stops, about, text: issue.text, fix: issue.fix, detail: issue.detail, refs: issue.refs })),
      // Boss 能力 15: its wake-up's and its death's steps: later than the show, a motion or a bone the model lacks, a glow with no picture, a structure too big, an asset that is gone.
      ...bossShowIssues(entity, modelled?.kind === "model" ? modelled : null, {
        effect: (id) => project.workspace.assets.some((asset) => asset.id === id && asset.document.kind === "effect"),
        particle: (id) => project.workspace.assets.some((asset) => asset.id === id && asset.document.kind === "particle"),
        sound: (id) => project.workspace.assets.some((asset) => asset.id === id && asset.document.kind === "sound"),
        texture: (id) => ((asset) => (asset?.document.kind === "texture" ? { width: asset.document.width, height: asset.document.height } : null))(project.workspace.assets.find((value) => value.id === id)),
      }).map((issue) => ({ rule: issue.rule, stops: issue.stops, about, text: issue.text, fix: issue.fix, detail: issue.detail, refs: issue.refs })),
      // A vanilla particle or sound its abilities or its show name that the game version of the project's target lacks: the build stops on it (`version-lacks.ts`).
      ...creatureVanillaGaps(entity, targetMinecraft(project.target)).map((gap) => ({ rule: "target_lacks_vanilla" as const, stops: true, about, text: gap.text, fix: gap.fix, refs: gap.refs })),
      // Boss 能力 6: its own bar against it: there, a segment and a name for every stage, icons bound to what it has, locks broken before it fights again.
      ...(entity.behavior === "hostile" ? bossBarIssues(entity, bossBarLookup(project)) : []).map((issue) => ({ rule: issue.rule, stops: issue.stops, about, text: issue.text, fix: issue.fix, detail: issue.detail, refs: issue.refs })),
      // flight and habits (10-12): their motions against the model.
      ...flightModelIssues(entity, animations.map((name) => ({ name, length: lengths.find((clip) => clip.name === name)?.length ?? Number.POSITIVE_INFINITY }))).map((issue) => ({ rule: issue.rule, stops: issue.stops, about, text: issue.text, fix: issue.fix, detail: issue.detail, refs: issue.refs })),
      // flight (10-12): a dive that cannot get to its target between the end of its wind-up and its first hit (needs the document only).
      ...diveIssues(entity).map((issue) => ({ rule: issue.rule, stops: issue.stops, about, text: issue.text, fix: issue.fix, detail: issue.detail, refs: issue.refs })),
      ...tierFindings(project, entity, about, animations),
      ...(steady && (height ?? 0) >= 2 && moves.length && !hasBearing && !moves.some(abilityCanReachBehind) ? [{
        rule: "steady_rear_advice" as const, stops: false, about, refs: moves.map(abilityRef),
        text: "这只生物的招式够不到贴身绕到背后的人。",
        fix: "加一招打向四周或身后的，并让它在目标绕到背后时优先用。",
      }] : []),
      ...countersWhileCircling,
      ...swerves.map(({ ability, turns }): Finding => ({
        rule: "steady_advice", stops: false, about, refs: [abilityRef(ability)],
        text: `「${entity.name}」的「${ability.name}」写了 keep_heading，起手时身体可能没对着目标。开了稳重的生物跳扑沿身体转完的朝向出发，到起跳最多只转 ${turns}°，跳多远却按到目标的距离算：身体偏了就落在目标旁边或前面，看着像跳短了。`,
        fix: "要扑准：去掉 keep_heading（先转向目标再起手），或者把 facing 改成 track（蓄力时一路转向目标），或者调大这招的 turn_speed；不管落在哪都要咬到，就把判定写成 place:\"target\"。",
      })),
      ...advice.map(text => ({ rule: "steady_advice" as const, stops: false, about, text, fix: "在转身和盯人里调整。" })),
      ...tierLimitFindings(project, entity, about),
      ...actionGaps.filter((gap) => gap.entity.id === entity.id).map((gap) => ({ rule: "ability_gameplay" as const, stops: true, about, refs: [abilityRef(gap.ability), ...(gap.gameplay?.id ? [assetRef(gap.gameplay.id, gap.gameplay.title)] : [])], ...abilityActionWords(gap) })),
      ...(texture && !project.workspace.assets.some((asset) => asset.id === texture && asset.document.kind === "texture")
        ? [{ rule: "texture_missing" as const, stops: true, about, refs: [assetRef(texture)], text: `生物「${entity.name}」指定的贴图找不到了。`, fix: "给它换一张贴图，或者改回用模型自带的贴图。" }]
        : []),
      ...rules.map((rule) => ({
        rule: "rule_animation" as const,
        stops: true,
        about,
        text: `有一条规则要让「${entity.name}」做「${clipRef(rule.animation!).title}」这个动作，可是它的模型里没有这个动作。`,
        fix: `把规则换成模型里有的动作（${animations.map((id) => clipRef(id).title).join("、")}），或者给模型加上这个动作。`,
        detail: `animation: ${rule.animation}; model has: ${animations.join(", ")}`,
        refs: [assetRef(rule.id), clipRef(rule.animation!)],
      })),
      ...(unplayed.length
        ? [
            {
              rule: "animation_unplayed" as const,
              refs: unplayed,
              stops: false,
              about,
              text: `「${entity.name}」的模型里有 ${unplayed.length} 个动作在游戏里永远不会播放：${unplayed.map((ref) => ref.title).join("、")}。`,
              fix: `游戏里会播放的只有：${played.map((id) => clipRef(id).title).join("、")}。想用上别的动作，加一条“做某个动作”的规则，或者写一段玩法代码来播放它。`,
              // The gameplay that points at this creature is the one whose code can play it.
              ...(((users) => (users.length ? { redo: users.map((user) => ({ kind: "gameplay" as const, id: user.id, name: user.name })) } : {}))(gameplaysAbout(project, entity.id))),
              // The names as the model and the generated code spell them.
              detail: `never played: ${unplayed.map((ref) => ref.id).join(", ")}; played: ${played.join(", ")}`,
            },
          ]
        : []),
      ...(later.length || strays.length
        ? [{
            rule: "animation_later" as const,
            refs: [...later.map((kept) => kept.ref), ...strays.map((kept) => clipRef(kept.clip))],
            stops: false,
            about,
            text: [
              ...(later.length ? [`「${entity.name}」有 ${later.length} 个动作留给以后的行为，现在游戏里还不会播放：${later.map((kept) => `${kept.ref.title}（${kept.reason}）`).join("、")}。`] : []),
              ...(strays.length ? [`later_clips 写的 ${strays.map((kept) => clipRef(kept.clip).title).join("、")} 它的模型里没有。`] : []),
            ].join(""),
            fix: strays.length ? "把 later_clips 里的动作名改成模型里有的，或者去掉这一行。" : "那个行为做出来以后用上它们，再从 later_clips 里去掉；不打算用了就从模型里删掉。",
            detail: `kept for later: ${later.map((kept) => kept.ref.id).join(", ") || "none"}; not in the model: ${strays.map((kept) => kept.clip).join(", ") || "none"}`,
          }]
        : []),
      // The generated creature only lights its fuse next to a player it is going toward, and a passive one goes toward nobody.
      ...(entity.runtime?.explosion && entity.behavior === "passive"
        ? [{ rule: "explosion_never" as const, stops: false, about, text: `「${entity.name}」设置了爆炸，可是它不会主动靠近玩家，所以在游戏里永远不会炸。`, fix: "把它改成会跟着玩家或者会攻击玩家，或者去掉爆炸。" }]
        : []),
      // Checked against the generated files, not assumed: today's template always writes a spawn egg.
      // A boss's lair puts it in the world as well (`creatureFacets` counts it as an answer to where it comes from).
      // r29: what it keeps to, said before anything is built: a lair that is not there stops the build (the mod would name a structure it does not have).
      ...creatureStructureIssues(project, entity).map((text) => ({ rule: "creature_structure" as const, stops: true, about, text, fix: "在 runtime.spawn.near 或 runtime.garrison 里写本工程一只有巢的 Boss 的编号，或者去掉这一项。" })),
      ...structureFindings(project, entity).map((finding) => ({ ...finding, about })),
      ...(facts.built && !entity.runtime?.spawn && !entity.runtime?.garrison && !(entity.behavior === "hostile" && (entity.boss?.lair || entity.boss?.summon)) && !(egg in facts.built.lang.zh_cn)
        ? [{ rule: "creature_unreachable" as const, stops: false, about, text: `「${entity.name}」既不会自己出现，也没有刷怪蛋，玩家在游戏里见不到它。`, fix: "给它设置出现的群系，或者（Boss）给它一个巢。", detail: egg }]
        : []),
    ]
  })
  const recipes = project.recipes.flatMap((recipe, index): Finding[] => {
    const about = { kind: "recipe" as const, id: recipe.id, name: recipe.name }
    const lost = [...new Set([...recipe.pattern.filter((value): value is string => value !== null), recipe.result])].filter((reference) => own(project, reference) && !things.has(reference.split(":")[1]!))
    // Against the earlier recipes only, so two that agree are said once.
    const clashes = recipeClashes(recipe, project.recipes.slice(0, index), (reference) => recipeThing(project, reference)).map((clash): Finding => ({
      rule: clash.with.kind === "vanilla" ? "recipe_vanilla" : "recipe_duplicate",
      stops: clash.stops,
      about,
      refs: [
        referenceRef(recipe.result),
        ...(clash.with.kind === "project"
          ? ((other) => [assetRef(other.id, other.name), referenceRef(other.result)])(recipesById.get(clash.with.id)!)
          : clash.with.results.map((result) => referenceRef(`minecraft:${result}`))),
      ],
      text: clash.text,
      fix: clash.fix,
      detail: clash.with.kind === "vanilla" ? `same as the game's crafting recipe for: ${clash.with.results.join(", ")}` : `same as recipe ${clash.with.id}`,
    }))
    return [
      ...lost.map((reference): Finding => ({
        rule: "recipe_reference",
        stops: true,
        about,
        text: `配方「${recipe.name}」用到了「${reference.split(":")[1]}」，可是模组里没有叫这个名字的方块或物品。`,
        fix: "先把它做出来，或者把配方里的这一样换掉。",
        targets: [{ about, field: "pattern", label: `改配方「${recipe.name}」的材料` }],
        detail: reference,
        refs: [referenceRef(reference)],
      })),
      ...clashes,
    ]
  })
  const blocks = project.blocks.flatMap((block): Finding[] => {
    const about = { kind: "block" as const, id: block.id, name: block.name }
    return [
      ...(block.drop === "item" && (!block.drop_item || !things.has(block.drop_item.item) || block.drop_item.item === block.identifier)
        ? [{ rule: "drop_reference" as const, stops: true, about, refs: block.drop_item ? [referenceRef(`${project.mod_id}:${block.drop_item.item}`)] : [], text: `方块「${block.name}」挖掉后要掉的东西${block.drop_item ? `「${block.drop_item.item}」` : ""}在模组里找不到。`, fix: "先把要掉的物品做出来，或者改成掉它自己。", targets: [{ about, field: "drop", label: `改「${block.name}」挖掉后掉的东西` }] }]
        : []),
      ...((conflict) => (conflict ? [{ rule: "shape_conflict" as const, stops: true, about, text: conflict.message, fix: `去掉 ${conflict.field}，或者去掉 shape（外形）。`, ...(conflict.field === "generation" ? { targets: [{ about, field: "generation", label: `改「${block.name}」会不会自己生成` }] } : {}) }] : []))(shapeConflict(block)),
      ...(block.generation && block.drop === "none"
        ? [{ rule: "ore_drops_nothing" as const, stops: false, about, text: `方块「${block.name}」会在世界里生成，可是挖掉以后什么都不掉，玩家拿不到任何东西。`, fix: "让它掉它自己，或者掉一样物品。", targets: [{ about, field: "drop", label: `改「${block.name}」挖掉后掉的东西` }] }]
        : []),
    ]
  })
  const expected = [
    ...project.blocks.map((block) => ({ key: `block.${project.mod_id}.${block.identifier}`, about: { kind: "block" as const, id: block.id, name: block.name } })),
    ...project.items.map((item) => ({ key: `item.${project.mod_id}.${item.identifier}`, about: { kind: "item" as const, id: item.id, name: item.name } })),
    ...project.entities.flatMap((entity) =>
      [`entity.${project.mod_id}.${creatureName(entity)}`, `item.${project.mod_id}.${creatureName(entity)}_spawn_egg`].map((key) => ({ key, about: { kind: "entity" as const, id: entity.id, name: entity.name } })),
    ),
  ]
  const built = facts.built
  const language = built
    ? [
        ...expected.flatMap((entry) =>
          (["zh_cn", "en_us"] as const)
            .filter((locale) => !built.lang[locale][entry.key])
            .map((locale): Finding => ({ rule: "language_key", stops: false, about: entry.about, text: `「${entry.about.name}」在${locale === "zh_cn" ? "中文" : "英文"}游戏里没有名字，会显示成一串代号。`, fix: "这是 Studio 生成时漏掉的，请把这条提醒告诉开发者。", detail: `${locale}: ${entry.key}` })),
        ),
        // A name present in one language only: players of the other see the raw key.
        ...(["zh_cn", "en_us"] as const).flatMap((locale) =>
          Object.keys(built.lang[locale])
            .filter((key) => !(key in built.lang[locale === "zh_cn" ? "en_us" : "zh_cn"]) && !expected.some((entry) => entry.key === key))
            .map((key): Finding => ({ rule: "language_key", stops: false, about: null, text: `有一个名字只写了${locale === "zh_cn" ? "中文" : "英文"}，${locale === "zh_cn" ? "英文" : "中文"}游戏里会显示成一串代号。`, fix: "给它补上另一种语言的名字。", detail: `${locale === "zh_cn" ? "en_us" : "zh_cn"}: ${key}` })),
        ),
      ]
    : []
  const gameplay = (facts.gameplay ?? [])
    .filter((entry) => !entry.checked)
    .map((entry): Finding => ({
      rule: "gameplay_unchecked",
      stops: false,
      about: { kind: "gameplay", id: entry.id, name: entry.title },
      text: `玩法「${entry.title}」现在这一版代码没有检查记录：上一次检查的是更早的一版，或者从来没有检查过。`,
      fix: "重新让它检查一遍（越界、引用、编译），再打包。",
    }))
  // A name with no Chinese in it reads the same in both games; only a Chinese name with no English beside it is listed.
  // Round 18: a model saved before its creature's own card carries the model's title (「…外观」), a name that only exists inside Studio and
  // has no English field to fill; it is asked about once the creature is saved under its own name. A creature with no model in the workspace is an old one made by hand and counts as before.
  const nameless = (entity: Project["entities"][number]) => project.workspace.assets.some((asset) => asset.id === entity.id && asset.document.kind === "model") && !project.workspace.assets.some((asset) => asset.document.kind === "entity" && asset.document.model_asset_id === entity.id)
  const unnamedThings = [
    ...project.blocks.map((value) => ({ kind: "block" as const, value })),
    ...project.items.map((value) => ({ kind: "item" as const, value })),
    ...project.entities.filter((entity) => !nameless(entity)).map((value) => ({ kind: "entity" as const, value })),
  ].filter(({ value }) => !value.name_en && hasCjk(value.name))
  const unnamed = unnamedThings.map(({ value }) => value.name)
  const english: Finding[] = [
    ...(unnamed.length
      ? [
          {
            rule: "english_missing" as const,
            stops: false,
            about: null,
            text: `有 ${unnamed.length} 样东西还没有英文名，英文版游戏里会显示中文：${unnamed.map((name) => `「${name}」`).join("、")}。`,
            // One finding for all of them (the sentence lists them), with a way to each one's own English-name box. The box is on the thing's card, with no 高级 needed.
            fix: "想发给用英文玩的人，就给它们各起一个简短的英文名：每张卡片上都有「英文名」一栏，直接填就行，或者让 AI 补上。只在中文游戏里玩可以不管。",
            targets: unnamedThings.map(({ kind, value }) => ({ about: { kind, id: value.id, name: value.name }, field: "name_en", label: `给「${value.name}」填英文名` })),
          },
        ]
      : []),
    ...project.workspace.assets.flatMap((asset): Finding[] => {
      if (asset.document.kind !== "gameplay") return []
      const keys = Object.entries(asset.document.lang.en_us).filter(([, text]) => hasCjk(text)).map(([key]) => key)
      if (!keys.length) return []
      return [
        {
          rule: "english_text",
          stops: false,
          about: { kind: "gameplay", id: asset.id, name: contentName(asset) },
          text: `玩法「${contentName(asset)}」有 ${keys.length} 条给英文版游戏的文字写的还是中文，英文版游戏里会显示中文。`,
          fix: "让 AI 把这几条改成英文。只在中文游戏里玩可以不管。",
          detail: `en_us: ${keys.join(", ")}`,
        },
      ]
    }),
  ]
  // 技能资产: every ability asset against what it is bound to and names, and against the target's game; every creature's use of one.
  const assets = abilityAssets(project, false)
  const particleReferences: Finding[] = abilityParticleFindings(given)
  const abilities = [
    ...assets.flatMap((asset) => abilityAssetIssues(project, asset, targetMinecraft(project.target)).map((issue): Finding => ({ rule: issue.rule, stops: issue.stops, about: { kind: "ability", id: asset.id, name: asset.document.name }, text: issue.text, fix: issue.fix, refs: issue.refs }))),
    ...assets.flatMap(({ id, document }) => document.events.flatMap(e => e.type === "particle"
      ? scatterFindings(e, document.particles, effects.particle).map((issue): Finding => ({ ...issue, refs: [abilityRef({ id, name: document.name }), ...issue.refs], stops: false, about: { kind: "ability", id, name: document.name }, text: `技能「${document.name}」第 ${e.at} 秒：${issue.text}` })) : [])),
    ...assets.flatMap((asset) => castDesignHints(asset.document).map((issue): Finding => ({ ...issue, about: { kind: "ability", id: asset.id, name: asset.document.name } }))),
    ...sharedAbilityIssues(project).map((issue): Finding => ({ rule: issue.rule, stops: issue.stops, about: { kind: "entity", id: issue.creature, name: project.entities.find((entity) => entity.id === issue.creature)?.name ?? "" }, text: issue.text, fix: issue.fix, refs: issue.refs })),
  ]
  const visuals = project.workspace.assets.flatMap((asset): Finding[] => {
    if (asset.document.kind !== "particle" && asset.document.kind !== "effect") return []
    const issue = visualDesignHint(asset.document)
    return issue ? [{ ...issue, about: { kind: asset.document.kind, id: asset.id, name: asset.title } }] : []
  })
  const entitySettings = new Map(project.workspace.assets.flatMap((asset) =>
    asset.document.kind === "entity" ? [[asset.document.model_asset_id, asset] as const] : [],
  ))
  const aboutRef = ({ kind, id, name }: NonNullable<Finding["about"]>) => {
    const settings = kind === "entity" ? entitySettings.get(id) : undefined
    return assetRef(settings?.id ?? id, name)
  }
  return [...particleReferences, ...creatures, ...recipes, ...blocks, ...language, ...gameplay, ...english, ...abilities, ...visuals, ...bookFindings(project), ...(built ? fontFindings(project, built.lang, built.glyphs) : []), ...playFindings(project), ...blueprintSoundFindings(project), ...registryFindings(project)].map((finding) => {
    const { refs = [], ...words } = finding
    const all = uniqueFindingRefs([
      ...refs,
      ...(finding.about ? [aboutRef(finding.about)] : []),
      ...(finding.redo ?? []).map(aboutRef),
      ...(finding.targets ?? []).map(({ about }) => aboutRef(about)),
    ])
    return all.length ? { ...words, refs: all } : words
  })
}

/**
 * r29b: a creature or a book whose own name the mod already gives something else (the build stops on it too, before anything is generated), and one that names
 * itself, said at every build: a world that had it under its old name loses it. A project in which nothing names itself has neither.
 */
function registryFindings(project: Project): Finding[] {
  const about = (row: { kind: "entity" | "book"; id: string; name: string }) => ({ kind: row.kind, id: row.id, name: row.name })
  const mod = project.mod_id
  return [
    ...registryClashes(project).map((clash): Finding => ({ rule: "registry_clash", stops: true, about: about(clash), ...registryClashWords(mod, clash), targets: [{ about: about(clash), field: "identifier", label: `改「${clash.name}」的注册名` }] })),
    ...registryRenames(project).map((row): Finding => ({
      rule: "registry_renamed",
      stops: false,
      about: about(row),
      text: `「${row.name}」的注册名是 ${mod}:${row.registry}，不再是原来的 ${mod}:${row.before}：已有世界里旧名字的${row.kind === "entity" ? "这个生物" : "这本书"}会消失。`,
      fix: `新建的世界不受影响。想让已有世界里的${row.kind === "entity" ? "它" : "这本书"}留着，就删掉 identifier，用回原来的名字。`,
      detail: `registry ${mod}:${row.registry}; before ${mod}:${row.before}`,
    })),
  ]
}

const ABOUT_KINDS = ["entity", "block", "item", "recipe", "logic", "gameplay"] as const

/**
 * The playable standard on the project as it really is (see `playable`): one warning per thing that leaves a
 * question open or that a survival player cannot get to. Never a stop: whether a mod is fun is the person's
 * to say after playing it, and a project from before the standard must build exactly as it did.
 */
export function playFindings(project: Project): Finding[] {
  const report = playability(projectThings(project))
  const planFor = (id: string) => project.blueprint?.entries.find((entry) => entry.asset_id === id)
  const planned = (entry: BlueprintEntry | undefined, question: string) =>
    (entry?.play?.answers ?? []).filter((answer) => answer.question === question).map((answer) => answer.words).slice(0, 1)
  return report.things.flatMap((thing): Finding[] => {
    const about = ABOUT_KINDS.flatMap((kind) => (kind === thing.kind ? [{ kind, id: thing.id, name: thing.title }] : []))[0] ?? null
    // A kind that reports nothing leaves "not known", which is no finding about the mod.
    const open = report.gaps.filter((gap) => gap.thing === thing.id && gap.rule === "unanswered" && !gap.silent)
    const lost = report.gaps.filter((gap) => gap.thing === thing.id && gap.rule !== "unanswered")
    const plan = planFor(thing.id)
    return [
      ...(open.length
        ? [
            {
              rule: "play_gap" as const,
              stops: false,
              about,
              refs: [assetRef(thing.id, thing.title), ...(plan && open.some((gap) => planned(plan, gap.question).length) ? [blueprintRef(plan.key, plan.title)] : [])],
              // broad2: when the plan had answered it, say what it promised, so the person sees the plan and the made thing disagree rather than a bare "no answer".
              text: `「${thing.title}」还有 ${open.length} 个问题没有答案：${open.map((gap) => `${PLAY_QUESTIONS[gap.question].label}（${thing.rows.find((row) => row.question === gap.question)!.lines[0]}${planned(plan, gap.question).map((words) => `；蓝图里答的是「${words}」，做出来的东西里读不出来`).join("")}）`).join("；")}。`,
              // broad1/broad2: a thing asked for as a display piece kept raising "干什么用" here. Say how that case is closed.
              fix: "让 AI 给它补上，或者在蓝图里写明这一处故意不做。它本来就只是摆设的话，让 AI 在蓝图里把「干什么用」标成按你的要求不做，这条提醒就没了。不改也能打包，只是玩起来这里是断的。",
              detail: open.map((gap) => gap.question).join(", "),
            },
          ]
        : []),
      ...lost.map((gap) => ({ rule: "play_unreachable" as const, stops: false, about, text: gap.text, fix: "给缺的那一样东西安排一个生存模式里的来历，或者换一种不需要它的做法。", detail: gap.rule, refs: [assetRef(thing.id, thing.title), ...(gap.related ?? []).map(({ id, title }) => assetRef(id, title))] })),
    ]
  })
}

/** One finding as one plain line, the way the build log and the guide print it. */
export const findingText = (finding: Finding) => `${finding.text}${finding.fix}`
