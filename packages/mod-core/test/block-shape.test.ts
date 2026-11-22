import { afterEach, expect, test } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { reviewAsset } from "../src/acceptance"
import { assembleBuildSource } from "../src/build-source"
import { compileContent, validateContent } from "../src/content"
import { decodeTextureDataUrl } from "../src/content-texture"
import { blockFacets } from "../src/content-facets"
import { BLOCK_SHAPE_EXAMPLE, BLOCK_SHAPE_INSTRUCTIONS } from "../src/content-words"
import { DATA_CAPABILITY } from "../src/data-words"
import { BLOCK_CLIENT_CLASS, shapedClass } from "../src/fabric/block-shape"
import { modGuide } from "../src/guide"
import { encodePng } from "../src/png"
import { applyContent, getModuleSchema } from "../src/workspace"
import { MODULES } from "../src/workspace-modules"
import { ContentSchema } from "../src/content"
import { createProject, saveProject } from "../src/project"
import { reconcile } from "../src/reconcile"
import { runBlockDrawing, runDrawing } from "../src/script-run"
import { facingBox, FACE_CORNERS, shapeBoxes, SHAPE_FACES, type BlockShape } from "@minemods/studio-ai/block-shape"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac, hasTargetJavap, targetJdkTool } from "./target-javac"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-shape-"))
  roots.push(root)
  return root
}

