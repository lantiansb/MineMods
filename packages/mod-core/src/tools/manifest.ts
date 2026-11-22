import { z } from "zod"

/**
 * A tool Studio runs for an outside AI (工具资产): one folder under the runtime's `tools/`, described by its `tool.json`. Studio decides which tools exist and how each is
 * called; an outside AI only lists the ones the person has turned on and asks Studio to run one with its parameters (`run_tool`). A tool makes something (`generate`: a
 * sound, a picture), turns one thing into another (`convert`: any audio into the game's mono OGG) or looks at something and says what it found (`check`: a video).
 *
 * How it is run (`runner`):
 * - `command`: a program in the tool's own folder (or one Studio downloaded, `store:<id>`), with its arguments written as a list — never one shell line — in which
 *   `{input.<name>}`, `{in}` (a file handed to it), `{out}` (the folder it writes into) and `{tool}` (its own folder) are filled in.
 * - `http`: a web service; the body is JSON in which the same `{input.<name>}` are filled in, and `{secret:<NAME>}` is a key the person saved in Studio (never shown to an AI).
 * - `mcp`: a tool of an MCP server Studio starts (or reaches at an address), called with arguments written the same way.
 * - `builtin`: one of Studio's own (`BUILTIN_TOOLS`).
 */

export const TOOLS_FOLDER = "tools"
export const TOOL_FILE = "tool.json"

export const TOOL_ROLES = { generate: "生成", convert: "转换", check: "检查" } as const
export const TOOL_MEDIA = { sound: "声音", image: "图片", video: "视频" } as const
export type ToolRole = keyof typeof TOOL_ROLES
export type ToolMedium = keyof typeof TOOL_MEDIA

/** Studio's own tools: they need no program, address or key of their own. */
export const BUILTIN_TOOLS = ["sound-synth", "delegate-sound", "delegate-image", "scene-record", "video-frames"] as const
export type BuiltinTool = (typeof BUILTIN_TOOLS)[number]

/** The widest a tool may be: how long one run may take, how big what it hands back may be, how many parameters it takes. */
export const TOOL_LIMITS = { seconds: { min: 1, max: 1800 }, bytes: { min: 1024, max: 64 * 1024 * 1024 }, inputs: 24, args: 64, text: 4000 } as const

const Name = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "参数名用小写字母开头，只含小写字母、数字和下划线")

/** One parameter an outside AI fills in: a small part of JSON Schema, enough to say and check what is allowed. */
const ToolParameterSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("string"), description: z.string().min(1).max(400), enum: z.array(z.string().min(1).max(200)).min(1).max(64).optional(), maxLength: z.int().min(1).max(TOOL_LIMITS.text).optional() }),
  z.strictObject({ type: z.literal("number"), description: z.string().min(1).max(400), minimum: z.number().finite().optional(), maximum: z.number().finite().optional() }),
  z.strictObject({ type: z.literal("integer"), description: z.string().min(1).max(400), minimum: z.int().optional(), maximum: z.int().optional() }),
  z.strictObject({ type: z.literal("boolean"), description: z.string().min(1).max(400) }),
])
export type ToolParameter = z.infer<typeof ToolParameterSchema>

export const ToolInputSchema = z.strictObject({
  type: z.literal("object"),
  properties: z.record(Name, ToolParameterSchema).refine((value) => Object.keys(value).length <= TOOL_LIMITS.inputs, `一个工具最多 ${TOOL_LIMITS.inputs} 个参数`),
  required: z.array(Name).max(TOOL_LIMITS.inputs).default([]),
})
export type ToolInput = z.infer<typeof ToolInputSchema>

/** A value a template may hold: text with `{…}` in it, or (in a JSON body) any JSON. */
const Template = z.string().min(1).max(2000)
const Json: z.ZodType<unknown> = z.lazy(() => z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.array(Json).max(64), z.record(z.string(), Json)]))

/** Where in a JSON answer what it made is: a path of keys and list places (`data.0.b64_json`), and how it is written there. */
const AnswerSchema = z.strictObject({
  /** `binary`: the whole answer is the file; `base64`: the value at `path` is the file in base64 (a data URL is read too); `url`: the value at `path` is an address the file is fetched from. */
  kind: z.enum(["binary", "base64", "url"]),
  path: z.string().max(200).optional(),
})

