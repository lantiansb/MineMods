import { TERRAIN_GAMEPLAY_INSTRUCTIONS, TRAP_GAMEPLAY_WORDS } from "@minemods/mod-core/terrain"
import { GAMEPLAY_API, GAMEPLAY_LIMITS } from "@minemods/mod-core/gameplay"
import { gameplayApiWords } from "@minemods/mod-core/gameplay-check"
import { GAMEPLAY_SCAN_LIMITS, gameplayAllowed } from "@minemods/mod-core/gameplay-scan"
import { gameplayBoundsWords, gameplayDiscipline, GAMEPLAY_FORM_EXAMPLE, GAMEPLAY_GENERATED_TITLE, GAMEPLAY_LOOP_SUMMARY, GAMEPLAY_NO_GAME_WORDS, GAMEPLAY_REFUSALS, GAMEPLAY_REVIEWER_HANDOFF, GAMEPLAY_SOLO_VOICE } from "@minemods/mod-core/gameplay-words"
import { CHECK_NETWORK_WORDS } from "@minemods/mod-core/gradle-network"
import type { TargetId } from "@minemods/mod-core/target/ids"
import { targetWords, targetsWords } from "@minemods/mod-core/target/words"
import { FINDING_LABELS, UNSATISFIED } from "@minemods/studio-ai/making"
import { CHECK_CALLING, CHECK_STAGES, CHECK_TIMING } from "./check-calling"

/**
 * What an outside AI is told about gameplay code, for the hand-off text, the capability list and the live
 * server. Written from the same definitions the loop enforces, so the three cannot disagree with it.
 */

/** One gameplay, in call order. `check_code` repeats until all three checks pass. */
export const MCP_GAMEPLAY_WORKFLOW = ["claim_task", "save_sheet", "check_code", "final_review", "commit_task"] as const

export const MCP_GAMEPLAY_TOOL = [
  "check_code",
  `检查一版玩法代码，不启动游戏：有没有越界（文件、网络、进程、反射、类加载、线程等）、引用对不对得上（uses、ProjectContent 读的名字、数据文件、两种语言的文字）、能不能和工程生成的代码一起编译。返回每个问题所在的文件、行号和怎么改。三项都过才能评审和提交；同一个任务最多检查 ${GAMEPLAY_LIMITS.rounds} 版。只用于玩法（gameplay）任务。编译慢时先返回 finished: false（还在检查）：用完全相同的参数再调用一次来取结果，不会再编译一次。`,
  "{ projectId, runId, taskId, document? }",
] as const

/** What `commit_task` and the other steps say when a step of the gameplay loop was skipped, in the order the steps come. */
export const MCP_GAMEPLAY_REFUSALS = [GAMEPLAY_REFUSALS.no_sheet, GAMEPLAY_REFUSALS.sheet_differs, GAMEPLAY_REFUSALS.no_check, GAMEPLAY_REFUSALS.unchecked, GAMEPLAY_REFUSALS.redescribed, GAMEPLAY_REFUSALS.floor(["（逐条列出的问题）"]), GAMEPLAY_REFUSALS.no_review, GAMEPLAY_REFUSALS.stale_review, GAMEPLAY_REFUSALS.review_failed, GAMEPLAY_REFUSALS.reviewed_and_failed, GAMEPLAY_REFUSALS.no_need, GAMEPLAY_REFUSALS.not_gameplay] as const
/** How a gameplay that ends without a pass turns out. */
export const MCP_GAMEPLAY_ENDINGS = [`${GAMEPLAY_REFUSALS.out_of_rounds(GAMEPLAY_LIMITS.rounds)}${GAMEPLAY_REFUSALS.kept(GAMEPLAY_LIMITS.rounds)}`, GAMEPLAY_REFUSALS.nothing_kept] as const

