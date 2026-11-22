import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { EntrypointError, assertCreatable, classFile, createdClassIssue, entrypointClasses, type CreatedClass } from "../src/fabric/entrypoints"
import { EFFECT_RUNTIME } from "../src/fabric/effect"
import { PART_RUNTIME } from "../src/fabric/hitbox"
import { gameplayPackage, gameplayRoot } from "../src/gameplay"
import { staticChecks } from "../src/gameplay-check"
import { GESTURE_EXAMPLE } from "../src/gesture-bases"
import { createProject, openProject, saveProject } from "../src/project"
import { applyWorkspaceAsset } from "../src/workspace"
import { createDataGameplaySample } from "../script/data-gameplay-sample"
import { SKY_EXAMPLE, gestureAsset } from "./gesture-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac, hasTargetJavap, targetJavap } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const MOD = "com.minemods.content_azure_sample"
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const folder = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-entrypoints-"))
  roots.push(root)
  await mkdir(path.join(root, "project"))
  return { project: path.join(root, "project"), source: path.join(root, "source"), classes: path.join(root, "classes") }
}

/** The fullest sample (chain, life with its gameplay, abilities, effects, a creature with parts), and on top of it two cast actions and a client side for the gameplay, so every kind of entrypoint a build can write is in one tree. */
async function fullest(project: string) {
  const made = await createDataGameplaySample(project, { chain: true, life: true, abilities: true, effects: true, hitbox: true })
  const gameplay = made.workspace.assets.find((asset) => asset.document.kind === "gameplay")!
  if (gameplay.document.kind !== "gameplay") throw new Error("The sample has no gameplay")
  const client = `package ${gameplayPackage(made.mod_id, gameplay.document.slug)}.client;\n\nimport ${gameplayRoot(made.mod_id)}.api.GameplayClientEntry;\n\npublic final class ClientMain implements GameplayClientEntry {\n    @Override public void onInitializeClient() {}\n}\n`
  const withClient = applyWorkspaceAsset(made, { ...gameplay, document: { ...gameplay.document, sources: [...gameplay.document.sources, { path: "client/ClientMain.java", content: client }] } })
  return saveProject(project, applyWorkspaceAsset(applyWorkspaceAsset(withClient, gestureAsset(GESTURE_EXAMPLE)), gestureAsset(SKY_EXAMPLE)), made.revision)
}

const metadata = (source: string) => readFile(path.join(source, "src/main/resources/fabric.mod.json"), "utf8")

test("every entrypoint of the fullest sample passes the build's own check, and so do a mod of one creature and a mod of none", async () => {
  const full = await folder()
  const project = await fullest(full.project)
  const gameplay = project.workspace.assets.flatMap((asset) => (asset.document.kind === "gameplay" ? [asset.document] : []))[0]!
  // Assembling runs the check: it would have thrown.
  await assembleBuildSource(full.project, full.source, TEMPLATE)
  const api = `${gameplayRoot(project.mod_id)}.api`
  expect(entrypointClasses(await metadata(full.source)).map((created) => [created.class, created.implements?.split(".").at(-1)])).toEqual([
    [`${MOD}.StudioContent`, "ModInitializer"],
    [`${MOD}.gesture.fabric.GestureMod`, "ModInitializer"],
    [`${api}.GameplayBoot`, "ModInitializer"],
    [`${MOD}.entity.${EFFECT_RUNTIME.table}`, "ModInitializer"],
    [`${MOD}.entity.${PART_RUNTIME.table}`, "ModInitializer"],
    [`${MOD}.client.StudioClient`, "ClientModInitializer"],
    [`${MOD}.gesture.fabric.client.GestureClient`, "ClientModInitializer"],
    [`${api}.client.GameplayClientBoot`, "ClientModInitializer"],
    [`${MOD}.client.${EFFECT_RUNTIME.client}`, "ClientModInitializer"],
    [`${MOD}.client.${PART_RUNTIME.client}`, "ClientModInitializer"],
  ])
  // The gameplay's own entries are what the boot classes create.
  const boot = await readFile(path.join(full.source, classFile(`${api}.GameplayBoot`)), "utf8")
  expect(boot).toContain(`${gameplayPackage(project.mod_id, gameplay.slug)}.Main::new`)
  expect(await readFile(path.join(full.source, classFile(`${api}.client.GameplayClientBoot`)), "utf8")).toContain(`${gameplayPackage(project.mod_id, gameplay.slug)}.client.ClientMain::new`)

  // One creature: its own two classes are the entrypoints. None: the content class alone.
  const one = await folder()
  await createDataGameplaySample(one.project)
  await assembleBuildSource(one.project, one.source, TEMPLATE)
  expect(entrypointClasses(await metadata(one.source)).map((created) => created.class)).toEqual([`${MOD}.StudioContent`, `${MOD}.client.StudioClient`])
  const none = await folder()
  await createProject({ directory: none.project, name: "空模组", mod_id: "azure_sample" })
  await assembleBuildSource(none.project, none.source, TEMPLATE)
  expect(entrypointClasses(await metadata(none.source)).map((created) => created.class)).toEqual([`${MOD}.StudioContent`])
}, 120000)

