import { expect, test } from "bun:test"
import { ModelDesignSchema, type ModelDesign } from "../src/contracts"
import { told } from "../src/acceptance"
import { CRAFT_REVIEW_RULE } from "../src/making"
import { measureLook } from "../src/model-look"
import { reviewModelQuality, stillAnswers } from "../src/model-quality"
import { bareHead } from "./specimens"
import guardian from "./fixtures/look/good/crystal-guardian.json"
import slime from "./fixtures/look/good/sprout-slime.json"
import floatingParts from "./fixtures/look/bad/floating-parts.json"

// Owner, 10-14 (OnlyLLM): a legitimate subject always has a legal way out of a gate. These pin the ways out the audit found missing: a thing that hovers,
// a detached part, a creature that hops, an inert statue, a one-block creature, and the names that were matched by a piece of a word.

type Vec = [number, number, number]
const paint = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })
const cube = (name: string, origin: Vec, size: Vec, color = "#8A6A3A") => ({ name, origin, size, faces: paint(color), surface_details: [] })
const good = (model: unknown = guardian.model) => ModelDesignSchema.parse(structuredClone(model))
const rules = (value: ModelDesign, context: Parameters<typeof reviewModelQuality>[1] = {}) => reviewModelQuality(value, context).findings.map((finding) => finding.rule)

/** Everything of a model lifted `by` pixels: built clear of the ground, the way a hovering thing is. */
const lifted = (value: ModelDesign, by: number) => {
  value.bones.forEach((bone) => {
    bone.pivot[1] += by
    bone.cubes.forEach((box) => (box.origin[1] += by))
  })
  return value
}

test("a jellyfish built hovering is answered by a stated reason; the brief does not have to say a word of it, and when it does that still works", () => {
  const jelly = lifted(good(slime.model), 8)
  const before = reviewModelQuality(jelly)
  expect(before.findings.map((finding) => [finding.rule, finding.severity])).toEqual([["off_ground", "defect"]])
  expect(before.findings[0]!.fix).toContain('{"what":"off_ground","reason":"……"}')

  const after = reviewModelQuality(jelly, { justified: [{ what: "off_ground", reason: "它是水母，浮在水里，触手垂在半空" }] })
  expect(after.findings).toEqual([])
  expect(after.passed).toBe(true)
  expect(after.answered).toEqual([expect.objectContaining({ rule: "off_ground", severity: "defect", reason: "它是水母，浮在水里，触手垂在半空" })])
  expect(told(after).answered).toEqual([{ criterion: "站得住", message: expect.stringContaining("悬在地面上方"), reason: "它是水母，浮在水里，触手垂在半空" }])
  // An empty reason, or another rule's, answers nothing.
  expect(rules(jelly, { justified: [{ what: "off_ground", reason: " " }] })).toEqual(["off_ground"])
  expect(rules(jelly, { justified: [{ what: "tiny_fragments", reason: "无关" }] })).toEqual(["off_ground"])
  // The brief-word excuse stays as it was: a brief that says it hovers needs no entry, and a bat or a jellyfish that the brief names without such a word needs the entry.
  expect(rules(jelly, { brief: "一只悬浮的水母" })).toEqual([])
  expect(rules(jelly, { brief: "一只蝙蝠" })).toEqual(["off_ground"])
  // Standing is still standing: a creature on the ground that claims to hover is only a claim, and the reviewer is told to judge it against the pictures.
  expect(CRAFT_REVIEW_RULE).toContain("明明站在地上走的东西却说它悬着")
})

test("a part that is detached from the body on purpose (a halo, orbiting crystals) is answered by a stated reason", () => {
  const value = good(floatingParts.model)
  const before = reviewModelQuality(value)
  expect(before.findings.map((finding) => [finding.rule, finding.severity])).toEqual([["floating_parts", "defect"]])
  expect(before.findings[0]!.fix).toContain('{"what":"floating_parts","reason":"……"}')
  const after = reviewModelQuality(value, { justified: [{ what: "floating_parts", reason: "绕着它转的晶体本来就不连在身上" }] })
  expect(after.findings).toEqual([])
  expect(after.passed).toBe(true)
  expect(after.answered).toEqual([expect.objectContaining({ rule: "floating_parts", severity: "defect", reason: "绕着它转的晶体本来就不连在身上" })])
  // The brief-word excuse still works when the brief says it.
  expect(rules(value, { brief: "身边环绕着晶体" })).toEqual([])
})

