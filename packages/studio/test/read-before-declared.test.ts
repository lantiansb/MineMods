import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import ts from "typescript"

// A component's body runs top to bottom once, when the window is first drawn. A value worked out on the spot
// (createMemo and its kin run their function at once) that reads a `const` written further down is an exception at
// start: nothing is drawn and the window stays blank. Neither the type check nor the production build sees it, since
// the read sits inside a function. This reads every file of the window and finds such a read wherever it is.

// The calls that run the function they are given before returning. createEffect and onMount wait for the body to end.
const AT_ONCE = new Set(["createMemo", "createComputed", "createRenderEffect", "createRoot", "untrack", "batch", "createSelector"])

type Found = { file: string; line: number; name: string; declared: number }

const isFunction = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)

const bound = (name: ts.BindingName, out: string[]) => {
  if (ts.isIdentifier(name)) return void out.push(name.text)
  for (const element of name.elements) if (!ts.isOmittedExpression(element)) bound(element.name, out)
}

// Whether this identifier is a read of a variable, not a property name or the name being declared.
const reads = (node: ts.Identifier) => {
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false
  if (ts.isJsxAttribute(parent) && parent.name === node) return false
  if ((ts.isVariableDeclaration(parent) || ts.isBindingElement(parent) || ts.isParameter(parent)) && parent.name === node) return false
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false
  if (ts.isPropertySignature(parent) || ts.isTypeReferenceNode(parent) || ts.isQualifiedName(parent)) return false
  return true
}

export function readBeforeDeclared(file: string, text: string): Found[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: Found[] = []
  const line = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1

  const block = (statements: readonly ts.Statement[]) => {
    // Where each `const`/`let` of this body is written, and the local functions by name.
    const where = new Map<string, number>()
    const local = new Map<string, ts.Node>()
    statements.forEach((statement, index) => {
      if (!ts.isVariableStatement(statement)) return
      if (!(statement.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))) return
      for (const declaration of statement.declarationList.declarations) {
        const names: string[] = []
        bound(declaration.name, names)
        for (const name of names) where.set(name, index)
        if (ts.isIdentifier(declaration.name) && declaration.initializer && isFunction(declaration.initializer)) local.set(declaration.name.text, declaration.initializer.body!)
      }
    })
    if (!where.size) return

    // The names a piece of code reads while it runs, following local functions it calls on the way.
    const eager = (node: ts.Node, out: Map<string, ts.Node>, seen: Set<ts.Node>) => {
      const visit = (child: ts.Node, shadowed: ReadonlySet<string>) => {
        if (ts.isTypeNode(child)) return
        if (isFunction(child)) return
        if (ts.isBlock(child) || ts.isCaseBlock(child)) {
          const inner = new Set(shadowed)
          for (const statement of ts.isBlock(child) ? child.statements : [])
            if (ts.isVariableStatement(statement))
              for (const declaration of statement.declarationList.declarations) {
                const names: string[] = []
                bound(declaration.name, names)
                names.forEach((name) => inner.add(name))
              }
          return void ts.forEachChild(child, (next) => visit(next, inner))
        }
        if (ts.isCallExpression(child)) {
          const callee = ts.isIdentifier(child.expression) ? child.expression.text : ""
          if (AT_ONCE.has(callee)) for (const argument of child.arguments) if (isFunction(argument)) run(argument, shadowed)
          const body = !shadowed.has(callee) && local.get(callee)
          if (body && !seen.has(body)) {
            seen.add(body)
            visit(body, new Set())
          }
        }
        if (ts.isIdentifier(child) && reads(child) && !shadowed.has(child.text) && where.has(child.text) && !out.has(child.text)) out.set(child.text, child)
        ts.forEachChild(child, (next) => visit(next, shadowed))
      }
      const run = (fn: ts.FunctionLikeDeclaration, shadowed: ReadonlySet<string>) => {
        const inner = new Set(shadowed)
        for (const parameter of fn.parameters) {
          const names: string[] = []
          bound(parameter.name, names)
          names.forEach((name) => inner.add(name))
        }
        if (fn.body) visit(fn.body, inner)
      }
      visit(node, new Set())
    }

    statements.forEach((statement, index) => {
      const names = new Map<string, ts.Node>()
      eager(statement, names, new Set())
      for (const [name, at] of names) {
        const declared = where.get(name)!
        if (declared > index) found.push({ file, line: line(at), name, declared: line(statements[declared]!) })
      }
    })
  }

  const walk = (node: ts.Node) => {
    if (isFunction(node) && node.body && ts.isBlock(node.body)) block(node.body.statements)
    ts.forEachChild(node, walk)
  }
  walk(source)
  return found
}

const files = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name)
    if (statSync(full).isDirectory()) return files(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })

describe("窗口第一次画出来时，不读还没写到的值", () => {
  test("认得出这种写法", () => {
    const bad = `function App() {\n  const a = createMemo(() => later())\n  const [later] = createSignal(1)\n  return a\n}`
    expect(readBeforeDeclared("bad.tsx", bad)).toEqual([{ file: "bad.tsx", line: 2, name: "later", declared: 3 }])
    const through = `function App() {\n  const read = () => later()\n  const a = createMemo(() => read())\n  const [later] = createSignal(1)\n  return a\n}`
    expect(readBeforeDeclared("through.tsx", through).map((entry) => entry.name)).toEqual(["later"])
    const fine = `function App() {\n  const read = () => later()\n  const [later] = createSignal(1)\n  const a = createMemo(() => read())\n  createEffect(() => after())\n  const after = () => 1\n  return a\n}`
    expect(readBeforeDeclared("fine.tsx", fine)).toEqual([])
  })

  test("窗口的每个文件", () => {
    const root = path.join(import.meta.dir, "../src/renderer")
    const found = files(root).flatMap((file) => readBeforeDeclared(path.relative(root, file), readFileSync(file, "utf8")))
    expect(found).toEqual([])
  })
})
