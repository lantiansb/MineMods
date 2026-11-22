import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { reviewAsset, ASSET_STANDARDS } from "../src/acceptance"
import { assembleBuildSource } from "../src/build-source"
import { compileGameplayCandidate } from "../src/gameplay-compile"
import { GAMEPLAY_API, GAMEPLAY_LIMITS, GameplayDocumentSchema, GameplaySheetSchema, findingLine, gameplaySheet, gameplayThings, gameplayTryList, type GameplayDocument } from "../src/gameplay"
import { compilerFindings, floorPassed, staticChecks, type GameplayCheck } from "../src/gameplay-check"
import { beginGameplay, changeGameplay, checkedGameplay, describeGameplay, findGameplay, finishGameplay, gameplayCommitGate, gameplayUnsatisfied, keepGameplay, readGameplay, reviewedGameplay, reviewAgain, shownGameplay, GameplayRecordSchema } from "../src/gameplay-loop"
import { exportProjectArchive, importProjectArchive } from "../src/container"
import { checkGameplayReferences } from "../src/gameplay-references"
import { GAMEPLAY_SCAN_LIMITS, scanEntries, scanGameplay, stripJava } from "../src/gameplay-scan"
import { GAMEPLAY_REFUSALS, GAMEPLAY_TOOL_VOICE, gameplayOwnWords } from "../src/gameplay-words"
import { identifiersIn } from "../src/play-words"
import { MakingRefusal, fingerprint } from "../src/making"
import { openProject, ProjectSchema, saveProject, type Project } from "../src/project"
import { blueprintPlannerInstructions } from "../src/blueprint-planner"
import { WorkspaceAssetSchema, WorkspaceSchema, builtWorkspaceAssets, getModuleSchema } from "../src/workspace"
import { MODULES, kindCapability } from "../src/workspace-modules"
import { BAD, BOX_GUARD, GUARDIAN_HOME, IDS, LEGACY_FILES, sampleProject } from "./fixtures/gameplay/sample"
import { HAS_OFFICIAL_JAVAC, officialJavacCompiler } from "./gameplay-javac"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const NOW = "2026-10-05T08:00:00.000Z"
const asset = (id: string, document: GameplayDocument) =>
  WorkspaceAssetSchema.parse({ id, module: "gameplay", title: document.name, revision: 1, created_at: NOW, updated_at: NOW, prompt: "守着秘匣的生物", dependencies: document.uses, document, provenance: { model: "gpt-6-astra", request_id: null }, status: "ready" })
const withGameplay = (project: Project, entries: [string, GameplayDocument][]) => ProjectSchema.parse({ ...project, workspace: { assets: [...project.workspace.assets, ...entries.map(([id, document]) => asset(id, document))] } })
const rules = (findings: { rule: string }[]) => [...new Set(findings.map((finding) => finding.rule))]
const scan = (file: string, content: string, declared: string[] = []) => scanGameplay({ mod_id: "legacy_sample", slug: "box_guard", sources: [{ path: file, content }], declared })
const java = (body: string, imports = "") => `package com.minemods.content_legacy_sample.gameplay.box_guard;\n${imports}\nfinal class Probe {\n    void run() throws Exception {\n${body}\n    }\n}\n`

async function sampleDirectory(entries: [string, GameplayDocument][] = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-gameplay-"))
  roots.push(root)
  const original = JSON.parse(await readFile(LEGACY_FILES.project, "utf8"))
  await cp(LEGACY_FILES.project, path.join(root, "minemods.project.json"))
  await mkdir(path.join(root, ".minemods", "assets", original.assets[0].id), { recursive: true })
  await cp(LEGACY_FILES.model, path.join(root, ".minemods", "assets", original.assets[0].id, `${original.assets[0].revision}.json`))
  if (!entries.length) return root
  const opened = await openProject(root)
  await saveProject(root, withGameplay(opened, entries), opened.revision)
  return root
}

// ---- what a gameplay asset holds ----

test("the two sample gameplay documents fit the schema, and the registry lists the kind as something that reaches the game", () => {
  expect(GameplayDocumentSchema.parse(BOX_GUARD)).toEqual(BOX_GUARD)
  expect(GameplayDocumentSchema.parse(GUARDIAN_HOME)).toEqual(GUARDIAN_HOME)
  expect(getModuleSchema("gameplay").parse(BOX_GUARD)).toEqual(BOX_GUARD)
  expect(MODULES.gameplay.label).toBe("玩法")
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) expect(kindCapability("gameplay", target)).toBe("runtime")
  // The planner's brief is written from the registry: behaviour is now something it can plan instead of leaving out.
  const brief = blueprintPlannerInstructions("fabric-1.21.1")
  expect(brief).toContain("- gameplay（玩法，属于「玩法」）：能做进游戏。")
  expect(brief).toMatch(/gameplay（玩法.*needs 里可以有：.*item（物品）.*entity（生物）/s)
  expect(ASSET_STANDARDS.gameplay.rules.map((rule) => [rule.id, rule.criterion])).toEqual([["out_of_bounds", "sound"], ["does_not_compile", "sound"], ["broken_reference", "fits"]])
  expect(Object.keys(ASSET_STANDARDS.gameplay.unmeasured).sort()).toEqual(["earns_place", "hierarchy", "not_mechanical", "reads"])
})

test("names, sizes and file kinds are held by the schema", () => {
  const bad = (change: Partial<GameplayDocument>) => GameplayDocumentSchema.safeParse({ ...BOX_GUARD, ...change }).success
  const file = (path: string, content = "x") => ({ path, content })
  expect(bad({})).toBe(true)
  // The slug is a package name: lower case, not a Java word, not one of Studio's own folders.
  ;["Box", "1box", "class", "api", "client", "a", "box-guard", "box.guard"].forEach((slug) => expect(bad({ slug })).toBe(false))
  // A Java path stays inside the gameplay's own folder and names a class file.
  ;["../Main.java", "/Main.java", "main.java", "a/b/c/d/E.java", "class/A.java", "A.class", "A.kt", "Sub/A.java", "a\\B.java"].forEach((path) => expect(bad({ sources: [...BOX_GUARD.sources, file(path)] })).toBe(false))
  expect(bad({ sources: [...BOX_GUARD.sources, file("util/Timer2.java"), file("client/ClientMain.java")] })).toBe(true)
  expect(bad({ sources: BOX_GUARD.sources.slice(1) })).toBe(false)
  // Two paths that differ only by case are one file on Windows and macOS.
  expect(bad({ sources: [...BOX_GUARD.sources, file("ALARM.java")] })).toBe(false)
  // Data is JSON under data/, nothing hidden, nothing that climbs out.
  ;["assets/x/models/a.json", "data/x/../y/a.json", "data/x/a.json", "data/x/tags/.hidden/a.json", "data/x/tags/a.nbt", "data/x/tags/a.png", "META-INF/a.json", "fabric.mod.json"].forEach((path) => expect(bad({ data: [file(path, "{}")] })).toBe(false))
  // Size limits: per file, in total, and by count.
  expect(bad({ sources: [...BOX_GUARD.sources, file("Big.java", "x".repeat(GAMEPLAY_LIMITS.source_bytes + 1))] })).toBe(false)
  expect(bad({ sources: [...BOX_GUARD.sources, file("Wide.java", "字".repeat(GAMEPLAY_LIMITS.source_bytes / 3 + 1))] })).toBe(false)
  expect(bad({ sources: [...BOX_GUARD.sources, ...Array.from({ length: GAMEPLAY_LIMITS.sources }, (_, index) => file(`Extra${index}.java`))] })).toBe(false)
  expect(bad({ sources: [...BOX_GUARD.sources, ...Array.from({ length: 9 }, (_, index) => file(`Fat${index}.java`, "x".repeat(GAMEPLAY_LIMITS.source_bytes)))] })).toBe(false)
  // Not text: a file with control bytes in it is a binary in disguise.
  expect(bad({ sources: [...BOX_GUARD.sources, file("Blob.java", "class Blob {}\u0000\u0001")] })).toBe(false)
  // Both languages, the same keys.
  expect(bad({ lang: { zh_cn: { "gameplay.legacy_sample.box_guard.alerted": "惊动" }, en_us: {} } })).toBe(false)
  // The description is not optional, and a thing is listed once.
  expect(bad({ behaviours: [] })).toBe(false)
  expect(bad({ uses: [IDS.block, IDS.block] })).toBe(false)
  expect(GameplayDocumentSchema.safeParse({ ...BOX_GUARD, extra: 1 }).success).toBe(false)
  expect(GameplaySheetSchema.parse(gameplaySheet(BOX_GUARD)).behaviours).toHaveLength(2)
})

