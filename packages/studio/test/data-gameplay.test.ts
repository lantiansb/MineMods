import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { checkBbmodel } from "@minemods/mod-core/bbmodel"
import { BLOCK_SOUNDS, CREATURE_SOUNDS, DATA_CAPABILITY } from "@minemods/mod-core/data-words"
import { ContentSchema } from "@minemods/mod-core/content"
import { createHash, randomUUID } from "node:crypto"
import { assembleBuildSource, BuildResultSchema, exportBuiltJar, verifyBuiltResult, writeBuildCompanions } from "@minemods/mod-core/build"
import { dispatchExternal, externalError } from "../src/main/external-dispatch"
import { getMcpCapabilities } from "../src/main/mcp-capabilities"
import { MCP_TOOLS } from "../src/main/mcp-handoff"
import { everythingToRead } from "./handoff-reading"
import { createStudioService, plainContent, publicError } from "../src/main/service"
import { StudioRequestSchema, WorkerRequestSchema } from "../src/main/protocol"
import { ExternalBridgeMethodSchema } from "../src/external"
import { describeAsset } from "../src/renderer/features/asset-words"
import { createDataGameplaySample } from "../../mod-core/script/data-gameplay-sample"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const directories: string[] = []
const closers: (() => unknown)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

/** A service whose workspace already holds the sample project that uses every data-only feature. */
async function bench() {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-data-"))
  directories.push(root)
  const sample = await createDataGameplaySample(path.join(root, "projects", "azure"))
  const service = await createStudioService({ workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: TEMPLATE, ai: { mode: "mcp" } })
  closers.push(() => service.dispose())
  await service.listProjects()
  return { root, service, sample, projectId: sample.id }
}

test("the mod guide and the reconciliation are read through the app and through MCP, without a build", async () => {
  const { service, projectId, sample } = await bench()
  const view = await service.getModGuide({ projectId })
  expect(view.revision).toBe(sample.revision)
  expect(view.title).toBe("蓝晶矿洞 模组说明")
  expect(view.markdown).toContain("「蓝晶矿石」在主世界 Y −16 到 48 的石头、深板岩里生成")
  expect(view.sections.map((section) => section.title)).toContain("生物「晶石傀儡」")
  expect(view.sections.every((section) => section.lines.every((line) => line.from.length > 0))).toBe(true)
  expect(view.findings.map((finding) => finding.rule)).toEqual(["animation_unplayed"])
  // The same through the door an outside AI uses; read-only, by the project id alone.
  const told = (await dispatchExternal(service, { method: "getModGuide", input: { projectId } })) as { revision: number; guide: string; findings: unknown[] }
  expect(told).toEqual({ revision: view.revision, guide: view.markdown, findings: [{ ...view.findings[0], refs: [{ kind: "clip", id: "wave", title: "挥动" }, { kind: "asset", id: sample.entities[0]!.id, title: sample.entities[0]!.name }] }] })
  await expect(dispatchExternal(service, { method: "getModGuide", input: { projectId, path: "/etc" } })).rejects.toThrow()
  expect(ExternalBridgeMethodSchema.options).toContain("getModGuide")
  expect(MCP_TOOLS.find((tool) => tool[0] === "get_mod_guide")![1]).toContain("不用 AI，不启动游戏")
  // Nothing was built and nothing was written.
  expect((await service.openProject(projectId)).project.revision).toBe(sample.revision)
  expect(await service.getLatestBuild({ projectId })).toBeNull()
})

test("a model is saved as a .bbmodel where the person chose, and only there", async () => {
  const { root, service, projectId, sample } = await bench()
  const destination = path.join(root, "晶石傀儡.bbmodel")
  expect(await service.exportBlockbenchTo(projectId, sample.entities[0]!.id, destination)).toEqual({ path: destination })
  const written = JSON.parse(await readFile(destination, "utf8"))
  expect(checkBbmodel(written)).toEqual([])
  expect(written.meta.model_format).toBe("bedrock")
  expect(written.animations).toHaveLength(5)
  const refused = (step: Promise<unknown>) => step.then(() => "saved", (error: unknown) => publicError(error))
  expect(await refused(service.exportBlockbenchTo(projectId, sample.entities[0]!.id, path.join(root, "model.json")))).toBe("请选一个以 .bbmodel 结尾的保存位置。")
  expect(await refused(service.exportBlockbenchTo(projectId, sample.items[0]!.id, path.join(root, "none.bbmodel")))).toBe("这样东西还没有模型，没有可以导出的。")
  // The renderer asks with the asset alone; only the main process adds a destination, after the save dialog.
  expect(StudioRequestSchema.safeParse({ method: "exportBlockbench", input: { projectId, assetId: sample.entities[0]!.id } }).success).toBe(true)
  expect(StudioRequestSchema.safeParse({ method: "exportBlockbenchTo", input: { projectId, assetId: sample.entities[0]!.id, destination } }).success).toBe(false)
  expect(WorkerRequestSchema.safeParse({ method: "exportBlockbenchTo", input: { projectId, assetId: sample.entities[0]!.id, destination } }).success).toBe(true)
  expect(StudioRequestSchema.safeParse({ method: "getModGuide", input: { projectId } }).success).toBe(true)
})

