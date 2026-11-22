import type { Component } from "solid-js"
import type { Project } from "@minemods/mod-core/project"
import type { ModuleKind } from "@minemods/mod-core/workspace"
import type { Making, OverviewItem } from "../../api"
import { GameplayCard } from "./asset-gameplay"
import { EnglishNameCard } from "./english-name"

/**
 * Where another feature adds its own block to the acceptance card without touching the card itself.
 *
 * To add one: write a component that takes `CardPartProps`, and add ONE line to `CARD_PARTS` below with the
 * kind it is for ("any" for every kind) and where it goes:
 *   - "info": in the right-hand column of the card, after the making teaser and before 「现在做出来的是」;
 *   - "look": under the picture on the left.
 * The card renders the parts of a kind in the order they are listed. A part decides for itself whether it
 * has anything to show (return nothing when it has not). It must not assume a size: the column is as
 * narrow as 420 px on a 1280-wide window.
 */
export type CardPartProps = {
  projectId: string
  /** The project as the app holds it; saved documents are read from here. */
  project: Project
  item: OverviewItem
  /** How it was or is being made by looking, when there is such a record. */
  making: Making | undefined
  /** 高级 is on. */
  advanced: boolean
  /** Open another thing's card on top of this one. */
  onOpen: (itemId: string) => void
  /** A finding's button brought the person to this field of this card: the part that has the field shows and focuses it. `nonce` changes on every press, so pressing again re-focuses. */
  focus?: { itemId: string; field: string; nonce: number } | null
  /** The part saved something in the project: the app reads it again. */
  changed?: () => void
}
export type CardPart = { kind: ModuleKind | "any"; where: "info" | "look"; part: Component<CardPartProps> }

export const CARD_PARTS: CardPart[] = [
  // Gameplay (Engineer D): what the code does in plain words, the four checks, how to try it, and the source under 高级.
  { kind: "gameplay", where: "info", part: GameplayCard },
  // Round 19: a block, an item or a creature carries its English name on its own card, in the open. A hint to fill it (the check after a build) had no place to point at.
  { kind: "block", where: "info", part: EnglishNameCard },
  { kind: "item", where: "info", part: EnglishNameCard },
  { kind: "entity", where: "info", part: EnglishNameCard },
]

/** The parts to draw for one kind of thing, in one place of the card. */
export const cardParts = (kind: string, where: CardPart["where"]) => CARD_PARTS.filter((value) => value.where === where && (value.kind === "any" || value.kind === kind))
