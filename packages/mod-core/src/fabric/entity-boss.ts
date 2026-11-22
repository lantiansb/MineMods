import { rangedSound } from "../sound-range"
import { builtinParticle, builtinSound } from "../common/builtin"
import { soundConstant } from "../data-words"
import { BOSS_LIMITS, BOSS_STATES } from "../boss-words"
import type { BossPlan } from "../creature-boss"
import type { Boss } from "../entity-runtime"
import { bossWeatherJava, stanceAmbience } from "./boss-weather"
import type { BossLookPlan } from "../boss-look-words"
import type { DropPlace } from "../boss-look"
import { BOSS_LOOK_RUNTIME } from "./boss-look"
import { bossArenaJava } from "./arena"
import type { Ability } from "../entity-runtime"
import type { BossShowSource } from "./boss-show"
import { bossBaseJava } from "./boss-base"

/**
 * A boss as the Java its creature's class carries (boss runtime, 10-12): a bar, a wake-up, phases, a death that is played out, and a leash.
 * Everything is decided on the server; players' games are told one synced number (the state in the low four bits, the phase above them) and
 * the experience bar the game's own `ServerBossEvent` sends. The numbers are the document's, turned into ticks and masks once (`bossPlan`).
 * Nothing here is replaced that the game does by itself: not moving is the game's own `isImmobile` (it stops every goal and every target
 * search), not being hurt is its own `isInvulnerableTo`, the bar is its own bar, and the experience is its own orbs.
 * Every Minecraft and GeckoLib name used here is Mojang's own (Fabric Loom's official mappings), read with javap from the 1.21.1 jar and GeckoLib 4.8.3.
 * Without a boss every piece is the empty string, so such a creature's class is what it always was.
 * A wake-up composes with the rest of the creature: with habits it is "not yet met" while it sleeps (it rests when its habits say rest and lives its habits when they say it is up, but picks no fight
 * and takes no target until somebody comes within the wake distance), and a boss that flies shows itself in the air (the flight takes it up and round the one who woke it). A boss whose phases are faster
 * makes its flight faster too (`bossSpeedScale`, read by the flight). Every one of these is written only for a boss that has the thing it composes with: any other boss is what it always was.
 */

const real = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(4))))
const list = (values: readonly (number | boolean | string)[]) => `{${values.join(", ")}}`
const BAR_COLOR = (color: string) => `BossEvent.BossBarColor.${color.toUpperCase()}`
const BAR_STYLE = (style: string) => `BossEvent.BossBarOverlay.${style.toUpperCase()}`

/** The statement that registers the boss's synced value, in the creature's `defineSynchedData`. */
export const BOSS_TRACKER = "        builder.define(BOSS, BOSS_START);\n"

/** Boss 能力 10: the statement that registers which parts of a boss have come off, beside `BOSS_TRACKER`, for a boss whose model changes. */
export const BOSS_LOOK_TRACKER = "        builder.define(BOSS_DROPPED, 0);\n"

/**
 * Boss 能力 10: the Java of a boss whose model changes with its phases, as tables from its plan (`bossLookPlan`) and the places its parts come off from (`bossDropPlaces`).
 * Every player's game reads the stage it is in (the synced phase) and which parts have come off (`BOSS_DROPPED`) and hides those bones itself; how bright each glowing
 * picture is, it counts itself from when it saw the stage begin. Empty pieces for a boss whose model never changes.
 */
