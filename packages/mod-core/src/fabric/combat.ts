import type { StanceWhen } from "../combat"
import type { ImpactJava } from "./impact-fx"
import type { Stances } from "../entity-runtime"
import type { compileStances } from "./entity-stances"
import { fixtureStatement } from "../fixture-events"
import { combatResult, staggerConditions, staggerList, type Stagger, type CombatAmount, type CombatCondition, type Guard, type Interrupt, type TargetBearing } from "../combat"
import type { Ability } from "../entity-runtime"

export function amountJava(amount: CombatAmount, max: string) {
  return "points" in amount ? String(amount.points) : `(${max} * ${amount.share})`
}

export function interruptCase(rule: Interrupt, index: number, parts: readonly string[] = []) {
  const where = [`tick >= ${Math.round((rule.from ?? 0) * 20)}`, rule.to !== undefined && `tick < ${Math.round(rule.to * 20)}`,
    rule.part !== undefined && `part == ${parts.includes(rule.part) ? parts.indexOf(rule.part) : -2}`].filter(Boolean).join(" && ")
  const enough = [rule.hit && `lost >= ${amountJava(rule.hit, "max")}`, rule.total && `total >= ${amountJava(rule.total, "max")}`, rule.hits && `hits >= ${rule.hits}`].filter(Boolean).join(" || ")
  return { window: `case ${index} -> ${where};`, enough: `case ${index} -> ${enough};` }
}

function combatWindows(abilities: readonly Ability[], parts: readonly string[] | undefined) {
  const rows = abilities.flatMap((ability, index) => (ability.openings ?? []).map(w => ({ ...w, index })))
  if (!rows.length) return null
  const groups = abilities.flatMap((ability, index) => (ability.breaks ?? []).map(rule => ({ ...rule, result: combatResult(rule.result), index })))
  // Part-specific windows precede whole-body windows. Future stance scales fall through to hitboxDamage.
  rows.sort((a,b) => Number(Boolean(b.part)) - Number(Boolean(a.part)))
  const windows = rows.map((w,i) => `        if (move == ${w.index} && tick >= ${Math.round(w.from*20)} && tick < ${Math.round(w.to*20)}${w.part ? ` && part == ${parts?.indexOf(w.part) ?? -2}` : ""}) return ${i};`)
  const groupMethods = groups.length ? `
    private int combatGroupSerial = -1;
    private final float[] combatCounts = new float[${groups.length}];
    private int combatBreak(int window, int serial, float raw) {
        if (combatGroupSerial != serial) {
            java.util.Arrays.fill(combatCounts, 0);
            combatGroupSerial = serial;
        }
        int group = switch (window) { ${rows.map((w,i) => `case ${i} -> ${groups.findIndex(rule => rule.index === w.index && rule.group === w.group)};`).join(" ")} default -> -1; };
        if (group < 0) return -1;
        switch (group) {
${groups.map((rule,i) => `            case ${i} -> { combatCounts[group] += ${rule.hits ? "1" : "raw"}; if (combatCounts[group] >= ${rule.hits ?? amountJava(rule.total!, "getMaxHealth()")}) return ${i}; }`).join("\n")}
        }
        return -1;
    }
` : ""
  return { groups, methods: `    private static final float[] COMBAT_SCALES = {${rows.map(w => w.damage_scale + "f").join(", ")}};

    private int combatWindow(int move, int tick, int part) {
${windows.join("\n")}
        return -1;
    }
${groupMethods}` }
}

function combatGuard(guard: NonNullable<Guard>, method = "combatFront") {
  return `    private boolean ${method}(DamageSource source) {
        if (source.getDirectEntity() == null${guard.by === "ranged" ? " || !source.is(net.minecraft.tags.DamageTypeTags.IS_PROJECTILE)" : guard.by === "melee" ? " || source.getDirectEntity() != source.getEntity() || !(source.is(net.minecraft.world.damagesource.DamageTypes.PLAYER_ATTACK) || source.is(net.minecraft.world.damagesource.DamageTypes.MOB_ATTACK) || source.is(net.minecraft.world.damagesource.DamageTypes.MOB_ATTACK_NO_AGGRO))" : ""}) return false;
        var at = source.getSourcePosition();
        if (at == null) return false;
        double dx = at.x - getX(), dz = at.z - getZ(), length = Math.sqrt(dx * dx + dz * dz);
        if (length < 0.0001) return false;
        double yaw = Math.toRadians(yBodyRot);
        return (-Math.sin(yaw) * dx + Math.cos(yaw) * dz) / length + 1e-10 >= ${Math.cos(guard.arc * Math.PI / 360)};
    }

`
}