const CommandRunnerSchema = z.strictObject({
  type: z.literal("command"),
  /** The program: a path inside the tool's folder (`bin/x.exe`), or `store:<id>` for a program Studio downloaded (`store:ffmpeg`). Never an absolute path elsewhere. */
  program: z.string().regex(/^(store:[a-z0-9-]{1,40}|(?!\/|[A-Za-z]:|\.\.)[A-Za-z0-9_./-]{1,200})$/, "程序写工具文件夹里的相对路径，或者 store:名字（Studio 下载的程序），不能写别处的绝对路径"),
  args: z.array(Template).max(TOOL_LIMITS.args),
  /** The file it writes, inside `{out}`: what Studio takes from it. A check writes its findings as JSON there. */
  result: z.string().regex(/^(?!\/|[A-Za-z]:|\.\.)[A-Za-z0-9_.-]{1,80}$/, "结果写 {out} 文件夹里的一个文件名"),
})

const HttpRunnerSchema = z.strictObject({
  type: z.literal("http"),
  url: z.string().url().refine((url) => /^https:\/\//.test(url) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url), "网络服务只能是 https 地址（或本机的 http://127.0.0.1）"),
  method: z.enum(["POST", "GET"]),
  headers: z.record(z.string().regex(/^[A-Za-z0-9-]{1,60}$/), Template).default({}),
  body: Json.optional(),
  answer: AnswerSchema,
})

const McpRunnerSchema = z.strictObject({
  type: z.literal("mcp"),
  /** The server: a program Studio starts (the same rules as `command`'s), or an https address. */
  server: z.union([z.strictObject({ program: CommandRunnerSchema.shape.program, args: z.array(Template).max(TOOL_LIMITS.args) }), z.strictObject({ url: z.string().url().refine((url) => url.startsWith("https://") || /^http:\/\/(127\.0\.0\.1|localhost)/.test(url), "MCP 服务地址只能是 https（或本机）") })]),
  tool: z.string().min(1).max(80),
  arguments: Json,
  /** What it answers with: a file in its content (audio or image) or base64 at a path of its structured answer. */
  answer: z.strictObject({ kind: z.enum(["content", "base64"]), path: z.string().max(200).optional() }),
})

const BuiltinRunnerSchema = z.strictObject({ type: z.literal("builtin"), name: z.enum(BUILTIN_TOOLS) })

export const ToolRunnerSchema = z.discriminatedUnion("type", [CommandRunnerSchema, HttpRunnerSchema, McpRunnerSchema, BuiltinRunnerSchema])
export type ToolRunner = z.infer<typeof ToolRunnerSchema>

export const ToolManifestSchema = z
  .strictObject({
    schema_version: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, "工具的 id 用小写字母开头，只含小写字母、数字和短横线"),
    version: z.string().min(1).max(40),
    title: z.string().min(1).max(60),
    /** What it is for, said to the person and to an outside AI: when to use it and what it gives back. */
    description: z.string().min(1).max(1200),
    role: z.enum(Object.keys(TOOL_ROLES) as [ToolRole, ...ToolRole[]]),
    /** What it makes, turns into, or looks at. */
    medium: z.enum(Object.keys(TOOL_MEDIA) as [ToolMedium, ...ToolMedium[]]),
    input: ToolInputSchema,
    runner: ToolRunnerSchema,
    limits: z.strictObject({ seconds: z.int().min(TOOL_LIMITS.seconds.min).max(TOOL_LIMITS.seconds.max), bytes: z.int().min(TOOL_LIMITS.bytes.min).max(TOOL_LIMITS.bytes.max) }),
    /** Where it came from and under what terms, for the person (a model's license, a service's terms). */
    source: z.string().max(400).optional(),
  })
  .superRefine((tool, context) => {
    for (const name of tool.input.required) if (!(name in tool.input.properties)) context.addIssue({ code: "custom", path: ["input", "required"], message: `必填参数「${name}」没有在 properties 里写` })
    for (const name of templateNames(tool.runner, "input")) if (!(name in tool.input.properties)) context.addIssue({ code: "custom", path: ["runner"], message: `调用里用了参数 {input.${name}}，可是 input 里没有这个参数` })
    if (tool.role === "check" && tool.runner.type === "builtin" && tool.runner.name !== "video-frames") context.addIssue({ code: "custom", path: ["runner"], message: "检查类的内置工具只有 video-frames" })
  })
export type ToolManifest = z.infer<typeof ToolManifestSchema>