export function bossLookSource(entity: string, model: string, look: { plan: BossLookPlan; places: { phases: DropPlace[][]; abilities: DropPlace[] } } | null | undefined, boss = true) {
  if (!look) return { fields: "", methods: "", change: "", reset: "", nbtWrite: "", nbtRead: "" }
  const { plan, places } = look
  const float = (value: number) => `${real(value)}f`
  const drops = plan.phaseDrops.some((value) => value.length) || plan.abilityDrops.length > 0
  const glows = plan.slots.length > 0
  const phase = boss ? "bossPhase()" : "0"
  const stances = plan.stances
  const stanceGlow = stances?.some(row => row.glow)
  const at = (place: DropPlace) => (place ? [place.from.forward, place.from.up, place.from.left, place.rest.forward, place.rest.up, place.rest.left] : [0, 0, 0, 0, 0, 0]).map(float).join(", ")
  return {
    fields: `    // ---- Boss 能力 10: its model in each stage of the fight (0 before the first line). Which of BOSS_BONES (a bit each) have come off in this fight, for every player's game ----
    private static final EntityDataAccessor<Integer> BOSS_DROPPED = SynchedEntityData.defineId(${entity}.class, EntityDataSerializers.INT);
    private static final String[] BOSS_BONES = {${plan.bones.map((bone) => JSON.stringify(bone)).join(", ")}};
    // Per stage: the bones its phases hide (what has come off is BOSS_DROPPED, apart).
    private static final int[] BOSS_HIDDEN = ${list(plan.hidden)};
${stances ? `    private static final int[] STANCE_HIDE = ${list(stances.map(row => row.hide))};
    private static final int[] STANCE_SHOW = ${list(stances.map(row => row.show))};
${plan.textures.length ? `    private static final int[] STANCE_TEXTURE = ${list(stances.map(row => row.texture))};
` : ""}${stanceGlow ? `    private static final int[] STANCE_GLOW_SLOT = ${list(stances.map(row => row.glow?.slot ?? -1))};
    private static final int[] STANCE_GLOW_TICKS = ${list(stances.map(row => row.glow?.ticks ?? 0))};
    private static final float[] STANCE_GLOW_FROM = {${stances.map(row => float(row.glow?.from ?? 0)).join(", ")}};
    private static final float[] STANCE_GLOW_TO = {${stances.map(row => float(row.glow?.to ?? 0)).join(", ")}};
    private int stanceLookSerial = -1, stanceLookSince;
` : ""}` : ""}${
  plan.textures.length
    ? `    // Per stage: the texture it wears, 0 its model's own, then those its phases put on (as its renderer lists them).
    private static final int[] BOSS_TEXTURE = ${list(plan.texture)};
`
    : ""
}${
  glows
    ? `    // Per stage and glowing picture: how bright it is when the stage begins, how bright it ends, and the ticks between.
    private static final float[][] BOSS_GLOW_FROM = {${plan.glow.map((stage) => `{${stage.map((slot) => float(slot.from)).join(", ")}}`).join(", ")}};
    private static final float[][] BOSS_GLOW_TO = {${plan.glow.map((stage) => `{${stage.map((slot) => float(slot.to)).join(", ")}}`).join(", ")}};
    private static final int[][] BOSS_GLOW_TICKS = {${plan.glow.map((stage) => `{${stage.map((slot) => slot.ticks).join(", ")}}`).join(", ")}};
    // Counted in a player's game: the stage it last saw and the age at which it saw it begin.
    private int bossLookStage = -1;
    private int bossLookSince;
`
    : ""
}${
  plan.phaseDrops.some((value) => value.length)
    ? `    // Per phase (0 is the first line): the parts that come off when it begins, {bone, ticks} each, and the places they come off from ({forward, up, left} now, then on the model as built, blocks).
    private static final int[][] BOSS_PHASE_DROPS = {${plan.phaseDrops.map((value) => `{${value.flatMap((drop) => [drop.bone, drop.ticks]).join(", ")}}`).join(", ")}};
    private static final float[][] BOSS_PHASE_DROP_PLACES = {${places.phases.map((value) => `{${value.map(at).join(", ")}}`).join(", ")}};
`
    : ""
}`,
    methods: `    /** Boss 能力 10: the bones of its model its phases and drops change, for its renderer (a bit each in \`bossHiddenBones\`). */
    public String[] bossBones() { return BOSS_BONES; }

    /** The bones hidden now: its stage's, and those that have come off. Read by its renderer, in every player's game. */
    public int bossHiddenBones() { ${stances ? `int stance = stanceIndex(); return ((BOSS_HIDDEN[Math.min(${phase}, BOSS_HIDDEN.length - 1)] | STANCE_HIDE[stance]) & ~STANCE_SHOW[stance])` : "return BOSS_HIDDEN[Math.min(bossPhase(), BOSS_HIDDEN.length - 1)]"} | getEntityData().get(BOSS_DROPPED); }
${
  plan.textures.length
    ? `
    /** The texture it wears now, 0 its model's own: its stage's, put on as the stage begins. Read by its renderer, in every player's game. */
    public int bossTexture() { ${stances ? "int texture = STANCE_TEXTURE[stanceIndex()]; if (texture >= 0) return texture; " : ""}return BOSS_TEXTURE[Math.min(${phase}, BOSS_TEXTURE.length - 1)]; }
`
    : ""
}${
  glows
    ? `
    /** How bright glowing picture \`slot\` is now (0 not at all, 1 fully), in this player's game: a stage seen from its beginning fades as written, one first seen half way through is where it ends. */
    public float bossGlow(int slot, float partialTick) {
        int stage = Math.min(${phase}, BOSS_GLOW_FROM.length - 1);
        if (stage != bossLookStage) {
            bossLookSince = bossLookStage < 0 ? tickCount - 1000000 : tickCount;
            bossLookStage = stage;
        }
${stanceGlow ? `        int serial = getEntityData().get(STANCE) >>> 5;
        if (serial != stanceLookSerial) {
            stanceLookSince = stanceLookSerial < 0 ? tickCount - 1000000 : tickCount;
            stanceLookSerial = serial;
        }
        int stance = stanceIndex();
        if (STANCE_GLOW_SLOT[stance] == slot) {
            int ticks = STANCE_GLOW_TICKS[stance];
            float done = ticks <= 0 ? 1.0f : Mth.clamp((tickCount - stanceLookSince + partialTick) / ticks, 0.0f, 1.0f);
            return Mth.lerp(done, STANCE_GLOW_FROM[stance], STANCE_GLOW_TO[stance]);
        }
` : ""}        int ticks = BOSS_GLOW_TICKS[stage][slot];
        float done = ticks <= 0 ? 1.0f : Mth.clamp((tickCount - bossLookSince + partialTick) / ticks, 0.0f, 1.0f);
        return Mth.lerp(done, BOSS_GLOW_FROM[stage][slot], BOSS_GLOW_TO[stage][slot]);
    }
`
    : ""
}${
  drops
    ? `
    /**
     * A part comes off, unless it already has: from now on in this fight it is hidden, and it falls where it is (\`forward\`, \`up\`, \`left\` of its feet in its own terms), drawn as the
     * model is built about the same place there (\`restForward\`…). It lies \`ticks\` ticks. On the server.
     */
    private void bossDrop(int bone, int ticks, float forward, float up, float left, float restForward, float restUp, float restLeft) {
        if (level().isClientSide()) return;
        int dropped = getEntityData().get(BOSS_DROPPED);
        if ((dropped & (1 << bone)) != 0) return;
        getEntityData().set(BOSS_DROPPED, dropped | (1 << bone));
        ${BOSS_LOOK_RUNTIME.entity}.drop(this, ${JSON.stringify(model)}, BOSS_BONES[bone], ticks, forward, up, left, restForward, restUp, restLeft);
    }
`
    : ""
}${
  plan.phaseDrops.some((value) => value.length)
    ? `
    /** The parts phase \`phase\` drops as it begins. */
    private void bossDropPhase(int phase) {
        int[] drops = BOSS_PHASE_DROPS[phase - 1];
        float[] at = BOSS_PHASE_DROP_PLACES[phase - 1];
        for (int index = 0; index < drops.length / 2; index++)
            bossDrop(drops[index * 2], drops[index * 2 + 1], at[index * 6], at[index * 6 + 1], at[index * 6 + 2], at[index * 6 + 3], at[index * 6 + 4], at[index * 6 + 5]);
    }
`
    : ""
}${
  plan.abilityDrops.length
    ? `
    /** The part an ability's drop event (ability \`ability\`, its event \`event\`) makes come off. */
    private void bossDropAt(int ability, int event) {
${plan.abilityDrops.map((drop, index) => `        if (ability == ${drop.ability} && event == ${drop.event}) bossDrop(${drop.bone}, ${drop.ticks}, ${at(places.abilities[index] ?? null)});`).join("\n")}
    }
`
    : ""
}
`,
    change: plan.phaseDrops.some((value) => value.length) ? "\n        bossDropPhase(phase);" : "",
    reset: "        // Whatever came off grows back for the next fight.\n        getEntityData().set(BOSS_DROPPED, 0);\n",
    nbtWrite: '\n        nbt.putInt("BossDropped", getEntityData().get(BOSS_DROPPED));',
    nbtRead: '\n            getEntityData().set(BOSS_DROPPED, nbt.getInt("BossDropped"));',
  }
}

/** What is done once a flying boss has flown home and been set down there: it is asleep again (or fighting fresh), in its first phase. */
export const BOSS_ARRIVED = "bossSet(BOSS_START, 0);\n        bossApply(0);"

const none = { imports: "", fields: "", trackerMethod: "", methods: "", tick: "", controller: "", shown: "", nbtWrite: "", nbtRead: "", nbtMethods: "", despawnKept: false }

