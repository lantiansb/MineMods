import { builtinParticle, builtinSound, type SharedBuiltin } from "../common/builtin"
import { fixtureLightSource } from "./fixture-light"
import { fixtureRuntime } from "./fixture-runtime"
import { z } from "zod"
import { TICKS } from "../ability-words"
import { ARENA_LIMITS, abilitiesUseArena, abilityLeave, arenaHits, arenaPlan, fogEvents, LEAVE_PLACES, type ArenaSafe, type LeaveMove } from "../arena"
import type { AbilityPlan } from "../creature-abilities"
import { abilityTick } from "../creature-abilities"
import type { Ability, Boss } from "../entity-runtime"
import { FixtureDocumentSchema, fixtureBox, fixtureModel, fixtureName } from "../fixture"
import { glowMaskPath } from "../glow-mask"
import { fitModelAtlas } from "../model"
import { encodePng } from "../png"
import type { GenTarget } from "../platform/adapter"
import { ABILITY_WARN } from "./ability-warn"
import { CLIENT_PLATFORM_CLASS, PLATFORM_CLASS, PLATFORM_PACKAGE } from "../platform/facade"
import { FABRIC_TARGET } from "../platform/target"

/**
 * Boss 能力 12 (场地物件 + 雾) and 13 (涿鹿) as what they add to a generated mod. Only written when some hostile boss of the project has an arena or an ability that needs one
 * (`abilitiesUseArena`), so any other project is untouched, byte for byte. The same text on every loader but for how its one packet is sent and its classes are started:
 *
 * - `StudioArena` (common): every boss with an arena hands it, each tick, whether its fight is on. When the fight is on and a player is near, the arena's fixtures are put down
 *   on the ground round its home (the arena's frame: home, and the way the boss faced then, turned to the nearest of the four directions); when it ends (death, a leash reset,
 *   the boss gone from the world) they are taken away. Lighting a fixture is a player holding the use key on it (the game repeats the click every four ticks while the key is
 *   held). Every few ticks each player within the fight's range is decided to be in the fog or not (the fog is up and they stand in no lit fixture's clear ground), and only
 *   that player is told, only when it changes. The fight's damage is scaled by it (`hurt`, from a mixin into `LivingEntity.hurt`). A boss leaving the field (`leave`, `back`) is
 *   kept in the air, unseen, unhurt and no one's target until it comes back or its fight ends. A hit over the whole arena is counted from the arena's middle, sparing whoever
 *   stands in its safe places (`inside`).
 * - `StudioFixture` / `StudioFixtures`: the fixture entity (never saved; a fixture asset's model, its two motions, its glowing parts) and its table.
 * - `StudioArenaClient` (client): the fog this player's game was told, eased over the fog's seconds; the render type that lifts the fog for glowing parts (`fogFree`), and the
 *   glow layer that uses it (`Glow`); the fixtures' renderer.
 * - Two mixins, the same on every loader (their targets read with javap from the 1.21.1 and 1.20.1 jars, the same there): `StudioArenaFogMixin` pulls the fog in
 *   (`FogRenderer.setupFog`, at its end) and greys its colour (`FogRenderer.setupColor`); `StudioArenaHurtMixin` scales a hurt (`LivingEntity.hurt`, its amount at its start).
 */

const FixtureInput = z.strictObject({ id: z.uuid(), title: z.string(), document: FixtureDocumentSchema })
const Input = z.strictObject({
  returnOffset: z.boolean().default(false),
  terrainInteractions:z.boolean().default(false),
  fogCondition:z.boolean().optional(),
  sharedBuiltin: z.object({particle:z.array(z.string()),sound:z.array(z.string())}).optional(),
  modId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  /** Every fixture asset a boss's arena puts down. */
  fixtures: z.array(FixtureInput),
  /** Some hit over the arena with safe places is warned of (`StudioWarn` is then in the mod): its safe places are shown as rings while its warning shows. */
  fixtureLighting: z.boolean().default(false),
  fixtureControls: z.boolean().default(false),
  /** Some fixture group writes no `use`: it answers no use key and no hit (only abilities and shows light it), held as -2 in the use table. */
  fixtureUntouched: z.boolean().default(false),
  warned: z.boolean().default(false),
  extendedFog: z.boolean().default(false),
  /** Some warned hit with safe places paints its warning as a mesh: its safe rings are painted the same way, not as dust. */
  safeMesh: z.boolean().default(false),
})

/** The classes, mixins, registry name and packet id of the arena. */
export const ARENA_RUNTIME = {
  server: "StudioArena",
  fixture: "StudioFixture",
  table: "StudioFixtures",
  client: "StudioArenaClient",
  renderer: "StudioFixtureRenderer",
  fog: "StudioArenaFogMixin",
  hurt: "StudioArenaHurtMixin",
  registry: "studio_fixture",
  packet: "studio_fog",
  backPacket: "studio_arena_back",
} as const
const R = ARENA_RUNTIME

const real = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(4))))
const single = (value: number) => `${real(value)}f`
const list = (values: readonly (string | number | boolean)[]) => `{${values.join(", ")}}`
/** Seconds as ticks, 0 kept as 0 (a click lights at once, no wait between). */
const ticksOf = (seconds: number) => Math.max(0, Math.round(seconds * TICKS))
/** How far into the fog a player still sees clearly, as a share of how far they see at all: the fog thickens from there to `visibility`. */
const NEAR = 0.2
/** How grey the fog turns at its thickest (0 keeps the sky's colour, 1 a plain grey of the same brightness). */
const GREY = 0.85

// ---- what the boss's own class carries (entity-boss.ts) ----

/** The arena's table for one boss, as the Java `StudioArena.Spec` its class holds: every number of its document (the fog left out: none), its fixtures in the plan's order. */
export function arenaSpecJava(boss: Pick<Boss, "arena">) {
  const arena = boss.arena ?? { fixtures: [], fog: null }
  const plan = arenaPlan(arena)
  const fog = arena.fog
  const fixtures = plan.fixtures
  const spec = `new ${R.server}.Spec(new String[] ${list(fixtures.map((fixture) => JSON.stringify(fixture.asset)))}, new double[] ${list(fixtures.flatMap((fixture) => [real(fixture.forward), real(fixture.left)]))}, new int[] ${list(fixtures.map((fixture) => !fixture.use ? -2 : fixture.use.by === "hit" ? -1 : ticksOf(fixture.use.seconds)))}, new int[] ${list(fixtures.map((fixture) => ticksOf(fixture.use?.cooldown ?? 0)))}, new double[] ${list(fixtures.map((fixture) => real(fixture.clear.radius)))}, new int[] ${list(fixtures.map((fixture) => fixture.use?.lit_seconds === null ? -1 : ticksOf(fixture.use?.lit_seconds ?? fixture.clear.seconds)))}, ${real(plan.center.forward)}, ${real(plan.center.left)}, ${Boolean(fog)}, ${single(fog?.visibility ?? 0)}, ${fog ? Math.max(1, ticksOf(fog.fade_seconds)) : 0}, ${single(fog?.boss_damage ?? 1)}, ${single(fog?.damage_taken ?? 1)}, ${fog?.lift === "all_lit_once"}${fog?.fade_end === undefined ? "" : `, ${single(fog.fade_end)}`})`
  if (!arena.fixtures.some(group => group.light || group.ember_light)) return spec
  const levels = fixtures.flatMap(({entry}) => [arena.fixtures[entry]!.light ?? 0, arena.fixtures[entry]!.ember_light ?? 0])
  return `StudioFixtureLight.configure(${spec}, new int[] ${list(levels)})`
}

/**
 * The lines a boss with an arena adds to its class: its table, the statement its tick runs (`fight`, with whether its fight is on and whether an ability runs — a leave ends
 * with the ability that left), the statement its reset runs first (the fight ends: its fixtures go, its players' fog lifts, it is back if it was away), and its bar's dots.
 * Every piece empty for a boss without one, so its class is what it always was.
 */
export function bossArenaJava(boss: Pick<Boss, "arena"> & Partial<Pick<Boss, "death">> | null | undefined, abilities: readonly Ability[], running: string) {
  if (!boss || !(boss.arena || abilitiesUseArena(abilities))) return { fields: "", tick: "", reset: "", dots: "0, 0" }
  return {
    fields: `    // Boss 能力 12、13: its arena (fixtures round its home, the fog its abilities raise), run by ${R.server}.
    private static final ${R.server}.Spec ARENA = ${arenaSpecJava(boss)};
`,
    tick: `        // Boss 能力 12、13: its arena while its fight is on (awake, alive): fixtures put down, the fog, who is in it; gone again when the fight is not.
        ${boss.death?.steps?.some(step => step.type === "fixture") ? "if (!isDeadOrDying()) " : ""}${R.server}.fight(this, bossBar, ARENA, !isDeadOrDying() && bossState() != BOSS_DORMANT, bossHomeX, bossHomeY, bossHomeZ, ${running});
`,
    reset: `        // Boss 能力 12、13: the fight is over: its fixtures are taken away, the fog lifts for its players, and if it was away it is back home.
        ${R.server}.end(this);
`,
    dots: `${R.server}.dots(this), ${R.server}.litDots(this)`,
  }
}

// ---- what an ability's class carries (entity-abilities.ts) ----

const LEAVE_NUMBERS: Record<keyof typeof LEAVE_PLACES, number> = { home: 0, center: 1, near_target: 2 }

/** The statements of an ability's leave on their ticks (the ability's own, as `abilityPlan` counts them): it leaves; it comes back. (Its fog is an event, written with the others: `ARENA_FOG`.) */
export function arenaSteps(ability: Ability, plan: AbilityPlan) {
  const at = (seconds: number) => Math.min(plan.length, abilityTick(seconds))
  const leave: LeaveMove | undefined = abilityLeave(ability)
  const place = leave?.back.place
  const backArgs = typeof place === "object" ? `3, abilityTarget, ${[...place.forward, ...place.left].map(real).join(", ")}` : `${place ? LEAVE_NUMBERS[place] : 0}, abilityTarget`
  return [
    ...(leave
      ? [
          { tick: at(leave.at), lines: [`${R.server}.leave(this, ${real(leave.rise)});`] },
          { tick: at(leave.back.at), lines: [`${R.server}.back(this, ${backArgs});`] },
        ]
      : []),
  ]
}

/** The place a hit at the arena's middle is decided at (`place: "center"`, and every hit over the whole arena). */
export const ARENA_CENTER_PLACE = `${R.server}.center(this)`

/** The statement of an ability's fog event, on its tick. */
export const ARENA_FOG = `${R.server}.fog(this);`

/** What a hit over the whole arena holds a victim by: inside its circle, between its heights, and not in a safe place; 0 (the one place it has) or -1. */
export function arenaInside(shape: { low: number; high: number }, safe: ArenaSafe | undefined, slot: number) {
  const kind = !safe ? 0 : safe.around === "lit_fixtures" ? 1 : 2
  const points = safe && safe.around !== "lit_fixtures" ? safe.around.points.flatMap((point) => [real(point.forward), real(point.left)]) : []
  return `${R.server}.inside(this, victim, abilityPlaces[${slot}], ${real(shape.low)}, ${real(shape.high)}, ${kind}, ${real(safe?.radius ?? 0)}, new double[] ${list(points)})`
}

