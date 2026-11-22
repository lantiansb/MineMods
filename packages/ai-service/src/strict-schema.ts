/**
 * Structured output with `strict: true` (OpenAI, DeepSeek and the services that copy them) only takes object schemas that list every property in
 * `required` and close the object with `additionalProperties: false`; a field that may be left out is written as one that may be null instead.
 * Studio's schemas come from Zod, where optional means "may be absent", so the same schema is rewritten once into that strict form for the wire,
 * and the nulls it invites are taken back out of the answer before the caller's own Zod check sees it (broad22-api-r2: DeepSeek answered every
 * blueprint request with HTTP 400 "Required properties must match all properties in the object").
 *
 * Only what strict mode demands is changed: required lists, the closing of objects that name their properties, null for the fields that were
 * optional, and fixed-length tuples (`prefixItems`, which strict mode has no word for: r3 "field `anyOf`: missing field `items`") written as an
 * array of exactly that many items, each one of the tuple's kinds; the caller's Zod check still holds each position to its own kind.
 * A map (an object whose keys are free, `additionalProperties: {schema}`; strict mode only takes `false` there, r5: DeepSeek "invalid type: map,
 * expected a boolean" on a language table) goes out as a list of {key, value} entries and is turned back into the map when the answer arrives.
 * Everything else (lengths, enums, $defs) is passed as it was; a service that refuses one of those says so and the dialect ladder steps down.
 */

type Schema = Record<string, unknown>

const isSchema = (value: unknown): value is Schema => typeof value === "object" && value !== null && !Array.isArray(value)

/** Local references only ("#/$defs/x", "#/definitions/x"); anything else is left unresolved. */
function resolve(schema: Schema, root: Schema, depth = 0): Schema {
  const ref = schema.$ref
  if (typeof ref !== "string" || !ref.startsWith("#/") || depth > 32) return schema
  const target = ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>((node, part) => (isSchema(node) ? node[part] : undefined), root)
  return isSchema(target) ? resolve(target, root, depth + 1) : schema
}

/** Whether a schema already lets null through, so the field needs no extra branch and a null in the answer is the caller's to keep. */
function acceptsNull(schema: Schema, root: Schema, depth = 0): boolean {
  if (depth > 32) return false
  const own = resolve(schema, root)
  const type = own.type
  if (type === "null" || (Array.isArray(type) && type.includes("null"))) return true
  if ("const" in own && own.const === null) return true
  if (Array.isArray(own.enum) && own.enum.includes(null)) return true
  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = own[key]
    if (Array.isArray(branches) && branches.some((branch) => isSchema(branch) && acceptsNull(branch, root, depth + 1))) return true
  }
  return false
}

/** An object whose keys are free and whose values share one schema. */
const isMap = (schema: Schema) => isSchema(schema.additionalProperties) && !(isSchema(schema.properties) && Object.keys(schema.properties).length)

const isEntries = (value: unknown): value is { key: string; value: unknown }[] =>
  Array.isArray(value) && value.every((entry) => isSchema(entry) && typeof entry.key === "string" && "value" in entry)

const describesObject = (schema: Schema) => schema.type === "object" || (Array.isArray(schema.type) && schema.type.includes("object")) || isSchema(schema.properties)

function rewrite(node: unknown, root: Schema): unknown {
  if (Array.isArray(node)) return node.map((item) => rewrite(item, root))
  if (!isSchema(node)) return node
  if (isMap(node)) {
    const { additionalProperties, propertyNames, properties: _none, required: _required, type: _type, ...rest } = node
    const key = isSchema(propertyNames) ? { type: "string", ...(rewrite(propertyNames, root) as Schema) } : { type: "string" }
    const entry = { type: "object", properties: { key, value: rewrite(additionalProperties, root) }, required: ["key", "value"], additionalProperties: false }
    return { ...(rewrite(rest, root) as Schema), type: "array", items: entry }
  }
  const out: Schema = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" && isSchema(value)) out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, rewrite(child, root)]))
    else if (key === "enum" || key === "const" || key === "required") out[key] = value
    else out[key] = rewrite(value, root)
  }
  if (Array.isArray(out.anyOf)) Object.assign(out, flatAnyOf(out))
  if (Array.isArray(out.prefixItems) && !("items" in node)) {
    const kinds = out.prefixItems.filter((kind, index, all) => all.findIndex((other) => JSON.stringify(other) === JSON.stringify(kind)) === index)
    const length = out.prefixItems.length
    delete out.prefixItems
    if (kinds.length) out.items = kinds.length === 1 ? kinds[0] : { anyOf: kinds }
    if (!("minItems" in out)) out.minItems = length
    if (!("maxItems" in out)) out.maxItems = length
  }
  if (isSchema(out.properties)) {
    const listed = new Set(Array.isArray(node.required) ? node.required.filter((name): name is string => typeof name === "string") : [])
    const properties = out.properties
    for (const name of Object.keys(properties)) {
      const child = properties[name]
      if (listed.has(name) || !isSchema(child) || acceptsNull(child, root)) continue
      properties[name] = flatAnyOf({ anyOf: [child, { type: "null" }] })
    }
    out.required = Object.keys(properties)
    if (describesObject(node) && !("additionalProperties" in node)) out.additionalProperties = false
  }
  return out
}

