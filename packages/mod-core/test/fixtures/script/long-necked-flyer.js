// TEST FIXTURE ONLY. It shows that the script medium scales to a large articulated thing; it is not shipped
// to any AI and is not a template. Everything below is ordinary use of the general API: every size,
// position, colour and angle is a number this file gives.
const m = api.model({ name: "长颈翼龙（脚本夹具）", texture_size: 256 })

const HIDE = { material: "scales", base: "#3d6a4c", secondary: "#2c5139" }
const DARK = { material: "scales", base: "#2a4a37", secondary: "#1f3a2b" }
const UNDER = { material: "scales", base: "#cdb67c", secondary: "#b59b5e" }
const HORN = { material: "bone", base: "#e9dfc6", secondary: "#cfc2a0" }
const WEB = { material: "skin", base: "#9a4433", secondary: "#b5573f" }
const box = (bone, name, origin, size, look) => bone.cube(name, { origin, size, color: (look || HIDE).base, paint: look || HIDE })
// Offsets from a bone's own joint: for a bone that stands straight, these are offsets in the world too.
const rel = (bone, at) => api.add(bone.pivot, at)
// Which way the angles turn is asked of the medium itself, so nothing here depends on remembering a sign.
const up = api.rotate([1, 0, 0], [0, 0, 0], [0, 0, 10])[1] > 0 ? 1 : -1
const back = api.rotate([1, 0, 0], [0, 0, 0], [0, 10, 0])[2] > 0 ? 1 : -1
const nose_down = api.rotate([0, 0, -1], [0, 0, 0], [10, 0, 0])[1] < 0 ? 1 : -1
const tail_down = -nose_down

const root = m.bone("root", { pivot: [0, 0, 0] })
const body = root.bone("body", { pivot: [0, 17, 1] })
box(body, "chest", [-6, 12, -9], [12, 11, 10])
box(body, "barrel", [-5, 12, 1], [10, 10, 9])
box(body, "hips", [-6, 11, 10], [12, 10, 8])
box(body, "chest_plate", [-4, 11, -8], [8, 1, 8], UNDER)
box(body, "barrel_plate", [-3, 11, 1], [6, 1, 9], UNDER)
box(body, "hip_plate", [-4, 10, 10], [8, 1, 7], UNDER)
box(body, "shoulder_r", [6, 17, -7], [2, 5, 6], DARK)
box(body, "shoulder_l", [-8, 17, -7], [2, 5, 6], DARK)
;[-7, -3, 1, 5, 9, 13].forEach((z, i) => box(body, "back_spike_" + (i + 1), [-1, i < 2 ? 23 : i > 3 ? 21 : 22, z], [2, 2 + (i % 2), 2], HORN))

// The neck: six pieces along a curve, each joint on the curve, thinner towards the far end.
const neckLine = api.curve([[0, 21, -7], [0, 27, -14], [0, 34, -16], [0, 41, -20]], 6)
const neckSizes = [[8, 7], [7, 6], [6, 5], [5, 5], [4, 4], [4, 4]]
const neck = m.chain("neck", { parent: "body", points: neckLine, sizes: neckSizes, overlap: 1, color: HIDE.base, paint: HIDE })
neck.forEach((piece, i) => {
  const long = Math.round(api.length(api.sub(neckLine[i + 1], neckLine[i])) + 1)
  box(piece, "under", rel(piece, [-(neckSizes[i][0] - 2) / 2, 0, -neckSizes[i][1] / 2 - 1]), [neckSizes[i][0] - 2, long - 1, 1], UNDER)
  box(piece, "spike", rel(piece, [-1, long / 2 - 1, neckSizes[i][1] / 2]), [2, 2, 2], HORN)
})

