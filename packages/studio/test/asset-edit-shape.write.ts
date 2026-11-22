import { fileURLToPath } from "node:url"
import { HAND_KINDS, handShape } from "../src/main/content-service"
const body = Object.fromEntries(HAND_KINDS.map((kind) => [kind, handShape(kind)]))
const text = `// Generated from mod-core's schemas by \`handShape\` (src/main/content-service.ts); never edited by hand.
// The renderer cannot load the schemas themselves (they reach Node), so it reads their shape from here.
// test/asset-edit-form.test.ts holds this file to the live schemas; when it fails, write the file again with
// \`bun --preload <shim> test/asset-edit-shape.write.ts\`.
import type { HandField, HandKind } from "../../main/content-service"

export const HAND_SHAPES: Record<HandKind, Extract<HandField, { type: "object" }>> = ${JSON.stringify(body, null, 1).replace(/\n\s+/g, " ")}
`
// fileURLToPath, not URL.pathname: on Windows the pathname is "/C:/…", which Bun cannot write to.
await Bun.write(fileURLToPath(new URL("../src/renderer/features/asset-edit-shape.ts", import.meta.url)), text)
console.log(text.length)
