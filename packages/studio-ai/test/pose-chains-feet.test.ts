import { expect, test } from "bun:test"
import { CLIP_PLAY_GUIDE, FOOT_GUIDE, HANG_GUIDE, type Clip } from "../src/animation"
import { ModelDesignJsonSchema, ModelDesignSchema, type ModelDesign } from "../src/contracts"
import { followClip } from "../src/follow-bones"
import { footClip, footGround, footPlan, footSolve, soleHeight } from "../src/foot-placement"
import { HANG, hangChains, hangMotion, hangStep } from "../src/hang-chains"
import { pivotOf, placeOf, pointOf, rigOf, type V3 } from "../src/pose-rig"
import { quadrupedFixture } from "./quadruped-fixture"

/**
 * 第 2 步 (挂链和踩地): the model words `mode: "hang"` and `foot_placement`, what is refused and how it is said, and what the preview's arithmetic
 * does with them (the game runs the same steps: mod-core test/pose-rig.test.ts runs the Java beside this TypeScript).
 */

const beast = () => quadrupedFixture()
const clip = (design: ModelDesign, name: string) => design.animations.find((value) => value.name === name)!
const refusal = (design: object) => {
  const parsed = ModelDesignSchema.safeParse(design)
  return parsed.success ? null : parsed.error.issues.map((issue) => issue.message).join(" | ")
}

test("文档：挂链和踩地都能写；写 null 和不写一样；说不通的写法用大白话拒绝", () => {
  const design = beast()
  expect(ModelDesignSchema.parse(design)).toEqual(design)
  expect(refusal({ ...design, foot_placement: null, follow: design.follow!.map((follow) => ({ ...follow, gravity: null, floor: null, weight: null })) })).toBeNull()
  const text = JSON.stringify(ModelDesignJsonSchema)
  ;["foot_placement", "rise_speed", "max_drop", "attract", "falloff", '"hang"', "knee"].forEach((word) => expect(text).toContain(word))
  ;[HANG_GUIDE, FOOT_GUIDE].forEach((guide) => expect(CLIP_PLAY_GUIDE).toContain(guide))
  ;["mode", "hang", "attract", "falloff", "gravity", "floor", "weight"].forEach((word) => expect(HANG_GUIDE).toContain(word))
  ;["foot_placement", "thigh", "calf", "foot", "forward", "side", "body", "rise_speed", "fall_speed", "max_drop"].forEach((word) => expect(FOOT_GUIDE).toContain(word))
  const tail = (change: Record<string, unknown>, at = 0) => ({ ...design, follow: design.follow!.map((follow, index) => (index === at ? { ...follow, ...change } : follow)) })
  expect(refusal(tail({ period: 0.5 }))).toContain("只给会弹的（spring）用")
  expect(refusal(tail({ mode: null }))).toContain("只有挂着的骨骼才用")
  expect(refusal(tail({ attract: 0.3 }, 1))).toContain("写在这一串最上面那一节 tail 上")
  expect(refusal(tail({ mode: "spring" }, 2))).toContain("在挂着的 tail_mid 下面")
  // Two hanging links straight under one, a link on top of the next, a lone link with nothing to hang by.
  const forked = { ...design, bones: [...design.bones, { name: "tassel", parent: "tail", pivot: [1, 12, 12] as V3, rotation: [0, 0, 0] as V3, cubes: [] }], follow: [...design.follow!, { bone: "tassel", mode: "hang" as const }] }
  expect(refusal(forked)).toContain("好几节")
  const stacked = { ...design, bones: design.bones.map((bone) => (bone.name === "tail_mid" ? { ...bone, pivot: [0, 13, 8.2] as V3 } : bone)) }
  expect(refusal(stacked)).toContain("tail 和下一节 tail_mid 的轴点几乎在同一个地方")
  const round = { ...design, bones: design.bones.map((bone) => (bone.name === "head" ? { ...bone, pivot: [0, 14, -11] as V3 } : bone)), follow: [{ bone: "head", mode: "hang" as const }] }
  expect(refusal(round)).toContain("量不出往哪个方向垂")
  const placed = (change: Record<string, unknown>) => ({ ...design, foot_placement: { ...design.foot_placement!, ...change } })
  expect(refusal(placed({ body: "torso" }))).toContain("foot_placement 的身体（body） torso 不存在")
  expect(refusal(placed({ feet: [{ thigh: "root" }] }))).toContain("是根骨骼")
  expect(refusal(placed({ feet: [{ thigh: "front_left_calf", calf: "front_left_thigh" }] }))).toContain("不在大腿 front_left_calf 下面")
  expect(refusal(placed({ feet: [{ thigh: "front_left_thigh", calf: "front_left_calf" }, { thigh: "front_left_thigh" }] }))).toContain("用了两次")
  expect(refusal(placed({ body: "front_left_calf" }))).toContain("在腿 front_left_thigh 下面")
  expect(refusal({ ...design, follow: [{ bone: "head" }] , foot_placement: { ...design.foot_placement!, body: "head" } })).toContain("两样会抢着转它")
  expect(refusal(placed({ max_drop: 3 }))).not.toBeNull()
  expect(refusal(placed({ feet: [] }))).not.toBeNull()
})

