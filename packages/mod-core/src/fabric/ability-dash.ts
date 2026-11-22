import { onceStrike } from "../once-group"
import type { ImpactJava } from "./impact-fx"
import { DASH_LIMITS, dashCarries, dashPlan, forceTicks, hitForce } from "../ability-dash"
import { TICKS } from "../ability-words"
import { shapeRange } from "../creature-abilities"
import type { Ability, AbilityHit } from "../entity-runtime"

/**
 * Boss 能力 4 as the Java a creature's class carries (`compileAbilities` writes it in): a dash the server moves it along every tick, and the forces its hits leave
 * on whoever they struck. Only vanilla names, Mojang's own, the same on Fabric 1.21.1, Forge 1.20.1 and NeoForge 1.21.1 (javac on each), so the facade targets take
 * it as the abilities' text is taken. Without a dash and without a force every piece is the empty string: such a creature's class is what it always was, to the byte.
 *
 * - A dash starts on its tick of the ability (`abilityDashStart`), and from then, after the abilities have ticked (`abilityDashTick`), the body is moved straight
 *   ahead by its own collision with the world (`move`, as a walk is: what its step height lets it climb it climbs), for as many ticks as the dash lasts, until it
 *   has gone its distance, or a wall stops it. It ends at once when the ability does (cut short, over, or the next step of a combo). The navigation is stopped every
 *   tick, and a big body's way round when stuck (`StuckGoal`) is held off while any ability runs (its `busy`), so nothing else moves the body while it dashes.
 * - The hit a dash carries is counted on every tick of it from its own moment, over the stretch the body went in that tick (points no further apart than
 *   `DASH_LIMITS.sweep`), and strikes each one it holds once in the whole dash.
 * - A force: the hit's statements are told which force they leave (`abilityForceNext`); everyone `abilityStrike` / `abilityStrikeAt` strikes then is carried from the
 *   next tick on (`abilityForceTick`, after the abilities). Mobs take the impulse on the server. Players take radial impulses where they move, on their client.
 */

const real = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(4))))
const single = (value: number) => `${real(value)}f`
/** The `MobEffects` constant of each effect a hit may give (as `entity-abilities.ts` has them). */
const MOB_EFFECTS: Record<string, string> = { slowness: "MOVEMENT_SLOWDOWN", blindness: "BLINDNESS", poison: "POISON", weakness: "WEAKNESS" }
const FORCE_KIND = { push: 0, pull: 1, side: 2 } as const

type AreaHit = Extract<AbilityHit, { type: "area" }>

/** Whether the body of the dash's hit shape holds `victim` when the creature stood `back` blocks behind where it is now: the shape tests of `entity-abilities.ts`, the body moved back along the dash. */
const inside = (hit: AreaHit, back: string) => {
  const shape = hit.shape
  if (shape.type === "arc") return `abilityDashInArc(victim, ${back}, ${real(shape.reach)}, ${real(shape.angle / 2)}, ${real(shape.low)}, ${real(shape.high)})`
  if (shape.type === "box") return `abilityDashInBox(victim, ${back}, ${real(shape.forward)}, ${real(shape.up)}, ${real(shape.left)}, ${real(shape.width)}, ${real(shape.height)}, ${real(shape.depth)})`
  if (shape.type === "sphere") return `abilityDashInSphere(victim, ${back}, ${real(shape.forward)}, ${real(shape.up)}, ${real(shape.left)}, ${real(shape.radius)})`
  throw new Error(`a dash does not carry a ${shape.type}`)
}

