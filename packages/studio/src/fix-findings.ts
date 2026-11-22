import type { Finding } from "@minemods/mod-core/reconcile"
import type { SceneReport } from "@minemods/mod-core/scene"

/**
 * What the checks after a build found, sorted by the thing each finding is about and put into the words a
 * redo is started with. Before this, the findings of the mod guide and of the test scene stopped at the
 * screen: the person read them and typed each one again as a redo remark. Pure, and no Node APIs: the service
 * gathers the facts, the window shows the answer.
 */

export const FIX_WORDS = {
  /** How the remark of a redo started from findings begins: the person and the AI both see where the words come from. */
  lead: "打包以后检查发现：",
  whole: "整个模组",
  /** Why a finding about no one thing is left to the person. */
  general: (lines: readonly string[]) => `这${lines.length > 1 ? ` ${lines.length} 条` : "一条"}说的不是哪一样东西，没有哪一张卡片可以交给 AI 重做：${lines.join("")}`,
  unknown: "工程里找不到它对应的卡片，没法交给 AI 重做。",
  button: "把这些问题交给 AI 改",
  nothing: "现在没有查出问题，没有要交给 AI 改的。",
  started: (titles: readonly string[]) => `已经交给 AI 改：${titles.map((title) => `「${title}」`).join("、")}。`,
  recorded: (titles: readonly string[]) => `已经记到要改的东西上：${titles.map((title) => `「${title}」`).join("、")}。`,
  /** After `recorded`, by who will take them up. */
  outside: "回到你的 AI 窗口说一句「继续」，它会先改这几样，再重新打包、检查。",
  unconnected: "现在没连上 AI，连上以后就能让它改。",
  left: "这几条留给你自己看：",
  /** The sentence a person pastes to their own AI when the redos wait for an outside AI. */
  tell: (project: string, titles: readonly string[]) =>
    `MineMods 工程「${project}」打包以后，Studio 的检查发现了问题，我已经让它记到要改的东西上了：${titles.map((title) => `「${title}」`).join("、")}。请继续：先把这几样照记下的问题重做好，再重新打包、检查一遍。`,
  note: (started: number, left: number) => `把打包以后检查发现的问题交给 AI 改：${started} 样${left ? `，另有 ${left} 处留给你自己看` : ""}。`,
} as const

type About = NonNullable<Finding["about"]>
/** A thing of the project as the game knows it: `registry` is the name the test scene placed it by. */
export type FixContent = { kind: "entity" | "block" | "item"; id: string; name: string; registry: string }
/** A card of the overview, as far as a finding is matched to it. */
export type FixItem = { id: string; asset_id: string | null; kind: string; title: string; preview: { entity_id: string | null } }

const closed = (line: string) => (/[。！？]$/.test(line.trim()) ? line.trim() : `${line.trim()}。`)

/**
 * The card a finding's thing stands on: a creature's own card (it shares its id with its model, so the kind is
 * asked first), else the asset or old content of that id, else the card of that kind with that name.
 */
export function fixItem<Item extends FixItem>(about: About, items: readonly Item[]): Item | null {
  return (
    (about.kind === "entity" ? items.find((item) => item.kind === "entity" && item.preview.entity_id === about.id) : undefined) ??
    items.find((item) => item.kind === about.kind && (item.asset_id === about.id || item.id === `${about.kind}:${about.id}`)) ??
    items.find((item) => item.asset_id === about.id || item.id.endsWith(`:${about.id}`)) ??
    items.find((item) => item.kind === about.kind && item.title === about.name) ??
    null
  )
}

/**
 * Every finding under the card it is about. A test-scene thing is found in the project by the name the game
 * knows it by, else by its title; its sentences are the report's own (with what the game said), without the
 * registry name a person is never shown. What is about no one thing, or about a thing with no card, is not lost:
 * `general` and `unknown` are for the person.
 */
