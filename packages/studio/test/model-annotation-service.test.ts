import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { zip } from "./fixtures/zip"
import os from "node:os"
import path from "node:path"
import { createStudioService } from "../src/main/service"
import { dispatchExternal } from "../src/main/external-dispatch"
import { pictured } from "../src/main/mcp-content"
import { readModelAnnotation, storeModelAnnotation } from "../src/main/model-annotation"
import { createProjectRunner } from "../src/main/project-runner"
import { applyWorkspaceAsset, WorkspaceAssetSchema } from "@minemods/mod-core/workspace"
import { saveProject } from "@minemods/mod-core/project"
import { exportProjectArchive, importProjectArchive, inspectProjectArchive } from "@minemods/mod-core/container"
import { archivedMakingPaths, archivedMakings } from "@minemods/mod-core/making"
import { resolveProfile } from "@minemods/mod-core/fabric/profile"
import { listJobs } from "@minemods/mod-core/jobs"
import { readReviews } from "@minemods/mod-core/reviews"
import { addReference, readReferences, readMaking, REFERENCE_LIMITS, shownReferences, SHEET_INSTRUCTIONS, SELF_REVIEW_INSTRUCTIONS, REVIEWER_INSTRUCTIONS, OWN_GLANCE_INSTRUCTIONS } from "@minemods/mod-core/making"
import { weaponFixture, WEAPON_ITEM_ID, WEAPON_MODEL_ID } from "./weapon-fixture"
import type { ModelAnnotationInput } from "@minemods/studio-ai/model-annotation"
import type { ExternalStartResult, ExternalTaskContext } from "../src/external"

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n9kAAAAASUVORK5CYII="
const directories: string[] = []
const services: Awaited<ReturnType<typeof createStudioService>>[] = []
const servers: ReturnType<typeof Bun.serve>[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  servers.splice(0).forEach((server) => server.stop(true))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function setup(ai: { apiKey?: string; baseUrl?: string } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-annotation-"))
  directories.push(directory)
  const service = await createStudioService({ workspaceDirectory: path.join(directory, "projects"), runtimeDirectory: path.join(directory, "runtime"), templateDirectory: path.join(directory, "templates"), ai })
  services.push(service)
  return service
}

const capture = (targetId: string, projectRevision: number): ModelAnnotationInput => ({
  targetId, projectRevision, image, width: 1, height: 1, selectedPart: "blade",
  annotations: [{ kind: "arrow", start: { x: 0.1, y: 0.2 }, end: { x: 0.7, y: 0.8 }, part: "blade", text: "把这里改成蓝色" }],
})

async function savedModel(service: Awaited<ReturnType<typeof createStudioService>>) {
  const created = await service.createProject({ name: "标注武器", description: "", empty: true })
  const asset = WorkspaceAssetSchema.parse({
    id: WEAPON_MODEL_ID, module: "model", title: "武器模型", revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    prompt: "制作武器模型", dependencies: [], document: { kind: "model", ...weaponFixture() }, provenance: { model: null, request_id: null }, status: "ready",
  })
  const item = WorkspaceAssetSchema.parse({ ...asset, id: WEAPON_ITEM_ID, module: "item", title: "铜齿电锯剑", dependencies: [asset.id], document: { kind: "item", identifier: "copper_chainsaw", name: "铜齿电锯剑", max_stack: 1, color: "#bd8545", texture: null, model_asset_id: asset.id } })
  const project = await saveProject(created.directory, applyWorkspaceAsset(applyWorkspaceAsset(created.project, asset), item), created.project.revision)
  return { project, asset: project.workspace.assets.find((value) => value.id === asset.id)!, item, directory: created.directory }
}

test("wrong target and stale capture fail before a generation job or network request exists", async () => {
  const service = await setup({ apiKey: "fixture-key", baseUrl: "http://127.0.0.1:1/v1" })
  const created = await service.createProject({ name: "标注验证", description: "" })
  const current = await service.useExample({ projectId: created.project.id, expectedRevision: created.project.revision })
  for (const annotation of [capture(crypto.randomUUID(), current.project.revision), capture(current.entity_id!, current.project.revision - 1)]) {
    await expect(service.generateModel({ projectId: current.project.id, expectedRevision: current.project.revision, prompt: "按标注修改", annotation })).rejects.toThrow(/截图|目标/)
  }
  expect(await listJobs(current.directory)).toHaveLength(0)
  expect((await service.openProject(current.project.id)).model).toEqual(current.model)
})

test("valid direct edit sends an image block and keeps the saved model when the provider fails", async () => {
  const sent: { input: { content: { type: string; text?: string; image_url?: string }[] }[] }[] = []
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (request) => {
    sent.push(await request.json() as (typeof sent)[number])
    return new Response("fixture unavailable", { status: 500 })
  } })
  servers.push(server)
  const service = await setup({ apiKey: "fixture-key", baseUrl: `${server.url}v1` })
  const created = await service.createProject({ name: "标注真实传输", description: "" })
  const before = await service.useExample({ projectId: created.project.id, expectedRevision: created.project.revision })
  const annotation = capture(before.entity_id!, before.project.revision)
  const job = await service.generateModel({ projectId: before.project.id, expectedRevision: before.project.revision, prompt: "按箭头改蓝色", annotation })
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await service.getJob({ projectId: before.project.id, jobId: job.jobId })).state === "failed") break
    await Bun.sleep(5)
  }
  expect((await service.getJob({ projectId: before.project.id, jobId: job.jobId })).state).toBe("failed")
  expect(sent[0]!.input[0]!.content).toContainEqual({ type: "input_image", image_url: image })
  const text = sent[0]!.input[0]!.content[0]!.text!
  expect(text).not.toContain("base64")
  expect(JSON.parse(JSON.parse(text).content).annotation.annotations).toEqual(annotation.annotations)
  const after = await service.openProject(before.project.id)
  expect(after.project).toEqual(before.project)
  expect(after.model).toEqual(before.model)
})

