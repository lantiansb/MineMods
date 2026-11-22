import type { TargetManifest } from "../target/manifest"

export function fixtureLightSource(pkg: string, modId: string, target: TargetManifest["loader"]["kind"]) {
  const fabric = target === "fabric"
  const forge = target === "forge"
  const bus = forge ? "net.minecraftforge.common.MinecraftForge" : "net.neoforged.neoforge.common.NeoForge"
  const events = forge ? "net.minecraftforge.event" : "net.neoforged.neoforge.event"
  return `package ${pkg}.entity;

import java.util.*;
import java.util.function.Supplier;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.*;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.material.PushReaction;
import net.minecraft.world.level.chunk.LevelChunk;

/** A private light source in ordinary air. The vanilla light engine handles propagation, shadows and network updates. */
public final class StudioFixtureLight {
    private static final String NAME = "minemods_internal/fixture_light";
    private static final Map<StudioArena.Spec, int[]> LEVELS = new IdentityHashMap<>();
    private static final Map<ServerLevel, Set<BlockPos>> SOURCES = new IdentityHashMap<>();
    private static Supplier<Block> block;

    private static Block make() {
        return new LightBlock(BlockBehaviour.Properties.of().noCollission().noOcclusion().replaceable().noLootTable()
            .pushReaction(PushReaction.DESTROY).lightLevel(LightBlock.LIGHT_EMISSION)) {};
    }

    public static StudioArena.Spec configure(StudioArena.Spec spec, int[] levels) {
        LEVELS.put(spec, levels);
        return spec;
    }

    static void register() {
        ${
          fabric
            ? `Block registered = net.minecraft.core.Registry.register(net.minecraft.core.registries.BuiltInRegistries.BLOCK,
            net.minecraft.resources.ResourceLocation.fromNamespaceAndPath("${modId}", NAME), make());
        block = () -> registered;
        net.fabricmc.fabric.api.event.lifecycle.v1.ServerChunkEvents.CHUNK_LOAD.register(StudioFixtureLight::loaded);
        net.fabricmc.fabric.api.event.lifecycle.v1.ServerChunkEvents.CHUNK_UNLOAD.register(StudioFixtureLight::unload);
        net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents.SERVER_STOPPING.register(StudioFixtureLight::stop);`
            : `block = ${pkg}.platform.StudioPlatform.block(NAME, StudioFixtureLight::make);
        ${bus}.EVENT_BUS.addListener((${events}.level.ChunkEvent.Load e) -> {
            if (e.getLevel() instanceof ServerLevel level && e.getChunk() instanceof LevelChunk chunk) loaded(level, chunk);
        });
        ${bus}.EVENT_BUS.addListener((${events}.level.ChunkEvent.Unload e) -> {
            if (e.getLevel() instanceof ServerLevel level && e.getChunk() instanceof LevelChunk chunk) unload(level, chunk);
        });
        ${bus}.EVENT_BUS.addListener((${events}.server.ServerStoppingEvent e) -> stop(e.getServer()));`
        }
    }

    // Inspect only the given chunk during loading. A saved marker can survive an abrupt process exit.
    private static void loaded(ServerLevel level, LevelChunk chunk) {
        chunk.findBlocks(state -> state.is(block.get()), (pos, state) ->
            SOURCES.computeIfAbsent(level, ignored -> new HashSet<>()).add(pos.immutable()));
    }

    private static void unload(ServerLevel level, LevelChunk chunk) {
        Set<BlockPos> positions = SOURCES.get(level);
        if (positions == null) return;
        positions.removeIf(pos -> {
            if (pos.getX() >> 4 != chunk.getPos().x || pos.getZ() >> 4 != chunk.getPos().z) return false;
            BlockState state = chunk.getBlockState(pos);
            if (state.is(block.get())) {
                chunk.setBlockState(pos, state.getFluidState().createLegacyBlock(), false);
                chunk.setLightCorrect(false);
                level.getChunkSource().getLightEngine().checkBlock(pos);
            }
            return true;
        });
    }

    private static void stop(MinecraftServer server) {
        for (ServerLevel level : server.getAllLevels()) {
            Set<BlockPos> positions = SOURCES.remove(level);
            if (positions != null) for (BlockPos pos : positions) clear(level, pos);
        }
    }

    private static boolean available(ServerLevel level, BlockPos pos) {
        return level.getChunkSource().getChunkNow(pos.getX() >> 4, pos.getZ() >> 4) != null;
    }

    private static void clear(ServerLevel level, BlockPos pos) {
        if (!available(level, pos)) return;
        BlockState state = level.getBlockState(pos);
        if (state.is(block.get())) level.setBlock(pos, state.getFluidState().createLegacyBlock(), Block.UPDATE_ALL);
    }

    static void sync(MinecraftServer server, Collection<StudioArena.Fight> fights) {
        if (fights.isEmpty() && SOURCES.isEmpty()) return;
        for (ServerLevel level : server.getAllLevels()) {
            Map<BlockPos, Integer> wanted = new HashMap<>();
            for (StudioArena.Fight room : fights) {
                if (room.level != level || room.boss.isRemoved()) continue;
                int[] levels = LEVELS.get(room.spec);
                if (levels == null) continue;
                for (int i = 0; i < room.fixtures.length; i++) {
                    StudioFixture fixture = room.fixtures[i];
                    if (fixture == null || fixture.isRemoved()) continue;
                    int power = fixture.lit() ? levels[2*i] : fixture.ember() ? levels[2*i+1] : 0;
                    if (power > 0) wanted.merge(fixture.blockPosition(), power, Math::max);
                }
            }
            Set<BlockPos> positions = SOURCES.get(level);
            if (positions == null && wanted.isEmpty()) continue;
            if (positions == null) { positions = new HashSet<>(); SOURCES.put(level, positions); }
            for (Iterator<BlockPos> it = positions.iterator(); it.hasNext();) {
                BlockPos pos = it.next();
                if (wanted.containsKey(pos)) continue;
                if (!available(level, pos)) continue;
                clear(level, pos);
                it.remove();
            }
            for (var entry : wanted.entrySet()) {
                BlockPos pos = entry.getKey();
                if (!available(level, pos)) continue;
                BlockState current = level.getBlockState(pos);
                int power = entry.getValue();
                if (current.is(block.get()) && current.getValue(LightBlock.LEVEL) == power) { positions.add(pos); continue; }
                if (!current.is(Blocks.AIR) && !current.is(block.get())) continue;
                BlockState base = current.is(block.get()) ? current : block.get().defaultBlockState();
                if (level.setBlock(pos, base.setValue(LightBlock.LEVEL, power), Block.UPDATE_ALL)) positions.add(pos);
            }
            if (positions.isEmpty()) SOURCES.remove(level);
        }
    }
}
`
}
