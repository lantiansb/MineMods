import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { effectLookup } from "@minemods/mod-core/effect-abilities"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { lookJob, needJob, type LookCell, type LookJob } from "../src/main/look-job"
import { createDataGameplaySample } from "../../mod-core/script/data-gameplay-sample"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

/** The sample golem: `slam` (hit at 0.7 s, a mark that shows 0.1 to 0.9 s) and `burst` (hits at 1 and 1.3 s, an effect on itself at each), on its model that also has plain motions such as `walk`. */
async function golem() {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-moments-"))
  directories.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"), { life: true, abilities: true, effects: true })
  const of = <Kind extends ModuleDocument["kind"]>(kind: Kind) => project.workspace.assets.flatMap((asset) => (asset.document.kind === kind ? [asset.document as Extract<ModuleDocument, { kind: Kind }>] : []))
  return { effects: effectLookup(project), creature: of("entity")[0]!, model: of("model")[0]! }
}
const hits = (cells: LookCell[]) => cells.flatMap((cell) => (cell.kind === "hit" ? [cell] : []))
/** The scenes that are effects in a cell: the ones its solid and see-through layers hang in the view. */
const parts = (cell: ReturnType<typeof hits>[number]) => [...(cell.extra ?? []), ...(cell.over ?? []).flatMap((layer) => layer.extra ?? [])]

test("a reviewer's need for moments of an ability's motion is answered with the ability at those moments: the creature, the hit shape and the effects standing then", async () => {
  const { creature, model, effects } = await golem()
  // `burst` hits at 1 and 1.3 s and shows an effect on itself with each; 0.2 s is the wind-up, before any effect.
  const times = [0.2, 1, 1.3]
  const asked = needJob(creature, model, [{ what: "motion", name: "burst", times }], effects)
  expect(asked.job.sheets).toHaveLength(1)
  const sheet = asked.job.sheets[0]!
  expect(sheet.label).toContain("和效果一起")
  const cells = hits(sheet.cells)
  expect(cells).toHaveLength(sheet.cells.length)
  // Exactly the moments asked for, every one from more than one side (three moments leave room for two), and no others.
  expect([...new Set(cells.map((cell) => cell.time))].sort()).toEqual(times)
  expect(cells.every((cell) => cell.animation === "burst" && cell.faces.length > 0)).toBe(true)
  // The effects of the moment are scenes of their own, hung in the view of the cells they are standing in; at 0.2 s there are none yet.
  const shown = (time: number) => cells.filter((cell) => cell.time === time).flatMap(parts)
  expect(shown(0.2)).toHaveLength(0)
  expect(shown(1).length).toBeGreaterThan(0)
  expect(shown(1.3).length).toBeGreaterThan(0)
  // They are numbered after the scenes of the thing itself and its bare shape, and every one is there.
  const scenes = asked.job.scenes.length
  expect(scenes).toBeGreaterThan(2)
  cells.flatMap(parts).forEach((part) => {
    expect(part.scene).toBeGreaterThanOrEqual(2)
    expect(part.scene).toBeLessThan(scenes)
  })
  // The hit shape is the nearest hit's: the one at 1 s at 1 s, the one at 1.3 s at 1.3 s.
  expect(cells.find((cell) => cell.time === 1)!.label).toContain("判定）")
  expect(cells.find((cell) => cell.time === 0.2)!.label).toContain("最近一次判定在 1 秒")
  // The same look from the maker's side, with `animation` and `times`, draws the same moments.
  const looked = lookJob(creature, model, { animation: "burst", times }, null, null, null, effects).job.sheets
  expect(looked).toHaveLength(1)
  expect(looked[0]!.cells.map((cell) => (cell.kind === "hit" ? cell.time : null))).toEqual(sheet.cells.map((cell) => (cell.kind === "hit" ? cell.time : null)))
})

