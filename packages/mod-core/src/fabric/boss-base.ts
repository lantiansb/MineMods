import { TICKS } from "../ability-words"
import { hasBossBase, type BossBase } from "../boss-base"

/**
 * The Java of what every boss of a big boss mod has (`boss-base.ts`): the most life one blow takes, the most it loses over a window of ticks, its life coming back after
 * a quiet while, and more life and damage for more players near. Pieces `compileBoss` (entity-boss.ts) puts in its class; every piece is the empty string for a boss
 * without any of the four, so such a boss is the Java it always was. Every Minecraft name is Mojang's own and the same in 1.20.1 and 1.21.1 (`getAttribute`, `heal`,
 * `level().players()`, `DamageTypeTags.BYPASSES_INVULNERABILITY`), so the loaders' adapters change nothing here.
 * - The caps are held where its life is taken (`actuallyHurt`): whatever the game took off (after armour, after a loader's events), what is over the cap is given back
 *   before the game looks whether it died, so a blow over the cap never kills it. The void and /kill (the damage types that pass through invulnerability) are not held.
 * - The window is one slot a tick (`BOSS_DPS_TICKS`), the life taken in each, summed over the last window's ticks at every blow: a true sliding window, not one that
 *   starts again every few seconds (which would let twice the cap through across its edge). What a slot counts, and what breaks the quiet before its life comes back,
 *   is what the blow took in the end (`bossLost`, after the caps and after the line of its phase has held it there): a blow given back in full neither fills the window
 *   nor breaks the quiet.
 * - The scaling sets its most life's base value (the game saves it with the creature) and keeps the share of life it has, so the bar and the lines of its phases
 *   (shares of the most) stay true; the extra players counted are saved beside it (`BossExtra`) for the damage.
 */

const real = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(4))))

const NONE = { fields: "", methods: "", hurt: "", lost: "", tick: "", fight: "", reset: "", damage: "", attack: "", nbtWrite: "", nbtRead: "" }
export type BossBaseSource = typeof NONE

