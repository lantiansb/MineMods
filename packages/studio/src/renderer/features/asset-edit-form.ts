/**
 * 「自己改」 as plain data: the form of a kind laid out from its schema's shape and its words, a document read
 * and written by path, what is wrong with a document before it is sent, and every finding (the form's own or
 * mod-core's) said in a player's words next to the field it is about.
 * No Node APIs and no window: everything here is tested without one.
 */
import type { HandField, HandIssue, HandKind } from "../../main/content-service"
import { SoundAssetRefSchema } from "@minemods/mod-core/sound"
import { HAND_SHAPES } from "./asset-edit-shape"
import { ENTITY_BASICS, HAND_KEPT, HAND_WORDS, ISSUE_RULES, ISSUE_WORDS, at, type Loose, type Word } from "./asset-edit-words"

export type Control = "builtin" | "stagger" | "text" | "long" | "number" | "choice" | "flag" | "color" | "picture" | "grid" | "thing" | "switch" | "many" | "list" | "texture"
/** One control of the form as it stands for a document. `key` is the field's own place (`loot.2.item`). */
export type FormField = {
  key: string
  word: Word
  shape: HandField
  control: Control
  /** A choice's values, already narrowed to what the document allows. */
  options: readonly string[]
  /** 「0 到 15 的整数」, for a number. */
  range: string
  /** A list's entries, each the fields of one. */
  rows: FormField[][]
  /** Inside a group that is switched on above it. */
  inner: boolean
}
export type FormSection = { title: string; fields: FormField[] }

/**
 * What a tick box says, in two separate places so the box has one meaning: `box` is what ticking it does and
 * never changes (the field's own name, which is always the positive thing: 「像矿石一样自己生成」), and `state`
 * is what is true right now. The word a field uses for "left out" (「不生成：只能靠合成…」) is only ever the state:
 * it used to sit beside the box as if it were the box's label, so a person who wanted no generation ticked it,
 * and ticking is what turned generation on.
 */
export function tickWords(word: Pick<Word, "label" | "none">, on: boolean) {
  return { box: word.label, state: on ? "现在：开着" : `现在：${word.none ?? "没开"}` }
}

const parts = (key: string) => (key ? key.split(".") : [])
const indexLike = (part: string) => /^\d+$/.test(part)

/** The schema's shape at a place in a document of a kind; a number or `*` steps into a list. */
export function shapeAt(kind: HandKind, key: string): HandField | undefined {
  return parts(key).reduce<HandField | undefined>((shape, part) => (!shape ? undefined : shape.type === "list" ? (indexLike(part) || part === "*" ? shape.of : undefined) : shape.type === "object" ? shape.fields[part] : undefined), HAND_SHAPES[kind])
}

const words = (kind: HandKind) => HAND_WORDS[kind].flatMap((section) => section.fields)
const pattern = (key: string) => parts(key).map((part) => (indexLike(part) ? "*" : part)).join(".")

/** The word of a place and the place it is the word of: its own, or the nearest field above it that has one. */
export function wordAt(kind: HandKind, key: string): { word: Word; key: string } | null {
  const all = words(kind)
  const found = (length: number): { word: Word; key: string } | null => {
    if (length < 1) return null
    const own = parts(key).slice(0, length).join(".")
    const word = all.find((value) => value.path === pattern(own))
    return word ? { word, key: own } : found(length - 1)
  }
  return found(parts(key).length)
}

export function controlOf(word: Word, shape: HandField): Control {
  if (word.names) return shape.type === "list" ? "many" : "choice"
  if (word.as === "builtin") return "builtin"
  if (word.as === "stagger") return "stagger"
  if (word.as === "long" || word.as === "color" || word.as === "picture" || word.as === "grid" || word.as === "texture") return word.as
  if (word.as) return "thing"
  if (shape.type === "object") return "switch"
  if (shape.type === "list") return shape.of.type === "choice" ? "many" : "list"
  if (shape.type === "choice") return "choice"
  if (shape.type === "flag") return "flag"
  return shape.type === "number" ? "number" : "text"
}

const shown = (value: number) => (value < 0 ? `−${-value}` : String(value))
/** 「0 到 15 的整数」「大于 0，最多 1024」: what a number may be, read off its schema. */
export function rangeWords(shape: HandField) {
  if (shape.type !== "number") return ""
  const low = shape.above !== undefined ? `大于 ${shown(shape.above)}` : shape.min !== undefined ? shown(shape.min) : ""
  const span = shape.above === undefined && shape.min !== undefined && shape.max !== undefined ? `${low} 到 ${shown(shape.max)}` : [low, shape.max !== undefined ? `最多 ${shown(shape.max)}` : ""].filter(Boolean).join("，")
  return `${span}${shape.int ? `${span ? " 的" : ""}整数` : ""}`
}

/**
 * The form for a document as it stands. A field is left out when it is a modder's term and 高级 is off, when
 * its own rule says it means nothing now (`when`), or when the group it belongs to is switched off.
 * `basics`: a creature's form cut down to what the older save route carries.
 */
