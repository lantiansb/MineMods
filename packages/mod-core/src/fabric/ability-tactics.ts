import { TICKS } from "../ability-words"
import { BETWEEN_STYLE_IDS, TACTICS_LIMITS, betweenStages, leapPlan, stagePlan, type Between, type Tactics } from "../ability-tactics"
import type { Ability, Combo } from "../entity-runtime"
import type { ImpactJava } from "./impact-fx"

/**
 * 第 3 步 (Boss AI 与出招) as the Java a creature's class carries (`compileAbilities` writes it in): an ability that keeps turning to its target until a set moment and at
 * its own speed, a leap the server flies it along, an aim that leads a moving target, stages whose loop ends on a condition, combos that branch, and how it moves, waits and
 * reacts between abilities. Only vanilla names, Mojang's own, the same on Fabric 1.21.1, Forge 1.20.1 and NeoForge 1.21.1 (javac on each), so the facade targets take it as
 * the abilities' text is taken. A creature that writes none of it gets the empty string from every piece: its class is what it always was, to the byte.
 *
 * - Tracking: `ABILITY_TRACK_UNTIL` is the tick until which a `track` ability turns (its wind-up when it says nothing), `ABILITY_TURN` the degrees a tick it turns by.
 * - Leading: every tick the target's motion is measured from where it stood the tick before (`abilityLeadTick`: a player's own game moves the player, so the server's
 *   velocity of a player is nothing; where they went is what is known), smoothed over a few ticks. A predicted leap or dash aims at where that motion takes them in the time it needs.
 * - A leap: at its tick the landing place is decided (`abilityLeapStart`), its height the ground its body stands on there (`abilityLeapGround`), not the target's: a landing put
 *   short of them, held to its reach or led ahead need not be at their height. Every tick after the abilities the body is put on the arc toward it by its own collision with
 *   the world (`abilityLeapTick`), so it lands on the tick written; a hit on the landing tick is counted after it is down.
 * - Stages: each stage that names a motion tells every player's game to play it when it begins (`abilityStageClip`, its own slots after the abilities' in `ABILITY_CLIPS`, so the
 *   synced number the abilities' controller reads is the only thing it is told). A loop that ends early moves the ability's tick to the end of the loop: what lay in the rest of it never happens.
 *   What a blow after the loop needs begun inside it (its warning: the places it lands at are decided then, and a volley from the sky is thrown) still happens, in full: the tick then
 *   goes on from where the first such warning not yet begun begins, and up to the loop's end those ticks begin only such warnings (`abilityQuiet`); everything else of them is the
 *   rest of the loop, and does not happen.
 * - Branching combos: `COMBO_BRANCHES` rows are tried in order at the tick of a step they name (or its end); the first that holds says which step follows (`comboGo`).
 * - Between abilities: the movement goal hands its target to `tacticsMove` after nothing could start; it counts how long the target has stayed far or close, moves by the
 *   style of the phase, and a reaction narrows the next choice to the abilities it names (`tacticsPicks`) for `TACTICS_LIMITS.urge` ticks. A pause holds every start back
 *   after an ability ends; an enrage below its share of life speeds the walk, scales the damage of its strikes and shortens its waits.
 */

const real = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(4))))
const list = (values: readonly (number | boolean | string)[]) => `{${values.join(", ")}}`
const tickOf = (seconds: number) => Math.round(seconds * TICKS)
/** A bit mask of choices (abilities, then combos) as a Java int literal: the 32nd choice is the sign bit, which `&` reads like any other. */
const mask = (bits: readonly number[]) => String(bits.reduce((value, bit) => value | (1 << bit), 0))

export type TacticsInput = {
  /** r29: the moments of impact (`fabric/impact-fx.ts`): a loop's collision rule or its own wall or touch may show one where it meets. */
  impacts?: ImpactJava
  staggerIds?:readonly string[];
  staggerLimits?: boolean;
  steady?: import("../creature-steady").SteadyPlan | null
  combat?: boolean | undefined
  abilities: readonly Ability[]
  combos: readonly Combo[]
  /** The model's name, as the abilities' own clips are named (`animation.<model>.<clip>`). */
  model: string
  tactics: Tactics | null
  /** A boss's phases, whose `between` each sets the style from that phase on; none for a creature that is no boss. */
  phases: readonly { between?: Between | undefined }[]
  boss: boolean
  flight: boolean
  stationary: boolean
  /** The creature has a dash (`fabric/ability-dash.ts`): a loop that ends cuts it short, and a wall it ran into ends a loop. */
  dashes: boolean
  /** The creature has warned hits: a step a branch cancels takes its warnings back. */
  warned: boolean
  /**
   * Per ability, what is begun before the blow it is for (a warning: its places decided and drawn, a warned volley thrown): the tick it begins on and the tick of that blow.
   * A loop that ends early still begins those of the blows after it (`abilityQuiet`).
   */
  setups?: readonly (readonly { start: number; hit: number }[])[]
}

