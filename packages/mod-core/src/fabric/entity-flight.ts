import type { FlightPlan } from "../creature-flight"
import type { Flight } from "../entity-runtime"
import { FLIGHT_LIMITS, FLIGHT_STATES, flightMotions } from "../flight-words"

/**
 * A flier as the Java its creature's class carries (flight, 10-12): a state machine on the server (on the ground, taking off, in the air,
 * landing) kept in one synced byte, its own steering in the air, and, in the player's game, how the body leans and which motion plays.
 * Everything that decides is on the server. The numbers are the document's, turned into ticks, blocks a tick and degrees a tick once (`flightPlan`).
 * Nothing the game does by itself is replaced except where it must be: in the air the creature carries itself, so `travel` moves it by its own
 * velocity and nothing else (gravity is off and the game's own walking is not asked), and a flier takes no fall damage.
 * Whatever else wants the creature somewhere (a habit, a boss going back to where it began) asks `flightGo` on every tick it wants it; the ground
 * state is the creature as it always was, goals and paths included.
 * There is no path in three dimensions: it looks ahead along its heading three times and turns up and aside from a block it sees.
 * Every Minecraft and GeckoLib name used here is the official (Mojang) name of 1.21.1, with GeckoLib 4.8.3.
 * Gameplay code can steer a flier through the project's public accessor (`ProjectContent.flyTo`, `isFlying`, `land`): the class then implements
 * the accessor's `StudioFlier`, and a request is only one more thing that asks `flightGo` on every tick until it has been there a while or is dropped.
 * Without flight every piece is the empty string, so such a creature's class is what it always was.
 */

const real = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(5))))
const single = (value: number) => `${real(value)}f`
const list = (values: readonly (number | boolean | string)[]) => `{${values.join(", ")}}`
const clip = (model: string, name: string | null, how: "thenPlay" | "thenLoop") => (name === null ? "null" : `RawAnimation.begin().${how}("animation.${model}.${name}")`)

/** The statement that registers the flier's synced value, in the creature's `defineSynchedData`. */
export const FLIGHT_TRACKER = "        builder.define(FLIGHT, (byte) 0);\n"

const none = { imports: "", implements: "", fields: "", methods: "", tick: "", movement: "", nbtWrite: "", nbtRead: "", tracker: "", rendererImports: "", renderer: (_entity: string) => "" }

/**
 * The usual roaming (WaterAvoidingRandomStrollGoal), kept to where it can walk: a flier does not roam on foot while it is in the air, and a creature with a home
 * does not choose a place outside it. Written only for a creature that flies or has a home; without both the game's own goal is added as it always was.
 */
export function groundWander(input: { flier: boolean; home: boolean }) {
  if (!input.flier && !input.home) return ""
  const ground = input.flier ? "flightState() == FLIGHT_GROUND && " : ""
  return `    private final class GroundWanderGoal extends WaterAvoidingRandomStrollGoal {
        private GroundWanderGoal(PathfinderMob mob, double speed) { super(mob, speed); }

        @Override public boolean canUse() { return ${ground}super.canUse(); }

        @Override public boolean canContinueToUse() { return ${ground}super.canContinueToUse(); }
${
  input.home
    ? `
        // A place outside its home is not chosen: it stays within the radius it was given.
        @Override protected Vec3 getPosition() {
            Vec3 target = super.getPosition();
            return target == null || habitInside(target) ? target : null;
        }
`
    : input.flier
      ? `
        // A flier with no home that was given a roam (the NBT value "FlightRoam") does not choose a place outside it, and walks back when it is outside.
        @Override protected Vec3 getPosition() {
            if (!flightRoamInside(position())) return flightRoamCentre();
            Vec3 target = super.getPosition();
            return target == null || flightRoamInside(target) ? target : null;
        }
`
      : ""
}    }

`
}

