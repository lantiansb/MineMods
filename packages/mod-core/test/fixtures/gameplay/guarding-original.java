package com.minemods.content_mod_ed9c1bba9a9a.gameplay.blueglow_guarding;

import com.minemods.content_mod_ed9c1bba9a9a.gameplay.api.GameplayEntry;
import com.minemods.content_mod_ed9c1bba9a9a.gameplay.api.ProjectContent;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.Mob;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.level.GameType;
import java.util.Comparator;
import java.util.Map;
import java.util.WeakHashMap;

public final class Main implements GameplayEntry {
    private static final String GUARDIAN = "6d6632f8-2519-498d-b8f4-0030567e644a";
    private final Map<Mob, State> states = new WeakHashMap<>();

    private static final class State {
        BlockPos anchor;
        ServerPlayer target;
        boolean returning;
        long nextAttack;
    }

    @Override
    public void onInitialize() {
        ServerTickEvents.END_WORLD_TICK.register(world -> {
            for (Entity entity : world.getAllEntities()) {
                if (!(entity instanceof Mob mob) || !mob.isAlive()
                        || !ProjectContent.isEntity(mob, GUARDIAN)) continue;
                State state = states.computeIfAbsent(mob, ignored -> {
                    mob.removeFreeWill();
                    return new State();
                });
                control(world, mob, state);
            }
        });
        ServerLifecycleEvents.SERVER_STOPPED.register(server -> states.clear());
    }

    private void control(ServerLevel world, Mob mob, State state) {
        if (mob.tickCount % 20 == 0) {
            if (state.anchor != null && !world.getBlockState(state.anchor)
                    .is(ProjectContent.block("blueglow_ore"))) {
                state.anchor = null;
                state.target = null;
                state.returning = false;
                mob.setTarget(null);
                mob.getNavigation().stop();
            }
            if (state.anchor == null) {
                BlockPos found = findOre(world, mob);
                if (found != null) {
                    state.anchor = found;
                    state.target = null;
                    mob.setTarget(null);
                    mob.getNavigation().stop();
                }
            }
        }

        Vec3 anchor = state.anchor == null ? null : Vec3.atCenterOf(state.anchor);
        if (anchor != null && mob.position().distanceToSqr(anchor) > 256) {
            state.returning = true;
            state.target = null;
            mob.setTarget(null);
            mob.getNavigation().moveTo(anchor.x, state.anchor.getY() + 1, anchor.z, 1.0);
            return;
        }
        if (state.returning && anchor != null) {
            state.target = null;
            mob.setTarget(null);
            if (mob.position().distanceToSqr(anchor) > 4) {
                mob.getNavigation().moveTo(anchor.x, state.anchor.getY() + 1, anchor.z, 1.0);
                return;
            }
            state.returning = false;
            mob.getNavigation().stop();
        }

        if (state.target != null && (!valid(state.target)
                || state.target.level() != world
                || (anchor == null && mob.distanceToSqr(state.target) > 256))) {
            state.target = null;
        }
        if (state.target == null) {
            Vec3 origin = anchor == null ? mob.position() : anchor;
            double rangeSquared = anchor == null ? 256 : 64;
            state.target = world.players().stream()
                    .filter(Main::valid)
                    .filter(player -> player.position().distanceToSqr(origin) <= rangeSquared)
                    .min(Comparator.comparingDouble(player -> player.position().distanceToSqr(origin)))
                    .orElse(null);
        }
        mob.setTarget(state.target);
        if (state.target == null) {
            mob.getNavigation().stop();
            return;
        }
        mob.getLookControl().setLookAt(state.target, 30, 30);
        mob.getNavigation().moveTo(state.target, 1.0);
        if (mob.distanceToSqr(state.target) <= 4 && mob.hasLineOfSight(state.target)
                && world.getGameTime() >= state.nextAttack) {
            mob.doHurtTarget(state.target);
            state.nextAttack = world.getGameTime() + 20;
        }
    }

    private static boolean valid(ServerPlayer player) {
        return player.isAlive() && player.gameMode.getGameModeForPlayer() == GameType.SURVIVAL;
    }

    private static BlockPos findOre(ServerLevel world, Mob mob) {
        BlockPos middle = mob.blockPosition();
        BlockPos closest = null;
        double distance = 64;
        for (BlockPos position : BlockPos.betweenClosed(middle.offset(-8, -8, -8), middle.offset(8, 8, 8))) {
            double candidateDistance = mob.position().distanceToSqr(Vec3.atCenterOf(position));
            if (candidateDistance > distance || !world.hasChunkAt(position)
                    || !world.getBlockState(position).is(ProjectContent.block("blueglow_ore"))) continue;
            closest = position.immutable();
            distance = candidateDistance;
        }
        return closest;
    }
}
