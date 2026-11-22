import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { writePictures } from "@minemods/mod-core/making"
import { createProject, openProject } from "@minemods/mod-core/project"
import { encodePng } from "@minemods/mod-core/png"
import { BLIND_INSTRUCTIONS, BLIND_REVIEW_RULE, BLIND_SHOWN, BLIND_WORDS, blindAdvice, blindFinding, blindPlain, MAKING_DISCIPLINE, MAKING_LIMITS, OWN_GLANCE_INSTRUCTIONS, readMaking, REFUSALS, REVIEWER_INSTRUCTIONS, SELF_REVIEW_INSTRUCTIONS, SHEET_INSTRUCTIONS, shownMaking, UNSATISFIED } from "@minemods/mod-core/making"
import { measureTexture, outlineOverlap, textureLines, textureNote, outsideFindings, type Picture } from "@minemods/studio-ai/texture-facts"
import { createProjectRunner, INSPECTION_WORDS } from "../src/main/project-runner"
import { pictured } from "../src/main/mcp-content"
import { BLIND_SHEET, blindSheet, lookJob, reviewJob, type LookJob, type LookRenderer } from "../src/main/look-job"
import { buildMcpReviewHandoff, MCP_TOOLS } from "../src/main/mcp-handoff"
import { everythingToRead } from "./handoff-reading"
import { stormPick } from "../../studio-ai/test/fixtures/look/storm-pick-r17"

// Round 17. The owner, of an icon that had passed every measure and a review: 「这个风暴镐是如何通过筛查的，太离谱了」.
// The icon is the fixture: a grey head curving to one side on a slanted handle. What is tested here is the one question
// nothing had asked: shown the picture alone, what is it? No model is run: the answers are scripted, the order and what
// each hand-off holds are what is checked.

const directories: string[] = []
const closers: (() => unknown)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const png = (image: Picture) => `data:image/png;base64,${Buffer.from(encodePng(image.pixels, image.width, image.height)).toString("base64")}`
const HOOK = png(stormPick())
/** Another version of the picture: the same icon with one more pixel, so it is a different document. */
const second = () => ((image) => (image.pixels.set([37, 49, 59, 255], (2 * 16 + 3) * 4), png(image)))(stormPick())
const item = (texture: string) => ({ kind: "item" as const, identifier: "storm_pick", name: "风暴镐", max_stack: 1, color: "#35c0d0", texture })
const TITLE = "风暴镐"
const PROMPT = "用风暴石像的掉落物合成一把风暴镐"
const sheet = {
  subject: "一把镐的图标。",
  recognisable: ["横在柄顶上的弧形镐头", "斜着的木柄"],
  parts: [
    { name: "head", what: "镐头", shape: "横在上方的一道弧，两头尖", attaches: "柄的顶端", surface: "灰蓝色的金属，上缘亮", moves: "不动", assumed: false },
    { name: "handle", what: "柄", shape: "从左下到右上的斜线，两个像素宽", attaches: "镐头的正中", surface: "棕色的木头", moves: "不动", assumed: true },
  ],
  assumed: ["人没说柄是什么：定成木柄"],
}
const done = { matches: ["镐头和柄都在"], problems: [], next: [], verdict: "done" as const }
const words = (step: Promise<unknown>) => step.then(() => "accepted", (error: Error) => error.message)
/** What of the thing must not be anywhere in a blind hand-off: its name, its identifier, the person's words, the sheet. */
const TELLS = /风暴|镐|storm|pick|合成|掉落|part_sheet|judging|弧形|木柄/

function renderer() {
  const jobs: LookJob[] = []
  const look: LookRenderer = async (job) => {
    jobs.push(job)
    return { ok: true, pictures: job.sheets.map((value) => ({ label: value.label, url: PIXEL })) }
  }
  return { jobs, look }
}

