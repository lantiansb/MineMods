import { channelTracks, sampleTrack, type ClipChannel } from "@minemods/studio-ai/animation"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { Flight } from "./entity-runtime"
import { flightMotions } from "./flight-words"

/**
 * How far a creature's model really reaches, in every pose its motions take (not only the one it is built in), and what the game
 * has to be told about it so that the parts that stick out of its collision box are not cut away, nor the creature dropped from
 * a player's game while it is still in sight. `modelBounds` (model-bounds.ts, and with it the `visible_bounds_*` of the geometry
 * file) is the built pose only; GeckoLib 4.8.3 reads those three numbers and nothing uses them (no class of the jar but the
 * reader of the file mentions them, checked on the jar), so they never decided what is culled.
 *
 * The game culls an entity by `Entity.getVisibilityBoundingBox()` widened by half a block (`EntityRenderer.shouldRender`, read with
 * javap), and that box is the collision box unless the entity says otherwise. Server-side, a player is sent an entity only within
 * `EntityType.getMaxTrackDistance()` chunks of it, measured on the ground plane (`ServerChunkLoadingManager.EntityTracker`).
 * Nothing here knows a subject: it is arithmetic on the document's bones, cubes and keys.
 */

/**
 * - `slack`: blocks the game already allows on each side of the collision box before culling an entity (the 0.5 of
 *   `EntityRenderer.shouldRender`). A model that stays inside it needs nothing said, which keeps every creature whose model fits
 *   exactly as it was generated before.
 * - `turn`: degrees. A pose is taken whenever a bone has turned this much since the pose before (its three angles added; and at every key). Between two
 *   poses a point on a turning bone runs along an arc and not along the chord, so it goes beyond what the two poses show by at most
 *   r(1 − cos(turn/2)) of its distance r from the bone's pivot: 0.86% at 15 degrees, which `modelReach` adds back (`margin`).
 * - `curve`: poses taken inside one stretch between two keys when it is a smooth curve, which can run beyond both its keys (the
 *   spline overshoots). Eight, so the stretch is seen at every eighth of its length.
 * - `grid`: most places at which one bone's turn between two keys is looked at, to cut it where it is fast (a third of `turn` apart where it can be).
 * - `poses`: most poses taken of one motion; a motion with more is sampled evenly (its keys are 60 a track at the most, and many
 *   tracks share their times, so a real one is far below). Each pose costs about 25 operations a cube corner: 240 poses of each of
 *   the 32 motions of the epic tier on its 1024 cubes is about 63 million, around a second here, and a motion nearer to ordinary
 *   costs a few milliseconds.
 * - `chunk`: blocks in a chunk.
 * - `tracking`: chunks. `least` is what `EntityType.Builder` gives an entity that says nothing (5, 80 blocks; read with javap),
 *   so nothing is written below it. `most` is 16, the largest range any entity of the game other than the player sets for itself
 *   (the warden, the end crystal and the lightning bolt; the ender dragon's is 10, the player's 32; read from the static
 *   initialiser of `EntityType` with javap -c). The server's view distance cuts a range further whatever it is.
 * - `draw`: the game draws an entity within 64 times the average side of its collision box (`Entity.shouldRender(double)`, javap; it measures
 *   `getBoundingBox()`, not the visibility box). A creature whose model reaches beyond its box is meant to be seen as far away as the game would
 *   draw it, so a player is sent it that far, if the model needs the visibility box at all.
 */
export const REACH = { slack: 0.5, turn: 15, curve: 8, grid: 64, poses: 240, chunk: 16, tracking: { least: 5, most: 16 }, draw: 64 } as const

type Vec = readonly [number, number, number]
const ONE: Vec = [1, 1, 1]
const ZERO: Vec = [0, 0, 0]

/** A bone ready for posing: where it hangs, and the corners of its cubes relative to its pivot (x, y, z, x, y, z …) in model pixels. */
type Rigged = { name: string; parent: number; pivot: Vec; angles: Vec; corners: Float64Array; /** The middle of the corners and the farthest any is from it: a ball that holds the bone's cubes. */ centre: Vec; radius: number }

/** The model pixels in a block. */
const PIXELS = 16

