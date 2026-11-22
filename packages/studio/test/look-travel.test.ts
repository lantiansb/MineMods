import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { hitboxBoxes } from "@minemods/mod-core/creature-hitbox"
import { assumedTarget } from "@minemods/mod-core/effect-abilities"
import { TRAVEL_PICTURE_WORDS } from "@minemods/mod-core/making"
import { DEATH_SHEET, lookJob, reviewJob, type LookCell } from "../src/main/look-job"
import { createDataGameplaySample } from "../../mod-core/script/data-gameplay-sample"
import { beastCharge, beastDesign, beastPounce, beastStagger, birdDesign, birdFlight, birdSwoop } from "../../mod-core/test/travel-samples"

/**
 * r29c: an ability that carries the creature is drawn with the creature where it is at every moment (`abilityTravel`), its way and where it is at its first hit marked; the
 * moments it runs into something have cells of their own with what the game shows there; a creature's look with `animation: "death"` draws how it dies and what is left
 * where its body goes; and `angle` is the side a motion is shot from. Two small samples of their own: a bird that stoops and a beast that charges.
 */

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))
type Entity = Extract<ModuleDocument, { kind: "entity" }>
type Model = Extract<ModuleDocument, { kind: "model" }>
const wear = (design: typeof birdDesign) => ({ kind: "model", ...design }) as unknown as Model

/** A creature document of the sample's, made into the given creature. */
async function creature(change: Partial<Entity>): Promise<Entity> {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-travel-"))
  directories.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"), { life: true, abilities: true })
  const found = project.workspace.assets.find((asset) => asset.document.kind === "entity")!.document as Entity
  return { ...found, hitbox: undefined, ...change } as Entity
}
const hits = (cells: LookCell[]) => cells.flatMap((cell) => (cell.kind === "hit" ? [cell] : []))
const blocks = (vector: readonly number[]) => ({ forward: -vector[2]! / 16, up: vector[1]! / 16, left: -vector[0]! / 16 })

test("a stoop is drawn with the bird where it is at every moment: where it gets ready, on its way in, and on the target at its first hit", async () => {
  const bird = await creature({ name: "小鸟", flight: birdFlight, abilities: [birdSwoop], combos: [] })
  const made = lookJob(bird, wear(birdDesign), { animation: "swoop" })
  const cells = hits(made.job.sheets[0]!.cells)
  const at = (cell: LookCell & { kind: "hit" }) => blocks(cell.offset ?? [0, 0, 0])
  // Where it is moves with the moments: up where it gets ready before the charge, then nearer the target the later the moment.
  const byTime = [...cells].sort((a, b) => a.time - b.time)
  expect(new Set(byTime.map((cell) => at(cell).forward.toFixed(2))).size).toBeGreaterThan(1)
  expect(byTime.every((cell, index) => !index || at(cell).forward >= at(byTime[index - 1]!).forward - 1e-9)).toBe(true)
  const ready = byTime.find((cell) => cell.time <= birdSwoop.windup)!
  expect(at(ready).forward).toBe(0)
  expect(at(ready).up).toBeGreaterThan(4)
  // At the first hit it is at the one it hunts (11 blocks ahead, the middle of 6 to 16), its talons' range there with it, and the cell says it is where the yellow box is.
  const struck = cells.filter((cell) => Math.abs(cell.time - 1.4) < 1e-9 && cell.faces.length)
  expect(struck.length).toBeGreaterThan(0)
  for (const cell of struck) {
    expect(at(cell).forward).toBeGreaterThan(assumedTarget(birdSwoop) - 1.5)
    expect(at(cell).forward).toBeLessThan(assumedTarget(birdSwoop) + 0.5)
    expect(cell.label).toContain("黄框")
    const middle = cell.faces.flat().reduce((sum, point) => sum + point[2]!, 0) / cell.faces.flat().length
    expect(Math.abs(-middle / 16 - assumedTarget(birdSwoop))).toBeLessThan(1)
  }
  // Every cell draws its way (dashed yellow) and the box where it is at the first hit.
  expect(cells.every((cell) => cell.trails?.some((trail) => trail.dashed && trail.color === "#ffd400") && cell.trails.some((trail) => !trail.dashed && trail.color === "#ffd400"))).toBe(true)
  const way = cells[0]!.trails!.find((trail) => trail.dashed)!.points
  expect(blocks(way[0]!).forward).toBe(0)
  expect(blocks(way.at(-1)!).forward).toBeGreaterThan(assumedTarget(birdSwoop) - 1.5)
  const said = made.notes.join("\n")
  expect(said).toContain(TRAVEL_PICTURE_WORDS)
  expect(said).toContain("招式「俯冲一爪」会带着它走（俯冲）")
  expect(said).toContain("从哪里飞来要看它原来在哪")
})

