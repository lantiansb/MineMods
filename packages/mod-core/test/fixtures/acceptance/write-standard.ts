// Rewrites the generated sections of the written acceptance standard from the definitions that do the judging.
// Run: bun packages/mod-core/test/fixtures/acceptance/write-standard.ts
import path from "node:path"
import { ASSET_STANDARDS, writtenStandard } from "../../../src/acceptance"
import { ASSET_KINDS } from "../../../src/workspace-modules"

const file = path.join(import.meta.dir, "../../../../../docs/specs/2026-10-05-acceptance-standard.md")
const written = Object.entries(writtenStandard(ASSET_KINDS.map((kind) => ASSET_STANDARDS[kind.id]))).reduce(
  (text, [name, section]) => text.replace(new RegExp(`<!-- 生成：${name} -->[\\s\\S]*?<!-- 生成结束：${name} -->`), () => `<!-- 生成：${name} -->\n${section}\n<!-- 生成结束：${name} -->`),
  await Bun.file(file).text(),
)
await Bun.write(file, written)
