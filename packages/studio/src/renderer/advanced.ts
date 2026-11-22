import { createSignal } from "solid-js"

// 「高级」 is one switch for the whole app: ids, raw records and technical details show everywhere or nowhere,
// and the choice is still there after a restart.
export const ADVANCED_STORE = "minemods.advanced"

type Store = Pick<Storage, "getItem" | "setItem">
// Storage can be missing or refuse (a test without a window, a full or blocked profile): the switch then just starts off.
const browserStore = (): Store | undefined => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** Off unless the stored value says on; anything unreadable counts as off. */
export function readAdvanced(store: Store | undefined = browserStore()) {
  try {
    return store?.getItem(ADVANCED_STORE) === "1"
  } catch {
    return false
  }
}

export function writeAdvanced(value: boolean, store: Store | undefined = browserStore()) {
  try {
    store?.setItem(ADVANCED_STORE, value ? "1" : "0")
  } catch {
    // The switch still works for this run; it only is not remembered.
  }
}

const [advanced, set] = createSignal(readAdvanced())
export { advanced }

export function setAdvanced(value: boolean, store?: Store) {
  set(value)
  writeAdvanced(value, store)
}

/**
 * What the 高级 button says it does, for its tooltip (and its accessible description; its name stays the one word the
 * button shows). It states what turning it on adds, and that nothing of the mod changes: a person who pressed it in
 * the round-18 test could not tell what it was for and saw no change on the page.
 */
export const ADVANCED_TITLE = "高级：打开后，页面会多显示给懂技术的人看的内容，比如内部编号、原始记录、打包日志。只是多显示，不会改你的模组；再点一次就收起。想做的事都不需要它。"

/** Where the person is when the switch is on, so the line says what really appeared there rather than a general list. */
export type AdvancedPlace = "build" | "overview" | "editor" | "other"

/**
 * The line shown while 高级 is on: what has been added to the page in front of the person. Each place names only
 * what that place really adds (the places that read `advanced()` are found by searching for it), and the last sentence tells how to leave.
 */
export function advancedLine(place: AdvancedPlace) {
  const added = {
    build: "打包的日志原文和「开发环境试玩」",
    overview: "卡片和检查里的原始记录、颜色数值，还有制作记录里的细节",
    editor: "部件和字段的内部名字、原始数据",
    other: "内部编号、原始记录和技术细节",
  }[place]
  return `「高级」已打开：这里多显示了${added}。只是多显示，不改你的模组；再点一次「高级」就收起。`
}
