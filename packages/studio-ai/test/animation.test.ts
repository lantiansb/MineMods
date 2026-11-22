import { expect, test } from "bun:test"
import { ANIMATION_CONTRACT, ANIMATION_GUIDE, ANIMATION_LIMITS, BAKE_TOLERANCE, BAKED_LIMITS, INTERPOLATIONS, bakedCounts, bakedLine, bakeFitted, bakeTrack, clipCursor, sampleBone, sampleTrack, usesContract2, type Clip, type TrackKey } from "../src/animation"
import { ModelDesignJsonSchema, ModelDesignSchema } from "../src/contracts"
import { motionLine, type MotionNote } from "../src/making"
import { MODEL_ART_DIRECTION, reviewModelQuality } from "../src/model-quality"
import { measureMotion, posedCorners, type MotionClip } from "../src/model-motion"
import { SCRIPT_DENIED, SCRIPT_GUIDE, SCRIPT_LIMITS, scriptApi } from "../src/script"
import { designFixture } from "./fixture"

type Vec = [number, number, number]
const keys = (list: [number, number, TrackKey["interpolation"]?][]): TrackKey[] => list.map(([time, value, interpolation]) => ({ time, value: [value, 0, 0], interpolation }))
const at = (track: TrackKey[], time: number, loop = false) => sampleTrack(track, time, loop)![0]

test("契约：版本、三种轨道、三种插值；不带新字段的旧文档原样通过", () => {
  expect(ANIMATION_CONTRACT).toBe(3)
  expect([...INTERPOLATIONS]).toEqual(["linear", "step", "smooth", "bezier"])
  const old = designFixture()
  expect(ModelDesignSchema.parse(old)).toEqual(old)
  expect(old.animations.some(usesContract2)).toBe(false)
  const full = { ...old, animations: old.animations.map((clip) => ({ ...clip, channels: [{ bone: "root", keyframes: [], position: [{ time: 0, position: [0, 1, 0] as Vec, interpolation: "smooth" as const }], scale: null }] })) }
  expect(ModelDesignSchema.parse(full)).toEqual(full)
  expect(full.animations.every(usesContract2)).toBe(true)
  const broken = (channel: unknown) => ModelDesignSchema.safeParse({ ...old, animations: old.animations.map((clip) => ({ ...clip, channels: [channel] })) }).success
  // A channel with no key anywhere, a key beyond the limits, times that do not increase, a word that is not an interpolation.
  expect(broken({ bone: "root", keyframes: [] })).toBe(false)
  expect(broken({ bone: "root", keyframes: [], position: [{ time: 0, position: [0, ANIMATION_LIMITS.position + 1, 0] }] })).toBe(false)
  expect(broken({ bone: "root", keyframes: [], scale: [{ time: 0, scale: [1, -0.1, 1] }] })).toBe(false)
  expect(broken({ bone: "root", keyframes: [], scale: [{ time: 0.5, scale: [1, 1, 1] }, { time: 0.5, scale: [2, 1, 1] }] })).toBe(false)
  expect(broken({ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0], interpolation: "bouncy" }] })).toBe(false)
  // A strict JSON-schema caller sends every key and null for "not used".
  const channel = JSON.stringify(ModelDesignJsonSchema)
  expect(channel).toContain('"position"')
  expect(channel).toContain('"interpolation"')
})

