import type { GameplayDocument } from "../../../src/gameplay"

/**
 * Test fixture, never shown to an AI: the guarding gameplay of the first mod a person really played,
 * written again the way the rules now ask. The original (`guarding-original.java` beside this file, word
 * for word but for the game's names, which are now Mojang's) cleared the creature's goals and asked for a new path on every tick, so the guardian stood
 * still when nobody was near. The second writing added one goal below the creature's own chase, which
 * could never make it stop chasing. This one leaves the fighting to the creature and decides two things:
 * whom it may fight (a target rule), and what it does when it has strayed and fights nobody (one goal).
 * No Node APIs.
 */

const main = (packageName: string, api: string, creature: string) => `package ${packageName};

import ${api}.GameplayEntry;
import ${api}.ProjectContent;

public final class Main implements GameplayEntry {
    private static final String GUARDIAN = "${creature}";

    @Override
    public void onInitialize() {
        // Whom it may fight: only somebody close to what it guards, and only while it is near enough itself.
        ProjectContent.targetRule(GUARDIAN, GuardPost::mayFight);
        // What it does when it fights nobody and has strayed: walk back. Chasing and hitting stay the creature's own.
        ProjectContent.addGoal(GUARDIAN, 2, ReturnGoal::new);
    }
}
`

const post = (packageName: string, api: string, ore: string) => `package ${packageName};

import ${api}.ProjectContent;
import java.util.Map;
import java.util.WeakHashMap;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.phys.Vec3;

/** What one guardian guards: the nearest ore, looked for once a second, and whether it is on its way back to it. */
final class GuardPost {
    private static final String ORE = "${ore}";
    private static final int SEARCH = 8;
    private static final double GUARD_RANGE = 8.0;
    static final double LEASH = 16.0;
    private static final int SEARCH_TICKS = 20;
    // One for each guardian in the world; an entry goes when its creature does. Only the server's own thread reads it.
    private static final Map<PathfinderMob, GuardPost> POSTS = new WeakHashMap<>();

    private BlockPos anchor;
    private int nextSearch;
    boolean returning;

    static GuardPost of(PathfinderMob mob) {
        return POSTS.computeIfAbsent(mob, key -> new GuardPost());
    }

    /** With nothing to guard, anybody. With a post: only who stands close to it, and never while the guardian is too far from it or walking back. */
    static boolean mayFight(PathfinderMob mob, LivingEntity candidate) {
        GuardPost post = of(mob);
        BlockPos anchor = post.anchor(mob);
        if (anchor == null) return true;
        return !post.returning && squaredFrom(anchor, mob.position()) <= LEASH * LEASH
            && squaredFrom(anchor, candidate.position()) <= GUARD_RANGE * GUARD_RANGE;
    }

    /** The ore it guards right now, or null. Looked for again when it is gone, at most once a second. */
    BlockPos anchor(PathfinderMob mob) {
        if (!(mob.level() instanceof ServerLevel world)) return null;
        if (mob.tickCount >= nextSearch) {
            nextSearch = mob.tickCount + SEARCH_TICKS;
            if (anchor == null || !isOre(world, anchor)) anchor = findOre(world, mob);
        }
        return anchor;
    }

    static double squaredFrom(BlockPos anchor, Vec3 position) {
        return position.distanceToSqr(Vec3.atCenterOf(anchor));
    }

    private static boolean isOre(ServerLevel world, BlockPos position) {
        return world.hasChunkAt(position) && world.getBlockState(position).is(ProjectContent.block(ORE));
    }

    private static BlockPos findOre(ServerLevel world, PathfinderMob mob) {
        BlockPos middle = mob.blockPosition();
        BlockPos closest = null;
        double distance = SEARCH * SEARCH;
        for (BlockPos position : BlockPos.betweenClosed(middle.offset(-SEARCH, -SEARCH, -SEARCH), middle.offset(SEARCH, SEARCH, SEARCH))) {
            double candidate = mob.position().distanceToSqr(Vec3.atCenterOf(position));
            if (candidate > distance || !isOre(world, position)) continue;
            closest = position.immutable();
            distance = candidate;
        }
        return closest;
    }
}
`

