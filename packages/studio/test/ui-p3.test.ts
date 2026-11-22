import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createProject } from "@minemods/mod-core/project"
import { createMakingHistory } from "../src/main/making-history"
import { StudioRequestSchema } from "../src/main/protocol"
import { ADVANCEMENTS, AdvancementsSchema, earn, startingEarned } from "../src/advancements"
import { MakingNoteInputSchema, noteStanding, pointOnShape, sameAngle } from "../src/making-notes"
import { SettingsSchema } from "../src/settings"
import { SPLASHES, nextSplash, pickSplash } from "../src/renderer/world"
import { keepSame } from "../src/renderer/keep-same"
import { presenceLine } from "../src/renderer/features/project-activity-model"
import { firstOf } from "../src/renderer/features/advancement"
import type { ActivityEvent } from "../src/api"

const source = (path: string) => readFileSync(new URL(`../src/renderer/${path}`, import.meta.url), "utf8")

describe("a note keeps its place from any angle", () => {
  const camera = (x: number) => ({ position: [x, 1, 2] as [number, number, number], target: [0, 0, 0] as [number, number, number] })

  test("the same angle is the same within a hair, another is another, none is none", () => {
    expect(sameAngle(camera(1), camera(1.005))).toBe(true)
    expect(sameAngle(camera(1), camera(1.5))).toBe(false)
    expect(sameAngle(null, camera(1))).toBe(false)
    expect(sameAngle(camera(1), undefined)).toBe(false)
  })

  test("a narrower picture moves what is off the middle further out, and leaves the height alone", () => {
    expect(pointOnShape({ x: 0.75, y: 0.2 }, 2, 1)).toEqual({ x: 1, y: 0.2 })
    expect(pointOnShape({ x: 0.6, y: 0.2 }, 1, 2)).toEqual({ x: 0.55, y: 0.2 })
    expect(pointOnShape({ x: 0.5, y: 0.9 }, 2, 0.5)).toEqual({ x: 0.5, y: 0.9 })
  })

  test("what falls outside the picture stays on its edge, and a note from before stays where it was", () => {
    expect(pointOnShape({ x: 0.9, y: 0.5 }, 3, 1).x).toBe(1)
    expect(pointOnShape({ x: 0.1, y: 0.5 }, 3, 1).x).toBe(0)
    expect(pointOnShape({ x: 0.9, y: 0.5 }, null, 1)).toEqual({ x: 0.9, y: 0.5 })
    expect(pointOnShape({ x: 0.9, y: 0.5 }, undefined, null)).toEqual({ x: 0.9, y: 0.5 })
  })

  test("the shape is optional in what is stored: old notes still read", () => {
    const old = { kind: "text", start: { x: 0, y: 0 }, text: "这里", part: null, frame: null, camera: null }
    expect(MakingNoteInputSchema.parse(old).aspect).toBeUndefined()
    expect(MakingNoteInputSchema.parse({ ...old, aspect: 1.6 }).aspect).toBe(1.6)
    expect(() => MakingNoteInputSchema.parse({ ...old, aspect: -1 })).toThrow()
  })
})