test("the acceptance card says the new facts in a player's words", async () => {
  const { service, projectId } = await bench()
  const project = (await service.openProject(projectId)).project
  const name = (reference: string) => [...project.blocks, ...project.items].find((value) => value.identifier === reference.split(":").at(-1))?.name ?? reference
  const card = (kind: string, id: string) => describeAsset(project, { id, asset_id: id, kind, preview: { source: "asset" } }, name)
  const rows = (kind: string, id: string) => Object.fromEntries(card(kind, id).rows.map((row) => [row.label, row.text]))
  const ore = project.blocks.find((value) => value.identifier === "azure_ore")!
  expect(rows("block", ore.id)).toMatchObject({
    怎么挖: "至少要用铁镐才挖得下来，用更差的工具挖什么都不掉",
    挖掉以后: "挖掉会掉 1–2 个「蓝晶碎片」，带时运的工具会掉得更多；用精准采集挖，掉的是它自己",
    经验: "挖掉会给 2–5 点经验（用精准采集挖不给）",
    哪里能挖到: "在主世界 Y −16 到 48 的石头、深板岩里生成（越靠中间越多），每个区块约 8 团，每团最多 6 块",
    声音: "踩上去、挖起来是紫水晶的声音",
  })
  // A block without the new fields reads as it always did.
  const plain = project.blocks.find((value) => value.identifier === "azure_block")!
  expect(rows("block", plain.id)).toMatchObject({ 怎么挖: "用镐挖最快", 挖掉以后: "掉它自己" })
  expect(Object.keys(rows("block", plain.id))).not.toContain("哪里能挖到")
  // The creature made by hand has no workspace asset: its record is read from the project.
  const golem = project.entities[0]!
  const creature = describeAsset(project, { id: `entity:${golem.id}`, asset_id: null, kind: "entity", preview: { source: "content" } }, name)
  expect(creature.rows.find((row) => row.label === "声音")!.text).toBe("平时是「紫水晶叮声」的声音；受伤时是「铁傀儡受伤」的声音；死的时候是「铁傀儡死亡」的声音；走路时是「铁傀儡脚步」的声音；声音比原来低沉")
  expect(creature.rows.find((row) => row.label === "哪里出现")!.text).toBe("溶洞、平原，一次出现 1–2 只")
})

test("a broken data-only field is refused in plain words when content is saved by hand", async () => {
  const { service, projectId, sample } = await bench()
  const project = (await service.openProject(projectId)).project
  const content = ContentSchema.parse({ blocks: project.blocks, items: project.items, recipes: project.recipes, logic: project.logic })
  const save = (blocks: typeof content.blocks) => service.saveContent({ projectId, expectedRevision: sample.revision, content: { ...content, blocks } }).then(() => "saved", (error: unknown) => publicError(error))
  expect(await save(content.blocks.map((block) => (block.identifier === "azure_ore" ? { ...block, drop_item: { ...block.drop_item!, item: "gone" } } : block)))).toBe("方块「蓝晶矿石」挖掉后要掉「gone」，可是模组里没有别的方块或物品叫这个名字。先把它做出来。")
  expect(await save(content.blocks.map((block) => (block.identifier === "ember_rock" ? { ...block, tool: "none" as const } : block)))).toBe("方块「余烬石」要求至少用石质工具，那就得先选一种工具（镐、斧或锹）。")
  expect(plainContent(new Error("别的错"))).toBeNull()
  expect(await save(content.blocks.map((block) => (block.identifier === "azure_ore" ? { ...block, drop: "self" as const, drop_item: undefined } : block)))).toBe("方块「蓝晶矿石」挖掉会掉它自己，又给经验：玩家可以反复放下再挖来刷经验。让它掉别的物品，或者去掉经验。")
  // Giving up the special drop in the editor is an ordinary save: what the editor sends when 掉落 is switched to 自身.
  expect(await save(content.blocks.map((block) => (block.identifier === "azure_ore" ? { ...block, drop: "self" as const, drop_item: undefined, experience: undefined } : block)))).toBe("saved")
})

