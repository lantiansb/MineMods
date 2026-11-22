import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { unzipSync } from "fflate"
import { createProject, openProject, saveProject, storagePath } from "../src/project"
import { exportProjectArchive, importProjectArchive } from "../src/container"
import { blueprintTaskPrompt, BlueprintPlanSchema, replaceBlueprint, validateBlueprint, type BlueprintDraft } from "../src/blueprint"
import { ideaInstructions, ideaProposalJsonSchema, blueprintPlannerInstructions } from "../src/blueprint-planner"
import { changeSentences, constraintCheckInput, constraintLines, earlierWords, impliedQuotes, LOCK_REFUSALS, lockedConstraints, lockRefusal, lockRefusalDetail, mergeConstraints, NOT_QUOTED, quoted, type Constraint } from "../src/blueprint-constraints"
import { askedWords, heldWords, spokenText, bareIdeas, changeIdeas, chooseIdeas, covers, IDEA_LIMITS, IDEA_REFUSALS, IDEAS_ARCHIVE_PATH, IdeasSchema, ideaSummary, planStored, proposeIdeas, readIdeas, requireOnly, shownIdeas, type IdeaProposal } from "../src/blueprint-ideas"
import { ASSET_KINDS, kindCapability } from "../src/workspace-modules"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-ideas-"))
  directories.push(root)
  const directory = path.join(root, "project")
  return { root, directory, project: await createProject({ directory, name: "蓝晶" }) }
}

const target = "fabric-1.21.1"
// The competitor's case: the person says the sword is only an ordinary item for now.
const sentence = "做一种蓝晶矿，挖出来能做蓝晶剑，剑现在只能是普通物品，矿脉旁边有守卫，不要爆炸。"
const unbuildable = ASSET_KINDS.find((kind) => kindCapability(kind.id, target) !== "runtime")!.id
const option = (id: string, extra: Partial<IdeaProposal["groups"][number]["options"][number]> = {}) => ({
  id,
  title: `做法 ${id}`,
  lines: [
    { text: "挖出来能做蓝晶剑", from: "you" as const, about: { thing: "sword", question: "source" as const } },
    { text: "矿在 Y -16 到 48，一脉 2 到 6 块", from: "ai" as const },
  ],
  recommended: false,
  kinds: ["item" as const],
  limit: null,
  ...extra,
})
const proposal = (extra: Partial<IdeaProposal> = {}): IdeaProposal => ({
  constraints: ["剑现在只能是普通物品"],
  groups: [
    { id: "ore", title: "蓝晶矿", about: "在哪里挖到，一次挖多少", options: [option("deep"), option("shallow", { recommended: true })] },
    { id: "guard", title: "守卫", about: "它怎么守矿", options: [option("chase", { recommended: true, kinds: ["entity", "model"] }), option("realm", { kinds: [unbuildable] }), option("still")] },
  ],
  questions: [{ id: "weapon", constraint: 0, ask: "你说过剑只是普通物品，要不要改成真的武器？", change: "剑做成真的武器：攻击力 6，耐久 500。" }],
  // The playable standard: the sword's source is answered on every card; its use is closed by the person's own words.
  things: [{ id: "sword", title: "蓝晶剑", kind: "item" }],
  declined: [{ thing: "sword", question: "use", constraint: 0, reason: "普通物品没有别的用处" }],
  ...extra,
})
const cards = () => proposeIdeas(null, { request: sentence, by: "studio", proposal: proposal(), target })

test("要求只认原话：句子里带限定的分句按规则锁上，数量词不算，改写过的摘抄被拒绝", () => {
  expect(impliedQuotes(sentence)).toEqual(["剑现在只能是普通物品", "不要爆炸"])
  expect(impliedQuotes("做一只能骑的狐狸，有两只会飞的鸟")).toEqual([])
  expect(impliedQuotes("The sword must stay a plain item, and never explode")).toEqual(["The sword must stay a plain item", "and never explode"])
  expect(quoted(sentence, "「剑现在只能是普通物品」。")).toBe(true)
  expect(quoted(sentence, "剑只能是普通物品")).toBe(false)
  expect(() => mergeConstraints(sentence, ["剑是普通物品"])).toThrow(NOT_QUOTED("剑是普通物品"))
  // A model that quotes nothing loses nothing: the limiting clauses are locked by rule.
  expect(mergeConstraints(sentence, [])).toEqual([
    { id: "c1", text: "剑现在只能是普通物品", origin: "said" },
    { id: "c2", text: "不要爆炸", origin: "said" },
  ])
  // A longer quote that contains a clause is not listed twice, and a number the rule cannot see is kept as quoted.
  expect(mergeConstraints("蓝晶剑伤害 4，剑现在只能是普通物品", ["蓝晶剑伤害 4"]).map((value) => value.text)).toEqual(["蓝晶剑伤害 4", "剑现在只能是普通物品"])
})

