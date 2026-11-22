import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { abilityPlace } from "@minemods/mod-core/creature-abilities"
import { diveFrame, effectLookup } from "@minemods/mod-core/effect-abilities"
import { AbilitySchema, type Ability } from "@minemods/mod-core/entity-runtime"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { dragonAnchoredAbilities, dragonDesign, dragonFlight } from "../../mod-core/test/giant-flier"
import { lookJob, type LookCell } from "../src/main/look-job"
import { abilityTravel, travelAt } from "@minemods/mod-core/ability-travel"
import { hitboxBoxes } from "@minemods/mod-core/creature-hitbox"
import { createDataGameplaySample } from "../../mod-core/script/data-gameplay-sample"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

type Model = Extract<ModuleDocument, { kind: "model" }>

/** The sample whose golem shows two effects while it fights, with its documents. */
async function showing() {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-staging-"))
  directories.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"), { life: true, abilities: true, effects: true })
  const of = <Kind extends ModuleDocument["kind"]>(kind: Kind) => project.workspace.assets.flatMap((asset) => (asset.document.kind === kind ? [{ id: asset.id, document: asset.document as Extract<ModuleDocument, { kind: Kind }> }] : []))
  return { project, effects: effectLookup(project), creature: of("entity")[0]!, model: of("model")[0]!, mark: of("effect")[0]!, spike: of("effect")[1]! }
}
const hitCells = (cells: LookCell[]) => cells.flatMap((cell) => (cell.kind === "hit" ? [cell] : []))
const together = (made: ReturnType<typeof lookJob>) => hitCells(made.job.sheets.find((sheet) => sheet.label.includes("和效果一起"))!.cells)

// ---- A: an effect is a scene of its own ----

test("an effect far from the creature, and one on a creature that fills its tier, are drawn: each is a scene of its own at its own offset, none is dropped", async () => {
  const { creature, model, mark, effects } = await showing()
  const slam = creature.document.abilities![0]!
  // The target is taken to stand 31 blocks ahead (the middle of 30 to 32), twice what a model document reaches from its middle (16 blocks), and the mark is put there.
  const far = { ...creature.document, abilities: [{ ...slam, start: { ...slam.start, min_distance: 30, max_distance: 32 }, events: slam.events.map((event) => (event.type === "effect" ? { ...event, where: "target" as const, hit: 0 } : event)) }] }
  const made = lookJob(far, model.document, { animation: "slam" }, null, null, null, effects)
  // Day and night particle samples on this sheet can fall outside the effect’s lifetime.
  const cells = together(made).filter((cell) => cell.light === undefined)
  expect(made.notes.filter((note) => note.includes("放不下"))).toEqual([])
  const placed = cells.flatMap((cell) => cell.over?.flatMap((layer) => layer.extra ?? []) ?? [])
  expect(placed.length).toBe(cells.length)
  // 31 blocks ahead is -31 * 16 on the viewport's Z, and the scene it hangs is the effect's own, small model.
  expect(placed.every((part) => Math.abs(part.offset[2] + 31 * 16) < 1e-6 && part.offset[0] === 0)).toBe(true)
  const scene = made.job.scenes[placed[0]!.scene]!
  expect(scene.design.bones.length).toBe(mark.document.bones.length + 1)
  expect(scene.design.bones.every((bone) => bone.cubes.every((cube) => cube.origin.every((value) => Math.abs(value) <= 256)))).toBe(true)
  // The frame still holds it: the camera of its "fullest" picture reaches the 31 blocks out.
  expect(Math.max(...cells.map((cell) => Math.hypot(...cell.camera.position.map((value, axis) => value - cell.camera.target[axis]!))))).toBeGreaterThan(31 * 16)

  // A creature whose model already holds as many cubes as its tier allows (256): the old single document had no room for one more.
  const filled = { ...model.document, bones: [...model.document.bones, { name: "filler", parent: model.document.bones[0]!.name, pivot: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], cubes: Array.from({ length: 256 - model.document.bones.reduce((sum, bone) => sum + bone.cubes.length, 0) }, (_, index) => ({ name: `bit${index}`, origin: [index % 16, Math.floor(index / 16) % 16, 0] as [number, number, number], size: [1, 1, 1] as [number, number, number], faces: { north: "#808080", east: "#808080", south: "#808080", west: "#808080", up: "#808080", down: "#808080" }, surface_details: [] })) }] } as Model
  expect(filled.bones.reduce((sum, bone) => sum + bone.cubes.length, 0)).toBe(256)
  const crowded = lookJob(creature.document, filled, { animation: "burst" }, null, null, null, effects)
  const crowd = together(crowded).filter((cell) => cell.light === undefined)
  expect(crowded.notes.filter((note) => note.includes("放不下"))).toEqual([])
  expect(crowd.some((cell) => (cell.extra?.length ?? 0) === 12)).toBe(true)
  expect(crowd.every((cell) => cell.extra!.every((part) => crowded.job.scenes[part.scene]!.design.bones.length > 1))).toBe(true)
})

