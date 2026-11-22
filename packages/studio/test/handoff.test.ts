import { ASSET_STANDARDS, CRITERIA, EXCUSES, REFUSAL_CAP, SEVERITIES, STANDARD_SUMMARY, standardBrief } from "@minemods/mod-core/acceptance"
import { leaked } from "../../mod-core/test/fixtures/acceptance/names"
import { expect, test } from "bun:test"
import { DETAIL_WORDS } from "@minemods/mod-core/creature-tier"
import { getMcpCapabilities } from "../src/main/mcp-capabilities"
import { buildMcpHandoff } from "../src/main/mcp-handoff"
import { everythingToRead } from "./handoff-reading"
import { StudioRequestSchema } from "../src/main/protocol"
import { RoutePlanSchema, validateRoutePlan } from "../src/project-runs"

const configuration = `{
  "mcpServers": {
    "minemods-studio": {
      "command": "C:\\\\Program Files\\\\MineMods Studio\\\\electron.exe",
      "args": ["C:\\\\MineMods Studio\\\\mcp-stdio.js", "--connection", "C:\\\\Users\\\\alice\\\\AI's Projects\\\\connection.json"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    },
    "other-server": { "command": "other", "args": [] }
  }
}`

const toolNames = [
  "get_six_view_prompt",
  "finish_six_view",
  "view_reference",
  "get_capabilities",
  "list_projects",
  "open_project",
  "create_project",
  "module_schema",
  "plan_run",
  "claim_task",
  "update_task",
  "commit_task",
  "fail_task",
  "get_run",
  "get_progress",
  "cancel_run",
  "build_project",
  "get_build",
  "inspect_model",
]

test("六视图说明要求外部 AI 核验绘图能力并自动回传真实图片", () => {
  const handoff = everythingToRead({ configuration })
  const capabilities = getMcpCapabilities("medium")
  expect(capabilities.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["get_six_view_prompt", "finish_six_view"]))
  expect(capabilities.making.references.three_view).toMatchObject({ prompt_tool: "get_six_view_prompt", finish_tool: "finish_six_view" })
  // A 六视图 shrunk onto the reference sheet is read up close, region by region.
  expect(capabilities.making.references.zoom).toMatchObject({ tool: "view_reference", longest_side: 1024 })
  expect(capabilities.tools.find((tool) => tool.name === "view_reference")?.input_contract).toContain("region?: { x, y, width, height, unit?: 'fraction' | 'pixels' }")
  expect(handoff).toContain("当前会话里实际可用的绘图工具")
  expect(handoff).toContain("Studio 会自动加入该资产")
  expect(handoff).toContain("需要独立准备六视图")
  expect(handoff).toContain("不得伪造图片")
  expect(handoff).toContain("现有用户自己给的六视图不会被覆盖")
  expect(handoff).not.toContain("只有人能放、能换，没有交它的工具")
  expect(JSON.stringify(capabilities)).not.toContain("外部 AI 不能交、也不能换")
  expect(handoff).not.toContain("制作者不交、也不换")
  expect(JSON.stringify(capabilities.tools)).not.toContain("data:image/png|jpeg|webp")
  expect(capabilities.tools.find((tool) => tool.name === "finish_six_view")?.input_contract).toContain("data:image/png;base64,")
})