test("要求的编号不重用：换了句子，原话没了的那条消失，用户自己加的留着", () => {
  const first = mergeConstraints(sentence, ["剑现在只能是普通物品"])
  const added: Constraint[] = [...first, { id: "c3", text: "守卫叫蓝晶卫", origin: "added" }]
  const next = mergeConstraints("做一种蓝晶矿，不要爆炸，守卫必须是石头做的", [], added)
  expect(next).toEqual([
    { id: "c2", text: "不要爆炸", origin: "said" },
    { id: "c3", text: "守卫叫蓝晶卫", origin: "added" },
    { id: "c4", text: "守卫必须是石头做的", origin: "said" },
  ])
  expect(lockedConstraints(next, [{ constraint: "c2", change: "", at: new Date().toISOString() }]).map((value) => value.id)).toEqual(["c3", "c4"])
})

test("蓝图过锁：每条要求要有交代、要被核对、不能被违反；用户放开的那条不再拦", () => {
  const constraints = mergeConstraints(sentence, [])
  const sword = { key: "sword", title: "蓝晶剑", honours: [{ constraint: "c1", how: "只是一个普通物品，没有攻击力和耐久。" }] }
  const kept = { verdicts: [{ constraint: "c1", kept: true, entry: null, why: "剑是普通物品。" }, { constraint: "c2", kept: true, entry: null, why: "没有爆炸。" }] }
  const whole = [{ constraint: "c2", how: "没有任何会爆炸的东西。" }]
  expect(lockRefusal({ entries: [{ key: "sword", title: "蓝晶剑" }], check: null })).toBeNull()
  expect(lockRefusal({ constraints, entries: [{ ...sword, honours: [{ constraint: "c9", how: "x" }] }], check: kept })).toBe(LOCK_REFUSALS.unknown("c9"))
  expect(lockRefusal({ constraints, entries: [sword], check: kept })).toBe(LOCK_REFUSALS.unanswered("不要爆炸"))
  expect(lockRefusal({ constraints, entries: [sword], honours: whole, check: null })).toBe(LOCK_REFUSALS.unchecked)
  expect(lockRefusal({ constraints, entries: [sword], honours: whole, check: { verdicts: kept.verdicts.slice(0, 1) } })).toBe(LOCK_REFUSALS.skipped("不要爆炸"))
  expect(lockRefusal({ constraints, entries: [sword], honours: whole, check: kept })).toBeNull()
  const broken = { verdicts: [{ constraint: "c1", kept: false, entry: "sword", why: "剑被写成了攻击力 6 的武器" }, kept.verdicts[1]!] }
  expect(lockRefusal({ constraints, entries: [sword], honours: whole, check: broken })).toBe(
    "这份蓝图和你说过的要求对不上，所以没有保存。你说过「剑现在只能是普通物品」，但是「蓝晶剑」：剑被写成了攻击力 6 的武器。想照原来的要求做，就让 AI 重新规划；想改掉这一条，只能由你自己在「你说的要求」里改它的字、或者不要它，AI 不能替你改。",
  )
  // Given up by the person: neither an answer nor a verdict is asked for it any more.
  const lifted = [{ constraint: "c1", change: "剑做成真的武器", at: new Date().toISOString() }]
  expect(lockRefusal({ constraints, lifted, entries: [{ key: "sword", title: "蓝晶剑" }], honours: whole, check: { verdicts: broken.verdicts } })).toBeNull()
  // The reader is shown the requirements in force and the entries, and nothing else.
  const shown = constraintCheckInput({ constraints, lifted, entries: [{ key: "sword", kind: "item", title: "蓝晶剑", brief: "一把剑", out_of_scope: null }], honours: whole })
  expect(Object.keys(shown).sort()).toEqual(["constraints", "entries", "plan_honours"])
  expect(shown.constraints).toEqual([{ id: "c2", text: "不要爆炸" }])
  expect(constraintLines({ constraints, lifted }, [{ constraint: "c2", how: "不放 TNT" }])).toEqual(["- 「不要爆炸」（这一样的做法：不放 TNT）", "- 用户原来说过「剑现在只能是普通物品」，后来亲自同意改掉，改成：剑做成真的武器"])
})

