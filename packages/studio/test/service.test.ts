import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { createStudioService, dispatchStudioRequest, publicError } from "../src/main/service"
import { DELETED_FOLDER, REVISION_CONFLICT } from "../src/api"
import { createEntity, ProjectLockedError, saveProject, writeRecord } from "@minemods/mod-core/project"
import { listJobs, startJob, updateJob } from "@minemods/mod-core/jobs"
import { jarName } from "@minemods/mod-core/release"
import { loadModelAsset } from "@minemods/mod-core/assets"
import { mushroomCowDesign } from "@minemods/mod-core/example"
import { persistWorkspaceModel } from "@minemods/mod-core/workspace-model"
import { applyWorkspaceAsset, WorkspaceAssetSchema } from "@minemods/mod-core/workspace"
import { soundMoments } from "@minemods/mod-core/sound-moments"
import { StudioRequestSchema } from "../src/main/protocol"
import { createWorkerLifecycle, shutdownWithin } from "../src/main/lifecycle"
import { runOwnedProcess } from "@minemods/mod-core/runtime"
import { spawn } from "node:child_process"
import { once } from "node:events"

const directories: string[] = []

const workspaceAsset = (document: Record<string, unknown>, module: string, overrides: Record<string, unknown> = {}) =>
  WorkspaceAssetSchema.parse({
    id: crypto.randomUUID(),
    module,
    title: String(document.name ?? module),
    revision: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    prompt: `设计 ${module}`,
    dependencies: [],
    document,
    provenance: { model: null, request_id: null },
    status: "design",
    ...overrides,
  })

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-service-项目-'"))
  directories.push(directory)
  const options = {
    workspaceDirectory: path.join(directory, "projects"),
    runtimeDirectory: path.join(directory, "runtime"),
    templateDirectory: path.join(directory, "templates"),
    ai: {},
  }
  return { options, service: await createStudioService(options) }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("queued and running builds reject gameplay changes until canceled", async () => {
  const result = await setup()
  const created = await result.service.createProject({ name: "Locked Creature", description: "A creature" })
  const input = { projectId: created.project.id, expectedRevision: created.project.revision,
    name: "Changed Creature", description: "A creature", health: 30, speed: 0.3, attack_damage: 3, behavior: "follow" as const }
  const job = await startJob(created.directory, { kind: "build", expectedRevision: created.project.revision })
  await expect(result.service.saveEntity(input)).rejects.toThrow("这个工程正在打包或者检查。等它结束或者先取消，再保存修改。")
  const running = await updateJob(created.directory, job.id, { expectedRevision: job.revision, state: "running" })
  await expect(result.service.saveContent({ projectId: created.project.id, expectedRevision: created.project.revision,
    content: { blocks: [], items: [], recipes: [], logic: [] } })).rejects.toThrow("这个工程正在打包或者检查。等它结束或者先取消，再保存修改。")
  expect((await result.service.openProject(created.project.id)).project).toEqual(created.project)
  await updateJob(created.directory, job.id, { expectedRevision: running.revision, state: "canceled" })
  // The game left open, or ideas being thought up, do not hold a save back.
  await startJob(created.directory, { kind: "scene_play", expectedRevision: created.project.revision })
  await startJob(created.directory, { kind: "expand-ideas", expectedRevision: created.project.revision })
  expect((await result.service.saveEntity(input)).project.entities[0]?.health).toBe(30)
})

// broad11 w4b: Studio was closed with the test scene's game open. The next Studio found that job still running, saying the game was open, and a new play waited on it until it was canceled by hand.
test("a restarted Studio finds the test scene's game job interrupted, not still open, and nothing waits for it", async () => {
  const result = await setup()
  const created = await result.service.createProject({ name: "Reopened", description: "A creature" })
  const playing = await startJob(created.directory, { kind: "scene_play", expectedRevision: created.project.revision })
  const running = await updateJob(created.directory, playing.id, { expectedRevision: playing.revision, state: "running" })
  await updateJob(created.directory, playing.id, { expectedRevision: running.revision, checkpoint: { detail: "游戏已经开着了", in_game_at: "2026-10-12T00:00:00.000Z" } })
  const waiting = await startJob(created.directory, { kind: "build", expectedRevision: created.project.revision })
  // The first Studio is gone without having written an end; a new one opens the same folders.
  const again = await createStudioService(result.options)
  expect((await again.getJob({ projectId: created.project.id, jobId: playing.id })).state).toBe("interrupted")
  expect((await again.getJob({ projectId: created.project.id, jobId: waiting.id })).state).toBe("interrupted")
  // Neither is left for a build or a new play to find as the job in progress (a build asks for the one already going and would be handed the dead one).
  expect((await listJobs(created.directory)).filter((job) => job.state === "queued" || job.state === "running")).toEqual([])
  await again.dispose()
})

