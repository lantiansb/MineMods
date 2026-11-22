import { expect, test } from "bun:test"
import { MakingRecordSchema } from "../src/making"
import { buildReceipt, CAUGHT_HOW, oneLine, RECEIPT_LIMITS, RECEIPT_WORDS, type ReceiptEvent, type ReceiptInput, type ReceiptItem, type ReceiptMaking } from "../src/receipt"

const asset = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
const version = (name: string) => name.repeat(64).slice(0, 64).replace(/[^a-f0-9]/g, "a")

const item = (n: number, patch: Partial<ReceiptItem> = {}): ReceiptItem => ({
  id: `thing${n}`,
  key: `thing${n}`,
  asset_id: asset(n),
  kind: "item",
  title: ["", "蜂蜡", "蜂巢", "海鸥"][n] ?? `东西${n}`,
  status: "saved",
  status_label: "做好了",
  reason: null,
  facts: { saved: true, gametest: null },
  runtime: true,
  ...patch,
})

const making = (n: number, rounds: { findings?: string[] }[], patch: Partial<ReceiptMaking> = {}): ReceiptMaking => ({
  asset_id: asset(n),
  entry: `thing${n}`,
  outcome: "passed",
  rounds: rounds.map((round, index) => ({ round: index + 1, at: `2026-10-14T10:0${index}:00.000Z`, fingerprint: version(String(index + 1)), findings: round.findings ?? [] })),
  review: { independent: true, passed: true, findings: [], at: "2026-10-14T11:00:00.000Z", fingerprint: version(String(rounds.length)) },
  best: { round: rounds.length },
  ...patch,
})

const event = (seq: number, patch: Partial<ReceiptEvent>): ReceiptEvent => ({ seq, at: `2026-10-14T12:${String(seq).padStart(2, "0")}:00.000Z`, kind: "task", mark: "note", item: "thing1", title: "蜂蜡", text: "x", ...patch })

const input = (patch: Partial<ReceiptInput> = {}): ReceiptInput => ({ items: [item(1), item(2)], makings: [], gameplays: [], events: [], scene: null, ...patch })

const EYES = "认得出：头上看不出脸：head 的正面没有一对看得清的眼睛。眼睛的颜色要和周围对比明显。在头部正面的方块上加 features: eyes。"
const COPY = "不凑数：这些方块和别的方块位置、大小完全一样，是重复的：wing_right.wing_right_cover。每样只留一个。"

test("an empty project has nothing to report and invents nothing", () => {
  const receipt = buildReceipt({ items: [], makings: [], gameplays: [], events: [], scene: null })
  expect(receipt.things).toEqual([])
  expect(receipt.made).toEqual({ rounds: 0, things: 0, firstTry: 0, most: null })
  expect(receipt.caught).toEqual([])
  expect(receipt.caught_total).toBe(0)
  expect(receipt.reviewed).toEqual({ passed: 0, total: 0, refusals: 0, blind: [] })
  expect(receipt.game).toBeNull()
  expect(receipt.checked).toEqual({ total: 0, passed: 0, failed: 0 })
  expect(receipt.unverified).toEqual([])
})

test("things are the overview's items except the ones that will not be made", () => {
  const receipt = buildReceipt(input({ items: [item(1), item(2, { status: "out_of_scope", facts: { saved: false, gametest: null } }), item(3, { status: "failed", status_label: "没做成", facts: { saved: false, gametest: null } })] }))
  expect(receipt.things.map((value) => [value.id, value.saved, value.kind_label])).toEqual([
    ["thing1", true, expect.any(String)],
    ["thing3", false, expect.any(String)],
  ])
})

test("rounds, first tries and the thing that took the most", () => {
  const receipt = buildReceipt(
    input({
      items: [item(1), item(2), item(3)],
      makings: [making(1, [{}]), making(2, [{ findings: [EYES] }, { findings: [EYES] }, {}]), making(3, [{}, {}], { review: null, outcome: undefined })],
    }),
  )
  expect(receipt.made).toEqual({ rounds: 6, things: 3, firstTry: 1, most: { item: "thing2", title: "蜂巢", rounds: 3 } })
})