test("采样：直线、保持、曲线，首尾保持，循环绕回", () => {
  const straight = keys([[0, 0], [1, 10], [2, 0]])
  expect([at(straight, 0), at(straight, 0.5), at(straight, 1), at(straight, 1.5), at(straight, 5), at(straight, -1)]).toEqual([0, 5, 10, 5, 0, 0])
  // Held until the next key, where it jumps.
  const held = keys([[0, 0, "step"], [1, 10], [2, 0]])
  expect([at(held, 0), at(held, 0.999), at(held, 1), at(held, 1.5)]).toEqual([0, 0, 10, 5])
  // Starts late: its first value is held before its first key.
  expect(at(keys([[0.5, 4], [1, 8]]), 0.1)).toBe(4)
  // A smooth key curves the segment that arrives at it and the one that leaves it; a step key before it still holds.
  const curved = keys([[0, 0], [1, 10, "smooth"], [2, 0], [3, 0]])
  // Uniform Catmull-Rom through 0, 0, 10, 0 (the missing neighbour is the end itself), half way.
  expect(at(curved, 0.5)).toBeCloseTo(0.5 * (5 + 10 - 3.75), 9)
  expect(at(curved, 1)).toBe(10)
  expect(at(curved, 1.5)).not.toBe(5)
  expect(at(curved, 2.5)).toBe(0)
  expect(at(keys([[0, 0, "step"], [1, 10, "smooth"], [2, 0]]), 0.5)).toBe(0)
  // A curve overshoots the straight line between its keys; a line never does.
  const hump = keys([[0, 0, "smooth"], [1, 10, "smooth"], [2, 10, "smooth"], [3, 0, "smooth"]])
  expect(at(hump, 1.5)).toBeGreaterThan(10)
  // In a loop of three or more keys the curve's ends look round the other end: the turn-over has no corner.
  const round = keys([[0, 0, "smooth"], [1, 10, "smooth"], [2, 0, "smooth"]])
  const slope = (loop: boolean, from: number, to: number) => (at(round, to, loop) - at(round, from, loop)) / (to - from)
  expect(slope(true, 0, 0.001)).toBeCloseTo(-slope(true, 1.999, 2), 1)
  expect(Math.abs(slope(true, 0, 0.001))).toBeLessThan(0.1)
  expect(slope(false, 0, 0.001)).toBeGreaterThan(4)
  // The clip's own clock.
  expect([clipCursor({ length: 2, loop: true }, 2.5), clipCursor({ length: 2, loop: true }, -0.5), clipCursor({ length: 2, loop: false }, 2.5), clipCursor({ length: 2, loop: false }, -1)]).toEqual([0.5, 1.5, 2, 0])
})

test("sampleBone：一根骨骼在某一刻的转动、位移、缩放；没写的轨道是搭好时的样子", () => {
  const clip: Clip = {
    length: 2,
    loop: true,
    channels: [
      { bone: "a", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 2, rotation: [20, 0, 0] }] },
      { bone: "b", keyframes: [], position: [{ time: 0, position: [0, 0, 0] }, { time: 1, position: [0, 4, 0] }], scale: [{ time: 0, scale: [1, 1, 1], interpolation: "step" }, { time: 1, scale: [2, 2, 2] }] },
    ],
  }
  expect(sampleBone(clip, "a", 1)).toEqual({ rotation: [10, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] })
  expect(sampleBone(clip, "a", 2.5)!.rotation).toEqual([5, 0, 0])
  expect(sampleBone(clip, "b", 0.5)).toEqual({ rotation: [0, 0, 0], position: [0, 2, 0], scale: [1, 1, 1] })
  expect(sampleBone(clip, "b", 1.5)).toEqual({ rotation: [0, 0, 0], position: [0, 4, 0], scale: [2, 2, 2] })
  expect(sampleBone(clip, "nobody", 1)).toBeUndefined()
})

test("导出用的轨道：直线原样，保持写成 pre/post，曲线切成贴着它走的直线段", () => {
  const straight = keys([[0, 0], [0.5, 10], [1.5, 0]])
  expect(bakeTrack(straight, false, BAKE_TOLERANCE.rotation)).toEqual(straight.map((key) => ({ time: key.time, value: [...key.value] })))
  expect(bakeTrack(keys([[0, 0, "step"], [1, 10], [2, 0]]), false, 0.1)).toEqual([{ time: 0, value: [0, 0, 0] }, { time: 1, value: [10, 0, 0], pre: [0, 0, 0] }, { time: 2, value: [0, 0, 0] }])
  ;([["rotation", [[0, 0, "smooth"], [0.4, 60, "smooth"], [1, -45, "smooth"], [1.3, -45], [2, 0, "smooth"]]], ["position", [[0, 0, "smooth"], [0.3, 5, "smooth"], [1, -3]]], ["scale", [[0, 1, "smooth"], [0.2, 1.4, "smooth"], [0.5, 0.7, "smooth"]]]] as const).forEach(([track, list]) => {
    const curve = keys(list.map((entry) => [...entry]) as [number, number, TrackKey["interpolation"]?][])
    ;[false, true].forEach((loop) => {
      const baked = bakeTrack(curve, loop, BAKE_TOLERANCE[track])
      // Every key as written is still there, and the times still increase.
      expect(curve.every((key) => baked.some((piece) => piece.time === key.time && piece.value[0] === key.value[0]))).toBe(true)
      expect(baked.every((piece, index) => index === 0 || piece.time > baked[index - 1]!.time)).toBe(true)
      const pieces = baked.map((piece) => ({ time: piece.time, value: piece.value }))
      const gap = Math.max(...Array.from({ length: 2001 }, (_, step) => (curve.at(-1)!.time * step) / 2000).map((time) => Math.abs(at(curve, time, loop) - at(pieces, time))))
      expect(gap).toBeLessThanOrEqual(BAKE_TOLERANCE[track] + 1e-4)
      expect(baked.length).toBeLessThan(200)
    })
  })
})

