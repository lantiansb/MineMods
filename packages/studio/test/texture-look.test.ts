import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import { createRequire } from "node:module"
import path from "node:path"
import { archivedMakings, comparedName, copyFinding, MakingRecordSchema, NO_WORLD_WORDS, OUTSIDE_REVIEW_RULE, OUTSIDE_WORDS, readMaking, REFUSALS, TEXTURE_SEEN, textureNote, WORLD_SHEET_NAME } from "@minemods/mod-core/making"
import { worldSource } from "@minemods/mod-core/making-world"
import { ASSET_STANDARDS } from "@minemods/mod-core/acceptance"
import { createProject, openProject } from "@minemods/mod-core/project"
import { decodeRgbaPng } from "@minemods/mod-core/png-decode"
import { runDrawing } from "@minemods/mod-core/script-run"
import { getModuleSchema } from "@minemods/mod-core/workspace"
import { DRAWN_SUMMARY } from "@minemods/studio-ai/script"
import { createProjectRunner } from "../src/main/project-runner"
import { besidePicture } from "../src/main/making-loop"
import { BLIND_SHEET, lookJob, lookQueue, reviewJob, type LookJob, type LookRenderer } from "../src/main/look-job"
import { BUDGET_REFUSALS, GEOMETRY_TIERS } from "@minemods/studio-ai/budget"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import slime from "../../studio-ai/test/fixtures/look/good/sprout-slime.json"
import { DRAWN_ANSWER_INSTRUCTIONS, DRAWN_NEEDS_DOCUMENT, drawnInto, scriptedAnswerSchema, settled } from "../src/main/script-door"

// Studio does not depend on fflate; mod-core does, so it is reached through mod-core (as the import tests do).
const { zipSync } = createRequire(path.join(import.meta.dir, "../../mod-core/package.json"))("fflate") as {
  zipSync: (files: Record<string, Uint8Array>) => Uint8Array
}

const directories: string[] = []
const closers: (() => unknown)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

// Every picture here is drawn by a few lines of arithmetic; the jar below only borrows the game's file names.
const patches = (seed: number, colours: string[]) => `const c = api.canvas(16, 16, "${colours[0]}")\nc.noise(0, 0, 16, 16, ${JSON.stringify(colours)}, { seed: ${seed}, cell: 3 })\nreturn c`
const GREYS = ["#686868", "#747474", "#7f7f7f", "#8f8f8f"]
const DEEP = ["#34343a", "#3f3f46", "#4a4a52", "#55555e"]
// Muted, every one: nothing in this made-up game is as vivid as the blue of the ore under test.
const DEEP_TONES = [["#d8af93"], ["#7fa39c", "#a9c4be"], ["#b5a36a"], ["#a8726a", "#c49a94"], ["#6f7fa8"], ["#7fa886", "#b0cbb5"], ["#1c1c20"], ["#b08a5e"], ["#9a85ad", "#c5b8d1"], ["#c9c9c9"], ["#7a5a45"], ["#6d94a8", "#a5c0cc"]]
const drawn = async (script: string) => ((ran) => (ran.ok ? ran.texture : Promise.reject(new Error(ran.error))))(await runDrawing(script))
const bytes = (url: string) => Uint8Array.from(Buffer.from(url.split(",")[1]!, "base64"))
const ORE = patches(21, ["#6f7377", "#7c8084", "#62666a", "#39a7d9", "#8fdcf5"])
const tag = (...names: string[]) => new TextEncoder().encode(JSON.stringify({ values: names.map((name) => `minecraft:${name}`) }))

async function world() {
  const stone = await drawn(patches(1, GREYS))
  const vein = await drawn(patches(2, [...GREYS, "#d8af93"]))
  const blade = await drawn(`const c = api.canvas(16, 16, null)\nfor (let i = 1; i < 15; i++) c.rect(i, 14 - i, 2, 2, i > 4 ? "#2fd6c8" : "#5a4020")\nreturn c`)
  // J2: the broad family a block in rock is measured against: another rock and a dozen things that sit in it, none of which sits in stone
  // (so what is put beside the block is what it was), each its own arithmetic.
  const deep = await drawn(patches(3, DEEP))
  const seated = await Promise.all(DEEP_TONES.map((tones, index) => drawn(patches(30 + index, [...DEEP, ...tones]))))
  return {
    stone,
    vein,
    blade,
    jar: zipSync({
      "assets/minecraft/textures/block/deepslate.png": bytes(deep),
      ...Object.fromEntries(seated.flatMap((picture, index) => [[`assets/minecraft/textures/block/deep_${index}_ore.png`, bytes(picture)], [`data/minecraft/tags/block/deep_${index}_ores.json`, tag(`deep_${index}_ore`)]])),
      "assets/minecraft/textures/block/stone.png": bytes(stone),
      "assets/minecraft/textures/block/iron_ore.png": bytes(vein),
      "assets/minecraft/textures/item/diamond_sword.png": bytes(blade),
      "data/minecraft/tags/block/iron_ores.json": tag("iron_ore"),
      "data/minecraft/tags/block/base_stone_overworld.json": tag("stone"),
      "data/minecraft/tags/item/swords.json": tag("diamond_sword"),
    }),
  }
}

