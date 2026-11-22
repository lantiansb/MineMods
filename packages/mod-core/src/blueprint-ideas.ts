import { readFile } from "node:fs/promises"
import { z } from "zod"
import { bare, ChangeSchema, changeSentences, CONSTRAINT_LIMITS, ConstraintSchema, LiftedSchema, lockedConstraints, mergeConstraints, quoted, sameWords, type Constraint, type RequirementChange } from "./blueprint-constraints"
import { storagePath, withProjectLock, writeRecord } from "./project"
import { assetKind, kindCapability, ModuleKindSchema, type TargetId } from "./workspace-modules"
import { appliesTo, ideaPlay, PLAY_MARKS, PLAY_QUESTIONS, PlayQuestionSchema } from "./playable"

/**
 * Idea cards: what a good mod author would think through when the person has not. From one sentence an AI
 * proposes groups (the things and aspects the sentence implies; it decides which) with two or three concrete
 * options each. Only the person chooses. Their choices become a summary they may edit, and that summary is
 * what the planner is given. Kept beside the project file, so a project from before this existed is untouched.
 * The record also holds the person's requirements (see `blueprint-constraints`), with or without cards.
 */
export const IDEA_LIMITS = { groups: 8, options: 3, lines: 4, questions: 6, own: 300, summary: 6000, things: 12, changes: 60 } as const

const Key = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/)
const Short = (max: number) => z.string().trim().min(1).max(max)

const OptionSchema = z.strictObject({
  id: Key,
  title: Short(40),
  /** Two to four short lines. `from` says whose it is: "you" repeats what the person said, "ai" is something the AI filled in. */
  lines: z
    .array(
      z.strictObject({
        text: Short(90),
        from: z.enum(["you", "ai"]),
        /** Which thing's which playability question this line answers (see `playable`). Absent on a line that answers none, and in records from before. */
        about: z.strictObject({ thing: Key, question: PlayQuestionSchema }).optional(),
      }),
    )
    .min(1)
    .max(IDEA_LIMITS.lines),
  recommended: z.boolean(),
  /** The kinds of asset it takes to build this option. Studio reads from them whether it can be built at all. */
  kinds: z.array(ModuleKindSchema).max(8),
  /** Set when part of it cannot be built: what cannot, and what will be made in its place. */
  limit: z.strictObject({ cannot: Short(120), instead: Short(120) }).nullable(),
})
const GroupSchema = z.strictObject({
  id: Key,
  title: Short(40),
  /** One line on what is being decided here. */
  about: z.string().trim().max(120),
  options: z.array(OptionSchema).min(2).max(IDEA_LIMITS.options),
})
const QuestionShape = { id: Key, ask: Short(240), change: Short(240) }
/** One thing the mod will have, as the player would name it. Its kind says which of the four questions it must answer. */
const ThingSchema = z.strictObject({ id: Key, title: Short(40), kind: ModuleKindSchema })
/** A question one of the person's requirements rules out for a thing: shown as 「按你的要求不做」, never answered by an AI. */
const RuledOutShape = { thing: Key, question: PlayQuestionSchema, reason: Short(160) }

/**
 * What an AI proposes. `constraints` are quotes from the sentence; `questions` are the only way to offer
 * something that would break one: each names the requirement by its place in `constraints` (0 for the first).
 */
export const IdeaProposalSchema = z.strictObject({
  constraints: z.array(Short(CONSTRAINT_LIMITS.text)).max(CONSTRAINT_LIMITS.constraints),
  groups: z.array(GroupSchema).min(1).max(IDEA_LIMITS.groups),
  questions: z.array(z.strictObject({ ...QuestionShape, constraint: z.number().int().min(0).max(CONSTRAINT_LIMITS.constraints - 1) })).max(IDEA_LIMITS.questions),
  things: z.array(ThingSchema).max(IDEA_LIMITS.things).optional(),
  declined: z.array(z.strictObject({ ...RuledOutShape, constraint: z.number().int().min(0).max(CONSTRAINT_LIMITS.constraints - 1) })).max(IDEA_LIMITS.things * 4).optional(),
})

const PickSchema = z.strictObject({
  group: Key,
  /** The chosen option; null with `own` empty means "none of these", null with words means the person wrote their own. */
  option: Key.nullable(),
  own: z.string().trim().max(IDEA_LIMITS.own),
})

