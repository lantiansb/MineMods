import { expect, test } from "bun:test"
import { leaked } from "../../mod-core/test/fixtures/acceptance/names"
import { MCP_SERVER_INSTRUCTIONS, PLAIN_TALK, buildMcpHandoff, buildMcpReviewHandoff } from "../src/main/mcp-handoff"
import { everythingToRead } from "./handoff-reading"
import { REVIEW_OUTSIDE, awayStatus, connectionLine, settingsBack, settingsOrigin } from "../src/renderer/features/settings-words"
import { MODE_WORDS } from "../src/renderer/words"

const configuration = JSON.stringify({ mcpServers: { "minemods-studio": { command: "studio.exe", args: ["mcp-stdio.js"] } } })
const project = { id: "842db5af-c5b8-4e6b-87f3-9cd104fe7af3", name: "月光森林", revision: 3 }

test("从工程点进个人设置：顶部说明是从哪个工程来的，回去的按钮指向它，不再说还没打开工程", () => {
  const origin = settingsOrigin({ previousPage: "overview", project: { id: project.id, name: project.name } })
  expect(origin).toEqual({ id: project.id, name: "月光森林" })
  expect(awayStatus({ project: origin?.name, nickname: "" })).toBe("工程「月光森林」")
  // The nickname's greeting gives way to it: the worry is about the project, not about being greeted.
  expect(awayStatus({ project: origin?.name, nickname: "阿铜" })).toBe("工程「月光森林」")
  const back = settingsBack(origin)
  expect(back.label).toBe("返回工程「月光森林」")
  expect(back.to).toBe("overview")
  expect(back.said).toContain("月光森林")
  expect(back.said).toContain("没有丢")
})

test("从首页或新建页进个人设置：哪怕还留着上一个工程，也不说是从它来的，回去就是工程库", () => {
  for (const previousPage of ["home", "create", "resources", undefined]) {
    expect(settingsOrigin({ previousPage, project: { id: project.id, name: project.name } })).toBeNull()
  }
  expect(settingsOrigin({ previousPage: "overview", project: null })).toBeNull()
  expect(settingsBack(null)).toEqual({ label: "回工程库", to: "home", said: "" })
  expect(awayStatus({ project: undefined, nickname: "阿铜" })).toBe("你好，阿铜")
  expect(awayStatus({ project: "  ", nickname: "" })).toBe("还没打开工程")
})

test("很长的工程名：按钮上截短，旁边那句话里是全名", () => {
  const name = "一个名字特别特别特别特别特别长的工程"
  const back = settingsBack({ name })
  expect(Array.from(back.label).length).toBeLessThan(24)
  expect(back.label).toContain("…")
  expect(back.said).toContain(name)
})

test("选了还没生效：说「你选了」和还差哪一步；真正生效了才说「现在用的是」", () => {
  expect(connectionLine({ saved: "api", picked: "api" })).toEqual({ pending: false, text: "现在用的是：Studio 自己调用 AI" })
  expect(connectionLine({ saved: "mcp", picked: "mcp" })).toEqual({ pending: false, text: "现在用的是：我自己的 AI 助手" })
  const chosen = connectionLine({ saved: "api", picked: "mcp" })
  expect(chosen.pending).toBe(true)
  expect(chosen.text).toBe("你选了：我自己的 AI 助手（还差一步：把起步说明复制给它）")
  expect(chosen.text).not.toContain("现在用的是")
  const back = connectionLine({ saved: "mcp", picked: "api" })
  expect(back.text).toBe("你选了：Studio 自己调用 AI（还差几步：填好密钥并验证）")
  expect(back.text).not.toContain("现在用的是")
})

test("选「用自己的 AI 助手」那一步：一句白话说清要做什么，不出现看不懂的词，也不写产品连不上的助手", () => {
  const note = MODE_WORDS.mcp.note
  expect(note).toContain("粘贴一段说明")
  expect(note).toContain("不用密钥")
  expect(note).toContain("Claude 桌面版")
  expect(note).toContain("Codex")
  for (const jargon of ["MCP", "连接器", "stdio", "JSON"]) expect(note).not.toContain(jargon)
  // Studio only starts a program on this computer; ChatGPT can only reach services on the internet. It is said so, not listed as a way.
  expect(MODE_WORDS.mcp.name).not.toContain("ChatGPT")
  expect(note).toMatch(/ChatGPT[^；。]*连不上/)
  expect(note).toMatch(/额度/)
})

