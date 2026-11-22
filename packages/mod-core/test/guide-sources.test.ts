import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { blockFacets, itemFacets, sourceWays } from "../src/content-facets"
import { CreatureLootSchema } from "../src/entity-runtime"
import { resolveProfile } from "../src/fabric/profile"
import { BUILT_WORDS, modGuide } from "../src/guide"
import { projectGuide } from "../src/guide-project"
import { startJob, updateJob } from "../src/jobs"
import { openProject, ProjectSchema, saveProject, type Project } from "../src/project"
import { reconcile } from "../src/reconcile"
import { createDataGameplaySample } from "../script/data-gameplay-sample"
import { sampleProject } from "./fixtures/gameplay/sample"
import { WorkspaceAssetSchema } from "../src/workspace"
import { oggDataUrl, oggVorbis } from "./ogg-sample"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const SHELL = "0c9b4e12-45eb-4fca-b19b-aba4424293a9"
const NO_SOURCE = "没有配方，不会在世界里生成，也没有方块或生物掉它"

/**
 * The project of round 18's real run, in the old sample's clothes: a creature whose loot gives one of the mod's own items
 * (written as the loot schema stores it: the bare identifier), and a 2×2 recipe that turns four of them into a block.
 */
function shelled(loot = true): Project {
  const base = sampleProject()
  const dew = base.workspace.assets.find((asset) => asset.module === "item")!
  const drop = CreatureLootSchema.parse({ item: "sandstone_shell", min: 1, max: 2, chance: 1, player_only: true })
  const shell = `${base.mod_id}:sandstone_shell`
  return ProjectSchema.parse({
    ...base,
    items: [...base.items, { ...base.items[0]!, id: SHELL, identifier: "sandstone_shell", name: "砂岩甲壳" }],
    recipes: base.recipes.map((recipe) => ({ ...recipe, pattern: [shell, shell, null, shell, shell, null, null, null, null] })),
    entities: base.entities.map((entity) => ({ ...entity, runtime: { ...entity.runtime!, death_drop: null }, loot: loot ? [drop] : [] })),
    workspace: { assets: [...base.workspace.assets, { ...dew, id: SHELL, title: "砂岩甲壳", document: { ...dew.document, identifier: "sandstone_shell", name: "砂岩甲壳" } }] },
  })
}

const facts = (project: Project) => {
  const animations = Object.fromEntries(project.entities.map((entity) => [entity.id, ["idle", "walk", "hurt"]]))
  return { findings: reconcile(project, { animations }), animations, glowing: [], built: false }
}

/** For every block and item: the guide never says both that something gives it and that nothing does, and agrees with the one reader. */
function expectConsistent(project: Project) {
  const guide = modGuide(project, facts(project))
  const lines = guide.sections.flatMap((section) => section.lines.map((line) => line.text))
  ;[...project.blocks.map((value) => ({ value, facets: blockFacets(value, project) })), ...project.items.map((value) => ({ value, facets: itemFacets(value, project) }))].forEach(({ value, facets }) => {
    const nothing = lines.some((line) => line.startsWith(`「${value.name}」${NO_SOURCE}`))
    // A sentence that something drops, gives or makes it, wherever in the guide it stands (its own section, a creature's, a block's).
    const given = lines.filter((line) => !line.includes(NO_SOURCE) && new RegExp(`掉[^。；]*「${value.name}」|^「${value.name}」(?:：|可以|在)`).test(line) && !line.startsWith(`方块「`) && !line.startsWith(`物品「`))
    const ways = sourceWays(project, value.identifier)
    expect([value.name, nothing, given]).toEqual([value.name, ways.length === 0, ways.length === 0 ? [] : given])
    if (ways.length) expect([value.name, given.length > 0]).toEqual([value.name, true])
    // The standard's own answer is the same reading.
    expect([value.name, facets.some((facet) => facet.question === "source" && facet.answered)]).toEqual([value.name, ways.length > 0])
    // A creature that drops one of the project's things is one of that thing's ways, and the other way round.
    project.entities.forEach((entity) => expect([value.name, entity.name, ways.some((way) => (way.way === "loot" || way.way === "death_drop") && way.entity.id === entity.id)]).toEqual([value.name, entity.name, (entity.loot ?? []).some((drop) => drop.item === value.identifier) || entity.runtime?.death_drop?.block_identifier === value.identifier]))
  })
}