// The head stands straight however the neck bends: its joint is given by where it ends up.
const head = m.joint("head", { parent: neck[5], at: neckLine[6] })
head.cube("skull", { origin: rel(head, [-3, -2, -6]), size: [6, 6, 8], color: HIDE.base, paint: HIDE, features: [{ type: "eyes", face: "sides", shape: "slit", size: 2, x: 0.3, y: 0.62, color: "#ffd23a", color2: "#1a1206", glow: true }] })
box(head, "snout", rel(head, [-2.5, -2, -12]), [5, 3, 6])
box(head, "snout_ridge", rel(head, [-1.5, 1, -11]), [3, 1, 5], DARK)
box(head, "nostrils", rel(head, [-2.5, 0, -13]), [5, 2, 1], DARK)
;[1, -1].forEach((side) => {
  const tag = side > 0 ? "_r" : "_l"
  const x = (near, wide) => (side > 0 ? near : -near - wide)
  box(head, "brow" + tag, rel(head, [x(1.5, 2), 3, -6]), [2, 2, 4], DARK)
  box(head, "horn" + tag, rel(head, [x(1.5, 2), 3, 1]), [2, 2, 5], HORN)
  box(head, "horn_tip" + tag, rel(head, [x(2, 1), 4, 6]), [1, 2, 3], HORN)
  box(head, "frill" + tag, rel(head, [x(3, 1), -2, -2]), [1, 4, 4], WEB)
  box(head, "frill_rear" + tag, rel(head, [x(3, 1), -1, 2]), [1, 3, 3], WEB)
})
const jaw = head.bone("jaw", { pivot: rel(head, [0, -2, 0]) })
box(jaw, "jaw", rel(head, [-2.5, -4, -11]), [5, 2, 11], DARK)
box(jaw, "chin", rel(head, [-1.5, -5, -8]), [3, 1, 6], UNDER)
box(jaw, "fang_r", rel(head, [1.5, -2, -11]), [1, 2, 1], HORN)
box(jaw, "fang_l", rel(head, [-2.5, -2, -11]), [1, 2, 1], HORN)

// The tail: eight pieces along a curve, with a spike on each and two flat blades at the end.
const tailLine = api.curve([[0, 17, 17], [0, 15, 26], [0, 10, 35], [0, 7, 43], [0, 6, 50]], 8)
const tailSizes = [[7, 7], [6, 6], [5, 5], [5, 4], [4, 4], [3, 3], [3, 2], [2, 2]]
const tail = m.chain("tail", { parent: "body", points: tailLine, sizes: tailSizes, overlap: 1, color: HIDE.base, paint: HIDE })
tail.forEach((piece, i) => {
  const long = Math.round(api.length(api.sub(tailLine[i + 1], tailLine[i])) + 1)
  if (i < 6) box(piece, "spike", rel(piece, [-1, tailSizes[i][1] / 2, long / 2 - 1]), [2, i < 3 ? 3 : 2, 2], HORN)
  if (i < 5) box(piece, "under", rel(piece, [-(tailSizes[i][0] - 2) / 2, -tailSizes[i][1] / 2 - 1, 0]), [tailSizes[i][0] - 2, 1, long - 1], UNDER)
})
box(tail[7], "blade", rel(tail[7], [-3, -0.5, 2]), [6, 1, 4], WEB)
box(tail[7], "blade_tip", rel(tail[7], [-2, -0.5, 6]), [4, 1, 3], WEB)

