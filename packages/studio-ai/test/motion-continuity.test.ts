import { expect, test } from "bun:test"
import { GAME_PIXELS, STANDING_ABOVE, type MotionClip } from "../src/model-motion"
import { LOOK_LIMITS } from "../src/model-quality"
import { clipPace, CONTINUITY, CONTINUITY_GATE, glidingWalk, measureContinuity, PACE, TICK, walkingSpeed } from "../src/motion-continuity"
import { CONTINUITY_GUIDE, CONTINUITY_REVIEW_RULE, continuityFindings, continuityLine, continuityPlain, GATE_WORDS, gated, justifiedName, justifiedReason, PartSheetDraftSchema, type MotionNote } from "../src/making"

type Vec = [number, number, number]
const faces = { north: "#888888", east: "#888888", south: "#888888", west: "#888888", up: "#888888", down: "#888888" }
const cube = (name: string, origin: Vec, size: Vec) => ({ name, origin, size, faces, surface_details: [] })
const bone = (name: string, parent: string | null, pivot: Vec, cubes: ReturnType<typeof cube>[]) => ({ name, parent, pivot, rotation: [0, 0, 0] as Vec, cubes })
// A post on the ground with an arm ten pixels long hinged on top of it: nothing but the arm ever moves.
const turner = [bone("post", null, [0, 0, 0], [cube("post", [-1, 0, -1], [2, 8, 2])]), bone("arm", "post", [0, 8, 0], [cube("beam", [0, 8, -0.5], [10, 1, 1])])]
// A body on two legs six pixels long that swing from the hip; each sole is two pixels long.
const walker = [
  bone("body", null, [0, 6, 0], [cube("trunk", [-3, 6, -2], [6, 6, 4])]),
  bone("leg_left", "body", [2, 6, 0], [cube("shin", [1, 0, -1], [2, 6, 2])]),
  bone("leg_right", "body", [-2, 6, 0], [cube("shin", [-3, 0, -1], [2, 6, 2])]),
]
const turn = (name: string, loop: boolean, keys: [number, number, ("step" | null)?][]): MotionClip => ({ name, length: keys.at(-1)![0], loop, channels: [{ bone: "arm", keyframes: keys.map(([time, degrees, interpolation]) => ({ time, rotation: [0, degrees, 0] as Vec, ...(interpolation ? { interpolation } : {}) })) }] })
const stride = (degrees: number): MotionClip => ({
  name: "walk",
  length: 1,
  loop: true,
  channels: [1, -1].map((side) => ({ bone: side === 1 ? "leg_left" : "leg_right", keyframes: [0, 0.5, 1].map((time, index) => ({ time, rotation: [side * degrees * (index === 1 ? -1 : 1), 0, 0] as Vec })) })),
})
// The same stride with each leg raised three pixels while it comes forward (`first`: which leg comes forward in the first half).
const stepped = (degrees: number, first: 1 | -1): MotionClip => ({
  ...stride(degrees),
  channels: stride(degrees).channels.map((channel, index) => ({ ...channel, position: [0, 0.25, 0.5, 0.75, 1].map((time, key) => ({ time, position: [0, ((index === 0 ? 1 : -1) === first ? [0, 3, 0, 0, 0] : [0, 0, 0, 3, 0])[key]!, 0] as Vec })) })),
})
const note = (bones: typeof turner, clip: MotionClip, speed: number | null = null): MotionNote => ({ name: clip.name, travel: 1, mover: "arm", cube: "beam", between: [0, 1], moving: 1, parts: 2, turn: 1, game: 6, picture: null, tall: 9, unseen: false, continuity: measureContinuity({ bones }, clip, speed) })

test("循环接不上：最后一刻和第一刻差多少量得出来；一样的摆法首尾对上就没有这一条", () => {
  // The arm sweeps a sixth of a turn and the loop starts over from where it began: its far corner snaps back the whole chord.
  const open = measureContinuity({ bones: turner }, turn("idle", true, [[0, 0], [1, 60]]))
  expect(open.seam).toBeCloseTo(2 * Math.hypot(10, 0.5) * Math.sin(Math.PI / 6), 1)
  expect(open).toMatchObject({ seam_part: "arm", faults: ["seam"] })
  // There and back: the two ends are the same pose.
  expect(measureContinuity({ bones: turner }, turn("idle", true, [[0, 0], [0.5, 60], [1, 0]]))).toMatchObject({ seam: 0, seam_part: null, faults: [] })
  // A clip that plays once has no seam, and a seam under two screen pixels is nobody's fault.
  expect(measureContinuity({ bones: turner }, turn("idle", false, [[0, 0], [1, 60]]))).toMatchObject({ seam: null, faults: [] })
  const slight = measureContinuity({ bones: turner }, turn("idle", true, [[0, 0], [1, 1.5]]))
  expect([slight.seam! * GAME_PIXELS < CONTINUITY.jump, slight.faults]).toEqual([true, []])
})

