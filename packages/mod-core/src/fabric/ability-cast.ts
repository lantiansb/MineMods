import { terrainStatement } from "../common/terrain"
import { rangedSound } from "../sound-range"
import { emitArguments, emissionTimeline } from "../common/emit"
import { emitTicks, extendedEmit } from "../particle-emission"
import { CAST_LIMITS, CANCEL_WORDS, castTick, isScaled, scalables, scalarBase, scalarPer, timelineTicks, ASSET_EFFECTS, type AbilityAssetDocument, type AssetEvent, type AssetHit, type AssetPlace, type Binding } from "../ability-asset"
import { ABILITY_LIMITS, ABILITY_PROJECTILES, TICKS } from "../ability-words"
import { shapeRange } from "../creature-abilities"
import type { GenTarget } from "../platform/adapter"
import { CLIENT_PLATFORM_CLASS, PLATFORM_CLASS, PLATFORM_PACKAGE, importLines } from "../platform/facade"
import { FABRIC_LOADER } from "../platform/loader-fabric"
import { FABRIC_TARGET } from "../platform/target"
import { soundJava, type CustomSound } from "./sound"
import { EFFECT_RUNTIME } from "./effect"
import { BOSS_RUNTIME } from "./boss-runtime"
import { interruptCase } from "./combat"
import { groundFxSpec } from "../common/ground-fx"
import { warnLook, ABILITY_WARN } from "./ability-warn"
import { guidedShotsJava } from "../common/guided-flight"
import type { SoundRef } from "../sound"
import { SOUND_CATEGORIES, variedPitch } from "../sound"

/**
 * 技能资产 as what it adds to a generated mod: one runtime for every caster (`StudioAbilities`), the player's game's side of it (`StudioAbilityClient`), and the few lines each loader
 * wants of its own (the HUD and the tooltips). Only written when some ability asset of the project is bound to an item, a block or a cast action, so a project without one is
 * untouched, byte for byte. A creature that uses an ability asset does not need any of it: it plays the ability as one of its own (`withSharedAbilities`).
 *
 * - `StudioAbilities` (common): every ability's numbers and its timeline as code (`timelineN`, one method each), the casts going on, the waits, and the server's side: a player's use of a
 *   bound item (click, or held: the player's game says when it is let go, `Release`) or of a bound block (the block casts it, sparing that player and its allies), a cast action's key
 *   (`gesture`, called by the cast-action runtime), and `cast(caster, name)` for gameplay code. A caster is a living thing or a block: where it stands, the way it faces, what it aims at
 *   (a player's crosshair: the creature in it, else the block; a creature's target; a block's nearest enemy) and whose allies it spares (teams, tamed pets, other players when PvP is off).
 *   Its numbers grow with the level `scaling` counts (a player's experience level, attributes) and two multipliers of the server's config (`config/<mod>-abilities.properties`).
 *   What a player's game is told: `Sync` (one ability's state: charging, channelling, waiting, recasting, with its ticks) and `Power` (the config's two multipliers).
 * - `StudioAbilityClient` (client): what it was told, counted down every tick; the cast bar and the waits drawn over the HUD; the item's tooltip with its numbers counted for this player; the
 *   `Release` of a held cast when the use key is let go.
 * - Fabric: two entry points (`StudioAbilityFabric`, `StudioAbilityFabricClient`, added to fabric.mod.json) and the facade the runtime is written against (`StudioPlatform`, the Fabric
 *   adapter's own text, `platformFiles`); the HUD through `HudRenderCallback`, tooltips through `ItemTooltipCallback`.
 * - Forge 1.20.1: the HUD as an overlay registered on `RegisterGuiOverlaysEvent`, tooltips on `ItemTooltipEvent` (`StudioAbilityOverlay`, `StudioAbilityTooltip`, found by their annotations).
 * - NeoForge 1.21.1: the HUD as a layer registered on `RegisterGuiLayersEvent`, tooltips on `ItemTooltipEvent`, the same two classes.
 * Everything else is Mojang's names in 1.21.1's shape; the few members 1.20.1 has otherwise (an arrow's and a fireball's constructors, an attribute by its id) are written for it here.
 */

export const ABILITY_CAST = {
  package: "ability",
  table: "StudioAbilities",
  client: "StudioAbilityClient",
  fabric: "StudioAbilityFabric",
  fabricClient: "StudioAbilityFabricClient",
  overlay: "StudioAbilityOverlay",
  tooltip: "StudioAbilityTooltip",
  config: "abilities.properties",
} as const

export type AbilityCastInput = {
  particleIndices?: Readonly<Record<string, number>>
  modId: string
  terrainInteractions?:boolean
  packageName: string
  /** The ability assets that are bound to something, in the project's order: index i is ability i of the runtime. */
  abilities: readonly { id: string; document: AbilityAssetDocument }[]
  /** The cast actions of the project in the order the cast-action runtime numbers them (`compileGestures`); empty when it has none. */
  gestures: readonly string[]
  /** The project's own sounds, by asset id. */
  sounds: Readonly<Record<string, CustomSound>>
}

const real = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(4))))
const float = (value: number) => `${real(value)}f`
const quoted = (value: string) => JSON.stringify(value)
const list = <T>(values: readonly T[], show: (value: T) => string) => `{${values.map(show).join(", ")}}`
/** The name an ability goes by in the language files and in `cast(caster, name)`: its asset id without the dashes. */
export const abilityKey = (id: string) => id.replaceAll("-", "")

const MODES = { target: 0, everyone: 1, allies: 2 } as const
const SHAPES = { arc: 0, box: 1, sphere: 2, line: 3, cone: 4 } as const

/** Where an area hit's shape is counted from, as the call that decides the places. */
function placesCall(place: AssetPlace | undefined) {
  const value = place ?? "self"
  if (value === "self") return "new Vec3[] {c.origin()}"
  if (value === "target") return "aimedAt(c, target)"
  if (value === "center" || "fixture" in value) throw new Error("场地落点需要由首领释放")
  if (value.type === "around_target") return `around(c, target, ${value.count}, ${real(value.spread)})`
  return `pattern(c, new double[] {${value.points.flatMap((point) => [real(point.forward), real(point.left)]).join(", ")}})`
}

/** A number of the timeline that may grow, as the Java that counts it at the cast's level (`power`: the config's multiplier counts on it). */
const scaledJava = (value: number | { base: number; per_level: number }, max: number, power: boolean) =>
  isScaled(value) || power ? `(float) (scaled(${real(scalarBase(value))}, ${real(scalarPer(value))}, c.level, 0.0, ${real(max)})${power ? " * power" : ""})` : float(scalarBase(value))

function hitJava(hit: AssetHit, slot: number, v1201: boolean, remember: boolean, release: boolean, pkg: string, terrainPackage?:string) {
  if (hit.type === "shot") {
    const thrown = hit.projectile === "arrow" || hit.projectile === "snowball"
    const made = {
      arrow: v1201 ? "Arrow shot = new Arrow(c.world, c.owner);" : "Arrow shot = new Arrow(c.world, c.owner, new ItemStack(Items.ARROW), null);",
      snowball: "Snowball shot = new Snowball(c.world, c.owner);",
      small_fireball: v1201 ? "SmallFireball shot = new SmallFireball(c.world, c.owner, aim.x, aim.y, aim.z);" : "SmallFireball shot = new SmallFireball(c.world, c.owner, aim);",
      fireball: v1201 ? "LargeFireball shot = new LargeFireball(c.world, c.owner, aim.x, aim.y, aim.z, 1);" : "LargeFireball shot = new LargeFireball(c.world, c.owner, aim, 1);",
    }[hit.projectile]
    return [
      `// hit ${slot}: ${ABILITY_PROJECTILES[hit.projectile].name}`,
      "if (c.owner != null) {",
      `    Vec3 from = point(c.origin(), c.yaw(), ${real(hit.forward)}, ${real(hit.up)}, 0.0);`,
      ...(remember ? [`    c.emitHits.put(${slot}, new Vec3[]{from});`, `    c.emitYaw.put(${slot}, c.yaw());`] : []),
      "    Vec3 aim = aim(c, from, false, target);",
      `    ${made}`,
      ...(hit.projectile === "arrow"
        ? [
            "    shot.pickup = AbstractArrow.Pickup.DISALLOWED;",
            // An arrow takes its damage times its speed when it lands: this is the number written, at the speed written.
            `    shot.setBaseDamage(${scaledJava(hit.damage ?? 0, ABILITY_LIMITS.damage, true)}${release ? " * c.chargeScale" : ""} / ${real(hit.speed)});`,
          ]
        : []),
      "    shot.setPos(from);",
      thrown ? `    shot.shoot(aim.x, aim.y, aim.z, ${float(hit.speed)}, 0.0f);` : `    shot.setDeltaMovement(aim.scale(${real(hit.speed)}));`,
      ...(hit.once_group ? [`    ${pkg}.entity.StudioGroupedShot.attach(shot, c.onceHits.group(${JSON.stringify(hit.once_group)}, false, ${hit.once_skip_effects!==false}));`] : []),
      "    c.world.addFreshEntity(shot);",
      ...(hit.homing ? [`    if (target != null) guided.add(new Guided(shot, target, ${real(hit.homing.strength)}, ${real(hit.homing.range)}));`] : []),
      "    c.struck = true;",
      "}",
    ]
  }
  if (hit.type !== "area" || hit.shape.type === "arena") throw new Error("这次出手需要由生物释放")
  const shape = hit.shape
  const dims =
    shape.type === "arc"
      ? [shape.reach, shape.angle / 2, shape.low, shape.high, ...(shape.inner ? [shape.inner] : [])]
      : shape.type === "box"
        ? [shape.forward, shape.up, shape.left, shape.width, shape.height, shape.depth]
        : shape.type === "sphere"
          ? [shape.forward, shape.up, shape.left, shape.radius]
          : shape.type === "line"
            ? [shape.up, shape.length, shape.radius]
            : [shape.up, shape.length, shape.angle / 2]
  const aims = shape.type === "line" || shape.type === "cone"
  const range = shapeRange(shape) + Math.abs("up" in shape ? shape.up : 0) + 1
  const centre = aims
    ? `origin.add(0.0, ${real(shape.up)}, 0.0).add(aim(c, origin.add(0.0, ${real(shape.up)}, 0.0), ${shape.aim === "level"}, target).scale(${real(shape.length / 2)}))`
    : shape.type === "arc" ? `point(origin, c.yaw(), ${real(shape.reach / 2)}, ${real((shape.low + shape.high) / 2)}, 0.0)`
    : `point(origin, c.yaw(), ${real(shape.forward)}, ${real(shape.up)}, ${real(shape.left)})`
  const harmful = hit.hits !== "allies"
  return [
    `// hit ${slot}: ${shape.type}, ${hit.hits}`,
    "{",
    `    Vec3[] places = ${hit.warn ? `c.markers[${slot}] == null ? ${placesCall(hit.place)} : new Vec3[] {c.markers[${slot}].spot()}` : placesCall(hit.place)};`,
    ...(hit.warn ? [`    if (c.markers[${slot}] != null) c.markers[${slot}].stop();`] : []),
    ...(remember ? [`    c.emitHits.put(${slot}, java.util.Arrays.stream(places).map(origin -> ${centre}).toArray(Vec3[]::new));`, `    c.emitYaw.put(${slot}, c.yaw());`] : []),
    `    double[] shape = {${dims.map(real).join(", ")}};`,
    ...(release ? (shape.type === "box" ? [3, 4, 5] : shape.type === "sphere" ? [3] : shape.type === "arc" ? (shape.inner ? [0, 4] : [0]) : shape.type === "line" ? [1, 2] : [1]).map(index => `    shape[${index}] *= c.chargeScale;`) : []),
    `    float damage = ${harmful ? scaledJava(hit.damage, ABILITY_LIMITS.damage, true) : "0.0f"}${release ? " * c.chargeScale" : ""};`,
    `    float heal = ${hit.heal === undefined ? "0.0f" : scaledJava(hit.heal, CAST_LIMITS.heal, true)};`,
    `    double knockback = ${isScaled(hit.knockback) ? `scaled(${real(scalarBase(hit.knockback))}, ${real(scalarPer(hit.knockback))}, c.level, 0.0, ${real(ABILITY_LIMITS.knockback)})` : real(scalarBase(hit.knockback))};`,
    "    Set<LivingEntity> struck = new HashSet<>();",
    "    for (Vec3 at : places) {",
    ...(aims ? [`        Vec3 aim = aim(c, at.add(0.0, ${real(shape.up)}, 0.0), ${shape.aim === "level"}, target);`] : []),
    ...(hit.break_terrain!==undefined && terrainPackage ? [`        ${terrainPackage}.entity.StudioTerrain.smash(c.world, ${real(hit.break_terrain)}, victim -> inside(c,victim,${SHAPES[shape.type]},shape,at,${aims?"aim":"null"}));`] : []),
    `        for (LivingEntity victim : victims(c, ${MODES[hit.hits]}, at, ${real(range)}, target)) {`,
    `            if (struck.contains(victim) || !inside(c, victim, ${SHAPES[shape.type]}, shape, at, ${aims ? "aim" : "null"})) continue;`,
    ...(hit.blocked_by_walls ? [`            if (${terrainPackage ? `${terrainPackage}.entity.StudioTerrain.clip(c.world,at.add(0.0, ${real(aims ? shape.up : 0.05)}, 0.0), victim.getBoundingBox().getCenter(),2).isPresent() || ` : ""}c.world.clip(new ClipContext(at.add(0.0, ${real(aims ? shape.up : 0.05)}, 0.0), victim.getBoundingBox().getCenter(), ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, c.owner)).getType() != HitResult.Type.MISS) continue;`] : []),
    "            struck.add(victim);",
    ...(hit.once_group ? [`            var group = c.onceHits.group(${JSON.stringify(hit.once_group)}, false, ${hit.once_skip_effects !== false});`, "            boolean repeat = group.seen(victim);", "            if (repeat && group.skipEffects()) continue;", "            if (!strike(c, victim, repeat ? 0f : damage, heal, knockback, at)) continue;", "            group.mark(victim);"] : ["            if (!strike(c, victim, damage, heal, knockback, at)) continue;"]),
    ...hit.effects.map((effect) => `            victim.addEffect(new MobEffectInstance(MobEffects.${ASSET_EFFECTS[effect.effect].java}, ${effect.duration_ticks}, ${effect.amplifier}${effect.particles === false ? ", false, false, true" : ""}), c.owner);`),
    "        }",
    "    }",
    "    if (places.length > 0) c.struck = true;",
    "}",
  ]
}

