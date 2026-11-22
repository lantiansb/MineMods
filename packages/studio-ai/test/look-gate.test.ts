import { expect, test } from "bun:test"
import { Glob } from "bun"
import path from "node:path"
import { CRITERIA, criterion, told, type AssetReview } from "../src/acceptance"
import { ModelDesignSchema } from "../src/contracts"
import { LOOK_LIMITS, MODEL_STANDARD, TEXTURE_STANDARD, reviewModelQuality, reviewTextureQuality } from "../src/model-quality"
import { MOTION_MEASURES, measureLook, type LookTexture } from "../src/model-look"
import { ADVISED, SPOILED, bareHead } from "./specimens"

// The specimens are evidence for the standard, not the standard itself: each one is kept for what it shows
// about a criterion. The rules and their limits live with the measurements in src/model-quality.ts.
type Specimen = { name: string; brief: string; model: unknown; texture?: LookTexture }
type Name = (typeof CRITERIA)[number]["name"]
type Evidence = Partial<Record<Name, string[]>>

const directory = path.join(import.meta.dir, "fixtures", "look")
const load = async (folder: string) =>
  Promise.all([...new Glob("*.json").scanSync(path.join(directory, folder))].sort().map((file) => Bun.file(path.join(directory, folder, file)).json() as Promise<Specimen>))
const judge = (specimen: Specimen) => {
  const design = ModelDesignSchema.parse(specimen.model)
  return {
    model: reviewModelQuality(design, { brief: specimen.brief, complexity: "medium" }),
    texture: specimen.texture ? reviewTextureQuality(design, specimen.texture, { brief: specimen.brief }) : null,
  }
}
/** What a review found, as criterion → rules. */
const broken = (review: AssetReview | null) =>
  Object.fromEntries(CRITERIA.map((value) => [value.name, (review?.findings ?? []).filter((finding) => finding.criterion === value.id).map((finding) => finding.rule)]).filter((entry) => entry[1]!.length)) as Evidence

// 蓝晶 guardian (lanjing-guard) is the named regression evidence for models and textures: the real AI output
// the owner threw out. Which criterion each rejected specimen violates, and by which rule. A specimen may pick up other findings;
// these are the ones it is kept for. lanjing-guard is the real AI output that was accepted on 2026-10-05 and
// should never have been.
export const REJECTED: Record<string, { model: Evidence; texture: Evidence }> = {
  "lanjing-guard": {
    // Its head has two one-pixel eye cubes the pair-finder does not recognise (pale blue on a blue head): the real output was never refused for a missing face but for the rest.
    model: { 不凑数: ["duplicates", "tiny_fragments"], 不机械: ["constant_speed"], 有主次: ["flat_surfaces"], 站得住: ["floating_parts"] },
    texture: { 不机械: ["same_fill", "noisy_texture"], 有主次: ["few_tones", "unshaded"] },
  },
  "noise-texture": { model: {}, texture: { 不机械: ["noisy_texture"] } },
  "one-pattern": { model: {}, texture: { 不机械: ["same_fill"] } },
  "padded-pile": { model: { 不凑数: ["hidden_parts", "buried_volume", "tiny_fragments"] }, texture: {} },
  "faceless-flat": { model: { 认得出: ["no_face"], 有主次: ["flat_surfaces", "unshaded"] }, texture: {} },
  "floating-parts": { model: { 站得住: ["floating_parts"] }, texture: {} },
  "stiff-walker": { model: { 不机械: ["constant_speed"], 认得出: ["walk_same_phase", "idle_still", "hurt_slow"] }, texture: {} },
}