test("蓝图带着要求：规划者交不了要求本身，每个任务的话里逐字带着，旧蓝图照样能读", async () => {
  const f = await fixture()
  const style = { palette: [], shape: "", naming: "", world: "" }
  const entries = [{ key: "sword", kind: "item" as const, title: "蓝晶剑", brief: "一把蓝色的剑。", owner: null, needs: [], out_of_scope: null, honours: [{ constraint: "c1", how: "只是普通物品" }] }]
  const constraints = mergeConstraints(sentence, [])
  expect(BlueprintPlanSchema.safeParse({ style, entries, questions: [], constraints }).success).toBe(false)
  const draft: BlueprintDraft = { request: sentence, style, entries, questions: [], honours: [{ constraint: "c2", how: "没有爆炸" }], constraints, lifted: [] }
  const blueprint = replaceBlueprint(f.project, draft).blueprint!
  expect(blueprint.constraints).toEqual(constraints)
  const prompt = blueprintTaskPrompt(blueprint, blueprint.entries[0]!, new Set())
  expect(prompt).toContain("用户亲口提的要求，一条都不能违反：\n- 「剑现在只能是普通物品」（这一样的做法：只是普通物品）\n- 「不要爆炸」")
  // An entry that names a requirement nobody stated cannot be stored.
  expect(() => replaceBlueprint(f.project, { ...draft, constraints: constraints.slice(0, 1) })).toThrow("蓝图里提到了一条不存在的要求（c2）。")
  // A plan from before requirements were kept has none of the new fields and reads, and prompts, as before.
  const old = validateBlueprint({ revision: 1, state: "draft", request: "做一把剑", style, questions: [], entries: [{ ...entries[0]!, honours: undefined, asset_id: null }] }, target)
  expect(old.constraints).toBeUndefined()
  expect(blueprintTaskPrompt(old, old.entries[0]!, new Set())).toBe("一把蓝色的剑。")
  expect(blueprintPlannerInstructions(target)).toContain("constraints 是用户亲口提的要求")
})

test("想法卡片：分组由 AI 定，应用只管它不能定的——要求必须是原话、做不了的要标明且不能推荐、每组恰好一个推荐、什么都没替人选", () => {
  const record = cards()
  expect(record).toMatchObject({ schema_version: 1, revision: 1, request: sentence, by: "studio", state: "choosing", picks: [], answers: [], lifted: [], summary: null })
  // The quote the AI gave, and the clause it overlooked.
  expect(record.constraints.map((value) => [value.id, value.text])).toEqual([["c1", "剑现在只能是普通物品"], ["c2", "不要爆炸"]])
  expect(record.questions).toEqual([{ id: "weapon", constraint: "c1", ask: "你说过剑只是普通物品，要不要改成真的武器？", change: "剑做成真的武器：攻击力 6，耐久 500。" }])
  const guard = record.groups[1]!.options
  expect(guard.map((value) => value.recommended)).toEqual([true, false, false])
  expect(guard[1]!.limit).toEqual({ cannot: `${ASSET_KINDS.find((kind) => kind.id === unbuildable)!.label}现在做不进游戏`, instead: "只会存成设计稿，不会出现在游戏里" })
  // The AI recommended the one that cannot be built, or none at all: the app moves the mark to one that can.
  const moved = proposeIdeas(null, {
    request: sentence,
    by: "outside",
    target,
    proposal: proposal({ groups: [{ id: "guard", title: "守卫", about: "", options: [option("realm", { kinds: [unbuildable], recommended: true }), option("chase"), option("still", { recommended: true })] }] }),
  })
  expect(moved.groups[0]!.options.map((value) => [value.id, value.recommended, value.limit !== null])).toEqual([["realm", false, true], ["chase", false, false], ["still", true, false]])
  // What the AI itself said cannot be built is kept in its words.
  const said = proposeIdeas(null, { request: sentence, by: "studio", target, proposal: proposal({ groups: [{ id: "g", title: "守卫", about: "", options: [option("a", { limit: { cannot: "守卫不会自己巡逻", instead: "站在矿脉旁边不动" } }), option("b")] }] }) })
  expect(said.groups[0]!.options[0]!.limit).toEqual({ cannot: "守卫不会自己巡逻", instead: "站在矿脉旁边不动" })
  expect(() => proposeIdeas(null, { request: sentence, by: "studio", target, proposal: proposal({ constraints: ["剑是真的武器"] }) })).toThrow(NOT_QUOTED("剑是真的武器"))
  expect(() => proposeIdeas(null, { request: sentence, by: "studio", target, proposal: proposal({ constraints: [] }) })).toThrow("有一个问题问的不是你提过的要求。")
  expect(() => proposeIdeas(null, { request: sentence, by: "studio", target, proposal: proposal({ groups: [proposal().groups[0]!, proposal().groups[0]!] }) })).toThrow("想法里有两组用了同一个标识。")
  // The brief names no subject and no fixed group, and reads what can be built from the registry.
  const brief = ideaInstructions(target)
  ASSET_KINDS.forEach((kind) => expect(brief).toContain(`- ${kind.id}（${kind.label}`))
  expect(brief).toContain("不要套固定的分组")
  expect(brief).toContain(`最多 ${IDEA_LIMITS.groups} 组`)
  expect(Object.keys((ideaProposalJsonSchema() as { properties: object }).properties).sort()).toEqual(["constraints", "declined", "groups", "questions", "things"])
})