test("循环的接缝忽略挂链，但仍能找出身体的跳动", () => {
  const clip = turn("idle", true, [[0, 0], [1, 60]])
  const follow = [{ bone: "arm", mode: "hang" as const }]
  expect(measureContinuity({ bones: turner }, clip).faults).toContain("seam")
  expect(measureContinuity({ bones: turner, follow }, clip)).toMatchObject({ seam: 0, seam_part: null })
  const movingBody = { ...clip, channels: [...clip.channels, { bone: "post", keyframes: [{ time: 0, rotation: [0, 0, 0] as Vec }, { time: 1, rotation: [0, 0, 70] as Vec }] }] }
  expect(measureContinuity({ bones: turner, follow }, movingBody).seam_part).toBe("post")
})

test("中途突然跳一下：只有孤零零的一刻才算，快的一段不算，开头那一下不算，写明要一格一格切换的也不算", () => {
  // A degree a tick, then thirty degrees inside one tick, then a degree a tick again.
  const popped = measureContinuity({ bones: turner }, turn("attack", false, [[0, 0], [0.5, 10], [0.55, 40], [1, 49]]))
  expect(popped).toMatchObject({ step_at: 0.55, step_part: "arm", faults: ["pop"] })
  expect(popped.step / popped.typical).toBeGreaterThan(CONTINUITY.alone)
  // The same thirty degrees over three ticks is a fast stretch; at the very start of a clip that plays once it is the clip setting in.
  expect(measureContinuity({ bones: turner }, turn("attack", false, [[0, 0], [0.5, 10], [0.65, 40], [1, 47]])).faults).toEqual([])
  expect(measureContinuity({ bones: turner }, turn("hurt", false, [[0, 0], [0.05, 30], [1, 0]])).faults).toEqual([])
  // Asked for in the document: the key is held and then switched.
  expect(measureContinuity({ bones: turner }, turn("attack", false, [[0, 0], [0.5, 10, "step"], [0.55, 40], [1, 49]])).faults).toEqual([])
})

test("着地和打滑：着地的部件往后蹬多远，就说明它每秒该走几格；和设定的速度差一半以上才算打滑", () => {
  const found = measureContinuity({ bones: walker }, stride(20))
  // Each sole swings back across the chord of a six-pixel leg in half a second while the other comes forward.
  expect(found.walk).toMatchObject({ supports: 2, declared: null, skates: false })
  expect(found.walk!.stride).toBeCloseTo(2 * 6 * Math.sin((20 * Math.PI) / 180), 1)
  expect(found.walk!.speed).toBeCloseTo((2 * 6 * Math.sin((20 * Math.PI) / 180)) / 0.5 / 16, 2)
  // Coming forward the leg is not lifted: the same distance dragged over the ground, said as a fact.
  expect(found.walk!.drag).toBeCloseTo(found.walk!.stride, 1)
  expect(found.faults).toEqual([])
  // Raised while it comes forward (whichever leg that is), nothing is dragged and the stride is what it was.
  const raised = [stepped(20, 1), stepped(20, -1)].map((clip) => measureContinuity({ bones: walker }, clip)).sort((a, b) => a.walk!.drag - b.walk!.drag)[0]!
  expect(raised.walk).toMatchObject({ drag: 0, glides: false })
  expect(raised.walk!.stride).toBeCloseTo(found.walk!.stride, 1)
  expect(raised.faults).toEqual([])
  // At about the pace the legs imply nothing is held against it; at four times that pace the feet cover a quarter of the ground.
  expect(measureContinuity({ bones: walker }, stride(20), 0.5).faults).toEqual([])
  const skating = measureContinuity({ bones: walker }, stride(20), 2)
  expect(skating).toMatchObject({ walk: { declared: 2, skates: true }, faults: ["slide"] })
  expect(skating.walk!.slide).toBeCloseTo(2 * 16 * 0.5 - found.walk!.stride, 0)
  // Only the clip the game plays while the creature moves is measured for this; and the game's own arithmetic gives the pace.
  expect(measureContinuity({ bones: walker }, { ...stride(20), name: "idle" }, 2)).toMatchObject({ walk: null, faults: [] })
  expect(walkingSpeed(0.25)).toBeCloseTo(2.7, 1)
  // Two parts side by side under one root: a club tipped over through the post is deeper in it than as built (here by 5 pixels, past what a joint allows).
  const club = [bone("root", null, [0, 0, 0], []), bone("post", "root", [0, 0, 0], [cube("post", [-3, 0, -3], [6, 8, 6])]), bone("arm", "root", [0, 8, 0], [cube("club", [0, 8, -2], [10, 4, 4])])]
  const tipped = measureContinuity({ bones: club }, { name: "attack", length: 1, loop: false, channels: [{ bone: "arm", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [0, 0, 150] }, { time: 1, rotation: [0, 0, 0] }] }] })
  expect(tipped.cross).toMatchObject({ a: "post", b: "arm" })
  expect(tipped.cross!.more).toBeGreaterThan(tipped.slack.joint)
  expect(tipped.faults).toContain("cross")
  const sunk = measureContinuity({ bones: turner }, { name: "death", length: 1, loop: false, channels: [{ bone: "post", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [0, 0, 90] }] }] })
  expect(sunk.sink).toBeGreaterThan(CONTINUITY.grain)
  expect(sunk.faults).toContain("sink")
})