test("each rejected specimen violates the criteria it is kept for", async () => {
  const specimens = await load("bad")
  expect(specimens.map((specimen) => specimen.name).sort()).toEqual(Object.keys(REJECTED).sort())
  specimens.forEach((specimen) => {
    const verdict = judge(specimen)
    const wanted = REJECTED[specimen.name]!
    expect({ name: specimen.name, passed: verdict.model.passed && (verdict.texture?.passed ?? true) }).toEqual({ name: specimen.name, passed: false })
    ;(["model", "texture"] as const).forEach((side) =>
      Object.entries(wanted[side]).forEach(([name, rules]) => expect({ name: specimen.name, side, criterion: name, rules: broken(verdict[side])[name as Name] ?? [] }).toEqual({ name: specimen.name, side, criterion: name, rules: expect.arrayContaining(rules) })),
    )
    // A specimen that isolates one family must not be refused for anything else.
    if (Object.keys(wanted.model).length === 0) expect({ name: specimen.name, findings: verdict.model.findings }).toEqual({ name: specimen.name, findings: [] })
    // Every finding names its criterion and says, separately, what was found and what to change.
    ;[...verdict.model.findings, ...(verdict.texture?.findings ?? [])].forEach((finding) => {
      expect(criterion(finding.criterion).name.length).toBe(3)
      expect([...`${finding.message}${finding.fix}`].filter((letter) => letter >= "一" && letter <= "鿿").length).toBeGreaterThan(12)
    })
  })
})

test("the specimen that started this is refused on every path it took: model alone, texture alone, at every tier, simple or not", async () => {
  const specimen = (await load("bad")).find((value) => value.name === "lanjing-guard")!
  const design = ModelDesignSchema.parse(specimen.model)
  ;(["low", "medium", "high", undefined] as const).forEach((complexity) => {
    expect(reviewModelQuality(design, { brief: specimen.brief, complexity }).passed).toBe(false)
    if (complexity) expect(reviewModelQuality(design, { brief: "简单低模的守卫", complexity }).passed).toBe(false)
  })
  expect(reviewTextureQuality(design, specimen.texture!, { brief: "简单低模的守卫", insisted: true }).passed).toBe(false)
  expect(reviewTextureQuality(design, specimen.texture!, { previous: specimen.texture!, insisted: true }).passed).toBe(false)
  // Redoing it from itself is still AI work judged in full once a tier is chosen.
  expect(reviewModelQuality(design, { previous: design, complexity: "medium" }).passed).toBe(false)
})

test("accepted specimens pass every criterion a model can be measured on, at every tier", async () => {
  const specimens = await load("good")
  expect(specimens.length).toBeGreaterThanOrEqual(5)
  expect(new Set(specimens.map((specimen) => judge(specimen).model.measured!.plan)).size).toBeGreaterThanOrEqual(4)
  specimens.forEach((specimen) =>
    (["low", "medium", "high"] as const).forEach((complexity) => {
      const review = reviewModelQuality(ModelDesignSchema.parse(specimen.model), { brief: specimen.brief, complexity })
      expect({ name: specimen.name, complexity, findings: review.findings }).toEqual({ name: specimen.name, complexity, findings: [] })
      // Passed where it is measured, and honest where it is not: a model alone cannot be checked against other assets.
      expect(review.criteria.map((value) => value.state)).toEqual(["passed", "passed", "passed", "passed", "passed", "unmeasured"])
    }),
  )
})

