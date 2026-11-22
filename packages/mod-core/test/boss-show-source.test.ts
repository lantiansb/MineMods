import { expect, test } from "bun:test"
import { blockFacets, sourceWays } from "../src/content-facets"
import { BossSchema } from "../src/entity-runtime"
import { modGuide } from "../src/guide"
import { ProjectSchema, type Project } from "../src/project"
import { reconcile } from "../src/reconcile"
import { sampleProject } from "./fixtures/gameplay/sample"

/**
 * A block a boss puts in the world itself has a source: its death show grows trees of it (蚩尤's 赤枫叶, 2026-11-16, which the build reminded had
 * no source at all), its wake-up sets it down, or its lair is built of it. The standard, the build's reconcile and the guide read it the same way.
 */

const LEAVES = "d1d1d1d1-0000-4000-8000-000000000001"
const STONE = "d1d1d1d1-0000-4000-8000-000000000002"
const BELL = "d1d1d1d1-0000-4000-8000-000000000003"
const LONELY = "d1d1d1d1-0000-4000-8000-000000000004"

function bossProject(): Project {
  const base = sampleProject()
  const asset = base.workspace.assets.find((value) => value.module === "block")!
  const block = (id: string, identifier: string, name: string) => ({ block: { ...base.blocks[0]!, id, identifier, name, generation: null }, asset: { ...asset, id, title: name, document: { ...asset.document, identifier, name, generation: null } } })
  const made = [block(LEAVES, "red_maple_leaves", "赤枫叶"), block(STONE, "bronze_floor", "青铜地砖"), block(BELL, "war_drum", "战鼓"), block(LONELY, "lonely_block", "孤零零")]
  const leaves = (forward: number) => ({ block: "red_maple_leaves", forward, up: 3, left: 0 })
  const boss = BossSchema.parse({
    bar: { color: "red", style: "progress", darken_sky: false },
    intro: { wake_distance: 12, clip: null, sound: null, seconds: 3, steps: [{ type: "place_structure", at: 1, forward: 2, left: 0, structure: { blocks: [{ block: "war_drum", forward: 0, up: 0, left: 0 }] } }] },
    phases: [],
    death: { seconds: 6, xp_bursts: 0, explosion: false, steps: [{ type: "place_structure", at: 5, forward: 0, left: 0, structure: { blocks: [leaves(0), leaves(1), { block: "minecraft:oak_log", forward: 0, up: 0, left: 0 }] } }] },
    leash: null,
    lair: { biomes: ["minecraft:plains"], spacing: 40, radius: 8, floor: ["bronze_floor", "minecraft:stone"], rim: null, clearance: 8 },
  })
  return ProjectSchema.parse({
    ...base,
    blocks: [...base.blocks, ...made.map((value) => value.block)],
    entities: base.entities.map((entity) => ({ ...entity, boss })),
    workspace: { assets: [...base.workspace.assets, ...made.map((value) => value.asset)] },
  })
}

test("a block a boss's death show sets down, its wake-up sets down, or its lair is built of has a source; one it does not touch still has none", () => {
  const project = bossProject()
  const boss = project.entities[0]!.name
  const source = (identifier: string) => blockFacets(project.blocks.find((value) => value.identifier === identifier)!, project).filter((facet) => facet.question === "source")
  expect(source("red_maple_leaves")).toEqual([{ question: "source", answered: true, words: `打败「${boss}」后，它的死亡演出会在原地摆下它`, through: [expect.any(String)] }])
  expect(source("war_drum")).toEqual([expect.objectContaining({ answered: true, words: `「${boss}」醒来时的登场演出会在原地摆下它` })])
  expect(source("bronze_floor")).toEqual([expect.objectContaining({ answered: true, words: `「${boss}」的巢是用它铺的（巢随世界生成）`, through: [] })])
  expect(source("lonely_block")).toEqual([expect.objectContaining({ answered: false })])
  expect(sourceWays(project, "red_maple_leaves").map((way) => way.way)).toEqual(["boss_show"])
  expect(sourceWays(project, "bronze_floor").map((way) => way.way)).toEqual(["lair"])
  // The build's reminder and the guide say the same: no "nothing gives it" for the leaves, and where they come from instead.
  const animations = Object.fromEntries(project.entities.map((entity) => [entity.id, ["idle", "walk", "hurt"]]))
  const findings = reconcile(project, { animations })
  expect(findings.filter((finding) => finding.text.includes("赤枫叶") && /创造模式|得不到|走不到/.test(finding.text))).toEqual([])
  const lines = modGuide(project, { findings, animations, glowing: [], built: false }).sections.flatMap((section) => section.lines.map((line) => line.text))
  expect(lines).toContain(`「赤枫叶」：打败「${boss}」后，它的死亡演出会在原地摆下它。`)
  expect(lines.some((line) => line.startsWith("「赤枫叶」没有配方"))).toBe(false)
  expect(lines.some((line) => line.startsWith("「孤零零」没有配方"))).toBe(true)
})
