import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Ideas } from "@minemods/mod-core/blueprint-ideas"
import type { BlueprintPlan } from "@minemods/mod-core/blueprint"
import { createStudioService, publicError } from "../src/main/service"
import { dispatchExternal, externalError } from "../src/main/external-dispatch"
import { PAPER, played } from "./playable-fixture"

// broad19: the person's requirement 「只能是白色」 became 「只能是红色」 although the person did nothing. An outside AI handed the blueprint in
// again with another `request` and other `constraints`; the old pair was not "covered" by the new sentence, so Studio started a new list
// from the AI's words (new ids, the person's edits and gave-up lines gone). These tests hold the door against that.

type Service = Awaited<ReturnType<typeof createStudioService>>
const directories: string[] = []
const services: Service[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function outside() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-words-"))
  directories.push(directory)
  const service = await createStudioService({ workspaceDirectory: path.join(directory, "projects"), runtimeDirectory: path.join(directory, "runtime"), templateDirectory: path.join(directory, "templates"), ai: { mode: "mcp", review: true } })
  services.push(service)
  const projectId = (await service.createProject({ name: "花", description: "", modId: "flowers", empty: true })).project.id
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  const refused = (method: string, input: unknown) => call(method, input).then(() => "accepted", publicError)
  return { service, projectId, call, refused }
}

const style = { palette: [], shape: "", naming: "", world: "" }
const WHITE = "做一朵花，颜色只能是白色，不要带刺"
const flower = (honours: { constraint: string; how: string }[]): BlueprintPlan["entries"][number] => ({ key: "flower", kind: "item", title: "花", brief: "一朵花。", owner: null, needs: [], out_of_scope: null, honours })
const planOf = (honours: { constraint: string; how: string }[]) => played<BlueprintPlan>({ style, entries: [flower(honours)], questions: [] })
const ideas = {
  constraints: ["颜色只能是白色"],
  groups: [{ id: "look", title: "样子", about: "花的样子", options: [{ id: "a", title: "单瓣", lines: [{ text: "五片花瓣", from: "ai" as const, about: { thing: "flower", question: "source" as const } }], recommended: true, kinds: ["item" as const], limit: null }, { id: "b", title: "重瓣", lines: [{ text: "很多花瓣", from: "ai" as const, about: { thing: "flower", question: "source" as const } }], recommended: false, kinds: ["item" as const], limit: null }] }],
  questions: [],
  things: [{ id: "flower", title: "花", kind: "item" as const }],
  declined: [],
}
// The play questions a flower must answer are given by the cards' recommended lines; the others are closed with the person's words.
const closed = (["use", "reaction", "idle"] as const).map((question) => ({ thing: "flower", question, constraint: 0, reason: "不用" }))

const kept = (ids: string[]) => ({ verdicts: ids.map((id) => ({ constraint: id, kept: true, entry: null, why: "没有违反。" })), independent: true })
const ways = (ids: string[]) => ids.map((constraint) => ({ constraint, how: "照原话做。" }))

