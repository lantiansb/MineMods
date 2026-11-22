/**
 * The one acceptance standard. Everything an AI makes — a model, a texture, a cast action, a recipe — is
 * judged by the same few criteria, each a principle a person can say in one breath. A kind of asset only
 * supplies measurements and the rules that read them; what counts as a refusal, how it is worded, what the
 * brief may excuse and how strictly a revision is held are decided here, once, for every kind.
 *
 * It lives in this package because this is the leaf every other package already depends on: the modelling
 * service judges its own output with it, and mod-core registers every asset kind against it. No imports.
 */

// `meaning` says what good work is; `examples` are the usual ways of failing it; `fix` is the way back.
export const CRITERIA = [
  {
    id: "earns_place",
    name: "不凑数",
    // What is looked at or counted, said so a person can tell what a tick stands on (the veteran of broad19 could not tell what 不凑数 or 站得住 measured).
    measures: "数有没有看不见的、重复的、不起作用的东西：埋在里面的方块、位置大小一样的方块、一两格的碎块、一动不动的动作。",
    meaning: "每一样东西都看得见、起作用，没有只为显得多而加的内容。",
    examples: "一模一样的方块叠在一起、同一条细节贴满全身、埋在里面谁也看不见的部件、一两格大的碎块、画了等于没画的细节、名字在但什么都不动的动作。",
    fix: "把看不见的、重复的、不起作用的删掉，宁可少而准。",
  },
  {
    id: "not_mechanical",
    name: "不机械",
    // What is looked at or counted, said so a person can tell what a tick stands on (the veteran of broad19 could not tell what 不凑数 or 站得住 measured).
    measures: "看图案是不是一个花纹铺到底、有没有满屏杂点；看动作是不是匀速来回、各个部位是不是同起同停。",
    meaning: "不是一个花纹铺到底，不是噪点；动作不是匀速的机器人，也不是所有部位踩同一个拍子。",
    examples: "每个面同一种填法、满屏杂点或斜线、匀速来回摆的腿、全是匀速的关键帧、所有部位同起同停、两只手完全对称同步、来回乱抖。",
    fix: "按部位和材质区分画法；动作要有快有慢，各部位错开一两拍。",
  },
  {
    id: "reads",
    name: "认得出",
    // What is looked at or counted, said so a person can tell what a tick stands on (the veteran of broad19 could not tell what 不凑数 or 站得住 measured).
    measures: "看有没有认得出的头和脸、轮廓撑不撑得起来；走路、受伤、出手有没有看得出的动作。",
    meaning: "一眼看得出它是什么、在做什么。",
    examples: "生物找不到头、看不出脸、撑不起轮廓，走路时腿不动或者同手同脚，受伤没有反应，出手软绵绵、看不出打出去了，物品图标糊成一块方砖或者小到看不见。",
    fix: "先把最能说明“它是什么”的那一样做出来：脸、轮廓、那一下动作。",
  },
  {
    id: "hierarchy",
    name: "有主次",
    // What is looked at or counted, said so a person can tell what a tick stands on (the veteran of broad19 could not tell what 不凑数 or 站得住 measured).
    measures: "数用了几种颜色、有没有明暗，量头和腿占多大；看出手前后有没有预备和收势。",
    meaning: "有明有暗、有重点、有先后：主要的突出，次要的配合。",
    examples: "整个只有一两种颜色、大面是一整块纯色、顶面和侧面一样亮、角爪眼睛和身体一个颜色、头小得看不见或者腿占了全身、出手之前没有预备之后没有收势、只有一只手自己在动。",
    fix: "拉开对比：深浅、大小、快慢；给主要动作配上预备、收势和身体的跟随。",
  },
  {
    id: "sound",
    name: "站得住",
    // What is looked at or counted, said so a person can tell what a tick stands on (the veteran of broad19 could not tell what 不凑数 or 站得住 measured).
    measures: "量部件连没连着、脚落没落地、关节放的位置、左右对不对称，以及一瞬间转了多大角度。",
    meaning: "结构和物理上说得通。",
    examples: "部件悬在空中、脚离地或者陷进地里、关节放在一动就甩出去的地方、左右差了一大半、手穿进身体、一瞬间转过大半圈、实心方块上有透明的洞。",
    fix: "把悬空的接上，把脚放回地面，把关节挪到连接处，把穿进去的部位让开。",
  },
  {
    id: "fits",
    name: "配得上",
    // What is looked at or counted, said so a person can tell what a tick stands on (the veteran of broad19 could not tell what 不凑数 or 站得住 measured).
    measures: "拿它和它依赖的那一样东西对一对：贴图和模型一样大不大，动画用的骨骼模型里有没有，数量一格放不放得下。",
    meaning: "属于同一样东西的各部分互相对得上。",
    examples: "贴图和它穿的模型不一样大、动画用了模型里没有的骨骼、配方拿自己做自己、一次做出的数量一格放不下、敌对的生物伤不到人、规则要播放的动作模型里没有。",
    fix: "对照它依赖的那一样东西改：尺寸、名字、数量要一致。",
  },
] as const