export const IdeasSchema = z.strictObject({
  schema_version: z.literal(1),
  revision: z.number().int().min(1),
  /** The person's own sentence. Requirements of origin "said" are quotes from it. */
  request: z.string().trim().min(1).max(20000),
  by: z.enum(["studio", "outside"]),
  constraints: z.array(ConstraintSchema).max(CONSTRAINT_LIMITS.constraints),
  /** Empty when the person went straight to a plan without cards. */
  groups: z.array(GroupSchema).max(IDEA_LIMITS.groups),
  questions: z.array(z.strictObject({ ...QuestionShape, constraint: ConstraintSchema.shape.id })).max(IDEA_LIMITS.questions),
  /** The things the cards are about and the questions the person's own requirements close. Absent in records from before the playable standard. */
  things: z.array(ThingSchema).max(IDEA_LIMITS.things).optional(),
  declined: z.array(z.strictObject({ ...RuledOutShape, constraint: ConstraintSchema.shape.id })).max(IDEA_LIMITS.things * 4).optional(),
  // Everything below is the person's and is written only by the app.
  picks: z.array(PickSchema).max(IDEA_LIMITS.groups),
  answers: z.array(z.strictObject({ question: Key, yes: z.boolean(), at: z.iso.datetime() })).max(IDEA_LIMITS.questions),
  lifted: z.array(LiftedSchema).max(CONSTRAINT_LIMITS.constraints),
  /** What the person did to their requirements, oldest first (see `ChangeSchema`). Absent in records from before. */
  changes: z.array(ChangeSchema).max(IDEA_LIMITS.changes).default([]),
  /** The text the planner is given once the person says go; null until they have chosen. */
  summary: z.string().max(IDEA_LIMITS.summary).nullable(),
  /** "choosing": cards are on the table. "ready": the person said go. "used": a plan was stored from it. */
  state: z.enum(["choosing", "ready", "used"]),
  updated_at: z.iso.datetime(),
})

export type IdeaProposal = z.infer<typeof IdeaProposalSchema>
export type Ideas = z.infer<typeof IdeasSchema>
export type IdeaPick = z.infer<typeof PickSchema>

const SEGMENTS = [".minemods", "ideas.json"]
export const IDEAS_ARCHIVE_PATH = SEGMENTS.join("/")

/** Null when nothing was recorded, or when the file cannot be read as a record. */
export async function readIdeas(directory: string) {
  const text = await readFile(await storagePath(directory, SEGMENTS), "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "null"
    throw error
  })
  return IdeasSchema.safeParse(await Promise.resolve(text).then(JSON.parse).catch(() => null)).data ?? null
}

/** Read, change and store the record as one step. `change` may refuse by throwing; then nothing is written. */
export function changeIdeas(directory: string, change: (current: Ideas | null) => Ideas) {
  return withProjectLock(directory, async () => {
    const next = IdeasSchema.parse({ ...change(await readIdeas(directory)), updated_at: new Date().toISOString() })
    await writeRecord(directory, SEGMENTS, next)
    return next
  })
}

/** Whether a record is about this sentence: the sentence is the one it was made from, grew out of it, or is its summary. */
export function covers(record: Ideas | null, sentence: string): record is Ideas {
  return !!record && (quoted(sentence, record.request) || (!!record.summary && quoted(sentence, record.summary)))
}

/**
 * Every wording of the person's own sentence that Studio holds: the sentence, the summary they approved (possibly edited by hand), and the
 * request of the plan stored from it. Requirements said by the person are quotes from these, so a merge of requirements reads all of them.
 */
export function spokenText(record: Pick<Ideas, "request" | "summary"> | null, request?: string) {
  return [request, record?.request, record?.summary].filter((text): text is string => !!text).join("\n")
}

/**
 * The person's words, as far as Studio holds them for something that stands on them: a stored plan, or idea cards still being chosen or
 * approved but not yet planned. Null when nothing stands on them (no record, or the person threw the plan away and the last one is spent),
 * which is the person starting over. While words are held an outside AI cannot hand in others, since nobody but the person says what the
 * person said: it can only repeat them. (Studio's own AI is asked about the sentence the person typed, so it never holds this door.)
 */
