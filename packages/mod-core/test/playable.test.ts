import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createDataGameplaySample } from "../script/data-gameplay-sample"
import { blockFacets, itemFacets } from "../src/content-facets"
import { creatureFacets } from "../src/creature-life"
import { modGuide } from "../src/guide"
import { validateBlueprint, type Blueprint } from "../src/blueprint"
import type { Constraint } from "../src/blueprint-constraints"
import { appliesTo, checkMark, ideaPlay, KIND_REGISTRY, PLAY_MARKS, PLAY_OPEN, PLAY_ORDER, PLAY_QUESTIONS, PLAY_REFUSALS, PLAY_SILENT, PLAYABLE_REVIEW_RULE, planThings, playability, playRefusal, playSummary, projectPlay, projectThings, walkLines, type Play, type PlayRegistry, type PlayThing } from "../src/playable"
import { playFindings } from "../src/reconcile"
import { ASSET_KINDS } from "../src/workspace-modules"

// A registry no part of the app knows: the standard reads which questions a kind is asked, never the kind's name.
const fake: PlayRegistry = {
  applies: (kind) => ({ machine: ["source", "use", "reaction", "idle"] as const, part: ["source", "use"] as const })[kind] ?? [],
  label: (kind) => ({ machine: "机器", part: "零件" })[kind] ?? kind,
}
const answer = (question: PlayThing["answers"][number]["question"], words: string, through?: string[]): PlayThing["answers"][number] => ({ question, words, mark: "ai", ...(through ? { through } : {}) })

test("四个问题是数据：每一类东西问哪几个写在登记表里，检查里不出现任何种类的名字", () => {
  expect(PLAY_ORDER).toEqual(["source", "use", "reaction", "idle"])
  expect(PLAY_ORDER.map((question) => PLAY_QUESTIONS[question].label)).toEqual(["从哪来", "干什么用", "有什么反应", "闲着时什么样"])
  // Whatever the registry says today is what is asked: a kind that is not a thing by itself is asked nothing.
  ASSET_KINDS.forEach((kind) => expect(appliesTo(kind.id)).toEqual(kind.applies ?? []))
  expect(ASSET_KINDS.filter((kind) => kind.applies?.length).every((kind) => kind.owner)).toBe(true)
  expect(KIND_REGISTRY.applies("nothing_like_this")).toEqual([])

  const report = playability(
    [
      { id: "press", kind: "machine", title: "压块机", answers: [answer("source", "用 4 个「齿轮」合成", ["gear"]), answer("reaction", "右键打开，会转"), { question: "use", words: "把碎料压成块", mark: "you" }] },
      { id: "gear", kind: "part", title: "齿轮", answers: [answer("source", "村庄的箱子里能找到", [])], declined: [{ question: "use", reason: "只是材料", mark: "proposed" }] },
      { id: "note", kind: "paper", title: "说明", answers: [] },
    ],
    fake,
  )
  // A kind that is asked nothing is not a thing; the others get one row per question that applies to them.
  expect(report.things.map((thing) => [thing.title, thing.label, thing.rows.map((row) => `${row.label}:${PLAY_MARKS[row.mark]}`).join(" ")])).toEqual([
    ["压块机", "机器", "从哪来:AI 补的 干什么用:你说的 有什么反应:AI 补的 闲着时什么样:还没有答案"],
    ["齿轮", "零件", "从哪来:AI 补的 干什么用:AI 建议不做"],
  ])
  // One gap, named in plain words; a recorded 「故意不做」 is an answer.
  expect(report.gaps.map((gap) => gap.text)).toEqual(["机器「压块机」没有交代「闲着时什么样」（没有人理它的时候，它自己在做什么）：空着的话，没人理它的时候它一动不动，像一个摆设。"])
  // On the card the open question only says that nothing was said: no claim about the game is made from silence.
  expect(report.things[0]!.rows[3]!.lines).toEqual([PLAY_OPEN])
  expect(report.summary).toBe("2 样东西 · 1 个问题还没有答案")
  expect(playSummary(0, 0)).toBe("还没有能玩的东西")
  // The walk starts with what the world gives.
  expect(report.walk.map((step) => step.title)).toEqual(["齿轮", "压块机"])
  expect(walkLines(report).map((line) => line.text)).toEqual(["先是零件「齿轮」：村庄的箱子里能找到。", "然后是机器「压块机」：用 4 个「齿轮」合成。碰它的时候：右键打开，会转。它的用处：把碎料压成块。"])
})