// One wing, written flat and pointing straight out, then lifted, swept and tilted by its bones; the other is its mirror.
const SHOULDER = [6, 22, -4]
const ELBOW = [19, 22, -4]
const WRIST = [32, 22, -4]
const wing = body.bone("wing_r", { pivot: SHOULDER, rotation: [tail_down * 14, back * 10, up * 34] })
box(wing, "upper", [6, 21, -5.5], [13, 2, 3])
const fore = wing.bone("wing_r_fore", { pivot: ELBOW, rotation: [0, -back * 30, up * 4] })
box(fore, "fore", [19, 21, -5], [13, 2, 2])
box(fore, "thumb", [30, 22, -7], [2, 1, 2], HORN)
// Four fingers fan out from the wrist; the last one points back towards the flank and carries the trailing edge.
const SPREAD = [0, 32, 64, 100]
const REACH = [26, 30, 27, 20]
const fingers = SPREAD.map((angle, i) => {
  const finger = fore.bone("wing_r_finger_" + (i + 1), { pivot: WRIST, rotation: [0, back * angle, 0] })
  box(finger, "near", [32, 21.5, -5], [Math.ceil(REACH[i] / 2), 2, 2], DARK)
  box(finger, "far", [32 + Math.ceil(REACH[i] / 2), 22, -4.5], [Math.floor(REACH[i] / 2), 1, 1], DARK)
  return finger
})
// The skin between a finger and the next: long thin strips lying along the leading finger, each starting
// where the gap has become wide enough for it. `deep` is how wide one strip is.
const skin = (bone, from, reach, turn, y, deep) => {
  const slope = Math.tan(api.rad(turn))
  for (let k = 0; k < 8; k++) {
    const start = Math.round((k * deep) / slope)
    if (reach - start < 3) break
    box(bone, "skin_" + (k + 1), [from[0] + start, y, from[2] + 0.5 + k * deep], [reach - start, 1, deep], WEB)
  }
}
fingers.slice(0, 3).forEach((finger, i) => skin(finger, WRIST, Math.min(REACH[i], REACH[i + 1]) - 1, SPREAD[i + 1] - SPREAD[i], 22.1 + i * 0.15, 4))
// Behind the arm, from the last finger in to the flank: strips that get shorter the further back they lie.
;[0, 1, 2].forEach((k) => box(fore, "skin_" + (k + 1), [19 + k * 2, 22.55, -3.5 + k * 4], [13 - k * 2, 1, 4], WEB))
;[0, 1, 2, 3].forEach((k) => box(wing, "skin_" + (k + 1), [6 + k, 22.7, -3.5 + k * 4], [13 - k, 1, 4], WEB))
m.mirror("wing_r", (name) => name.replace("_r", "_l"))

// A limb in three bones. Each joint is said by where it is in the world, so the last one lands flat on the ground.
const limb = (name, hip, knee, ankle, thick) => {
  const upper = m.joint(name, { parent: "body", at: hip, toward: knee, along: "y-" })
  const upperLong = Math.round(api.length(api.sub(knee, hip)))
  box(upper, "upper", rel(upper, [-thick / 2, -upperLong, -thick / 2 - 0.5]), [thick, upperLong + 1, thick + 1])
  const lower = m.joint(name + "_shin", { parent: upper, at: knee, toward: ankle, along: "y-" })
  const lowerLong = Math.round(api.length(api.sub(ankle, knee)))
  box(lower, "lower", rel(lower, [-(thick - 1) / 2, -lowerLong, -(thick - 1) / 2]), [thick - 1, lowerLong + 1, thick - 1], DARK)
  const foot = m.joint(name + "_foot", { parent: lower, at: ankle })
  box(foot, "pad", rel(foot, [-thick / 2, -ankle[1], -thick - 1]), [thick, ankle[1], thick + 3])
  ;[-1, 0, 1].forEach((k) => box(foot, "claw_" + (k + 2), rel(foot, [k * (thick / 2 - 0.5) - 0.5, -ankle[1], -thick - 3]), [1, 2, 2], HORN))
  return upper
}
limb("leg_front_r", [6, 14, -5], [7, 7, -8], [7, 2, -5], 3)
limb("leg_hind_r", [7, 14, 13], [8, 7, 10], [8, 2, 14], 4)
m.mirror("leg_front_r", (name) => name.replace("_r", "_l"))
m.mirror("leg_hind_r", (name) => name.replace("_r", "_l"))

// Motion. Every curve is a function of time, sampled into keyframes.
const TAU = Math.PI * 2
const wave = (t, phase) => Math.sin(TAU * (t + (phase || 0)))
const sides = (name, turn) => [[name, turn], [name.replace("_r", "_l"), (t, s) => { const r = turn(t, s); return [r[0], -r[1], -r[2]] }]]
const each = (a, list, count) => list.forEach((entry) => a.sample(entry[0], entry[1], count || 9))

const idle = m.animation("idle", { length: 4, loop: true })
idle.sample("body", (t) => [wave(t) * 1.2, 0, 0], 9)
neck.forEach((piece, i) => idle.sample(piece, (t) => [wave(t, -i * 0.07) * 2.2 * nose_down, wave(t / 1, 0.25 - i * 0.05) * 1.5, 0], 9))
idle.sample("head", (t) => [wave(t, -0.5) * 4 * nose_down, wave(t, 0.1) * 5, 0], 9)
idle.sample("jaw", (t) => [Math.max(0, wave(t, 0.3)) * 5 * nose_down, 0, 0], 9)
tail.forEach((piece, i) => idle.sample(piece, (t) => [0, wave(t, -i * 0.09) * (2 + i * 0.7), 0], 9))
each(idle, sides("wing_r", (t) => [0, 0, -up * (3 + wave(t) * 3)]))
each(idle, sides("wing_r_fore", (t) => [0, back * (4 + wave(t, -0.1) * 3), 0]))