test("the moments of an ability are asked for by the motion it plays or by its id, with many moments from one side, with others needs beside it, and past the end of the clip", async () => {
  const { creature, model, effects } = await golem()
  // An ability whose id is not the name of its motion: asked for by the id, it is the motion's sheet all the same.
  const renamed = { ...creature, abilities: creature.abilities!.map((ability) => (ability.id === "slam" ? { ...ability, id: "heavy_blow" } : ability)) }
  const byId = needJob(renamed, model, [{ what: "motion", name: "heavy_blow", times: [0.5, 0.9] }], effects)
  expect(byId.job.sheets[0]!.cells.map((cell) => (cell.kind === "hit" ? cell.time : null))).toEqual([0.5, 0.5, 0.9, 0.9])
  expect(byId.job).toEqual(needJob(renamed, model, [{ what: "motion", name: "slam", times: [0.5, 0.9] }], effects).job)
  // Four or more moments are each drawn once, from a quarter, as a sheet holds six pictures.
  const many = needJob(creature, model, [{ what: "motion", name: "slam", times: [0.1, 0.3, 0.5, 0.7, 0.9, 1.1] }], effects).job.sheets[0]!
  expect(many.cells).toHaveLength(6)
  expect(new Set(hits(many.cells).map((cell) => cell.view))).toEqual(new Set(["quarter"]))
  // A side asked for beside it: its cells keep the scenes of the thing and its bare shape, and the effect scene of the ability does not take the bare shape's place.
  const both = needJob(creature, model, [{ what: "angle", name: "left" }, { what: "motion", name: "slam", times: [0.5] }], effects)
  expect(both.job.sheets.map((value) => value.label.includes("和效果一起"))).toEqual([false, true])
  expect(both.job.sheets[0]!.cells.map((cell) => (cell.kind === "view" ? cell.scene : -1))).toEqual([0, 1])
  const mark = hits(both.job.sheets[1]!.cells).flatMap(parts)
  expect(mark.length).toBeGreaterThan(0)
  mark.forEach((part) => expect(part.scene).toBeGreaterThanOrEqual(2))
  // A moment past the end of the clip (1.2 s) is drawn at the end and says so.
  const late = needJob(creature, model, [{ what: "motion", name: "slam", times: [5] }], effects)
  expect(hits(late.job.sheets[0]!.cells).every((cell) => cell.time === 1.2)).toBe(true)
  expect(late.notes.some((note) => note.includes("只有 1.2 秒"))).toBe(true)
  // Without the project's effects the moments still come with the hit shape, as the creature's own look would draw them.
  const bare = needJob(creature, model, [{ what: "motion", name: "slam", times: [0.5, 0.7] }])
  expect(bare.job.sheets[0]!.cells.map((cell) => (cell.kind === "hit" ? cell.time : null))).toEqual([0.5, 0.5, 0.7, 0.7])
  expect(hits(bare.job.sheets[0]!.cells).every((cell) => cell.faces.length > 0 && parts(cell).length === 0)).toBe(true)
})

test("a motion no ability plays, or an ability's motion asked for without moments, is shown as a motion as it always was", async () => {
  const { creature, model, effects } = await golem()
  const strip = (job: LookJob) => job.sheets.flatMap((value) => value.cells.map((cell) => cell.kind))
  // `walk` is nobody's clip: the same pictures as for a creature that has no abilities at all.
  const walk = needJob(creature, model, [{ what: "motion", name: "walk", times: [0.1, 0.4, 0.8] }], effects)
  expect(walk.job).toEqual(needJob({ ...creature, abilities: [] }, model, [{ what: "motion", name: "walk", times: [0.1, 0.4, 0.8] }], effects).job)
  expect(strip(walk.job).every((kind) => kind === "view" || kind === "compare")).toBe(true)
  expect(walk.job.scenes).toHaveLength(2)
  // More than three moments of a plain motion: the strip.
  const long = needJob(creature, model, [{ what: "motion", name: "walk", times: [0, 0.1, 0.2, 0.3] }], effects)
  expect(long.job.sheets[0]).toMatchObject({ cells: [{}, {}, {}, {}, { kind: "compare" }] })
  // An ability's motion with no moments asked: its pair of directions at the moments the ability is read by, no hit shapes (the maker's and the reviewer's own sets hold those).
  const slam = needJob(creature, model, [{ what: "motion", name: "slam" }], effects)
  expect(strip(slam.job).every((kind) => kind === "view" || kind === "compare")).toBe(true)
  expect(slam.job.scenes).toHaveLength(2)
  // Nothing of it needs the effects to be known.
  expect(needJob(creature, model, [{ what: "motion", name: "slam" }]).job).toEqual(slam.job)
})