test("外部 AI 同时改 request 和 constraints 也换不掉人已锁的要求：原话和要求都是 Studio 存的那份", async () => {
  const { service, projectId, refused } = await outside()
  const first = { projectId, request: WHITE, blueprint: planOf(ways(["c1", "c2"])), paper_play: PAPER, constraint_check: kept(["c1", "c2"]) }
  expect(await refused("proposeBlueprint", first)).toBe("accepted")
  const before = (await service.getIdeas({ projectId })) as Ideas
  expect(before.constraints.map((value) => [value.id, value.text])).toEqual([["c1", "颜色只能是白色"], ["c2", "不要带刺"]])

  // The report's case: the sentence and the quoted requirement are both changed to red, and the plan answers the new c1.
  const RED = "做一朵花，颜色只能是红色，不要带刺"
  const swap = { ...first, request: RED, constraints: ["颜色只能是红色"] }
  const why = await refused("proposeBlueprint", swap)
  expect(why).toStartWith("AI 想把你的话换成别的。你原来说的是「做一朵花，颜色只能是白色，不要带刺」，它交上来的是「做一朵花，颜色只能是红色，不要带刺」。你的话和要求都没有动，这一版没有保存；想补充什么，在 Studio 蓝图页的「你说的要求」里加一条。")
  // Only the AI is told how to hand it in; the page's note for the person has no field names.
  expect(why).toContain("get_ideas")
  const refusal = (await service.getProjectOverview({ projectId })).plan_refusal!
  expect(refusal).toMatchObject({ by: "outside", about: "rule", constraint: null })
  expect(refusal.why).not.toContain("get_ideas")
  expect(refusal.why).not.toContain("request")
  // Nothing of the person's moved: same sentence, same ids, same words, same plan.
  const after = (await service.getIdeas({ projectId })) as Ideas
  expect(after).toEqual(before)
  expect(await service.getBlueprint({ projectId })).toMatchObject({ revision: 1, request: WHITE, constraints: before.constraints })

  // A longer sentence ("they also said red can do") and a shorter one are the same attack by another door.
  expect(await refused("proposeBlueprint", { ...first, request: `${WHITE}，其实红色也行` })).toStartWith("AI 想把你的话换成别的。")
  expect(await refused("proposeBlueprint", { ...first, request: "做一朵花" })).toStartWith("AI 想把你的话换成别的。")
  // Quoting a requirement the sentence does not hold is refused as before, with the stored sentence.
  expect(await refused("proposeBlueprint", { ...first, constraints: ["颜色只能是红色"] })).toBe("「颜色只能是红色」不是你原话里的句子。要求必须逐字摘自你说的话，不能改写。")
  expect(await service.getBlueprint({ projectId })).toMatchObject({ revision: 1, request: WHITE })

  // The same words in another dress (spaces, closing punctuation) are the person's words: stored from Studio's copy, not the AI's.
  expect(await refused("proposeBlueprint", { ...first, request: `${WHITE}。` })).toBe("accepted")
  expect(await service.getBlueprint({ projectId })).toMatchObject({ revision: 2, request: WHITE })
  expect((await service.getIdeas({ projectId })) as Ideas).toMatchObject({ request: WHITE, constraints: before.constraints })

  // Idea cards are the other door an outside AI has into the record.
  expect(await refused("proposeIdeas", { projectId, request: RED, ideas: { ...ideas, constraints: ["颜色只能是红色"], declined: closed } })).toStartWith("AI 想把你的话换成别的。")
  expect((await service.getIdeas({ projectId })) as Ideas).toMatchObject({ request: WHITE, constraints: before.constraints })
})