// ---- stays in bounds ----

test("the good samples are in bounds; each bad version is caught by its rule, with the line and what to do instead", () => {
  const project = sampleProject()
  expect(staticChecks(project, BOX_GUARD, null)).toEqual({ bounds: [], references: [] })
  expect(staticChecks(project, GUARDIAN_HOME, null)).toEqual({ bounds: [], references: [] })
  const socket = staticChecks(project, BAD.opens_socket, null).bounds
  expect(rules(socket)).toEqual(["network"])
  expect(socket[0]).toMatchObject({ file: "Alarm.java", line: 36 })
  expect(findingLine(socket[0]!)).toBe("Alarm.java 第 36 行：用到了 java.net.Socket：连接游戏以外的地址。玩法要在客户端和服务端之间传消息，用 Fabric 的 networking API（自定义 payload）；不能连游戏以外的任何地址。")
  const reflection = staticChecks(project, BAD.uses_reflection, null).bounds
  expect(rules(reflection)).toEqual(["reflection"])
  expect(reflection.map((finding) => finding.line)).toEqual([35, 35, 36])
  expect(findingLine(reflection[0]!)).toBe("Pulse.java 第 35 行：调用了 forName：反射。直接用公开的类和方法。碰不到的私有成员在这一版里就是碰不到：不开放反射、mixin 和 access widener。")
  // The other bad versions are in bounds: they are for the other checks to catch.
  ;[BAD.does_not_compile, BAD.missing_item, BAD.claims_a_drop].forEach((document) => expect(staticChecks(project, document, null).bounds).toEqual([]))
})

test("every scan rule holds against the plain form and against the ways around it", () => {
  const cases: [string, string, string][] = [
    ["files", "import java.io.File;", "new File(\"a\").delete();"],
    ["files", "", "java.nio.file.Files.readAllBytes(java.nio.file.Path.of(\"options.txt\"));"],
    ["files", "import java.nio.file.*;", "Files.writeString(Paths.get(\"x\"), \"y\");"],
    ["files", "", "var folder = net.fabricmc.loader.api.FabricLoader.getInstance().getGameDir();"],
    ["files", "import net.minecraft.client.Minecraft;", "var folder = Minecraft.getInstance().gameDirectory;"],
    ["files", "", "var folder = server.getWorldPath(net.minecraft.world.level.storage.LevelResource.ROOT);"],
    ["files", "import com.mojang.blaze3d.platform.NativeImage;", "NativeImage image = null;"],
    ["files", "import net.minecraft.nbt.NbtIo;", "NbtIo.read(null);"],
    ["network", "import java.net.Socket;", "new Socket(\"example.com\", 80);"],
    ["network", "", "new java.net.URL(\"https://example.com\").openStream();"],
    ["network", "import java.net.http.HttpClient;", "HttpClient.newHttpClient();"],
    ["network", "", "java . net . URI . create(\"https://example.com\");"],
    ["network", "", "java./* hidden */net.\n        Socket s = null;"],
    ["network", "import net.minecraft.client.Minecraft;", "String token = Minecraft.getInstance().getUser().getAccessToken();"],
    ["network", "import net.minecraft.network.Connection;", "Connection connection = null;"],
    ["network", "", "var address = net.minecraft.client.multiplayer.resolver.ServerAddress.parseString(\"example.com\");"],
    ["process", "", "Runtime.getRuntime().exec(\"calc\");"],
    ["process", "", "new ProcessBuilder(\"sh\").start();"],
    ["process", "", "var runtime = java.lang.Runtime.getRuntime();"],
    ["reflection", "", "Class.forName(\"java.lang.\" + \"Runtime\");"],
    ["reflection", "import java.lang.reflect.Method;", "Method m = null;"],
    ["reflection", "", "Object.class.getDeclaredMethods();"],
    ["reflection", "", "\"\".getClass().getMethod(\"length\").invoke(\"\");"],
    ["reflection", "", "var field = String.class.getDeclaredField(\"value\"); field.setAccessible(true);"],
    ["reflection", "import java.lang.invoke.MethodHandles;", "MethodHandles.lookup();"],
    ["reflection", "", "java.lang.invoke.MethodHandles.lookup();"],
    ["class_loading", "", "getClass().getClassLoader().loadClass(\"x.Y\");"],
    ["class_loading", "", "Thread.currentThread().getContextClassLoader();"],
    ["class_loading", "", "sun.misc.Unsafe unsafe = null;"],
    ["class_loading", "", "new java.net.URLClassLoader(new java.net.URL[0]);"],
    ["class_loading", "import java.util.ServiceLoader;", "ServiceLoader.load(Runnable.class);"],
    ["native", "", "System.loadLibrary(\"evil\");"],
    ["native", "", "System.load(\"/tmp/evil.so\");"],
    ["native", "import org.lwjgl.system.MemoryUtil;", "MemoryUtil.memAlloc(4);"],
    ["exit", "", "System.exit(0);"],
    ["exit", "", "System . exit(1);"],
    ["host", "", "Runtime.getRuntime().halt(0);"],
    ["host", "", "String home = System.getProperty(\"user.home\");"],
    ["host", "", "System.getenv(\"PATH\");"],
    ["host", "import java.awt.Desktop;", "Desktop.getDesktop();"],
    ["host", "", "var os = net.minecraft.Util.getPlatform();"],
    ["threads", "", "new Thread(() -> {}).start();"],
    ["threads", "import java.util.concurrent.Executors;", "Executors.newFixedThreadPool(4);"],
    ["threads", "import java.util.concurrent.CompletableFuture;", "CompletableFuture.runAsync(() -> {});"],
    ["threads", "", "new java.util.Timer().schedule(null, 5L);"],
    ["threads", "", "java.util.List.of(1).parallelStream();"],
    ["threads", "", "net.minecraft.Util.backgroundExecutor().execute(() -> {});"],
    ["instrument", "import java.lang.instrument.Instrumentation;", "Instrumentation i = null;"],
    ["instrument", "", "java.lang.management.ManagementFactory.getRuntimeMXBean();"],
    ["scripting", "import javax.script.ScriptEngineManager;", "new ScriptEngineManager().getEngineByName(\"js\");"],
    ["serialization", "", "new java.io.ObjectInputStream(null).readObject();"],
    ["serialization", "import java.io.*;", "ObjectOutputStream out = null;"],
    ["mixin", "import org.spongepowered.asm.mixin.Mixin;", ""],
    ["studio_internals", "import com.minemods.content_legacy_sample.StudioContentRegistry;", ""],
    ["studio_internals", "", "var id = com.minemods.content_legacy_sample.StudioContentRegistry.MOD_ID;"],
    ["other_gameplay", "import com.minemods.content_legacy_sample.gameplay.guardian_home.Main;", ""],
    ["other_gameplay", "", "com.minemods.content_legacy_sample.gameplay.guardian_home.Main.class.hashCode();"],
    ["unicode_escape", "", "java.lang.\\u0052untime r = null;"],
    ["import", "import static java.lang.System.*;", "exit(0);"],
    ["import", "import com.example.evil.Helper;", ""],
    ["client_only", "import net.minecraft.client.Minecraft;", ""],
    ["wildcard_import", "import net.minecraft.world.entity.*;", ""],
    ["wildcard_import", "import net . minecraft . world . item . *;", "Items.APPLE.hashCode();"],
  ]
  cases.forEach(([rule, imports, body]) => {
    const found = scan("Probe.java", java(`        ${body}`, imports))
    expect({ source: `${imports} ${body}`, rules: rules(found).includes(rule) }).toEqual({ source: `${imports} ${body}`, rules: true })
    found.forEach((finding) => expect(finding.message.length > 0 && finding.fix.length > 0 && finding.line !== null).toBe(true))
  })
  // The annotation, with or without the import, and a native method.
  expect(rules(scan("Probe.java", "package com.minemods.content_legacy_sample.gameplay.box_guard;\n@Mixin(Object.class)\nabstract class Probe {}\n"))).toContain("mixin")
  expect(rules(scan("Probe.java", "package com.minemods.content_legacy_sample.gameplay.box_guard;\nfinal class Probe { private native int peek(long address); }\n"))).toContain("native")
})

