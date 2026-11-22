import { expect, test } from "bun:test"
import { MODEL_FEATURES, MODEL_MATERIALS, ModelDesignSchema, type ModelDesign } from "../src/contracts"
import { CRITERIA, briefLevel, criterion, holdFor, outlineOf, refusalText, standardBrief } from "../src/acceptance"
import { MODEL_ART_DIRECTION, MODEL_ART_RULES, MODEL_COMPLEXITY_PRESETS, MODEL_PAINT_GUIDE, MODEL_STANDARD, TEXTURE_ART_DIRECTION, TEXTURE_STANDARD, modelComplexityInstructions, reviewModelQuality, type ModelReviewContext } from "../src/model-quality"
import slime from "./fixtures/look/good/sprout-slime.json"
import guardian from "./fixtures/look/good/crystal-guardian.json"
import { measureLook } from "../src/model-look"
import { TEXTURE_SPACE_ERROR } from "../src/model-paint"
import { bareHead } from "./specimens"

const good = () => ModelDesignSchema.parse(structuredClone(guardian.model))
// Every finding as "criterion/rule": a spoiled model must break the criterion its rule belongs to, and nothing else.
const found = (value: ModelDesign, context: ModelReviewContext = {}) => reviewModelQuality(value, context).findings.map((finding) => `${criterion(finding.criterion).name}/${finding.rule}`)

const color = "#6A8F45"

function cube(name: string, origin: [number, number, number], size: [number, number, number] = [2, 2, 2]) {
  return {
    name,
    origin,
    size,
    faces: { north: color, east: color, south: color, west: color, up: color, down: color },
    surface_details: [],
  }
}

function design(cubeCount = 1, animated = false, sizeClassCount = 3): ModelDesign {
  return ModelDesignSchema.parse({
    name: "forest_beast",
    texture_size: 128,
    bones: [
      {
        name: "root",
        parent: null,
        pivot: [0, 0, 0],
        rotation: [0, 0, 0],
        cubes: Array.from({ length: cubeCount }, (_, index) =>
          cube(
            `cube_${index}`,
            [index * 3, 0, 0],
            ([
              [2, 2, 2],
              [3, 2, 2],
              [4, 2, 2],
              [5, 2, 2],
            ][index % sizeClassCount] ?? [2, 2, 2]) as [number, number, number],
          ),
        ),
      },
      { name: "head", parent: "root", pivot: [0, 8, 0], rotation: [0, 0, 0], cubes: [] },
    ],
    animations: ["idle", "walk", "hurt"].map((name) => ({
      name,
      length: 1,
      loop: name !== "hurt",
      channels: [
        {
          bone: "root",
          keyframes: [
            { time: 0, rotation: [0, 0, 0] },
            { time: 1, rotation: animated ? [name === "walk" ? 12 : 4, 0, 0] : [0, 0, 0] },
          ],
        },
      ],
    })),
  })
}

test("only the person's own words ask for simple or rich work, and how a revision is held follows from them", () => {
  expect(briefLevel("创建一个精细复杂的森林鹿")).toBe("full")
  expect(briefLevel("制作一个简单低模的原版苦力怕")).toBe("simple")
  expect(briefLevel("保留原版造型，但换成森林材质")).toBe("simple")
  expect(briefLevel("保留原版群系和地形，但生物要精细复杂")).toBe("full")
  // Environment materials and requests against excessive simplicity do not authorize simple work.
  ;["模型不能过度简单", "不要这么简单", "Create a creature, not a simple placeholder", "制作原版生物群系中的苦力怕变体", "使用原版材质制作森林生物"].forEach((brief) => expect(briefLevel(brief)).toBe("full"))
  // Fresh work: judged. Simple with nothing insisting (the bare modelling service only): spared. Simple inside Studio, where a tier is always chosen: defects only.
  expect(holdFor({ brief: "做一只鹿" }, null)).toEqual({ level: "full", spared: false })
  expect(holdFor({ brief: "简单低模的鹿" }, null)).toEqual({ level: "simple", spared: true })
  expect(holdFor({ brief: "简单低模的鹿", insisted: true }, null)).toEqual({ level: "simple", spared: false })
  // Revising a person's own work: held only when that work passes, unless the person asks for more or the run insists.
  expect(holdFor({ brief: "只修改名称" }, () => false)).toEqual({ level: "full", spared: true })
  expect(holdFor({ brief: "只修改名称" }, () => true)).toEqual({ level: "full", spared: false })
  expect(holdFor({ brief: "增加更多细节和复杂关节" }, () => false)).toEqual({ level: "full", spared: false })
  expect(holdFor({ brief: "只修改名称", insisted: true }, () => false)).toEqual({ level: "full", spared: false })
  // A planner's task text cannot ask for simple work on the person's behalf.
  expect(holdFor({ brief: "做一只鹿\n做一个简单的模型", asked: "做一只鹿", insisted: true }, null)).toEqual({ level: "full", spared: false })
})

