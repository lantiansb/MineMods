import { expect, test } from "bun:test"
import { runActivity } from "../src/activity"
import { forPerson, refusalForPerson, speaksToAi, withheldWords } from "../src/refusal-words"
import type { ProjectRun, RunTask } from "../src/workspace-runs"

// The text an outside AI is refused with when it moves ahead of the order (broad19: shown to the person as one long plain paragraph).
const CREATURE_ORDER =
  "这只生物在这个任务里还没有用 look 看过。生物不写部件说明（不用 save_sheet）：文档里 abilities 不是空的，或者写了 hitbox，就先 look 看它的招式和碰撞箱，再 self_review、final_review，通过以后 commit_task；两样都没有的不看图，做好以后直接 commit_task。"

test("a refusal's procedure is for the AI: only the plain sentences are the person's, and the count of what was left out is kept", () => {
  const said = refusalForPerson(CREATURE_ORDER)
  // Every sentence names a call or a field (look, save_sheet, abilities, hitbox, commit_task): nothing of it is a line for the person.
  expect(said.lines).toEqual([])
  expect(said.withheld).toBeGreaterThanOrEqual(3)
  // What is wrong first and what to do after: the first is kept, the second is not.
  expect(refusalForPerson("这一版还没有检查过。先用 check_code 检查代码，再往下走。")).toEqual({ lines: ["这一版还没有检查过。"], withheld: 1 })
  // A numbered acceptance refusal keeps its finding and its plain fix and drops the way out that names the part sheet's field.
  const acceptance = '1. 【不机械】图上到处是杂点。怎么改：画成成块的深浅。如果它本来就该这样，在部件说明的 justified 里写上这一项和理由（{"what":"noisy_texture","reason":"……"}），理由会原样给评审和人看。'
  expect(refusalForPerson(acceptance)).toEqual({ lines: ["1. 【不机械】图上到处是杂点。怎么改：画成成块的深浅。"], withheld: 1 })
})

test("a sentence with no name of code in it is left whole, and so are 「names」, commands and files a person knows", () => {
  const plain = "AI 发来的这一次调用，Studio 读不懂（内容的格式不对）。已经把哪里不对告诉它了，它会改好再发。"
  expect(refusalForPerson(plain)).toEqual({ lines: [plain], withheld: 0 })
  expect(speaksToAi("找不到「Sword」这张贴图，请看 sword.png。")).toBe(false)
  expect(speaksToAi("在游戏里输入 `/give @s stone` 试试。")).toBe(false)
  // A name Studio knows is said as what it is, and then the sentence reads as words.
  expect(speaksToAi("（slug、name、summary、behaviours、not_doing、uses）有一项没写。")).toBe(false)
  expect(refusalForPerson("（slug、name、summary、behaviours、not_doing、uses）有一项没写。").lines).toEqual(["（标识、名字、概要、会做的事、不做的事、用到的东西）有一项没写。"])
  // Bare field names in a Chinese sentence are code too, though they have no underscore or capital.
  expect(speaksToAi("文档里 abilities 不是空的。")).toBe(true)
  expect(speaksToAi("碰撞箱 hitbox 没写。")).toBe(true)
  expect(forPerson("先 look 再 self_review")).toBe("先 看图 再 自评")
})

test("in the activity log a failed task shows the plain sentences only; the whole text waits under 高级", () => {
  const task = (state: RunTask["state"], extra: Partial<RunTask> = {}): RunTask =>
    ({ id: "00000000-0000-4000-8000-000000000001", title: "裂岩守卫", source: "手工任务", asset_id: "00000000-0000-4000-8000-000000000002", module: "entity", state, detail: "", error: null, ...extra }) as RunTask
  const run = (tasks: RunTask[], state: ProjectRun["state"]): ProjectRun => ({ id: "r", project_id: "p", prompt: "", state, summary: "", questions: [], tasks, events: [], error: null, model_complexity: null, created_at: "2026-10-15T00:00:00.000Z", updated_at: "2026-10-15T00:00:00.000Z" }) as ProjectRun
  const before = run([task("running")], "running")
  const failed = runActivity(before, run([task("failed", { error: CREATURE_ORDER })], "partial")).find((event) => event.item !== null && event.end)!
  expect(failed.text).toBe("这一样没做成。")
  expect(failed.lines).toHaveLength(1)
  expect(failed.lines![0]).toStartWith("另有 ")
  expect(failed.lines![0]).toBe(withheldWords(refusalForPerson(CREATURE_ORDER).withheld))
  for (const name of ["abilities", "hitbox", "look", "self_review", "final_review", "commit_task", "save_sheet"]) expect(failed.lines!.join("")).not.toContain(name)
  expect(failed.detail).toBe(CREATURE_ORDER)
  // A text that is all plain words stays the person's line and needs no 高级.
  const plain = runActivity(before, run([task("failed", { error: "模型一直画不出头，试了 4 次。" })], "partial")).find((event) => event.end && event.item !== null)!
  expect(plain.lines).toEqual(["模型一直画不出头，试了 4 次。"])
  expect(plain.detail).toBeUndefined()
})
