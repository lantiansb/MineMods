import { afterEach, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BlockSchema, compileContent } from "../src/content"
import { blockFacets } from "../src/content-facets"
import { BLOCK_MOVEMENT_INSTRUCTIONS, BOUNCE_LIMITS, CONNECTION_CAPABILITY, LAUNCH_LIMITS, contentWords } from "../src/content-words"
import { launchSpeed } from "../src/fabric/block-bounce"
import { createProject } from "../src/project"
import { getModuleSchema } from "../src/workspace"
import { MODULES } from "../src/workspace-modules"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const base = { identifier: "jelly", name: "果冻", hardness: 0.5, luminance: 0, tool: "none", drop: "self", color: "#d94f8a" }
const block = (extra: Record<string, unknown> = {}, identifier = "jelly") => ({ ...base, id: randomUUID(), identifier, ...extra })
const REGISTRY = "src/main/java/a/b/StudioContentRegistry.java"
const compiled = (blocks: Record<string, unknown>[]) => compileContent({ mod_id: "m", package_name: "a.b", blocks, items: [], recipes: [], logic: [] })
const registry = (blocks: Record<string, unknown>[]) => String(compiled(blocks)[REGISTRY])
const accepts = (launch: unknown) => BlockSchema.safeParse(block({ launch })).success

/** The game's own arithmetic for a living thing, written out again here: how high it rises from an upward speed set inside the move. */
const risesFrom = (speed: number, setBeforeMove: boolean) => {
  let velocity = speed
  let height = 0
  if (!setBeforeMove) velocity = (velocity - 0.08) * 0.98
  while (velocity > 0) {
    height += velocity
    velocity = (velocity - 0.08) * 0.98
  }
  return height
}

test("a launch is a height in blocks from one jump to ten, or left out; anything else is refused", () => {
  expect(LAUNCH_LIMITS).toEqual({ min: 1.25, max: 10 })
  expect([1.25, 2, 4, 10, null, undefined].map(accepts)).toEqual([true, true, true, true, true, true])
  expect([0, 1, 1.24, 10.01, -3, Number.NaN, Number.POSITIVE_INFINITY, "4", true].map(accepts)).toEqual([false, false, false, false, false, false, false, false, false])
  const document = { kind: "block", identifier: "jelly", name: "果冻", hardness: 0.5, luminance: 0, tool: "none", drop: "self", color: "#d94f8a", texture: null }
  const schema = getModuleSchema("block")
  expect(schema.safeParse({ ...document, launch: 4 }).success).toBe(true)
  expect(schema.safeParse({ ...document, launch: 12 }).success).toBe(false)
  expect(schema.safeParse({ ...document, launch: 0.5 }).success).toBe(false)
})

test("the speed that gives a height is the game's own arithmetic: a jump's 0.42 reaches 1.25 blocks, and the speed for a height reaches it", () => {
  expect(risesFrom(0.42, true)).toBeCloseTo(LAUNCH_LIMITS.min, 1)
  for (const height of [1.25, 2, 4, 7.5, 10]) expect(risesFrom(launchSpeed(height), false)).toBeCloseTo(height, 2)
  // Higher is faster, and the speeds are what the Java carries.
  expect(launchSpeed(2)).toBeLessThan(launchSpeed(4))
  expect(launchSpeed(4)).toBe(0.8996)
})

test("a launch is written to throw up a living thing that is not sneaking, once, and not to hurt it when it lands again", () => {
  const written = registry([block({ launch: 4 })])
  expect(written).toContain("public void stepOn(Level world, BlockPos pos, BlockState state, Entity entity) {")
  // Sneaking is left alone, and so is what is not a living thing.
  expect(written).toContain("if (entity.isSteppingCarefully() || !(entity instanceof LivingEntity)) {\n                return;")
  // The speed is set, not added to, and only when the thing is not rising faster already: standing on it never piles up.
  expect(written).toContain("if (velocity.y < 0.8996) {\n                entity.setDeltaMovement(velocity.x, 0.8996, velocity.z);")
  expect(written).not.toContain("addVelocity")
  // Landing on it takes no fall damage, as the slime block does; sneaking lands as on any block.
  expect(written).toContain("if (entity.isSuppressingBounce()) {\n                super.fallOn(world, state, pos, entity, fallDistance);")
  expect(written).toContain("entity.causeFallDamage(fallDistance, 0f, world.damageSources().fall());")
  // A launch alone does not turn a fall round.
  expect(written).not.toContain("updateEntityAfterFallOn")
  expect(written).toContain('ResourceLocation.fromNamespaceAndPath(MOD_ID, "jelly"), new Block(BlockBehaviour.Properties.of().strength(0.5f).lightLevel(state -> 0)) {')
})

