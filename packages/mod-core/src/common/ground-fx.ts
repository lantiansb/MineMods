import { onceRef } from "../once-group"
import { shapeRaster } from "@minemods/studio-ai/particle-shapes"
import { resolvedAsset } from "../particle-emission"
import { z } from "zod"
import { terrainSource, terrainPartSource } from "./terrain"
import { ABILITY_EFFECT_IDS, TICKS } from "../ability-words"
import { FlashEventSchema, flashTexture, type FlashEvent, GROUND_FX_KINDS, GROUND_FX_LIMITS, groundFxEvents, groundFxLife, type GroundFx, type GroundFxEvent } from "../ground-fx"
import type { GenTarget } from "../platform/adapter"
import { CLIENT_PLATFORM_CLASS, PLATFORM_CLASS, PLATFORM_PACKAGE } from "../platform/facade"
import { FABRIC_TARGET } from "../platform/target"
import { encodePng } from "../png"
import { hitElsewhere, type Ability } from "../entity-runtime"
import { bonePlace } from "../creature-abilities"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { MotionClip } from "@minemods/studio-ai/model-motion"
import { PARTICLE_RUNTIME } from "./particles"

/**
 * 第 4 步 (效果和表现) as what it adds to a generated mod, the same on every loader: ground hazards, cracks, shockwave rings and beams (ground-fx.ts) as one entity type of its own
 * (`studio_fx`) that is never saved and that every player's game draws as a mesh in the world — not a model. A creature's ability (or a thrown thing where it comes down) makes one
 * with what it is (`StudioFxSpec`, a record the creature's class lists as its `ABILITY_GROUND`), and the server runs it: a hazard hurts whoever stands in it every few ticks and sends
 * up its particles, a shockwave strikes once whoever its ring passes, a beam follows the creature and its aim and strikes whoever it touches; it is gone when its time is up (a beam
 * also when the ability that made it is over or cut short, or its creature is gone). What a player's game is told of one is six synced values: its kind (and whether it glows), its
 * colour, its sizes, its times, the game time it was put down at (its age is counted from it, the same on the server and in every game) and, for a beam, where it ends.
 *
 * Drawn by `StudioFxRenderer`, an entity renderer of the game's own kind: flat quads on the ground (a soft disc and its rim for a hazard, a crack picture for a crack, a band for the
 * ring with a wall above it) and a band facing the camera for a beam, with the mod's own four small pictures (`textures/fx/`). What glows is drawn on the game's `eyes` layer (added
 * to what is behind it, at full brightness); what does not on its translucent entity layer, lit by the world.
 *
 * The one difference between Minecrafts is how a vertex is written (`minecraft`): `addVertex(...).setColor(...)` from 1.21, `vertex(...).color(...)...endVertex()` in 1.20.1; the
 * rest names only the game (and, on Fabric, Fabric API's registries; on a facade target `StudioPlatform`), mapped to the target's version by its adapter.
 */

const Input = z.strictObject({
  modId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  /** Some hazard puts up a particle of the project's own (`StudioParticles` is then in the mod). */
  own: z.boolean().default(false),
  terrain: z.boolean().default(false),
  terrainInteractions:z.boolean().default(false),
  terrainMaterial: z.boolean().default(false),
  pointed: z.boolean().default(false),
  terrainDust: z.boolean().default(false),
  muteDust: z.boolean().optional(),
  hiddenEffects:z.boolean().default(false),
  sweep: z.boolean().default(false),
  castBeam: z.boolean().default(false),
  once: z.boolean().default(false),
  hitHeight: z.boolean().default(false),
  flashes: z.array(FlashEventSchema).default([]),
  hazards: z.boolean().default(false),
})

/** The classes the creatures and the thrown things reach it through, and the name of its entity type. */
export const GROUND_FX_RUNTIME = { registry: "studio_fx", entity: "StudioFx", spec: "StudioFxSpec", types: "StudioFxTypes", client: "StudioFxClient", renderer: "StudioFxRenderer" } as const

const R = GROUND_FX_RUNTIME
const real = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(4))))
const single = (value: number) => `${real(value)}f`
const EFFECT_NUMBERS: Record<(typeof ABILITY_EFFECT_IDS)[number], number> = { slowness: 0, blindness: 1, poison: 2, weakness: 3 }

/** Where a beam starts, in the creature's own terms (blocks, at the size its model is built): its part's middle (when it names one) and its own offsets. */
export type BeamStart = { forward: number; up: number; left: number }

/**
 * Where each beam of these abilities starts (per ability, per event; null for every other event): the middle of its part as the ability's own motion holds it at the beam's start
 * (`bonePlace`, what a hit that names a part counts from), plus its own offsets; its offsets alone when it names no part or the model cannot say. Null when none of them has a beam.
 */
export function groundFxStarts(abilities: readonly Ability[], design: Pick<ModelDesign, "bones" | "animations">): (BeamStart | null)[][] | null {
  if (!abilities.some((ability) => ability.events.some((event) => event.type === "beam"))) return null
  return abilities.map((ability) =>
    ability.events.map((event) => {
      if (event.type !== "beam") return null
      const clip = design.animations.find((animation) => animation.name === ability.clip) as MotionClip | undefined
      const place = event.bone !== undefined && clip ? bonePlace(design, event.bone, clip, Math.min(event.at, clip.length)) : null
      return { forward: (place?.forward ?? 0) + event.forward, up: (place?.up ?? 0) + event.up, left: (place?.left ?? 0) + event.left }
    }),
  )
}

/**
 * One of the four as the Java record its creature's class lists: its kind, its life, the ticks it grows in and fades out over, its four sizes (hazard: radius; crack: radius;
 * shockwave: from, to, width, height; beam: width, length), its colour as 0xRRGGBB and whether it glows, what it does to whom (damage, knockback, every how many ticks, everyone or
 * the target alone, ticks of fire, status effects as (kind, ticks, amplifier) triples), the particle a hazard puts up (a vanilla one by its name, or one of the mod's own by its
 * asset id) and how many, and for a beam where it starts and how it aims. `start`: a beam's start (`BeamStart`); left out, its own offsets from its feet.
 */
export function groundFxSpec(fx: GroundFx, start?: BeamStart | null) {
  const life = groundFxLife(fx)
  const grow = fx.type === "hazard" ? Math.min(10, Math.floor(life / 4)) : fx.type === "crack" ? Math.round(fx.grow_seconds * TICKS) : fx.type === "shockwave" || fx.type === "flash" ? 0 : Math.min(4, Math.floor(life / 4))
  const fade = fx.type === "shockwave" || fx.type === "flash" ? life : fx.type === "beam" ? Math.min(Math.round(GROUND_FX_LIMITS.beam.fade * TICKS), Math.max(1, Math.floor(life / 4))) : Math.max(1, Math.min(20, Math.floor(life / 3)))
  const sizes = fx.type === "flash" ? [fx.radius, fx.grow, fx.tilt, fx.shape === "arc" ? fx.arc ?? 140 : fx.shape === "ring" ? -1 : 0] : fx.type === "hazard" ? [fx.radius, fx.growth?.per_second ?? 0, fx.growth?.per_hit ?? 0, fx.growth?.max_radius ?? 0] : fx.type === "crack" ? [fx.radius, 0, 0, 0] : fx.type === "shockwave" ? [fx.from_radius, fx.to_radius, fx.width, fx.height] : [fx.width, fx.length, 0, 0]
  const strikes = fx.type !== "crack" && fx.type !== "flash"
  const effects = strikes ? fx.effects.flatMap((effect) => [EFFECT_NUMBERS[effect.effect], effect.duration_ticks, effect.particles === false ? ~effect.amplifier : effect.amplifier]) : []
  const particle = fx.type === "hazard" ? fx.particle : undefined
  const from = fx.type === "beam" ? (start ?? { forward: fx.forward, up: fx.up, left: fx.left }) : { forward: 0, up: 0, left: 0 }
  const args = [
    GROUND_FX_KINDS[fx.type],
    life,
    grow,
    fade,
    ...sizes.map(single),
    `0x${fx.color.slice(1).toLowerCase()}`,
    fx.type === "beam" || fx.type === "flash" ? true : fx.glow,
    single(strikes ? fx.damage : 0),
    real(fx.type === "shockwave" ? fx.knockback : 0),
    fx.type === "hazard" || fx.type === "beam" ? fx.every_ticks : 0,
    strikes ? fx.hits === "everyone" : false,
    fx.type === "hazard" ? Math.round((fx.burn_seconds ?? 0) * TICKS) : 0,
    `new int[] {${effects.join(", ")}}`,
    typeof particle === "string" ? JSON.stringify(particle) : "null",
    particle !== undefined && typeof particle !== "string" ? JSON.stringify(resolvedAsset(particle)) : "null",
    fx.type === "hazard" && particle !== undefined ? (fx.count ?? 4) : 0,
    single(from.forward),
    single(from.up),
    single(from.left),
    fx.type === "beam" ? fx.aim === "ahead" : fx.type === "hazard" && fx.shape === "square",
    single(fx.type === "beam" ? (fx.sweep ? -fx.sweep.blocks_per_second : fx.turn ?? 0) : 0),
    ...(fx.type === "shockwave" && fx.hit_height !== undefined ? [single(fx.hit_height)] : []),
  ]
  const made = `new ${R.spec}(${args.join(", ")})`
  return fx.type === "shockwave" && fx.pop_blocks ? `StudioTerrain.popSpec(${made}, ${fx.pop_blocks.height}, ${fx.pop_blocks.every}, ${fx.pop_blocks.max})` : made
}