/** A stand-in for the hidden window: each "picture" is the text of everything its sheet was handed, so a stored picture can be searched for what went into it. */
function renderer() {
  const jobs: LookJob[] = []
  const look: LookRenderer = async (job) => {
    jobs.push(job)
    return { ok: true, pictures: job.sheets.map((sheet) => ({ label: sheet.label, url: `data:image/png;base64,${Buffer.from(JSON.stringify(sheet)).toString("base64")}` })) }
  }
  return { jobs, look }
}

async function bench(game: Uint8Array | null) {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-texture-"))
  directories.push(root)
  const directory = path.join(root, "project")
  const created = await createProject({ directory, name: "贴图", description: "" })
  if (game) {
    await mkdir(path.join(root, "gradle-home", "caches", "fabric-loom", "1.21.1"), { recursive: true })
    await writeFile(path.join(root, "gradle-home", "caches", "fabric-loom", "1.21.1", "minecraft-merged.jar"), game)
  }
  const hidden = renderer()
  const source = worldSource(path.join(root, "gradle-home"))
  const runner = createProjectRunner({ directoryFor: async () => directory, ai: {}, look: hidden.look, world: source, sees: async () => "yes" })
  closers.push(() => runner.dispose())
  const claim = async (module: "block" | "item", revision: number) => {
    const started = await runner.startExternal({
      projectId: created.id,
      expectedRevision: revision,
      prompt: "一种会发光的蓝色矿石方块",
      plan: { summary: "矿石", questions: [], tasks: [{ key: module, module, title: module === "block" ? "蓝晶矿石" : "蓝晶", prompt: "会发光的蓝色矿石", source: "会发光的蓝色矿石", dependencies: [], target_id: null }] },
    })
    const ids = { projectId: created.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
    return { ids, assetId: started.run.tasks[0]!.asset_id, context: await runner.claimExternalTask(ids) }
  }
  return { root, directory, created, runner, hidden, source, claim }
}

const sheet = {
  subject: "一种嵌在石头里的蓝色矿石方块的贴图。",
  recognisable: ["灰色的石头底", "几簇蓝色的晶体"],
  parts: [
    { name: "rock", what: "石头底", shape: "铺满 16×16", attaches: "整张", surface: "深浅不一的灰", moves: "不动", assumed: true },
    { name: "crystal", what: "蓝色晶体", shape: "三四簇，每簇两三个像素", attaches: "散在石头里", surface: "蓝色，一角亮", moves: "不动", assumed: false },
  ],
  assumed: ["人没说石头是什么颜色：定成原版石头那样的灰"],
}
const block = (texture: string | null) => ({ kind: "block" as const, identifier: "blue_ore", name: "蓝晶矿石", hardness: 3, luminance: 9, tool: "pickaxe" as const, drop: "self" as const, color: "#3a8fd0", texture, generation: { dimension: "overworld" as const, min_y: -16, max_y: 48, spread: "even" as const, vein_size: 6, veins_per_chunk: 8, replaces: ["stone" as const], biomes: null } })
const item = (texture: string | null) => ({ kind: "item" as const, identifier: "blue_gem", name: "蓝晶", max_stack: 64, color: "#3a8fd0", texture })
const words = (step: Promise<unknown>) => step.then(() => "accepted", (error: Error) => error.message)
const done = { matches: ["石头底和晶体都在"], problems: [], next: [], verdict: "done" as const }
/** Every file under a folder, as bytes. */
const files = async (folder: string) => Promise.all((await readdir(folder, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map(async (entry) => ({ name: path.join(entry.parentPath, entry.name), bytes: await readFile(path.join(entry.parentPath, entry.name)) })))
/** Whether a picture is anywhere in some bytes: as the file it is, or as the text a data URL carries it in. */
const holds = (haystack: Uint8Array, url: string) => Buffer.from(haystack).includes(Buffer.from(bytes(url))) || Buffer.from(haystack).includes(url.split(",")[1]!)

test("方块走看着做的全程：图是它在游戏里的样子，原版的图只给看的人，哪里都不存", async () => {
  const game = await world()
  const { directory, created, runner, hidden, claim } = await bench(game.jar)
  const { ids, assetId, context } = await claim("block", created.revision)
  // The claim says it is made by looking, and that its picture may be drawn by a script beside the document.
  expect(context.making).toMatchObject({ sheet: null, next_step: "先用 save_sheet 写部件说明。", script: DRAWN_SUMMARY })
  expect(context.quality.standard).toContain("每次看图会告诉你量出来的事实（不作为退回的理由）")
  await runner.describeExternalTask({ ...ids, sheet })

  const first = (await runner.lookExternalTask({ ...ids, document: block(null), script: ORE })) as { round: number; pictures: { label: string; url: string }[]; findings: string[]; notes: string[]; texture_facts: string[]; script: { summary: Record<string, unknown> } }
  expect(first.round).toBe(1)
  // Nothing the standard refuses. But two of its numbers lie well outside the range of the game's own family of things that sit in rock
  // (round 10: the fifteen of them, not the two put beside it), and each comes back to be answered.
  expect(first.findings.map((line) => line.split("：")[0])).toEqual(["有主次", "配得上"])
  expect(first.findings.every((line) => line.includes(OUTSIDE_WORDS.mark) && line.includes('{"measure":"'))).toBe(true)
  expect(first.script.summary).toEqual({ kind: "picture", width: 16, height: 16, colours: 5, empty: 0 })
  // Two pictures: the thing alone, and the thing among the game's own.
  expect(first.pictures.map((picture) => picture.label)).toEqual(["方块的贴图：铺开、砌墙、实际大小", WORLD_SHEET_NAME])
  const own = hidden.jobs[0]!.sheets[0]!
  expect(own.cells.map((cell) => `${cell.kind} ${cell.label}`)).toEqual([
    "tiles 平铺 4×4（看接缝和重复）",
    "blocks 砌成一面墙（世界里的光）",
    "blocks 单独一块",
    `tiles 游戏里的实际大小（离它 ${TEXTURE_SEEN.distance} 格，一格 ${TEXTURE_SEEN.block} 像素）`,
    "tiles 放大看每个像素（只用来找哪个像素不对）",
    "blocks 夜里它自己发的光（亮度 9，示意）",
  ])
  // One cell is at the size the game shows it: six screen pixels to each of its pixels, no more.
  expect(own.cells[3]).toMatchObject({ pixel: 6, layout: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]] })
  expect(hidden.jobs[0]!.sheets.map((value) => value.label)).toEqual(["方块的贴图：铺开、砌墙、实际大小", "封面", WORLD_SHEET_NAME])
  expect(hidden.jobs[0]!.sheets[2]!.cells.map((cell) => cell.label)).toEqual(["长在「石头」里（墙）", "同一面墙 · 游戏里的实际大小", "做出来的这一张", "原版 · 石头", "原版 · iron_ore"])
  // The facts come back in sentences, with the game's own numbers beside them.
  expect(first.texture_facts.slice(0, 4).map((line) => line.split("：")[0])).toEqual(["认得出", "有主次", "不机械", "配得上"])
  expect(first.texture_facts[4]).toContain("对照的范围：摆在旁边的 2 张是和它最像的几样，只用来对着看；一项量出来算不算「在原版的范围以外」，按原版里的岩石和长在岩石里的矿石（15 张）量出来的范围算")
  expect(first.texture_facts.slice(5).map((line) => line.split("：")[0])).toEqual(["flat", "peak"].map((measure) => `${OUTSIDE_WORDS.mark}（${comparedName(measure)}）`))
  expect(first.texture_facts[3]).toContain("它长在「石头」里")
  expect(first.notes).toEqual(first.texture_facts)

  // "Done" over numbers outside the world's range is refused in the same words; the version stays the one kept for the person.
  expect(await words(runner.selfReviewExternalTask({ ...ids, ...done }))).toBe(REFUSALS.done_outside_world(first.findings))
  expect((await readMaking(directory, assetId))!).toMatchObject({ best: { round: 1 }, rounds: [{ self_review: null }] })
  // Answered in the sheet, measure by measure, with a reason the reviewer and the person read: now it may be called finished.
  const differs = ["flat", "peak"].map((measure) => ({ measure, reason: "这是一种通体发亮的晶石，有意和周围的石头不一样" }))
  await runner.describeExternalTask({ ...ids, sheet: { ...sheet, differs: differs.slice(1) } })
  expect(await words(runner.selfReviewExternalTask({ ...ids, ...done }))).toBe(REFUSALS.done_outside_world([first.findings[0]!]))
  await runner.describeExternalTask({ ...ids, sheet: { ...sheet, differs } })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  // Round 17, 盲认: a block's picture is first named from the picture alone (审查 is on here); the material follows the answer.
  const blind = (await runner.finalReviewExternalTask(ids)) as { blind_first: boolean; pictures: { label: string; url: string }[] }
  expect(blind).toMatchObject({ blind_first: true, pictures: [{ label: BLIND_SHEET }] })
  expect(JSON.stringify(blind)).not.toMatch(/蓝晶|矿石|blue_ore|judging/)
  // Nothing of the game's own is on it.
  for (const reference of [game.stone, game.vein]) expect(holds(bytes(blind.pictures[0]!.url), reference)).toBe(false)
  const packet = (await runner.finalReviewExternalTask({ ...ids, blind: { sees: "嵌着蓝色晶体的石头", also: [], because: "灰色的石头底上有几簇蓝色" } })) as { instructions: string; input: { judging: string; criteria: string[]; texture_facts: string[] }; pictures: { label: string; url: string }[] }
  expect(packet.input.judging).toBe("「蓝晶矿石」——这个方块的贴图：铺开、砌成墙、按游戏里的实际大小看到的样子，以及它和周围的世界放在一起协不协调。")
  expect(packet.input.criteria.map((line) => line.split("：")[0])).toEqual(["不机械", "认得出", "有主次", "站得住", "配得上"])
  expect(packet.input.texture_facts.slice(0, 5)).toEqual(first.texture_facts.slice(0, 5))
  expect(packet.input.texture_facts.slice(5)).toEqual(first.texture_facts.slice(5).map((line) => `${line}部件说明里声明了「${OUTSIDE_WORDS.meant}」（这是一种通体发亮的晶石，有意和周围的石头不一样）。`))
  expect(packet.instructions).toContain(OUTSIDE_REVIEW_RULE)
  expect(packet.pictures.map((picture) => picture.label)).toEqual(["方块的贴图：铺开、砌墙、实际大小", WORLD_SHEET_NAME])
  await runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], advice: ["晶体还可以再亮一点"], independent: true, recognised: true } })
  // The same document and the same script are the version that was looked at.
  expect(await words(runner.commitExternalTask({ ...ids, document: block(null), script: ORE }))).toBe("accepted")
  const saved = (await openProject(directory)).blocks[0]!
  expect(saved.texture).toBe(await drawn(ORE))

  // What the record keeps of the game's own pictures: their names and numbers. Not one of their pixels.
  const record = (await readMaking(directory, assetId))!
  expect(record.rounds[0]!.pictures.map((picture) => picture.label)).toEqual(["方块的贴图：铺开、砌墙、实际大小"])
  expect(record.rounds[0]!.review_pictures!.map((picture) => picture.label)).toEqual(["方块的贴图：铺开、砌墙、实际大小"])
  expect(record.rounds[0]!.texture).toMatchObject({ colours: 5, inside: "石头", copy: null, world: { names: ["stone", "iron_ore"] } })
  expect(record.rounds[0]!.script).toBe(ORE)
  const kept = await files(directory)
  const packed = Object.values(await archivedMakings(directory))
  // The search does find a picture where one is: the made texture is in the stored pictures and in the project, and the world sheet handed to the AI did hold the game's.
  expect(kept.filter((file) => holds(file.bytes, saved.texture!)).length).toBeGreaterThanOrEqual(4)
  expect(packed.some((entry) => holds(entry, saved.texture!))).toBe(true)
  for (const shown of [first.pictures[1]!, packet.pictures[1]!]) for (const reference of [game.stone, game.vein]) expect(holds(bytes(shown.url), reference)).toBe(true)
  // And it finds none of the game's own anywhere under the project, nor in what an export would carry.
  for (const reference of [game.stone, game.vein, game.blade]) {
    expect(kept.filter((file) => holds(file.bytes, reference)).map((file) => file.name)).toEqual([])
    expect(packed.filter((entry) => holds(entry, reference))).toHaveLength(0)
  }
  expect(kept.some((file) => Buffer.from(file.bytes).includes(WORLD_SHEET_NAME))).toBe(false)
})

