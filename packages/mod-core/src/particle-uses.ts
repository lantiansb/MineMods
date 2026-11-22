import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { projectileSketch, skyPlaces } from "./ability-projectile"
import { placeTarget } from "./creature-abilities"
import type { Emitter } from "./particle-emission"
import type { Ability, Boss } from "./entity-runtime"
import type { ModuleDocument } from "./workspace"
import { bossShowSteps } from "./boss-show"
import { expandFeedback } from "./hit-feedback"
import { emitterWhen, emitTicks, resolveParticle, type ParticleAliases } from "./particle-emission"
import { particleTicks, type ParticleDocument } from "./particle"

type Creature = Extract<ModuleDocument, { kind: "entity" }>
export type ParticleEvent = Extract<Ability["events"][number], { type: "particle" }>
export type ParticleUse = {
  label: string
  ability?: Ability
  clip: string
  events: ParticleEvent[]
  repeat?: boolean
  when?: Emitter["when"]
  phase?: number
}

export function particleUses(owner: Creature, idle: string): ParticleUse[] {
  const abilities = (owner.abilities ?? []).flatMap((ability) => {
    const events = expandFeedback(ability.events, owner.particles).filter(
      (e): e is ParticleEvent => e.type === "particle",
    )
    ability.events.forEach((e, index) => {
      if (e.type !== "lightning" || !e.look?.particle) return
      const ref = e.look.particle
      const burst = typeof ref === "object" && "particle" in ref ? ref : { particle: ref, count: 12, spread: 0.5 }
      for (const place of skyPlaces(e.place, index, placeTarget(ability)))
        events.push({ type: "particle", at: e.at, ...place, ...burst })
    })
    return events.length || ability.hits.some((h) => h.type === "projectile" && h.trail)
      ? [{ label: ability.name, ability, clip: ability.clip, events }]
      : []
  })
  const emitters = (owner.emitters ?? []).map((emitter, index) => {
    const { when, ...scatter } = emitter
    const moment = emitterWhen(when)
    return {
      label: "常驻 " + (index + 1) + " · " + moment,
      clip: idle,
      repeat: true,
      when,
      events: [{ forward: 0, up: 0, left: 0, ...scatter, type: "particle" as const, at: 0 }],
    }
  })
  const shows = bossShowSteps(owner.boss).flatMap(({ show, step, index }) => {
    if (step.type !== "particle") return []
    const track = show === "intro" ? owner.boss?.intro : owner.boss?.death
    const pose = track?.steps?.filter((s) => s.type === "clip" && s.at <= step.at).sort((a, b) => b.at - a.at)[0]
    return [
      {
        label: (show === "intro" ? "登场" : "死亡") + " 第 " + (index + 1) + " 步",
        clip: pose?.type === "clip" ? pose.clip : idle,
        events: [step],
      },
    ]
  })
  const phases = (owner.boss?.phases ?? []).flatMap((phase, i) =>
    (phase.finish ?? []).flatMap((step, j) =>
      step.type === "particle"
        ? [
            {
              label: "第 " + (i + 2) + " 阶段收尾 " + (j + 1),
              phase: i + 2,
              clip: phase.clip ?? idle,
              events: [{ ...step, at: 0 }],
            },
          ]
        : [],
    ),
  )
  return [...abilities, ...emitters, ...shows, ...phases]
}

export function particleWeather(boss?: Boss | null, when?: Emitter["when"], phase?: number) {
  const phases = boss?.phases ?? []
  const range = typeof when === "object" ? when : undefined
  const first =
    phase ??
    (range && "phase" in range ? range.phase : range && "if" in range && range.if === "phase_range" ? range.from : 1)
  const last =
    phase ??
    (range && "phase" in range
      ? range.phase
      : range && "if" in range && range.if === "phase_range"
        ? range.to
        : undefined) ??
    phases.length + 1
  let weatherDark = false,
    dark = !!boss?.bar.darken_sky
  for (let n = 1; n <= Math.min(last, phases.length + 1); n++) {
    const weather = phases[n - 2]?.weather
    if (weather) weatherDark = weather.dark > 0 || weather.thunder
    if (n >= first && weatherDark) dark = true
  }
  return { dark, fog: !!boss?.arena?.fog }
}

export function particleMoments(
  use: ParticleUse,
  aliases: ParticleAliases | undefined,
  lookup?: (id: string) => { document: ParticleDocument } | null,
  design?: ModelDesign,
) {
  const changes = new Map<number, number>()
  const add = (tick: number, count: number) => changes.set(tick, (changes.get(tick) ?? 0) + count)
  const events = use.events.map((event) => {
    const ref = resolveParticle(event.particle, aliases)
    const doc = typeof ref === "object" ? lookup?.(ref.asset)?.document : null
    const life = doc ? particleTicks(doc) : 20
    const timed = use.repeat ? { ...event, until: (life + (event.every_ticks ?? 2)) / 20 } : event
    for (const tick of emitTicks(timed)) {
      add(tick, timed.count)
      add(tick + life, -timed.count)
    }
    return timed
  })
  use.ability?.hits.forEach((hit, index) => {
    if (hit.type !== "projectile" || !hit.trail) return
    const ref = resolveParticle(hit.trail.particle, aliases)
    const doc = typeof ref === "object" ? lookup?.(ref.asset)?.document : null
    const life = doc ? particleTicks(doc) : 20,
      sketch = projectileSketch(use.ability!, index, design ?? null)
    for (const flight of sketch?.flights ?? [])
      for (const segment of [
        { start: sketch!.tick, path: flight.out },
        { start: sketch!.tick + (flight.backAt ?? 0), path: flight.back },
      ]) {
        for (let i = 1; i < segment.path.length; i++) {
          add(segment.start + i, hit.trail.per_tick)
          add(segment.start + i + life, -hit.trail.per_tick)
        }
      }
  })
  const boundaries = [...changes.keys()].sort((a, b) => a - b)
  let alive = 0,
    peak = 0,
    firstPeak = 0,
    lastPeak = 0
  for (let i = 0; i + 1 < boundaries.length; i++) {
    const tick = boundaries[i]!
    alive += changes.get(tick)!
    if (alive > peak) {
      peak = alive
      firstPeak = tick
      lastPeak = boundaries[i + 1]! - 1
    } else if (alive === peak && tick === lastPeak + 1) lastPeak = boundaries[i + 1]! - 1
  }
  const start = boundaries[0] ?? 0,
    end = (boundaries.at(-1) ?? 1) - 1
  const fullest = Math.round((firstPeak + lastPeak) / 2)
  return {
    events,
    peak,
    times: [...new Set([fullest, Math.round((start + fullest) / 2), Math.round((fullest + end) / 2), start, end])]
      .slice(0, 3)
      .map((t) => t / 20),
  }
}
