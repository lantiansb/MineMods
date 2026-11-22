/**
 * The picture of a gameplay in a slot and on its card. Code has no look of its own, so it gets a sign drawn
 * here, pixel by pixel: a small machine block with a lit screen that shows how many behaviours it has.
 * Our own drawing on a 16 × 16 grid, enlarged as pixel art like any item; no game art is used.
 */
const DIGITS = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001010010010", "111101111101111", "111101111001111"]
// Rows of the block without its screen: frame, lit edge, shaded edge, body, rivets.
const BODY = [
  "0000000000000000",
  "0122222222222230",
  "0125444444445230",
  "0240000000000430",
  "0240000000000430",
  "0240000000000430",
  "0240000000000430",
  "0240000000000430",
  "0240000000000430",
  "0240000000000430",
  "0240000000000430",
  "0240000000000430",
  "0125444444445330",
  "0124466446644330",
  "0133333333333330",
  "0000000000000000",
]
const COLOURS: Record<string, string> = { "0": "#1b1d26", "1": "#8f9bb8", "2": "#77829f", "3": "#3f4760", "4": "#5a6482", "5": "#c9d2e6", "6": "#2b3145" }
const SCREEN = "#10131c"
const LIT = "#7df0c2"
const DIM = "#2f7f6a"

const made = new Map<number, string | null>()

/** The sign as a PNG data URL, or null where nothing can be drawn. `count` is the number of behaviours. */
export function gameplaySign(count: number) {
  if (made.has(count)) return made.get(count)!
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 16
  const context = canvas.getContext("2d")
  if (!context) return null
  const dot = (x: number, y: number, colour: string) => {
    context.fillStyle = colour
    context.fillRect(x, y, 1, 1)
  }
  BODY.forEach((row, y) => [...row].forEach((cell, x) => dot(x, y, y > 2 && y < 12 && x > 2 && x < 13 ? SCREEN : COLOURS[cell]!)))
  const digits = [...String(Math.min(count, 99))].map(Number)
  // One digit leaves room for a prompt mark before it; two fill the screen by themselves.
  if (digits.length === 1) [[4, 5], [5, 6], [6, 7], [5, 8], [4, 9]].forEach(([x, y]) => dot(x!, y!, DIM))
  digits.forEach((digit, place) =>
    [...DIGITS[digit]!].forEach((cell, index) => cell === "1" && dot((digits.length === 1 ? 9 : 4 + place * 5) + (index % 3), 5 + Math.floor(index / 3), LIT)),
  )
  made.set(count, canvas.toDataURL("image/png"))
  return made.get(count)!
}
