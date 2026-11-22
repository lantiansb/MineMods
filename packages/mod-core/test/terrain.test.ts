import { gameplayUsesTerrain } from "../src/common/terrain"
import { test, expect } from "bun:test"
import { createHash } from "node:crypto"
import { compileAbilities } from "../src/fabric/entity-abilities"
import { scorchAbility, rayAbility } from "../script/target-groundfx-sample"
import { genTarget } from "../src/platform/target"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { AbilitySchema } from "../src/entity-runtime"
import { compileGroundFx } from "../src/common/ground-fx"
import { groundFxPictures } from "../src/ground-fx-picture"
import {
  terrainAbility,
  terrainEvents,
  createTargetTerrainSample,
  createTargetTerrainGameplaySample,
} from "../script/target-terrain-sample"
import { fightingGolemDesign } from "../script/data-gameplay-sample"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { terrainLines, TerrainRiseEventSchema, TERRAIN_INSTRUCTIONS } from "../src/terrain"
import { ABILITY_INSTRUCTIONS, abilityWords } from "../src/creature-abilities"
import { assembleBuildSource } from "../src/build-source"
import { hasTargetJavac, targetJavac } from "./target-javac"

test("临时地形：字段、中文边界拒绝、落点和蓄力检查", () => {
  expect(AbilitySchema.safeParse(terrainAbility).success).toBe(true)
  for (const bad of [
    { ...terrainEvents[1], height: 13 },
    { ...terrainEvents[1], blocks: { beam: "yes" } },
    { ...terrainEvents[1], restore_on_exit: 1 },
    { ...terrainEvents[1], material: 42 },
    { ...terrainEvents[4], restore_after: 121 },
    { ...terrainEvents[4], block: "minecraft:chest" },
    { ...terrainEvents[1], where: "hit", hit: 10 },
    { ...terrainEvents[1], at: 0 },
    { ...terrainEvents[0], pop_blocks: { height: 2, every: 0, max: 200 } },
  ]) {
    const parsed = AbilitySchema.safeParse({ ...terrainAbility, events: [bad] })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues.some((e) => /[\u4e00-\u9fff]/.test(e.message))).toBe(true)
  }
})
test("看图按实际分节宽度画石刺，并使用工程方块颜色", () => {
  const spike = TerrainRiseEventSchema.parse({...terrainEvents[1], shape:"spike",width:1,height:4,material:"veined_slate"})
  const lines = terrainLines(spike,{forward:0,left:0},() => "#B45B38")
  expect(lines).toHaveLength(8*6)
  expect(lines.every(line => line.color === "#B45B38")).toBe(true)
  expect(lines[0]!.points[0]![0]).toBe(8)
  expect(lines.at(-6)!.points[0]![0]).toBe(1)
  expect(terrainLines({...spike,taper:0},{forward:0,left:0})).toHaveLength(6)
})

test("临时地形：中文说明和看招式的图", () => {
  expect(ABILITY_INSTRUCTIONS).toContain(TERRAIN_INSTRUCTIONS)
  expect(abilityWords.events(terrainAbility)).toContain("能顶起")
  expect(abilityWords.events(terrainAbility)).toContain("只显示")
  const pictures = groundFxPictures(terrainAbility, fightingGolemDesign as unknown as ModelDesign)
  expect(pictures).toHaveLength(5)
  expect(pictures.every((p) => p.lines.length > 0)).toBe(true)
  expect(pictures[1]!.lines.flatMap((l) => l.points).some((p) => p[1] === 64)).toBe(true)
})
test("老工程不生成临时地形代码", () => {
  const old = compileGroundFx({ modId: "old", packageName: "com.test.old" })
  const explicit = compileGroundFx({ modId: "old", packageName: "com.test.old", terrain: false })
  expect(old.files).toEqual(explicit.files)
  expect(Object.keys(old.files).join()).not.toContain("Terrain")
  expect(
    Object.values(old.files)
      .filter((v) => typeof v === "string")
      .join(),
  ).not.toContain("StudioTerrain")
})
for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const)
  test(`${target} 全部临时地形字段三端真实 javac`, async () => {
    const cp = target === "fabric-1.21.1" ? "fabric-1.21.1-official" : target
    const root = await mkdtemp(path.join(os.tmpdir(), "terrain-javac-"))
    try {
      await createTargetTerrainSample(path.join(root, "project"), target, true)
      await mkdir(path.join(root, "source"))
      await assembleBuildSource(
        path.join(root, "project"),
        path.join(root, "source"),
        fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url)),
      )
      // Compiled where a class path of the target and its JDK are at hand, like every other javac test here; without them the tree is still assembled above.
      if (!hasTargetJavac(cp)) return
      const compiled = await targetJavac(cp, path.join(root, "source/src/main/java"))
      if (compiled.code) console.log(compiled.output)
      expect(compiled.code).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 240000)