test("几个部件同时动、重心落在哪，只是事实；量出毛病的要改掉或者在部件说明里写明理由", () => {
  const walk = note(walker, stride(20), 2)
  expect(walk.continuity).toMatchObject({ movers: 2, together: 2, balance: { off: 0, way: null } })
  expect(continuityLine(walk)).toBe(
    "走路（walk）连起来看（按游戏每秒 20 刻逐刻量）：循环的最后一刻和第一刻接得上；一刻之内动得最多的一下在第 0.55 秒：「leg_left」移动 0.4 个模型像素，和平常的一刻差不多；最低处一直贴着地面；" +
      "着地的部件有 2 个，一步往后蹬 4.1 个模型像素；照这样摆，它每秒该走 0.5 格，设定的是每秒 2 格，着地的时候每个循环在地上滑 12 个模型像素（约 72 个屏幕像素）——着地的部件在地上打滑；往前迈的时候没有抬离地面，贴着地往前蹭了 4.1 个模型像素；" +
      "不相连的部件没有比站着不动时穿得更深；动作最大的那一刻（第 0 秒）重心落在着地范围以内；2 个看得出在动的部件全部同时动，没有先后。",
  )
  expect(continuityPlain(walk)).toEqual(["走路：着地的部件在地上打滑。", "走路：2 个会动的部件全部同时动，没有先后。"])
  expect(continuityFindings(null, [walk])).toEqual([expect.stringMatching(/^站得住：走路（walk）着地的部件在地上打滑（.+差了一半以上）。把步子的幅度或者这段动作的长度改到和它的速度对得上，再看一版；如果它本来就该这样，在部件说明的 justified 里写上这一项和理由（\{"what":"walk:slide","reason":"……"\}），理由会原样给评审和人看。$/)])
  // Justified in the sheet, by the name the finding gave or by the player's word: no longer a finding, and the reason is said with the fact.
  const sheet = { justified: [{ what: "走路 : slide", reason: "它是踩着冰滑过来的" }] }
  expect([justifiedReason(sheet, "walk", "slide"), justifiedReason(sheet, "walk", "seam"), continuityFindings(sheet, [walk])]).toEqual(["它是踩着冰滑过来的", null, []])
  expect(continuityLine(walk, sheet)).toContain("——着地的部件在地上打滑（部件说明里写了本来就该这样：它是踩着冰滑过来的）")
  expect(continuityPlain(walk, sheet)[0]).toBe("走路：着地的部件在地上打滑——部件说明里写了本来就该这样：它是踩着冰滑过来的")
  expect([justifiedName("walk:slide"), justifiedName("别的什么")]).toEqual(["走路：着地的部件在地上打滑", "别的什么"])
  // A note from before this was measured says nothing, and a sheet from before has no such list.
  expect([continuityLine({ ...walk, continuity: undefined }), continuityFindings(null, [{ ...walk, continuity: undefined }])]).toEqual(["", []])
  expect(PartSheetDraftSchema.parse({ subject: "石像", recognisable: ["方"], parts: [{ name: "身体", what: "躯干", shape: "方", attaches: "无", surface: "灰", moves: "不动", assumed: false }], assumed: [] }).justified).toEqual([])
})