// Each consumer supplies the observations already sampled for this decision. New senses plug in here.
export function conditionJava(rule: CombatCondition | StanceWhen, context: { health?: string; before?: string; max?: string; visible?: string; accumulated?: string; bearing?: string; stance?: string; elapsed?: string; still?: string }) {
  const need = (field: keyof typeof context) => {
    if (context[field] === undefined) throw new Error(`条件 ${rule.if} 缺少 ${field} 上下文`)
    return context[field]
  }
  switch (rule.if) {
    case "stance": return need("stance")
    case "stance_elapsed": return need("elapsed") + " >= " + Math.round(rule.seconds * 20)
    case "target_still": return need("still") + " >= " + Math.round(rule.seconds * 20)
    case "target_bearing": return need("bearing")
    case "no_sight": return "!" + need("visible")
    case "fixtures_lit": return `StudioArena.litCount(StudioArena.room(this), this, yBodyRot, ${rule.within_arc ?? 360}) >= ${rule.count}`
    case "health_above": return need("health") + " > " + rule.share
    case "health_below": return need("health") + " < " + rule.share
    case "health_point": return `${need("before")} > ${need("max")} * ${rule.share} && ${need("health")} <= ${need("max")} * ${rule.share}`
    case "damage_taken": return `${need("accumulated")} >= ${amountJava(rule.amount,need("max"))}`
  }
}