test("a launch and a bounce work together in one block: one landing method, the launch takes the fall damage and the higher of the two wins", () => {
  const written = registry([block({ launch: 4, bounce: 0.3 })])
  expect(written.match(/public void fallOn/g)).toHaveLength(1)
  expect(written.match(/public void stepOn/g)).toHaveLength(1)
  expect(written.match(/public void updateEntityAfterFallOn/g)).toHaveLength(1)
  expect(written).toContain("entity.causeFallDamage(fallDistance, 0f, world.damageSources().fall());")
  expect(written).not.toContain("0.7f")
  expect(written).toContain("-velocity.y * 0.3 *")
  // A bounce alone is what it was.
  const alone = registry([block({ bounce: 0.3 })])
  expect(alone).toContain("entity.causeFallDamage(fallDistance, 0.7f, world.damageSources().fall());")
  expect(alone).not.toContain("stepOn")
})

test("a block with no launch is the block it always was, to the byte; another block that launches costs it nothing", () => {
  const plain = compiled([block()])
  for (const launch of [null, undefined]) expect([launch, compiled([block({ launch })])]).toEqual([launch, plain])
  const written = String(plain[REGISTRY])
  for (const word of ["stepOn", "isSteppingCarefully", "setDeltaMovement"]) expect(written).not.toContain(word)
  const mixed = registry([block({ launch: 3 }), block({}, "stone")])
  expect(mixed.match(/public void stepOn/g)).toHaveLength(1)
  expect(mixed).toContain('ResourceLocation.fromNamespaceAndPath(MOD_ID, "stone"), new Block(BlockBehaviour.Properties.of().strength(0.5f).lightLevel(state -> 0)));')
  const launching = compiled([block({ launch: 3 })])
  expect(Object.keys(launching).sort()).toEqual(Object.keys(plain).sort())
})

test("what the block does is said in words, and the AI is told what the field is for and how it differs from a bounce", () => {
  expect(contentWords.standing({ launch: 4 })).toBe("踩上去就会被弹起约 4 格高（原版跳一下约 1.25 格；潜行时不弹）")
  expect(contentWords.standing({ launch: 2.5, bounce: 1 })).toBe("落上去会弹起来（弹回落下速度的 100%，原版黏液块 100%；潜行时不弹），踩上去就会被弹起约 2.5 格高（原版跳一下约 1.25 格；潜行时不弹）")
  for (const none of [{}, { launch: 0 }, { launch: null }]) expect(contentWords.standing(none)).toBe("")
  expect(MODULES.block.instructions).toContain(BLOCK_MOVEMENT_INSTRUCTIONS)
  expect(BLOCK_MOVEMENT_INSTRUCTIONS).toContain(`launch（${LAUNCH_LIMITS.min}–${LAUNCH_LIMITS.max}，单位是格`)
  expect(BLOCK_MOVEMENT_INSTRUCTIONS).toContain("踩上去就被弹起来")
  expect(BLOCK_MOVEMENT_INSTRUCTIONS).toContain("潜行时不弹")
  expect(BLOCK_MOVEMENT_INSTRUCTIONS).toContain(`bounce（${BOUNCE_LIMITS.min}–${BOUNCE_LIMITS.max}`)
  expect(MODULES.block.summary).toContain("launch")
  expect(CONNECTION_CAPABILITY.done.join("")).toContain("launch")
})

test("a block that launches says so among what it is for", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-launch-"))
  roots.push(root)
  const project = await createProject({ directory: path.join(root, "p"), name: "果冻", description: "果冻。", mod_id: "jelly_mod" })
  const words = (document: Record<string, unknown>) => blockFacets({ kind: "block", ...base, texture: null, ...document } as never, project).flatMap((facet) => (facet.question === "use" ? [facet.words] : []))
  expect(words({ launch: 4 })).toContain("踩上去就会被弹起约 4 格高（原版跳一下约 1.25 格；潜行时不弹）")
  expect(words({}).join("")).not.toContain("弹")
})

test.skipIf(!hasTargetJavac("fabric-1.21.1-official"))("every kind of launching block compiles against the game: alone, with a bounce, with experience, with movement, shaped", async () => {
  const files = compiled([
    block({ launch: 1.25 }, "a_alone"),
    block({ launch: 10, bounce: 1 }, "b_both"),
    block({ launch: 4, drop: "none", experience: { min: 0, max: 2 } }, "c_experience"),
    block({ launch: 2.5, movement: { speed: 0.4, jump: 0.5, slip: 0.989 }, sound: "slime" }, "d_moving"),
    block({}, "e_plain"),
  ])
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-launch-"))
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