export function compileBoss(input: {
  stances?: import("../entity-runtime").Stances
  stanceColors?: readonly (string | undefined)[]
  restoreTerrain?:boolean
  builtin?: import("../builtin").Builtin
  stagger?: boolean
  entity: string
  model: string
  boss: Boss | null | undefined
  phaseSounds?: readonly ({ event: string; source: string; volume?: number } | null)[]
  plan: BossPlan | null
  /** The creature's own movement speed and attack damage: each phase multiplies them. */
  speed: number
  damage: number
  /** The creature's own tracker method is written by its abilities; the boss writes one only when they are not there. */
  trackerElsewhere: boolean
  /** The statement that cuts a running ability short, or "" when there are no abilities. */
  interrupt: string
  /** The creature's explosion already writes its own NBT methods: the boss's lines join them. */
  nbtElsewhere: boolean
  /** The creature flies: a leash sends it flying home and it is set down there (`flightComeHome`), instead of being put there at once. */
  flier?: boolean
  /** What the flight and the habits keep beside the boss: their synced values and their saved lines (the boss writes the methods that hold them when nothing else does). */
  extra?: { tracker: string; nbtWrite: string; nbtRead: string }
  /**
   * The creature has habits: a boss with a wake-up that has them is not frozen while it sleeps if its habits say it is up. `resting` is the expression that is true while they say rest (null: they never do,
   * `always`), `alert` whether they hold an alert goal whose pending warning the wake-up cancels.
   */
  habits?: { resting: string | null; alert: boolean } | null
  /**
   * Boss 能力 6: the boss shows a bar of its own (`boss.bar.look: { asset }`). `creature`: its registry path (the key of its masks and layout); `running` and `step`: the Java
   * expressions of the choice it is running (its abilities, then its combos, by place; -1 none) and, inside a combo, the ability that step plays (-1 none). Left out: none of
   * the bar's lines are written, so any other boss is the Java it always was.
   */
  bar?: { creature: string; running: string; step: string } | null
  /**
   * Boss 能力 10: its model changes with its phases (`bossLookPlan`), with where each part it drops comes off (`bossDropPlaces`). Left out: none of these lines are written,
   * so any other boss is the Java it always was. `model` (above) is then also the registry path its dropped parts draw the model of.
   */
  look?: { plan: BossLookPlan; places: { phases: DropPlace[][]; abilities: DropPlace[] } } | null
  /**
   * Boss 能力 12、13: the creature's abilities (whose fog, leave and hits over the arena need the arena too) and the Java expression that is true while one runs. Left out, or a boss
   * without an arena and none of those: none of the arena's lines are written, so any other boss is the Java it always was.
   */
  arena?: { abilities: readonly Ability[]; running: string } | null
  /** Boss 能力 15: its wake-up's and its death's timed steps (`fabric/boss-show.ts`). Left out: none of these lines are written, so any other boss is the Java it always was. */
  show?: BossShowSource | null
  /** The creature's own most life: what every boss of a big boss mod has multiplies it for more players (`fabric/boss-base.ts`). Left out: 20, the game's own. */
  health?: number
}) {
  const boss = input.boss
  const plan = input.plan
  if (!boss || !plan) return none
  const deathDelay = boss.leash?.reset_after_death_seconds
  const finish = boss.phases.some(phase => phase.finish?.length)
  const tailTicks = Math.max(0,...boss.phases.flatMap(p=>(p.finish??[]).map(s=>s.type==="particle" ? Math.round((s.until??0)*20):0)))
  const intro = boss.intro
  // A named first attack (`intro.opening`): written only then, so a boss without one is the Java it always was.
  const opening = intro ? plan.opening : null
  // The fight begins when the wake-up is over; a boss with a first attack also starts that attack's clock and arms it again there.
  const begin = opening ? "bossBegin();" : "bossSet(BOSS_FIGHT, 0);"
  const phases = plan.phases
  // A boss that has not met anyone yet and has habits lives by them (written only then); one that flies and has a wake-up shows itself in the air; a flier whose phases are faster flies faster in them.
  const habits = input.habits ?? null
  const lives = Boolean(intro && habits)
  const flies = Boolean(intro && input.flier)
  const paced = Boolean(input.flier && boss.phases.some((phase) => phase.speed > 1))
  const colors = boss.phases.reduce<string[]>((all, phase) => [...all, phase.bar_color ?? all[all.length - 1]!], [boss.bar.color])
  const clip = (name: string | null) => (name === null ? "null" : `RawAnimation.begin().thenPlay("animation.${input.model}.${name}")`)
  const anyClip = Boolean(intro?.clip) || boss.phases.some((phase) => phase.clip)
  const interrupt = input.interrupt ? `\n        ${input.interrupt}` : ""
  const state = BOSS_STATES
  const sound = intro?.sound ? rangedSound(`SoundEvents.${soundConstant(intro.sound)}`,intro.range_blocks) : null
  const bursts = plan.bursts
  const ownBar = input.bar ?? null
  // Boss 能力 7: the weather of its phases (`bossWeatherJava`); nothing for a boss without one.
  const weather = bossWeatherJava(boss, input.stances, Boolean(input.show?.weatherTick))
  const look = bossLookSource(input.entity, input.model, input.look)
  // Boss 能力 12、13: its arena (fabric/arena.ts); empty pieces for a boss without one.
  const arena = bossArenaJava(boss, input.arena?.abilities ?? [], input.arena?.running ?? "false")
  const show = input.show ?? null
  // What every boss of a big boss mod has (fabric/boss-base.ts): the caps, its life coming back, more for more players; empty pieces for a boss without them.
  const base = bossBaseJava(boss, input.health ?? 20)
  // What is saved: where it is in the fight, where it began, and the experience it still has to give out.
  const nbtWrite = `
        nbt.putInt("BossState", bossState());
        nbt.putInt("BossPhase", bossPhase());
        nbt.putInt("BossTimer", bossTimer);
        nbt.putBoolean("BossHomeSet", bossHomeSet);
        nbt.putDouble("BossHomeX", bossHomeX);
        nbt.putDouble("BossHomeY", bossHomeY);
        nbt.putDouble("BossHomeZ", bossHomeZ);
        nbt.putInt("BossXp", bossXp);${base.nbtWrite}${look.nbtWrite}${opening ? '\n        nbt.putBoolean("BossOpened", bossOpened);\n        // epic r3 review: the age starts again from 0 when the world is loaded again, so what is kept is how long it has already waited for its first attack.\n        nbt.putInt("BossOpenWaited", Mth.clamp(tickCount - bossFightAt, 0, BOSS_OPENING_TICKS + 1));' : ""}`
  // Whatever was saved is kept in range; a wake-up the document no longer has is not one any more.
  const nbtRead = `
        if (nbt.contains("BossState")) {
            bossSet(Mth.clamp(nbt.getInt("BossState"), ${intro ? "BOSS_DORMANT" : "BOSS_FIGHT"}, BOSS_CHANGE), Mth.clamp(nbt.getInt("BossPhase"), 0, BOSS_BELOW.length));
            bossTimer = Math.max(0, nbt.getInt("BossTimer"));
            bossHomeSet = nbt.getBoolean("BossHomeSet");
            bossHomeX = nbt.getDouble("BossHomeX");
            bossHomeY = nbt.getDouble("BossHomeY");
            bossHomeZ = nbt.getDouble("BossHomeZ");
            bossXp = Math.max(0, nbt.getInt("BossXp"));${base.nbtRead}${look.nbtRead}${opening ? '\n            bossOpened = nbt.getBoolean("BossOpened");\n            bossFightAt = tickCount - Mth.clamp(nbt.getInt("BossOpenWaited"), 0, BOSS_OPENING_TICKS + 1);' : ""}
        }`
  return {
    // Each import only where what it names is used: the class carries none it does not use.
    imports: `import net.minecraft.network.chat.Component;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.server.level.ServerBossEvent;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.tags.DamageTypeTags;
import net.minecraft.util.Mth;
import net.minecraft.world.BossEvent;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.EntityEvent;
import net.minecraft.world.entity.ai.attributes.Attributes;
${bursts.length ? "import net.minecraft.world.entity.Entity;\nimport net.minecraft.world.entity.ExperienceOrb;\nimport net.minecraft.world.level.GameRules;\n" : ""}${!input.nbtElsewhere ? "import net.minecraft.nbt.CompoundTag;\n" : ""}${boss.death.explosion ? "import net.minecraft.core.particles.ParticleTypes;\nimport net.minecraft.sounds.SoundSource;\n" : ""}${bursts.length || boss.death.explosion ? "import net.minecraft.server.level.ServerLevel;\n" : ""}${boss.death.explosion || sound ? "import net.minecraft.sounds.SoundEvents;\n" : ""}${!input.flier || flies ? "import net.minecraft.world.phys.Vec3;\n" : ""}${lives ? "import net.minecraft.world.entity.LivingEntity;\n" : ""}`,
    fields: `    // ---- boss: a bar, a wake-up, phases, a death played out and a leash; data from the creature's document, run on the server ----
    // What it is doing, for every player's game: the state in the low four bits (0 asleep, 1 waking up, 2 fighting, 3 changing phase) and above them the phase (0 is the first).
    private static final EntityDataAccessor<Integer> BOSS = SynchedEntityData.defineId(${input.entity}.class, EntityDataSerializers.INT);
    private static final int BOSS_DORMANT = ${state.dormant};${tailTicks ? "\n    private int finishParticleTick = -1;" : ""}
    private static final int BOSS_INTRO = ${state.intro};
    private static final int BOSS_FIGHT = ${state.fight};
    private static final int BOSS_CHANGE = ${state.change};
    // It starts asleep when it has a wake-up, else in the fight.
    private static final int BOSS_START = ${intro ? "BOSS_DORMANT" : "BOSS_FIGHT"};
${
  intro
    ? `    private static final double BOSS_WAKE_DISTANCE = ${real(intro.wake_distance)};
    private static final int BOSS_WAKE_TICKS = ${plan.introTicks};
    private static final RawAnimation BOSS_INTRO_CLIP = ${clip(intro.clip)};
`
    : ""
}${
  opening
    ? `    // Its first attack once the wake-up is over: the ability (its place in the list) that nothing else may start before, and the ticks from when the fight begins after which the others no longer wait for it
    // (the floor, its cooldown and, for a flier, its trip up and down: \`bossOpeningTicks\`).
    private static final int BOSS_OPENING = ${opening.index};
    private static final int BOSS_OPENING_TICKS = ${opening.ticks};
`
    : ""
}    // Per phase, the first being the one before any line of life is crossed: the speed and damage it is multiplied by, the abilities it may start (a bit per ability) and the colour of its bar.
    private static final double[] BOSS_SPEED = ${list(["1.0", ...phases.map((phase) => real(phase.speed))])};
    private static final double[] BOSS_DAMAGE = ${list(["1.0", ...phases.map((phase) => real(phase.damage))])};
    private static final int[] BOSS_MASKS = ${list(plan.masks)};
    private static final BossEvent.BossBarColor[] BOSS_COLORS = ${list(colors.map(BAR_COLOR))};
    // Per phase change: the share of its life where it begins, how many ticks it takes (nothing is done to it, it does nothing), and the motion it plays.
    private static final double[] BOSS_BELOW = ${list(phases.map((phase) => real(phase.below)))};
    private static final int[] BOSS_CHANGE_TICKS = ${list(phases.map((phase) => phase.ticks))};
    private static final RawAnimation[] BOSS_CHANGE_CLIPS = {${boss.phases.map((phase) => clip(phase.clip)).join(", ")}};
    private static final double BOSS_BASE_SPEED = ${real(input.speed)};
    private static final double BOSS_BASE_DAMAGE = ${real(input.damage)};
    private static final int BOSS_DEATH_TICKS = ${plan.deathTicks};
    private static final int[] BOSS_BURSTS = ${list(bursts)};
${
  plan.leashTicks
    ? `    // It goes back when it is further than this from where it began and nobody within the battle range has been near for the ticks it is given (checked every BOSS_WATCH ticks).
    private static final double BOSS_LEASH_DISTANCE = ${real(boss.leash!.distance)};
    private static final int BOSS_LEASH_TICKS = ${plan.leashTicks};
    private static final double BOSS_BATTLE = ${real(BOSS_LIMITS.battle)};
`
    : ""
}    private static final int BOSS_WATCH = ${BOSS_LIMITS.watch};
${boss.bar.darken_sky ? `    // The sky stays dark this many ticks after it last had somebody to fight, so it does not flicker between two swings.\n    private static final int BOSS_COMBAT = ${BOSS_LIMITS.combat};\n` : ""}${
  ownBar
    ? `    // Its own bar (Boss 能力 6): what lights each icon, the state last sent to the players of its bar (null: send it again), the phase it was last seen in and when its last lock broke.
    private static final int[] BOSS_BAR_ICONS = StudioBossBars.icons(${JSON.stringify(ownBar.creature)});
    private StudioBossBarState bossBarSent;
    private int bossBarPhase = -1;
    private long bossBarBroke = -1L;
`
    : ""
}${weather.fields}${boss.music ? `    private static final int SONG = StudioMusic.song("${boss.music.asset}");
    private int musicStart = -1;
    private boolean musicReset;
` : ""}${arena.fields}${show?.fields ?? ""}    private final ServerBossEvent bossBar = new ServerBossEvent(getDisplayName(), ${BAR_COLOR(colors[0]!)}, ${BAR_STYLE(boss.bar.style)});
    {
        // Seen by nobody until the fight begins.
        bossBar.setVisible(false);
    }
    private int bossTimer;
    private int bossShown = -1;
    private int bossXp;
    private boolean bossReady;
    private boolean bossHomeSet;
    private double bossHomeX;
    private double bossHomeY;
    private double bossHomeZ;
${
  flies
    ? `    // A boss that flies shows itself in the air when it wakes: over whom (the one who woke it, else the place it was woken at), since when, and whether its roar has been heard.
    private Player bossWaker;
    private Vec3 bossShowAt;
    private int bossWokeAt;
    private boolean bossShowed;
`
    : ""
}${opening ? "    // Whether the first attack has been started in this fight, and the age at which the fight began.\n    private boolean bossOpened;\n    private int bossFightAt;\n" : ""}${plan.leashTicks ? "    private int bossAlone;\n" : ""}${boss.bar.darken_sky ? "    private int bossCombat;\n" : ""}${base.fields}${look.fields}${deathDelay !== undefined ? `    private final java.util.Set<ServerPlayer> combatPlayers = new java.util.HashSet<>();\n    private int combatResetAt = -1;\n` : ""}`,
    trackerMethod: input.trackerElsewhere
      ? ""
      : `    @Override protected void defineSynchedData(SynchedEntityData.Builder builder) {
        super.defineSynchedData(builder);
${BOSS_TRACKER}${input.look ? BOSS_LOOK_TRACKER : ""}${show?.tracker ?? ""}${input.extra?.tracker ?? ""}    }

`,
    methods: `${look.methods}${base.methods}    private int bossState() { return getEntityData().get(BOSS) & 15; }

    private int bossPhase() { return getEntityData().get(BOSS) >> 4; }

    private void bossSet(int state, int phase) { getEntityData().set(BOSS, (phase << 4) | state); }

${
  opening
    ? `    /**
     * An ability starts only in a phase that allows it, and only in the fight. Until the first attack has been started once in this fight no other one does, unless its phase does not allow it
     * (a phase change before it was used) or its time has run out (it could not start: the target out of its window, a flier that could not get where it starts).
     */
    private boolean bossAllows(int index) {
        if (bossState() != BOSS_FIGHT) return false;
        int mask = BOSS_MASKS[Math.min(bossPhase(), BOSS_MASKS.length - 1)];
        if ((mask & (1 << index)) == 0) return false;
        return index == BOSS_OPENING || bossOpened || (mask & (1 << BOSS_OPENING)) == 0 || tickCount - bossFightAt > BOSS_OPENING_TICKS;
    }

    /** The wake-up is over: the fight begins, its first attack still to be made and its time running from now. This is also what arms it again after a leash reset (the next fight begins here). */
    private void bossBegin() {
        bossSet(BOSS_FIGHT, 0);
        bossOpened = false;
        bossFightAt = tickCount;
    }

    /** An ability has just started: the first attack, once started, is made and the others are let go. A phase change does not arm it again. */
    private void bossStarted(int index) {
        if (index == BOSS_OPENING) bossOpened = true;
    }
`
    : `    /** An ability starts only in a phase that allows it, and only in the fight. */
    private boolean bossAllows(int index) {
        return bossState() == BOSS_FIGHT && (BOSS_MASKS[Math.min(bossPhase(), BOSS_MASKS.length - 1)] & (1 << index)) != 0;
    }
`
}
    /** What the damage it does is multiplied by: its phase's number. */
    private float bossDamageScale() { return (float) ${base.damage ? `(BOSS_DAMAGE[Math.min(bossPhase(), BOSS_DAMAGE.length - 1)]${base.damage})` : "BOSS_DAMAGE[Math.min(bossPhase(), BOSS_DAMAGE.length - 1)]"}; }
${
  paced
    ? `
    /** What the speed of its phase multiplies by: its walking is the attribute below, its flight (which the attribute does not move) asks this. */
    private double bossSpeedScale() { return BOSS_SPEED[Math.min(bossPhase(), BOSS_SPEED.length - 1)]; }
`
    : ""
}
    /** Its phase's speed and damage, written as the attributes' base values (the same every time they are written), and its bar's colour. */
    private void bossApply(int phase) {
        phase = Math.min(phase, BOSS_SPEED.length - 1);
        var speed = getAttribute(Attributes.MOVEMENT_SPEED);
        if (speed != null) speed.setBaseValue(BOSS_BASE_SPEED * BOSS_SPEED[phase]);
        var damage = getAttribute(Attributes.ATTACK_DAMAGE);
        if (damage != null) damage.setBaseValue(BOSS_BASE_DAMAGE * BOSS_DAMAGE[phase]${base.attack});
        ${input.stanceColors ? "stanceBar();": "bossBar.setColor(BOSS_COLORS[phase]);"}
    }

${input.stanceColors ? `    private void stanceBar() {
        bossBar.setColor(switch (stanceIndex()) {
${input.stanceColors.flatMap((color, index) => color ? [`            case ${index} -> ${BAR_COLOR(color)};`] : []).join("\n")}
            default -> BOSS_COLORS[Math.min(bossPhase(), BOSS_COLORS.length - 1)];
        });
    }

` : ""}${
  lives
    ? `    /**
     * Whether a boss that has met nobody is up and about: its habits say it is up, or it has not yet settled to rest (it first goes home to its nest, and a flier comes down there to sleep).
     * Waking up and changing phase keep it still as ever. The game's "cannot move" is what stops it, so it is only the habits that move it and nothing of its fighting: it takes no target (\`canTarget\`).
     */
    private boolean bossLives() { return bossState() == BOSS_DORMANT && ${habits!.resting === null ? "true" : `!(${habits!.resting} && habitShowing() == HABIT_REST)`}; }

    // Asleep (settled to rest), waking up and changing phase it does nothing: the game's own "cannot move" stops every goal and every target search, so nothing of its own runs either.
    @Override protected boolean isImmobile() { return super.isImmobile() || ${input.stances ? "stanceChanging() || " : ""}${input.stagger ? "combatStagger() >= 0 || " : ""}(bossState() != BOSS_FIGHT && !bossLives()); }

    /** Until it has met somebody it picks nobody to fight, whatever goal asks (its own, a gameplay one): the fight begins with its wake-up. */
    @Override public boolean canAttack(LivingEntity target) { return bossState() != BOSS_DORMANT && super.canAttack(target); }

    /** Whether it has met somebody: asleep it has not. A creature's own search for a player to chase asks this too. */
    private boolean bossMet() { return bossState() != BOSS_DORMANT; }
`
    : `    // Asleep, waking up and changing phase it does nothing: the game's own "cannot move" stops every goal and every target search, so nothing of its own runs either.
    @Override protected boolean isImmobile() { return super.isImmobile() || ${input.stances ? "stanceChanging() || " : ""}${input.stagger ? "combatStagger() >= 0 || " : ""}bossState() != BOSS_FIGHT; }
`
}${
  flies
    ? `
    /** Waking up: a boss that flies shows itself in the air for this (the flight takes it up and round \`bossShowAt\`). */
    private boolean bossDisplay() { return bossState() == BOSS_INTRO; }
`
    : ""
}
    @Override public boolean isInvulnerableTo(DamageSource source) {
        if (super.isInvulnerableTo(source)) return true;
        if (bossState() == BOSS_FIGHT || source.is(DamageTypeTags.BYPASSES_INVULNERABILITY)) return false;
${intro ? `        // Hurt while it sleeps: a player's blow wakes it (the blow itself does nothing); it cannot be woken by a fall or a fire.\n        if (!level().isClientSide() && bossState() == BOSS_DORMANT && source.getEntity() instanceof Player${flies ? " player" : ""}) bossWake(${flies ? "player" : ""});\n` : ""}        return true;
    }

    /** A blow that would take it across the next line of life leaves it exactly on the line, and it changes phase on the spot: one blow never skips a phase. */
    @Override protected void actuallyHurt(DamageSource source, float amount) {
${deathDelay !== undefined ? "        if (bossState() == BOSS_FIGHT && source.getEntity() instanceof ServerPlayer player && player.isAlive()) combatJoin(player);\n" : ""}        float before = getHealth();
        super.actuallyHurt(source, amount);${base.hurt}
${
  base.lost
    ? `        if (!level().isClientSide() && bossState() == BOSS_FIGHT && bossPhase() < BOSS_BELOW.length) {
            float line = (float) (BOSS_BELOW[bossPhase()] * getMaxHealth());
            if (before > line && getHealth() <= line) {
                setHealth(line);
                bossChange(bossPhase() + 1);
            }
        }${base.lost}`
    : `        if (level().isClientSide() || bossState() != BOSS_FIGHT || bossPhase() >= BOSS_BELOW.length) return;
        float line = (float) (BOSS_BELOW[bossPhase()] * getMaxHealth());
        if (before > line && getHealth() <= line) {
            setHealth(line);
            bossChange(bossPhase() + 1);
        }`
}
    }

    private void bossChange(int phase) {${interrupt}
        getNavigation().stop();
        bossTimer = BOSS_CHANGE_TICKS[phase - 1];
        bossSet(BOSS_CHANGE, phase);${look.change}${(input.phaseSounds ?? []).map((sound, index) => sound ? `\n        if (phase == ${index + 1}) level().playSound(null, getX(), getY(), getZ(), ${sound.event}, ${sound.source}, ${sound.volume === undefined ? "1.0f" : `${sound.volume}f`}, 1.0f);` : "").join("")}
    }

${
  intro
    ? `    private void bossWake(${flies ? "Player who" : ""}) {
        bossTimer = BOSS_WAKE_TICKS;
        bossSet(BOSS_INTRO, 0);
${show?.wake ?? ""}${
  lives
    ? `        // Whatever its habits were doing ends with the wake-up: no walk to a place, no resting motion or warning over the one it plays now.
        getNavigation().stop();
        habitSet(0);
${habits!.alert ? "        habitAlertDueUntil = -1;\n" : ""}`
    : ""
}${
  flies
    ? `        bossWaker = who;
        bossShowAt = who != null ? who.position() : position();
        bossWokeAt = tickCount;
        bossShowed = false;
`
    : ""
}${
  sound && !flies
    ? `        // Louder than one is heard from further (volume over 1 reaches 16 blocks a unit): the whole room hears it.\n        level().playSound(null, getX(), getY(), getZ(), ${sound}, getSoundSource(), ${intro?.volume === undefined ? "2.0f" : `${intro.volume}f`}, 1.0f);\n`
    : ""
}    }

