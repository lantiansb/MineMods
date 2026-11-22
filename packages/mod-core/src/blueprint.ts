import { z } from "zod"
import type { Project } from "./project"
import { blueprintSource, blueprintSourceKey } from "./task-source"
import { assetKind, kindCapability, ModuleKindSchema, type ModuleKind, type TargetId } from "./workspace-modules"
import { PROJECT_RUN_LIMITS, RoutePlanSchema, type RoutePlan } from "./workspace-runs"
import { CONSTRAINT_LIMITS, ConstraintCheckSchema, ConstraintSchema, HonourSchema, LiftedSchema, constraintLines } from "./blueprint-constraints"
import { PLAY_QUESTIONS, PaperPlayRecordSchema, PlaySchema } from "./playable"
import { CreatureTierSchema, TIER_HEADING, TIER_WORDS, tierTaskLines } from "./creature-tier"
import { blueprintCreature } from "./blueprint-creature"

// Same shape as a run task key, so an entry can become a task without renaming.
const KeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const NoteSchema = z.string().trim().min(1).max(1000)

export const BLUEPRINT_LIMITS = { entries: 200, palette: 12, needs: PROJECT_RUN_LIMITS.dependencies, questions: 32 } as const

/**
 * How an entry says what it is to the content the project already has. "change": the entry is that content, made again from its
 * current state, not a new thing (the id is the one `get_blueprint` lists under `existing`). "separate": the entry shares a name with
 * existing content, or reads like a change to it, and is meant to be a second, different thing; `why` says how it differs. Without
 * either, such an entry is refused, so a plan cannot add a second creature of the same name beside the one it meant to change.
 */
export const ExistingRefSchema = z.strictObject({
  id: z.uuid(),
  action: z.enum(["change", "separate"]),
  why: z.string().trim().min(1).max(300).optional(),
})
export type ExistingRef = z.infer<typeof ExistingRefSchema>

export const BlueprintStyleSchema = z.strictObject({
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(BLUEPRINT_LIMITS.palette),
  shape: z.string().trim().max(1000),
  naming: z.string().trim().max(1000),
  world: z.string().trim().max(4000),
})

/** What the planner (a person or an AI) may write. Revision, confirmation and asset links belong to the app. */
export const BlueprintDraftSchema = z.strictObject({
  request: z.string().trim().min(1).max(20000),
  style: BlueprintStyleSchema,
  entries: z
    .array(
      z.strictObject({
        key: KeySchema,
        kind: ModuleKindSchema,
        title: z.string().trim().min(1).max(120),
        brief: z.string().trim().min(1).max(4000),
        owner: KeySchema.nullable(),
        needs: z.array(KeySchema).max(BLUEPRINT_LIMITS.needs),
        out_of_scope: NoteSchema.nullable(),
        /** Which of the person's requirements this entry touches, and how it keeps each. Absent in plans from before requirements were kept. */
        honours: z.array(HonourSchema).max(CONSTRAINT_LIMITS.honours).optional(),
        /** What this thing answers to the four playability questions, and what is left out on purpose (see `playable`). Absent in plans from before the standard. */
        play: PlaySchema.optional(),
        /** How much this creature is worth making well, who decided and why (creature tier, 10-12). Only a creature carries one; absent means standard, as in every plan from before tiers. */
        tier: CreatureTierSchema.optional(),
        /** Whether this entry changes content the project already has, or is deliberately a second thing beside a same-named one (see `ExistingRefSchema`). */
        existing: ExistingRefSchema.optional(),
      }),
    )
    .max(BLUEPRINT_LIMITS.entries),
  questions: z.array(NoteSchema).max(BLUEPRINT_LIMITS.questions),
  /** How the plan keeps a requirement that touches no single entry ("先不要做合成表"). */
  honours: z.array(HonourSchema).max(CONSTRAINT_LIMITS.constraints).optional(),
  /** The person's requirements, word for word; which of them they gave up; and who compared the entries with them. Written by the app, never by a planner. */
  constraints: z.array(ConstraintSchema).max(CONSTRAINT_LIMITS.constraints).optional(),
  lifted: z.array(LiftedSchema).max(CONSTRAINT_LIMITS.constraints).optional(),
  check: ConstraintCheckSchema.optional(),
  /** What a reader that took no part in planning found when it walked the plan as a new survival world. Written by the app. */
  paper: PaperPlayRecordSchema.optional(),
})