test("生成完整 MCP 开发交接，保留原始 JSON 并输出可解析 Codex TOML", () => {
  const handoff = buildMcpHandoff({
    configuration,
    project: { id: "project-1", name: "含空格与单引号的工程", revision: 7 },
  })
  expect(JSON.parse(configuration).mcpServers["minemods-studio"].args[2]).toContain("AI's Projects")
  expect(handoff).toContain(configuration)
  expect(handoff).not.toContain("&quot;")
  expect(handoff).not.toContain("&#39;")
  expect(handoff).not.toContain("\\\\\\\\")
  expect(handoff).toContain("含空格与单引号的工程")
  expect(handoff).toContain("project-1")
  expect(handoff).toContain('"revision": 7')

  const toml = handoff.match(/```toml\n([\s\S]*?)\n```/)?.[1]
  expect(toml).toBeTruthy()
  const parsed = Bun.TOML.parse(toml!) as {
    mcp_servers: {
      "minemods-studio": {
        command: string
        args: string[]
        env: { ELECTRON_RUN_AS_NODE: string }
      }
    }
  }
  expect(parsed.mcp_servers["minemods-studio"].command).toBe("C:\\Program Files\\MineMods Studio\\electron.exe")
  expect(parsed.mcp_servers["minemods-studio"].args).toEqual([
    "C:\\MineMods Studio\\mcp-stdio.js",
    "--connection",
    "C:\\Users\\alice\\AI's Projects\\connection.json",
  ])
  expect(parsed.mcp_servers["minemods-studio"].env.ELECTRON_RUN_AS_NODE).toBe("1")
})

test("配置和工程数据中的反引号、§与模板字面量保持原样", () => {
  const trickyConfiguration = JSON.stringify(
    {
      mcpServers: {
        "minemods-studio": {
          command: "C:\\Program Files\\Mine`§ Studio\\electron.exe",
          args: ["C:\\Users\\alice\\${tick}\\mcp-stdio.js"],
          env: { ELECTRON_RUN_AS_NODE: "1" },
        },
      },
    },
    null,
    2,
  )
  const handoff = buildMcpHandoff({
    configuration: trickyConfiguration,
    project: { id: "project-2", name: "世界`§\n草稿", revision: 2 },
  })
  expect(JSON.parse(trickyConfiguration)).toBeTruthy()
  expect(handoff).toContain(trickyConfiguration)
  expect(handoff).toContain("Mine`§ Studio")
  expect(handoff).toContain("${tick}")
  expect(handoff).toContain('"name": "世界`§\\n草稿"')
  const toml = handoff.match(/```toml\n([\s\S]*?)\n```/)?.[1]
  expect(toml).toBeTruthy()
  expect(
    (Bun.TOML.parse(toml!) as { mcp_servers: Record<string, { command: string }> }).mcp_servers["minemods-studio"]
      .command,
  ).toBe("C:\\Program Files\\Mine`§ Studio\\electron.exe")
})

test("交接覆盖 stdio 的十六个工具、顺序和安全边界", () => {
  const handoff = everythingToRead({ configuration })
  toolNames.forEach((name) => expect(handoff).toContain(`\`${name}\``))
  expect(handoff).toContain("最多 3 个并行任务")
  expect(handoff).toContain("严格 RoutePlan")
  expect(handoff).toContain("source 必须逐字来自原始需求")
  expect(handoff).toContain("动画、世界观、群系、维度、地形属于 design 设计能力")
  // Twenty with the ability asset (技能资产). Nineteen since the sound (任务二 §9), particle (Boss 能力 11), boss bar (Boss 能力 6) and arena fixture (Boss 能力 12) kinds were added; the heading is counted from the registry.
  // Twenty-two with the book (书).
  expect(handoff).toContain("## 22 个模块职责")
  expect(handoff).toContain("| book | runtime | 一本开局就送给玩家的书")
  expect(handoff).toContain("| particle | runtime | 模组自己的粒子")
  expect(handoff).toContain("| gesture | runtime | 施法动作")
  // Neither way of writing a cast action is the default: built-in base motions are a tool, not a recipe.
  expect(handoff).toContain("做施法动作有两种写法，没有默认的那一种")
  expect(handoff).not.toMatch(/默认写 `base`|不要自己写轨道/)
  expect(handoff).toContain("提交时按验收标准（acceptance 一节）检查最终动作")
  expect(handoff).toContain("自己只能按键播放；技能（ability）可以绑在它的键上，或者在放技能时播它")
  expect(handoff).toContain("是否正常还没有验证")
  expect(handoff).toContain("| animation | design |")
  expect(handoff).toContain("| entity | runtime | 生物实体属性")
  expect(handoff).not.toContain("| animation | runtime |")
  expect(handoff).toContain("tasks 最多 12 项")
  expect(handoff).toContain("无需 API key")
  expect(handoff).toContain("无需另装 Node")
  expect(handoff).toContain("Java 21、17 由 Studio 构建管理")
  expect(handoff).toContain("当前 MCP 提供 `build_project`、`get_build` 和只读 `inspect_model`")
  expect(handoff).toContain("model` → `texture`（各 model 完成后，多个 texture 任务可并行）→ `entity`")
  expect(handoff).toContain("每批最多 12 个任务、最多 3 个并行任务")
  expect(handoff).toContain("8 个变体")
  expect(handoff).toContain("每个变体必须有独立 model 依赖")
  expect(handoff).toContain("不要伪造同模块 target_id")
  expect(handoff).toContain("先调用 `list_projects`")
  expect(handoff).toContain("保留其他 MCP server 和原有设置")
  expect(handoff).toContain("不要在验证前声称已连接")
  expect(handoff).toContain("contract_fingerprint")
  expect(handoff).toContain("重新连接前不要开始写入任务")
  expect(handoff).toContain("协议版本不是 1 时停止写入")
})

