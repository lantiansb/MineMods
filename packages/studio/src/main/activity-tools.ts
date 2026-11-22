import type { ActivityInput } from "@minemods/mod-core/activity"
import { taskItem } from "@minemods/mod-core/activity"
import { forPerson, refusalForPerson, withheldWords } from "@minemods/mod-core/refusal-words"
import type { ExternalBridgeMethod } from "../external"
import type { ProjectRun } from "../project-runs"
import { isAssetAction } from "./mcp-asset-actions"

const ASSET_WORDS = {
  rename_asset: "来给工程里的内容改名",
  duplicate_asset: "来复制工程里的内容",
  delete_asset: "来删除工程里的内容",
  restore_deleted_asset: "来撤销删除",
} as const

/**
 * Every call an outside AI makes through the bridge, in plain words, so the person sees it working although
 * the model runs somewhere else. `echo` marks a call whose effect is already reported as its own event (a
 * task that starts, a version looked at): that call is kept for 高级 and as a sign of life, not shown twice.
 * A call that names no project (reading a schema, listing projects) belongs to none and is not recorded.
 */
type Said = { tool: string; echo: boolean; words: (about: { title: string | null; input: Record<string, unknown>; result: Record<string, unknown> | null; /** 「审查」 as the person has it switched: off means nobody but the AI itself reads what it made. */ review: boolean }) => string }