export function formOf(kind: HandKind, document: Loose, options: { advanced: boolean; basics?: boolean }): FormSection[] {
  const field = (word: Word, key: string): FormField | null => {
    const shape = shapeAt(kind, key)
    if (!shape || (word.advanced && !options.advanced) || (word.when && !word.when(document))) return null
    if (options.basics && kind === "entity" && !ENTITY_BASICS.includes(key)) return null
    // Every group on the way down has to be there: a field of a fuel that is switched off is not shown.
    const above = parts(key).slice(0, -1)
    if (above.some((_, index) => at(document, above.slice(0, index + 1).join(".")) == null)) return null
    const control = controlOf(word, shape)
    const all = shape.type === "choice" ? shape.options : shape.type === "list" && shape.of.type === "choice" ? shape.of.options : []
    const named = word.names?.(document)
    const allowed = word.options?.(document)
    const entries = control === "list" && Array.isArray(at(document, key)) ? (at(document, key) as unknown[]) : []
    const rows = entries.map((_, index) => words(kind).filter((value) => value.path.startsWith(`${word.path}.*.`)).flatMap((value) => field(value, `${key}.${index}.${value.path.slice(word.path.length + 3)}`) ?? []))
    return { key, word: named ? { ...word, choices: named } : word, shape, control, options: named ? Object.keys(named) : allowed ? all.filter((value) => allowed.includes(value)) : all, range: rangeWords(shape), rows, inner: above.some((_, index) => shapeAt(kind, above.slice(0, index + 1).join("."))?.nullable === true || shapeAt(kind, above.slice(0, index + 1).join("."))?.optional === true) }
  }
  return HAND_WORDS[kind]
    .map((section) => ({ title: section.title, fields: section.fields.filter((word) => !word.path.includes("*")).flatMap((word) => field(word, word.path) ?? []) }))
    .filter((section) => section.fields.length)
}

/** A document with one place set; `undefined` takes the place out. Nothing given is changed. */
export function setAt<T>(document: T, key: string, value: unknown): T {
  const [head, ...rest] = parts(key)
  if (head === undefined) return value as T
  if (Array.isArray(document)) {
    const next = [...document]
    next[Number(head)] = setAt(document[Number(head)], rest.join("."), value)
    return next as T
  }
  const source = (typeof document === "object" && document !== null ? document : {}) as Loose
  if (!rest.length && value === undefined) return Object.fromEntries(Object.entries(source).filter(([name]) => name !== head)) as T
  return { ...source, [head]: setAt(source[head], rest.join("."), value) } as T
}

/** Equal as documents: a place that is missing and one that is undefined are the same. */
export function same(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])]
  return keys.every((key) => same((left as Loose)[key], (right as Loose)[key]))
}

const issue = (path: string[], code: string, message = ""): HandIssue => ({ path: path.map((part) => (indexLike(part) ? Number(part) : part)), code, message })

function checkShape(shape: HandField, value: unknown, path: string[]): HandIssue[] {
  if (value === undefined) return shape.optional ? [] : [issue(path, "invalid_type")]
  if (value === null) return shape.nullable ? [] : [issue(path, "invalid_type")]
  if (shape.type === "text") {
    if (typeof value !== "string") return [issue(path, "invalid_type")]
    const text = value.trim()
    if (shape.min !== undefined && text.length < shape.min) return [issue(path, "too_small")]
    if (shape.max !== undefined && text.length > shape.max) return [issue(path, "too_big")]
    return shape.pattern && !new RegExp(shape.pattern).test(text) ? [issue(path, text ? "invalid_format" : "too_small")] : []
  }
  if (shape.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || (shape.int && !Number.isInteger(value))) return [issue(path, "invalid_type")]
    if ((shape.min !== undefined && value < shape.min) || (shape.above !== undefined && value <= shape.above)) return [issue(path, "too_small")]
    return (shape.max !== undefined && value > shape.max) || (shape.below !== undefined && value >= shape.below) ? [issue(path, "too_big")] : []
  }
  if (shape.type === "choice") return typeof value === "string" && shape.options.includes(value) ? [] : [issue(path, "invalid_value")]
  if (shape.type === "flag") return typeof value === "boolean" ? [] : [issue(path, "invalid_type")]
  if (shape.type === "object") return typeof value === "object" ? Object.entries(shape.fields).flatMap(([key, field]) => checkShape(field, (value as Loose)[key], [...path, key])) : [issue(path, "invalid_type")]
  if (shape.type === "list") {
    if (!Array.isArray(value)) return [issue(path, "invalid_type")]
    if (shape.min !== undefined && value.length < shape.min) return [issue(path, "too_small")]
    if (shape.max !== undefined && value.length > shape.max) return [issue(path, "too_big")]
    return value.flatMap((entry, index) => checkShape(shape.of, entry, [...path, String(index)]))
  }
  return []
}

/**
 * What the schema's shape alone finds wrong with a document, before anything is sent: an empty name, a number
 * out of its range, a thing not picked yet. What only the whole project can tell (a name used twice, a material
 * that is gone) is found by the save itself and comes back in the same form.
 */
