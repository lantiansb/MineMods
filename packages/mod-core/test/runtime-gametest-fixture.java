package studio.runtime_gametest;

import java.lang.reflect.Method;

import net.fabricmc.fabric.api.gametest.v1.FabricGameTest;
import net.minecraft.block.Blocks;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
import net.minecraft.entity.SpawnRestriction;
import net.minecraft.entity.SpawnLocationTypes;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.effect.StatusEffect;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.registry.Registries;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.test.GameTest;
import net.minecraft.test.TestContext;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.GameMode;
import net.minecraft.world.biome.Biome;
import net.minecraft.world.biome.SpawnSettings;

import studio.runtime_gametest.entity.StudioCreature;

public final class RuntimeGameTest {
    private static final EntityType<StudioCreature> CREATURE = StudioContent.CREATURE;
    private static final Identifier SLOWNESS_ID = Identifier.of("minecraft", "slowness");

    @GameTest(templateName = FabricGameTest.EMPTY_STRUCTURE, tickLimit = 100)
    public void runtimeExplosionPreservesBlocksAppliesEffectsAndRestoresFuse(TestContext context) {
        BlockPos origin = context.getAbsolutePos(new BlockPos(2, 1, 2));
        BlockPos glass = origin.add(2, 0, 0);
        BlockPos stone = origin.add(0, 0, 2);
        context.getWorld().setBlockState(glass, Blocks.GLASS.getDefaultState());
        context.getWorld().setBlockState(stone, Blocks.STONE.getDefaultState());

        StudioCreature creature = context.spawnMob(CREATURE, new BlockPos(2, 1, 2));
        PlayerEntity player = context.createMockPlayer(GameMode.SURVIVAL);
        player.getAttributeInstance(EntityAttributes.GENERIC_MAX_HEALTH).setBaseValue(100.0);
        player.setHealth(100.0f);
        player.setPosition(origin.getX() + 1.0, origin.getY(), origin.getZ());
        context.getWorld().spawnEntity(player);
        context.waitAndRun(1, () -> {
            context.assertFalse(player.isCreative(), "The effect target must be a survival player.");
            context.assertTrue(player.isAlive(), "The effect target must be alive before detonation.");
            context.assertTrue(context.getWorld().getOtherEntities(creature, creature.getBoundingBox().expand(2)).contains(player), "The player must be discoverable near the runtime entity.");
            context.assertTrue(creature.squaredDistanceTo(player) <= 4.0, "The player must be within the configured effect radius.");

            invoke(creature, "readCustomDataFromNbt", new NbtCompound());
            NbtCompound missingFuse = new NbtCompound();
            invoke(creature, "writeCustomDataToNbt", missingFuse);
            context.assertEquals(-1, missingFuse.getInt("RuntimeFuseTicks"), "A missing fuse must restore to -1.");

            NbtCompound oversizedFuse = new NbtCompound();
            oversizedFuse.putInt("RuntimeFuseTicks", 9999);
            invoke(creature, "readCustomDataFromNbt", oversizedFuse);
            NbtCompound clampedFuse = new NbtCompound();
            invoke(creature, "writeCustomDataToNbt", clampedFuse);
            context.assertEquals(20, clampedFuse.getInt("RuntimeFuseTicks"), "Fuse NBT must clamp to the configured fuse maximum.");

            invoke(creature, "detonateRuntime");
            context.assertTrue(context.getWorld().getBlockState(glass).isOf(Blocks.GLASS), "damage_blocks=false must preserve glass.");
            context.assertTrue(context.getWorld().getBlockState(stone).isOf(Blocks.STONE), "damage_blocks=false must preserve stone.");
            StatusEffect slowness = Registries.STATUS_EFFECT.get(SLOWNESS_ID);
            context.assertTrue(player.isAlive(), "The effect target must survive the controlled explosion.");
            context.assertTrue(slowness != null && player.hasStatusEffect(Registries.STATUS_EFFECT.getEntry(SLOWNESS_ID).orElseThrow()), "Explosion must apply slowness to nearby players.");
            context.complete();
        });
    }

    @GameTest(templateName = FabricGameTest.EMPTY_STRUCTURE, tickLimit = 100)
    public void runtimeEntityIsRegisteredForVanillaBiomeSpawnsAndGroundRestriction(TestContext context) {
        context.assertEquals(SpawnGroup.MONSTER, CREATURE.getSpawnGroup(), "Hostile runtime entities must use MONSTER spawns.");
        context.assertEquals(SpawnLocationTypes.ON_GROUND, SpawnRestriction.getLocation(CREATURE), "Runtime mobs must use ON_GROUND restriction.");
        var biomes = context.getWorld().getRegistryManager().get(RegistryKeys.BIOME);
        Biome plains = biomes.getEntry(Identifier.of("minecraft", "plains")).orElseThrow().value();
        SpawnSettings.SpawnEntry spawn = plains.getSpawnSettings().getSpawnEntries(SpawnGroup.MONSTER).getEntries().stream()
            .filter(entry -> entry.type == CREATURE)
            .findFirst()
            .orElseThrow(() -> new AssertionError("Runtime entity is missing from the plains monster spawn table."));
        context.assertEquals(1, spawn.minGroupSize, "Runtime spawn min group size must be preserved.");
        context.assertEquals(2, spawn.maxGroupSize, "Runtime spawn max group size must be preserved.");
        context.complete();
    }

    private static void invoke(StudioCreature creature, String methodName, Object value) {
        try {
            Method method = StudioCreature.class.getDeclaredMethod(methodName, value.getClass());
            method.setAccessible(true);
            method.invoke(creature, value);
        } catch (ReflectiveOperationException exception) {
            throw new RuntimeException("Failed to invoke generated runtime method " + methodName, exception);
        }
    }

    private static void invoke(StudioCreature creature, String methodName) {
        try {
            Method method = StudioCreature.class.getDeclaredMethod(methodName);
            method.setAccessible(true);
            method.invoke(creature);
        } catch (ReflectiveOperationException exception) {
            throw new RuntimeException("Failed to invoke generated runtime method " + methodName, exception);
        }
    }
}