/** What gameplay may not reach for, with the loader of the project's target. */
const mixinWords = (target: TargetId) => {
  const t = targetWords(target)
  // Forge and NeoForge (D 组): gameplay code reaches the loader only through Studio's ProjectPlatform and ProjectClient.
  if (t.loader !== "Fabric")
    return `这一版不开放 mixin、access widener 和反射：玩法只用 Minecraft 公开的接口，和 Studio 生成的 ${GAMEPLAY_API.platform} / ${GAMEPLAY_API.client_platform} 提供的事件与注册接口；${t.loader} 自己的类不能直接用。那里没有事件、又碰不到私有成员的事情现在做不了（例如改原版生物的 AI 内部、改原版界面的绘制、拦截没有事件的方法），请在 not_doing 里如实写明，不要用别的东西顶替。`
  return `这一版不开放 mixin、access widener 和反射：玩法只用 Minecraft 和 ${t.api} 公开的事件与注册接口。${t.loader} 没有事件、又碰不到私有成员的事情现在做不了（例如改原版生物的 AI 内部、改原版界面的绘制、拦截没有事件的方法），请在 not_doing 里如实写明，不要用别的东西顶替。`
}

/** The target the words are for when no project is at hand: the first Studio can make a mod for now. */
const firstReady = () => targetsWords()[0]!.id

/** For `get_capabilities`. `target`: the one whose facts are said; left out, the first ready one. */
export const gameplayCapability = (review = true, target?: TargetId) => ({
  target: target ?? null,
  summary: GAMEPLAY_LOOP_SUMMARY,
  discipline: target ? gameplayDiscipline(target) : "带上 projectId 查询当前工程目标的 Java 版本、接口和目录名。",
  kinds: ["gameplay"],
  workflow: MCP_GAMEPLAY_WORKFLOW,
  // The same tools as the looked kinds wherever the step is the same; one tool of its own.
  tools: { describe: "save_sheet", draft: "update_task", check: "check_code", review: "final_review", commit: "commit_task" },
  sheet: "{ slug, name, summary, behaviours: [{ when, does, shows }], not_doing: string[], uses: UUID[] }",
  form_example: GAMEPLAY_FORM_EXAMPLE,
  api: [...(target ? gameplayApiWords(target) : []), TERRAIN_GAMEPLAY_INSTRUCTIONS, TRAP_GAMEPLAY_WORDS],
  entry: { main: GAMEPLAY_API.main, interface: GAMEPLAY_API.entry, client_main: GAMEPLAY_API.client_main, client_interface: GAMEPLAY_API.client_entry, accessor: GAMEPLAY_API.content },
  bounds: { words: target ? gameplayBoundsWords(target) : "限制按工程目标查询。", allowed_packages: target ? gameplayAllowed(target) : [], mixins: target ? mixinWords(target) : "不开放 mixin、access widener 和反射。", cannot_catch: GAMEPLAY_SCAN_LIMITS },
  checks: ["没有越界（读源码）", "引用都对得上（对照工程）", "能编译（和工程生成的代码一起真编译，不打包、不开游戏）", review ? "说明和代码一致（没有参与编写的评审读说明和代码）" : "说明和代码一致（审查关着：由你自己读说明和代码，不另请评审）"],
  // How to call a check that takes longer than one request.
  check_calling: { how: CHECK_CALLING.how, wait_seconds: CHECK_TIMING.again / 1000, still_checking: "{ finished: false, state: \"checking\", checking: { seconds, elapsed, stage }, next_step }", finished: "{ finished: true, state, round, rounds_allowed, rounds_left, next_step, check }", stages: Object.values(CHECK_STAGES), refused_while_checking: CHECK_CALLING.busy("N 分钟"), network: GAMEPLAY_REFUSALS.no_compiler(CHECK_NETWORK_WORDS) },
  floor: "前三项是硬底线，没过的版本不会保存；第四项只有“说明写了而代码没做到”才算没通过。",
  limits: { rounds: GAMEPLAY_LIMITS.rounds, sources: GAMEPLAY_LIMITS.sources, source_kb: GAMEPLAY_LIMITS.source_bytes / 1024, data_files: GAMEPLAY_LIMITS.data, data_kb: GAMEPLAY_LIMITS.data_bytes / 1024, total_kb: GAMEPLAY_LIMITS.total_bytes / 1024 },
  findings: { blocking: FINDING_LABELS.blocking, advice: FINDING_LABELS.advice },
  refusals: MCP_GAMEPLAY_REFUSALS,
  endings: MCP_GAMEPLAY_ENDINGS,
  unsatisfied: `版数用完、评审一直没过或者 fail_task 时，通过了越界、引用和编译检查的最新一版会存进工程，标明“${UNSATISFIED.mark}”和原因，交给用户自己试玩决定。`,
  no_game: GAMEPLAY_NO_GAME_WORDS,
  independent_review: review ? GAMEPLAY_REVIEWER_HANDOFF : GAMEPLAY_SOLO_VOICE.handoff,
  active_task_source: "claim_task.gameplay",
  templates: "没有。Studio 不提供任何题材的玩法模板、示例玩法或现成代码。",
})