test("words in comments and strings are not code, and ordinary game code is not refused", () => {
  const harmless = java(
    [
      '        // Runtime.getRuntime().exec("x") would be refused; this is a comment about java.net.Socket',
      '        String text = "new java.net.Socket(\\"a\\", 1) and System.exit(0) and Class.forName";',
      "        /* Thread t = new Thread(); */",
      "        long started = System.currentTimeMillis();",
      "        java.util.List<String> names = new java.util.ArrayList<>();",
      "        java.util.concurrent.atomic.AtomicInteger counter = new java.util.concurrent.atomic.AtomicInteger();",
      "        java.util.Map<String, Integer> seen = new java.util.concurrent.ConcurrentHashMap<>();",
      "        int processed = names.size(); String filePath = text; int thread = 0; int timer = processed + thread;",
      "        net.minecraft.core.BlockPos pos = net.minecraft.core.BlockPos.ZERO;",
      "        System.out.println(pos + filePath + started + counter + seen + timer);",
    ].join("\n"),
    "import net.minecraft.world.entity.player.Player;\nimport net.minecraft.server.level.ServerLevel;\nimport net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;\nimport static java.lang.Math.max;\nimport static net.minecraft.world.item.Items.*;\nimport org.slf4j.Logger;",
  )
  expect(scan("Probe.java", harmless)).toEqual([])
  const stripped = stripJava('String a = "x // not a comment"; // real "comment"\nchar c = \'"\'; int b = 1; /* "block" */ String t = """\n  text "block" //\n  """;')
  expect(stripped.code).not.toMatch(/comment|block|text|not a/)
  expect(stripped.code.split("\n")).toHaveLength(4)
  expect(stripped.strings.map((value) => value.value)).toEqual(["x // not a comment", '\n  text "block" //\n  '])
})

test("a gameplay keeps to its own package: the declared one, no one else's, and the entry has the fixed shape", () => {
  const own = "package com.minemods.content_legacy_sample.gameplay.box_guard;\nfinal class A {}\n"
  expect(scan("A.java", own)).toEqual([])
  expect(scan("util/A.java", own.replace("box_guard;", "box_guard.util;"))).toEqual([])
  // A package somewhere else: another gameplay's, Studio's own, the game's, none at all.
  ;["com.minemods.content_legacy_sample.gameplay.guardian_home", "com.minemods.content_legacy_sample", "com.minemods.content_legacy_sample.gameplay.api", "net.minecraft.server", "com.minemods.content_legacy_sample.gameplay.box_guard.util"].forEach((name) =>
    expect(rules(scan("A.java", own.replace("com.minemods.content_legacy_sample.gameplay.box_guard", name)))).toEqual(["package"]),
  )
  expect(rules(scan("A.java", "final class A {}\n"))).toEqual(["package"])
  expect(scan("A.java", own.replace("box_guard;", "evil;"))[0]!.fix).toBe("这个文件的第一句必须是 package com.minemods.content_legacy_sample.gameplay.box_guard;")
  // Another gameplay's code only when that gameplay is listed under uses.
  const borrows = `${own.replace("final class A {}", "import com.minemods.content_legacy_sample.gameplay.guardian_home.Main;\nfinal class A { Main other; }")}`
  expect(rules(scan("A.java", borrows))).toEqual(["other_gameplay"])
  expect(scan("A.java", borrows, ["guardian_home"])).toEqual([])
  // Client classes only under client/.
  const client = own.replace("box_guard;", "box_guard.client;").replace("final class A {}", "import net.minecraft.client.Minecraft;\nfinal class A {}")
  expect(scan("client/A.java", client)).toEqual([])
  expect(rules(scan("A.java", client.replace("box_guard.client;", "box_guard;")))).toEqual(["client_only"])
  // The entry: the class Studio's boot code creates and calls.
  expect(scanEntries(BOX_GUARD.sources)).toEqual([])
  const main = BOX_GUARD.sources[0]!
  ;[main.content.replace("implements GameplayEntry", ""), main.content.replace("public void onInitialize()", "public void start()"), main.content.replace("public final class Main", "final class Main"), main.content.replace("@Override", "public Main(int seed) {}\n    @Override")].forEach((content) =>
    expect(rules(scanEntries([{ path: "Main.java", content }]))).toEqual(["entry"]),
  )
  expect(GAMEPLAY_SCAN_LIMITS.length).toBeGreaterThanOrEqual(4)
})

// ---- references are real ----