test("人亲手改过的要求（改字、不要、拿回、新加）在 AI 重新交蓝图以后原样还在：编号归 Studio，改动记录和不要的记录都留着", async () => {
  const { service, projectId, call, refused } = await outside()
  const first = { projectId, request: WHITE, blueprint: planOf(ways(["c1", "c2"])), paper_play: PAPER, constraint_check: kept(["c1", "c2"]) }
  expect(await refused("proposeBlueprint", first)).toBe("accepted")
  const edit = (change: Record<string, unknown>) => service.chooseIdeas({ projectId, revision: 1, ...change }) as Promise<Ideas>
  await edit({ reword: [{ id: "c1", text: "颜色只能是白色或者淡黄色" }] })
  await edit({ add: "花瓣最多五片" })
  await edit({ lift: ["c2"] })
  await edit({ restore: ["c2"] })
  const edited = (await service.getIdeas({ projectId })) as Ideas
  expect(edited.constraints.map((value) => [value.id, value.text])).toEqual([["c1", "颜色只能是白色"], ["c2", "不要带刺"], ["c3", "颜色只能是白色或者淡黄色"], ["c4", "花瓣最多五片"]])
  expect(edited.changes.map((value) => value.kind)).toEqual(["reword", "add", "drop", "restore"])
  expect(edited.lifted.map((value) => value.constraint)).toEqual(["c1"])
  const told = (await call("getBlueprint", { projectId })) as unknown as { requirements: { changed: string[]; lifted: unknown[] } }
  expect(told.requirements.changed).toHaveLength(4)

  // The maker resubmits with a sentence of its own and its own numbering: turned back, and the list is exactly what the person left.
  const renumbered = { ...first, request: "做一朵花，花瓣最多五片，不要带刺", constraints: ["花瓣最多五片", "不要带刺"], blueprint: planOf(ways(["c1", "c2"])) }
  expect(await refused("proposeBlueprint", renumbered)).toStartWith("AI 想把你的话换成别的。")
  const same = (await service.getIdeas({ projectId })) as Ideas
  expect(same.constraints).toEqual(edited.constraints)
  expect(same.changes).toEqual(edited.changes)
  expect(same.lifted).toEqual(edited.lifted)
  const again = (await call("getBlueprint", { projectId })) as unknown as { requirements: { changed: string[]; lifted: unknown[]; constraints: { id: string }[] } }
  expect(again.requirements.changed).toHaveLength(4)
  expect(again.requirements.lifted).toHaveLength(1)

  // With the person's sentence, the maker may quote in any order and any numbering of its own: the ids stay Studio's, and a quote that is only
  // a piece of a line the person holds does not make a new line (here: 「带刺」 would otherwise come back as c5, and 「淡黄色」 likewise).
  const held = { ...first, constraints: ["不要带刺", "颜色只能是白色", "带刺"], blueprint: planOf(ways(["c2", "c3", "c4"])), constraint_check: kept(["c2", "c3", "c4"]) }
  expect(await refused("proposeBlueprint", held)).toBe("accepted")
  const done = (await service.getIdeas({ projectId })) as Ideas
  expect(done.constraints).toEqual(edited.constraints)
  expect(done.lifted).toEqual(edited.lifted)
  // The log stays, and every change was answered by the plan that has now been stored.
  expect(done.changes.map((value) => [value.kind, value.constraint, value.answered])).toEqual([["reword", "c3", true], ["add", "c4", true], ["drop", "c2", true], ["restore", "c2", true]])
  const stored = (await service.getBlueprint({ projectId }))!
  expect(stored.constraints).toEqual(edited.constraints)
  expect(stored.lifted).toEqual(edited.lifted)
  const last = (await call("getBlueprint", { projectId })) as unknown as { requirements: { changed: string[]; lifted: unknown[] } }
  expect(last.requirements.changed).toEqual([])
  expect(last.requirements.lifted).toHaveLength(1)
})

test("人认可（甚至亲手改过）的想法摘要不会被 AI 复述原话时换掉；摘要里摘出来的要求在 AI 用原话重提想法时也不丢", async () => {
  const { service, projectId, call, refused } = await outside()
  await call("proposeIdeas", { projectId, request: WHITE, ideas: { ...ideas, declined: closed } })
  await service.chooseIdeas({ projectId, revision: 1, picks: [{ group: "look", option: "a", own: "" }], ready: true, summary: `${WHITE}\n我要单瓣的，花心是黄的。` })
  const record = (await service.getIdeas({ projectId })) as Ideas
  expect(record.summary).toBe(`${WHITE}\n我要单瓣的，花心是黄的。`)
  // The maker hands the plan in with the original sentence instead of the summary: taken, from Studio's copy, and the summary is still the person's.
  const plan = { projectId, request: WHITE, blueprint: planOf(ways(["c1", "c2"])), paper_play: PAPER, constraint_check: kept(["c1", "c2"]), constraints: ["不要带刺"] }
  expect(await refused("proposeBlueprint", plan)).toBe("accepted")
  const after = (await service.getIdeas({ projectId })) as Ideas
  expect(after.summary).toBe(record.summary)
  expect(after.request).toBe(WHITE)
  expect(await service.getBlueprint({ projectId })).toMatchObject({ request: WHITE })
  // With a plan standing, the person's words are held for the cards too.
  expect(await refused("proposeIdeas", { projectId, request: "做一朵红色的花", ideas: { ...ideas, constraints: [], declined: closed.map((value) => ({ ...value, constraint: 0 })) } })).toStartWith("AI 想把你的话换成别的。")
})