/** The bones, each after the one it hangs from (a bone whose parent is not in the model hangs from nothing; a loop is cut where it closes). */
function rig(design: Pick<ModelDesign, "bones">): Rigged[] {
  const index = new Map(design.bones.map((bone, at) => [bone.name, at]))
  const order: number[] = []
  const seen = new Set<number>()
  const place = (at: number, depth: number) => {
    if (seen.has(at)) return
    seen.add(at)
    const parent = design.bones[at]!.parent === null ? undefined : index.get(design.bones[at]!.parent!)
    if (parent !== undefined && depth < design.bones.length) place(parent, depth + 1)
    order.push(at)
  }
  design.bones.forEach((_, at) => place(at, 0))
  const row = new Map(order.map((at, position) => [at, position]))
  return order.map((at, mine) => {
    const bone = design.bones[at]!
    const parent = bone.parent === null ? undefined : index.get(bone.parent)
    // A parent that comes later (a loop) is no parent.
    const parentRow = parent === undefined ? -1 : (row.get(parent) ?? -1)
    const corners = new Float64Array(bone.cubes.length * 24)
    bone.cubes.forEach((cube, cubeAt) =>
      Array.from({ length: 8 }, (_, corner) => {
        // The same corner `modelBounds` and `posedCorners` start from: its offset from the bone's pivot.
        const at3 = cubeAt * 24 + corner * 3
        corners[at3] = bone.pivot[0] - cube.origin[0] - (corner & 1 ? cube.size[0] : 0)
        corners[at3 + 1] = cube.origin[1] + (corner & 2 ? cube.size[1] : 0) - bone.pivot[1]
        corners[at3 + 2] = cube.origin[2] + (corner & 4 ? cube.size[2] : 0) - bone.pivot[2]
      }),
    )
    const count = corners.length / 3
    const centre: Vec = count ? [0, 1, 2].map((axis) => (Math.min(...Array.from({ length: count }, (_, c) => corners[c * 3 + axis]!)) + Math.max(...Array.from({ length: count }, (_, c) => corners[c * 3 + axis]!))) / 2) as unknown as Vec : ZERO
    const radius = Math.max(0, ...Array.from({ length: count }, (_, c) => Math.hypot(corners[c * 3]! - centre[0], corners[c * 3 + 1]! - centre[1], corners[c * 3 + 2]! - centre[2])))
    return { name: bone.name, parent: parentRow >= 0 && parentRow < mine ? parentRow : -1, pivot: bone.pivot as Vec, angles: bone.rotation as Vec, corners, centre, radius }
  })
}

type Extent = {
  /** Largest squared distance from the feet's vertical line, model pixels. */
  flat: number
  low: number
  high: number
  /** Largest squared distance from the point `centre` up the feet's vertical line (the middle the renderer leans a flier about). */
  round: number
  /** Largest distance to either side of the body, across the way it faces (the model's own x), model pixels: how wide it is. */
  side: number
}

/** What a bone is given by a motion at one moment: turn (degrees, added), move (pixels) and scale. */
type Given = { rotation?: Vec; position?: Vec; scale?: Vec }

/** Room for the matrix (row by row) and the move of each bone, from its own space to the model's; made once for a model and used for every pose. */
const workspace = (bones: readonly Rigged[]) => ({ matrix: new Float64Array(bones.length * 9), move: new Float64Array(bones.length * 3) })

/**
 * Poses the model once and widens `extent` by every corner of every cube. The arithmetic is `posedCorners`' (studio-ai
 * model-motion.ts) put as one matrix and one move for each bone, handed down from the bone above, so that a corner costs a
 * product and not a walk up its bones; a test holds the two to the same corners. A bone whose ball (`centre`, `radius` of its
 * corners, in its own space) cannot reach past what the extent already holds is not walked corner by corner: the ball is carried
 * by the bone's matrix, which stretches it by at most the matrix's Frobenius norm, so the skip never hides a corner that would widen the extent.
 */