test("和原版几乎一样的图在看之前就被拒绝，什么都不留；这台电脑上没有游戏时照常看，只是没有对照", async () => {
  const game = await world()
  const { directory, created, runner, hidden, claim } = await bench(game.jar)
  const { ids, assetId } = await claim("block", created.revision)
  await runner.describeExternalTask({ ...ids, sheet })
  const copy = copyFinding("block", { copy: "stone" })!
  expect(await words(runner.lookExternalTask({ ...ids, document: block(game.stone) }))).toBe(copy)
  expect(copy).toBe("照搬：这张贴图和拿来对照的原版「stone」几乎一模一样（同一个位置上 90% 以上的像素颜色相同或只差一点点）。原版的图只用来对照细节的多少、用色和光的方向，不能拿来用：重新画一张自己的，再看一版。")
  expect(hidden.jobs).toHaveLength(0)
  expect((await readMaking(directory, assetId))!.rounds).toEqual([])
  expect((await files(path.join(directory, ".minemods", "making"))).filter((file) => /\.(png|jpg)$/.test(file.name))).toEqual([])
  // Its own picture is looked at as usual afterwards.
  expect(((await runner.lookExternalTask({ ...ids, document: block(null), script: ORE })) as { round: number }).round).toBe(1)
  // A drawing script without a document to put the picture into is said so.
  expect(await words(runner.lookExternalTask({ ...ids, script: ORE }))).toBe(DRAWN_NEEDS_DOCUMENT)

  const bare = await bench(null)
  const other = await bare.claim("item", bare.created.revision)
  await bare.runner.describeExternalTask({ ...other.ids, sheet })
  const gem = `const c = api.canvas(16, 16, null)\nc.rect(5, 4, 6, 8, "#39a7d9")\nc.rect(6, 5, 2, 3, "#8fdcf5")\nc.rect(9, 9, 2, 3, "#1f6f9a")\nreturn c`
  const looked = (await bare.runner.lookExternalTask({ ...other.ids, document: item(null), script: gem })) as { pictures: { label: string }[]; notes: string[]; texture_facts: string[] }
  expect(looked.pictures.map((picture) => picture.label)).toEqual(["物品的图标：格子里、放大、拿在手里"])
  expect(looked.texture_facts[0]).toBe(NO_WORLD_WORDS)
  expect(looked.texture_facts.join("")).not.toContain("原版物品")
  expect(bare.hidden.jobs[0]!.sheets[0]!.cells.map((cell) => `${cell.kind} ${cell.label}`)).toEqual([
    `slots 背包格子里的实际大小（${TEXTURE_SEEN.icon} 像素，和小一号的 ${TEXTURE_SEEN.small} 像素）`,
    "slots 深色的格子里（快捷栏那样）",
    "tiles 放大看每个像素（只用来找哪个像素不对）",
    "slots 只看轮廓（实际大小）",
    "held 拿在手里 · 平着拿（普通物品） ← 游戏里是这样",
    "held 拿在手里 · 握着柄（工具和武器）",
  ])
  expect((await readMaking(bare.directory, other.assetId))!.rounds[0]!.texture).toMatchObject({ world: null, inside: null, seam: null })
  // For the person: the same picture on demand, drawn afresh, handed over and kept nowhere; nothing when the game is not there.
  expect(await besidePicture({ look: bare.hidden.look, world: bare.source }, item(await drawn(gem)))).toBeNull()
  const before = (await files(directory)).length
  const shown = await besidePicture({ look: hidden.look, world: worldSource(path.join(path.dirname(directory), "gradle-home")) }, item(await drawn(gem)))
  expect(shown?.label).toBe(WORLD_SHEET_NAME)
  expect(holds(bytes(shown!.url), game.blade)).toBe(true)
  expect((await files(directory)).length).toBe(before)
  expect(await besidePicture({ look: hidden.look }, { kind: "worldview", title: "矿洞", summary: "", entries: [] })).toBeNull()
})