async function bench(ai: { apiKey?: string; baseUrl?: string; review?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-blind-"))
  directories.push(root)
  const directory = path.join(root, "project")
  const created = await createProject({ directory, name: "风暴山", description: "" })
  const hidden = renderer()
  const runner = createProjectRunner({ directoryFor: async () => directory, ai, look: hidden.look, sees: async () => "yes" })
  closers.push(() => runner.dispose())
  const claim = async () => {
    const started = await runner.startExternal({
      projectId: created.id,
      expectedRevision: created.revision,
      prompt: PROMPT,
      plan: { summary: "镐", questions: [], tasks: [{ key: "storm_pick", module: "item", title: TITLE, prompt: "一把镐", source: "合成一把风暴镐", dependencies: [], target_id: null }] },
    })
    const ids = { projectId: created.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
    await runner.claimExternalTask(ids)
    return { ids, assetId: started.run.tasks[0]!.asset_id }
  }
  return { directory, created, runner, hidden, claim }
}

test("盲认的那张图：只有它自己，按游戏里的实际大小放在浅色和深色的格子里，再加放大的一格；没有名字、没有手、没有原版、没有物品的颜色", () => {
  const made = blindSheet(item(HOOK))!
  expect(made.label).toBe(BLIND_SHEET)
  expect(made.cells.map((cell) => cell.kind)).toEqual(["slots", "slots", "tiles"])
  expect(made.cells[0]).toMatchObject({ dark: false, scales: [4, 2], icons: [null, HOOK, null] })
  expect(made.cells[1]).toMatchObject({ dark: true, scales: [4, 2] })
  // Enlarged with nothing drawn over it: no lines between the pixels.
  expect(made.cells[2]).toEqual({ kind: "tiles", label: "放大（同一张图，每个像素都看得清）", textures: [HOOK], layout: [[0]] })
  expect(JSON.stringify(made).replaceAll(HOOK, "")).not.toMatch(TELLS)
  // The colour the document gives the item is no pixel of its picture: it is in none of the pictures an AI is shown (the page that painted it behind the icon is the page's).
  for (const job of [{ sheets: [made] }, lookJob(item(HOOK), null).job, reviewJob(item(HOOK), null).job]) expect(JSON.stringify(job).toLowerCase()).not.toContain("35c0d0")
  // A block: alone as a cube, one face at the size the game shows it, and enlarged. Nothing else is named blind.
  const ore = { kind: "block" as const, identifier: "ore", name: "矿", hardness: 3, luminance: 0, tool: "pickaxe" as const, drop: "self" as const, color: "#3a8fd0", texture: HOOK, generation: null }
  expect(blindSheet(ore)!.cells.map((cell) => `${cell.kind} ${cell.label.split("（")[0]}`)).toEqual(["blocks 单独一块", "tiles 一个面 · 游戏里的实际大小", "tiles 放大"])
  expect(blindSheet({ kind: "recipe" } as never)).toBeNull()
})

test("这把镐量出来哪一项都没有超出范围：量的是颜色和颗粒，不是形状；轮廓只能当事实说，它分不清原版自己的两种工具", () => {
  // A family that stands in for the game's tools: two outlines that differ, each in three materials (the same outline over again).
  const drawn = (rows: string[], colour: [number, number, number]): Picture => ({ width: 16, height: 16, pixels: Uint8Array.from(rows.flatMap((row) => [...row].flatMap((cell) => (cell === "." ? [0, 0, 0, 0] : [...colour, 255])))) })
  const bar = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (x + y === 15 || x + y === 16 ? "#" : ".")).join(""))
  const cross = bar.map((row, y) => (y === 3 ? "..##########...." : y === 4 ? "..##########...." : row))
  const family = { label: "原版里拿在手里用的东西的图标", pictures: [[90, 90, 90], [150, 150, 150], [200, 180, 60]].flatMap((colour, index) => [{ name: `bar_${index}`, image: drawn(bar, colour as [number, number, number]) }, { name: `cross_${index}`, image: drawn(cross, colour as [number, number, number]) }]) }
  const note = textureNote(stormPick(), family.pictures.slice(0, 2), null, [], {}, family)
  // The hook's outline against the nearest of them, and theirs against each other: numbers and a name, nothing else.
  expect(note.outline).toEqual({ name: "cross_0", share: outlineOverlap(stormPick(), family.pictures[1]!.image)! })
  expect(note.world!.family!.outline).toEqual([outlineOverlap(family.pictures[0]!.image, family.pictures[1]!.image)!, outlineOverlap(family.pictures[0]!.image, family.pictures[1]!.image)!])
  const line = textureLines("item", note).find((value) => value.includes("轮廓（只当事实说，不拿来要求它）"))!
  expect(line).toContain(`轮廓最接近的一张（原版 · cross_0）重合 ${Math.round(note.outline!.share * 100)}%`)
  expect(line).toContain("重合低不等于不好：原版里没有的东西，轮廓本来就和它们都不像")
  // It is a fact: it is never a finding, however low. (Against the game's real thirty tools this icon has none either; see the spec.)
  expect(outsideFindings("item", null, { ...note, outline: { name: "cross_0", share: 0 } }).join("")).not.toContain("轮廓")
  expect(measureTexture(stormPick())).toMatchObject({ colours: 6, opaque: 0.223 })
  // A picture that fills its square has no outline to speak of; nor is anything said without a family.
  expect(textureNote({ width: 16, height: 16, pixels: new Uint8Array(16 * 16 * 4).fill(200) }, family.pictures.slice(0, 2), null, [], {}, family).outline).toBeUndefined()
  expect(textureNote(stormPick()).outline).toBeUndefined()
})