// The gate (10-07). A creature was seen carried over the ground with nothing stepping; what follows holds for anything that stands on the ground.
// A trunk on two stiff legs about as that creature was built: legs 20 pixels long hinged at a hip 24 up, under a trunk 32 wide.
const heavy = [
  bone("root", null, [0, 0, 0], []),
  bone("body", "root", [0, 26, 0], [cube("trunk", [-16, 21, -8], [32, 29, 19])]),
  bone("leg_left", "root", [6, 24, 0], [cube("leg", [1, 0, -2], [10, 20, 4])]),
  bone("leg_right", "root", [-6, 24, 0], [cube("leg", [-11, 0, -2], [10, 20, 4])]),
]
const swing = (bones: string[], axis: 0 | 1, degrees: number, length = 1.6): MotionClip => ({
  name: "walk",
  length,
  loop: true,
  channels: bones.map((name, index) => ({ bone: name, keyframes: [0, length / 2, length].map((time, key) => ({ time, rotation: [0, 1, 2].map((at) => (at === axis ? (index % 2 ? -1 : 1) * degrees * (key === 1 ? -1 : 1) : 0)) as Vec })) })),
})

test("硬门槛：站在地上的东西，移动时放的动作里着地的部件没有一个往后走，就是整个平移——只能改，写理由不算", () => {
  // Only the trunk turns from side to side: both legs stay planted where they are while the game carries the body forward.
  const still = measureContinuity({ bones: heavy }, swing(["body"], 1, 3))
  expect(still.walk).toMatchObject({ supports: 2, stride: 0, speed: 0, glides: true })
  expect(still.faults).toEqual(["glide"])
  // Known speed or not, it is the one fault and never "slide" as well: there is no stride to hold to a speed.
  expect(measureContinuity({ bones: heavy }, swing(["body"], 1, 3), 1.4).faults).toEqual(["glide"])
  // The same legs swung from the hip take each sole back along the ground: not this fault, at any size of swing that is seen.
  const stepping = measureContinuity({ bones: heavy }, swing(["leg_left", "leg_right"], 0, 12))
  expect(stepping.walk).toMatchObject({ supports: 2, glides: false })
  expect(stepping.walk!.stride).toBeGreaterThan(CONTINUITY.touch)
  expect(stepping.faults).toEqual([])
  // A swing too small for a sole to be seen going back is the same as none.
  expect(measureContinuity({ bones: heavy }, swing(["leg_left", "leg_right"], 0, 0.2)).faults).toEqual(["glide"])
  // Only the clip the game plays while it moves is held to this, and only what stands on the ground: the same thing built clear of it hovers.
  expect(measureContinuity({ bones: heavy }, { ...swing(["body"], 1, 3), name: "idle" }).faults).toEqual([])
  const lifted = heavy.map((part) => ({ ...part, pivot: [part.pivot[0], part.pivot[1] + 8, part.pivot[2]] as Vec, cubes: part.cubes.map((box) => ({ ...box, origin: [box.origin[0], box.origin[1] + 8, box.origin[2]] as Vec })) }))
  expect(measureContinuity({ bones: lifted }, swing(["body"], 1, 3))).toMatchObject({ hovering: true, walk: null, faults: [] })

  // To its maker: a finding with no way out through the sheet. A reason written for it is not read.
  expect(CONTINUITY_GATE).toEqual(["glide"])
  expect(gated("glide") && !gated("slide")).toBe(true)
  const made = note(heavy as typeof turner, swing(["body"], 1, 3))
  const reasoned = { justified: [{ what: "walk:glide", reason: "它就是滑着走的" }, { what: "walk:slide", reason: "别的理由" }] }
  expect(justifiedReason(reasoned, "walk", "glide")).toBeNull()
  expect(justifiedReason(reasoned, "walk", "slide")).toBe("别的理由")
  const told = continuityFindings(reasoned, [made])
  expect(told).toEqual([expect.stringContaining("走路（walk）移动时整个在地上平移，没有任何部件往后蹬")])
  expect(told[0]).toContain(`这一项是${GATE_WORDS}。`)
  expect(told[0]).not.toContain("justified")
  expect(continuityLine(made, reasoned)).toContain(`它是整个在地上平移的——${GATE_WORDS}`)
  expect(continuityPlain(made, reasoned)).toContain("走路：移动时整个在地上平移，没有任何部件往后蹬。")
  // Said before anything is made, and to the reviewer as blocking whatever the sheet writes.
  expect(CONTINUITY_GUIDE).toContain(`${GATE_WORDS}——「移动时整个在地上平移，没有任何部件往后蹬」`)
  expect(CONTINUITY_GUIDE).toContain("从第一版就照这个做")
  expect(CONTINUITY_REVIEW_RULE).toContain(`例外是写着「${GATE_WORDS}」的那一项（「移动时整个在地上平移，没有任何部件往后蹬」）：不管部件说明里写了什么理由，它都是必须改的。`)
})