function combatStaggerJava(value: Stagger | undefined, boss: boolean, entity: string, shows: boolean, stopMotion: string, stance?: ReturnType<typeof compileStances>, impacts?: ImpactJava) {
  const rows = staggerList(value)
  if (!rows.length) return ""
  const conditions = rows.flatMap((row,index) => staggerConditions(row).map(condition => ({index, condition})))
  const switches = stance && rows.flatMap((row, index) => row.result ? [`case ${index} -> stanceRequest(${stance.indexOf(row.result.stance)}, 3);`] : [])
  const limited = rows.some(row => row.cooldown !== undefined || row.max_times !== undefined)
  const limits = limited ? `    private static final int[] STAGGER_WAIT = {${rows.map(row => Math.round((row.cooldown ?? 0) * 20)).join(", ")}};
    private static final int[] STAGGER_MAX = {${rows.map(row => row.max_times ?? 0).join(", ")}};
    private final int[] staggerUses = new int[${rows.length}], staggerReady = new int[${rows.length}];${boss ? "" : "\n    private int staggerAlone;"}
    private boolean staggerAvailable(int kind) {
        return tickCount >= staggerReady[kind] && (STAGGER_MAX[kind] == 0 || staggerUses[kind] < STAGGER_MAX[kind]);
    }
    private void clearStaggerLimits() {
        java.util.Arrays.fill(staggerUses, 0);
        java.util.Arrays.fill(staggerReady, 0);
    }
` : ""
  const edges = conditions.flatMap(({index, condition}, slot) => condition.if !== "fixtures_lit" ? [] : [`        boolean lit${slot} = ${conditionJava(condition, {})};
        if (lit${slot} && (combatLitEdges & (1L << ${slot})) == 0) combatFall(${index}, getDeltaMovement(), combatDriven(), 0);
        if (lit${slot}) combatLitEdges |= 1L << ${slot}; else combatLitEdges &= ~(1L << ${slot});`])
  const checks = conditions.map(({index,condition},i) => condition.if === "fixtures_lit" ? "" : condition.if === "health_point" ? `        if ((combatSpent & (1L << ${i})) == 0 && ${conditionJava(condition,{before:"before",health:"getHealth()",max:"getMaxHealth()"})}) {
            combatSpent |= 1L << ${i};
            if (result < 0${limited ? ` && staggerAvailable(${index})` : ""}) result = ${index};
        }` : `        if (combatStagger() < 0 && tickCount >= combatImmune[${index}]${limited ? ` && staggerAvailable(${index})` : ""}) {
            if (tickCount - combatLastHit[${i}] >= ${Math.round(condition.reset_seconds*20)}) combatPoise[${i}] = 0;
            combatLastHit[${i}] = tickCount;
            combatPoise[${i}] += raw;
            if (${conditionJava(condition,{accumulated:`combatPoise[${i}]`,max:"getMaxHealth()"})}) {
                combatPoise[${i}] = 0;
                if (result < 0) result = ${index};
            }
        }`)
  return `    private static final EntityDataAccessor<Integer> COMBAT_STAGGER = SynchedEntityData.defineId(${entity}.class, EntityDataSerializers.INT);
    private static final int[] COMBAT_DURATION = {${rows.map(row => Math.round(row.seconds*20)).join(", ")}};
    private static final float[] COMBAT_VULNERABILITY = {${rows.map(row => row.damage_scale+"f").join(", ")}};
    private static final double[] COMBAT_IMPACT = {${rows.map(row => row.knockback_scale ?? 1).join(", ")}};
    private int combatDrivenAt = -100, combatLiftAt = -100, combatKnockbacks;
    private boolean combatOwnPush;
${edges.length ? "    private long combatLitEdges;\n" : ""}    private long combatSpent;
    private boolean combatReadHealth;
    private final float[] combatPoise = new float[${conditions.length}];
    private final int[] combatLastHit = new int[${conditions.length}];
    private final int[] combatImmune = new int[${rows.length}];
${limits}    private int combatUntil, combatPending = -1;
    private int combatStagger() { return getEntityData().get(COMBAT_STAGGER) - 1; }

    private int combatTriggers(float before, float raw) {
        if (!combatReadHealth) {\n            combatReadHealth = true;\n${conditions.flatMap(({condition}, i) => condition.if === "health_point" ? [`            if (before <= getMaxHealth() * ${condition.share}) combatSpent |= 1L << ${i};`] : []).join("\n")}\n        }\n        int result = -1;
${checks.join("\n")}
        return result;
    }

    @Override public void knockback(double strength, double x, double z) {
        int stagger = combatStagger();
        var before = getDeltaMovement();
        super.knockback(stagger < 0 ? strength : strength * COMBAT_IMPACT[stagger], x, z);
        if (!before.equals(getDeltaMovement())) combatKnockbacks++;
    }

    private boolean combatDriven() {
        return combatOwnPush || tickCount <= combatDrivenAt + 6 || !getNavigation().isDone() || Math.abs(zza) + Math.abs(xxa) > 1.0e-4;
    }

    private void combatFall(int kind, net.minecraft.world.phys.Vec3 before, boolean driven, int impacts) {
        if (kind < 0 || !isAlive()${limited ? " || !staggerAvailable(kind)" : ""}) return;${boss ? "\n        if (bossState() == BOSS_CHANGE) { combatPending = kind; return; }\n        if (bossState() != BOSS_FIGHT) return;" : ""}
        if (combatStagger() >= 0) return;
        if (abilityRunning()) { stopAbility();${shows ? " abilityCutEffects();" : ""} }
        getNavigation().stop();
        setSpeed(0.0f);
        setXxa(0.0f);
        setYya(0.0f);
        setZza(0.0f);${stopMotion}
        var after = getDeltaMovement();
        // A hot hit uses half the pre-hit horizontal velocity when adding its impulse.
        // Remove our carried movement, but keep the new impulse and later collisions.
        double kept = Math.scalb(1.0, -impacts);
        double carryX = before.x * kept, carryZ = before.z * kept;
        double impact = impacts > 0 ? COMBAT_IMPACT[kind] : 1.0;
        double self = driven ? 0.0 : 1.0;
        boolean selfLift = before.y > 0.0 && tickCount <= combatLiftAt + 20;
        double y = selfLift ? Math.min(0.0, after.y) + Math.max(0.0, after.y - before.y) : after.y;
        if (impacts > 0 && y > before.y) y = Math.max(0.0, selfLift ? 0.0 : before.y) + (y - Math.max(0.0, selfLift ? 0.0 : before.y)) * impact;
        setDeltaMovement(carryX * self + (after.x - carryX) * impact, y, carryZ * self + (after.z - carryZ) * impact);
        combatDrivenAt = combatLiftAt = -100;
        combatOwnPush = false;
        getEntityData().set(COMBAT_STAGGER, kind + 1);${switches && switches.length ? `\n        switch (kind) { ${switches.join(" ")} default -> { } }` : ""}${((enters) => enters.length ? `\n        // r29: what is shown at its body the moment this kind begins.\n        switch (kind) { ${enters.join(" ")} default -> { } }` : "")(rows.flatMap((_, i) => ((slot) => slot < 0 ? [] : [`case ${i} -> abilityImpact(${slot}, position().add(0.0, getBbHeight() * 0.5, 0.0));`])(impacts?.slot(`stagger.${i}`) ?? -1)))}
        combatUntil = tickCount + COMBAT_DURATION[kind];
${limited && !boss ? "        staggerAlone = 0;\n" : ""}${limited ? `        if (STAGGER_MAX[kind] > 0) staggerUses[kind]++;
        staggerReady[kind] = combatUntil + STAGGER_WAIT[kind];
` : ""}        combatImmune[kind] = combatUntil + switch (kind) { ${rows.map((row,i) => `case ${i} -> ${Math.round(20*Math.max(0,...staggerConditions(row).flatMap(c=>c.if === "damage_taken"?[c.immune_seconds]:[])))};`).join(" ")} default -> 0; };
    }

    private void combatStaggerTick() {
        if (level().isClientSide()) return;
${limited && !boss ? `        if (getTarget() != null && getTarget().isAlive()) staggerAlone = 0;
        else if (staggerAlone < 100 && ++staggerAlone == 100) clearStaggerLimits();
` : ""}        if (combatStagger() < 0 && (Math.abs(zza) + Math.abs(xxa) > 1.0e-4 || !getNavigation().isDone())) combatDrivenAt = tickCount;
        if (onGround() && getDeltaMovement().horizontalDistanceSqr() < 1.0e-4) combatOwnPush = false;
        if (getDeltaMovement().y <= 0.0) combatLiftAt = -100;
${edges.length ? (boss ? "        if (bossState() == BOSS_FIGHT || bossState() == BOSS_CHANGE) {\n" + edges.map(edge=>edge.split("\n").map(line=>"    "+line).join("\n")).join("\n") + "\n        } else combatLitEdges = 0;\n" : edges.join("\n") + "\n") : ""}        if (combatStagger() >= 0 && tickCount >= combatUntil) getEntityData().set(COMBAT_STAGGER, 0);${boss ? `
        if (combatPending >= 0 && bossState() == BOSS_FIGHT) {
            int pending = combatPending;
            combatPending = -1;
            combatFall(pending, getDeltaMovement(), combatDriven(), 0);
        }` : ""}
    }
