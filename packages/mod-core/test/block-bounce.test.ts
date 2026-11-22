import { afterEach, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BlockSchema, compileContent } from "../src/content"
import { blockFacets } from "../src/content-facets"
import { BLOCK_MOVEMENT_INSTRUCTIONS, BLOCK_SHAPE_EXAMPLE, BOUNCE_LIMITS, contentWords } from "../src/content-words"
import { encodePng } from "../src/png"
import { createProject } from "../src/project"
import { getModuleSchema } from "../src/workspace"
import { MODULES } from "../src/workspace-modules"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

// A sheet from arithmetic, as a shaped block needs: a square picture with the lower right quarter empty (a cut-out).
const dataUrl = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`
const png = (seed: number, side = 16) => dataUrl(encodePng(Uint8Array.from({ length: side * side * 4 }, (_, index) => (index % 4 === 3 ? 255 : (index * seed) % 200)), side, side))
const sheet = (side = 32) => dataUrl(encodePng(Uint8Array.from({ length: side * side * 4 }, (_, index) => ((pixel) => (index % 4 === 3 ? ((pixel % side) >= side / 2 && Math.floor(pixel / side) >= side / 2 ? 0 : 255) : (index * 7) % 200))(Math.floor(index / 4))), side, side))
const stool = (extra: Record<string, unknown> = {}) => ({ ...BLOCK_SHAPE_EXAMPLE, elements: structuredClone(BLOCK_SHAPE_EXAMPLE.elements), sheet: sheet(), ...extra })

const base = { identifier: "jelly", name: "果冻", hardness: 0.5, luminance: 0, tool: "none", drop: "self", color: "#d94f8a" }
const block = (extra: Record<string, unknown> = {}, identifier = "jelly") => ({ ...base, id: randomUUID(), identifier, ...extra })
const REGISTRY = "src/main/java/a/b/StudioContentRegistry.java"
const compiled = (blocks: Record<string, unknown>[]) => compileContent({ mod_id: "m", package_name: "a.b", blocks, items: [], recipes: [], logic: [] })
const registry = (blocks: Record<string, unknown>[]) => String(compiled(blocks)[REGISTRY])
const accepts = (bounce: unknown) => BlockSchema.safeParse(block({ bounce })).success

test("a bounce is a number from 0 to 1, or left out; anything else is refused", () => {
  expect(BOUNCE_LIMITS).toEqual({ min: 0, max: 1 })
  expect([0, 0.3, 1, null, undefined].map(accepts)).toEqual([true, true, true, true, true])
  expect([-0.01, 1.01, 2, Number.NaN, Number.POSITIVE_INFINITY, "1", true].map(accepts)).toEqual([false, false, false, false, false, false, false])
  expect(BlockSchema.safeParse(block()).success).toBe(true)
  // The document an AI writes is held to the same range.
  const document = { kind: "block", identifier: "jelly", name: "果冻", hardness: 0.5, luminance: 0, tool: "none", drop: "self", color: "#d94f8a", texture: null }
  const schema = getModuleSchema("block")
  expect(schema.safeParse({ ...document, bounce: 0.8 }).success).toBe(true)
  expect(schema.safeParse({ ...document, bounce: 1.5 }).success).toBe(false)
  expect(schema.safeParse({ ...document, bounce: -1 }).success).toBe(false)
})

test("a bounce is written as the slime block does it: sneaking lands as on any block, otherwise the fall is turned round", () => {
  const written = registry([block({ bounce: 1 })])
  // The game's own names, read off the 1.21.1 jar.
  expect(written).toContain("public void fallOn(Level world, BlockState state, BlockPos pos, Entity entity, float fallDistance) {")
  expect(written).toContain("public void updateEntityAfterFallOn(BlockGetter world, Entity entity) {")
  // Sneaking: the block does what any block does.
  expect(written).toContain("if (entity.isSuppressingBounce()) {\n                super.fallOn(world, state, pos, entity, fallDistance);")
  expect(written).toContain("if (entity.isSuppressingBounce()) {\n                super.updateEntityAfterFallOn(world, entity);\n                return;")
  // Bounce 1 takes no fall damage at all, as the slime block does.
  expect(written).toContain("entity.causeFallDamage(fallDistance, 0f, world.damageSources().fall());")
  // Only a downward speed is turned round, at the speed it came down; what is not a living thing keeps 0.8 of it.
  expect(written).toContain("if (velocity.y < 0.0) {")
  expect(written).toContain("entity.setDeltaMovement(velocity.x, -velocity.y * 1.0 * (entity instanceof LivingEntity ? 1.0 : 0.8), velocity.z);")
  // It stays a plain block of the game, registered with its settings, with the two methods added.
  expect(written).toContain('ResourceLocation.fromNamespaceAndPath(MOD_ID, "jelly"), new Block(BlockBehaviour.Properties.of().strength(0.5f).lightLevel(state -> 0)) {')
})

test("half a bounce gives back half the speed and takes the other half of the fall damage", () => {
  const written = registry([block({ bounce: 0.3 })])
  expect(written).toContain("entity.setDeltaMovement(velocity.x, -velocity.y * 0.3 * (entity instanceof LivingEntity ? 1.0 : 0.8), velocity.z);")
  expect(written).toContain("entity.causeFallDamage(fallDistance, 0.7f, world.damageSources().fall());")
  // Beside the other things the block does when it is stood on, and a block that gives experience keeps the game's class for it.
  const both = registry([block({ bounce: 0.5, movement: { speed: 0.4, jump: 1, slip: 0.6 }, drop: "none", experience: { min: 1, max: 2 } })])
  expect(both).toContain("new DropExperienceBlock(UniformInt.of(1, 2), BlockBehaviour.Properties.of().strength(0.5f).lightLevel(state -> 0).speedFactor(0.4f)) {")
})

test("a block with no bounce, a bounce of 0 or one too small to feel is the block it always was, to the byte, with no extra code", () => {
  const plain = compiled([block()])
  for (const bounce of [0, null, undefined, 0.0004]) expect([bounce, compiled([block({ bounce })])]).toEqual([bounce, plain])
  const written = String(plain[REGISTRY])
  for (const word of ["fallOn", "updateEntityAfterFallOn", "isSuppressingBounce", "causeFallDamage", "Vec3", "LivingEntity"]) expect(written).not.toContain(word)
  // Another block that bounces costs this one nothing.
  const mixed = registry([block({ bounce: 1 }), block({}, "stone")])
  expect(mixed.match(/public void fallOn/g)).toHaveLength(1)
  expect(mixed).toContain('ResourceLocation.fromNamespaceAndPath(MOD_ID, "stone"), new Block(BlockBehaviour.Properties.of().strength(0.5f).lightLevel(state -> 0)));')
  // A bounce changes the Java and nothing else the block makes.
  const bouncy = compiled([block({ bounce: 1 })])
  expect(Object.keys(bouncy).sort()).toEqual(Object.keys(plain).sort())
  Object.keys(plain).filter((file) => file !== REGISTRY).forEach((file) => expect([file, bouncy[file]]).toEqual([file, plain[file]]))
})

test("a block with a shape carries its bounce in its own class, and its imports are listed once", () => {
  const shaped = block({ identifier: "stool", bounce: 0.6, drop: "none", experience: { min: 1, max: 2 }, texture: png(3), shape: stool({ collision: "shape" }) })
  const files = compiled([shaped])
  const own = String(files["src/main/java/a/b/block/ShapedBlock_stool.java"])
  expect(own).toContain("public void fallOn(Level world, BlockState state, BlockPos pos, Entity entity, float fallDistance) {")
  expect(own).toContain("causeFallDamage(fallDistance, 0.4f,")
  expect(own).toContain("-velocity.y * 0.6 *")
  const imports = own.split("\n").filter((line) => line.startsWith("import "))
  expect(new Set(imports).size).toBe(imports.length)
  // The registry does not repeat it on the block it makes from that class.
  expect(String(files[REGISTRY])).not.toContain("fallOn")
})

test("what the block does is said in words, and the AI is told what the field is for", () => {
  expect(contentWords.standing({ bounce: 1 })).toBe("落上去会弹起来（弹回落下速度的 100%，原版黏液块 100%；潜行时不弹）")
  expect(contentWords.standing({ bounce: 0.5, movement: { speed: 0.4, jump: 1, slip: 0.6 } })).toBe("踩上去会变慢（速度变成原来的 40%），落上去会弹起来（弹回落下速度的 50%，原版黏液块 100%；潜行时不弹）")
  for (const none of [{}, { bounce: 0 }, { bounce: null }]) expect(contentWords.standing(none)).toBe("")
  const instructions = MODULES.block.instructions
  expect(instructions).toContain(BLOCK_MOVEMENT_INSTRUCTIONS)
  expect(BLOCK_MOVEMENT_INSTRUCTIONS).toContain("bounce（0–1")
  expect(BLOCK_MOVEMENT_INSTRUCTIONS).toContain("落上去会弹起来")
  expect(BLOCK_MOVEMENT_INSTRUCTIONS).toContain("1 就是原版黏液块")
  expect(BLOCK_MOVEMENT_INSTRUCTIONS).toContain("潜行时不弹")
})

test("a block that bounces says so among what it is for", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-bounce-"))
  roots.push(root)
  const project = await createProject({ directory: path.join(root, "p"), name: "果冻", description: "果冻。", mod_id: "jelly_mod" })
  const words = (document: Record<string, unknown>) => blockFacets({ kind: "block", ...base, texture: null, ...document } as never, project).flatMap((facet) => (facet.question === "use" ? [facet.words] : []))
  expect(words({ bounce: 1 })).toContain("落上去会弹起来（弹回落下速度的 100%，原版黏液块 100%；潜行时不弹）")
  expect(words({}).join("")).not.toContain("弹")
})

test.skipIf(!hasTargetJavac("fabric-1.21.1-official"))("every kind of bouncing block compiles against the game: a whole one, one that gives experience, one with a shape, with movement beside it", async () => {
  const shape = stool()
  const files = compiled([
    block({ bounce: 1 }, "a_whole"),
    block({ bounce: 0.25, drop: "none", experience: { min: 0, max: 2 } }, "b_experience"),
    block({ bounce: 0.5, movement: { speed: 0.4, jump: 0.5, slip: 0.989 }, sound: "slime" }, "c_moving"),
    block({ bounce: 0.75, texture: png(3), shape: { ...shape, facing: "horizontal", collision: "shape" } }, "d_turning"),
    block({ bounce: 0.9, drop: "none", experience: { min: 1, max: 1 }, texture: png(3), shape: { ...shape, facing: "none", collision: "full" } }, "e_shaped_experience"),
    block({}, "f_plain"),
  ])
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-bounce-"))
  roots.push(root)
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
}, 240000)
