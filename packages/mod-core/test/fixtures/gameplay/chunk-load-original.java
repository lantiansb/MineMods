package com.minemods.content_azure_sample.gameplay.highland;

import com.minemods.content_azure_sample.gameplay.api.GameplayEntry;
import com.minemods.content_azure_sample.gameplay.api.ProjectContent;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerChunkEvents;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.entity.MobSpawnType;
import net.minecraft.world.item.ItemStack;
import net.minecraft.tags.BiomeTags;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.chunk.LevelChunk;

// The shape of the first mod that froze a world at load: the callback of a chunk still being loaded asks the WORLD for that chunk's height.
public final class Main implements GameplayEntry {
    private static final String PLANT = "azure_block";
    private static final String DWELLER = "CREATURE_ID";
    private static final int MIN_Y = 128;

    @Override
    public void onInitialize() {
        ServerChunkEvents.CHUNK_LOAD.register((world, chunk) -> {
            if (world.dimension() != Level.OVERWORLD) return;
            RandomSource random = RandomSource.create(chunk.getPos().toLong() ^ world.getSeed());
            if (random.nextInt(6) != 0) return;
            int x = chunk.getPos().getMinBlockX() + random.nextInt(16);
            int z = chunk.getPos().getMinBlockZ() + random.nextInt(16);
            int y = world.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, x, z);
            if (y < MIN_Y) return;
            grow(world, new BlockPos(x, y, z), random);
        });
    }

    private static void grow(ServerLevel level, BlockPos pos, RandomSource random) {
        if (!level.getBiome(pos).is(BiomeTags.IS_MOUNTAIN)) return;
        BlockState plant = ProjectContent.block(PLANT).defaultBlockState();
        if (!level.getBlockState(pos).isAir() || !level.getBlockState(pos.below()).canOcclude()) return;
        level.setBlock(pos, plant, 3);
        if (random.nextInt(8) == 0) ProjectContent.entity(DWELLER).spawn(level, pos.above(8), MobSpawnType.NATURAL);
    }

    static void reward(ServerPlayer player) {
        player.addItem(new ItemStack(ProjectContent.item("azure_shard"), 2));
    }
}
