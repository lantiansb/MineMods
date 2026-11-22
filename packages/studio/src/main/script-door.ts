import { z } from "zod"
import { MakingRefusal } from "@minemods/mod-core/making"
import { DRAWN_GUIDE, isDrawn, isScripted, runBlockDrawing, runDrawing, runScript, SCRIPT_ERRORS, SCRIPT_GUIDE, SCRIPT_LIMITS, type DrawingRun, type ScriptSummary, type ShapeRun, type TracePicture } from "@minemods/mod-core/script-run"
import { getModuleSchema, MODULES, type ModuleDocument, type ModuleKind } from "@minemods/mod-core/workspace"

/**
 * Where a script comes in. A model, a texture or an animation may be handed in as a script instead of a
 * document; here it is run (shut away, see `mod-core/script-sandbox.ts`) and from this point on only the
 * document it produced exists. Nothing after this door knows a script wrote it, except the making record,
 * which keeps the script beside the round so the next version can be made by editing it.
 */

type Model = Extract<ModuleDocument, { kind: "model" }>

export const ScriptSourceSchema = z.string().min(1).max(SCRIPT_LIMITS.source)

/** How often Studio's own AI is handed its script back with what went wrong before the version is given up. */
export const SCRIPT_REPAIRS = 2

export type FromScript = { document: unknown; script: string; made: { summary: ScriptSummary; notes: string[] } }

/** Said when a block or an item comes with a drawing script and no document for the picture to go into. */
export const DRAWN_NEEDS_DOCUMENT = "给方块或物品画图的脚本只管那一张图：名字和数值还是要写在 document 里（texture 写 null），和 script 一起交。"

/** A block's or an item's document with the picture its script drew put into `texture`. The script draws the picture and nothing else. */
export async function drawnInto(document: unknown, script: string, kind: string, pictures: TracePicture[] = []): Promise<FromScript> {
  if (typeof document !== "object" || document === null) throw new MakingRefusal(DRAWN_NEEDS_DOCUMENT)
  const ran = severalOnlyForBlocks(kind, await runDrawn(kind, script, pictures))
  if (!ran.ok) throw new MakingRefusal(`${ran.error}脚本没有画出图，什么都没有改动：改好脚本再交一次。`)
  return { document: pictured(document, ran), script, made: { summary: ran.summary, notes: ran.notes } }
}

/** What a drawing script made: for a block, a picture or a shape; for an item, only a picture. */
const runDrawn = (kind: string, script: string, pictures: TracePicture[]): Promise<DrawingRun | ShapeRun> => (kind === "block" ? runBlockDrawing(script, { pictures }) : runDrawing(script, { pictures, particle: kind === "particle" }))

/** Only a block has more pictures than one: a list handed back for an item is refused in words, never cut down to its first. */
const severalOnlyForBlocks = <Run extends DrawingRun | ShapeRun>(kind: string, ran: Run): Run | DrawingRun => (ran.ok && "variants" in ran && ran.variants.length && kind === "item" ? { ok: false, error: SCRIPT_ERRORS.one_picture, line: null } : ran)
/**
 * The document with what the script drew: the first picture in `texture`; the rest, when the script drew several, in `variants` in place of any written there.
 * A script that made a shape sets the document's `shape` and leaves `texture` alone: the pieces a block breaks into stay the colour or picture it had.
 */
const pictured = <Document extends object>(document: Document, ran: Extract<DrawingRun | ShapeRun, { ok: true }>) =>
  "variants" in ran && "kind" in document && document.kind === "particle" ? { ...document, frames: [ran.texture,...ran.variants] } : "shape" in ran ? { ...document, shape: ran.shape } : { ...document, texture: ran.texture, ...(ran.variants.length ? { variants: ran.variants } : {}) }

/** The kinds Studio's own AI may answer with a script: as the whole document, or (a block, an item) as its one picture. */
export const answersScript = (kind: string) => isScripted(kind) || isDrawn(kind)

/** Run a script for a thing of this kind. A script that yields no document is a refusal in the words its author can act on; nothing was changed. */
export async function fromScript(kind: string, script: string, wears: Model | null, pictures: TracePicture[] = []): Promise<FromScript> {
  const ran = await runScript(kind, script, wears, { pictures })
  if (!ran.ok) throw new MakingRefusal(`${ran.error}脚本没有产出文档，什么都没有改动：改好脚本再交一次。`)
  return { document: ran.document, script, made: { summary: ran.summary, notes: ran.notes } }
}

/** What an outside AI handed in: a document, or a script run into one. Both at once is refused, since they could disagree. */
export async function handedIn(kind: string, given: { document?: unknown; script?: string }, wears: () => Model | null | Promise<Model | null>, concepts: () => Promise<TracePicture[]> = async () => []): Promise<{ document: unknown; script?: string; made?: FromScript["made"] }> {
  if (given.script === undefined) return { document: given.document }
  // A block or an item: the document carries the name and the numbers, the script draws its picture. Both are handed in.
  // The concept pictures are read only for a script, and only when it is run: a hand-in without a script never decodes one.
  if (isDrawn(kind)) return drawnInto(given.document, given.script, kind, await concepts())
  if (given.document !== undefined && given.document !== null) throw new MakingRefusal("document 和 script 只交一样：两样都给，Studio 不知道以哪一个为准。")
  return fromScript(kind, given.script, await wears(), await concepts())
}

