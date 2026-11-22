import { LAIR_LIMITS, lairSeparation } from "../boss-words"
import type { Lair } from "../entity-runtime"
import type { GenTarget } from "../platform/adapter"
import { PLATFORM_CLASS, PLATFORM_PACKAGE } from "../platform/facade"
import { FABRIC_TARGET } from "../platform/target"

/**
 * What a boss's lair (`boss.lair`) adds to a generated mod. Nothing runs at game time: the lair is a structure of the game's own worldgen, found with
 * `/locate structure <mod id>:<creature id>_lair`, made with the chunks of a world and holding the boss, placed once while it is made (as the ocean monument places its
 * elder guardians). It never touches what a player builds, and it is saved with the chunks, so a reload does not make it again.
 * - One fixed class (`StudioLair`): the same for every mod but its package and mod id, and for every creature of the mod. It is the structure (its codec reads the lair's
 *   fields from the structure's JSON, it finds the highest ground near the middle of its chunk) and its one kind of piece (the platform, the cleared air and the boss).
 * - Per creature, two datapack files: the structure (`worldgen/structure/<id>_lair.json`) and the structure set that places it (`worldgen/structure_set/<id>_lair.json`),
 *   and a biome tag when the lair names biomes and groups of biomes together.
 * Every name used from Minecraft 1.21.1 is Mojang's (Loom's officialMojangMappings): `Structure` (`findGenerationPoint(GenerationContext)`, `settingsCodec`, `type`, the
 * `GenerationContext` record's `chunkGenerator`, `randomState`, `heightAccessor` and `chunkPos`, `GenerationStub(BlockPos, Consumer<StructurePiecesBuilder>)`), `StructurePiece`
 * (`addAdditionalSaveData(StructurePieceSerializationContext, CompoundTag)`, `postProcess(WorldGenLevel, StructureManager, ChunkGenerator, RandomSource, BoundingBox, ChunkPos, BlockPos)`),
 * `StructurePieceType.ContextlessType`, `StructureType`, `ChunkGenerator.getBaseHeight(int, int, Heightmap.Types, LevelHeightAccessor, RandomState)`.
 * The game checks the lair's biomes itself, at the position the structure returns (`Structure.findValidGenerationPoint`), against the `biomes` of the structure's JSON.
 * Only written for a project where some boss has a lair, so every other project is generated as it was.
 *
 * A facade target (Forge, NeoForge) gets the same class but for what reaches the loader: the structure type and the piece type are registered through
 * `StudioPlatform.register` (the loaders' deferred registers, while the mod is constructed) and held as suppliers, the structure type's codec is the version's
 * (`VersionAdapter.boss.structureCodec`), and the boss's first spawn names its difficulty apart so 1.20.1's `finalizeSpawn` can take its fifth argument.
 */

/** The name of the fixed class every lair of a mod shares. */
export const LAIR_CLASS = "StudioLair"

/** The structure set's `salt`: the game's own structures each have one, so that their placements do not line up. A hash of the mod and the creature (FNV-1a), in the range the game takes (0 to 2^31 - 1). */
export function lairSalt(modId: string, id: string) {
  const hash = [...`${modId}:${id}_lair`].reduce((value, letter) => Math.imul(value ^ letter.charCodeAt(0), 16777619), 2166136261)
  return (hash >>> 0) & 0x7fffffff
}

/** A block of the lair as the game names it: a vanilla block as it is written, this project's own with the mod's name. */
const blockId = (modId: string, block: string) => (block.includes(":") ? block : `${modId}:${block}`)

/** A kind of creature put in a lair as it is made (`runtime.garrison`): its registry id in this mod, and how many of it in each lair. */
export type LairGuard = { creature: string; min: number; max: number }