test("挂链：平伸着建的尾巴挂下来；往前走被拖到后面；晃稳了就停住；同样的输入同样的结果", () => {
  const design = beast()
  const idle = hangMotion(design, clip(design, "idle"))
  // A positive x turn lifts what lies behind the pivot: the tail droops with negative x, its base most of all.
  expect(idle.get("tail")!.at(-1)![0]).toBeLessThan(-10)
  expect(idle.get("tail_end")!.at(-1)![0]).toBeLessThan(-5)
  // Settled: the last half second barely moves.
  const settled = idle.get("tail_end")!.slice(-40)
  expect(Math.max(...settled.map((value) => value[0])) - Math.min(...settled.map((value) => value[0]))).toBeLessThan(0.5)
  // Walking forwards the air drags the tip back up behind it.
  const walking = hangMotion(design, clip(design, "idle"), 3)
  expect(walking.get("tail_end")!.at(-1)![0]).toBeGreaterThan(idle.get("tail_end")!.at(-1)![0] + 3)
  expect(hangMotion(design, clip(design, "idle"))).toEqual(idle)
  // Shown none of it (weight 0), the tail is where the motion puts it.
  const unseen = { ...design, follow: design.follow!.map((follow, index) => (index ? follow : { ...follow, weight: 0 })) }
  expect(Math.max(...[...hangMotion(unseen, clip(design, "idle")).values()].flat(2).map(Math.abs))).toBeLessThan(1e-9)
  // Held firmly (attract 1), it barely sags; let go (attract 0), it hangs much further.
  const held = (attract: number) => hangMotion({ ...design, follow: design.follow!.map((follow, index) => (index ? follow : { ...follow, attract })) }, clip(design, "idle")).get("tail")!.at(-1)![0]
  expect(Math.abs(held(1))).toBeLessThan(Math.abs(held(0)))
  // The preview clip carries the chain in its links' rotation keys, one a tick.
  const shown = followClip(design, clip(design, "walk"), 2)
  const keyed = shown.channels.find((channel) => channel.bone === "tail_end")!
  expect(keyed.keyframes.length).toBe(21)
  expect(keyed.keyframes[10]!.rotation[0]).toBeCloseTo(hangMotion(design, clip(design, "walk"), 2).get("tail_end")![40]![0], 9)
})

test("挂链：每节长度不变；limit 管住偏开的角度；有 floor 的点停在方块上面；身体乱甩也不发散", () => {
  for (const floor of [false, true]) shaken(floor)
})