describe("a first that happened while nobody was looking", () => {
  const history = async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ui-p3-"))
    await createProject({ directory, name: "没人看着", description: "", mod_id: "p3_quiet" })
    const service = createMakingHistory({ directoryFor: async () => directory, redo: async () => null })
    const earned = async () => (JSON.parse(await readFile(path.join(directory, ".minemods", "making", "advancements.json"), "utf8")) as { earned: string[] }).earned
    return { directory, service, earned, projectId: crypto.randomUUID() }
  }

  test("it is kept and is not news, then or later", async () => {
    const { directory, service, earned, projectId } = await history()
    try {
      expect(await service.earnAdvancements({ projectId, ids: [] })).toEqual({ fresh: [] })
      expect(await earned()).toEqual([])
      expect(await service.earnAdvancements({ projectId, ids: ["made"], quiet: true })).toEqual({ fresh: [] })
      expect(await earned()).toEqual(["made"])
      expect(await service.earnAdvancements({ projectId, ids: ["made"] })).toEqual({ fresh: [] })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("one seen happening is news once, and a quiet one leaves the others alone", async () => {
    const { directory, service, earned, projectId } = await history()
    try {
      await service.earnAdvancements({ projectId, ids: ["packed"], quiet: true })
      expect(await service.earnAdvancements({ projectId, ids: ["made", "packed"] })).toEqual({ fresh: ["made"] })
      expect(await service.earnAdvancements({ projectId, ids: ["made"] })).toEqual({ fresh: [] })
      expect(await earned()).toEqual(["packed", "made"])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("the door counts kinds: six of one kind are refused as they stand, which is why they are made one first", () => {
    const request = (ids: string[], extra = {}) => StudioRequestSchema.safeParse({ method: "earnAdvancements", input: { projectId: crypto.randomUUID(), ids, ...extra } }).success
    expect(request(Array(6).fill("made"))).toBe(false)
    expect(request(["made"])).toBe(true)
    expect(request(["made"], { quiet: true })).toBe(true)
    expect(request(["made"], { quiet: "yes" })).toBe(false)
  })
})

describe("what is said after handing over", () => {
  const sent = { status: "sent", source: "person", fixed_version: null } as const

  test("an outside AI does not wake by itself, and the words say so", () => {
    expect(noteStanding(sent, true)).toContain("已记下，等 AI 领")
    expect(noteStanding(sent)).toContain("已交给 AI")
    expect(noteStanding({ ...sent, status: "unsent" }, true)).toContain("还没交给 AI")
  })

  test("gone quiet does not go stale, and says what to do", () => {
    expect(presenceLine("idle")).toMatchObject({ word: "没动静", text: "超过 45 秒没动静" })
    expect(presenceLine("idle")?.next).toContain("AI 窗口")
    expect(presenceLine("disconnected")?.next).toContain("AI 窗口")
  })
})

describe("keepSame", () => {
  type Row = { id: number; words: string }

  test("a row that did not change stays the very object, so what is on screen is not rebuilt", () => {
    const before: Row[] = [{ id: 1, words: "一" }, { id: 2, words: "二" }]
    const next = keepSame(before, [{ id: 1, words: "一" }, { id: 2, words: "改了" }, { id: 3, words: "三" }], (row) => row.id)
    expect(next[0]).toBe(before[0]!)
    expect(next[1]).not.toBe(before[1]!)
    expect(next.map((row) => row.words)).toEqual(["一", "改了", "三"])
  })

  test("order and what went away follow the new read", () => {
    const before: Row[] = [{ id: 1, words: "一" }, { id: 2, words: "二" }]
    const next = keepSame(before, [{ id: 2, words: "二" }], (row) => row.id)
    expect(next).toEqual([{ id: 2, words: "二" }])
    expect(next[0]).toBe(before[1]!)
  })

  test("what counts as the same can be narrowed", () => {
    const before = [{ id: 1, shown: true, big: {} }]
    const next = keepSame(before, [{ id: 1, shown: true, big: { other: 1 } }], (row) => row.id, (left, right) => left.shown === right.shown)
    expect(next[0]).toBe(before[0]!)
  })
})

describe("keys and motion", () => {
  test("Escape on the card leaves an input method's word alone, and Enter does not pass over notes in hand", () => {
    const card = source("features/project-assets.tsx")
    const escape = card.indexOf('if (event.key === "Escape") {\r\n        event.preventDefault()\r\n        if (ask())')
    const fromEscape = card.indexOf('if (event.key === "Escape") {\n        event.preventDefault()\n        if (ask())')
    const at = escape >= 0 ? escape : fromEscape
    expect(at).toBeGreaterThan(0)
    expect(card.slice(at - 120, at)).toContain("event.isComposing")
    expect(card).toContain("onStory() && historyBar()?.hand")
  })

  test("a note in writing counts as work in hand, and clearing asks first", () => {
    const history = source("features/making-history.tsx")
    expect(history).toContain("props.onDirty(!!pending())")
    expect(history).toContain("再按一次 Esc")
    expect(history).toContain("props.onAsk(")
    expect(history).toContain("UNDO_FOR")
  })

  test("everything that moves by script asks one place, so the setting reaches it", () => {
    for (const path of ["viewport.ts", "features/model-canvas.tsx", "features/making-live.tsx"]) expect(source(path)).toContain('import { calm } from')
    for (const path of ["viewport.ts", "features/model-canvas.tsx", "features/making-live.tsx"]) expect(source(path)).not.toContain("prefers-reduced-motion")
    expect(source("features/home-worlds.css")).toContain('.studio-root.reduce-motion[data-page="home"]::before')
  })
})

describe("what is read anew is not news", () => {
  test("a value read off a view or a poll goes through a memo before `on`, so reading it again does not start things over", () => {
    const wants: Record<string, string> = {
      "features/external-workbench.tsx": "const projectId = createMemo(() => props.view.project.id)",
      "studio-app.tsx": "const presenceState = createMemo(() => mcp()?.state)",
      "features/project-navigation.tsx": "on(createMemo(() => overviewKey(props.project.id, props.project.revision))",
      "features/preinstalled-mods.tsx": "const openProject = createMemo(() => props.projectId)",
      "features/three-view.tsx": "const thingOf = createMemo(() => keyOf(props.projectId, props.itemId))",
      "features/test-scene.tsx": "const checkOf = createMemo(",
      "features/java-card.tsx": "const major = createMemo(() => props.major)",
      "features/model-workspace.tsx": "const storedModel = createMemo(() => JSON.stringify(props.view.model))",
      "features/project-conception.tsx": "const stored = createMemo(() => JSON.stringify(props.project.conception))",
      "features/content-editor.tsx": "const revisionNow = createMemo(() => props.asset?.revision)",
    }
    for (const [path, line] of Object.entries(wants)) expect(source(path), path).toContain(line)
  })
})

describe("the making page does not start over", () => {
  test("a subject that moved but is the same thing keeps the step walked back to", () => {
    const live = source("features/making-live.tsx")
    expect(live).toContain("const asset = createMemo(() => props.assetId)")
    expect(live).not.toMatch(/on\(\s*\(\) => props\.assetId/)
  })

  test("a new version of the same thing is said apart: its steps start over, and its ghosts are read again", () => {
    const live = source("features/making-live.tsx")
    expect(live).toContain("const versionNow = createMemo(() => trace()?.version)")
    expect(live).toContain("shown()?.version === version && shown()?.seq === copy.seq")
  })
})

describe("little things", () => {
  test("a first is said once, in one project, and only as what is new", () => {
    expect(earn([], ["made"])).toEqual({ earned: ["made"], fresh: ["made"] })
    expect(earn(["made"], ["made"])).toEqual({ earned: ["made"], fresh: [] })
    expect(earn(["made"], ["made", "accepted", "accepted"])).toEqual({ earned: ["made", "accepted"], fresh: ["accepted"] })
    expect(earn(["made"], [])).toEqual({ earned: ["made"], fresh: [] })
  })

  test("a project that already holds things claims no first: it has had them, unseen", () => {
    expect(startingEarned(0)).toEqual([])
    expect([...startingEarned(1)].sort() as string[]).toEqual(Object.keys(ADVANCEMENTS).sort())
    expect(earn(startingEarned(3), ["accepted"]).fresh).toEqual([])
  })

  test("the record refuses what is not one", () => {
    expect(AdvancementsSchema.parse({ schema_version: 1, earned: ["made"] }).earned).toEqual(["made"])
    expect(() => AdvancementsSchema.parse({ schema_version: 1, earned: ["killed_dragon"] })).toThrow()
  })

  test("what counts as a first is read off the event as the toast reads it: made and packed, and not the steps on the way", () => {
    const event = (fields: Partial<ActivityEvent>) => ({ seq: 1, at: "", kind: "task", mark: "ok", item: "a", title: "小鸡", text: "", ...fields }) as ActivityEvent
    expect(firstOf(event({ end: true }))).toBe("made")
    expect(firstOf(event({ kind: "build", end: true, text: "模组打包好了：小鸡.jar", title: null, item: null }))).toBe("packed")
    expect(firstOf(event({ end: true, step: true }))).toBeNull()
    expect(firstOf(event({ end: false }))).toBeNull()
    expect(firstOf(event({ kind: "build", mark: "fail", end: true }))).toBeNull()
    expect(firstOf(event({ kind: "review", text: "评审通过", end: true }))).toBeNull()
  })

  test("the days with their own line say it first, and an ordinary day says one of the usual", () => {
    expect(pickSplash(() => 0, new Date(2027, 0, 1))).toBe("新的一年，新的模组！")
    expect(pickSplash(() => 0, new Date(2026, 9, 31))).toBe("今晚适合做个怪物！")
    expect(pickSplash(() => 0, new Date(2026, 11, 25))).toBe("给世界加一份礼物！")
    expect(pickSplash(() => 0, new Date(2026, 10, 3))).toBe(SPLASHES[0])
  })

  test("pressed, the splash never says what it just said", () => {
    for (const line of SPLASHES) {
      for (const random of [0, 0.5, 0.999]) expect(nextSplash(line, () => random, new Date(2026, 10, 3))).not.toBe(line)
    }
    const seen = new Set(Array.from({ length: 12 }, (_, index) => nextSplash(SPLASHES[0], () => index / 12, new Date(2026, 11, 25))))
    expect(seen.has("给世界加一份礼物！")).toBe(true)
    expect(nextSplash("给世界加一份礼物！", () => 0.999, new Date(2026, 11, 25))).not.toBe("给世界加一份礼物！")
  })

  test("sounds are off until asked for, and an older settings file reads as off", () => {
    expect(SettingsSchema.parse({}).sounds).toBe(false)
  })

  test("sounds are made, not shipped, and nothing touches audio before one is wanted", () => {
    const sounds = source("sounds.ts")
    expect(sounds).toContain("if (!state.on) return")
    expect(sounds.indexOf("if (!state.on) return")).toBeLessThan(sounds.indexOf("new AudioContext()"))
    expect(sounds).not.toMatch(/\.(ogg|mp3|wav)\b/)
  })

  test("what moves by script holds still when asked: the block, the orbs, the splash", () => {
    const little = source("little-things.ts")
    expect(little).toContain('import { calm } from "./calm"')
    expect(little.match(/calm\(\)/g)?.length).toBe(2)
    expect(source("studio-app.tsx")).toContain("if (!calm()) setSplashPops(true)")
  })
})
