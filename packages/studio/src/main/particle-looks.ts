import { posedCorners } from "@minemods/studio-ai/model-motion"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import type { Ability } from "@minemods/mod-core/entity-runtime"
import { modelBounds } from "@minemods/mod-core/model-bounds"
import { abilityHitShapes } from "@minemods/mod-core/creature-abilities"
import { abilityTravel, travelFaces, travelShift, travelTrails } from "@minemods/mod-core/ability-travel"
import { hitboxBoxes } from "@minemods/mod-core/creature-hitbox"
import { particleMoments, particleUses, particleWeather } from "@minemods/mod-core/particle-uses"
import { particlePreview, type ParticleLookup } from "@minemods/mod-core/particle-preview"
import { lookCamera } from "../renderer/look-camera"
import type { LookCell, LookSheet } from "./look-job"

type Creature = Extract<ModuleDocument, { kind: "entity" }>
type Vector = [number, number, number]

export function creatureParticleSheets(
  owner: Creature,
  design: ModelDesign,
  lookup: ParticleLookup | undefined,
  most: number,
  animation?: string,
  emittersOnly = false,
) {
  const uses = particleUses(owner, design.animations[0]?.name ?? "")
    .filter((use) => !emittersOnly || use.repeat)
    .filter((use) => !animation || use.ability?.id === animation || use.ability?.clip === animation)
  const rows = uses.map((use) => ({ use, ...particleMoments(use, owner.particles, lookup, design) }))
  const peaks = rows.map((row, index) => ({ row, index, time: row.times[0]! }))
  const extras = peaks
    .filter((p) => p.row.use.ability)
    .sort((a, b) => b.row.peak - a.row.peak)
    .flatMap((p) => p.row.times.slice(1).map((time) => ({ ...p, time })))
  type Light = "白天" | "夜晚" | "压暗" | "起雾"
  const variants = peaks.flatMap((p) => {
    const weather = particleWeather(owner.boss, p.row.use.when, p.row.use.phase)
    const lights: Light[] = [
      "夜晚",
      ...(weather.dark ? ["压暗" as const] : []),
      ...(weather.fog ? ["起雾" as const] : []),
    ]
    return lights.map((light) => ({ ...p, light }))
  })
  const first = peaks.filter((p) => p.row.use.ability)
  const rest = [...peaks.filter((p) => !p.row.use.ability), ...extras].sort((a, b) => b.row.peak - a.row.peak)
  const frames = [...[...first, ...rest].map((p) => ({ ...p, light: "白天" as Light })), ...variants]
  // Give every move a frame before spending space on additional moments.
  const sheets = emittersOnly
    ? Math.ceil(peaks.length / 6)
    : Math.min(
        most,
        Math.max(
          Math.ceil(peaks.filter((p) => p.row.use.ability).length / 6),
          Math.min(Math.max(1, most - 1), Math.ceil(frames.length / 6)),
        ),
      )
  const chosen = (emittersOnly ? peaks.map((p) => ({ ...p, light: "白天" as Light })) : frames).slice(0, sheets * 6)
  const bounds = modelBounds(design)
  const core = hitboxBoxes(owner.hitbox, design)[0]!
  const body = { width: (core.max[0] - core.min[0]) / 16, height: (core.max[1] - core.min[1]) / 16 }
  const sampledCells = chosen.map(({ row, time, light }) => {
    const use = row.use
    const stub: Ability = {
      id: "preview",
      name: use.label,
      clip: use.clip,
      windup: 0,
      length: Math.max(time, 0.05),
      hits: [],
      moves: [],
      events: [],
      facing: "lock",
      stopped_by_hurt: false,
      start: { min_distance: 0, max_distance: 8, line_of_sight: false, cooldown: 0, weight: 1 },
    }
    const ability = { ...(use.ability ?? stub), events: row.events }
    // r29c: an ability that carries the creature has it, its particles and its hit where it is at that moment (`abilityTravel`), as the ability's own pictures draw it.
    const travel = use.ability ? abilityTravel(use.ability, { design, flight: owner.flight, abilities: owner.abilities ?? [], height: body.height }) : null
    const sampled = particlePreview(ability, design, time, owner.particles, lookup, travel ? (tick) => travel.places[Math.max(0, Math.min(travel.places.length - 1, tick))]! : undefined)
    const hit = use.ability && abilityHitShapes(use.ability, design)?.find((h) => Math.abs(h.at - time) < 0.051)
    const faces = hit ? travelFaces(hit, travel) : []
    const offset = travelShift(travel, time)
    const low: Vector = bounds.min.map((value, axis) => value + (offset?.[axis] ?? 0)) as Vector,
      high: Vector = bounds.max.map((value, axis) => value + (offset?.[axis] ?? 0)) as Vector
    const enclose = (p: Vector, margin: number) => {
      for (const axis of [0, 1, 2] as const) {
        low[axis] = Math.min(low[axis], p[axis] - margin)
        high[axis] = Math.max(high[axis], p[axis] + margin)
      }
    }
    for (const group of sampled.groups) {
      for (const p of group.points) enclose(p, group.size * 8 * (group.stretch ?? 1))
      for (const trace of group.traces ?? []) enclose(trace.from, 0)
    }
    for (const face of faces) for (const p of face) enclose(p, 0)
    return { row, time, light, use, sampled, faces, low, high, offset, travel }
  })
  const cells = sampledCells.map(({ row, time, light, use, sampled, faces, offset, travel }): LookCell => {
    const family = sampledCells.filter((c) => c.row === row)
    const low: Vector = [0, 1, 2].map((i) => Math.min(...family.map((c) => c.low[i]!))) as Vector
    const high: Vector = [0, 1, 2].map((i) => Math.max(...family.map((c) => c.high[i]!))) as Vector
    const bones = new Set(row.events.filter((e) => e.bone).map((e) => e.bone))
    const sourceCorners =
      bones.size === 1
        ? posedCorners(
            { bones: design.bones.map((b) => (bones.has(b.name) ? b : { ...b, cubes: [] })) },
            design.animations.find((a) => a.name === use.clip) ?? null,
            time,
          )
        : undefined
    return {
      kind: "hit",
      light,
      sourceCorners,
      scene: 0,
      view: "quarter",
      animation: use.clip,
      time,
      particles: sampled.groups,
      faces,
      ...(offset ? { offset } : {}),
      ...(travel ? { trails: travelTrails(travel, body) } : {}),
      camera: lookCamera({ min: low, max: high }, "quarter", 1.5),
      label:
        use.label +
        " · " +
        light +
        " · " +
        time +
        " 秒 · " +
        sampled.groups.reduce((n, g) => n + g.points.length, 0) +
        " 颗",
      caption: use.repeat
        ? sampled.captions.map((line) =>
            line.replace(/，第 0 秒开始/, "").replace(/，至第 [\d.]+ 秒/, "，条件满足期间持续"),
          )
        : sampled.captions,
    }
  })
  const result: LookSheet[] = []
  for (let start = 0; start < cells.length; start += 6)
    result.push({
      label: "生物身边的粒子 · " + (result.length + 1),
      columns: cells.length === 1 ? 1 : 2,
      cell: [480, 320],
      cells: cells.slice(start, start + 6),
    })
  const omitted = frames.slice(chosen.length).map((p) => p.row.use.label + " " + p.light + " " + p.time + " 秒")
  return {
    sheets: result,
    notes: [
      ...cells.flatMap((c) => (c.kind === "hit" ? [c.label + "：" + c.caption.join("。")] : [])),
      ...(omitted.length ? ["图里没有画：" + omitted.join("、") + "。"] : []),
    ],
  }
}
