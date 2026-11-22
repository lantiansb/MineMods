import { SoundRangeSchema, SoundVolumeSchema } from "./sound-range"
import { landingTick, earlyLanding } from "./hit-origin"
import { onceFields, onceIssues } from "./once-group"
import { z } from "zod"
import { BuiltinSchema } from "./builtin"
import { extendedEmit, ScatterFields, TimedScatter, ParticleOrigin, emitIssues, EmittersSchema, emitterPhaseIssues, ParticleRefSchema, ParticleAliasesSchema, aliasIssues } from "./particle-emission"
import { CameraShape, SkyTintShape, CameraSchema, SkyTintSchema, DebrisThrowSchema, CinematicTimeSchema } from "./cinematic"
import { DeathDropSchema } from "./lucky-cache"
export { DeathDropSchema } from "./lucky-cache"
import { CREATURE_SOUND_IDS, EnglishNameSchema } from "./data-words"
import { RegistryNameSchema } from "./registry-name"
import { HomingSchema } from "./common/guided-flight"
import { ToneSchema, PitchVariationSchema, SoundAssetRefSchema } from "./sound"
import { VANILLA_BLOCK_IDS, VANILLA_ITEM_NAMES } from "./fabric/content-vanilla"
import { ABILITY_EFFECT_IDS, ABILITY_LIMITS, COMBO_LIMITS, TICKS, comboTimeline, ABILITY_PROJECTILES, ABILITY_PROJECTILE_IDS, ABILITY_SOUND_IDS, EFFECT_LIMITS, EFFECT_SIZE, RESERVED_CLIPS } from "./ability-words"
import { BOSS_BAR_COLOR_IDS, BOSS_BAR_STYLE_IDS, BOSS_LIMITS, BOSS_LOOK_LIMITS, BREAK_LIMITS, DEBRIS_LIMITS, LAIR_LIMITS, SUMMON_LIMITS, SHAKE_LIMITS, bossFirstPhaseIds, bossPhaseIssues } from "./boss-words"
import { ABILITY_WHERE_IDS, FLIGHT_LIMITS, FLIGHT_STYLE_IDS, HABIT_ACTIVE_IDS, HABIT_LIMITS, VANILLA_PREY, VANILLA_PREY_IDS } from "./flight-words"
import { BasicWarnSchema, HitWarnSchema } from "./warning-schema"
import { HIT_PLACE_LIMITS, TRAIL_LIMITS } from "./ability-words"
import { AbilityMoveSchema, HitForceSchema, dashForceIssues, isPush } from "./ability-dash"
import { SteadySchema, steadyDocumentIssues } from "./creature-steady"
import { CombatCreatureShape, CombatAbilityShape, usesCombat, combatIssues, InterruptSchema, CombatStartShape, GuardSchema, StanceIdSchema, StanceActionSchema, StanceWhenSchema } from "./combat"
import { stanceDocumentIssues } from "./stances"
import { AbilityStagesShape, AbilityTrackShape, BetweenSchema, ComboBranchesShape, TacticsSchema, comboBranchIssues, tacticsAbilityIssues, tacticsDocumentIssues } from "./ability-tactics"
import { EPIC_LIMITS } from "./ability-words"
import { LIGHTNING_LIMITS, WEATHER_LIMITS } from "./weather-words"
import { PROJECTILE_BACK_MAX, PROJECTILE_LIMITS, PROJECTILE_PATH_IDS } from "./projectile-words"
import { projectileCount, projectileReturns, projectileRules } from "./projectile-rules"
import { fixtureIssues } from "./fixture-checks"
import { FixtureActionSchema } from "./fixture-events"
import { ARENA_LIMITS, ArenaSafeSchema, ArenaSchema, ArenaShapeSchema, FogEventSchema, arenaDocumentIssues } from "./arena"
import { OnHurtSchema, parryDocumentIssues, parryIssues } from "./ability-parry"
import { bossShowDocumentIssues, bossShowStepsSchema } from "./boss-show"
import { hitboxCombatIssues } from "./hitbox-combat"
import { BossBaseShape, bossBaseIssues } from "./boss-base"
import { TerrainRiseEventSchema, BlockSwapEventSchema, isTerrainEvent, terrainIssues } from "./terrain"
import { expandFeedback } from "./hit-feedback"
import { FlashEventSchema, BeamEventSchema, CrackEventSchema, GroundImpactSchema, HazardEventSchema, ShockwaveEventSchema, groundFxIssues } from "./ground-fx"
import { AbilityScaleSchema } from "./ability-scale"

/** Vanilla biome identifiers shipped by Minecraft/Fabric 1.21.1. */
export const VanillaBiomeIdSchema = z.enum([
  "minecraft:badlands",
  "minecraft:bamboo_jungle",
  "minecraft:basalt_deltas",
  "minecraft:beach",
  "minecraft:birch_forest",
  "minecraft:cherry_grove",
  "minecraft:cold_ocean",
  "minecraft:crimson_forest",
  "minecraft:dark_forest",
  "minecraft:deep_cold_ocean",
  "minecraft:deep_dark",
  "minecraft:deep_frozen_ocean",
  "minecraft:deep_lukewarm_ocean",
  "minecraft:deep_ocean",
  "minecraft:desert",
  "minecraft:dripstone_caves",
  "minecraft:end_barrens",
  "minecraft:end_highlands",
  "minecraft:end_midlands",
  "minecraft:eroded_badlands",
  "minecraft:flower_forest",
  "minecraft:forest",
  "minecraft:frozen_ocean",
  "minecraft:frozen_peaks",
  "minecraft:frozen_river",
  "minecraft:grove",
  "minecraft:ice_spikes",
  "minecraft:jagged_peaks",
  "minecraft:jungle",
  "minecraft:lukewarm_ocean",
  "minecraft:lush_caves",
  "minecraft:mangrove_swamp",
  "minecraft:meadow",
  "minecraft:mushroom_fields",
  "minecraft:nether_wastes",
  "minecraft:ocean",
  "minecraft:old_growth_birch_forest",
  "minecraft:old_growth_pine_taiga",
  "minecraft:old_growth_spruce_taiga",
  "minecraft:plains",
  "minecraft:river",
  "minecraft:savanna",
  "minecraft:savanna_plateau",
  "minecraft:small_end_islands",
  "minecraft:snowy_beach",
  "minecraft:snowy_plains",
  "minecraft:snowy_slopes",
  "minecraft:snowy_taiga",
  "minecraft:soul_sand_valley",
  "minecraft:sparse_jungle",
  "minecraft:stony_peaks",
  "minecraft:stony_shore",
  "minecraft:sunflower_plains",
  "minecraft:swamp",
  "minecraft:taiga",
  "minecraft:the_end",
  "minecraft:the_void",
  "minecraft:warm_ocean",
  "minecraft:warped_forest",
  "minecraft:windswept_forest",
  "minecraft:windswept_gravelly_hills",
  "minecraft:windswept_hills",
  "minecraft:windswept_savanna",
  "minecraft:wooded_badlands",
])

/**
 * Vanilla biome tags a creature's natural spawning may name instead of listing biomes one by one
 * (`minecraft:<tag>` in the game). The names are the 1.21.1 `BiomeTags` constants that group biomes by
 * place; the tags that only steer structures or one vanilla animal are left out.
 */
export const SPAWN_BIOME_TAGS = ["is_overworld", "is_nether", "is_end", "is_forest", "is_taiga", "is_jungle", "is_savanna", "is_badlands", "is_mountain", "is_hill", "is_beach", "is_river", "is_ocean", "is_deep_ocean"] as const
export const SpawnBiomeTagSchema = z.enum(SPAWN_BIOME_TAGS)

/**
 * The biomes a creature's natural spawning and a boss's lair share: biomes one by one (`biomes`) and groups of biomes by vanilla tag (`tags`), at least one of the two,
 * each at most once. `none` and `duplicate` say what is wrong in the words of the one that asks.
 */
const BiomeChoiceShape = {
  biomes: z.array(VanillaBiomeIdSchema).max(64),
  /** Added later: groups of biomes by vanilla tag. Absent in older projects, which list biomes only. */
  tags: z.array(SpawnBiomeTagSchema).min(1).max(SPAWN_BIOME_TAGS.length).optional(),
}
const biomeChoiceIssues = (choice: { biomes: readonly string[]; tags?: readonly string[] | undefined }, context: z.RefinementCtx, none: string, duplicate: string) => {
  if (!choice.biomes.length && !choice.tags?.length) context.addIssue({ code: "custom", path: ["biomes"], message: none })
  if (new Set(choice.biomes).size !== choice.biomes.length) context.addIssue({ code: "custom", path: ["biomes"], message: duplicate })
  if (choice.tags && new Set(choice.tags).size !== choice.tags.length) context.addIssue({ code: "custom", path: ["tags"], message: "同一组群系不要重复写" })
}
/** How many blocks above the world's sea level the ground must be, for a spawn and for a lair alike; the overworld builds up to 320, 257 above the sea, so 256 is the highest that anything can be asked for. */
const AboveSeaSchema = z.number().int().min(1).max(256)

/**
 * The bounds of a creature's population cap (`spawn.cap`): at most `count` of the creature within `radius` blocks of a spot where another would appear.
 * - count 1–64: a cap of 0 is "never spawns" (write `spawn: null`); past 64 in one neighbourhood is far beyond what the game keeps spawning (its own creature limit is 10 for a player's surroundings), so a larger number could never take effect.
 * - radius 4–64: the check lists the creatures in a box around the spot on every natural spawn attempt, and a box costs by the chunk columns it touches (at 64 blocks: at most 9 x 9 of them, one range lookup each),
 *   so 64 is what stays cheap; a neighbourhood wider than that is not a habitat but half a player's view. Below 4 blocks it is no cap on a population, only the spacing of two bodies.
 */
export const SPAWN_CAP_LIMITS = { count: { min: 1, max: 64 }, radius: { min: 4, max: 64 } } as const

/**
 * The structures of Minecraft 1.21.1 (`data/minecraft/worldgen/structure/*.json` of its jar) a creature may keep to by name. Forge 1.20.1 has all of them but `trial_chambers`,
 * which it does not know: a creature kept to that one never spawns there (`STRUCTURE_NOT_IN_1_20_1`).
 */
export const VANILLA_STRUCTURE_IDS = new Set([
  "ancient_city", "bastion_remnant", "buried_treasure", "desert_pyramid", "end_city", "fortress", "igloo", "jungle_pyramid", "mansion", "mineshaft", "mineshaft_mesa", "monument",
  "nether_fossil", "ocean_ruin_cold", "ocean_ruin_warm", "pillager_outpost", "ruined_portal", "ruined_portal_desert", "ruined_portal_jungle", "ruined_portal_mountain", "ruined_portal_nether",
  "ruined_portal_ocean", "ruined_portal_swamp", "shipwreck", "shipwreck_beached", "stronghold", "swamp_hut", "trail_ruins", "trial_chambers", "village_desert", "village_plains",
  "village_savanna", "village_snowy", "village_taiga",
])
export const STRUCTURE_NOT_IN_1_20_1 = new Set(["trial_chambers"])

/**
 * Where a creature keeps to (`spawn.near`, `garrison`): a structure by the name the game gives it, `minecraft:village_plains` or another mod's `其他模组:名字` (one that is not
 * installed matches nothing), or `{ lair }`, the lair of a boss of this project, by that boss creature's id. Kept an object so that a structure asset of the project
 * (`{ asset }`, a saved .nbt structure, not made yet) can be added beside it without a change to what is written today.
 */
const StructureNameSchema = z
  .string()
  .regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/, "结构写成 命名空间:名字（原版的是 minecraft:village_plains 这样；别的模组的写那个模组的 id:结构名），本工程 Boss 的巢写成 {\"lair\": \"那只 Boss 的编号\"}")
  .superRefine((name, context) => {
    const [space, id] = name.split(":") as [string, string]
    if (space === "minecraft" && !VANILLA_STRUCTURE_IDS.has(id)) context.addIssue({ code: "custom", message: `Minecraft 1.21.1 里没有 ${name} 这个结构。原版结构有：${[...VANILLA_STRUCTURE_IDS].map((value) => `minecraft:${value}`).join("、")}` })
  })
export const StructureRefSchema = z.union([StructureNameSchema, z.strictObject({ lair: z.uuid() })])
export type StructureRef = z.infer<typeof StructureRefSchema>

/**
 * The bounds of `spawn.near` and `garrison`, each with its reason.
 * - distance 0–32 blocks around the structure's box: the spawn rule looks for the structure in the chunks within that distance of the spot (at 32, five by five of them), on every
 *   natural spawn attempt that passed the cheaper checks; further than that is no longer "by the structure" but the land around it, which biomes already say.
 * - structures 1–8: a village is five structures (one for each kind of village), and a list longer than a few is a biome, not a place.
 * - guards 1–8 of one kind on one lair: they stand on its platform, the smallest of which (radius 3) has room for about that many.
 */
export const NEAR_LIMITS = { distance: { min: 0, max: 32 }, structures: 8, guards: { min: 1, max: 8 } } as const

/**
 * Added later (r29): it only turns up by a structure: inside the structure's box or within `distance` blocks of it, measured along the ground; on top of the biomes, light
 * and the rest of `spawn`, which still say where it may be at all. Absent: anywhere its biomes are, as it always was.
 */
export const SpawnNearSchema = z.strictObject({
  structures: z.array(StructureRefSchema).min(1).max(NEAR_LIMITS.structures),
  distance: z.number().int().min(NEAR_LIMITS.distance.min).max(NEAR_LIMITS.distance.max),
})
export type SpawnNear = z.infer<typeof SpawnNearSchema>

/**
 * Added later (r29): it is put in a structure when the world makes it, `min`–`max` of it in each, and kept (it never despawns; one that is killed is not put back).
 * `structure` is the lair of a boss of this project (`{ lair }`): the guards stand on its platform round the boss. A structure of the game or of another mod cannot
 * be given creatures as it is made (their pieces are not ours), so those are kept to with `spawn.near` instead. Absent or null: none, as it always was.
 */
export const GarrisonSchema = z
  .strictObject({
    structure: z.strictObject({ lair: z.uuid() }, { error: "跟着结构一起放（garrison）现在只能放进本工程 Boss 的巢：写 {\"lair\": \"那只 Boss 的编号\"}。原版或别的模组的结构请用 spawn.near（在结构附近自然刷）" }),
    min: z.number().int().min(NEAR_LIMITS.guards.min).max(NEAR_LIMITS.guards.max),
    max: z.number().int().min(NEAR_LIMITS.guards.min).max(NEAR_LIMITS.guards.max),
  })
  .superRefine((garrison, context) => {
    if (garrison.min > garrison.max) context.addIssue({ code: "custom", path: ["max"], message: "每座最多几只（max）不能比最少几只（min）小" })
  })
export type Garrison = z.infer<typeof GarrisonSchema>

/**
 * r29 (第 2 件): how much more or less often a natural spawn takes it by the time of day and by the weather, each 0–4 (1 is as usual, 0 never, 2 twice as often); left out: 1.
 * - time: the overworld's clock (the same in every dimension), `dawn` 22200–1000, `day` 1000–12000, `dusk` 12000–13800, `night` 13800–22200 ticks of the day.
 * - weather: the world's (`thunder` is a storm, `rain` rain or snow without thunder), wherever the spot is, a desert too.
 * A spawn the game asks for is let through at the share of the largest product the creature can have: at that moment it is as common as `weight` says, and less at the others.
 * At most 4: a moment rarer than a quarter of the commonest is better written as 0.
 */
export const SPAWN_WHEN_LIMITS = { scale: { min: 0, max: 4 } } as const
export const SPAWN_TIMES = ["dawn", "day", "dusk", "night"] as const
export const SPAWN_WEATHERS = ["clear", "rain", "thunder"] as const
const ScaleSchema = z.number().finite().min(SPAWN_WHEN_LIMITS.scale.min).max(SPAWN_WHEN_LIMITS.scale.max).optional()
const someMoment = (scales: Record<string, number | undefined>, keys: readonly string[]) => keys.some((key) => (scales[key] ?? 1) > 0)
const SpawnTimeSchema = z.strictObject({ dawn: ScaleSchema, day: ScaleSchema, dusk: ScaleSchema, night: ScaleSchema }).refine((time) => someMoment(time, SPAWN_TIMES), "一天里至少要有一个时候不是 0：全写 0 就永远刷不出来（不想让它自己出现，把 spawn 写成 null）")
const SpawnWeatherSchema = z.strictObject({ clear: ScaleSchema, rain: ScaleSchema, thunder: ScaleSchema }).refine((weather) => someMoment(weather, SPAWN_WEATHERS), "晴天、下雨、打雷至少要有一个不是 0：全写 0 就永远刷不出来")
export type SpawnTime = z.infer<typeof SpawnTimeSchema>
export type SpawnWeather = z.infer<typeof SpawnWeatherSchema>