/**
 * What a creature's class carries for its abilities' ground effects and beams: the list of their specs (in the order of its abilities and their events), the statement each runs
 * at its moment (`statement`, handed the place it is counted from: `eventOrigin` of the creature's abilities) and the one method they call. All empty for a creature with none, so its
 * class is what it always was. `starts`: per ability, per event, where a beam starts (`groundFxStarts`); `scale`: the expression its damage is multiplied by (a boss's phase, a combo).
 */
export function groundFxJava(abilities: readonly Ability[], starts: readonly (readonly (BeamStart | null)[])[] | undefined, scale: string) {
  const found = abilities.flatMap((ability, index) => groundFxEvents(ability).map((event) => ({ ability: index, ...event })))
  if (!found.length) return { fields: "", methods: "", statement: (_ability: number, _event: number, _origin: string): string => { throw new Error("NO_GROUND_FX") } }
  const lockedHit = (a:number, e:GroundFxEvent) => {
    if (e.type === "beam" || e.where !== "hit" || e.hit == null) return null
    const hit = abilities[a]?.hits[e.hit]
    return hit?.type === "area" && hitElsewhere(hit) ? e.hit : null
  }
  const locked = found.some(v=>lockedHit(v.ability,v.event)!==null)
  const phased = found.some(v => v.event.type === "beam" && v.event.sweep?.phase_scales)
  const grouped = found.some(v => "once_group" in v.event && !!v.event.once_group)
  const number = (ability: number, event: number) => found.findIndex((value) => value.ability === ability && value.index === event)
  return {
    fields: `    // 第 4 步: its ground hazards, cracks, shockwaves and beams (${R.entity}), in the order of its abilities and their events.
    private static final ${R.spec}[] ABILITY_GROUND = {
${found.map((value) => `        ${groundFxSpec(value.event, starts?.[value.ability]?.[value.index] ?? null)},`).join("\n")}
    };
`,
    methods: `    /**
     * 第 4 步: puts down one of its ground effects (or starts a beam) at a place counted from \`origin\`: \`forward\` and \`left\` of it in its own terms. Its damage is its own times the
     * phase and the combo; a beam ends when this run of the ability is over (done, cut short, or another started): it is keyed to the run (its number and the count of starts),
     * not to the clip that shows, so a stage of the ability switching to its own motion does not end it.
     */
    private void abilityGround(${R.spec} spec, Vec3 origin, double forward, double left${locked ? ", float originYaw, boolean locked" : ""}${phased ? ", float sweepScale" : ""}${grouped ? ", StudioOnce.Group... group" : ""}) {
        float turn = ${locked ? "originYaw" : "abilityYaw"} * 0.017453292f;
        ${locked || grouped || phased ? "var fx = " : ""}${R.entity}.start(level(), spec, origin.add(-forward * Mth.sin(turn) + left * Mth.cos(turn), 0.0, forward * Mth.cos(turn) + left * Mth.sin(turn)), ${locked ? "originYaw" : "abilityYaw"}, this, abilityTarget, ${scale}, () -> abilityIndex < 0 ? -1 : (abilitySerial << 8) | abilityIndex);${locked ? "\n        if (locked && fx != null) fx.setPos(fx.getX(),origin.y,fx.getZ());" : ""}${phased ? "\n        if (fx != null) fx.sweepScale = sweepScale;" : ""}${grouped ? "\n        if (fx != null && group.length > 0) fx.once = group[0];" : ""}
    }

`,
    statement: (ability: number, event: number, origin: string, fixed = false) => {
      const at = number(ability, event)
      const value = found[at]!
      const scales = value.event.type === "beam" ? value.event.sweep?.phase_scales : null
      const slot = lockedHit(ability,value.event)
      const pose = !locked ? "" : slot === null ? ", abilityYaw, false" : `, abilityPlaceYaw[${slot}], true`
      const phase = !phased ? "" : scales ? `, switch(bossPhase()) { ${scales.map((n,i)=>`case ${i} -> ${single(n)};`).join(" ")} default -> 1f; }` : ", 1f"
      const group = "once_group" in value.event ? onceRef(value.event) : null
      return value.event.type === "beam" ? `abilityGround(ABILITY_GROUND[${at}], position(), 0.0, 0.0${pose}${phase});` : `abilityGround(ABILITY_GROUND[${at}], ${origin}, ${real(fixed ? 0 : value.event.forward)}, ${real(fixed ? 0 : value.event.left)}${pose}${phase}${group ? ", " + group : ""});`
    },
  }
}

// ---- the pictures it draws with ----

/** A picture `size` pixels a side whose every pixel is `paint(x, y)` (0 to 1 from the middle and the edge), written as a PNG: `rgb` white with that alpha, or that brightness with it (added). */
function picture(size: number, paint: (x: number, y: number) => number, added: boolean) {
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const value = Math.max(0, Math.min(1, paint(x, y)))
      const byte = Math.round(value * 255)
      pixels.set([added ? byte : 255, added ? byte : 255, added ? byte : 255, byte], (y * size + x) * 4)
    }
  return encodePng(pixels, size, size)
}

/** The soft disc: whole in the middle, nothing at the edge of the picture, falling off smoothly. */
const soft = (x: number, y: number, size: number) => {
  const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2)
  return d >= 1 ? 0 : (1 - d * d) ** 2
}

/** The crack: seven jagged branches out from the middle, each with a twig, thinner toward their ends (the same every build). */
function crackStrength(size: number) {
  const field = new Float32Array(size * size)
  let seed = 20261116
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const stroke = (x0: number, y0: number, x1: number, y1: number, width: number) => {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - width - 1))
    const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1) + width + 1))
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - width - 1))
    const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1) + width + 1))
    const dx = x1 - x0
    const dy = y1 - y0
    const length = dx * dx + dy * dy || 1
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const t = Math.max(0, Math.min(1, ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / length))
        const d = Math.hypot(x + 0.5 - (x0 + t * dx), y + 0.5 - (y0 + t * dy))
        const value = Math.max(0, Math.min(1, width - d + 0.5))
        field[y * size + x] = Math.max(field[y * size + x]!, value)
      }
  }
  const middle = size / 2
  const branch = (x: number, y: number, angle: number, reach: number, width: number, depth: number) => {
    const steps = 6
    for (let step = 0; step < steps; step++) {
      angle += (random() - 0.5) * 0.8
      const nx = x + (reach / steps) * Math.cos(angle)
      const ny = y + (reach / steps) * Math.sin(angle)
      const w = width * (1 - step / (steps + 1))
      stroke(x, y, nx, ny, w)
      if (depth > 0 && step === 2) branch(nx, ny, angle + (random() < 0.5 ? -1 : 1) * (0.5 + random() * 0.5), reach * 0.4, w * 0.7, depth - 1)
      x = nx
      y = ny
    }
  }
  for (let index = 0; index < 7; index++) branch(middle, middle, (index * 2 * Math.PI) / 7 + random() * 0.6, middle * (0.75 + random() * 0.2), size / 48, 1)
  return (x: number, y: number) => field[y * size + x]!
}

