import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createStudioService } from "../src/main/service"
import { ConceptionEntrySchema, ConceptionPlanSchema, type ConceptionEntry } from "@minemods/mod-core/conception"

const directories: string[] = []
const servers: ReturnType<typeof Bun.serve>[] = []
afterEach(async () => {
  servers.splice(0).forEach(server => server.stop(true))
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function setup(withAi = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-authoring-"))
  directories.push(root)
  const ai = withAi ? { apiKey: "fixture-key", baseUrl: "http://127.0.0.1:0/v1" } : {}
  const service = await createStudioService({ workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai })
  return { service, options: { workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai } }
}

function plan() {
  return ConceptionPlanSchema.parse({ name: "月光森林", worldview: "会呼吸的森林", entries: [
    { key: "moon_deer", kind: "entity", title: "月鹿", brief: "温和的森林生物", relationships: ["与月光草相关"] },
    { key: "moon_recipe", kind: "recipe", title: "月光酿造", brief: "把月露封入瓶中", relationships: ["需要月鹿掉落物"] },
  ], questions: [] })
}

function reviewResponse() {
  return Response.json({ model: "gpt-6-astra", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ summary: "审阅完成", sections: [{ title: "制作", body: "保留完整输入与行为。" }], questions: [] }) }] }] })
}

test("persists conception, imports legacy plans idempotently, and links multiple entities", async () => {
  const { service } = await setup()
  const created = await service.createProject({ name: "旧项目", description: "" })
  const first = await service.importConception({ projectId: created.project.id, expectedRevision: created.project.revision, plan: plan() })
  const firstIds = first.project.conception.entries.map(entry => entry.id)
  expect(first.project.entities).toHaveLength(2)
  const second = await service.importConception({ projectId: first.project.id, expectedRevision: first.project.revision, plan: plan() })
  expect(second.project.entities).toHaveLength(2)
  expect(second.project.conception.entries.map(entry => entry.id)).toEqual(firstIds)
  const extra = await service.addEntity({ projectId: second.project.id, expectedRevision: second.project.revision, name: "星鹿" })
  const saved = await service.saveConception({ projectId: extra.project.id, expectedRevision: extra.project.revision, conception: { ...extra.project.conception, brief: "保留旧项目设定" } })
  expect(saved.project.conception.brief).toBe("保留旧项目设定")
  expect(saved.project.entities).toHaveLength(3)
})

test("preserves recipe 3x3 empties and custom container multi input/output through saveEntry", async () => {
  const { service } = await setup()
  const created = await service.createProject({ name: "配方项目", description: "" })
  const entry = ConceptionEntrySchema.parse({ id: crypto.randomUUID(), kind: "recipe", title: "月光酿造", brief: "自定义容器", recipe: { recipe_type: "custom", input_names: ["月露", "玻璃瓶", "", "", "木炭", "", "", "", "星尘"], output_name: "月光药水", output_names: ["月光药水", "空瓶"], count: 2, fuel: "木炭", duration: "20s", container_description: "带木塞的酿造台", intent: "多输入多输出" } })
  const saved = await service.saveEntry({ projectId: created.project.id, expectedRevision: created.project.revision, entry })
  const actual = saved.project.conception.entries.find(value => value.id === entry.id) as ConceptionEntry | undefined
  expect(actual?.kind).toBe("recipe")
  if (actual?.kind !== "recipe" || !("recipe" in actual)) throw new Error("recipe entry missing")
  const recipe = (actual as Extract<ConceptionEntry, { kind: "recipe" }>).recipe
  expect(recipe.input_names).toEqual(["月露", "玻璃瓶", "", "", "木炭", "", "", "", "星尘"])
  expect(recipe.output_names).toEqual(["月光药水", "空瓶"])
  expect(recipe.container_description).toBe("带木塞的酿造台")
})

