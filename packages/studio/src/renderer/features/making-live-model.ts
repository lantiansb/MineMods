import type { ActivityEvent } from "../../api"
import { documentParts, type MakingTrace, type TraceStep } from "../../making-trace"
import { isIdentifier } from "./asset-words"

/**
 * How 制作现场 reads what is recorded of one thing. Pure, so it can be checked without a screen. Nothing here makes a fact up: a number that cannot be counted is not said,
 * and a stage nobody can tell the state of stays as it was.
 */
export type RoadState = "done" | "now" | "todo"
export type RoadStop = { id: "views" | "shape" | "paint" | "motion" | "review" | "made"; label: string; state: RoadState }

type Doc = { bones?: { cubes?: unknown[] }[]; animations?: unknown[] }
const painted = (document: unknown) => /"(colou?r|paint|faces?|details?|material)"\s*:/.test(JSON.stringify((document as Doc | null)?.bones ?? []))
const shaped = (document: unknown) => !!(document as Doc | null)?.bones?.some((bone) => bone.cubes?.length)
const moving = (document: unknown) => !!(document as Doc | null)?.animations?.length

/** The stops one thing passes through: 六视图 → 建模（第 N 版）→ 上色 → 动作 → 审查 for a model, and what applies of that for the rest. */
export function roadOf(input: { kind: string; making: boolean; version: number; sixView: boolean; document: unknown; steps: readonly TraceStep[]; review: { passed: boolean } | null }): RoadStop[] {
  const version = input.version > 0 ? ` · 第 ${input.version} 版` : ""
  const last = input.steps.at(-1)
  const lastWrite = [...input.steps].reverse().find((step) => step.areas.length)
  const reviewed = !!input.review?.passed
  const stops: (RoadStop & { did: boolean })[] =
    input.kind === "model"
      ? [
          { id: "views", label: "六视图", state: "todo", did: input.sixView },
          { id: "shape", label: `建模${version}`, state: "todo", did: shaped(input.document) },
          { id: "paint", label: "上色", state: "todo", did: painted(input.document) },
          { id: "motion", label: "动作", state: "todo", did: moving(input.document) },
          { id: "review", label: "审查", state: "todo", did: reviewed },
        ]
      : input.kind === "texture"
        ? [
            { id: "paint", label: `上色${version}`, state: "todo", did: !!input.document },
            { id: "review", label: "审查", state: "todo", did: reviewed },
          ]
        : input.kind === "animation"
          ? [
              { id: "motion", label: `动作${version}`, state: "todo", did: !!input.document },
              { id: "review", label: "审查", state: "todo", did: reviewed },
            ]
          : [
              { id: "made", label: `制作${version}`, state: "todo", did: !!input.document },
              { id: "review", label: "审查", state: "todo", did: reviewed },
            ]
  if (!input.making) return stops.map(({ did, ...stop }) => ({ ...stop, state: did ? "done" : "todo" }))
  // One write can touch several: its shape says the most about where the making stands.
  const area = lastWrite?.areas[0]
  const wanted = last?.kind === "review" ? "review" : area === "motion" ? "motion" : area === "paint" ? "paint" : area === "shape" ? "shape" : stops.find((stop) => !stop.did && stop.id !== "views")?.id
  const at = stops.findIndex((stop) => stop.id === wanted)
  const now = at >= 0 ? at : stops.findIndex((stop) => stop.id !== "views")
  return stops.map(({ did, ...stop }, index) => ({ ...stop, state: index === now ? "now" : index < now && did ? "done" : "todo" }))
}

type Part = { name: string; what?: string }
/** A part by the name a person reads: its own when it has one in words, else what the sheet says it is, cut to the first phrase; the name it was given when there is nothing better. */
export function partTitle(name: string, parts: readonly Part[] | null | undefined) {
  if (!isIdentifier(name)) return name
  const said = parts?.find((part) => part.name === name)?.what?.trim()
  if (!said) return name
  const phrase = said.split(/[，。；、,.;]/)[0]!.trim()
  return (phrase || said).slice(0, 16)
}