test("外部 AI，审查开着：审查的窗口先只拿到图，说了是什么才拿到名字和说明；说成了别的，这一版不通过，写不写理由都一样", async () => {
  const { directory, created, runner, hidden, claim } = await bench()
  const { ids, assetId } = await claim()
  await runner.describeExternalTask({ ...ids, sheet })
  const looked = (await runner.lookExternalTask({ ...ids, document: item(HOOK) })) as { findings: string[] }
  // What the owner asked about: nothing measured stops it.
  expect(looked.findings).toEqual([])
  expect(await runner.selfReviewExternalTask({ ...ids, ...done })).toMatchObject({ state: "reviewing", next_step: INSPECTION_WORDS.maker })

  // The first hand-off: the picture alone. Not the title, not the sheet, not the person's words, not the criteria; three ids that say nothing.
  const first = (await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })) as unknown as Record<string, unknown> & { pictures: { label: string }[] }
  expect(Object.keys(first).sort()).toEqual(["answer_schema", "blind_first", "how", "input", "instructions", "pictures", "task", "waiting"])
  expect(first).toMatchObject({ waiting: false, task: ids, blind_first: true, instructions: BLIND_INSTRUCTIONS, input: { showing: BLIND_SHOWN.item }, how: INSPECTION_WORDS.blind })
  expect(first.pictures.map((picture) => picture.label)).toEqual([BLIND_SHEET])
  expect(JSON.stringify(first)).not.toMatch(TELLS)
  expect(JSON.stringify(hidden.jobs.at(-1)).replaceAll(HOOK, "")).not.toMatch(TELLS)
  expect(BLIND_INSTRUCTIONS).not.toMatch(TELLS)
  // Asked again, by whatever door, it is still only the picture; a conclusion or a request for more pictures does not get round it.
  expect(await runner.finalReviewExternalTask(ids)).toMatchObject({ blind_first: true })
  expect(await runner.finalReviewExternalTask({ ...ids, need: [{ what: "angle", name: "front" }] })).toMatchObject({ blind_first: true })
  expect(await words(runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], independent: true, recognised: true } }))).toBe(REFUSALS.no_blind)

  // It says what it sees. Only now is it told what the thing is, with what it said then.
  const said = { sees: "钩子", also: ["镰刀"], because: "灰色的头只朝一边弯下去，下面是一根斜着的棕色柄" }
  const packet = (await runner.finalReviewExternalTask({ ...ids, blind: said })) as unknown as { instructions: string; input: { judging: string; blind: typeof said; part_sheet: { subject: string }; request: string }; answer_schema: { required: string[] }; how: string; blind_named: boolean }
  expect(packet.input.blind).toEqual(said)
  expect(packet.input.judging).toStartWith(`「${TITLE}」——这个物品的图标`)
  expect(packet.input.part_sheet.subject).toBe(sheet.subject)
  expect(packet.input.request).toBe(PROMPT)
  expect(packet.instructions).toBe(`${REVIEWER_INSTRUCTIONS}${BLIND_REVIEW_RULE}`)
  expect(packet.answer_schema.required).toContain("fits")
  expect(packet).toMatchObject({ how: INSPECTION_WORDS.unblinded, blind_named: true })
  expect(await words(runner.finalReviewExternalTask({ ...ids, blind: { ...said, sees: "镐" } }))).toBe(REFUSALS.blind_answered)
  expect(await words(runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], independent: true } }))).toBe(REFUSALS.blind_unjudged)

  // A lenient reviewer: everything else is fine, so it writes "passed". What it said blind was another thing, and that alone fails the version.
  const concluded = (await runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], advice: ["镐头的另一边在实际大小的格子里看不出来"], independent: true, recognised: false } })) as { review: { passed: boolean; findings: string[] }; next_step: string }
  expect(concluded.review).toMatchObject({ passed: false, findings: [blindFinding(TITLE, said)] })
  // The reviewing window is told its verdict is recorded and to fetch its next thing; what to do about the verdict is the maker's to hear.
  expect(concluded.next_step).toBe(INSPECTION_WORDS.recorded)
  expect(await runner.awaitInspection({ ...ids, wait_seconds: 0 })).toMatchObject({ waiting: false, review: { passed: false, findings: [blindFinding(TITLE, said)] }, next_step: expect.stringContaining("验收没通过") })
  expect(await words(runner.commitExternalTask({ ...ids, document: item(HOOK) }))).toContain(REFUSALS.review_failed)
  // No word in the sheet answers it: the same version cannot be reviewed again, whatever is declared.
  await runner.describeExternalTask({ ...ids, sheet: { ...sheet, justified: [{ what: "盲认", reason: "这是风格化的镐，故意只画一边" }] } })
  expect(await words(runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], independent: true, recognised: true } }))).toBe(REFUSALS.reviewed_and_failed)
  // It is still the best version, kept for the person if the versions run out.
  expect((await readMaking(directory, assetId))!).toMatchObject({ best: { round: 1 }, review: { blind: { said: "钩子", recognised: false, named: TITLE } } })

  // A new picture is named afresh: the reviewer is again handed only the picture, and this time says what it is.
  await runner.lookExternalTask({ ...ids, document: item(second()) })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  const again = (await runner.nextInspection({ projectId: created.id, wait_seconds: 0 })) as Record<string, unknown>
  expect(again).toMatchObject({ blind_first: true, task: ids })
  expect("title" in again).toBe(false)
  await runner.finalReviewExternalTask({ ...ids, blind: { sees: "镐", also: [], because: "两头尖的弧形头横在柄的顶上" } })
  await runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], independent: true, fits: "at_once" } })
  expect(await words(runner.commitExternalTask({ ...ids, document: item(second()) }))).toBe("accepted")
  const record = (await readMaking(directory, assetId))!
  expect(record).toMatchObject({ state: "done", outcome: "passed", review: { passed: true, independent: true, blind: { said: "镐", recognised: true, fits: "at_once", named: TITLE } } })
  expect((await shownMaking(directory, record)).review!.blind!.words).toBe("盲认：只给图、不说这是什么，评审说它是「镐」——认出来了，它是「风暴镐」。")
  // The blind picture is not one more stored picture: the record holds the version's own.
  expect(record.rounds.flatMap((round) => [...round.pictures, ...(round.review_pictures ?? [])].map((picture) => picture.label))).not.toContain(BLIND_SHEET)
})