export function heldWords(record: Ideas | null, blueprint?: { request: string }) {
  if (!blueprint && record?.state !== "choosing" && record?.state !== "ready") return null
  // The plan's own request counts only where the record does not speak for it: a summary the person has since changed must not be
  // replaced by the older one the plan was drawn from.
  const planned = blueprint && !covers(record, blueprint.request) ? blueprint.request : undefined
  return [...new Set([record?.request, record?.summary, planned].filter((text): text is string => !!text))]
}

/**
 * Two wordings that are not the same sentence, each cut down to the stretch around the first place they part: `CONTEXT` characters of what they share
 * before it and after it, and at most `SHOWN` of what differs. Both are read the way `sameWords` reads them, so a space or a quote mark is never the difference shown.
 * Cut from the front each would begin alike and read as one text (broad23: a sentence with something appended showed the same sixty characters twice).
 */
const CONTEXT = 12
const SHOWN = 40
export function whereTheyPart(held: string, asked: string) {
  const [left, right] = [bare(held), bare(asked)]
  let head = 0
  while (head < left.length && head < right.length && left[head] === right[head]) head += 1
  let tail = 0
  while (tail < left.length - head && tail < right.length - head && left[left.length - 1 - tail] === right[right.length - 1 - tail]) tail += 1
  const view = (text: string) => {
    const middle = text.slice(head, text.length - tail)
    const shown = middle.length > SHOWN ? `${middle.slice(0, SHOWN)}…` : middle
    return `${head > CONTEXT ? "…" : ""}${text.slice(Math.max(0, head - CONTEXT), head)}${shown}${text.slice(text.length - tail, text.length - tail + CONTEXT)}${tail > CONTEXT ? "…" : ""}`
  }
  return { held: view(left), asked: view(right), size: Math.max(left.length, right.length) - head - tail }
}

export const SENTENCE_REFUSALS = {
  /** For the person: what was tried, where the two wordings part, that nothing of theirs moved, and where they can add to it themselves. */
  person: (held: string, asked: string) => {
    const part = whereTheyPart(held, asked)
    return `AI 想把你的话换成别的。你原来说的是「${part.held}」，它交上来的是「${part.asked}」。你的话和要求都没有动，这一版没有保存；想补充什么，在 Studio 蓝图页的「你说的要求」里加一条。`
  },
  /** For the AI: how to hand it in so that it is taken, and where the person can change their words. */
  ai: `用户的话已经记在 Studio 里，AI 不能改写、加长或删短它。request 请原样填用户的话，不要自己重写：有想法记录的，填 get_ideas 里的 ideas.summary（选好以后）或 ideas.request；否则填 get_blueprint 里的 blueprint.request。用户想补充什么，请他自己在 Studio 蓝图页的「你说的要求」里加一条；想换成全新的想法，请他先在 Studio 里把现在的蓝图丢掉重新开始。`,
} as const

/**
 * What an outside AI says the person said, set against what Studio holds. Whatever is held is what gets used, never the AI's text:
 * the held wording that reads the same (spaces, quotes and closing punctuation set aside) is returned as the sentence to store.
 * Refused, with words for the person and for the AI, when it differs. With nothing held the AI's text is the first record of it.
 */
export function askedWords(held: string[] | null, asked: string): { request: string } | { person: string; ai: string } {
  if (!held) return { request: asked }
  const same = held.find((text) => sameWords(text, asked))
  // Of the wordings held, the one the AI's text is nearest to: that is the one it meant to repeat.
  const nearest = held.reduce((best, text) => (whereTheyPart(text, asked).size < whereTheyPart(best, asked).size ? text : best))
  return same ? { request: same } : { person: SENTENCE_REFUSALS.person(nearest, asked), ai: SENTENCE_REFUSALS.ai }
}

const DESIGN_ONLY = { instead: "只会存成设计稿，不会出现在游戏里" }

