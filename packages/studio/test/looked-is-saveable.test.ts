import { samples } from "../../mod-core/script/target-particle-sample"
import { afterEach, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import * as files from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createProject, openProject, ProjectRecordBusyError, saveProject } from "@minemods/mod-core/project"
import { blueprintSource } from "@minemods/mod-core/task-source"
import { loadModelAsset } from "@minemods/mod-core/assets"
import { compileSavedModel } from "@minemods/mod-core/editable-model"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { ANIMATION_LIMITS, bakedCounts } from "@minemods/studio-ai/animation"
import { CARRIED } from "@minemods/studio-ai/making"
import { ABILITY_MAKER_INSTRUCTIONS, ABILITY_REVIEW_GUIDE, ABILITY_REVIEWER_INSTRUCTIONS, ABILITY_SELF_REVIEW_INSTRUCTIONS, HIT_PICTURE_WORDS, MAKING_LIMITS, OWN_GLANCE_INSTRUCTIONS, readMaking, REFUSALS, REVIEWER_HANDOFF, UNSATISFIED } from "@minemods/mod-core/making"
import { TIER_UNUSED } from "@minemods/studio-ai/budget"
import { TEXTURE_SPACE_ERROR } from "@minemods/studio-ai/model-paint"
import { EffectDocumentSchema, effectName } from "@minemods/mod-core/effect"
import { effectBuildFault } from "@minemods/mod-core/effect-build"
import { compileEffects } from "@minemods/mod-core/fabric/effect"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { createProjectRunner } from "../src/main/project-runner"
import { abilityMoments, lookJob, needJob, reviewJob, type LookJob, type LookRenderer } from "../src/main/look-job"
import { everythingToRead } from "./handoff-reading"
import { getMcpCapabilities } from "../src/main/mcp-capabilities"
import { createDataGameplaySample, golemEffects } from "../../mod-core/script/data-gameplay-sample"
import slime from "../../studio-ai/test/fixtures/look/good/sprout-slime.json"

/**
 * Round 10 (J1): the making loop must not betray a version it showed. What was looked at can be saved; a
 * creature with abilities is reviewed like everything else; a strip of a motion an ability plays shows the
 * moments that ability is read by; a tier that is not used has to be answered.
 */

const directories: string[] = []
const closers: (() => unknown)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const good = { kind: "model" as const, ...ModelDesignSchema.parse(slime.model) }
const sheet = {
  subject: "一团会弹的凝胶生物。",
  recognisable: ["圆滚滚的身体", "头顶一株嫩芽"],
  parts: [{ name: "body", what: "身体", shape: "圆角方块，约 12×10×12 像素", attaches: "直接落在地上", surface: "半透明的绿色凝胶", moves: "一压一弹", assumed: false }],
  assumed: [],
}
const done = { matches: ["和说明一致"], problems: [], next: [], verdict: "done" as const }
const words = (step: Promise<unknown>) => step.then(() => "accepted", (error: Error) => error.message)

function renderer() {
  const jobs: LookJob[] = []
  const look: LookRenderer = async (job) => {
    jobs.push(job)
    return { ok: true, pictures: job.sheets.map((value) => ({ label: value.label, url: PIXEL })) }
  }
  return { jobs, look }
}

async function runnerFor(directory: string, look?: LookRenderer) {
  const runner = createProjectRunner({ directoryFor: async () => directory, ai: {}, look, sees: async () => "yes" })
  closers.push(() => runner.dispose())
  return runner
}

async function folder() {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-round10-"))
  directories.push(root)
  return path.join(root, "project")
}