test("thresholds sit between the two sets with room on both sides", async () => {
  type Look = { name: string; buriedShare: number; deepBuriedShare: number; flatShare: number; sameFillShare: number; speckShare: number; tones: number; shadedShare: number; eyes: boolean; floating: number; tinyCubes: number }
  const good = (await load("good")).map((specimen) => ({ name: specimen.name, ...judge(specimen).model.measured }) as Look)
  good.forEach((look) => {
    expect({ name: look.name, ok: look.deepBuriedShare <= LOOK_LIMITS.buriedShare * 0.5 }).toEqual({ name: look.name, ok: true })
    expect({ name: look.name, ok: look.flatShare <= LOOK_LIMITS.flatShare * 0.3 }).toEqual({ name: look.name, ok: true })
    expect({ name: look.name, ok: look.sameFillShare <= LOOK_LIMITS.sameFillShare * 0.75 }).toEqual({ name: look.name, ok: true })
    expect({ name: look.name, ok: look.speckShare <= LOOK_LIMITS.speckShare * 0.75 }).toEqual({ name: look.name, ok: true })
    expect(look.tones).toBeGreaterThanOrEqual(LOOK_LIMITS.tones * 2)
    expect(look.shadedShare).toBeGreaterThanOrEqual(LOOK_LIMITS.shadedShare * 1.5)
    expect(look).toMatchObject({ eyes: true, floating: 0, tinyCubes: 0 })
  })
  const bad = Object.fromEntries((await load("bad")).map((specimen) => [specimen.name, judge(specimen)]))
  const of = (name: string, side: "model" | "texture") => bad[name]![side]!.measured as Look
  expect(of("lanjing-guard", "texture").sameFillShare).toBeGreaterThan(LOOK_LIMITS.sameFillShare * 1.15)
  expect(of("one-pattern", "texture").sameFillShare).toBeGreaterThan(LOOK_LIMITS.sameFillShare * 1.15)
  // Dots are refused only beyond `speckNoise`; every noisy specimen lies above it, the accepted ones far below `speckShare`.
  expect(of("lanjing-guard", "texture").speckShare).toBeGreaterThan(LOOK_LIMITS.speckNoise)
  expect(of("noise-texture", "texture").speckShare).toBeGreaterThan(LOOK_LIMITS.speckNoise * 2)
  expect(LOOK_LIMITS.speckShare).toBeLessThan(LOOK_LIMITS.speckNoise)
  expect(of("lanjing-guard", "model").flatShare).toBeGreaterThan(LOOK_LIMITS.flatShare * 1.3)
  expect(of("faceless-flat", "model").flatShare).toBeGreaterThan(LOOK_LIMITS.flatShare * 1.3)
  // The pile is stopped by its mostly covered cubes (9 of 37) and, narrowly, by what is buried beyond a joint (0.214 of its volume; 0.061 in the accepted specimen nearest the limit).
  const pile = measureLook(ModelDesignSchema.parse(((await load("bad")).find((value) => value.name === "padded-pile")!).model))
  expect(pile.buriedCubes.length).toBeGreaterThan(pile.cubes * LOOK_LIMITS.buriedCubes * 1.15)
  expect(pile.buriedShare).toBeGreaterThan(0.2)
  expect(pile.deepBuriedShare).toBeGreaterThan(LOOK_LIMITS.buriedShare)
})

test("a good texture on a good model passes, and a texture of the wrong size does not fit it", async () => {
  const specimen = (await load("good")).find((value) => value.name === "bog-goblin")!
  const design = ModelDesignSchema.parse(specimen.model)
  const { paintModel } = await import("../src/model-paint")
  const painted = paintModel(design)
  // The model's own painted atlas, read back as a palette texture: the same look by another road.
  const palette = [...new Set(Array.from({ length: painted.size * painted.size }, (_, index) => `#${[0, 1, 2].map((channel) => painted.pixels[index * 4 + channel]!.toString(16).padStart(2, "0")).join("")}`))]
  const texture = { width: painted.size, height: painted.size, palette, pixels: Array.from({ length: painted.size * painted.size }, (_, index) => palette.indexOf(`#${[0, 1, 2].map((channel) => painted.pixels[index * 4 + channel]!.toString(16).padStart(2, "0")).join("")}`)) }

  const fitting = reviewTextureQuality(design, texture, { brief: specimen.brief })
  expect(fitting).toMatchObject({ passed: true, findings: [] })
  // On a model, a texture is measured on four criteria and honestly not on two.
  expect(fitting.criteria.map((value) => [value.name, value.state])).toEqual([["不凑数", "unmeasured"], ["不机械", "passed"], ["认得出", "passed"], ["有主次", "passed"], ["站得住", "unmeasured"], ["配得上", "passed"]])
  const small = reviewTextureQuality(design, { ...texture, width: 32, height: 32, pixels: texture.pixels.slice(0, 1024) })
  expect(broken(small)).toEqual({ 配得上: ["wrong_size"] })
  expect(small.findings[0]!.fix).toContain(`${design.texture_size}×${design.texture_size}`)
})

