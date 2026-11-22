import { z } from "zod"
import { EFFECT_LIMITS } from "../ability-words"
import { EffectDocumentSchema, effectMeasure, effectName, effectPlan } from "../effect"
import { compileEffectModel } from "../effect-build"
import { decodeRgbaPng } from "../png-decode"
import { glowMaskPath } from "../glow-mask"
import type { GenTarget } from "../platform/adapter"
import { CLIENT_PLATFORM_CLASS, PLATFORM_CLASS, PLATFORM_PACKAGE } from "../platform/facade"
import { FABRIC_TARGET } from "../platform/target"

/**
 * What effects add to a generated mod: one entity type for all of them (`studio_effect`), its two classes,
 * its renderer, and each effect's model, motion and texture. The entity is not alive: it has no AI, no
 * collision and takes no damage, it is never written to disk, and it removes itself when its time is up.
 * Which effect one is, is a single synced number; a player's game reads everything else from tables
 * compiled in, and plays the effect's motion from the moment the entity appears.
 * Every Minecraft, Fabric and GeckoLib name used here is Mojang's official name, checked with javac against the 1.21.1 jar, Fabric
 * API and GeckoLib 4.8.3. Only called when a project has effects, so a project without any is untouched.
 */

const Input = z.strictObject({
  modId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  fading: z.boolean().optional(),
  /** r29c: some effect is shown at a size of its own (an effect event's `size`): only then does the entity carry one and the table take one. */
  sized: z.boolean().optional(),
  effects: z.array(z.strictObject({ id: z.uuid(), title: z.string(), document: EffectDocumentSchema })).min(1),
})
export type EffectCompileInput = z.input<typeof Input>

/** The name every effect entity has in the game's registry, and the class the generated creatures and gameplay code show effects through. */
export const EFFECT_RUNTIME = { registry: "studio_effect", entity: "StudioEffect", table: "StudioEffects", client: "StudioEffectClient", renderer: "StudioEffectRenderer" } as const

const quoted = (value: string) => JSON.stringify(value)
const list = (values: readonly (string | number | boolean)[]) => `{${values.join(", ")}}`
const single = (value: number) => `${Number(value.toFixed(4))}f`
/** Whether a glow picture has any pixel that shows. */
const visible = (png: Uint8Array) => {
  const { pixels } = decodeRgbaPng(png)
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! > 0) return true
  return false
}

/**
 * `target`: Fabric 1.21.1 (the default) is this file's own text and its edit to fabric.mod.json, exactly as before. A facade target (A 组) registers the one
 * entity type through `StudioPlatform.entity` (its field holds a supplier of it) and its renderer through `StudioClientPlatform.renderer`, from two `register()`
 * the mod's common and client entries run (`entries`); every class is mapped to its game version, and what is written differently per version is the version's.
 */
