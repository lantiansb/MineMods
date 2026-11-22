/**
 * The sentence a person wrote about the mod they want, in the box on the project's first page. It is the one source for every way it travels: handed to
 * Studio's own AI by the button, copied for an outside AI by the button, and carried in the outside AI's starting instruction when it is copied from the
 * connection page before the sentence was handed anywhere (broad23: the AI opened the project and reported "没有具体需求" while the words still sat in the box).
 *
 * It is kept per project in this window's memory and in the window's own storage, so a sentence written before an AI was connected is still there after Studio
 * is closed. Where storage cannot be read or written (a private window, blocked site data) the memory alone carries it.
 */
type Written = { text: string; handed: boolean }

const PREFIX = "minemods.sentence."
const held = new Map<string, Written>()

const read = (projectId: string): Written | null => {
  const here = held.get(projectId)
  if (here) return here
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(`${PREFIX}${projectId}`) ?? "null")
    if (parsed && typeof parsed === "object" && typeof (parsed as Written).text === "string") {
      const found = { text: (parsed as Written).text, handed: (parsed as Written).handed === true }
      held.set(projectId, found)
      return found
    }
  } catch {
    // Storage that cannot be read leaves only the memory.
  }
  return null
}

const keep = (projectId: string, value: Written) => {
  held.set(projectId, value)
  try {
    if (value.text.trim()) globalThis.localStorage?.setItem(`${PREFIX}${projectId}`, JSON.stringify(value))
    else globalThis.localStorage?.removeItem(`${PREFIX}${projectId}`)
  } catch {
    // The memory has it.
  }
}

/** The sentence as it stands in the box, whether or not it has been handed to an AI. */
export const sentenceFor = (projectId: string) => read(projectId)?.text ?? ""

/** The person wrote or changed the sentence: it has not gone anywhere in this form. */
export const writeSentence = (projectId: string, text: string) => keep(projectId, { text, handed: false })

/** The sentence was handed to an AI (Studio's own, or copied for an outside one): it travels as the plan from now on. */
export const handSentence = (projectId: string) => {
  const found = read(projectId)
  if (found && !found.handed) keep(projectId, { ...found, handed: true })
}

/** What the person has written and no AI has been given yet; empty when there is none. */
export const pendingSentence = (projectId: string) => {
  const found = read(projectId)
  return found && !found.handed ? found.text.trim() : ""
}

/**
 * The words that go in front of an outside AI's instructions when it is asked to draw the plan from the sentence: the same words whichever button copies them
 * (「直接做（复制）」, 「先出几个想法，复制给我的 AI」, or the starting instruction copied on the connection page).
 */
export const askForPlan = (projectName: string, request: string, kind: "plan" | "ideas" = "plan") =>
  kind === "ideas"
    ? `请给 MineMods 工程「${projectName}」出想法卡片：把我这句话里没说清的地方替我想一遍，用 propose_ideas 提交给 Studio，然后停下来等我在 Studio 里选。我选好以后会告诉你，那时再出蓝图。\n\n我想做的模组：${request}`
    : `请给 MineMods 工程「${projectName}」做一份蓝图：先把蓝图草稿提交给 Studio，然后停下来等我在 Studio 里确认，确认之前不要开始制作。\n\n我想做的模组：${request}`

/**
 * What the starting instruction copied on the connection page carries besides the role: the sentence written for this project and not handed to any AI yet, worded
 * as the 「直接做（复制）」 button words it, and only while the project has no plan (the window does not know that; `ifNoPlan` makes Studio's main process check it).
 * The reviewer's instruction carries nothing.
 */
export function handoffRequest(project: { id: string; name: string } | null | undefined, role?: "maker" | "reviewer") {
  const written = role === "reviewer" || !project ? "" : pendingSentence(project.id)
  return { ...(role ? { role } : {}), ...(written ? { request: askForPlan(project!.name, written), ifNoPlan: true } : {}) }
}
