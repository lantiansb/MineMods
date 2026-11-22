import { expect, test } from "bun:test"
import { golemAbilities } from "../script/data-gameplay-sample"
import { CAST_SAMPLE_IDS, frostBreath } from "../script/target-cast-sample"
import { Glob } from "bun"
import path from "node:path"
import { ASSET_STANDARDS, CRITERIA, ITEM_STANDARD, SPRITE_ANSWERS, EXCUSES, REFUSAL_CAP, SEVERITIES, STANDARD_SUMMARY, coverage, criterion, refusal, refusalText, reviewAsset, standardBrief, told, writtenStandard, type AssetReview, type AssetReviewContext } from "../src/acceptance"
import { SPOILED, repainted } from "../../studio-ai/test/specimens"
import { INNER_NAMES, leaked } from "./fixtures/acceptance/names"
import { GESTURE_CUSTOM_EXAMPLE, GESTURE_EXAMPLE } from "../src/gesture-bases"
import { dragonBoss, dragonFlight, dragonHabits } from "./giant-flier"
import { flightWalks } from "../src/creature-flight"
import { AbilitySchema, CREATURE_JUSTIFIED_MOST, EntitySchema, HabitsSchema } from "../src/entity-runtime"
import { justifyTail } from "@minemods/studio-ai/acceptance"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import type { Project } from "../src/project"
import { ModuleDocumentSchema, type ModuleDocument, type WorkspaceAsset } from "../src/workspace"
import { encodePng } from "../src/png"
import { decodeRgbaPng } from "../src/png-decode"
import { decodeTextureDataUrl } from "../src/content-texture"
import { ASSET_KINDS, MODULES, ModuleKindSchema, type ModuleKind } from "../src/workspace-modules"

import { BAD as BAD_GAMEPLAY, BOX_GUARD, IDS as GAMEPLAY_IDS, sampleProject } from "./fixtures/gameplay/sample"
import type { GameplayDocument } from "../src/gameplay"
import type { GameplayCheck } from "../src/gameplay-check"

// One standard for every kind. The specimens under fixtures/ (and the model and texture ones kept beside
// their measurements in studio-ai) are evidence for it: each bad one is kept for the criterion it violates.
type Name = (typeof CRITERIA)[number]["name"]
type Specimen = { name: string; kind: ModuleKind; why: string; document: unknown; skeleton?: string; pantry?: Partial<Project>; brief?: string; model?: unknown; texture?: unknown }

const here = import.meta.dir
const look = path.join(here, "../../studio-ai/test/fixtures/look")
const read = (directory: string) => Promise.all([...new Glob("*.json").scanSync(directory)].sort().map((file) => Bun.file(path.join(directory, file)).json()))
const MODEL_ID = "00000000-0000-4000-8000-00000000a001"
const asset = (id: string, document: unknown, dependencies: string[] = [], model: string | null = "fixture-model"): WorkspaceAsset =>
  ({ id, module: (document as { kind: ModuleKind }).kind, title: "样品", revision: 1, created_at: "2026-10-05T00:00:00.000Z", updated_at: "2026-10-05T00:00:00.000Z", prompt: "", dependencies, document: ModuleDocumentSchema.parse(document), provenance: { model, request_id: null }, status: "design" }) as WorkspaceAsset
const project = (assets: WorkspaceAsset[], rest: Partial<Project> = {}) => ({ mod_id: "specimens", entities: [], blocks: [], items: [], recipes: [], logic: [], workspace: { assets }, ...rest }) as unknown as Project
const skeletons = Object.fromEntries((await read(path.join(look, "good"))).map((value) => [value.name, { kind: "model", ...value.model }]))

const sameLook = (model: unknown) => {
  const { kind: _kind, ...design } = model as { kind: string }
  return { kind: "texture", ...repainted(ModelDesignSchema.parse(design)) }
}

// A cast action that passes, with one thing spoiled: the body dropped without the legs opening, so the feet go through the floor.
const sunkCast = { ...GESTURE_CUSTOM_EXAMPLE, name: "下沉指", custom: { ...GESTURE_CUSTOM_EXAMPLE.custom, windup: { ...GESTURE_CUSTOM_EXAMPLE.custom.windup, bones: { ...GESTURE_CUSTOM_EXAMPLE.custom.windup.bones, torso: { ...GESTURE_CUSTOM_EXAMPLE.custom.windup.bones.torso, position: [{ time: 0.35, value: [0, -4, 0], easing: "in_out_sine" }] } } } } }

type GameplaySpecimen = { name: string; document: GameplayDocument; compiled?: NonNullable<GameplayCheck["compile"]> }
const gameplaySpecimens = (folder: "good" | "bad"): GameplaySpecimen[] =>
  folder === "good"
    ? [{ name: "box-guard", document: BOX_GUARD, compiled: { ok: true, findings: [], compiler: "javac", note: null } }]
    : [
        { name: "socket-in-alarm", document: BAD_GAMEPLAY.opens_socket },
        { name: "item-that-is-not-there", document: BAD_GAMEPLAY.missing_item },
        { name: "method-that-is-not-there", document: BAD_GAMEPLAY.does_not_compile, compiled: { ok: false, findings: [{ rule: "compile", file: "Pulse.java", line: 34, message: "编译不过：找不到方法 setCooldown(Item,int)（在 class ItemCooldownManager 里）。", fix: "核对拼写、参数和 import；不确定的接口不要凭印象写。" }], compiler: "javac", note: null } },
      ]

/** Every specimen of every kind, judged the one way everything is judged: `reviewAsset` in a project. */
async function specimens(folder: "good" | "bad") {
  const own: Specimen[] = await read(path.join(here, "fixtures/acceptance", folder))
  const looks: { name: string; brief: string; model: unknown; texture?: unknown }[] = await read(path.join(look, folder))
  const casts = folder === "bad" ? await read(path.join(here, "fixtures/gesture-bad")) : [GESTURE_EXAMPLE, GESTURE_CUSTOM_EXAMPLE]
  return [
    // A stale/externally written document can reach review without today's schema: the ordinary save route
    // already refuses this contact, but acceptance must give the same refusal before a build is attempted.
    ...(folder === "bad" ? [{ name: "weapon-without-its-motion", kind: "entity" as const, review: reviewAsset(project([]), {
      ...asset("00000000-0000-4000-8000-00000000d004", { kind: "entity", name: "样品", description: "", health: 20, speed: 0.2, attack_damage: 3, behavior: "hostile", model_asset_id: MODEL_ID, runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null } }),
      document: { kind: "entity", name: "样品", description: "", health: 20, speed: 0.2, attack_damage: 3, behavior: "hostile", model_asset_id: MODEL_ID, runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null }, hitbox: { core: { width: 1, height: 2 }, parts: [{ name: "兵器", forward: 2, up: 1, left: 0, width: 1, height: 1, contact: [{ ability: "missing", damage: 6, knockback: 1 }] }] } },
    }, { insisted: true }) }] : []),
    ...own.map((value) => {
      // A specimen brings the model it wears (`model`) or names one of the accepted ones (`skeleton`).
      const model = value.model ? [asset(MODEL_ID, value.model)] : value.skeleton ? [asset(MODEL_ID, skeletons[value.skeleton])] : []
      return { name: value.name, kind: value.kind, review: reviewAsset(project(model, value.pantry), asset("00000000-0000-4000-8000-00000000d001", value.document, model.map((entry) => entry.id)), { insisted: true }) }
    }),
    // Gameplay code, in the project it was written for. What a compiler said is handed in as the making loop hands it in.
    ...gameplaySpecimens(folder).map((value) => ({ name: value.name, kind: "gameplay" as const, review: reviewAsset(sampleProject(), { id: GAMEPLAY_IDS.box_guard, module: "gameplay", document: value.document, dependencies: value.document.uses }, { insisted: true, candidate: true, ...(value.compiled ? { compiled: value.compiled } : {}) }) })),
    // A model specimen is judged as a model; one that carries a hand-drawn texture is also judged as that texture on it.
    ...looks.flatMap((value) => {
      const model = asset(MODEL_ID, { kind: "model", ...(value.model as object) })
      return [
        { name: value.name, kind: "model" as const, review: reviewAsset(project([model]), model, { brief: value.brief, complexity: "medium" }) },
        ...(value.texture ? [{ name: `${value.name}（贴图）`, kind: "texture" as const, review: reviewAsset(project([model]), asset("00000000-0000-4000-8000-00000000d002", { kind: "texture", ...(value.texture as object) }, [MODEL_ID]), { brief: value.brief, insisted: true }) }] : []),
      ]
    }),
    // A passing texture: an accepted model's own painted atlas read back as a palette texture, the same look by another road.
    ...(folder === "good" ? [{ name: "bog-goblin（贴图）", kind: "texture" as const, review: reviewAsset(project([asset(MODEL_ID, skeletons["bog-goblin"])]), asset("00000000-0000-4000-8000-00000000d002", sameLook(skeletons["bog-goblin"]), [MODEL_ID]), { insisted: true }) }] : []),
    // An accepted specimen with one thing spoiled: a model judged as a model, a texture judged on its model.
    ...(folder === "bad" ? SPOILED : []).map((value) => {
      const model = asset(MODEL_ID, { kind: "model", ...value.model })
      return value.texture
        ? { name: value.name, kind: "texture" as const, review: reviewAsset(project([model]), asset("00000000-0000-4000-8000-00000000d002", { kind: "texture", ...value.texture }, [MODEL_ID]), { brief: value.brief, insisted: true }) }
        : { name: value.name, kind: "model" as const, review: reviewAsset(project([model]), model, { brief: value.brief, complexity: value.complexity ?? "medium" }) }
    }),
    ...casts.map((value, index) => ({ name: folder === "bad" ? ["a-old-sword-fingers", "b-single-arm-raise-and-drop", "c-jitter", "d-head-nod-only"][index]! : (value as { name: string }).name, kind: "gesture" as const, review: reviewAsset(project([]), asset("00000000-0000-4000-8000-00000000d003", value), { insisted: true }) })),
    ...(folder === "bad" ? [{ name: "sunk-cast", kind: "gesture" as const, review: reviewAsset(project([]), asset("00000000-0000-4000-8000-00000000d003", sunkCast), { insisted: true }) }] : []),
  ]
}
const failed = (review: AssetReview) => review.criteria.filter((value) => value.state === "failed").map((value) => value.name)
const rules = (review: AssetReview) => review.findings.map((finding) => finding.rule)