const SpawnSchema = z
  .strictObject({
    ...BiomeChoiceShape,
    /**
     * Added later: at most `count` of this creature within `radius` blocks of the spot (measured along the ground, height ignored: a flier overhead still belongs to the habitat below it).
     * It is checked at every natural spawn, so a group stops growing when the neighbourhood is full. Absent: no cap, as it always was.
     */
    cap: z.strictObject({ count: z.number().int().min(SPAWN_CAP_LIMITS.count.min).max(SPAWN_CAP_LIMITS.count.max), radius: z.number().int().min(SPAWN_CAP_LIMITS.radius.min).max(SPAWN_CAP_LIMITS.radius.max) }).optional(),
    /**
     * Added later: the light it needs. Absent keeps what a creature of its behaviour had before: a
     * hostile one needs darkness the way vanilla monsters do, the others spawn in any light.
     */
    light: z.enum(["dark", "bright", "any"]).optional(),
    /**
     * Added later: it only turns up on ground at least this many blocks above sea level (the world's, 63 in the overworld): a creature of the peaks, not of the plains.
     * Absent: any height, as it always was. The overworld builds up to 320, 257 above the sea, so 256 is the highest that anything can be asked for.
     */
    above_sea: AboveSeaSchema.optional(),
    /** Added later (r29): only by a structure (`SpawnNearSchema`). Absent: anywhere its biomes are, as it always was. */
    near: SpawnNearSchema.optional(),
    /** Added later (r29): more or less often by the time of day (`SPAWN_WHEN_LIMITS`). Absent: all day alike, as it always was. */
    time: SpawnTimeSchema.optional(),
    /** Added later (r29): more or less often by the weather. Absent: in any weather alike, as it always was. */
    weather: SpawnWeatherSchema.optional(),
    weight: z.number().int().min(1).max(1000),
    min: z.number().int().min(1).max(16),
    max: z.number().int().min(1).max(16),
  })
  .superRefine((spawn, context) => {
    biomeChoiceIssues(spawn, context, "自然生成至少要写一个群系（biomes）或者一组群系（tags）", "Spawn biomes must be unique")
    const names = spawn.near?.structures.map((value) => (typeof value === "string" ? value : `lair:${value.lair}`)) ?? []
    if (new Set(names).size !== names.length) context.addIssue({ code: "custom", path: ["near", "structures"], message: "同一个结构不要重复写" })
    if (spawn.min > spawn.max)
      context.addIssue({ code: "custom", path: ["max"], message: "Spawn min must not exceed max" })
  })

const ExplosionEffectSchema = z.strictObject({
  effect: z.enum(["slowness", "blindness", "poison", "weakness"]),
  duration_ticks: z.number().int().min(1).max(2400),
  amplifier: z.number().int().min(0).max(4),
})

const ExplosionSchema = z.strictObject({
  fuse_ticks: z.number().int().min(10).max(200),
  radius: z.number().finite().min(0.5).max(8),
  damage_blocks: z.boolean(),
  effects: z.array(ExplosionEffectSchema).max(16),
})

export const EntityRuntimeSchema = z.strictObject({
  spawn: SpawnSchema.nullable(),
  explosion: ExplosionSchema.nullable(),
  movement: z.enum(["direct", "stalk", "burst", "strafe", "leap", "retreat"]),
  armor: z.number().finite().min(0).max(30),
  charging_armor: z.number().finite().min(0).max(30),
  texture_asset_id: z.uuid().nullable(),
  death_drop: DeathDropSchema.nullable().optional(),
  /** Added later (r29): put in a boss's lair as the world makes it, and kept (`GarrisonSchema`). Absent or null: none, as it always was. */
  garrison: GarrisonSchema.nullable().optional(),
})

export type EntityRuntime = z.infer<typeof EntityRuntimeSchema>

// 任务二 §9: a vanilla id as before, or `{ asset }`, a sound asset of the project (`sound.ts`).
const SoundSchema = z.union([z.enum(CREATURE_SOUND_IDS), SoundAssetRefSchema]).nullable()

/**
 * Vanilla sounds a creature borrows. A moment left null keeps what every mob does by default: no call of
 * its own, the plain hurt and death sounds, and the footstep of whatever block it walks on.
 */
export const CreatureSoundsSchema = z.strictObject({
  range_blocks: SoundRangeSchema.optional(),
  ranges: z.strictObject({ ambient: SoundRangeSchema.optional(), hurt: SoundRangeSchema.optional(), death: SoundRangeSchema.optional(), step: SoundRangeSchema.optional() }).optional(),
  ambient: SoundSchema,
  hurt: SoundSchema,
  death: SoundSchema,
  step: SoundSchema,
  /** Zero scales the interval with standing height. Absent leaves the distance-based footstep alone. */
  step_interval: z.number().finite().min(0).max(30).optional(),
  /** 1 is the sound as recorded; lower is deeper, higher is squeakier. The game still varies each play a little. */
  pitch: z.number().finite().min(0.5).max(2),
  volume: SoundVolumeSchema,
})
export type CreatureSounds = z.infer<typeof CreatureSoundsSchema>

/**
 * `tempt`: the most items a follower is lured by. Four is this project's own choice for the field (the product owner's spec), not the
 * game's: its animals are drawn by one to six items (a cat's fish are two, a pig's food three, a chicken's seeds six: the 1.21.1 `*_food` item
 * tags). A player holds one thing at a time, so the cap bounds a list nobody checks, not what the game can do.
 */
export const CREATURE_LIFE_LIMITS = { loot: 8, experience: 100, boss_experience: 12000, reason: 200, death_seconds: 5, tempt: 4 } as const
/*
 * `experience`: 100 for an ordinary creature, ten times the most any of the game's own ordinary mobs gives (a blaze or a guardian, 10).
 * A boss may give up to 12000, the game's own largest reward for one creature (the ender dragon the first time it falls); the wither
 * gives 50. epic game1: a boss meant to give 300 could not say so, and the case wrote a gameplay rule to add the rest on death.
 */

/** The way a project names an item a creature uses (a drop, a lure): its own item or block by identifier, or a vanilla item written `minecraft:<name>`. */
const ITEM_REFERENCE = /^(?:minecraft:)?[a-z][a-z0-9_]{0,63}$/
/** A vanilla item the game does not have, in words; null when the reference is a project's own or a vanilla item that exists. */
const vanillaItemIssue = (item: string) =>
  item.startsWith("minecraft:") && !(item.slice("minecraft:".length) in VANILLA_ITEM_NAMES) ? `Minecraft 1.21.1 里没有 ${item} 这个物品。核对拼写` : null

/**
 * One thing a creature drops when it dies. `item` is one of this project's items or blocks by its
 * identifier, or a vanilla item written `minecraft:<name>`; which of the project's it is, is checked
 * where the project is known (`creatureLootIssues`).
 */
export const CreatureLootSchema = z
  .strictObject({
    item: z.string().regex(ITEM_REFERENCE, "掉落物写本工程物品或方块的标识符，或者写成 minecraft:名字 的原版物品"),
    min: z.number().int().min(0).max(64),
    max: z.number().int().min(1).max(64),
    /** How often this line drops at all, from just above 0 to 1 (always). */
    chance: z.number().finite().gt(0).max(1),
    /** Drops only when a player dealt the killing blow, the way rare vanilla drops do. */
    player_only: z.boolean(),
    /**
     * Whether Looting adds to it (up to one more per level, as vanilla mob drops). Left out: yes for any creature, no for a boss's drop, whose count is the trophy the request named
     * (epic game1: "掉一颗冰霜龙心" dropped seven under Looting III). Written, it is what is said.
     */
    looting: z.boolean().optional(),
  })
  .superRefine((drop, context) => {
    if (drop.min > drop.max) context.addIssue({ code: "custom", path: ["max"], message: "掉落数量的上限不能比下限小" })
    // A loot table that names an item the game does not have is thrown away whole when the game loads it.
    if (vanillaItemIssue(drop.item)) context.addIssue({ code: "custom", path: ["item"], message: `${vanillaItemIssue(drop.item)}；写错的原版物品会让整张掉落表在游戏里作废` })
  })
export type CreatureLoot = z.infer<typeof CreatureLootSchema>

const CreatureLootListSchema = z.array(CreatureLootSchema).max(CREATURE_LIFE_LIMITS.loot)

/**
 * One item a follower is lured by, written the way a drop names its item. Which of the project's it is, is checked where the
 * project is known (`creatureTemptIssues`).
 */
export const TemptItemSchema = z
  .string()
  .regex(ITEM_REFERENCE, "引诱物写本工程物品或方块的标识符，或者写成 minecraft:名字 的原版物品")
  .superRefine((item, context) => {
    // A name the game does not have would never match what a player holds: the creature would follow nobody.
    const issue = vanillaItemIssue(item)
    if (issue) context.addIssue({ code: "custom", message: `${issue}；写错的原版物品永远不会有玩家拿在手里，它就谁也不跟` })
  })

/** A creature that deliberately stays where it is: no roaming. The reason is shown to the person. */
export const StationarySchema = z.strictObject({ reason: z.string().trim().min(1).max(CREATURE_LIFE_LIMITS.reason) })

// ---- abilities (招式) ----

/** A moment of an ability, in seconds from its start, on the time line of the motion it plays. */
const AbilityTimeSchema = z.number().finite().min(0).max(ABILITY_LIMITS.seconds)
/** A place in the creature's own terms, in blocks: ahead of it, above its feet, to its own left (negative: behind, below, right). */
const ahead = z.number().finite().min(-ABILITY_LIMITS.reach).max(ABILITY_LIMITS.reach)
const size = z.number().finite().min(0.1).max(ABILITY_LIMITS.reach)

/**
 * Where a hit lands, checked on the server at the moment of the hit against where everybody stands right
 * then. All lengths are blocks; the creature's feet are the origin and "ahead" is where it faces.
 * - arc: within `reach` of it, inside `angle` degrees centred ahead (360: all around), between `low` and `high` above its feet. `inner` (left out: 0) hollows it:
 *   nobody wholly within `inner` of its middle is hit, so a full circle with an inner radius is a ring (a shockwave to be jumped or stood inside of).
 * - box: a box `width` (side to side) by `height` by `depth` (front to back), its centre at forward/up/left.
 * - sphere: a ball of `radius`, its centre at forward/up/left.
 * - line: a straight beam from `up` above its feet toward where it aims, `length` long and `radius` thick.
 * - cone: from `up` above its feet toward where it aims, `length` long, opening `angle` degrees.
 * A line and a cone aim (J2): `aim: "target"` (also when left out) points them at the middle of the one it
 * fights, so they tilt up or down with how high that one stands; `aim: "level"` keeps them level, straight
 * ahead the way it faces at `up` above its feet, whatever height its target is at.
 */
const aim = z.enum(["target", "level"]).optional()
export const AbilityShapeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("arc"), reach: size, angle: z.number().finite().min(10).max(360), low: ahead, high: ahead, inner: z.number().finite().min(0).max(ABILITY_LIMITS.reach).optional() }),
  z.strictObject({ type: z.literal("box"), forward: ahead, up: ahead, left: ahead, width: size, height: size, depth: size }),
  z.strictObject({ type: z.literal("sphere"), forward: ahead, up: ahead, left: ahead, radius: size }),
  z.strictObject({ type: z.literal("line"), up: ahead, length: size, radius: z.number().finite().min(0.1).max(4), aim }),
  z.strictObject({ type: z.literal("cone"), up: ahead, length: size, angle: z.number().finite().min(10).max(170), aim }),
  // Boss 能力 13: the whole arena of a boss, round its middle (arena.ts).
  ArenaShapeSchema,
])
export type AbilityShape = z.infer<typeof AbilityShapeSchema>

/** A part of the model by its name, as the model's own bones are named (at most 80 characters, the model's own limit). That the model has it is checked against the model (`abilityIssues`). */
const HitBoneSchema = z.string().trim().min(1).max(80)

/** A gameplay by its slug (`GameplaySlugSchema`), and one of the entries of an ability it registered by name: the same spelling as an ability's id. */
const GameplayRefSchema = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/, "玩法用它的代号（slug）写：小写字母开头，只含小写字母、数字和下划线")
const AbilityActionNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "玩法入口的名字用小写字母开头，只含小写字母、数字和下划线")

const AbilityEffectSchema = z.strictObject({
  particles: z.boolean().optional(),
  effect: z.enum(ABILITY_EFFECT_IDS),
  duration_ticks: z.number().int().min(1).max(2400),
  amplifier: z.number().int().min(0).max(4),
})

/**
 * Where an area hit lands (Boss 能力 3): the place its shape is counted from instead of the creature's feet. Every place is decided by the server alone, once,
 * at the moment the warning begins (`warn`), or at the hit without one; the shape is then checked at exactly those places, turned the way the creature faced then.
 * - "self" (also when left out): its own feet, as every hit always was.
 * - "target": the feet of the one it fights.
 * - around_target: `count` places scattered within `spread` blocks round the feet of the one it fights, by a number the server draws anew for every cast.
 * - pattern: places in the creature's own terms (blocks ahead of its feet and to its own left) as it stands and faces when they are decided.
 * Only a shape that is the same seen from any side of its middle may be put somewhere else (`placeableShape`): a ball, a box, a full circle.
 */
export const FixtureTargetSchema = z.strictObject({ fixture: z.enum(["lit_random", "lit_nearest"]), type: z.never().optional() })
export const HitPlaceSchema = z.union([
  FixtureTargetSchema,
  // Boss 能力 13: "center", the middle of a boss's arena (arena.ts).
  z.enum(["self", "target", "center"]),
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("around_target"), count: z.number().int().min(1).max(HIT_PLACE_LIMITS.count), spread: z.number().finite().min(HIT_PLACE_LIMITS.spread.min).max(HIT_PLACE_LIMITS.spread.max) }),
    z.strictObject({ type: z.literal("pattern"), points: z.array(z.strictObject({ forward: ahead, left: ahead })).min(1).max(HIT_PLACE_LIMITS.points) }),
  ]),
])
export type HitPlace = z.infer<typeof HitPlaceSchema>

/**
 * The warning before an area hit (Boss 能力 3): `seconds` before the hit its places are decided and every player's game near them draws where the hit will land,
 * with the hit's own shape (`look`: a flat outline on the ground, or that and a beam of light from its middle), in one colour of a short list. The hit then lands at
 * exactly those places, whatever has moved since. It starts no earlier than the ability itself (`hit.at - seconds` is 0 or later), and may start while it gets ready.
 */
export { HitWarnSchema } from "./warning-schema"
export type HitWarn = z.infer<typeof HitWarnSchema>

/** How far from its middle an arc is hollow, in blocks (0 for every other shape and an arc without `inner`): nobody wholly within it is hit. */
export const shapeInner = <T extends { type: string; inner?: number }>(shape: T) => (shape.type === "arc" ? (shape.inner ?? 0) : 0)
/** The name the generated Java tells a shape's test by: an arc with a hollow middle is a "ring", tested by its own methods, so every other arc's code stays what it was. */
export const shapeKind = <T extends { type: string; inner?: number }>(shape: T) => (shapeInner(shape) > 0 ? "ring" : shape.type)

/** A shape that is the same seen from any side of its middle, so it can be put down somewhere other than round the creature: a ball, a box, an arc that goes all the way round. A beam and a cone aim from the creature at the one it fights; a part of a circle points the way the creature faces. */
export const placeableShape = (shape: AbilityShape) => shape.type === "sphere" || shape.type === "box" || (shape.type === "arc" && shape.angle >= 360) || shape.type === "arena"
/** The place an area hit lands at, written or not: "self" when it says nothing. */
export const hitPlace = (hit: { place?: HitPlace; shape?: { type: string } }): HitPlace => hit.place ?? (hit.shape?.type === "arena" ? "center" : "self")
/** True for an area hit that lands somewhere other than round the creature itself (`place` other than "self"). */
export const hitElsewhere = (hit: { place?: HitPlace; shape?: { type: string } }) => hitPlace(hit) !== "self"
/** A shape a warning can be drawn for before the hit: anything but a beam and a cone, which aim at where the one it fights is at the moment of the hit and so are not known before it. */
export const warnableShape = (shape: AbilityShape) => shape.type !== "line" && shape.type !== "cone"


/**
 * 落地炸开: what is seen and felt where a thrown thing comes down, at the moment it first strikes (whoever it touches first, or the block it meets: the moment its damage is dealt),
 * wherever that is — the one place an ability's events cannot name, since it is known only then. `effect`: one of this project's effect assets shown there (as an effect event shows it,
 * belonging to nobody); `particle`: a vanilla particle by name or one of this project's particle assets (`{ asset }`, as a particle event names it), `count` of them within `spread` blocks
 * (`PROJECTILE_IMPACT` when left out); `shake`: the screens of the players within `radius` blocks of there shake, as a shake event's. Only seen and felt: it changes nothing it does to anybody.
 * Left out (or null), it comes down as it always did. What may be written with what is `projectileRules`.
 */
export const ProjectileImpactSchema = z.strictObject({
  camera: CameraSchema.optional(),
  sky_tint: SkyTintSchema.optional(),
  effect: z.uuid().optional(),
  particle: ParticleRefSchema.optional(),
  count: z.number().int().min(1).max(64).optional(),
  spread: z.number().finite().min(0).max(4).optional(),
  shake: z
    .strictObject({
      strength: z.number().finite().min(SHAKE_LIMITS.strength.min).max(SHAKE_LIMITS.strength.max),
      radius: z.number().finite().min(SHAKE_LIMITS.radius.min).max(SHAKE_LIMITS.radius.max),
      seconds: z.number().finite().min(SHAKE_LIMITS.seconds.min).max(SHAKE_LIMITS.seconds.max),
    })
    .optional(),
  /** 第 4 步: a ground hazard, a crack or a shockwave left where it comes down (`GroundImpactSchema`, ground-fx.ts). */
  ground: z.array(GroundImpactSchema).min(1).max(3).optional(),
})
export type ProjectileImpact = z.infer<typeof ProjectileImpactSchema>