test("没有图的方块和以前存下的记录照旧：纯色也能看，旧记录不带量出来的数", async () => {
  // A block saved before pictures were looked at has no texture of its own: it is drawn in its colour, and counted as that.
  const plain = lookJob({ ...block(null), luminance: 0, generation: null }, null)
  expect(plain.texture).toMatchObject({ colours: 1, flat: 1, world: null })
  expect(plain.world).toBeNull()
  expect(plain.job.sheets[0]!.cells.at(-1)!.label).toBe(`再远一倍（离它 ${TEXTURE_SEEN.distance * 2} 格，一格 ${TEXTURE_SEEN.far} 像素）`)
  expect(() => lookJob(block("data:image/png;base64,AAAA"), null)).toThrow("方块的图不是一张读得出来的 PNG")
  // The schema of the two kinds is what it was: nothing is asked of a saved block or item that it did not already have.
  expect(getModuleSchema("item").safeParse({ kind: "item", identifier: "old", name: "旧物品", max_stack: 64, color: "#aabbcc", texture: null }).success).toBe(true)
  const old = { schema_version: 1, asset_id: "3c1b2a52-6f2b-4b93-8a57-0d2f4d7c9b11", entry: null, kind: "block", request: "", brief: "", task_id: null, sheet: null, described: false, remark: null, rounds: [{ round: 1, at: "2026-10-01T00:00:00.000Z", fingerprint: "a".repeat(64), pictures: [], self_review: null, findings: [] }], review: null, state: "done", rounds_allowed: 6, updated_at: "2026-10-01T00:00:00.000Z" }
  expect(MakingRecordSchema.parse(old).rounds[0]!.texture).toBeUndefined()
  // The standard says what is told as a fact for these kinds, and refuses on none of it.
  expect(Object.keys(ASSET_STANDARDS.block.told ?? {})).toEqual(["reads", "hierarchy", "not_mechanical", "fits"])
  expect(ASSET_STANDARDS.block.rules.map((rule) => rule.id)).toEqual(["noisy_texture", "few_tones", "block_has_holes"])
  expect(decodeRgbaPng(bytes(await drawn(ORE))).width).toBe(16)
  expect(textureNote(decodeRgbaPng(bytes(await drawn(ORE)))).copy).toBeNull()
})

