import type { HabitsPlan } from "../creature-flight"
import type { Habits } from "../entity-runtime"
import { HABIT_LIMITS } from "../flight-words"

/**
 * A creature's habits as the Java its class carries (habits, 10-12): when in the day it is up, where its home is, what it hunts when it is hungry, what it does
 * when a player first comes near. Each is a goal of the creature's own on the server; players' games are told one synced number (what it is showing: resting,
 * eating, being alert) and play that motion. The numbers are the document's, turned into ticks once (`habitsPlan`). Nothing here changes a block of the world.
 * What it does about the day is the game's own clock (`getDayTime`), never the weather. A flier goes where it is going by flying (`flightGo`, written by the flight).
 * Every Minecraft name used here is Mojang's (1.21.1, as Loom's officialMojangMappings names them); GeckoLib's were read with javap from GeckoLib 4.8.3.
 * Without habits every piece is the empty string, so such a creature's class is what it always was.
 */

const real = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(4))))
const clip = (model: string, name: string | null | undefined, how: "thenPlay" | "thenLoop") => (name ? `RawAnimation.begin().${how}("animation.${model}.${name}")` : "null")

/** The statement that registers the synced value, in the creature's `initDataTracker`. */
export const HABITS_TRACKER = "        builder.define(HABIT, (byte) 0);\n"

const none = { imports: "", fields: "", methods: "", goals: "", before: "", after: "", tick: "", controller: "", shown: "", nbtWrite: "", nbtRead: "", tracker: "", home: null as { point: string; radius: number } | null, resting: null as string | null, eating: null as string | null }