test("只有人能选：一组选一个、都不要、自己写；总结按规则写出来，可以手改；没选完、问题没答不能说「就按这个做」", () => {
  const record = cards()
  expect(() => chooseIdeas(null, { revision: 1 })).toThrow("还没有想法可以选。")
  expect(() => chooseIdeas(record, { revision: 2 })).toThrow("想法刚刚更新过，请看一眼最新的再选。")
  expect(() => chooseIdeas(record, { revision: 1, picks: [{ group: "ore", option: "gone", own: "" }] })).toThrow("选的那一项已经不在了，请重新选一次。")
  const one = chooseIdeas(record, { revision: 1, picks: [{ group: "ore", option: "shallow", own: "" }] })
  // The summary ends with every thing's answers to the four questions as the choices stand, so the planner inherits them.
  const PLAY = "\n\n每样东西怎么玩：\n- 蓝晶剑｜从哪来：挖出来能做蓝晶剑（你说的）｜干什么用：按你的要求不做（你说过「剑现在只能是普通物品」：普通物品没有别的用处）"
  expect(one.summary).toBe(`${sentence}\n\n我选的做法：\n- 蓝晶矿：做法 shallow。挖出来能做蓝晶剑；矿在 Y -16 到 48，一脉 2 到 6 块${PLAY}`)
  expect(() => chooseIdeas(one, { revision: 1, ready: true })).toThrow("还有几组没有选。每一组选一个，或者点「都不要」。")
  const both = chooseIdeas(one, { revision: 1, picks: [...one.picks, { group: "guard", option: null, own: "守卫是一只石头蜘蛛，被打三下就跑" }] })
  expect(both.summary).toEndWith(`- 守卫：守卫是一只石头蜘蛛，被打三下就跑${PLAY}`)
  expect(ideaSummary({ ...both, picks: [{ group: "guard", option: null, own: "" }, { group: "ore", option: "deep", own: "" }] })).toContain("- 守卫：这次不要")
  // An option with a limit says so in the summary, so the planner is told what replaces it.
  expect(ideaSummary({ ...both, picks: [{ group: "guard", option: "realm", own: "" }] })).toContain("现在做不进游戏，用这个代替：只会存成设计稿，不会出现在游戏里")
  expect(() => chooseIdeas(both, { revision: 1, ready: true })).toThrow("AI 有一个要你亲自决定的问题还没有回答。")
  // No keeps the requirement locked; the person's own edit of the summary survives later answers.
  const edited = chooseIdeas(both, { revision: 1, summary: "我自己改过的总结" })
  const no = chooseIdeas(edited, { revision: 1, answers: { weapon: false } })
  expect(no.lifted).toEqual([])
  expect(no.summary).toBe("我自己改过的总结")
  expect(lockedConstraints(no.constraints, no.lifted).map((value) => value.id)).toEqual(["c1", "c2"])
  const ready = chooseIdeas(no, { revision: 1, ready: true })
  expect(ready.state).toBe("ready")
  // Yes gives exactly that requirement up, with what was agreed instead; taking it back locks it again.
  const yes = chooseIdeas(no, { revision: 1, answers: { weapon: true } })
  expect(yes.lifted).toMatchObject([{ constraint: "c1", change: "剑做成真的武器：攻击力 6，耐久 500。" }])
  expect(shownIdeas(yes).locked.map((value) => value.id)).toEqual(["c2"])
  expect(chooseIdeas(yes, { revision: 1, restore: ["c1"] }).lifted).toEqual([])
  expect(chooseIdeas(yes, { revision: 1, answers: { weapon: false } }).lifted).toEqual([])
  // Giving one up of their own accord, and typing one in.
  const own = chooseIdeas(no, { revision: 1, lift: ["c2"], add: "守卫叫蓝晶卫" })
  expect(own.lifted).toMatchObject([{ constraint: "c2", change: "" }])
  expect(own.constraints.at(-1)).toEqual({ id: "c3", text: "守卫叫蓝晶卫", origin: "added" })
})

