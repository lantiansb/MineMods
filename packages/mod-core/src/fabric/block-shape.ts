import { BLOCK_SHAPE, FACING_TURN, SHAPE_FACES, SHAPE_FACINGS, facingBox, shapeBoxes, type Box, type BlockShape, type ShapeFacing } from "@minemods/studio-ai/block-shape"
import { decodeTextureDataUrl } from "../content-texture"
import { BOUNCE_IMPORTS, bounceOf, bounceSource, launchOf } from "./block-bounce"
import type { Block } from "../content"

/**
 * A block with a shape (`shape` in the block's document): the model of boxes, the blockstate that turns it to
 * face the player, the sheet it is drawn on, and the Java that makes the game treat it as that shape. A block
 * without one never comes through here, so its files are what every build wrote.
 */

type Shaped = Block & { shape: BlockShape }
export const isShaped = (block: Block): block is Shaped => Boolean(block.shape)

/** The Java class of a block with a shape; the identifier is lower case and underscores, so no two blocks' names meet. */
export const shapedClass = (block: Block) => `ShapedBlock_${block.identifier}`
/** The client class that gives every shaped block the cutout render layer; the client entrypoint of the mod lists it only when there is one. */
export const BLOCK_CLIENT_CLASS = "StudioBlockClient"

/** The name of the sheet's texture. A hyphen cannot be in an identifier, an underscore can: `validateContent` refuses a block that would have the same name. */
export const sheetName = (block: Block) => `${block.identifier}_sheet`

/** The model JSON numbers: uv from sheet pixels to the model's 16, cleaned of float noise (four places is far finer than one sheet pixel of 64). */
const modelUv = (value: number, size: number) => Number(((value * BLOCK_SHAPE.block) / size).toFixed(4))

export function shapedModel(block: Shaped, modId: string, size: number) {
  return {
    // The game's own `block/block` carries how a block sits in the hand, the inventory slot and on the ground.
    parent: "minecraft:block/block",
    textures: { all: `${modId}:block/${sheetName(block)}`, particle: `${modId}:block/${block.identifier}` },
    elements: block.shape.elements.map((element) => ({
      name: element.name,
      from: element.from,
      to: element.to,
      ...(element.rotation && element.rotation.angle !== 0 ? { rotation: { angle: element.rotation.angle, axis: element.rotation.axis, origin: element.rotation.origin } } : {}),
      faces: Object.fromEntries(
        SHAPE_FACES.flatMap((face) => {
          const drawn = element.faces[face]
          return drawn ? [[face, { uv: drawn.uv.map((value) => modelUv(value, size)), texture: "#all", ...(drawn.cull ? { cullface: face } : {}) }]] : []
        }),
      ),
    })),
  }
}

/** The model is made facing north; the other three are the same model turned about the vertical (the game's own lectern: `"y": 90`, 180, 270). */
export function shapedBlockstate(block: Shaped, modId: string) {
  const model = `${modId}:block/${block.identifier}`
  return block.shape.facing === "horizontal"
    ? { variants: Object.fromEntries(SHAPE_FACINGS.map((facing) => [`facing=${facing}`, { model, ...(FACING_TURN[facing] ? { y: FACING_TURN[facing] } : {}) }])) }
    : { variants: { "": { model } } }
}

const cuboid = (box: Box) => `Shapes.box(${[...box.min, ...box.max].map((value) => `${value} / 16.0`).join(", ")})`
const union = (boxes: Box[]) => (boxes.length === 1 ? cuboid(boxes[0]!) : `Shapes.or(${boxes.map(cuboid).join(", ")})`)

/**
 * The block's own class. `facing`: the property the game's lectern and furnace use, set from the player's
 * facing at placement. `collision: shape`: the outline and the collision are the boxes (turned for each way it
 * can face, built once when the class loads). The experience a block gives is what `DropExperienceBlock` does,
 * written here because a block has one parent class.
 */
