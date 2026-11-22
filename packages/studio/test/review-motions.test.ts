import { expect, test } from "bun:test"
import { MAKING_LIMITS, motionLabel } from "@minemods/mod-core/making"
import { modelBounds } from "@minemods/mod-core/model-bounds"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { posedCorners } from "@minemods/studio-ai/model-motion"
import { lookJob, reviewJob, type LookCell } from "../src/main/look-job"
import { lookCamera, projector } from "../src/renderer/look-camera"

/**
 * The review set looks at every motion, however many there are, and frames a motion by the poses drawn of it:
 * a giant flier with 32 motions (the epic tier's limit) whose wings fold at rest and spread in flight.
 */

const FACES = { north: "#778899", east: "#778899", south: "#778899", west: "#778899", up: "#99aabb", down: "#556677" }
const cube = (name: string, origin: number[], size: number[]) => ({ name, origin, size, faces: FACES, surface_details: [] })
const keys = (rotation: number[][], length = 1) => rotation.map((value, index) => ({ time: (length * index) / Math.max(1, rotation.length - 1), rotation: value }))

/** A body with two long wings, each of many feather boxes, folded up at rest (the built pose is narrow). */
const feathers = (side: 1 | -1, count: number) => Array.from({ length: count }, (_, index) => cube(`feather_${side === 1 ? "l" : "r"}_${index}`, [side * (8 + (index % 30) * 2) - (side === -1 ? 2 : 0), 20 + Math.floor(index / 30), -6 + Math.floor(index / 30) * 0.2], [2, 1, 14]))
const dragon = (count: number, wings = 16) => {
  const names = ["idle", "walk", "hurt", "takeoff", "glide", "bank_left", "bank_right", "dive", "land", "roar", "bite", "tail_whip", "hover", "flap_up", "flap_down", "spin", "perch", "sleep", "wake", "stretch", "scratch", "sneeze", "phase_two", "phase_three", "rage", "breath_in", "breath_out", "stomp", "shake", "turn_left", "turn_right", "retreat", "advance"]
  const moving = ["wing_l", "wing_r"] as const
  const clip = (name: string, index: number) => ({
    name,
    length: 1 + (index % 3) * 0.5,
    loop: index % 2 === 0,
    // Every third motion moves nothing, every motion that does moves the wings out of their folded rest pose by a different amount.
    channels: index % 3 === 2 ? [{ bone: "body", keyframes: keys([[0, 0, 0], [0, 0, 0]]) }] : moving.map((bone) => ({ bone, keyframes: keys([[0, 0, 0], [0, 0, (bone === "wing_l" ? -1 : 1) * (60 + (index % 5) * 6)], [0, 0, 0]]) })),
  })
  return {
    kind: "model" as const,
    ...ModelDesignSchema.parse({
      name: "巨龙",
      budget: "epic",
      texture_size: 256,
      bones: [
        { name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [] },
        { name: "body", parent: "root", pivot: [0, 20, 0], rotation: [0, 0, 0], cubes: [cube("trunk", [-8, 10, -24], [16, 14, 48])] },
        { name: "wing_l", parent: "body", pivot: [8, 22, 0], rotation: [0, 0, 80], cubes: feathers(1, wings * 30) },
        { name: "wing_r", parent: "body", pivot: [-8, 22, 0], rotation: [0, 0, -80], cubes: feathers(-1, wings * 30) },
      ],
      animations: Array.from({ length: count }, (_, index) => clip(names[index] ?? `move_${index}`, index)),
    }),
  }
}
/** A review of the 32-motion dragon takes seconds to measure; the tests that read it share one, with an ability reading its takeoff at half a second. */
const giant = (() => {
  const model = dragon(32)
  let made: ReturnType<typeof reviewJob> | undefined
  return { model, review: () => (made ??= reviewJob(model as ModuleDocument, null, null, null, null, null, { takeoff: [0.5] })) }
})()
const SLOW = 180000
const cells = (made: ReturnType<typeof reviewJob>) => made.job.sheets.flatMap((sheet) => sheet.cells)
const animated = (list: LookCell[]) => list.flatMap((cell) => (cell.kind === "view" && cell.animation !== undefined ? [cell.animation] : []))

test("三十二个动作：每一个都至少看到一次，张数不超过上限，每一张都放得进一张图", () => {
  const { model } = giant
  const made = giant.review()
  expect(made.job.sheets.length).toBeLessThanOrEqual(MAKING_LIMITS.review_sheets)
  expect(new Set(animated(cells(made)))).toEqual(new Set(model.animations.map((motion) => motion.name)))
  for (const sheet of made.job.sheets) expect([sheet.columns * sheet.cell[0] <= MAKING_LIMITS.sheet[0], Math.ceil(sheet.cells.length / sheet.columns) * sheet.cell[1] <= MAKING_LIMITS.sheet[1]]).toEqual([true, true])
  // Nothing is left out, so nothing is named as left out; that the motions share sheets and are thinned is said.
  expect(made.notes.some((note) => note.includes("没有画"))).toBe(false)
  expect(made.notes[0]).toContain("动作有 32 个")
  const phrased = model.animations.filter((motion) => !motion.loop && !["hurt", "death"].includes(motion.name))
  expect(made.facts.filter((line) => line.includes("的节奏")).map((line) => line.split("的节奏")[0])).toEqual(phrased.map((motion) => motionLabel(motion.name)))
  expect(made.facts).toHaveLength(2 * model.animations.length + phrased.length)
}, SLOW)

