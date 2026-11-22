import type { BlueprintDraft } from "./blueprint"
import type { Project } from "./project"
import { legacyThings } from "./legacy-content"
import { assetKind, type ModuleKind } from "./workspace-modules"

/**
 * A plan names things to make, and the project may already hold things of the same name. Asked to "turn the example creature into a
 * moth", an AI added a new creature with the old one's name and left the old one standing: the plan had no way to say "this entry is
 * that one", and nothing asked. An entry now says what it is to existing content (`existing`, see `ExistingRefSchema`), and a new
 * entry that shares the name of existing content, or whose words describe changing it, is refused until it says.
 */

/** `hand`: made by the person in the window and not by a plan, so it has no workspace asset (see `legacy-content.ts`); `note` says what changing it means. */
export type ExistingThing = { id: string; kind: ModuleKind; title: string; hand?: true; note?: string }

const HAND_NOTES = {
  creature_bare: "用户手动做的生物，还没有模型。改它：写一个模型条目（给这个生物做模型）和这个生物自己的条目，生物条目写 existing，模型会做在这个生物上，不会多出第二只。",
  creature: "用户手动做的生物，已经有模型。改它：写一个模型条目和这个生物自己的条目，生物条目写 existing，模型是在现在这个模型上改的，不会多出第二只。",
  thing: "用户手动做的，不是计划做出来的。改它就写 existing，会在它现在的样子上改。",
} as const

/**
 * The content a plan can change: what is saved in the workspace, by the id it is addressed with everywhere else, and what the person made
 * by hand in the window (a creature, a block, an item), by the id the project holds it under. Hand-made content used to be left out, so a
 * plan could neither point at "the deer I made" nor be stopped from making a second deer of the same name.
 */
export function existingThings(project: Pick<Project, "workspace"> & Partial<Pick<Project, "entities" | "blocks" | "items">>): ExistingThing[] {
  return [
    ...project.workspace.assets.map((asset) => ({ id: asset.id, kind: asset.module, title: asset.title })),
    ...legacyThings(project).map((thing): ExistingThing => ({ id: thing.id, kind: thing.kind, title: thing.title, hand: true, note: thing.kind === "entity" ? (thing.modelled ? HAND_NOTES.creature : HAND_NOTES.creature_bare) : HAND_NOTES.thing })),
  ]
}

