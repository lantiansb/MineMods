import { z } from "zod"

import { particleCurveJava } from "./particle-curves"
import { encodePng } from "../png"
import { TICKS } from "../ability-words"
import { decodeTextureDataUrl } from "../content-texture"
import { ParticleDocumentSchema, appearancePixels, particleTicks } from "../particle"
function particleTexture(frame: Parameters<typeof appearancePixels>[0], edge?: "soft") {
  const image = appearancePixels(frame, edge)
  return encodePng(image.pixels, image.width, image.height)
}

import type { GenTarget } from "../platform/adapter"
import { CLIENT_PLATFORM_CLASS, PLATFORM_CLASS, PLATFORM_PACKAGE } from "../platform/facade"
import { FABRIC_TARGET } from "../platform/target"

/**
 * What the project's own particles (粒子, Boss 能力 11) add to a generated mod, the same on every loader: each particle's pictures
 * (`textures/particle/<name>_<n>.png`) and description (`particles/<name>.json`), one table of every particle's type and numbers
 * (`entity/StudioParticles`, read on both sides), and one particle class with its provider (`client/StudioParticle`, a player's game only).
 *
 * Nothing here registers anything or hooks into a loader: that is the platform layer's (StudioPlatform), which must, for every index i of
 * `StudioParticles.TYPES`:
 *  - on both sides, put `StudioParticles.TYPES[i]` into the particle type registry as `<mod>:StudioParticles.NAMES[i]`
 *    (Fabric: `Registry.register(BuiltInRegistries.PARTICLE_TYPE, id, type)`; Forge/NeoForge: a `DeferredRegister` of `Registries.PARTICLE_TYPE` whose supplier returns that very object);
 *  - in a player's game, give that type the provider `new StudioParticle.Provider(sprites, i)`
 *    (Fabric: `ParticleFactoryRegistry.getInstance().register(type, sprites -> new StudioParticle.Provider(sprites, i))`;
 *    Forge/NeoForge: `RegisterParticleProvidersEvent.registerSpriteSet(type, sprites -> new StudioParticle.Provider(sprites, i))`).
 * Until a type is in the registry the creatures send nothing of it (`StudioParticles.registered`), so a mod built before that is wired only shows no particle.
 * That wiring is the two classes `compileParticles` writes for its target beside these (A 组, `wiring`): `entity/StudioParticleSetup` and `client/StudioParticleClient`,
 * Fabric's own entry points (named in fabric.mod.json by `patch`), or on a facade target two classes whose `register()` the mod's common and client entries run (`entries`).
 *
 * Every Minecraft name used is Mojang's official one, the same in 1.20.1 and 1.21.1 (checked with javac against Fabric 1.21.1, Forge 1.20.1 and NeoForge 1.21.1).
 * Only called when a project has particles, so a project without any is untouched.
 */

const Input = z.strictObject({
  modId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  emit: z.boolean().optional(),
  particles: z.array(z.strictObject({ id: z.uuid(), document: ParticleDocumentSchema })).min(1),
})
export type ParticleCompileInput = z.input<typeof Input>

/** The classes the creatures and the platform layer name. */
export const PARTICLE_RUNTIME = { table: "StudioParticles", particle: "StudioParticle", setup: "StudioParticleSetup", client: "StudioParticleClient" } as const

const quoted = (value: string) => JSON.stringify(value)
const real = (value: number) => `${Number(value.toFixed(5))}f`
const list = (values: readonly (string | number | boolean)[]) => `{${values.join(", ")}}`
const channels = (colour: string) => [1, 3, 5].map((at) => Number.parseInt(colour.slice(at, at + 2), 16) / 255)

type NamedParticle = {document:{name:string}}
const byName = (a:NamedParticle,b:NamedParticle)=>a.document.name.localeCompare(b.document.name)
export function particleIndex(particles:readonly NamedParticle[],name:string) {
  return [...particles].sort(byName).findIndex(p=>p.document.name===name)
}

