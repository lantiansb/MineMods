import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { REFERENCE_LISTING_LIMIT, referenceChoices, validateContent } from "@minemods/mod-core/content"
import { REFUSAL_CAP } from "@minemods/mod-core/acceptance"
import { saveable } from "@minemods/mod-core/making"
import { createProject, openProject, saveProject } from "@minemods/mod-core/project"
import { applyWorkspaceAsset, WorkspaceAssetSchema } from "@minemods/mod-core/workspace"
import { refusedWords } from "../src/main/external-dispatch"
import { plainSave } from "../src/main/plain-content"
import { createProjectRunner } from "../src/main/project-runner"

const directories: string[] = []
const servers: ReturnType<typeof Bun.serve>[] = []
afterEach(async () => {
  servers.splice(0).forEach((server) => server.stop(true))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const at = "2026-10-19T08:00:00.000Z"
const response = (value: unknown) =>
  Response.json({ model: "gpt-6-astra", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(value) }] }] })
const recipeOf = (result: string) => ({ kind: "recipe", name: "合成果冻方块", pattern: ["minecraft:slime_ball", "minecraft:slime_ball", null, "minecraft:slime_ball", "minecraft:slime_ball", null, null, null, null], result, count: 1, type: "shaped" })

/** A project whose mod id is the kind a Chinese name gets, with one block the recipe could make. */
async function withJellyBlock() {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-unknown-reference-"))
  directories.push(root)
  const directory = path.join(root, "project")
  const created = await createProject({ directory, name: "果冻世界", mod_id: "mod_18codjd" })
  const block = WorkspaceAssetSchema.parse({
    id: crypto.randomUUID(), module: "block", title: "果冻方块", revision: 1, created_at: at, updated_at: at, prompt: "做一个果冻方块", dependencies: [],
    document: { kind: "block", identifier: "jelly_block", name: "果冻方块", hardness: 1.5, luminance: 0, tool: "pickaxe", drop: "self", color: "#55cc88", texture: null },
    provenance: { model: null, request_id: null }, status: "design",
  })
  const project = await saveProject(directory, applyWorkspaceAsset(created, block), created.revision)
  return { directory, project }
}

