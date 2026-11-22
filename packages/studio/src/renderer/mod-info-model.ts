import type { Project } from "@minemods/mod-core/project"
import { EnglishNameSchema, hasCjk } from "@minemods/mod-core/data-words"
import { GIVEN_ICON, ICON_URL_PREFIX, ICON_WORDS, RELEASE_DEFAULTS, RELEASE_LICENSES, iconSizeProblem, modVersion, pngSize } from "@minemods/mod-core/release"
import type { ModInfoInput } from "../api"
import { authorPlaceholder, releaseFields, releaseOf, releaseProblem, type ReleaseFields } from "./release-words"

/**
 * 「模组信息」 as plain data: the fields of the page, what is stored from them, what is wrong with them, and the one line the overview and the
 * build panel show of them. Apart from the page so it is tested without a window. The page is the only place these are edited.
 */

export const INFO_WORDS = {
  title: "模组信息",
  lead: "模组自己的名片：玩家在游戏的模组列表里看到的名字、图标、作者、版本和许可证都在这里。每一项都可以不填。改了以后要重新打包才会带上。",
  open: "改模组信息",
  back: "回工程总览",
  save: "保存模组信息",
  saving: "正在保存…",
  saved: "模组信息已保存。重新打包以后，模组文件里才会带上。",
  failed: "没保存成功，过一会儿再试。",
  nameEmpty: "工程名称不能空着。",
  /** Under the icon: the rules, with why, so a refusal is not the first the person hears of them. */
  // The sizes and why: GIVEN_ICON in mod-core release.ts. The person only needs what to pick.
  iconRules: `选一张正方形的 PNG 图，${GIVEN_ICON.smallSides.join("、")} 像素的像素画会放大得很清楚，${GIVEN_ICON.shown} 到 ${GIVEN_ICON.largest} 像素的图原样使用。`,
  iconNone: "还没有选图标。不选的话，打包时会尝试用你的某个物品或方块的图自动做一个；没有合适的图，模组就没有图标。",
  iconChosen: "选好了这张图标。点「保存模组信息」才会记下。",
  iconPick: "选一张图片",
  iconRemove: "去掉图标",
  iconKept: "现在用的图标。",
  idLabel: "模组编号（内部用，建好工程时定下，不能改）",
  nameEnHelp: "装了模组列表（Mod Menu）的英文版游戏里显示的名字，例如 Moss Lantern。不写就显示中文名。",
  descriptionEnHelp: "同样，英文版游戏的模组列表里显示的介绍。不写就显示中文介绍。",
} as const

export type InfoFields = ReleaseFields & { name: string; name_en: string; description: string; description_en: string }

export const infoFields = (project: Pick<Project, "name" | "name_en" | "description" | "description_en" | "release">): InfoFields => ({
  ...releaseFields(project.release),
  name: project.name,
  name_en: project.name_en ?? "",
  description: project.description,
  description_en: project.description_en ?? "",
})

/** The fields of 发布信息 alone: the release schema is strict, so the page's own fields (name, description…) must not travel with them. */
export const releasePart = (fields: InfoFields): ReleaseFields => ({ author: fields.author, version: fields.version, license: fields.license, homepage: fields.homepage, sources: fields.sources, issues: fields.issues, glyphs: fields.glyphs })

/** What is sent: the release part holds only what was filled in (`releaseOf`); `icon` undefined keeps the saved one. */
export const infoOf = (fields: InfoFields, icon: string | null | undefined): ModInfoInput => ({
  name: fields.name.trim(),
  name_en: fields.name_en.trim(),
  description: fields.description,
  description_en: fields.description_en.trim(),
  release: releaseOf(releasePart(fields)),
  ...(icon === undefined ? {} : { icon }),
})

/** The first thing wrong with what was written, in a sentence; empty when it can be saved. */
export function infoProblem(fields: InfoFields) {
  if (!fields.name.trim()) return INFO_WORDS.nameEmpty
  if (fields.name_en.trim()) {
    const parsed = EnglishNameSchema.safeParse(fields.name_en.trim())
    if (!parsed.success) return parsed.error.issues[0]?.message ?? INFO_WORDS.failed
  }
  if (fields.description_en.trim() && hasCjk(fields.description_en)) return "英文介绍里不能有中文。"
  return releaseProblem(releasePart(fields))
}

/** Whether saving would change anything: the fields against the project, the icon against the one saved. */
export const infoChanged = (project: Project, fields: InfoFields, icon: string | null | undefined) =>
  JSON.stringify(infoOf(fields, undefined)) !== JSON.stringify(infoOf(infoFields(project), undefined)) || (icon !== undefined && icon !== (project.icon ?? null))

/** The bytes of a data URL the file picker gave; null when it is not a PNG one. */
export function pngBytes(url: string) {
  if (!url.startsWith(ICON_URL_PREFIX)) return null
  try {
    return Uint8Array.from(atob(url.slice(ICON_URL_PREFIX.length)), (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

/** A picture picked for the icon, checked as far as the window can before it is sent (the service reads it fully and has the last word). */
export function iconPicked(bytes: Uint8Array, type: string): { ok: true } | { ok: false; text: string } {
  if (type && type !== "image/png") return { ok: false, text: ICON_WORDS.unreadable }
  if (bytes.length > GIVEN_ICON.maxBytes) return { ok: false, text: ICON_WORDS.tooBig }
  const size = pngSize(bytes)
  if (!size) return { ok: false, text: ICON_WORDS.unreadable }
  const problem = iconSizeProblem(size.width, size.height)
  return problem ? { ok: false, text: problem } : { ok: true }
}

/** What the mod will say of itself in one line: the author, version and licence the build will really write (the defaults it falls back to, said as such). */
export function infoLine(project: Pick<Project, "release">, nickname: string) {
  const author = project.release?.author ?? authorPlaceholder(nickname)
  const license = RELEASE_LICENSES[project.release?.license ?? RELEASE_DEFAULTS.license].name
  return `作者 ${author} · 版本 ${modVersion(project)} · ${license}`
}
