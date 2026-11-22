import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { bossLookPlan, phaseLookWords } from "../src/boss-look-words"
import { bossLookIssues, bossTextureFile } from "../src/boss-look"
import { assembleBuildSource } from "../src/build-source"
import { BOSS_INSTRUCTIONS, bossWords } from "../src/creature-boss"
import { BossSchema, type Boss } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { genTarget } from "../src/platform/target"
import type { TargetId } from "../src/target/ids"
import { changingBoss, createTargetBossLookSample, crownedGolemDesign, LOOK_TEXTURE_IDS } from "../script/target-boss-look-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * Boss 能力 10, a phase's texture (阶段换贴图): a phase puts on a whole texture of the project in place of the model's own (a cracked, a burning variant), at once as it
 * begins, until a later phase's texture; `"model"` puts the model's own back on. The definition, the plan, the words, what is said against the model, the files the build
 * writes and the Java on all three targets. A boss that swaps no texture is generated exactly as before.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const design = crownedGolemDesign as unknown as ModelDesign
const [CRACKED, BURNING] = LOOK_TEXTURE_IDS
const boss = BossSchema.parse(changingBoss)
const swapping = (textures: readonly (string | undefined)[]): Boss =>
  BossSchema.parse({ ...changingBoss, phases: changingBoss.phases.map((phase, index) => ((texture) => ({ ...phase, model: { ...phase.model, ...(texture === undefined ? {} : { texture: texture === "model" ? "model" : { asset: texture } }) } }))(textures[index])) })

test("a phase's texture is a texture asset or the model's own; the plan says which each stage wears, a stage that names none keeps the one before", () => {
  const parse = (texture: unknown) => BossSchema.safeParse({ ...changingBoss, phases: [{ ...changingBoss.phases[0], model: { texture } }] }).success
  expect([parse({ asset: CRACKED }), parse("model"), parse("emissive"), parse({ asset: "not an id" }), parse({ asset: CRACKED, seconds: 1 })]).toEqual([true, true, false, false, false])
  // Cracked at 66%, burning at 33%: the model's own before, then each in turn.
  const both = bossLookPlan(swapping([CRACKED, BURNING]))!
  expect(both.textures).toEqual([CRACKED, BURNING])
  expect(both.texture).toEqual([0, 1, 2])
  // Cracked at 66%, nothing said at 33% (kept), back to the model's own at a third phase; the same asset twice is listed once.
  const three = BossSchema.parse({ ...changingBoss, phases: [...swapping([CRACKED, undefined]).phases, { ...changingBoss.phases[1], below: 0.1, model: { texture: "model" } }] })
  expect(bossLookPlan(three)!.texture).toEqual([0, 1, 1, 0])
  expect(bossLookPlan(swapping([CRACKED, CRACKED]))!.textures).toEqual([CRACKED])
  // A phase whose only change is its texture still makes a plan; one without any texture lists none (and writes none of it).
  expect(bossLookPlan({ phases: [{ ...boss.phases[0]!, model: { texture: { asset: CRACKED } } }] })!.texture).toEqual([0, 1])
  expect(bossLookPlan(boss)!.textures).toEqual([])
  expect(bossLookPlan(boss)!.texture).toEqual([0, 0, 0])
})

test("the words: what the card says of a phase, and what the maker AI is told", () => {
  expect(phaseLookWords({ texture: { asset: CRACKED } })).toBe("，模型变成：整身换上另一张贴图")
  expect(phaseLookWords({ texture: "model" })).toBe("，模型变成：换回模型自己的贴图")
  expect(bossWords.phase(swapping([CRACKED, BURNING]).phases[1]!, [])).toContain("显出「crown」、整身换上另一张贴图、一张发光贴图在 2 秒里从 0% 亮到 100%")
  // Words of a phase without a texture are what they were.
  expect(bossWords.phase(boss.phases[1]!, [])).toContain("模型变成：藏起「head」、显出「crown」、一张发光贴图在 2 秒里从 0% 亮到 100%")
  for (const word of ["{hide, show, glow, texture, drop}", 'texture：{"asset": 贴图资产的 id}', '写 "model" 是换回模型自己的贴图', "一样大小"]) expect(BOSS_INSTRUCTIONS).toContain(word)
})

