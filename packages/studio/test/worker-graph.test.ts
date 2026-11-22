import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

// r22–r24 were packed with a stale window: reconcile.ts had begun importing blueprint.ts, which brought workspace.ts and its Node-only
// modules into the thread that words a creature's card, and the window's build failed on them. The build is the real check (packing
// stops when it fails); this one says which import did it, in seconds, without building.
const packages = path.resolve(import.meta.dir, "../..")
const sources = { "@minemods/mod-core/": "mod-core/src/", "@minemods/studio-ai/": "studio-ai/src/" }

function resolve(from: string, spec: string) {
  const scope = Object.entries(sources).find(([prefix]) => spec.startsWith(prefix))
  const base = spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : scope ? path.resolve(packages, scope[1], spec.slice(scope[0].length)) : null
  return base ? (["", ".ts", ".tsx"].map((ext) => base + ext).find((file) => existsSync(file) && !file.endsWith(path.sep)) ?? null) : null
}

/** Every module the entry runs with (type-only imports are erased and do not count), each with the module that first brought it in. */
function reach(entry: string) {
  const from = new Map<string, string | null>([[entry, null]])
  const node = new Map<string, string[]>()
  for (const file of from.keys()) {
    const text = readFileSync(file, "utf8")
    for (const [, spec] of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^"']*?from\s+["']([^"']+)["']/gm)) {
      if (spec!.startsWith("node:")) node.set(file, [...(node.get(file) ?? []), spec!])
      const next = resolve(file, spec!)
      if (next && !from.has(next)) from.set(next, file)
    }
  }
  const chain = (file: string): string => (from.get(file) ? `${chain(from.get(file)!)} → ` : "") + path.relative(packages, file).replaceAll(path.sep, "/")
  return { node, chain }
}

test("the thread that words a creature's card runs without any Node-only module", () => {
  const { node, chain } = reach(path.resolve(import.meta.dir, "../src/renderer/features/entity-words.worker.ts"))
  expect([...node].map(([file, specs]) => `${chain(file)} imports ${specs.join(", ")}`)).toEqual([])
})