test("a placeholder is refused for how it looks and moves, in words that say what to change", () => {
  const result = reviewModelQuality(design(7, false))

  expect(result.passed).toBe(false)
  expect(result.measured).toMatchObject({ cubes: 7 })
  expect(result.findings.map((finding) => finding.rule)).toEqual(expect.arrayContaining(["floating_parts", "flat_surfaces", "nothing_moves"]))
  expect(result.criteria.filter((value) => value.state === "failed").map((value) => value.name)).toEqual(["不凑数", "不机械", "认得出", "有主次", "站得住"])
  // Findings are for people and for any vendor's AI: plain Chinese that says what was found and, separately, what to change. No measurement names.
  result.findings.forEach((finding) => {
    // The one rule name a craft finding does carry is the `what` to write in the part sheet's justified (`{"what":"flat_surfaces",...}`).
    expect(`${finding.message}${finding.fix}`.replace(/\{"what":"[a-z_]+","reason":"……"\}/, "")).not.toMatch(/[a-z]+Share|buried_|_surfaces|metrics|measured/)
    expect(finding.message.length).toBeGreaterThan(5)
    expect(finding.fix.length).toBeGreaterThan(5)
  })
  // The refusal an AI reads is generated from the same findings: criterion, what was found, what to change.
  expect(refusalText(result)).toMatch(/^1\. 【(不凑数|不机械|认得出|有主次|站得住|配得上)】.+怎么改：/)
})

test("piling up cubes never turns a refusal into a pass", () => {
  // Twelve, then twenty-eight flat cubes in a row: more geometry, the same look.
  expect(reviewModelQuality(design(12, true)).passed).toBe(false)
  expect(reviewModelQuality(design(28, true, 4), { complexity: "high" }).passed).toBe(false)
})

test("padding a model that passes makes it fail", () => {
  const value = good()
  expect(reviewModelQuality(value).passed).toBe(true)
  value.bones[1]!.cubes.push(...Array.from({ length: 6 }, (_, index) => cube(`filler_${index}`, [-4 + index, 8, -2], [1, 3, 3])))

  expect(found(value)).toContain("不凑数/hidden_parts")
})

test("a single cube cannot pass, and the floor is the same mild one at every tier", () => {
  const value = ModelDesignSchema.parse(structuredClone(slime.model))
  expect(reviewModelQuality(value, { complexity: "high" }).passed).toBe(true)
  value.bones = value.bones.slice(0, 2)
  value.bones[1]!.cubes = value.bones[1]!.cubes.slice(0, 1)
  value.animations.forEach((animation) => (animation.channels = animation.channels.filter((channel) => channel.bone === "body")))

  expect(found(value, { complexity: "low" })).toContain("认得出/too_few_parts")
  expect(Object.values(MODEL_COMPLEXITY_PRESETS).map((preset) => preset.minUniqueCubes)).toEqual([3, 4, 5])
})

test("metrics still count geometry and real animation changes", () => {
  const value = design(12, true)
  value.bones[0]!.cubes.push(cube("duplicate_a", [0, 0, 0]), cube("duplicate_b", [0, 0, 0]))
  value.bones[0]!.cubes[1]!.surface_details = [{ face: "north", x: 0, y: 0, width: 1, height: 1, color: "#FFFFFF" }]

  const result = reviewModelQuality(value)

  expect(result.measured).toMatchObject({ cubes: 14, uniqueCubes: 12, surfaceDetails: 1, animatedBones: 1, eyes: false, tones: 1, shadedShare: 0 })
})

