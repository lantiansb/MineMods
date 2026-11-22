import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { decodeImage } from "@minemods/mod-core/image-decode"
import { CROP_WORDS } from "@minemods/mod-core/image-crop"
import { encodePng } from "@minemods/mod-core/png"
import { SIX_VIEW_WORDS } from "@minemods/studio-ai/making"
import { PAPER, played } from "./playable-fixture"
import { createStudioService } from "../src/main/service"
import { dispatchExternal, externalError } from "../src/main/external-dispatch"
import { pictured } from "../src/main/mcp-content"
import { toolActivity } from "../src/main/activity-tools"
import { VIEW_REFERENCE_WORDS, viewReference } from "../src/main/view-reference"
import type { ExternalStartResult, ExternalTaskContext } from "../src/external"
import type { LookRenderer } from "../src/main/look-job"

const directories: string[] = []
const closers: (() => unknown)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

/** A PNG of four flat quadrants as a data URL: red top left, green top right, blue bottom left, white bottom right. */
function quadrants(width: number, height: number) {
  const pixels = new Uint8Array(width * height * 4)
  const colours = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
  ] as const
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([...colours[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)]!, 255], (y * width + x) * 4)
  return `data:image/png;base64,${Buffer.from(encodePng(pixels, width, height)).toString("base64")}`
}
const pictureOf = (url: string) => decodeImage(new Uint8Array(Buffer.from(url.slice(url.indexOf(",") + 1), "base64")))
const coloursOf = (url: string) => {
  const image = pictureOf(url)
  return [...new Set(Array.from({ length: image.width * image.height }, (_, at) => Array.from(image.pixels.subarray(at * 4, at * 4 + 4)).join(",")))]
}
const refusal = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("not refused")
}

const SHEET = quadrants(600, 400)
const SKETCH = quadrants(40, 30)
const references = [
  { kind: "three_view" as const, name: "守卫六视图", view: "sheet" as const, by: "ai" as const, url: SHEET },
  { kind: "user" as const, name: "草图.png", url: SKETCH },
]

test("按编号、名字或六视图的格子挑参考图，切出来放大，说清楚是原图的哪一块", () => {
  const whole = viewReference(references, { reference: 1 })
  expect(whole).toMatchObject({ reference: { number: 1, kind: "three_view", name: "守卫六视图", view: "sheet", by: "ai" }, original: { width: 600, height: 400 }, rect: { x: 0, y: 0, width: 600, height: 400 }, shown: { width: 1024, height: 683 } })
  expect(whole.pictures).toHaveLength(1)
  expect(whole.pictures[0]!.label).toContain("原图 600×400 像素，这是整张")
  expect(pictureOf(whole.pictures[0]!.url)).toMatchObject({ width: 1024, height: 683 })

  // The bottom left quarter, by fraction (the default unit) and by pixels: the same rectangle, the one colour.
  const blue = viewReference(references, { reference: "守卫六视图", region: { x: 0, y: 0.5, width: 0.5, height: 0.5 } })
  expect(blue.rect).toEqual({ x: 0, y: 200, width: 300, height: 200 })
  expect(blue.shown).toEqual({ width: 1024, height: 683 })
  expect(blue.pictures[0]!.label).toContain("左上角在 (0, 200)，宽 300、高 200 像素")
  expect(coloursOf(blue.pictures[0]!.url)).toEqual(["0,0,255,255"])
  expect(viewReference(references, { reference: "sheet", region: { x: 0, y: 200, width: 300, height: 200, unit: "pixels" } }).rect).toEqual(blue.rect)
  // A number written as words is a number; a small picture is enlarged at most eight times.
  const sketch = viewReference(references, { reference: "2", region: { x: 20, y: 0, width: 20, height: 15, unit: "pixels" } })
  expect(sketch).toMatchObject({ reference: { number: 2, kind: "user", name: "草图.png" }, rect: { x: 20, y: 0, width: 20, height: 15 }, shown: { width: 160, height: 120 } })
  expect(coloursOf(sketch.pictures[0]!.url)).toEqual(["0,255,0,255"])
})

test("问的那张没有、区域不对、图读不了，都用一句话退回", () => {
  expect(refusal(() => viewReference([], { reference: 1 }))).toBe(VIEW_REFERENCE_WORDS.none)
  expect(refusal(() => viewReference(references, { reference: 3 }))).toBe(VIEW_REFERENCE_WORDS.no_number(3, references))
  expect(VIEW_REFERENCE_WORDS.no_number(3, references)).toContain("1「守卫六视图」（六视图 · 一整张")
  expect(refusal(() => viewReference(references, { reference: "尾巴" }))).toBe(VIEW_REFERENCE_WORDS.no_name("尾巴", references))
  // A view of a 六视图 drawn as one sheet: told which picture and roughly where on it.
  const front = refusal(() => viewReference(references, { reference: "front" }))
  expect(front).toBe(VIEW_REFERENCE_WORDS.on_sheet("front", 1, true))
  expect(front).toContain(`「${SIX_VIEW_WORDS.front}」大约是 region { x: 0, y: 0, width: 0.333, height: 0.5 }`)
  expect(VIEW_REFERENCE_WORDS.on_sheet("quarter", 1, true)).toContain("region { x: 0.667, y: 0.5,")
  expect(refusal(() => viewReference(references, { reference: 1, region: { x: 1.5, y: 0, width: 0.2, height: 0.2 } }))).toBe(CROP_WORDS.outside(600, 400, "fraction"))
  expect(refusal(() => viewReference(references, { reference: 1, region: { x: 0, y: 0, width: 0, height: 10, unit: "pixels" } }))).toBe(CROP_WORDS.not_positive)
  const broken = [{ kind: "user" as const, name: "坏图.png", url: `data:image/png;base64,${Buffer.from("not a picture").toString("base64")}` }]
  expect(refusal(() => viewReference(broken, { reference: 1 }))).toStartWith(VIEW_REFERENCE_WORDS.unreadable(1, ""))
  // A separate view is found by its slot, in the slot's own words as well.
  const apart = [{ kind: "three_view" as const, name: "正面.png", view: "front" as const, by: "person" as const, url: SKETCH }, { kind: "three_view" as const, name: "侧面.png", view: "side" as const, by: "person" as const, url: SKETCH }]
  expect(viewReference(apart, { reference: SIX_VIEW_WORDS.front }).reference).toMatchObject({ number: 1, view: "front" })
  expect(viewReference(apart, { reference: "LEFT" }).reference).toMatchObject({ number: 2, view: "left" })
})

