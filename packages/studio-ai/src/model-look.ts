import { hangingBones } from "./hang-chains"
import { sampleTrack, shiftsOrScales } from "./animation"
import type { ModelDesign } from "./contracts"
import { FAULT_SLACK, STANDING_ABOVE, groundSlack, jointSlack, penetration } from "./model-motion"
import { withCube } from "./model-space"
import { MODEL_FACES, cubePaint, faceSize, luminance, modelAtlas, paintModel, texelOf, type AtlasIsland, type ModelFace } from "./model-paint"

/** A standalone texture document: palette indices on the model's atlas. */
export type LookTexture = { width: number; height: number; palette: string[]; pixels: number[] }

type Vec = [number, number, number]
type Bone = ModelDesign["bones"][number]
type Cube = Bone["cubes"][number]
type Keyframes = ModelDesign["animations"][number]["channels"][number]["keyframes"]

// Where texel (0,0) of a face sits on a cube centred at the origin (as fractions of its half size) and
// which way texel x/y run. Same convention as the editor and the game: X is mirrored, front is -Z.
const FRAMES: Record<ModelFace, { origin: Vec; u: Vec; v: Vec; normal: Vec }> = {
  east: { origin: [1, 1, 1], u: [0, 0, -1], v: [0, -1, 0], normal: [1, 0, 0] },
  west: { origin: [-1, 1, -1], u: [0, 0, 1], v: [0, -1, 0], normal: [-1, 0, 0] },
  up: { origin: [-1, 1, -1], u: [1, 0, 0], v: [0, 0, 1], normal: [0, 1, 0] },
  down: { origin: [-1, -1, 1], u: [1, 0, 0], v: [0, 0, -1], normal: [0, -1, 0] },
  south: { origin: [-1, 1, 1], u: [1, 0, 0], v: [0, -1, 0], normal: [0, 0, 1] },
  north: { origin: [1, 1, -1], u: [-1, 0, 0], v: [0, -1, 0], normal: [0, 0, -1] },
}

/**
 * Names are matched by whole words, never by a piece of a word. 10-14 (audit): the old patterns searched inside the name, so `fin` was found in
 * finger / final / refine (a wing), `face` in surface / interface (a head), `head` in warhead / arrowhead, `foot` / `leg` in footing / legend, and
 * `horn` in hornet. A name is cut into words at `_`, `-`, `.`, spaces, digits and camelCase joints (`FrontLeg2` is front, leg), and a word counts
 * when it is the keyword (or its plural) once any leading side or position words glued to it are taken off (foreleg, leftwing, hindleg) and any
 * of the few endings that only say which end of the part it is (wingtip). Names are English in the documents the standard measures (the
 * maker is told the bone names it must use), and no other script was matched before, so none is now.
 */
const SIDE = "(?:fore|hind|front|back|rear|left|right|upper|lower|mid|middle|l|r)*"
const END = "(?:tip|root|base|l|r)?"
const wordsOf = (name: string) =>
  name
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
const keyword = (words: string, sides = SIDE) => {
  const pattern = new RegExp(`^${sides}(?:${words})s?${END}$`)
  return { test: (name: string) => wordsOf(name).some((word) => pattern.test(word)) }
}
const LIMB_WORDS = keyword("leg|foot|feet|paw|hoof|hooves|thigh|shin|limb")
const WING_WORDS = keyword("wing|fin|flipper", "(?:fore|hind|front|back|rear|left|right|upper|lower|dorsal|pectoral|pelvic|anal|caudal|tail|l|r)*")
// No glued prefix for a head: forehead, overhead, warhead and behead are not heads. `skull` and `face` are kept as the old pattern had them.
const HEAD_WORDS = keyword("head|skull|face", "")
// A pair of marks is a pair of eyes when at least this much of their colour on the head is in the pair itself.
const EYE_SHARE = 0.34
/** How far a texel or a cube may differ from the ground colour of a head and still be nothing on it: the same 0.1 that makes a texel a mark in `marks`. */
const BLANK_HEAD = 0.1
const ACCENT_WORDS = keyword("horn|antler|claw|talon|tooth|teeth|fang|tusk|beak|crystal|gem|spike|eye|eyeball", "(?:left|right|upper|lower|l|r)*")

/**
 * What counts, while measuring motion: these say what a number means, they are not limits a work is held to
 * (those are beside the rules). Shared by a creature's own walk and a standalone animation.
 */
export const MOTION_MEASURES = {
  /** Degrees from which a swing is a stride: big enough that constant speed shows. */
  swing: 16,
  /** Degrees from which a part of a legless creature counts as moving it along. */
  mover: 6,
  /** Degrees from which the body, head or tail counts as following the legs. */
  follower: 1,
  /** Fastest stretch of a track over its slowest from which it counts as changing speed. */
  eased: 1.25,
  /**
   * Degrees from which a track turns all the way round on one axis: a wheel, roller or propeller, not a limb. Why a full turn: a limb swings to
   * and fro and a part that goes round a whole circle would have to pass through the body it hangs from; so a walk track that spans a turn can
   * only be something that rolls. (Audit: a cart's four wheels turning 360 degrees were taken for four legs and got the legs' gait findings.)
   */
  revolution: 360,
} as const

/** How different two colours look, 0 (same) to 1 (black against white); green counts most, as the eye does. */
export function colorDistance(a: readonly number[], b: readonly number[]) {
  return Math.sqrt((2 * (a[0]! - b[0]!) ** 2 + 4 * (a[1]! - b[1]!) ** 2 + 3 * (a[2]! - b[2]!) ** 2) / 9) / 255
}

const multiply = (a: number[], b: number[]) => Array.from({ length: 9 }, (_, index) => [0, 1, 2].reduce((sum, k) => sum + a[Math.floor(index / 3) * 3 + k]! * b[k * 3 + (index % 3)]!, 0))
const apply = (matrix: number[], point: Vec) => [0, 1, 2].map((row) => matrix[row * 3]! * point[0] + matrix[row * 3 + 1]! * point[1] + matrix[row * 3 + 2]! * point[2]) as Vec
const add = (a: Vec, b: Vec) => a.map((value, axis) => value + b[axis]!) as Vec
const subtract = (a: Vec, b: Vec) => a.map((value, axis) => value - b[axis]!) as Vec
const transpose = (matrix: number[]) => Array.from({ length: 9 }, (_, index) => matrix[(index % 3) * 3 + Math.floor(index / 3)]!)