function emitJava(pkg: string) {
  return `package ${pkg}.client;

import ${pkg}.entity.StudioParticles;
import net.minecraft.client.multiplayer.ClientLevel;

public final class StudioParticleEmit {
    record Spawn(int spec, int motion, float turns, int tint, double x, double y, double z) {}
    static Spawn pending;

    public static void emit(ClientLevel level, int particle, double x, double y, double z, float yaw,
            int count, int shape, float sx, float sy, float sz, float forward, float up, float left, float outward,
            float vary, int motion, float turns, int tint, long seed) {
        if (particle < 0 || particle >= StudioParticles.TYPES.length) return;
        Spawn spawn = new Spawn(particle, motion, turns, tint, x, y, z);
        java.util.Random random = new java.util.Random(seed);
        double angle = Math.toRadians(yaw), sin = Math.sin(angle), cos = Math.cos(angle);
        for (int i = 0; i < count; i++) {
            double theta = random.nextDouble() * Math.PI * 2, h = random.nextDouble() * 2 - 1;
            double radius = shape == 2 ? 1 : shape == 1 ? Math.sqrt(random.nextDouble()) : Math.cbrt(random.nextDouble());
            double flat = shape == 0 ? radius * Math.sqrt(1 - h * h) : radius;
            double side = Math.cos(theta) * flat * sx, dy = h * sy * (shape == 0 ? radius : 1), ahead = Math.sin(theta) * flat * sz;
            double dx = side * cos - ahead * sin, dz = ahead * cos + side * sin;
            double norm = Math.sqrt(dx * dx + dy * dy + dz * dz);
            double radial = norm == 0 ? 0 : outward / norm;
            double rate = (1 + vary * (2 * random.nextDouble() - 1)) / 20;
            // The client level applies its normal player settings and distance rules before calling the provider.
            Spawn previous = pending;
            pending = spawn;
            try {
                level.addParticle(StudioParticles.TYPES[particle], x + dx, y + dy, z + dz,
                        (left * cos - forward * sin + radial * dx) * rate, (up + radial * dy) * rate,
                        (forward * cos + left * sin + radial * dz) * rate);
            } finally {
                pending = previous;
            }
        }
    }
}
`
}

function motionRender(legacy:boolean, screenLimit:boolean) {
  const vertex=legacy ? "out.vertex(p.x, p.y, p.z).uv(u, v).color(rCol, gCol, bCol, alpha).uv2(light).endVertex();" : "out.addVertex((float)p.x, (float)p.y, (float)p.z).setUv(u, v).setColor(rCol, gCol, bCol, alpha).setLight(light);"
  return `
    @Override public void render(com.mojang.blaze3d.vertex.VertexConsumer out, net.minecraft.client.Camera camera, float t) {
        if (!MOTION_FACE[spec]) { super.render(out, camera, t); return; }
        Vec3 direction = age == 0 ? new Vec3(xd, yd, zd) : new Vec3(x-xo, y-yo, z-zo);
        Vec3 center = new Vec3(Mth.lerp(t,xo,x), Mth.lerp(t,yo,y), Mth.lerp(t,zo,z)).subtract(camera.getPosition());
        Vec3 across = center.cross(direction);
        if (across.lengthSqr() < 1.0e-12) { super.render(out, camera, t); return; }
        double half = getQuadSize(t);
        Vec3 along = direction.normalize().scale(half * STRETCH[spec]);
        across = across.normalize().scale(half);${screenLimit ? `
        if (SCREEN_LIMIT[spec] > 0) {
            var look = camera.getLookVector();
            var right = camera.getLeftVector();
            var up = camera.getUpVector();
            double z = component(center, look);
            if (z <= 0) return;
            double zAlong = component(along, look), zAcross = component(across, look);
            double zRadius = Math.abs(zAlong) + Math.abs(zAcross);
            double xSlope = component(center, right) / z, ySlope = component(center, up) / z;
            double xRadius = Math.abs(component(along, right) - xSlope*zAlong) + Math.abs(component(across, right) - xSlope*zAcross);
            double yRadius = Math.abs(component(along, up) - ySlope*zAlong) + Math.abs(component(across, up) - ySlope*zAcross);
            double projection = Math.abs(com.mojang.blaze3d.systems.RenderSystem.getProjectionMatrix().m11());
            double limit = SCREEN_LIMIT[spec];
            double scale = Math.min(1, limit*z / (projection*Math.max(xRadius,yRadius) + limit*zRadius));
            along = along.scale(scale);
            across = across.scale(scale);
        }` : ""}
        int light = getLightColor(t);
        corner(out, center.subtract(along).subtract(across), getU0(), getV1(), light);
        corner(out, center.subtract(along).add(across), getU0(), getV0(), light);
        corner(out, center.add(along).add(across), getU1(), getV0(), light);
        corner(out, center.add(along).subtract(across), getU1(), getV1(), light);
    }

    ${screenLimit ? `private static double component(Vec3 v, org.joml.Vector3f axis) {
        return v.x * axis.x() + v.y * axis.y() + v.z * axis.z();
    }

    ` : ""}private void corner(com.mojang.blaze3d.vertex.VertexConsumer out, Vec3 p, float u, float v, int light) {
        ${vertex}
    }
`
}