test("悬着还是站着：静态标准说“落在地面上”和动作量里说“离地悬着”是同一个数，搭得离地 0.4 到 1 个像素的会走的东西照样量打滑", () => {
  // One number for both questions (audit, 10-14): the static standard's `off_ground` allows `LOOK_LIMITS.groundSlack` above y=0, and the clip measure calls a model hovering
  // only past the very same number. Before, the clip measure used `CONTINUITY.touch` (a third of a pixel), so a walker built 0.4 to 1 pixel up stood to the one and hovered to the other.
  expect(LOOK_LIMITS.groundSlack).toBe(STANDING_ABOVE)
  expect(CONTINUITY.touch).toBeLessThan(STANDING_ABOVE)
  const raise = (by: number) => heavy.map((part) => ({ ...part, pivot: [part.pivot[0], part.pivot[1] + by, part.pivot[2]] as Vec, cubes: part.cubes.map((box) => ({ ...box, origin: [box.origin[0], box.origin[1] + by, box.origin[2]] as Vec })) }))
  const gliding = swing(["body"], 1, 3)
  // Between a third of a pixel and one pixel up (what the static standard calls standing): not hovering, the planted-foot analysis runs, and a walker that glides is caught.
  for (const by of [0, CONTINUITY.touch + 0.1, (CONTINUITY.touch + STANDING_ABOVE) / 2, STANDING_ABOVE]) {
    const found = measureContinuity({ bones: raise(by) }, gliding)
    expect([by, found.hovering, found.faults]).toEqual([by, false, ["glide"]])
    expect(glidingWalk({ bones: raise(by), animations: [gliding] }, 1)).not.toBeNull()
  }
  // Past it the static standard calls it off the ground too, and the clip measure agrees that nothing stands.
  const past = measureContinuity({ bones: raise(STANDING_ABOVE + 0.2) }, gliding)
  expect([past.hovering, past.faults]).toEqual([true, []])
  expect(glidingWalk({ bones: raise(STANDING_ABOVE + 0.2), animations: [gliding] }, 1)).toBeNull()
})

test("游戏里什么时候算在走、走路的动作放多快：数是从屏幕和游戏自己的算法来的", () => {
  // Seen to move: two screen pixels within the four ticks the controller blends over. About a tenth of a block a second.
  expect(PACE.moving).toBeCloseTo(2 / GAME_PIXELS / 16 / 4, 6)
  expect(PACE.moving * 20).toBeCloseTo(0.104, 2)
  expect(PACE.amount).toBeCloseTo(4 * PACE.moving, 6)
  // The case that was seen: speed 0.18 walked at a pace of 0.45 by a goal covers 0.28 blocks a second.
  const slow = walkingSpeed(0.18, 0.45)
  expect(slow).toBeCloseTo(0.283, 2)
  // The library's own test (mean of |vx| and |vz| of the kept velocity, 0.6 × 0.91 of a tick's ground, against 0.015) never called it moving, even along an axis; the limb amount does.
  expect(((slow / 20) * 0.6 * 0.91) / 2).toBeLessThan(0.015)
  expect((walkingSpeed(0.18, 1) / 20) * 0.6 * 0.91 / 2).toBeGreaterThan(0.015)
  expect((4 * slow) / 20).toBeGreaterThan(PACE.amount)

  // The walk is played by the speed at which its soles hold the ground while they touch it; one cycle never takes less than four ticks.
  const clip = swing(["leg_left", "leg_right"], 0, 12)
  const pace = clipPace({ bones: heavy }, clip)
  expect(pace.speed).toBe(measureContinuity({ bones: heavy }, clip).walk!.speed)
  expect(pace.speed).toBeGreaterThan(walkingSpeed(0.18, 0.45))
  expect(pace.most).toBe(clip.length / (PACE.frames * TICK))
  // At that pace the same clip takes this long for one cycle: slow and whole, instead of an idle pose sliding.
  expect(clip.length / (slow / pace.speed)).toBeGreaterThan(clip.length)
  // Nothing to hold it to: played as written.
  expect(clipPace({ bones: heavy }, swing(["body"], 1, 3))).toEqual({ speed: 0, most: 8 })
  expect(clipPace({ bones: heavy }, { ...clip, length: 0.1, channels: [] }).most).toBe(1)
})

