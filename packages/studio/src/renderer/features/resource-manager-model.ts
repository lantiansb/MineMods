import type { Project } from "@minemods/mod-core/project"
import { targetIds } from "../../project-status"
import { SOURCE_NAMES, type SourceId } from "@minemods/mod-core/store/sources"
import type { GameTarget } from "../../api"
import type { EnvironmentCleanup } from "../../library"
import { LOADER_NAMES, targetLine } from "./project-setup-model"

/**
 * The storage page's sentences (2026-11-14): what a downloaded thing is called, where it came from, which game
 * versions need it, and what 「清理没用的」 did. Plain functions, so every row says them the same way.
 */

export const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 ** 2
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : bytes < 1024 ** 3
        ? `${(bytes / 1024 ** 2).toFixed(1)} MiB`
        : `${(bytes / 1024 ** 3).toFixed(2)} GiB`

/** `forge-1.20.1` → 「Forge 1.20.1」; an id that is not loader-version is shown as it is. */
export function targetName(id: string) {
  const dash = id.indexOf("-")
  const loader = id.slice(0, dash) as GameTarget["loader"]
  return dash > 0 && Object.hasOwn(LOADER_NAMES, loader) ? `${LOADER_NAMES[loader]} ${id.slice(dash + 1)}` : id
}

export const projectGames = (project: Pick<Project, "target" | "targets">) => targetIds(project).map(targetName).join("、")

/** Where a catalogue item came from, in plain words: a mirror's name, or how it got onto this computer. */
export function sourceName(source: string) {
  if (source === "registered") return "升级前已有"
  if (source === "kept") return "本地已有"
  return Object.hasOwn(SOURCE_NAMES, source) ? SOURCE_NAMES[source as SourceId] : source
}

/** 「Forge 1.20.1、Fabric 1.21.1 要用」; null when no game version needs it. */
export function neededLine(neededBy: readonly string[]) {
  return neededBy.length ? `${neededBy.map(targetName).join("、")} 要用` : null
}

/** What 「清理没用的」 says when it is done. */
export function cleanupNotice(result: EnvironmentCleanup) {
  return result.removed.length ? `清理了 ${result.removed.length} 项，腾出 ${size(result.freedBytes)}` : "没有可以清理的"
}

/**
 * 「现在能打包的：Minecraft 1.21.1 · Fabric 0.17.2 · Java 21。」 from the targets Studio can make now, and the loaders
 * whose mods can only be opened and looked at. Null for a catalogue with nothing ready.
 */
export function buildableLine(targets: readonly GameTarget[]) {
  const ready = targets.filter((target) => target.ready)
  if (!ready.length) return null
  const line = ready.map((target) => `${targetLine(target)} · Java ${target.java}`).join("；")
  const lookOnly = (["forge", "neoforge"] as const).filter((loader) => !ready.some((target) => target.loader === loader))
  return `现在能打包的：${line}。${lookOnly.length ? `${lookOnly.map((loader) => LOADER_NAMES[loader]).join(" 与 ")} 的包可以打开来看，还不能打包。` : ""}`
}