const thing = (title: string | null) => (title ? `「${title}」` : "这一样")
const TOOLS: Partial<Record<ExternalBridgeMethod, Said>> = {
  listAudioInbox: {tool:"list_audio_inbox",echo:false,words:()=>"看了看工程收件箱。"},
  extractAbility: { tool: "extract_ability", echo: true, words: () => "把生物的一招存成了技能。" },
  // An import that is written says so itself (`importActivity`); a list asked for is only that.
  importFromProject: { tool: "import_from_project", echo: true, words: (about) => (about.result?.written ? "从别的工程导入了东西。" : "列了一份从别的工程导入的清单，等你同意。") },
  undoProjectImport: { tool: "undo_project_import", echo: true, words: () => "撤销了一次从别的工程的导入。" },
  mergeDuplicateAssets: { tool: "merge_duplicate_assets", echo: true, words: (about) => (about.result?.written ? "合并了以前导入留下的重复件。" : "列了一份以前导入留下的重复件，等你确认。") },
  undoAssetMerge: { tool: "undo_merge_duplicate_assets", echo: true, words: () => "撤销了一次重复件合并。" },
  importAudioInbox: {tool:"import_audio_inbox",echo:true,words:()=>"从收件箱导入了音频。"},
  openProject: { tool: "open_project", echo: false, words: () => "打开这个模组看了看。" },
  getBlueprint: { tool: "get_blueprint", echo: false, words: () => "读了蓝图，看每样东西做到哪一步了。" },
  proposeBlueprint: { tool: "propose_blueprint", echo: true, words: () => "交了一份蓝图草稿。" },
  proposeIdeas: { tool: "propose_ideas", echo: true, words: () => "出了一组想法卡片。" },
  getIdeas: { tool: "get_ideas", echo: false, words: () => "来看你选了哪些想法。" },
  nextBatch: { tool: "next_batch", echo: true, words: (about) => (about.result?.run ? "领了下一批要做的东西。" : "来领下一批，现在没有可以开始的。") },
  startExternal: { tool: "plan_run", echo: true, words: () => "交了一份小计划。" },
  claimExternalTask: { tool: "claim_task", echo: true, words: (about) => `接下了${thing(about.title)}。` },
  updateExternalTask: { tool: "update_task", echo: true, words: (about) => (about.input.draft === undefined ? `报告了${thing(about.title)}的进度。` : `交了一版${thing(about.title)}的草稿。`) },
  describeExternalTask: { tool: "save_sheet", echo: true, words: (about) => `写了${thing(about.title)}的部件说明。` },
  // Reference views it drew itself (Engineer A): nothing else reports these, so the call is the event.
  conceptExternalTask: {
    tool: "save_concepts",
    echo: false,
    words: (about) => (Array.isArray(about.input.views) && !about.input.views.length ? `拿掉了自己给${thing(about.title)}画的参考图。` : `给${thing(about.title)}画了${Array.isArray(about.input.views) ? ` ${about.input.views.length} 张` : "几张"}参考图。`),
  },
  // A version may come as a document or as a script that builds it; either way it was made and looked at.
  lookExternalTask: {
    tool: "look",
    echo: true,
    words: (about) => (about.input.glance === true ? `边做边看了一眼${thing(about.title)}。` : `${about.input.script === undefined ? "" : "用脚本搭了一版，"}看了一眼${thing(about.title)}${typeof about.result?.round === "number" ? `的第 ${about.result.round} 版` : ""}。`),
  },
  // Read-only and asked again and again while it reads one picture region by region: kept quiet, for 高级 and as a sign of life.
  viewReferenceExternalTask: {
    tool: "view_reference",
    echo: true,
    words: (about) => {
      const number = (about.result?.reference as { number?: unknown } | undefined)?.number ?? about.input.reference
      return `放大看了${thing(about.title)}的${typeof number === "number" ? `第 ${number} 张` : ""}参考图${about.input.region ? "的一块" : ""}。`
    },
  },
  selfReviewExternalTask: { tool: "self_review", echo: true, words: (about) => `给${thing(about.title)}写了自评。` },
  finalReviewExternalTask: {
    tool: "final_review",
    echo: false,
    // Round 17, 盲认: the two steps of a blind naming are said as what they are, not as fetching the material.
    words: (about) => (about.input.blind ? `记下了评审只凭图认出的${thing(about.title)}是什么（盲认）。` : about.result?.blind_first ? `把${thing(about.title)}的图单独交给评审，先认一认是什么（盲认）。` : about.input.verdict && !(about.input.verdict as { need?: unknown[] }).need?.length ? (about.review ? `记下了评审对${thing(about.title)}的结论。` : `记下了 AI 自己对${thing(about.title)}的审查结论（审查关着，没有别的评审）。`) : about.input.need || about.input.verdict ? (about.review ? `替评审多要了几张${thing(about.title)}的图。` : `多要了几张${thing(about.title)}的图，自己再看。`) : about.review ? `取了${thing(about.title)}的审查材料，去请评审看。` : `取了${thing(about.title)}的审查材料，AI 自己对着核对（审查关着，不另请评审）。`),
  },
  // Gameplay (Engineer D): the check reports its own result as a `check` event, so the call itself is kept for 高级.
  getModGuide: { tool: "get_mod_guide", echo: false, words: () => "读了模组说明书和机器对账的结果。" },
  // A check that takes long is asked after again and again; those calls read as asking, and the minute-by-minute line comes from the check itself.
  checkCodeExternalTask: { tool: "check_code", echo: true, words: (about) => (about.result?.finished === false ? `来问${thing(about.title)}的代码检查完了没有，还在检查。` : `让 Studio 检查了${thing(about.title)}的代码。`) },
  commitExternalTask: { tool: "commit_task", echo: true, words: (about) => `提交了${thing(about.title)}。` },
  failExternalTask: { tool: "fail_task", echo: true, words: (about) => `说${thing(about.title)}做不下去了。` },
  getExternalRun: { tool: "get_run", echo: true, words: () => "看了看这一批的进度。" },
  getExternalProgress: { tool: "get_progress", echo: true, words: () => "看了看这一批的进度。" },
  cancelExternalRun: { tool: "cancel_run", echo: true, words: () => "取消了这一批。" },
  buildProject: { tool: "build_project", echo: true, words: () => "让 Studio 开始打包模组。" },
  getBuild: { tool: "get_build", echo: true, words: () => "看了看打包的进度。" },
  checkScene: { tool: "check_scene", echo: true, words: () => "让 Studio 在测试场里做一次后台检查。" },
  getSceneCheck: { tool: "get_scene_check", echo: true, words: () => "看了看测试场检查的进度。" },
  // 工具资产: running a tool is the event; reading the list and the run's progress are signs of life.
  listTools: { tool: "list_tools", echo: true, words: () => "看了看 Studio 里现在能用哪些工具。" },
  runTool: { tool: "run_tool", echo: false, words: (about) => `让 Studio 用工具「${String(about.input.tool ?? "")}」做一样东西。` },
  getToolRun: { tool: "get_tool_run", echo: true, words: () => "看了看工具做到哪了。" },
  finishToolRun: { tool: "finish_tool_run", echo: false, words: (about) => (about.input.unsupported ? "说它自己生成不了这样东西。" : "把自己生成的东西交给了 Studio。") },
  inspectModel: { tool: "inspect_model", echo: false, words: () => "检查了一个做好的模型。" },
  exportModel: { tool: "export_model", echo: false, words: () => "把一个模型导出成游戏用的文件，放进了工程文件夹。" },
}