/** The statement that shows a warned hit's safe places while its warning shows (`StudioArena.warnSafe`); none for a hit without them. */
export function arenaWarnSafe(safe: ArenaSafe | undefined, ticks: number, mesh = false) {
  if (!safe) return []
  const kind = safe.around === "lit_fixtures" ? 1 : 2
  const points = safe.around !== "lit_fixtures" ? safe.around.points.flatMap((point) => [real(point.forward), real(point.left)]) : []
  return [`${R.server}.warnSafe(this, ${ticks}, ${kind}, ${real(safe.radius)}, new double[] ${list(points)}${mesh ? ", true" : ""});`]
}

/** True when some hit of the abilities is over the whole arena (its warning is then drawn as a full circle as wide as the arena). */
export const abilitiesHitArena = (abilities: readonly Ability[]) => abilities.some((ability) => arenaHits(ability).length > 0)

// ---- the classes ----

/** `send`: tells \`player\` the fog (\`foggy\`, \`spec\`); `sendBack`: tells every player who sees \`boss\` it is back at \`x\`, \`y\`, \`z\` (the \`Back\` packet). */
type Network = { imports: string; implementsInit: string; members: string; send: string; sendBack: string }

function arenaServer(packageName: string, modId: string, warned: boolean, shared: SharedBuiltin | undefined, fixtureControls: boolean, lighting: boolean, terrainInteractions: boolean, safeMesh: boolean, network: Network, extendedFog: boolean, returnOffset: boolean, untouched: boolean) {
  return `package ${packageName}.entity;

${network.imports}import com.mojang.logging.LogUtils;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerBossEvent;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.Mth;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.shapes.VoxelShape;
import org.slf4j.Logger;

/**
 * Generated by MineMods Studio (Boss 能力 12、13): the arenas of this mod's bosses. Everything is decided here, on the server: where the fixtures stand, which are lit, whether
 * the fog is up, who of the fight's players stands in it (each told alone, only when it changes), how much a blow in the fog does, where a boss that left the field is and
 * where it comes back, and who a hit over the whole arena spares. A player's game is told its fog and draws it (${R.client}).
 */
public final class ${R.server}${network.implementsInit} {
${network.members}
    private static final Logger LOGGER = LogUtils.getLogger();
    /** Blocks round the arena's middle that are its fight: who stands further is not in its fog, and a hit over the arena reaches no further. */
    public static final double RADIUS = ${real(ARENA_LIMITS.radius)};
    private static final int WATCH = ${ARENA_LIMITS.watch};
    private static final int EDGE = ${ARENA_LIMITS.edge};
    private static final int HOLD = ${ARENA_LIMITS.hold};
    private static final int GROUND_UP = ${ARENA_LIMITS.ground.up};
    private static final int GROUND_DOWN = ${ARENA_LIMITS.ground.down};
    /** The tag a boss carries while it is away, so one saved in the middle of a leave comes back when it is read again. */
    private static final String AWAY = "studio_arena_away";

    /**
     * One boss's arena, from its document: per fixture its asset id, where it stands (forward and left of home by twos), the ticks it is held to be lit (0: a click), the ticks
     * before it may be lit again once dark, the radius it clears and the ticks it stays lit; the arena's middle (forward, left); and the fog: whether there is one, how far is seen
     * in it, its ticks to come and go, what the boss's blows on a player in it and that player's blows on the boss are multiplied by, and whether every fixture lit once lifts it.
     */
    public record Spec(String[] looks, double[] places, int[] use, int[] cooldown, double[] clear, int[] clearTicks, double centerForward, double centerLeft,
                       boolean fog, float visibility, int fade, float bossDamage, float damageTaken, boolean liftAll${extendedFog ? `, float fadeEnd) {
        public Spec(String[] looks, double[] places, int[] use, int[] cooldown, double[] clear, int[] clearTicks, double centerForward, double centerLeft,
                    boolean fog, float visibility, int fade, float bossDamage, float damageTaken, boolean liftAll) {
            this(looks, places, use, cooldown, clear, clearTicks, centerForward, centerLeft, fog, visibility, fade, bossDamage, damageTaken, liftAll, visibility);
        }
    }` : ") {}"}

    /** One boss's fight: its arena as it was laid out, which fixtures are lit until when, its fog, who it told what, who is holding a fixture, and where it waits while it is away. */
    static final class Fight {
        final Mob boss;
        Spec spec;
        ServerBossEvent bar;
        ServerLevel level;
        long seen;
        long tick;
        double homeX;
        double homeY;
        double homeZ;
        float yaw;
        boolean placed;${fixtureControls ? `
        boolean closing;
        final List<Pending> pending = new ArrayList<>();` : ""}
        ${R.fixture}[] fixtures = new ${R.fixture}[0];
        double[] spots = new double[0];
        long[] litUntil = new long[0];
        long[] readyAt = new long[0];
        double centerX;
        double centerY;
        double centerZ;
        boolean fog;
        int litSince;
        final Map<UUID, Boolean> told = new HashMap<>();
        final Map<UUID, long[]> holding = new HashMap<>();
        boolean away;
        double awayX;
        double awayY;
        double awayZ;

        Fight(Mob boss) {
            this.boss = boss;
        }
    }

    private static final Map<UUID, Fight> FIGHTS = new HashMap<>();
    private static long serverTick;


    // ---- the boss's tick ----

    /**
     * Run by a boss with an arena on every server tick: \`on\` while its fight is (awake and alive), \`home\` where it began, \`running\` whether an ability of its runs (one that left
     * comes back when the ability that took it away is over, however it ended).
     */
    public static void fight(Mob boss, ServerBossEvent bar, Spec spec, boolean on, double homeX, double homeY, double homeZ, boolean running) {
        if (!(boss.level() instanceof ServerLevel level)) return;
        Fight fight = FIGHTS.get(boss.getUUID());
        if (fight != null && fight.boss != boss) {
            end(fight);
            fight = null;
        }
        if (fight == null) {
            // Saved while it was away (the world was left in the middle of a leave): it is back home, seen and hurt as ever.
            if (boss.getTags().contains(AWAY)) restore(boss, homeX, homeY, homeZ);
            if (!on) return;
            fight = new Fight(boss);
            FIGHTS.put(boss.getUUID(), fight);
        }
        fight.spec = spec;
        fight.bar = bar;
        fight.level = level;
        fight.seen = serverTick;
        fight.homeX = homeX;
        fight.homeY = homeY;
        fight.homeZ = homeZ;
        if (!on) {
            end(fight);
            return;
        }
        fight.tick++;
        if (fight.away) {
            if (!running) back(boss, 0, null);
            else {
                boss.getNavigation().stop();
                boss.setDeltaMovement(Vec3.ZERO);
                boss.setPos(fight.awayX, fight.awayY, fight.awayZ);
            }
        }
        if (!fight.placed && someoneNear(fight)) place(fight);
        long now = level.getGameTime();
        for (int index = 0; index < fight.fixtures.length; index++) {
            ${R.fixture} fixture = fight.fixtures[index];
            if (fixture == null) continue;
            // Taken away by something else (a command): put down again where it stood, as it was.
            ${lighting ? "if (fixture.isRemoved() && !level.hasChunkAt(fixture.blockPosition())) continue;\n            " : ""}${fixtureControls ? `if (fixture.isRemoved()) {
                boolean ember = fixture.ember();
                fixture = fight.fixtures[index] = putDown(fight, index, fixture.lit());
                if (ember) fixture.setEmber();
            }` : "if (fixture.isRemoved()) fixture = fight.fixtures[index] = putDown(fight, index, fixture.lit());"}
            if (fixture.lit() && now >= fight.litUntil[index]) {
                fixture.setLit(false);
                fight.readyAt[index] = now + spec.cooldown()[index];
            }
        }
        ${fixtureControls ? "advance(fight);\n        " : ""}if (fight.fog && spec.liftAll() && placedMask(fight) != 0 && (fight.litSince & placedMask(fight)) == placedMask(fight)) {
            // Every fixture has been lit since the fog came down: it lifts as a whole.
            fight.fog = false;
            ${shared?.sound.includes("mute:fog_lift") ? 'if (StudioBuiltin.audible(StudioBuiltin.owner(fight.boss), "fog_lift")) ' : ""}level.playSound(null, fight.centerX, fight.centerY, fight.centerZ, ${builtinSound(!!shared?.sound.includes("fog_lift"),"fight.boss","fog_lift","SoundEvents.BEACON_POWER_SELECT","block.beacon.power_select")}, SoundSource.HOSTILE, 4.0f, 0.8f);
            look(fight);
        }
        if (fight.tick % WATCH == 0) look(fight);
        if (fight.fog && fight.tick % EDGE == 0) edges(fight);
        name(fight);
    }

    /** Run by a boss's reset (a leash): its fight is over at once. */
    public static void end(Mob boss) {
        Fight fight = FIGHTS.get(boss.getUUID());
        if (fight != null && fight.boss == boss) end(fight);
        else if (boss.getTags().contains(AWAY)) restore(boss, boss.getX(), boss.getY(), boss.getZ());
    }

    /** At the end of every server tick: a fight whose boss did not tick (it is gone, or its chunk sleeps) is over. */
    public static void tick(MinecraftServer server) {
        serverTick++;
        ${lighting ? "" : "if (FIGHTS.isEmpty()) return;\n        "}for (Fight fight : new ArrayList<>(FIGHTS.values()))
            if (fight.boss.isRemoved() || fight.seen < serverTick - 2) end(fight);${lighting ? "\n        StudioFixtureLight.sync(server, FIGHTS.values());" : ""}
    }

    private static void end(Fight fight) {
        if (FIGHTS.get(fight.boss.getUUID()) == fight) FIGHTS.remove(fight.boss.getUUID());
        for (${R.fixture} fixture : fight.fixtures) if (fixture != null && !fixture.isRemoved()) fixture.discard();
        fight.fixtures = new ${R.fixture}[0];
        if (fight.level != null)
            for (Map.Entry<UUID, Boolean> entry : fight.told.entrySet())
                if (entry.getValue()) tellGone(fight, entry.getKey());
        fight.told.clear();
        fight.holding.clear();
        if (fight.bar != null) fight.bar.setName(fight.boss.getDisplayName());
        if (fight.away) {
            fight.away = false;
            restore(fight.boss, fight.homeX, fight.homeY, fight.homeZ);
        }
    }

    // ---- the fixtures ----

    private static boolean someoneNear(Fight fight) {
        for (ServerPlayer player : fight.level.players())
            if (!player.isSpectator() && player.isAlive() && Mth.square(player.getX() - fight.homeX) + Mth.square(player.getZ() - fight.homeZ) <= RADIUS * RADIUS) return true;
        return false;
    }

    /** The arena laid out: its frame is home and the way the boss faces now, turned to the nearest of the four directions; each fixture on the ground under its place, if there is ground. */
    private static void place(Fight fight) {
        Spec spec = fight.spec;
        fight.placed = true;
        fight.yaw = Math.round(fight.boss.getYRot() / 90.0f) * 90.0f;
        int count = spec.looks().length;
        fight.fixtures = new ${R.fixture}[count];
        fight.spots = new double[count * 3];
        fight.litUntil = new long[count];
        fight.readyAt = new long[count];
        double[] middle = at(fight, spec.centerForward(), spec.centerLeft());
        double middleY = ground(fight.level, middle[0], fight.homeY, middle[1]);
        fight.centerX = middle[0];
        fight.centerY = Double.isNaN(middleY) ? fight.homeY : middleY;
        fight.centerZ = middle[1];
        for (int index = 0; index < count; index++) {
            double[] spot = at(fight, spec.places()[index * 2], spec.places()[index * 2 + 1]);
            double y = ground(fight.level, spot[0], fight.homeY, spot[1]);
            fight.spots[index * 3] = spot[0];
            fight.spots[index * 3 + 1] = y;
            fight.spots[index * 3 + 2] = spot[1];
            if (Double.isNaN(y)) {
                LOGGER.warn("Arena fixture {} of {} was not put down: no ground to stand on within {} blocks above or {} below {}, {}, {}", index + 1, fight.boss.getName().getString(), GROUND_UP, GROUND_DOWN, Mth.floor(spot[0]), Mth.floor(fight.homeY), Mth.floor(spot[1]));
                continue;
            }
            fight.fixtures[index] = putDown(fight, index, false);
        }
    }

    /** A place of the arena's frame (forward and left of home, the way the arena faces) in the world: x and z. */
    private static double[] at(Fight fight, double forward, double left) {
        float turn = fight.yaw * 0.017453292f;
        return new double[] {fight.homeX - forward * Mth.sin(turn) + left * Mth.cos(turn), fight.homeZ + forward * Mth.cos(turn) + left * Mth.sin(turn)};
    }

    private static ${R.fixture} putDown(Fight fight, int index, boolean lit) {
        ${R.fixture} fixture = ${R.table}.make(fight.level, fight.spec.looks()[index]);
        double x = fight.spots[index * 3];
        double z = fight.spots[index * 3 + 2];
        // Its front toward home.
        float yaw = (float) (Math.atan2(fight.homeZ - z, fight.homeX - x) * 180.0 / Math.PI) - 90.0f;
        fixture.moveTo(x, fight.spots[index * 3 + 1], z, yaw, 0.0f);
        fixture.belong(fight, index);${shared?.particle.some(key => key === "fixture_lit" || key === "fixture_ember") ? `\n        fixture.getEntityData().set(${R.fixture}.OWNER, StudioBuiltin.owner(fight.boss));` : ""}${fixtureControls ? `
        fixture.getEntityData().set(${R.fixture}.HIT, fight.spec.use()[index] ${untouched ? "== -1" : "< 0"});` : ""}
        fixture.setLit(lit);
        fight.level.addFreshEntity(fixture);
        return fixture;
    }

    /**
     * The ground nearest to the height \`y\` stands at: the block under it first, then one above and one below by turns, up to GROUND_UP above and GROUND_DOWN below; the top of a
     * block something can stand on with two free blocks over it, so a fixture stands on the ground round home rather than on a roof over it. NaN when there is none or it is not loaded.
     */
    static double ground(ServerLevel level, double x, double y, double z) {
        BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
        int column = Mth.floor(x);
        int row = Mth.floor(z);
        int under = Mth.floor(y - 0.01);
        for (int step = 0; step <= 2 * Math.max(GROUND_UP, GROUND_DOWN); step++) {
            int shift = step % 2 == 0 ? -step / 2 : (step + 1) / 2;
            if (shift > GROUND_UP || -shift > GROUND_DOWN) continue;
            int at = under + shift;
            pos.set(column, at, row);
            if (!level.isLoaded(pos)) return Double.NaN;
            VoxelShape shape = level.getBlockState(pos).getCollisionShape(level, pos);
            if (shape.isEmpty()) continue;
            if (!free(level, pos.set(column, at + 1, row)) || !free(level, pos.set(column, at + 2, row))) continue;
            return at + shape.max(Direction.Axis.Y);
        }
        return Double.NaN;
    }

    private static boolean free(ServerLevel level, BlockPos pos) {
        return level.getBlockState(pos).getCollisionShape(level, pos).isEmpty();
    }

    private static int placedMask(Fight fight) {
        int mask = 0;
        for (int index = 0; index < fight.fixtures.length; index++) if (fight.fixtures[index] != null) mask |= 1 << index;
        return mask;
    }

    private static int litMask(Fight fight) {
        int mask = 0;
        for (int index = 0; index < fight.fixtures.length; index++) if (fight.fixtures[index] != null && fight.fixtures[index].lit()) mask |= 1 << index;
        return mask;
    }

    /**
     * A player holds the use key on a fixture (the game repeats the click every four ticks while it is held): the time held adds up while the clicks keep coming, and once it
     * reaches the fixture's own it is lit. Lit already, or dark for less than its wait, it says so. Run on the server by the fixture.
     */
    public static InteractionResult use(${R.fixture} fixture, Player player, InteractionHand hand) {
        Fight fight = fixture.fight() instanceof Fight owned ? owned : null;
        if (hand != InteractionHand.MAIN_HAND || fight == null || FIGHTS.get(fight.boss.getUUID()) != fight || player.isSpectator()) return InteractionResult.PASS;
        int index = fixture.index();${fixtureControls ? `
        if (fight.boss.isDeadOrDying()) return InteractionResult.PASS;
        if (fight.spec.use()[index] < 0) return InteractionResult.PASS;` : ""}
        long now = fight.level.getGameTime();
        if (fixture.lit()) {
            player.displayClientMessage(${fixtureControls ? `fight.spec.clearTicks()[index] < 0 ? Component.translatable("message.${modId}.fixture.stays") : ` : ""}Component.translatable("message.${modId}.fixture.lit_already", (fight.litUntil[index] - now + 19) / 20), true);
            return InteractionResult.SUCCESS;
        }
        if (now < fight.readyAt[index]) {
            player.displayClientMessage(Component.translatable("message.${modId}.fixture.cooling", (fight.readyAt[index] - now + 19) / 20), true);
            return InteractionResult.SUCCESS;
        }
        int need = fight.spec.use()[index];
        long[] held = fight.holding.get(player.getUUID());
        if (held == null || held[0] != index || now - held[2] > HOLD) {
            held = new long[] {index, 0L, now};
            fight.holding.put(player.getUUID(), held);
        } else {
            held[1] += now - held[2];
            held[2] = now;
        }
        if (held[1] >= need) {
            fight.holding.remove(player.getUUID());
            light(fight, index);
            player.displayClientMessage(${fixtureControls ? `fight.spec.clearTicks()[index] < 0 ? Component.translatable("message.${modId}.fixture.stays") : ` : ""}Component.translatable("message.${modId}.fixture.lit", fight.spec.clearTicks()[index] / 20), true);
            return InteractionResult.SUCCESS;
        }
        int done = (int) Math.min(10L, held[1] * 10L / Math.max(1, need));
        player.displayClientMessage(Component.translatable("message.${modId}.fixture.lighting", "\\u25a0".repeat(done) + "\\u25a1".repeat(10 - done)), true);
        return InteractionResult.SUCCESS;
    }

${fixtureControls ? `    static boolean strike(${R.fixture} fixture, DamageSource source) {
        if (!(fixture.fight() instanceof Fight fight) || FIGHTS.get(fight.boss.getUUID()) != fight || fight.boss.isDeadOrDying()) return false;
        if (!(source.getEntity() instanceof ServerPlayer player) || !inRange(fight, player) || fight.boss.isAlliedTo(player)) return false;
        Entity direct = source.getDirectEntity();
        boolean melee = direct == player && source.is(net.minecraft.world.damagesource.DamageTypes.PLAYER_ATTACK);
        boolean arrow = direct instanceof net.minecraft.world.entity.projectile.AbstractArrow shot && shot.getOwner() == player;
        int slot = fixture.index();
        if ((!melee && !arrow) || fight.fixtures[slot] != fixture || fight.spec.use()[slot] ${untouched ? "!= -1" : ">= 0"} || fixture.lit() || fight.level.getGameTime() < fight.readyAt[slot]) return false;
        light(fight, slot);
        return true;
    }

