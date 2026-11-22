import { expect, test } from "bun:test"
import { ModelDesignSchema, type ModelDesign } from "../src/contracts"
import { told } from "../src/acceptance"
import { justifiedName, REVIEWER_INSTRUCTIONS, CRAFT_JUSTIFIED_GUIDE, CRAFT_REVIEW_RULE, SHEET_INSTRUCTIONS } from "../src/making"
import { measureLook } from "../src/model-look"
import { ANSWERABLE_DEFECTS, ANSWERABLE_RULES, DEFECT_REASONS, MODEL_STANDARD, reviewModelQuality, reviewTextureQuality, STILL_ALL, STILL_RULES, stillAnswers } from "../src/model-quality"
import { bareHead, repainted } from "./specimens"
import guardian from "./fixtures/look/good/crystal-guardian.json"
import slime from "./fixtures/look/good/sprout-slime.json"
import floatingParts from "./fixtures/look/bad/floating-parts.json"

type Vec = [number, number, number]
const paint = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })
type Detail = { face: string; x: number; y: number; width: number; height: number; color: string }
const cube = (name: string, origin: Vec, size: Vec, color: string) => ({ name, origin, size, faces: paint(color), surface_details: [] as Detail[] })
const still = ["idle", "walk", "hurt"].map((name) => ({ name, length: 1, loop: name !== "hurt", channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] as Vec }, { time: 1, rotation: [name === "walk" ? 10 : 4, 0, 0] as Vec }] }] }))
/** A creature that is nothing but a body and a head of the given cubes, seen from the front. */
const creature = (head: ReturnType<typeof cube>[]) =>
  ModelDesignSchema.parse({
    name: "probe",
    texture_size: 128,
    bones: [
      { name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [] },
      { name: "body", parent: "root", pivot: [0, 4, 0], rotation: [0, 0, 0], cubes: [cube("trunk", [-4, 0, -2], [8, 4, 4], "#7C9B83")] },
      { name: "head", parent: "body", pivot: [0, 4, -2], rotation: [0, 0, 0], cubes: head },
    ],
    animations: still,
  })

const SKIN = "#7C9B83"
const DARK = "#152332"
const LIGHT = "#F4EFC8"

test("a small head with a bead eye on each front corner has eyes, and those eye cubes are not fragments", () => {
  // The head is 4 × 2 pixels seen from the front; each eye is a 1×1×1 dark cube on the face, at its outer corner.
  const moth = creature([cube("skull", [-2, 4, -4], [4, 2, 2], SKIN), cube("eye_left", [1, 5, -5], [1, 1, 1], DARK), cube("eye_right", [-2, 5, -5], [1, 1, 1], DARK)])
  const look = measureLook(moth)
  expect(look.eyes).toBe(true)
  expect(look.tinyCubes).toEqual([])
  expect(reviewModelQuality(moth).findings.map((finding) => finding.rule)).not.toContain("no_face")

  // Cubes of one or two cells that are not the eyes still are fragments: a third and fourth bead off the face stay counted.
  const spotted = creature([cube("skull", [-2, 4, -4], [4, 2, 2], SKIN), cube("eye_left", [1, 5, -5], [1, 1, 1], DARK), cube("eye_right", [-2, 5, -5], [1, 1, 1], DARK), cube("stud_a", [-4, 1, -2], [1, 1, 1], DARK), cube("stud_b", [3, 1, -2], [1, 1, 1], DARK)])
  expect(measureLook(spotted).tinyCubes).toEqual(["head.stud_a", "head.stud_b"])
})

test("a horn standing above a wide head is not an eye, in the middle of the head or at its outer edge", () => {
  // A wide plain head with a horn rising from each side, each horn painted light at its tip: the tips are a mirrored pair of one colour,
  // the shape of a pair of eyes, but they stand in air. At the outer edge of the head only one flank of a tip is inside the head's grid.
  const horn = (name: string, x: number) => ({ ...cube(name, [x, 8, -4], [2, 4, 2], SKIN), surface_details: [{ face: "north", x: 0, y: 0, width: 2, height: 1, color: LIGHT }] })
  const horned = (x: number) => creature([cube("skull", [-4, 4, -4], [8, 4, 4], SKIN), horn("horn_left", x), horn("horn_right", -x - 2)])
  expect(measureLook(horned(2)).eyes).toBe(false)
  expect(measureLook(horned(-1)).eyes).toBe(false)
  // The machine cannot tell horn tips from eyes on a stalk, so a horned head with no eyes found is advice (look at it yourself), not a refusal; a head with nothing on it at all is the refusal below.
  const horny = reviewModelQuality(horned(2))
  expect(horny.findings.map((finding) => finding.rule)).not.toContain("no_face")
  expect(horny.advice?.map((entry) => entry.rule)).toContain("no_face")
})

