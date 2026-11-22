package studio.lucky_gametest;

import net.fabricmc.fabric.api.event.player.UseBlockCallback;
import net.fabricmc.fabric.api.gametest.v1.FabricGameTest;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.Registries;
import net.minecraft.gametest.framework.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.damagesource.DamageTypes;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

public final class LuckyCacheGameTest {
    private static BlockHitResult hit(BlockPos pos) {
        return new BlockHitResult(Vec3.atCenterOf(pos), Direction.UP, pos, false);
    }
    private static int count(GameTestHelper context, BlockPos pos, Item item) {
        return context.getLevel().getEntitiesOfClass(ItemEntity.class, new AABB(pos).inflate(4), entity -> entity.getItem().is(item))
            .stream().mapToInt(entity -> entity.getItem().getCount()).sum();
    }

    @GameTest(template = FabricGameTest.EMPTY_STRUCTURE, timeoutTicks = 100)
    public void weightsCoverEveryRollExactly(GameTestHelper context) {
        int[] totals = new int[6];
        for (int roll = 0; roll < 100; roll++) totals[StudioLuckyCaches.select(roll, 35, 25, 15, 5, 15, 5)]++;
        int[] expected = {35, 25, 15, 5, 15, 5};
        for (int i = 0; i < totals.length; i++) context.assertValueEqual(totals[i], expected[i], "Weighted interval must match exactly");
        context.succeed();
    }

    @GameTest(template = FabricGameTest.EMPTY_STRUCTURE, timeoutTicks = 100)
    public void rightClickConsumesOnceAndPreservesNeighbors(GameTestHelper context) {
        var pos = context.absolutePos(new BlockPos(2, 1, 2));
        var player = context.makeMockPlayer(GameType.SURVIVAL);
        var second = context.makeMockPlayer(GameType.SURVIVAL);
        var world = context.getLevel();
        world.setBlockAndUpdate(pos, StudioContentRegistry.BLOCK_REWARD_CACHE.defaultBlockState());
        world.setBlockAndUpdate(pos.east(), Blocks.GLASS.defaultBlockState());
        world.setBlockAndUpdate(pos.west(), Blocks.STONE.defaultBlockState());
        StudioLuckyCaches.register();
        var callback = UseBlockCallback.EVENT.invoker();
        context.assertValueEqual(callback.interact(player, world, InteractionHand.OFF_HAND, hit(pos)), InteractionResult.FAIL, "Offhand must not open");
        context.assertFalse(world.isEmptyBlock(pos), "Offhand must preserve cache");
        context.assertValueEqual(callback.interact(player, world, InteractionHand.MAIN_HAND, hit(pos)), InteractionResult.SUCCESS, "Main hand opens");
        context.assertTrue(world.isEmptyBlock(pos), "Cache consumed");
        callback.interact(second, world, InteractionHand.MAIN_HAND, hit(pos));
        callback.interact(player, world, InteractionHand.MAIN_HAND, hit(pos));
        context.assertValueEqual(count(context, pos, Items.DIAMOND), 3, "Exactly one reward after repeated clicks and a second player");
        context.assertValueEqual(count(context, pos, StudioContentRegistry.BLOCK_ITEM_REWARD_CACHE), 0, "Opening does not refund the cache");
        context.assertTrue(world.getBlockState(pos.east()).is(Blocks.GLASS), "Glass remains");
        context.assertTrue(world.getBlockState(pos.west()).is(Blocks.STONE), "Stone remains");
        context.succeed();
    }

    @GameTest(template = FabricGameTest.EMPTY_STRUCTURE, timeoutTicks = 100)
    public void punishmentsAreBoundedAndPermissionsRespected(GameTestHelper context) {
        var pos = context.absolutePos(new BlockPos(2, 1, 2));
        var world = context.getLevel();
        var survival = context.makeMockPlayer(GameType.SURVIVAL);
        var creative = context.makeMockPlayer(GameType.CREATIVE);
        for (var mode : new GameType[]{GameType.SPECTATOR, GameType.ADVENTURE}) {
            var restricted = context.makeMockPlayer(mode);
            // GameTestHelper's mock overrides isCreative/isSpectator but does not apply adventure abilities.
            mode.updatePlayerAbilities(restricted.getAbilities());
            context.assertFalse(restricted.mayBuild(), "Restricted player abilities must match actual game mode");
            world.setBlockAndUpdate(pos, StudioContentRegistry.BLOCK_PUNISH_CACHE.defaultBlockState());
            context.assertValueEqual(StudioLuckyCaches.open(restricted, world, InteractionHand.MAIN_HAND, hit(pos)), InteractionResult.FAIL, "Restricted game mode must not open");
            context.assertFalse(world.isEmptyBlock(pos), "Forbidden interaction preserves cache");
        }
        for (int i = 0; i < 2; i++) {
            world.setBlockAndUpdate(pos, StudioContentRegistry.BLOCK_PUNISH_CACHE.defaultBlockState());
            StudioLuckyCaches.open(survival, world, InteractionHand.MAIN_HAND, hit(pos));
        }
        context.assertValueEqual(survival.getEffect(MobEffects.MOVEMENT_SLOWDOWN).getAmplifier(), 1, "Penalty level is not stacked");
        context.assertValueEqual(survival.getEffect(MobEffects.MOVEMENT_SLOWDOWN).getDuration(), 100, "Penalty time is not accumulated");
        world.setBlockAndUpdate(pos, StudioContentRegistry.BLOCK_PUNISH_CACHE.defaultBlockState());
        StudioLuckyCaches.open(creative, world, InteractionHand.MAIN_HAND, hit(pos));
        context.assertFalse(creative.hasEffect(MobEffects.MOVEMENT_SLOWDOWN), "Creative is immune");
        context.succeed();
    }