`
    : ""
}    /** Back to where it began, in full health and in the first phase, asleep again when it has a wake-up. */
    private void bossReset(boolean far) {${input.stances ? "\n        stanceReset();" : ""}${boss.music ? "\n        musicStart = -1;\n        musicReset = true;" : ""}${input.restoreTerrain ? "\n        StudioTerrain.clear(this);" : ""}${input.stagger ? "\n        combatResetStagger();" : ""}${deathDelay !== undefined ? "\n        combatPlayers.clear();\n        combatResetAt = -1;" : ""}${interrupt}${arena.reset ? `
${arena.reset.trimEnd()}` : ""}
        setTarget(null);
        getNavigation().stop();
${base.reset}        setHealth(getMaxHealth());
${input.look ? look.reset : ""}${plan.leashTicks ? "        bossAlone = 0;\n" : ""}${boss.bar.darken_sky ? "        bossCombat = 0;\n" : ""}${
  input.flier
    ? `        // A flier goes back as it goes anywhere, by flying; it is set down at home, and only then is it asleep again (or fighting fresh), in its first phase.
        flightComeHome(bossHomeX, bossHomeY, bossHomeZ);
`
    : `        bossSet(BOSS_START, 0);
        bossApply(0);
        // Near home it starts over where it stands; only one that was drawn further than the leash is put back.
        if (far) {
            moveTo(bossHomeX, bossHomeY, bossHomeZ, getYRot(), getXRot());
            setDeltaMovement(Vec3.ZERO);
        }