/** One task claimed by an outside AI, on a project that exists. */
async function claimed(runner: Awaited<ReturnType<typeof runnerFor>>, project: { id: string; revision: number }, module: "model" | "entity" | "effect" | "particle", target: string | null = null) {
  const started = await runner.startExternal({
    projectId: project.id,
    expectedRevision: project.revision,
    prompt: "一只守着矿石的敌对生物",
    plan: { summary: "守卫", questions: [], tasks: [{ key: "guardian", module, title: "洞穴守卫", prompt: "守着矿石的敌对生物", source: "守着矿石的敌对生物", dependencies: [], target_id: target }] },
  })
  const ids = { projectId: project.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
  return { ids, assetId: started.run.tasks[0]!.asset_id, context: await runner.claimExternalTask(ids) }
}

test("粒子要看图和自评，做完直接提交；关掉开关可以直接交",async()=>{
  for(const enabled of [true,false]) {
    const directory=await folder()
    const project=await createProject({directory,name:"粒子工作室",description:""})
    const runner=createProjectRunner({directoryFor:async()=>directory,ai:{particleLook:enabled},look:renderer().look,sees:async()=>"yes"})
    closers.push(()=>runner.dispose())
    const {ids}=await claimed(runner,project,"particle")
    const document=samples[2]!
    if(enabled){
      expect(await words(runner.commitExternalTask({...ids,document}))).toContain(REFUSALS.no_look)
      const shown=await runner.lookExternalTask({...ids,document})
      expect(shown.pictures).toHaveLength(3)
      expect(await words(runner.commitExternalTask({...ids,document}))).toContain(REFUSALS.no_self_review(1))
      const finished=await runner.selfReviewExternalTask({...ids,...done})
      expect(finished.next_step).toContain("commit_task")
    }
    expect(await words(runner.commitExternalTask({...ids,document}))).toBe("accepted")
  }
})

// Turned about the upright axis, so nothing sinks into the ground or through anything: only the number of exported keys is at stake.
const smooth = (y: number, time: number) => ({ time, rotation: [0, y, 0] as [number, number, number], interpolation: "smooth" as const })
/** The slime with one more motion on its first bone: `keys` smooth keys of a wide arc. */
const swinging = (name: string, keys: ReturnType<typeof smooth>[]) => ({ ...good, name, animations: [...good.animations, { name: "slam", length: Math.max(1.8, keys.at(-1)!.time), loop: false, channels: [{ bone: good.bones[0]!.name, keyframes: keys }] }] })

test("看过的就存得进去：六个 smooth 关键帧导出成六十多个点的模型，看图、自评、验收之后照样提交成功", async () => {
  const directory = await folder()
  const created = await createProject({ directory, name: "看过的就存得进去", description: "" })
  const hidden = renderer()
  const runner = await runnerFor(directory, hidden.look)
  const { ids, assetId } = await claimed(runner, created, "model")
  const swung = swinging("挥臂", [smooth(0, 0), smooth(-120, 0.45), smooth(-130, 0.65), smooth(-46, 0.8), smooth(0, 0.9), smooth(0, 1.8)])
  const exported = bakedCounts(swung.animations).longest!
  expect(exported).toMatchObject({ clip: "slam", written: 6, widened: 1, over: false })
  expect(exported.baked).toBeGreaterThan(ANIMATION_LIMITS.keys)
  await runner.describeExternalTask({ ...ids, sheet })
  const shown = (await runner.lookExternalTask({ ...ids, document: swung })) as { findings: string[]; budget_facts: string[] }
  // Nothing about saving is held against it at the look, and the exported count is said as a fact beside the budget.
  expect(shown.findings.filter((line) => line.includes("存不进工程"))).toEqual([])
  // The structure facts sit alongside the existing flat-paint and baked-track measurements.
  expect(shown.budget_facts).toHaveLength(4)
  expect(shown.budget_facts[2]).toStartWith("贴图量出来的平涂占比")
  expect(shown.budget_facts[3]).toStartWith("模型结构：")
  expect(shown.budget_facts[1]).toContain(`你写了 6 个关键帧）有 ${exported.baked} 个点（导出的上限 480）`)
  // A draft of it says nothing is in the way either.
  expect((await runner.updateExternalTask({ ...ids, draft: swung })).drafts[ids.taskId]?.unsaveable).toBeUndefined()
  // Whatever the standard thinks of the swing itself, the save is not what stands in its way: the version is the best so far when the standard passes it.
  expect(shown.findings).toEqual([])
  await runner.selfReviewExternalTask({ ...ids, ...done })
  const review = await runner.finalReviewExternalTask(ids)
  expect(review).toMatchObject({
    instructions: expect.stringContaining("结构数字只是事实，不是通过或不通过的理由"),
    input: { budget_facts: expect.arrayContaining([expect.stringContaining("模型结构：")]) },
  })
  await runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], independent: true } })
  expect(await words(runner.commitExternalTask({ ...ids, document: swung }))).toBe("accepted")
  const run = await runner.get({ projectId: created.id, runId: ids.runId })
  expect(run.tasks[0]).toMatchObject({ state: "completed", error: null })
  // What was saved exports the curve whole, and the document keeps the six keys that were written.
  const project = await openProject(directory)
  const saved = await loadModelAsset(directory, project.entities.find((entity) => entity.id === assetId)!.model_asset_id!)
  const compiled = compileSavedModel(saved.data, "creature")
  const track = compiled.animation.animations["animation.creature.slam"]!.bones[good.bones[0]!.name]!.rotation!
  expect(Object.keys(track)).toHaveLength(exported.baked)
  expect(compiled.design.animations.find((motion) => motion.name === "slam")!.channels[0]!.keyframes).toHaveLength(6)
})

test("存不进去的版本在看图时就说，用的是提交会说的同一句话；它不算留给人的那一版，提交被拒也不让任务失败", async () => {
  const directory = await folder()
  const created = await createProject({ directory, name: "存不进去", description: "" })
  const runner = await runnerFor(directory, renderer().look)
  const { ids, assetId } = await claimed(runner, created, "model")
  const wild = swinging("乱转", Array.from({ length: 60 }, (_, index) => smooth(index % 2 ? 180 : -180, index / 10)))
  const reason = bakedCounts(wild.animations).faults.join("")
  expect(reason).toContain("导出的一条轨道最多 480 个")
  await runner.describeExternalTask({ ...ids, sheet })
  const shown = (await runner.lookExternalTask({ ...ids, document: wild })) as { findings: string[] }
  expect(shown.findings).toContain(REFUSALS.unsaveable(reason))
  // A draft says the same; a version that cannot be saved is never the one kept for the person.
  expect((await runner.updateExternalTask({ ...ids, draft: wild })).drafts[ids.taskId]?.unsaveable).toBe(REFUSALS.unsaveable(reason))
  expect((await readMaking(directory, assetId))!.best ?? null).toBeNull()
  expect(await words(runner.selfReviewExternalTask({ ...ids, ...done }))).toContain(REFUSALS.unsaveable(reason))
  // The task is still open for another version.
  expect((await runner.get({ projectId: created.id, runId: ids.runId })).tasks[0]!.state).toBe("running")
})

/** The sample whose golem fights with two abilities that show effects, with its documents. */
async function fighting() {
  const directory = await folder()
  const project = await createDataGameplaySample(directory, { life: true, abilities: true, effects: true })
  const of = <Kind extends ModuleDocument["kind"]>(kind: Kind) => project.workspace.assets.flatMap((asset) => (asset.document.kind === kind ? [{ id: asset.id, document: asset.document as Extract<ModuleDocument, { kind: Kind }> }] : []))[0]!
  return { directory, project, creature: of("entity"), model: of("model") }
}