/**
 * Stored on the project. Only shape and size are checked here: the rules that depend on the asset
 * registry live in `validateBlueprint`, so a later registry change can never stop a saved project opening.
 */
export const BlueprintSchema = BlueprintDraftSchema.extend({
  revision: z.number().int().min(1),
  state: z.enum(["draft", "confirmed"]),
  entries: z
    .array(BlueprintDraftSchema.shape.entries.element.extend({ asset_id: z.uuid().nullable() }))
    .max(BLUEPRINT_LIMITS.entries),
})

/** What a planner is asked for. The request is the person's own sentence, so the app fills it in. */
export const BlueprintPlanSchema = BlueprintDraftSchema.omit({ request: true, constraints: true, lifted: true, check: true, paper: true })

export type BlueprintDraft = z.infer<typeof BlueprintDraftSchema>
export type BlueprintPlan = z.infer<typeof BlueprintPlanSchema>
export type Blueprint = z.infer<typeof BlueprintSchema>
export type BlueprintEntry = Blueprint["entries"][number]

export { blueprintSource } from "./task-source"

function sourceEntry(blueprint: Blueprint | undefined, source: string) {
  return blueprint?.entries.find((entry) => entry.key === blueprintSourceKey(source))
}

/** Every rule a blueprint must meet before the app stores it. Messages are shown to the person as written. */
export function validateBlueprint(input: unknown, target: TargetId): Blueprint {
  const blueprint = BlueprintSchema.parse(input)
  const byKey = new Map(blueprint.entries.map((entry) => [entry.key, entry]))
  if (byKey.size !== blueprint.entries.length) throw new Error("蓝图里有重复的条目标识。")
  const linked = blueprint.entries.flatMap((entry) => (entry.asset_id ? [entry.asset_id] : []))
  if (new Set(linked).size !== linked.length) throw new Error("蓝图里有两个条目指向同一个已做好的内容。")
  const changed = blueprint.entries.flatMap((entry) => (entry.existing?.action === "change" ? [entry.existing.id] : []))
  if (new Set(changed).size !== changed.length) throw new Error("蓝图里有两个条目都要改同一样已有的内容。一样内容只能由一个条目来改。")
  // Only that the ids exist: whether a requirement is kept is settled where an AI's plan comes in (`lockRefusal`), never on opening.
  const stray = [...(blueprint.honours ?? []), ...blueprint.entries.flatMap((entry) => entry.honours ?? [])].find((value) => !(blueprint.constraints ?? []).some((constraint) => constraint.id === value.constraint))
  if (stray) throw new Error(`蓝图里提到了一条不存在的要求（${stray.constraint}）。`)
  blueprint.entries.forEach((entry) => {
    // creature tier (10-12): a tier is about how well a creature is made, so a block, an item or a part cannot carry one.
    if (entry.tier && entry.kind !== "entity") throw new Error(`「${entry.title}」不是生物，不能定档位：档位只给生物条目（${TIER_WORDS.labels}）。`)
    const owner = entry.owner === null ? undefined : byKey.get(entry.owner)
    // Naming itself is its own mistake, with its own words: the usual case is a creature given its own key as owner.
    if (entry.owner === entry.key)
      throw new Error(`「${entry.title}」的 owner 写的是它自己：一样东西不能属于它自己。owner 是给部件用的——模型、贴图、玩法这些属于某个生物、方块或物品的，才写那样东西的 key；${assetKind(entry.kind).owner ? "生物、方块、物品自己通常不属于谁，owner 填 null。" : "它不属于别的东西时，owner 填 null。"}`)
    if (entry.owner !== null && (!owner || !assetKind(owner.kind).owner))
      throw new Error(`「${entry.title}」所属的内容不存在，或者不是生物、方块、物品这类内容。`)
    if (new Set(entry.needs).size !== entry.needs.length || entry.needs.some((key) => key === entry.key || !byKey.has(key)))
      throw new Error(`「${entry.title}」依赖了不存在的条目。`)
  })
  const visit = (key: string, path: string[]) => {
    if (path.includes(key)) throw new Error("蓝图里的依赖绕成了一个圈。")
    byKey.get(key)!.needs.forEach((need) => visit(need, [...path, key]))
  }
  blueprint.entries.forEach((entry) => visit(entry.key, []))
  blueprint.entries.forEach((entry) => {
    const kind = assetKind(entry.kind)
    if (kindCapability(entry.kind, target) !== "runtime" && !entry.out_of_scope)
      throw new Error(`「${entry.title}」是${kind.label}，目前做不进游戏，必须写明原因并标为不制作。`)
    const needed = entry.needs.map((key) => byKey.get(key)!)
    const allowed = kind.references.flatMap((reference) => reference.kinds)
    const stray = needed.find((need) => !allowed.includes(need.kind))
    if (stray) throw new Error(`「${entry.title}」是${kind.label}，不能依赖${assetKind(stray.kind).label}「${stray.title}」。`)
    if (entry.out_of_scope) return
    const unmade = needed.find((need) => need.out_of_scope)
    if (unmade) throw new Error(`「${entry.title}」依赖了不制作的「${unmade.title}」。`)
    const missing = kind.references.find((reference) => reference.required && !needed.some((need) => reference.kinds.includes(need.kind)))
    if (missing) throw new Error(`「${entry.title}」是${kind.label}，必须依赖一个${missing.kinds.map((value) => assetKind(value).label).join("或")}条目。`)
  })
  return blueprint
}

