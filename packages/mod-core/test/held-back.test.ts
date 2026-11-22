import { expect, test } from "bun:test"
import { heldBack, stoppedBehind, type RunTask } from "../src/workspace-runs"

const t = (key: string, state: RunTask["state"], dependencies: string[] = []) => ({ id: key, key, state, dependencies })

test("排队的任务只要上游停了（失败、停下、或自己也被卡住），不管隔几层，都算被卡住；上游还在做或做好了就不算", () => {
  const keys = (tasks: ReturnType<typeof t>[]) => heldBack(tasks).map((task) => task.key)
  expect(keys([t("a", "failed"), t("b", "queued", ["a"]), t("c", "queued", ["b"]), t("d", "queued", ["c"])])).toEqual(["b", "c", "d"])
  expect(keys([t("a", "canceled"), t("b", "queued", ["a"])])).toEqual(["b"])
  // Order in the list does not matter.
  expect(keys([t("c", "queued", ["b"]), t("b", "queued", ["a"]), t("a", "failed")])).toEqual(["c", "b"])
  expect(keys([t("a", "running"), t("b", "queued", ["a"]), t("c", "completed"), t("d", "queued", ["c"]), t("e", "queued")])).toEqual([])
  // One of several is enough; a dependency the run does not have can never be made.
  expect(keys([t("a", "completed"), t("x", "failed"), t("b", "queued", ["a", "x"]), t("c", "queued", ["missing"])])).toEqual(["b", "c"])
  // Tasks already past queued are not touched.
  expect(keys([t("a", "failed"), t("b", "running", ["a"])])).toEqual([])
})

test("被卡住的任务归到真正停下的那些上游：失败或停下的，穿过中间被卡住的；上游里没有停下的就是空", () => {
  const tasks = [t("a", "failed"), t("z", "canceled"), t("b", "blocked", ["a"]), t("c", "blocked", ["b", "z"]), t("d", "blocked"), t("e", "blocked", ["d"])]
  expect(stoppedBehind(tasks, tasks[3]!).map((task) => task.key)).toEqual(["a", "z"])
  expect(stoppedBehind(tasks, tasks[2]!).map((task) => task.key)).toEqual(["a"])
  // Held up only by something the closing of the app cut off: nothing failed.
  expect(stoppedBehind(tasks, tasks[5]!)).toEqual([])
  expect(stoppedBehind(tasks, { key: "q", dependencies: [] })).toEqual([])
})