test("Studio 自己的 AI 也一样：文档照常写，图用脚本画；脚本坏了带着原因再要一次", async () => {
  const schema = scriptedAnswerSchema("block")
  expect(schema.safeParse({ script: ORE, document: block(null) }).success).toBe(true)
  // A bare document is taken as the document, with no script.
  expect(schema.parse(block(null))).toEqual({ script: null, document: block(null) })
  expect(DRAWN_ANSWER_INSTRUCTIONS).toContain("document 写完整的文档")
  expect(DRAWN_ANSWER_INSTRUCTIONS).toContain("api.canvas(width, height, fill)")
  expect(DRAWN_ANSWER_INSTRUCTIONS).not.toMatch(/m\.bone|a\.key|api\.model/)
  const asked: unknown[] = []
  const made = await settled(
    "block",
    async (failed) => {
      asked.push(failed)
      return { script: failed ? ORE : "return 1 +", document: block(null) }
    },
    null,
  )
  expect(asked).toEqual([undefined, { script: "return 1 +", error: expect.stringContaining("脚本写错了"), line: expect.anything() }])
  expect(made).toEqual({ document: block(await drawn(ORE)), script: ORE })
  expect(await settled("item", async () => ({ script: null, document: item(null) }), null)).toEqual({ document: item(null) })
})