`
}    }

${
  ownBar
    ? `    /**
     * What its own bar shows now, sent to the players of its bar when it is not what they were last sent: the phase and its name, the life left, the icons of what it is
     * running, and the game time its last lock broke (the moment it crossed into this phase; -1 when it came into the world past it, or is back in the first).
     */
    private void bossBarSync() {
        int phase = bossPhase();
        if (phase != bossBarPhase) {
            bossBarBroke = bossBarPhase >= 0 && phase > bossBarPhase ? level().getGameTime() : phase == 0 ? -1L : bossBarBroke;
            bossBarPhase = phase;
        }
        int lit = BOSS_BAR_ICONS == null ? 0 : StudioBossBarState.litIcons(BOSS_BAR_ICONS, ${ownBar.running}, ${ownBar.step});
        StudioBossBarState state = new StudioBossBarState(phase, Mth.clamp(getHealth() / getMaxHealth(), 0.0f, 1.0f), lit, phase, bossBarBroke, ${arena.dots});
        if (state.equals(bossBarSent)) return;
        bossBarSent = state;
        StudioBossBarSync.send(bossBar.getPlayers(), bossBar.getId(), ${JSON.stringify(ownBar.creature)}, state);
    }

`
    : ""
}${deathDelay === undefined ? "" : `    private void combatJoin(ServerPlayer player) {
        if (combatResetAt < 0 && !player.isSpectator() && !player.isCreative() && player.isAlive()) {
            combatPlayers.add(player);
        }
    }

    private boolean combatPartyReset() {
        if (getTarget() instanceof ServerPlayer player) combatJoin(player);
        if (tickCount % BOSS_WATCH != 0 && combatResetAt < 0) return false;
        boolean died = combatPlayers.removeIf(player -> player.getHealth() <= 0);
        boolean left = combatPlayers.removeIf(player -> player.isRemoved() || player.level() != level());
        if (died && !left && combatPlayers.isEmpty()) combatResetAt = tickCount + ${Math.round((deathDelay ?? 0) * 20)};
        if (combatResetAt < 0 || tickCount < combatResetAt) return false;
        bossReset(distanceToSqr(bossHomeX, bossHomeY, bossHomeZ) > BOSS_LEASH_DISTANCE * BOSS_LEASH_DISTANCE);
        return true;
    }