test("creates one entity, reopens by ID, and saves real project data", async () => {
  const setupResult = await setup()
  const created = await setupResult.service.createProject({ name: "森林 守卫's", description: "温和的森林生物" })
  expect(created.project.entities).toHaveLength(1)
  expect(created.project.entities[0]?.description).toBe("温和的森林生物")
  expect(created.model).toBeNull()
  expect(await setupResult.service.openProject(created.project.id)).toEqual(created)
  const saved = await setupResult.service.saveEntity({
    projectId: created.project.id,
    expectedRevision: created.project.revision,
    name: "森林鹿",
    description: "会跟随玩家",
    health: 40,
    speed: 0.3,
    attack_damage: 3,
    behavior: "follow",
  })
  expect(saved.project.entities[0]?.health).toBe(40)
  expect(saved.project.entities[0]?.behavior).toBe("follow")
  expect((await setupResult.service.listProjects())[0]?.project).toEqual(saved.project)
})

test("saving entity parameters synchronizes its workspace entity document and revision", async () => {
  const result = await setup()
  const created = await result.service.createProject({ name: "实体工作区", description: "" })
  const entity = created.project.entities[0]!
  const model = workspaceAsset({ kind: "model", ...mushroomCowDesign }, "model", { id: entity.id })
  await saveProject(created.directory, applyWorkspaceAsset(created.project, model), created.project.revision)
  const persisted = await persistWorkspaceModel(created.directory, entity.id)
  const texture = workspaceAsset(
    {
      kind: "texture",
      width: mushroomCowDesign.texture_size,
      height: mushroomCowDesign.texture_size,
      palette: ["#abcdef"],
      pixels: Array(mushroomCowDesign.texture_size * mushroomCowDesign.texture_size).fill(0),
    },
    "texture",
  )
  const withTexture = applyWorkspaceAsset(persisted.project, texture)
  await saveProject(created.directory, withTexture, persisted.project.revision)
  const entityAsset = workspaceAsset(
    {
      kind: "entity",
      name: entity.name,
      description: entity.description,
      health: entity.health,
      speed: entity.speed,
      attack_damage: entity.attack_damage,
      behavior: entity.behavior,
      model_asset_id: entity.id,
      runtime: {
        spawn: null,
        explosion: null,
        movement: "direct",
        armor: 0,
        charging_armor: 0,
        texture_asset_id: texture.id,
      },
    },
    "entity",
    { dependencies: [entity.id, texture.id], status: "ready" },
  )
  const bound = applyWorkspaceAsset(
    await result.service.openProject(created.project.id).then((view) => view.project),
    entityAsset,
  )
  await saveProject(created.directory, bound, bound.revision)
  const before = await result.service.openProject(created.project.id)
  const beforeAsset = before.project.workspace.assets.find((asset) => asset.id === entityAsset.id)!
  const saved = await result.service.saveEntity({
    projectId: created.project.id,
    expectedRevision: before.project.revision,
    entityId: entity.id,
    name: "强化森林鹿",
    description: "会追踪玩家",
    health: 40,
    speed: 0.4,
    attack_damage: 8,
    behavior: "hostile",
  })
  const savedAsset = saved.project.workspace.assets.find((asset) => asset.id === entityAsset.id)!
  expect(saved.project.entities.find((value) => value.id === entity.id)).toMatchObject({
    name: "强化森林鹿",
    description: "会追踪玩家",
    health: 40,
    speed: 0.4,
    attack_damage: 8,
    behavior: "hostile",
  })
  expect(savedAsset.document).toMatchObject({
    kind: "entity",
    name: "强化森林鹿",
    description: "会追踪玩家",
    health: 40,
    speed: 0.4,
    attack_damage: 8,
    behavior: "hostile",
    model_asset_id: entity.id,
  })
  expect(savedAsset.revision).toBe(beforeAsset.revision + 1)
  // A changed name is the asset's title too.
  expect(savedAsset.title).toBe("强化森林鹿")
  // A setting saved with the name as it is (「让它稳重」) leaves a title its maker wrote alone: r20 turned 「…（终极 Boss）」 back into the bare name.
  const titled = { ...saved.project, workspace: { assets: saved.project.workspace.assets.map((asset) => (asset.id === entityAsset.id ? { ...asset, title: "强化森林鹿（终极 Boss）" } : asset)) } }
  await saveProject(created.directory, titled, saved.project.revision)
  const reopened = await result.service.openProject(created.project.id)
  const steadied = await result.service.saveEntity({ projectId: created.project.id, expectedRevision: reopened.project.revision, entityId: entity.id, name: "强化森林鹿", description: "会追踪玩家", health: 40, speed: 0.4, attack_damage: 8, behavior: "hostile", steady: { preset: "auto" } })
  const steadiedAsset = steadied.project.workspace.assets.find((asset) => asset.id === entityAsset.id)!
  expect(steadiedAsset.title).toBe("强化森林鹿（终极 Boss）")
  expect(steadiedAsset.document).toMatchObject({ kind: "entity", name: "强化森林鹿", steady: { preset: "auto" } })
  // A sound Studio plays by itself (here the fuse of a creature that blows up) is a row of「它的声音」: it can be swapped for another, and put back, after which the saved creature is as it was.
  const fused = { ...steadied.project, workspace: { assets: steadied.project.workspace.assets.map((asset) => (asset.id === entityAsset.id && asset.document.kind === "entity" ? { ...asset, document: { ...asset.document, runtime: { ...asset.document.runtime, explosion: { fuse_ticks: 30, radius: 3, damage_blocks: false, effects: [] } } } } : asset)) } }
  await saveProject(created.directory, fused, steadied.project.revision)
  const withFuse = await result.service.openProject(created.project.id)
  const fuse = soundMoments(withFuse.project, entity.id).find((row) => row.path[0] === "builtin")!
  expect(fuse).toMatchObject({ where: "爆炸引信（Studio 自带，可以换成自己的）", ref: "entity.creeper.primed", source: "原版", editable: true, path: ["builtin", "fuse", "sound"] })
  const swapped = await result.service.changeSoundMoment({ projectId: created.project.id, expectedRevision: withFuse.project.revision, entityId: entity.id, key: fuse.key, vanilla: "entity.warden.sonic_charge" })
  expect(swapped.project.workspace.assets.find((asset) => asset.id === entityAsset.id)!.document).toMatchObject({ builtin: { fuse: { sound: "entity.warden.sonic_charge" } } })
  const swappedRow = soundMoments(swapped.project, entity.id).find((row) => row.path[0] === "builtin")!
  expect(swappedRow).toMatchObject({ key: fuse.key, ref: "entity.warden.sonic_charge", name: "监守者蓄力", detail: "原来是引信声", reach: "通常约 16 格" })
  const back = await result.service.changeSoundMoment({ projectId: created.project.id, expectedRevision: swapped.project.revision, entityId: entity.id, key: swappedRow.key })
  expect("builtin" in back.project.workspace.assets.find((asset) => asset.id === entityAsset.id)!.document).toBe(false)
  expect(soundMoments(back.project, entity.id).find((row) => row.path[0] === "builtin")).toMatchObject({ ref: "entity.creeper.primed" })
})