/** The picture files of one particle, in order: `<name>_<n>`, counted from 0. */
export const particleTextureNames = (document: { name: string; frames: readonly unknown[] }) => document.frames.map((_, index) => `${document.name}_${index}`)

/**
 * The two classes that put every particle of the table into the game (A 组), as the contract above says: on Fabric its own entry points (the types registered when
 * the mod starts, their providers given when a player's game starts); on a facade target through `StudioPlatform.register` and `StudioClientPlatform.particle`, run by the entries.
 */
function wiring(input: z.output<typeof Input>, target: GenTarget) {
  const source = `src/main/java/${input.packageName.replaceAll(".", "/")}`
  const table = PARTICLE_RUNTIME.table
  const each = (line: string) => `        for (int index = 0; index < ${table}.TYPES.length; index++) {
            int spec = index;
            ${line}
        }`
  if (!target.loader.facade)
    return {
      files: {
        [`${source}/entity/${PARTICLE_RUNTIME.setup}.java`]: `package ${input.packageName}.entity;

import net.fabricmc.api.ModInitializer;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;

/** Generated by MineMods Studio: puts each of this mod's own particles into the game's registry when the mod starts, as ${input.modId}:${table}.NAMES[i]. */
public final class ${PARTICLE_RUNTIME.setup} implements ModInitializer {
    @Override public void onInitialize() {
${each(`Registry.register(BuiltInRegistries.PARTICLE_TYPE, ResourceLocation.fromNamespaceAndPath(${table}.MOD_ID, ${table}.NAMES[spec]), ${table}.TYPES[spec]);`)}
    }
}
`,
        [`${source}/client/${PARTICLE_RUNTIME.client}.java`]: `package ${input.packageName}.client;

import ${input.packageName}.entity.${table};
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.particle.v1.ParticleFactoryRegistry;

/** Generated by MineMods Studio: in a player's game each of this mod's own particles is made by ${PARTICLE_RUNTIME.particle} from the pictures the game loaded for it. */
public final class ${PARTICLE_RUNTIME.client} implements ClientModInitializer {
    @Override public void onInitializeClient() {
${each(`ParticleFactoryRegistry.getInstance().register(${table}.TYPES[spec], sprites -> new ${PARTICLE_RUNTIME.particle}.Provider(sprites, spec));`)}
    }
}
`,
      } as Record<string, string>,
      patch: {
        "src/main/resources/fabric.mod.json": (text: string) => {
          const metadata = z.record(z.string(), z.unknown()).parse(JSON.parse(text))
          const entrypoints = z.looseObject({ main: z.array(z.string()), client: z.array(z.string()).default([]) }).parse(metadata.entrypoints)
          const edited = `${JSON.stringify({ ...metadata, entrypoints: { ...entrypoints, main: [...entrypoints.main, `${input.packageName}.entity.${PARTICLE_RUNTIME.setup}`], client: [...entrypoints.client, `${input.packageName}.client.${PARTICLE_RUNTIME.client}`] } }, null, 2)}\n`
          return text.includes("\r\n") ? edited.replaceAll("\n", "\r\n") : edited
        },
      } as Record<string, (text: string) => string>,
      entries: { common: [] as string[], client: [] as string[] },
    }
  return {
    files: {
      [`${source}/entity/${PARTICLE_RUNTIME.setup}.java`]: `package ${input.packageName}.entity;

import ${input.packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import net.minecraft.core.registries.Registries;

/** Generated by MineMods Studio: puts each of this mod's own particles into the game's registry (${target.manifest.id}), as ${input.modId}:${table}.NAMES[i]. The mod's common entry runs this while the mod is constructed. */
public final class ${PARTICLE_RUNTIME.setup} {
    public static void register() {
${each(`${PLATFORM_CLASS}.register(Registries.PARTICLE_TYPE, ${table}.NAMES[spec], () -> ${table}.TYPES[spec]);`)}
    }
}
`,
      [`${source}/client/${PARTICLE_RUNTIME.client}.java`]: `package ${input.packageName}.client;

import ${input.packageName}.entity.${table};
import ${input.packageName}.${PLATFORM_PACKAGE}.${CLIENT_PLATFORM_CLASS};
import net.minecraft.core.particles.SimpleParticleType;

/** Generated by MineMods Studio: in a player's game (${target.manifest.id}) each of this mod's own particles is made by ${PARTICLE_RUNTIME.particle} from the pictures the game loaded for it. The mod's client entry runs this once. */
public final class ${PARTICLE_RUNTIME.client} {
    public static void register() {
${each(`${CLIENT_PLATFORM_CLASS}.<SimpleParticleType>particle(() -> ${table}.TYPES[spec], sprites -> new ${PARTICLE_RUNTIME.particle}.Provider(sprites, spec));`)}
    }
}
`,
    } as Record<string, string>,
    patch: {} as Record<string, (text: string) => string>,
    entries: { common: [`${input.packageName}.entity.${PARTICLE_RUNTIME.setup}`], client: [`${input.packageName}.client.${PARTICLE_RUNTIME.client}`] },
  }
}