function eventJava(event: AssetEvent, input: AbilityCastInput): string[] {
  if (event.type !== "particle" && event.type !== "sound" && event.type !== "shake" && event.type !== "effect" && event.type !== "hazard" && event.type !== "crack" && event.type !== "shockwave" && event.type !== "break" && event.type !== "terrain_rise" && event.type !== "block_swap" && event.type !== "beam") throw new Error("这个事件需要由生物释放")
  if (event.type === "beam") {
    const name = input.packageName + ".entity"
    const spec = groundFxSpec(event).replace("new StudioFxSpec(", "new " + name + ".StudioFxSpec(")
    return [`${name}.StudioFx.castBeam(c.world, ${spec}, c.origin(), c.yaw(), c.owner, target, () -> CASTS.get(c.key) == c ? 1 : 0, c.block != null);`]
  }
  if (event.type !== "particle" && (event.where==="hit" || ((event.type==="sound" || event.type==="shake") && event.where==="target"))) {
    const linked=event.where==="hit"
    const points=linked ? `c.emitHits.getOrDefault(${event.hit}, new Vec3[0])` : "new Vec3[]{aimPoint(c,target)}"
    const yaw=linked ? `c.emitYaw.get(${event.hit})` : "c.yaw()"
    const lines=event.type==="sound" ? [`c.world.playSound(null, landing.x, landing.y, landing.z, ${rangedSound(soundJava(event.sound,input.packageName,input.sounds),event.range_blocks,input.packageName+".entity.")}, ${soundSource(event.sound,input.sounds)}, ${float(event.volume)}, ${variedPitch(float(event.pitch),event.pitch_variation,"c.world.random")});`] : eventJava({...event,where:"self",hit:null},input).map(line=>line.replaceAll("c.origin()","landing").replaceAll("c.yaw()",yaw))
    return [`for (Vec3 landing : ${points}) if (landing != null) {`,...lines.map(line=>"    "+line),"}"]
  }
  if (event.type === "sound") return [`sound(c, ${rangedSound(soundJava(event.sound, input.packageName, input.sounds),event.range_blocks,input.packageName+".entity.")}, ${soundSource(event.sound, input.sounds)}, ${float(event.volume)}, ${variedPitch(float(event.pitch), event.pitch_variation, "c.world.random")});`]
  if (event.type === "shake") return [`if (c.world instanceof ServerLevel server) ${input.packageName}.entity.${BOSS_RUNTIME.shake}.send(server, c.origin(), ${float(event.strength)}, ${float(event.radius)}, ${castTick(event.seconds)});`]
  const from = event.where === "self" ? "c.origin()" : "aimPoint(c, target)"
  if (event.type === "break") {
    const centre = `point(from, c.yaw(), ${real(event.forward)}, ${real(event.up)}, ${real(event.left)})`
    return ["{", `    Vec3 from = ${from};`, "    LivingEntity breaker = c.owner != null ? c.owner : target;",
      `    if (from != null && breaker != null && c.world instanceof ServerLevel server) ${input.packageName}.entity.StudioBreak.smash(server, breaker, ${centre}, ${real(event.radius)}, ${real(event.height)}, ${float(event.hardness)}, ${event.drops}${event.particles === false ? ", false" : ""});`, "}"]
  }
  if (event.type === "terrain_rise" || event.type === "block_swap") {
    const code = terrainStatement(event, "from", "1f", { world: "c.world", yaw: "c.yaw()", owner: "c.owner", terrain: input.packageName + ".entity.StudioTerrain" })
    return ["{", `    Vec3 from = ${from};`, `    if (from != null) ${code}`, "}"]
  }
  if (event.type === "hazard" || event.type === "shockwave" || event.type === "crack") {
    const name = `${input.packageName}.entity`
    const spec = groundFxSpec(event).replace("new StudioFxSpec(", `new ${name}.StudioFxSpec(`).replace("StudioTerrain.popSpec", name + ".StudioTerrain.popSpec")
    const group = "once_group" in event && event.once_group ? `c.onceHits.group(${JSON.stringify(event.once_group)}, false, ${event.once_skip_effects !== false})` : null
    return ["{", `    Vec3 from = ${from};`, `    if (from != null) ${group ? "{ var fx = " : ""}${name}.StudioFx.start(c.world, ${spec}, point(from, c.yaw(), ${real(event.forward)}, 0.0, ${real(event.left)}), c.yaw(), c.owner, target, 1f, null);${group ? ` if (fx != null) fx.once = ${group}; }` : ""}`, "}"]
  }
  if (event.type === "particle" && (extendedEmit(event, true) || typeof event.particle !== "string" || event.where === "hit")) {
    const origins = event.where === "hit" ? `c.emitHits.getOrDefault(${event.hit}, new Vec3[0])` : `new Vec3[]{${from}}`
    const yaw = event.where === "hit" ? `c.emitYaw.get(${event.hit})` : "c.yaw()"
    const args = emitArguments(event, input.particleIndices)
    return [`if (c.world instanceof ServerLevel world) for (Vec3 origin : ${origins}) if (origin != null) ${input.packageName}.entity.StudioEmit.send(world, point(origin, ${yaw}, ${real(event.forward)}, ${real(event.up)}, ${real(event.left)}), ${yaw}, ${args});`]
  }
  if (event.type === "particle" && typeof event.particle === "string" && typeof event.spread === "number")
    return [
      "{",
      `    Vec3 from = ${from};`,
      `    if (from != null && c.world instanceof ServerLevel server) { Vec3 at = point(from, c.yaw(), ${real(event.forward)}, ${real(event.up)}, ${real(event.left)}); server.sendParticles(ParticleTypes.${event.particle.toUpperCase()}, at.x, at.y, at.z, ${event.count}, ${real(event.spread)}, ${real(event.spread)}, ${real(event.spread)}, 0.0); }`,
      "}",
    ]
  if (event.type !== "effect") throw new Error("Invalid particle event")
  return [
    "{",
    `    Vec3 from = ${from};`,
    `    if (from != null) ${input.packageName}.entity.${EFFECT_RUNTIME.table}.spawn(${quoted(event.effect)}, c.world, point(from, c.yaw(), ${real(event.forward)}, ${real(event.up)}, ${real(event.left)}), c.yaw()${event.size === undefined ? "" : ", 0.0f, 0.0f"}, c.caster, target${event.size === undefined ? "" : `, ${real(event.size)}f`});`,
    "}",
  ]
}

const soundSource = (ref: SoundRef, custom: Readonly<Record<string, CustomSound>>) => {
  const category = typeof ref === "string" ? null : custom[ref.asset]?.category
  return `SoundSource.${category ? SOUND_CATEGORIES[category].java : "PLAYERS"}`
}

/** One ability's timeline as one method: what happens on each of its ticks, counted from its release (a channel's: from each pulse). */
function timelineJava(document: AbilityAssetDocument, index: number, input: AbilityCastInput, v1201: boolean) {
  const moments = new Map<number, string[]>()
  const at = (seconds: number, lines: string[]) => moments.set(castTick(seconds), [...(moments.get(castTick(seconds)) ?? []), ...lines])
  document.hits.forEach((hit, slot) => at(hit.at, hitJava(hit, slot, v1201, document.events.some(e => "where" in e && e.where === "hit" && e.hit === slot), !!document.cast.release, input.packageName, input.terrainInteractions ? input.packageName : undefined)))
  document.moves.forEach((move) => {
    if ("type" in move) throw new Error("这个位移需要由生物释放")
    at(move.at, [`push(c, ${real(move.forward)}, ${real(move.up)});`])
  })
  document.events.forEach(event => (event.type === "particle" ? emitTicks(event).map(tick => tick / 20) : [event.at]).forEach(time => at(time, eventJava(event, input))))
  const ticks = [...moments.keys()].sort((a, b) => a - b)
  return `    /** 「${document.name}」: its timeline, tick by tick. */
${emissionTimeline(`timeline${index}`, true, document.events.some(e => e.type === "particle" && e.until !== undefined), ticks, tick => `        if (tick == ${tick}) {\n            LivingEntity target = target(c);\n${moments.get(tick)!.map(line => `            ${line}`).join("\n")}\n        }`)}`
}

/** The level its numbers are counted at, from `scaling`: the expression of `levelOf`'s two tables. */
const levelSources = (document: AbilityAssetDocument) => ({
  byLevel: (document.scaling?.scales_with ?? []).includes("level"),
  attributes: (document.scaling?.scales_with ?? []).flatMap((source) => (source.startsWith("attribute:") ? [source.slice("attribute:".length)] : [])),
})