test("everything a gameplay points at is checked against the project", () => {
  const project = sampleProject()
  const check = (document: GameplayDocument, id: string | null = null, in_: Project = project) => checkGameplayReferences(in_, document, id)
  const main = (from: string, to: string): GameplayDocument => ({ ...BOX_GUARD, sources: BOX_GUARD.sources.map((file) => ({ ...file, content: file.content.replace(from, to) })) })
  expect(check(BOX_GUARD)).toEqual([])
  const missing = check(BAD.missing_item)
  expect(missing.map(findingLine)).toEqual(['Main.java 第 11 行：ProjectContent.item("blue_sword")：这个工程里没有这个物品。这个工程里有：「月露」（moon_dew）。'])
  // Listed but not there; used but not listed; a block asked for as an item.
  expect(rules(check({ ...BOX_GUARD, uses: [...BOX_GUARD.uses, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"] }))).toEqual(["unknown_use"])
  expect(rules(check({ ...BOX_GUARD, uses: [IDS.block, IDS.creature] }))).toEqual(["undeclared_use"])
  expect(rules(check(main('ProjectContent.item("moon_dew")', 'ProjectContent.item("mystery_box")')))).toEqual(["unknown_content"])
  expect(check(main('ProjectContent.item("moon_dew")', 'ProjectContent.blockItem("mystery_box")'))).toEqual([])
  // A design document (a worldview) is not something code can attach to.
  expect(rules(check({ ...BOX_GUARD, uses: [...BOX_GUARD.uses, "99999999-9999-4999-8999-999999999999"] }))).toEqual(["unknown_use"])
  // The creature by its rules asset is the same creature.
  expect(check({ ...GUARDIAN_HOME, uses: ["77777777-7777-4777-8777-777777777777"], sources: GUARDIAN_HOME.sources.map((file) => ({ ...file, content: file.content.replace(IDS.creature, "77777777-7777-4777-8777-777777777777") })) })).toEqual([])
  // A name the check cannot read off the source, and a method the accessor does not have.
  expect(rules(check(main('ProjectContent.item("moon_dew")', 'ProjectContent.item(String.valueOf(hand))')))).toEqual(["accessor_argument"])
  expect(rules(check(main('ProjectContent.item("moon_dew")', 'ProjectContent.sword("moon_dew")')))).toEqual(["unknown_accessor"])
  // The literal is found in its own position whatever the other arguments are: a call inside them, brackets or commas inside a string.
  const asked = (call: string) => check(main('ProjectContent.item("moon_dew")', call))
  expect(asked(`ProjectContent.isEntity(ball.getOwner(), "${IDS.creature}")`)).toEqual([])
  expect(asked(`ProjectContent.isEntity(pick(ball.getOwner(), other(1, 2)), "${IDS.creature}")`)).toEqual([])
  expect(asked(`ProjectContent.isEntity(pick("a,)(b", "c\\")d"), "${IDS.creature}")`)).toEqual([])
  expect(asked(`ProjectContent.isEntity(owners[i].get(0), "${IDS.creature}")`)).toEqual([])
  expect(asked(`ProjectContent.addGoal("${IDS.creature}", 2, mob -> new ReturnGoal(mob, Math.max(1, 2)))`)).toEqual([])
  // A name that is a literal but not a thing of the project is still said so; so is every name that is not written out.
  expect(asked(`ProjectContent.isEntity(ball.getOwner(), "mystery")`).map((finding) => finding.message)).toEqual([expect.stringContaining('isEntity("mystery")')])
  expect(rules(asked("ProjectContent.isEntity(ball.getOwner(), nameOf(ball))"))).toEqual(["accessor_argument"])
  expect(rules(asked(`ProjectContent.isEntity(ball.getOwner(), "${IDS.creature}" + suffix)`))).toEqual(["accessor_argument"])
  expect(rules(asked(`ProjectContent.isEntity(ball.getOwner("${IDS.creature}"), nameOf(ball))`))).toEqual(["accessor_argument"])
  // A text the code shows but lang does not have.
  expect(rules(check({ ...BOX_GUARD, lang: { zh_cn: {}, en_us: {} } }))).toEqual(["missing_text"])
  // Data: has to be JSON, in a namespace it may write to, naming things that exist, not in the place of Studio's own files.
  const data = (path: string, content: string) => check({ ...BOX_GUARD, data: [{ path, content }] })
  expect(rules(data("data/legacy_sample/tags/block/guarded.json", "{ not json"))).toEqual(["data_json"])
  expect(rules(data("data/legacy_sample/tags/block/guarded.json", '{"values":["legacy_sample:blue_ore"]}'))).toEqual(["unknown_reference"])
  expect(data("data/legacy_sample/tags/block/guarded.json", '{"values":["legacy_sample:mystery_box","minecraft:stone","#minecraft:logs","legacy_sample:creature_11111111111141118111111111111111"]}')).toEqual([])
  expect(rules(data("data/othermod/tags/block/guarded.json", "{}"))).toEqual(["data_namespace"])
  expect(rules(data("data/legacy_sample/loot_table/blocks/mystery_box.json", "{}"))).toEqual(["shadows_generated"])
  // Only the recipe files Studio writes (data/<mod>/recipe/<recipe id>.json) are kept; any other name in that folder is the gameplay's own.
  expect(rules(data("data/legacy_sample/recipe/66666666-6666-4666-8666-666666666666.json", "{}"))).toEqual(["shadows_generated"])
  expect(rules(data("data/legacy_sample/recipe/anything.json", "{}"))).toEqual([])
  expect(data("data/minecraft/tags/block/dragon_immune.json", '{"values":["legacy_sample:mystery_box"]}')).toEqual([])
  // A text of Studio's own (the item's name) is not the gameplay's to replace.
  expect(rules(check({ ...BOX_GUARD, lang: { zh_cn: { ...BOX_GUARD.lang.zh_cn, "item.legacy_sample.moon_dew": "改名" }, en_us: { ...BOX_GUARD.lang.en_us, "item.legacy_sample.moon_dew": "Renamed" } } }))).toEqual(["shadows_generated"])
  // Against another gameplay already in the project: its slug, its files and its texts are taken; itself it is not held against.
  const saved = withGameplay(project, [[IDS.box_guard, BOX_GUARD]])
  expect(check(BOX_GUARD, IDS.box_guard, saved)).toEqual([])
  expect(rules(check(BOX_GUARD, IDS.guardian_home, saved))).toEqual(["slug_taken", "file_taken", "text_taken"])
  // Listing another gameplay makes it a thing that can be used.
  expect(gameplayThings(saved).find((thing) => thing.kind === "gameplay")).toMatchObject({ asset_id: IDS.box_guard, key: "box_guard", accessor: "import com.minemods.content_legacy_sample.gameplay.box_guard.*;" })
  expect(check({ ...GUARDIAN_HOME, uses: [IDS.creature, IDS.box_guard] }, IDS.guardian_home, saved)).toEqual([])
})

test("what a gameplay uses is a real link in the workspace: it must be a dependency, and two cannot share a slug", () => {
  const project = sampleProject()
  const made = asset(IDS.box_guard, BOX_GUARD)
  expect(WorkspaceSchema.safeParse({ assets: [...project.workspace.assets, made] }).success).toBe(true)
  const loose = WorkspaceSchema.safeParse({ assets: [...project.workspace.assets, { ...made, dependencies: [IDS.block] }] })
  expect(loose.error?.issues.map((issue) => issue.message)).toEqual(["Gameplay asset must depend on every workspace asset it uses"])
  // Taking the block away while a gameplay still uses it does not parse: the removal is blocked like any other reference.
  expect(WorkspaceSchema.safeParse({ assets: [...project.workspace.assets.filter((value) => value.id !== IDS.block && !value.dependencies.includes(IDS.block)), made] }).error?.issues[0]?.message).toBe(`Unknown workspace dependency: ${IDS.block}`)
  const twin = WorkspaceSchema.safeParse({ assets: [...project.workspace.assets, made, { ...asset(IDS.guardian_home, { ...GUARDIAN_HOME, slug: "box_guard" }) }] })
  expect(twin.error?.issues.map((issue) => issue.message)).toEqual(["Another gameplay already uses the slug box_guard; pick a different one"])
  expect(builtWorkspaceAssets(withGameplay(project, [[IDS.box_guard, BOX_GUARD]])).at(-1)).toEqual({ id: IDS.box_guard, module: "gameplay", revision: 1 })
})

// ---- compiles ----

test("compiler output is mapped to the gameplay's own files, lines and plain words; Gradle and Windows paths read the same", () => {
  const unix = `/tmp/p/generated/check-1/src/main/java/com/minemods/content_legacy_sample/gameplay/box_guard/Pulse.java:38: error: cannot find symbol
        player.getCooldowns().setCooldown(dew, COOLDOWN_TICKS);
                             ^
  symbol:   method setCooldown(Item,int)
  location: class ItemCooldowns
/tmp/p/generated/check-1/src/main/java/com/minemods/content_legacy_sample/gameplay/box_guard/util/Maths.java:4: error: ';' expected
    int x = 1
             ^
/tmp/p/generated/check-1/src/main/java/com/minemods/content_legacy_sample/gameplay/guardian_home/Main.java:9: error: incompatible types: String cannot be converted to int
/tmp/p/generated/check-1/src/main/java/com/minemods/content_legacy_sample/StudioContentRegistry.java:20: error: CreativeModeTabs has private access in CreativeModeTabs
/tmp/p/x/Pulse.java:3: warning: [deprecation] foo
3 errors`
  const found = compilerFindings(unix, "legacy_sample", "box_guard")
  expect(found.own.map(findingLine)).toEqual([
    "Pulse.java 第 38 行：编译不过：找不到方法 setCooldown(Item,int)（在 class ItemCooldowns 里）。（编译器原话：cannot find symbol）这个名字在 Minecraft 1.21.1（Mojang 官方名称）或 Fabric API 里不存在，或者少了 import。核对拼写、参数和 import；不确定的接口不要凭印象写。",
    "util/Maths.java 第 4 行：编译不过：语法不对：这里应该有 ;。（编译器原话：';' expected）检查这一行和上一行的括号、分号和引号。",
  ])
  // Errors in someone else's files are told apart: they are not this gameplay's to fix.
  expect(found.elsewhere).toEqual(["guardian_home/Main.java:9: incompatible types: String cannot be converted to int", "content_legacy_sample/StudioContentRegistry.java:20: CreativeModeTabs has private access in CreativeModeTabs"])
  const gradle = `> Task :compileJava FAILED\r\nC:\\Users\\玩家\\MineMods\\p\\generated\\check-1\\src\\main\\java\\com\\minemods\\content_legacy_sample\\gameplay\\box_guard\\Alarm.java:12: error: package net.minecraft.entity.mob does not exist\r\nimport net.minecraft.entity.mob.HostileEntity;\r\n                              ^\r\n1 error\r\n\r\nFAILURE: Build failed with an exception.\r\n`
  expect(compilerFindings(gradle, "legacy_sample", "box_guard").own).toEqual([
    { rule: "compile", file: "Alarm.java", line: 12, message: "编译不过：包 net.minecraft.entity.mob 不存在。（编译器原话：package net.minecraft.entity.mob does not exist）", fix: "核对 import 的包名：用的是 Minecraft 1.21.1 的 Mojang 官方名称（net.minecraft.…），不是 Yarn 名称，也不是别的版本。", plain: "代码引用了一个游戏里没有的程序包，所以编译不过。" },
  ])
  // Every compile finding has a sentence for the person with no class, method or package name in it (round 18's 「找不到类 …」 was the compiler's line).
  for (const finding of [...found.own, ...compilerFindings(gradle, "legacy_sample", "box_guard").own]) expect(identifiersIn(finding.plain ?? "")).toEqual([])
  expect(found.own.every((finding) => !!finding.plain)).toBe(true)
  expect(compilerFindings("BUILD SUCCESSFUL in 4s", "legacy_sample", "box_guard")).toEqual({ own: [], elsewhere: [] })
})

test.skipIf(!HAS_OFFICIAL_JAVAC)("a real compile: the good samples compile with the generated support code, the bad one is caught on its line", async () => {
  const root = await sampleDirectory([[IDS.guardian_home, GUARDIAN_HOME]])
  const run = (document: GameplayDocument) => compileGameplayCandidate(root, { templateDirectory: TEMPLATE, candidate: { asset_id: IDS.box_guard, title: document.name, document }, compiler: officialJavacCompiler })
  expect(await run(BOX_GUARD)).toEqual({ ran: true, compile: { ok: true, findings: [], compiler: "javac (stand-in, Mojang's names)", note: null } })
  const broken = await run(BAD.does_not_compile)
  expect(broken).toMatchObject({ ran: true, compile: { ok: false, compiler: "javac (stand-in, Mojang's names)" } })
  expect(broken.ran && broken.compile.findings.map(findingLine)).toEqual([
    "Pulse.java 第 34 行：编译不过：找不到方法 setCooldown(Item,int)（在 class ItemCooldowns 里）。（编译器原话：cannot find symbol）这个名字在 Minecraft 1.21.1（Mojang 官方名称）或 Fabric API 里不存在，或者少了 import。核对拼写、参数和 import；不确定的接口不要凭印象写。",
  ])
  // The check leaves nothing behind in the project, and the saved project is untouched.
  expect(await readdir(path.join(root, "generated")).catch(() => [])).toEqual([])
  expect((await openProject(root)).workspace.assets.filter((value) => value.module === "gameplay").map((value) => value.id)).toEqual([IDS.guardian_home])
  // A compiler that cannot run at all says so; that is not a verdict on the code.
  expect(await compileGameplayCandidate(root, { templateDirectory: TEMPLATE, candidate: { asset_id: IDS.box_guard, title: "x", document: BOX_GUARD }, compiler: { name: "none", run: async () => Promise.reject(new Error("JAVA_RUNTIME_MISSING")) } })).toEqual({ ran: false, reason: "编译器没有跑起来（JAVA_RUNTIME_MISSING）。" })
  expect(await compileGameplayCandidate(root, { templateDirectory: TEMPLATE, candidate: { asset_id: IDS.box_guard, title: "x", document: BOX_GUARD }, compiler: { name: "offline", run: async () => ({ code: 1, output: "Could not resolve net.fabricmc:fabric-loom.\nBUILD FAILED" }) } })).toMatchObject({ ran: false })
}, 120000)

// ---- the acceptance standard ----

test("the standard holds gameplay to what a machine can check, and says what it leaves to the reviewer and the person", () => {
  const project = sampleProject()
  const judged = (document: GameplayDocument, compiled?: GameplayCheck["compile"]) => reviewAsset(project, { id: IDS.box_guard, module: "gameplay", document, dependencies: document.uses }, { candidate: true, ...(compiled === undefined ? {} : { compiled }) })
  const good = judged(BOX_GUARD)
  expect(good.passed).toBe(true)
  expect(good.criteria.map((value) => [value.name, value.state])).toEqual([["不凑数", "unmeasured"], ["不机械", "unmeasured"], ["认得出", "unmeasured"], ["有主次", "unmeasured"], ["站得住", "passed"], ["配得上", "passed"]])
  expect(judged(BAD.opens_socket).findings.map((finding) => [finding.rule, finding.criterion, finding.severity])).toEqual([["out_of_bounds", "sound", "defect"]])
  expect(judged(BAD.missing_item).findings.map((finding) => [finding.rule, finding.criterion])).toEqual([["broken_reference", "fits"]])
  // Asking for something simple excuses nothing here.
  expect(reviewAsset(project, { id: IDS.box_guard, module: "gameplay", document: BAD.uses_reflection, dependencies: [] }, { brief: "简单一点就行", candidate: true }).passed).toBe(false)
  // The compiler's word is held when the caller has it.
  expect(judged(BOX_GUARD, { ok: false, findings: [{ rule: "compile", file: "Pulse.java", line: 38, message: "编译不过：找不到方法 setCooldown。", fix: "核对拼写。" }], compiler: "javac", note: null }).findings.map((finding) => finding.rule)).toEqual(["does_not_compile"])
  expect(judged(BOX_GUARD, { ok: true, findings: [], compiler: "javac", note: null }).passed).toBe(true)
  // A description that promises more than the code does is not something a rule can see.
  expect(judged(BAD.claims_a_drop).passed).toBe(true)
})

// ---- the loop: floor and review ----

const CLEAN: GameplayCheck = { bounds: [], references: [], compile: { ok: true, findings: [], compiler: "javac", note: null } }
const started = () => beginGameplay(null, { asset_id: IDS.box_guard, entry: "guard", request: "一只守着秘匣的敌对生物", brief: "守匣", task_id: "a0000000-0000-4000-8000-000000000001", remark: null })
const refused = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return error instanceof MakingRefusal ? { message: error.message, final: error.final } : { message: `not a refusal: ${String(error)}`, final: false }
  }
  return null
}

test("the order of work: description, then checks, then a review; nothing is skipped", () => {
  const begun = started()
  expect(begun).toMatchObject({ state: "describing", described: false, rounds_allowed: GAMEPLAY_LIMITS.rounds })
  expect(refused(() => checkedGameplay(begun, BOX_GUARD, CLEAN))?.message).toBe(GAMEPLAY_REFUSALS.no_sheet)
  expect(gameplayCommitGate(begun, fingerprint(BOX_GUARD))).toBe(GAMEPLAY_REFUSALS.no_sheet)
  const described = describeGameplay(begun, gameplaySheet(BOX_GUARD))
  expect(described.state).toBe("writing")
  expect(gameplayCommitGate(described, fingerprint(BOX_GUARD))).toBe(GAMEPLAY_REFUSALS.no_check)
  expect(refused(() => reviewedGameplay(described, { passed: true, findings: [], independent: true }))?.message).toBe(GAMEPLAY_REFUSALS.no_check)
  // The document has to carry the description that was saved: what the reviewer reads is what the person later tests by.
  expect(refused(() => checkedGameplay(described, BAD.claims_a_drop, CLEAN))?.message).toBe(GAMEPLAY_REFUSALS.sheet_differs)
  // A version that fails the floor is recorded, cannot be reviewed and cannot be handed in.
  const socket = staticChecks(sampleProject(), BAD.opens_socket, null)
  const failed = checkedGameplay(described, BAD.opens_socket, { ...socket, compile: null })
  expect(failed).toMatchObject({ state: "writing", best: null, rounds: [{ round: 1, passed: false }] })
  expect(refused(() => reviewedGameplay(failed, { passed: true, findings: [], independent: true }))?.message).toStartWith("这一版没有通过代码检查，不能评审也不能提交：Alarm.java 第 36 行：用到了 java.net.Socket")
  expect(gameplayCommitGate(failed, fingerprint(BAD.opens_socket))).toStartWith("这一版没有通过代码检查")
  // The fixed version opens round 2, passes the floor and becomes the best.
  const passed = checkedGameplay(failed, BOX_GUARD, CLEAN)
  expect(passed).toMatchObject({ state: "reviewing", best: { round: 2 }, rounds: [{ passed: false }, { round: 2, passed: true }] })
  expect(gameplayCommitGate(passed, fingerprint(BOX_GUARD))).toBe(GAMEPLAY_REFUSALS.no_review)
  // Checking the same version again does not use up a round.
  expect(checkedGameplay(passed, BOX_GUARD, CLEAN).rounds).toHaveLength(2)
  // Only blocking findings fail a review; the two lists cannot contradict the verdict.
  expect(refused(() => reviewedGameplay(passed, { passed: false, findings: [], independent: true }))?.message).toContain("验收说没通过，却没有一条")
  expect(refused(() => reviewedGameplay(passed, { passed: true, findings: ["缺掉落"], independent: true }))?.message).toContain("验收说通过，findings 里却列着问题")
  const reviewed = reviewedGameplay(passed, { passed: true, findings: [], advice: ["标签以后加别的方块也会触发"], independent: true })
  expect(gameplayCommitGate(reviewed, fingerprint(BOX_GUARD))).toBeNull()
  // Any other version than the one checked and reviewed is not what was approved.
  expect(gameplayCommitGate(reviewed, fingerprint({ ...BOX_GUARD, not_doing: [] }))).toBe(GAMEPLAY_REFUSALS.unchecked)
  const done = finishGameplay(reviewed)
  expect(done).toMatchObject({ state: "done", outcome: "passed", saved: { fingerprint: fingerprint(BOX_GUARD), check: CLEAN } })
  expect(refused(() => checkedGameplay(done, BOX_GUARD, CLEAN))).toEqual({ message: GAMEPLAY_REFUSALS.over, final: true })
  expect(GameplayRecordSchema.parse(JSON.parse(JSON.stringify(done)))).toEqual(done)
  expect(shownGameplay(done)).toMatchObject({ outcome: "passed", review: { passed: true, independent: true, round: 2 }, saved: { check: CLEAN, round: 2, review: { passed: true, advice: ["标签以后加别的方块也会触发"] } } })
  expect(JSON.stringify(shownGameplay(done))).not.toContain("fingerprint")
  // What was checked and reviewed counts for the version the project holds: the same version is shown its records, another one (changed by hand since) is told there are none.
  expect(shownGameplay(done, BOX_GUARD).saved).toMatchObject({ round: 2, review: { passed: true } })
  expect(shownGameplay(done, { ...BOX_GUARD, not_doing: [] }).saved).toBeNull()
})

test("a revision that names no plan entry is still the same entry's gameplay, so the card that looks the record up by the entry finds it", () => {
  const first = beginGameplay(null, { asset_id: IDS.guardian_home, entry: "guard", request: "守着秘匣", brief: "做", task_id: crypto.randomUUID(), remark: null })
  const again = beginGameplay(first, { asset_id: IDS.guardian_home, entry: null, request: "把铃声调小", brief: "调小", task_id: crypto.randomUUID(), remark: null })
  expect(again.entry).toBe("guard")
  expect(again.sheet).toEqual(first.sheet)
})

test("a description rewritten after a check has to be checked against again, and a failed review sends the work back", () => {
  const passed = checkedGameplay(describeGameplay(started(), gameplaySheet(BOX_GUARD)), BOX_GUARD, CLEAN)
  const failed = reviewedGameplay(passed, { passed: false, findings: ["说明写了掉落，代码没有"], independent: true })
  expect(failed.state).toBe("writing")
  expect(gameplayCommitGate(failed, fingerprint(BOX_GUARD))).toBe(GAMEPLAY_REFUSALS.review_failed)
  expect(refused(() => reviewedGameplay(failed, { passed: true, findings: [], independent: true }))?.message).toBe(GAMEPLAY_REFUSALS.reviewed_and_failed)
  // The same version is reviewed once more only when the failed review lacked material, or the reviewer is now handed something else.
  const A = "a".repeat(64)
  const B = "b".repeat(64)
  expect(refused(() => reviewedGameplay(reviewedGameplay(passed, { passed: false, findings: ["没播攻击动作"], independent: true, packet: A }), { passed: true, findings: [], independent: true, packet: A }))?.message).toBe(GAMEPLAY_REFUSALS.reviewed_and_failed)
  const lacked = reviewedGameplay(passed, { passed: false, findings: ["没播攻击动作"], independent: true, packet: A, lacking: ["生成的生物类里 doHurtTarget 做了什么"] })
  expect(lacked.review).toMatchObject({ passed: false, packet: A, lacked: ["生成的生物类里 doHurtTarget 做了什么"] })
  expect(reviewAgain(lacked, A)).toEqual({ repeat: true, allowed: true })
  const second = reviewedGameplay(lacked, { passed: true, findings: [], independent: true, packet: A })
  expect(second).toMatchObject({ state: "reviewing", review: { passed: true, again: true } })
  expect(gameplayCommitGate(second, fingerprint(BOX_GUARD))).toBeNull()
  // Once more means once: a second failure of the same version is final for it, whatever it says it lacked.
  const twice = reviewedGameplay(lacked, { passed: false, findings: ["还是没有"], independent: true, packet: A, lacking: ["别的"] })
  expect(refused(() => reviewedGameplay(twice, { passed: true, findings: [], independent: true, packet: B }))?.message).toBe(GAMEPLAY_REFUSALS.reviewed_and_failed)
  // A different packet (Studio hands over what it did not before), and a record from before packets were kept.
  const changed = reviewedGameplay(reviewedGameplay(passed, { passed: false, findings: ["没播攻击动作"], independent: true, packet: A }), { passed: true, findings: [], independent: true, packet: B })
  expect(changed.review).toMatchObject({ passed: true, packet: B, again: true })
  expect(reviewAgain(failed, B)).toEqual({ repeat: true, allowed: true })
  expect(reviewAgain(failed, undefined)).toEqual({ repeat: true, allowed: false })
  // On the last version allowed, a failed review that lacked material does not end the making.
  const last = { ...passed, rounds_allowed: 1 }
  expect(reviewedGameplay(last, { passed: false, findings: ["没播攻击动作"], independent: true }).state).toBe("stopped")
  expect(reviewedGameplay(last, { passed: false, findings: ["没播攻击动作"], independent: true, lacking: ["doHurtTarget"] }).state).toBe("writing")
  expect(GameplayRecordSchema.parse(JSON.parse(JSON.stringify(second)))).toEqual(second)
  // Rewriting the description drops the review and asks for a new check under the new description.
  const again = describeGameplay(passed, gameplaySheet(BAD.claims_a_drop))
  expect(again.review).toBeNull()
  expect(refused(() => reviewedGameplay(again, { passed: true, findings: [], independent: true }))?.message).toBe(GAMEPLAY_REFUSALS.redescribed)
  expect(refused(() => checkedGameplay(again, BOX_GUARD, CLEAN))?.message).toBe(GAMEPLAY_REFUSALS.sheet_differs)
  expect(checkedGameplay(again, BAD.claims_a_drop, CLEAN)).toMatchObject({ state: "reviewing", rounds: [{ round: 1 }, { round: 2 }] })
})

test("rounds are bounded; when they run out the best version that passed the machine checks is what is kept, with the reasons", () => {
  const described = describeGameplay(started(), gameplaySheet(BOX_GUARD))
  const variant = (index: number): GameplayDocument => ({ ...BOX_GUARD, sources: [...BOX_GUARD.sources, { path: `Extra${index}.java`, content: `package com.minemods.content_legacy_sample.gameplay.box_guard;\nfinal class Extra${index} {}\n` }] })
  const broken: GameplayCheck = { bounds: [], references: [], compile: { ok: false, findings: [{ rule: "compile", file: "Pulse.java", line: 38, message: "编译不过。", fix: "改。" }], compiler: "javac", note: null } }
  // Version 1 passes the floor but fails the review; every later version fails to compile.
  const first = reviewedGameplay(checkedGameplay(described, variant(1), CLEAN), { passed: false, findings: ["说明写的 10 秒冷却，代码里是 5 秒"], advice: ["粒子可以更明显"], independent: true })
  const spent = Array.from({ length: GAMEPLAY_LIMITS.rounds - 1 }, (_, index) => index + 2).reduce((record, index) => checkedGameplay(record, variant(index), broken), first)
  expect(spent).toMatchObject({ state: "stopped", best: { round: 1 } })
  expect(spent.rounds).toHaveLength(GAMEPLAY_LIMITS.rounds)
  expect(refused(() => checkedGameplay(spent, variant(99), CLEAN))).toEqual({ message: GAMEPLAY_REFUSALS.over, final: true })
  const reasons = gameplayUnsatisfied(spent, GAMEPLAY_REFUSALS.out_of_rounds(GAMEPLAY_LIMITS.rounds))
  expect(reasons).toEqual([
    `停下的原因：已经检查了 ${GAMEPLAY_LIMITS.rounds} 版（上限 ${GAMEPLAY_LIMITS.rounds} 版），还是没有做到三项检查都过、评审也通过。`,
    "评审认为必须改：说明写的 10 秒冷却，代码里是 5 秒",
    "评审认为可以更好：粒子可以更明显",
    "交给你的是第 1 版：后面的版本没有通过代码检查，没有留。",
  ])
  const kept = keepGameplay(spent, reasons)
  expect(kept).toMatchObject({ state: "done", outcome: "kept_unsatisfied", kept_round: 1, saved: { fingerprint: fingerprint(variant(1)), check: CLEAN } })
  // Opening one round too many, while the last one passed the floor, is the cap speaking.
  const full = Array.from({ length: GAMEPLAY_LIMITS.rounds }, (_, index) => index + 1).reduce((record, index) => checkedGameplay(record, variant(index), CLEAN), described)
  expect(refused(() => checkedGameplay(full, variant(50), CLEAN))).toEqual({ message: GAMEPLAY_REFUSALS.out_of_rounds(GAMEPLAY_LIMITS.rounds), final: true })
  // Nothing ever passed the floor: there is nothing to keep.
  expect(checkedGameplay(described, variant(1), broken).best).toBeNull()
  expect(floorPassed({ bounds: [], references: [], compile: null })).toBe(false)
})

// ---- the build ----

const hashed = async (source: string) => {
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, "/")).sort()
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, createHash("sha256").update(await readFile(path.join(source, name))).digest("hex")] as const)))
}

