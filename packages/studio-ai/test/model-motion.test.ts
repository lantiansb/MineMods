import { expect, test } from "bun:test"
import { GAME_PIXELS, MOTION_VISIBLE, measureMotion, type MotionClip } from "../src/model-motion"
import { MOTION_WORDS, motionLine, motionPlain, PartSheetDraftSchema, stillReason, unseenMotions, type MotionNote } from "../src/making"

const faces = { north: "#888888", east: "#888888", south: "#888888", west: "#888888", up: "#888888", down: "#888888" }
// A post that never moves, an arm ten pixels long hinged at the origin, and a hand at the end of the arm.
const bones = [
  { name: "post", parent: null, pivot: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], cubes: [{ name: "post", origin: [-1, 0, -1] as [number, number, number], size: [2, 4, 2] as [number, number, number], faces, surface_details: [] }] },
  { name: "arm", parent: null, pivot: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], cubes: [{ name: "beam", origin: [0, 0, 0] as [number, number, number], size: [10, 1, 1] as [number, number, number], faces, surface_details: [] }] },
  { name: "hand", parent: "arm", pivot: [10, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], cubes: [{ name: "palm", origin: [10, 0, 0] as [number, number, number], size: [2, 1, 1] as [number, number, number], faces, surface_details: [] }] },
]
/** The arm turned about the vertical axis by `degrees` over one second. */
const swing = (degrees: number, loop = false): MotionClip => ({ name: "swing", length: 1, loop, channels: [{ bone: "arm", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [0, degrees, 0] }] }] })
const note = (clip: MotionClip): MotionNote => (({ moments: _moments, from_rest: _rest, mover, ...found }) => ({ ...found, mover: mover?.bone ?? null, cube: mover?.cube ?? null }))(measureMotion({ bones }, clip))

test("量动作：动得最多的角走了多远、是哪个部件、几个部件在动，都从文档里算得出来", () => {
  const found = measureMotion({ bones }, swing(90))
  // The far corner of the hand is hypot(12, 1) from the hinge; a quarter turn carries it the chord of that radius.
  expect(found.travel).toBeCloseTo(Math.hypot(12, 1) * Math.SQRT2, 2)
  expect(found).toMatchObject({ name: "swing", mover: { bone: "hand", cube: "palm" }, between: [0, 1], moving: 2, parts: 3, turn: 90, unseen: false, picture: null, tall: 4 })
  expect(found.from_rest).toBe(found.travel)
  expect(found.game).toBeCloseTo(found.travel * GAME_PIXELS, 0)
  // The moments worth a frame start with the two extremes.
  expect(found.moments.slice(0, 2)).toEqual([0, 1])
  // In a picture: a camera that looks straight down the turning axis at two picture pixels per model pixel sees twice the travel.
  expect(measureMotion({ bones }, swing(90), (point) => [point[0] * 2, point[2] * 2]).picture).toBeCloseTo(found.travel * 2, 0)
  // A full turn between two keys ends where it began and is still a full turn: the widest point is half way round.
  const spin = measureMotion({ bones }, swing(360, true))
  expect([spin.travel, spin.turn, spin.between[1] - spin.between[0]]).toEqual([Number((Math.hypot(12, 1) * 2).toFixed(2)), 360, 0.5])
})

test("看得见的门槛只有一个，按游戏里的屏幕像素算：不到就是看不出来在动，和它是什么无关", () => {
  // One model pixel is about six screen pixels at game size, so the threshold is a third of a model pixel.
  expect(GAME_PIXELS).toBeCloseTo(6.02, 1)
  expect([1.5, 2.5].map((degrees) => [measureMotion({ bones }, swing(degrees)).game < MOTION_VISIBLE.pixels, measureMotion({ bones }, swing(degrees)).unseen])).toEqual([[true, true], [false, false]])
  expect(measureMotion({ bones }, swing(0))).toMatchObject({ travel: 0, mover: null, moving: 0, unseen: true, moments: [] })
  // Said in words: with numbers for whoever makes or reviews, without for the person.
  expect(motionLine(note(swing(1.5)))).toMatch(/^「swing」：动得最多的是「hand」的「palm」，来回最多移动 0\.3 个模型像素（最大的一处转了 1\.5 度），3 个部件里有 2 个在动；.+——不到 2 个屏幕像素，人眼看不出来在动。$/)
  expect(motionPlain(note(swing(1.5)))).toBe("swing：看不出来在动。")
  expect(motionPlain(note(swing(90)))).toBe("swing：看得出在动，动得最多的是「hand」。")
  expect(motionLine(note(swing(0)))).toBe("「swing」：从头到尾没有任何部件在动——看不出来在动。")
})

