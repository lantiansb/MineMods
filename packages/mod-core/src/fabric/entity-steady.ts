import type { SteadyPlan } from "../creature-steady"

export function steadyControls(s: SteadyPlan | null, entity: string, busy: string, flying: boolean, alignBeforeStart = false, walking = "") {
  if (!s) return ""
  const ground = flying ? "flightState() == FLIGHT_GROUND" : "true"
  return `    private static final float STEADY_BODY = ${s.body_turn / 20}f;
    private static final float STEADY_HEAD = ${s.head.turn / 20}f;
    private static final float STEADY_YAW = ${s.head.yaw}f;
    private boolean steadyTurning;
    private int steadyMovedAt = -1;
    private int steadyNextPath;
    private int steadySign, steadyOppositeAt = -1, steadyLastRequest = -1;
    private int steadyChaseTarget = -1;
    private net.minecraft.world.level.pathfinder.Path steadyChasePath;
    private int steadyMovingTarget = -1, steadySampleAt = -1, steadyMotionAt = -1, steadyMotionSince;
    private boolean steadyRetreatConfirmed;
    private float steadyMotionHeading = Float.NaN;
    private double steadySampleX, steadySampleZ;

    private void steadyPursue(net.minecraft.world.entity.LivingEntity target, double speed, boolean open) {
        steadyChaseTarget = target.getId();
        steadyChasePath = getNavigation().moveTo(target, speed) && open ? getNavigation().getPath() : null;
    }

    private boolean steadyRetreating(net.minecraft.world.entity.LivingEntity target) {
        steadyRetreatConfirmed = false;
        double x = target.getX(), z = target.getZ();
        if (steadyMovingTarget != target.getId() || steadySampleAt < tickCount - 3) {
            steadyMovingTarget = target.getId();
            steadySampleAt = tickCount;
            steadySampleX = x;
            steadySampleZ = z;
            steadyMotionHeading = Float.NaN;
            return false;
        }
        double mx = x - steadySampleX, mz = z - steadySampleZ;
        steadySampleAt = tickCount;
        steadySampleX = x;
        steadySampleZ = z;
        // Observe the target's motion in world space. Our own turn must not reset a straight retreat.
        if (mx * mx + mz * mz >= 0.000625) {
            float heading = (float)Math.toDegrees(Mth.atan2(mz, mx)) - 90.0f;
            if (Float.isNaN(steadyMotionHeading) || steadyMotionAt < tickCount - 3
                    || Math.abs(Mth.wrapDegrees(heading - steadyMotionHeading)) > 30.0f) {
                steadyMotionHeading = heading;
                steadyMotionSince = tickCount;
            }
            steadyMotionAt = tickCount;
        }
        if (Float.isNaN(steadyMotionHeading) || steadyMotionAt < tickCount - 3
                || tickCount - steadyMotionSince < ${Math.max(25, s.path_ticks)}) return false;
        float bearing = (float)Math.toDegrees(Mth.atan2(z - getZ(), x - getX())) - 90.0f;
        steadyRetreatConfirmed = Math.abs(Mth.wrapDegrees(steadyMotionHeading - bearing)) <= 40.0f;
        return steadyRetreatConfirmed;
    }

    // A straight pursuit can use the live bearing instead of alternating between the two edges of grid waypoints.
    private float steadyChaseHeading(double y) {
        var target = getTarget();
        if (!steadyRetreatConfirmed || steadySampleAt < tickCount - 1 || target == null
                || target.getId() != steadyMovingTarget || target.getId() != steadyChaseTarget || steadyChasePath == null
                || getNavigation().getPath() != steadyChasePath || getNavigation().isDone()
                || !onGround() || Math.abs(y - getY()) > 0.5 || !hasLineOfSight(target)) return Float.NaN;
        double dx = target.getX() - getX(), dz = target.getZ() - getZ();
        double distance = Math.hypot(dx, dz);
        if (distance < 1.0e-4) return Float.NaN;
        double ahead = Math.min(2.0, distance) / distance;
        if (!steadyLevelStep(dx * ahead, dz * ahead)) return Float.NaN;
        return (float)Math.toDegrees(Mth.atan2(dz, dx)) - 90.0f;
    }

    private boolean steadyCloseIn(net.minecraft.world.entity.LivingEntity target, double distance, double speed) {
        if (!onGround() || Math.abs(target.getY() - getY()) > 0.5 || !hasLineOfSight(target)) return false;
        double dx = target.getX() - getX(), dz = target.getZ() - getZ();
        double flat = Math.hypot(dx, dz);
        double gap = flat - distance;
        if (gap <= 0 || gap > Math.max(10.0, getBbWidth() * 2.0)) return false;
        double ahead = Math.min(2.0, flat) / flat;
        double stepX = dx * ahead, stepZ = dz * ahead;
        if (!steadyLevelStep(stepX, stepZ)) return false;
        if (!getNavigation().isDone()) getNavigation().stop();
        getMoveControl().setWantedPosition(getX() + stepX, getY(), getZ() + stepZ, speed * Math.min(1.0, gap / 0.75));
        return true;
    }

    private boolean steadyLevelStep(double stepX, double stepZ) {
        for (double part = 0.5; part <= 1.0; part += 0.5) {
            var floor = net.minecraft.core.BlockPos.containing(getX() + stepX * part, getY() - 0.5, getZ() + stepZ * part);
            if (!level().getBlockState(floor).isFaceSturdy(level(), floor, net.minecraft.core.Direction.UP)) return false;
        }
        return !level().getBlockCollisions(this, getBoundingBox().expandTowards(stepX, 0, stepZ)).iterator().hasNext();
    }

    private float steadyStep(float error) {
        int sign = error < 0 ? -1 : 1;
        if (steadySign != 0 && sign != steadySign && Math.abs(error) > 0.01f) {
            if (steadyOppositeAt < 0 || steadyLastRequest < tickCount - 3) steadyOppositeAt = tickCount;
            steadyLastRequest = tickCount;
            if (tickCount - steadyOppositeAt < ${Math.ceil(s.path_ticks / 2)}) return 0.0f;
        }
        steadyOppositeAt = -1;
        if (Math.abs(error) > 0.01f) steadySign = sign;
        return Mth.clamp(error, -STEADY_BODY, STEADY_BODY);
    }

    private boolean steadyPathReady() {
        if (tickCount < steadyNextPath) return false;
        steadyNextPath = tickCount + ${s.path_ticks};
        return true;
    }

    @Override public int getMaxHeadYRot() { return ${Math.round(s.head.yaw)}; }
    @Override public int getMaxHeadXRot() { return ${Math.round(s.head.pitch)}; }
    @Override public int getHeadRotSpeed() { return ${Math.ceil(s.head.turn / 20)}; }

    // Defer ground aim until navigation has chosen this tick's waypoint.
    @Override public void lookAt(net.minecraft.world.entity.Entity target, float yaw, float pitch) {
        if (${ground} && !(${busy})) getLookControl().setLookAt(target, yaw, pitch);
        else super.lookAt(target, yaw, pitch);
    }

    private void steadyClampHead() {
        float delta = Mth.wrapDegrees(yHeadRot - getYRot());
        setYHeadRot(getYRot() + Mth.clamp(delta, -STEADY_YAW, STEADY_YAW));
    }

    private void steadySettle() {
        if (level().isClientSide() || !(${ground})) return;
        setYBodyRot(getYRot());
        setYHeadRot(yHeadRotO + Mth.clamp(Mth.wrapDegrees(yHeadRot - yHeadRotO), -STEADY_HEAD, STEADY_HEAD));
        steadyClampHead();
    }

    @Override protected BodyRotationControl createBodyControl() {
        return new BodyRotationControl(this) {
            @Override public void clientTick() {
                if (!(${ground})) { super.clientTick(); return; }
                setYBodyRot(getYRot());
                steadyClampHead();
            }
        };
    }

    private class SteadyMove extends MoveControl {
        private float chaseHeading = Float.NaN;
        SteadyMove() { super(${entity}.this); }
        @Override protected float rotlerp(float from, float to, float limit) {
            ${flying ? "if (flightState() != FLIGHT_GROUND) return super.rotlerp(from, to, limit);\n            " : ""}if (!Float.isNaN(chaseHeading)) to = chaseHeading;
            return from + steadyStep(Mth.wrapDegrees(to - from));
        }
        private void steadySkipCoveredNode() {
            var path = getNavigation().getPath();
            if (path == null || path.isDone()) return;
            int index = path.getNextNodeIndex();
            if (index + 1 >= path.getNodeCount()) return;
            double radius = Math.max(0.5, getBbWidth());
            if (Math.abs(wantedY - getY()) > 0.5 || Math.hypot(wantedX - getX(), wantedZ - getZ()) > radius) return;
            // A wide body can already cover a waypoint that the path still tells it to turn back to.
            // Look ahead only along a level, unobstructed segment with solid ground under each path node.
            var first = path.getNode(index);
            var next = path.getNode(index + 1);
            if (first.x != next.x && first.z != next.z) return;
            for (int i = index + 1; i < path.getNodeCount() && i <= index + 4; i++) {
                var node = path.getNode(i);
                if ((first.x == next.x && node.x != first.x) || (first.z == next.z && node.z != first.z)) break;
                var pos = path.getEntityPosAtNode(${entity}.this, i);
                double dx = pos.x - getX(), dz = pos.z - getZ();
                if (Math.abs(pos.y - getY()) > 0.5 || Math.hypot(dx, dz) > radius + 3.0) break;
                var floor = net.minecraft.core.BlockPos.containing(pos.x, pos.y - 0.5, pos.z);
                if (!level().getBlockState(floor).isFaceSturdy(level(), floor, net.minecraft.core.Direction.UP)
                        || level().getBlockCollisions(${entity}.this, getBoundingBox().expandTowards(dx, 0, dz)).iterator().hasNext()) break;
                path.setNextNodeIndex(i);
                wantedX = pos.x;
                wantedY = pos.y;
                wantedZ = pos.z;
            }
        }
        @Override public void tick() {
            chaseHeading = Float.NaN;${walking ? `
            if (!${walking}) {
                operation = Operation.WAIT;
                setSpeed(0.0f);
                setZza(0.0f);
                return;
            }` : ""}
            if (operation == Operation.MOVE_TO && ${ground} && !(${busy})${walking ? ` && ${walking}` : ""}) {
                steadyMovedAt = tickCount;
                steadySkipCoveredNode();
                double dx = wantedX - getX(), dz = wantedZ - getZ();
                chaseHeading = steadyChaseHeading(wantedY);
                float heading = Float.isNaN(chaseHeading) ? (float)Math.toDegrees(Mth.atan2(dz, dx)) - 90.0f : chaseHeading;
                if (dx * dx + dz * dz > 1e-6 && Math.abs(Mth.wrapDegrees(heading - getYRot())) > 45.0f) {
                    setYRot(rotlerp(getYRot(), heading, STEADY_BODY));
                    setSpeed(0.0f);
                    setZza(0.0f);
                    operation = Operation.WAIT;
                    return;
                }
            }
            super.tick();
        }
    }

    private class SteadyLook extends LookControl {
        SteadyLook() { super(${entity}.this); }
        @Override protected float rotateTowards(float from, float to, float limit) {
            return super.rotateTowards(from, to, ${flying ? "flightState() != FLIGHT_GROUND ? limit : " : ""}Math.min(limit, STEADY_HEAD));
        }
        @Override protected void clampHeadRotationToBody() { ${flying ? "if (flightState() != FLIGHT_GROUND) super.clampHeadRotationToBody(); else " : ""}steadyClampHead(); }
        @Override protected boolean resetXRotOnTick() { return ${flying ? "flightState() != FLIGHT_GROUND" : "false"}; }
        @Override public void tick() {
            ${alignBeforeStart ? `// A request after the look control ran belongs to its next update.
            boolean alignForCast = abilityAlignUntil >= tickCount;
            abilityAlignUntil = -1;
            ` : ""}${flying ? "if (flightState() != FLIGHT_GROUND) { steadyTurning = false; super.tick(); return; }\n            " : ""}if (${s.body_turn === 0 ? "false && " : ""}lookAtCooldown > 0 && steadyMovedAt != tickCount && getNavigation().isDone() && ${ground} && !(${busy})) {
                float error = Mth.wrapDegrees(getYRotD().orElse(getYRot()) - getYRot());
                float gap = Math.abs(error);
                if (${s.turn_after}f <= STEADY_YAW && gap > ${s.turn_after}f) steadyTurning = true;${s.turn_after > 0 ? `
                // The gap between path updates is still part of a chase.
                float settle = tickCount - steadyMovedAt > ${s.path_ticks} ? ${s.turn_after / 2}f : 0.0f;
                if (settle > 0.0f && gap <= settle) steadyTurning = false;` : ""}
                if (steadyTurning${alignBeforeStart ? " || alignForCast" : ""}) {
                    float step = steadyStep(gap < 0.5f ? error : error * 0.35f);
                    setYRot(getYRot() + step);
                    ${alignBeforeStart ? "if (steadyTurning) " : ""}steadyTurning = ${s.turn_after > 0 ? "settle > 0.0f || " : ""}gap >= 0.5f;
                }
            } else steadyTurning = false;
            setYBodyRot(getYRot());
            if (lookAtCooldown == 0) setXRot(rotateTowards(getXRot(), 0.0f, STEADY_HEAD));
            super.tick();
            setXRot(Mth.clamp(getXRot(), -${s.head.pitch}f, ${s.head.pitch}f));
        }
    }

`
}