test("想法也过「能玩」这一关：每样东西要列出来，推荐的做法里每个适用的问题都要有一行；按用户要求不做的地方不许再写做法", () => {
  expect(() => proposeIdeas(null, { request: sentence, by: "outside", proposal: proposal({ things: undefined }), target })).toThrow(IDEA_REFUSALS.things)
  // A second thing nobody answered for: each open question is named, with what it asks.
  const open = proposal({ things: [{ id: "sword", title: "蓝晶剑", kind: "item" }, { id: "guard", title: "守卫", kind: "entity" }] })
  expect(() => proposeIdeas(null, { request: sentence, by: "outside", proposal: open, target })).toThrow(
    IDEA_REFUSALS.open(["「守卫」的「从哪来」（在一个普通的新生存世界里，玩家怎么得到它或者遇到它）", "「守卫」的「干什么用」（得到它或者打败它以后，它通向哪里）", "「守卫」的「有什么反应」（玩家或者世界碰它的时候，看得到什么）", "「守卫」的「闲着时什么样」（没有人理它的时候，它自己在做什么）"]),
  )
  // An answer that only stands on a card that is not the recommended one does not count: the person may never pick it.
  const hidden = proposal({ groups: proposal().groups.map((group) => ({ ...group, options: group.options.map((value) => ({ ...value, lines: value.lines.map((line) => (value.recommended ? { text: line.text, from: line.from } : line)) })) })) })
  expect(() => proposeIdeas(null, { request: sentence, by: "outside", proposal: hidden, target })).toThrow("「蓝晶剑」的「从哪来」")
  // The sword's use is closed by the person's words: a card that gives it one anyway is refused, recommended or not.
  const smuggled = proposal({ groups: [...proposal().groups, { id: "use", title: "剑的用处", about: "", options: [option("key", { lines: [{ text: "可以当钥匙开宝箱", from: "ai", about: { thing: "sword", question: "use" } }] }), option("none", { recommended: true })] }] })
  expect(() => proposeIdeas(null, { request: sentence, by: "outside", proposal: smuggled, target })).toThrow(IDEA_REFUSALS.smuggled("蓝晶剑", "干什么用", "剑现在只能是普通物品"))
  expect(() => proposeIdeas(null, { request: sentence, by: "outside", proposal: proposal({ declined: [{ thing: "shield", question: "use", constraint: 0, reason: "没有" }] }), target })).toThrow(IDEA_REFUSALS.stray("shield"))
  // Stored with the requirement's own id, so lifting it reopens the question.
  expect(cards().declined).toEqual([{ thing: "sword", question: "use", constraint: "c1", reason: "普通物品没有别的用处" }])
})

test("直接做也锁要求：不出卡片，只记下这句话里的要求；同一句话再来一次，之前放开的还算数", () => {
  const first = requireOnly(null, { request: sentence, by: "studio", quotes: ["剑现在只能是普通物品"] })
  expect(first).toMatchObject({ state: "ready", groups: [], summary: sentence })
  expect(first.constraints.map((value) => value.text)).toEqual(["剑现在只能是普通物品", "不要爆炸"])
  const lifted = chooseIdeas(first, { revision: 1, lift: ["c2"] })
  expect(covers(lifted, sentence)).toBe(true)
  expect(covers(lifted, `${sentence}\n补充：再加一种蓝晶镐`)).toBe(true)
  expect(covers(lifted, "做一只会飞的宠物")).toBe(false)
  const again = requireOnly(lifted, { request: `${sentence}\n补充：再加一种蓝晶镐`, by: "studio", quotes: [] })
  expect(again.lifted.map((value) => value.constraint)).toEqual(["c2"])
  expect(again.revision).toBe(2)
  // A new sentence starts over: nothing of the old one is held against it.
  const other = requireOnly(lifted, { request: "做一只会飞的宠物，不要太大", by: "outside", quotes: [] })
  expect(other.constraints).toEqual([{ id: "c1", text: "不要太大", origin: "said" }])
  expect(other.lifted).toEqual([])
})

test("想法存在工程里：重开还在，随工程包走；没有想法的旧工程一个文件都不多，坏掉的记录当作没有", async () => {
  const f = await fixture()
  expect(await readIdeas(f.directory)).toBeNull()
  const plain = path.join(f.root, "plain.minemods")
  await exportProjectArchive({ directory: f.directory, destination: plain })
  expect(Object.keys(unzipSync(await Bun.file(plain).bytes())).filter((name) => /ideas|activity/.test(name))).toEqual([])

  const stored = await changeIdeas(f.directory, (current) => proposeIdeas(current, { request: sentence, by: "studio", proposal: proposal(), target }))
  await changeIdeas(f.directory, (current) => chooseIdeas(current, { revision: stored.revision, picks: [{ group: "ore", option: "deep", own: "" }] }))
  const read = (await readIdeas(f.directory))!
  expect(read.picks).toEqual([{ group: "ore", option: "deep", own: "" }])
  // A change that is refused writes nothing.
  await expect(changeIdeas(f.directory, (current) => chooseIdeas(current, { revision: 9 }))).rejects.toThrow("想法刚刚更新过")
  expect(await readIdeas(f.directory)).toEqual(read)
  // The project file itself is untouched by any of it.
  expect((await openProject(f.directory)).revision).toBe(f.project.revision)

  const archive = path.join(f.root, "ideas.minemods")
  await exportProjectArchive({ directory: f.directory, destination: archive })
  expect(Object.keys(unzipSync(await Bun.file(archive).bytes()))).toContain(IDEAS_ARCHIVE_PATH)
  const destination = path.join(f.root, "imported")
  await importProjectArchive({ archive, destination })
  expect(await readIdeas(destination)).toEqual(read)

  await writeFile(await storagePath(f.directory, IDEAS_ARCHIVE_PATH.split("/")), "{ not json")
  expect(await readIdeas(f.directory)).toBeNull()
  await saveProject(f.directory, await openProject(f.directory), f.project.revision)
})