/** The four pictures, at their paths under the mod's assets: the soft disc and the crack, each white with its strength as alpha and as its own brightness (for the glowing layer). */
export function groundFxTextures(modId: string, flashes: readonly FlashEvent[] = []) {
  const size = 64
  const crackSize = 256
  const crack = crackStrength(crackSize)
  const at = (name: string) => `src/main/resources/assets/${modId}/textures/fx/${name}.png`
  return {
    ...Object.fromEntries([...new Map(flashes.map(f => [flashTexture(f), f])).entries()].map(([key, f]) => {
      const raster = shapeRaster(f.shape === "arc" ? {shape: "arc", angle: f.arc} : {shape: f.shape}, 64)
      return [at(key), encodePng(Uint8Array.from(raster.pixels), 64, 64)]
    })),
    [at("soft")]: picture(size, (x, y) => soft(x, y, size), false),
    [at("soft_glow")]: picture(size, (x, y) => soft(x, y, size), true),
    [at("crack")]: picture(crackSize, crack, false),
    [at("crack_glow")]: picture(crackSize, crack, true),
  } as Record<string, Uint8Array>
}

// ---- the classes ----

function specSource(packageName: string, hitHeight: boolean) {
  const fields = `int kind, int life, int grow, int fade, float a, float b, float c, float d, int color, boolean glow, float damage, double knockback, int every, boolean everyone,
                         int burn, int[] effects, String particle, String own, int count, float forward, float up, float left, boolean ahead, float turn`
  return `package ${packageName}.entity;

/**
 * Generated by MineMods Studio (第 4 步): what one ground hazard, crack, shockwave or beam is (${R.entity}). \`kind\`: 0 hazard, 1 crack, 2 shockwave, 3 beam. \`life\`, \`grow\`, \`fade\`: ticks it
 * lasts, grows in and fades out over. \`a\`..\`d\`: its sizes in blocks (hazard and crack: radius; shockwave: from, to, width, height; beam: width, length). \`color\`: 0xRRGGBB; \`glow\`: drawn
 * glowing. \`damage\`, \`knockback\`, \`every\` (ticks between two strikes), \`everyone\` (else only the target), \`burn\` (ticks of fire), \`effects\` (kind, ticks, amplifier each: 0 slowness,
 * 1 blindness, 2 poison, 3 weakness). \`particle\` (a vanilla particle's name) or \`own\` (the asset id of one of the mod's own), \`count\` of them every pulse. A beam starts \`forward\`, \`up\`,
 * \`left\` of its creature's feet in its own terms (its size scales them) and aims \`ahead\` the way it faces, or at its target turning at most \`turn\` degrees a tick.
 */
public record ${R.spec}(${fields}${hitHeight ? ", float hitHeight" : ""}) {${hitHeight ? `
    public ${R.spec}(${fields}) {
        this(kind, life, grow, fade, a, b, c, d, color, glow, damage, knockback, every, everyone, burn, effects, particle, own, count, forward, up, left, ahead, turn, 2.0f);
    }
` : ""}
}
`
}