export function compileDashForce(input: { terrainInteractions?:boolean; abilities: readonly Ability[]; flight: boolean; steady?: boolean; impacts?: ImpactJava }) {
  const abilities = input.abilities
  // r29: the moments a dash runs into a wall (once a dash) or its hit strikes somebody, per ability (-1: none). None written, nothing below differs from what it was.
  const impactOf = (ability: number, side: "wall" | "touch") => input.impacts?.slot(`a${ability}.dash.${side}`) ?? -1
  const wallImpacts = abilities.flatMap((_, index) => (impactOf(index, "wall") >= 0 ? [index] : []))
  const plans = abilities.map((ability) => dashPlan(ability))
  const breaking = plans.some(plan => plan?.dash.break_hardness !== undefined)
  const dashes = plans.some((plan) => plan !== null)
  // Every area hit that leaves a force, numbered across the creature's abilities in order: its row of ABILITY_FORCES.
  const forces = abilities.flatMap((ability, index) => ability.hits.flatMap((hit, slot) => ((force) => (force ? [{ ability: index, slot, force }] : []))(hitForce(hit))))
  const radial = forces.some(({ force }) => force.kind !== "side")
  const offsets = forces.flatMap(({ability, slot, force}, index) => {
    const hit = abilities[ability]!.hits[slot]!
    if (force.kind === "side" || force.toward === "origin" || hit.type !== "area") return []
    const shape = hit.shape
    const bone = !!hit.bone && (!hit.place || hit.place === "self")
    return (shape.type === "box" || shape.type === "sphere") && (shape.forward || shape.left || bone)
      ? [{ index, forward: shape.forward, left: shape.left, bone, swept: dashCarries(abilities[ability]!, slot) }]
      : []
  })
  const sweptOffset = offsets.some(row => row.swept)
  const forceOf = (ability: number, slot: number) => forces.findIndex((value) => value.ability === ability && value.slot === slot)
  const carried = abilities.flatMap((ability, index) => ((plan) => (plan && plan.dash.hit !== null ? [{ ability: index, plan, hit: ability.hits[plan.dash.hit] as AreaHit }] : []))(plans[index]))
  const shapes = new Set(carried.map((value) => value.hit.shape.type))
  const wrapForce = (index: number, lines: string[]) => (index < 0 ? lines : [`abilityForceNext = ${index};`, ...lines, "abilityForceNext = -1;"])
  // 第 3 步: a dash aimed where its target will be (`abilityLeadYaw`, fabric/ability-tactics.ts), and a loop stage a wall ends (`abilityDashBumped`). Without either nothing below differs from what it was.
  const predicts = plans.some((plan) => plan?.dash.aim === "predicted")
  const bumps = dashes && abilities.some((ability) => ability.stages?.some((stage) => stage.kind === "loop" && stage.end?.wall))

  const fields = [
    ...(dashes
      ? [
          `    // ---- Boss 能力 4: the dash that runs: the ticks it still moves, the ability (and the start of it, by its serial) it belongs to, blocks a tick, blocks it may still go,
    // whether a wall stops it, the way it goes, the tick of the ability from which the hit it carries is counted, and who that hit has struck in this dash ----
    private int abilityDashLeft;
    private int abilityDashOf = -1;
    private int abilityDashSerial;
    private double abilityDashStep;
    private double abilityDashRoom;
    private boolean abilityDashWall;${breaking ? '\n    private float abilityDashHardness;\n    private int abilityDashBudget;' : ''}
    private float abilityDashYaw;
    private int abilityDashFrom;
    private final java.util.Set<Integer> abilityDashStruck = new java.util.HashSet<>();
${bumps ? "    // 第 3 步: the dash ran into a wall (what ends a loop stage that waits for one).\n    private boolean abilityDashBumped;\n" : ""}`,
        ]
      : []),
    ...(forces.length
      ? [
          `    // ---- Boss 能力 4: per force a hit leaves, its kind (0 push, 1 pull, 2 side), blocks a tick it carries at (side: negative is to the right) and for how many ticks;
    // the force the hit now being counted leaves on whoever it strikes (-1: none), and the forces still carrying someone ----
    private static final double[][] ABILITY_FORCES = {${forces.map((value) => `{${FORCE_KIND[value.force.kind]}.0, ${real(value.force.strength / TICKS)}, ${forceTicks(value.force)}.0}`).join(", ")}};
    private int abilityForceNext = -1;${sweptOffset ? "\n    private double abilityForceBack;" : ""}
    private final java.util.List<AbilityForce> abilityForces = new java.util.ArrayList<>();
`,
        ]
      : []),
  ].join("")

  const dashMethods = !dashes
    ? []
    : [
        `    /** Boss 能力 4: the running ability's dash starts: \`ticks\` ticks of \`step\` blocks, at most \`distance\` in all, the way it faces now; its hit is counted from tick \`from\` of the ability. */
    private void abilityDashStart(int ticks, double step, double distance, boolean wall, int from${predicts ? ", boolean lead" : ""}) {
${input.flight ? "        // In the air its flight is its whole movement: a dash there does nothing, as a push does nothing.\n        if (flightState() != FLIGHT_GROUND) return;\n" : ""}        abilityDashLeft = ticks;
        abilityDashOf = abilityIndex;
        abilityDashSerial = abilitySerial;
        abilityDashStep = step;
        abilityDashRoom = distance;
        abilityDashWall = wall;${breaking ? `\n        abilityDashHardness = new float[]{${plans.map(plan => single(plan?.dash.break_hardness ?? 0)).join(", ")}}[abilityIndex];\n        abilityDashBudget = 256;` : ""}
${predicts && input.steady ? "        if (lead) abilityTurnToward(abilityLeadYaw(step, ticks));\n        abilityDashYaw = abilityYaw;\n" : predicts ? "        // 第 3 步: a predicted dash goes, and faces, the way to where its target will be when it gets there.\n        abilityDashYaw = lead ? abilityLeadYaw(step, ticks) : abilityYaw;\n        abilityYaw = abilityDashYaw;\n" : "        abilityDashYaw = abilityYaw;\n"}        abilityDashFrom = from;${bumps ? "\n        abilityDashBumped = false;" : ""}
        abilityDashStruck.clear();
        getNavigation().stop();
        setDeltaMovement(0.0, getDeltaMovement().y, 0.0);
    }`,
        `    /**
     * One tick of the dash, after the abilities have ticked: the body goes straight ahead by its own collision with the world (it climbs what its step height lets it), its hit is
     * counted over the stretch it went, and the dash ends when it has gone its distance, when a wall stops it (it went under three quarters of its step and ran into something), or at once
     * when its ability is no longer the one that runs.
     */
    private void abilityDashTick() {
        if (abilityDashLeft <= 0) return;
        if (level().isClientSide() || abilityIndex != abilityDashOf || abilitySerial != abilityDashSerial || isDeadOrDying()${input.flight ? " || flightState() != FLIGHT_GROUND" : ""}) {
            abilityDashLeft = 0;
            return;
        }
        abilityDashLeft--;
        float turn = abilityDashYaw * 0.017453292f;
        double step = Math.min(abilityDashStep, abilityDashRoom);
        ${input.abilities.some(a=>a.stages?.some(s=>s.end?.collision?.length)) ? "if(abilityContact(new net.minecraft.world.phys.Vec3(-Mth.sin(turn)*step,0,Mth.cos(turn)*step))) return;\n        " : ""}double fromX = getX();
        double fromZ = getZ();
        getNavigation().stop();
${breaking ? `        var delta = new net.minecraft.world.phys.Vec3(-Mth.sin(turn) * step, 0.0, Mth.cos(turn) * step);
        if (abilityDashHardness > 0 && abilityDashBudget > 0 && level() instanceof net.minecraft.server.level.ServerLevel world)
            abilityDashBudget -= StudioBreak.sweep(world, this, delta, abilityDashHardness, abilityDashBudget);
        ${input.terrainInteractions ? "if(abilityDashHardness>0) StudioTerrain.smash(level(),abilityDashHardness,p->getBoundingBox().expandTowards(delta).intersects(p.getBoundingBox()));\n        " : ""}move(net.minecraft.world.entity.MoverType.SELF, delta);` : "        move(net.minecraft.world.entity.MoverType.SELF, new net.minecraft.world.phys.Vec3(-Mth.sin(turn) * step, 0.0, Mth.cos(turn) * step));"}
        double moved = Math.sqrt((getX() - fromX) * (getX() - fromX) + (getZ() - fromZ) * (getZ() - fromZ));
        abilityDashRoom -= moved;
        setDeltaMovement(0.0, getDeltaMovement().y, 0.0);
${bumps ? "        if (horizontalCollision && moved < step * 0.75) abilityDashBumped = true;\n" : ""}${
  carried.length
    ? `        if (abilityTick >= abilityDashFrom) {
            switch (abilityDashOf) {
${carried.map((value) => `                case ${value.ability} -> abilityDashHit${value.ability}(moved);`).join("\n")}
                default -> { }
            }
        }
`
    : ""
}${wallImpacts.length ? `        if (horizontalCollision && moved < step * 0.75) {
            var way = new net.minecraft.world.phys.Vec3(-Mth.sin(turn), 0.0, Mth.cos(turn));
            switch (abilityDashOf) {
${wallImpacts.map((index) => `                case ${index} -> abilityImpactOnce(${impactOf(index, "wall")}, abilityImpactFront(way));`).join("\n")}
                default -> { }
            }
        }
` : ""}        if (abilityDashRoom <= 1.0e-3 || (abilityDashWall && horizontalCollision && moved < step * 0.75)) abilityDashLeft = 0;
    }`,
        ...carried.map(({ ability, plan, hit }) => {
          const force = forceOf(ability, plan.dash.hit!)
          return `    /** Ability ${ability} "${abilities[ability]!.id}": its hit ${plan.dash.hit} counted over the \`moved\` blocks the dash went this tick, each one it holds struck once in the dash. */
    private void abilityDashHit${ability}(double moved) {
        int parts = Math.max(1, (int) Math.ceil(moved / ${real(DASH_LIMITS.sweep)}));
${wrapForce(force, [
  ...(abilities[ability]!.events.some(event => event.type === "fixture" && typeof event.which === "object" && "in_hit" in event.which && event.which.in_hit === plan.dash.hit) ? [
    `fixtureHitMasks[${plan.dash.hit}] |= StudioArena.mask(StudioArena.room(this), victim -> {`,
    ...(hit.fixture_walls && hit.blocked_by_walls ? ["    if (!abilityClear(position().add(0.0, 0.05, 0.0), victim)) return false;"] : []),
    `    for (int part = 0; part <= parts; part++) if (${inside(hit, "moved * part / parts")}) return true;`,
    "    return false;", "});",
  ] : []),
  `for (LivingEntity victim : abilityVictims(${hit.hits === "everyone"}, ${real(shapeRange(hit.shape))} + moved)) {`,
  "    if (abilityDashStruck.contains(victim.getId())) continue;",
  "    boolean inside = false;",
  ...(offsets.some(row => row.index === force) ? [
    "    for (int part = 0; part <= parts && !inside; part++) {",
    "        abilityForceBack = moved * part / parts;",
    `        inside = ${inside(hit, "abilityForceBack")};`,
    "    }",
  ] : [`    for (int part = 0; part <= parts && !inside; part++) inside = ${inside(hit, "moved * part / parts")};`]),
  "    if (!inside) continue;",
  ...(hit.blocked_by_walls ? ["    if (!abilityClear(position().add(0.0, 0.05, 0.0), victim)) continue;"] : []),
  "    abilityDashStruck.add(victim.getId());",
  ...onceStrike(hit, `    if (!abilityStrike(victim, ${single(hit.damage)}, ${real(hit.knockback)})) continue;`),
  ...(impactOf(ability, "touch") >= 0 ? [`    abilityImpact(${impactOf(ability, "touch")}, abilityImpactOn(victim));`] : []),
  ...hit.effects.map((effect) => `    victim.addEffect(new MobEffectInstance(MobEffects.${MOB_EFFECTS[effect.effect]}, ${effect.duration_ticks}, ${effect.amplifier}), this);`),
  "}",
])
  .map((line) => `        ${line}`)
  .join("\n")}
    }`
        }),
        ...(shapes.has("arc")
          ? [
              `    /** The arc test of \`abilityInArc\`, with the body \`back\` blocks behind where it is now along the dash. */
    private boolean abilityDashInArc(LivingEntity victim, double back, double reach, double half, double low, double high) {
        net.minecraft.world.phys.AABB box = victim.getBoundingBox();
        if (box.maxY < getY() + low || box.minY > getY() + high) return false;
        double ahead = abilityAhead(victim.getX(), victim.getZ()) + back;
        double left = abilityLeft(victim.getX(), victim.getZ());
        double flat = Math.sqrt(ahead * ahead + left * left);
        double wide = victim.getBbWidth() / 2.0;
        if (flat - wide > reach) return false;
        if (flat <= wide) return true;
        return Math.abs(Math.toDegrees(Math.atan2(left, ahead))) <= half + Math.toDegrees(Math.asin(Math.min(1.0, wide / flat)));
    }`,
            ]
          : []),
        ...(shapes.has("box")
          ? [
              `    /** The box test of \`abilityInBox\`, with the body \`back\` blocks behind where it is now along the dash. */
    private boolean abilityDashInBox(LivingEntity victim, double back, double forward, double up, double left, double width, double height, double depth) {
        net.minecraft.world.phys.AABB box = victim.getBoundingBox();
        double wide = victim.getBbWidth() / 2.0;
        return box.maxY >= getY() + up - height / 2.0 && box.minY <= getY() + up + height / 2.0
            && Math.abs(abilityAhead(victim.getX(), victim.getZ()) + back - forward) <= depth / 2.0 + wide
            && Math.abs(abilityLeft(victim.getX(), victim.getZ()) - left) <= width / 2.0 + wide;
    }`,
            ]
          : []),
        ...(shapes.has("sphere")
          ? [
              `    /** The ball test of \`abilityInSphere\`, with the body \`back\` blocks behind where it is now along the dash. */
    private boolean abilityDashInSphere(LivingEntity victim, double back, double forward, double up, double left, double radius) {
        float turn = abilityYaw * 0.017453292f;
        double ahead = forward - back;
        return victim.getBoundingBox().distanceToSqr(new net.minecraft.world.phys.Vec3(getX() - ahead * Mth.sin(turn) + left * Mth.cos(turn), getY() + up, getZ() + ahead * Mth.cos(turn) + left * Mth.sin(turn))) <= radius * radius;
    }`,
            ]
          : []),
      ]

  const forceMethods = !forces.length
    ? []
    : [
        `    /** Boss 能力 4: one force a hit left on one it struck: who, how, from where (and how near the pull stops), which way is aside, how long still, and where they were a tick ago. */
    private static final class AbilityForce {
        private final LivingEntity victim;
        private final int kind;
        private final double strength;
        private final double x;
        private final double z;
        private final double room;
        private final double sideX;
        private final double sideZ;
        private int left;
        private double lastX;
        private double lastY;
        private double lastZ;

        private AbilityForce(LivingEntity victim, double[] force, double x, double z, double room, float yaw) {
            this.victim = victim;
            this.kind = (int) force[0];
            this.strength = force[1];
            this.left = (int) force[2];
            this.x = x;
            this.z = z;
            this.room = room;
            float turn = yaw * 0.017453292f;
            this.sideX = Mth.cos(turn);
            this.sideZ = Mth.sin(turn);
            this.lastX = victim.getX();
            this.lastY = victim.getY();
            this.lastZ = victim.getZ();
        }
    }`,
        `    /** The hit now being counted struck \`victim\`: the force it leaves carries them from the next tick on, from the place (x, z) the hit came from; a newer force on them replaces an older one. */
    private void abilityForceOn(LivingEntity victim, double x, double z, double room) {
        abilityForces.removeIf(force -> force.victim == victim);
        abilityForces.add(new AbilityForce(victim, ABILITY_FORCES[abilityForceNext], x, z, room, abilityYaw));
    }`,
        ...(offsets.length ? [`    private void abilityForceFrom(LivingEntity victim, double x, double z, double room, float yaw) {
        double forward, left;
        switch (abilityForceNext) {
${offsets.map(row => `            case ${row.index} -> { forward = ${real(row.forward)}${row.bone ? " + abilityShiftF" : ""}${row.swept ? " - abilityForceBack" : ""}; left = ${real(row.left)}${row.bone ? " + abilityShiftL" : ""}; }`).join("\n")}
            default -> { abilityForceOn(victim, x, z, room); return; }
        }
        float turn = yaw * 0.017453292f;
        abilityForceOn(victim, x - forward * Mth.sin(turn) + left * Mth.cos(turn),
            z + forward * Mth.cos(turn) + left * Mth.sin(turn), 0.0);
    }`] : []),
        `    /** Every tick, after its abilities: each force carries its victim once more; one that is over, or whose victim is gone, is let go. Its own death lets go of all of them. */
    private void abilityForceTick() {
        if (abilityForces.isEmpty() || level().isClientSide()) return;
        if (isDeadOrDying()) {
            abilityForces.clear();
            return;
        }
        abilityForces.removeIf(this::abilityForceStep);
    }`,
        `    /**
     * One tick of one force. The push is what makes the one it carries go \`strength\` blocks a tick once their drag is counted (the ground they stand on, or the air), softened by
     * their knockback resistance: a push away from where the hit came from, a pull toward it (none once they are at its edge), or aside. True when it is over.
     */
    private boolean abilityForceStep(AbilityForce force) {
        LivingEntity victim = force.victim;
        if (force.left-- <= 0 || !victim.isAlive() || victim.isRemoved() || victim.level() != level() || (victim instanceof Player player && (player.isCreative() || player.isSpectator()))) return true;
        double dx = force.sideX * Math.signum(force.strength);
        double dz = force.sideZ * Math.signum(force.strength);
        if (force.kind != 2) {
            dx = victim.getX() - force.x;
            dz = victim.getZ() - force.z;
            double flat = Math.sqrt(dx * dx + dz * dz);
            if (flat < 1.0e-4) {
                // Right on the place it came from: a push goes away from the creature, a pull has nowhere to go.
                dx = force.kind == 0 ? victim.getX() - getX() : 0.0;
                dz = force.kind == 0 ? victim.getZ() - getZ() : 0.0;
                flat = Math.max(1.0e-4, Math.sqrt(dx * dx + dz * dz));
            }
            double way = force.kind == 1 ? (flat - force.room - victim.getBbWidth() / 2.0 <= 0.25 ? 0.0 : -1.0) : 1.0;
            dx = dx / flat * way;
            dz = dz / flat * way;
        }
        double resist = Math.max(0.0, 1.0 - victim.getAttributeValue(net.minecraft.world.entity.ai.attributes.Attributes.KNOCKBACK_RESISTANCE));
${radial ? `        if (force.kind != 2 && victim instanceof net.minecraft.server.level.ServerPlayer player) {
            double speed = Math.abs(force.strength) * resist;
            if (speed > 0.0 && (dx != 0.0 || dz != 0.0)) StudioPlayerForce.send(player, dx * speed, dz * speed);
            return false;
        }
` : ""}        double drag = victim.onGround() ? victim.level().getBlockState(victim.blockPosition().below()).getBlock().getFriction() * 0.91 : 0.91;
        double add = Math.abs(force.strength) * (1.0 - drag) * resist;
        if (victim instanceof Player) {
            // A player's own game moves them; the server only hears where they went. Their speed is the last tick's step, slowed as their game slows it (and falling as it falls), with the push added, sent to their game.
            double fall = victim.onGround() ? 0.0 : (victim.getY() - force.lastY - 0.08) * 0.98;
            victim.setDeltaMovement((victim.getX() - force.lastX) * drag + dx * add, fall, (victim.getZ() - force.lastZ) * drag + dz * add);
            victim.hurtMarked = true;
        } else {
            victim.setDeltaMovement(victim.getDeltaMovement().add(dx * add, 0.0, dz * add));
        }
        victim.hasImpulse = true;
        force.lastX = victim.getX();
        force.lastY = victim.getY();
        force.lastZ = victim.getZ();
        return false;
    }`,
      ]

  return {
    /** The statements on the tick a dash of ability `index` starts, by tick (with the moves, before its hits). */
    due: (index: number) => ((plan) => (plan ? [{ tick: plan.start, lines: [`abilityDashStart(${plan.ticks}, ${real(plan.step)}, ${real(plan.dash.distance)}, ${plan.dash.stop_at_wall}, ${plan.hitFrom ?? "Integer.MAX_VALUE"}${predicts ? `, ${plan.dash.aim === "predicted"}` : ""});`] }] : []))(plans[index]),
    /** True for the hit a dash carries: it is not counted at its own moment. */
    carried: (index: number, slot: number) => dashCarries(abilities[index]!, slot),
    /** A hit's statements, told which force they leave on whoever they strike. */
    forced: (index: number, slot: number, lines: string[]) => wrapForce(forceOf(index, slot), lines),
    fields,
    methods: [...dashMethods, ...forceMethods].map((method) => `${method}\n\n`).join(""),
    /** The line `abilityStrike` ends with before it says the victim was struck: the force goes on them, from the creature. */
    strike: offsets.length ? "\n        if (abilityForceNext >= 0) abilityForceFrom(victim, getX(), getZ(), getBbWidth() / 2.0, abilityYaw);" : forces.length ? "\n        if (abilityForceNext >= 0) abilityForceOn(victim, getX(), getZ(), getBbWidth() / 2.0);" : "",
    /** The same for `abilityStrikeAt`: from the place that held them. */
    strikeAt: offsets.length ? "\n        if (abilityForceNext >= 0) abilityForceFrom(victim, abilityPlaces[slot][at], abilityPlaces[slot][at + 2], 0.0, abilityPlaceYaw[slot]);" : forces.length ? "\n        if (abilityForceNext >= 0) abilityForceOn(victim, abilityPlaces[slot][at], abilityPlaces[slot][at + 2], 0.0);" : "",
    /** What the creature's tick runs after its abilities. */
    tick: `${dashes ? "\n        abilityDashTick();" : ""}${forces.length ? "\n        abilityForceTick();" : ""}`,
  }
}
