import { rangedSound } from "../sound-range"
import { z } from "zod"
import { groundFxStarts } from "../common/ground-fx"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { clipPace, PACE } from "@minemods/studio-ai/motion-continuity"
import { compileModel } from "../model"
import { LogicSchema } from "../content"
import { CREATURE_LIFE_FIELDS, CREATURE_LIFE_LIMITS, CreatureSoundsSchema, ENGAGEMENT_LIMITS, EntityRuntimeSchema, SPAWN_TIMES, SPAWN_WEATHERS, type CreatureLoot, type StructureRef } from "../entity-runtime"
import { GAMEPLAY_API } from "../gameplay"
import { EnglishNameSchema } from "../data-words"
import { SOUND_CATEGORIES, SoundNameSchema, isSoundAsset, type SoundCategory, type SoundRef } from "../sound"
import { soundJava, soundSourceJava } from "./sound"
import { builtinParticle, builtinSound } from "../common/builtin"
import { feedbackOwner } from "../hit-feedback"
import { resolveAliases } from "../particle-emission"
import { emitArguments } from "../common/emit"
import { abilityClipAt, bonePlace } from "../creature-abilities"
import { compileEntityLogic } from "./logic"
import { resolveSteady } from "../creature-steady"
import { steadyControls, steadyFocus } from "./entity-steady"
import { stanceClips, stanceDocumentIssues } from "../stances"
import { compileStances } from "./entity-stances"
import { compileAbilities } from "./entity-abilities"
import { abilityVersionGaps, trailRenderer } from "./entity-abilities"
import { layeredAbilities, movementBlendTicks, posePlan, poseRenderer } from "./entity-pose"
import { BuildStop } from "../build-stop"
import { abilityIssues, diveReach, hitAnchors } from "../creature-abilities"
import { abilitiesTrail, trailTip } from "../ability-trails"
import { bossModelIssues, bossPlan } from "../creature-boss"
import { bossBarAsset } from "../boss-bar"
import { BOSS_ARRIVED, BOSS_LOOK_TRACKER, BOSS_TRACKER, bossLookSource, compileBoss } from "./entity-boss"
import { bossArena } from "../arena"
import { bossLookPlan } from "../boss-look-words"
import { bossDropPlaces, bossGlowFile, bossLookIssues, bossTextureFile } from "../boss-look"
import { BOSS_LOOK_RUNTIME } from "./boss-look"
import { bossShowGlowFile, bossShowSource } from "./boss-show"
import { bossShowDropPlaces, bossShowIssues } from "../boss-show-model"
import { creatureVanillaGaps } from "../version-lacks"
import { FLIGHT_LIMITS } from "../flight-words"
import { FLIGHT_TRACKER, compileFlight, groundWander } from "./entity-flight"
import { HABITS_TRACKER, compileHabits } from "./entity-habits"
import { LAIR_CLASS, lairClass, lairData } from "./lair"
import { SUMMON_CLASS, summonCall, summonClass } from "./summon"
import { airReach, flightFight, flightModelIssues, flightPlan, habitsPlan } from "../creature-flight"
import { collisionParts as bodyParts } from "../entity-runtime"
import { hitboxSource, stuckSource } from "./hitbox"
import { hitboxFollow } from "../hitbox-follow"
import { hitboxCombatIssues } from "../hitbox-combat"
import { usesCombat, staggerList, combatIssues as windowIssues } from "../combat"
import { hasHitboxCombat } from "../hitbox-combat"
import { hitboxCombatSource } from "./hitbox-combat"
import { flierSpan, sightOf } from "../model-reach"
import { decodeRgbaPng } from "../png-decode"
import type { GenTarget } from "../platform/adapter"
import { platformCreature } from "../platform/creature"
import { creatureName } from "../registry-name"
import { assertPorted } from "../platform/ported"
import { FABRIC_TARGET } from "../platform/target"
import { throwerParts } from "../common/projectiles"

const Input = z.strictObject({
  terrainInteractions:z.boolean().optional(),
  modId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  name: z.string().min(1).max(120),
  /** Shown by an English-language game; without it the Chinese name is, as before. */
  name_en: EnglishNameSchema.nullable().optional(),
  health: z.number().finite().positive().max(1024),
  speed: z.number().finite().min(0).max(2),
  attack_damage: z.number().finite().min(0).max(1024),
  behavior: z.enum(["passive", "follow", "hostile"]),
  model: ModelDesignSchema,
  logic: z.array(LogicSchema).default([]),
  runtime: EntityRuntimeSchema.optional(),
  sounds: CreatureSoundsSchema.nullable().optional(),
  /** 任务二 §9: the project's own sounds its `sounds` and abilities play, by asset id (`fabric/sound.ts`). */
  particleIndices: z.record(z.string(), z.number().int().nonnegative()).optional(),
  sharedBuiltin: z.object({particle:z.array(z.string()),sound:z.array(z.string())}).optional(),
  customSounds: z.record(z.uuid(), z.strictObject({ name: SoundNameSchema, category: z.enum(Object.keys(SOUND_CATEGORIES) as [SoundCategory, ...SoundCategory[]]).nullable() })).default({}),
  /** The model's texture has a glow picture beside it (`<id>_glowmask.png`), so the renderer draws those texels at full brightness. */
  glow: z.boolean().default(false),
  /** The picture the creature wears in the game when it is not the model's own painted one: its spawn egg takes its colours from what is seen. */
  texture: z.instanceof(Uint8Array).optional(),
  animationNames: z
    .array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/))
    .max(256)
    .default([]),
  classSuffix: z.union([z.literal(""), z.string().regex(/^[A-Z][A-Za-z0-9_]{0,63}$/)]).default(""),
  ...CREATURE_LIFE_FIELDS,
  /** The project has gameplay code: the creature takes on the goals that code registered for its kind. */
  gameplayGoals: z.boolean().default(false),
  /** That gameplay code registered a rule about whom this kind of creature may fight (`ProjectContent.targetRule`). */
  targetRules: z.boolean().default(false),
  /** r29: the creatures of the project put in this boss's lair as it is made (`runtime.garrison`), by registry id. Absent: none, and its lair is generated as before. */
  lairGuards: z.array(z.strictObject({ creature: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), min: z.number().int().min(1).max(8), max: z.number().int().min(1).max(8) })).optional(),
  /** r29: some lair of the project holds guards, so the one lair class every lair of the mod shares reads them (`lairClass`). Absent: the class as before. */
  lairGuarded: z.boolean().optional(),
})

/** The game's name of a structure a creature keeps to: as written, or a boss's lair (`{ lair }` names a boss without an `identifier` by the id its registry name is made of, `creature_<hex>`; the build writes the lair of one with an `identifier` by its name). */
export const structureName = (modId: string, ref: StructureRef) => (typeof ref === "string" ? ref : `${modId}:${creatureName({ id: ref.lair })}_lair`)

/**
 * A spawn egg's two colours (shell, spots) from the creature's own picture.
 * - `fallback`: the pair every generated egg had; kept for a picture with fewer than two colours that differ.
 * - `apart`: how far two colours must be from each other (distance in RGB, each channel 0 to 255) to count as two.
 *   The model painter lights and shades one colour by mixing it at most 12% towards white or black (the default
 *   of `lit` in studio-ai's script.ts): at most 0.12 × 255 on each channel, 0.12 × 255 × √3 ≈ 53 in all. Two colours
 *   further apart than that are not one material's lit and shaded sides.
 */
export const EGG_COLORS = { fallback: [0x6b7960, 0xd8b484], apart: 53 } as const

/** The most used fully opaque colour, and the most used one that is visibly another (`EGG_COLORS.apart`). The first met wins a tie. */
export function eggColors(png: Uint8Array): readonly [number, number] {
  const image = (() => {
    try {
      return decodeRgbaPng(png)
    } catch {
      return null
    }
  })()
  const counts = new Map<number, number>()
  for (let index = 0; image && index < image.pixels.length; index += 4) {
    if (image.pixels[index + 3] !== 255) continue
    const color = (image.pixels[index]! << 16) | (image.pixels[index + 1]! << 8) | image.pixels[index + 2]!
    counts.set(color, (counts.get(color) ?? 0) + 1)
  }
  const used = [...counts].sort((a, b) => b[1] - a[1]).map((entry) => entry[0])
  const channels = (color: number) => [color >> 16, (color >> 8) & 255, color & 255]
  const second = used.find((color) => Math.hypot(...channels(color).map((value, axis) => value - channels(used[0]!)[axis]!)) > EGG_COLORS.apart)
  return used.length && second !== undefined ? [used[0]!, second] : EGG_COLORS.fallback
}

// The goals every generated creature starts with, by priority: kept in a file without imports so the reference check can read them too.
export { BASELINE_GOALS } from "../creature-goals"

/** How long a dying creature stays before it is removed, in ticks: the length of its death motion, never less than vanilla's second. */
export const deathTicks = (seconds: number) => Math.min(CREATURE_LIFE_LIMITS.death_seconds * 20, Math.max(20, Math.ceil(seconds * 20)))

/**
 * A creature's drops as a vanilla entity loot table: one pool per line, so each line rolls by itself.
 * Counts grow with Looting the way vanilla mob drops do, except a boss's drop (its count is the trophy that was asked for) and any line written \`looting: false\`.
 */
export function creatureLootTable(modId: string, id: string, loot: readonly CreatureLoot[], boss = false) {
  return {
    type: "minecraft:entity",
    pools: loot.map((drop) => ({
      bonus_rolls: 0,
      ...(drop.player_only || drop.chance < 1
        ? { conditions: [...(drop.player_only ? [{ condition: "minecraft:killed_by_player" }] : []), ...(drop.chance < 1 ? [{ condition: "minecraft:random_chance", chance: drop.chance }] : [])] }
        : {}),
      entries: [
        {
          type: "minecraft:item",
          functions: [
            { add: false, count: drop.min === drop.max ? drop.max : { type: "minecraft:uniform", max: drop.max, min: drop.min }, function: "minecraft:set_count" },
            ...((drop.looting ?? !boss) ? [{ count: { type: "minecraft:uniform", max: 1, min: 0 }, enchantment: "minecraft:looting", function: "minecraft:enchanted_count_increase" }] : []),
          ],
          name: drop.item.includes(":") ? drop.item : `${modId}:${drop.item}`,
        },
      ],
      rolls: 1,
    })),
    random_sequence: `${modId}:entities/${id}`,
  }
}

/** The game's goal classes a creature's class may use, its own goals' and its abilities', flight's and habits': each is imported, and the ones a class does not use are left out (`tidyImports`). */
const GOAL_IMPORTS = ["Goal", "FloatGoal", "TemptGoal", "MeleeAttackGoal", "target.NearestAttackableTargetGoal", "WaterAvoidingRandomStrollGoal", "LookAtPlayerGoal", "RandomLookAroundGoal"]
  .map((name) => `import net.minecraft.world.entity.ai.goal.${name};\n`)
  .join("")

/**
 * A creature's source files. `target`: what it is generated for; Fabric 1.21.1 (the default) is this file's own text,
 * exactly as before. A facade target (Forge, NeoForge) gets the same creature class and renderer (mapped to its game
 * version), with its registration, attributes, spawn egg, spawn rule and renderer going through `StudioPlatform`
 * (`platform/creature.ts`), its natural spawn as the loader's data files, and refuses a feature group not ported to it yet.
 */