function entitySource(packageName: string, facade: boolean, own: boolean, hitHeight: boolean, hazards: boolean, flashes: boolean, hiddenEffects: boolean, once: boolean, sweep: boolean, terrainInteractions: boolean, castBeam: boolean) {
  return `package ${packageName}.entity;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.IntSupplier;
import net.minecraft.core.particles.ParticleOptions;
import net.minecraft.core.particles.ParticleType;
import net.minecraft.core.particles.SimpleParticleType;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.Mth;
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
import org.joml.Vector3f;

/**
 * Generated by MineMods Studio (第 4 步): one ground hazard, crack, shockwave ring or beam in the world. It is looked at and, as its spec says, hurts: it cannot be hit, pushed, saved or
 * walked into. The server runs it and tells every player's game six values (its kind and glow, colour, sizes, times, when it was put down, and where a beam ends); ${R.renderer} draws it from them.
 */
public class ${R.entity} extends Entity {
    public static final int HAZARD = ${GROUND_FX_KINDS.hazard};
    public static final int CRACK = ${GROUND_FX_KINDS.crack};
    public static final int SHOCKWAVE = ${GROUND_FX_KINDS.shockwave};
    public static final int BEAM = ${GROUND_FX_KINDS.beam};
    /** The most that exist in the whole world at once; more are not made. */
    private static final int ALIVE = ${GROUND_FX_LIMITS.alive};
    /** Blocks under its place the ground is looked for. */
    private static final double FALL = ${real(GROUND_FX_LIMITS.fall)};
    /** Ticks between two puffs of a hazard's particles. */
    private static final int PULSE = ${GROUND_FX_LIMITS.hazard.pulse};
    /** Ticks the game spares a body after a blow pushes it (half of its \`invulnerableTime\`): the most often one of these pushes the one it strikes the way the game's own blow does. */
    private static final int SPARED = 10;
    private static final List<${R.entity}> LIVE = new ArrayList<>();

    // Its kind (low four bits) and whether it glows (16).
    private static final EntityDataAccessor<Integer> KIND = SynchedEntityData.defineId(${R.entity}.class, EntityDataSerializers.INT);
    private static final EntityDataAccessor<Integer> COLOR = SynchedEntityData.defineId(${R.entity}.class, EntityDataSerializers.INT);
    // Its sizes: a, b, c of its spec; and d (a shockwave's wall) with its turn as it was put down (degrees) and a number its picture is laid by.
    private static final EntityDataAccessor<Vector3f> SIZE = SynchedEntityData.defineId(${R.entity}.class, EntityDataSerializers.VECTOR3);
    private static final EntityDataAccessor<Vector3f> MORE = SynchedEntityData.defineId(${R.entity}.class, EntityDataSerializers.VECTOR3);
    // Ticks it lasts, grows in and fades out over.
    private static final EntityDataAccessor<Vector3f> TIME = SynchedEntityData.defineId(${R.entity}.class, EntityDataSerializers.VECTOR3);
    // Where a beam ends, in the world.
    private static final EntityDataAccessor<Vector3f> END = SynchedEntityData.defineId(${R.entity}.class, EntityDataSerializers.VECTOR3);
    // The world's game time (its low 32 bits) it was put down at: its age is counted from it, on the server and in every player's game, whenever that game began to see it.
    private static final EntityDataAccessor<Integer> BORN = SynchedEntityData.defineId(${R.entity}.class, EntityDataSerializers.INT);

    private ${R.spec} spec;
    private Entity owner;${castBeam ? "\n    private Vec3 fixedBeam;\n    private float fixedYaw;" : ""}
    private LivingEntity target;
    private float scale = 1.0f;
    private IntSupplier cast;
    private int castAt;
    private Vec3 aim = new Vec3(0.0, 0.0, 1.0);
    private final Set<Integer> struck = new HashSet<>();
    // Per one it struck (by id): its age when it last pushed them the way the game's own blow does.
    ${sweep ? "float sweepScale = 1f;\n    " : ""}${once ? "public StudioOnce.Group once;\n    " : ""}private final Map<Integer, Integer> pushed = new HashMap<>();
    private double swept;
    private int lived;
    // In a player's game: where a beam ended the tick before and this tick, for drawing between them.
    private Vec3 endBefore;
    private Vec3 endNow;

    public ${R.entity}(EntityType<? extends ${R.entity}> type, Level world) {
        super(type, world);
        noPhysics = true;
        setNoGravity(true);
    }

    @Override protected void defineSynchedData(SynchedEntityData.Builder builder) {
        builder.define(KIND, 0);
        builder.define(COLOR, 0xffffff);
        builder.define(SIZE, new Vector3f());
        builder.define(MORE, new Vector3f());
        builder.define(TIME, new Vector3f(1.0f, 0.0f, 1.0f));
        builder.define(END, new Vector3f());
        builder.define(BORN, 0);
    }

    /**
     * Puts one down (a beam: starts it) at \`at\` (a hazard, a crack, a shockwave: on the ground under it), turned to \`yaw\`. \`owner\` is who it belongs to (may be null: then it hurts
     * as magic), \`target\` who a spec for the target alone strikes (null: its owner's target, if it is a mob), \`scale\` what its damage is multiplied by, \`cast\` (may be null) what tells
     * a beam the run of the ability that made it is still on (the same number as when it started). Does nothing and answers null in a player's own game, or when the world already has ${GROUND_FX_LIMITS.alive}.
     */
    public static ${R.entity} start(Level level, ${R.spec} spec, Vec3 at, float yaw, Entity owner, LivingEntity target, float scale, IntSupplier cast) {
        ${castBeam ? `return start(level, spec, at, yaw, owner, target, scale, cast, false);
    }

    public static ${R.entity} castBeam(Level level, ${R.spec} spec, Vec3 at, float yaw, Entity owner, LivingEntity target, IntSupplier cast, boolean fixed) {
        return start(level, spec, at, yaw, owner, target, 1.0f, cast, fixed);
    }

    private static ${R.entity} start(Level level, ${R.spec} spec, Vec3 at, float yaw, Entity owner, LivingEntity target, float scale, IntSupplier cast, boolean fixed) {
        ` : ""}if (!(level instanceof ServerLevel world)) return null;
        LIVE.removeIf(Entity::isRemoved);
        if (LIVE.size() >= ALIVE) return null;
        ${R.entity} fx = new ${R.entity}(${R.types}.TYPE${facade ? ".get()" : ""}, world);
        ${castBeam ? "if (fixed) { fx.fixedBeam = at; fx.fixedYaw = yaw; }\n        " : ""}fx.begin(spec, at, yaw, owner, target == null && owner instanceof Mob mob ? mob.getTarget() : target, scale, cast);
        if (!world.addFreshEntity(fx)) return null;
        LIVE.add(fx);
        return fx;
    }

    private void begin(${R.spec} spec, Vec3 at, float yaw, Entity owner, LivingEntity target, float scale, IntSupplier cast) {
        this.spec = spec;
        this.owner = owner;
        this.target = target;
        this.scale = scale;
        this.cast = cast;
        castAt = cast == null ? 0 : cast.getAsInt();
        getEntityData().set(KIND, spec.kind() | (spec.glow() ? 16 : 0));
        getEntityData().set(COLOR, spec.color());
        getEntityData().set(SIZE, new Vector3f(spec.a(), spec.b(), ${hazards ? "spec.kind() == HAZARD ? (spec.ahead() ? 1f : 0f) : spec.c()" : "spec.c()"}));
        getEntityData().set(MORE, new Vector3f(spec.d(), ${flashes ? "spec.kind() == 4 ? yaw : " : ""}yaw + random.nextFloat() * 360.0f, random.nextFloat()));
        getEntityData().set(TIME, new Vector3f(spec.life(), spec.grow(), spec.fade()));
        getEntityData().set(BORN, (int) level().getGameTime());
        swept = spec.a();
        if (spec.kind() == BEAM) {
            Vec3 from = beamStart();
            moveTo(from.x, from.y, from.z, yaw, 0.0f);
            float turn = yaw * Mth.DEG_TO_RAD;
            aim = !spec.ahead() && target != null ? target.position().add(0.0, target.getBbHeight() * 0.5, 0.0).subtract(from).normalize() : new Vec3(-Mth.sin(turn), 0.0, Mth.cos(turn));
            beamEnd(from);
            return;
        }
        moveTo(at.x, ${flashes ? "spec.kind() == 4 ? at.y + 0.9 : " : ""}ground(at), at.z, yaw, 0.0f);
    }

    /** The top of the ground under a place, looking at most FALL blocks down; the place itself when there is none. A hair above it, so what lies on it does not flicker. */
    private double ground(Vec3 at) {
        BlockHitResult hit = level().clip(new ClipContext(new Vec3(at.x, at.y + 0.5, at.z), new Vec3(at.x, at.y - FALL, at.z), ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, this));
        return hit.getType() == HitResult.Type.MISS ? at.y : hit.getLocation().y + 0.02;
    }

    public int kind() { return getEntityData().get(KIND) & 15; }
    public boolean glows() { return (getEntityData().get(KIND) & 16) != 0; }
    public int color() { return getEntityData().get(COLOR); }
    public Vector3f size() { return getEntityData().get(SIZE); }
    public Vector3f more() { return getEntityData().get(MORE); }
    public Vector3f time() { return getEntityData().get(TIME); }

    /**
     * Ticks since it was put down, by the world's clock (\`partialTick\` on): the one clock the server runs it by and every player's game draws it by, so a player whose game begins
     * to see it halfway through its life sees it as it is then (a ring as far out as it has gone), not from its start.
     */
    public float age(float partialTick) { return (int) level().getGameTime() - getEntityData().get(BORN) + partialTick; }

    /** Where a beam ends, between the last two ticks (in a player's game). */
    public Vec3 end(float partialTick) {
        if (endNow == null) {
            Vector3f end = getEntityData().get(END);
            return new Vec3(end.x(), end.y(), end.z());
        }
        return endBefore == null ? endNow : endBefore.lerp(endNow, partialTick);
    }

    /** How strong it is now, 0 to 1: grown in over its first ticks and faded out over its last. */
    public float strength(float age) {
        Vector3f time = time();
        float in = time.y() <= 0.0f ? 1.0f : Mth.clamp(age / time.y(), 0.0f, 1.0f);
        float out = time.z() <= 0.0f ? 1.0f : Mth.clamp((time.x() - age) / time.z(), 0.0f, 1.0f);
        return in * out;
    }

    /** How far a shockwave's ring has gone at \`age\` ticks (blocks), easing out. */
    public float ringRadius(float age) {
        Vector3f size = size();
        float done = Mth.clamp(age / Math.max(1.0f, time().x()), 0.0f, 1.0f);
        return size.x() + (size.y() - size.x()) * (1.0f - (1.0f - done) * (1.0f - done));
    }

    private Vec3 beamStart() {${castBeam ? `
        if (fixedBeam != null) {
            float turn = fixedYaw * Mth.DEG_TO_RAD;
            return fixedBeam.add(-spec.forward() * Mth.sin(turn) + spec.left() * Mth.cos(turn), spec.up(), spec.forward() * Mth.cos(turn) + spec.left() * Mth.sin(turn));
        }` : ""}
        if (owner == null) return position();
        float turn = (owner instanceof LivingEntity living ? living.yBodyRot : owner.getYRot()) * Mth.DEG_TO_RAD;
        double size = owner instanceof LivingEntity living ? living.getScale() : 1.0;
        double forward = spec.forward() * size;
        double left = spec.left() * size;
        return owner.position().add(-forward * Mth.sin(turn) + left * Mth.cos(turn), spec.up() * size, forward * Mth.cos(turn) + left * Mth.sin(turn));
    }

    /** Where the beam from \`from\` ends: along its aim as far as its length, or the first block in the way; told to every player's game. */
    private Vec3 beamEnd(Vec3 from) {
        Vec3 far = from.add(aim.scale(spec.b()));
        BlockHitResult hit = level().clip(new ClipContext(from, far, ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, this));
        Vec3 end = hit.getType() == HitResult.Type.MISS ? far : hit.getLocation();${terrainInteractions ? "\n        end = StudioTerrain.clip(level(),from,end,1).orElse(end);" : ""}
        getEntityData().set(END, new Vector3f((float) end.x, (float) end.y, (float) end.z));
        return end;
    }

    @Override public void tick() {
        super.tick();
        if (level().isClientSide()) {
            Vector3f end = getEntityData().get(END);
            endBefore = endNow;
            endNow = new Vec3(end.x(), end.y(), end.z());
            return;
        }
        if (spec == null) {
            discard();
            return;
        }
        // Its age by the world's clock (\`age\`): it acts on every tick of its life, its last one too (a hazard's strike due then, a ring's last reach), and is gone after it.
        lived = (int) level().getGameTime() - getEntityData().get(BORN);
        if (lived < 1) return;
        switch (spec.kind()) {
            case HAZARD -> hazard();
            case SHOCKWAVE -> shockwave();
            case BEAM -> beam();
            default -> {}
        }
        if (lived >= spec.life() && !isRemoved()) discard();
    }

${hazards ? "    private double hitGrowth;\n" : ""}    private void hazard() {
        ServerLevel world = (ServerLevel) level();
        double radius = ${hazards ? "spec.d() > 0 ? Math.min(spec.d(), spec.a() + spec.b() * lived / 20.0 + hitGrowth) : spec.a()" : "spec.a()"};${hazards ? `
        if (spec.d() > 0 || spec.ahead()) getEntityData().set(SIZE, new Vector3f((float)radius, spec.d(), spec.ahead() ? 1f : 0f));` : ""}
        if (spec.count() > 0 && lived % PULSE == 0) {
            ParticleOptions particle = particle();
            if (particle != null) for (int index = 0; index < ${hazards ? "Mth.clamp((int)Math.round(spec.count() * radius * radius / (spec.a() * spec.a())), 1, 64)" : "spec.count()"}; index++) {
                ${hazards ? `if (spec.ahead()) {
                    world.sendParticles(particle, getX() + (random.nextDouble()*2-1)*radius, getY()+0.1, getZ() + (random.nextDouble()*2-1)*radius, 1, 0.05, 0.1, 0.05, 0.01);
                    continue;
                }
                ` : ""}double angle = random.nextDouble() * Math.PI * 2.0;
                double distance = Math.sqrt(random.nextDouble()) * radius;
                world.sendParticles(particle, getX() + distance * Math.cos(angle), getY() + 0.1, getZ() + distance * Math.sin(angle), 1, 0.05, 0.1, 0.05, 0.01);
            }
        }
        if (!hurts() || lived % Math.max(1, spec.every()) != 0) return;
        for (LivingEntity victim : victims(new AABB(getX() - radius, getY() - 1.0, getZ() - radius, getX() + radius, getY() + 2.0, getZ() + radius)))
            if (${hazards ? "spec.ahead() ? Math.max(Math.abs(victim.getX()-getX()), Math.abs(victim.getZ()-getZ())) <= radius : " : ""}Mth.square(victim.getX() - getX()) + Mth.square(victim.getZ() - getZ()) <= radius * radius) strike(victim, getX(), getZ());
    }

    /** A shockwave strikes, once each, whoever its ring passed over this tick (on the ground or up to two blocks above it). */
    private void shockwave() {
        if (!hurts()) return;
        double before = swept;
        double now = ringRadius(lived);
        swept = now;
        double half = spec.c() * 0.5;
        double inner = Math.max(0.0, before - half);
        double outer = now + half;
        for (LivingEntity victim : victims(new AABB(getX() - outer, getY() - 1.0, getZ() - outer, getX() + outer, getY() + ${hitHeight ? "spec.hitHeight()" : "2.0"}, getZ() + outer))) {
            double distance = Math.sqrt(Mth.square(victim.getX() - getX()) + Mth.square(victim.getZ() - getZ()));
            if (distance < inner || distance > outer || !struck.add(victim.getId())) continue;
            strike(victim, getX(), getZ());
        }
    }

    private void beam() {
        if (${castBeam ? "fixedBeam == null && (owner == null || owner.isRemoved() || !owner.isAlive())" : "owner == null || owner.isRemoved() || !owner.isAlive()"} || (cast != null && cast.getAsInt() != castAt)) {
            discard();
            return;
        }
        Vec3 from = beamStart();
        setPos(from.x, from.y, from.z);
        float turn = (${castBeam ? "fixedBeam != null ? fixedYaw : " : ""}owner instanceof LivingEntity living ? living.yBodyRot : owner.getYRot()) * Mth.DEG_TO_RAD;
        if (spec.ahead()) aim = new Vec3(-Mth.sin(turn), 0.0, Mth.cos(turn));
        else if (spec.turn() ${sweep ? "!=" : ">"} 0.0f && target != null && target.isAlive()) {
            Vec3 wanted = target.position().add(0.0, target.getBbHeight() * 0.5, 0.0).subtract(from).normalize();
            ${sweep ? `if (spec.turn() < 0.0f) {
                double radius = Math.hypot(target.getX() - from.x, target.getZ() - from.z);
                double limit = Math.min(Math.PI, -spec.turn() * sweepScale / (20.0 * Math.max(0.001, radius)));
                double yaw = Math.atan2(aim.x, aim.z);
                double delta = Math.atan2(wanted.x, wanted.z) - yaw;
                yaw += Mth.clamp(Math.atan2(Math.sin(delta), Math.cos(delta)), -limit, limit);
                double pitch = Math.asin(Mth.clamp(aim.y, -1.0, 1.0));
                pitch += Mth.clamp(Math.asin(Mth.clamp(wanted.y, -1.0, 1.0)) - pitch, -limit, limit);
                aim = new Vec3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
            } else {
                ` : ""}double angle = Math.acos(Mth.clamp(aim.dot(wanted), -1.0, 1.0));
            double most = spec.turn() * Mth.DEG_TO_RAD;
            aim = angle <= most ? wanted : aim.scale(Math.sin(angle - most)).add(wanted.scale(Math.sin(most))).normalize();${sweep ? "\n            }" : ""}
        }
        Vec3 end = beamEnd(from);
        if (!hurts() || lived % Math.max(1, spec.every()) != 0) return;
        double half = spec.a() * 0.5;
        for (LivingEntity victim : victims(new AABB(from, end).inflate(half + 1.0))) {
            AABB box = victim.getBoundingBox().inflate(half);
            if (box.contains(from) || box.clip(from, end).isPresent()) strike(victim, from.x, from.z);
        }
    }

    private boolean hurts() { return spec.damage() > 0.0f || spec.knockback() > 0.0 || spec.burn() > 0 || spec.effects().length > 0; }

    /** The particle a hazard puts up: a vanilla one by its name, or one of the mod's own${own ? "" : " (none in this mod)"}; null when the game has no such type. */
    private ParticleOptions particle() {
${
  own
    ? `        if (spec.own() != null) {
            SimpleParticleType type = ${PARTICLE_RUNTIME.table}.byAsset(spec.own());
            return type != null && ${PARTICLE_RUNTIME.table}.registered(type) ? type : null;
        }
`
    : ""
}        if (spec.particle() == null) return null;
        ParticleType<?> type = BuiltInRegistries.PARTICLE_TYPE.get(ResourceLocation.fromNamespaceAndPath("minecraft", spec.particle()));
        return type instanceof SimpleParticleType simple ? simple : null;
    }

    /** Who it may strike: the target alone, or every living thing but its owner and its owner's kind; never a spectator or a player in creative. */
    private List<LivingEntity> victims(AABB box) {
        return level().getEntitiesOfClass(LivingEntity.class, box, other -> other != owner && other.isAlive() && !other.isSpectator() && !(other instanceof Player player && player.isCreative())
            && (spec.everyone() ? owner == null || other.getType() != owner.getType() : other == target));
    }

    /**
     * Strikes one: its damage (times the phase and the combo), pushed away from (x, z), set on fire, its status effects. Every strike lands as its spec says however soon after the
     * last one: the half second the game spares a body after a blow (\`invulnerableTime\`) is let go first, so a hazard every 5 ticks and a beam every 2 hurt that often, and their
     * fire and status effects come with each. The push the game's own blow gives comes from one of these at most once every SPARED ticks, as it would from any blow: a strike sooner
     * than that leaves them moving as they were.
     */
    private void strike(LivingEntity victim, double x, double z) {
        DamageSource source = owner instanceof LivingEntity living ? damageSources().mobAttack(living) : damageSources().magic();
        ${once ? "boolean repeat = once != null && once.seen(victim);\n        if (repeat && once.skipEffects()) return;\n        " : ""}if (${once ? "!repeat && " : ""}spec.damage() > 0.0f) {
            Integer last = pushed.get(victim.getId());
            boolean push = last == null || lived - last >= SPARED;
            Vec3 motion = victim.getDeltaMovement();
            boolean marked = victim.hurtMarked;
            boolean impulse = victim.hasImpulse;
            int spared = victim.invulnerableTime;
            victim.invulnerableTime = 0;
            if (!victim.hurt(source, spec.damage() * scale)) {
                victim.invulnerableTime = Math.max(victim.invulnerableTime, spared);
                return;
            }
            if (push) pushed.put(victim.getId(), lived);
            else {
                victim.setDeltaMovement(motion);
                victim.hurtMarked = marked;
                victim.hasImpulse = impulse;
            }
        }
        ${once ? "if (once != null) once.mark(victim);\n        " : ""}if (spec.knockback() > 0.0) {
            double dx = x - victim.getX();
            double dz = z - victim.getZ();
            if (dx * dx + dz * dz < 1.0e-6) dx = 1.0e-3;
            victim.knockback(spec.knockback(), dx, dz);
        }
        if (spec.burn() > 0) victim.setRemainingFireTicks(Math.max(victim.getRemainingFireTicks(), spec.burn()));
        int[] effects = spec.effects();
        for (int index = 0; index + 2 < effects.length; index += 3) {
            victim.addEffect(new MobEffectInstance(switch (effects[index]) {
                case 1 -> MobEffects.BLINDNESS;
                case 2 -> MobEffects.POISON;
                case 3 -> MobEffects.WEAKNESS;
                default -> MobEffects.MOVEMENT_SLOWDOWN;
            }, effects[index + 1], ${hiddenEffects ? "effects[index + 2] < 0 ? ~effects[index + 2] : effects[index + 2], false, effects[index + 2] >= 0, true" : "effects[index + 2]"}), owner);
        }
${hazards ? "        if (spec.kind() == HAZARD && spec.d() > 0) hitGrowth = Math.min(spec.d(), hitGrowth + spec.c());\n" : ""}    }

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

    // What it draws reaches far past the small box it stands in: a ring as far as it grows, a beam to where it ends.
    @Override public boolean shouldRenderAtSqrDistance(double distance) { return distance < 16384.0; }
    @Override public AABB getBoundingBoxForCulling() {
        if (kind() == BEAM) return new AABB(position(), end(1.0f)).inflate(size().x() + 1.0);
        double reach = Math.max(size().x(), size().y()) + 1.0;
        return getBoundingBox().inflate(reach, Math.max(2.0, more().x() + 1.0), reach);
    }
}
`
}

function typesSource(packageName: string, modId: string, facade: boolean) {
  return `package ${packageName}.entity;

${
  facade
    ? `import ${packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import java.util.function.Supplier;
`
    : `import net.fabricmc.api.ModInitializer;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
`}import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;

/** Generated by MineMods Studio (第 4 步): the one entity type every ground hazard, crack, shockwave and beam is. Never saved and never summoned by command. */
public final class ${R.types}${facade ? "" : " implements ModInitializer"} {
    public static final String MOD_ID = ${JSON.stringify(modId)};
${
  facade
    ? `    public static final Supplier<EntityType<${R.entity}>> TYPE = ${PLATFORM_CLASS}.entity("${R.registry}",
        () -> EntityType.Builder.<${R.entity}>of(${R.entity}::new, MobCategory.MISC)
            .sized(0.5f, 0.5f).noSave().noSummon().fireImmune().clientTrackingRange(${GROUND_FX_LIMITS.range}).updateInterval(1).build("${R.registry}"));

    private ${R.types}() {}

    /** Run by the mod's common entry while the mod is constructed: loading this class registers the entity type (its field above). */
    public static void register() {}`
    : `    public static final EntityType<${R.entity}> TYPE = Registry.register(
        BuiltInRegistries.ENTITY_TYPE, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${R.registry}"),
        EntityType.Builder.<${R.entity}>of(${R.entity}::new, MobCategory.MISC)
            .sized(0.5f, 0.5f).noSave().noSummon().fireImmune().clientTrackingRange(${GROUND_FX_LIMITS.range}).updateInterval(1).build("${R.registry}"));

    // Fabric builds a main entrypoint through its no-argument constructor, which must be public.
    public ${R.types}() {}

    // Loading this class registers the entity type; nothing else is needed at start.
    @Override public void onInitialize() {}`
}
}
`
}

function clientSource(packageName: string, facade: boolean, target: GenTarget) {
  return facade
    ? `package ${packageName}.client;

import ${packageName}.entity.${R.types};
import ${packageName}.${PLATFORM_PACKAGE}.${CLIENT_PLATFORM_CLASS};

/** Generated by MineMods Studio (第 4 步): draws this mod's ground hazards, cracks, shockwaves and beams (${target.manifest.id}). The mod's client entry runs this once. */
public final class ${R.client} {
    public static void register() {
        ${CLIENT_PLATFORM_CLASS}.renderer(${R.types}.TYPE, ${R.renderer}::new);
    }
}
`
    : `package ${packageName}.client;

import ${packageName}.entity.${R.types};
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;

/** Generated by MineMods Studio (第 4 步): draws this mod's ground hazards, cracks, shockwaves and beams. */
public final class ${R.client} implements ClientModInitializer {
    @Override public void onInitializeClient() {
        EntityRendererRegistry.register(${R.types}.TYPE, ${R.renderer}::new);
    }
}
`
}

function rendererSource(packageName: string, minecraft: "1.21.1" | "1.20.1", hazards: boolean, flashes: readonly FlashEvent[]) {
  const vertex =
    minecraft === "1.20.1"
      ? "out.vertex(pose.pose(), x, y, z).color(red, green, blue, alpha).uv(u, v).overlayCoords(OverlayTexture.NO_OVERLAY).uv2(light).normal(pose.normal(), 0.0f, 1.0f, 0.0f).endVertex();"
      : "out.addVertex(pose.pose(), x, y, z).setColor(red, green, blue, alpha).setUv(u, v).setOverlay(OverlayTexture.NO_OVERLAY).setLight(light).setNormal(pose, 0.0f, 1.0f, 0.0f);"
  return `package ${packageName}.client;

import ${packageName}.entity.${R.entity};
import ${packageName}.entity.${R.types};
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.math.Axis;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.LightTexture;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec3;
import org.joml.Vector3f;

/**
 * Generated by MineMods Studio (第 4 步): draws a ground hazard (a soft disc and its rim on the ground, breathing), a crack (its picture growing out from the middle), a shockwave (a band
 * on the ground going out and thinning, and its wall) and a beam (a band facing the camera from where it starts to where it ends, a bright core inside it and a flare where it ends).
 * Whatever glows is added to what is behind it at full brightness (the game's eyes layer); the rest is see-through and lit by the world.
 */
public final class ${R.renderer} extends EntityRenderer<${R.entity}> {
    private static final ResourceLocation SOFT = ResourceLocation.fromNamespaceAndPath(${R.types}.MOD_ID, "textures/fx/soft.png");
    private static final ResourceLocation SOFT_GLOW = ResourceLocation.fromNamespaceAndPath(${R.types}.MOD_ID, "textures/fx/soft_glow.png");
    private static final ResourceLocation CRACK = ResourceLocation.fromNamespaceAndPath(${R.types}.MOD_ID, "textures/fx/crack.png");
    private static final ResourceLocation CRACK_GLOW = ResourceLocation.fromNamespaceAndPath(${R.types}.MOD_ID, "textures/fx/crack_glow.png");
${flashes.length ? `    private static final java.util.Map<Integer, ResourceLocation> FLASHES = java.util.Map.ofEntries(
${[...new Map(flashes.map(f => [flashTexture(f), f])).entries()].map(([key, f]) => `        java.util.Map.entry(${f.shape === "arc" ? f.arc ?? 140 : f.shape === "ring" ? -1 : 0}, ResourceLocation.fromNamespaceAndPath(${R.types}.MOD_ID, "textures/fx/${key}.png"))`).join(",\n")});
` : ""}    /** Pieces of a circle. */
    private static final int ROUND = 64;

    public ${R.renderer}(EntityRendererProvider.Context context) {
        super(context);
        this.shadowRadius = 0.0f;
    }

    @Override public ResourceLocation getTextureLocation(${R.entity} fx) { return SOFT; }

    @Override public void render(${R.entity} fx, float entityYaw, float partialTick, PoseStack poseStack, MultiBufferSource buffers, int packedLight) {
        float age = fx.age(partialTick);
        float strength = fx.strength(age);
        if (strength <= 0.0f) return;
        int color = fx.color();
        float red = ((color >> 16) & 255) / 255.0f;
        float green = ((color >> 8) & 255) / 255.0f;
        float blue = (color & 255) / 255.0f;
        boolean glow = fx.glows();
        int light = glow ? LightTexture.FULL_BRIGHT : packedLight;
        Vector3f size = fx.size();
        switch (fx.kind()) {
${flashes.length ? `            case 4 -> {
                ResourceLocation texture = FLASHES.get((int) fx.more().x());
                if (texture == null) return;
                poseStack.pushPose();
                poseStack.mulPose(Axis.YP.rotationDegrees(-fx.more().y()));
                poseStack.mulPose(Axis.ZP.rotationDegrees(size.z()));
                poseStack.mulPose(Axis.YP.rotationDegrees(90.0f));
                float radius = size.x() * Mth.lerp(1.0f - strength, 1.0f, size.y());
                flat(buffers.getBuffer(RenderType.entityTranslucent(texture)), poseStack.last(), radius, 0.0f, red, green, blue, strength, LightTexture.FULL_BRIGHT, false, 0, 0, 1, 1);
                poseStack.popPose();
            }
` : ""}            case ${R.entity}.HAZARD -> {
                VertexConsumer out = buffers.getBuffer(glow ? RenderType.eyes(SOFT_GLOW) : RenderType.entityTranslucent(SOFT));
                float breathe = 0.85f + 0.15f * Mth.sin(age * 0.25f);
                float radius = size.x();
                ${hazards ? `if (size.z() == 1f) {
                    flat(out, poseStack.last(), radius, 0.02f, red, green, blue, 0.55f * strength * breathe, light, glow, 0.25f, 0.25f, 0.75f, 0.75f);
                    break;
                }
                ` : ""}flat(out, poseStack.last(), radius * 1.15f, 0.02f, red, green, blue, 0.55f * strength * breathe, light, glow, 0.0f, 0.0f, 1.0f, 1.0f);
                band(out, poseStack.last(), Math.max(0.0f, radius - 0.6f), radius + 0.15f, 0.03f, red, green, blue, 0.9f * strength, light, glow);
            }
            case ${R.entity}.CRACK -> {
                VertexConsumer out = buffers.getBuffer(glow ? RenderType.eyes(CRACK_GLOW) : RenderType.entityTranslucent(CRACK));
                float grow = fx.time().y() <= 0.0f ? 1.0f : Mth.clamp(age / fx.time().y(), 0.0f, 1.0f);
                float fading = fx.time().z() <= 0.0f ? 1.0f : Mth.clamp((fx.time().x() - age) / fx.time().z(), 0.0f, 1.0f);
                poseStack.pushPose();
                poseStack.mulPose(Axis.YP.rotationDegrees(fx.more().y()));
                // The picture is as large as the crack from the start; it is shown out to a radius that grows, so the branches lengthen from the middle.
                float shown = 0.15f + 0.85f * (1.0f - (1.0f - grow) * (1.0f - grow));
                float radius = size.x() * shown;
                float edge = 0.5f * shown;
                flat(out, poseStack.last(), radius, 0.03f, red, green, blue, fading, light, glow, 0.5f - edge, 0.5f - edge, 0.5f + edge, 0.5f + edge);
                poseStack.popPose();
            }
            case ${R.entity}.SHOCKWAVE -> {
                VertexConsumer out = buffers.getBuffer(glow ? RenderType.eyes(SOFT_GLOW) : RenderType.entityTranslucent(SOFT));
                float done = Mth.clamp(age / Math.max(1.0f, fx.time().x()), 0.0f, 1.0f);
                float radius = fx.ringRadius(age);
                float half = size.z() * 0.5f * (1.0f - 0.6f * done);
                band(out, poseStack.last(), Math.max(0.0f, radius - half), radius + half, 0.04f, red, green, blue, strength, light, glow);
                float wall = fx.more().x() * (1.0f - 0.5f * done);
                if (wall > 0.0f) wall(out, poseStack.last(), radius, wall, red, green, blue, 0.8f * strength, light, glow);
            }
            case ${R.entity}.BEAM -> beam(fx, partialTick, poseStack, buffers, red, green, blue, strength, size.x());
            default -> {}
        }
    }

    /** A beam from where it is to where it ends: a band facing the camera as wide as its width grown in, a core a third as wide nearer white, and a flare where it ends. */
    private static void beam(${R.entity} fx, float partialTick, PoseStack poseStack, MultiBufferSource buffers, float red, float green, float blue, float strength, float width) {
        Vec3 origin = fx.getPosition(partialTick);
        Vec3 end = fx.end(partialTick).subtract(origin);
        Vec3 eye = Minecraft.getInstance().gameRenderer.getMainCamera().getPosition().subtract(origin);
        VertexConsumer out = buffers.getBuffer(RenderType.eyes(SOFT_GLOW));
        PoseStack.Pose pose = poseStack.last();
        float grown = width * (0.4f + 0.6f * strength);
        ribbon(out, pose, Vec3.ZERO, end, eye, grown, red, green, blue, strength);
        ribbon(out, pose, Vec3.ZERO, end, eye, grown * 0.35f, Mth.lerp(0.7f, red, 1.0f), Mth.lerp(0.7f, green, 1.0f), Mth.lerp(0.7f, blue, 1.0f), strength);
        // The flare where it ends, facing the camera.
        Vec3 look = eye.subtract(end).normalize();
        Vec3 side = look.cross(new Vec3(0.0, 1.0, 0.0));
        if (side.lengthSqr() < 1.0e-6) side = new Vec3(1.0, 0.0, 0.0);
        side = side.normalize().scale(grown);
        Vec3 up = side.cross(look).normalize().scale(grown);
        quad(out, pose, end.subtract(side).subtract(up), end.add(side).subtract(up), end.add(side).add(up), end.subtract(side).add(up), red, green, blue, strength, LightTexture.FULL_BRIGHT, true, 0.0f, 0.0f, 1.0f, 1.0f);
    }

    private static void ribbon(VertexConsumer out, PoseStack.Pose pose, Vec3 from, Vec3 to, Vec3 eye, float width, float red, float green, float blue, float alpha) {
        Vec3 along = to.subtract(from);
        Vec3 side = along.cross(eye.subtract(from.add(to).scale(0.5)));
        if (side.lengthSqr() < 1.0e-8) return;
        side = side.normalize().scale(width * 0.5);
        quad(out, pose, from.subtract(side), from.add(side), to.add(side), to.subtract(side), red, green, blue, alpha, LightTexture.FULL_BRIGHT, true, 0.0f, 0.5f, 1.0f, 0.5f);
    }

    /** A square \`radius\` from the middle on the ground, \`height\` above where it stands, with the picture from (u0, v0) to (u1, v1). */
    private static void flat(VertexConsumer out, PoseStack.Pose pose, float radius, float height, float red, float green, float blue, float alpha, int light, boolean glow, float u0, float v0, float u1, float v1) {
        quad(out, pose, new Vec3(-radius, height, -radius), new Vec3(-radius, height, radius), new Vec3(radius, height, radius), new Vec3(radius, height, -radius), red, green, blue, alpha, light, glow, u0, v0, u1, v1);
    }

    /** A ring on the ground from \`inner\` to \`outer\`, solid in the middle of its width and fading to both edges (the soft picture across it). */
    private static void band(VertexConsumer out, PoseStack.Pose pose, float inner, float outer, float height, float red, float green, float blue, float alpha, int light, boolean glow) {
        for (int index = 0; index < ROUND; index++) {
            float a = index * Mth.TWO_PI / ROUND;
            float b = (index + 1) * Mth.TWO_PI / ROUND;
            Vec3 innerA = new Vec3(inner * Mth.cos(a), height, inner * Mth.sin(a));
            Vec3 innerB = new Vec3(inner * Mth.cos(b), height, inner * Mth.sin(b));
            Vec3 outerA = new Vec3(outer * Mth.cos(a), height, outer * Mth.sin(a));
            Vec3 outerB = new Vec3(outer * Mth.cos(b), height, outer * Mth.sin(b));
            quad(out, pose, innerA, outerA, outerB, innerB, red, green, blue, alpha, light, glow, 0.0f, 0.5f, 1.0f, 0.5f);
        }
    }

    /** A wall standing on a circle of \`radius\`, \`height\` tall, solid at its foot and fading upward. */
    private static void wall(VertexConsumer out, PoseStack.Pose pose, float radius, float height, float red, float green, float blue, float alpha, int light, boolean glow) {
        for (int index = 0; index < ROUND; index++) {
            float a = index * Mth.TWO_PI / ROUND;
            float b = (index + 1) * Mth.TWO_PI / ROUND;
            Vec3 footA = new Vec3(radius * Mth.cos(a), 0.0, radius * Mth.sin(a));
            Vec3 footB = new Vec3(radius * Mth.cos(b), 0.0, radius * Mth.sin(b));
            quad(out, pose, footA, footB, footB.add(0.0, height, 0.0), footA.add(0.0, height, 0.0), red, green, blue, alpha, light, glow, 0.5f, 0.5f, 0.5f, 0.02f);
        }
    }

    /**
     * Four corners (a, b, c, d) with the picture from (u0, v0) at a to (u1, v1) at c; a band's corners across it take u0 and u1 at v0 and v1. What glows is drawn from both sides
     * (the layer it is on hides back faces); the see-through layer draws both already.
     */
    private static void quad(VertexConsumer out, PoseStack.Pose pose, Vec3 a, Vec3 b, Vec3 c, Vec3 d, float red, float green, float blue, float alpha, int light, boolean glow, float u0, float v0, float u1, float v1) {
        // What is added to what is behind it has no alpha of its own: its strength is its brightness.
        float r = glow ? red * alpha : red;
        float g = glow ? green * alpha : green;
        float bl = glow ? blue * alpha : blue;
        corner(out, pose, a, r, g, bl, alpha, u0, v0, light);
        corner(out, pose, b, r, g, bl, alpha, u1, v0, light);
        corner(out, pose, c, r, g, bl, alpha, u1, v1, light);
        corner(out, pose, d, r, g, bl, alpha, u0, v1, light);
        if (!glow) return;
        corner(out, pose, d, r, g, bl, alpha, u0, v1, light);
        corner(out, pose, c, r, g, bl, alpha, u1, v1, light);
        corner(out, pose, b, r, g, bl, alpha, u1, v0, light);
        corner(out, pose, a, r, g, bl, alpha, u0, v0, light);
    }

    private static void corner(VertexConsumer out, PoseStack.Pose pose, Vec3 at, float red, float green, float blue, float alpha, float u, float v, int light) {
        float x = (float) at.x;
        float y = (float) at.y;
        float z = (float) at.z;
        ${vertex}
    }
}
`
}

/**
 * `target`: Fabric 1.21.1 (the default) registers the entity type and its renderer from two entry points named in fabric.mod.json; a facade target through `StudioPlatform.entity` and
 * `StudioClientPlatform.renderer`, from two `register()` its entries run (\`entries\`), every class mapped to its game version.
 */
export function compileGroundFx(value: z.input<typeof Input>, target: GenTarget = FABRIC_TARGET) {
  const input = Input.parse(value)
  const facade = target.loader.facade
  const source = `src/main/java/${input.packageName.replaceAll(".", "/")}`
  const pack = input.packageName.replaceAll(".", "/")
  const minecraft = target.version.minecraft === "1.20.1" ? "1.20.1" : "1.21.1"
  const java: Record<string, string> = {
    [`${source}/entity/${R.spec}.java`]: specSource(input.packageName, input.hitHeight),
    [`${source}/entity/${R.entity}.java`]: entitySource(input.packageName, facade, input.own, input.hitHeight, input.hazards, input.flashes.length > 0, input.hiddenEffects, input.once, input.sweep, input.terrainInteractions, input.castBeam),
    [`${source}/entity/${R.types}.java`]: typesSource(input.packageName, input.modId, facade),
    [`${source}/client/${R.client}.java`]: clientSource(input.packageName, facade, target),
    [`${source}/client/${R.renderer}.java`]: rendererSource(input.packageName, minecraft, input.hazards, input.flashes),
  }
  if (input.terrain) {
    java[`${source}/entity/StudioTerrain.java`] = terrainSource(input.packageName, input.modId, target, input.pointed, input.terrainMaterial, input.terrainInteractions)
    java[`${source}/entity/StudioTerrainPart.java`] = terrainPartSource(input.packageName, input.terrainDust, input.terrainInteractions, input.muteDust)
    java[`${source}/client/StudioTerrainRenderer.java`] = `package ${input.packageName}.client;
import ${input.packageName}.entity.StudioTerrainPart;
import net.minecraft.client.renderer.entity.*;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.resources.ResourceLocation;
import com.mojang.blaze3d.vertex.PoseStack;
public final class StudioTerrainRenderer extends EntityRenderer<StudioTerrainPart> {
    private final DisplayRenderer.BlockDisplayRenderer blocks;
    public StudioTerrainRenderer(EntityRendererProvider.Context context) { super(context); blocks=new DisplayRenderer.BlockDisplayRenderer(context) {}; }
    @Override public ResourceLocation getTextureLocation(StudioTerrainPart entity) { return blocks.getTextureLocation(entity); }
    @Override public void render(StudioTerrainPart entity,float yaw,float partial,PoseStack poses,MultiBufferSource buffers,int light) { blocks.render(entity,yaw,partial,poses,buffers,light); }
}
`
    const fx = `${source}/entity/${R.entity}.java`
    java[fx] = java[fx]!.replace("case SHOCKWAVE -> shockwave();", "case SHOCKWAVE -> { StudioTerrain.sweep(this, spec, lived); shockwave(); }")
    const types = `${source}/entity/${R.types}.java`
    const definition = facade
      ? `    public static final java.util.function.Supplier<EntityType<StudioTerrainPart>> TERRAIN = ${PLATFORM_CLASS}.entity("studio_terrain", () -> EntityType.Builder.<StudioTerrainPart>of(StudioTerrainPart::new, MobCategory.MISC).sized(1,1).noSave().noSummon().fireImmune().clientTrackingRange(10).updateInterval(1).build("studio_terrain"));\n`
      : `    public static final EntityType<StudioTerrainPart> TERRAIN = Registry.register(BuiltInRegistries.ENTITY_TYPE, ResourceLocation.fromNamespaceAndPath(MOD_ID, "studio_terrain"), EntityType.Builder.<StudioTerrainPart>of(StudioTerrainPart::new, MobCategory.MISC).sized(1,1).noSave().noSummon().fireImmune().clientTrackingRange(10).updateInterval(1).build("studio_terrain"));\n`
    java[types] = java[types]!.replace(facade ? "    private StudioFxTypes()" : "    // Fabric builds", definition + (facade ? "    private StudioFxTypes()" : "    // Fabric builds")).replace(facade ? "public static void register() {}" : "public void onInitialize() {}", facade ? "public static void register() { StudioTerrain.register(); }" : "public void onInitialize() { StudioTerrain.register(); }")
    const client = `${source}/client/${R.client}.java`
    java[client] = java[client]!.replace(facade ? "    public static void register() {" : "    @Override public void onInitializeClient() {", (facade ? "    public static void register() {" : "    @Override public void onInitializeClient() {") + `\n        ${facade ? `${CLIENT_PLATFORM_CLASS}.renderer` : "EntityRendererRegistry.register"}(${R.types}.TERRAIN, StudioTerrainRenderer::new);`)
  }
  if (facade) {
    const entity = `${source}/entity/${R.entity}.java`
    java[entity] = target.version.body.plainEntity(java[entity]!)
    for (const [name, text] of Object.entries(java)) java[name] = target.version.rewriteJava(text)
  }
  const files: Record<string, string | Uint8Array> = { ...java, ...groundFxTextures(input.modId, input.flashes) }
  return {
    files,
    language: { zh_cn: { [`entity.${input.modId}.${R.registry}`]: "地面效果" }, en_us: { [`entity.${input.modId}.${R.registry}`]: "Ground effect" } },
    /** Paths inside the built jar that prove it went in. */
    classes: [...(input.terrain ? [`${pack}/entity/StudioTerrain.class`, `${pack}/entity/StudioTerrain$Ledger.class`, `${pack}/entity/StudioTerrainPart.class`, `${pack}/client/StudioTerrainRenderer.class`] : []), `${pack}/entity/${R.entity}.class`, `${pack}/entity/${R.types}.class`, `${pack}/client/${R.renderer}.class`, `assets/${input.modId}/textures/fx/crack.png`],
    /** Fabric: the two classes start with the mod (fabric.mod.json's entry points). A facade target has none: its entries run them (`entries`). */
    patch: (facade
      ? {}
      : {
          "src/main/resources/fabric.mod.json": (text: string) => {
            const metadata = z.record(z.string(), z.unknown()).parse(JSON.parse(text))
            const entrypoints = z.looseObject({ main: z.array(z.string()), client: z.array(z.string()).default([]) }).parse(metadata.entrypoints)
            const edited = `${JSON.stringify({ ...metadata, entrypoints: { ...entrypoints, main: [...entrypoints.main, `${input.packageName}.entity.${R.types}`], client: [...entrypoints.client, `${input.packageName}.client.${R.client}`] } }, null, 2)}\n`
            return text.includes("\r\n") ? edited.replaceAll("\n", "\r\n") : edited
          },
        }) as Record<string, (text: string) => string>,
    entries: facade ? { common: [`${input.packageName}.entity.${R.types}`], client: [`${input.packageName}.client.${R.client}`] } : { common: [] as string[], client: [] as string[] },
  }
}