const ROW_KINDS = { damage: 0, heal: 1, cooldown: 2 } as const

function commonSource(input: AbilityCastInput, target: GenTarget) {
  const v1201 = target.version.minecraft === "1.20.1"
  const abilities = input.abilities
  const items = abilities.flatMap((ability, index) => ability.document.bindings.flatMap((binding) => (binding.type === "item" ? [{ binding, index }] : [])))
  const blocks = abilities.flatMap((ability, index) => ability.document.bindings.flatMap((binding) => (binding.type === "block" ? [{ binding, index }] : [])))
  const stepping = blocks.some(({ binding }) => binding.trigger === "step")
  const keyed = input.gestures.map((gesture) => abilities.findIndex((ability) => ability.document.bindings.some((binding) => binding.type === "gesture" && binding.gesture === gesture)))
  const gestureKeys = keyed.some((index) => index >= 0)
  const shown = abilities.map((ability) => (ability.document.gesture ? input.gestures.indexOf(ability.document.gesture) : -1))
  const plays = shown.some((index) => index >= 0)
  const gestureClass = `${input.packageName}.gesture.${target.loader.facade ? "platform" : "fabric"}.GestureMod`
  const release = abilities.some(a => a.document.cast.release)
  const markers = abilities.some(a => a.document.hits.some(h => h.type === "area" && h.warn))
  const warnClass = `${input.packageName}.entity.StudioWarn`
  const guided = abilities.some(a => a.document.hits.some(hit => hit.type === "shot" && hit.homing))
  const rising = abilities.some(ability => ability.document.loop_pitch)
  const loopSound = rising ? "playLoop(c, ability, age);" : `if (age % ${TICKS} == 0 && age > 0) sound(c, LOOP[ability], SoundSource.PLAYERS, 1.0f, 1.0f);`
  const casts = abilities.map((ability) => ability.document.cast)
  const interrupts = casts.flatMap((cast, index) => cast.interrupt ? [interruptCase(cast.interrupt, index)] : [])
  const rows = abilities.map((ability) => scalables(ability.document).flatMap((entry) => (entry.what === "knockback" ? [] : [[ROW_KINDS[entry.what], scalarBase(entry.value), scalarPer(entry.value), entry.power ? 1 : 0]])))
  const sound = (ref: SoundRef | undefined) => (ref ? `${soundJava(ref, input.packageName, input.sounds)}` : "null")
  const attribute = v1201
    ? `        net.minecraft.world.entity.ai.attributes.Attribute attribute = BuiltInRegistries.ATTRIBUTE.get(key);
        return attribute != null && owner.getAttributes().hasAttribute(attribute) ? owner.getAttributeValue(attribute) : 0.0;`
    : "        return BuiltInRegistries.ATTRIBUTE.getHolder(key).filter(owner.getAttributes()::hasAttribute).map(owner::getAttributeValue).orElse(0.0);"
  const imports = [
    `${input.packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS}`,
    "java.io.IOException",
    "java.io.Reader",
    "java.io.Writer",
    "java.nio.file.Files",
    "java.nio.file.Path",
    "java.nio.file.Paths",
    "java.util.ArrayList",
    "java.util.HashMap",
    "java.util.HashSet",
    "java.util.LinkedHashMap",
    "java.util.List",
    "java.util.Map",
    "java.util.Properties",
    "java.util.Set",
    "java.util.function.IntPredicate",
    "net.minecraft.core.BlockPos",
    "net.minecraft.core.particles.ParticleTypes",
    "net.minecraft.core.registries.BuiltInRegistries",
    "net.minecraft.network.FriendlyByteBuf",
    "net.minecraft.resources.ResourceLocation",
    "net.minecraft.server.MinecraftServer",
    "net.minecraft.server.level.ServerLevel",
    "net.minecraft.server.level.ServerPlayer",
    "net.minecraft.sounds.SoundEvent",
    "net.minecraft.sounds.SoundEvents",
    "net.minecraft.sounds.SoundSource",
    "net.minecraft.util.Mth",
    "net.minecraft.world.InteractionHand",
    "net.minecraft.world.InteractionResult",
    "net.minecraft.world.damagesource.DamageSource",
    "net.minecraft.world.effect.MobEffectInstance",
    "net.minecraft.world.effect.MobEffects",
    ...(stepping ? ["net.minecraft.world.entity.Entity"] : []),
    "net.minecraft.world.entity.LivingEntity",
    "net.minecraft.world.entity.Mob",
    "net.minecraft.world.entity.OwnableEntity",
    "net.minecraft.world.entity.monster.Enemy",
    "net.minecraft.world.entity.player.Player",
    "net.minecraft.world.entity.projectile.AbstractArrow",
    "net.minecraft.world.entity.projectile.Arrow",
    "net.minecraft.world.entity.projectile.LargeFireball",
    "net.minecraft.world.entity.projectile.ProjectileUtil",
    "net.minecraft.world.entity.projectile.SmallFireball",
    "net.minecraft.world.entity.projectile.Snowball",
    "net.minecraft.world.item.ItemStack",
    "net.minecraft.world.item.Items",
    "net.minecraft.world.level.ClipContext",
    "net.minecraft.world.level.Level",
    "net.minecraft.world.level.block.Block",
    "net.minecraft.world.phys.AABB",
    "net.minecraft.world.phys.BlockHitResult",
    "net.minecraft.world.phys.EntityHitResult",
    "net.minecraft.world.phys.HitResult",
    "net.minecraft.world.phys.Vec3",
  ]
  return `package ${input.packageName}.${ABILITY_CAST.package};

${importLines(imports)}

/**
 * Generated by MineMods Studio: the project's abilities (技能) for every caster, run on the server. A caster is a living thing (a player, a creature) or a block a player used; one
 * cast at a time each, and every ability waits its own cooldown for each caster. Its numbers grow with the level its \`scaling\` counts, and two multipliers of the server's config
 * (config/${input.modId}-${ABILITY_CAST.config}: power on damage and healing, cooldown on the waits). A player's game is told only what it draws: the state of each ability.
 */
public final class ${ABILITY_CAST.table} {
    public static final int COUNT = ${abilities.length};
    /** Each ability's name: \`cast(caster, name)\` takes it, and its language key is ability.${input.modId}.<name>. */
    public static final String[] NAMES = ${list(abilities, (ability) => quoted(abilityKey(ability.id)))};
    static final int INSTANT = 0;
    static final int CHARGE = 1;
    static final int CHANNEL = 2;
    public static final int[] TYPE = ${list(casts, (cast) => String(cast.type === "instant" ? 0 : cast.type === "charge" ? 1 : 2))};
    /** Ticks it charges for, or is held for at most. */
    public static final int[] CAST_TICKS = ${list(casts, (cast) => String(castTick(cast.seconds)))};
    /** A channel's ticks from one pulse of its timeline to the next. */
    static final int[] EVERY = ${list(casts, (cast) => String(cast.tick_every ?? 1))};
    /** Ticks of the timeline: one past its last moment. */
    static final int[] LENGTH = ${list(abilities, (ability) => String(timelineTicks(ability.document)))};
    static final double[] REACH = ${list(abilities, (ability) => real(ability.document.reach))};
    static final int[] RECASTS = ${list(casts, (cast) => String(cast.recasts?.count ?? 0))};
    static final int[] RECAST_TICKS = ${list(casts, (cast) => String(cast.recasts ? castTick(cast.recasts.within) : 0))};
    static final boolean[] CANCEL_MOVE = ${list(casts, (cast) => String((cast.cancel_on ?? []).includes("move")))};
    static final boolean[] CANCEL_HURT = ${list(casts, (cast) => String((cast.cancel_on ?? []).includes("hurt")))};
    static final boolean[] CANCEL_SWAP = ${list(casts, (cast) => String((cast.cancel_on ?? []).includes("swap")))};
    static final double[] COOLDOWN_BASE = ${list(casts, (cast) => real(scalarBase(cast.cooldown)))};
    static final double[] COOLDOWN_PER = ${list(casts, (cast) => real(scalarPer(cast.cooldown)))};
    static final boolean[] BY_LEVEL = ${list(abilities, (ability) => String(levelSources(ability.document).byLevel))};
    static final String[][] ATTRIBUTES = ${list(abilities, (ability) => list(levelSources(ability.document).attributes, quoted))};
    /** Whether its numbers grow at all: the tooltip says the level they are counted at. */
    public static final boolean[] SCALED = ${list(abilities, (ability) => String(Boolean(ability.document.scaling)))};
    /** What a tooltip shows of each: {kind (0 damage, 1 healing, 2 cooldown), base, per level, 1 when the power multiplier counts}. */
    public static final double[][][] ROWS = ${list(rows, (entries) => list(entries, (row) => list(row, (value) => real(value))))};
    /** The cast action a player plays when casting it, by the cast-action runtime's number; -1 for none. */
    static final int[] GESTURE = ${list(shown, String)};
    /** The items of this mod that cast one: their path, the ability, and whether it is held (otherwise clicked). */
    public static final String[] ITEMS = ${list(items, (entry) => quoted((entry.binding as Extract<Binding, { type: "item" }>).item))};
    public static final int[] ITEM_ABILITY = ${list(items, (entry) => String(entry.index))};
${release ? `    public static final int[] MIN_RELEASE = ${list(abilities, a => String(a.document.cast.release ? Math.max(1, castTick(a.document.cast.release.min_seconds)) : 0))};\n` : ""}    public static final boolean[] ITEM_HOLD = ${list(items, (entry) => String((entry.binding as Extract<Binding, { type: "item" }>).use === "hold"))};
    /** The blocks of this mod that cast one when a player uses them, and the ability. */
    static final String[] BLOCKS = ${list(blocks, (entry) => quoted((entry.binding as Extract<Binding, { type: "block" }>).block))};
    ${stepping ? `static final int[] STEP = ${list(blocks, ({ binding }) => binding.trigger !== "step" ? "0" : binding.who === "living" ? "2" : "1")};\n    ` : ""}static final int[] BLOCK_ABILITY = ${list(blocks, (entry) => String(entry.index))};
${gestureKeys ? `    /** The ability each cast action's key casts, by the cast-action runtime's number; -1 for none. */\n    static final int[] GESTURE_KEYS = ${list(keyed, String)};\n` : ""}    private static final SoundEvent[] START = ${list(abilities, (ability) => rangedSound(sound(ability.document.sounds?.start),ability.document.sound_ranges?.start,input.packageName+".entity."))};
    private static final SoundEvent[] LOOP = ${list(abilities, (ability) => rangedSound(sound(ability.document.sounds?.loop),ability.document.sound_ranges?.loop,input.packageName+".entity."))};
    private static final SoundEvent[] END = ${list(abilities, (ability) => rangedSound(sound(ability.document.sounds?.end),ability.document.sound_ranges?.end,input.packageName+".entity."))};

    /** The server's two multipliers (its config), and what a player's game was told of them. */
    public static float power = 1.0f;
    public static float cooldownScale = 1.0f;

    /** One ability's state as a player's game draws it: 0 nothing, 1 charging (ticks done of total), 2 channelling, 3 waiting, 4 may be cast again (ticks left of total). */
    public record Sync(int ability, int state, int ticks, int total, int recasts, boolean held) {
        static void write(Sync sync, FriendlyByteBuf buffer) {
            buffer.writeVarInt(sync.ability);
            buffer.writeVarInt(sync.state);
            buffer.writeVarInt(sync.ticks);
            buffer.writeVarInt(sync.total);
            buffer.writeVarInt(sync.recasts);
            buffer.writeBoolean(sync.held);
        }

        static Sync read(FriendlyByteBuf buffer) { return new Sync(buffer.readVarInt(), buffer.readVarInt(), buffer.readVarInt(), buffer.readVarInt(), buffer.readVarInt(), buffer.readBoolean()); }
    }

    /** The server's multipliers, told to a player when they join. */
    public record Power(float power, float cooldown) {
        static void write(Power value, FriendlyByteBuf buffer) {
            buffer.writeFloat(value.power);
            buffer.writeFloat(value.cooldown);
        }

        static Power read(FriendlyByteBuf buffer) { return new Power(buffer.readFloat(), buffer.readFloat()); }
    }

    /** A player's game: the use key holding \`ability\` was let go. The sender is whoever the connection belongs to, never a field. */
    public record Release(int ability) {
        static void write(Release value, FriendlyByteBuf buffer) { buffer.writeVarInt(value.ability); }

        static Release read(FriendlyByteBuf buffer) { return new Release(buffer.readVarInt()); }
    }

    public static final ${PLATFORM_CLASS}.Channel<Sync> SYNC = ${PLATFORM_CLASS}.s2c("ability_sync", Sync.class, Sync::write, Sync::read);
    public static final ${PLATFORM_CLASS}.Channel<Power> POWER = ${PLATFORM_CLASS}.s2c("ability_power", Power.class, Power::write, Power::read);
    public static final ${PLATFORM_CLASS}.Channel<Release> RELEASE = ${PLATFORM_CLASS}.c2s("ability_release", Release.class, Release::write, Release::read, ${ABILITY_CAST.table}::release);

    /** Set by a player's game: whether it already knows the ability is being cast or waited for, so a click is not sent for nothing. */
    public static IntPredicate clientBusy = ability -> false;

    /** One cast going on. \`caster\` is the living thing casting (null for a block), \`owner\` whose allies it spares and whom its damage is counted to (the caster, or the player who used the block). */
    public static final class Cast {${input.abilities.some(a => [...a.document.events,...a.document.hits].some(v=>"once_group" in v && v.once_group)) ? `\n        final ${input.packageName}.entity.StudioOnce onceHits = new ${input.packageName}.entity.StudioOnce();` : ""}${input.abilities.some(a => a.document.events.some(e => "where" in e && e.where === "hit")) ? "\n        final java.util.Map<Integer, Vec3[]> emitHits = new java.util.HashMap<>();\n        final java.util.Map<Integer, Float> emitYaw = new java.util.HashMap<>();" : ""}
        final int ability;
        final String key;
        final Level world;
        final LivingEntity caster;
        final LivingEntity owner;
        final BlockPos block;
        final InteractionHand hand;
        final int slot;
        final boolean held;
        final boolean byGesture;
        final Vec3 start;
        final float blockYaw;${stepping ? "\n        LivingEntity steppedBy;" : ""}
        /** The level its numbers are counted at, fixed when it starts. */
        final double level;
${markers ? `        final ${warnClass}.Marker[] markers = new ${warnClass}.Marker[${Math.max(...abilities.map(a => a.document.hits.length))}];\n` : ""}        int age;
        boolean released;${release ? "\n        float chargeScale = 1.0f;\n        int releasedAt = -1;" : ""}
        /** Whether anything of its timeline has happened: an interrupted channel that did something still waits its cooldown. */
        boolean struck;
        int hurt;${interrupts.length ? "\n        float previousLife, damageTotal;\n        int hitCount;" : ""}

        Cast(int ability, Level world, LivingEntity caster, LivingEntity owner, BlockPos block, InteractionHand hand, int slot, boolean held, boolean byGesture, float blockYaw) {
            this.ability = ability;
            this.world = world;
            this.level = levelOf(ability, owner);
            this.caster = caster;
            this.owner = owner;
            this.block = block;
            this.hand = hand;
            this.slot = slot;
            this.held = held;
            this.byGesture = byGesture;
            this.blockYaw = blockYaw;
            this.key = caster != null ? caster.getUUID().toString() : world.dimension().location() + "@" + block.asLong();
            this.start = origin();
            this.hurt = caster != null ? caster.invulnerableTime : 0;${interrupts.length ? "\n            previousLife = caster != null ? caster.getHealth() + caster.getAbsorptionAmount() : 0;" : ""}
        }

        /** Where it stands: a living caster's feet, the middle of a block's bottom. */
        public Vec3 origin() { return caster != null ? caster.position() : Vec3.atBottomCenterOf(${stepping ? "steppedBy == null ? block : block.above()" : "block"}); }

        /** The way it faces: a living caster's own, a block's as decided when it began. */
        public float yaw() { return caster != null ? caster.getYRot() : blockYaw; }
    }

    private static final Map<String, Cast> CASTS = new LinkedHashMap<>();
    private static final Map<String, Long> COOLDOWNS = new HashMap<>();
    /** key#ability: {casts left, the tick its window closes}. */
    private static final Map<String, long[]> WINDOWS = new HashMap<>();
    private static long now;

    private ${ABILITY_CAST.table}() {}

    /** Run once by the common entry: the hooks into the game, and the packets above made as the class loads. */
    public static void register() {
        ${PLATFORM_CLASS}.onUseItem(${ABILITY_CAST.table}::useItem);
        ${PLATFORM_CLASS}.onUseBlock(${ABILITY_CAST.table}::useBlock);
        ${PLATFORM_CLASS}.onServerTick(${ABILITY_CAST.table}::tick);
        ${PLATFORM_CLASS}.onServerStarted(server -> {
            CASTS.clear();
            COOLDOWNS.clear();
            WINDOWS.clear();${guided ? "\n            guided.clear();" : ""}
            readConfig();
        });
        ${PLATFORM_CLASS}.onPlayerJoin(player -> POWER.sendTo(player, new Power(power, cooldownScale)));
    }

    // ---- the config ----

    /** Reads config/${input.modId}-${ABILITY_CAST.config}, writing it with its defaults when it is not there. A number that cannot be read is 1. */
    static void readConfig() {
        Path file = Paths.get("config", ${PLATFORM_CLASS}.MOD_ID + "-${ABILITY_CAST.config}");
        Properties values = new Properties();
        try {
            if (Files.exists(file)) {
                try (Reader reader = Files.newBufferedReader(file)) { values.load(reader); }
            } else {
                Files.createDirectories(file.getParent());
                try (Writer writer = Files.newBufferedWriter(file)) {
                    writer.write("# The abilities of " + ${PLATFORM_CLASS}.MOD_ID + ": power multiplies their damage and healing, cooldown their waits (1 is as made).\\npower=1.0\\ncooldown=1.0\\n");
                }
            }
        } catch (IOException | RuntimeException unreadable) {
            values.clear();
        }
        power = multiplier(values, "power");
        cooldownScale = multiplier(values, "cooldown");
    }

    private static float multiplier(Properties values, String name) {
        try {
            float value = Float.parseFloat(values.getProperty(name, "1.0").trim());
            return Float.isFinite(value) && value >= 0.0f ? Math.min(value, 100.0f) : 1.0f;
        } catch (NumberFormatException unreadable) {
            return 1.0f;
        }
    }

    // ---- numbers ----

    /** A number that grows: \`base\` plus \`per\` for every level, within its bounds. */
    public static double scaled(double base, double per, double level, double min, double max) { return Mth.clamp(base + per * level, min, max); }

    /** The level an ability's numbers are counted at for \`owner\`: its experience level and its attributes, as the ability's scaling says, at most ${CAST_LIMITS.level}. */
    public static double levelOf(int ability, LivingEntity owner) {
        if (owner == null) return 0.0;
        double level = BY_LEVEL[ability] && owner instanceof Player player ? player.experienceLevel : 0.0;
        for (String id : ATTRIBUTES[ability]) level += attribute(owner, id);
        return Mth.clamp(level, 0.0, ${real(CAST_LIMITS.level)});
    }

    private static double attribute(LivingEntity owner, String id) {
        ResourceLocation key = ResourceLocation.tryParse(id);
        if (key == null) return 0.0;
${attribute}
    }

    /** Ticks of its wait for a caster at \`level\`, with the config's multiplier. */
    static int cooldownTicks(int ability, double level) {
        return (int) Math.round(scaled(COOLDOWN_BASE[ability], COOLDOWN_PER[ability], level, 0.0, ${real(CAST_LIMITS.cooldown)}) * ${TICKS} * cooldownScale);
    }

    // ---- what casts it ----

    /** The binding of an item this mod's: its place in ITEMS, or -1. */
    public static int itemBinding(ItemStack stack) {
        if (stack.isEmpty()) return -1;
        ResourceLocation id = BuiltInRegistries.ITEM.getKey(stack.getItem());
        if (!id.getNamespace().equals(${PLATFORM_CLASS}.MOD_ID)) return -1;
        for (int index = 0; index < ITEMS.length; index++) if (ITEMS[index].equals(id.getPath())) return index;
        return -1;
    }

    static int blockBinding(Block block) {
        ResourceLocation id = BuiltInRegistries.BLOCK.getKey(block);
        if (!id.getNamespace().equals(${PLATFORM_CLASS}.MOD_ID)) return -1;
        for (int index = 0; index < BLOCKS.length; index++) if (BLOCKS[index].equals(id.getPath())) return index;
        return -1;
    }

    private static InteractionResult useItem(Player player, Level level, InteractionHand hand) {
        int bound = itemBinding(player.getItemInHand(hand));
        if (bound < 0) return InteractionResult.PASS;
        int ability = ITEM_ABILITY[bound];
        // A player's game: the click is sent to the server unless it already knows the ability is cast or waited for.
        if (level.isClientSide()) return clientBusy.test(ability) ? InteractionResult.CONSUME : InteractionResult.SUCCESS;
        if (!(player instanceof ServerPlayer server)) return InteractionResult.PASS;
        Cast going = CASTS.get(server.getUUID().toString());
        // A held use is sent again every few ticks while it is held: the cast it began goes on.
        if (going != null && going.ability == ability) return InteractionResult.CONSUME;
        return start(new Cast(ability, level, server, server, null, hand, hand == InteractionHand.MAIN_HAND ? server.getInventory().selected : -1, ITEM_HOLD[bound], false, 0.0f)) ? InteractionResult.SUCCESS : InteractionResult.CONSUME;
    }

    ${stepping ? `public static void step(Level level, BlockPos pos, Block block, Entity entity) {
        if (level.isClientSide() || !(entity instanceof LivingEntity actor) || !actor.isAlive() || actor.isSpectator()) return;
        int bound = blockBinding(block);
        if (bound < 0 || STEP[bound] == 0 || STEP[bound] == 1 && !(actor instanceof Player)) return;
        Cast c = new Cast(BLOCK_ABILITY[bound], level, null, null, pos.immutable(), null, -1, false, false, actor.getYRot());
        c.steppedBy = actor;
        start(c);
    }

    ` : ""}private static InteractionResult useBlock(Player player, Level level, InteractionHand hand, BlockHitResult hit) {
        if (hand != InteractionHand.MAIN_HAND || player.isSecondaryUseActive()) return InteractionResult.PASS;
        BlockPos pos = hit.getBlockPos();
        int bound = blockBinding(level.getBlockState(pos).getBlock());
        if (bound < 0${stepping ? " || STEP[bound] != 0" : ""}) return InteractionResult.PASS;
        if (level.isClientSide()) return InteractionResult.SUCCESS;
        if (!(player instanceof ServerPlayer server)) return InteractionResult.PASS;
        start(new Cast(BLOCK_ABILITY[bound], level, null, server, pos.immutable(), null, -1, false, false, server.getYRot()));
        return InteractionResult.SUCCESS;
    }
${
  gestureKeys
    ? `
    /** Asked by the cast-action runtime when a player presses the key of cast action \`gesture\`: whether it goes ahead (no ability is bound to it, or the bound one began). */
    public static boolean gesture(ServerPlayer player, int gesture) {
        int ability = gesture >= 0 && gesture < GESTURE_KEYS.length ? GESTURE_KEYS[gesture] : -1;
        if (ability < 0) return true;
        return start(new Cast(ability, player.level(), player, player, null, null, -1, false, true, 0.0f));
    }
`
    : ""
}
    /** For gameplay code: \`caster\` casts the ability \`name\` (its NAMES entry) as a creature or a player would; false when it may not now. */
    public static boolean cast(LivingEntity caster, String name) {
        for (int index = 0; index < COUNT; index++)
            if (NAMES[index].equals(name)) return !caster.level().isClientSide() && start(new Cast(index, caster.level(), caster, caster, null, null, -1, false, false, 0.0f));
        return false;
    }

    private static void release(ServerPlayer player, Release value) {
        Cast going = CASTS.get(player.getUUID().toString());
        if (going != null && going.ability == value.ability() && going.held) going.released = true;
    }

    // ---- a cast from start to end ----

    private static boolean start(Cast c) {${release ? "\n        if (MIN_RELEASE[c.ability] > 0 && !c.held) return false;" : ""}
        if (c.world.getServer() != null) now = c.world.getServer().getTickCount();
        if (CASTS.containsKey(c.key)) return false;
        Long ready = COOLDOWNS.get(c.key + "#" + c.ability);
        if (ready != null && ready > now) return false;
        CASTS.put(c.key, c);
        sound(c, START[c.ability], SoundSource.PLAYERS, 1.0f, 1.0f);
${plays ? `        if (!c.byGesture && GESTURE[c.ability] >= 0 && c.caster instanceof ServerPlayer player) ${gestureClass}.showFor(player, GESTURE[c.ability]);\n` : ""}        if (TYPE[c.ability] != INSTANT) sync(c, TYPE[c.ability] == CHARGE ? 1 : 2, TYPE[c.ability] == CHARGE ? 0 : CAST_TICKS[c.ability], CAST_TICKS[c.ability], 0);
        return true;
    }

${guided ? guidedShotsJava(true) : ""}    private static void tick(MinecraftServer server) {${guided ? "\n        guideShots();" : ""}
        now = server.getTickCount();
        WINDOWS.entrySet().removeIf(entry -> {
            if (entry.getValue()[1] > now) return false;
            String[] parts = entry.getKey().split("#");
            int ability = Integer.parseInt(parts[1]);
            cool(parts[0], ability, null, levelOfKey(server, parts[0], ability));
            return true;
        });
        for (Cast c : new ArrayList<>(CASTS.values())) {
            if (!alive(c)) {
                stop(c, false);
                continue;
            }
            if (interrupted(c)) {
                stop(c, c.struck);
                continue;
            }
            int ability = c.ability;
            int age = c.age++;${markers ? "\n            preview(c, age);" : ""}
            if (TYPE[ability] == CHANNEL) {
                if (age >= CAST_TICKS[ability] || (c.held && c.released)) {
                    finish(c);
                    continue;
                }
                ${loopSound}
                timeline(c, age % EVERY[ability]);
                continue;
            }
            int charge = TYPE[ability] == CHARGE ? CAST_TICKS[ability] : 0;
            ${release ? `if (MIN_RELEASE[ability] > 0) {
                if (!c.released) {
                    if (age < charge) { ${loopSound} }
                    continue;
                }
                if (age < MIN_RELEASE[ability]) {
                    stop(c, false);
                    continue;
                }
                if (c.releasedAt < 0) {
                    c.releasedAt = age;
                    c.chargeScale = Math.min(1.0f, age / (float)charge);
                    sync(c, 0, 0, 0, 0);
                }
                int tick = age - c.releasedAt;
                timeline(c, tick);
                if (tick + 1 >= LENGTH[ability]) finish(c);
                continue;
            }
            ` : ""}if (age < charge) {
                // A held charge let go before it is full is called off: it never went off, so it does not wait.
                if (c.held && c.released) {
                    stop(c, false);
                    continue;
                }
                ${loopSound}
                continue;
            }
            if (age == charge && charge > 0) sync(c, 0, 0, 0, 0);
            timeline(c, age - charge);
            if (age - charge + 1 >= LENGTH[ability]) finish(c);
        }
    }

    /** Whether the caster is still there: a living one alive in the world it began in, a block still the one that casts it. */
    private static boolean alive(Cast c) {
        if (c.caster != null) return c.caster.isAlive() && !c.caster.isRemoved() && c.caster.level() == c.world;
        return c.world.isLoaded(c.block) && blockBinding(c.world.getBlockState(c.block).getBlock()) >= 0 && BLOCK_ABILITY[blockBinding(c.world.getBlockState(c.block).getBlock())] == c.ability;
    }

    /** What interrupts it (its cancel_on), and a held item that is no longer held, which lets it go. */
    private static boolean interrupted(Cast c) {
        if (c.caster == null) return false;
        int ability = c.ability;
        double dx = c.caster.getX() - c.start.x;
        double dz = c.caster.getZ() - c.start.z;
        if (CANCEL_MOVE[ability] && dx * dx + dz * dz > 0.25) return true;
        boolean hurt = c.caster.invulnerableTime > c.hurt;
        c.hurt = c.caster.invulnerableTime;
        ${interrupts.length ? `float life = c.caster.getHealth() + c.caster.getAbsorptionAmount();
        float lost = Math.max(0, c.previousLife - life);
        c.previousLife = life;
        int tick = c.age;
        boolean window = switch (ability) { ${interrupts.map(row => row.window).join(" ")} default -> false; };
        if (window && (hurt || lost > 0)) {
            c.damageTotal += lost;
            c.hitCount++;
            float total = c.damageTotal, max = c.caster.getMaxHealth();
            int hits = c.hitCount;
            if (switch (ability) { ${interrupts.map(row => row.enough).join(" ")} default -> false; }) return true;
        }
        if (CANCEL_HURT[ability] && hurt && !(${casts.flatMap((cast,index) => cast.interrupt ? [`ability == ${index}`] : []).join(" || ")})) return true;` : "if (CANCEL_HURT[ability] && hurt) return true;"}
        if (c.hand != null && c.caster instanceof Player player) {
            boolean swapped = (c.hand == InteractionHand.MAIN_HAND && player.getInventory().selected != c.slot) || itemBinding(player.getItemInHand(c.hand)) < 0 || ITEM_ABILITY[itemBinding(player.getItemInHand(c.hand))] != ability;
            if (swapped && ${release ? "(CANCEL_SWAP[ability] || MIN_RELEASE[ability] > 0)" : "CANCEL_SWAP[ability]"}) return true;
            if (swapped && c.held) c.released = true;
        }
        return false;
    }

    /** It ended as it should: its end sound, and its wait (or one cast of its window). */
    private static void finish(Cast c) {
        sound(c, END[c.ability], SoundSource.PLAYERS, 1.0f, 1.0f);
        stop(c, true);
    }

    /** It is over; \`waits\`: its cooldown begins (or a cast of its window is used up), else it may be cast again at once. */
    private static void stop(Cast c, boolean waits) {
        CASTS.remove(c.key);${markers ? "\n        for (var marker : c.markers) if (marker != null) marker.stop();" : ""}
        if (!waits) {
${casts.some((cast) => cast.recasts) ? `            // Cancelling a recast does not spend its opportunity: show the window that still belongs to this caster.
            long[] window = WINDOWS.get(c.key + "#" + c.ability);
            if (window != null && window[1] > now) {
                sync(c, 4, (int) (window[1] - now), RECAST_TICKS[c.ability], (int) window[0]);
                return;
            }
` : ""}            sync(c, 0, 0, 0, 0);
            return;
        }
        String slot = c.key + "#" + c.ability;
        if (RECASTS[c.ability] > 0) {
            long[] window = WINDOWS.get(slot);
            if (window == null) {
                WINDOWS.put(slot, new long[] {RECASTS[c.ability], now + RECAST_TICKS[c.ability]});
                sync(c, 4, RECAST_TICKS[c.ability], RECAST_TICKS[c.ability], RECASTS[c.ability]);
                return;
            }
            if (--window[0] > 0) {
                sync(c, 4, (int) (window[1] - now), RECAST_TICKS[c.ability], (int) window[0]);
                return;
            }
            WINDOWS.remove(slot);
        }
        cool(c.key, c.ability, c, c.level);
    }

    private static void cool(String key, int ability, Cast c, double level) {
        int ticks = cooldownTicks(ability, level);
        COOLDOWNS.put(key + "#" + ability, now + ticks);
        if (c != null) sync(c, ticks > 0 ? 3 : 0, ticks, ticks, 0);
    }

    /** The level of the one a closed window belongs to, when it is a player still on the server; else 0. */
    private static double levelOfKey(MinecraftServer server, String key, int ability) {
        try {
            ServerPlayer player = server.getPlayerList().getPlayer(java.util.UUID.fromString(key));
            if (player != null) {
                int ticks = cooldownTicks(ability, levelOf(ability, player));
                SYNC.sendTo(player, new Sync(ability, ticks > 0 ? 3 : 0, ticks, ticks, 0, false));
                return levelOf(ability, player);
            }
        } catch (IllegalArgumentException block) {
            // A block's key: no player to tell.
        }
        return 0.0;
    }

    /** Tells the player who casts it (no one else draws it) what the ability is doing. */
    private static void sync(Cast c, int state, int ticks, int total, int recasts) {
        if (c.caster instanceof ServerPlayer player) SYNC.sendTo(player, new Sync(c.ability, state, ticks, total, recasts, c.held));
    }

${markers ? `    private static void preview(Cast c, int age) {
        if (!(c.world instanceof ServerLevel world)) return;
        LivingEntity target = target(c);
${abilities.flatMap((a,index) => a.document.hits.flatMap((h,i) => {
  if (h.type !== "area" || !h.warn || h.shape.type !== "sphere") return []
  const w = h.warn
  const when = castTick(h.at) + (a.document.cast.type === "charge" ? castTick(a.document.cast.seconds) : 0)
  const remain = a.document.cast.release ? `(c.releasedAt >= 0 ? c.releasedAt + ${castTick(h.at)} - age : c.released ? ${castTick(h.at)} : Math.max(1, ${when} - age))` : `${when} - age`
  return [`        if (c.ability == ${index}) {
            int left = ${remain};
            if (left >= 0 && left <= ${castTick(w.seconds)}) {
                Vec3 at = ${h.place === "target" ? "aimPoint(c, target)" : "c.origin()"};
                if (at == null) {
                    if (c.markers[${i}] != null) c.markers[${i}].stop();
                    c.markers[${i}] = null;
                } else {
                if (c.markers[${i}] == null) {
                    var packet = new ${warnClass}.Warn(c.owner.getId(), Math.max(1,left), ${warnLook(w)}, ${ABILITY_WARN.colors[w.color]}, 0, c.yaw(), 0f, ${float(h.shape.up)}, 0f, ${float(h.shape.radius)}, 0f, 0f, new double[] {at.x,at.y,at.z});
                    c.markers[${i}] = new ${warnClass}.Marker(world, c.caster, packet, null, ${castTick(w.lock_before ?? 0)}, ${castTick(w.fade_seconds ?? 0)}, ${quoted(w.effect ?? "")});
                }
                ${a.document.cast.release ? `c.markers[${i}].radiusScale(Math.min(1f, (c.releasedAt >= 0 ? c.releasedAt : age) / (float)CAST_TICKS[c.ability]));\n                ` : ""}c.markers[${i}].aim(${w.follow === "target" ? "aimPoint(c,target)" : w.follow === "caster" ? "c.origin()" : `c.markers[${i}].spot()`}, world.getGameTime() + Math.max(0,left));${a.document.events.some(e=>"where" in e && e.where==="hit" && e.hit===i && castTick(e.at)<castTick(h.at)) ? `\n                c.emitHits.put(${i},new Vec3[]{c.markers[${i}].spot().add(0.0,${real(h.shape.up)},0.0)});\n                c.emitYaw.put(${i},c.yaw());` : ""}
                }
            }
        }`]
})).join("\n")}
    }\n` : ""}    private static void timeline(Cast c, int tick) {
        switch (c.ability) {
${abilities.map((_, index) => `            case ${index} -> timeline${index}(c, tick);`).join("\n")}
            default -> {}
        }
    }

${abilities.map((ability, index) => timelineJava(ability.document, index, input, v1201)).join("\n")}
    // ---- where, at whom ----

    /** Whom it is aimed at: the creature in a player's crosshair (not through a wall), a creature's target, the nearest enemy of a block or another caster; within its reach. */
    static LivingEntity target(Cast c) {
        double reach = REACH[c.ability];${stepping ? "\n        if (c.steppedBy != null) return c.steppedBy.isAlive() && c.steppedBy.level() == c.world && c.steppedBy.distanceToSqr(c.origin()) <= reach * reach ? c.steppedBy : null;" : ""}
        if (c.caster instanceof Player player) {
            Vec3 eye = player.getEyePosition();
            Vec3 look = player.getViewVector(1.0f);
            BlockHitResult wall = c.world.clip(new ClipContext(eye, eye.add(look.scale(reach)), ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, player));
            double room = wall.getType() == HitResult.Type.MISS ? reach : wall.getLocation().distanceTo(eye);
            EntityHitResult hit = ProjectileUtil.getEntityHitResult(player, eye, eye.add(look.scale(room)), player.getBoundingBox().expandTowards(look.scale(room)).inflate(1.0), other -> other instanceof LivingEntity living && living.isAlive() && !other.isSpectator() && other.isPickable(), room * room);
            return hit != null && hit.getEntity() instanceof LivingEntity living ? living : null;
        }
        if (c.caster instanceof Mob mob) {
            LivingEntity aimed = mob.getTarget();
            return aimed != null && aimed.isAlive() && aimed.distanceTo(mob) <= reach ? aimed : null;
        }
        Vec3 at = c.origin();
        LivingEntity best = null;
        for (LivingEntity other : c.world.getEntitiesOfClass(LivingEntity.class, new AABB(at, at).inflate(reach), candidate -> candidate.isAlive() && candidate instanceof Enemy && candidate != c.caster && !ally(c, candidate)))
            if (best == null || other.distanceToSqr(at) < best.distanceToSqr(at)) best = other;
        return best;
    }

    /** The point it is aimed at: its target's feet; for a player with none, the block in the crosshair; else null. */
    static Vec3 aimPoint(Cast c, LivingEntity target) {
        if (target != null) return target.position();
        if (!(c.caster instanceof Player player)) return null;
        Vec3 eye = player.getEyePosition();
        BlockHitResult wall = c.world.clip(new ClipContext(eye, eye.add(player.getViewVector(1.0f).scale(REACH[c.ability])), ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, player));
        return wall.getType() == HitResult.Type.MISS ? null : wall.getLocation();
    }

    static Vec3[] aimedAt(Cast c, LivingEntity target) {
        Vec3 at = aimPoint(c, target);
        return at == null ? new Vec3[0] : new Vec3[] {at};
    }

    static Vec3[] around(Cast c, LivingEntity target, int count, double spread) {
        Vec3 at = aimPoint(c, target);
        if (at == null) return new Vec3[0];
        Vec3[] places = new Vec3[count];
        for (int index = 0; index < count; index++) {
            double angle = c.world.getRandom().nextDouble() * Math.PI * 2.0;
            double far = Math.sqrt(c.world.getRandom().nextDouble()) * spread;
            places[index] = new Vec3(at.x + Math.cos(angle) * far, at.y, at.z + Math.sin(angle) * far);
        }
        return places;
    }

    static Vec3[] pattern(Cast c, double[] points) {
        Vec3[] places = new Vec3[points.length / 2];
        for (int index = 0; index < places.length; index++) places[index] = point(c.origin(), c.yaw(), points[index * 2], 0.0, points[index * 2 + 1]);
        return places;
    }

    /** A place \`forward\` ahead (the way \`yaw\` faces), \`up\` above and \`left\` to the left of \`at\`. */
    static Vec3 point(Vec3 at, float yaw, double forward, double up, double left) {
        float turn = yaw * 0.017453292f;
        return new Vec3(at.x - forward * Mth.sin(turn) + left * Mth.cos(turn), at.y + up, at.z + forward * Mth.cos(turn) + left * Mth.sin(turn));
    }

    /** The way a beam, a cone or a shot from \`from\` goes: a player's crosshair, toward the target's middle, or (\`level\`, or nothing to aim at) level the way it faces. */
    static Vec3 aim(Cast c, Vec3 from, boolean level, LivingEntity target) {
        if (!level && c.caster instanceof Player player) return player.getViewVector(1.0f);
        if (!level && target != null) {
            Vec3 to = target.getBoundingBox().getCenter().subtract(from);
            if (to.lengthSqr() > 1.0e-4) return to.normalize();
        }
        float turn = c.yaw() * 0.017453292f;
        return new Vec3(-Mth.sin(turn), 0.0, Mth.cos(turn));
    }

    /** Whether \`other\` is on the caster's side: itself, its team, a pet it tamed, its own kind (a creature), another player while PvP is off (a player). */
    static boolean ally(Cast c, LivingEntity other) {
        LivingEntity owner = c.owner;
        if (owner == null) return false;
        if (other == owner || owner.isAlliedTo(other) || other.isAlliedTo(owner)) return true;
        if (other instanceof OwnableEntity pet && pet.getOwner() == owner) return true;
        if (!(owner instanceof Player)) return other.getType() == owner.getType();
        return other instanceof Player && owner.getServer() != null && !owner.getServer().isPvpAllowed();
    }

    /** Who a hit at \`at\` may reach: \`mode\` 0 its target, 1 everyone but its allies (and not a player in creative), 2 only its allies. */
    static List<LivingEntity> victims(Cast c, int mode, Vec3 at, double range, LivingEntity target) {
        if (mode == 0) return target != null && target.isAlive() && !ally(c, target) && !spared(target) ? List.of(target) : List.of();
        return c.world.getEntitiesOfClass(LivingEntity.class, new AABB(at, at).inflate(range),
            other -> other.isAlive() && !other.isSpectator() && (mode == 2 ? ally(c, other) : other != c.caster && !ally(c, other) && !spared(other)));
    }

    private static boolean spared(LivingEntity other) { return other instanceof Player player && (player.isCreative() || player.isSpectator()); }

    /** Whether \`victim\` is inside the shape counted from \`at\`, turned the way the caster faces: 0 arc, 1 box, 2 sphere, 3 line, 4 cone (the last two along \`aim\`). */
    static boolean inside(Cast c, ${input.terrainInteractions?"net.minecraft.world.entity.Entity":"LivingEntity"} victim, int kind, double[] shape, Vec3 at, Vec3 aim) {
        AABB box = victim.getBoundingBox();
        double wide = victim.getBbWidth() / 2.0;
        float turn = c.yaw() * 0.017453292f;
        double dx = victim.getX() - at.x;
        double dz = victim.getZ() - at.z;
        double ahead = -dx * Mth.sin(turn) + dz * Mth.cos(turn);
        double left = dx * Mth.cos(turn) + dz * Mth.sin(turn);
        switch (kind) {
            case 0: {
                if (box.maxY < at.y + shape[2] || box.minY > at.y + shape[3]) return false;
                double flat = Math.sqrt(ahead * ahead + left * left);
                if (flat - wide > shape[0]${abilities.some(a => a.document.hits.some(h => h.type === "area" && h.shape.type === "arc" && h.shape.inner)) ? " || shape.length > 4 && flat + wide <= shape[4]" : ""}) return false;
                if (flat <= wide) return true;
                return Math.abs(Math.toDegrees(Math.atan2(left, ahead))) <= shape[1] + Math.toDegrees(Math.asin(Math.min(1.0, wide / flat)));
            }
            case 1:
                return box.maxY >= at.y + shape[1] - shape[4] / 2.0 && box.minY <= at.y + shape[1] + shape[4] / 2.0 && Math.abs(ahead - shape[0]) <= shape[5] / 2.0 + wide && Math.abs(left - shape[2]) <= shape[3] / 2.0 + wide;
            case 2:
                return box.distanceToSqr(point(at, c.yaw(), shape[0], shape[1], shape[2])) <= shape[3] * shape[3];
            case 3: {
                Vec3 from = at.add(0.0, shape[0], 0.0);
                double along = Mth.clamp(box.getCenter().subtract(from).dot(aim), 0.0, shape[1]);
                return box.distanceToSqr(from.add(aim.scale(along))) <= shape[2] * shape[2];
            }
            default: {
                Vec3 to = box.getCenter().subtract(at.add(0.0, shape[0], 0.0));
                double far = to.length();
                if (far - wide > shape[1]) return false;
                if (far <= wide) return true;
                return Math.toDegrees(Math.acos(Mth.clamp(to.dot(aim) / far, -1.0, 1.0))) <= shape[2] + Math.toDegrees(Math.asin(Math.min(1.0, wide / far)));
            }
        }
    }

    /** Hurts, heals and pushes one it reached; false when its hurt did not land (the victim was still invulnerable). */
    static boolean strike(Cast c, LivingEntity victim, float damage, float heal, double knockback, Vec3 from) {
        if (damage > 0.0f && !victim.hurt(source(c, victim), damage)) return false;
        if (heal > 0.0f) victim.heal(heal);
        if (knockback > 0.0) victim.knockback(knockback, from.x - victim.getX(), from.z - victim.getZ());
        return true;
    }

    private static DamageSource source(Cast c, LivingEntity victim) {
        if (c.owner instanceof Player player) return victim.damageSources().playerAttack(player);
        if (c.owner != null) return victim.damageSources().mobAttack(c.owner);
        return victim.damageSources().magic();
    }

    /** The caster pushes itself: \`forward\` blocks a tick the way it faces and, above 0, \`up\` upward. A block does not move. */
    static void push(Cast c, double forward, double up) {
        if (c.caster == null) return;
        float turn = c.yaw() * 0.017453292f;
        c.caster.setDeltaMovement(-Mth.sin(turn) * forward, up > 0.0 ? up : c.caster.getDeltaMovement().y, Mth.cos(turn) * forward);
        c.caster.hasImpulse = true;
        c.caster.hurtMarked = true;
    }

${rising ? `    private static final float[] LOOP_FROM = ${list(abilities, a => float(a.document.loop_pitch?.from ?? 0))};
    private static final float[] LOOP_TO = ${list(abilities, a => float(a.document.loop_pitch?.to ?? 0))};

    private static void playLoop(Cast c, int ability, int age) {
        if (LOOP_FROM[ability] == 0) {
            if (age > 0 && age % 20 == 0) sound(c, LOOP[ability], SoundSource.PLAYERS, 1.0f, 1.0f);
            return;
        }
        int end = CAST_TICKS[ability] - 1;
        if (age % 4 == 0 || age == end) sound(c, LOOP[ability], SoundSource.PLAYERS, 1.0f, LOOP_FROM[ability] + (LOOP_TO[ability] - LOOP_FROM[ability]) * age / Math.max(1, end));
    }

` : ""}    static void sound(Cast c, SoundEvent sound, SoundSource source, float volume, float pitch) {
        if (sound == null) return;
        Vec3 at = c.origin();
        c.world.playSound(null, at.x, at.y, at.z, sound, source, volume, pitch);
    }
}
`
}