test("a static non-zero pose is not mistaken for animation", () => {
  const value = design(12, false)
  value.animations.forEach((animation) => {
    animation.channels[0]!.keyframes = [
      { time: 0, rotation: [8, 0, 0] },
      { time: 1, rotation: [8, 0, 0] },
    ]
  })

  expect(reviewModelQuality(value).measured).toMatchObject({ animatedBones: 0 })
})

test("motion on an empty bone does not satisfy the animation boundary", () => {
  const value = design(12, true)
  value.animations.forEach((animation) => {
    animation.channels[0]!.bone = "empty"
  })
  value.bones.push({ name: "empty", parent: "root", pivot: [0, 8, 0], rotation: [0, 0, 0], cubes: [] })

  const result = reviewModelQuality(value)

  expect(result.measured).toMatchObject({ animatedBones: 0 })
  expect(found(value)).toContain("不凑数/nothing_moves")
})

const advised = (value: ModelDesign, context: ModelReviewContext = {}) => (reviewModelQuality(value, context).advice ?? []).map((entry) => `${criterion(entry.criterion).name}/${entry.rule}`)

test("a head with nothing on it is refused; a head whose eyes the measure cannot find is only advice; the brief can say there is no face", () => {
  // The machine looks for a mirrored pair of small marks on the front and sides of the head. It cannot say that eyes are missing from a head that carries stone, horns and
  // marks, only that it did not find them: that is for whoever looks at the picture.
  const value = good()
  const skull = value.bones.find((bone) => bone.name === "head")!.cubes[0]!
  skull.features = skull.features!.filter((feature) => feature.type !== "eyes" && feature.type !== "brows")
  expect(found(value)).toEqual([])
  expect(advised(value)).toEqual(["认得出/no_face"])
  expect(reviewModelQuality(value).passed).toBe(true)

  // Eyes the colour of the skin are not found either; the same advice.
  skull.features!.push({ type: "eyes", shape: "dot", color: "#3E6285" })
  expect(found(value)).toEqual([])
  expect(advised(value)).toEqual(["认得出/no_face"])

  // A head that is one colour from every side, with nothing on it, cannot be a face: refused, whatever the creature is.
  const bare = bareHead(good())
  expect(found(bare)).toEqual(["认得出/no_face"])
  expect(advised(bare)).toEqual([])
  expect(reviewModelQuality(bare).passed).toBe(false)
  expect(reviewModelQuality(bare, { brief: "一只没有眼睛的石头守卫" }).passed).toBe(true)
  expect(advised(bare, { brief: "一只没有眼睛的石头守卫" })).toEqual([])

  // Eyes found: nothing said at all.
  expect(advised(good())).toEqual([])
})

test("a head must be named so the face can be found", () => {
  const value = good()
  value.bones.forEach((bone) => {
    if (bone.name === "head") bone.name = "front"
    if (bone.parent === "head") bone.parent = "front"
    bone.cubes.forEach((part) => (part.name = part.name === "skull" ? "block" : part.name))
  })
  value.animations.forEach((animation) => animation.channels.forEach((channel) => (channel.bone = channel.bone === "head" ? "front" : channel.bone)))

  expect(found(value)).toContain("认得出/no_head")
})

