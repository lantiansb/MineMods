import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createProject } from "@minemods/mod-core/project"
import { createStudioService } from "../src/main/service"
import { dispatchExternal } from "../src/main/external-dispatch"
import { gameplayCapability, gameplayHandoffSection } from "../src/main/gameplay-handoff"
import { getMcpCapabilities } from "../src/main/mcp-capabilities"
import { claimSegments, guideText } from "../src/main/mcp-guide"

/**
 * What an outside AI is told about the game, the loader, the Java and the names its code uses is the project's own target. A Fabric 1.21.1
 * project, and any text with no project at hand while Fabric 1.21.1 is the only ready target, says exactly what it always said.
 */

type Service = Awaited<ReturnType<typeof createStudioService>>
const roots: string[] = []
const services: Service[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const FABRIC_TEMPLATE = "当前内置构建模板为 Minecraft 1.21.1、Fabric Loader 0.17.2、Java 21。"
const FABRIC_JAVA = "Java 21 由 Studio 构建管理。"
const FABRIC_MIXIN = "这一版不开放 mixin、access widener 和反射：玩法只用 Minecraft 和 Fabric API 公开的事件与注册接口。Fabric 没有事件、又碰不到私有成员的事情现在做不了"

test("a Fabric project is said as it always was; with no project the build environment is every ready target's", () => {
  for (const targets of [undefined, ["fabric-1.21.1" as const]]) {
    const workflow = guideText("workflow", { targets })
    expect(workflow).toContain(FABRIC_TEMPLATE.slice(0, -1))
    const gameplay = guideText("gameplay", { targets })
    expect(gameplay).toContain(FABRIC_MIXIN)
    expect(gameplay).toContain("- Minecraft 1.21.1（Mojang 官方名称）和 Fabric API 可以自由使用。")
  }
  const fabric = ["fabric-1.21.1" as const]
  expect(guideText("workflow", { targets: fabric })).toContain(FABRIC_TEMPLATE)
  expect(guideText("workflow", { targets: fabric })).toContain(FABRIC_JAVA)
  expect(guideText("rules", { targets: fabric })).toContain("或已经进入 Fabric 构建器；")
  // No project at hand: the three targets Studio can make a mod for, in the manifests' order.
  const none = guideText("workflow", {})
  expect(none).toContain("当前内置构建模板为 Minecraft 1.21.1、Fabric Loader 0.17.2、Java 21；Minecraft 1.20.1、Forge 47.4.28、Java 17；Minecraft 1.21.1、NeoForge 21.1.266、Java 21。")
  expect(none).toContain("Java 21、17 由 Studio 构建管理。")
  expect(guideText("rules", {})).toContain("或已经进入 Fabric/Forge/NeoForge 构建器；")
  expect(gameplayHandoffSection("`")).toBe(gameplayHandoffSection("`", "fabric-1.21.1"))
  expect(gameplayCapability(true, "fabric-1.21.1").bounds.mixins).toStartWith(FABRIC_MIXIN)
  expect(gameplayCapability(true).bounds.mixins).toBe("不开放 mixin、access widener 和反射。")
})

test("a Forge 1.20.1 project is told Forge, 1.20.1, Java 17 and the official names", () => {
  const targets = ["forge-1.20.1" as const]
  const workflow = guideText("workflow", { targets })
  expect(workflow).toContain("当前内置构建模板为 Minecraft 1.20.1、Forge 47.4.28、Java 17。")
  // Forge 1.20.1 compiles on Java 17 and its build tool also runs Java 21.
  expect(workflow).toContain("Java 17、21 由 Studio 构建管理。")
  expect(workflow).not.toContain("Fabric")
  expect(guideText("rules", { targets })).toContain("或已经进入 Forge 构建器；")
  const gameplay = claimSegments("gameplay", { targets }).map((part) => part.text).join("\n")
  // Gameplay code of a Forge or NeoForge project reaches the loader only through the project's own platform classes (D 组).
  expect(gameplay).toContain("- Minecraft 1.20.1（Mojang 官方名称）可以自由使用；加载器（Forge）的事只经 ProjectPlatform / ProjectClient。不能用 mixin、access widener 和反射。")
  expect(gameplay).toContain("数据文件夹用 1.20.1 的名字：loot_tables")
  expect(gameplay).not.toContain("Minecraft 1.21.1")
  // A project for two targets is told both, its primary first.
  expect(guideText("workflow", { targets: ["fabric-1.21.1", "neoforge-1.21.1"] })).toContain("当前内置构建模板为 Minecraft 1.21.1、Fabric Loader 0.17.2、Java 21；Minecraft 1.21.1、NeoForge 21.1.266、Java 21。")
})

test("the capability list names every target from its manifest, and which can be picked", () => {
  const targets = getMcpCapabilities("medium").build_targets
  expect(targets[0]).toEqual({ id: "fabric-1.21.1", minecraft: "1.21.1", loader: "fabric", loader_version: "0.17.2", java_major: 21, naming: "Mojang 官方命名", geckolib: "4.8.3", ready: true, why: null, default: true })
  expect(targets.find((target) => target.id === "forge-1.20.1")).toMatchObject({ minecraft: "1.20.1", loader: "forge", loader_version: "47.4.28", java_major: 17, naming: "Mojang 官方命名", ready: true, why: null, default: false })
  expect(targets.find((target) => target.id === "neoforge-1.21.1")).toMatchObject({ minecraft: "1.21.1", loader: "neoforge", loader_version: "21.1.266", java_major: 21, ready: true, why: null, default: false })
  expect(targets.map((target) => target.id)).toEqual(["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"])
})

test("create_project takes a target: a ready one is made for it (Forge 1.20.1 and NeoForge 1.21.1 too), one Studio does not know is refused", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-target-words-"))
  roots.push(root)
  const service = await createStudioService({ workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: { mode: "mcp" } })
  services.push(service)
  const made = (await dispatchExternal(service, { method: "createProject", input: { name: "苔藓守卫", description: "", target: "fabric-1.21.1" } })) as { project: { id: string; target: string } }
  expect(made.project.target).toBe("fabric-1.21.1")
  const forge = (await dispatchExternal(service, { method: "createProject", input: { name: "熔岩守卫", description: "", target: "forge-1.20.1" } })) as { project: { id: string; target: string } }
  const neo = (await dispatchExternal(service, { method: "createProject", input: { name: "潮汐守卫", description: "", target: "neoforge-1.21.1" } })) as { project: { id: string; target: string } }
  expect([forge.project.target, neo.project.target]).toEqual(["forge-1.20.1", "neoforge-1.21.1"])
  await expect(dispatchExternal(service, { method: "createProject", input: { name: "x", description: "", target: "quilt-1.21.1" } })).rejects.toThrow()
  expect((await service.listProjects()).map((entry) => entry.project.name).sort()).toEqual(["潮汐守卫", "熔岩守卫", "苔藓守卫"].sort())
  // The words of a project's own task and plan follow its targets, read off its file alone.
  expect(await service.projectTargets(made.project.id)).toEqual(["fabric-1.21.1"])
  expect(await service.projectTargets(forge.project.id)).toEqual(["forge-1.20.1"])
  const plain = await createProject({ directory: path.join(root, "projects", "直接建的"), name: "直接建的", description: "", target: "neoforge-1.21.1" })
  expect(await service.projectTargets(plain.id)).toEqual(["neoforge-1.21.1"])
})