function clientSource(input: AbilityCastInput) {
  const imports = [
    `${input.packageName}.${PLATFORM_PACKAGE}.${CLIENT_PLATFORM_CLASS}`,
    "java.util.Arrays",
    "java.util.List",
    "java.util.Locale",
    "net.minecraft.ChatFormatting",
    "net.minecraft.client.Minecraft",
    "net.minecraft.client.gui.Font",
    "net.minecraft.client.gui.GuiGraphics",
    "net.minecraft.network.chat.Component",
    "net.minecraft.world.item.ItemStack",
  ]
  const T = ABILITY_CAST.table
  return `package ${input.packageName}.${ABILITY_CAST.package};

${importLines(imports)}

/**
 * Generated by MineMods Studio: a player's game's side of the abilities. What the server told it of each (\`${T}.Sync\`) counted on every tick, the cast bar and the waits drawn over
 * the HUD, the numbers of an item's ability in its tooltip (counted for this player, as the server counts them), and the use key let go while a held cast goes on (\`Release\`).
 */
public final class ${ABILITY_CAST.client} {
    private static final int[] STATE = new int[${T}.COUNT];
    private static final int[] TICKS = new int[${T}.COUNT];
    private static final int[] TOTAL = new int[${T}.COUNT];
    private static final int[] RECASTS = new int[${T}.COUNT];
    private static final boolean[] HELD = new boolean[${T}.COUNT];
    private static final boolean[] LET_GO = new boolean[${T}.COUNT];

    private ${ABILITY_CAST.client}() {}

    /** Run once by the client entry. */
    public static void register() {
        ${CLIENT_PLATFORM_CLASS}.onS2C(${T}.SYNC, ${ABILITY_CAST.client}::sync);
        ${CLIENT_PLATFORM_CLASS}.onS2C(${T}.POWER, power -> {
            ${T}.power = power.power();
            ${T}.cooldownScale = power.cooldown();
        });
        ${CLIENT_PLATFORM_CLASS}.onClientTick(${ABILITY_CAST.client}::tick);
        // A click on an item whose ability is being cast or waited for is not sent; one in its window of recasts is.
        ${T}.clientBusy = ability -> STATE[ability] != 0 && STATE[ability] != 4;
    }

    private static void sync(${T}.Sync sync) {
        if (sync.ability() < 0 || sync.ability() >= ${T}.COUNT) return;
        STATE[sync.ability()] = sync.state();
        TICKS[sync.ability()] = sync.ticks();
        TOTAL[sync.ability()] = sync.total();
        RECASTS[sync.ability()] = sync.recasts();
        HELD[sync.ability()] = sync.held();
        LET_GO[sync.ability()] = false;
    }

    private static void tick() {
        Minecraft game = Minecraft.getInstance();
        if (game.player == null) {
            Arrays.fill(STATE, 0);
            return;
        }
        for (int ability = 0; ability < ${T}.COUNT; ability++) {
            int state = STATE[ability];
            if (state == 1) TICKS[ability] = Math.min(TOTAL[ability], TICKS[ability] + 1);
            if (state >= 2 && --TICKS[ability] <= 0 && state >= 3) STATE[ability] = 0;
            // A held cast: the server is told the moment the use key is let go.
            if ((state == 1 || state == 2) && HELD[ability] && !LET_GO[ability] && !game.options.keyUse.isDown() && game.getConnection() != null) {
                LET_GO[ability] = true;
                ${CLIENT_PLATFORM_CLASS}.sendToServer(${T}.RELEASE, new ${T}.Release(ability));
            }
        }
    }

    private static Component name(int ability) { return Component.translatable("ability.${input.modId}." + ${T}.NAMES[ability]); }

    /** Over the HUD: the bar of what is being charged or channelled above the hotbar, and to its left every ability that is waiting, with the seconds left. */
    public static void hud(GuiGraphics graphics, float partialTick) {
        Minecraft game = Minecraft.getInstance();
        if (game.player == null || game.options.hideGui) return;
        Font font = game.font;
        int width = graphics.guiWidth();
        int height = graphics.guiHeight();
        int row = 0;
        for (int ability = 0; ability < ${T}.COUNT; ability++) {
            int state = STATE[ability];
            if (state == 1 || state == 2) {
                float done = TOTAL[ability] <= 0 ? 1.0f : state == 1 ? Math.min(1.0f, (TICKS[ability] + partialTick) / TOTAL[ability]) : Math.max(0.0f, (TICKS[ability] - partialTick) / TOTAL[ability]);
                int x = width / 2 - 50;
                int y = height - 72;
                graphics.fill(x - 1, y - 1, x + 101, y + 5, 0xA0000000);
                graphics.fill(x, y, x + Math.round(100 * done), y + 4, state == 1 ? 0xFFFFC040 : 0xFF50C8FF);
                graphics.drawCenteredString(font, name(ability), width / 2, y - 11, 0xFFFFFF);
            } else if (state >= 3) {
                int x = Math.max(2, width / 2 - 91 - 96);
                int y = height - 14 - row++ * 13;
                String left = String.format(Locale.ROOT, " %.1fs", TICKS[ability] / ${real(TICKS)}f);
                graphics.drawString(font, name(ability).copy().append(state == 4 ? left + " ×" + RECASTS[ability] : left), x, y, state == 4 ? 0x80FF80 : 0xC0C0C0);
                graphics.fill(x, y + 9, x + Math.round(90.0f * Math.max(0, TICKS[ability]) / Math.max(1, TOTAL[ability])), y + 10, state == 4 ? 0xFF60C060 : 0xFF808080);
            }
        }
    }

    /** The tooltip of an item that casts an ability: its name, how it is cast, and its numbers at this player's level with the server's multipliers. */
    public static void tooltip(ItemStack stack, List<Component> lines) {
        int bound = ${T}.itemBinding(stack);
        if (bound < 0) return;
        int ability = ${T}.ITEM_ABILITY[bound];
        double level = ${T}.levelOf(ability, Minecraft.getInstance().player);
        String type = ${T}.TYPE[ability] == 0 ? "instant" : ${T}.TYPE[ability] == 1 ? "charge" : "channel";
        ${input.abilities.some(a => a.document.cast.release) ? `if (${T}.MIN_RELEASE[ability] > 0) type = "release";\n        ` : ""}lines.add(name(ability).copy().withStyle(ChatFormatting.GOLD));
        lines.add(Component.translatable("tooltip.${input.modId}.ability.use." + type + "_" + (${T}.ITEM_HOLD[bound] ? "hold" : "click"), number(${T}.CAST_TICKS[ability] / ${real(TICKS)})).withStyle(ChatFormatting.GRAY));
        for (double[] row : ${T}.ROWS[ability]) {
            double value = ${T}.scaled(row[1], row[2], level, 0.0, row[0] == 2 ? ${real(CAST_LIMITS.cooldown)} : ${real(Math.max(ABILITY_LIMITS.damage, CAST_LIMITS.heal))});
            if (row[3] > 0) value *= ${T}.power;
            if (row[0] == 2) value *= ${T}.cooldownScale;
            if (value <= 0.0 && row[0] != 2) continue;
            lines.add(Component.translatable("tooltip.${input.modId}.ability." + (row[0] == 0 ? "damage" : row[0] == 1 ? "heal" : "cooldown"), number(value)).withStyle(ChatFormatting.DARK_GREEN));
        }
        String more = "tooltip.${input.modId}.ability." + ${T}.NAMES[ability] + ".more";
        if (net.minecraft.client.resources.language.I18n.exists(more)) lines.add(Component.translatable(more).withStyle(ChatFormatting.GRAY));
        if (${T}.SCALED[ability]) lines.add(Component.translatable("tooltip.${input.modId}.ability.scales", number(level)).withStyle(ChatFormatting.DARK_GRAY));
    }

    private static String number(double value) {
        String text = String.format(Locale.ROOT, "%.1f", value);
        return text.endsWith(".0") ? text.substring(0, text.length() - 2) : text;
    }
}
`
}

