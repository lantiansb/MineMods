import type { LookOptions } from "@minemods/studio-ai/making"
import { abilityClipAt, bonePlace } from "./creature-abilities"
import { particleUses, particleWeather, type ParticleUse } from "./particle-uses"
import { resolveParticle, scatterRange } from "./particle-emission"
import type { ModuleDocument } from "./workspace"
import type { ParticleDocument } from "./particle"

type Spread = NonNullable<LookOptions["particle_emit"]>
type Asset = { id: string; document: ModuleDocument }
export type SceneExample = {
  label: string
  emission: Spread
  height?: number
  left?: number
  forward?: number
  repeat?: number
  duration?: number
  dark?: boolean
  fog?: boolean
}
export const layeredParticles: SceneExample = {
  label: "成片 · 40 团叠放",
  emission: { count: 40, shape: "disc", spread: { x: 1.3, y: 0.15, z: 0.85 } },
}
export const typicalParticles: SceneExample[] = [
  { label: "贴地圆盘", emission: { count: 24, shape: "disc", spread: { x: 3, y: 0.08, z: 3 } } },
  { label: "同向的一线", emission: { count: 18, spread: { x: 0.15, y: 0.15, z: 3 }, velocity: { left: 4 } } },
]
export function particleExamples(
  assets: readonly Asset[],
  document: ParticleDocument,
  pending?: ModuleDocument,
  identity?: string,
): SceneExample[] {
  const id = identity ?? assets.find((a) => a.document.kind === "particle" && a.document.name === document.name)?.id
  const examples = new Map<string, { example: SceneExample; uses: number }>()
  for (const owner of [
    ...(pending ? [pending] : []),
    ...assets
      .map((a) => a.document)
      .filter(
        (d) => !pending || d.kind !== pending.kind || !("name" in d && "name" in pending && d.name === pending.name),
      ),
  ]) {
    if (owner.kind !== "entity" && owner.kind !== "ability") continue
    const rows: Pick<ParticleUse, "label" | "events" | "when" | "phase" | "repeat" | "ability">[] =
      owner.kind === "entity"
        ? particleUses(owner, "")
        : [{ label: owner.name, events: owner.events.filter((e) => e.type === "particle") }]
    for (const row of rows)
      for (const e of row.events) {
        const ref = resolveParticle(e.particle, owner.particles)
        if (!id || typeof ref !== "object" || ref.asset !== id) continue
        const r = scatterRange(e)
        const emission: Spread = {
          count: e.count,
          shape: e.shape === "ball" ? "sphere" : e.shape,
          spread: { x: r.left, y: r.up, z: r.forward },
          velocity: e.velocity,
          motion: e.motion,
          tint: e.tint,
        }
        const model = owner.kind === "entity" ? assets.find((a) => a.id === owner.model_asset_id)?.document : null
        const ability = "ability" in row ? row.ability : undefined
        const pose = ability && model?.kind === "model" ? abilityClipAt(ability, model, e.at) : null
        const joint =
          e.bone && model?.kind === "model" ? bonePlace(model, e.bone, pose?.clip ?? null, pose?.time ?? 0) : null
        const height = e.up + (joint?.up ?? 0),
          left = e.left + (joint?.left ?? 0),
          forward = e.forward + (joint?.forward ?? 0)
        const key = JSON.stringify([
          emission,
          height,
          left,
          forward,
          e.every_ticks,
          e.until === undefined ? null : e.until - e.at,
        ])
        const weather = particleWeather(owner.kind === "entity" ? owner.boss : null, row.when, row.phase)
        const known = examples.get(key)
        if (known) {
          known.uses++
          known.example.dark ||= weather.dark
          known.example.fog ||= weather.fog
          continue
        }
        const form =
          e.motion?.type === "converge"
            ? "聚拢"
            : e.motion?.type === "orbit"
              ? "环绕"
              : e.shape === "disc"
                ? "圆盘"
                : e.shape === "ring"
                  ? "圆环"
                  : e.up > 2
                    ? "从高处落"
                    : Math.max(r.left, r.forward) > 3 * Math.min(r.left, r.forward)
                      ? "一线"
                      : "散开"
        examples.set(key, {
          uses: 1,
          example: {
            label: row.label + " · " + form,
            emission,
            height,
            left,
            forward,
            repeat: e.until !== undefined || ("repeat" in row && row.repeat) ? (e.every_ticks ?? 2) : undefined,
            duration: e.until === undefined ? undefined : Math.round((e.until - e.at) * 20),
            ...weather,
          },
        })
      }
  }
  if (examples.size)
    return [...examples.values()]
      .sort((a, b) => b.uses - a.uses)
      .slice(0, 4)
      .map((x) => x.example)
  return document.suggested_emit ? [{ label: "建议撒法", emission: document.suggested_emit }] : typicalParticles
}
