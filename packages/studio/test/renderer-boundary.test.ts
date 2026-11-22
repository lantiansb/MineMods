import { expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { builtinModules } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

// The page is built by Vite for a browser: a Node module reached from it is replaced by an empty stand-in, and a named import from that stand-in
// fails the build (broad20 prep: the renderer reached `mod-core/png.ts` → `node:zlib` through a words constant kept next to disk-reading code).
// Type checks and unit tests run under Bun, where Node modules exist, so only this walk catches it before the app build does.
// Rule: no module the renderer imports for its values may import a Node built-in for its values. Type-only imports vanish in the build and are skipped.

const PACKAGES = fileURLToPath(new URL("../..", import.meta.url))
const RENDERER = path.join(PACKAGES, "studio", "src", "renderer")
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))

/** The specifiers a file imports or re-exports for their values, read with the TypeScript parser. Type-only forms are left out: the build drops them. */
function valueSpecifiers(file: string) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      const values = !clause || (!clause.isTypeOnly && (!!clause.name || !bindings || ts.isNamespaceImport(bindings) || bindings.elements.some((element) => !element.isTypeOnly)))
      if (values) found.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause
      const values = !node.isTypeOnly && (!clause || !ts.isNamedExports(clause) || clause.elements.some((element) => !element.isTypeOnly))
      if (values) found.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      found.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function resolve(from: string, spec: string) {
  let base: string | undefined
  const workspace = /^@minemods\/([^/]+)\/(.+)$/.exec(spec)
  if (workspace) base = path.join(PACKAGES, workspace[1]!, "src", workspace[2]!)
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec)
  if (!base) return undefined
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return undefined
}

function rendererFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    return entry.isDirectory() ? rendererFiles(full) : /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : []
  })
}

test("nothing the page imports reaches a Node built-in", () => {
  const from = new Map<string, string>()
  const queue = rendererFiles(RENDERER)
  const seen = new Set(queue)
  const reached: string[] = []
  while (queue.length) {
    const file = queue.shift()!
    for (const spec of valueSpecifiers(file)) {
      if (BUILTINS.has(spec)) {
        const chain = [file]
        while (from.has(chain.at(-1)!)) chain.push(from.get(chain.at(-1)!)!)
        reached.push(`${spec} ← ${chain.map((step) => path.relative(PACKAGES, step)).join(" ← ")}`)
        continue
      }
      const next = resolve(file, spec)
      if (next && !seen.has(next)) {
        seen.add(next)
        from.set(next, file)
        queue.push(next)
      }
    }
  }
  expect(reached).toEqual([])
})

test("the walk sees through the forms a real Node import takes", () => {
  const sample = path.join(os.tmpdir(), `boundary-${process.pid}.ts`)
  writeFileSync(
    sample,
    [
      'import { deflateSync } from "node:zlib"',
      'import type { Stats } from "node:fs"',
      'import { type Dirent, type Stats as S } from "node:fs/promises"',
      'import { type Hash, randomUUID } from "node:crypto"',
      'import * as system from "node:os"',
      'export { KEPT_WORDS } from "./kept-words"',
      'export type { Kind } from "./kinds"',
      "export function later() {",
      '  return import("node:path")',
      "}",
    ].join("\n"),
  )
  try {
    expect(valueSpecifiers(sample)).toEqual(["node:zlib", "node:crypto", "node:os", "./kept-words", "node:path"])
  } finally {
    rmSync(sample, { force: true })
  }
})