/**
 * Boss 能力 2 (投射物): a thing the creature throws, of its own (not a vanilla shot). At `at` it leaves from the middle of a part of the model (`from.bone`, where the ability's own motion
 * holds it then) toward the one it fights, or starts `height` blocks above places decided as an area hit's (`from.sky.over`, item 3's `place`) and falls. The server flies it tick by tick
 * by `path` at `speed` (blocks a tick) with `gravity` (blocks a tick per tick) — the same arithmetic the pictures draw it with (projectile-flight.ts) — and strikes whoever it touches
 * (and everyone within `radius` of where it strikes) with `damage`, `knockback` away from there and `effects`. Landed, it stays stuck `pin_seconds`; `comes_back.at` (seconds of the
 * ability, may lie after its end) it flies back to its thrower once it has stayed that long. `look` is how it is drawn: an effect asset's model, or the creature's own part, which the
 * creature then lacks while it is out. `count` and `spread`: several thrown from the part at once, fanned over `spread` degrees. `warn` (from the sky only): item 3's warning at every place.
 * What may be written with what is `projectileRules` (projectile-rules.ts).
 */
const ProjectileHitSchema = z.strictObject({
  ...onceFields,
  place: FixtureTargetSchema.optional(),
  type: z.literal("projectile"),
  at: AbilityTimeSchema,
  look: z.union([z.strictObject({ effect: z.uuid() }), z.strictObject({ bone: HitBoneSchema })]),
  from: z.union([z.strictObject({ bone: HitBoneSchema }), z.strictObject({ sky: z.strictObject({ over: HitPlaceSchema, height: z.number().finite().min(PROJECTILE_LIMITS.height.min).max(PROJECTILE_LIMITS.height.max) }) })]),
  speed: z.number().finite().min(PROJECTILE_LIMITS.speed.min).max(PROJECTILE_LIMITS.speed.max),
  gravity: z.number().finite().min(0).max(PROJECTILE_LIMITS.gravity.max),
  path: z.enum(PROJECTILE_PATH_IDS),
  damage: z.number().finite().min(0).max(ABILITY_LIMITS.damage),
  knockback: z.number().finite().min(0).max(ABILITY_LIMITS.knockback),
  effects: z.array(AbilityEffectSchema).max(ABILITY_LIMITS.effects),
  radius: z.number().finite().min(0).max(PROJECTILE_LIMITS.radius.max),
  homing: HomingSchema.optional(),
  pierce: z.int({ error: "穿透层数请填整数。" }).min(0, "穿透层数不能小于 0。").max(16, "最多额外穿过 16 个目标。").optional(),
  bounces: z.int({ error: "弹射次数请填整数。" }).min(0, "弹射次数不能小于 0。").max(8, "碰墙最多弹射 8 次。").optional(),
  lifetime_ticks: z.int({ error: "飞行寿命请填整数刻数。" }).min(1, "飞行寿命至少 1 刻。").max(1200, "飞行寿命最多 1200 刻（60 秒）。").optional(),
  pin_seconds: z.number().finite().min(0).max(PROJECTILE_LIMITS.pin).optional(),
  comes_back: z.strictObject({ at: z.number().finite().min(0).max(PROJECTILE_BACK_MAX) }).optional(),
  count: z.number().int().min(1).max(PROJECTILE_LIMITS.count).optional(),
  spread: z.number().finite().min(0).max(PROJECTILE_LIMITS.fan).optional(),
  warn: BasicWarnSchema.optional(),
  /** Boss 能力 13: how much larger it is drawn than its look is built (1 left out). */
  size: z.number().finite().min(ARENA_LIMITS.size.min).max(ARENA_LIMITS.size.max).optional(),
  /** 落地炸开: what is seen and felt where it comes down (`ProjectileImpactSchema`); left out or null, it comes down as it always did. */
  impact: ProjectileImpactSchema.nullable().optional(),
  trail: z.strictObject({
    particle: ParticleRefSchema,
    per_tick: z.int().min(1, "拖尾每刻至少画 1 颗。").max(8, "拖尾每刻最多画 8 颗。").default(2),
    spread: z.number().min(0).max(1, "拖尾散开的距离最多 1 格。").default(0),
  }).optional(),
})
export type ProjectileHit = z.infer<typeof ProjectileHitSchema>

/**
 * One moment of an ability at which something is done to others. `area`: everyone the shape holds at that
 * moment is hit (`hits: "target"` only the one it is fighting, `"everyone"` every living thing but its own
 * kind). `shot`: a vanilla projectile leaves from forward/up of its feet toward where it aims, at `speed`
 * blocks a tick; `damage` is an arrow's and must be null for the others, which do what they do in the game.
 * `bone` (optional): a part of the model the hit comes from. Everything the hit says about where (the shape's forward/up/left, an arc's
 * low/high, where a line or a cone starts, a shot's forward/up) is then counted from the middle of that part as the ability's own motion
 * holds it at the moment of the hit, not from the creature's feet; left out, the hit is what it always was.
 * `place` and `warn` (optional, area only, Boss 能力 3): where it lands and the warning drawn before it (`HitPlaceSchema`, `HitWarnSchema`); left out, the hit is what it always was.
 */
export const AbilityHitSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("area"),
    ...onceFields,
    break_terrain: z.number({error:"破坏临时地形的力度要填数字"}).min(0,"破坏临时地形的力度至少为 0").max(50,"破坏临时地形的力度最多为 50").optional(),
    fixture_walls: z.boolean({error:"物件是否沿用这次出手的方块遮挡，请填 true 或 false。"}).optional(),
    blocked_by_walls: z.boolean({ error: "隔墙能否打中请用开关，true 表示实心方块会挡住。" }).optional(),
    at: AbilityTimeSchema,
    shape: AbilityShapeSchema,
    hits: z.enum(["target", "everyone"]),
    damage: z.number().finite().min(0).max(ABILITY_LIMITS.damage),
    knockback: z.number().finite().min(-ABILITY_LIMITS.knockback).max(ABILITY_LIMITS.knockback),
    effects: z.array(AbilityEffectSchema).max(ABILITY_LIMITS.effects),
    bone: HitBoneSchema.optional(),
    place: HitPlaceSchema.optional(),
    warn: HitWarnSchema.optional(),
    /** Boss 能力 4: for some seconds after it, everyone it struck is pushed, pulled or carried aside (`HitForceSchema`); left out, the hit is what it always was. */
    force: HitForceSchema.optional(),
    /** Boss 能力 13: places a hit over the whole arena does not reach (`ArenaSafeSchema`); only with `shape: {type: "arena"}`. */
    safe: ArenaSafeSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("shot"),
    ...onceFields,
    homing: HomingSchema.optional(),
    at: AbilityTimeSchema,
    projectile: z.enum(ABILITY_PROJECTILE_IDS),
    speed: z.number().finite().min(0.1).max(4),
    forward: z.number().finite().min(0).max(8),
    up: z.number().finite().min(0).max(8),
    damage: z.number().finite().min(0).max(ABILITY_LIMITS.damage).nullable(),
    bone: HitBoneSchema.optional(),
  }),
  // What happens at that moment is written in a gameplay's code, not here: the ability (its name, its motion, its wait, when it may start, its phase, its shake and debris) is the same as any other, and
  // at `at` it calls the entry `action` that the gameplay `gameplay` (its slug) registered through `ProjectContent.abilityAction`. That the gameplay is there and registered it is checked against the project
  // (`abilityActionGaps`). It has no shape, so nothing is measured of where it lands.
  z.strictObject({
    type: z.literal("gameplay"),
    at: AbilityTimeSchema,
    gameplay: GameplayRefSchema,
    action: AbilityActionNameSchema,
  }),
  // Boss 能力 2: a thing of its own it throws (`ProjectileHitSchema`): flown and checked by the server tick by tick, drawn by the players' games.
  ProjectileHitSchema,
])
export type AbilityHit = z.infer<typeof AbilityHitSchema>
/** The part of the model a hit counts from, when it names one. A hit written in a gameplay's code has no place it counts from; a thing thrown from a part counts from that part (`from.bone`), one from the sky from none. */
export const hitBone = (hit: AbilityHit): string | undefined => (hit.type === "gameplay" ? undefined : hit.type === "projectile" ? ("bone" in hit.from ? hit.from.bone : undefined) : hit.bone)

/**
 * A weapon trail (Boss 能力 11): from `at` to `until` (seconds of the ability) every player's game keeps where the far end of the part `bone` is,
 * frame by frame, and draws a ribbon `width` blocks wide through those places in `color`; each stretch of it fades out over `fade_ticks` ticks after the end passed it.
 * The far end (`trailTip`) is the corner of the part's own cubes furthest from the part's pivot, as the model is built: it turns with the part, so a blade's point
 * is where the blade's point is however it swings. Only seen: it hits nobody. That the model has the part, and that the part has cubes of its own, is checked against the model (`boneIssues`).
 */
const TrailEventSchema = z.strictObject({
  type: z.literal("trail"),
  at: AbilityTimeSchema,
  until: AbilityTimeSchema,
  bone: HitBoneSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "拖尾的颜色写成 #rrggbb 的六位十六进制"),
  width: z.number().finite().min(TRAIL_LIMITS.width.min).max(TRAIL_LIMITS.width.max),
  fade_ticks: z.number().int().min(TRAIL_LIMITS.fade.min).max(TRAIL_LIMITS.fade.max),
})

/** Boss 能力 10: a part of a boss's model that comes off (an ability's event at `at`, or a phase's as it begins: `BossPhaseModelSchema.drop`). */
const BossDropShape = { bone: HitBoneSchema, stay_seconds: z.number().finite().min(BOSS_LOOK_LIMITS.stay.min).max(BOSS_LOOK_LIMITS.stay.max) }
const BossDropEventSchema = z.strictObject({ type: z.literal("drop"), at: AbilityTimeSchema, ...BossDropShape })

/**
 * Boss 能力 7: lightning at a moment of an ability. At `at` a bolt of the game's own look and sound comes down on every place `place` names (the same places an area hit
 * is put down at, `HitPlaceSchema`, decided by the server alone when the warning begins or, without one, at that moment), and every living thing but the creature itself
 * and its own kind that stands within `radius` blocks of one of them is struck for `damage` (once however many bolts reach it). The bolt only shows: it sets nothing on
 * fire and changes no block; the damage is the mod's own, as an area hit's is. `warn` (optional) draws where it will come down beforehand, as an area hit's warning does.
 */
export const LightningEventSchema = z.strictObject({
  look: z.strictObject({
    effect: z.uuid().optional(), sound: z.union([z.enum(ABILITY_SOUND_IDS), SoundAssetRefSchema]).optional(),
    particle: z.union([ParticleRefSchema, z.strictObject({ ...ScatterFields, particle: ParticleRefSchema, count: z.int().min(1).max(64).default(12), spread: ScatterFields.spread.default(0.5) })]).optional(),
    flash: FlashEventSchema.omit({type:true, at:true, where:true, hit:true, forward:true, left:true}).optional(),
  }).optional(),
  type: z.literal("lightning"),
  at: AbilityTimeSchema,
  place: HitPlaceSchema,
  warn: BasicWarnSchema.optional(),
  damage: z.number().finite().min(0).max(ABILITY_LIMITS.damage),
  radius: z.number().finite().min(LIGHTNING_LIMITS.radius.min).max(LIGHTNING_LIMITS.radius.max),
})
export type LightningEvent = z.infer<typeof LightningEventSchema>

/**
 * Something heard or seen at a moment of an ability; never does anything to anybody. A particle appears at forward/up/left of its feet, `count` of them scattered within `spread` blocks.
 * An effect (H3) is one of this project's effect assets, by its asset id, shown in the world at that moment: at
 * forward/up/left (the creature's own terms) from `where` — its own feet, the feet of the one it fights, or the
 * middle of where hit number `hit` lands. With `count` above 1 they are laid out by two plain numbers: `ring`
 * puts them evenly on a circle of radius `spread` blocks, each turned to face outward; `line` spaces them evenly
 * from that place to `spread` blocks further ahead.
 * `along` (J2) says in whose terms those offsets and that layout are counted and how the effects are tilted:
 * `"facing"` is the creature's own level terms (ahead the way it faces, straight up, its own left), every effect
 * upright; `"aim"` is the direction hit number `hit` aims in (a line, a cone or a shot): the whole layout, as it
 * lies when that aim is level, is turned as one piece with the aim about where the aim starts, and every effect is
 * tilted with it, so what is seen lies on what is hit however high the target stands. Left out: `"aim"` when `where` is "hit" and that hit is a line or a cone that aims at
 * the target, else `"facing"`.
 */
export const AbilityEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("hit_fx"), at: AbilityTimeSchema, where: z.enum(["self", "target", "hit"]).default("self"), hit: z.int().min(0).nullable().default(null), level: z.enum(["light", "medium", "heavy"]), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), particle: ParticleRefSchema.optional(), sound: z.union([z.enum(ABILITY_SOUND_IDS), SoundAssetRefSchema]).optional() }),
  z.strictObject({ type: z.literal("camera"), at: CinematicTimeSchema, ...CameraShape }),
  z.strictObject({ type: z.literal("sky_tint"), at: CinematicTimeSchema, ...SkyTintShape }),
  z.strictObject({ type: z.literal("sound"), where: z.enum(["self","target","hit"]).optional(), hit:z.number().int().nonnegative().nullable().optional(), at: AbilityTimeSchema, sound: z.union([z.enum(ABILITY_SOUND_IDS), SoundAssetRefSchema]), volume: SoundVolumeSchema, range_blocks: SoundRangeSchema.optional(), pitch: z.number().finite().min(0.5).max(2), pitch_variation: PitchVariationSchema.optional(), pitch_to: ToneSchema.optional() }),
  // Boss 能力 11: `particle` is a vanilla particle by name, as it always was, or one of this project's particle assets by its asset id (`{ asset }`).
  z.strictObject({ type: z.literal("particle"), at: AbilityTimeSchema, particle: ParticleRefSchema, count: z.number().int().min(1).max(64), forward: ahead, up: ahead, left: ahead, ...TimedScatter, ...ParticleOrigin }),
  z.strictObject({
    type: z.literal("effect"),
    at: AbilityTimeSchema,
    effect: z.uuid(),
    where: z.enum(["self", "target", "hit"]),
    /** Which hit, counted from 0, when `where` is "hit" or `along` is "aim"; null otherwise. */
    hit: z.number().int().min(0).max(EPIC_LIMITS.hits - 1).nullable(),
    along: z.enum(["facing", "aim"]).optional(),
    forward: ahead,
    up: ahead,
    left: ahead,
    count: z.number().int().min(1).max(EFFECT_LIMITS.count),
    layout: z.enum(["ring", "line"]),
    spread: z.number().finite().min(0).max(EFFECT_LIMITS.spread),
    /** r29c: how much larger than its model is built each one is drawn, about its own origin; left out, as built (1). A shared ability's `scale` multiplies it. */
    size: z.number().finite().min(EFFECT_SIZE.min, `效果的大小 size 至少 ${EFFECT_SIZE.min} 倍`).max(EFFECT_SIZE.max, `效果的大小 size 最多 ${EFFECT_SIZE.max} 倍`).optional(),
  }),
  // Boss 能力 11: a weapon trail (`TrailEventSchema`).
  TrailEventSchema,
  // boss runtime (10-12): the screen of every player within `radius` blocks shakes, less the further they stand, and settles over `seconds`.
  z.strictObject({
    type: z.literal("shake"),
    where: z.enum(["self","target","hit"]).optional(), hit:z.number().int().nonnegative().nullable().optional(),
    at: AbilityTimeSchema,
    strength: z.number().finite().min(SHAKE_LIMITS.strength.min).max(SHAKE_LIMITS.strength.max),
    radius: z.number().finite().min(SHAKE_LIMITS.radius.min).max(SHAKE_LIMITS.radius.max),
    seconds: z.number().finite().min(SHAKE_LIMITS.seconds.min).max(SHAKE_LIMITS.seconds.max),
    // Boss 能力 8: each left out is the shake as it always was (no roll, no change of view, weaker with distance, its own speed).
    /** Degrees the screen swings about the line of sight at the centre and the start. */
    roll: z.number().finite().min(0).max(SHAKE_LIMITS.roll.max).optional(),
    /** Degrees the field of view widens (positive) or narrows (negative) at the centre and the start, settling with the shake. */
    fov: z.number().finite().min(-SHAKE_LIMITS.fov.max).max(SHAKE_LIMITS.fov.max).optional(),
    /** `linear`: weaker the further from the centre, nothing at the edge (as it always was); `none`: as strong anywhere inside `radius`. */
    falloff: z.enum(["none", "linear"]).optional(),
    /** How fast it shakes against the shake as it always was (1). */
    frequency: z.number().finite().min(SHAKE_LIMITS.frequency.min).max(SHAKE_LIMITS.frequency.max).optional(),
  }),
  // boss runtime (10-12): the ground at that place cracks and throws up dust, and `count` pieces of the block under it fly up and fall back.
  // Only looks: no block of the world is changed. Where it is counted from is the same as an effect's (`where`, `hit`, forward/up/left).
  z.strictObject({
    type: z.literal("debris"),
    block: z.string().regex(ITEM_REFERENCE, "碎块外观写工程方块的标识符，或 minecraft:ice 这样的原版方块。").optional(),
    dust: ParticleRefSchema.optional(),
    throw: DebrisThrowSchema.optional(),
    at: AbilityTimeSchema,
    where: z.enum(["self", "target", "hit"]),
    /** Which hit, counted from 0, when `where` is "hit"; null otherwise. */
    hit: z.number().int().min(0).max(EPIC_LIMITS.hits - 1).nullable(),
    forward: ahead,
    up: ahead,
    left: ahead,
    radius: z.number().finite().min(DEBRIS_LIMITS.radius.min).max(DEBRIS_LIMITS.radius.max),
    count: z.number().int().min(DEBRIS_LIMITS.count.min).max(DEBRIS_LIMITS.count.max),
  }),
  // The blocks of the world at that place break (`BREAK_LIMITS`): every block within `radius` of it and up to `height` above it that is no harder than `hardness`, as the
  // game breaks a block (its sound and its pieces), dropping what it drops when `drops`. Only where the world lets mobs change blocks (mobGriefing; on Forge and NeoForge
  // also what a claim mod says); never a block with a store, an unbreakable one or a fluid. Where it is counted from is the same as debris's.
  z.strictObject({
    type: z.literal("break"),
    particles: z.boolean().optional(),
    at: AbilityTimeSchema,
    where: z.enum(["self", "target", "hit"]),
    /** Which hit, counted from 0, when `where` is "hit"; null otherwise. */
    hit: z.number().int().min(0).max(ABILITY_LIMITS.hits - 1).nullable(),
    forward: ahead,
    up: ahead,
    left: ahead,
    radius: z.number().finite().min(BREAK_LIMITS.radius.min).max(BREAK_LIMITS.radius.max),
    height: z.number().finite().min(BREAK_LIMITS.height.min).max(BREAK_LIMITS.height.max),
    hardness: z.number().finite().min(BREAK_LIMITS.hardness.min).max(BREAK_LIMITS.hardness.max),
    drops: z.boolean(),
  }),
  // Boss 能力 7: lightning (`LightningEventSchema`).
  LightningEventSchema,
  // Boss 能力 10: the part `bone` (and what hangs from it) comes off: it falls where it is at that moment, lies `stay_seconds` and is gone; on the boss it stays hidden
  // for the rest of the fight. Only a boss drops parts (`bossDocumentIssues`); that the model has the bone, and that nothing later needs it, is checked against the model (`bossLookIssues`).
  BossDropEventSchema,
  // Boss 能力 12: the fog of a boss's arena comes down (`FogEventSchema`).
  FixtureActionSchema.extend({ at: FogEventSchema.shape.at }),
  FogEventSchema,
  // 第 4 步: a ground hazard, a crack, a shockwave ring and a beam, drawn by every player's game as meshes of their own (ground-fx.ts).
  FlashEventSchema,
  HazardEventSchema,
  CrackEventSchema,
  ShockwaveEventSchema,
  BeamEventSchema,
  TerrainRiseEventSchema,
  BlockSwapEventSchema,
  StanceActionSchema.extend({ at: FogEventSchema.shape.at }),
])
export type AbilityEvent = z.infer<typeof AbilityEventSchema>