/** The loader's own few lines: the entry points (Fabric), the HUD and the tooltips. */
function loaderSources(input: AbilityCastInput, target: GenTarget): Record<string, string> {
  const pack = `${input.packageName}.${ABILITY_CAST.package}`
  if (target.loader.kind === "fabric")
    return {
      [ABILITY_CAST.fabric]: `package ${pack};

import net.fabricmc.api.ModInitializer;

/** Fabric's entry point for the abilities (fabric.mod.json, main). */
public final class ${ABILITY_CAST.fabric} implements ModInitializer {
    @Override public void onInitialize() { ${ABILITY_CAST.table}.register(); }
}
`,
      [ABILITY_CAST.fabricClient]: `package ${pack};

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.item.v1.ItemTooltipCallback;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;

/** Fabric's client entry point for the abilities (fabric.mod.json, client): the packets, the HUD through HudRenderCallback, the tooltips through ItemTooltipCallback. */
public final class ${ABILITY_CAST.fabricClient} implements ClientModInitializer {
    @Override public void onInitializeClient() {
        ${ABILITY_CAST.client}.register();
        HudRenderCallback.EVENT.register((graphics, counter) -> ${ABILITY_CAST.client}.hud(graphics, counter.getGameTimeDeltaPartialTick(true)));
        ItemTooltipCallback.EVENT.register((stack, context, flag, lines) -> ${ABILITY_CAST.client}.tooltip(stack, lines));
    }
}
`,
    }
  if (target.loader.kind === "forge")
    return {
      [ABILITY_CAST.overlay]: `package ${pack};

import ${input.packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.RegisterGuiOverlaysEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/** Forge (client): the abilities' cast bar and waits as an overlay of the HUD, above all of the game's. */
@Mod.EventBusSubscriber(modid = ${PLATFORM_CLASS}.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)
public final class ${ABILITY_CAST.overlay} {
    private ${ABILITY_CAST.overlay}() {}

    @SubscribeEvent public static void onOverlays(RegisterGuiOverlaysEvent event) {
        event.registerAboveAll("ability_cast", (gui, graphics, partialTick, width, height) -> ${ABILITY_CAST.client}.hud(graphics, partialTick));
    }
}
`,
      [ABILITY_CAST.tooltip]: `package ${pack};

import ${input.packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.event.entity.player.ItemTooltipEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/** Forge (client): an item's tooltip says the ability it casts. */
@Mod.EventBusSubscriber(modid = ${PLATFORM_CLASS}.MOD_ID, bus = Mod.EventBusSubscriber.Bus.FORGE, value = Dist.CLIENT)
public final class ${ABILITY_CAST.tooltip} {
    private ${ABILITY_CAST.tooltip}() {}

    @SubscribeEvent public static void onTooltip(ItemTooltipEvent event) { ${ABILITY_CAST.client}.tooltip(event.getItemStack(), event.getToolTip()); }
}
`,
    }
  return {
    [ABILITY_CAST.overlay]: `package ${pack};

import ${input.packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.RegisterGuiLayersEvent;

/** NeoForge (client): the abilities' cast bar and waits as a layer of the HUD, above all of the game's. */
@EventBusSubscriber(modid = ${PLATFORM_CLASS}.MOD_ID, bus = EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)
public final class ${ABILITY_CAST.overlay} {
    private ${ABILITY_CAST.overlay}() {}

    @SubscribeEvent public static void onLayers(RegisterGuiLayersEvent event) {
        event.registerAboveAll(${PLATFORM_CLASS}.id("ability_cast"), (graphics, delta) -> ${ABILITY_CAST.client}.hud(graphics, delta.getGameTimeDeltaPartialTick(true)));
    }
}
`,
    [ABILITY_CAST.tooltip]: `package ${pack};

import ${input.packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.ItemTooltipEvent;

/** NeoForge (client): an item's tooltip says the ability it casts. */
@EventBusSubscriber(modid = ${PLATFORM_CLASS}.MOD_ID, bus = EventBusSubscriber.Bus.GAME, value = Dist.CLIENT)
public final class ${ABILITY_CAST.tooltip} {
    private ${ABILITY_CAST.tooltip}() {}

    @SubscribeEvent public static void onTooltip(ItemTooltipEvent event) { ${ABILITY_CAST.client}.tooltip(event.getItemStack(), event.getToolTip()); }
}
`,
  }
}