test("parts must touch, and the model must stand on the ground, unless the brief lets it float", () => {
  const apart = good()
  apart.bones.find((bone) => bone.name === "tail")!.cubes.forEach((part) => (part.origin[2] += 3))
  expect(found(apart)).toEqual(["站得住/floating_parts"])
  expect(reviewModelQuality(apart, { brief: "尾巴悬浮在身后的守卫" }).passed).toBe(true)

  const lifted = good()
  lifted.bones.forEach((bone) => {
    bone.pivot[1] += 5
    bone.cubes.forEach((part) => (part.origin[1] += 5))
  })
  expect(found(lifted)).toEqual(["站得住/off_ground"])
  // broad3: everyday ways of saying it drifts or flies are heard; a creature that only walks is still held to the ground.
  ;["一个气球怪，圆脑袋，在空中飘", "晚上出来飘来飘去的小幽灵", "一只小飞龙，在天上飞", "a little ghost that flies around", "一只半透明的圆水母，在水里一漂一漂的"].forEach((brief) => expect(reviewModelQuality(lifted, { brief }).passed).toBe(true))
  ;["一只在地上慢慢走的乌龟", "一只很漂亮的小鹿"].forEach((brief) => expect(reviewModelQuality(lifted, { brief }).passed).toBe(false))
  // broad4: unnamed parts hanging under a thing built up in the air (a jellyfish's tentacles) are not legs; on the ground they are.
  const strands = (height: number) => {
    const design = good()
    design.bones.forEach((bone) => {
      bone.pivot[1] += height
      bone.cubes.forEach((part) => (part.origin[1] += height))
      bone.name = bone.name.replace(/leg/g, "strand")
    })
    design.animations.forEach((animation) => animation.channels.forEach((channel) => (channel.bone = channel.bone.replace(/leg/g, "strand"))))
    return measureLook(design).plan
  }
  expect(strands(0)).toBe("quadruped")
  expect(strands(5)).toBe("blob")
})

// 10-14 (the owner: "no obvious errors is enough"): what is inside another part, or under the ground, is a fault only past what a player sees (`FAULT_SLACK`).
const lowered = (value: ModelDesign, by: number) => {
  value.bones.forEach((bone) => {
    bone.pivot[1] -= by
    bone.cubes.forEach((part) => (part.origin[1] -= by))
  })
  return value
}
const painted = (part: ReturnType<typeof cube>) => Object.assign(part, { paint: { material: "stone" as const, base: "#3E6285" } })

test("a model a pixel or two under the ground stands; several pixels under it, or well above it, does not", () => {
  // Under: 1.1 and 2.2 are not seen; 3 and 4 are (a fifth of a leg of this size, 2.5 pixels, is the allowance).
  ;[1.1, 2.2].forEach((by) => expect(found(lowered(good(), by)), `sunk by ${by}`).toEqual([]))
  ;[3, 4].forEach((by) => expect(found(lowered(good(), by)), `sunk by ${by}`).toEqual(["站得住/off_ground"]))
  const message = reviewModelQuality(lowered(good(), 4)).findings[0]!.message
  expect(message).toContain("陷进了地面")
  expect(message).toContain("超过 2.5 个像素玩家才看得出")
  // Above: still one pixel (the glide gate treats what is built clear of the ground as hovering, so none is given here), and 6.8 is the same fault as ever.
  expect(found(lowered(good(), -0.9))).toEqual([])
  expect(found(lowered(good(), -6.8))).toEqual(["站得住/off_ground"])
  // A tall creature gets 8 % of its height: this one is built 40 pixels high, so 3.2 pixels under pass and 4 do not.
  const tall = (by: number) => {
    const value = good()
    value.bones.forEach((bone) => {
      bone.pivot = bone.pivot.map((axis) => axis * 2) as typeof bone.pivot
      bone.cubes.forEach((part) => {
        part.origin = part.origin.map((axis) => axis * 2) as typeof part.origin
        part.size = part.size.map((axis) => axis * 2) as typeof part.size
      })
    })
    value.texture_size = 256
    return lowered(value, by)
  }
  expect(measureLook(tall(0)).slack.ground).toBeCloseTo(0.08 * measureLook(tall(0)).height, 5)
  expect(measureLook(tall(0)).slack.ground).toBeGreaterThan(3.2)
  expect(measureLook(tall(0)).slack.ground).toBeLessThan(4)
  expect(found(tall(3.2))).toEqual([])
  expect(found(tall(4))).toEqual(["站得住/off_ground"])
  // A leg that stops short of the ground by 2 pixels is on it, 4 pixels is not.
  const short = (stops: number) => {
    const value = good()
    const leg = value.bones.find((bone) => bone.name === "leg_front_left")!
    leg.cubes = leg.cubes.filter((part) => part.name !== "foot")
    leg.cubes[0]!.origin[1] = stops
    leg.cubes[0]!.size[1] = 8 - stops
    return value
  }
  expect(measureLook(short(2)).hangingLimbs).toEqual([])
  expect(measureLook(short(4)).hangingLimbs).toEqual(["leg_front_left"])
  expect(found(short(4))).toContain("站得住/hanging_limbs")
})