test("the standard is a short list of criteria a person can say in one breath", () => {
  expect(CRITERIA.map((value) => value.name)).toEqual(["不凑数", "不机械", "认得出", "有主次", "站得住", "配得上"])
  expect(new Set(CRITERIA.map((value) => value.id)).size).toBe(CRITERIA.length)
  CRITERIA.forEach((value) => {
    expect(value.meaning.length).toBeLessThan(60)
    ;[value.meaning, value.examples, value.fix].forEach((text) => expect(text).not.toMatch(/[A-Za-z_]{4,}/))
    expect(STANDARD_SUMMARY).toContain(value.name)
  })
  expect(STANDARD_SUMMARY).toContain(`最多被退回 ${REFUSAL_CAP} 次`)
  expect(STANDARD_SUMMARY).toContain("由人自己验收")
})

test("every kind is registered, every rule belongs to exactly one criterion, and what a kind cannot measure is stated", () => {
  const ids = CRITERIA.map((value) => value.id)
  expect(Object.keys(ASSET_STANDARDS).sort()).toEqual([...ModuleKindSchema.options].sort())
  ModuleKindSchema.options.forEach((kind) => {
    const standard = ASSET_STANDARDS[kind]
    expect(standard).toMatchObject({ kind, label: MODULES[kind].label })
    expect(new Set(standard.rules.map((rule) => rule.id)).size).toBe(standard.rules.length)
    standard.rules.forEach((rule) => {
      expect(ids).toContain(rule.criterion)
      expect(["defect", "craft"]).toContain(rule.severity)
      // What a rule asks is said in plain Chinese, with no field or measurement names.
      expect({ rule: rule.id, plain: !/[a-z]{3,}_[a-z]|Share|metrics/.test(rule.asks) && [...rule.asks].filter((letter) => letter >= "一" && letter <= "鿿").length >= 6 }).toEqual({ rule: rule.id, plain: true })
    })
    // A criterion is read by at least one rule or is listed as not measured yet, with the reason: never both, never neither.
    ids.forEach((id) => {
      const measured = standard.rules.some((rule) => rule.criterion === id)
      expect({ kind, id, stated: measured !== ((standard.unmeasured[id] ?? "").length > 0) }).toEqual({ kind, id, stated: true })
    })
  })
  // The matrix in the written standard is this, not a hand-kept table.
  const matrix = Object.fromEntries(coverage(ModuleKindSchema.options.map((kind) => ASSET_STANDARDS[kind])).map((row) => [row.kind, row.criteria.map((cell) => (cell.measured ? "量" : "—")).join("")]))
  expect(matrix).toEqual({
    model: "量量量量量—",
    texture: "—量量量—量",
    animation: "量量——量量",
    gesture: "—量量量量—",
    item: "—量量量——",
    block: "—量—量量—",
    entity: "—————量",
    recipe: "—————量",
    sound: "——————",
    music: "——————",
    logic: "—————量",
    worldview: "——————",
    biome: "——————",
    dimension: "——————",
    terrain: "——————",
    gameplay: "————量量",
    effect: "——————",
    particle: "——————",
    bossbar: "——————",
    fixture: "——————",
    ability: "——————",
    book: "——————",
  })
})