function pose(bones: readonly Rigged[], given: ReadonlyMap<string, Given>, centre: number, extent: Extent, work: ReturnType<typeof workspace>) {
  const { matrix, move } = work
  bones.forEach((bone, at) => {
    const add = given.get(bone.name)
    const size = add?.scale ?? ONE
    const shift = add?.position ?? ZERO
    // Angles as the document gives them: mirrored on the two axes the view mirrors (the same signs `posedCorners` has).
    const x = (((bone.angles[0] + (add?.rotation?.[0] ?? 0)) * Math.PI) / 180) * -1
    const y = (((bone.angles[1] + (add?.rotation?.[1] ?? 0)) * Math.PI) / 180) * -1
    const z = ((bone.angles[2] + (add?.rotation?.[2] ?? 0)) * Math.PI) / 180
    const cx = Math.cos(x)
    const cy = Math.cos(y)
    const cz = Math.cos(z)
    const sx = Math.sin(x)
    const sy = Math.sin(y)
    const sz = Math.sin(z)
    // Scale first, then turn about x, then y, then z: Rz · Ry · Rx · S, written out (the columns of the product are the scales of the axes).
    const own0 = cz * cy * size[0]!
    const own1 = (cz * sy * sx - sz * cx) * size[1]!
    const own2 = (cz * sy * cx + sz * sx) * size[2]!
    const own3 = sz * cy * size[0]!
    const own4 = (sz * sy * sx + cz * cx) * size[1]!
    const own5 = (sz * sy * cx - cz * sx) * size[2]!
    const own6 = -sy * size[0]!
    const own7 = cy * sx * size[1]!
    const own8 = cy * cx * size[2]!
    const parent = bone.parent < 0 ? undefined : bones[bone.parent]
    // Where the bone sits in the space of the bone above: its pivot less the pivot above, and what the motion moves it by (the view mirrors x).
    const t0 = -bone.pivot[0] + (parent?.pivot[0] ?? 0) - shift[0]
    const t1 = bone.pivot[1] - (parent?.pivot[1] ?? 0) + shift[1]
    const t2 = bone.pivot[2] - (parent?.pivot[2] ?? 0) + shift[2]
    const m = at * 9
    const v = at * 3
    if (!parent) {
      matrix.set([own0, own1, own2, own3, own4, own5, own6, own7, own8], m)
      move[v] = t0
      move[v + 1] = t1
      move[v + 2] = t2
      return
    }
    const a = bone.parent * 9
    const c = bone.parent * 3
    for (let row = 0; row < 3; row++) {
      const r0 = matrix[a + row * 3]!
      const r1 = matrix[a + row * 3 + 1]!
      const r2 = matrix[a + row * 3 + 2]!
      matrix[m + row * 3] = r0 * own0 + r1 * own3 + r2 * own6
      matrix[m + row * 3 + 1] = r0 * own1 + r1 * own4 + r2 * own7
      matrix[m + row * 3 + 2] = r0 * own2 + r1 * own5 + r2 * own8
      move[v + row] = r0 * t0 + r1 * t1 + r2 * t2 + move[c + row]!
    }
  })
  bones.forEach((bone, at) => {
    const m = at * 9
    const v = at * 3
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = [matrix[m]!, matrix[m + 1]!, matrix[m + 2]!, matrix[m + 3]!, matrix[m + 4]!, matrix[m + 5]!, matrix[m + 6]!, matrix[m + 7]!, matrix[m + 8]!]
    const [v0, v1, v2] = [move[v]!, move[v + 1]!, move[v + 2]!]
    if (bone.corners.length === 0) return
    // The bone's ball in the model's space: where its middle goes, and the most its radius can grow to.
    const ballX = m0 * bone.centre[0] + m1 * bone.centre[1] + m2 * bone.centre[2] + v0
    const ballY = m3 * bone.centre[0] + m4 * bone.centre[1] + m5 * bone.centre[2] + v1
    const ballZ = m6 * bone.centre[0] + m7 * bone.centre[1] + m8 * bone.centre[2] + v2
    const grown = bone.radius * Math.sqrt(m0 * m0 + m1 * m1 + m2 * m2 + m3 * m3 + m4 * m4 + m5 * m5 + m6 * m6 + m7 * m7 + m8 * m8)
    const flatBall = Math.hypot(ballX, ballZ) + grown
    const roundBall = Math.hypot(ballX, ballY - centre, ballZ) + grown
    if (flatBall * flatBall <= extent.flat && ballY - grown >= extent.low && ballY + grown <= extent.high && roundBall * roundBall <= extent.round && Math.abs(ballX) + grown <= extent.side) return
    for (let corner = 0; corner < bone.corners.length; corner += 3) {
      const px = bone.corners[corner]!
      const py = bone.corners[corner + 1]!
      const pz = bone.corners[corner + 2]!
      const x = m0 * px + m1 * py + m2 * pz + v0
      const y = m3 * px + m4 * py + m5 * pz + v1
      const z = m6 * px + m7 * py + m8 * pz + v2
      const flat = x * x + z * z
      if (Math.abs(x) > extent.side) extent.side = Math.abs(x)
      if (flat > extent.flat) extent.flat = flat
      if (y < extent.low) extent.low = y
      if (y > extent.high) extent.high = y
      const round = flat + (y - centre) * (y - centre)
      if (round > extent.round) extent.round = round
    }
  })
}