/** A stand-in for the hidden window that draws: one tiny picture per sheet. With it a model is made by looking, and its references are listed. */
const look: LookRenderer = async (job) => ({ ok: true, pictures: job.sheets.map((sheet) => ({ label: sheet.label, url: SKETCH })) })

const blueprint = played({
  style: { palette: ["#3355aa"], shape: "方块感", naming: "中文名", world: "矿洞" },
  entries: [{ key: "guardian_model", kind: "model" as const, title: "六臂守卫", brief: "做一个九格高、六条手臂的首领", owner: null, needs: [], out_of_scope: null }],
  questions: [],
})

test("view_reference 走外部接口：领了任务就能看这样东西的参考图，顺序和 claim_task 列的一样，什么都不改", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-view-reference-"))
  directories.push(root)
  const service = await createStudioService({ workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: { mode: "mcp", review: true }, look })
  closers.push(() => service.dispose())
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  const projectId = (await service.createProject({ name: "六臂守卫", description: "", modId: "boss", empty: true })).project.id
  await call("proposeBlueprint", { projectId, request: "一个九格高、六条手臂的首领", blueprint, paper_play: PAPER })
  await service.confirmBlueprint({ projectId, revision: 1 })
  await service.addReference({ projectId, itemId: "guardian_model", name: "草图.png", url: SKETCH })
  await call("finishThreeView", { projectId, itemId: "guardian_model", result: { status: "generated", image: SHEET, name: "守卫六视图" } })

  const batch = (await call("nextBatch", { projectId })) as ExternalStartResult
  const ids = { projectId, runId: batch.run.id, taskId: batch.tasks[0]!.task.id }
  await expect(call("viewReferenceExternalTask", { ...ids, reference: 1 })).rejects.toThrow("外部任务尚未领取或已结束。")
  const claim = (await call("claimExternalTask", ids)) as ExternalTaskContext
  expect(claim.making?.references).toEqual([{ kind: "three_view", name: "守卫六视图", view: "sheet", by: "ai", style: "blocky" }, { kind: "user", name: "草图.png" }])
  expect(claim.making?.reference_guide).toContain("view_reference")

  const shown = await call("viewReferenceExternalTask", { ...ids, reference: 1, region: { x: 0.5, y: 0, width: 0.5, height: 0.5 } })
  expect(shown).toMatchObject({ reference: { number: 1, name: "守卫六视图" }, original: { width: 600, height: 400 }, rect: { x: 300, y: 0, width: 300, height: 200 } })
  // As the MCP tool hands it over: the words as JSON, the picture as one image.
  const content = pictured(shown).content
  expect(content.map((part) => part.type)).toEqual(["text", "image"])
  expect(content[1]).toMatchObject({ type: "image", mimeType: "image/png" })
  expect(coloursOf((shown as { pictures: { url: string }[] }).pictures[0]!.url)).toEqual(["0,255,0,255"])
  expect(await call("viewReferenceExternalTask", { ...ids, reference: "草图.png" })).toMatchObject({ reference: { number: 2, kind: "user" }, shown: { width: 320, height: 240 } })
  // Refused in the schema's own words, and in plain words for the rest.
  await expect(call("viewReferenceExternalTask", { ...ids, reference: 1, region: { x: 0, y: 0, width: -1, height: 1 } })).rejects.toThrow(CROP_WORDS.not_positive)
  await expect(call("viewReferenceExternalTask", { ...ids, reference: 9 })).rejects.toThrow(VIEW_REFERENCE_WORDS.no_number(9, (await service.getReferences({ projectId, itemId: "guardian_model" })) as never))
  // Read-only: no version was looked at and nothing was handed in.
  expect((await service.getMaking({ projectId, itemId: "guardian_model" }))?.rounds ?? []).toEqual([])
  expect(toolActivity({ method: "viewReferenceExternalTask", input: { ...ids, reference: 1, region: { x: 0, y: 0, width: 1, height: 1 } }, result: shown, refused: null, ms: 5, run: batch.run, review: true })).toMatchObject({ tool: "view_reference", quiet: true, text: "外部 AI 放大看了「六臂守卫」的第 1 张参考图的一块。" })
})