export function compileEffects(value: EffectCompileInput, target: GenTarget = FABRIC_TARGET) {
  const input = Input.parse(value)
  const facade = target.loader.facade
  const version = target.version
  // By asset id, so the number an effect has does not depend on the order assets were saved in.
  const effects = [...input.effects].sort((left, right) => left.id.localeCompare(right.id))
  const source = `src/main/java/${input.packageName.replaceAll(".", "/")}`
  const resources = `src/main/resources/assets/${input.modId}`
  const made = effects.map((effect) => {
    const name = effectName(effect.id)
    // The texture space its document names is where it starts: a model whose faces need more is given the next size up.
    const compiled = compileEffectModel(effect.document, name)
    const own = new Set(effect.document.animations.map((animation) => `animation.${name}.${animation.name}`))
    const clip = effect.document.animations.find((animation) => animation.name === effect.document.play.clip)!
    return { effect, name, compiled, clip, plan: effectPlan(effect.document.play), animation: { ...compiled.animation, animations: Object.fromEntries(Object.entries(compiled.animation.animations).filter(([key]) => own.has(key))) } }
  })
  // Which effects have a glow picture with something in it. GeckoLib refuses a glow picture without a single visible pixel ("Invalid glow layer texture
  // provided, must have at least one pixel!"), and the game crashes the moment such an effect is drawn: the 蚩尤 run of 2026-11-16 crashed every client
  // 0.6 s into its death show, when the one effect that did not glow (the weapons stuck in the ground) appeared beside effects that did. So only an
  // effect that glows has a mask, and the shared renderer's glow layer passes over the others.
  const lit = made.map((entry) => !!entry.compiled.glow && visible(entry.compiled.glow))
  const glows = lit.some(Boolean)
  // 第 4 步: some effect is added to what is behind it (\`play.blend\`); without one every class is what it was, to the byte.
  const additive = made.some((entry) => entry.effect.document.play.blend === "additive")
  const files: Record<string, string | Uint8Array> = {
    ...Object.assign(
      {},
      ...made.map((entry, index) => ({
        [`${resources}/geo/${entry.name}.geo.json`]: JSON.stringify(entry.compiled.geometry, null, 2),
        [`${resources}/animations/${entry.name}.animation.json`]: JSON.stringify(entry.animation, null, 2),
        [`${resources}/textures/entity/${entry.name}.png`]: entry.compiled.png,
        ...(lit[index] ? { [glowMaskPath(`${resources}/textures/entity/${entry.name}.png`)]: entry.compiled.glow! } : {}),
      })),
    ),
    [`${source}/entity/${EFFECT_RUNTIME.table}.java`]: `package ${input.packageName}.entity;

${
  facade
    ? `import ${input.packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import java.util.List;
import java.util.function.Supplier;
`
    : `import java.util.List;
import net.fabricmc.api.ModInitializer;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
`}import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.shapes.CollisionContext;
import software.bernie.geckolib.animation.RawAnimation;

/** Generated by MineMods Studio: the effects of this mod, each a small model that appears for a moment. One entity type shows them all. */
public final class ${EFFECT_RUNTIME.table}${facade ? "" : " implements ModInitializer"} {
    public static final String MOD_ID = ${quoted(input.modId)};
    // Never written to disk and never summoned by command: an effect only exists because something just showed it.
${
  facade
    ? `    public static final Supplier<EntityType<${EFFECT_RUNTIME.entity}>> TYPE = ${PLATFORM_CLASS}.entity("${EFFECT_RUNTIME.registry}",
        () -> EntityType.Builder.<${EFFECT_RUNTIME.entity}>of(${EFFECT_RUNTIME.entity}::new, MobCategory.MISC)
            .sized(0.25f, 0.25f).noSave().noSummon().fireImmune().clientTrackingRange(4).updateInterval(1).build("${EFFECT_RUNTIME.registry}"));`
    : `    public static final EntityType<${EFFECT_RUNTIME.entity}> TYPE = Registry.register(
        BuiltInRegistries.ENTITY_TYPE, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${EFFECT_RUNTIME.registry}"),
        EntityType.Builder.<${EFFECT_RUNTIME.entity}>of(${EFFECT_RUNTIME.entity}::new, MobCategory.MISC)
            .sized(0.25f, 0.25f).noSave().noSummon().fireImmune().clientTrackingRange(4).updateInterval(1).build("${EFFECT_RUNTIME.registry}"));`
}
    // One row an effect, in the order of their asset ids.
${made.map((entry, index) => `    // ${index}: "${entry.effect.title.replace(/[\r\n*\\]/g, " ")}" plays "${entry.clip.name}" for ${entry.plan.ticks} ticks.`).join("\n")}
    private static final List<String> IDS = List.of(${made.map((entry) => quoted(entry.effect.id)).join(", ")});
    public static final String[] NAMES = ${list(made.map((entry) => quoted(entry.name)))};
    public static final RawAnimation[] CLIPS = {
${made.map((entry) => `        RawAnimation.begin().${entry.clip.loop ? "thenLoop" : "thenPlayAndHold"}("animation.${entry.name}.${entry.clip.name}"),`).join("\n")}
    };
    /** How many ticks each lives. */
    public static final int[] LIFE = ${list(made.map((entry) => entry.plan.ticks))};
    public static final boolean[] FOLLOWS = ${list(made.map((entry) => entry.plan.follow))};
    public static final boolean[] ENDS_WITH_OWNER = ${list(made.map((entry) => entry.plan.ends_with_owner))};
    public static final boolean[] ON_GROUND = ${list(made.map((entry) => entry.effect.document.play.on_ground))};
    public static final boolean[] FACES_TARGET = ${list(made.map((entry) => entry.effect.document.play.facing === "target"))};
    public static final boolean[] FACES_CAMERA = ${list(made.map((entry) => entry.effect.document.play.facing === "camera"))};
    public static final boolean[] BRIGHT = ${list(made.map((entry) => entry.effect.document.play.bright))};${glows ? `\n    /** Which have a glow picture: the renderer's glow layer draws only these. */\n    public static final boolean[] GLOWS = ${list(lit)};` : ""}
    public static final float[] OPACITY = ${list(made.map((entry) => single(entry.effect.document.play.opacity)))};
${additive ? `    /** 第 4 步: drawn added to what is behind it at full brightness (the game's eyes layer). */
    public static final boolean[] ADDITIVE = ${list(made.map((entry) => entry.effect.document.play.blend === "additive"))};

    /** Whether the effect of this name (a thrown thing's look) is drawn added to what is behind it. */
    public static boolean additive(String name) {
        for (int index = 0; index < NAMES.length; index++) if (NAMES[index].equals(name)) return ADDITIVE[index];
        return false;
    }
` : ""}    /** How far from where it stands each one's model ever reaches, in blocks: it is drawn while any of that is on screen. */
    public static final double[] REACH = ${list(made.map((entry) => (effectMeasure(entry.effect.document)?.reach ?? 1) + 1).map((value) => (Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(2))))))};

${
  facade
    ? `    private ${EFFECT_RUNTIME.table}() {}

    /** Run by the mod's common entry while the mod is constructed: loading this class registers the entity type (its field above). */
    public static void register() {}`
    : `    // Fabric builds a main entrypoint through its no-argument constructor, which must be public.
    public ${EFFECT_RUNTIME.table}() {}`
}

    /** The number of one effect by its asset id. */
    public static int kind(String id) {
        int kind = IDS.indexOf(id);
        if (kind < 0) throw new IllegalArgumentException("This project has no effect " + id);
        return kind;
    }

    /**
     * Shows one effect at a place, its front turned to \`yaw\`. \`owner\` (may be null) is who it belongs to: an
     * effect made to follow keeps its place beside the owner, and one made to end with its owner is gone when
     * the owner is. \`target\` (may be null) is who an effect that faces its target turns to.
     * Does nothing and answers null in a player's own game: effects are shown from the server.
     */
    public static ${EFFECT_RUNTIME.entity} spawn(String id, Level world, Vec3 pos, float yaw, Entity owner, Entity target) {
        return spawn(id, world, pos, yaw, 0.0f, 0.0f, owner, target);
    }

    /**
     * The same, tilted: after its front is turned to \`yaw\` it is raised \`tilt\` degrees (negative: lowered), and then turned
     * \`spin\` degrees to its own left about its own tilted upright. One that lies on the ground or always faces the
     * player is not tilted; one that faces its target keeps the tilt and has no turn of its own.
     */
    public static ${EFFECT_RUNTIME.entity} spawn(String id, Level world, Vec3 pos, float yaw, float tilt, float spin, Entity owner, Entity target) {
${input.sized ? `        return spawn(id, world, pos, yaw, tilt, spin, owner, target, 1.0f);
    }

    /** The same, drawn size times as large as its model is built, about its own origin. */
    public static ${EFFECT_RUNTIME.entity} spawn(String id, Level world, Vec3 pos, float yaw, float tilt, float spin, Entity owner, Entity target, float size) {
` : ""}        int kind = kind(id);
        if (world.isClientSide()) return null;
        ${EFFECT_RUNTIME.entity} effect = new ${EFFECT_RUNTIME.entity}(${facade ? "TYPE.get()" : "TYPE"}, world);
        boolean faces = FACES_TARGET[kind] && target != null;
        float turned = faces ? (float) (Math.atan2(target.getZ() - pos.z, target.getX() - pos.x) * 180.0 / Math.PI) - 90.0f : yaw;
        effect.begin(kind, owner, pos, turned, ON_GROUND[kind] || FACES_CAMERA[kind] ? 0.0f : tilt, faces || FACES_CAMERA[kind] ? 0.0f : spin);
${input.sized ? "        effect.size(size);\n" : ""}        world.addFreshEntity(effect);
        return effect;
    }

    /** The top of the ground under a place, looking at most ${EFFECT_LIMITS.fall} blocks down; the place itself when there is none. A hair above it, so a flat model does not flicker against the block. */
    static double ground(Level world, double x, double y, double z) {
        BlockHitResult hit = world.clip(new ClipContext(new Vec3(x, y + 0.5, z), new Vec3(x, y - ${EFFECT_LIMITS.fall}.0, z), ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, CollisionContext.empty()));
        return hit.getType() == HitResult.Type.MISS ? y : hit.getLocation().y + 0.02;
    }
${
  facade
    ? ""
    : `
    // Loading this class registers the entity type; nothing else is needed at start.
    @Override public void onInitialize() {}
`
}}
`,
    [`${source}/entity/${EFFECT_RUNTIME.entity}.java`]: `package ${input.packageName}.entity;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.util.Mth;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.level.Explosion;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.material.PushReaction;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import org.joml.Vector3f;