/**
 * Store a new plan. The revision goes up and the plan returns to draft, so nothing is made from it
 * until the person confirms again. An entry that keeps its key and kind keeps the asset already made for it.
 */
export function replaceBlueprint(project: Project, input: BlueprintDraft): Project {
  const draft = BlueprintDraftSchema.parse(input)
  const blueprint = validateBlueprint(
    {
      ...draft,
      revision: (project.blueprint?.revision ?? 0) + 1,
      state: "draft",
      entries: draft.entries.map((entry) => ({
        ...entry,
        asset_id:
          project.blueprint?.entries.find((value) => value.key === entry.key && value.kind === entry.kind)?.asset_id ?? null,
      })),
    },
    project.target,
  )
  return { ...project, blueprint }
}

/** The person approves exactly the revision they were shown. */
export function confirmBlueprint(project: Project, revision: number): Project {
  if (!project.blueprint) throw new Error("这个工程还没有蓝图。")
  if (project.blueprint.revision !== revision) throw new Error("蓝图已经更新，请先查看最新版本再确认。")
  return { ...project, blueprint: validateBlueprint({ ...project.blueprint, state: "confirmed" }, project.target) }
}

/** Point an entry at the asset that was made for it. */
export function linkBlueprintEntry(project: Project, key: string, assetId: string): Project {
  const entry = project.blueprint?.entries.find((value) => value.key === key)
  if (!project.blueprint || !entry) throw new Error("蓝图里没有这个条目。")
  if (!project.workspace.assets.some((asset) => asset.id === assetId && asset.module === entry.kind))
    throw new Error("要关联的内容不存在，或者种类和条目不一致。")
  return {
    ...project,
    blueprint: validateBlueprint(
      { ...project.blueprint, entries: project.blueprint.entries.map((value) => (value.key === key ? { ...value, asset_id: assetId } : value)) },
      project.target,
    ),
  }
}

export { blueprintCreature } from "./blueprint-creature"

/** A link left behind by a deleted asset is still a plan. */
export function blueprintEntryMade(project: Project, entry: BlueprintEntry) {
  if (!entry.asset_id) return false
  if (entry.kind === "entity") return Boolean(blueprintCreature(project, entry))
  if (project.workspace.assets.some((asset) => asset.id === entry.asset_id && asset.module === entry.kind)) return true
  const legacy = { model: project.assets, block: project.blocks, item: project.items, recipe: project.recipes, logic: project.logic }
  return entry.kind in legacy && legacy[entry.kind as keyof typeof legacy].some((asset) => asset.id === entry.asset_id)
}

/**
 * Called when a run task's asset has just been saved. A task that did not come from the blueprint, or
 * whose entry has since been replaced, leaves the project untouched: saving the asset must not fail over a link.
 */
