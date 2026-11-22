import { expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
import { avoidWords, chosenPhrases } from "../src/renderer/words-avoid"
import { briefForCreator } from "@minemods/mod-core/creator-words"
import { checkCopy, toolCopy } from "../src/renderer/features/creator-card-copy"
import exceptions from "./fixtures/ui-word-exceptions.json"

type Exception = { file: string; scope: string; text: string; word: string; count: number; reason: string }
const identity = (x: Omit<Exception, "count" | "reason">) => JSON.stringify([x.file, x.scope, x.text, x.word])
const root = path.resolve(import.meta.dir, "../src/renderer")

// Match whole English tokens so that API does not match an environment variable or a class name.
function contains(text: string, word: string) {
  return /^[a-z ]+$/i.test(word) ? new RegExp("(?<![A-Za-z0-9_])" + word + "(?![A-Za-z0-9_])", "i").test(text) : text.includes(word)
}

test("界面词表逐个检查文字、无障碍标签、提示和拼接句", () => {
  const allowed = new Map((exceptions as Exception[]).map(e => [identity(e), { ...e }]))
  const errors: string[] = []
  function inspect(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) { inspect(absolute); continue }
      const file = path.relative(root, absolute).split(path.sep).join("/")
      if (!/\.tsx?$/.test(file) || file === "words-avoid.ts") continue
      const sf = ts.createSourceFile(file, readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true)
      function visit(n: ts.Node) {
        if (ts.isStringLiteralLike(n) || ts.isJsxText(n) || ts.isTemplateHead(n) || ts.isTemplateMiddleOrTemplateTail(n)) {
          const text = n.text.trim()
          if (ts.isJsxText(n) && /[{]|"id" *:|请用户/.test(text)) errors.push(file + " 界面文字混入了内部信息：" + text)
          const candidate = chosenPhrases.reduce((s, phrase) => s.replaceAll(phrase, ""), text)
          const names: string[] = []
          for (let p: ts.Node | undefined = n; p; p = p.parent)
            if ((ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p)) && p.name) names.push(p.name.getText(sf))
          const scope = names.join(" / ")
          for (const word of avoidWords) {
            if (!contains(candidate, word)) continue
            const e = allowed.get(identity({ file, scope, text, word }))
            if (e && e.count > 0 && e.reason) { e.count--; continue }
            const line = 1 + sf.getLineAndCharacterOfPosition(n.getStart(sf)).line
            errors.push(file + ":" + line + " 「" + word + "」 " + text)
          }
        }
        ts.forEachChild(n, visit)
      }
      visit(sf)
    }
  }
  inspect(root)
  for (const entry of allowed.values()) {
    if (entry.count > 0) errors.push(entry.file + " 「" + entry.word + "」允许项已失效：" + entry.text)
  }
  expect(errors).toEqual([])
})

test("验收卡和工具页只显示写给创作者的话", () => {
  const machine = '头部的位置有偏差。如果它本来就该这样，在部件说明的 justified 里写上这一项和理由（{"what":"head","reason":"……"}），理由会原样给评审和人看。'
  const lines = [
    checkCopy(machine, (text) => text),
    checkCopy('请用户核对 {"id":"head"} 后重试。', (text) => text),
    toolCopy('请用户在 Studio 的存储空间下载。'),
    briefForCreator('（协调方转述的事实）把这一整段交给执行者。'),
    briefForCreator('保持暗红。 {"id":"bronze"} 请用户查看。'),
  ]
  for (const line of lines) expect(line).not.toMatch(/[{]|"id" *:|请用户|协调方转述|justified/)
  expect(lines[0]).toContain("请说明原因")
  expect(lines[1]).toContain("请你核对")
  expect(lines.slice(2)).toEqual(["", "", "保持暗红。"])
})
