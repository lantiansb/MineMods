import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createProject, openProject } from "@minemods/mod-core/project"
import { createStudioService } from "../src/main/service"
import { dispatchExternal, PROJECT_MADE_TOLD } from "../src/main/external-dispatch"
import { createExternalMcpBridge } from "../src/main/external-mcp"
import { claimProjectFolder, folderBase, FOLDER_NAME_MAX } from "../src/project-folder"
import { DELETED_FOLDER } from "../src/api"
import { freshMade, followMade, madeKey, MADE_FRESH_MS } from "../src/renderer/made-project"

type Service = Awaited<ReturnType<typeof createStudioService>>
const roots: string[] = []
const services: Service[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function studio(ai: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-made-"))
  roots.push(root)
  const options = { workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai }
  const service = await createStudioService(options)
  services.push(service)
  return { root, options, service }
}

test("工程文件夹以工程名命名：去掉路径里不能有的字，空格合并，两端的点和空格去掉", () => {
  expect(folderBase("星尘 模组")).toBe("星尘 模组")
  expect(folderBase('  a<b>c:d"e/f\\g|h?i*j  ')).toBe("abcdefghij")
  expect(folderBase("很多    空格\t和\n换行")).toBe("很多 空格 和 换行")
  // Windows drops a trailing dot or space, which would make two names one folder; a leading dot hides the folder.
  expect(folderBase("名字. . ")).toBe("名字")
  expect(folderBase("..隐藏")).toBe("隐藏")
  // Invisible characters are not part of a readable name.
  expect(folderBase("零​宽‮字")).toBe("零宽字")
  // Nothing readable is left: empty, for the caller to give it a suffix.
  expect(folderBase('<>:"/\\|?*')).toBe("")
  expect(folderBase("  . ")).toBe("")
  // Windows devices cannot be folders, whatever follows the dot.
  expect(folderBase("CON")).toBe("CON_")
  expect(folderBase("lpt1.txt")).toBe("lpt1.txt_")
  expect(folderBase("console")).toBe("console")
  // Cut by characters: never longer than the UUID folder it replaces, and no character is split in half.
  const long = folderBase("字".repeat(120))
  expect([...long]).toHaveLength(FOLDER_NAME_MAX)
  expect([...folderBase("😀".repeat(80))]).toHaveLength(FOLDER_NAME_MAX)
  expect(folderBase("😀".repeat(80))).not.toContain("�")
})

test("文件夹只在重名时才加序号，名字里什么都没有时才加随机后缀，Studio 自己的文件夹名不会被占", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-folder-"))
  roots.push(root)
  const first = await claimProjectFolder(root, "星尘")
  const second = await claimProjectFolder(root, "星尘")
  const third = await claimProjectFolder(root, " 星尘 ")
  expect([first, second, third].map((value) => path.basename(value))).toEqual(["星尘", "星尘 (2)", "星尘 (3)"])
  // A file of that name is in the way as much as a folder is.
  await writeFile(path.join(root, "studio-settings.json"), "{}")
  expect(path.basename(await claimProjectFolder(root, "studio-settings.json"))).toBe("studio-settings.json (2)")
  // Nothing readable: a short suffix is all there is to tell it apart by.
  expect(path.basename(await claimProjectFolder(root, "???", () => "abc123"))).toBe("工程-abc123")
  // The folders Studio keeps beside the projects are never taken, even before they exist.
  expect(path.basename(await claimProjectFolder(root, DELETED_FOLDER))).toBe(`${DELETED_FOLDER} (2)`)
  expect(path.basename(await claimProjectFolder(root, "Analysis-Projects"))).toBe("Analysis-Projects (2)")
  // A long name still gets its number.
  const longName = "长".repeat(60)
  const a = await claimProjectFolder(root, longName)
  const b = await claimProjectFolder(root, longName)
  expect(path.basename(b).endsWith(" (2)")).toBe(true)
  expect([...path.basename(b)].length).toBeLessThanOrEqual(FOLDER_NAME_MAX)
  expect(path.basename(a)).not.toBe(path.basename(b))
})

test("同一时刻建的同名工程各有各的文件夹（外部 AI 可能同时调用两次）", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-folder-"))
  roots.push(root)
  const claimed = await Promise.all(Array.from({ length: 8 }, () => claimProjectFolder(root, "同名")))
  expect(new Set(claimed).size).toBe(8)
  expect((await readdir(root)).sort()).toEqual(claimed.map((value) => path.basename(value)).sort())
})