test("a project with gameplay assembles its sources, data, texts and entries; everything else is byte for byte what it was without", async () => {
  const plain = await sampleDirectory()
  const before = path.join(plain, "source")
  await mkdir(before)
  const without = await assembleBuildSource(plain, before, TEMPLATE)
  expect(without.gameplay).toEqual([])
  expect(without.gameplayFiles).toEqual([])
  const root = await sampleDirectory([[IDS.box_guard, BOX_GUARD], [IDS.guardian_home, GUARDIAN_HOME]])
  const source = path.join(root, "source")
  await mkdir(source)
  const assembled = await assembleBuildSource(root, source, TEMPLATE)
  const [old, now] = [await hashed(before), await hashed(source)]
  const added = Object.keys(now).filter((name) => !(name in old))
  const folder = "src/main/java/com/minemods/content_legacy_sample/gameplay"
  expect(added).toEqual([
    "src/main/resources/data/legacy_sample/tags/block/guarded.json",
    `${folder}/api/AbilityAction.java`,
    `${folder}/api/GameplayBoot.java`,
    `${folder}/api/GameplayClientEntry.java`,
    `${folder}/api/GameplayEntry.java`,
    `${folder}/api/ProjectContent.java`,
    `${folder}/box_guard/Alarm.java`,
    `${folder}/box_guard/Main.java`,
    `${folder}/box_guard/Pulse.java`,
    `${folder}/guardian_home/Main.java`,
  ].sort())
  expect(Object.keys(old).filter((name) => !(name in now))).toEqual([])
  // Only the files that have to know about gameplay differ; no template file, and of the generated classes only the creature, which takes on the goals gameplay adds.
  const creatureFile = "src/main/java/com/minemods/content_legacy_sample/entity/StudioCreature.java"
  expect(Object.keys(old).filter((name) => old[name] !== now[name]).sort()).toEqual(["README-STUDIO.md", "minemods-build.json", "project-backup/minemods.project.json", creatureFile, "src/main/resources/assets/legacy_sample/lang/en_us.json", "src/main/resources/assets/legacy_sample/lang/zh_cn.json", "src/main/resources/fabric.mod.json"])
  const read = (name: string) => readFile(path.join(source, name), "utf8")
  // A few lines more in the creature and nothing else: the import, the call after its own goals, and what lets gameplay code play its motions (the interface, one controller, the answer to the call).
  const plainCreature = (await readFile(path.join(before, creatureFile), "utf8")).split("\n")
  const gained = (await read(creatureFile)).split("\n").filter((line) => !plainCreature.includes(line))
  expect(gained.slice(0, 4)).toEqual(["import com.minemods.content_legacy_sample.gameplay.api.ProjectContent;", "public class StudioCreature extends AgeableMob implements GeoEntity, Enemy, ProjectContent.StudioActor {", "        // What this mod's gameplay code adds to this kind of creature, beside the goals above.", "        ProjectContent.applyGoals(this, goalSelector, targetSelector);"])
  expect(gained.slice(4).join("\n")).toMatch(/^ {8}\/\/ Started by gameplay code through ProjectContent\.playMotion[\s\S]*PLAYABLE_MOTIONS = java\.util\.Set\.of\("idle", "walk", "hurt"\);[\s\S]*triggerAnim\("motion", motion\);[\s\S]*$/)
  expect(await read(`${folder}/box_guard/Pulse.java`)).toBe(BOX_GUARD.sources[2]!.content)
  const metadata = JSON.parse(await read("src/main/resources/fabric.mod.json"))
  // Started after Studio's own content is registered, through the generated boot class; no client entry when no gameplay has client code.
  expect(metadata.entrypoints.main).toEqual(["com.minemods.content_legacy_sample.StudioContent", "com.minemods.content_legacy_sample.gameplay.api.GameplayBoot"])
  expect(metadata.entrypoints.client).toEqual(["com.minemods.content_legacy_sample.client.StudioClient"])
  expect(metadata.custom["minemods:gameplay"]).toEqual({ ai_written_code: true, units: ["box_guard", "guardian_home"] })
  expect(JSON.parse(await read("src/main/resources/assets/legacy_sample/lang/zh_cn.json"))["gameplay.legacy_sample.box_guard.alerted"]).toBe("惊动了 %s 只守卫")
  expect(JSON.parse(await read("src/main/resources/assets/legacy_sample/lang/en_us.json"))["gameplay.legacy_sample.box_guard.alerted"]).toBe("%s guardians alerted")
  const boot = await read(`${folder}/api/GameplayBoot.java`)
  expect(boot).toContain('start("box_guard", com.minemods.content_legacy_sample.gameplay.box_guard.Main::new);\n        start("guardian_home", com.minemods.content_legacy_sample.gameplay.guardian_home.Main::new);')
  // Created inside the try: a static field or constructor that throws switches that gameplay off, not the game.
  expect(boot).toContain("entry.get().onInitialize();\n        } catch (RuntimeException | LinkageError error) {")
  const content = await read(`${folder}/api/ProjectContent.java`)
  expect(content).toContain('private static final Set<String> ITEMS = Set.of("moon_dew");')
  expect(content).toContain('private static final Set<String> BLOCKS = Set.of("mystery_box");')
  // The creature once, and the asset of its rules as another name for it: a walk over the creatures meets it once, a lookup by either id finds it.
  expect(content).toContain(`ENTITIES = Map.ofEntries(Map.entry("${IDS.creature}", "creature_11111111111141118111111111111111"));`)
  expect(content).toContain(`ALIASES = Map.ofEntries(Map.entry("77777777-7777-4777-8777-777777777777", "${IDS.creature}"));`)
  // The manifest: which code an AI wrote, file by file with hashes, and what was and was not checked.
  const manifest = JSON.parse(await read("minemods-build.json"))
  expect(Object.keys(manifest).at(-1)).toBe("gameplay")
  expect(manifest.gameplay.map((entry: { slug: string }) => entry.slug)).toEqual(["box_guard", "guardian_home"])
  expect(manifest.gameplay[0]).toMatchObject({ id: IDS.box_guard, title: "守匣警报与月露震波", revision: 1, ai_written_code: true, package: "com.minemods.content_legacy_sample.gameplay.box_guard", uses: BOX_GUARD.uses, checks: { in_bounds: true, references_real: true, compiled_with: null, review: null, launched_in_game: false } })
  expect(manifest.gameplay[0].files).toEqual([
    ...BOX_GUARD.sources.map((file) => ({ path: `${folder}/box_guard/${file.path}`, bytes: Buffer.byteLength(file.content), sha256: createHash("sha256").update(file.content).digest("hex") })),
    { path: "src/main/resources/data/legacy_sample/tags/block/guarded.json", bytes: Buffer.byteLength(BOX_GUARD.data[0]!.content), sha256: createHash("sha256").update(BOX_GUARD.data[0]!.content).digest("hex") },
  ])
  expect(manifest.workspace_assets.filter((value: { module: string }) => value.module === "gameplay")).toHaveLength(2)
  expect(await read("README-STUDIO.md")).toContain("Gameplay (code written by an AI, 2 units): 守匣警报与月露震波 (com.minemods.content_legacy_sample.gameplay.box_guard); 守卫恋家 (com.minemods.content_legacy_sample.gameplay.guardian_home).")
  expect(assembled.gameplayFiles).toEqual(["com/minemods/content_legacy_sample/gameplay/api/GameplayBoot.class", "com/minemods/content_legacy_sample/gameplay/box_guard/Main.class", "com/minemods/content_legacy_sample/gameplay/guardian_home/Main.class"])
  if (!HAS_OFFICIAL_JAVAC) return
  // The assembled gameplay folder compiles as it is.
  expect(await officialJavacCompiler.run(source, path.join(source, folder))).toEqual({ code: 0, output: expect.any(String) })
}, 120000)

