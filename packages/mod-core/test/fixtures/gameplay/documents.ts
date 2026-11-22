import type { GameplayDocument } from "../../../src/gameplay"

/**
 * Test fixture, never shown to an AI: two gameplay assets written the way a model would write them, on
 * the old sample project (a block 「秘匣」, an item 「月露」, a creature 「苔皮苦力怕」), and deliberately
 * bad versions of the first, one per check. All Java here compiles against Minecraft 1.21.1 (Mojang's names) and
 * Fabric API unless a variant says it must not. No Node APIs: the preview harness reads this file too.
 */

export const IDS = { creature: "11111111-1111-4111-8111-111111111111", block: "44444444-4444-4444-8444-444444444444", item: "55555555-5555-4555-8555-555555555555", box_guard: "d0000000-0000-4000-8000-000000000001", guardian_home: "d0000000-0000-4000-8000-000000000002" } as const
const MOD = "legacy_sample"
const ROOT = `com.minemods.content_${MOD}.gameplay`

const boxGuardMain = `package ${ROOT}.box_guard;

import ${ROOT}.api.GameplayEntry;
import ${ROOT}.api.ProjectContent;
import net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;
import net.fabricmc.fabric.api.event.player.UseItemCallback;

public final class Main implements GameplayEntry {
    @Override public void onInitialize() {
        PlayerBlockBreakEvents.AFTER.register((world, player, pos, state, blockEntity) -> Alarm.onBroken(world, player, pos, state));
        UseItemCallback.EVENT.register((player, world, hand) -> Pulse.use(player, world, hand, ProjectContent.item("moon_dew")));
    }
}
`

const alarm = `package ${ROOT}.box_guard;

import ${ROOT}.api.ProjectContent;
import java.util.List;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.tags.TagKey;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;

/** Breaking a guarded block wakes every guardian within reach. */
final class Alarm {
    static final double REACH = 12.0;
    private static final TagKey<Block> GUARDED = TagKey.create(Registries.BLOCK, ProjectContent.id("guarded"));
    private static final String GUARDIAN = "${IDS.creature}";

    private Alarm() {}

    static void onBroken(Level world, Player player, BlockPos pos, BlockState state) {
        if (world.isClientSide() || !state.is(GUARDED) || player.isCreative() || player.isSpectator()) return;
        List<? extends Entity> guardians = world.getEntities(ProjectContent.entity(GUARDIAN), new AABB(pos).inflate(REACH), Entity::isAlive);
        if (guardians.isEmpty()) return;
        for (Entity guardian : guardians) {
            if (!(guardian instanceof Mob mob)) continue;
            mob.setTarget(player);
            mob.getNavigation().moveTo(player, 1.2);
        }
        world.playSound(null, pos, SoundEvents.BELL_BLOCK, SoundSource.HOSTILE, 1.0f, 0.6f);
        player.displayClientMessage(Component.translatable("gameplay.${MOD}.box_guard.alerted", guardians.size()), true);
    }
}
`

const pulse = `package ${ROOT}.box_guard;

import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;

/** Right-click with the dew: a shock wave around the player, then a cooldown. */
final class Pulse {
    static final double RADIUS = 4.0;
    static final float DAMAGE = 4.0f;
    static final int COOLDOWN_TICKS = 200;

    private Pulse() {}

    static InteractionResultHolder<ItemStack> use(Player player, Level world, InteractionHand hand, Item dew) {
        ItemStack stack = player.getItemInHand(hand);
        if (!stack.is(dew) || player.isSpectator()) return InteractionResultHolder.pass(stack);
        if (player.getCooldowns().isOnCooldown(dew)) return InteractionResultHolder.fail(stack);
        if (!(world instanceof ServerLevel server)) return InteractionResultHolder.success(stack);
        for (LivingEntity target : server.getEntitiesOfClass(LivingEntity.class, player.getBoundingBox().inflate(RADIUS), entity -> entity != player && entity.isAlive())) {
            target.hurt(player.damageSources().playerAttack(player), DAMAGE);
            target.knockback(0.9, player.getX() - target.getX(), player.getZ() - target.getZ());
        }
        server.sendParticles(ParticleTypes.SONIC_BOOM, player.getX(), player.getY(0.5), player.getZ(), 1, 0.0, 0.0, 0.0, 0.0);
        world.playSound(null, player.blockPosition(), SoundEvents.WARDEN_SONIC_BOOM, SoundSource.PLAYERS, 0.6f, 1.4f);
        player.getCooldowns().addCooldown(dew, COOLDOWN_TICKS);
        return InteractionResultHolder.success(stack);
    }
}
`