test("parts a pixel or two into each other at a joint are not a pile; one buried in another is", () => {
  const joined = (depth: number) => {
    const value = good()
    const body = value.bones.find((bone) => bone.name === "body")!
    // Two humps on the sides of the trunk (x from -6 to 6), each `depth` pixels into it.
    body.cubes.push(painted(cube("hump_left", [6 - depth, 8, -4], [4, 4, 8])), painted(cube("hump_right", [-10 + depth, 8, -4], [4, 4, 8])))
    return value
  }
  ;[1, 2].forEach((depth) => {
    expect(found(joined(depth)), `${depth} px in`).toEqual([])
    // Nothing of it is buried deep: what the joint adds to the deep share is nothing, the model's own 0.005 is its shoulders on its trunk.
    expect(measureLook(joined(depth)).deepBuriedShare).toBeLessThanOrEqual(measureLook(good()).deepBuriedShare)
  })
  // A cube buried whole in the trunk, 8 × 6 × 10 of it, is seen by no one; one covering most of the trunk (12 × 8 × 12 in a 12 × 8 × 15 one) is a pile.
  const buried = good()
  buried.bones.find((bone) => bone.name === "body")!.cubes.push(painted(cube("lump", [-4, 7, -5], [8, 6, 10])))
  expect(found(buried)).toEqual(["不凑数/hidden_parts"])
  const slab = good()
  slab.bones.find((bone) => bone.name === "body")!.cubes.push(painted(cube("slab", [-6, 6, -7], [12, 8, 12])))
  expect(measureLook(slab).deepBuriedShare).toBeGreaterThan(0.3)
  expect(found(slab)).toContain("不凑数/buried_volume")
  expect(reviewModelQuality(slab).findings.find((finding) => finding.rule === "buried_volume")!.message).toContain("连接处 2.5 个像素以内的穿插没有算")
  // The same humps pushed three pixels into the trunk are no longer a joint (they count towards the pile, though two of them are far from a pile).
  expect(measureLook(joined(3)).deepBuriedShare).toBeGreaterThan(measureLook(joined(2)).deepBuriedShare + 0.02)
  // Said to the maker: what a joint may have, and that a gap may not.
  const asks = MODEL_STANDARD.rules.find((rule) => rule.id === "buried_volume")!.asks
  expect(asks).toContain("连接处互相插进去 2.5 个像素以内")
  expect(MODEL_STANDARD.rules.find((rule) => rule.id === "floating_parts")!.asks).toContain("不能留缝")
  expect(MODEL_ART_DIRECTION).toContain("不用改，更不要为它花一版")
})

test("a lopsided model is refused unless the brief asks for it", () => {
  const value = good()
  value.bones = value.bones.filter((bone) => !bone.name.endsWith("_right"))
  value.animations.forEach((animation) => (animation.channels = animation.channels.filter((channel) => !channel.bone.endsWith("_right"))))
  value.bones[1]!.cubes.push(cube("growth", [6, 6, -7], [10, 8, 15]))
  value.bones[1]!.cubes.at(-1)!.paint = { material: "stone", base: "#3E6285" }

  expect(found(value)).toContain("站得住/lopsided")
  expect(found(value, { brief: "一只不对称的畸变守卫" })).not.toContain("站得住/lopsided")
})

test("a joint far from the part it turns is refused", () => {
  const value = good()
  value.bones.find((bone) => bone.name === "leg_front_left")!.pivot = [-5, 1, -5]
  expect(found(value)).toEqual(["站得住/misplaced_joint"])

  const far = good()
  far.bones.find((bone) => bone.name === "tail")!.pivot = [0, 30, 30]
  expect(found(far)).toEqual(["站得住/misplaced_joint"])
})