test("what is wrong with a phase's texture is said against the model: missing, not a texture, another size stop; one that changes nothing is said", () => {
  const creature = (value: Boss) => ({ name: "变身石魔", behavior: "hostile", abilities: [], boss: value })
  const sized = () => ({ width: 128, height: 128 })
  expect(bossLookIssues(creature(swapping([CRACKED, BURNING])), design, sized)).toEqual([])
  const missing = bossLookIssues(creature(swapping([CRACKED, BURNING])), design, (id) => (id === BURNING ? null : sized()))
  expect(missing.map((issue) => [issue.rule, issue.stops])).toEqual([["boss_look_texture", true]])
  expect(missing[0]!.text).toBe("「变身石魔」第 2 个阶段换的贴图（texture）找不到了（或者那不是一张贴图）。")
  const small = bossLookIssues(creature(swapping([CRACKED, undefined])), design, () => ({ width: 64, height: 64 }))
  expect(small.filter((issue) => issue.rule === "boss_look_texture").map((issue) => [issue.stops, issue.text])).toEqual([[true, "「变身石魔」第 1 个阶段换的贴图（texture）是 64×64，模型的贴图是 128×128：两张对不齐，换上以后花纹会贴错地方。"]])
  expect(small.find((issue) => issue.rule === "boss_look_texture")!.fix).toContain("128×128")
  // The same texture again, or the model's own when it already wears it: said, not stopped.
  const again = bossLookIssues(creature(swapping([CRACKED, CRACKED])), design, sized)
  expect(again.map((issue) => [issue.rule, issue.stops])).toEqual([["boss_look_redundant", false]])
  expect(again[0]!.text).toContain("第 2 个阶段换的贴图（texture）和上一阶段穿的是同一张")
  expect(bossLookIssues(creature(swapping(["model", undefined])), design, sized).map((issue) => issue.rule)).toEqual(["boss_look_redundant"])
  expect(bossLookIssues(creature(swapping([CRACKED, "model"])), design, sized)).toEqual([])
})

test("Fabric: the creature wears its stage's texture; a boss that swaps none is the Java it always was", () => {
  const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: design }
  const entity = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
  const renderer = "src/main/java/com/minemods/content_golem_mod/client/StudioCreatureRenderer.java"
  const swapped = compileEntity({ ...plain, boss: swapping([CRACKED, BURNING]) })
  expect(String(swapped[entity])).toContain("private static final int[] BOSS_TEXTURE = {0, 1, 2};")
  expect(String(swapped[entity])).toContain("public int bossTexture() { return BOSS_TEXTURE[Math.min(bossPhase(), BOSS_TEXTURE.length - 1)]; }")
  expect(String(swapped[renderer])).toContain(
    'private static final ResourceLocation[] BOSS_TEXTURES = {ResourceLocation.fromNamespaceAndPath("golem_mod", "textures/entity/creature.png"), ResourceLocation.fromNamespaceAndPath("golem_mod", "textures/entity/creature_phase_1.png"), ResourceLocation.fromNamespaceAndPath("golem_mod", "textures/entity/creature_phase_2.png")};',
  )
  expect(String(swapped[renderer])).toContain("return BOSS_TEXTURES[creature.bossTexture()];")
  expect(bossTextureFile("creature", 2)).toBe("textures/entity/creature_phase_2.png")
  // Without a texture the creature's class and its renderer are what the same boss writes without the field at all, and name none of it.
  for (const target of [undefined, genTarget("forge-1.20.1"), genTarget("neoforge-1.21.1")]) {
    const before = compileEntity({ ...plain, boss }, target)
    const text = Object.values(before).filter((value): value is string => typeof value === "string").join("\n")
    for (const word of ["BOSS_TEXTURE", "bossTexture", "_phase_"]) expect(text).not.toContain(word)
    const swappedThere = compileEntity({ ...plain, boss: swapping([CRACKED, BURNING]) }, target)
    // Taking the texture's lines out of the swapping boss's Java gives the Java of the boss without it, file for file.
    const original = /return ([^\n]*"textures\/entity\/creature\.png"\));/.exec(text)![1]!
    const strip = (value: string | Uint8Array | undefined) =>
      String(value)
        .replace(/ {4}\/\/ Per stage: the texture it wears[^\n]*\n {4}private static final int\[\] BOSS_TEXTURE = [^\n]*\n/, "")
        .replace(/\n {4}\/\*\* The texture it wears now[^\n]*\n {4}public int bossTexture\(\)[^\n]*\n/, "")
        .replace(/ {4}\/\/ Boss 能力 10: its model's own texture[^\n]*\n {4}private static final ResourceLocation\[\] BOSS_TEXTURES = [^\n]*\n/, "")
        .replace("return BOSS_TEXTURES[creature.bossTexture()];", `return ${original};`)
    expect(Object.keys(swappedThere).sort()).toEqual(Object.keys(before).sort())
    for (const name of Object.keys(before)) expect(strip(swappedThere[name])).toBe(String(before[name]))
  }
})

