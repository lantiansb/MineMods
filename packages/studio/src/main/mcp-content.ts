import { z } from "zod"

/** A tool result as MCP content: the value as JSON text, and again as structured content. */
export function output(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: { value } }
}

/**
 * A result that carries pictures: the words go as JSON text with each picture's label in place of the
 * picture, and the pictures themselves follow as MCP image content in the same order, so a client that
 * can see is shown them and the text stays small.
 */
export function pictured(value: unknown) {
  const result = z.looseObject({ pictures: z.array(z.strictObject({ label: z.string(), url: z.string() })) }).safeParse(value)
  if (!result.success) return output(value)
  const images = result.data.pictures.flatMap((picture) => {
    const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(picture.url)
    return match ? [{ type: "image" as const, data: match[2]!, mimeType: match[1]! }] : []
  })
  const words = { ...result.data, pictures: result.data.pictures.map((picture) => picture.label) }
  return { content: [{ type: "text" as const, text: JSON.stringify(words) }, ...images], structuredContent: { value: words } }
}