const spoiled = (): ModelDesign => {
  const value = ModelDesignSchema.parse(structuredClone(guardian.model))
  // Six one-pixel cubes dotted on the trunk: a craft fault (tiny_fragments).
  const trunk = value.bones.find((bone) => bone.cubes.length > 0 && !/head/i.test(bone.name))!
  trunk.cubes.push(...Array.from({ length: 6 }, (_, index) => ModelDesignSchema.shape.bones.element.shape.cubes.element.parse(cube(`dot_${index}`, [-3 + index, 0, 1], [1, 1, 1], "#D8C070"))))
  return value
}
const rules = (value: ModelDesign, justified?: { what: string; reason: string }[]) => reviewModelQuality(value, { justified }).findings.map((finding) => finding.rule)

test("a craft finding the part sheet answers with a reason no longer blocks, and the reason travels with it", () => {
  const value = spoiled()
  const before = reviewModelQuality(value)
  expect(before.findings.map((finding) => [finding.rule, finding.severity])).toEqual([["tiny_fragments", "craft"]])
  expect(before.passed).toBe(false)
  // It ends the way a measured motion fault's finding does.
  expect(before.findings[0]!.fix).toContain('，再看一版；如果它本来就该这样，在部件说明的 justified 里写上这一项和理由（{"what":"tiny_fragments","reason":"……"}），理由会原样给评审和人看。')

  const after = reviewModelQuality(value, { justified: [{ what: "tiny_fragments", reason: "它身上就是一粒一粒的晶砂" }] })
  expect(after.findings).toEqual([])
  expect(after.passed).toBe(true)
  expect(after.criteria.find((entry) => entry.id === "earns_place")!.state).toBe("passed")
  expect(after.answered).toEqual([expect.objectContaining({ rule: "tiny_fragments", reason: "它身上就是一粒一粒的晶砂" })])
  expect(told(after).answered).toEqual([{ criterion: "不凑数", message: expect.stringContaining("碎块太多"), reason: "它身上就是一粒一粒的晶砂" }])
  // Named as the person reads it, not as the sheet spelt it; written loosely it still answers; an empty reason or another rule does not.
  expect(justifiedName("tiny_fragments")).toBe("不凑数：爪尖、斑点这类细节画在表面，不要用一两格大的碎块堆（贴在头上、看得出是一对眼睛的单色小方块不算碎块）")
  expect(rules(value, [{ what: " Tiny_Fragments ", reason: "晶砂" }])).toEqual([])
  expect(rules(value, [{ what: "tiny_fragments", reason: "  " }])).toEqual(["tiny_fragments"])
  expect(rules(value, [{ what: "flat_surfaces", reason: "无关" }])).toEqual(["tiny_fragments"])
})

/** The guardian with a bare head: one colour on every cube of it, nothing painted on it (a machine's, a plant's, a slime's face). */
const eyeless = () => bareHead(ModelDesignSchema.parse(structuredClone(guardian.model)))
/** The guardian with its eyes taken off but its head still painted (stone, horns): the machine cannot find a face and cannot say there is none. */
const unconfirmed = () => {
  const value = ModelDesignSchema.parse(structuredClone(guardian.model))
  const skull = value.bones.find((bone) => bone.name === "head")!.cubes[0]!
  skull.features = skull.features!.filter((feature) => feature.type !== "eyes" && feature.type !== "brows")
  return value
}
/** The guardian with no bone or cube that is a head. */
const headless = () => {
  const value = ModelDesignSchema.parse(structuredClone(guardian.model))
  const head = value.bones.find((bone) => bone.name === "head")!
  head.name = "dome"
  head.cubes.forEach((box, index) => (box.name = `dome_${index}`))
  value.bones.forEach((bone) => bone.parent === "head" && (bone.parent = "dome"))
  return value
}

test("a defect that is an error whatever the thing is is only changed: a reason written for it is not read, and its finding does not point at the sheet", () => {
  // The same block made twice: an error whatever the thing is. A reason written for every rule of the standard does not set it aside.
  const twice = ModelDesignSchema.parse(structuredClone(guardian.model))
  const trunk = twice.bones.find((bone) => bone.cubes.length > 0 && !/head/i.test(bone.name))!
  trunk.cubes.push({ ...structuredClone(trunk.cubes[0]!), name: "twin" })
  const review = reviewModelQuality(twice, { justified: MODEL_STANDARD.rules.map((rule) => ({ what: rule.id, reason: "它本来就这样" })) })
  expect(review.findings.map((finding) => [finding.rule, finding.severity])).toEqual([["duplicates", "defect"]])
  expect(review.passed).toBe(false)
  // Whatever craft finding the copy brings with it is answered; the defect is not.
  expect((review.answered ?? []).map((finding) => finding.severity)).not.toContain("defect")
  expect(review.findings[0]!.fix).not.toContain("justified")
  MODEL_STANDARD.rules.filter((rule) => rule.severity === "defect" && !ANSWERABLE_DEFECTS.includes(rule.id)).forEach((rule) => expect(ANSWERABLE_RULES).not.toContain(rule.id))
})