const walk = m.animation("walk", { length: 1.2, loop: true })
const stride = (phase) => (t) => [wave(t, phase) * 24, 0, 0]
const knee = (phase) => (t) => [Math.max(0, wave(t, phase + 0.2)) * -22, 0, 0]
;[["leg_front_r", 0], ["leg_front_l", 0.5], ["leg_hind_r", 0.5], ["leg_hind_l", 0]].forEach((leg) => {
  walk.sample(leg[0], stride(leg[1]), 13)
  walk.sample(leg[0] + "_shin", knee(leg[1]), 13)
  walk.sample(leg[0] + "_foot", (t) => [wave(t, leg[1] + 0.35) * 10, 0, 0], 13)
})
walk.sample("body", (t) => [wave(t * 2) * 1.5, wave(t) * 2.5, wave(t, 0.25) * 2], 13)
neck.forEach((piece, i) => walk.sample(piece, (t) => [wave(t * 2, -i * 0.06) * 1.6 * nose_down, wave(t, 0.5 - i * 0.05) * 1.8, 0], 13))
walk.sample("head", (t) => [wave(t * 2, 0.4) * 3, wave(t, 0.5) * -3, 0], 13)
tail.forEach((piece, i) => walk.sample(piece, (t) => [0, wave(t, 0.5 - i * 0.1) * (3 + i), 0], 13))
each(walk, sides("wing_r", (t) => [0, 0, -up * (6 + wave(t * 2) * 2)]), 13)

const hurt = m.animation("hurt", { length: 0.5, loop: false })
const jolt = (size) => [[0, [0, 0, 0]], [0.08, size], [0.22, api.scale(size, -0.35)], [0.5, [0, 0, 0]]]
hurt.keys("body", jolt([-7, 0, 4]))
neck.forEach((piece, i) => hurt.keys(piece, jolt([-(5 + i) * nose_down, 3, 0])))
hurt.keys("head", jolt([14 * nose_down, -8, 6]))
hurt.keys("jaw", jolt([22 * nose_down, 0, 0]))
tail.forEach((piece, i) => hurt.keys(piece, jolt([0, 5 + i * 1.5, 0])))
sides("wing_r", () => [0, 0, up * 18]).forEach((entry) => hurt.keys(entry[0], jolt(entry[1](0, 0))))

// The wings beat: the arm leads, the forearm and the fingers follow a little later, and the body rides the beat.
const flap = m.animation("flap", { length: 1, loop: true })
each(flap, sides("wing_r", (t) => [0, back * wave(t, 0.1) * 6, up * (wave(t) * 34 - 4)]), 13)
each(flap, sides("wing_r_fore", (t) => [0, back * (6 + wave(t, -0.08) * 10), up * wave(t, -0.12) * 18]), 13)
;[1, 2, 3, 4].forEach((n) => each(flap, sides("wing_r_finger_" + n, (t) => [0, back * wave(t, -0.2) * 4 * n, up * wave(t, -0.2) * 9]), 13))
flap.sample("body", (t) => [wave(t, 0.25) * 2.5, 0, 0], 13)
neck.forEach((piece, i) => flap.sample(piece, (t) => [wave(t, 0.2 - i * 0.05) * 1.8 * nose_down, 0, 0], 13))
tail.forEach((piece, i) => flap.sample(piece, (t) => [wave(t, 0.3 - i * 0.07) * (1.5 + i * 0.5), 0, 0], 13))
;["leg_front_r", "leg_front_l", "leg_hind_r", "leg_hind_l"].forEach((leg) => flap.sample(leg, (t) => [8 + wave(t, 0.25) * 5, 0, 0], 13))

const count = m.count()
api.note("bones " + count.bones + ", cubes " + count.cubes + ", animations " + count.animations)
return m