test("新建的工程放在以工程名命名的文件夹里；工程 id 还在工程文件里，列表、打开、重启以后都找得到", async () => {
  const f = await studio()
  const made = await f.service.createProject({ name: "星尘模组", description: "", empty: true })
  expect(path.basename(made.directory)).toBe("星尘模组")
  expect(path.dirname(made.directory)).toBe(path.join(f.root, "projects"))
  expect(made.project.id).toMatch(/^[0-9a-f-]{36}$/)
  expect((await openProject(made.directory)).id).toBe(made.project.id)
  const twin = await f.service.createProject({ name: "星尘模组", description: "", empty: true })
  expect(path.basename(twin.directory)).toBe("星尘模组 (2)")
  expect(twin.project.id).not.toBe(made.project.id)
  // The list, and opening by id, never look at the folder's name.
  const listed = await f.service.listProjects()
  expect(listed.map((entry) => entry.project.id).sort()).toEqual([made.project.id, twin.project.id].sort())
  expect((await f.service.openProject(twin.project.id)).directory).toBe(twin.directory)
  const restarted = await createStudioService(f.options)
  services.push(restarted)
  expect((await restarted.listProjects()).map((entry) => entry.project.name)).toEqual(expect.arrayContaining(["星尘模组", "星尘模组"]))
  expect((await restarted.openProject(made.project.id)).directory).toBe(made.directory)
})

test("以前用 id 当文件夹名的工程照常出现在列表里、照常能打开，和新的并排", async () => {
  const f = await studio()
  // A project made the way it used to be: the folder is its id (any name, as far as Studio is concerned).
  const oldDirectory = path.join(f.root, "projects", "b0a036b5-6ae8-4162-b16c-82c5927a94b3")
  const old = await createProject({ directory: oldDirectory, name: "旧工程", description: "" })
  const fresh = await f.service.createProject({ name: "新工程", description: "", empty: true })
  const listed = await f.service.listProjects()
  expect(listed.map((entry) => path.basename(entry.directory)).sort()).toEqual(["b0a036b5-6ae8-4162-b16c-82c5927a94b3", "新工程"].sort())
  expect((await f.service.openProject(old.id)).directory).toBe(oldDirectory)
  expect((await f.service.openProject(fresh.project.id)).project.name).toBe("新工程")
  // A folder that is not a project (Studio's own, or anyone's) is not listed and does not break the list.
  await mkdir(path.join(f.root, "projects", DELETED_FOLDER))
  await mkdir(path.join(f.root, "projects", "随手建的空文件夹"))
  expect(await f.service.listProjects()).toHaveLength(2)
})

test("改名只改显示的名字，文件夹和 id 不动；删除照样把文件夹移进「已删除」", async () => {
  const f = await studio()
  const made = await f.service.createProject({ name: "旧名字", description: "", empty: true })
  const renamed = await f.service.renameProject({ projectId: made.project.id, expectedRevision: made.project.revision, name: "新名字" })
  expect(renamed.directory).toBe(made.directory)
  expect((await f.service.listProjects())[0]!.project.name).toBe("新名字")
  const gone = await f.service.deleteProject({ projectId: made.project.id })
  expect(path.dirname(gone.moved)).toBe(path.join(f.root, "projects", DELETED_FOLDER))
  expect(await f.service.listProjects()).toHaveLength(0)
})

test("工程没建成就不留下空文件夹", async () => {
  const f = await studio()
  // A name of 121 characters is refused by the project itself, after the folder was claimed.
  await expect(f.service.createProject({ name: "长".repeat(121), description: "", empty: true })).rejects.toThrow()
  expect(await readdir(path.join(f.root, "projects"))).not.toContain("长".repeat(36))
  expect((await readdir(path.join(f.root, "projects"))).filter((name) => name.startsWith("长"))).toEqual([])
})

test("选定位置里建的工程也以工程名命名，也出现在列表里（外部位置记在 studio-locations 里）", async () => {
  const f = await studio()
  const outside = path.join(f.root, "chosen")
  await mkdir(outside)
  const token = crypto.randomUUID()
  await f.service.registerLocation(token, outside)
  const made = await f.service.createProject({ name: "外面的工程", description: "", empty: true, locationToken: token })
  expect(made.directory).toBe(path.join(outside, "外面的工程"))
  expect((await f.service.listProjects()).map((entry) => entry.project.id)).toContain(made.project.id)
  const restarted = await createStudioService(f.options)
  services.push(restarted)
  expect((await restarted.openProject(made.project.id)).directory).toBe(made.directory)
})

