// TEST FIXTURE ONLY: a plant. A pot, a short stem, and fronds that arch outwards all round.
// Shows a curve cut into pieces, the same arc turned to eight directions, and seeded variation.
const m = api.model({ name: "盆栽蕨（脚本夹具）", texture_size: 128 })
const CLAY = { material: "stone", base: "#b5653c", secondary: "#9a5230" }
const SOIL = { material: "stone", base: "#4a3423", secondary: "#3b281a" }
const STEM = { material: "wood", base: "#5f7d3a", secondary: "#4d682e" }
const LEAF = { material: "leaf", base: "#4f9a45", secondary: "#3c7d36" }
const TIP = { material: "leaf", base: "#7fc060", secondary: "#69a94f" }
const box = (bone, name, origin, size, look) => bone.cube(name, { origin, size, color: look.base, paint: look })
const rel = (bone, at) => api.add(bone.pivot, at)
const r = api.random("fern")

const pot = m.bone("pot", { pivot: [0, 0, 0] })
box(pot, "foot", [-4, 0, -4], [8, 1, 8], CLAY)
box(pot, "wall", [-5, 1, -5], [10, 7, 10], CLAY)
box(pot, "lip", [-6, 8, -6], [12, 2, 12], CLAY)
box(pot, "soil", [-5, 9.5, -5], [10, 1, 10], SOIL)
const crown = pot.bone("crown", { pivot: [0, 10, 0] })
box(crown, "stem", [-1.5, 10, -1.5], [3, 5, 3], STEM)

const FRONDS = 8
const fronds = []
for (let i = 0; i < FRONDS; i++) {
  const turn = (360 / FRONDS) * i + r.between(-8, 8)
  const reach = r.whole(13, 18)
  const rise = r.whole(9, 14)
  // One arc, written in a single plane, then turned about the stem to where this frond grows.
  const arc = api.curve([[0, 14, 0], [0, 14 + rise, -reach * 0.35], [0, 14 + rise * 0.8, -reach * 0.75], [0, 14 + rise * 0.2, -reach]], 4)
  const line = arc.map((point) => api.rotate(point, [0, 14, 0], [0, turn, 0]))
  const pieces = m.chain("frond_" + (i + 1), { parent: "crown", points: line, sizes: [[2, 2], [2, 1], [1, 1], [1, 1]], along: "z-", color: STEM.base, paint: STEM })
  pieces.forEach((piece, k) => {
    const long = Math.max(2, Math.round(api.length(api.sub(line[k + 1], line[k]))))
    const wide = [7, 9, 7, 4][k]
    box(piece, "blade", rel(piece, [-wide / 2, 0.5, -long]), [wide, 1, long], k === 3 ? TIP : LEAF)
  })
  fronds.push(pieces)
}

const sway = (a, size) => fronds.forEach((pieces, i) => pieces.forEach((piece, k) => a.sample(piece, (t) => [Math.sin(t * Math.PI * 2 + i * 0.8 - k * 0.5) * size * (k + 1), 0, 0], 9)))
sway(m.animation("idle", { length: 4, loop: true }), 1.2)
const walk = m.animation("walk", { length: 1.6, loop: true })
sway(walk, 2.2)
walk.sample("pot", (t) => [0, 0, Math.sin(t * Math.PI * 2) * 3], 9)
const hurt = m.animation("hurt", { length: 0.5, loop: false })
hurt.keys("pot", [[0, [0, 0, 0]], [0.08, [8, 0, 0]], [0.25, [-4, 0, 0]], [0.5, [0, 0, 0]]])
fronds.forEach((pieces) => hurt.keys(pieces[0], [[0, [0, 0, 0]], [0.12, [-14, 0, 0]], [0.5, [0, 0, 0]]]))
return m