/** `{input.<name>}` (a parameter) or `{secret:<NAME>}` (a saved key). */
const PLACE = /\{(?:input\.([a-z][a-z0-9_]{0,39})|secret:([A-Za-z_][A-Za-z0-9_]{0,59}))\}/g
const WHOLE = /^\{(?:input\.([a-z][a-z0-9_]{0,39})|secret:([A-Za-z_][A-Za-z0-9_]{0,59}))\}$/
/** Which sort a match of `PLACE` is, and its name. */
const sortOf = (input: string | undefined, secret: string | undefined): ["input" | "secret", string] => (input !== undefined ? ["input", input] : ["secret", secret!])

/** Every name a runner's templates use of one sort (`input` parameters, `secret` keys). */
export function templateNames(runner: ToolRunner, sort: "input" | "secret"): string[] {
  const found = new Set<string>()
  const walk = (value: unknown) => {
    if (typeof value === "string")
      for (const match of value.matchAll(PLACE)) {
        const [which, name] = sortOf(match[1], match[2])
        if (which === sort) found.add(name)
      }
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === "object") Object.values(value).forEach(walk)
  }
  walk(runner)
  return [...found]
}

/** The keys a tool needs the person to have saved in Studio. */
export const toolSecrets = (tool: ToolManifest) => templateNames(tool.runner, "secret")

/**
 * Fills a template in. `{input.x}` standing alone takes the parameter's own value (a number stays a number in a JSON body); in longer text it is written as text.
 * `{secret:NAME}` takes a saved key; `{in}`, `{out}`, `{tool}` take paths. A name that is not given is an error, never left as it is.
 */
export function fillTemplate(value: unknown, given: { input: Record<string, unknown>; secrets?: Record<string, string>; paths?: Record<"in" | "out" | "tool", string | undefined> }): unknown {
  if (Array.isArray(value)) return value.map((item) => fillTemplate(item, given))
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillTemplate(item, given)]))
  if (typeof value !== "string") return value
  const lookup = (sort: string, name: string): unknown => {
    if (sort === "input") {
      if (!(name in given.input)) throw new Error(`TOOL_INPUT_MISSING:${name}`)
      return given.input[name]
    }
    const secret = given.secrets?.[name]
    if (secret === undefined) throw new Error(`TOOL_SECRET_MISSING:${name}`)
    return secret
  }
  const whole = WHOLE.exec(value)
  if (whole) return lookup(...sortOf(whole[1], whole[2]))
  const withPaths = value.replace(/\{(in|out|tool)\}/g, (all, name: "in" | "out" | "tool") => {
    const place = given.paths?.[name]
    if (place === undefined) throw new Error(`TOOL_PATH_MISSING:${name}`)
    return place
  })
  return withPaths.replace(PLACE, (_all, input: string | undefined, secret: string | undefined) => String(lookup(...sortOf(input, secret))))
}

/** Checks what an outside AI filled in against the tool's parameters: the plain words of each problem, empty when it is right. */
export function toolInputIssues(tool: ToolManifest, input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return ["参数要写成一个对象：{参数名: 值}"]
  const given = input as Record<string, unknown>
  const issues: string[] = []
  for (const name of tool.input.required) if (given[name] === undefined || given[name] === null) issues.push(`缺少必填参数「${name}」`)
  for (const [name, value] of Object.entries(given)) {
    const spec = tool.input.properties[name]
    if (!spec) {
      issues.push(`这个工具没有参数「${name}」`)
      continue
    }
    if (value === undefined || value === null) continue
    if (spec.type === "string") {
      if (typeof value !== "string") issues.push(`「${name}」要写文字`)
      else if (spec.enum && !spec.enum.includes(value)) issues.push(`「${name}」只能是 ${spec.enum.join("、")} 之一`)
      else if (value.length > (spec.maxLength ?? TOOL_LIMITS.text)) issues.push(`「${name}」最多 ${spec.maxLength ?? TOOL_LIMITS.text} 个字`)
    } else if (spec.type === "boolean") {
      if (typeof value !== "boolean") issues.push(`「${name}」要写 true 或 false`)
    } else if (typeof value !== "number" || !Number.isFinite(value) || (spec.type === "integer" && !Number.isInteger(value))) issues.push(`「${name}」要写${spec.type === "integer" ? "整数" : "数字"}`)
    else if ((spec.minimum !== undefined && value < spec.minimum) || (spec.maximum !== undefined && value > spec.maximum)) issues.push(`「${name}」要在 ${spec.minimum ?? "-∞"} 到 ${spec.maximum ?? "∞"} 之间`)
  }
  return issues
}