export function check(kind: HandKind, document: Loose): HandIssue[] {
  const kept = HAND_KEPT[kind]
  const found = checkShape(HAND_SHAPES[kind], document, []).filter((value) => {
    const key = value.path.join(".")
    // These four controls show vanilla choices. A saved project sound is edited in the creature's sound table.
    if (kind === "entity" && /^sounds\.(ambient|hurt|death|step)$/.test(key) && SoundAssetRefSchema.safeParse(at(document, key)).success) return false
    return !kept.some(path => key === path || key.startsWith(`${path}.`))
  })
  // The one rule of a recipe its shape cannot carry (`RecipeSchema` refines it): nine empty slots make nothing.
  const empty = kind === "recipe" && Array.isArray(document.pattern) && document.pattern.every((slot) => slot === null)
  return empty ? [...found, { path: ["pattern"], code: "custom", message: ISSUE_WORDS.materials }] : found
}

/** Already a sentence for a player: Chinese, and no word a document spells (names in 「」 and the game's own name aside). */
export const isPlain = (message: string) => /[一-鿿]/.test(message) && !/[A-Za-z_]{2,}/.test(message.replace(/「[^」]*」/g, "").replace(/Minecraft|Fabric|PNG/g, ""))

const IDENTIFIER_PATTERN = "^[a-z][a-z0-9_]{0,63}$"

/**
 * One finding in the person's words, and the field to show it beside (`key` is empty when it is about the whole
 * thing). The raw finding follows only with 高级 on.
 */
export function plainIssue(kind: HandKind, found: HandIssue, advanced: boolean): { key: string; label: string; text: string } {
  const key = found.path.join(".")
  const placed = found.elsewhere === undefined && found.path.length ? wordAt(kind, key) : null
  const shape = placed ? shapeAt(kind, placed.key) : undefined
  const control = placed && shape ? controlOf(placed.word, shape) : null
  const rule = ISSUE_RULES.find(([test]) => test.test(found.message))
  const ranged = shape?.type === "number" ? `要填 ${rangeWords(shape)}。` : ""
  const said = () => {
    if (found.elsewhere !== undefined) return ISSUE_WORDS.elsewhere(found.elsewhere)
    if (found.code === "refused") return found.message
    if (rule) return rule[1].replace("$1", found.message.match(rule[0])?.[1] ?? "")
    if (found.message && isPlain(found.message)) return found.message
    // A finding about something inside the field (one slot of the grid) is not the field's own range.
    if (!placed || !shape || placed.key !== key) return found.path.length ? ISSUE_WORDS.other : ISSUE_WORDS.whole_thing
    const picked = control === "thing" || control === "grid"
    if (found.code === "too_small") return shape.type === "number" ? ranged : shape.type === "list" ? ISSUE_WORDS.some : picked ? ISSUE_WORDS.unpicked : ISSUE_WORDS.empty
    if (found.code === "too_big") return shape.type === "number" ? ranged : shape.type === "list" ? `最多 ${shape.max} 样。` : shape.type === "text" ? `最多 ${shape.max} 个字。` : ISSUE_WORDS.other
    if (found.code === "invalid_type") return shape.type === "number" ? (shape.int ? ISSUE_WORDS.whole : ISSUE_WORDS.number) : picked ? ISSUE_WORDS.unpicked : shape.type === "choice" ? ISSUE_WORDS.choice : ISSUE_WORDS.empty
    if (found.code === "invalid_format") return shape.type === "text" && shape.pattern === IDENTIFIER_PATTERN ? ISSUE_WORDS.identifier : picked ? ISSUE_WORDS.unpicked : ISSUE_WORDS.format
    if (found.code === "invalid_value") return ISSUE_WORDS.choice
    return ISSUE_WORDS.other
  }
  const raw = advanced && (found.message || found.code) ? `（${key ? `${key}：` : ""}${found.message || found.code}）` : ""
  return { key: placed?.key ?? "", label: placed?.word.label ?? "", text: `${said()}${raw}` }
}

/**
 * The names of the fields that differ between two documents of a kind, as the form calls them, in the form's
 * order: what the activity line says the person changed. Switching a group on or off is said once, by the group.
 */
export function changedLabels(kind: HandKind, before: Loose, after: Loose): string[] {
  // A group that is there before and after has not changed as a group: its fields say what did.
  const group = (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value)
  const changed = words(kind).filter((word) => !word.path.includes("*") && !same(at(before, word.path), at(after, word.path)) && !(group(at(before, word.path)) && group(at(after, word.path))))
  const switched = changed.filter((word) => at(before, word.path) == null || at(after, word.path) == null).map((word) => word.path)
  const labels = [...new Set(changed.filter((word) => !switched.some((path) => word.path.startsWith(`${path}.`))).map((word) => word.label))]
  if (kind === "entity" && !same(before.abilities, after.abilities)) labels.push("招式中的临时地形")
  if (kind === "book" && !same(before.pages, after.pages)) labels.push("书页")
  return labels
}