test("sends complete entry behavior context, requires confirmed model, and awaits async review", async () => {
  const requests: string[] = []
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => { requests.push(await request.text()); return reviewResponse() } })
  servers.push(server)
  const { service, options } = await setup()
  const configured = await createStudioService({ ...options, ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1` } })
  const created = await configured.createProject({ name: "行为项目", description: "" })
  const imported = await configured.importConception({ projectId: created.project.id, expectedRevision: created.project.revision, plan: plan() })
  const entity = imported.project.conception.entries.find(value => value.kind === "entity")!
  await expect(configured.reviewEntry({ projectId: imported.project.id, expectedRevision: imported.project.revision, entry: entity, behavior: true })).rejects.toThrow(/确认/)
  const currentAfterReject = await configured.openProject(imported.project.id)
  const model = await configured.useExample({ projectId: imported.project.id, expectedRevision: currentAfterReject.project.revision })
  const confirmed = { ...entity, behavior_brief: "夜间跟随玩家，遇到危险时先退后再展翼。", review: { summary: "已有普通审阅", sections: [{ title: "已有", body: "保留" }], questions: [] }, entity_id: model.project.entities[0]!.id, model_confirmed_asset_id: model.project.entities[0]!.model_asset_id }
  const started = await configured.reviewEntry({ projectId: model.project.id, expectedRevision: model.project.revision, entry: confirmed, behavior: true })
  let job = await configured.getJob({ projectId: model.project.id, jobId: started.jobId })
  while (job.state === "queued" || job.state === "running") { await Bun.sleep(5); job = await configured.getJob({ projectId: model.project.id, jobId: started.jobId }) }
  expect(job.state, job.error ?? undefined).toBe("completed")
  const body = JSON.parse(requests.at(-1)!) as { input: { content: [{ text: string }] }[] }
  const sent = JSON.parse(body.input[0]!.content[0]!.text) as { entry: ConceptionEntry; behavior: boolean; animations: string[] }
  expect(sent.behavior).toBe(true)
  expect("recipe" in sent.entry).toBe(false)
  expect(sent.animations).toEqual(["idle", "walk", "hurt"])
  expect((await configured.openProject(model.project.id)).project.conception.entries.find(value => value.id === entity.id)?.behavior_review?.summary).toBe("审阅完成")
  expect((await configured.openProject(model.project.id)).project.conception.entries.find(value => value.id === entity.id)?.review?.summary).toBe("已有普通审阅")
  expect(JSON.stringify(requests)).not.toContain("fixture-key")
  void service
})

test("rejects wrong model authoring responses without changing an existing review", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ model: "gpt-5", status: "completed", output: [] }) })
  servers.push(server)
  const { service, options } = await setup()
  const configured = await createStudioService({ ...options, ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1` } })
  const created = await configured.createProject({ name: "拒绝项目", description: "" })
  const entry = ConceptionEntrySchema.parse({ id: crypto.randomUUID(), kind: "item", title: "月尘", brief: "已有审阅", review: { summary: "旧审阅", sections: [{ title: "旧", body: "保留" }], questions: [] } })
  const saved = await configured.saveEntry({ projectId: created.project.id, expectedRevision: created.project.revision, entry })
  const started = await configured.reviewEntry({ projectId: saved.project.id, expectedRevision: saved.project.revision, entry, behavior: false })
  let job = await configured.getJob({ projectId: saved.project.id, jobId: started.jobId })
  while (job.state === "queued" || job.state === "running") { await Bun.sleep(5); job = await configured.getJob({ projectId: saved.project.id, jobId: started.jobId }) }
  expect(job.state).toBe("failed")
  expect((await configured.openProject(saved.project.id)).project.conception.entries.find(value => value.id === entry.id)?.review?.summary).toBe("旧审阅")
  void service
})

test("preserves existing review fields when a failed review receives a null review draft", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ model: "gpt-5", status: "completed", output: [] }) })
  servers.push(server)
  const { options } = await setup()
  const configured = await createStudioService({ ...options, ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1` } })
  const created = await configured.createProject({ name: "保留审阅", description: "" })
  const old = ConceptionEntrySchema.parse({ id: crypto.randomUUID(), kind: "item", title: "月尘", brief: "旧 brief", review: { summary: "旧内容审阅", sections: [{ title: "旧内容", body: "保留" }], questions: [] }, behavior_review: { summary: "旧行为审阅", sections: [{ title: "旧行为", body: "保留" }], questions: [] } })
  const saved = await configured.saveEntry({ projectId: created.project.id, expectedRevision: created.project.revision, entry: old })
  const incoming = { ...old, brief: "用户修改后的 brief", review: null, behavior_review: null }
  const started = await configured.reviewEntry({ projectId: saved.project.id, expectedRevision: saved.project.revision, entry: incoming, behavior: false })
  let job = await configured.getJob({ projectId: saved.project.id, jobId: started.jobId })
  while (job.state === "queued" || job.state === "running") { await Bun.sleep(5); job = await configured.getJob({ projectId: saved.project.id, jobId: started.jobId }) }
  expect(job.state).toBe("failed")
  const entry = (await configured.openProject(saved.project.id)).project.conception.entries.find(value => value.id === old.id)!
  expect(entry.brief).toBe("用户修改后的 brief")
  expect(entry.review?.summary).toBe("旧内容审阅")
  expect(entry.behavior_review?.summary).toBe("旧行为审阅")
})

test("successful content review replaces only its field and keeps behavior review", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => reviewResponse() })
  servers.push(server)
  const { options } = await setup()
  const configured = await createStudioService({ ...options, ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1` } })
  const created = await configured.createProject({ name: "双审阅", description: "" })
  const entry = ConceptionEntrySchema.parse({ id: crypto.randomUUID(), kind: "item", title: "月尘", brief: "内容设计", review: { summary: "来稿旧", sections: [{ title: "旧", body: "旧" }], questions: [] }, behavior_review: { summary: "行为旧", sections: [{ title: "行为", body: "保留" }], questions: [] } })
  const saved = await configured.saveEntry({ projectId: created.project.id, expectedRevision: created.project.revision, entry })
  const started = await configured.reviewEntry({ projectId: saved.project.id, expectedRevision: saved.project.revision, entry: { ...entry, review: null, behavior_review: null }, behavior: false })
  let job = await configured.getJob({ projectId: saved.project.id, jobId: started.jobId })
  while (job.state === "queued" || job.state === "running") { await Bun.sleep(5); job = await configured.getJob({ projectId: saved.project.id, jobId: started.jobId }) }
  expect(job.state).toBe("completed")
  const actual = (await configured.openProject(saved.project.id)).project.conception.entries.find(value => value.id === entry.id)!
  expect(actual.review?.summary).toBe("审阅完成")
  expect(actual.behavior_review?.summary).toBe("行为旧")
})