export function linkBlueprintTask(project: Project, task: { source: string; module: ModuleKind }, assetId: string): Project {
  const entry = sourceEntry(project.blueprint, task.source)
  if (!project.blueprint || !entry || entry.kind !== task.module) return project
  if (project.blueprint.entries.some((value) => value.asset_id === assetId)) return project
  return {
    ...project,
    blueprint: { ...project.blueprint, entries: project.blueprint.entries.map((value) => (value === entry ? { ...value, asset_id: assetId } : value)) },
  }
}

/** Entries a run task may name as its source: only from a confirmed plan, and only what will be made. */
export function blueprintTaskSources(blueprint: Blueprint | undefined) {
  if (blueprint?.state !== "confirmed") return []
  return blueprint.entries.filter((entry) => !entry.out_of_scope).map((entry) => ({ key: entry.key, kind: entry.kind }))
}

/** Assets already made for what a blueprint task needs, including ones from earlier batches. */
export function blueprintNeedAssetIds(blueprint: Blueprint | undefined, source: string) {
  return (sourceEntry(blueprint, source)?.needs ?? []).flatMap((key) => {
    const assetId = blueprint!.entries.find((entry) => entry.key === key)?.asset_id
    return assetId ? [assetId] : []
  })
}

/**
 * What a plan entry is to a creature the person made by hand. Such a creature has no workspace asset: its entry (kind entity, `existing`
 * naming the creature) makes the rules as a new asset, and the model the entry needs is made under the creature's own id, which is how a
 * model is bound to a creature (they share one id). Left to the AI to say twice, the model entry could point nowhere or at a second
 * creature, so it is worked out here, once, from the one `existing` the creature's entry carries. `rules`: the ids of the workspace
 * assets that are a creature's rules; an entity entry whose `existing` id is not among them is changing a hand-made creature. Without
 * `rules` every `existing` is taken to be an asset (the caller does not know the project).
 */
export type HandRole = { role: "creature" | "model"; id: string; of: string }

export function handMade(blueprint: Pick<Blueprint, "entries">, rules: ReadonlySet<string> | undefined): Map<string, HandRole> {
  const roles = new Map<string, HandRole>()
  if (!rules) return roles
  for (const entry of blueprint.entries) {
    const ref = entry.existing
    if (entry.kind !== "entity" || entry.out_of_scope || ref?.action !== "change" || entry.asset_id || rules.has(ref.id)) continue
    roles.set(entry.key, { role: "creature", id: ref.id, of: entry.title })
    // The model that carries the creature's id is the first one it needs that is not made yet.
    const model = entry.needs.map((key) => blueprint.entries.find((value) => value.key === key)).find((value) => value?.kind === "model" && !value.asset_id && !value.out_of_scope)
    if (model) roles.set(model.key, { role: "model", id: ref.id, of: entry.title })
  }
  return roles
}

/**
 * The asset a task for this entry edits where it stands: the one already made for it, else the one it is to change. A hand-made creature
 * has no rules asset to edit, so its own entry makes a new one; the creature is reached through its model, which takes the creature's id.
 * Null: a thing made anew.
 */
export function taskTarget(entry: BlueprintEntry, hand: HandRole | undefined) {
  if (entry.asset_id) return entry.asset_id
  if (hand) return hand.role === "model" ? hand.id : null
  return entry.existing?.action === "change" ? entry.existing.id : null
}

/**
 * The next batch of work, at most one run's worth. An entry is ready when everything it needs is either
 * done already or sits earlier in the same batch. Returns null when nothing is left that can be started.
 * Entries in `skip` are never started, so whatever needs them never becomes ready either.
 */