// Round 18: 「砂岩甲壳」, a crafting material, failed all six versions; the last was called a pebble, of a thing no stranger could have named.
const SHELL = "砂岩甲壳"
const shell = (texture: string) => ({ ...item(texture), identifier: "sandstone_shell", name: SHELL, max_stack: 64 })
const pebble = { sees: "一块鹅卵石", also: ["贝壳"], because: "一块椭圆的浅黄色，上面有几道横纹" }

test("外部 AI，审查开着：一样陌生人叫不出名字的东西，知道名字就看得出，照样通过，Studio 自己记一句当时叫成了什么；更像另一样东西的不通过，passed 写 true 也一样", async () => {
  const { directory, created, runner } = await bench()
  const started = await runner.startExternal({ projectId: created.id, expectedRevision: created.revision, prompt: "打倒它会掉甲壳", plan: { summary: "甲壳", questions: [], tasks: [{ key: "shell", module: "item", title: SHELL, prompt: "甲虫蜕下的壳", source: "掉甲壳", dependencies: [], target_id: null }] } })
  const ids = { projectId: created.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
  const assetId = started.run.tasks[0]!.asset_id
  await runner.claimExternalTask(ids)
  await runner.describeExternalTask({ ...ids, sheet })
  await runner.lookExternalTask({ ...ids, document: shell(HOOK) })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  // It reads as a specific other thing: the reviewer writes `passed: true` and `fits: "no"`, and Studio records a failure with its own finding.
  await runner.finalReviewExternalTask({ ...ids, blind: { sees: "金色硬币", also: [], because: "一个金黄色的圆片" } })
  const taken = (await runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], independent: true, fits: "no" } })) as { review: { passed: boolean; findings: string[] } }
  expect(taken.review).toMatchObject({ passed: false, findings: [blindFinding(SHELL, { sees: "金色硬币", also: [], because: "一个金黄色的圆片" })] })
  expect(await words(runner.commitExternalTask({ ...ids, document: shell(HOOK) }))).toContain(REFUSALS.review_failed)
  // The next picture cannot be named by a stranger either, but with its name it plainly is the thing: that passes.
  await runner.lookExternalTask({ ...ids, document: shell(second()) })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  const packet = (await runner.finalReviewExternalTask({ ...ids, blind: pebble })) as unknown as { answer_schema: { properties: { fits: { enum: string[] } } } }
  expect(packet.answer_schema.properties.fits.enum).toEqual(["at_once", "with_name", "no"])
  const fitted = (await runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], advice: ["横纹在小一号的格子里有点糊"], independent: true, fits: "with_name" } })) as { review: { passed: boolean; findings: string[]; advice: string[] } }
  expect(fitted.review).toMatchObject({ passed: true, findings: [], advice: [blindAdvice(SHELL, pebble), "横纹在小一号的格子里有点糊"] })
  expect(await words(runner.commitExternalTask({ ...ids, document: shell(second()) }))).toBe("accepted")
  const record = (await readMaking(directory, assetId))!
  expect(record).toMatchObject({ state: "done", outcome: "passed", review: { passed: true, blind: { said: "一块鹅卵石", recognised: true, fits: "with_name", named: SHELL } } })
  expect((await shownMaking(directory, record)).review!.blind).toMatchObject({ tested: true, recognised: true, fits: "with_name", words: "盲认：只给图、不说这是什么，评审说它是「一块鹅卵石」（还可能是「贝壳」）；告诉它名字以后，它说看得出是「砂岩甲壳」，不会被当成别的。" })
})