/** The datapack files of one creature's lair: its structure, its structure set, and the biome tag when the structure needs one. */
export function lairData(modId: string, id: string, lair: Lair, guards: readonly LairGuard[] = []): Record<string, string> {
  const data = `src/main/resources/data/${modId}`
  const name = `${id}_lair`
  const tags = lair.tags ?? []
  // Biomes alone are a list, one group of biomes alone is that group's tag; the two together (or several groups) are a tag of this mod that holds them all.
  const tag = tags.length > 0 && (lair.biomes.length > 0 || tags.length > 1)
  const biomes = tags.length === 0 ? lair.biomes : tag ? `#${modId}:${name}` : `#minecraft:${tags[0]}`
  return {
    [`${data}/worldgen/structure/${name}.json`]: JSON.stringify(
      {
        type: `${modId}:lair`,
        biomes,
        // The last step of a chunk's making: whatever was built or grown in its area before (another structure, trees) is cleared by it, and only the thin snow of
        // that same step's freezing settles on the floor afterwards (epic game2: a pillager outpost and trees stood inside a lair made at surface_structures).
        step: "top_layer_modification",
        spawn_overrides: {},
        terrain_adaptation: "none",
        creature: `${modId}:${id}`,
        floor: lair.floor.map((block) => blockId(modId, block)),
        ...(lair.rim ? { rim: blockId(modId, lair.rim) } : {}),
        radius: lair.radius,
        clearance: lair.clearance,
        ...(lair.above_sea ? { above_sea: lair.above_sea } : {}),
        // r29: the creatures put on its platform with the boss (`runtime.garrison` of each); left out when there are none, so a lair without guards is written as it was.
        ...(guards.length ? { guards: guards.map((guard) => ({ creature: `${modId}:${guard.creature}`, min: guard.min, max: guard.max })) } : {}),
      },
      null,
      2,
    ),
    [`${data}/worldgen/structure_set/${name}.json`]: JSON.stringify(
      {
        placement: { type: "minecraft:random_spread", salt: lairSalt(modId, id), separation: lairSeparation(lair.spacing), spacing: lair.spacing },
        structures: [{ structure: `${modId}:${name}`, weight: 1 }],
      },
      null,
      2,
    ),
    ...(tag ? { [`${data}/tags/worldgen/biome/${name}.json`]: JSON.stringify({ values: [...lair.biomes, ...tags.map((group) => `#minecraft:${group}`)] }, null, 2) } : {}),
  }
}

