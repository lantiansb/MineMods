import { playerForceFiles } from "./fabric/player-force"
import { assetRef } from "./finding-refs"
import { compileCinematic } from "./common/cinematic"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { BuildStop } from "./build-stop"
import { modelOnlyCreature } from "./blueprint-creature"
import { loadModelAsset } from "./assets"
import { compileEntity } from "./fabric/entity"
import { creatureTerrainIssues, creatureLairIssues, creatureLootIssues, creatureStructureIssues, creatureSummonIssues, creatureTemptIssues, lairOwner } from "./creature-life"
import { compileGestures } from "./fabric/gesture"
import { compileGameplay } from "./fabric/gameplay"
import { compileEffects } from "./fabric/effect"
import { compileSoundRegistry, soundRegistryCall, type CustomSound } from "./fabric/sound"
import { musicClient } from "./fabric/music-client"
import { musicServer } from "./fabric/music-server"
import { bossSongs, buildSoundData } from "./music-build"
import { creatureSoundIds, soundLookup, type SoundDocument } from "./sound"
import { glowMaskPath } from "./glow-mask"
import { collisionParts } from "./entity-runtime"
import { solidBodyFile } from "./fabric/solid-body"
import { compileHitboxParts } from "./fabric/hitbox"
import { hasHitboxCombat } from "./hitbox-combat"
import { hitboxFollow } from "./hitbox-follow"
import { compileBossRuntime } from "./fabric/boss-runtime"
import { compileBossWeather } from "./fabric/boss-weather"
import { abilitiesDisarm, compileDisarm } from "./fabric/ability-parry"
import { bossWeathers, struckAbility } from "./boss-weather"
import { compileBossLook } from "./fabric/boss-look"
import { bossLookPlan, impactShakes, shakeExtended, shakesOf } from "./boss-look-words"
import { impactSlots } from "./impact-slots"
import { staggerList } from "./combat"
import { bossGlowFile, bossTextureFile } from "./boss-look"
import { usesFieldWarn } from "./fabric/field-warn"
import { soundRangeRuntime } from "./sound-range"
import { nativeShotGroups } from "./native-shot-group"
import { hasOnce, onceJava } from "./once-group"
import { compileAbilityWarn } from "./fabric/ability-warn"
import { shapeInner } from "./entity-runtime"
import { compileBossBars } from "./fabric/boss-bar"
import { compileAbilityCast, patchGestureRuntime } from "./fabric/ability-cast"
import { abilityAssetIssues, abilityAssets, abilityParticleFindings, sharedAbilityIssues, withSharedAbilities } from "./ability-asset"
import { bossBarAsset, bossBarIssues, bossBarLookup } from "./boss-bar"
import { assertCreatable, entrypointClasses } from "./fabric/entrypoints"
import { BLOCK_CLIENT_CLASS } from "./fabric/block-shape"
import { abilityEffectIds } from "./effect-abilities"
import { bookFindings, projectBooks } from "./book-findings"
import { compileBooks } from "./common/book"
import { bookImageIds, bookLookImages } from "./book"

import { compileEmit } from "./common/emit"
import { builtinFiles, sharedBuiltin } from "./common/builtin"
import { feedbackOwner } from "./hit-feedback"
import { resolveAliases, particleDependencies, extendedEmit } from "./particle-emission"
import { compileParticles, particleIndex } from "./common/particles"
import { compileTrails } from "./common/trails"
import { compileProjectiles, projectileImpactNeeds } from "./common/projectiles"
import { gameplayUsesTerrain, gameplayUsesTerrainOptions } from "./common/terrain"
import { abilitiesTerrain, usesTerrainInteractions } from "./terrain"
import { compileGroundFx } from "./common/ground-fx"
import { abilitiesGroundFx, allGroundFx, groundFxParticleAssets } from "./ground-fx"
import { usesFixtureControls } from "./fixture-checks"
import { aimsAtFixture } from "./fixture-events"
import { compileArena } from "./fabric/arena"
import { abilityLeave, arenaFixtureIds, arenaHits, bossArena } from "./arena"
import { stanceAmbience } from "./fabric/boss-weather"
import { bossShowGlowFile, bossShowNeeds, compileBossShow } from "./fabric/boss-show"
import { bossScatter, bossShowAssets, bossShowPlan } from "./boss-show"
import { creatureName, gameplayThings, type GameplayDocument } from "./gameplay"
import { registryClashWords, registryClashes } from "./registry-name"
import { staticChecks } from "./gameplay-check"
import { abilityActionGaps, abilityActionWords, governedCreatures } from "./gameplay-references"
import { readGameplay } from "./gameplay-loop"
import { fingerprint } from "./making"
import { scaffoldProject } from "./fabric/scaffold"
import { MOD_ICON, givenIcon, iconBytes, modIcon } from "./fabric/icon"
import { ReleaseAuthorSchema, modVersion, releaseContact } from "./release"
import { compileContent } from "./content"
import { compileSavedModel } from "./editable-model"
import { openProject, storagePath } from "./project"
import { builtWorkspaceAssets, compileWorkspaceTexture } from "./workspace"
import { guidePose, modGuide } from "./guide"
import { reconcile } from "./reconcile"
import type { GenTarget } from "./platform/adapter"
import { FABRIC_TARGET, genTarget } from "./platform/target"
import { assertPorted } from "./platform/ported"
import { modTomlExtras } from "./platform/metadata"
import { toolchainFor } from "./toolchain/toolchain"
import { modClassName } from "./fabric/scaffold"
import type { TargetId } from "./target/ids"
import { fontVersion, missingInLang } from "./font-findings"
import { fillGlyphs, glyphPaths } from "./glyph-fill"

// Split from build.ts so assembling source never loads the download and process code behind a real build.

function classSuffix(index: number, entityId: string, entityCount: number) {
  return entityCount === 1 ? "" : `Entity${index + 1}_${entityId.replaceAll("-", "").slice(0, 8)}`
}

/** A facade target's common entry and client entry (the mod's main class and `StudioClientPlatform` call them): every creature's, and the blocks' and items'. */
function platformEntrypoints(packageName: string, entityClasses: string[], clientClasses: string[]) {
  const lines = (names: string[]) => names.map((name) => `        ${name}.register();`).join("\n")
  return {
    [`${sourceRoot(packageName)}/StudioContent.java`]: `package ${packageName};

/** What the mod registers, in order: its blocks and items, then each creature. The mod's main class calls this while the mod is constructed. */
public final class StudioContent {
    public static void register() {
        StudioContentRegistry.register();
${lines(entityClasses)}
    }
}
`,
    [`${sourceRoot(packageName)}/client/StudioClient.java`]: `package ${packageName}.client;

/** What a player's game sets up: how each creature is drawn. The facade calls this once when the game's client starts. */
public final class StudioClient {
    public static void register() {
${lines(clientClasses)}
    }
}
`,
  }
}

/**
 * A facade target's common entry (`StudioContent`) and client entry (`StudioClient`) also run these classes' `register()`, by their full
 * names, before what they register themselves: one creature's own content class is the entry, so the entries are edited where they are, whichever wrote them.
 * The same two files on Fabric are the entry points fabric.mod.json names (`onInitialize`, `onInitializeClient`): the calls go first in those instead
 * (the build itself wires Fabric through fabric.mod.json; a check script adding a probe of its own goes through here on every target).
 */
export function addEntryCalls(files: Record<string, string | Uint8Array>, packageName: string, entries: { readonly common: readonly string[]; readonly client: readonly string[] }) {
  for (const [file, names, fabric] of [[`${sourceRoot(packageName)}/StudioContent.java`, entries.common, "public void onInitialize() {"], [`${sourceRoot(packageName)}/client/StudioClient.java`, entries.client, "public void onInitializeClient() {"]] as const) {
    if (!names.length) continue
    const text = files[file]
    const head = typeof text !== "string" ? null : text.includes("public static void register() {") ? "public static void register() {" : text.includes(fabric) ? fabric : null
    if (typeof text !== "string" || head === null) throw new Error(`FACADE_ENTRY_MISSING:${file}`)
    files[file] = text.replace(head, `${head}${names.map((name) => `\n        ${name}.register();`).join("")}`)
  }
}

function mainEntrypoint(packageName: string, entityClasses: string[]) {
  const registrations = entityClasses.map((name) => `        ${name}.register();`).join("\n")
  return `package ${packageName};

import net.fabricmc.api.ModInitializer;

public final class StudioContent implements ModInitializer {
    @Override public void onInitialize() {
        StudioContentRegistry.register();
${registrations}
    }
}
`
}

function clientEntrypoint(packageName: string, clientClasses: string[]) {
  const registrations = clientClasses.map((name) => `        ${name}.register();`).join("\n")
  return `package ${packageName}.client;

import net.fabricmc.api.ClientModInitializer;

public final class StudioClient implements ClientModInitializer {
    @Override public void onInitializeClient() {
${registrations}
    }
}
`
}

function projectParticles(project: Awaited<ReturnType<typeof openProject>>) {
  return project.workspace.assets.flatMap(asset => asset.document.kind === "particle" ? [{ id: asset.id, document: asset.document }] : [])
}

function particleIndices(particles: ReturnType<typeof projectParticles>) {
  return Object.fromEntries(particles.map(asset => [asset.id, particleIndex(particles, asset.document.name)]))
}

/**
 * One creature of a project as the build generates it: its Java, its loot table and its look. The build
 * calls this for every creature; the gameplay review reads the same output to say what the generated
 * creature guarantees (`creature-contract.ts`), so the two cannot disagree. `gameplay`: the mod has
 * gameplay code, so the creature takes on the goals that code registers for its kind. `governed`: the
 * creatures whose targets gameplay code rules on (read from the saved gameplay unless given).
 */
