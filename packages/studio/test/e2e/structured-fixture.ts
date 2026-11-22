type Input = { item?: { title?: string; kind?: string } | string; findings?: string[]; part_sheet?: { subject?: string }; task?: { module: string } }
type Body = { text?: { format?: { schema?: { properties?: Record<string, unknown> } } } }

/** Schema-shaped local responses exercise orchestration; these are deterministic fixtures, never AI review evidence. */
export function fixtureReply(body: Body, input: Input, document: () => unknown) {
  const fields = body.text?.format?.schema?.properties ?? {}
  if ("subject" in fields) {
    const name = typeof input.item === "string" ? input.item : input.item?.title ?? "fixture"
    return { subject: name, recognisable: [name], parts: [{ name, what: "Fixture geometry", shape: "Documented fixture structure", attaches: "root", surface: "Fixture pixels and materials", moves: "Documented fixture motions", assumed: true }], assumed: ["Deterministic local HTTP fixture"], still: [], differs: [], justified: [], budget: null }
  }
  if ("keep" in fields) return { keep: true, revised: null }
  if ("matches" in fields) return { matches: ["Fixture matches its document"], problems: input.findings ?? [], advice: [], next: input.findings?.length ? ["Fix fixture findings"] : [], verdict: input.findings?.length ? "revise" : "done", look_closer: null, watch: null, declare: null, see: [] }
  if ("sees" in fields) return { sees: "Fixture pictured material", also: [], because: "Deterministic blind-answer fixture" }
  if ("passed" in fields) return { passed: true, findings: [], advice: [], need: [], ...("fits" in fields ? { fits: "with_name" } : {}) }
  const made = document()
  return "document" in fields && "script" in fields ? { document: made, script: null } : made
}