// Specimen → the criteria it violates. Model and texture specimens are listed with their rules in studio-ai's
// look-gate test; here they are held to the same criteria through the same function as every other kind.
// Two are kept by name as the reason this standard exists: lanjing-guard (the 蓝晶 guardian's model and
// texture) and a-old-sword-fingers (the old 剑指 cast action), both real AI output the owner threw out.
const KEPT: Record<string, { kind: ModuleKind; criteria: Name[]; rules?: string[] }> = {
  // Its two one-pixel eye cubes are pale blue on a blue head and the pair-finder does not see them: that is advice now. It is refused for the rest.
  "lanjing-guard": { kind: "model", criteria: ["不凑数", "不机械", "有主次", "站得住"] },
  // Their heads carry a pattern, so nothing says there is no face: the missing pair of eyes is advice, not a refusal (the pattern is what is refused).
  "lanjing-guard（贴图）": { kind: "texture", criteria: ["不机械", "有主次"] },
  "noise-texture（贴图）": { kind: "texture", criteria: ["不机械", "有主次"] },
  "one-pattern（贴图）": { kind: "texture", criteria: ["不机械", "有主次"] },
  "half-size-texture": { kind: "texture", criteria: ["配得上"], rules: ["wrong_size"] },
  "padded-pile": { kind: "model", criteria: ["不凑数"] },
  "faceless-flat": { kind: "model", criteria: ["认得出", "有主次"] },
  "floating-parts": { kind: "model", criteria: ["站得住"] },
  "stiff-walker": { kind: "model", criteria: ["不机械", "认得出", "有主次"] },
  "a-old-sword-fingers": { kind: "gesture", criteria: ["不机械", "认得出", "有主次"], rules: ["weak_strike", "never_in_view", "returns_to_rest", "no_anticipation", "no_settle", "few_bones", "strike_alone", "constant_speed", "linear_keys"] },
  "b-single-arm-raise-and-drop": { kind: "gesture", criteria: ["不机械", "认得出", "有主次"], rules: ["weak_strike", "returns_to_rest", "no_settle", "few_bones", "strike_alone", "constant_speed", "linear_keys"] },
  "c-jitter": { kind: "gesture", criteria: ["不机械", "站得住"], rules: ["same_timing", "jitter", "teleport", "through_body"] },
  "d-head-nod-only": { kind: "gesture", criteria: ["不机械", "认得出", "有主次"], rules: ["hand_travel", "weak_strike", "never_in_view", "returns_to_rest", "no_anticipation", "no_settle", "few_bones", "strike_alone", "constant_speed", "mirror_symmetric"] },
  "static-item": { kind: "item", criteria: ["不机械"], rules: ["noisy_texture"] },
  "brick-item": { kind: "item", criteria: ["认得出"], rules: ["icon_fills_square"] },
  "speck-item": { kind: "item", criteria: ["认得出", "有主次"], rules: ["icon_too_faint", "few_tones"] },
  "flat-item": { kind: "item", criteria: ["有主次"], rules: ["few_tones"] },
  "noise-block": { kind: "block", criteria: ["不机械"], rules: ["noisy_texture"] },
  "flat-block": { kind: "block", criteria: ["有主次"], rules: ["few_tones"] },
  "holed-block": { kind: "block", criteria: ["站得住"], rules: ["block_has_holes"] },
  "frozen-animation": { kind: "animation", criteria: ["不凑数"], rules: ["nothing_moves"] },
  "robot-swing": { kind: "animation", criteria: ["不机械"], rules: ["constant_speed"] },
  "snap-animation": { kind: "animation", criteria: ["站得住"], rules: ["teleport"] },
  "ghost-bones": { kind: "animation", criteria: ["配得上"], rules: ["unknown_bones"] },
  "toothless-hunter": { kind: "entity", criteria: ["配得上"], rules: ["hostile_but_harmless"] },
  "weapon-without-its-motion": { kind: "entity", criteria: ["配得上"], rules: ["hitbox_combat_invalid"] },
  "muzzle-that-is-not-there": { kind: "entity", criteria: ["配得上"], rules: ["ability_bone_missing"] },
  "plume-on-forge": { kind: "entity", criteria: ["配得上"], rules: ["target_lacks_vanilla"] },
  "rooted-follower": { kind: "entity", criteria: ["配得上"], rules: ["chases_but_cannot_move"] },
  "gliding-walker": { kind: "entity", criteria: ["配得上"], rules: ["walk_glides"] },
  "gem-from-gem": { kind: "recipe", criteria: ["配得上"], rules: ["makes_itself"] },
  "sixteen-relics": { kind: "recipe", criteria: ["配得上"], rules: ["more_than_a_stack"] },
  "second-torch-grid": { kind: "recipe", criteria: ["配得上"], rules: ["same_grid_as_another"] },
  "missing-roar": { kind: "logic", criteria: ["配得上"], rules: ["plays_unknown_animation"] },
  "socket-in-alarm": { kind: "gameplay", criteria: ["站得住"], rules: ["out_of_bounds"] },
  "method-that-is-not-there": { kind: "gameplay", criteria: ["站得住"], rules: ["does_not_compile"] },
  "item-that-is-not-there": { kind: "gameplay", criteria: ["配得上"], rules: ["broken_reference"] },
}
const named = (kind: ModuleKind, rule: string) => criterion(ASSET_STANDARDS[kind].rules.find((value) => value.id === rule)!.criterion).name
const VIOLATES: typeof KEPT = {
  ...KEPT,
  // The spoiled specimens say which rules they break; the criteria follow from the rules.
  ...Object.fromEntries(SPOILED.map((value) => [value.name, { kind: value.texture ? "texture" : "model", criteria: [...new Set(value.rules.map((rule) => named(value.texture ? "texture" : "model", rule)))], rules: value.rules }])),
  // Built on another engineer's example, whose numbers may move: held to its criterion here and to its rule below.
  "sunk-cast": { kind: "gesture", criteria: ["站得住"] },
}

test("each bad specimen violates the criteria it is kept for, and only those; each good specimen passes all it is measured on", async () => {
  const bad = (await specimens("bad")).filter((value) => VIOLATES[value.name] || !value.review.passed)
  expect(bad.map((value) => value.name).sort()).toEqual(Object.keys(VIOLATES).sort())
  bad.forEach((value) => {
    const wanted = VIOLATES[value.name]!
    expect({ name: value.name, kind: value.kind, passed: value.review.passed, criteria: failed(value.review) }).toEqual({ name: value.name, kind: wanted.kind, passed: false, criteria: CRITERIA.map((entry) => entry.name).filter((name) => wanted.criteria.includes(name)) })
    if (wanted.rules) expect({ name: value.name, rules: rules(value.review).sort() }).toEqual({ name: value.name, rules: [...wanted.rules].sort() })
    // What was found and what to change are separate sentences in plain Chinese.
    value.review.findings.forEach((finding) => expect([...finding.message].concat([...finding.fix]).filter((letter) => letter >= "一" && letter <= "鿿").length).toBeGreaterThan(12))
  })
  const good = await specimens("good")
  expect(good.length).toBeGreaterThanOrEqual(15)
  good.forEach((value) => expect({ name: value.name, passed: value.review.passed, findings: value.review.findings, failed: failed(value.review) }).toEqual({ name: value.name, passed: true, findings: [], failed: [] }))
})

test("every criterion has a specimen that violates it and one that passes it, and every rule of every kind has its specimen", async () => {
  const bad = await specimens("bad")
  const good = await specimens("good")
  CRITERIA.forEach((value) => {
    expect({ criterion: value.name, violated: bad.some((entry) => failed(entry.review).includes(value.name)) }).toEqual({ criterion: value.name, violated: true })
    expect({ criterion: value.name, passed: good.some((entry) => entry.review.criteria.some((state) => state.id === value.id && state.state === "passed")) }).toEqual({ criterion: value.name, passed: true })
  })
  // And per kind: each criterion a kind measures is violated by a specimen of that kind and passed by another.
  ModuleKindSchema.options.forEach((kind) =>
    CRITERIA.filter((value) => ASSET_STANDARDS[kind].rules.some((rule) => rule.criterion === value.id)).forEach((value) => {
      expect({ kind, criterion: value.name, violated: bad.some((entry) => entry.kind === kind && failed(entry.review).includes(value.name)) }).toEqual({ kind, criterion: value.name, violated: true })
      expect({ kind, criterion: value.name, passed: good.some((entry) => entry.kind === kind && entry.review.criteria.some((state) => state.id === value.id && state.state === "passed")) }).toEqual({ kind, criterion: value.name, passed: true })
    }),
  )
  // Rule by rule, for every kind in the registry: no rule without a specimen of its own kind that violates it.
  const fired = (kind: ModuleKind) => new Set(bad.filter((entry) => entry.kind === kind).flatMap((entry) => rules(entry.review)))
  ModuleKindSchema.options.forEach((kind) => expect({ kind, missing: ASSET_STANDARDS[kind].rules.map((rule) => rule.id).filter((id) => !fired(kind).has(id)) }).toEqual({ kind, missing: [] }))
  expect(rules(bad.find((entry) => entry.name === "sunk-cast")!.review)).toContain("feet")
})

test("a rule is a class of fault, not a case: the same fault has the same name and the same criterion in every kind", () => {
  const uses = ModuleKindSchema.options.flatMap((kind) => ASSET_STANDARDS[kind].rules.map((rule) => ({ kind, ...rule })))
  const shared = [...new Set(uses.map((rule) => rule.id))].filter((id) => uses.filter((rule) => rule.id === id).length > 1)
  shared.forEach((id) => expect({ id, criteria: [...new Set(uses.filter((rule) => rule.id === id).map((rule) => rule.criterion))].length }).toEqual({ id, criteria: 1 }))
  // Noise, too few tones, constant speed, an instant turn, nothing moving: each is one rule measured on several kinds.
  expect(Object.fromEntries(["noisy_texture", "few_tones", "constant_speed", "teleport", "nothing_moves", "no_face"].map((id) => [id, uses.filter((rule) => rule.id === id).map((rule) => rule.kind).sort()]))).toEqual({
    noisy_texture: ["block", "item", "model", "texture"],
    few_tones: ["block", "item", "model", "texture"],
    constant_speed: ["animation", "gesture", "model"],
    teleport: ["animation", "gesture"],
    nothing_moves: ["animation", "model"],
    no_face: ["model", "texture"],
  })
  // No rule names a specimen, and none is worded around one: what it asks is a sentence about the work, in the present tense.
  const specimenWords = /蓝晶|lanjing|剑指|守卫|guardian|goblin|slime/i
  uses.forEach((rule) => expect({ rule: rule.id, clean: !specimenWords.test(`${rule.id}${rule.asks}`) }).toEqual({ rule: rule.id, clean: true }))
  // Severity is one of two words everywhere, and what a brief may excuse is one of the listed excuses.
  uses.forEach((rule) => {
    expect(Object.keys(SEVERITIES)).toContain(rule.severity)
    if (rule.excuse) expect(Object.keys(EXCUSES)).toContain(rule.excuse)
  })
})

