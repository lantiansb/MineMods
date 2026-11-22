import { afterAll, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { openProject, saveProject, type Project } from "../src/project"
import { applyProjectImport, duplicateAssets, listProjectImports, mergeDuplicateAssets, previewProjectImport, undoAssetMerge } from "../src/project-import"
import { createImportBossSample } from "../script/import-boss-sample"

/**
 * r29c 乙 第 10 件 (r29b recheck): after merging the renamed copies an earlier import left, the plan entries of those copies already named the kept asset by id but
 * still had the key the import renamed them to (`chiyou_dust_shanhai_chiyou_s`). Now an entry the kept one already has is that entry (the copy's goes, and whatever
 * needed it needs the kept one's), and otherwise the copy's entry takes the kept one's game name. Undone, the plan is as it was.
 */

const roots: string[] = []
afterAll(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))))
const ofKind = (project: Project, kind: string) => project.workspace.assets.filter((asset) => asset.module === kind)
const style = { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "火山" }
const entry = (key: string, kind: string, asset: string | null, needs: string[] = []) => ({ key, kind, title: key, brief: `${key} 的说明`, owner: null, needs, out_of_scope: null, asset_id: asset })
const planned = (project: Project, entries: ReturnType<typeof entry>[]) => ({ ...project, blueprint: { request: "做一只 Boss", style, entries, questions: [], revision: 1, state: "confirmed" as const } }) as Project

test("合并重复件时蓝图条目的 key 跟着改成保留那份的；撤销还原", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-merge-keys-"))
  roots.push(root)
  const lava = path.join(root, "lava")
  const main = path.join(root, "main")
  const source = await createImportBossSample(lava, "lava")
  const frost = await createImportBossSample(main, "frost")
  const setting = source.workspace.assets.find((asset) => asset.module === "entity")!
  // The source plans its spark as `spark`, its sound as `lava_roar`, and its boss needing both; the main project plans its own spark as `spark`.
  await saveProject(lava, planned(source, [entry("spark", "particle", ofKind(source, "particle")[0]!.id), entry("lava_roar", "sound", ofKind(source, "sound")[0]!.id), entry("boss", "entity", setting.id, ["spark", "lava_roar"])]), source.revision)
  await saveProject(main, planned(frost, [entry("spark", "particle", ofKind(frost, "particle")[0]!.id)]), frost.revision)
  const plan = await previewProjectImport(lava, main, { picks: [setting.id] })
  const done = await applyProjectImport(lava, main, { picks: [setting.id], expectedRevision: (await openProject(main)).revision, fingerprint: plan.fingerprint, importId: randomUUID() })
  const keys = (project: Project) => project.blueprint!.entries.map((value) => [value.key, value.needs.join("+")])
  // As the import leaves it: the copy of spark under a renamed key, the boss needing it.
  const sparkKey = done.project.blueprint!.entries.find((value) => value.key.startsWith("spark_"))!.key
  expect(keys(done.project)).toEqual([["spark", ""], [sparkKey, ""], ["lava_roar", ""], ["boss", `${sparkKey}+lava_roar`]])
  const pairs = duplicateAssets(done.project, await listProjectImports(main))
  const drops = pairs.filter((pair) => pair.kind === "particle" || pair.kind === "sound").map((pair) => pair.drop.id)
  const merged = await mergeDuplicateAssets(main, { drops, expectedRevision: done.project.revision, mergeId: randomUUID() })
  // The spark copy's entry was the main project's `spark`: it goes, and the boss needs `spark`. The roar copy's takes the kept sound's name.
  expect(keys(merged.project)).toEqual([["spark", ""], ["roar", ""], ["boss", "spark+roar"]])
  expect(merged.project.blueprint!.entries.find((value) => value.key === "roar")!.asset_id).toBe(ofKind(frost, "sound")[0]!.id)
  // No key twice, and no two entries for one asset (what the app refuses a plan for).
  const linked = merged.project.blueprint!.entries.flatMap((value) => (value.asset_id ? [value.asset_id] : []))
  expect(new Set(linked).size).toBe(linked.length)
  expect(new Set(merged.project.blueprint!.entries.map((value) => value.key)).size).toBe(merged.project.blueprint!.entries.length)
  const undone = await undoAssetMerge(main, merged.record.id, merged.project.revision)
  expect(keys(undone.project)).toEqual(keys(done.project))
}, 300000)
