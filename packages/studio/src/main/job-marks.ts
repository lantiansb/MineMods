import { buildStageWords } from "@minemods/mod-core/build-stages"
import { readCounter } from "@minemods/mod-core/progress-counter"
import { RUNTIME_TURN_LINE } from "@minemods/mod-core/runtime"
import { SCENE_WORDS } from "@minemods/mod-core/scene"

/** Moments of a job kept beside its detail, which is only the newest piece of output and so forgets everything before it. */
export type JobMarks = {
  turned_at?: string
  in_game_at?: string
  at_title_at?: string
  /** The newest counter the job wrote (「…：500 / 3888」, or how much a download folder has grown), and when its text last changed: the window says a step has stopped from these. */
  counter?: string
  counter_at?: string
}

/**
 * Notes what this piece of output says about the job, once: when a run that waited for the runtime got its turn (its time is counted from
 * there), and when the scene's game reached the world (or, before that, its title screen). broad7–9: the line saying the game was open was replaced by the game's next line a
 * moment later, before the drawer read it, three batches running; as a mark it stays until the job ends.
 */
export function markProgress(marks: JobMarks, detail: string, now = () => new Date().toISOString()): JobMarks {
  if (detail.includes(RUNTIME_TURN_LINE.trim())) marks.turned_at = now()
  if (detail.includes(SCENE_WORDS.in_game)) marks.in_game_at ??= now()
  if (detail.includes(SCENE_WORDS.at_title)) marks.at_title_at ??= now()
  // A counter is kept while it is the newest thing the job said about where it is, and dropped once the job says it has moved on (a build stage, or a plain sentence of
  // the service's own). Output in the tools' own English, retry notices included, is neither: a count that stands still while those go by is exactly what is to be noticed.
  const counter = readCounter(detail)
  if (counter) {
    if (marks.counter !== counter.text) marks.counter_at = now()
    marks.counter = counter.text
  } else if (marks.counter && (buildStageWords(detail) !== null || detail.split(/\r?\n/).some((line) => /[一-鿿]/.test(line) && !/[A-Za-z]/.test(line.trim())))) {
    delete marks.counter
    delete marks.counter_at
  }
  return marks
}