export type Criterion = (typeof CRITERIA)[number]
export type CriterionId = Criterion["id"]
export const criterion = (id: CriterionId) => CRITERIA.find((value) => value.id === id)!

/**
 * How much a finding weighs. A rule's severity is how central the fault is to its kind, so the same fault
 * may weigh differently in two kinds: constant speed is craft in a creature's walk and a defect in a cast
 * action, where the motion is the whole work.
 */
export const SEVERITIES = {
  // Only the model defects whose truth depends on what the thing is (`DEFECT_REASONS` in model-quality.ts) have a second way out, a stated reason the reviewer judges against the pictures; the others are only changed.
  defect: { label: "硬伤", meaning: "不管需求怎么说都不行，一定退回；只有少数取决于“它是什么东西”的模型、方块和物品硬伤，制作者可以在部件说明的 justified 里写明理由，由评审对着图判断。" },
  craft: { label: "做工", meaning: "做得粗糙，照样退回；只有人自己明说要简单、低细节的时候才放过。模型的做工问题，制作者也可以在部件说明的 justified 里写明理由来回答，理由会原样给评审和人看。" },
} as const
export type Severity = keyof typeof SEVERITIES

/**
 * What a measurement that cannot tell a fault from a choice becomes: a note beside the verdict, never part of it. A rule whose number is in the grey zone (it
 * cannot say whether dots are noise or a deliberate sparkle, whether eyes that were not found are missing or sit where the measure does not look) returns its
 * finding as advice (`Found.advice`); only a number beyond doubt is a finding that refuses. Listed for whoever makes and whoever looks, counted for nothing.
 */
export const ADVICE = { label: "建议", meaning: "机器量出来有点可疑，但量法分不清它是毛病还是有意这样画的；列出来请制作的人和你看一眼，不挡通过，也不算退回。" } as const

/** What a brief may say that excuses a rule. A rule names at most one; nothing else in a brief changes a verdict. */
export const EXCUSES = {
  faceless: { label: "需求明说没有脸或没有眼睛", words: /(无脸|没有脸|无面|没有五官|无五官|不要五官|没有眼|无眼|不要眼|faceless|eyeless|no eyes|no face)/iu },
  floating: { label: "需求明说悬浮、漂浮或环绕", words: /(悬浮|漂浮|飘浮|浮空|浮在|环绕|float|hover|orbit|levitat)/iu },
  // broad3: "在空中飘" and "飘来飘去" were not heard, and a creature asked to drift was held to standing on the ground. The everyday ways to say
  // it are listed, not one subject's words. Being up in the air excuses only standing on the ground: a flying thing's parts still have to
  // hold together (the flying owl with loose ear tufts among the look specimens stays refused).
  // broad4: "在水里一漂一漂的" was not heard either; a thing that drifts in water is held up by the water, not the ground. 漂亮 is left out.
  airborne: { label: "需求明说它在空中或水里：飘着、漂着、悬浮、在天上、会飞或者在水里游", words: /(悬浮|漂(?!亮)|飘|浮空|浮在|空中|天上|会飞|在飞|飞来飞去|飞行|环绕|水里|水中|水下|水面|游泳|游来游去|游动|float|hover|orbit|levitat|\bfl(y|ies|ying)\b|\bswim)/iu },
  lopsided: { label: "需求明说不对称", words: /(不对称|非对称|独臂|独眼|单臂|单翼|asymmetr|one[- ]armed|lopsided)/iu },
} as const
export type ExcuseId = keyof typeof EXCUSES

