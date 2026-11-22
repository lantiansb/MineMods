import { z } from "zod"
import { addReference, MakingRefusal, readByWords, readReferences, REFERENCE_REFUSALS, ReferenceRefusal, removeReference, setByWords, setThreeView, shownReferences, SIX_VIEW_NAME, THREE_VIEW_NOTE, THREE_VIEW_SLOTS, threeViewPrompt, SixViewStyleSchema, type SixViewStyle, type PartSheet } from "@minemods/mod-core/making"
import type { ActivityInput } from "@minemods/mod-core/activity"
import { pictureCanBeAsked, pictureModel, requestPicture } from "@minemods/ai-service/image-request"
import type { StructuredTransport } from "@minemods/ai-service/structured-request"
import type { OverviewItem, ReferenceImage, ThreeViewResult } from "../api"
import { ExternalThreeViewFinishInputSchema, ExternalThreeViewPromptInputSchema } from "../external"

/**
 * Reference images of an overview item, as the app's screen uses them: the person adds and removes their
 * own; views an AI drew are listed with them and can be removed the same way. `itemId` is an
 * `OverviewItem.id` (a plan entry's key or a saved asset's id), so a picture can be attached before
 * anything has been made. The pictures stay in the project; this file sends them nowhere, except the
 * words of a thing whose 六视图 the person asked the connection's image model to draw.
 */

const ItemId = z.string().min(1).max(200)
const Input = z.strictObject({ projectId: z.uuid(), itemId: ItemId })
const Picture = z.string().min(1).max(8 * 1024 * 1024)
const AddInput = Input.extend({ name: z.string().max(200), url: Picture })
const RemoveInput = Input.extend({ referenceId: z.uuid() })
const ThreeViewInput = Input.extend({ view: z.enum(THREE_VIEW_SLOTS), style: SixViewStyleSchema.optional(), name: z.string().max(200), url: Picture })
const DrawInput = Input.extend({ note: z.string().max(THREE_VIEW_NOTE).optional() })

/** What the person is told about drawing a 六视图 (stored as a "three_view", the name it had when it was three), in plain words. */
export const THREE_VIEW_DRAWING = {
  no_key: `要在 Studio 里画${SIX_VIEW_NAME}，得在「连接」里接上一个能画图的接口（比如 gpt-image-1）。`,
  no_route: `现在连接的这条路线只能回答文字，画不了图。要在 Studio 里画${SIX_VIEW_NAME}，得在「连接」里接上一个能画图的接口（比如 gpt-image-1）。`,
  mcp: `MCP 模式请让外部 AI 确认自己的生图能力，再生成并提交${SIX_VIEW_NAME}。`,
  unsupported: `当前外部 AI 不具备生图能力，请独立准备${SIX_VIEW_NAME}。`,
  no_picture: "这次没画出来：画图接口没有给回一张图。可能是这个接口不支持画图、画图模型的名字不对，或者暂时连不上。稍后再试，或者在「连接」里换一个能画图的模型。",
  gone: "找不到这样东西，可能已经被删掉了。",
  being_made: REFERENCE_REFUSALS.being_made,
  drawn: (title: string) => `画了「${title}」的${SIX_VIEW_NAME}（AI 画的）。`,
  failed: (title: string) => `没画出「${title}」的${SIX_VIEW_NAME}。`,
  /** What the drawn picture is called in the list. */
  name: `AI 画的${SIX_VIEW_NAME}`,
} as const

/** How long one drawing may take: the same bound `requestPicture` sets itself, so the person's wait ends with words, not silence. */
const DRAWING_PATIENCE = 180_000

const plain = (error: unknown): never => {
  throw error instanceof ReferenceRefusal ? new MakingRefusal(error.message) : error
}