// ---- C: a dive is drawn and measured where it strikes ----

/** A dive of the giant flier whose two feet strike at 1 second, on a 12-to-24-block start (the target is taken to stand 18 blocks ahead), showing the sample's mark at the target. */
const claws = (mark: string, change: (event: Ability["events"][number]) => Ability["events"][number] = (event) => event): Ability =>
  AbilitySchema.parse({
    ...dragonAnchoredAbilities[3],
    id: "dive_claw",
    name: "俯冲抓击",
    clip: "stoop",
    windup: 0.5,
    length: 1.4,
    start: { min_distance: 12, max_distance: 24, line_of_sight: true, cooldown: 4, weight: 3 },
    hits: ["leg_front_left", "leg_front_right"].map((bone) => ({ type: "area", at: 1, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 2.3 }, hits: "everyone", damage: 10, knockback: 1, effects: [], bone })),
    events: [0.2, 0.8].map((at) => change({ type: "effect", at, effect: mark, where: "target", hit: null, forward: 0, up: 0, left: 0, count: 1, layout: "ring", spread: 0 })),
  })

test("a dive is drawn with the creature and its hit where it strikes, and the effects at the target are measured inside the hit", async () => {
  const { creature, mark, effects } = await showing()
  const wears = { kind: "model", ...dragonDesign } as unknown as Model
  const ability = claws(mark.id)
  const dive = diveFrame(ability, dragonDesign)!
  expect(dive.arrives).toBe(20)
  const document = { ...creature.document, flight: dragonFlight, abilities: [ability] }
  const made = lookJob(document, wears, { animation: "dive_claw" }, null, null, null, effects)
  const cells = together(made)
  const lift = abilityPlace(dive.shift.forward, dive.shift.up, dive.shift.left)
  // The feet are brought to the target: the creature is 18 blocks short of it by where its feet reach, and the cells from the first hit on stand it there; the hit is drawn there all the time.
  expect(lift[2]).toBeLessThan(-14 * 16)
  const struck = cells.filter((cell) => cell.time >= 1)
  const winding = cells.filter((cell) => cell.time < 1)
  expect(struck.length).toBeGreaterThan(0)
  expect(struck.every((cell) => cell.offset?.every((value, axis) => Math.abs(value - lift[axis]!) < 1e-9))).toBe(true)
  // Before the first hit it is where the game has it then (r29c, `abilityTravel`): getting ready, still above where it began at the height it gets ready at (one of the effects is at its
  // fullest at 0.5 seconds, the end of getting ready, before the charge has moved it), and the red range already lies where the hit will land.
  const core = hitboxBoxes(document.hitbox, dragonDesign)[0]!
  const travel = abilityTravel(ability, { design: dragonDesign, flight: dragonFlight, abilities: [ability], height: (core.max[1] - core.min[1]) / 16 })!
  const there = (time: number) => ((place) => abilityPlace(place.forward, place.up, place.left))(travelAt(travel, time))
  expect(winding.length).toBeGreaterThan(0)
  expect(winding.every((cell) => cell.offset?.every((value, axis) => Math.abs(value - there(cell.time)[axis]!) < 1e-9))).toBe(true)
  expect(winding.filter((cell) => cell.time <= 0.5).every((cell) => cell.offset![0] === 0 && cell.offset![2] === 0 && cell.offset![1] > 0)).toBe(true)
  // r29c: the picture of the creature alone draws the hit where it lands too, as the game counts it.
  const alone = hitCells(made.job.sheets.find((sheet) => sheet.label.includes("只看生物的动作"))!.cells).filter((cell) => cell.faces.length)
  const at = (cell: LookCell) => cell.kind === "hit" ? cell.faces[0]![0]! : [0, 0, 0]
  expect(at(struck[0]!)[2]! - at(alone[0]!)[2]!).toBeCloseTo(0, 6)
  expect(at(winding[0]!)[2]! - at(alone[0]!)[2]!).toBeCloseTo(0, 6)
  // The effects stand at the target (18 blocks straight ahead), none dropped.
  expect(made.notes.filter((note) => note.includes("放不下"))).toEqual([])
  const parts = cells.flatMap((cell) => cell.over?.flatMap((layer) => layer.extra ?? []) ?? [])
  expect(parts.length).toBeGreaterThan(0)
  expect(parts.every((part) => Math.abs(part.offset[2] + 18 * 16) < 1e-6)).toBe(true)
  // What is said of them is said in the frame they are drawn in: the middle of the mark lies in the range, and the sentence does not claim a gap that is not there in the game.
  const said = made.notes.join("\n")
  expect(said).toContain("中心都在第 1 次出手的判定范围里")
  expect(said).not.toMatch(/中心离第 1 次出手的判定范围 \d/)
  expect(said).toContain("是俯冲")
  // Not a dive: nothing moves (the golem's own slam is drawn as it always was).
  const own = await showing()
  const slam = lookJob(own.creature.document, own.model.document, { animation: "slam" }, null, null, null, own.effects)
  expect(together(slam).every((cell) => cell.offset === undefined)).toBe(true)
})