` : ""}    private static void light(Fight fight, int index) {
        ${R.fixture} fixture = fight.fixtures[index];
        if (fixture == null) return;
        fixture.setLit(true);
        fight.litUntil[index] = ${fixtureControls ? "fight.spec.clearTicks()[index] < 0 ? Long.MAX_VALUE : " : ""}fight.level.getGameTime() + fight.spec.clearTicks()[index];
        if (fight.fog) fight.litSince |= 1 << index;
        ${shared?.sound.includes("mute:arena_light") ? 'if (StudioBuiltin.audible(StudioBuiltin.owner(fight.boss), "arena_light")) ' : ""}fight.level.playSound(null, fixture.getX(), fixture.getY(), fixture.getZ(), ${builtinSound(!!shared?.sound.includes("arena_light"),"fight.boss","arena_light","SoundEvents.BEACON_ACTIVATE","block.beacon.activate")}, SoundSource.BLOCKS, 2.0f, 1.2f);
        ${fixtureControls ? "if (!fight.closing) " : ""}look(fight);
    }

${fixtureControls ? fixtureRuntime : ""}    // ---- the fog ----

    /** An ability's fog event: the fog comes down over the arena (nothing when it is already down, or the arena has none). What was lit then counts toward lifting it. */
    public static void fog(Mob boss) {
        Fight fight = FIGHTS.get(boss.getUUID());
        if (fight == null || fight.boss != boss || !fight.spec.fog() || fight.fog) return;
        fight.fog = true;
        fight.litSince = litMask(fight);
        look(fight);
    }

    /** Whether a place is in the clear ground of a lit fixture. */
    private static boolean clear(Fight fight, double x, double z) {
        for (int index = 0; index < fight.fixtures.length; index++) {
            ${R.fixture} fixture = fight.fixtures[index];
            if (fixture != null && fixture.lit() && Mth.square(x - fight.spots[index * 3]) + Mth.square(z - fight.spots[index * 3 + 2]) <= Mth.square(fight.spec.clear()[index])) return true;
        }
        return false;
    }

    private static boolean inRange(Fight fight, Player player) {
        double x = fight.placed ? fight.centerX : fight.homeX;
        double z = fight.placed ? fight.centerZ : fight.homeZ;
        return player.isAlive() && !player.isSpectator() && player.level() == fight.level && Mth.square(player.getX() - x) + Mth.square(player.getZ() - z) <= RADIUS * RADIUS && Math.abs(player.getY() - fight.homeY) <= RADIUS;
    }

    /** Each player of the fight decided anew (in the fog, or not), and told alone when it changed; whoever left the fight is told it is gone. */
    private static void look(Fight fight) {
        List<UUID> near = new ArrayList<>();
        for (ServerPlayer player : fight.level.players()) {
            if (!inRange(fight, player)) continue;
            near.add(player.getUUID());
            boolean foggy = fight.fog && !clear(fight, player.getX(), player.getZ());
            Boolean was = fight.told.get(player.getUUID());
            if (was == null || was != foggy) {
                if (was != null || foggy) tell(player, foggy, fight.spec);
                fight.told.put(player.getUUID(), foggy);
            }
        }
        Iterator<Map.Entry<UUID, Boolean>> entries = fight.told.entrySet().iterator();
        while (entries.hasNext()) {
            Map.Entry<UUID, Boolean> entry = entries.next();
            if (near.contains(entry.getKey())) continue;
            if (entry.getValue()) tellGone(fight, entry.getKey());
            entries.remove();
        }
    }

    /** A ring of mist at the edge of every lit fixture's clear ground, shown to the fight's players, so it is seen from outside where the clear ground ends. */
    private static void edges(Fight fight) {
        List<ServerPlayer> watching = new ArrayList<>();
        for (UUID id : fight.told.keySet()) {
            ServerPlayer player = player(fight, id);
            if (player != null && player.level() == fight.level) watching.add(player);
        }
        if (watching.isEmpty()) return;
        for (int index = 0; index < fight.fixtures.length; index++) {
            ${R.fixture} fixture = fight.fixtures[index];
            if (fixture == null || !fixture.lit()) continue;
            double radius = fight.spec.clear()[index];
            int points = Math.max(12, (int) Math.round(radius * 2.0));
            for (int at = 0; at < points; at++) {
                double angle = at * 2.0 * Math.PI / points + fight.tick * 0.01;
                double x = fight.spots[index * 3] + Math.cos(angle) * radius;
                double z = fight.spots[index * 3 + 2] + Math.sin(angle) * radius;
                ${shared?.particle.includes("mute:fog_edge") ? 'if (StudioBuiltin.visible(fight.boss, "fog_edge")) ' : ""}for (ServerPlayer player : watching) fight.level.sendParticles(player, ${builtinParticle(!!shared?.particle.includes("fog_edge"),"fight.boss","fog_edge","ParticleTypes.CLOUD")}, false, x, fight.spots[index * 3 + 1] + 0.8, z, 1, 0.15, 0.4, 0.15, 0.0);
            }
        }
    }

    /** A player who was told the fog and is no longer of the fight is told it is gone, if they are still on the server. */
    private static void tellGone(Fight fight, UUID id) {
        ServerPlayer player = player(fight, id);
        if (player != null) tell(player, false, fight.spec);
    }

    /** A player by id: in the fight's world first (every player there, a fake one too), else anywhere on the server; null when gone. */
    private static ServerPlayer player(Fight fight, UUID id) {
        Player found = fight.level.getPlayerByUUID(id);
        return found instanceof ServerPlayer player ? player : fight.level.getServer().getPlayerList().getPlayer(id);
    }

    private static void tell(ServerPlayer player, boolean foggy, Spec spec) {
${network.send}
    }

    /** The bar's name with how many fixtures have been lit of all, while the fog is down: 「（2/4）」. */
    private static void name(Fight fight) {
        Component plain = fight.boss.getDisplayName();
        int all = Integer.bitCount(placedMask(fight));
        Component wanted = fight.fog && all > 0 ? plain.copy().append("\\uff08" + Integer.bitCount(fight.litSince & placedMask(fight)) + "/" + all + "\\uff09") : plain;
        if (!wanted.equals(fight.bar.getName())) fight.bar.setName(wanted);
    }

    /** The dots of a boss's own bar: one a fixture. */
    public static int dots(Mob boss) {
        Fight fight = FIGHTS.get(boss.getUUID());
        return fight != null && fight.boss == boss ? fight.fixtures.length : 0;
    }

    /** Which dots are lit: while the fog is down, the fixtures lit since it came; else the ones lit now. */
    public static int litDots(Mob boss) {
        Fight fight = FIGHTS.get(boss.getUUID());
        if (fight == null || fight.boss != boss) return 0;
        return fight.fog ? fight.litSince & placedMask(fight) : litMask(fight);
    }

    /**
     * What a blow does in the fog (from the mixin into \`LivingEntity.hurt\`, on the server): a boss's blow on a player of its fight who stands in the fog is multiplied by its
     * fog's number, and such a player's blow on the boss by the other. A thrown thing's or a shot's blow is its thrower's.
     */
    public static float hurt(LivingEntity victim, DamageSource source, float amount) {
        if (FIGHTS.isEmpty() || victim.level().isClientSide()) return amount;
        Entity attacker = source.getEntity();
        if (attacker == null) return amount;
        Fight struck = FIGHTS.get(victim.getUUID());
        if (struck != null && struck.boss == victim && attacker instanceof Player && Boolean.TRUE.equals(struck.told.get(attacker.getUUID()))) return amount * struck.spec.damageTaken();
        if (victim instanceof Player) {
            Fight striking = FIGHTS.get(attacker.getUUID());
            if (striking != null && striking.boss == attacker && Boolean.TRUE.equals(striking.told.get(victim.getUUID()))) return amount * striking.spec.bossDamage();
        }
        return amount;
    }

    // ---- leaving the field ----

    /** An ability's leave: up \`rise\` blocks, unseen, unhurt and no one's target (its bar stays), kept there until it comes back. */
    public static void leave(Mob boss, double rise) {
        Fight fight = FIGHTS.get(boss.getUUID());
        if (fight == null || fight.boss != boss || fight.away) return;
        ${shared?.particle.includes("mute:leave") ? 'if (StudioBuiltin.visible(boss, "leave")) ' : ""}fight.level.sendParticles(${builtinParticle(!!shared?.particle.includes("leave"),"boss","leave","ParticleTypes.CLOUD")}, boss.getX(), boss.getY() + boss.getBbHeight() * 0.5, boss.getZ(), 60, boss.getBbWidth() * 0.5, boss.getBbHeight() * 0.5, boss.getBbWidth() * 0.5, 0.05);
        ${shared?.sound.includes("mute:leave") ? 'if (StudioBuiltin.audible(StudioBuiltin.owner(boss), "leave")) ' : ""}fight.level.playSound(null, boss.getX(), boss.getY(), boss.getZ(), ${builtinSound(!!shared?.sound.includes("leave"),"boss","leave","SoundEvents.ENDER_DRAGON_FLAP","entity.ender_dragon.flap")}, SoundSource.HOSTILE, 4.0f, 0.6f);
        fight.away = true;
        fight.awayX = boss.getX();
        fight.awayY = boss.getY() + rise;
        fight.awayZ = boss.getZ();
        boss.addTag(AWAY);
        boss.setInvisible(true);
        boss.setInvulnerable(true);
        boss.setNoGravity(true);
        boss.getNavigation().stop();
        boss.setDeltaMovement(Vec3.ZERO);
        boss.moveTo(fight.awayX, fight.awayY, fight.awayZ, boss.getYRot(), boss.getXRot());
    }

    /** An ability's coming back: down at home (0), the arena's middle (1) or beside its target (2; the middle without one), seen and hurt again. */
    public static void back(Mob boss, int place, LivingEntity target) {${returnOffset ? `
        back(boss, place, target, 0, 0, 0, 0);
    }

    public static void back(Mob boss, int place, LivingEntity target, double frontMin, double frontMax, double leftMin, double leftMax) {` : ""}
        Fight fight = FIGHTS.get(boss.getUUID());
        if (fight == null || fight.boss != boss || !fight.away) return;
        fight.away = false;
        double x = place == 0 ? fight.homeX : fight.placed ? fight.centerX : fight.homeX;
        double y = place == 0 ? fight.homeY : fight.placed ? fight.centerY : fight.homeY;
        double z = place == 0 ? fight.homeZ : fight.placed ? fight.centerZ : fight.homeZ;
        ${returnOffset ? `if (place == 3) {
            x = fight.homeX;
            y = fight.homeY;
            z = fight.homeZ;
            if (target != null && target.isAlive() && target.level() == fight.level) {
                double yaw = Math.toRadians(target.getYRot());
                double sin = Math.sin(yaw), cos = Math.cos(yaw);
                for (int attempt = 0; attempt < 12; attempt++) {
                    double front = frontMin + boss.getRandom().nextDouble() * (frontMax - frontMin);
                    double left = leftMin + boss.getRandom().nextDouble() * (leftMax - leftMin);
                    double px = target.getX() - sin * front + cos * left;
                    double pz = target.getZ() + cos * front + sin * left;
                    double py = ground(fight.level, px, target.getY(), pz);
                    if (!Double.isFinite(py)) continue;
                    var box = boss.getBoundingBox().move(px - boss.getX(), py - boss.getY(), pz - boss.getZ());
                    if (!fight.level.noCollision(boss, box)) continue;
                    x = px;
                    y = py;
                    z = pz;
                    break;
                }
            }
        }
        ` : ""}if (place == 2 && target != null && target.isAlive() && target.level() == boss.level()) {
            // Four blocks from its target, on the side toward the arena's middle.
            double dx = x - target.getX();
            double dz = z - target.getZ();
            double far = Math.sqrt(dx * dx + dz * dz);
            double nearX = target.getX() + (far < 1.0e-3 ? 4.0 : dx / far * 4.0);
            double nearZ = target.getZ() + (far < 1.0e-3 ? 0.0 : dz / far * 4.0);
            double nearY = ground(fight.level, nearX, target.getY(), nearZ);
            x = nearX;
            z = nearZ;
            y = Double.isNaN(nearY) ? target.getY() : nearY;
        }
        restore(boss, x, y, z);
        // The players' games are told before the game's own move reaches them, so they put it there at once: else it is seen (no longer unseen) sliding down from
        // where it was away, as the game eases a mob's move over three ticks.
${network.sendBack}
        ${shared?.particle.includes("mute:return") ? 'if (StudioBuiltin.visible(boss, "return")) ' : ""}fight.level.sendParticles(${builtinParticle(!!shared?.particle.includes("return"),"boss","return","ParticleTypes.EXPLOSION")}, x, y + 0.5, z, 6, boss.getBbWidth() * 0.5, 0.3, boss.getBbWidth() * 0.5, 0.0);
        ${shared?.sound.includes("mute:return") ? 'if (StudioBuiltin.audible(StudioBuiltin.owner(boss), "return")) ' : ""}fight.level.playSound(null, x, y, z, ${builtinSound(!!shared?.sound.includes("return"),"boss","return","SoundEvents.GENERIC_EXPLODE","entity.generic.explode")}, SoundSource.HOSTILE, 3.0f, 0.7f);
    }

    /** Seen, hurt and a target again, with its own gravity, at a place. */
    private static void restore(Mob boss, double x, double y, double z) {
        boss.removeTag(AWAY);
        boss.setInvisible(false);
        boss.setInvulnerable(false);
        boss.setNoGravity(false);
        boss.setDeltaMovement(Vec3.ZERO);
        boss.moveTo(x, y, z, boss.getYRot(), boss.getXRot());
    }

    // ---- hits over the arena ----

    /** The arena's middle (x, y, z): where a hit over the whole arena, and anything put down at "center", is counted from. Without an arena laid out yet, home; without a fight, its own feet. */
    public static double[] center(Mob boss) {
        Fight fight = FIGHTS.get(boss.getUUID());
        if (fight == null || fight.boss != boss) return new double[] {boss.getX(), boss.getY(), boss.getZ()};
        return fight.placed ? new double[] {fight.centerX, fight.centerY, fight.centerZ} : new double[] {fight.homeX, fight.homeY, fight.homeZ};
    }

${
  warned
    ? `    /**
     * Blue rings on the ground where a hit over the whole arena will spare, shown while its warning shows (\`ticks\`): round every fixture lit now (\`safe\` 1), or round its points
     * (2, forward and left by twos in the arena's frame), \`radius\` blocks. The warning of the hit itself is item 3's; these are the same packet, in another colour.
     */
${safeMesh ? "    public static void warnSafe(Mob boss, int ticks, int safe, double radius, double[] points) { warnSafe(boss, ticks, safe, radius, points, false); }\n\n" : ""}    public static void warnSafe(Mob boss, int ticks, int safe, double radius, double[] points${safeMesh ? ", boolean mesh" : ""}) {
        Fight fight = FIGHTS.get(boss.getUUID());
        if (fight == null || fight.boss != boss || safe == 0) return;
        List<Double> found = new ArrayList<>();
        if (safe == 1) {
            for (int index = 0; index < fight.fixtures.length; index++) {
                ${R.fixture} fixture = fight.fixtures[index];
                if (fixture == null || !fixture.lit()) continue;
                found.add(fight.spots[index * 3]);
                found.add(fight.spots[index * 3 + 1]);
                found.add(fight.spots[index * 3 + 2]);
            }
        } else {
            for (int at = 0; at + 1 < points.length; at += 2) {
                double[] point = at(fight, points[at], points[at + 1]);
                found.add(point[0]);
                found.add(fight.placed ? fight.centerY : fight.homeY);
                found.add(point[1]);
            }
        }
        if (found.isEmpty()) return;
        double[] places = new double[found.size()];
        for (int at = 0; at < places.length; at++) places[at] = found.get(at);
        ${ABILITY_WARN.server}.send(fight.level, new ${ABILITY_WARN.server}.Warn(boss.getId(), ticks, ${safeMesh ? `mesh ? ${ABILITY_WARN.looks.ring + 8} : ${ABILITY_WARN.looks.ring}` : ABILITY_WARN.looks.ring}, ${ABILITY_WARN.colors.blue}, ${ABILITY_WARN.shapes.arc}, 0.0f, (float) radius, 180.0f, -1.0f, 3.0f, 0.0f, 0.0f, places));
    }

`
    : ""
}    /**
     * Whether a hit over the whole arena (its middle \`places\`) holds a victim: within RADIUS of the middle, between \`low\` and \`high\` above it, and not in a safe place — round
     * a lit fixture (\`safe\` 1) or round a point of the arena's frame (2, \`points\` forward and left by twos), \`radius\` blocks. 0 (its one place) or -1.
     */
    public static int inside(Mob boss, ${fixtureControls ? "Entity" : terrainInteractions ? "net.minecraft.world.entity.Entity" : "LivingEntity"} victim, double[] places, double low, double high, int safe, double radius, double[] points) {
        double wide = victim.getBbWidth() / 2.0;
        if (Mth.square(victim.getX() - places[0]) + Mth.square(victim.getZ() - places[2]) > Mth.square(RADIUS + wide)) return -1;
        AABB box = victim.getBoundingBox();
        if (box.maxY < places[1] + low || box.minY > places[1] + high) return -1;
        Fight fight = FIGHTS.get(boss.getUUID());
        if (fight == null || fight.boss != boss || safe == 0) return 0;
        if (safe == 1) {
            for (int index = 0; index < fight.fixtures.length; index++) {
                ${R.fixture} fixture = fight.fixtures[index];
                if (fixture != null && fixture.lit() && Mth.square(victim.getX() - fight.spots[index * 3]) + Mth.square(victim.getZ() - fight.spots[index * 3 + 2]) <= radius * radius) return -1;
            }
            return 0;
        }
        for (int at = 0; at + 1 < points.length; at += 2) {
            double[] point = at(fight, points[at], points[at + 1]);
            if (Mth.square(victim.getX() - point[0]) + Mth.square(victim.getZ() - point[1]) <= radius * radius) return -1;
        }
        return 0;
    }
}
`
}

