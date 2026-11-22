import type { OverviewItem } from "../api"
import type { WorkspaceAsset } from "@minemods/mod-core/workspace"
import { motionName } from "@minemods/studio-ai/making"

/**
 * One word for one thing. An audit of the screens found the same concept under several names (工程 / 项目 / 作品,
 * 资产 / 内容 / 条目, 评审 / 审阅 / 审查…), so a beginner had to guess whether each new word was a new thing.
 * This is the table every screen follows: the key is the concept, the value the only word a person is shown
 * for it. A string composed in code takes its word from here; a literal sentence uses the same word.
 */
export const WORDS = {
  library: "工程库", backLibrary: "回工程库", overview: "工程总览", backOverview: "回工程总览",
  accepted: "验收通过", redo: "退回重做", checked: "检查结果", behavior: "行为",
  ready: "做好了", blueprint: "蓝图", unmade: "还没做", omit: "不做这个了", design: "只是设计稿",
  make: "让 AI 做", revise: "让 AI 改", plan: "让 AI 安排", copyToAI: "复制给我的 AI",
  connected: "已连接", offline: "AI 没连接", working: "正在做", disconnected: "断开了",
  effect: "效果", status: "状态", move: "招式", skill: "技能", rest: "歇多久",
  converter: "转换工具", instructions: "起步说明", advanced: "高级", options: "更多选项",
  users: "谁在用它", uses: "它用到了", sound: "声音", music: "音乐", backgroundMusic: "背景音乐",
  intro: "前奏", loop: "循环段", outro: "结尾", listen: "试听", playMotion: "播放",
  dropFile: "把文件拖到这里", chooseFile: "选文件", changeFile: "换文件", convert: "转成游戏能用的格式",
  cut: "截到 10 秒", vanilla: "原版", own: "自己的", defaultSound: "没有设，用游戏默认的",
  whenSound: "什么时候响", whichSound: "用的是", ambient: "平时", hurt: "受伤时", death: "死的时候", step: "走路时",
  phase: "变身时", distance: "多远会用", windup: "蓄力", duration: "全程", moveUses: "用到的",
  movePhases: "哪些阶段用", add: "加上", remove: "去掉", hitbox: "判定范围图", lair: "巢", spawn: "怎么出现",
  arena: "战斗场地", rename: "改名", duplicate: "复制一份", delete: "删除", undo: "撤销",
  chooseAI: "选谁来做", join: "接上", tryAI: "试一下", key: "密钥",
  /** The container the person works in: 「新建工程」 makes one. Never 项目 or 作品. */
  project: "工程",
  /** What ends up in the game. The 工程 is the workshop, the 模组 the product: things are 「做进模组」. */
  mod: "模组",
  /** One thing of the mod when its kind is not known; a known kind is called by its own name (生物、方块、物品、配方…). Never 资产, 内容, 条目 or 资源. */
  thing: "东西",
  /** How things are counted in a sentence. */
  things: (count: number) => `${count} 样东西`,
  /** Raw parts only (a model, a texture, a motion file), never a thing of the mod. */
  part: "素材",
  /** Asking the AI, as an action and as the button that does it. Never 工程指令, 模块任务 or 制作要求. */
  say: "说一句话",
  tell: "跟 AI 说",
  /** Compile and package, alone. */
  pack: "打包",
  packed: "打包好了",
  /** The one title-bar label for packing and then opening the game. */
  play: "构建并试玩",
  /** The stage on the road where finished things become part of the mod. */
  into_mod: "做进模组",
  /** Looking at it in the game, and the place Studio opens for that. 「开发环境试玩」 exists only under 高级. */
  see: "进游戏看",
  scene: "测试场",
  /** Other people's mods put into the 测试场 beside the person's own. Never 依赖 or 前置 for these: the mod does not call them. */
  preinstalled: "预装模组",
  /** The Java a mod is built with, as the card that finds and installs it is titled. */
  runtime: "运行环境",
  /** The person's own decision on a thing. */
  accept: "验收",
  /** Another AI's look at it. Never 评审 or 审阅. */
  review: "审查",
  reviewer: "审查员",
  /** Studio's own mechanical measuring and reconciling. Never 核对, 对账 or 校验. */
  check: "检查",
  /** The page with the log of what happened, and the feed inside it. */
  floor: "制作现场",
  feed: "动态",
  /** A motion clip. The asset kind keeps its registry label (MODULES.animation.label). */
  motion: "动作",
  /** An unfinished plan. */
  draft: "草稿",
  blueprint_draft: "蓝图草稿",
  /** The settings page, and the part of it where the AI is connected. */
  settings: "个人设置",
  connect: "连接 AI",
  /** The older 「模组构想」 route, kept only so old projects stay readable: what it holds is never built. */
  legacy: "旧的构想（不会进游戏）",
} as const

