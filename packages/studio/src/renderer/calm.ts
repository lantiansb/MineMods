/**
 * Whether the person asked for less motion, in either place they can: 「减少动效」 in Studio's own settings or the system's. Everything that moves by script asks here;
 * what moves by CSS is covered by the `.reduce-motion` class and the media query.
 */
const asked = { setting: false }
const system = typeof window === "undefined" ? null : window.matchMedia("(prefers-reduced-motion: reduce)")

export const setCalmSetting = (on: boolean) => {
  asked.setting = on
}
export const calm = () => asked.setting || !!system?.matches