test("Studio 自己的 AI，审查开着：评审答 with_name 的那一版就交，不再一版一版退回去", async () => {
  const fake = provider({ blind: () => pebble, review: () => judged("with_name") })
  const { directory, created, runner } = await bench(fake.ai)
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: PROMPT, module: "item" })).id)
  expect(run.state).toBe("completed")
  expect(fake.sent.filter((call) => call.kind === "blind")).toHaveLength(1)
  // What the reviewer is asked to answer: the three, not a yes or no.
  const record = (await readMaking(directory, (await openProject(directory)).workspace.assets[0]!.id))!
  expect(record).toMatchObject({ state: "done", outcome: "passed", review: { passed: true, findings: [], blind: { said: "一块鹅卵石", recognised: true, fits: "with_name" } } })
  expect(record.review!.advice![0]).toBe(blindAdvice(run.tasks[0]!.title, pebble))
})

test("审查关着：做它的 AI 知道自己画的是什么，认不了；不问、不装，记录里写未盲认", async () => {
  const { directory, runner, claim } = await bench({ review: false })
  const { ids, assetId } = await claim()
  await runner.describeExternalTask({ ...ids, sheet })
  await runner.lookExternalTask({ ...ids, document: item(HOOK) })
  expect(((await runner.selfReviewExternalTask({ ...ids, ...done })) as { next_step: string }).next_step).toContain("用 final_review（不带 verdict）取验收材料")
  // The material comes at once, as it always did; a blind answer offered all the same is refused in words, not taken.
  const packet = (await runner.finalReviewExternalTask(ids)) as { instructions: string; input: Record<string, unknown>; blind_named: boolean }
  expect(packet).toMatchObject({ instructions: REVIEWER_INSTRUCTIONS, blind_named: false })
  expect("blind" in packet.input).toBe(false)
  expect(await words(runner.finalReviewExternalTask({ ...ids, blind: { sees: "镐", also: [], because: "我画的就是镐" } }))).toBe(REFUSALS.blind_needs_review)
  await runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], independent: false, recognised: true } })
  expect(await words(runner.commitExternalTask({ ...ids, document: item(HOOK) }))).toBe("accepted")
  const record = (await readMaking(directory, assetId))!
  // `recognised` from someone who was never asked blind is not kept: the record says it was not done.
  expect(record.review).toMatchObject({ passed: true, independent: false, blind: null })
  expect(record.rounds.every((round) => round.blind === undefined)).toBe(true)
  expect((await shownMaking(directory, record)).review!.blind).toEqual({ tested: false, words: blindPlain(null) })
  expect(blindPlain(null)).toContain(BLIND_WORDS.untested)
})

