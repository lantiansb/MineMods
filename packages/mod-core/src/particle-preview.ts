import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { EmissionFinding } from "./particle-emission-findings"
import { projectileSketch } from "./ability-projectile"
import type { Ability } from "./entity-runtime"
import { abilityClipAt, abilityPlace, bonePlace, hitAnchor, hitFixed, hitPlaces } from "./creature-abilities"
import { assumedTarget, hitCentre } from "./effect-abilities"
import { emitTicks, extendedEmit, particleLabel, scatterWords, resolveParticle, scatterRange, type ParticleAliases } from "./particle-emission"
import { assetRef, boneRef, registryRef } from "./finding-refs"
import { previewPng } from "./preview-png"
import { appearancePixels, particleAt, particleTicks, type ParticleDocument } from "./particle"

function frameUrl(frame: ParticleDocument["frames"][number] | undefined, edge?: "soft") {
  if (!frame || typeof frame === "string" && !edge) return frame ?? null
  const { pixels, width, height } = appearancePixels(frame,edge)
  return "data:image/png;base64," + btoa(String.fromCharCode(...previewPng(pixels, width, height)))
}

export type ParticleLookup = (id: string) => { title: string; document: ParticleDocument } | null
type Event = Extract<Ability["events"][number], { type: "particle" }>
export type ParticleGroup = { traces?: {from:[number,number,number];to:[number,number,number]}[]; emissive?:boolean; stretch?:number; screenLimit?:number; vectors?: [number,number,number][]; points: [number,number,number][]; frame: string | null; rgb: number[]; opacity: number; size: number; turn: number; name: string }
type Place = { forward: number; up: number; left: number }

// java.util.Random.nextDouble(), so the same seed gives the same spawn positions on every loader.
function seeded(seed: number) {
  const multiplier = 0x5deece66dn, mask = (1n << 48n) - 1n
  let state = (BigInt(seed) ^ multiplier) & mask
  const bits = (n: number) => { state = (state * multiplier + 11n) & mask; return Number(state >> BigInt(48-n)) }
  return () => (bits(26) * 134217728 + bits(27)) / 9007199254740992
}
function origins(ability: Ability, design: ModelDesign, event: Event, tick: number): Place[] {
  const zero = { forward: 0, up: 0, left: 0 }
  if (event.bone) {
    const pose = abilityClipAt(ability, design, tick/20)
    return [bonePlace(design, event.bone, pose?.clip ?? null, pose?.time ?? 0) ?? zero]
  }
  if (event.where === "target") return [{ ...zero, forward: assumedTarget(ability) }]
  if (event.where !== "hit" || event.hit == null) return [zero]
  const hit = ability.hits[event.hit]
  if (!hit) return []
  const centre = hitCentre(hit)
  const bases = hitFixed(hit) ? hitPlaces(hit, event.hit, assumedTarget(ability)) : [hitAnchor(ability, event.hit, design) ?? zero]
  return bases.map(p => ({ forward: p.forward + centre.forward, up: p.up + centre.up, left: p.left + centre.left }))
}

