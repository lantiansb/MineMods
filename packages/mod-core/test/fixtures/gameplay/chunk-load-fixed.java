package com.minemods.content_azure_sample.gameplay.highland;

import com.minemods.content_azure_sample.gameplay.api.GameplayEntry;
import com.minemods.content_azure_sample.gameplay.api.ProjectContent;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Map;
import java.util.Queue;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerChunkEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.entity.MobSpawnType;
import net.minecraft.world.item.ItemStack;
import net.minecraft.resources.ResourceKey;
import net.minecraft.tags.BiomeTags;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.chunk.LevelChunk;

// The same gameplay as it was repaired: the callback reads the chunk it was handed and only notes a place; the world is touched at the end of the tick.
public final class Main implements GameplayEntry {
    private static final String PLANT = "azure_block";
    private static final String DWELLER = "CREATURE_ID";
    private static final int MIN_Y = 128;
    private static final Map<ResourceKey<Level>, Queue<BlockPos>> WAITING = new HashMap<>();

    @Override
    public void onInitialize() {
        ServerChunkEvents.CHUNK_LOAD.register((world, chunk) -> {
            if (world.dimension() != Level.OVERWORLD) return;
            RandomSource random = RandomSource.create(chunk.getPos().toLong() ^ world.getSeed());
            if (random.nextInt(6) != 0) return;
            int x = chunk.getPos().getMinBlockX() + random.nextInt(16);
            int z = chunk.getPos().getMinBlockZ() + random.nextInt(16);
            int y = chunk.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, x, z) + 1;
            if (y < MIN_Y || !chunk.getBlockState(new BlockPos(x, y - 1, z)).canOcclude()) return;
            WAITING.computeIfAbsent(world.dimension(), key -> new ArrayDeque<>()).add(new BlockPos(x, y, z));
        });
        ServerTickEvents.END_WORLD_TICK.register(world -> {
            Queue<BlockPos> waiting = WAITING.get(world.dimension());
            if (waiting == null) return;
            for (int done = 0; done < 4 && !waiting.isEmpty(); done++) grow(world, waiting.poll(), world.getRandom());
        });
    }

    private static void grow(ServerLevel level, BlockPos pos, RandomSource random) {
        if (!level.hasChunk(pos.getX() >> 4, pos.getZ() >> 4)) return;
        if (!level.getBiome(pos).is(BiomeTags.IS_MOUNTAIN)) return;
        BlockState plant = ProjectContent.block(PLANT).defaultBlockState();
        if (!level.getBlockState(pos).isAir()) return;
        level.setBlock(pos, plant, 3);
        if (random.nextInt(8) == 0) ProjectContent.entity(DWELLER).spawn(level, pos.above(8), MobSpawnType.NATURAL);
    }

    static void reward(ServerPlayer player) {
        player.addItem(new ItemStack(ProjectContent.item("azure_shard"), 2));
    }
}
