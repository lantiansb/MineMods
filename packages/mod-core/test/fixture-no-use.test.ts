import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { ARENA_INSTRUCTIONS, ArenaSchema, arenaLines } from "../src/arena"

import { fixtureIssues, usesFixtureControls } from "../src/fixture-checks"
import { FIXTURE_INSTRUCTIONS } from "../src/fixture"
import { openProject, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { ARENA_SAMPLE_IDS, createTargetArenaSample, fogAbility } from "../script/target-arena-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

// 主工程第 10 条：场地物件的 use 改成可选。不写就不响应右键（也不吃近战和箭），只跟着招式和演出亮。

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const group = { id: "brazier", look: { asset: ARENA_SAMPLE_IDS.compass }, place: { forward: 6, left: 0 }, clear: { radius: 6, seconds: 30 } }
const lightAll = { type: "fixture" as const, at: 0, do: "light" as const, which: "all" as const }
const boss = (abilities: unknown[]) => ({ abilities, boss: { arena: { fixtures: [group], fog: null } } })

test("不写 use 的物件：文档收、说明和场地文字讲清楚「玩家点不亮，只跟着招式和演出亮」；没有任何步骤点亮它时检查会说", () => {
  expect(ArenaSchema.safeParse({ fixtures: [group], fog: null }).success).toBe(true)
  expect(arenaLines({ fixtures: [group], fog: null }).join("")).toContain("玩家点不亮它（右键、近战、射箭都没用），只跟着招式和演出亮")
  expect(ARENA_INSTRUCTIONS).toContain("use?:{seconds")
  expect(ARENA_INSTRUCTIONS).toContain("不写 use 的物件玩家点不亮（右键、近战、射箭都不响应），只跟着招式、登场、死亡和阶段里的 fixture 步骤亮和熄")
  expect(FIXTURE_INSTRUCTIONS).toContain("那组不写 use 就点不亮，只跟着招式和演出亮")
  // It takes the fixture controls (that is where a use key on a fixture is turned away).
  expect(usesFixtureControls(boss([]) as never)).toBe(true)
  const lonely = fixtureIssues(boss([{ ...fogAbility, events: [] }]) as never)
  expect(lonely.map((issue) => issue.path.join("."))).toContain("boss.arena.fixtures.0.use")
  expect(lonely.find((issue) => issue.path.join(".") === "boss.arena.fixtures.0.use")?.message).toContain("它会一直不亮")
  const lit = fixtureIssues(boss([{ ...fogAbility, events: [...fogAbility.events, lightAll] }]) as never)
  expect(lit.map((issue) => issue.path.join("."))).not.toContain("boss.arena.fixtures.0.use")
})

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: 不写 use 的物件在用表里是 -2，右键交回原版，近战和箭不点亮；整棵树编译通过`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-fixture-no-use-"))
    roots.push(root)
    const directory = path.join(root, "涿鹿之野")
    await createTargetArenaSample(directory, target)
    const project = await openProject(directory)
    const entities = project.entities.map((entity) => {
      const fixtures = entity.boss!.arena!.fixtures.map(({ use: _use, ...rest }) => rest)
      const abilities = entity.abilities!.map((move, index) => (index === 0 ? { ...move, events: [...move.events, lightAll] } : move))
      return { ...entity, abilities, boss: { ...entity.boss!, arena: { ...entity.boss!.arena!, fixtures } } }
    })
    await saveProject(directory, { ...project, entities }, project.revision)
    const source = path.join(root, "source")
    await mkdir(source)
    await assembleBuildSource(directory, source, TEMPLATE)
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name))
    const creature = await readFile(names.find((name) => /entity[\\/]StudioCreature\w*\.java$/.test(name))!, "utf8")
    expect(creature).toContain("new int[] {-2, -2, -2, -2}, new int[] {0, 0, 0, 0}")
    const arena = await readFile(names.find((name) => name.endsWith(`${path.sep}StudioArena.java`))!, "utf8")
    expect(arena).toContain("if (fight.spec.use()[index] < 0) return InteractionResult.PASS;")
    expect(arena).toContain("fight.spec.use()[index] == -1);")
    expect(arena).toContain("fight.spec.use()[slot] != -1 ||")
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}