const goal = (packageName: string) => `package ${packageName};

import java.util.EnumSet;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.goal.Goal;

/** Walks back to what it guards once it is too far from it. While it walks the target rule answers no, so nothing draws it away again. */
final class ReturnGoal extends Goal {
    private static final double ARRIVED = 2.0;
    private static final int PATH_TICKS = 40;

    private final PathfinderMob mob;
    private final GuardPost post;
    private BlockPos anchor;
    private int nextPath;

    ReturnGoal(PathfinderMob mob) {
        this.mob = mob;
        this.post = GuardPost.of(mob);
        setFlags(EnumSet.of(Flag.MOVE));
    }

    @Override
    public boolean canUse() {
        anchor = post.anchor(mob);
        return anchor != null && GuardPost.squaredFrom(anchor, mob.position()) > GuardPost.LEASH * GuardPost.LEASH;
    }

    @Override
    public boolean canContinueToUse() {
        return anchor != null && anchor.equals(post.anchor(mob)) && GuardPost.squaredFrom(anchor, mob.position()) > ARRIVED * ARRIVED;
    }

    @Override
    public void start() {
        post.returning = true;
        nextPath = mob.tickCount;
    }

    @Override
    public void stop() {
        post.returning = false;
        mob.getNavigation().stop();
    }

    @Override
    public void tick() {
        // The way back is asked for once, and again only if it ran out before the mob arrived.
        if (mob.tickCount < nextPath || !mob.getNavigation().isDone()) return;
        mob.getNavigation().moveTo(anchor.getX() + 0.5, anchor.getY() + 1, anchor.getZ() + 0.5, 1.0);
        nextPath = mob.tickCount + PATH_TICKS;
    }
}
`

/** The corrected guarding gameplay for one project: a creature (by asset id) that guards one of the project's blocks. */
export function guardingGameplay(input: { mod_id: string; creature: string; creature_name: string; ore: string; ore_name: string; uses: string[] }): GameplayDocument {
  const root = `com.minemods.content_${input.mod_id}.gameplay`
  return {
    kind: "gameplay",
    slug: "ore_guarding",
    name: `${input.creature_name}守矿`,
    summary: `${input.creature_name}把身边的${input.ore_name}当成据点守着：只打靠近矿的人，被引远了就放手，自己走回来。`,
    behaviours: [
      { when: `${input.creature_name}身边 8 格以内有${input.ore_name}时（每 1 秒找一次）`, does: "把最近的那一块记作据点；据点被挖掉以后重新找", shows: "看不出变化：它照常闲逛和张望" },
      { when: "它有据点、自己离据点不超过 16 格，并且有玩家站在据点 8 格以内时", does: "只有这样的玩家它才会去打（怎么发现、怎么追、怎么出手都是它自带的）；玩家一离开据点 8 格，它当即放手，不再追", shows: `${input.creature_name}转向靠近矿的玩家、追过去、出手；玩家退到 8 格以外它就停下，回到闲逛` },
      { when: "它离据点超过 16 格时", does: "放掉正在追的人，走回据点，到 2 格以内为止；走回去的路上谁也不打", shows: `${input.creature_name}掉头走回矿石旁边` },
    ],
    not_doing: [`身边没有${input.ore_name}的时候不改变它平常的行为：照样闲逛、张望，该追人照样追人`, "不改变它怎么追人、怎么出手、打多重：那些是这只生物自带的", "不保护矿石不被挖掉，也不修复矿石"],
    uses: input.uses,
    sources: [
      { path: "Main.java", content: main(`${root}.ore_guarding`, `${root}.api`, input.creature) },
      { path: "GuardPost.java", content: post(`${root}.ore_guarding`, `${root}.api`, input.ore) },
      { path: "ReturnGoal.java", content: goal(`${root}.ore_guarding`) },
    ],
    data: [],
    lang: { zh_cn: {}, en_us: {} },
  }
}