test("生物审查能看到它的招式用到的粒子三张图，重复引用只画一次", async () => {
  const {directory, project, creature} = await fighting()
  const id = "a5034e44-cdeb-469a-8092-9e20604bd8d4"
  const particle = samples[0]!
  const base = project.workspace.assets[0]!
  const updated = await saveProject(directory, {...project, workspace: {...project.workspace,
    assets: [...project.workspace.assets.map(asset => asset.id === creature.id ? {...asset, dependencies: [...asset.dependencies, id]} : asset), {...base,id,module:"particle",title:"炉火余烬",document:particle,dependencies:[]}]
  }}, project.revision)
  const document = {...creature.document, abilities: creature.document.abilities!.map(ability => ({
    ...ability, events: ability.events.map(event => event.type==="particle" ? {...event, particle:{asset:id}} : event)
  }))}
  const runner = await runnerFor(directory, renderer().look)
  const {ids} = await claimed(runner, updated, "entity", creature.id)
  await runner.lookExternalTask({...ids,document})
  await runner.selfReviewExternalTask({...ids,...done})
  const packet = await runner.finalReviewExternalTask(ids) as {pictures:{label:string}[]}
  const expected = lookJob(particle,null).job.sheets.map(sheet=>sheet.label)
  expect(packet.pictures.map(pic=>pic.label).filter(label=>expected.includes(label))).toEqual(expected)
}, 120000)

test("有招式的生物和别的东西一样验收：不写部件说明，look → self_review → final_review → commit_task；评审没通过记在案，留下的那一版标明 AI 还不满意", async () => {
  const { directory, project, creature } = await fighting()
  const hidden = renderer()
  const runner = await runnerFor(directory, hidden.look)
  const { ids, assetId, context } = await claimed(runner, project, "entity", creature.id)
  // The claim says how a creature with abilities is reviewed; nothing asks for a part sheet.
  expect(context.making).toEqual({ discipline: ABILITY_REVIEW_GUIDE, sheet: null, remark: null, rounds_allowed: MAKING_LIMITS.rounds, next_step: "做出文档。abilities 不是空的，或者写了 hitbox：先用 look 看它的招式和碰撞箱，再 self_review、final_review，通过以后 commit_task。两样都没有：直接 commit_task；它的模型用老办法的一个方箱子量出来不合身时，提交会要你先 look，照做。" })
  const kept = "任务保持运行，工程里什么都没有改动。"
  const unlooked = "这只生物在这个任务里还没有用 look 看过。生物不写部件说明（不用 save_sheet）：文档里 abilities 不是空的，或者写了 hitbox，就先 look 看它的招式和碰撞箱，再 self_review、final_review，通过以后 commit_task；两样都没有的不看图，做好以后直接 commit_task——只是它的模型用老办法的一个方箱子量出来不合身时，提交会要你先 look，照做。"
  expect(await words(runner.selfReviewExternalTask({ ...ids, ...done }))).toBe(unlooked)
  expect(await words(runner.finalReviewExternalTask(ids))).toBe(unlooked)
  expect(await words(runner.describeExternalTask({ ...ids, sheet }))).toBe(unlooked)
  // Handed in without a look: refused, and the task stays open.
  expect(await words(runner.commitExternalTask({ ...ids, document: creature.document }))).toBe(`${REFUSALS.no_look}${kept}`)

  const first = (await runner.lookExternalTask({ ...ids, document: creature.document })) as { round: number; state: string; next_step: string; pictures: { label: string }[]; findings: string[]; notes: string[] }
  expect(first).toMatchObject({ round: 1, state: "making", rounds_allowed: MAKING_LIMITS.rounds })
  expect(first.next_step).toContain("用 self_review 写自评")
  expect(first.pictures.length).toBeGreaterThan(0)
  expect(first.pictures.length).toBeLessThanOrEqual(MAKING_LIMITS.sheets)
  expect(first.pictures.every((picture) => picture.label.startsWith("招式「"))).toBe(true)
  expect(first.notes).toContain(HIT_PICTURE_WORDS)
  expect(first.findings).toEqual([])
  // A sheet is still not taken once it is in the loop, and the hand-in asks for each step in turn.
  expect(await words(runner.describeExternalTask({ ...ids, sheet }))).toBe(REFUSALS.no_sheet_wanted)
  expect(await words(runner.commitExternalTask({ ...ids, document: creature.document }))).toBe(`${REFUSALS.no_self_review(1)}${kept}`)
  expect(await runner.selfReviewExternalTask({ ...ids, ...done })).toMatchObject({ state: "reviewing", next_step: expect.stringContaining("final_review") })
  expect(await words(runner.commitExternalTask({ ...ids, document: creature.document }))).toBe(`${REFUSALS.no_review}${kept}`)

  // What the reviewer is given: what is judged and what is not, the brief, every ability in words, what was measured, and a whole set of pictures; no part sheet.
  const packet = (await runner.finalReviewExternalTask(ids)) as { instructions: string; input: Record<string, unknown>; pictures: { label: string }[]; how: string }
  expect(packet.instructions).toBe(ABILITY_REVIEWER_INSTRUCTIONS)
  expect(packet.how).toBe(REVIEWER_HANDOFF)
  expect(Object.keys(packet.input).sort()).toEqual(["abilities", "ability_facts", "brief", "criteria", "judging", "not_judged", "request"])
  expect(packet.input.judging).toBe("「洞穴守卫」的招式放出来的样子：每个招式判定的那一刻，它的动作、判定范围和它放出的效果对不对得上，玩家看不看得出它要出手、看不看得出是哪一刻打到的。")
  expect(packet.input.abilities).toEqual(creature.document.abilities!.map((ability) => expect.stringContaining(`招式「${ability.name}」（id ${ability.id}，播动作 ${ability.clip}）：`)))
  expect(packet.input.ability_facts).toEqual(expect.arrayContaining([HIT_PICTURE_WORDS, expect.stringContaining("判定的那一刻")]))
  // Every ability is in the set: with its effects and alone.
  expect(packet.pictures.map((picture) => picture.label)).toEqual(creature.document.abilities!.flatMap((ability) => [expect.stringContaining(`招式「${ability.name}」· 和效果一起`), expect.stringContaining(`招式「${ability.name}」· 只看生物的动作`)]))
  // The reviewer may ask to see a motion of its model again: it is shown at the moments the ability is read by.
  const slam = creature.document.abilities![0]!
  const more = (await runner.finalReviewExternalTask({ ...ids, need: [{ what: "motion", name: slam.clip }] })) as { pictures: { label: string }[] }
  expect(more.pictures).toHaveLength(1)
  expect(hidden.jobs.at(-1)!.sheets[0]!.cells.flatMap((cell) => (cell.kind === "view" ? [cell.time] : []))).toContain(slam.hits[0]!.at)

  // "Not passed" is recorded against this version, and is what the person is shown when the maker stops here.
  const refused = "朝高处的目标出手时，看得见的效果和实际判定的线对不上"
  expect(await runner.finalReviewExternalTask({ ...ids, verdict: { passed: false, findings: [refused], advice: ["蓄力可以再明显一些"], independent: true } })).toMatchObject({ review: { passed: false, findings: [refused], independent: true }, state: "making" })
  expect(await words(runner.commitExternalTask({ ...ids, document: creature.document }))).toBe(`${REFUSALS.review_failed}${kept}`)
  const ended = await runner.failExternalTask({ ...ids, error: "契约现在做不到让效果跟着仰角" })
  expect(ended.tasks[0]).toMatchObject({ state: "completed", outcome: "kept_unsatisfied" })
  expect(ended.tasks[0]!.detail).toContain(UNSATISFIED.mark)
  const record = (await readMaking(directory, assetId))!
  expect(record).toMatchObject({ kind: "entity", sheetless: true, sheet: null, state: "done", outcome: "kept_unsatisfied", kept_round: 1, review: { passed: false, findings: [refused] } })
  expect(record.kept_reason).toEqual(["停下的原因：契约现在做不到让效果跟着仰角", `评审认为必须改：${refused}`, "评审认为可以更好：蓄力可以再明显一些"])
  expect(record.rounds[0]!.review_pictures!.length).toBe(packet.pictures.length + 1)
})