test("打开审查的地方先说清：开着要再开一个 AI 对话当审查员，不想开可以关，关了由做东西的 AI 自己检查、可信度低一些", () => {
  expect(REVIEW_OUTSIDE.on).toContain("再开一个 AI 对话")
  expect(REVIEW_OUTSIDE.on).toContain("审查员")
  expect(REVIEW_OUTSIDE.on).toContain("关掉")
  expect(REVIEW_OUTSIDE.on).toContain("自己检查")
  expect(REVIEW_OUTSIDE.on).toContain("可信度")
  expect(REVIEW_OUTSIDE.off).toContain("只需要一份说明")
  expect(REVIEW_OUTSIDE.off).toContain("可信度")
  // The second copy still goes to a conversation of its own (the reviewer is never the one that made the thing), in the same assistant: it needs no second connection.
  expect(REVIEW_OUTSIDE.card).toContain("同一个 AI 助手里再新开一个对话")
  expect(REVIEW_OUTSIDE.card).toContain("不用再接一次")
  expect(REVIEW_OUTSIDE.card).toContain("不改任何东西")
  for (const text of Object.values(REVIEW_OUTSIDE)) {
    for (const jargon of ["MCP", "await_inspection", "next_inspection", "final_review"]) expect(text).not.toContain(jargon)
  }
})

test("交接说明：服务器总说明里别处已经写全的部分不再抄第二遍，服务器自己发的总说明不变", () => {
  const maker = buildMcpHandoff({ configuration, project, review: true })
  const read = everythingToRead({ configuration, project, review: true })
  const count = (part: string) => read.split(part).length - 1
  // The connection still sends the whole of it, as before.
  expect(MCP_SERVER_INSTRUCTIONS.startsWith(PLAIN_TALK)).toBe(true)
  expect(maker).not.toContain(MCP_SERVER_INSTRUCTIONS)
  expect(read).not.toContain(MCP_SERVER_INSTRUCTIONS)
  // How to talk to the person is said once, in the text the person copies; so is each of the long flows the topics carry.
  expect(count(PLAIN_TALK)).toBe(1)
  expect(count("next_batch、claim_task 和 commit_task 的返回里有 parallel")).toBe(2)
  // What only the server text says is still there to read, under the topics of get_guide.
  expect(read).toContain("资产关系图流程：build_import_asset_graph")
  expect(read).toContain("整合包资产流程：先get_import_asset_selection")
  expect(read).toContain("MineMods Studio 外部模型控制器。")
  expect(read).toContain("通用逆向使用 prepare_reverse_project")
  // The sections that carry the same flows are the only place they stand.
  expect(count("用户用一句话描述整个模组时走蓝图")).toBe(0)
  expect(count("开工前先调用 get_capabilities 核对运行中 Studio 的协议版本")).toBe(0)
})

test("交接说明：审查仍然必须在另一个独立的对话里做，两份说明都不泄漏规则名", () => {
  const maker = buildMcpHandoff({ configuration, project, review: true })
  const reviewer = buildMcpReviewHandoff({ configuration, project })
  expect(leaked(everythingToRead({ configuration, project, review: true }))).toEqual([])
  expect(leaked(reviewer)).toEqual([])
  // The maker is told to wait for the other window and never to judge itself; the reviewer is told it took no part in the making and may change nothing.
  expect(maker).toContain("验收由另一个窗口里的审查 AI 负责")
  expect(maker).toContain("不要自己调用 `final_review` 写结论，也不要另开子代理充当评审")
  expect(reviewer).toContain("没有参与制作")
  expect(reviewer).toContain("另一个窗口里有一个 AI 在做东西")
  expect(reviewer).toContain("不领任务、不改任何东西、不提交、不打包")
  expect(reviewer).toContain("必须是另一个窗口（新的会话）")
  // Switched off, nobody else is asked for: the maker checks its own work and says so truthfully.
  const solo = buildMcpHandoff({ configuration, project, review: false })
  expect(solo).toContain("核对和验收都由你自己做")
  expect(solo).toContain("不要对用户说“已经请评审看过”")
  expect(leaked(everythingToRead({ configuration, project, review: false }))).toEqual([])
})