const faces = { north: "#888888", east: "#888888", south: "#888888", west: "#888888", up: "#888888", down: "#888888" }
const bones = [
  { name: "post", parent: null, pivot: [0, 0, 0] as Vec, rotation: [0, 0, 0] as Vec, cubes: [{ name: "post", origin: [-1, 0, -1] as Vec, size: [2, 4, 2] as Vec, faces, surface_details: [] }] },
  { name: "arm", parent: "post", pivot: [0, 4, 0] as Vec, rotation: [0, 0, 90] as Vec, cubes: [{ name: "beam", origin: [0, 4, 0] as Vec, size: [10, 1, 1] as Vec, faces, surface_details: [] }] },
  { name: "hand", parent: "arm", pivot: [10, 4, 0] as Vec, rotation: [0, 0, 0] as Vec, cubes: [{ name: "palm", origin: [10, 4, 0] as Vec, size: [2, 2, 2] as Vec, faces, surface_details: [] }] },
]

test("量动作用的是完整的变换：只挪、只缩放的动作也量得出来，位移跟着上一级骨骼的轴", () => {
  const slide: MotionClip = { name: "slide", length: 1, loop: false, channels: [{ bone: "hand", keyframes: [], position: [{ time: 0, position: [0, 0, 0] }, { time: 1, position: [6, 0, 0] }] }] }
  const found = measureMotion({ bones }, slide)
  expect(found).toMatchObject({ travel: 6, mover: { bone: "hand", cube: "palm" }, moving: 1, turn: 0, shift: 6, stretch: 0, unseen: false })
  // The arm is built turned a quarter about Z, so "along the arm's X" is straight up or down on the picture, not sideways.
  const moved = posedCorners({ bones }, slide, 1).at(-1)!.map((value, axis) => value - posedCorners({ bones }, null).at(-1)![axis]!)
  expect([Math.abs(moved[0]!) < 1e-9, Math.abs(Math.abs(moved[1]!) - 6) < 1e-9, Math.abs(moved[2]!) < 1e-9]).toEqual([true, true, true])
  const swell: MotionClip = { name: "swell", length: 1, loop: false, channels: [{ bone: "hand", keyframes: [], scale: [{ time: 0, scale: [1, 1, 1] }, { time: 1, scale: [2, 2, 2] }] }] }
  // The corner of the palm furthest from the hand's pivot is hypot(2, 2, 2) away and ends twice as far.
  expect(measureMotion({ bones }, swell)).toMatchObject({ travel: Number(Math.hypot(2, 2, 2).toFixed(2)), turn: 0, shift: 0, stretch: 1, mover: { bone: "hand" } })
  // A curve reaches further between two keys than at either of them, and that is found.
  const hump: MotionClip = { name: "hump", length: 3, loop: false, channels: [{ bone: "hand", keyframes: [], position: [{ time: 0, position: [0, 0, 0], interpolation: "smooth" }, { time: 1, position: [4, 0, 0], interpolation: "smooth" }, { time: 2, position: [4, 0, 0], interpolation: "smooth" }, { time: 3, position: [0, 0, 0], interpolation: "smooth" }] }] }
  expect(measureMotion({ bones }, hump).travel).toBeGreaterThan(4.2)
  // The sentence said with the pictures names what moved it.
  const note: MotionNote = { name: "slide", travel: found.travel, mover: "hand", cube: "palm", between: found.between, moving: 1, parts: 3, turn: 0, shift: found.shift, game: found.game, picture: null, tall: found.tall, unseen: false }
  expect(motionLine(note)).toContain("位移轨道最多挪 6 个模型像素")
})