test("invalid redo captures write no references, reviews or tasks, including non-model targets", async () => {
  const service = await setup()
  const current = await savedModel(service)
  for (const annotation of [capture(crypto.randomUUID(), current.project.revision), capture(current.asset.id, current.project.revision - 1)]) {
    await expect(service.redoAsset({ projectId: current.project.id, itemId: current.asset.id, feedback: "修改标注部位", annotation })).rejects.toThrow(/截图|目标/)
  }
  await expect(service.redoAsset({ projectId: current.project.id, itemId: current.item.id, feedback: "改武器", annotation: capture(current.item.id, current.project.revision) })).rejects.toThrow("只能用于")
  await expect(service.redoAsset({ projectId: current.project.id, itemId: current.asset.id, feedback: "字".repeat(501), annotation: capture(current.asset.id, current.project.revision) })).rejects.toThrow()
  expect(await shownReferences(current.directory, [current.asset.id])).toHaveLength(0)
  expect(await readReviews(current.directory)).toHaveLength(0)
  expect(await service.listProjectRuns({ projectId: current.project.id })).toHaveLength(0)
})

test("MCP redo keeps marks separately and claim_task shows its real PNG as image content", async () => {
  const service = await setup()
  const connection = await service.getConnection()
  const { hasApiKey: _hasApiKey, source: _source, ...settings } = connection
  await service.saveConnection({ ...settings, mode: "mcp" })
  const current = await savedModel(service)
  const annotation = capture(current.asset.id, current.project.revision)
  await service.redoAsset({ projectId: current.project.id, itemId: current.asset.id, feedback: "按箭头改蓝色", annotation })
  expect((await readReviews(current.directory))[0]!.note).toBe("按箭头改蓝色")
  expect((await readModelAnnotation(current.directory, current.asset.id, current.asset.revision))?.context.annotations).toEqual(annotation.annotations)
  const started = await dispatchExternal(service, { method: "nextBatch", input: { projectId: current.project.id } }) as ExternalStartResult
  const context = await dispatchExternal(service, { method: "claimExternalTask", input: { projectId: current.project.id, runId: started.run.id, taskId: started.tasks[0]!.task.id } }) as ExternalTaskContext
  const result = pictured(context)
  expect(result.content).toContainEqual({ type: "image", data: image.split(",")[1], mimeType: "image/png" })
  expect(result.content[0]!.type).toBe("text")
  expect(JSON.stringify(result.structuredContent)).not.toContain("base64")
  expect(JSON.stringify(result.structuredContent)).toContain("把这里改成蓝色")
  expect((await service.openProject(current.project.id)).project.workspace.assets.find((asset) => asset.id === current.asset.id)).toEqual(current.asset)
  expect((await service.openProject(current.project.id)).project.entities).toHaveLength(0)
  expect((await service.openProject(current.project.id)).project.items[0]?.model_asset_id).toBe(WEAPON_MODEL_ID)
  await dispatchExternal(service, { method: "cancelExternalRun", input: { projectId: current.project.id, runId: started.run.id } })
})