const homeMain = `package ${ROOT}.guardian_home;

import ${ROOT}.api.GameplayEntry;
import ${ROOT}.api.ProjectContent;
import net.fabricmc.fabric.api.attachment.v1.AttachmentRegistry;
import net.fabricmc.fabric.api.attachment.v1.AttachmentTarget;
import net.fabricmc.fabric.api.attachment.v1.AttachmentType;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.Mob;

public final class Main implements GameplayEntry {
    static final String GUARDIAN = "${IDS.creature}";
    /** Farther than this from home with nothing to chase, it walks back. */
    static final double LEASH = 16.0;
    /** Farther than this, it is put back at home at once. */
    static final double LIMIT = 48.0;
    static final int CHECK_EVERY_TICKS = 20;
    // Saved with the creature, so home survives leaving the world and coming back.
    static final AttachmentType<BlockPos> HOME = AttachmentRegistry.createPersistent(ProjectContent.id("guardian_home"), BlockPos.CODEC);

    @Override public void onInitialize() {
        ServerEntityEvents.ENTITY_LOAD.register((entity, world) -> {
            if (!ProjectContent.isEntity(entity, GUARDIAN)) return;
            // The cast is spelled out so the code does not rely on the build tool adding these methods to Entity.
            AttachmentTarget target = (AttachmentTarget) entity;
            if (!target.hasAttached(HOME)) target.setAttached(HOME, entity.blockPosition());
        });
        ServerTickEvents.END_WORLD_TICK.register(Main::callHome);
    }

    private static void callHome(ServerLevel world) {
        if (world.getGameTime() % CHECK_EVERY_TICKS != 0) return;
        for (Entity entity : world.getEntities(ProjectContent.entity(GUARDIAN), Entity::isAlive)) {
            BlockPos home = ((AttachmentTarget) entity).getAttached(HOME);
            if (home == null || !(entity instanceof Mob mob)) continue;
            double distance = Math.sqrt(home.distToCenterSqr(mob.position()));
            if (distance > LIMIT) {
                mob.setTarget(null);
                mob.teleportTo(home.getX() + 0.5, home.getY(), home.getZ() + 0.5);
                continue;
            }
            if (distance > LEASH && mob.getTarget() == null) mob.getNavigation().moveTo(home.getX() + 0.5, home.getY(), home.getZ() + 0.5, 1.1);
        }
    }
}
`

export const BOX_GUARD: GameplayDocument = {
  kind: "gameplay",
  slug: "box_guard",
  name: "守匣警报与月露震波",
  summary: "挖秘匣会惊动附近的苔皮苦力怕；手持月露右键可以放出一圈震波把周围的生物震开。",
  behaviours: [
    { when: "生存模式的玩家挖掉一个「秘匣」方块时", does: "以这个方块为中心 12 格以内每一只活着的「苔皮苦力怕」都把这个玩家当成目标，并以 1.2 倍速度朝他走过来", shows: "方块的位置响一声低沉的钟声；玩家物品栏上方出现一行字“惊动了 N 只守卫”，N 是被惊动的数量" },
    { when: "玩家手持「月露」右键时", does: "对身边 4 格以内除自己以外所有活着的生物造成 4 点伤害（2 颗心）并把它们从玩家身边击退；然后「月露」进入 10 秒冷却，冷却期间再右键没有效果", shows: "玩家身上出现一圈音爆粒子，响一声音爆；物品栏里「月露」的图标盖上冷却的白色遮罩" },
  ],
  not_doing: ["右键不会消耗「月露」", "创造模式和旁观模式下挖掉「秘匣」不会惊动任何生物", "12 格以内没有「苔皮苦力怕」时，挖掉「秘匣」不响也不提示"],
  uses: [IDS.block, IDS.item, IDS.creature],
  sources: [
    { path: "Main.java", content: boxGuardMain },
    { path: "Alarm.java", content: alarm },
    { path: "Pulse.java", content: pulse },
  ],
  data: [{ path: `data/${MOD}/tags/block/guarded.json`, content: `${JSON.stringify({ replace: false, values: [`${MOD}:mystery_box`] }, null, 2)}\n` }],
  lang: { zh_cn: { [`gameplay.${MOD}.box_guard.alerted`]: "惊动了 %s 只守卫" }, en_us: { [`gameplay.${MOD}.box_guard.alerted`]: "%s guardians alerted" } },
}