async function textureSample(target: TargetId, texture: boolean) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-boss-texture-"))
  roots.push(root)
  const project = await createTargetBossLookSample(path.join(root, "石魔变身"), target, { texture })
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(path.join(root, "石魔变身"), source, TEMPLATE)
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
  return { project, source, built, names, read: (name: string) => readFile(path.join(source, name)) }
}

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: a boss whose phases put on a cracked and a burning texture writes them beside its own and the whole tree compiles; without them the build is what it was`, async () => {
    const [plain, swapped] = await Promise.all([textureSample(target, false), textureSample(target, true)])
    const id = (sample: typeof plain) => `creature_${sample.project.entities[0]!.id.replaceAll("-", "")}`
    const textures = `src/main/resources/assets/stone_change/textures/entity/${id(swapped)}`
    // The two textures, each with the model's glow mask beside it (its veins and eyes glow whichever it wears), and in the list of files the jar must hold.
    for (const index of [1, 2]) {
      expect(swapped.names).toContain(`${textures}_phase_${index}.png`)
      expect(swapped.names).toContain(`${textures}_phase_${index}_glowmask.png`)
      expect(Buffer.compare(await swapped.read(`${textures}_phase_${index}_glowmask.png`), await swapped.read(`${textures}_glowmask.png`))).toBe(0)
      expect(swapped.built.glowMasks).toContain(`assets/stone_change/textures/entity/${id(swapped)}_phase_${index}.png`)
    }
    const renderer = String(await swapped.read(swapped.names.find((name) => /client\/StudioCreatureRenderer\w*\.java$/.test(name))!))
    expect(renderer).toContain("return BOSS_TEXTURES[creature.bossTexture()];")
    expect(renderer).toContain(`textures/entity/${id(swapped)}_phase_2.png`)
    const entity = String(await swapped.read(swapped.names.find((name) => /entity\/StudioCreature\w*\.java$/.test(name))!))
    expect(entity).toContain("private static final int[] BOSS_TEXTURE = {0, 1, 2};")
    // Without the textures: the same files as before, to the byte, but for the project's and the creature's own ids (another project), and none of the texture's.
    const mask = (sample: typeof plain) => async (name: string) => (await sample.read(name)).toString("latin1").replaceAll(id(sample), "creature_X").replaceAll(sample.project.id, "PROJECT")
    const extra = swapped.names.filter((name) => !name.startsWith("project-backup") && !plain.names.includes(name.replaceAll(id(swapped), id(plain))))
    expect(extra.sort()).toEqual([1, 2].flatMap((index) => [`${textures}_phase_${index}.png`, `${textures}_phase_${index}_glowmask.png`]).sort())
    expect(plain.names.some((name) => name.includes("_phase_"))).toBe(false)
    const differ: string[] = []
    for (const name of plain.names) {
      if (name.startsWith("project-backup") || name.endsWith("minemods-build.json")) continue
      if ((await mask(plain)(name)) !== (await mask(swapped)(name.replaceAll(id(plain), id(swapped))))) differ.push(name.replace(/.*\//, ""))
    }
    expect(differ.sort()).toEqual([expect.stringMatching(/^StudioCreature\w*\.java$/), expect.stringMatching(/^StudioCreatureRenderer\w*\.java$/)])
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(swapped.source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}
