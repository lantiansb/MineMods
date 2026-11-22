import { z } from "zod"
import { ISSUE_RULES } from "../renderer/features/asset-edit-words"

/** What a schema error that has no sentence of its own is said as. */
export const SCHEMA_WORDS = "提交内容或文件格式不符合要求，请检查名称、属性范围和模型数据。"

// What mod-core says when hand-edited content names something that is not there, and how a player is told.
// `who` is the thing being saved, `what` the name it asked for. Kept beside the plan's words: one place for both.
const CONTENT_WORDS: [string, (who: string, what: string) => string][] = [
  ["Unknown content reference: ", (who, what) => `${who}用到了「${what}」，可是模组里没有叫这个名字的方块或物品。先把它做出来，或者换成一样已经有的。`],
  ["Unknown entity reference: ", (who) => `${who}要找的那只生物已经不在了。给它换一只生物，或者把这条规则删掉。`],
  ["Death drop references a missing or non-lucky block: ", (who, what) => `${who}被打倒以后要掉盲盒「${what}」，可是这个盲盒方块不见了，或者已经不是盲盒了。先到生物那里换掉它，再来改这个方块。`],
  ["Duplicate content identifier", () => "有两样东西用了同一个英文短名。给其中一样换个名字再保存。"],
]

type NamedContent = { recipes: { name: string }[]; entities: { name: string }[] }

/** The plain sentence for one finding of mod-core about content, or null when it is about something else. The finding's path says whose it is; its message is read without it. */
function plainFinding(issue: { path: PropertyKey[]; message: string }, named?: NamedContent) {
  const words = CONTENT_WORDS.find(([prefix]) => issue.message.startsWith(prefix))
  // Data-only gameplay (Engineer C): what mod-core says about a block's drops, tool tier and generation is already written for the person.
  if (!words && /^(?:盲盒)?方块「/.test(issue.message) && issue.path[0] === "blocks") return issue.message
  if (!words) return null
  const name = named?.[issue.path[0] === "entities" ? "entities" : "recipes"][Number(issue.path[1])]?.name
  const who = { recipes: `配方${name ? `「${name}」` : ""}`, logic: "有一条玩法规则", entities: `生物${name ? `「${name}」` : ""}` }[String(issue.path[0])] ?? "这里"
  // A name inside this mod is shown without the mod's own prefix, the way the person typed it.
  return words[1](who, issue.message.slice(words[0].length).split(":").at(-1)!)
}

/** The plain sentence for a broken reference in content, or null when the error is about something else. */
export function plainContent(error: unknown, named?: NamedContent) {
  const issue = error instanceof z.ZodError ? error.issues[0] : undefined
  return issue ? plainFinding(issue, named) : null
}

/** Whether a message is already written in Chinese for the person (mod-core's own sentences about a thing by its name). */
const IN_CHINESE = /[\u4e00-\u9fff]/

/**
 * Why a version cannot be saved, in a person's words: every finding of the save said on its own, whatever field it was found at, so the
 * path (`recipes.0.result`) is never part of what is matched. A finding with a sentence of the content words or of the hand-editing form is
 * said with it; one already in Chinese is shown as it is; any other schema finding is said as publicError says a schema error.
 */
export function plainSave(error: unknown, named?: NamedContent) {
  const issues = error instanceof z.ZodError ? error.issues.slice(0, 8).map((issue) => ({ path: issue.path, message: issue.message })) : [{ path: [] as PropertyKey[], message: error instanceof Error ? error.message : String(error) }]
  const sentence = (issue: (typeof issues)[number]) => {
    const said = plainFinding(issue, named) ?? ISSUE_RULES.find(([test]) => test.test(issue.message))?.[1]
    if (said) return said
    return IN_CHINESE.test(issue.message) || !(error instanceof z.ZodError) ? issue.message : SCHEMA_WORDS
  }
  const said = [...new Set(issues.map(sentence))].join("")
  return /[。！？.!?]$/.test(said) ? said : `${said}。`
}