export function compileEntity(input: unknown, target: GenTarget = FABRIC_TARGET) {
  const data = resolveAliases(feedbackOwner(Input.parse(input)))
  const combatIssues = [...stanceDocumentIssues(data), ...hitboxCombatIssues(data), ...windowIssues(data)]
  for (const clip of stanceClips(data.stances))
    if (!data.model.animations.some(row => row.name === clip))
      throw new BuildStop("stance_clip", [{ text: `「${data.name}」的姿态要用「${clip}」动作，模型里找不到。`, fix: "请选择模型已有的动作。" }])
  for (const row of staggerList(data.stagger)) {
    if (row.clip && !data.model.animations.some(clip => clip.name === row.clip)) throw new Error(`找不到硬直动作 ${row.clip}，请改用模型已有动作或去掉 clip。`)
  }
  if (combatIssues.length) throw new Error(combatIssues.map((issue) => issue.message).join("；"))
  if (target.loader.facade) assertPorted({ entities: [data], blocks: [], items: [], workspace: { assets: [] } }, target)
  if (["idle", "walk", "hurt"].some((name) => !data.model.animations.some((animation) => animation.name === name)))
    throw new Error("生物模型需要待机、行走和受击三个动作。")
  const compiled = compileModel(data.model, data.id)
  // A creature that stays where it is on purpose (`stationary`) walks nowhere, whatever speed its document says (0 is as good as any): its walking speed in the game is 0.
  const walkSpeed = data.stationary ? 0 : data.speed
  const hurt = data.model.animations.find((animation) => animation.name === "hurt")!
  // A model that brings a death or an attack motion has it played; one without keeps what every mob does (tips over; hits without a motion of its own).
  const death = data.model.animations.find((animation) => animation.name === "death")
  const attack = data.model.animations.find((animation) => animation.name === "attack")
  const loot = data.loot ?? []
  // An ability that names a motion the model lacks, or runs longer than it, cannot be played as written: said in the person's words, never built.
  const unplayable = abilityIssues(data, data.model.animations, data.model).filter((issue) => issue.stops)
  if (unplayable.length) throw new BuildStop(unplayable[0]!.rule, unplayable)
  // Boss runtime (10-12): only a hostile creature is a boss; a motion its show needs that the model lacks, or an ability a phase names that is not there, is said and not built.
  // K1: its collision boxes when the document states them; without, the one square box it always had, to the digit.
  const core = data.hitbox ? { width: data.hitbox.core.width, height: data.hitbox.core.height } : compiled.bounds
  const steady = resolveSteady(data.steady, core.height)
  const boss = data.behavior === "hostile" ? (data.boss ?? null) : null
  // The height of its box is also what the air cleared over its lair has to hold.
  const unbuildable = bossModelIssues({ name: data.name, behavior: data.behavior, abilities: data.abilities, combos: data.combos, boss, runtime: data.runtime }, data.model.animations, core.height).filter((issue) => issue.stops)
  if (unbuildable.length) throw new BuildStop(unbuildable[0]!.rule, unbuildable)
  // Who it fights is decided in one place once the document says how it engages or gameplay code rules on its targets:
  // everything it does to fight then acts on getTarget() alone. Without either, the class is what it always was.
  // Flight and habits (10-12): a motion they play that the model lacks is said and not built.
  const flight = data.flight ?? null
  const habits = data.habits ?? null
  // A warning before it attacks (`habits.alert.attack_distance`) is a rule about whom it picks, so it is decided in that one place too: a creature that has one picks players that way.
  const attackDistance = data.behavior === "hostile" ? (habits?.alert?.attack_distance ?? null) : null
  const engage = data.behavior === "hostile" && (data.engagement || data.targetRules || attackDistance !== null) ? (data.engagement ?? "any_player") : null
  const unflyable = flightModelIssues({ name: data.name, flight, habits }, data.model.animations.map((animation) => ({ name: animation.name, length: animation.length }))).filter((issue) => issue.stops)
  if (unflyable.length) throw new BuildStop(unflyable[0]!.rule, unflyable)
  // The synced values of the flight and the habits are registered beside the ones the abilities and the boss register.
  // Boss 能力 2: the parts of its model a hostile creature throws, hidden in every player's game while they are out (common/projectiles.ts). None: nothing of this is written.
  const thrower = data.behavior === "hostile" ? throwerParts(`StudioCreature${data.classSuffix}`, data.id, data.abilities ?? []) : null
  const trackerLines = `${flight ? FLIGHT_TRACKER : ""}${habits ? HABITS_TRACKER : ""}${thrower?.tracker ?? ""}`
  // Only a creature that fights has anyone to use them on; without abilities every piece below is empty.
  const abilityList = data.behavior === "hostile" ? (data.abilities ?? []) : []
  const finishPath = Boolean(steady && engage && !data.stationary && abilityList.length)
  // Its combos (连招), chosen after its abilities: the boss's phase masks and its first attack count them as choices `abilityList.length` and on. None: everything below is what it was.
  const comboList = data.behavior === "hostile" && abilityList.length ? (data.combos ?? []) : []
  // An ability some of whose moments are done by gameplay code calls the accessor the gameplay's code registered its entries with.
  const abilityGameplay = abilityList.some((ability) => ability.hits.some((hit) => hit.type === "gameplay"))
  if (abilityGameplay && !data.gameplayGoals) throw new BuildStop("ability_gameplay", [{ text: `「${data.name}」有招式交给玩法的代码去做，可是这个工程里没有任何玩法。`, fix: "先让 AI 写好那个玩法，再打包；或者把那一下改成招式自己能表达的出手。" }])
  // Where a hit that names a bone counts from (measured on the model and the ability's own motion); none of this is looked at when no hit names one.
  const anchors = hitAnchors(abilityList, data.model)
  const anchored = anchors.some((row) => row.some(Boolean))
  // The server needs the lean of a flier's body when a hit counts from a bone, and when its collision boxes of parts follow its body.
  const leaning = Boolean(flight) && (anchored || Boolean(bodyParts(data.hitbox).length))
  // The boss as ticks and masks, read by the abilities too (when a boss names its first attack they tell it which ability has started).
  const stance = compileStances(data.stances, abilityList, comboList, boss, `StudioCreature${data.classSuffix}`, data.id)
  const combat = Boolean(stance) || usesCombat({ ...data, abilities: abilityList, combos: comboList })
  const bossPlanned = boss ? bossPlan(boss, [...abilityList, ...comboList], flight, combat) : null
  // Boss 能力 10: its model in each phase and the parts it drops (where each comes off, measured on the model); a bone the model lacks or a glow with no picture is said and not built. None: nothing of it is written.
  const lookPlan = boss || data.stances ? bossLookPlan(boss ?? { phases: [] }, boss ? abilityList : [], data.stances) : null
  if (lookPlan?.stances && lookPlan.bones.length > 30)
    throw new BuildStop("stance_model", [{ text: `「${data.name}」的阶段和姿态合计改了 ${lookPlan.bones.length} 根骨骼。`, fix: "请把需要显隐或脱落的骨骼减到 30 根以内。" }])
  const look = lookPlan ? { plan: lookPlan, places: boss ? bossDropPlaces(lookPlan, boss, abilityList, data.model) : { phases: [], abilities: [] } } : null
  const unlooked = look ? bossLookIssues({ name: data.name, behavior: data.behavior, abilities: abilityList, boss, stances: data.stances, runtime: { texture_asset_id: data.texture ? "drawn" : null } }, data.model, () => ({ width: data.model.texture_size, height: data.model.texture_size })).filter((issue) => issue.stops) : []
  if (unlooked.length) throw new BuildStop(unlooked[0]!.rule, unlooked)
  // Boss 能力 15: its wake-up's and its death's timed steps; a motion or a bone the model lacks, or a glow with no picture, is said and not built. None: nothing of it is written.
  const unshown = boss ? bossShowIssues({ name: data.name, behavior: data.behavior, boss, abilities: abilityList, runtime: { texture_asset_id: data.texture ? "drawn" : null } }, data.model).filter((issue) => issue.stops) : []
  if (unshown.length) throw new BuildStop(unshown[0]!.rule, unshown)
  // A vanilla particle or sound a show names that the target's game lacks is said, never built, as an ability's is.
  const showGaps = boss ? creatureVanillaGaps({ name: data.name, boss }, target.version.minecraft) : []
  if (showGaps.length) throw new BuildStop("ability_version", showGaps)
  const showSource = boss || data.stances?.list.some(row => row.events)
    ? bossShowSource({
        entity: `StudioCreature${data.classSuffix}`,
        model: data.id,
        modId: data.modId,
        boss,
        ...(stance ? { stanceIndex: stance.indexOf, stances: data.stances! } : {}),
        sound: (ref) => ({ event: soundJava(ref, data.packageName, data.customSounds), source: soundSourceJava(ref, data.customSounds) }),
        places: boss ? bossShowDropPlaces(boss, data.model) : { intro: [], death: [] },
        particleIndices:data.particleIndices,
        bone:(name,clip,time)=>bonePlace(data.model,name,data.model.animations.find(a=>a.name===clip)??null,time),
        // The bones something else sets before every frame: its phases' (item 10) and the parts it throws (item 2).
        managed: [...(look?.plan.bones ?? []), ...abilityList.flatMap((ability) => ability.hits.flatMap((hit) => (hit.type === "projectile" && "bone" in hit.look ? [hit.look.bone] : [])))],
      })
    : null
  const standaloneLook = boss ? null : bossLookSource(`StudioCreature${data.classSuffix}`, data.id, look, false)
  const bossTracker = `${look ? `${BOSS_TRACKER}${BOSS_LOOK_TRACKER}` : BOSS_TRACKER}${showSource?.tracker ?? ""}`
  // Its renderer: the model's own glowing parts are the boss's to fade when a phase glows with them (GeckoLib's always-on glow layer then is not added); every glowing picture is
  // drawn by the mod's fading layer; and before each frame the bones of its stage and the parts that have come off are hidden on the model (shared by every one of its kind).
  const lookGlowsOwn = Boolean(look?.plan.slots.includes("emissive")) || Boolean(showSource?.glowsOwn)
  // Boss 能力 12: a boss whose arena has a fog draws its own glowing parts with the fog lifted, so they show through it (`StudioArenaClient.Glow`).
  const fogGlow = Boolean(boss?.arena?.fog)
  const lookRendererLayer = look?.plan.slots.length
    ? `\n        // Boss 能力 10: its glowing pictures, each as bright as its phase says now.\n        addRenderLayer(new ${BOSS_LOOK_RUNTIME.glow}<>(this, new ResourceLocation[] {${look.plan.slots.map((slot, index) => `ResourceLocation.fromNamespaceAndPath("${data.modId}", "${bossGlowFile(data.id, slot, index)}")`).join(", ")}}, (creature, slot, partialTick) -> creature.bossGlow(slot, partialTick)));`
    : ""
  // Boss 能力 10: the textures its phases put on; its model's texture is what its stage says (`bossTexture`). None: the texture is the model's own, as it always was.
  const lookTextures = look?.plan.textures.length
    ? {
        field: `    // Boss 能力 10: its model's own texture, then those its phases put on, by what \`bossTexture\` says.
    private static final ResourceLocation[] BOSS_TEXTURES = {${["textures/entity/" + data.id + ".png", ...look.plan.textures.map((_, index) => bossTextureFile(data.id, index + 1))].map((file) => `ResourceLocation.fromNamespaceAndPath("${data.modId}", "${file}")`).join(", ")}};
`,
        texture: "BOSS_TEXTURES[creature.bossTexture()]",
      }
    : null
  // Boss 能力 15: the glowing pictures its shows fade, drawn by the same fading layer.
  const showRendererLayer = showSource?.layer((slot, index) => bossShowGlowFile(data.id, slot, index)) ?? ""
  // Boss 能力 2 in the same place: the parts it has thrown that are not back yet are hidden too (`throwerParts`), after its stage's bones, so a part its phase hides stays hidden when it comes back.
  const lookRendererRender = look || thrower || showSource?.render
    ? `
    // ${look ? "Boss 能力 10: the bones its stage hides and the parts that have come off" : thrower ? "Boss 能力 2: the parts it has thrown" : "Boss 能力 15: the bones its wake-up and its death hide"} are hidden on the model before it is drawn; the model is shared by every one of its kind, so each sets all of its own.
    @Override public void render(StudioCreature${data.classSuffix} creature, float yaw, float partialTick, com.mojang.blaze3d.vertex.PoseStack pose, net.minecraft.client.renderer.MultiBufferSource buffers, int light) {
        software.bernie.geckolib.cache.object.BakedGeoModel model = getGeoModel().getBakedModel(getGeoModel().getModelResource(creature));
${
  look
    ? `        String[] bones = creature.bossBones();
        int hidden = creature.bossHiddenBones();
        for (int index = 0; index < bones.length; index++) {
            boolean off = (hidden & (1 << index)) != 0;
            model.getBone(bones[index]).ifPresent(bone -> bone.setHidden(off));
        }
`
    : ""
}${thrower ? thrower.render(Boolean(look)) : ""}${showSource?.render ?? ""}        super.render(creature, yaw, partialTick, pose, buffers, light);
    }
`
    : ""
  // An ability in the air aimed at the one it fights is held to where its hits reach (epic game1): it starts only when it can get there, and the flier holds station while it runs. None: nothing of this is written.
  const reaching = flight ? airReach(abilityList, anchors) : null
  const reaches = Boolean(reaching?.some(Boolean))
  // Boss 能力 11: the far end of the part each trail follows, measured on the model (`trailTip`); only for a creature that draws one.
  // 第 4 步: where its beams start, measured on its model (`groundFxStarts`); null without a beam.
  const emitters = data.emitters ?? []
  const collisionParts = bodyParts(data.hitbox)
  const follow = collisionParts.length || emitters.some(e => e.bone) ? hitboxFollow({ parts: [...collisionParts, ...emitters] }, data.model, abilityList) : null
  const emitterStatements = emitters.map((e, i) => {
    const p = e.bone ? bonePlace(data.model, e.bone, null, 0) : null
    if (e.bone && !p) throw new BuildStop("particle_bone", [{ text: `常驻粒子找不到部件「${e.bone}」。`, fix: "换成模型里已有的部件名。" }])
    const when=e.when
    const gate=typeof when!=="object" ? when==="combat" ? " && getTarget() != null && getTarget().isAlive()" : "" :
      "phase" in when ? ` && bossState() == BOSS_FIGHT && bossPhase() == ${when.phase-1}` :
      when.if==="phase_range" ? ` && bossState() == BOSS_FIGHT && bossPhase() >= ${when.from-1}${when.to ? " && bossPhase() <= "+(when.to-1) : ""}` :
      when.if==="ability" ? abilityList.some(a=>a.id===when.id) ? ` && abilityIndex == ${abilityList.findIndex(a=>a.id===when.id)}${when.include_windup===false ? " && abilityTick >= ABILITY_WINDUP[abilityIndex]" : ""}` : " && false" :
      when.if==="health_below" || when.if==="health_above" ? ` && getHealth() ${when.if==="health_below"?"<":">"} ${when.share} * getMaxHealth()` :
      when.if==="no_sight" ? " && getTarget() != null && !hasLineOfSight(getTarget())" :
      when.if==="fog" ? " && StudioArena.fogActive(this)" : when.if==="intro" ? " && bossState() == BOSS_INTRO" : " && bossState() == BOSS_DORMANT"
    const slot = collisionParts.length + i
    const follows = (follow?.columns[slot] ?? -1) >= 0
    const coord = (axis: "forward" | "up" | "left") => {
      const delta = follows ? ` + (move == null ? 0 : move[${["forward", "up", "left"].indexOf(axis)}])` : ""
      return p ? `${e[axis] ?? 0} + (${p[axis]}${delta}) * getScale()` : String(e[axis] ?? 0)
    }
    const send = `StudioEmit.send(world, StudioEmit.offset(position(), yBodyRot, ${coord("forward")}, ${coord("up")}, ${coord("left")}), yBodyRot, ${emitArguments(e, data.particleIndices)});`
    return `if (tickCount % ${e.every_ticks} == 0${gate}) ${follows ? `{ float[] move = hitboxMoved(${slot}); ${send} }` : send}`
  })
  const emitTick = emitterStatements.length ? `\n        if (isAlive() && level() instanceof net.minecraft.server.level.ServerLevel world) {${follow && !collisionParts.length ? "\n            hitboxPose();" : ""}\n            ${emitterStatements.join("\n            ")}\n        }` : ""
  // Steady finalizes the body facing at the end of the tick. Sample attached emitters after that turn.
  const earlyEmit = steady ? "" : emitTick
  const steadyEnd = steady ? "\n        steadySettle();" + emitTick : ""
  const groundStarts = groundFxStarts(abilityList, data.model)
  const trailTips = abilitiesTrail(abilityList) ? abilityList.map((ability) => ability.events.map((event) => (event.type === "trail" ? (trailTip(data.model, event.bone)?.local ?? null) : null))) : null
  // A 组: what its renderer adds to draw those trails; none, and the renderer is what it was. A vanilla particle or sound an ability names that the target's game lacks is said, never built.
  const trailsDrawn = trailTips ? trailRenderer(`StudioCreature${data.classSuffix}`, target.version) : null
  // 第 2 步: what its renderer adds for motions that blend and bones that follow (`entity-pose.ts`); none, and the renderer is what it was.
  const posed = posePlan(data.model, data.id)
  const pose = posed ? poseRenderer(`StudioCreature${data.classSuffix}`, posed, abilityList.length > 0) : null
  const versionGaps = abilityVersionGaps(data.name, abilityList, target.version)
  if (versionGaps.length) throw new BuildStop("ability_version", versionGaps)
  const abilities = compileAbilities({ stances: data.stances, ...(stance ? { stanceBoss: boss } : {}), terrainInteractions:!!data.terrainInteractions, weightedPose: Boolean(posed?.tracks.length), particleIndices: data.particleIndices, emitBone: (ability, name, tick) => { const pose = abilityClipAt(ability, data.model, tick / 20); return bonePlace(data.model, name, pose?.clip ?? null, pose?.time ?? 0) }, arena: boss?.arena, steady, combat, stagger: data.stagger, damageCap: boss?.damage_cap ?? undefined, guard: data.guard, parts: hasHitboxCombat(data.hitbox, abilityList, data.stances) ? data.hitbox?.parts?.map(part => part.name) : undefined, entity: `StudioCreature${data.classSuffix}`, model: data.id, ...layeredAbilities(data.model, abilityList), sound: (ref) => ({ event: soundJava(ref, data.packageName, data.customSounds), source: soundSourceJava(ref, data.customSounds) }), abilities: abilityList, hostile: data.behavior === "hostile", runtime: Boolean(data.runtime), death: Boolean(death), targeted: Boolean(engage), ...(data.stationary ? { stationary: true } : {}), ...(boss ? { boss: { tracker: bossTracker, ...(bossPlanned?.opening ? { opening: true } : {}) } } : {}), ...(flight ? { flight: true } : {}), ...(reaches ? { reaches: true } : {}), ...(trackerLines || !boss && (look || showSource) ? { extraTracker: trackerLines + (!boss ? (look ? BOSS_LOOK_TRACKER : "") + (showSource?.tracker ?? "") : "") } : {}), ...(anchored ? { anchors } : {}), ...(comboList.length ? { combos: comboList } : {}), ...(trailTips ? { trailTips } : {}), ...(groundStarts ? { groundStarts } : {}), ...(data.tactics && data.behavior === "hostile" ? { tactics: data.tactics } : {}), ...(boss?.phases.some((phase) => phase.between) ? { phases: boss.phases } : {}) })
  const habitSource = compileHabits({
    entity: `StudioCreature${data.classSuffix}`,
    model: data.id,
    habits,
    plan: habits ? habitsPlan(habits, Object.fromEntries(data.model.animations.map((animation) => [animation.name, animation.length]))) : null,
    flier: Boolean(flight),
    busy: abilityList.length ? "abilityRunning()" : "false",
  })
  // A wide flier (wings that reach further to each side than its box does, `flierSpan`) steers by its wing tips too; one whose box is wider than any ordinary creature of the game walks the ground at (`FLIGHT_LIMITS.footprint`) looks for room for the whole box before it sets down.
  const wings = flight ? flierSpan(data.model, core, flight) : null
  // A hostile flier whose own chase goal keeps its target to itself (the game's target stays empty unless something sets it): flight reads who that goal chases too,
  // so it goes up after them as it would after anyone that was set as its target. Any other creature is generated as before.
  const chases = Boolean(flight && data.runtime) && data.behavior === "hostile" && !engage
  const flightSource = compileFlight({
    entity: `StudioCreature${data.classSuffix}`,
    model: data.id,
    flight,
    plan: flight ? flightPlan(flight, abilityList, data.behavior === "hostile", flightFight(abilityList, data.behavior) === "harry", reaches ? reaching! : undefined) : null,
    abilities: abilityList.length > 0,
    steady: Boolean(steady),
    ...(chases ? { chased: "runtimeChasing" } : {}),
    home: habitSource.home,
    resting: habitSource.resting,
    ...(habitSource.eating ? { eating: habitSource.eating } : {}),
    arrived: boss ? BOSS_ARRIVED : "",
    gameplay: data.gameplayGoals,
    ...(leaning ? { lean: true } : {}),
    ...(wings ? { span: wings.half } : {}),
    ...(flight && core.width > FLIGHT_LIMITS.footprint ? { footprint: true } : {}),
    // A boss with a wake-up that flies wakes in the air; one whose phases are faster flies faster in them; one that fights in the air and on the ground has its abilities' phases to ask.
    ...(boss?.intro ? { display: true } : {}),
    ...(boss?.phases.some((phase) => phase.speed > 1) ? { pace: true } : {}),
    ...(boss ? { boss: true } : {}),
    // A dive whose first hit counts from a bone brings that bone to the one it fights (broad11 w1); none: nothing of this is written.
    ...(flight && anchored ? { reach: abilityList.map((ability, index) => diveReach(ability, anchors[index]!)) } : {}),
    // An ability in the air aimed at the one it fights sinks the flier to where its hits reach (epic game1); none: nothing of this is written.
    ...(reaching ? { airReach: reaching } : {}),
  })
  const bossSource = compileBoss({
    ...(data.stances ? { stances: data.stances } : {}),
    ...(boss && data.stances?.list.some(row => row.bar) ? { stanceColors: data.stances.list.map(row => row.bar?.color) } : {}),
        restoreTerrain:abilityList.some(a=>a.events.some(e=>(e.type==="terrain_rise"||e.type==="block_swap") && e.restore_on_exit)),
    builtin:data.builtin,
    stagger: Boolean(data.stagger),
    entity: `StudioCreature${data.classSuffix}`,
    model: data.id,
    boss,
    plan: bossPlanned,
    phaseSounds: boss?.phases.map(phase => {
      if (!phase.sound) return null
      const event = soundJava(phase.sound, data.packageName, data.customSounds)
      return { event: rangedSound(isSoundAsset(phase.sound) ? event : `net.minecraft.sounds.${event}`,phase.range_blocks), volume: phase.volume, source: soundSourceJava(phase.sound, data.customSounds) }
    }) ?? [],
    speed: walkSpeed,
    damage: data.attack_damage,
    health: data.health,
    trackerElsewhere: abilities.tracker !== "",
    interrupt: abilities.interrupt,
    nbtElsewhere: Boolean(data.runtime?.explosion),
    ...(flight ? { flier: true } : {}),
    extra: { tracker: trackerLines, nbtWrite: `${flightSource.nbtWrite}${habitSource.nbtWrite}`, nbtRead: `${flightSource.nbtRead}${habitSource.nbtRead}` },
    ...(habits ? { habits: { resting: habitSource.resting, alert: Boolean(habits.alert) } } : {}),
    // Boss 能力 6: a boss with a bar of its own tells the players of its bar what it shows, the icons lit by what its abilities' fields say it runs (fabric/boss-bar.ts).
    ...(boss && bossBarAsset(boss)
      ? {
          bar: {
            creature: data.id,
            running: !abilityList.length ? "-1" : comboList.length ? `comboIndex >= 0 ? ${abilityList.length} + comboIndex : abilityIndex` : "abilityIndex",
            step: comboList.length ? "comboIndex >= 0 ? abilityIndex : -1" : "-1",
          },
        }
      : {}),
    // Boss 能力 10: its model in each phase, and the parts it drops (fabric/boss-look.ts draws them).
    ...(look ? { look } : {}),
    // Boss 能力 12、13: its arena, with the abilities whose fog, leave and hits over the arena need it (fabric/arena.ts).
    ...(boss && bossArena(boss, abilityList) ? { arena: { abilities: abilityList, running: abilityList.length ? "abilityRunning()" : "false" } } : {}),
    // Boss 能力 15: its wake-up's and its death's timed steps (fabric/boss-show.ts).
    ...(showSource ? { show: showSource } : {}),
  })
  // What the class saves when there is no boss to write the methods that hold it, and when the creature's explosion does not.
  const savedWrite = `${bossSource.nbtWrite}${flightSource.nbtWrite}${habitSource.nbtWrite}`
  const savedRead = `${bossSource.nbtRead}${flightSource.nbtRead}${habitSource.nbtRead}`
  const ownNbt =
    !boss && !data.runtime?.explosion && (flight || habits)
      ? `    @Override public void addAdditionalSaveData(CompoundTag nbt) {
        super.addAdditionalSaveData(nbt);${savedWrite}
    }

    @Override public void readAdditionalSaveData(CompoundTag nbt) {
        super.readAdditionalSaveData(nbt);${savedRead}
    }

`
      : ""
  // The synced values need an initDataTracker of their own when neither the abilities nor the boss write one.
  const ownTracker =
    trackerLines && !abilities.tracker && !boss
      ? `    @Override protected void defineSynchedData(SynchedEntityData.Builder builder) {
        super.defineSynchedData(builder);
${trackerLines}    }

`
      : ""
  // Roaming on the ground only, and inside the home: the game's own goal when the creature neither flies nor has a home.
  const wander = groundWander({ flier: Boolean(flight), home: Boolean(habitSource.home) })
  // A boss's death is timed by the boss (its own seconds), not by the length of the death motion.
  // A flier killed in the air is kept until it is down (`flightFallen`), which only this override can wait for; vanilla's removes it after one second.
  const clipDeath = !boss && ((Boolean(death) && deathTicks(death!.length) !== 20) || Boolean(flight))
  // Parts that follow a bone that moves (hitbox-follow.ts): measured on its motions here, looked up by its server. None: the class is what it always was.
  // While its body plays a motion the table does not have, its parts stand as stated: a boss's show, a habit's motion, the air, dying.
  const shownElse = [bossSource.shown, habitSource.shown, flight ? "flightState() != FLIGHT_GROUND" : "", "isDeadOrDying()"].filter(Boolean).join(" || ")
  const parts = hitboxSource(data.hitbox, leaning, follow ? { table: follow, abilities: abilityList.length > 0, busy: shownElse } : null)
  const partCombat = hitboxCombatSource(data.hitbox, abilityList, Boolean(boss), data.builtin, data.stances)
  if (partCombat) {
    parts.fields += partCombat.fields
    parts.methods = partCombat.methods + (data.hitbox?.core.solid || data.hitbox?.blockers?.length
      ? parts.methods.replace("StudioSolidBody.clear(this, hitboxParts, solidBoxes);", `StudioSolidBody.clear(this, hitboxParts, solidBoxes);${partCombat.tick}`)
      : parts.methods.replace("        }\n    }\n\n    @Override public void remove", `        }${partCombat.tick}\n    }\n\n    @Override public void remove`))
  }
  const egg = eggColors(data.texture ?? compiled.png).map((color) => `0x${color.toString(16).padStart(6, "0")}`)
  // The shadow under it: half as wide as the box it stands in, the game's own measure for its creatures. One that states no box keeps the shadow it always had.
  const shadow = data.hitbox ? Number((data.hitbox.core.width / 2).toFixed(4)) : 0.45
  // How far away it can pick somebody to fight, in blocks: the game's usual follow range, or further when an ability of its reaches further. An ability
  // starts only when its target is within its `max_distance` of it, so a target it never picks up (or lets go of) at that distance is an ability that never
  // starts. Everything that picks or keeps a target (the follow range, who it engages, its own movement goal) is given this one number; abilities are at most
  // `ABILITY_LIMITS.distance` (32) away. A boss's leash does not widen this: it counts a player within `BOSS_LIMITS.battle` (32) as in the fight, which is at least
  // as far as any ability reaches, so the leash never lets go of a target an ability can still hit (a test holds `battle >= ability distance >= engagement`).
  const targetReach = Math.max(ENGAGEMENT_LIMITS.distance, ...abilityList.map((ability) => ability.start.max_distance))
  const reachText = Number.isInteger(targetReach) ? targetReach.toFixed(1) : String(targetReach)
  // What the game is told about a model that reaches beyond its collision box (wings, neck, tail): the box it is culled by, and how far away a player is sent it.
  // Both are said only when the model needs it; a creature whose model fits is generated exactly as before.
  const visible = sightOf(data.model, core, Boolean(flight), Math.max(habits?.home?.radius ?? 0, boss?.leash?.distance ?? 0))
  const blocks = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(value))
  const sightJava = visible.sight
    ? {
        fields: `    // The model reaches beyond its collision box, and the game culls a creature by the box it says (plus half a block): the box it fills, over every pose its
    // motions take${flight ? " and every lean of its flight" : ""}, in blocks from its feet (the body turns, so the same on every side) and up from them.
    private static final double SIGHT_REACH = ${blocks(visible.sight.reach)};
    private static final double SIGHT_LOW = ${blocks(visible.sight.low)};
    private static final double SIGHT_HIGH = ${blocks(visible.sight.high)};
`,
        methods: `    @Override public net.minecraft.world.phys.AABB getBoundingBoxForCulling() {
        double scale = getScale();
        return new net.minecraft.world.phys.AABB(getX() - SIGHT_REACH * scale, getY() + SIGHT_LOW * scale, getZ() - SIGHT_REACH * scale, getX() + SIGHT_REACH * scale, getY() + SIGHT_HIGH * scale, getZ() + SIGHT_REACH * scale);
    }

`,
      }
    : { fields: "", methods: "" }
  // Walking and idling do not play over an ability, nor over a boss's wake-up or change of phase.
  const shownBy = [stance?.hold ? "stanceChanging()" : "", data.stagger ? "combatStagger() >= 0" : "", abilities.shown, bossSource.shown, habitSource.shown].filter(Boolean).join(" || ")
  const hurtTicks = (hurt.length * 20).toString().replace(/^(\d+)$/, "$1.0")
  // What the walk is played by: the speed at which its touching parts hold the ground, and the fastest it may be played (`PACE`).
  const pace = clipPace(data.model, data.model.animations.find((animation) => animation.name === "walk")!)
  // 第 2 步: the ticks the walk and the idle blend into each other over (GeckoLib's own transition: neither is timed by the server): the longer `blend` of the two, else `PACE.blend`.
  const movementBlend = movementBlendTicks(data.model)
  const logic = compileEntityLogic(
    data.logic,
    [...new Set([...data.model.animations.map((animation) => animation.name), ...data.animationNames])],
    data.id,
    // A creature with a runtime block or with abilities has its own tick() below; the rules join it instead of writing a second one.
    !data.runtime && !emitTick && !abilities.tick && !boss && !flight && !habits && !steady,
  )
  const logicController = logic.controller
    ? `        controllers.add(new AnimationController<>(this, "logic", 0, state -> PlayState.STOP)\n${logic.controller});`
    : ""
  // With gameplay code in the mod, any motion of the model can be played by it (`ProjectContent.playMotion`): once, from its start, over what the creature is doing, like a rule's motion.
  const playable = data.gameplayGoals ? [...new Set(data.model.animations.map((animation) => animation.name))].filter((name) => /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(name)) : []
  const motionController = playable.length
    ? `\n        // Started by gameplay code through ProjectContent.playMotion, from the server, so every player near sees it at once.\n        controllers.add(new AnimationController<>(this, "motion", 0, state -> PlayState.STOP)\n${playable.map((name) => `            .triggerableAnim(${JSON.stringify(name)}, RawAnimation.begin().then("animation.${data.id}.${name}", Animation.LoopType.PLAY_ONCE))`).join("\n")});`
    : ""
  const motionMethod = playable.length
    ? `\n\n    private static final java.util.Set<String> PLAYABLE_MOTIONS = java.util.Set.of(${playable.map((name) => JSON.stringify(name)).join(", ")});

    @Override public boolean studioPlay(String motion) {
        if (!PLAYABLE_MOTIONS.contains(motion)) return false;
        if (!isDeadOrDying()) triggerAnim("motion", motion);
        return true;
    }`
    : ""
  const runtime = data.runtime
  // How its own goal closes in on its target: not at all for one that stays where it is.
  const movement = data.stationary ? null : runtime?.movement
  const deathDrop = runtime?.death_drop
  // What lures a follower: the items its document names, by registry id so a missing one matches nothing; without `tempt` the wheat it always had.
  const lures = data.behavior === "follow" ? (data.tempt ?? []) : []
  const lured = (stack: string) => (lures.length ? `isLure(${stack})` : `${stack}.is(Items.WHEAT)`)
  const lureMembers = lures.length
    ? `    // The items that draw it (the document's tempt), by id: an item that is not in the game matches nothing, and the empty hand is no item.
    private static final java.util.Set<ResourceLocation> LURES = java.util.Set.of(${lures.map((item) => `ResourceLocation.fromNamespaceAndPath("${item.includes(":") ? item.split(":")[0] : data.modId}", "${item.includes(":") ? item.split(":")[1] : item}")`).join(", ")});
    private static boolean isLure(ItemStack stack) { return LURES.contains(BuiltInRegistries.ITEM.getKey(stack.getItem())); }

`
    : ""
  const spawnDark = runtime?.spawn?.light ? runtime.spawn.light === "dark" : data.behavior === "hostile"
  const runtimeContentImports = runtime?.spawn
    ? `import net.fabricmc.fabric.api.biome.v1.BiomeModifications;
import net.fabricmc.fabric.api.biome.v1.BiomeSelectors;
import net.minecraft.world.entity.SpawnPlacements;
import net.minecraft.world.entity.SpawnPlacementTypes;
import net.minecraft.world.entity.Mob;
${spawnDark ? "import net.minecraft.world.entity.monster.Monster;\n" : ""}import net.minecraft.world.Difficulty;
import net.minecraft.world.level.levelgen.Heightmap;
${runtime.spawn.biomes.length || runtime.spawn.tags?.length ? "import net.minecraft.resources.ResourceKey;\n" : ""}import net.minecraft.core.registries.Registries;
${runtime.spawn.tags?.length ? "import net.minecraft.tags.TagKey;\n" : ""}`
    : ""
  // Each part of where it spawns is a selector of its own; a creature that names several gets any of them.
  const spawnBiomes = runtime?.spawn
    ? [
        ...(runtime.spawn.biomes.length
          ? [`BiomeSelectors.includeByKey(\n${runtime.spawn.biomes.map((biome) => `            ResourceKey.create(Registries.BIOME, ResourceLocation.fromNamespaceAndPath("${biome.split(":")[0]}", "${biome.split(":")[1]}"))`).join(",\n")}\n        )`]
          : []),
        ...(runtime.spawn.tags ?? []).map((tag) => `BiomeSelectors.tag(TagKey.create(Registries.BIOME, ResourceLocation.fromNamespaceAndPath("minecraft", "${tag}")))`),
      ]
    : []
  // Where a natural spawn may place it: the same rule on every loader (only how it is handed to the loader differs).
  const spawnRule = runtime?.spawn
    ? `(type, world, reason, pos, random) -> ${data.behavior === "hostile" ? "world.getDifficulty() != Difficulty.PEACEFUL && " : ""}${spawnDark ? "Monster.isDarkEnoughToSpawn(world, pos, random) && " : ""}${runtime.spawn.light === "bright" ? "world.getRawBrightness(pos, 0) > 8 && " : ""}${runtime.spawn.above_sea ? `pos.getY() >= world.getSeaLevel() + ${runtime.spawn.above_sea} && ` : ""}${runtime.spawn.time || runtime.spawn.weather ? "spawnMoment(world, reason, random) && " : ""}Mob.checkMobSpawnRules(type, world, reason, pos, random)${runtime.spawn.near ? " && nearStructure(world, reason, pos)" : ""}${runtime.spawn.cap ? " && roomInHabitat(world, reason, pos)" : ""}`
    : ""
  // r29: only by a structure (`spawn.near`), as a method of the content class beside the cap's. Fully qualified names only, so the content class's imports stay as they were.
  const near = runtime?.spawn?.near
  const nearHelper = near
    ? `    // Only within ${near.distance} blocks of ${near.structures.length > 1 ? "one of these structures" : "this structure"} (its box, measured along the ground): ${near.structures.map((ref) => structureName(data.modId, ref)).join(", ")}.
    // A structure the game does not have (another mod's, not installed) matches nothing. The chunks around the spot are only read when they are already there: a natural spawn
    // never loads or makes one. Where the chunk that holds a structure's start is not, its box is taken as the chunk that refers to it (a little short of the whole).
    private static final net.minecraft.resources.ResourceLocation[] NEAR = { ${near.structures.map((ref) => `net.minecraft.resources.ResourceLocation.tryParse("${structureName(data.modId, ref)}")`).join(", ")} };
    private static boolean nearStructure(net.minecraft.world.level.ServerLevelAccessor world, net.minecraft.world.entity.MobSpawnType reason, net.minecraft.core.BlockPos pos) {
        if (reason != net.minecraft.world.entity.MobSpawnType.NATURAL && reason != net.minecraft.world.entity.MobSpawnType.CHUNK_GENERATION) return true;
        net.minecraft.core.Registry<net.minecraft.world.level.levelgen.structure.Structure> structures = world.registryAccess().registryOrThrow(net.minecraft.core.registries.Registries.STRUCTURE);
        final int reach = ${near.distance};
        final int span = (reach + 15) >> 4;
        final int chunkX = pos.getX() >> 4, chunkZ = pos.getZ() >> 4;
        for (net.minecraft.resources.ResourceLocation id : NEAR) {
            net.minecraft.world.level.levelgen.structure.Structure structure = id == null ? null : structures.get(id);
            if (structure == null) continue;
            for (int x = chunkX - span; x <= chunkX + span; x++) {
                for (int z = chunkZ - span; z <= chunkZ + span; z++) {
                    if (!world.hasChunk(x, z)) continue;
                    for (long start : world.getChunk(x, z).getReferencesForStructure(structure)) {
                        int startX = net.minecraft.world.level.ChunkPos.getX(start), startZ = net.minecraft.world.level.ChunkPos.getZ(start);
                        net.minecraft.world.level.levelgen.structure.StructureStart found = world.hasChunk(startX, startZ) ? world.getChunk(startX, startZ).getStartForStructure(structure) : null;
                        int minX = x << 4, minZ = z << 4, maxX = minX + 15, maxZ = minZ + 15;
                        if (found != null && found.isValid()) {
                            net.minecraft.world.level.levelgen.structure.BoundingBox box = found.getBoundingBox();
                            minX = box.minX(); minZ = box.minZ(); maxX = box.maxX(); maxZ = box.maxZ();
                        }
                        int dx = Math.max(0, Math.max(minX - pos.getX(), pos.getX() - maxX));
                        int dz = Math.max(0, Math.max(minZ - pos.getZ(), pos.getZ() - maxZ));
                        if (dx * dx + dz * dz <= reach * reach) return true;
                    }
                }
            }
        }
        return false;
    }

`
    : ""
  const runtimeSpawn = runtime?.spawn
    ? `        SpawnPlacements.register(CREATURE, SpawnPlacementTypes.ON_GROUND, Heightmap.Types.MOTION_BLOCKING_NO_LEAVES,
            ${spawnRule});
        BiomeModifications.addSpawn(${spawnBiomes[0]}${spawnBiomes.slice(1).map((selector) => `.or(${selector})`).join("")}, MobCategory.${data.behavior === "hostile" ? "MONSTER" : "CREATURE"}, CREATURE, ${runtime.spawn.weight}, ${runtime.spawn.min}, ${runtime.spawn.max});`
    : ""
  // The population cap of the natural spawn, as a method of the content class so the lambda above stays one line. It is the last term of the spawn rule, after the cheap
  // checks (light, height, the ground), so the entity lookup runs only for a spot that would otherwise take the creature.
  const spawnCap = runtime?.spawn?.cap
  // `type`: the Java that names its entity type (Fabric's field holds it; the facade's holds a supplier of it).
  const capHelperOf = (type: string) => spawnCap
    ? `    // At most ${spawnCap.count} of this creature within ${spawnCap.radius} blocks of the spot, measured along the ground: a box over the whole height of the world (the game's entity index is
    // looked up by box, one range per chunk column), then the corners cut off so the radius is a true one. Only natural spawns count (a spawner or a command is the person's own doing).
    // While a new chunk is first made the game hands over a region that lists no entities, so a creature placed then is not counted (it is never wrongly refused, only sometimes not capped).
    private static boolean roomInHabitat(net.minecraft.world.level.ServerLevelAccessor world, net.minecraft.world.entity.MobSpawnType reason, net.minecraft.core.BlockPos pos) {
        if (reason != net.minecraft.world.entity.MobSpawnType.NATURAL && reason != net.minecraft.world.entity.MobSpawnType.CHUNK_GENERATION) return true;
        final double x = pos.getX() + 0.5, z = pos.getZ() + 0.5, radius = ${spawnCap.radius};
        net.minecraft.world.phys.AABB habitat = new net.minecraft.world.phys.AABB(x - radius, world.getMinBuildHeight(), z - radius, x + radius, world.getMaxBuildHeight(), z + radius);
        return world.getEntities(${type}, habitat, other -> other.isAlive() && (other.getX() - x) * (other.getX() - x) + (other.getZ() - z) * (other.getZ() - z) <= radius * radius).size() < ${spawnCap.count};
    }

`
    : ""
  // r29 (第 2 件): more or less often by the time of day and the weather (`spawn.time`, `spawn.weather`): a spawn is let through at its moment's share of the commonest moment.
  const time = runtime?.spawn?.time
  const weather = runtime?.spawn?.weather
  const scaleOf = (scales: Record<string, number | undefined> | undefined, key: string) => scales?.[key] ?? 1
  const most = Math.max(...SPAWN_TIMES.map((key) => scaleOf(time, key))) * Math.max(...SPAWN_WEATHERS.map((key) => scaleOf(weather, key)))
  const float = (value: number) => `${Number(value.toFixed(4))}f`
  const momentHelper = time || weather
    ? `    // More or less often by the moment (spawn.time, spawn.weather): the overworld's time of day and the world's weather, as a share of the commonest moment (${float(most)}).
    // Only natural spawns are held to it.
    private static boolean spawnMoment(net.minecraft.world.level.ServerLevelAccessor world, net.minecraft.world.entity.MobSpawnType reason, net.minecraft.util.RandomSource random) {
        if (reason != net.minecraft.world.entity.MobSpawnType.NATURAL && reason != net.minecraft.world.entity.MobSpawnType.CHUNK_GENERATION) return true;
        net.minecraft.server.level.ServerLevel level = world.getLevel();
        float share = 1.0f;
${time ? `        long clock = level.getDayTime() % 24000L;
        share *= clock >= 22200L || clock < 1000L ? ${float(scaleOf(time, "dawn"))} : clock < 12000L ? ${float(scaleOf(time, "day"))} : clock < 13800L ? ${float(scaleOf(time, "dusk"))} : ${float(scaleOf(time, "night"))};
