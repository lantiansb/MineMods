import { afterEach, expect, test } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  BOSS_BAR_INSTRUCTIONS,
  BOSS_BAR_LIMITS,
  BossBarDocumentSchema,
  bossBarFilled,
  bossBarIssues,
  bossBarLayout,
  bossBarLines,
  bossBarLit,
  bossBarLockFrame,
  bossBarLookup,
  bossBarMasks,
  bossBarMoments,
  drawBossBar,
  evenLines,
  type BossBarDocument,
} from "../src/boss-bar"
import { assembleBuildSource } from "../src/build-source"
import { BOSS_INSTRUCTIONS } from "../src/creature-boss"
import { AbilitySchema, BossSchema, EntitySchema, type Ability, type Boss } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { BOSS_BAR, bossBarOverlayMixin, compileBossBars } from "../src/fabric/boss-bar"
import { genTarget } from "../src/platform/target"
import { encodePng } from "../src/png"
import { decodeRgbaPng } from "../src/png-decode"
import { saveProject } from "../src/project"
import { reconcile } from "../src/reconcile"
import { MODULES, kindCapability, kindInstructions, savedStatus } from "../src/workspace-modules"
import { reviewAsset } from "../src/acceptance"
import { sampleProject } from "./fixtures/gameplay/sample"
import { WorkspaceSchema } from "../src/workspace"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac, targetJavac } from "./target-javac"

const OFFICIAL = "fabric-1.21.1-official"
const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-bossbar-"))
  roots.push(root)
  return root
}

const [slam, burst] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability, Ability]
// The boss of boss-runtime.test.ts: two lines of life (0.66, 0.33), three stages; "slam" only in the second, both in the third.
const boss: Boss = BossSchema.parse({
  bar: { color: "purple", style: "notched_10", darken_sky: true },
  intro: { wake_distance: 16, clip: "roar", seconds: 0.8, sound: "entity.iron_golem.attack" },
  phases: [
    { below: 0.66, clip: "wave", seconds: 1, bar_color: "red", speed: 1.15, damage: 1.3, abilities: ["slam"] },
    { below: 0.33, clip: "wave", seconds: 1, bar_color: null, speed: 1.3, damage: 1.6, abilities: [] },
  ],
  death: { seconds: 4, xp_bursts: 6, explosion: true },
  leash: { distance: 48, reset_seconds: 30 },
})
const names = [
  { zh: "苏醒", en: "Awakened" },
  { zh: "狂怒", en: "Enraged" },
  { zh: "垂死", en: "Last Stand" },
]
const bronze: BossBarDocument = BossBarDocumentSchema.parse({ kind: "bossbar", background: "bronze", fill: null, drain: "left", segments: [], lock: { frames: null, ticks: 4, at: [] }, icons: [{ abilities: ["slam"], image: null, at: null }, { abilities: ["burst"], image: null, at: null }], names, name_at: null, dots: null })
const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }

const solid = (width: number, height: number, color: readonly number[]) => `data:image/png;base64,${Buffer.from(encodePng(Uint8Array.from({ length: width * height * 4 }, (_, index) => color[index % 4]!), width, height)).toString("base64")}`
const refused = (change: Record<string, unknown>) => BossBarDocumentSchema.safeParse({ ...bronze, ...change }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
const pixel = (picture: { width: number; pixels: Uint8Array }, x: number, y: number) => [...picture.pixels.slice((y * picture.width + x) * 4, (y * picture.width + x) * 4 + 4)]

// ---- the document ----

test("a bar is data: the bronze one needs no picture, an imported one is held to its size and its counts agree", () => {
  expect(refused({})).toBe("")
  // Imported: a PNG of at most 512×128 and a segment for every stage, inside it.
  const own = { background: solid(200, 40, [40, 30, 20, 255]), segments: [0, 1, 2].map((phase) => ({ x: 10 + phase * 60, y: 10, width: 50, height: 8, phase })) }
  expect(refused(own)).toBe("")
  expect(refused({ ...own, background: solid(600, 40, [0, 0, 0, 255]) })).toContain("最大 512×128")
  expect(refused({ ...own, segments: [] })).toContain("要写 segments")
  expect(refused({ ...own, segments: own.segments.slice(0, 2) })).toContain("两边要一样多")
  expect(refused({ ...own, segments: [...own.segments.slice(0, 2), { ...own.segments[2]!, x: 190 }] })).toContain("超出了底图")
  expect(refused({ ...own, segments: [...own.segments.slice(0, 2), { ...own.segments[2]!, phase: 1 }] })).toContain("写了两段血条")
  expect(refused({ ...own, fill: solid(100, 40, [255, 0, 0, 255]) })).toContain("要和底图一样大")
  expect(refused({ ...own, fill: "#ff0000" })).toBe("")
  // The lock: frames of one size, at most 64 a side, one place per line.
  expect(refused({ lock: { frames: [solid(8, 8, [1, 1, 1, 255]), solid(9, 8, [1, 1, 1, 255])], ticks: 3, at: [] } })).toContain("每一帧要一样大")
  expect(refused({ lock: { frames: [solid(70, 8, [1, 1, 1, 255]), solid(70, 8, [1, 1, 1, 255])], ticks: 3, at: [] } })).toContain(`最大 ${BOSS_BAR_LIMITS.lock}`)
  expect(refused({ lock: { frames: null, ticks: 4, at: [{ x: 1, y: 1 }] } })).toContain("每条线一把锁")
  expect(refused({ lock: { frames: null, ticks: 0, at: [] } })).not.toBe("")
  // Icons: at most 32 a side, an id once, in the picture.
  expect(refused({ icons: [{ abilities: ["slam", "slam"], image: null, at: null }] })).toContain("写了两遍")
  expect(refused({ icons: [{ abilities: ["slam"], image: solid(40, 40, [1, 1, 1, 255]), at: null }] })).toContain(`图标最大 ${BOSS_BAR_LIMITS.icon}`)
  expect(refused({ ...own, icons: [{ abilities: ["slam"], image: null, at: { x: 195, y: 30 } }] })).toContain("超出了底图")
  expect(refused({ icons: Array.from({ length: BOSS_BAR_LIMITS.icons + 1 }, () => ({ abilities: ["slam"], image: null, at: null })) })).not.toBe("")
  // Names: one per stage, at most four stages, the English one in English.
  expect(refused({ names: [...names, ...names] })).not.toBe("")
  expect(refused({ names: [{ zh: "苏醒", en: "苏醒" }] })).toContain("英文名里不能有中文")
  expect(refused({ background: "data:image/png;base64,AAAA" })).toContain("读得出来")
})

test("the kind is in the registry, saved as a draft until a boss shows it, and its instructions say how to make and attach one and how the icons light", () => {
  expect(Object.keys(MODULES)).toContain("bossbar")
  expect(MODULES.bossbar.label).toBe("血条")
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) expect(savedStatus("bossbar", target)).toBe("design")
  const words = kindInstructions("bossbar", "fabric-1.21.1")
  expect(words).toBe(BOSS_BAR_INSTRUCTIONS)
  for (const said of ['"bronze"', "boss.bar.look", "phases 数加一", "点亮", "ticks", "at 是每把锁左上角", "dots", "代替原版的血条"]) expect(words).toContain(said)
  // The game draws it now on every target: nothing says the game's bar is still shown.
  expect(words).not.toContain("仍然显示原版血条")
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) expect(kindCapability("bossbar", target)).toBe("runtime")
  expect(BOSS_INSTRUCTIONS).toContain('bar.look（可选）："vanilla"')
  // The example in the instructions is a document that parses.
  const example = /例（不画图）：(\{.*\})。$/.exec(words)![1]!
  expect(BossBarDocumentSchema.safeParse(JSON.parse(example)).success).toBe(true)
})

// ---- the layout and the three rules ----

test("the bronze look is laid out for its stages: three segments, two locks on the gaps, a row of icons, all inside the plaque", () => {
  const layout = bossBarLayout(bronze)
  expect(layout.segments).toHaveLength(3)
  expect(layout.lock.frames).toHaveLength(4)
  expect(layout.lock.at).toHaveLength(2)
  expect(layout.icons).toHaveLength(2)
  const { width, height } = layout.background
  expect(width).toBeLessThanOrEqual(BOSS_BAR_LIMITS.width)
  expect(height).toBeLessThanOrEqual(BOSS_BAR_LIMITS.height)
  layout.segments.forEach((segment) => expect(segment.x + segment.width <= width && segment.y + segment.height <= height).toBe(true))
  // Each lock sits between the end of one segment and the start of the next.
  layout.lock.at.forEach((point, line) => {
    const middle = point.x + layout.lock.frames[0]!.width / 2
    expect(middle).toBeGreaterThan(layout.segments[line]!.x + layout.segments[line]!.width - 1)
    expect(middle).toBeLessThan(layout.segments[line + 1]!.x + 1)
  })
  layout.icons.forEach((icon) => expect(icon.x >= 0 && icon.y + icon.image.height <= height && icon.x + icon.image.width <= width).toBe(true))
  // A row of dots asks the plaque for a row of its own.
  expect(bossBarLayout({ ...bronze, dots: { x: 0, y: 0, gap: 4, size: 4 } }).background.height).toBeGreaterThan(height)
})

