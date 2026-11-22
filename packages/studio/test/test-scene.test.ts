import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { SCENE, SCENE_EXTRA, SCENE_WORDS } from "@minemods/mod-core/scene"
import { dispatchExternal, SCENE_TOLD } from "../src/main/external-dispatch"
import { MCP_TOOLS } from "../src/main/mcp-handoff"
import { everythingToRead } from "./handoff-reading"
import { createStudioService } from "../src/main/service"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

// 「测试场」 (10-07). What the game does is tested where it is driven (mod-core/test/scene.test.ts); here, what Studio lets through.
test("测试场：没有构建就不能检查；后台检查要本人同意过游戏的许可协议，外部 AI 替不了这一步", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-scene-"))
  roots.push(root)
  const options = { workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: {} }
  const service = await createStudioService(options)
  const created = await service.createProject({ name: "测试场工程", description: "", empty: true })
  const projectId = created.project.id
  const scene = await service.getScene({ projectId })
  expect(scene).toMatchObject({ record: null, lines: [], eula: false, world: false })
  // The world a check leaves is what the window reads to know that opening the scene does not land on the main menu.
  await mkdir(path.join(scene.directory, "saves", SCENE.world), { recursive: true })
  expect((await service.getScene({ projectId })).world).toBe(false)
  await writeFile(path.join(scene.directory, "saves", SCENE.world, "level.dat"), "x")
  expect((await service.getScene({ projectId })).world).toBe(true)
  expect(scene.extra).toBe(path.join(created.directory, SCENE_EXTRA))
  // Its place is under Studio's own runtime folder, one per project: nothing of the game goes into the project.
  expect(scene.directory).toBe(path.join(options.runtimeDirectory, "scene", "instances", projectId))
  // A job that is no finished build of this project: refused before anything is started, for the person and for an outside AI alike.
  const jobId = randomUUID()
  await expect(service.startSceneCheck({ projectId, jobId })).rejects.toThrow()
  await expect(service.startScenePlay({ projectId, jobId })).rejects.toThrow()
  await expect(dispatchExternal(service, { method: "checkScene", input: { projectId, jobId } })).rejects.toThrow()
  await expect(dispatchExternal(service, { method: "getSceneCheck", input: { projectId, jobId } })).rejects.toThrow()
  // The agreement is the person's: there is no call for it in what an outside AI can reach, and it is recorded with when and to what.
  await expect(dispatchExternal(service, { method: "agreeSceneEula" })).rejects.toThrow()
  expect((await service.getScene({ projectId })).eula).toBe(false)
  expect(await service.agreeSceneEula()).toEqual({ eula: true })
  expect((await service.getScene({ projectId })).eula).toBe(true)
  expect(JSON.parse(await readFile(path.join(options.runtimeDirectory, "scene", "eula.json"), "utf8"))).toMatchObject({ licence: "https://aka.ms/MinecraftEULA" })
  expect(SCENE_WORDS.eula).toContain("https://aka.ms/MinecraftEULA")
})

test("测试场：两个工具写进了交接说明，说清它不开窗口、看不到画面，查过了也不能说成在游戏里看过", () => {
  const tools = MCP_TOOLS.map((tool) => tool[0])
  expect(tools).toEqual(expect.arrayContaining(["check_scene", "get_scene_check"]))
  const handoff = everythingToRead({ configuration: JSON.stringify({ mcpServers: { "minemods-studio": { command: "electron", args: ["mcp-stdio.js"], env: {} } } }), project: { id: "p", name: "工程", revision: 1 } })
  for (const phrase of ["`check_scene`", "`get_scene_check`", "它不开窗口", "查过了也不能对用户说成在游戏里看过", "把那句话原样转告用户"]) expect(handoff).toContain(phrase)
  expect(SCENE_TOLD.done).toContain("不要说成「游戏里验证过了」")
  expect(SCENE_WORDS.limits).toContain("没有玩家在场")
})
