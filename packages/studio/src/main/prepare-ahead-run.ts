import { readCounter } from "@minemods/mod-core/progress-counter"
import { AHEAD_LOOK_MS, AHEAD_WORDS, aheadRetryIn, aheadSteps, aheadWhy, type AheadFacts, type AheadStep } from "../prepare-ahead"

/**
 * What one step is given: a way to stop it, a place for what it says as it goes (the counters and lines the pack's own downloads write), and a way to say that something
 * the window shows has changed in the middle of the step (Studio's own Java was installed on the way: the line that said none was found is out of date now).
 */
export type AheadRun = { signal: AbortSignal; onProgress: (text: string) => void; changed: () => void }
export type AheadRunners = Record<AheadStep, (run: AheadRun) => Promise<unknown>>

/** The last try that did not succeed, kept until a try does: where it stopped (null when it was not in a step), why in plain words, and when it is tried again by itself. */
export type AheadFailure = { step: AheadStep | null; why: string; at: number; retryAt: number; failures: number }

export type AheadDeps<Where> = {
  /** What is missing and what the person has said, read when a look is taken and again before each step. `where` is the project the look was asked for (the one thing the old "has this computer built before" mark needs). */
  facts(where: Where): Promise<AheadFacts>
  /** The steps themselves: the same preparations the pack and the game make when asked (`prepareDevelopmentFiles`, `prepareSceneServer`, `prepareSceneClient`). */
  runners: AheadRunners
  now?: () => number
  /** Told when what the window shows of the preparation changed: a step began or ended, a try failed, the preparation ended. Not told for every counter (those are read with the panel). */
  changed?: () => void
  /** Calls `run` after `ms` and gives back how to cancel it; replaced in tests. */
  later?: (run: () => void, ms: number) => () => void
}

/**
 * Gets what this computer lacks ready before a press asks for it. One thing at a time, one preparation at a time, for the whole computer: a second ask while one
 * runs does nothing, and a step that fails ends the preparation (the pack downloads what is missing, as it always did). A failure is kept, with the step it was in and why,
 * and is tried again by itself after `aheadRetryIn` (a minute, then two, then five), by a timer and not only when something happens to ask; a press of the pack does not wait for
 * that (`pressed`). A press that comes while it runs does not start a second download: the steps are the very functions a press uses, which take a running
 * preparation up (`preparing` in mod-core's scene-run for the game's files, the runtime environment's turn for Gradle), and `join` lets a pack wait for the
 * development files that are on their way with a line that says so.
 */
