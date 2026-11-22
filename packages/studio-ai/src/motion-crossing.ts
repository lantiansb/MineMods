import { penetration } from "./model-motion"

type Vec = [number, number, number]
type Part = { name: string; parent: string | null; from: number; to: number }
type Bounds = [number, number, number, number, number, number]
type CubePose = { bounds: Bounds; corners: Vec[] }
type PartPose = { bounds: Bounds; cubes: CubePose[]; source: Vec[] }
type Pair = { left: number; right: number; cost: number; rest?: number; last?: Row }
type Row = { pair: Pair; left: PartPose; right: PartPose; index: number; count: number }

// A work limit rather than a timer makes coverage reproducible across machines.
const BUDGET = 240_000
const empty = (): Bounds => [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]
const apart = (a: Bounds, b: Bounds) => a[0] >= b[1] || a[1] <= b[0] || a[2] >= b[3] || a[3] <= b[2] || a[4] >= b[5] || a[5] <= b[4]

function partPose(pose: Vec[], part: Part, before?: PartPose): PartPose {
  if (before) {
    let corner = part.from
    for (; corner < part.to; corner++) {
      const a = pose[corner]!, b = before.source[corner]!
      if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) break
    }
    if (corner === part.to) return before
  }
  const bounds = empty()
  const cubes: CubePose[] = []
  for (let corner = part.from; corner < part.to; corner += 8) {
    const corners = pose.slice(corner, corner + 8)
    const cube = empty()
    for (const point of corners)
      for (const axis of [0, 1, 2] as const) {
        cube[axis * 2] = Math.min(cube[axis * 2]!, point[axis])
        cube[axis * 2 + 1] = Math.max(cube[axis * 2 + 1]!, point[axis])
      }
    for (const axis of [0, 2, 4] as const) {
      bounds[axis] = Math.min(bounds[axis], cube[axis])
      bounds[axis + 1] = Math.max(bounds[axis + 1]!, cube[axis + 1]!)
    }
    cubes.push({ bounds: cube, corners })
  }
  return { bounds, cubes, source: pose }
}

function entered(left: PartPose, right: PartPose) {
  if (apart(left.bounds, right.bounds)) return 0
  let depth = 0
  for (const a of left.cubes)
    for (const b of right.cubes)
      if (!apart(a.bounds, b.bounds)) depth = Math.max(depth, penetration(a.corners, b.corners))
  return depth
}

/** Keep the original time and bone order so equal maxima still name the same part and moment. */
export function measureCrossing(parts: Part[], times: number[], poses: Vec[][], rest: Vec[], moments: number[]) {
  const pairs: Pair[] = parts.flatMap((a, left) => parts.slice(left + 1).flatMap((b, offset) =>
    a.parent !== b.name && b.parent !== a.name ? [{ left, right: left + offset + 1, cost: ((a.to - a.from) * (b.to - b.from)) / 64 }] : [],
  ))
  const worst = { more: 0, a: "", b: "", at: 0 }
  if (!pairs.length) return { worst, coverage: undefined }
  const base = parts.map((part) => partPose(rest, part))
  let frames = base
  const rows: Row[] = []
  for (const index of moments) {
    const pose = poses[index]!
    frames = parts.map((part, at) => partPose(pose, part, frames[at]))
    for (const pair of pairs) {
      const left = frames[pair.left]!, right = frames[pair.right]!
      if (apart(left.bounds, right.bounds) || (left === base[pair.left] && right === base[pair.right])) continue
      if (pair.last?.left === left && pair.last.right === right) {
        pair.last.count++
        continue
      }
      const row = { pair, left, right, index, count: 1 }
      pair.last = row
      rows.push(row)
    }
  }
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  const budget = pairs.reduce((limit, pair) => Math.max(limit, pair.cost * 2), BUDGET)
  const work = rows.reduce((sum, row) => sum + row.pair.cost, 0)
  const count = work <= budget ? rows.length : Math.max(1, Math.floor((rows.length * budget) / work))
  // Spread the shortlist across the clip and the parts. Only a fully checked pair at a moment counts towards coverage.
  const samples = count === rows.length ? rows : Array.from({ length: count }, (_, n) =>
    rows[count === 1 ? Math.floor(rows.length / 2) : Math.round((n * (rows.length - 1)) / (count - 1))]!,
  )
  let checked = 0
  let remaining = budget
  for (const { pair, left, right, index, count } of samples) {
    const cost = pair.cost + (pair.rest === undefined ? pair.cost : 0)
    if (cost > remaining) continue
    checked += count
    remaining -= pair.cost
    const depth = entered(left, right)
    if (depth <= worst.more) continue
    if (pair.rest === undefined) {
      remaining -= pair.cost
      pair.rest = entered(base[pair.left]!, base[pair.right]!)
    }
    const more = depth - pair.rest
    if (more > worst.more) Object.assign(worst, { more, a: parts[pair.left]!.name, b: parts[pair.right]!.name, at: times[index]! })
  }
  return { worst, coverage: checked < total ? { checked, total } : undefined }
}