${boss ? `    private void combatResetStagger() {
        combatPending = -1;${limited ? "\n        clearStaggerLimits();" : ""}${edges.length ? "\n        combatLitEdges = 0;" : ""}
        combatSpent = 0;
        combatReadHealth = false;
        java.util.Arrays.fill(combatImmune, 0);
        java.util.Arrays.fill(combatPoise, 0);
        getEntityData().set(COMBAT_STAGGER, 0);
    }
` : `    @Override protected boolean isImmobile() { return super.isImmobile() || combatStagger() >= 0${stance?.hold ? " || stanceChanging()" : ""}; }\n`}`
}

export function combatHurtJava(abilities: readonly Ability[], parts: readonly string[] | undefined, parry: { head: string; blocks?: boolean }, cutEffects: boolean, guard: Guard, stagger: Stagger | undefined, entity: string, boss: boolean, cap?: number, arena?: import("../arena").Arena | null, stopMotion = "", stance?: ReturnType<typeof compileStances>, config?: Stances, impacts?: ImpactJava) {
  const windows = combatWindows(abilities, parts)
  const kinds = staggerList(stagger)
  const fixtureResults = windows?.groups.flatMap((group, index) => group.result.fixture ? [`            if (result == ${index}) ${fixtureStatement({type:"fixture", ...group.result.fixture}, arena, "finish")}`] : []) ?? []
  const interrupted = kinds.findIndex(row => row.on_interrupt)
  const overridesGuard = config?.list.some(row => row.guard !== undefined)
  const guards = overridesGuard ? config?.list.map(row => row.guard === undefined ? guard : row.guard) ?? [] : []
  const changedGuard = guards.some(Boolean)
  const front = changedGuard ? guards.flatMap((rule, index) => rule ? [combatGuard(rule, "stanceFront" + index)] : []).join("") + `    private float stanceGuard(DamageSource source) {
        return switch (stanceIndex()) {
${guards.flatMap((rule, index) => rule ? [`            case ${index} -> stanceFront${index}(source) ? ${rule.damage_scale}f : 1.0f;`] : []).join("\n")}
            default -> 1.0f;
        };
    }

