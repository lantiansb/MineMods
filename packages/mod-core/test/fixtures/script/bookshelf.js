// TEST FIXTURE ONLY: furniture. A case of shelves filled with books, every book a little different.
// Shows rows and columns from loops, seeded variation, and faces drawn pixel by pixel on a canvas.
const m = api.model({ name: "书架（脚本夹具）", texture_size: 128 })
const WOOD = { material: "wood", base: "#7a5632", secondary: "#644526" }
const BACK = { material: "wood", base: "#4d3520", secondary: "#412c1a" }
const BRASS = { material: "metal", base: "#c9a544", secondary: "#a88733" }
const box = (bone, name, origin, size, look) => bone.cube(name, { origin, size, color: look.base, paint: look })
const r = api.random("shelf")

const WIDE = 28
const DEEP = 8
const ROWS = 4
const ROW = 9
const frame = m.bone("frame", { pivot: [0, 0, 0] })
box(frame, "plinth", [-WIDE / 2 - 1, 0, -DEEP / 2 - 1], [WIDE + 2, 2, DEEP + 2], WOOD)
box(frame, "side_r", [WIDE / 2 - 2, 2, -DEEP / 2], [2, ROWS * ROW + 1, DEEP], WOOD)
box(frame, "side_l", [-WIDE / 2, 2, -DEEP / 2], [2, ROWS * ROW + 1, DEEP], WOOD)
box(frame, "back", [-WIDE / 2 + 2, 2, DEEP / 2 - 1], [WIDE - 4, ROWS * ROW + 1, 1], BACK)
box(frame, "cornice", [-WIDE / 2 - 1, 2 + ROWS * ROW + 1, -DEEP / 2 - 1], [WIDE + 2, 2, DEEP + 2], WOOD)
for (let row = 0; row <= ROWS; row++) box(frame, "board_" + (row + 1), [-WIDE / 2 + 2, 2 + row * ROW, -DEEP / 2], [WIDE - 4, 1, DEEP - 1], WOOD)

const COVERS = ["#8c2f2a", "#2f5d8c", "#3d7a46", "#7a4a8c", "#c08a2e", "#3a3a44", "#a8562a", "#2e7f86"]
// The spine of one book: its cover colour, a band or two across it, and a lighter edge.
const spine = (wide, tall, cover) => {
  const c = api.canvas(wide, tall, cover)
  c.rect(0, 0, 1, tall, api.shade(cover, -0.25))
  const band = r.pick(["#e8d9a0", "#d8d8d8", api.shade(cover, 0.45)])
  c.rect(0, r.whole(1, 2), wide, 1, band)
  if (tall > 6) c.rect(0, tall - r.whole(2, 3), wide, 1, band)
  if (wide > 2 && tall > 5) c.rect(1, Math.floor(tall / 2) - 1, wide - 2, 2, api.mix(cover, band, 0.6))
  return c
}
const rows = []
for (let row = 0; row < ROWS; row++) {
  const shelf = frame.bone("row_" + (row + 1), { pivot: [0, 3 + row * ROW, 0] })
  const walk = { x: -WIDE / 2 + 2, book: 0 }
  while (walk.x < WIDE / 2 - 4) {
    const wide = r.whole(2, 3)
    const tall = r.whole(5, 7)
    const cover = r.pick(COVERS)
    walk.book += 1
    // Now and then a gap, or a book lying on its side, so the row does not read as a stripe pattern.
    if (r() < 0.12 && walk.x < WIDE / 2 - 9) {
      shelf.cube("flat_" + walk.book, { origin: [walk.x, 3 + row * ROW, -DEEP / 2 + 1], size: [6, 2, 5], faces: api.lit(cover, 0.1), draw: { north: api.canvas(6, 2, cover).rect(0, 0, 6, 1, api.shade(cover, 0.3)) } })
      walk.x += 7
      continue
    }
    shelf.cube("book_" + walk.book, { origin: [walk.x, 3 + row * ROW, -DEEP / 2 + 1], size: [wide, tall, 5], faces: { ...api.lit(cover, 0.1), up: "#efe6cf" }, draw: { north: spine(wide, tall, cover) } })
    walk.x += wide
  }
  rows.push(shelf)
}
const lamp = frame.bone("lamp", { pivot: [0, 2 + ROWS * ROW + 3, 0] })
box(lamp, "stand", [-1, 2 + ROWS * ROW + 3, -1], [2, 2, 2], BRASS)
lamp.cube("glow", { origin: [-2, 2 + ROWS * ROW + 5, -2], size: [4, 4, 4], faces: api.lit("#ffd97a", 0.2) })

const idle = m.animation("idle", { length: 3, loop: true })
idle.sample("lamp", (t) => [0, 0, Math.sin(t * Math.PI * 2) * 3], 9)
const walk = m.animation("walk", { length: 1, loop: true })
walk.sample("frame", (t) => [0, 0, Math.sin(t * Math.PI * 2) * 2], 9)
rows.forEach((shelf, i) => walk.sample(shelf, (t) => [Math.sin(t * Math.PI * 2 + i) * 1.5, 0, 0], 9))
const hurt = m.animation("hurt", { length: 0.4, loop: false })
hurt.keys("frame", [[0, [0, 0, 0]], [0.08, [-6, 0, 0]], [0.2, [3, 0, 0]], [0.4, [0, 0, 0]]])
rows.forEach((shelf) => hurt.keys(shelf, [[0, [0, 0, 0]], [0.12, [5, 0, 0]], [0.4, [0, 0, 0]]]))
return m
