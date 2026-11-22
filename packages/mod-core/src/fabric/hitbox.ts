import { z } from "zod"
import { solidBodyFile } from "./solid-body"
import { collisionParts, type Hitbox } from "../entity-runtime"
import { HITBOX_FOLLOW, type HitboxFollow } from "../hitbox-follow"
import type { GenTarget } from "../platform/adapter"
import { CLIENT_PLATFORM_CLASS, PLATFORM_CLASS, PLATFORM_PACKAGE } from "../platform/facade"
import { FABRIC_TARGET } from "../platform/target"

/**
 * What creatures with more collision boxes than one add to a generated mod: one entity type for every such box
 * (`studio_part`), its class, and the two classes that register it. A part is a real entity with its own id that
 * is nothing but a box: not saved, no AI, no physics, nothing drawn. Its creature spawns it, puts it beside
 * itself every tick turned with its body, and takes it away when it goes. Whatever is done to a part is done to
 * the creature: a player's swing is redone on the creature itself (`skipAttackInteraction`), every other damage is passed
 * on with its source (`hurt`), a use is passed on (`interact`), and to projectiles and to the crosshair it
 * stands where its creature stands in a line of riders (`getRootVehicle`), which is what the game asks to keep
 * a creature's own shots off itself.
 * Every Minecraft name used here is Mojang's (1.21.1, Loom's officialMojangMappings); Fabric API's were read with javap from its jar.
 * Only called when a creature has parts, so a project without any is untouched.
 */

const Input = z.strictObject({
  modId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  /** A creature of the mod flies and has parts: a part is carried by the lean of its creature's flight. A mod without one is written as it always was. */
  lean: z.boolean().default(false),
  /** A creature of the mod has a part that follows a bone (`hitbox-follow.ts`): a part asks its creature how far it is moved, and every player's game is told. A mod without one is written as it always was. */
  follow: z.boolean().default(false),
  combat: z.boolean().default(false),
  solid: z.boolean().default(false),
  blockers: z.boolean().default(false),
})

/** The name every part has in the game's registry, and the classes the generated creatures keep their parts through. */
export const PART_RUNTIME = { registry: "studio_part", entity: "StudioPart", table: "StudioParts", client: "StudioPartClient" } as const

const single = (value: number) => `${Number(value.toFixed(4))}f`

/**
 * What the class of a creature with a part that follows a bone is told besides its table: whether it has abilities (the ability that runs is a motion of the table),
 * and `busy`: a Java condition, true while its body plays a motion the table does not have (a boss's show, a habit's motion, flying, dying): its parts then stand as stated.
 */
export type FollowSource = { table: HitboxFollow; abilities: boolean; busy: string }