` : !overridesGuard && guard ? combatGuard(guard) : ""
  const breakStance = stance && windows?.groups.flatMap((group, index) => group.result.stance ? [`if (result == ${index}) ${stance.action(group.result.stance)}`] : [])
  const interruptStance = stance && abilities.flatMap((move, index) => move.interrupt?.result ? [`if (directCut && move == ${index}) ${stance.action(move.interrupt.result.stance)}`] : [])
  if (!stagger && !guard && !changedGuard && !stance?.damage && !stance?.healthEdge && !windows && !abilities.some(ability => ability.interrupt)) return ""
  const rules = abilities.flatMap((ability, index) => ability.interrupt ? [interruptCase(ability.interrupt, index, parts)] : [])
  return `    @Override public boolean hurt(DamageSource source, float amount) {
        return combatHurt(source, amount);
    }

${combatStaggerJava(stagger, boss, entity, cutEffects, stopMotion, stance, impacts)}${windows?.methods ?? ""}${front}    private int combatSerial = -1;
    private float combatTotal;
    private int combatHits;

    private boolean combatInterrupt(int move, int tick, int part, float lost) {
        if (!ABILITY_HURT_STOPS[move]) return false;
        boolean window = switch (move) { ${rules.map(row => row.window).join(" ")} default -> true; };
        if (!window) return false;
        combatHits++;
        combatTotal += lost;
        float max = getMaxHealth(), total = combatTotal;
        int hits = combatHits;
        return switch (move) { ${rules.map(row => row.enough).join(" ")} default -> true; };
    }

    private boolean combatHurt(DamageSource source, float raw) {
        int part = ${parts ? "hitboxAttackIndex" : "-1"};${parts ? "\n        hitboxAttackIndex = -1;" : ""}
        int move = abilityIndex, serial = abilitySerial, tick = abilityTick;
        float before = getHealth();${stagger ? "\n        int priorStagger = combatStagger();\n        var beforeMotion = getDeltaMovement();\n        boolean driven = combatDriven();\n        int beforeKnockbacks = combatKnockbacks;" : ""}
        boolean eligible = !level().isClientSide() && isAlive() && !isInvulnerableTo(source) && raw > 0 && (invulnerableTime <= 10 || raw > lastHurt || source.is(net.minecraft.tags.DamageTypeTags.BYPASSES_COOLDOWN));
        ${windows ? "int window = combatWindow(move, tick, part);\n        " : ""}float amount = ${windows ? "window >= 0 ? raw * COMBAT_SCALES[window] : " : ""}${parts ? "hitboxDamage(part, raw)" : "raw"};${changedGuard ? `\n        ${windows || stagger ? `if (${[windows && "window < 0", stagger && "priorStagger < 0"].filter(Boolean).join(" && ")}) ` : ""}amount *= stanceGuard(source);` : !overridesGuard && guard ? `\n        if (${windows ? "window < 0 && " : ""}${stagger ? "priorStagger < 0 && " : ""}combatFront(source)) amount *= ${guard.damage_scale}f;` : ""}
${stagger ? "        if (priorStagger >= 0) amount *= COMBAT_VULNERABILITY[priorStagger];\n" : ""}${parry.head ? `        int parried = amount > 0${stagger ? " && priorStagger < 0" : ""} ? abilityParry(source, amount) : -1;\n` : ""}        boolean blocked = ${parry.blocks ? "parried >= 0 && PARRY_BLOCKS[parried]" : "false"};
        boolean hurt = amount > 0 && !blocked && super.hurt(source, amount);
        if (!hurt && eligible && (amount <= 0 || blocked)) {
            lastHurt = raw;
            invulnerableTime = 20;
        }
        if (level().isClientSide() || !isAlive() || !(hurt || (eligible && (amount <= 0 || blocked)))) return hurt;
        ${stance?.healthEdge ? "if (Float.isNaN(stancePreviousHealth)) stancePreviousHealth = before;\n        " : ""}${stance?.damage ? "stanceHit(raw);\n        " : ""}${windows?.groups.length ? "int result = combatBreak(window, serial, raw);\n        " : ""}${stagger ? `int fall = combatTriggers(before, ${cap === undefined ? "raw" : `Math.min(raw, ${cap}f)`});\n        ` : ""}if (move >= 0) {
            if (combatSerial != serial) { combatSerial = serial; combatHits = 0; combatTotal = 0; }
            ${fixtureResults.length ? fixtureResults.join("\n").trimStart() + "\n            " : ""}${breakStance && breakStance.length ? breakStance.join("\n            ") + "\n            " : ""}boolean cut = combatInterrupt(move, tick, part, Math.max(0, before - getHealth()));${interruptStance && interruptStance.length ? "\n            boolean directCut = cut;\n            " + interruptStance.join("\n            ") : ""}${windows?.groups.length ? `\n            cut |= switch (result) { ${windows.groups.map((group,i) => `case ${i} -> ${Boolean(group.result.interrupt)};`).join(" ")} default -> false; };` : ""}${stagger && windows?.groups.some(group => group.result.stagger) ? `\n            fall = switch (result) { ${windows.groups.flatMap((group,i) => group.result.stagger ? [`case ${i} -> ${kinds.findIndex(row => (row.id ?? "default") === group.result.stagger)};`] : []).join(" ")} default -> fall; };` : ""}
            if (cut) {${interrupted >= 0 ? `\n                if (fall < 0) fall = ${interrupted};` : ""}
                if (move == abilityIndex && serial == abilitySerial) { stopAbility();${cutEffects ? " abilityCutEffects();" : ""} }
            }
        }
        ${stagger ? "if (fall >= 0) combatFall(fall, beforeMotion, driven, combatKnockbacks - beforeKnockbacks);\n        " : ""}return hurt;
    }