export const IDEA_REFUSALS = {
  things: "想法里没有列出这个模组会有哪几样东西（things），所以没有收下。每样东西都要列出来，并且在做法里回答它该回答的问题。",
  stray: (id: string) => `想法里有一行说的是没有列出来的东西（${id}），所以没有收下。`,
  unruled: "想法里有一处写着按用户的要求不做，可是指的不是用户提过的要求，所以没有收下。",
  smuggled: (title: string, label: string, text: string) => `你说过「${text}」，所以「${title}」的「${label}」按你的要求不做。想法里却又给它写了做法，等于悄悄改掉了你的要求，所以没有收下。想突破这条要求，只能写成一个问题让你自己决定。`,
  open: (lines: string[]) => `这些想法做出来还不能算一个能玩的模组，所以没有收下。下面每一处都要在某一组的推荐做法里有一行回答：\n${lines.map((line) => `- ${line}`).join("\n")}`,
} as const

/**
 * Store what an AI proposed, as cards for the person to choose from. The app decides what the AI may not:
 * - a requirement must be a quote from the sentence (throws otherwise), and the list the person already has is kept;
 * - an option that needs a kind this target cannot build is marked as not buildable, whatever the AI said,
 *   read from the registry at this moment; and it is never the recommended one;
 * - each group recommends exactly one option;
 * - nothing is chosen: picks, answers and the summary start empty.
 */
export function proposeIdeas(current: Ideas | null, input: { request: string; by: Ideas["by"]; proposal: IdeaProposal; target: TargetId }): Ideas {
  const proposal = IdeaProposalSchema.parse(input.proposal)
  const before = covers(current, input.request) ? current : null
  // Read against everything the person said, not only this sentence: a requirement quoted from their approved summary is still theirs.
  const constraints = mergeConstraints(spokenText(before, input.request), proposal.constraints, before?.constraints)
  const named = (text: string) => constraints.find((value) => quoted(value.text, text) && quoted(text, value.text))!
  if (new Set(proposal.groups.map((group) => group.id)).size !== proposal.groups.length) throw new Error("想法里有两组用了同一个标识。")
  const groups = proposal.groups.map((group) => {
    if (new Set(group.options.map((option) => option.id)).size !== group.options.length) throw new Error(`「${group.title}」里有两个选项用了同一个标识。`)
    const options = group.options.map((option) => {
      const unbuildable = option.kinds.filter((kind) => kindCapability(kind, input.target) !== "runtime")
      return {
        ...option,
        limit: option.limit ?? (unbuildable.length ? { cannot: `${[...new Set(unbuildable.map((kind) => assetKind(kind).label))].join("、")}现在做不进游戏`, ...DESIGN_ONLY } : null),
      }
    })
    const best = options.find((option) => option.recommended && !option.limit) ?? options.find((option) => !option.limit) ?? options[0]!
    return { ...group, options: options.map((option) => ({ ...option, recommended: option === best })) }
  })
  if (proposal.questions.some((question) => !proposal.constraints[question.constraint])) throw new Error("有一个问题问的不是你提过的要求。")
  const things = proposal.things ?? []
  const declined = proposal.declined ?? []
  if (!things.length) throw new Error(IDEA_REFUSALS.things)
  if (new Set(things.map((thing) => thing.id)).size !== things.length) throw new Error("想法里有两样东西用了同一个标识。")
  const lines = groups.flatMap((group) => group.options.flatMap((option) => option.lines.flatMap((line) => (line.about ? [{ ...line.about, recommended: option.recommended }] : []))))
  const stray = [...lines, ...declined].find((value) => !things.some((thing) => thing.id === value.thing))
  if (stray) throw new Error(IDEA_REFUSALS.stray(stray.thing))
  if (declined.some((value) => !proposal.constraints[value.constraint])) throw new Error(IDEA_REFUSALS.unruled)
  const title = (id: string) => things.find((thing) => thing.id === id)!.title
  // A question the person's own words closed is not answered on any card, recommended or not: lifting it is theirs alone.
  const smuggled = declined.find((value) => lines.some((line) => line.thing === value.thing && line.question === value.question))
  if (smuggled) throw new Error(IDEA_REFUSALS.smuggled(title(smuggled.thing), PLAY_QUESTIONS[smuggled.question].label, proposal.constraints[smuggled.constraint]!))
  const open = things.flatMap((thing) =>
    appliesTo(thing.kind)
      .filter((question) => !declined.some((value) => value.thing === thing.id && value.question === question) && !lines.some((line) => line.recommended && line.thing === thing.id && line.question === question))
      .map((question) => `「${thing.title}」的「${PLAY_QUESTIONS[question].label}」（${PLAY_QUESTIONS[question].asks}）`),
  )
  if (open.length) throw new Error(IDEA_REFUSALS.open(open))
  return IdeasSchema.parse({
    schema_version: 1,
    revision: (current?.revision ?? 0) + 1,
    request: input.request,
    by: input.by,
    constraints,
    groups,
    questions: proposal.questions.map((question) => ({ ...question, constraint: named(proposal.constraints[question.constraint]!).id })),
    things,
    declined: declined.map((value) => ({ ...value, constraint: named(proposal.constraints[value.constraint]!).id })),
    picks: [],
    answers: [],
    lifted: (before?.lifted ?? []).filter((entry) => constraints.some((value) => value.id === entry.constraint)),
    changes: before?.changes ?? [],
    summary: null,
    state: "choosing",
    updated_at: new Date().toISOString(),
  })
}