test("交接说明构建工具只接受 UUID 且返回异步 job 与 jar 结果", () => {
  const handoff = everythingToRead({ configuration })
  expect(handoff).toContain("`build_project` 的参数为 `{ projectId: UUID }`")
  expect(handoff).toContain("`get_build` 的参数为 `{ projectId: UUID, jobId: UUID }`")
  expect(handoff).toContain("`inspect_model` 的参数为 `{ projectId: UUID, modelAssetId: UUID }`")
  expect(handoff).toContain("MCP 不提供任意路径导出，不弹出导出对话框")
  expect(handoff).toContain("output 含 jarPath、sha256")
})

test("没有当前工程时不伪造工程上下文", () => {
  const handoff = buildMcpHandoff({ configuration })
  expect(handoff).toContain("当前工程：未指定")
  expect(handoff).not.toContain("revision=")
})

test("交接说明模型分阶段预览、结构审查与可重试修订", () => {
  const handoff = everythingToRead({ configuration })
  // One standard for every module, generated from the definitions that judge the hand-in: its criteria by name, where to read the per-kind rules, and how a refusal reads.
  expect(handoff).toContain("## 验收标准（所有模块同一套）")
  CRITERIA.forEach((value, index) => expect(handoff).toContain(`${index + 1}. ${value.name}：${value.meaning}常见的毛病：${value.examples}改法：${value.fix}`))
  expect(handoff).toContain(STANDARD_SUMMARY)
  expect(handoff).toContain("acceptance.kinds")
  expect(handoff).toContain("quality.standard")
  expect(handoff).toContain("drafts[taskId].quality")
  expect(handoff).toContain("没通过验收")
  // The two weights and the only excuses are the standard's own words, not a second copy.
  Object.values(SEVERITIES).forEach((value) => expect(handoff).toContain(`“${value.label}”——${value.meaning.replace(/。$/, "")}`))
  Object.values(EXCUSES).forEach((value) => expect(handoff).toContain(value.label))
  expect(handoff).toContain("只认用户的原话")
  // Model and texture rules appear once, as the standard's brief for the kind; nothing is retold by hand.
  expect(handoff).toContain(standardBrief(ASSET_STANDARDS.model))
  expect(handoff).toContain(`撞上“${CRITERIA[0].name}”这一条（${CRITERIA[0].examples.replace(/。$/, "")}）`)
  expect(handoff).not.toMatch(/每个方块贴同一条细节反而会被退回|measured 是背后的数字/)
  // No rule's name and no measurement's name anywhere in what is handed over.
  expect(leaked(handoff)).toEqual([])
  expect(handoff).toContain("原工程资产未被覆盖")
  expect(handoff).toContain("不要立即 fail_task")
  expect(handoff).toContain("每一版都用 `look` 看过再改")
  expect(handoff).toContain("不数方块")
  expect(handoff).toContain("单独的 texture 任务是贴到它依赖的模型上去验收的")
  expect(handoff).not.toMatch(/model_quality\.issues|texture_quality|外观检查/)
  expect(handoff).toContain(`最多被退回 ${REFUSAL_CAP} 次`)
  // The painting syntax is handed over as a skeleton of placeholders only (OnlyLLM, 10-14): a way of writing, with no subject in it to copy.
  expect(handoff).toContain("只示范 JSON 的形状")
  expect(handoff).toContain('"type":"<feature>"')
  expect(handoff).not.toContain('"material":"stone"')
})