// 10-14 (the owner: "motion quality gates should not be too strict — no obvious errors is enough"). Sinking, floating and one part in another
// are faults only past what a player sees (`FAULT_SLACK`: 2.5 model pixels, more for a large creature); under it they are said as facts.
// A body with a one-pixel wing membrane at its side, pushed towards the body by `d` pixels at the middle of the clip.
const batLike = [
  bone("root", null, [0, 0, 0], []),
  bone("body", "root", [0, 8, 0], [cube("torso", [-4, 4, -4], [8, 8, 8])]),
  bone("wing", "root", [4, 8, 0], [cube("membrane", [4, 6, -3], [8, 1, 6])]),
]
const still: [number, number, number] = [0, 0, 0]
const shove = (name: string, d: number): MotionClip => ({
  name,
  length: 1,
  loop: true,
  channels: [{ bone: "wing", keyframes: [0, 1].map((time) => ({ time, rotation: still })), position: [0, 0.5, 1].map((time, key) => ({ time, position: [key === 1 ? -d : 0, 0, 0] as Vec })) }],
})
// The two-legged walker of above, all of it moved up or down by `y` for the whole clip.
const shifted = (y: number, bones = walker, root = "body", name = "idle"): MotionClip => ({
  name,
  length: 1,
  loop: true,
  channels: [{ bone: root, keyframes: [0, 1].map((time) => ({ time, rotation: still })), position: [0, 1].map((time) => ({ time, position: [0, y, 0] as Vec })) }],
})

test("连接处的穿插：翼膜插进身体一两个像素是关节，不算毛病；整块钻进去（超过 2.5 个像素）才算", () => {
  // As built the membrane touches the body and enters nothing.
  expect(measureContinuity({ bones: batLike }, shove("fly", 0)).cross).toBeNull()
  // One and two pixels: said as a fact, past `grain` for the first of them, never a fault.
  ;[1, 2].forEach((d) => {
    const found = measureContinuity({ bones: batLike }, shove("fly", d))
    expect(found.cross).toMatchObject({ a: "body", b: "wing", more: d })
    expect(found.slack).toEqual({ joint: 2.5, ground: 2.5 })
    expect(found.faults).toEqual([])
  })
  // Three pixels and more: the membrane has gone into the body, to the nearest face of it.
  ;[3, 8].forEach((d) => {
    const found = measureContinuity({ bones: batLike }, shove("fly", d))
    expect(found.cross!.more).toBe(3)
    expect(found.faults).toEqual(["cross"])
  })
  // The sentence a maker and a reviewer read says which it is.
  const joint = { name: "fly", travel: 1, mover: "wing", cube: "membrane", between: [0, 1] as [number, number], moving: 1, parts: 2, turn: 0, game: 6, picture: null, tall: 12, unseen: false }
  const lineOf = (d: number) => continuityLine({ ...joint, continuity: measureContinuity({ bones: batLike }, shove("fly", d)) })
  expect(lineOf(1)).toContain("比站着不动时多穿进去 1 个模型像素（按方块盒子算的近似值）（不到 2.5 个，连接处的正常穿插，不算毛病）")
  expect(lineOf(1)).not.toContain("部件穿进了别的部件")
  expect(lineOf(4)).toContain("部件穿进了别的部件")
  expect(continuityFindings(null, [{ ...joint, continuity: measureContinuity({ bones: batLike }, shove("fly", 1)) }])).toEqual([])
  expect(continuityFindings(null, [{ ...joint, continuity: measureContinuity({ bones: batLike }, shove("fly", 4)) }])).toEqual([expect.stringMatching(/^站得住：飞（fly）部件穿进了别的部件（.+超过 2\.5 个就看得出钻进去了）/)])
  // A large creature is given more: a twentieth of its largest extent. Here 120 pixels long, so 6 pixels.
  const long = [...batLike.slice(0, 1), bone("body", "root", [0, 8, 0], [cube("torso", [-4, 4, -60], [8, 8, 120])]), batLike[2]!]
  const huge = measureContinuity({ bones: long }, shove("fly", 4))
  expect(huge.slack.joint).toBe(6)
  expect(huge.faults).toEqual([])
})