type Clip = ModelDesign["animations"][number]

/** What one motion gives each bone at a moment, by the animation contract's own sampler (`sampleTrack`). */
function given(clip: Clip, channels: readonly { bone: string; tracks: ReturnType<typeof channelTracks> }[], time: number) {
  const out = new Map<string, Given>()
  for (const channel of channels) {
    out.set(channel.bone, {
      ...(channel.tracks.rotation.length ? { rotation: sampleTrack(channel.tracks.rotation, time, clip.loop)! } : {}),
      ...(channel.tracks.position.length ? { position: sampleTrack(channel.tracks.position, time, clip.loop)! } : {}),
      ...(channel.tracks.scale.length ? { scale: sampleTrack(channel.tracks.scale, time, clip.loop)! } : {}),
    })
  }
  return out
}

/**
 * The moments of one motion at which the model is posed: its start and end, every key of every track, and between two keys as many more
 * as it takes for no bone to turn more than `REACH.turn` degrees from one moment to the next (the angles of its three axes added, which is
 * never less than the one turn that takes the bone from one pose to the other), or `REACH.curve` where a track runs on a curve. Each bone
 * is looked at by itself, over the stretch between its own keys, at `grid` places; a bone that turns unevenly (a curve is fast in its middle)
 * is therefore cut where it is fast, and the moments of all the bones are laid together.
 */
export function reachMoments(clip: Clip, known: ReadonlySet<string>) {
  const chosen = new Set<number>([0, clip.length])
  const clamp = (time: number) => Math.min(Math.max(time, 0), clip.length)
  for (const channel of clip.channels) {
    if (!known.has(channel.bone)) continue
    const tracks = channelTracks(channel as ClipChannel)
    for (const kind of ["rotation", "position", "scale"] as const) {
      const track = tracks[kind]
      const times = [...new Set(track.map((key) => clamp(key.time)))].sort((a, b) => a - b)
      times.forEach((time) => chosen.add(time))
      times.forEach((before, index) => {
        const time = times[index + 1]
        if (time === undefined) return
        // A stretch runs on a curve when either key at its ends asks for one; the curve can pass beyond both ends.
        const curved = track.some((key, at) => key.time <= before && (track[at + 1]?.time ?? -1) >= time && (key.interpolation === "smooth" || track[at + 1]?.interpolation === "smooth"))
        if (curved) for (let step = 1; step < REACH.curve; step++) chosen.add(before + ((time - before) * step) / REACH.curve)
        if (kind !== "rotation") return
        const value = (place: number, cells: number) => sampleTrack(track, before + ((time - before) * place) / cells, clip.loop)!
        const distance = (a: readonly number[], b: readonly number[]) => a.reduce((sum, angle, axis) => sum + Math.abs(angle - b[axis]!), 0)
        const cells = Math.min(REACH.grid, Math.max(REACH.curve, Math.ceil(distance(value(0, 1), value(1, 1)) / (REACH.turn / 3))))
        const samples = Array.from({ length: cells + 1 }, (_, place) => value(place, cells))
        let from = 0
        for (let place = 1; place <= cells; place++) {
          if (distance(samples[place]!, samples[from]!) > REACH.turn + 1e-9 && place - 1 > from) {
            from = place - 1
            chosen.add(before + ((time - before) * from) / cells)
          }
        }
      })
    }
  }
  const moments = [...chosen].sort((a, b) => a - b)
  return moments.length <= REACH.poses ? moments : Array.from({ length: REACH.poses }, (_, index) => moments[Math.round((index * (moments.length - 1)) / (REACH.poses - 1))]!)
}