import software.bernie.geckolib.animatable.GeoEntity;
import software.bernie.geckolib.animatable.instance.AnimatableInstanceCache;
import software.bernie.geckolib.animation.AnimatableManager;
import software.bernie.geckolib.animation.AnimationController;
import software.bernie.geckolib.util.GeckoLibUtil;

/** Generated by MineMods Studio: one effect in the world. It is looked at and nothing else: it cannot be hit, pushed, saved or walked into. */
public class ${EFFECT_RUNTIME.entity} extends Entity implements GeoEntity {
    // Which effect this is: the one thing a player's game is told about it beyond where it stands.
    private static final EntityDataAccessor<Integer> KIND = SynchedEntityData.defineId(${EFFECT_RUNTIME.entity}.class, EntityDataSerializers.INT);
    // How it was turned when it appeared, in degrees: its facing, how far its front is raised, and its own turn about its tilted upright.
    // Sent as written: the game's own packets round a facing down to 1/256 of a turn (1.4 degrees, a third of a block at the far end of
    // a twelve-block effect) and a player's game starts every new entity's tilt from level for a tick.
    private static final EntityDataAccessor<Vector3f> AIM = SynchedEntityData.defineId(${EFFECT_RUNTIME.entity}.class, EntityDataSerializers.VECTOR3);
    private final AnimatableInstanceCache animations = GeckoLibUtil.createInstanceCache(this);
    private Entity owner;
    private boolean owned;
    // Where it stands beside its owner, in the owner's own terms, and how far it is turned from the way the owner faces.
    private double ahead;
    private double above;
    private double beside;
    private float turned;
${input.fading ? `    private static final EntityDataAccessor<Float> ALPHA = SynchedEntityData.defineId(${EFFECT_RUNTIME.entity}.class, EntityDataSerializers.FLOAT);
    public float alpha() { return getEntityData().get(ALPHA); }
    public void alpha(float value) { getEntityData().set(ALPHA, value); }\n` : ""}${input.sized ? `    // r29c: how many times as large as its model is built it is drawn, sent to every player's game with it.
    private static final EntityDataAccessor<Float> SIZE = SynchedEntityData.defineId(${EFFECT_RUNTIME.entity}.class, EntityDataSerializers.FLOAT);
    public float size() { return getEntityData().get(SIZE); }
    public void size(float value) { getEntityData().set(SIZE, value); }\n` : ""}    private int lived;