test("walk needs every leg swinging, pairs in opposite phase, easing, and a body that follows", () => {
  const walk = (value: ModelDesign) => value.animations.find((animation) => animation.name === "walk")!
  const still = good()
  walk(still).channels = walk(still).channels.filter((channel) => channel.bone !== "leg_hind_left")
  expect(found(still)).toEqual(["认得出/walk_legs_still"])

  const together = good()
  const lead = walk(together).channels.find((channel) => channel.bone === "leg_front_left")!
  walk(together).channels.find((channel) => channel.bone === "leg_front_right")!.keyframes = structuredClone(lead.keyframes)
  expect(found(together)).toEqual(["认得出/walk_same_phase"])

  const robot = good()
  walk(robot).channels.filter((channel) => channel.bone.startsWith("leg_")).forEach((channel) => (channel.keyframes = channel.keyframes.filter((_, index) => index % 2 === 0)))
  expect(found(robot)).toEqual(["不机械/constant_speed"])

  const frozen = good()
  walk(frozen).channels = walk(frozen).channels.filter((channel) => channel.bone.startsWith("leg_"))
  expect(found(frozen)).toEqual(["有主次/walk_body_frozen"])
})

test("idle must be present but subtle, hurt must be quick", () => {
  const set = (name: string, change: (animation: ModelDesign["animations"][number]) => void) => {
    const value = good()
    change(value.animations.find((animation) => animation.name === name)!)
    return found(value)
  }
  const pose = (rotation: [number, number, number], length: number) => [{ time: 0, rotation: [0, 0, 0] as [number, number, number] }, { time: length / 2, rotation }, { time: length, rotation: [0, 0, 0] as [number, number, number] }]

  expect(set("idle", (animation) => (animation.channels = [{ bone: "body", keyframes: pose([0, 0, 0], 3) }]))).toEqual(["认得出/idle_still"])
  expect(set("idle", (animation) => (animation.channels = [{ bone: "head", keyframes: pose([60, 0, 0], 3) }]))).toEqual(["认得出/idle_wild"])
  expect(set("hurt", (animation) => ((animation.length = 3), (animation.channels = [{ bone: "body", keyframes: pose([-10, 0, 0], 3) }])))).toEqual(["认得出/hurt_slow"])
  expect(set("hurt", (animation) => (animation.channels = [{ bone: "body", keyframes: pose([-1, 0, 0], 0.5) }]))).toEqual(["认得出/hurt_still"])
})

test("the same surface detail pasted on most cubes is refused as filler", () => {
  const value = good()
  value.bones.forEach((bone) => bone.cubes.forEach((part) => (part.surface_details = [{ face: "north", x: 0, y: 0, width: 1, height: 1, color: "#55C7D9" }])))

  expect(found(value)).toContain("不凑数/duplicates")
})

test("the same cube made twice is the same fault as the same detail pasted everywhere", () => {
  const value = good()
  const horn = value.bones.find((bone) => bone.name === "head")!.cubes.find((part) => part.name === "horn_left")!
  value.bones.find((bone) => bone.name === "head")!.cubes.push({ ...structuredClone(horn), name: "horn_again" })

  const review = reviewModelQuality(value)
  expect(found(value)).toEqual(["不凑数/duplicates"])
  expect(review.findings[0]!.message).toContain("head.horn_again")
  // A cube one pixel over is another part, not a copy.
  value.bones.find((bone) => bone.name === "head")!.cubes.at(-1)!.origin[0] += 3
  expect(found(value)).not.toContain("不凑数/duplicates")
})

test("a simple brief relaxes craft but not defects", () => {
  // No materials, so no light on it, but a face, contact, ground and motion: fine when the person asked for something simple.
  const plain = good()
  plain.bones.forEach((bone) => {
    bone.paint = undefined
    bone.cubes.forEach((part) => (part.paint = undefined))
  })
  expect(found(plain, { complexity: "low" })).toEqual(["有主次/unshaded"])
  expect(reviewModelQuality(plain, { brief: "简单低模的守卫", complexity: "low" })).toMatchObject({ passed: true, level: "simple", findings: [] })

  const faceless = bareHead(good())
  expect(found(faceless, { brief: "简单低模的守卫", complexity: "low" })).toEqual(["认得出/no_face"])
})

