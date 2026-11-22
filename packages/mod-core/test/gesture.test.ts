import { afterEach, expect, test } from "bun:test"
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { compileGestures, GESTURE_LIBRARY_EASE, gestureRuntimeData } from "../src/fabric/gesture"
import { gestureRuntimeSources } from "../src/fabric/gesture-runtime"
import { resolveGestureLibraries, resolveProfile } from "../src/fabric/profile"
import { criterion, reviewAsset, type AssetReview } from "../src/acceptance"
import { GESTURE_EYES, GestureDocumentSchema, gestureFirstPersonPreview, gesturePlayerPreview, resolveGesture, reviewGesture } from "../src/gesture"
import { GESTURE_BASES, GESTURE_CUSTOM_EXAMPLE, GESTURE_EXAMPLE } from "../src/gesture-bases"
import { GESTURE_GATE, GESTURE_STANDARD, type GestureMetrics } from "../src/gesture-gate"
import { GESTURE_EASE, GESTURE_RECOVER_TICKS, gesturePoint, gestureTimeline, mirrorGestureMotion, type GestureMotion } from "../src/gesture-motion"
import { GESTURE_ADJUST, GESTURE_BONES, GESTURE_EASINGS, GESTURE_FORMAT, GESTURE_KEYS, GESTURE_RUNTIME_VERSION } from "../src/gesture-rig"
import type { compileModel } from "../src/model"
import { decodeRgbaPng as decodePng } from "../src/png-decode"
import { createProject } from "../src/project"
import { applyWorkspaceAsset, builtWorkspaceAssets, getModuleSchema, ModuleDocumentSchema, WorkspaceSchema } from "../src/workspace"
import { MODULES, kindLabels, savedStatus } from "../src/workspace-modules"
import { createGestureSample, gestureAsset, SKY_EXAMPLE } from "./gesture-sample"

const roots: string[] = []
afterEach(() => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-gesture-"))
  roots.push(root)
  return root
}
const based = () => structuredClone(GESTURE_EXAMPLE) as unknown as Record<string, any>
const custom = () => structuredClone(GESTURE_CUSTOM_EXAMPLE) as unknown as Record<string, any>
// Every finding as "criterion/rule".
const found = (document: unknown) => reviewGesture(document).findings.map((finding) => `${criterion(finding.criterion).name}/${finding.rule}`)
const codes = (document: unknown) => reviewGesture(document).findings.map((finding) => finding.rule)
const measured = (review: AssetReview) => review.measured as GestureMetrics
const compiled = () =>
  compileGestures({
    modId: "sample",
    packageName: "com.minemods.content_sample",
    projectName: "符咒师",
    profileId: "fabric-1.21.1",
    gestures: [
      { id: "00000000-0000-4000-8000-0000000000b2", document: SKY_EXAMPLE },
      { id: "00000000-0000-4000-8000-0000000000b1", document: GESTURE_EXAMPLE },
    ],
  })