test("a segment is as full as its stage's share of life; a lock is whole, breaks frame by frame, then is gone; an icon lights while what it names runs", () => {
  const lines = bossBarLines(boss.phases)
  expect(lines).toEqual([1, 0.66, 0.33])
  expect([0, 1, 2].map((stage) => bossBarFilled(64, lines, stage, 1))).toEqual([64, 64, 64])
  expect([0, 1, 2].map((stage) => bossBarFilled(64, lines, stage, 0.5))).toEqual([0, 33, 64])
  expect([0, 1, 2].map((stage) => bossBarFilled(64, lines, stage, 0.05))).toEqual([0, 0, 10])
  expect(bossBarFilled(64, lines, 2, 0)).toBe(0)
  // Line 0 between stage 0 and 1, four frames of 4 ticks.
  expect(bossBarLockFrame(0, 0, -1, 4, 4)).toBe(0)
  expect([0, 3, 4, 8, 11, 12].map((elapsed) => bossBarLockFrame(0, 1, elapsed, 4, 4))).toEqual([1, 1, 2, 3, 3, -1])
  expect(bossBarLockFrame(0, 1, -1, 4, 4)).toBe(-1)
  expect(bossBarLockFrame(0, 2, 0, 4, 4)).toBe(-1)
  expect(bossBarLockFrame(1, 1, 0, 4, 4)).toBe(0)
  // Choices: slam, burst, then a combo; icon 0 is slam's, icon 1 burst's and the combo's.
  const masks = bossBarMasks([{ abilities: ["slam"] }, { abilities: ["burst", "both"] }], ["slam", "burst", "both"])
  expect(masks).toEqual([1, 6])
  expect(bossBarLit(masks, -1)).toBe(0)
  expect(bossBarLit(masks, 0)).toBe(1)
  expect(bossBarLit(masks, 2)).toBe(2)
  // Inside the combo, slam plays: both icons.
  expect(bossBarLit(masks, 2, 0)).toBe(3)
})

test("the preview's three moments: full, just past the first line with the lock breaking, low; drawn with the same rules", () => {
  const layout = bossBarLayout(bronze)
  const lines = evenLines(3)
  const moments = bossBarMoments(layout, lines)
  expect(moments.map((moment) => moment.label.split(" · ")[0])).toEqual(["满血", "刚过第一条线（67%），血量 66%，锁正在碎（第 3/4 帧）", "残血 5%"])
  expect(moments[1]!.state.phase).toBe(1)
  expect(bossBarLockFrame(0, 1, moments[1]!.state.broke, 4, layout.lock.ticks)).toBe(2)
  expect(moments.map((moment) => moment.state.lit)).toEqual([0, 1, 2])
  expect(moments[0]!.label).toContain("「苏醒」（Awakened）")
  expect(moments[2]!.label).toContain("「垂死」")
  const [full, breaking, low] = moments.map((moment) => drawBossBar(layout, lines, moment.state))
  const first = layout.segments[0]!
  const last = layout.segments[2]!
  const middle = (segment: typeof first) => [segment.x + 1, segment.y + Math.floor(segment.height / 2)] as const
  // Full: the first segment shows the fill; past the first line it is empty (the trough), and the last one is still full; low: only a sliver of the last.
  expect(pixel(full!, ...middle(first))).toEqual(pixel(full!, ...middle(last)))
  expect(pixel(breaking!, ...middle(first))).not.toEqual(pixel(full!, ...middle(first)))
  expect(pixel(breaking!, ...middle(last))).toEqual(pixel(full!, ...middle(last)))
  expect(pixel(low!, last.x + last.width - 2, last.y + 4)).not.toEqual(pixel(full!, last.x + last.width - 2, last.y + 4))
  // A lit icon is brighter than the same icon dim.
  const icon = layout.icons[0]!
  const at = [icon.x + 8, icon.y + 8] as const
  expect(pixel(breaking!, ...at)[0]!).toBeGreaterThan(pixel(full!, ...at)[0]!)
})

// ---- the boss that uses it ----

