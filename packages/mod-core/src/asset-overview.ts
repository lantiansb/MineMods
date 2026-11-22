import { ASSET_STATUS_LABELS, deriveAssetStatus, type AssetStatus } from "./asset-status"
import { productionState, type ProductionRecord } from "./blueprint-production"
import type { PlanRefusalView } from "./blueprint-refusal"
import type { Project } from "./project"
import { currentReview, remadeSince, type RedoRequest, type Review } from "./reviews"
import { detailFor } from "./creature-tier"
import { MODEL_COMPLEXITY_PRESETS } from "@minemods/studio-ai/model-quality"
import { blueprintSource, blueprintSourceKey } from "./task-source"
import type { VerificationRecord } from "./verification"
import { ASSET_KINDS, assetKind, kindCapability, type KindReference, type ModuleKind } from "./workspace-modules"
import type { ProjectRun } from "./workspace-runs"

/** "blocked" exists only here: it is a fact about the plan (something it needs failed), not about the asset. */
export const OVERVIEW_STATUS_LABELS = { ...ASSET_STATUS_LABELS, blocked: "被卡住" } as const
export type OverviewStatusId = keyof typeof OVERVIEW_STATUS_LABELS
/** What a queued item is called in place of 「正在做」: its status stays "making" (it holds a place in a live run, and is locked like one), only the word is true. */
export const QUEUED_LABEL = "在排队"

export type OverviewInput = {
  project: Project
  /** `model_complexity`: the 模型精细度 button the run started with, when the caller has it; without it the items say nothing of the detail they were made by. */
  runs: (Pick<ProjectRun, "state" | "created_at" | "tasks"> & Partial<Pick<ProjectRun, "model_complexity">>)[]
  /** The latest build that succeeded: its id, the project revision it was made from, and its manifest's asset list. */
  build: { id: string; revision: number; assets: { id: string; revision: number }[] } | null
  verification: VerificationRecord | null
  /** What the person said about saved things; absent means nobody has judged anything. */
  reviews?: Review[]
  /** "Try once more" requests for failed entries that were never made. */
  requests?: RedoRequest[]
  /** Saved things whose newest version is an older one the person brought back (see `deriveAssetStatus`). */
  restored?: string[]
  production: ProductionRecord | null
  /** Studio itself is working through the plan right now. A batch held by an outside AI is seen from the runs. */
  producing: boolean
  /** The newest plan an AI handed in that Studio refused, as the page shows it (see `refusalView`). Absent: none stands. */
  refusal?: PlanRefusalView | null
}

type Node = {
  id: string
  key: string | null
  asset_id: string | null
  kind: ModuleKind
  title: string
  brief: string
  /** What the references are read from; null for a plan entry that has not been made yet. */
  document: Record<string, unknown> | null
  dependencies: string[]
  owner: string | null
  planned: string[]
  out_of_scope: string | null
  revision: number | null
  /** When the saved asset last changed; null for anything that is not a workspace asset. */
  updated_at: string | null
  status: Omit<AssetStatus, "status"> & { status: OverviewStatusId }
}

const fact = (value: "passed" | "failed" | "none") => (value === "none" ? null : value === "passed")

function read(document: Record<string, unknown>, field: string) {
  // Round 10 (J1): a step through a list reads the field of every row (`loot.item`: the item of each loot line).
  const value = field.split(".").reduce<unknown>((current, key) => (Array.isArray(current) ? current.map((row) => (typeof row === "object" && row !== null ? (row as Record<string, unknown>)[key] : undefined)) : typeof current === "object" && current !== null ? (current as Record<string, unknown>)[key] : undefined), document)
  return (Array.isArray(value) ? value : [value]).filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
}

/**
 * Everything the asset overview shows, for any project: plan entries, saved assets that no entry points
 * at, and content from before assets existed. All status and relationship rules live here, none in the UI.
 */