/** The section of the hand-off text. `tick` is a backtick; `target` the project's (primary), whose facts are said; left out, the first ready one. */
export const gameplayHandoffSection = (tick: string, target: TargetId = firstReady()) => `## 玩法代码（gameplay）

${GAMEPLAY_LOOP_SUMMARY}

蓝图里凡是“行为”——一样东西会做什么、什么时候触发、守着什么、怎么生成——现在都可以规划成一个 gameplay 条目，由你写 Java 代码实现，而不是写进 out_of_scope。一个玩法是一块自成一体的行为，范围可以很宽。Studio 不提供任何题材的玩法模板或现成代码。

${gameplayDiscipline(target)}

写代码要知道的：

${[...gameplayApiWords(target), TERRAIN_GAMEPLAY_INSTRUCTIONS, TRAP_GAMEPLAY_WORDS].map((line) => `- ${line}`).join("\n")}
- ${gameplayBoundsWords(target)}
- ${mixinWords(target)}

对应的工具，按顺序：${MCP_GAMEPLAY_WORKFLOW.map((name) => `${tick}${name}${tick}`).join(" → ")}。

1. ${tick}claim_task${tick} 返回的 ${tick}gameplay${tick} 不是 null，就说明这一样是玩法代码。里面有这套纪律、这个工程里可以挂的东西（things：资产 id、种类、名字，以及代码里读它的写法 accessor；生物还带着它模型里的动作 motions；already 是它自己和别的玩法已经在做的事，有才有；还没写说明的别的玩法在 not_yet_described 里）、包名、最多能检查几版，以及重做时上一版的说明（sheet）和用户说的话（remark）。
2. ${tick}save_sheet${tick}：写说明。玩法任务的 sheet 是 ${tick}{ slug, name, summary, behaviours: [{ when, does, shows }], not_doing: string[], uses: UUID[] }${tick}。这份说明就是评审核对的依据，也是用户进游戏试玩时照着看的清单，所以每一条都要能照着手动试出来。
3. 写出完整的 gameplay 文档（说明部分必须和 save_sheet 写的一模一样，再加 sources、data、lang），调用 ${tick}check_code${tick}。返回的 check 里 in_bounds、references、compiles 各自是否通过，以及每个问题的文件、行号、发现了什么、怎么改；lines 是同样的内容连成的句子。有问题就改，再检查。${CHECK_CALLING.how}如果返回的是“${CHECK_NETWORK_WORDS}”，那是网络的问题，不是代码的问题：不要改代码，过几分钟用同一版再检查一次。
4. 三项都过以后调用 ${tick}final_review${tick}（不带 verdict）取评审材料：input.description 是说明，input.code 是你写的代码，input.already（它挂着的东西已经在做的事，有才给）和 input.amended（说明在编写途中改过的地方，有才给）也要一起交给评审。input.generated（玩法挂在生物上时才有）是「${GAMEPLAY_GENERATED_TITLE}」——Studio 生成的生物自带哪些行为和优先级、doHurtTarget、挨打、死亡各播什么动作、掉落和经验、addGoal 是怎么生效的，都是从这一版会生成的代码里读出来的。评审要对着“说明”核对“你的代码 + generated”，三样缺一不可。${GAMEPLAY_REVIEWER_HANDOFF}玩法的评审没有图可以补看，不要带 need。
5. 评审通过后 ${tick}commit_task${tick}，提交的必须是检查过、评审过的那一版，一个字都不能改。

这些情况下会被拒绝，任务保持 running，工程不变，返回的就是下面的原话：

${MCP_GAMEPLAY_REFUSALS.map((words) => `- ${words}`).join("\n")}

结束的两种情况：

${MCP_GAMEPLAY_ENDINGS.map((words) => `- ${words}`).join("\n")}

源码检查是护栏，不是证明。它拦不住的：

${GAMEPLAY_SCAN_LIMITS.map((line) => `- ${line}`).join("\n")}

${GAMEPLAY_NO_GAME_WORDS}构建产物的 ${tick}minemods-build.json${tick} 会列出每个玩法的每个文件、哈希和检查结果，并写明这是 AI 写的代码、没有人启动过游戏。`