test("the manifest carries what the loop recorded for the very version that is built, and a build refuses code out of bounds", async () => {
  const root = await sampleDirectory([[IDS.box_guard, BOX_GUARD]])
  await changeGameplay(root, IDS.box_guard, () => finishGameplay(reviewedGameplay(checkedGameplay(describeGameplay(started(), gameplaySheet(BOX_GUARD)), BOX_GUARD, CLEAN), { passed: true, findings: [], independent: true })))
  const source = path.join(root, "source")
  await mkdir(source)
  await assembleBuildSource(root, source, TEMPLATE)
  expect(JSON.parse(await readFile(path.join(source, "minemods-build.json"), "utf8")).gameplay[0].checks).toEqual({ in_bounds: true, references_real: true, compiled_with: "javac", review: "passed", launched_in_game: false })
  // Code that got into a project some other way (an imported archive) is scanned again before it is ever compiled.
  const opened = await openProject(root)
  await saveProject(root, ProjectSchema.parse({ ...opened, workspace: { assets: opened.workspace.assets.map((value) => (value.id === IDS.box_guard ? { ...value, document: BAD.opens_socket } : value)) } }), opened.revision)
  const again = path.join(root, "again")
  await mkdir(again)
  await expect(assembleBuildSource(root, again, TEMPLATE)).rejects.toThrow(`GAMEPLAY_OUT_OF_BOUNDS:${IDS.box_guard}`)
})

