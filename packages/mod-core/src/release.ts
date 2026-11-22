import { z } from "zod"

/**
 * What a released mod says about itself: who made it, which version it is, under which licence, and where
 * to find it. All of it is optional and absent in projects saved before it existed, which build exactly
 * as they did. No Node APIs: the app's window reads the lists too.
 */

/**
 * The licences a mod may name: SPDX identifiers, plus ARR for a mod that grants nothing. `name` is the
 * licence as its own text calls itself; `metadata` is what fabric.mod.json carries (an SPDX id, or the
 * string mod sites read as all rights reserved).
 */
export const RELEASE_LICENSES = {
  MIT: { name: "MIT License", metadata: "MIT" },
  "Apache-2.0": { name: "Apache License 2.0", metadata: "Apache-2.0" },
  "GPL-3.0-only": { name: "GNU General Public License v3.0 only", metadata: "GPL-3.0-only" },
  "LGPL-3.0-only": { name: "GNU Lesser General Public License v3.0 only", metadata: "LGPL-3.0-only" },
  "MPL-2.0": { name: "Mozilla Public License 2.0", metadata: "MPL-2.0" },
  "CC0-1.0": { name: "Creative Commons Zero v1.0 Universal", metadata: "CC0-1.0" },
  ARR: { name: "All rights reserved", metadata: "All-Rights-Reserved" },
} as const
export type ReleaseLicense = keyof typeof RELEASE_LICENSES

/** What every build said before a project could: kept for a project (or a field) that says nothing. */
export const RELEASE_DEFAULTS = { author: "MineMods Studio", version: "0.1.0", license: "MIT" } as const satisfies { author: string; version: string; license: ReleaseLicense }

// A link is shown to players by mod lists and opened in their browser: https only, and nothing a JSON or text file could be broken with.
const LinkSchema = z.string().max(300).regex(/^https:\/\/[^\s"<>\\]+$/, "链接要以 https:// 开头，中间不能有空格。").refine((value) => URL.canParse(value), "这不是一个能打开的链接。")
// One line, as it is printed into the licence file and the mod list.
export const ReleaseAuthorSchema = z.string().trim().min(1).max(80).regex(/^[^\u0000-\u001f\u007f]*$/, "作者名只能写一行。")

export const ReleaseSchema = z.strictObject({
  author: ReleaseAuthorSchema.optional(),
  // Three numbers and an optional suffix (1.2.0-beta.1): what Fabric Loader reads as a semantic version and Gradle puts in the jar's file name.
  version: z.string().max(40).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/, "版本号写成 1.0.0 这样的三段数字，后面可以加 -beta 这样的后缀。").optional(),
  license: z.enum(Object.keys(RELEASE_LICENSES) as [ReleaseLicense, ...ReleaseLicense[]]).optional(),
  homepage: LinkSchema.optional(),
  sources: LinkSchema.optional(),
  issues: LinkSchema.optional(),
  // 补字 (E19): what the build does with a character the game's fonts cannot draw. "sans" (and absent): draws it into the mod from an installed
  // SIL OFL font, 黑体 first; "serif": 宋体 first; "off": leaves it a box and only says so, as builds did before r29c.
  glyphs: z.enum(["sans", "serif", "off"]).optional(),
})
export type Release = z.infer<typeof ReleaseSchema>

/**
 * The icon the person gives a mod (as opposed to the one `modIcon` makes from an item picture).
 * Fabric reads `icon` from fabric.mod.json as a path to a PNG inside the jar. Mod lists draw it in a square
 * box of at most 64 game pixels, which is 128 real pixels at the usual GUI scale of 2, and Fabric's own example mod
 * ships a 128 × 128 icon. So 128 is the size Studio writes for a small picture and the smallest it keeps for a big one:
 * a picture that is not square would be squashed in that box, and one larger than 512 only makes the jar bigger.
 */
export const GIVEN_ICON = { shown: 128, largest: 512, smallSides: [16, 32, 64], maxBytes: 400 * 1024 } as const

export const ICON_WORDS = {
  unreadable: "这不是能读的 PNG 图片。图标要用 PNG 格式的图片。",
  tooBig: `这张图片文件太大了，图标不要超过 ${GIVEN_ICON.maxBytes / 1024} KB。`,
  notSquare: (width: number, height: number) => `图标要是正方形的，这张是 ${width} × ${height}。游戏的模组列表会把它画在一个正方形格子里，不是正方形就会被压扁。`,
  wrongSide: (side: number) =>
    `这张图每边 ${side} 个像素。图标每边要是 ${GIVEN_ICON.smallSides.join("、")}（会整数倍放大到 ${GIVEN_ICON.shown}，像素画不会糊），或者 ${GIVEN_ICON.shown} 到 ${GIVEN_ICON.largest}。`,
} as const

/** The width and height a PNG says it has in its header; null for anything that does not start like a PNG. No decoding: a window can ask this before it sends the file anywhere. */
export function pngSize(png: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (png.length < 24 || !signature.every((value, index) => png[index] === value)) return null
  const header = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return { width: header.getUint32(16), height: header.getUint32(20) }
}

/** What is wrong with a picture of this size as a mod icon, in words; empty when the size is fine (`givenIcon` still has to read the picture). */
export function iconSizeProblem(width: number, height: number) {
  if (width !== height) return ICON_WORDS.notSquare(width, height)
  const keep = width >= GIVEN_ICON.shown && width <= GIVEN_ICON.largest
  return keep || (GIVEN_ICON.smallSides as readonly number[]).includes(width) ? "" : ICON_WORDS.wrongSide(width)
}

/** The form a project keeps a given icon in: the PNG as a data URL, like its item and block pictures (the cap is the byte cap in base64). */
export const ICON_URL_PREFIX = "data:image/png;base64,"
export const IconUrlSchema = z.string().max(Math.ceil((GIVEN_ICON.maxBytes * 4) / 3) + 64).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/, "图标图片读不出来。")

/** The version a build of this project carries, in fabric.mod.json and in the jar's file name. */
export const modVersion = (project: { release?: Release | undefined }) => project.release?.version ?? RELEASE_DEFAULTS.version

/** The file Gradle writes for this project: `archives_base_name` (the mod id), a hyphen, `mod_version`. */
export const jarName = (project: { mod_id: string; release?: Release | undefined }) => `${project.mod_id}-${modVersion(project)}.jar`

/** The links a project gives, as fabric.mod.json's `contact`; undefined when it gives none, so no empty object is written. */
export function releaseContact(release: Release | undefined) {
  const contact = { ...(release?.homepage ? { homepage: release.homepage } : {}), ...(release?.sources ? { sources: release.sources } : {}), ...(release?.issues ? { issues: release.issues } : {}) }
  return Object.keys(contact).length ? contact : undefined
}

/**
 * The LICENSE file of a mod under a licence other than MIT (MIT's whole text is short and is the template's).
 * It names the licence and the author and says where the full text is; the full texts are long and are
 * not copied into every mod.
 */
export function licenseNotice(license: Exclude<ReleaseLicense, "MIT">, facts: { name: string; author: string; year: string }) {
  if (license === "ARR") return `Copyright (c) ${facts.year} ${facts.author}\n\nAll rights reserved.\n`
  return [
    facts.name,
    `Author: ${facts.author} (${facts.year})`,
    "",
    `Licensed under the ${RELEASE_LICENSES[license].name} (SPDX identifier: ${license}).`,
    `This file names the licence; its full text is at https://spdx.org/licenses/${license}.html`,
    "",
  ].join("\n")
}
