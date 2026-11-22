import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createProject, openProject, saveProject } from "@minemods/mod-core/project"
import { applyWorkspaceAsset, WorkspaceAssetSchema } from "@minemods/mod-core/workspace"
import { BOOK_INSTRUCTIONS } from "@minemods/mod-core/book"
import { MODULES } from "@minemods/mod-core/workspace-modules"
import { bannerTexture } from "../../mod-core/script/target-book-sample"
import { createProjectRunner } from "../src/main/project-runner"
import { getMcpCapabilities } from "../src/main/mcp-capabilities"
import { CLAIM_GUIDE } from "../src/main/mcp-guide-topics"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

test("外部 AI 的说明里写了书怎么写、上限和图从哪来", () => {
  expect(MODULES.book.instructions).toBe(BOOK_INSTRUCTIONS + MODULES.book.instructions.slice(BOOK_INSTRUCTIONS.length))
  for (const said of ["最多 64 页", "最多 16 字", "没有图的页最多 320 字，有图的页最多 160 字", "最多 60 字", "一行 30 个汉字", "没图的页正文 19 行，有图的页 6 行", "贴图（texture）资产的 UUID", "建议 432×216", "外部 AI 画不了像素图"])
    expect(MODULES.book.instructions).toContain(said)
  expect(CLAIM_GUIDE.book).toEqual(["making", "acceptance"])
  expect(getMcpCapabilities("medium").modules.find((module) => module.module === "book")).toMatchObject({ label: "书", capability: "runtime" })
})

test("外部 AI 通过任务建一本书、再改它：书页的图记进依赖，改的时候保持同一个资产", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-book-external-"))
  directories.push(root)
  const directory = path.join(root, "project")
  const created = await createProject({ directory, name: "图鉴工程", target: "neoforge-1.21.1" })
  const banner = WorkspaceAssetSchema.parse({ id: "b0000000-0000-4000-8000-0000000000a1", module: "texture", title: "横幅", revision: 1, created_at: "2026-11-20T00:00:00.000Z", updated_at: "2026-11-20T00:00:00.000Z", prompt: "横幅", dependencies: [], document: bannerTexture(), provenance: { model: null, request_id: null }, status: "design" })
  const project = await saveProject(directory, applyWorkspaceAsset(created, banner), created.revision)
  const runner = createProjectRunner({ directoryFor: async () => directory, ai: {} })
  const prompt = "做一本沼泽怪物图鉴"
  const started = await runner.startExternal({
    projectId: project.id, expectedRevision: project.revision, prompt,
    plan: { summary: prompt, questions: [], tasks: [{ key: "bestiary", module: "book", title: "沼泽怪物图鉴", prompt, source: prompt, dependencies: [], target_id: null }] },
    provenance: { client: "test-client", model: "test-model", verified: false },
  })
  const ids = { projectId: project.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
  const claimed = await runner.claimExternalTask(ids)
  expect(JSON.stringify(claimed)).toContain("320")
  const document = { kind: "book", name: "沼泽怪物图鉴", author: "老猎人", give_on_first_join: true, keep_on_death: true, pages: [{ title: "泥潭行者", body: "它只在夜里出来。", image: banner.id, margin: "见到就跑" }] }
  expect((await runner.commitExternalTask({ ...ids, document })).state).toBe("completed")
  const book = (await openProject(directory)).workspace.assets.find((asset) => asset.module === "book")!
  expect(book).toMatchObject({ title: "沼泽怪物图鉴", status: "ready", dependencies: [banner.id] })
  const after = await openProject(directory)
  const edit = "图鉴加一页芦苇影子"
  const again = await runner.startExternal({
    projectId: after.id, expectedRevision: after.revision, prompt: edit,
    plan: { summary: edit, questions: [], tasks: [{ key: "bestiary", module: "book", title: "沼泽怪物图鉴", prompt: edit, source: edit, dependencies: [], target_id: book.id }] },
    provenance: { client: "test-client", model: "test-model", verified: false },
  })
  const second = { projectId: after.id, runId: again.run.id, taskId: again.run.tasks[0]!.id }
  await runner.claimExternalTask(second)
  // A page that does not fit in the game is still saved (the build says which page and stops); one over the character limit is refused at once.
  await expect(runner.commitExternalTask({ ...second, document: { ...document, pages: [...document.pages, { body: "字".repeat(161), image: banner.id }] } })).rejects.toThrow(/有图，正文最多 160 字/)
  expect((await runner.commitExternalTask({ ...second, document: { ...document, pages: [...document.pages, { title: "芦苇影子", body: "芦苇里的影子不会动。" }] } })).state).toBe("completed")
  const edited = (await openProject(directory)).workspace.assets.filter((asset) => asset.module === "book")
  expect(edited).toHaveLength(1)
  expect(edited[0]).toMatchObject({ id: book.id, revision: 2 })
  expect(edited[0]!.document.kind === "book" && edited[0]!.document.pages.map((page) => page.title)).toEqual(["泥潭行者", "芦苇影子"])
  await runner.dispose()
})