/**
 * The longest way from the feet's origin to any corner of the model that a chain of bones can lay out, model pixels: the distance to the
 * first bone's pivot, each pivot to the next down the chain, and the farthest corner from the last. Turning the bones only bends that
 * way, it never lengthens it, so no pose is farther than this from where the chain starts; used for the margin between poses (`REACH.turn`).
 */
function chainReach(bones: readonly Rigged[]) {
  const reach: number[] = []
  bones.forEach((bone, at) => {
    const parent = bone.parent < 0 ? undefined : bones[bone.parent]
    const link = parent ? Math.hypot(bone.pivot[0] - parent.pivot[0], bone.pivot[1] - parent.pivot[1], bone.pivot[2] - parent.pivot[2]) : Math.hypot(...bone.pivot)
    reach[at] = (parent ? reach[bone.parent]! : 0) + link
  })
  return Math.max(0, ...bones.map((bone, at) => reach[at]! + Math.max(0, ...Array.from({ length: bone.corners.length / 3 }, (_, c) => Math.hypot(bone.corners[c * 3]!, bone.corners[c * 3 + 1]!, bone.corners[c * 3 + 2]!)))))
}

/**
 * How far the model reaches from the vertical line through the creature's feet, in blocks, over the pose it is built in and every pose its
 * motions pass through.
 * - `flat`: farthest from that line on the ground plane, in any direction (the body turns, so the farthest corner can lie on any side).
 * - `low`, `high`: lowest and highest, from the feet.
 * - `round`: farthest from the point `centre` blocks up that line, in any direction (a flier leans about its middle).
 * - `side`: farthest to either side of the body, across the way it faces: how wide it is, wings and all.
 * - `built`: the same three for the pose it is built in alone, with no margin: what `modelBounds` and `visible_bounds_*` carry.
 * - `margin`: blocks added to the posed numbers for the arcs between two poses (`REACH.turn`).
 */
export function modelReach(design: Pick<ModelDesign, "bones" | "animations">, centre: number) {
  const bones = rig(design)
  const known = new Set(design.bones.map((bone) => bone.name))
  const fresh = (): Extent => ({ flat: 0, low: Number.POSITIVE_INFINITY, high: Number.NEGATIVE_INFINITY, round: 0, side: 0 })
  const centrePixels = centre * PIXELS
  const built = fresh()
  const work = workspace(bones)
  pose(bones, new Map(), centrePixels, built, work)
  const posed: Extent = { ...built }
  for (const clip of design.animations) {
    const channels = clip.channels.filter((channel) => known.has(channel.bone)).map((channel) => ({ bone: channel.bone, tracks: channelTracks(channel as ClipChannel) }))
    for (const time of reachMoments(clip, known)) pose(bones, given(clip, channels, time), centrePixels, posed, work)
  }
  const margin = (chainReach(bones) * (1 - Math.cos((REACH.turn / 2) * (Math.PI / 180)))) / PIXELS
  const blocks = (extent: Extent, extra: number) => ({
    flat: Math.sqrt(extent.flat) / PIXELS + extra,
    // A model with no cube at all reaches nowhere.
    low: (Number.isFinite(extent.low) ? extent.low / PIXELS : 0) - extra,
    high: (Number.isFinite(extent.high) ? extent.high / PIXELS : 0) + extra,
    round: Math.sqrt(extent.round) / PIXELS + extra,
    side: extent.side / PIXELS + extra,
  })
  return { ...blocks(posed, margin), built: blocks(built, 0), margin }
}

/** Round up (or down) to a hundredth of a block, so that writing it down never makes the box smaller than the model. */
const outward = (value: number, direction: 1 | -1) => (direction === 1 ? Math.ceil(value * 100 - 1e-9) : Math.floor(value * 100 + 1e-9)) / 100