test("a fault the standard measured and a later version no longer has is caught and fixed; one still there is not", () => {
  const receipt = buildReceipt(
    input({
      items: [item(3, { kind: "model" })],
      makings: [making(3, [{ findings: [EYES, COPY] }, { findings: [EYES] }, { findings: [EYES] }, {}])],
    }),
  )
  const eyes = receipt.caught.find((value) => value.why.startsWith("认得出"))!
  const copy = receipt.caught.find((value) => value.why.startsWith("不凑数"))!
  // The eyes were first measured in version 1 and stayed until version 4; it is one catch, not three.
  expect(receipt.caught.filter((value) => value.why.startsWith("认得出"))).toHaveLength(1)
  expect(eyes).toMatchObject({ item: "thing3", title: "海鸥", round: 1, fixed: true, fixed_in: 4, by: "standard", how: CAUGHT_HOW.standard })
  expect(copy).toMatchObject({ round: 1, fixed: true, fixed_in: 2 })
  // One plain line: the first sentence, not the advice after it.
  expect(eyes.why).toBe("认得出：头上看不出脸：head 的正面没有一对看得清的眼睛")

  const open = buildReceipt(input({ items: [item(3)], makings: [making(3, [{ findings: [EYES] }, { findings: [EYES] }], { outcome: "kept_unsatisfied", best: null })] }))
  expect(open.caught).toHaveLength(1)
  expect(open.caught[0]).toMatchObject({ round: 1, fixed: false, fixed_in: null })

  // Not clean in the last version looked at, but a clean version came after it and was kept.
  const kept = buildReceipt(input({ items: [item(3)], makings: [making(3, [{}, { findings: [EYES] }], { best: { round: 3 } })] }))
  expect(kept.caught[0]).toMatchObject({ round: 2, fixed: true, fixed_in: 3 })
})

test("the same fault with different names in it is one fault across versions", () => {
  const first = "不凑数：一两格大的碎块太多（5 个：head.beak_point、head.eye_left）。画在表面。"
  const second = "不凑数：一两格大的碎块太多（3 个：head.beak_point）。画在表面。"
  const receipt = buildReceipt(input({ items: [item(3)], makings: [making(3, [{ findings: [first] }, { findings: [second] }, {}])] }))
  expect(receipt.caught).toHaveLength(1)
  expect(receipt.caught[0]).toMatchObject({ round: 1, fixed: true, fixed_in: 3 })
})

test("what the other AI refused and what was sent back at the save door are read from the log, with the version", () => {
  const events: ReceiptEvent[] = [
    event(1, { kind: "review", mark: "fail", round: 1, lines: ["认得出：盲认没有认出来——只给图的时候，评审说它是「像一颗烤土豆」，要做的是「蜂蜡」；告诉它名字以后还是看不出。"] }),
    event(2, { kind: "tool", mark: "fail", tool: "self_review", lines: ["有动作还没有看过，不能直接说做完：「attack」这个动作没有连起来看过。"] }),
    // How the call was made, not the work: never a catch.
    event(3, { kind: "tool", mark: "fail", tool: "self_review", lines: ["AI 发来的这一次调用，Studio 读不懂（内容的格式不对）。"] }),
    event(4, { kind: "tool", mark: "fail", tool: "look", lines: ["这一类内容没有可以看的样子，不需要看图。"] }),
    event(5, { kind: "task", mark: "fail", lines: ["规格：交上来的文件缺少必填部分。"], item: "thing2", title: "蜂巢" }),
    event(6, { kind: "task", mark: "fail", end: true, lines: ["这一样没做成。"], item: "thing2", title: "蜂巢" }),
    event(7, { kind: "tool", mark: "fail", tool: "commit_task", lines: ["还没有独立验收。先去验收。"] }),
    event(8, { kind: "tool", mark: "fail", tool: "final_review", lines: ["验收说通过，findings 里却列着问题。"] }),
    event(9, { kind: "review", mark: "ok", item: "thing1" }),
  ]
  const receipt = buildReceipt(input({ makings: [making(1, [{}, {}])], events }))
  expect(receipt.caught.map((value) => [value.by, value.item, value.round, value.fixed])).toEqual([
    // newest first: the save-door refusal of 蜂巢 (not mended), then 蜂蜡's refused finish and the other AI's no
    ["save", "thing2", null, false],
    ["save", "thing1", 2, true],
    ["review", "thing1", 1, true],
  ])
  expect(receipt.caught[1]!.why).toBe("「attack」这个动作没有连起来看过")
  expect(receipt.caught.every((value) => value.how === CAUGHT_HOW[value.by])).toBe(true)
  expect(receipt.reviewed.refusals).toBe(1)
})