test("死路和走不到：只有创造模式能拿、没有用处、用处要用到得不到的东西、来历绕成圈，都被点名", () => {
  const things: PlayThing[] = [
    // Reached from the world; its use needs something nobody can get.
    { id: "ore", kind: "part", title: "矿", answers: [answer("source", "地下自己长出来", []), answer("use", "和「钥匙」一起能开门", ["key"])] },
    // Only from the creative inventory: the kind itself says so, and that is no answer.
    { id: "key", kind: "part", title: "钥匙", answers: [answer("use", "开门")], open: [{ question: "source", words: "只能在创造模式物品栏里拿到" }] },
    // Two things that are each made from the other: answered, and still nowhere to start.
    { id: "a", kind: "part", title: "甲", answers: [answer("source", "用「乙」做", ["b"]), answer("use", "做「乙」")] },
    { id: "b", kind: "part", title: "乙", answers: [answer("source", "用「甲」做"), answer("use", "做「甲」")] },
  ]
  const report = playability(things, fake)
  expect(report.gaps.map((gap) => `${gap.rule} ${gap.text}`)).toEqual([
    "needs 零件「矿」的用处（和「钥匙」一起能开门）要用到「钥匙」，可是玩家得不到「钥匙」。",
    "unanswered 零件「钥匙」没有交代「从哪来」（在一个普通的新生存世界里，玩家怎么得到它或者遇到它）：只能在创造模式物品栏里拿到。",
    "unreachable 从一个新的生存世界出发走不到零件「甲」：要先有「乙」，可是玩家得不到它。",
    // The second one did not say what it goes through: the name it quotes is read instead.
    "unreachable 从一个新的生存世界出发走不到零件「乙」：要先有「甲」，可是玩家得不到它。",
  ])
  expect(report.things.map((thing) => thing.reachable)).toEqual([true, false, false, false])
  expect(report.walk.map((step) => step.title)).toEqual(["矿"])
})

const constraints: Constraint[] = [{ id: "c1", text: "剑现在只能是普通物品", origin: "said" }]
const play = (answers: Play["answers"], declined: Play["declined"] = []): Play => ({ answers, declined })
const entry = (key: string, kind: Blueprint["entries"][number]["kind"], title: string, given?: Play) => ({ key, kind, title, brief: `做${title}`, owner: null, needs: [], out_of_scope: null, ...(given ? { play: given } : {}) })
const ore = entry("ore", "block", "蓝光矿石", play([{ question: "source", words: "主世界地下自己生成", from: "ai", through: [] }, { question: "use", words: "挖掉得到矿石自己，能合成「蓝晶剑」", from: "you" }, { question: "reaction", words: "要用铁镐挖，会发出碎裂声", from: "ai" }]))
const ruled = { question: "use" as const, reason: "普通物品没有攻击力，也不当材料", by: "constraint" as const, constraint: "c1" }
const sword = (given: Play) => entry("sword", "item", "蓝晶剑", given)
const crafted = { question: "source" as const, words: "用 2 个「蓝光矿石」和 1 根木棍合成", from: "you" as const, through: ["ore"] }