export function compileHabits(input: {
  entity: string
  model: string
  habits: Habits | null | undefined
  plan: HabitsPlan | null
  /** The creature flies: it goes far and hunts by flying, and eats and rests on the ground. */
  flier: boolean
  /** The expression that is true while one of its abilities runs (nothing alerts it then), or "false". */
  busy: string
}) {
  const habits = input.habits
  const plan = input.plan
  if (!habits || !plan) return none
  const home = habits.home
  const prey = habits.prey
  const eat = Boolean(habits.eat)
  const alert = habits.alert
  const mode = habits.active === "day" ? 0 : habits.active === "night" ? 1 : 2
  const air = input.flier ? "flightState() != FLIGHT_GROUND" : "false"
  const resting = habits.active === "always" ? null : "habitResting()"
  return {
    imports: `import java.util.Comparator;
import java.util.EnumSet;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec3;
`,
    fields: `    // ---- habits: when it is up, its home, what it hunts, who it is wary of; data from the creature's document, run on the server ----
    // What it is showing, for every player's game: 0 nothing, 1 resting, 2 eating, 3 alert.
    private static final EntityDataAccessor<Byte> HABIT = SynchedEntityData.defineId(${input.entity}.class, EntityDataSerializers.BYTE);
    private static final int HABIT_REST = 1;
    private static final int HABIT_EAT = 2;
    private static final int HABIT_ALERT = 3;
    // Up by day (0), by night (1) or always (2). The game's day is ${HABIT_LIMITS.dayLength} ticks and the sun sets at ${HABIT_LIMITS.dayEnd}.
    private static final int HABIT_MODE = ${mode};
    private static final long HABIT_DAY_LENGTH = ${HABIT_LIMITS.dayLength}L;
    private static final long HABIT_DAY_END = ${HABIT_LIMITS.dayEnd}L;
    // Ticks between two looks at the world (for prey, for a player); the least blocks that count as at a place (a larger creature needs its width and a half); and how far on foot it goes before it flies.
    private static final int HABIT_WATCH = ${HABIT_LIMITS.watch};
    private static final double HABIT_NEAR = ${real(HABIT_LIMITS.near)};
    private static final double HABIT_FLY = ${real(HABIT_LIMITS.fly)};
    // It stops trying to get somewhere after this many ticks and does what it was doing there where it stands.
    private static final int HABIT_GIVE_UP = ${plan.giveUpTicks};
${
  home
    ? `    // It stays within this many blocks of where it began; coming back it goes as far as half of it.
    private static final double HABIT_HOME_RADIUS = ${real(home.radius)};
    private boolean habitHomeSet;
    private double habitHomeX;
    private double habitHomeY;
    private double habitHomeZ;
    private int habitReturnAt;
`
    : ""
}${
      prey.length
        ? `    // What it hunts (the game's own creatures), how long after it ate it is hungry, how far it looks for prey.
    private static final EntityType<?>[] HABIT_PREY = {${prey.map((id) => `EntityType.${id.toUpperCase()}`).join(", ")}};
    private static final int HABIT_HUNGER = ${plan.hungerTicks};
    private static final double HABIT_HUNT_RANGE = ${real(HABIT_LIMITS.hunt)};
    private int habitHunger;
    private int habitLookAt;
`
        : ""
    }${
      eat
        ? `    // How long it stands to eat after a kill, in ticks.
    private static final int HABIT_EAT_TICKS = ${plan.eatTicks};
    private int habitEatLeft;
`
        : ""
    }${
      alert
        ? `    // A player coming within this many blocks (when none was before) makes it alert for HABIT_ALERT_TICKS; then it is not alert again for HABIT_ALERT_COOLDOWN.
    private static final double HABIT_ALERT_DISTANCE = ${real(alert.distance)};
    private static final int HABIT_ALERT_TICKS = ${plan.alertTicks};
    private static final int HABIT_ALERT_COOLDOWN = ${plan.cooldownTicks};
    private boolean habitPlayerNear;
    private int habitAlertDueUntil = -1;
    private int habitAlertReady;
    private Player habitAlertPlayer;
`
        : ""
    }    private static final RawAnimation HABIT_REST_CLIP = ${clip(input.model, habits.rest?.clip, "thenLoop")};
    private static final RawAnimation HABIT_EAT_CLIP = ${clip(input.model, habits.eat?.clip, "thenPlay")};
    private static final RawAnimation HABIT_ALERT_CLIP = ${clip(input.model, habits.alert?.clip, "thenPlay")};
    private int habitShown = -1;
`,
    methods: `    private int habitShowing() { return getEntityData().get(HABIT); }

    private void habitSet(int show) {
        if (habitShowing() != show) getEntityData().set(HABIT, (byte) show);
    }

    /** The motion it plays now because of what it is showing, none when it has none for that. */
    private RawAnimation habitClip() {
        return switch (habitShowing()) {
            case HABIT_REST -> HABIT_REST_CLIP;
            case HABIT_EAT -> HABIT_EAT_CLIP;
            case HABIT_ALERT -> HABIT_ALERT_CLIP;
            default -> null;
        };
    }

    /** Whether it is the part of the day it is up in. A world without a day (the Nether, the End) has no night: it is always up there. */
    private boolean habitActiveNow() {
        if (HABIT_MODE == 2 || level().dimensionType().hasFixedTime()) return true;
        boolean day = level().getDayTime() % HABIT_DAY_LENGTH < HABIT_DAY_END;
        return (HABIT_MODE == 0) == day;
    }

    private boolean habitResting() { return !habitActiveNow(); }

    private boolean habitNear(Vec3 point) {
        double reach = Math.max(HABIT_NEAR, getBbWidth() * 1.5);
        double dx = getX() - point.x;
        double dz = getZ() - point.z;
        return dx * dx + dz * dz <= reach * reach;
    }

    /**
     * Goes toward a place: on foot by the game's own paths, or by flying when it can fly and the place is far, it is in the air already or it is told to
     * (\`fly\`). \`land\`: a flier sets down there; \`low\`: it flies close to the ground (hunting). True once it is there.
     */
    private boolean habitGo(Vec3 point, boolean land, boolean low, boolean fly) {
${
  input.flier
    ? `        if (fly || flightState() != FLIGHT_GROUND || distanceToSqr(point) > HABIT_FLY * HABIT_FLY) return flightGo(point, land, low);
`
    : ""
}        if (tickCount % 10 == 0 || getNavigation().isDone()) getNavigation().moveTo(point.x, point.y, point.z, 1.0);
        return habitNear(point);
    }

${
  home
    ? `    /** Where it began, or null before it is known. */
    private Vec3 habitHome() { return habitHomeSet ? new Vec3(habitHomeX, habitHomeY, habitHomeZ) : null; }

    private boolean habitInside(Vec3 point) {
        if (!habitHomeSet) return true;
        double dx = point.x - habitHomeX;
        double dz = point.z - habitHomeZ;
        return dx * dx + dz * dz <= HABIT_HOME_RADIUS * HABIT_HOME_RADIUS;
    }

`
    : ""
}${
      prey.length
        ? `    private boolean habitIsPrey(EntityType<?> type) {
        for (EntityType<?> kind : HABIT_PREY) if (kind == type) return true;
        return false;
    }

    /** The nearest of what it hunts that it can look for: alive, not named by anybody (a named animal is somebody's), and ${home ? "inside its home" : "near"}. */
    private LivingEntity habitFindPrey() {
        return level().getEntitiesOfClass(LivingEntity.class, getBoundingBox().inflate(HABIT_HUNT_RANGE),
                other -> other.isAlive() && !other.hasCustomName() && habitIsPrey(other.getType())${home ? " && habitInside(other.position())" : ""}).stream()
            .min(Comparator.comparingDouble(other -> distanceToSqr(other))).orElse(null);
    }

`
        : ""
    }    private void tickHabits() {
        if (level().isClientSide() || isDeadOrDying()) return;
${
  home
    ? `        // Its home is where it was first in the world (a saved creature keeps the one it was saved with).
        if (!habitHomeSet) {
            habitHomeSet = true;
            habitHomeX = getX();
            habitHomeY = getY();
            habitHomeZ = getZ();
        }
`
    : ""
}${prey.length ? "        if (habitHunger < HABIT_HUNGER) habitHunger++;\n" : ""}${
      alert
        ? `        if (tickCount % HABIT_WATCH == 0) {
            Player near = level().getNearestPlayer(getX(), getY(), getZ(), HABIT_ALERT_DISTANCE, other -> other.isAlive() && !other.isSpectator() && !(other instanceof Player player && player.isCreative()));
            // Alert is for the first player who comes near, not for one who stays: it is due on the look that finds somebody where nobody was.
            if (near != null && !habitPlayerNear && tickCount >= habitAlertReady) {
                habitAlertPlayer = near;
                habitAlertDueUntil = tickCount + 4;
            }
            habitPlayerNear = near != null;
        }
`
        : ""
    }    }

`,
    /** The goals, as classes: the ones that may take the creature's body from fighting come first by priority (see \`before\`). */
    goals: `${
      alert
        ? `    /** A player comes near: it stops, looks at them and shows its alert motion once; priority 0, so it comes before anything else it does (a boss's wake-up is first: it does not move then at all). */
    private final class HabitAlertGoal extends Goal {
        private int left;

        private HabitAlertGoal() {
            setFlags(EnumSet.of(Flag.MOVE, Flag.LOOK));
        }

        @Override public boolean canUse() { return tickCount <= habitAlertDueUntil && habitAlertPlayer != null && habitAlertPlayer.isAlive() && !${input.busy}; }

        @Override public boolean canContinueToUse() { return left > 0 && habitAlertPlayer != null && habitAlertPlayer.isAlive(); }

        @Override public boolean requiresUpdateEveryTick() { return true; }

        @Override public void start() {
            left = HABIT_ALERT_TICKS;
            habitAlertDueUntil = -1;
            habitAlertReady = tickCount + HABIT_ALERT_COOLDOWN;
            getNavigation().stop();
            habitSet(HABIT_ALERT);
        }

        @Override public void stop() {
            if (habitShowing() == HABIT_ALERT) habitSet(0);
        }

        @Override public void tick() {
            left--;
            getNavigation().stop();
            getLookControl().setLookAt(habitAlertPlayer, 30.0f, 30.0f);
        }
    }

`
        : ""
    }${
      eat
        ? `    /** After a kill it stands still and eats, showing its eating motion. A flier comes down first. Before the goals that fight, so a fight does not take it away mid-meal. */
    private final class HabitEatGoal extends Goal {
        private HabitEatGoal() {
            setFlags(EnumSet.of(Flag.MOVE, Flag.LOOK));
        }

        @Override public boolean canUse() { return habitEatLeft > 0 && !${input.busy}; }

        @Override public boolean canContinueToUse() { return habitEatLeft > 0; }

        @Override public boolean requiresUpdateEveryTick() { return true; }

        @Override public void stop() {
            getNavigation().stop();
            if (habitShowing() == HABIT_EAT) habitSet(0);
        }

        @Override public void tick() {
            if (${air}) {
                // Eating is done on the ground.
                habitSet(0);
${input.flier ? "                flightGo(position(), true, false);\n" : ""}                return;
            }
            getNavigation().stop();
            habitSet(HABIT_EAT);
            habitEatLeft--;
        }
    }

`
        : ""
    }${
      prey.length
        ? `    /** When it is hungry and up, it goes for the nearest of what it hunts and bites it; the prey dying is the end of the hunt and of the hunger. */
    private final class HabitHuntGoal extends Goal {
        private LivingEntity prey;
        private int chase;
        private int biteAt;

        private HabitHuntGoal() {
            setFlags(EnumSet.of(Flag.MOVE, Flag.LOOK));
        }

        @Override public boolean canUse() {
            if (habitHunger < HABIT_HUNGER || tickCount < habitLookAt || getTarget() != null || !habitActiveNow()) return false;
            habitLookAt = tickCount + HABIT_WATCH;
            prey = habitFindPrey();
            return prey != null;
        }

        @Override public boolean canContinueToUse() {
            return prey != null && prey.isAlive() && !prey.isRemoved() && chase < HABIT_GIVE_UP && getTarget() == null && habitActiveNow();
        }

        @Override public boolean requiresUpdateEveryTick() { return true; }

        @Override public void start() { chase = 0; }

        @Override public void stop() {
            getNavigation().stop();
            if (prey != null && !prey.isAlive()) {
                // Killed (by it or by anybody): fed.
                habitHunger = 0;
${eat ? "                habitEatLeft = HABIT_EAT_TICKS;\n" : ""}            } else if (chase >= HABIT_GIVE_UP) {
                // It could not catch it: hungry again after as long as it would have taken to get hungry.
                habitHunger = 0;
            }
            prey = null;
        }

        @Override public void tick() {
            chase++;
            getLookControl().setLookAt(prey, 30.0f, 30.0f);
            if (isWithinMeleeAttackRange(prey)) {
                if (tickCount >= biteAt) {
                    biteAt = tickCount + 20;
                    doHurtTarget(prey);
                }
                return;
            }
            habitGo(new Vec3(prey.getX(), prey.getY(0.5), prey.getZ()), false, true, ${input.flier});
        }
    }

`
        : ""
    }${
      habits.active !== "always"
        ? `    /** Out of its hours it goes home (when it has one), stops there and rests, showing its resting motion. Fighting comes before this, so a fight is fought. */
    private final class HabitRestGoal extends Goal {
        private int travel;

        private HabitRestGoal() {
            setFlags(EnumSet.of(Flag.MOVE, Flag.LOOK));
        }

        @Override public boolean canUse() { return habitResting() && getTarget() == null; }

        @Override public boolean canContinueToUse() { return canUse(); }

        @Override public boolean requiresUpdateEveryTick() { return true; }

        @Override public void start() { travel = 0; }

        @Override public void stop() {
            getNavigation().stop();
            if (habitShowing() == HABIT_REST) habitSet(0);
        }

        @Override public void tick() {
${
  home
    ? `            Vec3 home = habitHome();
            if (home != null && !habitNear(home) && travel < HABIT_GIVE_UP) {
                travel++;
                habitSet(0);
                habitGo(home, true, false, false);
                return;
            }
`
    : ""
}            // Home, or no home, or no way to get there: it rests where it is. A flier in the air first comes down (its flight does that when nothing asks it up).
            getNavigation().stop();
            habitSet(${air} ? 0 : HABIT_REST);
        }
    }

`
        : ""
    }${
      home
        ? `    /** Further from home than its radius it goes back, as far as half the radius (so it does not turn about at the edge), unless it has something else to do. */
    private final class HabitReturnGoal extends Goal {
        private int travel;

        private HabitReturnGoal() {
            setFlags(EnumSet.of(Flag.MOVE, Flag.LOOK));
        }

        private boolean away(double radius) {
            if (!habitHomeSet) return false;
            double dx = getX() - habitHomeX;
            double dz = getZ() - habitHomeZ;
            return dx * dx + dz * dz > radius * radius;
        }

        @Override public boolean canUse() { return tickCount >= habitReturnAt && getTarget() == null && away(HABIT_HOME_RADIUS); }

        @Override public boolean canContinueToUse() { return getTarget() == null && travel < HABIT_GIVE_UP && away(HABIT_HOME_RADIUS * 0.5); }

        @Override public boolean requiresUpdateEveryTick() { return true; }

        @Override public void start() { travel = 0; }

        @Override public void stop() {
            getNavigation().stop();
            // A way home it could not find in time is tried again after as long.
            if (travel >= HABIT_GIVE_UP) habitReturnAt = tickCount + HABIT_GIVE_UP;
        }

        @Override public void tick() {
            travel++;
            habitGo(habitHome(), false, false, false);
        }
    }

`
        : ""
    }`,
    /**
     * The goals the creature starts with, in the order they are added: before its fighting goals (an alert, a meal), then after them (hunting, resting,
     * going home). Priorities: alert 0 (beside swimming, which holds only JUMP), eating 1 (added before the fight, so the fight does not take it away),
     * hunting 2, resting 3, going home 4: below the fight, above roaming (5).
     */
    before: `${alert ? "\n        goalSelector.addGoal(0, new HabitAlertGoal());" : ""}${eat ? "\n        goalSelector.addGoal(1, new HabitEatGoal());" : ""}`,
    after: `${prey.length ? "\n        goalSelector.addGoal(2, new HabitHuntGoal());" : ""}${habits.active !== "always" ? "\n        goalSelector.addGoal(3, new HabitRestGoal());" : ""}${home ? "\n        goalSelector.addGoal(4, new HabitReturnGoal());" : ""}`,
    tick: "tickHabits();",
    controller: `        // Plays what the server says it is showing: resting, eating, being alert. Every player near sees it, also one who walks up in the middle of it.
        controllers.add(new AnimationController<>(this, "habit", 0, state -> {
            RawAnimation clip = isDeadOrDying() ? null : habitClip();
            if (clip == null) {
                habitShown = -1;
                return PlayState.STOP;
            }
            int shown = habitShowing();
            if (shown != habitShown) {
                habitShown = shown;
                state.getController().forceAnimationReset();
            }
            return state.setAndContinue(clip);
        }));
`,
    shown: "habitClip() != null",
    tracker: HABITS_TRACKER,
    nbtWrite: `${
      home
        ? `
        nbt.putBoolean("HabitHomeSet", habitHomeSet);
        nbt.putDouble("HabitHomeX", habitHomeX);
        nbt.putDouble("HabitHomeY", habitHomeY);
        nbt.putDouble("HabitHomeZ", habitHomeZ);`
        : ""
    }${prey.length ? `\n        nbt.putInt("HabitHunger", habitHunger);` : ""}${alert ? `\n        nbt.putInt("HabitAlertLeft", Math.max(0, habitAlertReady - tickCount));` : ""}`,
    nbtRead: `${
      home
        ? `
        if (nbt.contains("HabitHomeSet")) {
            habitHomeSet = nbt.getBoolean("HabitHomeSet");
            habitHomeX = nbt.getDouble("HabitHomeX");
            habitHomeY = nbt.getDouble("HabitHomeY");
            habitHomeZ = nbt.getDouble("HabitHomeZ");
        }`
        : ""
    }${prey.length ? `\n        habitHunger = Mth.clamp(nbt.getInt("HabitHunger"), 0, HABIT_HUNGER);` : ""}${alert ? `\n        habitAlertReady = tickCount + Math.max(0, nbt.getInt("HabitAlertLeft"));` : ""}`,
    /** What the flight needs of the habits: the home as a point and the radius that keeps it near; the test that it is out of its hours. */
    home: home ? { point: "habitHome()", radius: home.radius } : null,
    resting,
    /** The same for a meal: true while it stands to eat after a kill (null: it has none). A flier does not take off for no reason while it is true, as it does not while it rests. */
    eating: eat ? "habitEatLeft > 0" : null,
  }
}