// Round 9 (Engineer H2): a block with more faces than one.
test("有几张图的方块：墙是按游戏自己的挑法砌的，每张图都量、都放大给看；一张图的方块，看的东西和以前一模一样", async () => {
  const several = await runDrawing(`const face = (seed) => { const c = api.canvas(16, 16, "#777777"); c.noise(0, 0, 16, 16, ${JSON.stringify(GREYS)}, { seed, cell: 3 }); const r = api.random(seed); for (let i = 0; i < 6; i++) c.set(r.whole(0, 15), r.whole(0, 15), "#39a7d9"); return c }\nreturn [face(1), face(2), face(3)]`)
  if (!several.ok) throw new Error(several.error)
  const block = (extra: Record<string, unknown> = {}) => getModuleSchema("block").parse({ kind: "block", identifier: "vein", name: "矿脉", hardness: 3, luminance: 0, tool: "pickaxe", drop: "self", color: "#39a7d9", texture: several.texture, ...extra }) as Parameters<typeof lookJob>[0]
  const one = lookJob(block(), null)
  expect(one.job.sheets[0]!.label).toBe("方块的贴图：铺开、砌墙、实际大小")
  expect(one.job.sheets[0]!.cells.map((cell) => cell.label)[2]).toBe("单独一块")
  expect(JSON.stringify(one.job)).not.toContain("pose")
  expect(one.texture).not.toHaveProperty("wall")
  const mixed = lookJob(block({ variants: several.variants, random_mirror: true }), null)
  const cells = mixed.job.sheets[0]!.cells
  expect(mixed.job.sheets[0]!.label).toBe("方块的贴图（3 张图、左右镜像，按游戏的随机混法）：铺开、砌墙、实际大小")
  // The labels the measured facts point at are still there, and the wall is not one picture over and over.
  for (const name of ["平铺 4×4", "砌成一面墙", "游戏里的实际大小"]) expect(cells.some((cell) => cell.label.includes(name))).toBe(true)
  const size = cells.find((cell) => cell.label.startsWith("游戏里的实际大小"))
  if (size?.kind !== "tiles") throw new Error("the cell at game size is laid out of tiles")
  expect(size.textures).toEqual([several.texture, ...several.variants])
  expect(new Set(size.layout.flat()).size).toBe(3)
  expect(size.poses?.flat().some((pose) => pose === 4)).toBe(true)
  expect(cells.find((cell) => cell.label.includes("各自放大"))).toMatchObject({ kind: "tiles", layout: [[0, 1, 2]], lines: true })
  expect(cells.find((cell) => cell.label.startsWith("对照"))).toMatchObject({ kind: "tiles", textures: [several.texture] })
  expect(mixed.texture).toMatchObject({ wall: { pictures: 3, mirror: true }, among: { twin: null } })
  expect(mixed.texture!.variants).toHaveLength(2)
  expect(mixed.texture_facts!.join("")).toContain("从这个方块的 6 种样子里随机用一种")
  // A list of pictures is a block's alone, and what cannot be drawn is said, not skipped.
  await expect(drawnInto({ kind: "item" }, "return [api.canvas(16, 16, null), api.canvas(16, 16, null)]", "item")).rejects.toThrow("物品只有一张图")
  expect((await drawnInto({ kind: "block" }, "return [api.canvas(16, 16, '#777777'), api.canvas(16, 16, '#888888')]", "block")).document).toMatchObject({ kind: "block", variants: [expect.stringMatching(/^data:image\/png/)] })
  expect(() => lookJob(block({ variants: ["data:image/png;base64,AAAA"] }), null)).toThrow("第 2 张图（variants 的第 1 张）不是一张读得出来的 PNG")
})