test("a charge that runs into a wall has a cell for that moment: the wall it is taken to meet, the dust and the daze there, and the shake", async () => {
  const beast = await creature({ name: "小兽", abilities: [beastCharge], combos: [], stagger: beastStagger })
  const made = lookJob(beast, wear(beastDesign), { animation: "charge" })
  const cells = hits(made.job.sheets.find((sheet) => sheet.label.startsWith("招式「低头冲撞」"))!.cells)
  const wall = cells.find((cell) => cell.label.includes("撞墙那一刻"))!
  expect(wall.label).toContain("1.35 秒")
  expect(wall.label).toContain("灰框是假设的墙")
  // It stands at the end of its 12 blocks, and the wall is just ahead of it.
  expect(blocks(wall.offset!).forward).toBeCloseTo(12, 6)
  // Its front, half the box the game gives it ahead of its middle.
  const core = hitboxBoxes(undefined, beastDesign)[0]!
  const front = 12 + (core.max[0] - core.min[0]) / 32
  const grey = wall.trails!.find((trail) => trail.color === "#9a9a9a")!
  expect(grey.points.every((point) => Math.abs(blocks(point).forward - front) < 1e-6)).toBe(true)
  // 土蝼, r29c: the wall is dashed, so it hides nothing at its face, and specks smaller than 0.3 of a block are drawn that big, with the caption saying how big they are in the game.
  expect(grey.dashed).toBe(true)
  expect(wall.particles!.every((group) => group.size >= 0.3)).toBe(true)
  expect(wall.caption.join("")).toContain("撞点的粒子放大到 0.3 格画")
  // 16 puffs of dust where it hits, 10 sparks of the daze at the middle of its body, and the shake drawn as a mark and a dashed ring 10 blocks round.
  expect(wall.particles!.map((group) => group.points.length)).toEqual([16, 10])
  const ring = wall.trails!.find((trail) => trail.color === "#4db8ff" && trail.dashed)!
  expect(Math.max(...ring.points.map((point) => blocks(point).forward))).toBeCloseTo(front + 10, 3)
  expect(wall.caption.join("")).toContain("循环段撞墙时（第 1.35 秒）")
  expect(wall.caption.join("")).toContain("同一刻进入硬直「wall_daze」时")
  // Who it rams on the way: a cell of its own at the moment its horns reach them, with the one it fights as a white box.
  const rammed = cells.find((cell) => cell.label.includes("冲刺撞到生物那一刻"))!
  expect(rammed.trails!.some((trail) => trail.color === "#ffffff")).toBe(true)
  expect(made.notes.join("\n")).toContain("假设墙就在它冲到头的地方")
  // A leap is carried too: the beast is in the air halfway and down a block short of the one it fights.
  const leaping = lookJob({ ...beast, abilities: [beastPounce] }, wear(beastDesign), { animation: "pounce" })
  const landed = hits(leaping.job.sheets[0]!.cells).find((cell) => Math.abs(cell.time - 1) < 1e-9 && cell.faces.length)!
  expect(blocks(landed.offset!).forward).toBeCloseTo(assumedTarget(beastPounce) - 1, 6)
  // An ability that carries it nowhere is drawn as it always was: nothing moved, no way drawn, no cell of impact.
  const butt = { ...beastCharge, id: "butt", name: "顶", moves: [], stages: undefined }
  const still = hits(lookJob({ ...beast, abilities: [butt] }, wear(beastDesign), { animation: "butt" }).job.sheets[0]!.cells)
  expect(still.every((cell) => cell.offset === undefined && !cell.trails?.some((trail) => trail.color === "#ffd400") && !cell.label.includes("那一刻 "))).toBe(true)
})