test("the brief an AI gets, the refusal it reads and what a card shows all come from the same definitions", async () => {
  // Before it starts: every rule's plain demand is in the kind's instructions, and so is what the kind cannot measure.
  ;(["model", "texture", "animation", "gesture", "item", "block", "entity", "recipe", "logic"] as const).forEach((kind) => {
    ASSET_STANDARDS[kind].rules.forEach((rule) => expect({ kind, rule: rule.id, told: MODULES[kind].instructions.includes(rule.asks) }).toEqual({ kind, rule: rule.id, told: true }))
    expect(MODULES[kind].instructions).toContain(standardBrief(ASSET_STANDARDS[kind]))
    CRITERIA.filter((value) => ASSET_STANDARDS[kind].unmeasured[value.id]).forEach((value) => expect(standardBrief(ASSET_STANDARDS[kind])).toContain(`${value.name}——这一类暂时不检查（${ASSET_STANDARDS[kind].unmeasured[value.id]}）`))
  })
  // After a refusal: criterion name, what was found, what to change, numbered.
  const refused = (await specimens("bad")).find((value) => value.name === "c-jitter")!.review
  const text = refusalText(refused)
  expect(text).toMatch(/^1\. 【不机械】躯干和施法手臂的关键帧时间完全一样.+怎么改：让躯干比手臂早一两刻到位，手臂再跟上。 2\. 【不机械】/)
  expect(text).toContain("【站得住】")
  expect(text).not.toMatch(/same_timing|max_turn|reversals|deepest_overlap/)
  // On a card: the same review's criteria in the standard's order, each failed one with its findings.
  expect(refused.criteria.filter((value) => value.state === "failed").map((value) => [value.name, refused.findings.filter((finding) => finding.criterion === value.id).length])).toEqual([["不机械", 2], ["站得住", 2]])
  expect(criterion("fits").name).toBe("配得上")
})

test("one function judges every kind, and says so when there is nothing to measure", async () => {
  const guardian = asset(MODEL_ID, skeletons["crystal-guardian"])
  const judge = (document: unknown, context: AssetReviewContext = {}, rest: Partial<Project> = {}, assets: WorkspaceAsset[] = []) => reviewAsset(project(assets, rest), asset("00000000-0000-4000-8000-00000000d009", document, assets.map((value) => value.id)), { insisted: true, ...context })
  const states = (review: AssetReview) => review.criteria.map((value) => value.state)
  // Design-only kinds, an item with no picture of its own and a texture on no model: passed, every criterion left to the person, with the reason.
  const worldview = judge({ kind: "worldview", title: "符咒师", summary: "", entries: [] })
  expect(worldview).toMatchObject({ kind: "worldview", passed: true, findings: [], measured: null })
  expect(states(worldview)).toEqual(Array.from({ length: 6 }, () => "unmeasured"))
  expect(worldview.criteria[0]!.note).toContain("只是设计稿")
  const plain = judge({ kind: "item", identifier: "gem", name: "宝石", max_stack: 64, color: "#46b9dc", texture: null })
  expect(plain).toMatchObject({ passed: true, measured: null })
  expect(plain.criteria[0]!.note).toContain("没有自己的图")
  const loose = (await read(path.join(look, "bad"))).find((value) => value.name === "noise-texture")!
  expect(judge({ kind: "texture", ...loose.texture })).toMatchObject({ passed: true, measured: null })
  // The same texture on the model it was drawn for is refused, whether the model is a dependency or what the task was made against.
  expect(judge({ kind: "texture", ...loose.texture }, {}, {}, [asset(MODEL_ID, { kind: "model", ...loose.model })]).passed).toBe(false)
  expect(reviewAsset(project([]), asset("00000000-0000-4000-8000-00000000d009", { kind: "texture", ...loose.texture }), { insisted: true, against: [asset(MODEL_ID, { kind: "model", ...loose.model })] }).passed).toBe(false)
  // A picture that is not a PNG cannot be measured: refused before any criterion, not a crash.
  const broken = judge({ kind: "block", identifier: "ore", name: "矿", hardness: 1, luminance: 0, tool: "pickaxe", drop: "self", color: "#7d8188", texture: "data:image/png;base64,AAAA" })
  expect(broken).toMatchObject({ passed: false, findings: [], measured: null, unreadable: { message: "方块的图不是一张读得出来的 PNG。" } })
  expect(refusalText(broken)).toContain("没法验收")
  // An animation whose model is not known is still judged on its own motion; its bones are not.
  const ghost = (await read(path.join(here, "fixtures/acceptance/bad"))).find((value) => value.name === "ghost-bones")!
  expect(judge(ghost.document).passed).toBe(true)
  expect(judge(ghost.document, {}, {}, [guardian]).findings.map((finding) => finding.rule)).toEqual(["unknown_bones"])
})

test("AI work is held; a person's own work is never an obstacle; a simple ask relaxes craft only", async () => {
  const bad = Object.fromEntries((await read(path.join(here, "fixtures/acceptance/bad"))).map((value) => [value.name, value.document]))
  const good = Object.fromEntries((await read(path.join(here, "fixtures/acceptance/good"))).map((value) => [value.name, value.document]))
  const judge = (document: unknown, context: AssetReviewContext) => reviewAsset(project([]), asset("00000000-0000-4000-8000-00000000d009", document), context)
  const own = (document: unknown) => asset("00000000-0000-4000-8000-00000000d009", document, [], null)
  // Fresh AI work and a redo of AI work: refused.
  expect(judge(bad["flat-item"], { insisted: true }).passed).toBe(false)
  // An AI revising a person's own flat icon into another flat icon is spared when nothing insists, and the findings are still listed.
  expect(judge(bad["flat-item"], { revises: own(bad["flat-item"]) })).toMatchObject({ passed: true, spared: true, findings: [{ rule: "few_tones" }] })
  // Turning a person's good icon into static is refused: the AI may not make passing work worse.
  expect(judge(bad["static-item"], { revises: own(good["gem-item"]) })).toMatchObject({ passed: false, spared: false })
  // Inside Studio a run always insists, so the same revision is judged in full.
  expect(judge(bad["flat-item"], { revises: own(bad["flat-item"]), insisted: true }).passed).toBe(false)
  // "简单" relaxes craft (a flat icon) and never a defect (static, or a cast action's rules, which are all defects).
  expect(judge(bad["flat-item"], { brief: "做一个简单的宝石图标", insisted: true })).toMatchObject({ passed: true, level: "simple", findings: [] })
  expect(judge(bad["static-item"], { brief: "做一个简单的宝石图标", insisted: true }).passed).toBe(false)
  const stiff = await Bun.file(path.join(here, "fixtures/gesture-bad/a-old-sword-fingers.json")).json()
  expect(judge(stiff, { brief: "做一个简单的施法动作", insisted: true }).passed).toBe(false)
  // Only the person's own words can ask for simple work; a planner's task text cannot.
  expect(judge(bad["flat-item"], { brief: "做一把宝石剑\n做一个简单的宝石图标", asked: "做一把宝石剑", insisted: true }).passed).toBe(false)
})