export function compileFlight(input: {
  entity: string
  model: string
  flight: Flight | null | undefined
  plan: FlightPlan | null
  /** The creature has abilities: the dive and where an ability may start are written. */
  abilities: boolean
  steady?: boolean
  /**
   * A hostile creature whose own chase goal keeps its target to itself (the game's target stays empty): the field that holds who it chases. Flight reads it when the game's
   * target is empty, so a creature goes up after whoever its own goal picked as well as after whoever was set as its target. Null: the game's target is the only one.
   */
  chased?: string | null
  /** Habits with a home: the expression that is the home as a point (null before it is set) and the radius that keeps it near. */
  home: { point: string; radius: number } | null
  /** Habits with a rest: the expression that is true while it rests (it then does not go up for no reason). */
  resting: string | null
  /**
   * Habits with a meal: the expression that is true while it eats (null: it never does). A flier that eats on the ground is not in the mood for the air until it has done, as one that rests is not;
   * what is urgent (a fight, a request, a return, a boss's show) goes up all the same.
   */
  eating?: string | null
  /** The statement the boss runs when the creature has flown back to where it began. */
  arrived: string
  /** The project has gameplay code: the creature answers its requests to fly somewhere (`ProjectContent.flyTo`). */
  gameplay?: boolean
  /**
   * Something on the server needs to know how the body leans in the air: a hit that counts from a bone, or collision boxes of parts that follow the body. The server then works out the
   * pitch and the lean the way the player's game does (`flightLook`) and `flightLeaned` carries a place on the body by them. Without it the server never knows them, as before.
   */
  lean?: boolean
  /**
   * Half the width of a flier whose model reaches further to each side than its box does (`flierSpan`), blocks, at the size it is built: its steering then looks ahead
   * from the tips of its wings as well as from its middle. Null or left out: it looks from its middle alone, as it always did.
   */
  span?: number | null
  /** Its collision box is wider than any ordinary creature of the game (`FLIGHT_LIMITS.footprint`): the place it sets down at has to have room for the whole box. Left out: the one column it always looked at. */
  footprint?: boolean
  /**
   * A boss that flies and has a wake-up: the wake-up is a display in the air. The boss writes `bossDisplay()` (it is waking up) and `bossShowAt` (over whom it shows itself); the flight takes
   * off for it and circles high above that place, whatever else asks something of it. Left out: nothing of this is written.
   */
  display?: boolean
  /**
   * A boss one of whose phases is faster than the first (spec: phase.speed): every speed of the flight and its turning are scaled by the phase's number (`bossSpeedScale()`, written by the boss),
   * as the creature's walking is by its movement attribute. Left out: the document's own numbers, as they always were.
   */
  pace?: boolean
  /** The creature is a boss: an ability its phase does not allow is not one that is ready (`bossAllows`). */
  boss?: boolean
  /**
   * broad11 w1: per ability, a dive whose first hit counts from a bone (`diveReach`): the bone and the middle of what that hit reaches end at the one it fights, and it faces them while it charges.
   * Null for every other ability. Left out (no such dive): the middle of its body goes to theirs, as it always did.
   */
  reach?: (number[] | null)[]
  /**
   * epic game1: per ability, one in the air aimed at the one it fights (\`airReach\`): \`[reach, up, forward, left, first, last, push]\`, how far its hits reach from where they start, where that is above, ahead of and
   * beside the feet, the ticks of the first and of the last of them, how far the hits before the last push the one they hit and how much of that the aim follows. It starts only when the hold keeps that place within that reach at every one of
   * them (\`flightReaches\`), and while it runs the flier holds station where its hits reach them (\`flightReachStation\`), the one it fights followed by its aim (\`abilityFollow\`). Left out (no such ability): it keeps its height while an ability runs, as it always did.
   */
  airReach?: (number[] | null)[]
}) {
  const flight = input.flight
  const plan = input.plan
  if (!flight || !plan) return none
  const state = FLIGHT_STATES
  const busy = input.abilities ? "abilityRunning()" : "false"
  // Whom it is after: the game's target alone, as it always was, unless its own chase goal keeps a target of its own or it closes in on its target to swing (then \`flightAfter\`, written below).
  const after = input.chased || plan.harries ? "flightAfter()" : "getTarget()"
  // It goes up after its target to use an ability in the air (\`plan.fights\`); one with no ability at all (\`plan.harries\`) goes up after it to swing at it, so it needs nothing more than a target.
  const goesUp = plan.harries ? "" : "FLIGHT_FIGHTS"
  const motions = flightMotions(flight)
  const diving = input.abilities ? "abilityRunning() && FLIGHT_DIVE[abilityIndex]" : "false"
  const home = input.home
  const span = input.span ?? null
  const footprint = Boolean(input.footprint)
  const display = Boolean(input.display)
  const paced = Boolean(input.pace)
  const reach = input.abilities && input.reach?.some(Boolean) ? input.reach : null
  const airReach = input.abilities && input.airReach?.some(Boolean) ? input.airReach : null
  // A circle no circle can start an aimed air ability from (`flightCircle`): when one is ready the flier closes in on its target instead of circling.
  const approach = Boolean(airReach && plan.circle.approach)
  // It comes down to use a ground-only ability when no air ability is ready (`flightLands`): needs abilities to be written at all.
  const lands = Boolean(plan.lands && input.abilities)
  // A phase's speed is a share of every speed the flight has: where there is none the document's constants are used as they are, so the Java is what it always was.
  const cruise = paced ? "flightCruise()" : "FLIGHT_CRUISE"
  const stall = paced ? "flightStall()" : "FLIGHT_STALL"
  const accel = paced ? "flightAccel()" : "FLIGHT_ACCEL"
  const brake = paced ? "flightBrake()" : "FLIGHT_BRAKE"
  const turnRate = paced ? "flightTurn()" : "FLIGHT_TURN"
  const steadyCasting = input.steady && input.abilities
  const turnBody = (want: string) => steadyCasting ? `yaw = flightBodyYaw(yaw, ${want});` :
    `yaw += Mth.clamp(Mth.wrapDegrees(${want} - yaw), -${turnRate}, ${turnRate});`
  const diveLeast = paced ? "flightDiveLeast()" : "FLIGHT_DIVE_LEAST"
  const diveAccel = paced ? "flightDiveAccel()" : "FLIGHT_DIVE_ACCEL"
  // Whether its box fits at a place it means to set down at: every block column under the box is ground at about the height of the place, and the box itself meets no block there (a canopy, a trunk).
  const footprintMethod = `
    /**
     * Whether the whole of its box stands clear at a place: the block columns under it, a block apart and the corners among them (\`FLIGHT_FOOT_COLUMN\`), all have ground within
     * \`FLIGHT_FOOT_SLOPE\` of the place's height (not half on a cliff, nor in a pit), and the box itself, from the ground up, meets no block (leaves of a canopy, a trunk).
     * Looking at one column only would set a creature wider than a block down inside a tree.
     */
    private boolean flightFits(double x, double top, double z) {
        double width = getBbWidth();
        double half = width / 2.0;
        int steps = Math.max(1, (int) Math.ceil(width / FLIGHT_FOOT_COLUMN));
        for (int along = 0; along <= steps; along++) {
            for (int across = 0; across <= steps; across++) {
                int blockX = Mth.floor(x - half + width * along / steps);
                int blockZ = Mth.floor(z - half + width * across / steps);
                if (!level().hasChunk(blockX >> 4, blockZ >> 4)) return false;
                if (Math.abs(level().getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, blockX, blockZ) - top) > FLIGHT_FOOT_SLOPE) return false;
            }
        }
        return level().noCollision(this, new AABB(x - half, top + 0.01, z - half, x + half, top + getBbHeight(), z + half));
    }
`
  // Where it looks for a block: from its middle, and for a wide flier from both wing tips as well.
  const clearOf = span === null ? "flightClear" : "flightClearWide"
  // What it is doing in the air is one of: held (an ability that stands still), a dive, going where it was sent, circling above who it fights, coming down, wandering.
  const asked = Boolean(input.gameplay)
  return {
    imports: `import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.MoverType;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.core.BlockPos;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.ClipContext;
${footprint ? "import net.minecraft.world.phys.AABB;\n" : ""}`,
    implements: asked ? ", ProjectContent.StudioFlier" : "",
    fields: `    // ---- flight: a state machine (on the ground, taking off, in the air, landing), steering of its own in the air and a lean for the eye; data from the creature's document ----
    // Where it is, for every player's game: 0 on the ground, 1 taking off, 2 in the air, 3 landing.
    private static final EntityDataAccessor<Byte> FLIGHT = SynchedEntityData.defineId(${input.entity}.class, EntityDataSerializers.BYTE);
    private static final int FLIGHT_GROUND = ${state.ground};
    private static final int FLIGHT_TAKEOFF = ${state.takeoff};
    private static final int FLIGHT_AIR = ${state.air};
    private static final int FLIGHT_LANDING = ${state.landing};
    // Soaring stays up by its speed: it never goes under FLIGHT_STALL (blocks a tick) in the air. Hovering may stand still (0).
    private static final boolean FLIGHT_SOAR = ${plan.soar};
    private static final double FLIGHT_CRUISE = ${real(plan.cruise)};
    private static final double FLIGHT_STALL = ${real(plan.stall)};
    // Blocks a tick the speed may rise and fall by: it never jumps from one speed to another.
    private static final double FLIGHT_ACCEL = ${real(plan.accel)};
    private static final double FLIGHT_BRAKE = ${real(plan.brake)};
    // Degrees a tick it may turn (both aside and up or down) and the steepest it climbs or dives; the body leans to FLIGHT_BANK at the fastest turn.
    private static final float FLIGHT_TURN = ${single(plan.turn)};
    private static final float FLIGHT_CLIMB = ${single(plan.climb)};
    private static final float FLIGHT_BANK = ${single(plan.bank)};
    private static final float FLIGHT_BANK_GAIN = ${single(plan.bankGain)};
    private static final double FLIGHT_ALT_MIN = ${real(plan.altitude.min)};
    private static final double FLIGHT_ALT_MAX = ${real(plan.altitude.max)};
    private static final double FLIGHT_AIR_SHARE = ${real(plan.airShare)};
    private static final int FLIGHT_TAKEOFF_TICKS = ${plan.takeoffTicks};
    private static final int FLIGHT_LAND_TICKS = ${plan.landTicks};
    // How long it stays in the air or on the ground when nothing asks it to move (ticks), and the least it stays after landing and after taking off.
    private static final int FLIGHT_MOOD_MIN = ${plan.moodTicks.min};
    private static final int FLIGHT_MOOD_MAX = ${plan.moodTicks.max};
    private static final int FLIGHT_GROUND_LEAST = ${plan.groundLeast};
    private static final int FLIGHT_AIR_LEAST = ${plan.airLeast};
    // A point is reached within FLIGHT_ARRIVE blocks; the three looks ahead for a block, in ticks of the present speed and the least each reaches (blocks) beyond its own half width.
    private static final double FLIGHT_ARRIVE = ${real(plan.arrive)};
    private static final int[] FLIGHT_PROBE_TICKS = ${list(plan.probes)};
    private static final double[] FLIGHT_PROBE_LEAST = ${list(FLIGHT_LIMITS.probeLeast.map((value) => Number(value.toFixed(1))).map((value) => real(value)))};
    private static final double FLIGHT_WANDER_MIN = ${real(FLIGHT_LIMITS.wander.min)};
    private static final double FLIGHT_WANDER_MAX = ${real(FLIGHT_LIMITS.wander.max)};
    private static final double FLIGHT_FALL = ${real(FLIGHT_LIMITS.fall)};
    private static final double FLIGHT_LAND_HEIGHT = ${real(FLIGHT_LIMITS.landHeight)};
${
  span === null
    ? ""
    : `    // Half its width across the body, wing tips and all, at the size it is built (blocks): it keeps this much clear to each side of its way, not only along its middle.
    private static final double FLIGHT_SPAN = ${real(span)};
`
}${
  footprint
    ? `    // The distance between the block columns looked at under its box, and the step between two neighbouring columns it still stands across (blocks).
    private static final double FLIGHT_FOOT_COLUMN = ${real(FLIGHT_LIMITS.footColumn)};
    private static final double FLIGHT_FOOT_SLOPE = ${real(FLIGHT_LIMITS.footSlope)};
`
    : ""
}    private static final int FLIGHT_STUCK_TICKS = ${plan.stuckTicks};
    private static final int FLIGHT_GIVE_UP_TICKS = ${plan.giveUpTicks};
    private static final int FLIGHT_RETURN_TICKS = ${plan.returnTicks};
    // The longest a dead one is kept while it is still falling (ticks).
    private static final int FLIGHT_FALL_TICKS = ${FLIGHT_LIMITS.deadFall};
    private static final float FLIGHT_PITCH_EASE = ${single(FLIGHT_LIMITS.pitchEase)};
    private static final float FLIGHT_ROLL_EASE = ${single(FLIGHT_LIMITS.rollEase)};
    // It goes up to fight when some ability of it may start in the air; it then circles the one it fights at this radius (blocks) and this height above them.
    private static final boolean FLIGHT_FIGHTS = ${plan.fights};
${
  plan.harries
    ? `    // One with no ability at all goes up after its target as well and closes in on it, to swing at it from the air (a swing reaches what its box meets at the same height).
    // It stops this far short of the one it is after (blocks between the two boxes): inside what a swing reaches (\`MobEntity.ATTACK_RANGE\`, 0.83 blocks to each side), and clear of their box.
    private static final double FLIGHT_HARRY_GAP = ${real(FLIGHT_LIMITS.harryGap)};
`
    : ""
}    private static final double FLIGHT_CIRCLE_RADIUS = ${real(plan.circle.radius)};
    private static final double FLIGHT_CIRCLE_HEIGHT = ${real(plan.circle.height)};
${
  input.abilities
    ? `    // Per ability: where it may start (0 anywhere, 1 on the ground, 2 in the air), whether it is a dive, and the tick of its last hit, where a dive's charge ends.
    private static final int[] FLIGHT_WHERE = ${list(plan.where)};
    private static final boolean[] FLIGHT_DIVE = ${list(plan.dive)};
    // Per ability, whether its hits are laid out ahead of it, so that in the air it starts only when it can turn to face the one it fights by the end of getting ready.
    private static final boolean[] FLIGHT_FACES = ${list(plan.faces)};
    private static final int[] FLIGHT_LAST = ${list(plan.last)};
    // The tick of each ability's first hit, where a dive's charge has to be at the point it locked; the slowest (twice cruise) and the fastest (\`FLIGHT_LIMITS.diveMost\`) the charge goes, blocks a tick.
    private static final int[] FLIGHT_FIRST = ${list(plan.first)};
    private static final double FLIGHT_DIVE_LEAST = ${real(plan.diveLeast)};
    private static final double FLIGHT_DIVE_MOST = ${real(plan.diveMost)};
    private static final double FLIGHT_DIVE_ACCEL = ${real(plan.diveAccel)};
    private static final double FLIGHT_DIVE_HEIGHT = ${real(plan.diveHeight)};
${
  reach
    ? `    // Per ability, a dive whose first hit counts from a bone: that bone ahead, above and to the left of its feet at the size the model is built, and the middle of what the hit reaches from there (blocks); null: the middle of the body.
    private static final double[][] FLIGHT_DIVE_REACH = {${reach.map((row) => (row ? `{${row.map(real).join(", ")}}` : "null")).join(", ")}};
`
    : ""
}${
  airReach
    ? `    // Per ability in the air aimed at the one it fights: how far its hits reach from where they start, and how high above its feet that is at the size the model is built; null: it keeps its height.
    private static final double[][] FLIGHT_REACH = {${airReach.map((row) => (row ? `{${row.map(real).join(", ")}}` : "null")).join(", ")}};
`
    : ""
}`
    : ""
}${
  lands
    ? `    // Per ability, the distance window it starts in (blocks, the creature to its target): a flier that comes down for a ground-only ability stands in the middle of that window.
    // And the farthest any ground-only ability starts from: further than that from the one it fights, a flier that came down is left behind.
    private static final double[] FLIGHT_NEAR = {${plan.near.map(real).join(", ")}};
    private static final double[] FLIGHT_FAR = {${plan.far.map(real).join(", ")}};
    private static final double FLIGHT_GROUND_REACH = ${real(plan.groundReach)};
    // The ground-only ability it came down for (-1: none), by when it must have been used, whether it has been, and not before when it comes down for one again.
    private int flightGroundFor = -1;
    private int flightGroundUntil;
    private boolean flightGroundUsed;
    private int flightGroundNext;
`
    : ""
}    private static final RawAnimation FLIGHT_TAKEOFF_CLIP = ${clip(input.model, motions.takeoff, "thenPlay")};
    private static final RawAnimation FLIGHT_LAND_CLIP = ${clip(input.model, motions.land, "thenPlay")};
    private static final RawAnimation FLIGHT_FLY_CLIP = ${clip(input.model, motions.fly, "thenLoop")};
    private static final RawAnimation FLIGHT_GLIDE_CLIP = ${clip(input.model, motions.glide, "thenLoop")};
    private static final RawAnimation FLIGHT_HOVER_CLIP = ${clip(input.model, motions.hover, "thenLoop")};
    private int flightTimer;
    private int flightSince;
    private double flightSpeed;
    private double flightPush = FLIGHT_ACCEL;
    private float flightClimbNow;
    private double flightStartY;
    private double flightAbove = 64.0;
    private boolean flightWater;
    private boolean flightGravityOff = true;
    private boolean flightDescending;
    private Vec3 flightLandSpot;
    private Vec3 flightWander;
    private int flightWanderAge;
    private int flightPauseUntil;
    private int flightMoodUntil;
    private boolean flightMoodAir;
    private int flightAskAge = -100;
    private Vec3 flightAskPoint = Vec3.ZERO;
    private boolean flightAskLand;
    private boolean flightAskLow;
    private boolean flightArrived;
    private boolean flightReturning;
    private Vec3 flightHomePoint = Vec3.ZERO;
    private int flightReturnAge;
    private boolean flightFought;
    private int flightCircleSide = 1;
    private int flightStuck;
    private Vec3 flightLast = Vec3.ZERO;
    private int flightAvoidUntil;
    private int flightAvoidSide = 1;
${footprint ? "    private int flightLandRetry;\n" : ""}${
  home
    ? ""
    : `    // A roam: with no home in its document it keeps within this many blocks of where it first stood when a command that places it asks for it (the NBT value "FlightRoam"; 0: no roam).
    private static final double FLIGHT_ROAM_LEAST = ${real(FLIGHT_LIMITS.roam.min)};
    private static final double FLIGHT_ROAM_MOST = ${real(FLIGHT_LIMITS.roam.max)};
    private double flightRoam;
    private boolean flightRoamSet;
    private double flightRoamX;
    private double flightRoamZ;
`
}${
  asked
    ? `    // What gameplay code asked of it last (\`ProjectContent.flyTo\` / \`land\`): a place, whether to set down there, when it was asked and when it got there. Not saved.
    // It is held a few seconds once there (hovering or circling), and given up if it cannot get there in half a minute; then its own wandering goes on.
    private static final int FLIGHT_REQUEST_HOLD = ${FLIGHT_LIMITS.requestHold * 20};
    private static final int FLIGHT_REQUEST_GIVE_UP = ${FLIGHT_LIMITS.requestGiveUp * 20};
    private Vec3 flightRequestPoint;
    private boolean flightRequestLand;
    private int flightRequestAge;
    private int flightRequestArrivedAt = -1;
`
    : ""
}${
  input.abilities
    ? `    private boolean flightDiveLocked;
    private Vec3 flightDiveGoal = Vec3.ZERO;
${reach ? "    // Where the one it dives at stood when it locked on (the middle of their body, and their feet): it faces that while its body goes to the goal.\n    private Vec3 flightDiveFace = Vec3.ZERO;\n    private double flightDiveFloor;\n" : ""}`
    : ""
}    // In the player's game only: how fast it moves (blocks a tick, smoothed), the lean it is drawn at and the last place and facing it was seen at.
    private double flightRun;
    private double flightRise;
    private boolean flightGliding;
    private float flightPitch;
    private float flightPitchPrev;
    private float flightRoll;
    private float flightRollPrev;
    private float flightLastYaw;
    private Vec3 flightSeen;
`,
    methods: `${
      paced
        ? `    /**
     * A phase of the boss that is faster than the first makes its flight faster as it makes its walking faster: every speed (cruise, the least it flies at, how fast it picks up and loses speed)
     * and how fast it turns are the document's numbers times the phase's. Its acceleration and brake keep the seconds the document gives for reaching cruise and stopping, and its turning keeps its
     * turning radius (speed over turn rate), so the circle it was given still holds. At the most a document allows (30 blocks a second, a phase twice as fast) that is 3 blocks a tick, under the
     * 3.9 a velocity may be before the game sends it to the players as a jump; the dive's charge is held to that bound below anyway.
     */
    private double flightPace() { return bossSpeedScale(); }

    private double flightCruise() { return FLIGHT_CRUISE * flightPace(); }

    private double flightStall() { return FLIGHT_STALL * flightPace(); }

    private double flightAccel() { return FLIGHT_ACCEL * flightPace(); }

    private double flightBrake() { return FLIGHT_BRAKE * flightPace(); }

    private float flightTurn() { return (float) (FLIGHT_TURN * flightPace()); }
${
        input.abilities
          ? `
    /** The charge is never slower than twice the cruise of the phase, and never faster than the bound above. */
    private double flightDiveLeast() { return Math.min(FLIGHT_DIVE_LEAST * flightPace(), FLIGHT_DIVE_MOST); }

    private double flightDiveAccel() { return FLIGHT_DIVE_ACCEL * flightPace(); }
`
          : ""
      }
`
        : ""
    }    private int flightState() { return getEntityData().get(FLIGHT); }

    private void flightSet(int state) {
        getEntityData().set(FLIGHT, (byte) state);
        flightSince = tickCount;
    }

    /** Anything but the ground state keeps it from falling; the ground state gives the game's gravity back. */
    private void flightGravity() {
        boolean off = flightState() != FLIGHT_GROUND;
        if (off != flightGravityOff) {
            flightGravityOff = off;
            setNoGravity(off);
        }
    }

    /**
     * Whether a dead flier may be taken away now, \`due\` being the death tick it would go at anyway: once it has come down, or into water, or has
     * been falling as long as a fall can last (\`FLIGHT_FALL_TICKS\`). Killed in the sky, it would otherwise be removed in mid-air with its death motion unfinished.
     */
    private boolean flightFallen(int due) { return onGround() || isInWater() || deathTime >= due + FLIGHT_FALL_TICKS; }

    // A flier takes no damage from a fall: not from the sky, not from a command that puts it there.
    @Override public boolean causeFallDamage(float fallDistance, float damageMultiplier, DamageSource damageSource) { return false; }

    // In the air the creature carries itself: its velocity is the whole of its movement. The game's own walking and falling are for the ground.
    @Override public void travel(Vec3 movementInput) {
        if (flightState() == FLIGHT_GROUND || isDeadOrDying()) {
            super.travel(movementInput);
            return;
        }
        move(MoverType.SELF, getDeltaMovement());
    }

${
  input.abilities
    ? `    /** An ability starts only where its document says it may, and a dive only in the air; never while it takes off or lands or flies home. */
    private boolean flightAllows(int index) {
        int state = flightState();
        if (state == FLIGHT_TAKEOFF || state == FLIGHT_LANDING || flightReturning) return false;
        if (FLIGHT_DIVE[index] && state != FLIGHT_AIR) return false;
        return FLIGHT_WHERE[index] == 0 || (FLIGHT_WHERE[index] == 1) == (state == FLIGHT_GROUND);
    }

    /**
     * broad11 w1 recheck: a flier in the air turns at its own rate (a thunderbird, 5 degrees a tick) while the one it fights may be anywhere round it; an ability whose hits are laid out ahead
     * of it (\`FLIGHT_FACES\`) starts only when it can face them by the end of getting ready: its turn rate times the ticks of getting ready and one more. On the ground it turns as one that walks.
     */
    private boolean flightFaces(int index, LivingEntity target) {
        if (!FLIGHT_FACES[index] || flightState() == FLIGHT_GROUND) return true;
        double dx = target.getX() - getX();
        double dz = target.getZ() - getZ();
        if (dx * dx + dz * dz < 1.0e-4) return true;
        float off = Math.abs(Mth.wrapDegrees((float) (Mth.atan2(dz, dx) * 180.0 / Math.PI) - 90.0f - getYRot()));
        return off <= flightTurnCap() * (ABILITY_WINDUP[index] + 1);
    }

${
  airReach
    ? `    /**
     * epic game1: a frost dragon breathed with a cone 16 blocks long from its mouth, started it with the mouth 17 to 24 blocks from the player and flew on past them: four breaths in seven missed all three hits;
     * and with the gate at the first hit alone, breaths that began 14.9 blocks away ended 16.5 away, and ones that flew in met the player at 4.5 blocks and 21° off the aim. An ability in the air aimed at the
     * one it fights (\`FLIGHT_REACH\`: reach, then the place its hits start at: up, ahead, left, then the ticks of the first and of the last aimed hit, then the push of the hits before) starts only when the
     * hold, flown forward from where the flier is, keeps that place within the reach at every aimed hit and never nearer than a third of it (\`airReachPath\`, \`airReachMayStart\`: one rule with the same
     * steps, tick by tick). Each tick, in the game's order: while the ability gets ready and tracks, it turns the body toward the one it fights by the turn cap (\`abilityAim\`); from the first hit on the place
     * (the bone, carried by the lean and turned as the body faces) is read against the middle of the one it fights, who is taken to stand still; then the flight steers toward the station
     * (\`flightReachStation\`: \`min(flat, body)\` out along the bearing, at the height of \`flightReachFeet\`), its heading and climb turning by the turn rate and its speed going to the one it keeps (a soaring
     * flier cannot stop: its stall speed; a hovering one half its cruise, and still within a block of the station) by the steps its speed may change by (\`flightMove\`), and moves. The limit is the reach less
     * the push of the hits before the last and a step of cruise (\`airReachLimit\`), or the station and a step where the floor rule keeps the station farther than that. It is held from the air only; on the
     * ground nothing is held.
     */
    private boolean flightReaches(int index, LivingEntity target) {
        double[] reach = FLIGHT_REACH[index];
        if (reach == null || flightState() == FLIGHT_GROUND) return true;
        double scale = getScale();
${
  input.lean
    ? "        double[] at = flightLeaned(reach[2] * scale, reach[1] * scale, reach[3] * scale);"
    : "        double[] at = {reach[2] * scale, reach[1] * scale, reach[3] * scale};"
}
        double middle = target.getY(0.5);
        // The floor rule: the feet never under a block over the ground at the target's column, measured from the target's middle.
        double floor = flightGround(target.getX(), target.getZ(), target.getY()) + 1.0 - middle;
        double station = Math.max(reach[0] / 3.0 - reach[1] * scale, floor);
        double body = Math.max(0.0, reach[2] * scale + Math.sqrt(Math.max(0.0, (reach[0] * 2.0 / 3.0) * (reach[0] * 2.0 / 3.0) - reach[3] * scale * reach[3] * scale)));
        double x = getX() - target.getX();
        double z = getZ() - target.getZ();
        double feet = getY() - middle;
        double facing = getYRot();
        double climb = flightClimbNow;
        double speed = flightSpeed;
        double near = Double.MAX_VALUE;
        double far = 0.0;
        for (int tick = 0; tick <= (int) reach[5]; tick++) {
            boolean getting = ABILITY_TRACKS[index] && tick < ABILITY_WINDUP[index];
            if (getting) facing += Mth.clamp(Mth.wrapDegrees((float) (Math.toDegrees(Math.atan2(-z, -x)) - 90.0 - facing)), -${turnRate}, ${turnRate});
            if (tick >= (int) reach[4]) {
                double angle = Math.toRadians(facing);
                double distance = Math.sqrt(Math.pow(x - at[0] * Math.sin(angle) + at[2] * Math.cos(angle), 2.0) + Math.pow(z + at[0] * Math.cos(angle) + at[2] * Math.sin(angle), 2.0) + Math.pow(feet + at[1], 2.0));
                near = Math.min(near, distance);
                far = Math.max(far, distance);
            }
            double flat = Math.sqrt(x * x + z * z);
            double away = flat > 1.0e-3 ? Math.min(flat, body) / flat : 0.0;
            double toX = x * away - x;
            double toZ = z * away - z;
            double across = Math.sqrt(toX * toX + toZ * toZ);
            boolean stays = !FLIGHT_SOAR && Math.sqrt(across * across + (station - feet) * (station - feet)) < 1.0;
            double heading = facing;
            if (!stays && across > 0.05) heading += Mth.clamp(Mth.wrapDegrees((float) (Math.toDegrees(Math.atan2(-toX, toZ)) - heading)), -${turnRate}, ${turnRate});
            double wantClimb = stays ? 0.0 : Mth.clamp(Math.toDegrees(Math.atan2(station - feet, Math.max(across, 0.5))), -FLIGHT_CLIMB, FLIGHT_CLIMB);
            climb = Mth.clamp(climb + Mth.clamp(wantClimb - climb, -${turnRate}, ${turnRate}), -FLIGHT_CLIMB, FLIGHT_CLIMB);
            double want = stays ? 0.0 : FLIGHT_SOAR ? ${stall} : ${cruise} * 0.5;
            speed = Math.max(0.0, speed + Mth.clamp(want - speed, -${brake}, ${accel}));
            double lift = Math.toRadians(climb);
            x += -Math.sin(Math.toRadians(heading)) * Math.cos(lift) * speed;
            z += Math.cos(Math.toRadians(heading)) * Math.cos(lift) * speed;
            feet += Math.sin(lift) * speed;
            if (!getting) facing = heading;
        }
        // The farthest the place may be: the reach less the push of the hits before the last and a step of cruise; the station itself and a step where the floor rule keeps it farther.
        double lowest = floor + reach[1] * scale;
        double nearest = Math.hypot(reach[0] * 2.0 / 3.0, Math.max(reach[0] / 3.0, lowest));
        return far <= Math.max(reach[0] - reach[6] - ${cruise}, nearest + ${cruise}) && near >= reach[0] / 3.0;
    }

    /** A tick of flight at the speed it cruises at now, blocks: the room the start of an aimed ability leaves inside its reach (\`flightReaches\`), and the room its aim follows the one it fights by (\`abilityFollow\`). */
    private double flightStep() { return ${cruise}; }

    /**
     * How high the flier's feet are asked to be while an ability aimed at the one it fights runs: where the place its hits start at is a third of their reach above the middle of the one it fights,
     * its feet never less than a block above the ground at \`x\`, \`z\` (the floor rule).
     */
    private double flightReachFeet(double[] reach, LivingEntity target, double x, double z) {
        return Math.max(target.getY(0.5) + reach[0] / 3.0 - reach[1] * getScale(), flightGround(x, z, getY()) + 1.0);
    }

    /**
     * epic game1: where the middle of the flier goes, and holds, while an ability aimed at the one it fights runs (null: none does, or it has no one to aim at, and it keeps its height as it always did).
     * The point lies on the bearing it has from the one it fights. Facing them, the place its hits start at (\`ahead\` in front of the middle of its body, \`left\` beside it) is
     * sqrt((distance - ahead)² + left²) from them across; set to two thirds of the reach, the middle stands \`ahead + sqrt(across² - left²)\` from them, never less than 0: never past them. The height is
     * the one \`flightReachFeet\` gives: a third of the reach above them. The place is then 0.745 of the reach from them, a quarter of it left for them stepping aside.
     * One nearer than that stays on its own side where it is, never backing off: a hovering one only sinks or climbs there, a soaring one (which cannot stop) goes on at its stall speed.
     * \`closing\`: the ability is not running yet and the flier is on its way to start it (\`flightReachReady\`): the point is over the one it fights, at the same height, so that it flies square at them.
     */
    private Vec3 flightReachStation(int index, LivingEntity target, boolean closing) {
        double[] reach = index >= 0 ? FLIGHT_REACH[index] : null;
        if (reach == null || target == null) return null;
        double scale = getScale();
        double dx = getX() - target.getX();
        double dz = getZ() - target.getZ();
        double flat = Math.sqrt(dx * dx + dz * dz);
        float turn = getYRot() * 0.017453292f;
        // Right over them it keeps to the side it came from: behind the way it faces.
        double bearingX = flat > 1.0e-3 ? dx / flat : Mth.sin(turn);
        double bearingZ = flat > 1.0e-3 ? dz / flat : -Mth.cos(turn);
        double ahead = reach[2] * scale;
        double left = reach[3] * scale;
        double across = reach[0] * 2.0 / 3.0;
        double body = Math.max(0.0, ahead + Math.sqrt(Math.max(0.0, across * across - left * left)));
        double away = closing ? 0.0 : Math.min(flat, body);
        double x = target.getX() + bearingX * away;
        double z = target.getZ() + bearingZ * away;
        return new Vec3(x, flightReachFeet(reach, target, x, z) + getBbHeight() / 2.0, z);
    }

${
  approach
    ? `    /**
     * epic game1: the first ability aimed at the one it fights that is ready (its wait is over${input.boss ? ", its phase allows it" : ""}); -1: none. A circle round the one it fights is too wide for it to start from
     * and cannot be made tight enough (\`flightCircle\`, \`approach\`), so the flier closes in on its target until it starts, and holds station from there.
     */
    private int flightReachReady() {
        for (int index = 0; index < FLIGHT_REACH.length; index++) if (FLIGHT_REACH[index] != null && tickCount >= abilityReadyAt[index]${input.boss ? " && bossAllows(index)" : ""}) return index;
        return -1;
    }
`
    : ""
}
`
    : ""
}    /** How fast it may turn right now: its own limit in the air, and as a creature that walks turns (30 degrees a tick) on the ground; a dive is not turned off its line. */
    private float flightTurnCap() {
        if (flightState() == FLIGHT_GROUND) return 30.0f;
        return ${diving} ? 0.0f : ${turnRate};
    }

`
    : ""
}${
  home
    ? ""
    : `    /** Where it first stood while it keeps to a roam; null when it does not (the usual: nothing asked for one). */
    private Vec3 flightRoamCentre() { return flightRoam > 0.0 && flightRoamSet ? new Vec3(flightRoamX, getY(), flightRoamZ) : null; }

    private boolean flightRoamInside(Vec3 point) {
        Vec3 centre = flightRoamCentre();
        if (centre == null) return true;
        double dx = point.x - centre.x;
        double dz = point.z - centre.z;
        return dx * dx + dz * dz <= flightRoam * flightRoam;
    }

`
}    private boolean flightNear(Vec3 point, double radius) {
        double dx = getX() - point.x;
        double dz = getZ() - point.z;
        return dx * dx + dz * dz <= radius * radius;
    }

    /** Within a body length and a half of a place counts as set down there (and never nearer than six blocks). */
    private double flightLandReach() { return Math.max(6.0, getBbWidth() * 1.5); }

    private boolean flightAsked() { return tickCount - flightAskAge <= 3; }

    /**
     * Asked on every tick by whatever wants the creature at a place by flying (a habit, the boss's way home): it takes off if it must and flies there;
     * with \`land\` it comes down there, else it stays in the air; \`low\` lets it fly close to the ground (hunting). True once it is there.
     */
    private boolean flightGo(Vec3 point, boolean land, boolean low) {
        flightAskAge = tickCount;
        flightAskPoint = point;
        flightAskLand = land;
        flightAskLow = low;
        return flightArrived;
    }

    /** The boss's way back to where it began: it flies there and is set down (a leash works for a flier too). */
    private void flightComeHome(double x, double y, double z) {
        flightReturning = true;
        flightHomePoint = new Vec3(x, y, z);
        flightReturnAge = tickCount;
        flightArrived = false;
    }

${
  after === "getTarget()"
    ? ""
    : `    /**
     * Whom it is after: the game's target, whoever set it (its own targeting, a revenge, gameplay code), else the one its own chase goal picked.
     * Every choice below reads this, so a creature that is after somebody is in the air or on the ground by what it can do there, not by who told it to go.
     */
    private LivingEntity flightAfter() {
        LivingEntity target = getTarget();
        if (target != null && target.isAlive()) return target;
${input.chased ? `        LivingEntity chasing = ${input.chased};\n        return chasing != null && chasing.isAlive() ? chasing : null;` : "        return null;"}
    }

`
}    /** Whether it wants to be in the air now: sent somewhere by flying, fighting in the air, or (when nothing asks anything of it) in the mood for it. */
    private boolean flightWantsAir() {
        if (flightReturning) return true;
${display ? "        // A boss waking up shows itself in the air, whatever else asks something of it.\n        if (bossDisplay()) return true;\n" : ""}        LivingEntity target = ${after};
        if (target != null && target.isAlive()${goesUp ? ` && ${goesUp}` : ""}) return ${lands ? "!flightStaysDown()" : "true"};
        if (flightAsked()) return !(flightAskLand && flightArrived);
        if (target != null && target.isAlive()) return false;
        if (${input.resting ?? "false"}) return false;${
  input.eating
    ? `
        // A meal on the ground is eaten to its end: a mood for the air does not take it from it.
        if (${input.eating}) return false;`
    : ""
}
        if (tickCount >= flightMoodUntil) {
            flightMoodAir = random.nextDouble() < FLIGHT_AIR_SHARE;
            flightMoodUntil = tickCount + FLIGHT_MOOD_MIN + random.nextInt(FLIGHT_MOOD_MAX - FLIGHT_MOOD_MIN + 1);
        }
        return flightMoodAir;
    }

    private boolean flightUrgent() {
        LivingEntity target = ${after};
        return flightReturning || flightAsked() || ${display ? "bossDisplay() || " : ""}(${goesUp ? `${goesUp} && ` : ""}target != null && target.isAlive());
    }
${
  lands
    ? `
    /** Whether an ability is ready: its wait is over and, for a boss, its phase allows it. Where it is and how far the target is are not asked. */
    private boolean flightReady(int index) { return tickCount >= abilityReadyAt[index]${input.boss ? " && bossAllows(index)" : ""}; }

    /** Some ability that starts in the air (anywhere, or only there) is ready: it has something to do up there. */
    private boolean flightAirReady() {
        for (int index = 0; index < FLIGHT_WHERE.length; index++) if (FLIGHT_WHERE[index] != 1 && flightReady(index)) return true;
        return false;
    }

    /** Some ground-only ability is ready. */
    private boolean flightGroundAny() {
        for (int index = 0; index < FLIGHT_WHERE.length; index++) if (FLIGHT_WHERE[index] == 1 && flightReady(index)) return true;
        return false;
    }

    /**
     * The ground-only ability that is ready and whose window fits once it has come down, else -1: the window reaches out beyond where the two bodies touch (half of each width), so there is a place
     * to stand in it. How far the target will be when it is down is not asked: it walks to it, as it does whenever it fights on the ground.
     */
    private int flightGroundReady(LivingEntity target) {
        double clearance = (getBbWidth() + target.getBbWidth()) / 2.0;
        for (int index = 0; index < FLIGHT_WHERE.length; index++) if (FLIGHT_WHERE[index] == 1 && flightReady(index) && FLIGHT_FAR[index] >= clearance) return index;
        return -1;
    }

    /**
     * Whether it comes down now for a ground-only ability (its index), else -1. It decides only when it has been up a while (\`FLIGHT_AIR_LEAST\`, as for any other landing), no ability that starts in the
     * air is ready, and some ground-only one is. Having decided, it goes on down until it is down, but for no longer than it tries to get anywhere before it gives up (\`FLIGHT_GIVE_UP_TICKS\`), and not
     * when the ability stops being allowed on the way (a new phase). After a landing that did not get its ability used it does not come down again for as long as that landing could have taken.
     */
    private int flightGroundWanted(LivingEntity target) {
        if (flightGroundFor >= 0) {
            if (tickCount < flightGroundUntil && flightReady(flightGroundFor)) return flightGroundFor;
            flightGroundGiveUp();
            return -1;
        }
        if (tickCount < flightGroundNext || tickCount - flightSince < FLIGHT_AIR_LEAST || flightAirReady()) return -1;
        int index = flightGroundReady(target);
        if (index < 0) return -1;
        flightGroundFor = index;
        flightGroundUsed = false;
        flightGroundUntil = tickCount + FLIGHT_GIVE_UP_TICKS;
        flightLandSpot = null;
        return index;
    }

    /** What a landing that was for nothing costs: the trip down and up again and the ability itself, as long as it would have taken. */
    private int flightGroundTrip(int index) { return ABILITY_LENGTH[index] + FLIGHT_LAND_TICKS + FLIGHT_TAKEOFF_TICKS; }

    private void flightGroundGiveUp() {
        if (flightGroundFor < 0) return;
        if (!flightGroundUsed) flightGroundNext = tickCount + flightGroundTrip(flightGroundFor);
        flightGroundFor = -1;
        flightLandSpot = null;
    }

    /**
     * On the ground, having come down for an ability: whether it stays down. It stays until it has used one ground-only ability, or waited for it as long as the trip down and up cost
     * (\`flightGroundTrip\`: a longer wait on the ground than the way it came is a wasted landing); once one has been used it stays while no ability that starts in the air is ready. It leaves at
     * once when it was hit and has nothing to answer with (no ground-only ability is ready), or when the one it fights is further than any ground-only ability reaches (left behind).
     */
    private boolean flightStaysDown() {
        if (flightGroundFor < 0 || flightState() != FLIGHT_GROUND) return false;
        LivingEntity target = ${after};
        if (target == null || !target.isAlive()) {
            flightGroundGiveUp();
            return false;
        }
        boolean stays;
        if (hurtTime > 0 && !flightGroundAny()) stays = false;
        else if (flightGroundUsed) stays = !flightAirReady() && distanceToSqr(target) <= FLIGHT_GROUND_REACH * FLIGHT_GROUND_REACH;
        else stays = tickCount < flightGroundUntil;
        if (!stays) flightGroundGiveUp();
        return stays;
    }

    /** Down toward a place on its own side of the one it fights, in the middle of the window the ability it came for starts in (never inside their two bodies); a place with room for its whole box when it is wide. */
    private void flightGroundDescend(LivingEntity target, int index) {
        flightDescending = true;
        if (flightLandSpot == null || flightLandSpot.distanceToSqr(target.position()) > FLIGHT_FAR[index] * FLIGHT_FAR[index]) {
            double clearance = (getBbWidth() + target.getBbWidth()) / 2.0;
            double stand = Mth.clamp((FLIGHT_NEAR[index] + FLIGHT_FAR[index]) / 2.0, clearance, FLIGHT_FAR[index]);
            double awayX = getX() - target.getX();
            double awayZ = getZ() - target.getZ();
            double flat = Math.sqrt(awayX * awayX + awayZ * awayZ);
            Vec3 at = flat > 0.01 ? new Vec3(target.getX() + awayX / flat * stand, target.getY(), target.getZ() + awayZ / flat * stand) : target.position().add(stand, 0.0, 0.0);
            // The search square (half side \`spread\`, corners \`spread * sqrt(2)\` from \`at\`) stays inside the window: \`at\` is \`stand\` from the target, so every place in it is at least \`stand - spread * sqrt(2)\` and
            // at most \`stand + spread * sqrt(2)\` from them, which is within [NEAR, FAR] (and not inside the two bodies) when \`spread\` is at most the room \`at\` has to the nearer edge, over sqrt(2), and 4 blocks at most.
            double spread = Math.min(4.0, Math.min(stand - Math.max(FLIGHT_NEAR[index], clearance), FLIGHT_FAR[index] - stand) / Math.sqrt(2.0));
            flightLandSpot = flightPickLanding(at, spread);
        }
        flightDown();
    }

    /** On the ground: using a ground-only ability is what it came down for. */
    private void flightGroundTrack() {
        if (abilityRunning() && FLIGHT_WHERE[abilityIndex] == 1) flightGroundUsed = true;
    }
`
    : ""
}
${
  asked
    ? `    /** Gameplay code asks it to fly to a place (where its feet will be): it takes off if it must, flies there and stays about it a few seconds. A dead creature, and the player's game, ignore it. */
    @Override public void studioFlyTo(double x, double y, double z) {
        if (level().isClientSide() || isDeadOrDying()) return;
        Vec3 point = new Vec3(x, y + getBbHeight() / 2.0, z);
        // The same place asked again and again (a goal asking every few ticks) keeps the request alive without starting its time at the place over.
        boolean same = flightRequestPoint != null && !flightRequestLand && flightRequestPoint.distanceToSqr(point) < 0.25;
        flightRequestPoint = point;
        flightRequestLand = false;
        flightRequestAge = tickCount;
        if (!same) flightRequestArrivedAt = -1;
    }

    /** Whether it is off the ground, taking off and landing included. */
    @Override public boolean studioFlying() { return flightState() != FLIGHT_GROUND; }

    /** Gameplay code asks it to come down where it is: it lands, and stays down for at least a mood's shortest time before it takes off by itself. */
    @Override public void studioLand() {
        if (level().isClientSide() || isDeadOrDying()) return;
        flightRequestPoint = position();
        flightRequestLand = true;
        flightRequestAge = tickCount;
        flightRequestArrivedAt = -1;
        flightMoodAir = false;
        flightMoodUntil = tickCount + FLIGHT_MOOD_MIN;
    }

    /** Asks \`flightGo\` on every tick for what gameplay code asked, until it has been there for the hold or has not got there in time. A set-down request ends the moment it is down. */
    private void flightRequestTick() {
        if (flightRequestPoint == null) return;
        int hold = flightRequestLand ? 0 : FLIGHT_REQUEST_HOLD;
        if (tickCount - flightRequestAge > FLIGHT_REQUEST_GIVE_UP || (flightRequestArrivedAt >= 0 && tickCount - flightRequestArrivedAt > hold)) {
            flightRequestPoint = null;
            return;
        }
        if (flightArrived && flightRequestArrivedAt < 0) flightRequestArrivedAt = tickCount;
        // Low: it flies to the height it was given, not to its band over the ground there.
        flightGo(flightRequestPoint, flightRequestLand, !flightRequestLand);
    }

`
    : ""
}    private void tickFlight() {
        if (level().isClientSide()) {
            flightLook();
            return;
        }
${input.lean ? "        // The server leans the body the way the players see it, to know where a part of it is: the same sum, from the same motion.\n        flightLook();\n" : ""}        if (isDeadOrDying()) {
            // Dead in the air, it falls: the game's gravity takes it back, it neither flaps nor steers, and its death motion (the death controller, which a flier
            // shares with every creature) plays while it falls. It is not taken away until it is down (\`flightFallen\`), so the end of the motion is seen on the ground.
${asked ? "            flightRequestPoint = null;\n" : ""}            flightReturning = false;
            if (flightState() != FLIGHT_GROUND) flightSet(FLIGHT_GROUND);
            flightGravity();
            return;
        }
${home ? "" : "        // Where it first stood is where its roam is round, whoever put it there.\n        if (flightRoam > 0.0 && !flightRoamSet) {\n            flightRoamSet = true;\n            flightRoamX = getX();\n            flightRoamZ = getZ();\n        }\n"}        flightGravity();
${asked ? "        flightRequestTick();\n" : ""}        flightArrival();
        if (flightReturning) flightReturnTick();
        int state = flightState();
${display ? "        // A boss that is waking up does not move on its own, but its show is the flight's: it rises and circles.\n" : ""}        boolean frozen = isImmobile()${display ? " && !bossDisplay()" : ""};
        if (state == FLIGHT_GROUND) {
${lands ? "            flightGroundTrack();\n" : ""}            // Falling further than the game's own limit for a fall that hurts (3 blocks) it opens its wings instead: put in the sky, it flies.
            boolean falling = !frozen && !onGround() && fallDistance > FLIGHT_FALL;
            if (!frozen && !isInWater() && !${busy} && (falling || (flightWantsAir() && (flightUrgent() || tickCount - flightSince >= FLIGHT_GROUND_LEAST)))) flightTakeoff();
            return;
        }
        getNavigation().stop();
        flightScan();
        if (state == FLIGHT_TAKEOFF) flightTakeoffTick(frozen);
        else if (state == FLIGHT_LANDING) flightLandingTick(frozen);
        else flightAirTick(frozen);
    }

    /** Whether it is where it was sent: there within reach, and set down when it was to land. */
    private void flightArrival() {
        boolean asked = flightReturning || flightAsked();
        if (!asked) {
            flightArrived = false;
            return;
        }
        Vec3 at = flightReturning ? flightHomePoint : flightAskPoint;
        boolean land = flightReturning || flightAskLand;
        flightArrived = land ? flightState() == FLIGHT_GROUND && flightNear(at, flightLandReach()) : flightNear(at, FLIGHT_ARRIVE);
    }

    private void flightReturnTick() {
        boolean late = tickCount - flightReturnAge > FLIGHT_RETURN_TICKS;
        if (!flightArrived && !late) return;
        // A flight that could not get there (a cave, a roof) ends with it set down at home: a boss that must be back is back.
        if (!flightArrived) {
            moveTo(flightHomePoint.x, flightHomePoint.y, flightHomePoint.z, getYRot(), 0.0f);
            flightSet(FLIGHT_GROUND);
            flightGravity();
        }
        setDeltaMovement(Vec3.ZERO);
        flightSpeed = 0.0;
        flightReturning = false;
        flightArrived = false;
        ${input.arrived}
    }

    private void flightTakeoff() {
${lands ? "        flightGroundGiveUp();\n" : ""}        flightSet(FLIGHT_TAKEOFF);
        flightGravity();
        flightTimer = FLIGHT_TAKEOFF_TICKS;
        flightStartY = getY();
        flightSpeed = 0.0;
        flightClimbNow = 0.0f;
        flightDescending = false;
        flightLandSpot = null;
        flightWander = null;
        flightStuck = 0;
        getNavigation().stop();
    }

    /** Up it goes, eased in and out, to the least height of its band in the time its document gives; forward it picks up the speed it needs to stay up. */
    private void flightTakeoffTick(boolean frozen) {
        if (frozen) {
            setDeltaMovement(Vec3.ZERO);
            flightSpeed = 0.0;
            return;
        }
        if (--flightTimer <= 0) {
            flightSet(FLIGHT_AIR);
            return;
        }
        double done = 1.0 - flightTimer / (double) FLIGHT_TAKEOFF_TICKS;
        double ease = done * done * (3.0 - 2.0 * done);
        double rise = flightStartY + FLIGHT_ALT_MIN * ease - getY();
        flightSpeed += Mth.clamp(${stall} - flightSpeed, -${brake}, ${accel});
        double turn = Math.toRadians(getYRot());
        setDeltaMovement(-Math.sin(turn) * flightSpeed, Mth.clamp(rise, -2.0, 2.0), Math.cos(turn) * flightSpeed);
    }

    /** Down the last stretch (it is within a block of the ground): the speed dies away and it settles, in the time its document gives; then it walks. */
    private void flightLandingTick(boolean frozen) {
        if (frozen) {
            setDeltaMovement(Vec3.ZERO);
            return;
        }
        flightTimer--;
        int left = Math.max(1, flightTimer);
        flightSpeed = Math.max(0.0, flightSpeed - flightSpeed / left);
        double turn = Math.toRadians(getYRot());
        setDeltaMovement(-Math.sin(turn) * flightSpeed, -Math.min(flightAbove, 2.0) / left, Math.cos(turn) * flightSpeed);
        if (flightTimer <= 0) {
            flightSet(FLIGHT_GROUND);
            flightGravity();
            setDeltaMovement(Vec3.ZERO);
            flightSpeed = 0.0;
            flightClimbNow = 0.0f;${lands ? "\n            // Down for an ability: it waits for it no longer than the trip down and up cost.\n            if (flightGroundFor >= 0) flightGroundUntil = tickCount + flightGroundTrip(flightGroundFor);" : ""}
        }
    }

    private void flightAirTick(boolean frozen) {
        if (frozen) {
            // Changing phase, waking: it does nothing, and does not fall.
            setDeltaMovement(getDeltaMovement().scale(0.8));
            flightSpeed *= 0.8;
            return;
        }
${paced && !input.abilities ? "        // Its pace is its phase's: what it picks up speed by follows it.\n        flightPush = flightAccel();\n" : ""}${
  input.abilities
    ? `        flightPush = ${accel};
        if (abilityRunning() && FLIGHT_DIVE[abilityIndex]) {
            flightDive();
            return;
        }
        flightDiveLocked = false;
`
    : ""
}        if (${busy}) {
${
  airReach
    ? `            // One aimed at the one it fights holds station where its hits reach them (\`flightReachStation\`) instead of travelling on: a hovering one goes there at half its cruise and stops, a soaring one
            // (which cannot stop) at its stall speed; both at the height the station gives, never nearer the ground than a block.
            Vec3 station = flightReachStation(abilityIndex, abilityTarget, false);
            if (station != null) {
                if (FLIGHT_SOAR) {
                    flightSteer(station, ${stall}, false);
                    // Once it is done getting ready the ability no longer turns it: its hits are counted with the way the flight turns it, as a dive's are.
                    if (!ABILITY_TRACKS[abilityIndex] || abilityTick >= ABILITY_WINDUP[abilityIndex]) abilityYaw = getYRot();
                } else if (getBoundingBox().getCenter().distanceTo(station) < 1.0) {
                    // Within a block of the point (the slack of the far-end finding) it stays.
                    flightMove(0.0, getYRot(), 0.0f);
                } else {
                    flightSteer(station, flightApproach(station, ${cruise} * 0.5), false);
                }
                return;
            }
`
    : ""
}            // An ability that stands where it is: a soaring creature goes on in the line it was in, a hovering one stops.
            flightMove(FLIGHT_SOAR ? Math.max(flightSpeed, ${stall}) : 0.0, getYRot(), 0.0f);
            return;
        }
        flightStuckCheck();
        flightWhere();
        // Down on the ground within a block and set to land: the last stretch is the landing.
        if (flightDescending && flightAbove <= FLIGHT_LAND_HEIGHT && !flightWater${footprint ? " && flightLandSpot != null" : ""}) {
            flightSet(FLIGHT_LANDING);
            flightTimer = FLIGHT_LAND_TICKS;
            flightDescending = false;
            flightLandSpot = null;
        }
    }

    /** Decides where to, how fast, and whether to keep clear of the ground, and steers there. */
    private void flightWhere() {
${
  display
    ? `        if (bossDisplay()) {
            // The wake-up of a boss that flies: high over whoever woke it, round and round, until the show is over.
            flightDescending = false;
            flightLandSpot = null;
            flightShow(bossShowAt != null ? bossShowAt : position());
            return;
        }
`
    : ""
}        LivingEntity target = ${after};
        boolean fights = !flightReturning && FLIGHT_FIGHTS && target != null && target.isAlive();
${plan.harries ? "        boolean harries = !flightReturning && !fights && target != null && target.isAlive();\n" : ""}${lands ? "        if (!fights) {\n            flightFought = false;\n            flightGroundGiveUp();\n        }" : "        if (!fights) flightFought = false;"}
        double height = getBbHeight() / 2.0;
        if (flightReturning || (flightAsked() && !fights${plan.harries ? " && !harries" : ""})) {
            Vec3 at = flightReturning ? flightHomePoint : flightAskPoint;
            boolean land = flightReturning || flightAskLand;
            if (land && flightNear(at, flightLandReach())) {
                flightDescending = true;
                if (flightLandSpot == null) flightLandSpot = flightPickLanding(at, 4.0);
                flightDown();
            } else {
                flightDescending = false;
                flightLandSpot = null;
                boolean low = !flightReturning && flightAskLow;
                double ground = flightGround(at.x, at.z, at.y);
                Vec3 goal = new Vec3(at.x, low ? at.y : ground + (FLIGHT_ALT_MIN + FLIGHT_ALT_MAX) / 2.0 + height, at.z);
                flightSteer(goal, flightApproach(goal, ${cruise}), !low);
            }
            return;
        }
        if (fights) {
${
  lands
    ? `            // No ability that starts in the air is ready and a ground-only one is: it comes down by the one it fights and uses it there.
            int grounded = flightGroundWanted(target);
            if (grounded >= 0) {
                flightGroundDescend(target, grounded);
                return;
            }
`
    : ""
}            flightDescending = false;
${
  approach
    ? `            // An aimed ability that is ready cannot start from the circle (it is too wide for its hits, and cannot be made tighter than the flier turns): it flies square at the one it fights until it starts.
            int reaching = flightReachReady();
            if (reaching >= 0) {
                flightSteer(flightReachStation(reaching, target, true), ${cruise}, false);
                return;
            }
`
    : ""
}            Vec3 around = target.position();
            if (!flightFought) {
                flightFought = true;
                flightCircleSide = random.nextBoolean() ? 1 : -1;
            }
            // It aims at a point on the circle a little ahead of where it is on it, so it goes round the one it fights.
            double angle = Math.atan2(getZ() - around.z, getX() - around.x) + flightCircleSide * Math.min(Math.PI / 2.0, ${cruise} * 20.0 / FLIGHT_CIRCLE_RADIUS);
            double x = around.x + Math.cos(angle) * FLIGHT_CIRCLE_RADIUS;
            double z = around.z + Math.sin(angle) * FLIGHT_CIRCLE_RADIUS;
            double ground = flightGround(x, z, around.y);
            double y = Mth.clamp(around.y + FLIGHT_CIRCLE_HEIGHT, ground + FLIGHT_ALT_MIN, ground + FLIGHT_ALT_MAX) + height;
            flightSteer(new Vec3(x, y, z), ${cruise}, true);
            return;
        }
${
  plan.harries
    ? `        if (harries) {
            flightDescending = false;
            // It comes to the level of the middle of the one it is after and stops a little short of them, so that its box meets theirs at the same height: a swing reaches no further than that.
            Vec3 to = new Vec3(target.getX(), target.getY() + target.getBbHeight() * 0.6, target.getZ());
            Vec3 centre = getBoundingBox().getCenter();
            double awayX = centre.x - to.x;
            double awayZ = centre.z - to.z;
            double flat = Math.sqrt(awayX * awayX + awayZ * awayZ);
            double stand = target.getBbWidth() / 2.0 + getBbWidth() / 2.0 + FLIGHT_HARRY_GAP;
            Vec3 point = flat > 0.01 ? new Vec3(to.x + awayX / flat * stand, to.y, to.z + awayZ / flat * stand) : to;
            flightSteer(point, flightApproach(point, ${cruise}), false);
            return;
        }
`
    : ""
}        // Nothing asks anything of it: when the mood for the air is over, and it has been up long enough, it comes down.
        if (!flightWantsAir() && tickCount - flightSince >= FLIGHT_AIR_LEAST) {
            if (!flightDescending) flightLandSpot = null;
            flightDescending = true;
        } else if (flightWantsAir()) {
            flightDescending = false;
            flightLandSpot = null;
        }
        if (flightDescending) {
            if (flightLandSpot == null) flightLandSpot = flightPickLanding(position(), 10.0);
            flightDown();
            return;
        }
        // Wandering: from point to point inside its band, inside its home when it has one; a hovering one stops a while at each.
        if (tickCount < flightPauseUntil) {
            flightMove(0.0, getYRot(), 0.0f);
            return;
        }
        if (flightWander == null || tickCount - flightWanderAge > 400 || flightNear(flightWander, FLIGHT_ARRIVE)) {
            if (flightWander != null && !FLIGHT_SOAR && flightNear(flightWander, FLIGHT_ARRIVE)) {
                flightWander = null;
                flightPauseUntil = tickCount + 20 + random.nextInt(60);
                return;
            }
            flightWander = flightWanderPoint();
            flightWanderAge = tickCount;
        }
        flightSteer(flightWander, flightApproach(flightWander, ${cruise}), true);
    }

    /** A soaring creature goes at its speed all the way; a hovering one slows so that it stops at the point (the speed it can still stop from). */
    private double flightApproach(Vec3 goal, double speed) {
        if (FLIGHT_SOAR) return speed;
        double far = getBoundingBox().getCenter().distanceTo(goal);
        return Math.min(speed, Math.max(0.04, Math.sqrt(2.0 * ${brake} * far)));
    }

${
  display
    ? `    /**
     * Round a place at the radius it circles at when it fights, as high as its band goes (high above, to be seen): it aims at a point on the circle a little ahead of where it is on it. The side it
     * goes round is the one it will go round the one it fights on, so the show goes over into the fight without a turn about.
     */
    private void flightShow(Vec3 around) {
        if (!flightFought) {
            flightFought = true;
            flightCircleSide = random.nextBoolean() ? 1 : -1;
        }
        double angle = Math.atan2(getZ() - around.z, getX() - around.x) + flightCircleSide * Math.min(Math.PI / 2.0, ${cruise} * 20.0 / FLIGHT_CIRCLE_RADIUS);
        double x = around.x + Math.cos(angle) * FLIGHT_CIRCLE_RADIUS;
        double z = around.z + Math.sin(angle) * FLIGHT_CIRCLE_RADIUS;
        double y = Math.min(flightGround(x, z, around.y) + FLIGHT_ALT_MAX, level().getMaxBuildHeight() - 2.0) + getBbHeight() / 2.0;
        flightSteer(new Vec3(x, y, z), ${cruise}, true);
    }

`
    : ""
}    /** Down to the place it chose to land at, slowly, not keeping off the ground. */
    private void flightDown() {
        Vec3 spot = flightLandSpot;
${
  footprint
    ? `        if (spot == null) {
            // No place with room for its whole box yet: it goes on ahead at the height it has, clear of the ground, and looks again.
            Vec3 ahead = getBoundingBox().getCenter().add(flightWay(getYRot(), 0.0f).scale(FLIGHT_WANDER_MIN));
            flightSteer(new Vec3(ahead.x, getBoundingBox().getCenter().y, ahead.z), ${cruise}, true);
            return;
        }
`
    : ""
}        // Water below the place it came to: it chooses another and keeps its height.
        if (flightWater && flightAbove < FLIGHT_LAND_HEIGHT + 2.0) flightLandSpot = flightPickLanding(position(), 24.0);
        Vec3 goal = new Vec3(spot.x, spot.y + getBbHeight() / 2.0 + 0.2, spot.z);
        flightSteer(goal, Math.max(${stall}, ${cruise} * 0.6), false);
    }

    private void flightStuckCheck() {
        Vec3 here = position();
        double moved = here.distanceTo(flightLast);
        flightLast = here;
        if (flightSpeed > 0.05 && moved < flightSpeed * 0.25) flightStuck++;
        else flightStuck = Math.max(0, flightStuck - 2);
        if (flightStuck > FLIGHT_GIVE_UP_TICKS) {
            // It cannot get on: it comes down and stays down a while.
            flightStuck = 0;
            flightMoodAir = false;
            flightMoodUntil = tickCount + FLIGHT_MOOD_MAX;
            flightDescending = true;
            flightLandSpot = null;
        } else if (flightStuck > FLIGHT_STUCK_TICKS) {
            // It turns away and tries another way.
            flightStuck = FLIGHT_STUCK_TICKS / 2;
            flightWander = null;
            flightAvoidSide = random.nextBoolean() ? 1 : -1;
            flightAvoidUntil = tickCount + 20;
            flightSpeed *= 0.5;
        }
    }

    ${steadyCasting ? `private float flightBodyYaw(float from, float want) {
        if (abilityIndex >= 0) {
            abilityTurnToward(want);
            return abilityYaw;
        }
        return from + Mth.clamp(Mth.wrapDegrees(want - from), -${turnRate}, ${turnRate});
    }

    ` : ""}/** Moves the body: the facing and the climb turn toward what is wanted by no more than the limits, and the speed rises and falls by no more than its steps. */
    private void flightMove(double wantSpeed, float wantYaw, float wantClimb) {
        float yaw = getYRot();
        ${turnBody("wantYaw")}
        flightClimbNow += Mth.clamp(wantClimb - flightClimbNow, -${turnRate}, ${turnRate});
        flightClimbNow = Mth.clamp(flightClimbNow, -FLIGHT_CLIMB, FLIGHT_CLIMB);
        flightSpeed += Mth.clamp(wantSpeed - flightSpeed, -${brake}, flightPush);
        flightSpeed = Math.max(0.0, flightSpeed);
        double lift = Math.toRadians(flightClimbNow);
        double turn = Math.toRadians(yaw);
        double flat = Math.cos(lift) * flightSpeed;
        setDeltaMovement(-Math.sin(turn) * flat, Math.sin(lift) * flightSpeed, Math.cos(turn) * flat);
        setYRot(yaw);
        setYBodyRot(yaw);
        setYHeadRot(yaw);
    }

    private Vec3 flightWay(float yaw, float climb) {
        double turn = Math.toRadians(yaw);
        double lift = Math.toRadians(climb);
        double flat = Math.cos(lift);
        return new Vec3(-Math.sin(turn) * flat, Math.sin(lift), Math.cos(turn) * flat);
    }

    /** How far, up to \`length\`, the way is clear from a point along a direction. */
    private double flightClear(Vec3 from, Vec3 way, double length) {
        BlockHitResult hit = level().clip(new ClipContext(from, from.add(way.scale(length)), ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, this));
        return hit.getType() == HitResult.Type.MISS ? length : hit.getLocation().distanceTo(from);
    }

${
  span === null
    ? ""
    : `    /** The tip of its wing on one side (1: its left, -1: its right), level with the middle of its body, as large as it is. */
    private Vec3 flightTip(Vec3 centre, int side) {
        double turn = Math.toRadians(getYRot());
        double reach = FLIGHT_SPAN * getScale() * side;
        return centre.add(Math.cos(turn) * reach, 0.0, Math.sin(turn) * reach);
    }

    /** How far the way is clear along a direction, from its middle and from both wing tips: the least of the three. */
    private double flightClearWide(Vec3 centre, Vec3 way, double length) {
        return Math.min(flightClear(centre, way, length), Math.min(flightClear(flightTip(centre, 1), way, length), flightClear(flightTip(centre, -1), way, length)));
    }

`
}    /** How high the ground is under a place (the surface a creature would stand on), \`fallback\` where that part of the world is not loaded. */
    private double flightGround(double x, double z, double fallback) {
        int blockX = Mth.floor(x);
        int blockZ = Mth.floor(z);
        if (!level().hasChunk(blockX >> 4, blockZ >> 4)) return fallback;
        return level().getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, blockX, blockZ);
    }

    /** How far the ground is under its feet, and whether that ground is water (it does not set down on water). */
    private void flightScan() {
        Vec3 from = position().add(0.0, 0.1, 0.0);
        BlockHitResult hit = level().clip(new ClipContext(from, from.add(0.0, -64.0, 0.0), ClipContext.Block.COLLIDER, ClipContext.Fluid.ANY, this));
        if (hit.getType() == HitResult.Type.MISS) {
            flightAbove = 64.0;
            flightWater = false;
            return;
        }
        flightAbove = from.y - hit.getLocation().y;
        flightWater = !level().getFluidState(hit.getBlockPos()).isEmpty();
    }

    /** A place to set down near \`around\` where there is ground to stand on and it is not water; ${footprint ? "null when none is found with room for the whole of its box (it is asked again a second later)" : "the place itself when none is found"}. */
    private Vec3 flightPickLanding(Vec3 around, double spread) {
${footprint ? "        if (tickCount < flightLandRetry) return null;\n" : ""}        for (int tries = 0; tries < 8; tries++) {
            double x = around.x + (tries == 0 ? 0.0 : (random.nextDouble() * 2.0 - 1.0) * spread);
            double z = around.z + (tries == 0 ? 0.0 : (random.nextDouble() * 2.0 - 1.0) * spread);
            int blockX = Mth.floor(x);
            int blockZ = Mth.floor(z);
            if (!level().hasChunk(blockX >> 4, blockZ >> 4)) continue;
            int top = level().getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, blockX, blockZ);
            BlockPos below = new BlockPos(blockX, top - 1, blockZ);
            if (level().getFluidState(below).isEmpty() && !level().getBlockState(below).isAir()${footprint ? " && flightFits(x, top, z)" : ""}) return new Vec3(x, top, z);
        }
${
  footprint
    ? `        // Nowhere within reach has room for it: it keeps its height and looks again in a second, with new places each time.
        flightLandRetry = tickCount + 20;
        return null;
    }
${footprintMethod}`
    : `        return new Vec3(around.x, flightGround(around.x, around.z, around.y), around.z);
    }`
}

    /** A point to wander to: inside its home when it has one, else ahead of it, always inside its band over the ground there. */
    private Vec3 flightWanderPoint() {
${
  // A home from its document, else the roam a command gave it (null while it has none, then it wanders as it always did).
  `        Vec3 home = ${home ? home.point : "flightRoamCentre()"};