/**
 * What the game is told about a creature whose model reaches beyond the box it collides with.
 * - `box`: the creature's collision box, blocks (`width` is the side of its square footprint).
 * - `flier`: it leans in the air (pitch and roll about the middle of its box, see `fabric/entity-flight.ts`), so the box has to hold the
 *   model in any lean: a ball about that middle. A creature that stays upright needs only the model's own height and distance from its feet.
 * - `range`: blocks from where it began that it may go (its home radius, its boss leash); 0 when nothing keeps it near.
 *
 * `sight` is null when the model (as built, for a creature that does not fly; in every pose, for one that does) stays inside the box and the half block
 * the game allows round it; else the box the game should cull by, over every pose the motions take:
 * `reach` blocks to every side of the feet's vertical line (the body turns, so no side is shorter), from `low` to `high` blocks above them.
 * `chunks` is null when the usual range at which players are sent the creature is enough; else the number of chunks to say, which is the farthest of
 * - how far it can be from where it began and still be seen whole: `range` and the model's reach on the ground plane; and
 * - when the model fills more than its box, how far the game itself draws a creature of this collision box: `REACH.draw` times its average side;
 * rounded up to whole chunks and held to at most `REACH.tracking.most`.
 */
export function sightOf(design: Pick<ModelDesign, "bones" | "animations">, box: { width: number; height: number }, flier: boolean, range: number) {
  const middle = box.height / 2
  const reach = modelReach(design, middle)
  const wide = flier ? reach.round : reach.flat
  const low = flier ? middle - reach.round : reach.low
  const high = flier ? middle + reach.round : reach.high
  // Whether the box says where the creature is seen. A flier is judged in every pose it takes: its wings are the point of its motions, and the lean is
  // the renderer's. Any other creature is judged as it is built, which is what `visible_bounds_*` carry: a body that is boxed to its own size keeps the
  // half block the game allows round every creature, and so the output of every creature whose model fits stays what it was.
  const own = flier ? { flat: reach.round, low: middle - reach.round, high: middle + reach.round } : reach.built
  const outside = own.flat > box.width / 2 + REACH.slack || own.low < -REACH.slack || own.high > box.height + REACH.slack
  const sight = outside ? { reach: outward(wide, 1), low: outward(low, -1), high: outward(high, 1) } : null
  // The average side of the collision box, which is the box the game measures the draw distance of an entity by: two sides are its width, the third its height.
  const side = sight ? (2 * box.width + box.height) / 3 : 0
  const blocks = Math.max(range + reach.flat, side * REACH.draw)
  const chunks = Math.min(REACH.tracking.most, Math.ceil(blocks / REACH.chunk))
  return { sight, chunks: chunks > REACH.tracking.least ? chunks : null, reach }
}

/**
 * How wide a flier is across its body when it flies, and whether that is more than the game's own box for it covers: the thing its steering has to keep clear of rock and trees
 * on each side, not only along its middle. Counted over the built pose and the motions it plays in the air (`flightMotions`: taking off, landing, flying, gliding or hovering), in
 * blocks from the middle of the body to the tip on either side (the margin between poses included; `modelReach.side`), rounded up to a hundredth.
 * - `half`: that distance. Null when it is no more than half the collision box's width plus `REACH.slack`: the half block the game itself already allows a model beyond its box
 *   (`EntityRenderer.shouldRender`), which is as far as a wing may stick out of the box before it is something the box no longer stands for. A flier that fits is steered by its
 *   middle alone, as it always was.
 * The collision box is what really collides (a wing does not), so the box is what the wings are measured against.
 */
export function flierSpan(design: Pick<ModelDesign, "bones" | "animations">, box: { width: number; height: number }, flight: Flight) {
  const played = new Set(Object.values(flightMotions(flight)).filter((name): name is string => name !== null))
  const half = outward(modelReach({ bones: design.bones, animations: design.animations.filter((clip) => played.has(clip.name)) }, box.height / 2).side, 1)
  return half > box.width / 2 + REACH.slack ? { half } : null
}