test("落地：陷进地面一两个像素不算毛病，三四个算；整段离地一两个像素不算，六七个算；高大的生物按身高放宽", () => {
  // Sinking: the whole walker pressed into the ground for the whole clip.
  ;[1.1, 2.2].forEach((y) => expect(measureContinuity({ bones: walker }, shifted(-y))).toMatchObject({ sink: y, faults: [] }))
  ;[3, 3.8].forEach((y) => expect(measureContinuity({ bones: walker }, shifted(-y))).toMatchObject({ sink: y, faults: ["sink"] }))
  // Floating: nothing touches the ground at any moment of the clip.
  ;[1.5, 2.2].forEach((y) => expect(measureContinuity({ bones: walker }, shifted(y))).toMatchObject({ gap: y, faults: [] }))
  ;[3.8, 6.8].forEach((y) => expect(measureContinuity({ bones: walker }, shifted(y))).toMatchObject({ gap: y, faults: ["afloat"] }))
  // A creature built under the ground by a little (allowed) is not given the same again by its clip: the two together are counted from the ground itself.
  const sunk = walker.map((entry) => ({ ...entry, pivot: [entry.pivot[0], entry.pivot[1] - 2, entry.pivot[2]] as Vec, cubes: entry.cubes.map((part) => ({ ...part, origin: [part.origin[0], part.origin[1] - 2, part.origin[2]] as Vec })) }))
  expect(measureContinuity({ bones: sunk }, shifted(0, sunk))).toMatchObject({ sink: 2, faults: [] })
  expect(measureContinuity({ bones: sunk }, shifted(-1.5, sunk))).toMatchObject({ sink: 3.5, faults: ["sink"] })
  // A tall creature: 50 pixels, so 4 pixels (8 % of its height) are allowed.
  const tall = measureContinuity({ bones: heavy }, shifted(-3.8, heavy, "root"))
  expect(tall.slack.ground).toBe(4)
  expect([tall.sink, tall.faults]).toEqual([3.8, []])
  expect(measureContinuity({ bones: heavy }, shifted(-4.5, heavy, "root")).faults).toEqual(["sink"])
  // Built clear of the ground it hovers and none of this is asked of it (unchanged).
  expect(measureContinuity({ bones: walker.map((entry) => ({ ...entry, pivot: [entry.pivot[0], entry.pivot[1] + 5, entry.pivot[2]] as Vec, cubes: entry.cubes.map((part) => ({ ...part, origin: [part.origin[0], part.origin[1] + 5, part.origin[2]] as Vec })) })) }, shifted(0))).toMatchObject({ hovering: true, sink: 0, gap: 0, faults: [] })
  // What is said: under the allowance a fact "not a fault", over it the fault with the number it is past.
  const note = (clip: MotionClip): MotionNote => note0(measureContinuity({ bones: walker }, clip), clip.name)
  const note0 = (continuity: ReturnType<typeof measureContinuity>, name: string): MotionNote => ({ name, travel: 1, mover: "body", cube: "trunk", between: [0, 1], moving: 1, parts: 3, turn: 0, game: 6, picture: null, tall: 12, unseen: false, continuity })
  expect(continuityLine(note(shifted(-1.1)))).toContain("最低处比地面低 1.1 个模型像素（不到 2.5 个，看不出，不算毛病）")
  expect(continuityLine(note(shifted(1.5)))).toContain("整段最低处离地面 1.5 个模型像素（不到 2.5 个，看不出悬着，不算毛病）")
  expect(continuityFindings(null, [note(shifted(-1.1)), note(shifted(1.5))])).toEqual([])
  expect(continuityFindings(null, [note(shifted(-3.8))])).toEqual([expect.stringMatching(/最低的地方比地面低了 3\.8 个模型像素.+超过 2\.5 个就看得出脚少了一截/)])
  expect(continuityFindings(null, [note(shifted(6.8))])).toEqual([expect.stringMatching(/离地面至少 6\.8 个模型像素.+超过 2\.5 个就看得出悬着/)])
  // A written reason still answers what is a fault, as before.
  expect(continuityFindings({ justified: [{ what: "idle:sink", reason: "它趴在泥里" }] }, [note(shifted(-3.8))])).toEqual([])
})

test("打滑：一个循环里滑不到 2 个模型像素的看不出来，不算打滑", () => {
  // Stride of 0.4 pixels at 0.3 blocks a second: the feet cover 2.4 pixels a half-second and slip 1.98 of them (before: past one pixel and past half, so a fault).
  const small = measureContinuity({ bones: walker }, stride(2), 0.3)
  expect(small.walk!.slide).toBeGreaterThan(CONTINUITY.grain)
  expect(small.walk!.slide).toBeLessThan(CONTINUITY.slip)
  expect([small.walk!.skates, small.faults]).toEqual([false, []])
  // Two pixels and more, and half the ground: still a fault.
  expect(measureContinuity({ bones: walker }, stride(8), 0.5)).toMatchObject({ walk: { skates: true }, faults: ["slide"] })
})

test("什么是必须改的、什么不用改，量出来的话和给制作者、评审的话说的是同一个数", () => {
  ;[CONTINUITY_GUIDE, CONTINUITY_REVIEW_RULE].forEach((text) => {
    expect(text).toContain("不超过 2.5 个模型像素")
    expect(text).toContain("不用改，更不要为它花一版")
    expect(text).toContain("走路往回摆时脚没有抬离地面")
  })
  expect(CONTINUITY_REVIEW_RULE).toContain("没有标成毛病的那几个像素")
  expect(CONTINUITY_GUIDE).toContain(`打滑从 ${CONTINUITY.slip} 个模型像素起`)
})

