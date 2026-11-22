// TEST FIXTURE ONLY: a machine. A wheel of spokes and paddles between two posts, turned by its axle.
// Shows repetition around a circle: one spoke is written once and the loop turns it into twelve.
const m = api.model({ name: "水车（脚本夹具）", texture_size: 128 })
const WOOD = { material: "wood", base: "#8b6a45", secondary: "#74552f" }
const PLANK = { material: "wood", base: "#b08a5a", secondary: "#9a7446" }
const IRON = { material: "metal", base: "#6f747a", secondary: "#565b61" }
const STONE = { material: "stone", base: "#8d8f8c", secondary: "#767875" }
const box = (bone, name, origin, size, look) => bone.cube(name, { origin, size, color: look.base, paint: look })

const base = m.bone("base", { pivot: [0, 0, 0] })
box(base, "slab", [-12, 0, -7], [24, 2, 25], STONE)
box(base, "trough", [-10, 2, -4], [20, 2, 8], STONE)
// Two posts, one each side of the wheel; the second is the mirror of the first.
const post = base.bone("post_r", { pivot: [9, 2, 0] })
box(post, "leg", [8, 2, -2], [3, 20, 4], WOOD)
box(post, "brace", [7, 2, -5], [4, 3, 10], WOOD)
box(post, "cap", [7, 20, -3], [5, 3, 6], IRON)
m.mirror("post_r", { from: "_r", to: "_l" })

const HUB = [0, 21, 0]
const axle = base.bone("axle", { pivot: HUB })
box(axle, "shaft", [-9, 20, -1], [18, 2, 2], IRON)
box(axle, "hub", [-3, 19, -2], [6, 4, 4], WOOD)
const SPOKES = 12
for (let i = 0; i < SPOKES; i++) {
  // Every spoke is written pointing straight up from the hub; its bone turns it to its place on the circle.
  const spoke = axle.bone("spoke_" + (i + 1), { pivot: HUB, rotation: [(360 / SPOKES) * i, 0, 0] })
  box(spoke, "arm", [-1, 23, -0.5], [2, 11, 1], WOOD)
  box(spoke, "paddle", [-5, 33, -2], [10, 1, 5], i % 2 ? PLANK : WOOD)
  box(spoke, "rim_r", [4, 30, -3], [1, 3, 7], IRON)
  box(spoke, "rim_l", [-5, 30, -3], [1, 3, 7], IRON)
}
const chute = base.bone("chute", { pivot: [0, 38, 12], rotation: [-14, 0, 0] })
box(chute, "bed", [-4, 37, 4], [8, 1, 14], PLANK)
box(chute, "side_r", [4, 37, 4], [1, 3, 14], WOOD)
box(chute, "side_l", [-5, 37, 4], [1, 3, 14], WOOD)
box(base, "chute_post", [-1, 2, 13], [2, 36, 2], WOOD)

// The wheel goes round once; walking and being hit are the wheel with a little more or less of that.
const turn = (a, laps) => a.sample("axle", (t) => [((t * 360 * laps + 180) % 360) - 180, 0, 0], 13)
turn(m.animation("idle", { length: 6, loop: true }), 1)
const walk = m.animation("walk", { length: 2, loop: true })
turn(walk, 1)
walk.sample("chute", (t) => [Math.sin(t * Math.PI * 2) * 2, 0, 0], 9)
const hurt = m.animation("hurt", { length: 0.4, loop: false })
hurt.keys("base", [[0, [0, 0, 0]], [0.08, [0, 0, 5]], [0.2, [0, 0, -3]], [0.4, [0, 0, 0]]])
hurt.keys("axle", [[0, [0, 0, 0]], [0.1, [-25, 0, 0]], [0.4, [0, 0, 0]]])
return m
