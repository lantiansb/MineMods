import { ParticleRefSchema, resolvedAsset } from "../particle-emission"
import { steerJava } from "./guided-flight"
import { onceRef } from "../once-group"
import { z } from "zod"
import { CINEMATIC, cinematicPayload } from "./cinematic"
import { ABILITY_EFFECT_IDS, TICKS } from "../ability-words"
import { abilityTick } from "../creature-abilities"
import type { AbilityHit, ProjectileHit } from "../entity-runtime"
import { PATH_NUMBERS } from "../projectile-flight"
import type { GenTarget } from "../platform/adapter"
import { CLIENT_PLATFORM_CLASS, PLATFORM_CLASS, PLATFORM_PACKAGE } from "../platform/facade"
import { FABRIC_TARGET } from "../platform/target"
import { PROJECTILE_LIMITS } from "../projectile-words"
import { warnLook, ABILITY_WARN } from "../fabric/ability-warn"
import { BOSS_RUNTIME } from "../fabric/boss-runtime"
import { EFFECT_RUNTIME } from "../fabric/effect"
import { PARTICLE_RUNTIME } from "./particles"
import { GROUND_FX_RUNTIME, groundFxSpec } from "./ground-fx"
import { PROJECTILE_IMPACT } from "../projectile-words"
import { shakeTicks } from "../boss-look-words"

/**
 * Boss 能力 2 (投射物) as what it adds to a generated mod, the same text on every loader (the platform layer's common code): one entity type for every thrown thing of every
 * creature (`studio_projectile`), registered through `StudioPlatform.entity` on a facade target and by Fabric's registry on Fabric, and drawn by one renderer.
 *
 * - `StudioFlight`: the flight's arithmetic, the very statements of projectile-flight.ts in Java (`double`, no game class), so the server flies a thing exactly where the pictures draw it.
 * - `StudioProjectiles`: the type, what one thrown thing is (`Spec`, written by each creature's abilities), and `launch`: where a volley from the sky falls (item 3's places), the warning
 *   at those places (item 3's packet), the fan from a part, and the part hidden on its thrower while it is out (`Thrower`).
 * - `StudioProjectile`: one thrown thing. The server flies it tick by tick (`StudioFlight`), checks what it touches along the way and the blocks it meets, strikes, sticks, comes back; it
 *   is never written to disk, and it is gone with its thrower. A player's game is told only how it looks (synced) and where it is (the game's own movement packets), and draws it.
 * - `StudioProjectileRenderer`: an effect asset's model, or the thrower's own model with every part hidden but the one thrown, turned along its flight.
 *
 * Only written when some hostile creature of the project throws something of its own, so a project without is untouched, Fabric's text included.
 */

const Input = z.strictObject({
  terrainInteractions:z.boolean().default(false),
  modId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  /** Some thrown thing looks like an effect asset (`StudioEffects` is then in the mod). */
  effects: z.boolean(),
  /** Some volley from the sky is warned of (`StudioWarn` is then in the mod). */
  warned: z.boolean(),
  /** Boss 能力 13: some volley from the sky falls on a boss arena's middle (`over: "center"`; `StudioArena` is then in the mod). */
  fixtureTargets: z.boolean().default(false),
  arena: z.boolean().default(false),
  /** Boss 能力 13: some thrown thing is drawn larger or smaller than its look is built (`size`). */
  once: z.boolean().default(false),
  sized: z.boolean().default(false),
  hiddenEffects: z.boolean().default(false),
  motion: z.boolean().default(false),
  trails: z.array(z.object({ particle: ParticleRefSchema, per_tick: z.int().min(1).max(8), spread: z.number().min(0).max(1) })).default([]),
  /**
   * 落地炸开: some thrown thing bursts where it comes down (`impact`), and what any of them shows there: an effect (`StudioEffects` is then in the mod), a particle of the mod's own
   * (`StudioParticles`), a shake (`StudioShake`). Null (also when left out): nothing bursts, and every class is what it was, to the byte.
   */
  /** 第 4 步: some effect is drawn added to what is behind it (\`StudioEffects.additive\`): a thrown thing that looks like it is drawn so too. */
  additive: z.boolean().default(false),
  impact: z.strictObject({ effects: z.boolean(), own: z.boolean(), shake: z.boolean(), /** 第 4 步: some leaves a ground hazard, a crack or a shockwave there (`StudioFx`). */ ground: z.boolean().default(false), cinematic: z.boolean().optional() }).nullable().default(null),
})
export type ProjectileCompileInput = z.input<typeof Input>

/** The names the creatures reach the thrown things by. */
export const PROJECTILE_RUNTIME = { registry: "studio_projectile", entity: "StudioProjectile", table: "StudioProjectiles", flight: "StudioFlight", client: "StudioProjectileClient", renderer: "StudioProjectileRenderer", thrower: "Thrower" } as const

const real = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(6))))

/** The flight's arithmetic in Java: projectile-flight.ts statement for statement. Package-free of the game, so a test compiles and runs it with a plain JDK. */
export function flightSource(packageName: string) {
  return `package ${packageName}.entity;

/** Generated by MineMods Studio: how a thrown thing flies, tick by tick, in blocks and ticks. The same formulas draw it in Studio's pictures. */
public final class ${PROJECTILE_RUNTIME.flight} {
    private ${PROJECTILE_RUNTIME.flight}() {}

    public static final int STRAIGHT = 0;
    public static final int ARC = 1;
    public static final int BOOMERANG = 2;
    public static final int RETURN = 3;
    /** How far to the side a boomerang swings out, as a part of how far it flies. */
    public static final double WIDTH = ${real(PROJECTILE_LIMITS.width)};
    /** The most ticks a thing flies, or falls, before it is taken as lost. */
    public static final int FLIGHT = ${PROJECTILE_LIMITS.flight};

    /** The ticks a way of \`distance\` blocks takes at \`speed\` blocks a tick: whole ticks, at least one. */
    public static int wayTicks(double distance, double speed) {
        return Math.max(1, (int) Math.ceil(distance / speed - 1.0e-9));
    }

    /** The velocity it leaves with, from \`from\` toward \`aim\`, for the paths that move by velocity (straight, arc, return). */
    public static double[] velocity(int path, double[] from, double[] aim, double speed, double gravity) {
        double dx = aim[0] - from[0];
        double dy = aim[1] - from[1];
        double dz = aim[2] - from[2];
        if (path == ARC) {
            double flat = Math.sqrt(dx * dx + dz * dz);
            int ticks = wayTicks(flat, speed);
            return new double[] {dx / ticks, (dy + gravity * ticks * (ticks - 1) / 2.0) / ticks, dz / ticks};
        }
        double far = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (far < 1.0e-9) return new double[] {0.0, -speed, 0.0};
        if (path == RETURN) {
            int ticks = wayTicks(far, speed);
            return new double[] {dx / ticks, dy / ticks, dz / ticks};
        }
        return new double[] {dx / far * speed, dy / far * speed, dz / far * speed};
    }

    /** The ticks the way out of a return takes. */
    public static int returnTicks(double[] from, double[] aim, double speed) {
        double dx = aim[0] - from[0];
        double dy = aim[1] - from[1];
        double dz = aim[2] - from[2];
        return wayTicks(Math.sqrt(dx * dx + dy * dy + dz * dz), speed);
    }

    /** The ticks a whole boomerang loop takes. */
    public static int boomerangTicks(double[] from, double[] aim, double speed) {
        return 2 * returnTicks(from, aim, speed);
    }

    /** Where a boomerang is \`tick\` ticks after it left, its thrower standing still: out to the point it aims at and back, swinging out to its left going and to its right coming. */
    public static double[] boomerang(double[] from, double[] aim, int tick, int total) {
        double dx = aim[0] - from[0];
        double dy = aim[1] - from[1];
        double dz = aim[2] - from[2];
        double flat = Math.sqrt(dx * dx + dz * dz);
        double u = (double) tick / total;
        double out = Math.sin(Math.PI * u);
        double swing = WIDTH * flat * Math.sin(2.0 * Math.PI * u);
        double leftX = flat < 1.0e-9 ? 1.0 : dz / flat;
        double leftZ = flat < 1.0e-9 ? 0.0 : -dx / flat;
        return new double[] {from[0] + dx * out + leftX * swing, from[1] + dy * out, from[2] + dz * out + leftZ * swing};
    }

    /** One tick of the way back: \`speed\` blocks toward \`to\`, or onto it (the fourth number 1: it has arrived). */
    public static double[] back(double[] at, double[] to, double speed) {
        double dx = to[0] - at[0];
        double dy = to[1] - at[1];
        double dz = to[2] - at[2];
        double far = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (far <= speed) return new double[] {to[0], to[1], to[2], 1.0};
        return new double[] {at[0] + dx / far * speed, at[1] + dy / far * speed, at[2] + dz / far * speed, 0.0};
    }

    /** The point the \`index\`-th of \`count\` thrown together aims at: turned about \`from\` (level) by its share of a fan \`spread\` degrees wide. */
    public static double[] fan(double[] from, double[] aim, int index, int count, double spread) {
        if (count < 2) return new double[] {aim[0], aim[1], aim[2]};
        double angle = spread * ((double) index / (count - 1) - 0.5) * Math.PI / 180.0;
        double dx = aim[0] - from[0];
        double dz = aim[2] - from[2];
        return new double[] {from[0] + dx * Math.cos(angle) - dz * Math.sin(angle), aim[1], from[2] + dx * Math.sin(angle) + dz * Math.cos(angle)};
    }

    /** The ticks a thing falling from \`height\` blocks takes to reach the ground: straight down at \`speed\`, faster by \`gravity\` each tick. */
    public static int fallTicks(double height, double speed, double gravity) {
        double y = height;
        double velocity = -speed;
        for (int tick = 1; tick <= FLIGHT; tick++) {
            y += velocity;
            velocity -= gravity;
            if (y <= 0.0) return tick;
        }
        return FLIGHT;
    }

    /** \`count\` places within \`spread\` blocks round a point, as forward and left by turns, drawn by the cast's \`seed\` mixed with which hit it is (item 3's scatter, mulberry32). */
    public static double[] scatter(int seed, int slot, int count, double spread) {
        int[] state = {seed ^ ((slot + 1) * 0x9E3779B9)};
        double[] pairs = new double[count * 2];
        for (int index = 0; index < count; index++) {
            double angle = random(state) * 2.0 * Math.PI;
            double far = Math.sqrt(random(state)) * spread;
            pairs[index * 2] = far * Math.cos(angle);
            pairs[index * 2 + 1] = far * Math.sin(angle);
        }
        return pairs;
    }

    /** The next number of a drawing, from 0 up to 1 (mulberry32 on 32-bit integers). */
    static double random(int[] state) {
        state[0] += 0x6D2B79F5;
        int mixed = (state[0] ^ (state[0] >>> 15)) * (state[0] | 1);
        mixed ^= mixed + (mixed ^ (mixed >>> 7)) * (mixed | 61);
        return ((mixed ^ (mixed >>> 14)) & 0xFFFFFFFFL) / 4294967296.0;
    }
}
`
}