test("a creature that wears a texture of its own is judged in that texture; a candidate is judged by itself", async () => {
  const bad = Object.fromEntries((await read(path.join(look, "bad"))).map((value) => [value.name, value]))
  const model = asset(MODEL_ID, { kind: "model", ...bad["noise-texture"].model })
  const skin = asset("00000000-0000-4000-8000-00000000e001", { kind: "texture", ...bad["noise-texture"].texture }, [MODEL_ID])
  const creature = asset("00000000-0000-4000-8000-00000000e002", { kind: "entity", name: "守卫", description: "", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile", model_asset_id: MODEL_ID, runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: skin.id } }, [MODEL_ID, skin.id])
  const world = project([model, skin, creature])
  // The model's own paint is fine; what the player sees is the noise it wears.
  expect(reviewAsset(project([model]), model, { complexity: "medium" }).passed).toBe(true)
  expect(reviewAsset(world, model, { complexity: "medium" }).findings.map((finding) => finding.rule)).toContain("noisy_texture")
  expect(reviewAsset(world, model, { complexity: "medium", candidate: true }).passed).toBe(true)
  const kinds: ModuleDocument["kind"][] = ["model", "texture", "entity"]
  expect(kinds.map((kind) => reviewAsset(world, world.workspace.assets.find((value) => value.module === kind)!, { insisted: true }).passed)).toEqual([false, false, true])
  // What the texture covers is the surface. A part made twice is still made twice under any texture.
  const twin = SPOILED.find((value) => value.name === "twin-horn")!
  const doubled = asset(MODEL_ID, { kind: "model", ...twin.model })
  const coat = asset(skin.id, sameLook({ kind: "model", ...twin.model }), [MODEL_ID])
  expect(reviewAsset(project([doubled, coat, creature]), doubled, { complexity: "medium" }).findings.map((finding) => finding.rule)).toEqual(["duplicates"])
})

// A trunk on two stiff legs: with only the trunk turning, both soles stay where they are while the game carries the body (`glide`); swung from the hip they step.
const walkModel = (swung: "body" | "legs") => {
  const faces = { north: "#778899", east: "#778899", south: "#778899", west: "#778899", up: "#99aabb", down: "#556677" }
  const cube = (name: string, origin: number[], size: number[]) => ({ name, origin, size, faces, surface_details: [] })
  const clip = (name: string, bones: string[]) => ({ name, length: 1.6, loop: true, channels: bones.map((bone, index) => ({ bone, keyframes: [0, 0.8, 1.6].map((time, key) => ({ time, rotation: [swung === "legs" ? (index % 2 ? -1 : 1) * 12 * (key === 1 ? -1 : 1) : 0, swung === "body" ? 3 * (key === 1 ? -1 : 1) : 0, 0] })) })) })
  return {
    kind: "model" as const,
    ...ModelDesignSchema.parse({
      name: "炮台",
      texture_size: 128,
      bones: [
        { name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [] },
        { name: "body", parent: "root", pivot: [0, 26, 0], rotation: [0, 0, 0], cubes: [cube("trunk", [-16, 21, -8], [32, 29, 19])] },
        { name: "leg_left", parent: "root", pivot: [6, 24, 0], rotation: [0, 0, 0], cubes: [cube("leg", [1, 0, -2], [10, 20, 4])] },
        { name: "leg_right", parent: "root", pivot: [-6, 24, 0], rotation: [0, 0, 0], cubes: [cube("leg", [-11, 0, -2], [10, 20, 4])] },
      ],
      animations: [clip("idle", ["body"]), clip("walk", swung === "legs" ? ["leg_left", "leg_right"] : ["body"]), clip("hurt", ["body"])],
    }),
  }
}
const walker = (extra: Record<string, unknown> = {}) => asset("00000000-0000-4000-8000-00000000e003", { kind: "entity", name: "炮台", description: "", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile", model_asset_id: MODEL_ID, runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null }, ...extra }, [MODEL_ID])

test("a creature that walks and wears a model whose walk carries the body over the ground with no foot stepping is refused; one that never walks is not", () => {
  const gliding = asset(MODEL_ID, walkModel("body"))
  const stepping = asset(MODEL_ID, walkModel("legs"))
  const rules = (model: WorkspaceAsset, creature: WorkspaceAsset) => reviewAsset(project([model, creature]), creature, { insisted: true }).findings.map((finding) => [finding.rule, finding.severity])
  // It walks (a speed above 0, no stationary): the walk is what the game plays whenever it moves.
  const found = reviewAsset(project([gliding, walker()]), walker(), { insisted: true })
  expect(found.findings.map((finding) => [finding.rule, finding.severity])).toEqual([["walk_glides", "defect"]])
  expect(found.passed).toBe(false)
  expect(found.findings[0]!.message).toContain("走路（walk）这段动作的毛病是：移动时整个在地上平移，没有任何部件往后蹬")
  // The same words as the model stage uses, and the way out of it is said: step, or stay where it is on purpose.
  expect(found.findings[0]!.fix).toContain("让着地的部件在贴着地面的那段时间里往后走")
  expect(found.findings[0]!.fix).toContain("stationary")
  expect(told(found).criteria).not.toBeUndefined()
  // Stepping feet: nothing. Stationary, with its reason: nothing. A speed of 0 plays no walk either.
  expect(rules(stepping, walker())).toEqual([])
  expect(rules(gliding, walker({ stationary: { reason: "炮台固定在塔顶，从不走动" } }))).toEqual([])
  expect(rules(gliding, walker({ speed: 0, behavior: "passive" }))).toEqual([])
  // A flier lands and walks: flight does not excuse a walk that glides.
  expect(rules(gliding, walker({ flight: dragonFlight })).map(([rule]) => rule)).toContain("walk_glides")
  // No model to measure, or a model that is not one: nothing is said.
  expect(reviewAsset(project([walker()]), walker(), { insisted: true }).findings).toEqual([])
})

// Owner's rule: a legitimate subject always has a legal way out. A bat, a ghost or a jellyfish whose model's walk was declared still never plays that walk: its creature-stage maker cannot change the model.
test("a flier that never chooses the ground and has nothing to come down for is not held to how its walk moves; one that can come down is", () => {
  const gliding = asset(MODEL_ID, walkModel("body"))
  const rules = (creature: WorkspaceAsset) => reviewAsset(project([gliding, creature]), creature, { insisted: true }).findings.map((finding) => finding.rule)
  const bat = { ...dragonFlight, air_share: 1 }
  // Never in the mood for the ground (air_share 1), no ability on the ground, no rest, no meal on the ground: the walk is never played, so it is not held to stepping.
  expect(rules(walker({ flight: bat }))).toEqual([])
  expect(flightWalks({ flight: bat })).toBe(false)
  // Whatever can bring it down counts as walking: a mood for the ground, a ground ability, a rest at home, eating after a kill, a boss's leash. Not a flier at all: it walks.
  expect(rules(walker({ flight: { ...bat, air_share: 0.9 } }))).toEqual(["walk_glides"])
  const landing = AbilitySchema.parse({ ...golemAbilities[0], where: "ground" })
  expect(rules(walker({ flight: bat, abilities: [landing] }))).toEqual(["walk_glides"])
  const resting = (extra: Record<string, unknown>) => HabitsSchema.parse({ ...dragonHabits, ...extra })
  expect(rules(walker({ flight: bat, habits: resting({ active: "always", rest: null, eat: null }) }))).toEqual([])
  expect(rules(walker({ flight: bat, habits: resting({ active: "day" }) }))).toEqual(["walk_glides"])
  expect(rules(walker({ flight: bat, habits: resting({ active: "always", rest: null, eat: { clip: "attack" } }) }))).toEqual(["walk_glides"])
  expect(flightWalks({ flight: bat, boss: dragonBoss })).toBe(true)
  expect(flightWalks({ flight: null })).toBe(true)
  // The abilities of an air-only flier do not bring it down.
  expect(flightWalks({ flight: bat, abilities: [{ where: "air" }, { where: "any" }] })).toBe(false)
})

test("a creature that really slides answers walk_glides in its own justified; the reason is shown, and the way out is said in plain words", () => {
  const gliding = asset(MODEL_ID, walkModel("body"))
  const review = (extra: Record<string, unknown>) => reviewAsset(project([gliding, walker(extra)]), walker(extra), { insisted: true })
  const refused = review({})
  expect(refused.passed).toBe(false)
  // What the creature's maker can do is said, and what it cannot (the model) is said to need the model redone, where the overview offers it.
  const fix = refused.findings[0]!.fix
  expect(fix).toContain("stationary")
  expect(fix).toContain('{"what":"walk_glides","reason":"……"}')
  expect(fix).toContain("justified")
  expect(fix).toContain("「重做」")
  expect(fix).toContain("模组总览")
  const reason = "它是一团史莱姆，整个身子贴着地面蠕动着滑过去，没有脚"
  const slime = review({ justified: [{ what: "walk_glides", reason }] })
  expect(slime).toMatchObject({ passed: true, findings: [], answered: [{ rule: "walk_glides", severity: "defect", reason }] })
  expect(told(slime).answered).toEqual([{ criterion: expect.any(String), message: expect.stringContaining("会走动"), reason }])
  // Written the way a person writes it (capitals, a space, a full-width colon) it is the same entry; a reason that is only spaces, or another name, answers nothing.
  expect(review({ justified: [{ what: " Walk_Glides ", reason }] }).passed).toBe(true)
  expect(ModuleDocumentSchema.safeParse({ ...walker().document, justified: [{ what: "walk_glides", reason: "   " }] }).success).toBe(false)
  expect(review({ justified: [{ what: "hostile_but_harmless", reason }] }).passed).toBe(false)
  // Only how it walks is answered here: a creature that is hostile and harmless stays refused whatever it says.
  expect(review({ attack_damage: 0, justified: [{ what: "hostile_but_harmless", reason }] }).findings.map((finding) => finding.rule)).toEqual(["hostile_but_harmless", "walk_glides"])
  // Bounded like the hitbox's list, and a document from before has no such field and is read exactly as it was.
  expect(EntitySchema.safeParse({ ...walker().document, justified: Array.from({ length: CREATURE_JUSTIFIED_MOST + 1 }, (_, index) => ({ what: `a${index}:windup`, reason: "x" })) }).success).toBe(false)
  expect("justified" in (walker().document as object)).toBe(false)
})

// The picture of a block or an item: three things a legitimate subject really is, each with a legal way out by a reason the reviewer judges.
test("a plain block, a speckled block and a full-square item are answered by the part sheet's reasons; faults that are faults whatever the thing is are not", async () => {
  const bad = await read(path.join(here, "fixtures/acceptance/bad"))
  const of = (name: string) => bad.find((value) => value.name === name)!
  const review = (name: string, justified?: { what: string; reason: string }[]) => reviewAsset(project([]), asset("00000000-0000-4000-8000-00000000d001", of(name).document), { insisted: true, justified })
  const cases = [
    ["flat-block", "few_tones", "白色混凝土：一整块同样的白，本来就没有明暗"],
    ["noise-block", "noisy_texture", "砾石：满是大小不一的碎石粒，本来就是一片杂点"],
    ["static-item", "noisy_texture", "星空碎片：满是亮点，本来就是一片杂点"],
    ["brick-item", "icon_fills_square", "这是一张卡牌：整张卡就是整个格子，本来就铺满"],
  ] as const
  cases.forEach(([name, rule, reason]) => {
    const refused = review(name)
    expect({ name, rules: refused.findings.map((finding) => finding.rule), passed: refused.passed }).toEqual({ name, rules: [rule], passed: false })
    // The way out is said with the finding, in the same words a model's craft finding ends with.
    expect(refused.findings[0]!.fix).toContain(justifyTail(rule))
    const answered = review(name, [{ what: rule, reason }])
    expect({ name, passed: answered.passed, findings: answered.findings }).toEqual({ name, passed: true, findings: [] })
    expect(answered.answered).toMatchObject([{ rule, reason }])
    // A reason for another rule, or none, answers nothing.
    expect(review(name, [{ what: "icon_too_faint", reason }]).passed).toBe(false)
    expect(review(name, [{ what: rule, reason: "  " }]).passed).toBe(false)
  })
  // Kept as they were graded: the speckle limit is a defect (no game specimen shows it is craft), the number of tones a matter of craft.
  expect(ITEM_STANDARD.rules.filter((rule) => ["noisy_texture", "icon_fills_square", "few_tones"].includes(rule.id)).map((rule) => [rule.id, rule.severity])).toEqual([["icon_fills_square", "defect"], ["noisy_texture", "defect"], ["few_tones", "craft"]])
  // Not answered by a reason: a speck of an icon nobody can see, and a hole in a solid block. They are only changed.
  expect(review("speck-item", [{ what: "icon_too_faint", reason: "它本来就很小" }, { what: "few_tones", reason: "一个颜色" }]).findings.map((finding) => finding.rule)).toEqual(["icon_too_faint"])
  expect(review("holed-block", [{ what: "block_has_holes", reason: "本来就是个窗" }]).findings.map((finding) => finding.rule)).toEqual(["block_has_holes"])
  expect(SPRITE_ANSWERS).toEqual(["few_tones", "noisy_texture", "icon_fills_square"])
})

test("nothing an AI is told, before or after, gives away a rule's name or a measurement's name", async () => {
  const bad = await specimens("bad")
  const names = INNER_NAMES(bad.map((value) => value.review.measured))
  expect(names.length).toBeGreaterThan(80)
  // Before: the summary, each kind's brief, each kind's whole instructions.
  expect(leaked(STANDARD_SUMMARY, names)).toEqual([])
  ModuleKindSchema.options.forEach((kind) => expect({ kind, brief: leaked(standardBrief(ASSET_STANDARDS[kind]), names), instructions: leaked(MODULES[kind].instructions, names) }).toEqual({ kind, brief: [], instructions: [] }))
  // After: the refusal text of every rejected specimen of every kind, on a first refusal and on the last, and the review as an AI is shown it.
  bad.forEach((value) => {
    const texts = [refusalText(value.review), refusal(MODULES[value.kind].label, value.review, 1).text, refusal(MODULES[value.kind].label, value.review, REFUSAL_CAP).text, JSON.stringify(told(value.review))]
    expect({ name: value.name, leaked: texts.flatMap((text) => leaked(text, names)) }).toEqual({ name: value.name, leaked: [] })
    expect(Object.keys(told(value.review)).filter((key) => key !== "advice").sort()).toEqual(["criteria", "findings", "kind", "level", "passed", "spared", "text", "unreadable"])
    expect(told(value.review).findings.map((finding) => Object.keys(finding).sort().join())).toEqual(value.review.findings.map(() => "criterion,fix,message,severity"))
  })
  // Every finding of every specimen is worded for a person: mostly Chinese, criterion by its name.
  bad.forEach((value) => told(value.review).findings.forEach((finding) => expect(CRITERIA.map((entry) => entry.name)).toContain(finding.criterion)))
})

test("a refusal means the same for every kind and for whoever made the work: nothing saved, told what to change, failed at the cap", async () => {
  const review = (await specimens("bad")).find((value) => value.name === "static-item")!.review
  const first = refusal("物品", review, 1)
  expect(first).toMatchObject({ final: false, left: REFUSAL_CAP - 1 })
  expect(first.text).toBe(`物品没通过验收，工程里什么都没有改动。必须逐条改掉：${refusalText(review)}（还可以再交 ${REFUSAL_CAP - 1} 次）`)
  expect(refusal("物品", review, REFUSAL_CAP - 1)).toMatchObject({ final: false, left: 1 })
  expect(refusal("物品", review, REFUSAL_CAP)).toEqual({ final: true, left: 0, text: `物品改了 ${REFUSAL_CAP} 次还是没通过验收：${refusalText(review)}` })
  // The cap is told beforehand, in every kind's brief, and the two weights are named there as they are everywhere.
  ModuleKindSchema.options.forEach((kind) => {
    expect(standardBrief(ASSET_STANDARDS[kind])).toContain(`同一个任务最多被退回 ${REFUSAL_CAP} 次`)
    expect(standardBrief(ASSET_STANDARDS[kind])).toContain(`只放宽“${SEVERITIES.craft.label}”一类的要求，“${SEVERITIES.defect.label}”照样退回`)
  })
})

test("the review can run in the app's window: nothing it imports needs Node, and it is quick", async () => {
  // Follow every value import from the entry the window uses; type-only imports leave no trace at run time.
  const seen = new Map<string, string>()
  const resolve = (from: string, specifier: string) => {
    if (specifier.startsWith(".")) return path.resolve(path.dirname(from), `${specifier}.ts`)
    if (specifier.startsWith("@minemods/studio-ai/")) return path.join(here, "../../studio-ai/src", `${specifier.slice("@minemods/studio-ai/".length)}.ts`)
    if (specifier.startsWith("@minemods/mod-core/")) return path.join(here, "../src", `${specifier.slice("@minemods/mod-core/".length)}.ts`)
    return null
  }
  const outside = new Set<string>()
  const walk = async (file: string): Promise<void> => {
    if (seen.has(file)) return
    const source = await Bun.file(file).text()
    seen.set(file, source)
    const specifiers = [...source.matchAll(/^(?:import|export)\s+(?!type\s)[^"']*?from\s+["']([^"']+)["']/gm), ...source.matchAll(/^import\s+["']([^"']+)["']/gm)].map((match) => match[1]!)
    await Promise.all(
      specifiers.map((specifier) => {
        const next = resolve(file, specifier)
        if (!next) outside.add(specifier)
        return next ? walk(next) : Promise.resolve()
      }),
    )
  }
  await walk(path.join(here, "../src/acceptance.ts"))
  // Two small pure packages and nothing else: no Node built-ins, no file system, no network.
  expect([...outside].sort()).toEqual(["fflate", "zod"])
  // The walk really went through the kinds' own measuring code (other engineers may add files; none may need Node).
  expect([...seen.keys()].map((file) => path.relative(path.join(here, "../.."), file).split(path.sep).join("/"))).toEqual(expect.arrayContaining(["mod-core/src/acceptance.ts", "mod-core/src/gesture-gate.ts", "mod-core/src/gesture.ts", "mod-core/src/png-decode.ts", "studio-ai/src/acceptance.ts", "studio-ai/src/model-look.ts", "studio-ai/src/model-quality.ts"]))
  seen.forEach((source, file) => expect({ file: path.basename(file), node: /\bBuffer\b|\bprocess\.|\bBun\.|require\(|from "node:|__dirname/.test(source) }).toEqual({ file: path.basename(file), node: false }))
  // Quick enough to run when a card opens: every specimen of every kind, the slowest one well under a frame budget of a second.
  const timed = async (folder: "good" | "bad") => {
    const started = performance.now()
    const count = (await specimens(folder)).length
    return (performance.now() - started) / count
  }
  expect(await timed("good")).toBeLessThan(500)
  expect(await timed("bad")).toBeLessThan(500)
})

test("the written standard says what the code says: its generated sections are the definitions, word for word", async () => {
  // A checkout that converts line endings (Windows) changes no word of it.
  const written = (await Bun.file(path.join(here, "../../../docs/specs/2026-10-05-acceptance-standard.md")).text()).replaceAll("\r\n", "\n")
  const sections = writtenStandard(ASSET_KINDS.map((kind) => ASSET_STANDARDS[kind.id]))
  expect(Object.keys(sections)).toEqual(["criteria", "severity", "matrix", "checks", "refusal"])
  // Regenerate with: bun packages/mod-core/test/fixtures/acceptance/write-standard.ts
  Object.entries(sections).forEach(([name, text]) => expect({ section: name, same: written.includes(`<!-- 生成：${name} -->\n${text}\n<!-- 生成结束：${name} -->`) }).toEqual({ section: name, same: true }))
  // Every rule of every kind is in it by what it asks, and no inner name is.
  ModuleKindSchema.options.forEach((kind) => ASSET_STANDARDS[kind].rules.forEach((rule) => expect({ rule: rule.id, written: written.includes(rule.asks.replace(/。$/, "")) }).toEqual({ rule: rule.id, written: true })))
  expect(leaked(written)).toEqual([])
  // The older art-gate spec keeps the painter's how-to and points here for the rules.
  const older = await Bun.file(path.join(here, "../../../docs/specs/2026-10-05-art-quality-gate.md")).text()
  expect(older).toContain("2026-10-05-acceptance-standard.md")
  expect(leaked(older)).toEqual([])
})

test("broad5: a hostile creature whose abilities do the hurting needs no melee attack of its own", async () => {
  const own: Specimen[] = await read(path.join(here, "fixtures/acceptance", "bad"))
  const hunter = own.find((value) => value.name === "toothless-hunter")!
  const model = hunter.skeleton ? [asset(MODEL_ID, skeletons[hunter.skeleton])] : []
  const judged = (abilities: unknown) =>
    reviewAsset(project(model, hunter.pantry), asset("00000000-0000-4000-8000-00000000d001", { ...(hunter.document as object), abilities } as never, model.map((entry) => entry.id)), { insisted: true }).findings.map((finding) => finding.rule)
  const ability = golemAbilities[0]!
  const area = ability.hits.find((hit) => hit.type === "area")!
  expect(judged([])).toContain("hostile_but_harmless")
  expect(judged([{ ...ability, hits: [{ ...area, damage: 6 }] }])).not.toContain("hostile_but_harmless")
  expect(judged([{ ...ability, hits: [{ type: "shot", at: area.at, projectile: "snowball", speed: 1.6, forward: 1, up: 1.5, damage: null }] }])).not.toContain("hostile_but_harmless")
  // An ability that touches nobody does not count.
  expect(judged([{ ...ability, hits: [{ ...area, damage: 0, effects: [] }] }])).toContain("hostile_but_harmless")
  // 诸怀（r29）: an ability it uses from an ability asset (`shared_abilities`) that hurts counts as one of its own.
  const skill = asset(CAST_SAMPLE_IDS.frost, frostBreath)
  const sharing = (asset_id: string) =>
    reviewAsset(project([...model, skill], hunter.pantry), asset("00000000-0000-4000-8000-00000000d002", { ...(hunter.document as object), abilities: [], shared_abilities: [{ asset: asset_id, id: "frost", clip: ability.clip, windup: 0.5, facing: "track", start: ability.start, stopped_by_hurt: false }] } as never, [...model.map((entry) => entry.id), skill.id]), { insisted: true }).findings.map((finding) => finding.rule)
  expect(sharing(CAST_SAMPLE_IDS.frost)).not.toContain("hostile_but_harmless")
})

test("broad19: every criterion says what it measures, and a rule that passed says the numbers it passed on", async () => {
  // Each named check has one plain line of what it looks at; no inner name, no number an AI could aim at.
  CRITERIA.forEach((value) => {
    expect({ id: value.id, measures: value.measures.length > 8 }).toEqual({ id: value.id, measures: true })
    expect(leaked(value.measures)).toEqual([])
  })
  const good = await specimens("good")
  const bad = await specimens("bad")
  // A review records every rule that ran, in the order it ran, with whether it passed; the passed ones carry what they read when they have a number.
  const reads = good.flatMap((value) => (value.review.looked ?? []).filter((entry) => entry.passed && entry.read).map((entry) => entry.read!))
  expect(reads.length).toBeGreaterThan(40)
  // What a rule read is a plain clause: mostly it has a figure in it (a few say what they looked at because there is nothing to count), and none of the rule's own names.
  expect(reads.filter((text) => /\d/.test(text)).length / reads.length).toBeGreaterThan(0.7)
  const names = INNER_NAMES(good.map((value) => value.review.measured))
  reads.forEach((text) => expect(leaked(text, names)).toEqual([]))
  // `looked` agrees with the findings: a failed rule is exactly a finding, so the card cannot tick what the review refused.
  ;[...good, ...bad].forEach((value) => {
    const failedRules = (value.review.looked ?? []).filter((entry) => !entry.passed).map((entry) => entry.rule).sort()
    expect({ name: value.name, failedRules }).toEqual({ name: value.name, failedRules: [...rules(value.review)].sort() })
  })
  // A review that measured nothing (a design-only kind) looked at nothing and so has nothing to show a person.
  const worldview = reviewAsset(project([]), asset("00000000-0000-4000-8000-00000000d009", { kind: "worldview", title: "符咒师", summary: "", entries: [] }), { insisted: true })
  expect(worldview.looked ?? []).toEqual([])
  // Nothing an AI is told carries a number the person was shown: `told` never hands `looked` over.
  bad.forEach((value) => expect(Object.keys(told(value.review))).not.toContain("looked"))
})

test("broad19: a simple ask runs fewer rules, and only the rules that ran are recorded as looked at", async () => {
  const flat = (await read(path.join(here, "fixtures/acceptance/bad"))).find((value) => value.name === "flat-item")!
  const judge = (brief: string) => reviewAsset(project([]), asset("00000000-0000-4000-8000-00000000d009", flat.document), { brief, insisted: true })
  const full = judge("")
  const simple = judge("做一个简单的宝石图标")
  const ran = (review: AssetReview) => (review.looked ?? []).map((entry) => entry.rule)
  // The craft rule that refuses a flat icon is not run for a simple ask, so it is not claimed as looked at.
  expect(ran(full)).toContain("few_tones")
  expect(ran(simple)).not.toContain("few_tones")
  expect(ran(simple).length).toBeLessThan(ran(full).length)
})

// broad20: a beginner's sword was refused for 孤立杂点 while the review beside it passed it. A lone pixel is noise in a screenful and a deliberate point (a gem, a rivet, a glint)
// in a few; the number cannot tell them apart, so only a picture that is beyond doubt is refused and the rest is advice. The sword itself is not at hand: the wand specimen is a thin
// diagonal blade like it, and the accents are added by a program, one by one.
const wandPicture = async () => {
  const wand = (await read(path.join(here, "fixtures/acceptance/good"))).find((value) => value.name === "wand-item")!
  const image = decodeRgbaPng(decodeTextureDataUrl(wand.document.texture))
  return { wand: wand.document, pixels: new Uint8Array(image.pixels), width: image.width, height: image.height }
}
const GLINTS = [[255, 255, 255], [190, 40, 50], [255, 230, 120], [120, 200, 255]]
/** The wand with `count` accent dots on its own pixels, evenly spread: white, red, gold and ice-blue in turn. */
const accented = async (count: number) => {
  const { wand, pixels, width, height } = await wandPicture()
  const own = Array.from({ length: width * height }, (_, index) => index).filter((index) => pixels[index * 4 + 3]! > 0)
  own.filter((_, order) => count > 0 && order % Math.max(1, Math.floor(own.length / count)) === 0).slice(0, count).forEach((index, order) => pixels.set([...GLINTS[order % 4]!, 255], index * 4))
  return { ...wand, texture: `data:image/png;base64,${Buffer.from(encodePng(pixels, width, height)).toString("base64")}` }
}
const itemReview = (document: unknown) => reviewAsset(project([]), asset("00000000-0000-4000-8000-00000000d009", document), { insisted: true })

test("broad20: deliberate points on a blade (a gem, rivets, glints) are advice at most, never a refusal; static is still refused", async () => {
  // A few accents: nothing said. Up to ten: the old single limit (0.12) refused the sword from the ninth; now it is advice, and the sword passes.
  const few = itemReview(await accented(4))
  expect({ passed: few.passed, findings: rules(few), advice: few.advice ?? [] }).toEqual({ passed: true, findings: [], advice: [] })
  const many = itemReview(await accented(10))
  expect({ passed: many.passed, findings: rules(many), advice: (many.advice ?? []).map((entry) => entry.rule) }).toEqual({ passed: true, findings: [], advice: ["noisy_texture"] })
  expect(many.criteria.find((value) => value.name === "不机械")!.state).toBe("passed")
  // The advice says it in the person's words and does not call it a fault.
  expect(many.advice![0]!.message).toContain("有意点上去的高光、宝石、铆钉就没问题")
  expect(many.advice![0]!.message).not.toMatch(/noisy_texture|speck/)
  // An AI is shown the note, not asked to redo anything; the person's card lists it under the criterion.
  expect(told(many)).toMatchObject({ passed: true, text: null, advice: [{ criterion: "不机械", message: expect.stringContaining("孤立的点") }] })
  // Static is still beyond doubt: both specimens and the wand with every pixel of it a different colour.
  const bad = await specimens("bad")
  ;["static-item", "noise-block"].forEach((name) => {
    const review = bad.find((value) => value.name === name)!.review
    expect({ name, passed: review.passed, findings: rules(review), advice: review.advice ?? [] }).toEqual({ name, passed: false, findings: ["noisy_texture"], advice: [] })
  })
  const { wand, pixels, width, height } = await wandPicture()
  Array.from({ length: width * height }, (_, index) => index).filter((index) => pixels[index * 4 + 3]! > 0).forEach((index) => pixels.set([...GLINTS[(index * 7 + (index >> 3)) % 4]!, 255], index * 4))
  const noise = itemReview({ ...wand, texture: `data:image/png;base64,${Buffer.from(encodePng(pixels, width, height)).toString("base64")}` })
  expect(rules(noise)).toEqual(["noisy_texture"])
})

test("broad20: a small icon with a handful of accents has a large share of lone pixels and a small count; the count keeps it from being refused", async () => {
  // Ten accents on a thin blade: nearly a fifth of the pixels that have neighbours, but 5 for every 100 cells of the icon.
  const picture = await accented(10)
  const image = decodeRgbaPng(decodeTextureDataUrl(picture.texture))
  const { measureSprite, SPRITE_LIMITS } = await import("../src/acceptance")
  const measured = measureSprite(image)
  expect(measured.speckShare).toBeGreaterThan(SPRITE_LIMITS.speckShare)
  expect(measured.speckShare).toBeLessThan(SPRITE_LIMITS.speckNoise)
  expect(measured.speckDensity).toBeLessThan(SPRITE_LIMITS.speckDots)
  // Where the two limits stand: the specimens that are static have both above, the accent-laden wand has neither.
  const bad = Object.fromEntries((await read(path.join(here, "fixtures/acceptance/bad"))).filter((value) => typeof value.document?.texture === "string").map((value) => [value.name, measureSprite(decodeRgbaPng(decodeTextureDataUrl(value.document.texture)))]))
  expect(bad["static-item"]!.speckShare).toBeGreaterThan(SPRITE_LIMITS.speckNoise)
  expect(bad["static-item"]!.speckDensity).toBeGreaterThan(SPRITE_LIMITS.speckDots)
  expect(bad["noise-block"]!.speckDensity).toBeGreaterThan(SPRITE_LIMITS.speckDots * 2)
  expect(SPRITE_LIMITS.speckShare).toBeLessThan(SPRITE_LIMITS.speckNoise)
})

test("broad20: the real mask of the 10-19 veteran's project (a 16×16 icon with nine colours) has nothing to say about its dots", () => {
  // The shaman mask as the project holds it (沼泽巫祝, item 巫祝面具), the picture its AI made and the gate accepted (a data URL of 270 characters).
  const mask = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAf0lEQVR4nGNgoDaw0pb7f2xFBVYMkiPKgNtHpmJgogwAKcjzM8DpApAcXkOoZoCinBQYwzTC+GQZcO/o1AEwYFaJFxjDDIDxSTIA5n+YAeUhZoQNAAGQIhiGGYAshlczzBUwJ6NjolMiTDEyJtoAmCGb+mLhmCTNuLxBkgGkAAB17QhKvZY7qwAAAABJRU5ErkJggg=="
  const review = reviewAsset(project([]), asset("00000000-0000-4000-8000-00000000d009", { kind: "item", identifier: "shaman_mask", name: "巫祝面具", max_stack: 1, color: "#B89B66", texture: mask }), { insisted: true })
  expect({ passed: review.passed, findings: rules(review), advice: review.advice ?? [] }).toEqual({ passed: true, findings: [], advice: [] })
})
