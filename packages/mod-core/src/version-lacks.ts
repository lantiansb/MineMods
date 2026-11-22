import { ABILITY_PARTICLES, ABILITY_SOUNDS, type AbilityParticle } from "./ability-words"
import { abilityRef, phaseRef, registryRef } from "./finding-refs"
import type { FindingRef } from "@minemods/studio-ai/acceptance"
import { BUILTIN_LABELS, builtinUses } from "./builtin"
import { impactSlots } from "./impact-slots"
import { resolveAliases } from "./particle-emission"
import { bossShowSteps } from "./boss-show"
import type { Boss } from "./entity-runtime"
import type { TargetId } from "./target/ids"

/**
 * The vanilla particles and sounds an ability or a boss's show may name that a game version does not have (read with javap from the 1.20.1 jar's ParticleTypes and
 * SoundEvents against every id an ability may name: they came with 1.20.3 and later). The one list: the version adapter's (`platform/version.ts`), the build's stop,
 * the creature's acceptance at commit and the words the outside AI is told all read it, so a Forge 1.20.1 creature is refused the moment it is handed in, not at the
 * end of a run when its build stops (the UI run of 2026-11-15: a stone golem handed in with `dust_plume` passed every review and stopped only its build).
 * No version listed lacks nothing.
 */
export const VERSION_LACKS: Readonly<Record<string, { particles: readonly string[]; sounds: readonly string[] }>> = {
  "1.20.1": { particles: ["dust_plume", "gust"], sounds: ["entity.breeze.shoot"] },
}

const NONE = { particles: [], sounds: [] } as const

/** What the game version lacks; nothing for a version not listed. */
export const lacksOf = (minecraft: string) => VERSION_LACKS[minecraft] ?? NONE

/** The game version a target is made for: the last part of its id (`forge-1.20.1` → `1.20.1`; a test holds it to the manifests). */
export const targetMinecraft = (target: TargetId) => target.slice(target.lastIndexOf("-") + 1)

type Evented = { id?: string; ref?: FindingRef; name: string; events: readonly { type: string; particle?: unknown; dust?: unknown; sound?: unknown; look?: {particle?: unknown; sound?: unknown} }[]; hits?: readonly { type: string; trail?: { particle: unknown }; impact?: { particle?: unknown; ground?: readonly { type: string; particle?: unknown }[] } | null }[] }

/** The vanilla particles and sounds these abilities (or shows, each as one) name that the game version lacks, each as the sentence the person and the AI are told. */
export function vanillaGaps(creature: string, evented: readonly Evented[], minecraft: string) {
  const { particles, sounds } = lacksOf(minecraft)
  const refsFor = (source: Evented, id: string, title?: string) => [
    ...(source.ref ? [source.ref] : source.id ? [abilityRef({ id: source.id, name: source.name })] : []),
    registryRef(id, title),
  ]
  const particleGap = (ability: Evented, particle: string, where: string) => ({ refs: refsFor(ability, particle, ABILITY_PARTICLES[particle as AbilityParticle]), text: `「${creature}」的招式「${ability.name}」${where}用了原版的「${ABILITY_PARTICLES[particle as AbilityParticle]}」粒子（${particle}），Minecraft ${minecraft} 里还没有这个粒子。`, fix: `换成 ${minecraft} 也有的粒子，或者用 1.21.1 的目标构建。` })
  return evented.flatMap((ability) => [
    ...ability.events.flatMap((event) => {
      if (event.type === "lightning" && event.look) {
        const raw = event.look.particle
        const ref = raw && typeof raw === "object" && "particle" in raw ? raw.particle : raw
        return [...(typeof ref === "string" && particles.includes(ref) ? [particleGap(ability, ref, "的落雷落点")] : []),
          ...(typeof event.look.sound === "string" && sounds.includes(event.look.sound) ? [{refs:refsFor(ability, event.look.sound, ABILITY_SOUNDS[event.look.sound]),text:`「${ability.name}」落雷选的声音 ${event.look.sound} 在 ${minecraft} 里没有。`,fix:"换成这个版本的声音，或工程自己的声音。"}] : [])]
      }
      if (event.type === "debris" && typeof event.dust === "string" && particles.includes(event.dust)) return [particleGap(ability, event.dust, "的碎块扬尘")]
      if (event.type === "particle" && typeof event.particle === "string" && particles.includes(event.particle)) return [particleGap(ability, event.particle, "")]
      if (event.type === "sound" && typeof event.sound === "string" && sounds.includes(event.sound))
        return [{ refs: refsFor(ability, event.sound, ABILITY_SOUNDS[event.sound]), text: `「${creature}」的招式「${ability.name}」用了原版的「${ABILITY_SOUNDS[event.sound]}」声音（${event.sound}），Minecraft ${minecraft} 里还没有这个声音。`, fix: `换成 ${minecraft} 也有的声音，或者用 1.21.1 的目标构建。` }]
      return []
    }),
    // 落地炸开: the particles a thrown thing bursts into where it comes down name the game's own constant the same way.
    ...(ability.hits ?? []).flatMap((hit, index) => {
      const trail = hit.type === "projectile" ? hit.trail?.particle : undefined
      const missingTrail = typeof trail === "string" && particles.includes(trail) ? [particleGap(ability, trail, `第 ${index + 1} 次出手的飞行拖尾`)] : []
      const particle = hit.type === "projectile" ? hit.impact?.particle : undefined
      return typeof particle === "string" && particles.includes(particle) ? [...missingTrail, particleGap(ability, particle, `第 ${index + 1} 次出手扔出去的东西落地炸开（impact）时`)] : missingTrail
    }),
    // 第 4 步: what a ground hazard puts up, an event's or one a thrown thing leaves where it comes down.
    ...[...ability.events.flatMap((event) => (event.type === "hazard" ? [event.particle] : [])), ...(ability.hits ?? []).flatMap((hit) => (hit.type === "projectile" ? (hit.impact?.ground ?? []).flatMap((fx) => (fx.type === "hazard" ? [fx.particle] : [])) : []))].flatMap((particle) =>
      typeof particle === "string" && particles.includes(particle) ? [particleGap(ability, particle, "的地面危险区（hazard）")] : [],
    ),
  ])
}

