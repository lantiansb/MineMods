import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { GameplayDocument } from "@minemods/mod-core/gameplay"
import { describeAsset } from "../src/renderer/features/asset-words"
import { createDataGameplaySample } from "../../mod-core/script/data-gameplay-sample"

// P2-05 (broad20): a summoned creature's card said 「看见玩家就会主动攻击」 while the gameplay that summons it rules on whom it fights. The card says which gameplay takes that over.
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const sample = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-held-"))
  roots.push(root)
  return createDataGameplaySample(path.join(root, "project"), { life: true })
}
const name = (reference: string) => reference
const rows = (project: Awaited<ReturnType<typeof sample>>) => {
  const asset = project.workspace.assets.find((value) => value.document.kind === "entity")!
  return Object.fromEntries(describeAsset(project, { id: asset.id, asset_id: asset.id, kind: "entity", preview: { source: "asset" } }, name).rows.map((row) => [row.label, row.text]))
}

test("生物卡：玩法的代码给它设了打谁的规则时，「脾气」不只写通用的敌对描述，并写明是哪个玩法", async () => {
  const project = await sample()
  const gameplay = project.workspace.assets.find((value) => value.document.kind === "gameplay")!
  const title = gameplay.title
  const card = rows(project)
  expect(card["脾气"]).toContain("看见玩家就会主动攻击")
  expect(card["脾气"]).toContain("实际打谁以那个玩法为准")
  expect(card["脾气"]).toContain(`「${title}」`)
  expect(card["受玩法影响"]).toContain(`「${title}」：管它打谁`)
  expect(card["受玩法影响"]).toContain("没有运行过")
})

test("生物卡：玩法只是用到了它、没有碰它的目标时，不改脾气，只说玩法可能会改变它的行为", async () => {
  const project = await sample()
  const asset = project.workspace.assets.find((value) => value.document.kind === "gameplay")!
  const document = asset.document as unknown as GameplayDocument
  // The same gameplay without the two calls that touch the creature's targets and behaviour: it still lists the creature under `uses`.
  const light = {
    ...project,
    workspace: {
      ...project.workspace,
      assets: project.workspace.assets.map((value) =>
        value.id === asset.id ? { ...value, document: { ...document, sources: document.sources.map((file) => ({ ...file, content: file.content.replace(/ProjectContent\s*\.\s*(targetRule|addGoal)\([^;]*;/g, "") })) } } : value,
      ),
    },
  } as typeof project
  const card = rows(light)
  expect(card["脾气"]).toBe("看见玩家就会主动攻击")
  expect(card["受玩法影响"]).toContain("用到了它")
  expect(card["受玩法影响"]).toContain("可能会改变它的行为")
})

test("生物卡：没有任何玩法提到它时，和以前一字不差，也没有「受玩法影响」", async () => {
  const project = await sample()
  const alone = { ...project, workspace: { ...project.workspace, assets: project.workspace.assets.filter((value) => value.document.kind !== "gameplay") } } as typeof project
  const card = rows(alone)
  expect(card["脾气"]).toBe("看见玩家就会主动攻击")
  expect(Object.keys(card)).not.toContain("受玩法影响")
})

test("生物卡：招式有一刻交给玩法的代码去做时，招式那一行写明是哪个玩法，内部的名字只在高级里", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-handed-"))
  roots.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"), { life: true, abilities: true })
  const gameplay = project.workspace.assets.find((value) => value.document.kind === "gameplay")!
  const handed = { ...(gameplay.document as unknown as GameplayDocument), slug: "swamp_summon" }
  const summon = { id: "summon_frogs", name: "召唤小毒蛙", clip: "burst", windup: 0.8, length: 1.6, facing: "lock", hits: [{ type: "gameplay", at: 1, gameplay: "swamp_summon", action: "summon_frogs" }], moves: [], start: { min_distance: 3, max_distance: 12, line_of_sight: true, cooldown: 8, weight: 2 }, stopped_by_hurt: false, events: [] }
  const withSummon = {
    ...project,
    entities: project.entities.map((entity) => ({ ...entity, abilities: [...(entity.abilities ?? []), summon] })),
    workspace: { ...project.workspace, assets: project.workspace.assets.map((value) => (value.id === gameplay.id ? { ...value, document: handed } : value.document.kind === "entity" ? { ...value, document: { ...value.document, abilities: [...(value.document.abilities ?? []), summon] } } : value)) },
  } as unknown as typeof project
  const asset = withSummon.workspace.assets.find((value) => value.document.kind === "entity")!
  const card = describeAsset(withSummon, { id: asset.id, asset_id: asset.id, kind: "entity", preview: { source: "asset" } }, name).rows.find((row) => row.label === "招式「召唤小毒蛙」")!
  expect(card.text).toContain(`第 1 秒由玩法「${gameplay.title}」的代码接着做`)
  expect(card.text).not.toMatch(/swamp_summon|summon_frogs/)
  expect(card.detail).toContain("gameplay swamp_summon.summon_frogs at tick 20")
})