function fixtureSource(packageName: string, fixtureControls: boolean, particles: boolean, effects: boolean) {
  return `package ${packageName}.entity;

import net.minecraft.nbt.CompoundTag;
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
import net.minecraft.world.entity.Pose;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Explosion;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.material.PushReaction;
import software.bernie.geckolib.animatable.GeoEntity;
import software.bernie.geckolib.animatable.instance.AnimatableInstanceCache;
import software.bernie.geckolib.animation.AnimatableManager;
import software.bernie.geckolib.animation.AnimationController;
import software.bernie.geckolib.util.GeckoLibUtil;

/** Generated by MineMods Studio (Boss 能力 12): a fixture of a boss's arena. It stands where its arena put it down, is lit by a player's right click, and is never saved, hurt or pushed. */
public class ${R.fixture} extends Entity implements GeoEntity {
    // Which fixture it is and whether it is lit: all a player's game is told beyond where it stands.
    private static final EntityDataAccessor<Integer> KIND = SynchedEntityData.defineId(${R.fixture}.class, EntityDataSerializers.INT);
    private static final EntityDataAccessor<Boolean> LIT = SynchedEntityData.defineId(${R.fixture}.class, EntityDataSerializers.BOOLEAN);
${particles ? `    static final EntityDataAccessor<String> OWNER = SynchedEntityData.defineId(${R.fixture}.class, EntityDataSerializers.STRING);
` : ""}${fixtureControls ? `    static final EntityDataAccessor<Boolean> EMBER = SynchedEntityData.defineId(${R.fixture}.class, EntityDataSerializers.BOOLEAN);
    static final EntityDataAccessor<Boolean> HIT = SynchedEntityData.defineId(${R.fixture}.class, EntityDataSerializers.BOOLEAN);
` : ""}    private final AnimatableInstanceCache animations = GeckoLibUtil.createInstanceCache(this);
    // The server's own: the fight it belongs to (null: none, and it goes) and which of that fight's fixtures it is.
    private Object fight;${effects ? `
    private StudioEffect shown;
    private String shownId;
    private void updateEffect() {
        String key = lit() ? "fixture_lit" : ${fixtureControls ? 'ember() ? "fixture_ember" : null' : 'null'};
        String id = key == null ? null : StudioBuiltin.fixtureEffect(getEntityData().get(OWNER), key);
        if (!java.util.Objects.equals(id, shownId) && shown != null) shown.discard();
        shownId = id;
        if (id != null && (shown == null || shown.isRemoved()))
            shown = StudioEffects.spawn(id, level(), position().add(0, getBbHeight() * 0.8, 0), getYRot(), this, null);
    }
    @Override public void remove(Entity.RemovalReason reason) {
        if (shown != null) shown.discard();
        super.remove(reason);
    }` : ""}
    private int index;

    public ${R.fixture}(EntityType<? extends ${R.fixture}> type, Level world) {
        super(type, world);
        noPhysics = true;
        setNoGravity(true);
    }

    @Override protected void defineSynchedData(SynchedEntityData.Builder builder) {
        builder.define(KIND, 0);
        builder.define(LIT, false);${particles ? '\n        builder.define(OWNER, "");' : ""}${fixtureControls ? `
        builder.define(HIT, false);
        builder.define(EMBER, false);` : ""}
    }

    public int kind() { return Mth.clamp(getEntityData().get(KIND), 0, ${R.table}.NAMES.length - 1); }

    public boolean lit() { return getEntityData().get(LIT); }

    /** Whether its glowing parts are drawn now: always, while lit, or never, as its asset says. */
    public boolean glows() { return ${R.table}.GLOW[kind()] == 2 || ${R.table}.GLOW[kind()] == 1 && lit(); }

    void setKind(int kind) {
        getEntityData().set(KIND, kind);
        refreshDimensions();
    }

    void setLit(boolean lit) { ${fixtureControls ? "getEntityData().set(EMBER, false); " : ""}getEntityData().set(LIT, lit); }${fixtureControls ? `
    boolean ember() { return getEntityData().get(EMBER); }
    void setEmber() { getEntityData().set(LIT, false); getEntityData().set(EMBER, true); }` : ""}

    void belong(Object fight, int index) {
        this.fight = fight;
        this.index = index;
    }

    Object fight() { return fight; }

    int index() { return index; }

    @Override public void onSyncedDataUpdated(EntityDataAccessor<?> key) {
        super.onSyncedDataUpdated(key);
        if (KIND.equals(key)) refreshDimensions();
    }

    // As large as its model stands, for a player's crosshair to find it.
    @Override public EntityDimensions getDimensions(Pose pose) { return EntityDimensions.fixed(${R.table}.WIDTH[kind()], ${R.table}.HEIGHT[kind()]); }

    @Override public void tick() {
        super.tick();
        // One that belongs to no fight (its arena is over, or it was never put down by one) is gone.
        if (!level().isClientSide() && fight == null) discard();${effects ? "\n        if (!level().isClientSide() && !isRemoved()) updateEffect();" : ""}${particles ? `
        if (level().isClientSide() && tickCount % 4 == 0 && (lit()${fixtureControls ? " || ember()" : ""})) {
            var particle = StudioBuiltin.fixtureParticle(getEntityData().get(OWNER), lit() ? "fixture_lit" : "fixture_ember",
                lit() ? null : net.minecraft.core.particles.ParticleTypes.SMALL_FLAME);
            if (particle != null) level().addParticle(particle, getX(), getY() + getBbHeight() * 0.8, getZ(), 0.0, 0.015, 0.0);
        }` : fixtureControls ? `
        if (level().isClientSide() && ember() && tickCount % 4 == 0)
            level().addParticle(net.minecraft.core.particles.ParticleTypes.SMALL_FLAME, getX(), getY() + getBbHeight() * 0.8, getZ(), 0.0, 0.015, 0.0);` : ""}
    }

    @Override public InteractionResult interact(Player player, InteractionHand hand) {
        if (level().isClientSide()) return ${fixtureControls ? "!getEntityData().get(HIT) && " : ""}hand == InteractionHand.MAIN_HAND ? InteractionResult.SUCCESS : InteractionResult.PASS;
        return ${R.server}.use(this, player, hand);
    }

    // Never written to disk: its arena puts it down again when its fight is on.
    @Override public boolean shouldBeSaved() { return false; }
    @Override protected void readAdditionalSaveData(CompoundTag nbt) {}
    @Override protected void addAdditionalSaveData(CompoundTag nbt) {}

    @Override public boolean hurt(DamageSource source, float amount) { return ${fixtureControls ? `${R.server}.strike(this, source)` : "false"}; }
    @Override public boolean isAttackable() { return ${fixtureControls ? "getEntityData().get(HIT)" : "false"}; }
    @Override public boolean skipAttackInteraction(Entity attacker) { return ${fixtureControls ? "!getEntityData().get(HIT)" : "true"}; }
    @Override public boolean isPickable() { return !isRemoved(); }
    @Override public boolean canBeHitByProjectile() { return ${fixtureControls ? "getEntityData().get(HIT)" : "false"}; }
    @Override public boolean canBeCollidedWith() { return false; }
    @Override public boolean isPushable() { return false; }
    @Override public boolean isPushedByFluid() { return false; }
    @Override public boolean isIgnoringBlockTriggers() { return true; }
    @Override public boolean canUsePortal(boolean allowVehicles) { return false; }
    @Override public boolean ignoreExplosion(Explosion explosion) { return true; }
    @Override public boolean displayFireAnimation() { return false; }
    @Override public PushReaction getPistonPushReaction() { return PushReaction.IGNORE; }

    @Override public void registerControllers(AnimatableManager.ControllerRegistrar controllers) {
        // Dark or lit, the motion its asset gives each.
        controllers.add(new AnimationController<>(this, "lit", 0, state -> state.setAndContinue(${fixtureControls ? `ember() ? ${R.table}.EMBER[kind()] : ` : ""}lit() ? ${R.table}.LIT[kind()] : ${R.table}.UNLIT[kind()])));
    }

    @Override public AnimatableInstanceCache getAnimatableInstanceCache() { return animations; }
}
`
}