/** The language of the abilities: each one's name, the tooltip's lines, and what interrupts each, in Chinese and English. */
function abilityLanguage(input: AbilityCastInput) {
  const key = (name: string) => `tooltip.${input.modId}.ability.${name}`
  const zh: Record<string, string> = {
    [key("use.instant_click")]: "右键施放",
    [key("use.charge_click")]: "右键开始蓄力，%s 秒后放出",
    [key("use.charge_hold")]: "按住右键蓄力 %s 秒放出，中途松手取消",
    [key("use.channel_click")]: "右键持续施法 %s 秒",
    [key("use.channel_hold")]: "按住右键持续施法，最长 %s 秒",
    [key("damage")]: "伤害 %s",
    [key("heal")]: "治疗 %s",
    [key("cooldown")]: "冷却 %s 秒",
    [key("scales")]: "随等级和属性成长（按 %s 级算）",
  }
  const en: Record<string, string> = {
    [key("use.instant_click")]: "Right-click to cast",
    [key("use.charge_click")]: "Right-click to charge; fires after %ss",
    [key("use.charge_hold")]: "Hold right-click %ss to charge; letting go early cancels",
    [key("use.channel_click")]: "Right-click to channel for %ss",
    [key("use.channel_hold")]: "Hold right-click to channel, up to %ss",
    [key("damage")]: "%s damage",
    [key("heal")]: "Heals %s",
    [key("cooldown")]: "%ss cooldown",
    [key("scales")]: "Grows with level and attributes (counted at %s)",
  }
  if (input.abilities.some(a => a.document.cast.release)) {
    zh[key("use.release_hold")] = "按住蓄力，松手放出，%s 秒蓄满"
    en[key("use.release_hold")] = "Hold to charge and release to cast. Full power after %ss."
  }
  const EN_CANCEL = { move: "moving", hurt: "being hurt", swap: "switching items" } as const
  input.abilities.forEach((ability) => {
    const name = abilityKey(ability.id)
    zh[`ability.${input.modId}.${name}`] = ability.document.name
    en[`ability.${input.modId}.${name}`] = ability.document.english_name
    const cast = ability.document.cast
    const cancel = cast.cancel_on ?? []
    if (!cancel.length && !cast.recasts) return
    zh[key(`${name}.more`)] = [cast.recasts ? `放完 ${cast.recasts.within} 秒内还能再放 ${cast.recasts.count} 次` : "", cancel.length ? `${cancel.map((reason) => CANCEL_WORDS[reason]).join("、")}会打断它` : ""].filter(Boolean).join("；")
    en[key(`${name}.more`)] = [cast.recasts ? `Can be recast ${cast.recasts.count} more times within ${cast.recasts.within}s` : "", cancel.length ? `Interrupted by ${cancel.map((reason) => EN_CANCEL[reason]).join(", ")}` : ""].filter(Boolean).join("; ")
  })
  return { zh_cn: zh, en_us: en }
}

