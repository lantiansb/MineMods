import { SHAPES, shapeRaster } from "@minemods/studio-ai/particle-shapes"
import { Worker } from "node:worker_threads"
import { SCRIPT_ERRORS, SCRIPT_LIMITS, scriptApi, type ScriptWears, type TracePicture } from "@minemods/studio-ai/script"

/**
 * Where a script written by an AI is run. The script is never trusted: it runs on a thread of its own,
 * inside a JavaScript context that was given nothing — no `require`, no `process`, no timers, no network,
 * no file system, no way to compile text into code — and only a string ever comes back out.
 *
 * What holds it in, layer by layer:
 * 1. A fresh `vm` context whose global was made empty: every global but plain JavaScript is deleted before
 *    the script runs, and the API it is handed is built inside the context from source text, so no object
 *    of the host ever reaches it. (A host object is how every known escape from `vm` works.)
 * 2. Code generation from strings is off in that context, and the one piece of syntax that would hand the
 *    script a host error (`import`) is refused before anything runs.
 * 3. The only thing read back is a string, parsed and checked against the document schemas by the caller.
 * 4. Time and memory: the context stops at the time limit, the thread has a heap limit, and the thread is
 *    killed outright a little later whatever it is doing. Memory is watched a second time from outside the
 *    thread, because a heap flag on the whole process overrules a thread's own limit. One thread per run,
 *    thrown away afterwards.
 *
 * What it is not: an operating-system sandbox. Node says plainly that `vm` is not a security mechanism;
 * the layers above close the known ways out, they do not make a fault in V8 or Node harmless. The thread
 * shares the app's process, so such a fault would act with the app's own rights.
 */

export type Sandboxed = { ok: true; value: unknown; notes: string[] } | { ok: false; error: string; line: number | null }

// Runs first inside the context. Leaves plain JavaScript and nothing else, and makes errors readable as text.
const LOCKDOWN = `(function () {
  "use strict"
  var keep = ["Object", "Function", "Array", "Number", "parseFloat", "parseInt", "Infinity", "NaN", "undefined", "Boolean", "String", "Symbol", "Promise", "RegExp", "Error", "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError", "globalThis", "JSON", "Math", "Map", "Set", "WeakMap", "WeakSet", "BigInt", "Reflect", "Proxy", "isFinite", "isNaN"]
  Object.getOwnPropertyNames(globalThis).forEach(function (name) {
    if (keep.indexOf(name) !== -1) return
    try { delete globalThis[name] } catch (error) {}
  })
  Object.defineProperty(Math, "random", { value: function () { throw new Error("这里没有 Math.random：随机数用 api.random(seed)，这样同一个脚本每次跑出来都一样。") }, writable: false, configurable: false })
  // A stack is read as text only: nothing may hook how it is made.
  ;["Error", "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError"].forEach(function (name) {
    try { Object.defineProperty(globalThis[name], "prepareStackTrace", { value: undefined, writable: false, configurable: false }) } catch (error) {}
    try { Object.defineProperty(globalThis, name, { value: globalThis[name], writable: false, configurable: false }) } catch (error) {}
  })
  var text = function (value) { try { return String(value).slice(0, 2000) } catch (error) { return "" } }
  var said = function (error) {
    var told = { name: "", message: "", stack: "" }
    try { told.name = text(error && error.name) } catch (failed) {}
    try { told.message = text(error !== null && typeof error === "object" && "message" in error ? error.message : error) } catch (failed) {}
    try { told.stack = text(error && error.stack) } catch (failed) {}
    return JSON.stringify({ error: told })
  }
  Object.defineProperty(globalThis, "__run", { value: function () {
    try { return __kit.finish(__main(__kit.api)) } catch (error) { return said(error) }
  } })
})()`