test("a boss names its bar as vanilla or an asset; an old boss is unchanged and generates byte for byte the same Java (hash pinned at 874bdf7); one with its own bar only adds the lines that send its state", () => {
  expect(BossSchema.safeParse({ ...boss, bar: { ...boss.bar, look: "vanilla" } }).success).toBe(true)
  expect(BossSchema.safeParse({ ...boss, bar: { ...boss.bar, look: { asset: randomUUID() } } }).success).toBe(true)
  expect(BossSchema.safeParse({ ...boss, bar: { ...boss.bar, look: "bronze" } }).success).toBe(false)
  expect(BossSchema.safeParse({ ...boss, bar: { ...boss.bar, look: { asset: "not-a-uuid" } } }).success).toBe(false)
  // An old document parses to exactly itself: nothing is added to it.
  expect(JSON.stringify(BossSchema.parse(JSON.parse(JSON.stringify(boss))))).toBe(JSON.stringify(boss))
  expect("look" in BossSchema.parse(boss).bar).toBe(false)
  const hash = (files: Record<string, string | Uint8Array>) => Object.keys(files).sort().reduce((sum, name) => sum.update(`${name}\0`).update(files[name]!).update("\0"), createHash("sha256")).digest("hex")
  // The hash of this creature's generated files, taken on the commit before bars existed.
  const PINNED = "1f7e84a3464b9771c13ea83d2b0046312a3f7bc628c4ecd579b866b07f5ea1fe"
  expect(hash(compileEntity({ ...plain, abilities: [slam, burst], boss }))).toBe(PINNED)
  expect(hash(compileEntity({ ...plain, abilities: [slam, burst], boss: { ...boss, bar: { ...boss.bar, look: "vanilla" } } }))).toBe(PINNED)
  // A bar of its own adds to the creature's class only what tells the players of its bar what it shows (B2): every other line is the pinned class's, in order.
  const before = compileEntity({ ...plain, abilities: [slam, burst], boss })
  const after = compileEntity({ ...plain, abilities: [slam, burst], boss: { ...boss, bar: { ...boss.bar, look: { asset: randomUUID() } } } })
  expect(hash(after)).not.toBe(PINNED)
  const creatureFile = Object.keys(before).find((name) => name.endsWith("/entity/StudioCreature.java"))!
  expect(Object.keys(after).filter((name) => String(after[name]) !== String(before[name]))).toEqual([creatureFile])
  const added: string[] = []
  const was = String(before[creatureFile]).split("\n")
  let at = 0
  for (const line of String(after[creatureFile]).split("\n")) {
    if (at < was.length && line === was[at]) at++
    else added.push(line)
  }
  expect(at).toBe(was.length)
  expect(added.filter((line) => line.trim() && !/bossBar|BOSS_BAR|StudioBossBar|^\s*(\/\/|\/\*\*|\*|\*\/|\}|int phase = bossPhase\(\);|if \(state\.equals)/.test(line))).toEqual([])
  expect(added.join("\n")).toContain('StudioBossBarSync.send(bossBar.getPlayers(), bossBar.getId(), "creature", state);')
  // The icons are lit by the ability it runs.
  expect(added.join("\n")).toContain("StudioBossBarState.litIcons(BOSS_BAR_ICONS, abilityIndex, -1)")
})

test("the reviewer's checks: the bar is there, has a segment and a name for every stage, icons bound to what the boss has and uses, locks broken in time", () => {
  const id = randomUUID()
  const project = (document: BossBarDocument) => ({ workspace: { assets: [{ id, title: "青铜血条", document }] } })
  const creature = (change: Partial<Boss> = {}, abilities: { id: string }[] = [slam, burst]) => ({ name: "晶石傀儡", abilities, combos: [], boss: { ...boss, bar: { ...boss.bar, look: { asset: id } }, ...change } })
  const rules = (document: BossBarDocument, change: Partial<Boss> = {}, abilities?: { id: string }[]) => bossBarIssues(creature(change, abilities), bossBarLookup(project(document))).map((issue) => `${issue.rule}:${issue.stops}`)
  expect(rules(bronze)).toEqual([])
  expect(bossBarIssues({ name: "x", boss }, bossBarLookup(project(bronze)))).toEqual([])
  expect(bossBarIssues(creature(), bossBarLookup({ workspace: { assets: [] } })).map((issue) => issue.rule)).toEqual(["boss_bar_missing"])
  // One phase fewer: two stages, the bar has three.
  expect(rules(bronze, { phases: boss.phases.slice(0, 1) })).toEqual(["boss_bar_stages:true"])
  expect(bossBarIssues(creature({ phases: boss.phases.slice(0, 1) }), bossBarLookup(project(bronze)))[0]!.text).toContain("2 个阶段")
  // An icon bound to an ability it does not have.
  expect(rules(BossBarDocumentSchema.parse({ ...bronze, icons: [{ abilities: ["quake"], image: null, at: null }] }))).toEqual(["boss_bar_icon:true"])
  // A lock that is still breaking when the change of phase is over: 7 frames of 10 ticks is 3 seconds, the change is 1.
  expect(rules(BossBarDocumentSchema.parse({ ...bronze, lock: { frames: Array.from({ length: 7 }, () => solid(8, 8, [9, 9, 9, 255])), ticks: 10, at: [] } }))).toEqual(["boss_bar_lock_slow:false", "boss_bar_lock_slow:false"])
})