export async function compileProjectEntity(projectDirectory: string, project: Awaited<ReturnType<typeof openProject>>, entity: Awaited<ReturnType<typeof openProject>>["entities"][number], index: number, gameplay: boolean, governed: ReadonlySet<string> = gameplay ? governedCreatures(project) : new Set(), target: GenTarget = FABRIC_TARGET, indices = particleIndices(projectParticles(project)), terrainInteractions = usesTerrainInteractions(project.entities)) {
  const packageName = `com.minemods.content_${project.mod_id}`
  if (!entity.model_asset_id) throw new Error(`SAVED_MODEL_REQUIRED:${entity.id}`)
  if (creatureLootIssues(project, entity).length) throw new Error(`ENTITY_LOOT_UNKNOWN_ITEM:${entity.id}`)
  // A lure that names nothing of this project would be an id the game never has in a player's hand: the creature would follow nobody.
  if (creatureTemptIssues(project, entity).length) throw new Error(`ENTITY_TEMPT_UNKNOWN_ITEM:${entity.id}`)
  // A lair whose floor names a block of this project that is gone is said and not built.
  const terrainIssue = creatureTerrainIssues(project, entity)[0]
  if (terrainIssue) throw new Error(terrainIssue)
  if (creatureLairIssues(project, entity).length) throw new Error(`ENTITY_LAIR_UNKNOWN_BLOCK:${entity.id}`)
  if (creatureSummonIssues(project, entity).length) throw new Error(`ENTITY_SUMMON_UNKNOWN:${entity.id}`)
  // r29: a lair it keeps to that is not a boss's lair of this project would name a structure the mod does not have.
  if (creatureStructureIssues(project, entity).length) throw new Error(`ENTITY_STRUCTURE_UNKNOWN:${entity.id}`)
  // Its `{ lair }` by the id the generated mod names that boss by; the creatures put in its own lair, if it has one; and whether any lair of the mod holds guards.
  // r29b: a boss that names itself has its lair named after that name, so it is written as the structure's own name (a boss without one is written as before).
  const lairId = (id: string) => ((owner) => (owner.entity.identifier ? `${project.mod_id}:${owner.registry}_lair` : { lair: owner.entity.id }))(lairOwner(project, id)!)
  const runtime = entity.runtime?.spawn?.near
    ? { ...entity.runtime, spawn: { ...entity.runtime.spawn, near: { ...entity.runtime.spawn.near, structures: entity.runtime.spawn.near.structures.map((ref) => (typeof ref === "string" ? ref : lairId(ref.lair))) } } }
    : entity.runtime
  const guarding = project.entities.flatMap((other) => (other.runtime?.garrison && lairOwner(project, other.runtime.garrison.structure.lair) ? [{ other, owner: lairOwner(project, other.runtime.garrison.structure.lair)! }] : []))
  const lairGuards = guarding.filter((row) => row.owner.entity.id === entity.id).map((row) => ({ creature: creatureName(row.other), min: row.other.runtime!.garrison!.min, max: row.other.runtime!.garrison!.max }))
  // H3: an ability that shows an effect the project no longer has would call a class that is not generated.
  if (abilityEffectIds(entity.abilities).some((id) => !project.workspace.assets.some((asset) => asset.id === id && asset.document.kind === "effect"))) throw new Error(`ENTITY_EFFECT_MISSING:${entity.id}`)
  // 任务二 §9: a sound of its own the project no longer has would name a sound event that is not registered.
  // Boss 能力 15: and the sounds of its own its shows play.
  const stanceEvents = entity.stances?.list.flatMap(row => row.events ?? []) ?? []
  const ownSounds = [...new Set([...creatureSoundIds(entity), ...bossShowAssets(entity.behavior === "hostile" ? entity.boss : null, stanceEvents).sounds])]
  const lookup = soundLookup(project)
  if (ownSounds.some((id) => !lookup(id))) throw new Error(`ENTITY_SOUND_MISSING:${entity.id}`)
  const customSounds: Record<string, CustomSound> = Object.fromEntries(ownSounds.map((id) => ((found) => [id, { name: found.name, category: found.category }])(lookup(id)!.document)))
  // Boss 能力 11: so would one that shows a particle of the project's own that it no longer has.
  if (particleDependencies(entity).some((id) => !project.workspace.assets.some((asset) => asset.id === id && asset.document.kind === "particle"))) throw new Error(`ENTITY_PARTICLE_MISSING:${entity.id}`)
  // Boss 能力 15: as would a show's effect or particle the project no longer has.
  const shown = bossShowAssets(entity.behavior === "hostile" ? entity.boss : null, stanceEvents)
  if (shown.effects.some((id) => !project.workspace.assets.some((asset) => asset.id === id && asset.document.kind === "effect"))) throw new Error(`ENTITY_EFFECT_MISSING:${entity.id}`)
  if (shown.particles.some((id) => !project.workspace.assets.some((asset) => asset.id === id && asset.document.kind === "particle"))) throw new Error(`ENTITY_PARTICLE_MISSING:${entity.id}`)
  const asset = await loadModelAsset(projectDirectory, entity.model_asset_id)
  const data = z.object({ design: ModelDesignSchema, blockbench: z.unknown().optional(), provenance: z.unknown().optional() }).parse(asset.data)
  const entityId = creatureName(entity)
  const suffix = classSuffix(index, entity.id, project.entities.length)
  const compiled = compileSavedModel(data, entityId)
  const textureAsset = entity.runtime?.texture_asset_id === null || entity.runtime?.texture_asset_id === undefined
    ? undefined
    : project.workspace.assets.find((candidate) => candidate.id === entity.runtime?.texture_asset_id)
  if (entity.runtime?.texture_asset_id && (!textureAsset || textureAsset.module !== "texture" || textureAsset.document.kind !== "texture"))
    throw new Error(`INVALID_ENTITY_TEXTURE:${entity.id}`)
  if (textureAsset?.document.kind === "texture" && (textureAsset.document.width !== compiled.design.texture_size || textureAsset.document.height !== compiled.design.texture_size))
    throw new Error(`ENTITY_TEXTURE_DIMENSIONS:${entity.id}`)
  const texturePng = textureAsset ? compileWorkspaceTexture(textureAsset) : undefined
  const entityWorkspaceAsset = project.workspace.assets.find((candidate) => candidate.module === "entity" && candidate.document.kind === "entity" && candidate.document.model_asset_id === entity.id)
  const files = compileEntity({
    terrainInteractions,
    particleIndices: indices,
    ...(entity.builtin ? {builtin:entity.builtin} : {}),
    sharedBuiltin: sharedBuiltin(project),
    modId: project.mod_id,
    packageName,
    id: entityId,
    name: entity.name,
    ...(entity.name_en ? { name_en: entity.name_en } : {}),
    health: entity.health,
    speed: entity.speed,
    attack_damage: entity.attack_damage,
    behavior: entity.behavior,
    ...(runtime ? { runtime } : {}),
    // r29: a lair with guards, and the lair class of a mod some lair of which holds them; a mod with neither is generated exactly as before.
    ...(lairGuards.length ? { lairGuards } : {}),
    ...(guarding.length ? { lairGuarded: true } : {}),
    ...(entity.sounds ? { sounds: entity.sounds } : {}),
    // 任务二 §9: the sounds of its own it plays; a creature that plays none is generated exactly as before.
    ...(ownSounds.length ? { customSounds } : {}),
    ...(entity.loot?.length ? { loot: entity.loot } : {}),
    ...(entity.experience ? { experience: entity.experience } : {}),
    ...(entity.stationary ? { stationary: entity.stationary } : {}),
    // G2: abilities with a timeline; a creature without any is generated exactly as before.
    ...(entity.emitters?.length ? { emitters: entity.emitters } : {}),
    ...(entity.abilities?.length ? { abilities: entity.abilities } : {}),
    // Combos (连招) are choices after its abilities; a creature without any is generated exactly as before.
    ...(entity.combos?.length ? { combos: entity.combos } : {}),
    // With gameplay code in the mod, each creature takes on the goals that code registered for its kind.
    ...(gameplay ? { gameplayGoals: true } : {}),
    // Who it fights: its own field, and whether gameplay code governs its targets; a creature with neither is generated exactly as before.
    ...(entity.engagement ? { engagement: entity.engagement } : {}),
    ...(governed.has(entityId) ? { targetRules: true } : {}),
    // K1: its collision boxes; a creature that states none is generated exactly as before.
    ...(entity.hitbox ? { hitbox: entity.hitbox } : {}),
    // Boss runtime (10-12): its bar, wake-up, phases, death and leash; a creature without a boss is generated exactly as before.
    ...(entity.boss ? { boss: entity.boss } : {}),
    // Flight and habits (10-12): its state machine in the air and the way it lives; a creature with neither is generated exactly as before.
    ...(entity.flight ? { flight: entity.flight } : {}),
    ...(entity.habits ? { habits: entity.habits } : {}),
    // What lures a follower; one that names nothing is lured by wheat, exactly as before.
    ...(entity.tempt?.length ? { tempt: entity.tempt } : {}),
    // 第 3 步: how it fights between its abilities; a creature that writes nothing of it is generated exactly as before.
    ...(entity.steady ? { steady: entity.steady } : {}),
    ...(entity.stagger ? { stagger: entity.stagger } : {}),
    ...(entity.stances ? { stances: entity.stances } : {}),
    ...(entity.guard ? { guard: entity.guard } : {}),
    ...(entity.tactics ? { tactics: entity.tactics } : {}),
    // The glow picture belongs to the model's own painted texture; a separately drawn texture has none.
    ...(compiled.glow && !texturePng ? { glow: true } : {}),
    ...(texturePng ? { texture: texturePng } : {}),
    logic: project.logic.filter((logic) => logic.entity_id === entity.id),
    animationNames: Object.keys(compiled.animation.animations).map((name) => name.split(".").at(-1)!).filter((name) => name.length > 0),
    model: compiled.design,
    classSuffix: suffix,
  }, target)
  const resources = `src/main/resources/assets/${project.mod_id}`
  files[`${resources}/geo/${entityId}.geo.json`] = JSON.stringify(compiled.geometry, null, 2)
  files[`${resources}/animations/${entityId}.animation.json`] = JSON.stringify(compiled.animation, null, 2)
  files[`${resources}/textures/entity/${entityId}.png`] = texturePng ?? compiled.png
  if (compiled.glow && !texturePng) files[glowMaskPath(`${resources}/textures/entity/${entityId}.png`)] = compiled.glow
  if (project.entities.length === 1) {
    const entry = `${sourceRoot(packageName)}/StudioContent.java`
    files[entry] = String(files[entry]).replace("public static void register() {", "public static void register() {\n        StudioContentRegistry.register();")
  }
  return {
    entityId,
    // What the jar holds of this creature's look, for the reconciliation, the guide and the .bbmodel written beside the jar.
    look: { name: entity.name, geometry: compiled.geometry, animation: compiled.animation, png: texturePng ?? compiled.png, glow: Boolean(compiled.glow && !texturePng), cubes: compiled.design.bones.map((bone) => bone.cubes.map((cube) => cube.name)), clips: compiled.design.animations },
    creatureSource: `${sourceRoot(packageName)}/entity/StudioCreature${suffix}.java`,
    contentClass: `StudioContent${suffix}`,
    clientClass: `StudioClient${suffix}`,
    asset,
    data,
    entity,
    entityWorkspaceAsset,
    textureAsset,
    files,
    // A part of its collision boxes follows a bone that moves: the mod's part class then asks its creature how far (the same measure compileEntity writes the table from).
    follows: Boolean(entity.hitbox?.parts?.length && hitboxFollow(entity.hitbox, compiled.design, entity.behavior === "hostile" ? (entity.abilities ?? []) : [])),
  }
}

