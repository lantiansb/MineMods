import type { GeckoClass, VersionAdapter } from "./adapter"
import { CONTENT_1_20_1, CONTENT_1_21_1 } from "./content-version"
import { lacksOf } from "../version-lacks"

/**
 * The game versions the common layer is mapped to. The common layer is written in 1.21.1's shape, so 1.21.1 changes
 * nothing; 1.20.1 maps what is known to differ (第2阶段-统一生成器设计.md §C), each found by compiling the generated
 * tree against the real 1.20.1 class path (`test/target-javac.ts`) and by loading the data in a real 1.20.1 server.
 */

/**
 * What every generated creature has to be a baby, one class of the game's own for all of them: `AgeableMob` keeps the age ("Age" in the save, minus 24000 when
 * it is born a baby, counting up to 0 and growing up there), tells every player that it is a baby (a synced value) and answers `setBaby`, which the game's plain mob
 * answers with nothing. A creature of any kind has it, hostile and boss included: nothing here is bound to what it does. A hostile one (behavior hostile, a boss too) also implements the game's `Enemy`, the marker the game's own code and
 * gameplay code ask "is this an enemy" by (a conduit hits it, an iron golem fights it, a lead does not hold it); `Monster` is the class that carries it for vanilla,
 * which these creatures cannot extend (`AgeableMob` is the baby's). `Enemy` has no methods: sleeping near one and peaceful clearing are `Monster`'s and stay out. What is written beside it:
 * - `getBreedOffspring` (the one method `AgeableMob` leaves open): a new baby of the same kind, for anything that asks. Nothing in a generated mod breeds.
 * - `finalizeSpawn`: the game's animals each have a one in twenty chance to be born a baby in a herd; these are never born baby by themselves (that would change every
 *   creature there already is), only when somebody asks for it (`setBaby`, or Age in a command). A save from before has no Age and loads grown.
 * - `getScale` / `getAgeScale`: half the size, for the box, for the model and for every measure of its body the class takes from its scale. The game applies the
 *   baby's half to the collision box only (`getAgeScale`) and leaves the picture to the renderer; GeckoLib draws by `getScale` (and takes its height from it), so
 *   the half lives there and `getAgeScale` says 1, or the box would take it twice.
 */
const babyMembers1211 = (entity: string) => `    // ---- baby: the game's own age. setBaby(true) makes it half the size, it grows up by itself after the game's 24000 ticks, and the age is saved ----
    @Override public AgeableMob getBreedOffspring(net.minecraft.server.level.ServerLevel world, AgeableMob other) {
        ${entity} child = (${entity}) getType().create(world);
        if (child != null) child.setBaby(true);
        return child;
    }

    @Override public net.minecraft.world.entity.SpawnGroupData finalizeSpawn(net.minecraft.world.level.ServerLevelAccessor world, net.minecraft.world.DifficultyInstance difficulty, net.minecraft.world.entity.MobSpawnType reason, net.minecraft.world.entity.SpawnGroupData data) {
        return super.finalizeSpawn(world, difficulty, reason, data instanceof AgeableMob.AgeableMobGroupData ? data : new AgeableMob.AgeableMobGroupData(false));
    }

    @Override public float getScale() { return super.getScale() * (isBaby() ? net.minecraft.world.entity.LivingEntity.EXTRA_RENDER_CULLING_SIZE_WITH_BIG_HAT : 1.0f); }

    @Override public float getAgeScale() { return 1.0f; }

`

/**
 * 1.20.1: `finalizeSpawn` still takes the spawn's saved data (a fifth argument), and there is no `getAgeScale`: the
 * game's own `getScale` is already half for a baby and scales the collision box (`LivingEntity.getDimensions`), and
 * GeckoLib 4.8.4 draws by it, so nothing is overridden.
 */