test("生物掉的东西算作那样东西的来历：说明书、四个问题和对账读的是同一份", () => {
  const project = shelled()
  const shell = project.items.find((item) => item.identifier === "sandstone_shell")!
  expect(itemFacets(shell, project).filter((facet) => facet.question === "source")).toEqual([{ question: "source", answered: true, words: "打败「苔皮苦力怕」会掉 1–2 个（要玩家亲手打败）", through: [project.workspace.assets.find((asset) => asset.module === "entity")!.id] }])
  const page = modGuide(project, facts(project)).markdown
  expect(page).toContain("- 「砂岩甲壳」：打败「苔皮苦力怕」会掉 1–2 个（要玩家亲手打败）。")
  expect(page).toContain("- 打败它会掉 1–2 个「砂岩甲壳」（要玩家亲手打败）。")
  expect(page).toContain("「秘匣」可以合成：在工作台上按配方「秘匣配方」摆放 4 个「砂岩甲壳」，做出 1 个。")
  expect(page).not.toContain(`「砂岩甲壳」${NO_SOURCE}`)
  expect(facts(project).findings.filter((finding) => finding.rule.startsWith("play_") && (finding.about?.id === SHELL || finding.text.includes("砂岩甲壳")))).toEqual([])
  expectConsistent(project)

  // The other way round: nothing drops it, so nothing in the guide says so, and reconciliation says the chain is broken.
  const bare = shelled(false)
  const without = modGuide(bare, facts(bare)).markdown
  expect(without).toContain(`「砂岩甲壳」${NO_SOURCE}：可以在创造模式里拿：按 E 打开物品栏，点「搜索物品」页签，输入它的名字；不想翻物品栏的话，按 T 打开聊天框，粘贴 \`/give @s legacy_sample:sandstone_shell\` 再按回车，直接给你一个。`)
  expect(without).not.toMatch(/掉[^。\n]*「砂岩甲壳」|「砂岩甲壳」：打败/)
  expect(facts(bare).findings.filter((finding) => finding.about?.id === SHELL).map((finding) => [finding.rule, finding.detail])).toEqual([["play_gap", "source"]])
  expectConsistent(bare)
})

test("每一样方块和物品：说明书不会一边说有东西掉它、一边说什么都不掉它", async () => {
  expectConsistent(sampleProject())
  const root = await mkdtemp(path.join(os.tmpdir(), "guide-sources-"))
  roots.push(root)
  // The sample that uses every data feature, plain and with a living creature that has drops of its own.
  expectConsistent(await createDataGameplaySample(path.join(root, "plain")))
  const alive = await createDataGameplaySample(path.join(root, "alive"), { life: true, chain: true })
  expect(alive.entities.some((entity) => entity.loot?.length)).toBe(true)
  expectConsistent(alive)
  // Every drop taken away again: whatever only a creature gave now has no source, said once and nowhere contradicted.
  expectConsistent(ProjectSchema.parse({ ...alive, entities: alive.entities.map((entity) => ({ ...entity, loot: [] })) }))
})

test("按需读的说明书和 jar 旁边那份对“打包了没有”说的一样", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "guide-built-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const project = await createDataGameplaySample(directory)
  expect((await projectGuide(directory)).guide.markdown).toContain(BUILT_WORDS.never)
  // A build that did not finish is not a build.
  const failed = await startJob(directory, { kind: "build", expectedRevision: project.revision })
  await updateJob(directory, failed.id, { expectedRevision: 0, state: "running" })
  await updateJob(directory, failed.id, { expectedRevision: 1, state: "failed", error: "x" })
  expect((await projectGuide(directory)).guide.markdown).toContain(BUILT_WORDS.never)
  const job = await startJob(directory, { kind: "build", expectedRevision: project.revision })
  await updateJob(directory, job.id, { expectedRevision: 0, state: "running" })
  await updateJob(directory, job.id, { expectedRevision: 1, state: "completed", output: { id: job.id, revision: project.revision } })
  const built = (await projectGuide(directory)).guide.markdown
  expect(built).toContain(BUILT_WORDS.built)
  expect(built).not.toContain("还没有打包")
  // Saved again after the build: the jar is of the older version, and that is what is said.
  const opened = await openProject(directory)
  await saveProject(directory, { ...opened, description: `${opened.description} 改过` }, opened.revision)
  const changed = (await projectGuide(directory)).guide.markdown
  expect(changed).toContain(BUILT_WORDS.changed)
  expect(changed).not.toContain(BUILT_WORDS.built)
  expect(changed).not.toContain("还没有打包")
})