test("Studio's own model redo sends the exact annotated PNG and marks before making a version", async () => {
  const service = await setup()
  const current = await savedModel(service)
  await service.redoAsset({ projectId: current.project.id, itemId: current.asset.id, feedback: "按箭头改蓝色", annotation: capture(current.asset.id, current.project.revision) })
  const sent: { input: { content: { type: string; text?: string; image_url?: string }[] }[] }[] = []
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (request) => {
    sent.push(await request.json() as (typeof sent)[number])
    return new Response("fixture unauthorized", { status: 401 })
  } })
  servers.push(server)
  const runner = createProjectRunner({
    directoryFor: async () => current.directory,
    ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1` },
    sees: async () => "yes",
    look: async () => ({ ok: true, pictures: [{ label: "参考图", url: image }] }),
  })
  try {
    const started = await runner.startPlanned({
      projectId: current.project.id, expectedRevision: current.project.revision, prompt: "按箭头改蓝色",
      plan: { summary: "修改武器模型", questions: [], tasks: [{ key: "weapon", module: "model", title: "武器模型", prompt: "按箭头改蓝色", source: "按箭头改蓝色", dependencies: [], target_id: current.asset.id }] },
    }, false)
    await runner.wait(started.run.id)
    expect((await runner.get({ projectId: current.project.id, runId: started.run.id })).state).toBe("failed")
    expect(sent[0]!.input[0]!.content).toContainEqual({ type: "input_image", image_url: image })
    const text = sent[0]!.input[0]!.content[0]!.text!
    expect(JSON.parse(text).annotation.annotations[0].part).toBe("blade")
    expect(text).not.toContain("base64")
    const saved = await service.openProject(current.project.id)
    expect(saved.project.workspace.assets.find((asset) => asset.id === current.asset.id)).toEqual(current.asset)
    expect(saved.project.entities).toHaveLength(0)
  } finally {
    await runner.dispose()
  }
})

test("annotated static redo preserves own-AI glance, self review and independent review without synthetic motion", async () => {
  const service = await setup()
  const current = await savedModel(service)
  const annotation = capture(current.asset.id, current.project.revision)
  await service.redoAsset({ projectId: current.project.id, itemId: current.asset.id, feedback: "按箭头改蓝色", annotation })
  const sent: { instructions: string; input: Record<string, unknown>; images: string[] }[] = []
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => {
    const body = await request.json() as { instructions: string; input: { content: { type: string; text?: string; image_url?: string }[] }[] }
    const content = body.input[0]!.content
    sent.push({ instructions: body.instructions, input: JSON.parse(content[0]!.text!), images: content.flatMap(part => part.image_url ? [part.image_url] : []) })
    const answer = body.instructions.startsWith(SHEET_INSTRUCTIONS)
      ? { subject: "静态电锯剑", recognisable: ["长刀刃与锯齿"], parts: [{ name: "blade", what: "刀刃", shape: "长方体", attaches: "连接握柄", surface: "铜色", moves: "静止", assumed: false }], assumed: [] }
      : body.instructions.endsWith(OWN_GLANCE_INSTRUCTIONS) ? { keep: true, revised: null }
      : body.instructions.startsWith(SELF_REVIEW_INSTRUCTIONS) ? { matches: ["形状符合"], problems: [], advice: [], next: [], verdict: "done", look_closer: null, watch: null, declare: null, see: [] }
      : body.instructions.startsWith(REVIEWER_INSTRUCTIONS) ? { passed: true, findings: [], advice: [], need: [] }
      : { kind: "model", ...weaponFixture(), name: "修改后的电锯剑" }
    return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] })
  } })
  servers.push(server)
  const runner = createProjectRunner({
    directoryFor: async () => current.directory, ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1`, retryWait: [0, 0] }, sees: async () => "yes",
    look: async job => ({ ok: true, pictures: job.sheets.map(sheet => ({ label: sheet.label, url: image })) }),
  })
  try {
    const started = await runner.startPlanned({ projectId: current.project.id, expectedRevision: current.project.revision, prompt: "按箭头改蓝色", plan: { summary: "修改武器模型", questions: [], tasks: [{ key: "weapon", module: "model", title: "武器模型", prompt: "按箭头改蓝色", source: "按箭头改蓝色", dependencies: [], target_id: current.asset.id }] } }, false)
    await runner.wait(started.run.id)
    const finished = await runner.get({ projectId: current.project.id, runId: started.run.id })
    if (finished.state !== "completed") throw new Error(JSON.stringify({ finished, calls: sent.map(call => ({ input: Object.keys(call.input), instructions: call.instructions.slice(0, 70) })) }))
    expect(finished.state).toBe("completed")
    const maker = sent.filter(call => "annotation" in call.input)
    expect(maker).toHaveLength(3)
    for (const call of maker) {
      expect(call.input.annotation).toMatchObject({ targetId: current.asset.id, annotations: annotation.annotations })
      expect(call.images).toContain(image)
    }
    expect(maker.some(call => call.instructions.endsWith(OWN_GLANCE_INSTRUCTIONS))).toBe(true)
    const self = sent.find(call => call.instructions.startsWith(SELF_REVIEW_INSTRUCTIONS))!
    expect(self.input).not.toHaveProperty("motions_not_shown")
    expect(self.input.motion_facts).toEqual([])
    expect(sent.some(call => call.instructions.startsWith(REVIEWER_INSTRUCTIONS))).toBe(true)
    const record = await readMaking(current.directory, current.asset.id)
    expect(record?.rounds).toHaveLength(1)
    expect(record?.review).toMatchObject({ passed: true, independent: true })
    const saved = await service.openProject(current.project.id)
    expect(saved.project.entities).toHaveLength(0)
    expect(saved.project.workspace.assets.find(asset => asset.id === current.asset.id)?.revision).toBe(current.asset.revision + 1)
  } finally {
    await runner.dispose()
  }
})