/**
 * `plain`: the finding in one sentence for the person, with no name of code in it, when `message` quotes the code for whoever fixes it
 * (a gameplay's). The card reads `plain` first; `message` and `fix` stay for the AI that has to act on them and for 高级.
 */
export type Found = { message: string; fix: string; evidence?: string[]; plain?: string; advice?: true }
export type Rule<Measured> = {
  id: string
  criterion: CriterionId
  severity: Severity
  /** What the rule asks for, in one plain sentence. This is what an AI is told before it starts. */
  asks: string
  excuse?: ExcuseId
  /** What was found and what to change, or null when the measurement is inside its limit. `advice: true` when the number cannot tell a fault from a choice: a note, never a refusal (`ADVICE`). */
  find: (measured: Measured) => Found | null
  /**
   * The numbers this rule looked at on this very measurement, in one plain clause with the limit beside them (「孤立杂点占 2%（超过 12% 不合格）」). Shown to the
   * person when the rule passed, so a tick says what it stands on. Left out for a rule that is a plain yes or no with nothing to count: the card then says what it
   * looked at (`asks`) and that there is no number. Never given to an AI: an AI handed a number aims at the number (`told`).
   */
  read?: (measured: Measured) => string | null
}

/** What one asset kind brings to the standard: rules over its own measurements, and the criteria it cannot measure yet. */
export type KindStandard<Measured> = {
  kind: string
  label: string
  rules: readonly Rule<Measured>[]
  /** Criteria no rule of this kind reads, each with the reason in plain words. A criterion is in exactly one of the two. */
  unmeasured: Partial<Record<CriterionId, string>>
  /**
   * What is measured and said as a fact under a criterion with every look, to whoever makes and whoever
   * reviews: never a refusal. A criterion may have rules, facts, both, or (with a reason in `unmeasured`) neither.
   */
  told?: Partial<Record<CriterionId, string>>
}
/** A kind's rules without their measuring code: all that the brief, the matrix and the table tests need. */
export type StandardOutline = Pick<KindStandard<never>, "kind" | "label" | "unmeasured" | "told"> & { rules: readonly Pick<Rule<never>, "id" | "criterion" | "severity" | "asks" | "excuse">[] }

export const FINDING_REF_KINDS = ["clip", "bone", "asset", "ability", "combo", "phase", "stance", "part", "fixture", "blueprint", "registry"] as const
export type FindingRef = { kind: (typeof FINDING_REF_KINDS)[number]; id: string | number; title: string }

export type Finding = { refs?: FindingRef[]; criterion: CriterionId; rule: string; severity: Severity; message: string; fix: string; evidence?: string[]; plain?: string }
/** A finding the measure was not sure of (`ADVICE`): it has no severity because it weighs nothing. */
export type Advised = Omit<Finding, "severity">
export type Level = "full" | "simple"
export type AssetReview = {
  kind: string
  passed: boolean
  findings: Finding[]
  /** How each criterion came out for this asset, in the standard's order. */
  criteria: { id: CriterionId; name: string; state: "passed" | "failed" | "unmeasured"; note: string | null }[]
  /** The numbers behind the verdict, for a table or a test. Null when the document could not be measured. */
  measured: Record<string, unknown> | null
  level: Level
  /** An AI's revision of a person's own work that did not itself pass: findings are listed but nothing is held against it. */
  spared: boolean
  /** The document could not be measured at all: refused before any criterion applies. */
  unreadable: { message: string; fix: string } | null
  /**
   * Every rule that ran on this asset, in the standard's order, with whether it passed (did not refuse: a rule that only advised passed) and the numbers it passed on (`Rule.read`). A rule the brief excused, or a craft
   * rule on a request for something simple, did not run and is not here. Absent when nothing could be measured. For the person's card only.
   */
  looked?: { rule: string; criterion: CriterionId; asks: string; passed: boolean; read: string | null }[]
  /** Craft findings the maker answered with a stated reason (`answerCraft`): not blocking, and shown with the reason as written. Absent when none. */
  answered?: (Finding & { reason: string })[]
  /** What a rule measured but could not call a fault (`ADVICE`): shown, never refused for. Absent when none. */
  advice?: Advised[]
}