test("验收的量法：只靠位移或缩放动起来的待机和受伤，不算“完全不动”", () => {
  const design = designFixture()
  const moving = (channel: object) => ({ ...design, animations: design.animations.map((clip) => ({ ...clip, channels: [channel as (typeof clip.channels)[number]] })) })
  const ids = (value: ReturnType<typeof moving>) => reviewModelQuality(ModelDesignSchema.parse(value)).findings.map((finding) => finding.rule)
  const still = ids(moving({ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [0, 0.2, 0] }] }))
  expect(still).toEqual(expect.arrayContaining(["idle_still", "hurt_still"]))
  const bob = ids(moving({ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [0, 0.2, 0] }], position: [{ time: 0, position: [0, 0, 0] }, { time: 0.2, position: [0, 1, 0], interpolation: "smooth" }, { time: 0.5, position: [0, 0, 0] }] }))
  expect(bob).not.toContain("idle_still")
  expect(bob).not.toContain("hurt_still")
})

test("给 AI 的说明：轨道、单位、方向、插值、按量出来的事实判断；没有任何动法", () => {
  ;[SCRIPT_GUIDE, MODEL_ART_DIRECTION].forEach((guide) => expect(guide).toContain(ANIMATION_GUIDE))
  ;["rotation", "position", "scale", "linear", "step", "smooth", "模型像素", "+X 朝它自己的左边", "-Z 向前", "motion_facts", "屏幕像素"].forEach((word) => expect(ANIMATION_GUIDE).toContain(word))
  // No subject and no recipe: none of the words the medium refuses to know, and no advice on what to move when.
  const denied = SCRIPT_DENIED.filter((word) => !["scale", "scales"].includes(word))
  expect(denied.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(ANIMATION_GUIDE))).toEqual([])
  ;["腿", "翅", "脚", "身体", "脑袋", "尾巴", "蓄力", "回弹", "应该先", "要先"].forEach((word) => expect(ANIMATION_GUIDE).not.toContain(word))
})

const kit = () => scriptApi({ wears: null, limits: SCRIPT_LIMITS })
type Written = { animations: { name: string; length: number; loop: boolean; channels: { bone: string; keyframes: { time: number; rotation: Vec; interpolation?: string }[]; position?: { time: number; position: Vec; interpolation?: string }[]; scale?: { time: number; scale: Vec; interpolation?: string }[] }[] }[] }
const built = (body: (m: ReturnType<ReturnType<typeof kit>["api"]["model"]>, api: ReturnType<typeof kit>["api"]) => void) => {
  const made = kit()
  const m = made.api.model({ name: "row" })
  m.bone("root").cube("slab", { origin: [-4, 0, -4], size: [8, 1, 8], color: "#808080" })
  m.chain("link", { parent: "root", points: [[0, 1, 0], [0, 5, 0], [0, 9, 0], [0, 13, 0]], sizes: () => [2, 2], color: "#a0a0a0" })
  ;["walk", "hurt"].forEach((name) => m.animation(name, { length: 1, loop: name !== "hurt" }).key("root", 0, [0, 0, 0]))
  body(m, made.api)
  return ModelDesignSchema.parse((({ kind: _kind, ...design }) => design)(JSON.parse(made.finish(m.document())).value as { kind: string } & Written)) as unknown as Written
}