`}    private void tickBoss() {
        if (level().isClientSide()) return;
        if (!bossReady) {
            // The first tick it is in the world: where it began, and the numbers of the phase it is in (a saved creature has the ones it was saved with).
            bossReady = true;
            if (!bossHomeSet) {
                bossHomeSet = true;
                bossHomeX = getX();
                bossHomeY = getY();
                bossHomeZ = getZ();
            }
            bossApply(bossPhase());
        }
${weather.tick}${stanceAmbience(input.stances) ? "" : show?.weatherTick ?? ""}${arena.tick}        if (isDeadOrDying()) {
            bossBar.setProgress(0.0f);${boss.bar.darken_sky ? "\n            bossBar.setDarkenScreen(false);" : ""}${ownBar ? "\n            bossBarSync();" : ""}
            return;
        }
        int state = bossState();${deathDelay !== undefined ? "\n        if ((state == BOSS_CHANGE || state == BOSS_FIGHT) && combatPartyReset()) return;" : ""}
${base.tick}${
  intro
    ? `        if (state == BOSS_DORMANT) {
${
  lives || flies
    ? `${lives ? "            // It has met nobody: it picks no fight (\`canTarget\`), but its habits go on, and a target put on it from outside is let go.\n            if (getTarget() != null) setTarget(null);\n" : ""}            if (tickCount % BOSS_WATCH == 0) {
                Player near = level().getNearestPlayer(this, BOSS_WAKE_DISTANCE);
                if (near != null) bossWake(${flies ? "near" : ""});
            }
`
    : "            if (tickCount % BOSS_WATCH == 0 && level().getNearestPlayer(this, BOSS_WAKE_DISTANCE) != null) bossWake();\n"
}        } else if (state == BOSS_INTRO) {
${
  flies
    ? `            // The show is over whoever woke it, wherever they go; the seconds of the wake-up count from when it is up (the flight rises for it first), and a boss that cannot rise
            // (under water, under a roof) in the time a landing and a take-off need fights instead of standing untouchable.
            if (bossWaker != null && bossWaker.isAlive() && bossWaker.level() == level()) bossShowAt = bossWaker.position();
            else if (bossShowAt == null) bossShowAt = position();
            if (flightState() == FLIGHT_AIR) {
                if (!bossShowed) {
                    bossShowed = true;
${sound ? `                    // Louder than one is heard from further (volume over 1 reaches 16 blocks a unit): the whole room hears it.\n                    level().playSound(null, getX(), getY(), getZ(), ${sound}, getSoundSource(), ${intro?.volume === undefined ? "2.0f" : `${intro.volume}f`}, 1.0f);\n` : ""}                }
${show ? show.introTick(begin, "                ") : `                if (--bossTimer <= 0) ${begin}\n`}            } else if (tickCount - bossWokeAt > FLIGHT_LAND_TICKS + FLIGHT_TAKEOFF_TICKS + BOSS_WATCH) {
                ${begin}
            }
`
    : show
      ? show.introTick(begin, "            ")
      : `            if (--bossTimer <= 0) ${begin}\n`
}        } else `
    : "        "
}if (state == BOSS_CHANGE) {
            if (--bossTimer <= 0) {
                bossSet(BOSS_FIGHT, bossPhase());
                bossApply(bossPhase());${tailTicks ? "\n                finishParticleTick = 0;" : ""}${finish ? "\n                bossShowStep(2 + bossPhase(), 0);" : ""}
            }
        } else if (state == BOSS_FIGHT) {${tailTicks ? `\n            if (finishParticleTick >= 0 && finishParticleTick < ${tailTicks}) bossShowStep(2 + bossPhase(), ++finishParticleTick);` : ""}
            // Whatever took it across a line without going through a blow (a command, a fall in one tick) is caught here.
            if (bossPhase() < BOSS_BELOW.length && getHealth() <= BOSS_BELOW[bossPhase()] * getMaxHealth()) bossChange(bossPhase() + 1);
${
  plan.leashTicks
    ? `            if (tickCount % BOSS_WATCH == 0) {
                bossAlone = level().getNearestPlayer(this, BOSS_BATTLE) != null ? 0 : bossAlone + BOSS_WATCH;
                // epic r1 review: a player who walked away while the boss stayed near home left it hurt and enraged for good. Nobody near for the
                // reset time ends the fight wherever it is; the leash distance only says whether it must also be brought back home.
                if (bossAlone >= BOSS_LEASH_TICKS${input.flier ? " && !flightReturning" : ""}
                        && level().hasChunk(Mth.floor(bossHomeX) >> 4, Mth.floor(bossHomeZ) >> 4))
                    bossReset(distanceToSqr(bossHomeX, bossHomeY, bossHomeZ) > BOSS_LEASH_DISTANCE * BOSS_LEASH_DISTANCE);
            }
`
    : ""
}${boss.bar.darken_sky ? "            bossCombat = getTarget() != null ? BOSS_COMBAT : Math.max(0, bossCombat - 1);\n" : ""}${base.fight}        }
        state = bossState();