test("剑只能是普通物品：「干什么用」按用户的要求不做，算有交代；悄悄给它安排用处、指不出是哪条要求、要求放开以后，都过不了", () => {
  const kept = { constraints, entries: [ore, sword(play([crafted], [ruled]))] }
  expect(playRefusal(kept)).toBeNull()
  const row = playability(planThings(kept)).things[1]!.rows[1]!
  expect([row.label, row.state, PLAY_MARKS[row.mark], row.lines]).toEqual(["干什么用", "declined", "按你的要求不做", ["你说过「剑现在只能是普通物品」：普通物品没有攻击力，也不当材料"]])
  // The same closed question with an answer beside it is the plan deciding for the person.
  expect(playRefusal({ constraints, entries: [ore, sword(play([crafted, { question: "use", words: "可以当钥匙打开守卫的宝箱", from: "ai" }], [ruled]))] })).toBe(PLAY_REFUSALS.smuggled("蓝晶剑", "use", "剑现在只能是普通物品"))
  expect(PLAY_REFUSALS.smuggled("蓝晶剑", "use", "剑现在只能是普通物品")).toBe("你说过「剑现在只能是普通物品」，所以「蓝晶剑」的「干什么用」按你的要求不做。蓝图却又给它写了答案，等于悄悄改掉了你的要求，所以没有保存。要不要改这条要求，只能由你自己决定。")
  // "The person's requirement" must be one that exists and is still in force.
  expect(playRefusal({ constraints, entries: [ore, sword(play([crafted], [{ ...ruled, constraint: "c7" }]))] })).toBe(PLAY_REFUSALS.noConstraint("蓝晶剑", "use"))
  expect(playRefusal({ constraints, lifted: [{ constraint: "c1", change: "做成武器", at: new Date().toISOString() }], entries: [ore, sword(play([crafted], [ruled]))] })).toBe(PLAY_REFUSALS.noConstraint("蓝晶剑", "use"))
  // The person's own 「故意不做」 and the AI's proposal both count; the marks tell them apart.
  const marks = (by: "you" | "ai") => PLAY_MARKS[playability(planThings({ entries: [ore, sword(play([crafted], [{ question: "use", reason: "就是个纪念品", by, constraint: null }]))] })).things[1]!.rows[1]!.mark]
  expect([marks("you"), marks("ai")]).toEqual(["你决定不做", "AI 建议不做"])
})

test("蓝图里悄悄空着的问题被逐条点名；答案经过蓝图里没有的东西也不行", () => {
  expect(playRefusal({ entries: [ore, sword(play([crafted]))] })).toBe(
    "这份蓝图做出来还不能算一个能玩的模组，所以没有保存。下面每一处都要补上答案；确实不该有的，就写明「故意不做」和原因：\n- 物品「蓝晶剑」没有交代「干什么用」（得到它或者打败它以后，它通向哪里）：空着的话，拿到它或者打败它以后没有任何下文。",
  )
  // A thing nobody planned an answer for at all: every question that applies to its kind is listed.
  expect(playRefusal({ entries: [entry("guard", "entity", "守卫")] })!.split("\n").slice(1).map((line) => line.split("（")[0])).toEqual(appliesTo("entity").map((question) => `- 生物「守卫」没有交代「${PLAY_QUESTIONS[question].label}」`))
  expect(playRefusal({ entries: [ore, sword(play([{ ...crafted, through: ["ingot"] }], [{ ...ruled, by: "ai", constraint: null }]))] })).toBe(PLAY_REFUSALS.stray("蓝晶剑", "ingot"))
  // What is not made is not asked, and a kind that is asked nothing never stands in the way.
  expect(playRefusal({ entries: [{ ...entry("skill", "item", "剑的技能"), out_of_scope: "做不了" }, entry("mesh", "model", "模型"), entry("mix", "recipe", "配方")] })).toBeNull()
})

