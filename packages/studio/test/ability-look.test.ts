import { afterEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { MakingRefusal } from "@minemods/mod-core/making"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { lookJob } from "../src/main/look-job"
import { describeAsset, wornAbilities } from "../src/renderer/features/asset-words"
import { createDataGameplaySample, fightingGolemDesign } from "../../mod-core/script/data-gameplay-sample"
import { posedCorners, type MotionClip } from "@minemods/studio-ai/model-motion"
import { trailTip } from "@minemods/mod-core/ability-trails"
import { ParticleDocumentSchema, particleAt } from "@minemods/mod-core/particle"
import { encodePng } from "@minemods/mod-core/png"
import { decodeRgbaPng } from "@minemods/mod-core/png-decode"
import { expandedMoves } from "@minemods/mod-core/ability-asset"
import { createTargetScaleSample } from "../../mod-core/script/target-scale-sample"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

/** The sample whose golem fights with two abilities, and its creature and model documents. */
async function fighting() {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-abilities-"))
  directories.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"), { life: true, abilities: true })
  const of = <Kind extends ModuleDocument["kind"]>(kind: Kind) => project.workspace.assets.flatMap((asset) => (asset.document.kind === kind ? [{ id: asset.id, document: asset.document as Extract<ModuleDocument, { kind: Kind }> }] : []))[0]!
  return { project, creature: of("entity"), model: of("model") }
}
const words = (run: () => unknown) => {
  try {
    run()
    return ""
  } catch (error) {
    return error instanceof MakingRefusal ? error.message : String(error)
  }
}

test("a look at a creature draws every hit moment of its abilities on its model, with the hit shape and what was measured", async () => {
  const { creature, model } = await fighting()
  const made = lookJob(creature.document, model.document)
  expect(made.job.sheets.map((sheet) => sheet.label)).toEqual(["招式「重锤」· 出手的那一刻（红色是判定范围）", "招式「晶刺喷射」· 2 次出手（红色是判定范围）"])
  expect(made.job.sheets.some(s=>s.cells.some(c=>c.kind==="hit" && c.light && c.particles?.length))).toBe(true)
  const cells = made.job.sheets.flatMap((sheet) => sheet.cells.flatMap((cell) => (cell.kind === "hit" && !cell.light ? [cell] : [])))
  expect(cells.map((cell) => [cell.animation, cell.time, cell.view])).toEqual([
    ["slam", 0.7, "plus_x"], ["slam", 0.7, "top"], ["slam", 0.7, "quarter"],
    // Round 10: the second thrust gives up its side view so that the end of the wind-up has a frame of its own on the same sheet.
    ["burst", 1, "plus_x"], ["burst", 1, "top"], ["burst", 1, "quarter"], ["burst", 1.3, "top"], ["burst", 1.3, "quarter"],
  ])
  const burst = creature.document.abilities![1]!
  const plain = made.job.sheets.map((sheet) => sheet.cells.flatMap((cell) => (cell.kind === "view" ? [cell] : [])))
  // The room left on a sheet shows the motion without the shape: where the wind-up ends when no hit is counted right then, and the moments that differ most.
  expect(plain[1]!.map((cell) => [cell.animation, cell.time, cell.label])).toEqual([["burst", burst.windup, `斜前方 · 蓄力结束 ${burst.windup} 秒`]])
  expect(plain[0]!.length).toBe(3)
  expect(plain[0]!.every((cell) => cell.animation === "slam" && cell.view === "quarter" && Math.abs(cell.time! - 0.7) >= 0.05)).toBe(true)
  expect(made.job.sheets.every((sheet) => sheet.cells.filter(c=>c.kind!=="hit" || !c.light).length <= 6)).toBe(true)
  expect(cells.every((cell) => cell.faces.length > 0 && cell.faces.every((face) => face.length >= 3))).toBe(true)
  // What was measured is written under the last view of each hit, and said with the pictures.
  expect(cells[2]!.caption.join("")).toContain("动作朝判定范围挥过去的那一下在第 0.7 秒到位，和判定的时刻对得上")
  expect(cells[0]!.caption).toEqual([])
  expect(made.notes.join("\n")).toContain("招式「晶刺喷射」：目标在 4–10 格、看得见的时候会用")
  expect(made.notes.join("\n")).not.toContain("对不上")
  // The damage written long before the arms come down is said, on the picture and in the notes.
  const slam = creature.document.abilities![0]!
  const early = lookJob({ ...creature.document, abilities: [{ ...slam, windup: 0.1, hits: [{ ...slam.hits[0]!, at: 0.3 }] }] }, model.document)
  expect(early.notes.find((note) => note.startsWith("对不上"))).toContain("在第 0.7 秒才到位，伤害却在第 0.3 秒就算了，动作晚了 0.4 秒")
  // Nothing to look at without abilities, without a model, or without the motions the abilities name.
  expect(words(() => lookJob({ ...creature.document, abilities: null }, model.document))).toBe("这一类内容没有可以看的样子，不需要看图。")
  expect(words(() => lookJob(creature.document, null))).toContain("这只生物还没有模型")
  expect(words(() => lookJob({ ...creature.document, abilities: [{ ...slam, clip: "smash" }] }, model.document))).toContain("模型里没有这些招式要播的动作：smash")
})

test("the creature card says each ability and what starts every motion, with the code's names kept for 高级", async () => {
  const { project, creature } = await fighting()
  const card = describeAsset(project, { id: creature.id, asset_id: creature.id, kind: "entity", preview: { source: "asset" } }, (reference) => reference)
  const row = (label: string) => card.rows.find((value) => value.label === label)!
  expect(row("打人").text).toBe("用招式打（下面 2 个），不再一碰就掉血")
  expect(row("招式「重锤」").text.split("\n")).toEqual([
    // Broad19: which motion of the model the ability plays, first, so it can be found among the motions.
    "播的动作：「重锤」的动作",
    "目标在 0–2.8 格、看得见的时候会用",
    "先蓄力 0.5 秒（一直转向目标）",
    "第 0.7 秒打身前 120° 以内 2.5 格里的所有生物：掉 9 点血、被打退、变慢 2 秒（那一刻不在范围里就打不中）",
    "全程 1.2 秒，之后歇 2.5 秒",
    "挨打也不会停",
    "第 0.7 秒「铁傀儡挥臂」的声音、尘土每把 12 颗，从脚下冒，前后偏移 1.2 格，上下偏移 0.1 格，第 0.7 秒开始，前后、上下、左右半径 0.6、0.6、0.6 格",
  ])
  expect(row("招式「重锤」").detail).toBe("id slam · clip slam · wind-up to tick 10 · hits at tick 14 · ends at tick 24 · cooldown 50 ticks · weight 3")
  expect(row("动作去向").text).toContain("动作 挥动：没有任何地方会播放它")
  expect(row("动作去向").text).toContain("动作 「晶刺喷射」的动作：招式「晶刺喷射」开始时从头播")
  expect(row("动作去向").detail!.split("\n")).toEqual(expect.arrayContaining(['idle ← controller "movement"', "wave ← nothing", "slam ← ability slam: wind-up to tick 10, hits at tick 14, ends at tick 24", "roar ← logic rule: hurt → play_animation roar"]))
  // ...and the other way round: the model's own card names each motion an ability plays with that ability.
  const worn = project.workspace.assets.find((asset) => asset.id === (creature.document as { model_asset_id: string }).model_asset_id)!
  const motions = describeAsset(project, { id: worn.id, asset_id: worn.id, kind: "model", preview: { source: "asset" } }, (reference) => reference).rows.find((value) => value.label === "会的动作")!.text
  expect(motions).toContain("招式：重锤")
  expect(motions).not.toContain("slam")
  expect(motions).toContain("招式：晶刺喷射")
  expect(motions).not.toContain("burst")
  expect(motions).toContain("挥动")
  expect(motions).not.toContain("wave")
  // The model preview's buttons and motion list read the same abilities, each once, and a creature that does not fight uses none.
  expect(wornAbilities(project, worn.id).map((ability) => ability.name)).toEqual(["重锤", "晶刺喷射"])
  expect(wornAbilities(project, null)).toEqual([])
  const preview = readFileSync(path.join(import.meta.dir, "../src/renderer/features/asset-preview.tsx"), "utf8")
  expect(preview).toContain("motionName()(value.name, advanced())")
  expect(readFileSync(path.join(import.meta.dir, "../src/renderer/features/model-canvas.tsx"), "utf8")).toContain("(props.motionName ?? motionTitle)(item.name, !!props.rawNames)")
  // The sample's burst hits with the same beam at 1.0 and 1.3 seconds: the second comes inside the game's half second of hurt (epic game1), and the card says so.
  expect(card.notes).toEqual([expect.stringContaining("有 1 下离上一下不到 0.5 秒（第 1.3 秒）")])
  // A creature without abilities reads as it did.
  const before = describeAsset({ ...project, workspace: { assets: project.workspace.assets.map((asset) => (asset.document.kind === "entity" ? { ...asset, document: { ...asset.document, abilities: null } } : asset)) } }, { id: creature.id, asset_id: creature.id, kind: "entity", preview: { source: "asset" } }, (reference) => reference)
  expect(before.rows.find((value) => value.label === "打人")!.text).toBe("打一下掉 6 点血（3 颗心）")
  expect(before.rows.some((value) => value.label.startsWith("招式"))).toBe(false)
})

test("Boss 能力 3: a hit put down at the target's feet with a warning is drawn at that place with the one it fights, and the warning's moment and delay are on the sheet", async () => {
  const { creature, model } = await fighting()
  const slam = creature.document.abilities![0]!
  const quake = {
    ...slam,
    id: "quake",
    name: "地裂",
    start: { ...slam.start, min_distance: 4, max_distance: 12 },
    hits: [{ type: "area" as const, at: 1, shape: { type: "sphere" as const, forward: 0, up: 0, left: 0, radius: 2.5 }, hits: "everyone" as const, damage: 6, knockback: 0.6, effects: [], place: "target" as const, warn: { seconds: 0.8, look: "ring" as const, color: "red" as const } }],
    events: [],
  }
  const made = lookJob({ ...creature.document, abilities: [quake] }, model.document)
  const sheet = made.job.sheets[0]!
  expect(sheet.cells.length).toBeLessThanOrEqual(6)
  const hits = sheet.cells.flatMap((cell) => (cell.kind === "hit" ? [cell] : []))
  // The views of the hit, then one from above at the moment the warning appears.
  // r29: this warning writes no paint, so the game draws it in its own coloured dust: the picture says so and draws dots, not a surface.
  expect(hits.at(-1)!.label).toBe("从上往下 · 预警出现 0.2 秒（0.8 秒后在这里判定）（原版彩尘）")
  expect(hits.at(-1)!.time).toBe(0.2)
  expect(hits.slice(0, -1).every((cell) => cell.time === 1 && cell.label.endsWith("（预警提前 0.8 秒）"))).toBe(true)
  // The hit's own ball at the target's feet 8 blocks ahead (-Z, 16 pixels a block), and a box a player's size there: what the warning is drawn as, in the game, too.
  expect(hits[0]!.faces.length).toBe(3 + 6)
  expect(Math.min(...hits[0]!.faces[0]!.map((point) => point[2]))).toBeCloseTo(-(8 + 2.5) * 16, 3)
  expect(hits.at(-1)!.faces).toEqual([])
  expect(hits.at(-1)!.particles?.[0]?.name).toBe("预警彩尘")
  expect(hits.at(-2)!.caption.join("")).toContain("打在目标脚下")
  expect(made.notes.join("\n")).toContain("预警：从第 0.2 秒起（比判定早 0.8 秒），落点上画出红色的地上画出范围的一圈")
})

test("Boss 能力 2: a thrown thing is drawn as its whole flight, dashed, with where it lands, how long it sticks and its way back; a volley from the sky at every place", async () => {
  const { creature, model } = await fighting()
  const slam = creature.document.abilities![0]!
  const throwing = {
    ...slam,
    id: "hurl",
    name: "掷拳",
    start: { ...slam.start, min_distance: 4, max_distance: 12, cooldown: 9 },
    hits: [{ type: "projectile" as const, at: 0.7, look: { bone: "arm_right" }, from: { bone: "arm_right" }, speed: 1, gravity: 0.05, path: "arc" as const, damage: 8, knockback: 0.5, effects: [], radius: 1.5, pin_seconds: 5, comes_back: { at: 0.7 } }],
    events: [],
  }
  const made = lookJob({ ...creature.document, abilities: [throwing] }, model.document)
  const hits = made.job.sheets[0]!.cells.flatMap((cell) => (cell.kind === "hit" ? [cell] : []))
  expect(hits.length).toBeGreaterThan(0)
  for (const cell of hits) {
    // The way out in red, the way back in blue, both dashed; the ring where it lands and the target's box are among the faces.
    expect(cell.trails!.map((trail) => [trail.color, trail.dashed])).toEqual([["#ff5533", true], ["#33aaff", true]])
    expect(cell.trails![0]!.points.at(-1)![2]).toBeCloseTo(-8 * 16, 3)
  }
  const said = hits.at(-1)!.caption.join("")
  expect(said).toContain("插在地上 5 秒")
  expect(said).toContain("回到它手里")
  // From the sky: twelve flights, twelve rings, no ball at its feet.
  const rain = { ...throwing, id: "rain", hits: [{ ...throwing.hits[0]!, look: { effect: "b2b2b2b2-0000-4000-8000-000000000002" }, from: { sky: { over: { type: "around_target" as const, count: 12, spread: 6 }, height: 16 } }, path: "straight" as const, comes_back: undefined, pin_seconds: 2, warn: { seconds: 0.5, look: "ring" as const, color: "red" as const } }] }
  const volley = lookJob({ ...creature.document, abilities: [rain] }, model.document).job.sheets[0]!.cells.flatMap((cell) => (cell.kind === "hit" ? [cell] : []))
  expect(volley[0]!.trails).toHaveLength(12)
  expect(volley[0]!.faces).toHaveLength(12)
  expect(volley.at(-1)!.caption.join("")).toContain("预警：从第 0.2 秒起")
})

test("a combo is drawn as one sheet: its steps' hits one after another on the combo's own clock, with the timeline in the notes", async () => {
  const { project, creature, model } = await fighting()
  const combo = { id: "crush", name: "碎岩连击", steps: ["slam", "burst"], gap_ticks: 4, damage_scale: 1.2, start: { min_distance: 0, max_distance: 2.8, line_of_sight: true, cooldown: 8, weight: 2 } }
  const document = { ...creature.document, combos: [combo] }
  const made = lookJob(document, model.document)
  // The abilities' own sheets as they were, then the combo's.
  expect(made.job.sheets.map((sheet) => sheet.label)).toEqual([
    "招式「重锤」· 出手的那一刻（红色是判定范围）",
    "招式「晶刺喷射」· 2 次出手（红色是判定范围）",
    "连招「碎岩连击」· 依次出「重锤」→「晶刺喷射」，按出手先后排（时间从连招开始算，红色是判定范围或东西射出去的位置）",
  ])
  // slam is 24 ticks; burst starts 24 + 1 + 4 = 29 ticks in (1.45 s), and lands at its own 1 s and 1.3 s.
  const cells = made.job.sheets[2]!.cells.flatMap((cell) => (cell.kind === "hit" ? [cell] : []))
  expect(cells.map((cell) => [cell.animation, cell.time, cell.label])).toEqual([
    ["slam", 0.7, "第 1 步「重锤」· 连招第 0.7 秒（这一招的 0.7 秒判定）"],
    ["burst", 1, "第 2 步「晶刺喷射」· 连招第 2.45 秒（这一招的 1 秒判定）"],
    ["burst", 1.3, "第 2 步「晶刺喷射」· 连招第 2.75 秒（这一招的 1.3 秒判定）"],
  ])
  expect(cells.every((cell) => cell.faces.length > 0)).toBe(true)
  const notes = made.notes.join("\n")
  expect(notes).toContain("连招「碎岩连击」：目标在 0–2.8 格、看得见的时候会用；依次出「重锤」→「晶刺喷射」")
  expect(notes).toContain("连招「碎岩连击」的时间轴：连招第 0 秒起「重锤」")
  // Its first step is made for 0–2.8 blocks, so starting from there is fine; from up to 10 blocks it is said.
  expect(notes).not.toContain("第一下多半打空")
  expect(lookJob({ ...document, combos: [{ ...combo, start: { ...combo.start, max_distance: 10 } }] }, model.document).notes.join("\n")).toContain("第一下多半打空")
  // One combo alone, by its id; a name it has neither as an ability nor as a combo is refused with both lists.
  expect(lookJob(document, model.document, { animation: "crush" }).job.sheets.map((sheet) => sheet.label)).toEqual([made.job.sheets[2]!.label])
  expect(words(() => lookJob(document, model.document, { animation: "nothing" }))).toBe("这只生物没有叫「nothing」的招式或连招。它有：slam、burst、crush。")
  // The card has a row for it, with the same words.
  const card = describeAsset({ ...project, workspace: { assets: project.workspace.assets.map((asset) => (asset.id === creature.id ? { ...asset, document } : asset)) } }, { id: creature.id, asset_id: creature.id, kind: "entity", preview: { source: "asset" } }, (reference) => reference)
  expect(card.rows.find((value) => value.label === "连招「碎岩连击」")!.text).toContain("两招之间停 0.2 秒（4 刻）")
})

test("Boss 能力 11: a weapon trail is drawn on the ability's sheet as the curve its part's far end sweeps between its start and its end, in its own colour", async () => {
  const { creature, model } = await fighting()
  const slam = creature.document.abilities![0]!
  const swing = { ...slam, events: [...slam.events, { type: "trail" as const, at: 0.5, until: 0.75, bone: "arm_right", color: "#66ccff", width: 0.4, fade_ticks: 6 }] }
  const made = lookJob({ ...creature.document, abilities: [swing] }, model.document)
  const sheet = made.job.sheets[0]!
  expect(sheet.cells.filter(c=>c.kind!=="hit" || !c.light).length).toBeLessThanOrEqual(6)
  const drawn = sheet.cells.flatMap((cell) => (cell.kind === "hit" && cell.trails ? [cell] : []))
  expect(drawn).toHaveLength(1)
  const cell = drawn[0]!
  expect(cell.label).toBe("它的左侧 · 拖尾「arm_right」0.5 秒–0.75 秒（#66ccff）")
  expect(cell.time).toBe(0.75)
  expect(cell.faces).toEqual([])
  // One point a tick from tick 10 to tick 15: the far corner of the hand (`trailTip`) where the slam's own motion holds it then.
  const design = (({ kind: _kind, ...rest }) => rest)(model.document)
  const tip = trailTip(design, "arm_right")!
  const clip = design.animations.find((animation) => animation.name === "slam") as MotionClip
  expect(cell.trails![0]!.color).toBe("#66ccff")
  expect(cell.trails![0]!.points).toEqual([10, 11, 12, 13, 14, 15].map((tick) => posedCorners(design, clip, tick / 20)[tip.index]!))
  expect(cell.caption[0]).toMatch(/^末端扫过 [\d.]+ 格$/)
  expect(made.notes.join("\n")).toContain("招式「重锤」的拖尾：第 0.5–0.75 秒「arm_right」末端拖出 #66ccff 的光带")
  // Without a trail the sheet is what it always was.
  const before = lookJob(creature.document, model.document).job.sheets[0]!
  expect(before.cells.some((value) => value.kind === "hit" && value.trails)).toBe(false)
  // A trail too short to see is said with the pictures.
  const short = lookJob({ ...creature.document, abilities: [{ ...swing, events: [...slam.events, { ...(swing.events.at(-1) as Extract<(typeof swing.events)[number], { type: "trail" }>), until: 0.55 }] }] }, model.document)
  expect(short.notes.join("\n")).toContain("看起来只是一个点")
})

test("Boss 能力 11: a particle's look shows every picture enlarged and its life drawn by the numbers of its document, with every parameter said", () => {
  const side = 8
  const pixels = new Uint8Array(side * side * 4).fill(255)
  const frame = `data:image/png;base64,${Buffer.from(encodePng(pixels, side, side)).toString("base64")}`
  const ember = ParticleDocumentSchema.parse({ kind: "particle", name: "ember", frames: [frame, frame], frames_by: "age", lifetime: 1, gravity: -0.2, size: { start: 0.4, end: 0.1 }, color: { start: "#ffffff", end: "#ff0000" }, opacity: { start: 1, end: 0.5 }, emissive: true, spin: 0 })
  const made = lookJob(ember, null)
  expect(made.job.sheets.map((sheet) => sheet.label)).toEqual(["粒子「ember」的 2 张图", "粒子「ember」一生中的 6 个时刻（按文档的数算出来的大小、颜色、透明度和转角；最大时占满八成画面，黑底：它自己发光）","ember · 标准场景（人高 1.8 格，12 颗）"])
  expect(made.job.sheets[2]!.cells).toHaveLength(14)
  expect(made.job.sheets[2]!.cells.map(c=>c.label)).toContain("成片 · 40 团叠放 · 白天")
  expect(made.job.sheets[0]!.cells.map((cell) => cell.kind)).toEqual(["tiles", "tiles"])
  const life = made.job.sheets[1]!.cells.flatMap((cell) => (cell.kind === "flat" ? [cell] : []))
  expect(life.map((cell) => cell.label)).toEqual(["第 0 刻（0 秒）· 0.4 格见方 · 不透明 1 · 第 1 张图", "第 4 刻（0.2 秒）· 0.34 格见方 · 不透明 0.9 · 第 1 张图", "第 8 刻（0.4 秒）· 0.28 格见方 · 不透明 0.8 · 第 1 张图", "第 12 刻（0.6 秒）· 0.22 格见方 · 不透明 0.7 · 第 1 张图", "第 16 刻（0.8 秒）· 0.16 格见方 · 不透明 0.6 · 第 1 张图", "第 19 刻（0.95 秒）· 0.11 格见方 · 不透明 0.53 · 第 1 张图"])
  // The middle of the first moment is the picture's white at full size; the last is redder, smaller and see-through over the dark ground.
  const read = (url: string) => decodeRgbaPng(Buffer.from(url.split(",")[1]!, "base64"), { side: 512 })
  const first = read(life[0]!.url)
  const centre = (first.width / 2) * first.width * 4 + (first.width / 2) * 4
  expect([...first.pixels.subarray(centre, centre + 3)]).toEqual([255, 255, 255])
  const last = read(life.at(-1)!.url)
  const now = particleAt(ember, 19)
  expect(last.pixels[centre]).toBe(Math.round(24 + (255 * now.color[0] - 24) * now.opacity))
  expect(last.pixels[centre + 1]).toBe(Math.round(24 + (255 * now.color[1] - 24) * now.opacity))
  // Outside its square at that size: only the ground.
  expect([...last.pixels.subarray(0, 3)]).toEqual([24, 24, 30])
  expect(made.notes.join("\n")).toContain("寿命：1 秒（20 刻）。")
  expect(made.notes.join("\n")).toContain("自己发光")
})

test("Boss 能力 4: a dash is drawn as an arrow as long as it goes with the band its hit sweeps, a force as arrows over where it lands, each said in the label and under it", async () => {
  const { creature, model } = await fighting()
  const slam = creature.document.abilities![0]!
  const ram = {
    ...slam,
    id: "ram",
    name: "铁额撞",
    clip: "burst",
    windup: 0.4,
    length: 1.6,
    hits: [{ type: "area" as const, at: 0.4, shape: { type: "box" as const, forward: 1, up: 1, left: 0, width: 2, height: 2.5, depth: 2 }, hits: "everyone" as const, damage: 6, knockback: 0.5, effects: [] }],
    moves: [{ type: "dash" as const, from: 0.4, to: 1.4, speed: 20, distance: 20, aim: "locked_at_windup" as const, stop_at_wall: true, hit: 0 }],
    start: { ...slam.start, min_distance: 4, max_distance: 20 },
    events: [],
  }
  const gale = { ...slam, id: "gale", name: "起风", hits: [{ type: "area" as const, at: 0.7, shape: { type: "arc" as const, reach: 6, angle: 360, low: -1, high: 3 }, hits: "everyone" as const, damage: 0, knockback: 0, effects: [], force: { kind: "side" as const, strength: 5, seconds: 3 } }], events: [] }
  const made = lookJob({ ...creature.document, abilities: [ram, gale] }, model.document)
  // r29c: the moments without a hit of an ability that carries the creature are hit cells too (with no shape), so it can be drawn where it is then: only those with a shape are the hits.
  const [dash, blown] = made.job.sheets.map((sheet) => sheet.cells.flatMap((cell) => (cell.kind === "hit" && cell.faces.length ? [cell] : [])))
  expect(dash!.every((cell) => cell.label.endsWith("（冲刺 20 格）"))).toBe(true)
  // From above the whole of it: the band and the arrow reach 20 blocks ahead and past it by the box (-Z, 16 pixels a block), and the camera holds it.
  const top = dash!.find((cell) => cell.view === "top")!
  expect(Math.min(...top.faces.flat().map((point) => point[2]))).toBeCloseTo(-(20 + 2) * 16, 3)
  expect(top.camera.target[2]).toBeLessThan(-8 * 16)
  expect(dash!.at(-1)!.caption.join("")).toContain("图上地上的箭头就是它冲的方向和长度（20 格）")
  expect(blown!.every((cell) => cell.label.endsWith("（推 3 秒）"))).toBe(true)
  expect(blown!.at(-1)!.caption.join("")).toContain("之后 3 秒把打中的往它自己的左边推（目标速度每秒 5 格，实际位移受阻力、碰撞和移动影响）")
})

test("Boss 能力 14: an ability a blow starts gets a time line from the blow on — the parry, the counter, its wait and the disarm — and its numbers in the notes", async () => {
  const { creature, model } = await fighting()
  const slam = creature.document.abilities![0]!
  const parry = {
    ...slam,
    id: "disarm",
    name: "夺兵",
    windup: 0.3,
    length: 1,
    hits: [{ type: "area" as const, at: 0.6, shape: { type: "arc" as const, reach: 4, angle: 120, low: -0.5, high: 3 }, hits: "target" as const, damage: 16, knockback: 1, effects: [] }],
    start: { ...slam.start, min_distance: 0, max_distance: 5, cooldown: 0 },
    events: [],
    on_hurt: { chance: 0.15, cooldown: 8, by: "melee" as const, block: true, disarm: { seconds: 3 } },
  }
  const made = lookJob({ ...creature.document, abilities: [parry, slam] }, model.document)
  const sheet = made.job.sheets.find((value) => value.label.startsWith("招式「夺兵」· 被打中以后"))!
  expect(sheet.label).toBe("招式「夺兵」· 被打中以后：触发 → 架住 → 反击，以及缴械的时间")
  const [cell] = sheet.cells
  expect(cell!.kind).toBe("flat")
  expect(cell!.label).toContain("橙条是出手的玩家缴械的时间；横轴 0–9 秒")
  const picture = decodeRgbaPng(Buffer.from((cell as { url: string }).url.split(",")[1]!, "base64"))
  expect([picture.width, picture.height]).toEqual([480, 180])
  // The ordinary sheets of both abilities come first, the time line after them.
  expect(made.job.sheets.indexOf(sheet)).toBe(2)
  const notes = made.notes.join("\n")
  expect(notes).toContain("招式「夺兵」：被近战打中（出手的人离它 0–5 格")
  expect(notes).toContain("第 0.6 秒出手反击，第 1 秒收招；歇到第 9 秒才会再被打出来。")
  expect(notes).toContain("出手的玩家从第 0 秒缴械到第 3 秒")
  expect(notes).toContain("他的近战大约有 72.5% 能打上去")
  // An ability chosen by distance has none.
  expect(lookJob(creature.document, model.document).job.sheets.some((value) => value.label.includes("被打中以后"))).toBe(false)
})

test("第 4 步: a thrown thing that bursts is drawn with a star where it lands; ground hazards, cracks, shockwaves and beams get a sheet of their own, each in its colour", async () => {
  const { creature, model } = await fighting()
  const slam = creature.document.abilities![0]!
  const spike = "b2b2b2b2-0000-4000-8000-000000000002"
  // 落地炸开: twelve landings, a star of four strokes at each, and a void pool's circles; said under the cell.
  const rain = {
    ...slam,
    id: "rain",
    name: "兵器雨",
    start: { ...slam.start, min_distance: 0, max_distance: 12 },
    hits: [{ type: "projectile" as const, at: 0.7, look: { effect: spike }, from: { sky: { over: { type: "around_target" as const, count: 12, spread: 6 }, height: 16 } }, speed: 0.5, gravity: 0.06, path: "straight" as const, damage: 5, knockback: 0.3, effects: [], radius: 1.5, warn: { seconds: 0.5, look: "ring" as const, color: "red" as const }, impact: { particle: "explosion" as const, count: 24, spread: 3, ground: [{ type: "hazard" as const, radius: 2, seconds: 4, color: "#7a2cff", glow: true, damage: 1, hits: "everyone" as const, effects: [], every_ticks: 20 }] } }],
    events: [],
  }
  const volley = lookJob({ ...creature.document, abilities: [rain] }, model.document).job.sheets[0]!.cells.flatMap((cell) => (cell.kind === "hit" ? [cell] : []))
  const stars = volley[0]!.trails!.filter((trail) => trail.color === "#ffcc22")
  expect(stars).toHaveLength(12 * 4)
  expect(volley[0]!.trails!.some((trail) => trail.color === "#7a2cff")).toBe(true)
  expect(volley.at(-1)!.caption.join("")).toContain("在落点炸开（图上每个落点画成金色的星，留在地上的画成它的范围）")
  // Without impact the cell is what it was: only the flights.
  const plain = lookJob({ ...creature.document, abilities: [{ ...rain, hits: [{ ...rain.hits[0]!, impact: undefined }] }] }, model.document).job.sheets[0]!.cells.flatMap((cell) => (cell.kind === "hit" ? [cell] : []))
  expect(plain[0]!.trails).toHaveLength(12)
  // Ground effects and a beam: a sheet of their own, one cell each from above, in their colours, said under them.
  const scorch = {
    ...slam,
    id: "scorch",
    name: "焚地",
    events: [
      { type: "hazard" as const, at: 0.7, where: "self" as const, hit: null, forward: 1.5, left: 0, radius: 3, seconds: 5, color: "#ff5a1a", glow: true, damage: 2, hits: "everyone" as const, effects: [], every_ticks: 10 },
      { type: "crack" as const, at: 0.7, where: "target" as const, hit: null, forward: 0, left: 0, radius: 4, seconds: 6, grow_seconds: 0.5, color: "#ff7a2a", glow: true },
      { type: "shockwave" as const, at: 0.7, where: "hit" as const, hit: 0, forward: 0, left: 0, from_radius: 0.5, to_radius: 10, seconds: 1.2, width: 1.5, height: 1, color: "#ffb040", glow: true, damage: 0, knockback: 0, hits: "everyone" as const, effects: [] },
      { type: "beam" as const, at: 0.7, until: 1, bone: "head", forward: 0, up: 0, left: 0, aim: "target" as const, turn: 3, length: 20, width: 0.5, color: "#ff3010", damage: 0, hits: "target" as const, effects: [], every_ticks: 5 },
    ],
  }
  const sheets = lookJob({ ...creature.document, abilities: [scorch] }, model.document).job.sheets
  const ground = sheets.find((sheet) => sheet.label.includes("地面效果和光束"))!
  expect(ground.cells.map((cell) => cell.label)).toEqual(["从上往下 · 地面危险区 0.7 秒", "从上往下 · 地裂 0.7 秒", "从上往下 · 冲击波环 0.7 秒", "从上往下 · 光束 0.7–1 秒"])
  const colours = ground.cells.map((cell) => (cell.kind === "hit" ? [...new Set(cell.trails!.map((trail) => trail.color))] : []))
  expect(colours).toEqual([["#ff5a1a"], ["#ff7a2a"], ["#ffb040"], ["#ff3010"]])
  expect(ground.cells.every((cell) => cell.kind === "hit" && cell.view === "top" && cell.caption.length === 2)).toBe(true)
  expect(sheets.filter((sheet) => sheet.label.includes("地面效果和光束"))).toHaveLength(1)
  expect(lookJob(creature.document, model.document).job.sheets.some((sheet) => sheet.label.includes("地面效果"))).toBe(false)
})

test("r29c: a shared ability played at half the size is drawn at half the size: its hit box, its dash and its shockwave", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-scale-look-"))
  directories.push(root)
  const project = await createTargetScaleSample(path.join(root, "project"), "forge-1.20.1")
  const drawn = (index: number) => {
    const entity = project.entities[index]!
    const model = { kind: "model", ...fightingGolemDesign } as Extract<ModuleDocument, { kind: "model" }>
    return lookJob({ kind: "entity", ...entity, abilities: expandedMoves(entity, project.workspace) } as Extract<ModuleDocument, { kind: "entity" }>, model).job.sheets
  }
  const span = (points: readonly (readonly number[])[], axis: number) => Math.max(...points.map((point) => point[axis]!)) - Math.min(...points.map((point) => point[axis]!))
  const hitWidth = (sheets: ReturnType<typeof drawn>) => span(sheets.flatMap((sheet) => sheet.cells).filter((cell) => cell.kind === "hit" && cell.view === "top" && cell.label.includes("判定 0.4 秒（整个范围）")).flatMap((cell) => (cell.kind === "hit" ? cell.faces.flat() : [])), 0)
  const [big, small] = [drawn(0), drawn(1)]
  // The box is 4 blocks wide on the brute and 2 on the cub, across the way it charges.
  expect(hitWidth(big)).toBeCloseTo(4 * 16, 0)
  expect(hitWidth(small)).toBeCloseTo(2 * 16, 0)
  expect(small[0]!.cells[1]!.label).toBe("从上往下 · 判定 0.4 秒（整个范围）（黄框：这一刻它在这里）（冲刺 6 格）")
  expect(big[0]!.cells[1]!.label).toBe("从上往下 · 判定 0.4 秒（整个范围）（黄框：这一刻它在这里）（冲刺 12 格）")
  // The shockwave's ring, drawn from above: as far across as its last radius and half its width out, both halved.
  const ring = (sheets: ReturnType<typeof drawn>) => span(sheets.flatMap((sheet) => sheet.cells).filter((cell) => cell.kind === "hit" && cell.label.includes("冲击波环")).flatMap((cell) => (cell.kind === "hit" ? (cell.trails ?? []).flatMap((trail) => trail.points) : [])), 0)
  expect(ring(small) / ring(big)).toBeCloseTo(0.5, 2)
})

test("温顺生物只有稳重也能看图，图中标注身体转速和可绕过的距离", async () => {
  const { creature, model } = await fighting()
  const viewed = lookJob({ ...creature.document, behavior: "passive", boss: null, abilities: [], steady: { preset: "colossal" } }, model.document)
  expect(viewed.job.sheets.some(sheet => sheet.label === "稳重俯视图")).toBe(true)
  expect(viewed.notes.join(" ")).toContain("身体转半圈要 3 秒")
})