async function ownAi(wrong: string) {
  const { directory, project } = await withJellyBlock()
  const heard: Record<string, unknown>[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const body = JSON.parse(await request.text()) as { input?: { content?: { text?: string }[] }[] }
      heard.push(JSON.parse(body.input?.[0]?.content?.[0]?.text ?? "{}"))
      return response(recipeOf(wrong))
    },
  })
  servers.push(server)
  const runner = createProjectRunner({
    directoryFor: async (projectId) => {
      if (projectId !== project.id) throw new Error("unknown project")
      return directory
    },
    ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1`, retryWait: [0, 0] },
  })
  return { directory, project, heard, runner }
}

test("做配方的 AI 一开始就拿到本模组的命名空间和每个方块、物品的完整 id", async () => {
  const { project, heard, runner } = await ownAi("jellyland:jelly_block")
  await runner.start({ projectId: project.id, expectedRevision: project.revision, prompt: "做一个合成果冻方块的配方", module: "recipe" })
  for (let attempt = 0; attempt < 200 && !heard.length; attempt += 1) await Bun.sleep(10)
  const given = heard[0]!.project as { mod_id: string; content: { blocks: { reference: string }[] } }
  expect(given.mod_id).toBe("mod_18codjd")
  expect(given.content.blocks.map((block) => block.reference)).toEqual(["mod_18codjd:jelly_block"])
  await runner.dispose()
})

test("引用了不存在的内容：退回给 AI 的话里有能用的完整 id，给用户的话里没有字段路径和英文", async () => {
  const { directory, project, heard, runner } = await ownAi("rainbow_jelly:jelly_block")
  const started = await runner.start({ projectId: project.id, expectedRevision: project.revision, prompt: "做一个合成果冻方块的配方", module: "recipe" })
  let finished = await runner.get({ projectId: project.id, runId: started.id })
  for (let attempt = 0; attempt < 400 && finished.state !== "failed"; attempt += 1) {
    await Bun.sleep(10)
    finished = await runner.get({ projectId: project.id, runId: started.id })
  }
  expect(heard.length).toBe(REFUSAL_CAP)
  // What the AI is handed back: the id that exists, written whole, with the project's own namespace.
  const repair = heard[1]!.revision_required as { issues: { message: string }[] }
  expect(repair.issues[0]!.message).toContain("mod_18codjd:jelly_block（果冻方块）")
  expect(repair.issues[0]!.message).toContain("命名空间是 mod_18codjd")
  // What the person is told: their words, no path, no English.
  const error = finished.tasks[0]!.error!
  expect(error).toStartWith("这一版照现在的样子存不进工程，提交会被拒绝：")
  expect(error).toContain("配方「合成果冻方块」用到了「jelly_block」")
  expect(error).toContain("这个任务已经被退回 4 次")
  expect(error).not.toContain("recipes.0")
  expect(error).not.toMatch(/Unknown|reference|[A-Za-z_]+\.\d/)
  expect((await openProject(directory)).revision).toBe(project.revision)
  await runner.dispose()
})

test("外面的 AI 交上来也一样：它拿到能用的 id，卡片上是白话", async () => {
  const { project, runner } = await ownAi("jellyland:jelly_block")
  const started = await runner.startExternal({
    projectId: project.id,
    expectedRevision: project.revision,
    prompt: "做一个合成果冻方块的配方",
    plan: { summary: "配方", questions: [], tasks: [{ key: "work", module: "recipe", title: "配方", prompt: "配方", source: "配方", dependencies: [], target_id: null }] },
  })
  const ids = { projectId: project.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
  await runner.claimExternalTask(ids)
  const refused = async () => runner.commitExternalTask({ ...ids, document: recipeOf("jellyland:jelly_block") as never }).then(() => null, (error: unknown) => error)
  for (let attempt = 1; attempt < REFUSAL_CAP; attempt += 1) {
    const error = await refused()
    expect((error as Error).message).toContain("mod_18codjd:jelly_block（果冻方块）")
    const card = refusedWords(error)
    expect(card.plain).toBe(true)
    expect(card.message).not.toMatch(/recipes\.0|Unknown|reference|mod_18codjd/)
    expect(card.message).toContain("配方「合成果冻方块」用到了「jelly_block」")
  }
  const last = await refused()
  expect((last as Error).message).toContain("mod_18codjd:jelly_block（果冻方块）")
  expect(refusedWords(last).message).not.toMatch(/recipes\.0|Unknown|reference|mod_18codjd/)
  expect(refusedWords(last).message).toContain("这个任务已经被退回 4 次")
  const ended = await runner.get({ projectId: project.id, runId: started.run.id })
  expect(ended.tasks[0]!.error).not.toMatch(/recipes\.0|Unknown|reference/)
  expect(ended.tasks[0]!.error).toContain("配方「合成果冻方块」用到了「jelly_block」")
  await runner.dispose()
})

test("太多可以引用的时候，只列和写错的同名的那几个，带上命名空间", () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => ({ identifier: `thing_${index}`, name: `东西${index}` }))
  const source = { mod_id: "mod_18codjd", blocks: [{ identifier: "jelly_block", name: "果冻方块" }, ...many(REFERENCE_LISTING_LIMIT)], items: [] }
  const said = referenceChoices(["jellyland:jelly_block"], source)
  expect(said).toContain("mod_18codjd:jelly_block（果冻方块）")
  expect(said).not.toContain("thing_3")
  expect(referenceChoices(["jellyland:nothing_like_it"], source)).toContain("没有一样和写错的那几个同名")
  expect(referenceChoices(["a:b"], { mod_id: "mod_x", blocks: [], items: [] })).toContain("还没有任何方块或物品可以引用")
})

test("所有「引用了不存在内容」的退回都一样：配方的材料、规则找不到的生物", () => {
  const source = { mod_id: "mod_18codjd", blocks: [{ identifier: "jelly_block", name: "果冻方块" }], items: [{ identifier: "jelly_ball", name: "果冻球" }], entities: [{ id: "6f1b0f7e-5b7b-4c58-9d0c-2a3f4e5d6c7b", name: "果冻怪" }] }
  const content = (override: Record<string, unknown>) => validateContent({ blocks: [{ identifier: "jelly_block", name: "果冻方块", hardness: 1, luminance: 0, tool: "pickaxe", drop: "self", color: "#55cc88", id: crypto.randomUUID() }], items: [], recipes: [], logic: [], mod_id: "mod_18codjd", ...override })
  const material = saveable(() => content({ recipes: [{ id: crypto.randomUUID(), name: "合成", pattern: ["jellyland:jelly_ball", ...Array(8).fill(null)], result: "mod_18codjd:jelly_block", count: 1, type: "shapeless" }] }), { source })
  expect(material.ok ? "" : material.refusal.message).toContain("mod_18codjd:jelly_ball（果冻球）")
  const rule = saveable(() => content({ logic: [{ id: crypto.randomUUID(), entity_id: "00000000-0000-4000-8000-000000000000", trigger: "hurt", action: "look", enabled: true }] }), { source })
  expect(rule.ok ? "" : rule.refusal.message).toContain("6f1b0f7e-5b7b-4c58-9d0c-2a3f4e5d6c7b（果冻怪）")
})

test("带路径前缀的校验信息，白话映射照样认得", () => {
  const error = new z.ZodError([{ code: "custom", path: ["recipes", 0, "pattern", 3], message: "Unknown content reference: rainbow_jelly:jelly_block" }])
  const said = plainSave(error, { recipes: [{ name: "合成果冻方块" }], entities: [] })
  expect(said).toBe("配方「合成果冻方块」用到了「jelly_block」，可是模组里没有叫这个名字的方块或物品。先把它做出来，或者换成一样已经有的。")
  // The hand-editing form's sentences work under a path as well, and a schema error with no sentence of its own is said in general words.
  expect(plainSave(new z.ZodError([{ code: "custom", path: ["items", 2, "max_stack"], message: "工具不能叠放" }]))).toBe("工具不能叠放，一格只能放 1 个。")
  expect(plainSave(new z.ZodError([{ code: "custom", path: ["items", 2, "tool", "repair"], message: "Duplicate content identifier" }]))).not.toMatch(/items|Duplicate/)
  expect(plainSave(new z.ZodError([{ code: "invalid_type", expected: "string", path: ["recipes", 0, "result"], message: "Invalid input: expected string, received undefined" }]))).not.toMatch(/recipes|Invalid/)
})