` : ""}${weather ? `        share *= level.isThundering() ? ${float(scaleOf(weather, "thunder"))} : level.isRaining() ? ${float(scaleOf(weather, "rain"))} : ${float(scaleOf(weather, "clear"))};
` : ""}        return share > 0.0f && (share >= ${float(most)} || random.nextFloat() * ${float(most)} < share);
    }

`
    : ""
  const capHelper = `${nearHelper}${momentHelper}${capHelperOf("CREATURE")}`
  const lair = boss?.lair ?? null
  // A boss a player calls up (`summon`): the class every summoning boss shares, and the line its content class adds itself with. A creature without one adds nothing.
  const summon = boss?.summon ?? null
  const runtimeEntityImports = runtime
    ? `import java.util.Comparator;
import java.util.EnumSet;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
${runtime.explosion ? "import net.minecraft.world.effect.MobEffectInstance;\nimport net.minecraft.nbt.CompoundTag;\nimport net.minecraft.server.level.ServerLevel;\nimport net.minecraft.core.particles.ParticleTypes;\nimport net.minecraft.sounds.SoundEvents;\nimport net.minecraft.sounds.SoundSource;\n" : ""}
`
    : ""
  // The plain swing is the same in the air as on the ground for a flier that has no ability: its flight closes in on the target (`flightFight`, "harry"), the swing is the creature's.
  const flierSwings = Boolean(flight && runtime) && data.behavior === "hostile" && !runtime?.explosion && flightFight(abilityList, data.behavior) === "harry"
  const runtimeArmor = runtime ? `.add(Attributes.ARMOR, ${runtime.armor})` : ""
  // A boss with a wake-up and habits has met nobody while it sleeps, though it may be up and about: the creature's own search for a player to chase waits until it has (the game's target search waits by `canTarget`).
  const unmet = Boolean(boss?.intro && habits)
  const runtimeFields = runtime
    ? `    private static final double RUNTIME_TARGET_DISTANCE = ${reachText};
    private static final double RUNTIME_FUSE_DISTANCE = 3.0;
    private boolean runtimeCharging;
    private int runtimeAttackCooldown;
    private int runtimeRetreatTicks;
${chases ? "    // Whom its own chase goal is after, for its flight to read (the game's target is not where this goal keeps it).\n    private Player runtimeChasing;\n" : ""}${
  runtime.explosion
    ? `    private static final int RUNTIME_FUSE_TICKS = ${runtime.explosion.fuse_ticks};
    private int runtimeFuseTicks = -1;
    private ${engage ? "LivingEntity" : "Player"} runtimeFuseTarget;