test("a revision of a person's own model is held only if what it started from passed; fresh AI work always is", () => {
  const legacy = design(1, false)

  // Revising a weak original of the person's own: findings are still listed, nothing is held against the work.
  expect(reviewModelQuality(legacy, { previous: legacy })).toMatchObject({ passed: true, spared: true })
  expect(reviewModelQuality(legacy, { previous: legacy }).findings.length).toBeGreaterThan(0)
  // Making a passing original worse is refused.
  expect(reviewModelQuality(design(7, false), { previous: good() })).toMatchObject({ passed: false, spared: false })
  // Outside Studio, with no tier and an explicitly simple brief, the bare service does not hold the work.
  expect(reviewModelQuality(legacy, { brief: "简单低模" })).toMatchObject({ passed: true, spared: true })
})

test("an explicit complexity tier cannot be bypassed by a simple brief or by revising", () => {
  const value = design(12, false)

  expect(reviewModelQuality(value, { brief: "简单低模", complexity: "high" }).passed).toBe(false)
  expect(reviewModelQuality(value, { previous: value, complexity: "high" }).passed).toBe(false)
})

test("a model whose faces fit no atlas cannot be measured: refused with the plain reason, not a crash", () => {
  const value = good()
  value.bones[1]!.cubes.push(...Array.from({ length: 40 }, (_, index) => cube(`slab_${index}`, [-100, 30 + index, -100], [200, 1, 200])))

  const review = reviewModelQuality(value)
  expect(review).toMatchObject({ passed: false, findings: [], measured: null, unreadable: { fix: TEXTURE_SPACE_ERROR } })
  expect(review.criteria.every((value) => value.state === "unmeasured")).toBe(true)
  expect(refusalText(review)).toContain("没法验收")
})

test("the brief an AI gets before it starts is generated from the rules that will judge it", () => {
  // Every rule's plain demand is in the model's and the texture's instructions, under its criterion's name.
  MODEL_STANDARD.rules.forEach((rule) => expect(MODEL_ART_DIRECTION).toContain(rule.asks))
  TEXTURE_STANDARD.rules.forEach((rule) => expect(TEXTURE_ART_DIRECTION).toContain(rule.asks))
  CRITERIA.forEach((value) => expect(MODEL_ART_RULES).toContain(`${value.name}——`))
  expect(MODEL_ART_RULES).toBe(standardBrief(outlineOf(MODEL_STANDARD)))
  // What a model cannot measure is said, not hidden.
  expect(MODEL_ART_RULES).toContain("配得上——这一类暂时不检查")
  expect(MODEL_ART_RULES).toContain("只有这些情况可以例外：需求明说悬浮、漂浮或环绕；需求明说它在空中或水里：飘着、漂着、悬浮、在天上、会飞或者在水里游；需求明说不对称；需求明说没有脸或没有眼睛。")
})

test("the tier is a hint about detail, never a quota, and the instructions say so", () => {
  expect(MODEL_COMPLEXITY_PRESETS.low).toMatchObject({ label: "低", minUniqueCubes: 3 })
  expect(MODEL_COMPLEXITY_PRESETS.medium).toMatchObject({ label: "中", minUniqueCubes: 4 })
  expect(MODEL_COMPLEXITY_PRESETS.high).toMatchObject({ label: "高", minUniqueCubes: 5 })
  expect(modelComplexityInstructions("high")).toContain("不数方块")
  expect(modelComplexityInstructions("low")).toContain("通常用 4–12 个体块")
  // What it says about padding is the standard's own rules for the first criterion, not a second list.
  MODEL_STANDARD.rules.filter((rule) => rule.criterion === "earns_place").forEach((rule) => expect(modelComplexityInstructions("medium")).toContain(rule.asks))
  expect(modelComplexityInstructions("medium")).toContain(`“${criterion("earns_place").name}”那一条照样检查`)
  // The syntax of paint and features is shown as a skeleton of placeholders: the JSON shape, with no subject in it (no template to copy).
  expect(MODEL_ART_DIRECTION).toContain('"material":"<material>"')
  expect(MODEL_ART_DIRECTION).toContain('"type":"<feature>"')
  expect(MODEL_PAINT_GUIDE).not.toMatch(/skull|muzzle|horn_|#3E6285|#8FF0FF|#46657F|#C9DCE2/)
  // The words of the guide still name the real fields and values the schema takes (they are the vocabulary, not an example).
  for (const word of [...MODEL_MATERIALS, ...MODEL_FEATURES]) expect(MODEL_PAINT_GUIDE).toContain(word)
})