test("revising a person's own texture is not blocked, revising one that passed is, and a richer ask always is", async () => {
  const bad = (await load("bad")).find((value) => value.name === "lanjing-guard")!
  const design = ModelDesignSchema.parse(bad.model)

  expect(reviewTextureQuality(design, bad.texture!, { previous: bad.texture! })).toMatchObject({ passed: true, spared: true })
  expect(reviewTextureQuality(design, bad.texture!, { previous: bad.texture!, brief: "画得更精细" }).passed).toBe(false)
  expect(reviewTextureQuality(design, bad.texture!).passed).toBe(false)
})

test("every model and texture rule belongs to one criterion, and each kind says which criteria it cannot measure", () => {
  const ids = CRITERIA.map((value) => value.id)
  ;[MODEL_STANDARD, TEXTURE_STANDARD].forEach((standard) => {
    expect(new Set(standard.rules.map((rule) => rule.id)).size).toBe(standard.rules.length)
    standard.rules.forEach((rule) => expect(ids).toContain(rule.criterion))
    // A criterion is either read by a rule or listed as not measured, never both and never neither.
    ids.forEach((id) => expect({ kind: standard.kind, id, covered: standard.rules.some((rule) => rule.criterion === id) !== (standard.unmeasured[id] !== undefined) }).toEqual({ kind: standard.kind, id, covered: true }))
  })
})

test("each spoiled specimen breaks exactly the rules it names, and nothing else", () => {
  expect(new Set(SPOILED.map((specimen) => specimen.name)).size).toBe(SPOILED.length)
  SPOILED.forEach((specimen) => {
    const review = specimen.texture ? reviewTextureQuality(specimen.model, specimen.texture, { brief: specimen.brief, insisted: true }) : reviewModelQuality(specimen.model, { brief: specimen.brief, complexity: specimen.complexity ?? "medium" })
    expect({ name: specimen.name, rules: review.findings.map((finding) => finding.rule).sort() }).toEqual({ name: specimen.name, rules: [...specimen.rules].sort() })
    expect(specimen.why.length).toBeGreaterThan(3)
  })
})

test("every model rule and every texture rule has a specimen that violates it", async () => {
  const files = (await load("bad")).map(judge)
  const fired = (side: "model" | "texture") =>
    new Set([...files.flatMap((verdict) => (verdict[side]?.findings ?? []).map((finding) => finding.rule)), ...SPOILED.filter((specimen) => Boolean(specimen.texture) === (side === "texture")).flatMap((specimen) => specimen.rules)])
  expect(MODEL_STANDARD.rules.map((rule) => rule.id).filter((id) => !fired("model").has(id))).toEqual([])
  expect(TEXTURE_STANDARD.rules.map((rule) => rule.id).filter((id) => !fired("texture").has(id))).toEqual([])
})

