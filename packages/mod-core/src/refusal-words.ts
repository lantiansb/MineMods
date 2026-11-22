import { identifiersIn, mostlyCode } from "./play-words"

/**
 * A refusal is written to the outside AI that has to act on it, and names the next call by the name the AI calls it with and the document's
 * fields by their field names. The person reads the same sentence in 「最新动态」 and in a failed task's line. This module is where such a text
 * is made readable: the names Studio knows are said as what they are (`forPerson`), and a sentence that tells the AI what to call or to write
 * (a procedure, or anything that still carries a name of code) is kept for 高级 and not read out as the person's line (`refusalForPerson`).
 * Pure and without Node APIs: the activity log (mod-core) and the bridge's tool events (studio main) both use it.
 */

// A refusal names the next call by the name the AI calls it with. The person reads the same sentence in 「最新动态」: there each such name is said as
// what the step is. The sentence as it was sent stays in `detail`.
export const STEP_WORDS: Record<string, string> = {
  plan_run: "交计划",
  next_batch: "领下一批",
  claim_task: "接下这样东西",
  save_sheet: "交部件说明",
  look: "看图",
  self_review: "自评",
  final_review: "审查",
  await_inspection: "等审查",
  next_inspection: "领下一份审查",
  commit_task: "提交",
  fail_task: "说做不下去",
  check_code: "检查代码",
  build_project: "打包",
  check_scene: "后台检查",
  get_mod_guide: "读说明书",
}
const STEP_SOURCE = `(?<![\\w:])(?:${Object.keys(STEP_WORDS).sort((a, b) => b.length - a.length).join("|")})(?![\\w:])`
const STEP = new RegExp(STEP_SOURCE, "g")

// A refusal also names the document's fields (the gameplay description: slug, behaviours...). The person sees those as what they are in the card they
// can open, in plain Chinese; the names stay in `detail` for 高级. a31/a35: a person who could not read 「slug、name、summary、behaviours」 could not tell
// whether the AI was fixing it or stuck.
export const FIELD_WORDS: Record<string, string> = {
  slug: "标识",
  name: "名字",
  summary: "概要",
  behaviours: "会做的事",
  not_doing: "不做的事",
  uses: "用到的东西",
  sources: "代码文件",
  data: "数据文件",
  lang: "游戏里的文字",
  in_bounds: "越界检查",
  references: "引用检查",
  compiles: "编译检查",
}
// Words that are also plain English (name, uses, data...) are only turned when they stand in a list of field names written the way a refusal lists
// them (a, b、c); the ones that are never anything but a field name are turned wherever they stand.
const NEVER_PROSE = new Set(["slug", "behaviours", "not_doing", "in_bounds"])
const FIELD_LIST = /(?<![\w:])[a-z][a-z_]*(?:、[a-z][a-z_]*)+(?![\w:])/g
const FIELD_ALONE = new RegExp(`(?<![\\w:.])(?:${[...NEVER_PROSE].join("|")})(?![\\w:])`, "g")
const fieldsForPerson = (line: string) =>
  line
    .replace(FIELD_LIST, (run) => (run.split("、").every((name) => Object.hasOwn(FIELD_WORDS, name)) ? run.split("、").map((name) => FIELD_WORDS[name]).join("、") : run))
    .replace(FIELD_ALONE, (name) => FIELD_WORDS[name]!)

/** A line of a refusal with the step names and field names Studio knows said as what they are. */
export const forPerson = (line: string) => fieldsForPerson(line.replace(STEP, (name) => STEP_WORDS[name]!))

// What is left once the parts a person can read are blanked: commands between backticks, 「names」 and file names a person knows. Same length, so positions carry over.
const blanked = (text: string) =>
  text
    .replace(/`[^`\n]*`/g, (found) => " ".repeat(found.length))
    .replace(/「[^」\n]*」/g, (found) => " ".repeat(found.length))
    .replace(/[\w.-]+\.(?:jar|md|bbmodel|json|png)\b/g, (found) => " ".repeat(found.length))
// A bare lower-case word of three letters or more inside a Chinese sentence (abilities, hitbox, justified, what): the name of a field or of a thing to
// write, which `identifiersIn` does not see because it has no underscore, capital or brackets. Capitalised names (AI, Studio, Java) are words people know.
const BARE_NAME = /(?<![\w:.\-/])[a-z][a-z0-9]{2,}(?![\w:])/

/**
 * Whether a sentence of a refusal speaks to the AI and not to the person: it tells the AI which call to make or what to write (a step name), or it
 * still carries a name of code once the field names Studio knows were turned into words. Such a sentence is true and the AI needs it, but read
 * out as the person's line it is a procedure (「先 look，再 self_review、final_review，通过以后 commit_task」, 「文档里 abilities 不是空的，或者写了 hitbox」).
 */
export function speaksToAi(sentence: string): boolean {
  if (new RegExp(STEP_SOURCE).test(sentence)) return true
  const words = fieldsForPerson(sentence)
  return identifiersIn(words).length > 0 || BARE_NAME.test(blanked(words)) || mostlyCode(words)
}

/** The sentences of one line, each with the mark that ends it. */
const sentences = (line: string) => line.match(/[^。！？；;]+[。！？；;]?/g) ?? [line]

/** What stands in the person's lines where sentences were kept for 高级. */
export const withheldWords = (count: number) => `另有 ${count} 句是写给 AI 的操作步骤，打开「高级」能看到原文。`

/**
 * A refusal as the person reads it. `lines` are the sentences written in plain words, in their order, each line of the refusal cut down to those;
 * `withheld` is how many sentences were left out because they speak to the AI (see `speaksToAi`). The whole original stays in the event's `detail`.
 * Why sentence by sentence: a refusal usually says what is wrong first and then what the AI is to do about it; the first is for the person, the
 * second is the procedure. A text that is nothing but procedure leaves no line, and the caller says that in a sentence of its own.
 */
export function refusalForPerson(message: string): { lines: string[]; withheld: number } {
  const parts = message.split("\n").filter((line) => line.trim().length)
  const cut = parts.map((line) => sentences(line).map((sentence) => ({ sentence, ai: speaksToAi(sentence) })))
  return {
    lines: cut.map((line) => line.filter((part) => !part.ai).map((part) => forPerson(part.sentence)).join("").trim()).filter(Boolean),
    withheld: cut.flat().filter((part) => part.ai).length,
  }
}