    @GameTest(template = FabricGameTest.EMPTY_STRUCTURE, timeoutTicks = 100)
    public void miningReturnsPlaceableUnopenedCache(GameTestHelper context) {
        var pos = context.absolutePos(new BlockPos(2, 1, 2));
        var item = StudioContentRegistry.BLOCK_ITEM_REWARD_CACHE;
        context.assertTrue(item instanceof BlockItem, "Drop must be a BlockItem");
        context.assertValueEqual(((BlockItem)item).getBlock(), StudioContentRegistry.BLOCK_REWARD_CACHE, "Placeable block mapping");
        context.assertValueEqual(item.getDefaultMaxStackSize(), 16, "Configured stack limit");
        context.getLevel().setBlockAndUpdate(pos, StudioContentRegistry.BLOCK_REWARD_CACHE.defaultBlockState());
        context.getLevel().destroyBlock(pos, true);
        context.assertValueEqual(count(context, pos, item), 1, "Mining refunds one unopened cache");
        context.assertValueEqual(count(context, pos, Items.DIAMOND), 0, "Mining must not award prizes");
        context.succeed();
    }

    @GameTest(template = FabricGameTest.EMPTY_STRUCTURE, timeoutTicks = 100)
    public void playerKillDropsOnceAndOtherDeathsDoNot(GameTestHelper context) {
        var relative = new BlockPos(2, 1, 2);
        var pos = context.absolutePos(relative);
        var world = context.getLevel();
        var player = context.makeMockServerPlayerInLevel();
        var creature = context.spawnWithNoFreeWill(StudioContent.CREATURE, relative);
        creature.hurt(world.damageSources().playerAttack(player), 1000);
        creature.hurt(world.damageSources().playerAttack(player), 1000);
        context.assertValueEqual(count(context, pos, StudioContentRegistry.BLOCK_ITEM_REWARD_CACHE), 1, "One guaranteed player-kill drop");
        world.getEntitiesOfClass(ItemEntity.class, new AABB(pos).inflate(4), entity -> entity.getItem().is(StudioContentRegistry.BLOCK_ITEM_REWARD_CACHE)).forEach(ItemEntity::discard);
        context.spawnWithNoFreeWill(StudioContent.CREATURE, relative).hurt(world.damageSources().generic(), 1000);
        var explosion = new DamageSource(world.registryAccess().registryOrThrow(Registries.DAMAGE_TYPE).getHolderOrThrow(DamageTypes.EXPLOSION), player);
        context.spawnWithNoFreeWill(StudioContent.CREATURE, relative).hurt(explosion, 1000);
        var self = context.spawnWithNoFreeWill(StudioContent.CREATURE, relative);
        try {
            var detonate = self.getClass().getDeclaredMethod("detonateRuntime");
            detonate.setAccessible(true);
            detonate.invoke(self);
        } catch (ReflectiveOperationException error) { throw new RuntimeException(error); }
        context.assertValueEqual(count(context, pos, StudioContentRegistry.BLOCK_ITEM_REWARD_CACHE), 0, "Environment, explosion and self-detonation must not add a cache");
        world.getGameRules().getRule(GameRules.RULE_DOMOBLOOT).set(false, world.getServer());
        context.spawnWithNoFreeWill(StudioContent.CREATURE, relative).hurt(world.damageSources().playerAttack(player), 1000);
        world.getGameRules().getRule(GameRules.RULE_DOMOBLOOT).set(true, world.getServer());
        context.assertValueEqual(count(context, pos, StudioContentRegistry.BLOCK_ITEM_REWARD_CACHE), 0, "doMobLoot is respected");
        context.succeed();
    }
}