/** When an ability, or a combo, may start (`AbilitySchema.start`). */
export const AbilityStartSchema = z.strictObject({
  ...CombatStartShape,
  min_distance: z.number().finite().min(0).max(ABILITY_LIMITS.distance),
  max_distance: z.number().finite().min(0.5).max(ABILITY_LIMITS.distance),
  line_of_sight: z.boolean(),
  cooldown: z.number().finite().min(0).max(ABILITY_LIMITS.cooldown),
  weight: z.number().int().min(1).max(ABILITY_LIMITS.weight),
}).superRefine((start,ctx) => {
  if (start.line_of_sight && start.weight_when?.some(rule => rule.if === "no_sight")) ctx.addIssue({code:"custom",path:["weight_when"],message:"招式要求看见目标，no_sight 永远不能生效。请把 line_of_sight 改为 false，或删掉这条条件。"})
})

/**
 * One thing a creature does to whoever it fights, as data with real timing (招式). Every time is seconds
 * from the start and is rounded to a server tick (a twentieth of a second).
 */
export const AbilitySchema = z
  .strictObject({
    /** Its name in code: the generated class and the binding list say it. */
    id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "招式的 id 用小写字母开头，只含小写字母、数字和下划线"),
    /** The name the person reads. */
    name: z.string().trim().min(1).max(40),
    /** The motion of the creature's model that plays, from its start, when the ability starts. */
    clip: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/),
    /** When getting ready ends. Until then it does nothing to anybody and turns as `facing` says; after it, it no longer turns. */
    windup: AbilityTimeSchema,
    /** When the whole ability is over and the wait (`start.cooldown`) begins. Not longer than the motion. */
    length: z.number().finite().min(0.05).max(ABILITY_LIMITS.seconds),
    /** While getting ready: `track` keeps turning toward the one it fights (30 degrees a tick at most), `lock` keeps the facing it started with. */
    facing: z.enum(["track", "lock"]),
    // 第 3 步: up to an epic creature's number; any other tier is held to `ABILITY_LIMITS.hits` against its blueprint (`tierLimitIssues`).
    hits: z.array(AbilityHitSchema).min(1).max(EPIC_LIMITS.hits),
    /**
     * Pushes it gives itself: at `at` its speed becomes `forward` blocks a tick the way it faces (negative: backward) and, when `up` is above 0, `up` upward.
     * Boss 能力 4: or a dash it carries itself along every tick, with a hit counted along the way (`DashMoveSchema`).
     */
    moves: z.array(AbilityMoveSchema).max(ABILITY_LIMITS.moves),
    /** When it may start: the one it fights is between the two distances (blocks), in sight when asked, and `cooldown` seconds have passed since this ability last ended. Among several that may start, the chance of each is its `weight`. */
    start: AbilityStartSchema,
    /** Being hurt while it runs ends it at once: nothing later in it happens. Its own death always does. */
    ...CombatAbilityShape,
    interrupt: InterruptSchema.optional(),
    stopped_by_hurt: z.boolean().default(false),
    events: z.array(AbilityEventSchema).max(ABILITY_LIMITS.events),
    /**
     * Flight (10-12): `where` it may start, on the ground, in the air, or either (left out: either); `dive`: in the air it pulls up above the one it
     * fights while getting ready and then charges at where that one stood when getting ready ended. Only a creature that flies may write `dive: true`
     * or `where: "air"` (`flightDocumentIssues`). Left out, an ability is what it always was.
     */
    dive: z.boolean().optional(),
    where: z.enum(ABILITY_WHERE_IDS).optional(),
    /**
     * Boss 能力 14 (夺兵): it starts when the creature is hit, by chance, instead of being chosen by distance (`OnHurtSchema`); `start` then says where the one who hit it
     * stands and how often it is the one among several. Left out, an ability is what it always was.
     */
    on_hurt: OnHurtSchema.optional(),
    // 第 3 步: until when it keeps turning to its target and how fast (`AbilityTrackShape`), and its stages (`AbilityStagesShape`, ability-tactics.ts). Left out, an ability is what it always was.
    ...AbilityTrackShape,
    ...AbilityStagesShape,
  })
  .superRefine((ability, context) => {
    ability.events.forEach((event, index) => {
      if (event.type !== "hit_fx") return
      if (event.where === "hit" && (event.hit === null || !ability.hits[event.hit])) context.addIssue({code:"custom", path:["events",index,"hit"], message:"命中反馈要指向已有的出手，hit 从 0 数。"})
      if (event.where !== "hit" && event.hit !== null) context.addIssue({code:"custom", path:["events",index,"hit"], message:"反馈放在自己或目标处时，请省略 hit。"})
    })
    for (const issue of [...onceIssues(ability.hits,"hits"),...onceIssues(ability.events,"events")]) context.addIssue({ code:"custom",...issue })
    ability = { ...ability, events: expandFeedback(ability.events) }
    const trails = ability.hits.map(hit => hit.type === "projectile" && hit.trail
      ? projectileCount(hit) * hit.trail.per_tick * (hit.lifetime_ticks ?? (PROJECTILE_LIMITS.flight + (projectileReturns(hit) ? PROJECTILE_LIMITS.back : 0))) : 0)
    emitIssues(ability.events, ability.length, ability.hits, 1, trails).forEach((issue) => context.addIssue({ code: "custom", ...issue }))
    const late = (at: number) => at > ability.length + 1e-9
    if ((RESERVED_CLIPS as readonly string[]).includes(ability.clip))
      context.addIssue({ code: "custom", path: ["clip"], message: `招式不能用 ${ability.clip} 这个动作：它是生物平时、挨打或死的时候自己播的。给招式单独做一个动作` })
    if (late(ability.windup)) context.addIssue({ code: "custom", path: ["windup"], message: "蓄力结束的时刻（windup）不能比招式全长（length）还晚" })
    ability.hits.forEach((hit, index) => {
      if (hit.at < ability.windup - 1e-9) context.addIssue({ code: "custom", path: ["hits", index, "at"], message: "出手的时刻（at）不能比蓄力结束（windup）还早：蓄力的时候不伤人" })
      if (late(hit.at)) context.addIssue({ code: "custom", path: ["hits", index, "at"], message: "出手的时刻（at）不能比招式全长（length）还晚" })
      if (index > 0 && hit.at < ability.hits[index - 1]!.at) context.addIssue({ code: "custom", path: ["hits", index, "at"], message: "几次出手按时间先后写" })
      if (hit.type === "area" && hit.shape.type === "arc" && hit.shape.low >= hit.shape.high) context.addIssue({ code: "custom", path: ["hits", index, "shape", "high"], message: "弧形范围的上沿（high）要比下沿（low）高" })
      if (hit.type === "area" && hit.shape.type === "arc" && (hit.shape.inner ?? 0) >= hit.shape.reach) context.addIssue({ code: "custom", path: ["hits", index, "shape", "inner"], message: `空心的内半径（inner）要比外半径（reach）小：现在 inner ${hit.shape.inner}、reach ${hit.shape.reach}，整片都是空的，谁也打不到` })
      if (hit.type === "shot" && ABILITY_PROJECTILES[hit.projectile].damage !== (hit.damage !== null))
        context.addIssue({ code: "custom", path: ["hits", index, "damage"], message: ABILITY_PROJECTILES[hit.projectile].damage ? "箭要写伤害（damage）" : `${ABILITY_PROJECTILES[hit.projectile].name}的伤害是原版定的，damage 写 null` })
    })
    // Boss 能力 3: where a hit lands and the warning before it.
    ability.hits.forEach((hit, index) => {
      if (hit.type !== "area") return
      if (hitElsewhere(hit)) {
        if (!placeableShape(hit.shape)) context.addIssue({ code: "custom", path: ["hits", index, "place"], message: "只有球（sphere）、盒子（box）和一整圈的弧（arc，angle 写 360）能放到别处（place）：直线（line）和锥形（cone）是从它身上朝目标打的，不满一圈的弧朝着它自己面对的方向" })
        if (hit.bone !== undefined) context.addIssue({ code: "custom", path: ["hits", index, "bone"], message: "写了 place 的出手不能再写 bone：落点由 place 定，不从身上的部件算" })
        if (hit.knockback < 0) context.addIssue({ code: "custom", path: ["hits", index, "knockback"], message: "打在别处（place）的这一下不能写负的 knockback：负数是把人拉向它自己，可它不在落点那里。写 0，或者写正数（从落点往外推）" })
      }
      if (!hit.warn) return
      if (!warnableShape(hit.shape)) context.addIssue({ code: "custom", path: ["hits", index, "warn"], message: "直线（line）和锥形（cone）不能写预警（warn）：它们朝出手那一刻目标所在的地方打，预警出现的时候还不知道会打向哪里" })
      if (hit.bone !== undefined) context.addIssue({ code: "custom", path: ["hits", index, "bone"], message: "写了预警（warn）的出手不能写 bone：预警开始那一刻落点就定在地上，不再跟着身上的部件动。用 shape 的 forward、up、left 写从脚下算的位置" })
      if (hit.at - hit.warn.seconds < -1e-9) context.addIssue({ code: "custom", path: ["hits", index, "warn", "seconds"], message: `预警最早在招式开始的那一刻出现：这一下在第 ${hit.at} 秒，预警（warn.seconds）最多提前 ${hit.at} 秒。把 seconds 改小，或者把这一下（at）往后挪` })
    })
    ability.events.forEach((event, index) => {
      if (!("where" in event) || isTerrainEvent(event)) return
      if ((event.type === "sound" || event.type === "shake") && (event.where === "hit") !== (event.hit != null)) context.addIssue({code:"custom",path:["events",index,"hit"],message:"引用出手落点时要填出手序号，其余位置不填。"})
      if (event.where !== "hit" || !("hit" in event) || event.hit == null) return
      const aimed = ability.hits[event.hit]
      if (!aimed || aimed.type === "projectile" || aimed.type === "gameplay") {
        if (event.type === "sound" || event.type === "shake") context.addIssue({code:"custom",path:["events",index,"hit"],message:"这个序号没有能预先确定落点的出手。"})
        return
      }
      if (aimed.type === "area" && hitElsewhere(aimed) || event.type === "sound" || event.type === "shake") {
        const tick=landingTick(aimed)
        const start=Math.round(event.at*20)-(event.type === "shockwave" && event.warn ? Math.round(event.warn.seconds*20) : 0)
        if(start<tick) context.addIssue({code:"custom",path:["events",index,"at"],message:earlyLanding(event.hit,tick) + (event.type==="shockwave" && event.warn ? ` 这道环还需提前 ${event.warn.seconds} 秒预警，环的 at 最早为第 ${(tick+Math.round(event.warn.seconds*20))/20} 秒。` : "")})
        if(event.type==="shockwave" && event.warn?.follow) context.addIssue({code:"custom",path:["events",index,"warn","follow"],message:"引用实际出手落点的环使用固定预警，请省略 follow。"})
      }
    })
    ability.moves.forEach((move, index) => isPush(move) && late(move.at) && context.addIssue({ code: "custom", path: ["moves", index, "at"], message: "位移的时刻（at）不能比招式全长（length）还晚" }))
    ability.events.forEach((event, index) => {
      if (event.type === "sound" && event.pitch_to !== undefined && (Math.round(event.at * TICKS) >= Math.round(ability.windup * TICKS) || event.pitch_to <= event.pitch))
        context.addIssue({ code: "custom", path: ["events", index, "pitch_to"], message: "蓄力升调请把声音放在起手结束前至少一刻，pitch_to 要高于起始音高 pitch。" })
    })
    ability.events.forEach((event, index) => late(event.at) && context.addIssue({ code: "custom", path: ["events", index, "at"], message: "声音、粒子、效果、晃屏、镜头、染天、碎块和打碎方块的时刻（at）不能比招式全长（length）还晚" }))
    // Boss 能力 11: a trail is drawn from `at` until `until`, inside the ability.
    ability.events.forEach((event, index) => {
      if (event.type !== "trail") return
      if (event.until <= event.at + 1e-9) context.addIssue({ code: "custom", path: ["events", index, "until"], message: "拖尾结束的时刻（until）要比开始（at）晚" })
      if (late(event.until)) context.addIssue({ code: "custom", path: ["events", index, "until"], message: "拖尾结束的时刻（until）不能比招式全长（length）还晚" })
    })
    ability.events.forEach((event, index) => {
      if (event.type !== "debris" && event.type !== "break") return
      if ((event.where === "hit") !== (event.hit !== null)) context.addIssue({ code: "custom", path: ["events", index, "hit"], message: `${event.type === "break" ? "打碎方块" : "碎块"}的 where 写 "hit" 的时候用 hit 写是第几次出手（从 0 数），其余时候 hit 写 null` })
      if (event.hit !== null && event.hit >= ability.hits.length) context.addIssue({ code: "custom", path: ["events", index, "hit"], message: `这个招式只有 ${ability.hits.length} 次出手，没有第 ${event.hit} 次（从 0 数）` })
    })
    // A hit written in a gameplay's code has no place it lands: nothing is laid on it.
    ability.events.forEach((event, index) => {
      if ((event.type !== "effect" && event.type !== "debris" && event.type !== "break") || event.hit === null || ability.hits[event.hit]?.type !== "gameplay") return
      context.addIssue({ code: "custom", path: ["events", index, "hit"], message: `第 ${event.hit} 次出手是玩法代码做的，没有落点可以对：这里的 hit 指向一次范围或者射出的出手，或者 where 写 self / target 并且 hit 写 null` })
    })
    ability.events.forEach((event, index) => {
      if (event.type !== "effect") return
      if ((event.where === "hit" || event.along === "aim") !== (event.hit !== null)) context.addIssue({ code: "custom", path: ["events", index, "hit"], message: 'where 写 "hit" 或者 along 写 "aim" 的时候用 hit 写是第几次出手（从 0 数），其余时候 hit 写 null' })
      if (event.hit !== null && event.hit >= ability.hits.length) context.addIssue({ code: "custom", path: ["events", index, "hit"], message: `这个招式只有 ${ability.hits.length} 次出手，没有第 ${event.hit} 次（从 0 数）` })
      const aimed = event.hit === null ? undefined : ability.hits[event.hit]
      if (event.along === "aim" && aimed && aimed.type === "area" && aimed.shape.type !== "line" && aimed.shape.type !== "cone")
        context.addIssue({ code: "custom", path: ["events", index, "along"], message: `along 写 "aim" 是让效果顺着那一次出手瞄的方向摆，可是第 ${event.hit} 次出手是 ${aimed.shape.type}，它没有瞄的方向（只有 line、cone 和投射物有）。along 写 "facing"，或者不写` })
    })
    // Boss 能力 7: lightning strikes, so it comes no earlier than a hit may; its warning begins no earlier than the ability.
    ability.events.forEach((event, index) => {
      if (event.type !== "lightning") return
      if (event.at < ability.windup - 1e-9) context.addIssue({ code: "custom", path: ["events", index, "at"], message: "落雷（lightning）会伤人，和出手一样不能比蓄力结束（windup）还早" })
      if (event.warn && event.at - event.warn.seconds < -1e-9) context.addIssue({ code: "custom", path: ["events", index, "warn", "seconds"], message: `预警最早在招式开始的那一刻出现：这道雷在第 ${event.at} 秒，预警（warn.seconds）最多提前 ${event.at} 秒。把 seconds 改小，或者把落雷（at）往后挪` })
    })
    if (ability.start.min_distance >= ability.start.max_distance) context.addIssue({ code: "custom", path: ["start", "max_distance"], message: "能出招的最远距离（max_distance）要比最近距离（min_distance）大" })
    // Boss 能力 4: a dash and the forces hits leave (`dashForceIssues`).
    dashForceIssues(ability).forEach((issue) => context.addIssue({ code: "custom", ...issue }))
    // Boss 能力 2: what a thrown thing of its own may be written with (projectile-rules.ts).
    projectileRules(ability, (path, message) => context.addIssue({ code: "custom", path, message }))
    // Boss 能力 14: an ability started by a blow (`parryIssues`).
    parryIssues(ability).forEach((issue) => context.addIssue({ code: "custom", ...issue }))
    // 第 4 步: ground hazards, cracks, shockwaves and beams (`groundFxIssues`).
    terrainIssues(ability).forEach((issue) => context.addIssue({ code: "custom", ...issue }))
    groundFxIssues(ability).forEach((issue) => context.addIssue({ code: "custom", ...issue }))
    // 第 3 步: tracking, a leap and stages (`tacticsAbilityIssues`).
    if (ability.on_hurt && (ability.start.repeat || ability.start.weight_when)) context.addIssue({code:"custom",path:["start"],message:"被打中才起的招式请用 on_hurt 的概率，删掉 start.repeat 和 start.weight_when。"})
    if (ability.interrupt && !ability.stopped_by_hurt) context.addIssue({ code: "custom", path: ["stopped_by_hurt"], message: "写了 interrupt 时，请把 stopped_by_hurt 改为 true，或删掉 interrupt。" })
    if (ability.interrupt && ((ability.interrupt.to ?? ability.length) > ability.length || Math.round((ability.interrupt.from ?? 0) * 20) >= Math.round(ability.length * 20))) context.addIssue({ code: "custom", path: ["interrupt"], message: "打断时间段要放在这一招的全长以内。" })
    tacticsAbilityIssues(ability).forEach((issue) => context.addIssue({ code: "custom", ...issue }))
  })