test("the worked examples are valid cast actions and the registry describes the kind honestly", () => {
  const document = GestureDocumentSchema.parse(GESTURE_EXAMPLE)
  expect(ModuleDocumentSchema.parse(GESTURE_EXAMPLE)).toEqual(document)
  // Written out in full, so what is saved is exactly what was sent.
  expect(document).toEqual(JSON.parse(JSON.stringify(GESTURE_EXAMPLE)))
  expect(GestureDocumentSchema.parse(GESTURE_CUSTOM_EXAMPLE).custom?.release.length).toBe(0.5)
  expect(getModuleSchema("gesture")).toBe(GestureDocumentSchema)
  expect(MODULES.gesture).toMatchObject({ id: "gesture", label: "施法动作", work_label: "施法动作", group: { id: "look", label: "外观" }, owner: false, staged: false, capability: "runtime" })
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) expect(savedStatus("gesture", target)).toBe("ready")
  expect(kindLabels("runtime", ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"])).toContain("施法动作")
  // The brief names every fixed bone and every base, says neither way of writing is the default, and says what cannot be done yet.
  GESTURE_BONES.forEach((bone) => expect(MODULES.gesture.instructions).toContain(`${bone.name}（`))
  GESTURE_BASES.forEach((base) => expect(MODULES.gesture.instructions).toContain(`${base.id}「${base.name}」`))
  ;["动作有两种写法，哪一种都可以，没有默认的那一种", "不要因为省事去套", "验收标准（施法动作）", "要让技能来播这个动作", "不能动手指"].forEach((text) => expect(MODULES.gesture.instructions).toContain(text))
  expect(MODULES.gesture.summary).toContain("只能按键播放")
  expect(GESTURE_BONES.map((bone) => bone.name)).toEqual(["torso", "head", "right_arm", "left_arm", "right_leg", "left_leg"])
  expect(GESTURE_KEYS[0]).toBe("g")
  // Defaults: a document may leave these out and gets arms that aim, mirror for left-handed players and show in first person.
  expect(GestureDocumentSchema.parse({ kind: "gesture", format: 2, name: "推", english_name: "Push", trigger: { type: "key", key: "j" }, base: "push_one" })).toMatchObject({ aim: true, mirror_for_left_handed: true, first_person: { arms: true, items: true } })
})

test("the library has at least ten base motions and every one passes the standard at every adjustment, with room to spare", () => {
  expect(GESTURE_BASES.length).toBeGreaterThanOrEqual(10)
  expect(new Set(GESTURE_BASES.map((base) => base.id)).size).toBe(GESTURE_BASES.length)
  GESTURE_BASES.forEach((base) => {
    expect(base.name.length).toBeGreaterThan(1)
    expect(base.description.length).toBeGreaterThan(10)
    expect(base.english_name).toMatch(/^[A-Za-z][A-Za-z ]+$/)
    // All three phases, a hold that loops, and legs or head and the other arm answering the cast.
    const motion = base.motion(1)
    expect(motion.hold?.loop).toBe(true)
    expect(Object.keys(motion.release.bones).length).toBeGreaterThanOrEqual(4)
  })
  const corners = [GESTURE_ADJUST.speed.min, 1, 1.3, GESTURE_ADJUST.speed.max].flatMap((speed) => [GESTURE_ADJUST.strength.min, 1, GESTURE_ADJUST.strength.max].map((strength) => ({ speed, strength })))
  const reviews = GESTURE_BASES.flatMap((base) =>
    base.hands.flatMap((hand) => corners.flatMap((corner) => [undefined, 0, 1, 3].map((hold_seconds) => ({ base: base.id, hand, ...corner, hold_seconds, review: reviewGesture({ ...GESTURE_EXAMPLE, base: base.id, hand, ...corner, hold_seconds }) })))),
  )
  expect(reviews.filter((entry) => !entry.review.passed).map((entry) => `${entry.base} ${entry.hand} ${entry.speed}/${entry.strength}/${entry.hold_seconds}: ${entry.review.findings.map((finding) => finding.rule)}`)).toEqual([])
  expect(reviews.length).toBeGreaterThan(800)
  const worst = (pick: (metrics: GestureMetrics) => number, most: boolean) => reviews.map((entry) => pick(measured(entry.review))).reduce((a, b) => (most ? Math.max(a, b) : Math.min(a, b)))
  // The worst base at the worst adjustment still clears each limit by a margin, so a small retune cannot tip one over.
  expect(worst((metrics) => metrics.hand_travel, false)).toBeGreaterThan(GESTURE_GATE.hand_travel * 1.25)
  expect(worst((metrics) => metrics.strike_distance, false)).toBeGreaterThan(GESTURE_GATE.strike_distance * 1.15)
  expect(worst((metrics) => metrics.anticipation, false)).toBeGreaterThan(GESTURE_GATE.anticipation * 1.25)
  expect(worst((metrics) => metrics.end_distance, false)).toBeGreaterThan(GESTURE_GATE.end_distance * 1.5)
  expect(worst((metrics) => metrics.settle, true)).toBeLessThan(GESTURE_GATE.settle * 0.5)
  expect(worst((metrics) => metrics.speed_ratio, false)).toBeGreaterThan(GESTURE_GATE.speed_ratio * 1.1)
  expect(worst((metrics) => metrics.linear_share, true)).toBeLessThan(GESTURE_GATE.linear_share * 0.5)
  expect(worst((metrics) => metrics.moving_bones.length, false)).toBeGreaterThan(GESTURE_GATE.bones)
  expect(worst((metrics) => metrics.strike_torso, false)).toBeGreaterThan(GESTURE_GATE.strike_torso * 1.5)
  expect(worst((metrics) => metrics.max_turn, true)).toBeLessThan(GESTURE_GATE.turn * 0.95)
  expect(worst((metrics) => metrics.max_slide, true)).toBeLessThan(GESTURE_GATE.slide * 0.92)
  expect(worst((metrics) => metrics.reversals, true)).toBeLessThan(GESTURE_GATE.reversals)
  expect(worst((metrics) => metrics.deepest_overlap, true)).toBeLessThan(GESTURE_GATE.overlap - 0.2)
  expect(worst((metrics) => metrics.feet_error, true)).toBeLessThan(GESTURE_GATE.feet * 0.8)
  expect(worst((metrics) => metrics.mirror_difference ?? 99, false)).toBeGreaterThan(GESTURE_GATE.mirror.hands * 3)
  // The player can watch every base from their own eyes for a good part of it.
  expect(worst((metrics) => metrics.in_view, false)).toBeGreaterThan(GESTURE_GATE.in_view * 1.2)
})

// These four files are evidence for the acceptance standard: motions that were rejected, kept so that what
// they show about each criterion is never lost. (a) is the motion the product owner rejected, carried into
// the new format as it was: two arms turn at constant speed, wait, and turn back. Do not delete or soften them.
// The schema no longer refuses them — a person may save any well-formed motion — but the standard does,
// wherever AI work is handed in (see acceptance.test.ts here and the task-runner tests in the app).
test("the rejected motions kept in fixtures/gesture-bad violate the standard, each on the criteria it is kept for", async () => {
  const directory = path.join(import.meta.dir, "fixtures/gesture-bad")
  const files = (await readdir(directory)).sort()
  expect(files).toEqual(["a-old-sword-fingers.json", "b-single-arm-raise-and-drop.json", "c-jitter.json", "d-head-nod-only.json"])
  const documents = Object.fromEntries(await Promise.all(files.map(async (file) => [file.slice(0, 1), JSON.parse(await readFile(path.join(directory, file), "utf8"))])))
  const created = await createProject({ directory: path.join(await temporary(), "project"), name: "Floor" })
  Object.values(documents).forEach((document) => {
    const review = reviewGesture(document)
    expect(review.passed).toBe(false)
    // Refused for how it moves, not for being malformed: it resolves, it is measured, and it can still be drawn as a draft.
    expect(review.unreadable).toBeNull()
    expect(review.measured).not.toBeNull()
    expect(gesturePlayerPreview(document).length).toBeGreaterThan(0)
    expect(GestureDocumentSchema.safeParse(document).success).toBe(true)
    // The one function every route calls gives the same verdict, and no simple brief talks its way past it.
    expect(reviewAsset(created, gestureAsset(document), { insisted: true }).findings).toEqual(review.findings)
    expect(reviewAsset(created, gestureAsset(document), { brief: "简单一点就行", insisted: true }).passed).toBe(false)
    // Every finding says what was found and what to change, in plain Chinese.
    review.findings.forEach((finding) => {
      expect([...finding.message].filter((letter) => letter >= "\u4e00" && letter <= "\u9fff").length).toBeGreaterThan(8)
      expect([...finding.fix].filter((letter) => letter >= "\u4e00" && letter <= "\u9fff").length).toBeGreaterThan(8)
    })
  })
  // (a) the old 剑指: arms to -80 and -35 degrees at constant speed, hold, back. Nothing reads, nothing leads, all of it mechanical.
  expect(found(documents.a)).toEqual(["认得出/weak_strike", "认得出/never_in_view", "认得出/returns_to_rest", "有主次/no_anticipation", "有主次/no_settle", "有主次/few_bones", "有主次/strike_alone", "不机械/constant_speed", "不机械/linear_keys"])
  expect(measured(reviewGesture(documents.a))).toMatchObject({ speed_ratio: 1.2, linear_share: 1, anticipation: 0, end_distance: 0, settle: 1, moving_bones: ["right_arm", "left_arm"], strike_torso: 0, in_view: 0 })
  // (b) one arm up and down in straight lines.
  expect(found(documents.b)).toEqual(["认得出/weak_strike", "认得出/returns_to_rest", "有主次/no_settle", "有主次/few_bones", "有主次/strike_alone", "不机械/constant_speed", "不机械/linear_keys"])
  // (c) keys scattered at random: every bone on the same beat, the hand zig-zagging, jumps of well over a quarter turn per tick, arms through the chest.
  expect(found(documents.c)).toEqual(["不机械/same_timing", "不机械/jitter", "站得住/teleport", "站得住/through_body"])
  expect(measured(reviewGesture(documents.c)).max_turn).toBeGreaterThan(GESTURE_GATE.turn * 1.5)
  expect(measured(reviewGesture(documents.c)).reversals).toBeGreaterThan(GESTURE_GATE.reversals * 2)
  // (d) only the head nods: no hand moves at all.
  expect(found(documents.d)).toEqual(expect.arrayContaining(["认得出/hand_travel", "认得出/weak_strike", "认得出/never_in_view", "有主次/few_bones", "有主次/strike_alone"]))
  // Each fixture misses a limit by a wide margin on at least one measure the best bases clear easily.
  expect(measured(reviewGesture(documents.a)).strike_distance).toBeLessThan(GESTURE_GATE.strike_distance * 0.9)
  expect(measured(reviewGesture(documents.b)).speed_ratio).toBeLessThan(GESTURE_GATE.speed_ratio * 0.7)
  // A person's own hand-written motion is theirs: it saves and builds whatever the standard thinks of it.
  expect(applyWorkspaceAsset(created, gestureAsset(documents.b)).workspace.assets).toHaveLength(1)
  expect(Object.keys(compileGestures({ modId: "sample", packageName: "com.minemods.content_sample", projectName: "x", profileId: "fabric-1.21.1", gestures: [{ id: "00000000-0000-4000-8000-0000000000b1", document: documents.b }] }).files).length).toBeGreaterThan(10)
})

test("each rule fires under its own criterion when one thing is spoiled in a motion that otherwise passes", () => {
  expect(codes(custom())).toEqual([])
  // Every rule of the kind is a defect under one of the shared criteria.
  expect(Object.fromEntries(GESTURE_STANDARD.rules.map((rule) => [rule.id, `${criterion(rule.criterion).name}/${rule.severity}`]))).toEqual({
    hand_travel: "认得出/defect", weak_strike: "认得出/defect", never_in_view: "认得出/defect", returns_to_rest: "认得出/defect",
    no_anticipation: "有主次/defect", no_settle: "有主次/defect", few_bones: "有主次/defect", strike_alone: "有主次/defect",
    constant_speed: "不机械/defect", linear_keys: "不机械/defect", same_timing: "不机械/defect", mirror_symmetric: "不机械/defect", jitter: "不机械/defect",
    teleport: "站得住/defect", through_body: "站得住/defect", feet: "站得住/defect",
  })
  const spoiled = (edit: (document: Record<string, any>) => void) => {
    const document = custom()
    edit(document)
    return codes(document)
  }
  const tracks = (document: Record<string, any>) => ["windup", "release"].flatMap((phase) => Object.values(document.custom[phase].bones).flatMap((bone: any) => [bone.rotation, bone.position].filter(Boolean))) as { time: number; value: number[]; easing: string }[][]
  // Constant-speed keys everywhere: both the authored easings and the measured speed profile say robot.
  expect(spoiled((document) => tracks(document).forEach((keys) => keys.forEach((key) => (key.easing = "linear"))))).toContain("linear_keys")
  // The torso taken out: the arm casts alone.
  expect(spoiled((document) => ["windup", "release"].forEach((phase) => delete document.custom[phase].bones.torso))).toEqual(expect.arrayContaining(["few_bones", "strike_alone"]))
  // No pull-back before the strike.
  expect(
    spoiled((document) => {
      const bones = document.custom.release.bones
      ;[bones.torso.rotation, bones.torso.position, bones.right_arm.rotation, bones.right_arm.position].forEach((keys: any[]) => keys.shift())
    }),
  ).toEqual(["no_anticipation"])
  // The release puts the hand back by the side instead of leaving it out.
  expect(
    spoiled((document) => {
      document.custom.release.bones.right_arm.rotation.at(-1).value = [0, 0, 0]
      document.custom.release.bones.right_arm.rotation.at(-2).value = [-30, 0, 0]
      document.custom.release.bones.right_arm.position.at(-1).value = [0, 0, 0]
      document.custom.release.bones.torso = { rotation: [{ time: 0.1, value: [-7, 31, 2], easing: "out_sine" }, { time: 0.25, value: [8, -14, -2], easing: "out_quad" }, { time: 0.5, value: [0, 0, 0], easing: "in_out_sine" }] }
    }),
  ).toContain("returns_to_rest")
  // The release ends while the hand is still at full speed.
  expect(
    spoiled((document) => {
      document.custom.release.length = 0.3
      Object.values(document.custom.release.bones).forEach((bone: any) => [bone.rotation, bone.position].filter(Boolean).forEach((keys: any[]) => keys.splice(0, keys.length, ...keys.filter((key) => key.time <= 0.3).map((key) => (key.time === 0.3 || key.time === 0.25 ? { ...key, easing: "in_quad" } : key)))))
    }),
  ).toContain("no_settle")
  // Torso and arm keyed on exactly the same beats.
  expect(
    spoiled((document) => {
      const bones = document.custom
      bones.windup.bones.torso = { rotation: [{ time: 0.1, value: [-2, 8, 1], easing: "out_sine" }, { time: 0.4, value: [-5, 26, 2], easing: "in_out_cubic" }], position: [{ time: 0.35, value: [0, 0, 0], easing: "in_out_sine" }] }
      bones.release.bones.torso = { rotation: [{ time: 0.1, value: [-7, 31, 2], easing: "out_sine" }, { time: 0.3, value: [8, -14, -2], easing: "out_quad" }, { time: 0.4, value: [7, -12, -2], easing: "in_out_sine" }, { time: 0.5, value: [6, -11, -1], easing: "in_out_sine" }], position: [{ time: 0.1, value: [0, 0, -1.2], easing: "out_sine" }, { time: 0.3, value: [0, 0, 1.4], easing: "out_quad" }, { time: 0.5, value: [0, 0, 1.2], easing: "in_out_sine" }] }
    }),
  ).toEqual(["same_timing"])
  // A quarter turn and more in a single tick.
  expect(spoiled((document) => (document.custom.release.bones.right_arm.rotation[1] = { time: 0.15, value: [-150, -8, 2], easing: "linear" }))).toContain("teleport")
  // The hand driven into the chest.
  expect(spoiled((document) => (document.custom.windup.bones.right_arm = { rotation: [{ time: 0.4, value: [-20, -70, -30], easing: "in_out_cubic" }] }))).toContain("through_body")
  // The body dropped without the legs opening: the feet go through the floor.
  expect(spoiled((document) => (document.custom.windup.bones.torso.position = [{ time: 0.35, value: [0, -4, 0], easing: "in_out_sine" }]))).toContain("feet")
  // A strike spread over the whole release at walking pace.
  expect(
    spoiled((document) => {
      document.custom.release.bones.right_arm = { rotation: [{ time: 0.1, value: [-34, 22, 32], easing: "out_sine" }, { time: 0.5, value: [-60, 10, 20], easing: "in_out_sine" }] }
      document.custom.release.bones.torso = { rotation: [{ time: 0.1, value: [-7, 31, 2], easing: "out_sine" }, { time: 0.45, value: [4, 10, 0], easing: "in_out_sine" }] }
    }),
  ).toContain("weak_strike")
  // Two arms doing the same thing at the same time with a torso that does not turn.
  const twin = { rotation: [{ time: 0.1, value: [10, 0, 6], easing: "out_sine" }, { time: 0.4, value: [-40, 10, 20], easing: "in_out_cubic" }] }
  const thrust = { rotation: [{ time: 0.1, value: [-30, 12, 24], easing: "out_sine" }, { time: 0.3, value: [-102, -8, 2], easing: "out_quad" }, { time: 0.5, value: [-95, -6, 2], easing: "in_out_sine" }] }
  expect(
    spoiled((document) => {
      document.custom.windup.bones = { torso: { rotation: [{ time: 0.3, value: [-8, 0, 0], easing: "in_out_quad" }] }, right_arm: twin, left_arm: twin, head: { rotation: [{ time: 0.3, value: [4, 0, 0], easing: "in_out_sine" }] } }
      document.custom.release.bones = { torso: { rotation: [{ time: 0.1, value: [-12, 0, 0], easing: "out_sine" }, { time: 0.25, value: [12, 0, 0], easing: "out_quad" }, { time: 0.5, value: [9, 0, 0], easing: "in_out_sine" }] }, right_arm: thrust, left_arm: thrust, head: { rotation: [{ time: 0.3, value: [6, 0, 0], easing: "out_quad" }] } }
    }),
  ).toEqual(["mirror_symmetric"])
  // The whole action done down by the hip: others may see it, the player never does.
  expect(
    spoiled((document) => {
      const low = (keys: { value: number[] }[]) => keys.forEach((key) => (key.value[0] = Math.max(key.value[0]!, -62)))
      ;[document.custom.windup.bones.right_arm.rotation, document.custom.release.bones.right_arm.rotation].forEach(low)
      delete document.custom.windup.bones.left_arm
      delete document.custom.release.bones.left_arm
    }),
  ).toContain("never_in_view")
})

test("malformed, off-rig and old-format documents are refused with the place that is wrong", () => {
  const refused = (document: Record<string, any>) => GestureDocumentSchema.safeParse(document).error?.issues.map((issue) => issue.path.join(".")) ?? []
  const edited = (make: () => Record<string, any>, edit: (document: Record<string, any>) => void) => {
    const document = make()
    edit(document)
    return refused(document)
  }
  // One source of motion: a base or custom tracks, never both, never neither.
  expect(edited(based, (document) => (document.custom = custom().custom))).toEqual(["custom"])
  expect(edited(based, (document) => delete document.base)).toEqual(["base"])
  expect(edited(based, (document) => (document.base = "moonwalk"))).toEqual(["base"])
  expect(edited(based, (document) => (document.hand = "both"))).toEqual(["hand"])
  expect(edited(based, (document) => Object.assign(document, { base: "push_both", hand: "left" }))).toEqual(["hand"])
  expect(edited(based, (document) => (document.speed = 2))).toEqual(["speed"])
  expect(edited(based, (document) => (document.strength = 0.2))).toEqual(["strength"])
  expect(edited(based, (document) => (document.hold_seconds = 3.5))).toEqual(["hold_seconds"])
  expect(edited(based, (document) => (document.hold_seconds = 0.26))).toEqual(["hold_seconds"])
  // 0.15 is three ticks even though 0.15 / 0.05 is not exactly 3 in binary.
  expect(edited(based, (document) => (document.hold_seconds = 0.15))).toEqual([])
  expect(edited(based, (document) => (document.english_name = "掌心雷"))).toEqual(["english_name"])
  expect(edited(based, (document) => (document.sound = "minecraft:entity.blaze.shoot"))).toEqual([""])
  expect(edited(based, (document) => (document.first_person = { arms: true }))).toEqual(["first_person.items"])
  // Only a key press today; a skill trigger is a later member of the union, not a free-form field.
  expect(edited(based, (document) => (document.trigger = { type: "skill", skill: "fireball" }))).toEqual(["trigger.type"])
  expect(edited(based, (document) => (document.trigger.key = "w"))).toEqual(["trigger.key"])
  // Adjustments belong to a base; custom tracks are edited directly.
  expect(edited(custom, (document) => (document.strength = 1.2))).toEqual(["strength"])
  expect(edited(custom, (document) => (document.custom.windup.bones.tail = { rotation: [{ time: 0.1, value: [0, 0, 0], easing: "linear" }] }))).toEqual(["custom.windup.bones"])
  expect(edited(custom, (document) => (document.custom.windup.bones.right_arm.rotation[1].value = [-260, 0, 0]))).toEqual(["custom.windup.bones.right_arm.rotation.1.value.0"])
  expect(edited(custom, (document) => (document.custom.windup.bones.right_arm.scale = []))).toEqual(["custom.windup.bones.right_arm"])
  expect(edited(custom, (document) => (document.custom.windup.bones.right_arm.rotation[1].easing = "bounce"))).toEqual(["custom.windup.bones.right_arm.rotation.1.easing"])
  expect(edited(custom, (document) => (document.custom.windup.bones.right_arm.rotation[0].time = 0))).toEqual(["custom.windup.bones.right_arm.rotation.0.time"])
  expect(edited(custom, (document) => (document.custom.windup.bones.right_arm.rotation[1].time = 0.45))).toEqual(["custom.windup.bones.right_arm.rotation"])
  expect(edited(custom, (document) => (document.custom.windup.bones.right_arm.rotation[1].time = 0.1))).toEqual(["custom.windup.bones.right_arm.rotation"])
  expect(edited(custom, (document) => (document.custom.release.length = 0.9))).toEqual(["custom.release.length"])
  expect(edited(custom, (document) => (document.custom.windup.bones.head.rotation = Array.from({ length: 9 }, (_, index) => ({ time: (index + 1) * 0.05, value: [0, 0, 0], easing: "in_out_sine" }))))).toEqual(["custom.windup.bones.head.rotation"])
  // A loop has to come back to where it began, or it jumps once per cycle.
  const loop = { length: 0.4, loop: true, bones: { right_arm: { rotation: [{ time: 0.2, value: [-45, 20, 30], easing: "in_out_sine" }, { time: 0.4, value: [-42, 20, 30], easing: "in_out_sine" }] } } }
  expect(edited(custom, (document) => (document.custom.hold = loop))).toEqual(["custom.hold.bones.right_arm.rotation"])
  expect(reviewGesture({ ...custom(), custom: { ...custom().custom, hold: loop } })).toMatchObject({ passed: false, measured: null, findings: [], unreadable: { message: expect.stringContaining("custom.hold.bones.right_arm.rotation") } })
  expect(edited(custom, (document) => (document.custom.hold = { ...loop, bones: { right_arm: { rotation: [loop.bones.right_arm.rotation[0], { time: 0.4, value: [-40, 20, 30], easing: "in_out_sine" }] } } }))).toEqual([])
  // The format before this one — a block hand, `hand_color`, two separate tracks — is named for what it is, in plain words, and nothing crashes.
  const old = { kind: "gesture", name: "剑指", english_name: "Sword Fingers", length: 1, hand_color: "#ecb476", trigger: { type: "key", key: "g" }, first_person: { wrist: [{ time: 0, rotation: [0, 0, -10], easing: "linear" }] }, third_person: { right_arm: [{ time: 0, rotation: [0, 0, 0], easing: "linear" }] } }
  const parsed = GestureDocumentSchema.safeParse(old)
  expect(parsed.success).toBe(false)
  expect(parsed.error!.issues.filter((issue) => issue.message.startsWith("这是旧格式（格式 1）的手势")).map((issue) => issue.path.join("."))).toEqual(["format", ""])
  expect(reviewGesture(old)).toMatchObject({ passed: false, measured: null, findings: [], unreadable: { message: expect.stringContaining("旧格式（格式 1）"), fix: expect.stringContaining("改成施法动作（format 2）") } })
  expect(ModuleDocumentSchema.safeParse(old).success).toBe(false)
  expect(() => gesturePlayerPreview(old)).toThrow()
  expect(reviewGesture(null)).toMatchObject({ passed: false, measured: null, unreadable: { message: expect.stringContaining("文档格式不对") } })
  expect(reviewGesture({ ...based(), format: 1 }).unreadable?.message).toContain("旧格式")
  // A document from a newer Studio is said to be newer, not mistaken for the old format, and is not guessed at.
  expect(GestureDocumentSchema.safeParse({ ...based(), format: 3 }).error!.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([["format", expect.stringContaining("这个文档是 format 3，比这个版本认识的 format 2 新")]])
  expect(reviewGesture({ ...based(), format: 3 }).unreadable?.message).not.toContain("旧格式")
})

test("a cast action is saved ready, is listed as built, and each key holds one action", async () => {
  const created = await createProject({ directory: path.join(await temporary(), "project"), name: "Casts" })
  const first = gestureAsset(GESTURE_EXAMPLE, "00000000-0000-4000-8000-0000000000c1")
  const project = applyWorkspaceAsset(created, first)
  expect(project.workspace.assets).toEqual([first])
  expect({ blocks: project.blocks, items: project.items, recipes: project.recipes, logic: project.logic, entities: project.entities }).toEqual({ blocks: [], items: [], recipes: [], logic: [], entities: [] })
  expect(builtWorkspaceAssets(project)).toEqual([{ id: first.id, module: "gesture", revision: 1 }])
  expect(() => applyWorkspaceAsset(project, gestureAsset(GESTURE_EXAMPLE, "00000000-0000-4000-8000-0000000000c2"))).toThrow("Another gesture already uses the g key")
  expect(WorkspaceSchema.parse(applyWorkspaceAsset(project, gestureAsset(SKY_EXAMPLE, "00000000-0000-4000-8000-0000000000c2")).workspace).assets).toHaveLength(2)
})

test("a motion resolves the way it will play: the torso carries, the left hand mirrors, a slow setting keeps the strike fast", () => {
  // The library's curves, by name; the JVM check compares all thirteen against the library itself.
  GESTURE_EASINGS.forEach((name) => {
    expect(GESTURE_EASE[name](0)).toBeCloseTo(0, 9)
    expect(GESTURE_EASE[name](1)).toBeCloseTo(1, 9)
    expect(GESTURE_LIBRARY_EASE[name]).toBe(name.replaceAll("_", "").toUpperCase())
  })
  expect(GESTURE_EASE.out_back(0.5)).toBeGreaterThan(1)
  expect(GESTURE_EASE.in_out_back(0.3)).toBeCloseTo(-0.014513755, 6)
  // A torso that only turns: the shoulders swing round with it and the head stays over the neck, facing the look.
  const turn: GestureMotion = { windup: { ticks: 4, bones: { torso: { rotation: [{ tick: 4, value: [0, 90, 0], easing: "linear" }] } } }, hold: null, release: { ticks: 2, bones: {} } }
  const turned = gestureTimeline(turn, 0)
  expect(turned.ticks).toEqual({ windup: 4, hold: 0, release: 2, recover: GESTURE_RECOVER_TICKS })
  expect(turned.frames).toHaveLength(1 + 4 + 2 + GESTURE_RECOVER_TICKS)
  expect(turned.stage.filter((stage) => stage === "recover")).toHaveLength(GESTURE_RECOVER_TICKS)
  const pose = turned.frames[4]!
  // Turned to the player's right, the right shoulder (model x -5) is now behind the neck (model z +5).
  gesturePoint(pose, "right_arm", [0, 0, 0]).forEach((value, axis) => expect(value).toBeCloseTo([0, 2, 5][axis]!, 6))
  gesturePoint(pose, "left_arm", [0, 0, 0]).forEach((value, axis) => expect(value).toBeCloseTo([0, 2, -5][axis]!, 6))
  expect(pose.right_arm.rotation[1]).toBeCloseTo(90, 6)
  expect(pose.head).toEqual({ rotation: [0, 0, 0], position: [expect.closeTo(0, 6), expect.closeTo(0, 6), expect.closeTo(0, 6)] })
  expect(pose.right_leg).toEqual({ rotation: [0, 0, 0], position: [0, 0, 0] })
  // A lean from the waist moves the neck forward and down; the head goes with the neck but does not tip.
  const lean = gestureTimeline({ ...turn, windup: { ticks: 4, bones: { torso: { rotation: [{ tick: 4, value: [30, 0, 0], easing: "linear" }] } } } }, 0).frames[4]!
  expect(lean.head.position[2]).toBeCloseTo(-12 * Math.sin(Math.PI / 6), 6)
  expect(lean.head.position[1]).toBeCloseTo(12 - 12 * Math.cos(Math.PI / 6), 6)
  expect(lean.head.rotation).toEqual([0, 0, 0])
  // The runtime's recovery eases every part back to its own pose and ends there.
  expect(turned.frames.at(-1)!.torso.rotation.every((value) => Math.abs(value) < 1e-9)).toBe(true)
  // The left-handed version of a base is its mirror image, part for part.
  const right = resolveGesture(GESTURE_EXAMPLE)
  const left = resolveGesture({ ...GESTURE_EXAMPLE, hand: "left" })
  right.timeline.frames.forEach((frame, tick) => {
    const other = left.timeline.frames[tick]!
    ;[0, 1, 2].forEach((axis) => {
      expect(other.left_arm.rotation[axis]!).toBeCloseTo(frame.right_arm.rotation[axis]! * (axis === 0 ? 1 : -1), 6)
      expect(other.left_arm.position[axis]!).toBeCloseTo(frame.right_arm.position[axis]! * (axis === 0 ? -1 : 1), 6)
      expect(other.torso.rotation[axis]!).toBeCloseTo(frame.torso.rotation[axis]! * (axis === 0 ? 1 : -1), 6)
    })
  })
  expect(mirrorGestureMotion(mirrorGestureMotion(right.motion))).toEqual(right.motion)
  expect(measured(reviewGesture({ ...GESTURE_EXAMPLE, hand: "left" })).casting).toBe("left")
  // Slower stretches the windup and the hold cycle, never the release; faster shortens all three.
  const slow = resolveGesture({ ...GESTURE_EXAMPLE, speed: 0.6 })
  const fast = resolveGesture({ ...GESTURE_EXAMPLE, speed: 1.6 })
  expect([right, slow, fast].map((value) => [value.motion.windup.ticks, value.motion.hold!.ticks, value.motion.release.ticks])).toEqual([[8, 6, 10], [13, 10, 10], [5, 4, 6]])
  // A looping hold plays whole cycles, so the release starts from the pose it was written for.
  expect([0, 0.1, 0.2, 0.45, 1, 3].map((hold_seconds) => resolveGesture({ ...GESTURE_EXAMPLE, hold_seconds }).hold_ticks)).toEqual([0, 6, 6, 12, 18, 60])
  expect(resolveGesture({ ...GESTURE_CUSTOM_EXAMPLE, hold_seconds: 0.45 }).hold_ticks).toBe(9)
  // Strength scales the body language, not where the hand ends up.
  const strong = resolveGesture({ ...GESTURE_EXAMPLE, strength: 1.3 })
  const weak = resolveGesture({ ...GESTURE_EXAMPLE, strength: 0.6 })
  expect(Math.abs(strong.motion.release.bones.torso!.rotation![1]!.value[1])).toBeGreaterThan(Math.abs(weak.motion.release.bones.torso!.rotation![1]!.value[1]) * 2)
  expect(strong.motion.release.bones.right_arm!.rotation).toEqual(weak.motion.release.bones.right_arm!.rotation)
})

test("cast actions compile to a loader-neutral data file, two languages and the library's licence", () => {
  const result = compiled()
  // Sorted by asset id, whatever order they were passed in.
  expect(result.gestures).toEqual([
    { id: "00000000-0000-4000-8000-0000000000b1", index: 0, name: "gesture_000000000000400080000000000000b1", key: "g" },
    { id: "00000000-0000-4000-8000-0000000000b2", index: 1, name: "gesture_000000000000400080000000000000b2", key: "h" },
  ])
  // No hand model, no hand texture, no hand animation: the first-person view is the player's own arms.
  expect(Object.keys(result.files).filter((name) => /assets\/|\.geo\.|textures\/|animations\//.test(name))).toEqual([])
  const text = String(result.files["src/main/resources/data/sample/studio/gestures.json"])
  const data = JSON.parse(text)
  expect(data).toMatchObject({ format: GESTURE_FORMAT, runtime: GESTURE_RUNTIME_VERSION })
  expect(data.gestures.map((gesture: { id: string }) => gesture.id)).toEqual(result.gestures.map((gesture) => gesture.name))
  expect(data.gestures[0]).toMatchObject({ name: "掌心雷", trigger: { type: "key", key: "g" }, aim: true, mirror_for_left_handed: true, first_person: { arms: true, items: true }, hold_ticks: 6, windup: { ticks: 8 }, hold: { ticks: 6, loop: true }, release: { ticks: 10 } })
  expect(data.gestures[1]).toMatchObject({ name: "引雷", aim: false, hold_ticks: 8, hold: { ticks: 8, loop: true } })
  // Every phase lists the same parts and channels, one value per tick: the runtime refuses anything else.
  // Which parts and channels an action has follows from its motion; one it never moves is left to the game.
  const push = data.gestures[0]
  expect(Object.keys(push.windup.parts)).toEqual(GESTURE_BONES.map((bone) => bone.name).filter((name) => name in push.windup.parts))
  expect(Object.keys(push.windup.parts)).toEqual(expect.arrayContaining(["torso", "right_arm"]))
  ;[push.windup, push.hold, push.release].forEach((phase) => {
    expect(Object.keys(phase.parts)).toEqual(Object.keys(push.windup.parts))
    Object.entries(phase.parts).forEach(([part, channels]: [string, any]) => {
      expect(Object.keys(channels)).toEqual(Object.keys(push.windup.parts[part]))
      expect(Object.keys(channels).every((channel) => ["rotation", "position"].includes(channel))).toBe(true)
      Object.values(channels).forEach((frames: any) => expect(frames).toHaveLength(phase.ticks))
    })
  })
  // Rebuilt the way the runtime rebuilds it — windup, the hold cycle repeated for hold_ticks, release — it is the previewed timeline.
  const timeline = resolveGesture(GESTURE_EXAMPLE).timeline
  const rebuilt = (part: string, channel: string) => [
    ...push.windup.parts[part][channel],
    ...Array.from({ length: push.hold_ticks }, (_, tick) => push.hold.parts[part][channel][push.hold.loop ? tick % push.hold.ticks : Math.min(tick, push.hold.ticks - 1)]),
    ...push.release.parts[part][channel],
  ]
  rebuilt("right_arm", "rotation").forEach((value: number[], tick: number) => value.forEach((angle, axis) => expect(angle).toBeCloseTo(timeline.frames[tick + 1]!.right_arm.rotation[axis]!, 2)))
  rebuilt("torso", "position").forEach((value: number[], tick: number) => value.forEach((offset, axis) => expect(offset).toBeCloseTo(timeline.frames[tick + 1]!.torso.position[axis]!, 3)))
  expect(rebuilt("right_arm", "rotation")).toHaveLength(timeline.ticks.windup + timeline.ticks.hold + timeline.ticks.release)
  // A hold that is not asked for is not written; a frozen one is written as far as it plays.
  expect(gestureRuntimeData(resolveGesture({ ...GESTURE_EXAMPLE, hold_seconds: 0 }))).toMatchObject({ hold_ticks: 0, hold: null })
  expect(gestureRuntimeData(resolveGesture({ ...GESTURE_CUSTOM_EXAMPLE, hold_seconds: 0.3 }))).toMatchObject({ hold_ticks: 6, hold: { ticks: 1, loop: false } })
  // An action that turns the head carries the turn; one that does not leaves the head's angles to the game.
  expect(Object.keys(gestureRuntimeData(resolveGesture(GESTURE_EXAMPLE)).windup.parts.head!)).toEqual(["rotation", "position"])
  // Section 9.1: nothing in the data names a loader or a library.
  expect(text).not.toMatch(/fabric|kosmx|playerAnim|geckolib|net\.minecraft|pitch|yaw|rightArm/i)
  expect(result.language.zh_cn).toEqual({ "category.sample.gestures": "符咒师·施法动作", "key.sample.gesture.g": "施法：掌心雷", "key.sample.gesture.h": "施法：引雷" })
  expect(result.language.en_us).toEqual({ "category.sample.gestures": "符咒师 cast actions", "key.sample.gesture.g": "Cast: Palm Thunder", "key.sample.gesture.h": "Cast: Call Lightning" })
  expect(String(result.files["src/main/resources/META-INF/licenses/playerAnimator-LICENSE.txt"])).toContain("MIT License\n\nCopyright (c) 2022 KosmX")
  expect(() => compileGestures({ modId: "sample", packageName: "com.minemods.content_sample", projectName: "x", profileId: "fabric-1.21.1", gestures: [{ id: "00000000-0000-4000-8000-0000000000b1", document: GESTURE_EXAMPLE }, { id: "00000000-0000-4000-8000-0000000000b3", document: GESTURE_EXAMPLE }] })).toThrow("GESTURE_KEY_CONFLICT:00000000-0000-4000-8000-0000000000b3")
  expect(() => compileGestures({ modId: "sample", packageName: "com.minemods.content_sample", projectName: "x", profileId: "forge-1.20.1", gestures: [{ id: "00000000-0000-4000-8000-0000000000b1", document: GESTURE_EXAMPLE }] })).toThrow("not supported on profile")
})

test("playerAnimator is pinned beside the profile and the build files are edited, not rewritten, whatever their line endings", () => {
  const library = resolveGestureLibraries("fabric-1.21.1").playerAnimator
  expect(library).toMatchObject({ version: "2.0.1+1.21.1", coordinate: "dev.kosmx.player-anim:player-animation-lib-fabric:2.0.1+1.21.1", license: "MIT", mod_id: "playeranimator" })
  expect(library.download.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(library.download.url).toBe("https://maven.kosmx.dev/dev/kosmx/player-anim/player-animation-lib-fabric/2.0.1+1.21.1/player-animation-lib-fabric-2.0.1+1.21.1.jar")
  // Not inside the profile: that object is written into every build manifest, cast actions or not.
  expect(JSON.stringify(resolveProfile("fabric-1.21.1"))).not.toContain("kosmx")
  const patch = compiled().patch
  // No mixin any more: nothing of the game's own first-person drawing is replaced.
  expect(Object.keys(patch)).toEqual(["build.gradle", "gradle.properties", "src/main/resources/fabric.mod.json"])
  const template = "repositories {\n    maven { name = 'GeckoLib' }\n}\ndependencies {\n    modImplementation \"software.bernie.geckolib:geckolib-fabric-1.21.1:${project.geckolib_version}\"\n}\n"
  const gradle = patch["build.gradle"]!(template)
  expect(gradle).toContain("url = 'https://maven.kosmx.dev/'")
  expect(gradle).toContain('include modImplementation("dev.kosmx.player-anim:player-animation-lib-fabric:${project.player_animator_version}")')
  expect(gradle).toContain("playerAnimator checksum mismatch")
  expect(gradle).not.toMatch(/shadowJar|johnrengelman|\r/)
  expect(() => patch["build.gradle"]!("dependencies {}\n")).toThrow("GESTURE_TEMPLATE_ANCHOR_MISSING:build.gradle")
  expect(patch["gradle.properties"]!("geckolib_version=4.8.3\n")).toBe(`geckolib_version=4.8.3\nplayer_animator_version=2.0.1+1.21.1\nplayer_animator_sha256=${library.download.sha256}\n`)
  const metadata = '{"id":"sample","entrypoints":{"main":["a.StudioContent"]},"depends":{"geckolib":"4.8.3"}}'
  expect(JSON.parse(patch["src/main/resources/fabric.mod.json"]!(metadata))).toEqual({
    id: "sample",
    entrypoints: { main: ["a.StudioContent", "com.minemods.content_sample.gesture.fabric.GestureMod"], client: ["com.minemods.content_sample.gesture.fabric.client.GestureClient"] },
    depends: { geckolib: "4.8.3", playeranimator: ">=2.0.1" },
    custom: { "minemods:gesture_runtime": { version: GESTURE_RUNTIME_VERSION, data_format: GESTURE_FORMAT } },
  })
  // A template checked out on Windows has CRLF line endings. The same edits land, and every line keeps its CRLF.
  const windows = (text: string) => text.replaceAll("\n", "\r\n")
  const lone = /(^|[^\r])\n/
  const gradleWindows = patch["build.gradle"]!(windows(template))
  expect(gradleWindows).toBe(windows(gradle))
  expect(gradleWindows).not.toMatch(lone)
  expect(gradleWindows).toContain("repositories {\r\n    maven {\r\n        name = 'KosmX'\r\n")
  const propertiesWindows = patch["gradle.properties"]!("geckolib_version=4.8.3\r\n")
  expect(propertiesWindows).toBe(`geckolib_version=4.8.3\r\nplayer_animator_version=2.0.1+1.21.1\r\nplayer_animator_sha256=${library.download.sha256}\r\n`)
  const metadataWindows = patch["src/main/resources/fabric.mod.json"]!('{\r\n  "id": "sample",\r\n  "entrypoints": { "main": ["a.StudioContent"] },\r\n  "depends": { "geckolib": "4.8.3" }\r\n}\r\n')
  expect(metadataWindows).not.toMatch(lone)
  expect(JSON.parse(metadataWindows).depends).toEqual({ geckolib: "4.8.3", playeranimator: ">=2.0.1" })
  expect(() => patch["build.gradle"]!("dependencies {}\r\n")).toThrow("GESTURE_TEMPLATE_ANCHOR_MISSING:build.gradle")
})

// The failure this guards against happened on a real Windows checkout: the template arrived with CRLF and
// the build stopped at GESTURE_TEMPLATE_ANCHOR_MISSING:build.gradle.
test("a template checked out with CRLF line endings gets the same build-file edits as an LF one", async () => {
  const template = path.join(import.meta.dir, "../../../templates/fabric-1.21")
  const windows = path.join(await temporary(), "template")
  await cp(template, windows, { recursive: true })
  const text = (await readdir(windows, { recursive: true })).filter((name) => /\.(gradle|properties|json|md|bat|java)$|LICENSE$/.test(name))
  await Promise.all(text.map(async (name) => writeFile(path.join(windows, name), (await readFile(path.join(windows, name), "utf8")).replaceAll(/\r?\n/g, "\r\n"))))
  expect(await readFile(path.join(windows, "build.gradle"), "utf8")).toContain("repositories {\r\n")
  const unix = await createGestureSample(await temporary())
  const sample = await createGestureSample(await temporary(), windows)
  const read = (directory: string, name: string) => readFile(path.join(directory, name), "utf8")
  await Promise.all(
    ["build.gradle", "gradle.properties"].map(async (name) => {
      const patched = await read(sample.sourceDirectory, name)
      // Every line still ends the way the checkout had it, and the content is the LF build's, edit for edit.
      expect(patched).not.toMatch(/(^|[^\r])\n/)
      expect(patched.replaceAll("\r\n", "\n")).toBe(await read(unix.sourceDirectory, name))
    }),
  )
  expect(await read(sample.sourceDirectory, "build.gradle")).toContain("include modImplementation(")
  expect(await read(sample.sourceDirectory, "build.gradle")).toContain("tasks.register('verifyPlayerAnimator')")
  expect(await read(sample.sourceDirectory, "gradle.properties")).toContain("player_animator_sha256=")
  expect(JSON.parse(await read(sample.sourceDirectory, "src/main/resources/fabric.mod.json"))).toEqual(JSON.parse(await read(unix.sourceDirectory, "src/main/resources/fabric.mod.json")))
  // What the edits do not touch is the same too: the runtime and its data do not depend on the checkout.
  const data = "src/main/resources/data/gesture_smoke/studio/gestures.json"
  expect(await read(sample.sourceDirectory, data)).toBe(await read(unix.sourceDirectory, data))
})

test("the runtime is fixed Java with a loader-neutral core, a thin Fabric adapter and no hand model or mixin", () => {
  const sources = gestureRuntimeSources("com.minemods.content_sample", "sample")
  const root = "src/main/java/com/minemods/content_sample"
  expect(Object.keys(sources).map((name) => name.slice(root.length + 1)).sort()).toEqual([
    "gesture/core/GestureAim.java",
    "gesture/core/GestureCooldown.java",
    "gesture/core/GestureData.java",
    "gesture/core/GestureRuntime.java",
    "gesture/core/GestureState.java",
    "gesture/fabric/GestureMod.java",
    "gesture/fabric/client/GestureAimModifier.java",
    "gesture/fabric/client/GestureAnimations.java",
    "gesture/fabric/client/GestureCast.java",
    "gesture/fabric/client/GestureClient.java",
  ])
  const imports = (name: string) => [...sources[name]!.matchAll(/^import ([\w.]+);/gm)].map((match) => match[1]!)
  const core = Object.keys(sources).filter((name) => name.includes("/gesture/core/"))
  // The core may use the JDK and Gson only: no loader, no animation library, not even Minecraft classes.
  core.forEach((name) => expect(imports(name).filter((value) => !/^(java\.|com\.google\.gson\.|com\.minemods\.content_sample\.gesture\.core\.)/.test(value))).toEqual([]))
  core.forEach((name) => expect(sources[name]).not.toMatch(/net\.fabricmc|net\.minecraft|dev\.kosmx|software\.bernie|org\.spongepowered/))
  // Everything loader-specific sits in the adapter.
  expect(Object.keys(sources).filter((name) => /net\.fabricmc/.test(sources[name]!)).map((name) => name.slice(root.length + 1))).toEqual(["gesture/fabric/GestureMod.java", "gesture/fabric/client/GestureClient.java"])
  // The shared entrypoint runs on dedicated servers, where client and rendering classes do not exist.
  expect(sources[`${root}/gesture/fabric/GestureMod.java`]).not.toMatch(/net\.minecraft\.client|dev\.kosmx|software\.bernie|fabric\.api\.client/)
  // The class that builds the library's animation touches nothing of the game, so a plain JVM can play it.
  expect(sources[`${root}/gesture/fabric/client/GestureAnimations.java`]).not.toMatch(/net\.minecraft|net\.fabricmc/)
  // One runtime for every action: the Java never depends on what the actions are.
  expect(gestureRuntimeSources("com.minemods.content_sample", "sample")).toEqual(sources)
  const all = Object.values(sources).join("\n")
  // The first-person block hand is gone for good: no GeckoLib, no mixin, no held-item hook, no hand colour.
  expect(all).not.toMatch(/software\.bernie|GeoAnimatable|GeoObjectRenderer|spongepowered|@Mixin|HeldItemRenderer|GestureHand|hand_color|handTexture/)
  expect(all).not.toMatch(/BackgroundCheck|BackgroundMouse|BackgroundWindow|phase0|SPIKE|Screenshot|scheduleStop|setPerspective|glfwGetWindowAttrib/)
  // What makes it one system: the player's own model in first person, fades, the aim, the mirror.
  ;["FirstPersonMode.THIRD_PERSON_MODEL", "new FirstPersonConfiguration(gesture.showArms(), gesture.showArms(), gesture.showItems(), gesture.showItems())", "replaceAnimationWithFade(AbstractFadeModifier.standardFadeIn(GestureRuntime.FADE_IN_TICKS, Ease.INOUTSINE), playing, true)", "replaceAnimationWithFade(AbstractFadeModifier.standardFadeIn(GestureRuntime.CANCEL_TICKS, Ease.INOUTSINE), null, false)", "extends AdjustmentModifier", "new MirrorModifier(false)", "player.getMainArm() == HumanoidArm.LEFT", "new KeyframeAnimation.AnimationBuilder(AnimationFormat.UNKNOWN)"].forEach((text) => expect(all).toContain(text))
  expect(all).toContain(`VERSION = "${GESTURE_RUNTIME_VERSION}"`)
  expect(all).toContain(`FORMAT = ${GESTURE_FORMAT};`)
  expect(all).toContain("RECOVER_TICKS = 6;")
  expect(all).toContain("FADE_IN_TICKS = 2;")
  expect(all).toContain("CANCEL_TICKS = 4;")
  expect(all).toContain("AIM_SHARE = 0.65f;")
  expect(all).toContain('List.of("torso", "head", "right_arm", "left_arm", "right_leg", "left_leg")')
  expect(all).toContain('List.of("g", "h", "j", "k", "r", "v", "b", "n")')
})

test("previews draw what others see and what the player sees, in the shape the viewport plays", () => {
  const player = gesturePlayerPreview(GESTURE_EXAMPLE, { loop: false })
  const arms = gestureFirstPersonPreview(GESTURE_EXAMPLE)
  // Same shape as a compiled model, so the existing viewport needs no new code.
  const shape: Pick<ReturnType<typeof compileModel>, "geometry" | "animation">[] = [player, arms]
  expect(shape).toHaveLength(2)
  const names = ["player", "torso", "head", "right_arm", "left_arm", "right_leg", "left_leg"]
  expect(player.design.bones.map((bone) => [bone.name, bone.parent])).toEqual(names.map((name) => [name, name === "player" ? null : "player"]))
  expect(player.geometry["minecraft:geometry"][0]!.bones.map((bone) => bone.name)).toEqual(names)
  // The figure is the vanilla player's proportions: 32 tall, arms 12 long hanging from y 22.
  const box = (look: typeof player, name: string) => look.geometry["minecraft:geometry"][0]!.bones.find((bone) => bone.name === name)!
  expect(box(player, "head")).toMatchObject({ pivot: [0, 24, 0], cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8] }] })
  expect(box(player, "torso")).toMatchObject({ pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4] }] })
  expect(box(player, "right_arm")).toMatchObject({ pivot: [-5, 22, 0], cubes: [{ origin: [-8, 12, -2], size: [4, 12, 4] }] })
  expect(box(player, "left_leg")).toMatchObject({ pivot: [1.9, 12, 0], cubes: [{ origin: [-0.1, 0, -2], size: [4, 12, 4] }] })
  // Every face reads its own patch of the skin, laid out as a box strip.
  expect(box(player, "head").cubes[0]!.uv).toMatchObject({ north: { uv: [8, 8], uv_size: [8, 8] }, up: { uv: [8, 0], uv_size: [8, 8] } })
  expect(box(player, "right_arm").cubes[0]!.uv.north).toEqual({ uv: [44, 20], uv_size: [4, 12] })
  // One key per game tick for every part, rotation and position, from standing to standing again.
  const timeline = resolveGesture(GESTURE_EXAMPLE).timeline
  expect(player.length).toBe(1.5)
  expect(player.design.animations[0]).toMatchObject({ name: "gesture", length: 1.5, loop: false })
  expect(arms.design.animations[0]!.loop).toBe(true)
  const animation = player.animation.animations["animation.gesture_player.gesture"]!
  expect(animation).toMatchObject({ loop: false, animation_length: 1.5 })
  expect(Object.keys(animation.bones)).toEqual(names.slice(1))
  expect(Object.keys(animation.bones.right_arm!.rotation)).toHaveLength(timeline.frames.length)
  expect(Object.keys(animation.bones.right_arm!.rotation).slice(0, 3)).toEqual(["0.0", "0.05", "0.1"])
  expect(animation.bones.right_arm!.rotation["0.0"]).toEqual([0, 0, 0])
  expect(animation.bones.right_arm!.rotation["1.5"]).toEqual([0, 0, 0])
  // The viewport's angles are the model's; its offsets count y upwards.
  const strike = timeline.frames[20]!.right_arm
  expect<number[]>(animation.bones.right_arm!.rotation["1.0"]).toEqual(strike.rotation.map((value) => Number(value.toFixed(3))))
  expect(animation.bones.right_arm!.position["1.0"]).toEqual([Number(strike.position[0].toFixed(3)), Number((-strike.position[1]).toFixed(3)), Number(strike.position[2].toFixed(3))])
  // The timeline a card can label and scrub: windup, hold, release, and the return the game adds.
  expect(player.phases).toEqual([
    { id: "windup", label: "起手", start: 0, end: 0.4 },
    { id: "hold", label: "蓄力", start: 0.4, end: 0.7 },
    { id: "release", label: "出手", start: 0.7, end: 1.2 },
    { id: "recover", label: "收回", start: 1.2, end: 1.5 },
  ])
  expect(gesturePlayerPreview({ ...GESTURE_EXAMPLE, hold_seconds: 0 }).phases.map((phase) => phase.id)).toEqual(["windup", "release", "recover"])
  expect(player.peak).toBeGreaterThan(0.7)
  expect(player.peak).toBeLessThan(1.2)
  expect(player.resolved.base?.id).toBe("push_one")
  // What the player sees: the same motion with only the arms drawn, and a camera at eye height looking the way the figure faces.
  expect(arms.animation.animations["animation.gesture_arms.gesture"]!.bones).toEqual(gesturePlayerPreview(GESTURE_EXAMPLE).animation.animations["animation.gesture_player.gesture"]!.bones)
  expect(arms.geometry["minecraft:geometry"][0]!.bones.map((bone) => [bone.name, bone.cubes.length])).toEqual([["player", 1], ["torso", 0], ["head", 0], ["right_arm", 1], ["left_arm", 1], ["right_leg", 0], ["left_leg", 0]])
  // Exactly where the game's camera is while the player's own model is drawn: 1.62 blocks up, level, the default 70° lens. Nothing is tilted or pulled back.
  expect(arms.camera).toEqual({ position: [0, 27.648, 0], target: [0, 27.648, -40], fov: 70 })
  expect(arms.camera).toBe(GESTURE_EYES)
  expect(gestureFirstPersonPreview({ ...GESTURE_EXAMPLE, first_person: { arms: false, items: true } }).geometry["minecraft:geometry"][0]!.bones.flatMap((bone) => (bone.name === "player" ? [] : bone.cubes))).toEqual([])
  // The figure wears the product's own skin: drawn here, the same every time, and not a flat fill.
  const texture = decodePng(Buffer.from(player.textureDataUrl.slice("data:image/png;base64,".length), "base64"))
  expect([texture.width, texture.height]).toEqual([64, 64])
  const colors = new Set(Array.from({ length: 64 * 64 }, (_, index) => texture.pixels.slice(index * 4, index * 4 + 4).join()))
  expect(colors.size).toBeGreaterThan(30)
  const pixel = (x: number, y: number) => [...texture.pixels.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)]
  // Eyes on the face (teal iris beside a white), hair above them, skin below; empty skin stays transparent.
  expect(pixel(10, 12)[2]!).toBeGreaterThan(pixel(10, 12)[0]! + 60)
  expect(pixel(9, 12).slice(0, 3).every((value) => value > 220)).toBe(true)
  expect(pixel(10, 8)[0]!).toBeLessThan(90)
  expect(pixel(60, 60)[3]).toBe(0)
  expect(gesturePlayerPreview(GESTURE_EXAMPLE).textureDataUrl).toBe(player.textureDataUrl)
  // A draft the standard refuses can still be shown beside what is wrong with it; a malformed one cannot.
  expect(() => gesturePlayerPreview({ ...GESTURE_EXAMPLE, base: "moonwalk" })).toThrow()
  expect(() => gestureFirstPersonPreview({ ...GESTURE_EXAMPLE, speed: 9 })).toThrow()
})