export function compileTactics(input: TacticsInput) {
  const { abilities, combos } = input
  const choices = [...abilities.map((ability) => ability.id), ...combos.map((combo) => combo.id)]
  const turning = Boolean(input.steady) || abilities.some((ability) => ability.track_until !== undefined || ability.turn_speed !== undefined)
  const leaps = abilities.map((ability) => leapPlan(ability))
  const reserves = leaps.some(p=>p && (p.leap.lock_at || p.leap.landing_hit !== undefined))
  const leaping = leaps.some((plan) => plan !== null)
  const predictsDash = abilities.some((ability) => ability.moves.some((move) => "type" in move && move.type === "dash" && move.aim === "predicted"))
  const predicts = predictsDash || leaps.some((plan) => plan?.leap.aim === "predicted")
  const stages = abilities.map((ability) => stagePlan(ability))
  const staged = stages.some((plan) => plan.length > 0)
  const loops = stages.flatMap((plan, ability) => plan.flatMap((stage) => (stage.end ? [{ ability, stage }] : [])))
  // Per ability with a loop that may end early: the ticks inside the loop on which something a blow after it needs begins (`setups`), in order, and the loop's end. A loop that
  // ends goes on from the first of them still to come; from the first of them to the loop's end only those begin (`abilityQuiet`). Null where nothing after the loop begins inside it.
  const quiet = abilities.map((_, ability) => {
    const loop = loops.find((value) => value.ability === ability)
    if (!loop) return null
    const { from, to } = loop.stage
    const lands = [...new Set((input.setups?.[ability] ?? []).filter((setup) => setup.hit >= to && setup.start > from && setup.start < to).map((setup) => setup.start))].sort((a, b) => a - b)
    return lands.length ? { lands, end: to } : null
  })
  const quiets = quiet.some((value) => value !== null)
  // The slot after the abilities' own of every stage that switches the motion, in order.
  const slots = stages.flatMap((plan, ability) => plan.flatMap((stage) => (stage.clip ? [{ ability, stage, clip: stage.clip }] : [])))
  const slotOf = (ability: number, index: number) => abilities.length + slots.findIndex((slot) => slot.ability === ability && slot.stage.index === index)
  const chance = combos.some(combo => combo.branches?.some(branch => branch.chance !== undefined))
  const branching = combos.some((combo) => combo.branches?.length)
  const touches = loops.some((loop) => loop.stage.end?.touch)
  const lands = loops.some((loop) => loop.stage.end?.landed) || combos.some((combo) => combo.branches?.some((branch) => branch.landed !== undefined))
  const tactics = input.tactics
  const styled = Boolean(tactics?.between || input.phases.some((phase) => phase.between)) && !input.stationary
  const between = betweenStages(tactics, input.phases)
  const reacts = Boolean(tactics?.kited || tactics?.hugged)
  const picks = Boolean(tactics?.kited || tactics?.hugged?.use)
  const enrage = tactics?.enrage ?? null
  const paused = between.some((stage) => stage.pause > 0)
  const moves = styled || reacts
  const indexOf = (id: string) => choices.indexOf(id)

  const fields: string[] = []
  const methods: string[] = []
  if (turning)
    fields.push(`    // ---- 第 3 步: per ability, the tick until which one that turns to its target (track) keeps turning, and the degrees a tick it turns by${input.flight ? " (-1: as its flight turns)" : ""} ----
    private static final int[] ABILITY_TRACK_UNTIL = ${list(abilities.map((ability) => Math.min(Math.max(1, tickOf(ability.length)), tickOf(ability.track_until ?? ability.windup))))};
    private static final float[] ABILITY_TURN = ${list(abilities.map((ability) => (ability.turn_speed === undefined ? (input.steady ? `${real(input.steady.ability_turn / TICKS)}f` : input.flight ? "-1.0f" : "30.0f") : `${real(ability.turn_speed / TICKS)}f`)))};
`)
  if (turning && input.flight && !input.steady)
    methods.push(`    /** 第 3 步: what it turns by in a tick while it tracks: its flight's turn, and no more than the ability's own speed where it names one (on the ground, that speed alone). */
    private float abilityTurnCap() {
        float cap = flightTurnCap();
        float own = ABILITY_TURN[abilityIndex];
        if (own < 0.0f) return cap;
        return flightState() != FLIGHT_GROUND ? Math.min(cap, own) : own;
    }`)
  if (input.steady) {
    fields.push(`    private long abilityTurnAt = -1;
    private float abilityTurnSpent;
`)
    methods.push(`    // Tracking and a launch on the same tick share one turn allowance.
    private void abilityTurnToward(float yaw) {
        long now = level().getGameTime();
        if (abilityTurnAt != now) {
            abilityTurnAt = now;
            abilityTurnSpent = 0.0f;
        }
        float cap = Math.max(0.0f, ABILITY_TURN[abilityIndex] - abilityTurnSpent);
        float step = Mth.clamp(Mth.wrapDegrees(yaw - abilityYaw), -cap, cap);
        abilityTurnSpent += Math.abs(step);
        abilityYaw += step;
        setYRot(abilityYaw);
        setYBodyRot(abilityYaw);
    }`)
  }
  if (predicts) {
    fields.push(`    // ---- 第 3 步: how the one it fights has moved, blocks a tick, smoothed over the last ticks (where they went: a player's own game moves the player), and who that is ----
    private int abilityLeadOf = -1;
    private double abilityLeadLastX;
    private double abilityLeadLastZ;
    private double abilityLeadVX;
    private double abilityLeadVZ;
`)
    methods.push(`    /** 第 3 步: once a tick, how the one it fights (or is about to) has moved since the tick before, half the last measure and half this one. A jump of more than a block in a tick (a teleport) is not counted. */
    private void abilityLeadTick() {
        if (level().isClientSide()) return;
        LivingEntity target = abilityTarget != null ? abilityTarget : getTarget();
        if (target == null || !target.isAlive()) {
            abilityLeadOf = -1;
            return;
        }
        if (target.getId() != abilityLeadOf) {
            abilityLeadOf = target.getId();
            abilityLeadVX = 0.0;
            abilityLeadVZ = 0.0;
        } else {
            double vx = target.getX() - abilityLeadLastX;
            double vz = target.getZ() - abilityLeadLastZ;
            if (vx * vx + vz * vz > 1.0) {
                vx = 0.0;
                vz = 0.0;
            }
            abilityLeadVX = abilityLeadVX * 0.5 + vx * 0.5;
            abilityLeadVZ = abilityLeadVZ * 0.5 + vz * 0.5;
        }
        abilityLeadLastX = target.getX();
        abilityLeadLastZ = target.getZ();
    }`)
  }
  if (predictsDash)
    methods.push(`    /**
     * 第 3 步: the way to where the one it fights will be when a dash of \`step\` blocks a tick gets there (no more than \`most\` ticks ahead, nor ${TACTICS_LIMITS.lead}): their motion times the ticks it needs
     * to reach where that motion takes them, worked out three times over (each guess of the ticks moves the place, which changes the ticks).
     */
    private float abilityLeadYaw(double step, int most) {
        LivingEntity target = abilityTarget;
        double x = target.getX();
        double z = target.getZ();
        for (int round = 0; round < 3; round++) {
            double ticks = Math.min(Math.min(most, ${TACTICS_LIMITS.lead}), Math.sqrt((x - getX()) * (x - getX()) + (z - getZ()) * (z - getZ())) / Math.max(1.0e-3, step));
            x = target.getX() + abilityLeadVX * ticks;
            z = target.getZ() + abilityLeadVZ * ticks;
        }
        if ((x - getX()) * (x - getX()) + (z - getZ()) * (z - getZ()) < 1.0e-4) return abilityYaw;
        return (float) (Mth.atan2(z - getZ(), x - getX()) * 180.0 / Math.PI) - 90.0f;
    }`)
  if (leaping) {
    fields.push(`    // ---- 第 3 步: the leap that runs: the ability (and the start of it, by its serial) it belongs to, the ticks it is in the air and how many have gone, where it left from and where it lands, the height of its arc ----
    private int abilityLeapOf = -1;
    private int abilityLeapSerial;
    private int abilityLeapTicks;
    private int abilityLeapStep;
    private double abilityLeapFromX;
    private double abilityLeapFromY;
    private double abilityLeapFromZ;
    private double abilityLeapToX;
    private double abilityLeapToY;
    private double abilityLeapToZ;
    private double abilityLeapHeight;
`)
    methods.push(`    /**
     * 第 3 步: the running ability's leap starts: it lands \`ticks\` ticks from now where the one it fights stands${predicts ? " (or, \\`predicted\\`, will stand then by how they have been moving)" : ""}, \`shortBy\` blocks short of them and no
     * further than \`most\`, along an arc \`height\` blocks above the straight line. It turns to face where it goes.
     */
    private void abilityLeapStart(int ticks, double height, double most, double shortBy, boolean predicted${reserves ? ", boolean reserve, boolean stored" : ""}) {
${input.flight ? "        // In the air its flight is its whole movement: a leap there does nothing, as a push does nothing.\n        if (flightState() != FLIGHT_GROUND) return;\n" : ""}        ${reserves ? "if (!stored) {\n        " : ""}LivingEntity target = abilityTarget;
        double x = target.getX();
        double z = target.getZ();
${predicts ? "        if (predicted) {\n            x += abilityLeadVX * Math.min(ticks, " + TACTICS_LIMITS.lead + ");\n            z += abilityLeadVZ * Math.min(ticks, " + TACTICS_LIMITS.lead + ");\n        }\n" : ""}        double dx = x - getX();
        double dz = z - getZ();
        double flat = Math.sqrt(dx * dx + dz * dz);
        double go = Math.max(0.0, Math.min(most, flat - shortBy));
${reserves ? "" : "        abilityLeapFromX = getX();\n        abilityLeapFromY = getY();\n        abilityLeapFromZ = getZ();\n"}        ${input.steady ? `if (flat > 1.0e-4) abilityTurnToward((float) Math.toDegrees(Mth.atan2(dz, dx)) - 90.0f);
        float launch = abilityYaw * 0.017453292f;
        abilityLeapToX = getX() - Mth.sin(launch) * go;
        abilityLeapToZ = getZ() + Mth.cos(launch) * go;` : `abilityLeapToX = flat > 1.0e-4 ? getX() + dx / flat * go : getX();
        abilityLeapToZ = flat > 1.0e-4 ? getZ() + dz / flat * go : getZ();`}
        abilityLeapToY = abilityLeapGround(abilityLeapToX, abilityLeapToZ, target.getY());${reserves ? `
        }
        if (reserve) return;
        double dx = abilityLeapToX - getX(), dz = abilityLeapToZ - getZ();
        double flat = Math.hypot(dx,dz);${input.steady ? "\n        if (stored && flat > 1.0e-4) abilityTurnToward((float) Math.toDegrees(Mth.atan2(dz, dx)) - 90.0f);" : ""}
        abilityLeapFromX = getX();
        abilityLeapFromY = getY();
        abilityLeapFromZ = getZ();` : ""}
        abilityLeapHeight = height;
        abilityLeapTicks = Math.max(1, ticks);
        abilityLeapStep = 0;
        abilityLeapOf = abilityIndex;
        abilityLeapSerial = abilitySerial;
${input.steady ? "" : "        if (flat > 1.0e-4) abilityYaw = (float) (Mth.atan2(dz, dx) * 180.0 / Math.PI) - 90.0f;\n"}        getNavigation().stop();
    }`)
    methods.push(`    /**
     * 第 3 步: the height a leap comes down at where it lands (\`x\`, \`z\`): the top of what its body stands on there. It is looked for from \`prefer\` (the height of the one it fights) a
     * block at a time, up first and the nearest first, no more than ${TACTICS_LIMITS.leap.ground.up} blocks above the higher of that and the creature nor ${TACTICS_LIMITS.leap.ground.down} below the lower: the first height its whole box fits
     * at is let down onto what is under it by its own collision with the world. \`prefer\` when nothing there can be stood on (it then falls from there, as anything does).
     */
    private double abilityLeapGround(double x, double z, double prefer) {
        double high = Math.max(prefer, getY()) + ${real(TACTICS_LIMITS.leap.ground.up)};
        double low = Math.min(prefer, getY()) - ${real(TACTICS_LIMITS.leap.ground.down)};
        net.minecraft.world.phys.AABB box = getBoundingBox().move(x - getX(), -getY(), z - getZ());
        for (int step = 0; prefer + step <= high || prefer - step >= low; step++) {
            for (int side = 1; side >= (step == 0 ? 1 : -1); side -= 2) {
                double from = prefer + side * step;
                if (from > high || from < low) continue;
                net.minecraft.world.phys.AABB at = box.move(0.0, from, 0.0);
                if (!level().noCollision(this, at)) continue;
                double depth = from - low;
                net.minecraft.world.phys.Vec3 down = collideBoundingBox(this, new net.minecraft.world.phys.Vec3(0.0, -depth, 0.0), at, level(), List.of());
                if (down.y > -depth + 1.0e-4) return from + down.y;
            }
        }
        return prefer;
    }`)
    methods.push(`    /**
     * 第 3 步: one tick of the leap, after the abilities have ticked: the body is put where the arc has it on this tick, by its own collision with the world (a wall stops it there). It takes
     * no fall damage from it. It ends when it is down, or at once when its ability is no longer the one that runs.
     */
    private void abilityLeapTick() {
        if (abilityLeapStep >= abilityLeapTicks) return;
        if (level().isClientSide() || abilityIndex != abilityLeapOf || abilitySerial != abilityLeapSerial || isDeadOrDying()${input.flight ? " || flightState() != FLIGHT_GROUND" : ""}) {
            abilityLeapTicks = 0;
            abilityLeapStep = 0;
            return;
        }
        abilityLeapStep++;
        double part = (double) abilityLeapStep / abilityLeapTicks;
        double x = abilityLeapFromX + (abilityLeapToX - abilityLeapFromX) * part;
        double y = abilityLeapFromY + (abilityLeapToY - abilityLeapFromY) * part + 4.0 * abilityLeapHeight * part * (1.0 - part);
        double z = abilityLeapFromZ + (abilityLeapToZ - abilityLeapFromZ) * part;
        // On its last tick it is pressed onto what it lands on, so it is on the ground the tick it comes down.
        if (abilityLeapStep >= abilityLeapTicks) y -= 0.1;
        getNavigation().stop();
        move(net.minecraft.world.entity.MoverType.SELF, new net.minecraft.world.phys.Vec3(x - getX(), y - getY(), z - getZ()));
        setDeltaMovement(0.0, 0.0, 0.0);
        hasImpulse = true;
        resetFallDistance();
    }`)
  }
  if (slots.length || touches || lands || loops.length)
    fields.push(`    // ---- 第 3 步: ${[slots.length ? "a count that changes whenever a stage switches the motion (beside the abilities' own count)" : null, lands ? "whether a blow of the running ability (or combo step) has struck somebody" : null].filter(Boolean).join("; ") || "stages"} ----
${slots.length ? "    private int abilityStageSerial;\n" : ""}${lands ? "    private boolean abilityLanded;\n" : ""}`)
  if (slots.length)
    methods.push(`    /** 第 3 步: a stage of the running ability begins with its own motion: every player's game is told to play the motion in slot \`slot\` of ABILITY_CLIPS from its start. */
    private void abilityStageClip(int slot) {
        getEntityData().set(ABILITY, (++abilityStageSerial << 8) | (slot + 1));
    }`)
  if (touches)
    methods.push(`    /** 第 3 步: its body touches a living thing that is not of its own kind (a creative or spectating player is not counted). */
    private boolean abilityTouching() {
        return !level().getEntitiesOfClass(LivingEntity.class, getBoundingBox().inflate(0.35),
            other -> other != this && other.isAlive() && other.getType() != getType() && !other.isSpectator() && !(other instanceof Player player && player.isCreative())).isEmpty();
    }`)
  const loopCondition = (end: NonNullable<ReturnType<typeof stagePlan>[number]["end"]>) =>
    [end.reach !== undefined ? `distanceTo(abilityTarget) <= ${real(end.reach)}` : null, end.touch ? "abilityTouching()" : null, end.wall ? (input.dashes ? "(horizontalCollision || abilityDashBumped)" : "horizontalCollision") : null, end.landed ? "abilityLanded" : null].filter(Boolean).join(" || ") || "false"
  // Where a loop whose end has come goes on from: its end, or the first tick still to come on which something a blow after it needs begins.
  const landing = (ability: number, to: number) => ((value) => (value ? `(${value.lands.map((tick) => `abilityTick < ${tick} ? ${tick} : `).join("")}${to})` : String(to)))(quiet[ability])
  if (quiets) {
    fields.push(`    // ---- 第 3 步: a loop that ended early and went on from where a warning of a blow after it begins: from the first tick to the second (the loop's end) of the start whose
    // serial is the third, its ticks begin only such warnings ----
    private int abilityQuietFrom;
    private int abilityQuietUntil;
    private int abilityQuietSerial = -1;
`)
    methods.push(`    /** 第 3 步: tick \`tick\` of the running ability is the rest of a loop that ended early: only what a blow after the loop needs (its warning) begins on it, nothing else of it happens. */
    private boolean abilityQuiet(int tick) { return abilityQuietSerial == abilitySerial && tick >= abilityQuietFrom && tick < abilityQuietUntil; }`)
  }
  const collisions = loops.filter(row=>row.stage.end?.collision?.length)
  // r29: a loop whose own wall or touch shows something where it meets it (slots of `impactSlots`; -1: none).
  const impactEnds = loops.flatMap(({ ability, stage }) => ((wall, touch) => (wall < 0 && touch < 0 ? [] : [{ ability, stage, wall, touch }]))(input.impacts?.slot(`a${ability}.s${stage.index}.wall`) ?? -1, input.impacts?.slot(`a${ability}.s${stage.index}.touch`) ?? -1))
  if(collisions.length) methods.push(`    private boolean abilityContact(Vec3 delta) {
        if(abilityIndex<0) return false;
        var hit=StudioTerrain.contact(this,delta); if(hit==null) return false;
${collisions.map(({ability,stage})=>`        if(abilityIndex==${ability} && abilityTick>=${stage.from} && abilityTick<${stage.to}) {
${stage.end!.collision!.map((rule,c)=>`            if(hit.kind().equals("${rule.when.with}")) {
${(input.impacts?.slot(`a${ability}.s${stage.index}.c${c}`) ?? -1) < 0 ? "" : `                abilityImpactOnce(${input.impacts!.slot(`a${ability}.s${stage.index}.c${c}`)}, abilityImpactFront(delta));\n`}${rule.result.shatter_terrain===undefined?"":`                if(hit.part()!=null) StudioTerrain.smash(level(),${rule.result.shatter_terrain},p->p==hit.part());\n`}${rule.result.stagger ? `                combatFall(${input.staggerIds?.indexOf(rule.result.stagger) ?? -1}, getDeltaMovement(), combatDriven(), 0); return true;` : rule.result.interrupt ? "                stopAbility(); return true;" : "                return false;"}
            }`).join("\n")}
        }`).join("\n")}
        return false;
    }`)
  if (loops.length)
    methods.push(`    /** 第 3 步: a loop of the running ability whose end has come (what ends it holds) goes on from its last tick: what lay in the rest of it does not happen${quiets ? " (but what a blow after it needs begun inside it still begins: `abilityQuiet`)" : ""}. */
    private void abilityLoopCheck() {${quiets ? "\n        if (abilityQuiet(abilityTick)) return;" : ""}
        ${collisions.length ? "if(horizontalCollision && abilityContact(new Vec3(-Mth.sin(abilityYaw*0.017453292f)*0.12,0,Mth.cos(abilityYaw*0.017453292f)*0.12))) return;\n        " : ""}int to = switch (abilityIndex) {
${loops.map(({ ability, stage }) => `            case ${ability} -> abilityTick >= ${stage.from} && abilityTick < ${stage.to} && (${loopCondition(stage.end!)}) ? ${landing(ability, stage.to)} : -1;`).join("\n")}
            default -> -1;
        };
        if (to < 0) return;${impactEnds.length ? `
        // r29: what ended it, shown where it met it: the wall ahead, the living thing it touched.
        switch (abilityIndex) {
${impactEnds.map(({ ability, stage, wall, touch }) => `            case ${ability} -> {${wall < 0 ? "" : `
                if (${input.dashes ? "horizontalCollision || abilityDashBumped" : "horizontalCollision"}) abilityImpactOnce(${wall}, abilityImpactFront(new Vec3(-Mth.sin(abilityYaw * 0.017453292f), 0.0, Mth.cos(abilityYaw * 0.017453292f))));`}${touch < 0 ? "" : `
                var touched = abilityTouched();
                if (touched != null) abilityImpactOnce(${touch}, abilityImpactOn(touched));`}
            }`).join("\n")}
            default -> { }
        }` : ""}${
          quiets
            ? `
        // From \`to\` up to the loop's own end its ticks begin only the warnings of what comes after it.
        abilityQuietUntil = switch (abilityIndex) {
${quiet.flatMap((value, ability) => (value ? [`            case ${ability} -> ${value.end};`] : [])).join("\n")}
            default -> to;
        };
        abilityQuietFrom = to;
        abilityQuietSerial = abilitySerial;`
            : ""
        }
        abilityTick = to - 1;${input.dashes ? "\n        abilityDashLeft = 0;" : ""}${leaping ? "\n        abilityLeapTicks = 0;\n        abilityLeapStep = 0;" : ""}
    }`)

  // ---- branching combos ----
  const branchRows = combos.flatMap((combo, index) =>
    (combo.branches ?? []).map((branch) => {
      const step = abilities.find((ability) => ability.id === combo.steps[branch.after])
      const at = branch.at === undefined ? -1 : Math.min(Math.max(1, tickOf(step?.length ?? branch.at)), tickOf(branch.at))
      return `{${index}, ${branch.after}, ${at}, ${real(branch.min_distance ?? 0)}, ${real(branch.max_distance ?? 1024)}, ${branch.landed === undefined ? -1 : branch.landed ? 1 : 0}, ${branch.to === null ? -1 : branch.to}${chance ? `, ${real(branch.chance ?? 1)}` : ""}}`
    }),
  )
  if (branching) {
    fields.push(`    // ---- 第 3 步: the branches of its combos, tried in order: per row the combo, the step it follows, the tick of that step it is tried on (-1: when the step ends), the nearest and
    // farthest its target may stand, whether the step's blows struck somebody (1), nobody (0) or either (-1), and the step that follows (-1: the combo ends) ----
    private static final double[][] COMBO_BRANCHES = {${branchRows.join(", ")}};
`)
    methods.push(`    /** 第 3 步: the step a branch of the running combo leads to from its step now, at tick \`at\` of it (-1: its end): the first row that holds, -1 to end the combo, or -2 when none holds. */
    private int comboBranch(int at) {${input.combat ? `\n        if (!combatAllows(${abilities.length} + comboIndex)) return -1;` : ""}
        double distance = abilityTarget == null ? 0.0 : distanceTo(abilityTarget);
        for (double[] row : COMBO_BRANCHES) {
            if ((int) row[0] != comboIndex || (int) row[1] != comboStep || (int) row[2] != at) continue;
            if (distance < row[3] || distance > row[4]) continue;
${lands ? "            if (row[5] >= 0.0 && (row[5] > 0.5) != abilityLanded) continue;\n" : ""}${chance ? "            if (row[7] < 1 && getRandom().nextDouble() >= row[7]) continue;\n" : ""}            return (int) row[6];
        }
        return -2;
    }`)
    methods.push(`    /** 第 3 步: the combo goes on with step \`next\` once its gap is over (\`tickAbility\`), or ends (-1) as any ability does. */
    private void comboGo(int next) {
        if (next < 0) {
            stopAbility();
            return;
        }
        comboStep = next;
        comboGap = COMBO_GAP[comboIndex];${lands ? "\n        abilityLanded = false;" : ""}
        // Nothing runs between two steps, but the combo does (\`abilityRunning\`): it neither walks nor starts anything else.
        abilityIndex = -1;
    }`)
    methods.push(`    /** 第 3 步: at a tick of the running step a branch names, the first that holds cuts the step short there (its recovery cancelled) and leads on. */
    private void comboCancel() {
        int next = comboBranch(abilityTick);
        if (next == -2) return;${input.warned ? "\n        abilityWarnTakeBack();" : ""}
        comboGo(next);
    }`)
  }
  const comboFinished = branching
    ? `    /** The step that runs is over: a branch of its combo (\`COMBO_BRANCHES\`) says which step follows, else the next one does once the gap is over (\`tickAbility\`); after the last step, or with no combo, it ends as any ability does. */
    private void comboFinished() {
        if (comboIndex < 0) {
            stopAbility();
            return;
        }
        int next = comboBranch(-1);
        if (next == -2) next = comboStep + 1 < COMBO_STEPS[comboIndex].length ? comboStep + 1 : -1;
        comboGo(next);
    }`
    : null

  // ---- between abilities ----
  const kited = tactics?.kited ?? null
  const hugged = tactics?.hugged ?? null
  const mixed = between.some(stage => stage.mix)
  const sides = Boolean(input.steady) || between.some(stage => stage.side_ticks !== undefined)
  const paths = Boolean(input.steady) || between.some(stage => stage.path_ticks !== undefined)
  const stand = between.some(stage => stage.stand_distance !== undefined)
  const resume = stand && (input.steady || between.some(stage => stage.stand_resume !== undefined))
  if (moves || paused || enrage) {
    fields.push(`    // ---- 第 3 步: between its abilities. Per stage of its fight (${input.boss ? "the first phase, then each phase after a line of life" : "one"}): how it moves (${BETWEEN_STYLE_IDS.map((style, index) => `${index} ${style}`).join(", ")}), the distance it keeps and the ticks it rests after an ability ----
    private static final int[] TACTICS_STYLE = ${list(between.map((stage) => BETWEEN_STYLE_IDS.indexOf(stage.style)))};
    private static final double[] TACTICS_DISTANCE = ${list(between.map((stage) => real(stage.distance)))};
    private static final int[] TACTICS_PAUSE = ${list(between.map((stage) => tickOf(stage.pause)))};
${kited ? `    // Kited: further than this, this many ticks, and the abilities (a bit each, abilities then combos) it then picks from.\n    private static final double TACTICS_KITE_DISTANCE = ${real(kited.distance)};\n    private static final int TACTICS_KITE_TICKS = ${Math.max(1, tickOf(kited.seconds))};\n    private static final int TACTICS_KITE_MASK = ${mask(kited.use.map(indexOf).filter((index) => index >= 0))};\n` : ""}${hugged ? `    // Hugged: nearer than this, this many ticks, and the abilities it then picks from (0: it hops back instead).\n    private static final double TACTICS_HUG_DISTANCE = ${real(hugged.distance)};\n    private static final int TACTICS_HUG_TICKS = ${Math.max(1, tickOf(hugged.seconds))};\n    private static final int TACTICS_HUG_MASK = ${mask((hugged.use ?? []).map(indexOf).filter((index) => index >= 0))};\n` : ""}${enrage ? `    // Enraged below this share of its life: its walk, the damage of its strikes and its waits are multiplied by these.\n    private static final double TACTICS_ENRAGE_BELOW = ${real(enrage.below)};\n    private static final double TACTICS_ENRAGE_SPEED = ${real(enrage.speed)};\n    private static final float TACTICS_ENRAGE_DAMAGE = ${real(enrage.damage)}f;\n    private static final double TACTICS_ENRAGE_WAIT = ${real(enrage.cooldown)};\n` : ""}    // The age until which it rests, the way it circles or strafes (1 or -1), the age it last moved between abilities, how long its target has stayed far and close,
    // and the abilities a reaction holds its next choice to (0: none) for how many ticks more.
    private int tacticsRestUntil;
    private int tacticsSide = 1;
    private int tacticsMovedAt = -2;
    private int tacticsKited;
    private int tacticsHugged;
    private int tacticsUrge;
    private int tacticsUrgeLeft;
`)
    methods.push(`    /** 第 3 步: which stage of its fight it is in: ${input.boss ? "its phase" : "always the one"}. */
    private int tacticsStage() { return ${input.boss ? "Math.min(bossPhase(), TACTICS_STYLE.length - 1)" : "0"}; }`)
    if (mixed) {
      fields.push(`    private int tacticsNextPick, tacticsPicked, tacticsPickedStage = -1;
    private static final int[] TACTICS_PICK_TICKS = ${list(between.map(stage => stage.mix?.every_ticks ?? 0))};
    private static final int[][] TACTICS_CHOICES = {${between.map(stage => list((stage.mix?.choices ?? []).flatMap(choice => [BETWEEN_STYLE_IDS.indexOf(choice.style), choice.weight]))).join(", ")}};
    private static final int[] TACTICS_TOTAL = ${list(between.map(stage => stage.mix?.choices.reduce((sum, c) => sum + c.weight, 0) ?? 0))};`)
      methods.push(`    private int tacticsPick(int stage) {
        if (TACTICS_TOTAL[stage] == 0) return TACTICS_STYLE[stage];
        if (tacticsPickedStage == stage && tickCount < tacticsNextPick) return tacticsPicked;
        tacticsPickedStage = stage;
        tacticsNextPick = tickCount + TACTICS_PICK_TICKS[stage];
        int roll = getRandom().nextInt(TACTICS_TOTAL[stage]);
        int[] choices = TACTICS_CHOICES[stage];
        for (int i = 0; i < choices.length; i += 2) {
            roll -= choices[i + 1];
            if (roll < 0) return tacticsPicked = choices[i];
        }
        return TACTICS_STYLE[stage];
    }`)
    }
    if (sides) fields.push(`    private int tacticsNextSide;
    private static final int[] TACTICS_SIDE_TICKS = ${list(between.map(stage => stage.side_ticks ?? input.steady?.side_ticks ?? 80))};`)
    if (paths) fields.push(`    private static final int[] TACTICS_PATH_TICKS = ${list(between.map(stage => stage.path_ticks ?? input.steady?.path_ticks ?? 5))};`)
    if (resume) fields.push(`    private boolean tacticsStanding;\n    private static final double[] TACTICS_RESUME = ${list(between.map(stage => real(stage.stand_resume ?? (stage.stand_distance ?? 0) + (input.steady ? 3 : 0))))};`)
    if (stand) fields.push(`    private static final double[] TACTICS_STAND = ${list(between.map(stage => real(stage.stand_distance ?? 0)))};`)
    if (enrage)
      methods.push(`    /** 第 3 步: enraged: its life is below its line. */
    private boolean tacticsEnraged() { return getHealth() <= TACTICS_ENRAGE_BELOW * getMaxHealth(); }

    /** 第 3 步: what the damage of its strikes is multiplied by: its enrage's number while enraged. */
    private float tacticsDamageScale() { return tacticsEnraged() ? TACTICS_ENRAGE_DAMAGE : 1.0f; }

    /** 第 3 步: what every speed it walks at is multiplied by (its plain chase as much as a style's): its enrage's number while enraged. */
    private double tacticsPace() { return tacticsEnraged() ? TACTICS_ENRAGE_SPEED : 1.0; }`)
    methods.push(`    /** 第 3 步: a wait of \`ticks\`${enrage ? ", shortened while it is enraged" : ""}. */
    private int tacticsWait(int ticks) { return ${enrage ? "tacticsEnraged() ? (int) Math.round(ticks * TACTICS_ENRAGE_WAIT) : ticks" : "ticks"}; }`)
    if (picks)
      methods.push(`    /** 第 3 步: whether a reaction lets choice \`index\` be picked now: none holds the choice, or it is one the reaction names. */
    private boolean tacticsPicks(int index) { return tacticsUrge == 0 || (tacticsUrge & (1 << index)) != 0; }`)
    if (hugged && !hugged.use)
      methods.push(`    /** 第 3 步: hugged for too long, it hops back out of their reach (on the ground only). */
    private void tacticsHop(LivingEntity target) {
        if (!onGround()) return;
        double dx = getX() - target.getX();
        double dz = getZ() - target.getZ();
        double flat = Math.max(1.0e-3, Math.sqrt(dx * dx + dz * dz));
        getNavigation().stop();
        setDeltaMovement(dx / flat * 0.8, 0.4, dz / flat * 0.8);
        hasImpulse = true;
    }`)
    if (styled)
      methods.push(`    /** 第 3 步: faces \`target\` by at most 30 degrees a tick, head and body (a strafe goes the way the body faces). */
    private void tacticsFace(LivingEntity target) {
        getLookControl().setLookAt(target, 30.0f, 30.0f);
        lookAt(target, 30.0f, 30.0f);
        setYBodyRot(getYRot());
    }`)
    if (moves)
      methods.push(`    /**
     * 第 3 步: nothing could start this tick: it counts how long its target has stayed far or close (a reaction then holds its next choice${hugged && !hugged.use ? ", or it hops back" : ""}), and ${styled ? "moves by the style of its stage" : "lets its own walk go on"}.
     * True when it has moved (the goal then does nothing else this tick).
     */
    private boolean tacticsMove(LivingEntity target) {
${input.flight ? "        if (flightState() != FLIGHT_GROUND) return false;\n" : ""}        if (tacticsMovedAt != tickCount - 1) {
            tacticsKited = 0;
            tacticsHugged = 0;
        }
        tacticsMovedAt = tickCount;
        double distance = distanceTo(target);
        if (tacticsUrgeLeft > 0 && --tacticsUrgeLeft == 0) tacticsUrge = 0;
${kited ? `        tacticsKited = distance > TACTICS_KITE_DISTANCE ? tacticsKited + 1 : 0;
        if (tacticsKited >= TACTICS_KITE_TICKS) {
            tacticsKited = 0;
            tacticsUrge = TACTICS_KITE_MASK;
            tacticsUrgeLeft = ${TACTICS_LIMITS.urge};
        }
` : ""}${hugged ? `        tacticsHugged = distance < TACTICS_HUG_DISTANCE ? tacticsHugged + 1 : 0;
        if (tacticsHugged >= TACTICS_HUG_TICKS) {
            tacticsHugged = 0;
${hugged.use ? `            tacticsUrge = TACTICS_HUG_MASK;\n            tacticsUrgeLeft = ${TACTICS_LIMITS.urge};` : "            tacticsHop(target);\n            return true;"}
        }
` : ""}${
        styled
          ? `        int stage = tacticsStage();
        double want = TACTICS_DISTANCE[stage];
        double speed = ${enrage ? "tacticsPace()" : "1.0"};
${stand ? `        if (${resume ? "(tacticsStanding = TACTICS_STAND[stage] > 0 && distance <= (tacticsStanding ? TACTICS_RESUME[stage] : TACTICS_STAND[stage]))" : "TACTICS_STAND[stage] > 0 && distance <= TACTICS_STAND[stage]"}) {
            getNavigation().stop();
            tacticsFace(target);
            return true;
        }
` : ""}        ${sides ? `if (tickCount >= tacticsNextSide) {
            tacticsSide = getRandom().nextBoolean() ? 1 : -1;
            tacticsNextSide = tickCount + TACTICS_SIDE_TICKS[stage];
        }` : "if (tickCount % 80 == 0) tacticsSide = getRandom().nextBoolean() ? 1 : -1;"}
        switch (${mixed ? "tacticsPick(stage)" : "TACTICS_STYLE[stage]"}) {
            case 1 -> {
                // Round them at its distance, a little further round each time the way is looked for.
                getLookControl().setLookAt(target, 30.0f, 30.0f);
                ${input.steady ? "boolean retreating = steadyRetreating(target);\n                " : ""}if (tickCount % ${paths ? "TACTICS_PATH_TICKS[stage]" : "5"} == 0) {
                    ${input.steady ? `double room = Math.min(want, getBbWidth());
                    var around = getBoundingBox().move(target.position().subtract(position())).inflate(room, 0.0, room);
                    boolean far = distance > want + Math.max(4.0, getBbWidth() * 2.0);
                    boolean detour = !hasLineOfSight(target) || level().getBlockCollisions(this, around).iterator().hasNext();
                    if (far || detour || (retreating && distance > want)) {
                        // Slow the straight pursuit near its chosen distance instead of alternating with circling.
                        double pace = retreating && !detour ? Mth.clamp((distance - want) / Math.max(2.0, getBbWidth()), 0.35, 1.2) : 1.2;
                        steadyPursue(target, pace * speed, !detour);
                        return true;
                    }
                    steadyChasePath = null;
                    ` : ""}double angle = Math.atan2(getZ() - target.getZ(), getX() - target.getX()) + tacticsSide * 0.6;
                    getNavigation().moveTo(target.getX() + Math.cos(angle) * want, target.getY(), target.getZ() + Math.sin(angle) * want, speed);
                }
            }
            case 2 -> {
                // Sideways, facing them, nearer or further to keep its distance.
                getNavigation().stop();
                tacticsFace(target);
                float forward = distance > want + 1.0 ? 0.5f : distance < want - 1.0 ? -0.5f : 0.0f;
                getMoveControl().strafe(forward * (float) speed, 0.5f * tacticsSide * (float) speed);
            }
            case 3 -> {
                // Up to its distance, then it stands facing them.
                if (distance > want) {
                    ${input.steady ? "if (steadyCloseIn(target, want, speed)) return true;\n                    if (tickCount % TACTICS_PATH_TICKS[stage] == 0)" : "if (tickCount % 5 == 0 || getNavigation().isDone())"} getNavigation().moveTo(target, speed);
                } else {
                    getNavigation().stop();
                    tacticsFace(target);
                }
            }
            case 4 -> {
                // It keeps its distance: nearer, it steps back facing them; much further, it comes closer.
                if (distance < want - 1.0) {
                    getNavigation().stop();
                    tacticsFace(target);
                    getMoveControl().strafe(-0.6f * (float) speed, 0.0f);
                } else if (distance > want + 1.5) {
                    ${input.steady ? "if (steadyCloseIn(target, want, speed)) return true;\n                    if (tickCount % TACTICS_PATH_TICKS[stage] == 0)" : "if (tickCount % 5 == 0 || getNavigation().isDone())"} getNavigation().moveTo(target, speed);
                } else {
                    getNavigation().stop();
                    tacticsFace(target);
                }
            }
            case 5 -> {
                // It walks at them and every so often springs forward.
                ${input.steady ? "if (tickCount % TACTICS_PATH_TICKS[stage] == 0)" : "if (tickCount % 5 == 0 || getNavigation().isDone())"} getNavigation().moveTo(target, speed);
                if (onGround() && tickCount % 16 == 0 && distance > 2.0) {
                    double dx = target.getX() - getX();
                    double dz = target.getZ() - getZ();
                    double flat = Math.max(1.0e-3, Math.sqrt(dx * dx + dz * dz));
                    setDeltaMovement(dx / flat * 0.5 * speed, 0.42, dz / flat * 0.5 * speed);
                    hasImpulse = true;
                }
            }
            default -> ${input.steady ? "{ if (tickCount % TACTICS_PATH_TICKS[stage] == 0) getNavigation().moveTo(target, speed); }" : "getNavigation().moveTo(target, speed);"}
        }
        return true;
`
          : "        return false;\n"
      }    }`)
  }

  const due = (index: number) => [
    ...stages[index]!.flatMap((stage) => (stage.clip ? [{ tick: stage.from, lines: [`abilityStageClip(${slotOf(index, stage.index)});`] }] : [])),
    ...((plan) => (plan ? [{ tick: plan.start, lines: [`abilityLeapStart(${plan.ticks}, ${real(plan.leap.height)}, ${real(plan.leap.max_distance)}, ${real(plan.leap.short ?? 0)}, ${plan.leap.aim === "predicted"}${reserves ? `, false, ${!!plan.leap.lock_at || plan.leap.landing_hit !== undefined}` : ""});`] }] : []))(leaps[index]),
  ]
  const restLines = moves || paused || enrage ? `\n        tacticsRestUntil = tickCount + tacticsWait(TACTICS_PAUSE[tacticsStage()]);\n        tacticsUrge = 0;\n        tacticsUrgeLeft = 0;\n        tacticsKited = 0;\n        tacticsHugged = 0;` : ""
  return {
    /** Per extra entry of ABILITY_CLIPS (`clips`), the ability whose stage it is: a slot the synced number names is an ability's, or one of these. */
    slotOwners: slots.map((slot) => slot.ability),
    /** 第 3 步: per ability, the ticks from the first warning of a blow after its loop that may begin inside it to the loop's end (null: none): when the loop ended early, only such warnings begin on them (`abilityQuiet`). */
    quiet: (index: number) => ((value) => (value ? { from: value.lands[0]!, to: value.end } : null))(quiet[index]),
    /** The extra entries of ABILITY_CLIPS: the stages' own motions (a loop's played over and over). */
    clips: slots.map((slot) => `        RawAnimation.begin().${slot.stage.kind === "loop" ? "thenLoop" : "thenPlay"}("animation.${input.model}.${slot.clip}"),\n`).join(""),
    fields: fields.join(""),
    methods: methods.map((method) => `${method}\n\n`).join(""),
    due,
    landingHit: (index:number) => leaps[index]?.leap.landing_hit,
    prepare(index:number) {
      const p=leaps[index]
      if (!p || (!p.leap.lock_at && p.leap.landing_hit === undefined)) return []
      const tick=p.leap.lock_at ? 0 : p.start
      const horizon=p.start+p.ticks-tick
      return [{tick, prepares: p.start + p.ticks, lines:[`abilityLeapStart(${horizon}, ${real(p.leap.height)}, ${real(p.leap.max_distance)}, ${real(p.leap.short ?? 0)}, ${p.leap.aim==="predicted"}, true, false);`]}]
    },
    /** The expression of the tick until which the running ability turns, where the wind-up was. */
    trackUntil: turning ? "ABILITY_TRACK_UNTIL[abilityIndex]" : null,
    /** What a tick's turn is capped by while it tracks, where 30 (or the flight's turn) was. */
    turnCap: turning ? (input.flight ? "abilityTurnCap()" : "ABILITY_TURN[abilityIndex]") : null,
    /** Statements after the running ability's step of a tick: a loop that ends, a branch that cuts a combo step short. */
    after: `${loops.length ? "\n        if (abilityIndex >= 0) abilityLoopCheck();" : ""}${combos.some((combo) => combo.branches?.some((branch) => branch.at !== undefined)) ? `\n        if (abilityIndex >= 0 && comboIndex >= 0${quiets ? " && !abilityQuiet(abilityTick)" : ""}) comboCancel();` : ""}`,
    /** The line a strike ends with before it says the victim was struck. */
    strike: lands ? "\n        abilityLanded = true;" : "",
    /** What the damage of a strike is multiplied by, written after the others. */
    damage: enrage ? " * tacticsDamageScale()" : "",
    /** What the speed of its plain walk to its target (no style of its stage: the goal's own chase, a runtime's movement) is multiplied by, written after it. */
    pace: enrage ? " * tacticsPace()" : "",
    /** More reasons an ability may not start now. */
    mayStart: `${moves || paused || enrage ? " || tickCount < tacticsRestUntil" : ""}${picks && !input.combat ? " || !tacticsPicks(index)" : ""}`,
    /** The lines stopAbility begins with. */
    stop: `${restLines}${lands ? "\n        abilityLanded = false;" : ""}`,
    /** The wait of a choice, written around its ticks. */
    wait: (ticks: string) => (enrage ? `tacticsWait(${ticks})` : ticks),
    /** A combo's next step starts: what it struck is counted afresh. */
    stepStart: lands && !branching ? "\n        abilityLanded = false;" : "",
    /** The goal's call after nothing could start ("" when it has no say). */
    move: moves ? "tacticsMove(target)" : "",
    comboFinished,
    /** What the creature's tick runs after its abilities. */
    tick: `${leaping ? "\n        abilityLeapTick();" : ""}${predicts ? "\n        abilityLeadTick();" : ""}`,
    /** The dash has these: a predicted aim (`abilityLeadYaw`), and a loop that a wall ends (`abilityDashBumped`). */
    dash: { predicts: predictsDash, bumps: input.dashes && loops.some((loop) => loop.stage.end?.wall) },
  }
}