/** A creature's abilities and its boss's wake-up and death against the game version: everything it names that the version lacks. */
type Entered = { id?: string | undefined; enter?: import("./impact-fx").ImpactFx | undefined }
export function creatureVanillaGaps(creature: { builtin?: import("./builtin").Builtin; particles?: import("./particle-emission").ParticleAliases; emitters?: readonly {particle: unknown}[]; name: string; abilities?: readonly Evented[] | null; boss?: Boss | null; stagger?: Entered | readonly Entered[] | undefined }, minecraft: string) {
  creature = resolveAliases(creature, false)
  const shows = creature.boss ? bossShowSteps(creature.boss).map(({ show, step }) => ({ name: show === "intro" ? "登场演出" : "死亡演出", events: [step as Evented["events"][number]] })) : []
  const phases = (creature.boss?.phases ?? []).flatMap((phase, index) => phase.sound ? [{ name: `第${index + 1}次变身`, ref: phaseRef(index + 1), events: [{ type: "sound", sound: phase.sound }] }] : [])
  const finish = (creature.boss?.phases ?? []).map((phase, index) => ({ name: `第${index + 1}次变身收尾`, ref: phaseRef(index + 1), events: (phase.finish ?? []).flatMap<Evented["events"][number]>(event => event.type === "ground" ? event.ground : [event]) }))
  const automatic = builtinUses(creature.builtin).map(use => ({name:BUILTIN_LABELS[use.key], events:[{type:"particle",particle:use.particle},{type:"sound",sound:use.sound}]}))
  // r29: what a moment of impact names (a sound, a particle) is held to the version like any event's.
  const staggers = creature.stagger === undefined ? [] : Array.isArray(creature.stagger) ? creature.stagger : [creature.stagger as Entered]
  const impacts = impactSlots((creature.abilities ?? []) as Parameters<typeof impactSlots>[0], staggers).map(slot => ({name:slot.words, events:[{type:"particle",particle:slot.fx.particle},{type:"sound",sound:slot.fx.sound}]}))
  return vanillaGaps(creature.name, [...automatic, ...impacts, ...(creature.abilities ?? []), ...shows, ...phases, ...finish, { name: "常驻发射", events: (creature.emitters ?? []).map(e => ({ ...e, type: "particle" })) }], minecraft)
}

/** What the outside AI making a creature for this target is told it may not name (empty for a version that lacks nothing). */
export function lacksWords(target: TargetId) {
  const minecraft = targetMinecraft(target)
  const { particles, sounds } = lacksOf(minecraft)
  if (!particles.length && !sounds.length) return ""
  return ` 这个工程的目标是 Minecraft ${minecraft}：招式和演出里不能用原版的${particles.length ? `粒子 ${particles.join("、")}` : ""}${particles.length && sounds.length ? "，也不能用" : ""}${sounds.length ? `声音 ${sounds.join("、")}` : ""}（这个版本还没有，交上来会被退回）。`
}
