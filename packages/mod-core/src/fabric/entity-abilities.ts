import { rangedSound } from "../sound-range"
import { hasOnce, onceRef, onceStrike } from "../once-group"
import { emitArguments, emissionTimeline } from "../common/emit"
import { resolvedAsset, extendedEmit } from "../particle-emission"
import { moveAimsAtFixture, fixtureStatement } from "../fixture-events"
import { cinematicStatement } from "../common/cinematic"
import { ABILITY_PROJECTILES, PROJECTILE_DRAG, TICKS, type AbilityEffect } from "../ability-words"
import { BuildStop } from "../build-stop"
import { GROUND_TURN, abilityPlan, abilityTick, faceTolerance, shapeRange, type Place } from "../creature-abilities"
import { guidedShotsJava } from "../common/guided-flight"
import { isSoundAsset, variedPitch, type SoundRef } from "../sound"
import { soundJava } from "./sound"
import { hitBone, type Ability, type AbilityHit, type Combo } from "../entity-runtime"
import { GAMEPLAY_API } from "../gameplay"
import { EFFECT_LIMITS } from "../ability-words"
import { eventFrame, hitCentre, type EffectEvent } from "../effect-abilities"
import { EFFECT_RUNTIME } from "./effect"
import { BOSS_RUNTIME, SHAKE_MORE_METHOD, shakeStatement } from "./boss-runtime"
import { hitFixed, warnPlan } from "../creature-abilities"
import { hitElsewhere, hitPlace, shapeInner, shapeKind } from "../entity-runtime"
import { usesFieldWarn } from "./field-warn"
import { warnLook, ABILITY_WARN } from "./ability-warn"
import { expandFeedback } from "../hit-feedback"
import { struckAbility } from "../boss-weather"
import { lightningSteps } from "./boss-weather"
import { PARTICLE_RUNTIME } from "../common/particles"
import { compileImpacts } from "./impact-fx"
import { TRAIL_RUNTIME, trailSpec } from "../common/trails"
import { groundFxJava, type BeamStart } from "../common/ground-fx"
import { isTerrainEvent } from "../terrain"
import { terrainStatement } from "../common/terrain"
import { isGroundFx, isGroundPlaced } from "../ground-fx"
import { vanillaGaps } from "../version-lacks"
import type { VersionAdapter } from "../platform/adapter"
import { isPush, type PushMove } from "../ability-dash"
import { compileDashForce } from "./ability-dash"
import { projectileLaunch } from "../common/projectiles"
import { ARENA_CENTER_PLACE, ARENA_FOG, arenaInside, arenaSteps, arenaWarnSafe } from "./arena"
import { plainShape } from "../arena"
import { compileStances } from "./entity-stances"
import type { Boss, Stances } from "../entity-runtime"
import { staggerList, type Stagger, type Guard } from "../combat"
import { combatBearingJava, combatHurtJava, combatWeightJava, conditionJava } from "./combat"
import { parryJava } from "./ability-parry"
import { compileTactics } from "./ability-tactics"
import { leapPlan } from "../ability-tactics"
import type { Between, Tactics } from "../ability-tactics"

/** Boss 能力 2: the throws of an ability's warned volleys from the sky, each on the tick its warning begins, waiting in the sky until the tick of its hit. */
function projectileWarned(ability: Ability, plan: ReturnType<typeof abilityPlan>, scaled: boolean, chained: boolean) {
  return projectileWarnTicks(ability, plan).map(({ hit, start }) => ({ tick: start, lines: [projectileLaunch(ability.hits[hit.index] as Extract<AbilityHit, { type: "projectile" }>, hit, hit.index, hit.tick - start, scaled, chained)], prepares: hit.tick }))
}

/** The volleys of an ability that are warned of: each hit's moment and the tick its warning begins (and it is thrown). */
function projectileWarnTicks(ability: Ability, plan: ReturnType<typeof abilityPlan>) {
  return plan.hits.flatMap((hit) => {
    const value = ability.hits[hit.index]!
    if (value.type !== "projectile" || !value.warn) return []
    return [{ hit, start: Math.max(0, hit.tick - abilityTick(value.warn.seconds)) }]
  })
}

/**
 * A creature's abilities (招式) as the Java its class carries. Everything is decided on the server: which
 * ability starts (a goal asks `startAbility`), its ticks (`tickAbility`, once a tick after everything else
 * the creature did), who a hit reaches (the shape against where everybody stands on that tick) and when it
 * ends. Players' games are only told which ability is showing, through one synced number, and play its motion.
 * Every Minecraft and GeckoLib name used here is Mojang's own (Fabric Loom's official mappings), read with javap from the 1.21.1 jar and GeckoLib 4.8.3.
 * Without abilities every piece is the empty string, so such a creature's class is what it always was.
 */

const real = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(4))))
const single = (value: number) => `${real(value)}f`
const list = (values: readonly (number | boolean | string)[]) => `{${values.join(", ")}}`
/** A trail whose far end was not measured: the model lacks the part or the part has no cube (`boneIssues` refuses that before a build gets here). */
const trailTipMissing = (ability: Ability, bone: string): never => {
  throw new BuildStop("ability_bone", [{ text: `招式「${ability.name}」的拖尾跟着「${bone}」的末端，可是没有量出它在哪里。`, fix: "模型里要有这个部件，而且它自己要有方块；先让这只生物的模型和招式重新通过检查，再打包。" }])
}
/** The `MobEffects` constant of each effect a hit may give. */
const MOB_EFFECTS: Record<AbilityEffect, string> = { slowness: "MOVEMENT_SLOWDOWN", blindness: "BLINDNESS", poison: "POISON", weakness: "WEAKNESS" }

/** J2: the direction a beam or a cone goes in, as the argument its check is handed when the creature has any that is kept level: toward its target, or level the way it faces. */
const aimSource = (shape: { up: number; aim?: "target" | "level" }, levels: boolean) => (!levels ? "" : shape.aim === "level" ? "abilityLevel(), " : `abilityDirection(${real(shape.up)}, 0.0), `)

/** What one hit does on its tick, as statements. `levels` (J2): the creature has a beam or a cone that is kept level, so each of those is handed the direction it goes in. */
function hitSource(hit: AbilityHit, levels: boolean, scaled = false, chained = false, slot = 0, tick = 0, capture = false) {
  // What a gameplay does at this moment: the ability system calls the entry the gameplay registered under this name, with the creature and the one it is fighting. It is asked on the server tick like every
  // other statement here, so it can never run beside another ability (only one runs at a time), and a gameplay that fails is logged by the accessor and does not take the world down with it.
  if (hit.type === "gameplay") return [`${GAMEPLAY_API.content}.runAbility(${JSON.stringify(hit.action)}, this, abilityTarget);`]
  // Boss 能力 2: a thing of its own it throws (common/projectiles.ts). One warned of is thrown when its warning begins, waiting until this tick to fall (`projectileWarned`).
  if (hit.type === "projectile") return hit.warn ? [] : [projectileLaunch(hit, { tick }, slot, 0, scaled, chained)]
  if (hit.type === "shot") {
    const made = {
      arrow: "Arrow shot = new Arrow(level(), this, new ItemStack(Items.ARROW), null);",
      snowball: "Snowball shot = new Snowball(level(), this);",
      small_fireball: "SmallFireball shot = new SmallFireball(level(), this, aim);",
      fireball: "LargeFireball shot = new LargeFireball(level(), this, aim, 1);",
    }[hit.projectile]
    const thrown = hit.projectile === "arrow" || hit.projectile === "snowball"
    const gravity = ABILITY_PROJECTILES[hit.projectile].gravity
    return [
      "{",
      // What falls is aimed above the one it fights by as much as the fall on the way (`abilityArc`), the way the game's own archers lift theirs; the fireballs fly straight.
      `    Vec3 aim = ${gravity > 0 ? `abilityArc(${real(hit.up)}, ${real(hit.forward)}, ${real(hit.speed)}, ${real(gravity)})` : `abilityDirection(${real(hit.up)}, ${real(hit.forward)})`};`,
      `    ${made}`,
      // An arrow takes its damage times its speed when it lands: this is the number written, at the speed written.
      // A boss in a later phase does more damage (boss runtime, 10-12): the arrow's damage is multiplied like the rest.
      // A combo's own number multiplies it too while a combo plays it (`abilityDamageScale`).
      ...(hit.projectile === "arrow" ? [`    shot.setBaseDamage(${real((hit.damage ?? 0) / hit.speed)}${scaled ? " * bossDamageScale()" : ""}${chained ? " * abilityDamageScale()" : ""});`] : []),
      `    shot.setPos(abilityPoint(${real(hit.forward)}, ${real(hit.up)}, 0.0));`,
      thrown ? `    shot.shoot(aim.x, aim.y, aim.z, ${single(hit.speed)}, 0.0f);` : `    shot.setDeltaMovement(aim.scale(${real(hit.speed)}));`,
      ...(hit.once_group ? [`    StudioGroupedShot.attach(shot, ${onceRef(hit)});`] : []),
      "    level().addFreshEntity(shot);",
      ...(hit.homing ? [`    if (abilityTarget != null) guided.add(new Guided(shot, abilityTarget, ${real(hit.homing.strength)}, ${real(hit.homing.range)}));`] : []),
      "}",
    ]
  }
  const shape = hit.shape
  // Boss 能力 13: a hit over the whole arena is always put down at the arena's middle (`hitFixed`), never counted round the creature.
  if (shape.type === "arena") throw new Error("a hit over the arena is put down at its middle")
  const inside =
    shape.type === "arc"
      ? shapeInner(shape) > 0
        ? `abilityInRing(victim, ${real(shapeInner(shape))}, ${real(shape.reach)}, ${real(shape.angle / 2)}, ${real(shape.low)}, ${real(shape.high)})`
        : `abilityInArc(victim, ${real(shape.reach)}, ${real(shape.angle / 2)}, ${real(shape.low)}, ${real(shape.high)})`
      : shape.type === "box"
        ? `abilityInBox(victim, ${real(shape.forward)}, ${real(shape.up)}, ${real(shape.left)}, ${real(shape.width)}, ${real(shape.height)}, ${real(shape.depth)})`
        : shape.type === "sphere"
          ? `abilityInSphere(victim, ${real(shape.forward)}, ${real(shape.up)}, ${real(shape.left)}, ${real(shape.radius)})`
          : shape.type === "line"
            ? `abilityInLine(victim, ${aimSource(shape, levels)}${real(shape.up)}, ${real(shape.length)}, ${real(shape.radius)})`
            : `abilityInCone(victim, ${aimSource(shape, levels)}${real(shape.up)}, ${real(shape.length)}, ${real(shape.angle / 2)})`
  return [
    ...(capture ? [`fixtureHitMasks[${slot}] = StudioArena.mask(StudioArena.room(this), victim -> ${inside}${hit.fixture_walls && hit.blocked_by_walls ? ` && abilityClear(abilityPoint(0.0, ${real(shape.type === "cone" || shape.type === "line" ? shape.up : 0.05)}, 0.0), victim)` : ""});`] : []),
    ...(hit.break_terrain === undefined ? [] : [`StudioTerrain.smash(level(),${real(hit.break_terrain)},victim -> ${inside});`]),
    // Whoever is not inside the shape right now is not hit, wherever they stood when the ability began.
    `for (LivingEntity victim : abilityVictims(${hit.hits === "everyone"}, ${real(shapeRange(shape))})) {`,
    ...(hit.blocked_by_walls ? [`    if (!abilityClear(abilityPoint(0.0, ${real(shape.type === "cone" || shape.type === "line" ? shape.up : 0.05)}, 0.0), victim)) continue;`] : []),
    ...onceStrike(hit, `    if (!${inside} || !abilityStrike(victim, ${single(hit.damage)}, ${real(hit.knockback)})) continue;`),
    ...hit.effects.map((effect) => `    victim.addEffect(new MobEffectInstance(MobEffects.${MOB_EFFECTS[effect.effect]}, ${effect.duration_ticks}, ${effect.amplifier}${effect.particles === false ? ", false, false, true" : ""}), this);`),
    "}",
  ]
}

type AreaHit = Extract<AbilityHit, { type: "area" }>

/**
 * Boss 能力 3: the statements that decide where a hit put down at fixed places lands (`slot`: which hit of its ability it is): the places, by the place it names, and the way the creature
 * faces right then. What they are counted from is the server's alone; the same arithmetic draws them in the pictures (`hitPlaces`).
 */
function placeSource(hit: AreaHit, slot: number, landing?: "active" | "reserved") {
  const place = hitPlace(hit)
  const placer =
    place === "self"
      ? (landing === "active" ? "(abilityLeapOf == abilityIndex && abilityLeapSerial == abilitySerial ? new double[] {abilityLeapToX, abilityLeapToY, abilityLeapToZ} : abilityPlaceSelf())" : "abilityPlaceSelf()")
      : // Boss 能力 13: the arena's middle (and every hit over the whole arena).
        place === "center"
        ? ARENA_CENTER_PLACE
        : place === "target"
        ? "abilityPlaceTarget()"
        : "fixture" in place ? `StudioArena.target(StudioArena.room(this), this, ${place.fixture === "lit_random"})` : place.type === "around_target"
          ? `abilityPlaceAround(${place.count}, ${real(place.spread)}, ${slot})`
          : `abilityPlacePattern(new double[] {${place.points.flatMap((point) => [real(point.forward), real(point.left)]).join(", ")}})`
  return [`abilityPlaces[${slot}] = ${landing === "reserved" ? "new double[] {abilityLeapToX, abilityLeapToY, abilityLeapToZ}" : placer};`, `abilityPlaceYaw[${slot}] = abilityYaw;`]
}

/** The hit's shape as the numbers the warning packet carries (`ABILITY_WARN.shapes`): a kind and six numbers, the same ones the hit is checked with. */
function warnShape(hit: AreaHit) {
  // Boss 能力 13: a hit over the whole arena is warned of as the full circle it covers.
  const shape = plainShape(hit.shape)
  const numbers =
    shape.type === "sphere"
      ? [ABILITY_WARN.shapes.sphere, shape.forward, shape.up, shape.left, shape.radius, 0, 0]
      : shape.type === "box"
        ? [ABILITY_WARN.shapes.box, shape.forward, shape.up, shape.left, shape.width, shape.height, shape.depth]
        : shape.type === "arc"
          ? [ABILITY_WARN.shapes.arc, shape.reach, shape.angle / 2, shape.low, shape.high, shapeInner(shape), 0]
          : null
  if (!numbers) throw new Error(`a ${shape.type} has no warning`)
  return [String(numbers[0]), ...numbers.slice(1).map(single)].join(", ")
}

/** The statements on the tick a hit's warning begins: its places are decided, and every player's game near them is told to draw it for `ticks` ticks. */
function warnSource(hit: AreaHit, slot: number, ticks: number, landing?: "active" | "reserved") {
  const w = hit.warn!
  if (usesFieldWarn(w)) {
    const [shape, ...dims] = warnShape(hit).split(", ")
    const packet = `new StudioWarn.Warn(getId(), ${ticks}, ${warnLook(w)}, ${ABILITY_WARN.colors[w.color]}, ${shape}, abilityPlaceYaw[${slot}], ${dims.join(", ")}, abilityPlaces[${slot}])`
    return [...placeSource(hit, slot, landing), `if (level() instanceof net.minecraft.server.level.ServerLevel world) abilityMarkers[${slot}] = new StudioWarn.Marker(world, this, ${packet}, ${landing ? "null" : w.follow === "caster" ? "this" : w.follow === "target" ? "abilityTarget" : "null"}, ${Math.round((w.lock_before ?? 0) * TICKS)}, ${Math.round((w.fade_seconds ?? 0) * TICKS)}, ${JSON.stringify(w.effect ?? "")});`, ...arenaWarnSafe(hit.shape.type === "arena" ? hit.safe : undefined, ticks, hit.warn!.paint === "mesh")]
  }
  return [...placeSource(hit, slot, landing), `abilityWarn(${slot}, ${warnShape(hit)}, ${warnLook(hit.warn!)}, ${ABILITY_WARN.colors[hit.warn!.color]}, ${ticks});`, ...arenaWarnSafe(hit.shape.type === "arena" ? hit.safe : undefined, ticks, hit.warn!.paint === "mesh")]
}

/**
 * What a hit put down at fixed places does on its tick: everyone the shape holds at any of them right now is hit, once however many of them hold it (never the creature itself, nor
 * its own kind); the places are the ones its warning showed (`warned`), or are decided now. A push goes away from the place that held them.
 */