test("人把蓝图丢掉重新开始以后，新的一句话才是新的开始；在那之前没有任何办法绕开", async () => {
  const { service, projectId, refused } = await outside()
  const first = { projectId, request: WHITE, blueprint: planOf(ways(["c1", "c2"])), paper_play: PAPER, constraint_check: kept(["c1", "c2"]) }
  expect(await refused("proposeBlueprint", first)).toBe("accepted")
  const RED = "做一朵花，颜色只能是红色"
  const red = { ...first, request: RED, blueprint: planOf(ways(["c1"])), constraint_check: kept(["c1"]) }
  expect(await refused("proposeBlueprint", red)).toStartWith("AI 想把你的话换成别的。")
  await service.discardBlueprint({ projectId })
  expect(await refused("proposeBlueprint", red)).toBe("accepted")
  expect((await service.getIdeas({ projectId })) as Ideas).toMatchObject({ request: RED, constraints: [{ id: "c1", text: "颜色只能是红色" }] })
})

// broad19: the person had a thing's card open for editing while the outside AI stored a new version of the plan; the card kept the old
// text and its save would have written it back over the AI's.
test("蓝图条目的卡片开在旧的一版上，AI 交了新的：保存被拒并说那句话，AI 的新说明还在；载入新的再存就存得进", async () => {
  const { service, projectId, refused } = await outside()
  const plain = "做一块蓝晶"
  const entry = (brief: string): BlueprintPlan["entries"][number] => ({ key: "gem", kind: "item", title: "蓝晶", brief, owner: null, needs: [], out_of_scope: null })
  const hand = (brief: string) => ({ projectId, request: plain, blueprint: played<BlueprintPlan>({ style, entries: [entry(brief)], questions: [] }), paper_play: PAPER })
  expect(await refused("proposeBlueprint", hand("一块蓝色的晶体。"))).toBe("accepted")
  const opened = (await service.getBlueprint({ projectId }))!
  expect(opened.revision).toBe(1)
  // The AI stores its next version while the card is open on revision 1.
  expect(await refused("proposeBlueprint", hand("一块会发微光的蓝色晶体，挖出来就能捡。"))).toBe("accepted")
  const draftOf = (brief: string) => ({ request: opened.request, style: opened.style, questions: opened.questions, entries: [{ key: "gem", kind: "item" as const, title: "蓝晶", brief, owner: null, needs: [], out_of_scope: null, play: opened.entries[0]!.play }] })
  const save = (revision: number, brief: string) => service.saveBlueprint({ projectId, revision, blueprint: draftOf(brief) }).then(() => "saved", publicError)
  expect(await save(opened.revision, "一块蓝色的晶体，我加了一句。")).toBe("AI 刚改过这一样，你看到的是改之前的。")
  expect((await service.getBlueprint({ projectId }))).toMatchObject({ revision: 2, entries: [{ brief: "一块会发微光的蓝色晶体，挖出来就能捡。" }] })
  // After loading what is stored (revision 2) the person's save is accepted and is a new revision.
  expect(await save(2, "一块会发微光的蓝色晶体，挖出来就能捡。我加了一句。")).toBe("saved")
  expect((await service.getBlueprint({ projectId }))).toMatchObject({ revision: 3, entries: [{ brief: "一块会发微光的蓝色晶体，挖出来就能捡。我加了一句。" }] })
})