export function groupFindings<Item extends FixItem>(input: {
  guide: readonly Pick<Finding, "about" | "text" | "fix" | "redo">[]
  scene: Pick<SceneReport, "findings" | "things"> | null
  contents: readonly FixContent[]
  items: readonly Item[]
  /**
   * The game crashed the last time it was opened (broad18 w2, B18-J-08). `about` is the thing the crash report points at, when it points at one with a
   * card; `lines` are the crash in the words the AI is told (the game's own exception and place), `plain` the sentence the person is shown when no card can take it.
   */
  crash?: { about: About | null; title: string; lines: readonly string[]; plain: string } | null
}) {
  const scene = input.scene ?? { findings: [], things: [] }
  const placed = scene.things.flatMap((thing) => {
    const own = scene.findings.filter((line) => line.startsWith(`「${thing.title}」`))
    const content = input.contents.find((value) => value.registry === thing.id) ?? input.contents.find((value) => value.name === thing.title && (value.kind === "entity") === (thing.kind === "creature"))
    return own.length ? [{ own, lines: own.map((line) => line.replace(`（${thing.id}）`, "")), title: thing.title, about: content ? { kind: content.kind, id: content.id, name: content.name } : null }] : []
  })
  const told = new Set(placed.flatMap((value) => value.own))
  type Found = { about: About; title: string; lines: string[]; shown?: string[] }
  const found = [
    // A finding goes back to the thing it is about, or to the ones it names to put it right (`redo`): a motion made and never played is the gameplay's to play.
    ...input.guide.filter((finding) => finding.about).flatMap((finding): Found[] => (finding.redo?.length ? finding.redo : [finding.about!]).map((target) => ({ about: target, title: target.name, lines: [`${closed(finding.text)}${closed(finding.fix)}`] }))),
    ...placed.flatMap((value): Found[] => (value.about ? [{ about: value.about as About, title: value.title, lines: value.lines }] : [])),
    ...(input.crash?.about ? [{ about: input.crash.about, title: input.crash.title, lines: [...input.crash.lines], shown: [closed(input.crash.plain)] } satisfies Found] : []),
  ].map((value) => ({ ...value, item: fixItem(value.about, input.items) }))
  const things = found.reduce<{ item: Item; lines: string[] }[]>((groups, value) => {
    if (!value.item) return groups
    const group = groups.find((candidate) => candidate.item.id === value.item!.id)
    const fresh = value.lines.filter((line) => !group?.lines.includes(line))
    return group ? groups.map((candidate) => (candidate === group ? { ...group, lines: [...group.lines, ...fresh] } : candidate)) : [...groups, { item: value.item, lines: [...new Set(value.lines)] }]
  }, [])
  // What the person is shown for a thing without a card: for a crash its sentence, not the lines written for the AI.
  const without = [...found.filter((value) => !value.item).map((value) => ({ title: value.title, lines: value.shown ?? value.lines })), ...placed.filter((value) => !value.about).map((value) => ({ title: value.title, lines: value.lines }))]
  const unknown = without.reduce<{ title: string; lines: string[] }[]>((groups, value) => {
    const group = groups.find((candidate) => candidate.title === value.title)
    return group ? groups.map((candidate) => (candidate === group ? { ...group, lines: [...new Set([...group.lines, ...value.lines])] } : candidate)) : [...groups, { title: value.title, lines: [...new Set(value.lines)] }]
  }, [])
  // A crash the report does not tie to a card is about the mod as a whole: the person gets the sentence, never the AI's lines.
  const general = [...input.guide.filter((finding) => !finding.about).map((finding) => `${closed(finding.text)}${closed(finding.fix)}`), ...scene.findings.filter((line) => !told.has(line)).map(closed), ...(input.crash && !input.crash.about ? [closed(input.crash.plain)] : [])]
  return { things, unknown, general: [...new Set(general)] }
}

/** The remark a redo is started with: where the words come from, then each finding's own sentence, within what a remark may hold (`limit` characters). */
export function findingsFeedback(lines: readonly string[], limit: number) {
  const text = `${FIX_WORDS.lead}${lines.map(closed).join("")}`
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

export type FixFindingsResult = {
  /** The things a redo was started (or recorded) for: `thing` is the overview item's id. */
  started: { thing: string; title: string }[]
  /** What no redo was started for, with why, in plain words. */
  left: { title: string; why: string }[]
  /** Neither check has a finding for the project as it is now. */
  nothing: boolean
  /** The redos wait for an AI outside Studio (or for a connection): nothing is being made yet. */
  waiting: boolean
  /** When they wait for an outside AI: the sentence to paste to it. Null otherwise. */
  tell: string | null
}
