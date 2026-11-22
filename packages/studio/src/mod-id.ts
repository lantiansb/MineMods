// The mod id of a new project, worked out from its name so the person is asked for one thing only.
// Studio always sends the id it shows: mod-core's own default uses a random tail for a name with no Latin letters,
// so a preview could not match it.

/** mod-core's rule for an id given explicitly (packages/mod-core/src/project.ts createProject): Fabric Loader refuses a single character. */
export const MOD_ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/
// The 64 characters MOD_ID_PATTERN allows: one letter plus up to 63 more.
const MOD_ID_MAX = 64
// 32 bits written in base 36 take at most 7 characters (36^7 > 2^32); padded so every hashed id has one length.
const HASH_LENGTH = 7

/** FNV-1a over the name's UTF-16 units: the same name always gives the same id, on any machine. */
function nameHash(name: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < name.length; index++) hash = Math.imul(hash ^ name.charCodeAt(index), 0x01000193) >>> 0
  return hash.toString(36).padStart(HASH_LENGTH, "0")
}

/** The id a project of this name gets unless the person writes their own. Always matches MOD_ID_PATTERN. */
export function deriveModId(name: string) {
  const trimmed = name.trim()
  const ascii = trimmed
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  // Fewer than two usable characters says nothing about the name (a Chinese name leaves none): a stable hash instead.
  if (ascii.length < 2) return `mod_${nameHash(trimmed)}`
  return (/^[a-z]/.test(ascii) ? ascii : `mod_${ascii}`).slice(0, MOD_ID_MAX).replace(/_+$/, "")
}

export const MOD_ID_WORDS = {
  explain: "游戏里用来认这个模组的英文短名：只能用小写字母、数字和下划线，建好以后不能再改。",
  empty: "留空就用自动起的这个名字。",
  short: "英文短名至少要两个字符。",
  long: "英文短名最多 64 个字符。",
  start: "英文短名要用小写英文字母开头。",
  characters: "英文短名只能用小写英文字母、数字和下划线，不能有空格、中文和大写字母。",
} as const

/** What is wrong with an id the person typed, in their words; "" when it can be used. */
export function modIdProblem(id: string) {
  if (MOD_ID_PATTERN.test(id)) return ""
  if (/[^a-z0-9_]/.test(id)) return MOD_ID_WORDS.characters
  if (!/^[a-z]/.test(id)) return MOD_ID_WORDS.start
  return id.length < 2 ? MOD_ID_WORDS.short : MOD_ID_WORDS.long
}

/** The id to create with: what the person wrote under 高级, or the derived one when they wrote nothing. */
export const chosenModId = (name: string, typed: string | null) => typed?.trim() || deriveModId(name)