/** The Java numbers of an ability hit's status effects, in the order `ABILITY_EFFECT_IDS` lists them. */
export const PROJECTILE_EFFECT_NUMBERS = Object.fromEntries(ABILITY_EFFECT_IDS.map((id, index) => [id, index])) as Record<(typeof ABILITY_EFFECT_IDS)[number], number>

const OVER_NUMBERS = { self: 0, target: 1, around_target: 2, pattern: 3, center: 4, lit_random: 5, lit_nearest: 6 } as const

function trailKey(trail: NonNullable<ProjectileHit["trail"]>) {
  const name = typeof trail.particle === "string" ? trail.particle : resolvedAsset(trail.particle)
  return JSON.stringify([name, trail.per_tick, trail.spread])
}

/** One thrown thing of a creature's ability as the `Spec` its class hands `launch` (`StudioProjectiles.Spec`): its document's numbers, its times in ticks. */
export function projectileSpec(hit: ProjectileHit, plan: { tick: number }) {
  const sky = "sky" in hit.from ? hit.from.sky : null
  const over = hit.place ?? sky?.over ?? "self"
  const kind = typeof over === "string" ? over : "fixture" in over ? over.fixture : over.type
  const pattern = typeof over === "object" && over.type === "pattern" ? over.points.flatMap((point) => [point.forward, point.left]) : []
  const effects = hit.effects.flatMap((effect) => [PROJECTILE_EFFECT_NUMBERS[effect.effect], effect.duration_ticks, effect.particles === false ? ~effect.amplifier : effect.amplifier])
  const args = [
    PATH_NUMBERS[hit.path],
    real(hit.speed),
    real(hit.gravity),
    `${real(hit.damage)}f`,
    real(hit.knockback),
    real(hit.radius),
    `new int[] {${effects.join(", ")}}`,
    abilityTick(hit.pin_seconds ?? 0),
    hit.comes_back ? Math.max(0, abilityTick(hit.comes_back.at) - plan.tick) : -1,
    hit.count ?? 1,
    real(hit.spread ?? 0),
    Boolean(sky),
    OVER_NUMBERS[kind],
    typeof over === "object" && over.type === "around_target" ? over.count : 0,
    real(typeof over === "object" && over.type === "around_target" ? over.spread : 0),
    `new double[] {${pattern.map(real).join(", ")}}`,
    real(sky?.height ?? 0),
    hit.warn ? warnLook(hit.warn) : -1,
    hit.warn ? ABILITY_WARN.colors[hit.warn.color] : -1,
    "effect" in hit.look ? JSON.stringify(hit.look.effect) : "null",
    "bone" in hit.look ? JSON.stringify(hit.look.bone) : "null",
    // 落地炸开: only one that bursts says so (the record's shorter constructor stands for none), so a thrown thing without is written as it always was.
    ...(hit.impact ? [impactSpec(hit.impact)] : []),
  ]
  return `new ${PROJECTILE_RUNTIME.table}.Spec(${args.join(", ")})`
}

/**
 * 落地炸开: what a thrown thing bursts into where it comes down as the `Impact` its `Spec` carries: the effect's asset id, the game's own particle by its constant (so a version that
 * lacks it is a constant javac cannot find: `vanillaGaps` stops it first), or one of the mod's own by its asset id, how many and how far they scatter, and the shake (0 strength: none).
 */
export function impactSpec(impact: NonNullable<ProjectileHit["impact"]>) {
  const particle = impact.particle
  const shake = impact.shake
  return `new ${PROJECTILE_RUNTIME.table}.Impact(${[
    impact.effect !== undefined ? JSON.stringify(impact.effect) : "null",
    typeof particle === "string" ? `net.minecraft.core.particles.ParticleTypes.${particle.toUpperCase()}` : "null",
    particle !== undefined && typeof particle !== "string" ? JSON.stringify(resolvedAsset(particle)) : "null",
    impact.count ?? PROJECTILE_IMPACT.count,
    real(impact.spread ?? PROJECTILE_IMPACT.spread),
    `${real(shake?.strength ?? 0)}f`,
    `${real(shake?.radius ?? 0)}f`,
    shake ? shakeTicks(shake) : 0,
    // 第 4 步: only one that leaves something on the ground says so (the record's shorter constructors stand for none).
    ...(impact.ground?.length ? [`new ${GROUND_FX_RUNTIME.spec}[] {${impact.ground.map((fx) => groundFxSpec(fx)).join(", ")}}`] : []),
    ...(impact.camera || impact.sky_tint ? [impact.camera ? cinematicPayload("camera", impact.camera) : "null", impact.sky_tint ? cinematicPayload("sky_tint", impact.sky_tint) : "null"] : []),
  ].join(", ")})`
}

/**
 * 落地炸开: the Java record a burst is written as. What it leaves on the ground (第 4 步) and the camera and sky it moves (cinematic) are fields only a mod that uses them has, each with the
 * shorter constructors that stand for none, so a mod using neither has the plain record, to the byte.
 */
function impactRecord(ground: boolean, cinematic: boolean) {
  const base = "String effect, ParticleOptions particle, String own, int count, double spread, float strength, float radius, int ticks"
  const args = "effect, particle, own, count, spread, strength, radius, ticks"
  const cues = `${CINEMATIC.server}.Cue camera, ${CINEMATIC.server}.Cue skyTint`
  const shorter = (params: string, rest: string) => `        public Impact(${params}) {
            this(${rest});
        }
`
  if (!ground && !cinematic) return `    public record Impact(${base}) {}
`
  if (!cinematic)
    return `    public record Impact(${base}, ${GROUND_FX_RUNTIME.spec}[] ground) {
        /** 第 4 步: one that leaves nothing on the ground (its hazards, cracks and shockwaves; null: none). */
${shorter(base, `${args}, null`)}    }
`
  if (!ground)
    return `    public record Impact(${base}, ${cues}) {
${shorter(base, `${args}, null, null`)}    }
`
  return `    public record Impact(${base}, ${GROUND_FX_RUNTIME.spec}[] ground, ${cues}) {
        /** 第 4 步: one that leaves nothing on the ground (its hazards, cracks and shockwaves; null: none), and one that moves no camera or sky. */
${shorter(base, `${args}, null, null, null`)}${shorter(`${base}, ${GROUND_FX_RUNTIME.spec}[] ground`, `${args}, ground, null, null`)}${shorter(`${base}, ${cues}`, `${args}, null, camera, skyTint`)}    }
`
}