// broad18: a plan was refused over a requirement and the person had nowhere to change it, so they started over and said their wish again.
test("人可以自己改主意：改字是新的一条（旧的作废、留着记录），不要、要回、新加都记下来；锁只拦 AI，不拦人", () => {
  const stored = planStored(requireOnly(null, { request: sentence, by: "outside", quotes: ["剑现在只能是普通物品"] }))
  expect(stored.constraints.map((value) => [value.id, value.text])).toEqual([["c1", "剑现在只能是普通物品"], ["c2", "不要爆炸"]])
  const NEW = "爆炸只能很小，不能炸坏方块"
  const reworded = chooseIdeas(stored, { revision: stored.revision, reword: [{ id: "c2", text: NEW }] })
  // The new words are a new line with a new id; the old one is given up with the new words as what the person agreed to instead.
  expect(reworded.constraints.at(-1)).toEqual({ id: "c3", text: NEW, origin: "added", replaces: "c2" })
  expect(reworded.constraints.find((value) => value.id === "c2")!.text).toBe("不要爆炸")
  expect(reworded.lifted).toMatchObject([{ constraint: "c2", change: NEW }])
  expect(lockedConstraints(reworded.constraints, reworded.lifted).map((value) => value.id)).toEqual(["c1", "c3"])
  expect(reworded.changes).toMatchObject([{ kind: "reword", constraint: "c3", from: "c2", was: "不要爆炸", now: NEW, answered: false }])
  // The cards stay put: a plan already drawn from them is still the plan.
  expect(reworded.state).toBe("used")
  expect(earlierWords(reworded.constraints, "c3")).toEqual(["不要爆炸"])
  // Rewording again keeps the whole history, newest first.
  const again = chooseIdeas(reworded, { revision: reworded.revision, reword: [{ id: "c3", text: "不要爆炸，一点都不要" }] })
  expect(earlierWords(again.constraints, "c4")).toEqual([NEW, "不要爆炸"])
  expect(again.changes.map((value) => [value.kind, value.constraint])).toEqual([["reword", "c3"], ["reword", "c4"]])
  // What the person cannot do by accident: nothing to change, a line that is already given up, a line that is not there, an empty line.
  expect(() => chooseIdeas(stored, { revision: stored.revision, reword: [{ id: "c2", text: "「不要爆炸」" }] })).toThrow("和原来的话一样，没有改。")
  expect(() => chooseIdeas(reworded, { revision: reworded.revision, reword: [{ id: "c2", text: "别的说法" }] })).toThrow("这一条已经不要了。")
  expect(() => chooseIdeas(stored, { revision: stored.revision, reword: [{ id: "c9", text: "别的说法" }] })).toThrow("这一条要求已经不在了")
  expect(() => chooseIdeas(stored, { revision: stored.revision, reword: [{ id: "c2", text: "   " }] })).toThrow("新的要求不能是空的。")

  // Dropping, taking back and adding are the person's own words too, each logged with the words it was about.
  const dropped = chooseIdeas(reworded, { revision: reworded.revision, lift: ["c1"] })
  expect(dropped.lifted.map((value) => value.constraint)).toEqual(["c2", "c1"])
  expect(dropped.state).toBe("used")
  const back = chooseIdeas(dropped, { revision: dropped.revision, restore: ["c1"], add: "守卫叫蓝晶卫" })
  expect(back.changes.slice(1).map((value) => [value.kind, value.constraint, value.was, value.now])).toEqual([["drop", "c1", "剑现在只能是普通物品", null], ["add", "c4", null, "守卫叫蓝晶卫"], ["restore", "c1", null, "剑现在只能是普通物品"]])
  // Giving up what is already given up writes nothing twice.
  expect(chooseIdeas(dropped, { revision: dropped.revision, lift: ["c1"] }).changes).toHaveLength(dropped.changes.length)

  // The lock is unchanged against an AI. It cannot reword: a quote must be in the person's sentence, and a requirement the person wrote stays theirs.
  expect(() => mergeConstraints(sentence, [NEW], reworded.constraints)).toThrow(NOT_QUOTED(NEW))
  expect(() => mergeConstraints(sentence, ["剑只是普通物品"], reworded.constraints)).toThrow(NOT_QUOTED("剑只是普通物品"))
  const asked = requireOnly(reworded, { request: sentence, by: "outside", quotes: [] })
  expect(asked.constraints).toEqual(reworded.constraints)
  expect(asked.lifted).toEqual(reworded.lifted)
  expect(asked.changes).toEqual(reworded.changes)
  // A plan that still answers the old line is not a plan for the new one: it is refused for the line it left unanswered, and says which.
  const entry = { key: "sword", title: "蓝晶剑", honours: [{ constraint: "c1", how: "普通物品" }, { constraint: "c2", how: "没有爆炸" }] }
  const oldCheck = { verdicts: [{ constraint: "c1", kept: true, entry: null, why: "是" }, { constraint: "c2", kept: true, entry: null, why: "是" }] }
  expect(lockRefusalDetail({ constraints: reworded.constraints, lifted: reworded.lifted, entries: [entry], check: oldCheck })).toEqual({ why: LOCK_REFUSALS.unanswered(NEW), constraint: "c3" })
  const answered = { ...entry, honours: [...entry.honours, { constraint: "c3", how: "爆炸只有很小一圈" }] }
  expect(lockRefusal({ constraints: reworded.constraints, lifted: reworded.lifted, entries: [answered], check: oldCheck })).toBe(LOCK_REFUSALS.skipped(NEW))
  const broken = { verdicts: [...oldCheck.verdicts, { constraint: "c3", kept: false, entry: "sword", why: "它炸坏了方块" }] }
  expect(lockRefusalDetail({ constraints: reworded.constraints, lifted: reworded.lifted, entries: [answered], check: broken })).toMatchObject({ constraint: "c3" })
  expect(lockRefusal({ constraints: reworded.constraints, lifted: reworded.lifted, entries: [answered], check: { verdicts: [...oldCheck.verdicts, { constraint: "c3", kept: true, entry: null, why: "是" }] } })).toBeNull()
  // The comparison and the tasks are given the new words, and the old ones only as what the person gave up.
  const shown = constraintCheckInput({ constraints: reworded.constraints, lifted: reworded.lifted, entries: [{ ...answered, kind: "item", brief: "剑", out_of_scope: null }] })
  expect(shown.constraints).toEqual([{ id: "c1", text: "剑现在只能是普通物品" }, { id: "c3", text: NEW }])
  expect(JSON.stringify(shown)).not.toContain("不要爆炸")
  expect(constraintLines({ constraints: reworded.constraints, lifted: reworded.lifted })).toEqual(["- 「剑现在只能是普通物品」", `- 「${NEW}」`, `- 用户原来说过「不要爆炸」，后来亲自同意改掉，改成：${NEW}`])

  // An AI is told what changed until a plan is stored that was held to it.
  expect(changeSentences(reworded.changes)).toEqual([`用户把 c2「不要爆炸」改成了 c3「${NEW}」。c2 作废，不用再遵守；新的 c3 要在 honours 和 constraint_check 里交代。`])
  expect(shownIdeas(reworded).changed).toHaveLength(1)
  expect(changeSentences(back.changes).map((line) => line.split("「")[0])).toEqual(["用户把 c2", "用户不要 c1", "用户新加了一条 c4", "用户又要回 c1"])
  const unseen = { ...back, changes: [...back.changes] }
  const held = planStored(back)
  expect(held.changes.every((value) => value.answered)).toBe(true)
  expect(changeSentences(held.changes)).toEqual([])
  // A change made while the plan was being drawn was not in what the plan was held to: it stays to be told.
  const later = chooseIdeas(held, { revision: held.revision, lift: ["c4"] })
  expect(changeSentences(planStored(later, held).changes)).toHaveLength(1)
  expect(changeSentences(planStored(later).changes)).toEqual([])
  expect(unseen.changes.some((value) => value.answered)).toBe(false)
})