// ---- B: captions say a sentence once, and the notes hold every sentence ----

test("two events that say the same thing are one sentence with a count, in the cell and in the notes; the notes hold every sentence a cell writes", async () => {
  const { creature, mark, effects } = await showing()
  const wears = { kind: "model", ...dragonDesign } as unknown as Model
  // The left and the right claw each lay the same mark at the same moment: word for word the same sentences.
  const ability = claws(mark.id, (event) => ({ ...event, at: 0.8 }))
  const made = lookJob({ ...creature.document, flight: dragonFlight, abilities: [ability] }, wears, { animation: "dive_claw" }, null, null, null, effects)
  const cells = together(made)
  const caption = cells.flatMap((cell) => cell.caption)
  expect(caption.filter((line) => line.includes("在第 0.8 秒出现"))).toHaveLength(1)
  expect(caption.find((line) => line.includes("在第 0.8 秒出现"))).toEndWith("（同样的有 2 处）")
  for (const cell of cells) expect(new Set(cell.caption).size).toBe(cell.caption.length)
  expect(new Set(made.notes).size).toBe(made.notes.length)
  expect(made.notes.filter((note) => note.includes("在第 0.8 秒出现"))).toHaveLength(1)
  // Every sentence written under any cell of the look is in the notes, whole (the count is only the cell's).
  const sheets = made.job.sheets.flatMap((sheet) => hitCells(sheet.cells))
  const said = made.notes.join("\n")
  for (const sentence of sheets.flatMap((cell) => cell.caption.map((line) => line.replace(/（同样的有 \d+ 处）$/, "")))) expect(said).toContain(sentence)
  // A caption holding more than the cell may show is cut by the page (`captionLayout`); what is cut is in these notes.
  expect(sheets.some((cell) => cell.caption.length > 0)).toBe(true)
})