// The thread's own program. It holds `vm` and the port, shuts what it can of its own realm, and never
// touches a property of anything that came out of the context except to check that it is a string.
const THREAD = `"use strict"
;(function () {
  const { parentPort, workerData } = require("node:worker_threads")
  const vm = require("node:vm")
  if (!process.versions.bun) {
    try { const Module = require("node:module"); Module._load = function () { throw new Error("closed") } } catch (error) {}
    for (const key of ["binding", "_linkedBinding", "dlopen", "getBuiltinModule", "kill", "abort", "chdir", "setuid", "setgid", "_debugProcess"]) try { process[key] = undefined } catch (error) {}
  }
  const deadline = Date.now() + workerData.ms
  const left = () => Math.max(1, deadline - Date.now())
  const told = (error) => ({ code: String((error && error.code) || ""), name: String((error && error.name) || ""), message: String((error && error.message) || "").slice(0, 2000), stack: String((error && error.stack) || "").slice(0, 4000) })
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, microtaskMode: "afterEvaluate" })
  try {
    vm.runInContext(workerData.lockdown, context, { filename: "sandbox.js", timeout: left() })
    vm.runInContext("var __kit = (" + workerData.api + ")(" + workerData.given + (workerData.raster ? ",(" + workerData.raster + ")" : "") + ")", context, { filename: "api.js", timeout: left() })
  } catch (error) {
    return parentPort.postMessage({ fault: "setup", ...told(error) })
  }
  // Defining the script's function runs none of it; what can go wrong here is its syntax.
  try {
    new vm.Script('var __main = function (api) {"use strict";' + workerData.source + "\\n}", { filename: "script.js" }).runInContext(context, { timeout: left() })
  } catch (error) {
    return parentPort.postMessage({ fault: error && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ? "timeout" : error && error.name === "SyntaxError" ? "syntax" : "threw", ...told(error) })
  }
  try {
    const text = vm.runInContext("__run()", context, { filename: "sandbox.js", timeout: left() })
    if (typeof text !== "string") return parentPort.postMessage({ fault: "nothing" })
    if (text.length > workerData.output) return parentPort.postMessage({ fault: "size" })
    parentPort.postMessage({ text })
  } catch (error) {
    parentPort.postMessage({ fault: error && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ? "timeout" : "threw", ...told(error) })
  }
})()`

type Told = { fault?: string; text?: string; code?: string; name?: string; message?: string; stack?: string }
const MISSING = ["require", "process", "module", "exports", "fetch", "XMLHttpRequest", "WebSocket", "setTimeout", "setInterval", "setImmediate", "queueMicrotask", "console", "Date", "window", "document", "navigator", "Buffer", "global", "eval", "WebAssembly", "SharedArrayBuffer", "Atomics", "performance", "Intl"]

/** The script's own line an error came from: the first place its stack names the script. */
const lineOf = (stack: string | undefined) => ((found) => (found ? Number(found[1]) : null))(/script\.js:(\d+)/.exec(stack ?? ""))

