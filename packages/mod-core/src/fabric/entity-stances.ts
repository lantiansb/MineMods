import type { Ability, Boss, Combo, Stances } from "../entity-runtime"
import { conditionJava } from "./combat"

const ticks = (seconds: number) => Math.max(1, Math.round(20 * seconds))
const cases = (rows: readonly string[]) => rows.join("\n")
const numbers = (rows: readonly number[]) => "{" + rows.join(", ") + "}"

export function compileStances(config: Stances | undefined, abilities: readonly Ability[], combos: readonly Combo[], boss: Boss | null | undefined, entity: string, model: string) {
  if (!config) return null
  const { list } = config
  const indexOf = (id: string | undefined) => list.findIndex(row => row.id === id)
  const action = (id: string) => `stanceRequest(${indexOf(id)}, 2);`
  const rules = list.flatMap((stance, index) => (stance.when ?? []).map(rule => ({ index, rule })))
  const firstTarget = (id: string) => abilities.find(move => move.id === id)?.events.find(event => event.type === "stance")?.to
  const eventTail = Math.max(0, ...list.flatMap(row => (row.events ?? []).flatMap(event => event.type === "particle" && event.until !== undefined ? [ticks(event.until)] : [])))
  const enterEvents = list.some(row => row.events)
  const leave = list.some(row => row.leave)
  const animation = (clip: string, op: string) => `RawAnimation.begin().${op}("animation.${model}.${clip}")`
  const clipRows = (field: "idle" | "walk") => list.map(row => row.clips?.[field] ? animation(row.clips[field], "thenLoop") : "null")
  const ids = clipRows("idle"), walks = clipRows("walk")
  const motion = ids.some(clip => clip !== "null") || walks.some(clip => clip !== "null")
  const changes = list.map(row => row.change?.clip ? animation(row.change.clip, "thenPlayAndHold") : "null")
  const hasClip = changes.some(clip => clip !== "null")
  const hold = list.some(row => row.change || row.clips?.walk === null)
  const start = indexOf(config.start)
  const healthEdge = rules.some(({ rule }) => rule.if === "health_point")
  const damage = rules.some(({ rule }) => rule.if === "damage_taken")
  const still = rules.some(({ rule }) => rule.if === "target_still")
  const when = rules.map(({ index, rule }, slot) => {
    const context = {
      health: rule.if === "health_point" ? "getHealth()" : "getHealth() / getMaxHealth()",
      before: "stancePreviousHealth", max: "getMaxHealth()", accumulated: `stanceDamage[${slot}]`,
      elapsed: "stanceAge", still: `stanceStill[${slot}]`,
    }
    const observe = rule.if === "target_still" ? `stanceStill[${slot}] = still && target.distanceToSqr(this) <= ${rule.within ** 2} ? stanceStill[${slot}] + 1 : 0;\n            ` : ""
    return `        if (current == ${index}) {
            ${observe}if (${conditionJava(rule, context)}) ${action(rule.to)}
        }`
  })
  const masks = list.map(row => row.abilities ? [...abilities, ...combos].reduce((mask, move, index) => mask | (row.abilities!.includes(move.id) ? 1 << index : 0), 0) : -1)
  const gates = [...abilities, ...combos].flatMap((move, index) => {
    const rows = move.start.when?.filter(rule => rule.if === "stance") ?? []
    return rows.length ? [`            case ${index} -> ${rows.map(rule => `stanceIndex() == ${indexOf(rule.id)}`).join(" && ")};`] : []
  })
  const phaseTimeouts = boss?.phases.flatMap((phase, i) => !phase.stances ? [] : [`            case ${i + 1} -> switch (current) { ${Object.entries(phase.stances).map(([id, row]) => `case ${indexOf(id)} -> ${ticks(row.max_seconds)};`).join(" ")} default -> seconds; };`]) ?? []

  return {
    action, hold, indexOf, leave, damage, healthEdge, motion,
    controller: hasClip ? `        controllers.add(new AnimationController<>(this, "stance_change", 0, new AnimationController.AnimationStateHandler<${entity}>() {
            private int previous = -1;
            @Override public PlayState handle(software.bernie.geckolib.animation.AnimationState<${entity}> state) {
                int change = getEntityData().get(STANCE);
                RawAnimation clip = STANCE_CHANGE_CLIP[stanceIndex()];
                if (!stanceChanging() || clip == null || isDeadOrDying()) return PlayState.STOP;
                if (change != previous) state.getController().forceAnimationReset();
                previous = change;
                return state.setAndContinue(clip);
            }
        }));
` : "",
    tracker: `\n        builder.define(STANCE, ${start});`,
    fields: `
    private static final EntityDataAccessor<Integer> STANCE = SynchedEntityData.defineId(${entity}.class, EntityDataSerializers.INT);
    private static final int[] STANCE_PICKS = ${numbers(masks)};
    private static final int[] STANCE_TIME = ${numbers(list.map(row => row.max_seconds === undefined ? 0 : ticks(row.max_seconds)))};
    private static final int[] STANCE_NEXT = ${numbers(list.map(row => indexOf(row.then)))};
    private static final int[] STANCE_CHANGE = ${numbers(list.map(row => row.change ? ticks(row.change.seconds) : 0))};
${motion ? `    private static final RawAnimation[] STANCE_IDLE = {${ids.join(", ")}};
    private static final RawAnimation[] STANCE_WALK = {${walks.join(", ")}};
    private RawAnimation stanceMotion(boolean moving, RawAnimation fallback) {
        RawAnimation clip = (moving ? STANCE_WALK : STANCE_IDLE)[stanceIndex()];
        return clip == null ? fallback : clip;
    }
` : ""}${hasClip ? `    private static final RawAnimation[] STANCE_CHANGE_CLIP = {${changes.join(", ")}};
` : ""}    private int stancePending = -1, stanceRank, stanceSerial, stanceAge, stanceChangeUntil, stanceAlone;
${eventTail ? "    private int stanceEventAt = -1;" + "\n" : ""}${hold ? `    private float stanceBody, stanceHead, stancePitch;
` : ""}    private long stanceUpdated = Long.MIN_VALUE;
    private boolean stanceEarlierFight;${healthEdge ? "\n    private float stancePreviousHealth = Float.NaN;" : ""}${damage ? `
    private final float[] stanceDamage = new float[${rules.length}];
    private final int[] stanceLastDamage = new int[${rules.length}];` : ""}${still ? `
    private final int[] stanceStill = new int[${rules.length}];
    private java.util.UUID stancePreviousTarget;
    private net.minecraft.world.phys.Vec3 stancePreviousPosition;` : ""}${leave ? `
    private static final int[] STANCE_LEAVE_MOVE = ${numbers(list.map(row => abilities.findIndex(move => move.id === row.leave?.ability)))};
    private static final int[] STANCE_LEAVE_AT = ${numbers(list.map(row => row.leave ? ticks(row.leave.after_seconds) : 0))};
    private static final int[] STANCE_LEAVE_RETRY = ${numbers(list.map(row => row.leave ? ticks(row.leave.retry_seconds) : 0))};
    private static final int[] STANCE_LEAVE_DELAYS = ${numbers(list.map(row => row.leave?.max_delays ?? 0))};
    private static final int[] STANCE_LEAVE_NEXT = ${numbers(list.map(row => row.leave ? indexOf(row.then ?? firstTarget(row.leave.ability)) : -1))};
    private int stanceRetried, stanceRetryAt, stanceDeparture = -1;` : ""}
`,
    methods: (interrupt: string, legacy: boolean) => `    public int stanceIndex() { return getEntityData().get(STANCE) & 15; }
    private boolean stanceChanging() { return (getEntityData().get(STANCE) & 16) != 0; }
    private boolean stanceCanWalk() { return !stanceChanging()${list.flatMap((row, i) => row.clips?.walk === null ? [` && stanceIndex() != ${i}`] : []).join("")}; }
    private boolean stanceAllows(int index) { return (STANCE_PICKS[stanceIndex()] & (1 << index)) != 0; }
    private boolean stanceRequires(int index) {
        return switch (index) {
${cases(gates)}
            default -> true;
        };
    }

    private void stanceRequest(int next, int rank) {
        if (next < 0 || next == stanceIndex() || rank <= stanceRank) return;
        stancePending = next;
        stanceRank = rank;
    }

    private void stanceClear() {
        stancePending = -1;
        stanceRank = 0;
        stanceAge = 0;${eventTail ? "\n        stanceEventAt = -1;" : ""}${healthEdge ? "\n        stancePreviousHealth = getHealth();" : ""}${damage ? "\n        java.util.Arrays.fill(stanceDamage, 0);" : ""}${still ? "\n        java.util.Arrays.fill(stanceStill, 0);" : ""}${leave ? "\n        stanceRetried = 0;\n        stanceRetryAt = 0;\n        stanceDeparture = -1;" : ""}
    }

    private void stanceReset() {
        stanceClear();
        stanceChangeUntil = 0;
        stanceAlone = 0;
        stanceEarlierFight = false;
        stanceUpdated = level().getGameTime();
        getEntityData().set(STANCE, (++stanceSerial << 5) | ${start});${boss && list.some(row => row.bar) ? "\n        stanceBar();" : ""}
    }

    // Senses can replace this observation with the whole definition of the current stance.
    private LivingEntity stanceTarget() { return ${legacy ? "runtimeNearestPlayer()" : "getTarget()"}; }

${hold ? `    private void stanceHoldFacing() {
        if (!stanceChanging()) return;
        setYRot(stanceBody);
        setYBodyRot(stanceBody);
        setYHeadRot(stanceHead);
        setXRot(stancePitch);
    }

` : ""}    private void stanceTick() {
        if (level().isClientSide() || stanceUpdated == level().getGameTime()) return;
        boolean dying = isDeadOrDying();
        if (dying && stanceRank < 4) {
            stancePending = -1;
            stanceRank = 0;
            return;
        }
        ${boss ? "if (!dying && bossState() == BOSS_DORMANT) return;\n        " : ""}int current = stanceIndex();
        LivingEntity target = stanceTarget();
        boolean fighting = target != null && target.isAlive() || abilityRunning();
        if (!dying) {
            if (fighting) {
                stanceEarlierFight = true;
                stanceAlone = 0;
                stanceAge++;
            } else if (stanceEarlierFight && ++stanceAlone >= 60) {
                stanceReset();
                return;
            }
        }
        ${boss ? "if (!dying && bossState() == BOSS_CHANGE) return; " : ""}if (stanceChanging() && tickCount >= stanceChangeUntil) getEntityData().set(STANCE, getEntityData().get(STANCE) & ~16);
        if (!dying && !stanceChanging() && fighting) stanceObserve(current, target);
${eventTail ? `        if (stanceEventAt >= 0 && tickCount > stanceEventAt && tickCount <= stanceEventAt + ${eventTail}) bossShowStep(100 + current, tickCount - stanceEventAt);
` : ""}        if (stancePending < 0) return;
        int next = stancePending;
        stanceClear();
        stanceUpdated = level().getGameTime();
        stanceChangeUntil = tickCount + STANCE_CHANGE[next];${hold ? `
        if (!dying && STANCE_CHANGE[next] > 0) {
            stanceBody = yBodyRot;
            stanceHead = yHeadRot;
            stancePitch = getXRot();
            getNavigation().stop();
            setSpeed(0.0f);
            setXxa(0.0f);
            setYya(0.0f);
            setZza(0.0f);
        }` : ""}
        getEntityData().set(STANCE, (++stanceSerial << 5) | (!dying && STANCE_CHANGE[next] > 0 ? 16 : 0) | next);
        if (abilityRunning() && (stanceChanging() || !stanceKeepsAbility())) {
            ${interrupt}
        }
        if (!stanceCanWalk()) getNavigation().stop();${enterEvents ? `
        bossShowStep(100 + next, 0);${eventTail ? "\n        stanceEventAt = tickCount;" : ""}` : ""}${boss && list.some(row => row.bar) ? "\n        stanceBar();" : ""}
    }

    private void stanceObserve(int current, LivingEntity target) {
${still ? `
        var position = target == null ? null : target.position();
        boolean still = position != null && target.getUUID().equals(stancePreviousTarget) && position.distanceToSqr(stancePreviousPosition) <= 0.0001;
        stancePreviousTarget = target == null ? null : target.getUUID();
        if (!still) stancePreviousPosition = position;` : ""}
${cases(when)}${healthEdge ? "\n        stancePreviousHealth = getHealth();" : ""}
        int seconds = STANCE_TIME[current];${phaseTimeouts.length ? `
        seconds = switch (bossPhase()) {
${cases(phaseTimeouts)}
            default -> seconds;
        };` : ""}
        if (seconds > 0 && stanceAge >= seconds) stanceRequest(STANCE_NEXT[current], 1);
    }
${damage ? `
    private void stanceHit(float amount) {
${cases(rules.flatMap(({ index, rule }, slot) => rule.if === "damage_taken" ? [`        if (stanceIndex() == ${index}) {
            if (tickCount - stanceLastDamage[${slot}] >= ${ticks(rule.reset_seconds)}) stanceDamage[${slot}] = 0;
            stanceDamage[${slot}] += amount;
            stanceLastDamage[${slot}] = tickCount;
        }`] : []))}
    }
` : ""}${leave ? `
    private boolean stanceDepartureDue() {
        int current = stanceIndex();
        return STANCE_LEAVE_MOVE[current] >= 0 && stanceAge >= STANCE_LEAVE_AT[current];
    }

    private void stanceDelay() {
        int current = stanceIndex();
        stanceDeparture = -1;
        if (stancePending >= 0) return;
        if (stanceRetried++ >= STANCE_LEAVE_DELAYS[current]) stanceRequest(STANCE_LEAVE_NEXT[current], 1);
        else stanceRetryAt = tickCount + STANCE_LEAVE_RETRY[current];
    }
` : ""}\n`,
  }
}