export function nextBlueprintBatch(blueprint: Blueprint, done: Iterable<string>, skip: Iterable<string> = [], rules?: ReadonlySet<string>): RoutePlan | null {
  if (blueprint.state !== "confirmed") throw new Error("蓝图还没有确认，不能开工。")
  const finished = new Set(done)
  const skipped = new Set(skip)
  const pending = blueprint.entries.filter((entry) => !entry.out_of_scope && !finished.has(entry.key) && !skipped.has(entry.key))
  // Always take the first entry that can start, so the batch is already in dependency order.
  const pick = (chosen: BlueprintEntry[]): BlueprintEntry[] => {
    const next = pending.find(
      (entry) => !chosen.includes(entry) && entry.needs.every((key) => finished.has(key) || chosen.some((value) => value.key === key)),
    )
    return !next || chosen.length >= PROJECT_RUN_LIMITS.tasks ? chosen : pick([...chosen, next])
  }
  const batch = pick([])
  if (!batch.length) return null
  const hand = handMade(blueprint, rules)
  return RoutePlanSchema.parse({
    // broad5 w4: "还剩 0 项" beside a task of this batch still waiting for another was read as "nothing left". It counts what is
    // left for later batches, so it says so.
    summary: `按蓝图这一批做 ${batch.length} 项（有的要等同一批里别的做好才开始）${pending.length - batch.length ? `，之后还有 ${pending.length - batch.length} 项留到下一批` : "，蓝图里的都在这一批了"}。`,
    questions: [],
    tasks: batch.map((entry) => ({
      key: entry.key,
      module: entry.kind,
      title: entry.title,
      prompt: blueprintTaskPrompt(blueprint, entry, finished, [], hand.get(entry.key)),
      source: blueprintSource(entry.key),
      dependencies: entry.needs.filter((key) => !finished.has(key)),
      // Content the entry changes is edited where it stands, not made anew: the task is handed the current document.
      // A hand-made creature has no rules asset to edit, so its own entry makes a new one; the creature is reached through its model, which takes the creature's id.
      target_id: taskTarget(entry, hand.get(entry.key)),
    })),
  })
}

/** The style every task of this plan is given, one line each. */
export function blueprintStyleLines(blueprint: Blueprint) {
  return [
    blueprint.style.world && `世界观：${blueprint.style.world}`,
    blueprint.style.shape && `造型：${blueprint.style.shape}`,
    blueprint.style.naming && `命名：${blueprint.style.naming}`,
    blueprint.style.palette.length > 0 && `配色：${blueprint.style.palette.join("、")}`,
  ].filter((line): line is string => typeof line === "string" && line.length > 0)
}

/** The headings a task text closes with. Whatever is said in `extra` ends where the first of them begins. */
export const TASK_PROMPT_HEADINGS = ["整个模组共用的风格约定：", "已经做好、可以直接引用的内容：", "用户亲口提的要求，一条都不能违反：", "这样东西在蓝图里答应过的事，做出来都要兑现：", TIER_HEADING] as const

/** What one entry's task is told: its brief, anything said in `extra`, the shared style, and what is already made for it to use. */
export function blueprintTaskPrompt(blueprint: Blueprint, entry: BlueprintEntry, finished: Set<string>, extra: string[] = [], hand?: HandRole) {
  const style = blueprintStyleLines(blueprint)
  const made = entry.needs.flatMap((key) => {
    const need = blueprint.entries.find((value) => value.key === key)!
    return finished.has(key) && need.asset_id ? [`${assetKind(need.kind).label}「${need.title}」，资产 ID ${need.asset_id}`] : []
  })
  // Every requirement goes to every task, word for word: the one making a sword must know it is to stay an ordinary item.
  const required = constraintLines(blueprint, entry.honours)
  // What the plan promised for this thing under the four questions, so whoever makes it builds the answers and not only the look.
  const promised = [
    ...(entry.play?.answers ?? []).map((answer) => `- ${PLAY_QUESTIONS[answer.question].label}：${answer.words}`),
    ...(entry.play?.declined ?? []).map((value) => `- ${PLAY_QUESTIONS[value.question].label}：故意不做（${value.reason}），不要自己加上`),
  ]
  // creature tier (10-12): a creature and its model are told the level its blueprint entry settled, and what that asks of them.
  const tiered = tierTaskLines(blueprint.entries, entry.key)
  const changing =
    hand?.role === "creature"
      ? ["", `这一项是用户手动做的生物（${hand.id}），不是另做一个新的：名字、生命、速度、行为这些现在的设定见工程资料里的生物列表，没有被要求改的地方保持不变。它的模型由它依赖的模型条目做出来，做好以后就是这个生物的模型，生物里的 model_asset_id 就填那个模型的资产 ID。`]
      : hand?.role === "model"
        ? ["", `这个模型是给用户手动做的生物「${hand.of}」做的（${hand.id}），不是另做一个新生物：做好以后它就是这个生物的模型。如果工程里已经有它的模型，你拿到的就是现在的模型，在它的基础上改。`]
        : entry.existing?.action === "change" && !entry.asset_id
          ? ["", `这一项改的是工程里已有的内容（资产 ID ${entry.existing.id}），不是另做一个新的：在它现在的样子上改，名字和别的东西对它的引用都要保持有效。`]
          : []
  return [
    entry.brief,
    ...changing,
    ...extra,
    ...(tiered.length ? ["", TASK_PROMPT_HEADINGS[4], ...tiered] : []),
    ...(promised.length ? ["", TASK_PROMPT_HEADINGS[3], ...promised] : []),
    ...(required.length ? ["", TASK_PROMPT_HEADINGS[2], ...required] : []),
    ...(style.length ? ["", TASK_PROMPT_HEADINGS[0], ...style] : []),
    ...(made.length ? ["", TASK_PROMPT_HEADINGS[1], ...made] : []),
  ].join("\n")
}