/**
 * Everything the abilities add to a mod (see the top of this file). `classes`: where the jar must hold them. `patch`: Fabric's entry points added to fabric.mod.json; `entries`: the
 * classes a facade target's common and client entries run. `facade`: the facade's two classes, which a Fabric mod has only for this (Forge and NeoForge always have them).
 */
export function compileAbilityCast(input: AbilityCastInput, target: GenTarget = FABRIC_TARGET) {
  if (!input.abilities.length) throw new Error("ABILITY_CAST_NOTHING_BOUND")
  const root = `src/main/java/${input.packageName.replaceAll(".", "/")}/${ABILITY_CAST.package}`
  const classRoot = `${input.packageName.replaceAll(".", "/")}/${ABILITY_CAST.package}`
  const steps = input.abilities.some(a => a.document.bindings.some(b => b.type === "block" && b.trigger === "step"))
  const loader = loaderSources(input, target)
  const java: Record<string, string> = {
    [`${root}/${ABILITY_CAST.table}.java`]: commonSource(input, target),
    [`${root}/${ABILITY_CAST.client}.java`]: clientSource(input),
    ...Object.fromEntries(Object.entries(loader).map(([name, text]) => [`${root}/${name}.java`, text])),
  }
  if (steps) java[`src/main/java/${input.packageName.replaceAll(".", "/")}/mixin/StudioAbilityStep.java`] = `package ${input.packageName}.mixin;

import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Block.class)
public abstract class StudioAbilityStep {
    @Inject(method = "stepOn", at = @At("HEAD"))
    private void mineModsStep(Level level, BlockPos pos, BlockState state, Entity entity, CallbackInfo ci) {
        ${input.packageName}.ability.StudioAbilities.step(level, pos, state.getBlock(), entity);
    }
}
`
  const files: Record<string, string> = Object.fromEntries(Object.entries(java).map(([name, text]) => [name, target.version.rewriteJava(text)]))
  const facade = target.loader.facade
  // A Fabric mod is generated by Fabric's own text and has no facade; the abilities are written against it, so it gets Fabric's (the adapter's own text, compiled by the platform tests).
  const platform = facade ? {} : FABRIC_LOADER.platformFiles({ modId: input.modId, packageName: input.packageName, version: target.version })
  const classes = [ABILITY_CAST.table, ABILITY_CAST.client, ...Object.keys(loader)].map((name) => `${classRoot}/${name}.class`)
  if (steps) classes.push(input.packageName.replaceAll(".", "/") + "/mixin/StudioAbilityStep.class")
  const stepPatch: Record<string, (text: string) => string> = steps ? { [`src/main/resources/${input.modId}.mixins.json`]: text => target.loader.addMixins(text, { common: ["StudioAbilityStep"] }) } : {}
  const edit = (text: string, change: (value: Record<string, unknown>) => Record<string, unknown>) => {
    const edited = `${JSON.stringify(change(JSON.parse(text) as Record<string, unknown>), null, 2)}\n`
    return text.includes("\r\n") ? edited.replaceAll("\n", "\r\n") : edited
  }
  return {
    files: { ...files, ...platform },
    language: abilityLanguage(input),
    classes,
    patch: facade
      ? stepPatch
      : {
          ...stepPatch,
          "src/main/resources/fabric.mod.json": (text: string) =>
            edit(text, (metadata) => {
              const entrypoints = (metadata.entrypoints ?? {}) as { main?: string[]; client?: string[] }
              return { ...metadata, entrypoints: { ...entrypoints, main: [...(entrypoints.main ?? []), `${input.packageName}.${ABILITY_CAST.package}.${ABILITY_CAST.fabric}`], client: [...(entrypoints.client ?? []), `${input.packageName}.${ABILITY_CAST.package}.${ABILITY_CAST.fabricClient}`] } }
            }),
        },
    entries: facade ? { common: [`${input.packageName}.${ABILITY_CAST.package}.${ABILITY_CAST.table}`], client: [`${input.packageName}.${ABILITY_CAST.package}.${ABILITY_CAST.client}`] } : { common: [] as string[], client: [] as string[] },
  }
}

