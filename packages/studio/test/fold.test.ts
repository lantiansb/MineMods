import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { foldAttributes, followOpen, nextFoldId, pressed } from "../src/renderer/fold-model"

const renderer = path.join(import.meta.dir, "../src/renderer")
const walk = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
const files = walk(renderer)
const read = (file: string) => readFileSync(file, "utf8")
const relative = (file: string) => path.relative(renderer, file)

// broad7 and broad9: in the packaged app (Electron 35, Chromium 134) a <details> showed its own internal stylesheet as text on the page
// (`:host summary { display: list-item; ... }`), in the mod guide and again in the build drawer's Java card. No rule of ours turns it on and the
// same page in a newer Chromium is clean, so the page is kept off the element: every fold is the shared button in fold.tsx.
describe("no browser <details> in the renderer", () => {
  test("no renderer .tsx file writes a details or summary element", () => {
    const found = files.filter((file) => file.endsWith(".tsx")).filter((file) => /<\/?(details|summary)[\s>]/.test(read(file)))
    expect(found.map(relative)).toEqual([])
  })

  test("no stylesheet still styles a details or summary element, or the marker of one", () => {
    const sheets = files.filter((file) => file.endsWith(".css") && !file.endsWith("obsidian.css"))
    const bare = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "")
    const found = sheets.flatMap((file) => [...bare(read(file)).matchAll(/(?<![\w.#-])(details|summary)(?![\w-])|::-webkit-details-marker|\[open\]/g)].map((match) => `${relative(file)}: ${match[0]}`))
    expect(found).toEqual([])
  })

  test("every file that writes a Fold imports it, and every Fold has its summary", () => {
    const users = files.filter((file) => file.endsWith(".tsx") && !file.endsWith("/fold.tsx") && /<Fold[\s>]/.test(read(file)))
    expect(users.length).toBeGreaterThan(10)
    users.forEach((file) => expect(read(file)).toMatch(/import \{ Fold \} from "\.\.?\/fold"/))
    users.forEach((file) => {
      const text = read(file)
      expect(text.match(/<Fold[\s>]/g)!.length).toBe(text.match(/<\/Fold>/g)!.length)
      // A fold with no summary would be a button with nothing on it.
      expect(text.match(/\bsummary=/g)!.length).toBeGreaterThanOrEqual(text.match(/<Fold[\s>]/g)!.length)
    })
  })
})

describe("the fold", () => {
  test("its button says whether the content shows and which content it is", () => {
    const first = nextFoldId()
    const second = nextFoldId()
    expect(first).not.toBe(second)
    expect(foldAttributes(false, first)).toEqual({ "aria-expanded": "false", "aria-controls": first })
    expect(foldAttributes(true, second)).toEqual({ "aria-expanded": "true", "aria-controls": second })
  })

  test("a press always flips it, and a changed open prop is followed while an unchanged one leaves the person's choice", () => {
    expect(pressed(false)).toBe(true)
    expect(pressed(true)).toBe(false)
    // `open={index() === 0}`: nobody pressed anything and it is still the same, so it stays as it started.
    expect(followOpen(true, true, true)).toBe(true)
    // The person closed it; the expression has not changed, so it stays closed.
    expect(followOpen(true, true, false)).toBe(false)
    // The expression turned false (a review that now passes folds up) or true: the fold follows it.
    expect(followOpen(true, false, true)).toBe(false)
    expect(followOpen(false, true, false)).toBe(true)
    expect(followOpen(false, true, true)).toBe(true)
    // Left out is closed, as a details element without `open`.
    expect(followOpen(undefined, undefined, false)).toBe(false)
    expect(followOpen(undefined, true, false)).toBe(true)
    expect(followOpen(true, undefined, true)).toBe(false)
  })

  // The studio tests have no way to render a Solid component (no DOM, and the sources are not compiled for Solid here), so the markup is checked in the source.
  test("it is a real button wired to the content it controls, which stays in the page while folded", () => {
    const source = read(path.join(renderer, "fold.tsx"))
    expect(source).toContain('type="button"')
    expect(source).toContain("{...foldAttributes(open(), id)}")
    expect(source).toContain('<div class="fold-content" id={id} hidden={!open()}>')
    expect(source).toContain("onClick={press}")
    expect(source).toContain('data-open={open() ? "yes" : undefined}')
    // A fold that does not close its content with `display` would show it through the hidden attribute.
    const css = read(path.join(renderer, "fold.css"))
    expect(css).toContain(".fold-content[hidden]")
    expect(css).toMatch(/\.fold-content\s*\{\s*display:\s*contents/)
  })
})