/** An error raised by or inside the script, in the words its author is given. */
function failure(told: Told): Sandboxed {
  const line = lineOf(told.stack)
  const message = told.message ?? ""
  if (told.fault === "syntax") return { ok: false, error: SCRIPT_ERRORS.syntax(message, line), line }
  const missing = /^(?:Can't find variable: )?([A-Za-z_$][\w$]*)(?: is not defined)?$/.exec(message)
  if (told.name === "ReferenceError" && missing && MISSING.includes(missing[1]!)) return { ok: false, error: SCRIPT_ERRORS.missing(missing[1]!, line), line }
  if (told.name === "RangeError" && /call stack/i.test(message)) return { ok: false, error: SCRIPT_ERRORS.deep(line), line }
  if (told.name === "EvalError") return { ok: false, error: SCRIPT_ERRORS.forbidden("eval 或 new Function"), line }
  // The reason is said in the author's language when the API raised it; an engine's own message is passed on as it is.
  return { ok: false, error: SCRIPT_ERRORS.threw(message ? (told.name && told.name !== "Error" ? `${told.name}: ${message}` : message) : "（没有说明原因）", line), line }
}

const parsed = (text: string) =>
  Promise.resolve(text)
    .then((value) => JSON.parse(value) as unknown)
    .catch(() => null)

/**
 * Run one script and answer with what it returned, or with one plain sentence on why there is nothing.
 * It always answers and never throws: a script that loops, allocates without end or dies is stopped and reported.
 */
export async function runSandboxed(source: string, given: { wears?: ScriptWears | null; seconds?: number; memoryMb?: number; /** A canvas handed back leaves as a picture that stands by itself, empty pixels kept. */ flat?: boolean; particle?: boolean; /** The task's concept pictures, already decoded and made small (`conceptPictures`), for `api.trace`. */ pictures?: TracePicture[] } = {}): Promise<Sandboxed> {
  if (source.length > SCRIPT_LIMITS.source) return { ok: false, error: SCRIPT_ERRORS.too_long(source.length), line: null }
  if (!source.trim()) return { ok: false, error: SCRIPT_ERRORS.empty, line: null }
  // `import()` would answer with an error object made outside the context, which is a way out of it. The word is a
  // keyword and cannot be spelled any other way, and text cannot be compiled inside, so refusing the word is enough.
  const banned = /\bimport\b/.exec(source)
  if (banned) return { ok: false, error: SCRIPT_ERRORS.forbidden("import"), line: source.slice(0, banned.index).split("\n").length }
  const ms = (given.seconds ?? SCRIPT_LIMITS.seconds) * 1000
  const memory = given.memoryMb ?? SCRIPT_LIMITS.memory_mb
  const told = await new Promise<Told>((resolve) => {
    const made = (() => {
      try {
        return new Worker(THREAD, {
          eval: true,
          env: {},
          argv: [],
          execArgv: [],
          stdin: false,
          workerData: { source, ms, output: SCRIPT_LIMITS.output, lockdown: LOCKDOWN, api: scriptApi.toString(), raster: given.particle ? shapeRaster.toString() : null, given: JSON.stringify({ wears: given.wears ?? null, limits: SCRIPT_LIMITS, ...(given.particle ? { particle:true, shapeNames:SHAPES } : {}), ...(given.flat ? { flat: true } : {}), ...(given.pictures?.length ? { pictures: given.pictures.slice(0, SCRIPT_LIMITS.pictures) } : {}) }) },
          resourceLimits: { maxOldGenerationSizeMb: memory, maxYoungGenerationSizeMb: Math.max(4, Math.round(memory / 4)), stackSizeMb: 4 },
        })
      } catch {
        return null
      }
    })()
    if (!made) return resolve({ fault: "unavailable" })
    // The thread is thrown away with its answer; one that has not answered a while after its own limit is not waited for.
    const settle = (value: Told) => {
      clearTimeout(timer)
      clearInterval(watch)
      void made.terminate()
      resolve(value)
    }
    const timer = setTimeout(() => settle({ fault: "timeout" }), ms + 2500)
    // The thread's own heap limit is overruled when the whole process was started with a larger one, and
    // some runtimes do not apply it at all. So memory is also watched from outside: the thread's heap where
    // it can be asked for, and how much the process has grown since the script began.
    const before = process.memoryUsage.rss()
    const watch = setInterval(() => {
      if (process.memoryUsage.rss() - before > (memory * 4 + 128) * 1048576) return settle({ fault: "memory" })
      const asked = (made as Worker & { getHeapStatistics?: () => Promise<{ used_heap_size: number }> }).getHeapStatistics?.()
      void asked?.then((heap) => heap.used_heap_size > memory * 2 * 1048576 && settle({ fault: "memory" })).catch(() => undefined)
    }, 40)
    made.once("message", (value: Told) => settle(value))
    made.once("error", (error: Error & { code?: string }) => settle({ fault: error.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memory" : "crashed" }))
    made.once("exit", () => settle({ fault: "crashed" }))
  })
  return answered(told)
}

async function answered(told: Told): Promise<Sandboxed> {
  if (told.fault === "unavailable" || told.fault === "setup") return { ok: false, error: SCRIPT_ERRORS.no_sandbox, line: null }
  if (told.fault === "timeout") return { ok: false, error: SCRIPT_ERRORS.timeout, line: null }
  if (told.fault === "memory") return { ok: false, error: SCRIPT_ERRORS.memory, line: null }
  if (told.fault === "size") return { ok: false, error: SCRIPT_ERRORS.too_large, line: null }
  if (told.fault === "nothing") return { ok: false, error: SCRIPT_ERRORS.nothing, line: null }
  if (told.fault === "crashed") return { ok: false, error: SCRIPT_ERRORS.crashed, line: null }
  if (told.fault) return failure(told)
  const read = (await parsed(told.text ?? "")) as { error?: Told; value?: unknown; notes?: unknown } | null
  if (!read || typeof read !== "object") return { ok: false, error: SCRIPT_ERRORS.crashed, line: null }
  if (read.error) return failure({ ...read.error, fault: "threw" })
  if (read.value === null || read.value === undefined) return { ok: false, error: SCRIPT_ERRORS.nothing, line: null }
  return { ok: true, value: read.value, notes: Array.isArray(read.notes) ? read.notes.filter((note): note is string => typeof note === "string").slice(0, SCRIPT_LIMITS.notes) : [] }
}