test("一个声明了本来不动的走路：模型阶段（还不知道速度）不量着地，速度知道了以后在会走的时候照量，不走的（速度 0）从来不量", () => {
  const body = swing(["body"], 1, 3)
  // Its feet touch the ground and never push back: the gate fires, as it always has, when nothing is said and nothing is known.
  expect(measureContinuity({ bones: heavy }, body).faults).toEqual(["glide"])
  // Declared still and the speed not known yet (a model is made before the creature that wears it): no glide and no slide, and the clip is not walked at all.
  const declared = measureContinuity({ bones: heavy }, body, null, true)
  expect(declared).toMatchObject({ walk: null, faults: [] })
  // The speed is known and above 0: the creature does walk, the declaration frees nothing.
  expect(measureContinuity({ bones: heavy }, body, walkingSpeed(0.25), true).faults).toEqual(["glide"])
  // The speed is known and 0 (a creature that stays where it is): the clip is never played, declared or not.
  expect(measureContinuity({ bones: heavy }, body, 0)).toMatchObject({ walk: null, faults: [] })
  expect(measureContinuity({ bones: heavy }, body, 0, true)).toMatchObject({ walk: null, faults: [] })
  // Only the planted-feet measure is skipped: the rest of the clip is still held to what it was.
  const sunk = swing(["body"], 1, 3)
  expect(measureContinuity({ bones: heavy }, { ...sunk, loop: true, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.8, rotation: [0, 60, 0] }, { time: 1.6, rotation: [0, 0, 20] }] }] }, 0).faults).toContain("seam")
})

test("生物阶段的量：只量移动时放的动作，会滑行的才说，不走的、悬着的、真迈步的都没有", () => {
  const design = (clip: MotionClip) => ({ bones: heavy, animations: [{ ...clip, name: "idle" }, clip] as never })
  const gliding = design(swing(["body"], 1, 3))
  expect(glidingWalk(gliding, walkingSpeed(0.25))).toEqual({ clip: "walk", supports: 2 })
  // The same at any speed above 0, and nothing at 0: a creature that does not walk never plays it.
  expect(glidingWalk(gliding, walkingSpeed(0.05))).toMatchObject({ clip: "walk" })
  expect(glidingWalk(gliding, 0)).toBeNull()
  // A walk whose soles go back along the ground, and a model built clear of the ground, glide nowhere.
  expect(glidingWalk(design(swing(["leg_left", "leg_right"], 0, 12)), walkingSpeed(0.25))).toBeNull()
  const lifted = heavy.map((part) => ({ ...part, pivot: [part.pivot[0], part.pivot[1] + 8, part.pivot[2]] as Vec, cubes: part.cubes.map((box) => ({ ...box, origin: [box.origin[0], box.origin[1] + 8, box.origin[2]] as Vec })) }))
  expect(glidingWalk({ ...gliding, bones: lifted }, walkingSpeed(0.25))).toBeNull()
  // Clips the game does not play while it moves are not looked at.
  expect(glidingWalk({ bones: heavy, animations: [{ ...swing(["body"], 1, 3), name: "idle" }] as never }, walkingSpeed(0.25))).toBeNull()
})

test("穿插检查保留原来的峰值和时刻，挤在一起的密集模型会说明抽查覆盖", () => {
  const clip = shove("fly", 4)
  expect(measureContinuity({ bones: batLike }, clip)).toMatchObject({
    cross: { a: "body", b: "wing", more: 3, at: 0.4 }, faults: ["cross"],
  })
  expect(measureContinuity({ bones: batLike }, clip).sampling).toBeUndefined()
  const dense = batLike.map((part) => part.name === "root" ? part : {
    ...part,
    cubes: [
      part.cubes[0]!,
      ...Array.from({ length: 127 }, (_, index) =>
        cube("tile_" + index, [0, (part.name === "body" ? 1 : -1) * (50 + index * 4), 0], [1, 1, 1]),
      ),
    ],
  })
  const measured = measureContinuity({ bones: dense }, clip)
  const coverage = measured.sampling?.crossing
  expect(coverage?.checked).toBeGreaterThan(0)
  expect(coverage?.checked).toBeLessThan(coverage!.total)
  expect(measured.cross).toMatchObject({ a: "body", b: "wing" })
  expect(continuityLine({ ...note(turner, clip), continuity: measured })).toContain("部件穿插只抽查了")
  expect(continuityPlain({ ...note(turner, clip), continuity: measured })).toContainEqual(expect.stringContaining("部件穿插只抽查了"))
})