    public ${EFFECT_RUNTIME.entity}(EntityType<? extends ${EFFECT_RUNTIME.entity}> type, Level world) {
        super(type, world);
        noPhysics = true;
        setNoGravity(true);
    }

    @Override protected void defineSynchedData(SynchedEntityData.Builder builder) {
        builder.define(KIND, 0);
        builder.define(AIM, new Vector3f());${input.fading ? "\n        builder.define(ALPHA, 1f);" : ""}${input.sized ? "\n        builder.define(SIZE, 1f);" : ""}
    }

    /** Facing, tilt (raised is positive) and own turn, in degrees, as it appeared. */
    public Vector3f aim() { return getEntityData().get(AIM); }

    public int kind() { return Mth.clamp(getEntityData().get(KIND), 0, ${EFFECT_RUNTIME.table}.LIFE.length - 1); }

    public boolean endsWithOwner() { return ${EFFECT_RUNTIME.table}.ENDS_WITH_OWNER[kind()]; }

    private static float facing(Entity entity) { return entity instanceof LivingEntity living ? living.yBodyRot : entity.getYRot(); }

    void begin(int kind, Entity owner, Vec3 pos, float yaw, float tilt, float spin) {
        getEntityData().set(KIND, kind);
        getEntityData().set(AIM, new Vector3f(yaw, tilt, spin));
        this.owner = owner;
        owned = owner != null;
        if (owned) {
            float turn = facing(owner) * 0.017453292f;
            double dx = pos.x - owner.getX();
            double dz = pos.z - owner.getZ();
            ahead = -dx * Mth.sin(turn) + dz * Mth.cos(turn);
            beside = dx * Mth.cos(turn) + dz * Mth.sin(turn);
            above = pos.y - owner.getY();
            turned = yaw - facing(owner);
        }
        moveTo(pos.x, ${EFFECT_RUNTIME.table}.ON_GROUND[kind] ? ${EFFECT_RUNTIME.table}.ground(level(), pos.x, pos.y, pos.z) : pos.y, pos.z, yaw, -tilt);
    }