/** Words that only describe a schema; a choice carrying nothing else is just its branches. */
const ANNOTATIONS = new Set(["anyOf", "description", "title"])

/**
 * A choice whose branch is itself a bare choice lists that branch's own branches instead (r4: DeepSeek "field `anyOf`: field `anyOf`: missing field
 * `type`", an optional union wrapped once more for null). The set of values allowed is the same; only the nesting goes.
 */
function flatAnyOf(schema: Schema): Schema {
  const branches = (schema.anyOf as unknown[]).flatMap((branch) =>
    isSchema(branch) && Array.isArray(branch.anyOf) && Object.keys(branch).every((key) => ANNOTATIONS.has(key)) ? (flatAnyOf(branch).anyOf as unknown[]) : [branch],
  )
  const unique = branches.filter((branch, index) => branches.findIndex((other) => JSON.stringify(other) === JSON.stringify(branch)) === index)
  const description = (schema.anyOf as unknown[]).map((branch) => (isSchema(branch) && Array.isArray(branch.anyOf) && typeof branch.description === "string" ? branch.description : undefined)).find(Boolean)
  return { ...(description && !("description" in schema) ? { description } : {}), ...schema, anyOf: unique }
}

const rewritten = new WeakMap<object, unknown>()

/** The schema as strict structured output takes it. Computed once per schema object. */
export function strictSchema(schema: unknown): unknown {
  if (!isSchema(schema)) return schema
  const known = rewritten.get(schema)
  if (known !== undefined) return known
  const result = rewrite(schema, schema)
  rewritten.set(schema, result)
  return result
}

/**
 * Turns an answer to the strict schema back into the original shape: a null on a property the original schema neither required nor allowed to be
 * null is taken to mean "left out", and a list of {key, value} entries where the original has a map becomes that map. Walks the answer along the
 * original schema; nothing else in the answer is touched, and an answer already in the original shape passes through.
 */
export function fromStrict(value: unknown, schema: unknown): unknown {
  if (!isSchema(schema)) return value
  const root = schema
  const walk = (node: unknown, raw: Schema, depth: number): unknown => {
    if (depth > 64) return node
    const own = resolve(raw, root)
    for (const key of ["anyOf", "oneOf", "allOf"] as const) {
      const branches = own[key]
      if (!Array.isArray(branches)) continue
      // The branch that describes this kind of value; for objects, the first that names properties the value carries.
      const fit = branches.filter(isSchema).find((branch) => {
        const target = resolve(branch, root)
        if (isEntries(node) && isMap(target)) return true
        if (Array.isArray(node)) return target.type === "array" || "items" in target
        if (isSchema(node)) return describesObject(target) && (!isSchema(target.properties) || Object.keys(node).some((name) => name in (target.properties as Schema)))
        return false
      })
      if (fit) node = walk(node, fit, depth + 1)
    }
    if (isMap(own) && (isEntries(node) || isSchema(node))) {
      const pairs = isEntries(node) ? node.map((entry) => [entry.key, entry.value] as const) : Object.entries(node)
      return Object.fromEntries(pairs.map(([key, child]) => [key, walk(child, own.additionalProperties as Schema, depth + 1)]))
    }
    if (Array.isArray(node) && Array.isArray(own.prefixItems)) return node.map((item, index) => (isSchema((own.prefixItems as unknown[])[index]) ? walk(item, (own.prefixItems as Schema[])[index], depth + 1) : item))
    if (Array.isArray(node) && isSchema(own.items)) return node.map((item) => walk(item, own.items as Schema, depth + 1))
    if (!isSchema(node) || !isSchema(own.properties)) return node
    const listed = new Set(Array.isArray(own.required) ? own.required : [])
    const properties = own.properties
    const out: Schema = {}
    for (const [name, child] of Object.entries(node)) {
      const described = properties[name]
      if (!isSchema(described)) {
        out[name] = child
        continue
      }
      if (child === null && !listed.has(name) && !acceptsNull(described, root)) continue
      out[name] = walk(child, described, depth + 1)
    }
    return out
  }
  return walk(value, schema, 0)
}