test.skipIf(!hasTargetJavac(OFFICIAL) || !hasTargetJavap(OFFICIAL))("compiled, every class the game or the boot code creates is a public class with a public no-argument constructor and the interface it is used through", async () => {
  const full = await folder()
  const project = await fullest(full.project)
  await assembleBuildSource(full.project, full.source, TEMPLATE)
  await mkdir(full.classes)
  const compiled = (await compileTreeFor(OFFICIAL, full.source, full.classes))!
  expect(compiled.output).not.toContain("error")
  expect(compiled.code).toBe(0)
  const slug = project.workspace.assets.flatMap((asset) => (asset.document.kind === "gameplay" ? [asset.document.slug] : []))[0]!
  const api = `${gameplayRoot(project.mod_id)}.api`
  const created = [
    ...entrypointClasses(await metadata(full.source)),
    { class: `${gameplayPackage(project.mod_id, slug)}.Main`, implements: `${api}.GameplayEntry` },
    { class: `${gameplayPackage(project.mod_id, slug)}.client.ClientMain`, implements: `${api}.GameplayClientEntry` },
  ]
  expect(created).toHaveLength(12)
  created.forEach((entry) => {
    const printed = targetJavap(OFFICIAL, full.classes, entry.class)
    const name = entry.class.replaceAll("$", "\\$").replaceAll(".", "\\.")
    // The class line: public, not abstract, and the interface named.
    expect(printed).toMatch(new RegExp(`^public (?:final )?class ${name} (?:extends [\\w.$<>]+ )?implements [^{]*\\b${entry.implements!.replaceAll(".", "\\.")}\\b[^{]*\\{$`, "m"))
    // The constructor line: what Fabric's getDeclaredConstructor().newInstance() and the boot code's `new` need.
    expect(printed).toMatch(new RegExp(`^  public ${name}\\(\\);$`, "m"))
  })
}, 180000)

