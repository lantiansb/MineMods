import { CROP_LIMITS, CropRefusal, cropAndScale, type CropRegion } from "@minemods/mod-core/image-crop"
import { decodeImage, ImageUnreadable } from "@minemods/mod-core/image-decode"
import { MakingRefusal } from "@minemods/mod-core/making"
import { encodePng } from "@minemods/mod-core/png"
import { SIX_VIEW_NAME, SIX_VIEW_WORDS, SIX_VIEWS, viewSlot, type ReferenceKind, type SixView, type ThreeViewBy, type ThreeViewSlot } from "@minemods/studio-ai/making"
import { referenceLabel } from "./look-job"

/**
 * `view_reference`: one of a task's reference pictures, or a region of it, cut out and enlarged to be read up close. Every look shows the
 * references shrunk onto one sheet beside the renders, where a whole 六视图 of a nine-block boss is a few hundred pixels across: its hands,
 * heads and weapons cannot be counted there. Nothing is changed or stored; the picture is made for this answer and forgotten.
 */

/** A reference as `shownReferences` gives it: the picture itself as a data URL. */
type Shown = { kind: ReferenceKind; name: string; view?: ThreeViewSlot; by?: ThreeViewBy; url: string }

/** The names a slot of a 六视图 is asked for by: its own id (`front`, a `side` kept from three views as `left`) or the words on its cell (正面). */
const SLOT_ASKED: Record<string, Exclude<ThreeViewSlot, "side">> = Object.fromEntries([
  ["sheet", "sheet"],
  ["一整张", "sheet"],
  [SIX_VIEW_NAME, "sheet"],
  ["side", "left"],
  ...SIX_VIEWS.flatMap((view) => [[view, view] as const, [SIX_VIEW_WORDS[view], view] as const]),
])
/** Where a view sits on a whole sheet an image model was asked to draw (`threeViewPrompt`): three to a row, in the order of the renders. */
const gridCell = (view: SixView) => {
  const at = SIX_VIEWS.indexOf(view)
  return { x: Math.round(((at % 3) / 3) * 1000) / 1000, y: Math.floor(at / 3) / 2, width: 0.333, height: 0.5 }
}

export const VIEW_REFERENCE_WORDS = {
  none: "这样东西没有参考图，没有可以放大看的。",
  listed: (references: Shown[]) => references.map((reference, index) => `${index + 1}「${reference.name}」（${referenceLabel(reference, index)}）`).join("、"),
  no_number: (number: number, references: Shown[]) => `没有第 ${number} 张参考图：这样东西有 ${references.length} 张，按 claim_task 的 making.references 排的顺序是 ${VIEW_REFERENCE_WORDS.listed(references)}。`,
  no_name: (asked: string, references: Shown[]) => `没有叫「${asked}」的参考图。reference 写编号（从 1 数起）、名字，或者${SIX_VIEW_NAME}的哪一格（front、back、left、right、top、quarter、sheet）。这样东西的参考图是：${VIEW_REFERENCE_WORDS.listed(references)}。`,
  /** A view asked for by its slot while the 六视图 is one whole sheet: which picture it is, and where on it the view is likely to be. */
  on_sheet: (view: SixView, number: number, drawn: boolean) => {
    const cell = gridCell(view)
    return `这样东西的${SIX_VIEW_NAME}是一整张（第 ${number} 张），「${SIX_VIEW_WORDS[view]}」那一格在这张图里面：reference 写 ${number}，再用 region 切出那一格。${drawn ? `它是让画图模型按固定位置画的，「${SIX_VIEW_WORDS[view]}」大约是 region { x: ${cell.x}, y: ${cell.y}, width: ${cell.width}, height: ${cell.height} }。` : "它是人自己放的，各个方向排在哪里要看画面：先不带 region 看一眼整张。"}`
  },
  unreadable: (number: number, why: string) => `第 ${number} 张参考图读不了：${why}`,
  label: (number: number, reference: Shown, original: { width: number; height: number }, rect: { x: number; y: number; width: number; height: number }, shown: { width: number; height: number }) =>
    `参考图第 ${number} 张「${reference.name}」（${referenceLabel(reference, number - 1)}）：原图 ${original.width}×${original.height} 像素${rect.width === original.width && rect.height === original.height ? "，这是整张" : `；这一块左上角在 (${rect.x}, ${rect.y})，宽 ${rect.width}、高 ${rect.height} 像素`}；${shown.width === rect.width && shown.height === rect.height ? "原样大小" : `${shown.width > rect.width ? "放大" : "缩小"}成 ${shown.width}×${shown.height}`}。`,
  next_step: `想看别的地方就换一个 region 再调用：按比例给（默认，x、y、width、height 都是 0 到 1，占原图宽、高的几分之几），或者写 unit: "pixels" 按上面原图的像素给。切得越小放得越大，最多放大 ${CROP_LIMITS.upscale} 倍，长边最多 ${CROP_LIMITS.side} 像素。`,
} as const