`
}        for (int tries = 0; tries < 6; tries++) {
            double x;
            double z;
${
  `            if (home != null) {
                double angle = random.nextDouble() * Math.PI * 2.0;
                double reach = Math.sqrt(random.nextDouble()) * ${home ? real(home.radius) : "flightRoam"} * 0.8;
                x = home.x + Math.cos(angle) * reach;
                z = home.z + Math.sin(angle) * reach;
            } else {
`
}                // A soaring creature cannot turn about on the spot: its points lie within 70 degrees of where it faces.
                double angle = Math.toRadians(FLIGHT_SOAR ? getYRot() + (random.nextDouble() - 0.5) * 140.0 : random.nextDouble() * 360.0);
                double reach = FLIGHT_WANDER_MIN + random.nextDouble() * (FLIGHT_WANDER_MAX - FLIGHT_WANDER_MIN);
                x = getX() - Math.sin(angle) * reach;
                z = getZ() + Math.cos(angle) * reach;
            }
            if (!level().hasChunk(Mth.floor(x) >> 4, Mth.floor(z) >> 4)) continue;
            double ground = flightGround(x, z, getY());
            double y = Math.min(ground + FLIGHT_ALT_MIN + random.nextDouble() * (FLIGHT_ALT_MAX - FLIGHT_ALT_MIN), level().getMaxBuildHeight() - 2.0);
            return new Vec3(x, y + getBbHeight() / 2.0, z);
        }
        return getBoundingBox().getCenter().add(flightWay(getYRot(), 0.0f).scale(FLIGHT_WANDER_MIN));
    }

    /**
     * Steers toward a point: the facing and the climb turn toward it, no faster than they may. Before that it looks three times ahead along its heading
     * for a block; one in the way, it turns toward the freer side and climbs (unless the roof is too near) and slows, and keeps to that side a little while.
     * \`safe\`: it also keeps clear of the ground (not when it means to come down, or to fly low).
${span === null ? "" : "     * Its wings reach further to each side than its box does (FLIGHT_SPAN), so every look, and the roof, is cast from both wing tips as well as from its middle, and the side it\n     * turns to is the one whose wing tip sees more room.\n"}     */
    private void flightSteer(Vec3 point, double wantSpeed, boolean safe) {
        Vec3 centre = getBoundingBox().getCenter();
        double dx = point.x - centre.x;
        double dy = point.y - centre.y;
        double dz = point.z - centre.z;
        double flat = Math.sqrt(dx * dx + dz * dz);
        float yaw = flat > 0.05 ? (float) (Mth.atan2(-dx, dz) * 180.0 / Math.PI) : getYRot();
        float climb = (float) Mth.clamp(Math.toDegrees(Math.atan2(dy, Math.max(flat, 0.5))), -FLIGHT_CLIMB, FLIGHT_CLIMB);
        double speed = wantSpeed;
        if (isInWater()) climb = FLIGHT_CLIMB;
        else if (flightWater && flightAbove < 3.0) climb = Math.max(climb, FLIGHT_CLIMB * 0.5f);
        else if (safe && flightAbove < FLIGHT_ALT_MIN * 0.5) climb = Math.max(climb, FLIGHT_CLIMB * 0.5f);
        double half = getBbWidth() / 2.0;
        // Coming down or flying low, only a wall counts: the ground it means to reach is not in the way.
        Vec3 way = flightWay(getYRot(), safe ? flightClimbNow : 0.0f);
        int blocked = -1;
        for (int look = 0; look < FLIGHT_PROBE_TICKS.length && blocked < 0; look++) {
            double reach = half + Math.max(FLIGHT_PROBE_LEAST[look], Math.max(flightSpeed, ${cruise} * 0.5) * FLIGHT_PROBE_TICKS[look]);
            if (${clearOf}(centre, way, reach) < reach - 0.05) blocked = look;
        }
        if (blocked >= 0 && tickCount >= flightAvoidUntil) {
            double side = half + FLIGHT_PROBE_LEAST[1];
            double left = flightClear(${span === null ? "centre" : "flightTip(centre, 1)"}, flightWay(getYRot() - 55.0f, 0.0f), side);
            double right = flightClear(${span === null ? "centre" : "flightTip(centre, -1)"}, flightWay(getYRot() + 55.0f, 0.0f), side);
            flightAvoidSide = left > right ? -1 : 1;
            flightAvoidUntil = tickCount + 12;
        }
        if (blocked >= 0 || tickCount < flightAvoidUntil) {
            yaw = getYRot() + flightAvoidSide * 60.0f;
            boolean roof = ${clearOf}(centre, new Vec3(0.0, 1.0, 0.0), half + 4.0) < half + 4.0 - 0.05;
            climb = roof ? Math.min(climb, 0.0f) : FLIGHT_CLIMB;
            if (blocked == 0) speed = Math.max(speed * 0.6, ${stall});
        }
        flightMove(speed, yaw, climb);
    }
${
  input.abilities
    ? `
    /**
     * A dive: getting ready it pulls up above the one it fights and lines up on them; when getting ready ends it locks the middle of the body they stood at then
     * and charges at it in a straight line, at the speed that is there on the tick of the first hit (\`flightDiveSpeed\`); after the last hit it pulls up to its band again.
     */
    private void flightDive() {
        LivingEntity target = abilityTarget;
        if (target == null) {
            flightMove(0.0, getYRot(), 0.0f);
            return;
        }
        Vec3 centre = getBoundingBox().getCenter();
        // The wind-up and the pull-up pick up speed faster than an easy flight does.
        flightPush = ${diveAccel};
        if (abilityTick < ABILITY_WINDUP[abilityIndex]) {
            flightDiveLocked = false;
            flightSteer(target.position().add(0.0, FLIGHT_DIVE_HEIGHT, 0.0), ${cruise}, true);
        } else {
            if (!flightDiveLocked) {
                flightDiveLocked = true;
                flightDiveGoal = target.position().add(0.0, target.getBbHeight() * 0.5, 0.0);${
                  reach
                    ? `
                flightDiveFace = flightDiveGoal;
                flightDiveFloor = target.getY();
                flightDiveGoal = flightDiveReached(flightDiveGoal, centre, target);`
                    : ""
                }
            }
            // It lets go of the point only once the last hit has been counted: nothing pulls it up or away before (not its band, not its climb, not having gone by).
            if (abilityTick >= FLIGHT_LAST[abilityIndex]) {
                // Pulled up: ahead, to the top of its band.
                Vec3 ahead = centre.add(flightWay(getYRot(), 0.0f).scale(FLIGHT_WANDER_MIN));
                flightSteer(new Vec3(ahead.x, flightGround(ahead.x, ahead.z, getY()) + FLIGHT_ALT_MAX, ahead.z), ${cruise}, true);
            } else {
                flightCharge(centre);
            }
        }
        // The hits of the ability are counted from the way it faces, which is the way it flies.
        abilityYaw = getYRot();
    }

    /**
     * The speed (blocks a tick) of the charge on this tick: the distance still to go over the ticks still to go, so that it is at the locked point on the tick of the
     * first hit; never under \`least\` (twice cruise) nor over \`most\`, never more than the distance left (it does not fly past the point) and never under \`floor\`
     * (what a soaring creature needs to stay up). Numbers only.
     */
    private static double flightDiveSpeed(double distance, int left, double least, double most, double floor) {
        double speed = Math.min(Math.max(distance / Math.max(1, left), least), most);
        return Math.max(Math.min(speed, distance), floor);
    }

    /**
     * The charge: straight at the point it locked, its velocity along that line and nothing else; its facing follows within its turn. The ticks still to go are the
     * velocities still to be set before the first hit is counted: the flight runs after the movement of its tick, so a velocity set while the ability's tick is
     * \`t\` is applied by the movement of the tick that counts \`t + 2\`, and the last one that counts is the one set at \`first - 2\` (applied by the movement of the tick that
     * counts the hit, just before it). With none left (the hit is being counted, or was) it counts as one, so that a later hit finds it at the point too.
     * Blocked, it stops against the block and the hit is counted on its tick all the same.
     */
    private void flightCharge(Vec3 centre) {
${reach ? "        if (FLIGHT_DIVE_REACH[abilityIndex] != null) flightDiveGoal = flightDiveHeld();\n" : ""}        Vec3 to = flightDiveGoal.subtract(centre);
        double distance = to.length();
        double flat = Math.sqrt(to.x * to.x + to.z * to.z);
        flightSpeed = flightDiveSpeed(distance, FLIGHT_FIRST[abilityIndex] - abilityTick - 1, ${diveLeast}, FLIGHT_DIVE_MOST, ${stall});
        flightClimbNow = (float) Mth.clamp(Math.toDegrees(Math.atan2(to.y, Math.max(flat, 0.5))), -FLIGHT_CLIMB, FLIGHT_CLIMB);
        setDeltaMovement(distance > 1.0e-6 ? to.scale(flightSpeed / distance) : Vec3.ZERO);
        float yaw = getYRot();
${
  reach
    ? `        // It faces the one it dives at, not the goal: with a bone ahead of its middle the goal lies short of them, and close by even behind its middle.
        Vec3 face = FLIGHT_DIVE_REACH[abilityIndex] == null ? to : flightDiveFace.subtract(centre);
        double across = Math.sqrt(face.x * face.x + face.z * face.z);
        if (across > 0.05) ${turnBody("(float) (Mth.atan2(-face.x, face.z) * 180.0 / Math.PI)")}`
    : `        if (flat > 0.05) ${turnBody("(float) (Mth.atan2(-to.x, to.z) * 180.0 / Math.PI)")}`
}
        setYRot(yaw);
        setYBodyRot(yaw);
        setYHeadRot(yaw);
    }
${
  reach
    ? `
    /**
     * broad11 w1: where the middle of its body goes for a dive whose first hit counts from a bone. The bone (as large as the creature is) and the middle of what the hit reaches,
     * laid along the line it comes in on, end at the middle of the one it fights, so the hit lands on them instead of a bone's length past them; its feet never go under theirs.
     * An ability whose first hit counts from the feet keeps the middle of the body as its goal.
     */
    private Vec3 flightDiveReached(Vec3 goal, Vec3 centre, LivingEntity target) {
        double[] reach = FLIGHT_DIVE_REACH[abilityIndex];
        if (reach == null) return goal;
        double scale = getScale();
        double dx = goal.x - centre.x;
        double dz = goal.z - centre.z;
        double flat = Math.sqrt(dx * dx + dz * dz);
        float turn = getYRot() * 0.017453292f;
        double wayX = flat > 1.0e-3 ? dx / flat : -Mth.sin(turn);
        double wayZ = flat > 1.0e-3 ? dz / flat : Mth.cos(turn);
        double ahead = reach[0] * scale + reach[3];
        double up = reach[1] * scale + reach[4];
        double left = reach[2] * scale + reach[5];
        double feet = Math.max(goal.y - up, target.getY());
        return new Vec3(goal.x - wayX * ahead - wayZ * left, feet + getBbHeight() / 2.0, goal.z - wayZ * ahead + wayX * left);
    }

    /**
     * epic game1: the goal above was laid out level at the lock, but the hit is counted with the body leaning into the dive (nose down, banked) and facing where it has turned to:
     * the claws of a dragon 7.5 blocks tall stopped 3 blocks from a player standing still. Every tick of the charge the goal is laid out again from the lean and the facing it has now,
     * which are the ones the hit is counted with (\`flightLeaned\`, \`abilityYaw\`), so the bone and the middle of what it reaches meet the point it locked; its feet still never go under theirs.
     */
    private Vec3 flightDiveHeld() {
        double[] reach = FLIGHT_DIVE_REACH[abilityIndex];
        double scale = getScale();
        double[] bone = flightLeaned(reach[0] * scale, reach[1] * scale, reach[2] * scale);
        double ahead = bone[0] + reach[3];
        double up = bone[1] + reach[4];
        double left = bone[2] + reach[5];
        float turn = getYRot() * 0.017453292f;
        double feet = Math.max(flightDiveFace.y - up, flightDiveFloor);
        return new Vec3(flightDiveFace.x + Mth.sin(turn) * ahead - Mth.cos(turn) * left, feet + getBbHeight() / 2.0, flightDiveFace.z - Mth.cos(turn) * ahead - Mth.sin(turn) * left);
    }
`
    : ""
}`
    : ""
}
    // ---- in the player's game: the lean and the motion ----

    /** Each tick in the player's game: how fast it is seen to move, and from that how far it leans (nose up with the climb, into the turn with the turning). */
    private void flightLook() {
        Vec3 here = position();
        float yaw = getVisualRotationYInDegrees();
        if (flightSeen == null) {
            flightSeen = here;
            flightLastYaw = yaw;
        }
        double run = Math.sqrt((here.x - flightSeen.x) * (here.x - flightSeen.x) + (here.z - flightSeen.z) * (here.z - flightSeen.z));
        flightRun += (run - flightRun) * 0.3;
        flightRise += (here.y - flightSeen.y - flightRise) * 0.3;
        float turned = Mth.wrapDegrees(yaw - flightLastYaw);
        flightSeen = here;
        flightLastYaw = yaw;
        flightPitchPrev = flightPitch;
        flightRollPrev = flightRoll;
        float pitch = 0.0f;
        float roll = 0.0f;
        if (flightState() != FLIGHT_GROUND) {
            // The pitch follows the way it climbs or sinks, less the slower it goes; the lean follows how fast it turns, to its largest at the fastest turn (yaw grows turning right, and the right side dips).
            double speed = Math.sqrt(flightRun * flightRun + flightRise * flightRise);
            double moving = Mth.clamp(speed / Math.max(FLIGHT_CRUISE * 0.3, 0.01), 0.0, 1.0);
            pitch = (float) (Mth.clamp(Math.toDegrees(Math.atan2(flightRise, Math.max(flightRun, 0.02))), -FLIGHT_CLIMB, FLIGHT_CLIMB) * moving);
            roll = Mth.clamp(-turned * FLIGHT_BANK_GAIN, -FLIGHT_BANK, FLIGHT_BANK);
        }
        flightPitch += (pitch - flightPitch) * FLIGHT_PITCH_EASE;
        flightRoll += (roll - flightRoll) * FLIGHT_ROLL_EASE;
    }

${
  input.lean
    ? `    /**
     * Where a place on the body (blocks from its feet: ahead, up, to its own left; already as large as the creature is) is carried by the lean of its flight: the renderer's own turn
     * about the middle of its box (\`applyRotations\`): the lean first, then the nose up, by the pitch and lean it is drawn at now. On the ground both are zero and nothing moves.
     * The model's own axes are the renderer's: ahead is -z, its left is -x, and a positive turn about x lifts what is ahead and one about z lifts what is on its right.
     */
    private double[] flightLeaned(double forward, double up, double left) {
        if (flightPitch == 0.0f && flightRoll == 0.0f) return new double[] {forward, up, left};
        double middle = getBbHeight() / 2.0;
        double x = -left;
        double y = up - middle;
        double z = -forward;
        double roll = Math.toRadians(flightRoll);
        double pitch = Math.toRadians(flightPitch);
        double rolledX = x * Math.cos(roll) - y * Math.sin(roll);
        double rolledY = x * Math.sin(roll) + y * Math.cos(roll);
        double liftedY = rolledY * Math.cos(pitch) - z * Math.sin(pitch);
        double liftedZ = rolledY * Math.sin(pitch) + z * Math.cos(pitch);
        return new double[] {-liftedZ, liftedY + middle, -rolledX};
    }

`
    : ""
}    /** Degrees of nose up (negative: down) and of lean, between two ticks, for the renderer. */
    public float flightPitch(float tickDelta) { return Mth.lerp(tickDelta, flightPitchPrev, flightPitch); }

    public float flightRoll(float tickDelta) { return Mth.lerp(tickDelta, flightRollPrev, flightRoll); }

    /** The motion it plays now because of where it is: taking off, landing, or in the air flapping, gliding or hovering; none on the ground. */
    private RawAnimation flightClip() {
        int state = flightState();
        if (state == FLIGHT_GROUND) {
            flightGliding = false;
            return null;
        }
        if (state == FLIGHT_TAKEOFF) return FLIGHT_TAKEOFF_CLIP != null ? FLIGHT_TAKEOFF_CLIP : FLIGHT_FLY_CLIP;
        if (state == FLIGHT_LANDING) return FLIGHT_LAND_CLIP != null ? FLIGHT_LAND_CLIP : FLIGHT_FLY_CLIP;
        if (FLIGHT_SOAR) {
            if (FLIGHT_GLIDE_CLIP == null) return FLIGHT_FLY_CLIP;
            // Glides while level or sinking at speed, flaps while climbing or slow; the two thresholds differ so it does not flicker between them.
            if (flightGliding && (flightRise > 0.06 || flightRun < FLIGHT_CRUISE * 0.5)) flightGliding = false;
            else if (!flightGliding && flightRise < 0.02 && flightRun >= FLIGHT_CRUISE * 0.7) flightGliding = true;
            return flightGliding ? FLIGHT_GLIDE_CLIP : FLIGHT_FLY_CLIP;
        }
        return FLIGHT_HOVER_CLIP != null && flightRun < FLIGHT_CRUISE * 0.35 ? FLIGHT_HOVER_CLIP : FLIGHT_FLY_CLIP;
    }

`,
    tick: "tickFlight();",
    tracker: FLIGHT_TRACKER,
    /** In the movement controller: the motion of the air takes over from walking and idling. No braces: the contract reads this handler. */
    movement: `RawAnimation flying = flightClip();
            if (flying != null) return state.setAndContinue(flying);
            `,
    nbtWrite: `
        nbt.putInt("FlightState", flightState());
        nbt.putBoolean("FlightMoodAir", flightMoodAir);
        nbt.putInt("FlightMoodLeft", Math.max(0, flightMoodUntil - tickCount));${
      home
        ? ""
        : `
        if (flightRoam > 0.0) {
            nbt.putDouble("FlightRoam", flightRoam);
            nbt.putBoolean("FlightRoamSet", flightRoamSet);
            nbt.putDouble("FlightRoamX", flightRoamX);
            nbt.putDouble("FlightRoamZ", flightRoamZ);
        }`
    }`,
    // A takeoff or a landing is not resumed: the first goes on in the air, the second on the ground.
    nbtRead: `
        if (nbt.contains("FlightState")) {
            int saved = Mth.clamp(nbt.getInt("FlightState"), FLIGHT_GROUND, FLIGHT_LANDING);
            flightSet(saved == FLIGHT_TAKEOFF ? FLIGHT_AIR : saved == FLIGHT_LANDING ? FLIGHT_GROUND : saved);
            flightMoodAir = nbt.getBoolean("FlightMoodAir");
            flightMoodUntil = tickCount + Math.max(0, nbt.getInt("FlightMoodLeft"));
        }${
      home
        ? ""
        : `
        // A roam given by the command that placed it (or saved with it): 0 is none, anything else is kept between the least and the most a roam may be.
        if (nbt.contains("FlightRoam")) {
            double roam = nbt.getDouble("FlightRoam");
            flightRoam = roam <= 0.0 ? 0.0 : Mth.clamp(roam, FLIGHT_ROAM_LEAST, FLIGHT_ROAM_MOST);
            if (nbt.contains("FlightRoamSet")) {
                flightRoamSet = nbt.getBoolean("FlightRoamSet");
                flightRoamX = nbt.getDouble("FlightRoamX");
                flightRoamZ = nbt.getDouble("FlightRoamZ");
            }
        }`
    }`,
    rendererImports: `import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
`,
    /** The renderer leans the whole model about its middle by the smoothed pitch and lean (GeckoLib's rotation hook), after the facing is applied. */
    renderer: (entity: string) => `
    // The whole model leans about its middle: nose up with the climb, into the turn with the turning (the pitch and lean are the creature's, smoothed).
    @Override protected void applyRotations(${entity} creature, PoseStack poseStack, float ageInTicks, float rotationYaw, float partialTick, float nativeScale) {
        super.applyRotations(creature, poseStack, ageInTicks, rotationYaw, partialTick, nativeScale);
        float pitch = creature.flightPitch(partialTick);
        float roll = creature.flightRoll(partialTick);
        if (pitch == 0.0f && roll == 0.0f) return;
        // Its height is in blocks and the picture has been scaled already (a baby's half), so the middle is told in the picture's own measure.
        float middle = creature.getBbHeight() * 0.5f / nativeScale;
        poseStack.translate(0.0f, middle, 0.0f);
        poseStack.mulPose(Axis.XP.rotationDegrees(pitch));
        poseStack.mulPose(Axis.ZP.rotationDegrees(roll));
        poseStack.translate(0.0f, -middle, 0.0f);
    }
`,
  }
}