export function steadyFocus(s: SteadyPlan | null, armed: boolean, provoked: boolean, warned: boolean) {
  const focus = s?.focus
  if (!focus) return ""
  return `    private LivingEntity steadyTarget;
    private int steadyHeldAt;
${focus.hurt !== undefined ? `    private final LivingEntity[] steadyAttackers = new LivingEntity[100];
    private final java.util.Map<LivingEntity, Double> steadyDamage = new java.util.HashMap<>();
    private final float[] steadyLosses = new float[100];
    private float steadyHealth;
    private int steadyLastHurt = -1;
` : ""}
    private void steadyObserve(LivingEntity target) {
        if (target != steadyTarget) {
            steadyTarget = target;
            steadyHeldAt = tickCount;
        }${focus.hurt !== undefined ? `
        int slot = tickCount % 100;
        LivingEntity attacker = getLastHurtByMob();
        LivingEntity expired = steadyAttackers[slot];
        if (expired != null) steadyDamage.computeIfPresent(expired, (who, total) -> total > steadyLosses[slot] ? total - steadyLosses[slot] : null);
        steadyAttackers[slot] = null;
        if (attacker != null && getLastHurtByMobTimestamp() != steadyLastHurt) {
            steadyLastHurt = getLastHurtByMobTimestamp();
            steadyLosses[slot] = Math.max(0.0f, steadyHealth - getHealth());
            if (steadyLosses[slot] > 0.0f) {
                steadyAttackers[slot] = attacker;
                steadyDamage.merge(attacker, (double)steadyLosses[slot], Double::sum);
            }
        }
        steadyHealth = getHealth();` : ""}
    }

    private boolean steadyChoose(LivingEntity target) {
        if (!target.isAlive() || target.isRemoved() || target.level() != level() || !canAttack(target)) return false;
        if (tickCount - steadyHeldAt < ${Math.round((focus.hold ?? 0) * 20)}${armed ? " || abilityRunning()" : ""}) return true;
${focus.hurt !== undefined ? `        LivingEntity attacker = null;
        double most = getMaxHealth() * ${focus.hurt}f;
        for (var hit : steadyDamage.entrySet()) {
            LivingEntity who = hit.getKey();
            if (who != target && hit.getValue() >= most && engageAllows(who) && hasLineOfSight(who)
                    && (hit.getValue() > most || attacker == null || who.getId() < attacker.getId())) {
                most = hit.getValue();
                attacker = who;
            }
        }
        if (attacker != null) { setTarget(attacker); return true; }
` : ""}${focus.leave !== undefined ? `        if (distanceToSqr(target) > ${focus.leave * focus.leave}) {
            Player nearer = level().getEntitiesOfClass(Player.class, getBoundingBox().inflate(ENGAGE_DISTANCE),
                p -> p != target && engageAllows(p) && hasLineOfSight(p)${provoked ? " && p == getLastHurtByMob()" : ""}${warned ? " && engageNear(p)" : ""} && distanceToSqr(p) < distanceToSqr(target))
                .stream().min(java.util.Comparator.comparingDouble(p -> distanceToSqr(p))).orElse(null);
            if (nearer != null) {
                setTarget(nearer);
                return true;
            }
        }
` : ""}        return false;
    }

`
}