test("格子按信息分：动得多的、有话可说的动作多拿格子，不动的动作也有一格；整套正好用满上限", () => {
  const { model } = giant
  const shown = animated(cells(giant.review()))
  const count = (name: string) => shown.filter((value) => value === name).length
  // A motion that moves nothing has one telling moment; one that moves the wings has two or more.
  const still = model.animations.filter((_, index) => index % 3 === 2).map((motion) => motion.name)
  const moving = model.animations.filter((_, index) => index % 3 !== 2).map((motion) => motion.name)
  still.forEach((name) => expect(count(name)).toBe(1))
  expect(moving.some((name) => count(name) >= 2)).toBe(true)
  expect(shown.length).toBe((MAKING_LIMITS.review_sheets - 2) * 6)
  // An ability's key moment is on its motion's cell even when the motion has only one: the motion an ability plays is read by it.
  const takeoff = cells(giant.review()).filter((cell) => cell.kind === "view" && cell.animation === "takeoff")
  expect(takeoff.map((cell) => cell.label).join()).toContain("招式的关键一刻")
}, SLOW)

test("动作比格子还多时：把没画的点名，画了的每一个都在", () => {
  // More motions than the schema allows, as the tests of the plain review set do it: copies of motions the document has.
  const base = dragon(32, 1)
  const model = { ...base, animations: [...base.animations, ...Array.from({ length: 38 }, (_, index) => ({ ...base.animations[3]!, name: `extra_${index}` }))] }
  const made = reviewJob(model as ModuleDocument, null)
  const seen = new Set(animated(cells(made)))
  const missing = model.animations.filter((motion) => !seen.has(motion.name))
  expect(seen.size).toBe((MAKING_LIMITS.review_sheets - 2) * 6)
  expect(missing).toHaveLength(70 - seen.size)
  const said = made.notes.find((note) => note.includes("没有画"))!
  expect(said).toBeTruthy()
  // Every motion that was not drawn is in the sentence, and none that was drawn is.
  missing.forEach((motion) => expect(said).toContain(motionLabel(motion.name)))
  ;[...seen].forEach((name) => expect(said).not.toContain(motionLabel(name)))
  expect(made.job.sheets.length).toBeLessThanOrEqual(MAKING_LIMITS.review_sheets)
}, SLOW)

test("镜头按画出来的姿势取景：翅膀张开的那一格整个在画面里，收着的模型本身的取景没有变", () => {
  const model = dragon(8, 2)
  const design = (({ kind: _kind, ...rest }) => rest)(model)
  const size = [MAKING_LIMITS.sheet[0] / 3, MAKING_LIMITS.sheet[1] / 2] as const
  const spread = cells(reviewJob(model as ModuleDocument, null)).filter((cell): cell is Extract<LookCell, { kind: "view" }> => cell.kind === "view" && cell.animation === "takeoff" && cell.time !== undefined)
  expect(spread.length).toBeGreaterThan(0)
  const inside = (cell: Extract<LookCell, { kind: "view" }>) => {
    const project = projector(cell.camera!, size)
    const clip = design.animations.find((motion) => motion.name === cell.animation)!
    return posedCorners(design, clip, cell.time!).map(project).every(([x, y]) => x >= 0 && x <= size[0] && y >= 0 && y <= size[1])
  }
  expect(spread.every((cell) => cell.camera !== undefined)).toBe(true)
  expect(spread.every(inside)).toBe(true)
  // The same pose framed by the folded model alone is cut by the edge of the picture: the frame the review used to give.
  const folded = modelBounds(design)
  const old = lookCamera({ min: folded.min as [number, number, number], max: folded.max as [number, number, number] }, "quarter", size[0] / size[1])
  const project = projector(old, size)
  const peak = spread.find((cell) => cell.time! > 0)!
  const clip = design.animations.find((motion) => motion.name === "takeoff")!
  expect(posedCorners(design, clip, peak.time!).map(project).some(([x, y]) => x < 0 || x > size[0] || y < 0 || y > size[1])).toBe(true)
  // The rest-pose cells and every cell of a motion that stays inside the built pose keep the page's own framing.
  const small = { ...model, animations: [{ name: "idle", length: 1, loop: true, channels: [{ bone: "wing_l", keyframes: keys([[0, 0, 0], [0, 0, 0.01], [0, 0, 0]]) }] }] }
  expect(cells(reviewJob(small as ModuleDocument, null)).every((cell) => !("camera" in cell) || cell.camera === undefined)).toBe(true)
  // A look at one motion is framed the same way, and the travel said of its picture is the travel in that picture.
  const alone = lookJob(model as ModuleDocument, null, { animation: "takeoff" })
  const strip = alone.job.sheets.find((sheet) => sheet.label.includes("takeoff"))!
  expect(strip.cells.every((cell) => cell.kind === "view" || cell.kind === "compare" ? cell.camera !== undefined : true)).toBe(true)
}, SLOW)