test("a look at a creature's death draws its death motion and what is left where its body goes: the puff it is swapped for, or that the game's own is off", async () => {
  const beast = await creature({ name: "小兽", abilities: [beastCharge], combos: [], stagger: beastStagger, builtin: { death_poof: { particle: "soul" } } })
  const made = lookJob(beast, wear(beastDesign), { animation: "death" })
  expect(made.job.sheets.map((sheet) => sheet.label)).toEqual([DEATH_SHEET])
  const cells = made.job.sheets[0]!.cells
  expect(cells.filter((cell) => cell.kind === "view").map((cell) => cell.kind === "view" && cell.time)).toEqual([0, 0.6, 1.2])
  const puff = hits(cells)
  expect(puff.map((cell) => cell.label)).toEqual(["斜前方 · 身体消失的那一刻 1.2 秒", "从上往下 · 身体消失的那一刻 1.2 秒"])
  expect(puff.every((cell) => cell.particles?.[0]?.points.length === 20)).toBe(true)
  // The 20 lie within its box's width (38 pixels: the box the game gives a creature of this model) either side of its middle, and its height (20 pixels).
  expect(puff[0]!.particles![0]!.points.every((point) => Math.abs(point[0]!) <= 38 + 1e-9 && Math.abs(point[2]!) <= 38 + 1e-9 && point[1]! >= 0 && point[1]! <= 20 + 1e-9)).toBe(true)
  expect(made.notes.join("\n")).toContain("身体消失时冒 20 颗")
  const off = lookJob({ ...beast, builtin: { death_poof: { particle: "none" } } }, wear(beastDesign), { animation: "death" })
  expect(hits(off.job.sheets[0]!.cells).every((cell) => !cell.particles)).toBe(true)
  expect(hits(off.job.sheets[0]!.cells)[0]!.label).toContain("原版白烟已关")
  expect(off.notes.join("\n")).toContain("原版白烟已关")
  // The reviewer is given it too when the builtin table changes it.
  const review = reviewJob(beast, wear(beastDesign))
  expect(review.job.sheets.some((sheet) => sheet.label === DEATH_SHEET)).toBe(true)
  expect(review.notes.join("\n")).toContain("身体消失时冒 20 颗")
})

test("an angle asked with a motion is the side the motion is shot from", () => {
  const model = wear(birdDesign)
  const made = lookJob(model, null, { animation: "swoop", angle: "left" })
  const strip = made.job.sheets.find((sheet) => sheet.cells.some((cell) => cell.kind === "view" && cell.animation === "swoop"))!
  expect(strip.cells.filter((cell) => cell.kind === "view" && cell.animation === "swoop").every((cell) => cell.kind === "view" && cell.view === "plus_x")).toBe(true)
  const plain = lookJob(model, null, { animation: "swoop" })
  const usual = plain.job.sheets.find((sheet) => sheet.cells.some((cell) => cell.kind === "view" && cell.animation === "swoop"))!
  expect(usual.cells.some((cell) => cell.kind === "view" && cell.view !== "plus_x")).toBe(true)
  expect(() => lookJob(model, null, { animation: "swoop", angle: "sideways" })).toThrow("没有叫「sideways」的角度")
})