test("outside AIs are told what the data-only features do and where they stop", () => {
  const capabilities = getMcpCapabilities("medium")
  expect(capabilities.data_gameplay).toMatchObject({ summary: DATA_CAPABILITY.summary, done: DATA_CAPABILITY.done, not_done: DATA_CAPABILITY.not_done, block_sounds: BLOCK_SOUNDS, creature_sounds: CREATURE_SOUNDS })
  expect(capabilities.data_gameplay.animations_played.always).toEqual(["idle", "walk", "hurt"])
  expect(capabilities.data_gameplay.reconciliation).toMatchObject({ tool: "get_mod_guide", no_ai: true, no_game: true })
  expect(capabilities.tools.map((tool) => tool.name)).toContain("get_mod_guide")
  const handoff = everythingToRead({ configuration: JSON.stringify({ mcpServers: { "minemods-studio": { command: "node", args: ["mcp.js"] } } }) })
  expect(handoff).toContain("### 不用写代码的数据玩法")
  DATA_CAPABILITY.not_done.forEach((line) => expect(handoff).toContain(line))
  expect(handoff).toContain("get_mod_guide")
  // No subject is suggested: the one example is of the form of the fields.
  expect(`${handoff}${JSON.stringify(capabilities.data_gameplay)}`).not.toMatch(/蓝晶|晶石傀儡|余烬(?:石|炭)/)
})

test("a build record with warnings, with gameplay units, or with neither is accepted", () => {
  const record = { id: "00000000-0000-4000-8000-000000000001", revision: 3, jarPath: path.resolve("/tmp/a.jar"), projectDirectory: path.resolve("/tmp/p"), sourceDirectory: path.resolve("/tmp/p/generated"), sha256: "a".repeat(64) }
  expect(BuildResultSchema.parse(record)).toEqual(record)
  const warned = { ...record, gameplay_units: 1, warnings: [{ rule: "animation_unplayed", about: "晶石傀儡", text: "有一个动作永远不会播放。", fix: "加一条规则。" }] }
  expect(BuildResultSchema.parse(warned)).toEqual(warned)
  expect(BuildResultSchema.safeParse({ ...record, warnings: [] }).success).toBe(false)
})

test("a build leaves the guide and the Blockbench models beside its jar, and an export takes them along", async () => {
  const { root, sample } = await bench()
  const directory = path.join(root, "projects", "azure")
  const id = randomUUID()
  // Everything a real build does around the compiler, which this machine does not have: assemble, then write beside where the jar goes.
  const source = path.join(directory, "generated", `build-${id}`)
  await mkdir(source, { recursive: true })
  const assembled = await assembleBuildSource(directory, source, TEMPLATE)
  const libs = path.join(source, "build", "libs")
  expect(await writeBuildCompanions(directory, id, assembled)).toEqual({ guide: "模组说明.md", models: ["晶石傀儡.bbmodel"] })
  const guide = await readFile(path.join(libs, "模组说明.md"), "utf8")
  expect(guide).toBe(assembled.guide.markdown)
  expect(guide).toContain("打包时 Studio 核对过它能编译")
  expect(guide).toContain("## 机器对账发现的问题")
  expect(checkBbmodel(JSON.parse(await readFile(path.join(libs, "models", "晶石傀儡.bbmodel"), "utf8")))).toEqual([])
  // A jar stands in for the compiler's; the record is the one a build writes, with its warnings.
  const jar = path.join(libs, `${sample.mod_id}-0.1.0.jar`)
  await writeFile(jar, "not a real jar")
  const warnings = assembled.findings.filter((finding) => !finding.stops).map((finding) => ({ rule: finding.rule, about: finding.about?.name ?? null, text: finding.text, fix: finding.fix }))
  expect(warnings.map((warning) => warning.rule)).toEqual(["animation_unplayed"])
  const result = BuildResultSchema.parse({ id, revision: sample.revision, jarPath: jar, projectDirectory: directory, sourceDirectory: source, sha256: createHash("sha256").update("not a real jar").digest("hex"), warnings })
  await mkdir(path.join(directory, ".minemods", "builds"), { recursive: true })
  await writeFile(path.join(directory, ".minemods", "builds", `${id}.json`), `${JSON.stringify(result, null, 2)}\n`)
  // The record is compared by value: a list of warnings read back from disk is the same record.
  expect((await verifyBuiltResult(directory, JSON.parse(JSON.stringify(result)))).result).toEqual(result)
  await expect(verifyBuiltResult(directory, { ...result, warnings: [{ ...warnings[0]!, text: "别的话" }] })).rejects.toThrow("BUILD_RECORD_MISMATCH")
  const out = path.join(root, "out")
  await mkdir(out)
  await exportBuiltJar(directory, result, path.join(out, "蓝晶矿洞.jar"))
  expect((await readdir(out)).sort()).toEqual(["蓝晶矿洞-models", "蓝晶矿洞-模组说明.md", "蓝晶矿洞.jar", "蓝晶矿洞.jar.README.txt"].sort())
  expect(await readFile(path.join(out, "蓝晶矿洞-模组说明.md"), "utf8")).toBe(guide)
  expect(await readdir(path.join(out, "蓝晶矿洞-models"))).toEqual(["晶石傀儡.bbmodel"])
})