test("脚本：任何一种轨道的关键帧、按时间函数取样、每个关键帧的走法", () => {
  const design = built((m) => {
    const a = m.animation("idle", { length: 2, loop: true })
    a.key("link_1", 0, [0, 0, 10])
    a.key("link_1", 1, [0, 2, 0], { track: "position", interpolation: "smooth" })
    a.keys("link_2", [[0, [1, 1, 1], "step"], [1, [1.5, 0.5, 1.5]], [2, [1, 1, 1]]], { track: "scale" })
    a.sample("link_3", (t: number) => [0, Math.sin(t * Math.PI * 2) * 3, 0], 5, { track: "position", interpolation: "smooth" })
  })
  const idle = design.animations.find((clip) => clip.name === "idle")!
  // A plain rotation key is written exactly as a version 1 document writes it.
  expect(idle.channels[0]).toEqual({ bone: "link_1", keyframes: [{ time: 0, rotation: [0, 0, 10] }], position: [{ time: 1, position: [0, 2, 0], interpolation: "smooth" }] })
  expect(idle.channels[1]).toEqual({ bone: "link_2", keyframes: [], scale: [{ time: 0, scale: [1, 1, 1], interpolation: "step" }, { time: 1, scale: [1.5, 0.5, 1.5] }, { time: 2, scale: [1, 1, 1] }] })
  expect(idle.channels[2]!.position!.map((key) => [key.time, key.position[1], key.interpolation])).toEqual([[0, 0, "smooth"], [0.5, 3, "smooth"], [1, 0, "smooth"], [1.5, -3, "smooth"], [2, 0, "smooth"]])
  // What is refused is said in the document's words.
  const said = (body: (a: ReturnType<ReturnType<ReturnType<typeof kit>["api"]["model"]>["animation"]>) => void) => {
    try {
      built((m) => body(m.animation("idle", { length: 1, loop: true })))
      return ""
    } catch (error) {
      return String(error)
    }
  }
  expect(said((a) => a.key("link_1", 0, [0, 200, 0], { track: "position" }))).toContain("-128 到 128 像素")
  expect(said((a) => a.key("link_1", 0, [1, -1, 1], { track: "scale" }))).toContain("0 到 16 倍")
  expect(said((a) => a.key("link_1", 0, [0, 0, 0], { track: "spin" }))).toContain("track 只能是")
  expect(said((a) => a.key("link_1", 0, [0, 0, 0], { interpolation: "bezier" }))).toContain("interpolation 只能是")
})

test("脚本：同一个时间函数依次交给一排骨骼，每根晚多少由写脚本的人给", () => {
  const wave = (t: number) => [0, 0, Math.sin(t * Math.PI * 2) * 10]
  const design = built((m) => {
    const row = ["link_1", "link_2", "link_3"].map((name) => m.get(name))
    m.animation("idle", { length: 2, loop: true }).stagger(row, wave, { count: 9, delay: 0.25 })
    m.animation("lists", { length: 2, loop: false }).stagger(row, (t: number, _seconds: number, index: number, count: number) => [t * 10, index, count], { count: 3, delay: [0, 1, 2], track: "position" })
    m.animation("each", { length: 2, loop: true }).stagger(row, wave, { count: 5, delay: (index: number) => index * index * 0.5 })
  })
  const idle = design.animations.find((clip) => clip.name === "idle")!
  // Each bone does what the one before it did a quarter of a second earlier; a loop goes round.
  const value = (bone: number, time: number) => idle.channels[bone]!.keyframes.find((key) => key.time === time)!.rotation[2]
  expect(idle.channels.map((channel) => channel.bone)).toEqual(["link_1", "link_2", "link_3"])
  expect([value(0, 0.5), value(1, 0.75), value(2, 1)]).toEqual([10, 10, 10])
  expect(value(1, 0)).toBeCloseTo(Math.sin(((2 - 0.25) / 2) * Math.PI * 2) * 10, 2)
  // Not a loop: a bone waits at the start until its turn, and is told which bone it is.
  const lists = design.animations.find((clip) => clip.name === "lists")!
  expect(lists.channels.map((channel) => channel.position!.map((key) => key.position))).toEqual([[[0, 0, 3], [5, 0, 3], [10, 0, 3]], [[0, 1, 3], [0, 1, 3], [5, 1, 3]], [[0, 2, 3], [0, 2, 3], [0, 2, 3]]])
  const each = design.animations.find((clip) => clip.name === "each")!
  expect(each.channels[2]!.keyframes.map((key) => key.rotation[2])).toEqual(each.channels[0]!.keyframes.map((key) => key.rotation[2]))
})

// ---- round 10: what an exported track may hold is not what an author may write ----

const swing = (keys: [number, number][]) => keys.map(([time, x]): TrackKey => ({ time, value: [x, 0, 0], interpolation: "smooth" }))