export function createPrepareAhead<Where>(deps: AheadDeps<Where>) {
  const now = deps.now ?? Date.now
  const later =
    deps.later ??
    ((run: () => void, ms: number) => {
      const timer = setTimeout(run, ms)
      timer.unref?.()
      return () => clearTimeout(timer)
    })
  const state = {
    running: null as Promise<void> | null,
    controller: null as AbortController | null,
    step: null as AheadStep | null,
    stepEnded: null as Promise<void> | null,
    /** The newest counter line the step wrote, so that a pack that joins is told where it stands and not only what comes next. */
    counter: null as string | null,
    failure: null as AheadFailure | null,
    /** Tries in a row that did not succeed; the next wait is chosen by it, and a try that succeeds sets it back to none. */
    failures: 0,
    cancelRetry: null as (() => void) | null,
    where: null as Where | null,
    lookedAt: null as number | null,
    listeners: new Set<(text: string) => void>(),
  }
  const say = (text: string) => {
    const counter = readCounter(text)
    if (counter) state.counter = counter.text
    state.listeners.forEach((listener) => listener(text))
  }
  const tell = () => {
    try {
      deps.changed?.()
    } catch {
      // Whoever listens failing is no reason for the preparation to.
    }
  }
  const noRetry = () => {
    state.cancelRetry?.()
    state.cancelRetry = null
  }

  function fail(step: AheadStep | null, error: unknown) {
    state.failures += 1
    const wait = aheadRetryIn(state.failures)
    state.failure = { step, why: aheadWhy(error), at: now(), retryAt: now() + wait, failures: state.failures }
    noRetry()
    state.cancelRetry = later(() => {
      state.cancelRetry = null
      if (!state.running && state.where !== null) start(state.where)
    }, wait)
  }

  async function run(where: Where, skip: readonly AheadStep[]) {
    const controller = new AbortController()
    state.controller = controller
    const tried = new Set<AheadStep>(skip)
    try {
      for (;;) {
        if (controller.signal.aborted) return
        // Read afresh before every step: the switch may have been turned off, and the licence agreed, since the last one began.
        const step = aheadSteps(await deps.facts(where)).find((value) => !tried.has(value))
        if (!step || controller.signal.aborted) break
        tried.add(step)
        state.step = step
        state.counter = null
        tell()
        const work = Promise.resolve().then(() => deps.runners[step]({ signal: controller.signal, onProgress: say, changed: tell }))
        state.stepEnded = work.then(
          () => undefined,
          () => undefined,
        )
        await work
        tell()
      }
      // Everything that was missing is there: the last failure, if there was one, is over.
      if (!controller.signal.aborted) {
        state.failure = null
        state.failures = 0
        noRetry()
      }
    } catch (error) {
      // A stop on purpose (the switch, the app closing) is not a failure to be held off for. Anything else is kept, with where and why, and tried again after a wait.
      if (!controller.signal.aborted) fail(state.step, error)
    } finally {
      state.step = null
      state.counter = null
      state.stepEnded = null
      state.controller = null
      state.lookedAt = now()
      state.listeners.clear()
    }
  }

  function start(where: Where, skip: readonly AheadStep[] = []) {
    state.where = where
    noRetry()
    state.running = run(where, skip).finally(() => {
      state.running = null
      tell()
    })
  }

  return {
    /**
     * Something happened that makes a press likely (`aheadMoment`): start preparing what is missing, unless it is already under way, did not succeed and is waiting for
     * its time to be tried again (which a timer does by itself), or was looked at a moment ago and found nothing. `soon` skips both waits: the person has just changed
     * what may be fetched (agreed to the licence, turned the switch on), which is a reason to try now and not a network trying itself over and over.
     */
    consider(where: Where, soon = false) {
      if (state.running) return
      if (state.failure && !soon && now() < state.failure.retryAt) {
        state.where = where
        return
      }
      if (!soon && state.lookedAt !== null && now() - state.lookedAt < AHEAD_LOOK_MS) return
      start(where)
    },
    /**
     * A pack is pressed. When the last try did not succeed, the wait for the next one is over: what is left is tried at once, except the development files, which the
     * pack is fetching this very moment with the same code (a second Gradle beside it would only take its place in the queue). Nothing happens when the last try
     * succeeded or one is running (`join` takes care of that).
     */
    pressed(where: Where) {
      if (state.running || !state.failure) return
      start(where, ["development"])
    },
    /** Stops what is running (the switch was turned off, the app is closing) and the wait for the next try. Whatever was downloaded stays: every file is put in place only once whole and checked. */
    stop() {
      noRetry()
      state.controller?.abort()
    },
    /** What is being prepared now, null when nothing is. */
    current(): AheadStep | null {
      return state.step
    },
    /** What the window shows of it: the step being fetched and the newest count it wrote, and the last try that did not succeed. */
    status(): { step: AheadStep | null; counter: string | null; failure: AheadFailure | null } {
      return { step: state.step, counter: state.counter, failure: state.failure }
    },
    active: () => state.running !== null,
    /**
     * A pack about to start: when the development files are being fetched this very moment, waits for them (and says so, with the progress they write), so the
     * pack finds them instead of fetching them a second time. False when there was nothing to wait for. A preparation that fails does not fail the pack: it goes on and fetches for itself.
     */
    async join(input: { signal?: AbortSignal; onProgress?: (text: string) => void }) {
      const ended = state.step === "development" ? state.stepEnded : null
      if (!ended) return false
      if (input.signal?.aborted) throw new Error("CANCELLED")
      // What the pack's own detail gets of the preparation: the line that says what it is waiting for, then the counters (how much has been fetched). Gradle's other
      // output stays out of it: its stage lines would tell the person the mod is being compiled.
      const told = input.onProgress
      const listener = told ? (text: string) => ((counter) => (counter ? told(`${counter.text}\n`) : undefined))(readCounter(text)) : undefined
      if (told && listener) {
        told(`${AHEAD_WORDS.now}\n`)
        // Where it stands now, not only what comes next: a count that has not moved since the pack began waiting would otherwise leave the pack's detail with no number.
        if (state.counter) told(`${state.counter}\n`)
        state.listeners.add(listener)
      }
      const cancel = { reject: (_: Error) => {} }
      const aborted = new Promise<never>((_, reject) => {
        cancel.reject = reject
      })
      const onAbort = () => cancel.reject(new Error("CANCELLED"))
      input.signal?.addEventListener("abort", onAbort, { once: true })
      try {
        await Promise.race([ended, aborted])
      } finally {
        input.signal?.removeEventListener("abort", onAbort)
        if (listener) state.listeners.delete(listener)
      }
      return true
    },
    /** For tests and for shutdown: resolves when no preparation is running. */
    async settled() {
      while (state.running) await state.running
    },
  }
}