export type Ability = z.infer<typeof AbilitySchema>

const AbilityListSchema = z
  .array(AbilitySchema)
  .max(EPIC_LIMITS.abilities)
  .superRefine((abilities, context) => abilities.forEach((ability, index) => abilities.findIndex((other) => other.id === ability.id) !== index && context.addIssue({ code: "custom", path: [index, "id"], message: `两个招式不能用同一个 id（${ability.id}）` })))

const AbilityIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "招式和连招的 id 用小写字母开头，只含小写字母、数字和下划线")

/**
 * A combo (连招): abilities the creature already has, played one after another without going back to standing between them, chosen like an ability
 * (its own `start`: window, sight, wait and weight) and named by its id where a boss's phase names what it may use. Every step keeps its own motion, hits, moves and
 * events and is cut short as it says (`stopped_by_hurt`), which ends the whole combo; `gap_ticks` is how long it holds still between two steps, and every hit of its
 * steps does `damage_scale` times its own damage. A step's own wait is not started by the combo: the combo has its own (`start.cooldown`, from its end).
 * Which ids its steps name, and how long it runs, is checked against the creature's abilities (`comboDocumentIssues`).
 */
export const ComboSchema = z
  .strictObject({
    id: AbilityIdSchema,
    name: z.string().trim().min(1).max(40),
    steps: z.array(AbilityIdSchema).min(COMBO_LIMITS.steps.min).max(COMBO_LIMITS.steps.max),
    gap_ticks: z.number().int().min(0).max(COMBO_LIMITS.gap),
    damage_scale: z.number().finite().min(COMBO_LIMITS.damage.min).max(COMBO_LIMITS.damage.max),
    start: AbilityStartSchema,
    // 第 3 步: how it goes on after a step (`ComboBranchesShape`, ability-tactics.ts). Left out, its steps follow one another as they always did.
    ...ComboBranchesShape,
  })
  .superRefine((combo, context) => {
    combo.steps.forEach((step, index) => combo.steps.indexOf(step) !== index && context.addIssue({ code: "custom", path: ["steps", index], message: `连招「${combo.name}」里招式 ${step} 写了两遍：一个连招里每个招式只出一次。想连出两下同样的，就再做一个招式（可以用同一个动作）` }))
    if (combo.start.min_distance >= combo.start.max_distance) context.addIssue({ code: "custom", path: ["start", "max_distance"], message: "能出招的最远距离（max_distance）要比最近距离（min_distance）大" })
  })
export type Combo = z.infer<typeof ComboSchema>

const ComboListSchema = z
  .array(ComboSchema)
  .max(EPIC_LIMITS.combos)
  .superRefine((combos, context) => combos.forEach((combo, index) => combos.findIndex((other) => other.id === combo.id) !== index && context.addIssue({ code: "custom", path: [index, "id"], message: `两个连招不能用同一个 id（${combo.id}）` })))

/** How long a whole combo runs, in seconds, from its steps' lengths (`comboTimeline`); null when a step names no ability it has. */
export const comboSeconds = (combo: Pick<Combo, "steps" | "gap_ticks">, abilities: readonly Pick<Ability, "id" | "length">[]) => {
  const lengths = combo.steps.map((step) => abilities.find((ability) => ability.id === step)?.length)
  return lengths.every((length) => length !== undefined) ? (comboTimeline(lengths as number[], combo.gap_ticks).end + 1) / TICKS : null
}

/**
 * What is wrong with a creature's combos against its abilities, in the person's words, each with where it is: a step names an ability it has (not another combo:
 * a combo is not put inside a combo), a combo's id is not one of its abilities' ids too (a boss's phases name both by id), and a whole combo runs no longer than
 * `COMBO_LIMITS.seconds`. A creature that flies has none yet: its flight decides by the ability that runs, which a combo changes between steps.
 */
export function comboDocumentIssues(creature: { shared_abilities?: readonly { id: string }[] | null; abilities?: readonly Pick<Ability, "id" | "length">[] | null; combos?: readonly Combo[] | null; flight?: unknown }) {
  const found: { path: (string | number)[]; message: string }[] = []
  const combos = creature.combos ?? []
  if (!combos.length) return found
  const abilities = creature.abilities ?? []
  if (creature.flight) found.push({ path: ["combos"], message: "会飞的生物（写了 flight）现在还不能写连招（combos）：飞行要按正在出的那一招来飞，连招在两招之间换招，这一块还没做。把 combos 去掉，或者把连招拆回单独的招式" })
  combos.forEach((combo, index) => {
    if (abilities.some((ability) => ability.id === combo.id)) found.push({ path: ["combos", index, "id"], message: `连招的 id ${combo.id} 和一个招式的 id 一样：Boss 的阶段按 id 写招式和连招，两者不能重名` })
    combo.steps.forEach((step, place) => {
      if (abilities.some((ability) => ability.id === step) || creature.shared_abilities?.some(use => use.id === step)) return
      found.push({ path: ["combos", index, "steps", place], message: combos.some((other) => other.id === step) ? `连招「${combo.name}」的第 ${place + 1} 步 ${step} 是另一个连招：连招里只能写招式，不能套连招。把那个连招的招式直接写进来` : `连招「${combo.name}」的第 ${place + 1} 步 ${step} 在这个生物的招式（abilities）里找不到` })
    })
    const seconds = comboSeconds(combo, abilities)
    if (seconds !== null && seconds > COMBO_LIMITS.seconds + 1e-9) found.push({ path: ["combos", index, "steps"], message: `连招「${combo.name}」一整套要 ${Number(seconds.toFixed(2))} 秒，最长 ${COMBO_LIMITS.seconds} 秒：少连几招，或者把间隔（gap_ticks）改短` })
    // 第 3 步: its branches against its steps (`comboBranchIssues`).
    comboBranchIssues(combo, abilities).forEach((issue) => found.push({ ...issue, path: ["combos", index, ...issue.path] }))
  })
  return found
}

// ---- a boss's lair (巢) ----

/** The way a lair names a block of its platform: this project's own block by identifier, or a vanilla block written `minecraft:<name>`. Same writing as an item a creature drops. */
const BLOCK_REFERENCE = ITEM_REFERENCE
/** Vanilla blocks that are no floor: three kinds of air. */
const NOT_A_FLOOR: ReadonlySet<string> = new Set(["air", "cave_air", "void_air"])
/** A vanilla block the game does not have, or that cannot be a floor, in words; null when the reference is a project's own or a vanilla block that can. */
export const vanillaBlockIssue = (block: string) => {
  if (!block.startsWith("minecraft:")) return null
  const name = block.slice("minecraft:".length)
  if (!VANILLA_BLOCK_IDS.has(name)) return `Minecraft 1.21.1 里没有 ${block} 这个方块。核对拼写`
  return NOT_A_FLOOR.has(name) ? `${block} 是空气，铺不成地面` : null
}
/**
 * How a player calls a boss up (召唤, the third tier of task 二): using `item` (this project's item or block by identifier, or `minecraft:<name>`) in the air, or on
 * `block` when one is named (an altar: this project's block or a vanilla one). The boss appears `ahead` blocks in front of the player (on the block used, when there
 * is one), at the first place up from there its body fits, and wakes as it always does. `consume`: the item is used up (not in creative). `cooldown`: seconds before
 * that item calls again. While one of its kind still lives within `SUMMON_LIMITS.near` blocks, nothing more is called.
 */
export const SummonSchema = z
  .strictObject({
    item: z.string().regex(ITEM_REFERENCE, "召唤用的东西写本工程物品或方块的标识符，或者写成 minecraft:名字 的原版物品"),
    block: z.string().regex(BLOCK_REFERENCE, "召唤台写本工程方块的标识符，或者写成 minecraft:名字 的原版方块").nullable(),
    consume: z.boolean(),
    cooldown: z.number().finite().min(SUMMON_LIMITS.cooldown.min).max(SUMMON_LIMITS.cooldown.max),
    ahead: z.number().finite().min(SUMMON_LIMITS.ahead.min).max(SUMMON_LIMITS.ahead.max),
  })
  .superRefine((summon, context) => {
    const item = vanillaItemIssue(summon.item)
    if (item) context.addIssue({ code: "custom", path: ["item"], message: item })
    const block = summon.block ? vanillaBlockIssue(summon.block) : null
    if (block) context.addIssue({ code: "custom", path: ["block"], message: block.includes("空气") ? `${summon.block} 是空气，不能当召唤台` : block })
  })
export type Summon = z.infer<typeof SummonSchema>

const LairBlockSchema = z
  .string()
  .regex(BLOCK_REFERENCE, "巢的地面和边沿写本工程方块的标识符，或者写成 minecraft:名字 的原版方块")
  .superRefine((block, context) => {
    // A block the game does not have is skipped in the game when the lair is built; said here, the person finds the misspelling.
    const issue = vanillaBlockIssue(block)
    if (issue) context.addIssue({ code: "custom", message: issue })
  })

/**
 * Where a boss has its lair, as data: a structure of the world's own generation (the game's `/locate structure` finds it as `<mod id>:<creature id>_lair`),
 * made with the terrain, with the boss placed in it once when it is made, the way the ocean monument gets its guardians. Nothing runs afterwards, nothing
 * of a player's building is touched, and the lair is only in chunks that are made after the mod is installed. Every bound is derived at `LAIR_LIMITS`.
 * - biomes, tags, above_sea: where it may be, written as a creature's natural spawning writes them; `above_sea`: the floor is at least that many blocks above sea level.
 * - spacing: chunks, the average distance between two lairs (the structure set's `spacing`; its `separation` is a quarter of it, `lairSeparation`).
 * - radius: blocks, of the round platform. floor: one to four blocks it is made of, each column picking one by a fixed pattern of its place. rim: a block laid one high on the outermost ring, or null.
 * - clearance: blocks of air cleared above the floor (trees, snow and terrain are cut away), at least as many as the boss is tall.
 */
export const LairSchema = z
  .strictObject({
    ...BiomeChoiceShape,
    above_sea: AboveSeaSchema.optional(),
    spacing: z.number().int().min(LAIR_LIMITS.spacing.min).max(LAIR_LIMITS.spacing.max),
    radius: z.number().int().min(LAIR_LIMITS.radius.min).max(LAIR_LIMITS.radius.max),
    floor: z.array(LairBlockSchema).min(LAIR_LIMITS.floor.min).max(LAIR_LIMITS.floor.max),
    rim: LairBlockSchema.nullable().optional(),
    clearance: z.number().int().min(LAIR_LIMITS.clearance.min).max(LAIR_LIMITS.clearance.max),
  })
  .superRefine((lair, context) => biomeChoiceIssues(lair, context, "巢至少要写一个群系（biomes）或者一组群系（tags）：不写就不知道它在哪里生成", "巢的群系（biomes）不要重复写"))
export type Lair = z.infer<typeof LairSchema>

// ---- boss (Boss 运行时, 10-12) ----

/** A motion of the model a boss plays at a moment of its fight. Not one the creature plays by itself for something else (`RESERVED_CLIPS`). */
const BossClipSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/).nullable()
const BossSecondsSchema = z.number().finite().min(BOSS_LIMITS.seconds.min).max(BOSS_LIMITS.seconds.max)
const BossBarColorSchema = z.enum(BOSS_BAR_COLOR_IDS)

/**
 * Boss 能力 7: the weather a phase shows, to the players of the fight only (the players of its bar); the world's own weather is never changed, and everybody else sees it.
 * `rain`: it rains for them (snows where it snows); `thunder`: a storm's darker sky and heavier rain (only with `rain`; bolts come from lightning events);
 * `dark`: 0 to 1, how dark their sky and their world get, on top of the bar's `darken_sky` (never lighter than that). Left out: the weather of the phase before
 * (the first phase, before any line, has the world's own). It comes and goes over two seconds, and goes when the player leaves the fight or the world, or the fight ends.
 */
export const BossWeatherSchema = z
  .strictObject({
    rain: z.boolean(),
    thunder: z.boolean(),
    dark: z.number().finite().min(WEATHER_LIMITS.dark.min).max(WEATHER_LIMITS.dark.max),
  })
  .superRefine((weather, context) => {
    if (weather.thunder && !weather.rain) context.addIssue({ code: "custom", path: ["thunder"], message: "打雷（thunder）要和下雨（rain）一起写：游戏里雷雨的天色是跟着雨来的，没有雨就看不出来。只想天色暗，写 dark" })
  })
export type BossWeather = z.infer<typeof BossWeatherSchema>

/**
 * Boss 能力 10: what a phase changes of the boss's model when it begins (the moment its change starts), kept for the rest of the fight (a leash reset puts all of it back).
 * - hide / show: bones (by name) hidden or shown from then on, with what hangs from them. A bone some phase shows is hidden before that phase, unless an earlier phase hid it.
 * - glow: a glowing layer drawn at full brightness over the model, from `from` to `to` (0 none, 1 full) in `seconds`: `"emissive"` is the model's own glowing parts (its glow
 *   features, which glow fully until a phase says otherwise), `{ asset }` a texture asset the size of the model's texture whose bright pixels glow (black ones do not: the glow is added on top).
 *   It stays at `to` until a later phase's glow on the same picture.
 * - texture: the whole texture the model wears from then on: `{ asset }` a texture asset the size of the model's texture (a cracked, burning variant), `"model"` the model's
 *   own again; swapped at once as the phase begins, and kept until a later phase's texture.
 * - drop: parts that come off as the phase begins (`BossDropShape`): each falls where it is, lies `stay_seconds` and is gone; the bone stays hidden.
 * That the bones are there, and the rest, is checked against the model (`bossLookIssues`).
 */
