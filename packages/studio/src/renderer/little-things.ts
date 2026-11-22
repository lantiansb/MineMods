import { calm } from "./calm"
import { playSound } from "./sounds"

const CRACKING_MS = 140
const CRACKS = 6

/**
 * The little grass block in the title bar can be mined: held down it cracks, breaks, drops a block that bounces twice, and grows back. It changes nothing and counts nothing. A
 * plain press on the same button still goes home.
 */
export function createMining() {
  const held: { timer: number; mark: HTMLElement | null; mined: boolean } = { timer: 0, mark: null, mined: false }
  const letGo = () => {
    window.clearInterval(held.timer)
    held.mark?.style.removeProperty("--crack")
    held.mark = null
  }
  const breakBlock = (mark: HTMLElement) => {
    const place = mark.getBoundingClientRect()
    const drop = document.createElement("span")
    drop.className = "mined-drop"
    drop.style.left = `${place.left + place.width / 2 - 4}px`
    drop.style.top = `${place.top + place.height / 2 - 4}px`
    document.body.append(drop)
    mark.style.visibility = "hidden"
    playSound("thud")
    const falling = drop.animate(
      [
        { transform: "translateY(0)", easing: "ease-in" },
        { transform: "translateY(14px)", offset: 0.34, easing: "ease-out" },
        { transform: "translateY(6px)", offset: 0.52, easing: "ease-in" },
        { transform: "translateY(14px)", offset: 0.7, easing: "ease-out" },
        { transform: "translateY(11px)", offset: 0.8, easing: "ease-in" },
        { transform: "translateY(14px)" },
      ],
      { duration: 900, fill: "forwards" },
    )
    void falling.finished
      .catch(() => undefined)
      .then(() => {
        drop.remove()
        mark.style.removeProperty("visibility")
        mark.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], { duration: 260, easing: "steps(4)" })
      })
  }
  return {
    press(event: PointerEvent & { currentTarget: HTMLElement }) {
      held.mined = false
      const mark = event.target instanceof HTMLElement && event.target.classList.contains("brand-mark") ? event.target : null
      if (!mark || event.button !== 0 || calm() || mark.style.visibility === "hidden") return
      held.mark = mark
      let crack = 0
      held.timer = window.setInterval(() => {
        crack += 1
        if (crack < CRACKS) return mark.style.setProperty("--crack", String(crack))
        letGo()
        held.mined = true
        breakBlock(mark)
      }, CRACKING_MS)
    },
    release: letGo,
    /** Whether the press that just ended was spent on mining, not on going home. */
    spent() {
      const was = held.mined
      held.mined = false
      return was
    },
  }
}

/** Where an action's own control is on screen, read before the action can take it away. */
export const placeOfAction = () => {
  const element = document.activeElement
  const place = element instanceof HTMLElement && element !== document.body ? element.getBoundingClientRect() : null
  return place?.width ? place : new DOMRect(innerWidth / 2, innerHeight / 2, 0, 0)
}

/** A thing passed: a few orbs fly from the button to where progress is shown, which then moves as it always does. With less motion asked for, or nothing of it in sight, no orbs. */
export function flyOrbs(from: DOMRect, target: Element | null) {
  const to = target?.getBoundingClientRect()
  if (calm() || !to?.width || to.bottom < 0 || to.top > innerHeight) return
  const startX = from.left + from.width / 2
  const startY = from.top + from.height / 2
  const host = document.querySelector(".studio-root") ?? document.body
  for (let index = 0; index < 6; index++) {
    const orb = document.createElement("i")
    orb.className = "xp-orb"
    orb.style.left = `${startX - 4}px`
    orb.style.top = `${startY - 4}px`
    host.append(orb)
    const x = to.left + to.width * Math.min(0.9, 0.2 + index * 0.1) - startX
    const y = to.top + to.height / 2 - startY
    const flying = orb.animate(
      [
        { transform: "translate(0, 0)" },
        { transform: `translate(${x * 0.2 + (index - 2.5) * 18}px, ${Math.min(y, 0) * 0.3 - 44 - (index % 3) * 14}px)`, offset: 0.4 },
        { transform: `translate(${x}px, ${y}px) scale(0.5)` },
      ],
      { duration: 620 + index * 40, delay: index * 45, easing: "ease-in", fill: "both" },
    )
    void flying.finished.catch(() => undefined).then(() => orb.remove())
  }
}