test("旧工程照常打开：没有答案的旧蓝图通过校验，问题只是显示成还没有答案；读不出答案的种类不下结论，也不拦打包", () => {
  const old = { request: "做一把剑", style: { palette: [], shape: "", naming: "", world: "" }, questions: [], revision: 3, state: "confirmed" as const, entries: [{ ...entry("sword", "item", "蓝晶剑"), asset_id: null }] }
  const blueprint = validateBlueprint(old, "fabric-1.21.1")
  expect(blueprint.entries[0]!.play).toBeUndefined()
  expect(playability(planThings(blueprint)).summary).toBe("1 样东西 · 2 个问题还没有答案")
  // A saved thing whose kind reports nothing (here: a document the kind's report is never asked about) is "not known".
  const silent = playability([{ id: "x", kind: "part", title: "旧零件", answers: [], silent: true }], fake)
  expect(silent.things[0]!.rows.map((row) => row.lines[0])).toEqual([PLAY_SILENT, PLAY_SILENT])
  expect(silent.gaps.every((gap) => gap.silent)).toBe(true)
  expect(silent.things[0]!.reachable).toBe(true)
  expect(silent.walk).toEqual([])
  // An empty project has nothing to say and nothing to stop.
  const empty = { mod_id: "old", blocks: [], items: [], recipes: [], entities: [], logic: [], workspace: { assets: [] } }
  expect(projectThings(empty)).toEqual([])
  expect(projectPlay(empty).summary).toBe("还没有能玩的东西")
  expect(playFindings(empty as unknown as Parameters<typeof playFindings>[0])).toEqual([])
})

test("想法卡片上的四个问题：没选的组按推荐的算，选了「都不要」就如实显示还没有答案；用户放开要求以后那一格重新打开", () => {
  const line = (text: string, from: "you" | "ai", thing: string, question: "source" | "use") => ({ text, from, about: { thing, question } })
  const record = {
    groups: [
      { id: "get", options: [{ id: "craft", recommended: true, lines: [line("用 2 个蓝晶和 1 根木棍合成", "ai", "sword", "source")] }, { id: "loot", recommended: false, lines: [line("守卫掉落", "ai", "sword", "source")] }] },
    ],
    picks: [] as { group: string; option: string | null }[],
    things: [{ id: "sword", title: "蓝晶剑", kind: "item" }],
    declined: [{ thing: "sword", question: "use" as const, reason: "普通物品没有别的用处", constraint: "c1" }],
    constraints,
    lifted: [] as { constraint: string; change: string; at: string }[],
  }
  const rows = (given: typeof record) => ideaPlay(given).things[0]!.rows.map((row) => `${row.label}｜${PLAY_MARKS[row.mark]}｜${row.lines[0]}`)
  expect(rows(record)).toEqual(["从哪来｜AI 补的｜用 2 个蓝晶和 1 根木棍合成", "干什么用｜按你的要求不做｜你说过「剑现在只能是普通物品」：普通物品没有别的用处"])
  expect(rows({ ...record, picks: [{ group: "get", option: "loot" }] })[0]).toBe("从哪来｜AI 补的｜守卫掉落")
  expect(rows({ ...record, picks: [{ group: "get", option: null }] })[0]).toBe(`从哪来｜还没有答案｜${PLAY_OPEN}`)
  expect(rows({ ...record, lifted: [{ constraint: "c1", change: "做成武器", at: new Date().toISOString() }] })[1]).toBe(`干什么用｜还没有答案｜${PLAY_OPEN}`)
})