test("模型的档位：每次看图都说它有多少、这一档容多少；高一档没有在部件说明里写理由就先退回；看得久的大模型多给时间", async () => {
  const model = { kind: "model" as const, ...ModelDesignSchema.parse(slime.model) }
  const sheet = { budget: { tier: "fine" as const, reason: "它有三格高，玩家会绕着它打", at_once: 2 } }
  const plain = lookJob(model, null)
  expect(plain.budget_facts![0]).toStartWith("几何预算：「普通」档")
  expect(plain.budget).toMatchObject({ tier: "standard", bones: model.bones.length })
  expect(reviewJob(model, null).budget_facts).toEqual(plain.budget_facts!)
  // A plain preview has no sheet and asks for none; a making does.
  expect(lookJob({ ...model, budget: "fine" }, null).budget).toMatchObject({ tier: "fine" })
  expect(() => lookJob({ ...model, budget: "fine" }, null, {}, {})).toThrow(BUDGET_REFUSALS.undeclared("fine"))
  expect(lookJob({ ...model, budget: "fine" }, null, {}, sheet).budget_facts![0]).toContain("部件说明估计游戏里同时会出现约 2 个")
  // The time a look may take grows with the boxes it has to draw; the default tier's is what it was.
  const slow = (cubes: number) => lookQueue(() => new Promise<never>(() => undefined), { timeoutMs: 400, giveUp: () => undefined })({ scenes: [{ design: { ...model, bones: [{ ...model.bones[0]!, cubes: Array.from({ length: cubes }, () => model.bones[0]!.cubes[0]!) }] }, preview: null }], sheets: [] })
  expect(await slow(GEOMETRY_TIERS.standard.cubes)).toEqual({ ok: false, reason: "预览图画了 0 秒还没有画完，已经放弃这一次。" })
  expect(await slow(GEOMETRY_TIERS.standard.cubes * 4)).toEqual({ ok: false, reason: "预览图画了 2 秒还没有画完，已经放弃这一次。" })
})

// 10-07, the owner: 「为什么看不见他正在画的东西……应该让他在做的过程中也可以看到」.
test("边做边看：做的过程中随时能看一眼——图和量出来的毛病和正式看图一样，但不算一版、不欠自评、什么都不留下；正式看才算数", async () => {
  const { MAKING_LIMITS, GLANCE_WORDS, MAKING_DISCIPLINE } = await import("@minemods/studio-ai/making")
  const { directory, created, runner, claim } = await bench(null)
  const { ids, assetId } = await claim("block", created.revision)
  // Nothing to make by yet: a glance is refused like a look.
  await expect(runner.lookExternalTask({ ...ids, glance: true, document: block(null), script: ORE })).rejects.toThrow()
  await runner.describeExternalTask({ ...ids, sheet })
  const pictures = async () => (await files(path.join(directory, ".minemods", "making"))).filter((file) => /\.(png|jpg)$/.test(file.name)).length
  const glance = (await runner.lookExternalTask({ ...ids, glance: true, document: block(null), script: ORE })) as unknown as { glance: boolean; glances_left: number; round: number; rounds_left: number; next_step: string; pictures: unknown[]; texture_facts: string[]; findings: string[] }
  expect(glance).toMatchObject({ glance: true, glances_left: MAKING_LIMITS.glances - 1, round: 0, rounds_left: MAKING_LIMITS.rounds, next_step: GLANCE_WORDS.step(MAKING_LIMITS.glances - 1) })
  expect(glance.pictures.length).toBeGreaterThan(0)
  expect(glance.texture_facts.length).toBeGreaterThan(0)
  // Nothing of it is there afterwards: no round, no best version, no picture on disk.
  expect((await readMaking(directory, assetId))!.rounds).toEqual([])
  expect((await readMaking(directory, assetId))!.best ?? null).toBeNull()
  expect(await pictures()).toBe(0)
  // Again and again, a different picture each time, with no self-review in between — what a look would refuse.
  await runner.lookExternalTask({ ...ids, glance: true, document: block(null), script: ORE.replace("0", "1") })
  await runner.lookExternalTask({ ...ids, glance: true, document: block(null), script: ORE })
  expect((await readMaking(directory, assetId))!.rounds).toEqual([])
  // The look is the one that counts, and it says the same of the same picture.
  const looked = (await runner.lookExternalTask({ ...ids, document: block(null), script: ORE })) as { round: number; texture_facts: string[]; findings: string[] }
  expect(looked.round).toBe(1)
  expect(looked.texture_facts).toEqual(glance.texture_facts)
  expect(looked.findings).toEqual(glance.findings)
  expect(await pictures()).toBeGreaterThan(0)
  // A glance after a look is still only a glance: the round stays the one that was seen.
  expect(((await runner.lookExternalTask({ ...ids, glance: true, document: block(null), script: ORE.replace("0", "1") })) as { round: number }).round).toBe(1)
  expect((await readMaking(directory, assetId))!.rounds).toHaveLength(1)
  // Bounded: four for each version a task may show, then said plainly.
  expect(MAKING_LIMITS.glances as number).toBe(4 * MAKING_LIMITS.rounds)
  for (const _ of Array.from({ length: MAKING_LIMITS.glances - 4 })) await runner.lookExternalTask({ ...ids, glance: true, document: block(null), script: ORE })
  expect(await words(runner.lookExternalTask({ ...ids, glance: true, document: block(null), script: ORE }))).toBe(GLANCE_WORDS.spent)
  // Every maker is told before it starts.
  expect(MAKING_DISCIPLINE).toContain("不要闭着眼把一整版写完才看")
}, 60000)

