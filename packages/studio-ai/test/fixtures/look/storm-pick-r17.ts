/**
 * The 16×16 icon the owner asked about on 10-07: 「这个风暴镐是如何通过筛查的，太离谱了」. It had passed every measure
 * (colour count, flat area, the comparison with the game's thirty tool icons) and a review. Read back pixel by
 * pixel from his screenshot of the item page (the cyan behind it there was the page's, not the picture's): a grey
 * head that curves round to one side on a slanted brown handle. Shown alone it reads as a hook or a sickle.
 * Kept as the regression case for blind naming; it is the project's own picture and holds nothing of the game's.
 */
export const STORM_PICK_COLOURS = { a: "#25313b", b: "#4c5f6d", c: "#758e9e", d: "#adbcc7", w: "#8b6c45", l: "#bba16b" } as const

export const STORM_PICK_ROWS = [
  "................",
  "................",
  "....abcdab......",
  "...aabcdabab....",
  "..babc..bcdbca..",
  "..babc.....bca..",
  "..ba.......bca..",
  "............ca..",
  "...........www..",
  "..........www...",
  ".........lll....",
  "........lll.....",
  ".......www......",
  "......www.......",
  "................",
  "................",
] as const

/** The icon as raw pixels (red, green, blue, alpha), empty where a row has a dot. */
export function stormPick() {
  const pixels = new Uint8Array(16 * 16 * 4)
  STORM_PICK_ROWS.forEach((row, y) =>
    [...row].forEach((cell, x) => {
      const colour = STORM_PICK_COLOURS[cell as keyof typeof STORM_PICK_COLOURS]
      if (colour) pixels.set([Number.parseInt(colour.slice(1, 3), 16), Number.parseInt(colour.slice(3, 5), 16), Number.parseInt(colour.slice(5, 7), 16), 255], (y * 16 + x) * 4)
    }),
  )
  return { width: 16, height: 16, pixels }
}