/** `health`: the creature's own most life, the base the scaling multiplies (its attribute's default). */
export function bossBaseJava(boss: BossBase | null | undefined, health: number): BossBaseSource {
  if (!boss || !hasBossBase(boss)) return NONE
  const cap = boss.damage_cap ?? null
  const dps = boss.dps_cap ?? null
  const regen = boss.regen ?? null
  const scaling = boss.scaling ?? null
  const caps = cap !== null || dps !== null
  const quiet = regen !== null
  const ticks = (seconds: number) => Math.max(1, Math.round(seconds * TICKS))
  return {
    fields: `    // ---- what every boss of a big boss mod has: ${[cap !== null ? "the most one blow takes" : "", dps ? "the most it loses in a window" : "", regen ? "its life coming back" : "", scaling ? "more for more players" : ""].filter(Boolean).join(", ")} ----
${cap !== null ? `    private static final float BOSS_DAMAGE_CAP = ${real(cap)}f;\n` : ""}${
      dps
        ? `    // The most life it loses in any BOSS_DPS_TICKS ticks, and what it lost in each of the last ones (a slot a tick, by the tick it was).
    private static final float BOSS_DPS_AMOUNT = ${real(dps.amount)}f;
    private static final int BOSS_DPS_TICKS = ${ticks(dps.seconds)};
    private final float[] bossWindow = new float[BOSS_DPS_TICKS];
    private final int[] bossWindowAt = new int[BOSS_DPS_TICKS];
`
        : ""
    }${
      regen
        ? `    // Life a tick it gets back once it has lost none for BOSS_REGEN_AFTER ticks${regen.in_fight ? "" : ", only while it has nobody to fight"}; the ticks since it last lost some.
    private static final float BOSS_REGEN = ${real(regen.per_second / TICKS)}f;
    private static final int BOSS_REGEN_AFTER = ${Math.round(regen.after_seconds_without_damage * TICKS)};
`
        : ""
    }${quiet ? "    private int bossQuiet;\n" : ""}${
      scaling
        ? `    // Per player more than one within BOSS_SCALE_RADIUS (counting BOSS_SCALE_MOST at most): its most life and its damage grow by these shares of its own. How many more it counted.
    private static final double BOSS_BASE_HEALTH = ${real(health)};
    private static final double BOSS_SCALE_HEALTH = ${real(scaling.per_extra_player.health)};
    private static final double BOSS_SCALE_DAMAGE = ${real(scaling.per_extra_player.damage)};
    private static final double BOSS_SCALE_RADIUS = ${real(scaling.radius)};
    private static final int BOSS_SCALE_MOST = ${scaling.max_players};
    private int bossExtra;
`
        : ""
    }`,
    methods: `${
      caps
        ? `    /**
     * A blow has taken \`before - getHealth()\` of its life: what is over the most one blow takes${dps ? ", and over what the window has left," : ""} is given back (before the game looks whether it died).
     * The void and /kill are not held.
     */
    private void bossTaken(DamageSource source, float before) {
        float lost = before - getHealth();
        if (lost <= 0.0f || source.is(DamageTypeTags.BYPASSES_INVULNERABILITY)) return;
        float kept = ${cap !== null ? "Math.min(lost, BOSS_DAMAGE_CAP)" : "lost"};${
          dps
            ? `
        float window = 0.0f;
        for (int slot = 0; slot < BOSS_DPS_TICKS; slot++) if (tickCount - bossWindowAt[slot] < BOSS_DPS_TICKS) window += bossWindow[slot];
        kept = Math.max(0.0f, Math.min(kept, BOSS_DPS_AMOUNT - window));`
            : ""
        }
        if (kept < lost) setHealth(before - kept);
    }

`
        : ""
    }${
      dps || quiet
        ? `    /**
     * What a blow took in the end, \`before - getHealth()\` after the caps and the line of its phase: ${[dps ? "the window counts it" : "", quiet ? "the quiet before its life comes back starts again" : ""].filter(Boolean).join(", and ")}.
     * Only when it lost some: a blow given back in full (over the cap, the window full, already on the line) ${dps && quiet ? "neither fills the window nor breaks the quiet" : dps ? "does not fill the window" : "does not break the quiet"}.
     * The void and /kill are not counted.
     */
    private void bossLost(DamageSource source, float before) {
        float lost = before - getHealth();
        if (lost <= 0.0f || source.is(DamageTypeTags.BYPASSES_INVULNERABILITY)) return;${quiet ? "\n        bossQuiet = 0;" : ""}${
          dps
            ? `
        int slot = tickCount % BOSS_DPS_TICKS;
        if (bossWindowAt[slot] != tickCount) {
            bossWindowAt[slot] = tickCount;
            bossWindow[slot] = 0.0f;
        }
        bossWindow[slot] += lost;`
            : ""
        }
    }

`
        : ""
    }${
      scaling
        ? `    /** How many players more than one are within BOSS_SCALE_RADIUS (spectators and the dead are not), counting BOSS_SCALE_MOST at most. */
    private int bossPlayersMore() {
        int count = 0;
        for (Player player : level().players())
            if (player.isAlive() && !player.isSpectator() && player.distanceToSqr(this) <= BOSS_SCALE_RADIUS * BOSS_SCALE_RADIUS) count++;
        return Mth.clamp(count, 1, BOSS_SCALE_MOST) - 1;
    }

    /** \`extra\` players more than one: its most life grows by their share and its life keeps its share of it (the bar and the lines of its phases stay true); its damage too. */
    private void bossScale(int extra) {
        var most = getAttribute(Attributes.MAX_HEALTH);
        double value = BOSS_BASE_HEALTH * (1.0 + BOSS_SCALE_HEALTH * extra);
        if (extra == bossExtra && (most == null || most.getBaseValue() == value)) return;
        float share = Mth.clamp(getHealth() / getMaxHealth(), 0.0f, 1.0f);
        bossExtra = extra;
        if (most != null) most.setBaseValue(value);
        if (!isDeadOrDying()) setHealth(share * getMaxHealth());
        bossApply(bossPhase());
    }

    /** What its damage is multiplied by for the players near. */
    private double bossScaleDamage() { return 1.0 + BOSS_SCALE_DAMAGE * bossExtra; }

`
        : ""
    }`,
    hurt: caps ? "\n        if (!level().isClientSide()) bossTaken(source, before);" : "",
    // At the end of its actuallyHurt, after the line of its phase: what the blow took in the end.
    lost: dps || quiet ? "\n        if (!level().isClientSide()) bossLost(source, before);" : "",
    // Counted every BOSS_WATCH ticks once it has met somebody (asleep it is as it was made).
    tick: scaling ? "        if (bossState() != BOSS_DORMANT && tickCount % BOSS_WATCH == 0) bossScale(bossPlayersMore());\n" : "",
    // In the fight: the quiet counts and, after it, its life comes back (never past its most; a phase is never undone).
    fight: regen
      ? `            if (bossQuiet < BOSS_REGEN_AFTER) bossQuiet++;
            else if (getHealth() < getMaxHealth()${regen.in_fight ? "" : " && getTarget() == null"}) heal(BOSS_REGEN);
`
      : "",
    reset: `${scaling ? "        bossScale(0);\n" : ""}${quiet ? "        bossQuiet = 0;\n" : ""}`,
    damage: scaling ? " * bossScaleDamage()" : "",
    attack: scaling ? " * bossScaleDamage()" : "",
    nbtWrite: scaling ? '\n        nbt.putInt("BossExtra", bossExtra);' : "",
    nbtRead: scaling ? '\n            bossExtra = Mth.clamp(nbt.getInt("BossExtra"), 0, BOSS_SCALE_MOST - 1);' : "",
  }
}