// Round 12: a picture the maker drew with its own tool is handed in (save_concepts) for an item or a block too, and a drawing script traces it.
test("物品和方块的任务也能交构想图；脚本里 api.trace 描它，得到的是一张普通的图，没有构想图时说清楚怎么办", async () => {
  const { encodePng } = await import("@minemods/mod-core/png")
  const slant = new Uint8Array(160 * 160 * 4)
  for (let y = 0; y < 160; y++)
    for (let x = 0; x < 160; x++) slant.set(Math.abs(x + y - 159) < 22 && x > 14 && x < 146 ? [60, 170, 160, 255] : [255, 255, 255, 255], (y * 160 + x) * 4)
  const concept = `data:image/png;base64,${Buffer.from(encodePng(slant, 160, 160)).toString("base64")}`
  const { directory, created, runner, claim } = await bench(null)
  const { ids, assetId } = await claim("item", created.revision)
  await runner.describeExternalTask({ ...ids, sheet })
  const traced = `return api.trace("侧视", { outline: true, colors: 4 })`
  // Before any is handed in, the script is told what to do, and nothing is recorded.
  expect(await words(runner.lookExternalTask({ ...ids, document: item(null), script: traced }))).toContain("save_concepts")
  expect((await readMaking(directory, assetId))!.rounds).toEqual([])
  // An item's task takes it, with the same limits as a model's (three, 4 MB each, the three kinds).
  const saved = (await runner.conceptExternalTask({ ...ids, views: [{ name: "侧视", image: concept }] })) as { references: { kind: string; name: string }[] }
  expect(saved.references.map((reference) => [reference.kind, reference.name])).toEqual([["concept", "侧视"]])
  expect(await words(runner.conceptExternalTask({ ...ids, views: Array.from({ length: 4 }, () => ({ name: "侧视", image: concept })) }))).toContain("<=3 items")
  expect(await words(runner.conceptExternalTask({ ...ids, views: [{ name: "侧视", image: "data:image/gif;base64,R0lGODlh" }] }))).not.toBe("accepted")
  const looked = (await runner.lookExternalTask({ ...ids, document: item(null), script: traced })) as { round: number; script: { summary: Record<string, unknown>; notes: string[] } }
  expect(looked.round).toBe(1)
  expect(looked.script.summary).toMatchObject({ kind: "picture", width: 16, height: 16 })
  expect(looked.script.summary.empty as number).toBeGreaterThan(100)
  expect(looked.script.notes.join("")).toContain("侧视")
  // The version is an ordinary item picture: the script drew it, and what is saved is the picture.
  const ran = await runDrawing(traced, { pictures: [{ name: "侧视", width: 160, height: 160, rgba: Buffer.from(slant).toString("base64") }] })
  expect(ran.ok).toBe(true)
  // Handing in again replaces the picture, and the next look traces the new one.
  const blue = slant.slice()
  for (let at = 0; at < blue.length; at += 4) if (blue[at] === 60) blue.set([30, 60, 200], at)
  await runner.conceptExternalTask({ ...ids, views: [{ name: "侧视", image: `data:image/png;base64,${Buffer.from(encodePng(blue, 160, 160)).toString("base64")}` }] })
  const again = (await runner.lookExternalTask({ ...ids, document: item(null), script: traced })) as { script: { notes: string[] } }
  expect(again.script.notes.join("")).toContain("#")
  expect(again.script.notes.join("")).not.toBe(looked.script.notes.join(""))
  // A script that does not trace is not handed any: nothing about it changed.
  expect(await words(runner.lookExternalTask({ ...ids, document: item(null), script: `return api.canvas(16, 16, null).set(3, 3, "#336699")` }))).toBe("accepted")
}, 60000)