/** The fixed class: the lair's structure, its piece, and the registration of both. `target`: Fabric 1.21.1 (the default) is this text exactly as it always was. */
export function lairClass(modId: string, packageName: string, target: GenTarget = FABRIC_TARGET, guarded = false) {
  const { radius, clearance, search, step, check, support } = LAIR_LIMITS
  const facade = target.loader.facade
  // The line of Fabric's text, or the facade's in its place.
  const by = (fabric: string, platform: string) => (facade ? platform : fabric)
  // r29: the text of a mod none of whose lairs holds guards, exactly as before, or the text that reads and places them (`runtime.garrison`).
  const g = (plain: string, more: string) => (guarded ? more : plain)
  // A guard is created and readied as the boss is, by the same version difference.
  const ready = (indent: string) => by(`${indent}mob.finalizeSpawn(world, world.getCurrentDifficultyAt(mob.blockPosition()), MobSpawnType.STRUCTURE, null);`, `${indent}DifficultyInstance difficulty = world.getCurrentDifficultyAt(mob.blockPosition());
${indent}mob.finalizeSpawn(world, difficulty, MobSpawnType.STRUCTURE, null);`)
  return `package ${packageName};

import com.mojang.serialization.Codec;
import com.mojang.serialization.MapCodec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
${by("", `import java.util.function.Supplier;\nimport ${packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};\n`)}import net.minecraft.core.BlockPos;
import net.minecraft.core.QuartPos;
${by("import net.minecraft.core.Registry;\n", "")}import net.minecraft.core.registries.BuiltInRegistries;
${by("", "import net.minecraft.core.registries.Registries;\n")}import net.minecraft.nbt.CompoundTag;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.RandomSource;
${by("", "import net.minecraft.world.DifficultyInstance;\n")}import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.MobSpawnType;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.LevelHeightAccessor;
import net.minecraft.world.level.StructureManager;
import net.minecraft.world.level.WorldGenLevel;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.ChunkGenerator;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.levelgen.RandomState;
import net.minecraft.world.level.levelgen.structure.BoundingBox;
import net.minecraft.world.level.levelgen.structure.Structure;
import net.minecraft.world.level.levelgen.structure.StructurePiece;
import net.minecraft.world.level.levelgen.structure.StructureType;
import net.minecraft.world.level.levelgen.structure.pieces.StructurePieceSerializationContext;
import net.minecraft.world.level.levelgen.structure.pieces.StructurePieceType;

/**
 * Generated by MineMods Studio: the lair of a boss (data/${modId}/worldgen/structure/&lt;creature&gt;_lair.json). A structure of the game's own worldgen: it is made with the
 * chunks of a world, saved with them, found with /locate structure, and never touches what a player builds. Its fields are read from that JSON; the boss is placed once,
 * while the chunk that holds the middle of the platform is made. The same class for every lair of this mod.
 */
public final class ${LAIR_CLASS} extends Structure {
    public static final String MOD_ID = "${modId}";
    // How far from the middle of its start chunk the highest ground is looked for (blocks), the grid it is looked for on, and the grid the platform is checked on (the terrain's noise
    // cell is 4 blocks wide). The deepest the platform may have to be held up, and is built down (twice its greatest radius, ${radius.max}).
    private static final int SEARCH = ${search};
    private static final int STEP = ${step};
    private static final int CHECK = ${check};
    private static final int SUPPORT = ${support};

    public static final MapCodec<${LAIR_CLASS}> CODEC = RecordCodecBuilder.mapCodec(instance -> instance.group(
        settingsCodec(instance),
        ResourceLocation.CODEC.fieldOf("creature").forGetter(lair -> lair.creature),
        ResourceLocation.CODEC.listOf().fieldOf("floor").forGetter(lair -> lair.floor),
        ResourceLocation.CODEC.optionalFieldOf("rim").forGetter(lair -> lair.rim),
        Codec.intRange(${radius.min}, ${radius.max}).fieldOf("radius").forGetter(lair -> lair.radius),
        Codec.intRange(${clearance.min}, ${clearance.max}).fieldOf("clearance").forGetter(lair -> lair.clearance),
        Codec.INT.optionalFieldOf("above_sea", 0).forGetter(lair -> lair.aboveSea)${g("", `,
        Guard.CODEC.listOf().optionalFieldOf("guards", List.of()).forGetter(lair -> lair.guards)`)}
    ).apply(instance, ${LAIR_CLASS}::new));
${g("", `
    /** A kind of creature put on the platform with the boss as the lair is made (runtime.garrison): min to max of it in each lair, kept, never put back. */
    public record Guard(ResourceLocation creature, int min, int max) {
        public static final Codec<Guard> CODEC = RecordCodecBuilder.create(instance -> instance.group(
            ResourceLocation.CODEC.fieldOf("creature").forGetter(Guard::creature),
            Codec.intRange(1, 8).fieldOf("min").forGetter(Guard::min),
            Codec.intRange(1, 8).fieldOf("max").forGetter(Guard::max)
        ).apply(instance, Guard::new));
    }
`)}
${by(`    private static StructureType<${LAIR_CLASS}> type;
    private static StructurePieceType pieceType;
`, `    private static Supplier<StructureType<${LAIR_CLASS}>> type;
    private static Supplier<StructurePieceType> pieceType;
`)}
    private final ResourceLocation creature;
    private final List<ResourceLocation> floor;
    private final Optional<ResourceLocation> rim;
    private final int radius;
    private final int clearance;
    private final int aboveSea;
${g("", "    private final List<Guard> guards;\n")}
    private ${LAIR_CLASS}(Structure.StructureSettings config, ResourceLocation creature, List<ResourceLocation> floor, Optional<ResourceLocation> rim, int radius, int clearance, int aboveSea${g("", ", List<Guard> guards")}) {
        super(config);
        this.creature = creature;
        this.floor = floor;
        this.rim = rim;
        this.radius = radius;
        this.clearance = clearance;
        this.aboveSea = aboveSea;
${g("", "        this.guards = guards;\n")}    }

    /** Registers the structure type and the piece type once, however many creatures have a lair. */
    public static void register() {
        if (type != null) return;
${by(`        pieceType = Registry.register(BuiltInRegistries.STRUCTURE_PIECE, ResourceLocation.fromNamespaceAndPath(MOD_ID, "lair"), (StructurePieceType.ContextlessType) Piece::new);
        StructureType<${LAIR_CLASS}> lair = () -> CODEC;
        type = Registry.register(BuiltInRegistries.STRUCTURE_TYPE, ResourceLocation.fromNamespaceAndPath(MOD_ID, "lair"), lair);
`, `        // Through the facade: the loader registers both when the game registers its structure types and pieces.
        pieceType = ${PLATFORM_CLASS}.register(Registries.STRUCTURE_PIECE, "lair", () -> (StructurePieceType.ContextlessType) Piece::new);
        type = ${PLATFORM_CLASS}.register(Registries.STRUCTURE_TYPE, "lair", () -> {
            StructureType<${LAIR_CLASS}> lair = () -> ${target.version.boss.structureCodec("CODEC")};
            return lair;
        });
`)}    }

    @Override public StructureType<?> type() { return type${by("", ".get()")}; }

    /**
     * The middle of the lair is the highest ground within SEARCH blocks of the middle of its chunk. No lair on water (the top of the column is not solid), where the floor would be lower than
     * the lair asks to be above the sea, where the platform would have to be held up by more than SUPPORT blocks anywhere on its ground, or where its air would reach the top of what the
     * world generates (which also leaves out a world with a roof).
     */
    @Override protected Optional<Structure.GenerationStub> findGenerationPoint(Structure.GenerationContext context) {
        ChunkGenerator generator = context.chunkGenerator();
        LevelHeightAccessor limits = context.heightAccessor();
        RandomState noise = context.randomState();
        int originX = context.chunkPos().getMiddleBlockX();
        int originZ = context.chunkPos().getMiddleBlockZ();
        // The cheap test first: the biome. The middle and four points on the search circle, on the ground; when none of them is a biome of the lair, nothing else is
        // measured (epic game2: /locate sampled the full grid of every region it passed and held the server for 44 seconds). The game still checks the biome at the
        // middle that is found (Structure.getValidStructurePosition).
        boolean near = false;
        // The four outer points lie on the search circle, on its diagonals (SEARCH * 7 / 10 each way is within a block of SEARCH from the middle).
        int out = SEARCH * 7 / 10;
        for (int[] at : new int[][] { { 0, 0 }, { out, out }, { out, -out }, { -out, out }, { -out, -out } }) {
            int x = originX + at[0];
            int z = originZ + at[1];
            int y = generator.getBaseHeight(x, z, Heightmap.Types.WORLD_SURFACE_WG, limits, noise);
            if (context.validBiome().test(context.biomeSource().getNoiseBiome(QuartPos.fromBlock(x), QuartPos.fromBlock(y), QuartPos.fromBlock(z), noise.sampler()))) { near = true; break; }
        }
        if (!near) return Optional.empty();
        int centreX = originX;
        int centreZ = originZ;
        int top = Integer.MIN_VALUE;
        for (int dx = -SEARCH; dx <= SEARCH; dx += STEP) {
            for (int dz = -SEARCH; dz <= SEARCH; dz += STEP) {
                if (dx * dx + dz * dz > SEARCH * SEARCH) continue;
                int height = generator.getBaseHeight(originX + dx, originZ + dz, Heightmap.Types.WORLD_SURFACE_WG, limits, noise);
                if (height > top) { top = height; centreX = originX + dx; centreZ = originZ + dz; }
            }
        }
        // getHeight is the first free block above the ground: the floor takes the place of the top block.
        int floorY = top - 1;
        if (generator.getBaseHeight(centreX, centreZ, Heightmap.Types.OCEAN_FLOOR_WG, limits, noise) < top) return Optional.empty();
        // Counted where the boss stands, on top of the floor, as a creature's own spawn counts above_sea at its feet.
        if (aboveSea > 0 && floorY + 1 < generator.getSeaLevel() + aboveSea) return Optional.empty();
        if (floorY + clearance >= generator.getMinY() + generator.getGenDepth()) return Optional.empty();
        for (int dx = -radius; dx <= radius; dx += CHECK) {
            for (int dz = -radius; dz <= radius; dz += CHECK) {
                if (dx * dx + dz * dz > radius * radius) continue;
                int ground = generator.getBaseHeight(centreX + dx, centreZ + dz, Heightmap.Types.OCEAN_FLOOR_WG, limits, noise) - 1;
                if (floorY - ground > SUPPORT) return Optional.empty();
            }
        }
        BoundingBox box = new BoundingBox(centreX - radius, Math.max(limits.getMinBuildHeight(), floorY - SUPPORT), centreZ - radius, centreX + radius, floorY + clearance, centreZ + radius);
${g("", `        // Where each guard stands, fixed here once for the whole lair (each chunk of it is made apart): its kind, then blocks east and south of the middle. Inside the rim,
        // and the same for the same world and place (the random numbers come from the world's seed and the middle).
        StringBuilder posted = new StringBuilder();
        RandomSource pick = RandomSource.create(context.seed() ^ ((long) centreX * 341873128712L + (long) centreZ * 132897987541L));
        for (Guard guard : guards) {
            int count = guard.min() + pick.nextInt(Math.max(1, guard.max() - guard.min() + 1));
            for (int index = 0; index < count; index++) {
                double angle = pick.nextDouble() * Math.PI * 2;
                double apart = (radius - 1.5) * (0.45 + 0.5 * pick.nextDouble());
                if (posted.length() > 0) posted.append(';');
                posted.append(guard.creature()).append(',').append((int) Math.round(Math.cos(angle) * apart)).append(',').append((int) Math.round(Math.sin(angle) * apart));
            }
        }
`)}        Piece piece = new Piece(box, creature, floor, rim, centreX, floorY, centreZ, radius, clearance${g("", ", posted.toString()")});
        return Optional.of(new Structure.GenerationStub(new BlockPos(centreX, floorY, centreZ), collector -> collector.addPiece(piece)));
    }

    /** The platform, the air above it and the boss: what the lair is made of, a column at a time and only inside the chunk being made. */
    public static final class Piece extends StructurePiece {
        private final ResourceLocation creature;
        private final List<ResourceLocation> floor;
        private final Optional<ResourceLocation> rim;
        private final int centreX;
        private final int floorY;
        private final int centreZ;
        private final int radius;
        private final int clearance;
${g("", "        private final String guards;\n")}
        Piece(BoundingBox box, ResourceLocation creature, List<ResourceLocation> floor, Optional<ResourceLocation> rim, int centreX, int floorY, int centreZ, int radius, int clearance${g("", ", String guards")}) {
            super(pieceType${by("", ".get()")}, 0, box);
            this.creature = creature;
            this.floor = floor;
            this.rim = rim;
            this.centreX = centreX;
            this.floorY = floorY;
            this.centreZ = centreZ;
            this.radius = radius;
            this.clearance = clearance;
${g("", "            this.guards = guards;\n")}        }

        public Piece(CompoundTag nbt) {
            super(pieceType${by("", ".get()")}, nbt);
            this.creature = ResourceLocation.tryParse(nbt.getString("creature"));
            List<ResourceLocation> blocks = new ArrayList<>();
            for (String name : nbt.getString("floor").split(",")) {
                ResourceLocation id = ResourceLocation.tryParse(name);
                if (id != null) blocks.add(id);
            }
            this.floor = blocks;
            this.rim = nbt.contains("rim") ? Optional.ofNullable(ResourceLocation.tryParse(nbt.getString("rim"))) : Optional.empty();
            this.centreX = nbt.getInt("centre_x");
            this.floorY = nbt.getInt("floor_y");
            this.centreZ = nbt.getInt("centre_z");
            this.radius = nbt.getInt("radius");
            this.clearance = nbt.getInt("clearance");
${g("", `            // A piece saved before it had guards reads as none.
            this.guards = nbt.getString("guards");
`)}        }

        @Override protected void addAdditionalSaveData(StructurePieceSerializationContext context, CompoundTag nbt) {
            nbt.putString("creature", creature.toString());
            nbt.putString("floor", String.join(",", floor.stream().map(ResourceLocation::toString).toList()));
            rim.ifPresent(id -> nbt.putString("rim", id.toString()));
            nbt.putInt("centre_x", centreX);
            nbt.putInt("floor_y", floorY);
            nbt.putInt("centre_z", centreZ);
            nbt.putInt("radius", radius);
            nbt.putInt("clearance", clearance);
${g("", `            nbt.putString("guards", guards);
`)}        }

        /** A block the game has, else null: a block of another mod that is not installed is skipped, never a crash. */
        private static BlockState stateOf(ResourceLocation id) {
            return id != null && BuiltInRegistries.BLOCK.containsKey(id) ? BuiltInRegistries.BLOCK.get(id).defaultBlockState() : null;
        }

        @Override public void postProcess(WorldGenLevel world, StructureManager accessor, ChunkGenerator generator, RandomSource random, BoundingBox chunkBox, ChunkPos chunkPos, BlockPos pivot) {
            List<BlockState> floors = new ArrayList<>();
            for (ResourceLocation id : floor) {
                BlockState state = stateOf(id);
                if (state != null) floors.add(state);
            }
            // Nothing the game knows to build the floor of: plain stone, so the boss still has ground.
            if (floors.isEmpty()) floors.add(Blocks.STONE.defaultBlockState());
            BlockState rimState = rim.map(Piece::stateOf).orElse(null);
            BlockState air = Blocks.AIR.defaultBlockState();
            int minX = Math.max(boundingBox.minX(), chunkBox.minX());
            int maxX = Math.min(boundingBox.maxX(), chunkBox.maxX());
            int minZ = Math.max(boundingBox.minZ(), chunkBox.minZ());
            int maxZ = Math.min(boundingBox.maxZ(), chunkBox.maxZ());
            BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
            for (int x = minX; x <= maxX; x++) {
                for (int z = minZ; z <= maxZ; z++) {
                    int dx = x - centreX;
                    int dz = z - centreZ;
                    int distance = dx * dx + dz * dz;
                    if (distance > radius * radius) continue;
                    // Each column takes one of the floor's blocks by a fixed pattern of its place, so a world always has the same lair.
                    int mix = x * 73856093 ^ z * 19349663;
                    mix ^= mix >>> 15;
                    mix *= 0x2c1b3c6d;
                    mix ^= mix >>> 12;
                    world.setBlock(pos.set(x, floorY, z), floors.get(Math.floorMod(mix, floors.size())), 2);
                    for (int y = floorY + 1; y <= boundingBox.maxY(); y++) world.setBlock(pos.set(x, y, z), air, 2);
                    // Held up by the first floor block through air, water and what a block replaces (grass, snow), down to the ground.
                    for (int y = floorY - 1; y >= boundingBox.minY(); y--) {
                        BlockState below = world.getBlockState(pos.set(x, y, z));
                        if (!(below.isAir() || below.liquid() || below.canBeReplaced())) break;
                        world.setBlock(pos, floors.get(0), 2);
                    }
                    // The outermost ring of the platform: the columns between radius - 1 and radius from the middle.
                    if (rimState != null && distance > (radius - 1) * (radius - 1)) world.setBlock(pos.set(x, floorY + 1, z), rimState, 2);
                }
            }
${g("", `            // The guards (runtime.garrison), each once, by the chunk that holds the spot it was given: on the floor, kept until defeated, never put back.
            for (String entry : guards.isEmpty() ? new String[0] : guards.split(";")) {
                String[] part = entry.split(",");
                ResourceLocation id = part.length == 3 ? ResourceLocation.tryParse(part[0]) : null;
                if (id == null) continue;
                int x = centreX + Integer.parseInt(part[1]);
                int z = centreZ + Integer.parseInt(part[2]);
                if (x < chunkBox.minX() || x > chunkBox.maxX() || z < chunkBox.minZ() || z > chunkBox.maxZ()) continue;
                EntityType<?> guardKind = BuiltInRegistries.ENTITY_TYPE.getOptional(id).orElse(null);
                Entity guard = guardKind == null ? null : guardKind.create(world.getLevel());
                if (guard == null) continue;
                guard.moveTo(x + 0.5, floorY + 1, z + 0.5, random.nextFloat() * 360.0f, 0.0f);
                if (guard instanceof Mob mob) {
                    mob.setPersistenceRequired();
${ready("                    ")}
                }
                world.addFreshEntityWithPassengers(guard);
            }
`)}            if (centreX < chunkBox.minX() || centreX > chunkBox.maxX() || centreZ < chunkBox.minZ() || centreZ > chunkBox.maxZ()) return;
            // The boss, once, in the chunk that holds the middle: as the ocean monument places its elder guardians. It stays until it is defeated.
            if (creature == null) return;
            EntityType<?> kind = BuiltInRegistries.ENTITY_TYPE.getOptional(creature).orElse(null);
            Entity entity = kind == null ? null : kind.create(world.getLevel());
            if (entity == null) return;
            entity.moveTo(centreX + 0.5, floorY + 1, centreZ + 0.5, random.nextFloat() * 360.0f, 0.0f);
            if (entity instanceof Mob mob) {
                mob.setPersistenceRequired();
${by(`                mob.finalizeSpawn(world, world.getCurrentDifficultyAt(mob.blockPosition()), MobSpawnType.STRUCTURE, null);`, `                DifficultyInstance difficulty = world.getCurrentDifficultyAt(mob.blockPosition());
                mob.finalizeSpawn(world, difficulty, MobSpawnType.STRUCTURE, null);`)}
            }
            world.addFreshEntityWithPassengers(entity);
        }
    }
}
`
}