const BossBoneListSchema = z.array(HitBoneSchema).max(BOSS_LOOK_LIMITS.bones)
export const BossGlowSchema = z.strictObject({
  texture: z.union([z.literal("emissive"), z.strictObject({ asset: z.uuid() })]),
  from: z.number().finite().min(0).max(1),
  to: z.number().finite().min(0).max(1),
  seconds: z.number().finite().min(BOSS_LOOK_LIMITS.glow.min).max(BOSS_LOOK_LIMITS.glow.max),
})
const ReversibleModelSchema = z.strictObject({
  hide: BossBoneListSchema.optional(),
  show: BossBoneListSchema.optional(),
  glow: BossGlowSchema.optional(),
  texture: z.union([z.literal("model"), z.strictObject({ asset: z.uuid() })]).optional(),
})
export const BossPhaseModelSchema = ReversibleModelSchema.extend({ drop: z.array(z.strictObject(BossDropShape)).max(BOSS_LOOK_LIMITS.drops).optional() })
export type BossPhaseModel = z.infer<typeof BossPhaseModelSchema>

/**
 * Boss 能力 15: the timed steps of a boss's wake-up and of its death (`intro.steps`, `death.steps`; `boss-show.ts`), made of the parts every other place of a boss writes:
 * a bone's name, a motion's name, item 10's glow, item 7's weather, an ability's sound and particle, a block as a lair names one.
 */
const BossShowStepsSchema = bossShowStepsSchema({
  bone: HitBoneSchema,
  clip: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/),
  glow: BossGlowSchema,
  weather: BossWeatherSchema,
  sound: z.union([z.enum(ABILITY_SOUND_IDS), SoundAssetRefSchema]),
  particle: ParticleRefSchema,
  block: z
    .string()
    .regex(BLOCK_REFERENCE, "演出摆的方块写本工程方块的标识符，或者写成 minecraft:名字 的原版方块")
    .superRefine((block, context) => {
      const issue = vanillaBlockIssue(block)
      if (issue) context.addIssue({ code: "custom", message: issue })
    }),
})

const SceneFinishSchema = z.array(z.discriminatedUnion("type", [
  FixtureActionSchema,
  BossShowStepsSchema.element.options[1].omit({ at: true }), BossShowStepsSchema.element.options[2].omit({ at: true }),
  BossShowStepsSchema.element.options[3].omit({ at: true }), BossShowStepsSchema.element.options[4].omit({ at: true }),
  z.strictObject({ type: z.literal("ground"), ground: z.array(GroundImpactSchema).min(1).max(3) }),
])).min(1).max(6)
const StanceSecondsSchema = z.number().finite().min(0.05).max(3600)
const StancePartScaleSchema = z.strictObject({ part: z.string().min(1).max(48), damage_scale: z.number().finite().min(0).max(16) })
const StanceSchema = z.strictObject({
  id: StanceIdSchema, name: z.string().trim().min(1).max(48),
  clips: z.strictObject({ idle: BossClipSchema.unwrap().optional(), walk: BossClipSchema.optional() }).optional(),
  change: z.strictObject({ clip: BossClipSchema, seconds: BossSecondsSchema }).optional(),
  model: ReversibleModelSchema.optional(),
  part_scales: z.array(StancePartScaleSchema).max(48).optional(),
  abilities: z.array(AbilityIdSchema).max(EPIC_LIMITS.abilities + EPIC_LIMITS.combos).optional(),
  guard: GuardSchema.nullable().optional(),
  bar: z.strictObject({ color: BossBarColorSchema }).optional(),
  ambient: z.strictObject({
    sky: z.number().finite().min(0).max(1).optional(),
    tint: z.string().regex(/^#[a-fA-F0-9]{6}$/).nullable().optional(),
    visibility: z.number().finite().min(1).max(128).nullable().optional(),
  }).optional(),
  max_seconds: StanceSecondsSchema.optional(), then: StanceIdSchema.optional(),
  leave: z.strictObject({
    after_seconds: StanceSecondsSchema, ability: AbilityIdSchema, retry_seconds: StanceSecondsSchema,
    max_delays: z.number().int().min(0).max(16),
  }).optional(),
  when: z.array(StanceWhenSchema).min(1).max(8).optional(),
  events: SceneFinishSchema.optional(),
  // Senses may replace the creature's whole definition here in a later release.
})
export const StancesSchema = z.strictObject({ start: StanceIdSchema, list: z.array(StanceSchema).min(1).max(12) })
export type Stances = z.infer<typeof StancesSchema>
export type Stance = z.infer<typeof StanceSchema>

/**
 * What a hostile creature has when it is a boss, as data (spec: 2026-10-12-boss-runtime.md). Everything is a number or a name the
 * generated Java is written from; none of it changes a block of the world.
 * - bar: the bar with its name at the top of the screen of everyone who sees it; `darken_sky` darkens the sky while it fights.
 * - intro: it starts asleep and wakes when somebody comes within `wake_distance`, plays `clip` and roars `sound` for `seconds` seconds,
 *   unable to act or be hurt; null: it fights from the start. `opening` (optional): the id of the ability it uses first once the intro is over (no other ability starts
 *   until it has been started once in the fight, or until the time the generated runtime allows has run out, `bossOpeningTicks`); a leash reset arms it again, a phase change does not.
 * - phases: when its life falls to `below` (a share of the whole) it changes: `clip` plays for `seconds` seconds, then the bar takes `bar_color`
 *   and its speed and the damage it does are multiplied. `abilities` are the ids of the abilities it may use in that phase.
 * - death: the death motion plays for `seconds`; the experience comes in `xp_bursts` bursts; `explosion` ends it with sound and light only.
 * - leash: when nobody has been near for `reset_seconds` the fight is over: full health, first phase, as before it met anyone; one further than
 *   `distance` from where it stood at first is also brought back there (epic r1 review: one that stayed near home after the player left stayed hurt).
 * - lair: where it is placed once when the world makes that place (`LairSchema`); none: it is met only where it spawns or where gameplay puts it.
 */
export const BossSchema = z.strictObject({
  music: z.strictObject({
    asset: z.string().uuid(),
    starts: z.enum(["wake", "fight"]),
    fade_seconds: z.number().min(0).max(10),
  }).optional(),
  bar: z.strictObject({
    color: BossBarColorSchema,
    style: z.enum(BOSS_BAR_STYLE_IDS),
    darken_sky: z.boolean(),
    /**
     * Boss 能力 6: what the bar looks like. Left out or `"vanilla"`: the game's own bar in `color` and `style`, as it always was (and generated byte for byte as before).
     * `{ asset }`: a bar asset of this project (`boss-bar.ts`); the creature depends on it. `color` and `style` stay the game's bar wherever that one is shown.
     */
    look: z.union([z.literal("vanilla"), z.strictObject({ asset: z.uuid() })]).optional(),
  }),
  intro: z
    .strictObject({
      volume: SoundVolumeSchema.optional(),
      range_blocks: SoundRangeSchema.optional(),
      wake_distance: z.number().finite().min(BOSS_LIMITS.wake.min).max(BOSS_LIMITS.wake.max),
      clip: BossClipSchema,
      seconds: BossSecondsSchema,
      sound: z.enum(ABILITY_SOUND_IDS).nullable(),
      /** The id of the ability that is its first attack once the intro ends; left out or null: any ability, picked by weight, as it always was. */
      opening: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).nullable().optional(),
      /** Boss 能力 15: the wake-up as timed steps (`boss-show.ts`); left out, it is played as the fields above say, as it always was. */
      steps: BossShowStepsSchema.optional(),
    })
    .nullable(),
  phases: z
    .array(
      z.strictObject({
        below: z.number().finite().min(BOSS_LIMITS.below.min).max(BOSS_LIMITS.below.max),
        clip: BossClipSchema,
        volume: SoundVolumeSchema.optional(),
        range_blocks: SoundRangeSchema.optional(),
        sound: z.union([z.enum(ABILITY_SOUND_IDS), SoundAssetRefSchema], { error: "换阶段的声音请填招式可用的原版声音名，或用 {asset: 声音资产编号} 选工程里的声音。" }).optional(),
        seconds: BossSecondsSchema,
        finish: SceneFinishSchema.optional(),
        stances: z.record(StanceIdSchema, z.strictObject({ max_seconds: StanceSecondsSchema })).optional(),
        bar_color: BossBarColorSchema.nullable(),
        speed: z.number().finite().min(BOSS_LIMITS.speed.min).max(BOSS_LIMITS.speed.max),
        damage: z.number().finite().min(BOSS_LIMITS.damage.min).max(BOSS_LIMITS.damage.max),
        /** The whole list of the abilities and combos (by id) it may start in this phase; left out or empty: all of them, unless `add` / `remove` say otherwise. */
        abilities: z.array(AbilityIdSchema).max(EPIC_LIMITS.abilities + EPIC_LIMITS.combos).optional(),
        /** Instead of a whole list: what this phase may start besides what the phase before it could (`add`), and what it no longer may (`remove`); see `bossPhaseIds`. */
        add: z.array(AbilityIdSchema).max(EPIC_LIMITS.abilities + EPIC_LIMITS.combos).optional(),
        remove: z.array(AbilityIdSchema).max(EPIC_LIMITS.abilities + EPIC_LIMITS.combos).optional(),
        /** Boss 能力 10: what of its model this phase changes when it begins (`BossPhaseModelSchema`); left out: nothing, as it always was. */
        model: BossPhaseModelSchema.optional(),
        /** Boss 能力 7: the weather the players of the fight see from this phase on (`BossWeatherSchema`); left out, the phase before's. */
        weather: BossWeatherSchema.optional(),
        /** 第 3 步: how it moves and how long it rests between abilities from this phase on (`BetweenSchema`, ability-tactics.ts); left out, the phase before's. */
        between: BetweenSchema.optional(),
      }),
    )
    .max(BOSS_LIMITS.phases),
  death: z.strictObject({
    seconds: z.number().finite().min(BOSS_LIMITS.death.min).max(BOSS_LIMITS.death.max),
    xp_bursts: z.number().int().min(0).max(BOSS_LIMITS.bursts),
    explosion: z.boolean(),
    /** Boss 能力 15: the death as timed steps (`boss-show.ts`), all played before it is gone; left out, it dies as the fields above say, as it always was. */
    steps: BossShowStepsSchema.optional(),
  }),
  leash: z.strictObject({ reset_after_death_seconds: z.number().min(0).max(30).optional(), distance: z.number().finite().min(BOSS_LIMITS.leash.min).max(BOSS_LIMITS.leash.max), reset_seconds: z.number().finite().min(BOSS_LIMITS.reset.min).max(BOSS_LIMITS.reset.max) }).nullable(),
  /** Added later: its lair, a structure generated with the world that holds the boss (`LairSchema`). Absent or null: it has none and is met as it always was. */
  lair: LairSchema.nullable().optional(),
  /** Boss 能力 12: fixtures put down round its home and the fog its abilities raise (arena.ts). Absent or null: none, as it always was. */
  arena: ArenaSchema.nullable().optional(),
  /** What every boss of a big boss mod has (boss-base.ts): damage_cap, dps_cap, regen, scaling. Absent or null: none of it, as it always was. */
  ...BossBaseShape,
  /** How a player calls it up (`SummonSchema`). Absent or null: it is met only where it spawns, in its lair or where gameplay puts it, as it always was. */
  summon: SummonSchema.nullable().optional(),
}).superRefine((boss,ctx)=>{
  const check=(steps:readonly (NonNullable<typeof boss.death.steps>[number] | NonNullable<(typeof boss.phases)[number]["finish"]>[number])[],path:(string|number)[])=>{
    if(!steps.some(s=>s.type==="particle" && extendedEmit(s)))return
    const events=steps.map(s=>({...s,at:"at" in s ? Number(s.at) : 0}))
    for(const issue of emitIssues(events,120,[])) ctx.addIssue({code:"custom",path:[...path,...issue.path.slice(1)],message:issue.message})
  }
  if(boss.intro?.steps) check(boss.intro.steps,["intro","steps"])
  if(boss.death.steps) check(boss.death.steps,["death","steps"])
  boss.phases.forEach((p,i)=>{if(p.finish)check(p.finish,["phases",i,"finish"])})
})
export type Boss = z.infer<typeof BossSchema>

/** 「巢上方清出来的空间只有 3 格，可是它的身体有 6 格高……」: the clearance of a lair that is lower than the creature that is to stand in it, in the person's words. */
export const lairClearanceWords = (clearance: number, height: number) =>
  `巢上方清出来的空间（clearance）只有 ${clearance} 格，可是这只生物的身体（碰撞箱）有 ${Number(height.toFixed(2))} 格高：生成的时候它会被埋在平台上方的岩石里。clearance 至少写 ${Math.ceil(height)}`

/**
 * What is wrong with a creature's `boss` that no single field shows, in the person's words, each with where it is. Only a hostile creature
 * fights, so only a hostile one may be a boss; the lines of life fall from the larger to the smaller; a motion played at a moment of the fight
 * is not one the creature already plays for something else; an ability a phase lists is one the creature has.
 */
export function bossDocumentIssues(creature: { behavior: string; health?: number; abilities?: readonly { id: string; name?: string }[] | null; combos?: readonly { id: string; name?: string }[] | null; boss?: Boss | null; hitbox?: { core: { height: number } } | null }) {
  const boss = creature.boss
  const found: { path: (string | number)[]; message: string }[] = []
  if (!boss) return found
  if (creature.behavior !== "hostile") found.push({ path: ["boss"], message: "只有敌对的生物（behavior 写 hostile）能当 Boss：别的生物不跟人打，血条、阶段和招式都用不上" })
  const reserved = (clip: string | null) => clip !== null && (RESERVED_CLIPS as readonly string[]).includes(clip)
  if (reserved(boss.intro?.clip ?? null)) found.push({ path: ["boss", "intro", "clip"], message: `登场不能用 ${boss.intro!.clip} 这个动作：它是生物平时、挨打或死的时候自己播的。给登场单独做一个动作` })
  boss.phases.forEach((phase, index) => {
    if (reserved(phase.clip)) found.push({ path: ["boss", "phases", index, "clip"], message: `变身不能用 ${phase.clip} 这个动作：它是生物平时、挨打或死的时候自己播的。给变身单独做一个动作` })
    if (index > 0 && phase.below >= boss.phases[index - 1]!.below) found.push({ path: ["boss", "phases", index, "below"], message: "阶段按血量从大到小写：后一个阶段的血量线（below）要比前一个小（例如 0.66，然后 0.33）" })
  })
  // What each phase may start, against what it has: its abilities, then its combos (`bossPhaseIds`).
  const choices = [...(creature.abilities ?? []), ...(creature.combos ?? [])]
  const strict = usesCombat(creature)
  found.push(...bossPhaseIssues(boss.phases, choices.map((choice) => choice.id), strict))
  // The air above its floor has to hold it, else it is made inside the rock over the platform. With a collision box stated that is known here; without one the model decides (`bossModelIssues`).
  if (boss.lair && creature.hitbox && boss.lair.clearance < Math.ceil(creature.hitbox.core.height)) found.push({ path: ["boss", "lair", "clearance"], message: lairClearanceWords(boss.lair.clearance, creature.hitbox.core.height) })
  const opening = boss.intro?.opening
  if (opening) {
    const named = choices.find((choice) => choice.id === opening)
    if (!named) found.push({ path: ["boss", "intro", "opening"], message: `登场以后的第一招 ${opening} 在这个生物的招式（abilities）和连招（combos）里都找不到：opening 要写它某一个招式或连招的 id；不想指定第一招就不写 opening` })
    else if (!bossFirstPhaseIds(boss.phases, choices.map((choice) => choice.id), strict).includes(opening))
      found.push({ path: ["boss", "intro", "opening"], message: `登场以后的第一招「${named.name ?? opening}」在第一阶段用不了：第一阶段只用没有写进任何阶段（abilities 或 add）的招式（所有招式都写进了阶段就都能用）。把它从阶段的 abilities / add 里拿出来，或者换一个第一阶段能用的招式当第一招` })
  }
  // What every boss of a big boss mod has (boss-base.ts), against its own life.
  if (creature.health !== undefined) found.push(...bossBaseIssues(boss, creature.health))
  return found
}

/**
 * How a hostile creature comes to have somebody to fight (its target). Whichever it is, everything it does
 * to fight — walking up, swinging, its abilities — is done to its target and to nobody else, and stops when
 * it has none.
 * - any_player: by itself it goes for the nearest player it can see.
 * - provoked: by itself it only goes for whoever just hurt it.
 * - none_by_itself: it never picks anybody; only gameplay code gives it a target.
 */
export const ENGAGEMENT_MODES = ["any_player", "provoked", "none_by_itself"] as const
export type Engagement = (typeof ENGAGEMENT_MODES)[number]
/** How far it fights, in blocks, and how long it keeps after somebody it cannot see, in ticks (vanilla's numbers for a mob with this follow range). */
export const ENGAGEMENT_LIMITS = { distance: 24, unseen_ticks: 60 } as const

// ---- flight and habits (飞行与习性, 10-12) ----

const LifeClipSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/)
const FlightSecondsSchema = z.number().finite().min(FLIGHT_LIMITS.seconds.min).max(FLIGHT_LIMITS.seconds.max)

/**
 * How a creature flies, as data (spec: 2026-10-12-epic-tier-flight.md, 二). Null or absent: it does not fly, as it always was.
 * - style: `soar` stays up by its speed (it glides on the wing and never stops in the air); `hover` may stand still in the air.
 * - speed: cruising speed, blocks a second; altitude: how high above the ground it flies, blocks; turn: the fastest it turns, degrees a second;
 *   climb: the steepest it climbs or dives, degrees; bank: how far its body leans into a turn (only how it looks), degrees.
 * - air_share: of the time nothing asks anything of it, the share it spends in the air (the rest it walks or rests on the ground).
 * - takeoff, land: the motion and the seconds each takes. clips: the motions of the air (`glide` for a soaring one, `hover` for a hovering one).
 * None of it changes a block of the world.
 */