test("a refusal that only repeats a fault already counted from the rounds is not counted twice", () => {
  const events = [event(1, { kind: "tool", mark: "fail", tool: "self_review", item: "thing3", title: "海鸥", lines: [`验收标准在这一版上还查出了毛病，不能说做完：${EYES}`] })]
  const receipt = buildReceipt(input({ items: [item(3)], makings: [making(3, [{ findings: [EYES] }, {}])], events }))
  expect(receipt.caught).toHaveLength(1)
  expect(receipt.caught[0]!.by).toBe("standard")
})

test("a refused code check is caught, and fixed by a later version that passed", () => {
  const finding = { rule: "network", file: "A.java", line: 3, message: "用了不允许的类 java.net.Socket。", fix: "换成允许的写法。" }
  const check = (findings: (typeof finding)[]) => ({ bounds: findings, references: [], compile: null })
  const gameplay = {
    asset_id: asset(2),
    entry: "thing2",
    outcome: "passed" as const,
    rounds: [
      { round: 1, at: "2026-10-14T10:00:00.000Z", passed: false, check: check([finding, { ...finding, line: 9 }]) },
      { round: 2, at: "2026-10-14T10:05:00.000Z", passed: true, check: check([]) },
    ],
    review: { independent: true, passed: true, findings: [], at: "2026-10-14T10:10:00.000Z" },
  }
  const receipt = buildReceipt(input({ gameplays: [gameplay] }))
  expect(receipt.caught).toHaveLength(1)
  expect(receipt.caught[0]).toMatchObject({ item: "thing2", round: 1, by: "code", fixed: true, fixed_in: 2 })
  // The person reads the rule's own sentence; the file, the line and the class stay in the record.
  expect(receipt.caught[0]!.why).toBe("代码越界了：代码想连接网络，玩法不能联网（一共 2 处）")
  expect(receipt.caught[0]!.why).not.toMatch(/A\.java|Socket/)
  expect(receipt.made).toMatchObject({ rounds: 2, things: 1 })
  expect(receipt.reviewed).toMatchObject({ passed: 1, total: 1 })
})

test("only the other AI's verdicts count as reviewed, and the blind answers are listed as said", () => {
  const blind = (patch: object) => ({ said: "卷起来的纸", recognised: true, named: "蜂蜡", ...patch })
  const receipt = buildReceipt(
    input({
      items: [item(1), item(2), item(3)],
      makings: [
        making(1, [{}], { review: { independent: true, passed: true, findings: [], at: "2026-10-14T11:00:00.000Z", blind: blind({ fits: "with_name" }) } }),
        making(2, [{}], { review: { independent: true, passed: false, findings: ["认得出：x"], at: "2026-10-14T11:00:00.000Z", blind: blind({ said: "烤土豆", recognised: false, fits: "no", named: "蜂巢" }) } }),
        making(3, [{}], { review: { independent: false, passed: true, findings: [], at: "2026-10-14T11:00:00.000Z" } }),
      ],
    }),
  )
  expect(receipt.reviewed.passed).toBe(1)
  expect(receipt.reviewed.total).toBe(2)
  expect(receipt.reviewed.blind).toEqual([
    { item: "thing1", title: "蜂蜡", said: "卷起来的纸", named: "蜂蜡", recognised: true },
    { item: "thing2", title: "蜂巢", said: "烤土豆", named: "蜂巢", recognised: false },
  ])
})