export type ReviewContext = {
  /** Everything the work was asked to be: the person's request and any task text. It may excuse a rule; it cannot waive a defect. */
  brief?: string
  /** The person's own words, when `brief` also carries text a planner wrote: only a person can ask for simple or rich work. Defaults to `brief`. */
  asked?: string
  /** A setting chosen for this run asks for the full standard whatever the brief says about the previous version. */
  insisted?: boolean
  /**
   * The part sheet's `justified` list: the maker's stated reasons for what was measured and is meant. A model's (and its texture's) craft
   * finding whose rule id is named here is answered, not blocking (`answerCraft`); so are the defects of `ANSWERABLE_DEFECTS` (a fact about what the thing is: a missing head or face, hovering, a detached part, few blocks, hopping), no other defect. Read by model and texture reviews, and by block and item reviews for `few_tones`, `noisy_texture` and `icon_fills_square` (mod-core `SPRITE_ANSWERS`).
   */
  justified?: readonly { what: string; reason: string }[] | null
}

/** How many times one task may hand in work the standard refuses before it counts as failed. The same for every kind. */
export const REFUSAL_CAP = 4

const SIMPLE_WORDS = /(?:简单|低模|低多边形|低细节|简化|simple|low[- ]?poly|low[- ]?detail|minimal|basic)/iu
const VANILLA_MODEL_WORDS = /原版(?:模型|生物(?!群系)|苦力怕|僵尸|骷髅|动物|造型|外形|轮廓)/u
const RICH_WORDS =
  /(?:精细|复杂|高模|高细节|丰富|精致|华丽|层次|多层|材质层次|结构层次|detailed|complex|intricate|high[- ]?detail|ornate|rich|crafted)/iu