test("a class the game could not create stops the build with a sentence that names it", async () => {
  const fabric = (name: string): CreatedClass => ({ class: name, implements: "net.fabricmc.api.ModInitializer", by: "fabric" })
  const good = "package a.b;\n\nimport net.fabricmc.api.ModInitializer;\n\n/** private Good() {} in a comment changes nothing */\npublic final class Good implements ModInitializer {\n    public Good() {}\n    @Override public void onInitialize() { Runnable r = new Runnable() { public void run() {} }; }\n}\n"
  expect(createdClassIssue(fabric("a.b.Good"), good)).toBeNull()
  expect(createdClassIssue(fabric("a.b.Good"), good.replace("    public Good() {}\n", ""))).toBeNull()
  expect(createdClassIssue(fabric("a.b.Good"), good.replace("implements ModInitializer", "implements java.io.Closeable, net.fabricmc.api.ModInitializer"))).toBeNull()
  expect(createdClassIssue(fabric("a.b.Good"), null)).toBe("找不到它的源文件（src/main/java/a/b/Good.java）")
  expect(createdClassIssue(fabric("a.c.Good"), good)).toBe("文件里写的包名不是 a.c")
  expect(createdClassIssue(fabric("a.b.Good"), good.replace("public Good()", "private Good()"))).toBe("它的无参数构造方法不是 public 的")
  expect(createdClassIssue(fabric("a.b.Good"), good.replace("public Good()", "Good()"))).toBe("它的无参数构造方法不是 public 的")
  expect(createdClassIssue(fabric("a.b.Good"), good.replace("public Good()", "public Good(int seed)"))).toBe("它的构造方法都带参数，缺一个 public 的无参数构造方法")
  expect(createdClassIssue(fabric("a.b.Good"), good.replace("public final class", "final class"))).toBe("它不是 public 的类")
  expect(createdClassIssue(fabric("a.b.Good"), good.replace("public final class", "public abstract class"))).toBe("它是 abstract 的，游戏没法创建它")
  expect(createdClassIssue(fabric("a.b.Good"), good.replace("public final class", "public interface"))).toBe("它不是一个普通的类（class），游戏没法创建它")
  expect(createdClassIssue(fabric("a.b.Good"), good.replace(" implements ModInitializer", ""))).toBe("它没有写 implements ModInitializer")
  expect(createdClassIssue({ ...fabric("a.b.Good"), implements: "net.fabricmc.api.ClientModInitializer" }, good)).toBe("它没有写 implements ClientModInitializer")
  // An entry written as an object is read; one that names a member is not a class to create.
  expect(entrypointClasses(JSON.stringify({ entrypoints: { main: [{ adapter: "default", value: "a.b.Good" }, "a.b.Good::start"], modmenu: ["a.b.Menu"] } }))).toEqual([fabric("a.b.Good"), { class: "a.b.Menu", implements: null, by: "fabric" }])

  // What the two classes looked like on the day a generated mod crashed at launch: the check the build runs on its own tree now refuses them, by name.
  const full = await folder()
  await fullest(full.project)
  await assembleBuildSource(full.project, full.source, TEMPLATE)
  const classes = entrypointClasses(await metadata(full.source))
  const read = (broken: string) => async (file: string) => {
    const text = await readFile(path.join(full.source, file), "utf8").catch(() => null)
    return file === classFile(`${MOD}.entity.${broken}`) ? text!.replace(`public ${broken}() {}`, `private ${broken}() {}`) : text
  }
  expect(await assertCreatable(classes, read("Nothing"))).toHaveLength(10)
  await Promise.all(
    [EFFECT_RUNTIME.table, PART_RUNTIME.table].map(async (name) => {
      const refused = await assertCreatable(classes, read(name)).catch((error: unknown) => error)
      expect(refused).toBeInstanceOf(EntrypointError)
      expect(refused instanceof Error && refused.message).toBe(`打包停下了：模组的启动类 ${MOD}.entity.${name} 进了游戏会创建失败，游戏一启动就会崩溃——它的无参数构造方法不是 public 的。这是 Studio 自己生成的代码出了问题，不是你做的内容有问题；请把这句话原样反馈给我们。`)
    }),
  )

  // In a build: a gameplay whose entry has a private constructor never reaches a compiler, and the writer is told in plain words.
  const made = await folder()
  const project = await createDataGameplaySample(made.project, { life: true })
  const gameplay = project.workspace.assets.find((asset) => asset.document.kind === "gameplay")!
  if (gameplay.document.kind !== "gameplay") throw new Error("The sample has no gameplay")
  const closed = { ...gameplay.document, sources: gameplay.document.sources.map((file) => (file.path === "Main.java" ? { ...file, content: file.content.replace("public final class Main implements GameplayEntry {", "public final class Main implements GameplayEntry {\n    private Main() {}\n") } : file)) }
  expect(staticChecks(project, closed, gameplay.id).bounds).toEqual([
    { rule: "entry", file: "Main.java", line: null, message: "Main.java 的无参数构造方法不是 public 的，Studio 启动这个玩法时创建不了它。", fix: "Studio 用 new Main() 来创建这个类：把构造方法写成 public Main() { … }，或者干脆不写构造方法（Java 会自动给一个公开的）。要准备的东西放进 onInitialize() 里。" },
  ])
  await saveProject(made.project, applyWorkspaceAsset(project, { ...gameplay, document: closed }), project.revision)
  await expect(assembleBuildSource(made.project, made.source, TEMPLATE)).rejects.toThrow(`GAMEPLAY_OUT_OF_BOUNDS:${gameplay.id}`)
  expect((await openProject(made.project)).revision).toBe(project.revision + 1)
}, 120000)

test("the sentence a stopped build shows names the class and says whose code it is", () => {
  const studio = new EntrypointError({ class: `${MOD}.entity.StudioEffects`, implements: "net.fabricmc.api.ModInitializer", by: "fabric" }, "它的无参数构造方法不是 public 的")
  expect(studio.message).toBe(`打包停下了：模组的启动类 ${MOD}.entity.StudioEffects 进了游戏会创建失败，游戏一启动就会崩溃——它的无参数构造方法不是 public 的。这是 Studio 自己生成的代码出了问题，不是你做的内容有问题；请把这句话原样反馈给我们。`)
  const written = new EntrypointError({ class: `${MOD}.gameplay.guard.Main`, implements: null, by: "boot" }, "它不是 public 的类")
  expect(written.message).toBe(`打包停下了：玩法的入口类 ${MOD}.gameplay.guard.Main 进了游戏会创建失败，这个玩法启动不了——它不是 public 的类。这段玩法代码是 AI 写的：请让它把这个类改成 public 的类、构造方法不带参数并且是 public 的（或者不写构造方法），重新检查通过后再打包。`)
})