/** Caller holds the project lock and supplies a newly created, empty output directory. */
export async function assembleBuildSource(
  projectDirectory: string,
  sourceDirectory: string,
  templateDirectory: string,
  /** A gameplay that is not saved yet, put in the place of its asset (or added): how a code check compiles a version before it may be saved. */
  /** `author`: the person's name as the app knows it, used only when the project's own `release.author` says nothing. */
  /**
   * `target`: the target to generate for; left out, the project's own (`project.target`). Fabric 1.21.1 is generated exactly as before. A facade
   * target (Forge, NeoForge) starts from its toolchain's template, the sibling of `templateDirectory` under the same templates folder
   * (`templates/forge-1.20.1`), and stops before writing anything when the project uses a feature group not ported to it yet (`platform/ported.ts`).
   */
  /** `glyphFonts`: where installed fonts are looked for to draw the characters the game cannot (补字); left out, this computer's font folders. */
  options: { candidate?: { asset_id: string; title: string; document: GameplayDocument }; author?: string; target?: TargetId; glyphFonts?: readonly string[] } = {},
) {
  // 技能资产: a creature that uses an ability asset is built with that ability among its own (`withSharedAbilities`); one that cannot be stops below.
  const stored = await openProject(projectDirectory)
  const unmodelled = stored.entities.filter((entity) => !entity.model_asset_id)
  // A row that only stands for a model a blueprint entry made is no creature: left out like one with no model, but its model asset stays (a texture may be made on it).
  const modelOnly = stored.entities.filter((entity) => entity.model_asset_id && modelOnlyCreature(stored, entity))
  const skipped = [...unmodelled, ...modelOnly]
  const omitted = new Set(skipped.map((entity) => entity.id))
  const entities = stored.entities.filter((entity) => !omitted.has(entity.id))
  const logic = stored.logic.filter((rule) => !omitted.has(rule.entity_id))
  const unbuilt = new Set(unmodelled.map((entity) => entity.id))
  const skippedAssets = new Set([
    ...unbuilt,
    ...stored.logic.filter((rule) => omitted.has(rule.entity_id)).map((rule) => rule.id),
    ...stored.workspace.assets.flatMap((asset) => asset.document.kind === "entity" && unbuilt.has(asset.document.model_asset_id) ? [asset.id] : []),
  ])
  const snapshot = {
    ...stored,
    entities,
    logic,
    ...(omitted.size ? { workspace: { assets: stored.workspace.assets.filter((asset) => !skippedAssets.has(asset.id) || asset.document.kind === "model" && stored.items.some((item) => item.model_asset_id === asset.id)) } } : {}),
  }
  const particleStops = abilityParticleFindings(snapshot)
  if (particleStops.length) throw new BuildStop("particle_reference", particleStops)
  const project = withSharedAbilities({ ...snapshot, entities: entities.map(entity => resolveAliases(feedbackOwner(entity))) })
  const built = skipped.length ? new Set(builtWorkspaceAssets(project).map((asset) => asset.id)) : new Set<string>()
  if (skipped.length && !entities.length && !project.blocks.length && !project.items.length && !project.recipes.length && !built.size && !options.candidate)
    throw unmodelled.length ? new Error(`SAVED_MODEL_REQUIRED:${unmodelled[0]!.id}`) : new BuildStop("model_only", modelOnly.map((entity) => ({
      text: `「${entity.name}」只有模型，还没有生物文档，模组里没有别的东西可以打包。`,
      fix: "先把用这个模型的生物做出来（写生物文档），或者再做一样方块、物品，再打包。",
    })))
  const removedAssets = new Set([...skippedAssets].filter((id) => !project.workspace.assets.some((asset) => asset.id === id)))
  const dangling = project.workspace.assets.filter((asset) => built.has(asset.id) && asset.dependencies.some((id) => removedAssets.has(id)))
  if (dangling.length) throw new BuildStop("omitted_creature_reference", dangling.map((asset) => ({
    text: `「${asset.title}」用到了还没有模型的生物或它的内容。`,
    fix: "给那只生物补上模型，或者从这里去掉这项引用，再打包。",
  })))
  const packageName = `com.minemods.content_${project.mod_id}`
  const target = options.target || project.target !== FABRIC_TARGET.manifest.id ? genTarget(options.target ?? project.target) : FABRIC_TARGET
  const facade = target.loader.facade
  if (facade) assertPorted(project, target)
  // A moment of an ability that a gameplay is to do, with no gameplay to do it: the ability would play its motion and nothing would happen. A gameplay being checked is held to its own entries by that check
  // (`checkGameplayReferences`), so only a build of what is saved stops here.
  const actionGaps = options.candidate ? [] : abilityActionGaps(project)
  if (actionGaps.length) throw new BuildStop("ability_gameplay", actionGaps.map(abilityActionWords))
  // Boss 能力 6: a boss whose own bar is gone, or does not fit it (its stages, its icons' abilities), is said and not built.
  const barLookup = bossBarLookup(project)
  const scripts = project.workspace.assets.flatMap(a => a.document.kind === "gameplay" && a.id !== options.candidate?.asset_id ? [a.document] : [])
  if (options.candidate) scripts.push(options.candidate.document)
  const boundEvents = abilityAssets(project).filter(a => a.document.bindings.length).flatMap(a => a.document.events)
  const castGround = boundEvents.filter(e => e.type === "crack" || e.type === "shockwave" || e.type === "beam")
  const castTerrain = boundEvents.filter(e => e.type === "terrain_rise" || e.type === "block_swap")
  const terrainInteractions = castTerrain.some(e => e.restore_on_exit || e.type === "terrain_rise" && (e.blocks || e.hardness !== undefined)) || gameplayUsesTerrainOptions(scripts) || usesTerrainInteractions(project.entities) || abilityAssets(project).some(a=>a.document.hits.some(h=>h.type==="area" && h.break_terrain!==undefined))
  const fighters = project.entities.filter((entity) => entity.behavior === "hostile")
  const radialForces = fighters.some(entity => entity.abilities?.some(ability => struckAbility(ability).hits.some(hit =>
    hit.type === "area" && (hit.force?.kind === "pull" || hit.force?.kind === "push"))))
  const barStops = fighters.flatMap((entity) => bossBarIssues(entity, barLookup).filter((issue) => issue.stops))
  if (barStops.length) throw new BuildStop(barStops[0]!.rule, barStops)
  // 技能资产: an ability asset bound to something that is gone, or naming what the target's game lacks, and a creature's use of one that cannot be its ability, are said and not built.
  const abilityStops = [...abilityAssets(project).flatMap((asset) => abilityAssetIssues(project, asset, target.version.minecraft)), ...sharedAbilityIssues(project)].filter((issue) => issue.stops)
  if (abilityStops.length) throw new BuildStop("ability_asset", abilityStops)
  // The ability assets a player or a block casts (bound to something): null when there is none, and every use below then adds nothing, so such a project builds byte for byte as before.
  const castAbilities = abilityAssets(project).filter((asset) => asset.document.bindings.length > 0)
  const hasGameplay = project.workspace.assets.some((value) => value.document.kind === "gameplay") || Boolean(options.candidate)
  const particleAssets = projectParticles(project)
  const indices = particleIndices(particleAssets)
  const compiledEntities = await Promise.all(project.entities.map((entity, index) => compileProjectEntity(projectDirectory, project, entity, index, hasGameplay, hasGameplay ? governedCreatures(project) : new Set(), target, indices, terrainInteractions)))
  const contentFiles = compileContent({
    mod_id: project.mod_id,
    package_name: packageName,
    entities: project.entities,
    blocks: project.blocks,
    items: project.items,
    item_models: Object.fromEntries(project.workspace.assets.flatMap(asset => {
      if (asset.document.kind !== "model") return []
      const { kind: _kind, ...design } = asset.document
      return [[asset.id, design]]
    })),
    recipes: project.recipes,
    logic: project.logic,
  }, target)
  const partFollows = compiledEntities.some(entry => entry.follows)
  // A moving part on another creature also adds hitboxMoved to the shared Owner interface.
  if (partFollows) for (const entry of compiledEntities) {
    if (entry.follows || !collisionParts(entry.entity.hitbox).length || !entry.entity.emitters?.some(emitter => emitter.bone)) continue
    const java = entry.files[entry.creatureSource]
    if (typeof java === "string") entry.files[entry.creatureSource] = java.replace("    public float[] hitboxMoved(int index)", "    @Override public float[] hitboxMoved(int index)")
  }
  const entityFiles = Object.assign({}, ...compiledEntities.map((entry) => entry.files))
  const entityClasses = compiledEntities.map((entry) => entry.contentClass)
  const clientClasses = compiledEntities.map((entry) => entry.clientClass)
  const gestureAssets = project.workspace.assets.flatMap((asset) => (asset.document.kind === "gesture" ? [{ id: asset.id, document: asset.document }] : []))
  // Null for a project without cast actions: every use below then adds nothing, so such a project builds byte for byte as before.
  const gestures = gestureAssets.length
    ? compileGestures({ modId: project.mod_id, packageName, projectName: project.name, projectNameEn: project.name_en, profileId: project.target, gestures: gestureAssets }, target)
    : null
  // ---- gameplay (AI-written code) ----
  const candidate = options.candidate
  const gameplayAssets = [
    ...project.workspace.assets.flatMap((asset) => (asset.document.kind === "gameplay" && asset.id !== candidate?.asset_id ? [{ id: asset.id, title: asset.title, revision: asset.revision, document: asset.document }] : [])),
    ...(candidate ? [{ id: candidate.asset_id, title: candidate.title, revision: (project.workspace.assets.find((asset) => asset.id === candidate.asset_id)?.revision ?? 0) + 1, document: candidate.document }] : []),
  ]
  // Code that leaves its bounds or points at something that is gone never reaches a compiler, whoever put it in the project.
  gameplayAssets.forEach((asset) => {
    const checks = staticChecks(project, asset.document, asset.id)
    if (checks.bounds.length) throw new Error(`GAMEPLAY_OUT_OF_BOUNDS:${asset.id}`)
    if (checks.references.length && asset.id !== candidate?.asset_id) throw new Error(`GAMEPLAY_BROKEN_REFERENCE:${asset.id}`)
  })
  // H3: null for a project without effects: every use below then adds nothing, so such a project builds byte for byte as before.
  const castWarns = castAbilities.flatMap(a => a.document.hits.flatMap(h => h.type === "area" && h.warn ? [h.warn] : []))
  const hasSoundRange = project.entities.some(e => e.sounds?.range_blocks !== undefined || Object.values(e.sounds?.ranges ?? {}).some(Boolean) || e.boss?.intro?.range_blocks !== undefined || e.boss?.phases.some(p => p.range_blocks !== undefined) || [e.boss?.intro,e.boss?.death].some(show => show?.steps?.some(s => s.type === "sound" && s.range_blocks !== undefined))) || fighters.some(e => e.abilities?.some(a => a.events.some(v => v.type === "sound" && v.range_blocks !== undefined))) || castAbilities.some(a => Object.values(a.document.sound_ranges ?? {}).some(Boolean) || a.document.events.some(v => v.type === "sound" && v.range_blocks !== undefined))
  const nativeShots = fighters.some(e=>e.abilities?.some(a=>a.hits.some(h=>h.type==="shot" && h.once_group))) || castAbilities.some(a=>a.document.hits.some(h=>h.type==="shot" && h.once_group)) ? nativeShotGroups(packageName,project.mod_id,target) : null
  const ranged = hasSoundRange ? soundRangeRuntime(packageName,project.mod_id,target) : null
  const grouped = fighters.some(entity => entity.abilities?.some(hasOnce)) || castAbilities.some(a => [...a.document.events,...a.document.hits].some(v => "once_group" in v && !!v.once_group))
  const ringWarns = fighters.flatMap(e => (e.abilities ?? []).flatMap(a => a.events.flatMap(v => v.type === "shockwave" && v.warn ? [v.warn] : [])))
  const fieldWarns = fighters.flatMap(e => (e.abilities ?? []).flatMap(a => a.hits.flatMap(h => h.type === "area" && usesFieldWarn(h.warn) ? [h.warn!] : [])))
  fieldWarns.push(...castWarns, ...ringWarns)
  const effectAssets = project.workspace.assets.flatMap((asset) => (asset.document.kind === "effect" ? [{ id: asset.id, title: asset.title, document: asset.document }] : []))
  // r29b: a creature or a book whose own name the mod already gives something else would not load; a project in which none names itself has none.
  const registryStops = registryClashes(project).map((clash) => registryClashWords(project.mod_id, clash))
  if (registryStops.length) throw new BuildStop("registry_clash", registryStops)
  // 书: a page that does not fit, or a picture the project no longer has, is said and not built; a project without books never gets here.
  const bookAssets = projectBooks(project)
  const bookStops = bookAssets.length ? bookFindings(project).filter((finding) => finding.stops) : []
  if (bookStops.length) throw new BuildStop("book", bookStops)
  const books = bookAssets.length
    ? compileBooks({
        modId: project.mod_id,
        packageName,
        books: bookAssets,
        // The pages' pictures and the look's (cover, paper, frame, icon); a look's pixels go too, for its frame and its cover's ink.
        pictures: Object.fromEntries([...new Set(bookAssets.flatMap((book) => bookImageIds(book.document)))].map((id) => {
          const picture = project.workspace.assets.find((asset) => asset.id === id)!
          if (picture.document.kind !== "texture") throw new Error(`BOOK_IMAGE_MISSING:${id}`)
          return [id, { png: compileWorkspaceTexture(picture), width: picture.document.width, height: picture.document.height, ...(bookAssets.some((book) => bookLookImages(book.document.look).some(([, used]) => used === id)) ? { texture: picture.document } : {}) }]
        })),
      }, target)
    : null
  // r29c: an effect shown at a size of its own, by a creature or a player's cast; only then does the effect entity carry one.
  const sizedEffects = [...fighters.flatMap(e => e.abilities ?? []), ...castAbilities.map(a => a.document)].some(a => a.events.some(e => e.type === "effect" && e.size !== undefined))
  const effects = effectAssets.length ? compileEffects({ modId: project.mod_id, packageName, effects: effectAssets, fading: fieldWarns.some(w => !!w.effect), sized: sizedEffects }, target) : null
  // 任务二 §9: null for a project without sounds of its own: every use below then adds nothing, so such a project builds byte for byte as before.
  const soundDocuments = project.workspace.assets.flatMap((asset) => (asset.document.kind === "sound" ? [asset.document as SoundDocument] : []))
  const songs = bossSongs(project)
  const audio = soundDocuments.length || songs.length ? await buildSoundData(projectDirectory, project.mod_id, soundDocuments, songs) : null
  const sounds = audio ? { ...audio, java: compileSoundRegistry({ modId: project.mod_id, packageName, names: audio.names }, target) } : null
  if (sounds) {
    // The content registry loads the sound class first thing while the mod starts, before the game freezes its registries.
    const registry = `${sourceRoot(packageName)}/StudioContentRegistry.java`
    const opening = "    public static void register() {\n"
    if (!String(contentFiles[registry]).includes(opening)) throw new Error("SOUND_REGISTRY_UNPLACED")
    contentFiles[registry] = String(contentFiles[registry]).replace(opening, opening + soundRegistryCall)
  }
  // K1: null for a project in which no creature has further collision boxes: every use below then adds nothing, so such a project builds byte for byte as before.
  const blockers = project.entities.some(entity => entity.hitbox?.blockers?.length)
  const hitboxParts = project.entities.some((entity) => collisionParts(entity.hitbox).length) ? compileHitboxParts({ modId: project.mod_id, packageName, lean: project.entities.some((entity) => entity.flight && collisionParts(entity.hitbox).length), follow: partFollows, combat: project.entities.some((entity) => hasHitboxCombat(entity.hitbox, [...(entity.abilities ?? []), ...(entity.shared_abilities ?? [])], entity.stances)), blockers, solid: blockers || project.entities.some((entity) => entity.hitbox?.parts?.some((part) => part.solid)) }, target) : null
  // Boss runtime (10-12): null for a project in which no hostile creature has an ability that shakes a screen or throws up the ground (only those abilities are compiled): every use below then adds nothing, so such a project builds byte for byte as before.
  const feltEvents = (type: "shake" | "debris" | "camera" | "sky_tint" | "break") => project.entities.some((entity) => entity.behavior === "hostile" && (entity.abilities ?? []).some((ability) => ability.events.some((event) => event.type === type)))
  // Boss 能力 15: what the bosses' wake-ups and deaths need of the shared runtimes (a shake, a part that comes off, a glow, a weather); nothing for a project without show steps.
  const stanceEvents = fighters.flatMap(entity => entity.stances?.list.flatMap(row => row.events ?? []) ?? [])
  const showNeeds = bossShowNeeds(project.entities.map((entity) => (entity.behavior === "hostile" ? entity.boss : null)), stanceEvents)
  // 落地炸开: a thrown thing that shakes the screens where it comes down needs the shake too.
  const bossShake = project.entities.some((entity) => entity.behavior === "hostile" && impactSlots(entity.abilities ?? [], staggerList(entity.stagger)).some((slot) => slot.fx.shake)) || feltEvents("shake") || castAbilities.some((asset) => asset.document.events.some((event) => event.type === "shake")) || project.entities.some((entity) => entity.behavior === "hostile" && (entity.abilities ?? []).some((ability) => impactShakes(ability).length > 0)) || showNeeds.shake
  const bossDebris = feltEvents("debris")
  const debrisThrow = fighters.some(e => (e.abilities ?? []).some(a => a.events.some(v => v.type === "debris" && v.throw)))
  const cinematicImpacts = fighters.flatMap(e => (e.abilities ?? []).flatMap(a => a.hits.flatMap(h => h.type === "projectile" && h.impact ? [h.impact] : [])))
  const cameraCue = feltEvents("camera") || cinematicImpacts.some(i => i.camera)
  const skyCue = feltEvents("sky_tint") || cinematicImpacts.some(i => i.sky_tint)
  const edgeCue = fighters.some(e => (e.abilities ?? []).some(a => a.events.some(v => v.type === "sky_tint" && v.edge))) || cinematicImpacts.some(i => i.sky_tint?.edge)
  // An ability that breaks blocks (`break`): its runtime class only then, so every other project builds as before.
  const dashBreaks = fighters.some(e => e.abilities?.some(a => a.moves.some(m => "type" in m && m.type === "dash" && m.break_hardness !== undefined)))
  const bossBreaks = dashBreaks || feltEvents("break") || boundEvents.some(e => e.type === "break")
  // Boss 能力 8: the longer shake (roll, a change of view, falloff, frequency, the new cap) only when some shake of a hostile creature goes past what could be written before: any other project's shake is what it always was, to the byte.
  const bossShakeMore = project.entities.some((entity) => entity.behavior === "hostile" && shakesOf(entity.abilities ?? []).some(shakeExtended)) || showNeeds.shakeMore
  const ambience = fighters.some(entity => entity.boss && stanceAmbience(entity.stances))
  const phaseWeather = ambience || project.entities.some((entity) => entity.behavior === "hostile" && bossWeathers(entity.boss)) || showNeeds.weather
  const cinematic = cameraCue || skyCue ? compileCinematic({ modId: project.mod_id, packageName, camera: cameraCue, sky: skyCue, edge: edgeCue, sharedSky: phaseWeather, sharedView: !facade && bossShakeMore && bossShake }, target) : null
  const bossRuntime = bossShake || bossDebris || bossBreaks ? compileBossRuntime({ modId: project.mod_id, packageName, quietBreak: boundEvents.some(e => e.type === "break" && e.particles === false) || fighters.some(e => e.abilities?.some(a => a.events.some(v => v.type === "break" && v.particles === false))), dashBreaks, shake: bossShake, debris: bossDebris, debrisLook: fighters.some(e => e.abilities?.some(a => a.events.some(v => v.type === "debris" && (v.block || v.dust)))), ...(cameraCue ? { camera: true } : {}), ...(debrisThrow ? { debrisThrow: true } : {}), ...(bossBreaks ? { breaks: true } : {}), ...(bossShakeMore ? { shakeMore: true } : {}) }, target) : null
  // Boss 能力 10: null for a project in which no boss changes its model with its phases: every use below then adds nothing, so such a project builds byte for byte as before.
  const lookPlans = project.entities.flatMap((entity) => (entity.behavior === "hostile" && (entity.boss || entity.stances) ? ((plan) => (plan ? [{ entity, plan }] : []))(bossLookPlan(entity.boss ?? { phases: [] }, entity.boss ? entity.abilities ?? [] : [], entity.stances)) : []))
  // Boss 能力 12、13: null for a project in which no hostile boss has an arena or an ability that needs one (fog, leave, a hit over the arena or at its middle): every use
  // below then adds nothing, so such a project builds byte for byte as before. Its fixtures are the fixture assets the arenas put down.
  const arenaBosses = fighters.filter((entity) => entity.boss && bossArena(entity.boss, entity.abilities ?? []))
  const arenaFogs = arenaBosses.some((entity) => Boolean(entity.boss?.arena?.fog))
  const arena = arenaBosses.length
    ? compileArena({ returnOffset: arenaBosses.some(entity => entity.abilities?.some(move => typeof abilityLeave(move)?.back.place === "object")), terrainInteractions, fogCondition:arenaBosses.some(entity=>entity.emitters?.some(e=>typeof e.when==="object" && "if" in e.when && e.when.if==="fog")), sharedBuiltin:sharedBuiltin(project), extendedFog: arenaBosses.some((entity) => entity.boss?.arena?.fog?.fade_end !== undefined), fixtureLighting: arenaBosses.some(entity => entity.boss?.arena?.fixtures.some(group => group.light || group.ember_light)), fixtureControls: arenaBosses.some(usesFixtureControls), fixtureUntouched: arenaBosses.some((entity) => entity.boss?.arena?.fixtures.some((group) => !group.use)), modId: project.mod_id, packageName, warned: arenaBosses.some((entity) => (entity.abilities ?? []).some((ability) => arenaHits(ability).some(({ hit }) => hit.warn !== undefined && hit.safe !== undefined))), safeMesh: arenaBosses.some((entity) => (entity.abilities ?? []).some((ability) => arenaHits(ability).some(({ hit }) => hit.warn?.paint === "mesh" && hit.safe !== undefined))), fixtures: [...new Set(arenaBosses.flatMap((entity) => arenaFixtureIds(entity.boss)))].map((id) => { const asset = project.workspace.assets.find((value) => value.id === id); if (!asset || asset.document.kind !== "fixture") throw new BuildStop("boss_arena", [{ text: "Boss 场地上摆的一样物件找不到了（或者那不是一个场地物件资产）。", fix: "让 boss.arena.fixtures 的 look.asset 指向这个工程里的场地物件资产，并让生物依赖它。" }]); return { id: asset.id, title: asset.title, document: asset.document } }) }, target)
    : null
  const bossLook = lookPlans.length || showNeeds.drop || showNeeds.glow
    ? compileBossLook({ modId: project.mod_id, packageName, drop: lookPlans.some(({ plan }) => plan.abilityDrops.length > 0 || plan.phaseDrops.some((drops) => drops.length > 0)) || showNeeds.drop, glow: lookPlans.some(({ plan }) => plan.slots.length > 0) || showNeeds.glow, ...(arenaFogs ? { fogFree: true } : {}) }, target)
    : null
  // Its glowing pictures that are texture assets, written beside the creature's texture where its renderer draws them from (`bossGlowFile`); the model's own glowing parts are its glow mask, written with the model.
  const lookGlowFiles = Object.fromEntries(
    lookPlans.flatMap(({ entity, plan }) =>
      plan.slots.flatMap((slot, index) => {
        if (slot === "emissive") return []
        const asset = project.workspace.assets.find((value) => value.id === slot.asset)
        if (!asset || asset.document.kind !== "texture") throw new BuildStop("boss_look_glow", [{ text: `生物「${entity.name}」的阶段发光用的贴图找不到了（或者那不是一张贴图）。`, fix: "换成这个工程里的一张贴图资产，或者改用模型自己发光的部分。" }])
        return [[`src/main/resources/assets/${project.mod_id}/${bossGlowFile(creatureName(entity), slot, index)}`, compileWorkspaceTexture(asset)] as const]
      }),
    ),
  )
  // The textures its phases put on, beside the creature's texture where its renderer takes them from (`bossTextureFile`), each the size of the model's texture. A model with glowing parts
  // has its glow mask beside each too: GeckoLib's glow layer looks for the mask beside the texture worn, so the same parts glow whichever it wears.
  const lookTextureFiles = Object.fromEntries(
    lookPlans.flatMap(({ entity, plan }) => {
      const creature = creatureName(entity)
      const resources = `src/main/resources/assets/${project.mod_id}`
      const mask = entityFiles[glowMaskPath(`${resources}/textures/entity/${creature}.png`)] as Uint8Array | undefined
      const side = compiledEntities.find((entry) => entry.entityId === creature)?.data.design.texture_size
      return plan.textures.flatMap((id, index) => {
        const asset = project.workspace.assets.find((value) => value.id === id)
        if (!asset || asset.document.kind !== "texture") throw new BuildStop("boss_look_texture", [{ text: `生物「${entity.name}」的阶段换的贴图找不到了（或者那不是一张贴图）。`, fix: "换成这个工程里的一张贴图资产，或者换回模型自己的贴图。" }])
        if (asset.document.width !== side || asset.document.height !== side) throw new BuildStop("boss_look_texture", [{ text: `生物「${entity.name}」的阶段换的贴图「${asset.title}」是 ${asset.document.width}×${asset.document.height}，模型的贴图是 ${side}×${side}：两张对不齐。`, fix: `照着模型的贴图改画一张 ${side}×${side} 的贴图。` }])
        const file = `${resources}/${bossTextureFile(creature, index + 1)}`
        return [[file, compileWorkspaceTexture(asset)] as const, ...(mask ? [[glowMaskPath(file), mask] as const] : [])]
      })
    }),
  )
  // Boss 能力 15: the glowing pictures of the bosses' shows that are texture assets, beside the creature's texture (`bossShowGlowFile`); and the one class their structures and watcher go through.
  const showGlowFiles = Object.fromEntries(
    project.entities.flatMap((entity) =>
      ((entity.behavior === "hostile" && entity.boss ? bossShowPlan(entity.boss) : null)?.slots ?? []).flatMap((slot, index) => {
        if (slot === "emissive") return []
        const asset = project.workspace.assets.find((value) => value.id === slot.asset)
        if (!asset || asset.document.kind !== "texture") throw new BuildStop("boss_show_glow", [{ text: `生物「${entity.name}」的演出发光用的贴图找不到了（或者那不是一张贴图）。`, fix: "换成这个工程里的一张贴图资产，或者改用模型自己发光的部分。" }])
        return [[`src/main/resources/assets/${project.mod_id}/${bossShowGlowFile(creatureName(entity), slot, index)}`, compileWorkspaceTexture(asset)] as const]
      }),
    ),
  )
  const bossShow = showNeeds.any ? compileBossShow({ modId: project.mod_id, packageName }, target) : null
  // Boss 能力 11: null for a project without particles of its own, and for one in which no hostile creature draws a weapon trail (only those abilities are compiled): every use below then adds nothing,
  // so such a project builds byte for byte as before. The particles are registered by their own two classes (Fabric's entry points, a facade target's entries) and the trails
  // drawn by the renderer of each creature that has them (A 组; see common/particles.ts and common/trails.ts).
  const strikeLooks = fighters.flatMap(e => e.abilities?.flatMap(a => a.events.flatMap(v => v.type === "lightning" && v.look ? [v.look] : [])) ?? [])
  const needsEmit = strikeLooks.some(look => look.particle) || castAbilities.some(a => a.document.events.some(e => e.type === "particle" && (extendedEmit(e, true) || typeof e.particle !== "string" || e.where === "hit"))) || stanceEvents.some(event => event.type === "particle" && extendedEmit(event, true)) || project.entities.some(e => e.emitters?.length || bossScatter(e.boss)) || fighters.some(entity => entity.abilities?.some(a => a.events.some(e => e.type === "particle" && extendedEmit(e))))
  const particles = particleAssets.length ? compileParticles({ modId: project.mod_id, packageName, particles: particleAssets, emit: needsEmit }, target) : null
  const emit = needsEmit ? compileEmit(project.mod_id, packageName, !!particles, target) : null
  const trails = project.entities.some((entity) => entity.behavior === "hostile" && (entity.abilities ?? []).some((ability) => ability.events.some((event) => event.type === "trail"))) ? ((made) => (facade ? { files: Object.fromEntries(Object.entries(made.files).map(([name, text]) => [name, target.version.rewriteJava(text)])) } : made))(compileTrails({ packageName, minecraft: target.version.minecraft })) : null
  // Boss 能力 3: null for a project in which no hostile creature has a hit with a warning: every use below then adds nothing, so such a project builds byte for byte as before.
  // Boss 能力 6: null for a project in which no boss shows a bar of its own: every use below then adds nothing, so such a project builds byte for byte as before.
  const barBosses = fighters.flatMap((entity) => {
    const id = bossBarAsset(entity.boss)
    const bar = id ? barLookup(id) : null
    return id && bar && entity.boss ? [{ creature: creatureName(entity), bar: { id, document: bar.document }, phases: entity.boss.phases, choices: [...(entity.abilities ?? []), ...(entity.abilities?.length ? (entity.combos ?? []) : [])].map((choice) => choice.id) }] : []
  })
  const bossBars = barBosses.length ? compileBossBars({ modId: project.mod_id, packageName, bosses: barBosses }, target) : null
  // (Boss 能力 7: a lightning's warning is the warning of the hit it lands as, `struckAbility`; Boss 能力 2: a volley from the sky may be warned of too.)
  // A warned hollow arc is drawn with its inner edge. Only a project that has one gets the classes that draw it: every other project's two warning classes are byte for byte what they were
  // before arcs could be hollow (found on a real project built with r13 and r14, 2026-11-17: the two files differed though it wrote no `inner`).
  const hollowWarned = project.entities.some((entity) => entity.behavior === "hostile" && (entity.abilities ?? []).map(struckAbility).some((ability) => ability.hits.some((hit) => hit.type === "area" && hit.warn !== undefined && shapeInner(hit.shape) > 0)))
  const abilityWarn = ringWarns.length || castWarns.length || project.entities.some((entity) => entity.behavior === "hostile" && (entity.abilities ?? []).map(struckAbility).some((ability) => ability.hits.some((hit) => (hit.type === "area" || hit.type === "projectile") && hit.warn !== undefined))) ? compileAbilityWarn({ ring: ringWarns.length > 0, mesh:ringWarns.some(w => w.paint !== "dust") || castWarns.some(w => w.paint === "mesh") || fighters.some(e => e.abilities?.some(a => struckAbility(a).hits.some(h => (h.type === "area" || h.type === "projectile") && h.warn?.paint === "mesh"))), modId: project.mod_id, packageName, fields: fieldWarns.length > 0, own: fieldWarns.some(w => !!w.effect), ...(hollowWarned || ringWarns.length ? { hollow: true } : {}) }, target) : null
  // Boss 能力 7: null for a project in which no hostile boss has a phase with a weather and no hostile creature's ability a lightning (only those are compiled): every use below
  // then adds nothing, so such a project builds byte for byte as before.
  const bossWeather = ((weather, lightning) => (weather || lightning ? compileBossWeather({ modId: project.mod_id, packageName, weather, ambience, lightning, styled: strikeLooks.length > 0, ...(skyCue ? { tint: true } : {}) }, target) : null))(
    phaseWeather,
    project.entities.some((entity) => entity.behavior === "hostile" && (entity.abilities ?? []).some((ability) => ability.events.some((event) => event.type === "lightning"))),
  )
  // Boss 能力 2: null for a project in which no hostile creature throws a thing of its own: every use below then adds nothing, so such a project builds byte for byte as before.
  const thrown = fighters.flatMap((entity) => (entity.abilities ?? []).flatMap((ability) => ability.hits.flatMap((hit) => (hit.type === "projectile" ? [hit] : []))))
  const projectiles = thrown.length ? compileProjectiles({ once: thrown.some(h => !!h.once_group), terrainInteractions, fixtureTargets: thrown.some(aimsAtFixture), modId: project.mod_id, packageName, hiddenEffects:thrown.some(h => h.effects.some(e => e.particles === false)), trails: thrown.flatMap(hit => hit.trail ?? []), motion: thrown.some(hit => hit.trail || hit.lifetime_ticks !== undefined || hit.homing || hit.pierce || hit.bounces), effects: thrown.some((hit) => "effect" in hit.look), warned: thrown.some((hit) => hit.warn !== undefined), ...(thrown.some((hit) => "sky" in hit.from && hit.from.sky.over === "center") ? { arena: true } : {}), ...(thrown.some((hit) => hit.size !== undefined) ? { sized: true } : {}), ...(effects?.additive && thrown.some((hit) => "effect" in hit.look) ? { additive: true } : {}), impact: projectileImpactNeeds(thrown) }, target) : null
  // 第 4 步: null for a project in which no hostile creature puts down a ground hazard, a crack, a shockwave or a beam (nor leaves one where a thrown thing comes down): every use below
  // then adds nothing, so such a project builds byte for byte as before.
  const terrain = castTerrain.length > 0 || castGround.some(e => e.type === "shockwave" && e.pop_blocks) || terrainInteractions || fighters.some((entity) => abilitiesTerrain(entity.abilities)) || gameplayUsesTerrain(gameplayAssets.map(asset => asset.document))
  const terrainMaterial = castTerrain.some(e => e.type === "terrain_rise" && e.material !== undefined) || terrainInteractions || fighters.some(entity => entity.abilities?.some(ability => ability.events.some(e => e.type === "terrain_rise" && e.material !== undefined)))
  const pointed = castTerrain.some(e => e.type === "terrain_rise" && (e.shape === "spike" || e.taper !== undefined)) || terrainMaterial || fighters.some(entity => entity.abilities?.some(ability => ability.events.some(e => e.type === "terrain_rise" && e.shape === "spike"))) || gameplayAssets.some(asset => asset.document.sources.some(source => /\bterrainRise\s*\(/.test(source.content) && /"spike"/.test(source.content)))
  const finishGround = [...stanceEvents.flatMap(event => event.type === "ground" ? event.ground : []), ...fighters.flatMap(entity => entity.boss?.phases.flatMap(phase => phase.finish?.flatMap(event => event.type === "ground" ? event.ground : []) ?? []) ?? [])]
  const castHazards = castAbilities.flatMap(a => a.document.events.flatMap(e => e.type === "hazard" ? [e] : []))
  const strikeFlashes = strikeLooks.flatMap(look => look.flash ? [{...look.flash, type:"flash" as const, at:0, where:"self" as const, hit:null, forward:0, left:0}] : [])
  const groundFx = castGround.length || strikeFlashes.length || finishGround.length || castHazards.length || terrain || fighters.some((entity) => abilitiesGroundFx(entity.abilities)) ? compileGroundFx({ castBeam: castGround.some(e => e.type === "beam"), sweep: castGround.some(e => e.type === "beam" && e.sweep) || fighters.some(e => e.abilities?.some(a => a.events.some(v => v.type === "beam" && !!v.sweep))), once: castGround.some(e => "once_group" in e && e.once_group) || castHazards.some(e => !!e.once_group) || fighters.some(entity => entity.abilities?.some(a => a.events.some(e => "once_group" in e && !!e.once_group))), modId: project.mod_id, packageName, terrain, pointed, terrainMaterial, terrainInteractions, muteDust:project.entities.some(e=>e.builtin?.terrain_shatter?.particle==="none"), terrainDust:project.entities.some(e => !!e.builtin?.terrain_shatter?.particle), hiddenEffects:[...castGround, ...castHazards, ...finishGround, ...fighters.flatMap(e => allGroundFx(e.abilities))].some(fx => "effects" in fx && fx.effects.some(e => e.particles === false)), flashes: [...strikeFlashes, ...fighters.flatMap(entity => allGroundFx(entity.abilities).flatMap(fx => fx.type === "flash" ? [fx] : []))], hazards: finishGround.some(fx => fx.type === "hazard" && (fx.growth || fx.shape === "square")) || castHazards.some(h => h.growth || h.shape === "square") || fighters.some(entity => allGroundFx(entity.abilities).some(fx => fx.type === "hazard" && (fx.growth || fx.shape === "square"))), hitHeight: castGround.some(e => e.type === "shockwave" && e.hit_height !== undefined) || finishGround.some(fx => fx.type === "shockwave" && fx.hit_height !== undefined) || fighters.some(entity => allGroundFx(entity.abilities).some(fx => fx.type === "shockwave" && fx.hit_height !== undefined)), own: groundFxParticleAssets([...finishGround, ...castHazards]).length > 0 || fighters.some((entity) => groundFxParticleAssets(allGroundFx(entity.abilities)).length > 0) }, target) : null
  // Boss 能力 14: null for a project in which no creature has an ability started by a blow that disarms (its class is the only one that names the disarm): every use below
  // then adds nothing, so such a project builds byte for byte as before.
  const disarm = project.entities.some((entity) => abilitiesDisarm(entity.abilities ?? [])) ? compileDisarm({ modId: project.mod_id, packageName }, target) : null
  const things = gameplayThings(project)
  // 技能资产: the runtime every caster shares, its player's-game side and its loader's few lines; and the cast-action runtime's two hooks when an ability needs them.
  const abilityCast = castAbilities.length
    ? compileAbilityCast({ terrainInteractions, particleIndices: indices, modId: project.mod_id, packageName, abilities: castAbilities, gestures: gestureAssets.map((asset) => asset.id), sounds: Object.fromEntries(project.workspace.assets.flatMap((asset) => (asset.document.kind === "sound" ? [[asset.id, { name: asset.document.name, category: asset.document.category }]] : []))) }, target)
    : null
  // Null for a project without gameplay: every use below then adds nothing, so such a project builds byte for byte as before.
  const gameplay = gameplayAssets.length
    ? compileGameplay({
        modId: project.mod_id,
        items: things.flatMap((thing) => (thing.kind === "item" && thing.key ? [thing.key] : [])),
        blocks: things.flatMap((thing) => (thing.kind === "block" && thing.key ? [thing.key] : [])),
        creatures: things.flatMap((thing) => (thing.kind === "creature" && thing.key && thing.registry ? [{ key: thing.key, registry: thing.registry }] : [])),
        gameplays: gameplayAssets,
        ...(terrain ? { terrain: true } : {}),
        ...(effects ? { effects: true } : {}),
      }, target)
    : null
  const gameplayRecords = gameplay
    ? await Promise.all(
        gameplay.manifest.map(async (entry) => {
          const record = await readGameplay(projectDirectory, entry.id).catch(() => null)
          const checked = record?.saved?.fingerprint === fingerprint(gameplayAssets.find((asset) => asset.id === entry.id)!.document) ? record.saved : null
          return {
            ...entry,
            // Bounds and references were checked again just above. Compiling and the review are as recorded when this very version was saved; null when no record of it exists.
            checks: { in_bounds: true, references_real: true, compiled_with: checked?.check.compile?.ok ? checked.check.compile.compiler : null, review: checked ? (record?.outcome ?? null) : null, launched_in_game: false },
          }
        }),
      )
    : null
  // ---- end gameplay ----
  const files: Record<string, string | Uint8Array> = {
    ...contentFiles,
    ...entityFiles,
    ...builtinFiles(project, packageName),
    ...gestures?.files,
    ...gameplay?.files,
    ...effects?.files,
    ...books?.files,
    ...sounds?.files,
    ...sounds?.java,
    ...(radialForces ? playerForceFiles(packageName) : {}),
    ...(songs.length ? {
      [`${sourceRoot(packageName)}/entity/StudioMusic.java`]: target.version.rewriteJava(musicServer(packageName, songs.map(song => ({ id: song.id, outroTicks: Math.ceil((song.document.outro?.seconds ?? 0) * 20) })))),
      [`${sourceRoot(packageName)}/entity/StudioMusicClient.java`]: target.version.rewriteJava(musicClient(packageName, songs)),
    } : {}),
    ...(!facade && (songs.length || radialForces) ? target.loader.platformFiles({ modId: project.mod_id, packageName, version: target.version }) : {}),
    ...hitboxParts?.files,
    ...(project.entities.some(entity => entity.hitbox?.core.solid) ? { [`${sourceRoot(packageName)}/entity/StudioSolidBody.java`]: target.version.rewriteJava(solidBodyFile(packageName, true)) } : {}),
    ...bossRuntime?.files,
    ...cinematic?.files,
    ...emit?.files,
    ...(grouped ? onceJava(packageName) : {}),
    ...ranged?.files,
    ...nativeShots?.files,
    ...abilityWarn?.files,
    ...abilityWarn?.textures,
    ...particles?.files,
    ...trails?.files,
    ...bossBars?.files,
    ...projectiles?.files,
    ...groundFx?.files,
    ...bossWeather?.files,
    ...bossLook?.files,
    ...arena?.files,
    ...lookGlowFiles,
    ...lookTextureFiles,
    ...disarm?.files,
    ...bossShow?.files,
    ...showGlowFiles,
    ...abilityCast?.files,
    ...(facade
      ? project.entities.length === 1
        ? {}
        : platformEntrypoints(packageName, entityClasses, clientClasses)
      : {
          ...(project.entities.length === 1 ? {} : { [`${sourceRoot(packageName)}/StudioContent.java`]: mainEntrypoint(packageName, entityClasses) }),
          ...(project.entities.length === 0 ? {} : project.entities.length === 1 ? {} : { [`${sourceRoot(packageName)}/client/StudioClient.java`]: clientEntrypoint(packageName, clientClasses) }),
        }),
    // A facade target: the facade itself and the mod's main class, which replaces the template's.
    ...(facade ? target.loader.platformFiles({ modId: project.mod_id, packageName, version: target.version }) : {}),
    ...(() => {
      const main = facade ? target.loader.mainClass({ modId: project.mod_id, packageName, version: target.version, className: modClassName(project.mod_id) }) : null
      return main ? { [main.file]: main.source } : {}
    })(),
  }
  // Boss runtime on a facade target: the shake's channel is made by the common entry and its receiver set up by the client entry.
  if (facade && bossRuntime) addEntryCalls(files, packageName, bossRuntime.entries)
  if (facade && cinematic) addEntryCalls(files, packageName, cinematic.entries)
  // A 组 on a facade target: the effects' entity type, the warning's channel and the particles' types are registered by the common entry, their renderer, receiver and providers set up by the client entry.
  for (const wired of [effects, abilityWarn, particles, emit]) if (facade && wired) addEntryCalls(files, packageName, wired.entries)
  // 书 on a facade target: the books' items and hooks are made by the common entry, the screen's opener set by the client entry.
  if (facade && books) addEntryCalls(files, packageName, books.entries)
  // Boss 能力 2 on a facade target: the thrown things' entity type is registered by the common entry, their renderer by the client entry.
  if (facade && projectiles) addEntryCalls(files, packageName, projectiles.entries)
  // 第 4 步 on a facade target: the ground effects' entity type is registered by the common entry, their renderer by the client entry.
  if (facade && groundFx) addEntryCalls(files, packageName, groundFx.entries)
  // K1 on a facade target: the parts' type is registered by the common entry and drawn (as nothing) from the client entry.
  if (facade && hitboxParts) addEntryCalls(files, packageName, hitboxParts.entries)
  // A boss's own bar on a facade target: its packet's channel is made by the common entry, and its receiver, its hook into the boss bars and its reload by the client entry.
  if (facade && bossBars) addEntryCalls(files, packageName, bossBars.entries)
  // Boss 能力 7 on a facade target: the darkness's channel and the weather's tick are made by the common entry, its receiver by the client entry.
  if (radialForces) addEntryCalls(files, packageName, { common: [`${packageName}.entity.StudioPlayerForce`], client: [`${packageName}.entity.StudioPlayerForceClient`] })
  if (songs.length) addEntryCalls(files, packageName, { common: [`${packageName}.entity.StudioMusic`], client: [`${packageName}.entity.StudioMusicClient`] })
  if (facade && bossWeather) addEntryCalls(files, packageName, bossWeather.entries)
  // Boss 能力 10 on a facade target: the dropped parts' type is registered by the common entry and drawn from the client entry.
  if (facade && bossLook) addEntryCalls(files, packageName, bossLook.entries)
  // Boss 能力 12、13 on a facade target: the fixtures' type, the fog's channel and the arena's tick are made by the common entry, the fog's receiver and the fixtures' renderer by the client entry.
  if (facade && arena) addEntryCalls(files, packageName, arena.entries)
  // Boss 能力 14 on a facade target: the disarm's attack and join hooks are set up by the common entry.
  if (facade && disarm) addEntryCalls(files, packageName, disarm.entries)
  // Gameplay on a facade target (D 组): the boot classes are run by the common and the client entry, after what those register themselves is set up to be registered.
  if (facade && gameplay) addEntryCalls(files, packageName, gameplay.entries)
  // Cast actions on a facade target (D 组): their packets are made by the common entry, their keys and animation layer set up by the client entry.
  if (facade && gestures) addEntryCalls(files, packageName, gestures.entries)
  // 技能资产 on a facade target: its packets and hooks are made by the common entry, its receivers by the client entry (its HUD and tooltips are found by their annotations).
  if (facade && abilityCast) addEntryCalls(files, packageName, abilityCast.entries)
  // 技能资产: the cast-action runtime plays an ability's action and asks before a bound key plays.
  const gestureHooks = { show: castAbilities.some((asset) => asset.document.gesture !== undefined), keys: castAbilities.some((asset) => asset.document.bindings.some((binding) => binding.type === "gesture")) }
  if (gestures && (gestureHooks.show || gestureHooks.keys)) patchGestureRuntime(files, packageName, facade, gestureHooks)
  // Only a mod with an English name or description of its own gets these: Mod Menu shows them in place of fabric.mod.json's, per language. Mod Menu is Fabric's.
  const modWords = (locale: "zh_cn" | "en_us") => facade ? {} : ({
    ...(project.name_en ? { [`modmenu.nameTranslation.${project.mod_id}`]: locale === "zh_cn" ? project.name : project.name_en } : {}),
    ...(project.description_en && project.description.trim() ? { [`modmenu.descriptionTranslation.${project.mod_id}`]: locale === "zh_cn" ? project.description : project.description_en } : {}),
  })
  ;(["zh_cn", "en_us"] as const).forEach(locale => {
    const name = `src/main/resources/assets/${project.mod_id}/lang/${locale}.json`
    files[name] = JSON.stringify(Object.assign({}, JSON.parse(String(contentFiles[name] ?? "{}")), ...compiledEntities.map(entity => JSON.parse(String(entity.files[name] ?? "{}"))), gestures?.language[locale], gameplay?.language[locale], effects?.language[locale], books?.language[locale], sounds?.language[locale], hitboxParts?.language[locale], bossBars?.language[locale], bossLook?.language[locale], projectiles?.language[locale], groundFx?.language[locale], disarm?.language[locale], arena?.language[locale], abilityCast?.language[locale], modWords(locale)), null, 2)
  })
  // 补字 (E19): the characters the target's fonts cannot draw, drawn into the mod from an installed OFL font. A project without any, or with
  // `release.glyphs: "off"`, or on a computer with no font that has them, gets no new file: its build is what it was.
  const glyphsOff = project.release?.glyphs === "off"
  const glyphTarget = options.target ?? project.target
  const wanted = glyphsOff ? [] : missingInLang(fontVersion(glyphTarget), Object.fromEntries((["zh_cn", "en_us"] as const).map((locale) => [locale, JSON.parse(String(files[`src/main/resources/assets/${project.mod_id}/lang/${locale}.json`])) as Record<string, string>])))
  // A font that cannot be read or drawn is never the mod's fault: the build goes on without glyphs and says the characters as missing.
  const glyphs = wanted.length ? await fillGlyphs(wanted, project.mod_id, project.release?.glyphs === "serif" ? "serif" : "sans", options.glyphFonts).catch(() => null) : null
  Object.assign(files, glyphs?.files ?? {})
  // A name the app passes that cannot be printed on one line is left out, as if none was given: a build never fails over it.
  const author = project.release?.author ?? ReleaseAuthorSchema.safeParse(options.author).data
  const contact = releaseContact(project.release)
  // Only a project that states its release gets an icon, so one saved before builds the files it always did:
  // the first item's picture, else the first block's, among those that are the game's 16 pixels a side.
  // A picture the person gave comes first (and needs no release); it is checked again here, since a project file can be edited by hand.
  const chosen = iconBytes(project.icon)
  const given = chosen ? givenIcon(chosen) : null
  // A facade target names it in its mods.toml (`logoFile`, below), the same picture at the same place in the jar.
  const icon = given?.ok
    ? given.png
    : project.release
    ? [...project.items.map((item) => `textures/item/${item.identifier}.png`), ...project.blocks.map((block) => `textures/block/${block.identifier}.png`)].reduce<Uint8Array | null>((found, name) => {
        const picture = contentFiles[`src/main/resources/assets/${project.mod_id}/${name}`]
        return found ?? (picture instanceof Uint8Array ? modIcon(picture) : null)
      }, null)
    : null
  if (icon) files[`src/main/resources/assets/${project.mod_id}/${MOD_ICON.file}`] = icon
  // A facade target is scaffolded by its toolchain from its own template; what the source records as its profile is its manifest.
  const toolchain = facade ? toolchainFor(target.manifest) : null
  const scaffold = toolchain
    ? await toolchain
        .scaffold({
          templateDirectory: path.join(path.dirname(templateDirectory), toolchain.template),
          directory: sourceDirectory,
          modId: project.mod_id,
          packageName,
          name: project.name,
          description: project.description,
          version: modVersion(project),
          ...(author ? { author } : {}),
          ...(project.release?.license ? { license: project.release.license } : {}),
        })
        .then(() => ({ profile: target.manifest }))
    : await scaffoldProject({
    templateDirectory,
    directory: sourceDirectory,
    modId: project.mod_id,
    packageName,
    name: project.name,
    description: project.description,
    profileId: project.target,
    version: modVersion(project),
    ...(author ? { author } : {}),
    ...(project.release?.license ? { license: project.release.license } : {}),
    ...(contact ? { contact } : {}),
    ...(icon ? { icon: `assets/${project.mod_id}/${MOD_ICON.file}` } : {}),
  })
  const metadataPath = await storagePath(sourceDirectory, target.loader.modFile.split("/"))
  // A facade target's icon and release links go into its mods.toml, as Fabric's scaffold puts them into fabric.mod.json.
  if (facade && (icon || contact)) {
    const homepage = contact?.homepage ?? contact?.sources
    await writeFile(metadataPath, modTomlExtras(await readFile(metadataPath, "utf8"), { ...(icon ? { icon: `assets/${project.mod_id}/${MOD_ICON.file}` } : {}), ...(homepage ? { homepage } : {}), ...(contact?.issues ? { issues: contact.issues } : {}) }))
  }
  // Fabric's entry points are named in fabric.mod.json; a facade target's main class (written below) is found by its @Mod.
  if (!facade) {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"))
    // A creature's client class draws it; a block with a shape needs its own, to be drawn with holes where its picture is empty.
    const clientEntries = [...(project.entities.length > 0 ? [`${packageName}.client.StudioClient`] : []), ...(project.blocks.some((block) => block.shape) ? [`${packageName}.client.${BLOCK_CLIENT_CLASS}`] : [])]
    const entrypoints = {
      main: [`${packageName}.StudioContent`],
      ...(clientEntries.length > 0 ? { client: clientEntries } : {}),
    }
    await writeFile(
      metadataPath,
      `${JSON.stringify({ ...metadata, entrypoints }, null, 2)}\n`,
    )
  }
  await Promise.all(
    Object.entries(gestures?.patch ?? {}).map(async ([name, edit]) => {
      const target = await storagePath(sourceDirectory, name.split("/"))
      await writeFile(target, edit(await readFile(target, "utf8")))
    }),
  )
  // After the cast actions' edits, one file at a time: both add to the same entry-point list.
  await Object.entries(gameplay?.patch ?? {}).reduce(async (before, [name, edit]) => {
    await before
    const target = await storagePath(sourceDirectory, name.split("/"))
    await writeFile(target, edit(await readFile(target, "utf8")))
  }, Promise.resolve())
  // 书: and the two classes that register the books and open them (Fabric; a facade target edits nothing).
  await Object.entries(books?.patch ?? {}).reduce(async (before, [name, edit]) => {
    await before
    const target = await storagePath(sourceDirectory, name.split("/"))
    await writeFile(target, edit(await readFile(target, "utf8")))
  }, Promise.resolve())
  // H3: and after those, the two classes that register and draw the effects.
  await Object.entries(effects?.patch ?? {}).reduce(async (before, [name, edit]) => {
    await before
    const target = await storagePath(sourceDirectory, name.split("/"))
    await writeFile(target, edit(await readFile(target, "utf8")))
  }, Promise.resolve())
  // K1: and after those, the class that registers the parts and the one that lets a player's game hold them.
  await Object.entries(hitboxParts?.patch ?? {}).reduce(async (before, [name, edit]) => {
    await before
    const target = await storagePath(sourceDirectory, name.split("/"))
    await writeFile(target, edit(await readFile(target, "utf8")))
  }, Promise.resolve())
  // Boss runtime (10-12): and after those, the entry points and the mixin list that make the game load the screen shake.
  for (const patch of [bossRuntime?.patch, cinematic?.patch, ranged?.patch, nativeShots?.patch]) {
    await Object.entries(patch ?? {}).reduce(async (before, [name, edit]) => {
      await before
      const target = await storagePath(sourceDirectory, name.split("/"))
      await writeFile(target, edit(await readFile(target, "utf8")))
    }, Promise.resolve())
  }
  // Boss 能力 10: and after those, the entry points that register the parts that come off a boss and draw them (Fabric; a facade target edits nothing).
  await Object.entries(bossLook?.patch ?? {}).reduce(async (before, [name, edit]) => {
    await before
    const target = await storagePath(sourceDirectory, name.split("/"))
    await writeFile(target, edit(await readFile(target, "utf8")))
  }, Promise.resolve())
  // Boss 能力 3: and after those, the entry points that register the warning's packet and draw it.
  for (const [name, edit] of Object.entries(emit?.patch ?? {})) {
    const path = await storagePath(sourceDirectory, name.split("/"))
    await writeFile(path, edit(await readFile(path, "utf8")))
  }
  await Object.entries(abilityWarn?.patch ?? {}).reduce(async (before, [name, edit]) => {
    await before
    const target = await storagePath(sourceDirectory, name.split("/"))
    await writeFile(target, edit(await readFile(target, "utf8")))
  }, Promise.resolve())
  // Boss 能力 6: and the entry points that register a boss's own bar's packet and draw it, and its mixin into the game's boss bars (Fabric; a facade target edits nothing).
  await Object.entries(bossBars?.patch ?? {}).reduce(async (before, [name, edit]) => {
    await before
    const target = await storagePath(sourceDirectory, name.split("/"))
    await writeFile(target, edit(await readFile(target, "utf8")))
  }, Promise.resolve())
  // A 组 (Boss 能力 11): and after those, Fabric's entry points that register the particles of the project's own and give them their providers.
  await Object.entries(particles?.patch ?? {}).reduce(async (before, [name, edit]) => {
    await before
    const target = await storagePath(sourceDirectory, name.split("/"))
    await writeFile(target, edit(await readFile(target, "utf8")))
  }, Promise.resolve())
  // Boss 能力 2: and after those, Fabric's entry points that register the thrown things' entity type and draw them.
  await Object.entries(projectiles?.patch ?? {}).reduce(async (before, [name, edit]) => {
    await before
    const target = await storagePath(sourceDirectory, name.split("/"))
    await writeFile(target, edit(await readFile(target, "utf8")))
  }, Promise.resolve())
  // 第 4 步: and, on Fabric, the entry points that register the ground effects' entity type and draw them.
  await Object.entries(groundFx?.patch ?? {}).reduce(async (before, [name, edit]) => {
    await before
    const target = await storagePath(sourceDirectory, name.split("/"))
    await writeFile(target, edit(await readFile(target, "utf8")))
  }, Promise.resolve())
  // Boss 能力 12、13: and the arena's mixins in the template's list (every target) and, on Fabric, its entry points.
  await Object.entries(arena?.patch ?? {}).reduce(async (before, [name, edit]) => {
    await before
    const target = await storagePath(sourceDirectory, name.split("/"))
    await writeFile(target, edit(await readFile(target, "utf8")))
  }, Promise.resolve())
  // Boss 能力 7: and the weather's mixins in the template's list (every target) and, on Fabric, its two entry points.
  await Object.entries(bossWeather?.patch ?? {}).reduce(async (before, [name, edit]) => {
    await before
    const target = await storagePath(sourceDirectory, name.split("/"))
    await writeFile(target, edit(await readFile(target, "utf8")))
  }, Promise.resolve())
  // Boss 能力 14: and, on Fabric, the disarm's entry point.
  await Object.entries(disarm?.patch ?? {}).reduce(async (before, [name, edit]) => {
    await before
    const target = await storagePath(sourceDirectory, name.split("/"))
    await writeFile(target, edit(await readFile(target, "utf8")))
  }, Promise.resolve())
  // 技能资产: and, on Fabric, the abilities' two entry points.
  await Object.entries(abilityCast?.patch ?? {}).reduce(async (before, [name, edit]) => {
    await before
    const target = await storagePath(sourceDirectory, name.split("/"))
    await writeFile(target, edit(await readFile(target, "utf8")))
  }, Promise.resolve())
  await Promise.all(
    Object.entries(files).map(async ([name, contents]) => {
      const target = await storagePath(sourceDirectory, name.split("/"), true)
      // Replace only scaffold placeholders inside this fresh, exclusively created snapshot.
      await writeFile(target, contents)
    }),
  )
  // Every class the game creates by name can be created: read off the files just written, before any compiler runs.
  // (Fabric's: a facade target's only created class is the main class it writes itself.)
  if (!facade)
    await assertCreatable(
      [...entrypointClasses(await readFile(metadataPath, "utf8")), ...(gameplay?.created ?? []).map((created) => ({ ...created, by: "boot" as const }))],
      async (file) => readFile(await storagePath(sourceDirectory, file.split("/")), "utf8").catch(() => null),
    )
  const backup = path.join(sourceDirectory, "project-backup")
  await mkdir(backup)
  await writeFile(await storagePath(backup, ["minemods.project.json"]), `${JSON.stringify(project, null, 2)}\n`, {
    flag: "wx",
  })
  await Promise.all(
    project.assets.map(async (reference) => {
      const segments = [".minemods", "assets", reference.id, `${reference.revision}.json`]
      await copyFile(await storagePath(projectDirectory, segments), await storagePath(backup, segments, true))
    }),
  )
  const entityIds = compiledEntities.map((entry) => entry.entityId)
  const assetOrigins = compiledEntities.map((entry) => entry.asset.origin)
  const entityRevisions = compiledEntities.map((entry) => entry.entityWorkspaceAsset?.revision ?? null)
  const textureAssetIds = compiledEntities.map((entry) => entry.textureAsset?.id ?? null)
  const textureRevisions = compiledEntities.map((entry) => entry.textureAsset?.revision ?? null)
  await writeFile(
    await storagePath(sourceDirectory, ["minemods-build.json"]),
    `${JSON.stringify({ schema_version: 1, project_id: project.id, revision: project.revision, profile: scaffold.profile, ...(facade ? { target: target.manifest.id } : {}), asset_origins: assetOrigins, asset_ids: compiledEntities.map((entry) => entry.asset.id), asset_revisions: compiledEntities.map((entry) => entry.asset.revision), entity_revisions: entityRevisions, texture_asset_ids: textureAssetIds, texture_revisions: textureRevisions, provenances: compiledEntities.map((entry) => entry.data.provenance ?? null), workspace_assets: builtWorkspaceAssets(project), ...(gestures ? { gesture_runtime: gestures.manifest, gestures: gestures.gestures } : {}), ...(gameplayRecords ? { gameplay: gameplayRecords } : {}), ...(effects ? { effects: effects.manifest } : {}) }, null, 2)}\n`,
    { flag: "wx" },
  )
  await writeFile(
    await storagePath(sourceDirectory, ["README-STUDIO.md"]),
    [
      `# ${project.name}`,
      "",
      `Source snapshot for project ${project.id}, revision ${project.revision}.`,
      `Asset origins: ${assetOrigins.length ? assetOrigins.join(", ") : "none"}. This label distinguishes examples/manual assets from GPT-6 generation.`,
      "",
      ...("loom" in scaffold.profile
        ? [
            `Requires Java ${scaffold.profile.java.major}, Minecraft ${scaffold.profile.minecraft}, Fabric Loader ${scaffold.profile.loader}, Fabric API ${scaffold.profile.fabricApi}, GeckoLib ${scaffold.profile.geckolib.version}.`,
            `Gradle ${scaffold.profile.gradle.version} and Loom ${scaffold.profile.loom} are pinned in the source; the code uses the official Mojang mappings of Minecraft ${scaffold.profile.minecraft}.`,
            "",
            "Build using `gradlew.bat build` on Windows or `./gradlew build` on Unix with Java 21 selected.",
            "Use `runClient` for a development playtest. No Minecraft account sign-in or EULA acceptance is performed by Studio.",
            "For an ordinary Minecraft installation, install the matching Fabric Loader and place the mod JAR, Fabric API and GeckoLib JARs in its mods directory.",
          ]
        : ((manifest: typeof scaffold.profile) => {
            const loader = manifest.loader.kind === "forge" ? "Forge" : "NeoForge"
            return [
              `Requires Java ${manifest.java.major}, Minecraft ${manifest.minecraft.version}, ${loader} ${manifest.loader.version}, GeckoLib ${manifest.dependencies.geckolib.version}.`,
              `Gradle ${manifest.toolchain.gradle.version} and ModDevGradle ${manifest.toolchain.plugin} are pinned in the source.`,
              "",
              `Build using \`gradlew.bat build\` on Windows or \`./gradlew build\` on Unix; Gradle is given Java ${[manifest.java.major, ...manifest.java.alsoForBuild].join(" and ")}.`,
              "Use `runClient` or `runServer` for a development playtest. No Minecraft account sign-in or EULA acceptance is performed by Studio.",
              `For an ordinary Minecraft installation, install ${loader} ${manifest.loader.version} and place the mod JAR and the GeckoLib JAR in its mods directory.`,
            ]
          })(scaffold.profile)),
      ...(entityIds.length ? [`In a creative test world, find the spawn eggs or use /summon ${entityIds.map((entityId) => `${project.mod_id}:${entityId}`).join(" or ")}.`] : []),
      ...(gestures
        ? [
            `Cast actions (runtime ${gestures.manifest.version}, data format ${gestures.manifest.data_format}): press ${gestures.gestures.map((gesture) => gesture.key.toUpperCase()).join(" or ")} in the game; the keys can be changed under Controls. In first person the player sees their own arms do the action.`,
            `playerAnimator ${gestures.manifest.player_animator.version} (MIT) is bundled inside the mod JAR; its licence text is at META-INF/licenses/playerAnimator-LICENSE.txt. Players install nothing extra for cast actions.`,
          ]
        : []),
      ...(glyphs?.filled.length
        ? [`Characters Minecraft's fonts do not have (${glyphs.filled.map((entry) => entry.char).join(" ")}) are drawn into ${glyphPaths(project.mod_id).picture} from ${[...new Set(glyphs.filled.map((entry) => entry.family))].join(", ")} under the SIL Open Font License 1.1 (${glyphPaths(project.mod_id).license}).`]
        : []),
      ...(gameplayRecords
        ? [
            `Gameplay (code written by an AI, ${gameplayRecords.length} unit${gameplayRecords.length === 1 ? "" : "s"}): ${gameplayRecords.map((entry) => `${entry.title} (${entry.package})`).join("; ")}.`,
            "This code was checked by reading and compiling it. Nobody, neither Studio nor the AI, has launched the game to try it: play-test it yourself. `minemods-build.json` lists every file with its hash and what was checked.",
          ]
        : []),
      "",
      "Open `project-backup` in Studio to continue editing the saved project and model assets.",
      "This source export is reconstructable source; it does not assert that a build or game session succeeded.",
      "",
    ].join("\n"),
    { flag: "wx" },
  )
  // Paths inside the built jar that prove the cast-action runtime and its data went in.
  const gestureFiles = gestures
    ? [gestures.loaderClass, `data/${project.mod_id}/studio/gestures.json`, "META-INF/licenses/playerAnimator-LICENSE.txt"]
    : []
  // ---- machine reconciliation and the mod guide: computed from what was just generated, written nowhere in the source ----
  const animations = Object.fromEntries(compiledEntities.map((entry) => [entry.entity.id, Object.keys(entry.look.animation.animations).map((name) => name.split(".").at(-1)!)]))
  const lang = (locale: "zh_cn" | "en_us") => JSON.parse(String(files[`src/main/resources/assets/${project.mod_id}/lang/${locale}.json`])) as Record<string, string>
  const findings = reconcile(project, {
    animations,
    models: Object.fromEntries(compiledEntities.map((entry) => [entry.entity.id, entry.data.design])),
    // A unit is checked when a compile of exactly this version is on record.
    gameplay: (gameplayRecords ?? []).map((entry) => ({ id: entry.id, title: entry.title, checked: entry.checks.compiled_with !== null })),
    built: { lang: { zh_cn: lang("zh_cn"), en_us: lang("en_us") }, files: Object.keys(files), glyphs: { filled: glyphs?.filled ?? [], off: glyphsOff, target: glyphTarget } },
  })
  // The epic tier's 必须 (spec: 史诗档) are reconciled as findings that stop; nothing else in the build would notice them, as a compile notices a missing motion, so they stop it here.
  for (const size of audio?.large ?? []) findings.push({ rule: "music_size", stops: false, about: null, refs: [assetRef(size.id, size.title)], text: size.text + "，超过单曲 8 MiB 的体积提醒线。", fix: "可以降低 OGG 的码率或缩短循环段，再从音乐页替换文件。" })
  findings.unshift(...unmodelled.map((entity) => ({
    rule: "skipped_creature" as const,
    stops: false,
    about: { kind: "entity" as const, id: entity.id, name: entity.name },
    refs: [assetRef(entity.id, entity.name)],
    text: `「${entity.name}」还没有模型，这次没有打进模组。`,
    fix: "打开这只生物的外观页，导入或制作一个模型后再打包。",
  })), ...modelOnly.map((entity) => ({
    rule: "model_only" as const,
    stops: false,
    about: { kind: "entity" as const, id: entity.id, name: entity.name },
    refs: [assetRef(entity.id, entity.name)],
    text: `「${entity.name}」只有模型，没有生物文档，这次没有打进模组（不注册成生物，也没有刷怪蛋）。`,
    fix: "要让它成为能刷出来的生物，先写用这个模型的生物文档（生物任务），再打包。",
  })))
  const tierStops = findings.filter((finding) => finding.stops && finding.rule.startsWith("tier_"))
  if (tierStops.length) throw new BuildStop(tierStops[0]!.rule, tierStops)
  const guide = modGuide(skipped.length ? { ...stored, entities, logic, workspace: project.workspace } : stored, { findings, animations, poses: Object.fromEntries(compiledEntities.map((entry) => [entry.entity.id, guidePose(entry.data.design)])), glowing: compiledEntities.filter((entry) => entry.look.glow).map((entry) => entry.entity.id), built: true })
  // Where the jar must hold each glow picture (build.ts looks for exactly these): the layer finds none anywhere else, and a missing one fails without a word.
  const glowMasks = [
    ...compiledEntities.filter((entry) => entry.look.glow).map((entry) => glowMaskPath(`assets/${project.mod_id}/textures/entity/${entry.entityId}.png`)),
    ...(effects?.glowMasks ?? []),
    // The textures the bosses' phases put on, and the glow masks beside them: a texture missing from the jar would draw the creature as the game's missing texture.
    ...Object.keys(lookTextureFiles).map((name) => name.replace("src/main/resources/", "")),
  ]
  // For generator work only: with MINEMODS_CAPTURE_DIR set, a copy of the generated source is kept there, so a whole test run's output can be compared with a reference.
  if (process.env.MINEMODS_CAPTURE_DIR) await cp(path.join(sourceDirectory, "src"), path.join(process.env.MINEMODS_CAPTURE_DIR, `${Date.now()}-${randomUUID().slice(0, 8)}`, "src"), { recursive: true })
  return { project, packageName, target, entityIds, entityClasses, clientClasses, gestureFiles, gameplayFiles: gameplay?.classes ?? [], effectFiles: effects?.classes ?? [], bookFiles: books ? [...books.classes, ...Object.keys(books.files).filter((name) => name.endsWith(".png")).map((name) => name.replace("src/main/resources/", ""))] : [], soundFiles: sounds ? [`${packageName.replaceAll(".", "/")}/StudioSounds.class`, ...Object.keys(sounds.files).map((name) => name.replace("src/main/resources/", ""))] : [], glowMasks, hitboxFiles: hitboxParts?.classes ?? [], bossFiles: [...(songs.length ? ["StudioMusic", "StudioMusicClient"].map(name => `${packageName.replaceAll(".", "/")}/entity/${name}.class`) : []), ...(bossRuntime?.classes ?? []), ...(cinematic?.classes ?? []), ...(bossLook?.classes ?? []), ...(bossShow?.classes ?? [])], warnFiles: abilityWarn?.classes ?? [], bossBarFiles: bossBars?.classes ?? [], weatherFiles: bossWeather?.classes ?? [], arenaFiles: arena?.classes ?? [], projectileFiles: projectiles?.classes ?? [], groundFxFiles: groundFx?.classes ?? [], abilityFiles: [...(radialForces ? ["StudioPlayerForce", "StudioPlayerForceClient"].map(name => `${packageName.replaceAll(".", "/")}/entity/${name}.class`) : []), ...(abilityCast?.classes ?? []), ...(emit?.classes ?? [])], glyphFiles: glyphs?.filled.length ? Object.values(glyphPaths(project.mod_id)) : [], gameplay: gameplayRecords ?? [], findings, guide, looks: compiledEntities.map((entry) => entry.look) }
}

function sourceRoot(packageName: string) {
  return `src/main/java/${packageName.replaceAll(".", "/")}`
}