export const GUARDIAN_HOME: GameplayDocument = {
  kind: "gameplay",
  slug: "guardian_home",
  name: "守卫恋家",
  summary: "每只苔皮苦力怕把自己第一次出现的地方当成家，被引远了会自己回去。",
  behaviours: [
    { when: "一只「苔皮苦力怕」第一次出现在世界里时（生成，或者所在的区块被加载）", does: "把它当时站的位置记为它的家；这个位置跟着它一起存档，重进世界也不会变", shows: "没有任何可见的效果" },
    { when: "它离家超过 16 格、而且没有在追任何目标时（每 1 秒检查一次）", does: "以 1.1 倍速度走回家的位置", shows: "它转身朝家的方向走回去" },
    { when: "它离家超过 48 格时（每 1 秒检查一次）", does: "放弃正在追的目标，被直接送回家的位置", shows: "它从原地消失，出现在家的位置" },
  ],
  not_doing: ["不改变它平时怎么攻击、怎么游荡", "家的位置一旦记下就不会再变，没有办法给它换一个家"],
  uses: [IDS.creature],
  sources: [{ path: "Main.java", content: homeMain }],
  data: [],
  lang: { zh_cn: {}, en_us: {} },
}

const swap = (document: GameplayDocument, file: string, change: (content: string) => string): GameplayDocument => ({ ...document, sources: document.sources.map((source) => (source.path === file ? { ...source, content: change(source.content) } : source)) })
const replaced = (content: string, from: string, to: string) => {
  if (!content.includes(from)) throw new Error(`fixture anchor missing: ${from}`)
  return content.replace(from, to)
}

/** Deliberately bad versions of BOX_GUARD, one per thing a check has to catch. */
export const BAD = {
  /** A method that does not exist in 1.21.1. */
  does_not_compile: swap(BOX_GUARD, "Pulse.java", (content) => replaced(content, "player.getCooldowns().addCooldown(dew, COOLDOWN_TICKS);", "player.getCooldowns().setCooldown(dew, COOLDOWN_TICKS);")),
  /** Reports every alarm to a server somewhere. */
  opens_socket: swap(BOX_GUARD, "Alarm.java", (content) =>
    replaced(content, "        world.playSound(null, pos,", '        try (java.net.Socket socket = new java.net.Socket("stats.example.com", 9000)) {\n            socket.getOutputStream().write(player.getName().getString().getBytes());\n        } catch (java.io.IOException ignored) {\n        }\n        world.playSound(null, pos,'),
  ),
  /** Reaches a private field by reflection, the class name built from pieces. */
  uses_reflection: swap(BOX_GUARD, "Pulse.java", (content) =>
    replaced(content, "        player.getCooldowns().addCooldown(dew, COOLDOWN_TICKS);", '        try {\n            var field = Class.forName("net.minecraft.world.entity." + "player.Player").getDeclaredField("abilities");\n            field.setAccessible(true);\n        } catch (ReflectiveOperationException ignored) {\n        }\n        player.getCooldowns().addCooldown(dew, COOLDOWN_TICKS);'),
  ),
  /** Names an item this project does not have. */
  missing_item: swap(BOX_GUARD, "Main.java", (content) => replaced(content, 'ProjectContent.item("moon_dew")', 'ProjectContent.item("blue_sword")')),
  /** The description promises a drop; the code is the good code and never gives one. Only a reader of both can tell. */
  claims_a_drop: { ...BOX_GUARD, behaviours: [...BOX_GUARD.behaviours, { when: "生存模式的玩家挖掉一个「秘匣」方块时", does: "除了正常掉落以外，额外掉落 1 个「月露」", shows: "方块碎掉的地方多出一个「月露」掉落物" }] } satisfies GameplayDocument,
} as const

/** What an independent reviewer answers about `claims_a_drop`, and about the good version: scripted here, since no model runs in tests. */
export const REVIEWS = {
  good: { passed: true, findings: [], advice: ["Alarm 只认带 guarded 标签的方块；以后给别的方块加上这个标签，它们也会惊动守卫，说明里没有提到。"] },
  claims_a_drop: { passed: false, findings: ["说明第 3 条写“挖掉秘匣时额外掉落 1 个月露”，但 Alarm.java 的 onBroken 里只设置目标、播放声音和发提示，没有任何掉落物品的代码。"], advice: [] },
}