test("a record from before the three verdicts reads its yes or no", () => {
  const receipt = buildReceipt(input({ makings: [making(1, [{}], { review: { independent: true, passed: true, findings: [], at: "2026-10-14T11:00:00.000Z", blind: { said: "贝壳", recognised: false, named: "贝壳" } } })] }))
  expect(receipt.reviewed.blind[0]!.recognised).toBe(false)
})

test("the game check says what was set out, what was waited on, and how many problems", () => {
  const thing = (kind: "creature" | "block" | "item", placed: boolean, there?: boolean | null) => ({ kind, id: `m:${kind}`, title: kind, placed, said: [], ...(there === undefined ? {} : { there }) })
  const report = { started: true, things: [thing("creature", true, true), thing("creature", true, false), thing("block", true), thing("item", false)], findings: ["a", "b"] }
  const receipt = buildReceipt(input({ scene: { record: { checked_at: "2026-10-14T13:00:00.000Z", report }, current: false } }))
  expect(receipt.game).toEqual({ checked_at: "2026-10-14T13:00:00.000Z", started: true, total: 4, placed: 3, waited: 2, present: 1, problems: 2, current: false })
  // A deployed scene that was never checked says nothing.
  expect(buildReceipt(input({ scene: { record: {}, current: true } })).game).toBeNull()
  expect(buildReceipt(input({ scene: { record: null, current: true } })).game).toBeNull()
})

test("what is not verified: kept unsatisfied, never reviewed by another AI, not seen in the game", () => {
  const receipt = buildReceipt(
    input({
      items: [item(1, { facts: { saved: true, gametest: true } }), item(2, { ai_unsatisfied: true }), item(3, { facts: { saved: true, gametest: false } }), item(4, { kind: "texture", runtime: false }), item(5, { status: "planned", facts: { saved: false, gametest: null } })],
      makings: [
        making(1, [{}]),
        making(2, [{}], { outcome: "kept_unsatisfied", kept_reason: ["认得出：头上看不出脸。再改一版。"], review: null }),
        making(4, [{}], { review: { independent: false, passed: true, findings: [], at: "2026-10-14T11:00:00.000Z" } }),
      ],
    }),
  )
  expect(receipt.unverified.map((value) => value.id)).toEqual(["thing2", "thing3", "thing4"])
  expect(receipt.checked).toEqual({ total: 3, passed: 1, failed: 1 })
  expect(receipt.unverified[0]!.why).toBe(`AI 还不满意：认得出：头上看不出脸；${RECEIPT_WORDS.no_review}；${RECEIPT_WORDS.game_unchecked}。`)
  expect(receipt.unverified[1]!.why).toBe(`${RECEIPT_WORDS.game_failed}。`)
  // A design-only kind cannot be set out in the game, so that is not a gap.
  expect(receipt.unverified[2]!.why).toBe(`${RECEIPT_WORDS.self_reviewed}。`)
})

test("a version cut short is said as that, not as the AI being unsatisfied", () => {
  const receipt = buildReceipt(input({ items: [item(1, { ai_interrupted: true })], makings: [making(1, [{}], { outcome: "kept_interrupted", review: null })] }))
  expect(receipt.unverified[0]!.why).not.toContain("不满意")
  expect(receipt.unverified[0]!.why).toContain("制作被中断了")
})