test("导出的轨道有自己的上限：写 6 个 smooth 关键帧切出 60 多个点照样导出；放不下先放宽这条轨道的精度，实在不行才说", () => {
  // The limit on written keys stays what it was; the exported one is separate and says what it costs.
  expect(ANIMATION_LIMITS.keys).toBe(60)
  expect(BAKED_LIMITS).toEqual({ track: 480, total: 60_000, loosest: 8 })
  // The swing a real run was refused for: six keys, a wide fast arc. More than 60 pieces, exported as it is.
  const arm = swing([[0, 0], [0.45, -120], [0.65, -130], [0.8, -46], [0.9, 0], [1.8, 0]])
  const fitted = bakeFitted(arm, false, "rotation")
  expect(fitted.keys.length).toBeGreaterThan(ANIMATION_LIMITS.keys)
  expect(fitted).toMatchObject({ widened: 1, over: false })
  expect(fitted.keys).toEqual(bakeTrack(arm, false, BAKE_TOLERANCE.rotation))
  // Straight lines are never touched, whatever their number.
  const straight = Array.from({ length: 60 }, (_, index): TrackKey => ({ time: index * 0.1, value: [index % 2 ? 180 : -180, 0, 0] }))
  expect(bakeFitted(straight, false, "rotation")).toEqual({ keys: straight.map((key) => ({ time: key.time, value: [...key.value] })), widened: 1, over: false })
  // Too many pieces at the usual tolerance: that track alone is baked looser, and still follows its curve within the widened tolerance.
  const busy = swing(Array.from({ length: 20 }, (_, index) => [index * 0.1, index % 2 ? 180 : -180]))
  expect(bakeTrack(busy, false, BAKE_TOLERANCE.rotation).length).toBeGreaterThan(BAKED_LIMITS.track)
  const loosened = bakeFitted(busy, false, "rotation")
  expect(loosened.over).toBe(false)
  expect(loosened.widened).toBeGreaterThan(1)
  expect(loosened.keys.length).toBeLessThanOrEqual(BAKED_LIMITS.track)
  const line = (time: number) => sampleTrack(loosened.keys.map((key) => ({ time: key.time, value: key.value })), time)![0]
  const gap = Math.max(...Array.from({ length: 380 }, (_, index) => index * 0.005).map((time) => Math.abs(line(time) - sampleTrack(busy, time)![0])))
  expect(gap).toBeLessThanOrEqual(BAKE_TOLERANCE.rotation * loosened.widened + 1e-4)
  // Past the loosest tolerance it is refused, in words that say which track, how many, the limit and what to do.
  const wild = swing(Array.from({ length: 60 }, (_, index) => [index * 0.1, index % 2 ? 180 : -180]))
  expect(bakeFitted(wild, false, "rotation")).toMatchObject({ widened: BAKED_LIMITS.loosest, over: true })
  const clip = (name: string, keys: TrackKey[]) => ({ name, length: 6, loop: false, channels: [{ bone: "arm", keyframes: keys.map((key) => ({ time: key.time, rotation: key.value, interpolation: key.interpolation })) }] })
  const counted = bakedCounts([clip("slam", arm), clip("spin", busy)])
  expect(counted.faults).toEqual([])
  expect(counted.total).toBe(fitted.keys.length + loosened.keys.length)
  expect(counted.longest).toMatchObject({ clip: "spin", bone: "arm", track: "rotation", written: 20 })
  expect(counted.widened.map((track) => track.clip)).toEqual(["spin"])
  expect(bakedLine(counted)).toContain(`最长的一条轨道（动作 spin 里骨骼 arm 的转动，你写了 20 个关键帧）有 ${loosened.keys.length} 个点（导出的上限 480）`)
  expect(bakedLine(counted)).toContain("有 1 条轨道按平时的精度放不下，放宽了精度才导出")
  expect(bakedLine(counted)).toEndWith("和你写的关键帧上限（一条轨道 60 个）分开算。")
  expect(bakedLine(bakedCounts([clip("plain", straight)]))).toBe("")
  const refusal = bakedCounts([clip("wild", wild)]).faults
  expect(refusal).toHaveLength(1)
  expect(refusal[0]).toStartWith("动作 wild 里骨骼 arm 的转动轨道导出给游戏时太长了：你写了 60 个关键帧，其中的曲线（smooth、bezier、easing）要切成直线段游戏才放得出来，精度已经放宽到平时的 8 倍，还是要 ")
  expect(refusal[0]).toEndWith("个点，导出的一条轨道最多 480 个。把这条轨道上幅度大、挨得近的曲线关键帧减少或者拉开，或者把其中一些改成不带 easing 的 linear。")
  // The maker is told which limit counts what.
  expect(ANIMATION_GUIDE).toContain("每条轨道最多写 60 个关键帧（数的是你写的，不是导出以后的）")
})
