import { expect, test } from "bun:test"
import { modelBounds } from "../src/model-bounds"
import { runSandboxed } from "../src/script-sandbox"
import { runScript, SCRIPT_ERRORS, SCRIPT_EXAMPLE, SCRIPT_LIMITS, ScriptFailure, scripted, scriptWears, summarise } from "../src/script-run"
import { getModuleSchema, type ModuleDocument } from "../src/workspace"

// A script is never trusted. These tests hold the sandbox to that: every way out that is known is tried
// and must end in a plain sentence, never in a value from outside, a hang or a crash of the test process.

type Model = Extract<ModuleDocument, { kind: "model" }>
const MOTIONS = `;["idle","walk","hurt"].forEach((name) => m.animation(name, { length: 1, loop: name !== "hurt" }).key("root", 0, [0, 0, 0]))`
const BOX = `const m = api.model({ name: "盒子" }); m.bone("root").cube("box", { origin: [-2, 0, -2], size: [4, 4, 4], color: "#808080" })${MOTIONS}`
const failed = async (source: string, kind = "model") => {
  const ran = await runScript(kind, source)
  if (ran.ok) throw new Error(`the script was let through: ${JSON.stringify(ran.summary)}`)
  return ran
}

test("脚本跑出来的就是一份普通的模型文档，带着概况和它留的话", async () => {
  const ran = await runScript("model", SCRIPT_EXAMPLE)
  if (!ran.ok) throw new Error(ran.error)
  expect(ran.summary).toEqual({ kind: "model", bones: 6, cubes: 6, texture_size: 64, animations: [{ name: "idle", length: 2, bones: 5 }, { name: "walk", length: 1, bones: 1 }, { name: "hurt", length: 0.4, bones: 1 }], size: [26, 12, 3] })
  expect(getModuleSchema("model").parse(ran.document)).toEqual(ran.document)
  expect(summarise(ran.document)).toEqual(ran.summary)
  // The same script gives the same document, every time: that is what lets a hand-in repeat a look.
  expect((await scripted("model", SCRIPT_EXAMPLE)).document).toEqual(ran.document)
  const noted = await runScript("model", `api.note("柱子 5 根"); api.note({ rail: 1 });${BOX}; return m`)
  expect(noted.ok && noted.notes).toEqual(["柱子 5 根", '{"rail":1}'])
})

test("脚本和手写的文档是等价的：同样的内容，一字不差", async () => {
  const written = getModuleSchema("model").parse({
    kind: "model",
    name: "盒子",
    texture_size: 64,
    bones: [{ name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ name: "box", origin: [-2, 0, -2], size: [4, 4, 4], faces: { north: "#808080", east: "#808080", south: "#808080", west: "#808080", up: "#808080", down: "#808080" }, surface_details: [] }] }],
    animations: ["idle", "walk", "hurt"].map((name) => ({ name, length: 1, loop: name !== "hurt", channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] })),
  })
  const ran = await runScript("model", `${BOX}; return m.document()`)
  expect(ran.ok && ran.document).toEqual(written as Model)
})

test("world 算出来的位置和 Studio 自己摆骨骼的算法一致", async () => {
  // Every corner of a box under three turned bones, said by the script's own m.world, against the bounds the app computes.
  const ran = await runScript(
    "model",
    `const m = api.model({ name: "转了三层" })
     const root = m.bone("root", { pivot: [0, 6, 0], rotation: [10, 25, -5] })
     const mid = root.bone("mid", { pivot: [4, 10, -2], rotation: [-30, 0, 40] })
     const tip = mid.bone("tip", { pivot: [9, 13, -2], rotation: [15, -50, 20] })
     tip.cube("box", { origin: [9, 12, -3], size: [5, 2, 3], color: "#808080" })
     const corners = []
     for (let i = 0; i < 8; i++) corners.push(m.world("tip", [9 + (i & 1 ? 5 : 0), 12 + (i & 2 ? 2 : 0), -3 + (i & 4 ? 3 : 0)]))
     api.note(corners)${MOTIONS}
     return m`,
  )
  if (!ran.ok) throw new Error(ran.error)
  const corners = JSON.parse(ran.notes[0]!) as number[][]
  const { kind: _kind, ...design } = ran.document as Model
  const bounds = modelBounds(design)
  // The app's bounds are in the game's mirrored X; the script speaks the document's own axes.
  expect(Math.min(...corners.map((corner) => -corner[0]!))).toBeCloseTo(bounds.min[0]!, 2)
  expect(Math.max(...corners.map((corner) => -corner[0]!))).toBeCloseTo(bounds.max[0]!, 2)
  ;[1, 2].forEach((axis) => {
    expect(Math.min(...corners.map((corner) => corner[axis]!))).toBeCloseTo(bounds.min[axis]!, 2)
    expect(Math.max(...corners.map((corner) => corner[axis]!))).toBeCloseTo(bounds.max[axis]!, 2)
  })
})

