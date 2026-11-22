import { z } from "zod"
import type { ModuleKind } from "@minemods/mod-core/workspace"

/**
 * What an outside AI can read once it is connected, by topic. The start-up text it is pasted says only how to connect, the order of work and
 * the rules that hold for everything; the rest is read here (`get_guide`), and each task claimed brings the topics of its own kind along
 * (`claim_task.guide`). This file is only the list: no text and no imports that would pull the text in, so the start-up text, the tool
 * list and the capability list can name the topics without depending on the words (`mcp-guide.ts`).
 */

export const GUIDE_TOPIC_IDS = ["blueprint", "plan", "workflow", "review", "acceptance", "making", "script", "blockitem", "references", "model", "creature", "gesture", "gameplay", "data", "rules", "tools", "import"] as const
export type GuideTopicId = (typeof GUIDE_TOPIC_IDS)[number]

/** `group`: where the start-up text lists it. `when`: the one line that says when to read it. */
export const GUIDE_TOPICS: Record<GuideTopicId, { title: string; when: string; group: "plan" | "make" | "look" }> = {
  blueprint: { title: "整个模组：蓝图", when: "用户一句话要做整个模组：规划之前读（想法卡片、锁定的要求、等用户确认、重做）", group: "plan" },
  plan: { title: "模块一览与 plan_run", when: "只改一两样、要自己拆任务（plan_run）：提交计划之前读", group: "plan" },
  workflow: { title: "完整调用顺序", when: "要核对每一步该调用什么：环境、调用顺序、构建和测试场", group: "look" },
  review: { title: "审查", when: "做东西的 AI 和审查的 AI 怎么分工；审查开着或关着时各自怎么做", group: "make" },
  acceptance: { title: "验收标准与被退回时怎么办", when: "提交被退回，或者想先知道标准是什么", group: "make" },
  making: { title: "看着做", when: "做模型、贴图、动画、施法动作、方块、物品、效果：保存说明、看图、自评、验收、提交的整套顺序", group: "make" },
  script: { title: "用脚本交模型、贴图、动画", when: "不想逐个关键帧写文档，改用一段 JavaScript 脚本交", group: "make" },
  blockitem: { title: "方块和物品的贴图", when: "做方块、物品自己的那张贴图", group: "make" },
  references: { title: "参考图与构想图", when: "这样东西有参考图，或者想自己画构想图交给 Studio", group: "make" },
  model: { title: "模型造型与精细度", when: "做生物的模型，或者给它另画贴图", group: "make" },
  creature: { title: "生物", when: "做生物（entity）：招式怎么看着验收、文档结构、绑定模型和贴图", group: "make" },
  gesture: { title: "施法动作", when: "做施法动作（gesture）", group: "make" },
  gameplay: { title: "玩法代码", when: "写玩法代码（gameplay）：说明、检查、评审、提交", group: "make" },
  data: { title: "不写代码的数据玩法", when: "方块、物品、配方、生物的数据字段能做到什么、做不到什么", group: "make" },
  rules: { title: "模块规则与恢复", when: "遇到超时、版本冲突、Studio 重启，或者要核对哪些话不能说", group: "look" },
  tools: { title: "全部工具和参数", when: "查某个工具的参数、用途", group: "look" },
  import: { title: "导入工程分析与整合包资产", when: "用户要分析、拆解、修改已有的模组或整合包，或者要把几个 Studio 工程合成一个模组", group: "look" },
}

/**
 * The topics that come with a claimed task of each kind, in the order they are read. A topic can be partly meant for some kinds only
 * (`kinds` of its parts, `mcp-guide.ts`); what the claim already carries in its own fields (the kind's instructions, `making.discipline`,
 * `making.reference_guide`, `gameplay.discipline`) is not said twice.
 */
export const CLAIM_GUIDE: Record<ModuleKind, readonly GuideTopicId[]> = {
  model: ["review", "making", "script", "model", "acceptance"],
  texture: ["review", "making", "script", "model", "acceptance"],
  animation: ["review", "making", "script", "rules", "acceptance"],
  gesture: ["review", "making", "gesture", "acceptance"],
  block: ["review", "making", "blockitem", "data", "acceptance"],
  item: ["review", "making", "blockitem", "data", "acceptance"],
  effect: ["review", "making", "acceptance"],
  // Saved audio can be inspected through look without entering a making round.
  sound: ["making", "acceptance"],
  music: ["making", "acceptance"],
  particle: ["review", "making", "acceptance"],
  bossbar: ["review", "making", "acceptance"],
  fixture: ["review", "making", "acceptance"],
  entity: ["review", "making", "creature", "data", "acceptance"],
  gameplay: ["review", "gameplay", "acceptance"],
  recipe: ["data", "acceptance"],
  logic: ["data", "acceptance"],
  worldview: ["rules", "acceptance"],
  biome: ["rules", "acceptance"],
  dimension: ["rules", "acceptance"],
  terrain: ["rules", "acceptance"],
  // 技能资产: not made by looking (its timeline, numbers and bindings are said in words and tried in the game); how it is written comes with the claim itself.
  ability: ["making", "acceptance"],
  // 书: words on pages, measured by the game's layout when it is committed and built; nothing to look at.
  book: ["making", "acceptance"],
}

export const ExternalGuideInputSchema = z.strictObject({ topic: z.enum(GUIDE_TOPIC_IDS).optional(), projectId: z.uuid().optional() })
export type ExternalGuideInput = z.infer<typeof ExternalGuideInputSchema>
