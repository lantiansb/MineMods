import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { AbilityAssetDocumentSchema, expandedMoves, sharedAbilityInline, sharedAbilityIssues, ABILITY_ASSET_INSTRUCTIONS } from "../src/ability-asset"
import { scaleFactors, scaleWords } from "../src/ability-scale"
import { abilityUsers } from "../src/ability-usage"
import { SharedAbilityUseSchema, type Ability } from "../src/entity-runtime"
import { reconcile } from "../src/reconcile"
import { openProject, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { createTargetScaleSample, SCALE_SAMPLE_IDS, sideCharge } from "../script/target-scale-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"
import { effectCorners, effectPlaces } from "../src/effect-abilities"
import { EffectDocumentSchema } from "../src/effect"
import { golemEffects } from "../script/data-gameplay-sample"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const use = (scale?: unknown) => SharedAbilityUseSchema.parse({ asset: SCALE_SAMPLE_IDS.charge, id: "charge", clip: "slam", windup: 0.4, facing: "track", start: { min_distance: 2, max_distance: 6, line_of_sight: true, cooldown: 6, weight: 2 }, ...(scale === undefined ? {} : { scale }) })
const inline = (scale?: unknown) => sharedAbilityInline(use(scale), sideCharge).ability!
const dash = (ability: Ability) => ability.moves.find((move) => "type" in move && move.type === "dash") as Extract<Ability["moves"][number], { type: "dash" }>
const box = (ability: Ability) => (ability.hits[0] as Extract<Ability["hits"][number], { type: "area" }>).shape as Extract<Extract<Ability["hits"][number], { type: "area" }>["shape"], { type: "box" }>
const event = <T extends Ability["events"][number]["type"]>(ability: Ability, type: T) => ability.events.find((value) => value.type === type) as Extract<Ability["events"][number], { type: T }>

test("scale 0.5 halves the dash, the box, the shockwave and the effect; damage, knockback and times stay", () => {
  const whole = inline()
  const half = inline(0.5)
  expect([dash(whole).distance, dash(whole).speed]).toEqual([12, 20])
  expect([dash(half).distance, dash(half).speed]).toEqual([6, 10])
  expect(box(half)).toEqual({ type: "box", forward: 0.75, up: 0.5, left: 0, width: 2, height: 1.25, depth: 1 })
  const wave = event(half, "shockwave")
  expect([wave.from_radius, wave.to_radius, wave.width, wave.height]).toEqual([0.5, 3, 0.5, 0.4])
  // Damage keeps to `damage_scale`, knockback and times are its own.
  expect([wave.damage, wave.knockback, wave.at, wave.seconds]).toEqual([4, 0.5, 1, 0.5])
  expect(half.hits[0]).toMatchObject({ damage: 10, knockback: 1, at: 0.4 })
  expect([half.windup, half.length, dash(half).from, dash(half).to]).toEqual([whole.windup, whole.length, 0.4, 1])
  // The effect is drawn at half its size and put at half the offset; the unscaled one has no size written.
  expect(event(half, "effect")).toMatchObject({ forward: 0.5, size: 0.5 })
  expect("size" in event(whole, "effect")).toBe(false)
  // The pictures draw it so: every corner of the spike at its fullest, half as far apart.
  const spike = EffectDocumentSchema.parse(golemEffects.spike.document)
  const across = (ability: Ability) => {
    const corners = effectCorners(spike, effectPlaces(ability, event(ability, "effect"))[0]!, 0.3)
    return Math.max(...corners.map((point) => point[1])) - Math.min(...corners.map((point) => point[1]))
  }
  expect(across(whole)).toBeGreaterThan(0)
  expect(across(half) / across(whole)).toBeCloseTo(0.5, 5)
})

test("reach, size and speed apart: the dash goes a third as far, keeping its time unless speed says otherwise, the box half as wide", () => {
  const apart = inline({ reach: 1 / 3, size: 0.5 })
  expect([dash(apart).distance, dash(apart).speed]).toEqual([4, 6.6667])
  expect(box(apart).width).toBe(2)
  const quick = inline({ reach: 1 / 3, speed: 1 })
  expect([dash(quick).distance, dash(quick).speed, box(quick).width]).toEqual([4, 20, 4])
  expect(scaleWords({ reach: 1 / 3, size: 0.5 })).toBe("范围和位置 ×0.5、位移距离 ×0.333、冲刺速度 ×0.333")
  expect(scaleWords(0.5)).toBe("整体缩放 ×0.5（范围、位移距离和冲刺速度一起）")
})

test("a scale that changes nothing is no scale: the same ability as none written", () => {
  for (const nothing of [1, {}, { reach: 1, size: 1, speed: 1 }]) {
    expect(scaleFactors(nothing)).toBeNull()
    expect(inline(nothing)).toEqual(inline())
  }
  expect(scaleWords(undefined)).toBe("")
})

test("a scale that takes a number past its field's bounds is refused with that field named, and said as a build stop", async () => {
  const refused = sharedAbilityInline(use(0.1), sideCharge)
  expect(refused.ability).toBeNull()
  expect(refused.reason).toContain("按 scale 缩放以后有数超出了能写的范围")
  expect(refused.reason).toContain("events.0.to_radius")
  expect(SharedAbilityUseSchema.safeParse({ ...use(), scale: 5 }).success).toBe(false)
  expect(SharedAbilityUseSchema.safeParse({ ...use(), scale: { far: 2 } }).success).toBe(false)
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-scale-stop-"))
  roots.push(root)
  const project = await createTargetScaleSample(path.join(root, "石甲兽群"), "forge-1.20.1", { scale: 0.1 })
  expect(sharedAbilityIssues(project).map((issue) => issue.text).join("")).toContain("当不了它的招式：按 scale")
})

test("the checks read the scaled numbers: the charge's reach, and a swing's reach (ability_reach)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-scale-checks-"))
  roots.push(root)
  const project = await createTargetScaleSample(path.join(root, "石甲兽群"), "forge-1.20.1")
  const [big, small] = project.entities
  expect(expandedMoves(small!, project.workspace).map((move) => dash(move).distance)).toEqual([6])
  expect(expandedMoves(big!, project.workspace).map((move) => dash(move).distance)).toEqual([12])
  // A swing that reaches 3.5 blocks ahead, written for a window up to 3: fine as written, short by half at half the size.
  const swing = AbilityAssetDocumentSchema.parse({ ...sideCharge, name: "横扫", english_name: "Sweep", moves: [], events: [], hits: [{ ...sideCharge.hits[0], shape: { type: "box", forward: 2, up: 1, left: 0, width: 3, height: 2, depth: 3 } }] })
  const swingId = "5ca1e000-0000-4000-8000-000000000003"
  const swingUse = (scale?: number) => ({ asset: swingId, id: "sweep", clip: "slam", windup: 0.4, facing: "track", start: { min_distance: 0, max_distance: 3, line_of_sight: true, cooldown: 4, weight: 1 }, stopped_by_hurt: false, ...(scale ? { scale } : {}) })
  const asset = project.workspace.assets.find((value) => value.id === SCALE_SAMPLE_IDS.charge)!
  const withSwing = (scale?: number) => ({
    ...project,
    entities: project.entities.map((entity, index) => ({ ...entity, shared_abilities: [...entity.shared_abilities!, SharedAbilityUseSchema.parse(swingUse(index ? scale : undefined))] })),
    workspace: { assets: [...project.workspace.assets, { ...asset, id: swingId, title: "横扫", document: swing }] },
  })
  const reaches = (given: ReturnType<typeof withSwing>) =>
    reconcile(given as never, { animations: Object.fromEntries(given.entities.map((entity) => [entity.id, ["idle", "walk", "hurt", "slam", "burst"]])), built: null } as never)
      .filter((finding) => finding.rule === "ability_reach" || finding.rule === "ability_move")
      .map((finding) => `${finding.about?.name}：${finding.text}`)
  expect(reaches(withSwing()).filter((text) => text.includes("横扫"))).toEqual([])
  const scaled = reaches(withSwing(0.5)).filter((text) => text.includes("横扫"))
  expect(scaled.length).toBe(1)
  expect(scaled[0]).toContain("石甲幼兽")
  expect(scaled[0]).toContain("正前方最远只打得到 1.75 格")
  // The charge: a cub that waits for its target 7 blocks off cannot reach them with a dash of 6 and a box 0.5 deep.
  const far = { ...project, entities: project.entities.map((entity, index) => (index ? { ...entity, shared_abilities: entity.shared_abilities!.map((value) => ({ ...value, start: { ...value.start, min_distance: 8, max_distance: 10 } })) } : entity)) }
  expect(reaches(far as never).join("\n")).toContain("冲到头（6 格）")
})

