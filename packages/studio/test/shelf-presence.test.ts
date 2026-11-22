import { expect, test } from "bun:test"
import { createPresence, MCP_PRESENCE } from "../src/mcp-presence"
import { outsidePresent, connectionChip } from "../src/renderer/connection-chip"
import { nonemptyGroups } from "../src/renderer/features/project-navigation-model"
import { rememberShelf, shelfOpen, SHELF_STORE } from "../src/renderer/shelf-state"

test("2 秒独立报到，6 秒失联锁定；工具调用不能冒充成功报到", () => {
  let time = 100
  const state = createPresence({ now: () => time })
  expect(state.snapshot().state).toBe("unconnected")
  state.report({ sessionId: "maker", presenceVersion: 1 })
  expect(state.snapshot().state).toBe("connected")
  time += 6_000
  expect(state.snapshot().state).toBe("disconnected")
  state.tool("restarted-without-report")
  expect(state.snapshot().state).toBe("disconnected")
  for (const interval of [1, 2, 3]) {
    time += MCP_PRESENCE.report
    state.report({ sessionId: "maker", presenceVersion: 1 })
    expect(state.snapshot().tools).toBe(0)
  }
  time += 5_999
  expect(state.snapshot().connected).toBe(true)
  time += 1
  expect(state.snapshot().state).toBe("disconnected")
  state.tool("maker")
  expect(state.snapshot().state).toBe("disconnected")
  state.report({ sessionId: "maker", presenceVersion: 1 })
  expect(state.snapshot().state).toBe("connected")
})

test("进程退出、管道关闭立即断开；恢复要求新报到", () => {
  let alive = true
  const state = createPresence({ alive: () => alive })
  state.report({ sessionId: "maker", presenceVersion: 1, pid: 42 })
  alive = false
  expect(state.snapshot().state).toBe("disconnected")
  alive = true
  expect(state.snapshot().state).toBe("disconnected")
  state.report({ sessionId: "maker", presenceVersion: 1, pid: 42 })
  expect(state.snapshot().state).toBe("connected")
  state.report({ sessionId: "maker", shutdown: true })
  expect(state.snapshot().state).toBe("disconnected")
})

test("领取后 45 秒没工具才没动静，心跳不算工具；完成后已连接", () => {
  let time = 100
  const state = createPresence({ now: () => time })
  state.report({ sessionId: "maker", presenceVersion: 1 })
  state.task("maker", "sword", "铜齿剑")
  expect(state.snapshot().state).toBe("working")
  time += 44_999
  state.report({ sessionId: "maker", presenceVersion: 1 })
  expect(state.snapshot().state).toBe("working")
  time += 1
  expect(state.snapshot()).toMatchObject({ state: "idle", task: "铜齿剑", tools: 0 })
  state.tool("maker")
  expect(state.snapshot().state).toBe("working")
  state.task("maker", "sword", null)
  expect(state.snapshot().state).toBe("connected")
  state.task("maker", "valley", "山谷", "run")
  state.cancel("other")
  expect(state.snapshot().state).toBe("working")
  state.cancel("run")
  expect(state.snapshot().state).toBe("connected")
})

test("旧客户端保留两分钟兼容窗口，不误用新版六秒判定；多个会话不互相断开", () => {
  let time = 100
  const state = createPresence({ now: () => time })
  state.tool()
  time += 90_000
  expect(state.snapshot().connected).toBe(true)
  state.report({ sessionId: "old" })
  time += 15_000
  expect(state.snapshot().connected).toBe(true)
  state.report({ sessionId: "new", presenceVersion: 1 })
  state.report({ sessionId: "new", shutdown: true })
  expect(state.snapshot().connected).toBe(true)
  time += MCP_PRESENCE.legacy
  expect(state.snapshot().connected).toBe(false)
  expect(outsidePresent({ connected: false, lastActivity: new Date(time).toISOString(), state: "disconnected" }, time)).toBe(false)
  state.tool()
  expect(state.snapshot().connected).toBe(true)
})

test("五态标题、非空类别及用户选择跨重启并覆盖窄屏默认", () => {
  for (const [state, text] of Object.entries({ connected: "已连接", working: "正在做", idle: "45 秒没动静", disconnected: "断开了", unconnected: "AI 没连接" })) {
    expect(connectionChip({ external: true, mcp: { connected: state === "connected", lastActivity: null, state: state as "connected" }, aiConfigured: false, advanced: false, now: 0 }).text).toBe(text)
  }
  const rows = [{ id: "empty", things: [] }, { id: "world", things: [1] }, { id: "parts", things: [2] }]
  expect(nonemptyGroups(rows, (group) => group.things).map((g) => g.id)).toEqual(["world", "parts"])
  const data = new Map<string, string>()
  const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  expect(shelfOpen(store, SHELF_STORE, 1279, 1280)).toBe(false)
  expect(shelfOpen(store, SHELF_STORE, 1280, 1280)).toBe(true)
  expect(shelfOpen(store, "minemods.activity.open", 1365, 1366)).toBe(false)
  rememberShelf(store, SHELF_STORE, true)
  expect(shelfOpen(store, SHELF_STORE, 1000, 1280)).toBe(true)
  rememberShelf(store, SHELF_STORE, false)
  expect(shelfOpen(store, SHELF_STORE, 1920, 1280)).toBe(false)
})

// 11-09: the AI making things left while a reviewer still waited, and the title said 「已连接」 with nothing to do but wait.
test("拿着任务的 AI 走了、审查员还连着：算断开；之后新连上的会话接手：不再算断开", () => {
  let time = 1_000
  const state = createPresence({ now: () => time })
  state.report({ sessionId: "reviewer", presenceVersion: 1 })
  time += 10
  state.report({ sessionId: "maker", presenceVersion: 1 })
  state.task("maker", "t1", "铜灯机器人", "r1")
  expect(state.snapshot()).toMatchObject({ state: "working", task: "铜灯机器人" })
  time += 10
  state.report({ sessionId: "maker", shutdown: true })
  state.report({ sessionId: "reviewer", presenceVersion: 1 })
  expect(state.snapshot()).toMatchObject({ state: "disconnected", task: "铜灯机器人" })
  // The same AI back in a new process or a new conversation: connected again, and once it works on the task it holds it.
  time += 10
  state.report({ sessionId: "maker-2", presenceVersion: 1 })
  expect(state.snapshot().state).toBe("connected")
  state.task("maker-2", "t1", "铜灯机器人", "r1")
  expect(state.snapshot()).toMatchObject({ state: "working", task: "铜灯机器人" })
})
