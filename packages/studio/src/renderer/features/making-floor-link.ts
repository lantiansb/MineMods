import { createSignal } from "solid-js"
import "./making-floor-link.css"

/**
 * The way into 制作现场 from anywhere else: the overview card's 「制作过程」, the 动态 panel, any later page.
 * `openFloor` asks for the page (with an item: for that thing; with a round: for that round of its story;
 * with `at`, the time of the record that names the round, so a record from before a redo is not taken for a
 * round of the new making: see `recordRound`).
 * The app shell watches `floorAsked` and goes to the page; the floor reads `floorTarget` when it shows and
 * clears it, so a target is used once. Nothing is stored.
 */
export type FloorTarget = { item?: string; round?: number; at?: string }
const [target, setTarget] = createSignal<FloorTarget | null>(null)
const [asked, setAsked] = createSignal(0)
const [shown, setShown] = createSignal(false)

/** Counts up each time the floor is asked for. */
export const floorAsked = asked
export const floorTarget = target
export const clearFloorTarget = () => setTarget(null)
/** The floor is on screen, so a link to it would lead nowhere new. */
export const floorShown = shown
export const setFloorShown = setShown
export function openFloor(next: FloorTarget = {}) {
  setTarget(next)
  setAsked(asked() + 1)
}

/**
 * The way back the other direction: from 制作现场 to a thing's card on the overview, where its verdict is given (「去验收」). The app shell watches `cardAsked` and goes to
 * the overview; the overview reads `cardTarget` once it has its cards, opens that one, and clears it, so a target is used once. With no item the overview is just shown.
 */
export const ideasCard = Symbol("ideas")
const [cardItem, setCardItem] = createSignal<string | typeof ideasCard | null>(null)
const [cardCount, setCardCount] = createSignal(0)
export const cardTarget = cardItem
export const cardAsked = cardCount
export const clearCardTarget = () => setCardItem(null)
export function openCard(item?: string | typeof ideasCard) {
  setCardItem(item ?? null)
  setCardCount(cardCount() + 1)
}