/** The guardian's walk with its two front legs made to move together, the way a hopper's paired legs do. */
const hopper = () => {
  const value = good()
  const walk = value.animations.find((animation) => animation.name === "walk")!
  const lead = walk.channels.find((channel) => channel.bone === "leg_front_left")!
  walk.channels.find((channel) => channel.bone === "leg_front_right")!.keyframes = structuredClone(lead.keyframes)
  return value
}

test("a hopper's paired legs moving together are answered by a stated reason, and the finding says both ways out", () => {
  const value = hopper()
  const before = reviewModelQuality(value)
  expect(before.findings.map((finding) => [finding.rule, finding.severity])).toEqual([["walk_same_phase", "defect"]])
  // The way out the finding names is the sheet's justified (this is a fact about how the thing moves), and the walk declared still stays the other one.
  expect(before.findings[0]!.fix).toContain('{"what":"walk_same_phase","reason":"……"}')
  expect(before.findings[0]!.fix).toContain("在部件说明的 still 里写上这个动作和理由")

  const after = reviewModelQuality(value, { justified: [{ what: "walk_same_phase", reason: "它是蛙，蹦着走，成对的腿一起蹬" }] })
  expect(after.findings).toEqual([])
  expect(after.answered).toEqual([expect.objectContaining({ rule: "walk_same_phase", reason: "它是蛙，蹦着走，成对的腿一起蹬" })])
  // Declared still it is answered too, with the sheet's own words, as before.
  expect(rules(value, { justified: stillAnswers({ walk: "固定的炮台" }) })).toEqual([])
})

/** A cart: a bed on four wheels, each a bone of its own that turns about the axle. `turn` is how far a wheel goes round in the walk. */
const cart = (turn: number, wheelName = (index: number) => `wheel_${index}`) => {
  const wheels = [[-7, -6], [7, -6], [-7, 6], [7, 6]] as const
  return ModelDesignSchema.parse({
    name: "cart",
    texture_size: 128,
    bones: [
      { name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [] },
      { name: "body", parent: "root", pivot: [0, 6, 0], rotation: [0, 0, 0], cubes: [cube("bed", [-6, 4, -10], [12, 6, 20]), cube("front", [-4, 10, -10], [8, 6, 4], "#A07A4A")] },
      ...wheels.map(([x, z], index) => ({ name: wheelName(index), parent: "body", pivot: [x, 3, z], rotation: [0, 0, 0], cubes: [cube(`rim_${index}`, [x - 1, 0, z - 3], [2, 6, 6], "#555555")] })),
    ],
    animations: ["idle", "walk", "hurt"].map((name) => ({
      name,
      length: 1,
      loop: name !== "hurt",
      channels:
        name === "walk"
          ? wheels.map((_, index) => ({ bone: wheelName(index), keyframes: [0, 0.5, 1].map((time) => ({ time, rotation: [turn * time, 0, 0] as Vec })) }))
          : [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] as Vec }, { time: 0.5, rotation: [name === "hurt" ? 8 : 2, 0, 0] as Vec }, { time: 1, rotation: [0, 0, 0] as Vec }] }],
    })),
  })
}

test("a part that goes all the way round in the walk is a wheel, not a leg: four wheels are not four legs and get no gait findings", () => {
  const rolling = measureLook(cart(360))
  expect(rolling.limbs.length).toBe(0)
  expect(rolling.plan).not.toBe("quadruped")
  expect(rules(cart(360))).not.toEqual(expect.arrayContaining(["walk_same_phase"]))
  for (const rule of ["walk_same_phase", "constant_speed", "walk_body_frozen", "walk_legs_still", "hanging_limbs", "legs_out_of_scale"]) expect(rules(cart(360))).not.toContain(rule)
  // It is the turn that decides, not the name: a wheel that is called a leg is still a wheel, and a part that swings to and fro a long way is a leg whatever it looks like.
  expect(measureLook(cart(360, (index) => `leg_${index}`)).limbs.length).toBe(0)
  expect(measureLook(cart(80)).limbs.length).toBe(4)
  expect(measureLook(cart(80)).plan).toBe("quadruped")
  // Under a wheel what hangs on it rolls with it.
  const hub = cart(360)
  hub.bones.push(ModelDesignSchema.shape.bones.element.parse({ name: "hub", parent: "wheel_0", pivot: [-7, 3, -6], rotation: [0, 0, 0], cubes: [cube("hub_cube", [-9, 2, -7], [1, 2, 2])] }))
  expect(measureLook(hub).limbs.length).toBe(0)
})