test("a gameplay with client code gets a client entry of its own package", async () => {
  const client = `package com.minemods.content_legacy_sample.gameplay.guardian_home.client;\n\nimport com.minemods.content_legacy_sample.gameplay.api.GameplayClientEntry;\nimport net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;\n\npublic final class ClientMain implements GameplayClientEntry {\n    @Override public void onInitializeClient() {\n        ClientTickEvents.END_CLIENT_TICK.register(game -> {});\n    }\n}\n`
  const document: GameplayDocument = { ...GUARDIAN_HOME, sources: [...GUARDIAN_HOME.sources, { path: GAMEPLAY_API.client_main, content: client }] }
  expect(staticChecks(sampleProject(), document, null)).toEqual({ bounds: [], references: [] })
  const root = await sampleDirectory([[IDS.guardian_home, document]])
  const source = path.join(root, "source")
  await mkdir(source)
  await assembleBuildSource(root, source, TEMPLATE)
  expect(JSON.parse(await readFile(path.join(source, "src/main/resources/fabric.mod.json"), "utf8")).entrypoints.client).toEqual(["com.minemods.content_legacy_sample.client.StudioClient", "com.minemods.content_legacy_sample.gameplay.api.client.GameplayClientBoot"])
  if (!HAS_OFFICIAL_JAVAC) return
  expect((await officialJavacCompiler.run(source, path.join(source, "src/main/java/com/minemods/content_legacy_sample/gameplay"))).code).toBe(0)
}, 120000)