test("逃不出去：require、process、全局对象、构造函数的把戏、import，全都拿不到外面的东西", async () => {
  const missing = async (source: string, word: string) => expect((await failed(source)).error).toBe(SCRIPT_ERRORS.missing(word, 1))
  await missing("return require('fs').readFileSync('/etc/passwd', 'utf8')", "require")
  await missing("return process.env", "process")
  await missing("return fetch('http://example.com')", "fetch")
  await missing("setTimeout(() => {}, 1)", "setTimeout")
  await missing("return new Date()", "Date")
  await missing("return module.exports", "module")
  await missing("return new WebAssembly.Module(new Uint8Array(8))", "WebAssembly")
  await missing("return new SharedArrayBuffer(8)", "SharedArrayBuffer")
  await missing("console.log(1)", "console")
  // No text can be turned into code, by any constructor reachable from anything the script holds.
  const forbidden = SCRIPT_ERRORS.forbidden("eval 或 new Function")
  expect((await failed("return api.constructor.constructor('return process')()")).error).toBe(forbidden)
  expect((await failed("return (function () {}).constructor('return this')()")).error).toBe(forbidden)
  expect((await failed("return (async function () {}).constructor('return process')()")).error).toBe(forbidden)
  expect((await failed("return (function* () {}).constructor('return process')()")).error).toBe(forbidden)
  expect((await failed("return api.model.constructor('return globalThis.process')()")).error).toBe(forbidden)
  expect((await failed("try { null.x } catch (error) { return error.constructor.constructor('return process')() }")).error).toBe(forbidden)
  expect((await failed("return Reflect.construct(Object.getPrototypeOf(function () {}).constructor, ['return process'])()")).error).toBe(forbidden)
  expect((await failed("return import('node:fs')")).error).toBe(SCRIPT_ERRORS.forbidden("import"))
  expect(await failed("const m = 1\nconst fs = await import('node:fs')")).toMatchObject({ error: SCRIPT_ERRORS.forbidden("import"), line: 2 })
  // What `this` and the global object are inside: nothing that leads anywhere, and nothing that is a document.
  expect((await failed("return this")).error).toBe(SCRIPT_ERRORS.nothing)
  expect((await failed("return (function () { return this })()")).error).toBe(SCRIPT_ERRORS.nothing)
  const globals = await runSandboxed("return { names: Object.getOwnPropertyNames(globalThis) }")
  expect(globals.ok && (globals.value as { names: string[] }).names.filter((name) => /process|require|global$|Buffer|fetch|Timeout|Interval|Immediate|console|Date|WebAssembly|Atomics|performance|module/.test(name))).toEqual([])
  // Stack traces are text and cannot be hooked to hand out the frames above the script.
  expect((await failed("Error.prepareStackTrace = (error, frames) => frames; return new Error('x').stack")).error).toContain("脚本运行到第 1 行出错了")
  expect((await failed("return Math.random()")).error).toContain("api.random(seed)")
})

test("改不了 API，污染原型也带不出去：下一个脚本拿到的还是干净的", async () => {
  expect((await failed("api.model = () => 1; return 1")).error).toContain("脚本运行到第 1 行出错了")
  expect((await failed("api.add.call = null; return 1")).error).toContain("脚本运行到第 1 行出错了")
  expect((await failed("Object.defineProperty(api, 'extra', { value: 1 }); return 1")).error).toContain("脚本运行到第 1 行出错了")
  // Pollution inside the context stays inside it: what comes out is text, checked against the schema.
  const polluted = await failed("Object.prototype.kind = 'model'; Array.prototype.extra = 1; return {}")
  expect(polluted.error).toBe(SCRIPT_ERRORS.wrong_kind("model", "没有 kind 的东西"))
  expect(({} as { kind?: string }).kind).toBeUndefined()
  expect(([] as unknown as { extra?: number }).extra).toBeUndefined()
  const hidden = await failed(`${BOX}; const made = m.document(); made.__proto__ = { evil: true }; made.constructor = { prototype: 1 }; return made`)
  expect(hidden.error).toContain("不符合「模型」的格式")
  const after = await runScript("model", SCRIPT_EXAMPLE)
  expect(after.ok).toBe(true)
  // A getter or a toJSON that misbehaves is only ever run inside.
  expect((await failed("return { kind: 'model', toJSON() { return globalThis } }")).error).toBe(SCRIPT_ERRORS.wrong_kind("model", "没有 kind 的东西"))
  expect((await failed("return (async () => 1)()")).error).toContain("脚本不能是异步的")
})