test("the list of what was caught is newest first and cut, with the real count kept", () => {
  const events = Array.from({ length: 40 }, (_, index) => event(index + 1, { kind: "review", mark: "fail", round: 1, lines: [`认得出：第 ${index} 种毛病。`] }))
  const receipt = buildReceipt(input({ events }))
  expect(receipt.caught).toHaveLength(RECEIPT_LIMITS.caught)
  expect(receipt.caught_total).toBe(40)
  expect(receipt.caught[0]!.why).toBe("认得出：第 39 种毛病")
})

test("records of things that no longer exist are left out, and a real making record reads the same as the fixture", () => {
  const record = MakingRecordSchema.parse({
    schema_version: 1,
    asset_id: asset(1),
    entry: "thing1",
    kind: "item",
    request: "一块蜂蜡",
    brief: "蜂蜡",
    task_id: "11111111-1111-4111-8111-111111111111",
    sheet: null,
    described: true,
    remark: null,
    rounds: [
      { round: 1, at: "2026-10-14T10:00:00.000Z", fingerprint: version("1"), pictures: [], self_review: null, findings: [EYES] },
      { round: 2, at: "2026-10-14T10:05:00.000Z", fingerprint: version("2"), pictures: [], self_review: null, findings: [] },
    ],
    review: { independent: true, passed: true, findings: [], advice: [], at: "2026-10-14T10:10:00.000Z", fingerprint: version("2") },
    best: { round: 2, fingerprint: version("2") },
    outcome: "passed",
    state: "done",
    rounds_allowed: 8,
    updated_at: "2026-10-14T10:10:00.000Z",
  })
  const receipt = buildReceipt(input({ items: [item(1)], makings: [record, { ...record, asset_id: asset(9), entry: "gone" }] }))
  expect(receipt.made).toMatchObject({ rounds: 2, things: 1 })
  expect(receipt.caught).toHaveLength(1)
  expect(receipt.caught[0]).toMatchObject({ round: 1, fixed: true, fixed_in: 2 })
})

test("oneLine keeps the first sentence and cuts what is too long", () => {
  expect(oneLine("先说这个。再说那个。")).toBe("先说这个")
  expect(oneLine("长".repeat(200)).length).toBe(RECEIPT_LIMITS.why)
  expect(oneLine("长".repeat(200)).endsWith("…")).toBe(true)
  // A bracket left open by the cut goes with it, and so does the comma before it.
  expect(oneLine(`不凑数：碎块太多（5 个：${"a".repeat(100)}）`)).toBe("不凑数：碎块太多…")
  // The point of a long finding can come after a semicolon.
  expect(oneLine("图标呈黄色，能看出蜂类主题；但是第一眼没有认出蜂蜡。")).toBe("图标呈黄色，能看出蜂类主题；但是第一眼没有认出蜂蜡")
})

test("the reason an AI was not satisfied is the first one a person can read: a line that is mostly code is not the one told in the receipt", () => {
  const note = "第九轮合法模型已通过脚本 schema和compileModel，但MCP look连续返回操作未完成；复现 TypeError at model-look.ts colorDistance/marks。"
  const receipt = buildReceipt(input({ items: [item(1, { ai_unsatisfied: true })], makings: [making(1, [{}], { outcome: "kept_unsatisfied", kept_reason: [note, "头上看不出脸。"], review: null })] }))
  expect(receipt.unverified[0]!.why).toContain("头上看不出脸")
  expect(receipt.unverified[0]!.why).not.toMatch(/compileModel|TypeError|model-look/)
  // Only code to show: the receipt says nothing about the reason rather than quote it.
  const only = buildReceipt(input({ items: [item(1, { ai_unsatisfied: true })], makings: [making(1, [{}], { outcome: "kept_unsatisfied", kept_reason: [note], review: null })] }))
  expect(only.unverified[0]!.why).not.toMatch(/compileModel|TypeError|model-look/)
})