test("the workspace holds a boss to its bar: it depends on it, and it is a bar", () => {
  const stamp = new Date().toISOString()
  const asset = (id: string, module: string, document: unknown, dependencies: string[] = []) => ({ id, module, title: module, revision: 1, created_at: stamp, updated_at: stamp, prompt: "x", dependencies, document, provenance: { model: null, request_id: null }, status: "design" })
  const model = randomUUID()
  const bar = randomUUID()
  const entity = (look: unknown, dependencies: string[]) =>
    asset(randomUUID(), "entity", { kind: "entity", name: "晶石傀儡", description: "", health: 40, speed: 0.2, attack_damage: 6, behavior: "hostile", model_asset_id: model, runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null }, abilities: [slam, burst], boss: { ...boss, bar: { ...boss.bar, look } } }, dependencies)
  const assets = [asset(model, "model", { kind: "model", ...fightingGolemDesign }), asset(bar, "bossbar", bronze)]
  const messages = (look: unknown, dependencies: string[]) => WorkspaceSchema.safeParse({ assets: [...assets, entity(look, dependencies)] }).error?.issues.map((issue) => issue.message) ?? []
  expect(messages({ asset: bar }, [model, bar])).toEqual([])
  expect(messages("vanilla", [model])).toEqual([])
  expect(messages({ asset: bar }, [model])).toEqual(["Entity asset must depend on a non-empty bossbar workspace asset"])
  expect(messages({ asset: model }, [model])).toContain(`A boss bar look must be a bossbar workspace asset: ${model}`)
})

// ---- the build ----

async function barProject(look: "none" | "vanilla" | "bar", document: BossBarDocument = bronze) {
  const root = await temporary()
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const golem = sample.entities[0]!
  const stamp = new Date().toISOString()
  const id = randomUUID()
  const asset = { id, module: "bossbar" as const, title: "青铜血条", revision: 1, created_at: stamp, updated_at: stamp, prompt: "朴素的青铜牌", dependencies: [], document, provenance: { model: null, request_id: null }, status: "design" as const }
  const bar = look === "none" ? boss.bar : { ...boss.bar, look: look === "vanilla" ? ("vanilla" as const) : { asset: id } }
  const project = await saveProject(directory, { ...sample, entities: [{ ...golem, abilities: EntitySchema.shape.abilities.unwrap().unwrap().parse([slam, burst]), boss: { ...boss, bar } }], workspace: { assets: [...sample.workspace.assets, ...(look === "bar" ? [asset] : [])] } }, sample.revision)
  const source = path.join(root, "source")
  await mkdir(source)
  return { root, directory, project, source, id, creature: `creature_${golem.id.replaceAll("-", "")}`, build: () => assembleBuildSource(directory, source, TEMPLATE) }
}