// Digests of the generators on the main line just before the five branches were merged (b8fd1af, 2026-11-17), where none of them existed.
// The terrain branch had pinned what 313c5e5 gave; the main line has since changed that output itself (431a92d: the hurt time a ground effect gives back;
// 38cd652: `pace` left out when there is no rage), so those digests no longer describe an old project. Merged, all nine equal the main line's.
test("未写新字段的旧工程与合并前的主线（b8fd1af）逐字节一致", () => {
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex")
  expect(
    hash(
      compileGroundFx({ modId: "legacy_earth", packageName: "com.test.legacy", own: false }, genTarget("fabric-1.21.1"))
        .files,
    ),
  ).toBe("94103e5e236426e4d9e5aed5e71f4a2cdb75237c3335bdcdef4f4600e0bbc7fb")
  expect(
    hash(
      compileGroundFx({ modId: "legacy_earth", packageName: "com.test.legacy", own: true }, genTarget("fabric-1.21.1"))
        .files,
    ),
  ).toBe("506c077be7389d02b68ac3796e3dbdd2ec6fb70186dc10a5dbc5f525fcc6ef12")
  expect(
    hash(
      compileGroundFx({ modId: "legacy_earth", packageName: "com.test.legacy", own: false }, genTarget("forge-1.20.1"))
        .files,
    ),
  ).toBe("a144bc4005f7b0a12c3a4386ab7f945f4063a4a838a02eb2db165f91a36ae297")
  expect(
    hash(
      compileGroundFx({ modId: "legacy_earth", packageName: "com.test.legacy", own: true }, genTarget("forge-1.20.1"))
        .files,
    ),
  ).toBe("ac83c4435c3d4f86cded34c9cb603ead6dc47e5c074b6e37cf9c79a13426614a")
  expect(
    hash(
      compileGroundFx(
        { modId: "legacy_earth", packageName: "com.test.legacy", own: false },
        genTarget("neoforge-1.21.1"),
      ).files,
    ),
  ).toBe("845947d3b91f9f9bd478c11b61f3d135b22ba29266ec58044775e104b5531339")
  expect(
    hash(
      compileGroundFx(
        { modId: "legacy_earth", packageName: "com.test.legacy", own: true },
        genTarget("neoforge-1.21.1"),
      ).files,
    ),
  ).toBe("287bbcb1196a6e312b26f88f914215663134e628ecf57d3ba52ff0cfa64c514f")
  expect(
    hash(
      compileAbilities({
        entity: "OldCreature",
        model: "old_model",
        abilities: [scorchAbility],
        hostile: true,
        runtime: false,
        death: false,
      }),
    ),
  ).toBe("1b1e52957d620189615147f311b19fc821344b56c38f8032583d84c6abd6c7db")
  expect(
    hash(
      compileAbilities({
        entity: "OldCreature",
        model: "old_model",
        abilities: [rayAbility],
        hostile: true,
        runtime: false,
        death: false,
      }),
    ),
  ).toBe("3aed22039f0164ad90c0fef91b03cba28e338321eb19b70ac9d32c8726675461")
  expect(
    hash(
      compileAbilities({
        entity: "OldCreature",
        model: "old_model",
        abilities: [scorchAbility, rayAbility],
        hostile: true,
        runtime: false,
        death: false,
      }),
    ),
  ).toBe("c6714ab6c5ebf399e426bd96f39f5b8ffeee3639d48fd1ab65c9e36cae107ab4")
})

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const)
  test(`${target} 玩家物品单独使用三种地形，不依赖生物招式`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "terrain-item-javac-"))
    try {
      const project = await createTargetTerrainGameplaySample(path.join(root, "project"), target, true)
      expect(project.entities.every((e) => !e.abilities?.length)).toBe(true)
      await mkdir(path.join(root, "source"))
      const built = await assembleBuildSource(
        path.join(root, "project"),
        path.join(root, "source"),
        fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url)),
      )
      expect(built.groundFxFiles.some((f) => f.endsWith("/StudioTerrain.class"))).toBe(true)
      if (!hasTargetJavac(target === "fabric-1.21.1" ? "fabric-1.21.1-official" : target)) return
      const compiled = await targetJavac(
        target === "fabric-1.21.1" ? "fabric-1.21.1-official" : target,
        path.join(root, "source/src/main/java"),
      )
      if (compiled.code) console.log(compiled.output)
      expect(compiled.code).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 240000)

test("玩家地形依赖只看真实的公共接口调用，旧注释、字符串和自己的同名方法不会增加生成代码", () => {
  const use = (content: string) => gameplayUsesTerrain([{ sources: [{ content }] }])
  expect(use("ProjectContent.terrainRise(world,at,0);")).toBe(true)
  expect(use("import static com.example.ProjectContent.blockSwap;")).toBe(true)
  expect(
    use('// ProjectContent.terrainRise(world,at,0);\nString text="ProjectContent.popBlocks("; void terrainRise() {}'),
  ).toBe(false)
})

test("a negative forward on temporary terrain is written as a number, not as Java's -- operator", async () => {
  const { terrainStatement } = await import("../src/common/terrain")
  const base = { type: "terrain_rise", at: 0, where: "self", hit: null, forward: -3, left: -6, shape: "spike", width: 1, height: 3, rise_seconds: 0.2, stay_seconds: 2, lifts: false } as never
  const back = terrainStatement(base, "origin", "1.0f")
  expect(back).not.toContain("--")
  expect(back).toContain("origin.add(3.0000 * Mth.sin(")
  expect(back).toContain("+ -6.0000 * Mth.cos(")
  const ahead = terrainStatement({ ...(base as object), forward: 2 } as never, "origin", "1.0f")
  expect(ahead).toContain("origin.add(-2.0000 * Mth.sin(")
  const zero = terrainStatement({ ...(base as object), forward: 0 } as never, "origin", "1.0f")
  expect(zero).toContain("origin.add(-0.0000 * Mth.sin(")
})