`
    : ""
}`
    : ""
  const runtimeMethods = runtime
    ? `${
        engage
          ? ""
          : `    private Player runtimeNearestPlayer() {
        ${
          data.behavior === "passive"
            ? "return null;"
            : `return level().getEntities(this, getBoundingBox().inflate(RUNTIME_TARGET_DISTANCE),
                entity -> ${unmet ? "bossMet() && " : ""}entity instanceof Player player && player.isAlive() && !player.isSpectator()
                    && !player.isCreative() && hasLineOfSight(player) ${data.behavior === "follow" ? `&& (${lured("player.getMainHandItem()")} || ${lured("player.getOffhandItem()")}) ` : ""}&& distanceToSqr(player) <= RUNTIME_TARGET_DISTANCE * RUNTIME_TARGET_DISTANCE).stream()
            .map(entity -> (Player) entity)
            .min(Comparator.comparingDouble(player -> distanceToSqr(player))).orElse(null);`
        }
    }

`
      }    private void updateRuntimeArmor(boolean charging) {
        runtimeCharging = charging;
        var armor = getAttribute(Attributes.ARMOR);
        if (armor != null) armor.setBaseValue(charging ? ${runtime.charging_armor} : ${runtime.armor});
    }

${
  runtime.explosion
    ? `    private void detonateRuntime() {
        if (level().isClientSide()) return;
        level().explode(this, getX(), getY(), getZ(), ${runtime.explosion.radius}f,
            false, Level.ExplosionInteraction.${runtime.explosion.damage_blocks ? "MOB" : "NONE"});
        for (var entity : level().getEntities(this, getBoundingBox().inflate(${runtime.explosion.radius}),
                entity -> entity instanceof Player player && player.isAlive() && !player.isSpectator()
                    && !player.isCreative() && distanceToSqr(player) <= ${runtime.explosion.radius * runtime.explosion.radius})) {
            if (!(entity instanceof Player player)) continue;
${
  runtime.explosion.effects
    .map(
      (effect) => `            player.addEffect(new MobEffectInstance(
                BuiltInRegistries.MOB_EFFECT.getHolder(ResourceLocation.fromNamespaceAndPath("minecraft", "${effect.effect}")).orElseThrow(),
                ${effect.duration_ticks}, ${effect.amplifier}));`,
    )
    .join("\n") || "            // No configured player effects."
}
        }
        discard();
    }