test("停不下来的、撑爆内存的、套得太深的，都会被停掉并且说清楚，不会卡住", async () => {
  const started = Date.now()
  const quick = { seconds: 0.4 }
  expect(await runScript("model", "while (true) {}", null, quick)).toEqual({ ok: false, error: SCRIPT_ERRORS.timeout, line: null })
  expect((await runScript("model", "Promise.resolve().then(() => { while (true) {} }); return 1", null, quick)).ok).toBe(false)
  expect((await runScript("model", "return { get kind() { while (true) {} } }", null, quick)).ok).toBe(false)
  expect((await runScript("model", "throw { toString() { while (true) {} } }", null, quick)).ok).toBe(false)
  expect(await failed("const one = 1\nfunction again() { again() }\nagain()")).toMatchObject({ error: SCRIPT_ERRORS.deep(2), line: 2 })
  // Allocating without end is stopped by memory or by time, whichever comes first; either way it ends.
  const greedy = await runScript("model", "const held = []; while (true) held.push(new Array(1e6).fill(1.5))", null, { seconds: 1, memoryMb: 32 })
  expect(greedy.ok ? "" : greedy.error).toMatch(/内存|还没有算完/)
  const strings = await failed("let text = 'x'; while (true) text += text")
  expect(strings.error).toMatch(/出错了|内存|还没有算完/)
  // Too much handed back is refused by size before anyone reads it.
  expect((await failed(`return { kind: "model", name: "x".repeat(${SCRIPT_LIMITS.output + 10}) }`)).error).toBe(SCRIPT_ERRORS.too_large)
  expect(Date.now() - started).toBeLessThan(25_000)
}, 40_000)

test("错在哪一行、是什么错，用人话说出来", async () => {
  expect(await failed("const m = api.model({ name: 'x' })\nconst root = m.bone('root')\nroot.cube('box', { origin: [0, 0, 0], size: [1, 0, 1], color: '#808080' })")).toEqual({
    ok: false,
    error: "脚本运行到第 3 行出错了：方块「root.box」的 size 里的每个数要是 1 到 256 之间的整数，现在是 0。",
    line: 3,
  })
  expect(await failed("const m = api.model({ name: 'x' })\nfor (let i = 0; i < 3; i++ {")).toMatchObject({ line: 2, error: expect.stringContaining("脚本写错了，没法运行（第 2 行）") })
  expect(await failed("const a = 1\n\nundefinedThing.x = 2")).toMatchObject({ line: 3, error: expect.stringContaining("第 3 行") })
  expect(await failed("throw new Error('我自己抛的')")).toEqual({ ok: false, error: "脚本运行到第 1 行出错了：我自己抛的", line: 1 })
  expect((await failed("")).error).toBe(SCRIPT_ERRORS.empty)
  expect((await failed("   \n  ")).error).toBe(SCRIPT_ERRORS.empty)
  expect((await failed(`// ${"x".repeat(SCRIPT_LIMITS.source)}`)).error).toBe(SCRIPT_ERRORS.too_long(SCRIPT_LIMITS.source + 3))
  expect((await failed("const m = api.model({ name: 'x' })")).error).toBe(SCRIPT_ERRORS.nothing)
  expect((await failed("return 42")).error).toBe(SCRIPT_ERRORS.nothing)
  expect((await failed("return api.canvas(8, 8)")).error).toBe(SCRIPT_ERRORS.wrong_kind("model", "texture"))
  // Kinds that are plain data are not scripted, and say so.
  expect((await failed("return {}", "recipe")).error).toBe(SCRIPT_ERRORS.not_scripted("配方"))
  await expect(scripted("model", "return 1")).rejects.toBeInstanceOf(ScriptFailure)
  // The document's own limits hold for a script as for anything else, at the line that crosses them.
  const many = await failed(`const m = api.model({ name: "太多" })\nfor (let i = 0; i < ${SCRIPT_LIMITS.bones + 1}; i++) m.bone("b" + i)`)
  expect(many).toMatchObject({ line: 2, error: expect.stringContaining(`一个模型最多 ${SCRIPT_LIMITS.bones} 根`) })
})