/** 落地炸开: what the thrown things of these hits need of the runtime where they burst; null when none bursts (`compileProjectiles`' `impact`). */
export function projectileImpactNeeds(hits: readonly ProjectileHit[]) {
  const impacts = hits.flatMap((hit) => (hit.impact ? [hit.impact] : []))
  if (!impacts.length) return null
  return { effects: impacts.some((impact) => impact.effect !== undefined), own: impacts.some((impact) => impact.particle !== undefined && typeof impact.particle !== "string"), shake: impacts.some((impact) => impact.shake !== undefined), ground: impacts.some((impact) => (impact.ground?.length ?? 0) > 0), ...(impacts.some((impact) => impact.camera || impact.sky_tint) ? { cinematic: true } : {}) }
}

/**
 * The statement a creature's ability throws with (hit `slot` of its ability): from where the hit now counts from (the part it is thrown from: `abilityShift…`, which the ability sets for a hit
 * that names a part, `anchored`), facing as the ability faces, waiting `delay` ticks, its damage times the boss's phase and the combo's number where the creature has them.
 */
export function projectileLaunch(hit: ProjectileHit, plan: { tick: number }, slot: number, delay: number, scaled: boolean, chained: boolean) {
  const shifted = "bone" in hit.from ? "abilityShiftF, abilityShiftU, abilityShiftL" : "0.0, 0.0, 0.0"
  const scale = [...(scaled ? ["bossDamageScale()"] : []), ...(chained ? ["abilityDamageScale()"] : [])].join(" * ") || "1.0f"
  // Boss 能力 13: one drawn at another size says so last (only a project with such a thing has the longer launch).
  const motion = hit.trail || hit.lifetime_ticks !== undefined || hit.homing || hit.pierce || hit.bounces ? `, ${real(hit.size ?? 1)}f, new ${PROJECTILE_RUNTIME.table}.Motion(${hit.lifetime_ticks ?? -1}, ${real(hit.homing?.strength ?? 0)}, ${real(hit.homing?.range ?? 0)}, ${hit.pierce ?? 0}, ${hit.bounces ?? 0}${hit.trail ? `, ${PROJECTILE_RUNTIME.table}.TRAILS.indexOf(${JSON.stringify(trailKey(hit.trail))})` : ""})` : null
  const group = onceRef(hit)
  return `${PROJECTILE_RUNTIME.table}.launch(this, abilityTarget, ${projectileSpec(hit, plan)}, ${slot}, ${shifted}, abilityYaw, ${delay}, ${scale}${motion ?? (hit.size !== undefined ? `, ${real(hit.size)}f` : "")}${group ? ", " + group : ""});`
}

/**
 * What a creature that throws parts of its own model adds (Boss 能力 2): the synced number of which of them are out, read by every player's game to hide them (`setCustomAnimations` of its
 * renderer's model), and the three members of `StudioProjectiles.Thrower`. Null for a creature that throws none: its class and renderer are what they were.
 */
export function throwerParts(entity: string, model: string, abilities: readonly { hits: readonly AbilityHit[] }[]) {
  const bones = [...new Set(abilities.flatMap((ability) => ability.hits.flatMap((hit) => (hit.type === "projectile" && "bone" in hit.look ? [hit.look.bone] : []))))]
  if (!bones.length) return null
  return {
    implements: `, ${PROJECTILE_RUNTIME.table}.${PROJECTILE_RUNTIME.thrower}`,
    tracker: "        builder.define(THROWN, 0);\n",
    fields: `    // Boss 能力 2: the parts of its model it throws (THROWN_BONES), and which of them are out now (a bit each), for every player's game to hide them.
    public static final String[] THROWN_BONES = {${bones.map((bone) => JSON.stringify(bone)).join(", ")}};
    private static final EntityDataAccessor<Integer> THROWN = SynchedEntityData.defineId(${entity}.class, EntityDataSerializers.INT);
`,
    methods: `    public int studioThrownBones() { return getEntityData().get(THROWN); }

    @Override public boolean studioAway(String bone) {
        int bit = java.util.Arrays.asList(THROWN_BONES).indexOf(bone);
        return bit >= 0 && (studioThrownBones() & (1 << bit)) != 0;
    }

    @Override public void studioThrown(String bone, boolean away) {
        int bit = java.util.Arrays.asList(THROWN_BONES).indexOf(bone);
        if (bit < 0) return;
        getEntityData().set(THROWN, away ? studioThrownBones() | (1 << bit) : studioThrownBones() & ~(1 << bit));
    }

    @Override public String studioModel() { return ${JSON.stringify(model)}; }

`,
    /**
     * In the renderer's `render`, after a boss's phase has set its bones (Boss 能力 10, `bones` its list, when it has one), on the model `model`: each part thrown is hidden while it is out,
     * and shown when it is back unless the boss's phase hides it (or it has come off).
     */
    render: (boss: boolean) => `        // Boss 能力 2: the parts it has thrown that are not back yet.
        int thrown = creature.studioThrownBones();
        for (int bit = 0; bit < ${entity}.THROWN_BONES.length; bit++) {
            boolean away = (thrown & (1 << bit)) != 0;
${boss ? `            if (!away && java.util.Arrays.asList(bones).contains(${entity}.THROWN_BONES[bit])) continue;\n` : ""}            model.getBone(${entity}.THROWN_BONES[bit]).ifPresent(bone -> bone.setHidden(away));
        }
`,
  }
}