const babyMembers1201 = (entity: string) => `    // ---- baby: the game's own age. setBaby(true) makes it half the size (the game's own getScale), it grows up by itself after the game's 24000 ticks, and the age is saved ----
    @Override public AgeableMob getBreedOffspring(net.minecraft.server.level.ServerLevel world, AgeableMob other) {
        ${entity} child = (${entity}) getType().create(world);
        if (child != null) child.setBaby(true);
        return child;
    }

    @Override public net.minecraft.world.entity.SpawnGroupData finalizeSpawn(net.minecraft.world.level.ServerLevelAccessor world, net.minecraft.world.DifficultyInstance difficulty, net.minecraft.world.entity.MobSpawnType reason, net.minecraft.world.entity.SpawnGroupData data, net.minecraft.nbt.CompoundTag saved) {
        return super.finalizeSpawn(world, difficulty, reason, data instanceof AgeableMob.AgeableMobGroupData ? data : new AgeableMob.AgeableMobGroupData(false), saved);
    }

`

const GECKOLIB_1211: Record<GeckoClass, string> = {
  GeoEntity: "software.bernie.geckolib.animatable.GeoEntity",
  AnimatableInstanceCache: "software.bernie.geckolib.animatable.instance.AnimatableInstanceCache",
  AnimatableManager: "software.bernie.geckolib.animation.AnimatableManager",
  Animation: "software.bernie.geckolib.animation.Animation",
  AnimationController: "software.bernie.geckolib.animation.AnimationController",
  AnimationState: "software.bernie.geckolib.animation.AnimationState",
  PlayState: "software.bernie.geckolib.animation.PlayState",
  RawAnimation: "software.bernie.geckolib.animation.RawAnimation",
  GeckoLibUtil: "software.bernie.geckolib.util.GeckoLibUtil",
  GeoModel: "software.bernie.geckolib.model.GeoModel",
  GeoEntityRenderer: "software.bernie.geckolib.renderer.GeoEntityRenderer",
  AutoGlowingGeoLayer: "software.bernie.geckolib.renderer.layer.AutoGlowingGeoLayer",
}

/**
 * GeckoLib 4.8.4 for 1.20.1 still keeps its animation classes in `core` (4.5+ for 1.21 moved them out). Ordered: the
 * most specific prefix first, so `PlayState` (in `core.object`) is not caught by the package below it.
 */
const GECKOLIB_1201_PACKAGES: readonly (readonly [string, string])[] = [
  ["software.bernie.geckolib.animation.PlayState", "software.bernie.geckolib.core.object.PlayState"],
  ["software.bernie.geckolib.animation.keyframe.", "software.bernie.geckolib.core.keyframe."],
  ["software.bernie.geckolib.animation.state.", "software.bernie.geckolib.core.state."],
  ["software.bernie.geckolib.animation.", "software.bernie.geckolib.core.animation."],
  ["software.bernie.geckolib.animatable.instance.", "software.bernie.geckolib.core.animatable.instance."],
  // A 组: the colour an effect is drawn in (GeckoLib for 1.21 keeps it in util).
  ["software.bernie.geckolib.util.Color", "software.bernie.geckolib.core.object.Color"],
]

const rewritePackages = (name: string) => GECKOLIB_1201_PACKAGES.reduce((value, [from, to]) => (value.startsWith(from) ? `${to}${value.slice(from.length)}` : value), name)

/** 1.21 renamed these data folders to the singular; 1.20.1 has the plural. */
const PLURAL_FOLDERS: Readonly<Record<string, string>> = {
  loot_table: "loot_tables",
  recipe: "recipes",
  advancement: "advancements",
  structure: "structures",
  predicate: "predicates",
  item_modifier: "item_modifiers",
  function: "functions",
  "tags/block": "tags/blocks",
  "tags/item": "tags/items",
  "tags/entity_type": "tags/entity_types",
  "tags/fluid": "tags/fluids",
  "tags/game_event": "tags/game_events",
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** A recipe in 1.20.1's form: the result names its item as `item`; a cooking result is the item's id alone; a stone cutter's result is its id with the count beside it. */
function recipe1201(value: Record<string, Json>): Record<string, Json> {
  const result = value.result
  if (!result || typeof result !== "object" || Array.isArray(result) || typeof result.id !== "string") return value
  const type = String(value.type)
  if (/^minecraft:(smelting|blasting|smoking|campfire_cooking)$/.test(type)) return { ...value, result: result.id }
  if (type === "minecraft:stonecutting") return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => (key === "result" ? [["result", result.id], ["count", result.count ?? 1]] : [[key, entry]])))
  return { ...value, result: Object.fromEntries(Object.entries(result).map(([key, entry]) => [key === "id" ? "item" : key, entry])) }
}