`
    : ""
}    private void tickRuntime() {
        if (level().isClientSide()${death ? " || isDeadOrDying()" : ""}) return;
        if (runtimeAttackCooldown > 0) runtimeAttackCooldown--;
        if (hurtTime > 0) runtimeRetreatTicks = 40;
        else if (runtimeRetreatTicks > 0) runtimeRetreatTicks--;
        ${engage ? "LivingEntity target = getTarget();" : "Player target = runtimeNearestPlayer();"}
        boolean charging = ${runtime.explosion ? "target != null && distanceToSqr(target) <= RUNTIME_FUSE_DISTANCE * RUNTIME_FUSE_DISTANCE" : "false"};
        updateRuntimeArmor(charging);
${
  runtime.explosion
    ? `        if (!charging || (runtimeFuseTarget != null && runtimeFuseTarget != target)) {
            runtimeFuseTicks = -1;
            runtimeFuseTarget = null;
            return;
        }
        if (runtimeFuseTarget == null) {
            runtimeFuseTarget = target;
            if (runtimeFuseTicks < 0) {
                runtimeFuseTicks = 0;
                ${data.builtin?.fuse?.sound==="none" ? "if (false) " : ""}level().playSound(null, blockPosition(), ${builtinSound(!!data.builtin?.fuse?.sound, "this", "fuse", "SoundEvents.CREEPER_PRIMED", "entity.creeper.primed")}, SoundSource.HOSTILE, 1.0f, 0.5f);
            }
        } else {
            runtimeFuseTicks++;
        }
        if (runtimeFuseTicks % 5 == 0 && level() instanceof ServerLevel serverWorld)
            ${data.builtin?.fuse?.particle==="none" ? "if (false) " : ""}serverWorld.sendParticles(${builtinParticle(!!data.builtin?.fuse?.particle, "this", "fuse", "ParticleTypes.SMOKE")}, getX(), getEyeY(), getZ(), 3, 0.2, 0.2, 0.2, 0.01);
        if (runtimeFuseTicks >= RUNTIME_FUSE_TICKS) detonateRuntime();