/**
 * The cast-action runtime with the abilities' two hooks (only when some ability needs them, so a project without is byte for byte as before): `GestureMod.showFor` plays a cast action on
 * a player for everyone near (an ability that names one), and the key of a cast action an ability is bound to asks `StudioAbilities.gesture` before it plays.
 */
export function patchGestureRuntime(files: Record<string, string | Uint8Array>, packageName: string, facade: boolean, hooks: { show: boolean; keys: boolean }) {
  const file = `src/main/java/${packageName.replaceAll(".", "/")}/gesture/${facade ? "platform" : "fabric"}/GestureMod.java`
  const text = files[file]
  if (typeof text !== "string") throw new Error(`ABILITY_GESTURE_RUNTIME_MISSING:${file}`)
  const once = (source: string, anchor: string, replacement: string) => {
    if (source.split(anchor).length !== 2) throw new Error(`ABILITY_GESTURE_ANCHOR_MISSING:${anchor.trim().slice(0, 60)}`)
    return source.replace(anchor, () => replacement)
  }
  const hook = `${packageName}.${ABILITY_CAST.package}.${ABILITY_CAST.table}`
  const accept = facade
    ? "        if (!COOLDOWN.accept(player.getUUID(), gesture.lengthTicks(), player.getServer().getTickCount())) return;\n"
    : "            if (!COOLDOWN.accept(player.getUUID(), gesture.lengthTicks(), context.server().getTickCount())) return;\n"
  const indent = facade ? "        " : "            "
  const show = facade
    ? `    /** Plays cast action \`gesture\` on \`player\` for everyone near: an ability the player casts names it. */
    public static void showFor(ServerPlayer player, int gesture) {
        if (DATA.get(gesture) == null) return;
        SHOW.sendNear(player.serverLevel(), player.getX(), player.getY(), player.getZ(), RANGE, new Show(player.getId(), gesture));
    }

`
    : `    /** Plays cast action \`gesture\` on \`player\` for everyone near: an ability the player casts names it. */
    public static void showFor(net.minecraft.server.level.ServerPlayer player, int gesture) {
        if (DATA.get(gesture) == null) return;
        var show = new Show(player.getId(), gesture);
        for (var other : player.serverLevel().players()) {
            if (other.distanceToSqr(player) <= RANGE * RANGE && ServerPlayNetworking.canSend(other, Show.ID)) ServerPlayNetworking.send(other, show);
        }
    }

`
  const keyed = hooks.keys ? once(text.replaceAll("\r\n", "\n"), accept, `${accept}${indent}// An ability bound to this cast action's key is cast with it; when it may not be now, the action does not play either.\n${indent}if (!${hook}.gesture(player, payload.gesture())) return;\n`) : text.replaceAll("\r\n", "\n")
  const shown = hooks.show ? once(keyed, facade ? "    private static void play(ServerPlayer player, Play payload) {\n" : "    @Override public void onInitialize() {\n", `${show}${facade ? "    private static void play(ServerPlayer player, Play payload) {\n" : "    @Override public void onInitialize() {\n"}`) : keyed
  files[file] = text.includes("\r\n") ? shown.replaceAll("\n", "\r\n") : shown
}