export function scatterFindings(e: Pick<Event, "velocity" | "motion" | "tint" | "particle" | "count" | "every_ticks" | "until" | "at" | "bone">, aliases?: ParticleAliases, lookup?: ParticleLookup, dim = false) {
  const ref = resolveParticle(e.particle, aliases)
  const asset = typeof ref === "object" ? lookup?.(ref.asset) : null
  const doc = asset?.document
  const moving = e.velocity && [e.velocity.forward,e.velocity.up,e.velocity.left,e.velocity.outward].some(Boolean)
  const live = e.count * Math.min(emitTicks(e).length, Math.ceil((doc ? particleTicks(doc) : 20)/(e.every_ticks ?? 2)))
  const side = doc ? Math.max(doc.size.start,doc.size.end,...(doc.size.mid ?? []).map(point=>point.value)) : null
  const area = side === null ? null : Math.round(live*side*side*(doc?.face === "motion" ? doc.stretch ?? 1 : 1)*10)/10
  const findings: [EmissionFinding, string | false | undefined | null][] = [
    ["dark", dim && doc && !doc.emissive && [doc.color.start,...(doc.color.mid??[]).map(p=>p.value),doc.color.end].every(color => {
      const light = [1,3,5].map(i => {
        const value = parseInt(color.slice(i,i+2),16) / 255 * (e.tint ? parseInt(e.tint.slice(i,i+2),16)/255 : 1)
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126*light[0]! + 0.7152*light[1]! + 0.0722*light[2]! < 0.08
    }) && "暗处看不清，考虑发光或提亮。"],
    ["vanilla_options", typeof ref === "string" && (e.motion || e.tint) && "原版粒子不会聚拢、环绕或染色。想要这些变化，请选工程里的粒子资产。"],
    ["ignored_velocity", e.motion?.type === "converge" && moving && "这一把往中心聚，初速度不会生效。请去掉 velocity 或改用其他运动。"],
    ["missing_velocity", doc && "face" in doc && doc.face === "motion" && !moving && "这种粒子要顺着飞的方向画。请给这一把写 velocity，让它有朝向。"],
    ["area", (live >= 240 || area !== null && area >= 128) && `这一把同时活着的大约有 ${live} 颗${area === null ? "，原版粒子大小由游戏决定" : `，按最大尺寸合计约 ${area} 平方格（重叠也计入）`}。调小每把颗数、尺寸或拉长发射间隔可以减轻绘制负担。`],
  ]
  return findings.flatMap(([emission, text]) => typeof text === "string" && text ? [{
    emission,
    rule: "particle_emission" as const,
    text,
    fix: "",
    refs: [
      ...(typeof ref === "object" ? [assetRef(ref.asset, asset?.title)] : typeof ref === "string" ? [registryRef(ref, particleLabel(ref))] : []),
      ...(e.bone ? [boneRef(e.bone)] : []),
    ],
  }] : [])
}

/** How a particle a picture draws looks at `age` ticks: the project's own at that age, or the game's own as a plain grey dot (its look is the game's). */
function looks(particle: Parameters<typeof resolveParticle>[0], age: number, aliases?: ParticleAliases, lookup?: ParticleLookup) {
  const ref = resolveParticle(particle, aliases)
  const doc = typeof ref === "object" ? lookup?.(ref.asset)?.document : null
  const values = doc ? particleAt(doc, Math.min(age, particleTicks(doc) - 1)) : { color: [0.6, 0.6, 0.6], size: 0.12, opacity: 1, frame: 0, turn: 0 }
  return { emissive: doc?.emissive, frame: frameUrl(doc?.frames[values.frame], doc?.edge), rgb: values.color, size: values.size, turn: values.turn, opacity: values.opacity, name: particleLabel(particle, { aliases, title: (id) => lookup?.(id)?.title ?? null }) }
}

/**
 * r29c: what the game sends at a moment of impact (`fabric/impact-fx.ts`: `sendParticles(type, at, count, spread, spread, spread, 0.02)`), as they are born: `count` of them, each
 * a gaussian `spread` blocks about `at` (blocks, the creature's own terms) on every axis, the same seeded numbers on every look. Null without a particle.
 */
export function impactParticles(fx: { particle?: Parameters<typeof resolveParticle>[0] | undefined; count?: number | undefined; spread?: number | undefined }, at: Place, seed: number, defaults: { count: number; spread: number }, aliases?: ParticleAliases, lookup?: ParticleLookup): ParticleGroup | null {
  if (fx.particle === undefined) return null
  const random = seeded(seed)
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
  const spread = fx.spread ?? defaults.spread
  const points = Array.from({ length: fx.count ?? defaults.count }, () => abilityPlace(at.forward + gaussian() * spread, at.up + gaussian() * spread, at.left + gaussian() * spread))
  return { ...looks(fx.particle, 0, aliases, lookup), points }
}

/**
 * r29c: the puff the game shows where a dead body goes (`LivingEntity.makePoofParticles`, and the generated `handleEntityEvent` that swaps it, `fabric/entity.ts`): 20 of them, each at
 * `getRandomX(1)`, `getRandomY()`, `getRandomZ(1)` of its box (anywhere across its width either side of the middle, up its height), as they are born (they then drift a gaussian
 * 0.02 a tick, the game's own puff by its own motion). `particle`: what `builtin.death_poof.particle` swaps it for; null, the game's own white puff.
 */
export function poofParticles(box: { width: number; height: number }, particle: Parameters<typeof resolveParticle>[0] | null, aliases?: ParticleAliases, lookup?: ParticleLookup): ParticleGroup {
  const random = seeded(20)
  const points = Array.from({ length: 20 }, () => abilityPlace(box.width * (2 * random() - 1), box.height * random(), box.width * (2 * random() - 1)))
  return particle === null ? { frame: null, rgb: [0.95, 0.95, 0.95], size: 0.25, turn: 0, opacity: 1, name: "原版白烟", points } : { ...looks(particle, 0, aliases, lookup), points }
}

/**
 * The particles of `ability` at `time`. `at` (r29c): where the creature's feet are on a tick of the ability (`abilityTravel`), when it carries itself: what leaves from it, its parts
 * or a hit round it leaves from where it was when it was born there; what is put at the target stays there.
 */
export function particlePreview(ability: Ability, design: ModelDesign, time: number, aliases?: ParticleAliases, lookup?: ParticleLookup, at?: (tick: number) => Place) {
  const groups: ParticleGroup[] = [], captions = new Set<string>()
  const now = Math.round(time*20)
  ability.events.forEach((e,index) => {
    if (e.type !== "particle") return
    const ref = resolveParticle(e.particle, aliases)
    const asset = typeof ref === "object" ? lookup?.(ref.asset) : null
    const doc = asset?.document
    const name = particleLabel(e.particle, { aliases, title: id => lookup?.(id)?.title ?? null })
    const lifetime = doc ? particleTicks(doc) : 20
    emitTicks(e).forEach(tick => {
      const age = now-tick
      if (age < 0 || age >= lifetime) return
      const values = doc ? particleAt(doc, age) : { color: [0.6,0.6,0.6], size: 0.12, opacity: 1, frame: 0, turn: 0 }
      const tint = e.tint && doc ? [1,3,5].map(i => parseInt(e.tint!.slice(i, i+2),16)/255) : [1,1,1]
      const group: ParticleGroup = { emissive:doc?.emissive,stretch:doc?.stretch,screenLimit:doc?.screen_limit,traces:[],vectors:doc?.face==="motion"?[]:undefined,points: [], frame: frameUrl(doc?.frames[values.frame], doc?.edge), rgb: values.color.map((v,i)=>v*tint[i]!), size: values.size, turn: values.turn, opacity: values.opacity, name }
      const random = seeded(1729 + index*7919 + tick), range = scatterRange(e), v = e.velocity
      const carried = at && e.where !== "target" && !(e.where === "hit" && e.hit != null && ability.hits[e.hit] && hitFixed(ability.hits[e.hit]!)) ? at(tick) : null
      for (const born of origins(ability,design,e,tick)) {
        const origin = carried ? { forward: born.forward + carried.forward, up: born.up + carried.up, left: born.left + carried.left } : born
        for (let i=0; i<e.count; i++) {
          const theta = random()*Math.PI*2, h = random()*2-1
          const radius = e.shape === "ring" ? 1 : e.shape === "disc" ? Math.sqrt(random()) : Math.cbrt(random())
          const flat = !e.shape || e.shape === "ball" ? radius*Math.sqrt(1-h*h) : radius
          let x = Math.cos(theta)*flat*range.left, y = h*range.up*(!e.shape || e.shape === "ball" ? radius : 1), z = Math.sin(theta)*flat*range.forward
          const norm = Math.hypot(x,y,z), radial = norm ? (v?.outward ?? 0)/norm : 0
          const rate = (1+(v?.vary ?? 0)*(2*random()-1))/20
          let dx = ((v?.left ?? 0)+radial*x)*rate, dy = ((v?.up ?? 0)+radial*y)*rate, dz = ((v?.forward ?? 0)+radial*z)*rate
          if (!extendedEmit(e)) {
            const gaussian = () => Math.sqrt(-2*Math.log(1-random()))*Math.cos(2*Math.PI*random())
            x=gaussian()*range.left; y=gaussian()*range.up; z=gaussian()*range.forward
            dx=gaussian()*0.02; dy=gaussian()*0.02; dz=gaussian()*0.02
          }
          const birth=abilityPlace(origin.forward+e.forward+z,origin.up+e.up+y,origin.left+e.left+x)
          if (doc && e.motion?.type === "converge") { dx=-x;dy=-y;dz=-z; const k=1-(age/lifetime)**2; x*=k; y*=k; z*=k }
          else {
            const drag = doc?.drag ?? 0.98
            const turn = doc && e.motion?.type === "orbit" ? 2*Math.PI*e.motion.turns/20 : 0
            const c = Math.cos(turn), s = Math.sin(turn)
            for (let t=0; t<age; t++) {
              const previous=[x,y,z]
              dy -= 0.04*(doc?.gravity ?? 0)
              x+=dx; y+=dy; z+=dz
              dx*=drag; dy*=drag; dz*=drag
              if (turn) {
                ;[x,z] = [c*x-s*z, s*x+c*z]
                ;[dx,dz] = [c*dx-s*dz, s*dx+c*dz]
              }
              if (t===age-1) [dx,dy,dz]=[x-previous[0]!,y-previous[1]!,z-previous[2]!]
            }
          }
          if (i===0 && age>0) group.traces!.push({from:birth,to:abilityPlace(origin.forward+e.forward+z,origin.up+e.up+y,origin.left+e.left+x)})
          group.vectors?.push(abilityPlace(dz,dy,dx))
          group.points.push(abilityPlace(origin.forward+e.forward+z,origin.up+e.up+y,origin.left+e.left+x))
        }
      }
      if (group.points.length) { groups.push(group); captions.add(scatterWords(e,name)) }
    })
  })
  ability.hits.forEach((hit, index) => {
    if (hit.type !== "projectile" || !hit.trail) return
    const trail = hit.trail
    const sketch = projectileSketch(ability, index, design)
    if (!sketch) return
    const ref = resolveParticle(trail.particle, aliases)
    const doc = typeof ref === "object" ? lookup?.(ref.asset)?.document : null
    const name = particleLabel(trail.particle, { aliases, title: id => lookup?.(id)?.title ?? null })
    const lifetime = doc ? particleTicks(doc) : 20
    for (const flight of sketch.flights) {
      const segments = [{ path: flight.out, start: sketch.tick }, { path: flight.back, start: sketch.tick + (flight.backAt ?? 0) }]
      for (const { path, start } of segments) {
        for (let step = Math.max(1, now - start - lifetime + 1); step < path.length && start + step <= now; step++) {
          const age = now - start - step
          const values = doc ? particleAt(doc, age) : { color: [0.6,0.6,0.6], size: 0.12, opacity: 1, frame: 0, turn: 0 }
          const random = seeded(1729 + index * 7919 + start + step)
          const from = path[step - 1]!, to = path[step]!
          const points = Array.from({length: trail.per_tick}, (_, i) => from.map((v, axis) =>
            v + (to[axis]! - v) * ((i + 0.5) / trail.per_tick) + 16 * trail.spread * (2 * random() - 1)) as [number, number, number])
          groups.push({ emissive:doc?.emissive,points, frame: frameUrl(doc?.frames[values.frame], doc?.edge), rgb: values.color, size: values.size, turn: values.turn, opacity: values.opacity, name })
          captions.add(`${name}拖尾，每刻 ${trail.per_tick} 颗`)
        }
      }
    }
  })
  return { groups, captions: [...captions] }
}