${boss.music ? `        if (musicReset && level().getNearestPlayer(this, ${BOSS_LIMITS.battle}.0) != null) musicReset = false;
        if (!musicReset && (state == BOSS_FIGHT || state == BOSS_CHANGE${boss.music.starts === "wake" ? " || state == BOSS_INTRO" : ""}) && (musicStart >= 0 || !bossBar.getPlayers().isEmpty())) {
            if (musicStart < 0) musicStart = tickCount;
            StudioMusic.fight(this, bossBar.getPlayers(), SONG, tickCount - musicStart, ${Math.round(boss.music.fade_seconds * 20)});
        } else musicStart = -1;
` : ""}        bossBar.setProgress(getHealth() / getMaxHealth());
        bossBar.setVisible(state == BOSS_FIGHT || state == BOSS_CHANGE);${boss.bar.darken_sky ? "\n        bossBar.setDarkenScreen(bossCombat > 0 && state != BOSS_DORMANT);" : ""}${ownBar ? "\n        bossBarSync();" : ""}
    }

    @Override public void setCustomName(Component name) {
        super.setCustomName(name);
        // It is called while the creature is read from its save, after the bar exists, but never before.
        if (bossBar != null) bossBar.setName(getDisplayName());
    }

    @Override public void startSeenByPlayer(ServerPlayer player) {
        super.startSeenByPlayer(player);
        bossBar.addPlayer(player);${ownBar ? "\n        // Whoever starts seeing it is told what its bar shows: the next tick sends it to every player of the bar again.\n        bossBarSent = null;" : ""}
    }

    @Override public void stopSeenByPlayer(ServerPlayer player) {
        super.stopSeenByPlayer(player);
        bossBar.removePlayer(player);
    }