test("给评审的那一句话是现成的常量，用的是验收里的原词", () => {
  expect(PLAYABLE_REVIEW_RULE).toBe("凡是把这一类东西平常就有的行为去掉了（它本来会自己走动、张望、对玩家有反应，做完以后不会了），或者答应过的反应在游戏里那么大的画面上看不出来（挨打、出手、死掉、被挖掉、被使用的时候没有看得见的变化），都算「必须改的」，不能只写进「可以更好的」。")
})

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("对着真实工程再对一遍：示例工程每样东西都答得上、都走得到；拿掉配方以后只是多了提醒，不拦打包，说明书里写明哪样走不到", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-playable-"))
  directories.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"))
  // The answers are the kinds' own (`facets` in the registry), read from the saved project.
  const whole = playability(projectThings(project))
  expect(whole.things.length).toBeGreaterThan(2)
  expect(whole.gaps).toEqual([])
  expect(whole.things.every((thing) => thing.reachable && thing.rows.every((row) => row.mark === "made"))).toBe(true)
  expect(playFindings(project)).toEqual([])
  const guide = (given: typeof project) => modGuide(given, { findings: playFindings(given), animations: {}, glowing: [], built: false })
  const walk = guide(project).sections.find((section) => section.title === "怎么玩一遍")!
  // What the world gives comes first; what is made from it comes after it.
  const place = (name: string) => walk.lines.findIndex((line) => line.text.includes(`「${name}」：`))
  expect(place("蓝晶矿石")).toBe(1)
  expect(place("蓝晶块")).toBeGreaterThan(place("蓝晶碎片"))
  expect(place("蓝晶碎片")).toBeGreaterThan(place("蓝晶矿石"))

  const broken = { ...project, recipes: [] }
  const findings = playFindings(broken)
  expect(findings.map((finding) => [finding.rule, finding.stops, finding.about?.name]).sort()).toEqual([["play_gap", false, "蓝晶块"], ["play_gap", false, "蓝晶碎片"]])
  expect(findings.find((finding) => finding.about?.name === "蓝晶块")!.text).toStartWith("「蓝晶块」还有 1 个问题没有答案：从哪来（")
  expect(findings[0]!.fix).toBe("让 AI 给它补上，或者在蓝图里写明这一处故意不做。它本来就只是摆设的话，让 AI 在蓝图里把「干什么用」标成按你的要求不做，这条提醒就没了。不改也能打包，只是玩起来这里是断的。")
  const page = guide(broken)
  expect(page.sections.find((section) => section.title === "怎么玩一遍")!.lines.at(-1)!.text).toBe("还走不到的：「蓝晶块」。生存模式里没有它们的来历，只能在创造模式的物品栏里拿。")
  expect(page.sections.find((section) => section.title === "机器对账发现的问题")!.lines.map((line) => line.text)).toEqual(findings.map((finding) => `${finding.text}${finding.fix}`))
  // A 「故意不做」 recorded on the plan entry of a made thing is honoured on the real project too.
  const block = project.workspace.assets.find((asset) => asset.title === "蓝晶块")!
  const planned = { ...broken, blueprint: { entries: [{ key: "azure_block", kind: "block", title: "蓝晶块", out_of_scope: null, asset_id: block.id, play: { answers: [], declined: [{ question: "source" as const, reason: "只给创造模式的建筑玩家用", by: "you" as const, constraint: null }] } }] } }
  expect(playability(projectThings(planned)).gaps.map((gap) => gap.title)).toEqual(["蓝晶碎片"])
  // An answer the plan gave that the made thing does not bear out is quoted beside the open question.
  const promised = { ...broken, blueprint: { entries: [{ key: "azure_block", kind: "block", title: "蓝晶块", out_of_scope: null, asset_id: block.id, play: { answers: [{ question: "source" as const, words: "放在家里当摆设", from: "ai" as const }], declined: [] } }] } } as unknown as typeof project
  expect(playFindings(promised).find((finding) => finding.about?.name === "蓝晶块")!.text).toContain("；蓝图里答的是「放在家里当摆设」，做出来的东西里读不出来）")
  expect(playFindings(broken).find((finding) => finding.about?.name === "蓝晶块")!.text).not.toContain("蓝图里答的是")
})