test("没有想法记录的蓝图：给一份空的，不凭空锁上什么；老记录没有 changes 也读得出来", () => {
  const bare = bareIdeas({ request: sentence, by: "studio" })
  expect(bare).toMatchObject({ revision: 1, constraints: [], lifted: [], changes: [], state: "used", groups: [] })
  const added = chooseIdeas(bare, { revision: 1, add: "不要太大" })
  expect(added.constraints).toEqual([{ id: "c1", text: "不要太大", origin: "added" }])
  expect(added.state).toBe("used")
  const { changes: _changes, ...old } = added
  expect(IdeasSchema.parse(old).changes).toEqual([])
  // The list holds so many lines; one that cannot be added says so in plain words, and nothing is written.
  const full = { ...added, constraints: Array.from({ length: 24 }, (_, index) => ({ id: `c${index + 1}`, text: `第 ${index + 1} 条`, origin: "added" as const })) }
  expect(() => chooseIdeas(full, { revision: 1, add: "再来一条" })).toThrow("要求最多 24 条")
  expect(() => chooseIdeas(full, { revision: 1, reword: [{ id: "c1", text: "换个说法" }] })).toThrow("要求最多 24 条")
})

// broad19: an outside AI changed both the sentence and the quoted requirements and the person's 「只能是白色」 became 「只能是红色」.
test("人的原话由 Studio 存着：有东西立在上面时，AI 换个说法的 request 被退回，只换标点空格的用 Studio 那份", () => {
  const record = requireOnly(null, { request: "做一朵花，颜色只能是白色", by: "outside", quotes: [] })
  expect(record.constraints.map((value) => value.text)).toEqual(["颜色只能是白色"])
  // Nothing stands on the words yet (the record alone, used up): the next sentence is a fresh start, as when the person starts over.
  expect(heldWords({ ...record, state: "used" })).toBeNull()
  expect(askedWords(null, "随便什么")).toEqual({ request: "随便什么" })
  // A plan stands, or the cards are being chosen or approved: the words are held, whatever the AI says they are.
  const held = heldWords(record, { request: "做一朵花，颜色只能是白色" })!
  expect(held).toEqual(["做一朵花，颜色只能是白色"])
  expect(heldWords({ ...record, state: "choosing" })).toEqual(["做一朵花，颜色只能是白色"])
  expect(askedWords(held, " 做一朵花，颜色只能是白色。 ")).toEqual({ request: "做一朵花，颜色只能是白色" })
  const refused = askedWords(held, "做一朵花，颜色只能是红色")
  expect(refused).toMatchObject({ person: expect.stringContaining("你原来说的是「做一朵花，颜色只能是白色」，它交上来的是「做一朵花，颜色只能是红色」") })
  expect("ai" in refused && refused.ai).toContain("get_ideas")
  // The approved summary and the plan's request are also the person's words.
  const approved = { ...record, summary: "做一朵花，颜色只能是白色\n单瓣的", state: "used" as const }
  expect(heldWords(approved, { request: "做一朵花，颜色只能是白色\n单瓣的" })).toEqual(["做一朵花，颜色只能是白色", "做一朵花，颜色只能是白色\n单瓣的"])
  expect(spokenText(approved, "x")).toBe("x\n做一朵花，颜色只能是白色\n做一朵花，颜色只能是白色\n单瓣的")
})