test("有招式的生物：改一版、验收通过、提交；没有招式的生物照旧直接提交，什么记录都不留", async () => {
  const { directory, project, creature } = await fighting()
  const runner = await runnerFor(directory, renderer().look)
  const { ids, assetId } = await claimed(runner, project, "entity", creature.id)
  const renamed = { ...creature.document, description: "守着蓝晶矿的石头傀儡，出手前会先举起双臂。" }
  await runner.lookExternalTask({ ...ids, document: renamed })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  await runner.finalReviewExternalTask(ids)
  await runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], advice: [], independent: true } })
  // The version handed in must be the one looked at.
  expect(await words(runner.commitExternalTask({ ...ids, document: creature.document }))).toContain(REFUSALS.unseen)
  expect(await words(runner.commitExternalTask({ ...ids, document: renamed }))).toBe("accepted")
  expect(await readMaking(directory, assetId)).toMatchObject({ state: "done", outcome: "passed", sheetless: true, review: { passed: true, independent: true } })
  expect((await runner.get({ projectId: project.id, runId: ids.runId })).tasks[0]).toMatchObject({ state: "completed" })

  // Without abilities nothing changed: no look, no steps, a direct hand-in, and no record of a making.
  const plain = await fighting()
  const direct = await runnerFor(plain.directory, renderer().look)
  const task = await claimed(direct, plain.project, "entity", plain.creature.id)
  const bare = { ...plain.creature.document, abilities: null }
  expect(await words(direct.lookExternalTask({ ...task.ids, document: bare }))).toBe("这一类内容没有可以看的样子，不需要看图。")
  expect(await words(direct.commitExternalTask({ ...task.ids, document: bare }))).toBe("accepted")
  expect(await readMaking(plain.directory, task.assetId)).toBeNull()
  // And with no window to draw in, a creature with abilities is handed in directly as before.
  const blind = await fighting()
  const unseen = await runnerFor(blind.directory)
  const dark = await claimed(unseen, blind.project, "entity", blind.creature.id)
  expect(dark.context.making).toBeNull()
  expect(await words(unseen.commitExternalTask({ ...dark.ids, document: blind.creature.document }))).toBe("accepted")
})

type Sent = { kind: "make" | "self" | "review"; instructions: string; input: Record<string, unknown>; images: number }