type Made = { id: string; title: string; name: string; unlit: { name: string; loop: boolean }; lit: { name: string; loop: boolean }; ember: { name: string; loop: boolean }; glow: number; width: number; height: number }

function fixtureTable(packageName: string, modId: string, made: readonly Made[], facade: boolean, controls: boolean) {
  const clip = (value: { name: string; loop: boolean }, name: string) => `RawAnimation.begin().${value.loop ? "thenLoop" : "thenPlayAndHold"}("animation.${name}.${value.name}")`
  return `package ${packageName}.entity;

${
  facade
    ? `import ${packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import java.util.List;
import java.util.function.Supplier;
`
    : `import java.util.List;
import net.fabricmc.api.ModInitializer;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
`}import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.world.level.Level;
import software.bernie.geckolib.animation.RawAnimation;

/** Generated by MineMods Studio (Boss 能力 12): the fixtures of this mod's arenas, one entity type for all of them. */
public final class ${R.table}${facade ? "" : " implements ModInitializer"} {
    public static final String MOD_ID = ${JSON.stringify(modId)};
    // Never written to disk and never summoned by command: a fixture only exists because its boss's fight put it down.
${
  facade
    ? `    public static final Supplier<EntityType<${R.fixture}>> TYPE = ${PLATFORM_CLASS}.entity("${R.registry}",
        () -> EntityType.Builder.<${R.fixture}>of(${R.fixture}::new, MobCategory.MISC)
            .sized(1.0f, 1.0f).noSave().noSummon().fireImmune().clientTrackingRange(10).updateInterval(2).build("${R.registry}"));`
    : `    public static final EntityType<${R.fixture}> TYPE = Registry.register(
        BuiltInRegistries.ENTITY_TYPE, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${R.registry}"),
        EntityType.Builder.<${R.fixture}>of(${R.fixture}::new, MobCategory.MISC)
            .sized(1.0f, 1.0f).noSave().noSummon().fireImmune().clientTrackingRange(10).updateInterval(2).build("${R.registry}"));`
}
    // One row a fixture asset, in the order of their asset ids.
${made.map((entry, index) => `    // ${index}: "${entry.title.replace(/[\r\n*\\]/g, " ")}" plays "${entry.unlit.name}" dark and "${entry.lit.name}" lit.`).join("\n")}
    private static final List<String> IDS = List.of(${made.map((entry) => JSON.stringify(entry.id)).join(", ")});
    public static final String[] NAMES = ${list(made.map((entry) => JSON.stringify(entry.name)))};
    public static final RawAnimation[] UNLIT = {${made.map((entry) => clip(entry.unlit, entry.name)).join(", ")}};
    public static final RawAnimation[] LIT = {${made.map((entry) => clip(entry.lit, entry.name)).join(", ")}};
${controls ? `    public static final RawAnimation[] EMBER = {${made.map(entry => clip(entry.ember, entry.name)).join(", ")}};
` : ""}    /** When each one's glowing parts are drawn: 0 never, 1 while lit, 2 always. */
    public static final int[] GLOW = ${list(made.map((entry) => entry.glow))};
    /** How wide and tall each one stands, in blocks: what a player's crosshair finds. */
    public static final float[] WIDTH = ${list(made.map((entry) => single(entry.width)))};
    public static final float[] HEIGHT = ${list(made.map((entry) => single(entry.height)))};

${
  facade
    ? `    private ${R.table}() {}

    /** Run by the mod's common entry while the mod is constructed: loading this class registers the entity type (its field above), and the arena's packet and tick are set up. */
    public static void register() {
        ${R.server}.register();
    }`
    : `    // Fabric builds a main entrypoint through its no-argument constructor, which must be public.
    public ${R.table}() {}

    // Loading this class registers the entity type; nothing else is needed at start.
    @Override public void onInitialize() {}`
}

    /** A new fixture of the asset \`id\`, not yet in the world. */
    static ${R.fixture} make(Level world, String id) {
        int kind = IDS.indexOf(id);
        if (kind < 0) throw new IllegalArgumentException("This project has no fixture " + id);
        ${R.fixture} fixture = new ${R.fixture}(${facade ? "TYPE.get()" : "TYPE"}, world);
        fixture.setKind(kind);
        return fixture;
    }
}
`
}

type ClientNetwork = { imports: string; implementsInit: string; register: string }

function arenaClient(packageName: string, network: ClientNetwork, extendedFog: boolean) {
  return `package ${packageName}.client;

${network.imports}import com.mojang.blaze3d.systems.RenderSystem;
import java.util.HashMap;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.Entity;
import software.bernie.geckolib.animatable.GeoEntity;
import software.bernie.geckolib.renderer.GeoRenderer;
import software.bernie.geckolib.renderer.layer.AutoGlowingGeoLayer;

/**
 * Generated by MineMods Studio (Boss 能力 12): the fog this player's game was told it stands in (only a player of the fight is told), eased in and out over the fog's own ticks;
 * the mixin ${R.fog} reads it every frame. A world this game has left takes its fog with it. Glowing parts are drawn with the fog lifted (\`fogFree\`), so eyes, fires and blades
 * still show through it.
 */
public final class ${R.client}${network.implementsInit} {
    private static boolean on;
    private static float visibility = 8.0f;${extendedFog ? "\n    private static float fadeEnd = 8.0f;" : ""}
    private static int fade = 40;
    private static float now;
    private static float before;
    private static ClientLevel world;

${network.register}
    /** A boss back from a leave is put where it is back at once, and where it was a frame ago too, so it is not drawn sliding down from where it was away. */
    private static void back(int id, double x, double y, double z) {
        ClientLevel level = Minecraft.getInstance().level;
        Entity entity = level == null ? null : level.getEntity(id);
        if (entity == null) return;
        entity.setPos(x, y, z);
        entity.setOldPosAndRot();
    }

    private static void told(boolean foggy, float far, int ticks${extendedFog ? ", float end" : ""}) {
        Minecraft client = Minecraft.getInstance();
        if (client.level != world) {
            world = client.level;
            now = before = 0.0f;
        }
        on = foggy;
        if (far > 0.0f) visibility = far;${extendedFog ? "\n        if (end > 0.0f) fadeEnd = end;" : ""}
        fade = Math.max(1, ticks);
    }

    private static void tick() {
        Minecraft client = Minecraft.getInstance();
        if (client.level != world) {
            world = client.level;
            on = false;
            now = before = 0.0f;
            return;
        }
        before = now;
        float step = 1.0f / fade;
        now = on ? Math.min(1.0f, now + step) : Math.max(0.0f, now - step);
    }

    /** How far into the fog this frame is, 0 (none) to 1 (as thick as it gets). */
    public static float amount(float partialTick) {
        return Minecraft.getInstance().level != world ? 0.0f : Mth.lerp(partialTick, before, now);
    }

    /** Blocks a player sees in the fog at its thickest. */
    public static float visibility() { return visibility; }
${extendedFog ? "    public static float fadeEnd() { return fadeEnd; }\n" : ""}
    private static final Map<RenderType, RenderType> FREE = new HashMap<>();
    private static float keptStart;
    private static float keptEnd;
    private static boolean lifted;

    /** The same render type with the fog lifted while it is drawn, as long as this player stands in the fog: what glows is seen through it. */
    public static RenderType fogFree(RenderType inner) {
        return FREE.computeIfAbsent(inner, type -> new RenderType("${R.registry}_fog_free", type.format(), type.mode(), type.bufferSize(), type.affectsCrumbling(), true,
                () -> {
                    type.setupRenderState();
                    if (amount(1.0f) > 0.0f) {
                        keptStart = RenderSystem.getShaderFogStart();
                        keptEnd = RenderSystem.getShaderFogEnd();
                        RenderSystem.setShaderFogStart(Float.MAX_VALUE);
                        RenderSystem.setShaderFogEnd(Float.MAX_VALUE);
                        lifted = true;
                    }
                },
                () -> {
                    if (lifted) {
                        RenderSystem.setShaderFogStart(keptStart);
                        RenderSystem.setShaderFogEnd(keptEnd);
                        lifted = false;
                    }
                    type.clearRenderState();
                }) {});
    }

    /** GeckoLib's glow layer drawn with the fog lifted (\`fogFree\`). */
    public static class Glow<T extends Entity & GeoEntity> extends AutoGlowingGeoLayer<T> {
        public Glow(GeoRenderer<T> renderer) {
            super(renderer);
        }

        @Override protected RenderType getRenderType(T animatable) {
            RenderType inner = super.getRenderType(animatable);
            return inner == null ? null : fogFree(inner);
        }
    }
}
`
}

function fixtureRenderer(packageName: string, glows: boolean) {
  return `package ${packageName}.client;

import ${packageName}.entity.${R.fixture};
import ${packageName}.entity.${R.table};
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.math.Axis;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.resources.ResourceLocation;
import software.bernie.geckolib.cache.object.BakedGeoModel;
import software.bernie.geckolib.model.GeoModel;
import software.bernie.geckolib.renderer.GeoEntityRenderer;

/** Generated by MineMods Studio (Boss 能力 12): an arena fixture, its model and its motion dark or lit${glows ? ", its glowing parts through the fog when they glow" : ""}. */
public final class ${R.renderer} extends GeoEntityRenderer<${R.fixture}> {
    public ${R.renderer}(EntityRendererProvider.Context context) {
        super(context, new GeoModel<${R.fixture}>() {
            @Override public ResourceLocation getModelResource(${R.fixture} fixture) {
                return ResourceLocation.fromNamespaceAndPath(${R.table}.MOD_ID, "geo/" + ${R.table}.NAMES[fixture.kind()] + ".geo.json");
            }
            @Override public ResourceLocation getTextureResource(${R.fixture} fixture) {
                return ResourceLocation.fromNamespaceAndPath(${R.table}.MOD_ID, "textures/entity/" + ${R.table}.NAMES[fixture.kind()] + ".png");
            }
            @Override public ResourceLocation getAnimationResource(${R.fixture} fixture) {
                return ResourceLocation.fromNamespaceAndPath(${R.table}.MOD_ID, "animations/" + ${R.table}.NAMES[fixture.kind()] + ".animation.json");
            }
        });
        this.shadowRadius = 0.4f;${glows ? "\n        addRenderLayer(new Lamp(this));" : ""}
    }

    // It is not alive: nothing turns it but the way it was put down.
    @Override protected void applyRotations(${R.fixture} fixture, PoseStack matrices, float ageInTicks, float rotationYaw, float partialTick, float nativeScale) {
        matrices.mulPose(Axis.YP.rotationDegrees(180.0f - fixture.getYRot()));
    }
${
  glows
    ? `
    /** Its glowing parts, through the fog, only when they glow now (always, or while it is lit). */
    private static final class Lamp extends ${R.client}.Glow<${R.fixture}> {
        Lamp(GeoEntityRenderer<${R.fixture}> renderer) {
            super(renderer);
        }

        @Override public void render(PoseStack pose, ${R.fixture} fixture, BakedGeoModel model, RenderType type, MultiBufferSource buffers, VertexConsumer buffer, float partialTick, int light, int overlay) {
            if (fixture.glows()) super.render(pose, fixture, model, type, buffers, buffer, partialTick, light, overlay);
        }
    }
`
    : ""
}}
`
}

function mixins(packageName: string, extendedFog: boolean) {
  return {
    fog: `package ${packageName}.mixin;

import ${packageName}.client.${R.client};
import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.client.Camera;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.FogRenderer;
import net.minecraft.util.Mth;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Generated by MineMods Studio (Boss 能力 12): a boss's fog for a player who stands in it. Once the game has set up its own fog for what it draws next (the sky, the world), the
 * fog is pulled in to the arena's visibility, never further out than the game's own; its colour turns grey toward the same brightness. Both by how far into the fog this frame is.
 */
@Mixin(FogRenderer.class)
public abstract class ${R.fog} {
    @Shadow private static float fogRed;
    @Shadow private static float fogGreen;
    @Shadow private static float fogBlue;

    @Inject(method = "setupFog", at = @At("RETURN"))
    private static void studio$fog(Camera camera, FogRenderer.FogMode mode, float distance, boolean thick, float partialTick, CallbackInfo info) {
        float amount = ${R.client}.amount(partialTick);
        if (amount <= 0.0f) return;
        float far = ${R.client}.visibility();
        float start = RenderSystem.getShaderFogStart();
        float end = RenderSystem.getShaderFogEnd();
        float near = mode == FogRenderer.FogMode.FOG_SKY ? 0.0f : far * ${single(NEAR)};
        RenderSystem.setShaderFogStart(Mth.lerp(amount, start, Math.min(start, near)));
        RenderSystem.setShaderFogEnd(Mth.lerp(amount, end, Math.min(end, ${extendedFog ? `${R.client}.fadeEnd()` : "far"})));
    }

    @Inject(method = "setupColor", at = @At("RETURN"))
    private static void studio$colour(Camera camera, float partialTick, ClientLevel level, int renderDistance, float darken, CallbackInfo info) {
        float amount = ${R.client}.amount(partialTick) * ${single(GREY)};
        if (amount <= 0.0f) return;
        float grey = fogRed * 0.3f + fogGreen * 0.59f + fogBlue * 0.11f;
        fogRed = Mth.lerp(amount, fogRed, grey);
        fogGreen = Mth.lerp(amount, fogGreen, grey);
        fogBlue = Mth.lerp(amount, fogBlue, grey * 1.04f);
        RenderSystem.clearColor(fogRed, fogGreen, fogBlue, 0.0f);
    }
}
`,
    hurt: `package ${packageName}.mixin;

import ${packageName}.entity.${R.server};
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.LivingEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/** Generated by MineMods Studio (Boss 能力 12): a blow in a boss's fog is scaled as the arena says (${R.server}.hurt), before anything else of the hurt reads it. */
@Mixin(LivingEntity.class)
public abstract class ${R.hurt} {
    @ModifyVariable(method = "hurt", at = @At("HEAD"), argsOnly = true)
    private float studio$fog(float amount, DamageSource source) {
        return ${R.server}.hurt((LivingEntity) (Object) this, source, amount);
    }
}
`,
  }
}

/** Fabric 1.21.1: the fog's packet is a payload of its own, registered by the server class's entry point (`StudioFixtures` registers the type) and received by the client class's. */
function fabricSources(packageName: string, modId: string, warned: boolean, shared: SharedBuiltin | undefined, fixtureControls: boolean, lighting: boolean, terrainInteractions: boolean, safeMesh: boolean, extendedFog: boolean, returnOffset: boolean, untouched: boolean) {
  return {
    server: arenaServer(packageName, modId, warned, shared, fixtureControls, lighting, terrainInteractions, safeMesh, {
      imports: `import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.PlayerLookup;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
`,
      implementsInit: " implements ModInitializer",
      members: `    /** Whether a player stands in a boss's fog, how far they see in it, and the ticks it takes to come or go. */
    public record Fog(boolean on, float visibility, int fade${extendedFog ? ", float fadeEnd" : ""}) implements CustomPacketPayload {
        public static final Type<Fog> ID = new Type<>(ResourceLocation.fromNamespaceAndPath(${JSON.stringify(modId)}, ${JSON.stringify(R.packet)}));
        public static final StreamCodec<RegistryFriendlyByteBuf, Fog> CODEC = StreamCodec.composite(ByteBufCodecs.BOOL, Fog::on, ByteBufCodecs.FLOAT, Fog::visibility, ByteBufCodecs.VAR_INT, Fog::fade${extendedFog ? ", ByteBufCodecs.FLOAT, Fog::fadeEnd" : ""}, Fog::new);
        @Override public Type<? extends CustomPacketPayload> type() { return ID; }
    }

    /** A boss (by its id) back from a leave, at where it is back. */
    public record Back(int id, double x, double y, double z) implements CustomPacketPayload {
        public static final Type<Back> ID = new Type<>(ResourceLocation.fromNamespaceAndPath(${JSON.stringify(modId)}, ${JSON.stringify(R.backPacket)}));
        public static final StreamCodec<RegistryFriendlyByteBuf, Back> CODEC = StreamCodec.composite(ByteBufCodecs.VAR_INT, Back::id, ByteBufCodecs.DOUBLE, Back::x, ByteBufCodecs.DOUBLE, Back::y, ByteBufCodecs.DOUBLE, Back::z, Back::new);
        @Override public Type<? extends CustomPacketPayload> type() { return ID; }
    }

    // Fabric builds a main entrypoint through its no-argument constructor, which must be public.
    public ${R.server}() {}

    @Override public void onInitialize() {${lighting ? "\n        StudioFixtureLight.register();" : ""}
        // Both sides know the packet; only the server sends it. Fights end at the end of every server tick when their boss did not tick.
        PayloadTypeRegistry.playS2C().register(Fog.ID, Fog.CODEC);
        PayloadTypeRegistry.playS2C().register(Back.ID, Back.CODEC);
        ServerTickEvents.END_SERVER_TICK.register(${R.server}::tick);
    }
`,
      send: `        // A player whose game does not have this mod is skipped: the game would refuse the packet.
        if (ServerPlayNetworking.canSend(player, Fog.ID)) ServerPlayNetworking.send(player, new Fog(foggy, spec.visibility(), spec.fade()${extendedFog ? ", spec.fadeEnd()" : ""}));`,
      sendBack: `        for (ServerPlayer seeing : PlayerLookup.tracking(boss)) if (ServerPlayNetworking.canSend(seeing, Back.ID)) ServerPlayNetworking.send(seeing, new Back(boss.getId(), x, y, z));`,
    }, extendedFog, returnOffset, untouched),
    client: arenaClient(packageName, {
      imports: `import ${packageName}.entity.${R.server};
import ${packageName}.entity.${R.table};
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
`,
      implementsInit: " implements ClientModInitializer",
      register: `    @Override public void onInitializeClient() {
        ClientPlayNetworking.registerGlobalReceiver(${R.server}.Fog.ID, (payload, context) -> context.client().execute(() -> told(payload.on(), payload.visibility(), payload.fade()${extendedFog ? ", payload.fadeEnd()" : ""})));
        ClientPlayNetworking.registerGlobalReceiver(${R.server}.Back.ID, (payload, context) -> context.client().execute(() -> back(payload.id(), payload.x(), payload.y(), payload.z())));
        ClientTickEvents.END_CLIENT_TICK.register(client -> tick());
        EntityRendererRegistry.register(${R.table}.TYPE, ${R.renderer}::new);
    }

`,
    }, extendedFog),
  }
}

/** A facade target (Forge, NeoForge): the fog's packet is a plain record on a channel of the facade, made when `StudioArena` loads; its tick and receiver through the facade. */
function facadeSources(packageName: string, modId: string, warned: boolean, shared: SharedBuiltin | undefined, fixtureControls: boolean, lighting: boolean, terrainInteractions: boolean, safeMesh: boolean, extendedFog: boolean, returnOffset: boolean, untouched: boolean) {
  return {
    server: arenaServer(packageName, modId, warned, shared, fixtureControls, lighting, terrainInteractions, safeMesh, {
      imports: `import ${packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import net.minecraft.network.FriendlyByteBuf;
`,
      implementsInit: "",
      members: `    /** Whether a player stands in a boss's fog, how far they see in it, and the ticks it takes to come or go. */
    public record Fog(boolean on, float visibility, int fade${extendedFog ? ", float fadeEnd" : ""}) {
        static void write(Fog fog, FriendlyByteBuf buffer) {
            buffer.writeBoolean(fog.on);
            buffer.writeFloat(fog.visibility);
            buffer.writeVarInt(fog.fade);${extendedFog ? "\n            buffer.writeFloat(fog.fadeEnd);" : ""}
        }

        static Fog read(FriendlyByteBuf buffer) {
            return new Fog(buffer.readBoolean(), buffer.readFloat(), buffer.readVarInt()${extendedFog ? ", buffer.readFloat()" : ""});
        }
    }

    /** A boss (by its id) back from a leave, at where it is back. */
    public record Back(int id, double x, double y, double z) {
        static void write(Back back, FriendlyByteBuf buffer) {
            buffer.writeVarInt(back.id);
            buffer.writeDouble(back.x);
            buffer.writeDouble(back.y);
            buffer.writeDouble(back.z);
        }

        static Back read(FriendlyByteBuf buffer) {
            return new Back(buffer.readVarInt(), buffer.readDouble(), buffer.readDouble(), buffer.readDouble());
        }
    }

    /** Both sides know the packets; only the server sends them and only a player's game reads them. */
    public static final ${PLATFORM_CLASS}.Channel<Fog> CHANNEL = ${PLATFORM_CLASS}.s2c(${JSON.stringify(R.packet)}, Fog.class, Fog::write, Fog::read);
    public static final ${PLATFORM_CLASS}.Channel<Back> BACK = ${PLATFORM_CLASS}.s2c(${JSON.stringify(R.backPacket)}, Back.class, Back::write, Back::read);

    private ${R.server}() {}

    /** Run by the fixtures' table while the mod is constructed: makes the channel (its field above) and ends fights whose boss did not tick, at the end of every server tick. */
    static void register() {${lighting ? "\n        StudioFixtureLight.register();" : ""}
        ${PLATFORM_CLASS}.onServerTick(${R.server}::tick);
    }
`,
      send: `        CHANNEL.sendTo(player, new Fog(foggy, spec.visibility(), spec.fade()${extendedFog ? ", spec.fadeEnd()" : ""}));`,
      sendBack: "        BACK.sendTracking(boss, new Back(boss.getId(), x, y, z));",
    }, extendedFog, returnOffset, untouched),
    client: arenaClient(packageName, {
      imports: `import ${packageName}.entity.${R.server};
import ${packageName}.entity.${R.table};
import ${packageName}.${PLATFORM_PACKAGE}.${CLIENT_PLATFORM_CLASS};
`,
      implementsInit: "",
      register: `    /** Run once by the client entry: what this player's game does with the fog it is told, its easing every client tick, and how a fixture is drawn. */
    public static void register() {
        ${CLIENT_PLATFORM_CLASS}.onS2C(${R.server}.CHANNEL, fog -> told(fog.on(), fog.visibility(), fog.fade()${extendedFog ? ", fog.fadeEnd()" : ""}));
        ${CLIENT_PLATFORM_CLASS}.onS2C(${R.server}.BACK, packet -> back(packet.id(), packet.x(), packet.y(), packet.z()));
        ${CLIENT_PLATFORM_CLASS}.onClientTick(${R.client}::tick);
        ${CLIENT_PLATFORM_CLASS}.renderer(${R.table}.TYPE, ${R.renderer}::new);
    }

`,
    }, extendedFog),
  }
}

/**
 * `target`: Fabric 1.21.1 (the default) registers the packet, the tick and the fixtures' type with Fabric API and names its entry points in fabric.mod.json; a facade target
 * does it through the facade from its entries (`entries`), every class mapped to its game version. The mixins go into the template's list on every target: the fog in its
 * client section, the hurt in its common one.
 */
export function compileArena(value: z.input<typeof Input>, target: GenTarget = FABRIC_TARGET) {
  const input = Input.parse(value)
  const controls = input.fixtureLighting || input.fixtureControls || input.fixtures.some(asset => asset.document.play.ember !== undefined)
  const facade = target.loader.facade
  const version = target.version
  const source = `src/main/java/${input.packageName.replaceAll(".", "/")}`
  const resources = `src/main/resources/assets/${input.modId}`
  const pack = input.packageName.replaceAll(".", "/")
  // By asset id, so the number a fixture has does not depend on the order assets were saved in.
  const fixtures = [...input.fixtures].sort((left, right) => left.id.localeCompare(right.id))
  const built = fixtures.map((fixture) => {
    const name = fixtureName(fixture.id)
    const compiled = fitModelAtlas(fixtureModel(fixture.document), name)
    const keep = new Set([fixture.document.play.unlit, fixture.document.play.lit, fixture.document.play.ember].map((clip) => `animation.${name}.${clip}`))
    const animation = { ...compiled.animation, animations: Object.fromEntries(Object.entries(compiled.animation.animations).filter(([key]) => keep.has(key))) }
    const clipOf = (clip: string) => ({ name: clip, loop: Boolean(fixture.document.animations.find((animation) => animation.name === clip)?.loop) })
    const box = fixtureBox(fixture.document)
    const made: Made = { id: fixture.id, title: fixture.title, name, unlit: clipOf(fixture.document.play.unlit), lit: clipOf(fixture.document.play.lit), ember: clipOf(fixture.document.play.ember ?? fixture.document.play.unlit), glow: { none: 0, lit: 1, always: 2 }[fixture.document.play.glow], width: box.width, height: box.height }
    return { made, compiled, animation }
  })
  // The glow layer looks for a mask beside every texture it draws, so once one fixture glows each of them has one: an empty picture glows nowhere.
  const glows = built.some((entry) => entry.compiled.glow && entry.made.glow > 0)
  const width = (entry: (typeof built)[number]) => entry.compiled.geometry["minecraft:geometry"][0]!.description.texture_width
  const network = facade ? facadeSources(input.packageName, input.modId, input.warned, input.sharedBuiltin, controls, input.fixtureLighting, input.terrainInteractions, input.safeMesh, input.extendedFog, input.returnOffset, input.fixtureUntouched) : fabricSources(input.packageName, input.modId, input.warned, input.sharedBuiltin, controls, input.fixtureLighting, input.terrainInteractions, input.safeMesh, input.extendedFog, input.returnOffset, input.fixtureUntouched)
  const mixed = mixins(input.packageName, input.extendedFog)
  // A project whose arenas put down no fixture still has the table (empty) and the type: the arena's runtime is one piece.
  const made = built.length ? built.map((entry) => entry.made) : []
  const written: Record<string, string> = {
    [`${source}/entity/${R.server}.java`]: input.fogCondition ? network.server.replace("    public static void fog(Mob boss)", "    public static boolean fogActive(Mob boss) { Fight f = FIGHTS.get(boss.getUUID()); return f != null && f.fog; }\n\n    public static void fog(Mob boss)") : network.server,
    [`${source}/entity/${R.fixture}.java`]: fixtureSource(input.packageName, controls, !!input.sharedBuiltin?.particle.some(key => key === "fixture_lit" || key === "fixture_ember"), !!input.sharedBuiltin?.particle.includes("fixture_effect")),
    [`${source}/entity/${R.table}.java`]: fixtureTable(input.packageName, input.modId, made, facade, controls),
    [`${source}/client/${R.client}.java`]: network.client,
    [`${source}/client/${R.renderer}.java`]: fixtureRenderer(input.packageName, glows),
    [`${source}/mixin/${R.fog}.java`]: mixed.fog,
    [`${source}/mixin/${R.hurt}.java`]: mixed.hurt,
  }
  if (input.fixtureLighting) {
    written[`${source}/entity/StudioFixtureLight.java`] = fixtureLightSource(input.packageName, input.modId, target.manifest.loader.kind)
  }
  if (facade) {
    written[`${source}/entity/${R.fixture}.java`] = version.body.plainEntity(written[`${source}/entity/${R.fixture}.java`]!)
    written[`${source}/client/${R.renderer}.java`] = version.body.rotations(written[`${source}/client/${R.renderer}.java`]!)
  }
  const java = facade ? Object.fromEntries(Object.entries(written).map(([name, text]) => [name, version.rewriteJava(text)])) : written
  const files: Record<string, string | Uint8Array> = {
    ...java,
    ...(input.fixtureLighting ? {
      [`${resources}/blockstates/minemods_internal/fixture_light.json`]: JSON.stringify({ variants: { "": { model: `${input.modId}:block/minemods_internal/fixture_light` } } }),
      [`${resources}/models/block/minemods_internal/fixture_light.json`]: JSON.stringify({ textures: { particle: "minecraft:block/glass" }, elements: [] }),
    } : {}),
    ...Object.assign(
      {},
      ...built.map((entry) => ({
        [`${resources}/geo/${entry.made.name}.geo.json`]: JSON.stringify(entry.compiled.geometry, null, 2),
        [`${resources}/animations/${entry.made.name}.animation.json`]: JSON.stringify(entry.animation, null, 2),
        [`${resources}/textures/entity/${entry.made.name}.png`]: entry.compiled.png,
        ...(glows ? { [glowMaskPath(`${resources}/textures/entity/${entry.made.name}.png`)]: entry.compiled.glow ?? encodePng(new Uint8Array(width(entry) * width(entry) * 4), width(entry), width(entry)) } : {}),
      })),
    ),
  }
  const edit = (text: string, change: (value: Record<string, unknown>) => Record<string, unknown>) => {
    const edited = `${JSON.stringify(change(z.record(z.string(), z.unknown()).parse(JSON.parse(text))), null, 2)}\n`
    return text.includes("\r\n") ? edited.replaceAll("\n", "\r\n") : edited
  }
  const mixinList = `src/main/resources/${input.modId}.mixins.json`
  return {
    files,
    language: {
      zh_cn: { ...(controls ? { [`message.${input.modId}.fixture.stays`]: "物件已亮起，持续到下次切换" } : {}), [`entity.${input.modId}.${R.registry}`]: "场地物件", [`message.${input.modId}.fixture.lighting`]: "点亮中 %s", [`message.${input.modId}.fixture.lit`]: "点亮了：%s 秒里周围没有雾", [`message.${input.modId}.fixture.lit_already`]: "已经亮着（还有 %s 秒）", [`message.${input.modId}.fixture.cooling`]: "还要等 %s 秒才能再点亮" },
      en_us: { ...(controls ? { [`message.${input.modId}.fixture.stays`]: "Lit until its next change" } : {}), [`entity.${input.modId}.${R.registry}`]: "Arena fixture", [`message.${input.modId}.fixture.lighting`]: "Lighting %s", [`message.${input.modId}.fixture.lit`]: "Lit: no fog around it for %s s", [`message.${input.modId}.fixture.lit_already`]: "Already lit (%s s left)", [`message.${input.modId}.fixture.cooling`]: "Can be lit again in %s s" },
    },
    /** Paths inside the built jar that prove the arena went in. */
    classes: [`${pack}/entity/${R.server}.class`, `${pack}/entity/${R.fixture}.class`, `${pack}/entity/${R.table}.class`, `${pack}/client/${R.client}.class`, `${pack}/mixin/${R.fog}.class`, `${pack}/mixin/${R.hurt}.class`],
    /**
     * Edits to files the scaffold wrote: the fog's mixin in the template's list's client section, the hurt's in its common one; on Fabric the server class and the fixtures'
     * table are main entry points and the client class a client one.
     */
    patch: (facade
      ? { [mixinList]: (text: string) => target.loader.addMixins(text, { common: [R.hurt], client: [R.fog] }) }
      : {
          "src/main/resources/fabric.mod.json": (text: string) =>
            edit(text, (metadata) => {
              const entrypoints = z.looseObject({ main: z.array(z.string()), client: z.array(z.string()).default([]) }).parse(metadata.entrypoints)
              return { ...metadata, entrypoints: { ...entrypoints, main: [...entrypoints.main, `${input.packageName}.entity.${R.table}`, `${input.packageName}.entity.${R.server}`], client: [...entrypoints.client, `${input.packageName}.client.${R.client}`] } }
            }),
          [mixinList]: (text: string) =>
            edit(text, (list) => ({ ...list, mixins: [...z.array(z.string()).default([]).parse(list.mixins), R.hurt], client: [...z.array(z.string()).default([]).parse(list.client), R.fog] })),
        }) as Record<string, (text: string) => string>,
    /** What a facade target's common entry and client entry run (`<class>.register()`). */
    entries: { common: facade ? [`${input.packageName}.entity.${R.table}`] : [], client: facade ? [`${input.packageName}.client.${R.client}`] : [] },
  }
}