// Pictures from arithmetic. `sheet`: a square picture with the lower right quarter empty (transparent), as a cut-out is.
const dataUrl = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`
const png = (seed: number, side = 16) => dataUrl(encodePng(Uint8Array.from({ length: side * side * 4 }, (_, index) => (index % 4 === 3 ? 255 : (index * seed) % 200)), side, side))
const sheet = (side = 32) => dataUrl(encodePng(Uint8Array.from({ length: side * side * 4 }, (_, index) => ((pixel) => (index % 4 === 3 ? ((pixel % side) >= side / 2 && Math.floor(pixel / side) >= side / 2 ? 0 : 255) : (index * 7) % 200))(Math.floor(index / 4))), side, side))
const base = { id: "7f2d1c9e-3a4b-4c5d-8e6f-0a1b2c3d4e5f", identifier: "ore", name: "矿", hardness: 3, luminance: 0, tool: "pickaxe", drop: "self", color: "#3a8fd0", texture: png(3) }
const stool = (extra: Partial<BlockShape> = {}) => ({ ...BLOCK_SHAPE_EXAMPLE, elements: structuredClone(BLOCK_SHAPE_EXAMPLE.elements), sheet: sheet(), ...extra })
const shaped = (extra: Record<string, unknown> = {}, shape: Record<string, unknown> = {}) => ({ ...base, id: randomUUID(), identifier: "stool", name: "凳子", hardness: 1, tool: "axe", shape: { ...stool(), ...shape }, ...extra })
const assets = "src/main/resources/assets/m"
const compiled = (blocks: Record<string, unknown>[]) => compileContent({ mod_id: "m", package_name: "a.b", blocks, items: [{ id: randomUUID(), identifier: "gem", name: "宝石", max_stack: 64, color: "#ffffff" }] })
const json = (files: Record<string, string | Uint8Array>, name: string) => JSON.parse(files[`${assets}/${name}`] as string) as unknown
const java = (files: Record<string, string | Uint8Array>, name: string) => files[`src/main/java/a/b/${name}`] as string
const withoutId = <Block extends { id: string }>({ id: _id, ...rest }: Block) => rest
const refusal = (block: Record<string, unknown>, others: Record<string, unknown>[] = []) => {
  try {
    validateContent({ mod_id: "m", blocks: [block, ...others] })
    return null
  } catch (error) {
    return (error as { issues: { message: string; path: (string | number)[] }[] }).issues[0]!
  }
}

test("a block without a shape generates exactly the files it always did: the same bytes, whether it is plain, an ore, one with several pictures, or glowing", () => {
  const generation = { dimension: "overworld", min_y: -16, max_y: 64, spread: "even", vein_size: 8, veins_per_chunk: 4, replaces: ["stone"], biomes: null }
  const cases: Record<string, Record<string, unknown>> = {
    plain: base,
    ore: { ...base, drop: "item", drop_item: { item: "gem", min: 1, max: 2, fortune: true }, tool_tier: "iron", experience: { min: 1, max: 3 }, sound: "stone", generation, name_en: "Ore" },
    variants: { ...base, variants: [png(5), png(7)], random_mirror: true, random_turn: true },
    glow: { ...base, luminance: 12, hardness: 0.5, tool: "none", drop: "none", texture: undefined, fuel: { burn_ticks: 200 } },
  }
  const gem = { id: "1f2d1c9e-3a4b-4c5d-8e6f-0a1b2c3d4e5f", identifier: "gem", name: "宝石", max_stack: 64, color: "#ffffff" }
  const hashes = Object.fromEntries(
    Object.entries(cases).map(([name, block]) => {
      const files = compileContent({ mod_id: "m", package_name: "a.b", blocks: [block], items: [gem] })
      const digest = createHash("sha256")
      Object.keys(files).sort().forEach((file) => digest.update(file).update(files[file]!))
      return [name, digest.digest("hex")]
    }),
  )
  // Taken from what the build wrote before shapes existed (since the generator writes Mojang's names, the registry class is the one file that differs); null and absent are the same.
  expect(hashes).toEqual({
    // names only (Yarn → Mojang), checked 2026-11-14
    plain: "0dc5502c20b8024cdd5cb4b6f54a7689abed393f2c71d80c77b6ecd41344c799",
    // names only (Yarn → Mojang), checked 2026-11-14
    ore: "b66ae64587c66042af38b8a7c81cbfaaf9b2e7677e0756e698d8ca9a9ea9360f",
    // names only (Yarn → Mojang), checked 2026-11-14
    variants: "aafbd1235f157124b9ac873c9149496d89cca342e733dc4550f2deab7b83a0f6",
    // names only (Yarn → Mojang), checked 2026-11-14
    glow: "9c412ddeacb4c901d29fa20a0ea1941e8be4a71c06ae675e30ae9b15d5699b97",
  })
  const withNull = compileContent({ mod_id: "m", package_name: "a.b", blocks: [{ ...base, shape: null }], items: [gem] })
  expect(withNull).toEqual(compileContent({ mod_id: "m", package_name: "a.b", blocks: [base], items: [gem] }))
  expect(Object.keys(withNull).some((name) => name.includes("ShapedBlock") || name.includes(BLOCK_CLIENT_CLASS))).toBe(false)
})

test("a block that turns to face the player: four variants of one model of boxes, drawn from one sheet, in the game's own formats", () => {
  const files = compiled([shaped()])
  expect(json(files, "blockstates/stool.json")).toEqual({
    variants: {
      "facing=north": { model: "m:block/stool" },
      "facing=east": { model: "m:block/stool", y: 90 },
      "facing=south": { model: "m:block/stool", y: 180 },
      "facing=west": { model: "m:block/stool", y: 270 },
    },
  })
  const model = json(files, "models/block/stool.json") as { parent: string; textures: Record<string, string>; elements: { name: string; from: number[]; to: number[]; faces: Record<string, { uv: number[]; texture: string; cullface?: string }>; rotation?: unknown }[] }
  expect(model.parent).toBe("minecraft:block/block")
  expect(model.textures).toEqual({ all: "m:block/stool_sheet", particle: "m:block/stool" })
  expect(model.elements.map((element) => element.name)).toEqual(["seat", "leg"])
  // A 32 pixel sheet's pixels are two to the model's 16: the seat's top, 12 pixels wide on the sheet, is 6 of the model's uv.
  expect(model.elements[0]!.faces.up).toEqual({ uv: [0, 0, 6, 6], texture: "#all" })
  expect(model.elements[0]!.from).toEqual([2, 10, 2])
  expect(model.elements[0]!).not.toHaveProperty("rotation")
  expect(Object.keys(model.elements[1]!.faces)).toEqual(["north", "south", "east", "west"])
  // The sheet and the particle: the sheet as drawn, the block's own picture for what it breaks into.
  expect(files[`${assets}/textures/block/stool_sheet.png`]).toEqual(decodeTextureDataUrl(shaped().shape.sheet))
  expect(files[`${assets}/textures/block/stool.png`]).toEqual(decodeTextureDataUrl(base.texture))
  expect(json(files, "models/item/stool.json")).toEqual({ parent: "m:block/stool" })
  // Nothing of the cube's way of making a block is left: no model of cubes, no list to choose from.
  expect(JSON.stringify(files[`${assets}/blockstates/stool.json`])).not.toContain("cube_all")
})

test("a box that is turned, a face that may be left out, and a block that does not turn: written the way the game's own models are", () => {
  const elements = [
    { name: "slab", from: [0, 0, 0], to: [16, 2, 16], rotation: null, faces: { down: { uv: [0, 0, 16, 16], cull: true }, up: { uv: [0, 0, 16, 16], cull: false } } },
    { name: "tilted", from: [6, 2, 6], to: [10, 12, 10], rotation: { axis: "z", angle: -22.5, origin: [8, 2, 8] }, faces: { east: { uv: [0, 0, 4, 10], cull: false }, north: { uv: [4, 0, 8, 10], cull: false } } },
    { name: "level", from: [4, 4, 4], to: [6, 6, 6], rotation: { axis: "y", angle: 0, origin: [8, 8, 8] }, faces: { up: { uv: [0, 10, 2, 12], cull: false } } },
  ]
  const files = compiled([shaped({ identifier: "slab_pot" }, { facing: "none", collision: "full", sheet: sheet(16), elements })])
  expect(json(files, "blockstates/slab_pot.json")).toEqual({ variants: { "": { model: "m:block/slab_pot" } } })
  const model = json(files, "models/block/slab_pot.json") as { elements: { rotation?: unknown; faces: Record<string, { uv: number[]; texture: string; cullface?: string }> }[] }
  expect(model.elements[0]!.faces.down).toEqual({ uv: [0, 0, 16, 16], texture: "#all", cullface: "down" })
  expect(model.elements[0]!.faces.up).not.toHaveProperty("cullface")
  // The game's own order of the rotation's words, and a turn of nothing is not written.
  expect(JSON.stringify(model.elements[1]!.rotation)).toBe('{"angle":-22.5,"axis":"z","origin":[8,2,8]}')
  expect(model.elements[2]).not.toHaveProperty("rotation")
  // At 16 a pixel of the sheet is a pixel of the model.
  expect(model.elements[1]!.faces.north!.uv).toEqual([4, 0, 8, 10])
})

test("the class of a block with a shape: it faces the player, it stops a player where its boxes are, its experience and its render layer", () => {
  const files = compiled([shaped({ drop: "none", experience: { min: 1, max: 3 } })])
  const registry = java(files, "StudioContentRegistry.java")
  expect(registry).toContain("import a.b.block.ShapedBlock_stool;")
  expect(registry).toContain('public static final Block BLOCK_STOOL = Registry.register(BuiltInRegistries.BLOCK, ResourceLocation.fromNamespaceAndPath(MOD_ID, "stool"), new ShapedBlock_stool(BlockBehaviour.Properties.of().strength(1f).lightLevel(state -> 0).noOcclusion()));')
  // It has an experience of its own and so does not use the game's class for it.
  expect(registry).not.toContain("DropExperienceBlock")
  expect(registry).not.toContain("UniformInt")
  const own = java(files, "block/ShapedBlock_stool.java")
  expect(own).toContain("public final class ShapedBlock_stool extends HorizontalDirectionalBlock")
  expect(own).toContain("registerDefaultState(getStateDefinition().any().setValue(FACING, Direction.NORTH));")
  expect(own).toContain("builder.add(FACING);")
  // The way the player looks, turned about: the front faces her.
  expect(own).toContain("defaultBlockState().setValue(FACING, context.getHorizontalDirection().getOpposite())")
  expect(own).toContain("tryDropExperience(world, pos, tool, UniformInt.of(1, 3));")
  // The boxes of each of the four ways it faces, built once when the class loads; the seat is the whole width, so it is the same each way.
  const shape = shaped().shape as unknown as BlockShape
  const boxes = shapeBoxes(shape.elements)
  const cuboid = (box: { min: readonly number[]; max: readonly number[] }) => `Shapes.box(${[...box.min, ...box.max].map((value) => `${value} / 16.0`).join(", ")})`
  ;(["north", "east", "south", "west"] as const).forEach((facing) => expect(own).toContain(`private static final VoxelShape SHAPE_${facing.toUpperCase()} = Shapes.or(${boxes.map((box) => cuboid(facingBox(box, facing))).join(", ")});`))
  expect(own).toContain("protected VoxelShape getShape(")
  expect(own).toContain("protected VoxelShape getCollisionShape(")
  expect(own).toContain("case EAST -> SHAPE_EAST;")
  // The client gives the block its cut-out layer; a mod with no shaped block has no such class.
  expect(java(files, `client/${BLOCK_CLIENT_CLASS}.java`)).toContain("BlockRenderLayerMap.INSTANCE.putBlock(StudioContentRegistry.BLOCK_STOOL, RenderType.cutout());")
  expect(Object.keys(compiled([base])).some((name) => name.includes(`client/`))).toBe(false)
})

test("a block that never turns and is walked into like a whole block has the least class there is", () => {
  const files = compiled([shaped({}, { facing: "none", collision: "full" })])
  const own = java(files, "block/ShapedBlock_stool.java")
  expect(own).toContain("public final class ShapedBlock_stool extends Block")
  ;["HorizontalDirectionalBlock", "FACING", "getStateForPlacement", "getShape", "getCollisionShape", "VoxelShape", "tryDropExperience"].forEach((word) => expect(own).not.toContain(word))
  expect(own).toContain("public static final MapCodec<ShapedBlock_stool> CODEC = simpleCodec(ShapedBlock_stool::new);")
  const hollow = java(compiled([shaped({}, { facing: "none", collision: "shape" })]), "block/ShapedBlock_stool.java")
  expect(hollow).toContain("private static final VoxelShape SHAPE_NORTH")
  expect(hollow).not.toContain("SHAPE_EAST")
  expect(hollow).toContain("return SHAPE_NORTH;")
})

test("a turned box's collision is the upright box around it, cut to the block; the way the block faces turns the boxes clockwise seen from above", () => {
  const shape = { ...stool(), elements: [{ name: "side", from: [10, 0, 2], to: [14, 8, 6], rotation: null, faces: { north: { uv: [0, 0, 4, 8], cull: false } } }] } as unknown as BlockShape
  const [box] = shapeBoxes(shape.elements)
  // A box in the north east corner: facing east it is in the south east, facing south the south west, facing west the north west.
  expect(facingBox(box!, "east")).toEqual({ min: [10, 0, 10], max: [14, 8, 14] })
  expect(facingBox(box!, "south")).toEqual({ min: [2, 0, 10], max: [6, 8, 14] })
  expect(facingBox(box!, "west")).toEqual({ min: [2, 0, 2], max: [6, 8, 6] })
  const files = compiled([shaped({}, { elements: shape.elements })])
  expect(java(files, "block/ShapedBlock_stool.java")).toContain("SHAPE_EAST = Shapes.box(10 / 16.0, 0 / 16.0, 10 / 16.0, 14 / 16.0, 8 / 16.0, 14 / 16.0);")
})

test.skipIf(!hasTargetJavac("fabric-1.21.1-official"))("every shape of class compiles against the game: turning or not, walked into or not, with experience and without", async () => {
  const blocks = [
    shaped({ identifier: "a_turning", drop: "none", experience: { min: 0, max: 2 } }),
    shaped({ identifier: "b_plain" }, { facing: "none", collision: "full" }),
    shaped({ identifier: "c_hollow" }, { facing: "none", collision: "shape" }),
    shaped({ identifier: "d_full_turning" }, { facing: "horizontal", collision: "full" }),
    { ...base, identifier: "e_whole", drop: "none", experience: { min: 1, max: 1 } },
  ].map((block) => ({ ...block, id: randomUUID() }))
  const files = compiled(blocks)
  const root = await temporary()
  await Promise.all(
    Object.entries(files)
      .filter(([name]) => name.endsWith(".java"))
      .map(async ([name, body]) => {
        await mkdir(path.dirname(path.join(root, name)), { recursive: true })
        await Bun.write(path.join(root, name), body)
      }),
  )
  const result = (await compileTreeFor("fabric-1.21.1-official", root))!
  expect(result.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(result.code).toBe(0)
  // The whole block that gives experience still uses the game's class.
  expect(java(files, "StudioContentRegistry.java")).toContain("new DropExperienceBlock(UniformInt.of(1, 1), BlockBehaviour.Properties")
}, 180000)

test("a shape beside what a cube can have: refused in words that say what to remove, and where the sheet or its name is wrong", () => {
  const generation = { dimension: "overworld", min_y: 0, max_y: 32, spread: "even", vein_size: 4, veins_per_chunk: 2, replaces: ["stone"], biomes: null }
  expect(refusal(shaped())).toBeNull()
  expect(refusal(shaped({ generation }))).toMatchObject({ message: "方块「凳子」有外形，不是整块，不能在世界里当矿石生成：去掉 generation，或者去掉 shape。", path: ["blocks", 0, "generation"] })
  expect(refusal(shaped({ variants: [png(5)] }))?.message).toContain("不能再写 variants")
  expect(refusal(shaped({ random_mirror: true }))?.message).toContain("random_mirror")
  expect(refusal(shaped({ random_turn: true }))?.message).toContain("random_turn")
  // The false and the empty are as good as absent.
  expect(refusal(shaped({ variants: [], random_mirror: false, random_turn: false, generation: null }))).toBeNull()
  // The sheet is named after the block, and another block may already have that name.
  expect(refusal(shaped(), [{ ...base, id: randomUUID(), identifier: "stool_sheet" }])?.message).toContain("「stool_sheet」，和模组里另一个方块的名字撞了")
  // A sheet that is a PNG by its header and not otherwise.
  const broken = (shaped().shape.sheet as string).slice(0, 60)
  expect(refusal(shaped({}, { sheet: broken }))?.message).toMatch(/PNG/)
  expect(refusal(shaped({}, { sheet: png(3, 24) }))?.message).toContain("16、32 或 64")
  const upside = refusal(shaped({}, { elements: [{ name: "x", from: [4, 4, 4], to: [2, 8, 8], rotation: null, faces: { north: { uv: [0, 0, 2, 4], cull: false } } }] }))
  expect(upside?.message).toBe("盒子「x」的 x 方向 to（2）要比 from（4）大。")
  expect(upside?.path).toEqual(["blocks", 0, "shape", "elements", 0, "to", 0])
})

test("the block document a person or an AI writes is held to the same: the shape beside generation or a list of pictures is a fault of the document", () => {
  const schema = getModuleSchema("block")
  const document = { ...withoutId(shaped()), kind: "block", texture: png(3) }
  expect(schema.safeParse(document).success).toBe(true)
  expect(schema.safeParse({ ...document, shape: null }).success).toBe(true)
  const clash = schema.safeParse({ ...document, variants: [png(5)] })
  expect(clash.success).toBe(false)
  expect(clash.error?.issues[0]).toMatchObject({ path: ["variants"], message: expect.stringContaining("不能再写 variants") })
  expect(schema.safeParse({ ...document, shape: { ...document.shape, facing: "diagonal" } }).success).toBe(false)
})

test("the guide, the questions a player asks and the machine's reconciliation all know a shaped block", async () => {
  const root = await temporary()
  const directory = path.join(root, "project")
  const created = await createProject({ directory, name: "家具", description: "几件家具。", mod_id: "shapes" })
  const content = ContentSchema.parse({ blocks: [shaped(), { ...base, id: randomUUID(), identifier: "plank", name: "木板" }] })
  const project = await saveProject(directory, applyContent(created, content), created.revision)
  const guide = modGuide(project, { findings: reconcile(project, { animations: {} }), animations: {}, glowing: [], built: false }).markdown
  // The line of the spec, in its place among the block's other words.
  expect(guide).toContain("方块「凳子」：不是整块，是由 2 个方盒子拼成的（放下时正面朝着你），硬度 1")
  expect(guide).not.toContain("方块「木板」：不是整块")
  // A block built into a wall is walked round and looked at; a shaped one is set down in four ways instead.
  expect(guide).toContain("方块（「木板」）：各砌一面八格见方的墙")
  expect(guide).toContain("方块「凳子」（不是整块，是由 2 个方盒子拼成的（放下时正面朝着你））：放在地上，绕着它走一圈")
  expect(guide).toContain("朝四个方向各放一个，正面是不是都朝着你")
  const facets = blockFacets(project.blocks.find((block) => block.identifier === "stool")!, project)
  expect(facets.find((facet) => facet.question === "use" && facet.words.includes("不是整块"))?.words).toBe("不是整块，是由 2 个方盒子拼成的（放下时正面朝着你），碰撞和选中框也是这些盒子；能放下来当摆设")
  expect(facets.some((facet) => facet.words.includes("盖房子"))).toBe(false)
  expect(blockFacets(project.blocks.find((block) => block.identifier === "plank")!, project).some((facet) => facet.words.includes("盖房子"))).toBe(true)
  // A project that got a shape beside generation some other way is stopped, at the rule's name.
  const wrong = { ...project, blocks: project.blocks.map((block) => (block.identifier === "stool" ? { ...block, random_turn: true } : block)) }
  const found = reconcile(wrong, { animations: {} }).filter((finding) => finding.rule === "shape_conflict")
  expect(found).toHaveLength(1)
  expect(found[0]).toMatchObject({ stops: true, about: { kind: "block", name: "凳子" } })
  expect(found[0]!.text).toContain("random_turn")
  expect(reconcile(project, { animations: {} }).some((finding) => finding.rule === "shape_conflict")).toBe(false)
})

test("a whole project with a shaped block builds: the client entrypoint is listed only then, and the tree compiles", async () => {
  const root = await temporary()
  const build = async (blocks: Record<string, unknown>[], name: string) => {
    const directory = path.join(root, name, "project")
    const created = await createProject({ directory, name: "家具", description: "几件家具。", mod_id: "shapes" })
    const project = await saveProject(directory, applyContent(created, ContentSchema.parse({ blocks })), created.revision)
    const source = path.join(root, name, "source")
    await mkdir(source, { recursive: true })
    await assembleBuildSource(directory, source, TEMPLATE)
    return { project, source, metadata: JSON.parse(await readFile(path.join(source, "src/main/resources/fabric.mod.json"), "utf8")) as { entrypoints: Record<string, string[]> } }
  }
  const plain = await build([{ ...base, id: randomUUID() }], "plain")
  expect(plain.metadata.entrypoints).toEqual({ main: ["com.minemods.content_shapes.StudioContent"] })
  const made = await build([shaped(), shaped({ identifier: "bench", name: "长凳" }, { facing: "none", collision: "full" }), { ...base, id: randomUUID() }], "shaped")
  expect(made.metadata.entrypoints).toEqual({ main: ["com.minemods.content_shapes.StudioContent"], client: [`com.minemods.content_shapes.client.${BLOCK_CLIENT_CLASS}`] })
  const client = await readFile(path.join(made.source, `src/main/java/com/minemods/content_shapes/client/${BLOCK_CLIENT_CLASS}.java`), "utf8")
  expect(client).toContain("putBlock(StudioContentRegistry.BLOCK_STOOL, RenderType.cutout());")
  expect(client).toContain("putBlock(StudioContentRegistry.BLOCK_BENCH, RenderType.cutout());")
  expect(client).not.toContain("BLOCK_ORE")
  expect((await readFile(path.join(made.source, "src/main/resources/assets/shapes/models/block/stool.json"), "utf8")).includes('"minecraft:block/block"')).toBe(true)
  if (hasTargetJavac("fabric-1.21.1-official")) {
    const result = (await compileTreeFor("fabric-1.21.1-official", made.source))!
    expect(result.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
    expect(result.code).toBe(0)
  }
}, 240000)

test("a block with a shape is judged on its sheet, whose empty pixels are the design; a whole block with holes is still refused", () => {
  const project = { workspace: { assets: [] } } as never
  const document = (extra: Record<string, unknown>) => ({ kind: "block" as const, ...withoutId(shaped()), texture: png(3), ...extra })
  const review = (extra: Record<string, unknown>) => reviewAsset(project, { id: randomUUID(), module: "block", document: document(extra) as never, dependencies: [] })
  const holes = (result: ReturnType<typeof review>) => result.findings.some((finding) => finding.rule === "block_has_holes")
  // The sheet has a quarter of it empty; the block's own picture is whole.
  expect(holes(review({}))).toBe(false)
  expect(review({}).unreadable).toBeFalsy()
  expect(holes(review({ shape: null, texture: sheet() }))).toBe(true)
  // A sheet that cannot be read is said so, not thrown.
  expect(review({ shape: { ...shaped().shape, sheet: "data:image/png;base64,AAAA" } })).toMatchObject({ unreadable: { message: expect.stringContaining("sheet") } })
})

test("a script that lays out boxes and draws their sheet makes a shape the schema takes; a script that makes one wrongly is told what is wrong", async () => {
  const script = `
    const boxes = [
      { name: "seat", from: [2, 10, 2], to: [14, 12, 14], faces: ["up", "north", "south", "east", "west"] },
      { name: "leg", from: [6, 0, 6], to: [10, 10, 10], faces: ["north", "south", "east", "west"] },
    ]
    const made = api.layout(boxes, { size: 32 })
    const sheet = api.canvas(32, 32, null)
    made.areas.forEach((area) => sheet.rect(area.x, area.y, area.width, area.height, area.element === "seat" ? "#a0763c" : "#6b4a22"))
    return { elements: made.elements, sheet, facing: "horizontal", collision: "shape" }`
  const ran = await runBlockDrawing(script)
  expect(ran).toMatchObject({ ok: true, summary: { kind: "shape", elements: 2, faces: 9, sheet: 32, facing: "horizontal", collision: "shape" } })
  const shape = (ran as { shape: BlockShape }).shape
  expect(shape.sheet).toMatch(/^data:image\/png;base64,/)
  expect(shape.elements.map((element) => element.name)).toEqual(["seat", "leg"])
  // What it made is what a document may hold, and builds.
  expect(compiled([shaped({}, { ...shape })])[`${assets}/models/block/stool.json`]).toBeDefined()
  // Its facing and its collision are the plainest when it says nothing.
  expect(await runBlockDrawing(script.replace(', facing: "horizontal", collision: "shape"', ""))).toMatchObject({ ok: true, shape: { facing: "none", collision: "full" } })
  // An item has no shape, and a block's picture is still a picture.
  expect(await runDrawing(script)).toMatchObject({ ok: false })
  expect(await runBlockDrawing(`return api.canvas(16, 16, "#777777")`)).toMatchObject({ ok: true, texture: expect.any(String) })
  // A face outside the sheet or a box with no size is said with the field it is in.
  const wrong = await runBlockDrawing(`const c = api.canvas(16, 16, null); return { elements: [{ name: "x", from: [0, 0, 0], to: [4, 4, 0], rotation: null, faces: { north: { uv: [0, 0, 4, 4], cull: false } } }], sheet: c }`)
  expect(wrong).toMatchObject({ ok: false })
  expect((wrong as { error: string }).error).toContain("elements.0.to.2：盒子「x」的 z 方向 to（0）要比 from（0）大")
  expect(await runBlockDrawing(`return { elements: [], sheet: 3 }`)).toMatchObject({ ok: false })
  expect(await runBlockDrawing(`return api.layout([{ name: "big", from: [0, 0, 0], to: [16, 16, 16], faces: ["up", "down", "north"] }])`)).toMatchObject({ ok: false })
})

test("what an AI is told: the block's instructions carry the shape and an example that is a shape, and the capability says what is and is not done", () => {
  expect(MODULES.block.instructions).toContain(BLOCK_SHAPE_INSTRUCTIONS)
  expect(MODULES.block.summary).toContain("shape")
  expect(BLOCK_SHAPE_INSTRUCTIONS).toContain(JSON.stringify(BLOCK_SHAPE_EXAMPLE.elements))
  const example = getModuleSchema("block").safeParse({ ...withoutId(shaped()), kind: "block", texture: null, shape: { ...BLOCK_SHAPE_EXAMPLE, sheet: sheet() } })
  expect(example.success).toBe(true)
  expect(DATA_CAPABILITY.done.some((line) => line.includes("几个方盒子拼成的静态外形") && line.includes("朝向玩家"))).toBe(true)
  expect(DATA_CAPABILITY.not_done.some((line) => line.includes("不会动") && line.includes("不能打开") && line.includes("没有半透明"))).toBe(true)
  // The two things the spec says a shape is not: animated, and something that opens.
  expect(JSON.stringify(DATA_CAPABILITY)).not.toContain("方块只能是立方体")
})

// The game's client classes in Mojang's names: the client jar of the official class path.
const CLIENT_JAR = hasTargetJavac("fabric-1.21.1-official") ? readFileSync(path.join(process.env.MINEMODS_TARGET_CLASSPATH!, "fabric-1.21.1-official.txt"), "utf8").split(/\r?\n/).find((jar) => /minecraft-clientOnly-/.test(path.basename(jar))) : undefined

test.skipIf(!hasTargetJavap("fabric-1.21.1-official") || !CLIENT_JAR)("the corners of each face are the game's own: read from the bytecode of its FaceInfo, not remembered", () => {
  const read = Bun.spawnSync([targetJdkTool("fabric-1.21.1-official", "javap"), "-p", "-c", "-cp", CLIENT_JAR!, "net.minecraft.client.renderer.FaceInfo"])
  expect(read.exitCode).toBe(0)
  const printed = read.stdout.toString().replaceAll("\r\n", "\n")
  const code = printed.slice(printed.indexOf("static {}"))
  // Each face is its name, then four corners of three direction ids (x, y, z), in order.
  const sides: Record<string, number[][]> = {}
  let current = ""
  const axis = { MIN_X: [0, 0], MAX_X: [0, 1], MIN_Y: [1, 0], MAX_Y: [1, 1], MIN_Z: [2, 0], MAX_Z: [2, 1] } as const
  let corner: number[] = []
  for (const line of code.split("\n")) {
    const name = /String (DOWN|UP|NORTH|SOUTH|WEST|EAST)$/.exec(line.trim())
    if (name) {
      current = name[1]!.toLowerCase()
      sides[current] = []
      corner = []
      continue
    }
    const id = /FaceInfo\$Constants\.([A-Z_]+):I/.exec(line)
    if (id && current && id[1]! in axis) {
      const [which, high] = axis[id[1] as keyof typeof axis]
      corner[which] = high
      if (corner.filter((value) => value !== undefined).length === 3) {
        sides[current]!.push(corner)
        corner = []
      }
    }
  }
  SHAPE_FACES.forEach((face) => expect({ face, corners: FACE_CORNERS[face].map((corner) => Array.from(corner as readonly number[])) }).toEqual({ face, corners: sides[face] }))
})