/** Rest-pose rotation of one bone, in the mirrored coordinates the game uses: X, then Y, then Z. */
function rotation(bone: Bone) {
  const [x, y, z] = [-bone.rotation[0], -bone.rotation[1], bone.rotation[2]].map((angle) => (angle * Math.PI) / 180) as Vec
  return multiply(
    [Math.cos(z), -Math.sin(z), 0, Math.sin(z), Math.cos(z), 0, 0, 0, 1],
    multiply([Math.cos(y), 0, Math.sin(y), 0, 1, 0, -Math.sin(y), 0, Math.cos(y)], [1, 0, 0, 0, Math.cos(x), -Math.sin(x), 0, Math.sin(x), Math.cos(x)]),
  )
}

/** Value of one rotation track at a time, as the animation contract plays it. */
function sample(keyframes: Keyframes, time: number, axis: number) {
  return sampleTrack(keyframes.map((frame) => ({ time: frame.time, value: frame.rotation, interpolation: frame.interpolation })), time)?.[axis] ?? 0
}

/** How far a track swings on its busiest axis, which axis that is, and whether it ever changes speed. */
export function motion(keyframes: Keyframes) {
  // A bone that only moves or scales has no rotation keys: it does not swing at all.
  if (!keyframes.length) return { span: 0, axis: 0, eased: false }
  const spans = [0, 1, 2].map((axis) => Math.max(...keyframes.map((frame) => frame.rotation[axis]!)) - Math.min(...keyframes.map((frame) => frame.rotation[axis]!)))
  const axis = spans.indexOf(Math.max(...spans))
  const speeds = keyframes
    .slice(1)
    .map((frame, index) => Math.abs(frame.rotation[axis]! - keyframes[index]!.rotation[axis]!) / (frame.time - keyframes[index]!.time))
    .filter((speed) => speed > 0.01)
  // A curve through a key changes speed by itself; straight pieces only do when their speeds differ.
  return { span: spans[axis]!, axis, eased: keyframes.some((frame) => frame.interpolation === "smooth") || (speeds.length > 0 && Math.max(...speeds) / Math.min(...speeds) >= MOTION_MEASURES.eased) }
}

/**
 * Everything the look gate measures on a model and on the texture it wears: geometry in the rest
 * pose, the rasterised atlas restricted to texels one can actually see, and the three required animations.
 * `texture` replaces the model's own painted atlas when a standalone texture is judged.
 */
