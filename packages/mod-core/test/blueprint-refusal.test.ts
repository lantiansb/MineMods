import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildProjectOverview } from "../src/asset-overview"
import { clearRefusal, noteRefusal, PlanRefusalSchema, readRefusal, refusalView, type PlanRefusal } from "../src/blueprint-refusal"
import { chooseIdeas, planStored, requireOnly } from "../src/blueprint-ideas"
import { createProject } from "../src/project"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-refusal-"))
  directories.push(root)
  const directory = path.join(root, "project")
  return { directory, project: await createProject({ directory, name: "蓝晶" }) }
}

const sentence = "做一种蓝晶矿，挖出来能做蓝晶剑，剑现在只能是普通物品，不要爆炸"
const refusal = (extra: Partial<PlanRefusal> = {}): PlanRefusal => ({
  at: "2026-10-14T01:00:00.000Z",
  by: "outside",
  why: "这份蓝图和你说过的要求对不上，所以没有保存。你说过「剑现在只能是普通物品」，但是「蓝晶剑」：它被做成了武器。",
  about: "requirement",
  constraint: "c1",
  words: "剑现在只能是普通物品",
  titles: ["蓝晶", "蓝晶剑"],
  against: null,
  ...extra,
})

test("被退回的蓝图记在工程旁边：读得回，被下一次退回换掉，存下蓝图或重新开始就清掉；坏掉的记录当作没有", async () => {
  const f = await fixture()
  expect(await readRefusal(f.directory)).toBeNull()
  await noteRefusal(f.directory, refusal())
  expect(await readRefusal(f.directory)).toEqual(refusal())
  await noteRefusal(f.directory, refusal({ about: "playable", constraint: null, why: "有东西没交代怎么玩。" }))
  expect(await readRefusal(f.directory)).toMatchObject({ about: "playable", constraint: null })
  await clearRefusal(f.directory)
  expect(await readRefusal(f.directory)).toBeNull()
  // Clearing what is not there is not an error.
  await clearRefusal(f.directory)
  // A record that is not one is refused where it is written and read as nothing.
  await expect(noteRefusal(f.directory, { ...refusal(), why: "" })).rejects.toThrow()
  expect(PlanRefusalSchema.safeParse({ ...refusal(), extra: 1 }).success).toBe(false)
})

test("页面看到的退回：原因原样，说的是哪一条要求（现在是什么样），退回以后人改过要求就标出来", () => {
  const stored = planStored(requireOnly(null, { request: sentence, by: "outside", quotes: ["剑现在只能是普通物品"] }))
  expect(refusalView(null, stored)).toBeNull()
  const view = refusalView(refusal(), stored)!
  expect(view).toMatchObject({ why: refusal().why, about: "requirement", titles: ["蓝晶", "蓝晶剑"], constraint: { id: "c1", text: "剑现在只能是普通物品", lifted: false, reworded_into: null, recorded: true }, settled: false })
  // No list at all (the plan came with none): the reason is still there, pointing at nothing.
  expect(refusalView(refusal(), null)).toMatchObject({ why: refusal().why, constraint: { id: "c1", text: "剑现在只能是普通物品", recorded: false }, settled: false })
  expect(refusalView(refusal({ words: null }), null)).toMatchObject({ constraint: null })

  // The person rewords the very requirement it is about, after the refusal: the card to go to is the new one, and the reason may be stale.
  const later = (kind: "reword" | "lift") => chooseIdeas(stored, { revision: stored.revision, ...(kind === "reword" ? { reword: [{ id: "c1", text: "剑可以有一点攻击力" }] } : { lift: ["c1"] }) })
  const reworded = later("reword")
  const after = { ...refusal({ at: "2000-01-01T00:00:00.000Z" }) }
  expect(refusalView(after, reworded)).toMatchObject({ constraint: { id: "c1", lifted: true, reworded_into: "c3" }, settled: true })
  expect(refusalView(after, later("lift"))).toMatchObject({ constraint: { id: "c1", lifted: true, reworded_into: null }, settled: true })
  // A refusal newer than every change is not settled by them.
  expect(refusalView(refusal({ at: "2999-01-01T00:00:00.000Z" }), reworded)!.settled).toBe(false)
})

test("总览带着退回的原因：没有存下的蓝图时 blueprint 是空的，plan_refusal 仍在", async () => {
  const f = await fixture()
  const stored = planStored(requireOnly(null, { request: sentence, by: "outside", quotes: [] }))
  const view = refusalView(refusal(), stored)
  const shown = buildProjectOverview({ project: f.project, runs: [], build: null, verification: null, production: null, producing: false, refusal: view })
  expect(shown.blueprint).toBeNull()
  expect(shown.plan_refusal).toMatchObject({ why: refusal().why, about: "requirement", constraint: { id: "c1" } })
  expect(buildProjectOverview({ project: f.project, runs: [], build: null, verification: null, production: null, producing: false }).plan_refusal).toBeNull()
})