type Sent = { kind: "sheet" | "make" | "self" | "blind" | "review"; instructions: string; input: Record<string, unknown>; images: string[] }

/** A stand-in for the AI service that tells the five kinds of request apart by their instructions. */
function provider(script: { blind: (round: number) => unknown; review: (round: number) => unknown }) {
  const sent: Sent[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const body = JSON.parse(await request.text()) as { model?: string; instructions: string; input: { content: { type: string; text?: string; image_url?: string }[] }[] }
      const content = body.input[0]!.content
      // 边做边看: shown a glance of what it has just written, this maker keeps it. Not one of the kinds of request counted here.
      if (body.instructions.endsWith(OWN_GLANCE_INSTRUCTIONS)) return Response.json({ model: body.model ?? "gpt-6-astra", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ keep: true, revised: null }) }] }] })
      const kind = body.instructions === SHEET_INSTRUCTIONS ? "sheet" : body.instructions === SELF_REVIEW_INSTRUCTIONS ? "self" : body.instructions === BLIND_INSTRUCTIONS ? "blind" : body.instructions.startsWith(REVIEWER_INSTRUCTIONS) ? "review" : "make"
      sent.push({ kind, instructions: body.instructions, input: JSON.parse(content[0]!.text!) as Record<string, unknown>, images: content.slice(1).map((part) => part.image_url ?? "") })
      const count = sent.filter((value) => value.kind === kind).length
      // Every version is the icon with one more pixel filled in along its top row: a different document each time.
      const version = () => ((image) => (Array.from({ length: count }, (_, index) => image.pixels.set([37, 49, 59, 255], index * 4)), item(png(image))))(stormPick())
      const value = kind === "sheet" ? sheet : kind === "self" ? { ...done, advice: [], look_closer: null, watch: null, declare: null } : kind === "blind" ? script.blind(count) : kind === "review" ? script.review(count) : version()
      return Response.json({ model: body.model ?? "gpt-6-astra", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(value) }] }] })
    },
  })
  closers.push(() => server.stop(true))
  return { sent, ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1` } }
}

async function terminal(runner: ReturnType<typeof createProjectRunner>, projectId: string, runId: string) {
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    const run = await runner.get({ projectId, runId })
    if (["completed", "partial", "canceled", "failed", "interrupted"].includes(run.state)) return run
    await Bun.sleep(10)
  }
  throw new Error("runner did not finish")
}

const hook = { sees: "钩子", also: ["镰刀"], because: "灰色的头只朝一边弯下去" }
const judged = (recognised: boolean | "with_name") => ({ passed: true, findings: [], advice: [], need: [], fits: recognised === true ? "at_once" : recognised === false ? "no" : recognised })

test("Studio 自己的 AI，审查开着：盲认是单独的一次请求，里面只有图；认成了别的就带着这一条再改一版，认出来了才交", async () => {
  const fake = provider({ blind: (round) => (round === 1 ? hook : { sees: "镐", also: [], because: "弧形的头横在柄顶上" }), review: (round) => judged(round > 1) })
  const { directory, created, runner } = await bench(fake.ai)
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: PROMPT, module: "item" })).id)
  expect(run.state).toBe("completed")
  expect(fake.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self", "blind", "review", "make", "self", "blind", "review"])
  // The blind request: what kind of picture it is and the names of its cells, with the one picture. Nothing of the thing, and nothing of its making.
  const blind = fake.sent.find((call) => call.kind === "blind")!
  expect(blind.input).toEqual({ showing: BLIND_SHOWN.item, pictures: [BLIND_SHEET] })
  expect(blind.images).toHaveLength(1)
  expect(JSON.stringify([blind.instructions, blind.input])).not.toMatch(TELLS)
  // The review that follows holds what was said, and the rule for judging it.
  const review = fake.sent.find((call) => call.kind === "review")!
  expect(review.input.blind).toEqual(hook)
  expect(review.instructions).toBe(`${REVIEWER_INSTRUCTIONS}${BLIND_REVIEW_RULE}`)
  // The maker's next version is asked for with the miss as what the reviewer holds against the last one, although the reviewer itself listed nothing.
  const revision = (fake.sent.filter((call) => call.kind === "make")[1]!.input as { revision_required: { reviewer_findings: string[] } }).revision_required
  expect(revision.reviewer_findings).toEqual([blindFinding(run.tasks[0]!.title, hook)])
  const record = (await readMaking(directory, (await openProject(directory)).workspace.assets[0]!.id))!
  expect(record).toMatchObject({ state: "done", outcome: "passed", review: { passed: true, independent: true, blind: { said: "镐", recognised: true } } })
  expect(record.rounds.map((round) => round.blind?.sees)).toEqual(["钩子", "镐"])
})

test("Studio 自己的 AI：一直认不出来，任务也不算失败——最好的一版留给人，标着 AI 还不满意，原因里写着当时认成了什么；审查关着就没有这一问", async () => {
  const fake = provider({ blind: () => hook, review: () => judged(false) })
  const { directory, created, runner } = await bench(fake.ai)
  const run = await terminal(runner, created.id, (await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: PROMPT, module: "item" })).id)
  expect(run.tasks[0]!.state).not.toBe("failed")
  expect(run.tasks[0]!.detail).toContain(UNSATISFIED.mark)
  expect(fake.sent.filter((call) => call.kind === "blind")).toHaveLength(MAKING_LIMITS.rounds)
  const record = (await readMaking(directory, (await openProject(directory)).workspace.assets[0]!.id))!
  expect(record).toMatchObject({ state: "done", outcome: "kept_unsatisfied", stopped_reason: "review", review: { passed: false, blind: { said: "钩子", recognised: false } } })
  expect(record.kept_reason!.find((line) => line.includes(BLIND_WORDS.name))).toStartWith("评审认为必须改：认得出：盲认没有认出来——只给图、不说这是什么的时候，评审说它是「钩子」")
  expect((await openProject(directory)).workspace.assets).toHaveLength(1)

  // Off: three requests, none of them blind and none a review; the record says so.
  const alone = provider({ blind: () => ({ sees: "不该有人来问我", also: [], because: "" }), review: () => judged(false) })
  const off = await bench({ ...alone.ai, review: false })
  expect((await terminal(off.runner, off.created.id, (await off.runner.start({ projectId: off.created.id, expectedRevision: off.created.revision, prompt: PROMPT, module: "item" })).id)).state).toBe("completed")
  expect(alone.sent.map((call) => call.kind)).toEqual(["sheet", "make", "self"])
  expect((await readMaking(off.directory, (await openProject(off.directory)).workspace.assets[0]!.id))!.review).toMatchObject({ passed: true, independent: false, blind: null })
})

test("盲认的图：交出去的只是图片本身，没有文件名、路径或标题；工程里存下的图，文件名只有轮次、时间和序号", async () => {
  const { directory, created, runner, claim } = await bench()
  const { ids, assetId } = await claim()
  await runner.describeExternalTask({ ...ids, sheet })
  await runner.lookExternalTask({ ...ids, document: item(HOOK) })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  const handed = pictured(await runner.nextInspection({ projectId: created.id, wait_seconds: 0 }))
  // What the reviewer is given, as MCP content: the words (labels in place of pictures) and the pictures, which carry data and a type and nothing else.
  expect(handed.content.map((part) => part.type)).toEqual(["text", "image"])
  expect(Object.keys(handed.content[1]!).sort()).toEqual(["data", "mimeType", "type"])
  expect(JSON.stringify(handed)).not.toMatch(TELLS)
  expect(JSON.parse((handed.content[0] as { text: string }).text).pictures).toEqual([BLIND_SHEET])
  // The pictures kept in the project, which a reviewer that can read the disk could be pointed at, are named by where they come from, never by what they show.
  const folder = path.join(directory, ".minemods", "making", assetId)
  const files = (await readdir(folder)).filter((name) => /\.(png|jpg)$/.test(name))
  expect(files.length).toBeGreaterThan(0)
  files.forEach((name) => expect(name).toMatch(/^\d+[a-z]?-[a-z0-9]+-\d+\.(png|jpg)$/))
  expect(folder).not.toMatch(TELLS)
  // A label with a name in it (a part, a creature) does not reach the file name.
  const named = await writePictures(directory, assetId, 2, [{ label: "cow_model 正面", url: PIXEL }, { label: "guard_model spear", url: PIXEL }], "r")
  expect(named).toHaveLength(2)
  named.forEach((picture) => expect(picture.file).toMatch(/^2r-[a-z0-9]+-\d+\.png$/))
})

test("说给 AI 的话：做的人从第一版就知道有盲认、知道它不收理由；审查的人知道先只说图上看到的；哪一句里都没有一样具体的东西", () => {
  expect(MAKING_DISCIPLINE).toContain(`验收时还有一道「${BLIND_WORDS.name}」`)
  expect(MAKING_DISCIPLINE).toContain(BLIND_WORDS.gate)
  expect(MAKING_DISCIPLINE).toContain(`记录里会如实写「${BLIND_WORDS.untested}」`)
  const configuration = JSON.stringify({ mcpServers: { "minemods-studio": { command: "studio.exe", args: ["mcp-stdio.js"] } } })
  const reviewer = buildMcpReviewHandoff({ configuration })
  // Round 18: the project's name says what the mod is about; a reviewer that is to name things blind is given the id and nothing else of it.
  const projected = buildMcpReviewHandoff({ configuration, project: { id: "ac2413fa-0bcd-4971-a634-6e17e3921703", name: "风暴山巅 第八轮原创首领", revision: 4 } })
  expect(projected).toContain("ac2413fa-0bcd-4971-a634-6e17e3921703")
  expect(projected).not.toMatch(/风暴|首领|"name"|revision/)
  for (const phrase of ["blind_first", "blind: { sees, also, because }", "不要去查工程里有什么东西", "fits", `只有 "no" 这一版不通过`, BLIND_WORDS.gate]) expect(reviewer).toContain(phrase)
  expect(everythingToRead({ configuration, review: true })).toContain(BLIND_WORDS.gate)
  expect(MCP_TOOLS.find((tool) => tool[0] === "final_review")!.join(" ")).toContain("blind?: { sees, also: string[], because }")
  expect(MCP_TOOLS.find((tool) => tool[0] === "next_inspection")!.join(" ")).toContain("blind_first")
  // The rule and the question are general: no thing is named in them, not even as an example.
  for (const text of [BLIND_INSTRUCTIONS, BLIND_REVIEW_RULE, INSPECTION_WORDS.blind, INSPECTION_WORDS.unblinded, REFUSALS.no_blind]) expect(text).not.toMatch(/镐|剑|斧|锄|铲|钩|镰|矿|石像|pickaxe|sword|hook/)
})