/**
 * The two ways an AI is connected, as a choice a beginner can make: who does the work, who it suits and what it
 * costs. How each is wired (API, MCP) is named only as far as the person needs it to find the right key or tool.
 */
export const MODE_WORDS = {
  api: {
    name: "让 Studio 自己调用 AI（要先开通一个 AI 账号）",
    short: "Studio 自己调用 AI",
    note: "适合想在这一个窗口里把事情做完的人。要先在一家 AI 服务商那里开通账号，拿到一串「密钥」（开通服务用的通行码），按用量付费给那一家。",
  },
  mcp: {
    name: "用我自己的 AI 助手来做（Claude 桌面版、Codex 这类）",
    short: "我自己的 AI 助手",
    note: "适合已经在用这类助手的人：在你常用的 AI 对话里粘贴一段说明就行，它来动手，这里看着它做；不用密钥，花的是它自己的额度，这里不另外收费。它要能连接你电脑上的工具（Claude 桌面版、Codex 可以）；ChatGPT 目前连不上，只登录 ChatGPT 不行。",
  },
} as const

/** The two models Studio's own AI can be split over, by what each does. Both follow the chosen model unless changed. */
export const MODEL_ROLE_WORDS = {
  router: { name: "分工用的小模型", note: "把你的一句话拆成要做哪几样、谁先谁后。不填别的，就和上面选的模型一样。" },
  maker: { name: "做东西用的模型", note: "真正动手做每一样东西。不填别的，也和上面选的模型一样。" },
} as const

/** The image model that draws a model's 六视图 (2026-10-08). Left empty, the connection's default one is used: the placeholder names it. */
export const IMAGE_MODEL_WORDS = { name: "画图模型", note: "用来画六视图。留空就用 gpt-image-1。", placeholder: "gpt-image-1" } as const

type NamedThing = Pick<WorkspaceAsset, "title" | "document">

export function gameName({ document }: NamedThing): string | undefined {
  switch (document.kind) {
    case "sound": return document.subtitle?.zh
    case "entity": case "item": case "block": return document.name
    default: return undefined
  }
}

export function thingName(thing: NamedThing): string
export function thingName(thing: NamedThing | null | undefined): string | undefined
export function thingName(thing: NamedThing | null | undefined) {
  if (!thing || !/^[a-z0-9_]+$/.test(thing.title)) return thing?.title
  const human = gameName(thing) ?? (thing.document.kind === "animation" ? motionName(thing.document.name) : undefined)
  return human && !/^[a-z0-9_]+$/.test(human) ? human : thing.title
}

/** Give saved rows their current display title. Unsaved plan entries keep the title the person chose. */
export function namedOverviewItems(items: OverviewItem[], assets: WorkspaceAsset[]) {
  const titles = new Map(assets.map(asset => [asset.id, thingName(asset)]))
  return items.map(item => {
    const title = (item.asset_id && titles.get(item.asset_id)) || item.title
    const status_label = item.status === "out_of_scope" ? WORDS.omit : item.status_label
    return title === item.title && status_label === item.status_label ? item : { ...item, title, status_label }
  })
}

/** The registry also serves the AI contract. Only Studio uses these two presentation labels. */
export function kindLabel(id: string, registered: string) {
  return id === "animation" || id === "gesture" ? WORDS.motion : registered
}