test("example import persists actual geometry and truthful provenance", async () => {
  const result = await setup()
  const created = await result.service.createProject({ name: "蘑菇牛", description: "" })
  const example = await result.service.useExample({
    projectId: created.project.id,
    expectedRevision: created.project.revision,
  })
  expect(example.model?.bones.length).toBeGreaterThan(0)
  expect(example.model_origin).toBe("example")
  const id = example.project.entities[0]?.model_asset_id
  expect(id).toBeTruthy()
  expect((await loadModelAsset(example.directory, id!)).origin).toBe("example")
  const reopened = await (await createStudioService(result.options)).openProject(created.project.id)
  expect(reopened).toEqual(example)
})

test("missing AI credentials fails before a job exists", async () => {
  const result = await setup()
  const created = await result.service.createProject({ name: "Deer", description: "" })
  await expect(
    result.service.generateModel({
      projectId: created.project.id,
      expectedRevision: created.project.revision,
      prompt: "a deer",
    }),
  ).rejects.toThrow(/配置|凭据|密钥/)
  expect(await listJobs(created.directory)).toHaveLength(0)
  expect((await result.service.environment()).aiConfigured).toBe(false)
})

test("generateModel snapshots the saved complexity in its modeling input", async () => {
  let requestBody: Record<string, unknown> | null = null
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      requestBody = await request.json() as Record<string, unknown>
      return new Response("fixture failure", { status: 500 })
    },
  })
  try {
    const result = await setup()
    const service = await createStudioService({ ...result.options, ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1` } })
    await service.saveSettings({ ...(await service.getSettings()), modelComplexity: "low" })
    const created = await service.createProject({ name: "复杂度快照", description: "" })
    const job = await service.generateModel({ projectId: created.project.id, expectedRevision: created.project.revision, prompt: "a deer" })
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = await service.getJob({ projectId: created.project.id, jobId: job.jobId })
      if (["failed", "completed", "canceled", "interrupted"].includes(current.state)) break
      await Bun.sleep(5)
    }
    const content = JSON.parse(String((((requestBody as Record<string, unknown> | null)?.input as Array<{ content: Array<{ text: string }> }>)[0]?.content[0]?.text))) as Record<string, unknown>
    expect(content.complexity).toBe("low")
  } finally {
    server.stop(true)
  }
})

test("读取生物预览不改变当前选择，并校验工程与生物归属", async () => {
  const result = await setup()
  const created = await result.service.createProject({ name: "预览归属", description: "" })
  const example = await result.service.useExample({
    projectId: created.project.id,
    expectedRevision: created.project.revision,
  })
  const added = await result.service.addEntity({
    projectId: created.project.id,
    expectedRevision: example.project.revision,
    name: "当前选择",
  })
  const preview = await result.service.getEntityPreview({ projectId: created.project.id, entityId: example.entity_id! })
  expect(preview.model).toEqual(example.model)
  expect(preview.preview?.textureDataUrl).toMatch(/^data:image\/png;base64,/)
  expect((await result.service.openProject(created.project.id)).entity_id).toBe(added.entity_id)
  await expect(
    result.service.getEntityPreview({ projectId: created.project.id, entityId: crypto.randomUUID() }),
  ).rejects.toThrow("找不到这个生物")
  expect(
    StudioRequestSchema.safeParse({
      method: "getEntityPreview",
      input: { projectId: created.project.id, entityId: "../escape" },
    }).success,
  ).toBe(false)
})

test("rejects arbitrary paths and stale saves while preserving independent entities", async () => {
  const result = await setup()
  const created = await result.service.createProject({ name: "Deer", description: "" })
  await expect(result.service.openProject("../../escape")).rejects.toThrow()
  await expect(result.service.useExample({ projectId: created.project.id, expectedRevision: 0 })).rejects.toThrow()
  await saveProject(
    created.directory,
    { ...created.project, entities: [...created.project.entities, createEntity({ name: "Second" })] },
    created.project.revision,
  )
  const reopened = await result.service.openProject(created.project.id)
  expect(reopened.project.entities).toHaveLength(2)
  const second = reopened.project.entities[1]!
  const edited = await result.service.useExample({
    projectId: created.project.id,
    expectedRevision: reopened.project.revision,
    entityId: second.id,
  })
  expect(edited.project.entities[0]!.model_asset_id).toBeNull()
  expect(edited.project.entities[1]!.model_asset_id).toBeTruthy()
  expect(edited.entity_id).toBe(second.id)
  await expect(
    result.service.useExample({
      projectId: created.project.id,
      expectedRevision: edited.project.revision,
      entityId: crypto.randomUUID(),
    }),
  ).rejects.toThrow()
})

test("recovers interrupted jobs once per service startup without interrupting live jobs on reopen", async () => {
  const result = await setup()
  const created = await result.service.createProject({ name: "Deer", description: "" })
  const previous = await startJob(created.directory, { kind: "build", expectedRevision: created.project.revision })
  await updateJob(created.directory, previous.id, {
    expectedRevision: 0,
    state: "running",
    checkpoint: { stage: "compile" },
  })
  const restarted = await createStudioService(result.options)
  await restarted.openProject(created.project.id)
  expect((await restarted.getJob({ projectId: created.project.id, jobId: previous.id })).state).toBe("interrupted")
  const live = await startJob(created.directory, { kind: "build", expectedRevision: created.project.revision })
  await updateJob(created.directory, live.id, { expectedRevision: 0, state: "running" })
  await restarted.openProject(created.project.id)
  expect((await restarted.getJob({ projectId: created.project.id, jobId: live.id })).state).toBe("running")
})

test("a write lock left by a Studio that was ended is cleared on the next start; one a running Studio holds is said in plain words, and the call after it is gone works without a restart", async () => {
  const result = await setup()
  const created = await result.service.createProject({ name: "Deer", description: "" })
  const lock = path.join(created.directory, ".minemods", "write.lock")
  const sign = (pid: number) => mkdir(lock).then(() => Bun.write(path.join(lock, "owner.json"), JSON.stringify({ pid, token: "another-studio", host: os.hostname(), at: new Date().toISOString() })))
  // Ended in the middle of a write: the process that signed the lock is gone, so the restarted Studio takes it and opens the project.
  const ended = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
  await once(ended, "exit")
  await sign(ended.pid!)
  const restarted = await createStudioService(result.options)
  expect((await restarted.openProject(created.project.id)).project.id).toBe(created.project.id)
  expect(await stat(lock).catch(() => null)).toBeNull()
  // Held by a Studio that is running: refused, with what it is and what to do, not 「操作未完成」 and a line of code.
  const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" })
  const again = await createStudioService(result.options)
  try {
    await sign(other.pid!)
    const refused = await again.openProject(created.project.id).then(
      () => null,
      (error: unknown) => error,
    )
    expect(publicError(refused)).toBe(`这一步没有做，工程文件没有动。这个工程正被另一个 MineMods Studio（进程号 ${other.pid}）写着：等它写完再试；一直这样，就关掉另一个 Studio 窗口再试。`)
    expect(publicError(refused)).not.toContain("操作未完成")
    // The same refusal again while it is still held (the failure is not what is remembered: each call asks the lock anew).
    await expect(again.openProject(created.project.id)).rejects.toThrow(/write lock/i)
  } finally {
    other.kill()
    await once(other, "exit")
  }
  // The two refusals that name the lock folder spell its path whole (r15 said 「.minemodswrite.lock」: a backslash lost in a template string).
  for (const refusal of [new ProjectLockedError(null, null), new ProjectLockedError({ pid: 1, token: "elsewhere", host: "another-computer", at: new Date().toISOString() }, null)]) expect(publicError(refusal)).toContain([".minemods", "write.lock"].join(String.fromCharCode(92)))
  // The other Studio is gone: the very next call of the same session opens the project. Before, the first failure was kept until Studio was restarted.
  expect((await again.openProject(created.project.id)).project.id).toBe(created.project.id)
  expect(await stat(lock).catch(() => null)).toBeNull()
})

test("environment reveals only availability flags and no provider credentials", async () => {
  const result = await setup()
  const service = await createStudioService({
    ...result.options,
    ai: { apiKey: "private-test-value", baseUrl: "https://private-provider.example/v1" },
  })
  const environment = await service.environment()
  expect(environment.aiConfigured).toBe(true)
  expect(environment.model).toBe("gpt-6-astra")
  expect(JSON.stringify(environment)).not.toContain("private-test-value")
  expect(JSON.stringify(environment)).not.toContain("private-provider.example")
})

test("manual model edits persist new geometry and atlas with manual provenance", async () => {
  const result = await setup()
  const created = await result.service.createProject({ name: "蘑菇牛", description: "" })
  const example = await result.service.useExample({
    projectId: created.project.id,
    expectedRevision: created.project.revision,
  })
  const model = structuredClone(example.model!)
  const cube = model.bones.flatMap((bone) => bone.cubes)[0]!
  cube.faces.north = "#123456"
  const saved = await result.service.saveModel({
    projectId: example.project.id,
    expectedRevision: example.project.revision,
    model,
  })
  expect(saved.model).toEqual(model)
  expect(saved.model_origin).toBe("manual")
  expect(saved.preview?.textureDataUrl).toMatch(/^data:image\/png;base64,/)
  expect(saved.preview?.textureDataUrl).not.toBe(example.preview?.textureDataUrl)
  await expect(
    result.service.saveModel({ projectId: example.project.id, expectedRevision: example.project.revision, model }),
  ).rejects.toThrow()
  expect((await result.service.openProject(example.project.id)).project.revision).toBe(saved.project.revision)
})

test("IPC input cannot select a destination path, provider or provenance", () => {
  expect(
    StudioRequestSchema.safeParse({
      method: "exportSourceTo",
      input: { projectId: "never", destination: "C:\\outside" },
    }).success,
  ).toBe(false)
  expect(
    StudioRequestSchema.safeParse({
      method: "generateModel",
      input: { projectId: crypto.randomUUID(), expectedRevision: 1, prompt: "deer", model: "different" },
    }).success,
  ).toBe(false)
  expect(
    StudioRequestSchema.safeParse({
      method: "useExample",
      input: { projectId: crypto.randomUUID(), expectedRevision: 1, origin: "gpt-6-astra" },
    }).success,
  ).toBe(false)
})

test("invalid AI service configuration does not prevent local editing", async () => {
  const result = await setup()
  const service = await createStudioService({
    ...result.options,
    ai: { serviceUrl: "not-a-service-url", serviceToken: "private-test-value" },
  })
  const project = await service.createProject({ name: "Local project", description: "" })
  expect(project.project.name).toBe("Local project")
  await expect(
    service.generateModel({
      projectId: project.project.id,
      expectedRevision: project.project.revision,
      prompt: "deer",
    }),
  ).rejects.toThrow()
  expect(await listJobs(project.directory)).toHaveLength(0)
})

test("a model that cannot compile to its texture atlas never replaces the saved asset", async () => {
  const result = await setup()
  const created = await result.service.createProject({ name: "蘑菇牛", description: "" })
  const example = await result.service.useExample({
    projectId: created.project.id,
    expectedRevision: created.project.revision,
  })
  const model = structuredClone(example.model!)
  model.texture_size = 64
  const cube = model.bones.flatMap((bone) => bone.cubes)[0]!
  cube.origin = [0, 0, 0]
  cube.size = [200, 1, 1]
  await expect(
    result.service.saveModel({ projectId: example.project.id, expectedRevision: example.project.revision, model }),
  ).rejects.toThrow(/纹理/)
  expect(await result.service.openProject(example.project.id)).toEqual(example)
})

test("shutdown stops accepting IPC work and waits for a real in-flight generation to cancel", async () => {
  const setupResult = await setup()
  const reached: { resolve?: () => void } = {}
  const requestReached = new Promise<void>((resolve) => {
    reached.resolve = resolve
  })
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      reached.resolve?.()
      return new Promise<Response>((resolve) =>
        request.signal.addEventListener("abort", () => resolve(new Response(null, { status: 499 })), { once: true }),
      )
    },
  })
  const service = await createStudioService({
    ...setupResult.options,
    ai: { serviceUrl: server.url.toString(), serviceToken: "shutdown-fixture" },
  })
  const lifecycle = createWorkerLifecycle(() => service.dispose())
  try {
    const created = await lifecycle.accept(() => service.createProject({ name: "Shutdown", description: "" }))
    const job = await lifecycle.accept(() =>
      service.generateModel({
        projectId: created.project.id,
        expectedRevision: created.project.revision,
        prompt: "deer",
      }),
    )
    await requestReached
    await lifecycle.shutdown()
    expect((await service.getJob({ projectId: created.project.id, jobId: job.jobId })).state).toBe("canceled")
    await expect(lifecycle.accept(() => service.createProject({ name: "Too late", description: "" }))).rejects.toThrow(
      /关闭/,
    )
    expect(await service.listProjects()).toHaveLength(1)
    expect((await service.openProject(created.project.id)).model).toBeNull()
  } finally {
    await lifecycle.shutdown()
    server.stop(true)
  }
})

test("graceful shutdown waits for an owned process tree to exit without forced worker termination", async () => {
  const controller = new AbortController()
  const reached: { resolve?: () => void } = {}
  const running = new Promise<void>((resolve) => {
    reached.resolve = resolve
  })
  const descendant: { pid?: number } = {}
  const processResult = runOwnedProcess(
    process.execPath,
    [
      "-e",
      [
        "const {spawn}=require('node:child_process');",
        "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});",
        "console.log(child.pid);setInterval(()=>{},1000);",
      ].join(""),
    ],
    {
      signal: controller.signal,
      onProgress: (text) => {
        descendant.pid = Number(text.trim())
        reached.resolve?.()
      },
    },
  ).catch((error: unknown) => {
    expect(String(error)).toContain("CANCELLED")
  })
  await running
  expect(
    await shutdownWithin(
      async () => {
        controller.abort()
        await processResult
      },
      () => {
        throw new Error("Unexpected forced termination")
      },
      3000,
    ),
  ).toBe(true)
  expect(descendant.pid).toBeGreaterThan(0)
  expect(() => process.kill(descendant.pid!, 0)).toThrow()
})

test("shutdown deadline force-terminates a stuck worker process", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { windowsHide: true, stdio: "ignore" })
  const exited = once(child, "exit")
  await once(child, "spawn")
  try {
    expect(
      await shutdownWithin(
        () => new Promise<void>(() => undefined),
        () => {
          child.kill()
        },
        40,
      ),
    ).toBe(false)
    await exited
    expect(child.killed).toBe(true)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }
})

test("reopening restores current completed build metadata and editing invalidates the restored build", async () => {
  const result = await setup()
  const created = await result.service.createProject({ name: "Build restoration", description: "" })
  expect(created.latest_build_job_id).toBeNull()
  const saved = await result.service.useExample({
    projectId: created.project.id,
    expectedRevision: created.project.revision,
  })
  const queued = await startJob(saved.directory, { kind: "build", expectedRevision: saved.project.revision })
  const running = await updateJob(saved.directory, queued.id, { state: "running", expectedRevision: 0 })
  const warnings = [
    { rule: "model_missing", about: "石像", text: "模型缺失", fix: "", severity: "defect" },
    { rule: "asset_unused", about: "铃声", text: "还没用到", fix: "", severity: "advice" },
  ]
  // Synthetic completed metadata tests UI restoration only; final artifact checks still occur on export/playtest.
  await updateJob(saved.directory, queued.id, {
    state: "completed",
    expectedRevision: running.revision,
    output: {
      id: crypto.randomUUID(),
      revision: saved.project.revision,
      warnings,
      jarPath: path.join(saved.directory, "fixture.jar"),
      projectDirectory: saved.directory,
      sourceDirectory: saved.directory,
      sha256: "0".repeat(64),
    },
  })
  const restarted = await createStudioService(result.options)
  expect(await restarted.openProject(saved.project.id)).toMatchObject({ latest_build_job_id: queued.id, latest_build_warnings: warnings })
  await saveProject(
    saved.directory,
    { ...saved.project, description: "Changed since the build" },
    saved.project.revision,
  )
  expect(await restarted.openProject(saved.project.id)).toMatchObject({ latest_build_job_id: null, latest_build_warnings: [] })
})

test("JAR delivery verifies and copies a build without touching its generated folder", async () => {
  const { service } = await setup()
  const made = await service.createProject({ name: "铜/守卫:夜巡", description: "", empty: true })
  const root = await realpath(made.directory)
  const id = randomUUID()
  const sourceDirectory = path.join(root, "generated", `build-${id}`)
  const jarPath = path.join(sourceDirectory, "build", "libs", jarName(made.project))
  const bytes = Buffer.from("fixture archive bytes")
  await mkdir(path.dirname(jarPath), { recursive: true })
  await writeFile(jarPath, bytes)
  const output = {
    id, revision: made.project.revision, jarPath, projectDirectory: root, sourceDirectory,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
  await writeRecord(root, [".minemods", "builds", id + ".json"], output)
  const queued = await startJob(root, { kind: "build", expectedRevision: made.project.revision })
  const running = await updateJob(root, queued.id, { state: "running", expectedRevision: queued.revision })
  await updateJob(root, queued.id, { state: "completed", expectedRevision: running.revision, output })
  const name = "铜-守卫-夜巡-0.1.0.jar"
  expect(await service.jarHandoff(made.project.id, queued.id, false)).toBe(name)
  const [first, second] = await Promise.all([
    service.jarHandoff(made.project.id, queued.id, true),
    service.jarHandoff(made.project.id, queued.id, true),
  ])
  expect(first).toBe(path.join(root, "打包产物", id, name))
  expect(second).toBe(first)
  expect(await readFile(first)).toEqual(bytes)
  expect(await readdir(path.dirname(jarPath))).toEqual([path.basename(jarPath)])
  expect(await readFile(jarPath)).toEqual(bytes)
  await writeFile(first, "changed")
  await expect(service.jarHandoff(made.project.id, queued.id, true)).rejects.toThrow("已交付的模组文件被修改过")
}, 30000)

test("build reuses the queued job for the current project revision", async () => {
  const result = await setup()
  const created = await result.service.createProject({ name: "Build dedupe", description: "" })
  const saved = await result.service.useExample({
    projectId: created.project.id,
    expectedRevision: created.project.revision,
  })
  const staleJob = await startJob(saved.directory, { kind: "build", expectedRevision: saved.project.revision })
  const bumped = await saveProject(
    saved.directory,
    { ...saved.project, description: "当前版本" },
    saved.project.revision,
  )
  const currentJob = await startJob(saved.directory, { kind: "build", expectedRevision: bumped.revision })
  const future = new Date(Date.now() + 1000).toISOString()
  await writeRecord(saved.directory, [".minemods", "jobs", `${staleJob.id}.json`], {
    ...staleJob,
    created_at: future,
    updated_at: future,
  })
  const before = await listJobs(saved.directory)
  const requests = await Promise.all([
    result.service.buildProject({ projectId: created.project.id }),
    result.service.buildProject({ projectId: created.project.id }),
  ])
  expect(requests).toEqual([{ jobId: currentJob.id }, { jobId: currentJob.id }])
  expect(await listJobs(saved.directory)).toHaveLength(before.length)
})

test("known runtime failures give Chinese recovery steps without exposing unknown error details", () => {
  expect(publicError(new Error("EXPLICIT_JAVA_17_REQUIRED_ON_THIS_PLATFORM"))).toContain("Java 17")
  expect(publicError(new Error("DOWNLOAD_TIMEOUT"))).not.toContain("21")
  expect(publicError(new Error("JAVA_21_REQUIRED"))).toContain("Java 21")
  expect(publicError(new Error("DOWNLOAD_FAILED"))).toContain("代理")
  expect(publicError(new Error("STALE_BUILD_REVISION"))).toContain("重新构建")
  expect(publicError(new Error("BUILD_CHECKSUM_MISMATCH"))).toContain("重新构建")
  expect(publicError(new Error("GRADLE_BUILD_FAILED"))).toContain("进度")
  expect(publicError(Object.assign(new Error("private-path private-api-key"), { code: "EEXIST" }))).toContain("同名")
  expect(publicError(new Error("unknown private-api-key"))).not.toContain("private-api-key")
  expect(publicError(new Error("DOWNLOAD_FAILED private-api-key"))).not.toContain("private-api-key")
  // epic game1: an unknown failure says what kind it was and where in Studio's code, never its message or a folder.
  const thrown = new TypeError("private-api-key at C:\\Users\\someone")
  thrown.stack = "TypeError: private-api-key at C:\\Users\\someone\n    at prepare (C:\\Users\\someone\\studio\\out\\scene-check.js:212:9)\n    at node:internal/process:1:1"
  const said = publicError(thrown)
  expect(said).toContain("（TypeError，在 scene-check.js:212）")
  expect(said).not.toContain("private-api-key")
  expect(said).not.toContain("someone")
})

test("a model from a modelling service that did not judge it is still held to the acceptance standard at the door", async () => {
  // The 蓝晶 guardian: the real AI output that was once saved and should never have been.
  const rejected = (await Bun.file(new URL("../../studio-ai/test/fixtures/look/bad/lanjing-guard.json", import.meta.url)).json()).model
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) =>
      Response.json({
        design: rejected,
        revision: ((await request.json()) as { revision: string }).revision,
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        provenance: { provider: "openai", model: "older-gateway", reasoning_effort: "high", response_id: "fixture", task_id: "fixture", user_id: "fixture", created_at: new Date().toISOString(), attempt: 1 },
      }),
  })
  try {
    const result = await setup()
    const service = await createStudioService({ ...result.options, ai: { serviceUrl: server.url.toString(), serviceToken: "fixture-token" } })
    const created = await service.createProject({ name: "验收口", description: "" })
    const job = await service.generateModel({ projectId: created.project.id, expectedRevision: created.project.revision, prompt: "做一只蓝晶守卫" })
    for (let attempt = 0; attempt < 200 && ["queued", "running"].includes((await service.getJob({ projectId: created.project.id, jobId: job.jobId })).state); attempt += 1) await Bun.sleep(10)
    const finished = await service.getJob({ projectId: created.project.id, jobId: job.jobId })
    expect(finished.state).toBe("failed")
    expect(finished.error).toMatch(/^模型没通过检查，工程里什么都没有改动。1\. 【(不凑数|不机械|认得出|有主次|站得住)】/)
    const after = await service.openProject(created.project.id)
    expect(after.model).toBeNull()
    expect(after.project.revision).toBe(created.project.revision)
  } finally {
    server.stop(true)
  }
})

test("发布信息：存进工程、空的不留、写错的用一句人话说出来，改过的工程不被旧版本覆盖", async () => {
  const { service } = await setup()
  const created = await service.createProject({ name: "发布信息工程", description: "", empty: true })
  const projectId = created.project.id
  expect(created.project.release).toBeUndefined()
  const saved = await service.saveRelease({ projectId, expectedRevision: created.project.revision, release: { author: " 小铜 ", version: "1.2.0-beta.1", license: "CC0-1.0", homepage: "https://example.org/mod" } })
  expect(saved.project.release).toEqual({ author: "小铜", version: "1.2.0-beta.1", license: "CC0-1.0", homepage: "https://example.org/mod" })
  expect(saved.project.revision).toBe(created.project.revision + 1)
  expect((await service.openProject(projectId)).project.release).toEqual(saved.project.release)
  // The same call through the window's own door.
  const again = (await dispatchStudioRequest(service, { method: "saveRelease", input: { projectId, expectedRevision: saved.project.revision, release: { version: "2.0.0" } } })) as typeof saved
  expect(again.project.release).toEqual({ version: "2.0.0" })
  // A save from a copy read before that one: refused, and what is stored stays.
  const stale = await service.saveRelease({ projectId, expectedRevision: saved.project.revision, release: { author: "别人" } }).catch((error: unknown) => error)
  expect(publicError(stale)).toBe(REVISION_CONFLICT)
  expect(REVISION_CONFLICT).toContain("工程内容已更新")
  for (const [release, words] of [[{ version: "1.0" }, "版本号写成 1.0.0 这样的三段数字"], [{ homepage: "http://example.org" }, "链接要以 https:// 开头"]] as const)
    expect(publicError(await service.saveRelease({ projectId, expectedRevision: again.project.revision, release }).catch((error: unknown) => error))).toContain(words)
  expect((await service.openProject(projectId)).project.release).toEqual({ version: "2.0.0" })
  // Everything emptied: no release is stored at all, as in a project from before there was one.
  const cleared = await service.saveRelease({ projectId, expectedRevision: again.project.revision, release: {} })
  expect(cleared.project.release).toBeUndefined()
  expect("release" in JSON.parse(await readFile(path.join(cleared.directory, "minemods.project.json"), "utf8"))).toBe(false)
})

test("改名：只改显示的名字，模组 ID 不动；旧版本的改名被拒绝", async () => {
  const { service } = await setup()
  const created = await service.createProject({ name: "Copper Aviary", description: "", empty: true })
  const projectId = created.project.id
  const renamed = await service.renameProject({ projectId, expectedRevision: created.project.revision, name: "  赤铜飞行社  " })
  expect(renamed.project.name).toBe("赤铜飞行社")
  expect(renamed.project.mod_id).toBe(created.project.mod_id)
  expect(renamed.directory).toBe(created.directory)
  expect((await service.listProjects()).map((entry) => entry.project.name)).toEqual(["赤铜飞行社"])
  expect(publicError(await service.renameProject({ projectId, expectedRevision: created.project.revision, name: "又一个" }).catch((error: unknown) => error))).toBe(REVISION_CONFLICT)
  await expect(service.renameProject({ projectId, expectedRevision: renamed.project.revision, name: "   " })).rejects.toThrow("工程名字要写 1 到 120 个字。")
  await expect(dispatchStudioRequest(service, { method: "renameProject", input: { projectId, expectedRevision: renamed.project.revision, name: "" } })).rejects.toThrow()
  expect((await service.openProject(projectId)).project.name).toBe("赤铜飞行社")
})

test("删除：工程文件夹整个移进「已删除」，一个文件都不少；列表里没有了；有事情在进行时不让删", async () => {
  const { options, service } = await setup()
  const kept = await service.createProject({ name: "留下的工程", description: "", empty: true })
  const created = await service.createProject({ name: 'a/b:c*?"<>|', description: "", empty: true })
  const projectId = created.project.id
  // A job that has not ended: nothing is moved, and the sentence says why.
  const job = await startJob(created.directory, { kind: "build", expectedRevision: created.project.revision })
  await expect(service.deleteProject({ projectId })).rejects.toThrow("这个工程里还有事情正在进行。等它结束或者先取消，再删除。")
  expect((await service.listProjects()).map((entry) => entry.project.id).sort()).toEqual([kept.project.id, projectId].sort())
  await service.cancelJob({ projectId, jobId: job.id })
  const before = (await readdir(created.directory, { recursive: true })).sort()
  expect(before).toContain("minemods.project.json")
  const { moved } = (await dispatchStudioRequest(service, { method: "deleteProject", input: { projectId } })) as { moved: string }
  const workspace = await realpath(options.workspaceDirectory)
  expect(path.dirname(moved)).toBe(path.join(workspace, DELETED_FOLDER))
  // The name as a folder every system takes, then when it was deleted.
  expect(path.basename(moved)).toMatch(/^a_b_c______-\d{8}-\d{6}$/)
  const after = await readdir(moved, { recursive: true })
  for (const name of before) expect(after).toContain(name)
  await expect(stat(created.directory)).rejects.toThrow()
  expect((await service.listProjects()).map((entry) => entry.project.id)).toEqual([kept.project.id])
  await expect(service.openProject(projectId)).rejects.toThrow("找不到这个工程，请刷新工程列表。")
  // A second service on the same folder (the app started again) does not list it either, and the other project is untouched.
  const restarted = await createStudioService(options)
  expect((await restarted.listProjects()).map((entry) => entry.project.id)).toEqual([kept.project.id])
  expect((await restarted.openProject(kept.project.id)).project.name).toBe("留下的工程")
})

test("删除：放在别处的工程移进它自己旁边的「已删除」，记下的位置也一起去掉", async () => {
  const { options, service } = await setup()
  const elsewhere = path.join(path.dirname(options.workspaceDirectory), "elsewhere")
  await mkdir(elsewhere, { recursive: true })
  const token = randomUUID()
  await service.registerLocation(token, elsewhere)
  const created = await service.createProject({ name: "别处的工程", description: "", empty: true, locationToken: token })
  expect(path.dirname(created.directory)).toBe(await realpath(elsewhere))
  const { moved } = await service.deleteProject({ projectId: created.project.id })
  expect(path.dirname(moved)).toBe(path.join(await realpath(elsewhere), DELETED_FOLDER))
  expect(JSON.parse(await readFile(path.join(await realpath(options.workspaceDirectory), "studio-locations.json"), "utf8"))).toEqual([])
  expect(await (await createStudioService(options)).listProjects()).toEqual([])
})