/** A creature that is one body, with a head and, when asked, other bones hung on it at the given places, each with one cube. */
const probe = (...bones: { name: string; origin: Vec; size: Vec }[]) =>
  ModelDesignSchema.parse({
    name: "probe",
    texture_size: 128,
    bones: [
      { name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [] },
      { name: "body", parent: "root", pivot: [0, 8, 0], rotation: [0, 0, 0], cubes: [cube("trunk", [-4, 4, -4], [8, 8, 8], "#7C9B83")] },
      ...bones.map((bone) => ({ name: bone.name, parent: "body", pivot: [bone.origin[0], bone.origin[1], bone.origin[2]], rotation: [0, 0, 0], cubes: [cube(`${bone.name}_cube`, bone.origin, bone.size, "#C06040")] })),
    ],
    animations: ["idle", "walk", "hurt"].map((name) => ({ name, length: 1, loop: true, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] as Vec }, { time: 1, rotation: [3, 0, 0] as Vec }] }] })),
  })
const headOf = (name: string) => measureLook(probe({ name, origin: [-2, 12, -6], size: [4, 4, 2] })).head
/** Names the two sides of a pair of wide flat parts at the sides of the body, well off the ground: nothing about their shape says wing or leg. */
const pair = (name: string) => measureLook(probe({ name: `${name}_l`, origin: [4, 8, -2], size: [6, 2, 4] }, { name: `${name}_r`, origin: [-10, 8, -2], size: [6, 2, 4] }))

test("names are matched by whole words: surface is not a face, finger is not a fin, warhead is not a head, footing and legend are not feet and legs", () => {
  // Heads: a piece of a word does not make a head.
  for (const name of ["surface", "interface", "warhead", "arrowhead", "overhead", "forehead", "SurfacePlate"]) expect(headOf(name)).toBeNull()
  // ...and the words that did and do: head, skull, face on their own or with a number, a side or a camelCase joint.
  for (const name of ["head", "Head", "head_01", "HeadTop", "skull", "face", "Face2", "upper_head"]) expect(headOf(name)).toBe(name)

  // Wings and fins: finger, final, refine, define and finish are no fin, and a pair of them does not make a flyer.
  for (const name of ["finger", "final", "refine", "finish", "define", "wingman_x"]) expect(pair(name).plan).not.toBe("flyer")
  for (const name of ["wing", "Wing", "LeftWing", "fin", "wing_tip", "tail_fin", "flipper", "WingL"]) expect(pair(name).plan).toBe("flyer")
  // Legs: footing and legend are not limbs; leg, foot, paw, hoof and their sided and numbered forms are.
  for (const name of ["footing", "legend", "legacy", "pawn", "hoofbeat"]) expect(pair(name).limbs.length).toBe(0)
  for (const name of ["leg", "Leg", "foreleg", "hindleg", "FrontLeg2", "leg_front_left", "paw", "hoof", "foot_r", "LegUpper"]) expect(pair(name).limbs.length).toBe(2)
})

test("a face, horn or claw is found by its word; a piece of a word is not an accent", () => {
  const blended = (name: string) => {
    // A part painted the very colour of the body is an accent that blends in; whether it counts as an accent at all is decided by its name.
    const value = probe({ name, origin: [-2, 12, -6], size: [4, 4, 2] })
    value.bones.find((bone) => bone.name === name)!.cubes[0]!.faces = paint("#7C9B83")
    return measureLook(value).accents
  }
  for (const name of ["horn", "Horn_L", "claw_tip", "fangs", "crystal2", "eyeLeft"]) expect(blended(name)).toBeGreaterThan(0)
  for (const name of ["hornet", "gemini", "spiked_ball_x", "clawback_x", "eyebrow_x", "beaker"]) expect(blended(name)).toBe(0)
})