test("盔甲和修理材料、召唤印记及祭坛会有各自的用处", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-playable-r14-"))
  directories.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"), { life: true })
  const material = project.items[0]!
  const plain = { ...material, identifier: "plain", tool: null, food: null, fuel: null, armor: null }
  const uses = (item: typeof plain | typeof material, given = project) => itemFacets(item, given).filter((facet) => facet.question === "use" && facet.answered)
  expect(uses(plain)).toEqual([])
  const armor = { ...plain, identifier: "chestplate", armor: { slot: "chest" as const, look: "iron" as const, repair: `${project.mod_id}:plain`, defense: 6, toughness: 0, knockback_resistance: 0, durability: 240, enchantability: 9 } }
  expect(uses(armor)[0]?.words).toContain("胸甲，护甲 6")
  expect(uses(plain, { ...project, items: [...project.items, armor] })[0]?.words).toContain("在铁砧上")
  const altar = project.blocks[0]!
  const boss = { ...project.entities[0]!, name: "石卫", behavior: "hostile" as const, boss: { bar: { color: "white" as const, style: "progress" as const, darken_sky: false }, intro: null, phases: [], death: { seconds: 1, xp_bursts: 0, explosion: false }, leash: null, summon: { item: "plain", block: altar.identifier, consume: false, cooldown: 2, ahead: 2 } } }
  const withRitual = { ...project, entities: [...project.entities, boss] }
  expect(uses(plain, withRitual)[0]?.words).toContain("召唤「石卫」")
  expect(blockFacets(altar, project).some((facet) => facet.words.includes("召唤台"))).toBe(false)
  expect(blockFacets(altar, withRitual).some((facet) => facet.words.includes("召唤台"))).toBe(true)
  const withoutCode = { ...project, workspace: { assets: project.workspace.assets.filter((asset) => asset.module !== "gameplay") } }
  expect(blockFacets(altar, withoutCode).some((facet) => facet.question === "use" && facet.words.includes("玩法"))).toBe(false)
  expect(blockFacets(altar, project).some((facet) => facet.question === "use" && facet.words.includes("玩法"))).toBe(true)
  const entity = { ...boss, kind: "entity" as const, model_asset_id: boss.model_asset_id!, runtime: { ...boss.runtime!, spawn: null } }
  expect(creatureFacets({ ...entity, boss: null }, withoutCode).some((facet) => facet.question === "source" && !facet.answered)).toBe(true)
  expect(creatureFacets(entity, { ...withRitual, workspace: withoutCode.workspace }).some((facet) => facet.question === "source" && facet.answered && facet.through?.includes("plain"))).toBe(true)
})

test("说明文档里的四个问题和适用的种类，就是代码里的这一份", async () => {
  const page = (await Bun.file(new URL("../../../docs/specs/2026-10-06-playable-standard.md", import.meta.url)).text()).replaceAll("\r\n", "\n")
  PLAY_ORDER.forEach((question, index) => {
    const asked = PLAY_QUESTIONS[question]
    expect(page).toContain(`### ${index + 1}. ${asked.label}\n\n${asked.asks}。\n\n- 算数的：${asked.counts}。\n- 不算的：${asked.not}。\n- 一直空着的话：${asked.gap}。`)
  })
  ASSET_KINDS.filter((kind) => kind.applies?.length).forEach((kind) => expect(page).toContain(`| ${kind.label} | ${appliesTo(kind.id).map((question) => PLAY_QUESTIONS[question].label).join("、")} |`))
  expect(page).toContain(PLAYABLE_REVIEW_RULE)
  expect(page).toContain(PLAY_REFUSALS.unplayed)
})

test("说明书上的检查标记：纸上试玩有卡住的地方时，不会写「没有问题」", () => {
  const stuck = { findings: ["要先有钓竿才能钓到鱼，可是钓竿没有来路。"], advice: [] }
  const fine = { findings: [], advice: ["可以再加一点奖励。"] }
  // The rule check found nothing, but the walk got stuck: a reminder, not a clean mark.
  expect(checkMark("ok", stuck)).toBe("warn")
  // A walk with only suggestions, no walk at all, or a walk of someone else's: nothing to add to a clean check.
  expect(checkMark("ok", fine)).toBe("ok")
  expect(checkMark("ok", null)).toBe("ok")
  expect(checkMark("ok", undefined)).toBe("ok")
  // A check that stops the build stays what it is, and one that did not run is not given a mark by the walk.
  expect(checkMark("stop", stuck)).toBe("stop")
  expect(checkMark("warn", stuck)).toBe("warn")
  expect(checkMark(null, stuck)).toBeNull()
})