test("贴图和单独的动画也能用脚本：脚本知道它要穿的模型有哪些骨骼、每个面在贴图的哪里", async () => {
  const base = await runScript("model", SCRIPT_EXAMPLE)
  if (!base.ok) throw new Error(base.error)
  const wears = scriptWears(base.document as Model)!
  expect(wears.texture_size).toBe(64)
  expect(wears.bones.map((bone) => bone.name)).toEqual(["base", "post_1", "post_2", "post_3", "post_4", "post_5"])
  expect(wears.faces).toHaveLength(36)
  expect(wears.faces.find((face) => face.bone === "base" && face.cube === "rail" && face.face === "north")).toMatchObject({ width: 26, height: 2 })
  const texture = await runScript(
    "texture",
    `const c = api.canvas(api.wears.texture_size, api.wears.texture_size, "#000000")
     api.wears.faces.forEach((face, index) => c.rect(face.x, face.y, face.width, face.height, index % 2 ? "#8a6a45" : "#b08a5a"))
     return c`,
    base.document as Model,
  )
  if (!texture.ok) throw new Error(texture.error)
  expect(texture.summary).toEqual({ kind: "texture", width: 64, height: 64, colours: 3 })
  const motion = await runScript(
    "animation",
    `const a = api.animation({ name: "sway", length: 2, loop: true })
     api.wears.bones.filter((bone) => bone.parent).forEach((bone, index) => a.sample(bone.name, (t) => [0, 0, Math.sin(t * Math.PI * 2 + index) * 4], 9))
     return a`,
    base.document as Model,
  )
  if (!motion.ok) throw new Error(motion.error)
  expect(motion.summary).toEqual({ kind: "animation", name: "sway", length: 2, loop: true, bones: 5, keyframes: 45 })
  expect((await failed("return api.wears.bones.length", "texture")).error).toContain("脚本运行到第 1 行出错了")
})

test("形体（bone.solid）在隔离环境里一样能用，得到的是普通方块组成的、能通过文档校验的模型", async () => {
  const ran = await runScript(
    "model",
    `const m = api.model({ name: "形体", texture_size: 64 })
const root = m.bone("root", { pivot: [0, 0, 0] })
root.solid("round", { shape: "ellipsoid", center: [0, 6, 0], radii: [5, 4, 6], color: "#8a6a45" })
root.solid("post", { shape: "cylinder", from: [0, 0, 0], axis: "y", length: 3, radius: 2, color: "#5a4a35" })
for (const name of ["idle", "walk", "hurt"]) m.animation(name, { length: 1, loop: name !== "hurt" }).key("root", 0, [0, 0, 0])
return m.document()`,
  )
  if (!ran.ok) throw new Error(ran.error)
  const document = getModuleSchema("model").parse(ran.document) as Extract<ModuleDocument, { kind: "model" }>
  const cubes = document.bones[0]!.cubes
  expect(cubes.length).toBeGreaterThan(5)
  expect(cubes.every((cube) => /^(round|post)_\d+$/.test(cube.name))).toBe(true)
})

test("脚本只拿到 api：没有第二个参数，也没有体型骨架或现成动作", async () => {
  const ran = await runScript("model", `${BOX}; api.note(String(typeof starter) + "/" + String(arguments.length) + "/" + String(typeof api.bodyPlan) + "/" + String(typeof api.starter)); return m`)
  if (!ran.ok) throw new Error(ran.error)
  expect(ran.notes).toEqual(["undefined/1/undefined/undefined"])
  const asked = await failed(`${BOX}; return starter.plan("quadruped", {})`)
  expect(asked.error).toContain("starter")
})

test("m.clear 去掉一根骨骼上的方块，骨骼和它下面的骨骼还在", async () => {
  const ran = await runScript("model", `const m = api.model({ name: "盒子" }); const root = m.bone("root"); root.cube("a", { origin: [-2, 0, -2], size: [4, 4, 4], color: "#808080" }); m.bone("arm", { parent: "root", pivot: [2, 3, 0] }).cube("b", { origin: [2, 0, -1], size: [2, 3, 2], color: "#808080" }); m.clear("root")${MOTIONS}; return m`)
  if (!ran.ok) throw new Error(ran.error)
  const model = ran.document as Model
  expect(model.bones.map((bone) => [bone.name, bone.cubes.length])).toEqual([["root", 0], ["arm", 1]])
})