/** The guardian with nothing in it that moves in any of its clips: a statue, a scarecrow, a dummy. */
const statue = () => {
  const value = good()
  value.animations.forEach((animation) => (animation.channels = []))
  return value
}

test("an inert subject whose idle, walk and hurt are all declared still passes the nothing-moves rule, with the sheet's reasons; declaring only some does not", () => {
  const value = statue()
  expect(rules(value)).toContain("nothing_moves")
  const all = stillAnswers({ idle: "石像，不动", walk: "石像，不动", hurt: "石像，不动" })
  expect(all.map((entry) => entry.what)).toContain("nothing_moves")
  const after = reviewModelQuality(value, { justified: all })
  expect(after.findings).toEqual([])
  expect(after.passed).toBe(true)
  expect(after.answered?.find((entry) => entry.rule === "nothing_moves")?.reason).toContain("石像，不动")
  // One or two of the three is not an inert thing: the other clip still has to move something.
  for (const motions of [{ idle: "石像" }, { walk: "石像" }, { hurt: "石像" }, { idle: "石像", walk: "石像" }, { idle: "石像", hurt: "石像" }, { walk: "石像", hurt: "石像" }] as Record<string, string>[]) {
    expect(stillAnswers(motions).map((entry) => entry.what)).not.toContain("nothing_moves")
    expect(rules(value, { justified: stillAnswers(motions) })).toContain("nothing_moves")
  }
  // The finding says how to get out.
  expect(reviewModelQuality(value).findings.find((finding) => finding.rule === "nothing_moves")!.fix).toContain("在部件说明的 still 里把 idle、walk、hurt 都写上")
})

/** A creature of a single block with a painted face: a jelly cube. */
const oneBlock = () => {
  const value = good(slime.model)
  value.bones = value.bones.slice(0, 2)
  value.bones[1]!.cubes = value.bones[1]!.cubes.slice(0, 1)
  value.animations.forEach((animation) => (animation.channels = animation.channels.filter((channel) => channel.bone === value.bones[1]!.name)))
  return value
}

test("a creature that is meant to be one block is answered by a stated reason, not refused for having too few blocks", () => {
  const value = oneBlock()
  const before = reviewModelQuality(value, { complexity: "low" })
  expect(before.findings.map((finding) => finding.rule)).toEqual(["too_few_parts"])
  expect(before.findings[0]!.fix).toContain('{"what":"too_few_parts","reason":"……"}')
  const after = reviewModelQuality(value, { complexity: "low", justified: [{ what: "too_few_parts", reason: "一块果冻，轮廓就是一个方块，靠脸和颜色认出来" }] })
  expect(after.findings).toEqual([])
  expect(after.answered).toEqual([expect.objectContaining({ rule: "too_few_parts", severity: "defect" })])
})

test("a face the measure cannot see (eyes on stalks, on top of the head, very small) is advice that says what it cannot see; a head with nothing on it is a defect answered by a reason", () => {
  const value = good()
  const skull = value.bones.find((bone) => bone.name === "head")!.cubes[0]!
  skull.features = skull.features!.filter((feature) => feature.type !== "eyes" && feature.type !== "brows")
  const review = reviewModelQuality(value)
  expect(review.findings.find((finding) => finding.rule === "no_face")).toBeUndefined()
  const advice = review.advice!.find((entry) => entry.rule === "no_face")!
  expect(advice.message).toContain("长在柄上")
  expect(advice.message).toContain("在头顶")
  // Advice is not a reason to answer anything: no tail about the part sheet.
  expect(advice.fix).not.toContain("justified")
  const found = reviewModelQuality(bareHead(good())).findings.find((finding) => finding.rule === "no_face")!
  expect(found.fix).toContain("justified")
  expect(found.fix).toContain('{"what":"no_face","reason":"……"}')
  // There is no list of subjects that may lack a face anywhere in what the reviewer is told; the reason is judged against the pictures.
  expect(CRAFT_REVIEW_RULE).not.toMatch(/机器、植物|石头魔像|史莱姆/)
  expect(CRAFT_REVIEW_RULE).toContain("一个看得清的动物头上哪里都没有眼睛")
})