test("没有英文名的提醒只数玩家在游戏里看得到名字的东西", () => {
  const base = sampleProject()
  const animations = Object.fromEntries(base.entities.map((entity) => [entity.id, ["idle", "walk", "hurt"]]))
  const missing = (project: Project) => reconcile(project, { animations }).filter((finding) => finding.rule === "english_missing").map((finding) => finding.text)
  expect(missing(base)).toEqual(["有 3 样东西还没有英文名，英文版游戏里会显示中文：「秘匣」、「月露」、「苔皮苦力怕」。"])
  // A model saved before its creature: the record carries the model's own title, which only Studio shows.
  const early: Project = { ...base, entities: base.entities.map((entity) => ({ ...entity, name: "苔皮苦力怕外观" })), workspace: { assets: base.workspace.assets.filter((asset) => asset.module !== "entity").map((asset) => (asset.module === "model" ? { ...asset, title: "苔皮苦力怕外观" } : asset)) } }
  expect(missing(early)).toEqual(["有 2 样东西还没有英文名，英文版游戏里会显示中文：「秘匣」、「月露」。"])
  // Nothing else that lives only in Studio is counted either: models, textures, animations and the design documents all have Chinese titles here.
  expect(base.workspace.assets.filter((asset) => !["block", "item", "entity"].includes(asset.module)).length).toBeGreaterThan(5)
  // A creature made by hand in an old project has no model in the workspace, and is still asked about.
  const hand: Project = { ...base, workspace: { assets: base.workspace.assets.filter((asset) => !["entity", "model", "logic"].includes(asset.module)) } }
  expect(missing(hand)[0]).toContain("「苔皮苦力怕」")
})

test("安装那一句的 GeckoLib 版本取自构建档案，并说明更新的同一大版本也行", () => {
  const project = sampleProject()
  const profile = resolveProfile(project.target)
  const major = profile.geckolib.version.split(".")[0]
  expect(modGuide(project, facts(project)).markdown).toContain(`GeckoLib ${profile.geckolib.version} 或更新的 ${major}.x（Fabric ${profile.minecraft} 版）`)
  expect(modGuide(project, facts(project)).markdown).toContain("GeckoLib 4.8.3 或更新的 4.x")
})

test("broad6 w1 / broad23: a hostile creature in the test scene's pen is said to stand in a glass pen with a gate, and the one command that brings it out to fight", () => {
  const base = sampleProject()
  const hostile = ProjectSchema.parse({ ...base, entities: base.entities.map((entity) => ({ ...entity, behavior: "hostile", attack_damage: 3 })) })
  const page = modGuide(hostile, facts(hostile)).markdown
  expect(page).toContain("玻璃栏")
  expect(page).toContain("木栅栏门")
  expect(page).not.toContain("看不见的墙")
  expect(page).toContain(`/tp @e[type=${base.mod_id}:`)
  expect(page).toContain(",limit=1] ^ ^ ^6")
  // A creature that does not attack is not told so.
  expect(modGuide(base, facts(base)).markdown.includes("玻璃栏")).toBe(base.entities.some((entity) => entity.behavior === "hostile"))
})