export function shapedBlockSource(
  block: Shaped,
  packageName: string,
  /**
   * How the experience is dropped, for a loader that does not drop it the vanilla way (`LoaderAdapter.blockExperience`); left out,
   * vanilla's `spawnAfterBreak`, as Fabric has always been written.
   */
  experienceMember?: (range: string) => { readonly member: string; readonly imports: readonly string[] },
) {
  const name = shapedClass(block)
  const horizontal = block.shape.facing === "horizontal"
  const boxes = shapeBoxes(block.shape.elements)
  const shaped = block.shape.collision === "shape"
  const shapes = horizontal ? SHAPE_FACINGS : (["north"] as const)
  const shapeField = (facing: ShapeFacing) => `    private static final VoxelShape SHAPE_${facing.toUpperCase()} = ${union(boxes.map((box) => facingBox(box, facing)))};`
  const experience = block.experience
  const ownExperience = experience && experienceMember ? experienceMember(`UniformInt.of(${experience.min}, ${experience.max})`) : null
  const bounce = bounceOf(block)
  const launch = launchOf(block)
  const imports = [...new Set([
    "com.mojang.serialization.MapCodec",
    "net.minecraft.world.level.block.Block",
    "net.minecraft.world.level.block.state.BlockBehaviour",
    // Named only by a class with a method that takes a block state: no import is left that nothing uses.
    ...(horizontal || shaped || (experience && !ownExperience) ? ["net.minecraft.world.level.block.state.BlockState"] : []),
    ...(horizontal ? ["net.minecraft.world.level.block.HorizontalDirectionalBlock", "net.minecraft.world.item.context.BlockPlaceContext", "net.minecraft.world.level.block.state.StateDefinition", "net.minecraft.core.Direction"] : []),
    ...(shaped ? ["net.minecraft.world.phys.shapes.CollisionContext", "net.minecraft.world.phys.shapes.VoxelShape", "net.minecraft.world.phys.shapes.Shapes", "net.minecraft.world.level.BlockGetter"] : []),
    ...(ownExperience ? ["net.minecraft.util.valueproviders.UniformInt", ...ownExperience.imports] : experience ? ["net.minecraft.world.item.ItemStack", "net.minecraft.server.level.ServerLevel", "net.minecraft.util.valueproviders.UniformInt"] : []),
    ...(shaped || (experience && !ownExperience) ? ["net.minecraft.core.BlockPos"] : []),
    ...(bounce || launch ? BOUNCE_IMPORTS : []),
  ])].sort()
  return `package ${packageName}.block;

${imports.map((line) => `import ${line};`).join("\n")}

public final class ${name} extends ${horizontal ? "HorizontalDirectionalBlock" : "Block"} {
    public static final MapCodec<${name}> CODEC = simpleCodec(${name}::new);
${shaped ? `${shapes.map(shapeField).join("\n")}\n` : ""}
    public ${name}(BlockBehaviour.Properties settings) {
        super(settings);
${horizontal ? "        registerDefaultState(getStateDefinition().any().setValue(FACING, Direction.NORTH));\n" : ""}    }

    @Override
    protected MapCodec<? extends ${horizontal ? "HorizontalDirectionalBlock" : "Block"}> codec() {
        return CODEC;
    }
${horizontal ? `
    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        builder.add(FACING);
    }

    @Override
    public BlockState getStateForPlacement(BlockPlaceContext context) {
        return defaultBlockState().setValue(FACING, context.getHorizontalDirection().getOpposite());
    }
` : ""}${shaped ? `
    private static VoxelShape shapeOf(BlockState state) {
${horizontal ? `        return switch (state.getValue(FACING)) {
            case EAST -> SHAPE_EAST;
            case SOUTH -> SHAPE_SOUTH;
            case WEST -> SHAPE_WEST;
            default -> SHAPE_NORTH;
        };` : "        return SHAPE_NORTH;"}
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter world, BlockPos pos, CollisionContext context) {
        return shapeOf(state);
    }

    @Override
    protected VoxelShape getCollisionShape(BlockState state, BlockGetter world, BlockPos pos, CollisionContext context) {
        return shapeOf(state);
    }
` : ""}${ownExperience ? `
${ownExperience.member}
` : experience ? `
    @Override
    protected void spawnAfterBreak(BlockState state, ServerLevel world, BlockPos pos, ItemStack tool, boolean dropExperience) {
        super.spawnAfterBreak(state, world, pos, tool, dropExperience);
        if (dropExperience) tryDropExperience(world, pos, tool, UniformInt.of(${experience.min}, ${experience.max}));
    }
` : ""}${bounce || launch ? `
${bounceSource(bounce, "    ", launch)}
` : ""}}
`
}

/** Gives every shaped block the cutout layer, so its empty pixels are holes and not black. Client side only. */
export function shapedClientSource(blocks: Block[], packageName: string) {
  return `package ${packageName}.client;

import ${packageName}.StudioContentRegistry;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.blockrenderlayer.v1.BlockRenderLayerMap;
import net.minecraft.client.renderer.RenderType;

public final class ${BLOCK_CLIENT_CLASS} implements ClientModInitializer {
    @Override public void onInitializeClient() {
${blocks.map((block) => `        BlockRenderLayerMap.INSTANCE.putBlock(StudioContentRegistry.BLOCK_${block.identifier.toUpperCase()}, RenderType.cutout());`).join("\n")}
    }
}
`
}

const sourceRoot = (packageName: string) => `src/main/java/${packageName.replaceAll(".", "/")}`

/** Every file a shaped block adds, except its item model, loot, tags and language, which every block gets the same way. `sheetSize`: the side of its sheet, read from the picture. */
export function compileShapedBlock(block: Shaped, modId: string, resources: string, packageName: string, sheetSize: number) {
  return {
    [`${resources}/blockstates/${block.identifier}.json`]: JSON.stringify(shapedBlockstate(block, modId), null, 2),
    [`${resources}/models/block/${block.identifier}.json`]: JSON.stringify(shapedModel(block, modId, sheetSize), null, 2),
    [`${resources}/textures/block/${sheetName(block)}.png`]: decodeTextureDataUrl(block.shape.sheet),
    [`${sourceRoot(packageName)}/block/${shapedClass(block)}.java`]: shapedBlockSource(block, packageName),
  } as Record<string, string | Uint8Array>
}

export function compileShapedClient(blocks: Block[], packageName: string) {
  const shaped = blocks.filter(isShaped)
  return shaped.length ? { [`${sourceRoot(packageName)}/client/${BLOCK_CLIENT_CLASS}.java`]: shapedClientSource(shaped, packageName) } : {}
}