// Spacing, case and punctuation are not part of a name: 「苔灯蛾」 and 「苔灯 蛾。」 are one name to the person.
const bare = (text: string) => text.toLowerCase().replace(/[\s"'“”‘’「」『』.,，。:：;；!！?？、()（）-]/g, "")

// A brief that says one of these about existing content is changing it. The words are those a person uses to turn one thing into another;
// the list is the reason a refusal can say "reads like a change" instead of guessing from the name alone.
const CHANGING = /改成|改为|改作|变成|变为|换成|换作|替换|取代|代替|改造|重做|重新做|修改|改一改|改一下|升级成|转成|turn\s+\w+\s+into|change\s+\w+\s+(?:to|into)|replace/i

// A name this short ("石头") is in too many briefs to say anything about which one is meant, so only names of at least this many characters are looked for inside a brief.
const NAME_FLOOR = 3

export const EXISTING_REFUSALS = {
  /** An entry says it changes something that is not there, or is not the same kind. */
  missing: (title: string, id: string) => `「${title}」写着要改工程里已有的内容（${id}），但是找不到这一样，或者它和这个条目不是同一种东西。get_blueprint 返回的 existing 里列着现有的内容和它们的 id，种类要和条目一致。`,
  /** A separate thing was declared without saying how it differs. */
  unexplained: (title: string) => `「${title}」声明自己是另一样东西（existing.action 是 separate），却没有写 existing.why：请用一句话说清它和已有的那一样哪里不同。`,
  /** A model entry points at a hand-made creature: the creature's own entry carries `existing`, and its model follows it. */
  creatureModel: (title: string, creature: string) => `「${title}」是模型条目，不能写 existing 去指「${creature}」：那是用户手动做的生物。要给它做（或重做）模型，existing 写在这个生物自己的条目上（种类是 entity），它需要的模型条目照常写，不用写 existing，做出来的模型会挂在这个生物上。`,
  /** The entry is already made, and now points at other content to change. */
  made: (title: string) => `「${title}」已经做好了，不能再改成去改另一样已有的内容。要改它自己，直接在蓝图里改它的说明再让用户确认。`,
  /** Two entries of this plan change one thing. Caught in `validateBlueprint` too; here it is said with names. */
  shared: (title: string, other: string) => `「${title}」和「${other}」都要改同一样已有的内容，一样内容只能由一个条目来改。`,
  /** Same name as content already there, or described as a change to it, and the entry did not say what it is. */
  clash: (title: string, thing: ExistingThing, why: "name" | "described") =>
    `${why === "name" ? `「${title}」和工程里已有的${assetKind(thing.kind).label}「${thing.title}」同名` : `「${title}」的说明写着要改工程里已有的${assetKind(thing.kind).label}「${thing.title}」`}（${thing.id}），所以没有保存：这样会多出第二样同名的东西，旧的还留着。` +
    `要改的就是那一样：在这个条目里写 existing: { id: "${thing.id}", action: "change" }（key 自己起，种类要和它一致），Studio 会在它现在的样子上改。` +
    `确实是另一样不同的东西：写 existing: { id: "${thing.id}", action: "separate", why: "它和已有的那一样哪里不同" }，或者换一个名字。`,
} as const

/** Whether the asset made for an entry is the creature `id` itself: the rules asset of a creature names its model, and a creature shares its id with its model. */
const stands = (project: Pick<Project, "workspace">, assetId: string, id: string) =>
  project.workspace.assets.some((asset) => asset.id === assetId && asset.module === "entity" && asset.document?.kind === "entity" && asset.document.model_asset_id === id)

/**
 * Why this plan may not be stored because of what it does to existing content, in words for the person and the AI; null when it may.
 * An entry that is already made (it keeps its key and kind, so it keeps its asset) is the existing thing itself and is never compared with it.
 */
export function existingRefusal(project: Pick<Project, "workspace" | "blueprint"> & Partial<Pick<Project, "entities" | "blocks" | "items">>, plan: Pick<BlueprintDraft, "entries">): string | null {
  const things = existingThings(project)
  const own = (key: string, kind: ModuleKind) => project.blueprint?.entries.find((value) => value.key === key && value.kind === kind)?.asset_id ?? null
  const changing = new Map<string, string>()
  for (const entry of plan.entries) {
    if (entry.out_of_scope) continue
    const made = own(entry.key, entry.kind)
    const ref = entry.existing
    if (ref?.action === "change") {
      const target = things.find((thing) => thing.id === ref.id)
      // A hand-made creature is spoken for once its rules are made (the entry's own asset stands for it from then on): the entry still says what it changed.
      const settled = made !== null && made !== ref.id && stands(project, made, ref.id)
      if (!settled) {
        if (target?.hand && target.kind === "entity" && entry.kind === "model") return EXISTING_REFUSALS.creatureModel(entry.title, target.title)
        if (!target || target.kind !== entry.kind) return EXISTING_REFUSALS.missing(entry.title, ref.id)
        if (made && made !== ref.id) return EXISTING_REFUSALS.made(entry.title)
      }
      const other = changing.get(ref.id)
      if (other) return EXISTING_REFUSALS.shared(entry.title, other)
      changing.set(ref.id, entry.title)
    }
    if (ref?.action === "separate") {
      if (!things.some((thing) => thing.id === ref.id)) return EXISTING_REFUSALS.missing(entry.title, ref.id)
      if (!ref.why) return EXISTING_REFUSALS.unexplained(entry.title)
    }
  }
  for (const entry of plan.entries) {
    if (entry.out_of_scope || own(entry.key, entry.kind)) continue
    const settled = entry.existing
    const name = bare(entry.title)
    const brief = bare(entry.brief)
    for (const thing of things) {
      // What the entry already says about this thing is settled; only what it says nothing about is asked.
      if (settled?.id === thing.id) continue
      // Content that another entry of the plan is to change is that entry's, not a second thing.
      if (changing.has(thing.id)) continue
      if (thing.kind !== entry.kind) continue
      const title = bare(thing.title)
      if (!title) continue
      if (title === name) return EXISTING_REFUSALS.clash(entry.title, thing, "name")
      if (title.length >= NAME_FLOOR && brief.includes(title) && CHANGING.test(entry.brief)) return EXISTING_REFUSALS.clash(entry.title, thing, "described")
    }
  }
  return null
}