/**
 * A loot table in 1.20.1's form: an enchantment a tool must carry is written in the item predicate's own list
 * (`enchantments: [{enchantment, levels}]`, not 1.21's sub-predicate map), and Looting's extra drops are
 * `looting_enchant` (1.21's `enchanted_count_increase` names the enchantment).
 */
function loot1201(value: Json): Json {
  if (Array.isArray(value)) return value.map(loot1201)
  if (!value || typeof value !== "object") return value
  if (value.function === "minecraft:enchanted_count_increase" && value.enchantment === "minecraft:looting")
    return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => (key === "enchantment" ? [] : [[key, key === "function" ? "minecraft:looting_enchant" : loot1201(entry)]])))
  const predicates = value.predicates
  if (value.predicates && typeof predicates === "object" && !Array.isArray(predicates) && predicates && Array.isArray(predicates["minecraft:enchantments"])) {
    const { predicates: _predicates, ...rest } = value
    const enchantments = (predicates["minecraft:enchantments"] as Json[]).map((entry) => (entry && typeof entry === "object" && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).map(([key, inner]) => [key === "enchantments" ? "enchantment" : key, inner])) : entry))
    return { ...Object.fromEntries(Object.entries(rest).map(([key, entry]) => [key, loot1201(entry)])), enchantments }
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, loot1201(entry)]))
}

/** 1.21.1: the renderer scales the shadow by the creature's scale itself (the game's own renderers do so too). */
const rendererShadow1211 = (entity: string) => `
    // The shadow is as big as the body is: half, for a baby (the game's own renderers scale it by the creature's scale as well).
    @Override protected float getShadowRadius(${entity} creature) { return super.getShadowRadius(creature) * creature.getScale(); }
`

/**
 * 1.20.5 made a synced value's default part of `defineSynchedData(SynchedEntityData.Builder)`; 1.20.1's has no parameter and
 * the class defines its values on its own `entityData`. Every such method of the 1.21.1 form becomes 1.20.1's, its body
 * (the builder's `define` calls, the call to its super) with it.
 */