export function measureLook(design: ModelDesign, texture: LookTexture | null = null) {
  const byName = new Map(design.bones.map((bone) => [bone.name, bone]))
  // World transform of each bone: p -> R·p + t, composed from the root down.
  const worlds = new Map<string, { r: number[]; t: Vec }>()
  const world = (bone: Bone, depth = 0): { r: number[]; t: Vec } => {
    const known = worlds.get(bone.name)
    if (known) return known
    const pivot: Vec = [-bone.pivot[0], bone.pivot[1], bone.pivot[2]]
    const own = { r: rotation(bone), t: subtract(pivot, apply(rotation(bone), pivot)) }
    const parent = bone.parent && depth < design.bones.length ? byName.get(bone.parent) : undefined
    const above = parent ? world(parent, depth + 1) : null
    const result = above ? { r: multiply(above.r, own.r), t: add(apply(above.r, own.t), above.t) } : own
    worlds.set(bone.name, result)
    return result
  }
  const boxes = design.bones.flatMap((bone, boneIndex) =>
    bone.cubes.map((cube, cubeIndex) => {
      // 第 1 步: a cube turned about its own pivot, and grown by its inflate, is measured where it is drawn (`model-space.ts`).
      const placed = withCube(world(bone), cube)
      const centre: Vec = [-(cube.origin[0] + cube.size[0] / 2), cube.origin[1] + cube.size[1] / 2, cube.origin[2] + cube.size[2] / 2]
      const half = cube.size.map((value) => Math.max(0.01, value / 2 + (cube.inflate ?? 0))) as Vec
      const toWorld = (point: Vec) => add(apply(placed.r, point), placed.t)
      const corners = Array.from({ length: 8 }, (_, corner) => toWorld(add(centre, half.map((value, axis) => (corner & (1 << axis) ? value : -value)) as Vec)))
      const inverse = transpose(placed.r)
      const min = [0, 1, 2].map((axis) => Math.min(...corners.map((corner) => corner[axis]!))) as Vec
      const max = [0, 1, 2].map((axis) => Math.max(...corners.map((corner) => corner[axis]!))) as Vec
      return {
        bone,
        cube,
        boneIndex,
        cubeIndex,
        name: `${bone.name}.${cube.name}`,
        centre,
        half,
        toWorld,
        corners,
        volume: cube.size[0] * cube.size[1] * cube.size[2],
        min,
        max,
        /**
         * Is a world point inside this cube grown by `grow` on every side? A point outside the cube's upright bounds, grown by as much as
         * a turned cube grown by `grow` can reach past them (`grow` × √3), is outside the cube: said at once, the answer is the same.
         * (Engineer H2: every sample of every cube asks every other cube this; with hundreds of cubes it was where the time went.)
         */
        holds: (point: Vec, grow: number) => {
          const reach = Math.max(0, grow) * 1.7320508075688774 + 1e-6
          if (point[0] < min[0] - reach || point[0] > max[0] + reach || point[1] < min[1] - reach || point[1] > max[1] + reach || point[2] < min[2] - reach || point[2] > max[2] + reach) return false
          return subtract(apply(inverse, subtract(point, placed.t)), centre).every((value, axis) => Math.abs(value) <= half[axis]! + grow)
        },
      }
    }),
  )
  type Box = (typeof boxes)[number]
  const near = (a: Box, b: Box, grow: number) => a.min.every((value, axis) => value - grow <= b.max[axis]! && b.min[axis]! - grow <= a.max[axis]!)
  const neighbours = boxes.map((box) => boxes.filter((other) => other !== box && near(box, other, 1)))
  // A texel covers \`texel\`×\`texel\` model pixels (\`texelOf\`); its middle is kept on the face where the last one is cut short by the face's own edge.
  const texel = texelOf(design)
  const texelPoint = (box: Box, face: ModelFace, u: number, v: number, lift: number) => {
    const frame = FRAMES[face]
    const [across, down] = faceSize(box.cube.size, face)
    const at = (index: number, extent: number) => (texel === 1 ? index + 0.5 : Math.min((index + 0.5) * texel, extent - Math.min(0.5, extent / 2)))
    return box.toWorld([0, 1, 2].map((axis) => box.centre[axis]! + frame.origin[axis]! * box.half[axis]! + frame.u[axis]! * at(u, across) + frame.v[axis]! * at(v, down) + frame.normal[axis]! * lift) as Vec)
  }

  // What may be inside another part at a joint, and what may be under or off the ground, for a model this large (`FAULT_SLACK`).
  const extent = Math.max(...[0, 1, 2].map((axis) => Math.max(...boxes.map((box) => box.max[axis]!)) - Math.min(...boxes.map((box) => box.min[axis]!))))
  const joint = jointSlack(extent)
  // Two cubes are in each other *beyond a joint* when one would have to move further than the allowance to get clear of the other
  // (`penetration`, the same measure as a clip's): a leg a pixel into the trunk, a membrane on its bone, a wing root in the body are
  // not; a cube lying in another, or two that cover each other over a thick slab, are.
  const beyond = new Map<string, boolean>()
  const jointless = (a: Box, b: Box) => {
    const key = a.boneIndex < b.boneIndex || (a.boneIndex === b.boneIndex && a.cubeIndex < b.cubeIndex) ? `${a.boneIndex}/${a.cubeIndex}|${b.boneIndex}/${b.cubeIndex}` : `${b.boneIndex}/${b.cubeIndex}|${a.boneIndex}/${a.cubeIndex}`
    if (!beyond.has(key)) beyond.set(key, penetration(a.corners, b.corners) > joint)
    return beyond.get(key)!
  }

  // Geometry: how much volume is spent inside other cubes, and how lopsided the model is.
  const samples = boxes.map((box, index) => {
    const counts = box.cube.size.map((size) => Math.min(size, 6))
    return Array.from({ length: counts[0]! * counts[1]! * counts[2]! }, (_, cell) => {
      const steps = [cell % counts[0]!, Math.floor(cell / counts[0]!) % counts[1]!, Math.floor(cell / (counts[0]! * counts[1]!))]
      const point = box.toWorld(box.centre.map((value, axis) => value - box.half[axis]! + ((steps[axis]! + 0.5) * box.cube.size[axis]!) / counts[axis]!) as Vec)
      return {
        shared: neighbours[index]!.filter((other) => other.holds(point, -0.01)).length,
        deep: neighbours[index]!.filter((other) => other.holds(point, -0.01) && jointless(box, other)).length,
        mirrored: boxes.some((other) => other.holds([-point[0], point[1], point[2]], 0.6)),
        weight: box.volume / (counts[0]! * counts[1]! * counts[2]!),
      }
    })
  })
  const volume = boxes.reduce((sum, box) => sum + box.volume, 0)
  const union = samples.flat().reduce((sum, value) => sum + value.weight / (value.shared + 1), 0)
  const deepUnion = samples.flat().reduce((sum, value) => sum + value.weight / (value.deep + 1), 0)
  const lopsided = samples.flat().reduce((sum, value) => sum + (value.mirrored ? 0 : value.weight / (value.shared + 1)), 0)

  // Surface: which texels of every face can be seen at all.
  const islands = modelAtlas(design)
  const boxAt = new Map(boxes.map((box) => [`${box.boneIndex}/${box.cubeIndex}`, box]))
  const visible = islands.map((island) => {
    const box = boxAt.get(`${island.boneIndex}/${island.cubeIndex}`)!
    const others = neighbours[boxes.indexOf(box)]!
    return Array.from({ length: island.width * island.height }, (_, index) => {
      const point = texelPoint(box, island.face, index % island.width, Math.floor(index / island.width), 0.3)
      return !others.some((other) => other.holds(point, 0))
    })
  })
  const seen = boxes.map((box) => {
    const own = islands.map((island, index) => (island.boneIndex === box.boneIndex && island.cubeIndex === box.cubeIndex ? visible[index]! : [])).flat()
    return own.filter(Boolean).length / Math.max(1, own.length)
  })

  // Contact: cubes that touch form groups; anything outside the biggest group floats.
  const group = boxes.map((_, index) => index)
  const find = (index: number): number => (group[index] === index ? index : (group[index] = find(group[index]!)))
  boxes.forEach((box, index) =>
    boxes.slice(index + 1).forEach((other, offset) => {
      if (find(index) === find(index + 1 + offset) || !near(box, other, FAULT_SLACK.gap)) return
      const reach = (a: Box, b: Box) =>
        MODEL_FACES.some((face) => {
          const size = faceSize(a.cube.size, face, texel)
          return Array.from({ length: size[0] * size[1] }, (_, texel) => texelPoint(a, face, texel % size[0], Math.floor(texel / size[0]), 0)).some((point) => b.holds(point, FAULT_SLACK.gap))
        })
      if (reach(box, other) || reach(other, box)) group[find(index)] = find(index + 1 + offset)
    }),
  )
  const groupVolume = boxes.reduce((map, box, index) => map.set(find(index), (map.get(find(index)) ?? 0) + box.volume), new Map<number, number>())
  const mainGroup = [...groupVolume.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const floating = boxes.filter((_, index) => find(index) !== mainGroup).map((box) => box.name)

  // Body plan: limbs that carry the body, wings, and the head.
  const ground = Math.min(...boxes.map((box) => box.min[1]))
  const top = Math.max(...boxes.map((box) => box.max[1]))
  const slack = { joint: joint, ground: groundSlack(top - ground) }
  const root = design.bones.find((bone) => bone.parent === null)
  // A part is a bone with everything that hangs from it: a leg includes its foot, a head its jaw and horns.
  const within = (bone: Bone, ancestor: Bone, depth = 0): boolean => bone === ancestor || (bone.parent !== null && depth < design.bones.length && within(byName.get(bone.parent) ?? ancestor, ancestor, depth + 1) && byName.has(bone.parent))
  const parts = design.bones
    .map((bone) => ({ bone, own: boxes.filter((box) => within(box.bone, bone)) }))
    .filter((part) => part.own.length > 0)
    .map((part) => ({
      bone: part.bone,
      boxes: part.own,
      min: [0, 1, 2].map((axis) => Math.min(...part.own.map((box) => box.min[axis]!))) as Vec,
      max: [0, 1, 2].map((axis) => Math.max(...part.own.map((box) => box.max[axis]!))) as Vec,
      pivot: add(apply(world(part.bone).r, [-part.bone.pivot[0], part.bone.pivot[1], part.bone.pivot[2]]), world(part.bone).t),
      volume: part.own.reduce((sum, box) => sum + box.volume, 0),
    }))
  // Parts that turn all the way round in the walk clip (`MOTION_MEASURES.revolution`) roll; so does everything that hangs from one. They are not legs, whatever they are called or look like.
  const rolling = parts.filter((part) => (design.animations.find((animation) => animation.name === "walk")?.channels ?? []).some((channel) => channel.bone === part.bone.name && motion(channel.keyframes).span >= MOTION_MEASURES.revolution))
  const hanging = hangingBones(design)
  const limbLike = parts.filter((part) => {
    if (part.bone === root || hanging.has(part.bone.name) || WING_WORDS.test(part.bone.name) || HEAD_WORDS.test(part.bone.name) || rolling.some((wheel) => within(part.bone, wheel.bone))) return false
    if (LIMB_WORDS.test(part.bone.name)) return true
    // An unnamed limb: stands on the ground, hangs from a joint above it, is taller than wide and is not the body itself.
    // broad4: what hangs under a thing that is built up in the air (a jellyfish's tentacles) carries nothing, so it is no leg;
    // only a model that is built standing on y = 0 (within `STANDING_ABOVE`, the off-ground rule's and the clip measure's one pixel) has unnamed legs.
    const height = part.max[1] - part.min[1]
    return ground <= STANDING_ABOVE && ground >= -slack.ground && part.min[1] <= ground + 1.5 && part.pivot[1] >= part.min[1] + 2 && height >= Math.max(part.max[0] - part.min[0], part.max[2] - part.min[2]) && part.volume < volume * 0.3
  })
  // A shin or a foot under a leg is part of that leg, not another limb.
  const limbs = limbLike.filter((part) => !limbLike.some((other) => other !== part && within(part.bone, other.bone)))
  const wings = parts.filter((part) => WING_WORDS.test(part.bone.name))
  const span = [0, 2].map((axis) => Math.max(...boxes.map((box) => box.max[axis]!)) - Math.min(...boxes.map((box) => box.min[axis]!)))
  const plan =
    wings.length >= 2 ? "flyer" : limbs.length === 2 ? "biped" : limbs.length === 4 ? "quadruped" : limbs.length >= 6 ? "crawler" : limbs.length > 0 ? "other" : Math.max(...span) >= (top - ground) * 2.5 ? "serpent" : "blob"
  const headBone = design.bones.find((bone) => HEAD_WORDS.test(bone.name) && bone.cubes.length > 0) ?? design.bones.find((bone) => bone.cubes.some((cube) => HEAD_WORDS.test(cube.name)))
  // Without a head, a blob wears its face on its body.
  const headBoxes = headBone ? boxes.filter((box) => within(box.bone, headBone)) : plan === "blob" ? boxes.filter((box) => box.bone === [...design.bones].sort((a, b) => boxes.filter((box) => box.bone === b).reduce((sum, box) => sum + box.volume, 0) - boxes.filter((box) => box.bone === a).reduce((sum, box) => sum + box.volume, 0))[0]) : []
  const pivots = parts
    .filter((part) => part.bone !== root)
    .map((part) => ({
      bone: part.bone.name,
      limb: limbs.includes(part),
      // Distance from the joint to the part it turns, and how far down the part the joint sits (0 top, 1 bottom).
      gap: Math.hypot(...part.pivot.map((value, axis) => Math.max(0, part.min[axis]! - value, value - part.max[axis]!))),
      depth: (part.max[1] - part.pivot[1]) / Math.max(1, part.max[1] - part.min[1]),
    }))

  // The atlas as it will be seen.
  const size = design.texture_size
  const painted = texture ? null : paintModel(design).pixels
  const colors = texture?.palette.map((value) => [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16)))
  const pixel = (x: number, y: number) => (painted ? [painted[(y * size + x) * 4]!, painted[(y * size + x) * 4 + 1]!, painted[(y * size + x) * 4 + 2]!] : colors![texture!.pixels[y * texture!.width + x]!]!)
  const fits = !texture || (texture.width === size && texture.height === size)
  // Tones: colours close enough to read as one are counted as one.
  const tones: number[][] = []
  const toneOf = new Map<number, number>()
  const tone = (color: number[]) => {
    const key = (color[0]! << 16) | (color[1]! << 8) | color[2]!
    const known = toneOf.get(key)
    if (known !== undefined) return known
    const match = tones.findIndex((value) => colorDistance(value, color) < 0.03)
    const index = match === -1 ? tones.push(color) - 1 : match
    toneOf.set(key, index)
    return index
  }
  const faces = islands.map((island, index) => {
    const mask = visible[index]!
    const grid = Array.from({ length: island.width * island.height }, (_, texel) => (fits ? pixel(island.x + (texel % island.width), island.y + Math.floor(texel / island.width)) : [0, 0, 0]))
    const shown = grid.filter((_, texel) => mask[texel])
    const toneCount = shown.reduce((map, color) => map.set(tone(color), (map.get(tone(color)) ?? 0) + 1), new Map<number, number>())
    const at = (u: number, v: number) => (u >= 0 && v >= 0 && u < island.width && v < island.height && mask[v * island.width + u] ? grid[v * island.width + u]! : null)
    const around = (texel: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map((step) => at((texel % island.width) + step[0]!, Math.floor(texel / island.width) + step[1]!)).filter((value) => value !== null)
    return {
      island,
      grid,
      mask,
      area: shown.length,
      mean: [0, 1, 2].map((channel) => shown.reduce((sum, color) => sum + color[channel]!, 0) / Math.max(1, shown.length)),
      toneCount,
      /** The ground colour of the face: its most common tone. */
      skin: tones[[...toneCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0] ?? [0, 0, 0],
      // A lone texel that matches none of its neighbours is a speck; many of them are noise.
      specks: grid.filter((color, texel) => mask[texel] && around(texel).length >= 2 && around(texel).every((other) => colorDistance(color, other) >= 0.1)).length,
      inner: grid.filter((_, texel) => mask[texel] && around(texel).length >= 2).length,
    }
  })
  const shownArea = faces.reduce((sum, face) => sum + face.area, 0)
  const allTones = faces.reduce((map, face) => (face.toneCount.forEach((count, key) => map.set(key, (map.get(key) ?? 0) + count)), map), new Map<number, number>())
  const large = faces.filter((face) => face.area >= 8)
  const largeArea = large.reduce((sum, face) => sum + face.area, 0)
  // How much a face's mix of tones is simply the mix of the whole model: 1 when the same fill is poured over every
  // part and direction, low when parts and directions each have their own tones.
  const mixArea = large.reduce((map, face) => (face.toneCount.forEach((count, key) => map.set(key, (map.get(key) ?? 0) + count)), map), new Map<number, number>())
  const sameMix = large.reduce((sum, face) => sum + face.area * [...mixArea.entries()].reduce((overlap, entry) => overlap + Math.min(entry[1] / Math.max(1, largeArea), (face.toneCount.get(entry[0]) ?? 0) / face.area), 0), 0)
  const facesOf = (box: Box) => faces.filter((face) => face.island.boneIndex === box.boneIndex && face.island.cubeIndex === box.cubeIndex)
  // The ground tone of a set of faces: their most common tone, so stripes and spots on a back do not count as shade.
  const light = (list: typeof faces) =>
    luminance(tones[[...list.reduce((map, face) => (face.toneCount.forEach((count, key) => map.set(key, (map.get(key) ?? 0) + count)), map), new Map<number, number>()).entries()].sort((a, b) => b[1] - a[1])[0]![0]]!)
  const lit = boxes
    .map((box) => ({ up: facesOf(box).filter((face) => face.island.face === "up" && face.area >= 4), sides: facesOf(box).filter((face) => face.island.face !== "up" && face.island.face !== "down" && face.area >= 4) }))
    .filter((value) => value.up.length > 0 && value.sides.length > 0)
  const meanOf = (list: Box[]) => {
    const own = list.flatMap(facesOf)
    return [0, 1, 2].map((channel) => own.reduce((sum, face) => sum + face.mean[channel]! * face.area, 0) / Math.max(1, own.reduce((sum, face) => sum + face.area, 0)))
  }
  const accents = boxes.filter((box, index) => seen[index]! > 0 && (ACCENT_WORDS.test(box.cube.name) || ACCENT_WORDS.test(box.bone.name)))
  const plain = meanOf(boxes.filter((box) => !accents.includes(box)))

  // The face: what the head shows from the front and from each side, searched for a matching pair of eyes.
  const headMap = (face: "north" | "east" | "west") => {
    const [across, depth, sign] = face === "north" ? [0, 2, 1] : face === "east" ? [2, 0, 1] : [2, 0, -1]
    const from = Math.floor(Math.min(...headBoxes.map((box) => box.cube.origin[across]!)))
    const width = Math.ceil(Math.max(...headBoxes.map((box) => box.cube.origin[across]! + box.cube.size[across]!))) - from
    const low = Math.floor(Math.min(...headBoxes.map((box) => box.cube.origin[1])))
    const height = Math.ceil(Math.max(...headBoxes.map((box) => box.cube.origin[1] + box.cube.size[1]))) - low
    return {
      width,
      height,
      grid: Array.from({ length: Math.max(0, width * height) }, (_, index) => {
        const a = from + (index % width) + 0.5
        const y = low + height - 1 - Math.floor(index / width) + 0.5
        // The cube nearest the viewer at this spot; its own face texel is what one sees.
        // A cube shows at the cells its bounds cover once rounded to whole pixels, halves upwards. For cubes on whole pixels that is the same as
        // holding the cell's middle; one half a pixel off the grid shows in one of the two cells it straddles, the upper or right one, instead of
        // always the lower or left one (broad15: a gull's eyes at y 8.5–9.5 on a two-pixel head were read as sitting in its bottom row, below where
        // eyes go, and moving them up half a pixel alone passed). Halves upwards, not both cells: a one-pixel eye stays one cell, not four.
        const covers = (origin: number, size: number, centre: number) => Math.round(origin) <= centre - 0.5 && centre - 0.5 < Math.round(origin + size)
        const [front, behind] = headBoxes
          .filter((box) => covers(box.cube.origin[across]!, box.cube.size[across]!, a) && covers(box.cube.origin[1], box.cube.size[1], y))
          .sort((p, q) => sign * (p.cube.origin[depth]! + (sign < 0 ? p.cube.size[depth]! : 0)) - sign * (q.cube.origin[depth]! + (sign < 0 ? q.cube.size[depth]! : 0)))
        const found = front && facesOf(front).find((value) => value.island.face === face)
        if (!front || !found) return null
        // A one-colour cube stuck on the head (a bead eye, a dark socket, a nose) has no skin of its own: it is judged against what it sits on.
        const under = found.toneCount.size <= 1 && behind ? facesOf(behind).find((value) => value.island.face === face) : undefined
        const u = Math.floor(face === "east" ? front.cube.origin[2] + front.cube.size[2] - a : a - front.cube.origin[across]!)
        // A cube that is turned has spots this straight-on sampling misses: those are simply not seen. One that sits half a pixel off the grid is
        // still seen: the sample point is inside the cube (the filter above), but its distance from the cube's top or side edge can come to exactly the
        // face's size and point one texel past the face. broad15: a gull's 1x1 bead eyes at y 8.5 were read as no eyes at all, and moving them to 9 alone
        // passed. The texel the point stands on is the last one of the face, so the index is kept inside it.
        const rows = Math.max(1, Math.floor(found.grid.length / found.island.width))
        const row = Math.min(rows - 1, Math.max(0, Math.floor((front.cube.origin[1] + front.cube.size[1] - y) / texel)))
        const column = Math.min(found.island.width - 1, Math.max(0, Math.floor(u / texel)))
        const color = found.grid[row * found.island.width + column]
        // `bead` is the cube itself when it is such a stuck-on one-colour cube, so a matched pair of eyes knows which cubes it is made of.
        return color ? { color, skin: (under ?? found).skin, bead: under ? front : null } : null
      }),
    }
  }
  /** Small marks that stand out from the skin of the cube they are on: each a patch of touching texels of one colour. */
  const marks = (map: ReturnType<typeof headMap>) => {
    const filled = map.grid.filter((value) => value !== null)
    const stands = map.grid.map((cell) => cell !== null && colorDistance(cell.color, cell.skin) >= 0.1)
    const beside = (texel: number) => [texel - map.width, texel + map.width, texel % map.width > 0 ? texel - 1 : -1, texel % map.width < map.width - 1 ? texel + 1 : -1]
    const label = stands.map(() => -1)
    const patches: number[][] = []
    stands.forEach((value, start) => {
      if (!value || label[start] !== -1) return
      const patch = [start]
      label[start] = patches.length
      for (let cursor = 0; cursor < patch.length; cursor++) {
        const texel = patch[cursor]!
        beside(texel)
          .filter((other) => other >= 0 && other < stands.length && stands[other] && label[other] === -1 && colorDistance(map.grid[other]!.color, map.grid[texel]!.color) < 0.06)
          .forEach((other) => {
            label[other] = patches.length
            patch.push(other)
          })
      }
      patches.push(patch)
    })
    return patches
      .filter((patch) => patch.length <= filled.length * 0.4)
      .map((patch) => {
        const xs = patch.map((texel) => texel % map.width)
        const ys = patch.map((texel) => Math.floor(texel / map.width))
        const color = map.grid[patch[0]!]!.color
        // Only cells inside the head's outline grid say anything about the mark's surroundings: an empty one is air (null), a filled one is skin.
        // A neighbour beyond the grid edge is not looked at at all, neither as air nor in the denominator: the grid is just the head's bounding
        // box, so on a small head an eye at the corner of the face has most of its neighbours outside it, and that is no evidence of air.
        const inGrid = (list: number[]) => list.filter((other) => other >= 0 && other < map.grid.length && !patch.includes(other)).map((other) => map.grid[other]!)
        const around = inGrid(patch.flatMap(beside))
        // A horn or an ear sticks out: along one direction (across, or up and down) it has air beside it and no skin on either side. Without the
        // grid edge counted as air, a horn at the edge of the grid (the outermost horn of a wide head, or its tip on the top row) has only one
        // flank left in the grid, and that alone can stay under `open`'s limit, so this says the same thing the edge used to say by accident.
        const stalk = [patch.flatMap((texel) => [texel % map.width > 0 ? texel - 1 : -1, texel % map.width < map.width - 1 ? texel + 1 : -1]), patch.flatMap((texel) => [texel - map.width, texel + map.width])].some((flank) => {
          const cells = inGrid(flank)
          return cells.length > 0 && cells.every((cell) => cell === null)
        })
        return {
          size: patch.length,
          /** The stuck-on cubes this mark is painted by. */
          beads: patch.map((texel) => map.grid[texel]!.bead).filter((bead) => bead !== null),
          x: (Math.min(...xs) + Math.max(...xs) + 1) / 2,
          y: (Math.min(...ys) + Math.max(...ys) + 1) / 2,
          width: Math.max(...xs) - Math.min(...xs) + 1,
          color,
          // How much the mark differs from the texels right around it (those inside the grid): that is what makes an eye readable.
          strength: around.reduce((sum, cell) => sum + (cell ? colorDistance(color, cell.color) : 0), 0) / Math.max(1, around.filter((cell) => cell !== null).length),
          stalk,
          // A mark sits in the skin; a patch with mostly air around it is a horn or an ear, not an eye.
          open: around.filter((cell) => cell === null).length / Math.max(1, around.length),
          // An eye colour belongs to the eyes; a colour sprinkled over the whole head is a pattern.
          share: patch.length / filled.filter((cell) => colorDistance(cell.color, color) < 0.03).length,
          small: patch.length <= Math.max(6, filled.length * 0.14),
          // One joined shape can still be a face (a creeper's): some upper row holds two eyes of it, mirrored, with skin between.
          twin: ys.some((row) => {
            const run = xs.filter((_, index) => ys[index] === row)
            return row < map.height * 0.7 && run.length >= 2 && run.length <= map.width * 0.9 && run.every((x) => run.includes(map.width - 1 - x) && Math.abs(x - (map.width - 1) / 2) >= 1)
          }),
        }
      })
      .filter((mark) => mark.strength >= 0.16 && mark.open <= 0.34 && !mark.stalk && (mark.twin || (mark.small && mark.width <= map.width * 0.45 && mark.y <= map.height * 0.7)))
  }
  const front = headBoxes.length > 0 && fits ? headMap("north") : null
  const frontMarks = front ? marks(front) : []
  type Mark = ReturnType<typeof marks>[number]
  /**
   * Every set of marks that reads as the front pair of eyes (one joined mark, or a mirrored two). All of them are kept, not just the first:
   * the cubes of every pair the gate accepts are eyes to it, whichever pair happened to be found first.
   */
  const frontEyes = frontMarks.flatMap((a): Mark[][] =>
    a.twin && a.share >= EYE_SHARE
      ? [[a]]
      : frontMarks.filter((b) => a !== b && a.small && b.small && a.x + a.width / 2 <= front!.width / 2 && colorDistance(a.color, b.color) < 0.06 && Math.abs(a.x + b.x - front!.width) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.min(a.size, b.size) / Math.max(a.size, b.size) >= 0.5 && a.share + b.share >= EYE_SHARE).map((b) => [a, b]),
  )
  const frontPair = frontEyes.length > 0
  const cheeks = headBoxes.length > 0 && fits && !frontPair ? [headMap("east"), headMap("west")].map((map) => ({ map, marks: marks(map) })) : []
  const sideEyes = cheeks.length === 2 ? cheeks[0]!.marks.flatMap((a) => cheeks[1]!.marks.filter((b) => a.small && b.small && colorDistance(a.color, b.color) < 0.06 && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && a.share >= EYE_SHARE && b.share >= EYE_SHARE).map((b) => [a, b])) : []
  const sidePair = sideEyes.length > 0
  /** Cubes that form the detected pair of eyes (one-colour bead cubes on the head): eyes, not fragments. */
  const eyeCubes = new Set([...frontEyes, ...sideEyes].flatMap((pair) => pair.flatMap((mark) => mark.beads)))
  /**
   * A head with nothing on it at all: on the faces a face could be on (front, both sides, top) every texel is its own face's ground colour, and every cube of the head
   * has the ground of the biggest one, side for side. Not the absence of a pair of eyes (that is what `eyes` says, and it has places it does not look: eyes on stalks,
   * on top, very small), but the absence of anything that could be one: no colour, no mark, no cube of another colour. Shading does not count (a top lighter than a
   * side is compared with other tops), and a texture that does not fit the model shows nothing, so nothing is claimed of it.
   */
  const faceFaces = headBoxes.flatMap(facesOf).filter((face) => face.area > 0 && ["north", "east", "west", "up"].includes(face.island.face))
  const blankHead =
    fits &&
    faceFaces.length > 0 &&
    faceFaces.every((face) => {
      const ground = faceFaces.filter((other) => other.island.face === face.island.face).sort((a, b) => b.area - a.area)[0]!.skin
      return colorDistance(face.skin, ground) < BLANK_HEAD && face.grid.every((color, texel) => !face.mask[texel] || colorDistance(color, face.skin) < BLANK_HEAD)
    })

  // Surface details written by hand: copies and ones nobody can see.
  const details = boxes.flatMap((box) => box.cube.surface_details.map((detail) => ({ box, detail })))
  const detailKinds = boxes.filter((box) => box.cube.surface_details.length > 0).map((box) => box.cube.surface_details.map((detail) => `${detail.face},${detail.x},${detail.y},${detail.width},${detail.height}`).sort().join(";"))
  const hiddenDetails = details.filter((value) => {
    const face = facesOf(value.box).find((entry) => entry.island.face === value.detail.face)!
    const base = [1, 3, 5].map((start) => Number.parseInt(value.box.cube.faces[value.detail.face].slice(start, start + 2), 16))
    const own = [1, 3, 5].map((start) => Number.parseInt(value.detail.color.slice(start, start + 2), 16))
    const shows = Array.from({ length: value.detail.width * value.detail.height }, (_, texel) => face.mask[(value.detail.y + Math.floor(texel / value.detail.width)) * face.island.width + value.detail.x + (texel % value.detail.width)]).some(Boolean)
    return !shows || (!cubePaint(design, value.box.bone, value.box.cube) && colorDistance(base, own) < 0.04)
  })
  // The same cube made twice: same place, same size. One of the two adds nothing.
  const twins = boxes.filter((box, index) => boxes.slice(0, index).some((other) => [...box.min, ...box.max].every((value, axis) => Math.abs(value - [...other.min, ...other.max][axis]!) < 0.01))).map((box) => box.name)

  // Motion.
  const moving = new Set(parts.map((part) => part.bone.name))
  design.bones.forEach((bone) => {
    const climb = (name: string | null, depth: number): void => {
      const parent = name ? byName.get(name) : undefined
      if (!parent || depth > design.bones.length) return
      if (moving.has(bone.name)) moving.add(parent.name)
      climb(parent.parent, depth + 1)
    }
    climb(bone.parent, 0)
  })
  const tracks = (name: string) =>
    (design.animations.find((animation) => animation.name === name)?.channels ?? []).filter((channel) => moving.has(channel.bone)).map((channel) => ({ bone: channel.bone, keyframes: channel.keyframes, ...motion(channel.keyframes), shifts: shiftsOrScales(channel) }))
  const walk = tracks("walk")
  const walkLength = design.animations.find((animation) => animation.name === "walk")?.length ?? 1
  const stride = limbs.map((limb) => ({ limb, track: walk.find((track) => track.bone === limb.bone.name) }))
  const pairs = limbs.flatMap((a, index) => limbs.slice(index + 1).filter((b) => Math.abs(a.pivot[0] + b.pivot[0]) <= 1 && Math.abs(a.pivot[2] - b.pivot[2]) <= 1 && Math.abs(a.pivot[0]) > 0.4).map((b) => [a, b] as const))
  const opposed = pairs.map((pair) => {
    const [a, b] = pair.map((limb) => walk.find((track) => track.bone === limb.bone.name))
    if (!a || !b || a.span < 1 || b.span < 1) return null
    const curve = (track: NonNullable<typeof a>) => Array.from({ length: 24 }, (_, step) => sample(track.keyframes, (step / 24) * walkLength, track.axis))
    const centred = [curve(a), curve(b)].map((values) => values.map((value) => value - values.reduce((sum, entry) => sum + entry, 0) / values.length))
    const dot = (p: number[], q: number[]) => p.reduce((sum, value, index) => sum + value * q[index]!, 0)
    return dot(centred[0]!, centred[1]!) / Math.max(0.0001, Math.sqrt(dot(centred[0]!, centred[0]!) * dot(centred[1]!, centred[1]!)))
  })
  const hurt = design.animations.find((animation) => animation.name === "hurt")
  const hurtPeak = (hurt?.channels ?? [])
    .filter((channel) => moving.has(channel.bone))
    .flatMap((channel) => channel.keyframes.map((frame) => ({ time: frame.time, turn: Math.max(...frame.rotation.map((value, axis) => Math.abs(value - channel.keyframes[0]!.rotation[axis]!))) })))
    .sort((a, b) => b.turn - a.turn)[0]

  return {
    plan,
    fits,
    head: headBone?.name ?? null,
    hasFaceSurface: headBoxes.length > 0,
    blankHead,
    cubes: boxes.length,
    bones: design.bones.length,
    /** Cubes one can see at least a tenth of. */
    visibleCubes: seen.filter((share) => share >= 0.1).length,
    hiddenCubes: boxes.filter((_, index) => seen[index]! < 0.02).map((box) => box.name),
    /** Share of all cube volume that sits inside another cube. */
    buriedShare: volume === 0 ? 0 : 1 - union / volume,
    /**
     * The same, counting only cubes that are in each other beyond a joint (`jointless`: further than `slack.joint` from clear of each other).
     * The rule reads this one. 10-14 (owner: only what a player sees): volume inside other cubes is hidden by definition, so what makes
     * it a fault is that it is a pile and not a joint.
     */
    deepBuriedShare: volume === 0 ? 0 : Math.max(0, 1 - deepUnion / volume),
    /** Model pixels a joint may be inside another part, and the ground may be above or below the lowest point, for a model this size (`FAULT_SLACK`). */
    slack,
    /**
     * Cubes with more than three quarters of their surface covered that also overlap another cube. broad3: a box that only lies face to
     * face with its neighbours (a round part sampled into boxes) spends no volume twice, and was told "0% of the volume is buried" beside
     * a list of buried boxes; the rule is about overlap, so overlap is what counts.
     */
    buriedCubes: boxes.filter((_, index) => seen[index]! < 0.25 && samples[index]!.some((sample) => sample.shared > 0)).map((box) => box.name),
    // A bead eye is a cube of one or two cells and the detector above accepts it as an eye, so it is not also a fragment the maker is told to paint away.
    tinyCubes: boxes.filter((box) => box.volume <= 2 && !eyeCubes.has(box)).map((box) => box.name),
    floating,
    ground,
    height: top - ground,
    lopsidedShare: union === 0 ? 0 : lopsided / union,
    limbs: limbs.map((limb) => limb.bone.name),
    wings: wings.map((wing) => wing.bone.name),
    hangingLimbs: limbs.filter((limb) => limb.min[1] > ground + slack.ground).map((limb) => limb.bone.name),
    limbShare: limbs.length === 0 ? 0 : Math.max(...limbs.map((limb) => limb.max[1] - limb.min[1])) / Math.max(1, top - ground),
    headShare: headBone ? headBoxes.reduce((sum, box) => sum + box.volume, 0) / Math.max(1, volume) : 0,
    pivots,
    // Texture.
    tones: [...allTones.values()].filter((count) => count >= shownArea * 0.004).length,
    /** Share of the larger faces that are (nearly) one single colour. */
    flatShare: largeArea === 0 ? 0 : large.filter((face) => Math.max(...face.toneCount.values()) >= face.area * 0.9).reduce((sum, face) => sum + face.area, 0) / largeArea,
    /** How far the fill ignores what it is painted on: 1 when every face carries the model's overall mix of tones. */
    sameFillShare: largeArea === 0 || large.length < 6 ? 0 : sameMix / largeArea,
    speckShare: faces.reduce((sum, face) => sum + face.specks, 0) / Math.max(1, faces.reduce((sum, face) => sum + face.inner, 0)),
    /** Share of cubes whose top and sides differ in tone at all: none means no light falls on the model. */
    shadedShare: lit.length < 3 ? 1 : lit.filter((value) => Math.abs(light(value.up) - light(value.sides)) >= 0.008).length / lit.length,
    /** Named horns, claws, crystals… that look like the body around them. */
    blendedAccents: accents.filter((box) => colorDistance(meanOf([box]), plain) < 0.05).map((box) => box.name),
    accents: accents.length,
    eyes: frontPair || sidePair,
    // Hand-written details.
    surfaceDetails: details.length,
    copiedDetails: detailKinds.length < 5 ? 0 : Math.max(...[...detailKinds.reduce((map, kind) => map.set(kind, (map.get(kind) ?? 0) + 1), new Map<string, number>()).values()]) / detailKinds.length,
    hiddenDetailShare: details.length < 3 ? 0 : hiddenDetails.length / details.length,
    /** Cubes that repeat an earlier cube exactly. */
    twinCubes: twins,
    // Motion.
    walkLimbs: stride.filter((value) => (value.track?.span ?? 0) >= MOTION_MEASURES.swing).length,
    stillLegs: stride.filter((value) => (value.track?.span ?? 0) < MOTION_MEASURES.swing).map((value) => value.limb.bone.name),
    /** Left/right legs of a pair: -1 is exactly opposite, +1 is moving together; null when there are no pairs. */
    walkPhase: opposed.some((value) => value !== null) ? Math.max(...opposed.flatMap((value) => (value === null ? [] : [value]))) : null,
    walkStiff: stride.filter((value) => value.track && value.track.span >= MOTION_MEASURES.swing && !value.track.eased).map((value) => value.limb.bone.name),
    walkOthers: walk.filter((track) => !limbs.some((limb) => limb.bone.name === track.bone) && (track.span >= MOTION_MEASURES.follower || track.shifts)).length,
    walkMovers: walk.filter((track) => track.span >= MOTION_MEASURES.mover || track.shifts).length,
    idleSpan: Math.max(0, ...tracks("idle").map((track) => track.span)),
    /** Parts that idle or hurt moves or scales (position and scale tracks), whatever they turn. */
    idleShifts: tracks("idle").filter((track) => track.shifts).length,
    hurtShifts: tracks("hurt").filter((track) => track.shifts).length,
    hurtLength: hurt?.length ?? 0,
    hurtTurn: hurtPeak?.turn ?? 0,
    hurtPeakAt: hurtPeak && hurt ? hurtPeak.time / hurt.length : 0,
  }
}

export type LookMetrics = ReturnType<typeof measureLook>
export type { AtlasIsland }