test("the limits without a specimen file sit between the accepted specimens and the spoiled ones", async () => {
  const look = (design: Parameters<typeof measureLook>[0]) => measureLook(design)
  const good = (await load("good")).map((specimen) => ({ name: specimen.name, ...look(ModelDesignSchema.parse(specimen.model)) }))
  const bad = Object.fromEntries(SPOILED.filter((specimen) => !specimen.texture).map((specimen) => [specimen.name, look(specimen.model)]))
  const legged = good.filter((value) => value.plan === "biped" || value.plan === "quadruped")
  good.forEach((value) => {
    expect({ name: value.name, ground: value.ground, twins: value.twinCubes, hidden: value.hiddenDetailShare, hanging: value.hangingLimbs }).toEqual({ name: value.name, ground: 0, twins: [], hidden: 0, hanging: [] })
    if (value.plan !== "serpent") expect(value.lopsidedShare).toBeLessThan(LOOK_LIMITS.lopsidedShare * 0.1)
    expect(Math.max(0, ...value.pivots.map((pivot) => pivot.gap))).toBe(0)
    expect(value.idleSpan).toBeGreaterThanOrEqual(LOOK_LIMITS.idleSpan[0] * 10)
    expect(value.idleSpan).toBeLessThanOrEqual(LOOK_LIMITS.idleSpan[1] * 0.5)
    expect(value.hurtTurn).toBeGreaterThanOrEqual(LOOK_LIMITS.hurtTurn * 4)
    expect(value.hurtLength).toBeLessThanOrEqual(LOOK_LIMITS.hurtLength * 0.5)
    expect(value.hurtPeakAt).toBeLessThanOrEqual(LOOK_LIMITS.hurtPeakAt * 0.5)
  })
  legged.forEach((value) => {
    expect(value.headShare).toBeGreaterThanOrEqual(LOOK_LIMITS.headShare[0] * 5)
    expect(value.headShare).toBeLessThanOrEqual(LOOK_LIMITS.headShare[1] * 0.8)
    expect(value.limbShare).toBeGreaterThanOrEqual(LOOK_LIMITS.limbShare[0] * 2)
    expect(value.limbShare).toBeLessThanOrEqual(LOOK_LIMITS.limbShare[1] * 0.5)
  })
  expect(bad["lifted-guardian"]!.ground).toBeGreaterThan(LOOK_LIMITS.groundSlack * 3)
  expect(bad["one-sided"]!.lopsidedShare).toBeGreaterThan(LOOK_LIMITS.lopsidedShare)
  expect(bad["pin-head"]!.headShare).toBeLessThan(LOOK_LIMITS.headShare[0] * 0.7)
  expect(bad["stub-legs"]!.limbShare).toBeLessThan(LOOK_LIMITS.limbShare[0] * 0.6)
  expect(Math.max(...bad["loose-joint"]!.pivots.map((pivot) => pivot.gap))).toBeGreaterThan(LOOK_LIMITS.jointGap * 5)
  expect(bad["covered-marks"]!.hiddenDetailShare).toBeGreaterThan(LOOK_LIMITS.hiddenDetailShare * 2)
  expect(bad["speckled-guardian"]!.speckShare).toBeGreaterThan(LOOK_LIMITS.speckNoise)
  expect(bad["thrashing-idle"]!.idleSpan).toBeGreaterThan(LOOK_LIMITS.idleSpan[1] * 1.4)
  expect(bad["numb-hurt"]!.hurtTurn).toBeLessThan(LOOK_LIMITS.hurtTurn * 0.5)
  expect(bad["slow-hurt"]!.hurtLength).toBeGreaterThan(LOOK_LIMITS.hurtLength * 2)
  // What the measurement calls a stride is the same number a walk is held to.
  expect(LOOK_LIMITS.walkSwing).toBe(MOTION_MEASURES.swing)
})

test("what the measure cannot tell a fault from is advice: it passes, says so beside the criterion, and nothing else is found", () => {
  expect(new Set(ADVISED.map((specimen) => specimen.name)).size).toBe(ADVISED.length)
  ADVISED.forEach((specimen) => {
    const review = reviewModelQuality(specimen.model, { complexity: "medium" })
    expect({ name: specimen.name, passed: review.passed, findings: review.findings.map((finding) => finding.rule), advice: (review.advice ?? []).map((entry) => entry.rule) }).toEqual({ name: specimen.name, passed: true, findings: [], advice: specimen.advice })
    // The criterion that noticed is not failed, and the rule is not ticked as passed with its numbers either.
    expect(review.criteria.filter((value) => value.state === "failed")).toEqual([])
    // An AI is told it too, as a note and not as a reason to redo: no rule name in it.
    const said = told(review)
    expect(said.advice?.map((entry) => entry.criterion)).toEqual(["认得出"])
    expect(JSON.stringify(said)).not.toMatch(/no_face|noisy_texture/)
    expect(said.text).toBeNull()
  })
})