test("外部 AI 建工程：工程马上出现在列表里，返回里告诉它窗口里会看到什么，不指到并不存在的按钮", async () => {
  const f = await studio({ mode: "mcp" })
  expect(await f.service.listProjects()).toHaveLength(0)
  const result = (await dispatchExternal(f.service, { method: "createProject", input: { name: "苔藓守卫", description: "一个模组" } })) as Awaited<ReturnType<Service["createProject"]>> & { where_to_look: string }
  expect(path.basename(result.directory)).toBe("苔藓守卫")
  const listed = await f.service.listProjects()
  expect(listed.map((entry) => entry.project.id)).toEqual([result.project.id])
  expect(result.where_to_look).toBe(PROJECT_MADE_TOLD("苔藓守卫"))
  expect(result.where_to_look).toContain("模组总览")
  expect(result.where_to_look).toContain("点这里打开")
  expect(result.where_to_look).toContain("首页的工程列表")
  // The AI is told what the window really shows; it is not given a button to name that leads nowhere.
  expect(result.where_to_look).not.toMatch(/请.{0,6}点.{0,3}返回工程/)
  // The result still carries the project view as before.
  expect(result.project.name).toBe("苔藓守卫")
})

test("外部 AI 建好工程以后，通道的状态里有这个工程，窗口据此打开或提示；没建成的不报", async () => {
  const token = "t".repeat(32)
  let answer: unknown = { project: { id: "11111111-1111-4111-8111-111111111111", name: "新工程" }, directory: "/x" }
  const bridge = createExternalMcpBridge({ token, call: async (method) => (method === "createProject" ? (answer instanceof Error ? Promise.reject(answer) : answer) : { ready: true }) })
  const authorization = `Bearer ${token}`
  expect(bridge.status().madeProject).toBeNull()
  const before = Date.now()
  await bridge.dispatch("createProject", { name: "新工程", description: "" }, authorization)
  const made = bridge.status().madeProject
  expect(made).toMatchObject({ id: "11111111-1111-4111-8111-111111111111", name: "新工程" })
  expect(made!.at).toBeGreaterThanOrEqual(before)
  // Another call changes nothing about it; a refused creation does not replace it.
  await bridge.dispatch("listProjects", {}, authorization)
  answer = new Error("工程名太长")
  await expect(bridge.dispatch("createProject", { name: "x", description: "" }, authorization)).rejects.toThrow("工程名太长")
  expect(bridge.status().madeProject).toEqual(made)
  // A answer that is no project view (an older service) announces nothing.
  answer = { ok: true }
  await bridge.dispatch("createProject", { name: "y", description: "" }, authorization)
  expect(bridge.status().madeProject).toEqual(made)
})

test("窗口怎么对待 AI 新建的工程：手上没有事就直接打开；在做别的事就提示，不抢走窗口", () => {
  const idle = { unsaved: false, working: false }
  // Pages that hold nothing a switch could cost.
  for (const page of ["home", "profile", "resources"]) expect(followMade({ page, ...idle })).toBe("open")
  // A project on screen, a typed name on the create page, an editor: all work in flight.
  for (const page of ["overview", "create", "commands", "asset", "model", "behavior", "info", "share"]) expect(followMade({ page, ...idle })).toBe("offer")
  // Unsaved edits or a running step are never overridden, whatever the page.
  expect(followMade({ page: "home", unsaved: true, working: false })).toBe("offer")
  expect(followMade({ page: "home", unsaved: false, working: true })).toBe("offer")
})

test("新建的工程只算一次新闻：太久以前的、已经处理过的都不再打开", () => {
  const now = Date.parse("2026-10-14T10:00:00.000Z")
  const made = { id: "p1", name: "新工程", at: new Date(now - 10_000).toISOString() }
  expect(freshMade({ madeProject: made }, now, "")).toEqual(made)
  expect(freshMade({ madeProject: made }, now, madeKey(made))).toBeNull()
  expect(freshMade({ madeProject: { ...made, at: new Date(now - MADE_FRESH_MS - 1).toISOString() } }, now, "")).toBeNull()
  expect(freshMade({ madeProject: null }, now, "")).toBeNull()
  expect(freshMade(undefined, now, "")).toBeNull()
  // The same project made again later is new news.
  expect(freshMade({ madeProject: { ...made, at: new Date(now - 1000).toISOString() } }, now, madeKey(made))).not.toBeNull()
})