/** What the hand is on. With a list of parts: which of how many, counted from the list and what the document holds. Without one: its name, and no number. */
export function partProgress(input: { parts: readonly Part[] | null | undefined; document: unknown; current: readonly string[] }) {
  const parts = input.parts ?? []
  const name = input.current[0]
  const has = new Set(documentParts(input.document))
  // A list whose names the model never uses (the person's words for the parts, the AI's names for the bones) cannot say what is still to come: nothing is said.
  const left = parts.some((part) => has.has(part.name)) ? parts.filter((part) => !has.has(part.name)).map((part) => partTitle(part.name, parts)) : []
  if (!name) return { name: null, line: null, count: null, left }
  const title = partTitle(name, parts)
  const listed = parts.some((part) => part.name === name)
  // A bone's own name is the AI's, not the person's: it is not put in front of them.
  if (!listed) return { name: title, line: isIdentifier(title) ? "正在搭新的部件" : `正在做：${title}`, count: null, left }
  const count = { at: parts.filter((part) => has.has(part.name) || part.name === name).length, of: parts.length }
  return { name: title, line: `正在做：${title} · 第 ${count.at} 块 / 共 ${count.of} 块`, count, left }
}

/** What the AI said it is doing, in its own words if it has any; else what the record last said in plain words. Never written for it. */
export function thinkingLine(trace: Pick<MakingTrace, "steps" | "thought"> | null, events: readonly ActivityEvent[]) {
  const said = [...(trace?.steps ?? [])].reverse().find((step) => step.note)
  const thought = trace?.thought
  if (said || thought) {
    const fresher = thought && (!said || thought.at >= said.at)
    return { own: true, text: fresher ? thought!.text : said!.note!, at: fresher ? thought!.at : said!.at }
  }
  const last = [...events].reverse().find((event) => !event.quiet)
  return last ? { own: false, text: last.text, at: last.at } : null
}

export type PassageTag = "写入" | "看图" | "改" | "审查" | "开始"
export type PassageRow = { key: string; at: string; tag: PassageTag; text: string }

/** What kind of step a line of the record is. */
function passageTag(event: Pick<ActivityEvent, "kind" | "tool" | "text" | "mark">): PassageTag {
  if (event.kind === "look" || event.tool === "look") return "看图"
  if (event.kind === "review") return "审查"
  if (event.kind === "person") return "改"
  if (/^(领了|开始|接下了)/.test(event.text)) return "开始"
  if (event.mark === "fail" || /退回|按意见改|要改/.test(event.text)) return "改"
  return "写入"
}

/** 「这一样的经过」: newest first, one line each: the record of the thing, with each write the record itself only mentions as a sign of life. */
export function passageRows(events: readonly ActivityEvent[], steps: readonly TraceStep[], title: (part: string) => string = (part) => part, advanced = false): PassageRow[] {
  // Studio's own line for a progress report with no words of the AI's in it says nothing about the thing.
  const said = events.filter((event) => advanced || (!event.quiet && !/^外部模型(进度|正在处理|已领取)/.test(event.text))).map((event): PassageRow => ({ key: `e${event.seq}`, at: event.at, tag: passageTag(event), text: event.text }))
  const wrote = steps.filter((step) => step.kind === "write").map((step): PassageRow => ({ key: `s${step.seq}`, at: step.at, tag: "写入", text: step.note ?? (step.parts.length ? step.parts.slice(0, 4).map(title).join("、") : "写了一版") }))
  // A write whose words the record also carries (the task's own line) is one thing that happened, said once.
  const told = new Set(said.map((row) => row.text))
  return [...said, ...wrote.filter((row) => !told.has(row.text))].sort((left, right) => right.at.localeCompare(left.at) || right.key.localeCompare(left.key))
}

/** The step the timeline stands on: `seq` when it is a place on it, else the newest. */
export const stepAt = (steps: readonly TraceStep[], seq: number | null) => (seq === null ? steps.at(-1) : (steps.find((step) => step.seq === seq) ?? steps.at(-1))) ?? null

/** The step whose copy shows the model at `seq`: that step, or the nearest before it that kept one. */
export const copyAt = (steps: readonly TraceStep[], seq: number | null) => [...steps].reverse().find((step) => step.copy && (seq === null || step.seq <= seq)) ?? null

/** The parts the hand was last on at `seq`: a look or a review writes nothing, so it points at what was written before it. */
export const partsAt = (steps: readonly TraceStep[], seq: number | null) => [...steps].reverse().find((step) => step.parts.length && (seq === null || step.seq <= seq))?.parts ?? []