function shaken(floor: boolean) {
  const design = beast()
  const chain = hangChains({ ...design, follow: [{ bone: "tail", mode: "hang", attract: 0, gravity: 3, limit: 30, floor }, { bone: "tail_mid", mode: "hang" }, { bone: "tail_end", mode: "hang" }] })[0]!
  const rest = rigOf(design, null)
  const points = [...pivotOf(rest, 11), ...pivotOf(rest, 12), ...pivotOf(rest, 13), ...pointOf(rest, 13, chain.tip!)].map((value) => value / 16)
  const x = [...points]
  const before = [...points]
  let worstLength = 0
  let worstAngle = 0
  let lowest = Infinity
  for (let step = 0; step < 2000; step++) {
    // The body spins two turns a second and bobs: the top point and the motion's pose with it.
    const turn = step * 0.08
    const lift = Math.sin(step * 0.3) * 0.2
    const target = points.map((value, index) => (index % 3 === 1 ? value + lift : index % 3 === 0 ? value * Math.cos(turn) - points[index + 2]! * Math.sin(turn) : points[index - 2]! * Math.sin(turn) + value * Math.cos(turn)))
    hangStep(chain, x, before, target, floor ? [0.5, 0.5, 0.5, 0.5] : null)
    for (let point = 1; point < 4; point++) {
      const link = [0, 1, 2].map((axis) => x[point * 3 + axis]! - x[point * 3 - 3 + axis]!)
      const posed = [0, 1, 2].map((axis) => target[point * 3 + axis]! - target[point * 3 - 3 + axis]!)
      const size = Math.hypot(...link)
      worstLength = Math.max(worstLength, Math.abs(size - Math.hypot(...posed)))
      worstAngle = Math.max(worstAngle, (Math.acos(Math.min(1, link.reduce((sum, value, axis) => sum + value * posed[axis]!, 0) / size / Math.hypot(...posed))) * 180) / Math.PI)
      lowest = Math.min(lowest, x[point * 3 + 1]!)
    }
  }
  expect(x.every(Number.isFinite)).toBe(true)
  // Resting on the floor is the one thing that may move a point off its link's length and angle.
  if (floor) expect(lowest).toBeGreaterThanOrEqual(0.5 + HANG.margin - 1e-9)
  else {
    expect(worstLength).toBeLessThan(1e-9)
    expect(worstAngle).toBeLessThan(30 + 1e-6)
    expect(lowest).toBeLessThan(0.5)
  }
}

const steps = (low: "front" | "back" | "left") => (x: number, z: number) => (low === "front" ? (z > 0.1 ? -0.5 : 0) : low === "back" ? (z < -0.1 ? -0.5 : 0) : x > 0.1 ? -0.5 : 0)

test("踩地：四只脚各自够到台阶，身体顺着台阶倾斜、往下沉；平地上脚底落到地面", () => {
  const design = beast()
  const plan = footPlan(design)!
  expect(plan.pitch && plan.roll).toBe(true)
  const idle = clip(design, "idle")
  // The hind feet a half block lower: the body pitches nose up (negative x in the document's axes) and sinks.
  const back = footClip(design, idle, steps("back"), [0])
  expect(back.level).toBe(0)
  expect(back.lifts).toEqual([0, 0, -0.5, -0.5])
  const body = back.clip.channels.find((channel) => channel.bone === "body")!
  expect(body.keyframes[0]!.rotation[0]).toBeLessThan(-10)
  expect(body.position![0]!.position[1]).toBeLessThan(-2)
  // Every foot ends where its ground is: its end (as the motion puts it) moved by its lift, to a tenth of a pixel.
  const reached = (low: "front" | "back" | "left", time: number) => {
    const placed = footClip(design, idle, steps(low), [time])
    const after = rigOf(design, placed.clip, time)
    return plan.feet.map(foot => Math.min(...foot.corners.map(corner => {
      const p=pointOf(after,foot.end,corner)
      return p[1] - (steps(low)(-p[0]/16,-p[2]/16)-placed.level)*16
    })))
  }
  for (const low of ["front", "back", "left"] as const) expect(Math.max(...reached(low, 0.7).map(Math.abs))).toBeLessThan(0.1)
  // The front a half block lower: the body pitches nose down; the left lower: it rolls to its left (positive z lowers the left side).
  expect(footClip(design, idle, steps("front"), [0]).clip.channels.find((channel) => channel.bone === "body")!.keyframes[0]!.rotation[0]).toBeGreaterThan(10)
  expect(footClip(design, idle, steps("left"), [0]).clip.channels.find((channel) => channel.bone === "body")!.keyframes[0]!.rotation[2]).toBeGreaterThan(10)
  // Flat ground: nothing moves at all.
  const flat = rigOf(design, idle, 0.4)
  const copy = { ...flat, rot: [...flat.rot], pos: [...flat.pos] }
  footSolve(copy, plan, [0, 0, 0, 0])
  for (const foot of plan.feet) expect(soleHeight(copy,foot)).toBeCloseTo(0,6)
  // A foot's height goes no faster than it is allowed: 3 blocks a second up, 2 down.
  expect(footGround(0, 1, 3, 2, 0.1)).toBeCloseTo(0.3, 12)
  expect(footGround(0, -1, 3, 2, 0.1)).toBeCloseTo(-0.2, 12)
  expect(footGround(0, 0.05, 3, 2, 0.1)).toBe(0.05)
})

