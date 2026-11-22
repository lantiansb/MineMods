import { designNote, kindCapability, type ModuleKind } from "@minemods/mod-core/workspace-modules"
import type { TargetId } from "@minemods/mod-core/target/ids"
import type { Conception } from "@minemods/mod-core/conception"
import { BLANK_KINDS } from "./asset-edit-words"

export const nonemptyGroups = <T,>(groups: readonly T[], rows: (group: T) => readonly unknown[], always: (group: T) => boolean = () => false) => groups.filter((group) => rows(group).length > 0 || always(group))

/**
 * How many empty slots a category of the left column draws after its things. Pure, so it can be checked without a screen.
 *
 * Round 18: every category drew three empty slots even with nothing in it, and at 720 px of height the last
 * categories had to be scrolled to. A category with nothing in it is its header row alone. One with things
 * shows them and, where a thing can be added, one empty slot as the place to add the next: only when the last
 * row has room for it, so the slot never costs a row of its own (the header's 「＋」 adds all the same).
 */
export function spareSlots(count: number, columns: number, canAdd: boolean) {
  return count > 0 && canAdd && count % columns !== 0 ? 1 : 0
}

/**
 * Whether a category of the left column offers 「＋」. With Studio's own AI every kind has a way to begin. With an
 * outside AI a sentence goes through the overview, so the only way to begin from a kind's own page is the empty
 * form, and only the kinds that have one are offered: a real run hid 「＋」 on all of them, which left a person
 * connected to an outside AI no way to make a block, an item or a recipe by hand.
 */
export function canAdd(create: string, external: boolean) {
  return !external || (BLANK_KINDS as readonly string[]).includes(create)
}

/**
 * The chip beside a saved asset in the left column. An asset's saved `status` is set once, by its kind, at the first save: a texture or a boss bar
 * says "design" there even after a creature wears it and the build compiles it (the UI run of 2026-11-15 showed 「设计稿」 on a texture a creature
 * used). So the chip is read from the kind on the project's target and from what uses it (the overview's `used_by`): 「设计稿」 only for a kind no
 * build of this target makes, 「待用上」 for one that reaches the game once something uses it and nothing does yet, nothing otherwise.
 */
export function assetChip(asset: { id: string; module: ModuleKind; status: string }, usedBy: ((id: string) => readonly unknown[] | null) | null, target: TargetId) {
  if (asset.module === "music") return "可用作 Boss 战斗音乐"
  if (kindCapability(asset.module, target) === "design") return "设计稿"
  if (asset.status !== "design") return ""
  const users = usedBy?.(asset.id)
  return users && users.length ? "" : "待用上"
}

/**
 * What uses a saved asset, from the overview: its items are keyed by their node (`texture:<id>`, or a plan entry's key), and the asset's own id is their
 * `asset_id` (the first chip looked an asset up by `id` and never found one, so every texture read 「待用上」: the UI run of 2026-11-15, second round).
 */
export function usersOf(overview: { items: readonly { asset_id: string | null; used_by: readonly unknown[] }[] } | null, assetId: string) {
  return overview?.items.find((item) => item.asset_id === assetId)?.used_by ?? null
}

/** The sentence for a category whose every kind is a design draft no build of the project's target compiles; null as soon as one of its kinds reaches the game. */
export function categoryDesignNote(kinds: readonly ModuleKind[], target: TargetId) {
  const notes = kinds.map((kind) => designNote(kind, target))
  return notes.length && notes.every(Boolean) ? notes[0]! : null
}

/**
 * Whether a project holds anything written on the older 「模组构想」 route. That route (a world brief an AI sorts
 * into entries, then a brief per entry) produces design text no build compiles, so it is offered only to a
 * project that already has something there, where hiding it would make saved work unreachable.
 *
 * A creature's own entry does not count by existing: confirming a creature's model stores one as a bookmark (opening
 * its model page no longer does, see `storesOnOpen`). It counts once it carries what only the old route writes
 * (an AI's sorting, a behaviour brief).
 */
export function legacyConception(conception: Pick<Conception, "brief" | "plan" | "review" | "entries">) {
  return (
    !!conception.brief.trim() ||
    !!conception.plan.trim() ||
    !!conception.review ||
    conception.entries.some((entry) => entry.kind !== "entity" || !!entry.review || !!entry.behavior_brief.trim() || !!entry.behavior_review)
  )
}

/**
 * Whether opening an entry has to store it in the project first. Only the entry and behaviour pages edit a stored entry. A creature's model
 * page just looks at the creature, and storing a bookmark there saved the project: its revision rose with nothing changed by the person, every
 * pack of it went stale ("the project changed after packing") and content built only "as the project is now" fell back from 已做进模组
 * (broad16 b37–b42). Confirming the model stores the entry, which is a change the person made.
 */
export function storesOnOpen(entry: { kind: string; entity_id: string | null }) {
  return !(entry.kind === "entity" && !!entry.entity_id)
}

/** What to tell an outside AI to add a kind that cannot be filled in here (P1-C2): a sentence ready to copy, with whatever the person adds. */
export function mcpAddSentence(project: string, kind: string, wish: string) {
  return `在『${project}』里加一个${kind}：${wish.trim()}`
}