export function buildProjectOverview(input: OverviewInput) {
  const project = input.project
  const assets = project.workspace.assets
  const blueprint = project.blueprint
  const reviews = input.reviews ?? []
  const status = { blueprint, assets, build: input.build, verification: input.verification, reviews, requests: input.requests, restored: input.restored }
  const derived = deriveAssetStatus({ ...status, runs: input.runs })
  // The same answer with no run history: what an entry falls back to when a "failure" was not its own.
  const settled = deriveAssetStatus({ ...status, runs: [] })
  const production = blueprint?.state === "confirmed" ? productionState({ blueprint, assets, runs: input.runs, record: input.production }) : null
  const title = (key: string) => blueprint?.entries.find((entry) => entry.key === key)?.title ?? key
  const tasks = [...input.runs].sort((a, b) => a.created_at.localeCompare(b.created_at)).flatMap((run) => run.tasks)
  const lastOf = (list: typeof tasks, entry: { key: string; asset_id: string | null }) => list.filter((task) => task.source === blueprintSource(entry.key) || (entry.asset_id !== null && task.asset_id === entry.asset_id)).at(-1)
  // Tries that count for the plan as it stands: confirming it again is the person saying "try those once more".
  const since = blueprint && input.production?.blueprint_revision === blueprint.revision ? input.production.since : ""
  const counted = [...input.runs].filter((run) => run.created_at >= since).sort((a, b) => a.created_at.localeCompare(b.created_at)).flatMap((run) => run.tasks)
  // What an entry is held up behind right now: things it needs that are not made and whose own last try failed,
  // looked for through needs that were themselves only held up. One failed try is enough: the run that tried
  // says "blocked" about this entry from that moment, and the plan must not say "not started" about the same thing.
  const behind = (key: string, path: string[]): string[] =>
    (blueprint?.entries.find((entry) => entry.key === key)?.needs ?? []).flatMap((need) => {
      const needed = blueprint?.entries.find((entry) => entry.key === need)
      if (!needed || path.includes(need) || derived.entries[need]?.facts.saved) return []
      return derived.entries[need]?.status === "failed" && lastOf(counted, needed)?.state === "failed" ? [need] : behind(need, [...path, need])
    })

  const entryNodes = (blueprint?.entries ?? []).map((entry): Node => {
    const asset = assets.find((value) => value.id === entry.asset_id)
    const own = derived.entries[entry.key]!
    const last = lastOf(tasks, entry)
    // Held up for good (what it needs failed every allowed try), or held up by the last run (what it needs failed and has not been tried again).
    const by = production?.blocked.find((value) => value.key === entry.key)?.by ?? (own.status === "failed" && lastOf(counted, entry)?.state === "blocked" ? [...new Set(behind(entry.key, [entry.key]))] : [])
    return {
      id: entry.key,
      key: entry.key,
      asset_id: asset?.id ?? null,
      kind: entry.kind,
      title: entry.title,
      brief: entry.brief,
      document: asset?.document ?? null,
      dependencies: asset?.dependencies ?? [],
      owner: entry.owner,
      planned: entry.needs,
      out_of_scope: entry.out_of_scope,
      revision: asset?.revision ?? null,
      updated_at: asset?.updated_at ?? null,
      status: by.length
        ? { ...own, status: "blocked", reason: `要先做好${by.map((key) => `「${title(key)}」`).join("、")}，但它没有做成。` }
        : // A task that was cut off by a restart, or held up behind something that is being tried again, did not fail: the entry is simply still to do.
          own.status === "failed" && last?.state === "blocked"
          ? settled.entries[entry.key]!
          : own,
    }
  })
  // Content an entry is to change stands in the list as that entry until it is changed: listing the old one beside it showed two things of one name.
  const beingChanged = new Set((blueprint?.entries ?? []).flatMap((entry) => (entry.existing?.action === "change" && !entry.asset_id ? [entry.existing.id] : [])))
  const assetNodes = assets
    .filter((asset) => !entryNodes.some((node) => node.asset_id === asset.id) && !beingChanged.has(asset.id))
    .map((asset): Node => ({
      id: asset.id,
      key: null,
      asset_id: asset.id,
      kind: asset.module,
      title: asset.title,
      brief: asset.prompt,
      document: asset.document,
      dependencies: asset.dependencies,
      owner: null,
      planned: [],
      out_of_scope: null,
      revision: asset.revision,
      updated_at: asset.updated_at,
      status: derived.assets[asset.id]!,
    }))
  // Content saved before assets existed is in the build all the same. It has no revision of its own, so it
  // counts as built only while the project is exactly what the latest build was made from.
  const built = input.build?.revision === project.revision
  const legacy = (kind: ModuleKind, id: string, name: string, document: Record<string, unknown>, brief = "", lacking: string | null = null): Node => ({
    id: `${kind}:${id}`,
    key: null,
    asset_id: null,
    kind,
    title: name,
    brief,
    document,
    dependencies: [],
    owner: null,
    planned: [],
    out_of_scope: null,
    revision: null,
    updated_at: null,
    // Hand-made content is only as done as it is whole: a creature with no model cannot go into the mod, so it is not "saved", whatever the
    // content list holds. `lacking` says in plain words what is missing; the sidebar says the same thing as 「待建模」.
    status: lacking
      ? { status: "planned", reason: lacking, facts: { saved: false, built: false, gametest: "none", client: "none", accepted: null, asked: false } }
      : { status: built ? "built" : "saved", reason: null, facts: { saved: true, built, gametest: "none", client: "none", accepted: null, asked: false } },
  })
  const known = (id: string) => assets.some((asset) => asset.id === id)
  const nodes = [
    ...entryNodes,
    ...assetNodes,
    ...project.entities
      .filter((entity) => !assets.some((asset) => asset.document.kind === "entity" && asset.document.model_asset_id === entity.id))
      // A model made for a planned creature already brings a bare creature with it; the plan entry stands for that one.
      .filter((entity) => !entryNodes.some((node) => node.kind === "entity" && node.planned.some((key) => entryNodes.some((need) => need.key === key && need.asset_id === entity.id))))
      // A creature shares its id with its model, so the registry's model reference is read from that id.
      // A plan entry that is to change this creature stands for it until it is changed.
      .filter((entity) => !beingChanged.has(entity.id))
      .map((entity) => legacy("entity", entity.id, entity.name, { ...entity, model_asset_id: entity.model_asset_id ? entity.id : null }, entity.description, entity.model_asset_id ? null : `「${entity.name}」还没有模型：生物要先有模型，才能做进模组。`)),
    ...project.blocks.filter((value) => !known(value.id) && !beingChanged.has(value.id)).map((value) => legacy("block", value.id, value.name, value)),
    ...project.items.filter((value) => !known(value.id) && !beingChanged.has(value.id)).map((value) => legacy("item", value.id, value.name, value)),
    ...project.recipes.filter((value) => !known(value.id)).map((value) => legacy("recipe", value.id, value.name, value)),
    ...project.logic.filter((value) => !known(value.id)).map((value) => legacy("logic", value.id, assetKind("logic").label, value)),
  ]

  const byAsset = (id: string) => nodes.find((node) => node.asset_id === id)
  // One reference of one node, resolved to the nodes it points at; `lost` are the values that point at nothing.
  const resolve = (node: Node, reference: KindReference) => {
    if (!node.document) return { found: [] as Node[], lost: [] as string[] }
    if (reference.match === "dependency")
      return { found: node.dependencies.flatMap((id) => byAsset(id) ?? []).filter((target) => reference.kinds.includes(target.kind)), lost: [] }
    const values = read(node.document, reference.field)
    const targets = values.map((value) => {
      // A creature made by hand keeps its model inside itself: there is no model asset, so it stands for its own model.
      if (reference.match !== "identifier")
        return { value, target: byAsset(value) ?? nodes.find((candidate) => candidate.id === `entity:${value}`), ignore: false }
      const [namespace, name] = value.includes(":") ? value.split(":") : [project.mod_id, value]
      // Anything outside this mod, such as a vanilla item, is not ours to find.
      if (namespace !== project.mod_id) return { value, target: undefined, ignore: true }
      return { value, target: nodes.find((candidate) => reference.kinds.includes(candidate.kind) && candidate.document?.identifier === name), ignore: false }
    })
    return {
      found: targets.flatMap((entry) => entry.target ?? []).filter((target) => target !== node),
      lost: targets.filter((entry) => !entry.target && !entry.ignore).map((entry) => entry.value),
    }
  }
  const links = nodes.map((node) => {
    const references = assetKind(node.kind).references.map((reference) => ({ reference, ...resolve(node, reference) }))
    return {
      node,
      references,
      needs: [
        ...new Set([
          ...node.planned.filter((key) => nodes.some((candidate) => candidate.id === key)),
          ...references.flatMap((entry) => entry.found.map((target) => target.id)),
          ...node.dependencies.flatMap((id) => byAsset(id)?.id ?? []),
        ]),
      ].filter((id) => id !== node.id),
    }
  })
  const usedBy = (id: string) => links.filter((link) => link.needs.includes(id)).map((link) => link.node.id)
  const node = (id: string) => nodes.find((candidate) => candidate.id === id)!
  // The content an asset belongs to: what the plan says, else the content that uses it, else wherever a
  // "belongs" reference leads (a recipe to what it makes, a texture to its model and on to the creature).
  const ownerOf = (id: string, path: string[]): string | null => {
    const current = node(id)
    if (current.owner && nodes.some((candidate) => candidate.id === current.owner)) return current.owner
    if (assetKind(current.kind).owner) return null
    const user = usedBy(id).find((candidate) => assetKind(node(candidate).kind).owner)
    if (user) return user
    return (
      links
        .find((link) => link.node.id === id)!
        .references.filter((entry) => entry.reference.belongs)
        .flatMap((entry) => entry.found)
        .filter((target) => !path.includes(target.id))
        .map((target) => (assetKind(target.kind).owner ? target.id : ownerOf(target.id, [...path, id])))
        .find((value) => value !== null) ?? null
    )
  }
  // Kinds another kind can point at. Only those can be "unused": nothing ever points at a recipe. A kind that
  // is an end point by nature (gameplay code, a cast action) may be pointed at, but never has to be.
  const referable = new Set(ASSET_KINDS.flatMap((kind) => kind.references.flatMap((reference) => reference.kinds)).filter((kind) => !assetKind(kind).root))

  // The detail a model was made by: what its last task was told (the button the run started with, raised by the creature's tier: the same `detailFor` the maker and the reviewer read).
  // Said of that task and not of the button as it stands now, which may have been moved since; null for anything that is not a model, and for a task the button was not recorded for.
  const timeline = [...input.runs].sort((a, b) => a.created_at.localeCompare(b.created_at)).flatMap((run) => run.tasks.map((task) => ({ task, level: run.model_complexity ?? null })))
  const detailOf = (target: Node) => {
    if (target.kind !== "model") return null
    const made = timeline.filter(({ task }) => (target.key !== null && task.source === blueprintSource(target.key)) || (target.asset_id !== null && task.asset_id === target.asset_id)).at(-1)
    const level = made?.level ? detailFor(blueprint?.entries ?? [], blueprintSourceKey(made.task.source) ?? "", made.level) : null
    return level ? { level, label: MODEL_COMPLEXITY_PRESETS[level].label } : null
  }

  const verdict = (target: Node) => (target.asset_id && target.revision ? currentReview(reviews, { id: target.asset_id, revision: target.revision }) : null)
  // How the task that made the version on disk ended, when it was kept without a pass.
  const kept = (target: Node) => tasks.filter((task) => target.asset_id !== null && task.asset_id === target.asset_id && task.state === "completed" && (task.finished_at ?? "") >= (target.updated_at ?? "")).at(-1)?.outcome
  const said = (target: Node) => {
    const value = verdict(target)
    return value ? { verdict: value.verdict, note: value.note, at: value.at } : null
  }
  // The model an item is seen on: itself, the one it was painted or animated for, or the one its creature wears.
  const modelOf = (link: (typeof links)[number]) =>
    link.node.kind === "model" ? link.node : (link.references.filter((entry) => entry.reference.kinds.includes("model")).flatMap((entry) => entry.found)[0] ?? null)
  const pointers = (link: (typeof links)[number]) => {
    const model = modelOf(link)
    // A creature shares its id with its model, and the compiled shape is kept in a file under that id.
    const creature = [model?.asset_id, model?.id.split(":")[1], link.node.id.split(":")[1]].find((id) => project.entities.some((entity) => entity.id === id && entity.model_asset_id))
    return {
      source: link.node.asset_id ? ("asset" as const) : link.node.document ? ("content" as const) : null,
      model_asset_id: model?.asset_id ?? null,
      texture_asset_id:
        (link.node.kind === "texture" ? link.node.asset_id : null) ??
        link.references.flatMap((entry) => entry.found).find((target) => target.kind === "texture")?.asset_id ??
        assets.find((asset) => asset.module === "texture" && !!model?.asset_id && asset.dependencies.includes(model.asset_id))?.id ??
        null,
      entity_id: creature ?? null,
    }
  }

  const items = links.map((link) => ({
    /** Stable: the blueprint key if there is one, else the asset id, else `kind:id` for content saved before assets existed. */
    id: link.node.id,
    key: link.node.key,
    asset_id: link.node.asset_id,
    kind: link.node.kind,
    title: link.node.title,
    brief: link.node.brief,
    owner: ownerOf(link.node.id, []),
    status: link.node.status.status,
    status_label: link.node.status.queued ? QUEUED_LABEL : OVERVIEW_STATUS_LABELS[link.node.status.status],
    /**
     * Present when the status is "making" only because a task for it is queued: nothing has started on it. `waiting_for` names what it needs that is not
     * made yet (empty: it is next in line, or only waits for a free place). Production counts, 制作现场 and the cards keep this apart from what is being made.
     */
    ...(link.node.status.queued ? { queued: { waiting_for: link.node.planned.filter((key) => !derived.entries[key]?.facts.saved).map(title) } } : {}),
    reason: link.node.status.reason,
    facts: {
      saved: link.node.status.facts.saved,
      built: link.node.status.facts.built,
      gametest: fact(link.node.status.facts.gametest),
      client: fact(link.node.status.facts.client),
      accepted: link.node.status.facts.accepted,
    },
    /** The person is asked to look at it and say yes or no: an AI made this version for them. */
    review_asked: link.node.status.facts.asked,
    /**
     * The version that exists was kept although the AI that made it, or its reviewer, was not satisfied:
     * the loop ended without a pass and its best version was handed over for the person to judge. Present
     * (and true) until that version is changed or the person has said yes or no to it.
     */
    ...(!verdict(link.node) && kept(link.node) === "kept_unsatisfied" ? { ai_unsatisfied: true as const } : {}),
    /**
     * The version that exists was kept because its making was cut short (the app closed, the connection
     * broke): nobody judged it wanting, so it is never said as "AI 还不满意". Present under the same terms.
     */
    ...(!verdict(link.node) && kept(link.node) === "kept_interrupted" ? { ai_interrupted: true as const } : {}),
    /** What the person said about the revision that exists now; null when they have not judged it. */
    review: said(link.node),
    /** The 模型精细度 (低/中/高) a model's last task was made by, which the page shows only where it differs from the button at the top. Absent for anything else. */
    ...(detailOf(link.node) ? { detail: detailOf(link.node)! } : {}),
    /** Where the documents to draw this item from are found. Pointers only: no document travels here. */
    preview: pointers(link),
    needs: link.needs,
    used_by: usedBy(link.node.id),
    out_of_scope: link.node.out_of_scope,
    revision: link.node.revision,
  }))
  const made = items.filter((item) => item.status !== "out_of_scope")
  return {
    blueprint: blueprint
      ? { revision: blueprint.revision, state: blueprint.state, request: blueprint.request, style: blueprint.style, questions: blueprint.questions }
      : null,
    /**
     * Why the plan an AI last handed in was refused, and which requirement it is about. Beside `blueprint` and not inside it because a refused
     * plan is not stored: with nothing stored `blueprint` is null and the refusal is all there is to show where the plan should be.
     */
    plan_refusal: input.refusal ?? null,
    production: {
      running: input.producing || Boolean(production?.live),
      total: made.length,
      saved: made.filter((item) => item.facts.saved).length,
      built: made.filter((item) => item.facts.built).length,
      // Counted from the checks, not the label: a packed thing that still waits for the person's answer is labelled
      // "waiting for you", yet the game's own checks on it are just as recorded.
      verified: made.filter((item) => item.facts.built && [item.facts.gametest, item.facts.client].some((value) => value !== null) && [item.facts.gametest, item.facts.client].every((value) => value !== false)).length,
      /** Everything being made right now, first time or again: what a pack made at this moment would be out of date for as soon as it is saved. */
      making: made.filter((item) => item.status === "making").length,
      /** Of `making`, the ones nothing has started on yet: waiting for their turn or for what they need to be made first. `making - queued` is what is really being made. */
      queued: made.filter((item) => item.status === "making" && item.queued !== undefined).length,
      /** Of `queued`, the ones that already have a saved version (they wait to be made again). */
      queued_again: made.filter((item) => item.status === "making" && item.queued !== undefined && item.facts.saved).length,
      /**
       * Saved things that are being made again right now (the person sent them back, or an AI is changing them). Their
       * saved version is still on disk, so `saved` counts them, but they are not "done": a sentence like "everything is
       * made" has to leave them out.
       */
      remaking: made.filter((item) => item.facts.saved && item.status === "making").length,
      /**
       * Saved things whose version on disk was kept although the AI that made it, or its reviewer, was not satisfied (the loop ended without a
       * pass and handed its best version over). They are saved, but "made" would claim a pass nobody gave: a count of what is done leaves them
       * out and says them apart (broad19: a Boss that stopped after its sixth independent review was counted as 已做好 4 / 5). A thing being made
       * again is counted under `remaking` only, so the three sets never overlap.
       */
      unsatisfied: made.filter((item) => item.facts.saved && item.status !== "making" && item.ai_unsatisfied === true).length,
      /** Saved things kept because their making was cut short: no judgement of the work, but not a finished and passed one either. Disjoint from the two above. */
      interrupted: made.filter((item) => item.facts.saved && item.status !== "making" && item.ai_interrupted === true).length,
      /**
       * Saved things that are done in the sense every count of "已做好" means: saved, not being made again, and not a version that was kept without
       * passing its review. One number for the overview strip, the road's 制作 stage and the progress bar, so they cannot disagree.
       */
      done: made.filter((item) => item.facts.saved && item.status !== "making" && item.ai_unsatisfied !== true && item.ai_interrupted !== true).length,
      /** Saved things the person said yes to, as they are now. */
      accepted: made.filter((item) => item.facts.saved && item.facts.accepted === true).length,
      /** Saved things waiting for the person to look at them, packed into the mod or not: being packed is not an answer. */
      to_review: made.filter((item) => item.status === "review").length,
      /** Things the person said were not right and that have not been remade yet. */
      to_redo: made.filter((item) => item.status === "redo").length,
      failed: made.filter((item) => item.status === "failed").length,
      blocked: made.filter((item) => item.status === "blocked").length,
      /** Titles being made at this moment. */
      current: input.runs
        .filter((run) => ["planning", "running"].includes(run.state))
        .flatMap((run) => run.tasks.filter((task) => ["running", "validating", "saving"].includes(task.state)).map((task) => task.title)),
      /** Why production stopped by itself, if it did. */
      note: blueprint && input.production?.blueprint_revision === blueprint.revision ? input.production.note : null,
    },
    kinds: ASSET_KINDS.map((kind) => ({
      id: kind.id,
      label: kind.label,
      group: kind.group,
      glyph: kind.glyph,
      owner: kind.owner,
      capability: kindCapability(kind.id, project.target),
    })),
    items,
    problems: [
      ...links.flatMap((link) =>
        link.references.flatMap((entry) => [
          ...entry.lost.map((value) => ({
            item: link.node.id,
            kind: "missing_reference" as const,
            message: `「${link.node.title}」要用的${entry.reference.kinds.map((kind) => assetKind(kind).label).join("或")}（${value}）找不到了。`,
          })),
          ...(entry.reference.required && link.node.document && entry.reference.match !== "dependency" && !read(link.node.document, entry.reference.field).length
            ? [{ item: link.node.id, kind: "missing_reference" as const, message: `「${link.node.title}」还缺一个${entry.reference.kinds.map((kind) => assetKind(kind).label).join("或")}。` }]
            : []),
        ]),
      ),
      ...items
        .filter(
          (item) =>
            item.facts.saved && !assetKind(item.kind).owner && referable.has(item.kind) && kindCapability(item.kind, project.target) === "runtime" && !item.used_by.length,
        )
        .map((item) => ({ item: item.id, kind: "unused" as const, message: `「${item.title}」还没有被任何内容用到。` })),
      // Nothing is remade behind the person's back: what uses a remade thing is only pointed out, until it is
      // remade itself or the person says it still fits. Known from the verdict record and the assets' own save times.
      ...links.flatMap((link) =>
        link.needs
          .map((id) => node(id))
          .filter((target) => {
            const accepted = verdict(link.node)
            return (
              link.node.updated_at !== null &&
              target.updated_at !== null &&
              remadeSince(reviews, { id: target.asset_id!, revision: target.revision! }) &&
              target.updated_at > link.node.updated_at &&
              !(accepted?.verdict === "accepted" && accepted.at >= target.updated_at)
            )
          })
          .map((target) => ({ item: link.node.id, kind: "stale" as const, message: `「${link.node.title}」用到的「${target.title}」重做过，最好看看还合不合适。` })),
      ),
      ...items.filter((item) => item.status === "blocked").map((item) => ({ item: item.id, kind: "blocked" as const, message: `「${item.title}」${item.reason}` })),
    ],
  }
}
export type ProjectOverview = ReturnType<typeof buildProjectOverview>

/** What would be left pointing at nothing if this asset were deleted. `id` is an asset id or a content id. */
export function assetUsage<Item extends { id: string; asset_id: string | null; kind: ModuleKind; title: string; status: OverviewStatusId; used_by: string[] }>(
  overview: { items: Item[] },
  id: string,
) {
  const item = overview.items.find((value) => value.asset_id === id || value.id === id || value.id.endsWith(`:${id}`))
  if (!item) return null
  const users = item.used_by.map((user) => overview.items.find((value) => value.id === user)!)
  return {
    item: item.id,
    title: item.title,
    used_by: users.map((user) => ({ id: user.id, kind: user.kind, title: user.title, status: user.status })),
    message: users.length
      ? `「${item.title}」正在被 ${users.length} 项内容使用：${users.map((user) => `「${user.title}」`).join("、")}。删掉以后它们会缺少这一项。`
      : `没有其他内容在用「${item.title}」，可以放心删除。`,
  }
}