test("a project with two cast actions assembles a complete mod source", async () => {
  const sample = await createGestureSample(await temporary())
  const read = (name: string) => readFile(path.join(sample.sourceDirectory, name), "utf8")
  const metadata = JSON.parse(await read("src/main/resources/fabric.mod.json"))
  expect(metadata.entrypoints).toEqual({
    main: ["com.minemods.content_gesture_smoke.StudioContent", "com.minemods.content_gesture_smoke.gesture.fabric.GestureMod"],
    client: ["com.minemods.content_gesture_smoke.gesture.fabric.client.GestureClient"],
  })
  expect(metadata.depends).toMatchObject({ geckolib: ">=4.8.3 <5.0.0", playeranimator: ">=2.0.1" })
  expect(metadata.custom["minemods:gesture_runtime"]).toEqual({ version: GESTURE_RUNTIME_VERSION, data_format: GESTURE_FORMAT })
  // The template's mixin list is left exactly as the template has it.
  expect(JSON.stringify(JSON.parse(await read("src/main/resources/gesture_smoke.mixins.json")))).not.toContain("Gesture")
  expect(await read("build.gradle")).toContain("include modImplementation(")
  expect(await read("gradle.properties")).toContain("player_animator_sha256=")
  expect(JSON.parse(await read("src/main/resources/assets/gesture_smoke/lang/zh_cn.json"))["key.gesture_smoke.gesture.g"]).toBe("施法：掌心雷")
  expect(JSON.parse(await read("src/main/resources/assets/gesture_smoke/lang/en_us.json"))["key.gesture_smoke.gesture.h"]).toBe("Cast: Call Lightning")
  expect(JSON.parse(await read("src/main/resources/data/gesture_smoke/studio/gestures.json")).gestures.map((gesture: { name: string }) => gesture.name)).toEqual(["掌心雷", "引雷"])
  expect(await read("src/main/java/com/minemods/content_gesture_smoke/gesture/core/GestureRuntime.java")).toContain("package com.minemods.content_gesture_smoke.gesture.core;")
  expect(await read("src/main/resources/META-INF/licenses/playerAnimator-LICENSE.txt")).toContain("KosmX")
  const manifest = JSON.parse(await read("minemods-build.json"))
  expect(manifest.gesture_runtime).toMatchObject({ version: GESTURE_RUNTIME_VERSION, data_format: GESTURE_FORMAT, player_animator: { version: "2.0.1+1.21.1" } })
  expect(manifest.gestures.map((gesture: { key: string }) => gesture.key)).toEqual(["g", "h"])
  expect(manifest.workspace_assets.map((asset: { module: string }) => asset.module)).toEqual(["gesture", "gesture"])
  expect(await read("README-STUDIO.md")).toContain("press G or H")
  expect(await read("README-STUDIO.md")).toContain("the player sees their own arms do the action")
})