export function compileProjectiles(value: ProjectileCompileInput, target: GenTarget = FABRIC_TARGET) {
  const input = Input.parse(value)
  const trails = [...new Map(input.trails.map(trail => [trailKey(trail), trail])).values()]
  const facade = target.loader.facade
  const version = target.version
  const source = `src/main/java/${input.packageName.replaceAll(".", "/")}`
  const R = PROJECTILE_RUNTIME
  const colour = version.abilities.renderColour
  const files: Record<string, string> = {
    [`${source}/entity/${R.flight}.java`]: flightSource(input.packageName),
    [`${source}/entity/${R.table}.java`]: `package ${input.packageName}.entity;

${
  facade
    ? `import ${input.packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import java.util.function.Supplier;
`
    : `import net.fabricmc.api.ModInitializer;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
`}${input.impact ? "import net.minecraft.core.particles.ParticleOptions;\n" : ""}import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.world.entity.Mob;

/** Generated by MineMods Studio: the things this mod's creatures throw of their own (Boss 能力 2). One entity type flies them all; the server decides everything, a player's game draws. */
public final class ${R.table}${facade ? "" : " implements ModInitializer"} {
    public static final String MOD_ID = ${JSON.stringify(input.modId)};
    // Never written to disk and never summoned by command: a thrown thing only exists because a creature threw it.
${
  facade
    ? `    public static final Supplier<EntityType<${R.entity}>> TYPE = ${PLATFORM_CLASS}.entity("${R.registry}",
        () -> EntityType.Builder.<${R.entity}>of(${R.entity}::new, MobCategory.MISC)
            .sized(0.5f, 0.5f).noSave().noSummon().fireImmune().clientTrackingRange(8).updateInterval(1).build("${R.registry}"));`
    : `    public static final EntityType<${R.entity}> TYPE = Registry.register(
        BuiltInRegistries.ENTITY_TYPE, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${R.registry}"),
        EntityType.Builder.<${R.entity}>of(${R.entity}::new, MobCategory.MISC)
            .sized(0.5f, 0.5f).noSave().noSummon().fireImmune().clientTrackingRange(8).updateInterval(1).build("${R.registry}"));`
}
    /** Blocks round its path within which it touches someone. */
    public static final double TOUCH = ${real(PROJECTILE_LIMITS.touch)};
    /** The most ticks its way back takes before it is put away. */
    public static final int BACK = ${PROJECTILE_LIMITS.back};

    /**
     * One thrown thing as a creature's ability writes it: how it flies (\`${R.flight}\`'s path, blocks a tick, blocks a tick per tick), what it does where it strikes (damage, a push away
     * from there, status effects as kind, ticks and strength by threes, and everyone within \`radius\`), how long it stays stuck where it lands (ticks), the tick after the throw from which it
     * may fly back (-1: it never does), how many are thrown from a part and the fan they spread over (degrees), and for one from the sky: where it falls (0 its thrower's feet, 1 its
     * target's, 2 scattered round its target, 3 a pattern), how many, how far they scatter or the pattern (forward and left by turns), how high it starts, and the warning's look and
     * colour (-1: none). How it looks: an effect's asset id, or the name of its thrower's own part (\`bone\`).${input.impact ? " What it bursts into where it comes down (null: nothing)." : ""}
     */
${
  input.impact
    ? `    public record Spec(int path, double speed, double gravity, float damage, double knockback, double radius, int[] effects, int pin, int back, int count, double spread,
                       boolean sky, int over, int overCount, double overSpread, double[] pattern, double height, int warnLook, int warnColor, String effect, String bone, Impact impact) {
        /** One that bursts into nothing where it comes down. */
        public Spec(int path, double speed, double gravity, float damage, double knockback, double radius, int[] effects, int pin, int back, int count, double spread,
                    boolean sky, int over, int overCount, double overSpread, double[] pattern, double height, int warnLook, int warnColor, String effect, String bone) {
            this(path, speed, gravity, damage, knockback, radius, effects, pin, back, count, spread, sky, over, overCount, overSpread, pattern, height, warnLook, warnColor, effect, bone, null);
        }
    }

    /**
     * 落地炸开: what is seen and felt where a thrown thing comes down, the moment it first strikes (whoever it touches, or the block it meets): an effect by its asset id, the game's own
     * particle or one of this mod's by its asset id (null: none), how many and how far they scatter (blocks), and the screens shaken round there (0 strength: none; blocks, ticks).
     */
${impactRecord(input.impact.ground, input.impact.cinematic === true)}`
    : `    public record Spec(int path, double speed, double gravity, float damage, double knockback, double radius, int[] effects, int pin, int back, int count, double spread,
                       boolean sky, int over, int overCount, double overSpread, double[] pattern, double height, int warnLook, int warnColor, String effect, String bone) {}
`
}
    /** A creature that throws parts of its own model: which of them are out (hidden on it in every player's game), and the name its model is drawn by. */
    public interface ${R.thrower} {
        boolean studioAway(String bone);
        void studioThrown(String bone, boolean away);
        String studioModel();
    }

${
  facade
    ? `    private ${R.table}() {}

    /** Run by the mod's common entry while the mod is constructed: loading this class registers the entity type (its field above). */
    public static void register() {}`
    : `    // Fabric builds a main entrypoint through its no-argument constructor, which must be public.
    public ${R.table}() {}

    // Loading this class registers the entity type; nothing else is needed at start.
    @Override public void onInitialize() {}`
}

    /**
     * Throws what \`spec\` says, now: \`slot\` is which hit of its ability it is (a scatter mixes it in, as item 3's places do), \`forward\`, \`up\`, \`left\` where it leaves from in its
     * thrower's terms as it faces \`yaw\` (the middle of the part it is thrown from, at the creature's size), \`delay\` the ticks a volley from the sky waits, warned, before it falls, and
     * \`scale\` what its damage is multiplied by (a boss's phase, a combo). A part of its own that is still out is not thrown again: there is none in its hand.
     */
${
  input.sized || input.motion
    ? `    public static void launch(Mob owner, LivingEntity target, Spec spec, int slot, double forward, double up, double left, float yaw, int delay, float scale${input.once ? ", StudioOnce.Group... group" : ""}) {
        launch(owner, target, spec, slot, forward, up, left, yaw, delay, scale, 1.0f${input.once ? ", group" : ""});
    }

    /** The same, drawn \`size\` times as large as its look is built (Boss 能力 13). */
    public static void launch(Mob owner, LivingEntity target, Spec spec, int slot, double forward, double up, double left, float yaw, int delay, float scale, float size${input.once ? ", StudioOnce.Group... group" : ""}) {${input.motion ? `
        launch(owner, target, spec, slot, forward, up, left, yaw, delay, scale, size, ${input.once ? "(Motion)null, group" : "null"});
    }

    ${trails.length ? `public static final java.util.List<String> TRAILS = java.util.List.of(${trails.map(t => JSON.stringify(trailKey(t))).join(", ")});
    public record Motion(int lifetime, double strength, double range, int pierce, int bounces, int trail) {
        public Motion(int lifetime, double strength, double range, int pierce, int bounces) {
            this(lifetime, strength, range, pierce, bounces, -1);
        }
    }` : "public record Motion(int lifetime, double strength, double range, int pierce, int bounces) {}"}

    public static void launch(Mob owner, LivingEntity target, Spec spec, int slot, double forward, double up, double left, float yaw, int delay, float scale, float size, Motion motion${input.once ? ", StudioOnce.Group... group" : ""}) {` : ""}`
    : `    public static void launch(Mob owner, LivingEntity target, Spec spec, int slot, double forward, double up, double left, float yaw, int delay, float scale${input.once ? ", StudioOnce.Group... group" : ""}) {`
}
        if (!(owner.level() instanceof ServerLevel world) || target == null) return;
${input.fixtureTargets ? `        double[] fixtureAim = spec.over() >= 5 ? StudioArena.target(StudioArena.room(owner), owner, spec.over() == 5) : null;
        if (fixtureAim != null && fixtureAim.length == 0) return;
` : ""}        if (spec.bone() != null) {
            if (!(owner instanceof ${R.thrower} thrower) || thrower.studioAway(spec.bone())) return;
            thrower.studioThrown(spec.bone(), true);
        }
        float turn = yaw * 0.017453292f;
        if (spec.sky()) {
            int count = spec.over() == 2 ? spec.overCount() : spec.over() == 3 ? spec.pattern().length / 2 : 1;
            double[] scattered = spec.over() == 2 ? ${R.flight}.scatter(owner.getRandom().nextInt(), slot, count, spec.overSpread()) : null;
            double[] places = new double[count * 3];
${input.fixtureTargets ? "            if (fixtureAim != null) System.arraycopy(fixtureAim, 0, places, 0, 3);\n            else " : ""}${input.arena ? "            // Boss 能力 13: one that falls on its arena's middle falls there.\n            if (spec.over() == 4) System.arraycopy(StudioArena.center(owner), 0, places, 0, 3);\n            else " : "            "}for (int index = 0; index < count; index++) {
                // Item 3's places: its own feet, its target's, scattered round its target, or a pattern from its own feet, in its terms as it faces now.
                double ahead = spec.over() == 2 ? scattered[index * 2] : spec.over() == 3 ? spec.pattern()[index * 2] : 0.0;
                double side = spec.over() == 2 ? scattered[index * 2 + 1] : spec.over() == 3 ? spec.pattern()[index * 2 + 1] : 0.0;
                LivingEntity round = spec.over() == 1 || spec.over() == 2 ? target : owner;
                places[index * 3] = round.getX() - ahead * Mth.sin(turn) + side * Mth.cos(turn);
                places[index * 3 + 1] = round.getY();
                places[index * 3 + 2] = round.getZ() + ahead * Mth.cos(turn) + side * Mth.sin(turn);
            }
            for (int index = 0; index < count; index++) {
                double[] ground = {places[index * 3], places[index * 3 + 1], places[index * 3 + 2]};
                double[] top = {ground[0], ground[1] + spec.height(), ground[2]};
                ${R.entity} thrown = new ${R.entity}(${facade ? "TYPE.get()" : "TYPE"}, world);
                thrown.begin(owner, spec, top, ground, delay, scale, index == 0 && spec.warnLook() >= 0 ? places : null);
${input.motion ? "                thrown.motion = motion;\n" + (trails.length ? "                if (motion != null) thrown.setTrail(motion.trail());\n" : "") : ""}${input.sized ? "                thrown.resize(size);\n" : ""}${input.once ? "                if (group.length > 0) thrown.once = group[0];\n" : ""}                world.addFreshEntity(thrown);
            }
${
  input.warned
    ? `            if (spec.warnLook() >= 0) {
                // Item 3's warning at every place, a ring as wide as what it strikes, for as long as it waits and falls.
                int ticks = delay + ${R.flight}.fallTicks(spec.height(), spec.speed(), spec.gravity());
                ${ABILITY_WARN.server}.send(world, new ${ABILITY_WARN.server}.Warn(owner.getId(), ticks, spec.warnLook(), spec.warnColor(), ${ABILITY_WARN.shapes.sphere}, yaw, 0.0f, 0.0f, 0.0f, (float) Math.max(1.0, spec.radius()), 0.0f, 0.0f, places));
            }
`
    : ""
}            return;
        }
        double[] from = {owner.getX() - forward * Mth.sin(turn) + left * Mth.cos(turn), owner.getY() + up, owner.getZ() + forward * Mth.cos(turn) + left * Mth.sin(turn)};
        // What flies straight or loops aims at the middle of the one it fights; what is lobbed lands at their feet.
        double[] aim = ${input.fixtureTargets ? "fixtureAim != null ? fixtureAim : new double[] " : ""}{target.getX(), spec.path() == ${R.flight}.ARC ? target.getY() : target.getY(0.5), target.getZ()};
        for (int index = 0; index < spec.count(); index++) {
            ${R.entity} thrown = new ${R.entity}(${facade ? "TYPE.get()" : "TYPE"}, world);
            thrown.begin(owner, spec, from, ${R.flight}.fan(from, aim, index, spec.count(), spec.spread()), 0, scale, null);
${input.motion ? "            thrown.motion = motion;\n" + (trails.length ? "            if (motion != null) thrown.setTrail(motion.trail());\n" : "") + "            thrown.locked = "+(input.fixtureTargets ? "fixtureAim == null ? target : null" : "target")+";\n" : ""}${input.sized ? "            thrown.resize(size);\n" : ""}${input.once ? "            if (group.length > 0) thrown.once = group[0];\n" : ""}            world.addFreshEntity(thrown);
        }
    }
}
`,
    [`${source}/entity/${R.entity}.java`]: `package ${input.packageName}.entity;

import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
${input.impact ? `import net.minecraft.core.particles.ParticleOptions;\n${input.impact.own ? "import net.minecraft.core.particles.SimpleParticleType;\n" : ""}` : ""}import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.Explosion;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.material.PushReaction;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import software.bernie.geckolib.animatable.GeoEntity;
import software.bernie.geckolib.animatable.instance.AnimatableInstanceCache;
import software.bernie.geckolib.animation.AnimatableManager;
import software.bernie.geckolib.animation.AnimationController;
import software.bernie.geckolib.animation.PlayState;
import software.bernie.geckolib.animation.RawAnimation;
import software.bernie.geckolib.util.GeckoLibUtil;

/** Generated by MineMods Studio: one thing a creature threw. The server flies it and strikes with it; it cannot be hit, pushed or saved. */
public class ${R.entity} extends Entity implements GeoEntity {
    // How it looks, for every player's game: the model it is drawn by (an effect's, or its thrower's), the part of that model it is (empty: all of it), which effect it is (-1: a part),
    // whether it spins as it flies, how large its thrower is, and what it is doing: 0 waiting in the sky (not drawn), 1 flying, 2 stuck where it landed, 3 coming back.
${trails.length ? `    private static final EntityDataAccessor<Integer> TRAIL = SynchedEntityData.defineId(${R.entity}.class, EntityDataSerializers.INT);
    private static final int[] TRAIL_COUNTS = {${trails.map(t => t.per_tick).join(", ")}};
    private static final double[] TRAIL_SPREADS = {${trails.map(t => real(t.spread)).join(", ")}};
    private Vec3 previousTrail;
    void setTrail(int trail) { getEntityData().set(TRAIL, trail); }

    private void drawTrail() {
        Vec3 here = position();
        Vec3 last = previousTrail;
        previousTrail = here;
        int id = getEntityData().get(TRAIL);
        if (id < 0 || last == null || last.equals(here) || (state() != FLYING && state() != BACK)) return;
        net.minecraft.core.particles.ParticleOptions particle = switch (id) {
${trails.map((t, i) => `            case ${i} -> ${typeof t.particle === "string" ? `net.minecraft.core.particles.ParticleTypes.${t.particle.toUpperCase()}` : `${PARTICLE_RUNTIME.table}.byAsset(${JSON.stringify(resolvedAsset(t.particle))})`};`).join("\n")}
            default -> null;
        };
        if (particle == null) return;
        double spread = TRAIL_SPREADS[id];
        int count = TRAIL_COUNTS[id];
        for (int i = 0; i < count; i++) {
            Vec3 point = last.lerp(here, (i + 0.5) / count);
            level().addParticle(particle, point.x + jitter(spread), point.y + jitter(spread), point.z + jitter(spread), 0, 0, 0);
        }
    }

    private double jitter(double spread) { return spread == 0 ? 0 : spread * (2 * random.nextDouble() - 1); }
` : ""}    private static final EntityDataAccessor<String> MODEL = SynchedEntityData.defineId(${R.entity}.class, EntityDataSerializers.STRING);
    private static final EntityDataAccessor<String> BONE = SynchedEntityData.defineId(${R.entity}.class, EntityDataSerializers.STRING);
    private static final EntityDataAccessor<Integer> EFFECT = SynchedEntityData.defineId(${R.entity}.class, EntityDataSerializers.INT);
    private static final EntityDataAccessor<Boolean> SPIN = SynchedEntityData.defineId(${R.entity}.class, EntityDataSerializers.BOOLEAN);
    private static final EntityDataAccessor<Float> SIZE = SynchedEntityData.defineId(${R.entity}.class, EntityDataSerializers.FLOAT);
    private static final EntityDataAccessor<Integer> STATE = SynchedEntityData.defineId(${R.entity}.class, EntityDataSerializers.INT);
    public static final int WAITING = 0;
    public static final int FLYING = 1;
    public static final int STUCK = 2;
    public static final int BACK = 3;
    private final AnimatableInstanceCache animations = GeckoLibUtil.createInstanceCache(this);
    // The server's own: who threw it, what it is, where it is and how fast it goes (blocks, blocks a tick), where it left from and aims at, where it comes back to (from its thrower,
    // as it was thrown), where its thrower stood then, the ticks it still waits and has flown, the tick it landed on (-1: not yet), a loop's ticks, whether it has struck, and who it touched.
    private Mob owner;
    private ${R.table}.Spec spec;
    private float scale = 1.0f;
    private double[] at;
    private double[] velocity;
    private double[] from;
    private double[] aim;
    private double[] home;
    private double[] ownerFrom;
    private int delay;
    private int age;
    private int landed = -1;
${input.motion ? `    ${R.table}.Motion motion;\n    LivingEntity locked;\n    private int pierced, bounced;\n${steerJava}` : ""}    private int backFrom = -1;
    private int total;
    private boolean struck;
    private double[] warned;
    ${input.once ? "StudioOnce.Group once;\n    " : ""}private final Set<Integer> touched = new HashSet<>();

    public ${R.entity}(EntityType<? extends ${R.entity}> type, Level world) {
        super(type, world);
        noPhysics = true;
        setNoGravity(true);
    }

    @Override protected void defineSynchedData(SynchedEntityData.Builder builder) {
${trails.length ? "        builder.define(TRAIL, -1);\n" : ""}        builder.define(MODEL, "");
        builder.define(BONE, "");
        builder.define(EFFECT, -1);
        builder.define(SPIN, false);
        builder.define(SIZE, 1.0f);
        builder.define(STATE, WAITING);
    }

    public String model() { return getEntityData().get(MODEL); }
    public String bone() { return getEntityData().get(BONE); }
    public int effect() { return getEntityData().get(EFFECT); }
    public boolean spins() { return getEntityData().get(SPIN); }
    public float size() { return getEntityData().get(SIZE); }
    public int state() { return getEntityData().get(STATE); }
${input.sized ? "\n    /** Boss 能力 13: drawn `size` times as large as its look is built (its thrower's size stays in it). */\n    void resize(float size) {\n        if (size != 1.0f) getEntityData().set(SIZE, size() * size);\n    }\n" : ""}
    void begin(Mob owner, ${R.table}.Spec spec, double[] from, double[] aim, int delay, float scale, double[] warned) {
        this.owner = owner;
        this.spec = spec;
        this.scale = scale;
        this.from = from;
        this.aim = aim;
        this.at = new double[] {from[0], from[1], from[2]};
        this.delay = delay;
        this.warned = warned;
        this.ownerFrom = new double[] {owner.getX(), owner.getY(), owner.getZ()};
        this.home = new double[] {from[0] - owner.getX(), from[1] - owner.getY(), from[2] - owner.getZ()};
        if (spec.path() == ${R.flight}.BOOMERANG) total = ${R.flight}.boomerangTicks(from, aim, spec.speed());
        else if (spec.path() == ${R.flight}.RETURN) total = ${R.flight}.returnTicks(from, aim, spec.speed());
        velocity = spec.path() == ${R.flight}.BOOMERANG ? new double[3] : ${R.flight}.velocity(spec.path(), from, aim, spec.speed(), spec.gravity());
${
  input.effects
    ? `        if (spec.effect() != null) {
            int kind = ${EFFECT_RUNTIME.table}.kind(spec.effect());
            getEntityData().set(MODEL, ${EFFECT_RUNTIME.table}.NAMES[kind]);
            getEntityData().set(EFFECT, kind);
        }
`
    : ""
}        if (spec.bone() != null && owner instanceof ${R.table}.${R.thrower} thrower) {
            getEntityData().set(MODEL, thrower.studioModel());
            getEntityData().set(BONE, spec.bone());
            getEntityData().set(SIZE, owner.getScale());
        }
        getEntityData().set(SPIN, spec.path() == ${R.flight}.BOOMERANG || spec.path() == ${R.flight}.RETURN);
        getEntityData().set(STATE, delay > 0 ? WAITING : FLYING);
        face(aim[0] - from[0], aim[1] - from[1], aim[2] - from[2]);
        moveTo(from[0], from[1], from[2], getYRot(), getXRot());
    }

    @Override public void tick() {
        super.tick();
        ${trails.length ? "if (level().isClientSide()) { drawTrail(); return; }" : "if (level().isClientSide()) return;"}
        // Gone with its thrower, wherever it is; one that was never thrown (a chunk loaded without its thrower) is gone at once.
        if (spec == null || owner == null || !owner.isAlive() || owner.isRemoved()) {
            discard();
            return;
        }
        if (delay > 0) {
            if (--delay == 0) getEntityData().set(STATE, FLYING);
            return;
        }
        age++;
        switch (state()) {
            case FLYING -> fly();
            case STUCK -> stay();
            case BACK -> comeBack();
            default -> { }
        }${input.motion ? "\n        if (motion != null && motion.lifetime() > 0 && age >= motion.lifetime()) discard();" : ""}
    }

    private void fly() {
        if (spec.path() == ${R.flight}.BOOMERANG) {
            // Its loop, carried along with its thrower as far as the loop has gone, so it comes back to where the thrower is.
            double share = (double) age / total;
            double[] next = ${R.flight}.boomerang(from, aim, age, total);
            for (int axis = 0; axis < 3; axis++) next[axis] += (position(owner, axis) - ownerFrom[axis]) * share;
            sweep(next);
            go(next);
            // At the far end it turns: who it struck going out may be struck again coming back.
            if (age * 2 == total) touched.clear();
            if (age >= total) discard();
            return;
        }
${input.motion ? `        if (!struck && motion != null && motion.strength() > 0 && locked != null && locked.level() == level()) {
            Vec3 nextVelocity = steer(vector(at), vector(velocity), locked, motion.strength(), motion.range());
            velocity = new double[]{nextVelocity.x, nextVelocity.y, nextVelocity.z};
        }
` : ""}        double[] next = {at[0] + velocity[0], at[1] + velocity[1], at[2] + velocity[2]};
        if (spec.path() == ${R.flight}.RETURN) {
            sweep(next);
            go(next);
            if (age >= total) turnBack();
            return;
        }
        // Straight, lobbed or from the sky: it stops at the first block in its way, and strikes the first one it touches before that.
        BlockHitResult wall = level().clip(new ClipContext(vector(at), vector(next), ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, this));
        Vec3 end = wall.getType() == HitResult.Type.MISS ? vector(next) : wall.getLocation();
        ${input.terrainInteractions ? `Optional<Vec3> terrain = StudioTerrain.clip(level(),vector(at),end,4);\n        if (terrain.isPresent()) end=terrain.get();\n        ` : ""}if (!struck) {${input.motion ? `
            if (motion != null && pierced < motion.pierce()) pierce(end);
` : ""}
            LivingEntity first = null;
            Vec3 point = null;
            for (LivingEntity other : victims(new AABB(vector(at), end).inflate(${R.table}.TOUCH + 1.0))) {
                ${input.motion ? "if (motion != null && motion.pierce() > 0 && touched.contains(other.getId())) continue;\n                " : ""}Optional<Vec3> met = other.getBoundingBox().inflate(${R.table}.TOUCH).clip(vector(at), end);
                if (met.isEmpty() && !other.getBoundingBox().inflate(${R.table}.TOUCH).contains(vector(at))) continue;
                Vec3 there = met.orElse(vector(at));
                if (point == null || there.distanceToSqr(vector(at)) < point.distanceToSqr(vector(at))) {
                    first = other;
                    point = there;
                }
            }
            if (first != null) {
                // It strikes there, and then drops at their feet: it lands, and sticks, where it falls.
                strike(point, first);
${input.impact ? "                burst(point);\n" : ""}                struck = true;
                velocity = new double[] {0.0, Math.min(0.0, velocity[1]), 0.0};
                go(new double[] {point.x, point.y, point.z});
                return;
            }
        }
        go(new double[] {end.x, end.y, end.z});${input.terrainInteractions ? "\n        if(terrain.isPresent()) { discard(); return; }" : ""}
        velocity[1] -= struck ? Math.max(spec.gravity(), 0.04) : spec.gravity();
        if (wall.getType() != HitResult.Type.MISS) {${input.motion ? `
            if (!struck && motion != null && bounced < motion.bounces()) {
                bounced++;
                Vec3 normal = Vec3.atLowerCornerOf(wall.getDirection().getNormal());
                Vec3 v = vector(velocity);
                Vec3 reflected = v.subtract(normal.scale(2.0 * v.dot(normal)));
                velocity = new double[]{reflected.x, reflected.y, reflected.z};
                go(new double[]{end.x + normal.x * 0.001, end.y + normal.y * 0.001, end.z + normal.z * 0.001});
                return;
            }
` : ""}
${input.impact ? "            if (!struck) {\n                strike(end, null);\n                burst(end);\n            }\n" : "            if (!struck) strike(end, null);\n"}            struck = true;
            landed = age;
            getEntityData().set(STATE, STUCK);
            if (spec.pin() <= 0 && spec.back() < 0) discard();
            return;
        }
        if (${input.motion ? "(motion == null || motion.lifetime() < 0) && " : ""}age >= ${R.flight}.FLIGHT) {
            if (spec.back() >= 0) turnBack();
            else discard();
        }
    }

${input.motion ? `    private record Contact(LivingEntity victim, Vec3 point) {}
    private void pierce(Vec3 end) {
        Vec3 start = vector(at);
        var hits = new java.util.ArrayList<Contact>();
        for (LivingEntity victim : victims(new AABB(start, end).inflate(${R.table}.TOUCH + 1.0))) {
            AABB box = victim.getBoundingBox().inflate(${R.table}.TOUCH);
            if (box.contains(start)) hits.add(new Contact(victim, start));
            else box.clip(start, end).ifPresent(point -> hits.add(new Contact(victim, point)));
        }
        hits.sort(java.util.Comparator.comparingDouble(hit -> hit.point().distanceToSqr(start)));
        for (Contact hit : hits) {
            if (touched.contains(hit.victim().getId())) continue;
            strike(hit.point(), hit.victim());
            if (++pierced >= motion.pierce()) break;
        }
    }

` : ""}    /** Stuck where it landed: gone when its time is up, or pulled out and flown back once it has stayed and the moment it may come back has come. */
    private void stay() {
        if (spec.back() < 0) {
            if (age >= landed + spec.pin()) discard();
            return;
        }
        if (age >= Math.max(spec.back(), landed + spec.pin())) turnBack();
    }

    private void turnBack() {
        touched.clear();
        backFrom = age;
        getEntityData().set(STATE, BACK);
    }

    /** Back to where it was thrown from, as its thrower stands now: \`speed\` blocks a tick, striking whoever it touches on the way. */
    private void comeBack() {
        double[] to = {owner.getX() + home[0], owner.getY() + home[1], owner.getZ() + home[2]};
        double[] next = ${R.flight}.back(at, to, spec.speed());
        double[] step = {next[0], next[1], next[2]};
        sweep(step);
        go(step);
        if (next[3] > 0.5 || age - backFrom >= ${R.table}.BACK) discard();
    }

    /** What flies through (a loop, a return, the way back) strikes everyone it touches between where it is and \`next\`, each once a way. */
    private void sweep(double[] next) {
        Vec3 start = vector(at);
        Vec3 end = vector(next);
        for (LivingEntity other : victims(new AABB(start, end).inflate(${R.table}.TOUCH + 1.0))) {
            if (touched.contains(other.getId())) continue;
            AABB box = other.getBoundingBox().inflate(${R.table}.TOUCH);
            Optional<Vec3> met = box.clip(start, end);
            if (met.isEmpty() && !box.contains(start)) continue;
            strike(met.orElse(start), other);
        }
    }

    /** Strikes at \`point\`: \`first\` (who it touched; null where it struck the ground) and everyone within its radius, each once a way, pushed away from there. */
    private void strike(Vec3 point, LivingEntity first) {
        List<LivingEntity> found = spec.radius() > 0.0 ? victims(new AABB(point, point).inflate(spec.radius())) : List.of();
        if (first != null) hit(first, point);
        for (LivingEntity other : found) if (other.getBoundingBox().distanceToSqr(point) <= spec.radius() * spec.radius()) hit(other, point);
    }

${
  input.impact
    ? `    /** 落地炸开: what its spec says is seen and felt where it comes down, once, at \`point\` (where it first struck). It changes nothing it does to anybody. */
    private void burst(Vec3 point) {
        ${R.table}.Impact impact = spec.impact();
        if (impact == null || !(level() instanceof ServerLevel world)) return;
${input.impact.effects ? `        // An effect of nobody's: it neither follows its thrower nor ends with it.\n        if (impact.effect() != null) ${EFFECT_RUNTIME.table}.spawn(impact.effect(), world, point, getYRot(), null, null);\n` : ""}        ParticleOptions particle = impact.particle();
${
  input.impact.own
    ? `        if (impact.own() != null) {
            // One of this mod's own: only a type the game has registered can be sent to anybody.
            SimpleParticleType type = ${PARTICLE_RUNTIME.table}.byAsset(impact.own());
            particle = type != null && ${PARTICLE_RUNTIME.table}.registered(type) ? type : null;
        }
`
    : ""
}        if (particle != null) world.sendParticles(particle, point.x, point.y, point.z, impact.count(), impact.spread(), impact.spread(), impact.spread(), 0.02);
${input.impact.cinematic ? `        ${CINEMATIC.server}.send(world, point, impact.camera());\n        ${CINEMATIC.server}.send(world, point, impact.skyTint());\n` : ""}${input.impact.shake ? `        if (impact.strength() > 0.0f) ${BOSS_RUNTIME.shake}.send(world, point, impact.strength(), impact.radius(), impact.ticks());\n` : ""}${input.impact.ground ? `        // 第 4 步: what it leaves on the ground there, its owner's, at its damage's scale.\n        if (impact.ground() != null) for (${GROUND_FX_RUNTIME.spec} fx : impact.ground()) ${GROUND_FX_RUNTIME.entity}.start(world, fx, point, getYRot(), owner, null, scale, null);\n` : ""}    }

`
    : ""
}    private void hit(LivingEntity victim, Vec3 point) {
        if (!touched.add(victim.getId())) return;
        DamageSource source = damageSources().mobProjectile(this, owner);
        ${input.once ? "boolean repeat = once != null && once.seen(victim);\n        if (repeat && once.skipEffects()) return;\n        " : ""}if (${input.once ? "!repeat && " : ""}spec.damage() > 0.0f && !victim.hurt(source, spec.damage() * scale)) return;${input.once ? "\n        if (once != null) once.mark(victim);" : ""}
        if (spec.knockback() > 0.0) {
            double dx = point.x - victim.getX();
            double dz = point.z - victim.getZ();
            if (dx * dx + dz * dz < 1.0e-4) {
                dx = -velocity[0];
                dz = -velocity[2];
            }
            if (dx * dx + dz * dz < 1.0e-8) dx = 1.0e-3;
            victim.knockback(spec.knockback(), dx, dz);
        }
        int[] effects = spec.effects();
        for (int index = 0; index + 2 < effects.length; index += 3) {
            victim.addEffect(new MobEffectInstance(switch (effects[index]) {
                case 1 -> MobEffects.BLINDNESS;
                case 2 -> MobEffects.POISON;
                case 3 -> MobEffects.WEAKNESS;
                default -> MobEffects.MOVEMENT_SLOWDOWN;
            }, effects[index + 1], ${input.hiddenEffects ? "effects[index + 2] < 0 ? ~effects[index + 2] : effects[index + 2], false, effects[index + 2] >= 0, true" : "effects[index + 2]"}), owner);
        }
    }

    /** Who it may strike: every living thing but its thrower and its thrower's kind, the spectators and the players in creative. */
    private List<LivingEntity> victims(AABB box) {
        return level().getEntitiesOfClass(LivingEntity.class, box, other -> other != owner && other.isAlive() && other.getType() != owner.getType() && !other.isSpectator()
            && !(other instanceof Player player && player.isCreative()));
    }

    /** Moves to \`next\`, facing the way it went. */
    private void go(double[] next) {
        face(next[0] - at[0], next[1] - at[1], next[2] - at[2]);
        at = next;
        setPos(next[0], next[1], next[2]);
    }

    private void face(double dx, double dy, double dz) {
        double flat = Math.sqrt(dx * dx + dz * dz);
        if (flat * flat + dy * dy < 1.0e-8) return;
        setYRot((float) (Math.atan2(dz, dx) * 180.0 / Math.PI) - 90.0f);
        setXRot((float) (-Math.atan2(dy, flat) * 180.0 / Math.PI));
    }

    private static double position(Entity entity, int axis) { return axis == 0 ? entity.getX() : axis == 1 ? entity.getY() : entity.getZ(); }
    private static Vec3 vector(double[] point) { return new Vec3(point[0], point[1], point[2]); }

    /** However it ends (it is home, its time is up, its thrower is gone, the chunk is unloaded): a part of its thrower is shown again, and a warning still waiting is taken back. */
    @Override public void remove(Entity.RemovalReason reason) {
        if (!level().isClientSide() && spec != null && owner != null) {
            if (spec.bone() != null && owner.isAlive() && owner instanceof ${R.table}.${R.thrower} thrower) thrower.studioThrown(spec.bone(), false);
${input.warned ? `            if (warned != null && state() == WAITING && level() instanceof ServerLevel world) ${ABILITY_WARN.server}.clear(world, owner.getId(), warned);\n` : ""}        }
        super.remove(reason);
    }

    // Never written to disk: a chunk that unloads, or a world that is left, takes it away for good.
    @Override public boolean shouldBeSaved() { return false; }
    @Override protected void readAdditionalSaveData(CompoundTag nbt) {}
    @Override protected void addAdditionalSaveData(CompoundTag nbt) {}

    @Override public boolean hurt(DamageSource source, float amount) { return false; }
    @Override public boolean isAttackable() { return false; }
    @Override public boolean isPickable() { return false; }
    @Override public boolean canBeCollidedWith() { return false; }
    @Override public boolean isPushable() { return false; }
    @Override public boolean isPushedByFluid() { return false; }
    @Override public boolean isIgnoringBlockTriggers() { return true; }
    @Override public boolean canUsePortal(boolean allowVehicles) { return false; }
    @Override public boolean ignoreExplosion(Explosion explosion) { return true; }
    @Override public boolean displayFireAnimation() { return false; }
    @Override public PushReaction getPistonPushReaction() { return PushReaction.IGNORE; }
    @Override public boolean shouldRenderAtSqrDistance(double distance) { return distance < 16384.0; }

    @Override public void registerControllers(AnimatableManager.ControllerRegistrar controllers) {
${
  input.effects
    ? `        // An effect's look plays the effect's own motion; a part of its thrower holds still.
        controllers.add(new AnimationController<>(this, "look", 0, state -> effect() < 0 ? PlayState.STOP : state.setAndContinue(${EFFECT_RUNTIME.table}.CLIPS[Math.min(effect(), ${EFFECT_RUNTIME.table}.CLIPS.length - 1)])));`
    : `        // A part of its thrower holds still: nothing plays.
        controllers.add(new AnimationController<>(this, "look", 0, state -> PlayState.STOP));`
}
    }

    @Override public AnimatableInstanceCache getAnimatableInstanceCache() { return animations; }
}
`,
    [`${source}/client/${R.client}.java`]: facade
      ? `package ${input.packageName}.client;

import ${input.packageName}.entity.${R.table};
import ${input.packageName}.${PLATFORM_PACKAGE}.${CLIENT_PLATFORM_CLASS};

/** Generated by MineMods Studio: draws the things this mod's creatures throw (${target.manifest.id}). The mod's client entry runs this once. */
public final class ${R.client} {
    public static void register() {
        ${CLIENT_PLATFORM_CLASS}.renderer(${R.table}.TYPE, ${R.renderer}::new);
    }
}
`
      : `package ${input.packageName}.client;

import ${input.packageName}.entity.${R.table};
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;

/** Generated by MineMods Studio: draws the things this mod's creatures throw. */
public final class ${R.client} implements ClientModInitializer {
    @Override public void onInitializeClient() {
        EntityRendererRegistry.register(${R.table}.TYPE, ${R.renderer}::new);
    }
}
`,
    [`${source}/client/${R.renderer}.java`]: `package ${input.packageName}.client;

import ${input.packageName}.entity.${R.entity};
import ${input.packageName}.entity.${R.table};
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.math.Axis;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.renderer.MultiBufferSource;
${input.additive ? `import net.minecraft.client.renderer.RenderType;
import ${input.packageName}.entity.${EFFECT_RUNTIME.table};
` : ""}import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.Mth;
import software.bernie.geckolib.cache.object.BakedGeoModel;
import software.bernie.geckolib.cache.object.GeoBone;
import software.bernie.geckolib.cache.object.GeoCube;
import software.bernie.geckolib.cache.object.GeoQuad;
import software.bernie.geckolib.cache.object.GeoVertex;
import software.bernie.geckolib.model.GeoModel;
import software.bernie.geckolib.renderer.GeoEntityRenderer;

/**
 * Draws a thrown thing: an effect's model as the effect is, or its thrower's model with every part hidden but the one thrown (and the parts under it), moved so the middle of that part is
 * where the thing is. Turned along its flight; a loop and a return spin. The model's parts are shared with its thrower's renderer, so what is hidden here is put back as it was after.
 */
public final class ${R.renderer} extends GeoEntityRenderer<${R.entity}> {
    // While one thing is drawn: each part's own flags as they were, to be put back, and the middle of the part thrown (blocks, the model's own axes).
    private final List<Object[]> kept = new ArrayList<>();
    private float middleX;
    private float middleY;
    private float middleZ;

    public ${R.renderer}(EntityRendererProvider.Context context) {
        super(context, new GeoModel<${R.entity}>() {
            @Override public ResourceLocation getModelResource(${R.entity} thrown) {
                return ResourceLocation.fromNamespaceAndPath(${R.table}.MOD_ID, "geo/" + thrown.model() + ".geo.json");
            }
            @Override public ResourceLocation getTextureResource(${R.entity} thrown) {
                return ResourceLocation.fromNamespaceAndPath(${R.table}.MOD_ID, "textures/entity/" + thrown.model() + ".png");
            }
            @Override public ResourceLocation getAnimationResource(${R.entity} thrown) {
                return ResourceLocation.fromNamespaceAndPath(${R.table}.MOD_ID, "animations/" + thrown.model() + ".animation.json");
            }
        });
        this.shadowRadius = 0.0f;
    }

${
  input.additive
    ? `    // 第 4 步: one that looks like an effect drawn added to what is behind it is drawn so too.
    @Override public RenderType getRenderType(${R.entity} thrown, ResourceLocation texture, MultiBufferSource bufferSource, float partialTick) {
        return thrown.bone().isEmpty() && ${EFFECT_RUNTIME.table}.additive(thrown.model()) ? RenderType.eyes(texture) : super.getRenderType(thrown, texture, bufferSource, partialTick);
    }

`
    : ""
}    // Not drawn while it waits in the sky, nor before its look has reached this player's game.
    @Override public void render(${R.entity} thrown, float entityYaw, float partialTick, PoseStack poseStack, MultiBufferSource bufferSource, int packedLight) {
        if (thrown.state() == ${R.entity}.WAITING || thrown.model().isEmpty()) return;
        super.render(thrown, entityYaw, partialTick, poseStack, bufferSource, packedLight);
    }

    @Override public void preRender(PoseStack poseStack, ${R.entity} thrown, BakedGeoModel model, MultiBufferSource bufferSource, VertexConsumer buffer, boolean isReRender, float partialTick, int packedLight, int packedOverlay, ${colour.params}) {
        super.preRender(poseStack, thrown, model, bufferSource, buffer, isReRender, partialTick, packedLight, packedOverlay, ${colour.args});
        // A layer drawn over it again (isReRender) keeps what the first pass set.
        if (isReRender) return;
        middleX = 0.0f;
        middleY = 0.0f;
        middleZ = 0.0f;
        if (thrown.bone().isEmpty()) return;
        kept.clear();
        for (GeoBone top : model.topLevelBones()) hideAll(top);
        model.getBone(thrown.bone()).ifPresent(bone -> {
            showAll(bone);
            // The middle of the part's own cubes, as GeckoLib holds them (blocks): what is put where the thing is.
            double x = 0.0;
            double y = 0.0;
            double z = 0.0;
            int count = 0;
            for (GeoCube cube : bone.getCubes()) for (GeoQuad quad : cube.quads()) for (GeoVertex vertex : quad.vertices()) {
                x += vertex.position().x();
                y += vertex.position().y();
                z += vertex.position().z();
                count++;
            }
            if (count > 0) {
                middleX = (float) (x / count);
                middleY = (float) (y / count);
                middleZ = (float) (z / count);
            }
        });
    }

    @Override public void renderFinal(PoseStack poseStack, ${R.entity} thrown, BakedGeoModel model, MultiBufferSource bufferSource, VertexConsumer buffer, float partialTick, int packedLight, int packedOverlay, ${colour.params}) {
        super.renderFinal(poseStack, thrown, model, bufferSource, buffer, partialTick, packedLight, packedOverlay, ${colour.args});
        // Every part as its thrower's renderer left it.
        for (Object[] entry : kept) {
            GeoBone bone = (GeoBone) entry[0];
            bone.setHidden((Boolean) entry[1]);
            bone.setChildrenHidden((Boolean) entry[2]);
        }
        kept.clear();
    }

    private void hideAll(GeoBone bone) {
        kept.add(new Object[] {bone, bone.isHidden(), bone.isHidingChildren()});
        bone.setHidden(true);
        bone.setChildrenHidden(false);
        for (GeoBone child : bone.getChildBones()) hideAll(child);
    }

    private void showAll(GeoBone bone) {
        bone.setHidden(false);
        bone.setChildrenHidden(false);
        for (GeoBone child : bone.getChildBones()) showAll(child);
    }

    // Turned along its flight (its front is the model's -Z, as its thrower's is), spinning when it loops or comes back, as large as its thrower, its part's middle where it is.
    @Override protected void applyRotations(${R.entity} thrown, PoseStack matrices, float ageInTicks, float rotationYaw, float partialTick, float nativeScale) {
        float yaw = Mth.rotLerp(partialTick, thrown.yRotO, thrown.getYRot());
        float pitch = Mth.lerp(partialTick, thrown.xRotO, thrown.getXRot());
        matrices.mulPose(Axis.YP.rotationDegrees(180.0f - yaw));
        matrices.mulPose(Axis.XP.rotationDegrees(-pitch));
        if (thrown.spins() && thrown.state() != ${R.entity}.STUCK) matrices.mulPose(Axis.YP.rotationDegrees(ageInTicks * ${real((360 * 2) / TICKS)}f));
        float size = thrown.size();
        matrices.scale(size, size, size);
        matrices.translate(-middleX, -middleY, -middleZ);
    }
}
`,
  }
  if (facade) {
    const entity = `${source}/entity/${R.entity}.java`
    const renderer = `${source}/client/${R.renderer}.java`
    files[entity] = version.body.plainEntity(files[entity]!)
    files[renderer] = version.body.rotations(files[renderer]!)
    for (const [name, text] of Object.entries(files)) if (name.endsWith(".java")) files[name] = version.rewriteJava(text)
  }
  return {
    files,
    language: { zh_cn: { [`entity.${input.modId}.${R.registry}`]: "投射物" }, en_us: { [`entity.${input.modId}.${R.registry}`]: "Projectile" } },
    /** Paths inside the built jar that prove the thrown things went in. */
    classes: [`${input.packageName.replaceAll(".", "/")}/entity/${R.table}.class`, `${input.packageName.replaceAll(".", "/")}/entity/${R.entity}.class`, `${input.packageName.replaceAll(".", "/")}/entity/${R.flight}.class`],
    /** Fabric: the two classes start with the mod (fabric.mod.json's entry points). A facade target has none: its entries run them (`entries`). */
    patch: (facade
      ? {}
      : {
          "src/main/resources/fabric.mod.json": (text: string) => {
            const metadata = z.record(z.string(), z.unknown()).parse(JSON.parse(text))
            const entrypoints = z.looseObject({ main: z.array(z.string()), client: z.array(z.string()).default([]) }).parse(metadata.entrypoints)
            const edited = `${JSON.stringify({ ...metadata, entrypoints: { ...entrypoints, main: [...entrypoints.main, `${input.packageName}.entity.${R.table}`], client: [...entrypoints.client, `${input.packageName}.client.${R.client}`] } }, null, 2)}\n`
            return text.includes("\r\n") ? edited.replaceAll("\n", "\r\n") : edited
          },
        }) as Record<string, (text: string) => string>,
    entries: facade ? { common: [`${input.packageName}.entity.${R.table}`], client: [`${input.packageName}.client.${R.client}`] } : { common: [] as string[], client: [] as string[] },
  }
}