/**
 * What Studio's own AI answers when it makes a version of a kind that can be scripted: a script, or the
 * document itself, the other null. A bare document (an answer from before scripts existed, or from a
 * provider that ignores the schema) is taken as the document.
 */
export function scriptedAnswerSchema(kind: ModuleKind) {
  // A block or an item is always answered with its document; the script, when there is one, draws the picture into it.
  if (isDrawn(kind)) return z.preprocess((value) => (typeof value === "object" && value !== null && !("script" in value) && "kind" in value ? { script: null, document: value } : value), z.strictObject({ script: z.string().max(SCRIPT_LIMITS.source).nullable(), document: getModuleSchema(kind) }))
  const answer = z.strictObject({ script: z.string().max(SCRIPT_LIMITS.source).nullable(), document: getModuleSchema(kind).nullable() })
  return z.preprocess((value) => (typeof value === "object" && value !== null && !("script" in value) && "kind" in value ? { script: null, document: value } : value), answer)
}

/** Added to a scripted kind's instructions for Studio's own AI. */
export const SCRIPTED_ANSWER_INSTRUCTIONS =
  `这一样东西有两种交法，任选其一：把 script 写成一段脚本、document 写 null；或者把 document 写成完整的文档、script 写 null。${SCRIPT_GUIDE}` +
  `如果有 revision_required.script，上一版是用脚本做的：在那段脚本上改，再把改好的整段脚本交回来。如果有 script_failed，是你刚交的脚本没有跑出文档：error 说了哪里不对、是第几行，照着改好再交。`

/** The same for a block or an item: the document is always written; the script draws its one picture. */
export const DRAWN_ANSWER_INSTRUCTIONS =
  `这一样东西的回答有两栏：document 写完整的文档（名字、数值照常写），script 写画它那张图的脚本——这时 document 的 texture 写 null，Studio 运行脚本，把画出来的图放进 texture。不想用脚本，就把 script 写 null，把 PNG（data URL）直接写在 texture 里。${DRAWN_GUIDE}` +
  `如果有 revision_required.script，上一版的图是用脚本画的：在那段脚本上改，再把改好的整段脚本交回来。如果有 script_failed，是你刚交的脚本没有画出图：error 说了哪里不对、是第几行，照着改好再交。`

/** What is added to a kind's instructions when Studio's own AI may answer with a script. */
export const scriptedAnswerInstructions = (kind: string) => (kind === "particle" ? "document 照常写数值，脚本用 api.canvas 或 api.shape 创建和修改画布，return 1 到 8 张同尺寸正方形画布的列表，边长至多 32，支持 #rrggbbaa。脚本会替换 frames，可先放一张 {shape:\"dot\"}。" : isDrawn(kind) ? DRAWN_ANSWER_INSTRUCTIONS : SCRIPTED_ANSWER_INSTRUCTIONS)

/**
 * One version from Studio's own AI, whichever way it chose to write it. `ask` makes the request; when
 * the script it answers with does not run, it is asked again with the script and what went wrong, a
 * couple of times, and then the version is given up in plain words.
 */
export async function settled(kind: ModuleKind, ask: (failed?: { script: string; error: string; line: number | null }) => Promise<unknown>, wears: Model | null, failed?: { script: string; error: string; line: number | null }, tries = 0, pictures: TracePicture[] = []): Promise<{ document: ModuleDocument; script?: string }> {
  const given = await ask(failed)
  if (isDrawn(kind)) {
    const drawn = given as { script: string | null; document: ModuleDocument }
    if (!drawn.script?.trim()) return { document: drawn.document }
    const ran = severalOnlyForBlocks(kind, await runDrawn(kind, drawn.script, pictures))
    if (ran.ok) return { document: pictured(drawn.document, ran) as ModuleDocument, script: drawn.script }
    if (tries >= SCRIPT_REPAIRS) throw new MakingRefusal(`AI 写的画图脚本改了 ${SCRIPT_REPAIRS} 次还是画不出${MODULES[kind].label}的图：${ran.error}`)
    return settled(kind, ask, wears, { script: drawn.script, error: ran.error, line: ran.line }, tries + 1, pictures)
  }
  // A kind that takes documents only was asked for the document itself.
  if (!isScripted(kind)) return { document: given as ModuleDocument }
  const answer = given as { script: string | null; document: ModuleDocument | null }
  if (!answer.script?.trim()) {
    if (!answer.document) throw new MakingRefusal(`模型没有交出${MODULES[kind].label}：script 和 document 都是空的。`)
    return { document: answer.document }
  }
  const ran = await runScript(kind, answer.script, wears, { pictures })
  if (ran.ok) return { document: ran.document as ModuleDocument, script: answer.script }
  if (tries >= SCRIPT_REPAIRS) throw new MakingRefusal(`AI 写的脚本改了 ${SCRIPT_REPAIRS} 次还是跑不出${MODULES[kind].label}：${ran.error}`)
  return settled(kind, ask, wears, { script: answer.script, error: ran.error, line: ran.line }, tries + 1, pictures)
}
