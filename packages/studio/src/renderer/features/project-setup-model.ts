import type { GameTarget, JavaFound, JavaInstallPlan, JavaReport, ModsAdded } from "../../api"
import { WORDS } from "../words"

/**
 * What a new project is set up for (2026-10-08): the game and its loader, the mods put into the test scene beside
 * the person's own, and the Java that builds it. The words the three cards say and the facts they compose, as plain
 * functions so the sentences are tested once and every card says them the same way.
 */
export const SETUP_WORDS = {
  change: "改一改",
  fold: "收起",
  target: "游戏和加载器",
  game: "游戏版本",
  loader: "加载器",
  loaderVersion: "加载器版本",
  /** Said when the catalogue gives no reason of its own for a combination Studio cannot make. */
  notReady: "这个组合 Studio 还做不了",
  /** Shown while a version none of whose loaders can be made is looked at: the choice stays where it was. */
  stays: (line: string) => `现在用的还是 ${line}。`,
  java: WORDS.runtime,
  javaReady: "已就绪",
  javaLater: "第一次打包时自动下载",
  javaNone: "没找到合适的 Java。第一次打包时会自动下载一个；也可以现在就装。",
  installNow: "现在就装",
  redetect: "重新检测",
  detecting: "正在检测…",
  foundAll: (count: number) => `找到的 ${count} 个 Java`,
  auto: "自动：用找到的合适的那个",
  chosen: "指定：用你选的这个",
  backToAuto: "改回自动",
  useThis: "用这个",
  using: "正在用",
  fits: "能用",
  /** The plain gloss of a JDK, said once in basic mode; 高级 shows the short name alone. */
  jdk: "完整的 Java（JDK）",
  jre: "只能运行游戏的 Java（不是 JDK）",
  traffic: (bytes: number | null) => (bytes === null ? "下载大小问不到，以实际为准" : `要下载约 ${size(bytes)}`),
  disk: "下载的压缩包装完就删；装好以后占多少会在装完时量出来告诉你",
  free: (bytes: number | null) => (bytes === null ? "读不到剩余空间" : `那个盘还剩 ${size(bytes)}`),
  moveTo: "换个位置",
  defaultPlace: "用默认位置",
  install: "确认，开始装",
  notNow: "先不装",
  installing: "正在装 Java…",
  installed: "装好了。",
  installFailed: "没装成。",
  mods: WORDS.preinstalled,
  modsMeaning: `这些模组会和你的模组一起装进${WORDS.scene}；你的模组的代码不会调用它们。`,
  /** What Studio puts in the test scene by itself, for the project's loader: Fabric API only on Fabric. */
  modsBuiltIn: (loader: string) => (loader === "fabric" ? "fabric-api 和 geckolib 是 Studio 自己会装的，不用加。" : "geckolib 是 Studio 自己会装的，不用加。"),
  modsCount: (count: number) => `预装 ${count} 个`,
  modsNone: "还没有预装模组。",
  searchLabel: "在 Modrinth 上找模组",
  searchHint: "输入模组的名字，比如 Jade、JEI",
  searching: "正在找…",
  searchNothing: "没找到。换个说法试试。",
  searchFailed: "没连上 Modrinth，过一会儿再试。",
  more: "再看几个",
  working: "正在下载并加上…",
  add: "加上",
  added: "已加上",
  fromComputer: "从电脑里选",
  remove: "拿掉",
  removeTitle: (name: string) => `不再预装「${name}」？`,
  removeText: "测试场以后就不装它了。你的模组不受影响。",
  keep: "留着",
  fromModrinth: "来自 Modrinth",
  fromFile: "从电脑里选的",
  required: "别的预装模组要用它，一起加的",
  addedLine: (names: readonly string[]) => `加上了：${names.join("、")}`,
  skippedLine: (name: string, why: string) => `「${name}」没加：${why}`,
  /** On the create page nothing is fetched yet: the mods are added once the project exists. */
  later: "建好工程以后会把这些加进去。",
  addingLater: (count: number) => `正在加上 ${count} 个预装模组…`,
  addedLater: (count: number) => `预装模组加好了，一共 ${count} 个。`,
  addFailed: "没能加上，过一会儿可以在「测试场」那里再加。",
  javaFailed: "没能检测 Java，过一会儿再试。",
  planFailed: "没问到安装要用的信息，过一会儿再试。",
  actionFailed: "没做成，过一会儿再试。",
  sceneFolder: (folder: string) => `自己把 jar 放进工程文件夹下的 ${folder} 文件夹也行。`,
} as const