${
  bursts.length
    ? `    /** Its experience is not dropped when it starts to die but over the whole death (BOSS_BURSTS), so the show carries it. The same conditions the game itself drops it under. */
    @Override protected void dropExperience(Entity attacker) {
        if (level() instanceof ServerLevel serverWorld && !wasExperienceConsumed()
                && (isAlwaysExperienceDropper() || lastHurtByPlayerTime > 0 && shouldDropExperience() && level().getGameRules().getBoolean(GameRules.RULE_DOMOBLOOT)))
            bossXp = getExperienceReward(serverWorld, attacker);
    }

`
    : ""
}    /** The whole death, timed here: the motion plays to its end, the experience comes out in bursts${boss.death.explosion ? ", and the last moment is a blast of light and sound that breaks nothing and hurts nobody" : ""}. The loot is the game's, dropped when the death begins. */
    @Override protected void tickDeath() {
        ++deathTime;
        if (level().isClientSide() || isRemoved()) return;
${
  bursts.length
    ? `        for (int burst = 0; burst < BOSS_BURSTS.length; burst++) {
            if (BOSS_BURSTS[burst] != deathTime) continue;
            int share = bossXp / BOSS_BURSTS.length;
            int give = burst == BOSS_BURSTS.length - 1 ? bossXp - share * (BOSS_BURSTS.length - 1) : share;
            if (give > 0 && level() instanceof ServerLevel serverWorld) ExperienceOrb.award(serverWorld, position().add(0.0, getBbHeight() * 0.5, 0.0), give);
        }
`
    : ""
}${boss.death.steps?.some(step => step.type === "fixture") ? "        StudioArena.deathTick(StudioArena.room(this));\n" : ""}${show?.deathTick ?? ""}        if (deathTime < BOSS_DEATH_TICKS${input.flier ? " || !flightFallen(BOSS_DEATH_TICKS)" : ""}) return;
${
  boss.death.explosion
    ? `        // The blast: only light and sound.
        ${input.builtin?.death_burst?.sound==="none" ? "if (false) " : ""}level().playSound(null, getX(), getY(), getZ(), ${builtinSound(!!input.builtin?.death_burst?.sound, "this", "death_burst", "SoundEvents.GENERIC_EXPLODE", "entity.generic.explode")}, SoundSource.HOSTILE, 4.0f, (1.0f + (random.nextFloat() - random.nextFloat()) * 0.2f) * 0.7f);
        if (level() instanceof ServerLevel serverWorld) {
            ${input.builtin?.death_burst?.particle==="none" ? "if (false) " : ""}serverWorld.sendParticles(${builtinParticle(!!input.builtin?.death_burst?.particle, "this", "death_burst", "ParticleTypes.EXPLOSION_EMITTER")}, getX(), getY() + getBbHeight() * 0.5, getZ(), 1, 0.0, 0.0, 0.0, 0.0);
${input.builtin?.death_burst?.particle ? "" : "            serverWorld.sendParticles(ParticleTypes.FLASH, getX(), getY() + getBbHeight() * 0.5, getZ(), 1, 0.0, 0.0, 0.0, 0.0);\n"}        }
`
    : ""
}${boss.death.steps?.some(step => step.type === "fixture") ? "        StudioArena.end(this);\n" : ""}        bossBar.setProgress(0.0f);
        bossBar.removeAllPlayers();
        level().broadcastEntityEvent(this, EntityEvent.POOF);
        remove(RemovalReason.KILLED);
    }

${
  anyClip
    ? `    /** The motion it plays now because of what it is doing: its wake-up or its change of phase, else none. */
    private RawAnimation bossClip() {
        int state = bossState();
${intro ? `        if (state == BOSS_INTRO${flies ? " && flightState() == FLIGHT_AIR" : ""}${show?.clips.intro ? " && bossShowClipStep() < 0" : ""}) return BOSS_INTRO_CLIP;\n` : ""}        if (state == BOSS_CHANGE && bossPhase() >= 1 && bossPhase() <= BOSS_CHANGE_CLIPS.length) return BOSS_CHANGE_CLIPS[bossPhase() - 1];
        return null;
    }

`
    : ""
}${show?.methods ?? ""}`,
    tick: "tickBoss();",
    controller: `${
      anyClip
        ? `        // Plays the wake-up or the change of phase the server says it is in: every player near sees it, also one who walks up in the middle of it.
        controllers.add(new AnimationController<>(this, "boss", 0, state -> {
            RawAnimation clip = isDeadOrDying() ? null : bossClip();
            if (clip == null) {
                bossShown = -1;
                return PlayState.STOP;
            }
            int shown = getEntityData().get(BOSS);
            if (shown != bossShown) {
                bossShown = shown;
                state.getController().forceAnimationReset();
            }
            return state.setAndContinue(clip);
        }));
`
        : ""
    }${show?.controller ?? ""}`,
    shown: [anyClip ? "bossClip() != null" : "", show?.clips.any ? "bossShowClipStep() >= 0" : ""].filter(Boolean).join(" || "),
    nbtWrite: nbtWrite,
    nbtRead: nbtRead,
    nbtMethods: input.nbtElsewhere
      ? ""
      : `    @Override public void addAdditionalSaveData(CompoundTag nbt) {
        super.addAdditionalSaveData(nbt);${nbtWrite}${input.extra?.nbtWrite ?? ""}
    }

    @Override public void readAdditionalSaveData(CompoundTag nbt) {
        super.readAdditionalSaveData(nbt);${nbtRead}${input.extra?.nbtRead ?? ""}
    }

`,
    /** A boss with a wake-up is never taken away by the world while it waits (spec: 有登场的 Boss 不会自然消失). */
    despawnKept: Boolean(intro),
  }
}