/** The requirements of a sentence the person takes straight to a plan, without cards. What they already settled about the same sentence stays. */
export function requireOnly(current: Ideas | null, input: { request: string; by: Ideas["by"]; quotes: string[] }): Ideas {
  const before = covers(current, input.request) ? current : null
  const constraints = mergeConstraints(spokenText(before, input.request), input.quotes, before?.constraints)
  return IdeasSchema.parse({
    schema_version: 1,
    revision: (current?.revision ?? 0) + 1,
    request: before?.request ?? input.request,
    by: input.by,
    constraints,
    groups: before?.groups ?? [],
    questions: before?.questions ?? [],
    ...(before?.things ? { things: before.things, declined: before.declined ?? [] } : {}),
    picks: before?.picks ?? [],
    answers: before?.answers ?? [],
    lifted: (before?.lifted ?? []).filter((entry) => constraints.some((value) => value.id === entry.constraint)),
    changes: before?.changes ?? [],
    // The summary the person approved (or edited by hand) is theirs; an outside AI's hand-in that repeats the sentence does not replace it.
    summary: input.by === "outside" ? (before?.summary ?? input.request) : input.request,
    state: "ready",
    updated_at: new Date().toISOString(),
  })
}

/**
 * The choices as one plain text, written by rule and not by a model: the person's sentence, then one line
 * per group. It is what the person edits and what the planner is given, so nothing is lost on the way.
 */
export function ideaSummary(record: Pick<Ideas, "request" | "groups" | "picks"> & Partial<Pick<Ideas, "things" | "declined" | "constraints" | "lifted">>) {
  const lines = record.groups.flatMap((group) => {
    const pick = record.picks.find((value) => value.group === group.id)
    const option = group.options.find((value) => value.id === pick?.option)
    if (option) return [`- ${group.title}：${option.title}。${option.lines.map((line) => line.text).join("；")}${option.limit ? `（${option.limit.cannot}，用这个代替：${option.limit.instead}）` : ""}`]
    if (pick?.own) return [`- ${group.title}：${pick.own}`]
    return pick ? [`- ${group.title}：这次不要`] : []
  })
  // The four questions per thing, as the choices answer them: the planner must keep these and fill what is still open.
  const play = ideaPlay(record).things.map((thing) => `- ${thing.title}｜${thing.rows.map((row) => `${row.label}：${row.state === "answered" ? `${row.lines.join("；")}（${PLAY_MARKS[row.mark]}）` : row.state === "declined" ? `${PLAY_MARKS[row.mark]}（${row.lines[0]}）` : PLAY_MARKS.gap}`).join("｜")}`)
  return [record.request, ...(lines.length ? ["", "我选的做法：", ...lines] : []), ...(play.length ? ["", "每样东西怎么玩：", ...play] : [])].join("\n").slice(0, IDEA_LIMITS.summary)
}