    @Override public void tick() {
        super.tick();
        if (level().isClientSide()) return;
        // Its time is up.
        if (++lived >= ${EFFECT_RUNTIME.table}.LIFE[kind()]) {
            discard();
            return;
        }
        if (!owned) return;
        if (owner == null || !owner.isAlive()) {
            if (endsWithOwner()) discard();
            return;
        }
        if (!${EFFECT_RUNTIME.table}.FOLLOWS[kind()]) return;
        // Keeps its place beside its owner, turning with it.
        float turn = facing(owner) * 0.017453292f;
        double x = owner.getX() - ahead * Mth.sin(turn) + beside * Mth.cos(turn);
        double z = owner.getZ() + ahead * Mth.cos(turn) + beside * Mth.sin(turn);
        double y = owner.getY() + above;
        setPos(x, ${EFFECT_RUNTIME.table}.ON_GROUND[kind()] ? ${EFFECT_RUNTIME.table}.ground(level(), x, y, z) : y, z);
        setYRot(facing(owner) + turned);
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

    // Its model is larger than the small box it stands in, so what decides whether it is drawn is how far the model reaches.
    @Override public boolean shouldRenderAtSqrDistance(double distance) { return distance < 4096.0; }
    @Override public AABB getBoundingBoxForCulling() { return getBoundingBox().inflate(${EFFECT_RUNTIME.table}.REACH[kind()]); }

    @Override public void registerControllers(AnimatableManager.ControllerRegistrar controllers) {
        // Its one motion, from the moment it appears in a player's game.
        controllers.add(new AnimationController<>(this, "life", 0, state -> state.setAndContinue(${EFFECT_RUNTIME.table}.CLIPS[kind()])));
    }

    @Override public AnimatableInstanceCache getAnimatableInstanceCache() { return animations; }
}
`,
    [`${source}/client/${EFFECT_RUNTIME.client}.java`]: facade
      ? `package ${input.packageName}.client;

import ${input.packageName}.entity.${EFFECT_RUNTIME.table};
import ${input.packageName}.${PLATFORM_PACKAGE}.${CLIENT_PLATFORM_CLASS};

/** Generated by MineMods Studio: draws this mod's effects (${target.manifest.id}). The mod's client entry runs this once. */
public final class ${EFFECT_RUNTIME.client} {
    public static void register() {
        ${CLIENT_PLATFORM_CLASS}.renderer(${EFFECT_RUNTIME.table}.TYPE, ${EFFECT_RUNTIME.renderer}::new);
    }
}
`
      : `package ${input.packageName}.client;

import ${input.packageName}.entity.${EFFECT_RUNTIME.table};
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;

/** Generated by MineMods Studio: draws this mod's effects. */
public final class ${EFFECT_RUNTIME.client} implements ClientModInitializer {
    @Override public void onInitializeClient() {
        EntityRendererRegistry.register(${EFFECT_RUNTIME.table}.TYPE, ${EFFECT_RUNTIME.renderer}::new);
    }
}
`,
    [`${source}/client/${EFFECT_RUNTIME.renderer}.java`]: `package ${input.packageName}.client;

import ${input.packageName}.entity.${EFFECT_RUNTIME.entity};
import ${input.packageName}.entity.${EFFECT_RUNTIME.table};
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.core.BlockPos;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.Mth;
import software.bernie.geckolib.model.GeoModel;
import software.bernie.geckolib.renderer.GeoEntityRenderer;
${glows ? "import com.mojang.blaze3d.vertex.VertexConsumer;\nimport software.bernie.geckolib.cache.object.BakedGeoModel;\nimport software.bernie.geckolib.renderer.layer.AutoGlowingGeoLayer;\n" : ""}import software.bernie.geckolib.util.Color;

public final class ${EFFECT_RUNTIME.renderer} extends GeoEntityRenderer<${EFFECT_RUNTIME.entity}> {
    public ${EFFECT_RUNTIME.renderer}(EntityRendererProvider.Context context) {
        super(context, new GeoModel<${EFFECT_RUNTIME.entity}>() {
            @Override public ResourceLocation getModelResource(${EFFECT_RUNTIME.entity} effect) {
                return ResourceLocation.fromNamespaceAndPath(${EFFECT_RUNTIME.table}.MOD_ID, "geo/" + ${EFFECT_RUNTIME.table}.NAMES[effect.kind()] + ".geo.json");
            }
            @Override public ResourceLocation getTextureResource(${EFFECT_RUNTIME.entity} effect) {
                return ResourceLocation.fromNamespaceAndPath(${EFFECT_RUNTIME.table}.MOD_ID, "textures/entity/" + ${EFFECT_RUNTIME.table}.NAMES[effect.kind()] + ".png");
            }
            @Override public ResourceLocation getAnimationResource(${EFFECT_RUNTIME.entity} effect) {
                return ResourceLocation.fromNamespaceAndPath(${EFFECT_RUNTIME.table}.MOD_ID, "animations/" + ${EFFECT_RUNTIME.table}.NAMES[effect.kind()] + ".animation.json");
            }
        });
        this.shadowRadius = 0.0f;${
          glows
            ? `
        // Draws the texels of each glowing effect's _glowmask.png at full brightness, whatever the light around. One that does not glow has no
        // mask, so the layer passes over it: GeckoLib would refuse an empty one and crash the game.
        addRenderLayer(new AutoGlowingGeoLayer<>(this) {
            @Override public void render(PoseStack poseStack, ${EFFECT_RUNTIME.entity} effect, BakedGeoModel bakedModel, RenderType renderType, MultiBufferSource bufferSource, VertexConsumer buffer, float partialTick, int packedLight, int packedOverlay) {
                if (${EFFECT_RUNTIME.table}.GLOWS[effect.kind()]) super.render(poseStack, effect, bakedModel, renderType, bufferSource, buffer, partialTick, packedLight, packedOverlay);
            }
        });`
            : ""
        }
    }