// Binary units, labelled MB/GB the way Windows Explorer labels them, so the number here is the one the person sees
// on their disk. One decimal under 10 of a unit, where a whole number would round away a third of the value.
export function size(bytes: number) {
  const units = [
    [1024 ** 3, "GB"],
    [1024 ** 2, "MB"],
  ] as const
  for (const [unit, label] of units) if (bytes >= unit) return `${number(bytes / unit)} ${label}`
  return bytes >= 0.1 * 1024 ** 2 ? `${number(bytes / 1024 ** 2)} MB` : "不到 0.1 MB"
}
const number = (value: number) => (value < 10 ? String(Math.round(value * 10) / 10) : String(Math.round(value)))

/** Downloads counted the way a Chinese reader counts them: 万 and 亿, one decimal, nothing after a whole number. */
export function downloads(count: number) {
  if (count >= 1e8) return `${trim(count / 1e8)} 亿次下载`
  if (count >= 1e4) return `${trim(count / 1e4)} 万次下载`
  return `${count} 次下载`
}
const trim = (value: number) => String(Math.round(value * 10) / 10)

export const LOADER_NAMES: Record<GameTarget["loader"], string> = { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", quilt: "Quilt" }

/** The loader's name of a project's target id (`forge-1.20.1` → `Forge`): what a sentence about the project's mod names it by. */
export const targetLoaderName = (target: string) => LOADER_NAMES[target.slice(0, target.indexOf("-")) as GameTarget["loader"]] ?? target

/** `Minecraft 1.21.1 · Fabric 0.17.2`; a target without a loader version is named without one. */
export const targetLine = (target: GameTarget) => `Minecraft ${target.minecraft} · ${LOADER_NAMES[target.loader]}${target.loaderVersion ? ` ${target.loaderVersion}` : ""}`

/** What the next build will use, in one phrase: ready, or downloaded at the first build. Undefined while still looking. */
export function javaPhrase(major: number, report: JavaReport | undefined) {
  if (!report) return `Java ${major}`
  return `Java ${major} ${report.using ? SETUP_WORDS.javaReady : SETUP_WORDS.javaLater}`
}

/** The one line the create page shows in place of the three cards. */
export function summaryLine(input: { target: GameTarget; java: JavaReport | undefined; mods: number }) {
  return [targetLine(input.target), javaPhrase(input.target.java, input.java), SETUP_WORDS.modsCount(input.mods)].join(" · ")
}

/** The game versions of the catalogue, each once, in the catalogue's own order; `ready` when any loader of it can be made. */
export function versionsOf(targets: readonly GameTarget[]) {
  const seen = new Map<string, boolean>()
  for (const target of targets) seen.set(target.minecraft, (seen.get(target.minecraft) ?? false) || target.ready)
  return [...seen].map(([minecraft, ready]) => ({ minecraft, ready }))
}

/** One entry per loader the catalogue has for this version, in catalogue order: its ready target when it has one. */
export function loadersAt(targets: readonly GameTarget[], minecraft: string) {
  const at = new Map<GameTarget["loader"], GameTarget[]>()
  for (const target of targets) if (target.minecraft === minecraft) at.set(target.loader, [...(at.get(target.loader) ?? []), target])
  return [...at].map(([loader, list]) => ({ loader, targets: list, target: list.find((target) => target.ready) ?? list[0]! }))
}

/** The plain reason a combination cannot be chosen; null for one that can. */
export const whyNot = (target: GameTarget) => (target.ready ? null : (target.why ?? SETUP_WORDS.notReady))

/**
 * The target a new project starts on: the one main calls chosen when it can be made, else the first that can.
 * Undefined only for a catalogue with nothing ready, which then leaves the create page on main's own default.
 */
export function defaultTarget(targets: readonly GameTarget[], chosen: string | undefined) {
  return targets.find((target) => target.id === chosen && target.ready) ?? targets.find((target) => target.ready)
}

/** Where a press on a version or a loader lands: the ready target of that version (and loader), or null to stay put. */
export function landOn(targets: readonly GameTarget[], minecraft: string, loader?: GameTarget["loader"]) {
  return targets.find((target) => target.minecraft === minecraft && (!loader || target.loader === loader) && target.ready) ?? null
}

// The search box's maxlength. A search is a few words of a mod's name; anything longer is cut where the person can
// see it (the box stops taking letters) instead of silently on the way to Modrinth.
export const SEARCH_MAX = 100

/** What is sent to Modrinth for what was typed: spaces trimmed and collapsed; empty when there is nothing to look for. */
export const searchQuery = (typed: string) => typed.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX)