// A refusal is written to the outside AI, and names the next call and the document's fields by the names the AI uses (see `mod-core/refusal-words.ts`):
// the person reads the sentences that are plain words, the procedure goes to 高级 with the original.
export { forPerson }

/**
 * The lines of a refusal for the person: its plain sentences, and one sentence saying that the rest was an instruction for the AI (kept whole in `detail`).
 * A refusal that is all procedure has no plain sentence: the line then says what happened, not the procedure.
 */
function refusedLines(message: string) {
  const said = refusalForPerson(message)
  if (!said.withheld) return said.lines.slice(0, 6)
  return said.lines.length ? [...said.lines.slice(0, 5), withheldWords(said.withheld)] : [withheldWords(said.withheld)]
}

/** The event for one finished call, or null when it is not about a project. `refused` is the refusal in words for the person, with (`raw`) what the outside AI was given when that is something else. */
export function toolActivity(input: { method: ExternalBridgeMethod; input: unknown; result: unknown; refused: { plain: boolean; message: string; raw?: string } | null; ms: number; run: ProjectRun | null; /** 「审查」 as the person has it switched; left out: on. */ review?: boolean }): ActivityInput | null {
  const said = TOOLS[input.method]
  const given = input.input && typeof input.input === "object" ? (input.input as Record<string, unknown>) : {}
  if (!said || typeof given.projectId !== "string") return null
  const task = input.run?.tasks.find((value) => value.id === given.taskId) ?? null
  const assetAction = input.method === "runTool" && typeof given.tool === "string" && isAssetAction(given.tool) ? given.tool : null
  const result = input.result && typeof input.result === "object" ? (input.result as Record<string, unknown>) : null
  const words = assetAction ? ASSET_WORDS[assetAction] : said.words({ title: task?.title ?? null, input: given, result, review: input.review !== false })
  const base = { kind: "tool" as const, item: task ? taskItem(task) : null, title: task?.title ?? null, tool: said.tool, ms: input.ms }
  if (!input.refused) {
    if (assetAction === "delete_asset" && result?.ok === false)
      return { ...base, mark: "warn", text: "外部 AI 要删除的内容还有别处在用。", lines: typeof result.message === "string" ? [result.message] : [] }
    return { ...base, mark: "note", text: `外部 AI ${words.replace(/。?$/, "。")}`, ...(said.echo || assetAction ? { quiet: true } : {}), detail: `${said.tool} · ${input.ms} 毫秒` }
  }
  // A refusal is always shown: it is what the outside AI has to act on, and what the person would ask about.
  return {
    ...base,
    mark: "fail",
    text: `外部 AI ${words.replace(/。$/, "")}，被 Studio 退回了。`,
    lines: input.refused.plain ? refusedLines(input.refused.message) : ["出了技术问题，原文在高级里。"],
    detail: `${said.tool} · ${input.ms} 毫秒\n${input.refused.raw ?? input.refused.message}`,
  }
}