test("AI 复述原话再交蓝图：摘要是人的，不会被换成原话；摘要里摘出的要求在 AI 用原话重来时也留着；片段不会让不要了的要求换个编号回来", () => {
  const base = requireOnly(null, { request: "做一朵花，颜色只能是白色", by: "outside", quotes: [] })
  const approved = { ...base, summary: "做一朵花，颜色只能是白色\n花心不能太大", state: "used" as const }
  const next = requireOnly(approved, { request: "做一朵花，颜色只能是白色", by: "outside", quotes: [] })
  expect(next.summary).toBe("做一朵花，颜色只能是白色\n花心不能太大")
  expect(next.request).toBe("做一朵花，颜色只能是白色")
  // A requirement the person's summary holds (quoted from it) stays when the same record is read through the original sentence.
  const quotedFromSummary = requireOnly(approved, { request: "做一朵花，颜色只能是白色\n花心不能太大", by: "outside", quotes: ["花心不能太大"] })
  expect(quotedFromSummary.constraints.map((value) => value.text)).toEqual(["颜色只能是白色", "花心不能太大"])
  expect(requireOnly(quotedFromSummary, { request: "做一朵花，颜色只能是白色", by: "outside", quotes: [] }).constraints).toEqual(quotedFromSummary.constraints)
  // The person gave one up; a piece of its words quoted again is that line, not a new one under a new id.
  const dropped = chooseIdeas({ ...quotedFromSummary, state: "used" }, { revision: quotedFromSummary.revision, lift: ["c1"] })
  expect(dropped.lifted.map((value) => value.constraint)).toEqual(["c1"])
  const again = requireOnly(dropped, { request: "做一朵花，颜色只能是白色", by: "outside", quotes: ["只能是白色"] })
  expect(again.constraints).toEqual(dropped.constraints)
  expect(again.lifted).toEqual(dropped.lifted)
  expect(again.changes).toEqual(dropped.changes)
})

test("人改了摘要以后，蓝图当初用的旧摘要不再算他的话：AI 拿旧摘要来交会被退回", () => {
  const base = requireOnly(null, { request: "做一朵花，颜色只能是白色", by: "outside", quotes: [] })
  const record = { ...base, summary: "做一朵花，颜色只能是白色\n新的摘要", state: "used" as const }
  const held = heldWords(record, { request: "做一朵花，颜色只能是白色\n旧的摘要" })!
  expect(held).toEqual(["做一朵花，颜色只能是白色", "做一朵花，颜色只能是白色\n新的摘要"])
  expect(askedWords(held, "做一朵花，颜色只能是白色\n旧的摘要")).toHaveProperty("person")
  // Without a record the stored plan's request is all there is of the person's words.
  expect(heldWords(null, { request: "做一块蓝晶" })).toEqual(["做一块蓝晶"])
})