function syncedData1201(source: string) {
  const head = /defineSynchedData\((?:[\w.]*\.)?SynchedEntityData\.Builder (\w+)\)\s*\{/g
  let out = ""
  let from = 0
  for (let found = head.exec(source); found; found = head.exec(source)) {
    const name = found[1]!
    const open = found.index + found[0].length
    let depth = 1
    let close = open
    while (close < source.length && depth > 0) {
      const letter = source[close++]
      if (letter === "{") depth++
      else if (letter === "}") depth--
    }
    const body = source
      .slice(open, close)
      .replaceAll(`super.defineSynchedData(${name})`, "super.defineSynchedData()")
      .replace(new RegExp(`\\b${name}\\.define\\(`, "g"), "this.entityData.define(")
    out += `${source.slice(from, found.index)}defineSynchedData() {${body}`
    from = close
    head.lastIndex = close
  }
  return out + source.slice(from)
}

/**
 * 1.20.1's members of the 1.21.1 shape whose parameters changed, as exact replacements: a mob's experience is dropped and counted
 * without the attacker and the level (`dropExperience()`, `getExperienceReward()`), and a call to a mob's `finalizeSpawn` with four
 * plain arguments takes the saved data as a fifth (none). The synced values: `syncedData1201`.
 */
const members1201 = (source: string) =>
  syncedData1201(abilities1201(source))
    .replace(/\b(protected|public) void dropExperience\((?:[\w.]*\.)?Entity \w+\)/g, "$1 void dropExperience()")
    .replace(/\bgetExperienceReward\(\w+, \w+\)/g, "getExperienceReward()")
    .replace(/\.finalizeSpawn\((\w+), (\w+), ([\w.]+), (\w+)\)/g, ".finalizeSpawn($1, $2, $3, $4, null)")

/**
 * A 组: what the abilities (`fabric/entity-abilities.ts`) and the effects (`fabric/effect.ts`) write in 1.21.1's shape that 1.20.1 has otherwise, as exact replacements of
 * what they write (each found by javac against the Forge 1.20.1 class path): an arrow is made without the stack and the weapon, a fireball takes its direction as three
 * numbers, the block a pulled victim stands on is read the way 1.20.1 does it (the game keeps that method to itself there), and a clip that collides for nobody names no
 * entity. What the effect entity and its renderer write otherwise is C 组's `body.plainEntity` and `body.rotations`.
 */
function abilities1201(source: string) {
  return source
    .replaceAll("new Arrow(level(), this, new ItemStack(Items.ARROW), null)", "new Arrow(level(), this)")
    .replaceAll("new SmallFireball(level(), this, aim)", "new SmallFireball(level(), this, aim.x, aim.y, aim.z)")
    .replaceAll("new LargeFireball(level(), this, aim, 1)", "new LargeFireball(level(), this, aim.x, aim.y, aim.z, 1)")
    .replaceAll("victim.getBlockPosBelowThatAffectsMyMovement()", "net.minecraft.core.BlockPos.containing(victim.getX(), victim.getY() - 0.500001, victim.getZ())")
    .replaceAll("ClipContext.Fluid.NONE, CollisionContext.empty())", "ClipContext.Fluid.NONE, (Entity) null)")
}

/**
 * 1.20.1's type has no eye height of its own (`EntityType.Builder.eyeHeight` is 1.20.5's): the class says it, in proportion to the box it is
 * asked about, so a baby's eyes are half as high as 1.21.1's scaled type has them.
 */
const eyeMember1201 = (eye: number, height: number) => `    // Its eyes as high as its document says, in proportion to its box (a baby's half as high): 1.20.1's type has no eye height of its own.
    @Override protected float getStandingEyeHeight(net.minecraft.world.entity.Pose pose, net.minecraft.world.entity.EntityDimensions dimensions) { return dimensions.height * (${eye.toFixed(4)}f / ${height.toFixed(4)}f); }

`

/**
 * 1.20.1 has no step-height attribute: the line that adds it to the attributes goes, and the constructor sets the entity's own maxUpStep (a private
 * field of `Entity`, reached only by its setter). Both places must be there: a class that does not have them is not one this was written for.
 */
function step1201(source: string, entity: string, step: number) {
  const attribute = `            .add(Attributes.STEP_HEIGHT, ${step})\n`
  const constructor = `public ${entity}(EntityType<? extends ${entity}> type, Level world) { super(type, world);`
  if (!source.includes(attribute) || !source.includes(constructor)) throw new Error(`STEP_HEIGHT_UNPLACED:${entity}`)
  return source.replace(attribute, "").replace(constructor, `${constructor} setMaxUpStep(${step}f);`)
}

/**
 * A class that extends `Entity` itself in 1.20.1: the packet that adds it to a player's world is its own to give (abstract there; 1.20.5 made it
 * the game's), it is asked whether it may change dimension rather than whether it may use a portal, and about an explosion without the explosion;
 * `EntityDimensions` is a class with fields there, not a record (a field of that type is read as `size.width`, not `size.width()`).
 */
function plainEntity1201(source: string) {
  const sizes = [...source.matchAll(/\bEntityDimensions (\w+) =/g)].map((found) => found[1]!)
  const read = sizes.reduce((text, name) => text.replace(new RegExp(`\\b${name}\\.(width|height)\\(\\)`, "g"), `${name}.$1`), source)
  const head = /\n(public (?:final )?class \w+ extends Entity\b[^{]*\{\n)/.exec(read)
  if (!head) throw new Error("PLAIN_ENTITY_UNPLACED")
  const packet = `    // 1.20.1 asks every entity for the packet that adds it to a player's world: the game's own, as 1.20.5 and later give it.
    @Override public net.minecraft.network.protocol.Packet<net.minecraft.network.protocol.game.ClientGamePacketListener> getAddEntityPacket() { return new net.minecraft.network.protocol.game.ClientboundAddEntityPacket(this); }

`
  return read
    .replace(head[1]!, `${head[1]!}${packet}`)
    .replace(/@Override public boolean canUsePortal\(boolean \w+\)/g, "@Override public boolean canChangeDimensions()")
    .replace(/@Override public boolean ignoreExplosion\((?:[\w.]*\.)?Explosion \w+\)/g, "@Override public boolean ignoreExplosion()")
}

/**
 * GeckoLib 4.8.4 (1.20.1) calls `applyRotations(animatable, poseStack, ageInTicks, rotationYaw, partialTick)`, without the native scale 4.5+ passes:
 * it has not scaled the pose by the creature's scale when it turns it, so what the 1.21.1 renderer divides by that scale is in blocks already.
 */
function rotations1201(source: string) {
  const head = /(protected void applyRotations\([\w.]+ \w+, PoseStack \w+, float \w+, float \w+, float \w+), float (\w+)\)/.exec(source)
  if (!head) return source
  const scale = head[2]!
  return source
    .replace(head[0], `${head[1]})`)
    .replace(new RegExp(`(super\\.applyRotations\\([^)]*), ${scale}\\)`), "$1)")
    .replace(new RegExp(`\\b${scale}\\b`, "g"), "1.0f")
}

/**
 * creature-extras in 1.20.1's members:
 * - A follower's lures: 1.20.1's `TemptGoal` takes an `Ingredient`, not a predicate. It is made of the lures that are in the game; with none of
 *   them there, no goal at all, as nothing draws it in 1.21.1 then: an empty `Ingredient` would take the empty hand (`Ingredient.test`).
 * - Its explosion's effects: the registry gives the `MobEffect` itself (`getOptional`, an unknown one fails the same), which 1.20.1's
 *   `MobEffectInstance` takes; 1.21.1's takes the `Holder`.
 * The goal line must be the one the generator writes, or the class is not one this was written for.
 */
function creatureExtras1201(source: string, entity: string) {
  const goal = `        goalSelector.addGoal(1, new TemptGoal(this, 1.2, ${entity}::isLure, false));`
  if (source.includes("::isLure") && !source.includes(goal)) throw new Error(`TEMPT_GOAL_UNPLACED:${entity}`)
  return source
    .replace(
      goal,
      `        // 1.20.1's TemptGoal takes an Ingredient: the lures that are in the game; with none of them there, no goal (an empty Ingredient would take the empty hand).
        net.minecraft.world.item.crafting.Ingredient lures = net.minecraft.world.item.crafting.Ingredient.of(LURES.stream().map(BuiltInRegistries.ITEM::get).map(ItemStack::new).filter(stack -> !stack.isEmpty()));
        if (!lures.isEmpty()) goalSelector.addGoal(1, new TemptGoal(this, 1.2, lures, false));`,
    )
    .replaceAll("BuiltInRegistries.MOB_EFFECT.getHolder(", "BuiltInRegistries.MOB_EFFECT.getOptional(")
}

export const VERSION_1_21_1: VersionAdapter = {
  minecraft: "1.21.1",
  packFormat: { data: 48, resource: 34 },
  java: 21,
  resourceLocation: (namespace, path) => `ResourceLocation.fromNamespaceAndPath(${namespace}, ${path})`,
  geckolib: (name) => GECKOLIB_1211[name],
  rewriteJava: (source) => source,
  dataFile: (file, text) => ({ file, text }),
  creature: { babyMembers: babyMembers1211, rendererShadow: rendererShadow1211 },
  boss: { cameraMove: "float", structureCodec: (mapCodec) => mapCodec, glowColour: (level) => `colour(${level})` },
  abilities: {
    renderColour: { params: "int colour", args: "colour" },
    lacks: lacksOf("1.21.1"),
  },
  body: { eyeBuilder: (eye) => `.eyeHeight(${eye.toFixed(4)}f)`, eyeMember: () => "", step: (source) => source, plainEntity: (source) => source, rotations: (source) => source },
  content: CONTENT_1_21_1,
  creatureExtras: (source) => source,
}

export const VERSION_1_20_1: VersionAdapter = {
  minecraft: "1.20.1",
  packFormat: { data: 15, resource: 15 },
  java: 17,
  resourceLocation: (namespace, path) => `new ResourceLocation(${namespace}, ${path})`,
  geckolib: (name) => rewritePackages(GECKOLIB_1211[name]),
  rewriteJava: (source) =>
    members1201(source)
      .replaceAll("ResourceLocation.fromNamespaceAndPath(", "new ResourceLocation(")
      .replace(/software\.bernie\.geckolib\.[\w.]+/g, (name) => rewritePackages(name)),
  dataFile: (file, text) => {
    const found = /^(src\/main\/resources\/data\/[^/]+\/)(.+)$/.exec(file)
    if (!found) return { file, text }
    const rest = found[2]!
    const folder = Object.keys(PLURAL_FOLDERS)
      .sort((a, b) => b.length - a.length)
      .find((name) => rest === name || rest.startsWith(`${name}/`))
    if (!folder) return { file, text }
    const moved = `${found[1]}${PLURAL_FOLDERS[folder]}${rest.slice(folder.length)}`
    if (!file.endsWith(".json") || (folder !== "recipe" && folder !== "loot_table")) return { file: moved, text }
    const parsed = JSON.parse(text) as Json
    const mapped = folder === "recipe" && parsed && typeof parsed === "object" && !Array.isArray(parsed) ? recipe1201(parsed) : folder === "loot_table" ? loot1201(parsed) : parsed
    return { file: moved, text: JSON.stringify(mapped, null, 2) }
  },
  // 1.20.1's renderer has no getShadowRadius(entity): the game halves a baby mob's shadow where it draws it (EntityRenderDispatcher).
  creature: { babyMembers: babyMembers1201, rendererShadow: () => "" },
  // Camera.move(double, double, double); StructureType.codec() is a Codec, which the MapCodec gives as codec().
  boss: { cameraMove: "double", structureCodec: (mapCodec) => `${mapCodec}.codec()`, glowColour: (level) => `${level}, ${level}, ${level}, 1.0f` },
  // GeckoLib 4.8.4's hooks take the colour as four floats (the rest of what the abilities write differently: abilities1201). The particles and the sound
  // came with 1.20.3 and later (read with javap from the 1.20.1 jar's ParticleTypes and SoundEvents against every id an ability may name).
  abilities: {
    renderColour: { params: "float red, float green, float blue, float alpha", args: "red, green, blue, alpha" },
    lacks: lacksOf("1.20.1"),
  },
  body: { eyeBuilder: () => "", eyeMember: eyeMember1201, step: step1201, plainEntity: plainEntity1201, rotations: rotations1201 },
  content: CONTENT_1_20_1,
  creatureExtras: creatureExtras1201,
}

export function versionAdapter(minecraft: string): VersionAdapter {
  if (minecraft === "1.21.1") return VERSION_1_21_1
  if (minecraft === "1.20.1") return VERSION_1_20_1
  throw new Error(`UNSUPPORTED_MINECRAFT_VERSION: ${minecraft}`)
}