test("a missing face or head is a defect that the part sheet may answer with a reason, and the reason travels with it", () => {
  const value = eyeless()
  const before = reviewModelQuality(value)
  expect(before.findings.map((finding) => [finding.rule, finding.severity])).toEqual([["no_face", "defect"]])
  expect(before.passed).toBe(false)
  // It ends the way a craft finding and a measured motion fault do: change it, or say in the sheet why it is meant.
  expect(before.findings[0]!.fix).toContain('，再看一版；如果它本来就该这样，在部件说明的 justified 里写上这一项和理由（{"what":"no_face","reason":"……"}），理由会原样给评审和人看。')

  const after = reviewModelQuality(value, { justified: [{ what: "no_face", reason: "它是一台炮台，转的只是炮管，没有眼睛" }] })
  expect(after.findings).toEqual([])
  expect(after.passed).toBe(true)
  expect(after.answered).toEqual([expect.objectContaining({ rule: "no_face", severity: "defect", reason: "它是一台炮台，转的只是炮管，没有眼睛" })])
  expect(told(after).answered).toEqual([{ criterion: "认得出", message: expect.stringContaining("什么记号都没有"), reason: "它是一台炮台，转的只是炮管，没有眼睛" }])
  expect(justifiedName("no_face")).toStartWith("认得出：")
  // Written loosely it answers; an empty reason or another rule's does not.
  expect(rules(value, [{ what: " No_Face ", reason: "炮台" }])).toEqual([])
  expect(rules(value, [{ what: "no_face", reason: "  " }])).toEqual(["no_face"])
  expect(rules(value, [{ what: "no_head", reason: "炮台" }])).toEqual(["no_face"])

  // A head that cannot be found is answered the same way, and is not mistaken for the other.
  const bald = headless()
  expect(reviewModelQuality(bald).findings.map((finding) => [finding.rule, finding.severity])).toEqual([["no_head", "defect"]])
  expect(reviewModelQuality(bald).findings[0]!.fix).toContain('{"what":"no_head","reason":"……"}')
  expect(rules(bald, [{ what: "no_head", reason: "它是一块会走的石碑，没有头" }])).toEqual([])

  // Only those two: the craft one beside it is answered by its own entry, and a defect of another kind next to them still stops it.
  const both = eyeless()
  both.bones.find((bone) => bone.name === "body")!.cubes.push(...Array.from({ length: 6 }, (_, index) => ModelDesignSchema.shape.bones.element.shape.cubes.element.parse(cube(`dot_${index}`, [-3 + index, 0, 1], [1, 1, 1], "#D8C070"))))
  expect(rules(both, [{ what: "no_face", reason: "炮台" }])).toEqual(["tiny_fragments"])
  expect(rules(both, [{ what: "no_face", reason: "炮台" }, { what: "tiny_fragments", reason: "晶砂" }])).toEqual([])
})

test("a texture's face finding is answered the same way, so the model that wears it is not blocked by a defect that was answered", () => {
  const value = eyeless()
  const skin = repainted(value)
  expect(reviewTextureQuality(value, skin).findings.map((finding) => finding.rule)).toContain("no_face")
  const answered = reviewTextureQuality(value, skin, { justified: [{ what: "no_face", reason: "炮台" }] })
  expect(answered.findings.map((finding) => finding.rule)).not.toContain("no_face")
  expect(answered.answered).toEqual([expect.objectContaining({ rule: "no_face", reason: "炮台" })])
})