/** A long folder kept to its start and its last two folders, so the row shows where it is without wrapping. */
export function shortPath(full: string, max = 48) {
  if (full.length <= max) return full
  const separator = full.includes("\\") ? "\\" : "/"
  const parts = full.split(separator)
  const tail = parts.slice(-2).join(separator)
  const head = parts[0] || separator
  const shortened = `${head}${head.endsWith(separator) ? "" : separator}…${separator}${tail}`
  return shortened.length < full.length ? shortened : full
}

/** The server a download comes from, as a person can check it; the address itself when it is not one. */
export function hostOf(url: string) {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** How a Java was found, said as where it is. */
export const SOURCE_WORDS: Record<JavaFound["source"], string> = {
  chosen: "你指定的",
  studio: "Studio 装的",
  java_home: "系统设置里指定的",
  path: "系统里默认的",
  installed: "装在电脑上的",
  launcher: "Minecraft 启动器自带的",
  registry: "装在电脑上的",
}

/** A JDK or not: glossed for everyone, the short name alone under 高级. */
export const kindWords = (jdk: boolean, advanced: boolean) => (advanced ? (jdk ? "JDK" : "JRE") : jdk ? SETUP_WORDS.jdk : SETUP_WORDS.jre)

/** What the install confirmation states, each line already in words; `blocked` when the install button stays off. */
export function installFacts(plan: JavaInstallPlan) {
  return {
    what: `${plan.vendor} ${plan.version}`,
    from: hostOf(plan.url),
    traffic: SETUP_WORDS.traffic(plan.downloadBytes),
    disk: SETUP_WORDS.disk,
    where: plan.directory,
    moved: plan.directory !== plan.defaultDirectory,
    free: SETUP_WORDS.free(plan.freeBytes),
    problem: plan.problem,
    blocked: !!plan.problem,
  }
}

/** What adding mods came to, one sentence per mod that was not added; nothing when everything went in. */
export function addedLines(result: ModsAdded) {
  return [
    ...(result.added.length ? [SETUP_WORDS.addedLine(result.added.map((mod) => mod.name))] : []),
    ...result.skipped.map((value) => SETUP_WORDS.skippedLine(value.name, value.why)),
  ]
}

/** A mod picked on the create page before the project exists: added once it does. */
export type PendingMod = { modrinthId: string; title: string }

export const remember = (list: readonly PendingMod[], mod: PendingMod) => (list.some((value) => value.modrinthId === mod.modrinthId) ? [...list] : [...list, mod])
export const forget = (list: readonly PendingMod[], modrinthId: string) => list.filter((value) => value.modrinthId !== modrinthId)

/** A failure as the person is shown it: the main process's own Chinese sentence, else `fallback`; the raw text under 高级. */
export function plainError(cause: unknown, fallback: string, advanced = false) {
  const message = (cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
  return advanced || /[\u4e00-\u9fff]/.test(message) ? message : fallback
}

// The window loads nothing from the network (index.html's content policy, and main cancels every other request), so
// only a picture handed over as data can be drawn; an address would be a broken picture and is the empty slot instead.
export const modIcon = (icon: string | null) => (icon?.startsWith("data:image/") ? icon : null)