`
    : ""
}    }

    private final class RuntimeMovementGoal extends Goal {
        private ${engage ? "LivingEntity" : "Player"} target;

        private RuntimeMovementGoal() {
            setFlags(EnumSet.of(Flag.MOVE, Flag.LOOK));
        }

${
  engage
    ? `        // It goes after its target and nobody else; who that is, is decided elsewhere (its target goal, gameplay code).
        @Override public boolean canUse() {
            target = getTarget();
            return target != null && target.isAlive();
        }

        @Override public boolean canContinueToUse() { return canUse()${finishPath ? " || steadyFollowingPath()" : ""}; }`
    : `        @Override public boolean canUse() {
            target = runtimeNearestPlayer();
            return target != null && distanceToSqr(target) <= RUNTIME_TARGET_DISTANCE * RUNTIME_TARGET_DISTANCE;
        }

        @Override public boolean canContinueToUse() {
            return target != null && target.isAlive() && !target.isSpectator() && !target.isCreative()
                && hasLineOfSight(target) ${data.behavior === "follow" ? `&& (${lured("target.getMainHandItem()")} || ${lured("target.getOffhandItem()")}) ` : ""}&& distanceToSqr(target) <= RUNTIME_TARGET_DISTANCE * RUNTIME_TARGET_DISTANCE;
        }`
}

${chases ? "        @Override public void start() { runtimeChasing = target; }\n\n" : ""}        @Override public void stop() {
            target = null;${chases ? "\n            runtimeChasing = null;" : ""}
            getNavigation().stop();
            setXxa(0.0f);
        }

        @Override public void tick() {
            if (target == null) return;
            ${abilities.engage ? `${abilities.engage}\n            ` : ""}getLookControl().setLookAt(target, 30.0f, 30.0f);${flight ? `\n            // In the air its flight carries it: it does not walk from there${flierSwings ? ", but one with no move of its own swings at what it has come close to (its flight brings it there)" : ", and does not swing"}.\n            if (flightState() != FLIGHT_GROUND) {${flierSwings ? "\n                if (runtimeAttackCooldown == 0 && isWithinMeleeAttackRange(target)) {\n                    doHurtTarget(target);\n                    runtimeAttackCooldown = 20;\n                }" : ""}\n                return;\n            }` : ""}
            if (${data.behavior === "hostile" && !runtime.explosion && !abilities.engage} && runtimeAttackCooldown == 0 && isWithinMeleeAttackRange(target)) {
                doHurtTarget(target);
                runtimeAttackCooldown = 20;
            }
            ${steady && abilities.engage && !data.stationary ? "if (!steadyPathReady()) return;\n            " : ""}${movement === "direct" ? `getNavigation().moveTo(target, 1.0${abilities.pace ?? ""});` : ""}
            ${movement === "stalk" ? `if (distanceToSqr(target) > 4.0) getNavigation().moveTo(target, 0.7${abilities.pace ?? ""}); else getNavigation().stop();` : ""}
            ${movement === "burst" ? `getNavigation().moveTo(target, ${abilities.pace ? `(tickCount % 40 < 12 ? 1.8 : 0.75)${abilities.pace ?? ""}` : "tickCount % 40 < 12 ? 1.8 : 0.75"});` : ""}
            ${movement === "strafe" ? `double dx = target.getX() - getX(); double dz = target.getZ() - getZ(); double distance = Math.max(0.001, Math.sqrt(dx * dx + dz * dz)); double side = (tickCount / 20) % 2 == 0 ? 1.5 : -1.5; getNavigation().moveTo(target.getX() - dz / distance * side, target.getY(), target.getZ() + dx / distance * side, 1.0${abilities.pace ?? ""});` : ""}
            ${movement === "leap" ? `getNavigation().moveTo(target, 1.0${abilities.pace ?? ""}); if (onGround() && tickCount % 20 == 0 && distanceToSqr(target) > 4.0 && distanceToSqr(target) < 64.0) { double dx = target.getX() - getX(); double dz = target.getZ() - getZ(); double distance = Math.max(0.001, Math.sqrt(dx * dx + dz * dz)); setDeltaMovement(dx / distance * 0.45, 0.4, dz / distance * 0.45); }` : ""}
            ${movement === "retreat" ? `if (runtimeRetreatTicks > 0) { double dx = getX() - target.getX(); double dz = getZ() - target.getZ(); double distance = Math.max(0.001, Math.sqrt(dx * dx + dz * dz)); getNavigation().moveTo(getX() + dx / distance * 8.0, getY(), getZ() + dz / distance * 8.0, 1.0${abilities.pace ?? ""}); } else getNavigation().moveTo(target, 1.0${abilities.pace ?? ""});` : ""}
        }
    }

${
  runtime.explosion
    ? `    @Override public void addAdditionalSaveData(CompoundTag nbt) {
        super.addAdditionalSaveData(nbt);
        nbt.putInt("RuntimeFuseTicks", runtimeFuseTicks);${savedWrite}
    }

    @Override public void readAdditionalSaveData(CompoundTag nbt) {
        super.readAdditionalSaveData(nbt);
        runtimeFuseTicks = nbt.contains("RuntimeFuseTicks")
            ? Math.max(-1, Math.min(RUNTIME_FUSE_TICKS, nbt.getInt("RuntimeFuseTicks")))
            : -1;${savedRead}
    }

`
    : ""
}`
    : ""
  // Only a creature that picks any player by itself is warned in front of: one that picks whoever hit it, or nobody, has no distance to pick them from.
  const warned = engage === "any_player" && attackDistance !== null
  const engageSource = engage
    ? {
        imports: `${engage === "any_player" && !runtime ? "import java.util.Comparator;\n" : ""}${engage !== "none_by_itself" && !runtime && !abilities.imports ? "import java.util.EnumSet;\n" : ""}import net.minecraft.world.entity.LivingEntity;\n`,
        fields: `    // ---- who it fights: decided here and nowhere else; everything it does to fight acts on getTarget() ----
    private static final double ENGAGE_DISTANCE = ${reachText};
    private static final int ENGAGE_UNSEEN_TICKS = ${ENGAGEMENT_LIMITS.unseen_ticks};
${
  warned
    ? `    // It warns before it attacks: it picks a player only within this many blocks of it, or one who hit it. Keeping a target it has is not affected.
    private static final double ENGAGE_ATTACK_DISTANCE = ${Number.isInteger(attackDistance) ? attackDistance!.toFixed(1) : String(attackDistance)};
`
    : ""
}    private int engageUnseenTicks;${finishPath ? "\n    private int steadyFinishPathUntil;" : ""}
`,
        methods: `${finishPath ? `    private boolean steadyFollowingPath() {
        return getTarget() == null && tickCount < steadyFinishPathUntil && !getNavigation().isDone();
    }

` : ""}    /** Whether it may fight this one right now. Asked before it picks anybody, and again on every tick for whoever it is after. */
    private boolean engageAllows(LivingEntity candidate) {
        return candidate != null && candidate != this && candidate.isAlive() && candidate.level() == level() && canAttack(candidate)
            && distanceToSqr(candidate) <= ENGAGE_DISTANCE * ENGAGE_DISTANCE${data.gameplayGoals ? `\n            && ${GAMEPLAY_API.content}.mayTarget(this, candidate)` : ""};
    }

${
  warned
    ? `    /** Whether this one is near enough to be picked: within the warning distance, or one who has hit it. Asked only when it picks, never of a target it already has. */
    private boolean engageNear(LivingEntity candidate) {
        return distanceToSqr(candidate) <= ENGAGE_ATTACK_DISTANCE * ENGAGE_ATTACK_DISTANCE || candidate == getLastHurtByMob();
    }

`
    : ""
}    @Override protected void customServerAiStep() {
        super.customServerAiStep();
        // Whoever gave it its target (its own goal below, gameplay code), the target is let go as soon as it no longer
        // qualifies. With no target nothing of its own that fights runs, and its body is free for its other goals.
        LivingEntity target = getTarget();
        ${steady?.focus ? "steadyObserve(target);\n        " : ""}if (target == null) {
            engageUnseenTicks = 0;
            return;
        }
        ${finishPath ? "steadyFinishPathUntil = 0;\n        " : ""}engageUnseenTicks = hasLineOfSight(target) ? 0 : engageUnseenTicks + 1;
        ${steady?.focus ? "if (steadyChoose(target)) return;\n        " : ""}${finishPath ? `if (!engageAllows(target)) setTarget(null);
        else if (engageUnseenTicks > ENGAGE_UNSEEN_TICKS) {
            // Finish the current route while the target is out of sight. No new location is requested after release.
            steadyFinishPathUntil = tickCount + ENGAGE_UNSEEN_TICKS;
            setTarget(null);
        }` : "if (!engageAllows(target) || engageUnseenTicks > ENGAGE_UNSEEN_TICKS) setTarget(null);"}
    }

${
  engage === "none_by_itself"
    ? ""
    : `    /** The only place it picks somebody by itself, and only while it is after nobody: ${engage === "any_player" ? "the nearest player it can see" : "whoever just hurt it"}. */
    private final class EngageTargetGoal extends Goal {
        private LivingEntity found;

        private EngageTargetGoal() {
            setFlags(EnumSet.of(Flag.TARGET));
        }

        @Override public boolean canUse() {
            if (getTarget() != null) return false;
            ${
              engage === "any_player"
                ? `found = level().getEntitiesOfClass(Player.class, getBoundingBox().inflate(ENGAGE_DISTANCE), player -> engageAllows(player) && hasLineOfSight(player)${warned ? " && engageNear(player)" : ""}).stream()
                .min(Comparator.comparingDouble(player -> distanceToSqr(player))).orElse(null);`
                : `LivingEntity attacker = getLastHurtByMob();
            found = attacker != null && attacker.getType() != getType() && engageAllows(attacker) ? attacker : null;`
            }
            return found != null;
        }

        @Override public void start() {
            setTarget(found);
            found = null;
        }

        // It only hands the target over; keeping or dropping it is mobTick's.
        @Override public boolean canContinueToUse() { return false; }
    }

`
}`,
      }
    : { imports: "", fields: "", methods: "" }
  const sounds = data.sounds
  const voice = (ref: SoundRef, key: "ambient"|"hurt"|"death"|"step") => rangedSound(soundJava(ref, data.packageName, data.customSounds), sounds?.ranges?.[key] ?? sounds?.range_blocks)
  // Only a vanilla sound is named by its `SoundEvents` constant; one of the project's own is named in full.
  const vanilla = Boolean(sounds && [sounds.ambient, sounds.hurt, sounds.death, sounds.step].some((ref) => ref && !isSoundAsset(ref)))
  // Only the moments that were chosen are overridden; the rest stay what every mob does.
  const interval = sounds?.step_interval
  const stepGate = interval === undefined ? "" : `    private int nextStepSoundTick;
    @Override protected void playStepSound(BlockPos pos, BlockState state) {
        if (tickCount < nextStepSoundTick) return;
        nextStepSoundTick = tickCount + ${interval === 0 ? "Math.max(1, Math.round(getBbHeight() * 5.0f))" : Math.max(1, Math.ceil(interval * 20))};
        ${sounds?.step ? `playSound(${voice(sounds.step, "step")}, 0.15f * ${sounds.volume}f, getVoicePitch());` : "super.playStepSound(pos, state);"}
    }
`
  const soundMethods = sounds
    ? `${sounds.ambient ? `    @Override protected SoundEvent getAmbientSound() { return ${voice(sounds.ambient, "ambient")}; }\n` : ""}${
        sounds.hurt ? `    @Override protected SoundEvent getHurtSound(DamageSource source) { return ${voice(sounds.hurt, "hurt")}; }\n` : ""
      }${sounds.death ? `    @Override protected SoundEvent getDeathSound() { return ${voice(sounds.death, "death")}; }\n` : ""}${
        stepGate || (sounds.step ? `    @Override protected void playStepSound(BlockPos pos, BlockState state) { playSound(${voice(sounds.step, "step")}, 0.15f * ${sounds.volume}f, getVoicePitch()); }\n` : "")
      }    @Override protected float getSoundVolume() { return ${sounds.volume}f; }
    @Override public float getVoicePitch() { return (random.nextFloat() - random.nextFloat()) * 0.2f + ${sounds.pitch}f; }
`
    : ""
  const soundImports = sounds
    ? `${sounds.step || stepGate ? "import net.minecraft.world.level.block.state.BlockState;\n" : ""}${sounds.hurt && !deathDrop ? "import net.minecraft.world.damagesource.DamageSource;\n" : ""}${
        sounds.ambient || sounds.hurt || sounds.death ? "import net.minecraft.sounds.SoundEvent;\n" : ""
      }${vanilla && !runtime?.explosion ? "import net.minecraft.sounds.SoundEvents;\n" : ""}${sounds.step || stepGate ? "import net.minecraft.core.BlockPos;\n" : ""}`
    : ""
  // A big body that gets stuck (hitbox.stuck) looks for another way; one that stays where it is on purpose has nowhere to go. None: nothing of this is written.
  const stuck =
    data.hitbox?.stuck && !data.stationary
      ? stuckSource(data.hitbox.stuck, runtime && !engage ? "runtimeNearestPlayer()" : "getTarget()", [abilityList.length ? "abilityRunning()" : "", shownBy, flight ? "flightState() != FLIGHT_GROUND" : "", "isDeadOrDying()"].filter(Boolean).join(" || "))
      : null
  // The highest step it walks up (hitbox.core.step): the game's attribute in 1.21.1 (1.20.1 has no such attribute; the platform layer writes it there as the entity's maxUpStep). Left out: the game's 0.6.
  const step = typeof data.hitbox?.core.step === "number" ? `            .add(Attributes.STEP_HEIGHT, ${data.hitbox.core.step})