export type IdeaChoice = {
  /** The revision the person was looking at. */
  revision: number
  picks?: IdeaPick[]
  /** Question id to yes or no. Yes gives the requirement up, in exchange for what the question said would change. */
  answers?: Record<string, boolean>
  /** Requirements the person gives up of their own accord, and ones they take back. */
  lift?: string[]
  restore?: string[]
  /** A requirement the person types in themselves. */
  add?: string
  /**
   * The person rewords a requirement. The old line is given up, with the new words as what they agreed to instead, and the new words become a
   * new line of their own (see `ConstraintSchema.replaces`): a plan compared against the old words has not answered them.
   */
  reword?: { id: string; text: string }[]
  /** The person's edit of the summary. Absent: the summary follows the choices. */
  summary?: string
  /** "就按这个做": the summary is final and the planner may be given it. */
  ready?: boolean
}

/** `IdeaChoice` as the app's own door checks it. */
export const IdeaChoiceShape = {
  revision: z.number().int().min(1),
  picks: z.array(PickSchema).max(IDEA_LIMITS.groups).optional(),
  answers: z.record(Key, z.boolean()).optional(),
  lift: z.array(ConstraintSchema.shape.id).max(CONSTRAINT_LIMITS.constraints).optional(),
  restore: z.array(ConstraintSchema.shape.id).max(CONSTRAINT_LIMITS.constraints).optional(),
  add: z.string().trim().max(CONSTRAINT_LIMITS.text).optional(),
  reword: z.array(z.strictObject({ id: ConstraintSchema.shape.id, text: z.string().trim().min(1).max(CONSTRAINT_LIMITS.text) })).max(CONSTRAINT_LIMITS.constraints).optional(),
  summary: z.string().max(IDEA_LIMITS.summary).optional(),
  ready: z.boolean().optional(),
}

/** The person's own part of the record. Nothing an AI is offered leads here. */
export function chooseIdeas(record: Ideas | null, input: IdeaChoice): Ideas {
  if (!record) throw new Error("还没有想法可以选。")
  if (record.revision !== input.revision) throw new Error("想法刚刚更新过，请看一眼最新的再选。")
  const at = new Date().toISOString()
  const picks = input.picks ?? record.picks
  const stray = picks.find((pick) => !record.groups.some((group) => group.id === pick.group && (pick.option === null || group.options.some((option) => option.id === pick.option))))
  if (stray) throw new Error("选的那一项已经不在了，请重新选一次。")
  const answered = Object.entries(input.answers ?? {}).flatMap(([id, yes]) => {
    const question = record.questions.find((value) => value.id === id)
    return question ? [{ question, yes }] : []
  })
  const added = input.add?.trim().slice(0, CONSTRAINT_LIMITS.text)
  const nextId = (list: Constraint[]) => `c${Math.max(0, ...list.map((value) => Number(value.id.slice(1)))) + 1}`
  const full = () => new Error(`要求最多 ${CONSTRAINT_LIMITS.constraints} 条，不要了和改过的也占着位置（好让你随时看到改过什么）。`)
  const changes: RequirementChange[] = []
  const wasLifted = (id: string) => record.lifted.some((entry) => entry.constraint === id)
  // A rewording is a new line that replaces the old one, which is given up: ids keep meaning the words they were made for.
  const reworded: { from: string; text: string }[] = []
  let constraints: Constraint[] = record.constraints
  for (const edit of input.reword ?? []) {
    const old = constraints.find((value) => value.id === edit.id)
    const text = edit.text.trim().slice(0, CONSTRAINT_LIMITS.text)
    if (!old) throw new Error("这一条要求已经不在了，请看一眼最新的再改。")
    if (!text) throw new Error("新的要求不能是空的。")
    if (wasLifted(old.id) || reworded.some((value) => value.from === old.id)) throw new Error("这一条已经不要了。想换个说法，就在下面「再加一条要求」里写新的。")
    if (sameWords(old.text, text)) throw new Error("和原来的话一样，没有改。")
    if (constraints.length >= CONSTRAINT_LIMITS.constraints) throw full()
    const created: Constraint = { id: nextId(constraints), text, origin: "added", replaces: old.id }
    constraints = [...constraints, created]
    reworded.push({ from: old.id, text })
    changes.push({ at, kind: "reword", constraint: created.id, from: old.id, was: old.text, now: text, answered: false })
  }
  if (added && !constraints.some((value) => value.text === added)) {
    if (constraints.length >= CONSTRAINT_LIMITS.constraints) throw full()
    const created: Constraint = { id: nextId(constraints), text: added, origin: "added" }
    constraints = [...constraints, created]
    changes.push({ at, kind: "add", constraint: created.id, from: null, was: null, now: added, answered: false })
  }
  // Saying yes to a question gives that requirement up; saying no, or taking it back, locks it again.
  const dropped = [...(input.restore ?? []), ...answered.map((value) => value.question.constraint), ...(input.lift ?? [])]
  const given = (input.lift ?? []).filter((id) => constraints.some((value) => value.id === id) && !answered.some((value) => value.yes && value.question.constraint === id))
  given.filter((id) => !wasLifted(id)).forEach((id) => changes.push({ at, kind: "drop", constraint: id, from: null, was: constraints.find((value) => value.id === id)!.text, now: null, answered: false }))
  ;(input.restore ?? []).filter((id) => wasLifted(id) && constraints.some((value) => value.id === id)).forEach((id) => changes.push({ at, kind: "restore", constraint: id, from: null, was: null, now: constraints.find((value) => value.id === id)!.text, answered: false }))
  const lifted = [
    ...record.lifted.filter((entry) => !dropped.includes(entry.constraint)),
    ...answered.filter((value) => value.yes).map((value) => ({ constraint: value.question.constraint, change: value.question.change, at })),
    ...given.map((id) => ({ constraint: id, change: "", at })),
    ...reworded.map((value) => ({ constraint: value.from, change: value.text, at })),
  ]
  const next = {
    ...record,
    constraints,
    picks,
    answers: [...record.answers.filter((value) => !answered.some((entry) => entry.question.id === value.question)), ...answered.map((value) => ({ question: value.question.id, yes: value.yes, at }))],
    lifted,
    changes: [...record.changes, ...changes].slice(-IDEA_LIMITS.changes),
  }
  const summary = input.summary?.trim() ? input.summary.trim().slice(0, IDEA_LIMITS.summary) : record.summary !== null && input.picks === undefined ? record.summary : ideaSummary(next)
  if (input.ready && next.groups.some((group) => !picks.some((pick) => pick.group === group.id))) throw new Error("还有几组没有选。每一组选一个，或者点「都不要」。")
  if (input.ready && next.questions.some((question) => !next.answers.some((value) => value.question === question.id))) throw new Error("AI 有一个要你亲自决定的问题还没有回答。")
  // Words about the requirements alone do not reopen the cards: a plan already drawn from them is still the plan, only held to a new list.
  const onlyRequirements = input.picks === undefined && !input.answers && input.summary === undefined && !input.ready
  return IdeasSchema.parse({ ...next, summary, state: input.ready ? "ready" : record.state === "used" && !onlyRequirements ? "choosing" : record.state, updated_at: at })
}