test("the skill's page says each user's scale, and the instructions say when to scale and when to save a copy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-scale-users-"))
  roots.push(root)
  const project = await createTargetScaleSample(path.join(root, "石甲兽群"), "forge-1.20.1")
  const users = abilityUsers(project, SCALE_SAMPLE_IDS.charge, sideCharge)
  expect(users.map((user) => [user.title, user.scale])).toEqual([["石甲巨兽", undefined], ["石甲幼兽", "cub_charge：整体缩放 ×0.5（范围、位移距离和冲刺速度一起）"]])
  expect(ABILITY_ASSET_INSTRUCTIONS).toContain("只差尺寸时用 scale；要改时机、出手次数或换效果时另存一份技能")
})

/** The project built once more with the cub's scale set to `scale` (left out: no scale written), every file read back. */
async function build(directory: string, scale: unknown) {
  const stored = await openProject(directory)
  await saveProject(directory, { ...stored, entities: stored.entities.map((entity, index) => (index ? { ...entity, shared_abilities: entity.shared_abilities!.map(({ scale: _scale, ...value }) => ({ ...value, ...(scale === undefined ? {} : { scale }) })) } : entity)) } as never, stored.revision)
  const source = `${directory}-source-${JSON.stringify(scale ?? "none").replace(/\W/g, "")}`
  await mkdir(source)
  await assembleBuildSource(directory, source, TEMPLATE)
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/")).sort()
  return { source, files: Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(path.join(source, name))] as const))) }
}