` : ""
  const names = {
    content: `StudioContent${data.classSuffix}`,
    entity: `StudioCreature${data.classSuffix}`,
    client: `StudioClient${data.classSuffix}`,
    renderer: `StudioCreatureRenderer${data.classSuffix}`,
  }
  const source = `src/main/java/${data.packageName.replaceAll(".", "/")}`
  const resources = `src/main/resources/assets/${data.modId}`
  const files: Record<string, string | Uint8Array> = {
    [`${resources}/geo/${data.id}.geo.json`]: JSON.stringify(compiled.geometry, null, 2),
    [`${resources}/animations/${data.id}.animation.json`]: JSON.stringify(compiled.animation, null, 2),
    [`${resources}/textures/entity/${data.id}.png`]: compiled.png,
    [`${resources}/lang/zh_cn.json`]: JSON.stringify(
      {
        [`entity.${data.modId}.${data.id}`]: data.name,
        [`item.${data.modId}.${data.id}_spawn_egg`]: `${data.name}刷怪蛋`,
      },
      null,
      2,
    ),
    [`${resources}/lang/en_us.json`]: JSON.stringify(
      {
        [`entity.${data.modId}.${data.id}`]: data.name_en || data.name,
        [`item.${data.modId}.${data.id}_spawn_egg`]: `${data.name_en || data.name} Spawn Egg`,
      },
      null,
      2,
    ),
    [`${resources}/models/item/${data.id}_spawn_egg.json`]: JSON.stringify({
      parent: "minecraft:item/template_spawn_egg",
    }),
    // A boss's lair (a structure of the world's own generation): the fixed class every lair shares, and this creature's two datapack files. A creature without one adds nothing.
    ...(lair ? { [`${source}/${LAIR_CLASS}.java`]: lairClass(data.modId, data.packageName, target, Boolean(data.lairGuarded)), ...lairData(data.modId, data.id, lair, data.lairGuards) } : {}),
    ...(summon ? { [`${source}/${SUMMON_CLASS}.java`]: summonClass(data.packageName, target, data.sharedBuiltin?.sound) } : {}),
    ...(loot.length ? { [`src/main/resources/data/${data.modId}/loot_table/entities/${data.id}.json`]: JSON.stringify(creatureLootTable(data.modId, data.id, loot, Boolean(boss)), null, 2) } : {}),
    [`${source}/${names.content}.java`]: `package ${data.packageName};

import ${data.packageName}.entity.${names.entity};
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
${runtimeContentImports}
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.SpawnEggItem;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.Registry;
import net.minecraft.resources.ResourceLocation;

public final class ${names.content} implements ModInitializer {
    public static final String MOD_ID = "${data.modId}";
    public static final EntityType<${names.entity}> CREATURE = Registry.register(
        BuiltInRegistries.ENTITY_TYPE, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${data.id}"),
        EntityType.Builder.of(${names.entity}::new, MobCategory.${data.behavior === "hostile" ? "MONSTER" : "CREATURE"})
            .sized(${core.width.toFixed(4)}f, ${core.height.toFixed(4)}f)${typeof data.hitbox?.core.eye_height === "number" ? `.eyeHeight(${data.hitbox.core.eye_height.toFixed(4)}f)` : ""}${visible.chunks === null ? "" : `.clientTrackingRange(${visible.chunks})`}${flight ? ".updateInterval(1)" : ""}.build("${data.id}"));
    public static final Item SPAWN_EGG = Registry.register(BuiltInRegistries.ITEM,
        ResourceLocation.fromNamespaceAndPath(MOD_ID, "${data.id}_spawn_egg"), new SpawnEggItem(CREATURE, ${egg[0]}, ${egg[1]}, new Item.Properties()));

${capHelper}    public static void register() {
        FabricDefaultAttributeRegistry.register(CREATURE, ${names.entity}.attributes());
        ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.SPAWN_EGGS).register(entries -> entries.accept(SPAWN_EGG));
${runtimeSpawn}${lair ? `${runtimeSpawn ? "\n" : ""}        ${LAIR_CLASS}.register();` : ""}${summon ? `${runtimeSpawn || lair ? "\n" : ""}        ${summonCall(data.modId, data.id, summon)}` : ""}
    }
    @Override public void onInitialize() { register(); }
}
`,
    [`${source}/entity/${names.entity}.java`]: `package ${data.packageName}.entity;

import net.minecraft.world.entity.EntityType;
${GOAL_IMPORTS}import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.Mob;
${data.behavior === "hostile" ? "import net.minecraft.world.entity.monster.Enemy;\n" : ""}import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.AgeableMob;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.Level;
${attack || runtime?.explosion ? "import net.minecraft.world.entity.Entity;\n" : ""}${clipDeath ? "import net.minecraft.world.entity.EntityEvent;\n" : ""}${data.gameplayGoals || abilityGameplay ? `import ${data.packageName}.gameplay.${GAMEPLAY_API.package}.${GAMEPLAY_API.content};\n` : ""}${lures.length && !deathDrop ? "import net.minecraft.world.item.ItemStack;\n" : ""}${deathDrop ? `import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.tags.DamageTypeTags;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.GameRules;
` : ""}
${runtimeEntityImports}
${ownNbt ? "import net.minecraft.nbt.CompoundTag;\n" : ""}${ownTracker ? "import net.minecraft.network.syncher.SynchedEntityData;\n" : ""}${steady ? "import net.minecraft.util.Mth;\nimport net.minecraft.world.entity.ai.control.BodyRotationControl;\nimport net.minecraft.world.entity.ai.control.MoveControl;\nimport net.minecraft.world.entity.ai.control.LookControl;\n" : ""}${soundImports}${abilities.imports}${engageSource.imports}${bossSource.imports}${flightSource.imports}${habitSource.imports}import software.bernie.geckolib.animatable.GeoEntity;
import software.bernie.geckolib.animatable.instance.AnimatableInstanceCache;
import software.bernie.geckolib.animation.AnimatableManager;
import software.bernie.geckolib.animation.Animation;
import software.bernie.geckolib.animation.AnimationController;
import software.bernie.geckolib.animation.PlayState;
import software.bernie.geckolib.animation.RawAnimation;
import software.bernie.geckolib.util.GeckoLibUtil;

public class ${names.entity} extends AgeableMob implements GeoEntity${data.behavior === "hostile" ? ", Enemy" : ""}${parts.implements}${flightSource.implements}${thrower?.implements ?? ""}${playable.length ? `, ${GAMEPLAY_API.content}.${GAMEPLAY_API.actor}` : ""} {
    private final AnimatableInstanceCache animations = GeckoLibUtil.createInstanceCache(this);
${logic.fields}
${runtimeFields}
${engageSource.fields}${abilities.fields}${standaloneLook?.fields ?? ""}${thrower?.fields ?? ""}${parts.fields}${stuck?.fields ?? ""}${sightJava.fields}${bossSource.fields}${!boss ? showSource?.fields ?? "" : ""}${flightSource.fields}${habitSource.fields}    private static final RawAnimation IDLE = RawAnimation.begin().then("animation.${data.id}.idle", Animation.LoopType.${data.model.animations.find((animation) => animation.name === "idle")!.loop ? "LOOP" : "PLAY_ONCE"});
    private static final RawAnimation WALK = RawAnimation.begin().then("animation.${data.id}.walk", Animation.LoopType.${data.model.animations.find((animation) => animation.name === "walk")!.loop ? "LOOP" : "PLAY_ONCE"});
    private static final RawAnimation HURT = RawAnimation.begin().then("animation.${data.id}.hurt", Animation.LoopType.${hurt.loop ? "LOOP" : "PLAY_ONCE"});
${death ? `    private static final RawAnimation DEATH = RawAnimation.begin().thenPlayAndHold("animation.${data.id}.death");\n${clipDeath ? `    private static final int DEATH_DURATION = ${deathTicks(death.length)};\n` : ""}` : clipDeath ? `    private static final int DEATH_DURATION = 20;\n` : ""}${attack ? `    private static final RawAnimation ATTACK = RawAnimation.begin().thenPlay("animation.${data.id}.attack");\n` : ""}    private int lastHurtTime;
    private boolean playingHurt;
    private double hurtLoopStopTick;
    // Moving is what the eye sees move: the game's own limb amount (four times the blocks covered each tick, eased), not a velocity floor.
    private static final float MOVING_AMOUNT = ${Number(PACE.amount.toFixed(4))}f;
    // Blocks a second at which the walk's touching parts hold the ground (0: nothing to hold it to, played as written), and the most times its own speed it is played at.
    private static final double WALK_SPEED = ${pace.speed};
    private static final double WALK_MOST = ${pace.most};
    private double walkRate = 1.0;

    public ${names.entity}(EntityType<? extends ${names.entity}> type, Level world) { super(type, world);${steady ? " moveControl = new SteadyMove(); lookControl = new SteadyLook();" : ""}${data.experience ? ` xpReward = ${data.experience};` : ""} }

    public static AttributeSupplier.Builder attributes() {
        return Mob.createMobAttributes()
            .add(Attributes.MAX_HEALTH, ${data.health})
            .add(Attributes.MOVEMENT_SPEED, ${walkSpeed})
${data.stationary ? "            // It keeps its place: a blow does not push it off it.\n            .add(Attributes.KNOCKBACK_RESISTANCE, 1.0)\n" : ""}            .add(Attributes.ATTACK_DAMAGE, ${data.attack_damage})
${step}            ${runtimeArmor}
            .add(Attributes.FOLLOW_RANGE, ${reachText});
    }

${abilities.tracker || bossSource.trackerMethod || ownTracker}${steadyControls(steady, names.entity, [abilityList.length ? "abilityRunning()" : "", stance?.hold ? "stanceChanging()" : "", shownElse].filter(Boolean).join(" || "), Boolean(flight), "alignBeforeStart" in abilities, stance?.hold ? "stanceCanWalk()" : "")}${steadyFocus(steady, abilityList.length > 0, engage === "provoked", warned)}${engageSource.methods}${abilities.methods}${standaloneLook?.methods ?? ""}${!boss ? showSource?.methods ?? "" : ""}${thrower?.methods ?? ""}${abilities.goal}${parts.methods}${stuck?.goal ?? ""}${bossSource.methods}${bossSource.nbtMethods}${ownNbt}${flightSource.methods}${habitSource.methods}${habitSource.goals}${wander}${sightJava.methods}${logic.method}${stance?.hold ? `
    @Override public void travel(net.minecraft.world.phys.Vec3 input) {
        if (!stanceCanWalk()) {
            getNavigation().stop();
            setJumping(false);
            super.travel(net.minecraft.world.phys.Vec3.ZERO);
            return;
        }
        super.travel(input);
    }
${!boss && !data.stagger ? "\n    @Override protected boolean isImmobile() { return super.isImmobile() || stanceChanging(); }\n" : ""}` : ""}
${runtimeMethods}
${deathDrop ? `
    @Override protected void dropFromLootTable(DamageSource source, boolean causedByPlayer) {
        super.dropFromLootTable(source, causedByPlayer);
        if (level().isClientSide() || !level().getGameRules().getBoolean(GameRules.RULE_DOMOBLOOT)
                || !(source.getEntity() instanceof ServerPlayer)
                || source.is(DamageTypeTags.IS_EXPLOSION)) return;
        if (getRandom().nextDouble() < ${deathDrop.chance})
            spawnAtLocation(new ItemStack(BuiltInRegistries.ITEM.get(ResourceLocation.fromNamespaceAndPath("${data.modId}", "${deathDrop.block_identifier}")), 1));
    }
` : ""}

${
  runtime
    ? `    @Override public void tick() {
        super.tick();${logic.tick ? `\n        ${logic.tick}` : ""}${boss ? `\n        ${bossSource.tick}` : ""}${habits ? `\n        ${habitSource.tick}` : ""}${flight ? `\n        ${flightSource.tick}` : ""}
        tickRuntime();${earlyEmit}${abilities.tick ? `\n        ${abilities.tick}` : ""}${steadyEnd}${stance?.hold ? "\n        if (!level().isClientSide()) stanceHoldFacing();" : ""}
    }

`
    : emitTick || abilities.tick || boss || flight || habits || steady
      ? `    @Override public void tick() {
        super.tick();${logic.tick ? `\n        ${logic.tick}` : ""}${boss ? `\n        ${bossSource.tick}` : ""}${habits ? `\n        ${habitSource.tick}` : ""}${flight ? `\n        ${flightSource.tick}` : ""}${earlyEmit}${abilities.tick ? `\n        ${abilities.tick}` : ""}${steadyEnd}${stance?.hold ? "\n        if (!level().isClientSide()) stanceHoldFacing();" : ""}
    }

`
      : ""
}

${
  attack
    ? `    @Override public boolean doHurtTarget(Entity target) {
        // Every swing shows, whoever asked for it: one of its own goals or gameplay code.
        if (!level().isClientSide()) triggerAnim("attack", "attack");
        return super.doHurtTarget(target);
    }

`
    : ""
}${
  data.builtin?.death_poof?.particle
    ? `    @Override public void handleEntityEvent(byte id) {
        // The puff of 20 the game itself shows where a dead body goes (EntityEvent.POOF, LivingEntity.makePoofParticles): its builtin table turns it off or swaps it.
        if (id != net.minecraft.world.entity.EntityEvent.POOF) {
            super.handleEntityEvent(id);
            return;
        }
${
  data.builtin.death_poof.particle === "none"
    ? ""
    : `        var puff = ${builtinParticle(true, "this", "death_poof", "net.minecraft.core.particles.ParticleTypes.POOF")};
        for (int i = 0; i < 20; i++)
            level().addParticle(puff, getRandomX(1.0), getRandomY(), getRandomZ(1.0), getRandom().nextGaussian() * 0.02, getRandom().nextGaussian() * 0.02, getRandom().nextGaussian() * 0.02);
`
}    }

`
    : ""
}${
  clipDeath
    ? `    @Override protected void tickDeath() {
        // The death motion plays to its end before the body goes; vanilla allows one second.${flight ? " A flier killed in the air goes once it is down." : ""}
        if (++deathTime >= DEATH_DURATION${flight ? " && flightFallen(DEATH_DURATION)" : ""} && !level().isClientSide() && !isRemoved()) {
            level().broadcastEntityEvent(this, EntityEvent.POOF);
            remove(RemovalReason.KILLED);
        }
    }

`
    : ""
}${
  // Only what the world keeps bringing back may be taken away again: a hostile creature with a natural spawn comes and goes like the game's own
  // monsters. Every other one was put there by someone (an egg, a command, gameplay code, a peaceful herd) and stays, like the game's animals:
  // a mob that is neither is removed once no player is within 128 blocks, and at random from 32 (`MobEntity.checkDespawn`).
  data.behavior === "hostile" && runtime?.spawn && !bossSource.despawnKept
    ? ""
    : `    @Override public boolean requiresCustomPersistence() { return true; }

`
}${soundMethods}${lureMembers}${target.version.creature.babyMembers(names.entity)}    @Override protected void registerGoals() {
        goalSelector.addGoal(0, new FloatGoal(this));${habitSource.before}
        ${!runtime && data.behavior === "follow" ? `goalSelector.addGoal(1, new TemptGoal(this, 1.2, ${lures.length ? `${names.entity}::isLure` : "Ingredient.of(Items.WHEAT)"}, false));` : ""}
        ${
          !runtime && data.behavior === "hostile"
            ? `goalSelector.addGoal(1, new ${abilities.goal ? "AbilityGoal()" : "MeleeAttackGoal(this, 1.2, true)"});${engage ? "" : `
        targetSelector.addGoal(1, new NearestAttackableTargetGoal<>(this, Player.class, true));`}`
            : ""
        }
        ${runtime ? "goalSelector.addGoal(1, new RuntimeMovementGoal());" : ""}${engage && engage !== "none_by_itself" ? "\n        targetSelector.addGoal(1, new EngageTargetGoal());" : ""}${habitSource.after}
        ${data.stationary ? "// Stays where it is on purpose: no roaming." : `goalSelector.addGoal(5, new ${wander ? "GroundWanderGoal" : "WaterAvoidingRandomStrollGoal"}(this, 1.0));`}${steady?.idle_look === "none" ? "" : "\n        goalSelector.addGoal(6, new LookAtPlayerGoal(this, Player.class, 8.0f));"}${steady && steady.idle_look !== "around" ? "" : "\n        goalSelector.addGoal(7, new RandomLookAroundGoal(this));"}${data.gameplayGoals ? `\n        // What this mod's gameplay code adds to this kind of creature, beside the goals above.\n        ${GAMEPLAY_API.content}.applyGoals(this, goalSelector, targetSelector);` : ""}${stuck?.register ?? ""}
    }