/** The table (`hitbox-follow.ts`) as fields of the class: which column each part is, and per motion its length, whether it goes round and its rows. */
function followFields(table: HitboxFollow, abilities: boolean) {
  return `    // ---- parts that follow a bone of the model: how far the bone has gone from where it stands as built, every ${HITBOX_FOLLOW.every} ticks of each motion its server knows it is in ----
    // Per part, its column in the rows (-1: it stands where it is stated).
    private static final int[] HITBOX_COLUMNS = {${table.columns.join(", ")}};
    private static final int HITBOX_FOLLOWERS = ${table.followers};
    // The motions (${table.motions.map((motion) => motion.name.replace(/[^A-Za-z0-9_]/g, "")).join(", ")}): their length in ticks, whether they go round, and their rows. A row is, for every follower in turn, how far
    // ahead, up and to its left its bone is from where it stands as built: ${HITBOX_FOLLOW.letters} letters a value, a to p, in 1/${HITBOX_FOLLOW.unit} of a block, ${HITBOX_FOLLOW.zero} for none.
    private static final int[] HITBOX_MOTION_TICKS = {${table.motions.map((motion) => motion.ticks).join(", ")}};
    private static final boolean[] HITBOX_MOTION_LOOPS = {${table.motions.map((motion) => String(motion.loop)).join(", ")}};
    private static final String[] HITBOX_MOVES = {
${table.motions.map((motion) => `        ${JSON.stringify(motion.moves)},`).join("\n")}
    };
    private static final int HITBOX_IDLE = ${table.idle};
    private static final int HITBOX_WALK = ${table.walk};
${abilities ? `    // Per ability, the row of its motion (-1: none).\n    private static final int[] HITBOX_ABILITY_MOTION = {${table.abilities.join(", ")}};\n` : ""}    // The row its body is in (-1: one the table does not have, and the parts stand as stated) and how many ticks into it.
    private int hitboxMotion = -1;
    private double hitboxTick;
`
}

/** Which motion the body is in on each tick (`hitboxPose`), and how far that moves a part (`hitboxMoved`, which the part asks). */
function followMethods(follow: FollowSource, modifier: "private" | "public" | "@Override public") {
  return `    /** Which motion of the table its body is in on this tick, and how many ticks into it: the ability that runs, else walking or standing as its own controller in a player's game decides. */
    private void hitboxPose() {
        int was = hitboxMotion;
${
  follow.abilities
    ? `        if (abilityIndex >= 0) {
            hitboxMotion = HITBOX_ABILITY_MOTION[abilityIndex];
            hitboxTick = Math.max(0, abilityTick);
            return;
        }
        // Between two steps of a combo: as the step before left it.
        if (abilityRunning()) return;
`
    : ""
}        if (${follow.busy}) {
            hitboxMotion = -1;
            return;
        }
        float amount = walkAnimation.speed();
        hitboxMotion = amount < MOVING_AMOUNT ? HITBOX_IDLE : HITBOX_WALK;
        // The walk goes at the pace the body is carried at, as its controller plays it; standing at its own.
        if (hitboxMotion != was) hitboxTick = 0;
        else hitboxTick += hitboxMotion == HITBOX_WALK && WALK_SPEED > 0 ? Math.min(amount * 5.0 / WALK_SPEED, WALK_MOST) : 1.0;
    }

    /** How far part \`index\` is moved now by the bone it follows, {forward, up, left} in blocks at the size the model is built; null when it stands as stated. Between two rows it goes in a straight line. */
    ${modifier} float[] hitboxMoved(int index) {
        int column = index >= 0 && index < HITBOX_COLUMNS.length ? HITBOX_COLUMNS[index] : -1;
        if (column < 0 || hitboxMotion < 0) return null;
        String moves = HITBOX_MOVES[hitboxMotion];
        int width = HITBOX_FOLLOWERS * ${3 * HITBOX_FOLLOW.letters};
        int last = moves.length() / width - 1;
        double at = Math.min((HITBOX_MOTION_LOOPS[hitboxMotion] ? hitboxTick % HITBOX_MOTION_TICKS[hitboxMotion] : hitboxTick) / ${HITBOX_FOLLOW.every}.0, last);
        int low = (int) at;
        int high = Math.min(low + 1, last);
        float share = (float) (at - low);
        float[] moved = new float[3];
        for (int axis = 0; axis < 3; axis++)
            moved[axis] = hitboxValue(moves, low * width + (column * 3 + axis) * ${HITBOX_FOLLOW.letters}) * (1.0f - share) + hitboxValue(moves, high * width + (column * 3 + axis) * ${HITBOX_FOLLOW.letters}) * share;
        return moved;
    }

    private static float hitboxValue(String moves, int at) {
        return ((((moves.charAt(at) - 'a') << 8) | ((moves.charAt(at + 1) - 'a') << 4) | (moves.charAt(at + 2) - 'a')) - ${HITBOX_FOLLOW.zero}) / ${HITBOX_FOLLOW.unit}.0f;
    }

`
}

/**
 * A big body that gets stuck (`hitbox.stuck`), as a goal of its own class: no Minecraft name here is a loader's. `after`: a Java expression for whom it is after (null: nobody);
 * `busy`: a Java condition, true while it must not be moved (an ability, a show, flying). It runs before the goal that chases (priority 0, taking the move), and only once it is stuck:
 * when it has come no nearer than half a block to them for `seconds`. Then it asks for a fresh path to them; the next time, and every time after, it goes round (a path to a place
 * beside them, one side and then the other), or with `squeeze` walks straight at them for two seconds and jumps a block that is in its way. Coming nearer, or near enough to fight, starts the count again.
 */
export function stuckSource(stuck: { seconds: number; squeeze: boolean }, after: string, busy: string) {
  return {
    fields: `    // ---- a big body that gets stuck: how long it may come no nearer to whom it is after before it looks for another way, and whether it may then push straight on and jump a block ----
    private static final int STUCK_TICKS = ${Math.round(stuck.seconds * 20)};
    private static final boolean STUCK_SQUEEZE = ${stuck.squeeze};
`,
    goal: `    private final class StuckGoal extends Goal {
        private net.minecraft.world.entity.LivingEntity after;
        private double nearest = Double.MAX_VALUE;
        private int since;
        private int tries;
        private int left;
        private boolean squeezing;

        private StuckGoal() {
            setFlags(java.util.EnumSet.of(Flag.MOVE));
        }

        private double flat(net.minecraft.world.entity.LivingEntity other) {
            double dx = other.getX() - getX();
            double dz = other.getZ() - getZ();
            return Math.sqrt(dx * dx + dz * dz);
        }

        // Watched every time the goals are looked at: stuck is no nearer by half a block for STUCK_TICKS, while it is not near enough to fight.
        @Override public boolean canUse() {
            after = ${after};
            if (after == null || !after.isAlive() || ${busy}) {
                after = null;
                nearest = Double.MAX_VALUE;
                since = tickCount;
                tries = 0;
                return false;
            }
            double distance = flat(after);
            if (distance <= getBbWidth() / 2.0 + 3.0 || distance < nearest - 0.5) {
                if (distance <= getBbWidth() / 2.0 + 3.0) tries = 0;
                nearest = distance;
                since = tickCount;
                return false;
            }
            return tickCount - since >= STUCK_TICKS;
        }

        @Override public void start() {
            tries++;
            left = 40;
            squeezing = STUCK_SQUEEZE && tries >= 2;
            if (squeezing) {
                getNavigation().stop();
                return;
            }
            // The first time a fresh path to them (the one it had led nowhere); after that a path to a place beside them, one side and then the other.
            if (tries == 1) {
                getNavigation().stop();
                if (getNavigation().moveTo(after, 1.0)) return;
            }
            double distance = Math.max(0.001, flat(after));
            double side = (tries % 2 == 0 ? 1.0 : -1.0) * Math.max(4.0, getBbWidth() * 2.0);
            double x = after.getX() - (after.getZ() - getZ()) / distance * side;
            double z = after.getZ() + (after.getX() - getX()) / distance * side;
            if (!getNavigation().moveTo(x, after.getY(), z, 1.0)) left = 0;
        }

        @Override public boolean canContinueToUse() { return left > 0 && after != null && after.isAlive() && !(${busy}); }

        @Override public boolean requiresUpdateEveryTick() { return true; }

        @Override public void tick() {
            left--;
            if (!squeezing) {
                if (getNavigation().isDone()) left = 0;
                return;
            }
            // Straight at them, and over a block in the way; nothing is broken.
            getLookControl().setLookAt(after, 30.0f, 30.0f);
            getMoveControl().setWantedPosition(after.getX(), after.getY(), after.getZ(), 1.0);
            if (horizontalCollision && onGround()) getJumpControl().jump();
        }

        @Override public void stop() {
            if (squeezing) getNavigation().stop();
            squeezing = false;
            nearest = after == null ? Double.MAX_VALUE : flat(after);
            since = tickCount;
        }
    }

`,
    register: "\n        // A big body that gets stuck looks for another way (hitbox.stuck); it takes the move from the chase only once it is stuck.\n        goalSelector.addGoal(0, new StuckGoal());",
  }
}

/**
 * What a creature's own class gains from its `hitbox`: the pieces `fabric/entity.ts` writes in. Every piece is empty without parts.
 * `leaning`: the creature flies, so a part is carried by the lean of its flight (`flightLeaned`, written by the flight): the creature answers where a place on its body is.
 */
export function hitboxSource(hitbox: Hitbox | null | undefined, leaning = false, follow: FollowSource | null = null) {
  const parts = collisionParts(hitbox)
  const blockers = Boolean(hitbox?.blockers?.length)
  const core = hitbox?.core.solid
  const contact = `    // Vanilla contact pushing should not move a creature that holds up other actors.
    @Override public boolean isPushable() { return false; }
    @Override public void push(net.minecraft.world.entity.Entity other) {}
    @Override protected void doPush(net.minecraft.world.entity.Entity other) {}`
  const coreMethods = core ? "    @Override public boolean canBeCollidedWith() { return isAlive() && !isRemoved(); }\n\n" : ""
  if (!parts.length) return {
    implements: "", imports: "",
    fields: (follow ? followFields(follow.table, follow.abilities) : "") + (core ? "    private final net.minecraft.world.phys.AABB[] solidBoxes = new net.minecraft.world.phys.AABB[1];\n" : ""),
    methods: (follow ? followMethods(follow, "private") : "") + (core ? `${coreMethods}${contact}

    @Override public void aiStep() {
        super.aiStep();
        if (!level().isClientSide() && isAlive()) StudioSolidBody.clear(this, null, solidBoxes);
    }

` : ""),
  }
  const table = follow?.table ?? null
  const solidMask = parts.reduce((mask, part, index) => part.solid ? mask | (1 << index) : mask, 0)
  const solid = Boolean(solidMask || blockers)
  const hittableCount = hitbox?.parts?.length ?? 0
  return {
    implements: `, ${PART_RUNTIME.entity}.Owner`,
    imports: "",
    fields: `    // ---- its further collision boxes: {forward, up, left, width, height} in blocks, in its own terms ----
${parts.map((part, index) => `    // ${index}: "${part.name.replace(/[\r\n*\\"]/g, " ")}"`).join("\n")}
    private static final float[][] HITBOX_PARTS = {
${parts.map((part) => `        {${[part.forward, part.up, part.left, part.width, part.height].map(single).join(", ")}},`).join("\n")}
    };
    private final ${PART_RUNTIME.entity}[] hitboxParts = new ${PART_RUNTIME.entity}[HITBOX_PARTS.length];
${solid || core ? `    private final net.minecraft.world.phys.AABB[] solidBoxes = new net.minecraft.world.phys.AABB[HITBOX_PARTS.length${core ? " + 1" : ""}];
` : ""}${table ? followFields(table, follow!.abilities) : ""}`,
    methods: `    @Override public float[][] hitboxParts() { return HITBOX_PARTS; }

${coreMethods}${blockers ? `    @Override public boolean hitboxHittable(int index) { return index >= 0 && index < ${hittableCount}; }\n` : ""}${solid ? `    @Override public boolean hitboxSolid(int index) { return ${blockers ? `index >= ${hittableCount} || ` : ""}(${solidMask} & (1 << index)) != 0; }
${contact}

` : core ? `${contact}

` : ""}${leaning ? "    @Override public double[] hitboxLeaned(double forward, double up, double left) { return flightLeaned(forward, up, left); }\n\n" : ""}${table ? followMethods(follow!, table.columns.slice(0, parts.length).some(column => column >= 0) ? "@Override public" : "public") : ""}    @Override public void aiStep() {
        super.aiStep();
        if (level().isClientSide() || isRemoved()) return;${table ? "\n        hitboxPose();" : ""}
        // After it has moved for this tick: every part is where its body is now. One that is gone (unloaded, killed by a command) is made again, as soon as the world takes it.
        for (int index = 0; index < hitboxParts.length; index++) {
            if (hitboxParts[index] == null || hitboxParts[index].isRemoved()) hitboxParts[index] = ${PART_RUNTIME.entity}.spawn(this, index);
            if (hitboxParts[index] != null) hitboxParts[index].place();
        }${solid || core ? "\n        StudioSolidBody.clear(this, hitboxParts, solidBoxes);" : ""}
    }

    @Override public void remove(RemovalReason reason) {
        super.remove(reason);
        // However it goes (killed, unloaded, taken to another dimension), its parts go with it.
        for (${PART_RUNTIME.entity} part : hitboxParts) if (part != null) part.discard();
    }

`,
  }
}

/**
 * `target`: Fabric 1.21.1 (the default) is this file's own text and its edit to fabric.mod.json, exactly as before. A facade target (Forge,
 * NeoForge) keeps the same part entity (it names only the game: a real entity of its own type, spawned and placed by its creature on the
 * server and placed again by each player's game, which no loader's multipart interface is), mapped to its game version; its type is
 * registered through `StudioPlatform.entity` and drawn as nothing through `StudioClientPlatform.renderer`, from the two classes whose
 * `register()` the facade's entries run (`entries`).
 */
export function compileHitboxParts(value: z.input<typeof Input>, target: GenTarget = FABRIC_TARGET) {
  const input = Input.parse(value)
  const source = `src/main/java/${input.packageName.replaceAll(".", "/")}`
  // Where a part stands in its creature's own terms: as stated, or (a mod with parts that follow a bone) as stated and moved by its bone.
  const [F, U, L] = input.follow ? ["along", "rise", "aside"] : ["row[0]", "row[1]", "row[2]"]
  const FOLLOW_PLACE = `        // Moved by the bone it follows: its creature's server says how far (hitboxMoved), and every player's game is told the same.
        float[] moved = moved();
        float along = row[0] + moved[0];
        float rise = row[1] + moved[1];
        float aside = row[2] + moved[2];
`
  const files: Record<string, string> = {
    [`${source}/entity/${PART_RUNTIME.table}.java`]: `package ${input.packageName}.entity;

import net.fabricmc.api.ModInitializer;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;

/** Generated by MineMods Studio: the one entity type every further collision box of this mod's creatures is. */
public final class ${PART_RUNTIME.table} implements ModInitializer {
    // Never written to disk and never summoned by command: a part only exists because its creature keeps it.
    public static final EntityType<${PART_RUNTIME.entity}> TYPE = Registry.register(
        BuiltInRegistries.ENTITY_TYPE, ResourceLocation.fromNamespaceAndPath(${JSON.stringify(input.modId)}, "${PART_RUNTIME.registry}"),
        EntityType.Builder.<${PART_RUNTIME.entity}>of(${PART_RUNTIME.entity}::new, MobCategory.MISC)
            .sized(0.1f, 0.1f).noSave().noSummon().fireImmune().clientTrackingRange(10).updateInterval(1).build("${PART_RUNTIME.registry}"));

    // Fabric builds a main entrypoint through its no-argument constructor, which must be public.
    public ${PART_RUNTIME.table}() {}

    // Loading this class registers the entity type; nothing else is needed at start.
    @Override public void onInitialize() {}
}
`,
    [`${source}/entity/${PART_RUNTIME.entity}.java`]: `package ${input.packageName}.entity;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.util.Mth;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityDimensions;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Pose;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Explosion;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.material.PushReaction;

/**
 * Generated by MineMods Studio: one further collision box of a creature. It is a box and nothing else: it can be
 * hit and used, and whatever is done to it is done to its creature; it cannot be pushed, saved or walked into,
 * and it stands in nobody's way. It turns with its creature's body and with nothing else.
 */
public class ${PART_RUNTIME.entity} extends Entity {
    /** A creature that has parts: one row a part, {forward, up, left, width, height} in blocks, in its own terms. */
    public interface Owner {
        float[][] hitboxParts();
${input.blockers ? "        default boolean hitboxHittable(int index) { return true; }\n" : ""}${input.solid ? "        default boolean hitboxSolid(int index) { return false; }\n" : ""}${input.lean ? `
        /** Where a place on its body (blocks from its feet: ahead, up, to its left; as large as it is) is now, with the lean of its flight; the place itself for a creature that does not lean. */
        default double[] hitboxLeaned(double forward, double up, double left) { return new double[] {forward, up, left}; }
` : ""}${input.follow ? `
        /** How far part \`index\` is moved now by the bone it follows ({forward, up, left} in blocks, as large as it is built); null for one that stands as stated. Asked on the server. */
        default float[] hitboxMoved(int index) { return null; }
` : ""}${input.combat ? `
        default void hitboxAttack(int index, Player player) { player.attack((Entity) this); }
        default boolean hitboxHurt(int index, DamageSource source, float amount) { return ((Entity) this).hurt(source, amount); }
` : ""}    }

    // Whose it is (the creature's entity id) and which of its parts: all a player's game is told. Where it stands follows from the two.
    private static final EntityDataAccessor<Integer> OWNER = SynchedEntityData.defineId(${PART_RUNTIME.entity}.class, EntityDataSerializers.INT);
    private static final EntityDataAccessor<Integer> INDEX = SynchedEntityData.defineId(${PART_RUNTIME.entity}.class, EntityDataSerializers.INT);
${input.solid ? `    private static final EntityDataAccessor<Boolean> SOLID = SynchedEntityData.defineId(${PART_RUNTIME.entity}.class, EntityDataSerializers.BOOLEAN);
` : ""}${input.follow ? `    // How far the bone it follows has moved it, as its creature's server says: told to every player's game, which places it itself.
    private static final EntityDataAccessor<Float> MOVED_FORWARD = SynchedEntityData.defineId(${PART_RUNTIME.entity}.class, EntityDataSerializers.FLOAT);
    private static final EntityDataAccessor<Float> MOVED_UP = SynchedEntityData.defineId(${PART_RUNTIME.entity}.class, EntityDataSerializers.FLOAT);
    private static final EntityDataAccessor<Float> MOVED_LEFT = SynchedEntityData.defineId(${PART_RUNTIME.entity}.class, EntityDataSerializers.FLOAT);
    private static final float[] STILL = {0.0f, 0.0f, 0.0f};
` : ""}    private Entity owner;
    private EntityDimensions size = EntityDimensions.scalable(0.1f, 0.1f);

    public ${PART_RUNTIME.entity}(EntityType<? extends ${PART_RUNTIME.entity}> type, Level world) {
        super(type, world);
        noPhysics = true;
        setNoGravity(true);
    }

    @Override protected void defineSynchedData(SynchedEntityData.Builder builder) {
        builder.define(OWNER, -1);
        builder.define(INDEX, 0);${input.solid ? "\n        builder.define(SOLID, false);" : ""}${input.follow ? `
        builder.define(MOVED_FORWARD, 0.0f);
        builder.define(MOVED_UP, 0.0f);
        builder.define(MOVED_LEFT, 0.0f);` : ""}
    }

    /** Makes part number \`index\` of a creature, beside it; null when the world does not take it now (its place is not loaded). Called by the creature, on the server. */
    static ${PART_RUNTIME.entity} spawn(LivingEntity owner, int index) {
        ${PART_RUNTIME.entity} part = new ${PART_RUNTIME.entity}(${PART_RUNTIME.table}.TYPE, owner.level());
        part.owner = owner;
        part.getEntityData().set(OWNER, owner.getId());
        part.getEntityData().set(INDEX, index);${input.solid ? "\n        part.getEntityData().set(SOLID, ((Owner) owner).hitboxSolid(index));" : ""}
        part.place();
        return owner.level().addFreshEntity(part) ? part : null;
    }

    /** The creature it belongs to; null in a player's game until that creature has arrived there. */
    public Entity owner() {
        if (owner == null || owner.isRemoved()) owner = level().isClientSide() ? level().getEntity(getEntityData().get(OWNER)) : null;
        return owner;
    }

    private float[] row() {
        if (!(owner() instanceof Owner creature)) return null;
        int index = getEntityData().get(INDEX);
        return index >= 0 && index < creature.hitboxParts().length ? creature.hitboxParts()[index] : null;
    }
${input.follow ? `
    /** How far the bone it follows has moved it: on the server asked of its creature and told on; in a player's game what was told. */
    private float[] moved() {
        if (level().isClientSide()) return new float[] {getEntityData().get(MOVED_FORWARD), getEntityData().get(MOVED_UP), getEntityData().get(MOVED_LEFT)};
        float[] found = owner instanceof Owner creature ? creature.hitboxMoved(getEntityData().get(INDEX)) : null;
        if (found == null) found = STILL;
        getEntityData().set(MOVED_FORWARD, found[0]);
        getEntityData().set(MOVED_UP, found[1]);
        getEntityData().set(MOVED_LEFT, found[2]);
        return found;
    }
` : ""}
    /** Puts it where its creature's body is now: its place in the creature's own terms, turned with the body and as much larger or smaller as the creature is. */
    void place() {
        float[] row = row();
        if (row == null) return;
        float scale = owner instanceof LivingEntity living ? living.getScale() : 1.0f;
        float facing = owner instanceof LivingEntity living ? living.yBodyRot : owner.getYRot();
        float turn = facing * 0.017453292f;
        if (size.width() != row[3] * scale || size.height() != row[4] * scale) {
            size = EntityDimensions.scalable(row[3] * scale, row[4] * scale);
            refreshDimensions();
        }
        setYRot(facing);
${input.follow ? FOLLOW_PLACE : ""}${input.lean ? `        // A flier's body leans in the air, nose up and into its turns, about the middle of its box: the box of a part is carried by the lean as the part of the body it holds is (its middle moves; the box stays upright, as every box of the game does).
        double ahead = ${F} * scale;
        double up = (${U} + row[4] / 2.0f) * scale;
        double side = ${L} * scale;
        if (owner instanceof Owner creature) {
            double[] leaned = creature.hitboxLeaned(ahead, up, side);
            ahead = leaned[0];
            up = leaned[1];
            side = leaned[2];
        }
        setPos(
            owner.getX() - ahead * Mth.sin(turn) + side * Mth.cos(turn),
            owner.getY() + up - row[4] * scale / 2.0,
            owner.getZ() + ahead * Mth.cos(turn) + side * Mth.sin(turn));` : `        setPos(
            owner.getX() - ${F} * scale * Mth.sin(turn) + ${L} * scale * Mth.cos(turn),
            owner.getY() + ${U} * scale,
            owner.getZ() + ${F} * scale * Mth.cos(turn) + ${L} * scale * Mth.sin(turn));`}
    }

    @Override public void tick() {
        // Nothing of an entity's own life: no fire, no fall, no portal. On the server its creature places it (after it moved); a player's game places it itself.
        if (!level().isClientSide()) {
            if (owner == null || owner.isRemoved()) discard();
            return;
        }
        place();
    }

    @Override public EntityDimensions getDimensions(Pose pose) { return size; }

    // ---- what is done to it is done to its creature ----

    // A player's swing is made again on the creature itself, whole: its damage, critical hits, knockback, enchantments, the weapon's wear and the sweep are the game's own.
    @Override public boolean skipAttackInteraction(Entity attacker) {${input.blockers ? "\n        if (!isPickable()) return true;" : ""}
        Entity creature = owner();
        if (creature != null && attacker != creature && attacker instanceof Player player) ${input.combat ? "((Owner) creature).hitboxAttack(getEntityData().get(INDEX), player)" : "player.attack(creature)"};
        return true;
    }

    // Everything else that hurts (an arrow, a trident, a potion's cloud, another mod) is passed on with its source. Nothing of its own creature's doing reaches the creature through a part.
    @Override public boolean hurt(DamageSource source, float amount) {${input.blockers ? "\n        if (!isPickable()) return false;" : ""}
        Entity creature = owner();
        if (level().isClientSide() || creature == null || isInvulnerableTo(source)) return false;
        if (source.getEntity() == creature || source.getDirectEntity() == creature) return false;
        return ${input.combat ? "((Owner) creature).hitboxHurt(getEntityData().get(INDEX), source, amount)" : "creature.hurt(source, amount)"};
    }

    // A use is passed on the way the game uses the creature: its own interact, then the item in hand on it.
    @Override public InteractionResult interact(Player player, InteractionHand hand) {${input.blockers ? "\n        if (!isPickable()) return InteractionResult.PASS;" : ""}
        Entity creature = owner();
        return creature == null ? InteractionResult.PASS : player.interactOn(creature, hand);
    }

    @Override public boolean is(Entity entity) { return this == entity || owner() == entity; }
    // A projectile leaves its owner, and may hit, by asking whether the two stand in one line of riders: a part answers as its creature, so a creature's own shot passes its parts.
    @Override public Entity getRootVehicle() {
        Entity creature = owner();
        return creature == null ? this : creature.getRootVehicle();
    }
    @Override public ItemStack getPickResult() {
        Entity creature = owner();
        return creature == null ? null : creature.getPickResult();
    }
    @Override public Component getName() {
        Entity creature = owner();
        return creature == null ? super.getName() : creature.getName();
    }

    // ---- a box and nothing else ----

    @Override public boolean isPickable() { return ${input.blockers ? "owner() instanceof Owner body && body.hitboxHittable(getEntityData().get(INDEX))" : "true"}; }
${input.blockers ? "    @Override public boolean isAttackable() { return isPickable(); }\n    @Override public boolean canBeHitByProjectile() { return isPickable() && super.canBeHitByProjectile(); }\n" : ""}    @Override public boolean canBeCollidedWith() { return ${input.solid ? "getEntityData().get(SOLID) && !isRemoved() && owner() instanceof LivingEntity living && living.isAlive()" : "false"}; }
${input.solid ? `    @Override public boolean canCollideWith(Entity other) { return canBeCollidedWith() && !isPassengerOfSameVehicle(other); }
` : ""}    @Override public boolean isPushable() { return false; }
    @Override public void push(Entity entity) {}
    @Override public void push(double x, double y, double z) {}
    @Override public boolean isPushedByFluid() { return false; }
    @Override public boolean isIgnoringBlockTriggers() { return true; }
    @Override public boolean canUsePortal(boolean allowVehicles) { return false; }
    // An explosion already reaches its creature; through the parts it would count once more for each.
    @Override public boolean ignoreExplosion(Explosion explosion) { return true; }
    @Override public boolean displayFireAnimation() { return false; }
    @Override public PushReaction getPistonPushReaction() { return PushReaction.IGNORE; }

    // Never written to disk: its creature makes it again when it is loaded.
    @Override public boolean shouldBeSaved() { return false; }
    @Override protected void readAdditionalSaveData(CompoundTag nbt) {}
    @Override protected void addAdditionalSaveData(CompoundTag nbt) {}
}
`,
    [`${source}/client/${PART_RUNTIME.client}.java`]: `package ${input.packageName}.client;

import ${input.packageName}.entity.${PART_RUNTIME.table};
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.minecraft.client.renderer.entity.NoopRenderer;

/** Generated by MineMods Studio: a part draws nothing. The game still shows its box with the others (F3+B) and aims at it. */
public final class ${PART_RUNTIME.client} implements ClientModInitializer {
    @Override public void onInitializeClient() {
        EntityRendererRegistry.register(${PART_RUNTIME.table}.TYPE, NoopRenderer::new);
    }
}
`,
  }
  const solidFiles = input.solid ? { [`${source}/entity/StudioSolidBody.java`]: solidBodyFile(input.packageName) } : {}
  const language = { zh_cn: { [`entity.${input.modId}.${PART_RUNTIME.registry}`]: "身体部位" }, en_us: { [`entity.${input.modId}.${PART_RUNTIME.registry}`]: "Body part" } }
  if (target.loader.facade) {
    const partFile = `${source}/entity/${PART_RUNTIME.entity}.java`
    const spawned = `new ${PART_RUNTIME.entity}(${PART_RUNTIME.table}.TYPE, owner.level())`
    if (!files[partFile]!.includes(spawned)) throw new Error("PART_TYPE_UNPLACED")
    const written: Record<string, string> = {
      ...solidFiles,
      [`${source}/entity/${PART_RUNTIME.table}.java`]: `package ${input.packageName}.entity;

import ${input.packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import java.util.function.Supplier;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;

/** Generated by MineMods Studio: the one entity type every further collision box of this mod's creatures is (${target.manifest.id}), through the facade. */
public final class ${PART_RUNTIME.table} {
    // Never written to disk and never summoned by command: a part only exists because its creature keeps it.
    public static final Supplier<EntityType<${PART_RUNTIME.entity}>> TYPE = ${PLATFORM_CLASS}.entity("${PART_RUNTIME.registry}",
        () -> EntityType.Builder.<${PART_RUNTIME.entity}>of(${PART_RUNTIME.entity}::new, MobCategory.MISC)
            .sized(0.1f, 0.1f).noSave().noSummon().fireImmune().clientTrackingRange(10).updateInterval(1).build("${PART_RUNTIME.registry}"));

    private ${PART_RUNTIME.table}() {}

    // Run by the mod's common entry while the mod is constructed: loading this class registers the type.
    public static void register() {}
}
`,
      [partFile]: target.version.body.plainEntity(files[partFile]!.replace(spawned, `new ${PART_RUNTIME.entity}(${PART_RUNTIME.table}.TYPE.get(), owner.level())`)),
      [`${source}/client/${PART_RUNTIME.client}.java`]: `package ${input.packageName}.client;

import ${input.packageName}.entity.${PART_RUNTIME.table};
import ${input.packageName}.${PLATFORM_PACKAGE}.${CLIENT_PLATFORM_CLASS};
import net.minecraft.client.renderer.entity.NoopRenderer;

/** Generated by MineMods Studio: a part draws nothing (${target.manifest.id}). The game still shows its box with the others (F3+B) and aims at it. */
public final class ${PART_RUNTIME.client} {
    public static void register() {
        ${CLIENT_PLATFORM_CLASS}.renderer(${PART_RUNTIME.table}.TYPE, NoopRenderer::new);
    }
}
`,
    }
    return {
      files: Object.fromEntries(Object.entries(written).map(([name, text]) => [name, target.version.rewriteJava(text)])),
      language,
      classes: [`${input.packageName.replaceAll(".", "/")}/entity/${PART_RUNTIME.entity}.class`],
      /** No fabric.mod.json to edit: the facade's entries run the two classes (`entries`). */
      patch: {} as Record<string, (text: string) => string>,
      entries: { common: [`${input.packageName}.entity.${PART_RUNTIME.table}`], client: [`${input.packageName}.client.${PART_RUNTIME.client}`] },
    }
  }
  return {
    files: { ...files, ...solidFiles },
    language,
    /** Paths inside the built jar that prove the parts went in. */
    classes: [`${input.packageName.replaceAll(".", "/")}/entity/${PART_RUNTIME.entity}.class`],
    /** Edits to files the scaffold wrote: the two classes start with the mod. */
    patch: {
      "src/main/resources/fabric.mod.json": (text: string) => {
        const metadata = z.record(z.string(), z.unknown()).parse(JSON.parse(text))
        const entrypoints = z.looseObject({ main: z.array(z.string()), client: z.array(z.string()).default([]) }).parse(metadata.entrypoints)
        const edited = `${JSON.stringify({ ...metadata, entrypoints: { ...entrypoints, main: [...entrypoints.main, `${input.packageName}.entity.${PART_RUNTIME.table}`], client: [...entrypoints.client, `${input.packageName}.client.${PART_RUNTIME.client}`] } }, null, 2)}\n`
        return text.includes("\r\n") ? edited.replaceAll("\n", "\r\n") : edited
      },
    } as Record<string, (text: string) => string>,
    /** Fabric names its entry points in fabric.mod.json (the patch above): nothing for the facade's entries. */
    entries: { common: [] as string[], client: [] as string[] },
  }
}
