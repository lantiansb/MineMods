import { expect, test } from "bun:test"
import { z } from "zod"
import { runActivity } from "@minemods/mod-core/activity"
import { MakingRefusal, UNSATISFIED } from "@minemods/mod-core/making"
import { identifiersIn } from "@minemods/mod-core/play-words"
import type { ProjectRun, RunTask } from "../src/project-runs"
import { toolActivity } from "../src/main/activity-tools"
import { CALL_UNREADABLE, externalError, refusedWords } from "../src/main/external-dispatch"
import { AcceptanceRefusal } from "../src/main/project-runner"

// 10-07 audit: wherever a reason is shown to the person it is a sentence written for them; what it was made from is kept for 高级.
const HAN = /[一-鿿]/

test("外部 AI 发来的调用格式不对：它自己拿到逐条的原因，用户在动态里看到的是一句大白话，原文只在高级里", () => {
  const error = z.strictObject({ projectId: z.uuid(), taskId: z.uuid() }).safeParse({ projectId: "not-an-id", extra: 1 }).error!
  // The outside AI is still given every field that was wrong: it needs them to correct its call.
  const given = externalError(error) as Error
  expect(given.message).toStartWith("结构校验失败：projectId: ")
  expect(given.message).toContain("taskId: ")
  // The person is not shown the schema's English.
  const refused = refusedWords(error)
  expect(refused).toEqual({ plain: true, message: CALL_UNREADABLE, raw: given.message })
  expect(CALL_UNREADABLE).toMatch(HAN)
  const event = toolActivity({ method: "commitExternalTask", input: { projectId: "00000000-0000-4000-8000-000000000001" }, result: null, refused, ms: 3, run: null })!
  expect(event).toMatchObject({ mark: "fail", text: "外部 AI 提交了这一样，被 Studio 退回了。", lines: [CALL_UNREADABLE] })
  expect(`${event.text}${event.lines!.join("")}`).not.toMatch(/invalid|expected|schema|结构校验/i)
  expect(event.detail).toBe(`commit_task · 3 毫秒\n${given.message}`)
  // A refusal written for whoever reads it is shown as it is, as before.
  expect(refusedWords(new AcceptanceRefusal("没通过验收：贴图和模型对不上。"))).toEqual({ plain: true, message: "没通过验收：贴图和模型对不上。" })
  expect(refusedWords(new Error("ENOENT: no such file"))).toEqual({ plain: false, message: "ENOENT: no such file" })
})

test("动态里“留下了最好的一版”的原因和“没做成”的原因守同一条规矩：不是写给人看的话不露出来", () => {
  const detail = `${UNSATISFIED.mark}：把第 2 版先交给你验收。`
  const task = (extra: Partial<RunTask>): RunTask => ({ id: "00000000-0000-4000-8000-000000000002", key: "guard", module: "model", title: "守卫", prompt: "守卫", source: "守卫", dependencies: [], target_id: null, asset_id: "00000000-0000-4000-8000-000000000003", state: "running", detail: "正在做", error: null, started_at: null, finished_at: null, ...extra })
  const run = (tasks: RunTask[], message: string | null) => ({ id: "00000000-0000-4000-8000-000000000004", state: "running", tasks, events: message ? [{ id: 0, task_id: tasks[0]!.id, time: new Date(0).toISOString(), message }] : [] }) as unknown as ProjectRun
  const before = run([task({})], null)
  const kept = (reason: string) => runActivity(before, run([task({ state: "completed", detail, outcome: "kept_unsatisfied" })], `${detail}${reason}`)).find((event) => event.end)!
  expect(kept("UPSTREAM_UNAVAILABLE")).toMatchObject({ mark: "warn", text: detail, lines: ["出了技术问题，原文在高级里。"], detail: "UPSTREAM_UNAVAILABLE" })
  expect(kept("已经看了 6 版，评审还是没有通过。")).toMatchObject({ mark: "warn", lines: ["已经看了 6 版，评审还是没有通过。"] })
  expect(kept("已经看了 6 版，评审还是没有通过。").detail).toBeUndefined()
  expect(kept("").lines).toBeUndefined()
  // The failed branch, for comparison: the same two outcomes.
  const failed = (error: string) => runActivity(before, run([task({ state: "failed", detail: "模块任务失败。", error })], null)).find((event) => event.end)!
  expect(failed("INVALID_OUTPUT")).toMatchObject({ lines: kept("INVALID_OUTPUT").lines, detail: "INVALID_OUTPUT" })
})

test("外部 AI 的提交被代码检查拦下：AI 拿到带文件和类名的原话，用户在动态里看到的是讲规矩的一句话，原话只在高级里（第 18 轮的卡片）", () => {
  const quoted = "这一版没有通过代码检查，不能评审也不能提交：Alarm.java 第 36 行：用到了 java.net.Socket：连接游戏以外的地址。先用 check_code 检查。"
  const said = "这一版没有通过代码检查，不能评审也不能提交：代码越界了：代码想连接网络，玩法不能联网。"
  const refused = refusedWords(new MakingRefusal(quoted, false, said))
  // The outside AI is given the quoted line (it has to fix that line), and the person is given the sentence.
  expect(externalError(new MakingRefusal(quoted, false, said))).toMatchObject({ message: quoted })
  expect(refused).toEqual({ plain: true, message: said, raw: quoted })
  const event = toolActivity({ method: "commitExternalTask", input: { projectId: "00000000-0000-4000-8000-000000000001" }, result: null, refused, ms: 5, run: null })!
  expect(event.lines).toEqual([said])
  expect(identifiersIn(event.lines!.join(""))).toEqual([])
  expect(event.lines!.join("")).not.toMatch(/Alarm|Socket|check_code/)
  expect(event.detail).toBe(`commit_task · 5 毫秒\n${quoted}`)
  // A refusal with no sentence of its own is shown as it was written (it was written for whoever reads it): nothing is invented for it.
  expect(refusedWords(new MakingRefusal("新交的这一版和上一版一模一样。"))).toEqual({ plain: true, message: "新交的这一版和上一版一模一样。" })
})