    @Override public void registerControllers(AnimatableManager.ControllerRegistrar controllers) {
        controllers.add(new PacedController(state -> {
            walkRate = 1.0;
            ${death ? "if (isDeadOrDying()) return PlayState.STOP;\n            " : ""}${shownBy ? `if (${shownBy}) return PlayState.STOP;\n            ` : ""}${flightSource.movement}float amount = state.getLimbSwingAmount();
            if (amount < MOVING_AMOUNT${stance?.hold ? " || !stanceCanWalk()" : ""}) return state.setAndContinue(${stance?.motion ? "stanceMotion(false, IDLE)" : "IDLE"});
            // The limb amount is four times the blocks a tick: times five is blocks a second.
            if (WALK_SPEED > 0) walkRate = Math.min(amount * 5.0 / WALK_SPEED, WALK_MOST);
            return state.setAndContinue(${stance?.motion ? "stanceMotion(true, WALK)" : "WALK"});
        }));
        controllers.add(new AnimationController<>(this, "hurt", 0, state -> {${death ? "\n            // Dying takes over from flinching.\n            if (isDeadOrDying()) return PlayState.STOP;" : ""}
${staggerList(data.stagger).some(row => row.clip === "hurt") ? `            if (${staggerList(data.stagger).flatMap((row, index) => row.clip === "hurt" ? ["combatStagger() == " + index] : []).join(" || ")}) {
                lastHurtTime = hurtTime;
                playingHurt = false;
                return PlayState.STOP;
            }
` : ""}            if (hurtTime > lastHurtTime) {
                lastHurtTime = hurtTime;
                playingHurt = true;
                hurtLoopStopTick = tickCount + Math.ceil(hurtTime / ${hurtTicks}) * ${hurtTicks};
                state.getController().forceAnimationReset();
                return state.setAndContinue(HURT);
            }
            lastHurtTime = hurtTime;
            if (!playingHurt) return PlayState.STOP;
            if (${hurt.loop ? "hurtTime == 0 && tickCount >= hurtLoopStopTick" : "state.getController().hasAnimationFinished()"}) {
                playingHurt = false;
                return PlayState.STOP;
            }
            return state.setAndContinue(HURT);
        }));
${death ? `        controllers.add(new AnimationController<>(this, "death", 0, state -> isDeadOrDying()${showSource?.clips.death ? " && bossShowClipStep() < 0" : ""} ? state.setAndContinue(DEATH) : PlayState.STOP));\n` : ""}${attack ? `        // Started from the server on each swing (tryAttack above), so every player near sees it at once.\n        controllers.add(new AnimationController<>(this, "attack", 0, state -> PlayState.STOP).triggerableAnim("attack", ATTACK));\n` : ""}${abilities.controller}${stance?.controller ?? ""}${bossSource.controller}${habitSource.controller}${logicController}${motionController}
    }

    @Override public AnimatableInstanceCache getAnimatableInstanceCache() { return animations; }${motionMethod}

    /**
     * The controller that idles and walks. It plays the walk at the rate the body is really carried at, so
     * the parts on the ground hold it at every pace. GeckoLib's own speed is a factor on the whole time
     * since the clip began, which jumps whenever the factor changes; this one adds each frame's share.
     */
    private final class PacedController extends AnimationController<${names.entity}> {
        private double played;
        private double last;

        PacedController(AnimationController.AnimationStateHandler<${names.entity}> handler) { super(${names.entity}.this, "movement", ${movementBlend}, handler); }

        @Override protected double adjustTick(double tick) {
            if (this.shouldResetTick) {
                played = 0;
                last = tick;
                return super.adjustTick(tick);
            }
            // Only a clip that is running is paced: a blend between two clips takes the ticks it was given.
            played += (getAnimationState() == State.RUNNING ? walkRate : 1.0) * Math.max(tick - last, 0);
            last = tick;
            return played;
        }
    }
}
`,
    [`${source}/client/${names.client}.java`]: `package ${data.packageName}.client;

import ${data.packageName}.${names.content};
import ${data.packageName}.entity.${names.entity};
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;

public final class ${names.client} implements ClientModInitializer {
    public static void register() {
        EntityRendererRegistry.register(${names.content}.CREATURE, ${names.renderer}::new);
    }
    @Override public void onInitializeClient() { register(); }
}
`,
    [`${source}/client/${names.renderer}.java`]: `package ${data.packageName}.client;

import ${data.packageName}.entity.${names.entity};
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.resources.ResourceLocation;
import software.bernie.geckolib.model.GeoModel;
import software.bernie.geckolib.renderer.GeoEntityRenderer;
${data.glow && !lookGlowsOwn ? "import software.bernie.geckolib.renderer.layer.AutoGlowingGeoLayer;\n" : ""}${flightSource.rendererImports}${trailsDrawn?.imports ?? ""}${pose?.imports ?? ""}
public final class ${names.renderer} extends GeoEntityRenderer<${names.entity}> {
${lookTextures?.field ?? ""}    public ${names.renderer}(EntityRendererProvider.Context context) {
        super(context, new GeoModel<${names.entity}> () {
            @Override public ResourceLocation getModelResource(${names.entity} creature) {
                return ResourceLocation.fromNamespaceAndPath("${data.modId}", "geo/${data.id}.geo.json");
            }
            @Override public ResourceLocation getTextureResource(${names.entity} creature) {
                return ${lookTextures?.texture ?? `ResourceLocation.fromNamespaceAndPath("${data.modId}", "textures/entity/${data.id}.png")`};
            }
            @Override public ResourceLocation getAnimationResource(${names.entity} creature) {
                return ResourceLocation.fromNamespaceAndPath("${data.modId}", "animations/${data.id}.animation.json");
            }
${pose?.hook ?? ""}        });
        this.shadowRadius = ${shadow}f;${data.glow && !lookGlowsOwn ? "\n        // Draws the texels of textures/entity/" + data.id + "_glowmask.png at full brightness, whatever the light around.\n        addRenderLayer(" + (fogGlow ? "new StudioArenaClient.Glow<>(this)" : "new AutoGlowingGeoLayer<>(this)") + ");" : ""}${lookRendererLayer}${showRendererLayer}
    }
${target.version.creature.rendererShadow(names.entity)}${death || showSource?.clips.death ? `\n    // ${death ? "The model's own death motion is what shows" : "Its death show's motions (Boss 能力 15) are what show"}; the vanilla tip-over would be added on top of it.\n    @Override protected float getDeathMaxRotation(${names.entity} creature) { return 0f; }\n` : ""}${flightSource.renderer(names.entity)}${trailsDrawn?.members ?? ""}${pose?.members ?? ""}${lookRendererRender}}
`,
  }
  // The abilities, the boss, the flight and the habits bring the imports they need beside the ones the rest of the class already has: of the game's classes each once and only the ones the class uses;
  // every other line once only where the boss, the flight or the habits brought theirs (a class without them keeps what it always wrote, a second java.util import included).
  // A runtime block's armour is a `var` of the game's AttributeInstance, and an explosion goes over a `var` of its Entity: Loom's remapper imports both, so they are kept too.
  const key = `${source}/entity/${names.entity}.java`
  if (partCombat) files[key] = partCombat.hurt(String(files[key]))
  files[key] = tidyImports(String(files[key]), [...(runtime ? ["AttributeInstance"] : []), ...(runtime?.explosion ? ["Entity"] : [])], Boolean(boss || flight || habits))
  if (!target.loader.facade) return files
  return platformCreature(files, target, {
    modId: data.modId,
    packageName: data.packageName,
    id: data.id,
    names,
    category: data.behavior === "hostile" ? "monster" : "creature",
    size: { width: core.width, height: core.height, tracking: visible.chunks },
    egg: [egg[0]!, egg[1]!],
    spawn: runtime?.spawn ? { rule: spawnRule, spawn: runtime.spawn, cap: `${nearHelper}${momentHelper}${capHelperOf("CREATURE.get()")}`, dark: spawnDark, hostile: data.behavior === "hostile" } : null,
    // A boss's lair registers its structure type and piece with the creature (once for the mod, whichever lair comes first).
    ...(lair || summon ? { register: [...(lair ? [`${LAIR_CLASS}.register();`] : []), ...(summon ? [summonCall(data.modId, data.id, summon)] : [])] } : {}),
    // C 组: its eyes and its step (each where the version takes it), and a flier's position sent every tick, as the Fabric type above has them.
    body: { eye: typeof data.hitbox?.core.eye_height === "number" ? data.hitbox.core.eye_height : null, step: typeof data.hitbox?.core.step === "number" ? data.hitbox.core.step : null, everyTick: Boolean(flight) },
  })
}

/**
 * The imports of a generated class put together from pieces, each piece bringing what it may need: of the game's classes (`net.minecraft.`) each once and only
 * those the class names outside comments and strings, or that `keep` names. Others (Java's own, GeckoLib, the mod's) stay as written, each once when `everyOnce`.
 */
function tidyImports(source: string, keep: readonly string[], everyOnce: boolean) {
  const lines = source.split("\n")
  const code = lines
    .filter((line) => !line.startsWith("import "))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, " ")
  const seen = new Set<string>()
  return lines
    .filter((line) => {
      if (!line.startsWith("import ")) return true
      const game = /^import net\.minecraft\.[\w.]*\.(\w+);$/.exec(line)
      if (game || everyOnce) {
        if (seen.has(line)) return false
        seen.add(line)
      }
      return !game || keep.includes(game[1]!) || new RegExp(`\\b${game[1]}\\b`).test(code)
    })
    .join("\n")
}