for (const target of Object.keys(CLASSPATH) as TargetId[]) {
  test(`${target}: the cub's charge is built at half the size and compiles; a scale of 1 builds byte for byte as none`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-scale-build-"))
    roots.push(root)
    const directory = path.join(root, "石甲兽群")
    await createTargetScaleSample(directory, target, { scale: null })
    const none = await build(directory, undefined)
    const one = await build(directory, 1)
    // The project itself (its backup, the build record) says what was written; what it builds is the same.
    const built = (files: Record<string, Buffer>) => Object.keys(files).filter((name) => name.startsWith("src/"))
    expect(built(one.files)).toEqual(built(none.files))
    expect(built(none.files).filter((name) => !one.files[name]!.equals(none.files[name]!))).toEqual([])
    // Nothing of a size is written where no effect has one.
    const java = (files: Record<string, Buffer>) => Object.entries(files).filter(([name]) => name.endsWith(".java")).map(([, text]) => text.toString("utf8")).join("\n")
    expect(java(none.files)).not.toContain("float size")
    const half = await build(directory, 0.5)
    const creatures = Object.entries(half.files).filter(([name]) => /StudioCreature\w*\.java$/.test(name) && !/Renderer|Model/.test(name)).map(([, text]) => text.toString("utf8"))
    // The cub's class carries the scaled numbers, the brute's the asset's own.
    expect(creatures.some((text) => text.includes("abilityEffect(\"5ca1e000-0000-4000-8000-000000000002\"") && text.includes(", 0.5f);"))).toBe(true)
    expect(java(half.files)).toContain("effect.size(size);")
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(half.source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 300000)
}