/** A stand-in for the AI service: tells a self-review and a review of abilities from a request to write the creature, by their instructions. */
function provider(script: { make: (round: number) => unknown; self: (round: number) => unknown; review: (round: number) => unknown }) {
  const sent: Sent[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const body = JSON.parse(await request.text()) as { instructions: string; input: { content: { type: string; text?: string }[] }[] }
      const content = body.input[0]!.content
      // 边做边看: shown a glance of the creature it has just written, this maker keeps it. Not one of the kinds of request counted here.
      if (body.instructions.endsWith(OWN_GLANCE_INSTRUCTIONS)) return Response.json({ model: "gpt-6-astra", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ keep: true, revised: null }) }] }] })
      const kind = body.instructions === ABILITY_SELF_REVIEW_INSTRUCTIONS ? "self" : body.instructions.startsWith(ABILITY_REVIEWER_INSTRUCTIONS) ? "review" : "make"
      sent.push({ kind, instructions: body.instructions, input: JSON.parse(content[0]!.text!) as Record<string, unknown>, images: content.length - 1 })
      const value = script[kind](sent.filter((call) => call.kind === kind).length)
      return Response.json({ model: "gpt-6-astra", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(value) }] }] })
    },
  })
  closers.push(() => server.stop(true))
  return { sent, ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1` } }
}

async function finished(runner: ReturnType<typeof createProjectRunner>, projectId: string, runId: string) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const run = await runner.get({ projectId, runId })
    if (["completed", "partial", "canceled", "failed", "interrupted"].includes(run.state)) return run
    await Bun.sleep(10)
  }
  throw new Error("runner did not finish")
}

test("Studio 自己的 AI 做有招式的生物走同一个流程：看招式的图自评，评审没通过就带着意见再改一版；没有招式的照旧只问一次、直接保存", async () => {
  const { directory, project, creature } = await fighting()
  const second = { ...creature.document, description: "守着蓝晶矿的石头傀儡，出手前先举起双臂。" }
  const guided = { ...done, advice: [], look_closer: null, watch: null, declare: null }
  const fake = provider({
    make: (round) => (round === 1 ? creature.document : second),
    self: () => guided,
    review: (round) => (round === 1 ? { passed: false, findings: ["判定的那一刻手臂还举在半空"], advice: [], need: [] } : { passed: true, findings: [], advice: ["收招可以再快一点"], need: [] }),
  })
  const runner = createProjectRunner({ directoryFor: async () => directory, ai: fake.ai, look: renderer().look, sees: async () => "yes" })
  closers.push(() => runner.dispose())
  const run = await finished(runner, project.id, (await runner.start({ projectId: project.id, expectedRevision: project.revision, prompt: "让晶石傀儡的招式看得出来", module: "entity", assetId: creature.id })).id)
  expect(run.tasks[0]).toMatchObject({ state: "completed", error: null })
  expect(fake.sent.map((call) => call.kind)).toEqual(["make", "self", "review", "make", "self", "review"])
  const [first, judged, reviewer, revised] = fake.sent
  // The first version is asked for exactly as a creature always was; only then is it known that it has abilities.
  expect(first!.instructions).not.toContain(ABILITY_MAKER_INSTRUCTIONS)
  expect(first!.images).toBe(0)
  // The self-review is shown the pictures of its abilities with its brief, its abilities and what was measured; no part sheet.
  expect(judged!.images).toBeGreaterThan(0)
  expect(Object.keys(judged!.input).sort()).toEqual(["abilities", "ability_facts", "brief", "findings", "item", "pictures", "request", "round", "rounds_allowed"])
  // The reviewer is a request of its own, with none of the making.
  expect(reviewer!.instructions).toBe(ABILITY_REVIEWER_INSTRUCTIONS)
  expect(Object.keys(reviewer!.input).sort()).toEqual(["abilities", "ability_facts", "brief", "criteria", "judging", "not_judged", "pictures", "request"])
  // A failed review sends it back for another version with what the reviewer said.
  expect(revised!.instructions).toContain(ABILITY_MAKER_INSTRUCTIONS)
  expect(revised!.input.revision_required).toMatchObject({ document: { kind: "entity" }, reviewer_findings: ["判定的那一刻手臂还举在半空"] })
  expect("part_sheet" in revised!.input).toBe(false)
  expect(revised!.images).toBeGreaterThan(0)
  expect((await openProject(directory)).workspace.assets.find((asset) => asset.id === creature.id)!.document).toMatchObject({ description: second.description })
  expect(await readMaking(directory, creature.id)).toMatchObject({ sheetless: true, state: "done", outcome: "passed", review: { passed: true, independent: true, advice: ["收招可以再快一点"] }, rounds: [{ round: 1 }, { round: 2 }] })
  expect(run.events.map((entry) => entry.message)).toEqual(expect.arrayContaining(["第 1 版：正在看渲染图。", "第 2 版：正在请没有参与制作的评审来审查。"]))
  expect(run.events.map((entry) => entry.message)).not.toContain("正在写部件说明。")

  // Without abilities: one request, the document saved, no pictures, no record.
  const plain = await fighting()
  const quiet = provider({ make: () => ({ ...plain.creature.document, abilities: null, description: "不再出招的傀儡。" }), self: () => guided, review: () => ({ passed: true, findings: [], advice: [], need: [] }) })
  const direct = createProjectRunner({ directoryFor: async () => plain.directory, ai: quiet.ai, look: renderer().look, sees: async () => "yes" })
  closers.push(() => direct.dispose())
  const settled = await finished(direct, plain.project.id, (await direct.start({ projectId: plain.project.id, expectedRevision: plain.project.revision, prompt: "让它不再出招", module: "entity", assetId: plain.creature.id })).id)
  expect(settled.tasks[0]).toMatchObject({ state: "completed", detail: expect.stringMatching(/^「.+」做好了，已经存进工程。$/) })
  expect(quiet.sent.map((call) => call.kind)).toEqual(["make"])
  expect(await readMaking(plain.directory, plain.creature.id)).toBeNull()
})

const MISFIT = "碰撞箱的箱子比身体大了一截：宽 0.6、高 0.9，视觉外伸约 0.17，空体积约 44%，头、翅膀和尾巴旁边都是空白，在碰撞箱图的第一格看出来。"
const MISFIT_AGAIN = "碰撞箱的箱子比身体大出一截：宽 0.6、高 0.9，视觉外伸约 0.15，空体积约 42%，头部、翅膀和尾巴旁边仍然是空白，在碰撞箱图的第一格看出来。"

test("同一条意见改了一版还在：审查第二次提它就不再挡住，自己审查第二次提它就算做完；不会把六版都用在它身上", async () => {
  const guided = { ...done, advice: [], look_closer: null, watch: null, declare: null }
  // The reviewer says the same of the second version as of the first.
  const { directory, project, creature } = await fighting()
  const second = { ...creature.document, description: "守着蓝晶矿的石头傀儡，出手前先举起双臂。" }
  const reviewed = provider({
    make: (round) => (round === 1 ? creature.document : second),
    self: () => guided,
    review: (round) => ({ passed: false, findings: [round === 1 ? MISFIT : MISFIT_AGAIN], advice: [], need: [] }),
  })
  const runner = createProjectRunner({ directoryFor: async () => directory, ai: reviewed.ai, look: renderer().look, sees: async () => "yes" })
  closers.push(() => runner.dispose())
  const run = await finished(runner, project.id, (await runner.start({ projectId: project.id, expectedRevision: project.revision, prompt: "让晶石傀儡的招式看得出来", module: "entity", assetId: creature.id })).id)
  expect(run.tasks[0]).toMatchObject({ state: "completed", error: null })
  expect(reviewed.sent.map((call) => call.kind)).toEqual(["make", "self", "review", "make", "self", "review"])
  expect(await readMaking(directory, creature.id)).toMatchObject({ state: "done", outcome: "passed", review: { passed: true, findings: [], advice: [`${CARRIED.reviewed}${MISFIT_AGAIN}`] } })

  // The maker's own self-review names the same problem of the second version as of the first.
  const own = await fighting()
  const third = { ...own.creature.document, description: "守着蓝晶矿的石头傀儡，出手前先举起双臂。" }
  const selfish = provider({
    make: (round) => (round === 1 ? own.creature.document : third),
    self: (round) => ({ ...guided, verdict: "revise", problems: [round === 1 ? MISFIT : MISFIT_AGAIN], next: ["把碰撞箱改小一点"] }),
    review: () => ({ passed: true, findings: [], advice: [], need: [] }),
  })
  const alone = createProjectRunner({ directoryFor: async () => own.directory, ai: selfish.ai, look: renderer().look, sees: async () => "yes" })
  closers.push(() => alone.dispose())
  const ended = await finished(alone, own.project.id, (await alone.start({ projectId: own.project.id, expectedRevision: own.project.revision, prompt: "让晶石傀儡的招式看得出来", module: "entity", assetId: own.creature.id })).id)
  expect(ended.tasks[0]).toMatchObject({ state: "completed", error: null })
  // Two versions, not six: the second said what the first did, so it is finished and goes to the reviewer.
  expect(selfish.sent.map((call) => call.kind)).toEqual(["make", "self", "make", "self", "review"])
  const record = await readMaking(own.directory, own.creature.id)
  expect(record).toMatchObject({ state: "done", outcome: "passed", rounds: [{ round: 1, self_review: { problems: [MISFIT] } }, { round: 2, self_review: { problems: [], advice: [`${CARRIED.own}${MISFIT_AGAIN}`] } }] })
})

test("招式要播的动作，逐帧图上一定有蓄力结束和每一次判定的那一刻，张数不变", async () => {
  const { creature, model } = await fighting()
  const key = abilityMoments([creature.document])
  const [slam, burst] = creature.document.abilities!
  expect(key).toEqual({ [slam!.clip]: [...new Set([slam!.windup, ...slam!.hits.map((hit) => hit.at)])].sort((a, b) => a - b), [burst!.clip]: [...new Set([burst!.windup, ...burst!.hits.map((hit) => hit.at)])].sort((a, b) => a - b) })
  expect(abilityMoments([{ abilities: null }, {}])).toEqual({})
  const times = (cells: LookJob["sheets"][number]["cells"]) => cells.flatMap((cell) => (cell.kind === "view" ? [cell.time!] : []))
  // The strip of one look: six cells as before, the key moments among them and marked.
  const strip = lookJob(model.document, null, { animation: slam!.clip }, null, null, null, null, key).job.sheets[1]!
  expect(strip.cells).toHaveLength(MAKING_LIMITS.frames)
  key[slam!.clip]!.forEach((time) => expect(times(strip.cells)).toContain(time))
  expect(strip.cells.filter((cell) => cell.label.endsWith("招式的关键一刻")).map((cell) => (cell.kind === "view" ? cell.time : null))).toEqual([...key[slam!.clip]!])
  // Without abilities known, the strip is what it always was.
  const before = lookJob(model.document, null, { animation: slam!.clip }).job.sheets[1]!
  expect(before.cells.some((cell) => cell.label.includes("招式的关键一刻"))).toBe(false)
  expect(lookJob(model.document, null, { animation: slam!.clip }, null, null, null, null, {}).job).toEqual(lookJob(model.document, null, { animation: slam!.clip }).job)
  // The reviewer's set: as many pictures as before, every key moment of every ability's motion on its strips.
  const plain = reviewJob(model.document, null)
  const keyed = reviewJob(model.document, null, null, null, null, null, key)
  expect(keyed.job.sheets.map((value) => value.label)).toEqual(plain.job.sheets.map((value) => value.label))
  for (const ability of [slam!, burst!]) {
    const shown = keyed.job.sheets.filter((value) => value.label.includes(`「${ability.clip}」`) || value.label.includes(`（${ability.clip}）`)).flatMap((value) => times(value.cells))
    key[ability.clip]!.forEach((time) => expect(shown).toContain(time))
  }
  // What a reviewer of the creature asks to see again comes at those moments too.
  const asked = needJob(creature.document, model.document, [{ what: "motion", name: burst!.clip }]).job.sheets[0]!
  key[burst!.clip]!.forEach((time) => expect(times(asked.cells)).toContain(time))
  expect(needJob(creature.document, model.document, [{ what: "angle", name: "left" }]).job.sheets[0]!.label).toBe("它的左侧（大图）")
})

test("给 AI 的话：生物有招式时怎么验收、看过的就存得进去、档位没用上要交代；没有题材，也没有数量指标", () => {
  const told = everythingToRead({ configuration: JSON.stringify({ mcpServers: { "minemods-studio": { command: "studio.exe", args: [] } } }) })
  expect(told).toContain(ABILITY_REVIEW_GUIDE)
  expect(told).toContain("看过的就存得进去")
  expect(told).toContain("drafts[taskId].unsaveable")
  expect(ABILITY_REVIEW_GUIDE).toContain("不写部件说明，不用 save_sheet")
  expect(ABILITY_REVIEW_GUIDE).toContain(HIT_PICTURE_WORDS)
  const capabilities = getMcpCapabilities("medium")
  expect(capabilities.making.creatures).toBe(ABILITY_REVIEW_GUIDE)
  expect(capabilities.making.saveable).toContain("commit_task 因此拒绝时任务保持 running，不算失败")
  // The reviewer and the maker of abilities are told what is judged and what is fact; no subject, no fixture, no number to reach.
  for (const said of [ABILITY_REVIEW_GUIDE, ABILITY_REVIEWER_INSTRUCTIONS, ABILITY_SELF_REVIEW_INSTRUCTIONS]) expect(said).not.toMatch(/傀儡|石像|巨龙|喷火|击退|冷却|重锤|晶刺|至少 \d+|不少于/)
  expect(ABILITY_REVIEWER_INSTRUCTIONS).toContain("看不到不等于没做到")
  expect(ABILITY_REVIEWER_INSTRUCTIONS).toContain("ability_facts 里以「对不上」「缺」开头的句子")
  expect(TIER_UNUSED).toBe("budget:unused")
})

/** The sample's ground mark with its first cube made one wide slab: its top and bottom are 150×150 texels each at a texel to a model pixel, which no 256 sheet (the largest an effect's tier has) holds. */
const wideMark = (change: Record<string, unknown> = {}) => {
  const mark = golemEffects.mark.document
  return EffectDocumentSchema.parse({ ...mark, ...change, bones: mark.bones.map((bone, index) => (index ? bone : { ...bone, cubes: [{ ...bone.cubes[0], origin: [-75, 0, -75], size: [150, 20, 150] }, ...bone.cubes.slice(1)] })) })
}

test("an effect that would fail the build is held back at the look, the draft and the hand-in with the build's message; written with texel_size it is built", async () => {
  const directory = await folder()
  const created = await createProject({ directory, name: "效果存得进去", description: "" })
  const runner = await runnerFor(directory, renderer().look)
  const { ids, assetId } = await claimed(runner, created, "effect")
  const wide = wideMark()
  // The very question the build asks, asked of the same document: its faces fit no texture its tier has.
  expect(effectBuildFault(wide, effectName(assetId))).toBe(TEXTURE_SPACE_ERROR)
  expect(() => compileEffects({ modId: "storm", packageName: "com.example.storm", effects: [{ id: assetId, title: "板", document: wide }] })).toThrow(TEXTURE_SPACE_ERROR)
  await runner.describeExternalTask({ ...ids, sheet })
  // The look says it as a finding, in the words the save would use, and tells why the pictures are only face colours.
  const shown = (await runner.lookExternalTask({ ...ids, document: wide })) as { findings: string[]; notes: string[] }
  expect(shown.findings).toContain(REFUSALS.unsaveable(TEXTURE_SPACE_ERROR))
  expect(shown.notes.join("\n")).toContain(`照这一版造不出这个效果：${TEXTURE_SPACE_ERROR}`)
  // A draft says the same; a version that cannot be built is never the one kept, cannot be called finished, and the task stays open.
  expect((await runner.updateExternalTask({ ...ids, draft: wide })).drafts[ids.taskId]?.unsaveable).toBe(REFUSALS.unsaveable(TEXTURE_SPACE_ERROR))
  expect((await readMaking(directory, assetId))!.best ?? null).toBeNull()
  expect(await words(runner.selfReviewExternalTask({ ...ids, ...done }))).toContain(REFUSALS.unsaveable(TEXTURE_SPACE_ERROR))
  expect(await words(runner.commitExternalTask({ ...ids, document: wide }))).not.toBe("accepted")
  expect((await runner.get({ projectId: created.id, runId: ids.runId })).tasks[0]!.state).toBe("running")
  // What the message points to works: the same effect at two model pixels to a texel looks clean, is kept, passes and is saved.
  const coarse = wideMark({ texel_size: 2 })
  const fine = (await runner.lookExternalTask({ ...ids, document: coarse })) as { findings: string[]; notes: string[] }
  expect(fine.findings.filter((line) => line.includes("存不进工程"))).toEqual([])
  expect(fine.notes.join("\n")).not.toContain("造不出这个效果")
  expect((await runner.updateExternalTask({ ...ids, draft: coarse })).drafts[ids.taskId]?.unsaveable).toBeUndefined()
  expect(fine.findings).toEqual([])
  await runner.selfReviewExternalTask({ ...ids, ...done })
  await runner.finalReviewExternalTask(ids)
  await runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], independent: true } })
  expect(await words(runner.commitExternalTask({ ...ids, document: coarse }))).toBe("accepted")
  const saved = (await openProject(directory)).workspace.assets.find((asset) => asset.id === assetId)!
  expect(saved.document).toMatchObject({ kind: "effect", texel_size: 2 })
  // And the build of what was saved goes through.
  expect(() => compileEffects({ modId: "storm", packageName: "com.example.storm", effects: [{ id: assetId, title: saved.title, document: EffectDocumentSchema.parse(saved.document) }] })).not.toThrow()
})

// broad21: the reviewer of a Boss-tier creature's abilities is told what the tier asks and what is measurably missing, the same list its maker was given.
test("Boss 档的生物：审查员拿到这一档的清单和量出来的缺项；没有档位的生物拿到的和以前一样", async () => {
  const { directory, project, creature } = await fighting()
  const confirm = (level: "boss" | null) => async () => {
    const current = await openProject(directory)
    const entry = (key: string, kind: "model" | "entity", extra: Record<string, unknown> = {}) => ({ key, kind, title: key, brief: `做${key}`, owner: null, needs: [], out_of_scope: null, asset_id: null, ...extra })
    await saveProject(
      directory,
      {
        ...current,
        blueprint: {
          request: "做一只 Boss", style: { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "矿洞" }, questions: [], revision: 1, state: "confirmed" as const,
          entries: [entry("guardian_model", "model", { owner: "guardian" }), entry("guardian", "entity", { needs: ["guardian_model"], ...(level ? { tier: { level, reason: "你说了 Boss", by: "ai" as const } } : {}) })],
        },
      } as never,
      current.revision,
    )
  }
  await confirm("boss")()
  const runner = await runnerFor(directory, renderer().look)
  const started = await runner.startExternal({
    projectId: project.id,
    expectedRevision: (await openProject(directory)).revision,
    prompt: "一只 Boss 守卫",
    plan: { summary: "守卫", questions: [], tasks: [{ key: "guardian", module: "entity", title: "洞穴守卫", prompt: "Boss 守卫", source: blueprintSource("guardian"), dependencies: [], target_id: creature.id }] },
  })
  const ids = { projectId: project.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
  await runner.claimExternalTask(ids)
  await runner.lookExternalTask({ ...ids, document: creature.document })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  const packet = (await runner.finalReviewExternalTask(ids)) as { input: Record<string, unknown> }
  const asks = packet.input.tier_asks as { tier: string; required: string[]; optional: string[]; missing: string[] }
  expect(asks.tier).toBe("Boss 档")
  // The reviewer sees the measured omissions, including the optional steady setting.
  expect(asks.missing).toEqual(["还没有 Boss 设置（血条和死亡演出）", "没有一个招式在落地或吼叫时晃屏或扬起碎块", "缺稳重设置（steady）"])
  expect(asks.required.join("")).toContain("至少要有 2 个招式")
  expect(asks.optional.join("")).toContain("阶段（phases，0 到 3 个）")
  expect(ABILITY_REVIEWER_INSTRUCTIONS).toContain("tier_asks")
  expect(ABILITY_REVIEWER_INSTRUCTIONS).toContain("missing 是空的")
})

test("新一批生物凭文档引用上一批已存的模型，照常看图、审查和提交", async () => {
  const { directory, project, creature, model } = await fighting()
  // The earlier batch saved the model and its runtime entity, but no creature document.
  const first = await saveProject(directory, {
    ...project,
    workspace: { assets: project.workspace.assets.filter((asset) => asset.id !== creature.id) },
  }, project.revision)
  const preview = renderer()
  const runner = await runnerFor(directory, preview.look)
  const { ids, assetId, context } = await claimed(runner, first, "entity")
  expect(context.dependency_results).toEqual([])
  const document = { ...creature.document, model_asset_id: model.id }
  const missing = await words(runner.lookExternalTask({ ...ids, document: { ...document, model_asset_id: crypto.randomUUID() } }))
  expect(missing).toContain("工程里找不到 model_asset_id 指向的模型")
  const latest = await openProject(directory)
  const draft = await saveProject(directory, {
    ...latest,
    workspace: { assets: latest.workspace.assets.map((asset) => asset.id === model.id ? { ...asset, status: "design" } : asset) },
  }, latest.revision)
  const notReady = await words(runner.lookExternalTask({ ...ids, document }))
  expect(notReady).toContain("还没就绪")
  expect(preview.jobs).toHaveLength(0)
  await saveProject(directory, { ...latest, revision: draft.revision }, draft.revision)
  expect((await runner.lookExternalTask({ ...ids, document })).pictures.length).toBeGreaterThan(0)
  expect(preview.jobs[0]?.scenes.some(({ design }) => design.name === model.document.name)).toBe(true)
  await runner.selfReviewExternalTask({ ...ids, ...done })
  const packet = await runner.finalReviewExternalTask(ids)
  expect(packet).toHaveProperty("pictures")
  await runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], advice: [], independent: true } })
  expect(await words(runner.commitExternalTask({ ...ids, document }))).toBe("accepted")
  const saved = (await openProject(directory)).workspace.assets.find((asset) => asset.id === assetId)
  expect(saved).toMatchObject({ status: "ready", dependencies: expect.arrayContaining([model.id]), document: { model_asset_id: model.id } })
})

test("工程文件替换撞 EPERM 可以重交同一份已审草稿，下游继续等待", async () => {
  const { directory, project, creature } = await fighting()
  const runner = await runnerFor(directory, renderer().look)
  const started = await runner.startExternal({
    projectId: project.id,
    expectedRevision: project.revision,
    prompt: "改洞穴守卫，再做世界设定",
    plan: { summary: "守卫和设定", questions: [], tasks: [
      { key: "guardian", module: "entity", title: "洞穴守卫", prompt: "改洞穴守卫", source: "洞穴守卫", dependencies: [], target_id: creature.id },
      { key: "world", module: "worldview", title: "世界设定", prompt: "世界设定", source: "世界设定", dependencies: ["guardian"], target_id: null },
    ] },
  })
  const task = started.run.tasks[0]!
  const ids = { projectId: project.id, runId: started.run.id, taskId: task.id }
  const document = { ...creature.document, description: "守着蓝晶矿的石头傀儡。" }
  await runner.claimExternalTask(ids)
  await runner.lookExternalTask({ ...ids, document })
  await runner.selfReviewExternalTask({ ...ids, ...done })
  await runner.finalReviewExternalTask(ids)
  await runner.finalReviewExternalTask({ ...ids, verdict: { passed: true, findings: [], advice: [], independent: true } })
  const before = await openProject(directory)
  const reviewed = await readMaking(directory, task.asset_id)

  const rename = files.rename
  let failures = 0
  const busy = spyOn(files, "rename").mockImplementation(async (from, to) => {
    if (to === path.join(directory, "minemods.project.json")) {
      failures++
      const cause = Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM", syscall: "rename", path: from, dest: to })
      throw new ProjectRecordBusyError("external", cause)
    }
    await rename(from, to)
  })
  try {
    const outcome = await words(runner.commitExternalTask({ ...ids, document }))
    expect(failures).toBe(1)
    expect(outcome).toContain("这次没存进去")
    expect(outcome).toContain("其他程序打开了工程文件")
    expect(outcome).toContain("直接再交一次 commit_task")
  } finally {
    busy.mockRestore()
  }
  const held = await runner.getExternalProgress({ projectId: ids.projectId, runId: ids.runId })
  expect(held.run.tasks.map(({ state }) => state)).toEqual(["running", "queued"])
  expect(held.drafts[task.id]?.draft).toMatchObject(document)
  expect(await openProject(directory)).toEqual(before)
  expect(await readMaking(directory, task.asset_id)).toEqual(reviewed)

  const finished = await runner.commitExternalTask({ ...ids, document })
  expect(finished.tasks[0]?.state).toBe("completed")
  const next = finished.tasks[1]!
  expect((await runner.claimExternalTask({ ...ids, taskId: next.id })).task.state).toBe("running")
})
