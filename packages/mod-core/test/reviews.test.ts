import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { confirmBlueprint, linkBlueprintEntry, replaceBlueprint, type BlueprintDraft } from "../src/blueprint"
import { carryRemark, isRedoRun, redoBatch, redoRemark } from "../src/blueprint-production"
import { createProject, ProjectSchema } from "../src/project"
import { clearReview, currentReview, readRedoRequests, readReviews, recordReview, remadeSince, requestRedo, REVIEW_NOTE_LIMIT, ReviewSchema } from "../src/reviews"
import { RunTaskSchema, validateRoutePlan } from "../src/workspace-runs"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`
const [BLOCK, ITEM] = [id("4"), id("5")]
const time = (minute: number) => `2026-10-01T00:${String(minute).padStart(2, "0")}:00.000Z`
const entry = (key: string, kind: string, extra: Record<string, unknown> = {}) => ({ key, kind, title: `${key} 标题`, brief: `${key} 说明`, owner: null, needs: [], out_of_scope: null, ...extra }) as BlueprintDraft["entries"][number]
const review = (assetId: string, revision: number, verdict: string, note = "", minute = 30) => ReviewSchema.parse({ asset_id: assetId, revision, verdict, note, at: time(minute) })
const task = (assetId: string, state: string, extra: Record<string, unknown> = {}) =>
  RunTaskSchema.parse({ key: "t", module: "item", title: "任务", prompt: "做", source: "做", dependencies: [], target_id: assetId, id: crypto.randomUUID(), asset_id: assetId, state, detail: "细节", error: null, started_at: null, finished_at: null, ...extra })

test("a verdict is stored beside the project, one per asset, and the project file is not touched", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-reviews-"))
  roots.push(root)
  await createProject({ directory: root, name: "验收记录" })
  const before = await readFile(path.join(root, "minemods.project.json"), "utf8").catch(() => readFile(path.join(root, "project.json"), "utf8"))
  expect(await readReviews(root)).toEqual([])
  await recordReview(root, { asset_id: BLOCK, revision: 2, verdict: "rejected", note: "  太小了  " })
  await recordReview(root, { asset_id: ITEM, revision: 1, verdict: "accepted" })
  const latest = await recordReview(root, { asset_id: BLOCK, revision: 3, verdict: "accepted" })
  const stored = await readReviews(root)
  expect(stored.map((value) => [value.asset_id, value.revision, value.verdict, value.note])).toEqual([[ITEM, 1, "accepted", ""], [BLOCK, 3, "accepted", ""]])
  expect(JSON.parse(await readFile(path.join(root, ".minemods", "reviews.json"), "utf8"))).toEqual({ schema_version: 1, reviews: stored, requests: [] })
  expect(stored.map((value) => value.sent_back)).toEqual([undefined, 2])
  // Only the verdict for the revision that exists now counts.
  expect(currentReview(stored, { id: BLOCK, revision: 3 })).toEqual(latest)
  expect(currentReview(stored, { id: BLOCK, revision: 4 })).toBeNull()
  // That it was once sent back outlives the yes that replaced it, so what uses it can be told it was remade.
  expect(latest).toMatchObject({ verdict: "accepted", revision: 3, sent_back: 2 })
  expect([remadeSince(stored, { id: BLOCK, revision: 2 }), remadeSince(stored, { id: BLOCK, revision: 3 }), remadeSince(stored, { id: ITEM, revision: 9 })]).toEqual([false, true, false])
  expect(REVIEW_NOTE_LIMIT).toBe(500)
  // Taking a verdict back works only for the revision it was given for; an unknown asset is nothing to take back.
  await clearReview(root, { asset_id: BLOCK, revision: 2 })
  await clearReview(root, { asset_id: crypto.randomUUID(), revision: 1 })
  expect(await readReviews(root)).toEqual(stored)
  await clearReview(root, { asset_id: ITEM, revision: 1 })
  expect((await readReviews(root)).map((value) => value.asset_id)).toEqual([BLOCK])
  await recordReview(root, { asset_id: ITEM, revision: 1, verdict: "accepted" })
  // One request per entry; asking again replaces the words.
  await requestRedo(root, { key: "berry", feedback: "红一点" })
  await requestRedo(root, { key: "berry" })
  expect((await readRedoRequests(root)).map((value) => [value.key, value.feedback])).toEqual([["berry", ""]])
  expect(await readReviews(root)).toHaveLength(2)
    expect(await readFile(path.join(root, "minemods.project.json"), "utf8").catch(() => readFile(path.join(root, "project.json"), "utf8"))).toBe(before)
  // Bounded and strict; a file that is not a record reads as "nobody judged anything".
  await expect(recordReview(root, { asset_id: BLOCK, revision: 3, verdict: "rejected", note: "x".repeat(REVIEW_NOTE_LIMIT + 1) })).rejects.toThrow()
  await expect(recordReview(root, { asset_id: "nope", revision: 3, verdict: "accepted" })).rejects.toThrow()
  await writeFile(path.join(root, ".minemods", "reviews.json"), "{ not json")
  expect(await readReviews(root)).toEqual([])
})

test("a redo batch remakes rejected things in place with the person's words, and leaves out what is busy or already failed", async () => {
  const project = ProjectSchema.parse(JSON.parse(await readFile(path.join(import.meta.dir, "fixtures", "pre-0a", "project.json"), "utf8")))
  const assets = project.workspace.assets
  const planned = linkBlueprintEntry(
    confirmBlueprint(
      replaceBlueprint(project, { request: "做一个果子", style: { palette: ["#335533"], shape: "圆润", naming: "", world: "北方森林" }, entries: [entry("berry", "item")], questions: [] }),
      1,
    ),
    "berry",
    ITEM,
  )
  const input = { blueprint: planned.blueprint, assets, runs: [] }
  expect(redoBatch({ ...input, reviews: [] })).toBeNull()
  expect(redoBatch({ ...input, reviews: [review(ITEM, 1, "accepted"), review(BLOCK, 1, "rejected", "旧版本的意见")] })).toMatchObject({ plan: { tasks: [{ target_id: BLOCK }] } })
  // A verdict for an earlier revision asks for nothing.
  expect(redoBatch({ ...input, reviews: [review(ITEM, 2, "rejected", "太亮了")] })).toBeNull()

  const batch = redoBatch({ ...input, reviews: [review(BLOCK, 1, "rejected", "盖子要能打开", 31), review(ITEM, 1, "rejected", "太亮了，想要暗一点", 30)] })!
  expect(batch.plan.tasks.map((value) => [value.key, value.module, value.source, value.target_id, value.dependencies])).toEqual([
    ["berry", "item", "blueprint:berry", ITEM, []],
    [`redo_${BLOCK.replaceAll("-", "")}`, "block", "盖子要能打开", BLOCK, []],
  ])
  // The entry's brief, the person's words and the shared style all travel in the prompt.
  expect(batch.plan.tasks[0]!.prompt).toBe(
    ["berry 说明", "", "玩家看过现在这一版，说：", "太亮了，想要暗一点", "请在现有文档的基础上照这个意见重做，没有被提到的地方保持不变。", "", "整个模组共用的风格约定：", "世界观：北方森林", "造型：圆润", "配色：#335533"].join("\n"),
  )
  expect(batch.plan.tasks[1]!.prompt).toBe(["制作秘匣", "", "玩家看过现在这一版，说：", "盖子要能打开", "请在现有文档的基础上照这个意见重做，没有被提到的地方保持不变。"].join("\n"))
  // The runner's own gate accepts it: each task traces to the plan or to the person's words.
  expect(() =>
    validateRoutePlan(batch.plan, { prompt: batch.prompt, assets: assets.map((asset) => ({ id: asset.id, module: asset.module })), blueprint: [{ key: "berry", kind: "item" }] }),
  ).not.toThrow()
  // Asked a second time, the earlier words are not stacked on top of the new ones.
  const again = redoBatch({ assets: assets.map((asset) => (asset.id === BLOCK ? { ...asset, prompt: batch.plan.tasks[1]!.prompt } : asset)), runs: [], reviews: [review(BLOCK, 1, "rejected", "再大一点")] })!
  expect(again.plan.tasks[0]!.prompt).toBe(["制作秘匣", "", "玩家看过现在这一版，说：", "再大一点", "请在现有文档的基础上照这个意见重做，没有被提到的地方保持不变。"].join("\n"))
  expect(again.prompt).toBe("再大一点")

  const rejected = [review(ITEM, 1, "rejected", "太亮了")]
  const run = (state: string, minute: number, tasks: ReturnType<typeof task>[]) => ({ state, created_at: time(minute), tasks }) as { state: "running"; created_at: string; tasks: ReturnType<typeof task>[] }
  expect(redoBatch({ ...input, reviews: rejected, runs: [run("running", 31, [task(ITEM, "running")])] })).toBeNull()
  // One try after asking; a failure from before the person asked does not count against it.
  expect(redoBatch({ ...input, reviews: rejected, runs: [run("failed", 31, [task(ITEM, "failed", { finished_at: time(32) })])] })).toBeNull()
  expect(redoBatch({ ...input, reviews: rejected, runs: [run("failed", 20, [task(ITEM, "failed", { finished_at: time(21) })])] })).not.toBeNull()
  expect(redoBatch({ ...input, reviews: [...rejected, review(BLOCK, 1, "rejected")], only: [BLOCK] })!.plan.tasks).toHaveLength(1)
  // No words given: the task still says what is wanted.
  expect(redoBatch({ assets, runs: [], reviews: [review(BLOCK, 1, "rejected")] })!.plan.tasks[0]!.source).toBe("这一版不太对，请重新做一版，要和现在这一版有明显的不同。")
})

test("a redo batch gives a failed, never-made entry one more try, with what the person said and no target", async () => {
  const project = ProjectSchema.parse(JSON.parse(await readFile(path.join(import.meta.dir, "fixtures", "pre-0a", "project.json"), "utf8")))
  const assets = project.workspace.assets
  const blueprint = linkBlueprintEntry(
    confirmBlueprint(
      replaceBlueprint(project, {
        request: "做果子",
        style: { palette: [], shape: "圆润", naming: "", world: "" },
        entries: [entry("berry", "item"), entry("jam", "recipe", { needs: ["berry"] }), entry("seed", "item"), entry("bread", "recipe", { needs: ["seed"] }), entry("lore", "worldview", { out_of_scope: "只是设计稿" })],
        questions: [],
      }),
      1,
    ),
    "berry",
    ITEM,
  ).blueprint
  const request = (key: string, feedback = "", minute = 30) => ({ key, feedback, at: time(minute) })
  const run = (state: string, minute: number, tasks: ReturnType<typeof task>[]) => ({ state, created_at: time(minute), tasks }) as { state: "running"; created_at: string; tasks: ReturnType<typeof task>[] }
  const input = { blueprint, assets, reviews: [], runs: [] }
  const batch = redoBatch({ ...input, requests: [request("jam", "多放一点果子")] })!
  expect(batch.plan.tasks.map((value) => [value.key, value.module, value.source, value.target_id, value.dependencies])).toEqual([["jam", "recipe", "blueprint:jam", null, []]])
  expect(batch.plan.tasks[0]!.prompt).toBe(
    ["jam 说明", "", "这一样之前没有做成，玩家想再试一次，并且说：", "多放一点果子", "", "整个模组共用的风格约定：", "造型：圆润", "", "已经做好、可以直接引用的内容：", `物品「berry 标题」，资产 ID ${ITEM}`].join("\n"),
  )
  expect(isRedoRun({ summary: batch.plan.summary })).toBe(true)
  expect(() => validateRoutePlan(batch.plan, { prompt: batch.prompt, assets: assets.map((asset) => ({ id: asset.id, module: asset.module })), blueprint: [{ key: "jam", kind: "recipe" }] })).not.toThrow()
  expect(redoBatch({ ...input, requests: [request("jam")] })!.plan.tasks[0]!.prompt).toContain("并且说：\n请再做一次。")
  // Not for what is already saved, what will not be made, what the plan no longer has, or what still lacks something it needs.
  expect(redoBatch({ ...input, requests: [request("berry"), request("lore"), request("gone"), request("bread")] })).toBeNull()
  // Taken up by a run made after the request, it is not handed out twice; a failure from before does not count.
  const tried = (minute: number, state = "failed") => [run("failed", minute, [task(crypto.randomUUID(), state, { source: "blueprint:jam", key: "jam", module: "recipe", target_id: null })])]
  expect(redoBatch({ ...input, requests: [request("jam")], runs: tried(31) })).toBeNull()
  expect(redoBatch({ ...input, requests: [request("jam")], runs: tried(29) })).not.toBeNull()
  expect(redoBatch({ ...input, requests: [request("jam")], only: ["seed"] })).toBeNull()
  // Remakes and retries share a batch, oldest request first; a remake can be picked by its entry's key.
  const both = redoBatch({ ...input, reviews: [review(ITEM, 1, "rejected", "太亮了", 31)], requests: [request("jam", "", 30)] })!
  expect(both.plan.tasks.map((value) => [value.key, value.target_id])).toEqual([["jam", null], ["berry", ITEM]])
  expect(redoBatch({ ...input, reviews: [review(ITEM, 1, "rejected", "太亮了", 31)], requests: [request("jam")], only: ["berry"] })!.plan.tasks.map((value) => value.key)).toEqual(["berry"])
})

// 2026-11-16, 蚩尤: an outside AI changed a thing the person had sent back through a plan of its own, and their words never reached it.
test("a task the AI planned itself on a thing waiting to be redone carries the person's words, once, as a redo task does", async () => {
  const project = ProjectSchema.parse(JSON.parse(await readFile(path.join(import.meta.dir, "fixtures", "pre-0a", "project.json"), "utf8")))
  const assets = project.workspace.assets
  const blueprint = linkBlueprintEntry(
    confirmBlueprint(replaceBlueprint(project, { request: "做果子", style: { palette: [], shape: "圆润", naming: "", world: "" }, entries: [entry("berry", "item"), entry("jam", "recipe", { needs: ["berry"] })], questions: [] }), 1),
    "berry",
    ITEM,
  ).blueprint
  const input = { blueprint, assets, reviews: [review(ITEM, 1, "rejected", "太亮了")], requests: [], runs: [] }
  const own = { prompt: "按打包提醒把堆叠数改小", source: "按打包提醒把堆叠数改小", target_id: ITEM }
  const carried = carryRemark(input, own)!
  expect(carried).toBe(["按打包提醒把堆叠数改小", "", "用户在 Studio 里打回了现在这一版，原话：", "太亮了", "这次连同上面的要求一起改掉；用户没提到的地方保持不变。"].join("\n"))
  expect(redoRemark(carried)).toBe("太亮了")
  // Once: a text that carries the words already, this one or one `redoBatch` wrote, is left as it is.
  expect(carryRemark(input, { ...own, prompt: carried })).toBeNull()
  expect(carryRemark(input, { ...redoBatch(input)!.plan.tasks[0]!, target_id: ITEM })).toBeNull()
  // Nothing waiting: accepted, judged on an earlier revision, another thing, or a new thing.
  expect(carryRemark({ ...input, reviews: [review(ITEM, 1, "accepted")] }, own)).toBeNull()
  expect(carryRemark({ ...input, reviews: [review(ITEM, 2, "rejected", "太亮了")] }, own)).toBeNull()
  expect(carryRemark(input, { ...own, target_id: BLOCK })).toBeNull()
  expect(carryRemark(input, { ...own, target_id: null })).toBeNull()
  expect(carryRemark({ ...input, reviews: [review(ITEM, 1, "rejected")] }, own)).toContain("原话：\n这一版不太对，想让它重做。\n")
  // A long text is cut to make room, never the words.
  expect(carryRemark(input, { ...own, prompt: "长".repeat(16000) })).toHaveLength(16000)
  expect(carryRemark(input, { ...own, prompt: "长".repeat(16000) })).toEndWith("太亮了\n这次连同上面的要求一起改掉；用户没提到的地方保持不变。")
  // A redo of something outside the plan starts from its own earlier text, without these words.
  const block = carryRemark({ ...input, reviews: [review(BLOCK, 1, "rejected", "旧话")] }, { prompt: "制作秘匣", source: "制作秘匣", target_id: BLOCK })!
  const remade = redoBatch({ assets: assets.map((asset) => (asset.id === BLOCK ? { ...asset, prompt: block } : asset)), runs: [], reviews: [review(BLOCK, 1, "rejected", "再大一点")] })!
  expect(remade.plan.tasks[0]!.prompt).toBe(["制作秘匣", "", "玩家看过现在这一版，说：", "再大一点", "请在现有文档的基础上照这个意见重做，没有被提到的地方保持不变。"].join("\n"))

  // A never-made entry asked for again: its words go with a task on that entry until a run made since takes it up.
  const jam = { prompt: "做果酱", source: "blueprint:jam", target_id: null }
  const asked = { ...input, reviews: [], requests: [{ key: "jam", feedback: "多放一点果子", at: time(30) }] }
  expect(carryRemark(asked, jam)).toContain("这一样之前没有做成，用户在 Studio 里想让它再做一次，原话：\n多放一点果子\n")
  const tried = (minute: number) => [{ created_at: time(minute), tasks: [task(crypto.randomUUID(), "failed", { source: "blueprint:jam", key: "jam", module: "recipe", target_id: null })] }]
  expect(carryRemark({ ...asked, runs: tried(31) }, jam)).toBeNull()
  expect(carryRemark({ ...asked, runs: tried(29) }, jam)).not.toBeNull()
  expect(carryRemark({ ...asked, requests: [{ key: "berry", feedback: "再试", at: time(30) }] }, { ...jam, source: "blueprint:berry" })).toBeNull()
})
