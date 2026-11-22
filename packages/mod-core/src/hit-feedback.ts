import type { Ability, AbilityEvent } from "./entity-runtime"
import type { ParticleAliases } from "./particle-emission"

type Step = Exclude<AbilityEvent, { type: "hit_fx" }>

export function expandFeedback(events: readonly AbilityEvent[], aliases?: ParticleAliases): Step[] {
  return events.flatMap((event): Step[] => {
    if (event.type !== "hit_fx") return [event]
    const { at, where, hit, color, level } = event
    const place = { at, where, hit, forward: 0, left: 0 }
    const flash = { ...place, type: "flash" as const, color, seconds: 0.3, radius: 1.4, grow: 1.3 }
    const out: Step[] = [
      { ...flash, shape: "glint", tilt: 75 },
      { ...place, type: "particle", particle: event.particle ?? aliases?.hit ?? "crit", count: level === "light" ? 6 : 12, spread: 0.4, up: 0.8 },
      { at, type: "sound", sound: event.sound ?? "entity.player.attack.crit", volume: 1, pitch: 1 },
    ]
    if (level !== "light") out.push({ ...flash, shape: "ring", tilt: 0, grow: 2 })
    if (level === "heavy") out.push({ at, type: "shake", strength: 1, radius: 12, seconds: 0.3 },
      { ...place, type: "debris", up: 0, count: 6, radius: 1.2 })
    return out
  })
}

export function feedbackOwner<T extends { abilities?: Ability[] | null; particles?: ParticleAliases }>(owner: T): T {
  if (!owner.abilities?.some(a => a.events.some(e => e.type === "hit_fx"))) return owner
  return { ...owner, abilities: owner.abilities.map(a => ({ ...a, events: expandFeedback(a.events, owner.particles) })) }
}