    // Full brightness is the game's own way for things that give light of their own: the block light is taken as the highest there is.
    @Override protected int getBlockLightLevel(${EFFECT_RUNTIME.entity} effect, BlockPos pos) {
        return ${EFFECT_RUNTIME.table}.BRIGHT[effect.kind()] ? 15 : super.getBlockLightLevel(effect, pos);
    }

    // One that lets the world show through is drawn on the game's translucent entity layer, evenly see-through; the others as every creature is.
    @Override public RenderType getRenderType(${EFFECT_RUNTIME.entity} effect, ResourceLocation texture, MultiBufferSource buffers, float partialTick) {
        ${input.fading ? "if (effect.alpha() < 1f) return RenderType.entityTranslucent(texture);\n        " : ""}return ${additive ? `${EFFECT_RUNTIME.table}.ADDITIVE[effect.kind()] ? RenderType.eyes(texture) : ` : ""}${EFFECT_RUNTIME.table}.OPACITY[effect.kind()] < 1.0f ? RenderType.entityTranslucent(texture) : super.getRenderType(effect, texture, buffers, partialTick);
    }

    @Override public Color getRenderColor(${EFFECT_RUNTIME.entity} effect, float partialTick, int packedLight) {
        return Color.ofRGBA(1.0f, 1.0f, 1.0f, ${EFFECT_RUNTIME.table}.OPACITY[effect.kind()]${input.fading ? " * effect.alpha()" : ""});
    }