/** `target`: what the mod is generated for (Fabric 1.21.1 by default). Only the wiring differs (`wiring`); every class is mapped to the target's game version. */
export function compileParticles(value: ParticleCompileInput, target: GenTarget = FABRIC_TARGET) {
  const input = Input.parse(value)
  const names = new Set(input.particles.map((particle) => particle.document.name))
  if (names.size !== input.particles.length) throw new Error("PARTICLE_NAME_TAKEN")
  // By name, so the number a particle has does not depend on the order assets were saved in.
  const particles = [...input.particles].sort(byName)
  const source = `src/main/java/${input.packageName.replaceAll(".", "/")}`
  const resources = `src/main/resources/assets/${input.modId}`
  const documents = particles.map((particle) => particle.document)
  const advanced = Boolean(input.emit || documents.some(d=>d.size.mid?.length || d.color.mid?.length || d.opacity.mid?.length || d.face || d.stretch !== undefined || d.drag !== undefined))
  const facing = documents.some(d=>d.face==="motion")
  const files: Record<string, string | Uint8Array> = Object.assign(
    {},
    ...particles.map((particle) => ({
      [`${resources}/particles/${particle.document.name}.json`]: JSON.stringify({ textures: particleTextureNames(particle.document).map((name) => `${input.modId}:${name}`) }, null, 2),
      ...Object.fromEntries(particle.document.frames.map((frame, index) => [`${resources}/textures/particle/${particleTextureNames(particle.document)[index]}.png`, typeof frame === "string" && !particle.document.edge ? decodeTextureDataUrl(frame) : particleTexture(frame, particle.document.edge)])),
    })),
  )
  files[`${source}/entity/${PARTICLE_RUNTIME.table}.java`] = `package ${input.packageName}.entity;

import net.minecraft.core.particles.SimpleParticleType;
import net.minecraft.core.registries.BuiltInRegistries;

/**
 * Generated by MineMods Studio: this mod's own particles. Particle i is known to the game as ${input.modId}:NAMES[i], its type is TYPES[i] and its numbers are row i of the tables below.
 * Nothing here registers them: the platform layer puts every TYPES[i] into the particle type registry under its name, and in a player's game gives it the provider
 * ${input.packageName}.client.${PARTICLE_RUNTIME.particle}.Provider(sprites, i). Until a type is registered nothing sends it (registered).
 */
public final class ${PARTICLE_RUNTIME.table} {
    public static final String MOD_ID = ${quoted(input.modId)};
    /** The name of each in the registry and of its description, assets/${input.modId}/particles/<name>.json. */
    public static final String[] NAMES = ${list(documents.map((document) => quoted(document.name)))};
    /** The asset id of each, as the creatures' abilities name it. */
    private static final String[] ASSETS = ${list(particles.map((particle) => quoted(particle.id)))};
    public static final SimpleParticleType[] TYPES = {${documents.map(() => "type()").join(", ")}};
    // Per particle, as its document says: the ticks it lives; its gravity (each tick it falls 0.04 times this many blocks a tick faster); the side of its square when it appears and when it is gone (blocks);
    // its tint when it appears and when it is gone (red, green and blue, 0 to 1, three a particle); its opacity then; how far it turns a tick (radians); whether it is drawn at full brightness;
    // whether its pictures follow one another over its life (else one is picked at random when it appears).
    public static final int[] LIFETIME = ${list(documents.map((document) => particleTicks(document)))};
    public static final float[] GRAVITY = ${list(documents.map((document) => real(document.gravity)))};
    public static final float[] SIZE_FROM = ${list(documents.map((document) => real(document.size.start)))};
    public static final float[] SIZE_TO = ${list(documents.map((document) => real(document.size.end)))};
    public static final float[] TINT_FROM = ${list(documents.flatMap((document) => channels(document.color.start).map(real)))};
    public static final float[] TINT_TO = ${list(documents.flatMap((document) => channels(document.color.end).map(real)))};
    public static final float[] ALPHA_FROM = ${list(documents.map((document) => real(document.opacity.start)))};
    public static final float[] ALPHA_TO = ${list(documents.map((document) => real(document.opacity.end)))};
    public static final float[] SPIN = ${list(documents.map((document) => real((document.spin / TICKS) * (Math.PI / 180))))};
    public static final boolean[] EMISSIVE = ${list(documents.map((document) => document.emissive))};
    public static final boolean[] BY_AGE = ${list(documents.map((document) => document.frames_by === "age"))};

    private ${PARTICLE_RUNTIME.table}() {}

    /** A type of this mod's own. The game keeps the constructor to subclasses, as it does for every particle type made outside the game; this is the same as one of the game's own simple types. */
    private static SimpleParticleType type() {
        return new SimpleParticleType(false) {};
    }

    /** The type of the particle an ability names by its asset id; null for one this mod does not have. */
    public static SimpleParticleType byAsset(String asset) {
        for (int index = 0; index < ASSETS.length; index++) if (ASSETS[index].equals(asset)) return TYPES[index];
        return null;
    }

    /** The number of a type of this mod's own, -1 for any other. */
    public static int indexOf(SimpleParticleType type) {
        for (int index = 0; index < TYPES.length; index++) if (TYPES[index] == type) return index;
        return -1;
    }

    /** Whether the game has the type in its registry: only a registered type can be sent to a player's game. */
    public static boolean registered(SimpleParticleType type) {
        return BuiltInRegistries.PARTICLE_TYPE.getKey(type) != null;
    }
}
`
  if (advanced) files[`${source}/client/StudioParticleCurves.java`] = particleCurveJava(input.packageName+".client",documents)
  if (input.emit) files[`${source}/client/StudioParticleEmit.java`]=emitJava(input.packageName)
  files[`${source}/client/${PARTICLE_RUNTIME.particle}.java`] = `package ${input.packageName}.client;

import ${input.packageName}.entity.${PARTICLE_RUNTIME.table};
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.particle.Particle;
import net.minecraft.client.particle.ParticleProvider;
import net.minecraft.client.particle.ParticleRenderType;
import net.minecraft.client.particle.SpriteSet;
import net.minecraft.client.particle.TextureSheetParticle;
import net.minecraft.core.particles.SimpleParticleType;
import net.minecraft.util.Mth;${facing ? "\nimport net.minecraft.world.phys.Vec3;" : ""}

/**
 * Generated by MineMods Studio: one of this mod's own particles in a player's game, drawn from the numbers of its row of ${PARTICLE_RUNTIME.table}. Over its life (the part of it gone, age / lifetime)
 * its side, tint and opacity go straight from what they are when it appears to what they are when it is gone; it falls by its gravity, turns by its spin, and wears its pictures one after another
 * (the game's own pick by age) or one picked when it appears. A particle that glows is drawn at full brightness. It moves off with exactly the speed it was sent with.
 */
public final class ${PARTICLE_RUNTIME.particle} extends TextureSheetParticle {
    /** Full brightness, sky and block light both at 15: what the game's own glowing particles are drawn with. */
    private static final int FULL_BRIGHT = 0xF000F0;
    private final SpriteSet sprites;
    private final int spec;${advanced ? `
    private static final float[] DRAG = ${list(documents.map(d=>real(d.drag??.98)))};` : ""}${facing ? `
    private static final boolean[] MOTION_FACE = ${list(documents.map(d=>d.face==="motion"))};
    private static final float[] STRETCH = ${list(documents.map(d=>real(d.stretch??1)))};${documents.some(d=>d.screen_limit!==undefined) ? "\n    private static final float[] SCREEN_LIMIT = "+list(documents.map(d=>real(d.screen_limit??0)))+";" : ""}` : ""}${input.emit ? `
    private final StudioParticleEmit.Spawn spawn;
    private final double startX, startY, startZ;` : ""}

    ${PARTICLE_RUNTIME.particle}(ClientLevel level, double x, double y, double z, double dx, double dy, double dz, SpriteSet sprites, int spec) {
        super(level, x, y, z);
        this.sprites = sprites;
        this.spec = spec;${advanced ? "\n        this.friction = DRAG[spec];" : ""}${input.emit ? `
        this.spawn = StudioParticleEmit.pending != null && StudioParticleEmit.pending.spec() == spec ? StudioParticleEmit.pending : null;
        startX = x; startY = y; startZ = z;` : ""}
        this.xd = dx;
        this.yd = dy;
        this.zd = dz;
        this.lifetime = ${PARTICLE_RUNTIME.table}.LIFETIME[spec];
        this.gravity = ${PARTICLE_RUNTIME.table}.GRAVITY[spec];
        if (${PARTICLE_RUNTIME.table}.BY_AGE[spec]) setSpriteFromAge(sprites);
        else pickSprite(sprites);
        show(0.0f);
    }

    /** Its tint and opacity at a part of its life (0: it has just appeared, 1: it is gone). */
    private void show(float part) {
        ${advanced ? `this.rCol = StudioParticleCurves.at(spec, 2, part);
        this.gCol = StudioParticleCurves.at(spec, 3, part);
        this.bCol = StudioParticleCurves.at(spec, 4, part);
        this.alpha = StudioParticleCurves.at(spec, 1, part);${input.emit ? `
        if (spawn != null && spawn.tint() >= 0) {
            rCol *= ((spawn.tint() >> 16) & 255) / 255.0f;
            gCol *= ((spawn.tint() >> 8) & 255) / 255.0f;
            bCol *= (spawn.tint() & 255) / 255.0f;
        }` : ""}` : `int at = spec * 3;
        this.rCol = Mth.lerp(part, ${PARTICLE_RUNTIME.table}.TINT_FROM[at], ${PARTICLE_RUNTIME.table}.TINT_TO[at]);
        this.gCol = Mth.lerp(part, ${PARTICLE_RUNTIME.table}.TINT_FROM[at + 1], ${PARTICLE_RUNTIME.table}.TINT_TO[at + 1]);
        this.bCol = Mth.lerp(part, ${PARTICLE_RUNTIME.table}.TINT_FROM[at + 2], ${PARTICLE_RUNTIME.table}.TINT_TO[at + 2]);
        this.alpha = Mth.lerp(part, ${PARTICLE_RUNTIME.table}.ALPHA_FROM[spec], ${PARTICLE_RUNTIME.table}.ALPHA_TO[spec]);`}
    }

    @Override public void tick() {
        super.tick();
        if (!isAlive()) return;${input.emit ? `
        if (spawn != null && spawn.motion() == 1) {
            double t = (double)age / lifetime;
            setPos(Mth.lerp(t*t,startX,spawn.x()), Mth.lerp(t*t,startY,spawn.y()), Mth.lerp(t*t,startZ,spawn.z()));
        } else if (spawn != null && spawn.motion() == 2) {
            double angle = Math.PI * 2 * spawn.turns() / 20, c = Math.cos(angle), s = Math.sin(angle);
            double rx=x-spawn.x(), rz=z-spawn.z(), vx=xd;
            setPos(spawn.x()+c*rx-s*rz, y, spawn.z()+s*rx+c*rz);
            xd=c*vx-s*zd; zd=s*vx+c*zd;
        }` : ""}
        this.oRoll = this.roll;
        this.roll += ${PARTICLE_RUNTIME.table}.SPIN[spec];
        if (${PARTICLE_RUNTIME.table}.BY_AGE[spec]) setSpriteFromAge(sprites);
        show((float) this.age / (float) this.lifetime);
    }

    /** Half the side of its square (the game's measure), between ticks too, so it grows or shrinks smoothly. */
    @Override public float getQuadSize(float partialTick) {
        float part = Mth.clamp((this.age + partialTick) / (float) this.lifetime, 0.0f, 1.0f);
        return ${advanced ? "StudioParticleCurves.at(spec, 0, part)" : `Mth.lerp(part, ${PARTICLE_RUNTIME.table}.SIZE_FROM[spec], ${PARTICLE_RUNTIME.table}.SIZE_TO[spec])`} / 2.0f;
    }${facing ? "\n"+motionRender(target.version.minecraft === "1.20.1",documents.some(d=>d.screen_limit!==undefined)) : ""}

    @Override public ParticleRenderType getRenderType() {
        return ParticleRenderType.PARTICLE_SHEET_TRANSLUCENT;
    }

    @Override protected int getLightColor(float partialTick) {
        return ${PARTICLE_RUNTIME.table}.EMISSIVE[spec] ? FULL_BRIGHT : super.getLightColor(partialTick);
    }

    /** What the platform layer gives the game for ${PARTICLE_RUNTIME.table}.TYPES[spec]: makes that particle from the pictures the game loaded for it. */
    public static final class Provider implements ParticleProvider<SimpleParticleType> {
        private final SpriteSet sprites;
        private final int spec;

        public Provider(SpriteSet sprites, int spec) {
            this.sprites = sprites;
            this.spec = spec;
        }

        @Override public Particle createParticle(SimpleParticleType type, ClientLevel level, double x, double y, double z, double dx, double dy, double dz) {
            return new ${PARTICLE_RUNTIME.particle}(level, x, y, z, dx, dy, dz, sprites, spec);
        }
    }
}
`
  const wired = wiring(input, target)
  Object.assign(files, wired.files)
  for (const [name, text] of Object.entries(files)) if (name.endsWith(".java") && typeof text === "string") files[name] = target.version.rewriteJava(text)
  const pack = input.packageName.replaceAll(".", "/")
  return {
    files,
    /** Paths inside the built jar that prove the particles and their wiring went in. */
    classes: [`${pack}/entity/${PARTICLE_RUNTIME.table}.class`, `${pack}/entity/${PARTICLE_RUNTIME.setup}.class`, `${pack}/client/${PARTICLE_RUNTIME.client}.class`, `assets/${input.modId}/particles/${documents[0]!.name}.json`],
    /** Fabric: its two entry points, named in fabric.mod.json. */
    patch: wired.patch,
    /** A facade target: the two classes whose register() the mod's common and client entries run. */
    entries: wired.entries,
  }
}