test("every craft rule of the model standard and the defects that are a fact about the thing can be answered, no other defect can, and the maker and the reviewer are told so", () => {
  const facts = ["no_head", "no_face", "off_ground", "floating_parts", "too_few_parts", "walk_same_phase"]
  expect(ANSWERABLE_DEFECTS).toEqual(facts)
  expect(Object.keys(DEFECT_REASONS)).toEqual(facts)
  expect(ANSWERABLE_RULES).toEqual(MODEL_STANDARD.rules.filter((rule) => rule.severity === "craft" || facts.includes(rule.id)).map((rule) => rule.id))
  expect(ANSWERABLE_RULES).toContain("tiny_fragments")
  facts.forEach((id) => expect(ANSWERABLE_RULES).toContain(id))
  // The ids named above are defects of the standard, and they are the only defects in the list.
  expect(MODEL_STANDARD.rules.filter((rule) => ANSWERABLE_RULES.includes(rule.id) && rule.severity === "defect").map((rule) => rule.id)).toEqual(MODEL_STANDARD.rules.filter((rule) => facts.includes(rule.id)).map((rule) => rule.id))
  expect(MODEL_STANDARD.rules.some((rule) => rule.severity === "defect" && !ANSWERABLE_RULES.includes(rule.id))).toBe(true)
  ANSWERABLE_RULES.forEach((id) => expect(justifiedName(id)).not.toBe(id))
  // What is said to the maker and the reviewer is generated from the same list, so every answerable rule is named by its plain name in each (never its id:
  // no rule id is told outside a finding's own justified tail), and no other defect is.
  for (const text of [CRAFT_JUSTIFIED_GUIDE, CRAFT_REVIEW_RULE, SHEET_INSTRUCTIONS]) {
    for (const id of facts) {
      expect(text).not.toContain(id)
      expect(text).toContain(DEFECT_REASONS[id]!.name)
    }
    expect(text).not.toContain("hidden_parts")
    expect(text).not.toContain("duplicates")
  }
  expect(SHEET_INSTRUCTIONS).toContain("规则名")
  expect(CRAFT_JUSTIFIED_GUIDE).toContain("硬伤")
  expect(REVIEWER_INSTRUCTIONS).toContain("tiny_fragments")
  // The nothing-moves rule is answered by declaring every clip still, and the words say which ones and that one is not enough.
  Object.entries(STILL_ALL).forEach(([rule, motions]) => {
    expect(CRAFT_JUSTIFIED_GUIDE).not.toContain(rule)
    motions.forEach((motion) => expect(CRAFT_JUSTIFIED_GUIDE).toContain(motion))
    expect(CRAFT_REVIEW_RULE).toContain(motions.join("、"))
  })
  // The reviewer judges the reason against the pictures; there is no list of subjects allowed to lack a face or a head (owner, 10-14), and a plain animal head with no eyes is still a fault.
  expect(CRAFT_REVIEW_RULE).toContain("对着图判断")
  expect(CRAFT_REVIEW_RULE).toContain("动物")
  for (const text of [CRAFT_REVIEW_RULE, CRAFT_JUSTIFIED_GUIDE]) expect(text).not.toMatch(/机器、植物|石头魔像|史莱姆/)
})

test("a motion the sheet declares still is not held to how it moves: the walk of a thing that never walks (broad15)", () => {
  const value = ModelDesignSchema.parse(structuredClone(guardian.model))
  const walk = value.animations.find((animation) => animation.name === "walk")!
  walk.channels = []
  const rules = (justified?: { what: string; reason: string }[]) => reviewModelQuality(value, { justified }).findings.map((finding) => finding.rule)
  const before = rules()
  expect(before).toContain("walk_legs_still")
  const finding = reviewModelQuality(value).findings.find((entry) => entry.rule === "walk_legs_still")!
  expect(finding.fix).toContain("在部件说明的 still 里写上这个动作和理由")
  // Declared still: every walk rule is answered, with the sheet's own reason; nothing about idle or hurt is.
  const answers = stillAnswers({ walk: "固定在地上的弩炮塔，从来不走路" })
  expect(answers.map((entry) => entry.what).sort()).toEqual(Object.entries(STILL_RULES).filter(([, motion]) => motion === "walk").map(([rule]) => rule).sort())
  const after = reviewModelQuality(value, { justified: answers })
  expect(after.findings.map((entry) => entry.rule).filter((rule) => STILL_RULES[rule] === "walk")).toEqual([])
  expect(after.answered?.find((entry) => entry.rule === "walk_legs_still")?.reason).toContain("从来不走路")
  // An idle declared still does not excuse the walk.
  expect(rules(stillAnswers({ idle: "雕像" }))).toContain("walk_legs_still")
})

test("bead eyes half a pixel off the grid on a two-pixel head are eyes (broad15 gull v4)", () => {
  const head = (eyeY: number) => [cube("skull", [-1.5, 8, -7], [3, 2, 3], SKIN), cube("eye_left", [0.5, eyeY, -7.5], [1, 1, 1], DARK), cube("eye_right", [-1.5, eyeY, -7.5], [1, 1, 1], DARK)]
  for (const y of [8.5, 9]) {
    const look = measureLook(creature(head(y)))
    expect(look.eyes).toBe(true)
    expect(look.tinyCubes).not.toContain("head.eye_left")
  }
  // In the bottom pixel row of the head they are not where eyes go.
  expect(measureLook(creature(head(8))).eyes).toBe(false)
})