test("本来就不动的动作：部件说明里声明了并写明理由就不算毛病，而且明说；没声明的要改或者声明", () => {
  const sheet = { still: [{ motion: "swing", reason: "它是一根门闩，关着的时候不动" }] }
  expect(unseenMotions(null, [note(swing(1.5)), note(swing(90))])).toEqual([expect.stringMatching(/^不机械：「swing」看不出来在动（.+不到 2 个）。把它改到看得出来再看一版；如果它本来就该不动，在部件说明的 still 里写上这个动作的名字和理由/)])
  expect(unseenMotions(sheet, [note(swing(1.5))])).toEqual([])
  expect(stillReason(sheet, "swing")).toBe("它是一根门闩，关着的时候不动")
  // The player's word for a motion names it as well as its name in the document.
  expect(stillReason({ still: [{ motion: "待机", reason: "石像" }] }, "idle")).toBe("石像")
  // Written loosely, or as the findings label it (走路（walk）), it is the same declaration: a maker that declared a motion still is heard.
  expect(["Walk", " walk ", "走路", "走路（walk）", "「walk」"].map((written) => stillReason({ still: [{ motion: written, reason: "炮台不走" }] }, "walk"))).toEqual(Array(5).fill("炮台不走"))
  expect(stillReason({ still: [{ motion: "run", reason: "炮台不走" }] }, "walk")).toBeNull()
  const walking = { ...note(swing(1.5)), name: "walk" }
  expect(unseenMotions({ still: [{ motion: "walk", reason: "炮台不走" }] }, [walking])).toEqual([])
  expect(unseenMotions({ still: [{ motion: "走路（walk）", reason: "炮台不走" }] }, [walking])).toEqual([])
  expect(unseenMotions(null, [walking])).toHaveLength(1)
  expect(motionLine(note(swing(1.5)), stillReason(sheet, "swing"))).toEndWith(`部件说明里声明了「${MOTION_WORDS.still}」（它是一根门闩，关着的时候不动），所以不算毛病。`)
  expect(motionPlain(note(swing(1.5)), stillReason(sheet, "swing"))).toBe("swing：看不出来在动——部件说明里写了这个动作本来就不动：它是一根门闩，关着的时候不动")
  // A sheet written before this existed is still a sheet; an AI asked by a strict schema always answers the field.
  const old = { subject: "门", recognisable: ["门闩"], parts: [{ name: "bar", what: "门闩", shape: "长条", attaches: "门上", surface: "木头", moves: "不动", assumed: false }], assumed: [] }
  expect(PartSheetDraftSchema.parse(old).still).toEqual([])
})

test("方块很多的模型：动作取样的时刻一多（缓动、曲线、挂链逐刻模拟），量动作照样算得出来，不因为数字太多而报错", () => {
  // 2026-11-18: a model of some 910 cubes whose motion was sampled at 20 moments could not be looked at. Every corner of every moment was spread into one
  // Math.max call: 150 000 arguments, more than a call may take (RangeError). 12 moments (90 000) passed, so only big models with eased, smoothed or
  // hung motions met it — exactly the ones the epic tier asks for. 1000 cubes and 32 moments here: 256 000 corners.
  const cube = (index: number) => ({ name: `plate_${index}`, origin: [index % 10, Math.floor(index / 10) % 10, Math.floor(index / 100)] as [number, number, number], size: [1, 1, 1] as [number, number, number], faces, surface_details: [] })
  const big = [{ name: "body", parent: null, pivot: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], cubes: Array.from({ length: 1000 }, (_, index) => cube(index)) }]
  // A full turn and back, eased: sampled at every key and between them, up to the most moments a clip is measured at.
  const turning: MotionClip = { name: "turn", length: 4, loop: false, channels: [{ bone: "body", keyframes: Array.from({ length: 17 }, (_, index) => ({ time: index / 4, rotation: [0, index * 45, 0] as [number, number, number], interpolation: "smooth" as const })) }] }
  const found = measureMotion({ bones: big }, turning)
  expect(found.moving).toBe(1)
  // The corner furthest from the turning axis is hypot(10, 10) away from it; half a turn puts it twice that from where it is built (the moments sampled need not hit the half turn exactly).
  expect(found.from_rest).toBeGreaterThan(27)
  expect(found.from_rest).toBeLessThanOrEqual(2 * Math.hypot(10, 10) + 0.01)
  expect(found.travel).toBeGreaterThanOrEqual(found.from_rest)
})

test.skipIf(!Bun.which("node"))("同一个大模型在 Studio 实际跑的引擎（Node 的 V8）里量得出来：那里一次调用能带的参数比这里少，报错只在那里出现", async () => {
  // Bun's engine takes the 256 000 arguments the old line spread into one call; V8, which the packaged worker runs on, refuses them. So the measure is bundled
  // the way the worker is (`bun build --target=node`) and run under node.
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises")
  const os = await import("node:os")
  const path = await import("node:path")
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-big-motion-"))
  try {
    const built = await Bun.build({ entrypoints: [path.join(import.meta.dir, "..", "src", "model-motion.ts")], target: "node", format: "cjs", outdir: root })
    expect(built.success).toBe(true)
    await writeFile(
      path.join(root, "run.cjs"),
      `const { measureMotion } = require("./model-motion.js")
const faces = { north: "#888888", east: "#888888", south: "#888888", west: "#888888", up: "#888888", down: "#888888" }
const cubes = Array.from({ length: 1000 }, (_, index) => ({ name: "plate_" + index, origin: [index % 10, Math.floor(index / 10) % 10, Math.floor(index / 100)], size: [1, 1, 1], faces, surface_details: [] }))
const clip = { name: "turn", length: 4, loop: false, channels: [{ bone: "body", keyframes: Array.from({ length: 17 }, (_, index) => ({ time: index / 4, rotation: [0, index * 45, 0], interpolation: "smooth" })) }] }
const found = measureMotion({ bones: [{ name: "body", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes }] }, clip)
console.log(JSON.stringify({ from_rest: found.from_rest, moments: found.moments.length }))
`,
    )
    const run = Bun.spawnSync(["node", path.join(root, "run.cjs")])
    expect(run.stderr.toString()).toBe("")
    expect(JSON.parse(run.stdout.toString()).from_rest).toBeGreaterThan(27)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60000)