/** Which reference is asked for: its number in the order `claim_task` lists them (from 1), its name, or a slot of the 六视图. */
function picked(references: Shown[], asked: number | string): { number: number; reference: Shown } {
  if (!references.length) throw new MakingRefusal(VIEW_REFERENCE_WORDS.none)
  if (typeof asked === "number") {
    const reference = Number.isInteger(asked) ? references[asked - 1] : undefined
    if (!reference) throw new MakingRefusal(VIEW_REFERENCE_WORDS.no_number(asked, references))
    return { number: asked, reference }
  }
  const text = asked.trim()
  const named = references.findIndex((reference) => reference.name === text)
  if (named >= 0) return { number: named + 1, reference: references[named]! }
  if (/^\d+$/.test(text)) return picked(references, Number(text))
  const slot = SLOT_ASKED[text] ?? SLOT_ASKED[text.toLowerCase()]
  if (slot) {
    const views = references.flatMap((reference, index) => (reference.kind === "three_view" && reference.view ? [{ index, slot: viewSlot(reference.view), reference }] : []))
    const held = views.find((view) => view.slot === slot)
    if (held) return { number: held.index + 1, reference: held.reference }
    const sheet = views.find((view) => view.slot === "sheet")
    if (sheet && slot !== "sheet") throw new MakingRefusal(VIEW_REFERENCE_WORDS.on_sheet(slot, sheet.index + 1, sheet.reference.by === "ai"))
  }
  throw new MakingRefusal(VIEW_REFERENCE_WORDS.no_name(text, references))
}

/** The picture of a data URL, decoded; refused in words when it cannot be read. */
function decoded(url: string, number: number) {
  const base64 = url.slice(url.indexOf(",") + 1)
  try {
    return decodeImage(new Uint8Array(Buffer.from(base64, "base64")))
  } catch (error) {
    if (error instanceof ImageUnreadable) throw new MakingRefusal(VIEW_REFERENCE_WORDS.unreadable(number, error.message))
    throw error
  }
}

/**
 * One reference, or a region of it, as one PNG whose long side is exactly `min(CROP_LIMITS.side, CROP_LIMITS.upscale × the region's long side)`
 * (`cropAndScale`: enlarged bilinearly, shrunk by averaging). The answer says which picture it is, how large the original is and which
 * rectangle of it this is, in pixels of the original, so the next region can be planned from it.
 */
export function viewReference(references: Shown[], input: { reference: number | string; region?: CropRegion }) {
  const { number, reference } = picked(references, input.reference)
  const image = decoded(reference.url, number)
  const made = (() => {
    try {
      return cropAndScale(image, input.region)
    } catch (error) {
      if (error instanceof CropRefusal) throw new MakingRefusal(error.message)
      throw error
    }
  })()
  const original = { width: image.width, height: image.height }
  const shown = { width: made.image.width, height: made.image.height }
  return {
    reference: { number, kind: reference.kind, name: reference.name, ...(reference.view ? { view: viewSlot(reference.view) } : {}), ...(reference.by ? { by: reference.by } : {}) },
    original,
    rect: made.rect,
    shown,
    pictures: [{ label: VIEW_REFERENCE_WORDS.label(number, reference, original, made.rect, shown), url: `data:image/png;base64,${Buffer.from(encodePng(made.image.pixels, shown.width, shown.height)).toString("base64")}` }],
    next_step: VIEW_REFERENCE_WORDS.next_step,
  }
}