test("broad7 w2: a creature whose model is made before the creature itself is not read as having the model's placeholder rules", () => {
  const base = sampleProject()
  const entity = base.entities[0]!
  const blueprint = {
    state: "confirmed",
    entries: [
      { key: "beast", kind: "entity", title: entity.name, owner: null, asset_id: null },
      { key: "beast_model", kind: "model", title: `${entity.name}模型`, owner: "beast", asset_id: entity.id },
    ],
  }
  const pending = { ...base, blueprint } as unknown as Project
  const page = modGuide(pending, facts(base)).markdown
  expect(page).toContain("生物本身还在做")
  expect(page).not.toContain(`生命 ${entity.health} 点`)
  // Once its creature entry is made, it reads as before.
  const made = { ...base, blueprint: { ...blueprint, entries: blueprint.entries.map((entry) => (entry.kind === "entity" ? { ...entry, asset_id: entity.id } : entry)) } } as unknown as Project
  expect(modGuide(made, facts(base)).markdown).not.toContain("还在做")
})

test("说明书以保存的声音为准，机器对账提醒蓝图与实作的差异", () => {
  const base = sampleProject()
  const title = "风铃石卫"
  const soundId = "e5881cc2-39fa-493a-a283-b4c5d72c4c1e"
  const sound = WorkspaceAssetSchema.parse({
    ...base.workspace.assets[0],
    id: soundId, module: "sound", title: "清石铃声", dependencies: [], status: "ready",
    document: { kind: "sound", name: "stone_chime", files: [{ data: oggDataUrl(oggVorbis({ samples: 22050 })), duration: 0.5 }], subtitle: null, category: null, volume: 1, pitch: 1 },
  })
  const creature = base.entities[0]!
  const rules = base.workspace.assets.find((asset) => asset.module === "entity")!
  const outOfScope = "先用原版声音。"
  const entry = { key: "chime_guard", kind: "entity", title, brief: "一只守门的石卫。", owner: null, needs: [], out_of_scope: outOfScope, asset_id: rules.id }
  const project = (brief: string, plan: string | null, hurt: string | { asset: string }, assetId: string | null = rules.id) => {
    const sounds = { ambient: null, hurt, death: null, step: null, pitch: 1, volume: 1 }
    return ProjectSchema.parse({
      ...base,
      entities: [{ ...creature, name: title, sounds }],
      workspace: { assets: [...base.workspace.assets.map((asset) => asset.id === rules.id ? {
        ...asset, title, dependencies: [...asset.dependencies, ...(typeof hurt === "object" ? [soundId] : [])],
        document: { ...asset.document, name: title, sounds },
      } : asset), sound] },
      blueprint: { request: "做一只风铃石卫", style: { palette: [], shape: "", naming: "", world: "" }, entries: [{ ...entry, brief, out_of_scope: plan, asset_id: assetId }], questions: [], state: "confirmed", revision: 1 },
    })
  }
  const drift = (value: Project) => facts(value).findings.filter((finding) => finding.rule === "blueprint_sound_drift")
  const custom = project(entry.brief, outOfScope, { asset: soundId })
  const page = modGuide(custom, facts(custom)).markdown
  expect(page).toContain("受伤时放自己的声音「清石铃声」")
  expect(page).not.toContain(outOfScope)
  expect(page).not.toContain("蓝图里说")
  expect(drift(custom)).toEqual([expect.objectContaining({
    stops: false, about: { kind: "entity", id: creature.id, name: title },
    text: "蓝图里说「风铃石卫」用原版声音，做出来的用了自己的声音「清石铃声」。",
  })])

  const vanilla = "entity.iron_golem.hurt"
  const fromBrief = project("要做自己的声音。", null, vanilla, creature.id)
  expect(drift(fromBrief)).toEqual([expect.objectContaining({
    stops: false, text: "蓝图里说「风铃石卫」用自己的声音，做出来的配了原版声音。",
  })])
  expect(drift(project(entry.brief, outOfScope, vanilla))).toEqual([])
  expect(drift(project("只在受伤时用原版声音。", null, { asset: soundId }))).toEqual([])

  for (const id of [null, "e0fb29b6-3d03-4378-b009-60365619d79c"]) {
    const pending = project(entry.brief, outOfScope, { asset: soundId }, id)
    expect(modGuide(pending, facts(pending)).markdown).toContain(`「${title}」：${outOfScope}`)
    expect(drift(pending)).toEqual([])
  }
})