const NEGATED_SIMPLE_WORDS =
  /(?:(?:不要|避免|拒绝|不能|禁止|别|不想)[^，,。.;；\n]{0,8}(?:简单|低模|低多边形|低细节|简化)|\b(?:not|never|avoid|without|don't|do not)\b[^,.!;\n]{0,24}\b(?:simple|low[- ]?poly|low[- ]?detail|simplif\w*))/iu

const rich = (brief: string) => RICH_WORDS.test(brief) || NEGATED_SIMPLE_WORDS.test(brief)

/** `simple` when the brief plainly asks for simple or vanilla-like work and does not also ask for detail. */
export function briefLevel(brief: string): Level {
  return !rich(brief) && (SIMPLE_WORDS.test(brief) || VANILLA_MODEL_WORDS.test(brief)) ? "simple" : "full"
}

/**
 * How one piece of AI work is held. Inside Studio every run insists (a tier is always chosen), so fresh
 * work and a redo of AI work are always judged: in full, or on defects only when the brief plainly asks
 * for something simple. Two cases are spared, and only when nothing insists: a caller of the bare modelling
 * service that asks for something simple, and a revision of a person's own work that does not itself pass —
 * the AI may not make passing work worse, and a person's own weak original is never an obstacle.
 * `revised` says whether the version being revised passes; null when nothing of a person's is being revised.
 */
export function holdFor(context: ReviewContext, revised: (() => boolean) | null): { level: Level; spared: boolean } {
  const brief = (context.asked ?? context.brief)?.trim() ?? ""
  if (rich(brief)) return { level: "full", spared: false }
  if (revised) return { level: "full", spared: !context.insisted && !revised() }
  return { level: briefLevel(brief), spared: briefLevel(brief) === "simple" && !context.insisted }
}

const outcome = (outline: StandardOutline, findings: Finding[], measured: boolean) =>
  CRITERIA.map((value) => {
    const note = outline.unmeasured[value.id] ?? null
    const read = outline.rules.some((rule) => rule.criterion === value.id)
    return { id: value.id, name: value.name, state: !measured || !read ? ("unmeasured" as const) : findings.some((finding) => finding.criterion === value.id) ? ("failed" as const) : ("passed" as const), note: read ? null : note }
  })

/** The verdict on one asset from its measurements. Kind-specific code stops at `measured`; everything after it is this. */
export function judge<Measured extends object>(
  standard: KindStandard<Measured>,
  measured: Measured,
  context: ReviewContext = {},
  hold: { level: Level; spared: boolean } = holdFor(context, null),
  shown: Record<string, unknown> = measured as Record<string, unknown>,
): AssetReview {
  const brief = context.brief ?? ""
  const ran = standard.rules.filter((rule) => (hold.level === "full" || rule.severity === "defect") && !(rule.excuse && EXCUSES[rule.excuse].words.test(brief)))
  const results = ran.map((rule) => ({ rule, found: rule.find(measured) }))
  const findings = results.flatMap(({ rule, found }) => (found && !found.advice ? [{ criterion: rule.criterion, rule: rule.id, severity: rule.severity, ...found }] : []))
  const advice = results.flatMap(({ rule, found }): Advised[] => (found?.advice ? [{ criterion: rule.criterion, rule: rule.id, message: found.message, fix: found.fix, ...(found.evidence ? { evidence: found.evidence } : {}) }] : []))
  const looked = results.map(({ rule, found }) => ({ rule: rule.id, criterion: rule.criterion, asks: rule.asks, passed: found === null || Boolean(found.advice), read: rule.read?.(measured) ?? null }))
  return rejudged({ kind: standard.kind, passed: true, findings, criteria: [], measured: shown, looked, level: hold.level, spared: hold.spared, unreadable: null, ...(advice.length ? { advice } : {}) }, standard, findings)
}

const named = (what: string) => what.trim().toLowerCase().replace(/\s+/g, "").replace("：", ":")

/** The end of a craft finding's fix, the same words a measured motion fault ends with: what to write in the part sheet to answer it with a reason. */
export const justifyTail = (what: string) => `如果它本来就该这样，在部件说明的 justified 里写上这一项和理由（{"what":"${what}","reason":"……"}），理由会原样给评审和人看。`

/**
 * Craft findings that the maker's part sheet answers with a reason: a finding `answerable` accepts whose rule id is the `what` of a `justified`
 * entry (with a reason) no longer blocks and moves to `answered`, reason and all. Owner's rule: a gate stops only on what a player would
 * obviously see as an error (a defect, which is not answered this way, except those of `ANSWERABLE_DEFECTS`); a matter of craft is the maker's to answer with a reason the
 * reviewer and the person read. Nothing else about the review changes.
 */
export function answerCraft(review: AssetReview, justified: ReviewContext["justified"], answerable: (finding: Finding) => boolean): AssetReview {
  const reason = (finding: Finding) => (answerable(finding) ? justified?.find((entry) => named(entry.what) === named(finding.rule) && entry.reason.trim())?.reason ?? null : null)
  const settled = review.findings.flatMap((finding) => {
    const why = reason(finding)
    return why === null ? [] : [{ ...finding, reason: why }]
  })
  if (settled.length === 0) return review
  const findings = review.findings.filter((finding) => !settled.some((other) => other.rule === finding.rule))
  return {
    ...review,
    findings,
    passed: review.spared || findings.length === 0,
    criteria: review.criteria.map((value) => (value.state === "failed" && !findings.some((finding) => finding.criterion === value.id) ? { ...value, state: "passed" as const } : value)),
    answered: [...(review.answered ?? []), ...settled],
  }
}

/** The same review with other findings: when what is seen is two assets together, one's findings stand in for the other's. */
export function rejudged(review: AssetReview, outline: StandardOutline, findings: Finding[]): AssetReview {
  return { ...review, findings, passed: review.spared || findings.length === 0, criteria: outcome(outline, findings, true) }
}

/** The review of a document that cannot be measured: refused, with the one thing to fix first. */
export function unreadable(standard: StandardOutline, message: string, fix: string): AssetReview {
  return { kind: standard.kind, passed: false, findings: [], criteria: outcome(standard, [], false), measured: null, level: "full", spared: false, unreadable: { message, fix } }
}

/** The review of something this kind has nothing to measure on (an item with no picture of its own, a texture on no model): passed, every criterion left to the person. */
export function unmeasured(outline: StandardOutline, note: string): AssetReview {
  return { kind: outline.kind, passed: true, findings: [], criteria: CRITERIA.map((value) => ({ id: value.id, name: value.name, state: "unmeasured" as const, note })), measured: null, level: "full", spared: false, unreadable: null }
}

/**
 * What an AI is told when its work is refused: every finding as a numbered line that names the criterion,
 * says what was found and says what to change. Plain Chinese; no measurement names.
 */
export function refusalText(review: Pick<AssetReview, "findings" | "unreadable">) {
  if (review.unreadable) return `1. 这份内容没法验收：${review.unreadable.message}怎么改：${review.unreadable.fix}`
  return review.findings.map((finding, index) => `${index + 1}. 【${criterion(finding.criterion).name}】${finding.message}怎么改：${finding.fix}`).join(" ")
}

/**
 * A review as an AI is shown it, for a draft, for a redo and for a repair: the verdict and, per finding,
 * the criterion by name, what was found and what to change. The numbers behind it and the names of the
 * rules are left out: an AI that is handed a number aims at the number.
 */
export function told(review: AssetReview, includeRefs = false) {
  return {
    kind: review.kind,
    passed: review.passed,
    level: review.level,
    spared: review.spared,
    unreadable: review.unreadable,
    findings: review.findings.map((finding) => ({ criterion: criterion(finding.criterion).name, severity: SEVERITIES[finding.severity].label, message: finding.message, fix: finding.fix, ...(includeRefs && finding.refs?.length ? { refs: finding.refs } : {}) })),
    ...(review.answered?.length ? { answered: review.answered.map((finding) => ({ criterion: criterion(finding.criterion).name, message: finding.message, reason: finding.reason })) } : {}),
    ...(review.advice?.length ? { advice: review.advice.map((entry) => ({ criterion: criterion(entry.criterion).name, message: entry.message, fix: entry.fix, ...(includeRefs && entry.refs?.length ? { refs: entry.refs } : {}) })) } : {}),
    criteria: review.criteria.map((value) => ({ name: value.name, state: value.state, note: value.note })),
    text: review.passed ? null : refusalText(review),
  }
}
export type ToldReview = ReturnType<typeof told>

/**
 * What a refusal means for the task that handed the work in, whatever its kind and whoever made it: nothing
 * is saved; below the cap the maker is told what to change and may hand in again, at the cap the task has failed.
 * `refusals` counts this one.
 */
export function refusal(label: string, review: Pick<AssetReview, "findings" | "unreadable">, refusals: number) {
  const left = Math.max(0, REFUSAL_CAP - refusals)
  return left > 0
    ? { final: false, left, text: `${label}没通过验收，工程里什么都没有改动。必须逐条改掉：${refusalText(review)}（还可以再交 ${left} 次）` }
    : { final: true, left, text: `${label}改了 ${refusals} 次还是没通过验收：${refusalText(review)}` }
}

const end = (text: string) => (/[。！？]$/.test(text) ? text : `${text}。`)
const SIMPLE_NOTE = `人自己明说要简单、低细节的，只放宽“${SEVERITIES.craft.label}”一类的要求，“${SEVERITIES.defect.label}”照样退回。`

/** The standard in a few lines, for anyone who has not started yet. */
export const STANDARD_SUMMARY = `AI 做的每一样东西都按同一套验收标准检查，共 ${CRITERIA.length} 条：${CRITERIA.map((value) => `${value.name}（${value.meaning.replace(/。$/, "")}）`).join("；")}。不合格的不会保存，会按条说明发现了什么、怎么改；同一个任务最多被退回 ${REFUSAL_CAP} 次。标准只管得了量得出来的毛病，像不像需求、好不好看由人自己验收。`

/** What the standard asks of one kind, generated from its rules: this is the brief an AI gets before it starts. */
export function standardBrief(outline: StandardOutline) {
  const lines = CRITERIA.map((value) => {
    const rules = outline.rules.filter((rule) => rule.criterion === value.id)
    const fact = outline.told?.[value.id] ? `每次看图会告诉你量出来的事实（不作为退回的理由）：${end(outline.told[value.id]!)}` : ""
    if (!rules.length) return `${value.name}——这一类暂时不检查（${(outline.unmeasured[value.id] ?? "还没有可靠的量法").replace(/。$/, "")}）。${fact}`
    return `${value.name}——${value.meaning}这一类具体看：${rules.map((rule) => end(rule.asks).replace(/。$/, "")).join("；")}。${fact}`
  })
  const excuses = [...new Set(outline.rules.flatMap((rule) => (rule.excuse ? [EXCUSES[rule.excuse].label] : [])))]
  return `验收标准（${outline.label}）：提交时按下面 ${CRITERIA.length} 条检查，不合格不会保存，会退回并逐条说明要改什么；同一个任务最多被退回 ${REFUSAL_CAP} 次，之后记为没做成。${lines.join("")}${excuses.length ? `只有这些情况可以例外：${excuses.join("；")}。` : ""}${SIMPLE_NOTE}`
}

/** Which criteria each kind measures, for the matrix in the written standard and in `get_capabilities`. */
export function coverage(outlines: readonly StandardOutline[]) {
  return outlines.map((outline) => ({
    kind: outline.kind,
    label: outline.label,
    criteria: CRITERIA.map((value) => {
      const rules = outline.rules.filter((rule) => rule.criterion === value.id)
      return { id: value.id, name: value.name, measured: rules.length > 0, checks: rules.map((rule) => rule.asks), note: rules.length ? null : (outline.unmeasured[value.id] ?? null), told: outline.told?.[value.id] ?? null }
    }),
  }))
}

export const outlineOf = <Measured>(standard: KindStandard<Measured>): StandardOutline => ({ kind: standard.kind, label: standard.label, unmeasured: standard.unmeasured, ...(standard.told ? { told: standard.told } : {}), rules: standard.rules.map((rule) => ({ id: rule.id, criterion: rule.criterion, severity: rule.severity, asks: rule.asks, ...(rule.excuse ? { excuse: rule.excuse } : {}) })) })

const cell = (text: string) => text.replaceAll("|", "／")

/**
 * The parts of the written standard that are the definitions themselves, as Markdown: the criteria, how
 * much a finding weighs, what a brief may excuse, and criterion by kind what is measured and what is not.
 * The document under docs/ carries these between markers and a test fails when the two drift.
 */
export function writtenStandard(outlines: readonly StandardOutline[]) {
  const rows = coverage(outlines)
  // A kind that refuses nothing but says measured facts with every look (an effect) is written out criterion by criterion too.
  const measuring = rows.filter((row) => row.criteria.some((value) => value.measured || value.told))
  const idle = rows.filter((row) => !measuring.includes(row))
  return {
    criteria: CRITERIA.map((value, index) => `### ${index + 1}. ${value.name}\n\n${value.meaning}\n\n- 常见的毛病：${value.examples}\n- 怎么改：${value.fix}`).join("\n\n"),
    severity: [
      ...Object.values(SEVERITIES).map((value) => `- **${value.label}**：${value.meaning}`),
      `- **${ADVICE.label}**：${ADVICE.meaning}`,
      "",
      "需求里只有下面这几句话能让某一条不查，别的话都不改变结果：",
      "",
      ...Object.values(EXCUSES).map((value) => `- ${value.label}`),
    ].join("\n"),
    matrix: [
      `| 种类 | ${CRITERIA.map((value) => value.name).join(" | ")} |`,
      `| --- | ${CRITERIA.map(() => "---").join(" | ")} |`,
      ...rows.map((row) => `| ${row.label} | ${row.criteria.map((value) => (value.measured ? `查 ${value.checks.length} 条` : "不查")).join(" | ")} |`),
    ].join("\n"),
    checks: [
      ...measuring.map((row) =>
        [`### ${row.label}`, "", ...row.criteria.map(
          (value) =>
            (value.measured ? `- **${value.name}**：${value.checks.map((check) => cell(check.replace(/。$/, ""))).join("；")}。` : `- **${value.name}**：还不查。${end(value.note ?? "还没有可靠的量法")}`) +
            (value.told ? `看图时告诉制作者和评审的事实（不退回）：${end(cell(value.told))}` : ""),
        )].join("\n"),
      ),
      ...(idle.length ? [`### ${idle.map((row) => row.label).join("、")}\n\n六条都不查。${end(idle[0]!.criteria[0]!.note ?? "")}`] : []),
    ].join("\n\n"),
    refusal: [
      `- 不合格的不会保存。退回时逐条写明：是哪一条标准、发现了什么、怎么改。`,
      `- 同一个任务最多被退回 ${REFUSAL_CAP} 次。第 ${REFUSAL_CAP} 次还不合格，这个任务记为没做成，工程里原来的内容不动。`,
      `- ${SIMPLE_NOTE}`,
    ].join("\n"),
  }
}
