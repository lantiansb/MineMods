import { buildFailureWords } from "../src/renderer/features/build-failure-words"
import { codedWords } from "@minemods/mod-core/coded-errors"
import { expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { ConceptionEntrySchema, ConceptionSchema } from "@minemods/mod-core/conception"
import { MODULES } from "@minemods/mod-core/workspace-modules"
import { legacyConception, storesOnOpen } from "../src/renderer/features/project-navigation-model"
import { MODE_WORDS, MODEL_ROLE_WORDS, WORDS } from "../src/renderer/words"
import { NO_AI_WORDS } from "../src/renderer/features/asset-edit-words"

const renderer = path.join(import.meta.dir, "../src/renderer")
// The screens the word table was applied to. Lines that are comments are not shown to anybody and are left out.
const screens = [
  "studio-app.tsx",
  "play-chain.ts",
  "release-form.tsx",
  "release-words.ts",
  "mod-info-model.ts",
  "confirm-dialog.tsx",
  "connection-chip.ts",
  "features/production-words.ts",
  "features/review-wait.tsx",
  ...readdirSync(path.join(renderer, "features"))
    .filter((name) => /^(project-(navigation|conception|ideas|playable|assets)|content-brief|mod-guide|mod-info|english-name|finding-go|creation-steps|model-workspace|model-complexity|resource-manager|import-(backpack|project-workspace)|external-workbench|making-floor-thing|asset-making|connection-settings|personal-settings)\.tsx$/.test(name))
    .map((name) => `features/${name}`),
]
const shown = (file: string) =>
  readFileSync(path.join(renderer, file), "utf8")
    .split("\n")
    .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
    .filter((row) => !/^(\/\/|\/\*|\*|\{\/\*)/.test(row.text))

test("一个东西只有一个叫法：这些屏幕上不再出现同一件事的别的名字", () => {
  // Each is a second name the audit found for something the table already names.
  const retired = ["项目", "作品", "工程指令", "模块任务", "制作要求", "模型描述", "构建模组", "JAR 已生成", "评审", "审阅", "核对", "机器对账", "质量检查", "校验中", "任务记录", "制作事件", "设计草稿", "工作室设置", "模型连接设置", "连接模型", "在这里制作 API", "使用外部模型 MCP", "路由模型", "资产模型", "资产"]
  // The guide's own section title is read from the build's text to leave that section out; it is never drawn.
  const allowed = (text: string) => text.includes('section.title !== "机器对账发现的问题"')
  const found = screens.flatMap(shown).flatMap((row) => retired.filter((word) => row.text.includes(word) && !allowed(row.text)).map((word) => `${row.file}:${row.line} ${word}`))
  expect(found).toEqual([])
  expect(screens.length).toBeGreaterThan(20)
})

test("词表：工程是做的地方，模组是做出来的；动作是片段，种类的名字仍然跟着登记表", () => {
  expect([WORDS.project, WORDS.mod, WORDS.thing, WORDS.things(3)]).toEqual(["工程", "模组", "东西", "3 样东西"])
  expect([WORDS.pack, WORDS.packed, WORDS.play, WORDS.into_mod, WORDS.see, WORDS.scene]).toEqual(["打包", "打包好了", "构建并试玩", "做进模组", "进游戏看", "测试场"])
  expect([WORDS.accept, WORDS.review, WORDS.check, WORDS.floor, WORDS.feed]).toEqual(["验收", "审查", "检查", "制作现场", "动态"])
  expect([WORDS.settings, WORDS.connect, WORDS.legacy]).toEqual(["个人设置", "连接 AI", "旧的构想（不会进游戏）"])
  // The clip is a 动作; the asset kind keeps the label every other screen reads from the registry.
  expect(WORDS.motion).toBe("动作")
  expect(MODULES.animation.label).toBe("动画")
})

test("连接 AI 的两种做法说的是谁来做、适合谁、要花什么，不拿接法当名字", () => {
  expect(MODE_WORDS.api.name).toBe("让 Studio 自己调用 AI（要先开通一个 AI 账号）")
  expect(MODE_WORDS.mcp.name).toBe("用我自己的 AI 助手来做（Claude 桌面版、Codex 这类）")
  for (const mode of [MODE_WORDS.api, MODE_WORDS.mcp]) {
    expect(mode.note).toContain("适合")
    expect(mode.note).toMatch(/付费|额度/)
  }
  expect([MODEL_ROLE_WORDS.router.name, MODEL_ROLE_WORDS.maker.name]).toEqual(["分工用的小模型", "做东西用的模型"])
  expect(MODEL_ROLE_WORDS.router.note && MODEL_ROLE_WORDS.maker.note).toBeTruthy()
})

test("旧的构想：只有工程里真有那条路写下的东西才算；生物自己的那条记录不算", () => {
  const entry = (more: Record<string, unknown>) => ConceptionEntrySchema.parse({ id: crypto.randomUUID(), title: "月鹿", brief: "一只鹿", ...more })
  const conception = (more: Record<string, unknown>) => ConceptionSchema.parse(more)
  // A new project, and one whose creature was merely opened (which stores its entry), have nothing of the old route.
  expect(legacyConception(conception({}))).toBe(false)
  expect(legacyConception(conception({ brief: "   " }))).toBe(false)
  expect(legacyConception(conception({ entries: [entry({ kind: "entity", entity_id: crypto.randomUUID(), model_confirmed_asset_id: null })] }))).toBe(false)
  // Anything only the old route writes keeps its way in, so nothing saved becomes unreachable.
  expect(legacyConception(conception({ brief: "会呼吸的月光森林" }))).toBe(true)
  expect(legacyConception(conception({ plan: "先做鹿" }))).toBe(true)
  expect(legacyConception(conception({ review: { name: "月雾", worldview: "", entries: [], questions: [] } }))).toBe(true)
  expect(legacyConception(conception({ entries: [entry({ kind: "item" })] }))).toBe(true)
  expect(legacyConception(conception({ entries: [entry({ kind: "entity", behavior_brief: "夜里跟着玩家" })] }))).toBe(true)
  expect(legacyConception(conception({ entries: [entry({ kind: "entity", review: { summary: "整理过", sections: [], questions: [] } })] }))).toBe(true)
})

test("左边一栏不再有「模组构想」：旧的那一条只在说了要有的时候出现，放在最后", () => {
  const navigation = readFileSync(path.join(renderer, "features/project-navigation.tsx"), "utf8")
  expect(navigation).not.toContain("模组构想\n")
  expect(navigation).toContain("<Show when={props.legacy}>")
  expect(navigation.indexOf("<Show when={props.legacy}>")).toBeGreaterThan(navigation.indexOf("<For each={nonemptyGroups(groups, rowsOf)}>"))
  const app = readFileSync(path.join(renderer, "studio-app.tsx"), "utf8")
  // Shown only under 高级, with Studio's own AI, to a project that has something there.
  expect(app).toContain("const legacyShown = () => !!view() && !external() && advanced() && legacyConception(current().project.conception)")
  expect(app).toContain("legacy={legacyShown()}")
})

test("没连 AI 时能做什么，只有一句，说的是真能做的那几样", () => {
  expect(NO_AI_WORDS).toBe("不连接也能自己做：方块、物品、配方和书可以填表做出来，生物的模型和动作可以手动做。")
  const app = readFileSync(path.join(renderer, "studio-app.tsx"), "utf8")
  expect(app).toContain("<span>AI 还没连接。{NO_AI_WORDS}{WORDS.connect} 后，{WORDS.say}就能让它做。</span>")
  expect(app).not.toContain("别的东西要连接 AI 才能做")
})

test("首页还没有工程时只有一个新建入口；总览上的「模型精细度」等「高级」", () => {
  const app = readFileSync(path.join(renderer, "studio-app.tsx"), "utf8")
  expect(app).not.toContain("从第一个工程开始")
  expect(app.indexOf("<Show when={entries().length}>")).toBeLessThan(app.indexOf('<div class="projects-toolbar">'))
  expect(app).toContain('(external() && advanced() && page() === "overview")')
  expect(app).not.toContain("模型复杂度")
  expect(readFileSync(path.join(renderer, "features/model-complexity.tsx"), "utf8")).not.toContain("复杂度")
})

test("制作现场：状态和按钮自己占一行，不盖在画面上", () => {
  const css = readFileSync(path.join(renderer, "features/external-workbench.css"), "utf8") + readFileSync(path.join(renderer, "features/making-floor.css"), "utf8")
  for (const name of ["external-caption", "external-stage-actions"]) expect(css).not.toMatch(new RegExp(`\\.${name} \\{[^}]*position: absolute`))
  const floor = readFileSync(path.join(renderer, "features/external-workbench.tsx"), "utf8")
  expect(floor.indexOf('class="external-stage-head"')).toBeLessThan(floor.indexOf('class="external-caption"'))
})

// broad16 b37–b42: opening a creature to look at its model stored a bookmark entry, which saved the project (revision + 1): the pack went stale
// and creature content that is built only "as the project is now" fell from 已做进模组 to 做好了 with nothing changed by the person.
test("打开生物的模型页只是看：不先存一条记录（存了工程就多一个版本，已打包的东西会退回去）", () => {
  expect(storesOnOpen({ kind: "entity", entity_id: crypto.randomUUID() })).toBe(false)
  // The pages that edit an entry still need it stored first.
  expect(storesOnOpen({ kind: "entity", entity_id: null })).toBe(true)
  expect(storesOnOpen({ kind: "item", entity_id: null })).toBe(true)
  expect(storesOnOpen({ kind: "block", entity_id: null })).toBe(true)
})

test("打包失败用词表解释已知问题，保留创作者写的标题", () => {
  const name = "巢穴特效"
  const message = codedWords("ENTITY_EFFECT_MISSING:11111111-1111-4111-8111-111111111111", () => ({ kind: "entity", name }))!.text
  expect(buildFailureWords(message)).toStartWith("「巢穴特效」的招式用到一个效果")
  expect(buildFailureWords("「巢穴特效」的位置是我自己写的")).toBe("「巢穴特效」的位置是我自己写的")
})