export const FlightSchema = z.strictObject({
  style: z.enum(FLIGHT_STYLE_IDS),
  speed: z.number().finite().min(FLIGHT_LIMITS.speed.min).max(FLIGHT_LIMITS.speed.max),
  altitude: z.strictObject({
    min: z.number().finite().min(FLIGHT_LIMITS.altitude.min.min).max(FLIGHT_LIMITS.altitude.min.max),
    max: z.number().finite().min(FLIGHT_LIMITS.altitude.max.min).max(FLIGHT_LIMITS.altitude.max.max),
  }),
  turn: z.number().finite().min(FLIGHT_LIMITS.turn.min).max(FLIGHT_LIMITS.turn.max),
  climb: z.number().finite().min(FLIGHT_LIMITS.climb.min).max(FLIGHT_LIMITS.climb.max),
  bank: z.number().finite().min(FLIGHT_LIMITS.bank.min).max(FLIGHT_LIMITS.bank.max),
  air_share: z.number().finite().min(0).max(1),
  takeoff: z.strictObject({ clip: LifeClipSchema.nullable(), seconds: FlightSecondsSchema }),
  land: z.strictObject({ clip: LifeClipSchema.nullable(), seconds: FlightSecondsSchema }),
  clips: z.strictObject({ fly: LifeClipSchema, glide: LifeClipSchema.nullable(), hover: LifeClipSchema.nullable() }),
})
export type Flight = z.infer<typeof FlightSchema>

/**
 * How a creature lives, as data (spec: 三). Null or absent: it lives as it always did.
 * - active: when it is up; outside that time it goes home and rests (`rest.clip` plays; null: it only stands still).
 * - home: it stays within `radius` blocks of where it first stood, and comes back when it has strayed.
 * - prey: vanilla creatures it hunts when hungry (none: it hunts nothing); `hunger_seconds`: how long after a meal it is hungry again; `eat`: what it plays after a kill.
 * - alert: the first time a player comes within `distance` blocks it plays `clip` (and looks at them); not again for the next 30 seconds.
 *   `attack_distance` (left out: as before, it fights from as far as its engagement says): a hostile creature only picks a player as its target within that many
 *   blocks of it (or when the player has hit it); between the two distances it warns and does not attack. It must be under `distance`. Once it fights it keeps its target as ever.
 * Eating changes no health. The time is the world's clock, not the weather.
 */
export const HabitsSchema = z
  .strictObject({
    active: z.enum(HABIT_ACTIVE_IDS),
    rest: z.strictObject({ clip: LifeClipSchema.nullable() }).nullable(),
    home: z.strictObject({ radius: z.number().finite().min(HABIT_LIMITS.radius.min).max(HABIT_LIMITS.radius.max) }).nullable(),
    prey: z.array(z.string().refine((id) => id in VANILLA_PREY, { message: `猎物只能写原版生物的 id（不带 minecraft:）：${VANILLA_PREY_IDS.join("、")}` })).max(HABIT_LIMITS.prey),
    hunger_seconds: z.number().finite().min(HABIT_LIMITS.hunger.min).max(HABIT_LIMITS.hunger.max),
    eat: z.strictObject({ clip: LifeClipSchema.nullable() }).nullable(),
    alert: z
      .strictObject({
        clip: LifeClipSchema.nullable(),
        distance: z.number().finite().min(HABIT_LIMITS.distance.min).max(HABIT_LIMITS.distance.max),
        attack_distance: z.number().finite().min(HABIT_LIMITS.attack.min).max(HABIT_LIMITS.attack.max).optional(),
      })
      .nullable(),
  })
  .superRefine((habits, context) => {
    habits.prey.forEach((id, index) => habits.prey.indexOf(id) !== index && context.addIssue({ code: "custom", path: ["prey", index], message: `猎物 ${id} 不要写两遍` }))
    if (habits.alert?.attack_distance !== undefined && habits.alert.attack_distance >= habits.alert.distance)
      context.addIssue({ code: "custom", path: ["alert", "attack_distance"], message: `扑上来的距离（attack_distance ${habits.alert.attack_distance}）要比警觉的距离（distance ${habits.alert.distance}）近：先警告，再靠近才开打` })
  })
export type Habits = z.infer<typeof HabitsSchema>

/**
 * What is wrong with a creature's `flight`, `habits` and the abilities that lean on them, that no single field shows, in the person's words,
 * each with where it is: the largest height is above the smallest; a soaring one has its glide and a hovering one its hover; a motion played in the
 * air or at rest is not one the creature already plays for something else; a creature that stands on purpose does not fly; only a creature that
 * flies dives or fights in the air; what it hunts it must be able to hurt.
 */
export function flightDocumentIssues(creature: { attack_damage: number; behavior?: string; engagement?: string | null; stationary?: unknown; abilities?: readonly Pick<Ability, "id" | "dive" | "where">[] | null; flight?: Flight | null; habits?: Habits | null }) {
  const found: { path: (string | number)[]; message: string }[] = []
  const reserved = (clip: string | null) => clip !== null && (RESERVED_CLIPS as readonly string[]).includes(clip)
  const flight = creature.flight
  if (flight) {
    if (flight.altitude.max <= flight.altitude.min) found.push({ path: ["flight", "altitude", "max"], message: "飞行高度的上限（altitude.max）要比下限（altitude.min）大" })
    if (flight.style === "soar" && flight.clips.glide === null) found.push({ path: ["flight", "clips", "glide"], message: "滑翔型（soar）要有滑翔的动作：clips.glide 写模型里的动作名" })
    if (flight.style === "hover" && flight.clips.hover === null) found.push({ path: ["flight", "clips", "hover"], message: "悬停型（hover）要有悬停的动作：clips.hover 写模型里的动作名" })
    const clips: [(string | number)[], string | null][] = [
      [["flight", "takeoff", "clip"], flight.takeoff.clip],
      [["flight", "land", "clip"], flight.land.clip],
      [["flight", "clips", "fly"], flight.clips.fly],
      [["flight", "clips", "glide"], flight.clips.glide],
      [["flight", "clips", "hover"], flight.clips.hover],
    ]
    clips.forEach(([path, clip]) => reserved(clip) && found.push({ path, message: `飞行不能用 ${clip} 这个动作：它是生物平时、挨打或死的时候自己播的。给飞行单独做一个动作` }))
    if (creature.stationary) found.push({ path: ["flight"], message: "故意不走动的生物（stationary）不会飞：要么去掉 stationary，要么去掉 flight" })
  }
  ;(creature.abilities ?? []).forEach((ability, index) => {
    if (ability.dive && !flight) found.push({ path: ["abilities", index, "dive"], message: `招式 ${ability.id} 写了俯冲（dive），可是这只生物不会飞：先给它写 flight，或者去掉 dive` })
    if (ability.where === "air" && !flight) found.push({ path: ["abilities", index, "where"], message: `招式 ${ability.id} 要在天上用（where 写 air），可是这只生物不会飞：先给它写 flight，或者把 where 改成 ground 或 any` })
    if (ability.dive && ability.where === "ground") found.push({ path: ["abilities", index, "where"], message: `招式 ${ability.id} 是俯冲（dive），只能在天上用：where 写 air 或 any` })
  })
  const habits = creature.habits
  if (habits) {
    const clips: [(string | number)[], string | null | undefined][] = [
      [["habits", "rest", "clip"], habits.rest?.clip],
      [["habits", "eat", "clip"], habits.eat?.clip],
      [["habits", "alert", "clip"], habits.alert?.clip],
    ]
    clips.forEach(([path, clip]) => reserved(clip ?? null) && found.push({ path, message: `习性不能用 ${clip} 这个动作：它是生物平时、挨打或死的时候自己播的。给休息、进食和警觉各做一个动作` }))
    if (habits.prey.length && !(creature.attack_damage > 0)) found.push({ path: ["habits", "prey"], message: "写了猎物（prey）的生物要有近战攻击力（attack_damage 大于 0）：它是用嘴和爪子捕猎的，没有攻击力永远打不死猎物" })
    if (habits.active === "always" && habits.rest) found.push({ path: ["habits", "rest"], message: "active 写 always 的生物一直活动，不会去休息：要休息就把 active 写成 day 或 night，不休息就把 rest 写 null" })
    if (habits.alert?.attack_distance !== undefined) {
      const path = ["habits", "alert", "attack_distance"]
      if (creature.behavior !== undefined && creature.behavior !== "hostile") found.push({ path, message: "写了扑上来的距离（attack_distance）的生物要是敌对的（behavior 写 hostile）：不敌对的生物不会攻击，没有“先警告再开打”可言" })
      else if (creature.engagement === "provoked" || creature.engagement === "none_by_itself") found.push({ path, message: `写了扑上来的距离（attack_distance）的生物要自己挑玩家打（engagement 不写，或写 any_player）：engagement 写的是 ${creature.engagement}，它本来就不会因为玩家走近而开打，这个距离不起作用` })
    }
  }
  return found
}

/**
 * What is wrong with a creature's `tempt` that no single field shows: only a creature that follows is lured, and an item is named once.
 */
export function temptDocumentIssues(creature: { behavior?: string; tempt?: readonly string[] | null }) {
  const found: { path: (string | number)[]; message: string }[] = []
  const tempt = creature.tempt
  if (!tempt?.length) return found
  if (creature.behavior !== undefined && creature.behavior !== "follow")
    found.push({ path: ["tempt"], message: "写了引诱物（tempt）的生物要会跟人（behavior 写 follow）：不跟人的生物不会被任何东西引过来，这一行不起作用。要么把 behavior 改成 follow，要么去掉 tempt" })
  tempt.forEach((item, index) => tempt.indexOf(item) !== index && found.push({ path: ["tempt", index], message: `引诱物 ${item} 不要写两遍` }))
  return found
}

/** Everything a creature's document says that no single field shows: its boss, its flight, its habits and what lures it. */
/** More than an ordinary creature's experience is for a boss only (`CREATURE_LIFE_LIMITS`). */
export function experienceDocumentIssues(creature: { experience?: number | null; boss?: Boss | null }) {
  const experience = creature.experience ?? 0
  return experience > CREATURE_LIFE_LIMITS.experience && !creature.boss
    ? [{ path: ["experience"], message: `普通生物的经验（experience）最多 ${CREATURE_LIFE_LIMITS.experience}；写了 Boss（boss）的生物才能给更多，最多 ${CREATURE_LIFE_LIMITS.boss_experience}（原版末影龙第一次被打败给 12000，凋灵给 50）` }]
    : []
}

function sweepPhaseIssues(creature: {abilities?: readonly {events: readonly {type:string;sweep?:{phase_scales?:number[]}}[]}[] | null; boss?: Pick<Boss,"phases"> | null}) {
  return (creature.abilities ?? []).flatMap((a,i)=>a.events.flatMap((e,j)=>{
    const scales=e.sweep?.phase_scales
    if (!scales || (creature.boss?.phases.length && scales.length<=creature.boss.phases.length+1)) return []
    return [{ path:["abilities",i,"events",j,"sweep","phase_scales"],message:"光束按阶段乘倍率需要先设置 Boss 阶段，倍率最多填初始阶段加每次变身各一个。" }]
  }))
}
export const creatureDocumentIssues = (creature: Parameters<typeof aliasIssues>[0] & Parameters<typeof emitterPhaseIssues>[0] & Parameters<typeof bossDocumentIssues>[0] & Parameters<typeof flightDocumentIssues>[0] & Parameters<typeof temptDocumentIssues>[0] & Parameters<typeof experienceDocumentIssues>[0] & Parameters<typeof comboDocumentIssues>[0] & Parameters<typeof bossDropDocumentIssues>[0] & Parameters<typeof parryDocumentIssues>[0] & Parameters<typeof arenaDocumentIssues>[0] & Parameters<typeof tacticsDocumentIssues>[0] & Parameters<typeof steadyDocumentIssues>[0] & Parameters<typeof hitboxCombatIssues>[0] & Parameters<typeof sharedAbilityDocumentIssues>[0] & Parameters<typeof combatIssues>[0] & Parameters<typeof stanceDocumentIssues>[0]) => [...stanceDocumentIssues(creature), ...aliasIssues(creature), ...emitterPhaseIssues(creature), ...fixtureIssues(creature as Parameters<typeof fixtureIssues>[0]), ...combatIssues(creature), ...bossDocumentIssues(creature), ...flightDocumentIssues(creature), ...temptDocumentIssues(creature), ...experienceDocumentIssues(creature), ...comboDocumentIssues(creature), ...bossDropDocumentIssues(creature), ...bossShowDocumentIssues(creature), ...parryDocumentIssues(creature), ...arenaDocumentIssues(creature), ...tacticsDocumentIssues(creature), ...steadyDocumentIssues(creature), ...hitboxCombatIssues(creature), ...sweepPhaseIssues(creature), ...sharedAbilityDocumentIssues(creature)]

/**
 * Boss 能力 10: a part comes off only a boss (its runtime keeps which parts are gone and tells every player's game), and a boss touches at most `BOSS_LOOK_LIMITS.touched`
 * bones in all (what is hidden, shown or dropped is told as one number, a bit a bone). What the model has is checked against the model (`bossLookIssues`).
 */
export function bossDropDocumentIssues(creature: { behavior: string; abilities?: readonly { events: readonly { type: string; bone?: string }[] }[] | null; boss?: Boss | null }) {
  const found: { path: (string | number)[]; message: string }[] = []
  const boss = creature.behavior === "hostile" ? creature.boss : null
  ;(creature.abilities ?? []).forEach((ability, index) =>
    ability.events.forEach((event, place) => {
      if (event.type === "drop" && !boss) found.push({ path: ["abilities", index, "events", place], message: "只有 Boss 能掉部件（drop）：掉下来以后它身上这个部件要一直藏着，这要 Boss 的运行时来记。给它写上 boss，或者去掉这个 drop" })
    }),
  )
  if (!boss) return found
  const touched = new Set([
    ...boss.phases.flatMap((phase) => [...(phase.model?.hide ?? []), ...(phase.model?.show ?? []), ...(phase.model?.drop ?? []).map((drop) => drop.bone)]),
    ...(creature.abilities ?? []).flatMap((ability) => ability.events.flatMap((event) => (event.type === "drop" && event.bone ? [event.bone] : []))),
  ])
  if (touched.size > BOSS_LOOK_LIMITS.touched) found.push({ path: ["boss", "phases"], message: `阶段里藏起、显出和掉落的部件加起来最多 ${BOSS_LOOK_LIMITS.touched} 个，现在写了 ${touched.size} 个。合并一下：藏起一个部件，挂在它下面的部件也一起藏起` })
  return found
}

// ---- collision boxes (碰撞箱) ----

/**
 * `parts`: boxes one creature may have beside its core. Lengths are blocks; nothing is further from its feet than `reach`.
 * `step`: the highest step its core walks up without a jump (`core.step`); the game gives a mob 0.6, a player 0.6, a horse 1 and an iron golem 1.
 * `stuck`: the seconds it may get no nearer to whom it is after before it looks for another way (`stuck.seconds`).
 */
export const HITBOX_LIMITS = { parts: 16, blockers: 8, size: 16, reach: 16, name: 40, reason: 300, step: { min: 0.5, max: 3 }, stuck: { min: 1, max: 10, default: 3 } } as const

/**
 * A list of measured things that are meant, each by the name its finding gives (`what`) with why (`reason`): the shape `hitbox.justified` has
 * and a creature's own `justified` (below) has. The reason is shown to the reviewer and to the person, so it is bounded like a sentence.
 */
const justifiedList = (most: number) => z.array(z.strictObject({ what: z.string().trim().min(1).max(80), reason: z.string().trim().min(1).max(HITBOX_LIMITS.reason) })).max(most)
export const JustifiedListSchema = justifiedList(8)
/** A creature's own list also has room for one answer per ability and kind (`<ability id>:windup`, `<ability id>:timing`) and one for how it walks. */
export const CREATURE_JUSTIFIED_MOST = EPIC_LIMITS.abilities * 2 + 1
export const CreatureJustifiedSchema = justifiedList(CREATURE_JUSTIFIED_MOST)
/** r29c: how many motions a creature may keep for later (`later_clips`): as many as the largest tier's model may have. */
export const LATER_CLIPS_MOST = 32
export type JustifiedList = z.infer<typeof JustifiedListSchema>

/**
 * The reason a `justified` list gives for `what`, or null when it gives none (or an empty one). Names are compared the way the part sheet's are
 * (case, spaces and a full-width colon do not matter), so `"Spark:Windup"` and `"spark: windup"` are the same entry.
 */
export function justifiedReason(list: readonly { what: string; reason: string }[] | null | undefined, what: string) {
  const named = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "").replace("：", ":")
  return list?.find((entry) => named(entry.what) === named(what) && entry.reason.trim())?.reason.trim() ?? null
}

const boxSize = z.number().finite().min(0.1).max(HITBOX_LIMITS.size)
const boxPlace = z.number().finite().min(-HITBOX_LIMITS.reach).max(HITBOX_LIMITS.reach)