function placedHitSource(hit: AreaHit, slot: number, warned: boolean, walls: boolean, capture = false, leap = false) {
  const shape = hit.shape
  const inside =
    // Boss 能力 13: a hit over the whole arena, sparing its safe places (`StudioArena.inside`).
    shape.type === "arena"
      ? arenaInside(shape, hit.safe, slot)
      : shape.type === "arc"
      ? shapeInner(shape) > 0
        ? `abilityInRingAt(victim, ${slot}, ${real(shapeInner(shape))}, ${real(shape.reach)}, ${real(shape.angle / 2)}, ${real(shape.low)}, ${real(shape.high)})`
        : `abilityInArcAt(victim, ${slot}, ${real(shape.reach)}, ${real(shape.angle / 2)}, ${real(shape.low)}, ${real(shape.high)})`
      : shape.type === "box"
        ? `abilityInBoxAt(victim, ${slot}, ${real(shape.forward)}, ${real(shape.up)}, ${real(shape.left)}, ${real(shape.width)}, ${real(shape.height)}, ${real(shape.depth)})`
        : shape.type === "sphere"
          ? `abilityInSphereAt(victim, ${slot}, ${real(shape.forward)}, ${real(shape.up)}, ${real(shape.left)}, ${real(shape.radius)})`
          : null
  if (!inside) throw new Error(`a ${shape.type} is never put down at fixed places`)
  return [
    ...(usesFieldWarn(hit.warn) ? [`if (abilityMarkers[${slot}] != null) { abilityMarkers[${slot}].stop(); abilityMarkers[${slot}] = null; }`] : warned ? ["abilityWarnsOut = Math.max(0, abilityWarnsOut - 1);"] : placeSource(hit, slot, leap ? "reserved" : undefined)),
    ...(capture ? [`fixtureHitMasks[${slot}] = StudioArena.mask(StudioArena.room(this), victim -> ${walls && shape.type !== "arena" ? inside.slice(0, -1) + ", " + Boolean(hit.fixture_walls && hit.blocked_by_walls) + ")" : inside} >= 0);`] : []),
    ...(hit.break_terrain===undefined ? [] : [`StudioTerrain.smash(level(),${real(hit.break_terrain)},victim -> (${walls && shape.type!=="arena" ? inside.slice(0,-1)+", false)" : inside})>=0);`]),
    `for (LivingEntity victim : abilityVictims(${hit.hits === "everyone"}, ${real(shapeRange(shape))}, abilityPlaces[${slot}])) {`,
    `    int place = ${walls && shape.type !== "arena" ? inside.slice(0, -1) + ", " + Boolean(hit.blocked_by_walls) + ")" : inside};`,
    ...(hit.blocked_by_walls && shape.type === "arena" ? [`    if (place >= 0 && !abilityClear(new Vec3(abilityPlaces[${slot}][place], abilityPlaces[${slot}][place+1] + 0.05, abilityPlaces[${slot}][place+2]), victim)) continue;`] : []),
    ...onceStrike(hit, `    if (place < 0 || !abilityStrikeAt(victim, ${single(hit.damage)}, ${real(hit.knockback)}, ${slot}, place)) continue;`),
    ...hit.effects.map((effect) => `    victim.addEffect(new MobEffectInstance(MobEffects.${MOB_EFFECTS[effect.effect]}, ${effect.duration_ticks}, ${effect.amplifier}${effect.particles === false ? ", false, false, true" : ""}), this);`),
    "}",
  ]
}

/**
 * Boss 能力 3: the methods of hits put down at fixed places, as Java, each only when some hit needs it. `abilityRandom` takes exactly the steps of `placeRandom` (creature-abilities.ts) in Java's `int`, and
 * `abilityPlaceAround` mixes the cast's seed with the hit as `placeSeed` does, so the pictures lay out a cast the way the server does for the same seed.
 */
function placedMethods(uses: { terrainInteractions:boolean; markers: boolean; walls: boolean; scaled: boolean; chained: boolean; /** 第 3 步: what a strike's damage is also multiplied by, and the line it ends with (`compileTactics`). */ tactics: { damage: string; strike: string }; pulls: boolean; /** Boss 能力 4: the line that puts a hit's force on whoever it strikes ("" without forces). */ force: string; warned: boolean; self: boolean; target: boolean; around: boolean; pattern: boolean; arc: boolean; /** An arc with a hollow middle (`inner`). */ ring: boolean; box: boolean; sphere: boolean }) {
  // A place in its own terms as it faced when the places of hit `slot` were decided, from the point `at` of them: the same turn `abilityPoint` makes.
  const frame = `        double[] places = abilityPlaces[slot];
        float turn = abilityPlaceYaw[slot] * 0.017453292f;`
  const gate = uses.walls ? "\n            if (walls && !abilityClear(new Vec3(places[at], places[at + 1] + 0.05, places[at + 2]), victim)) continue;" : ""
  const local = `            double x = victim.getX() - places[at];
            double z = victim.getZ() - places[at + 2];
            double ahead = -x * Mth.sin(turn) + z * Mth.cos(turn);
            double side = x * Mth.cos(turn) + z * Mth.sin(turn);`
  const methods = [
    ...(uses.self ? [`    /** Its own feet, where it stands now. */\n    private double[] abilityPlaceSelf() {\n        return new double[] {getX(), getY(), getZ()};\n    }`] : []),
    ...(uses.target ? [`    /** The feet of the one it fights, where they stand now. */\n    private double[] abilityPlaceTarget() {\n        return new double[] {abilityTarget.getX(), abilityTarget.getY(), abilityTarget.getZ()};\n    }`] : []),
    ...(uses.around
      ? [
          `    /** \`count\` places scattered evenly within \`spread\` blocks round the feet of the one it fights, in its own terms as it faces now, by this cast's number mixed with which hit it is. */
    private double[] abilityPlaceAround(int count, double spread, int slot) {
        abilityRoll = abilitySeed ^ ((slot + 1) * 0x9E3779B9);
        float turn = abilityYaw * 0.017453292f;
        double[] places = new double[count * 3];
        for (int index = 0; index < count; index++) {
            double angle = abilityRandom() * 2.0 * Math.PI;
            double far = Math.sqrt(abilityRandom()) * spread;
            double forward = far * Math.cos(angle);
            double left = far * Math.sin(angle);
            places[index * 3] = abilityTarget.getX() - forward * Mth.sin(turn) + left * Mth.cos(turn);
            places[index * 3 + 1] = abilityTarget.getY();
            places[index * 3 + 2] = abilityTarget.getZ() + forward * Mth.cos(turn) + left * Mth.sin(turn);
        }
        return places;
    }`,
          `    /** The next number of this cast's drawing, from 0 up to 1 (mulberry32). */
    private double abilityRandom() {
        abilityRoll += 0x6D2B79F5;
        int mixed = (abilityRoll ^ (abilityRoll >>> 15)) * (abilityRoll | 1);
        mixed ^= mixed + (mixed ^ (mixed >>> 7)) * (mixed | 61);
        return ((mixed ^ (mixed >>> 14)) & 0xFFFFFFFFL) / 4294967296.0;
    }`,
        ]
      : []),
    ...(uses.pattern
      ? [
          `    /** Places in its own terms, \`forward\` and \`left\` of its feet by turns, as it stands and faces now. */
    private double[] abilityPlacePattern(double[] points) {
        float turn = abilityYaw * 0.017453292f;
        double[] places = new double[points.length / 2 * 3];
        for (int index = 0; index < points.length / 2; index++) {
            double forward = points[index * 2];
            double left = points[index * 2 + 1];
            places[index * 3] = getX() - forward * Mth.sin(turn) + left * Mth.cos(turn);
            places[index * 3 + 1] = getY();
            places[index * 3 + 2] = getZ() + forward * Mth.cos(turn) + left * Mth.sin(turn);
        }
        return places;
    }`,
        ]
      : []),
    ...(uses.warned
      ? [
          `    /** Tells every player's game near the places of hit \`slot\` to draw where it will land, with its shape's own numbers, for the \`ticks\` before it does. */
    private void abilityWarn(int slot, int shape, float a, float b, float c, float d, float e, float f, int look, int color, int ticks) {
        abilityWarnsOut++;
        if (level() instanceof net.minecraft.server.level.ServerLevel world) ${ABILITY_WARN.server}.send(world, new ${ABILITY_WARN.server}.Warn(getId(), ticks, look, color, shape, abilityPlaceYaw[slot], a, b, c, d, e, f, abilityPlaces[slot]));
    }`,
          `    /** The ability is over: a warning whose hit has not landed (it was cut short) is taken back from the players' games, and no place is kept. */
    private void abilityWarnTakeBack() {
        if (abilityWarnsOut > 0 && level() instanceof net.minecraft.server.level.ServerLevel world) {
            int count = 0;
            for (double[] places : abilityPlaces) if (places != null) count += places.length;
            double[] every = new double[count];
            int at = 0;
            for (double[] places : abilityPlaces) {
                if (places == null) continue;
                System.arraycopy(places, 0, every, at, places.length);
                at += places.length;
            }
            ${ABILITY_WARN.server}.clear(world, getId(), every);
        }
        abilityWarnsOut = 0;${uses.markers ? "\n        for (var marker : abilityMarkers) if (marker != null) marker.stop();\n        java.util.Arrays.fill(abilityMarkers, null);" : ""}
        java.util.Arrays.fill(abilityPlaces, null);
    }`,
        ]
      : []),
    `    /** Who a hit at fixed places may reach: the one it fights, or every living thing within \`range\` of any of the places but itself and its own kind, each once. */
    private List<LivingEntity> abilityVictims(boolean everyone, double range, double[] places) {
        if (!everyone) return abilityTarget != null && abilityTarget.isAlive() ? List.of(abilityTarget) : List.of();
        java.util.Set<LivingEntity> found = new java.util.LinkedHashSet<>();
        for (int at = 0; at + 2 < places.length; at += 3) {
            found.addAll(level().getEntitiesOfClass(LivingEntity.class, new AABB(places[at] - range, places[at + 1] - range, places[at + 2] - range, places[at] + range, places[at + 1] + range, places[at + 2] + range),
                other -> other != this && other.isAlive() && other.getType() != getType() && !other.isSpectator()
                    && !(other instanceof Player player && player.isCreative())));
        }
        return List.copyOf(found);
    }`,
    `    /** Strikes one held at the place \`at\` of hit \`slot\`: its damage, and a push away from that place (one who stands on the very place is pushed away from the creature)${uses.pulls ? ", or a pull toward the creature" : ""}. */
    private boolean abilityStrikeAt(LivingEntity victim, float damage, double knockback, int slot, int at) {
        if (damage > 0.0f && !victim.hurt(damageSources().mobAttack(this), damage${uses.scaled ? " * bossDamageScale()" : ""}${uses.chained ? " * abilityDamageScale()" : ""}${uses.tactics.damage})) return false;${uses.tactics.strike}
        if (knockback > 0.0) {
            double dx = abilityPlaces[slot][at] - victim.getX();
            double dz = abilityPlaces[slot][at + 2] - victim.getZ();
            if (dx * dx + dz * dz < 1.0e-4) victim.knockback(knockback, getX() - victim.getX(), getZ() - victim.getZ());
            else victim.knockback(knockback, dx, dz);
        }${uses.pulls ? "\n        else if (knockback < 0.0) abilityPull(victim, -knockback);" : ""}${uses.force}
        return true;
    }`,
    ...(uses.sphere
      ? [
          `    /** The first place of hit \`slot\` whose ball holds the victim (its middle \`forward\`, \`up\`, \`left\` of the place), or -1. */
    private int abilityInSphereAt(${uses.terrainInteractions?"net.minecraft.world.entity.Entity":"LivingEntity"} victim, int slot, double forward, double up, double left, double radius${uses.walls ? ", boolean walls" : ""}) {
${frame}
        for (int at = 0; at + 2 < places.length; at += 3) {${gate}
            Vec3 centre = new Vec3(places[at] - forward * Mth.sin(turn) + left * Mth.cos(turn), places[at + 1] + up, places[at + 2] + forward * Mth.cos(turn) + left * Mth.sin(turn));
            if (victim.getBoundingBox().distanceToSqr(centre) <= radius * radius) return at;
        }
        return -1;
    }`,
        ]
      : []),
    ...(uses.box
      ? [
          `    /** The first place of hit \`slot\` whose box holds the victim (its middle \`forward\`, \`up\`, \`left\` of the place), or -1: the same test \`abilityInBox\` makes round the creature. */
    private int abilityInBoxAt(${uses.terrainInteractions?"net.minecraft.world.entity.Entity":"LivingEntity"} victim, int slot, double forward, double up, double left, double width, double height, double depth${uses.walls ? ", boolean walls" : ""}) {
${frame}
        AABB box = victim.getBoundingBox();
        double wide = victim.getBbWidth() / 2.0;
        for (int at = 0; at + 2 < places.length; at += 3) {${gate}
${local}
            if (box.maxY >= places[at + 1] + up - height / 2.0 && box.minY <= places[at + 1] + up + height / 2.0
                && Math.abs(ahead - forward) <= depth / 2.0 + wide && Math.abs(side - left) <= width / 2.0 + wide) return at;
        }
        return -1;
    }`,
        ]
      : []),
    ...(uses.arc
      ? [
          `    /** The first place of hit \`slot\` whose arc holds the victim, or -1: the same test \`abilityInArc\` makes round the creature, from the place and the way it faced then. */
    private int abilityInArcAt(${uses.terrainInteractions?"net.minecraft.world.entity.Entity":"LivingEntity"} victim, int slot, double reach, double half, double low, double high${uses.walls ? ", boolean walls" : ""}) {
${frame}
        AABB box = victim.getBoundingBox();
        double wide = victim.getBbWidth() / 2.0;
        for (int at = 0; at + 2 < places.length; at += 3) {${gate}
            if (box.maxY < places[at + 1] + low || box.minY > places[at + 1] + high) continue;
${local}
            double flat = Math.sqrt(ahead * ahead + side * side);
            if (flat - wide > reach) continue;
            if (flat <= wide || Math.abs(Math.toDegrees(Math.atan2(side, ahead))) <= half + Math.toDegrees(Math.asin(Math.min(1.0, wide / flat)))) return at;
        }
        return -1;
    }`,
        ]
      : []),
    ...(uses.ring
      ? [
          `    /** The first place of hit \`slot\` whose hollow arc holds the victim, or -1: \`abilityInArcAt\`, except that whoever stands wholly within \`inner\` of the place is not held. */
    private int abilityInRingAt(${uses.terrainInteractions?"net.minecraft.world.entity.Entity":"LivingEntity"} victim, int slot, double inner, double reach, double half, double low, double high${uses.walls ? ", boolean walls" : ""}) {
${frame}
        AABB box = victim.getBoundingBox();
        double wide = victim.getBbWidth() / 2.0;
        for (int at = 0; at + 2 < places.length; at += 3) {${gate}
            if (box.maxY < places[at + 1] + low || box.minY > places[at + 1] + high) continue;
${local}
            double flat = Math.sqrt(ahead * ahead + side * side);
            if (flat - wide > reach || flat + wide <= inner) continue;
            if (flat <= wide || Math.abs(Math.toDegrees(Math.atan2(side, ahead))) <= half + Math.toDegrees(Math.asin(Math.min(1.0, wide / flat)))) return at;
        }
        return -1;
    }`,
        ]
      : []),
  ]
  return `\n${methods.join("\n\n")}\n`
}

/**
 * H3: one effect event as a statement. The place its effects are counted from is the creature's feet, the feet of
 * the one it fights, or the middle of where one of its hits lands; `abilityEffect` lays them out from there.
 * J2: one laid out along a hit's aim (`eventFrame`) is handed that direction and laid out by `abilityEffectAimed`,
 * which tilts every offset and every effect with it.
 */
/** The place an event of an ability counts its offsets from: the creature's own feet, the feet of its target, or the middle of where hit number `hit` lands. */
function remoteSlot(ability: Ability, event: {where?:string;hit?:number|null;type:string}) {
  if (event.where !== "hit" || event.hit == null || event.type === "particle" || isTerrainEvent(event)) return null
  const hit=ability.hits[event.hit]
  return hit?.type === "area" && (hitElsewhere(hit) || ((event.type === "sound" || event.type === "shake") && hitFixed(hit))) ? event.hit : null
}
function eachLanding(slot:number|null, lines:string[]) {
  return slot === null ? lines : [`if (abilityPlaces[${slot}] != null) for (int landingOffset = 0; landingOffset < abilityPlaces[${slot}].length; landingOffset += 3) {`, ...lines.map(line=>"    "+line), "}"]
}
function eventOrigin(ability: Ability, where: "self" | "target" | "hit", hit: number | null, locked = true) {
  const placedHit = hit === null ? null : ability.hits[hit]
  const centre = hitCentre(ability.hits[hit ?? 0] ?? ability.hits[0]!)
  if (locked && where === "hit" && placedHit?.type === "area" && hitElsewhere(placedHit)) return `abilityEventPlace(${hit}, landingOffset, ${real(centre.forward)}, ${real(centre.up)}, ${real(centre.left)})`
  return where === "self"
    ? "abilityPoint(0.0, 0.0, 0.0)"
    : where === "target"
      ? "abilityTarget.position()"
      : centre.aimed
        ? `abilityPoint(0.0, ${real(centre.up)}, 0.0).add(abilityDirection(${real(centre.up)}, 0.0).scale(${real(centre.forward)}))`
        : `abilityPoint(${real(centre.forward)}, ${real(centre.up)}, ${real(centre.left)})`
}