export function createReferenceService(options: {
  directoryFor: (projectId: string, readOnly?: boolean) => Promise<string>
  /** The overview item as the screen has it, and its part sheet when one was written; null when there is no such item. */
  thing?: (input: { projectId: string; itemId: string }, readOnly?: boolean) => Promise<{ item: Pick<OverviewItem, "title" | "brief" | "kind" | "status">; sheet: Pick<PartSheet, "subject" | "recognisable" | "parts"> | null; style?: SixViewStyle } | null>
  /** The connection Studio draws with, read at each call: the person may change it at any time. */
  connection?: () => { mode?: "api" | "mcp"; apiKey?: string; baseUrl?: string; imageModel?: string }
  /** Stands in for the image endpoint in tests; left out, the real one is asked. */
  transport?: StructuredTransport
  /** Report to the project's activity log. */
  say?: (projectId: string, event: ActivityInput) => Promise<unknown>
  /** A refusal for the person, in the type the app shows as it is. */
  refuse: (message: string) => Error
}) {
  const shown = async (directory: string, itemId: string): Promise<ReferenceImage[]> => shownReferences(directory, [itemId])
  /** API mode uses the configured image endpoint; MCP mode uses the external agent's image tools. */
  const drawing = () => {
    const connection = options.connection?.() ?? {}
    if (connection.mode === "mcp") return { mode: "mcp" as const, can: false, model: null, why: null }
    if (!connection.apiKey?.trim()) return { mode: "api" as const, can: false, model: null, why: THREE_VIEW_DRAWING.no_key }
    if (!pictureCanBeAsked(connection.baseUrl, connection.imageModel)) return { mode: "api" as const, can: false, model: null, why: THREE_VIEW_DRAWING.no_route }
    return { mode: "api" as const, can: true, model: pictureModel(connection.imageModel), why: null }
  }
  /** A model item that exists and is not being made right now: the only thing a three-view may be put on. */
  const modelThing = async (input: { projectId: string; itemId: string }, readOnly = false) => {
    const found = await options.thing?.(input, readOnly)
    if (!found) throw options.refuse(THREE_VIEW_DRAWING.gone)
    if (found.item.kind !== "model") throw options.refuse(REFERENCE_REFUSALS.not_a_model)
    if (!readOnly && found.item.status === "making") throw options.refuse(THREE_VIEW_DRAWING.being_made)
    return found
  }
  return {
    async list(input: unknown) {
      const parsed = Input.parse(input)
      return shown(await options.directoryFor(parsed.projectId), parsed.itemId)
    },
    /** Only the person adds here, so what is added is always theirs. */
    async add(input: unknown) {
      const parsed = AddInput.parse(input)
      const directory = await options.directoryFor(parsed.projectId)
      await addReference(directory, parsed.itemId, { kind: "user", name: parsed.name, url: parsed.url }).catch(plain)
      return shown(directory, parsed.itemId)
    },
    async remove(input: unknown) {
      const parsed = RemoveInput.parse(input)
      const directory = await options.directoryFor(parsed.projectId)
      await removeReference(directory, parsed.itemId, parsed.referenceId).catch(plain)
      return shown(directory, parsed.itemId)
    },
    /** 六视图: the person's own picture into one slot of a model's six views (a `side` from an older caller is its left). */
    async addThreeView(input: unknown) {
      const parsed = ThreeViewInput.parse(input)
      await modelThing(parsed)
      const directory = await options.directoryFor(parsed.projectId)
      await setThreeView(directory, parsed.itemId, { view: parsed.view, by: "person", name: parsed.name, url: parsed.url, style: parsed.style }).catch(plain)
      return shown(directory, parsed.itemId)
    },
    /** A read-only hand-off: the same layout and model description as API drawing, without requesting or storing a picture. */
    async getThreeViewPrompt(input: unknown) {
      const parsed = ExternalThreeViewPromptInputSchema.parse(input)
      const found = await modelThing(parsed, true)
      const style = parsed.style ?? found.style ?? "blocky"
      return [
        "先确认你当前是否有可调用的生图工具。有生图工具就直接调用，按下面的规格生成六视图图片，再调用 finish_six_view 提交到当前模型。没有生图工具就调用 finish_six_view，result 写 { status: 'unsupported', reason: '当前不具备生图能力的真实原因' }，明确告诉用户需要独立准备六视图。不要用脚本、SVG、占位图或文字冒充生图，不要开始建模。",
        `当前模型：${JSON.stringify({ projectId: parsed.projectId, itemId: parsed.itemId, title: found.item.title })}`,
        threeViewPrompt({ title: found.item.title, words: found.item.brief, sheet: found.sheet, note: parsed.note ?? null }, style),
        `图片画好后，调用 finish_six_view：projectId 为 ${parsed.projectId}，itemId 为 ${JSON.stringify(parsed.itemId)}，style 为 ${JSON.stringify(style)}，result 为 { status: 'generated', image: 'data:image/png;base64,…', name: '六视图' }。image 必须是实际图片的完整数据，替换示例里的省略号；也支持 JPEG（image/jpeg）和 WebP（image/webp）。只提交这一张三列两行的整图，解码后不超过 4 MiB。Studio 会自动加到当前模型「${found.item.title}」的六视图；只有工具确认成功后才能告知用户已添加。`,
      ].join("\n\n")
    },
    async finishThreeView(input: unknown): Promise<ThreeViewResult> {
      const parsed = ExternalThreeViewFinishInputSchema.parse(input)
      const found = await modelThing(parsed, parsed.result.status === "unsupported")
      const directory = await options.directoryFor(parsed.projectId, parsed.result.status === "unsupported")
      const about = { kind: "look" as const, tool: "finish_six_view", item: parsed.itemId, title: found.item.title.slice(0, 120), end: true }
      if (parsed.result.status === "unsupported") {
        await options.say?.(parsed.projectId, { ...about, mark: "warn", text: THREE_VIEW_DRAWING.unsupported, lines: [parsed.result.reason] })
        return { status: "unsupported", message: THREE_VIEW_DRAWING.unsupported, references: await shown(directory, parsed.itemId) }
      }
      const provided = parsed.result.status === "provided"
      await setThreeView(directory, parsed.itemId, {
        view: parsed.result.status === "provided" ? parsed.result.view ?? "sheet" : "sheet",
        by: provided ? "person" : "ai",
        name: parsed.result.name ?? (provided ? SIX_VIEW_NAME : THREE_VIEW_DRAWING.name),
        url: parsed.result.image,
        style: parsed.style,
      }).catch((error: unknown) => {
        throw error instanceof ReferenceRefusal ? options.refuse(error.message) : error
      })
      const message = `已把${provided ? "用户提供" : "外部 AI 生成"}的${SIX_VIEW_NAME}加到「${found.item.title}」。`
      await options.say?.(parsed.projectId, { ...about, mark: "ok", text: message })
      return { status: parsed.result.status, message, references: await shown(directory, parsed.itemId) }
    },
    /**
     * 六视图 drawn by the connection's image model from the thing's own words, when the person asks: one sheet, six views in fixed places. It takes the place of an earlier
     * drawing and never of the person's own. Every way it can come to nothing is said in plain words; nothing is stored then.
     */
    async drawThreeView(input: unknown) {
      const parsed = DrawInput.parse(input)
      const can = drawing()
      if (can.mode === "mcp") throw options.refuse(THREE_VIEW_DRAWING.mcp)
      if (!can.can) throw options.refuse(can.why!)
      const found = await modelThing(parsed)
      const directory = await options.directoryFor(parsed.projectId)
      // Asked before paying for a picture that would be refused anyway; asked again under the lock when it is stored.
      if ((await readReferences(directory, parsed.itemId)).some((reference) => reference.kind === "three_view" && reference.by === "person")) throw options.refuse(REFERENCE_REFUSALS.person_three_view)
      const connection = options.connection!()
      const style = found.style ?? "blocky"
      const url = await requestPicture({
        apiKey: connection.apiKey!,
        baseUrl: connection.baseUrl,
        model: can.model!,
        prompt: threeViewPrompt({ title: found.item.title, words: found.item.brief, sheet: found.sheet, note: parsed.note ?? null }, style),
        size: "1536x1024",
        signal: AbortSignal.timeout(DRAWING_PATIENCE),
        transport: options.transport,
      })
      const about = { item: parsed.itemId, title: found.item.title.slice(0, 120) }
      if (!url) {
        await options.say?.(parsed.projectId, { ...about, kind: "look", mark: "fail", end: true, text: THREE_VIEW_DRAWING.failed(found.item.title), lines: [THREE_VIEW_DRAWING.no_picture], detail: `画图模型：${can.model}` })
        throw options.refuse(THREE_VIEW_DRAWING.no_picture)
      }
      await setThreeView(directory, parsed.itemId, { view: "sheet", by: "ai", name: THREE_VIEW_DRAWING.name, url, style }).catch((error: unknown) => {
        throw error instanceof ReferenceRefusal ? options.refuse(error.message) : error
      })
      await options.say?.(parsed.projectId, { ...about, kind: "look", mark: "ok", end: true, text: THREE_VIEW_DRAWING.drawn(found.item.title), detail: `画图模型：${can.model}` })
      return shown(directory, parsed.itemId)
    },
    threeViewDrawing: async () => drawing(),
    /** Whether the person already chose to have this thing made from words alone. The choice is kept with the thing, so it also holds when they send it back. */
    async byWords(input: unknown) {
      const parsed = Input.parse(input)
      return readByWords(await options.directoryFor(parsed.projectId), parsed.itemId)
    },
    /** Records that choice (「直接开始」): this thing is not asked about its 六视图 again. */
    async chooseByWords(input: unknown) {
      const parsed = Input.parse(input)
      await setByWords(await options.directoryFor(parsed.projectId), parsed.itemId)
    },
  }
}
