/** A missing choice follows the window width; an explicit choice survives resize and restart. */
export function shelfOpen(store: Pick<Storage, "getItem">, key: string, width: number, threshold: number) {
  const saved = store.getItem(key)
  return saved === "1" || (saved !== "0" && width >= threshold)
}
export function rememberShelf(store: Pick<Storage, "setItem">, key: string, open: boolean) {
  store.setItem(key, open ? "1" : "0")
  return open
}
export const SHELF_STORE = "minemods.navigation.open"