test("the try-it list is the description turned into steps, with how to get hold of each thing", () => {
  const list = gameplayTryList("legacy_sample", BOX_GUARD, gameplayThings(sampleProject()))
  // Round 17: a new creative world first; each thing by the creative inventory (by its name) before the command, and the command as one pasted line.
  expect(list.prepare).toEqual([
    "把构建出来的模组放进 mods 文件夹（用 Studio 里的“构建并试玩”按钮打开游戏的话已经放好了），进一个创造模式的世界。新建的办法：在游戏里点「单人游戏」→「创建新的世界」，把游戏模式选成「创造」，把「允许作弊」打开（用命令才需要），再点「创建新的世界」",
    "拿到「秘匣」并放下几块：按 E 打开物品栏，点「搜索物品」页签，输入「秘匣」，点一下它，它只是跟在鼠标上；再点一下快捷栏里的一个空格，它才放进去，选中那一格后对着地面右键放下；不想翻物品栏的话，按 T 打开聊天框，粘贴 `/give @s legacy_sample:mystery_box` 再按回车，直接给你一个",
    "拿到「月露」：按 E 打开物品栏，点「搜索物品」页签，输入「月露」，点一下它，它只是跟在鼠标上；再点一下快捷栏里的一个空格，它才放进去；不想翻物品栏的话，按 T 打开聊天框，粘贴 `/give @s legacy_sample:moon_dew` 再按回车，直接给你一个",
    "放出「苔皮苦力怕」：按 E 打开物品栏，点「刷怪蛋」页签找到「苔皮苦力怕刷怪蛋」，点一下它，它只是跟在鼠标上；再点一下快捷栏里的一个空格，它才放进去，选中那一格后对着地面右键；不想翻物品栏的话，按 T 打开聊天框，粘贴 `/summon legacy_sample:creature_11111111111141118111111111111111` 再按回车，它就出现在你面前",
  ])
  expect(list.steps).toEqual(BOX_GUARD.behaviours.map((behaviour) => ({ do: behaviour.when, expect: behaviour.does, notice: behaviour.shows })))
  expect(list.not_expected).toEqual(BOX_GUARD.not_doing)
})

test("the record of a gameplay is found by its asset or by its plan entry, and travels with an exported project", async () => {
  const root = await sampleDirectory([[IDS.box_guard, BOX_GUARD]])
  const record = finishGameplay(reviewedGameplay(checkedGameplay(describeGameplay(started(), gameplaySheet(BOX_GUARD)), BOX_GUARD, CLEAN), { passed: true, findings: [], independent: true }))
  await changeGameplay(root, IDS.box_guard, () => record)
  expect(await findGameplay(root, IDS.box_guard)).toMatchObject({ outcome: "passed", entry: "guard" })
  expect((await findGameplay(root, "guard"))?.asset_id).toBe(IDS.box_guard)
  expect(await findGameplay(root, "nothing")).toBeNull()
  expect(await findGameplay(root, IDS.guardian_home)).toBeNull()
  const archive = path.join(root, "out.minemods")
  await exportProjectArchive({ directory: root, destination: archive })
  const copy = path.join(root, "copy")
  await importProjectArchive({ archive, destination: copy })
  expect(await readGameplay(copy, IDS.box_guard)).toEqual(await readGameplay(root, IDS.box_guard))
  expect((await openProject(copy)).workspace.assets.find((value) => value.id === IDS.box_guard)?.document).toEqual(BOX_GUARD)
})

test("the Gradle entry stays a closed list: compiling was added by name, and nothing else gets through", async () => {
  const runtime = await readFile(new URL("../src/runtime.ts", import.meta.url), "utf8")
  expect(runtime).toContain('export async function runGradle(sourceDirectory: string, task: "build" | "runClient" | "compileJava" | typeof MIGRATE_MAPPINGS_TASK, options: RuntimeOptions)')
  expect(runtime).toContain('if (task !== "build" && task !== "runClient" && task !== "compileJava" && task !== MIGRATE_MAPPINGS_TASK) throw new Error("UNSUPPORTED_GRADLE_TASK")')
  // The conversion of older gameplay code to Mojang's names was added by name too, with its one fixed option, and the conversion passes that task and no other.
  expect(runtime).toContain('export const MIGRATE_MAPPINGS_TASK = "migrateMappings"')
  expect((await readFile(new URL("../src/naming-migration.ts", import.meta.url), "utf8")).match(/gradle\([^)]*\)/g)).toEqual(["gradle(work, MIGRATE_MAPPINGS_TASK, options)"])
  // The task name reaches Gradle as one fixed argument; the code check passes this one and no other, and so does the preparation done ahead of a pack (`prepareDevelopmentFiles`), which runs the pack's own task.
  // A pack and the check both go through `projectGradle`, whose task is one of these two by its type, so a check gets the toolchain and the Java its target's build gets.
  const build = await readFile(new URL("../src/build.ts", import.meta.url), "utf8")
  expect(build.match(/runGradle\([^)]*\)/g)).toEqual(['runGradle(directory, "build", options)', 'runGradle(sourceDirectory, task, options)'])
  expect(build).toContain('export function projectGradle(manifest: TargetManifest, sourceDirectory: string, task: "build" | "compileJava", options: BuildOptions)')
  expect(build.match(/(?<!function )projectGradle\(.*?, options\)/g)).toEqual(['projectGradle(source.target.manifest, source.directory, "build", options)', 'projectGradle(targetManifest(target), sourceDirectory, "compileJava", options)'])
})

test("a gameplay refusal has a tool voice only an outside AI is told: Studio's own AI and the person get the same facts without it", () => {
  const said = [
    ...Object.values(GAMEPLAY_REFUSALS).map((words) => (typeof words === "string" ? words : (words as (value: never) => string)((words === GAMEPLAY_REFUSALS.floor || words === GAMEPLAY_REFUSALS.floor_plain ? ["Guard.java 第 3 行：改成 A。"] : words === GAMEPLAY_REFUSALS.no_compiler ? "下载不到编译要用的文件。" : 3) as never))),
    `${GAMEPLAY_REFUSALS.floor(["甲。"])}${GAMEPLAY_REFUSALS.out_of_rounds(3)}${GAMEPLAY_REFUSALS.kept(2)}`,
  ]
  // Every tail is really the text of its refusal, so the outside AI's wording did not move.
  for (const [key, tail] of Object.entries(GAMEPLAY_TOOL_VOICE)) expect(said.some((words) => words.includes(tail)), key).toBe(true)
  for (const words of said) {
    const own = gameplayOwnWords(words)
    expect(own, words).not.toMatch(/[a-z]+_[a-z]+|调用|\blook\b|lacking|verdict|generated|document/)
    expect(own, words).toMatch(/[。）]$/)
    expect(words.startsWith(own.slice(0, 8))).toBe(true)
  }
  expect(gameplayOwnWords(GAMEPLAY_REFUSALS.no_sheet)).toBe("还没有玩法说明。")
  expect(gameplayOwnWords(GAMEPLAY_REFUSALS.unchecked)).toBe("你要提交的这一版和上一次检查的不一样。")
  expect(gameplayOwnWords(GAMEPLAY_REFUSALS.floor(["Guard.java 第 3 行：改成 A。"]))).toBe("这一版没有通过代码检查，不能评审也不能提交：Guard.java 第 3 行：改成 A。")
  expect(gameplayOwnWords(GAMEPLAY_REFUSALS.unchanged)).toBe(GAMEPLAY_REFUSALS.unchanged)
})