    // It is not alive, so nothing turns it but its own facing: the way it was shown, or toward whoever looks at it.
    @Override protected void applyRotations(${EFFECT_RUNTIME.entity} effect, PoseStack matrices, float ageInTicks, float rotationYaw, float partialTick, float nativeScale) {
${input.sized ? "        // r29c: the size it was shown at; the same every way, so made before the turns it is the same as after them.\n        if (effect.size() != 1.0f) matrices.scale(effect.size(), effect.size(), effect.size());\n" : ""}        if (${EFFECT_RUNTIME.table}.FACES_CAMERA[effect.kind()]) {
            matrices.mulPose(Axis.YP.rotationDegrees(-this.entityRenderDispatcher.camera.getYRot()));
            return;
        }
        // One that follows its owner turns with it tick by tick; one that stays keeps exactly the facing it appeared with.
        float yaw = ${EFFECT_RUNTIME.table}.FOLLOWS[effect.kind()] ? Mth.rotLerp(partialTick, effect.yRotO, effect.getYRot()) : effect.aim().x;
        matrices.mulPose(Axis.YP.rotationDegrees(180.0f - yaw));
        // Its model's front is -Z here: a turn about X by the tilt raises it, and its own turn is made inside the tilt.
        matrices.mulPose(Axis.XP.rotationDegrees(effect.aim().y));
        matrices.mulPose(Axis.YP.rotationDegrees(effect.aim().z));
    }
}
`,
  }
  if (facade) {
    // The effect entity extends the game's Entity itself, and its renderer turns the model in applyRotations: both in the version's own members (C 组's `body`).
    const entity = `${source}/entity/${EFFECT_RUNTIME.entity}.java`
    const renderer = `${source}/client/${EFFECT_RUNTIME.renderer}.java`
    files[entity] = version.body.plainEntity(String(files[entity]))
    files[renderer] = version.body.rotations(String(files[renderer]))
    for (const [name, text] of Object.entries(files)) if (name.endsWith(".java") && typeof text === "string") files[name] = version.rewriteJava(text)
  }
  return {
    files,
    language: { zh_cn: { [`entity.${input.modId}.${EFFECT_RUNTIME.registry}`]: "效果" }, en_us: { [`entity.${input.modId}.${EFFECT_RUNTIME.registry}`]: "Effect" } },
    /** For the build record: every effect with its number in the generated tables. */
    /** 第 4 步: some effect is drawn added to what is behind it (a thrown thing that looks like it is drawn so too). */
    additive,
    manifest: made.map((entry, index) => ({ id: entry.effect.id, title: entry.effect.title, name: entry.name, kind: index, clip: entry.clip.name, ticks: entry.plan.ticks })),
    /** Paths inside the built jar that prove the effects went in. */
    classes: [`${input.packageName.replaceAll(".", "/")}/entity/${EFFECT_RUNTIME.table}.class`, `assets/${input.modId}/geo/${made[0]!.name}.geo.json`],
    /** Paths inside the built jar of the glow pictures the renderer's glow layer reads: one beside the texture of every effect that glows. */
    glowMasks: made.filter((_, index) => lit[index]).map((entry) => glowMaskPath(`assets/${input.modId}/textures/entity/${entry.name}.png`)),
    /** Edits to files the scaffold wrote: the two classes start with the mod. A facade target has none: its entries run them (`entries`). */
    patch: (facade
      ? {}
      : {
          "src/main/resources/fabric.mod.json": (text: string) => {
            const metadata = z.record(z.string(), z.unknown()).parse(JSON.parse(text))
            const entrypoints = z.looseObject({ main: z.array(z.string()), client: z.array(z.string()).default([]) }).parse(metadata.entrypoints)
            const edited = `${JSON.stringify({ ...metadata, entrypoints: { ...entrypoints, main: [...entrypoints.main, `${input.packageName}.entity.${EFFECT_RUNTIME.table}`], client: [...entrypoints.client, `${input.packageName}.client.${EFFECT_RUNTIME.client}`] } }, null, 2)}\n`
            return text.includes("\r\n") ? edited.replaceAll("\n", "\r\n") : edited
          },
        }) as Record<string, (text: string) => string>,
    /** A facade target: the two classes whose register() the mod's common and client entries run. */
    entries: facade ? { common: [`${input.packageName}.entity.${EFFECT_RUNTIME.table}`], client: [`${input.packageName}.client.${EFFECT_RUNTIME.client}`] } : { common: [] as string[], client: [] as string[] },
  }
}
