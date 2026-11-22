import { RELEASE_DEFAULTS, ReleaseSchema, type Release, type ReleaseLicense } from "@minemods/mod-core/release"

// 「发布信息」: the words and the plain rules of the form, apart from the form itself so they can be tested without a window.

/** Each licence the build can name, as what it lets other people do. The identifier itself is shown under 高级. */
export const LICENSE_WORDS: Record<ReleaseLicense, string> = {
  MIT: "别人可以随便用、改、再发布，只要留着你的名字",
  "Apache-2.0": "和上一个差不多，另外写明了专利方面也允许",
  "GPL-3.0-only": "别人可以用和改，但改出来的东西也要同样公开源码",
  "LGPL-3.0-only": "别的模组可以直接用它；改了它本身的，要公开改动",
  "MPL-2.0": "改过的那几个文件要公开，其余的不用",
  "CC0-1.0": "放弃全部权利，谁都可以随便用，不用署名",
  ARR: "保留所有权利：别人只能玩，不能改，也不能再发布",
}

/**
 * 补字 (E19): what a pack does with a character the game's fonts cannot draw. Left alone it is drawn in 黑体, which looks most like the game's own
 * one-pixel strokes; 宋体 is the project art's font; 只提醒 is what every pack did before.
 */
export const GLYPH_WORDS = {
  legend: "游戏字体里没有的字（生僻字）",
  sans: "补成像素字，用黑体：和游戏里的字最像",
  serif: "补成像素字，用宋体",
  off: "只提醒，不补：游戏里显示成方框",
  help: "打包时从这台电脑上装的开源字体（许可允许随模组发布的，SIL OFL 1.1）里找这些字，画成和游戏里一样大的像素字放进模组，字体许可一起带上。哪台电脑上都没有的字补不上，打包时会提醒。",
} as const
export type GlyphChoice = "sans" | "serif" | "off"

export type ReleaseFields = { author: string; version: string; license: ReleaseLicense | ""; homepage: string; sources: string; issues: string; glyphs: GlyphChoice | "" }
export const releaseFields = (release: Release | undefined): ReleaseFields => ({
  author: release?.author ?? "",
  version: release?.version ?? "",
  license: release?.license ?? "",
  homepage: release?.homepage ?? "",
  sources: release?.sources ?? "",
  issues: release?.issues ?? "",
  glyphs: release?.glyphs ?? "",
})

/** What is stored: only what was filled in, so everything left empty keeps following the build's own defaults. */
export function releaseOf(fields: ReleaseFields): Release {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value)) as Release
}

/** The first thing wrong with what was written, in the schema's own sentence; empty when it can be saved. */
export function releaseProblem(fields: ReleaseFields) {
  const parsed = ReleaseSchema.safeParse(releaseOf(fields))
  if (parsed.success) return ""
  const issue = parsed.error.issues[0]
  return issue?.path[0] === "author" ? "作者名写一行，最多 80 个字。" : (issue?.message ?? "有一项写得不对。")
}

/** Who the build names when the author is left empty: what the person asked to be called, else Studio's own name. */
export const authorPlaceholder = (nickname: string) => nickname.trim() || RELEASE_DEFAULTS.author