function effectSource(ability: Ability, event: EffectEvent, sized: boolean) {
  const centre = hitCentre(ability.hits[event.hit ?? 0] ?? ability.hits[0]!)
  const origin = eventOrigin(ability, event.where, event.hit)
  const frame = eventFrame(ability, event)
  // r29c: the size each one is drawn at, only where the class's two methods take one.
  const size = sized ? `, ${real(event.size ?? 1)}f` : ""
  if (frame.along === "aim") {
    const aim = `abilityDirection(${real(frame.up)}, ${real(frame.forward)})`
    // The target's feet are where the target is. Everything else is counted from where the aim starts, so the whole layout turns with the hit as one piece:
    // its own feet lie behind and below that point, the middle of the hit lies ahead of it along the aim.
    if (event.where === "target") return `abilityEffectAimed("${event.effect}", abilityTarget.position(), ${aim}, ${real(event.forward)}, ${real(event.up)}, ${real(event.left)}, ${event.count}, ${event.layout === "ring"}, ${real(event.spread)}${size});`
    const level = event.where === "self" ? { forward: 0, up: 0, left: 0 } : centre
    return `abilityEffectAimed("${event.effect}", abilityPoint(${real(frame.forward)}, ${real(frame.up)}, ${real(level.left)}), ${aim}, ${real(level.forward - frame.forward + event.forward)}, ${real(level.up - frame.up + event.up)}, ${real(event.left)}, ${event.count}, ${event.layout === "ring"}, ${real(event.spread)}${size});`
  }
  return `abilityEffect("${event.effect}", ${origin}, ${real(event.forward)}, ${real(event.up)}, ${real(event.left)}, ${event.count}, ${event.layout === "ring"}, ${real(event.spread)}${size});`
}

/**
 * `boss` (boss runtime, 10-12): the creature is a boss, so an ability starts only in the phase that allows it (`bossAllows`, written by the boss
 * runtime), the damage it does is multiplied by its phase's number (`bossDamageScale`), and `tracker` is the line that registers the boss's own synced value. `opening`: the boss
 * has a named first attack, so the boss is told when an ability starts (`bossStarted`) and holds the others back until that one has (written only then).
 * `flight` (flight, 10-12): the creature flies, so an ability starts only where it may (`flightAllows`: on the ground, in the air, and a dive only in the air),
 * turns no faster than it may fly (`flightTurnCap`), never walks up to its target while it is in the air, and ignores its own pushes there (it is carried by its flight).
 * `reaches` (epic game1): some ability in the air is aimed at the one it fights, so it starts only when its hits can reach them by the first (\`flightReaches\`, written by the flight).
 * `extraTracker`: the lines that register the synced values of the flight and the habits.
 * `anchors`: per ability, per hit, where a hit that names a bone counts from, in the creature's own terms at the size its model is built (`hitAnchor`, measured on the
 * model and the ability's own motion at the hit's tick), null for a hit that counts from the feet. A hit with an anchor sets the origin (`abilityAnchor`) for its own statements, and the
 * origin is the feet again after it; the creature's size scales it, and for a flier the lean of its flight carries it (`flightLeaned`, written by the flight when `lean`).
 * Without any anchor every piece below is what it was, to the byte.
 */
/**
 * epic game5: a dragon landed for its ground-only tail sweep (window 6 to 11.5 blocks), stood 6.2 s with the player 4.6 to 5.7 blocks away and took off again, the sweep never used: a creature that walks
 * up to its target walks up to its body, and nothing took it back to the window. A body of width w that has walked up to a player (0.6 wide) stands (w + 0.6) / 2 from them, 2 blocks or less up to a
 * width of 3.4: a window whose least distance is under 2 blocks is one the walk brings it to anyway. From 2 blocks up a ready ability whose window it stands nearer than steps back (\`abilityBackOff\`).
 */
export const ABILITY_BACK_OFF = 2