`
}

type Start = Ability["start"]

const bearingKey = (rule: TargetBearing) => [rule.arc[0], rule.arc[1], Math.ceil((rule.seconds ?? 0) * 20)].join(",")

export function combatBearingJava(choices: readonly Start[]) {
  const rows = [...new Set(choices.flatMap(start => [
    ...(start.when ?? []).flatMap(rule => rule.if === "target_bearing" ? [bearingKey(rule)] : []),
    ...(start.weight_when ?? []).flatMap(rule => rule.if === "target_bearing" ? [bearingKey(rule)] : []),
  ]))].map(value => value.split(",").map(Number))
  const key = (rule: TargetBearing) => rows.findIndex(([from, to, ticks]) => [from, to, ticks].join(",") === bearingKey(rule))
  const test = (rule: TargetBearing, who: string) => `combatBearingMatches(${who}, ${key(rule)})`
  const times = rows.some(row => row[2]! > 0)
  const weighted = choices.some(start => start.weight_when?.some(rule => rule.if === "target_bearing"))
  const gates = (rules: Start["when"], who: string) => (rules ?? []).flatMap(rule => rule.if === "target_bearing" ? [" && " + test(rule, who)] : []).join("")
  return {
    test, gates, weighted, tick: times ? "combatBearingTick();" : "",
    source: !rows.length ? "" : `    private static final double[][] COMBAT_BEARINGS = { ${rows.map(row => "{" + row.join(", ") + "}").join(", ")} };