test("MCP 交接按按钮档位注入要求，并保留运行时档位说明", () => {
  for (const [complexity, label, minimum] of [
    ["low", "低", 3],
    ["medium", "中", 4],
    ["high", "高", 5],
  ] as const) {
    const handoff = everythingToRead({ configuration, complexity })
    expect(handoff).toContain(`复杂度档位：${label}（${complexity}）`)
    expect(handoff).toContain(`至少 ${minimum} 个看得见的体块`)
    expect(handoff).toContain("以 claim_task 返回的 quality.complexity 和 instructions 为准")
  }
  expect(everythingToRead({ configuration })).toContain("复杂度档位：中（medium）")
})

// broad20: the button's level here is the button's own; a creature's tier may raise its model, and the outside AI is told how the one range is arrived at.
test("MCP 交接和能力清单说明：生物档位只抬高这个生物自己模型的精细度，实际的范围看任务的 instructions", () => {
  const handoff = everythingToRead({ configuration, complexity: "low" })
  expect(handoff).toContain(DETAIL_WORDS.told)
  expect(DETAIL_WORDS.told).toContain("只抬不压")
  expect(DETAIL_WORDS.told).toContain("instructions")
  expect(getMcpCapabilities("low").model_quality).toMatchObject({ complexity: "low", creature_tier_may_raise: DETAIL_WORDS.told })
  // The per-tier list in the capabilities still shows each tier's own level, from the same table.
  expect(getMcpCapabilities("low").creature_tiers.tiers.boss.model_complexity).toBe("high")
})

test("交接中的计划示例通过实际路由 schema 与来源、依赖门禁", () => {
  const plans = [...everythingToRead({ configuration }).matchAll(/```json\n([\s\S]*?)\n```/g)]
    .map((match) => RoutePlanSchema.safeParse(JSON.parse(match[1]!)))
    .filter((result) => result.success)
  expect(plans).toHaveLength(1)
  expect(validateRoutePlan(plans[0]!.data!, { prompt: "创建世界观，再创建核心方块", assets: [] }).tasks).toHaveLength(2)
})

test("交接 IPC 仅接受可选工程 UUID，拒绝任意路径与额外内容", () => {
  for (const method of ["getMcpHandoff", "copyMcpHandoff"]) {
    expect(StudioRequestSchema.safeParse({ method, input: {} }).success).toBe(true)
    expect(
      StudioRequestSchema.safeParse({ method, input: { projectId: "842db5af-c5b8-4e6b-87f3-9cd104fe7af3" } }).success,
    ).toBe(true)
    expect(StudioRequestSchema.safeParse({ method, input: { projectId: "C:/private/project" } }).success).toBe(false)
    expect(StudioRequestSchema.safeParse({ method, input: { configuration: "untrusted" } }).success).toBe(false)
  }
})

test("工程请求通过专用交接入口复制，普通文本长度限制仍保留", () => {
  const request = "请按我选的做法出蓝图"
  expect(StudioRequestSchema.safeParse({ method: "copyMcpHandoff", input: { request } }).success).toBe(true)
  expect(StudioRequestSchema.safeParse({ method: "getMcpHandoff", input: { request } }).success).toBe(false)
  expect(StudioRequestSchema.safeParse({ method: "copyMcpHandoff", input: { request: "x".repeat(20_001) } }).success).toBe(false)
  expect(StudioRequestSchema.safeParse({ method: "copyText", input: { text: "x".repeat(20_001) } }).success).toBe(false)
})