/**
 * A record for a plan that has none: the plan was made from a free-text conception, or came before requirements were kept. It lists nothing the
 * person did not choose to write: no limiting clause is found by rule in the plan's sentence, since the plan never answered one.
 */
export function bareIdeas(input: { request: string; by: Ideas["by"] }): Ideas {
  return IdeasSchema.parse({
    schema_version: 1,
    revision: 1,
    request: input.request,
    by: input.by,
    constraints: [],
    groups: [],
    questions: [],
    picks: [],
    answers: [],
    lifted: [],
    summary: input.request,
    state: "used",
    updated_at: new Date().toISOString(),
  })
}

/**
 * A plan was stored. `held` is the record it was held to (the one the AI planned against): the changes the person had made by then were all
 * answered by that plan, so nobody needs to be told of them again. A change made while the plan was being drawn is not in `held` and stays
 * to be told, since the plan never saw it.
 */
export function planStored(latest: Ideas, held: Pick<Ideas, "changes"> = latest): Ideas {
  const seen = (change: Ideas["changes"][number]) => held.changes.some((value) => value.at === change.at && value.kind === change.kind && value.constraint === change.constraint)
  return { ...latest, state: "used", changes: latest.changes.map((change) => (seen(change) ? { ...change, answered: true } : change)) }
}

/** What an AI is shown of the record: the cards, what the person chose, and the requirements still in force. Never anything it could choose with. */
export function shownIdeas(record: Ideas) {
  return { ...record, locked: lockedConstraints(record.constraints, record.lifted), changed: changeSentences(record.changes) }
}
