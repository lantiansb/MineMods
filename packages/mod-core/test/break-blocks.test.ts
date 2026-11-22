import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { BREAK_LIMITS } from "../src/boss-words"
import { assembleBuildSource } from "../src/build-source"
import { abilityWords } from "../src/creature-abilities"
import { BOSS_EVENT_INSTRUCTIONS, bossWords } from "../src/creature-boss"
import { AbilitySchema, type Ability } from "../src/entity-runtime"
import { BOSS_RUNTIME, compileBossRuntime } from "../src/fabric/boss-runtime"
import { compileEntity } from "../src/fabric/entity"
import { genTarget } from "../src/platform/target"
import { openProject, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { createTargetAbilitySample } from "../script/target-ability-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * An ability that breaks blocks of the world (`break`, 铁额撞 smashing a pillar): the one event that changes the world, only where the world lets mobs change blocks, never
 * a block with a store, an unbreakable one or a fluid, at most `BREAK_LIMITS.blocks` a time. A project without one is what it always was.
 */

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const [slam] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability]
const smash = { type: "break", at: slam.hits[0]!.at, where: "self", hit: null, forward: 2, up: 0, left: 0, radius: 1.5, height: 4, hardness: 2, drops: true } as const
const charge = AbilitySchema.parse({ ...slam, id: "charge", name: "铁额撞", events: [smash, { ...smash, where: "hit", hit: 0, forward: 0, radius: 1, height: 2, hardness: 0.6, drops: false }] })
const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const entityPath = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const said = (ability: unknown) => AbilitySchema.safeParse(ability).error?.issues.map((issue) => issue.message).join(" ") ?? ""

test("a break names where it is counted from as debris does, within its limits", () => {
  expect(charge.events.filter((event) => event.type === "break")).toHaveLength(2)
  expect(said({ ...slam, events: [{ ...smash, where: "hit", hit: null }] })).toContain('打碎方块的 where 写 "hit" 的时候用 hit 写是第几次出手')
  expect(said({ ...slam, events: [{ ...smash, hit: 0 }] })).toContain("其余时候 hit 写 null")
  expect(said({ ...slam, events: [{ ...smash, where: "hit", hit: 5 }] })).toContain("这个招式只有 1 次出手")
  expect(said({ ...slam, events: [{ ...smash, radius: BREAK_LIMITS.radius.max + 1 }] })).not.toBe("")
  expect(said({ ...slam, events: [{ ...smash, hardness: 50 }] })).not.toBe("")
  expect(said({ ...slam, events: [{ ...smash, at: slam.length + 1 }] })).toContain("打碎方块的时刻（at）不能比招式全长（length）还晚")
})

test("the words say what breaks and what never does, and the instructions tell an outside AI it is the one event that changes the world", () => {
  expect(bossWords.breaks(smash)).toBe("第 " + String(smash.at) + " 秒打碎它前方 2 格半径 1.5 格、往上 4 格以内硬度不超过 2 的方块（掉落方块本身；世界关了生物破坏方块时不打碎，箱子这类有存储的方块、基岩和液体不碰）")
  expect(abilityWords.events(charge)).toContain("打碎打到的地方半径 1 格")
  expect(BOSS_EVENT_INSTRUCTIONS).toContain('{type:"break", at, where: self|target|hit')
  expect(BOSS_EVENT_INSTRUCTIONS).toContain(`一次最多 ${BREAK_LIMITS.blocks} 块`)
})

test("the creature calls the runtime's break where the ability says; one without a break names none of it", () => {
  const made = String(compileEntity({ ...plain, abilities: [charge] } as never)[entityPath])
  expect(made).toContain(`abilityBreak(abilityPoint(0.0, 0.0, 0.0), 2.0, 0.0, 0.0, 1.5, 4.0, 2.0f, true);`)
  // Counted from where the hit it names lands, as debris is.
  expect(made).toContain(`abilityBreak(abilityPoint(1.25, 1.0, 0.0), 0.0, 0.0, 0.0, 1.0, 2.0, 0.6f, false);`)
  expect(made).toContain(`${BOSS_RUNTIME.breaks}.smash(world, this, origin.add(`)
  expect(made).toContain("import net.minecraft.server.level.ServerLevel;")
  expect(String(compileEntity({ ...plain, abilities: [slam] } as never)[entityPath])).not.toContain("abilityBreak")
})

test("the runtime asks the world before breaking: the game rule on Fabric, the loader's own question on Forge and NeoForge; without a break it writes nothing new", () => {
  const input = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", shake: false, debris: true }
  const name = `src/main/java/com/minemods/content_golem_mod/entity/${BOSS_RUNTIME.breaks}.java`
  const fabric = compileBossRuntime({ ...input, breaks: true })
  const text = String(fabric.files[name])
  expect(text).toContain("world.getGameRules().getBoolean(GameRules.RULE_MOBGRIEFING)")
  expect(text).toContain("state.isAir() || !state.getFluidState().isEmpty() || state.hasBlockEntity()")
  expect(text).toContain("if (tough < 0.0f || tough > hardness) continue;")
  expect(text).toContain(`private static final int MOST = ${BREAK_LIMITS.blocks};`)
  expect(text).toContain("world.destroyBlock(here, drops, breaker)")
  expect(fabric.classes).toContain(`com/minemods/content_golem_mod/entity/${BOSS_RUNTIME.breaks}.class`)
  for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
    const facade = String(compileBossRuntime({ ...input, breaks: true }, genTarget(target)).files[name])
    expect(facade).toContain("StudioPlatform.mobGriefing(breaker)")
    expect(facade).not.toContain("GameRules")
  }
  const without = compileBossRuntime(input)
  expect(Object.keys(without.files).some((file) => file.includes(BOSS_RUNTIME.breaks))).toBe(false)
  expect(JSON.stringify(without)).toBe(JSON.stringify(compileBossRuntime({ ...input, breaks: false })))
})

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: a project whose creature breaks blocks builds the runtime class, and the whole tree compiles`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-break-"))
    roots.push(root)
    const directory = path.join(root, "雷鸣石窟")
    await createTargetAbilitySample(directory, target)
    const project = await openProject(directory)
    const [first, ...rest] = project.entities
    await saveProject(directory, { ...project, entities: [{ ...first!, abilities: [charge], combos: [] }, ...rest] }, project.revision)
    const source = path.join(root, "source")
    await mkdir(source)
    await assembleBuildSource(directory, source, TEMPLATE)
    const runtime = await readFile(path.join(source, `src/main/java/com/minemods/content_thunder_cave/entity/${BOSS_RUNTIME.breaks}.java`), "utf8")
    expect(runtime).toContain(target === "fabric-1.21.1" ? "GameRules.RULE_MOBGRIEFING" : "StudioPlatform.mobGriefing(breaker)")
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}