test("API 模式：批注走同一条返工链路，带上位置和约束，写入进时间轴，交回后标已改", async () => {
  const service = await setup()
  const current = await savedModel(service)
  const annotation = capture(current.asset.id, current.project.revision)
  const ids = { projectId: current.project.id, assetId: current.asset.id }
  const camera = { position: [1, 2, 3] as [number, number, number], target: [0, 0, 0] as [number, number, number] }
  await service.makingHistory.addNote({ ...ids, note: { kind: "arrow", start: { x: 0.1, y: 0.2 }, end: { x: 0.7, y: 0.8 }, text: "把这里改成蓝色", part: "blade", frame: null, camera } })
  await service.sendMakingNotes({ ...ids, ids: [1], onlyMarked: true, picture: { image, width: 1, height: 1, projectRevision: current.project.revision } })
  expect((await readReviews(current.directory)).at(-1)?.note).toContain("只改标到的地方，别的不动")
  const sent: { instructions: string; input: Record<string, unknown>; images: string[] }[] = []
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => {
    const body = await request.json() as { instructions: string; input: { content: { type: string; text?: string; image_url?: string }[] }[] }
    const content = body.input[0]!.content
    sent.push({ instructions: body.instructions, input: JSON.parse(content[0]!.text!), images: content.flatMap(part => part.image_url ? [part.image_url] : []) })
    const answer = body.instructions.startsWith(SHEET_INSTRUCTIONS)
      ? { subject: "静态电锯剑", recognisable: ["长刀刃与锯齿"], parts: [{ name: "blade", what: "刀刃", shape: "长方体", attaches: "连接握柄", surface: "铜色", moves: "静止", assumed: false }], assumed: [] }
      : body.instructions.endsWith(OWN_GLANCE_INSTRUCTIONS) ? { keep: true, revised: null }
      : body.instructions.startsWith(SELF_REVIEW_INSTRUCTIONS) ? { matches: ["形状符合"], problems: [], advice: [], next: [], verdict: "done", look_closer: null, watch: null, declare: null, see: [] }
      : body.instructions.startsWith(REVIEWER_INSTRUCTIONS) ? { passed: true, findings: [], advice: [], need: [] }
      : { kind: "model", ...weaponFixture(), name: "修改后的电锯剑" }
    return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] })
  } })
  servers.push(server)
  const runner = createProjectRunner({
    directoryFor: async () => current.directory, trace: (input) => service.makingHistory.record(input), ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1`, retryWait: [0, 0] }, sees: async () => "yes",
    look: async job => ({ ok: true, pictures: job.sheets.map(sheet => ({ label: sheet.label, url: image })) }),
  })
  try {
    const started = await runner.startPlanned({ projectId: current.project.id, expectedRevision: current.project.revision, prompt: "按箭头改蓝色", plan: { summary: "修改武器模型", questions: [], tasks: [{ key: "weapon", module: "model", title: "武器模型", prompt: "按箭头改蓝色", source: "按箭头改蓝色", dependencies: [], target_id: current.asset.id }] } }, false)
    await runner.wait(started.run.id)
    const finished = await runner.get({ projectId: current.project.id, runId: started.run.id })
    if (finished.state !== "completed") throw new Error(JSON.stringify({ finished, calls: sent.map(call => ({ input: Object.keys(call.input), instructions: call.instructions.slice(0, 70) })) }))
    expect(finished.state).toBe("completed")
    const maker = sent.filter(call => "annotation" in call.input)
    expect(maker.length).toBeGreaterThan(0)
    for (const call of maker) {
      expect(call.input.annotation).toMatchObject({ targetId: current.asset.id, only_marked: true, annotations: [{ note: 1, part: "blade", text: "把这里改成蓝色" }] })
      expect(call.images).toContain(image)
    }
    // Own AI: every version it wrote and every look stand on the timeline, with no words made up for it.
    const trace = await service.makingHistory.trace(ids)
    expect(trace.steps.some(step => step.kind === "look")).toBe(true)
    expect(trace.steps.some(step => step.kind === "review")).toBe(true)
    expect(trace.steps.every(step => step.note === null)).toBe(true)
    const after = await service.makingHistory.read(ids)
    expect(after.versions.at(-1)).toMatchObject({ by: "ai", current: true })
    expect(after.notes[0]).toMatchObject({ status: "fixed", fixed_version: after.versions.at(-1)!.version })
    expect(await service.makingHistory.notesForTask(current.project.id, current.asset.id)).toEqual([])
  } finally {
    await runner.dispose()
  }
})

test("item hold hand-save keeps model binding, workspace revision and stale-edit protection", async () => {
  const service = await setup()
  const current = await savedModel(service)
  const replacement = { ...current.asset, id: crypto.randomUUID(), title: "备用模型" }
  const unrelated = { ...current.asset, id: crypto.randomUUID(), title: "保留依赖" }
  const project = await saveProject(current.directory, { ...current.project, workspace: { ...current.project.workspace, assets: [...current.project.workspace.assets.map(asset => asset.id === current.item.id ? { ...asset, dependencies: [...asset.dependencies, unrelated.id] } : asset), replacement, unrelated] } }, current.project.revision)
  const display = Object.fromEntries(["firstperson_righthand", "firstperson_lefthand", "thirdperson_righthand", "thirdperson_lefthand"].map((slot, index) => [slot, { rotation: [10 + index, 20, 30], translation: [1, 2 + index, 3], scale: [0.5, 0.5, 0.5] }]))
  const saved = await service.saveByHand({ projectId: current.project.id, expectedRevision: project.revision, assetId: current.item.id, basedOn: current.item.revision, changed: ["模型", "持握姿势"], document: { ...current.item.document, display } })
  expect(saved.ok).toBe(true)
  if (!saved.ok) throw new Error("Hand save refused")
  expect(saved.view.project.items[0]).toMatchObject({ model_asset_id: current.asset.id, display })
  expect(saved.view.project.workspace.assets.find(asset => asset.id === current.item.id)).toMatchObject({ revision: current.item.revision + 1, document: { model_asset_id: current.asset.id, display } })
  const stale = await service.saveByHand({ projectId: current.project.id, expectedRevision: saved.view.project.revision, assetId: current.item.id, basedOn: current.item.revision, changed: ["持握姿势"], document: current.item.document })
  expect(stale.ok).toBe(false)
  expect((await service.openProject(current.project.id)).project).toEqual(saved.view.project)
  const changed = await service.saveByHand({ projectId: current.project.id, expectedRevision: saved.view.project.revision, assetId: current.item.id, basedOn: current.item.revision + 1, changed: ["模型"], document: { ...current.item.document, display, model_asset_id: replacement.id } })
  expect(changed.ok).toBe(true)
  if (!changed.ok) throw new Error("Model binding refused")
  expect(changed.view.project.workspace.assets.find(asset => asset.id === current.item.id)?.dependencies).toEqual([unrelated.id, replacement.id])
  expect(changed.view.project.items[0]).toMatchObject({ model_asset_id: replacement.id, display })
  const detached = await service.saveByHand({ projectId: current.project.id, expectedRevision: changed.view.project.revision, assetId: current.item.id, basedOn: current.item.revision + 2, changed: ["模型"], document: { ...current.item.document, display, model_asset_id: undefined } })
  expect(detached.ok).toBe(true)
  if (!detached.ok) throw new Error("Model unbinding refused")
  expect(detached.view.project.workspace.assets.find(asset => asset.id === current.item.id)?.dependencies).toEqual([unrelated.id])
  expect(detached.view.project.items[0]?.model_asset_id).toBeUndefined()
  expect(detached.view.project.items[0]?.display).toEqual(display)
  expect(detached.view.project.entities).toHaveLength(0)
})
test("repeated and concurrent annotations replace their own picture at the reference limit", async () => {
  const service = await setup()
  const current = await savedModel(service)
  for (let index = 0; index < REFERENCE_LIMITS.user - 1; index++) await addReference(current.directory, current.asset.id, { kind: "user", name: `普通参考 ${index}`, url: image })
  const ordinary = await readReferences(current.directory, current.asset.id)
  for (let index = 0; index < 6; index++) await service.redoAsset({ projectId: current.project.id, itemId: current.asset.id, feedback: `第${index}次`, annotation: capture(current.asset.id, current.project.revision) })
  await Promise.all([1, 2].map(() => storeModelAnnotation(current.directory, capture(current.asset.id, current.project.revision), current.asset.revision)))
  const references = await readReferences(current.directory, current.asset.id)
  expect(references).toHaveLength(REFERENCE_LIMITS.user)
  expect(references.filter((reference) => reference.name.startsWith("普通参考"))).toEqual(ordinary)
  expect(references.filter((reference) => reference.name.startsWith("图上修改"))).toHaveLength(1)
  expect(await readModelAnnotation(current.directory, current.asset.id, current.asset.revision)).not.toBeNull()
})

test("plain redo and a changed model remove only the old annotation, never ordinary references", async () => {
  const service = await setup()
  const current = await savedModel(service)
  await addReference(current.directory, current.asset.id, { kind: "user", name: "普通参考", url: image })
  const ordinary = await readReferences(current.directory, current.asset.id)
  await service.redoAsset({ projectId: current.project.id, itemId: current.asset.id, feedback: "看箭头", annotation: capture(current.asset.id, current.project.revision) })
  await service.redoAsset({ projectId: current.project.id, itemId: current.asset.id, feedback: "只改名字" })
  expect(await readModelAnnotation(current.directory, current.asset.id, current.asset.revision)).toBeNull()
  expect(await readReferences(current.directory, current.asset.id)).toEqual(ordinary)
  await service.redoAsset({ projectId: current.project.id, itemId: current.asset.id, feedback: "看新箭头", annotation: capture(current.asset.id, current.project.revision) })
  const project = await saveProject(current.directory, applyWorkspaceAsset(current.project, { ...current.asset, revision: current.asset.revision + 1 }), current.project.revision)
  expect(await readModelAnnotation(current.directory, current.asset.id, project.workspace.assets.find((asset) => asset.id === current.asset.id)!.revision)).toBeNull()
  expect(await readReferences(current.directory, current.asset.id)).toEqual(ordinary)
})

test("a first annotation cannot evict a full set of ordinary user references", async () => {
  const service = await setup()
  const current = await savedModel(service)
  for (let index = 0; index < REFERENCE_LIMITS.user; index++) await addReference(current.directory, current.asset.id, { kind: "user", name: `普通参考 ${index}`, url: image })
  const ordinary = await readReferences(current.directory, current.asset.id)
  await expect(service.redoAsset({ projectId: current.project.id, itemId: current.asset.id, feedback: "看箭头", annotation: capture(current.asset.id, current.project.revision) })).rejects.toThrow("最多放")
  expect(await readReferences(current.directory, current.asset.id)).toEqual(ordinary)
  expect(await readReviews(current.directory)).toHaveLength(0)
})

test("project export/import preserves annotation semantics and later plain redo removes only its PNG", async () => {
  const service = await setup()
  const current = await savedModel(service)
  await addReference(current.directory, current.asset.id, { kind: "user", name: "普通参考", url: image })
  await service.redoAsset({ projectId: current.project.id, itemId: current.asset.id, feedback: "看箭头", annotation: capture(current.asset.id, current.project.revision) })
  const root = await mkdtemp(path.join(os.tmpdir(), "annotation-import-"))
  directories.push(root)
  const archive = path.join(root, "weapon.minemods")
  await exportProjectArchive({ directory: current.directory, destination: archive })
  const imported = await importProjectArchive({ archive, destination: path.join(root, "copied") })
  const held = await readModelAnnotation(imported.directory, current.asset.id, current.asset.revision)
  expect(held?.context).toMatchObject({ targetId: current.asset.id, annotations: capture(current.asset.id, current.project.revision).annotations })
  expect(held?.image).toBe(image)
  const reopened = await createStudioService({ workspaceDirectory: root, runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: {} })
  services.push(reopened)
  await reopened.openProject(current.project.id)
  await reopened.redoAsset({ projectId: current.project.id, itemId: current.asset.id, feedback: "这次只改名字" })
  expect((await readReferences(imported.directory, current.asset.id)).map((reference) => reference.name)).toEqual(["普通参考"])
  expect(await readModelAnnotation(imported.directory, current.asset.id, current.asset.revision)).toBeNull()
  // A successful later save leaves historical annotation metadata until its next read. Backups must still work.
  const newer = await saveProject(current.directory, applyWorkspaceAsset(current.project, { ...current.asset, revision: current.asset.revision + 1 }), current.project.revision)
  const backup = path.join(root, "after-model-save.minemods")
  await exportProjectArchive({ directory: current.directory, destination: backup })
  expect((await inspectProjectArchive(backup)).project.revision).toBe(newer.revision)
  const afterSave = await importProjectArchive({ archive: backup, destination: path.join(root, "newer") })
  expect(await readModelAnnotation(afterSave.directory, current.asset.id, current.asset.revision + 1)).toBeNull()
  expect((await readReferences(afterSave.directory, current.asset.id)).map((reference) => reference.name)).toEqual(["普通参考"])
})

test("archives reject annotation path, schema, owner/reference and future revision mismatches", async () => {
  const service = await setup()
  const current = await savedModel(service)
  await service.redoAsset({ projectId: current.project.id, itemId: current.asset.id, feedback: "看箭头", annotation: capture(current.asset.id, current.project.revision) })
  const archive = path.join(path.dirname(current.directory), "valid.minemods")
  await exportProjectArchive({ directory: current.directory, destination: archive })
  const entries: Record<string, Uint8Array> = {
    "minemods.project.json": await readFile(path.join(current.directory, "minemods.project.json")),
    "dependencies.lock.json": Buffer.from(JSON.stringify(resolveProfile(current.project.target))),
    ...(await archivedMakings(current.directory)),
  }
  const name = `.minemods/making/annotations/${current.asset.id}.json`
  const record = JSON.parse(Buffer.from(entries[name]!).toString("utf8"))
  for (const changed of [
    { ...record, referenceId: crypto.randomUUID() },
    { ...record, modelRevision: current.asset.revision + 1 },
    { ...record, context: { ...record.context, annotations: [] } },
  ]) expect(() => archivedMakingPaths({ ...entries, [name]: Buffer.from(JSON.stringify(changed)) }, current.project)).toThrow()
  expect(() => archivedMakingPaths({ ...entries, [".minemods/making/annotations/unrelated.txt"]: Buffer.from("x") }, current.project)).toThrow()
  const corrupt: Record<string, Uint8Array> = { ...entries, [name]: Buffer.from(JSON.stringify({ ...record, referenceId: crypto.randomUUID() })) }
  const manifest = {
    format: "minemods", container_version: 1, project: current.project,
    environment: { java: 21, minecraft: "1.21.1", loader: "fabric", loaderVersion: "0.17.2" },
    entries: Object.entries(corrupt).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") })),
  }
  corrupt["manifest.json"] = Buffer.from(JSON.stringify(manifest))
  const bad = path.join(path.dirname(current.directory), "wrong-reference.minemods")
  await writeFile(bad, zip(corrupt))
  await expect(inspectProjectArchive(bad)).rejects.toThrow("制作记录")
})