test("踩地：两条腿的不倾斜，身体沉到低的那只脚够得着；一节的腿整条挪；写了 foot 的脚掌保持动作里的朝向", () => {
  const design = beast()
  const biped: ModelDesign = {
    ...design,
    bones: design.bones.filter((bone) => !bone.name.startsWith("front")),
    animations: design.animations.map((value) => ({ ...value, channels: value.channels.filter((channel) => !channel.bone.startsWith("front")) })),
    foot_placement: { body: "body", feet: [{ thigh: "hind_left_thigh", calf: "hind_left_calf" }, { thigh: "hind_right_thigh" }] },
  }
  expect(ModelDesignSchema.safeParse(biped).success).toBe(true)
  const plan = footPlan(biped)!
  expect(plan.pitch || plan.roll).toBe(false)
  const idle = clip(biped, "idle")
  const placed = footClip(biped, idle, steps("left"), [0])
  expect(placed.lifts).toEqual([-0.5, 0])
  const body = placed.clip.channels.find((channel) => channel.bone === "body")!
  expect(Math.hypot(...body.keyframes[0]!.rotation)).toBeLessThan(1e-9)
  expect(body.position![0]!.position[1]).toBeCloseTo(-8, 6)
  // The right leg is one bone: it moves up whole by the body's drop, so its end stays on its ground.
  const after = rigOf(biped, placed.clip, 0)
  plan.feet.forEach((foot, index) => expect(soleHeight(after,foot)).toBeCloseTo(placed.lifts[index]! * 16, 1))
  // With a foot written (a sole under the calf), the sole keeps its turn while the leg bends.
  const footed: ModelDesign = {
    ...design,
    bones: [...design.bones, { name: "front_left_paw", parent: "front_left_calf", pivot: [3, 1, -6], rotation: [0, 0, 0], cubes: [{ name: "pad", origin: [2, 0, -8], size: [2, 1, 3], faces: design.bones[1]!.cubes[0]!.faces, surface_details: [] }] }],
    foot_placement: { ...design.foot_placement!, feet: design.foot_placement!.feet.map((foot, index) => (index ? foot : { ...foot, foot: "front_left_paw" })) },
  }
  expect(ModelDesignSchema.safeParse(footed).success).toBe(true)
  const rig = rigOf(footed, clip(footed, "walk"), 0.2)
  const paw = footed.bones.findIndex((bone) => bone.name === "front_left_paw")
  const turned = placeOf(rig, paw).r
  footSolve(rig, footPlan(footed)!, [6, 0, -4, -4])
  expect(Math.max(...placeOf(rig, paw).r.map((value, index) => Math.abs(value - turned[index]!)))).toBeLessThan(1e-9)
})

test("挂链和踩地放在一起：预览的走路动作里尾巴挂着、四只脚在平地上不动", () => {
  const design = beast()
  const walk: Clip = clip(design, "walk")
  const shown = followClip(design, walk, 2)
  expect(shown.channels.filter((channel) => channel.bone.startsWith("tail")).map((channel) => channel.bone).sort()).toEqual(["tail", "tail_end", "tail_mid"])
  expect(shown.channels.filter((channel) => !channel.bone.startsWith("tail"))).toEqual(walk.channels as never)
})
