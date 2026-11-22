import { expect, test } from "bun:test"
import { RUNTIME_TURN_LINE } from "@minemods/mod-core/runtime"
import { SCENE_WORDS } from "@minemods/mod-core/scene"
import { markProgress, type JobMarks } from "../src/main/job-marks"

// broad7–9: three batches running, the drawer never said the scene's game was open: the job's detail is only the newest piece of output,
// and the game's next line replaced the one that said so. The mark outlives the pieces that come after it.
test("进了世界的那一句记成标记，后面的游戏输出冲不掉；第一次的时间不会被改写", () => {
  const marks: JobMarks = {}
  let clock = 0
  const now = () => `t${++clock}`
  const pieces = ["正在打开测试场。\n", "[Render thread/INFO]: Setting user: Tester\n", `${SCENE_WORDS.in_game}\n`, "[Server thread/INFO]: Saving chunks\n", `${SCENE_WORDS.in_game}\n`]
  const seen = pieces.map((piece) => ({ ...markProgress(marks, piece, now) }))
  expect(seen[1]).toEqual({})
  expect(seen[2]).toEqual({ in_game_at: "t1" })
  expect(seen[3]).toEqual({ in_game_at: "t1" })
  expect(seen[4]).toEqual({ in_game_at: "t1" })
})

test("排队等运行环境的作业，轮到它的时间照旧记下", () => {
  const marks = markProgress({}, `等别的作业\n${RUNTIME_TURN_LINE}`, () => "turn")
  expect(marks).toEqual({ turned_at: "turn" })
})

// broad16 a60: the title screen is marked the same way, and its mark does not stand in for the world.
test("主菜单那一句也记成标记；进了世界另记一个，互不替代", () => {
  const marks: JobMarks = {}
  let clock = 0
  const now = () => `t${++clock}`
  expect(markProgress(marks, `${SCENE_WORDS.at_title}\n`, now)).toEqual({ at_title_at: "t1" })
  expect({ ...markProgress(marks, "[Render thread/INFO]: Stopping worker threads\n", now) }).toEqual({ at_title_at: "t1" })
  expect({ ...markProgress(marks, `${SCENE_WORDS.in_game}\n`, now) }).toEqual({ at_title_at: "t1", in_game_at: "t2" })
})