test("a studded surface (a light dot on every other texel) is advice, not noise; real noise and a head with nothing on it are still refused", () => {
  type Vec = [number, number, number]
  const flat = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })
  const cube = (name: string, origin: Vec, size: Vec, color: string, details: { face: string; x: number; y: number; width: number; height: number; color: string }[] = []) => ({ name, origin, size, faces: flat(color), surface_details: details })
  const still = ["idle", "walk", "hurt"].map((name) => ({ name, length: 1, loop: name !== "hurt", channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] as Vec }, { time: 1, rotation: [name === "walk" ? 10 : 4, 0, 0] as Vec }] }] }))
  // A small trunk with a stud on every other texel of five faces (36 of them: a document holds at most 64 details on one cube), a head with a pair of dark eyes.
  const size: Vec = [6, 6, 4]
  const studs = (["north", "south", "east", "west", "up"] as const).flatMap((face) => {
    const [width, height] = face === "up" ? [size[0], size[2]] : face === "north" || face === "south" ? [size[0], size[1]] : [size[2], size[1]]
    return Array.from({ length: width * height }, (_, index) => ({ face, x: index % width, y: Math.floor(index / width), width: 1, height: 1, color: "#F4EFC8" })).filter((dot) => dot.x % 2 === 1 && dot.y % 2 === 1)
  })
  const studded = ModelDesignSchema.parse({
    name: "studded",
    texture_size: 128,
    bones: [
      { name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [] },
      { name: "body", parent: "root", pivot: [0, 4, 0], rotation: [0, 0, 0], cubes: [cube("trunk", [-3, 0, -2], size, "#7C9B83", studs)] },
      { name: "head", parent: "body", pivot: [0, 6, -2], rotation: [0, 0, 0], cubes: [cube("skull", [-3, 6, -4], [6, 4, 4], "#7C9B83"), cube("eye_left", [1, 8, -5], [1, 1, 1], "#152332"), cube("eye_right", [-2, 8, -5], [1, 1, 1], "#152332")] },
    ],
    animations: still,
  })
  const look = measureLook(studded)
  // Between the two limits: before there was one limit (0.09) and a model like this was refused for noise.
  expect(look.speckShare).toBeGreaterThan(LOOK_LIMITS.speckShare)
  expect(look.speckShare).toBeLessThanOrEqual(LOOK_LIMITS.speckNoise)
  const review = reviewModelQuality(studded)
  expect(review.findings.map((finding) => finding.rule)).not.toContain("noisy_texture")
  expect(review.advice?.map((entry) => entry.rule)).toEqual(["noisy_texture"])
  // Dots on every other texel of every face of a whole model: noise.
  const spoiled = SPOILED.find((specimen) => specimen.name === "speckled-guardian")!
  expect(reviewModelQuality(spoiled.model).findings.map((finding) => finding.rule)).toContain("noisy_texture")
  expect(reviewModelQuality(spoiled.model).advice?.map((entry) => entry.rule) ?? []).not.toContain("noisy_texture")
  // A head with nothing on it: still a refusal.
  const bare = bareHead(ModelDesignSchema.parse(structuredClone(ADVISED[0]!.model)))
  expect(reviewModelQuality(bare).findings.map((finding) => finding.rule)).toContain("no_face")
})

test("the real frog of the 10-19 veteran (yellow eyes on two stalks above its head, declared in its part sheet) is not refused for having no eyes", async () => {
  const frog = (await Bun.file(path.join(import.meta.dir, "fixtures/real/poison-frog.json")).json()) as { model: unknown }
  const design = ModelDesignSchema.parse(frog.model)
  const look = measureLook(design)
  // What the measure sees: no mirrored pair of marks on the front or sides (the eyes stand in air above the head, which is how it tells eyes from horns), and a head that is not bare.
  expect(look).toMatchObject({ eyes: false, blankHead: false, hasFaceSurface: true })
  const review = reviewModelQuality(design, { complexity: "medium" })
  expect(review.findings).toEqual([])
  expect(review.passed).toBe(true)
  expect(review.advice?.map((entry) => entry.rule)).toEqual(["no_face"])
  // The maker's sheet said where the eyes are; judged with it the advice is the only thing the card has to say, as it was when the work was handed in.
  expect(reviewModelQuality(design, { complexity: "medium", justified: [{ what: "no_face", reason: "蛙的眼睛位于头顶两侧的独立突眼台" }] }).passed).toBe(true)
})