/**
 * One more box of a creature, in its own terms (blocks): the middle of its square footprint is `forward` ahead of
 * the creature's feet and `left` to its own left, its bottom is `up` above them, as the model stands as built; it is `width` wide both ways and
 * `height` tall. It turns about the creature with the way its body faces. `bone` (a part of the model, by name): the box also follows that
 * bone as the creature stands, walks and plays its abilities — the server plays no motion, so where the bone goes is measured at build time,
 * every 2 ticks of those motions, and the box is moved by how far the bone has gone from where it stands as built (`hitbox-follow.ts`).
 */
const PartDamageScaleSchema = z.number({ error: "部位伤害倍率要写 0 到 16 的有限数字" }).finite("部位伤害倍率必须是有限数字").min(0, "部位伤害倍率不能小于 0").max(16, "部位伤害倍率最多 16 倍")
const PartContactSchema = z.strictObject({
  ability: z.string({ error: "接触伤害的 ability 要写已有招式的 id" }).regex(/^[a-z][a-z0-9_]{0,31}$/, "接触伤害的 ability 用小写字母开头，只写小写字母、数字和下划线，最多 32 个字符"),
  from: z.number({ error: "接触伤害开始时间要写有限的秒数" }).finite("接触伤害开始时间要写有限的秒数").min(0, "接触伤害开始时间不能小于 0 秒").max(60, "接触伤害开始时间最多 60 秒").optional(),
  to: z.number({ error: "接触伤害结束时间要写有限的秒数" }).finite("接触伤害结束时间要写有限的秒数").positive("接触伤害结束时间必须大于 0 秒").max(60, "接触伤害结束时间最多 60 秒").optional(),
  damage: z.number({ error: "接触伤害 damage 要写有限数字" }).finite("接触伤害要写有限数字").positive("接触伤害必须大于 0").max(1024, "接触伤害最多 1024 点"),
  knockback: z.number({ error: "接触伤害击退 knockback 要写有限数字" }).finite("接触伤害击退要写有限数字").min(0, "接触伤害击退不能小于 0").max(4, "接触伤害击退最多 4"),
}).superRefine((contact, context) => {
  if (contact.to !== undefined && (contact.from ?? 0) >= contact.to) context.addIssue({ code: "custom", path: ["to"], message: "接触伤害的结束时间 to 必须晚于开始时间 from" })
})

export const HitboxPartSchema = z.strictObject({
  name: z.string().trim().min(1).max(HITBOX_LIMITS.name),
  forward: boxPlace,
  up: boxPlace,
  left: boxPlace,
  width: boxSize,
  height: boxSize,
  bone: z.string().trim().min(1).max(80).nullable().optional(),
  solid: z.boolean({ error: "部位是否实心，请写 true 或 false" }).optional(),
  damage_scale: PartDamageScaleSchema.optional(),
  phase_scales: z.array(z.strictObject({ phase: z.number({ error: "部位倍率的阶段 phase 要写整数" }).int("部位倍率的阶段 phase 要写整数").min(0, "部位倍率的阶段从 0（初始阶段）开始").max(BOSS_LIMITS.phases, "部位倍率的阶段超过 Boss 支持的换阶段次数"), damage_scale: PartDamageScaleSchema }), { error: "phase_scales 要写阶段倍率的列表" }).min(1, "按阶段改倍率至少写一个阶段").max(BOSS_LIMITS.phases + 1, "部位阶段倍率条数过多").superRefine((entries, context) => {
    entries.forEach((entry, index) => { if (entries.findIndex((other) => other.phase === entry.phase) !== index) context.addIssue({ code: "custom", path: [index, "phase"], message: "同一部位同一阶段只能写一个伤害倍率" }) })
  }).optional(),
  weakpoint_sound: z.enum(["entity.player.attack.crit", "block.anvil.land"], { error: "弱点声音写 entity.player.attack.crit（暴击声）或 block.anvil.land（金属重响）" }).nullable().optional(),
  contact: z.array(PartContactSchema, { error: "contact 要写接触伤害的列表" }).min(1, "接触伤害至少写一段招式").max(8, "每个部位最多写 8 段接触伤害").optional(),
})
export type HitboxPart = z.infer<typeof HitboxPartSchema>

/**
 * A creature's collision boxes. `core` is the one box the game itself knows: square, upright, centred on its
 * feet; it is what finds a path, is pushed, and suffocates. `parts` are further boxes that can be hit and used
 * like the creature itself; a part with `solid: true` also blocks movement. `justified`: measured misfits (`creature-hitbox.ts`) that are
 * meant, each by the name its finding gives with why; the reason is shown to the reviewer and the person.
 */
const blockerOffset = z.number({ error: "挡路部件的位置要填 -16 到 16 格" }).min(-HITBOX_LIMITS.reach, "位置最远 16 格").max(HITBOX_LIMITS.reach, "位置最远 16 格")
const blockerSize = z.number({ error: "挡路部件的宽高要填 0.1 到 16 格" }).min(0.1, "挡路部件的宽高至少 0.1 格").max(HITBOX_LIMITS.size, "挡路部件的宽高最多 16 格")
export const HitboxSchema = z
  .strictObject({
    core: z.strictObject({
      width: boxSize,
      height: boxSize,
      solid: z.boolean({ error: "身体是否实心，请写 true 或 false" }).optional(),
      /** How high its eyes are above its feet. Left out: 85% of the height, as the game does. */
      eye_height: z.number().finite().min(0).max(HITBOX_LIMITS.size).nullable().optional(),
      /** The highest step it walks up without jumping, in blocks. Left out: the game's 0.6 for a mob. A big body wants more (a 9-block giant: 1.5 to 2). */
      step: z.number().finite().min(HITBOX_LIMITS.step.min).max(HITBOX_LIMITS.step.max).nullable().optional(),
    }),
    blockers: z.array(z.strictObject({
      name: z.string({ error: "请给挡路部件起个名字" }).trim().min(1, "请给挡路部件起个名字").max(HITBOX_LIMITS.name, "挡路部件名字最多 40 个字"),
      forward: blockerOffset, up: blockerOffset, left: blockerOffset,
      width: blockerSize, height: blockerSize,
    }, { error: "挡路部件只写名称、位置和宽高，受击或跟骨骼的部位请写到 parts" }), { error: "blockers 要写成挡路部件列表" }).max(HITBOX_LIMITS.blockers, "只挡路的部件最多 8 个，请合并相邻的箱子").optional(),
    parts: z.array(HitboxPartSchema).max(HITBOX_LIMITS.parts).optional(),
    /**
     * What a big body does when it gets stuck: after `seconds` in which it has come no nearer to whom it is after, it looks for another way round (a fresh path to one side of
     * them, the other side the next time); with `squeeze` it may then also walk straight at them and jump over a block in its way. It never breaks blocks. Left out: nothing of this, as it always was.
     */
    stuck: z.strictObject({ seconds: z.number().finite().min(HITBOX_LIMITS.stuck.min).max(HITBOX_LIMITS.stuck.max).default(HITBOX_LIMITS.stuck.default), squeeze: z.boolean().default(false) }).nullable().optional(),
    justified: JustifiedListSchema.optional(),
  })
  .superRefine((hitbox, context) => {
    const names = new Set(hitbox.parts?.map(part => part.name))
    hitbox.blockers?.forEach((box, index) => {
      if (names.has(box.name)) context.addIssue({ code: "custom", path: ["blockers", index, "name"], message: `挡路部件「${box.name}」重名了，请给它一个单独的名字` })
      names.add(box.name)
    })
    if ((hitbox.core.eye_height ?? 0) > hitbox.core.height) context.addIssue({ code: "custom", path: ["core", "eye_height"], message: "眼睛的高度（eye_height）不能比身体的碰撞箱（core.height）还高" })
    ;(hitbox.parts ?? []).forEach((part, index) => (hitbox.parts ?? []).findIndex((other) => other.name === part.name) !== index && context.addIssue({ code: "custom", path: ["parts", index, "name"], message: `两个部位的碰撞箱不能用同一个名字（${part.name}）` }))
  })
export type Hitbox = z.infer<typeof HitboxSchema>

/** Hittable rows stay first so damage, animation and contact indices keep their meaning. */
export function collisionParts(body?: Hitbox | null): HitboxPart[] {
  return [...(body?.parts ?? []), ...(body?.blockers ?? [])]
}

/**
 * 技能资产: one ability of a shared ability asset as a creature uses it. `asset`: the ability asset (its hits, events and pushes, `ability-asset.ts`); the rest is what only a
 * creature has, written as an ability of its own writes it: `id` (unique among its abilities and combos), `clip` (its model's motion), `windup` (seconds getting ready before
 * the asset's first moment; left out: the asset's charge, or 0), `facing`, `start` and `stopped_by_hurt`. The creature must depend on the asset.
 */
export const SharedAbilityUseSchema = z.strictObject({
  slot: z.int().nonnegative().optional(),
  ...AbilityTrackShape,
  dive: AbilitySchema.shape.dive,
  where: AbilitySchema.shape.where,
  on_hurt: AbilitySchema.shape.on_hurt,
  bones: z.record(HitBoneSchema, HitBoneSchema).optional(),
  particles: ParticleAliasesSchema.optional(),
  sounds: z.record(z.string().min(1).max(64), z.union([z.enum(ABILITY_SOUND_IDS), SoundAssetRefSchema])).optional(),
  damage_scale: z.number().finite().nonnegative().optional(),
  /** r29c: the size it is played at (`AbilityScaleSchema`, ability-scale.ts): a number, or `{reach, size, speed}`. Left out, as the asset writes it. */
  scale: AbilityScaleSchema.optional(),
  cooldown: AbilityStartSchema.shape.cooldown.optional(),
  asset: z.uuid(),
  id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "招式的 id 用小写字母开头，只含小写字母、数字和下划线"),
  clip: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/),
  windup: AbilityTimeSchema.optional(),
  facing: z.enum(["track", "lock"]),
  start: AbilityStartSchema,
  ...CombatAbilityShape,
  interrupt: InterruptSchema.optional(),
  stopped_by_hurt: z.boolean().default(false),
})
export type SharedAbilityUse = z.infer<typeof SharedAbilityUseSchema>

/** 技能资产: a creature's shared abilities go by ids none of its own abilities or combos has, each once; only a hostile creature fights with them. */
export function sharedAbilityDocumentIssues(creature: { behavior: string; abilities?: readonly { id: string }[] | null; combos?: readonly { id: string }[] | null; shared_abilities?: readonly SharedAbilityUse[] | null }) {
  const shared = creature.shared_abilities ?? []
  const own = new Set([...(creature.abilities ?? []), ...(creature.combos ?? [])].map((entry) => entry.id))
  return [
    ...(shared.length && creature.behavior !== "hostile" ? [{ path: ["shared_abilities"], message: "只有敌对生物（behavior 写 hostile）会出招，别的生物不能写 shared_abilities" }] : []),
    ...shared.flatMap((use, index) => [
      ...(use.interrupt && !use.stopped_by_hurt ? [{ path: ["shared_abilities", index, "stopped_by_hurt"], message: "引用技能写了 interrupt，请把 stopped_by_hurt 改为 true。" }] : []),
      ...(own.has(use.id) ? [{ path: ["shared_abilities", index, "id"], message: `id「${use.id}」已经是它自己的一个招式或连招，引用的技能换一个 id` }] : []),
      ...(shared.findIndex((other) => other.id === use.id) !== index ? [{ path: ["shared_abilities", index, "id"], message: `两个引用的技能不能用同一个 id（${use.id}）` }] : []),
      ...(use.start.min_distance >= use.start.max_distance ? [{ path: ["shared_abilities", index, "start", "max_distance"], message: "能出招的最远距离（max_distance）要比最近距离（min_distance）大" }] : []),
    ]),
  ]
}

/**
 * What every creature has besides its numbers, added later and absent in older projects: a creature
 * without any of them is generated exactly as before (it roams, and drops nothing).
 */
export const CREATURE_LIFE_FIELDS = {
  builtin: BuiltinSchema.optional(),
  particles: ParticleAliasesSchema.optional(),
  emitters: EmittersSchema.optional(),
  ...CombatCreatureShape,
  /** What it drops when it dies. */
  loot: CreatureLootListSchema.nullable().optional(),
  /** Experience points a player gets for killing it. */
  experience: z.number().int().min(0).max(CREATURE_LIFE_LIMITS.boss_experience).nullable().optional(),
  /** Set only for a creature that must not roam; null or absent means it walks about when nothing else is going on. */
  stationary: StationarySchema.nullable().optional(),
  /** What it does to whoever it fights, each with its own timing (招式). Null, absent or empty: it hits the old way, at once. */
  abilities: AbilityListSchema.nullable().optional(),
  /** Combos (连招): its abilities played one after another as one move, chosen like an ability (`ComboSchema`). Null, absent or empty: none, as it always was. */
  combos: ComboListSchema.nullable().optional(),
  /** How it comes to fight somebody. Null or absent: as it always was (see `ENGAGEMENT_MODES`). Only a hostile creature fights at all. */
  engagement: z.enum(ENGAGEMENT_MODES).nullable().optional(),
  /**
   * What was measured of this creature as a whole (not of its model, which has its own part sheet) and is meant, each by the name its finding gives with why:
   * `walk_glides` (it slides when it moves: a snail, a ghost), and per ability `<ability id>:windup` / `<ability id>:timing` (an aura, a thorn burst, a contact
   * burn or a trap that has no wind-up on purpose). Why it exists: a creature's maker can change neither its model nor the measuring, so without a way to say "this is how it is
   * meant" a legitimate subject would be refused until its task failed (owner's rule: a gate stops only on what a player would obviously see as an error). Read by the
   * acceptance review and the creature's making loop only; the generated mod does not read it. Null or absent: nothing is answered, as it always was.
   */
  justified: CreatureJustifiedSchema.nullable().optional(),
  /**
   * r29c (狍鸮, 鵕鸟): motions of its model kept for a behaviour still to come, each with why (`clip`, the motion's name in the model; `reason`). One no ability, rule or gameplay plays is then said
   * as something to look at (`animation_later`), not as one to mend. Read by the build's findings only; the generated mod does not read it. Null or absent: none, as it always was.
   */
  later_clips: z.array(z.strictObject({ clip: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/, "动作名照模型里的写：字母开头，只含字母、数字和下划线"), reason: z.string().trim().min(1).max(HITBOX_LIMITS.reason) })).max(LATER_CLIPS_MOST).nullable().optional(),
  /** K1: its collision boxes. Null or absent: one square box as wide as the model's longest side, as it always was. */
  hitbox: HitboxSchema.nullable().optional(),
  /** Boss runtime (10-12): the bar, wake-up, phases, death show and leash of a boss. Null or absent: an ordinary creature, as it always was. Only a hostile creature may have it. */
  boss: BossSchema.nullable().optional(),
  /** Flight (10-12): how it flies (state machine, steering, takeoff and landing). Null or absent: it does not fly, as it always was. */
  flight: FlightSchema.nullable().optional(),
  /** Habits (10-12): when it rests, where its home is, what it hunts and how it is alert. Null or absent: it lives as it always did. */
  habits: HabitsSchema.nullable().optional(),
  /**
   * What lures a creature that follows (behavior follow): 1 to 4 items, the project's own or vanilla ones, written the way a drop is.
   * Null or absent: a player holding wheat, as it always was. Only a creature that follows may have it (`temptDocumentIssues`).
   */
  tempt: z.array(TemptItemSchema).min(1).max(CREATURE_LIFE_LIMITS.tempt).nullable().optional(),
  /** 第 3 步: how it fights between its abilities, its reactions and its enrage (`TacticsSchema`, ability-tactics.ts). Null or absent: as it always did. */
  tactics: TacticsSchema.nullable().optional(),
  steady: SteadySchema.nullable().optional(),
  stances: StancesSchema.optional(),
  /**
   * 技能资产: abilities of the project's own ability assets (`ability-asset.ts`) this creature uses as it uses its own, each with what only a creature has: the id it goes by,
   * the motion of its model, when getting ready ends, how it turns, when it may start and whether a blow stops it (`SharedAbilityUseSchema`). The build turns each into one of
   * its abilities (`sharedAbilityInline`). Null, absent or empty: none, as it always was.
   */
  shared_abilities: z.array(SharedAbilityUseSchema).max(EPIC_LIMITS.abilities).nullable().optional(),
} as const

export const EntitySchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(4000),
  health: z.number().finite().positive().max(1024),
  speed: z.number().finite().min(0).max(2),
  attack_damage: z.number().finite().min(0).max(1024),
  behavior: z.enum(["passive", "follow", "hostile"]),
  model_asset_id: z.uuid().nullable(),
  runtime: EntityRuntimeSchema.optional(),
  // Absent in older projects: a creature without it is generated exactly as before.
  sounds: CreatureSoundsSchema.nullable().optional(),
  name_en: EnglishNameSchema.nullable().optional(),
  // r29b: the name the game registers it by; null or absent: `creature_<its id>`, as it always was (`creatureName`).
  identifier: RegistryNameSchema.nullable().optional(),
  ...CREATURE_LIFE_FIELDS,
}).superRefine((entity, context) => creatureDocumentIssues(entity).forEach((issue) => context.addIssue({ code: "custom", ...issue })))