export function compileAbilities(input: { stances?: Stances | undefined; stanceBoss?: Boss | null; terrainInteractions?:boolean; weightedPose?: boolean; particleIndices?: Readonly<Record<string, number>>; emitBone?: (ability: Ability, name: string, tick: number) => Place | null; arena?: import("../arena").Arena | null | undefined; steady?: import("../creature-steady").SteadyPlan | null; combat?: boolean; guard?: Guard; stagger?: Stagger | undefined; damageCap?: number | undefined; parts?: string[] | undefined; entity: string; model: string; abilities: readonly Ability[]; hostile: boolean; runtime: boolean; death: boolean; targeted?: boolean; stationary?: boolean; boss?: { tracker: string; opening?: boolean }; flight?: boolean; reaches?: boolean; extraTracker?: string; anchors?: readonly (readonly (Place | null)[])[]; combos?: readonly Combo[]; trailTips?: readonly (readonly (readonly [number, number, number] | null)[])[]; /** 第 4 步: per ability, per event, where a beam starts (`groundFxStarts`). */ groundStarts?: readonly (readonly (BeamStart | null)[])[]; /** 第 3 步: how it fights between abilities, and a boss's phases (whose `between` each sets that from the phase on). */ tactics?: Tactics | null; phases?: readonly { between?: Between | undefined }[]; /** 任务二 §9: how a sound of the project's own is named and under which category it plays (`fabric/sound.ts`); without it only vanilla sounds can be played. */ sound?: (ref: SoundRef) => { event: string; source: string }; /** 第 2 步: per ability, whether its clip is `layered` (the walk keeps the bones it does not key, and it keeps walking to its target). */ layered?: readonly boolean[] }) {
  // Boss 能力 7: an ability's lightning lands as area hits after its own (`struckAbility`): the very same abilities when none has any.
  const abilities = input.abilities.map(ability => struckAbility({ ...ability, events: expandFeedback(ability.events) }))
  const sound = input.sound ?? ((ref: SoundRef) => ({ event: soundJava(ref, "", {}), source: "getSoundSource()" }))
  const none = { imports: "", fields: "", tracker: "", methods: "", tick: "", goal: "", engage: "", controller: "", shown: "", interrupt: "", pace: undefined as string | undefined }
  if (!abilities.length) return none
  // 第 2 步: abilities that walk while they play (their clip is layered); null when none does, and nothing below differs to the byte.
  const walks = input.layered?.some(Boolean) && !input.stationary ? abilities.map((_, index) => Boolean(input.layered![index])) : null
  const actions = abilities.some(move => move.events.some(event => event.type === "fixture"))
  const captures = abilities.map(move => new Set(move.events.flatMap(event => event.type === "fixture" && typeof event.which === "object" && "in_hit" in event.which ? [event.which.in_hit] : [])))
  const geometry = captures.some(set => set.size)
  const plans = abilities.map(abilityPlan)
  // Combos (连招): chosen like abilities, after them (combo n is choice `abilities.length + n`), and played step by step. Without any, nothing below differs from what it was, to the byte.
  const combos = input.combos ?? []
  const chained = combos.length > 0
  // A flier's flight decides by the ability that runs, which a combo changes between steps: the document refuses that (`comboDocumentIssues`), and so does the build.
  if (chained && input.flight) throw new BuildStop("combo_flight", [{ text: "会飞的生物现在还不能用连招。", fix: "先去掉连招，或者把连招拆回单独的招式。" }])
  const stepsOf = combos.map((combo) =>
    combo.steps.map((id) => {
      const index = abilities.findIndex((ability) => ability.id === id)
      if (index < 0) throw new BuildStop("combo_step", [{ text: `连招「${combo.name}」里有一招，这只生物还没学会。`, fix: `从已有招式（${abilities.map((ability) => ability.name).join("、")}）里选一个，或者给它补上这招。` }])
      return index
    }),
  )
  const choices = [...abilities.map((ability) => ability.start), ...combos.map((combo) => combo.start)]
  const bearing = combatBearingJava(choices)
  const stance = compileStances(input.stances, abilities, combos, input.stanceBoss, input.entity, input.model)
  const weights = combatWeightJava(choices, bearing, stance?.indexOf)
  const fixtureGates = choices.flatMap((start, index) => {
    const fixtures = start.when?.filter(rule => rule.if === "fixtures_lit") ?? []
    return fixtures.length ? [`        if (index == ${index} && !(${fixtures.map(rule => conditionJava(rule, {})).join(" && ")})) return false;\n`] : []
  })
  for (const [index, move] of abilities.entries()) if (moveAimsAtFixture(move))
    fixtureGates.push(`        if (index == ${index} && StudioArena.litCount(StudioArena.room(this), this, yBodyRot, 360) == 0) return false;\n`)
  for (const [index, steps] of stepsOf.entries()) if (steps.some(slot => moveAimsAtFixture(abilities[slot]!)))
    fixtureGates.push(`        if (index == ${abilities.length + index} && StudioArena.litCount(StudioArena.room(this), this, yBodyRot, 360) == 0) return false;\n`)
  const combat = Boolean(stance) || input.combat || fixtureGates.length > 0 || Boolean(weights) || combos.some(combo => combo.branches?.some(branch => branch.chance !== undefined))
  const hits = abilities.flatMap((ability) => ability.hits)
  // Where each hit counts from: its bone's place, or the feet. A hit that names a bone without anyone having measured it is a build that cannot be written as it was asked.
  const anchorOf = (ability: number, hit: number) => {
    const named = hitBone(abilities[ability]!.hits[hit]!) !== undefined
    const place = input.anchors?.[ability]?.[hit] ?? null
    if (named && !place) throw new BuildStop("ability_bone", [{ text: `招式「${abilities[ability]!.name}」第 ${hit + 1} 次出手写了部位（bone），可是没有量出它在哪里。`, fix: "这是 Studio 自己没量出来：请先让这只生物的模型和招式重新通过检查，再打包。" }])
    return place
  }
  const anchored = abilities.some(ability => ability.events.some(event => event.type === "particle" && event.bone)) || abilities.some((ability, index) => ability.hits.some((_, hit) => anchorOf(index, hit) !== null))
  const shifted = (text: string, alternative: string) => (anchored ? alternative : text)
  const areas = hits.flatMap((hit) => (hit.type === "area" ? [hit] : []))
  const guided = abilities.some(ability => ability.hits.some(hit => hit.type === "shot" && hit.homing))
  const shots = [...new Set(hits.flatMap((hit) => (hit.type === "shot" ? [hit.projectile] : [])))]
  // An arc with a hollow middle counts as a "ring" (`shapeKind`): it has methods of its own, and every other arc's code stays what it was.
  const uses = (type: string) => areas.some((hit) => shapeKind(hit.shape) === type)
  // A hit with a negative knockback pulls its victim toward the creature; only then is the pull written, so every other creature's class is what it always was.
  const pulls = areas.some((hit) => hit.knockback < 0)
  // H3: the effect assets its abilities show; without any, nothing below differs from what it was.
  const shows = abilities.some((ability) => ability.events.some((event) => event.type === "effect"))
  // r29c: some effect is drawn at a size of its own (`size`, or a shared ability's `scale`); only then do the two methods below take one, so every other class is what it was.
  const sizedFx = abilities.some((ability) => ability.events.some((event) => event.type === "effect" && event.size !== undefined))
  // J2: a beam or a cone kept level goes the way the creature faces; one laid out along an aim needs that aim.
  const levels = areas.some((hit) => (hit.shape.type === "line" || hit.shape.type === "cone") && hit.shape.aim === "level")
  const frames = abilities.flatMap((ability) => ability.events.flatMap((event) => (event.type === "effect" ? [eventFrame(ability, event).along] : [])))
  // A shot that falls on its way (an arrow, a snowball) is aimed higher than the one it fights, by the fall on the way there (`abilityArc`).
  const arcs = shots.some((shot) => ABILITY_PROJECTILES[shot].gravity > 0)
  const remembersEmissionHit = (a: Ability, slot: number) => a.events.some(e => (e.type === "particle" || e.type === "sound" || e.type === "shake") && e.where === "hit" && e.hit === slot)
  const savedHits = abilities.some(a => a.hits.some((hit, slot) => remembersEmissionHit(a, slot) && !hitFixed(hit)))
  const aims = abilities.some(a => a.events.some(e => e.type === "particle" && e.where === "hit" && e.hit != null && hitCentre(a.hits[e.hit]!).aimed)) || shots.length > 0 || areas.some((hit) => (hit.shape.type === "line" || hit.shape.type === "cone") && hit.shape.aim !== "level") || frames.includes("aim")
  const particles = abilities.some((ability) => ability.events.some((event) => event.type === "particle"))
  // Boss 能力 11: a particle of the project's own (`{ asset }`) and a weapon trail. Without them nothing below differs from what it was, to the byte.
  const vanillaParticles = abilities.some((ability) => ability.events.some((event) => event.type === "particle" && typeof event.particle === "string"))
  const ownParticles = abilities.some((ability) => ability.events.some((event) => event.type === "particle" && typeof event.particle !== "string"))
  const trails = abilities.flatMap((ability, index) => ability.events.flatMap((event) => (event.type === "trail" ? [{ ability: index, event }] : [])))
  // Only a vanilla sound is named by its `SoundEvents` constant; one of the project's own is named in full.
  const sounds = abilities.some((ability) => ability.events.some((event) => event.type === "sound" && !isSoundAsset(event.sound)))
  // r29 (a fix of r28): a loop's collision rule names Vec3 (`abilityContact`), which was imported only when something else needed it, so such a creature did not always compile.
  const collides = abilities.some((ability) => ability.stages?.some((stage) => stage.end?.collision?.length))
  // Boss runtime (10-12): the two events that make a fight felt; without them nothing below differs from what it was.
  const cinematic = abilities.some(a => a.events.some(e => e.type === "camera" || e.type === "sky_tint"))
  const styledDebris = abilities.some(a => a.events.some(e => e.type === "debris" && (e.block || e.dust)))
  const thrownDebris = abilities.some(a => a.events.some(e => e.type === "debris" && e.throw))
  const shakes = abilities.some((ability) => ability.events.some((event) => event.type === "shake"))
  // Boss 能力 8: a shake with roll, a change of view, its falloff or its frequency calls the longer method; without one nothing differs from what it was.
  const shakesMore = abilities.some((ability) => ability.events.some((event) => event.type === "shake" && shakeStatement(event, 1).startsWith("abilityShakeMore")))
  const debris = abilities.some((ability) => ability.events.some((event) => event.type === "debris"))
  // 第 4 步: ground hazards, cracks, shockwaves and beams (common/ground-fx.ts). Without any every piece of it is empty, and nothing below differs from what it was.
  const grouped = abilities.some(hasOnce)
  const eventPlaces = abilities.some(a=>a.events.some(e=>remoteSlot(a,e)!==null))
  const ringSlots = Math.max(0,...abilities.flatMap(a => a.events.flatMap((e,i) => e.type === "shockwave" && e.warn ? [i+1] : [])))
  const ringCount = Math.max(1,...abilities.flatMap(a=>a.events.flatMap(e=>{
    const slot=remoteSlot(a,e)
    if(e.type!=="shockwave" || !e.warn || slot===null)return []
    const h=a.hits[slot]!
    const place=h.type==="area" ? hitPlace(h) : "self"
    return [typeof place==="object" && !("fixture" in place) ? (place.type==="pattern" ? place.points.length : place.count) : 1]
  })))
  const ground = groundFxJava(abilities, input.groundStarts, `${input.boss ? "bossDamageScale()" : "1.0f"}${combos.length ? " * abilityDamageScale()" : ""}`)
  const grounds = ground.fields !== "" || abilities.some(a => a.events.some(isTerrainEvent))
  // An ability that breaks blocks (`break`, boss runtime `StudioBreak`); without one nothing below differs from what it was.
  const quietBreak = abilities.some(a => a.events.some(e => e.type === "break" && e.particles === false))
  const breaks = abilities.some((ability) => ability.events.some((event) => event.type === "break"))
  const scaled = Boolean(input.boss)
  // Boss 能力 3: area hits put down at places decided before they land (somewhere else, or warned of), and the warnings drawn before them. Without any, nothing below differs from what it was.
  const walls = areas.some(hit => hit.blocked_by_walls)
  const fixed = areas.filter(hitFixed)
  const placed = fixed.length > 0
  const markers = fixed.some(h => usesFieldWarn(h.warn))
  const warned = fixed.some((hit) => hit.warn !== undefined)
  const placedBy = (kind: string) => fixed.some((hit) => ((place) => (typeof place === "string" ? place : place.type) === kind)(hitPlace(hit)))
  const placedIn = (type: string) => fixed.some((hit) => shapeKind(hit.shape) === type)
  const warns = abilities.map(ability => {
    const leap = leapPlan(ability)
    return warnPlan(ability).map(warn => {
      if (!warn) return null
      const hit = ability.hits[warn.index] as AreaHit
      const at = warn.start + warn.ticks
      const landing = leap?.leap.landing_hit === warn.index ? "reserved" as const :
        input.steady && leap && at === leap.start + leap.ticks && hitPlace(hit) === "self" && hit.shape.type !== "arena" ? "active" as const : undefined
      const start = landing === "active" ? Math.max(warn.start, leap!.start) : warn.start
      return { ...warn, start, ticks: at - start, landing }
    })
  })
  // r29: what is shown the moment it runs into something (`fabric/impact-fx.ts`). Without any such moment every piece is empty, and nothing below differs from what it was.
  const impacts = compileImpacts({ abilities, staggers: staggerList(input.stagger), sound, touched: abilities.some((ability) => ability.stages?.some((stage) => stage.end?.impact?.touch)) })
  // Boss 能力 4: a dash and the forces hits leave (`fabric/ability-dash.ts`). Without either every piece of it is empty, and nothing below differs from what it was.
  const motion = compileDashForce({ terrainInteractions: !!input.terrainInteractions, abilities, flight: Boolean(input.flight), steady: Boolean(input.steady), impacts })
  // 第 3 步: tracking, leaps, a leading aim, stages, branching combos and how it fights between abilities (`fabric/ability-tactics.ts`). Without any of them every piece is empty, and nothing below differs from what it was.
  const tactics = compileTactics({ impacts, staggerLimits: staggerList(input.stagger).some(row => row.cooldown !== undefined || row.max_times !== undefined), staggerIds:staggerList(input.stagger).map(row=>row.id??"default"), steady: input.steady ?? null, abilities, combos, combat, model: input.model, tactics: input.tactics ?? null, phases: input.phases ?? [], boss: Boolean(input.boss), flight: Boolean(input.flight), stationary: Boolean(input.stationary), dashes: motion.methods.includes("abilityDashTick"), warned, setups: abilities.map((ability, index) => [...warns[index]!.flatMap((warn) => (warn ? [{ start: warn.start, hit: warn.start + warn.ticks }] : [])), ...projectileWarnTicks(ability, plans[index]!).map(({ hit, start }) => ({ start, hit: hit.tick }))]) })
  const places = walls || aims || levels || particles || uses("sphere") || shows || debris || breaks || placed || grounds
  const hurt = abilities.some((ability) => ability.stopped_by_hurt)
  // Boss 能力 14: abilities a blow starts (`fabric/ability-parry.ts`). Without one every piece of it is empty, and nothing below differs from what it was.
  const parry = parryJava(abilities, { combat, weighted: Boolean(weights), boss: Boolean(input.boss), seeded: placedBy("around_target"), flight: Boolean(input.flight), headYaw: input.steady?.head.yaw, bearing })
  const parrying = parry.head !== ""
  const stopMotion = (motion.methods.includes("abilityDashTick") ? "\n        abilityDashLeft = 0;" : "") +
    (abilities.some(ability => leapPlan(ability)) ? "\n        abilityLeapTicks = abilityLeapStep = 0;" : "")
  const combatHurt = combatHurtJava(abilities, input.parts, parry, shows, input.guard, input.stagger, input.entity, Boolean(input.boss), input.damageCap, input.arena, stopMotion, stance, input.stances, impacts)
  // Some ability is a window it can stand nearer than: only then is the step back written (anything else is what it was, to the byte).
  // A creature that stays where it is on purpose (`stationary`) never walks to its target nor steps back from it: it turns to face it, and uses what it can use from where it stands.
  const backs = input.hostile && !input.stationary && abilities.some((ability) => !ability.dive && !ability.on_hurt && ability.start.min_distance >= ABILITY_BACK_OFF)
  // epic game5: per ability, how far off its target the body may point when it starts (`faceTolerance`, degrees; 180: any). Only when some ability is held to it is anything below written, so any other creature's class is what it was.
  const tolerances = abilities.map((ability, index) => faceTolerance(ability, ability.hits.map((_, hit) => anchorOf(index, hit)), input.steady ? ability.turn_speed ?? input.steady.ability_turn : undefined))
  const faces = tolerances.some((value) => value < 180)
  // An otherwise ready ground cast can need a tighter bearing than the idle body's turn threshold.
  const alignBeforeStart = Boolean(input.steady && input.steady.body_turn > 0 && Math.min(...tolerances) < input.steady.turn_after)
  const freeHeading = choices.some(start => start.keep_heading) && (input.flight || faces)
  const earlyFacing = [
    freeHeading && input.flight && "!flightFaces(index, target)",
    faces && !alignBeforeStart && "!abilityFaces(index, target)",
  ].filter(Boolean).join(" || ")
  const facingGate = !earlyFacing ? "" : freeHeading
    ? ` || (!ABILITY_KEEP_HEADING[index] && (${earlyFacing}))`
    : ` || ${earlyFacing}`
  // The statements of a hit, or of what is shown with it, counted from a place on the body: the origin is set before them and is the feet again after them.
  const counted = (place: Place | null, lines: string[]) => (place ? [`abilityAnchor(${real(place.forward)}, ${real(place.up)}, ${real(place.left)});`, ...lines, "abilityAnchorClear();"] : lines)
  // What is shown with a hit (an effect or the debris laid on where it lands, or along its aim) is counted from where that hit counts from; anything else from where it always was.
  const eventAnchor = (ability: number, event: Ability["events"][number]) => {
    if (event.type !== "effect" && event.type !== "debris" && event.type !== "break" && !isGroundPlaced(event) && !isTerrainEvent(event)) return null
    const hit = event.hit
    if (hit === null || (event.where !== "hit" && !(event.type === "effect" && eventFrame(abilities[ability]!, event).along === "aim"))) return null
    return anchorOf(ability, hit)
  }
  const placedSound = (a:Ability, e:Extract<Ability["events"][number],{type:"sound"|"shake"}>) => {
    if(e.where !== "hit" || e.hit == null) return e.where === "target" ? "abilityTarget.position()" : "position()"
    const h=a.hits[e.hit]!
    if(!hitFixed(h)) return `emitHitPoint[${e.hit}]`
    const centre=hitCentre(h)
    return `abilityEventPlace(${e.hit}, landingOffset, ${real(centre.forward)}, ${real(centre.up)}, ${real(centre.left)})`
  }
  const steps = abilities.map((ability, index) => {
    const plan = plans[index]!
    const warnings = warns[index]!.flatMap(warn => warn ? [{
      tick: warn.start,
      lines: warnSource(ability.hits[warn.index] as AreaHit, warn.index, warn.ticks, warn.landing),
      prepares: warn.start + warn.ticks,
      landing: warn.landing,
    }] : [])
    const due = [
      ...tactics.prepare(index),
      // Boss 能力 3: a warning begins before anything else its tick does, so its places are decided before a push or a hit of that tick.
      ...warnings.filter(warn => warn.landing !== "active"),
      ...plan.moves.map((move) => ({ tick: move.tick, lines: [`abilityPush(${real((ability.moves[move.index] as PushMove).forward)}, ${real((ability.moves[move.index] as PushMove).up)});`] })),
      // Boss 能力 4: a dash starts on its tick (with the moves, before the hits); the hit it carries is counted along it (`motion`), not at its own moment.
      ...motion.due(index),
      // 第 3 步: a stage that switches the motion, and a leap, on their ticks.
      ...tactics.due(index),
      ...warnings.filter(warn => warn.landing === "active"),
      ...plan.hits.filter((hit) => !motion.carried(index, hit.index)).map((hit) => {
        const value = ability.hits[hit.index]!
        return { tick: hit.tick, lines: motion.forced(index, hit.index, value.type === "area" && hitFixed(value) ? placedHitSource(value, hit.index, warns[index]![hit.index] !== null, walls, captures[index]!.has(hit.index), tactics.landingHit(index) === hit.index) : counted(anchorOf(index, hit.index), hitSource(value, levels, scaled, chained, hit.index, hit.tick, captures[index]!.has(hit.index)))) }
      }),
      ...ability.events.flatMap((v,i) => {
        if(v.type !== "shockwave" || !v.warn) return []
        const slot=remoteSlot(ability,v)
        const markerIndex=slot===null ? String(i) : `${i} + (landingOffset / 3) * ${ringSlots}`
        const w = v.warn, ticks = abilityTick(w.seconds)
        const from = eventOrigin(ability, v.where, v.hit)
        const centre = slot === null ? null : hitCentre(ability.hits[slot]!)
        const spot = centre ? `abilityEventPlace(${slot}, landingOffset, ${real(centre.forward+v.forward)}, ${real(centre.up)}, ${real(centre.left+v.left)})` : `${from}.add(abilityPoint(${real(v.forward)}, 0.0, ${real(v.left)}).subtract(position()))`
        const shape = [single(v.from_radius + v.width/2), "180.0f", "0f", "0f", single(Math.max(0,v.from_radius-v.width/2)), single(w.extent === "max" ? v.to_radius + v.width/2 : 0)].join(", ")
        const packet = `new StudioWarn.Warn(getId(), ${ticks}, ${warnLook({...w,paint:w.paint ?? "mesh"})}, ${ABILITY_WARN.colors[w.color]}, 2, abilityYaw, ${shape}, new double[]{ringAt.x,ringAt.y,ringAt.z})`
        return [{tick: Math.max(0,abilityTick(v.at)-ticks), lines: eachLanding(slot,[`{ Vec3 ringAt = ${spot}; ringWarns[${markerIndex}] = new StudioWarn.Marker((net.minecraft.server.level.ServerLevel)level(), this, ${packet}, ${w.follow === "caster" ? "this" : w.follow === "target" ? "abilityTarget" : "null"}, ${abilityTick(w.lock_before ?? 0)}, ${abilityTick(w.fade_seconds ?? 0)}, ${JSON.stringify(w.effect ?? "")}); }`])}]
      }),
      // Boss 能力 2: a volley from the sky that is warned of is thrown when its warning begins (its places decided and shown then), and waits in the sky until the tick of its hit.
      ...projectileWarned(ability, plan, scaled, chained),
      ...plan.hits.flatMap(h => remembersEmissionHit(ability, h.index) && !hitFixed(ability.hits[h.index]!) ? [{
        tick: h.tick, lines: counted(anchorOf(index, h.index), [
          `emitHitPoint[${h.index}] = ${eventOrigin(ability, "hit", h.index)};`,
          `emitHitYaw[${h.index}] = abilityYaw;`,
        ]),
      }] : []),
      // A trail is drawn by the players' games alone (`StudioTrails`): the server does nothing at its moment.
      ...plan.events.filter((event) => ability.events[event.index]!.type !== "trail").map((event) => {
        const value = ability.events[event.index]!
        if (value.type === "hit_fx") throw new Error("命中反馈没有展开。")
        if (value.type === "particle" && extendedEmit(value)) {
          const hit = value.where === "hit" && value.hit != null ? ability.hits[value.hit] : undefined
          const fixed = hit?.type === "area" && hitFixed(hit)
          const anchor = value.bone ? input.emitBone?.(ability, value.bone, event.tick) : null
          if (value.bone && !anchor) throw new BuildStop("particle_bone", [{ text: `招式「${ability.name}」找不到发射粒子的部件「${value.bone}」。`, fix: "换成模型里已有的部件名。" }])
          const centre = fixed ? hitCentre(hit) : null
          const yaw = fixed ? `abilityPlaceYaw[${value.hit}]` : hit ? `emitHitYaw[${value.hit}]` : "abilityYaw"
          const origin = centre ? `StudioEmit.offset(new Vec3(places[i], places[i + 1], places[i + 2]), ${yaw}, ${real(centre.forward)}, ${real(centre.up)}, ${real(centre.left)})` : hit ? `emitHitPoint[${value.hit}]` : value.where === "target" ? "abilityTarget.position()" : "abilityPoint(0, 0, 0)"
          const at = `StudioEmit.offset(${origin}, ${yaw}, ${real(value.forward)}, ${real(value.up)}, ${real(value.left)})`
          const send = `StudioEmit.send(world, ${at}, ${yaw}, ${emitArguments(value, input.particleIndices)});`
          const lines = fixed ? [`if (level() instanceof ServerLevel world && abilityPlaces[${value.hit}] != null) {`, `    double[] places = abilityPlaces[${value.hit}];`, `    for (int i = 0; i < places.length; i += 3) ${send}`, "}"] : [`if (level() instanceof ServerLevel world) ${send}`]
          return { tick: event.tick, lines: counted(anchor ?? null, lines) }
        }
        if (value.type === "trail") throw new Error("unreachable: trails are left out above")
        return {
          tick: event.tick,
          lines: eachLanding(remoteSlot(ability,value), counted(eventAnchor(index, value), [
            value.type === "effect"
              ? effectSource(ability, value, sizedFx)
              : value.type === "sound"
                ? ((played) => `${value.where && value.where !== "self" ? `{ Vec3 soundAt = ${placedSound(ability,value)}; level().playSound(null, soundAt.x, soundAt.y, soundAt.z` : "level().playSound(null, getX(), getY(), getZ()"}, ${rangedSound(played.event,value.range_blocks)}, ${played.source}, ${single(value.volume)}, ${variedPitch(single(value.pitch), value.pitch_variation, "getRandom()")});${value.where && value.where !== "self" ? " }" : ""}`)(sound(value.sound))
                : value.type === "camera" || value.type === "sky_tint"
                  ? `if (level() instanceof ServerLevel world) ${cinematicStatement(value.type, value)}`
                : value.type === "shake"
                  ? (value.where && value.where !== "self" ? shakeStatement(value, Math.max(1,abilityTick(value.seconds))).replace(/^abilityShake(?:More)?\(/, `if (level() instanceof ServerLevel world) ${BOSS_RUNTIME.shake}.send(world, ${placedSound(ability,value)}, `) : shakeStatement(value, Math.max(1, abilityTick(value.seconds))))
                  : value.type === "drop"
                    ? `bossDropAt(${index}, ${event.index});`
                  : // Boss 能力 12: the fog of its arena comes down.
                    value.type === "stance" ? stance!.action(value.to) : value.type === "fixture" ? fixtureStatement(value, input.arena, "ability") : value.type === "fog"
                    ? ARENA_FOG
                  : // 第 4 步: a ground hazard, a crack, a shockwave or a beam (common/ground-fx.ts).
                    isTerrainEvent(value)
                    ? terrainStatement(value, eventOrigin(ability, value.where, value.hit, false), `${input.boss ? "bossDamageScale()" : "1.0f"}${combos.length ? " * abilityDamageScale()" : ""}`)
                    : isGroundFx(value)
                    ? value.type === "shockwave" && value.warn
                      ? `{ var marker = ringWarns[${event.index}${remoteSlot(ability,value)===null ? "" : ` + (landingOffset / 3) * ${ringSlots}`}]; if (marker != null) { marker.move(); ${ground.statement(index,event.index,"marker.spot()",true)} marker.stop(); ringWarns[${event.index}${remoteSlot(ability,value)===null ? "" : ` + (landingOffset / 3) * ${ringSlots}`}] = null; } }`
                      : ground.statement(index, event.index, isGroundPlaced(value) ? eventOrigin(ability, value.where, value.hit) : "")
                  : value.type === "debris"
                    ? `abilityDebris(${eventOrigin(ability, value.where, value.hit)}, ${real(value.forward)}, ${real(value.up)}, ${real(value.left)}, ${real(value.radius)}, ${value.count}${styledDebris ? `, ${value.block ? `${BOSS_RUNTIME.debris}.block(${JSON.stringify(value.block)})` : "null"}, ${!value.dust ? "null" : typeof value.dust === "string" ? `net.minecraft.core.particles.ParticleTypes.${value.dust.toUpperCase()}` : `${PARTICLE_RUNTIME.table}.byAsset(${JSON.stringify(resolvedAsset(value.dust))})`}` : ""}${value.throw ? `, ${real(value.throw.speed)}, ${real(value.throw.spread)}, ${real(value.throw.gravity)}` : ""});`
                  : value.type === "break"
                    ? `abilityBreak(${eventOrigin(ability, value.where, value.hit)}, ${real(value.forward)}, ${real(value.up)}, ${real(value.left)}, ${real(value.radius)}, ${real(value.height)}, ${single(value.hardness)}, ${value.drops}${quietBreak ? `, ${value.particles !== false}` : ""});`
                    : typeof value.particle === "string"
                      ? `abilityParticles(ParticleTypes.${value.particle.toUpperCase()}, ${real(value.forward)}, ${real(value.up)}, ${real(value.left)}, ${value.count}, ${real(typeof value.spread === "number" ? value.spread : value.spread.forward)});`
                      : `abilityOwnParticles("${resolvedAsset(value.particle)}", ${real(value.forward)}, ${real(value.up)}, ${real(value.left)}, ${value.count}, ${real(typeof value.spread === "number" ? value.spread : value.spread.forward)});`,
          ])),
        }
      }),
      // Boss 能力 7: on the tick each lightning lands, after the hit it lands as, the bolts the players see come down on its places.
      ...lightningSteps(ability, plan, input.particleIndices, sound),
      // Boss 能力 13: a boss leaving the field and coming back (fabric/arena.ts).
      ...arenaSteps(ability, plan),
    ]
    const ticks = [...new Set(due.map((value) => value.tick))].sort((a, b) => a - b)
    // 第 3 步: the ticks of a loop that may end early on which what a blow after it needs begins: there, all else is the rest of the loop and is held back while the loop has ended (`abilityQuiet`).
    const quiet = tactics.quiet(index)
    const statements = (tick: number) => {
      const entries: { lines: string[]; prepares?: number }[] = due.filter((value) => value.tick === tick)
      if (!quiet || tick < quiet.from || tick >= quiet.to) return entries.flatMap((value) => value.lines)
      const out: string[] = []
      let held: string[] = []
      const hold = () => {
        if (held.length) out.push("if (!abilityQuiet(tick)) {", ...held.map((line) => `    ${line}`), "}")
        held = []
      }
      for (const entry of entries) {
        if (entry.prepares !== undefined && entry.prepares >= quiet.to) {
          hold()
          out.push(...entry.lines)
        } else held.push(...entry.lines)
      }
      hold()
      return out
    }
    const rising = plan.events.flatMap(({ index: slot, tick }) => {
      const event = ability.events[slot]!
      if (event.type !== "sound" || event.pitch_to === undefined) return []
      const voice = sound(event.sound)
      const pitch = `(${single(event.pitch)} + (${single(event.pitch_to)} - ${single(event.pitch)}) * (tick - ${tick}) / ${Math.max(1, plan.windup - tick)})`
      if (event.where && event.where !== "self") {
        const lines = eachLanding(remoteSlot(ability,event), [`Vec3 soundAt = ${placedSound(ability,event)};`, `level().playSound(null, soundAt.x, soundAt.y, soundAt.z, ${rangedSound(voice.event,event.range_blocks)}, ${voice.source}, ${single(event.volume)}, ${variedPitch(pitch,event.pitch_variation,"getRandom()")});`])
        return [`        if (tick > ${tick} && tick <= ${plan.windup} && ((tick - ${tick}) % 4 == 0 || tick == ${plan.windup})) {\n${lines.map(line=>"            "+line).join("\n")}\n        }\n`]
      }
      return [`        if (tick > ${tick} && tick <= ${plan.windup} && ((tick - ${tick}) % 4 == 0 || tick == ${plan.windup})) level().playSound(null, getX(), getY(), getZ(), ${rangedSound(voice.event,event.range_blocks)}, ${voice.source}, ${single(event.volume)}, ${variedPitch(pitch, event.pitch_variation, "getRandom()")});\n`]
    }).join("")
    return `    // Ability ${index} "${ability.id}" plays "${ability.clip}": gets ready until tick ${plan.windup}, acts on tick ${plan.hits.map((hit) => hit.tick).join(", ")}, is over at tick ${plan.length} (${TICKS} ticks a second).
${emissionTimeline(`abilityStep${index}`, false, ability.events.some(e => e.type === "particle" && e.until !== undefined), ticks, tick => `        if (tick == ${tick}) {\n${statements(tick).map(line => `            ${line}`).join("\n")}\n        }`, rising)}`
  })
  // For a creature without a runtime block its abilities bring the one goal that fights (`goal`).
  const fights = input.hostile && !input.runtime
  return {
    ...(alignBeforeStart ? { alignBeforeStart: true } : {}),
    // Each import only where what it names is used: the class carries none it does not use.
    imports: `import java.util.EnumSet;
import java.util.List;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.LivingEntity;
${uses("arc") || uses("ring") || uses("box") || placed ? "import net.minecraft.world.phys.AABB;\n" : ""}${shows ? "import java.util.ArrayList;\nimport net.minecraft.world.entity.Entity;\n" : ""}${places || pulls || guided || collides ? "import net.minecraft.world.phys.Vec3;\n" : ""}${hurt || parrying || combatHurt ? "import net.minecraft.world.damagesource.DamageSource;\n" : ""}${areas.some((hit) => hit.effects.length) ? "import net.minecraft.world.effect.MobEffectInstance;\nimport net.minecraft.world.effect.MobEffects;\n" : ""}${sounds ? "import net.minecraft.sounds.SoundEvents;\n" : ""}${particles ? `import net.minecraft.core.particles.ParticleOptions;\n${vanillaParticles ? "import net.minecraft.core.particles.ParticleTypes;\n" : ""}` : ""}${ownParticles ? "import net.minecraft.core.particles.SimpleParticleType;\n" : ""}${particles || shakes || debris || cinematic || breaks ? "import net.minecraft.server.level.ServerLevel;\n" : ""}${shots.includes("arrow") ? "import net.minecraft.world.entity.projectile.Arrow;\nimport net.minecraft.world.item.ItemStack;\nimport net.minecraft.world.item.Items;\n" : ""}${shots.includes("snowball") ? "import net.minecraft.world.entity.projectile.Snowball;\n" : ""}${shots.includes("small_fireball") ? "import net.minecraft.world.entity.projectile.SmallFireball;\n" : ""}${shots.includes("fireball") ? "import net.minecraft.world.entity.projectile.LargeFireball;\n" : ""}${fights ? "import net.minecraft.world.entity.ai.goal.Goal;\n" : ""}`,
    fields: `    // ---- abilities: data from the creature's document, run on the server ----
    // Which ability is showing, for every player's game: 0 for none, else its number plus one in the low byte and above it a count that changes on every start.
    private static final EntityDataAccessor<Integer> ABILITY = SynchedEntityData.defineId(${input.entity}.class, EntityDataSerializers.INT);
    private static final RawAnimation[] ABILITY_CLIPS = {
${abilities.map((ability) => `        RawAnimation.begin().thenPlay("animation.${input.model}.${ability.clip}"),`).join("\n")}
${tactics.clips}    };
    // Per ability, in ticks: when getting ready ends, when it is over, how long before it may start again.
    private static final int[] ABILITY_WINDUP = ${list(plans.map((plan) => plan.windup))};
    private static final int[] ABILITY_LENGTH = ${list(plans.map((plan) => plan.length))};
    private static final int[] ABILITY_COOLDOWN = ${list(plans.map((plan) => plan.cooldown))};
    private static final int[] ABILITY_WEIGHT = ${list(choices.map((start) => start.weight))};
    private static final boolean[] ABILITY_TRACKS = ${list(abilities.map((ability) => ability.facing === "track"))};
    private static final boolean[] ABILITY_HURT_STOPS = ${list(abilities.map((ability) => ability.stopped_by_hurt))};${walks ? `
    // 第 2 步: per slot of ABILITY_CLIPS, whether it keeps walking to its target while it plays (its motion is layered: the walk keeps the bones the motion does not key): each ability's,
    // then each stage's own motion as its ability's (the synced number names a stage's slot while that stage plays, so every slot has its entry).
    private static final boolean[] ABILITY_WALKS = ${list([...walks, ...tactics.slotOwners.map((owner) => walks[owner]!)])};
    private boolean abilityWalks() { return abilityIndex >= 0 && ABILITY_WALKS[abilityIndex]; }` : ""}
    private final int[] abilityReadyAt = new int[${choices.length}];
${
  trails.length
    ? `    // Boss 能力 11: its weapon trails, drawn by every player's game alone (${TRAIL_RUNTIME.client}): per trail the ability it belongs to, the ticks of that ability it is drawn from and until, the part
    // whose far end it follows and that end from the part's pivot (blocks, GeckoLib's axes), its colour, width (blocks) and how many ticks each stretch takes to fade.
    public static final ${TRAIL_RUNTIME.spec}[] TRAILS = {
${trails.map((trail) => `        ${trailSpec(trail.ability, trail.event, input.trailTips?.[trail.ability]?.[input.abilities[trail.ability]!.events.indexOf(trail.event)] ?? trailTipMissing(abilities[trail.ability]!, trail.event.bone))},`).join("\n")}
    };
`
    : ""
}${
  chained
    ? `    // Combos: each is chosen like an ability, as choice ${abilities.length} and on (its weight and its wait are the last ones above). Per combo, the abilities it plays one after another (by their number),
    // the ticks it holds still between two of them, what every hit of its steps does times its own damage, and its wait in ticks, from its end.
    private static final int[][] COMBO_STEPS = {${stepsOf.map((steps) => list(steps)).join(", ")}};
    private static final int[] COMBO_GAP = ${list(combos.map((combo) => combo.gap_ticks))};
    private static final float[] COMBO_DAMAGE = ${list(combos.map((combo) => single(combo.damage_scale)))};
    private static final int[] COMBO_COOLDOWN = ${list(combos.map((combo) => abilityTick(combo.start.cooldown)))};
    // The combo that plays (-1: none), which of its steps, and the ticks of the gap before the next one still to wait.
    private int comboIndex = -1;
    private int comboStep;
    private int comboGap;
`
    : ""
}${faces ? `    // Per ability, how many degrees off its target the body may point when it starts (180: any): a hit laid out ahead of it lands where the body faces.\n    private static final double[] ABILITY_FACES = ${list(tolerances.map((value) => real(value)))};\n` : ""}${backs || faces || input.stationary ? "    private int abilityFacedAt = -1;\n" : ""}${backs ? `    // Per ability, the window it starts from: the nearest and the farthest its target may stand.\n    private static final double[] ABILITY_NEAR = ${list(abilities.map((ability) => real(ability.on_hurt ? 0 : ability.start.min_distance)))};\n    private static final double[] ABILITY_FAR = ${list(abilities.map((ability) => real(ability.start.max_distance)))};\n` : ""}${alignBeforeStart ? "    private int abilityAlignUntil = -1;\n" : ""}    private int abilityIndex = -1;
    private int abilityTick;
    private int abilitySerial;
    private int abilityShown;
    private float abilityYaw;
    private double abilityAimY;
    private double abilityAimFlat;
${input.flight ? `    // A flier: where the one it fights stood when it last turned, which its aim goes to whichever way it faces (it turns slower than the target moves round it).
    private double abilityAimX;
    private double abilityAimZ;
${input.reaches ? `    // Where it was aimed at when it was done getting ready: the aim follows the one it fights no further from it than the hits push them (abilityFollow).
    private double abilityHoldX;
    private double abilityHoldZ;
` : ""}` : ""}    private LivingEntity abilityTarget;
${
  anchored
    ? `    // Where the hit now being counted counts from, in its own terms (blocks ahead of its feet, above them, to its own left): nothing but while a hit that names a bone is counted.
    private double abilityShiftF;
    private double abilityShiftU;
    private double abilityShiftL;
`
    : ""
}${shows ? `    // The effects its abilities have shown that are still in the world: at most ${EFFECT_LIMITS.alive} at once.\n    private final List<${EFFECT_RUNTIME.entity}> abilityEffects = new ArrayList<>();\n` : ""}${
  placed
    ? `    // Per hit of the running ability that lands at fixed places: the places (x, y, z each), decided when its warning began or, without one, when it lands, and the way it faced then.
    private final double[][] abilityPlaces = new double[${Math.max(...abilities.map((ability) => ability.hits.length))}][];
${markers ? `    private final StudioWarn.Marker[] abilityMarkers = new StudioWarn.Marker[${Math.max(...abilities.map(a => a.hits.length))}];\n` : ""}    private final float[] abilityPlaceYaw = new float[${Math.max(...abilities.map((ability) => ability.hits.length))}];
${warned ? "    // How many warnings it has shown whose hit has not landed yet: taken back from the players' games when the ability is cut short.\n    private int abilityWarnsOut;\n" : ""}${placedBy("around_target") ? "    // The number this cast scatters its places by (drawn anew at every start), and where the drawing has got to.\n    private int abilitySeed;\n    private int abilityRoll;\n" : ""}`
    : ""
}${impacts.fields}${savedHits ? `    private final Vec3[] emitHitPoint = new Vec3[${Math.max(...abilities.map(a => a.hits.length))}];\n    private final float[] emitHitYaw = new float[${Math.max(...abilities.map(a => a.hits.length))}];\n` : ""}${grouped ? "    private final StudioOnce onceHits = new StudioOnce();\n" : ""}${ringSlots ? `    private final StudioWarn.Marker[] ringWarns = new StudioWarn.Marker[${ringSlots*ringCount}];\n` : ""}${weights}${motion.fields}${parry.fields}${tactics.fields}${ground.fields}${stance?.fields ?? ""}`,
    tracker: `    @Override protected void defineSynchedData(SynchedEntityData.Builder builder) {
        super.defineSynchedData(builder);
        builder.define(ABILITY, 0);${stance?.tracker ?? ""}${input.stagger ? "\n        builder.define(COMBAT_STAGGER, 0);" : ""}
${input.boss?.tracker ?? ""}${input.extraTracker ?? ""}    }

`,
    methods: `${geometry ? `    private final int[] fixtureHitMasks = new int[${Math.max(...abilities.map(move => move.hits.length))}];\n` : ""}    private boolean abilityRunning() { return abilityIndex >= 0${chained ? " || comboIndex >= 0" : ""}; }

${stance?.methods(`stopAbility();${shows ? " abilityCutEffects();" : ""}`, input.runtime && !input.targeted) ?? ""}${stance ? `    private boolean stanceHasChoices() {
        for (int index = 0; index < ABILITY_WEIGHT.length; index++)
            if (stanceAllows(index)${input.boss ? " && bossAllows(index)" : ""}${input.tactics?.kited || input.tactics?.hugged?.use ? " && tacticsPicks(index)" : ""}) return true;
        return false;
    }

    private boolean stanceKeepsAbility() {
        ${chained ? `if (comboIndex >= 0) {
            if (!stanceAllows(${abilities.length} + comboIndex) || !stanceRequires(${abilities.length} + comboIndex)) return false;
            for (int i = comboStep; i < COMBO_STEPS[comboIndex].length; i++) {
                int step = COMBO_STEPS[comboIndex][i];
                if (!stanceAllows(step) || !stanceRequires(step)) return false;
            }
            return abilityIndex < 0 || stanceAllows(abilityIndex) && stanceRequires(abilityIndex);
        }
        ` : ""}return stanceAllows(abilityIndex) && stanceRequires(abilityIndex);
    }

` : ""}${bearing.source}${freeHeading ? `    private static final boolean[] ABILITY_KEEP_HEADING = {${choices.map(start => !!start.keep_heading).join(", ")}};

` : ""}${combat ? `    // ${stance ? "The phase, posture, and current distance response must all allow this choice." : "Future posture choices intersect the phase and the current distance response here."}\n    private boolean combatAllows(int index) {\n${fixtureGates.join("")}        return ${[input.stagger && "combatStagger() < 0", input.boss && "bossAllows(index)", stance && "!stanceChanging() && stanceAllows(index) && stanceRequires(index)", (input.tactics?.kited || input.tactics?.hugged?.use) && "tacticsPicks(index)"].filter(Boolean).join(" && ") || "true"};\n    }\n\n` : ""}    private boolean abilityMayStart(int index, LivingEntity target${weights ? ", boolean visible" : ""}) {
        if (tickCount < abilityReadyAt[index]${combat ? " || !combatAllows(index)" : input.boss ? " || !bossAllows(index)" : ""}${input.flight ? " || !flightAllows(index)" + (freeHeading ? "" : " || !flightFaces(index, target)") : ""}${input.reaches ? " || !flightReaches(index, target)" : ""}${facingGate}${tactics.mayStart}) return false;
        double distance = distanceTo(target);
        ${alignBeforeStart ? "boolean ready =" : "return"} switch (index) {
${choices.map((start, index) => {
  const first = index < abilities.length ? undefined : abilities.find(ability => ability.id === combos[index - abilities.length]?.steps[0])?.start.when
  return index < abilities.length && abilities[index]!.on_hurt ? `            // Started by a blow (abilityParry), never by distance.\n            case ${index} -> false;` : `            case ${index} -> distance >= ${real(start.min_distance)} && distance <= ${real(start.max_distance)}${start.line_of_sight ? (weights ? " && visible" : " && hasLineOfSight(target)") : ""}${bearing.gates(start.when, "target")}${bearing.gates(first, "target")}${stance && index >= abilities.length ? ` && stanceRequires(${stepsOf[index - abilities.length]![0]!})` : ""};`
}).join("\n")}
            default -> false;
        };${alignBeforeStart ? `
        if (!ready) return false;
        if (${freeHeading ? "ABILITY_KEEP_HEADING[index] || " : ""}abilityFaces(index, target)) return true;
        ${weights ? `if (combatWeight(index, visible${bearing.weighted ? ", target" : ""}) > 0) ` : ""}abilityAlignUntil = tickCount + 1;
        return false;` : ""}
    }

${
  backs
    ? `    /**
     * One that is ready (its wait is over${input.boss ? ", its phase allows it" : ""}${input.flight ? ", it may start where it stands" : ""}) and whose window starts further out than it now stands from its target steps back
     * until it is inside that window, facing them as the vanilla ranged mobs do (\`strafeTo\` walks backwards along the way the body faces, which \`abilityFace\` keeps on them; \`moveTo\` would turn the body to where
     * it walks, away from them, and a \`lock\` ability started then goes the wrong way). No path is looked for (\`ABILITY_BACK_OFF\`). A window its own body fills (its width and the target's, halved) is not one it
     * can step back into. True when it is on its way.
     */
    private boolean abilityBackOff(LivingEntity target) {
${input.flight ? "        if (flightState() != FLIGHT_GROUND) return false;\n" : ""}        double distance = distanceTo(target);
        double clearance = (getBbWidth() + target.getBbWidth()) / 2.0;
        for (int index = 0; index < ABILITY_NEAR.length; index++) {
            if (ABILITY_NEAR[index] < ${real(ABILITY_BACK_OFF)} || ABILITY_NEAR[index] <= clearance || distance >= ABILITY_NEAR[index] || tickCount < abilityReadyAt[index]${stance ? " || !combatAllows(index)" : input.boss ? " || !bossAllows(index)" : ""}${input.flight ? " || !flightAllows(index)" : ""}) continue;
            abilityFace(target);
            // Backwards, not along a path: the vanilla pathfinder finds none for a body this wide (a body several blocks wide gets none and would stand still).
            getNavigation().stop();
            getMoveControl().strafe(-1.0f, 0.0f);
            return true;
        }
        return false;
    }

`
    : ""
}${walls ? `    private boolean abilityClear(Vec3 from, ${input.terrainInteractions?"net.minecraft.world.entity.Entity":"LivingEntity"} victim) {
        return ${input.terrainInteractions ? "StudioTerrain.clip(level(),from,victim.getBoundingBox().getCenter(),2).isEmpty() && " : ""}level().clip(new net.minecraft.world.level.ClipContext(from, victim.getBoundingBox().getCenter(), net.minecraft.world.level.ClipContext.Block.COLLIDER, net.minecraft.world.level.ClipContext.Fluid.NONE, this)).getType() == net.minecraft.world.phys.HitResult.Type.MISS;
    }

` : ""}${guided ? guidedShotsJava(false) : ""}${
  backs || faces || input.stationary
    ? `    /**
     * Turns it to face \`target\` by at most ${GROUND_TURN} degrees a tick, once a tick: the head by its look control, and the yaw and the body with it (a standing body lags behind the head, and \`abilityYaw\` is the body's).
     */
    private void abilityFace(LivingEntity target) {
${input.flight ? "        if (flightState() != FLIGHT_GROUND) return;\n" : ""}        if (abilityFacedAt == tickCount) return;
        abilityFacedAt = tickCount;
        getLookControl().setLookAt(target, ${GROUND_TURN}.0f, ${GROUND_TURN}.0f);
        lookAt(target, ${GROUND_TURN}.0f, ${GROUND_TURN}.0f);
        setYBodyRot(getYRot());
    }

`
    : ""
}${
  faces
    ? `    /**
     * epic game5: an ability whose hits lie ahead of it lands where the body faces. It starts only when the bearing to its target is within \`ABILITY_FACES\` of the way the body points (\`faceTolerance\`: one that holds
     * the way it faced, \`lock\`, by how far off the hit still meets them; one that turns while getting ready, \`track\`, by what it turns in ${GROUND_TURN} degrees a tick over that time and one more tick, as \`flightFaces\` does).
     * Until then \`startAbility\` turns it to them (\`abilityFace\`).${input.flight ? " In the air the flight holds it (\`flightFaces\`)." : ""}
     */
    private boolean abilityFaces(int index, LivingEntity target) {
        if (ABILITY_FACES[${chained ? "abilityFirst(index)" : "index"}] >= 180.0${input.flight ? " || flightState() != FLIGHT_GROUND" : ""}) return true;
        double dx = target.getX() - getX();
        double dz = target.getZ() - getZ();
        if (dx * dx + dz * dz < 1.0e-4) return true;
        float off = Math.abs(Mth.wrapDegrees((float) (Mth.atan2(dz, dx) * 180.0 / Math.PI) - 90.0f - yBodyRot));
        return off <= ABILITY_FACES[${chained ? "abilityFirst(index)" : "index"}];
    }

`
    : ""
}    /** Picks one of the abilities that may start right now, by weight, and starts it. False when none may. */
    private boolean startAbility(LivingEntity target) {
        if (level().isClientSide() || abilityRunning() || isDeadOrDying() || target == null || !target.isAlive()${stance ? " || stanceChanging()" : ""}) return false;
${weights ? `        boolean visible = ${choices.some(start => start.line_of_sight || start.weight_when?.some(rule => rule.if === "no_sight")) ? "hasLineOfSight(target)" : "true"};
${stance?.leave ? `        if (stanceDepartureDue()) return stanceTryDeparture(target, visible);
` : ""}        double total = 0;
        double[] weights = new double[ABILITY_WEIGHT.length];
        for (int index = 0; index < weights.length; index++) {
            if (abilityMayStart(index, target, visible)) weights[index] = combatWeight(index, visible${bearing.weighted ? ", target" : ""});
            total += weights[index];
        }` : `${stance?.leave ? `        if (stanceDepartureDue()) return stanceTryDeparture(target);
` : ""}        int total = 0;
        for (int index = 0; index < ABILITY_WEIGHT.length; index++) if (abilityMayStart(index, target)) total += ABILITY_WEIGHT[index];`}
${faces ? "        if (total == 0) {\n            // Nothing may start, perhaps only because its body does not yet face them: it turns to them while it waits.\n            abilityFace(target);\n            return false;\n        }" : "        if (total == 0) return false;"}
        ${weights ? "double roll = getRandom().nextDouble() * total;" : "int roll = getRandom().nextInt(total);"}
        for (int index = 0; index < ABILITY_WEIGHT.length; index++) {
${weights ? "            roll -= weights[index];" : `            if (!abilityMayStart(index, target)) continue;
            roll -= ABILITY_WEIGHT[index];`}
            if (roll >= 0) continue;
${stance ? `            return abilityBegin(index, target);
        }
        return false;
    }

${stance.leave ? `    private boolean stanceTryDeparture(LivingEntity target${weights ? ", boolean visible" : ""}) {
        if (tickCount < stanceRetryAt) return false;
        int index = STANCE_LEAVE_MOVE[stanceIndex()];
        if (!abilityMayStart(index, target${weights ? ", visible" : ""})) {
            stanceDelay();
            return false;
        }
        stanceDeparture = index;
        return abilityBegin(index, target);
    }

` : ""}    private boolean abilityBegin(int index, LivingEntity target) {
` : ""}${
  chained
    ? `            // A combo starts with its first step; it is the combo whose wait counts when it ends.
            comboIndex = index < ${abilities.length} ? -1 : index - ${abilities.length};
            comboStep = 0;
            abilityIndex = comboIndex < 0 ? index : COMBO_STEPS[comboIndex][0];
`
    : "            abilityIndex = index;\n"
}${input.boss?.opening ? "            bossStarted(index);\n" : ""}            // tickAbility runs later on this same tick and makes it tick 0.
            abilityTick = -1;${grouped ? "\n            onceHits.nextCast();" : ""}${geometry ? "\n            java.util.Arrays.fill(fixtureHitMasks, 0);" : ""}
            abilityTarget = target;
            abilityYaw = yBodyRot;
            abilityAim(target, false);
${placedBy("around_target") ? "            abilitySeed = getRandom().nextInt();\n" : ""}            ${walks ? "if (!ABILITY_WALKS[abilityIndex]) " : ""}getNavigation().stop();
            getEntityData().set(ABILITY, (++abilitySerial << 8) | (${chained ? "abilityIndex" : "index"} + 1));
            return true;
${stance ? "" : "        }\n        return false;\n"}    }

    /** Ends the ability now. Nothing later in it happens; the wait before it may start again counts from here. */
    private void stopAbility() {${stance?.leave ? "\n        if (stanceDeparture >= 0) stanceDelay();" : ""}${actions ? "\n        StudioArena.cancel(StudioArena.room(this), \"ability\");" : ""}${weights ? `\n        combatRemember(${chained ? `comboIndex >= 0 ? ${abilities.length} + comboIndex : abilityIndex` : "abilityIndex"});` : ""}${tactics.stop}
${
  chained
    ? `        // A combo's wait is its own, from here; the abilities it played start none of theirs.
        if (comboIndex >= 0) abilityReadyAt[${abilities.length} + comboIndex] = tickCount + ${tactics.wait("COMBO_COOLDOWN[comboIndex]")};
        else abilityReadyAt[abilityIndex] = tickCount + ${tactics.wait("ABILITY_COOLDOWN[abilityIndex]")};
        comboIndex = -1;
`
    : `        abilityReadyAt[abilityIndex] = tickCount + ${tactics.wait("ABILITY_COOLDOWN[abilityIndex]")};\n`
}        abilityIndex = -1;
        abilityTarget = null;
        getEntityData().set(ABILITY, 0);${ringSlots ? "\n        for (int i=0; i<ringWarns.length; i++) if (ringWarns[i] != null) { ringWarns[i].stop(); ringWarns[i] = null; }" : ""}${warned ? "\n        abilityWarnTakeBack();" : ""}
    }

    private void abilityAim(LivingEntity target, boolean turn) {
        double dx = target.getX() - getX();
        double dz = target.getZ() - getZ();
        if (turn) ${input.steady ? "abilityTurnToward((float) Math.toDegrees(Mth.atan2(dz, dx)) - 90.0f);" : `abilityYaw += Mth.clamp(Mth.wrapDegrees((float) (Mth.atan2(dz, dx) * 180.0 / Math.PI) - 90.0f - abilityYaw), -${tactics.turnCap ?? (input.flight ? "flightTurnCap()" : "30.0f")}, ${tactics.turnCap ?? (input.flight ? "flightTurnCap()" : "30.0f")});`}
        abilityAimFlat = Math.max(0.5, Math.sqrt(dx * dx + dz * dz));
        abilityAimY = target.getY(0.5);${input.flight ? "\n        abilityAimX = target.getX();\n        abilityAimZ = target.getZ();" : ""}
    }

${
  input.reaches
    ? `    /**
     * epic game1: a breath that flew in at its target missed its third hit by 21° with the one it hit pushed a block and a half, who had not moved on their own: the aim was taken once, when it was done
     * getting ready. From then on, until the last hit, the aim goes to where the target stands now by no more than the flier turns in a tick (\`flightTurnCap\`), as the body would: the bearing from the middle
     * of its body to where they were aimed at turns toward the bearing to them, and the angle it looks up or down by the same, and by no more than the hits' own knockback pushes them and a step of cruise (\`FLIGHT_REACH\`,
     * the follow and the step the start was held to) from where they were aimed at when it was done getting ready: a push is followed, a player who steps aside is not. The distance is theirs now.
     * Only an ability that turns to its target while it gets ready (\`facing: track\`) follows; one that holds the way it faced (\`lock\`) is the one to step out of.
     */
    private void abilityFollow(LivingEntity target) {
        if (abilityTick == ABILITY_WINDUP[abilityIndex]) {
            abilityHoldX = abilityAimX;
            abilityHoldZ = abilityAimZ;
        }
        float cap = flightTurnCap();
        double dx = abilityAimX - getX();
        double dz = abilityAimZ - getZ();
        double centre = getY() + getBbHeight() / 2.0;
        double before = Math.atan2(dz, dx);
        double rise = Math.atan2(abilityAimY - centre, Math.max(0.5, Math.sqrt(dx * dx + dz * dz)));
        double toX = target.getX() - getX();
        double toZ = target.getZ() - getZ();
        double flat = Math.max(0.5, Math.sqrt(toX * toX + toZ * toZ));
        double bearing = before + Math.toRadians(Mth.clamp(Mth.wrapDegrees((float) Math.toDegrees(Math.atan2(toZ, toX) - before)), -cap, cap));
        double pitch = rise + Math.toRadians(Mth.clamp((float) Math.toDegrees(Math.atan2(target.getY(0.5) - centre, flat) - rise), -cap, cap));
        double x = getX() + Math.cos(bearing) * flat;
        double z = getZ() + Math.sin(bearing) * flat;
        double most = FLIGHT_REACH[abilityIndex][7] + flightStep();
        double away = Math.sqrt((x - abilityHoldX) * (x - abilityHoldX) + (z - abilityHoldZ) * (z - abilityHoldZ));
        if (away > most) {
            x = abilityHoldX + (x - abilityHoldX) * most / away;
            z = abilityHoldZ + (z - abilityHoldZ) * most / away;
        }
        abilityAimX = x;
        abilityAimZ = z;
        abilityAimY = centre + Math.tan(pitch) * flat;
    }

`
    : ""
}    private void tickAbility() {
        if (level().isClientSide() || ${chained ? "!abilityRunning()" : "abilityIndex < 0"}) return;
        if (isDeadOrDying() || abilityTarget == null || !abilityTarget.isAlive() || abilityTarget.isRemoved()
                || (abilityTarget instanceof Player player && (player.isCreative() || player.isSpectator()))${input.targeted ? "\n                // The one it was fighting is no longer its target (let go, or another was given): what was begun against them ends here.\n                || abilityTarget != getTarget()" : ""}) {
            stopAbility();${shows ? "\n            abilityCutEffects();" : ""}
            return;
        }
${
  chained
    ? `        if (abilityIndex < 0) {
            // Between two steps of a combo it holds still the way it faces (the motion of the step before stays shown, so it does not go back to standing); when the gap is over the next step starts on this tick.
            setYRot(abilityYaw);
            setYBodyRot(abilityYaw);
            setYHeadRot(abilityYaw);
            getNavigation().stop();
            if (comboGap-- > 0) return;
${combat ? `            if (!combatAllows(${abilities.length} + comboIndex)) { stopAbility(); return; }\n` : ""}${abilities.some(a => bearing.gates(a.start.when, "target")) ? "            if (!abilityBearingStep(COMBO_STEPS[comboIndex][comboStep], abilityTarget)) { stopAbility(); return; }\n" : ""}${stance ? "            if (!stanceRequires(COMBO_STEPS[comboIndex][comboStep])) { stopAbility(); " + (shows ? "abilityCutEffects(); " : "") + "return; }" + "\\n" : ""}            comboNext();
        }
`
    : ""
}        abilityTick++;
        // While getting ready it may still turn; from then on it is committed to where it faces, so stepping aside works.
        if (${input.steady && parrying ? "(abilityTick == 0 && PARRY_CHANCE[abilityIndex] > 0.0f) || " : ""}abilityTick < ${tactics.trackUntil ?? "ABILITY_WINDUP[abilityIndex]"} && ABILITY_TRACKS[abilityIndex]) abilityAim(abilityTarget, true);
${input.reaches ? "        // One aimed at the one it fights that turns to them while it gets ready goes on following them, no faster than it turns (abilityFollow), while its hits are counted.\n        else if (ABILITY_TRACKS[abilityIndex] && FLIGHT_REACH[abilityIndex] != null) abilityFollow(abilityTarget);\n" : ""}        setYRot(abilityYaw);
        setYBodyRot(abilityYaw);
        ${input.steady ? `if (abilityTick < ${tactics.trackUntil} && ABILITY_TRACKS[abilityIndex]${input.flight ? " && flightState() == FLIGHT_GROUND" : ""}) {
            float bearing = (float)Math.toDegrees(Mth.atan2(abilityTarget.getZ() - getZ(), abilityTarget.getX() - getX())) - 90.0f;
            setYHeadRot(yHeadRotO + Mth.clamp(Mth.wrapDegrees(bearing - yHeadRotO), -STEADY_HEAD, STEADY_HEAD));
            steadyClampHead();
        } else ` : ""}setYHeadRot(abilityYaw);
        ${walks ? "if (!abilityWalks()) " : ""}getNavigation().stop();
        switch (abilityIndex) {
${abilities.map((_, index) => `            case ${index} -> abilityStep${index}(abilityTick);`).join("\n")}
            default -> { }
        }${tactics.after}
        if (abilityIndex >= 0 && abilityTick >= ABILITY_LENGTH[abilityIndex]) ${chained ? "comboFinished();" : "stopAbility();"}
    }
${
  chained
    ? `
    /** The step that runs is over: the next step of its combo follows once the gap is over (\`tickAbility\`), or, the last step or no combo, it ends as any ability does. */
${
  tactics.comboFinished ??
  `    private void comboFinished() {
        if (comboIndex < 0 || comboStep + 1 >= COMBO_STEPS[comboIndex].length) {
            stopAbility();
            return;
        }
        comboStep++;${grouped ? "\n        onceHits.nextStep();" : ""}
        comboGap = COMBO_GAP[comboIndex];
        // Nothing runs between two steps, but the combo does (\`abilityRunning\`): it neither walks nor starts anything else.
        abilityIndex = -1;
    }`
}

${abilities.some(a => bearing.gates(a.start.when, "target")) ? `    private boolean abilityBearingStep(int index, LivingEntity target) {
        return switch (index) {
${abilities.flatMap((ability, index) => {
  const gate = bearing.gates(ability.start.when, "target")
  return gate ? [`            case ${index} -> ${gate.slice(4)};`] : []
}).join("\n")}
            default -> true;
        };
    }

` : ""}    /** The next step of the combo starts as its own tick 0, facing where the step before left it and aimed at its target afresh; every player's game is told to play its motion. */
    private void comboNext() {${actions ? "\n        StudioArena.cancel(StudioArena.room(this), \"ability\");" : ""}
        abilityIndex = COMBO_STEPS[comboIndex][comboStep];
        abilityTick = -1;${geometry ? "\n            java.util.Arrays.fill(fixtureHitMasks, 0);" : ""}${tactics.stepStart}
        abilityAim(abilityTarget, false);
        getEntityData().set(ABILITY, (++abilitySerial << 8) | (abilityIndex + 1));
    }

    /** What a hit's damage is multiplied by: the combo's own number while a combo plays it, 1 for an ability started on its own. */
    private float abilityDamageScale() { return comboIndex < 0 ? 1.0f : COMBO_DAMAGE[comboIndex]; }
${
  faces
    ? `
    /** The ability a choice starts with: itself, or a combo's first step (a combo is choice ${abilities.length} and on). */
    private int abilityFirst(int index) { return index < ${abilities.length} ? index : COMBO_STEPS[index - ${abilities.length}][0]; }
`
    : ""
}`
    : ""
}
${steps.join("\n")}
${
  anchored
    ? `    /**
     * Counts what follows from a place on its body instead of its feet: \`forward\`, \`up\` and \`left\` are where the bone's middle is in the pose the ability's motion holds at the moment
     * of the hit, at the size the model is built; it is as large or small as the creature is${input.flight ? ", and carried by the lean of its flight, as the renderer leans the model" : ""}.
     */
    private void abilityAnchor(double forward, double up, double left) {
        double scale = getScale();
${
  input.flight
    ? `        double[] at = flightLeaned(forward * scale, up * scale, left * scale);
        abilityShiftF = at[0];
        abilityShiftU = at[1];
        abilityShiftL = at[2];`
    : `        abilityShiftF = forward * scale;
        abilityShiftU = up * scale;
        abilityShiftL = left * scale;`
}
    }

    private void abilityAnchorClear() {
        abilityShiftF = 0.0;
        abilityShiftU = 0.0;
        abilityShiftL = 0.0;
    }

`
    : ""
}    // A place in its own terms while an ability runs: how far ahead of it and how far to its own left a spot of the world is.
    private double abilityAhead(double x, double z) {
        float turn = abilityYaw * 0.017453292f;
        return -(x - getX()) * Mth.sin(turn) + (z - getZ()) * Mth.cos(turn)${shifted("", " - abilityShiftF")};
    }

    private double abilityLeft(double x, double z) {
        float turn = abilityYaw * 0.017453292f;
        return (x - getX()) * Mth.cos(turn) + (z - getZ()) * Mth.sin(turn)${shifted("", " - abilityShiftL")};
    }

${
  places
    ? `    private Vec3 abilityPoint(double forward, double up, double left) {
${shifted("", "        forward += abilityShiftF;\n        up += abilityShiftU;\n        left += abilityShiftL;\n")}        float turn = abilityYaw * 0.017453292f;
        return new Vec3(getX() - forward * Mth.sin(turn) + left * Mth.cos(turn), getY() + up, getZ() + forward * Mth.cos(turn) + left * Mth.sin(turn));
    }

`
    : ""
}${
      aims
        ? `    /** Where it aims from a spot \`up\` above its feet and \`forward\` ahead: the way it faces, tilted to the height its target had when it last turned${shifted("", ", and from a bone off the middle of its body across to where that target stood")}. */
    private Vec3 ${arcs ? "abilityOffset" : "abilityDirection"}(double up, double forward) {
        float turn = abilityYaw * 0.017453292f;
${
  input.flight
    ? `        // broad11 w1 recheck: a flier turns at its own rate and may not face the one it fights when the hit comes (150° off was seen), so its aim goes from where it starts to where they stood.
        Vec3 from = abilityPoint(forward, up, 0.0);
        double toX = abilityAimX - from.x;
        double toZ = abilityAimZ - from.z;
        double across = Math.sqrt(toX * toX + toZ * toZ);
        if (across < 0.5) {
            toX = -Mth.sin(turn) * 0.5;
            toZ = Mth.cos(turn) * 0.5;
        }
        return new Vec3(toX, abilityAimY - from.y, toZ)${arcs ? "" : ".normalize()"};`
    : `        double flat = Math.max(0.5, abilityAimFlat - forward${shifted("", " - abilityShiftF")});
${shifted(
  `        return new Vec3(-Mth.sin(turn) * flat, abilityAimY - (getY() + up), Mth.cos(turn) * flat)${arcs ? "" : ".normalize()"};`,
  `        // broad11 w1: a wing tip 4 blocks to its left aimed straight ahead went past the one in front of it; the target stood in the middle, so the aim crosses over by the bone's own offset.
        return new Vec3(-Mth.sin(turn) * flat - Mth.cos(turn) * abilityShiftL, abilityAimY - (getY() + abilityShiftU + up), Mth.cos(turn) * flat - Mth.sin(turn) * abilityShiftL)${arcs ? "" : ".normalize()"};`,
)}`
}
    }

${
  arcs
    ? `    private Vec3 abilityDirection(double up, double forward) { return abilityOffset(up, forward).normalize(); }

    /**
     * Where a shot that falls on its way (an arrow, a snowball) is aimed: at the one it fights, raised by as much as it will have fallen when it gets there. The raise is not a rule of thumb: the flight is
     * ticked the way the game ticks a projectile (it moves by its speed, keeps ${PROJECTILE_DRAG} of it, then falls by \`gravity\`), and the aim is lifted by what it is short of their height where it has
     * come as far as they are (\`flat\`), over and over until it is within a tenth of a block. A shot that is too slow to get there is aimed at them straight, and none is aimed higher than a rise of one block per block of the way.
     */
    private Vec3 abilityArc(double up, double forward, double speed, double gravity) {
        Vec3 to = abilityOffset(up, forward);
        double flat = Math.sqrt(to.x * to.x + to.z * to.z);
        double lift = 0.0;
        for (int round = 0; round < 12; round++) {
            double length = Math.sqrt(flat * flat + (to.y + lift) * (to.y + lift));
            double along = speed * flat / length;
            double rise = speed * (to.y + lift) / length;
            double x = 0.0;
            double y = 0.0;
            double miss = Double.NaN;
            for (int tick = 0; tick < 400; tick++) {
                if (x + along >= flat) {
                    miss = to.y - (y + rise * (flat - x) / along);
                    break;
                }
                x += along;
                y += rise;
                along *= ${PROJECTILE_DRAG};
                rise = rise * ${PROJECTILE_DRAG} - gravity;
            }
            if (Double.isNaN(miss)) return to.normalize();
            lift = Mth.clamp(lift + miss, -flat, flat);
            if (Math.abs(miss) < 0.1) break;
        }
        return new Vec3(to.x, to.y + lift, to.z).normalize();
    }

`
    : ""
}`
        : ""
    }${
      levels
        ? `    /** Level, the way it faces: where a beam or a cone that is kept level goes, whatever height its target is at. */
    private Vec3 abilityLevel() {
        float turn = abilityYaw * 0.017453292f;
        return new Vec3(-Mth.sin(turn), 0.0, Mth.cos(turn));
    }

`
        : ""
    }    private List<LivingEntity> abilityVictims(boolean everyone, double range) {
        if (!everyone) return abilityTarget != null && abilityTarget.isAlive() ? List.of(abilityTarget) : List.of();
        return level().getEntitiesOfClass(LivingEntity.class, getBoundingBox().inflate(range${shifted("", " + Math.max(Math.hypot(abilityShiftF, abilityShiftL), Math.abs(abilityShiftU))")}),
            other -> other != this && other.isAlive() && other.getType() != getType() && !other.isSpectator()
                && !(other instanceof Player player && player.isCreative()));
    }

    private boolean abilityStrike(LivingEntity victim, float damage, double knockback) {
        if (damage > 0.0f && !victim.hurt(damageSources().mobAttack(this), damage${scaled ? " * bossDamageScale()" : ""}${chained ? " * abilityDamageScale()" : ""}${tactics.damage})) return false;${tactics.strike}
        if (knockback > 0.0) victim.knockback(knockback, getX() - victim.getX(), getZ() - victim.getZ());${
          pulls
            ? `
        else if (knockback < 0.0) abilityPull(victim, -knockback);`
            : ""
        }${motion.strike}
        return true;
    }
${
  pulls
    ? `
    /**
     * A pull is the knockback turned around: the game's own \`takeKnockback\` ignores a strength of zero or less, so this does what it does toward the creature instead of away from it.
     * Same strength, softened by the victim's knockback resistance, half of what it was already moving kept, and its velocity sent to its game (a player's own game moves it).
     * It never carries a victim through the one that pulls: the strength is cut to what the ground (or the air) lets the push travel, which is the push over one minus the drag
     * each tick keeps, so the victim comes to rest at the earliest where its body meets the creature's body, and not at all when it is already there. The ground is not left (the game's lift would also change how far it goes).
     */
    private void abilityPull(LivingEntity victim, double strength) {
        strength *= 1.0 - victim.getAttributeValue(net.minecraft.world.entity.ai.attributes.Attributes.KNOCKBACK_RESISTANCE);
        if (strength <= 0.0) return;
        double dx = getX() - victim.getX();
        double dz = getZ() - victim.getZ();
        double flat = Math.sqrt(dx * dx + dz * dz);
        double room = flat - getBbWidth() / 2.0 - victim.getBbWidth() / 2.0;
        if (room <= 0.0) return;
        Vec3 moving = victim.getDeltaMovement();
        double toward = (moving.x * dx + moving.z * dz) / flat / 2.0;
        double drag = victim.onGround() ? victim.level().getBlockState(victim.getBlockPosBelowThatAffectsMyMovement()).getBlock().getFriction() * 0.91 : 0.91;
        strength = Math.min(strength, room * (1.0 - drag) - Math.max(0.0, toward));
        if (strength <= 0.0) return;
        victim.hasImpulse = true;
        victim.hurtMarked = true;
        victim.setDeltaMovement(moving.x / 2.0 + dx / flat * strength, moving.y, moving.z / 2.0 + dz / flat * strength);
    }
`
    : ""
}${eventPlaces ? `    private Vec3 abilityEventPlace(int slot, int i, double forward, double up, double left) {${markers ? "\n        if (abilityMarkers[slot] != null) abilityMarkers[slot].move();" : ""}
        double[] points = abilityPlaces[slot];
        float yaw = abilityPlaceYaw[slot] * 0.017453292f;
        return new Vec3(points[i] - forward*Mth.sin(yaw) + left*Mth.cos(yaw), points[i+1] + up, points[i+2] + forward*Mth.cos(yaw) + left*Mth.sin(yaw));
    }

` : ""}${placed ? placedMethods({ terrainInteractions:!!input.terrainInteractions, markers, walls, scaled, chained, tactics, pulls, force: motion.strikeAt, warned, self: placedBy("self"), target: placedBy("target"), around: placedBy("around_target"), pattern: placedBy("pattern"), arc: placedIn("arc"), ring: placedIn("ring"), box: placedIn("box"), sphere: placedIn("sphere") }) : ""}
${
  uses("arc")
    ? `    private boolean abilityInArc(${input.terrainInteractions?"net.minecraft.world.entity.Entity":"LivingEntity"} victim, double reach, double half, double low, double high) {
        AABB box = victim.getBoundingBox();
        if (box.maxY < getY() ${shifted("+", "+ abilityShiftU +")} low || box.minY > getY() ${shifted("+", "+ abilityShiftU +")} high) return false;
        double ahead = abilityAhead(victim.getX(), victim.getZ());
        double left = abilityLeft(victim.getX(), victim.getZ());
        double flat = Math.sqrt(ahead * ahead + left * left);
        double wide = victim.getBbWidth() / 2.0;
        if (flat - wide > reach) return false;
        if (flat <= wide) return true;
        return Math.abs(Math.toDegrees(Math.atan2(left, ahead))) <= half + Math.toDegrees(Math.asin(Math.min(1.0, wide / flat)));
    }

`
    : ""
}${
  uses("ring")
    ? `    /** \`abilityInArc\` with a hollow middle: whoever stands wholly within \`inner\` of its feet is not hit (a ring to jump over or stand inside of). */
    private boolean abilityInRing(${input.terrainInteractions?"net.minecraft.world.entity.Entity":"LivingEntity"} victim, double inner, double reach, double half, double low, double high) {
        AABB box = victim.getBoundingBox();
        if (box.maxY < getY() ${shifted("+", "+ abilityShiftU +")} low || box.minY > getY() ${shifted("+", "+ abilityShiftU +")} high) return false;
        double ahead = abilityAhead(victim.getX(), victim.getZ());
        double left = abilityLeft(victim.getX(), victim.getZ());
        double flat = Math.sqrt(ahead * ahead + left * left);
        double wide = victim.getBbWidth() / 2.0;
        if (flat - wide > reach || flat + wide <= inner) return false;
        if (flat <= wide) return true;
        return Math.abs(Math.toDegrees(Math.atan2(left, ahead))) <= half + Math.toDegrees(Math.asin(Math.min(1.0, wide / flat)));
    }

`
    : ""
}${
      uses("box")
        ? `    private boolean abilityInBox(${input.terrainInteractions?"net.minecraft.world.entity.Entity":"LivingEntity"} victim, double forward, double up, double left, double width, double height, double depth) {
        AABB box = victim.getBoundingBox();
        double wide = victim.getBbWidth() / 2.0;
        return box.maxY >= getY() ${shifted("+", "+ abilityShiftU +")} up - height / 2.0 && box.minY <= getY() ${shifted("+", "+ abilityShiftU +")} up + height / 2.0
            && Math.abs(abilityAhead(victim.getX(), victim.getZ()) - forward) <= depth / 2.0 + wide
            && Math.abs(abilityLeft(victim.getX(), victim.getZ()) - left) <= width / 2.0 + wide;
    }

`
        : ""
    }${
      uses("sphere")
        ? `    private boolean abilityInSphere(${input.terrainInteractions?"net.minecraft.world.entity.Entity":"LivingEntity"} victim, double forward, double up, double left, double radius) {
        return victim.getBoundingBox().distanceToSqr(abilityPoint(forward, up, left)) <= radius * radius;
    }

`
        : ""
    }${
      uses("line")
        ? `    private boolean abilityInLine(${input.terrainInteractions?"net.minecraft.world.entity.Entity":"LivingEntity"} victim, ${levels ? "Vec3 aim, " : ""}double up, double length, double radius) {
        Vec3 from = abilityPoint(0.0, up, 0.0);
${levels ? "" : "        Vec3 aim = abilityDirection(up, 0.0);\n"}        double along = Mth.clamp(victim.getBoundingBox().getCenter().subtract(from).dot(aim), 0.0, length);
        return victim.getBoundingBox().distanceToSqr(from.add(aim.scale(along))) <= radius * radius;
    }

`
        : ""
    }${
      uses("cone")
        ? `    private boolean abilityInCone(${input.terrainInteractions?"net.minecraft.world.entity.Entity":"LivingEntity"} victim, ${levels ? "Vec3 aim, " : ""}double up, double length, double half) {
        Vec3 to = victim.getBoundingBox().getCenter().subtract(abilityPoint(0.0, up, 0.0));
        double far = to.length();
        double wide = victim.getBbWidth() / 2.0;
        if (far - wide > length) return false;
        if (far <= wide) return true;
        return Math.toDegrees(Math.acos(Mth.clamp(to.dot(${levels ? "aim" : "abilityDirection(up, 0.0)"}) / far, -1.0, 1.0))) <= half + Math.toDegrees(Math.asin(Math.min(1.0, wide / far)));
    }

`
        : ""
    }${
      abilities.some((ability) => ability.moves.some(isPush))
        ? `    private void abilityPush(double forward, double up) {
${input.flight ? "        // In the air its flight is its whole movement: a push there would only be undone by it.\n        if (flightState() != FLIGHT_GROUND) return;\n" : ""}        float turn = abilityYaw * 0.017453292f;
        setDeltaMovement(-Mth.sin(turn) * forward, up > 0.0 ? up : getDeltaMovement().y, Mth.cos(turn) * forward);${input.stagger ? "\n        combatOwnPush = forward != 0.0;\n        if (up > 0.0) combatLiftAt = tickCount;" : ""}
        hasImpulse = true;
    }

`
        : ""
    }${motion.methods}${tactics.methods}${impacts.methods}${
      particles
        ? `    private void abilityParticles(ParticleOptions effect, double forward, double up, double left, int count, double spread) {
        if (!(level() instanceof ServerLevel world)) return;
        Vec3 at = abilityPoint(forward, up, left);
        world.sendParticles(effect, at.x, at.y, at.z, count, spread, spread, spread, 0.02);
    }

`
        : ""
    }${
      ownParticles
        ? `    /** Boss 能力 11: one of this mod's own particles, by its asset id. Only a type the game has registered can be sent to anybody: until then it shows nothing. */
    private void abilityOwnParticles(String asset, double forward, double up, double left, int count, double spread) {
        SimpleParticleType type = ${PARTICLE_RUNTIME.table}.byAsset(asset);
        if (type == null || !${PARTICLE_RUNTIME.table}.registered(type)) return;
        abilityParticles(type, forward, up, left, count, spread);
    }

`
        : ""
    }${
      trails.length || input.weightedPose
        ? `    /** Boss 能力 11: which ability the server says is showing (0: none; else a count that changes on every start above its number plus one in the low byte), for the trails a player's game draws. */
    public int studioAbilityShown() { return getEntityData().get(ABILITY); }

`
        : ""
    }${
      shakes
        ? `    /** Shakes the screen of every player within \`radius\` blocks of it for \`ticks\` ticks (boss runtime, 10-12); each game weakens it with distance and with the player's own setting. */
    private void abilityShake(float strength, float radius, int ticks) {
        if (level() instanceof ServerLevel world) ${BOSS_RUNTIME.shake}.send(world, position(), strength, radius, ticks);
    }

${shakesMore ? SHAKE_MORE_METHOD : ""}`
        : ""
    }${
      debris
        ? `    /** Cracks the ground at a place counted from \`origin\` (\`forward\`, \`up\` and \`left\` in its own terms) and throws up pieces of it (boss runtime, 10-12); only looks, no block changes. */
    private void abilityDebris(Vec3 origin, double forward, double up, double left, double radius, int count${styledDebris ? ", net.minecraft.world.level.block.state.BlockState block, net.minecraft.core.particles.ParticleOptions dust" : ""}${thrownDebris ? ", double... throwing" : ""}) {
        if (!(level() instanceof ServerLevel world)) return;
        float turn = abilityYaw * 0.017453292f;
        ${BOSS_RUNTIME.debris}.burst(world, origin.add(-forward * Mth.sin(turn) + left * Mth.cos(turn), up, forward * Mth.cos(turn) + left * Mth.sin(turn)), radius, count${styledDebris ? ", block, dust" : ""}${thrownDebris ? ", throwing" : ""});
    }

`
        : ""
    }${ground.methods}${
      breaks
        ? `    /** Breaks the blocks of the world in an upright cylinder at a place counted from \`origin\` (\`forward\`, \`up\` and \`left\` in its own terms), up to \`hardness\` (boss runtime \`${BOSS_RUNTIME.breaks}\`); only where the world lets mobs change blocks. */
    private void abilityBreak(Vec3 origin, double forward, double up, double left, double radius, double height, float hardness, boolean drops${quietBreak ? ", boolean particles" : ""}) {
        if (!(level() instanceof ServerLevel world)) return;
        float turn = abilityYaw * 0.017453292f;
        ${input.terrainInteractions ? "Vec3 center=origin.add(-forward*Mth.sin(turn)+left*Mth.cos(turn),up,forward*Mth.cos(turn)+left*Mth.sin(turn));\n        StudioTerrain.smash(world,hardness,p->StudioTerrain.inCylinder(p.getBoundingBox(),center,radius,height));\n        " : ""}${BOSS_RUNTIME.breaks}.smash(world, this, origin.add(-forward * Mth.sin(turn) + left * Mth.cos(turn), up, forward * Mth.cos(turn) + left * Mth.sin(turn)), radius, height, hardness, drops${quietBreak ? ", particles" : ""});
    }

`
        : ""
    }${
      shows
        ? `    /** Shows one of this mod's effects \`count\` times, counted from a place: \`forward\`, \`up\` and \`left\` of it in the creature's own terms, then on a circle of radius \`spread\` (each turned to face outward) or in a row \`spread\` long ahead. */
    private void abilityEffect(String id, Vec3 origin, double forward, double up, double left, int count, boolean ring, double spread${sizedFx ? ", float size" : ""}) {
        abilityEffects.removeIf(Entity::isRemoved);
        float turn = abilityYaw * 0.017453292f;
        for (int index = 0; index < count && abilityEffects.size() < ${EFFECT_LIMITS.alive}; index++) {
            double angle = ring && count > 1 ? index * 2.0 * Math.PI / count : 0.0;
            double ahead = forward + (ring && count > 1 ? spread * Math.cos(angle) : count > 1 ? spread * index / (count - 1) : 0.0);
            double side = left + (ring && count > 1 ? spread * Math.sin(angle) : 0.0);
            Vec3 at = origin.add(-ahead * Mth.sin(turn) + side * Mth.cos(turn), up, ahead * Mth.cos(turn) + side * Mth.sin(turn));
            ${EFFECT_RUNTIME.entity} shown = ${EFFECT_RUNTIME.table}.spawn(id, level(), at, abilityYaw - (float) Math.toDegrees(angle)${sizedFx ? ", 0.0f, 0.0f" : ""}, this, abilityTarget${sizedFx ? ", size" : ""});
            if (shown != null) abilityEffects.add(shown);
        }
    }

${
  frames.includes("aim")
    ? `    /**
     * The same along where a hit aims, counted from where that aim starts: \`forward\` is along \`aim\`, \`up\` square to it and \`left\` to the creature's own
     * left, the circle or the row lies in that tilted plane, and every effect is tilted with it. What is shown stays on what is hit however high the target stands.
     */
    private void abilityEffectAimed(String id, Vec3 origin, Vec3 aim, double forward, double up, double left, int count, boolean ring, double spread${sizedFx ? ", float size" : ""}) {
        abilityEffects.removeIf(Entity::isRemoved);
${
  input.flight || anchored
    ? `        // broad11 w1 recheck: an aim that does not go straight ahead (from a bone off the middle, or a flier not yet facing its target) turns what is shown along it too.
        double level = Math.sqrt(aim.x * aim.x + aim.z * aim.z);
        float facing = level > 1.0e-4 ? (float) (Mth.atan2(aim.z, aim.x) * 180.0 / Math.PI) - 90.0f : abilityYaw;
        float turn = facing * 0.017453292f;`
    : `        float turn = abilityYaw * 0.017453292f;`
}
        Vec3 side = new Vec3(Mth.cos(turn), 0.0, Mth.sin(turn));
        Vec3 rise = aim.cross(side);
        float tilt = (float) Math.toDegrees(Math.asin(Mth.clamp(aim.y, -1.0, 1.0)));
        for (int index = 0; index < count && abilityEffects.size() < ${EFFECT_LIMITS.alive}; index++) {
            double angle = ring && count > 1 ? index * 2.0 * Math.PI / count : 0.0;
            double ahead = forward + (ring && count > 1 ? spread * Math.cos(angle) : count > 1 ? spread * index / (count - 1) : 0.0);
            double beside = left + (ring && count > 1 ? spread * Math.sin(angle) : 0.0);
            Vec3 at = origin.add(aim.scale(ahead)).add(rise.scale(up)).add(side.scale(beside));
            ${EFFECT_RUNTIME.entity} shown = ${EFFECT_RUNTIME.table}.spawn(id, level(), at, ${input.flight || anchored ? "facing" : "abilityYaw"}, tilt, (float) Math.toDegrees(angle), this, abilityTarget${sizedFx ? ", size" : ""});
            if (shown != null) abilityEffects.add(shown);
        }
    }

`
    : ""
}    /** The ability was cut short: the effects that end with it are gone at once, the others live out their time. */
    private void abilityCutEffects() {
        for (${EFFECT_RUNTIME.entity} shown : abilityEffects) if (shown.endsWithOwner()) shown.discard();
        abilityEffects.removeIf(Entity::isRemoved);
    }

`
        : ""
    }${parry.method}${combatHurt || (
      hurt || parrying
        ? `    @Override public boolean hurt(DamageSource source, float amount) {
${parry.head}        boolean hurt = super.hurt(source, amount);
${hurt ? `        // Being hurt ends an ability that says so, on the spot: nothing later in it happens${parrying ? " (not the one this very blow started)" : ""}.
        if (hurt${parrying ? " && parried < 0" : ""} && !level().isClientSide() && abilityIndex >= 0 && ABILITY_HURT_STOPS[abilityIndex]) ${shows ? "{\n            stopAbility();\n            abilityCutEffects();\n        }" : "stopAbility();"}
` : ""}        return hurt;
    }

`
        : ""
    )}`.replace(/(ability(?:Dash)?In\w+\(|abilityClear\(Vec3 from, )LivingEntity victim/g, geometry ? "$1net.minecraft.world.entity.Entity victim" : "$&"),
    /** The statement the creature's own tick() ends with. */
    tick: `${input.stagger ? "combatStaggerTick();" : ""}${guided ? 'guideShots();' : ''}tickAbility();${bearing.tick}${motion.tick}${tactics.tick}${stance ? "stanceTick();" : ""}`,
    /** 第 3 步: what the speeds of a runtime's own movement goal are multiplied by, written after each (an enrage's walk; left out without one, so what is returned is what it was). */
    pace: tactics.pace || undefined,
    /** Cuts a running ability short from outside (a boss changing phase or going back to sleep): nothing later in it happens. */
    interrupt: `if (abilityRunning()) {\n            stopAbility();${shows ? "\n            abilityCutEffects();" : ""}\n        }`,
    /** For a creature without a runtime block: the one goal that fights. It walks up to its target and starts whatever ability may start. */
    goal: fights
        ? `    private final class AbilityGoal extends Goal {
        private AbilityGoal() {
            setFlags(EnumSet.of(Flag.MOVE, Flag.LOOK));
        }

        @Override public boolean canUse() {
            LivingEntity target = getTarget();
            return target != null && target.isAlive();
        }

        @Override public boolean canContinueToUse() { return abilityRunning() || canUse()${input.steady && input.targeted && !input.stationary ? " || steadyFollowingPath()" : ""}; }

        @Override public boolean requiresUpdateEveryTick() { return true; }

        @Override public void stop() { getNavigation().stop(); }

        @Override public void tick() {
            LivingEntity target = getTarget();
            ${walks ? "if (target == null) return;\n            // 第 2 步: an ability that walks keeps going to its target while it plays.\n            if (abilityRunning()) {\n                if (abilityWalks()" + (stance ? " && stanceCanWalk()" : "") + ") getNavigation().moveTo(target, 1.2" + tactics.pace + ");\n                return;\n            }" : "if (abilityRunning() || target == null) return;"}
            getLookControl().setLookAt(target, 30.0f, 30.0f);
${input.stationary ? "            // It stays where it is: it turns to face its target (its shots go the way the body faces) and starts what can start from here.\n            abilityFace(target);\n" : ""}            if (startAbility(target)) return;
${stance ? "            if (!stanceCanWalk() || !stanceHasChoices()) { getNavigation().stop(); return; }\n" : ""}${input.flight ? "            // In the air the flight carries it: it circles its target and does not walk up to it.\n            if (flightState() != FLIGHT_GROUND) return;\n" : ""}${backs ? "            // Nearer than the window of an ability that is ready, it steps back into it instead of walking up to its target.\n            if (abilityBackOff(target)) return;\n" : ""}${tactics.move ? `            // 第 3 步: between abilities it moves as its phase says, and reacts to how its target keeps away or close.\n            if (${tactics.move}) return;\n` : ""}            ${input.stationary ? "// It does not walk up to its target." : (input.steady ? "if (steadyPathReady()) " : "") + "getNavigation().moveTo(target, 1.2" + tactics.pace + ");"}
        }
    }

`
        : "",
    /** For a creature with a runtime block: the first statements of its movement goal's tick, which then neither walks nor swings while an ability runs. */
    engage: input.hostile && input.runtime ? (stance ? `if (stanceChanging()) return;
            ${walks ? `if (abilityWalks() && stanceCanWalk()) { getNavigation().moveTo(target, 1.2${tactics.pace}); return; }
            ` : ""}${input.stationary ? "if (!abilityRunning()) abilityFace(target);\n            " : ""}if (abilityRunning() || startAbility(target)) return;
            if (!stanceCanWalk() || !stanceHasChoices()) { getNavigation().stop(); return; }${backs ? "\n            if (abilityBackOff(target)) return;" : ""}${tactics.move ? `\n            if (${tactics.move}) return;` : ""}` : (walks ? "if (abilityWalks()) {\n                getNavigation().moveTo(target, 1.2" + tactics.pace + ");\n                return;\n            }\n            " : "") + (input.stationary ? "if (abilityRunning()) return;\n            abilityFace(target);\n            if (startAbility(target)) return;" : `if (abilityRunning() || startAbility(target)${backs ? " || abilityBackOff(target)" : ""}${tactics.move ? ` || ${tactics.move}` : ""}) return;`)) : "",
    controller: `${staggerList(input.stagger).flatMap((row, i) => !row.clip ? [] : row.clip === "hurt" ? [`        var staggerHurt${i} = RawAnimation.begin().thenPlayAndHold("animation.${input.model}.hurt");
        controllers.add(new AnimationController<>(this, "combat_stagger_${i}", 0, new AnimationController.AnimationStateHandler<${input.entity}>() {
            private boolean playing;
            @Override public PlayState handle(software.bernie.geckolib.animation.AnimationState<${input.entity}> state) {
                if (combatStagger() != ${i} || isDeadOrDying()) {
                    playing = false;
                    return PlayState.STOP;
                }
                if (!playing) {
                    playing = true;
                    state.getController().forceAnimationReset();
                }
                return state.setAndContinue(staggerHurt${i});
            }
        }));
`] : [`        controllers.add(new AnimationController<>(this, "combat_stagger_${i}", 0, state -> combatStagger() == ${i} && !isDeadOrDying() ? state.setAndContinue(RawAnimation.begin().thenPlayAndHold("animation.${input.model}.${row.clip}")) : PlayState.STOP));\n`]).join("")}        // Plays whatever ability the server says is showing: every player near sees it start and stop together, also one who walks up in the middle of it.
        controllers.add(new AnimationController<>(this, "ability", 0, state -> {
            int shown = getEntityData().get(ABILITY);
            if (shown == 0${input.death ? " || isDeadOrDying()" : ""}) {
                abilityShown = 0;
                return PlayState.STOP;
            }
            if (shown != abilityShown) {
                abilityShown = shown;
                state.getController().forceAnimationReset();
            }
            return state.setAndContinue(ABILITY_CLIPS[(shown & 255) - 1]);
        }));
`,
    /** In the movement controller: walking and idling do not play over an ability. */
    shown: walks ? "(getEntityData().get(ABILITY) != 0 && !ABILITY_WALKS[(getEntityData().get(ABILITY) & 255) - 1])" : "getEntityData().get(ABILITY) != 0",
  }
}

/**
 * A 组: the vanilla particles and sounds a creature's abilities name that the target's game does not have (`VersionAdapter.abilities.lacks`), in the person's words:
 * the generated class would name a constant javac cannot find. Nothing for 1.21.1.
 */
export function abilityVersionGaps(creature: string, abilities: readonly Ability[], version: VersionAdapter) {
  return vanillaGaps(creature, abilities, version.minecraft)
}

/**
 * A 组: what a creature's renderer adds to draw its weapon trails (`common/trails.ts`), the same on every loader: one `StudioTrails` of the creature's `TRAILS`
 * for the renderer; before GeckoLib draws the creature it is told which parts to keep the matrix of (`preRender`), and after, with the pose stack at the creature
 * and not turned, the trails are drawn (`renderFinal`, after super). GeckoLib's two hooks take the colour as the version's GeckoLib has it (`renderColour`).
 */
export function trailRenderer(entity: string, version: VersionAdapter) {
  const colour = version.abilities.renderColour
  return {
    imports: `import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import net.minecraft.client.renderer.MultiBufferSource;
import software.bernie.geckolib.cache.object.BakedGeoModel;
`,
    members: `
    // Boss 能力 11: its weapon trails (${entity}.TRAILS), drawn by this player's game alone. GeckoLib keeps the matrix of every part a trail follows, and the trails are drawn after the creature.
    private final ${TRAIL_RUNTIME.client} trails = new ${TRAIL_RUNTIME.client}(${entity}.TRAILS);

    @Override public void preRender(PoseStack poseStack, ${entity} creature, BakedGeoModel model, MultiBufferSource bufferSource, VertexConsumer buffer, boolean isReRender, float partialTick, int packedLight, int packedOverlay, ${colour.params}) {
        super.preRender(poseStack, creature, model, bufferSource, buffer, isReRender, partialTick, packedLight, packedOverlay, ${colour.args});
        trails.track(model);
    }

    @Override public void renderFinal(PoseStack poseStack, ${entity} creature, BakedGeoModel model, MultiBufferSource bufferSource, VertexConsumer buffer, float partialTick, int packedLight, int packedOverlay, ${colour.params}) {
        super.renderFinal(poseStack, creature, model, bufferSource, buffer, partialTick, packedLight, packedOverlay, ${colour.args});
        // After super: the pose stack is as the entity renderer was handed it, at the creature and not turned.
        trails.frame(creature, creature.studioAbilityShown(), model, partialTick, poseStack, bufferSource);
    }
`,
  }
}