const javaAndResources = async (source: string) => {
  const files = (await readdir(path.join(source, "src"), { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
  return Object.fromEntries(await Promise.all(files.sort().map(async (name) => [name, createHash("sha256").update(await readFile(path.join(source, name))).digest("hex")] as const)))
}

test("a boss with a bar of its own builds the bar's pictures, its layout, the names of its stages and three classes; vanilla builds exactly what no look builds", async () => {
  const made = await barProject("bar")
  const built = await made.build()
  const pkg = "com/minemods/content_azure_sample"
  expect(built.bossBarFiles).toEqual([`${pkg}/entity/${BOSS_BAR.state}.class`, `${pkg}/entity/${BOSS_BAR.bars}.class`, `${pkg}/client/${BOSS_BAR.hud}.class`, `${pkg}/entity/${BOSS_BAR.sync}.class`, `${pkg}/client/${BOSS_BAR.client}.class`, `${pkg}/mixin/${BOSS_BAR.mixin}.class`])
  const assets = path.join(made.source, "src/main/resources/assets/azure_sample")
  const folder = `textures/gui/bossbar/bar_${made.id.replaceAll("-", "")}/`
  const pictures = (await readdir(path.join(assets, folder))).sort()
  expect(pictures).toEqual(["background.png", "fill.png", "icon_0.png", "icon_1.png", "lock_0.png", "lock_1.png", "lock_2.png", "lock_3.png"])
  const layout = bossBarLayout(bronze)
  const background = decodeRgbaPng(new Uint8Array(await readFile(path.join(assets, folder, "background.png"))))
  expect([background.width, background.height]).toEqual([layout.background.width, layout.background.height])
  expect(Buffer.from(background.pixels).equals(Buffer.from(layout.background.pixels))).toBe(true)
  const json = JSON.parse(await readFile(path.join(assets, `studio/bossbar/${made.creature}.json`), "utf8"))
  expect(json.folder).toBe(folder)
  expect(json.lines).toEqual([1, 0.66, 0.33])
  expect(json.segments).toHaveLength(3)
  expect(json.lock).toMatchObject({ frames: 4, ticks: 4, width: 12, height: 14 })
  expect(json.icons.map((icon: { mask: number; abilities: string[] }) => [icon.abilities, icon.mask])).toEqual([[["slam"], 1], [["burst"], 2]])
  expect(json.names).toEqual([0, 1, 2].map((stage) => `bossbar.azure_sample.${made.creature}.phase${stage}`))
  const zh = JSON.parse(await readFile(path.join(assets, "lang/zh_cn.json"), "utf8"))
  const en = JSON.parse(await readFile(path.join(assets, "lang/en_us.json"), "utf8"))
  expect(json.names.map((key: string) => zh[key])).toEqual(["苏醒", "狂怒", "垂死"])
  expect(json.names.map((key: string) => en[key])).toEqual(["Awakened", "Enraged", "Last Stand"])
  const bars = await readFile(path.join(made.source, `src/main/java/${pkg}/entity/${BOSS_BAR.bars}.java`), "utf8")
  expect(bars).toContain(`case "${made.creature}": return new int[] {1, 2};`)
  // Fabric: the packet is registered by a main entry point, received by a client one, and the game's boss bars reach the HUD through the mixin (client side only).
  const metadata = JSON.parse(await readFile(path.join(made.source, "src/main/resources/fabric.mod.json"), "utf8"))
  expect(metadata.entrypoints.main).toContain(`com.minemods.content_azure_sample.entity.${BOSS_BAR.sync}`)
  expect(metadata.entrypoints.client).toContain(`com.minemods.content_azure_sample.client.${BOSS_BAR.client}`)
  expect(JSON.parse(await readFile(path.join(made.source, "src/main/resources/azure_sample.mixins.json"), "utf8"))).toMatchObject({ mixins: [], client: [BOSS_BAR.mixin] })
  // The reviewer's findings for this boss say nothing of its bar: it fits.
  expect(built.findings.filter((finding) => finding.rule.startsWith("boss_bar"))).toEqual([])
  // The same boss with the game's own bar, written or not: the very same files, none of the bar's.
  const none = await barProject("none")
  await none.build()
  const vanilla = await barProject("vanilla")
  await vanilla.build()
  const plainFiles = await javaAndResources(none.source)
  expect(Object.keys(plainFiles).some((name) => name.includes("bossbar") || name.includes("BossBar"))).toBe(false)
  // The two projects differ only in their own random ids; with those put aside the trees are the same.
  const unnamed = (files: Record<string, string>, creature: string) => Object.fromEntries(Object.entries(files).filter(([name]) => !name.includes(creature) && !/[0-9a-f]{8}-[0-9a-f]{4}/.test(name) && !name.endsWith(".java") && !name.endsWith("lang/zh_cn.json") && !name.endsWith("lang/en_us.json")))
  expect(Object.keys(await javaAndResources(vanilla.source)).length).toBe(Object.keys(plainFiles).length)
  expect(unnamed(await javaAndResources(vanilla.source), vanilla.creature)).toEqual(unnamed(plainFiles, none.creature))
}, 180000)

test("a boss whose bar does not fit it is said and not built", async () => {
  const made = await barProject("bar", BossBarDocumentSchema.parse({ ...bronze, names: names.slice(0, 2) }))
  await expect(made.build()).rejects.toThrow("2 个阶段")
  const icon = await barProject("bar", BossBarDocumentSchema.parse({ ...bronze, icons: [{ abilities: ["quake"], image: null, at: null }] }))
  await expect(icon.build()).rejects.toThrow("quake")
  // The reconciliation says the same, as a finding that stops.
  expect(reconcile(icon.project, { animations: { [icon.project.entities[0]!.id]: fightingGolemDesign.animations.map((clip) => clip.name) } }).filter((finding) => finding.rule === "boss_bar_icon").map((finding) => finding.stops)).toEqual([true])
}, 180000)

test("a bar of one's own: the imported pictures go in as they are, the layout reads its own segments and lock places", () => {
  const document = BossBarDocumentSchema.parse({
    kind: "bossbar",
    background: solid(160, 40, [50, 40, 30, 255]),
    fill: "#33aa44",
    drain: "right",
    segments: [{ x: 90, y: 5, width: 60, height: 8, phase: 1 }, { x: 10, y: 5, width: 60, height: 8, phase: 0 }],
    lock: { frames: [solid(6, 6, [200, 200, 0, 255]), solid(6, 6, [100, 100, 0, 255])], ticks: 5, at: [] },
    icons: [{ abilities: ["slam"], image: solid(8, 8, [255, 0, 0, 255]), at: null }],
    names: names.slice(0, 2),
    name_at: { x: 80, y: 24 },
    dots: { x: 80, y: 26, gap: 2, size: 2 },
  })
  const layout = bossBarLayout(document)
  // By stage, whatever order they are written in; the lock between them, on the gap; the icon in a row below the segments.
  expect(layout.segments.map((segment) => segment.x)).toEqual([10, 90])
  expect(layout.lock.at).toEqual([{ x: 77, y: 6 }])
  expect(layout.icons[0]).toMatchObject({ x: 72, y: 17 })
  const compiled = compileBossBars({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", bosses: [{ creature: "creature", bar: { id: "11111111-1111-4111-8111-111111111111", document }, phases: [{ below: 0.5 }], choices: ["slam", "burst"] }] })
  const folder = "src/main/resources/assets/golem_mod/textures/gui/bossbar/bar_11111111111141118111111111111111/"
  expect(Object.keys(compiled.files).filter((name) => name.startsWith(folder)).sort()).toEqual(["background.png", "fill.png", "icon_0.png", "lock_0.png", "lock_1.png"].map((name) => folder + name))
  const json = JSON.parse(String(compiled.files["src/main/resources/assets/golem_mod/studio/bossbar/creature.json"]))
  expect(json).toMatchObject({ drain: "right", lines: [1, 0.5], name_at: { x: 80, y: 24 }, dots: { x: 80, y: 26, gap: 2, size: 2 }, dim: BOSS_BAR_LIMITS.dim })
  // Draining right keeps the right end: half the life of the first stage fills its right half; the second stage is not reached, full.
  const half = drawBossBar(layout, [1, 0.5], { phase: 0, health: 0.75, lit: 0, broke: -1 })
  expect(pixel(half, 65, 8)).toEqual([0x33, 0xaa, 0x44, 255])
  expect(pixel(half, 15, 8)).toEqual([50, 40, 30, 255])
  expect(pixel(half, 100, 8)).toEqual([0x33, 0xaa, 0x44, 255])
})

// ---- the generated Java ----

test.skipIf(!hasTargetJavac(OFFICIAL))("the bar's classes compile against Fabric 1.21.1 (Mojang's names); only the packet and its client side name Fabric, and the mixin is what the facade's Fabric hook is called from", async () => {
  const root = await temporary()
  const packageName = "com.minemods.content_golem_mod"
  const compiled = compileBossBars({ modId: "golem_mod", packageName, bosses: [{ creature: "creature", bar: { id: randomUUID(), document: bronze }, phases: boss.phases, choices: ["slam", "burst"] }] })
  const java = Object.keys(compiled.files).filter((name) => name.endsWith(".java"))
  expect(java.map((name) => name.split("/").slice(-2).join("/")).sort()).toEqual([`client/${BOSS_BAR.client}.java`, `client/${BOSS_BAR.hud}.java`, `entity/${BOSS_BAR.bars}.java`, `entity/${BOSS_BAR.state}.java`, `entity/${BOSS_BAR.sync}.java`, `mixin/${BOSS_BAR.mixin}.java`].sort())
  // The state, the masks and the HUD are the game's alone; the packet and the receiver are Fabric's; the mixin names the game and Mixin.
  for (const name of java) expect([name.split("/").pop(), /import net\.(fabricmc|minecraftforge|neoforged)/.test(String(compiled.files[name]))]).toEqual([name.split("/").pop(), name.endsWith(`${BOSS_BAR.sync}.java`) || name.endsWith(`${BOSS_BAR.client}.java`)])
  expect(Object.keys(compiled.patch).sort()).toEqual(["src/main/resources/fabric.mod.json", "src/main/resources/golem_mod.mixins.json"])
  await Promise.all(
    java.map(async (name) => {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true })
      await writeFile(path.join(root, name), compiled.files[name]!)
    }),
  )
  const result = await targetJavac(OFFICIAL, root)
  expect(result.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(result.code).toBe(0)
  // The facade's Fabric side has no boss bar event: the same mixin, calling StudioClientPlatform.Hooks.bossBar, compiles against it.
  const facade = await temporary()
  const fabric = genTarget("fabric-1.21.1")
  const files = {
    ...fabric.loader.platformFiles({ modId: "golem_mod", packageName, version: fabric.version }),
    [`src/main/java/${packageName.replaceAll(".", "/")}/mixin/${BOSS_BAR.mixin}.java`]: bossBarOverlayMixin(packageName, { draw: "StudioClientPlatform.Hooks.bossBar", shows: null, imports: [`${packageName}.platform.StudioClientPlatform`] }),
    [`src/main/java/${packageName.replaceAll(".", "/")}/client/StudioClient.java`]: `package ${packageName}.client;\n\npublic final class StudioClient {\n    public static void register() {}\n}\n`,
  }
  await Promise.all(
    Object.entries(files).map(async ([name, text]) => {
      await mkdir(path.dirname(path.join(facade, name)), { recursive: true })
      await writeFile(path.join(facade, name), text)
    }),
  )
  const hooked = await targetJavac(OFFICIAL, facade)
  expect(hooked.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(hooked.code).toBe(0)
}, 120000)

test.skipIf(!hasTargetJavac(OFFICIAL))("the whole generated tree of a boss with its own bar compiles", async () => {
  const made = await barProject("bar")
  await made.build()
  const compiled = (await compileTreeFor(OFFICIAL, made.source))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 240000)

test.skipIf(!hasTargetJavac(OFFICIAL))("the HUD's rules are the preview's: the generated filled, lockFrame and litIcons give what the TypeScript gives", async () => {
  const root = await temporary()
  const compiled = compileBossBars({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", bosses: [{ creature: "creature", bar: { id: randomUUID(), document: bronze }, phases: boss.phases, choices: ["slam", "burst"] }] })
  const state = String(compiled.files[`src/main/java/com/minemods/content_golem_mod/entity/${BOSS_BAR.state}.java`])
  const method = (name: string) => new RegExp(`    public static int ${name}\\([\\s\\S]*?\\n    \\}`).exec(state)![0]
  const healths = [1, 0.99, 0.75, 0.6600000262260437, 0.66, 0.5, 0.34, 0.33, 0.2, 0.05, 0.01, 0].map(Math.fround)
  const lines = [1, 0.66, 0.33]
  await writeFile(
    path.join(root, "Rules.java"),
    `public final class Rules {
${method("litIcons")}
${method("filled")}
${method("lockFrame")}
    public static void main(String[] args) {
        StringBuilder out = new StringBuilder();
        double[] lines = {${lines.join(", ")}};
        float[] healths = {${healths.map((value) => `${value}f`).join(", ")}};
        for (int width : new int[] {1, 7, 64, 333}) for (int stage = 0; stage < 3; stage++) for (float health : healths) out.append(filled(width, lines, stage, health)).append(' ');
        out.append('\\n');
        for (int line = 0; line < 3; line++) for (int phase = 0; phase < 4; phase++) for (long elapsed = -1; elapsed < 30; elapsed++) out.append(lockFrame(line, phase, elapsed, 4, 4)).append(' ');
        out.append('\\n');
        int[] masks = {1, 6, 0};
        for (int running = -1; running < 3; running++) for (int step = -1; step < 3; step++) out.append(litIcons(masks, running, step)).append(' ');
        System.out.print(out);
    }
}
`,
  )
  const tool = (name: string) => path.join(process.env.MINEMODS_JDK21!, "bin", process.platform === "win32" ? `${name}.exe` : name)
  const classes = path.join(root, "classes")
  await mkdir(classes)
  expect(Bun.spawnSync([tool("javac"), "-d", classes, path.join(root, "Rules.java")]).exitCode).toBe(0)
  const [filled, frames, lit] = Bun.spawnSync([tool("java"), "-cp", classes, "Rules"]).stdout.toString().trim().split(/\r?\n/).map((row) => row.trim().split(" ").map(Number))
  expect(filled).toEqual([1, 7, 64, 333].flatMap((width) => [0, 1, 2].flatMap((stage) => healths.map((health) => bossBarFilled(width, lines, stage, health)))))
  expect(frames).toEqual([0, 1, 2].flatMap((line) => [0, 1, 2, 3].flatMap((phase) => Array.from({ length: 31 }, (_, index) => bossBarLockFrame(line, phase, index - 1, 4, 4)))))
  expect(lit).toEqual([-1, 0, 1, 2].flatMap((running) => [-1, 0, 1, 2].map((step) => bossBarLit([1, 6, 0], running, step))))
}, 60000)

test("the acceptance check never calls a boss bar a design draft that does not reach the game: it is judged by looking, and goes in with the boss that shows it", () => {
  const review = reviewAsset(sampleProject(), { id: randomUUID(), module: "bossbar", document: bronze, dependencies: [] })
  const said = JSON.stringify(review)
  expect(said).not.toContain("不进游戏")
  expect(said).toContain("血条好不好由看图决定")
})

test("a stage named as the boss is is not said twice above the bar", () => {
  // The UI run of 2026-11-15 showed 「石像 · 石像」: the AI named the stage after the boss.
  const compiled = compileBossBars({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", bosses: [{ creature: "creature", bar: { id: randomUUID(), document: bronze }, phases: boss.phases, choices: ["slam", "burst"] }] })
  const java = Object.values(compiled.files).map(String).join("\n")
  expect(java).toContain("boolean twice = name.getString().equals(title.getString());")
  expect(java).toContain("layout.nameAt == null && !twice ? title.copy().append(Component.literal(\" · \")).append(name) : title")
})