const DESIGN_ONLY = "目前只能保存为设计稿，做不进游戏。"

/**
 * Turn the older free-text conception into a draft blueprint. The conception itself is left as it is.
 * A creature becomes two entries, its model and its rules, because that is how creatures are built.
 */
export function blueprintFromConception(project: Project): Project {
  const conception = project.conception
  const taken = new Set<string>()
  // Conception keys are free text; blueprint keys must be short, safe and unique.
  const allocate = (wanted: string, attempt = 1): string => {
    const safe = wanted.toLowerCase().replace(/[^a-z0-9_]/g, "_")
    const key = `${/^[a-z]/.test(safe) ? safe : `entry_${safe}`}`.slice(0, 48) + (attempt === 1 ? "" : `_${attempt}`)
    if (taken.has(key)) return allocate(wanted, attempt + 1)
    taken.add(key)
    return key
  }
  const entries = conception.entries.flatMap((entry): (BlueprintDraft["entries"][number] & { asset_id: string | null })[] => {
    const key = allocate(entry.key || `${entry.kind}_${entry.id.slice(0, 8)}`)
    const base = { title: entry.title, brief: entry.brief.slice(0, 4000), owner: null, needs: [], out_of_scope: null }
    if (entry.kind !== "entity") {
      const scope =
        kindCapability(entry.kind, project.target) !== "runtime"
          ? DESIGN_ONLY
          : entry.kind === "recipe" && entry.recipe.recipe_type !== "crafting"
            ? "目前只支持工作台合成，这种配方暂时做不了。"
            : null
      return [{ ...base, key, kind: entry.kind, out_of_scope: scope, asset_id: entry.id }]
    }
    const model = allocate(`${key}_model`)
    return [
      { ...base, key: model, kind: "model", title: `${entry.title}的模型`, owner: key, asset_id: entry.entity_id },
      {
        ...base,
        key,
        kind: "entity",
        brief: [entry.brief, entry.behavior_brief].filter(Boolean).join("\n").slice(0, 4000),
        needs: [model],
        asset_id:
          project.workspace.assets.find((asset) => asset.document.kind === "entity" && asset.document.model_asset_id === entry.entity_id)?.id ?? null,
      },
    ]
  })
  if (entries.length > BLUEPRINT_LIMITS.entries) throw new Error(`蓝图最多 ${BLUEPRINT_LIMITS.entries} 项，现有构想拆出来有 ${entries.length} 项，请先精简。`)
  const planned = replaceBlueprint(project, {
    request: conception.brief.trim() || project.description.trim() || project.name,
    style: { palette: [], shape: "", naming: "", world: conception.plan.trim().slice(0, 4000) },
    entries: entries.map(({ asset_id: _assetId, ...entry }) => entry),
    questions: (conception.review?.questions ?? []).map((question) => question.trim().slice(0, 1000)).filter(Boolean).slice(0, BLUEPRINT_LIMITS.questions),
  })
  // Link what the conception had already produced; anything that is not a saved asset of that kind stays unlinked.
  return entries.reduce(
    (next, entry) =>
      entry.asset_id &&
      next.workspace.assets.some((asset) => asset.id === entry.asset_id && asset.module === entry.kind) &&
      !next.blueprint!.entries.some((value) => value.asset_id === entry.asset_id)
        ? linkBlueprintEntry(next, entry.key, entry.asset_id)
        : next,
    planned,
  )
}