${times ? `    private final int[] combatBearingTicks = new int[COMBAT_BEARINGS.length];
    private int combatBearingTarget = -1;

    private void combatBearingTick() {
        if (level().isClientSide()) return;
        LivingEntity target = getTarget();
        int id = target == null || !target.isAlive() ? -1 : target.getId();
        if (id != combatBearingTarget) {
            java.util.Arrays.fill(combatBearingTicks, 0);
            combatBearingTarget = id;
        }
        if (id < 0) return;
        double bearing = combatBearing(target);
        for (int i = 0; i < COMBAT_BEARINGS.length; i++) {
            if (combatBearingInside(bearing, i)) combatBearingTicks[i] = Math.min(600, combatBearingTicks[i] + 1);
            else combatBearingTicks[i] = 0;
        }
    }
` : ""}`
    + `
    private double combatBearing(LivingEntity target) {
        double dx = target.getX() - getX(), dz = target.getZ() - getZ();
        if (dx * dx + dz * dz < 1.0e-8) return Double.NaN;
        return Mth.wrapDegrees(Math.toDegrees(Math.atan2(dz, dx)) - 90.0 - yBodyRot);
    }

    private boolean combatBearingInside(double angle, int slot) {
        double from = COMBAT_BEARINGS[slot][0], to = COMBAT_BEARINGS[slot][1];
        if (angle == -180.0 && to == 180.0) angle = 180.0;
        return from > to ? angle >= from || angle <= to : angle >= from && angle <= to;
    }

    private boolean combatBearingMatches(LivingEntity target, int slot) {
        return combatBearingInside(combatBearing(target), slot)${times ? " && (COMBAT_BEARINGS[slot][2] == 0 || (target.getId() == combatBearingTarget && combatBearingTicks[slot] >= COMBAT_BEARINGS[slot][2]))" : ""};
    }

`,
  }
}

export function combatWeightJava(choices: readonly Start[], bearing: ReturnType<typeof combatBearingJava>, stanceIndex?: (id: string) => number) {
  const rows = choices.flatMap((start, index) => {
    if (!start.repeat && !start.weight_when) return []
    const repeat = start.repeat
    const lines = repeat ? [`if (combatUsed[index]) weight *= ${repeat.weight_scale} + (1.0 - ${repeat.weight_scale}) * Math.min(1.0, (tickCount - combatEnded[index]) / ${Math.round(20 * repeat.recover_seconds)}.0);`] : []
    for (const rule of start.weight_when ?? []) {
      const matches = conditionJava(rule,{health:"health",visible:"visible",...(rule.if === "stance" ? { stance: stanceIndex ? `stanceIndex() == ${stanceIndex(rule.id)}` : "false" } : {}),...(rule.if === "target_bearing" ? { bearing: bearing.test(rule, "target") } : {})})
      lines.push(`if (${matches}) weight *= ${rule.scale};`)
    }
    return [`            case ${index} -> {\n${lines.map(line => "                " + line).join("\n")}\n            }`]
  })
  if (!rows.length) return ""
  return `
    private final boolean[] combatUsed = new boolean[${choices.length}];
    private final int[] combatEnded = new int[${choices.length}];

    private void combatRemember(int index) {
        combatUsed[index] = true;
        combatEnded[index] = tickCount;
    }

    private double combatWeight(int index, boolean visible${bearing.weighted ? ", LivingEntity target" : ""}) {
        double weight = ABILITY_WEIGHT[index];
        double health = getHealth() / (double) getMaxHealth();
        switch (index) {
${rows.join("\n")}
        }
        return weight;
    }
`
}
